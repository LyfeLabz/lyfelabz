import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  RESOURCE_EVIDENCE_LIMITS,
  RESOURCE_EVIDENCE_SCHEMA_VERSION,
  evaluateCompletionEligibility,
  outcomeValidatorKey,
  parseResourceEvidence,
  type CompletionDefinition,
  type ResourceEvidence,
} from "../resourceCompletion";
import { PlatformError } from "../shared/errors/platform-error";
import { runFirestoreTransaction } from "../shared/firestore/transaction";
import { log } from "../shared/logging/logger";
import {
  EVIDENCE_REQUEST_LIMITS,
  canonicalJson,
  parseGetEvidenceRequest,
  parseRecordOutcomeRunRequest,
  parseSaveWorkingEvidenceRequest,
  parseSubmitEvidenceRequest,
  payloadHash,
} from "./evidence-request";
import {
  assertActiveStudent,
  assertWritable,
  resolveEvidenceContext,
  type ResolvedEvidenceContext,
  type ResourceEvidenceDeps,
} from "./evidence-assignment-context";
import {
  RESOURCE_EVIDENCE_RECORD_SCHEMA_VERSION,
  resourceEvidenceCreationDocRef,
  resourceEvidenceDocRef,
  resourceEvidenceRunsUpdateDocRef,
  resourceEvidenceSubmissionCreationDocRef,
  resourceEvidenceSubmissionDocRef,
  resourceEvidenceSubmitUpdateDocRef,
  resourceEvidenceWorkingUpdateDocRef,
  type ResourceEvidenceRecord,
  type StoredOutcomeRun,
} from "./resource-evidence-record";
import {
  RUN_VERIFICATION_LIMITS,
  appendKeepsInvariant,
  nextRunAllowance,
  resolveRunVerificationPolicy,
} from "./run-observation-policy";

// Resource-evidence services (RA-3A): retrieve own evidence, save working
// evidence, record a server-verified outcome run, and submit.
//
// NOT DEPLOYED. These handlers are not wrapped in `platformCallable` and are
// not exported from `src/index.ts`. Production deps fail closed (see
// evidence-assignment-context.ts), so even a wired handler refuses every
// call until assignment publication freezes a completion-definition version
// and a published definition store exists.
//
// Concurrency model:
//   - Validation and validator computation run OUTSIDE transactions, so an
//     automatically retried transaction never repeats physics.
//   - Each transaction then re-reads the record and confirms status,
//     ownership, binding, and the relevant revision before writing
//     (compare-and-swap). A mismatch writes nothing.
//   - `workingRevision` guards authored text; `runsRevision` guards the run
//     list. Saving text and recording a run do not conflict with each other.
//     Submit checks both.
//   - Once submitted, every mutation is refused, and the snapshot document
//     is created with `create` (it can never be overwritten).
//   - A retry of an operation that already landed (same operation id, same
//     payload) is acknowledged without writing, even after submission or
//     after the assignment closes, so a lost response never becomes a false
//     refusal. Every NEW write requires a writable assignment.
//   - An invalid request is refused before any write, so previously
//     accepted evidence is never damaged by a rejected one.
//
// Logs carry ids, revisions, counts, and outcome codes only, never student
// text or run parameters.

type WorkingEvidence = Pick<ResourceEvidence, "authored" | "attestations">;

const EMPTY_WORKING_JSON = canonicalJson({ authored: [], attestations: [] });

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

function writeConflict(details: Record<string, unknown>): never {
  throw new PlatformError(
    "resourceEvidence.writeConflict",
    "The evidence changed since it was last read.",
    undefined,
    details,
  );
}

function corrupt(): never {
  throw new PlatformError("resourceEvidence.corruptRecord", "The stored evidence could not be read.");
}

