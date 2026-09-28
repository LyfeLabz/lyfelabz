/*
 * Differentiated-presentation publication state machine (F5.2 §6.8, Slice 3).
 *
 * This module is the SINGLE place the current-presentation index pointer is
 * advanced. It is a pure orchestrator: every side effect (loading the trusted
 * retained revision, deploying Hosting, fetching hosted bytes, hashing,
 * writing the Firestore index) is an injected port, so the whole machine is
 * unit-testable with fakes and does NOT import firebase-admin, fs, crypto, or
 * fetch. The thin CLI (`../scripts/publish-variant`) wires the real ports.
 *
 * INDEX-LAST GUARANTEE (§6.8, load-bearing)
 * -----------------------------------------
 * The machine runs strictly staged operations, each a gate for the next:
 *
 *   LOCAL_VERIFIED -> HOSTING_DEPLOYED -> HOSTED_BYTES_VERIFIED -> INDEX_UPDATED
 *
 * `writeIndexActivate` is invoked at exactly ONE call site - the final
 * statement of `publishRetainedRevision` - and is reachable only after the
 * hosted-byte liveness stage returns ok. Any earlier stage failing returns a
 * failure WITHOUT touching the index (`indexAdvanced: false`). The index can
 * therefore never reference an artifact that failed or skipped liveness
 * verification (the §6.8 invariant + suite P).
 *
 * CONCURRENCY (P5.1)
 * ------------------
 * There is deliberately NO compare-and-set / publication lock. Two valid,
 * liveness-verified revisions may race; whichever writes the index last ends
 * current, and both artifacts remain retained. An UNVERIFIED revision can
 * never win because the index write is gated by liveness.
 *
 * F5.3 SLICE 9C-2 (addendum 21.7; owner rulings 2026-09-28)
 * ---------------------------------------------------------
 * Coverage is revision-scoped. The ONLY document written is
 * `presentationVariants/{lessonSlug}__{variantKey}__r{N}` for the assessment
 * revision the retained revision covers; the legacy unscoped document is
 * read-only compatibility state and is never written (there is no port for
 * it). The covered revision comes from the loader's provenance (certified AP
 * record, else the manifest's explicit `assessmentRevisionId`, else the
 * pinned legacy-r1 artifact) and must be a DEPLOYED revision, not
 * necessarily the lesson's current one.
 *   - `publish` is create-only: it creates the scoped record, or reconciles
 *     an identical one with no write; any other existing record is refused
 *     (never overwritten). This supersedes the P5.1 "last publish wins"
 *     pointer race for new publications.
 *   - `rollback` is the explicit repoint: it may repoint (or re-activate) the
 *     scoped record of the SAME lesson, variant key, and revision to another
 *     retained, live revision.
 *   - `retire` names the revision explicitly and flips only that scoped record.
 * Everything knowable locally (provenance, self-consistency, agreement with
 * the shared 9C-1 read evaluator, deployment, and a preflight read of the
 * existing scoped record) is checked at LOCAL_VERIFIED, before any Hosting
 * or Firestore side effect. The final write re-checks the existing record
 * transactionally.
 *
 * FAILURE / RETENTION
 * -------------------
 * The machine never deletes an artifact or a manifest entry. A publication
 * failure leaves the immutable artifact + manifest entry retained and the
 * index on its prior eligible revision (or absent); a later retry may run the
 * machine again (§ publishing-failure contract).
 */

import {
  assertScopedActivateWriteConsistent,
  presentationVariantScopedIndexDocId,
} from "../shared/types/presentation-variant";
import { canonicalJson } from "../shared/types/assessment-presentation";
import { evaluateScopedRecord, frozenRevisionOrdinal } from "../shared/presentation/revision-coverage";

export type PublicationStage =
  | "LOCAL_VERIFIED"
  | "HOSTING_DEPLOYED"
  | "HOSTED_BYTES_VERIFIED"
  // F5.3 Slice 5: only for a revision bound to an assessment presentation.
  | "ASSESSMENT_PRESENTATION_RECORDED"
  | "INDEX_UPDATED";

// F5.3 Slice 5: the assessment-presentation binding of a retained revision,
// reconciled by the loader from the manifest entry, the certified retained
// record, and the binding block embedded in the artifact bytes.
export type RetainedAssessmentBinding = {
  readonly assessmentRevisionId: string;
  readonly assessmentPresentationRevisionId: string;
  // The immutable record (canonical JSON content) to publish.
  readonly record: Readonly<Record<string, unknown>>;
};

