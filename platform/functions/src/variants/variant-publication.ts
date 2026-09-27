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
 * FAILURE / RETENTION
 * -------------------
 * The machine never deletes an artifact or a manifest entry. A publication
 * failure leaves the immutable artifact + manifest entry retained and the
 * index on its prior eligible revision (or absent); a later retry may run the
 * machine again (§ publishing-failure contract).
 */

import {
  assertActivateWriteConsistent,
  type PresentationVariantStatus,
} from "../shared/types/presentation-variant";
import { canonicalJson } from "../shared/types/assessment-presentation";

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

// Writes the index pointer to the verified revision with status "active"
// (§6.8 step 9). Server-owned attribution is passed through, never accepted
// from a client.
export type WriteIndexActivatePort = (
  revision: RetainedRevision,
  publishedBy: string,
) => Promise<void>;

export type LogPort = (message: string) => void;

// F5.3 Slice 5: the lesson's currently deployed canonical assessment revision
// (`assessments/assessment_<slug>.currentRevisionId`), or null when none.
export type ReadDeployedAssessmentRevisionPort = (lessonSlug: string) => Promise<string | null>;

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
  readonly writeIndexActivate: WriteIndexActivatePort;
  // Required only for a bound revision; a bound revision without them fails
  // closed at LOCAL_VERIFIED.
  readonly readDeployedAssessmentRevision?: ReadDeployedAssessmentRevisionPort;
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
async function verifyBindingForPublication(
  binding: RetainedAssessmentBinding,
  revision: RetainedRevision,
  deps: PublishDeps,
): Promise<string | null> {
  if (deps.readDeployedAssessmentRevision === undefined || deps.ensureAssessmentPresentation === undefined) {
    return "a revision bound to an assessment presentation needs the assessment-presentation publication ports";
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
  let deployed: string | null;
  try {
    deployed = await deps.readDeployedAssessmentRevision(revision.lessonSlug);
  } catch (err) {
    return `could not read the deployed assessment revision: ${(err as Error).message}`;
  }
  if (deployed !== binding.assessmentRevisionId) {
    return `bound assessment revision ${binding.assessmentRevisionId} is not the deployed current revision (${String(deployed)})`;
  }
  return null;
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
  const bound = entry.assessmentPresentationRevisionId !== undefined || entry.assessmentRevisionId !== undefined;
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
    return { ok: false, error: "the manifest entry carries half an assessment-presentation binding" };
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
  try {
    // Defense in depth: even though every value came from the trusted
    // manifest, refuse to proceed if the pointer we would write is not
    // internally self-consistent (path/hash/id disagreement).
    assertActivateWriteConsistent({
      lessonSlug: revision.lessonSlug,
      variantKey: revision.variantKey,
      currentPresentationRevisionId: revision.presentationRevisionId,
      currentPath: revision.path,
      contentSha256: revision.sha256,
      assessmentRevisionId: revision.assessmentBinding?.assessmentRevisionId,
      assessmentPresentationRevisionId: revision.assessmentBinding?.assessmentPresentationRevisionId,
    });
  } catch (err) {
    const error = (err as Error).message;
    log(`[publish] LOCAL_VERIFIED failed (self-consistency): ${error}`);
    return {
      ok: false,
      failedStage: "LOCAL_VERIFIED",
      error,
      stagesCompleted,
      indexAdvanced: false,
    };
  }
  const binding = revision.assessmentBinding;
  if (binding !== undefined) {
    const bindingError = await verifyBindingForPublication(binding, revision, deps);
    if (bindingError !== null) {
      log(`[publish] LOCAL_VERIFIED failed (assessment presentation): ${bindingError}`);
      return {
        ok: false,
        failedStage: "LOCAL_VERIFIED",
        error: bindingError,
        stagesCompleted,
        indexAdvanced: false,
      };
    }
  }
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
  // The one and only index-write call site. Reached only because every stage
  // above returned ok, i.e. liveness passed.
  try {
    await deps.writeIndexActivate(revision, input.publishedBy.trim());
  } catch (err) {
    const error = (err as Error).message;
    log(`[publish] INDEX_UPDATED failed: ${error} (prior index pointer remains current; retry the index update)`);
    return {
      ok: false,
      failedStage: "INDEX_UPDATED",
      error,
      stagesCompleted,
      indexAdvanced: false,
    };
  }
  stagesCompleted.push("INDEX_UPDATED");
  log(`[publish] INDEX_UPDATED ok: current pointer now ${revision.presentationRevisionId}`);

  return {
    ok: true,
    mode: input.mode,
    revision,
    stagesCompleted,
    indexAdvanced: true,
  };
}

// ------------------------------- Retirement --------------------------------

export type ReadIndexStatusPort = (args: {
  readonly lessonSlug: string;
  readonly variantKey: string;
}) => Promise<
  | { readonly exists: false }
  | { readonly exists: true; readonly status: PresentationVariantStatus }
>;

export type WriteIndexRetirePort = (args: {
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly publishedBy: string;
}) => Promise<void>;

export type RetireDeps = {
  readonly readIndexStatus: ReadIndexStatusPort;
  readonly writeIndexRetire: WriteIndexRetirePort;
  readonly log?: LogPort;
};

export type RetireInput = {
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly publishedBy: string;
};

export type RetireResult =
  | { readonly ok: true; readonly retired: boolean; readonly note: string }
  | { readonly ok: false; readonly error: string };

// Retire the logical variant: flip the index status to "retired" so it is no
// longer eligible for new differentiated resolution. Historical retention is
// untouched - the artifact file and its manifest entry remain, and prior
// attempts keep their frozen ids. Retirement needs no liveness check (it
// withdraws rather than points to content) and never deletes anything.
export async function retireVariant(input: RetireInput, deps: RetireDeps): Promise<RetireResult> {
  const log: LogPort = deps.log ?? (() => undefined);
  if (typeof input.publishedBy !== "string" || input.publishedBy.trim().length === 0) {
    return { ok: false, error: "publishedBy (server-owned operator attribution) is required" };
  }

  const current = await deps.readIndexStatus({ lessonSlug: input.lessonSlug, variantKey: input.variantKey });
  if (!current.exists) {
    log("[retire] no current index doc; nothing to retire (already unavailable for differentiated resolution)");
    return { ok: true, retired: false, note: "no current index; nothing to retire" };
  }
  if (current.status === "retired") {
    log("[retire] index already retired; no-op");
    return { ok: true, retired: false, note: "already retired" };
  }

  await deps.writeIndexRetire({
    lessonSlug: input.lessonSlug,
    variantKey: input.variantKey,
    publishedBy: input.publishedBy.trim(),
  });
  log("[retire] index status set to retired; artifact and manifest entry retained");
  return { ok: true, retired: true, note: "retired" };
}
