'use strict';

// D13 Part D: offline capture planner and recorded-response replay. All exchanges
// are synthetic; nothing here contacts a provider or a public origin.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const C = require('./hosting-capture.cjs');
const { fingerprint } = require('./backend-state.cjs');
const { localGzipManifest, gzipSha256 } = require('./provider-manifest.cjs');

const ROOT = path.resolve(__dirname, '../..');
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const SHA = '1'.repeat(40);
const PLACEMENT = 'b'.repeat(64);
const NOW = '2026-10-18T12:05:00.000Z';
const SITES = { app: 'lyfelabz-staging', marketing: 'lyfelabz-staging-marketing' };
const ORIGINS = { app: 'https://lyfelabz-staging.web.app', marketing: 'https://lyfelabz-staging-marketing.web.app' };
const VERSIONS = { app: 'abc123', marketing: 'def456' };
const BYTES = {
  app: { 'index.html': '<p>home</p>\n', 'app/dist/bundle.js': 'console.log(1);\n', 'old.html': 'old\n', 'notes.md': '# notes\n' },
  marketing: { 'index.html': '<p>home</p>\n', 'about/index.html': '<p>about</p>\n' }
};
const UPLOADED = { app: ['app/dist/bundle.js', 'index.html', 'old.html'], marketing: ['about/index.html', 'index.html'] };
const SERVED = { app: ['app/dist/bundle.js', 'index.html'], marketing: ['about/index.html', 'index.html'] };
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const at = s => `2026-10-18T12:0${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.000Z`;