// The stored record must still describe exactly this student, assignment
// occurrence, and frozen binding. Any disagreement is refused rather than
// read or overwritten.
function assertRecordMatchesContext(record: ResourceEvidenceRecord, ctx: ResolvedEvidenceContext): void {
  const o = ctx.ownership;
  const b = ctx.binding;
  if (
    record.recordId !== ctx.recordId ||
    record.studentId !== o.studentId ||
    record.assignmentId !== o.assignmentId ||
    record.classId !== o.classId ||
    record.teacherId !== o.teacherId ||
    record.schoolId !== o.schoolId ||
    record.districtId !== o.districtId
  ) {
    throw new PlatformError("resourceEvidence.forbidden", "This assignment is not available for evidence.");
  }
  if (
    record.resourceId !== b.resourceId ||
    record.resourceType !== b.resourceType ||
    record.assessmentRevisionId !== b.assessmentRevisionId ||
    record.definitionVersion !== b.definitionVersion ||
    record.definitionHash !== b.definitionHash
  ) {
    throw new PlatformError(
      "resourceEvidence.bindingMismatch",
      "The stored evidence belongs to a different completion binding.",
    );
  }
}

function assertWorking(record: ResourceEvidenceRecord): void {
  if (record.status !== "working") {
    throw new PlatformError("resourceEvidence.alreadySubmitted", "Evidence for this assignment was already submitted.");
  }
}

function parseWorking(record: ResourceEvidenceRecord): WorkingEvidence {
  try {
    const parsed = JSON.parse(record.workingJson) as WorkingEvidence;
    if (!Array.isArray(parsed.authored) || !Array.isArray(parsed.attestations)) corrupt();
    return parsed;
  } catch {
    // The parser error is dropped on purpose: V8 quotes the input text.
    return corrupt();
  }
}

function snapshotEvidence(
  ctx: ResolvedEvidenceContext,
  working: WorkingEvidence,
  runs: readonly StoredOutcomeRun[],
): ResourceEvidence {
  return {
    schemaVersion: RESOURCE_EVIDENCE_SCHEMA_VERSION,
    resourceId: ctx.binding.resourceId,
    assessmentRevisionId: ctx.binding.assessmentRevisionId,
    definitionVersion: ctx.binding.definitionVersion,
    authored: working.authored,
    outcomeRuns: runs.map((r) => {
      let parameters: unknown;
      try {
        parameters = JSON.parse(r.parametersJson);
      } catch {
        return corrupt();
      }
      return { validatorId: r.validatorId, validatorVersion: r.validatorVersion, parameters };
    }),
    attestations: working.attestations,
  };
}

// Declared outcome ids a set of validator outcome codes satisfies.
function declaredOutcomeIds(
  definition: CompletionDefinition,
  validatorId: string,
  validatorVersion: number,
  outcomes: readonly string[],
): string[] {
  const key = outcomeValidatorKey(validatorId, validatorVersion);
  return definition.outcomes
    .filter((o) => outcomeValidatorKey(o.validatorId, o.validatorVersion) === key)
    .filter((o) => outcomes.includes(o.validatorOutcome))
    .map((o) => o.outcomeId);
}

function verifiedOutcomeIdsOfRuns(definition: CompletionDefinition, runs: readonly StoredOutcomeRun[]): Set<string> {
  const ids = new Set<string>();
  for (const r of runs) {
    for (const id of declaredOutcomeIds(definition, r.validatorId, r.validatorVersion, r.outcomes)) ids.add(id);
  }
  return ids;
}

// The one validator the frozen definition names. Schema 1 persistence
// supports exactly one; the client never chooses it.
function definitionValidator(definition: CompletionDefinition): { validatorId: string; validatorVersion: number } {
  const keys = new Map(
    definition.outcomes.map((o) => [outcomeValidatorKey(o.validatorId, o.validatorVersion), o] as const),
  );
  if (keys.size !== 1) {
    throw new PlatformError(
      "resourceEvidence.completionBindingUnavailable",
      "This completion definition does not accept outcome runs.",
    );
  }
  const only = [...keys.values()][0];
  return { validatorId: only.validatorId, validatorVersion: only.validatorVersion };
}

// ---------------------------------------------------------------------------
// Retrieve own evidence
// ---------------------------------------------------------------------------

export type ResourceEvidenceView =
  | { readonly exists: false; readonly workingRevision: 0; readonly runsRevision: 0 }
  | {
      readonly exists: true;
      readonly status: "working" | "submitted";
      readonly workingRevision: number;
      readonly runsRevision: number;
      readonly working: WorkingEvidence;
      readonly runs: readonly {
        readonly flightId: string;
        readonly outcomes: readonly string[];
        readonly truncated: boolean;
        readonly undetermined: boolean;
      }[];
      readonly verifiedOutcomeIds: readonly string[];
      readonly submittedAtMillis: number | null;
    };

