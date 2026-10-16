/** A3-6 S1 artifact-pinned approval authority registry
 * (docs/platform/U2_6_A3_6_DECISION_RECORD.md, D2 to D4).
 *
 * Public keys only, compiled into the artifact so they are covered by the runtime
 * payload fingerprint. Never read from Firestore, environment variables or secrets.
 * The production registry is empty: no key confers authority until a separately
 * authorized policy-controlled build pins one. Nothing here is wired into enforcement. */
import { createPublicKey } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type * as C from "./a3-contracts";
import { canonicalJSON, parseStrictJSON, sha256Bytes } from "./a3-canonical";
import { isPrimeOrderEd25519PublicKey } from "./a3-ed25519";
import { array, digest, literal, object, pattern, plainRecord, refuse, text, validate } from "./a3-protocol";
import type { Rule, StructuralResult } from "./a3-protocol";
import { assertIdentity } from "./a3-validation";

export const AUTHORITY_ACTIONS = Object.freeze([
  "deploy-backend", "certify-release", "activate-teacher-units", "dispose-approval",
] as const);
export type AuthorityAction = typeof AUTHORITY_ACTIONS[number];

/** One key, one environment, one action (D4 option 4b). */
export type AuthorityRegistryEntryV1 = C.EnvironmentBinding & {
  schemaVersion: 1; keyId: string; publicKeyBase64: string; action: AuthorityAction;
  authorityId: string; approverSubject: string; approvalSystemId: string;
};
export type AuthorityRegistry = Readonly<{ entries: readonly Readonly<AuthorityRegistryEntryV1>[] }>;

// RFC 8410 SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DEMO_PROJECT = /^demo-[a-z0-9-]+$/;
// Partial structural guard for D4 "no automated signers": refuses Google service-account
// emails and IAM principal identifiers that name groups, domains, service accounts or
// workload identities. It cannot prove a subject is a human; key custody (D3) does that.
const AUTOMATED_SUBJECT = /(@[a-z0-9.-]+\.gserviceaccount\.com$)|(^(serviceAccount|group|domain|principal|principalSet):)/i;

/** D3: lowercase hex SHA-256 of the raw 32-byte Ed25519 public key. */
export function ed25519KeyId(rawPublicKey: Uint8Array): string {
  if (rawPublicKey.length !== 32) throw new Error("raw Ed25519 public key must be 32 bytes");
  return sha256Bytes(rawPublicKey);
}

/** Canonical padded base64 of exactly 32 bytes. */
export function decodeRawPublicKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("noncanonical public key encoding");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) throw new Error("noncanonical public key encoding");
  return bytes;
}

export function ed25519PublicKeyObject(rawPublicKey: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]), format: "der", type: "spki" });
}

const entryIdentity: Rule = (v, p) => {
  const e = v as C.EnvironmentBinding;
  if (e.environment === "emulator") {
    // Teacher Units emulator identities are demo- projects only (A3-3 Decision 3).
    if (e.projectNumber !== "0" || !DEMO_PROJECT.test(e.projectId)) refuse(p, "emulator entries require a demo- project");
  } else {
    try { assertIdentity(e); } catch { refuse(p, "project/environment mismatch"); }
  }
};

const entryRule: Rule = (v, p) => {
  object({
    schemaVersion: literal(1), environment: literal("production", "staging", "emulator"),
    projectId: pattern(/^[a-z][a-z0-9-]*$/), projectNumber: pattern(/^(?:0|[1-9][0-9]*)$/),
    keyId: digest, publicKeyBase64: text, action: literal(...AUTHORITY_ACTIONS),
    authorityId: text, approverSubject: text, approvalSystemId: text,
  })(v, p);
  entryIdentity(v, p);
  const e = v as AuthorityRegistryEntryV1;
  if (AUTOMATED_SUBJECT.test(e.approverSubject)) refuse(`${p}.approverSubject`, "automated approver subjects prohibited");
  let raw: Buffer;
  try { raw = decodeRawPublicKey(e.publicKeyBase64); } catch { return refuse(`${p}.publicKeyBase64`, "noncanonical public key encoding"); }
  if (ed25519KeyId(raw) !== e.keyId) refuse(`${p}.keyId`, "keyId must be the SHA-256 of the raw public key");
  // Small-order and mixed-order keys would let a fixed signature verify arbitrary statements.
  if (!isPrimeOrderEd25519PublicKey(raw)) refuse(`${p}.publicKeyBase64`, "public key must be a prime-order Ed25519 point");
  try { ed25519PublicKeyObject(raw); } catch { refuse(`${p}.publicKeyBase64`, "unusable Ed25519 public key"); }
};

// Strictly ascending keyId: canonical order, and no key is ever shared between
// entries, so no key serves two actions or two environments (D3, D4 4b).
const registryRule = array(entryRule, v => String(plainRecord(v, "$").keyId));

// Registries produced by createAuthorityRegistry. Lookups refuse any other object.
const VALIDATED = new WeakSet<object>();

export function isAuthorityRegistry(value: unknown): value is AuthorityRegistry {
  return value !== null && typeof value === "object" && VALIDATED.has(value);
}

/** Reads the caller's value once (canonical serialization refuses accessors, hidden
 * fields and non-plain values), validates that private copy, and returns it frozen. */
export function createAuthorityRegistry(entries: unknown): StructuralResult<AuthorityRegistry> {
  let copy: unknown;
  try { copy = parseStrictJSON(canonicalJSON(entries)); } catch {
    return validate(() => refuse("$", "unreadable registry input"), undefined);
  }
  const checked = validate<AuthorityRegistryEntryV1[]>(registryRule, copy);
  if (!checked.ok) return checked;
  const frozen = checked.value.map(entry => Object.freeze(entry));
  const registry: AuthorityRegistry = Object.freeze({ entries: Object.freeze(frozen) });
  VALIDATED.add(registry);
  return Object.freeze({ ok: true, value: registry, scope: "structure-only", operationalVerification: "unverified" } as const);
}

function requireRegistry(entries: unknown): AuthorityRegistry {
  const result = createAuthorityRegistry(entries);
  if (!result.ok) throw new Error(`invalid authority registry: ${result.issue.path} ${result.issue.reason}`);
  return result.value;
}

/** The only production registry. Empty: every signature is authorityUnrecognized.
 * Populating it is a code change that rides a separately authorized
 * policy-controlled build (D2, D12). */
export const PRODUCTION_AUTHORITY_REGISTRY: AuthorityRegistry = requireRegistry([]);

/** Undefined for an unknown keyId or for any registry not produced by createAuthorityRegistry. */
export function findAuthorityEntry(registry: unknown, keyId: string): Readonly<AuthorityRegistryEntryV1> | undefined {
  if (!isAuthorityRegistry(registry)) return undefined;
  return registry.entries.find(entry => entry.keyId === keyId);
}
