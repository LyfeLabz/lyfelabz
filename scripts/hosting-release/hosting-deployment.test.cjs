'use strict';

// D13 Part B and Part C: offline Hosting deployment observation verifier (observation
// schema 2). All observations are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const D = require('./hosting-deployment.cjs');
const { hostingCandidateFingerprint } = require('./hosting-identity.cjs');
const { fingerprint } = require('./backend-state.cjs');
const { localGzipManifest, gzipSha256, PROVIDER_SOURCE } = require('./provider-manifest.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHA = '1'.repeat(40);
const PLACEMENT = 'b'.repeat(64);
const NOW = '2026-10-18T12:05:00.000Z';
const h = c => c.repeat(64);
const VERSION_APP = 'sites/lyfelabz-staging/versions/abc123';
const VERSION_MARKETING = 'projects/lyfelabz-staging/sites/lyfelabz-staging-marketing/versions/def456';

const RELEASE_APP = 'projects/lyfelabz-staging/sites/lyfelabz-staging/channels/live/releases/r-app-1';
const RELEASE_MARKETING = 'sites/lyfelabz-staging-marketing/releases/r-marketing-1';
const BYTES = {
  app: { 'index.html': '<p>home</p>\n', 'app/dist/bundle.js': 'console.log(1);\n', 'old.html': 'old\n', 'notes.md': '# notes\n', 'firebase-debug.log': 'debug\n' },
  marketing: { 'index.html': '<p>home</p>\n', 'about/index.html': '<p>about</p>\n' }
};
const UPLOADED = { app: ['app/dist/bundle.js', 'index.html', 'old.html'], marketing: ['about/index.html', 'index.html'] };
const sha = text => require('node:crypto').createHash('sha256').update(text).digest('hex');
function files() {
  const out = {};
  for (const [target, map] of Object.entries(BYTES)) out[target] = Object.fromEntries(Object.entries(map).map(([p, t]) => [p, sha(t)]));
  return out;
}
function localGzip(target) {
  return JSON.parse(JSON.stringify(localGzipManifest(Object.fromEntries(UPLOADED[target].map(p => [p, Buffer.from(BYTES[target][p])])))));
}
function candidate(overrides = {}) {
  return { releaseIntent: 'general', source: { sha: SHA, dirty: false }, hostingArtifactFingerprint: fingerprint(files()),
    placementFingerprint: PLACEMENT, applicationBuildFingerprint: h('d'), teacherUnitsAvailability: 'closed',
    availabilityEvidence: 'build-contract-assertion', ...overrides };
}
function version(target, at, overrides = {}) {
  return { observedAt: at, releaseName: target === 'app' ? RELEASE_APP : RELEASE_MARKETING, releaseType: 'DEPLOY',
    releaseTime: '2026-10-18T11:00:00.000Z', message: `release ${SHA}`, versionName: target === 'app' ? VERSION_APP : VERSION_MARKETING,
    versionStatus: 'FINALIZED', fileCount: UPLOADED[target].length, ...overrides };
}
function providerManifest(target, hashOf = p => gzipSha256(Buffer.from(BYTES[target][p]))) {
  const entries = UPLOADED[target].map(p => ({ path: `/${p}`, hash: hashOf(p), status: 'ACTIVE' }));
  return { provenance: { kind: 'synthetic-fixture', tool: 'hosting-deployment.test', source: PROVIDER_SOURCE, observedAt: '2026-10-18T12:03:30.000Z' },
    pages: [{ requestPageToken: null, response: { files: entries.slice(0, 1), nextPageToken: `${target}-page-2` } },
      { requestPageToken: `${target}-page-2`, response: { files: entries.slice(1) } }] };
}
function site(target) {
  const f = files()[target];
  const served = target === 'app' ? ['app/dist/bundle.js', 'index.html'] : ['about/index.html', 'index.html'];
  return {
    site: `projects/lyfelabz-staging/sites/${target === 'app' ? 'lyfelabz-staging' : 'lyfelabz-staging-marketing'}`,
    versionBefore: version(target, '2026-10-18T12:01:00.000Z'),
    served: { observedAt: '2026-10-18T12:02:00.000Z', files: served.map(p => ({ path: p, sha256: f[p] })) },
    versionAfter: version(target, '2026-10-18T12:03:00.000Z'),
    providerManifest: providerManifest(target),
    localGzip: localGzip(target)
  };
}
function input() {
  return {
    candidate: candidate(),
    pairBuild: { kind: 'lyfelabz.hostingPairBuild', schemaVersion: 3, releaseIntent: 'general', source: { sha: SHA, dirty: false },
      unitPlacement: { fingerprint: PLACEMENT }, files: files() },
    expected: { project: 'lyfelabz-staging', sites: { app: 'lyfelabz-staging', marketing: 'lyfelabz-staging-marketing' } },
    routing: {
      app: { ignore: ['**/*.md'], redirects: [{ source: '/old.html', destination: '/', type: 301 }] },
      marketing: { ignore: [], redirects: [{ regex: '^/legacy/.*$', destination: '/', type: 302 }] }
    },
    observation: { kind: 'lyfelabz.hostingDeploymentObservation', schemaVersion: 2, project: 'lyfelabz-staging',
      startedAt: '2026-10-18T12:00:30.000Z', completedAt: '2026-10-18T12:04:00.000Z',
      provenance: { kind: 'synthetic-fixture', tool: 'hosting-deployment.test', versionSource: 'hosting-live-channel', byteSource: 'public-edge-cache-busted-get' },
      deployCompressionProfile: localGzip('app').profile,
      sites: { app: site('app'), marketing: site('marketing') } },
    now: NOW
  };
}
function refuses(mutate, reason) {
  const i = input(); mutate(i);
  assert.throws(() => D.verifyHostingDeploymentObservation(i), reason);
}

test('valid synthetic two-site observation is consistent and grants nothing', () => {
  const i = input();
  const result = D.verifyHostingDeploymentObservation(i);
  assert.equal(result.scope, 'observation-consistency');
  assert.equal(result.hostingCandidateFingerprint, hostingCandidateFingerprint(candidate()));
  assert.equal(result.observationFingerprint, fingerprint(i.observation));
  assert.equal(result.candidateFingerprintReconstructed, true);
  assert.equal(result.localAndPublicBytesConsistent, true);
  assert.equal(result.observationSchemaVersion, 2);
  assert.equal(result.providerVersionMetadataStable, true);
  assert.equal(result.providerReleaseIdentityStable, true);
  assert.equal(result.providerFileManifest, 'complete');
  assert.equal(result.providerFileBinding, 'bound');
  assert.equal(result.servingEstablishedByManifest, false);
  assert.deepEqual(result.sites.app, { site: 'projects/lyfelabz-staging/sites/lyfelabz-staging', releaseName: RELEASE_APP, versionName: VERSION_APP,
    fileCount: 3, servedPaths: 2, uploadedPaths: 3, redirectedPaths: 1, providerFileManifest: 'complete',
    providerFileBinding: 'bound', providerFileBindingReason: null, mismatchedPaths: [] });
  for (const flag of ['deployable', 'certified', 'authorized', 'available']) assert.equal(result[flag], false);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.sites) && Object.isFrozen(result.sites.app) && Object.isFrozen(result.limitations));
  assert.ok(result.limitations.some(l => /does not establish which version is currently served/.test(l)));
  assert.doesNotMatch(JSON.stringify(result), /"(certified|verified)"\s*:\s*true|provider-backed-certified/);
});

