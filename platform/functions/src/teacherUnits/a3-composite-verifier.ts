/** A3-6 S3 composite release-authority verifier
 * (docs/platform/U2_6_A3_6_DECISION_RECORD.md, section 9 S3; A3-3 Decision 4).
 *
 * Combines the A3-1 bindings, the S1 authority registry and Ed25519 signature
 * verification, the S2 certification binding and the S2 pinned revocation list into
 * one Decision 4 verdict. Pure apart from the single `readEvidence` call the adapter
 * makes for the certification: no Firestore, network, clock or cache. Dependencies
 * are explicit, branded and never defaulted, and this module exports no verifier
 * instance. NOT WIRED: production enforcement still uses
 * UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER, and no non-test module imports this file
 * (test-enforced). A verified verdict is one necessary input to availability, never
 * activation or deployment permission. */
import { Timestamp } from "firebase-admin/firestore";
import type * as C from "./a3-contracts";
import { canonicalJSON, parseStrictJSON } from "./a3-canonical";
import { isAuthorityRegistry } from "./a3-authority-registry";
import type { AuthorityAction, AuthorityRegistry } from "./a3-authority-registry";
import { validateActivationBinding, validateCertificationBinding, validateDeploymentBinding, validateEvidenceReference,
  validateReleaseReference } from "./a3-bindings";
import { parseReleaseAuthorityVerdict } from "./a3-release-authority";
import type { ReleaseAuthorityInput, ReleaseAuthorityUnverifiedReason, ReleaseAuthorityVerdict,
  ReleaseAuthorityVerifier } from "./a3-release-authority";
import { isRevocationList, revocationStatus } from "./a3-revocation-list";
import type { RevocationList } from "./a3-revocation-list";
import { verifyApprovalSignature } from "./a3-signature";
import { assertIdentity, validatePolicy } from "./a3-validation";

export type CompositeVerifierDependencies = Readonly<{ registry: AuthorityRegistry; revocationList: RevocationList }>;

/** Everything the pure core needs: the Decision 4 input without `readEvidence`, plus the
 * certification document the activation approval names (`null` when it is absent). */
export type ReleaseAuthorityChain = Omit<ReleaseAuthorityInput, "readEvidence"> & Readonly<{ certification: unknown }>;

type Unverified = Readonly<{ verdict: "unverified"; reason: ReleaseAuthorityUnverifiedReason }>;
const unverified = (reason: ReleaseAuthorityUnverifiedReason): Unverified => Object.freeze({ verdict: "unverified", reason });

const CHAIN_KEYS = Object.freeze(["identity", "endpointName", "policy", "releaseRef", "release", "deploymentApprovalRef",
  "deploymentApproval", "activationEvidenceRef", "activationEvidence", "activationApprovalRef", "activationApproval"] as const);
type ChainKey = typeof CHAIN_KEYS[number];
const DEMO_PROJECT = /^demo-[a-z0-9-]+$/;

class Mismatch extends Error {}
const mismatch = (): never => { throw new Mismatch(); };

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

// Canonical serialization refuses accessors, hidden fields, class instances and cycles;
// every later check reads only the private parsed copy.
const snapshotJSON = (value: unknown): unknown => deepFreeze(parseStrictJSON(canonicalJSON(value)));

/** Captures the own properties of `value` with a single descriptor read (no getters
 * run). Every property must be an enumerable string-keyed data property; when `keys`
 * is given the key set must equal it exactly. The caller checks the prototype. */
function captureDataProperties(value: object, keys?: readonly string[]): Record<string, unknown> {
  const descriptors: Record<PropertyKey, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.some(key => typeof key !== "string")) return mismatch();
  if (keys && (own.length !== keys.length || own.some(key => !keys.includes(key as string)))) return mismatch();
  const captured: Record<string, unknown> = {};
  for (const key of own as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) return mismatch();
    Object.defineProperty(captured, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return captured;
}