function files() {
  return Object.fromEntries(Object.entries(BYTES).map(([target, map]) => [target, Object.fromEntries(Object.entries(map).map(([p, t]) => [p, sha(t)]))]));
}
function candidate() {
  return { releaseIntent: 'general', source: { sha: SHA, dirty: false }, hostingArtifactFingerprint: fingerprint(files()),
    placementFingerprint: PLACEMENT, applicationBuildFingerprint: 'd'.repeat(64), teacherUnitsAvailability: 'closed',
    availabilityEvidence: 'build-contract-assertion' };
}
function planInput() {
  return {
    project: 'lyfelabz-staging', expectedCandidateFingerprint: fingerprint(candidate()), nonce: 'synthetic01',
    pairBuild: { kind: 'lyfelabz.hostingPairBuild', schemaVersion: 3, releaseIntent: 'general', source: { sha: SHA, dirty: false },
      unitPlacement: { fingerprint: PLACEMENT }, files: files() },
    routing: {
      app: { ignore: ['**/*.md'], redirects: [{ source: '/old.html', destination: '/', type: 301 }] },
      marketing: { ignore: [], redirects: [{ regex: '^/legacy/.*$', destination: '/', type: 302 }] }
    },
    trusted: { project: 'lyfelabz-staging', sites: { ...SITES }, origins: { ...ORIGINS } },
    assignments: [{ target: 'app', site: SITES.app, origin: ORIGINS.app }, { target: 'marketing', site: SITES.marketing, origin: ORIGINS.marketing }]
  };
}
function localGzip() {
  return Object.fromEntries(['app', 'marketing'].map(target => [target,
    JSON.parse(JSON.stringify(localGzipManifest(Object.fromEntries(UPLOADED[target].map(p => [p, Buffer.from(BYTES[target][p])])))))]));
}
function channel(target, overrides = {}) {
  return { name: `projects/lyfelabz-staging/sites/${SITES[target]}/channels/live`, url: ORIGINS[target], retainedReleaseCount: 10,
    release: { name: `sites/${SITES[target]}/channels/live/releases/r-${target}-1`, type: 'DEPLOY', releaseTime: '2026-10-18T11:00:00.000Z',
      message: `release ${SHA}`, version: { name: `sites/${SITES[target]}/versions/${VERSIONS[target]}`, status: 'FINALIZED',
        fileCount: String(UPLOADED[target].length) } }, ...overrides };
}
function providerEx(id, url, s, body) { return { id, observedAt: at(s), request: { method: 'GET', url }, response: { status: 200, body } }; }
function exchanges() {
  const out = [];
  let s = 31;
  for (const target of ['app', 'marketing']) out.push(providerEx(`before:${target}`, `${API}projects/lyfelabz-staging/sites/${SITES[target]}/channels/live`, s++, channel(target)));
  for (const target of ['app', 'marketing']) {
    const entries = UPLOADED[target].map(p => ({ path: `/${p}`, hash: gzipSha256(Buffer.from(BYTES[target][p])), status: 'ACTIVE' }));
    const base = `${API}projects/lyfelabz-staging/sites/${SITES[target]}/versions/${VERSIONS[target]}/files`;
    out.push(providerEx(`files:${target}:0`, base, s++, { files: entries.slice(0, 1), nextPageToken: `${target}/page+2` }));
    out.push(providerEx(`files:${target}:1`, `${base}?pageToken=${encodeURIComponent(`${target}/page+2`)}`, s++, { files: entries.slice(1) }));
  }
  for (const target of ['app', 'marketing']) for (const file of SERVED[target]) {
    const url = `${ORIGINS[target]}${file === 'index.html' ? '/' : file.endsWith('/index.html') ? `/${file.slice(0, -10)}` : `/${file}`}?hosting-release=synthetic01`;
    out.push({ id: `edge:${target}:${file}`, observedAt: at(s++), request: { method: 'GET', url }, response: { status: 200, url, sha256: sha(BYTES[target][file]) } });
  }
  for (const target of ['app', 'marketing']) out.push(providerEx(`after:${target}`, `${API}projects/lyfelabz-staging/sites/${SITES[target]}/channels/live`, s++, channel(target)));
  return out;
}
function receipt(phase) {
  const profile = JSON.parse(JSON.stringify(localGzip().app.profile));
  return { kind: 'lyfelabz.hostingDeployReceipt', schemaVersion: 1, phase, invocationId: 'deploy-0001-synthetic',
    recordedAt: phase === 'pre' ? '2026-10-18T11:58:00.000Z' : '2026-10-18T12:00:00.000Z',
    source: { sha: SHA, dirty: false }, hostingCandidateFingerprint: fingerprint(candidate()), project: 'lyfelabz-staging',
    sites: { ...SITES }, firebaseCli: { version: '15.22.4', executable: '/opt/synthetic/bin/firebase' }, node: { executable: '/opt/synthetic/bin/node' },
    compressionProfile: profile, hashCache: phase === 'pre' ? { present: false, digest: null } : { present: true, digest: 'e'.repeat(64) },
    provenance: { kind: 'synthetic-fixture', tool: 'hosting-capture.test', supplier: 'operator' } };
}
function input() {
  const pi = planInput();
  return { planInput: pi, candidate: candidate(), localGzip: localGzip(), receipt: { pre: receipt('pre'), post: receipt('post') }, now: NOW,
    transcript: { kind: 'lyfelabz.hostingCaptureTranscript', schemaVersion: 1, planFingerprint: fingerprint(C.planCapture(pi)),
      provenance: { kind: 'synthetic-fixture', tool: 'hosting-capture.test' }, startedAt: at(30), completedAt: at(240), exchanges: exchanges() } };
}
const find = (i, id) => i.transcript.exchanges.find(e => e.id === id);
function refuses(mutate, reason) {
  const i = input(); mutate(i);
  assert.throws(() => C.replayCapture(i), reason);
}
function planRefuses(mutate, reason) {
  const i = planInput(); mutate(i);
  assert.throws(() => C.planCapture(i), reason);
}

// --- Planner -------------------------------------------------------------------

