/** A3-3 transactional Teacher Units enforcement.
 *
 * Governed by docs/platform/U2_6_A3_3_APPROVED_DECISIONS.md. Every management
 * read and mutation re-evaluates, inside its own Firestore transaction attempt:
 * runtime identity, the uncached singleton availability policy, the referenced
 * release and evidence documents, A3-2 runtime provenance, the release-authority
 * verdict, the A3-1 bindings and (for mutations) the compatibility envelope.
 * Nothing positive is cached across requests or transaction attempts.
 *
 * Production wiring uses the UNCONFIGURED release-authority verifier, so an
 * enabled policy always evaluates as ineligible and Teacher Units management
 * operations remain unavailable. Sole exception (owner-approved, staging only,
 * uncertified): an enabled staging UX test marker policy in the exact
 * `lyfelabz-staging` runtime identity (a3-staging-ux-test.ts). A marker policy
 * is ineligible everywhere else. A3-2 runtime consistency ("matched") is one
 * necessary input; its constant `available: false` is never read as a gate or
 * overridden here. */
import type { Transaction } from "firebase-admin/firestore";

import { PlatformError, log } from "../shared";
import { getAdminFirestore } from "../shared/firestore/admin";
import type * as C from "./a3-contracts";
import { contentDigest } from "./a3-canonical";
import type { A3ErrorCode } from "./a3-errors";
import { validateActivationBinding, validateDeploymentBinding, validateEvidenceReference,
  validateMutationBinding, validateReleaseReference } from "./a3-bindings";
import { validatePolicy } from "./a3-validation";
import { validateMutationCompatibility } from "./a3-protocol";
import type { MutationCompatibilityV1 } from "./a3-protocol";
import { UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER, parseReleaseAuthorityVerdict } from "./a3-release-authority";
import type { ReleaseAuthorityVerdict, ReleaseAuthorityVerifier } from "./a3-release-authority";
import { isResolvedRuntimeIdentity, resolveRuntimeIdentity } from "./a3-runtime-identity";
import type { RuntimeIdentity } from "./a3-runtime-identity";
import { verifyRuntimeProvenance } from "./a3-runtime-provenance";
import type { RuntimeProvenanceResult } from "./a3-runtime-provenance";
import { isStagingUxTestPolicy, stagingUxTestEligible } from "./a3-staging-ux-test";
import { UNIT_PLACEABLE_RESOURCE_ID_LIST } from "./unit-placeable-resources";

export const TEACHER_UNITS_POLICY_PATH = "platformConfig/teacherUnitsAvailability";
export const TEACHER_UNITS_ENFORCEMENT_VERSION = "teacher-units-a3-v1";
export const TEACHER_UNITS_CLIENT_CONTRACT = "teacher-units-v2";
/** Existing ordered placement digest (same bytes as the A2 discovery value). */
export const RUNTIME_PLACEMENT_FINGERPRINT: string = contentDigest([...UNIT_PLACEABLE_RESOURCE_ID_LIST]);

export type TeacherUnitsEnforcement = Readonly<{
  resolveIdentity: () => Promise<RuntimeIdentity | null>;
  isIdentityCurrent: (identity: RuntimeIdentity) => boolean;
  provenance: (identity: RuntimeIdentity, endpointName: C.EndpointName, releaseRef: string,
    release: unknown, deploymentApproval: unknown) => RuntimeProvenanceResult;
  verifier: ReleaseAuthorityVerifier;
}>;

/** The only wiring used by exported callables. It supplies no emulator profile
 * (cloud identity requires execution metadata; emulator mode without an injected
 * profile is refused) and the UNCONFIGURED verifier. */
export const PRODUCTION_TEACHER_UNITS_ENFORCEMENT: TeacherUnitsEnforcement = Object.freeze({
  resolveIdentity: async (): Promise<RuntimeIdentity | null> => {
    const result = await resolveRuntimeIdentity();
    return result.ok ? result.identity : null;
  },
  isIdentityCurrent: (identity: RuntimeIdentity): boolean => isResolvedRuntimeIdentity(identity),
  provenance: (identity: RuntimeIdentity, endpointName: C.EndpointName, releaseRef: string, release: unknown,
    deploymentApproval: unknown): RuntimeProvenanceResult =>
    verifyRuntimeProvenance(identity, endpointName, releaseRef, release, deploymentApproval),
  verifier: UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER,
});

