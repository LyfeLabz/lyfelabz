'use strict';
// A3-6 S6a create-only registration against the Firestore EMULATOR only (demo- project,
// loopback host, no credentials). Run under:
//   firebase emulators:exec --only firestore --project demo-a3-s6a "node --test ..."
// SYNTHETIC fixtures only; nothing here is provider-verified.
const assert = require('node:assert/strict');
const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const RG = require('./registration.cjs');
const C = require('./cli.cjs');
const F = require('./fixtures/synthetic-release.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const B = require('../../platform/functions/lib/teacherUnits/a3-bindings.js');

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const env = { FIRESTORE_EMULATOR_HOST: HOST };
const E = F.expectedFor();
const keys = F.testKeys();
const deps = { registry: F.registryFor(F.PROJECT, keys), revocationList: F.revocationsFor(F.PROJECT) };
let client, db;

before(() => {
  if (!HOST) throw new Error('FIRESTORE_EMULATOR_HOST is unset: run these tests under firebase emulators:exec with a demo- project');
  client = RG.emulatorFirestore(E, env);
  db = client.db;
});
after(() => client && client.close());
beforeEach(() => F.clearEmulator());

const refused = (promiseOrFn, pattern) => (typeof promiseOrFn === 'function'
  ? assert.throws(promiseOrFn, e => { assert.match(e.message, /REFUSED/); assert.match(e.message, pattern); return true; })
  : assert.rejects(promiseOrFn, e => { assert.match(e.message, /REFUSED/); assert.match(e.message, pattern); return true; }));
const inputs = (item, overrides = {}) => ({ document: item.document, expected: E, ...deps, statementBytes: item.statementBytes, ...overrides });
const prep = (item, overrides = {}) => RG.prepareRegistration({ now: F.NOW, ...inputs(item, overrides) });
async function reg(item, overrides = {}) {
  const { now = F.NOW, ...rest } = overrides;
  const prepared = prep(item, overrides);
  return RG.register({ db, ...inputs(item, rest), confirm: prepared.confirmDigest, now: () => now, env });
}
const later = ms => F.at(F.NOW, ms).toISOString();
const DAY = 24 * 3600 * 1000;
// Wraps the real client so the installed SDK's own retry loop reruns the callback: the
// first `aborts` attempts end with a retryable ABORTED (code 10) after the callback ran.
function retrying(aborts, counter) {
  return new Proxy(db, { get(target, key) {
    if (key === 'runTransaction') {
      return (fn, options) => target.runTransaction(async tx => {
        const attempt = ++counter.attempts;
        const result = await fn(tx);
        if (attempt <= aborts) throw Object.assign(new Error('synthetic ABORTED contention'), { code: 10 });
        return result;
      }, options);
    }
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
const ORDER = ['deployment', 'release', 'certification', 'activationApproval', 'activationEvidence'];
async function registerChain(chain) { for (const name of ORDER) assert.equal((await reg(chain[name])).status, 'created', name); }
const exists = async ref => (await db.doc(ref).get()).exists;
const count = async collection => (await db.collection(collection).get()).size;

test('a signed chain registers in dependency order; identical retries are validated duplicates', async () => {
  const chain = F.buildChain({ keys });
  await registerChain(chain);
  for (const name of ORDER) {
    const stored = (await db.doc(chain[name].ref).get()).data();
    assert.equal(K.canonicalJSON(stored), K.canonicalJSON(chain[name].document));
    assert.equal((await reg(chain[name])).status, 'duplicate');
  }
  assert.equal(await count('teacherUnitsReleaseEvidence'), 4);
  assert.equal(await count('teacherUnitsBackendReleases'), 1);
});

test('dependency order is enforced: nothing is written before its ancestors exist', async () => {
  const chain = F.buildChain({ keys });
  await refused(reg(chain.release), /dependency not registered: teacherUnitsReleaseEvidence\//);
  await refused(reg(chain.certification), /dependency not registered: teacherUnitsBackendReleases\//);
  await refused(reg(chain.activationApproval), /dependency not registered/);
  await refused(reg(chain.activationEvidence), /dependency not registered/);
  for (const name of ORDER) assert.equal(await exists(chain[name].ref), false);
});

test('a different document already at the address (a direct P1 write) is a conflict, never overwritten', async () => {
  const chain = F.buildChain({ keys });
  const tampered = JSON.parse(JSON.stringify(chain.deployment.document));
  tampered.payload.source.signerKeyId = 'tampered';
  await db.doc(chain.deployment.ref).set(tampered); // test acting as a Firestore-write principal
  await refused(reg(chain.deployment), /a different document already exists/);
  assert.equal((await db.doc(chain.deployment.ref).get()).data().payload.source.signerKeyId, 'tampered');
  // Release written against the tampered approval refuses its deployment binding.
  await refused(reg(chain.release), /release deployment binding structure invalid/);
});

test('synthetic or unrecognized signatures never register', () => {
  const zero = F.buildChain({ keys: null });
  refused(() => prep(zero.deployment), /signature unverified: authorityUnrecognized/);
  const stranger = F.buildChain({ keys: F.testKeys() });
  refused(() => prep(stranger.deployment), /signature unverified: authorityUnrecognized/);
  // A registered key with a zero (or any forged) signature over the real statement bytes.
  const honest = F.buildChain({ keys }).deployment;
  const forged = JSON.parse(JSON.stringify(honest.document));
  forged.payload.source.signatureBase64 = F.ZERO_SIGNATURE;
  refused(() => prep({ document: forged, statementBytes: honest.statementBytes }), /signature unverified: signatureUnverified/);
  const wrongSystem = { registry: F.registryFor(F.PROJECT, keys, { approvalSystemId: 'some-other-system' }), revocationList: deps.revocationList };
  refused(() => prep(F.buildChain({ keys }).deployment, wrongSystem), /authorityUnrecognized/);
  refused(() => prep(F.buildChain({ keys }).deployment, { registry: { entries: deps.registry.entries } }), /createAuthorityRegistry/);
  refused(() => prep(F.buildChain({ keys }).deployment, { revocationList: { identity: F.identity(), entries: [] } }), /createRevocationList/);
});

test('D6 at registration: approvals over 24 hours old or in the future refuse; certification has no age limit', () => {
  const chain = F.buildChain({ keys });
  const later = h => F.at(F.NOW, h * 3600000).toISOString();
  refused(() => prep(chain.deployment, { now: later(25) }), /more than 24 hours before registration/);
  refused(() => prep(chain.activationApproval, { now: later(24.01) }), /more than 24 hours/);
  refused(() => prep(chain.deployment, { now: F.at(F.NOW, -1000).toISOString() }), /in the future/);
  assert.ok(prep(chain.deployment, { now: later(24) }));
  assert.ok(prep(chain.certification, { now: later(24 * 400) }));
  refused(() => prep(chain.certification, { now: F.at(F.NOW, -1).toISOString() }), /in the future/);
});

test('statement bytes must be exactly the canonical statement at its hash', () => {
  const chain = F.buildChain({ keys });
  refused(() => prep(chain.deployment, { statementBytes: undefined }), /statement bytes required/);
  refused(() => prep(chain.deployment, { statementBytes: Buffer.from(JSON.stringify(chain.deployment.statement, null, 2)) }), /do not match/);
  refused(() => prep(chain.deployment, { statementBytes: chain.certification.statementBytes }), /do not match/);
  refused(() => prep(chain.release, { statementBytes: chain.deployment.statementBytes }), /apply only to signed statements/);
});

test('cross-environment documents refuse', () => {
  const chain = F.buildChain({ keys });
  refused(() => prep(chain.deployment, { expected: F.expectedFor('demo-other') }), /structure invalid/);
  const other = F.buildChain({ keys, expected: F.expectedFor('demo-other') });
  refused(() => prep(other.deployment), /structure invalid/);
});

test('pinned revocations refuse the document and every dependent; dispositions still record decisions', async () => {
  const chain = F.buildChain({ keys });
  const revoked = ref => ({ revocationList: F.revocationsFor(F.PROJECT, [ref]) });
  refused(() => prep(chain.deployment, revoked(chain.deployment.ref)), /on the pinned revocation list/);
  refused(() => prep(chain.release, revoked(chain.deployment.ref)), /on the pinned revocation list/);
  refused(() => prep(chain.activationEvidence, revoked(chain.activationApproval.ref)), /on the pinned revocation list/);
  refused(() => prep(chain.activationApproval, revoked(chain.certification.ref)), /on the pinned revocation list/);
  refused(() => prep(chain.release, { revocationList: F.revocationsFor('demo-other') }), /revocation status unresolved/);

  await registerChain(chain);
  const revoke = F.signedDocument('approval-disposition', { action: 'revoke', targetApprovalRef: chain.activationApproval.ref, replacementApprovalRef: null }, keys.dispose);
  // The target may already be pinned as revoked: the disposition is the signed audit record.
  assert.equal((await reg(revoke, revoked(chain.activationApproval.ref))).status, 'created');
  // Supersede across kinds refuses (D7 fix 3): a certification cannot replace an activation approval.
  const cross = F.signedDocument('approval-disposition', { action: 'supersede', targetApprovalRef: chain.activationApproval.ref, replacementApprovalRef: chain.certification.ref }, keys.dispose);
  await refused(reg(cross), /disposition binding structure invalid/);
  const orphan = F.signedDocument('approval-disposition', { action: 'revoke', targetApprovalRef: `teacherUnitsReleaseEvidence/${'e'.repeat(64)}`, replacementApprovalRef: null }, keys.dispose);
  await refused(reg(orphan), /dependency not registered/);
});

test('the confirmation digest binds the exact registration', async () => {
  const chain = F.buildChain({ keys });
  const prepared = prep(chain.deployment);
  assert.equal(prepared.confirmDigest, K.contentDigest(prepared.intent));
  const write = confirm => RG.register({ db, ...inputs(chain.deployment), confirm, now: () => F.NOW, env });
  await refused(write('a'.repeat(64)), /confirmation digest does not match/);
  await refused(write(prep(chain.certification, {}).confirmDigest), /confirmation digest does not match/);
  await refused(write(undefined), /--confirm <digest>/);
  assert.equal(await exists(chain.deployment.ref), false);
});

test('concurrent identical registrations: exactly one create, every other a validated duplicate', async () => {
  const chain = F.buildChain({ keys });
  const results = await Promise.all(Array.from({ length: 6 }, () => reg(chain.deployment)));
  assert.deepEqual(results.map(r => r.status).sort(), ['created', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
  assert.equal(await count('teacherUnitsReleaseEvidence'), 1);
  assert.ok(B.validateEvidenceReference(chain.deployment.ref, (await db.doc(chain.deployment.ref).get()).data(), E).ok);
});

test('the writer itself refuses cloud targets, a missing emulator and mismatched clients', async () => {
  const chain = F.buildChain({ keys });
  const prepared = prep(chain.deployment);
  const write = (expected, environment, database = db) => RG.register({ db: database, ...inputs(chain.deployment, { expected }), confirm: prepared.confirmDigest,
    now: () => F.NOW, env: environment });
  for (const cloud of [{ environment: 'staging', projectId: 'lyfelabz-staging', projectNumber: '293337283840' },
    { environment: 'production', projectId: 'lyfelabz-prod', projectNumber: '182791689935' }]) {
    await refused(write(cloud, env), /emulator-only/);
    refused(() => RG.emulatorFirestore(cloud, env), /emulator-only/);
  }
  await refused(write({ ...E, projectId: 'not-demo' }, env), /emulator-only/);
  await refused(write(E, {}), /FIRESTORE_EMULATOR_HOST on a loopback address/);
  await refused(write(E, { FIRESTORE_EMULATOR_HOST: 'example.com:8080' }), /loopback/);
  await refused(write(E, { ...env, GCLOUD_PROJECT: 'lyfelabz-prod' }), /GCLOUD_PROJECT disagrees/);
  const other = RG.emulatorFirestore(F.expectedFor('demo-other'), env);
  try { await refused(write(E, env, other.db), /not bound to the target emulator project/); } finally { await other.close(); }
  // A cloud-routed client (built without the emulator variable) refuses even when the
  // caller's env claims a loopback emulator. No request is made: refusal precedes use.
  const { initializeApp, deleteApp } = RG.functionsModule('firebase-admin/app');
  const { getFirestore } = RG.functionsModule('firebase-admin/firestore');
  delete process.env.FIRESTORE_EMULATOR_HOST;
  let app, cloudRouted;
  try { app = initializeApp({ projectId: F.PROJECT }, 'cloud-routed-test'); cloudRouted = getFirestore(app); } finally { process.env.FIRESTORE_EMULATOR_HOST = HOST; }
  try { await refused(write(E, env, cloudRouted), /not routed to a loopback emulator/); } finally { await deleteApp(app); }
  assert.equal(await exists(chain.deployment.ref), false);
});

test('CLI register: dry run by default, then --execute with the printed --confirm', async () => {
  const chain = F.buildChain({ keys });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6a-reg-'));
  const files = { 'doc.json': chain.deployment.document, 'registry.json': F.registryEntries(F.PROJECT, keys), 'revocations.json': [] };
  for (const [name, v] of Object.entries(files)) fs.writeFileSync(path.join(cwd, name), JSON.stringify(v));
  fs.writeFileSync(path.join(cwd, 'statement.json'), chain.deployment.statementBytes);
  const run = async argv => {
    const out = [], err = [];
    const code = await C.main(argv, { env, cwd, now: () => F.NOW, stdout: { write: s => out.push(s) }, stderr: { write: s => err.push(s) } });
    return { code, stderr: err.join(''), json: code === 0 ? JSON.parse(out.join('')) : null };
  };
  const base = ['register', '--project', F.PROJECT, '--document', 'doc.json', '--statement-bytes', 'statement.json', '--registry', 'registry.json', '--revocations', 'revocations.json'];
  const dry = await run(base);
  assert.equal(dry.code, 0, dry.stderr);
  assert.equal(dry.json.result.dryRun, true);
  assert.equal(await exists(chain.deployment.ref), false);
  const wrong = await run([...base, '--execute', '--confirm', 'b'.repeat(64)]);
  assert.equal(wrong.code, 1); assert.match(wrong.stderr, /confirmation digest does not match/);
  const done = await run([...base, '--execute', '--confirm', dry.json.result.confirm]);
  assert.equal(done.code, 0, done.stderr);
  assert.deepEqual(done.json.result, { status: 'created', ref: chain.deployment.ref });
  assert.equal(await exists(chain.deployment.ref), true);
});

test('F1: D6 freshness is re-verified with each attempt clock; crossing 24 hours before an SDK rerun refuses', async () => {
  const chain = F.buildChain({ keys });
  await reg(chain.deployment); await reg(chain.release);
  const run = async (item, clocks, aborts = 1) => {
    const counter = { attempts: 0 };
    let call = 0;
    const prepared = prep(item, { now: clocks[0] });
    const outcome = RG.register({ db: retrying(aborts, counter), ...inputs(item), confirm: prepared.confirmDigest, now: () => clocks[call++], env });
    return { outcome, counter, calls: () => call };
  };
  // Certification age semantics unchanged: no age limit, so the late rerun creates.
  const certification = await run(chain.certification, [later(DAY - 1), later(400 * DAY)]);
  assert.equal((await certification.outcome).status, 'created');
  assert.equal(certification.counter.attempts, 2);
  // Fresh on the first attempt, 24 hours plus 1 ms on the SDK rerun: refused, nothing written.
  const approval = await run(chain.activationApproval, [later(DAY - 1), later(DAY + 1)]);
  await assert.rejects(approval.outcome, /activation-approval was issued more than 24 hours before registration/);
  assert.equal(approval.counter.attempts, 2, 'the refusal happened on the SDK rerun, not the first attempt');
  assert.equal(await exists(chain.activationApproval.ref), false);
  // A clock that moves before issuedAt on the rerun refuses as a future statement.
  const future = await run(chain.activationApproval, [later(1000), later(-1)]);
  await assert.rejects(future.outcome, /issuedAt is in the future/);
  assert.equal(future.counter.attempts, 2);
  // Control: the same rerun within the window creates on the second attempt.
  const fresh = await run(chain.activationApproval, [later(DAY - 2), later(DAY - 1)]);
  assert.equal((await fresh.outcome).status, 'created');
  assert.equal(fresh.counter.attempts, 2);
  assert.equal(fresh.calls(), 2, 'the tooling clock is read once per attempt');
});

test('F1: an expired dry-run verdict is never reused: a dry run inside the window does not carry an execute outside it', async () => {
  const chain = F.buildChain({ keys });
  const prepared = prep(chain.deployment, { now: later(DAY - 1) });
  await refused(RG.register({ db, ...inputs(chain.deployment), confirm: prepared.confirmDigest, now: () => later(DAY + 1), env }), /more than 24 hours/);
  assert.equal(await exists(chain.deployment.ref), false);
});

test('F2: the writer accepts no prepared object, destination or claims; it rebuilds them from the raw inputs', async () => {
  const chain = F.buildChain({ keys });
  const prepared = prep(chain.deployment);
  const base = { db, ...inputs(chain.deployment), confirm: prepared.confirmDigest, now: () => F.NOW, env };
  // A forged preparation naming an arbitrary emulator destination, with a passing check.
  const forged = { ...prepared, ref: 'platformConfig/teacherUnitsAvailability', dependencies: [], document: { mode: 'enabled' } };
  await refused(RG.register({ db, prepared: forged, confirm: forged.confirmDigest, expected: E, env }), /does not accept prepared/);
  for (const extra of ['prepared', 'ref', 'path', 'dependencies', 'intent', 'confirmDigest', 'kind']) {
    await refused(RG.register({ ...base, [extra]: 'teacherUnitsBackendReleases/x' }), new RegExp(`does not accept ${extra}`));
  }
  assert.equal(await exists('platformConfig/teacherUnitsAvailability'), false);
  // The destination is the content address of the document actually written.
  assert.deepEqual(await RG.register(base), { status: 'created', ref: chain.deployment.ref });
  assert.equal(chain.deployment.ref, `teacherUnitsReleaseEvidence/${K.contentDigest(chain.deployment.document.payload)}`);
});

test('F2: modified bytes or document under an old confirmation, cross-project inputs and non-digest confirmations refuse', async () => {
  const chain = F.buildChain({ keys });
  const old = prep(chain.deployment).confirmDigest;
  const write = (overrides, confirm = old) => RG.register({ db, ...inputs(chain.deployment), confirm, now: () => F.NOW, env, ...overrides });
  // A different, validly signed document (and its bytes) under the old confirmation.
  const other = F.buildChain({ keys }).deployment;
  await refused(write({ document: other.document, statementBytes: other.statementBytes }), /confirmation digest does not match/);
  // The old document with bytes that are no longer its canonical statement.
  const edited = Buffer.from(chain.deployment.statementBytes); edited[edited.length - 3] ^= 1;
  await refused(write({ statementBytes: edited }), /do not match the statement object hash/);
  // The document mutated in place after the dry run (signed bytes unchanged).
  const mutated = JSON.parse(JSON.stringify(chain.deployment.document)); mutated.payload.statement.reason = 'edited';
  await refused(write({ document: mutated }), /structure invalid|confirmation digest/);
  // A complete preparation for another demo project, offered to this project's writer.
  const foreign = F.buildChain({ keys, expected: F.expectedFor('demo-other') }).deployment;
  const foreignConfirm = RG.prepareRegistration({ ...inputs(foreign, { expected: F.expectedFor('demo-other'), registry: F.registryFor('demo-other', keys),
    revocationList: F.revocationsFor('demo-other') }), now: F.NOW }).confirmDigest;
  await refused(write({ document: foreign.document, statementBytes: foreign.statementBytes }, foreignConfirm), /structure invalid/);
  await refused(write({ expected: F.expectedFor('demo-other') }, foreignConfirm), /not bound to the target emulator project/);
  for (const confirm of ['yes', 'A'.repeat(64), `${old}0`, old.slice(1), 64, null, { digest: old }]) await refused(write({}, confirm), /--confirm <digest>/);
  await refused(write({ statementBytes: chain.deployment.statementBytes.toString('utf8') }), /must be a Buffer/);
  await refused(write({ now: F.NOW }), /tooling clock function/);
  assert.equal(await count('teacherUnitsReleaseEvidence'), 0);
});

test('F2: caller mutation after the call, including during an attempt, cannot change what is written', async () => {
  const chain = F.buildChain({ keys });
  const original = K.canonicalJSON(chain.deployment.document);
  const document = JSON.parse(original), statementBytes = Buffer.from(chain.deployment.statementBytes), expected = F.expectedFor();
  const confirm = prep(chain.deployment).confirmDigest;
  const counter = { attempts: 0 };
  const clock = () => {
    // Runs inside each attempt: tamper with every caller-held object.
    document.payload.statement.issuedAt = later(-DAY); document.payload.source.signerKeyId = 'tampered';
    statementBytes.fill(0x20); expected.projectId = 'demo-other'; expected.environment = 'staging';
    return F.NOW;
  };
  const pending = RG.register({ db: retrying(1, counter), document, statementBytes, registry: deps.registry, revocationList: deps.revocationList, expected, confirm, now: clock, env });
  document.payload.kind = 'teacher-units-activation-approval';
  assert.equal((await pending).status, 'created');
  assert.equal(counter.attempts, 2);
  assert.equal(K.canonicalJSON((await db.doc(chain.deployment.ref).get()).data()), original);
});