// One immutable, retained build of (lessonSlug, variantKey), as reconciled
// from the trusted append-only manifest. Every field is server/manifest
// derived - never taken from an untrusted caller (§ path-and-manifest-trust).
export type RetainedRevision = {
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly presentationRevisionId: string;
  // Relative posix path, the §5.2 opaque formula
  // (app/lessons/variants/lesson_{slug}__{revid}.html).
  readonly path: string;
  // Full 64-hex SHA-256 of the retained bytes (the manifest sha256).
  readonly sha256: string;
  // F5.3 Slice 5: present iff the manifest entry binds an assessment
  // presentation. Absent keeps the F5.2 meaning.
  readonly assessmentBinding?: RetainedAssessmentBinding;
  // F5.3 Slice 9C-2: the assessment revision this revision covers, resolved by
  // the loader under S9-D7, and how it was established.
  readonly assessmentRevisionId: string;
  readonly assessmentRevisionSource: "assessmentPresentation" | "declared" | "legacyR1";
};

// F5.3 Slice 9C-2: the protected content of a scoped coverage record (the
// written document adds only `updatedAt` and `publishedBy` attribution).
export type ScopedCoverageRecord = {
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly currentPresentationRevisionId: string;
  readonly currentPath: string;
  readonly contentSha256: string;
  readonly status: "active";
  readonly assessmentRevisionId: string;
  readonly assessmentPresentationRevisionId?: string;
};

export type ScopedCoverageWriteAction = "create" | "reconcile" | "repoint";

// F5.3 Slice 9C-2: the identity of one scoped coverage document.
export type ScopedCoverageKey = {
  readonly docId: string;
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly revisionOrdinal: number;
};

export type PublicationMode = "publish" | "rollback";

export type HostedFetchResult =
  | {
      readonly ok: true;
      readonly status: number;
      readonly redirected: boolean;
      readonly bytes: Buffer | Uint8Array | string;
    }
  | { readonly ok: false; readonly error: string };

// ------------------------------- Ports -------------------------------------

// Reconciles the requested identity against the trusted manifest and the
// committed tree: the manifest itself must pass retention verification, the
// requested (lessonSlug, variantKey, presentationRevisionId) must be a
// retained entry, and the local artifact bytes must hash to the manifest
// sha256. Returns the trusted revision or a failure reason.
export type LoadRetainedRevisionPort = (args: {
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly presentationRevisionId: string;
}) => Promise<
  | { readonly ok: true; readonly revision: RetainedRevision }
  | { readonly ok: false; readonly error: string }
>;

// Deploys Firebase Hosting so a freshly published artifact becomes
// application-retrievable (§6.8 step 7). Only invoked for mode "publish";
// rollback repoints to an already-deployed artifact and re-proves it via
// liveness instead.
export type DeployHostingPort = () => Promise<
  { readonly ok: true } | { readonly ok: false; readonly error: string }
>;

// Fetches the EXACT hosted revision path (§6.8 step 8). Must report the HTTP
// status, whether a redirect occurred, and the raw response bytes.
export type FetchHostedPort = (relPath: string) => Promise<HostedFetchResult>;

// Full 64-hex SHA-256 of the given bytes. Injected so the pure module needs
// no crypto import; the CLI wires Node's crypto (the same algorithm that
// produced the manifest sha256).
export type HashBytesPort = (bytes: Buffer | Uint8Array | string) => string;

// F5.3 Slice 9C-2: reads the scoped coverage document by id (preflight, and
// retirement), or reports it absent.
export type ReadScopedCoveragePort = (key: ScopedCoverageKey) => Promise<
  { readonly exists: false } | { readonly exists: true; readonly data: unknown }
>;

// F5.3 Slice 9C-2: the single coverage write (§6.8 step 9). The real port runs
// a transaction: read the scoped document, decide with
// `planScopedCoverageWrite`, then create, do nothing, or (rollback only)
// repoint. Server-owned attribution is passed through, never client input.
export type WriteScopedCoveragePort = (args: {
  readonly key: ScopedCoverageKey;
  readonly record: ScopedCoverageRecord;
  readonly publishedBy: string;
  readonly mode: PublicationMode;
}) => Promise<
  { readonly ok: true; readonly action: ScopedCoverageWriteAction } | { readonly ok: false; readonly error: string }