export type A3Scope = Readonly<{
  identity: RuntimeIdentity; enforcement: TeacherUnitsEnforcement; endpoint: C.EndpointName;
}>;

// ---------- Refusals ----------

const UNAVAILABLE = "Teacher Units is not available.";
const A3_MESSAGES: Readonly<Record<A3ErrorCode, string>> = Object.freeze({
  "teacherUnits.availabilityClosed": UNAVAILABLE,
  "teacherUnits.policyMissing": UNAVAILABLE,
  "teacherUnits.policyInvalid": UNAVAILABLE,
  "teacherUnits.policyUnavailable": "Teacher Units availability could not be confirmed. Try again later.",
  "teacherUnits.deploymentIneligible": UNAVAILABLE,
  "teacherUnits.runtimeIdentityUnavailable": "The Teacher Units service could not be verified.",
  "teacherUnits.compatibilityRequired": "This version of the app is not supported. Reload to update.",
  "teacherUnits.invalidCompatibility": "The request compatibility information is invalid.",
  "teacherUnits.contractUnsupported": "This version of the app is not supported. Reload to update.",
  "teacherUnits.policyChanged": "Teacher Units availability changed. Reload and try again.",
  "teacherUnits.placementMismatch": "The resource catalog changed. Reload and try again.",
  "teacherUnits.responseUnavailable":
    "Your change may have been saved, but it could not be confirmed. Reload your units before trying again.",
});

/** Client-facing A3 refusal. Details carry only the code (added by the translator);
 * the cause stays server-side. */
export function a3Refusal(code: A3ErrorCode, cause?: unknown): PlatformError {
  return new PlatformError(code, A3_MESSAGES[code], cause);
}

// ---------- Runtime identity ----------

const DEMO_PROJECT = /^demo-[a-z0-9-]+$/;

// A3-3 environment acceptance on top of the A3-2 resolver. Teacher Units emulator
// identities must use a `demo-` project; production and staging project IDs are
// never accepted as emulator identities.
function acceptedIdentity(identity: RuntimeIdentity): boolean {
  if (identity.region !== "us-central1" || identity.databaseId !== "(default)") return false;
  switch (identity.environment) {
    case "production":
      return identity.projectId === "lyfelabz-prod" && identity.projectNumber === "182791689935" &&
        identity.source === "execution-metadata";
    case "staging":
      return identity.projectId === "lyfelabz-staging" && identity.projectNumber === "293337283840" &&
        identity.source === "execution-metadata";
    case "emulator":
      return identity.projectNumber === "0" && DEMO_PROJECT.test(identity.projectId) &&
        identity.source === "explicit-local-profile" && identity.localProfile !== undefined;
    default:
      return false;
  }
}

function identityCurrent(enforcement: TeacherUnitsEnforcement, identity: RuntimeIdentity): boolean {
  try { return acceptedIdentity(identity) && enforcement.isIdentityCurrent(identity); } catch { return false; }
}

/** Resolved before any tenant read. Failure or an unaccepted identity refuses. */
export async function requireRuntimeIdentity(enforcement: TeacherUnitsEnforcement): Promise<RuntimeIdentity> {
  let identity: RuntimeIdentity | null;
  try { identity = await enforcement.resolveIdentity(); } catch (err) {
    throw a3Refusal("teacherUnits.runtimeIdentityUnavailable", err);
  }
  if (!identity || !identityCurrent(enforcement, identity)) throw a3Refusal("teacherUnits.runtimeIdentityUnavailable");
  return identity;
}

/** Re-checked at the start of every transaction attempt. */
export function assertScopeIdentity(scope: A3Scope): void {
  if (!identityCurrent(scope.enforcement, scope.identity)) throw a3Refusal("teacherUnits.runtimeIdentityUnavailable");
}

// ---------- Transactional reads ----------