export async function getOwnResourceEvidence(
  request: CallableRequest<unknown>,
  deps: ResourceEvidenceDeps,
): Promise<ResourceEvidenceView> {
  const actor = await assertActiveStudent(request);
  const input = parseGetEvidenceRequest(request.data);
  const ctx = await resolveEvidenceContext(actor, input.assignmentId, deps);
  const snapshot = await resourceEvidenceDocRef(ctx.recordId).get();
  const record = snapshot.exists ? snapshot.data() : undefined;
  if (!record) return { exists: false, workingRevision: 0, runsRevision: 0 };
  assertRecordMatchesContext(record, ctx);
  return {
    exists: true,
    status: record.status,
    workingRevision: record.workingRevision,
    runsRevision: record.runsRevision,
    working: parseWorking(record),
    runs: record.runs.map((r) => ({
      flightId: r.flightId,
      outcomes: r.outcomes,
      truncated: r.truncated,
      undetermined: r.undetermined,
    })),
    verifiedOutcomeIds: [...verifiedOutcomeIdsOfRuns(ctx.definition, record.runs)],
    submittedAtMillis: record.submittedAt ? record.submittedAt.toMillis() : null,
  };
}

// ---------------------------------------------------------------------------
// Save working evidence
// ---------------------------------------------------------------------------

export type SaveWorkingEvidenceResult = {
  readonly workingRevision: number;
  // false for an identical save or an acknowledged retry.
  readonly persisted: boolean;
};

export async function saveWorkingResourceEvidence(
  request: CallableRequest<unknown>,
  deps: ResourceEvidenceDeps,
): Promise<SaveWorkingEvidenceResult> {
  const actor = await assertActiveStudent(request);
  const input = parseSaveWorkingEvidenceRequest(request.data);
  const ctx = await resolveEvidenceContext(actor, input.assignmentId, deps);

  // RA-2 structural validation against the frozen definition, with the
  // binding taken from the server context and no runs.
  const parsed = parseResourceEvidence(
    {
      schemaVersion: RESOURCE_EVIDENCE_SCHEMA_VERSION,
      resourceId: ctx.binding.resourceId,
      assessmentRevisionId: ctx.binding.assessmentRevisionId,
      definitionVersion: ctx.binding.definitionVersion,
      authored: input.working.authored,
      outcomeRuns: [],
      attestations: input.working.attestations,
    },
    ctx.definition,
  );
  if (!parsed.ok) {
    throw new PlatformError(
      "resourceEvidence.invalidEvidence",
      "The evidence does not match the completion definition.",
      undefined,
      { issues: parsed.issues },
    );
  }
  const workingJson = canonicalJson({ authored: parsed.evidence.authored, attestations: parsed.evidence.attestations });
  const workingBytes = Buffer.byteLength(workingJson, "utf8");
  if (workingBytes > EVIDENCE_REQUEST_LIMITS.maxWorkingBytes) {
    throw new PlatformError("resourceEvidence.invalidRequest", "The evidence is too large.");
  }
  const hash = payloadHash({ working: JSON.parse(workingJson) as unknown, expected: input.expectedWorkingRevision });

  const outcome = await runFirestoreTransaction(async (tx) => {
    const snap = await tx.get(resourceEvidenceDocRef(ctx.recordId));
    const current = snap.exists ? snap.data() : undefined;
    if (current) {
      assertRecordMatchesContext(current, ctx);
      // A retry of a save that already landed is acknowledged even after
      // submission or closing, so a lost response never turns into a false
      // refusal.
      if (current.lastWorkingOperationId === input.operationId) {
        if (current.lastWorkingPayloadHash !== hash) operationConflict();
        if (current.workingRevision === input.expectedWorkingRevision + 1) {
          return { workingRevision: current.workingRevision, persisted: false, kind: "replay" as const };
        }
      }
      assertWorking(current);
    }
    assertWritable(ctx);
    const currentRevision = current?.workingRevision ?? 0;
    if (input.expectedWorkingRevision !== currentRevision) writeConflict({ workingRevision: currentRevision });
    if (current && current.workingJson === workingJson) {
      return { workingRevision: currentRevision, persisted: false, kind: "unchanged" as const };
    }

    const now = FieldValue.serverTimestamp();
    if (!current) {
      tx.create(resourceEvidenceCreationDocRef(ctx.recordId), {
        ...creationBase(ctx),
        workingJson,
        workingBytes,
        workingRevision: 1,
        lastWorkingOperationId: input.operationId,
        lastWorkingPayloadHash: hash,
        runs: [],
        runsRevision: 0,
        createdAt: now,
        updatedAt: now,
      });
      return { workingRevision: 1, persisted: true, kind: "created" as const };
    }
    const next = currentRevision + 1;
    tx.update(resourceEvidenceWorkingUpdateDocRef(ctx.recordId), {
      workingJson,
      workingBytes,
      workingRevision: next,
      lastWorkingOperationId: input.operationId,
      lastWorkingPayloadHash: hash,
      updatedAt: now,
    });
    return { workingRevision: next, persisted: true, kind: "updated" as const };
  });

  safeLog(() =>
    log.info("resourceEvidence.workingSaved", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      outcome: outcome.kind,
      workingRevision: outcome.workingRevision,
      workingBytes,
    }),
  );
  return { workingRevision: outcome.workingRevision, persisted: outcome.persisted };
}

