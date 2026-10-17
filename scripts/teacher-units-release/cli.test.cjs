'use strict';
// A3-6 S6a operator CLI tests. Offline: no emulator, no provider, no credentials.
// SYNTHETIC fixtures only; nothing here is provider-verified.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('./cli.cjs');
const CAS = require('./availability-cas.cjs');
const O = require('./provider-observation.cjs');
const F = require('./fixtures/synthetic-release.cjs');
const { buildProvider, planFor } = require('./fixtures/synthetic-provider.cjs');
const { buildAccess, expectedFor: expectedAccessFor } = require('./fixtures/synthetic-access.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const { getApps } = require(require.resolve('firebase-admin/app', { paths: [path.resolve(__dirname, '../../platform/functions')] }));

const MODULES = ['cli.cjs', 'freshness.cjs', 'statements.cjs', 'registration.cjs', 'availability-cas.cjs'];
const CLOUD = ['lyfelabz-prod', 'lyfelabz-staging'];
const MUTATIONS = [['register', '--document', 'd.json'], ['policy', 'initialize'], ['policy', 'prepare', '--release-id', 'none'],
  ['policy', 'enable', '--activation-evidence', 'x'], ['policy', 'shutdown', '--keep-release']];

function scratch(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6a-cli-'));
  // A Firebase alias file pointing at production: the CLI must never read it.
  fs.writeFileSync(path.join(dir, '.firebaserc'), JSON.stringify({ projects: { default: 'lyfelabz-prod' } }));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  }
  return dir;
}
async function cli(argv, { env = {}, cwd = scratch(), now = F.NOW } = {}) {
  const out = [], err = [];
  const code = await C.main(argv, { env, cwd, now: () => now, stdout: { write: s => out.push(s) }, stderr: { write: s => err.push(s) } });
  return { code, cwd, stderr: err.join(''), json: code === 0 ? JSON.parse(out.join('')) : null };
}
async function refused(argv, pattern, options) {
  const r = await cli(argv, options);
  assert.equal(r.code, 1, `expected refusal for ${argv.join(' ')}`);
  assert.match(r.stderr, /REFUSED/);
  assert.match(r.stderr, pattern);
  return r;
}
// Firestore write methods other than create; Map.set and the like are not Firestore writes.
const FIRESTORE_WRITES = /\b(?:tx|db|transaction|batch)\.(?:set|update|delete)\(|\.doc\([^)]*\)\.(?:set|update|delete|create)\(|\.add\(|\.batch\(|bulkWriter|recursiveDelete/;
const codeOnly = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('fixtures are labelled synthetic, never provider-verified', () => {
  assert.equal(F.SYNTHETIC, 'synthetic, not provider-verified');
  assert.match(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-release.cjs'), 'utf8'), /SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED/);
});

test('static: S6a modules never read the Firebase alias file, hold keys, sign, call KMS, make requests or load fixtures', () => {
  for (const file of MODULES) {
    const code = codeOnly(file);
    for (const pattern of [/firebaserc/i, /generateKeyPair|createPrivateKey|\bsign\(|privateKey/, /kms|KeyManagement|cloudkms/i,
      /\bfetch\(|https?:\/\/|readApi|tokenFromGcloud|gcloud/, /fixtures\//, FIRESTORE_WRITES]) {
      const allowed = file === 'availability-cas.cjs' && pattern === FIRESTORE_WRITES ? code.replace('tx.set(db.doc(POLICY_PATH), plan.next)', '') : code;
      assert.equal(pattern.test(allowed), false, `${file} matches ${pattern}`);
    }
  }
  // The only writes: one create in registration, one policy set plus one create in the CAS.
  assert.equal((codeOnly('registration.cjs').match(/\.create\(/g) || []).length, 1);
  assert.equal((codeOnly('availability-cas.cjs').match(/\.create\(/g) || []).length, 1);
  assert.equal((codeOnly('availability-cas.cjs').match(/\btx\.set\(/g) || []).length, 1);
});

test('the CAS writes the same policy path A3-3 enforcement reads', () => {
  const E = require('../../platform/functions/lib/teacherUnits/a3-enforcement.js');
  assert.equal(CAS.POLICY_PATH, E.TEACHER_UNITS_POLICY_PATH);
});

test('an explicit --project is required, exactly once, from the supported set', async () => {
  await refused(['validate', 'chain', '--chain', 'c.json'], /explicit --project is required/);
  await refused(['policy', 'initialize', '--execute', '--confirm', 'a'.repeat(64)], /explicit --project is required/);
  await refused(['validate', 'chain', '--project', 'lyfelabz-prod', '--project', 'lyfelabz-prod'], /more than once/);
  await refused(['validate', 'chain', '--project=lyfelabz-prod'], /unexpected argument/);
  await refused(['validate', 'chain', '--project'], /requires a value/);
  for (const project of ['lyfelabz-dev', 'default', 'demo_x', 'Demo-x', 'lyfelabz-prod-2', '182791689935']) {
    await refused(['validate', 'chain', '--project', project, '--chain', 'c.json'], /unsupported --project/);
  }
  await refused(['nope', 'thing', '--project', 'lyfelabz-prod'], /unknown command/);
  await refused(['validate', 'chain', '--project', 'lyfelabz-prod', '--approval-system-id', 'x'], /not accepted/);
});

test('ambiguous ambient identity refuses', async () => {
  const argv = project => ['history', 'report', '--project', project, '--records', 'r.json'];
  for (const name of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']) {
    await refused(argv('lyfelabz-staging'), new RegExp(`${name} disagrees`), { env: { [name]: 'lyfelabz-prod' } });
    await refused(argv('demo-a3-s6a'), new RegExp(`${name} disagrees`), { env: { [name]: 'demo-other' } });
  }
  await refused(argv('lyfelabz-prod'), /FIREBASE_CONFIG disagrees/, { env: { FIREBASE_CONFIG: JSON.stringify({ projectId: 'lyfelabz-staging' }) } });
  await refused(argv('lyfelabz-prod'), /FIREBASE_CONFIG is not strict JSON/, { env: { FIREBASE_CONFIG: '{bad' } });
  for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FUNCTIONS_EMULATOR']) {
    await refused(argv('lyfelabz-prod'), new RegExp(`${name} set for cloud project`), { env: { [name]: '127.0.0.1:8080' } });
  }
  await refused(argv('demo-a3-s6a'), /not a loopback address/, { env: { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' } });
});

test('every mutating command refuses every cloud project before any I/O, dry run or not', async () => {
  for (const project of CLOUD) {
    for (const command of MUTATIONS) {
      await refused([...command, '--project', project], /emulator-only in S6a/);
      await refused([...command, '--project', project, '--execute', '--confirm', 'a'.repeat(64)], /emulator-only in S6a/);
    }
  }
  assert.equal(getApps().length, 0, 'no Firebase app was ever initialized');
});

test('emulator mutations need a loopback emulator, and --execute needs --confirm', async () => {
  await refused(['policy', 'initialize', '--project', 'demo-a3-s6a', '--policy-instance-id', F.POLICY_INSTANCE_ID, '--placement-fingerprint', F.PLACEMENT,
    '--operator-subject', 'op', '--reason', 'r'], /FIRESTORE_EMULATOR_HOST on a loopback address/);
  await refused(['policy', 'initialize', '--project', 'demo-a3-s6a', '--execute'], /must be given together/);
  await refused(['policy', 'initialize', '--project', 'demo-a3-s6a', '--confirm', 'a'.repeat(64)], /must be given together/);
  await refused(['policy', 'shutdown', '--project', 'demo-a3-s6a'], /exactly one of --clear-release or --keep-release/);
  await refused(['policy', 'shutdown', '--project', 'demo-a3-s6a', '--clear-release', '--keep-release'], /exactly one of/);
  await refused(['validate', 'chain', '--project', 'lyfelabz-prod', '--execute'], /--execute is not accepted by validate chain/);
  await refused(['statement', 'prepare', '--project', 'lyfelabz-prod', '--confirm', 'a'.repeat(64)], /--confirm is not accepted by statement prepare/);
  assert.equal(getApps().length, 0);
});

test('the Firebase alias file is never read, whatever the command', async () => {
  const reads = [];
  const original = { readFileSync: fs.readFileSync, openSync: fs.openSync, existsSync: fs.existsSync, statSync: fs.statSync };
  for (const name of Object.keys(original)) fs[name] = function spy(file, ...rest) { reads.push(String(file)); return original[name].call(fs, file, ...rest); };
  try {
    await cli(['validate', 'chain', '--chain', 'c.json']);
    await cli(['policy', 'initialize']);
    await cli(['register', '--document', 'd.json', '--project', 'lyfelabz-prod']);
    await cli(['history', 'report', '--project', 'demo-a3-s6a', '--records', 'missing.json']);
  } finally { Object.assign(fs, original); }
  assert.ok(reads.length > 0, 'spy observed file reads');
  assert.deepEqual(reads.filter(f => /firebaserc/.test(f)), []);
});

test('the real process entry point refuses without --project and with a cloud write', () => {
  const cwd = scratch();
  const node = (args, env = {}) => {
    try { execFileSync(process.execPath, [path.join(__dirname, 'cli.cjs'), ...args], { cwd, env: { PATH: process.env.PATH, ...env }, stdio: 'pipe' }); return { code: 0 }; }
    catch (error) { return { code: error.status, stderr: String(error.stderr) }; }
  };
  for (const r of [node(['policy', 'initialize']), node(['register', '--project', 'lyfelabz-prod', '--document', 'd.json']),
    node(['policy', 'enable', '--project', 'lyfelabz-staging', '--activation-evidence', 'x', '--execute', '--confirm', 'a'.repeat(64)])]) {
    assert.equal(r.code, 1);
    assert.match(r.stderr, /REFUSED/);
  }
});

test('statement prepare: fixed approval system, fresh run ID per invocation, no overwrite, no signing', async () => {
  const cwd = scratch({ 'fields.json': { candidate: F.candidate() } });
  const argv = dir => ['statement', 'prepare', '--project', 'lyfelabz-prod', '--kind', 'deployment-approval', '--fields', 'fields.json',
    '--authority-id', 'owner-authority', '--approver-subject', 'owner', '--decision-id', 'D-1', '--out-dir', dir];
  fs.mkdirSync(path.join(cwd, 'a')); fs.mkdirSync(path.join(cwd, 'b'));
  const a = await cli(argv('a'), { cwd }), b = await cli(argv('b'), { cwd });
  assert.equal(a.code, 0); assert.equal(b.code, 0);
  assert.equal(a.json.approvalSystemId, 'lyfelabz-operator-cli');
  assert.notEqual(a.json.workflowRunId, b.json.workflowRunId);
  const statement = JSON.parse(fs.readFileSync(path.join(cwd, 'a/statement.json'), 'utf8'));
  assert.equal(statement.authority.workflowRunId, a.json.workflowRunId);
  assert.equal(statement.authority.approvalSystemId, 'lyfelabz-operator-cli');
  assert.equal(statement.environment, 'production');
  assert.equal(K.sha256Bytes(fs.readFileSync(path.join(cwd, 'a/signing-bytes.bin'))), a.json.result.signingBytesSha256);
  assert.match(a.json.result.signing, /not performed/);
  await refused(argv('a'), /never overwritten/, { cwd });
});

test('statement assemble and activation-evidence prepare write new files only', async () => {
  const chain = F.buildChain({ keys: F.testKeys() });
  const cwd = scratch({ 'statement.json': chain.activationApproval.statementBytes, 'approval.json': chain.activationApproval.document });
  const sig = chain.activationApproval.document.payload.source;
  const assembled = await cli(['statement', 'assemble', '--project', 'demo-a3-s6a', '--statement', 'statement.json', '--bucket', 'lyfelabz-evidence-synthetic',
    '--object', 'statements/activation-approval.json', '--generation', '1', '--signer-key-id', sig.signerKeyId, '--signature', sig.signatureBase64, '--out', 'doc.json'], { cwd });
  assert.equal(assembled.code, 0);
  assert.equal(assembled.json.result.ref, chain.activationApproval.ref);
  const evidence = await cli(['activation-evidence', 'prepare', '--project', 'demo-a3-s6a', '--approval', 'approval.json', '--out', 'evidence.json'], { cwd });
  assert.equal(evidence.json.result.ref, chain.activationEvidence.ref);
  await refused(['activation-evidence', 'prepare', '--project', 'demo-a3-s6a', '--approval', 'approval.json', '--out', 'evidence.json'], /never overwritten/, { cwd });
  // Cross-environment: an emulator statement assembled for production refuses.
  await refused(['statement', 'assemble', '--project', 'lyfelabz-prod', '--statement', 'statement.json', '--bucket', 'b1', '--object', 'o', '--generation', '1',
    '--signer-key-id', 'k', '--signature', F.ZERO_SIGNATURE, '--out', 'x.json'], /structure invalid/, { cwd });
});

function chainFiles(chain, keys, revoked = []) {
  return {
    'chain.json': { policy: chain.policy, releaseRef: chain.release.ref, release: chain.release.document, deploymentApprovalRef: chain.deployment.ref,
      deploymentApproval: chain.deployment.document, activationEvidenceRef: chain.activationEvidence.ref, activationEvidence: chain.activationEvidence.document,
      activationApprovalRef: chain.activationApproval.ref, activationApproval: chain.activationApproval.document, endpointName: 'teacherUnitsGet',
      certification: chain.certification.document },
    'registry.json': F.registryEntries(F.PROJECT, keys), 'revocations.json': F.revocationEntries(F.PROJECT, revoked), 'profile.json': F.LOCAL_PROFILE,
  };
}
function enabledChain(keys, options) {
  const chain = F.buildChain({ keys, ...options });
  const expected = F.expectedFor();
  const plan = steps => steps.reduce((previous, [transition, opts]) => CAS.planTransition({ transition, previous, expected, options: opts,
    operatorSubject: 'op', reason: 'r', now: F.NOW }).next, null);
  const next = plan([['initialize', { policyInstanceId: F.POLICY_INSTANCE_ID, placementFingerprint: F.PLACEMENT }], ['prepare', { releaseId: chain.release.releaseId }],
    ['enable', { activationEvidenceRef: chain.activationEvidence.ref }]]);
  chain.policy = { ...next, updatedAt: { seconds: next.updatedAt.seconds, nanoseconds: next.updatedAt.nanoseconds } };
  return chain;
}
const chainArgs = project => ['validate', 'chain', '--project', project, '--chain', 'chain.json'];
const emulatorChainArgs = ['--registry', 'registry.json', '--revocations', 'revocations.json', '--local-profile', 'profile.json'];

test('validate chain: a signed emulator chain passes only the pure S3 checks', async () => {
  const keys = F.testKeys(), chain = enabledChain(keys);
  const ok = await cli([...chainArgs(F.PROJECT), ...emulatorChainArgs], { cwd: scratch(chainFiles(chain, keys)) });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.json.result.verdict.verdict, 'verified');
  assert.match(ok.json.result.scope, /not A3-2 provenance, not provider eligibility, not authorization/);
  // Revoked evidence (pinned) and an unrecognized signer refuse.
  await refused([...chainArgs(F.PROJECT), ...emulatorChainArgs], /unverified: revoked/, { cwd: scratch(chainFiles(chain, keys, [chain.activationApproval.ref])) });
  await refused([...chainArgs(F.PROJECT), ...emulatorChainArgs], /unverified: authorityUnrecognized/, { cwd: scratch(chainFiles(chain, F.testKeys())) });
  await refused([...chainArgs(F.PROJECT), '--registry', 'registry.json', '--revocations', 'revocations.json'], /unverified: inputMismatch/, { cwd: scratch(chainFiles(chain, keys)) });
});

test('synthetic evidence never authorizes a release: zero signatures, cross-environment, production and staging', async () => {
  const keys = F.testKeys();
  const zero = enabledChain(null);
  await refused([...chainArgs(F.PROJECT), ...emulatorChainArgs], /unverified: (authorityUnrecognized|signatureUnverified)/, { cwd: scratch(chainFiles(zero, keys)) });
  const signed = enabledChain(keys);
  // Production: only the artifact-pinned (empty) registry; caller registries refuse; cross-environment input refuses.
  await refused(chainArgs('lyfelabz-prod'), /unverified: inputMismatch/, { cwd: scratch(chainFiles(signed, keys)) });
  await refused([...chainArgs('lyfelabz-prod'), '--registry', 'registry.json'], /only the artifact-pinned registry/, { cwd: scratch(chainFiles(signed, keys)) });
  await refused([...chainArgs('lyfelabz-prod'), '--local-profile', 'profile.json'], /only to emulator projects/, { cwd: scratch(chainFiles(signed, keys)) });
  await refused(chainArgs('lyfelabz-staging'), /no artifact-pinned staging authority registry/, { cwd: scratch(chainFiles(signed, keys)) });
  // An emulator registry naming another demo project does not verify this chain.
  const other = chainFiles(signed, keys);
  other['registry.json'] = F.registryEntries('demo-other', keys);
  await refused([...chainArgs(F.PROJECT), ...emulatorChainArgs], /unverified: authorityUnrecognized/, { cwd: scratch(other) });
  // A registry claiming a cloud identity cannot be supplied for an emulator project.
  const cloudy = chainFiles(signed, keys);
  cloudy['registry.json'] = F.registryEntries(F.PROJECT, keys).map(e => ({ ...e, environment: 'staging', projectId: 'lyfelabz-staging', projectNumber: '293337283840' }));
  await refused([...chainArgs(F.PROJECT), ...emulatorChainArgs], /unverified: authorityUnrecognized/, { cwd: scratch(cloudy) });
});

test('validate plan and expected-access: S4 and S5 contracts, cloud projects only', async () => {
  const f = buildProvider();
  let observation;
  try { observation = await O.observeA3Backend({ project: f.state.project, get: f.get, now: f.now }); } finally { f.cleanup(); }
  const plan = planFor(observation);
  const cwd = scratch({ 'plan.json': plan.bytes, 'plan-object.json': plan.object, 'bad-plan.json': Buffer.from(`${plan.bytes.toString()} `) });
  const project = observation.projectId;
  assert.equal((await cli(['validate', 'plan', '--project', project, '--plan', 'plan.json', '--plan-object', 'plan-object.json'], { cwd })).code, 0);
  await refused(['validate', 'plan', '--project', project, '--plan', 'bad-plan.json', '--plan-object', 'plan-object.json'], /do not match/, { cwd });
  const otherProject = project === 'lyfelabz-prod' ? 'lyfelabz-staging' : 'lyfelabz-prod';
  await refused(['validate', 'plan', '--project', otherProject, '--plan', 'plan.json', '--plan-object', 'plan-object.json'], /environment identity mismatch/, { cwd });
  await refused(['validate', 'plan', '--project', F.PROJECT, '--plan', 'plan.json', '--plan-object', 'plan-object.json'], /applies only to lyfelabz-staging or lyfelabz-prod/, { cwd });

  const access = await buildAccess();
  const expected = expectedAccessFor(access.observation);
  const accessCwd = scratch({ 'expected.json': expected.bytes, 'expected-object.json': expected.object });
  assert.equal((await cli(['validate', 'expected-access', '--project', access.observation.projectId, '--expected', 'expected.json', '--expected-object', 'expected-object.json'], { cwd: accessCwd })).code, 0);
  await refused(['validate', 'expected-access', '--project', access.observation.projectId === 'lyfelabz-prod' ? 'lyfelabz-staging' : 'lyfelabz-prod',
    '--expected', 'expected.json', '--expected-object', 'expected-object.json'], /REFUSED/, { cwd: accessCwd });
});

test('history report over an export: repeated generations are reported, never authority', async () => {
  const expected = F.expectedFor();
  const step = (transition, previous, options, now) => CAS.planTransition({ transition, previous, expected, options, operatorSubject: 'op', reason: transition, now });
  const keys = F.testKeys(), chain = F.buildChain({ keys });
  const g1 = step('initialize', null, { policyInstanceId: F.POLICY_INSTANCE_ID, placementFingerprint: F.PLACEMENT }, F.NOW);
  const g2 = step('prepare', g1.next, { releaseId: chain.release.releaseId }, F.NOW);
  const g3 = step('enable', g2.next, { activationEvidenceRef: chain.activationEvidence.ref }, F.NOW);
  const g4 = step('shutdown', g3.next, { clearRelease: false }, '2026-10-17T12:01:00.000000000Z');
  const again = step('shutdown', g3.next, { clearRelease: false }, '2026-10-17T12:02:00.000000000Z');
  const records = [g1, g2, g3, g4, again].map(p => ({ ref: p.historyRef, document: p.history }));
  const r = await cli(['history', 'report', '--project', F.PROJECT, '--records', 'records.json'], { cwd: scratch({ 'records.json': records }) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.result.records, 5);
  assert.deepEqual(r.json.result.repeatedGenerations, [{ policyInstanceId: F.POLICY_INSTANCE_ID, nextGeneration: 4, refs: [g4.historyRef, again.historyRef].sort() }]);
  assert.match(r.json.result.authorization, /^none/);
  const forged = records.map((x, i) => (i === 4 ? { ...x, document: { ...x.document, reason: 'edited' } } : x));
  await refused(['history', 'report', '--project', F.PROJECT, '--records', 'records.json'], /history records structure invalid/, { cwd: scratch({ 'records.json': forged }) });
  await refused(['history', 'report', '--project', 'lyfelabz-prod'], /reads only an emulator/);
});

// --- A3-6 S6b: offline, non-authorizing evidence assembly ----------------------
const EP = require('./evidence-package.cjs');
const P6 = require('./fixtures/synthetic-package.cjs');
const S6B_NOW = '2026-10-16T12:30:00.000Z';
// The CLI checks the repository's own Hosting config, so the synthetic receipt is built against it.
async function s6bFiles({ project = P6.STAGING, provenance } = {}) {
  const keys = P6.testKeys();
  const ev = await P6.buildEvidence({ project, keys, provenance, root: path.resolve(__dirname, '../..') });
  const release = EP.assembleRelease(ev.base);
  const chain = P6.chainFor(ev, release.releaseId).inputs;
  const b = ev.base, canon = v => K.canonicalJSON(v);
  const files = { 'plan.json': b.plan.bytes, 'plan-object.json': canon(b.plan.object), 'expected.json': b.expected.bytes,
    'expected-object.json': canon(b.expected.object), 'approval.json': canon(b.deploymentApproval.document), 'approval-statement.json': b.deploymentApproval.statementBytes,
    'observation.json': canon(b.observation), 'receipt.json': b.receipt.bytes, 'receipt-object.json': canon(b.receipt.object),
    'cert.json': canon(chain.certification.document), 'cert-statement.json': chain.certification.statementBytes, 'report.json': chain.certification.reportBytes,
    'act.json': canon(chain.activationApproval.document), 'act-statement.json': chain.activationApproval.statementBytes, 'evidence.json': canon(chain.activationEvidence),
    'registry.json': canon(P6.registryEntries(project, keys)), 'revocations.json': '[]' };
  return { ev, release, chain, keys, cwd: scratch(files) };
}
const s6bReleaseArgs = project => ['--project', project, '--plan', 'plan.json', '--plan-object', 'plan-object.json', '--expected', 'expected.json',
  '--expected-object', 'expected-object.json', '--approval', 'approval.json', '--approval-statement', 'approval-statement.json',
  '--observation', 'observation.json', '--receipt', 'receipt.json', '--receipt-object', 'receipt-object.json'];
const s6bChainArgs = ['--certification', 'cert.json', '--certification-statement', 'cert-statement.json', '--certification-report', 'report.json',
  '--activation-approval', 'act.json', '--activation-approval-statement', 'act-statement.json', '--activation-evidence', 'evidence.json'];
const s6bAuthorityArgs = ['--registry', 'registry.json', '--revocations', 'revocations.json'];

test('S6b release assemble: pure derivation, exclusive output, no authority', async () => {
  const f = await s6bFiles();
  const r = await cli(['release', 'assemble', ...s6bReleaseArgs(P6.STAGING), '--out', 'release.json'], { cwd: f.cwd, now: S6B_NOW });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.result.releaseId, f.release.releaseId);
  assert.match(r.json.result.authorization, /^none: candidate backend release/);
  assert.equal(fs.readFileSync(path.join(f.cwd, 'release.json')).equals(f.release.bytes), true);
  await refused(['release', 'assemble', ...s6bReleaseArgs(P6.STAGING), '--out', 'release.json'], /never overwritten/, { cwd: f.cwd, now: S6B_NOW });
  await refused(['release', 'assemble', ...s6bReleaseArgs(P6.STAGING), ...s6bAuthorityArgs, '--out', 'r2.json'], /not accepted|only release inputs/, { cwd: f.cwd, now: S6B_NOW });
  await refused(['release', 'assemble', ...s6bReleaseArgs('lyfelabz-prod'), '--out', 'r3.json'], /identity|mismatch/, { cwd: f.cwd, now: S6B_NOW });
});

test('S6b package assemble and verify: round trip, forged packages refuse, nothing authorizes', async () => {
  const f = await s6bFiles();
  const a = await cli(['package', 'assemble', ...s6bReleaseArgs(P6.STAGING), ...s6bChainArgs, ...s6bAuthorityArgs, '--out', 'package.json'], { cwd: f.cwd, now: S6B_NOW });
  assert.equal(a.code, 0, a.stderr);
  const result = a.json.result;
  assert.equal(result.providerVerified, false); assert.equal(result.releaseAuthorized, false); assert.equal(result.activationReady, false);
  assert.equal(result.evidenceClass, 'synthetic');
  assert.ok(result.checks.includes('deploymentApproval.signature: synthetic-passed'));
  assert.ok(result.checks.includes('buildRecord.deployed: not-observed'));
  assert.equal(result.checks.some(c => /\.(signature|revocation): passed$/.test(c)), false);
  const v = await cli(['package', 'verify', ...s6bReleaseArgs(P6.STAGING), ...s6bChainArgs, ...s6bAuthorityArgs, '--package', 'package.json'], { cwd: f.cwd, now: '2027-01-01T00:00:00.000Z' });
  assert.equal(v.code, 0, v.stderr);
  assert.equal(v.json.result.sha256, result.sha256);
  const pkg = JSON.parse(fs.readFileSync(path.join(f.cwd, 'package.json'), 'utf8'));
  pkg.checks.find(c => c.check === 'deploymentApproval.signature').status = 'passed';
  fs.writeFileSync(path.join(f.cwd, 'forged.json'), K.canonicalJSON(pkg));
  await refused(['package', 'verify', ...s6bReleaseArgs(P6.STAGING), ...s6bChainArgs, ...s6bAuthorityArgs, '--package', 'forged.json'], /does not match the evidence/, { cwd: f.cwd });
  await refused(['package', 'verify', ...s6bReleaseArgs(P6.STAGING), ...s6bChainArgs, '--package', 'package.json'], /does not match the evidence/, { cwd: f.cwd });
  await refused(['package', 'verify', ...s6bReleaseArgs(P6.STAGING), ...s6bChainArgs, ...s6bAuthorityArgs, '--evaluated-at', S6B_NOW, '--package', 'package.json'], /not accepted/, { cwd: f.cwd });
  await refused(['package', 'assemble', ...s6bReleaseArgs(P6.STAGING), ...s6bChainArgs, ...s6bAuthorityArgs, '--out', 'package.json'], /never overwritten/, { cwd: f.cwd, now: S6B_NOW });
});

test('S6b commands: cloud projects only, no --execute, paired inputs, production authority pinned', async () => {
  const f = await s6bFiles();
  for (const command of [['release', 'assemble'], ['package', 'assemble'], ['package', 'verify']]) {
    await refused([...command, '--project', 'demo-a3-s6b'], /applies only to lyfelabz-staging or lyfelabz-prod/);
    await refused([...command, '--project', P6.STAGING, '--execute'], /--execute is not accepted/);
    await refused([...command, '--project', P6.STAGING, '--confirm', 'a'.repeat(64)], /--confirm is not accepted/);
    await refused([...command, '--plan', 'plan.json'], /explicit --project is required/, { cwd: f.cwd });
  }
  const pair = s6bReleaseArgs(P6.STAGING).filter(x => x !== '--approval-statement' && x !== 'approval-statement.json');
  await refused(['release', 'assemble', ...pair, '--out', 'x.json'], /must be given together/, { cwd: f.cwd });
  await refused(['package', 'assemble', ...s6bReleaseArgs(P6.STAGING), '--registry', 'registry.json', '--out', 'x.json'], /must be given together/, { cwd: f.cwd, now: S6B_NOW });
  await refused(['package', 'assemble', ...s6bReleaseArgs(P6.STAGING), '--certification-report', 'report.json', '--out', 'x.json'], /requires --certification/, { cwd: f.cwd, now: S6B_NOW });
  const p = await s6bFiles({ project: 'lyfelabz-prod' });
  await refused(['package', 'assemble', ...s6bReleaseArgs('lyfelabz-prod'), ...s6bAuthorityArgs, '--out', 'x.json'], /artifact-pinned registry/, { cwd: p.cwd, now: S6B_NOW });
  const prod = await cli(['package', 'assemble', ...s6bReleaseArgs('lyfelabz-prod'), ...s6bChainArgs, '--out', 'p.json'], { cwd: p.cwd, now: S6B_NOW });
  assert.equal(prod.code, 0, prod.stderr);
  assert.ok(prod.json.result.checks.includes('deploymentApproval.signature: failed'));
  assert.equal(fs.existsSync(path.join(f.cwd, 'x.json')), false);
});

// --- A3-6 S6c: observe plan, capture and verify (synthetic exchange injected; no credentials) ---
const { buildCapture } = require('./fixtures/synthetic-capture.cjs');
const http = require('node:http');
const https = require('node:https');
async function observeCli(argv, { cwd, exchange, hostingRoot, env = {} } = {}) {
  const out = [], err = [];
  const code = await C.main(argv, { env, cwd, exchange, hostingRoot, now: observeCli.clock || (() => F.NOW), stdout: { write: s => out.push(s) }, stderr: { write: s => err.push(s) } });
  return { code, stderr: err.join(''), json: code === 0 ? JSON.parse(out.join('')) : null };
}
async function observeSetup() {
  const c = await buildCapture();
  const cwd = scratch({ 'plan.json': c.deploymentPlan.bytes, 'plan-object.json': c.deploymentPlan.object, 'expected.json': c.expected.bytes, 'expected-object.json': c.expected.object });
  let calls = 0;
  const exchange = async url => { calls++; return c.exchange(url); };
  return { c, cwd, exchange, calls: () => calls };
}
const INPUTS = ['--plan', 'plan.json', '--plan-object', 'plan-object.json', '--expected', 'expected.json', '--expected-object', 'expected-object.json'];
async function withoutNetwork(run) {
  const calls = [], saved = { fetch: globalThis.fetch, http: http.request, https: https.request };
  const trap = name => () => { calls.push(name); throw new Error('network attempted'); };
  globalThis.fetch = trap('fetch'); http.request = trap('http'); https.request = trap('https');
  try { return { value: await run(), calls }; } finally { globalThis.fetch = saved.fetch; http.request = saved.http; https.request = saved.https; }
}

test('S6c observe plan: offline, cloud projects only, no credentials', async () => {
  const { value, calls } = await withoutNetwork(() => observeCli(['observe', 'plan', '--project', 'lyfelabz-staging'], { cwd: scratch() }));
  assert.deepEqual(calls, []);
  assert.equal(value.code, 0, value.stderr);
  assert.equal(value.json.result.method, 'GET only');
  assert.match(value.json.result.credentials, /reads no credentials/);
  assert.equal((await observeCli(['observe', 'plan', '--project', 'demo-a3'], { cwd: scratch() })).code, 1);
  assert.match((await observeCli(['observe', 'plan'], { cwd: scratch() })).stderr, /explicit --project is required/);
  assert.match((await observeCli(['observe', 'plan', '--project', 'lyfelabz-staging'], { cwd: scratch(), env: { GOOGLE_CLOUD_PROJECT: 'lyfelabz-prod' } })).stderr, /ambiguous project/);
});

test('S6c observe capture: requires --live, refuses --execute and --confirm, and never overwrites output', async () => {
  const s = await observeSetup();
  const base = ['observe', 'capture', '--project', 'lyfelabz-staging', ...INPUTS];
  const noLive = await observeCli([...base, '--out', 'cap'], { cwd: s.cwd, exchange: s.exchange, hostingRoot: s.c.hostingRoot });
  assert.match(noLive.stderr, /only with an explicit --live/);
  assert.match((await observeCli([...base, '--out', 'cap', '--live', '--execute'], { cwd: s.cwd, exchange: s.exchange })).stderr, /--execute is not accepted/);
  assert.match((await observeCli([...base, '--out', 'cap', '--live', '--confirm', 'a'.repeat(64)], { cwd: s.cwd, exchange: s.exchange })).stderr, /--confirm is not accepted/);
  assert.match((await observeCli(['observe', 'capture', '--project', 'demo-a3', ...INPUTS, '--out', 'cap', '--live'], { cwd: s.cwd, exchange: s.exchange })).stderr, /only to lyfelabz-staging or lyfelabz-prod/);
  fs.mkdirSync(path.join(s.cwd, 'existing'));
  fs.writeFileSync(path.join(s.cwd, 'existing', 'capture.json'), 'keep');
  assert.match((await observeCli([...base, '--out', 'existing', '--live'], { cwd: s.cwd, exchange: s.exchange })).stderr, /already exists/);
  assert.equal(fs.readFileSync(path.join(s.cwd, 'existing', 'capture.json'), 'utf8'), 'keep');
  assert.match((await observeCli([...base, '--out', 'cap', '--live', '--principal', 'Not An Email'], { cwd: s.cwd, exchange: s.exchange, hostingRoot: s.c.hostingRoot })).stderr, /--principal/);
  assert.equal(s.calls(), 0, 'no provider read happens before every local check passes');
  assert.equal(fs.existsSync(path.join(s.cwd, 'cap')), false);
});

test('S6c observe capture then verify: unattested, non-authorizing, replayed offline; tampering refuses', async () => {
  const s = await observeSetup();
  let n = 0; observeCli.clock = () => new Date(Date.parse('2026-10-16T12:10:00.000Z') + n++).toISOString();
  try {
    const captured = await observeCli(['observe', 'capture', '--project', 'lyfelabz-staging', ...INPUTS, '--out', 'cap', '--live', '--principal', 'operator@example.org'],
      { cwd: s.cwd, exchange: s.exchange, hostingRoot: s.c.hostingRoot });
    assert.equal(captured.code, 0, captured.stderr);
    const result = captured.json.result;
    assert.equal(result.evidenceClass, 'operator-captured-unattested');
    for (const key of ['providerVerified', 'releaseAuthorized', 'activationReady']) assert.equal(result[key], false);
    assert.match(result.freshness, /^historical/);
    assert.deepEqual(fs.readdirSync(path.join(s.cwd, 'cap')).sort(), ['capture.json', 'observation.json', 'receipt.json', 'surface-report.json', 'transcript.json']);
    const reads = s.calls();
    const verifyArgs = ['observe', 'verify', '--project', 'lyfelabz-staging', ...INPUTS, '--capture', 'cap'];
    const { value, calls } = await withoutNetwork(() => observeCli(verifyArgs, { cwd: s.cwd, hostingRoot: s.c.hostingRoot }));
    assert.deepEqual(calls, []);
    assert.equal(value.code, 0, value.stderr);
    assert.equal(value.json.result.providerVerified, false);
    assert.equal(s.calls(), reads, 'verify makes no exchange');
    assert.match((await observeCli([...verifyArgs, '--live'], { cwd: s.cwd })).stderr, /--live is not accepted/);
    assert.match((await observeCli(['observe', 'verify', '--project', 'lyfelabz-prod', ...INPUTS, '--capture', 'cap'], { cwd: s.cwd, hostingRoot: s.c.hostingRoot })).stderr, /REFUSED/);
    const bundlePath = path.join(s.cwd, 'cap', 'capture.json');
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8')); bundle.providerVerified = true;
    fs.writeFileSync(bundlePath, K.canonicalJSON(bundle));
    assert.match((await observeCli(verifyArgs, { cwd: s.cwd, hostingRoot: s.c.hostingRoot })).stderr, /capture\.json differs/);
    // A second capture to the same directory refuses and leaves the files alone.
    const before = fs.readFileSync(bundlePath);
    assert.match((await observeCli(['observe', 'capture', '--project', 'lyfelabz-staging', ...INPUTS, '--out', 'cap', '--live'], { cwd: s.cwd, exchange: s.exchange })).stderr, /already exists/);
    assert.equal(fs.readFileSync(bundlePath).equals(before), true);
  } finally { observeCli.clock = undefined; }
});

test('S6c observe capture: a failed read refuses with no output and no fallback', async () => {
  const s = await observeSetup();
  const failing = async url => { if (url.includes('firebaserules')) throw new Error('ECONNRESET'); return s.exchange(url); };
  let n = 0; observeCli.clock = () => new Date(Date.parse('2026-10-16T12:10:00.000Z') + n++).toISOString();
  try {
    const r = await observeCli(['observe', 'capture', '--project', 'lyfelabz-staging', ...INPUTS, '--out', 'cap', '--live'], { cwd: s.cwd, exchange: failing, hostingRoot: s.c.hostingRoot });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /provider read failed/);
    assert.equal(fs.existsSync(path.join(s.cwd, 'cap')), false);
  } finally { observeCli.clock = undefined; }
});

test('S6c observe capture: the live path obtains a credential only after every local check, then uses the live exchange', async () => {
  const PCm = require('./provider-capture.cjs');
  const s = await observeSetup();
  const saved = { token: PCm.liveAccessToken, live: PCm.createLiveExchange };
  const events = [];
  PCm.liveAccessToken = () => { events.push('token'); return 'ya29.SYNTHETIC-TOKEN'; };
  PCm.createLiveExchange = ({ token }) => { events.push(`exchange:${token === 'ya29.SYNTHETIC-TOKEN'}`); return s.exchange; };
  let n = 0; observeCli.clock = () => new Date(Date.parse('2026-10-16T12:10:00.000Z') + n++).toISOString();
  try {
    const base = ['observe', 'capture', '--project', 'lyfelabz-staging', ...INPUTS, '--live'];
    assert.match((await observeCli([...base, '--out', 'a', '--principal', 'bad'], { cwd: s.cwd })).stderr, /--principal/);
    fs.writeFileSync(path.join(s.cwd, 'plan.json'), Buffer.concat([s.c.deploymentPlan.bytes, Buffer.from(' ')]));
    assert.match((await observeCli([...base, '--out', 'a'], { cwd: s.cwd })).stderr, /REFUSED/);
    assert.match((await observeCli(['observe', 'capture', '--project', 'lyfelabz-prod', ...INPUTS, '--live', '--out', 'a'], { cwd: s.cwd })).stderr, /REFUSED/);
    assert.deepEqual(events, [], 'no credential for an invalid capture');
    fs.writeFileSync(path.join(s.cwd, 'plan.json'), s.c.deploymentPlan.bytes);
    const ok = await observeCli([...base, '--out', 'a'], { cwd: s.cwd, hostingRoot: s.c.hostingRoot });
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(events, ['token', 'exchange:true']);
    assert.equal(ok.json.result.evidenceClass, 'operator-captured-unattested');
    assert.equal(fs.readFileSync(path.join(s.cwd, 'a', 'transcript.json')).includes('ya29.SYNTHETIC-TOKEN'), false);
  } finally { PCm.liveAccessToken = saved.token; PCm.createLiveExchange = saved.live; observeCli.clock = undefined; }
});

test('S6c F3: every locally detectable preflight failure refuses with zero credential retrievals and zero provider reads', async () => {
  const PCm = require('./provider-capture.cjs');
  const s = await observeSetup();
  const saved = { token: PCm.liveAccessToken, live: PCm.createLiveExchange };
  let tokens = 0, reads = 0;
  PCm.liveAccessToken = () => { tokens++; return 'ya29.SYNTHETIC-TOKEN'; };
  PCm.createLiveExchange = () => async url => { reads++; return s.exchange(url); };
  const os = require('node:os');
  const root = files => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6c-cli-f3-')); files(d); return d; };
  let n = 0; observeCli.clock = () => new Date(Date.parse('2026-10-16T12:10:00.000Z') + n++).toISOString();
  try {
    const args = (out, extra = [], project = 'lyfelabz-staging') => ['observe', 'capture', '--project', project, ...INPUTS, '--live', '--out', out, ...extra];
    const failures = [
      [args('a'), root(() => {}), /unreadable/],
      [args('b'), root(d => fs.mkdirSync(path.join(d, 'firebase.staging.json'))), /unreadable/],
      [args('c'), root(d => fs.writeFileSync(path.join(d, 'firebase.staging.json'), '{')), /not strict JSON/],
      [args('d', ['--principal', 'Bad Principal']), s.c.hostingRoot, /--principal/],
      [args('e', [], 'demo-a3'), s.c.hostingRoot, /only to lyfelabz-staging or lyfelabz-prod/],
      [['observe', 'capture', ...INPUTS, '--live', '--out', 'f'], s.c.hostingRoot, /explicit --project/],
    ];
    for (const [argv, hostingRoot, pattern] of failures) {
      const r = await observeCli(argv, { cwd: s.cwd, hostingRoot });
      assert.equal(r.code, 1);
      assert.match(r.stderr, pattern);
    }
    fs.writeFileSync(path.join(s.cwd, 'bad-plan.json'), Buffer.concat([s.c.deploymentPlan.bytes, Buffer.from(' ')]));
    fs.writeFileSync(path.join(s.cwd, 'bad-expected.json'), '{}');
    for (const swap of [['plan.json', 'bad-plan.json'], ['expected.json', 'bad-expected.json'], ['plan-object.json', 'missing.json']]) {
      const argv = args('g').map(a => (a === swap[0] ? swap[1] : a));
      assert.equal((await observeCli(argv, { cwd: s.cwd, hostingRoot: s.c.hostingRoot })).code, 1, swap.join(' -> '));
    }
    assert.equal(tokens, 0, 'no credential retrieval');
    assert.equal(reads, 0, 'no provider read');
    const ok = await observeCli(args('ok'), { cwd: s.cwd, hostingRoot: s.c.hostingRoot });
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(tokens, 1);
    assert.ok(reads > 100);
  } finally { PCm.liveAccessToken = saved.token; PCm.createLiveExchange = saved.live; observeCli.clock = undefined; }
});

// --- A3-6 S6d revocation commands (offline, non-authorizing) --------------------
const RVX = require('./fixtures/synthetic-revocation.cjs');
const RVP = require('./revocation-procedure.cjs');

async function revocationSetup() {
  const s = await RVX.buildRevocation();
  // Supersede a certification of a variant release (backendReleaseId binds the whole manifest) by another certification.
  const old = RVX.certifiedVariant(s), next = RVX.certifiedVariant(s, { suffix: 'new' });
  const d = RVX.disposition({ action: 'supersede', target: old.target.ref, replacement: next.target.ref, key: s.keys.dispose });
  const variant = old.release;
  // Sol's P2 reproduction: a deployment-approval target with a substituted, unsigned manifest.
  const revoke = RVX.disposition({ action: 'revoke', target: s.ev.deployment.ref, key: s.keys.dispose });
  const c = await buildCapture();
  const capture = await PC6.captureA3Provider({ ...c, evidenceClass: 'synthetic' });
  const files = { 'disposition.json': d.document, 'disposition-statement.json': d.statementBytes, 'target.json': old.target.document,
    'replacement.json': next.target.document, 'dispositions.json': [], 'releases.json': [variant.document],
    'revoke.json': revoke.document, 'revoke-statement.json': revoke.statementBytes, 'deployment.json': s.ev.deployment.document,
    'genuine-releases.json': [s.release.document], 'substituted-releases.json': [RVX.releaseVariant(s.release).document],
    'registry.json': s.authority.registryEntries, 'revocations.json': [],
    'plan.json': c.deploymentPlan.bytes, 'plan-object.json': c.deploymentPlan.object, 'expected.json': c.expected.bytes, 'expected-object.json': c.expected.object };
  for (const [key, file] of Object.entries(PC6.FILES)) files[`cap/${file}`] = capture.bytes[key];
  return { s, c, cwd: scratch(files) };
}
const PC6 = require('./provider-capture.cjs');
const REV = ['--disposition', 'disposition.json', '--disposition-statement', 'disposition-statement.json', '--target', 'target.json', '--replacement', 'replacement.json',
  '--dispositions', 'dispositions.json', '--releases', 'releases.json', '--registry', 'registry.json', '--revocations', 'revocations.json'];

test('S6d revocation prepare, verify and rollout-check: offline, exclusive output, never authorizing', async () => {
  const { c, cwd } = await revocationSetup();
  try {
    const now = RVX.PREPARED;
    const { value: prepared, calls } = await withoutNetwork(() => cli(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...REV, '--out', 'rplan.json'], { cwd, now }));
    assert.deepEqual(calls, []);
    assert.equal(prepared.code, 0, prepared.stderr);
    const r = prepared.json.result;
    for (const key of ['revocationEffective', 'releaseAuthorized', 'activationReady']) assert.equal(r[key], false);
    assert.equal(r.planClass, RVP.PLAN_CLASSES.synthetic);
    assert.match(r.disposition.effect, /does not revoke its target/);
    assert.equal(r.procedure.status, RVP.PROCEDURE_STATUS);
    const before = fs.readFileSync(path.join(cwd, 'rplan.json'));
    assert.equal(K.sha256Bytes(before), r.sha256);
    // Output collision: never overwritten.
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...REV, '--out', 'rplan.json'], /could not be created/, { cwd, now });
    assert.equal(fs.readFileSync(path.join(cwd, 'rplan.json')).equals(before), true);

    const verified = await cli(['revocation', 'verify', '--project', 'lyfelabz-staging', ...REV, '--revocation-plan', 'rplan.json'], { cwd, now: '2026-10-16T12:00:00.000Z' });
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(verified.json.result.verified, true);
    assert.equal(verified.json.result.currentFreshness.status, 'within-window');
    // After the D6 window: still verified historically; current freshness reported separately, never authorization.
    const late = await cli(['revocation', 'verify', '--project', 'lyfelabz-staging', ...REV, '--revocation-plan', 'rplan.json'], { cwd, now: '2026-10-17T12:00:00.000Z' });
    assert.equal(late.code, 0, late.stderr);
    assert.match(late.json.result.verification, /^historical/);
    assert.equal(late.json.result.currentFreshness.status, 'outside-window');
    assert.equal(late.json.result.releaseAuthorized, false);

    // Without the original plan inputs, rollout-check refuses before reading the capture.
    await refused(['revocation', 'rollout-check', '--project', 'lyfelabz-staging', '--revocation-plan', 'rplan.json', '--capture', 'cap', ...INPUTS, '--out', 'rollout.json'],
      /--disposition is required/, { cwd, now });
    assert.equal(fs.existsSync(path.join(cwd, 'rollout.json')), false);
    const rollout = ['revocation', 'rollout-check', '--project', 'lyfelabz-staging', ...REV, '--revocation-plan', 'rplan.json', '--capture', 'cap',
      ...INPUTS, '--out', 'rollout.json'];
    const out = []; const err = [];
    const code = await C.main(rollout, { env: {}, cwd, hostingRoot: c.hostingRoot, now: () => now, stdout: { write: x => out.push(x) }, stderr: { write: x => err.push(x) } });
    assert.equal(code, 0, err.join(''));
    const result = JSON.parse(out.join('')).result;
    assert.equal(result.rolloutComparison, 'passed');
    for (const key of ['revocationComplete', 'revocationEffective', 'releaseAuthorized', 'activationReady']) assert.equal(result[key], false);
    assert.equal(result.oldRevisionsDeleted, 'not-observed');
    assert.match(result.deployedRevocationList, /^not-observed/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'rollout.json'), 'utf8')).revocationComplete, false);
    const again = await C.main(rollout, { env: {}, cwd, hostingRoot: c.hostingRoot, now: () => now, stdout: { write() {} }, stderr: { write: x => err.push(x) } });
    assert.equal(again, 1);
    assert.match(err.join(''), /could not be created/);
  } finally { c.cleanup(); }
});

test('S6d revocation commands: explicit cloud project, no --execute, paired authority, unknown flags refuse', async () => {
  const { c, cwd } = await revocationSetup();
  try {
    await refused(['revocation', 'prepare', ...REV, '--out', 'x.json'], /explicit --project/, { cwd });
    await refused(['revocation', 'prepare', '--project', 'demo-a3', ...REV, '--out', 'x.json'], /applies only to lyfelabz-staging or lyfelabz-prod/, { cwd });
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...REV, '--out', 'x.json'], /ambiguous project/, { cwd, env: { GOOGLE_CLOUD_PROJECT: 'lyfelabz-prod' } });
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...REV, '--out', 'x.json', '--execute'], /--execute is not accepted/, { cwd });
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...REV, '--out', 'x.json', '--confirm', 'a'.repeat(64)], /--confirm is not accepted/, { cwd });
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...REV, '--out', 'x.json', '--bogus', '1'], /--bogus is not accepted/, { cwd });
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...REV, 'stray'], /unexpected argument/, { cwd });
    await refused(['revocation', 'revoke', '--project', 'lyfelabz-staging'], /unknown command/, { cwd });
    const noRevocations = REV.slice(0, -2);
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...noRevocations, '--out', 'x.json'], /must be given together/, { cwd });
    const noAuthority = REV.slice(0, -4);
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...noAuthority, '--out', 'x.json'], /unverifiable: no artifact-pinned staging/, { cwd, now: RVX.PREPARED });
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-prod', ...REV, '--out', 'x.json'], /identity mismatch/, { cwd, now: RVX.PREPARED });
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...REV.filter((v, i, a) => v !== '--dispositions' && a[i - 1] !== '--dispositions'), '--out', 'x.json'], /--dispositions is required/, { cwd });
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...REV.map(v => (v === 'releases.json' ? 'missing.json' : v)), '--out', 'x.json'], /--releases file is unreadable/, { cwd });
    await refused(['revocation', 'rollout-check', '--project', 'lyfelabz-staging', ...REV, '--revocation-plan', 'none.json', '--capture', 'cap', ...INPUTS, '--out', 'r.json'], /--revocation-plan file is unreadable/, { cwd });
    assert.equal(fs.existsSync(path.join(cwd, 'x.json')), false);
    assert.equal(fs.existsSync(path.join(cwd, 'r.json')), false);
  } finally { c.cleanup(); }
});