>;

// F5.3 Slice 9C-2: whether an assessment revision is DEPLOYED
// (`assessmentRevisions/{id}` exists with this identity). Not whether it is
// the lesson's current revision (S9-U2).
export type IsAssessmentRevisionDeployedPort = (assessmentRevisionId: string) => Promise<boolean>;

export type LogPort = (message: string) => void;

// F5.3 Slice 5: create `assessmentPresentations/{id}` with exactly `record`,
// or verify an existing document is identical (never update or delete).
export type EnsureAssessmentPresentationPort = (
  assessmentPresentationRevisionId: string,
  record: Readonly<Record<string, unknown>>,
) => Promise<{ readonly ok: true; readonly created: boolean } | { readonly ok: false; readonly error: string }>;

export type PublishDeps = {
  readonly loadRetainedRevision: LoadRetainedRevisionPort;
  readonly deployHosting: DeployHostingPort;
  readonly fetchHosted: FetchHostedPort;
  readonly hashBytes: HashBytesPort;
  readonly isAssessmentRevisionDeployed: IsAssessmentRevisionDeployedPort;
  readonly readScopedCoverage: ReadScopedCoveragePort;
  readonly writeScopedCoverage: WriteScopedCoveragePort;
  // Required only for a bound revision; a bound revision without it fails
  // closed at LOCAL_VERIFIED.
  readonly ensureAssessmentPresentation?: EnsureAssessmentPresentationPort;
  readonly log?: LogPort;
};

export type PublishInput = {
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly presentationRevisionId: string;
  readonly publishedBy: string;
  readonly mode: PublicationMode;
};

export type PublishResult =
  | {
      readonly ok: true;
      readonly mode: PublicationMode;
      readonly revision: RetainedRevision;
      readonly stagesCompleted: readonly PublicationStage[];
      readonly indexAdvanced: true;
      // F5.3 Slice 9C-2: the scoped document written and what happened to it.
      readonly coverage: { readonly docId: string; readonly action: ScopedCoverageWriteAction };
    }
  | {
      readonly ok: false;
      readonly failedStage: PublicationStage | "INPUT";
      readonly error: string;
      readonly stagesCompleted: readonly PublicationStage[];
      // Always false: the index write is the last statement and is only
      // reached on full success. An INDEX_UPDATED-stage failure means the
      // atomic set() did not apply, so the prior pointer remains current.
      readonly indexAdvanced: false;
    };

const SHA256_RE = /^[0-9a-f]{64}$/;

// Verifies the hosted response against the trusted revision. Fail-closed:
// only an exact-byte match at HTTP 200 with no redirect is accepted as proof
// the retained artifact is live. A 200 alone is NOT enough - an SPA fallback
// returning /app/index.html, a stale file, a truncated/modified artifact, or
// a redirect to unrelated content all fail here because their bytes do not
// hash to the manifest sha256 (or they are not a direct 200).
function verifyHostedBytes(
  fetchResult: HostedFetchResult,
  revision: RetainedRevision,
  hashBytes: HashBytesPort,
): { ok: true } | { ok: false; error: string } {
  if (!fetchResult.ok) {
    return { ok: false, error: `hosted fetch failed: ${fetchResult.error}` };
  }
  if (fetchResult.status !== 200) {
    return {
      ok: false,
      error: `hosted fetch returned HTTP ${String(fetchResult.status)} (expected 200) for ${revision.path}`,
    };
  }
  if (fetchResult.redirected) {
    return {
      ok: false,
      error: `hosted fetch for ${revision.path} was redirected; a redirect is not proof of the exact retained artifact (fail-closed)`,
    };
  }
  const { bytes } = fetchResult;
  const empty =
    bytes == null ||
    (typeof bytes === "string" && bytes.length === 0) ||
    ((bytes instanceof Uint8Array || Buffer.isBuffer(bytes)) && bytes.length === 0);
  if (empty) {
    return { ok: false, error: `hosted response for ${revision.path} was empty` };
  }
  const actualSha = hashBytes(bytes);
  if (!SHA256_RE.test(actualSha)) {
    return { ok: false, error: `hashBytes port returned a non-64-hex digest: ${actualSha}` };
  }
  if (actualSha !== revision.sha256) {
    return {
      ok: false,
      error:
        `hosted bytes for ${revision.path} hash to ${actualSha} but the manifest records ${revision.sha256} ` +
        "(SPA fallback, stale file, truncation, or modification) - refusing to advance the index",
    };
  }
  // Redundant with the hash match but asserted explicitly per §hosted-byte
  // liveness verification: the resulting revision identity must agree.
  if (`pr${actualSha}` !== revision.presentationRevisionId) {
    return {
      ok: false,
      error: `derived revision id pr${actualSha} disagrees with expected ${revision.presentationRevisionId}`,
    };
  }
  return { ok: true };
}