/** Plain record (Object.prototype or null prototype) captured once, see above. */
function captureOnce(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return mismatch();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return mismatch();
  return captureDataProperties(value, keys);
}

// Installed @google-cloud/firestore 7.11.6: a Timestamp's only own properties are the
// data fields `_seconds` and `_nanoseconds`; `seconds` and `nanoseconds` are getters on
// Timestamp.prototype. Any other own shape (including an own `seconds` or `nanoseconds`
// accessor or data property shadowing the prototype getters) is refused, and the values
// are taken from the captured data descriptors, so no caller-defined getter ever runs.
// An SDK that changes this private shape fails closed (inputMismatch).
const TIMESTAMP_FIELDS = Object.freeze(["_seconds", "_nanoseconds"]);

/** Exactly the SDK class (no subclass or altered prototype), exact own data shape. */
function captureTimestamp(value: unknown): Timestamp {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Timestamp.prototype) return mismatch();
  const fields = captureDataProperties(value, TIMESTAMP_FIELDS);
  // The constructor re-validates both values (integers within the SDK ranges).
  return new Timestamp(fields._seconds as number, fields._nanoseconds as number);
}

/** The policy carries an SDK Timestamp, which canonical serialization refuses: every
 * other field is snapshotted canonically and the Timestamp is rebuilt from one capture. */
function snapshotPolicy(value: unknown): C.TeacherUnitsAvailabilityPolicyV1 {
  const captured = captureOnce(value);
  const updatedAt = captureTimestamp(captured.updatedAt);
  const rest = { ...captured };
  delete rest.updatedAt;
  const copy = parseStrictJSON(canonicalJSON(rest)) as Record<string, unknown>;
  copy.updatedAt = updatedAt;
  return deepFreeze(copy) as unknown as C.TeacherUnitsAvailabilityPolicyV1;
}

type Snapshot = Readonly<{
  expected: C.ExpectedEnvironment; policy: C.TeacherUnitsAvailabilityPolicyV1;
  releaseRef: string; release: C.BackendReleaseDocumentV1;
  deploymentApprovalRef: string; deploymentApproval: C.DeploymentApprovalDocumentV1;
  activationEvidenceRef: string; activationEvidence: C.ActivationEvidenceDocumentV1;
  activationApprovalRef: string; activationApproval: C.ActivationApprovalDocumentV1;
}>;

// V0: one read of every input field into validated private snapshots.
function snapshotChain(input: unknown): Snapshot {
  const captured = captureOnce(input, CHAIN_KEYS) as Record<ChainKey, unknown>;
  const identity = snapshotJSON(captured.identity) as C.ExpectedEnvironment;
  const strings = [captured.releaseRef, captured.deploymentApprovalRef, captured.activationEvidenceRef, captured.activationApprovalRef];
  if (strings.some(ref => typeof ref !== "string")) return mismatch();
  // A3-3 identity acceptance: pinned cloud identities; emulator identities are demo- projects only.
  if (identity === null || typeof identity !== "object") return mismatch();
  if (identity.environment === "emulator") {
    if (identity.projectNumber !== "0" || typeof identity.projectId !== "string" || !DEMO_PROJECT.test(identity.projectId) ||
        identity.localProfile === undefined) return mismatch();
  } else {
    try { assertIdentity(identity); } catch { return mismatch(); }
  }
  return Object.freeze({
    expected: identity, policy: snapshotPolicy(captured.policy),
    releaseRef: captured.releaseRef as string, release: snapshotJSON(captured.release) as C.BackendReleaseDocumentV1,
    deploymentApprovalRef: captured.deploymentApprovalRef as string,
    deploymentApproval: snapshotJSON(captured.deploymentApproval) as C.DeploymentApprovalDocumentV1,
    activationEvidenceRef: captured.activationEvidenceRef as string,
    activationEvidence: snapshotJSON(captured.activationEvidence) as C.ActivationEvidenceDocumentV1,
    activationApprovalRef: captured.activationApprovalRef as string,
    activationApproval: snapshotJSON(captured.activationApproval) as C.ActivationApprovalDocumentV1,
  });
}

