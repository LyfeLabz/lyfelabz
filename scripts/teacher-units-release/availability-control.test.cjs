'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const C = require('./availability-control.cjs');
const root = path.resolve(__dirname, '../../platform/functions');
const req = name => require(require.resolve(name, { paths: [root] }));
const K = require(path.join(root, 'lib/teacherUnits/a3-canonical.js'));
const B = require(path.join(root, 'lib/teacherUnits/availability-runtime-build.js'));
const P = require(path.join(root, 'lib/teacherUnits/availability-policy.js'));
const A = require(path.join(root, 'lib/shared/audit/write-audit-event.js'));
const { Timestamp, FieldValue } = req('firebase-admin/firestore');
const TIME = Date.parse('2026-10-25T18:00:00.000Z');
function clone(v) {
  if (v instanceof Timestamp) return new Timestamp(v.seconds, v.nanoseconds);
  if (v instanceof FieldValue) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}
function fixture(project = 'demo-option-b') {
  const identity = C.target(project, {}), operator = { principalSubject: 'synthetic-owner', credentialSubject: 'synthetic-credential', delegationSubject: null };
  const inputs = { schemaVersion: 2, enforcementVersion: 'teacher-units-option-b-v1', deploymentMode: 'policy-controlled',
    sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), sourceDirty: false, runtimePayloadFingerprint: 'c'.repeat(64),
    placementFingerprint: 'd'.repeat(64), supportedClientContractVersions: ['teacher-units-v3'] };
  const build = { ...inputs, backendBuildId: B.deriveBackendBuildId(inputs).value };
  const credentials = { target: identity, operator, permissions: [...C.WRITE, 'datastore.entities.list'], expiresAt: TIME + 3600000, source: 'synthetic-demo' };
  const options = { buildRoot: '/synthetic-only', expectedSourceSha: build.sourceSha, releasePreparedAt: new Date(TIME).toISOString(), reason: 'Synthetic owner decision', approvalRef: 'synthetic-approval' };
  const evidence = { kind: 'synthetic-option-b-release', observedAt: new Date(TIME).toISOString(), preparedAt: options.releasePreparedAt,
    backendBuildId: build.backendBuildId, placementFingerprint: build.placementFingerprint, approvalRef: options.approvalRef };
  return { identity, credentials, build, options, evidence };
}
function memory(identity, clock=TIME) {
  const rows = new Map(); let id = 0, tick = 1;
  const faults = { failPath: null, lostCommit: false, unreadable: false, afterCommit: null, attempts: 0 };
  const snapshot = (ref, map = rows) => { const row = map.get(ref.path); return { exists: Boolean(row), id: ref.id, updateTime: row?.updateTime ?? null, data: () => clone(row?.value) }; };
  function materialize(v, stamp) {
    if (v instanceof FieldValue) { if (!v.isEqual(FieldValue.serverTimestamp())) throw new Error('unexpected transform'); return stamp; }
    if (v instanceof Timestamp) return v;
    if (Array.isArray(v)) return v.map(x => materialize(x, stamp));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, materialize(x, stamp)]));
    if (v === undefined) throw new Error('undefined'); return v;
  }
  const db = { projectId: identity.projectId, databaseId: '(default)', rows, faults,
    doc(p) { return { path: p, id: p.split('/').at(-1), get: async () => { if (faults.unreadable) throw new Error('unavailable'); return snapshot(this.doc(p)); } }; },
    collection(p) { return { doc: () => db.doc(`${p}/${String(++id).padStart(20, 'x')}`), orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [...rows.keys()].filter(k => k.startsWith(`${p}/`)).map(k => db.doc(k)) }) }) }) }; },
    async runTransaction(fn, options) {
      if (faults.unreadable) throw new Error('unavailable');
      for (let n = 0; n < 5; n++) {
        faults.attempts++;
        const map = new Map([...rows].map(([k, row]) => [k, clone(row)])), reads = new Map(), writes = [];
        const tx = { get: async ref => { reads.set(ref.path, map.get(ref.path)?.updateTime ?? null); return snapshot(ref, map); },
          set: (ref, value) => writes.push({ ref, value, create: false }), create: (ref, value) => writes.push({ ref, value, create: true }) };
        const result = await fn(tx); await Promise.resolve();
        if ([...reads].some(([p, time]) => !same(time, rows.get(p)?.updateTime ?? null))) continue;
        if (options?.readOnly && writes.length) throw new Error('read-only');
        for (const w of writes) if (w.ref.path.startsWith(faults.failPath ?? '\0') || w.create && rows.has(w.ref.path)) throw new Error('atomic precondition');
        if (writes.length) {
          const stamp = new Timestamp(Math.floor(clock / 1000), (clock % 1000) * 1000000 + ++tick);
          const materialized = writes.map(w => [w.ref.path, { value: materialize(w.value, stamp), updateTime: stamp }]);
          for (const [p, row] of materialized) rows.set(p, row);
          if (faults.afterCommit) { const after = faults.afterCommit; faults.afterCommit = null; after(); }
          if (faults.lostCommit) { faults.lostCommit = false; throw new Error('acknowledgement lost'); }
        }
        return result;
      }
      throw new Error('contended');
    },
  };
  return db;
}
function same(a, b) { return K.canonicalJSON(C.encode(a)) === K.canonicalJSON(C.encode(b)); }
function harness() {
  const f = fixture(), db = memory(f.identity); let time = TIME;
  const deps = { db, identity: f.identity, authenticate: async () => clone(f.credentials), inspectBuild: () => ({ build: f.build }),
    releaseEvidence: async () => clone(f.evidence), now: () => time,
    writeAudit: (tx, input) => { const ref = db.collection('auditEvents').doc(); const built = A.buildAuditEventWrite(input); tx.set(ref, built.write); return { eventId: ref.id, record: built.record }; } };
  const controller = C.createController(deps);
  return { ...f, db, deps, controller, advance: n => { time += n; } };
}
async function initialize(h) { const p = await h.controller.review('prepare', h.options); assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current'); return p; }
async function prepare(h) { await initialize(h); const p = await h.controller.review('prepare', h.options); assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current'); return p; }
async function enable(h) { await prepare(h); const p = await h.controller.review('enable', h.options); assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current'); return p; }
function recoveryOptions(h, overrides = {}) {
  const snap = h.db.rows.get(C.POLICY), previous = snap?.value, valid = P.validateAvailabilityPolicy(previous, h.identity);
  const expected = { updateTime: snap.updateTime, policyInstanceId: valid.ok ? previous.policyInstanceId : null, generation: valid.ok ? previous.generation : null };
  const policyInstanceId = '11111111-1111-4111-8111-111111111111';
  return { reason: 'Separately approved synthetic repair', approvalRef: 'synthetic-repair-approval', policyInstanceId, placementFingerprint: h.build.placementFingerprint,
    recoveryAuthorization: { action: 'recoverClosed', decisionRef: 'synthetic-repair-approval', target: h.identity, expected, replacementPolicyInstanceId: policyInstanceId,
      placementFingerprint: h.build.placementFingerprint, operator: h.credentials.operator, reason: 'Separately approved synthetic repair' }, ...overrides };
}
module.exports = { fixture, memory, harness, clone, initialize, prepare, enable, recoveryOptions, TIME, req, K, P, A, Timestamp };
if (require.main === module) {
  test('dry run is non-persistent; exact confirmed initialization/prepare/enable/close link canonical evidence', async () => {
    const h = harness(); const p = await h.controller.review('prepare', h.options); assert.equal(h.db.rows.size, 0);
    assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current');
    const prepared = await h.controller.review('prepare', h.options); assert.equal((await h.controller.execute(prepared, prepared.confirm)).status, 'committed-current');
    const on = await h.controller.review('enable', h.options); const executed = await h.controller.execute(on, on.confirm); assert.equal(executed.availability, 'enabled'); assert.equal(executed.shutdownConfirmed, false);
    const close = await h.controller.review('close', { reason: 'Emergency close' }); assert.equal((await h.controller.execute(close, close.confirm)).shutdownConfirmed, true);
    const counts = [...h.db.rows.keys()].filter(p => p.startsWith('auditEvents/')); assert.equal(counts.length, 4);
  });
  test('idempotent replay and closed no-op add no audit or history', async () => {
    const h = harness(), p = await initialize(h); const size = h.db.rows.size;
    assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current'); assert.equal(h.db.rows.size, size);
    const no = await h.controller.review('close', {}); assert.equal((await h.controller.execute(no, no.confirm)).status, 'verified-noop'); assert.equal(h.db.rows.size, size);
  });
  test('B2-003 second authorized operator executes unchanged prepare/close without writes', async () => {
    const h=harness(); await prepare(h);
    const before=K.canonicalJSON(C.encode([...h.db.rows]));
    h.credentials.operator={principalSubject:'second-owner',credentialSubject:'second-key',delegationSubject:null};
    for(const command of ['prepare','close']) {
      const p=await h.controller.review(command,command==='prepare'?h.options:{});
      assert.equal((await h.controller.execute(p,p.confirm)).status,'verified-noop');
      assert.equal(K.canonicalJSON(C.encode([...h.db.rows])),before);
    }
  });
  test('B2-003 saved plans remain bound to full authenticated executor identity', async () => {
    for(const command of ['prepare','close','enable']) {
      const h=harness(); await prepare(h);
      const p=await h.controller.review(command,command==='close'?{}:h.options);
      const before=K.canonicalJSON(C.encode([...h.db.rows]));
      h.credentials.operator={...h.credentials.operator,principalSubject:'another-owner'};
      await assert.rejects(h.controller.execute(p,p.confirm),/credential context changed/);
      assert.equal(K.canonicalJSON(C.encode([...h.db.rows])),before);
    }
  });
  test('second operator actual write has current authenticated attribution',async()=>{
    const h=harness();await prepare(h);
    h.credentials.operator={principalSubject:'second-owner',credentialSubject:'second-key',delegationSubject:null};
    const p=await h.controller.review('enable',h.options);
    assert.equal((await h.controller.execute(p,p.confirm)).status,'committed-current');
    assert.deepEqual(h.db.rows.get(C.POLICY).value.updatedBy,h.credentials.operator);
    const event=h.db.rows.get(`${C.HISTORY}/${p.transitionId}`).value;
    assert.deepEqual(event.operator,h.credentials.operator);
    assert.equal(h.db.rows.get(`auditEvents/${event.auditEventId}`).value.actorUserId,'second-owner');
  });
  test('stale compare-and-set and concurrent enable/close never blindly rebase', async () => {
    const h = harness(); await prepare(h);
    const a = await h.controller.review('enable', h.options), b = await h.controller.review('prepare', { ...h.options, reason: 'another review' });
    // An unchanged preparation is a true no-op; competing enables share one CAS.
    const other = await h.controller.review('enable', h.options);
    const results = await Promise.all([h.controller.execute(a, a.confirm), h.controller.execute(other, other.confirm)]);
    assert.equal(results.filter(r => r.status === 'committed-current').length, 1); assert.equal(results.filter(r => r.status === 'conflicting').length, 1);
    assert.equal((await h.controller.execute(b, b.confirm)).status, 'conflicting');
  });
  for (const path of ['auditEvents/', C.HISTORY]) test(`failure writing ${path} rolls back all documents`, async () => {
    const h = harness(); const p = await h.controller.review('prepare', h.options); h.db.faults.failPath = path;
    const r = await h.controller.execute(p, p.confirm); assert.equal(r.status, 'unconfirmed'); assert.equal(r.shutdownConfirmed, false); assert.equal(h.db.rows.size, 0);
  });
  test('lost commit response reconciles by same command without duplicate writes', async () => {
    const h = harness(); const p = await h.controller.review('prepare', h.options); h.db.faults.lostCommit = true;
    assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current'); const size = h.db.rows.size;
    assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current'); assert.equal(h.db.rows.size, size);
  });
  test('failed readback and unavailable policy report uncertainty, never shutdown', async () => {
    const h = harness(), p = await h.controller.review('prepare', h.options); h.db.faults.afterCommit = () => { h.db.faults.unreadable = true; };
    const r = await h.controller.execute(p, p.confirm); assert.equal(r.status, 'unconfirmed'); assert.equal(r.shutdownConfirmed, false);
    await assert.rejects(h.controller.review('close', {}));
  });
  test('history, audit and policy updateTime tampering cannot verify', async () => {
    for (const kind of ['history', 'audit', 'updateTime']) {
      const h = harness(), p = await initialize(h);
      const history = h.db.rows.get(`${C.HISTORY}/${p.transitionId}`);
      if (kind === 'history') history.value.extra = true;
      else if (kind === 'audit') h.db.rows.get(`auditEvents/${history.value.auditEventId}`).value.actorUserId = 'spoof';
      else h.db.rows.get(C.POLICY).updateTime = new Timestamp(1, 0);
      assert.equal((await h.controller.verify(p)).status, 'unconfirmed');
    }
  });
  test('verified superseded enable never claims currently enabled or successful shutdown', async () => {
    const h = harness(), on = await enable(h); const off = await h.controller.review('close', { reason: 'Close now' }); await h.controller.execute(off, off.confirm);
    const r = await h.controller.verify(on); assert.equal(r.status, 'committed-superseded'); assert.equal(r.availability, 'closed'); assert.equal(r.shutdownConfirmed, false);
  });
  test('MAX enabled remains enabled; ordinary close refuses and separate repair is atomic and verified', async () => {
    const h = harness(); await enable(h); h.db.rows.get(C.POLICY).value.generation = Number.MAX_SAFE_INTEGER;
    const size = h.db.rows.size;
    await assert.rejects(h.controller.review('close', { reason: 'Close' }), /still enabled; recovery required/);
    assert.equal(h.db.rows.get(C.POLICY).value.mode, 'enabled'); assert.equal(h.db.rows.size, size);
    await assert.rejects(h.controller.review('recoverClosed', { reason: 'No authorization' }));
    const p = await h.controller.review('recoverClosed', recoveryOptions(h));
    assert.equal((await h.controller.execute(p, p.confirm)).shutdownConfirmed, true); assert.equal(h.db.rows.get(C.POLICY).value.generation, 1);
  });
  test('legacy/malformed state repairs only with null validated IDs and exact snapshot', async () => {
    const h = harness(); await initialize(h); h.db.rows.get(C.POLICY).value = { schemaVersion: 1, legacy: 'private before evidence' };
    await assert.rejects(h.controller.review('close', {}));
    const p = await h.controller.review('recoverClosed', recoveryOptions(h)); assert.equal(p.expected.policyInstanceId, null);
    assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current');
    const history = h.db.rows.get(`${C.HISTORY}/${p.transitionId}`).value; assert.equal(JSON.stringify(history).includes('private before evidence'), false);
  });
  test('default audit writer allocates on the bound database, never the ambient Admin app', async () => {
    // Regression: the impersonated operator Firestore is not getAdminFirestore(),
    // so the Admin-bound helper refused every staging recoverClosed execution.
    const h = harness(), { writeAudit, ...deps } = h.deps, controller = C.createController(deps);
    const p = await controller.review('prepare', h.options); assert.equal((await controller.execute(p, p.confirm)).status, 'committed-current');
    h.db.rows.get(C.POLICY).value = { schemaVersion: 1, legacy: 'private before evidence' };
    const r = await controller.review('recoverClosed', recoveryOptions(h));
    const executed = await controller.execute(r, r.confirm); assert.equal(executed.status, 'committed-current'); assert.equal(executed.shutdownConfirmed, true);
    const history = h.db.rows.get(`${C.HISTORY}/${r.transitionId}`).value, audit = h.db.rows.get(`auditEvents/${history.auditEventId}`).value;
    assert.equal(audit.correlationId, r.transitionId); assert.equal(audit.payload.transition, 'recoverClosed'); assert.ok(audit.occurredAt instanceof Timestamp);
    assert.equal(req('firebase-admin/app').getApps().length, 0);
  });
  test('wrong confirmation, stale plan, different identity and different authenticated subject refuse before dispatch', async () => {
    for (const change of ['confirm', 'expiry', 'subject', 'project']) {
      const h = harness(), p = await h.controller.review('prepare', h.options);
      if (change === 'expiry') h.advance(600001);
      if (change === 'subject') h.credentials.operator.credentialSubject = 'different';
      if (change === 'project') p.target.projectId = 'lyfelabz-prod';
      await assert.rejects(h.controller.execute(p, change === 'confirm' ? 'a'.repeat(64) : p.confirm)); assert.equal(h.db.rows.size, 0);
    }
  });
  test('missing, expired, unprivileged and wrong-project credential contexts refuse', async () => {
    for (const change of ['missing', 'expired', 'permissions', 'target', 'browser']) {
      const h = harness();
      if (change === 'missing') h.deps.authenticate = async () => null;
      if (change === 'expired') h.credentials.expiresAt = TIME;
      if (change === 'permissions') h.credentials.permissions = C.READ;
      if (change === 'target') h.credentials.target = C.target('demo-other');
      if (change === 'browser') h.credentials.source = 'browser-claims';
      await assert.rejects(C.createController(h.deps).review('prepare', h.options)); assert.equal(h.db.rows.size, 0);
    }
  });
  test('prepare validates clean build and enable requires fresh matching synthetic acceptance', async () => {
    const h = harness(); h.build.sourceDirty = true; await assert.rejects(h.controller.review('prepare', h.options));
    h.build.sourceDirty = false; await prepare(h); h.evidence.observedAt = new Date(TIME - 300001).toISOString();
    await assert.rejects(h.controller.review('enable', h.options));
  });
  test('strict CLI target and identity flags reject defaults, browser labels and mismatched environments', () => {
    for (const args of [['show'], ['close', '--project', 'demo-a', '--principal', 'teacher'], ['close', '--project', 'demo-a', '--execute']]) assert.throws(() => C.parse(args));
    assert.throws(() => C.target('lyfelabz-prod', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }));
    assert.throws(() => C.target('lyfelabz-staging', { GCLOUD_PROJECT: 'lyfelabz-prod' }));
  });
  test('provider authentication checks token subject, expiry, project number and complete IAM permissions', async () => {
    const identity = C.target('lyfelabz-staging'), email = 'operator@lyfelabz-staging.iam.gserviceaccount.com';
    const accessReview = { schemaVersion: 1, projectId: identity.projectId, projectNumber: identity.projectNumber, databaseId: '(default)',
      principalSubject: email, permissionCheckScope: 'project', blastRadiusAccepted: true, approvalRef: 'owner-access-review' };
    for (const fail of [null, 'email', 'expiry', 'project', 'permissions', 'review']) {
      const client = { getAccessToken: async () => ({ token: 'synthetic-access-token' }),
        getTokenInfo: async () => ({ email: fail === 'email' ? 'teacher@example.test' : email, email_verified: true,
          expiry_date: fail === 'expiry' ? TIME : TIME + 3600000, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }),
        request: async ({ url }) => ({ data: url.includes(':testIamPermissions') ? { permissions: fail === 'permissions' ? C.READ : C.WRITE } :
          { projectId: identity.projectId, name: `projects/${fail === 'project' ? '0' : identity.projectNumber}`, state: 'ACTIVE' } }) };
      const promise = C.verifyCredential({ client, identity, email, accessReview: { ...accessReview, blastRadiusAccepted: fail !== 'review' }, now: () => TIME, write: true });
      if (fail) await assert.rejects(promise); else assert.equal((await promise).operator.principalSubject, email);
    }
  });
  test('saved plans cannot relabel enable as close or detach the next-policy command ID', async () => {
    const h = harness(); await prepare(h); const p = await h.controller.review('enable', h.options);
    p.command = 'close'; await assert.rejects(h.controller.execute(p, p.confirm), /command\/transition mismatch/);
    const changed = await h.controller.review('enable', h.options); changed.next.transitionId = '33333333-3333-4333-8333-333333333333';
    await assert.rejects(h.controller.execute(changed, changed.confirm), /transition ID mismatch/);
    assert.equal(h.db.rows.get(C.POLICY).value.mode, 'closed');
  });
  test('malformed JSON timestamps and nonfinite generations remain malformed through private evidence serialization', async () => {
    for (const kind of ['json-time', 'nan-generation']) {
      const h = harness(); await initialize(h); const raw = h.db.rows.get(C.POLICY).value;
      if (kind === 'json-time') raw.updatedAt = { seconds: raw.updatedAt.seconds, nanoseconds: raw.updatedAt.nanoseconds };
      else raw.generation = NaN;
      const p = await h.controller.review('recoverClosed', recoveryOptions(h));
      assert.equal(p.previousPolicyDigest, null); assert.equal(p.expected.policyInstanceId, null);
      assert.equal((await h.controller.execute(p, p.confirm)).status, 'committed-current');
    }
  });
  test('private before-snapshot tampering, expired preparation and conflicting command IDs refuse', async () => {
    const h = harness(); const initial = await initialize(h);
    const p = await h.controller.review('prepare', h.options); p.privateBeforeSnapshot[1][0][1] = ['string', 'tampered'];
    await assert.rejects(h.controller.execute(p, p.confirm), /snapshot digest mismatch/);
    const old = await h.controller.review('prepare', { ...h.options, releasePreparedAt: new Date(TIME - 86400000 + 1).toISOString() });
    h.advance(2); await assert.rejects(h.controller.execute(old, old.confirm), /preparation record expired/);
    const original = await h.controller.review('prepare', h.options); await h.controller.execute(original, original.confirm);
    const conflict = C.createController({ ...h.deps, uuid: () => initial.transitionId });
    const on = await conflict.review('enable', h.options);
    assert.equal((await conflict.execute(on, on.confirm)).status, 'conflicting');
  });
  test('post-dispatch credential expiry never turns a possibly committed write into a claimed failure', async () => {
    const h = harness(); const p = await h.controller.review('prepare', h.options);
    h.db.faults.afterCommit = () => { h.credentials.expiresAt = TIME; };
    const r = await h.controller.execute(p, p.confirm); assert.equal(r.status, 'unconfirmed'); assert.equal(r.shutdownConfirmed, false);
    assert.equal(h.db.rows.get(C.POLICY).value.mode, 'closed');
  });
  test('show reports bounded history and unconfirmed visibility rather than inventing absence', async () => {
    const h = harness(); await initialize(h); const r = await h.controller.review('show');
    assert.equal(r.policy.mode, 'closed'); assert.equal(r.recentHistory.length, 1);
    h.db.faults.unreadable = true;
    assert.equal((await h.controller.review('show')).status, 'unconfirmed');
  });

  test('selected service-account certificate is compatible with the installed Admin Firestore SDK without credential discovery', async () => {
    const { generateKeyPairSync } = require('node:crypto');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const identity = C.target('demo-option-b-cert', {}), key = { project_id: 'synthetic-issuer',
      client_email: 'synthetic@synthetic-issuer.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const app = C.selectedApp(identity, key), db = req('firebase-admin/firestore').getFirestore(app);
    // No RPC is made. Even an accidental call is forced to a local closed port.
    db.settings({ host: '127.0.0.1:1', ssl: false });
    try { assert.equal(db.projectId, identity.projectId); assert.equal(db.databaseId, '(default)');
      assert.equal(db._settings.credentials.client_email, key.client_email);
    } finally { await db.terminate(); await req('firebase-admin/app').deleteApp(app); }
  });

  test('real-project enable refuses missing release evidence and unverified context; flags grant no authority', async () => {
    for (const project of ['lyfelabz-prod','lyfelabz-staging']) {
      const h=harness(),identity=C.target(project,{}),db=memory(identity);
      const controller=C.createController({...h.deps,identity,db,authenticate:async()=>({...h.credentials,target:identity})});
      await assert.rejects(controller.review('enable',h.options),/unverified credentials/);
      let output='';
      const code=await C.main(['enable','--project',project,'--live'],{env:{MY_UNITS_ENABLED:'true'},connect:async()=>({controller}),stdout:{write:v=>output+=v},stderr:{write:v=>output+=v}});
      assert.equal(code,1);assert.match(output,/unverified credentials/);assert.equal(db.rows.size,0);
    }
  });
  test('read-only pre-enable refuses demo identity and leaves policy/history/audit unchanged', async () => {
    const h = harness(); await prepare(h);
    const before = K.canonicalJSON(C.encode([...h.db.rows]));
    await assert.rejects(h.controller.preEnable(h.options), /explicit real-project target/);
    assert.equal(K.canonicalJSON(C.encode([...h.db.rows])), before);
    assert.throws(() => C.parse(['checkEnable', '--project', 'lyfelabz-prod', '--execute', '--confirm', 'x', '--plan', 'x']), /read-only/);
  });

  async function realHarness(project='lyfelabz-staging') {
    const f=await require('./option-b-observation.test.cjs').certifiedPathFixture();
    if(project!=='lyfelabz-staging') {f.cleanup();return projectHarness(project);}
    return projectHarness(project,f);
  }
  async function projectHarness(project,f) {
    f=f??await require('./option-b-observation.test.cjs').currentReleaseFixture({project});
    const identity=C.target(project,{}),clock=Date.parse(f.options.now),db=memory(identity,clock);
    db.rows.set(C.POLICY,{value:clone(f.policy),updateTime:Timestamp.fromMillis(clock)});
    const operator={principalSubject:'mock-verified-owner',credentialSubject:'mock-verified-credential',delegationSubject:null};
    const credential={target:identity,operator,permissions:C.WRITE,expiresAt:clock+3600000,source:'verified-provider'};
    let evidence=clone(f.bundle);
    const deps={db,identity,now:()=>clock,authenticate:async()=>clone(credential),releaseEvidence:async()=>clone(evidence),
      writeAudit:(tx,input)=>{const ref=db.collection('auditEvents').doc();const built=A.buildAuditEventWrite(input);tx.set(ref,built.write);return {eventId:ref.id};}};
    return {f,db,identity,credential,deps,controller:C.createController(deps),options:{reason:'Explicit local modeled activation',approvalRef:f.options.approvalRef},setEvidence:v=>{evidence=v;},cleanup:f.cleanup};
  }
  test('E2 mocked real-project dry run and checkEnable do not persist; explicit execute enables with atomic audit; close is independent',async()=>{
    for(const project of ['lyfelabz-staging','lyfelabz-prod']) {
      const h=await realHarness(project);try {
        const before=K.canonicalJSON(C.encode([...h.db.rows]));
        const result=await h.controller.preEnable(h.options);assert.equal(result.liveEnable,'explicit-confirmation-required');assert.equal(result.availability,'closed');
        const p=await h.controller.review('enable',h.options);
        assert.equal(K.canonicalJSON(C.encode([...h.db.rows])),before);
        await assert.rejects(h.controller.execute(p,'wrong-confirmation'),/confirmation/);
        const executed=await h.controller.execute(p,p.confirm);assert.equal(executed.status,'committed-current');assert.equal(executed.availability,'enabled');
        assert.equal((await h.controller.execute(p,p.confirm)).status,'committed-current');
        assert.equal([...h.db.rows.keys()].filter(p=>p.startsWith('auditEvents/')).length,1);
        const off=C.createController({...h.deps,releaseEvidence:async()=>{throw new Error('registry/Hosting/release unavailable');}});
        const close=await off.review('close',{reason:'Emergency disable'});
        assert.equal((await off.execute(close,close.confirm)).shutdownConfirmed,true);
        assert.equal(h.db.rows.get(C.POLICY).value.mode,'closed');
      }finally{h.cleanup();}
    }
  });
  test('E2 real-project activation refuses missing approvals, foreign identity, synthetic/legacy/partial evidence and preserves closure',async()=>{
    const h=await realHarness();try {
      for(const change of [b=>{b.rulesApproval=null;},b=>{b.backendBuildId='0'.repeat(64);},b=>{b.policyGeneration++;},b=>{b.observedAt='2020-01-01T00:00:00.000Z';},b=>{b.certifiedReceipt.schemaVersion=1;},b=>{b.provenance='synthetic, not provider-verified';},b=>{b.rollback=null;},b=>{b.projectId='lyfelabz-prod';},b=>{b.observation.endpoints.pop();}]) {
        const b=clone(h.f.bundle);change(b);h.setEvidence(b);
        await assert.rejects(h.controller.review('enable',h.options));assert.equal(h.db.rows.get(C.POLICY).value.mode,'closed');
      }
      h.setEvidence(clone(h.f.bundle));
      await assert.rejects(h.controller.review('enable',{reason:'No decision'}));
      h.credential.permissions=[];await assert.rejects(h.controller.review('enable',h.options),/not authorized/);
      assert.equal(h.db.rows.size,1);
    }finally{h.cleanup();}
  });
  test('E2 real-project execute revalidates exact release and CAS; failed audit cannot enable',async()=>{
    const h=await realHarness();try {
      const p=await h.controller.review('enable',h.options);
      const changed=clone(h.f.bundle);changed.rollback.artifactRef='another-artifact.zip';h.setEvidence(changed);
      await assert.rejects(h.controller.execute(p,p.confirm),/release or CAS changed/);
      h.setEvidence(clone(h.f.bundle));
      h.db.faults.failPath='auditEvents/';
      const failed=await h.controller.execute(p,p.confirm);assert.equal(failed.status,'unconfirmed');assert.equal(h.db.rows.size,1);assert.equal(h.db.rows.get(C.POLICY).value.mode,'closed');
      h.db.faults.failPath=null;
      const q=await h.controller.review('enable',h.options);
      h.db.rows.get(C.POLICY).updateTime=new Timestamp(0,99);
      await assert.rejects(h.controller.execute(q,q.confirm),/release or CAS changed/);
      assert.equal(h.db.rows.size,1);
    }finally{h.cleanup();}
  });
  test('E2 real-project lost commit and supersession reconcile without duplicate activation',async()=>{
    const h=await realHarness();try {
      const p=await h.controller.review('enable',h.options);h.db.faults.lostCommit=true;
      assert.equal((await h.controller.execute(p,p.confirm)).status,'committed-current');
      const close=await h.controller.review('close',{reason:'Disable'});await h.controller.execute(close,close.confirm);
      const r=await h.controller.execute(p,p.confirm);assert.equal(r.status,'committed-superseded');assert.equal(r.availability,'closed');
      assert.equal([...h.db.rows.keys()].filter(p=>p.startsWith('auditEvents/')).length,2);
    }finally{h.cleanup();}
  });
  test('E2 CLI dry-run saves exact private plan; execution requires matching command, target and confirmation',async()=>{
    const fs=require('node:fs'),os=require('node:os');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e2-cli-')),file=path.join(dir,'enable.json');
    const h=await realHarness();let output='';
    const ctx={env:{},connect:async()=>({controller:h.controller}),stdout:{write:v=>output+=v},stderr:{write:v=>output+=v}};
    try {
      assert.equal(await C.main(['enable','--project',h.identity.projectId,'--approval-ref',h.options.approvalRef,'--reason','Explicit enable decision','--out',file],ctx),0);
      assert.equal(h.db.rows.get(C.POLICY).value.mode,'closed');assert.equal(fs.statSync(file).mode&0o777,0o600);
      const p=JSON.parse(fs.readFileSync(file,'utf8'));
      assert.equal(await C.main(['close','--project',h.identity.projectId,'--plan',file,'--execute','--confirm',p.confirm],ctx),1);
      assert.equal(await C.main(['enable','--project','lyfelabz-prod','--plan',file,'--execute','--confirm',p.confirm],ctx),1);
      assert.equal(await C.main(['enable','--project',h.identity.projectId,'--plan',file,'--execute','--confirm',p.confirm],ctx),0);
      assert.equal(h.db.rows.get(C.POLICY).value.mode,'enabled');
    }finally{h.cleanup();fs.rmSync(dir,{recursive:true,force:true});}
  });
}
