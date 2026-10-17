'use strict';

// SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED (A3-6 S6a). Test-only. Builds emulator
// (`demo-`) release chains from the real S6a statement preparation, signed with
// ephemeral in-process Ed25519 test keys that exist only for the duration of a test.
// No key here is pinned anywhere; production and staging identities are never used for
// a signed chain, and nothing built here can verify against the production registry.
const path = require('node:path');
const { generateKeyPairSync, sign } = require('node:crypto');
const ST = require('../statements.cjs');

const LIB = path.resolve(__dirname, '../../../platform/functions/lib/teacherUnits');
const K = require(path.join(LIB, 'a3-canonical.js'));
const V = require(path.join(LIB, 'a3-validation.js'));
const R = require(path.join(LIB, 'a3-authority-registry.js'));
const L = require(path.join(LIB, 'a3-revocation-list.js'));

const SYNTHETIC = 'synthetic, not provider-verified';
const PROJECT = 'demo-a3-s6a';
const NOW = '2026-10-17T12:00:00.000000000Z';
const POLICY_INSTANCE_ID = '0f8e2a4c-3b1d-4e5f-9a7b-6c5d4e3f2a1b';
const PLACEMENT = 'b'.repeat(64);
const HOSTING = 'c'.repeat(64);
const ZERO_SIGNATURE = `${'A'.repeat(86)}==`;
const LOCAL_PROFILE = Object.freeze({ fingerprint: 'f'.repeat(64), authOrigin: 'http://127.0.0.1:9099',
  firestoreHost: '127.0.0.1:8080', functionsOrigin: 'http://127.0.0.1:5001' });
const AUTHORITY = Object.freeze({ authorityId: 'synthetic-authority', approverSubject: 'synthetic-human', decisionId: 'synthetic-decision-001' });
const ACTIONS = Object.freeze({ deploy: 'deploy-backend', certify: 'certify-release', activate: 'activate-teacher-units', dispose: 'dispose-approval' });

const identity = (projectId = PROJECT) => ({ environment: 'emulator', projectId, projectNumber: '0' });
const expectedFor = (projectId = PROJECT) => ({ ...identity(projectId), localProfile: { ...LOCAL_PROFILE } });
const at = (iso, deltaMs = 0) => new Date(new Date(iso).getTime() + deltaMs);

function testKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { privateKey, publicKeyBase64: raw.toString('base64'), keyId: R.ed25519KeyId(raw) };
}
const testKeys = () => Object.fromEntries(Object.keys(ACTIONS).map(name => [name, testKey()]));

function registryEntries(projectId, keys, { approvalSystemId = ST.APPROVAL_SYSTEM_ID } = {}) {
  return Object.keys(ACTIONS).map(name => ({ schemaVersion: 1, ...identity(projectId), keyId: keys[name].keyId,
    publicKeyBase64: keys[name].publicKeyBase64, action: ACTIONS[name], authorityId: AUTHORITY.authorityId,
    approverSubject: AUTHORITY.approverSubject, approvalSystemId })).sort((a, b) => a.keyId < b.keyId ? -1 : 1);
}
function registryFor(projectId, keys, options) {
  const r = R.createAuthorityRegistry(registryEntries(projectId, keys, options));
  if (!r.ok) throw new Error(`synthetic registry: ${r.issue.path} ${r.issue.reason}`);
  return r.value;
}
const revocationEntries = (projectId, refs) => [...refs].sort().map(revokedEvidenceRef => ({ schemaVersion: 1, ...identity(projectId), revokedEvidenceRef }));
function revocationsFor(projectId, refs = []) {
  const r = L.createRevocationList(revocationEntries(projectId, refs), identity(projectId));
  if (!r.ok) throw new Error(`synthetic revocation list: ${r.issue.path} ${r.issue.reason}`);
  return r.value;
}

/** Prepares a statement with the real S6a code, signs it with a test key (or a zero
 * signature when `key` is null) and assembles it. */
function signedDocument(kind, fields, key, { expected = expectedFor(), now = NOW } = {}) {
  const prepared = ST.prepareStatement({ kind, expected, fields, authority: AUTHORITY, now: new Date(now) });
  const signatureBase64 = key ? sign(null, prepared.signingBytes, key.privateKey).toString('base64') : ZERO_SIGNATURE;
  const assembled = ST.assembleSignedDocument({ statementBytes: prepared.statementBytes, expected, signatureBase64,
    signerKeyId: key ? key.keyId : 'synthetic-unsigned', statementObject: { bucket: 'lyfelabz-evidence-synthetic', object: `statements/${kind}.json`, generation: '1' } });
  return { ref: assembled.ref, document: assembled.document, statementBytes: prepared.statementBytes, statement: prepared.statement };
}