test('deterministic result and candidate fingerprint reconstruction', () => {
  const a = D.verifyHostingDeploymentObservation(input());
  const b = D.verifyHostingDeploymentObservation(input());
  assert.deepEqual(a, b);
  refuses(i => { i.candidate.hostingArtifactFingerprint = h('a'); }, /do not reproduce the candidate Hosting artifact fingerprint/);
  refuses(i => { i.pairBuild.files.marketing['extra.html'] = h('7'); }, /do not reproduce/);
});

test('schema 1 (Part B) observations are refused, never reinterpreted', () => {
  refuses(i => { i.observation.schemaVersion = 1; }, /schema 1 \(D13 Part B\) is superseded/);
  refuses(i => { i.observation.schemaVersion = 3; }, /unsupported observation kind or schema/);
  refuses(i => { const o = i.observation.sites.app; o.providerFiles = null; delete o.providerManifest; delete o.localGzip; }, /unknown observation.sites.app field: providerFiles/);
  refuses(i => { delete i.observation.deployCompressionProfile; }, /missing observation field: deployCompressionProfile/);
});

test('binding outcomes: mismatch and unreproducible are reported, never bound', () => {
  // Provider hashes equal to the raw SHA-256 (not the gzip SHA-256) are a reproducible mismatch.
  const raw = input(); raw.observation.sites.marketing.providerManifest = providerManifest('marketing', p => files().marketing[p]);
  const r = D.verifyHostingDeploymentObservation(raw);
  assert.equal(r.providerFileBinding, 'mismatch');
  assert.deepEqual(r.sites.marketing.mismatchedPaths, ['/about/index.html', '/index.html']);
  assert.equal(r.sites.app.providerFileBinding, 'bound');
  for (const flag of ['deployable', 'certified', 'authorized', 'available']) assert.equal(r[flag], false);
  const none = input(); none.observation.deployCompressionProfile = null;
  const u = D.verifyHostingDeploymentObservation(none);
  assert.equal(u.providerFileBinding, 'unreproducible');
  assert.equal(u.sites.app.providerFileBindingReason, 'deploy compression profile was not recorded');
  const os = input(); os.observation.deployCompressionProfile.header.os = os.observation.deployCompressionProfile.header.os === 19 ? 3 : 19;
  assert.equal(D.verifyHostingDeploymentObservation(os).providerFileBinding, 'unreproducible');
  const both = input(); both.observation.deployCompressionProfile = null;
  both.observation.sites.marketing.providerManifest = providerManifest('marketing', p => files().marketing[p]);
  assert.equal(D.verifyHostingDeploymentObservation(both).providerFileBinding, 'unreproducible');
});

