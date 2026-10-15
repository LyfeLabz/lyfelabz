/** A3-3 release-authority interface (approved decision record, Decision 4).
 * A3-3 defines the shape and the fail-closed UNCONFIGURED implementation only.
 * Trust anchors, signer verification, revocation, certification and provider
 * eligibility belong to A3-6; nothing here establishes operational authority. */
import type * as C from "./a3-contracts";
import { digest, generation, literal, object, uuid } from "./a3-protocol";
import type { RuntimeIdentity } from "./a3-runtime-identity";
import { evidenceReferenceRule } from "./a3-validation";

export type ReleaseAuthorityInput = Readonly<{
  identity: RuntimeIdentity; endpointName: C.EndpointName;
  policy: C.TeacherUnitsAvailabilityPolicyV1;
  releaseRef: string; release: C.BackendReleaseDocumentV1;
  deploymentApprovalRef: string; deploymentApproval: C.DeploymentApprovalDocumentV1;
  activationEvidenceRef: string; activationEvidence: C.ActivationEvidenceDocumentV1;
  activationApprovalRef: string; activationApproval: C.ActivationApprovalDocumentV1;
  // Same transaction; content-address-validated; release and evidence collections only.
  readEvidence: (ref: string) => Promise<unknown>;
}>;

export type ReleaseAuthorityVerified = Readonly<{
  verdict: "verified"; releaseId: string; deploymentApprovalRef: string;
  activationEvidenceRef: string; activationApprovalRef: string; certificationEvidenceRef: string;
  hostingCandidateFingerprint: string; policyInstanceId: string; enabledGeneration: number;
}>;

export const RELEASE_AUTHORITY_UNVERIFIED_REASONS = Object.freeze([
  "verifierUnconfigured", "signatureUnverified", "authorityUnrecognized", "dispositionUnresolved",
  "revoked", "certificationUnverified", "providerEligibilityUnverified", "inputMismatch", "error",
] as const);
export type ReleaseAuthorityUnverifiedReason = typeof RELEASE_AUTHORITY_UNVERIFIED_REASONS[number];

export type ReleaseAuthorityVerdict = ReleaseAuthorityVerified |
  Readonly<{ verdict: "unverified"; reason: ReleaseAuthorityUnverifiedReason }>;

export interface ReleaseAuthorityVerifier {
  verify(input: ReleaseAuthorityInput): Promise<ReleaseAuthorityVerdict>;
}

/** The only production verifier. Always unverified, so Teacher Units stays unavailable.
 * There is no runtime switch that selects another implementation. */
export const UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER: ReleaseAuthorityVerifier = Object.freeze({
  verify(): Promise<ReleaseAuthorityVerdict> {
    return Promise.resolve(Object.freeze({ verdict: "unverified", reason: "verifierUnconfigured" } as const));
  },
});

const verifiedRule = object({
  verdict: literal("verified"), releaseId: digest, deploymentApprovalRef: evidenceReferenceRule,
  activationEvidenceRef: evidenceReferenceRule, activationApprovalRef: evidenceReferenceRule,
  certificationEvidenceRef: evidenceReferenceRule, hostingCandidateFingerprint: digest,
  policyInstanceId: uuid, enabledGeneration: generation,
});
const unverifiedRule = object({ verdict: literal("unverified"), reason: literal(...RELEASE_AUTHORITY_UNVERIFIED_REASONS) });

const VERIFIED_KEYS: readonly string[] = Object.freeze(["verdict", "releaseId", "deploymentApprovalRef",
  "activationEvidenceRef", "activationApprovalRef", "certificationEvidenceRef", "hostingCandidateFingerprint",
  "policyInstanceId", "enabledGeneration"]);
const UNVERIFIED_KEYS: readonly string[] = Object.freeze(["verdict", "reason"]);

/** Strict verdict parsing. Any non-plain, unknown, partial or extra-field result is unverified.
 * The supplied object is inspected for shape (type, array, prototype) without reading any
 * property, then its own-property descriptors are captured exactly once with a single
 * `Object.getOwnPropertyDescriptors` call. Every later check uses only that capture: the
 * complete own-key set (string or symbol, enumerable or not) must equal the approved key
 * set for its verdict kind, and every property must be an enumerable data property.
 * Values are then defined (never assigned, so names such as `__proto__` cannot invoke
 * inherited setters) on a fresh object, which alone is validated and returned frozen. The
 * supplied object, including a stateful Proxy, is never read again. */
export function parseReleaseAuthorityVerdict(value: unknown): ReleaseAuthorityVerdict {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("plain record");
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("plain record");
    // The only read of the caller's properties.
    const descriptors: Record<PropertyKey, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) throw new Error("symbol key");
    const verdictDescriptor = Object.hasOwn(descriptors, "verdict") ? descriptors.verdict : undefined;
    const kind: unknown = verdictDescriptor && Object.hasOwn(verdictDescriptor, "value") ? verdictDescriptor.value : undefined;
    const expected = kind === "verified" ? VERIFIED_KEYS : UNVERIFIED_KEYS;
    if (keys.length !== expected.length || !expected.every(key => keys.includes(key))) throw new Error("exact keys");
    const snapshot: Record<string, unknown> = {};
    for (const key of expected) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value") ||
          Object.hasOwn(descriptor, "get") || Object.hasOwn(descriptor, "set")) throw new Error("descriptor");
      Object.defineProperty(snapshot, key, { value: descriptor.value, enumerable: true, writable: false, configurable: false });
    }
    if (Reflect.ownKeys(snapshot).length !== expected.length) throw new Error("snapshot keys");
    // Validation reads only the fresh snapshot.
    if (kind === "verified") verifiedRule(snapshot, "$");
    else unverifiedRule(snapshot, "$");
    return Object.freeze(snapshot) as ReleaseAuthorityVerdict;
  } catch {
    return Object.freeze({ verdict: "unverified", reason: "error" } as const);
  }
}