test('deterministic, frozen two-site plan separates provider API from public origins', () => {
  const plan = C.planCapture(planInput());
  assert.deepEqual(C.planCapture(planInput()), plan);
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.requests.edge[0]) && Object.isFrozen(plan.window.inside));
  assert.equal(plan.project, 'lyfelabz-staging');
  assert.equal(plan.projectNumber, '293337283840');
  assert.equal(plan.expectedCandidateFingerprint, fingerprint(candidate()));
  assert.equal(plan.sourceSha, SHA);
  assert.equal(plan.releaseMessage, `release ${SHA}`);
  assert.deepEqual(plan.sites.app, { site: SITES.app, siteResource: `projects/lyfelabz-staging/sites/${SITES.app}`, origin: ORIGINS.app });
  assert.deepEqual(plan.requests.before.map(r => r.id), ['before:app', 'before:marketing']);
  assert.deepEqual(plan.requests.after.map(r => r.id), ['after:app', 'after:marketing']);
  assert.deepEqual(plan.requests.manifest.map(r => r.pagination.firstPageToken), [null, null]);
  assert.deepEqual(plan.requests.edge.map(r => r.url), [
    'https://lyfelabz-staging.web.app/app/dist/bundle.js?hosting-release=synthetic01', 'https://lyfelabz-staging.web.app/?hosting-release=synthetic01',
    'https://lyfelabz-staging-marketing.web.app/about/?hosting-release=synthetic01', 'https://lyfelabz-staging-marketing.web.app/?hosting-release=synthetic01']);
  const all = [...plan.requests.before, ...plan.requests.manifest, ...plan.requests.edge, ...plan.requests.after];
  for (const r of all) assert.equal(r.method, 'GET');
  for (const r of [...plan.requests.before, ...plan.requests.manifest, ...plan.requests.after]) {
    assert.equal(r.surface, 'provider-api');
    assert.ok((r.url || r.urlTemplate).startsWith(API));
    assert.ok(plan.providerApi.resources.includes(r.resource));
  }
  for (const r of plan.requests.edge) { assert.equal(r.surface, 'public-origin'); assert.ok(r.url.startsWith(r.origin + '/')); }
  assert.deepEqual(plan.providerApi.methods, ['GET']);
  assert.equal(plan.window.maxDurationMs, 5 * 60 * 1000);
  assert.ok(plan.window.outside.includes('catalog navigation'));
  assert.doesNotMatch(JSON.stringify(plan), /"(POST|PUT|PATCH|DELETE)"|:populateFiles|:clone|releases\?|\btoken\b.*Bearer/);
});

test('origin-to-site mapping must equal the trusted configuration exactly', () => {
  planRefuses(i => { i.project = 'lyfelabz-dev'; }, /unsupported project/);
  planRefuses(i => { i.trusted.project = 'lyfelabz-prod'; }, /trusted configuration names another project/);
  planRefuses(i => { i.assignments[0].site = 'lyfelabz-prod'; }, /unexpected site lyfelabz-prod/);
  planRefuses(i => { i.assignments[0].origin = ORIGINS.marketing; }, /duplicate origin assignment/);
  planRefuses(i => { i.assignments[1].site = SITES.app; }, /duplicate site assignment/);
  planRefuses(i => { i.assignments[1].target = 'app'; }, /duplicate target assignment/);
  planRefuses(i => { i.assignments[0].origin = 'https://evil.example.com'; }, /not the trusted origin for app/);
  planRefuses(i => { i.assignments[0].target = 'admin'; }, /unexpected target/);
  planRefuses(i => { i.assignments.pop(); }, /exactly the app and marketing targets/);
  planRefuses(i => { i.trusted.origins.marketing = ORIGINS.app; }, /ambiguous trusted configuration: one origin/);
  planRefuses(i => { i.trusted.sites.marketing = SITES.app; }, /ambiguous trusted configuration: one site/);
  for (const origin of ['http://lyfelabz-staging.web.app', 'https://lyfelabz-staging.web.app/', 'https://lyfelabz-staging.web.app:443',
    'https://user@lyfelabz-staging.web.app', 'https://lyfelabz-staging.web.app/x', 'https://LYFELABZ-staging.web.app', 'https://localhost'])
    planRefuses(i => { i.assignments[0].origin = origin; i.trusted.origins.app = origin; }, /malformed/);
});

