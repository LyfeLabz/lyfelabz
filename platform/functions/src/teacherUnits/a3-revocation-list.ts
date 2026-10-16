/** A3-6 S2 artifact-pinned revocation list (docs/platform/U2_6_A3_6_DECISION_RECORD.md, D5 R2).
 *
 * Under R2 a revocation is a signed disposition (audit record), an immediate shutdown
 * and a redeploy that ships an artifact change. This list is that artifact change:
 * revoked approval or certification evidence references pinned in compiled code, so
 * they are covered by the runtime payload fingerprint. Pure: no I/O, no clock, no
 * lookup by target (R1 is not adopted). Not wired: production enforcement does not
 * consult it, and production still uses the UNCONFIGURED verifier. */
import type * as C from "./a3-contracts";
import { canonicalJSON, parseStrictJSON } from "./a3-canonical";
import { array, literal, object, pattern, plainRecord, refuse, validate } from "./a3-protocol";
import type { Rule, StructuralResult } from "./a3-protocol";
import { assertIdentity, evidenceReferenceRule } from "./a3-validation";

export type RevocationEntryV1 = C.EnvironmentBinding & { schemaVersion: 1; revokedEvidenceRef: string };
export type RevocationList = Readonly<{ identity: Readonly<C.EnvironmentBinding>; entries: readonly Readonly<RevocationEntryV1>[] }>;
export type RevocationStatus = "revoked" | "notRevoked" | "listUnrecognized" | "inputMismatch";

const identityRule = object({ environment: literal("production", "staging", "emulator"),
  projectId: pattern(/^[a-z][a-z0-9-]*$/), projectNumber: pattern(/^(?:0|[1-9][0-9]*)$/) });
const entryRule = (expected: C.EnvironmentBinding): Rule => (v, p) => {
  object({ schemaVersion: literal(1), environment: literal("production", "staging", "emulator"),
    projectId: pattern(/^[a-z][a-z0-9-]*$/), projectNumber: pattern(/^(?:0|[1-9][0-9]*)$/),
    revokedEvidenceRef: evidenceReferenceRule })(v, p);
  try { assertIdentity(v as C.EnvironmentBinding, expected); } catch { refuse(p, "entry environment mismatch"); }
};
// Strictly ascending reference: canonical order and no duplicate entries.
const listRule = (expected: C.EnvironmentBinding): Rule =>
  array(entryRule(expected), v => String(plainRecord(v, "$").revokedEvidenceRef));

const VALIDATED = new WeakSet<object>();

/** Reads both inputs once through canonical serialization, validates the private
 * copies and returns a frozen list bound to one environment identity. */
export function createRevocationList(entries: unknown, identity: unknown): StructuralResult<RevocationList> {
  let copy: unknown, bound: C.EnvironmentBinding;
  try {
    copy = parseStrictJSON(canonicalJSON(entries));
    bound = parseStrictJSON(canonicalJSON(identity)) as C.EnvironmentBinding;
  } catch { return validate(() => refuse("$", "unreadable revocation input"), undefined); }
  const identityCheck = validate<C.EnvironmentBinding>((v, p) => { identityRule(v, p);
    if ((v as C.EnvironmentBinding).environment === "emulator") {
      if (!/^demo-[a-z0-9-]+$/.test((v as C.EnvironmentBinding).projectId) || (v as C.EnvironmentBinding).projectNumber !== "0") refuse(p, "emulator lists require a demo- project");
    } else assertIdentity(v as C.EnvironmentBinding); }, bound);
  if (!identityCheck.ok) return identityCheck;
  const checked = validate<RevocationEntryV1[]>(listRule(bound), copy);
  if (!checked.ok) return checked;
  const list: RevocationList = Object.freeze({ identity: Object.freeze(bound),
    entries: Object.freeze(checked.value.map(entry => Object.freeze(entry))) });
  VALIDATED.add(list);
  return Object.freeze({ ok: true, value: list, scope: "structure-only", operationalVerification: "unverified" } as const);
}

export function isRevocationList(value: unknown): value is RevocationList {
  return value !== null && typeof value === "object" && VALIDATED.has(value);
}

/** Fails closed: `listUnrecognized` for any object not produced by createRevocationList
 * or bound to another identity; `inputMismatch` for a malformed expected identity or a
 * query that is not a canonical `teacherUnitsReleaseEvidence/` reference. Callers must
 * treat both as failure, never as notRevoked. The expected identity is read once. */
export function revocationStatus(list: unknown, ref: unknown, expected: unknown): RevocationStatus {
  let identity: C.EnvironmentBinding;
  try {
    // An ExpectedEnvironment may carry a local profile; only the identity is compared.
    const copy = plainRecord(parseStrictJSON(canonicalJSON(expected)), "$");
    const projected = { environment: copy.environment, projectId: copy.projectId, projectNumber: copy.projectNumber };
    identityRule(projected, "$"); identity = projected as C.EnvironmentBinding;
    evidenceReferenceRule(ref, "$");
  } catch { return "inputMismatch"; }
  if (!isRevocationList(list) || list.identity.environment !== identity.environment ||
      list.identity.projectId !== identity.projectId || list.identity.projectNumber !== identity.projectNumber) return "listUnrecognized";
  return list.entries.some(entry => entry.revokedEvidenceRef === ref) ? "revoked" : "notRevoked";
}

function requireList(entries: unknown, identity: unknown): RevocationList {
  const result = createRevocationList(entries, identity);
  if (!result.ok) throw new Error(`invalid revocation list: ${result.issue.path} ${result.issue.reason}`);
  return result.value;
}

/** The only production revocation list. Empty: no release has ever been approved.
 * Adding an entry is a code change shipped by a separately authorized revocation
 * redeploy (D5 R2 procedure requirements). */
export const PRODUCTION_REVOCATION_LIST: RevocationList = requireList([],
  { environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" });
