'use strict';

// D13 Part D: offline deployment receipt pair validation. All receipts are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const R = require('./deploy-receipt.cjs');
const { compressionProfile } = require('./provider-manifest.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHA = '1'.repeat(40);
const CANDIDATE = 'c'.repeat(64);
const NOW = '2026-10-18T12:10:00.000Z';
const SITES = { app: 'lyfelabz-staging', marketing: 'lyfelabz-staging-marketing' };

function receipt(phase, overrides = {}) {
  return {
    kind: 'lyfelabz.hostingDeployReceipt', schemaVersion: 1, phase, invocationId: 'deploy-0001-synthetic',
    recordedAt: phase === 'pre' ? '2026-10-18T11:58:00.000Z' : '2026-10-18T12:00:00.000Z',
    source: { sha: SHA, dirty: false }, hostingCandidateFingerprint: CANDIDATE, project: 'lyfelabz-staging', sites: { ...SITES },
    firebaseCli: { version: '15.22.4', executable: '/opt/synthetic/bin/firebase' }, node: { executable: '/opt/synthetic/bin/node' },
    compressionProfile: JSON.parse(JSON.stringify(compressionProfile())),
    hashCache: phase === 'pre' ? { present: false, digest: null } : { present: true, digest: 'e'.repeat(64) },
    provenance: { kind: 'synthetic-fixture', tool: 'deploy-receipt.test', supplier: 'operator' },
    ...overrides
  };
}
function input() {
  return { pre: receipt('pre'), post: receipt('post'), now: NOW,
    expected: { project: 'lyfelabz-staging', sites: { ...SITES }, sourceSha: SHA, hostingCandidateFingerprint: CANDIDATE } };
}
function refuses(mutate, reason) {
  const i = input(); mutate(i);
  assert.throws(() => R.validateDeployReceiptPair(i), reason);
}

test('consistent synthetic receipt pair is operator-supplied provenance and grants nothing', () => {
  const result = R.validateDeployReceiptPair(input());
  assert.equal(result.scope, 'deploy-receipt-consistency');
  assert.equal(result.receiptConsistent, true);
  assert.equal(result.hashCachePolicy, 'satisfied');
  assert.equal(result.supplier, 'operator');
  assert.equal(result.deploymentProvenanceEstablished, false);
  assert.deepEqual(result.compressionProfile, JSON.parse(JSON.stringify(compressionProfile())));
  for (const flag of ['deployable', 'certified', 'authorized', 'available']) assert.equal(result[flag], false);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.compressionProfile) && Object.isFrozen(result.limitations));
  assert.ok(result.limitations.some(l => /not cryptographic proof/.test(l)));
  assert.deepEqual(R.validateDeployReceiptPair(input()), result);
});

test('hash cache present before deployment violates the controlled-deployment policy', () => {
  const i = input(); i.pre.hashCache = { present: true, digest: 'a'.repeat(64) };
  const result = R.validateDeployReceiptPair(i);
  assert.equal(result.hashCachePolicy, 'violated');
  assert.equal(result.receiptConsistent, true);
  refuses(x => { x.pre.hashCache = { present: true, digest: null }; }, /hash-cache digest/);
  refuses(x => { x.pre.hashCache = { present: false, digest: 'a'.repeat(64) }; }, /hash-cache digest/);
});

test('source, invocation, candidate and identity mismatches refuse', () => {
  refuses(i => { i.post.source.sha = '2'.repeat(40); }, /source differs between pre and post/);
  refuses(i => { i.pre.source.sha = '2'.repeat(40); i.post.source.sha = '2'.repeat(40); }, /not the expected release source/);
  refuses(i => { i.pre.source.dirty = true; i.post.source.dirty = true; }, /clean source/);
  refuses(i => { i.post.invocationId = 'deploy-0002-synthetic'; }, /different deployment invocations/);
  refuses(i => { i.post.hostingCandidateFingerprint = 'd'.repeat(64); }, /another Hosting candidate/);
  refuses(i => { i.pre.project = 'lyfelabz-prod'; }, /another project/);
  refuses(i => { i.post.sites.marketing = 'other-site'; }, /other sites/);
  refuses(i => { i.post.firebaseCli.version = '15.22.5'; }, /Firebase CLI identity differs/);
  refuses(i => { i.post.node.executable = '/usr/bin/node'; }, /Node executable differs/);
  refuses(i => { i.post.provenance.kind = 'offline-record'; }, /provenance differs/);
});