test('planner refuses dirty, unsupported or malformed planning inputs', () => {
  planRefuses(i => { i.pairBuild.source.dirty = true; }, /clean source/);
  planRefuses(i => { i.pairBuild.schemaVersion = 2; }, /unsupported pair-build/);
  planRefuses(i => { i.nonce = 'X'; }, /nonce/);
  planRefuses(i => { i.expectedCandidateFingerprint = 'nope'; }, /expected Hosting candidate fingerprint/);
  planRefuses(i => { i.extra = 1; }, /unknown plan input field: extra/);
});

test('module has no network executor, credential, environment, clock or filesystem access', () => {
  for (const file of ['hosting-capture.cjs', 'deploy-receipt.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const forbidden of [/require\('node:(fs|http|https|net|tls|dns|child_process|os)'\)/, /\bfetch\(/, /process\.env/, /Date\.now\(/,
      /new Date\(/, /execFile|spawn/, /gcloud|access_token|Authorization/, /require\('\.\/release\.cjs'\)\.(liveRelease|runFirebaseJson)/])
      assert.doesNotMatch(source, forbidden, `${file} ${forbidden}`);
  }
  assert.deepEqual(Object.keys(C).sort(), ['DIAGNOSTIC_HEADERS', 'EDGE_DIAGNOSTIC_FIELDS', 'HISTORICAL_SCOPE', 'MAX_WINDOW_MS', 'PLAN_KIND', 'PROVIDER_API',
    'RESERVED_LIVE_PROVENANCE', 'SCOPE', 'TRANSCRIPT_KIND', 'planCapture', 'replayCapture', 'replayCaptureHistorical']);
});

// --- Replay --------------------------------------------------------------------

test('valid multi-page synthetic replay is consistent and grants nothing', () => {
  const result = C.replayCapture(input());
  assert.deepEqual(C.replayCapture(input()), result);
  assert.equal(result.scope, 'capture-replay-consistency');
  assert.equal(result.planValid, true);
  assert.equal(result.transcriptComplete, true);
  assert.equal(result.originToSite, 'consistent');
  assert.equal(result.providerManifest, 'complete');
  assert.equal(result.localGzipBinding, 'bound');
  assert.equal(result.publicEdgeBytes, 'consistent');
  assert.equal(result.publicEdgeObservation, 'single-observation');
  assert.equal(result.releaseVersionStable, true);
  assert.equal(result.receipt, 'consistent');
  assert.equal(result.hashCachePolicy, 'satisfied');
  assert.equal(result.compressionProfileEvidence, 'compatible');
  assert.deepEqual(result.selfCalibration, { app: 'consistent-with-local-profile', marketing: 'consistent-with-local-profile' });
  assert.equal(result.servingEstablishedByManifest, false);
  assert.equal(result.deploymentProvenanceEstablished, false);
  assert.equal(result.provenance, 'synthetic-fixture');
  assert.equal(result.hostingCandidateFingerprint, fingerprint(candidate()));
  assert.equal(result.sites.app.origin, ORIGINS.app);
  assert.equal(result.sites.marketing.providerFileBinding, 'bound');
  for (const flag of ['deployable', 'certified', 'authorized', 'available']) assert.equal(result[flag], false);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.sites.app));
  assert.ok(result.limitations.some(l => /does not prove global CDN consistency/.test(l)));
  assert.doesNotMatch(JSON.stringify(result), /"(certified|authorized|deployable|available)"\s*:\s*true|live-provider"/);
});