function candidate(placement = PLACEMENT) {
  return { sourceSha: '1'.repeat(40), sourceTree: '2'.repeat(40), runtimePayloadFingerprint: '3'.repeat(64),
    functionsArtifactFingerprint: '4'.repeat(64), placementFingerprint: placement, enforcementVersion: 'teacher-units-a3-v1',
    clientContractVersion: 'teacher-units-v2', deploymentMode: 'policy-controlled',
    deploymentPlan: { bucket: 'lyfelabz-evidence-synthetic', object: 'plans/synthetic.json', generation: '1', sha256: '5'.repeat(64) } };
}
function releaseDocument(expected, deploymentApprovalEvidenceRef, c = candidate()) {
  const { localProfile, ...id } = expected;
  const manifest = { ...id, schemaVersion: 1, enforcementVersion: c.enforcementVersion, region: 'us-central1', databaseId: '(default)',
    deploymentMode: c.deploymentMode, sourceSha: c.sourceSha, sourceTree: c.sourceTree, runtimePayloadFingerprint: c.runtimePayloadFingerprint,
    functionsArtifactFingerprint: c.functionsArtifactFingerprint, placementFingerprint: c.placementFingerprint,
    supportedClientContractVersions: ['teacher-units-v2'],
    endpoints: V.ENDPOINTS.map(endpointName => ({ schemaVersion: 1, kind: 'emulator', endpointName, entryPoint: endpointName, ...id,
      region: 'us-central1', runtime: 'nodejs22', localProfileFingerprint: localProfile.fingerprint, authOrigin: localProfile.authOrigin,
      firestoreHost: localProfile.firestoreHost, functionsOrigin: localProfile.functionsOrigin })),
    rules: { rulesetResource: null, sourceHash: '9'.repeat(64) }, readyIndexesConfigurationHash: 'a'.repeat(64), deploymentApprovalEvidenceRef };
  const document = { schemaVersion: 1, manifest };
  return { ref: `teacherUnitsBackendReleases/${K.contentDigest(manifest)}`, document, releaseId: K.contentDigest(manifest) };
}

/** A coherent emulator chain for enabling `enabledGeneration` of `policyInstanceId`.
 * `keys` null produces zero (synthetic, unverifiable) signatures throughout. */
function buildChain({ keys, expected = expectedFor(), now = NOW, policyInstanceId = POLICY_INSTANCE_ID, enabledGeneration = 3,
  signers = {}, edit = {} } = {}) {
  const key = name => (signers[name] === undefined ? (keys ? keys[name] : null) : signers[name]);
  const deployment = signedDocument('deployment-approval', { candidate: candidate(), ...edit.deploy }, key('deploy'), { expected, now });
  const release = releaseDocument(expected, deployment.ref);
  const certification = signedDocument('release-certification', { backendReleaseId: release.releaseId, hostingCandidateFingerprint: HOSTING,
    placementFingerprint: PLACEMENT, enforcementVersion: 'teacher-units-a3-v1', clientContractVersion: 'teacher-units-v2',
    certificationReport: { bucket: 'lyfelabz-evidence-synthetic', object: 'reports/synthetic.json', generation: '1', sha256: '9'.repeat(64) }, ...edit.certify },
  key('certify'), { expected, now });
  const activationApproval = signedDocument('activation-approval', { policyInstanceId, enabledGeneration, backendReleaseId: release.releaseId,
    clientContractVersion: 'teacher-units-v2', placementFingerprint: PLACEMENT, hostingCandidateFingerprint: HOSTING,
    certificationEvidenceRef: certification.ref, ...edit.activate }, key('activate'), { expected, now });
  const activationEvidence = ST.prepareActivationEvidence({ approvalRef: activationApproval.ref, approval: activationApproval.document, expected });
  return { deployment, release, certification, activationApproval, activationEvidence };
}

/** Removes every document of `projectId` from the loopback Firestore emulator. */
async function clearEmulator(projectId = PROJECT) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]+$/.test(host || '') || !/^demo-/.test(projectId)) throw new Error('clearEmulator: loopback emulator and demo- project only');
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`clearEmulator: HTTP ${response.status}`);
}

module.exports = { SYNTHETIC, PROJECT, NOW, POLICY_INSTANCE_ID, PLACEMENT, HOSTING, ZERO_SIGNATURE, LOCAL_PROFILE, AUTHORITY, ACTIONS,
  identity, expectedFor, at, testKey, testKeys, registryEntries, registryFor, revocationEntries, revocationsFor, signedDocument,
  candidate, releaseDocument, buildChain, clearEmulator };
