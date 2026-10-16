/** A3-6 S1 approval signature verification
 * (docs/platform/U2_6_A3_6_DECISION_RECORD.md, D2 to D4).
 *
 * Pure: no I/O, no clock, no cache. Verifies one approval document's Ed25519
 * signature over the A3-1 domain-separated signing bytes against an
 * artifact-pinned registry entry for the exact environment, action and authority.
 * A verified signature is one necessary input to a future release-authority
 * verdict (S3); it is never availability, activation or deployment permission.
 * Not wired into enforcement: production still uses the UNCONFIGURED verifier. */
import { verify } from "node:crypto";
import type * as C from "./a3-contracts";
import { approvalSigningBytes, canonicalJSON, parseStrictJSON } from "./a3-canonical";
import { decodeRawPublicKey, ed25519KeyId, ed25519PublicKeyObject, findAuthorityEntry } from "./a3-authority-registry";
import type { AuthorityAction } from "./a3-authority-registry";
import { validateActivationApproval, validateApprovalDisposition, validateDeploymentApproval } from "./a3-validation";

export type SignatureVerification =
  | Readonly<{ verdict: "verified"; keyId: string; action: AuthorityAction; authorityId: string }>
  | Readonly<{ verdict: "unverified"; reason: "inputMismatch" | "authorityUnrecognized" | "signatureUnverified" }>;

type ApprovalDocument = C.DeploymentApprovalDocumentV1 | C.ActivationApprovalDocumentV1 | C.ApprovalDispositionDocumentV1;

const unverified = (reason: "inputMismatch" | "authorityUnrecognized" | "signatureUnverified"): SignatureVerification =>
  Object.freeze({ verdict: "unverified", reason });

const KINDS: Readonly<Record<string, { action: AuthorityAction;
  validate: (v: unknown, e: C.ExpectedEnvironment) => { ok: boolean } }>> = Object.freeze({
  "teacher-units-deployment-approval": { action: "deploy-backend", validate: validateDeploymentApproval },
  "teacher-units-activation-approval": { action: "activate-teacher-units", validate: validateActivationApproval },
  "teacher-units-approval-disposition": { action: "dispose-approval", validate: validateApprovalDisposition },
});

// Reads the caller's value once: canonical serialization refuses accessors, hidden
// fields and non-plain values, and every later check uses only the parsed copy.
function snapshot(value: unknown): unknown {
  return parseStrictJSON(canonicalJSON(value));
}

/** `registry` must come from createAuthorityRegistry; any other object recognizes no signer. */
export function verifyApprovalSignature(document: unknown, registry: unknown,
  expected: C.ExpectedEnvironment): SignatureVerification {
  let approval: ApprovalDocument;
  let action: AuthorityAction;
  try {
    const copy = snapshot(document) as { payload?: { kind?: unknown } } | null;
    const kind = copy !== null && typeof copy === "object" && copy.payload !== null && typeof copy.payload === "object"
      ? copy.payload.kind : undefined;
    const spec = typeof kind === "string" && Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
    if (!spec || !spec.validate(copy, expected).ok) return unverified("inputMismatch");
    approval = copy as ApprovalDocument;
    action = spec.action;
  } catch {
    return unverified("inputMismatch");
  }
  const { statement, source } = approval.payload;
  // Authority: any failure to resolve or bind the signer is authorityUnrecognized.
  let publicKey: ReturnType<typeof ed25519PublicKeyObject>;
  let entry: ReturnType<typeof findAuthorityEntry>;
  try {
    entry = findAuthorityEntry(registry, source.signerKeyId);
    if (!entry) return unverified("authorityUnrecognized");
    if (entry.environment !== statement.environment || entry.projectId !== statement.projectId ||
        entry.projectNumber !== statement.projectNumber || entry.action !== action ||
        entry.authorityId !== statement.authority.authorityId || entry.approverSubject !== statement.authority.approverSubject ||
        entry.approvalSystemId !== statement.authority.approvalSystemId) return unverified("authorityUnrecognized");
    const raw = decodeRawPublicKey(entry.publicKeyBase64);
    if (ed25519KeyId(raw) !== source.signerKeyId) return unverified("authorityUnrecognized");
    publicKey = ed25519PublicKeyObject(raw);
  } catch {
    return unverified("authorityUnrecognized");
  }
  // Signature: only the cryptographic check itself.
  try {
    const signature = Buffer.from(source.signatureBase64, "base64");
    if (signature.length !== 64 || !verify(null, approvalSigningBytes(statement), publicKey, signature)) return unverified("signatureUnverified");
  } catch {
    return unverified("signatureUnverified");
  }
  return Object.freeze({ verdict: "verified", keyId: entry.keyId, action, authorityId: entry.authorityId });
}