// Publish (or roll back to) a retained revision, advancing the current index
// pointer ONLY after hosted-byte liveness verification. See the file header
// for the index-last guarantee.
// F5.3 Slice 5: every check a bound revision must pass before any Hosting or
// Firestore side effect. Returns an error message, or null when publishable.
// (Synchronous since F5.3 Slice 9C-2: the deployed check applies to every
// revision and runs in the machine.)
function verifyBindingForPublication(
  binding: RetainedAssessmentBinding,
  revision: RetainedRevision,
  deps: PublishDeps,
): string | null {
  if (deps.ensureAssessmentPresentation === undefined) {
    return "a revision bound to an assessment presentation needs the assessment-presentation publication ports";
  }
  if (binding.assessmentRevisionId !== revision.assessmentRevisionId) {
    return `manifest binding maps to ${binding.assessmentRevisionId}, but the revision's provenance is ${revision.assessmentRevisionId}`;
  }
  let actualId: string;
  try {
    actualId = `ap${deps.hashBytes(canonicalJson(binding.record))}`;
  } catch (err) {
    return `assessment presentation record is not canonical: ${(err as Error).message}`;
  }
  if (actualId !== binding.assessmentPresentationRevisionId) {
    return `assessment presentation record hashes to ${actualId}, not ${binding.assessmentPresentationRevisionId}`;
  }
  if (binding.record.lessonSlug !== revision.lessonSlug) {
    return `assessment presentation belongs to lesson "${String(binding.record.lessonSlug)}", not "${revision.lessonSlug}"`;
  }
  if (binding.record.assessmentRevisionId !== binding.assessmentRevisionId) {
    return `assessment presentation maps to ${String(binding.record.assessmentRevisionId)}, not ${binding.assessmentRevisionId}`;
  }
  return null;
}

// F5.3 Slice 9C-2: whether an `assessmentRevisions/{id}` document proves the
// revision is deployed with exactly this identity (pure; the CLI reads it).
export function isDeployedRevisionRecord(assessmentRevisionId: string, data: unknown): boolean {
  const match = /^assessment_([a-z0-9]+(?:-[a-z0-9]+)*)__r([1-9][0-9]*)$/.exec(assessmentRevisionId);
  if (match === null || data === null || typeof data !== "object") return false;
  const doc = data as Record<string, unknown>;
  return (
    doc.assessmentId === `assessment_${match[1]}` &&
    doc.activityId === match[1] &&
    doc.revisionOrdinal === Number(match[2])
  );
}

// F5.3 Slice 9C-2: the scoped document id and exact record a retained revision
// publishes. Throws when the revision's identity cannot form one.
export function scopedCoverageFor(revision: RetainedRevision): { readonly key: ScopedCoverageKey; readonly record: ScopedCoverageRecord } {
  const ordinal = frozenRevisionOrdinal(revision.lessonSlug, revision.assessmentRevisionId);
  if (ordinal === undefined) {
    throw new Error(`assessment revision ${String(revision.assessmentRevisionId)} is not a revision of assessment_${revision.lessonSlug}`);
  }
  const apId = revision.assessmentBinding?.assessmentPresentationRevisionId;
  const record: ScopedCoverageRecord = {
    lessonSlug: revision.lessonSlug,
    variantKey: revision.variantKey,
    currentPresentationRevisionId: revision.presentationRevisionId,
    currentPath: revision.path,
    contentSha256: revision.sha256,
    status: "active",
    assessmentRevisionId: revision.assessmentRevisionId,
    ...(apId !== undefined ? { assessmentPresentationRevisionId: apId } : {}),
  };
  const docId = presentationVariantScopedIndexDocId(revision.lessonSlug, revision.variantKey, ordinal);
  assertScopedActivateWriteConsistent(docId, record);
  return {
    key: { docId, lessonSlug: revision.lessonSlug, variantKey: revision.variantKey, revisionOrdinal: ordinal },
    record,
  };
}

