'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('./rules-matrix-report.cjs');
const R = require('./option-b-rules-evidence.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');

const RULES = path.resolve(__dirname, '../../platform/firebase/firestore.rules');
const local = Buffer.from('rules_version = "2";\nservice cloud.firestore { match /databases/{d}/documents { match /{document=**} { allow read, write: if false; } } }\n');
const deployed = Buffer.from('rules_version = "2";\n// deployed copy\nservice cloud.firestore { match /databases/{d}/documents { match /{document=**} { allow read, write: if false; } } }\n');
const review = () => ({ fullDiffReviewed: true, unrelatedChanges: false, accessBroadening: false, summary: 'synthetic test review' });
const tool = () => ({ name: 'synthetic-tool', version: '1', dependencies: [{ name: 'dep', version: '1' }] });
const expectedExecutor = async (_rules, cases) => cases.map(c => c.expected);
const build = (over = {}) => G.buildReport({ localBytes: local, deployedBytes: deployed, sourceReview: review(), tool: tool(), execute: expectedExecutor, ...over });

test('covers exactly the 252 required cases and validates with the existing validator', async () => {
  const out = await build();
  assert.equal(out.cases, 252);
  const report = JSON.parse(out.bytes.toString('utf8'));
  assert.equal(report.results.length, 252);
  assert.equal(report.results.filter(r => r.expected === 'allow').length, 6);
  R.validateReport(out.bytes, { testEvidence: { reportSha256: out.sha256 }, localRulesSourceHash: K.sha256Bytes(local), approvedDeployedSourceHash: K.sha256Bytes(deployed) });
});

test('report and digest are reproducible', async () => {
  const a = await build(), b = await build();
  assert.deepEqual(a.bytes, b.bytes); assert.equal(a.sha256, b.sha256);
});

test('differing sources are never classified as equivalent', async () => {
  const out = await build();
  assert.equal(out.sourcesIdentical, false);
  assert.notEqual(out.localSha256, out.deployedSha256);
  assert.equal((await build({ deployedBytes: local })).sourcesIdentical, true);
});

test('a mismatch on either source refuses and yields no report', async () => {
  for (const side of [0, 1]) {
    let n = 0;
    const execute = async (_r, cases) => { const mine = n++; return cases.map((c, i) => (mine === side && i === 10 ? (c.expected === 'deny' ? 'allow' : 'deny') : c.expected)); };
    await assert.rejects(build({ execute }), e => e instanceof G.MatrixRefusal && e.rows.length === 1 && /did not match/.test(e.message));
  }
});

test('missing, surplus, malformed or failed execution refuses', async () => {
  await assert.rejects(build({ execute: async (_r, cases) => cases.slice(1).map(c => c.expected) }), /exactly one outcome per case/);
  await assert.rejects(build({ execute: async (_r, cases) => [...cases.map(c => c.expected), 'deny'] }), /exactly one outcome per case/);
  await assert.rejects(build({ execute: async () => undefined }), /exactly one outcome per case/);
  await assert.rejects(build({ execute: async (_r, cases) => cases.map((c, i) => (i === 3 ? 'maybe' : c.expected)) }), /unrecognised outcome/);
  await assert.rejects(build({ execute: async () => { throw new Error('emulator unreachable'); } }), /execution failed: emulator unreachable/);
  await assert.rejects(build({ execute: undefined }), /executor is required/);
});

test('invalid Rules bytes, source review and tool identity refuse', async () => {
  for (const bad of [Buffer.alloc(0), 'text', Buffer.from([0xff, 0xfe, 0xfd])]) {
    await assert.rejects(build({ localBytes: bad }), /Rules bytes required/);
    await assert.rejects(build({ deployedBytes: bad }), /Rules bytes required/);
  }
  const reviews = [undefined, null, {}, { ...review(), extra: 1 }, { ...review(), fullDiffReviewed: false }, { ...review(), unrelatedChanges: true },
    { ...review(), accessBroadening: true }, { ...review(), summary: '' }, { ...review(), summary: 'x'.repeat(2001) }];
  for (const r of reviews) await assert.rejects(build({ sourceReview: r }), /source review/);
  for (const t of [undefined, {}, { ...tool(), version: '' }, { ...tool(), dependencies: [] }, { ...tool(), dependencies: [{ name: 'a' }] }]) await assert.rejects(build({ tool: t }), /tool and dependency identities/);
});

// Real emulator execution. Runs only under: firebase emulators:exec --only firestore (from platform/firebase).
const emulator = process.env.FIRESTORE_EMULATOR_HOST ? test : test.skip;
emulator('emulator: repository Rules pass all 252 cases and a copy lacking explicit denies still passes by default deny', async () => {
  const repo = fs.readFileSync(RULES);
  const stripped = Buffer.from(repo.toString('utf8').replace('    match /teacherUnits/{unitId} {\n      allow read, write: if false;\n    }', ''));
  assert.notEqual(K.sha256Bytes(stripped), K.sha256Bytes(repo));
  const out = await G.buildReport({ localBytes: repo, deployedBytes: stripped, sourceReview: review(), tool: tool(), execute: G.emulatorExecutor() });
  assert.equal(out.cases, 252); assert.equal(out.sourcesIdentical, false);
});

emulator('emulator: Rules that open teacherUnits reads are detected and refused', async () => {
  const repo = fs.readFileSync(RULES);
  const opened = Buffer.from(repo.toString('utf8').replace('match /teacherUnits/{unitId} {\n      allow read, write: if false;', 'match /teacherUnits/{unitId} {\n      allow read: if true;'));
  assert.notEqual(K.sha256Bytes(opened), K.sha256Bytes(repo));
  await assert.rejects(G.buildReport({ localBytes: repo, deployedBytes: opened, sourceReview: review(), tool: tool(), execute: G.emulatorExecutor() }),
    e => e instanceof G.MatrixRefusal && e.rows.some(r => r.resource === 'teacherUnits' && r.actualDeployed === 'allow'));
});
