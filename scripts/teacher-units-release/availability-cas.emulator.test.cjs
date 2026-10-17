'use strict';
// A3-6 S6a availability-policy CAS plus history against the Firestore EMULATOR only
// (demo- project, loopback host, no credentials). Run under:
//   firebase emulators:exec --only firestore --project demo-a3-s6a "node --test ..."
// SYNTHETIC fixtures only; nothing here is provider-verified or activation.
const assert = require('node:assert/strict');
const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const RG = require('./registration.cjs');
const CAS = require('./availability-cas.cjs');
const C = require('./cli.cjs');
const F = require('./fixtures/synthetic-release.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const V = require('../../platform/functions/lib/teacherUnits/a3-validation.js');
const B = require('../../platform/functions/lib/teacherUnits/a3-bindings.js');
const { Timestamp } = RG.functionsModule('firebase-admin/firestore');

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const env = { FIRESTORE_EMULATOR_HOST: HOST };
const E = F.expectedFor();
const keys = F.testKeys();
const deps = { registry: F.registryFor(F.PROJECT, keys), revocationList: F.revocationsFor(F.PROJECT) };
const HISTORY = CAS.HISTORY_COLLECTION;
let client, db;

before(() => {
  if (!HOST) throw new Error('FIRESTORE_EMULATOR_HOST is unset: run these tests under firebase emulators:exec with a demo- project');
  client = RG.emulatorFirestore(E, env);
  db = client.db;
});
after(() => client && client.close());
beforeEach(() => F.clearEmulator());

const refused = (promise, pattern) => assert.rejects(promise, e => { assert.match(e.message, /REFUSED/); assert.match(e.message, pattern); return true; });
const later = ms => F.at(F.NOW, ms).toISOString();
const INIT = { policyInstanceId: F.POLICY_INSTANCE_ID, placementFingerprint: F.PLACEMENT };
async function dry(transition, options, { now = F.NOW, operatorSubject = 'synthetic-operator', reason = `synthetic ${transition}`, database = db } = {}) {
  return CAS.dryRunTransition({ db: database, expected: E, transition, options, operatorSubject, reason, now: () => now, env });
}
async function step(transition, options, { now = F.NOW, enableDependencies, confirm, database = db, ...rest } = {}) {
  const plan = await dry(transition, options, { now, ...rest });
  return CAS.executeTransition({ db: database, expected: E, transition, options, operatorSubject: rest.operatorSubject || 'synthetic-operator',
    reason: rest.reason || `synthetic ${transition}`, confirm: confirm || plan.confirmDigest, now: () => now, enableDependencies, env });
}
async function registerChain(chain) {
  for (const name of ['deployment', 'release', 'certification', 'activationApproval', 'activationEvidence']) {
    const item = chain[name];
    const inputs = { document: item.document, expected: E, ...deps, statementBytes: item.statementBytes };
    const prepared = RG.prepareRegistration({ ...inputs, now: F.NOW });
    await RG.register({ db, ...inputs, confirm: prepared.confirmDigest, now: () => F.NOW, env });
  }
}
const policy = async () => { const s = await db.doc(CAS.POLICY_PATH).get(); return s.exists ? s.data() : null; };
const history = async () => (await db.collection(HISTORY).get()).docs.map(d => ({ ref: `${HISTORY}/${d.id}`, document: d.data() }));
async function prepared(chain) {
  await step('initialize', INIT);
  await registerChain(chain);
  await step('prepare', { releaseId: chain.release.releaseId }, { now: later(1000) });
}
async function unchanged(expectedGeneration, expectedRecords) {
  assert.equal((await policy()).generation, expectedGeneration);
  assert.equal((await history()).length, expectedRecords);
}

test('initialize: the dry run writes nothing; execute writes the policy and its content-addressed history together', async () => {
  const plan = await dry('initialize', INIT);
  assert.equal(await policy(), null);
  assert.equal((await history()).length, 0);
  const result = await step('initialize', INIT);
  assert.equal(result.status, 'committed');
  assert.equal(result.nextGeneration, 1);
  const stored = await policy();
  assert.ok(V.validatePolicy(stored, E).ok);
  // D8 fix 2: an explicit SDK Timestamp from the tooling clock, never a server sentinel.
  assert.ok(stored.updatedAt instanceof Timestamp);
  assert.equal(stored.updatedAt.seconds, Math.floor(new Date(F.NOW).getTime() / 1000));
  const records = await history();
  assert.equal(records.length, 1);
  assert.equal(records[0].ref, result.historyRef);
  assert.equal(records[0].ref, `${HISTORY}/${K.contentDigest(records[0].document)}`);
  assert.ok(B.validateAvailabilityHistoryBinding(records[0].document, null, stored, E).ok);
  assert.equal(K.canonicalJSON(records[0].document), K.canonicalJSON({ ...plan.history, nextPolicyDigest: records[0].document.nextPolicyDigest }));
  await refused(step('initialize', INIT), /a policy already exists/);
});

test('full lifecycle: initialize, prepare, enable (pure S3 checks) and shutdown, each with exactly one history record', async () => {
  const chain = F.buildChain({ keys });
  await prepared(chain);
  const enabled = await step('enable', { activationEvidenceRef: chain.activationEvidence.ref }, { now: later(2000), enableDependencies: deps });
  assert.equal(enabled.nextGeneration, 3);
  assert.match(enabled.releaseAuthority, /not A3-2 provenance; not activation/);
  assert.equal((await policy()).mode, 'enabled');
  const shut = await step('shutdown', { clearRelease: false }, { now: later(3000) });
  assert.equal(shut.nextGeneration, 4);
  const final = await policy();
  assert.equal(final.mode, 'closed');
  assert.equal(final.activationEvidenceRef, null);
  assert.deepEqual(final.backendReleaseEligibility, { releaseId: chain.release.releaseId });
  const records = await history();
  assert.deepEqual(records.map(r => r.document.transition).sort(), ['enable', 'initialize', 'prepare', 'shutdown']);
  for (const r of records) assert.ok(B.validateAvailabilityHistoryReference(r.ref, r.document, E).ok);
  const report = await CAS.readHistory({ db, expected: E, env });
  assert.equal(report.records, 4);
  assert.deepEqual(report.repeatedGenerations, []);
});

test('enable refuses unless the registered chain passes the S3 core and D6; nothing is written on refusal', async () => {
  const chain = F.buildChain({ keys });
  await prepared(chain);
  const enable = (extra = {}, options = { activationEvidenceRef: chain.activationEvidence.ref }) => step('enable', options, { now: later(2000), enableDependencies: deps, ...extra });
  await refused(enable({ enableDependencies: undefined }), /branded authority registry and revocation list/);
  await refused(enable({ enableDependencies: { registry: { entries: [] }, revocationList: deps.revocationList } }), /branded/);
  await refused(enable({}, { activationEvidenceRef: `teacherUnitsReleaseEvidence/${'d'.repeat(64)}` }), /activation evidence not registered/);
  await refused(enable({ enableDependencies: { registry: deps.registry, revocationList: F.revocationsFor(F.PROJECT, [chain.activationApproval.ref]) } }), /unverified: revoked/);
  await refused(enable({ enableDependencies: { registry: deps.registry, revocationList: F.revocationsFor(F.PROJECT, [chain.certification.ref]) } }), /unverified: revoked/);
  await refused(enable({ enableDependencies: { registry: F.registryFor(F.PROJECT, F.testKeys()), revocationList: deps.revocationList } }), /unverified: authorityUnrecognized/);
  await refused(enable({ enableDependencies: { registry: deps.registry, revocationList: F.revocationsFor('demo-other') } }), /unverified: dispositionUnresolved/);
  await refused(enable({ now: later(25 * 3600 * 1000) }), /more than 24 hours before enable/);
  await unchanged(2, 2);
  await step('enable', { activationEvidenceRef: chain.activationEvidence.ref }, { now: later(2000), enableDependencies: deps });
  await unchanged(3, 3);
});

test('F3: a registered supersede disposition alone is not a revocation (D5 R2, S3 O4); only pinning refuses enable', async () => {
  const chain = F.buildChain({ keys });
  await prepared(chain);
  const replacementChain = F.buildChain({ keys, edit: { certify: { hostingCandidateFingerprint: 'e'.repeat(64) }, activate: { hostingCandidateFingerprint: 'e'.repeat(64) } } });
  await registerChain(replacementChain);
  const supersede = F.signedDocument('approval-disposition', { action: 'supersede', targetApprovalRef: chain.activationApproval.ref,
    replacementApprovalRef: replacementChain.activationApproval.ref }, keys.dispose);
  const inputs = { document: supersede.document, expected: E, ...deps, statementBytes: supersede.statementBytes };
  const dispositionPlan = RG.prepareRegistration({ ...inputs, now: F.NOW });
  // The disposition registers as an audit record and says it is not a revocation.
  assert.deepEqual(await RG.register({ db, ...inputs, confirm: dispositionPlan.confirmDigest, now: () => F.NOW, env }),
    { status: 'created', ref: supersede.ref, effect: RG.DISPOSITION_EFFECT });
  assert.match(RG.DISPOSITION_EFFECT, /not a revocation/);
  // Pinned: enable refuses, and dependents of the superseded approval refuse registration.
  const pinned = { registry: deps.registry, revocationList: F.revocationsFor(F.PROJECT, [chain.activationApproval.ref]) };
  await refused(step('enable', { activationEvidenceRef: chain.activationEvidence.ref }, { now: later(2000), enableDependencies: pinned }), /unverified: revoked/);
  assert.throws(() => RG.prepareRegistration({ document: chain.activationEvidence.document, expected: E, ...pinned, now: F.NOW }), /on the pinned revocation list/);
  await unchanged(2, 2);
  // Documented limitation, not a satisfied refusal: with the disposition registered but
  // nothing pinned, the superseded approval still enables. The required future gate is
  // the separately authorized R2 revocation procedure (S6d: pin and redeploy).
  const result = await step('enable', { activationEvidenceRef: chain.activationEvidence.ref }, { now: later(2000), enableDependencies: deps });
  assert.equal(result.status, 'committed');
  assert.match(result.dispositions, /not consulted/);
  assert.equal((await policy()).activationEvidenceRef, chain.activationEvidence.ref);
  await unchanged(3, 3);
});

test('synthetic chains never enable: zero signatures, wrong generation, wrong release', async () => {
  const zero = F.buildChain({ keys: null });
  await step('initialize', INIT);
  // Zero-signed documents cannot even be registered, so enable finds nothing to verify.
  assert.throws(() => RG.prepareRegistration({ document: zero.deployment.document, expected: E, ...deps, statementBytes: zero.deployment.statementBytes, now: F.NOW }), /signature unverified/);
  const wrongGeneration = F.buildChain({ keys, enabledGeneration: 4 });
  await registerChain(wrongGeneration);
  await step('prepare', { releaseId: wrongGeneration.release.releaseId }, { now: later(1000) });
  await refused(step('enable', { activationEvidenceRef: wrongGeneration.activationEvidence.ref }, { now: later(2000), enableDependencies: deps }), /unverified: inputMismatch/);
  await unchanged(2, 2);
});

test('invalid transitions refuse with nothing written', async () => {
  await refused(step('prepare', { releaseId: null }), /requires an existing policy/);
  await refused(step('shutdown', { clearRelease: true }), /requires an existing policy/);
  await step('initialize', INIT);
  await refused(step('enable', { activationEvidenceRef: `teacherUnitsReleaseEvidence/${'d'.repeat(64)}` }, { enableDependencies: deps }), /closed policy with a prepared release/);
  await refused(step('shutdown', { clearRelease: false }), /shutdown requires an enabled policy/);
  await refused(step('prepare', { releaseId: 'nope' }), /--release-id/);
  await refused(step('rename', {}), /unknown transition/);
  const chain = F.buildChain({ keys });
  await registerChain(chain);
  await step('prepare', { releaseId: chain.release.releaseId }, { now: later(1000) });
  await step('enable', { activationEvidenceRef: chain.activationEvidence.ref }, { now: later(2000), enableDependencies: deps });
  await refused(step('enable', { activationEvidenceRef: chain.activationEvidence.ref }, { now: later(3000), enableDependencies: deps }), /enable requires a closed policy/);
  await refused(step('prepare', { releaseId: null }, { now: later(3000) }), /prepare requires a closed policy/);
  await refused(step('initialize', INIT), /a policy already exists/);
  await unchanged(3, 3);
});

test('tampered history (previous digest, transition, generation, evidence) refuses through the S2 binding', async () => {
  await step('initialize', INIT);
  const plan = await dry('prepare', { releaseId: null }, { now: later(1000) });
  const before = await policy();
  const tamper = edit => () => CAS.checkPlan({ next: plan.next, history: { ...plan.history, ...edit }, before, expected: E, transition: 'prepare' });
  assert.ok(tamper({})());
  assert.throws(tamper({ previousPolicyDigest: 'a'.repeat(64) }), /previous policy digest mismatch/);
  assert.throws(tamper({ nextPolicyDigest: 'a'.repeat(64) }), /next policy digest mismatch/);
  assert.throws(tamper({ transition: 'shutdown' }), /history transition mismatch/);
  assert.throws(tamper({ nextGeneration: 3 }), /history generation mismatch/);
  assert.throws(tamper({ previousPolicyDigest: null }), /structure invalid/);
});

test('stale or mismatched confirmation refuses: the CAS binds the previous policy digest', async () => {
  await step('initialize', INIT);
  const stale = await dry('prepare', { releaseId: null }, { now: later(1000) });
  await refused(CAS.executeTransition({ db, expected: E, transition: 'prepare', options: { releaseId: null }, operatorSubject: 'synthetic-operator',
    reason: 'synthetic prepare', confirm: 'a'.repeat(64), now: () => later(1000), env }), /confirmation digest does not match/);
  await refused(CAS.executeTransition({ db, expected: E, transition: 'prepare', options: { releaseId: 'f'.repeat(64) }, operatorSubject: 'synthetic-operator',
    reason: 'synthetic prepare', confirm: stale.confirmDigest, now: () => later(1000), env }), /confirmation digest does not match/);
  await refused(CAS.executeTransition({ db, expected: E, transition: 'prepare', options: { releaseId: null }, operatorSubject: 'synthetic-operator',
    reason: 'synthetic prepare', confirm: undefined, now: () => later(1000), env }), /--confirm <digest>/);
  await step('prepare', { releaseId: null }, { now: later(2000), reason: 'another operator' });
  await refused(CAS.executeTransition({ db, expected: E, transition: 'prepare', options: { releaseId: null }, operatorSubject: 'synthetic-operator',
    reason: 'synthetic prepare', confirm: stale.confirmDigest, now: () => later(3000), env }), /confirmation digest does not match/);
  await unchanged(2, 2);
});

test('concurrent CAS: exactly one of several identical transitions commits; refusals are not retried', async () => {
  await step('initialize', INIT);
  const plan = await dry('prepare', { releaseId: null }, { now: later(1000) });
  let attempts = 0;
  const counting = new Proxy(db, { get(target, key) {
    if (key === 'runTransaction') return (fn, options) => target.runTransaction(tx => { attempts++; return fn(tx); }, options);
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const run = () => CAS.executeTransition({ db: counting, expected: E, transition: 'prepare', options: { releaseId: null }, operatorSubject: 'synthetic-operator',
    reason: 'synthetic prepare', confirm: plan.confirmDigest, now: () => later(1000), env });
  const outcomes = await Promise.allSettled(Array.from({ length: 5 }, run));
  const committed = outcomes.filter(o => o.status === 'fulfilled');
  assert.equal(committed.length, 1);
  // A loser's rerun re-plans from the winner's policy: with the same tooling clock the
  // re-plan is a no-op the S2 binding refuses; with a later clock the digest differs.
  for (const o of outcomes.filter(x => x.status === 'rejected')) assert.match(o.reason.message, /REFUSED: (confirmation digest does not match|availability history structure invalid at \$: no-op generation changed)/);
  await unchanged(2, 2);
  // Losers were rerun by the SDK after contention, then refused on fresh reads.
  assert.ok(attempts > 5, `expected SDK reruns under contention, saw ${attempts} attempts`);
  attempts = 0;
  await refused(run(), /no-op generation changed/);
  assert.equal(attempts, 1, 'a refusal is never retried');
  // Distinct clocks: every loser refuses on the confirmation digest.
  const plan2 = await dry('prepare', { releaseId: null }, { now: later(5000) });
  let tick = 6000;
  const timed = await Promise.allSettled(Array.from({ length: 4 }, () => CAS.executeTransition({ db, expected: E, transition: 'prepare', options: { releaseId: null },
    operatorSubject: 'synthetic-operator', reason: 'synthetic prepare', confirm: plan2.confirmDigest, now: () => later(tick++), env })));
  assert.equal(timed.filter(o => o.status === 'fulfilled').length, 1);
  for (const o of timed.filter(x => x.status === 'rejected')) assert.match(o.reason.message, /confirmation digest does not match/);
  await unchanged(3, 3);
});

test('existing history at the computed address refuses: conflicting or identical, nothing is overwritten', async () => {
  await step('initialize', INIT);
  const plan = await dry('prepare', { releaseId: null }, { now: later(1000) });
  await db.doc(plan.historyRef).set({ forged: true }); // test acting as a Firestore-write principal
  await refused(step('prepare', { releaseId: null }, { now: later(1000) }), /a different document already exists/);
  assert.deepEqual((await db.doc(plan.historyRef).get()).data(), { forged: true });
  await db.doc(plan.historyRef).set(plan.history);
  await refused(step('prepare', { releaseId: null }, { now: later(1000) }), /already records this exact transition; nothing written/);
  assert.equal((await policy()).generation, 1);
});

test('an invalid stored policy refuses every ordinary transition (repair is separate)', async () => {
  await db.doc(CAS.POLICY_PATH).set({ mode: 'enabled', generation: 7 });
  await refused(dry('shutdown', { clearRelease: true }), /invalid-policy repair is a separate/);
  await refused(CAS.executeTransition({ db, expected: E, transition: 'shutdown', options: { clearRelease: true }, operatorSubject: 'op', reason: 'r',
    confirm: 'a'.repeat(64), now: () => F.NOW, env }), /invalid-policy repair is a separate/);
  assert.equal((await history()).length, 0);
});

test('D1-B rollback: a restored older generation is shut down again and reported as a repeated generation, never authority', async () => {
  const chain = F.buildChain({ keys });
  await prepared(chain);
  await step('enable', { activationEvidenceRef: chain.activationEvidence.ref }, { now: later(2000), enableDependencies: deps });
  const enabledGeneration3 = await policy();
  await step('shutdown', { clearRelease: false }, { now: later(3000) });
  await db.doc(CAS.POLICY_PATH).set(enabledGeneration3); // test acting as P1: generation rollback
  const second = await step('shutdown', { clearRelease: false }, { now: later(4000), reason: 'shutdown after rollback' });
  assert.equal(second.status, 'committed');
  const report = await CAS.readHistory({ db, expected: E, env });
  assert.equal(report.records, 5);
  assert.equal(report.repeatedGenerations.length, 1);
  assert.equal(report.repeatedGenerations[0].nextGeneration, 4);
  assert.equal(report.repeatedGenerations[0].refs.length, 2);
  assert.match(report.authorization, /^none: rollback evidence only/);
  // A forged record makes the whole report refuse rather than silently omit it.
  await db.doc(`${HISTORY}/${'0'.repeat(64)}`).set((await history())[0].document);
  await refused(CAS.readHistory({ db, expected: E, env }), /history records structure invalid/);
});

test('the writer itself refuses cloud targets and a missing emulator', async () => {
  const args = expected => ({ db, expected, transition: 'initialize', options: INIT, operatorSubject: 'op', reason: 'r', confirm: 'a'.repeat(64), now: () => F.NOW, env });
  for (const cloud of [{ environment: 'staging', projectId: 'lyfelabz-staging', projectNumber: '293337283840' },
    { environment: 'production', projectId: 'lyfelabz-prod', projectNumber: '182791689935' }]) {
    await refused(CAS.executeTransition(args(cloud)), /emulator-only/);
    await refused(CAS.dryRunTransition(args(cloud)), /emulator-only/);
    await refused(CAS.readHistory({ db, expected: cloud, env }), /emulator-only/);
  }
  await refused(CAS.executeTransition({ ...args(E), env: {} }), /loopback/);
  assert.equal(await policy(), null);
});

test('CLI policy commands: dry run by default, --execute with the printed --confirm, emulator history report', async () => {
  const chain = F.buildChain({ keys });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6a-cas-'));
  for (const [name, v] of Object.entries({ 'registry.json': F.registryEntries(F.PROJECT, keys), 'revocations.json': [], 'profile.json': F.LOCAL_PROFILE })) {
    fs.writeFileSync(path.join(cwd, name), JSON.stringify(v));
  }
  const run = async (argv, now = F.NOW) => {
    const out = [], err = [];
    const code = await C.main(argv, { env, cwd, now: () => now, stdout: { write: s => out.push(s) }, stderr: { write: s => err.push(s) } });
    return { code, stderr: err.join(''), json: code === 0 ? JSON.parse(out.join('')) : null };
  };
  const both = async (argv, now) => {
    const d = await run(argv, now);
    assert.equal(d.code, 0, d.stderr);
    assert.equal(d.json.result.dryRun, true);
    const x = await run([...argv, '--execute', '--confirm', d.json.result.confirm], now);
    assert.equal(x.code, 0, x.stderr);
    return x.json.result;
  };
  const who = ['--project', F.PROJECT, '--operator-subject', 'synthetic-operator', '--reason', 'cli test'];
  await run(['policy', 'initialize', ...who, '--policy-instance-id', F.POLICY_INSTANCE_ID, '--placement-fingerprint', F.PLACEMENT]);
  assert.equal(await policy(), null, 'dry run wrote nothing');
  assert.equal((await both(['policy', 'initialize', ...who, '--policy-instance-id', F.POLICY_INSTANCE_ID, '--placement-fingerprint', F.PLACEMENT])).nextGeneration, 1);
  await registerChain(chain);
  await both(['policy', 'prepare', ...who, '--release-id', chain.release.releaseId], later(1000));
  const enableArgs = ['policy', 'enable', ...who, '--activation-evidence', chain.activationEvidence.ref, '--registry', 'registry.json', '--revocations', 'revocations.json', '--local-profile', 'profile.json'];
  assert.equal((await both(enableArgs, later(2000))).nextGeneration, 3);
  assert.equal((await both(['policy', 'shutdown', ...who, '--clear-release'], later(3000))).nextGeneration, 4);
  assert.equal((await policy()).backendReleaseEligibility, null);
  const report = await run(['history', 'report', '--project', F.PROJECT]);
  assert.equal(report.json.result.records, 4);
  assert.deepEqual(report.json.result.repeatedGenerations, []);
});
