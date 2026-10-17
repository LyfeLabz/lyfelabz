// A3-6 S2 certification statement (D7), certification dispositions (D7 fix 3),
// certification-to-activation binding and availability history (D8). Synthetic
// records only; signatures here are untrusted zero bytes.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { contentDigest, evidenceRef } from "./a3-canonical";
import type { ExpectedEnvironment } from "./a3-contracts";
import * as B from "./a3-bindings";
import * as V from "./a3-validation";
import type { StructuralResult } from "./a3-protocol";

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../../../fixtures/teacher-units-a3/v1.json"), "utf8"));
const valid = fixture.valid;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const STAGING: ExpectedEnvironment = { environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840" };
const PRODUCTION: ExpectedEnvironment = { environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" };
const EMULATOR = fixture.expectedEmulator as ExpectedEnvironment;
const ok = (r: StructuralResult<unknown>): void => expect(r).toMatchObject({ ok: true, scope: "structure-only", operationalVerification: "unverified" });
const no = (r: StructuralResult<unknown>): void => expect(r.ok).toBe(false);
const reshape = (doc: any): any => { doc.payload.source.statementObject.sha256 = contentDigest(doc.payload.statement); return doc; };
const certification = (edit: (s: any) => void = () => undefined): any => { const d = clone(valid.releaseCertification); edit(d.payload.statement); return reshape(d); };
const certRef = (doc: any): string => evidenceRef(doc.payload);
/** Activation approval whose certificationEvidenceRef names `cert`. */
const approvalFor = (cert: any, edit: (s: any) => void = () => undefined): any => {
  const a = clone(valid.activationApproval); a.payload.statement.certificationEvidenceRef = certRef(cert); edit(a.payload.statement); return reshape(a);
};
const policy = (v: any, overrides: Record<string, unknown> = {}): any =>
  ({ ...clone(v), updatedAt: new Timestamp(v.updatedAt.seconds, v.updatedAt.nanoseconds), ...overrides });

describe("D7 release certification statement", () => {
  it("the fixture is a structurally valid, unverified certification", () => {
    ok(V.validateReleaseCertification(valid.releaseCertification));
    ok(V.validateReleaseCertificationStatement(valid.releaseCertification.payload.statement, STAGING));
    ok(B.validateEvidenceReference(certRef(valid.releaseCertification), valid.releaseCertification));
  });

  it("binds exactly the approved fields and no policy instance or generation", () => {
    expect(Object.keys(valid.releaseCertification.payload.statement).sort()).toEqual([
      "action", "authority", "backendReleaseId", "certificationReport", "clientContractVersion", "enforcementVersion",
      "environment", "hostingCandidateFingerprint", "issuedAt", "kind", "placementFingerprint", "projectId", "projectNumber", "schemaVersion",
    ]);
    for (const field of ["policyInstanceId", "enabledGeneration", "generation"]) no(V.validateReleaseCertification(certification(s => { s[field] = 1; })));
  });

  it("refuses the wrong action, kind or statement digest", () => {
    for (const action of ["activate-teacher-units", "deploy-backend", "dispose-approval", "revoke"]) no(V.validateReleaseCertification(certification(s => { s.action = action; })));
    const mixed = clone(valid.releaseCertification); mixed.payload.kind = "teacher-units-activation-approval"; no(V.validateReleaseCertification(mixed));
    no(V.validateActivationApproval(mixed));
    const stale = clone(valid.releaseCertification); stale.payload.statement.hostingCandidateFingerprint = "0".repeat(64); no(V.validateReleaseCertification(stale));
    const forgedReport = certification(s => { s.certificationReport.sha256 = "not-a-digest"; }); no(V.validateReleaseCertification(forgedReport));
  });

  it("is bound to one environment identity (cross-environment and cross-project replay)", () => {
    no(V.validateReleaseCertification(valid.releaseCertification, PRODUCTION));
    no(V.validateReleaseCertification(valid.releaseCertification, EMULATOR));
    no(V.validateReleaseCertification(certification(s => { s.projectNumber = "182791689935"; })));
    no(V.validateReleaseCertification(certification(s => { s.projectId = "lyfelabz-prod"; })));
    no(V.validateReleaseCertification(certification(s => { s.environment = "production"; })));
    ok(V.validateReleaseCertification(certification(s => { Object.assign(s, PRODUCTION); }), PRODUCTION));
  });

  it("refuses accessor-based and non-plain input without invoking getters", () => {
    const doc = clone(valid.releaseCertification); let reads = 0;
    Object.defineProperty(doc.payload.statement, "backendReleaseId", { enumerable: true, get: () => { reads += 1; return valid.releaseCertification.payload.statement.backendReleaseId; } });
    no(V.validateReleaseCertification(doc)); no(B.validateEvidenceReference(certRef(valid.releaseCertification), doc));
    expect(reads).toBe(0);
    no(V.validateReleaseCertification(Object.assign(Object.create({ inherited: true }), clone(valid.releaseCertification))));
  });

  it("refuses a report that names the statement's own Storage object version (F3)", () => {
    const own = valid.releaseCertification.payload.source.statementObject;
    // Previously accepted: same bucket, object and generation, with a different claimed hash.
    const selfRef = certification(s => { s.certificationReport = { ...own, sha256: "9".repeat(64) }; });
    expect(selfRef.payload.statement.certificationReport.sha256).not.toBe(own.sha256);
    expect(V.validateReleaseCertification(selfRef)).toMatchObject({ ok: false, issue: { reason: "self-referential certification report" } });
    no(B.validateEvidenceReference(certRef(selfRef), selfRef));
    no(V.validateReleaseCertification(certification(s => { s.certificationReport = { ...own }; })));
  });

  it("accepts an independent report that only shares a bucket, object name or hash pattern", () => {
    const own = valid.releaseCertification.payload.source.statementObject;
    ok(V.validateReleaseCertification(certification(s => { s.certificationReport = { ...s.certificationReport, bucket: own.bucket }; })));
    ok(V.validateReleaseCertification(certification(s => { s.certificationReport = { ...own, object: "teacher-units-certification-report.json" }; })));
    ok(V.validateReleaseCertification(certification(s => { s.certificationReport = { ...own, generation: "2" }; })));
    ok(V.validateReleaseCertification(certification(s => { s.certificationReport = { ...own, bucket: "a3-test-reports" }; })));
  });

  it("is a content-addressed evidence document with immutable duplicates", () => {
    const ref = certRef(valid.releaseCertification);
    no(B.validateEvidenceReference(`teacherUnitsReleaseEvidence/${contentDigest(valid.releaseCertification)}`, valid.releaseCertification));
    ok(B.validateImmutableDuplicate(ref, valid.releaseCertification, clone(valid.releaseCertification)));
    no(B.validateImmutableDuplicate(ref, valid.releaseCertification, certification(s => { s.authority.decisionId = "other"; })));
    // A same-digest proposal that differs only outside the payload is still a conflict.
    no(B.validateImmutableDuplicate(ref, valid.releaseCertification, { ...clone(valid.releaseCertification), schemaVersion: 2 }));
  });

  it("existing evidence kinds keep their established behavior", () => {
    ok(B.validateEvidenceReference(evidenceRef(valid.deploymentApproval.payload), valid.deploymentApproval));
    ok(B.validateEvidenceReference(evidenceRef(valid.activationApproval.payload), valid.activationApproval));
    ok(B.validateEvidenceReference(evidenceRef(valid.activationEvidence.payload), valid.activationEvidence));
    ok(B.validateEvidenceReference(evidenceRef(valid.approvalDisposition.payload), valid.approvalDisposition));
    const unknown = clone(valid.releaseCertification); unknown.payload.kind = "teacher-units-certification-report";
    expect(B.validateEvidenceReference(certRef(unknown), unknown)).toMatchObject({ ok: false, issue: { reason: "unsupported evidence kind" } });
  });
});

describe("D7 fix 3 certification dispositions", () => {
  const disposition = (target: any, replacement: any): any => {
    const d = clone(valid.approvalDisposition);
    d.payload.statement.targetApprovalRef = evidenceRef(target.payload);
    d.payload.statement.action = replacement ? "supersede" : "revoke";
    d.payload.statement.replacementApprovalRef = replacement ? evidenceRef(replacement.payload) : null;
    return reshape(d);
  };
  const replacementCert = certification(s => { s.authority.decisionId = "fixed-replacement-002"; });

  it("revokes a certification", () => {
    ok(B.validateDispositionBinding(disposition(valid.releaseCertification, null), valid.releaseCertification, null));
    no(B.validateDispositionBinding(disposition(valid.releaseCertification, null), valid.releaseCertification, replacementCert));
  });
  it("supersedes a certification only with another certification", () => {
    ok(B.validateDispositionBinding(disposition(valid.releaseCertification, replacementCert), valid.releaseCertification, replacementCert));
    no(B.validateDispositionBinding(disposition(valid.releaseCertification, valid.activationApproval), valid.releaseCertification, valid.activationApproval));
    no(B.validateDispositionBinding(disposition(valid.activationApproval, valid.releaseCertification), valid.activationApproval, valid.releaseCertification));
    no(B.validateDispositionBinding(disposition(valid.deploymentApproval, valid.releaseCertification), valid.deploymentApproval, valid.releaseCertification));
  });
  it("refuses a certification for another environment and non-disposable targets", () => {
    const prodCert = certification(s => { Object.assign(s, PRODUCTION); });
    no(B.validateDispositionBinding(disposition(prodCert, null), prodCert, null));
    no(B.validateDispositionBinding(disposition(valid.activationEvidence, null), valid.activationEvidence, null));
    no(B.validateDispositionBinding(disposition(valid.approvalDisposition, null), valid.approvalDisposition, null));
  });
  it("the existing approval disposition behavior is unchanged", () => {
    ok(B.validateDispositionBinding(valid.approvalDisposition, valid.deploymentApproval, null));
    no(B.validateDispositionBinding(valid.approvalDisposition, valid.activationApproval, null));
  });
});

describe("certification-to-activation binding", () => {
  const cert = valid.releaseCertification;
  it("accepts the certification its activation approval names, for the exact release", () => {
    ok(V.validateActivationApproval(approvalFor(cert)));
    expect(cert.payload.statement.backendReleaseId).toBe(contentDigest(valid.backendRelease.manifest));
    ok(B.validateCertificationBinding(cert, approvalFor(cert), valid.backendRelease));
  });
  it("refuses a certification the approval does not name", () => {
    no(B.validateCertificationBinding(cert, valid.activationApproval, valid.backendRelease));
    const other = certification(s => { s.authority.decisionId = "other"; });
    no(B.validateCertificationBinding(other, approvalFor(cert), valid.backendRelease));
  });
  it("refuses non-certification evidence at the certification reference", () => {
    const a = clone(valid.activationApproval); a.payload.statement.certificationEvidenceRef = evidenceRef(valid.deploymentApproval.payload); reshape(a);
    no(B.validateCertificationBinding(valid.deploymentApproval, a, valid.backendRelease));
  });
  it.each([
    ["backendReleaseId", "f".repeat(64)],
    ["hostingCandidateFingerprint", "0".repeat(64)],
    ["placementFingerprint", "0".repeat(64)],
  ])("refuses a certification whose %s differs from the activation approval", (field, value) => {
    const c = certification(s => { s[field] = value; });
    no(B.validateCertificationBinding(c, approvalFor(c), valid.backendRelease));
  });
  it.each([
    ["backendReleaseId", "f".repeat(64)],
    ["placementFingerprint", "0".repeat(64)],
  ])("refuses a release that the certification and approval agree on but is not this %s", (field, value) => {
    const c = certification(s => { s[field] = value; });
    no(B.validateCertificationBinding(c, approvalFor(c, s => { s[field] = value; }), valid.backendRelease));
  });
  it.each([
    ["backendReleaseId", "f".repeat(64)],
    ["hostingCandidateFingerprint", "0".repeat(64)],
    ["placementFingerprint", "0".repeat(64)],
  ])("refuses an approval that names this certification but activates another %s", (field, value) => {
    no(B.validateCertificationBinding(cert, approvalFor(cert, s => { s[field] = value; }), valid.backendRelease));
  });
  it("names the refusal when the certification reference holds another evidence kind", () => {
    const a = clone(valid.activationApproval); a.payload.statement.certificationEvidenceRef = evidenceRef(valid.activationApproval.payload); reshape(a);
    expect(B.validateCertificationBinding(valid.activationApproval, a, valid.backendRelease))
      .toMatchObject({ ok: false, issue: { reason: "certification evidence required" } });
  });
  it("refuses another enforcement or contract version (single canonical literals)", () => {
    for (const [field, value] of [["enforcementVersion", "teacher-units-a3-v2"], ["clientContractVersion", "teacher-units-v1"]]) {
      const c = certification(s => { s[field] = value; });
      no(B.validateCertificationBinding(c, approvalFor(c), valid.backendRelease));
    }
  });
  it("refuses a certification for another environment", () => {
    const c = certification(s => { Object.assign(s, PRODUCTION); });
    no(B.validateCertificationBinding(c, approvalFor(c), valid.backendRelease));
    no(B.validateCertificationBinding(cert, approvalFor(cert), valid.backendRelease, PRODUCTION));
  });
  it("leaves the A3-1 activation binding unchanged", () => {
    const a = approvalFor(cert);
    const e = clone(valid.activationEvidence);
    e.payload.certificationEvidenceRef = certRef(cert); e.payload.authorizationEvidenceRef = evidenceRef(a.payload);
    const pol = policy(valid.enabledPolicy, { activationEvidenceRef: evidenceRef(e.payload) });
    ok(B.validateActivationBinding(pol, valid.backendRelease, e, a, "c".repeat(64)));
  });
});

describe("D8 availability history", () => {
  const closed = policy(valid.closedPolicy);
  const prepared = { ...closed, generation: 2, backendReleaseEligibility: { releaseId: contentDigest(valid.backendRelease.manifest) },
    updatedAt: new Timestamp(1767323100, 5) };
  const enabled = policy(valid.enabledPolicy, { generation: 3 });
  const shutdown = { ...enabled, mode: "closed", generation: 4, activationEvidenceRef: null, updatedAt: new Timestamp(1767323200, 0) };
  const digestOf = (p: unknown): string => { const r = B.availabilityPolicyDigest(p); if (!r.ok) throw new Error(r.issue.reason); return r.value; };
  const history = (transition: string, previous: any, next: any, evidenceRefs: string[]): any => ({
    environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840", schemaVersion: 1,
    kind: "teacher-units-availability-history", transition, policyInstanceId: next.policyInstanceId, nextGeneration: next.generation,
    previousPolicyDigest: previous ? digestOf(previous) : null, nextPolicyDigest: digestOf(next),
    evidenceRefs, operatorSubject: "test-operator", reason: "Synthetic transition.",
  });
  const releaseRef = `teacherUnitsBackendReleases/${contentDigest(valid.backendRelease.manifest)}`;
  const historyRef = (h: unknown): string => `teacherUnitsAvailabilityHistory/${contentDigest(h)}`;

  it("the fixture is a structurally valid history document", () => {
    ok(V.validateAvailabilityHistory(valid.availabilityHistory));
    ok(B.validateAvailabilityHistoryReference(historyRef(valid.availabilityHistory), valid.availabilityHistory));
    no(V.validateAvailabilityHistory(valid.availabilityHistory, PRODUCTION));
  });

  it("policy digests project updatedAt as explicit seconds and nanoseconds", () => {
    const rest: Record<string, unknown> = { ...prepared }; delete rest.updatedAt;
    expect(digestOf(prepared)).toBe(contentDigest({ ...rest, updatedAt: { seconds: 1767323100, nanoseconds: 5 } }));
    expect(digestOf(prepared)).not.toBe(digestOf({ ...prepared, updatedAt: new Timestamp(1767323100, 6) }));
    expect(digestOf(prepared)).not.toBe(digestOf({ ...prepared, generation: 3 }));
  });

  it("refuses a server timestamp sentinel or a JSON timestamp in either policy", () => {
    const { FieldValue } = jest.requireActual("firebase-admin/firestore");
    no(B.availabilityPolicyDigest({ ...prepared, updatedAt: FieldValue.serverTimestamp() }));
    no(B.availabilityPolicyDigest({ ...prepared, updatedAt: { seconds: 1767323100, nanoseconds: 5 } }));
    const h = history("prepare", closed, prepared, [releaseRef]);
    no(B.validateAvailabilityHistoryBinding(h, closed, { ...prepared, updatedAt: FieldValue.serverTimestamp() }));
    no(B.validateAvailabilityHistoryBinding(h, { ...closed, updatedAt: FieldValue.serverTimestamp() }, prepared));
  });

  it.each([
    ["initialize", null, closed, []],
    ["prepare", closed, prepared, [releaseRef]],
    ["enable", prepared, enabled, [enabled.activationEvidenceRef]],
    ["shutdown", enabled, shutdown, []],
  ] as Array<[string, any, any, string[]]>)("records the canonical %s transition", (transition, previous, next, refs) => {
    const h = history(transition, previous, next, refs);
    ok(B.validateAvailabilityHistoryBinding(h, previous, next));
    ok(B.validateAvailabilityHistoryReference(historyRef(h), h));
    for (const other of ["initialize", "prepare", "enable", "shutdown"].filter(t => t !== transition))
      no(B.validateAvailabilityHistoryBinding({ ...h, transition: other }, previous, next));
  });

  it("only initialize omits the previous policy", () => {
    const h = history("prepare", closed, prepared, [releaseRef]);
    no(V.validateAvailabilityHistory({ ...h, previousPolicyDigest: null }));
    no(V.validateAvailabilityHistory({ ...history("initialize", null, closed, []), previousPolicyDigest: digestOf(prepared) }));
  });

  it("never records a noop", () => {
    no(V.validateAvailabilityHistory({ ...history("prepare", closed, prepared, [releaseRef]), transition: "noop" }));
    const same = { ...history("prepare", closed, prepared, [releaseRef]), previousPolicyDigest: digestOf(prepared) };
    no(V.validateAvailabilityHistory(same));
    for (const t of ["prepare", "shutdown"]) no(B.validateAvailabilityHistoryBinding({ ...history(t, closed, prepared, []), nextPolicyDigest: digestOf(closed) }, closed, closed));
  });

  it("refuses a transition the canonical policy semantics refuse, or one with no approved kind", () => {
    no(B.validateAvailabilityHistoryBinding(history("enable", closed, enabled, [enabled.activationEvidenceRef]), closed, enabled));
    const reenabled = { ...enabled, generation: 4, updatedAt: new Timestamp(1767323300, 0) };
    for (const t of ["enable", "shutdown", "prepare"]) no(B.validateAvailabilityHistoryBinding(history(t, enabled, reenabled, [enabled.activationEvidenceRef]), enabled, reenabled));
    no(B.validateAvailabilityHistoryBinding(history("initialize", null, enabled, []), null, enabled));
  });

  it("requires the evidence the transition used", () => {
    no(B.validateAvailabilityHistoryBinding(history("enable", prepared, enabled, [releaseRef]), prepared, enabled));
    no(B.validateAvailabilityHistoryBinding(history("prepare", closed, prepared, []), closed, prepared));
    no(V.validateAvailabilityHistory(history("initialize", null, closed, [releaseRef])));
  });

  it("refuses mismatched or malformed policy digests", () => {
    const h = history("prepare", closed, prepared, [releaseRef]);
    no(B.validateAvailabilityHistoryBinding({ ...h, nextPolicyDigest: "0".repeat(64) }, closed, prepared));
    no(B.validateAvailabilityHistoryBinding({ ...h, previousPolicyDigest: "0".repeat(64) }, closed, prepared));
    for (const bad of ["A".repeat(64), "0".repeat(63), `sha256:${"0".repeat(64)}`, 7])
      no(V.validateAvailabilityHistory({ ...h, nextPolicyDigest: bad }));
  });

  it("refuses unsorted, duplicate or non-content-addressed evidence references", () => {
    const base = history("shutdown", enabled, shutdown, []);
    const a = `teacherUnitsReleaseEvidence/${"3".repeat(64)}`, b = `teacherUnitsReleaseEvidence/${"4".repeat(64)}`;
    ok(V.validateAvailabilityHistory({ ...base, evidenceRefs: [releaseRef, a, b].sort() }));
    no(V.validateAvailabilityHistory({ ...base, evidenceRefs: [b, a] }));
    no(V.validateAvailabilityHistory({ ...base, evidenceRefs: [a, a] }));
    for (const ref of ["platformConfig/teacherUnitsAvailability", `teacherUnitsAvailabilityHistory/${"3".repeat(64)}`, `teacherUnitsReleaseEvidence/${"3".repeat(64)}/x`])
      no(V.validateAvailabilityHistory({ ...base, evidenceRefs: [ref] }));
  });

  it("is bound to the policy environment", () => {
    const h = history("prepare", closed, prepared, [releaseRef]);
    no(B.validateAvailabilityHistoryBinding({ ...h, ...PRODUCTION }, closed, prepared));
    no(B.validateAvailabilityHistoryBinding(h, closed, prepared, PRODUCTION));
  });

  it("is stored only at the digest of its canonical body", () => {
    const h = history("prepare", closed, prepared, [releaseRef]);
    no(B.validateAvailabilityHistoryReference(`teacherUnitsAvailabilityHistory/${"0".repeat(64)}`, h));
    no(B.validateAvailabilityHistoryReference(`teacherUnitsReleaseEvidence/${contentDigest(h)}`, h));
    no(B.validateAvailabilityHistoryReference(historyRef(h), { ...h, reason: "edited" }));
    no(B.validateAvailabilityHistoryReference(historyRef(h).toUpperCase(), h));
  });

  it("refuses accessor-based and incomplete documents", () => {
    const h = history("prepare", closed, prepared, [releaseRef]);
    let reads = 0;
    const accessor = { ...h }; Object.defineProperty(accessor, "reason", { enumerable: true, get: () => { reads += 1; return "x"; } });
    no(V.validateAvailabilityHistory(accessor)); expect(reads).toBe(0);
    for (const key of Object.keys(h)) { const copy: any = { ...h }; delete copy[key]; no(V.validateAvailabilityHistory(copy)); }
    no(V.validateAvailabilityHistory({ ...h, operatorSubject: "" }));
    no(V.validateAvailabilityHistory({ ...h, reason: "" }));
    no(V.validateAvailabilityHistory({ ...h, recordedAt: new Timestamp(1, 0) }));
  });
});

describe("D8 generation identity and repeated-generation reporting (F2)", () => {
  const closed = policy(valid.closedPolicy);
  const releaseId = contentDigest(valid.backendRelease.manifest);
  const releaseRef = `teacherUnitsBackendReleases/${releaseId}`;
  const at = (seconds: number): Timestamp => new Timestamp(seconds, 0);
  const prepared = { ...closed, generation: 2, backendReleaseEligibility: { releaseId }, updatedAt: at(1767323100) };
  const enabled = policy(valid.enabledPolicy, { generation: 3, updatedAt: at(1767323200) });
  const shutdown = (seconds: number): any => ({ ...enabled, mode: "closed", generation: 4, activationEvidenceRef: null, updatedAt: at(seconds) });
  const digestOf = (p: unknown): string => { const r = B.availabilityPolicyDigest(p); if (!r.ok) throw new Error(r.issue.reason); return r.value; };
  const history = (transition: string, previous: any, next: any, evidenceRefs: string[], reason = "Synthetic transition."): any => ({
    environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840", schemaVersion: 1,
    kind: "teacher-units-availability-history", transition, policyInstanceId: next.policyInstanceId, nextGeneration: next.generation,
    previousPolicyDigest: previous ? digestOf(previous) : null, nextPolicyDigest: digestOf(next), evidenceRefs, operatorSubject: "test-operator", reason,
  });
  const record = (h: any): any => ({ ref: `teacherUnitsAvailabilityHistory/${contentDigest(h)}`, document: h });

  it("binds the next policy's instance and generation", () => {
    const h = history("prepare", closed, prepared, [releaseRef]);
    ok(B.validateAvailabilityHistoryBinding(h, closed, prepared));
    no(B.validateAvailabilityHistoryBinding({ ...h, nextGeneration: 3 }, closed, prepared));
    no(B.validateAvailabilityHistoryBinding({ ...h, nextGeneration: 1 }, closed, prepared));
    no(B.validateAvailabilityHistoryBinding({ ...h, policyInstanceId: "123e4567-e89b-42d3-b456-426614174000" }, closed, prepared));
    ok(V.validateAvailabilityHistory(history("initialize", null, closed, [])));
    no(V.validateAvailabilityHistory({ ...history("initialize", null, closed, []), nextGeneration: 2 }));
    no(V.validateAvailabilityHistory({ ...h, nextGeneration: 1 }));
    for (const bad of [0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) no(V.validateAvailabilityHistory({ ...h, nextGeneration: bad }));
  });

  it("reports repeated generations from retained records alone, after the policy is overwritten", () => {
    // Original lifecycle: initialize (1), prepare (2), enable (3), shutdown (4).
    const lifecycle = [history("initialize", null, closed, []), history("prepare", closed, prepared, [releaseRef]),
      history("enable", prepared, enabled, [enabled.activationEvidenceRef]), history("shutdown", enabled, shutdown(1767323300), [])];
    // A D1-B rollback rewrites the policy back to enabled generation 3; the next
    // shutdown produces a second, distinct record for generation 4. It is not blocked.
    const second = history("shutdown", enabled, shutdown(1767323400), [], "Second shutdown after rollback.");
    ok(B.validateAvailabilityHistoryBinding(second, enabled, shutdown(1767323400)));
    const records = [...lifecycle, second].map(record);
    // No policy is supplied: the report reads only the retained history records.
    const result = B.reportRepeatedHistoryGenerations(records, STAGING);
    if (!result.ok) throw new Error(result.issue.reason);
    expect(result.value).toEqual([{ policyInstanceId: closed.policyInstanceId, nextGeneration: 4,
      refs: [records[3].ref, records[4].ref].sort() }]);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value[0].refs)).toBe(true);
    const clean = B.reportRepeatedHistoryGenerations(lifecycle.map(record), STAGING);
    expect(clean).toMatchObject({ ok: true, value: [] });
    expect(B.reportRepeatedHistoryGenerations([], STAGING)).toMatchObject({ ok: true, value: [] });
  });

  it("does not group different policy instances", () => {
    const otherInstance = "123e4567-e89b-42d3-b456-426614174000";
    const a = history("initialize", null, closed, []);
    const b = history("initialize", null, { ...closed, policyInstanceId: otherInstance }, []);
    expect(B.reportRepeatedHistoryGenerations([record(a), record(b)], STAGING)).toMatchObject({ ok: true, value: [] });
  });

  it("refuses an invalid, misaddressed, duplicated, mixed-environment or accessor-based record set", () => {
    const h = history("prepare", closed, prepared, [releaseRef]), r = record(h);
    no(B.reportRepeatedHistoryGenerations([{ ...r, ref: `teacherUnitsAvailabilityHistory/${"0".repeat(64)}` }], STAGING));
    no(B.reportRepeatedHistoryGenerations([{ ...r, document: { ...h, reason: "edited" } }], STAGING));
    no(B.reportRepeatedHistoryGenerations([r, r], STAGING));
    no(B.reportRepeatedHistoryGenerations([{ ...r, extra: true }], STAGING));
    no(B.reportRepeatedHistoryGenerations([r], PRODUCTION));
    const prod = { ...h, ...PRODUCTION };
    no(B.reportRepeatedHistoryGenerations([r, record(prod)]));
    for (const bad of [null, {}, "x", [null], [[]]]) no(B.reportRepeatedHistoryGenerations(bad, STAGING));
    let reads = 0;
    const accessor = { ...r }; Object.defineProperty(accessor, "document", { enumerable: true, get: () => { reads += 1; return h; } });
    no(B.reportRepeatedHistoryGenerations([accessor], STAGING)); expect(reads).toBe(0);
  });

  it("reports from one snapshot: a record whose ref changes after it is read cannot inject a reference", () => {
    const first = record(history("shutdown", enabled, shutdown(1767323300), []));
    const second = record(history("shutdown", enabled, shutdown(1767323400), [], "Second."));
    let reads = 0;
    const injected = `teacherUnitsAvailabilityHistory/${"f".repeat(64)}`;
    const stateful = new Proxy({ ...first }, { get: (target, key) => key === "ref" && ++reads > 2 ? injected : Reflect.get(target, key) });
    const result = B.reportRepeatedHistoryGenerations([stateful, second], STAGING);
    if (!result.ok) throw new Error(result.issue.reason);
    expect(result.value).toEqual([{ policyInstanceId: closed.policyInstanceId, nextGeneration: 4, refs: [first.ref, second.ref].sort() }]);
  });
});

describe("history immutable duplicates (F4, S2 portion)", () => {
  const closed = policy(valid.closedPolicy);
  const h = { environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840", schemaVersion: 1,
    kind: "teacher-units-availability-history", transition: "initialize", policyInstanceId: closed.policyInstanceId, nextGeneration: 1,
    previousPolicyDigest: null, nextPolicyDigest: (B.availabilityPolicyDigest(closed) as { value: string }).value,
    evidenceRefs: [], operatorSubject: "test-operator", reason: "Synthetic initialize." };
  const ref = `teacherUnitsAvailabilityHistory/${contentDigest(h)}`;

  it("an identical retry at the content address is a validated duplicate", () => {
    ok(B.validateImmutableDuplicate(ref, h, clone(h)));
    ok(B.validateImmutableDuplicate(ref, h, Object.fromEntries(Object.entries(h).reverse())));
  });
  it("any different proposal at that address is a conflict", () => {
    no(B.validateImmutableDuplicate(ref, h, { ...h, reason: "different" }));
    no(B.validateImmutableDuplicate(ref, h, { ...h, operatorSubject: "other-operator" }));
    no(B.validateImmutableDuplicate(ref, { ...h, reason: "different" }, h));
    no(B.validateImmutableDuplicate(`teacherUnitsAvailabilityHistory/${"0".repeat(64)}`, h, clone(h)));
    no(B.validateImmutableDuplicate(ref, h, { ...h, ...PRODUCTION }));
    no(B.validateImmutableDuplicate(ref, h, clone(h), PRODUCTION));
  });
  it("a history document is never accepted at an evidence or release address", () => {
    no(B.validateImmutableDuplicate(`teacherUnitsReleaseEvidence/${contentDigest(h)}`, h, clone(h)));
    no(B.validateImmutableDuplicate(`teacherUnitsBackendReleases/${contentDigest(h)}`, h, clone(h)));
  });
});

describe("not wired (S2)", () => {
  it("no non-test source module calls the S2 binding validators", () => {
    const root = resolve(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string): void => { for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path); else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
    } };
    walk(root);
    expect(files.length).toBeGreaterThan(50);
    const S2 = /validateCertificationBinding|validateAvailabilityHistory|availabilityPolicyDigest|validateReleaseCertification|reportRepeatedHistoryGenerations/;
    for (const file of files) {
      const name = relative(root, file);
      if (name === "teacherUnits/a3-bindings.ts" || name === "teacherUnits/a3-validation.ts" || name === "teacherUnits/a3-signature.ts") continue;
      // A3-6 S3 (owner decision O5): the unwired composite verifier (see a3-composite-verifier.test.ts).
      if (name === "teacherUnits/a3-composite-verifier.ts") continue;
      expect([name, S2.test(readFileSync(file, "utf8"))]).toEqual([name, false]);
    }
  });
});