test('missing, extra, duplicated and reordered exchanges refuse', () => {
  refuses(i => { i.transcript.exchanges.splice(0, 1); }, /exchange before:marketing is not the planned before:app/);
  refuses(i => { i.transcript.exchanges.pop(); }, /missing exchange: after:marketing/);
  refuses(i => { const e = i.transcript.exchanges; e.push({ ...e[e.length - 1], id: 'after:extra' }); }, /extra exchange after the plan: after:extra/);
  refuses(i => { const e = i.transcript.exchanges; const k = e.findIndex(x => x.id === 'edge:app:index.html'); e.splice(k, 0, { ...e[k] }); }, /duplicate exchange: edge:app:index.html/);
  refuses(i => { const e = i.transcript.exchanges; [e[0], e[1]] = [e[1], e[0]]; }, /not the planned before:app/);
  refuses(i => { const e = i.transcript.exchanges; const k = e.findIndex(x => x.id === 'edge:marketing:index.html'); e.splice(k, 1); }, /missing edge exchanges: edge:marketing:index.html/);
  refuses(i => { find(i, 'edge:app:index.html').id = 'edge:app:secret.html'; }, /unexpected edge exchange/);
  refuses(i => { find(i, 'before:app').request.method = 'POST'; }, /only GET is permitted/);
  refuses(i => { i.transcript.planFingerprint = 'f'.repeat(64); }, /another plan/);
  refuses(i => { i.transcript.provenance.kind = 'live-capture'; }, /no live-capture kind is authorized/);
});

test('incomplete or malformed provider pagination refuses', () => {
  refuses(i => { i.transcript.exchanges.splice(i.transcript.exchanges.findIndex(x => x.id === 'files:app:1'), 1); }, /not the planned files:app:1/);
  refuses(i => { find(i, 'files:app:1').response.body.nextPageToken = 'app/page+2'; }, /continuation token is malformed or repeated/);
  refuses(i => { find(i, 'files:app:1').request.url += 'x'; }, /files:app:1 request is not the planned provider request/);
  refuses(i => { find(i, 'files:app:1').response.body.files[0].status = 'EXPECTED'; }, /is not ACTIVE/);
  refuses(i => { find(i, 'files:app:1').response.body.files.pop(); }, /provider file count 2 is not the version fileCount 3/);
  refuses(i => { find(i, 'files:app:0').response.status = 403; }, /HTTP 403/);
});

test('mid-window release change, rollback, disable and lagging site refuse', () => {
  refuses(i => { find(i, 'after:app').response.body.release.name = `sites/${SITES.app}/channels/live/releases/r-app-2`; }, /app releaseName changed/);
  refuses(i => { find(i, 'after:marketing').response.body.release.version.name = `sites/${SITES.marketing}/versions/fff999`; }, /marketing versionName changed/);
  for (const type of ['ROLLBACK', 'SITE_DISABLE'])
    refuses(i => { for (const id of ['before:app', 'after:app']) find(i, id).response.body.release.type = type; }, new RegExp(`release type ${type} is not DEPLOY`));
  refuses(i => { for (const id of ['before:marketing', 'after:marketing']) find(i, id).response.body.release.message = `release ${'2'.repeat(40)}`; }, /marketing release message is not/);
  refuses(i => { find(i, 'before:app').response.body.name = `projects/lyfelabz-prod/sites/${SITES.app}/channels/live`; }, /not the live channel of site/);
  refuses(i => { find(i, 'before:app').response.body.name = `sites/${SITES.app}/channels/preview`; }, /not the live channel/);
});

test('stale, future, out-of-order and over-long windows refuse', () => {
  refuses(i => { i.now = '2026-10-18T12:06:00.000Z'; }, /stale observation; older than five minutes/);
  refuses(i => { i.now = '2026-10-18T12:03:00.000Z'; }, /future observation timestamp/);
  refuses(i => { i.transcript.startedAt = '2026-10-18T11:58:00.000Z'; i.now = '2026-10-18T12:04:00.000Z'; }, /exceeds five minutes/);
  refuses(i => { find(i, 'after:marketing').observedAt = at(250); }, /outside the observation window/);
  refuses(i => { find(i, 'before:marketing').observedAt = at(30); find(i, 'before:app').observedAt = at(40); }, /out of time order/);
  refuses(i => { i.transcript.completedAt = at(20); }, /starts after it completes/);
});

