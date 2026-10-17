'use strict';
// A3-6 S6a statement preparation tests. Offline; test keys are ephemeral (fixture).
const assert = require('node:assert/strict');
const test = require('node:test');
const ST = require('./statements.cjs');
const F = require('./fixtures/synthetic-release.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const S = require('../../platform/functions/lib/teacherUnits/a3-signature.js');
const R = require('../../platform/functions/lib/teacherUnits/a3-authority-registry.js');

const refused = (fn, pattern) => assert.throws(fn, error => { assert.match(error.message, /REFUSED/); assert.match(error.message, pattern); return true; });
const PRODUCTION = { environment: 'production', projectId: 'lyfelabz-prod', projectNumber: '182791689935' };
const STAGING = { environment: 'staging', projectId: 'lyfelabz-staging', projectNumber: '293337283840' };
const prepare = (overrides = {}) => ST.prepareStatement({ kind: 'deployment-approval', expected: PRODUCTION, fields: { candidate: F.candidate() },
  authority: F.AUTHORITY, now: new Date(F.NOW), ...overrides });

test('a prepared statement carries the fixed approval system, a fresh run ID and canonical bytes', () => {
  const a = prepare(), b = prepare();
  assert.equal(a.statement.authority.approvalSystemId, 'lyfelabz-operator-cli');
  assert.equal(a.statement.authority.workflowId, 'teacher-units-release statement prepare deployment-approval');
  assert.match(a.statement.authority.workflowRunId, /^[a-f0-9]{8}-[a-f0-9]{4}-4/);
  assert.notEqual(a.statement.authority.workflowRunId, b.statement.authority.workflowRunId);
  assert.equal(a.statement.issuedAt, F.NOW);
  assert.equal(a.statementBytes.toString('utf8'), K.canonicalJSON(a.statement));
  assert.equal(a.statementSha256, K.contentDigest(a.statement));
  assert.deepEqual(a.signingBytes, Buffer.from(K.approvalSigningBytes(a.statement)));
  assert.ok(a.signingBytes.toString('utf8').startsWith('lyfelabz.teacher-units-approval-v1\n'));
  assert.equal(a.authority, 'none: unsigned statement');
});

test('the tool sets identity, kind, action, authority and issuedAt; callers cannot', () => {
  for (const key of ['environment', 'projectId', 'projectNumber', 'schemaVersion', 'kind', 'authority', 'issuedAt', 'action']) {
    refused(() => prepare({ fields: { candidate: F.candidate(), [key]: 'x' } }), /set by the tool/);
  }
  refused(() => prepare({ authority: { ...F.AUTHORITY, approvalSystemId: 'other' } }), /exactly \{authorityId, approverSubject, decisionId\}/);
  refused(() => prepare({ runId: 'not-a-uuid' }), /UUID v4/);
  refused(() => prepare({ kind: 'activation' }), /unknown statement kind/);
  refused(() => prepare({ fields: { candidate: { ...F.candidate(), deploymentMode: 'closed-only' } } }), /structure invalid/);
  refused(() => prepare({ fields: [] }), /must be an object/);
});

test('dispositions take their action from the fields and are validated', () => {
  const target = `teacherUnitsReleaseEvidence/${'e'.repeat(64)}`;
  const revoke = ST.prepareStatement({ kind: 'approval-disposition', expected: STAGING, fields: { action: 'revoke', targetApprovalRef: target, replacementApprovalRef: null },
    authority: F.AUTHORITY, now: new Date(F.NOW) });
  assert.equal(revoke.statement.action, 'revoke');
  refused(() => ST.prepareStatement({ kind: 'approval-disposition', expected: STAGING, fields: { action: 'supersede', targetApprovalRef: target, replacementApprovalRef: target },
    authority: F.AUTHORITY, now: new Date(F.NOW) }), /structure invalid/);
});

test('readStatementBytes refuses non-canonical, non-strict or mismatched bytes', () => {
  const { statement, statementBytes, statementSha256 } = prepare();
  assert.deepEqual(ST.readStatementBytes(statementBytes, statementSha256), statement);
  const pretty = Buffer.from(JSON.stringify(statement, null, 2));
  refused(() => ST.readStatementBytes(pretty), /not canonical/);
  refused(() => ST.readStatementBytes(Buffer.from(`${statementBytes.toString()}\n`)), /not canonical/);
  const text = statementBytes.toString();
  refused(() => ST.readStatementBytes(Buffer.from(`{"kind":"x",${text.slice(1)}`)), /strict JSON/);
  refused(() => ST.readStatementBytes(Buffer.from('{"a":1.5}')), /strict JSON/);
  refused(() => ST.readStatementBytes(statementBytes, 'f'.repeat(64)), /do not match/);
  refused(() => ST.readStatementBytes(Buffer.from([0xff, 0xfe])), /UTF-8/);
  refused(() => ST.readStatementBytes(Buffer.alloc(0)), /required/);
  refused(() => ST.readStatementBytes('string'), /required/);
});

test('assembly binds the statement hash and validates the evidence document; signatures are not verified there', () => {
  const key = F.testKey();
  const signed = F.signedDocument('deployment-approval', { candidate: F.candidate() }, key);
  assert.equal(signed.document.payload.source.statementObject.sha256, K.sha256Bytes(signed.statementBytes));
  assert.equal(signed.ref, K.evidenceRef(signed.document.payload));
  const unsigned = F.signedDocument('deployment-approval', { candidate: F.candidate() }, null);
  assert.equal(unsigned.document.payload.source.signatureBase64, F.ZERO_SIGNATURE);
  // A zero signature is shape-valid but never verifies, even against a registry that pins the key.
  const registry = R.createAuthorityRegistry(F.registryEntries(F.PROJECT, { ...F.testKeys(), deploy: key })).value;
  assert.equal(S.verifyApprovalSignature(signed.document, registry, F.expectedFor()).verdict, 'verified');
  assert.deepEqual(S.verifyApprovalSignature({ ...unsigned.document, payload: { ...unsigned.document.payload,
    source: { ...unsigned.document.payload.source, signerKeyId: key.keyId } } }, registry, F.expectedFor()), { verdict: 'unverified', reason: 'signatureUnverified' });
});

test('assembly refuses cross-environment statements, bad locations and non-canonical bytes', () => {
  const { statementBytes } = prepare();
  const base = { statementBytes, statementObject: { bucket: 'lyfelabz-evidence-synthetic', object: 's.json', generation: '1' }, signerKeyId: 'k', signatureBase64: F.ZERO_SIGNATURE };
  assert.match(ST.assembleSignedDocument({ ...base, expected: PRODUCTION }).ref, /^teacherUnitsReleaseEvidence\//);
  refused(() => ST.assembleSignedDocument({ ...base, expected: STAGING }), /structure invalid/);
  refused(() => ST.assembleSignedDocument({ ...base, expected: F.expectedFor() }), /structure invalid/);
  refused(() => ST.assembleSignedDocument({ ...base, expected: PRODUCTION, statementObject: { ...base.statementObject, sha256: 'f'.repeat(64) } }), /exactly \{bucket, object, generation\}/);
  refused(() => ST.assembleSignedDocument({ ...base, expected: PRODUCTION, statementBytes: Buffer.from(JSON.stringify(JSON.parse(statementBytes.toString()), null, 1)) }), /not canonical/);
  refused(() => ST.assembleSignedDocument({ ...base, expected: PRODUCTION, signatureBase64: 'short' }), /structure invalid/);
  refused(() => ST.assembleSignedDocument({ ...base, expected: PRODUCTION, statementBytes: Buffer.from('{"kind":"teacher-units-activation"}') }), /not a signed A3 statement/);
});

test('activation evidence repeats its approval and names it as authorization', () => {
  const chain = F.buildChain({ keys: F.testKeys() });
  const e = chain.activationEvidence.document.payload, s = chain.activationApproval.statement;
  assert.equal(e.authorizationEvidenceRef, chain.activationApproval.ref);
  for (const key of ['policyInstanceId', 'enabledGeneration', 'backendReleaseId', 'hostingCandidateFingerprint', 'certificationEvidenceRef']) assert.equal(e[key], s[key]);
  refused(() => ST.prepareActivationEvidence({ approvalRef: chain.deployment.ref, approval: chain.deployment.document, expected: F.expectedFor() }), /activation approval is required/);
  refused(() => ST.prepareActivationEvidence({ approvalRef: chain.certification.ref, approval: chain.activationApproval.document, expected: F.expectedFor() }), /structure invalid/);
});

test('statements.cjs holds no key material and never signs', () => {
  const source = require('node:fs').readFileSync(require.resolve('./statements.cjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/generateKeyPair|createPrivateKey|\bsign\(|privateKey|kms|KeyManagement/i.test(source), false);
});
