/** Option B transactional enforcement. Every attempt revalidates runtime
 * identity, canonical teacher context, uncached policy and actual build bytes.
 * No release/evidence graph, marker or verifier can authorize this path. */
import type { Transaction } from "firebase-admin/firestore";
import { PlatformError, log } from "../shared";
import { getAdminFirestore } from "../shared/firestore/admin";
import { contentDigest } from "./a3-canonical";
import type { A3ErrorCode } from "./a3-errors";
import { isResolvedRuntimeIdentity, resolveRuntimeIdentity } from "./a3-runtime-identity";
import type { RuntimeIdentity } from "./a3-runtime-identity";
import { evaluateAvailabilityEligibility, validateAvailabilityPolicy } from "./availability-policy";
import type { AvailabilityPolicy } from "./availability-policy";
import { validateMutationCompatibility } from "./availability-protocol";
import type { MutationCompatibilityV2 } from "./availability-protocol";
import { inspectAvailabilityRuntimeArtifact, validateAvailabilityRuntimeBuild } from "./availability-runtime-build";
import { UNIT_PLACEABLE_RESOURCE_ID_LIST } from "./unit-placeable-resources";
export const TEACHER_UNITS_POLICY_PATH = "platformConfig/teacherUnitsAvailability";
export const TEACHER_UNITS_ENFORCEMENT_VERSION = "teacher-units-option-b-v1";
export const TEACHER_UNITS_CLIENT_CONTRACT = "teacher-units-v3";
export const RUNTIME_PLACEMENT_FINGERPRINT: string = contentDigest([...UNIT_PLACEABLE_RESOURCE_ID_LIST]);
export type TeacherUnitsEndpoint = "teacherUnitsCreate" | "teacherUnitsList" | "teacherUnitsGet" |
  "teacherUnitsUpdate" | "teacherUnitsArchive" | "teacherUnitsRestore" | "teacherUnitsSetResources" |
  "teacherUnitsReorder" | "teacherUnitsCapabilities";