test('S6d P2 through the CLI: a substituted deployment-target manifest refuses before any output or replay', async () => {
  const { c, cwd } = await revocationSetup();
  try {
    const base = ['--disposition', 'revoke.json', '--disposition-statement', 'revoke-statement.json', '--target', 'deployment.json', '--dispositions', 'dispositions.json',
      '--registry', 'registry.json', '--revocations', 'revocations.json'];
    const now = RVX.PREPARED;
    await refused(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...base, '--releases', 'substituted-releases.json', '--out', 'p2.json'],
      /deployment binding invalid at \$: candidate runtimePayloadFingerprint mismatch/, { cwd, now });
    assert.equal(fs.existsSync(path.join(cwd, 'p2.json')), false);
    const genuine = await cli(['revocation', 'prepare', '--project', 'lyfelabz-staging', ...base, '--releases', 'genuine-releases.json', '--out', 'p2.json'], { cwd, now });
    assert.equal(genuine.code, 0, genuine.stderr);
    const PCm = require('./provider-capture.cjs'), replay = PCm.verifyCapture;
    let replays = 0;
    PCm.verifyCapture = async (...a) => { replays++; return replay(...a); };
    try {
      const args = rel => ['revocation', 'rollout-check', '--project', 'lyfelabz-staging', ...base, '--releases', rel, '--revocation-plan', 'p2.json', '--capture', 'cap', ...INPUTS, '--out', 'p2-rollout.json'];
      const err = [];
      const code = await C.main(args('substituted-releases.json'), { env: {}, cwd, hostingRoot: c.hostingRoot, now: () => now, stdout: { write() {} }, stderr: { write: x => err.push(x) } });
      assert.equal(code, 1);
      assert.match(err.join(''), /deployment binding invalid/);
      assert.equal(replays, 0);
      assert.equal(fs.existsSync(path.join(cwd, 'p2-rollout.json')), false);
      const out = [];
      assert.equal(await C.main(args('genuine-releases.json'), { env: {}, cwd, hostingRoot: c.hostingRoot, now: () => now, stdout: { write: x => out.push(x) }, stderr: { write: x => err.push(x) } }), 0, err.join(''));
      const result = JSON.parse(out.join('')).result;
      assert.equal(result.rolloutComparison, 'failed');
      for (const key of ['revocationComplete', 'revocationEffective', 'releaseAuthorized', 'activationReady']) assert.equal(result[key], false);
    } finally { PCm.verifyCapture = replay; }
  } finally { c.cleanup(); }
});
