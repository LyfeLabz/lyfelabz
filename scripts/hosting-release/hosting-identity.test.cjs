'use strict';

// D13 Part A: offline Hosting identity contract. Enabled candidates are synthetic.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const H = require('./hosting-identity.cjs');
const { receipt } = require('./backend-state.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHA = '1'.repeat(40);
const PLACEMENT = 'b'.repeat(64);
function enabled(overrides = {}) {
  return { releaseIntent: 'teacher-units', source: { sha: SHA, dirty: false }, hostingArtifactFingerprint: 'a'.repeat(64),
    placementFingerprint: PLACEMENT, applicationBuildFingerprint: 'd'.repeat(64), teacherUnitsAvailability: 'enabled',
    availabilityEvidence: 'build-contract-assertion', ...overrides };
}
const FUNCTIONS = Object.freeze({ sourceSha: SHA, placementFingerprint: PLACEMENT });
const VECTOR_ENABLED = '22aa3a6a5326a67def8681732896fae3ebe4c7d5dd773b8dc1685ac647589c3f';
const VECTOR_CLOSED = '48432370be360b5071b4c97660a266724e570639941e67d7590a913b8fae0611';

test('fixed digest vectors', () => {
  assert.equal(H.hostingCandidateFingerprint(enabled()), VECTOR_ENABLED);
  assert.equal(H.hostingCandidateFingerprint(enabled({ releaseIntent: 'general', source: { sha: SHA, dirty: true }, teacherUnitsAvailability: 'closed' })), VECTOR_CLOSED);
});

test('vector equals an independent hash of the documented canonical text', () => {
  const text = '{"applicationBuildFingerprint":"' + 'd'.repeat(64) + '","availabilityEvidence":"build-contract-assertion",' +
    '"hostingArtifactFingerprint":"' + 'a'.repeat(64) + '","placementFingerprint":"' + PLACEMENT + '","releaseIntent":"teacher-units",' +
    '"source":{"dirty":false,"sha":"' + SHA + '"},"teacherUnitsAvailability":"enabled"}';
  assert.equal(crypto.createHash('sha256').update(text, 'utf8').digest('hex'), VECTOR_ENABLED);
});

test('identical candidates and key order give identical digests', () => {
  const c = enabled();
  const reordered = Object.fromEntries(Object.entries(c).reverse());
  reordered.source = { dirty: false, sha: SHA };
  assert.equal(H.hostingCandidateFingerprint(enabled()), H.hostingCandidateFingerprint(c));
  assert.equal(H.hostingCandidateFingerprint(reordered), VECTOR_ENABLED);
});

test('changing any field changes the digest', () => {
  const changes = { releaseIntent: 'general', source: { sha: '2'.repeat(40), dirty: false }, hostingArtifactFingerprint: 'e'.repeat(64),
    placementFingerprint: 'f'.repeat(64), applicationBuildFingerprint: '0'.repeat(64), teacherUnitsAvailability: 'closed' };
  const seen = new Set([VECTOR_ENABLED]);
  for (const [key, value] of Object.entries(changes)) seen.add(H.hostingCandidateFingerprint(enabled({ [key]: value })));
  seen.add(H.hostingCandidateFingerprint(enabled({ source: { sha: SHA, dirty: true } })));
  assert.equal(seen.size, Object.keys(changes).length + 2);
});

test('arrays are not part of the contract and are refused', () => {
  assert.throws(() => H.hostingCandidateFingerprint([enabled()]), /plain object/);
  assert.throws(() => H.hostingCandidateFingerprint(enabled({ source: [SHA, false] })), /plain object/);
  assert.throws(() => H.hostingCandidateFingerprint(enabled({ hostingArtifactFingerprint: ['a'.repeat(64)] })), /malformed/);
});

test('unknown, missing, null and malformed fields are refused', () => {
  const missing = enabled(); delete missing.applicationBuildFingerprint;
  const cases = [
    [enabled({ functionsArtifactFingerprint: 'a'.repeat(64) }), /unknown candidate field/],
    [enabled({ rulesSourceHash: 'a'.repeat(64) }), /unknown candidate field/],
    [enabled({ source: { sha: SHA, dirty: false, tree: SHA } }), /unknown candidate.source field/],
    [missing, /missing candidate field/],
    [enabled({ placementFingerprint: null }), /missing candidate field/],
    [enabled({ placementFingerprint: undefined }), /missing candidate field/],
    [enabled({ teacherUnitsAvailability: 'open' }), /unsupported Teacher Units availability/],
    [enabled({ teacherUnitsAvailability: 'ENABLED' }), /unsupported Teacher Units availability/],
    [enabled({ releaseIntent: 'other' }), /unsupported release intent/],
    [enabled({ availabilityEvidence: 'runtime' }), /unsupported availability evidence/],
    [enabled({ source: { sha: 'A'.repeat(40), dirty: false } }), /malformed source sha/],
    [enabled({ source: { sha: SHA, dirty: 'false' } }), /dirty flag/],
    [enabled({ hostingArtifactFingerprint: 'A'.repeat(64) }), /malformed Hosting artifact/],
    [enabled({ applicationBuildFingerprint: 'd'.repeat(63) }), /malformed application build/],
    [enabled({ placementFingerprint: 64 }), /malformed placement/],
    [null, /plain object/], ['candidate', /plain object/], [Object.assign(Object.create(null), enabled()), /plain object/]
  ];
  for (const [candidate, reason] of cases) assert.throws(() => H.validateHostingCandidate(candidate), reason);
  const getter = enabled(); Object.defineProperty(getter, 'releaseIntent', { enumerable: true, get: () => 'teacher-units' });
  assert.throws(() => H.validateHostingCandidate(getter), /data field/);
  const symbol = enabled(); symbol[Symbol('x')] = 1;
  assert.throws(() => H.validateHostingCandidate(symbol), /symbol/);
});

test('validation returns an exact copy, not the caller object', () => {
  const c = enabled(); const copy = H.validateHostingCandidate(c);
  assert.notEqual(copy, c); assert.notEqual(copy.source, c.source); assert.deepEqual(copy, c);
});

test('synthetic enabled candidate passes structural validation and grants nothing', () => {
  const result = H.validateEnabledActivationCandidate(enabled(), FUNCTIONS);
  assert.deepEqual(result, { hostingCandidateFingerprint: VECTOR_ENABLED, scope: 'structural-only',
    deployable: false, certified: false, authorized: false, available: false });
  assert.ok(Object.isFrozen(result));
});

test('enabled activation validation refusals', () => {
  const cases = [
    [enabled({ teacherUnitsAvailability: 'closed' }), FUNCTIONS, /requires an enabled Hosting candidate/],
    [enabled({ releaseIntent: 'general' }), FUNCTIONS, /teacher-units release intent/],
    [enabled({ source: { sha: SHA, dirty: true } }), FUNCTIONS, /clean source/],
    [enabled(), { sourceSha: '2'.repeat(40), placementFingerprint: PLACEMENT }, /source sha differ/],
    [enabled(), { sourceSha: SHA, placementFingerprint: 'f'.repeat(64) }, /placement differ/],
    [enabled(), { sourceSha: SHA }, /missing Functions identity field/],
    [enabled(), { ...FUNCTIONS, sourceTree: SHA }, /unknown Functions identity field/],
    [enabled(), { sourceSha: 'x', placementFingerprint: PLACEMENT }, /malformed Functions source sha/],
    [enabled(), null, /plain object/]
  ];
  for (const [candidate, functions, reason] of cases) assert.throws(() => H.validateEnabledActivationCandidate(candidate, functions), reason);
});

test('existing closed-only builder and client gate stay closed', () => {
  const builder = fs.readFileSync(path.join(ROOT, 'app/scripts/build-application.cjs'), 'utf8');
  assert.match(builder, /const CLOSED_SOURCE = 'export function teacherUnitsAvailable\(\): boolean \{ return false; \}/);
  assert.match(builder, /availability: 'closed'/);
  assert.doesNotMatch(builder, /availability: 'enabled'|hosting-identity/);
  const gate = fs.readFileSync(path.join(ROOT, 'app/src/teacherUnits/releaseAvailability.ts'), 'utf8');
  assert.match(gate, /export function teacherUnitsAvailable\(\): boolean \{ return false; \}/);
});

test('existing A1 receipt still refuses an enabled candidate', () => {
  for (const intent of ['general', 'teacher-units'])
    assert.throws(() => receipt({ phase: 'prepared', project: 'lyfelabz-staging', intent, candidate: enabled({ releaseIntent: intent }), hosting: { app: {}, marketing: {} } }),
      /enabled availability candidate evidence/);
});

test('no release, deployment, activation or Functions path consumes this module', () => {
  const consumers = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'lib', 'dist', '.git'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(c?js|ts|json|ya?ml)$/.test(entry.name)) {
        const rel = path.relative(ROOT, file);
        let text = fs.readFileSync(file, 'utf8');
        // prepare.cjs may only list this test suite in HOSTING_TEST_FILES; it never requires the module.
        if (rel === 'scripts/hosting-release/prepare.cjs') {
          const listing = "  'scripts/hosting-release/hosting-identity.test.cjs',\n";
          assert.equal(text.split(listing).length, 2, 'prepare.cjs lists the suite exactly once');
          text = text.replace(listing, '');
        }
        if (text.includes('hosting-identity')) consumers.push(rel);
      }
    }
  }
  for (const directory of ['scripts', 'app/scripts', 'app/src', 'platform', '.github']) walk(path.join(ROOT, directory));
  // D13 Part B reuses the fingerprint inside its own non-operational verifier and suite.
  assert.deepEqual(consumers.sort(), ['scripts/hosting-release/hosting-deployment.cjs', 'scripts/hosting-release/hosting-deployment.test.cjs',
    'scripts/hosting-release/hosting-identity.cjs', 'scripts/hosting-release/hosting-identity.test.cjs']);
});
