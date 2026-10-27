'use strict';
// Offline consistency and retained owner-review evidence, never Rules authority.
// Provider state must be independently supplied by the calling release stage.
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const KIND = 'lyfelabz.teacherUnitsOptionBRulesApproval';
const MATRIX_VERSION = 'teacher-units-rules-equivalence-v1';
const TARGETS = Object.freeze({ 'lyfelabz-prod': '182791689935', 'lyfelabz-staging': '293337283840' });
const ROLES = Object.freeze(['unauthenticated', 'owner', 'otherTeacher', 'otherSchoolTeacher', 'suspendedOwner', 'student', 'platformAdministrator']);
const RESOURCES = Object.freeze(['teacherUnits', 'teacherUnitCreateReceipts', 'platformConfig/teacherUnitsAvailability', 'teacherUnitsAvailabilityHistory', 'auditEvents', 'terminal-default-deny']);
const OPERATIONS = Object.freeze(['get', 'list', 'create', 'update', 'delete']);
function refuse(message) { throw new Error(`[option-b-rules] REFUSED: ${message}`); }
function record(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) refuse(`${label}: plain record required`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== fields.length || Object.keys(descriptors).length !== fields.length ||
      Object.entries(descriptors).some(([key, d]) => !fields.includes(key) || !d.enumerable || !Object.hasOwn(d, 'value'))) refuse(`${label}: exact fields required`);
  return value;
}
function text(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > max || /[\x00-\x1f\x7f]/u.test(value)) refuse(`${label}: bounded nonempty text required`);
}
function hash(value, label) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) refuse(`${label}: canonical SHA256 required`); }
function input(value, label) {
  if (Buffer.isBuffer(value)) {
    if (value.length > 8 * 1024 * 1024 || !Buffer.from(value.toString('utf8'), 'utf8').equals(value)) refuse(`${label}: bounded UTF8 required`);
    value = value.toString('utf8');
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 8 * 1024 * 1024) refuse(`${label}: bounded JSON required`);
    try { return K.parseStrictJSON(value); } catch { return refuse(`${label}: strict duplicate-free JSON required`); }
  }
  // Canonicalization validates descriptors, cycles, Unicode, arrays and numbers.
  try { return K.parseStrictJSON(K.canonicalJSON(value)); } catch { return refuse(`${label}: plain canonical data required`); }
}
function requiredCases() {
  return ROLES.flatMap(role => [
    ...RESOURCES.flatMap(resource => OPERATIONS.map(operation => ({ role, resource, operation, expected: 'deny' }))),
    ...['teacherUnits', 'teacherUnitCreateReceipts', 'platformConfig', 'teacherUnitsAvailabilityHistory', 'auditEvents'].map(resource => ({ role, resource: `collection-group:${resource}`, operation: 'list', expected: 'deny' })),
    { role, resource: 'existing-own-profile', operation: 'get', expected: role === 'unauthenticated' ? 'deny' : 'allow' },
  ]);
}
const FIELDS = ['kind', 'schemaVersion', 'projectId', 'projectNumber', 'databaseId', 'releaseSourceSha', 'backendBuildId', 'hostingArtifactFingerprint', 'placementFingerprint', 'localRulesSourceHash', 'approvedRulesetResource', 'approvedDeployedSourceHash', 'comparison', 'testEvidence', 'review'];
function parseApproval(value) {
  const raw = input(value, 'approval'), scoped = raw?.schemaVersion === 2;
  // E2: Rules evidence belongs to the tested source, not every Functions or
  // Hosting build. Schema 1 remains readable only for historical receipts.
  const releaseFields = ['releaseSourceSha', 'backendBuildId', 'hostingArtifactFingerprint', 'placementFingerprint'];
  const a = record(raw, scoped ? FIELDS.filter(f => !releaseFields.includes(f)) : FIELDS, 'approval');
  if (a.kind !== KIND || ![1, 2].includes(a.schemaVersion) || !Object.hasOwn(TARGETS, a.projectId) || a.projectNumber !== TARGETS[a.projectId] || a.databaseId !== '(default)') refuse('approval kind/version/target');
  if (!scoped && (typeof a.releaseSourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(a.releaseSourceSha))) refuse('release source SHA');
  for (const field of scoped ? ['localRulesSourceHash', 'approvedDeployedSourceHash'] : ['backendBuildId', 'hostingArtifactFingerprint', 'placementFingerprint', 'localRulesSourceHash', 'approvedDeployedSourceHash']) hash(a[field], field);
  const prefixes = [a.projectId, a.projectNumber].map(project => `projects/${project}/rulesets/`);
  if (typeof a.approvedRulesetResource !== 'string' || !prefixes.some(prefix => a.approvedRulesetResource.startsWith(prefix) && /^[A-Za-z0-9_-]{1,128}$/.test(a.approvedRulesetResource.slice(prefix.length)))) refuse('exact deployed ruleset resource');
  if (!['exact', 'reviewed-equivalent'].includes(a.comparison)) refuse('comparison');
  if (a.comparison === 'exact' && a.localRulesSourceHash !== a.approvedDeployedSourceHash) refuse('exact comparison hashes differ');
  const t = record(a.testEvidence, ['reportSha256', 'reportRef', 'testedLocalSourceHash', 'testedDeployedSourceHash', 'matrixVersion', 'result'], 'testEvidence');
  for (const field of ['reportSha256', 'testedLocalSourceHash', 'testedDeployedSourceHash']) hash(t[field], field);
  text(t.reportRef, 'reportRef', 1024);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t.reportRef) || t.matrixVersion !== MATRIX_VERSION || t.result !== 'pass' || t.testedLocalSourceHash !== a.localRulesSourceHash || t.testedDeployedSourceHash !== a.approvedDeployedSourceHash) refuse('passing local report binding required');
  const r = record(a.review, ['principalSubject', 'decisionRef', 'reviewedAt'], 'review');
  text(r.principalSubject, 'review principal'); text(r.decisionRef, 'owner decision reference');
  if (typeof r.reviewedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.reviewedAt) || !Number.isFinite(Date.parse(r.reviewedAt)) || new Date(r.reviewedAt).toISOString() !== r.reviewedAt) refuse('review UTC timestamp');
  return a;
}
function digestApproval(value) { return K.contentDigest(parseApproval(value)); }
function source(value, expected, label) {
  record(value, ['bytesBase64', 'sha256'], label);
  hash(value.sha256, label);
  if (typeof value.bytesBase64 !== 'string' || !value.bytesBase64 || value.bytesBase64.length > 4 * 1024 * 1024) refuse(`${label}: actual bounded source bytes required`);
  const bytes = Buffer.from(value.bytesBase64, 'base64');
  if (bytes.toString('base64') !== value.bytesBase64 || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes) || K.sha256Bytes(bytes) !== value.sha256 || value.sha256 !== expected) refuse(`${label}: exact source bytes/hash mismatch`);
}
function validateReport(bytes, a) {
  if (!Buffer.isBuffer(bytes) && typeof bytes !== 'string') refuse('report original bytes required');
  if (K.sha256Bytes(bytes) !== a.testEvidence.reportSha256) refuse('report bytes hash mismatch');
  const r = record(input(bytes, 'report'), ['kind', 'schemaVersion', 'matrixVersion', 'localSource', 'deployedSource', 'tool', 'results', 'sourceReview'], 'report');
  if (r.kind !== 'lyfelabz.teacherUnitsOptionBRulesReport' || r.schemaVersion !== 1 || r.matrixVersion !== MATRIX_VERSION) refuse('report kind/version');
  source(r.localSource, a.localRulesSourceHash, 'localSource'); source(r.deployedSource, a.approvedDeployedSourceHash, 'deployedSource');
  record(r.tool, ['name', 'version', 'dependencies'], 'tool'); text(r.tool.name, 'tool name'); text(r.tool.version, 'tool version');
  if (!Array.isArray(r.tool.dependencies) || r.tool.dependencies.length < 1 || r.tool.dependencies.length > 64) refuse('tool dependency identities required');
  const names = new Set();
  for (const dependency of r.tool.dependencies) {
    record(dependency, ['name', 'version'], 'dependency'); text(dependency.name, 'dependency name'); text(dependency.version, 'dependency version');
    if (names.has(dependency.name)) refuse('duplicate dependency'); names.add(dependency.name);
  }
  record(r.sourceReview, ['fullDiffReviewed', 'unrelatedChanges', 'accessBroadening', 'summary'], 'sourceReview');
  if (r.sourceReview.fullDiffReviewed !== true || r.sourceReview.unrelatedChanges !== false || r.sourceReview.accessBroadening !== false) refuse('full source review without unrelated/access-broadening drift required');
  text(r.sourceReview.summary, 'source review summary', 2000);
  const key = c => `${c.role}\0${c.resource}\0${c.operation}`;
  const required = new Map(requiredCases().map(c => [key(c), c.expected]));
  if (!Array.isArray(r.results) || r.results.length !== required.size) refuse('complete executed matrix required');
  for (const row of r.results) {
    record(row, ['role', 'resource', 'operation', 'expected', 'actualLocal', 'actualDeployed', 'result'], 'matrix row');
    const k = key(row);
    if (!required.has(k) || required.get(k) !== row.expected || row.actualLocal !== row.expected || row.actualDeployed !== row.expected || row.result !== 'pass') refuse('failed, duplicate or unexpected matrix row');
    required.delete(k);
  }
  if (required.size) refuse('incomplete matrix');
}
function validateRulesEvidence(value, expectations) {
  const a = parseApproval(value), e = expectations;
  const bound = ['projectId', 'projectNumber', 'databaseId', ...(a.schemaVersion === 1 ? ['releaseSourceSha', 'backendBuildId', 'hostingArtifactFingerprint', 'placementFingerprint'] : []), 'localRulesSourceHash'];
  record(e, [...bound, 'observedRulesetResource', 'observedSourceHash', 'approvalDigest', 'report'], 'expectations');
  for (const field of bound) if (e[field] !== a[field]) refuse(`${field}: release/target binding mismatch`);
  const approvalDigest = K.contentDigest(a);
  hash(e.approvalDigest, 'approved attachment digest');
  if (e.approvalDigest !== approvalDigest || e.observedRulesetResource !== a.approvedRulesetResource || e.observedSourceHash !== a.approvedDeployedSourceHash) refuse('approved attachment or observed Rules state mismatch');
  validateReport(e.report, a);
  return Object.freeze({ kind: 'lyfelabz.teacherUnitsOptionBRulesComparison', schemaVersion: a.schemaVersion, approvalDigest, comparison: a.comparison,
    rulesetResource: a.approvedRulesetResource, sourceHash: a.approvedDeployedSourceHash, localRulesSourceHash: a.localRulesSourceHash,
    reportSha256: a.testEvidence.reportSha256 });
}
module.exports = { KIND, MATRIX_VERSION, ROLES, RESOURCES, OPERATIONS, requiredCases, parseApproval, digestApproval, validateRulesEvidence };