test('public-edge bytes, SPA fallback and origin assignment are enforced', () => {
  refuses(i => { find(i, 'edge:app:app/dist/bundle.js').response.sha256 = 'a'.repeat(64); }, /app served bytes differ for app\/dist\/bundle.js/);
  // A fallback rewrite answers 200 with the homepage bytes for a missing asset.
  refuses(i => { find(i, 'edge:app:app/dist/bundle.js').response.sha256 = sha(BYTES.app['index.html']); }, /served bytes differ/);
  refuses(i => { find(i, 'edge:app:index.html').response.status = 404; }, /not served \(HTTP 404\)/);
  refuses(i => { const e = find(i, 'edge:marketing:index.html'); e.request.url = e.response.url = `${ORIGINS.app}/?hosting-release=synthetic01`; }, /planned origin, path and cache-busting nonce/);
  refuses(i => { find(i, 'edge:marketing:about/index.html').response.url = `${ORIGINS.marketing}/about/index.html`; }, /redirect followed/);
  refuses(i => { i.planInput.assignments[1].origin = ORIGINS.app; }, /duplicate origin assignment/);
});

test('compression evidence: compatible, incompatible and missing are distinct', () => {
  const missing = input(); missing.receipt = null;
  const m = C.replayCapture(missing);
  assert.equal(m.compressionProfileEvidence, 'missing');
  assert.equal(m.localGzipBinding, 'unreproducible');
  assert.equal(m.receipt, 'absent');
  assert.equal(m.hashCachePolicy, 'unknown');
  // Self-calibration corroborates but never overrides missing provenance.
  assert.deepEqual(m.selfCalibration, { app: 'consistent-with-local-profile', marketing: 'consistent-with-local-profile' });
  const incompatible = input();
  for (const r of [incompatible.receipt.pre, incompatible.receipt.post]) r.compressionProfile.header.os = r.compressionProfile.header.os === 19 ? 3 : 19;
  const x = C.replayCapture(incompatible);
  assert.equal(x.compressionProfileEvidence, 'incompatible');
  assert.equal(x.localGzipBinding, 'unreproducible');
  assert.equal(x.sites.app.providerFileBindingReason, 'gzip header os differs');
  for (const r of [m, x]) for (const flag of ['deployable', 'certified', 'authorized', 'available']) assert.equal(r[flag], false);
});

test('receipt policy and identity are enforced through the receipt validator', () => {
  const cached = input(); cached.receipt.pre.hashCache = { present: true, digest: 'a'.repeat(64) };
  assert.equal(C.replayCapture(cached).hashCachePolicy, 'violated');
  refuses(i => { i.receipt.post.source.sha = '2'.repeat(40); }, /source differs between pre and post/);
  refuses(i => { i.receipt.post.invocationId = 'deploy-0002-synthetic'; }, /different deployment invocations/);
  refuses(i => { i.receipt.post.recordedAt = at(40); }, /must precede the observation window/);
  refuses(i => { for (const r of [i.receipt.pre, i.receipt.post]) r.sites.app = 'lyfelabz-prod'; }, /other sites/);
});

test('local gzip evidence and candidate identity are checked by the Part B/C contracts', () => {
  refuses(i => { i.localGzip.app.files['/index.html'].sha256 = 'a'.repeat(64); }, /not for the pair-build bytes/);
  refuses(i => { i.candidate.applicationBuildFingerprint = 'e'.repeat(64); }, /candidate fingerprint is not the planned Hosting candidate/);
  refuses(i => { i.receipt = null; i.candidate.source.dirty = true; }, /clean source/);
});

// --- D13 Part F: reserved live provenance, edge diagnostics, historical replay ----

