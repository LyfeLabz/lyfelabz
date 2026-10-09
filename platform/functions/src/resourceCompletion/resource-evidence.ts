import type { CompletionDefinition } from "./completion-definition";
import { isStableId } from "./completion-definition";
import { resolveOutcomeValidator } from "./outcome-validators";

// Resource evidence contract, schema version 1 (RA-2). Pure data only:
// nothing here authenticates, persists, or timestamps.
//
// Trust classes, kept structurally separate:
//
// 1. Student-authored evidence (`authored`): the student's own scientific
//    work. Checked for structure and presence only, never for quality.
// 2. Server-verified outcomes: NOT an input. The student submits only the
//    parameters of a run (`outcomeRuns`); outcomes are recomputed from them
//    by a registered validator. A client success, mission, completion, or
//    eligibility claim has no field to live in and is refused as an
//    unexpected field.
// 3. Self-reported attestations (`attestations`): accepted only when the
//    completion definition authorizes that attestation id.
// 4. Submission and eligibility state, plus ownership stamps: server
//    controlled (`ResourceEvidenceServerState`). Never part of the
//    client-authorable content and refused if a client payload carries
//    them.
//
// Evidence is independent of assessment attempts: it has no attempt,
// session, score, or quiz field, and evaluating it never reads one.

export const RESOURCE_EVIDENCE_SCHEMA_VERSION = 1;

export interface TextEvidenceValue {
  readonly evidenceId: string;
  readonly kind: "text";
  readonly text: string;
}

export type AuthoredEvidenceValue = TextEvidenceValue;

export interface OutcomeRunSubmission {
  readonly validatorId: string;
  readonly validatorVersion: number;
  // Validator-specific; parsed only by that validator.
  readonly parameters: unknown;
}

export interface AttestationRecord {
  readonly attestationId: string;
  readonly affirmed: true;
}

// Client-authorable evidence content. The binding fields name the frozen
// definition this content answers; a future persistence layer populates
// them from the server-held assignment, never from the client.
export interface ResourceEvidence {
  readonly schemaVersion: typeof RESOURCE_EVIDENCE_SCHEMA_VERSION;
  readonly resourceId: string;
  readonly assessmentRevisionId: string;
  readonly definitionVersion: number;
  readonly authored: readonly AuthoredEvidenceValue[];
  readonly outcomeRuns: readonly OutcomeRunSubmission[];
  readonly attestations: readonly AttestationRecord[];
}

// Future persistence shape for the server-controlled side of an evidence
// record. Declared so the boundary is explicit; RA-2 creates none of it.
// Timestamps are opaque server values (ISO strings here, server timestamps
// when stored).
export interface ResourceEvidenceServerState {
  readonly ownership: {
    readonly studentUid: string;
    readonly assignmentId: string;
    readonly classId: string;
    readonly schoolId: string;
    readonly districtId: string;
  };
  readonly submission:
    | { readonly status: "draft" }
    | {
        readonly status: "submitted";
        readonly submittedAt: string;
        // The frozen content eligibility was evaluated against.
        readonly snapshot: ResourceEvidence;
      };
  readonly eligibility: { readonly eligibleAt: string | null };
}

// Field names that belong to the server side and must never arrive inside
// client-authorable content.
export const SERVER_CONTROLLED_EVIDENCE_FIELDS: readonly string[] = Object.freeze([
  "ownership",
  "studentUid",
  "assignmentId",
  "classId",
  "schoolId",
  "districtId",
  "submission",
  "submittedAt",
  "eligibility",
  "eligible",
  "eligibleAt",
  "completed",
  "completedAt",
]);

export const RESOURCE_EVIDENCE_LIMITS = Object.freeze({
  maxAuthoredItems: 32,
  maxTextCharacters: 20_000,
  maxOutcomeRuns: 50,
  maxAttestations: 8,
  // Total validator computation per parse, shared by every run in order.
  // A ceiling on server work, not a claim that later outcomes cannot occur.
  // For Gravity Wells one unit is one integration step (one animation frame
  // of flight): 4,000,000 is about 18.5 hours of flight at 60 fps (4.6 hours
  // at 240 fps), measured at roughly 65 ms of computation. A loop call that
  // only detects the end costs no step, but each run has at most one such
  // call and runs are capped at maxOutcomeRuns, so no call is unbounded.
  maxComputationUnits: 4_000_000,
});

// Outcomes a validator recomputed for one accepted run. Produced only by
// `parseResourceEvidence`; never accepted as input.
export interface VerifiedRunOutcomes {
  readonly validatorId: string;
  readonly validatorVersion: number;
  readonly outcomes: readonly string[];
  // The computation budget ran out before this run's outcome was known.
  // Not a failure; missions beyond the budget are simply not credited.
  readonly undetermined: boolean;
}

export type ResourceEvidenceParse =
  | {
      readonly ok: true;
      readonly evidence: ResourceEvidence;
      // Index-aligned with `evidence.outcomeRuns`.
      readonly verifiedRuns: readonly VerifiedRunOutcomes[];
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((k) => keys.includes(k));
}