// F5.3 Slice 9C-2: the record must read back through the SHARED 9C-1
// evaluator as active coverage of exactly this pair and binding, so writes
// and reads cannot drift. Returns an error or null.
export function verifyReadBackAgreement(record: ScopedCoverageRecord): string | null {
  const read = evaluateScopedRecord(record, record.lessonSlug, record.variantKey, record.assessmentRevisionId);
  const apId = record.assessmentPresentationRevisionId;
  const agrees =
    read.kind === "active" &&
    read.presentationRevisionId === record.currentPresentationRevisionId &&
    read.path === record.currentPath &&
    (apId === undefined
      ? read.assessmentBinding === undefined
      : read.assessmentBinding?.assessmentPresentationRevisionId === apId &&
        read.assessmentBinding.assessmentRevisionId === record.assessmentRevisionId);
  return agrees ? null : `the scoped record would not read back as this coverage (${read.kind}); refusing to write it`;
}

function sameCoverage(existing: Record<string, unknown>, record: ScopedCoverageRecord): boolean {
  return (
    existing.status === "active" &&
    existing.lessonSlug === record.lessonSlug &&
    existing.variantKey === record.variantKey &&
    existing.currentPresentationRevisionId === record.currentPresentationRevisionId &&
    existing.currentPath === record.currentPath &&
    existing.contentSha256 === record.contentSha256 &&
    existing.assessmentRevisionId === record.assessmentRevisionId &&
    existing.assessmentPresentationRevisionId === record.assessmentPresentationRevisionId
  );
}

// F5.3 Slice 9C-2: the one decision for a scoped coverage write, shared by the
// preflight and the real transactional port (owner ruling: create-only
// publish; explicit rollback repoint).
export function planScopedCoverageWrite(
  existing: unknown,
  record: ScopedCoverageRecord,
  mode: PublicationMode,
): { readonly ok: true; readonly action: ScopedCoverageWriteAction } | { readonly ok: false; readonly error: string } {
  if (existing === undefined) return { ok: true, action: "create" };
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
    return { ok: false, error: "the existing scoped coverage record is not an object; refusing to overwrite it" };
  }
  const doc = existing as Record<string, unknown>;
  if (
    doc.lessonSlug !== record.lessonSlug ||
    doc.variantKey !== record.variantKey ||
    doc.assessmentRevisionId !== record.assessmentRevisionId
  ) {
    return { ok: false, error: "the existing scoped coverage record names another lesson, variant key, or assessment revision; refusing to overwrite it" };
  }
  if (sameCoverage(doc, record)) return { ok: true, action: "reconcile" };
  if (mode === "rollback") return { ok: true, action: "repoint" };
  return {
    ok: false,
    error:
      `the scoped coverage record already exists with different coverage (${String(doc.currentPresentationRevisionId)}, ` +
      `status ${String(doc.status)}); publish never overwrites it - use --op=rollback to repoint or re-activate`,
  };
}