function withDiagnostics(i, overrides = {}) {
  for (const ex of i.transcript.exchanges.filter(e => e.id.startsWith('edge:'))) {
    const file = ex.id.split(':').slice(2).join(':');
    const length = Buffer.byteLength(BYTES[ex.id.split(':')[1]][file]);
    ex.response.diagnostics = { rawSha256: ex.response.sha256, rawLength: length, decodedSha256: ex.response.sha256, contentEncoding: 'identity',
      contentLength: length, etag: '"abc"', age: '0', cacheControl: 'max-age=3600', xCache: 'MISS', xServedBy: 'cache-synthetic-1',
      responseUrl: ex.request.url, nonce: 'synthetic01', redirectCount: 0, ...overrides };
  }
  return i;
}

test('live-staging-capture provenance cannot be asserted by a supplied transcript', () => {
  assert.equal(C.RESERVED_LIVE_PROVENANCE, 'live-staging-capture');
  for (const from of ['synthetic-fixture', 'offline-record']) {
    const i = input(); i.transcript.provenance.kind = from;
    assert.equal(C.replayCapture(i).provenance, from);
  }
  refuses(i => { i.transcript.provenance.kind = 'live-staging-capture'; }, /cannot be asserted by a supplied transcript/);
  refuses(i => { i.transcript.provenance.kind = 'live-capture'; }, /unsupported transcript provenance kind/);
  refuses(i => { i.transcript.provenance.trusted = true; }, /unknown transcript\.provenance field: trusted/);
  refuses(i => { i.transcript.live = true; }, /unknown transcript field: live/);
});

test('optional edge diagnostics are validated and never override byte verification', () => {
  const plain = C.replayCapture(input());
  const diag = C.replayCapture(withDiagnostics(input()));
  // A transcript without diagnostics replays exactly as before; diagnostics add no authority.
  assert.equal(diag.publicEdgeBytes, plain.publicEdgeBytes);
  assert.equal(diag.certified, false);
  assert.equal(C.replayCapture(withDiagnostics(input(), { etag: null, age: null, cacheControl: null, xCache: null, xServedBy: null, contentLength: null })).scope, C.SCOPE);
  const bad = (overrides, reason, mutate) => assert.throws(() => { const i = withDiagnostics(input(), overrides); if (mutate) mutate(i); C.replayCapture(i); }, reason);
  bad({ decodedSha256: 'f'.repeat(64) }, /decoded hash differs from the recorded served hash/);
  bad({ rawSha256: 'f'.repeat(64) }, /identity encoding with differing raw and decoded bytes/);
  bad({ contentEncoding: 'br' }, /unsupported .* contentEncoding/);
  bad({ contentLength: 1 }, /contentLength differs from the raw length/);
  bad({ redirectCount: 1 }, /record a redirect/);
  bad({ nonce: 'other01' }, /nonce is not the planned nonce/);
  bad({ responseUrl: 'https://lyfelabz-staging.web.app/elsewhere' }, /response URL is not the planned request/);
  bad({ authorization: 'x' }, /unknown edge:.* diagnostics field: authorization/);
  bad({ setCookie: 'x' }, /unknown edge:.* diagnostics field: setCookie/);
  bad({ xServedBy: 'Bearer abc' }, /credential-like material/);
  bad({ etag: 'synthetic-marker:abc' }, /credential-like material/);
  bad({ age: 'x\n' }, /malformed .* diagnostics age/);
  // Consistent diagnostics cannot rescue a wrong served hash: Part B still compares bytes.
  bad({}, /served bytes differ/, i => {
    const ex = find(i, 'edge:app:index.html');
    ex.response.sha256 = ex.response.diagnostics.rawSha256 = ex.response.diagnostics.decodedSha256 = 'e'.repeat(64);
  });
});