test('provider-uploaded files are validated separately from public-edge served files', () => {
  // The redirected old.html is uploaded (in the manifest) but not served.
  const r = D.verifyHostingDeploymentObservation(input());
  assert.equal(r.sites.app.uploadedPaths, 3); assert.equal(r.sites.app.servedPaths, 2);
  const UP = UPLOADED.app;
  refuses(i => { i.observation.sites.app.providerManifest.pages[1].response.files = i.observation.sites.app.providerManifest.pages[1].response.files.filter(f => f.path !== '/old.html');
    i.observation.sites.app.versionBefore.fileCount = i.observation.sites.app.versionAfter.fileCount = 2; }, /provider manifest missing: \/old.html/);
  refuses(i => { i.observation.sites.app.providerManifest.pages[1].response.files.push({ path: '/notes.md', hash: h('e'), status: 'ACTIVE' });
    i.observation.sites.app.versionBefore.fileCount = i.observation.sites.app.versionAfter.fileCount = 4; }, /provider manifest unexpected: \/notes.md/);
  assert.deepEqual(UP, ['app/dist/bundle.js', 'index.html', 'old.html']);
});

test('site representation and identity', () => {
  refuses(i => { delete i.observation.sites.marketing; }, /missing observation.sites field: marketing/);
  refuses(i => { i.observation.sites.preview = site('app'); }, /unknown observation.sites field: preview/);
  refuses(i => { i.observation.sites.app.site = 'projects/lyfelabz-staging/sites/lyfelabz-prod'; }, /not the expected site/);
  refuses(i => { i.observation.sites.app.site = 'projects/lyfelabz-prod/sites/lyfelabz-staging'; }, /not the expected site/);
  refuses(i => { i.expected.sites.marketing = 'lyfelabz-staging'; }, /must differ/);
  refuses(i => { i.expected.project = 'other'; }, /unsupported expected project/);
  refuses(i => { i.observation.project = 'lyfelabz-prod'; }, /observation project differs/);
  refuses(i => { i.observation.sites.app.versionBefore.versionName = 'sites/lyfelabz-prod/versions/abc123'; }, /another site or project/);
  refuses(i => { i.observation.sites.marketing.versionBefore.versionName = 'projects/lyfelabz-prod/sites/lyfelabz-staging-marketing/versions/def456'; }, /another site or project/);
  const number = input(); number.observation.sites.app.site = 'projects/293337283840/sites/lyfelabz-staging';
  assert.equal(D.verifyHostingDeploymentObservation(number).project, 'lyfelabz-staging');
});

