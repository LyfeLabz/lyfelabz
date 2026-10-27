'use strict';
// Real local Firestore transactions, SYNTHETIC demo operator context only.
// No credential discovery, provider transport, user account or external access.
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('./availability-control.cjs');
const F = require('./availability-control.test.cjs');
const { initializeApp, deleteApp, getApps } = F.req('firebase-admin/app');
const { getFirestore } = F.req('firebase-admin/firestore');
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const PROJECT = 'demo-option-b-control';
if (enabled && !/^(?:127\.0\.0\.1|localhost):[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Refuse non-loopback emulator');
if (enabled && [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT].some(p => p !== undefined && p !== PROJECT)) throw new Error('Refuse wrong demo project');
let app, db;
function harness() {
  const f = F.fixture(PROJECT);
  const deps = { db, identity: f.identity, authenticate: async () => F.clone(f.credentials), inspectBuild: () => ({ build: f.build }),
    releaseEvidence: async () => F.clone(f.evidence), now: () => F.TIME };
  return { ...f, deps, controller: C.createController(deps) };
}
async function initialize(h) { const p = await h.controller.review('prepare', h.options); assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current'); return p; }
async function prepare(h) { await initialize(h); const p = await h.controller.review('prepare', h.options); assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current'); return p; }
async function enable(h) { await prepare(h); const p = await h.controller.review('enable', h.options); assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current'); return p; }
function recoveryOptions(h, snapshot) {
  const r = snapshot.data(), valid = F.P.validateAvailabilityPolicy(r, h.identity);
  const expected = { updateTime: snapshot.updateTime, policyInstanceId: valid.ok ? r.policyInstanceId : null, generation: valid.ok ? r.generation : null };
  const id = '22222222-2222-4222-8222-222222222222';
  return { reason: 'Separate synthetic recovery approval', approvalRef: 'synthetic-repair', policyInstanceId: id, placementFingerprint: h.build.placementFingerprint,
    recoveryAuthorization: { action: 'recoverClosed', decisionRef: 'synthetic-repair', target: h.identity, expected, replacementPolicyInstanceId: id,
      placementFingerprint: h.build.placementFingerprint, operator: h.credentials.operator, reason: 'Separate synthetic recovery approval' } };
}
if (enabled) {
  test.before(() => {
    if (getApps().length) throw new Error('Fresh test process required');
    app = initializeApp({ projectId: PROJECT }); db = getFirestore(app);
    db.settings({ host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
    if (db.projectId !== PROJECT || db.databaseId !== '(default)') throw new Error('Wrong database');
    assert.equal(require('../../platform/functions/lib/shared/firestore/admin.js').getAdminFirestore(), db);
  });
  test.beforeEach(async () => {
    // Only synthetic demo records created by this test file are deleted.
    await db.doc(C.POLICY).delete();
    for (const collection of [C.HISTORY, 'auditEvents']) {
      const docs = await db.collection(collection).get(); if (!docs.empty) { const batch = db.batch(); docs.docs.forEach(d => batch.delete(d.ref)); await batch.commit(); }
    }
  });
  test.after(async () => { await db.terminate(); await deleteApp(app); });
}
const local = (name, fn) => test(name, { skip: !enabled }, fn);
local('real policy/history/canonical audit commit timestamps and linked attribution agree; duplicate command emits nothing', async () => {
  const h = harness(), p = await initialize(h), eventSnapshot = await db.doc(`${C.HISTORY}/${p.transitionId}`).get(), event = eventSnapshot.data();
  const audit = (await db.doc(`auditEvents/${event.auditEventId}`).get()).data(), policy = await db.doc(C.POLICY).get();
  assert.equal(event.schemaVersion, 2); assert.equal(event.nextPolicy.mode, 'closed');
  assert.equal(audit.actorUserId, h.credentials.operator.principalSubject); assert.equal(audit.correlationId, p.transitionId);
  assert.ok(policy.updateTime.isEqual(eventSnapshot.updateTime)); assert.ok(audit.occurredAt.isEqual(event.committedAt));
  await h.controller.execute(p, p.confirm); assert.equal((await db.collection('auditEvents').get()).size, 1);
});
local('concurrent enables have exactly one CAS winner and no automatic rebase', async () => {
  const h = harness(); await prepare(h); const a = await h.controller.review('enable', h.options), b = await h.controller.review('enable', h.options);
  const results = await Promise.all([h.controller.execute(a, a.confirm), h.controller.execute(b, b.confirm)]);
  assert.equal(results.filter(r => r.status === 'committed-current').length, 1); assert.equal(results.filter(r => r.status === 'conflicting').length, 1);
  assert.equal((await db.collection(C.HISTORY).get()).size, 3); assert.equal((await db.collection('auditEvents').get()).size, 3);
});
local('concurrent close and separately authorized recovery serialize and leave verified closed state', async () => {
  const h = harness(); await enable(h);
  const close = await h.controller.review('close', { reason: 'Emergency close' });
  const recovery = await h.controller.review('recoverClosed', recoveryOptions(h, await db.doc(C.POLICY).get()));
  const results = await Promise.all([h.controller.execute(close, close.confirm), h.controller.execute(recovery, recovery.confirm)]);
  assert.equal(results.filter(r => r.status === 'committed-current').length, 1); assert.equal(results.filter(r => r.status === 'conflicting').length, 1);
  assert.equal((await db.doc(C.POLICY).get()).data().mode, 'closed');
});
for (const failure of ['audit', 'history']) local(`real ${failure} staging failure rolls back policy/history/audit together`, async () => {
  const h = harness(); const p = await h.controller.review('prepare', h.options);
  const proxy = tx => new Proxy(tx, { get(t, key) {
    if (failure === 'audit' && key === 'set') return (ref, value) => { if (ref.path.startsWith('auditEvents/')) throw new Error('injected audit failure'); return t.set(ref, value); };
    if (failure === 'history' && key === 'create') return () => { throw new Error('injected history failure'); };
    const v = Reflect.get(t, key, t); return typeof v === 'function' ? v.bind(t) : v;
  } });
  const injected = failure === 'audit'
    ? C.createController({ ...h.deps, writeAudit: (tx, input) => F.A.writeAuditEventInTransaction(proxy(tx), input) })
    : C.createController({ ...h.deps, db: { projectId: PROJECT, databaseId: '(default)', doc: db.doc.bind(db), collection: db.collection.bind(db),
      runTransaction: (fn, opts) => db.runTransaction(tx => fn(proxy(tx)), opts) }, writeAudit: F.A.writeAuditEventInTransaction.bind(F.A) });
  const r = await injected.execute(p, p.confirm); assert.equal(r.shutdownConfirmed, false); assert.equal((await db.doc(C.POLICY).get()).exists, false);
  assert.equal((await db.collection(C.HISTORY).get()).size, 0); assert.equal((await db.collection('auditEvents').get()).size, 0);
});
local('lost SDK commit acknowledgement reconciles by exact history and canonical audit', async () => {
  const h = harness(), p = await h.controller.review('prepare', h.options); let lost = true;
  const wrapped = { projectId: PROJECT, databaseId: '(default)', doc: db.doc.bind(db), collection: db.collection.bind(db),
    runTransaction: async (fn, opts) => { const r = await db.runTransaction(fn, opts); if (!opts?.readOnly && lost) { lost = false; throw new Error('response lost'); } return r; } };
  const controller = C.createController({ ...h.deps, db: wrapped, writeAudit: F.A.writeAuditEventInTransaction.bind(F.A) });
  assert.equal((await controller.execute(p, p.confirm)).status, 'committed-current');
  assert.equal((await controller.execute(p, p.confirm)).status, 'committed-current'); assert.equal((await db.collection('auditEvents').get()).size, 1);
});
local('enabled MAX close refusal leaves state unchanged; explicit recovery uses fresh closed instance and invalidates old CAS', async () => {
  const h = harness(); await enable(h); await db.doc(C.POLICY).update({ generation: Number.MAX_SAFE_INTEGER });
  const before = await db.doc(C.POLICY).get(), counts = (await db.collection(C.HISTORY).get()).size;
  await assert.rejects(h.controller.review('close', { reason: 'Close' }), /still enabled; recovery required/);
  assert.equal((await db.doc(C.POLICY).get()).data().mode, 'enabled'); assert.equal((await db.collection(C.HISTORY).get()).size, counts);
  const p = await h.controller.review('recoverClosed', recoveryOptions(h, before));
  assert.equal((await h.controller.execute(p, p.confirm)).shutdownConfirmed, true);
  const after = (await db.doc(C.POLICY).get()).data(); assert.equal(after.generation, 1); assert.notEqual(after.policyInstanceId, before.data().policyInstanceId);
  assert.equal(after.approvedBackendBuildId, null); assert.deepEqual(after.acceptedClientContractVersions, []);
});
local('legacy repair remains non-authorizing; verified supersession and uncertain readback are truthful', async () => {
  const h = harness(); await db.doc(C.POLICY).set({ schemaVersion: 1, legacy: true });
  const p = await h.controller.review('recoverClosed', recoveryOptions(h, await db.doc(C.POLICY).get())); await h.controller.execute(p, p.confirm);
  const prep = await h.controller.review('prepare', h.options); await h.controller.execute(prep, prep.confirm);
  assert.equal((await h.controller.verify(p)).status, 'committed-superseded');
  const unreadable = C.createController({ ...h.deps, db: { projectId: PROJECT, databaseId: '(default)', doc: db.doc.bind(db),
    runTransaction: () => { throw new Error('unavailable'); } } });
  const r = await unreadable.verify(p); assert.equal(r.status, 'unconfirmed'); assert.equal(r.shutdownConfirmed, false);
});

local('current-release preflight never treats synthetic emulator evidence as real-project approval or persists availability', async () => {
  const h = harness(); await prepare(h);
  const before = (await db.doc(C.POLICY).get()).data();
  const histories = (await db.collection(C.HISTORY).get()).size;
  const audits = (await db.collection('auditEvents').get()).size;
  await assert.rejects(h.controller.preEnable(h.options), /explicit real-project target/);
  assert.deepEqual((await db.doc(C.POLICY).get()).data(), before);
  assert.equal((await db.collection(C.HISTORY).get()).size, histories);
  assert.equal((await db.collection('auditEvents').get()).size, audits);
  assert.equal(before.mode, 'closed');
});

local('E2 modeled real-project branch commits policy/history/audit atomically through the local demo transaction adapter and closes without release evidence', async()=>{
  // Only the physical demo database above is used. The cloud tuple models the
  // trusted adapter's provider identity; no cloud SDK/client is constructed.
  const f=await require('./option-b-observation.test.cjs').currentReleaseFixture({project:'lyfelabz-staging'});
  try {
    const identity=C.target('lyfelabz-staging',{}),clock=Date.parse(f.options.now);
    await db.doc(C.POLICY).set(f.policy);
    const localAdapter={projectId:identity.projectId,databaseId:'(default)',doc:db.doc.bind(db),collection:db.collection.bind(db),runTransaction:db.runTransaction.bind(db)};
    const operator={principalSubject:'modeled-local-owner',credentialSubject:'modeled-local-key',delegationSubject:null};
    const deps={db:localAdapter,identity,now:()=>clock,authenticate:async()=>({target:identity,operator,permissions:C.WRITE,expiresAt:clock+3600000,source:'verified-provider'}),
      releaseEvidence:async()=>F.clone(f.bundle),writeAudit:F.A.writeAuditEventInTransaction.bind(F.A)};
    const controller=C.createController(deps),options={reason:'Synthetic real-branch test',approvalRef:f.options.approvalRef};
    const plan=await controller.review('enable',options);
    assert.equal((await db.doc(C.POLICY).get()).data().mode,'closed');
    assert.equal((await controller.execute(plan,plan.confirm)).status,'committed-current');
    assert.equal((await db.doc(C.POLICY).get()).data().mode,'enabled');
    assert.equal((await db.collection(C.HISTORY).get()).size,1);assert.equal((await db.collection('auditEvents').get()).size,1);
    const off=C.createController({...deps,releaseEvidence:async()=>{throw new Error('release evidence unavailable');}});
    const close=await off.review('close',{reason:'Synthetic emergency disable'});
    assert.equal((await off.execute(close,close.confirm)).shutdownConfirmed,true);
    assert.equal((await db.doc(C.POLICY).get()).data().mode,'closed');
  }finally{f.cleanup();}
});