// F5.3 Slice 5: pure reconciliation of a retained revision's assessment
// binding. The loader supplies the manifest entry, the binding block parsed
// from the artifact bytes (null when the artifact carries none), and the
// certification result of the one Slice 3 check (null for an unbound entry).
// Manifest, artifact, and certified record must all agree exactly.
export function reconcileAssessmentBinding(args: {
  readonly entry: {
    readonly lessonSlug: string;
    readonly assessmentRevisionId?: string;
    readonly assessmentPresentationRevisionId?: string;
  };
  readonly artifactBindingBlock: unknown;
  readonly certification: { readonly record: unknown; readonly failures: readonly string[] } | null;
}): { readonly ok: true; readonly binding?: RetainedAssessmentBinding } | { readonly ok: false; readonly error: string } {
  const { entry, artifactBindingBlock, certification } = args;
  // F5.3 Slice 9C-2: an entry is bound iff it names an assessment
  // presentation; an unbound entry may record its revision alone.
  const bound = entry.assessmentPresentationRevisionId !== undefined;
  if (!bound) {
    if (artifactBindingBlock !== null && artifactBindingBlock !== undefined) {
      return { ok: false, error: "the artifact carries an assessment-presentation binding but its manifest entry is unbound" };
    }
    return { ok: true };
  }
  if (
    typeof entry.assessmentPresentationRevisionId !== "string" ||
    typeof entry.assessmentRevisionId !== "string"
  ) {
    return { ok: false, error: "the manifest entry names an assessment presentation without its assessment revision" };
  }
  if (certification === null || certification.failures.length > 0 || certification.record === null) {
    const detail = certification ? certification.failures.join("; ") : "no certification result";
    return { ok: false, error: `assessment presentation ${entry.assessmentPresentationRevisionId} is not certified for publication: ${detail}` };
  }
  const record = certification.record as { readonly items?: ReadonlyArray<{ readonly itemId: string; readonly displayedOptions: ReadonlyArray<{ readonly optionId: string }> }> } & Record<string, unknown>;
  const expectedBlock = {
    schemaVersion: 1,
    lessonSlug: entry.lessonSlug,
    assessmentRevisionId: entry.assessmentRevisionId,
    assessmentPresentationRevisionId: entry.assessmentPresentationRevisionId,
    items: (record.items ?? []).map((item) => ({
      itemId: item.itemId,
      optionIds: item.displayedOptions.map((o) => o.optionId),
    })),
  };
  let blockMatches = false;
  try {
    blockMatches =
      artifactBindingBlock !== null &&
      artifactBindingBlock !== undefined &&
      canonicalJson(artifactBindingBlock) === canonicalJson(expectedBlock);
  } catch {
    blockMatches = false;
  }
  if (!blockMatches) {
    return { ok: false, error: "the artifact's assessment-presentation binding does not match its manifest entry and certified record" };
  }
  return {
    ok: true,
    binding: {
      assessmentRevisionId: entry.assessmentRevisionId,
      assessmentPresentationRevisionId: entry.assessmentPresentationRevisionId,
      record,
    },
  };
}