function operationConflict(): never {
  throw new PlatformError(
    "resourceEvidence.operationConflict",
    "This operation id was already used with a different request.",
  );
}

function creationBase(ctx: ResolvedEvidenceContext) {
  return {
    schemaVersion: RESOURCE_EVIDENCE_RECORD_SCHEMA_VERSION,
    recordId: ctx.recordId,
    ...ctx.ownership,
    ...ctx.binding,
    status: "working" as const,
    submitOperationId: null,
    submittedAt: null,
    evidenceEligibleAt: null,
  };
}

// ---------------------------------------------------------------------------
// Record a server-verified outcome run
// ---------------------------------------------------------------------------

export type RecordOutcomeRunResult = {
  readonly runsRevision: number;
  // "accepted": stored now. "replay": this operation already stored it.
  // "duplicate": the same flight (or identical parameters) is already
  // stored; nothing new was recorded and no credit changed.
  readonly disposition: "accepted" | "replay" | "duplicate";
  // Validator outcome codes the server recomputed inside the run's window.
  readonly outcomes: readonly string[];
  readonly truncated: boolean;
  // The flight was still going when the window ended: later missions are
  // neither credited nor refuted.
  readonly undetermined: boolean;
  readonly verifiedOutcomeIds: readonly string[];
};

const RECORD_RUN_ATTEMPTS = 3;

// Raised inside the append transaction when concurrent runs consumed budget
// this run's verification window assumed. The run is re-verified outside
// the transaction with a fresh allowance.
class AllowanceChanged extends Error {}

type KnownRun = { readonly kind: "replay" | "duplicate"; readonly run: StoredOutcomeRun };

// Settles a request against the stored runs without any computation.
function matchStoredRun(
  runs: readonly StoredOutcomeRun[],
  operationId: string,
  flightId: string,
  hash: string,
  reportedParametersJson: string,
): KnownRun | null {
  const sameOperation = runs.find((r) => r.operationId === operationId);
  if (sameOperation) {
    if (sameOperation.payloadHash !== hash) operationConflict();
    return { kind: "replay", run: sameOperation };
  }
  const sameFlight = runs.find((r) => r.flightId === flightId);
  if (sameFlight) {
    // A repeated terminal callback for one flight. Identical content is
    // acknowledged; different content for the same flight is not a new
    // flight and is refused.
    if (sameFlight.reportedParametersJson !== reportedParametersJson) {
      throw new PlatformError(
        "resourceEvidence.flightConflict",
        "This flight was already recorded with different parameters.",
      );
    }
    return { kind: "duplicate", run: sameFlight };
  }
  // Deterministic validators: identical parameters cannot add credit, so
  // they never consume capacity or budget.
  const sameParameters = runs.find((r) => r.reportedParametersJson === reportedParametersJson);
  return sameParameters ? { kind: "duplicate", run: sameParameters } : null;
}

function storedCostOf(runs: readonly StoredOutcomeRun[]): number {
  return runs.reduce((sum, r) => sum + r.cost, 0);
}