test('version stability, status and release message', () => {
  refuses(i => { i.observation.sites.app.versionAfter.versionName = 'sites/lyfelabz-staging/versions/abc124'; }, /versionName changed/);
  refuses(i => { i.observation.sites.marketing.versionAfter.releaseTime = '2026-10-18T11:30:00.000Z'; }, /releaseTime changed/);
  refuses(i => { i.observation.sites.app.versionAfter.message = 'release other'; }, /message changed/);
  refuses(i => { i.observation.sites.app.versionAfter.releaseName = 'sites/lyfelabz-staging/releases/r-app-2'; }, /releaseName changed/);
  refuses(i => { i.observation.sites.marketing.versionAfter.fileCount = 3; }, /fileCount changed/);
  for (const type of ['ROLLBACK', 'SITE_DISABLE', 'TYPE_UNSPECIFIED', 'deploy'])
    refuses(i => { for (const k of ['versionBefore', 'versionAfter']) i.observation.sites.app[k].releaseType = type; }, new RegExp(`release type ${type} is not DEPLOY`));
  refuses(i => { i.observation.sites.app.versionAfter.releaseType = 'ROLLBACK'; }, /release type ROLLBACK is not DEPLOY/);
  refuses(i => { delete i.observation.sites.app.versionBefore.releaseName; }, /missing app versionBefore field: releaseName/);
  refuses(i => { for (const k of ['versionBefore', 'versionAfter']) i.observation.sites.app[k].releaseName = 'sites/lyfelabz-staging/channels/preview/releases/r1'; }, /malformed app versionBefore release name/);
  refuses(i => { for (const k of ['versionBefore', 'versionAfter']) i.observation.sites.app[k].releaseName = 'sites/lyfelabz-prod/releases/r1'; }, /release belongs to another site/);
  refuses(i => { for (const k of ['versionBefore', 'versionAfter']) i.observation.sites.app[k].releaseName = 'projects/lyfelabz-prod/sites/lyfelabz-staging/releases/r1'; }, /release belongs to another site or project/);
  refuses(i => { for (const k of ['versionBefore', 'versionAfter']) i.observation.sites.app[k].fileCount = -1; }, /malformed app versionBefore file count/);
  for (const status of ['CREATED', 'DELETED', 'finalized', 'ABANDONED'])
    refuses(i => { i.observation.sites.app.versionBefore.versionStatus = status; i.observation.sites.app.versionAfter.versionStatus = status; }, /is not FINALIZED/);
  for (const message of [`release ${SHA} uncommitted`, `release ${'2'.repeat(40)}`, ''])
    refuses(i => { for (const t of ['app', 'marketing']) { i.observation.sites[t].versionBefore.message = message; i.observation.sites[t].versionAfter.message = message; } }, /release message is not/);
  refuses(i => { i.observation.sites.app.versionBefore.message = null; }, /malformed app versionBefore release message/);
  refuses(i => { i.observation.sites.app.versionBefore.releaseTime = '2026-10-18T12:01:30.000Z'; i.observation.sites.app.versionAfter.releaseTime = '2026-10-18T12:01:30.000Z'; }, /release time is after/);
  refuses(i => { i.observation.sites.app.versionBefore.versionName = 'sites/lyfelabz-staging/versions/ABC'; }, /malformed app versionBefore version name/);
});