// V1: the A3-1 chain. Every failure is inputMismatch. Returns the certification
// reference named by the (not yet signature-verified) activation approval.
function checkStructure(s: Snapshot): string {
  const e = s.expected;
  const policy = validatePolicy(s.policy, e);
  if (!policy.ok || s.policy.mode !== "enabled" || !s.policy.backendReleaseEligibility || !s.policy.activationEvidenceRef) return mismatch();
  if (s.releaseRef !== `teacherUnitsBackendReleases/${s.policy.backendReleaseEligibility.releaseId}`) return mismatch();
  if (!validateReleaseReference(s.releaseRef, s.release, e).ok) return mismatch();
  if (s.deploymentApprovalRef !== s.release.manifest.deploymentApprovalEvidenceRef) return mismatch();
  if (!validateDeploymentBinding(s.release, s.deploymentApproval, e).ok) return mismatch();
  if (s.activationEvidenceRef !== s.policy.activationEvidenceRef) return mismatch();
  const evidence = validateEvidenceReference(s.activationEvidenceRef, s.activationEvidence, e);
  if (!evidence.ok || s.activationEvidence.payload.kind !== "teacher-units-activation") return mismatch();
  if (s.activationApprovalRef !== s.activationEvidence.payload.authorizationEvidenceRef) return mismatch();
  const approval = validateEvidenceReference(s.activationApprovalRef, s.activationApproval, e);
  if (!approval.ok || s.activationApproval.payload.kind !== "teacher-units-activation-approval") return mismatch();
  // Provisional: the approval's Hosting fingerprint is used for binding only. A verdict
  // carries it only after the approval's signature and authority verify (V5).
  const statement = s.activationApproval.payload.statement;
  if (!validateActivationBinding(s.policy, s.release, s.activationEvidence, s.activationApproval,
    statement.hostingCandidateFingerprint, e).ok) return mismatch();
  return statement.certificationEvidenceRef;
}

function structural(input: unknown): Readonly<{ snapshot: Snapshot; certificationRef: string }> | Unverified {
  try {
    const snapshot = snapshotChain(input);
    return Object.freeze({ snapshot, certificationRef: checkStructure(snapshot) });
  } catch {
    return unverified("inputMismatch");
  }
}

function signatureReason(document: unknown, registry: AuthorityRegistry, expected: C.ExpectedEnvironment,
  action: AuthorityAction): ReleaseAuthorityUnverifiedReason | null {
  const result = verifyApprovalSignature(document, registry, expected);
  if (result.verdict !== "verified") return result.reason;
  // Unreachable by construction (V1 fixes each kind); a signer bound to another action never counts.
  return result.action === action ? null : "authorityUnrecognized";
}