export async function recordResourceOutcomeRun(
  request: CallableRequest<unknown>,
  deps: ResourceEvidenceDeps,
): Promise<RecordOutcomeRunResult> {
  const actor = await assertActiveStudent(request);
  const input = parseRecordOutcomeRunRequest(request.data);
  const ctx = await resolveEvidenceContext(actor, input.assignmentId, deps);
  const { validatorId, validatorVersion } = definitionValidator(ctx.definition);
  const policy = resolveRunVerificationPolicy(validatorId, validatorVersion);
  if (!policy) {
    throw new PlatformError(
      "resourceEvidence.completionBindingUnavailable",
      "This validator cannot be persisted.",
    );
  }
  // Structural parse only (no computation): the request's identity.
  const reportedParse = policy.parse(input.parameters);
  if (!reportedParse.ok) invalidRun(`run.invalidParameters:0:${reportedParse.issue}`);
  const reportedParametersJson = canonicalJson(reportedParse.reported);
  const hash = payloadHash({ flightId: input.flightId, parameters: JSON.parse(reportedParametersJson) as unknown });

  for (let attempt = 1; ; attempt++) {
    // 1. Outside any transaction: settle replays and duplicates with no
    //    physics, then verify a new run within its allowance.
    const before = await resourceEvidenceDocRef(ctx.recordId).get();
    const stored = before.exists ? before.data() : undefined;
    if (stored) assertRecordMatchesContext(stored, ctx);
    const storedRuns = stored?.runs ?? [];
    let candidate: StoredOutcomeRun | null = null;
    if (!matchStoredRun(storedRuns, input.operationId, input.flightId, hash, reportedParametersJson)) {
      if (stored) assertWorking(stored);
      assertWritable(ctx);
      if (storedRuns.length >= RUN_VERIFICATION_LIMITS.runSlots) runCapacityReached();
      const allowance = nextRunAllowance(storedCostOf(storedRuns), storedRuns.length);
      const verification = policy.verify(input.parameters, allowance);
      if (!verification.ok) invalidRun(`run.invalidParameters:0:${verification.issue}`);
      candidate = {
        operationId: input.operationId,
        payloadHash: hash,
        flightId: input.flightId,
        validatorId,
        validatorVersion,
        reportedParametersJson,
        parametersJson: canonicalJson(verification.verified),
        truncated: verification.truncated,
        cost: verification.cost,
        outcomes: [...verification.outcomes],
        undetermined: verification.undetermined,
      };
    }

    try {
      // 2. Atomic append. Only re-reads and checks; no computation, so an
      //    automatic transaction retry is cheap.
      const outcome = await runFirestoreTransaction(async (tx) => {
        const snap = await tx.get(resourceEvidenceDocRef(ctx.recordId));
        const current = snap.exists ? snap.data() : undefined;
        if (current) assertRecordMatchesContext(current, ctx);
        const runs = current?.runs ?? [];
        const runsRevision = current?.runsRevision ?? 0;

        const known = matchStoredRun(runs, input.operationId, input.flightId, hash, reportedParametersJson);
        if (known?.kind === "replay") return { kind: "replay" as const, runs, runsRevision, stored: known.run };
        if (current) assertWorking(current);
        assertWritable(ctx);
        if (known) return { kind: "duplicate" as const, runs, runsRevision, stored: known.run };
        if (!candidate) throw new AllowanceChanged();

        // Capacity: slots stay reserved for declared outcomes not yet
        // verified, so failed or repeated launches can never block a
        // student from earning a remaining mission.
        const verified = verifiedOutcomeIdsOfRuns(ctx.definition, runs);
        const unverified = ctx.definition.outcomes.filter((o) => !verified.has(o.outcomeId)).length;
        const addsOutcome = declaredOutcomeIds(ctx.definition, validatorId, validatorVersion, candidate.outcomes).some(
          (id) => !verified.has(id),
        );
        const limit = RESOURCE_EVIDENCE_LIMITS.maxOutcomeRuns - (addsOutcome ? 0 : unverified);
        if (runs.length >= limit) runCapacityReached();
        // Budget: every remaining slot keeps its guaranteed floor.
        if (!appendKeepsInvariant(storedCostOf(runs), runs.length, candidate.cost)) throw new AllowanceChanged();

        const nextRuns = [...runs, candidate];
        const next = runsRevision + 1;
        const now = FieldValue.serverTimestamp();
        if (!current) {
          tx.create(resourceEvidenceCreationDocRef(ctx.recordId), {
            ...creationBase(ctx),
            workingJson: EMPTY_WORKING_JSON,
            workingBytes: Buffer.byteLength(EMPTY_WORKING_JSON, "utf8"),
            workingRevision: 0,
            lastWorkingOperationId: null,
            lastWorkingPayloadHash: null,
            runs: nextRuns,
            runsRevision: next,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          tx.update(resourceEvidenceRunsUpdateDocRef(ctx.recordId), {
            runs: nextRuns,
            runsRevision: next,
            updatedAt: now,
          });
        }
        return { kind: "accepted" as const, runs: nextRuns, runsRevision: next, stored: candidate };
      });

      safeLog(() =>
        log.info("resourceEvidence.runRecorded", {
          actorUserId: actor.uid,
          assignmentId: input.assignmentId,
          disposition: outcome.kind,
          runsRevision: outcome.runsRevision,
          runCount: outcome.runs.length,
          outcomes: outcome.stored.outcomes,
          cost: outcome.stored.cost,
          truncated: outcome.stored.truncated,
          undetermined: outcome.stored.undetermined,
        }),
      );
      return {
        runsRevision: outcome.runsRevision,
        disposition: outcome.kind,
        outcomes: outcome.stored.outcomes,
        truncated: outcome.stored.truncated,
        undetermined: outcome.stored.undetermined,
        verifiedOutcomeIds: [...verifiedOutcomeIdsOfRuns(ctx.definition, outcome.runs)],
      };
    } catch (err) {
      if (!(err instanceof AllowanceChanged)) throw err;
      if (attempt >= RECORD_RUN_ATTEMPTS) writeConflict({});
    }
  }
}

function runCapacityReached(): never {
  throw new PlatformError(
    "resourceEvidence.runCapacityReached",
    "No more runs can be recorded for this assignment unless they earn a new outcome.",
  );
}

function invalidRun(...issues: string[]): never {
  throw new PlatformError(
    "resourceEvidence.invalidEvidence",
    "The run is not valid evidence for this assignment.",
    undefined,
    { issues },
  );
}

// ---------------------------------------------------------------------------
// Submit evidence
// ---------------------------------------------------------------------------

export type SubmitEvidenceResult = {
  // false for an acknowledged retry of the submission that already landed.
  readonly persisted: boolean;
  readonly verifiedOutcomeIds: readonly string[];
};

export async function submitResourceEvidence(
  request: CallableRequest<unknown>,
  deps: ResourceEvidenceDeps,
): Promise<SubmitEvidenceResult> {
  const actor = await assertActiveStudent(request);
  const input = parseSubmitEvidenceRequest(request.data);
  const hash = payloadHash({
    expectedWorkingRevision: input.expectedWorkingRevision,
    expectedRunsRevision: input.expectedRunsRevision,
  });

  const ctx = await resolveEvidenceContext(actor, input.assignmentId, deps);
  const before = await resourceEvidenceDocRef(ctx.recordId).get();
  const record = before.exists ? before.data() : undefined;
  if (record) assertRecordMatchesContext(record, ctx);
  // A retry of a submission that already landed is acknowledged before the
  // write gates (the window may have closed since).
  if (record?.status === "submitted") return acknowledgeSubmission(record, ctx, input.operationId, hash);
  assertWritable(ctx);
  if (!record) {
    throw new PlatformError("resourceEvidence.notStarted", "There is no evidence to submit for this assignment.");
  }
  if (
    record.workingRevision !== input.expectedWorkingRevision ||
    record.runsRevision !== input.expectedRunsRevision
  ) {
    writeConflict({ workingRevision: record.workingRevision, runsRevision: record.runsRevision });
  }

  // Evaluate the exact stored content, outside the transaction, with the
  // certified RA-2 evaluator. The client sends no eligibility or outcome.
  const evidence = snapshotEvidence(ctx, parseWorking(record), record.runs);
  const result = evaluateCompletionEligibility(ctx.definition, evidence);
  if (result.status !== "evaluated") {
    // Stored content that no longer validates is a data fault, not a
    // student error.
    safeLog(() =>
      log.error("resourceEvidence.storedEvidenceInvalid", {
        actorUserId: actor.uid,
        assignmentId: input.assignmentId,
        status: result.status,
      }),
    );
    corrupt();
  }
  // Defense in depth: the stored runs must fit the RA-2 budget, so the
  // whole-snapshot recomputation never reaches its computation limit, and
  // its verified outcomes must equal the stored per-run outcomes.
  const storedVerified = verifiedOutcomeIdsOfRuns(ctx.definition, record.runs);
  if (
    storedCostOf(record.runs) > RUN_VERIFICATION_LIMITS.totalUnits ||
    result.undeterminedRunIndexes.length > 0 ||
    result.verifiedOutcomeIds.length !== storedVerified.size ||
    result.verifiedOutcomeIds.some((id) => !storedVerified.has(id))
  ) {
    corrupt();
  }
  if (!result.eligible) {
    throw new PlatformError(
      "resourceEvidence.requirementsUnmet",
      "Some required work is not finished yet.",
      undefined,
      { unmetRequiredStageIds: result.unmetRequiredStageIds },
    );
  }
  const snapshotJson = canonicalJson(evidence);

  const outcome = await runFirestoreTransaction(async (tx) => {
    const snap = await tx.get(resourceEvidenceDocRef(ctx.recordId));
    const current = snap.exists ? snap.data() : undefined;
    if (!current) return corrupt();
    assertRecordMatchesContext(current, ctx);
    if (current.status === "submitted") {
      return { kind: "acknowledged" as const, ack: acknowledgeSubmission(current, ctx, input.operationId, hash) };
    }
    if (
      current.workingRevision !== input.expectedWorkingRevision ||
      current.runsRevision !== input.expectedRunsRevision
    ) {
      writeConflict({ workingRevision: current.workingRevision, runsRevision: current.runsRevision });
    }
    const now = FieldValue.serverTimestamp();
    tx.create(resourceEvidenceSubmissionCreationDocRef(ctx.recordId), {
      schemaVersion: RESOURCE_EVIDENCE_RECORD_SCHEMA_VERSION,
      recordId: ctx.recordId,
      ...ctx.ownership,
      ...ctx.binding,
      operationId: input.operationId,
      snapshotJson,
      snapshotBytes: Buffer.byteLength(snapshotJson, "utf8"),
      workingRevision: current.workingRevision,
      runsRevision: current.runsRevision,
      eligible: true,
      verifiedOutcomeIds: [...result.verifiedOutcomeIds],
      undeterminedRunIndexes: current.runs.flatMap((r, i) => (r.undetermined ? [i] : [])),
      submittedAt: now,
    });
    tx.update(resourceEvidenceSubmitUpdateDocRef(ctx.recordId), {
      status: "submitted",
      submitOperationId: input.operationId,
      submittedAt: now,
      evidenceEligibleAt: now,
      updatedAt: now,
    });
    return { kind: "submitted" as const };
  });
  if (outcome.kind === "acknowledged") return outcome.ack;

  safeLog(() =>
    log.info("resourceEvidence.submitted", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      workingRevision: input.expectedWorkingRevision,
      runsRevision: input.expectedRunsRevision,
      verifiedOutcomeIds: result.verifiedOutcomeIds,
    }),
  );
  return { persisted: true, verifiedOutcomeIds: result.verifiedOutcomeIds };
}

function acknowledgeSubmission(
  record: ResourceEvidenceRecord,
  ctx: ResolvedEvidenceContext,
  operationId: string,
  hash: string,
): SubmitEvidenceResult {
  if (record.submitOperationId !== operationId) {
    throw new PlatformError("resourceEvidence.alreadySubmitted", "Evidence for this assignment was already submitted.");
  }
  const landed = payloadHash({
    expectedWorkingRevision: record.workingRevision,
    expectedRunsRevision: record.runsRevision,
  });
  if (landed !== hash) operationConflict();
  return { persisted: false, verifiedOutcomeIds: [...verifiedOutcomeIdsOfRuns(ctx.definition, record.runs)] };
}

// Reads the immutable submitted snapshot (for tests and the future teacher
// read path). Server use only.
export async function readSubmittedSnapshot(recordId: string) {
  const snap = await resourceEvidenceSubmissionDocRef(recordId).get();
  return snap.exists ? snap.data() : undefined;
}