test('observation ordering: version is observed before and after byte verification', () => {
  refuses(i => { i.observation.sites.app.versionAfter.observedAt = '2026-10-18T12:01:30.000Z'; }, /out of order/);
  refuses(i => { i.observation.sites.app.versionBefore.observedAt = '2026-10-18T12:02:30.000Z'; }, /out of order/);
  refuses(i => { i.observation.sites.app.versionBefore.observedAt = '2026-10-18T12:00:00.000Z'; }, /out of order/);
});

test('served-path coverage and hashes', () => {
  refuses(i => { i.observation.sites.app.served.files.pop(); }, /served files missing: index.html/);
  refuses(i => { i.observation.sites.marketing.served.files.push({ path: 'extra.html', sha256: h('7') }); }, /served files unexpected: extra.html/);
  refuses(i => { i.observation.sites.app.served.files.push({ path: 'notes.md', sha256: h('4') }); }, /unexpected: notes.md/);
  refuses(i => { i.observation.sites.app.served.files.push({ path: 'firebase-debug.log', sha256: h('5') }); }, /unexpected: firebase-debug.log/);
  refuses(i => { i.observation.sites.app.served.files.push({ path: 'index.html', sha256: h('1') }); }, /duplicate app served files path/);
  refuses(i => { i.observation.sites.app.served.files[0].sha256 = h('9'); }, /served bytes differ for app\/dist\/bundle.js/);
  refuses(i => { i.observation.sites.app.served.files.push({ path: 'old.html', sha256: h('3') }); }, /include redirected path: old.html/);
  for (const bad of ['/index.html', 'a//b', '../x', 'a/./b', 'a\\b', ''])
    refuses(i => { i.observation.sites.app.served.files.push({ path: bad, sha256: h('1') }); }, /malformed app served files/);
});

test('source, placement and intent consistency', () => {
  refuses(i => { i.pairBuild.source.sha = '2'.repeat(40); }, /pair-build and candidate source differ/);
  refuses(i => { i.pairBuild.unitPlacement.fingerprint = h('f'); }, /placement differ/);
  refuses(i => { i.pairBuild.releaseIntent = 'teacher-units'; }, /release intent differ/);
  refuses(i => { i.candidate.source.dirty = true; i.pairBuild.source.dirty = true; }, /clean source/);
  refuses(i => { i.pairBuild.kind = 'lyfelabz.hostingCertifiedRelease'; }, /unsupported pair-build/);
  refuses(i => { i.pairBuild.schemaVersion = 2; }, /unsupported pair-build/);
});

test('freshness and future timestamps', () => {
  refuses(i => { i.now = '2026-10-18T12:05:30.001Z'; }, /stale observation/);
  const edge = input(); edge.now = '2026-10-18T12:05:30.000Z';
  assert.equal(D.verifyHostingDeploymentObservation(edge).scope, 'observation-consistency');
  refuses(i => { i.now = '2026-10-18T12:03:59.999Z'; }, /future observation timestamp/);
  refuses(i => { i.observation.startedAt = '2026-10-18T12:04:30.000Z'; }, /starts after it completes/);
  refuses(i => { i.observation.completedAt = '2026-10-18T12:03:00.000Z'; }, /out of order|outside/);
  refuses(i => { i.now = '2026-10-18 12:05:00'; }, /malformed now timestamp/);
  refuses(i => { i.observation.sites.app.served.observedAt = 'yesterday'; }, /malformed app served timestamp/);
  refuses(i => { i.now = '2026-13-40T12:05:00.000Z'; }, /malformed now timestamp/);
  assert.equal(D.MAX_OBSERVATION_AGE_MS, 5 * 60 * 1000);
  assert.equal(D.CLOCK_SKEW_MS, 0);
});