export async function publishRetainedRevision(
  input: PublishInput,
  deps: PublishDeps,
): Promise<PublishResult> {
  const log: LogPort = deps.log ?? (() => undefined);
  const stagesCompleted: PublicationStage[] = [];

  if (typeof input.publishedBy !== "string" || input.publishedBy.trim().length === 0) {
    return {
      ok: false,
      failedStage: "INPUT",
      error: "publishedBy (server-owned operator attribution) is required and must be non-empty",
      stagesCompleted,
      indexAdvanced: false,
    };
  }
  if (input.mode !== "publish" && input.mode !== "rollback") {
    return {
      ok: false,
      failedStage: "INPUT",
      error: `unknown publication mode: ${String(input.mode)}`,
      stagesCompleted,
      indexAdvanced: false,
    };
  }

  // -------- Stage 1: LOCAL_VERIFIED (steps 1-6 already done in Slice 2) -----
  const loaded = await deps.loadRetainedRevision({
    lessonSlug: input.lessonSlug,
    variantKey: input.variantKey,
    presentationRevisionId: input.presentationRevisionId,
  });
  if (!loaded.ok) {
    log(`[publish] LOCAL_VERIFIED failed: ${loaded.error}`);
    return {
      ok: false,
      failedStage: "LOCAL_VERIFIED",
      error: loaded.error,
      stagesCompleted,
      indexAdvanced: false,
    };
  }
  const revision = loaded.revision;
  const localFail = (error: string): PublishResult => {
    log(`[publish] LOCAL_VERIFIED failed: ${error}`);
    return { ok: false, failedStage: "LOCAL_VERIFIED", error, stagesCompleted, indexAdvanced: false };
  };
  // Defense in depth: even though every value came from the trusted manifest
  // and provenance, refuse to proceed unless the scoped record we would write
  // is self-consistent (including its document id) and reads back through the
  // shared evaluator as exactly this coverage.
  let coverage: { readonly key: ScopedCoverageKey; readonly record: ScopedCoverageRecord };
  try {
    coverage = scopedCoverageFor(revision);
  } catch (err) {
    return localFail(`self-consistency: ${(err as Error).message}`);
  }
  const readBack = verifyReadBackAgreement(coverage.record);
  if (readBack !== null) return localFail(readBack);
  const binding = revision.assessmentBinding;
  if (binding !== undefined) {
    const bindingError = verifyBindingForPublication(binding, revision, deps);
    if (bindingError !== null) return localFail(`assessment presentation: ${bindingError}`);
  }
  // S9-U2: coverage only for a DEPLOYED revision (not necessarily current).
  let deployed: boolean;
  try {
    deployed = await deps.isAssessmentRevisionDeployed(revision.assessmentRevisionId);
  } catch (err) {
    return localFail(`could not read whether ${revision.assessmentRevisionId} is deployed: ${(err as Error).message}`);
  }
  if (!deployed) {
    return localFail(`assessment revision ${revision.assessmentRevisionId} is not deployed; coverage is never published for an undeployed revision`);
  }
  // Preflight the existing scoped record so a refusal happens before any
  // Hosting or Firestore side effect (re-checked transactionally at the write).
  let existing: Awaited<ReturnType<ReadScopedCoveragePort>>;
  try {
    existing = await deps.readScopedCoverage(coverage.key);
  } catch (err) {
    return localFail(`could not read ${coverage.key.docId}: ${(err as Error).message}`);
  }
  const plan = planScopedCoverageWrite(existing.exists ? existing.data : undefined, coverage.record, input.mode);
  if (!plan.ok) return localFail(`${coverage.key.docId}: ${plan.error}`);
  stagesCompleted.push("LOCAL_VERIFIED");
  log(`[publish] LOCAL_VERIFIED ok: ${revision.path}`);

  // -------- Stage 2: HOSTING_DEPLOYED (step 7) -----------------------------
  if (input.mode === "publish") {
    const deployed = await deps.deployHosting();
    if (!deployed.ok) {
      log(`[publish] HOSTING_DEPLOYED failed: ${deployed.error}`);
      return {
        ok: false,
        failedStage: "HOSTING_DEPLOYED",
        error: deployed.error,
        stagesCompleted,
        indexAdvanced: false,
      };
    }
  } else {
    // Rollback: the prior revision was already deployed by its original
    // publication. We deliberately do NOT redeploy; liveness (next stage)
    // is the real gate that proves the artifact is still retrievable.
    log("[publish] HOSTING_DEPLOYED skipped (rollback repoints to an already-deployed retained revision; liveness re-verified next)");
  }
  stagesCompleted.push("HOSTING_DEPLOYED");

  // -------- Stage 3: HOSTED_BYTES_VERIFIED (step 8, liveness) ---------------
  const fetchResult = await deps.fetchHosted(revision.path);
  const liveness = verifyHostedBytes(fetchResult, revision, deps.hashBytes);
  if (!liveness.ok) {
    log(`[publish] HOSTED_BYTES_VERIFIED failed: ${liveness.error}`);
    return {
      ok: false,
      failedStage: "HOSTED_BYTES_VERIFIED",
      error: liveness.error,
      stagesCompleted,
      indexAdvanced: false,
    };
  }
  stagesCompleted.push("HOSTED_BYTES_VERIFIED");
  log(`[publish] HOSTED_BYTES_VERIFIED ok: exact hosted bytes match ${revision.sha256}`);

  // -------- Stage 3b: ASSESSMENT_PRESENTATION_RECORDED (F5.3, bound only) ---
  // The immutable record must exist exactly before the index can point
  // students at an artifact that depends on it.
  if (binding !== undefined && deps.ensureAssessmentPresentation !== undefined) {
    let recorded;
    try {
      recorded = await deps.ensureAssessmentPresentation(binding.assessmentPresentationRevisionId, binding.record);
    } catch (err) {
      recorded = { ok: false as const, error: (err as Error).message };
    }
    if (!recorded.ok) {
      log(`[publish] ASSESSMENT_PRESENTATION_RECORDED failed: ${recorded.error}`);
      return {
        ok: false,
        failedStage: "ASSESSMENT_PRESENTATION_RECORDED",
        error: recorded.error,
        stagesCompleted,
        indexAdvanced: false,
      };
    }
    stagesCompleted.push("ASSESSMENT_PRESENTATION_RECORDED");
    log(
      `[publish] ASSESSMENT_PRESENTATION_RECORDED ok: ${binding.assessmentPresentationRevisionId} ` +
        `(${recorded.created ? "created" : "already identical"})`,
    );
  }

  // -------- Stage 4: INDEX_UPDATED (step 9, ALWAYS LAST) -------------------
  // The one and only coverage-write call site, and it writes ONLY the scoped
  // document. Reached only because every stage above returned ok, i.e.
  // liveness passed.
  let written: Awaited<ReturnType<WriteScopedCoveragePort>>;
  try {
    written = await deps.writeScopedCoverage({
      key: coverage.key,
      record: coverage.record,
      publishedBy: input.publishedBy.trim(),
      mode: input.mode,
    });
  } catch (err) {
    written = { ok: false, error: (err as Error).message };
  }
  if (!written.ok) {
    log(`[publish] INDEX_UPDATED failed: ${written.error} (the scoped record is unchanged; retry after resolving)`);
    return {
      ok: false,
      failedStage: "INDEX_UPDATED",
      error: written.error,
      stagesCompleted,
      indexAdvanced: false,
    };
  }
  stagesCompleted.push("INDEX_UPDATED");
  log(`[publish] INDEX_UPDATED ok: ${coverage.key.docId} ${written.action} -> ${revision.presentationRevisionId}`);

  return {
    ok: true,
    mode: input.mode,
    revision,
    stagesCompleted,
    indexAdvanced: true,
    coverage: { docId: coverage.key.docId, action: written.action },
  };
}