test('historical replay keeps provenance, never renews freshness and never certifies', () => {
  const base = () => { const i = input(); delete i.now; return i; };
  const recent = C.replayCaptureHistorical({ ...base(), replayedAt: '2026-10-18T12:04:30.000Z' });
  assert.equal(recent.historical, true);
  assert.equal(recent.scope, C.HISTORICAL_SCOPE);
  assert.deepEqual(recent.evaluation, { mode: 'historical', evaluatedAt: at(240), replayedAt: '2026-10-18T12:04:30.000Z' });
  assert.equal(recent.windowWithinLimit, true);
  assert.equal(recent.internallyConsistent, true);
  assert.equal(recent.currentNow, true);
  assert.equal(recent.provenance, 'synthetic-fixture');
  const old = C.replayCaptureHistorical({ ...base(), replayedAt: '2027-01-01T00:00:00.000Z' });
  assert.equal(old.currentNow, false);
  assert.equal(old.internallyConsistent, true);
  for (const r of [recent, old]) {
    assert.equal(r.freshAtCertification, 'not-established');
    assert.equal(r.certificationTime, null);
    assert.equal(r.renewsFreshness, false);
    for (const flag of ['deployable', 'certified', 'authorized', 'available']) { assert.equal(r[flag], false); assert.equal(r.consistency[flag], false); }
    assert.ok(Object.isFrozen(r));
  }
  const offline = base(); offline.transcript.provenance.kind = 'offline-record';
  assert.equal(C.replayCaptureHistorical({ ...offline, replayedAt: '2027-01-01T00:00:00.000Z' }).provenance, 'offline-record');
  // The strict replay of the same old transcript still refuses: history renews nothing.
  assert.throws(() => C.replayCapture({ ...base(), now: '2027-01-01T00:00:00.000Z' }), /stale observation/);
  const hist = (mutate, reason) => { const i = { ...base(), replayedAt: '2027-01-01T00:00:00.000Z' }; mutate(i); assert.throws(() => C.replayCaptureHistorical(i), reason); };
  hist(i => { i.replayedAt = at(100); }, /replay time precedes the capture completion/);
  hist(i => { i.now = NOW; }, /unknown historical replay input field: now/);
  hist(i => { i.certificationTime = NOW; }, /unknown historical replay input field: certificationTime/);
  hist(i => { i.transcript.completedAt = '2026-10-18T12:06:00.000Z'; }, /observation window exceeds five minutes/);
  hist(i => { i.transcript.provenance.kind = 'live-staging-capture'; }, /cannot be asserted by a supplied transcript/);
  hist(i => { find(i, 'after:app').response.body.release.name = `sites/${SITES.app}/channels/live/releases/r-app-2`; }, /changed between before and after/);
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
          const listing = "  'scripts/hosting-release/hosting-capture.test.cjs',\n";
          assert.equal(source.split(listing).length, 2, 'prepare.cjs lists the suite exactly once');
          source = source.replace(listing, '');
        }
        if (source.includes('hosting-capture')) consumers.push(rel);
      }
    }
  }
  for (const directory of ['scripts', 'app/scripts', 'app/src', 'platform', '.github']) walk(path.join(ROOT, directory));
  // The Part B, Part C and receipt suites name this module only in their own no-consumer allowlists.
  // The D13 Part E local benchmark drives the planner and replay; it is itself unconsumed.
  // The D13 Part F executor drives the planner and replay over an injected transport; it is itself unconsumed.
  assert.deepEqual(consumers.sort(), ['scripts/hosting-release/capture-benchmark.cjs', 'scripts/hosting-release/capture-benchmark.test.cjs',
    'scripts/hosting-release/deploy-receipt.test.cjs', 'scripts/hosting-release/hosting-capture.cjs', 'scripts/hosting-release/hosting-capture.test.cjs',
    'scripts/hosting-release/hosting-deployment.test.cjs', 'scripts/hosting-release/hosting-executor.cjs', 'scripts/hosting-release/hosting-executor.test.cjs',
    'scripts/hosting-release/provider-manifest.test.cjs']);
});