test('compression profile must be the Part C contract and identical across the pair', () => {
  refuses(i => { i.post.compressionProfile.header.os = i.post.compressionProfile.header.os === 19 ? 3 : 19; }, /compression profile differs/);
  refuses(i => { i.post.compressionProfile.calibration.empty = 'f'.repeat(64); }, /compression profile differs/);
  refuses(i => { delete i.pre.compressionProfile.calibration.empty; }, /missing pre receipt compression profile.calibration field: empty/);
  refuses(i => { i.pre.compressionProfile = null; }, /compression profile must be a plain object/);
});

test('timestamps, phases, provenance and shape are strict', () => {
  refuses(i => { i.pre.recordedAt = '2026-10-18T12:01:00.000Z'; }, /pre receipt is recorded after the post receipt/);
  refuses(i => { i.now = '2026-10-18T11:59:00.000Z'; }, /future receipt timestamp/);
  refuses(i => { i.pre.phase = 'post'; }, /pre receipt phase is post/);
  refuses(i => { i.pre.provenance.kind = 'live-capture'; }, /unsupported pre receipt provenance kind/);
  refuses(i => { i.pre.provenance.supplier = 'provider'; }, /unsupported pre receipt provenance supplier/);
  refuses(i => { i.pre.extra = true; }, /unknown pre receipt field: extra/);
  refuses(i => { i.post = undefined; }, /post receipt must be a plain object/);
  refuses(i => { i.pre.node.executable = 'node'; }, /malformed pre receipt Node executable/);
  refuses(i => { i.pre.invocationId = 'short'; }, /invocation id/);
  refuses(i => { i.extra = 1; }, /unknown input field: extra/);
});

test('validator performs no I/O, environment, clock or subprocess access', () => {
  const source = fs.readFileSync(path.join(__dirname, 'deploy-receipt.cjs'), 'utf8');
  for (const forbidden of [/require\('node:(fs|http|https|net|child_process|os)'\)/, /\bfetch\(/, /process\.env/, /Date\.now\(/, /new Date\(/, /execFile|spawn/])
    assert.doesNotMatch(source, forbidden);
});

test('no release, deployment, activation or Functions path consumes this module', () => {
  const consumers = [];
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'lib', 'dist', '.git'].includes(item.name)) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) walk(file);
      else if (/\.(c?js|ts|json|ya?ml)$/.test(item.name)) {
        const rel = path.relative(ROOT, file);
        let source = fs.readFileSync(file, 'utf8');
        // prepare.cjs may only list this test suite in HOSTING_TEST_FILES; it never requires the module.
        if (rel === 'scripts/hosting-release/prepare.cjs') {
          const listing = "  'scripts/hosting-release/deploy-receipt.test.cjs',\n";
          assert.equal(source.split(listing).length, 2, 'prepare.cjs lists the suite exactly once');
          source = source.replace(listing, '');
        }
        if (source.includes('deploy-receipt')) consumers.push(rel);
      }
    }
  }
  for (const directory of ['scripts', 'app/scripts', 'app/src', 'platform', '.github']) walk(path.join(ROOT, directory));
  // The Part D replay is the only consumer, and it is itself unconsumed; the Part C suite
  // names this module only in its own no-consumer allowlist.
  assert.deepEqual(consumers.sort(), ['scripts/hosting-release/deploy-receipt.cjs', 'scripts/hosting-release/deploy-receipt.test.cjs',
    'scripts/hosting-release/hosting-capture.cjs', 'scripts/hosting-release/hosting-capture.test.cjs',
    'scripts/hosting-release/provider-manifest.test.cjs']);
});
