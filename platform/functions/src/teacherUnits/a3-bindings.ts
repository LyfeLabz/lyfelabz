/** Supplied-record consistency only. Never grants availability or authority. */
import type * as C from "./a3-contracts";
import { canonicalJSON, contentDigest, evidenceRef } from "./a3-canonical";
import { array, compatibilityRule, digest, generation, plainRecord, refuse, text, validate } from "./a3-protocol";
import type { MutationCompatibilityV1, StructuralResult } from "./a3-protocol";
import { evidenceReferenceRule, validateActivationApproval, validateActivationEvidence, validateApprovalDisposition,
  validateBackendRelease, validateDeploymentApproval, validatePolicy } from "./a3-validation";
export type EvidenceDocument = C.ActivationEvidenceDocumentV1 | C.DeploymentApprovalDocumentV1 | C.ActivationApprovalDocumentV1 | C.ApprovalDispositionDocumentV1;
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
      default: return refuse(p, "unsupported evidence kind; certification belongs to later integration");
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
    } else { checked(validateEvidenceReference(ref, existing, expected)); checked(validateEvidenceReference(ref, v, expected)); }
    if (canonicalJSON(existing) !== canonicalJSON(v)) refuse(p, "immutable duplicate conflict");
  }, proposed);
}
export function validateDispositionBinding(disposition: unknown, target: unknown, replacement: unknown,
  expected?: C.ExpectedEnvironment): StructuralResult<C.ApprovalDispositionDocumentV1> {
  return validate((v, p) => {
    const d = checked(validateApprovalDisposition(v, expected)), s = d.payload.statement;
    const t = checked(validateEvidenceReference(s.targetApprovalRef, target, expected));
    if (t.payload.kind !== "teacher-units-deployment-approval" && t.payload.kind !== "teacher-units-activation-approval") refuse(p, "target must be an approval");
    equal(identity(s), identity(t.payload.statement), "disposition environment mismatch");
    if (s.action === "revoke") { if (replacement !== null) refuse(p, "revoke cannot replace"); }
    else {
      const r = checked(validateEvidenceReference(s.replacementApprovalRef, replacement, expected));
      if (r.payload.kind !== "teacher-units-deployment-approval" && r.payload.kind !== "teacher-units-activation-approval") refuse(p, "replacement must be an approval");
      if (r.payload.kind !== t.payload.kind) refuse(p, "replacement approval action mismatch");
      equal(identity(s), identity(r.payload.statement), "replacement environment mismatch");
    }
  }, disposition);
}