test('provenance', () => {
  refuses(i => { delete i.observation.provenance; }, /missing observation field: provenance/);
  refuses(i => { i.observation.provenance = null; }, /provenance must be a plain object/);
  refuses(i => { i.observation.provenance.kind = 'live-capture'; }, /unsupported provenance kind/);
  // D13 Part F: the reserved live kind is never accepted from a supplied observation record.
  refuses(i => { i.observation.provenance.kind = 'live-staging-capture'; }, /unsupported provenance kind/);
  refuses(i => { i.observation.provenance.kind = 'live-staging-capture'; i.observation.sites.app.providerManifest.provenance.kind = 'live-staging-capture';
    i.observation.sites.marketing.providerManifest.provenance.kind = 'live-staging-capture'; }, /unsupported provenance kind/);
  refuses(i => { i.observation.provenance.tool = ''; }, /malformed provenance tool/);
  refuses(i => { i.observation.provenance.versionSource = 'operator'; }, /version source/);
  refuses(i => { i.observation.provenance.byteSource = 'cdn-cache'; }, /byte source/);
  refuses(i => { i.observation.provenance.signedBy = 'x'; }, /unknown observation.provenance field/);
});

test('provider manifest evidence is complete, ACTIVE and bound to this version and window', () => {
  const pages = i => i.observation.sites.app.providerManifest.pages;
  refuses(i => { pages(i).pop(); }, /last page has a continuation token/);
  refuses(i => { pages(i).shift(); }, /does not continue the previous page/);
  refuses(i => { pages(i)[1].response.files.push({ path: '/index.html', hash: h('e'), status: 'ACTIVE' }); }, /duplicate provider path/);
  refuses(i => { pages(i)[0].response.files[0].status = 'EXPECTED'; }, /is not ACTIVE/);
  refuses(i => { pages(i)[0].response.files[0].path = 'app/dist/bundle.js'; }, /malformed pages\[0\].response.files\[0\].path/);
  refuses(i => { pages(i)[0].response.files[0].hash = 'E'.repeat(64); }, /malformed pages\[0\].response.files\[0\].hash/);
  refuses(i => { for (const k of ['versionBefore', 'versionAfter']) i.observation.sites.app[k].fileCount = 4; }, /file count 3 is not the version fileCount 4/);
  refuses(i => { i.observation.sites.app.providerManifest.provenance.observedAt = '2026-10-18T12:04:30.000Z'; }, /outside the observation window/);
  refuses(i => { i.observation.sites.app.providerManifest.provenance.kind = 'offline-record'; }, /provenance differs from the observation provenance/);
  refuses(i => { i.observation.sites.app.providerManifest.extra = 1; }, /unknown app providerManifest field/);
  refuses(i => { i.observation.sites.app.providerManifest = null; }, /providerManifest must be a plain object/);
});

test('local gzip evidence must be for the pair-build bytes', () => {
  refuses(i => { i.observation.sites.app.localGzip.files['/index.html'].sha256 = h('9'); }, /not for the pair-build bytes of index.html/);
  refuses(i => { i.observation.sites.app.localGzip.files['/missing.html'] = { sha256: h('9'), gzipSha256: h('9') }; }, /outside the pair build: \/missing.html/);
  refuses(i => { delete i.observation.sites.app.localGzip.files['/old.html']; }, /local gzip evidence missing: \/old.html/);
  refuses(i => { i.observation.sites.marketing.localGzip.profile.node = 'other'; }, /local compression profiles differ between sites/);
  refuses(i => { delete i.observation.sites.app.localGzip; }, /missing observation.sites.app field: localGzip/);
});

