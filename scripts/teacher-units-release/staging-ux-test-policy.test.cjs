'use strict';
// Staging UX test policy tool: project pinning, create-only enable, close transition.
// No live calls: every Firestore client here is an in-memory fake.
const assert = require('node:assert/strict');
const test = require('node:test');
const T = require('./staging-ux-test-policy.cjs');

const m = T.modules();
const { Timestamp } = T.functionsModule('firebase-admin/firestore');
const NOW = new Date('2026-10-18T12:00:00.000Z');
const STAGING_ID = Object.freeze({ ...T.STAGING, region: 'us-central1', databaseId: '(default)', source: 'execution-metadata',
  serviceAccountEmail: 'svc@lyfelabz-staging.iam.gserviceaccount.com', service: 'teacherunitslist', revision: 'teacherunitslist-00001' });

function fakeFirestore(initial) {
  const state = { doc: initial, writes: [], closed: false };
  const ref = {
    get: async () => ({ exists: state.doc !== undefined, data: () => state.doc }),
    create: async (value) => { if (state.doc !== undefined) throw new Error('ALREADY_EXISTS'); state.doc = value; state.writes.push(['create', value]); },
  };
  const db = {
    doc: (p) => { assert.equal(p, T.POLICY_PATH); return ref; },
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, value) => { state.doc = value; state.writes.push(['set', value]); } }),
  };
  return { state, factory: () => ({ db, close: async () => { state.closed = true; } }) };
}
const quiet = () => {};

test('only the literal staging project, cloud-routed, with no disagreeing environment', () => {
  T.assertStagingTarget('lyfelabz-staging', {});
  for (const project of ['lyfelabz-prod', 'default', undefined, 'LYFELABZ-STAGING', 'demo-lyfelabz-staging']) {
    assert.throws(() => T.assertStagingTarget(project, {}), /--project must be exactly lyfelabz-staging/);
  }
  assert.throws(() => T.assertStagingTarget('lyfelabz-staging', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), /FIRESTORE_EMULATOR_HOST is set/);
  for (const name of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']) {
    assert.throws(() => T.assertStagingTarget('lyfelabz-staging', { [name]: 'lyfelabz-prod' }), new RegExp(name));
    T.assertStagingTarget('lyfelabz-staging', { [name]: 'lyfelabz-staging' });
  }
});

test('production is refused before any Firestore client is created', async () => {
  await assert.rejects(T.run({ command: 'enable', project: 'lyfelabz-prod', env: {}, firestore: () => assert.fail('no client'), log: quiet }),
    /--project must be exactly lyfelabz-staging/);
  await assert.rejects(T.run({ command: 'delete', project: 'lyfelabz-staging', env: {}, firestore: () => assert.fail('no client'), log: quiet }),
    /command must be one of/);
});

test('enable plans a valid staging marker policy that the server marker check accepts', () => {
  const policy = T.planEnable({ m, Timestamp, now: NOW });
  assert.equal(m.V.validatePolicy(policy, T.STAGING).ok, true);
  assert.equal(policy.mode, 'enabled');
  assert.equal(policy.generation, 1);
  assert.equal(policy.backendReleaseEligibility.releaseId, m.M.STAGING_UX_TEST_RELEASE_ID);
  assert.equal(policy.activationEvidenceRef, m.M.STAGING_UX_TEST_EVIDENCE_REF);
  assert.equal(policy.placementFingerprint, require('../../platform/functions/lib/teacherUnits/a3-enforcement.js').RUNTIME_PLACEMENT_FINGERPRINT);
  assert.equal(m.M.stagingUxTestEligible(STAGING_ID, policy, policy.placementFingerprint), true);
  // The same policy is invalid for production.
  const PROD = { environment: 'production', projectId: 'lyfelabz-prod', projectNumber: '182791689935' };
  assert.equal(m.V.validatePolicy(policy, PROD).ok, false);
});

test('enable is create-only and writes exactly one document', async () => {
  const fresh = fakeFirestore(undefined);
  const result = await T.run({ command: 'enable', project: 'lyfelabz-staging', env: {}, firestore: fresh.factory, log: quiet, now: () => NOW });
  assert.equal(fresh.state.writes.length, 1);
  assert.equal(fresh.state.writes[0][0], 'create');
  assert.equal(result.after.mode, 'enabled');
  assert.equal(fresh.state.closed, true);
  const existing = fakeFirestore({ any: 'policy' });
  await assert.rejects(T.run({ command: 'enable', project: 'lyfelabz-staging', env: {}, firestore: existing.factory, log: quiet }), /ALREADY_EXISTS/);
  assert.equal(existing.state.writes.length, 0);
  assert.equal(existing.state.closed, true);
});

test('close shuts down the marker policy as a valid A3 transition', async () => {
  const enabled = T.planEnable({ m, Timestamp, now: NOW });
  const f = fakeFirestore(enabled);
  const result = await T.run({ command: 'close', project: 'lyfelabz-staging', env: {}, firestore: f.factory, log: quiet, now: () => NOW });
  assert.deepEqual(f.state.writes.map(w => w[0]), ['set']);
  assert.equal(result.after.mode, 'closed');
  assert.equal(result.after.generation, 2);
  assert.equal(result.after.backendReleaseEligibility, null);
  assert.equal(result.after.activationEvidenceRef, null);
  assert.equal(result.after.policyInstanceId, enabled.policyInstanceId);
  assert.equal(m.B.validatePolicyTransition(enabled, result.after, T.STAGING).ok, true);
  await assert.rejects(T.run({ command: 'close', project: 'lyfelabz-staging', env: {}, firestore: f.factory, log: quiet }), /already closed|not a staging UX test/);
});

test('close never touches a non-marker or missing policy', async () => {
  const enabled = T.planEnable({ m, Timestamp, now: NOW });
  const certifiedShaped = { ...enabled, backendReleaseEligibility: { releaseId: 'a'.repeat(64) }, activationEvidenceRef: `teacherUnitsReleaseEvidence/${'b'.repeat(64)}` };
  const f = fakeFirestore(certifiedShaped);
  await assert.rejects(T.run({ command: 'close', project: 'lyfelabz-staging', env: {}, firestore: f.factory, log: quiet }), /left untouched/);
  assert.equal(f.state.writes.length, 0);
  const missing = fakeFirestore(undefined);
  await assert.rejects(T.run({ command: 'close', project: 'lyfelabz-staging', env: {}, firestore: missing.factory, log: quiet }), /no policy document/);
  assert.equal(missing.state.writes.length, 0);
});

test('show reads only', async () => {
  const f = fakeFirestore(undefined);
  const result = await T.run({ command: 'show', project: 'lyfelabz-staging', env: {}, firestore: f.factory, log: quiet });
  assert.equal(result.before, undefined);
  assert.equal(f.state.writes.length, 0);
});

test('CLI argument parsing requires the explicit project flag', () => {
  assert.deepEqual(T.parse(['enable', '--project', 'lyfelabz-staging']), { command: 'enable', project: 'lyfelabz-staging' });
  for (const argv of [['enable'], ['enable', 'lyfelabz-staging'], ['enable', '--project'], ['enable', '--project', 'lyfelabz-staging', '--force']]) {
    assert.throws(() => T.parse(argv), /usage/);
  }
});
