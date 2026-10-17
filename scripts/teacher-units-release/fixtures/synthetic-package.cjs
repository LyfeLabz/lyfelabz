'use strict';

// SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED (A3-6 S6b). Test-only.
// Composes the S4 synthetic provider, the S5 synthetic access review and statements
// prepared by the real S6a code into a coherent staging evidence set. Every value is
// invented: the source SHA and tree, the Hosting fingerprint and the certification
// report are synthetic and confined to these tests. Signatures use ephemeral
// in-process Ed25519 test keys bound to the staging identity; no key is pinned
// anywhere, and the production registry stays empty, so nothing built here can
// verify against any pinned authority. Nothing here is release evidence.
const path = require('node:path');
const { generateKeyPairSync, sign } = require('node:crypto');
const { PROJECT_NUMBERS } = require('../../hosting-release/backend-state.cjs');
const AR = require('../access-review.cjs');
const ST = require('../statements.cjs');
const { buildAccess, expectedFor: expectedAccessFor, hostingRoot, RECEIPT_LOCATION } = require('./synthetic-access.cjs');

const LIB = path.resolve(__dirname, '../../../platform/functions/lib/teacherUnits');
const K = require(path.join(LIB, 'a3-canonical.js'));
const R = require(path.join(LIB, 'a3-authority-registry.js'));

const SYNTHETIC = 'synthetic, not provider-verified';
const STAGING = 'lyfelabz-staging';
const HOSTING = 'c'.repeat(64);
const POLICY_INSTANCE_ID = '0f8e2a4c-3b1d-4e5f-9a7b-6c5d4e3f2a1b';
const AUTHORITY = Object.freeze({ authorityId: 'synthetic-authority', approverSubject: 'synthetic-human', decisionId: 'synthetic-decision-s6b' });
const ACTIONS = Object.freeze({ deploy: 'deploy-backend', certify: 'certify-release', activate: 'activate-teacher-units' });
// Synthetic statements are issued an hour before the synthetic observation (2026-10-16T12:00Z).
const ISSUED = '2026-10-16T11:00:00.000Z';
const REPORT = Buffer.from('{"synthetic":"certification report, not an independent certification"}\n', 'utf8');

const identity = project => ({ environment: project === STAGING ? 'staging' : 'production', projectId: project, projectNumber: PROJECT_NUMBERS[project] });

function testKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { privateKey, publicKeyBase64: raw.toString('base64'), keyId: R.ed25519KeyId(raw) };
}
const testKeys = () => Object.fromEntries(Object.keys(ACTIONS).map(name => [name, testKey()]));
function registryEntries(project, keys, { actions = ACTIONS } = {}) {
  return Object.keys(actions).map(name => ({ schemaVersion: 1, ...identity(project), keyId: keys[name].keyId, publicKeyBase64: keys[name].publicKeyBase64,
    action: actions[name], authorityId: AUTHORITY.authorityId, approverSubject: AUTHORITY.approverSubject, approvalSystemId: ST.APPROVAL_SYSTEM_ID }))
    .sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
}
const revocationEntries = (project, refs = []) => [...refs].sort().map(revokedEvidenceRef => ({ schemaVersion: 1, ...identity(project), revokedEvidenceRef }));

function signed(kind, fields, key, project, issuedAt = ISSUED) {
  const expected = identity(project);
  const prepared = ST.prepareStatement({ kind, expected, fields, authority: AUTHORITY, now: new Date(issuedAt) });
  const signatureBase64 = key ? sign(null, prepared.signingBytes, key.privateKey).toString('base64') : `${'A'.repeat(86)}==`;
  const assembled = ST.assembleSignedDocument({ statementBytes: prepared.statementBytes, expected, signatureBase64, signerKeyId: key ? key.keyId : 'synthetic-unsigned',
    statementObject: { bucket: 'lyfelabz-evidence-synthetic', object: `statements/${kind}.json`, generation: '1' } });
  return { ref: assembled.ref, document: assembled.document, statementBytes: prepared.statementBytes };
}

/**
 * Builds the full synthetic evidence set. `keys` null yields zero signatures.
 * `edit` hooks: deploy(candidate), certify(fields), activate(fields).
 */
async function buildEvidence({ project = STAGING, keys = null, provenance = 'synthetic-fixture', edit = {}, issuedAt = ISSUED, access = {}, root } = {}) {
  const a = await buildAccess({ project, ...access });
  const expected = expectedAccessFor(a.observation);
  if (root === undefined) root = hostingRoot(project);
  const review = await AR.reviewA3Access({ project, get: a.get, observation: a.observation, deploymentPlan: a.deploymentPlan, expected, provenance, hostingRoot: root, now: a.now });
  const receipt = { object: AR.receiptContentObject(review.bytes, RECEIPT_LOCATION), bytes: review.bytes };
  const plan = { object: a.deploymentPlan.object, bytes: a.deploymentPlan.bytes };
  const candidate = { sourceSha: '1'.repeat(40), sourceTree: '2'.repeat(40), ...a.deploymentPlan.plan.candidate, enforcementVersion: 'teacher-units-a3-v1',
    clientContractVersion: 'teacher-units-v2', deploymentMode: 'policy-controlled', deploymentPlan: plan.object };
  if (edit.deploy) edit.deploy(candidate);
  const deployment = signed('deployment-approval', { candidate }, keys && keys.deploy, project, issuedAt);
  const base = { project, plan, expected: { object: expected.object, bytes: expected.bytes }, observation: a.observation, receipt,
    deploymentApproval: { document: deployment.document, statementBytes: deployment.statementBytes }, hostingRoot: root };
  return { a, base, deployment, keys, project, issuedAt, now: a.now };
}

/** Adds certification, activation approval and evidence for `releaseId`. */
function chainFor(evidence, releaseId, { edit = {}, report = REPORT } = {}) {
  const { keys, project, issuedAt } = evidence;
  const placement = evidence.a.deploymentPlan.plan.candidate.placementFingerprint;
  const certFields = { backendReleaseId: releaseId, hostingCandidateFingerprint: HOSTING, placementFingerprint: placement, enforcementVersion: 'teacher-units-a3-v1',
    clientContractVersion: 'teacher-units-v2', certificationReport: { bucket: 'lyfelabz-evidence-synthetic', object: 'reports/synthetic.json', generation: '1', sha256: K.sha256Bytes(report) } };
  if (edit.certify) edit.certify(certFields);
  const certification = signed('release-certification', certFields, keys && keys.certify, project, issuedAt);
  const actFields = { policyInstanceId: POLICY_INSTANCE_ID, enabledGeneration: 3, backendReleaseId: releaseId, clientContractVersion: 'teacher-units-v2',
    placementFingerprint: placement, hostingCandidateFingerprint: HOSTING, certificationEvidenceRef: certification.ref };
  if (edit.activate) edit.activate(actFields);
  const activation = signed('activation-approval', actFields, keys && keys.activate, project, issuedAt);
  const activationEvidence = ST.prepareActivationEvidence({ approvalRef: activation.ref, approval: activation.document, expected: identity(project) });
  return {
    inputs: {
      certification: { document: certification.document, statementBytes: certification.statementBytes, reportBytes: report },
      activationApproval: { document: activation.document, statementBytes: activation.statementBytes },
      activationEvidence: activationEvidence.document,
    },
    refs: { certification: certification.ref, activation: activation.ref, evidence: activationEvidence.ref },
  };
}

module.exports = { SYNTHETIC, STAGING, HOSTING, ISSUED, REPORT, AUTHORITY, ACTIONS, identity, testKeys, registryEntries, revocationEntries, signed,
  buildEvidence, chainFor };