// Mirrors `isRetryableTransactionError` in the installed @google-cloud/firestore
// 7.11.6 (build/src/transaction.js): these gRPC codes, plus INVALID_ARGUMENT only
// when the message reports an expired transaction. Such errors propagate unchanged
// so the SDK can rerun the attempt (bounded by its own maxAttempts) with full
// revalidation. Every other INVALID_ARGUMENT is not retryable.
const SDK_RETRYABLE = new Set([1, 2, 4, 8, 10, 13, 14, 16]);
const GRPC_INVALID_ARGUMENT = 3;
export function isSdkRetryableTransactionError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (typeof code !== "number") return false;
  if (SDK_RETRYABLE.has(code)) return true;
  return code === GRPC_INVALID_ARGUMENT && typeof message === "string" && /transaction has expired/.test(message);
}
const sdkRetryable = isSdkRetryableTransactionError;

async function txRead(tx: Transaction, path: string): Promise<unknown> {
  try {
    const snapshot = await tx.get(getAdminFirestore().doc(path));
    return snapshot.exists ? snapshot.data() : undefined;
  } catch (err) {
    if (sdkRetryable(err)) throw err;
    throw a3Refusal("teacherUnits.policyUnavailable", err);
  }
}

const RELEASE_REF = /^teacherUnitsBackendReleases\/[a-f0-9]{64}$/;
const EVIDENCE_REF = /^teacherUnitsReleaseEvidence\/[a-f0-9]{64}$/;

// ---------- Availability evaluation ----------

export type AvailabilityEvaluation =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "closed"; policy: C.TeacherUnitsAvailabilityPolicyV1 }>
  | Readonly<{ kind: "ineligible"; policy: C.TeacherUnitsAvailabilityPolicyV1 }>
  | Readonly<{ kind: "enabled"; policy: C.TeacherUnitsAvailabilityPolicyV1; releaseId: string }>;

// O6: an exception propagates only when it is the exact error object A3-3's own
// readEvidence raised in this attempt and txRead classified it as SDK-retryable or
// policyUnavailable. Identity, never shape: a verifier-originated or replaced error,
// however it looks, fails closed as unverified `error`.
async function callVerifier(scope: A3Scope, input: Parameters<ReleaseAuthorityVerifier["verify"]>[0],
  readFailures: ReadonlySet<unknown>): Promise<ReleaseAuthorityVerdict> {
  try { return parseReleaseAuthorityVerdict(await scope.enforcement.verifier.verify(input)); } catch (err) {
    if (readFailures.has(err) &&
        (sdkRetryable(err) || (err instanceof PlatformError && err.code === "teacherUnits.policyUnavailable"))) throw err;
    return Object.freeze({ verdict: "unverified", reason: "error" } as const);
  }
}

