/** Supplied-record consistency only. Never grants availability or authority. */
import type * as C from "./a3-contracts";
import { canonicalJSON, contentDigest, evidenceRef, parseStrictJSON } from "./a3-canonical";
import { array, compatibilityRule, digest, generation, plainRecord, refuse, text, validate } from "./a3-protocol";
import type { MutationCompatibilityV1, StructuralResult } from "./a3-protocol";
import { evidenceReferenceRule, validateActivationApproval, validateActivationEvidence, validateApprovalDisposition,
  validateAvailabilityHistory, validateBackendRelease, validateDeploymentApproval, validatePolicy,
  validateReleaseCertification } from "./a3-validation";
export type EvidenceDocument = C.ActivationEvidenceDocumentV1 | C.DeploymentApprovalDocumentV1 | C.ActivationApprovalDocumentV1 |
  C.ApprovalDispositionDocumentV1 | C.ReleaseCertificationDocumentV1;
function checked<T>(r: StructuralResult<T>): T { if (!r.ok) refuse(r.issue.path, r.issue.reason); return r.value; }
const equal = (a: unknown, b: unknown, reason: string): void => { if (canonicalJSON(a) !== canonicalJSON(b)) refuse("$", reason); };
const identity = (v: C.EnvironmentBinding): unknown => ({ environment: v.environment, projectId: v.projectId, projectNumber: v.projectNumber });
export function validateReleaseReference(ref: unknown, document: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.BackendReleaseDocumentV1> {
  return validate((v, p) => { const r = checked(validateBackendRelease(v, expected));
    if (typeof ref !== "string" || !/^teacherUnitsBackendReleases\/[a-f0-9]{64}$/.test(ref) || ref !== `teacherUnitsBackendReleases/${contentDigest(r.manifest)}`) refuse(p, "release path/manifest digest mismatch"); }, document);
}
export function validateEvidenceReference(ref: unknown, document: unknown, expected?: C.ExpectedEnvironment): StructuralResult<EvidenceDocument> {
  return validate((v, p) => {
    evidenceReferenceRule(ref, p);
    const input = plainRecord(v, p), payload = plainRecord(input.payload, p);
    let record: EvidenceDocument;
    switch (payload.kind) {
      case "teacher-units-activation": record = checked(validateActivationEvidence(v, expected)); break;
      case "teacher-units-deployment-approval": record = checked(validateDeploymentApproval(v, expected)); break;
      case "teacher-units-activation-approval": record = checked(validateActivationApproval(v, expected)); break;
      case "teacher-units-approval-disposition": record = checked(validateApprovalDisposition(v, expected)); break;
      case "teacher-units-release-certification": record = checked(validateReleaseCertification(v, expected)); break;
      default: return refuse(p, "unsupported evidence kind");
    }
    if (ref !== evidenceRef(record.payload)) refuse(p, "evidence path/payload digest mismatch");
    if (record.payload.kind === "teacher-units-activation" && [record.payload.certificationEvidenceRef, record.payload.authorizationEvidenceRef].includes(ref)) refuse(p, "self reference");
    if (record.payload.kind === "teacher-units-approval-disposition" && [record.payload.statement.targetApprovalRef, record.payload.statement.replacementApprovalRef].includes(ref)) refuse(p, "self reference");
  }, document);
}
export function validateDeploymentBinding(release: unknown, approval: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.BackendReleaseDocumentV1> {
  return validate((v, p) => {
    const r = checked(validateBackendRelease(v, expected)), a = checked(validateDeploymentApproval(approval, expected));
    checked(validateEvidenceReference(r.manifest.deploymentApprovalEvidenceRef, a, expected)); equal(identity(r.manifest), identity(a.payload.statement), "deployment environment mismatch");
    for (const key of ["sourceSha", "sourceTree", "runtimePayloadFingerprint", "functionsArtifactFingerprint", "placementFingerprint", "enforcementVersion", "deploymentMode"] as const)
      if (r.manifest[key] !== a.payload.statement.candidate[key]) refuse(p, `candidate ${key} mismatch`);
    if (r.manifest.supportedClientContractVersions[0] !== a.payload.statement.candidate.clientContractVersion) refuse(p, "candidate contract mismatch");
  }, release);
}
export function validateActivationBinding(policy: unknown, release: unknown, evidence: unknown, approval: unknown,
  hostingFingerprint: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.ActivationEvidenceDocumentV1> {
  return validate((v, p) => {
    const pol = checked(validatePolicy(policy, expected)), r = checked(validateBackendRelease(release, expected));
    const e = checked(validateActivationEvidence(v, expected)), a = checked(validateActivationApproval(approval, expected));
    if (pol.mode !== "enabled") refuse(p, "closed policy cannot pass enabled binding"); digest(hostingFingerprint, p);
    checked(validateEvidenceReference(pol.activationEvidenceRef, e, expected)); checked(validateEvidenceReference(e.payload.authorizationEvidenceRef, a, expected));
    for (const record of [r.manifest, e.payload, a.payload.statement]) equal(identity(pol), identity(record), "activation environment mismatch");
    if (pol.backendReleaseEligibility?.releaseId !== contentDigest(r.manifest) || e.payload.backendReleaseId !== contentDigest(r.manifest) ||
        pol.policyInstanceId !== e.payload.policyInstanceId || pol.generation !== e.payload.enabledGeneration ||
        pol.placementFingerprint !== e.payload.placementFingerprint || pol.placementFingerprint !== r.manifest.placementFingerprint ||
        e.payload.hostingCandidateFingerprint !== hostingFingerprint) refuse(p, "policy/release/hosting binding mismatch");
    for (const key of ["policyInstanceId", "enabledGeneration", "backendReleaseId", "clientContractVersion", "placementFingerprint", "hostingCandidateFingerprint", "certificationEvidenceRef"] as const)
      if (e.payload[key] !== a.payload.statement[key]) refuse(p, `activation approval ${key} mismatch`);
    if (e.payload.certificationEvidenceRef === e.payload.authorizationEvidenceRef) refuse(p, "certification and approval must be distinct");
    // Certification assertions and source authority remain a later operational gate.
  }, evidence);
}
export function validateMutationBinding(policy: unknown, envelope: unknown, expected?: C.ExpectedEnvironment): StructuralResult<MutationCompatibilityV1> {
  return validate((v, p) => { compatibilityRule(v, p); const c = v as MutationCompatibilityV1, pol = checked(validatePolicy(policy, expected));
    if (pol.mode !== "enabled") refuse(p, "availability closed");
    if (pol.policyInstanceId !== c.policyInstanceId || pol.generation !== c.policyGeneration || pol.backendReleaseEligibility?.releaseId !== c.backendReleaseId) refuse(p, "policy instance/generation/release changed");
    if (pol.placementFingerprint !== c.placementFingerprint) refuse(p, "placement mismatch"); }, envelope);
}
function policyContent(p: C.TeacherUnitsAvailabilityPolicyV1): unknown {
  const { generation: ignored, updatedAt, ...content } = p; void ignored;
  return { ...content, updatedAt: { seconds: updatedAt.seconds, nanoseconds: updatedAt.nanoseconds } };
}
export function validatePolicyTransition(previous: unknown, next: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.TeacherUnitsAvailabilityPolicyV1> {
  return validate((v, p) => {
    const before = checked(validatePolicy(previous, expected)), after = checked(validatePolicy(v, expected));
    for (const key of ["schemaVersion", "policyInstanceId", "projectId", "projectNumber", "environment", "region", "databaseId"] as const)
      if (before[key] !== after[key]) refuse(p, "immutable policy identity changed");
    if (canonicalJSON(policyContent(before)) === canonicalJSON(policyContent(after))) {
      if (before.generation !== after.generation) refuse(p, "no-op generation changed"); return;
    }
    if (before.generation === Number.MAX_SAFE_INTEGER || after.generation !== before.generation + 1) refuse(p, "generation must increment exactly once without overflow");
    const configChanged = canonicalJSON(before.backendReleaseEligibility) !== canonicalJSON(after.backendReleaseEligibility) ||
      before.placementFingerprint !== after.placementFingerprint || canonicalJSON(before.acceptedClientContractVersions) !== canonicalJSON(after.acceptedClientContractVersions);
    const shutdownClear = before.mode === "enabled" && after.mode === "closed" && after.backendReleaseEligibility === null && before.placementFingerprint === after.placementFingerprint;
    if (configChanged && !(before.mode === "closed" && after.mode === "closed") && !shutdownClear) refuse(p, "release/contract/placement preparation requires closure");
  }, next);
}
export function validateInitialPolicy(v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.TeacherUnitsAvailabilityPolicyV1> {
  return validate((value, p) => { const pol = checked(validatePolicy(value, expected));
    if (pol.generation !== 1 || pol.mode !== "closed" || pol.backendReleaseEligibility !== null || pol.activationEvidenceRef !== null) refuse(p, "initial policy must be generation one, closed, without release/evidence"); }, v);
}
export function validateNextGeneration(v: unknown): StructuralResult<number> {
  const current = validate<number>((value, p) => { generation(value, p); if (value === Number.MAX_SAFE_INTEGER) refuse(p, "generation exhausted"); }, v);
  return current.ok ? validate(generation, current.value + 1) : current;
}
export function validatePlacementContent(ids: unknown, expectedDigest: unknown): StructuralResult<string[]> {
  return validate((v, p) => { array(text)(v, p); const list = v as string[];
    if (!list.length || new Set(list).size !== list.length) refuse(p, "nonempty unique placement IDs required");
    digest(expectedDigest, p); if (contentDigest(v) !== expectedDigest) refuse(p, "placement content mismatch"); }, ids);
}
export function validateImmutableDuplicate(ref: unknown, existing: unknown, proposed: unknown, expected?: C.ExpectedEnvironment): StructuralResult<unknown> {
  return validate((v, p) => {
    if (typeof ref === "string" && ref.startsWith("teacherUnitsBackendReleases/")) {
      checked(validateReleaseReference(ref, existing, expected)); checked(validateReleaseReference(ref, v, expected));
    } else if (typeof ref === "string" && ref.startsWith("teacherUnitsAvailabilityHistory/")) {
      // A3-6 S2 (D8): create-only history; an identical retry is a validated duplicate.
      checked(validateAvailabilityHistoryReference(ref, existing, expected)); checked(validateAvailabilityHistoryReference(ref, v, expected));
    } else { checked(validateEvidenceReference(ref, existing, expected)); checked(validateEvidenceReference(ref, v, expected)); }
    if (canonicalJSON(existing) !== canonicalJSON(v)) refuse(p, "immutable duplicate conflict");
  }, proposed);
}
// Disposition targets: approvals and, since A3-6 S2 (D7 fix 3), certifications.
// A supersede replacement is always the target's own kind.
type DisposableDocument = C.DeploymentApprovalDocumentV1 | C.ActivationApprovalDocumentV1 | C.ReleaseCertificationDocumentV1;
const disposable = (d: EvidenceDocument): d is DisposableDocument => d.payload.kind === "teacher-units-deployment-approval" ||
  d.payload.kind === "teacher-units-activation-approval" || d.payload.kind === "teacher-units-release-certification";
export function validateDispositionBinding(disposition: unknown, target: unknown, replacement: unknown,
  expected?: C.ExpectedEnvironment): StructuralResult<C.ApprovalDispositionDocumentV1> {
  return validate((v, p) => {
    const d = checked(validateApprovalDisposition(v, expected)), s = d.payload.statement;
    const t = checked(validateEvidenceReference(s.targetApprovalRef, target, expected));
    if (!disposable(t)) return refuse(p, "target must be an approval or certification");
    equal(identity(s), identity(t.payload.statement), "disposition environment mismatch");
    if (s.action === "revoke") { if (replacement !== null) refuse(p, "revoke cannot replace"); }
    else {
      const r = checked(validateEvidenceReference(s.replacementApprovalRef, replacement, expected));
      if (!disposable(r)) return refuse(p, "replacement must be an approval or certification");
      if (r.payload.kind !== t.payload.kind) refuse(p, "replacement approval action mismatch");
      equal(identity(s), identity(r.payload.statement), "replacement environment mismatch");
    }
  }, disposition);
}
/** A3-6 S2 (D7): the certification named by an activation approval certifies exactly
 * the release, Hosting candidate, placement and contracts that approval activates.
 * Structural consistency only; signatures and authority are checked separately (S3). */
export function validateCertificationBinding(certification: unknown, activationApproval: unknown, release: unknown,
  expected?: C.ExpectedEnvironment): StructuralResult<C.ReleaseCertificationDocumentV1> {
  return validate((v, p) => {
    const a = checked(validateActivationApproval(activationApproval, expected)), r = checked(validateBackendRelease(release, expected));
    const s = a.payload.statement;
    const c = checked(validateEvidenceReference(s.certificationEvidenceRef, v, expected));
    if (c.payload.kind !== "teacher-units-release-certification") refuse(p, "certification evidence required");
    const cs = c.payload.statement;
    equal(identity(cs), identity(s), "certification environment mismatch"); equal(identity(cs), identity(r.manifest), "certification environment mismatch");
    if (cs.backendReleaseId !== s.backendReleaseId || cs.backendReleaseId !== contentDigest(r.manifest)) refuse(p, "certification release mismatch");
    if (cs.hostingCandidateFingerprint !== s.hostingCandidateFingerprint) refuse(p, "certification hosting mismatch");
    if (cs.placementFingerprint !== s.placementFingerprint || cs.placementFingerprint !== r.manifest.placementFingerprint) refuse(p, "certification placement mismatch");
    if (cs.enforcementVersion !== r.manifest.enforcementVersion) refuse(p, "certification enforcement mismatch");
    if (cs.clientContractVersion !== s.clientContractVersion || cs.clientContractVersion !== r.manifest.supportedClientContractVersions[0]) refuse(p, "certification contract mismatch");
  }, certification);
}
/** D8 policy digest: the whole policy with `updatedAt` projected as explicit seconds
 * and nanoseconds. Requires a valid policy, so a server-timestamp sentinel is refused. */
export function availabilityPolicyDigest(policy: unknown, expected?: C.ExpectedEnvironment): StructuralResult<string> {
  const result = validatePolicy(policy, expected);
  if (!result.ok) return result;
  const { updatedAt, ...rest } = result.value;
  return validate(digest, contentDigest({ ...rest, updatedAt: { seconds: updatedAt.seconds, nanoseconds: updatedAt.nanoseconds } }));
}
export const AVAILABILITY_HISTORY_REF = /^teacherUnitsAvailabilityHistory\/[a-f0-9]{64}$/;
/** D8 fix 4: the document lives at the SHA-256 of its canonical body. */
export function validateAvailabilityHistoryReference(ref: unknown, document: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.AvailabilityHistoryDocumentV1> {
  return validate((v, p) => { const h = checked(validateAvailabilityHistory(v, expected));
    if (typeof ref !== "string" || !AVAILABILITY_HISTORY_REF.test(ref) || ref !== `teacherUnitsAvailabilityHistory/${contentDigest(h)}`) refuse(p, "history path/content digest mismatch"); }, document);
}
/** D8: the recorded transition is exactly the canonical transition from `previous`
 * (null only for initialize) to `next`. A noop or an enabled-to-enabled change has no
 * approved kind and is refused. Does not read or write storage. */
export function validateAvailabilityHistoryBinding(history: unknown, previous: unknown, next: unknown,
  expected?: C.ExpectedEnvironment): StructuralResult<C.AvailabilityHistoryDocumentV1> {
  return validate((v, p) => {
    const h = checked(validateAvailabilityHistory(v, expected)), after = checked(validatePolicy(next, expected));
    equal(identity(h), identity(after), "history environment mismatch");
    if (h.policyInstanceId !== after.policyInstanceId || h.nextGeneration !== after.generation) refuse(p, "history generation mismatch");
    if (h.nextPolicyDigest !== checked(availabilityPolicyDigest(after, expected))) refuse(p, "next policy digest mismatch");
    let transition: C.AvailabilityTransitionV1;
    if (previous === null) { checked(validateInitialPolicy(after, expected)); transition = "initialize"; }
    else {
      const before = checked(validatePolicy(previous, expected));
      checked(validatePolicyTransition(before, after, expected));
      if (h.previousPolicyDigest !== checked(availabilityPolicyDigest(before, expected))) refuse(p, "previous policy digest mismatch");
      if (before.generation === after.generation) refuse(p, "noop history is never written");
      if (before.mode === "closed") transition = after.mode === "closed" ? "prepare" : "enable";
      else if (after.mode === "closed") transition = "shutdown";
      else return refuse(p, "transition has no approved history kind");
    }
    if (h.transition !== transition) refuse(p, "history transition mismatch");
    if (transition === "enable" && !h.evidenceRefs.includes(after.activationEvidenceRef as string)) refuse(p, "enable must record its activation evidence");
    if (transition === "prepare" && after.backendReleaseEligibility &&
        !h.evidenceRefs.includes(`teacherUnitsBackendReleases/${after.backendReleaseEligibility.releaseId}`)) refuse(p, "prepare must record its release");
  }, history);
}
export type RepeatedHistoryGeneration = Readonly<{ policyInstanceId: string; nextGeneration: number; refs: readonly string[] }>;
/** D8 fix 4 reporting: groups content-validated history records by the generation
 * they produced and returns every group with more than one record (rollback
 * evidence). Uses only the retained records, never the current policy. Reports;
 * it never refuses a transition. Any invalid record refuses the whole report. */
export function reportRepeatedHistoryGenerations(records: unknown, expected?: C.ExpectedEnvironment): StructuralResult<RepeatedHistoryGeneration[]> {
  let copy: unknown;
  try { copy = parseStrictJSON(canonicalJSON(records)); } catch { return validate(() => refuse("$", "unreadable history records"), undefined); }
  let repeated: RepeatedHistoryGeneration[] = [];
  const checkedRecords = validate((v, p) => {
    array(plainRecord)(v, p);
    const groups = new Map<string, { policyInstanceId: string; nextGeneration: number; refs: string[] }>();
    let environment: string | undefined;
    for (const [i, record] of (v as Array<Record<string, unknown>>).entries()) {
      if (Object.keys(record).length !== 2 || !Object.hasOwn(record, "ref") || !Object.hasOwn(record, "document")) refuse(`${p}[${i}]`, "exact fields required");
      const h = checked(validateAvailabilityHistoryReference(record.ref, record.document, expected));
      const key = canonicalJSON(identity(h));
      if (environment !== undefined && environment !== key) refuse(`${p}[${i}]`, "history environment mismatch");
      environment = key;
      const group = `${h.policyInstanceId}/${h.nextGeneration}`;
      const entry = groups.get(group) ?? { policyInstanceId: h.policyInstanceId, nextGeneration: h.nextGeneration, refs: [] };
      if (entry.refs.includes(record.ref as string)) refuse(`${p}[${i}]`, "duplicate history record");
      entry.refs.push(record.ref as string); groups.set(group, entry);
    }
    repeated = [...groups.values()].filter(g => g.refs.length > 1)
      .sort((a, b) => a.policyInstanceId < b.policyInstanceId ? -1 : a.policyInstanceId > b.policyInstanceId ? 1 : a.nextGeneration - b.nextGeneration)
      .map(g => Object.freeze({ ...g, refs: Object.freeze([...g.refs].sort()) }));
  }, copy);
  if (!checkedRecords.ok) return checkedRecords;
  return validate<RepeatedHistoryGeneration[]>(() => undefined, Object.freeze(repeated));
}