export type TeacherUnitsEnforcement = Readonly<{
  resolveIdentity: () => Promise<RuntimeIdentity | null>;
  isIdentityCurrent: (identity: RuntimeIdentity) => boolean;
  /** Trusted server dependency. Production inspects actual artifact bytes on
   * every attempt; supplied request/environment build IDs are never read. */
  inspectBuild: () => unknown;
}>;
export const PRODUCTION_TEACHER_UNITS_ENFORCEMENT: TeacherUnitsEnforcement = Object.freeze({
  resolveIdentity: async (): Promise<RuntimeIdentity | null> => {
    const result = await resolveRuntimeIdentity();
    return result.ok ? result.identity : null;
  },
  isIdentityCurrent: (identity: RuntimeIdentity): boolean => isResolvedRuntimeIdentity(identity),
  inspectBuild: () => inspectAvailabilityRuntimeArtifact().build,
});
export type A3Scope = Readonly<{
  identity: RuntimeIdentity; enforcement: TeacherUnitsEnforcement; endpoint: TeacherUnitsEndpoint;
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

function identityCurrent(enforcement: TeacherUnitsEnforcement, identity: RuntimeIdentity, endpoint: TeacherUnitsEndpoint): boolean {
  try {
    return acceptedIdentity(identity) && enforcement.isIdentityCurrent(identity) &&
      (identity.environment === "emulator" || (identity.service === endpoint.toLowerCase() &&
        typeof identity.revision === "string" && identity.revision.startsWith(`${identity.service}-`)));
  } catch { return false; }
}

/** Resolved before any tenant read. Failure or an unaccepted identity refuses. */
export async function requireRuntimeIdentity(enforcement: TeacherUnitsEnforcement, endpoint: TeacherUnitsEndpoint): Promise<RuntimeIdentity> {
  let identity: RuntimeIdentity | null;
  try { identity = await enforcement.resolveIdentity(); } catch (err) {
    throw a3Refusal("teacherUnits.runtimeIdentityUnavailable", err);
  }
  if (!identity || !identityCurrent(enforcement, identity, endpoint)) throw a3Refusal("teacherUnits.runtimeIdentityUnavailable");
  return identity;
}

/** Re-checked at the start of every transaction attempt. */
export function assertScopeIdentity(scope: A3Scope): void {
  if (!identityCurrent(scope.enforcement, scope.identity, scope.endpoint)) throw a3Refusal("teacherUnits.runtimeIdentityUnavailable");
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

// ---------- Option B availability evaluation ----------
type BuildDeclaration = Readonly<{ backendBuildId: string | null }>;
export type AvailabilityEvaluation = BuildDeclaration & (
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "closed"; policy: AvailabilityPolicy }>
  | Readonly<{ kind: "ineligible"; policy: AvailabilityPolicy }>
  | Readonly<{ kind: "enabled"; policy: AvailabilityPolicy; releaseId: string }>);

export async function evaluateAvailabilityInTransaction(tx: Transaction, scope: A3Scope): Promise<AvailabilityEvaluation> {
  assertScopeIdentity(scope);
  const raw = await txRead(tx, TEACHER_UNITS_POLICY_PATH);
  const identity = { environment: scope.identity.environment, projectId: scope.identity.projectId,
    projectNumber: scope.identity.projectNumber, region: scope.identity.region, databaseId: scope.identity.databaseId };
  const parsed = raw === undefined ? null : validateAvailabilityPolicy(raw, identity);
  if (parsed !== null && !parsed.ok) throw a3Refusal("teacherUnits.policyInvalid");
  // Only actual tx.get errors get SDK retry treatment. Inspector/parser errors,
  // even ABORTED-shaped ones, yield ineligibility, never an SDK retry signal.
  let build = null;
  try {
    const checked = validateAvailabilityRuntimeBuild(scope.enforcement.inspectBuild());
    if (checked.ok && checked.value.placementFingerprint === RUNTIME_PLACEMENT_FINGERPRINT) build = checked.value;
  } catch { /* unavailable artifact never authorizes */ }
  const backendBuildId = build?.backendBuildId ?? null;
  if (parsed === null) return { kind: "missing", backendBuildId };
  if (!parsed.ok) throw a3Refusal("teacherUnits.policyInvalid");
  const policy = parsed.value;
  if (policy.mode === "closed") return { kind: "closed", policy, backendBuildId };
  const eligible = build !== null && evaluateAvailabilityEligibility(policy, {
    identity, identityCurrent: identityCurrent(scope.enforcement, scope.identity, scope.endpoint),
    backendBuildId: build.backendBuildId, deploymentMode: build.deploymentMode, sourceDirty: build.sourceDirty,
    clientContractVersion: TEACHER_UNITS_CLIENT_CONTRACT, placementFingerprint: RUNTIME_PLACEMENT_FINGERPRINT,
  }).eligible;
  return eligible && policy.approvedBackendBuildId !== null
    ? { kind: "enabled", policy, releaseId: policy.approvedBackendBuildId, backendBuildId }
    : { kind: "ineligible", policy, backendBuildId };
}

export async function enforceManagementAvailability(tx: Transaction, scope: A3Scope,
  envelope?: MutationCompatibilityV2): Promise<void> {
  const evaluation = await evaluateAvailabilityInTransaction(tx, scope);
  if (evaluation.kind === "missing") throw a3Refusal("teacherUnits.policyMissing");
  if (evaluation.kind === "closed") throw a3Refusal("teacherUnits.availabilityClosed");
  if (evaluation.kind === "ineligible") throw a3Refusal("teacherUnits.deploymentIneligible");
  if (!envelope) return;
  if (!validateMutationCompatibility(envelope).ok) throw a3Refusal("teacherUnits.invalidCompatibility");
  const policy = evaluation.policy;
  if (envelope.policyInstanceId !== policy.policyInstanceId || envelope.policyGeneration !== policy.generation ||
      envelope.backendReleaseId !== evaluation.releaseId) throw a3Refusal("teacherUnits.policyChanged");
  if (envelope.placementFingerprint !== policy.placementFingerprint) throw a3Refusal("teacherUnits.placementMismatch");
}
export type AvailabilityDeclaration = Readonly<{
  state: "closed" | "enabled" | "unverified"; policyInstanceId: string | null; policyGeneration: number | null;
  backendReleaseId: string | null; deploymentEligible: boolean;
}>;
export function declareAvailability(evaluation: AvailabilityEvaluation): AvailabilityDeclaration {
  if (evaluation.kind === "missing") return { state: "unverified", policyInstanceId: null,
    policyGeneration: null, backendReleaseId: null, deploymentEligible: false };
  const p = evaluation.policy;
  return { state: evaluation.kind === "closed" ? "closed" : evaluation.kind === "enabled" ? "enabled" : "unverified",
    policyInstanceId: p.policyInstanceId, policyGeneration: p.generation,
    backendReleaseId: p.approvedBackendBuildId, deploymentEligible: evaluation.kind === "enabled" };
}
export function readCompatibility(payload: Record<string, unknown>): MutationCompatibilityV2 {
  if (!Object.hasOwn(payload, "compatibility")) throw a3Refusal("teacherUnits.compatibilityRequired");
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