// Strict parse of client-authorable evidence against a validated
// definition. Binding agreement is checked by the evaluator, not here.
export function parseResourceEvidence(
  raw: unknown,
  definition: CompletionDefinition,
): ResourceEvidenceParse {
  const issues: string[] = [];
  const fail = (): ResourceEvidenceParse => ({ ok: false, issues: Object.freeze(issues.slice()) });

  if (!isPlainObject(raw)) {
    issues.push("evidence.malformed");
    return fail();
  }
  for (const key of Object.keys(raw)) {
    if (SERVER_CONTROLLED_EVIDENCE_FIELDS.includes(key)) issues.push(`evidence.serverControlledField:${key}`);
  }
  if (issues.length > 0) return fail();
  if (raw.schemaVersion !== RESOURCE_EVIDENCE_SCHEMA_VERSION) {
    issues.push("evidence.unsupportedSchemaVersion");
    return fail();
  }
  const keys = [
    "schemaVersion",
    "resourceId",
    "assessmentRevisionId",
    "definitionVersion",
    "authored",
    "outcomeRuns",
    "attestations",
  ];
  if (!hasExactKeys(raw, keys)) {
    issues.push("evidence.unexpectedFields");
    return fail();
  }
  const { resourceId, assessmentRevisionId, definitionVersion, authored, outcomeRuns, attestations } = raw;
  if (
    typeof resourceId !== "string" ||
    typeof assessmentRevisionId !== "string" ||
    typeof definitionVersion !== "number" ||
    !Array.isArray(authored) ||
    !Array.isArray(outcomeRuns) ||
    !Array.isArray(attestations)
  ) {
    issues.push("evidence.malformed");
    return fail();
  }
  const L = RESOURCE_EVIDENCE_LIMITS;
  if (
    authored.length > L.maxAuthoredItems ||
    outcomeRuns.length > L.maxOutcomeRuns ||
    attestations.length > L.maxAttestations
  ) {
    issues.push("evidence.tooLarge");
    return fail();
  }

  const declaredEvidence = new Map(definition.evidence.map((e) => [e.evidenceId, e]));
  const seenAuthored = new Set<string>();
  const authoredOut: AuthoredEvidenceValue[] = [];
  for (const item of authored as unknown[]) {
    if (!isPlainObject(item) || !hasExactKeys(item, ["evidenceId", "kind", "text"])) {
      issues.push("authored.malformed");
      continue;
    }
    const { evidenceId, kind, text } = item;
    if (!isStableId(evidenceId) || !declaredEvidence.has(evidenceId)) {
      issues.push(`authored.undeclared:${String(evidenceId)}`);
      continue;
    }
    if (seenAuthored.has(evidenceId)) issues.push(`authored.duplicate:${evidenceId}`);
    seenAuthored.add(evidenceId);
    if (kind !== declaredEvidence.get(evidenceId)?.kind) {
      issues.push(`authored.kindMismatch:${evidenceId}`);
      continue;
    }
    if (typeof text !== "string" || text.length > L.maxTextCharacters) {
      issues.push(`authored.invalidText:${evidenceId}`);
      continue;
    }
    authoredOut.push(Object.freeze({ evidenceId, kind: "text", text }));
  }

  // Runs may only use validators the definition names.
  const allowedValidators = new Set(
    definition.outcomes.map((o) => `${o.validatorId}@${o.validatorVersion}`),
  );
  const runsOut: OutcomeRunSubmission[] = [];
  const verifiedRuns: VerifiedRunOutcomes[] = [];
  let remainingBudget = L.maxComputationUnits;
  (outcomeRuns as unknown[]).forEach((run, index) => {
    if (!isPlainObject(run) || !hasExactKeys(run, ["validatorId", "validatorVersion", "parameters"])) {
      issues.push(`run.malformed:${index}`);
      return;
    }
    const { validatorId, validatorVersion, parameters } = run;
    if (
      typeof validatorId !== "string" ||
      typeof validatorVersion !== "number" ||
      !allowedValidators.has(`${validatorId}@${validatorVersion}`)
    ) {
      issues.push(`run.validatorNotInDefinition:${index}`);
      return;
    }
    const validator = resolveOutcomeValidator(validatorId, validatorVersion);
    const check = validator?.verify(parameters, remainingBudget);
    if (!check || !check.valid) {
      issues.push(`run.invalidParameters:${index}:${check ? check.issue : "unknownValidator"}`);
      return;
    }
    remainingBudget -= Math.min(Math.max(check.cost, 0), remainingBudget);
    // The snapshot keeps the validator's detached copy, never the caller's
    // object.
    runsOut.push(Object.freeze({ validatorId, validatorVersion, parameters: check.normalizedParameters }));
    verifiedRuns.push(
      Object.freeze({
        validatorId,
        validatorVersion,
        outcomes: Object.freeze(check.outcomes.slice()),
        undetermined: check.undetermined,
      }),
    );
  });

  const authorized = new Set(definition.attestations.map((a) => a.attestationId));
  const seenAttestations = new Set<string>();
  const attestationsOut: AttestationRecord[] = [];
  for (const a of attestations as unknown[]) {
    if (!isPlainObject(a) || !hasExactKeys(a, ["attestationId", "affirmed"]) || a.affirmed !== true) {
      issues.push("attestation.malformed");
      continue;
    }
    const { attestationId } = a;
    if (typeof attestationId !== "string" || !authorized.has(attestationId)) {
      issues.push(`attestation.notAuthorized:${String(attestationId)}`);
      continue;
    }
    if (seenAttestations.has(attestationId)) issues.push(`attestation.duplicate:${attestationId}`);
    seenAttestations.add(attestationId);
    attestationsOut.push(Object.freeze({ attestationId, affirmed: true }));
  }

  if (issues.length > 0) return fail();
  return {
    ok: true,
    evidence: Object.freeze({
      schemaVersion: RESOURCE_EVIDENCE_SCHEMA_VERSION,
      resourceId,
      assessmentRevisionId,
      definitionVersion,
      authored: Object.freeze(authoredOut),
      outcomeRuns: Object.freeze(runsOut),
      attestations: Object.freeze(attestationsOut),
    }),
    verifiedRuns: Object.freeze(verifiedRuns),
  };
}