// True only when every independent condition holds. Any missing document,
// mismatch, unmatched provenance, unverified verdict or exception is false.
async function enabledEligible(tx: Transaction, scope: A3Scope, policy: C.TeacherUnitsAvailabilityPolicyV1): Promise<boolean> {
  const identity = scope.identity;
  if (policy.placementFingerprint !== RUNTIME_PLACEMENT_FINGERPRINT || !policy.backendReleaseEligibility || !policy.activationEvidenceRef) return false;
  const releaseId = policy.backendReleaseEligibility.releaseId;
  const releaseRef = `teacherUnitsBackendReleases/${releaseId}`;
  const release = await txRead(tx, releaseRef);
  const releaseCheck = validateReleaseReference(releaseRef, release, identity);
  if (!releaseCheck.ok) return false;
  const deploymentApprovalRef = releaseCheck.value.manifest.deploymentApprovalEvidenceRef;
  const deploymentApproval = await txRead(tx, deploymentApprovalRef);
  if (!validateDeploymentBinding(release, deploymentApproval, identity).ok) return false;
  const activationEvidenceRef = policy.activationEvidenceRef;
  const activationEvidence = await txRead(tx, activationEvidenceRef);
  const evidenceCheck = validateEvidenceReference(activationEvidenceRef, activationEvidence, identity);
  if (!evidenceCheck.ok || evidenceCheck.value.payload.kind !== "teacher-units-activation") return false;
  const activationApprovalRef = evidenceCheck.value.payload.authorizationEvidenceRef;
  const certificationEvidenceRef = evidenceCheck.value.payload.certificationEvidenceRef;
  const activationApproval = await txRead(tx, activationApprovalRef);
  const approvalCheck = validateEvidenceReference(activationApprovalRef, activationApproval, identity);
  if (!approvalCheck.ok || approvalCheck.value.payload.kind !== "teacher-units-activation-approval") return false;

  let provenance: RuntimeProvenanceResult;
  try { provenance = scope.enforcement.provenance(identity, scope.endpoint, releaseRef, release, deploymentApproval); } catch { return false; }
  if (provenance.runtimeConsistency !== "matched" || provenance.releaseId !== releaseId) return false;

  // Per attempt: a fresh set on every SDK rerun; no evidence is cached.
  const readFailures = new Set<unknown>();
  const read = async (ref: string): Promise<unknown> => {
    try { return await txRead(tx, ref); } catch (err) { readFailures.add(err); throw err; }
  };
  const readEvidence = async (ref: string): Promise<unknown> => {
    if (typeof ref === "string" && RELEASE_REF.test(ref)) {
      const document = await read(ref);
      if (document === undefined) return null;
      if (!validateReleaseReference(ref, document, identity).ok) throw new Error("invalid release evidence");
      return document;
    }
    if (typeof ref === "string" && EVIDENCE_REF.test(ref)) {
      const document = await read(ref);
      if (document === undefined) return null;
      if (!validateEvidenceReference(ref, document, identity).ok) throw new Error("invalid evidence");
      return document;
    }
    throw new Error("unsupported evidence reference");
  };
  const verdict = await callVerifier(scope, Object.freeze({
    identity, endpointName: scope.endpoint, policy, releaseRef, release: releaseCheck.value,
    deploymentApprovalRef, deploymentApproval: deploymentApproval as C.DeploymentApprovalDocumentV1,
    activationEvidenceRef, activationEvidence: activationEvidence as C.ActivationEvidenceDocumentV1,
    activationApprovalRef, activationApproval: activationApproval as C.ActivationApprovalDocumentV1, readEvidence,
  }), readFailures);
  if (verdict.verdict !== "verified") return false;
  if (verdict.releaseId !== releaseId || verdict.deploymentApprovalRef !== deploymentApprovalRef ||
      verdict.activationEvidenceRef !== activationEvidenceRef || verdict.activationApprovalRef !== activationApprovalRef ||
      verdict.certificationEvidenceRef !== certificationEvidenceRef || verdict.policyInstanceId !== policy.policyInstanceId ||
      verdict.enabledGeneration !== policy.generation) return false;
  // Expected Hosting fingerprint comes only from the verified approval statement.
  return validateActivationBinding(policy, release, activationEvidence, activationApproval,
    verdict.hostingCandidateFingerprint, identity).ok;
}

/** Uncached evaluation inside the caller's transaction attempt. Throws
 * runtimeIdentityUnavailable, policyUnavailable or policyInvalid. */
export async function evaluateAvailabilityInTransaction(tx: Transaction, scope: A3Scope): Promise<AvailabilityEvaluation> {
  assertScopeIdentity(scope);
  const raw = await txRead(tx, TEACHER_UNITS_POLICY_PATH);
  if (raw === undefined) return { kind: "missing" };
  const parsed = validatePolicy(raw, scope.identity);
  if (!parsed.ok) throw a3Refusal("teacherUnits.policyInvalid");
  const policy = parsed.value;
  if (policy.mode === "closed") return { kind: "closed", policy };
  let eligible = false;
  try {
    // Staging UX test markers never enter the certified chain; outside the exact
    // staging identity they are ineligible.
    eligible = isStagingUxTestPolicy(policy)
      ? stagingUxTestEligible(scope.identity, policy, RUNTIME_PLACEMENT_FINGERPRINT)
      : await enabledEligible(tx, scope, policy);
  } catch (err) {
    if (sdkRetryable(err) || (err instanceof PlatformError && err.code === "teacherUnits.policyUnavailable")) throw err;
    eligible = false;
  }
  return eligible && policy.backendReleaseEligibility
    ? { kind: "enabled", policy, releaseId: policy.backendReleaseEligibility.releaseId }
    : { kind: "ineligible", policy };
}

