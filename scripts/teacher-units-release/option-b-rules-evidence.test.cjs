'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const R = require('./option-b-rules-evidence.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(comparison = 'reviewed-equivalent') {
  const local = Buffer.from('rules_version = "2"; // synthetic local default deny\n');
  const deployed = comparison === 'exact' ? local : Buffer.from('rules_version = "2"; // synthetic deployed default deny\n');
  const reportObject = { kind: 'lyfelabz.teacherUnitsOptionBRulesReport', schemaVersion: 1, matrixVersion: R.MATRIX_VERSION,
    localSource: { bytesBase64: local.toString('base64'), sha256: sha(local) },
    deployedSource: { bytesBase64: deployed.toString('base64'), sha256: sha(deployed) },
    tool: { name: 'synthetic-test-only', version: '1', dependencies: [{ name: '@firebase/rules-unit-testing', version: '3.0.4' }] },
    results: R.requiredCases().map(row => ({ ...row, actualLocal: row.expected, actualDeployed: row.expected, result: 'pass' })),
    sourceReview: { fullDiffReviewed: true, unrelatedChanges: false, accessBroadening: false, summary: 'Synthetic unit fixture, never real Rules approval.' } };
  const report = Buffer.from(JSON.stringify(reportObject));
  const approval = { kind: R.KIND, schemaVersion: 1, projectId: 'lyfelabz-staging', projectNumber: '293337283840', databaseId: '(default)',
    releaseSourceSha: 'a'.repeat(40), backendBuildId: 'b'.repeat(64), hostingArtifactFingerprint: 'c'.repeat(64), placementFingerprint: 'd'.repeat(64),
    localRulesSourceHash: sha(local), approvedRulesetResource: 'projects/lyfelabz-staging/rulesets/synthetic-ruleset', approvedDeployedSourceHash: sha(deployed), comparison,
    testEvidence: { reportSha256: sha(report), reportRef: '/private/synthetic/rules-report.json', testedLocalSourceHash: sha(local), testedDeployedSourceHash: sha(deployed), matrixVersion: R.MATRIX_VERSION, result: 'pass' },
    review: { principalSubject: 'synthetic-reviewer@example.test', decisionRef: 'synthetic-owner-decision', reviewedAt: '2026-10-26T00:00:00.000Z' } };
  const expectations = { projectId: approval.projectId, projectNumber: approval.projectNumber, databaseId: approval.databaseId, releaseSourceSha: approval.releaseSourceSha,
    backendBuildId: approval.backendBuildId, hostingArtifactFingerprint: approval.hostingArtifactFingerprint, placementFingerprint: approval.placementFingerprint,
    localRulesSourceHash: approval.localRulesSourceHash, observedRulesetResource: approval.approvedRulesetResource, observedSourceHash: approval.approvedDeployedSourceHash,
    approvalDigest: R.digestApproval(approval), report };
  return { approval, report, reportObject, expectations };
}
function rebind(f) {
  f.expectations.report = Buffer.from(JSON.stringify(f.reportObject));
  f.approval.testEvidence.reportSha256 = sha(f.expectations.report);
  f.expectations.approvalDigest = R.digestApproval(f.approval);
}
if (require.main === module) {
  for (const mode of ['exact', 'reviewed-equivalent']) test(`${mode} requires exact independently supplied observed state and approval`, () => {
    const f = fixture(mode), result = R.validateRulesEvidence(JSON.stringify(f.approval), f.expectations);
    assert.equal(result.comparison, mode); assert.equal(result.approvalDigest, f.expectations.approvalDigest);
    assert.equal(result.rulesetResource, f.approval.approvedRulesetResource); assert.equal(result.reportSha256, sha(f.report));
  });
  test('project-number provider resource is accepted only by exact observed identity', () => {
    const f = fixture();
    f.approval.approvedRulesetResource = `projects/${f.approval.projectNumber}/rulesets/synthetic-ruleset`;
    f.expectations.observedRulesetResource = f.approval.approvedRulesetResource;
    f.expectations.approvalDigest = R.digestApproval(f.approval);
    assert.equal(R.validateRulesEvidence(f.approval, f.expectations).rulesetResource, f.approval.approvedRulesetResource);
    f.expectations.observedRulesetResource = `projects/${f.approval.projectId}/rulesets/synthetic-ruleset`;
    assert.throws(() => R.validateRulesEvidence(f.approval, f.expectations), /REFUSED/);
  });
  test('wrong resource with identical source bytes is refused', () => {
    const f = fixture(); f.expectations.observedRulesetResource += '-recreated';
    assert.throws(() => R.validateRulesEvidence(f.approval, f.expectations), /REFUSED/);
  });
  for (const field of ['projectId', 'projectNumber', 'databaseId', 'releaseSourceSha', 'backendBuildId', 'hostingArtifactFingerprint', 'placementFingerprint', 'localRulesSourceHash', 'observedSourceHash', 'approvalDigest']) test(`wrong ${field} refuses`, () => {
    const f = fixture(); f.expectations[field] = 'wrong'; assert.throws(() => R.validateRulesEvidence(f.approval, f.expectations), /REFUSED/);
  });
  test('missing, old, unknown and nested surplus attachment fields refuse', () => {
    for (const mutate of [a => delete a.review, a => { a.schemaVersion = 2; }, a => { a.kind = 'old-receipt'; }, a => { a.testEvidence.skip = true; }, a => { a.review.extra = true; }]) {
      const f = fixture(); mutate(f.approval); assert.throws(() => R.validateRulesEvidence(f.approval, f.expectations), /REFUSED/);
    }
  });
  test('duplicate decoded JSON keys at every level refuse before parsing can discard them', () => {
    const f = fixture();
    for (const source of [JSON.stringify(f.approval).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'), JSON.stringify(f.approval).replace('"result":"pass"', '"result":"pass","resu\\u006ct":"pass"')]) assert.throws(() => R.validateRulesEvidence(source, f.expectations), /REFUSED/);
    const report = f.report.toString().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
    f.expectations.report = report; f.approval.testEvidence.reportSha256 = sha(report); f.expectations.approvalDigest = R.digestApproval(f.approval);
    assert.throws(() => R.validateRulesEvidence(f.approval, f.expectations), /REFUSED/);
  });
  test('tampered report bytes, whitespace, attachment and object-only report refuse', () => {
    for (const mutate of [f => { f.expectations.report = Buffer.concat([f.report, Buffer.from(' ')]); }, f => { f.approval.review.decisionRef = 'changed'; }, f => { f.expectations.report = f.reportObject; }]) {
      const f = fixture(); mutate(f); assert.throws(() => R.validateRulesEvidence(f.approval, f.expectations), /REFUSED/);
    }
  });
  test('exact mode cannot bless unequal source hashes', () => { const f = fixture(); f.approval.comparison = 'exact'; assert.throws(() => R.digestApproval(f.approval), /REFUSED/); });
  test('report requires complete unique executed denial and unchanged-access matrix', () => {
    for (const mutate of [r => r.results.pop(), r => { r.results[1] = r.results[0]; }, r => { r.results[0].role = 'unknown'; }, r => { r.results[0].actualDeployed = 'allow'; }, r => { r.results[0].result = 'skip'; }, r => { r.results[0].extra = true; }, r => { r.results = r.results.filter(c => c.role !== 'owner'); }, r => { r.results = r.results.filter(c => c.resource !== 'teacherUnitsAvailabilityHistory'); }, r => { r.results = r.results.filter(c => !c.resource.startsWith('collection-group:')); }, r => { r.results = r.results.filter(c => c.resource !== 'existing-own-profile'); }]) {
      const f = fixture(); mutate(f.reportObject); rebind(f); assert.throws(() => R.validateRulesEvidence(f.approval, f.expectations), /REFUSED/);
    }
  });
  test('source hashes without exact source bytes, tool dependencies or full source review refuse', () => {
    for (const mutate of [r => delete r.localSource.bytesBase64, r => { r.deployedSource.bytesBase64 = Buffer.from('unreviewed').toString('base64'); }, r => { r.tool.dependencies = []; }, r => { r.sourceReview.fullDiffReviewed = false; }, r => { r.sourceReview.unrelatedChanges = true; }, r => { r.sourceReview.accessBroadening = true; }, r => { r.matrixVersion = 'unknown'; }]) {
      const f = fixture(); mutate(f.reportObject); rebind(f); assert.throws(() => R.validateRulesEvidence(f.approval, f.expectations), /REFUSED/);
    }
  });
  test('malformed review, failed evidence, wrong pair and nonlocal report refs refuse', () => {
    for (const mutate of [a => { a.review.principalSubject = ''; }, a => { a.review.reviewedAt = '2026-02-30T00:00:00.000Z'; }, a => { a.review.decisionRef = ''; }, a => { a.testEvidence.result = 'fail'; }, a => { a.testEvidence.reportRef = 'https://example.test/report'; }, a => { a.testEvidence.testedLocalSourceHash = 'f'.repeat(64); }]) {
      const f = fixture(); mutate(f.approval); assert.throws(() => R.validateRulesEvidence(f.approval, f.expectations), /REFUSED/);
    }
  });
  test('plain object accessors, symbols, unsafe numbers and wrong report encoding refuse', () => {
    const f = fixture(); const hostile = { ...f.approval }; Object.defineProperty(hostile, 'review', { enumerable: true, get() { throw Error('must not invoke'); } });
    assert.throws(() => R.validateRulesEvidence(hostile, f.expectations), /REFUSED/);
    assert.throws(() => R.parseApproval('{"x":9007199254740993}'), /REFUSED/);
    assert.throws(() => R.parseApproval(Buffer.from([0xff])), /REFUSED/);
  });
}
module.exports = { fixture, rebind };