test('routing rules are validated', () => {
  refuses(i => { i.routing.app.redirects[0].type = 307; }, /unsupported routing.app.redirects\[0\].type/);
  refuses(i => { i.routing.app.redirects[0].headers = []; }, /unknown routing.app.redirects\[0\] field/);
  refuses(i => { i.routing.marketing.rewrites = []; }, /unknown routing.marketing field: rewrites/);
  refuses(i => { i.routing.app.ignore = '**/*.md'; }, /must be an array/);
});

test('unknown keys, getters, symbols and unsupported values are refused', () => {
  refuses(i => { i.extra = true; }, /unknown input field: extra/);
  refuses(i => { i.observation.signature = 'x'; }, /unknown observation field/);
  refuses(i => { i.observation.sites.app.versionBefore.channel = 'live'; }, /unknown app versionBefore field/);
  refuses(i => { i.observation.sites.app.served.files[0].size = 1; }, /unknown app served files\[0\] field/);
  refuses(i => { i.candidate.teacherUnitsAvailability = 'open'; }, /unsupported Teacher Units availability/);
  refuses(i => { i.observation.schemaVersion = '1'; }, /unsupported observation kind or schema/);
  refuses(i => { Object.defineProperty(i.observation, 'project', { enumerable: true, get: () => 'lyfelabz-staging' }); }, /enumerable data field/);
  refuses(i => { Object.defineProperty(i.observation.sites.app.served.files, 0, { enumerable: true, get: () => ({}) }); }, /enumerable data field/);
  refuses(i => { i.observation.sites.app.served.files.extra = 1; }, /non-index properties/);
  refuses(i => { i.observation[Symbol('x')] = 1; }, /symbol keys/);
  refuses(i => { i.pairBuild.files.app = Object.assign(Object.create(null), files().app); }, /plain object/);
  refuses(i => { i.pairBuild.files.app['index.html'] = 1; }, /malformed pair-build app hash/);
  refuses(i => { i.observation.sites.app.served.files[0].sha256 = undefined; }, /missing app served files\[0\] field/);
  for (const value of [null, 'x', [], 1]) assert.throws(() => D.verifyHostingDeploymentObservation(value), /plain object/);
});

test('module is pure: no network, filesystem, process or clock access', () => {
  const source = fs.readFileSync(path.join(__dirname, 'hosting-deployment.cjs'), 'utf8');
  assert.doesNotMatch(source, /fetch\(|require\('node:(fs|http|https|net|child_process)'\)|process\.env|Date\.now\(|new Date\(/);
});

test('existing closed-only builder and client gate stay closed', () => {
  const builder = fs.readFileSync(path.join(ROOT, 'app/scripts/build-application.cjs'), 'utf8');
  assert.match(builder, /availability: 'closed'/);
  assert.doesNotMatch(builder, /availability: 'enabled'|hosting-deployment/);
  const gate = fs.readFileSync(path.join(ROOT, 'app/src/teacherUnits/releaseAvailability.ts'), 'utf8');
  assert.match(gate, /export function teacherUnitsAvailable\(\): boolean \{ return false; \}/);
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
          const listing = "  'scripts/hosting-release/hosting-deployment.test.cjs',\n";
          assert.equal(text.split(listing).length, 2, 'prepare.cjs lists the suite exactly once');
          text = text.replace(listing, '');
        }
        if (text.includes('hosting-deployment')) consumers.push(rel);
      }
    }
  }
  for (const directory of ['scripts', 'app/scripts', 'app/src', 'platform', '.github']) walk(path.join(ROOT, directory));
  // The Part A and Part C suites name this module only in their own no-consumer allowlists.
  // The D13 Part D replay is the only consumer, and it is itself unconsumed.
  assert.deepEqual(consumers.sort(), ['scripts/hosting-release/hosting-capture.cjs', 'scripts/hosting-release/hosting-capture.test.cjs',
    'scripts/hosting-release/hosting-deployment.cjs', 'scripts/hosting-release/hosting-deployment.test.cjs',
    'scripts/hosting-release/hosting-identity.test.cjs', 'scripts/hosting-release/provider-manifest.test.cjs']);
});