/** Management reads and mutations: requires an enabled, independently verified
 * policy. Mutations additionally bind their compatibility envelope. Precedence:
 * runtimeIdentityUnavailable, policyUnavailable, policyMissing, policyInvalid,
 * availabilityClosed, deploymentIneligible, policyChanged, placementMismatch. */
export async function enforceManagementAvailability(tx: Transaction, scope: A3Scope,
  envelope?: MutationCompatibilityV1): Promise<void> {
  const evaluation = await evaluateAvailabilityInTransaction(tx, scope);
  if (evaluation.kind === "missing") throw a3Refusal("teacherUnits.policyMissing");
  if (evaluation.kind === "closed") throw a3Refusal("teacherUnits.availabilityClosed");
  if (evaluation.kind === "ineligible") throw a3Refusal("teacherUnits.deploymentIneligible");
  if (!envelope) return;
  const policy = evaluation.policy;
  if (envelope.policyInstanceId !== policy.policyInstanceId || envelope.policyGeneration !== policy.generation ||
      envelope.backendReleaseId !== evaluation.releaseId) throw a3Refusal("teacherUnits.policyChanged");
  if (envelope.placementFingerprint !== policy.placementFingerprint) throw a3Refusal("teacherUnits.placementMismatch");
  if (!validateMutationBinding(policy, envelope, scope.identity).ok) throw a3Refusal("teacherUnits.policyChanged");
}

export type AvailabilityDeclaration = Readonly<{
  state: "closed" | "enabled" | "unverified"; policyInstanceId: string | null; policyGeneration: number | null;
  backendReleaseId: string | null; deploymentEligible: boolean;
}>;

/** Discovery declaration (A3-1 semantics). policyInvalid/policyUnavailable refuse. */
export function declareAvailability(evaluation: AvailabilityEvaluation): AvailabilityDeclaration {
  if (evaluation.kind === "missing") {
    return { state: "unverified", policyInstanceId: null, policyGeneration: null, backendReleaseId: null, deploymentEligible: false };
  }
  const p = evaluation.policy;
  const releaseId = p.backendReleaseEligibility?.releaseId ?? null;
  if (evaluation.kind === "closed") {
    return { state: "closed", policyInstanceId: p.policyInstanceId, policyGeneration: p.generation, backendReleaseId: releaseId, deploymentEligible: false };
  }
  if (evaluation.kind === "ineligible") {
    return { state: "unverified", policyInstanceId: p.policyInstanceId, policyGeneration: p.generation, backendReleaseId: releaseId, deploymentEligible: false };
  }
  return { state: "enabled", policyInstanceId: p.policyInstanceId, policyGeneration: p.generation, backendReleaseId: evaluation.releaseId, deploymentEligible: true };
}

// ---------- Pre-transaction request checks ----------

/** Mutation envelope. Decided before any transaction, so a refusal here proves
 * nothing was written by this request. */
export function readCompatibility(payload: Record<string, unknown>): MutationCompatibilityV1 {
  if (!Object.prototype.hasOwnProperty.call(payload, "compatibility")) throw a3Refusal("teacherUnits.compatibilityRequired");
  const result = validateMutationCompatibility(payload.compatibility);
  if (!result.ok) throw a3Refusal("teacherUnits.invalidCompatibility");
  return result.value;
}

// ---------- Post-commit responses ----------

export type TeacherUnitsMutationOperation = "create" | "update" | "archive" | "restore" | "setResources" | "reorder";

/** Called only after this request's write transaction resolved (a confirmed
 * commit). Every failure while producing the response becomes responseUnavailable
 * with outcome unconfirmed. The committed write, receipt and audit are untouched. */
export async function respondAfterCommit<T>(operation: TeacherUnitsMutationOperation,
  logContext: Readonly<Record<string, unknown>>, produce: () => Promise<T>): Promise<T> {
  try {
    return await produce();
  } catch (err) {
    try {
      const reason = err instanceof PlatformError ? err.code : "unhandled";
      log.warn("teacherUnits.responseUnavailable", { operation, ...logContext, reason });
    } catch {
      // Logging is observability, not lifecycle.
    }
    throw new PlatformError("teacherUnits.responseUnavailable", A3_MESSAGES["teacherUnits.responseUnavailable"], err,
      { outcome: "unconfirmed", operation });
  }
}