// V2 to V8, given the certification document read for `certificationRef`.
function complete(snapshot: Snapshot, certificationRef: string, certification: unknown,
  deps: CompositeVerifierDependencies): ReleaseAuthorityVerdict {
  const e = snapshot.expected;
  // V3 revocation: all four evidence references against the pinned deny list (D5 R2).
  for (const ref of [snapshot.deploymentApprovalRef, snapshot.activationEvidenceRef, snapshot.activationApprovalRef, certificationRef]) {
    const status = revocationStatus(deps.revocationList, ref, e);
    if (status === "revoked") return unverified("revoked");
    if (status === "listUnrecognized") return unverified("dispositionUnresolved");
    if (status !== "notRevoked") return unverified("inputMismatch");
  }
  // V4, V5: S1 reasons are preserved exactly.
  const deployment = signatureReason(snapshot.deploymentApproval, deps.registry, e, "deploy-backend");
  if (deployment) return unverified(deployment);
  const activation = signatureReason(snapshot.activationApproval, deps.registry, e, "activate-teacher-units");
  if (activation) return unverified(activation);
  // V6: certification document and its binding to this approval and release.
  let cert: C.ReleaseCertificationDocumentV1;
  try {
    if (certification === null || certification === undefined) return unverified("certificationUnverified");
    cert = snapshotJSON(certification) as C.ReleaseCertificationDocumentV1;
    if (!validateCertificationBinding(cert, snapshot.activationApproval, snapshot.release, e).ok) return unverified("certificationUnverified");
  } catch {
    return unverified("certificationUnverified");
  }
  // V7: certification signature with the certify-release key.
  const certified = signatureReason(cert, deps.registry, e, "certify-release");
  if (certified) return unverified(certified);
  // V8: every field from verified statements or content addresses of verified documents.
  // V1 bound each value to the policy, release and activation evidence, so the verified
  // statement and the A3-3 independent computation agree field by field.
  const statement = snapshot.activationApproval.payload.statement;
  const verdict = parseReleaseAuthorityVerdict({
    verdict: "verified", releaseId: statement.backendReleaseId, deploymentApprovalRef: snapshot.deploymentApprovalRef,
    activationEvidenceRef: snapshot.activationEvidenceRef, activationApprovalRef: snapshot.activationApprovalRef,
    certificationEvidenceRef: statement.certificationEvidenceRef, hostingCandidateFingerprint: statement.hostingCandidateFingerprint,
    policyInstanceId: statement.policyInstanceId, enabledGeneration: statement.enabledGeneration,
  });
  return verdict.verdict === "verified" ? verdict : unverified("error");
}

function requireDependencies(deps: unknown): CompositeVerifierDependencies {
  const captured = captureOnce(deps, ["registry", "revocationList"]);
  if (!isAuthorityRegistry(captured.registry)) throw new Error("composite verifier requires a registry from createAuthorityRegistry");
  if (!isRevocationList(captured.revocationList)) throw new Error("composite verifier requires a list from createRevocationList");
  return Object.freeze({ registry: captured.registry, revocationList: captured.revocationList });
}

/** Pure, synchronous core (reusable by S6 tooling for the checks it can run). It does
 * not and cannot perform A3-2 runtime provenance. Never throws. */
export function verifyReleaseAuthorityChain(chain: unknown, deps: CompositeVerifierDependencies): ReleaseAuthorityVerdict {
  let checkedDeps: CompositeVerifierDependencies;
  try { checkedDeps = requireDependencies(deps); } catch { return unverified("error"); }
  let certification: unknown;
  let rest: unknown;
  try {
    const keys = [...CHAIN_KEYS, "certification"];
    const captured = captureOnce(chain, keys);
    certification = captured.certification;
    delete captured.certification;
    rest = captured;
  } catch {
    return unverified("inputMismatch");
  }
  const result = structural(rest);
  if ("verdict" in result) return result;
  return complete(result.snapshot, result.certificationRef, certification, checkedDeps);
}

/** Decision 4 adapter. Reads exactly one document through the caller's `readEvidence`
 * (the certification), and only after the structural chain passes. Exceptions from
 * `readEvidence` propagate unchanged to the caller (O6). */
export function createCompositeReleaseAuthorityVerifier(deps: CompositeVerifierDependencies): ReleaseAuthorityVerifier {
  const checkedDeps = requireDependencies(deps);
  return Object.freeze({
    async verify(input: ReleaseAuthorityInput): Promise<ReleaseAuthorityVerdict> {
      let readEvidence: unknown;
      let rest: unknown;
      try {
        const captured = captureOnce(input, [...CHAIN_KEYS, "readEvidence"]);
        readEvidence = captured.readEvidence;
        delete captured.readEvidence;
        rest = captured;
      } catch {
        return unverified("inputMismatch");
      }
      if (typeof readEvidence !== "function") return unverified("inputMismatch");
      const result = structural(rest);
      if ("verdict" in result) return result;
      const certification: unknown = await (readEvidence as ReleaseAuthorityInput["readEvidence"])(result.certificationRef);
      return complete(result.snapshot, result.certificationRef, certification, checkedDeps);
    },
  });
}