// ------------------------------- Retirement --------------------------------

// F5.3 Slice 9C-2: retirement names the assessment revision and flips only
// that scoped record; the legacy record is never written.
export type WriteScopedRetirePort = (args: {
  readonly key: ScopedCoverageKey;
  readonly publishedBy: string;
}) => Promise<void>;

export type RetireDeps = {
  readonly readScopedCoverage: ReadScopedCoveragePort;
  readonly writeScopedRetire: WriteScopedRetirePort;
  readonly log?: LogPort;
};

export type RetireInput = {
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly assessmentRevisionId: string;
  readonly publishedBy: string;
};

export type RetireResult =
  | { readonly ok: true; readonly retired: boolean; readonly note: string }
  | { readonly ok: false; readonly error: string };

// Retire the scoped coverage of one assessment revision: flip its status to
// "retired" so it is no longer eligible for new differentiated resolution of
// that revision (a retired scoped record decides alone; it never falls
// through to the legacy record). Historical retention is untouched - the
// artifact and its manifest entry remain, and prior attempts keep their frozen
// ids. Retirement needs no liveness check and never deletes anything.
export async function retireVariant(input: RetireInput, deps: RetireDeps): Promise<RetireResult> {
  const log: LogPort = deps.log ?? (() => undefined);
  if (typeof input.publishedBy !== "string" || input.publishedBy.trim().length === 0) {
    return { ok: false, error: "publishedBy (server-owned operator attribution) is required" };
  }
  const ordinal = frozenRevisionOrdinal(input.lessonSlug, input.assessmentRevisionId);
  let key: ScopedCoverageKey;
  try {
    if (ordinal === undefined) throw new Error(`assessment revision ${String(input.assessmentRevisionId)} is not a revision of assessment_${input.lessonSlug}`);
    key = {
      docId: presentationVariantScopedIndexDocId(input.lessonSlug, input.variantKey, ordinal),
      lessonSlug: input.lessonSlug,
      variantKey: input.variantKey,
      revisionOrdinal: ordinal,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const docId = key.docId;

  const current = await deps.readScopedCoverage(key);
  if (!current.exists) {
    log(`[retire] no ${docId}; nothing to retire (already unavailable for differentiated resolution of ${input.assessmentRevisionId})`);
    return { ok: true, retired: false, note: "no scoped coverage; nothing to retire" };
  }
  const doc = current.data !== null && typeof current.data === "object" ? (current.data as Record<string, unknown>) : null;
  if (
    doc === null ||
    doc.lessonSlug !== input.lessonSlug ||
    doc.variantKey !== input.variantKey ||
    doc.assessmentRevisionId !== input.assessmentRevisionId
  ) {
    return { ok: false, error: `${docId} does not record this lesson, variant key, and assessment revision; refusing to write it` };
  }
  if (doc.status === "retired") {
    log(`[retire] ${docId} already retired; no-op`);
    return { ok: true, retired: false, note: "already retired" };
  }

  await deps.writeScopedRetire({ key, publishedBy: input.publishedBy.trim() });
  log(`[retire] ${docId} status set to retired; artifact and manifest entry retained`);
  return { ok: true, retired: true, note: "retired" };
}
