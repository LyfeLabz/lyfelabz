'use strict';

// D13 Part F: the executor runs only against an injected fake transport. Nothing here
// opens a socket, reads a credential or contacts a provider or public origin.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');

const E = require('./hosting-executor.cjs');
const { replayCapture, replayCaptureHistorical, PROVIDER_API } = require('./hosting-capture.cjs');
const { fingerprint } = require('./backend-state.cjs');
const { requestPathFor, isRedirected } = require('./contract.cjs');
const { localGzipManifest, gzipSha256 } = require('./provider-manifest.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHA = '4'.repeat(40);
const PLACEMENT = 'b'.repeat(64);
const MARKER = 'synthetic-marker:isolation-test';
const VERSIONS = { app: 'a1b2c3', marketing: 'd4e5f6' };
const BYTES = {
  app: { 'index.html': '<p>home</p>\n', 'app/dist/bundle.js': 'console.log(1);\n', 'app/index.html': '<p>app</p>\n', 'old.html': 'old\n' },
  marketing: { 'index.html': '<p>home</p>\n', 'about/index.html': '<p>about</p>\n', 'privacy.html': '<p>privacy</p>\n' }
};
const ROUTING = {
  app: { ignore: [], redirects: [{ source: '/old.html', destination: '/', type: 301 }] },
  marketing: { ignore: [], redirects: [] }
};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const buffers = t => Object.fromEntries(Object.entries(BYTES[t]).map(([p, s]) => [p, Buffer.from(s)]));

function setup() {
  const files = Object.fromEntries(['app', 'marketing'].map(t => [t, Object.fromEntries(Object.entries(buffers(t)).map(([p, b]) => [p, sha(b)]))]));
  const candidate = { releaseIntent: 'general', source: { sha: SHA, dirty: false }, hostingArtifactFingerprint: fingerprint(files),
    placementFingerprint: PLACEMENT, applicationBuildFingerprint: 'd'.repeat(64), teacherUnitsAvailability: 'closed',
    availabilityEvidence: 'build-contract-assertion' };
  const planInput = {
    project: 'lyfelabz-staging', expectedCandidateFingerprint: fingerprint(candidate), nonce: 'executor01',
    pairBuild: { kind: 'lyfelabz.hostingPairBuild', schemaVersion: 3, releaseIntent: 'general', source: { sha: SHA, dirty: false },
      unitPlacement: { fingerprint: PLACEMENT }, files },
    routing: JSON.parse(JSON.stringify(ROUTING)),
    trusted: { project: 'lyfelabz-staging', sites: { ...E.SITES }, origins: { ...E.ORIGINS } },
    assignments: ['app', 'marketing'].map(target => ({ target, site: E.SITES[target], origin: E.ORIGINS[target] }))
  };
  const localGzip = Object.fromEntries(['app', 'marketing'].map(t => [t, JSON.parse(JSON.stringify(localGzipManifest(buffers(t))))]));
  return { candidate, planInput, localGzip };
}
function channelBody(target, { release = 1, type = 'DEPLOY' } = {}) {
  return { name: `projects/lyfelabz-staging/sites/${E.SITES[target]}/channels/live`, url: E.ORIGINS[target],
    release: { name: `sites/${E.SITES[target]}/channels/live/releases/r${release}`, type, releaseTime: '2026-10-18T11:00:00.000Z', message: `release ${SHA}`,
      version: { name: `sites/${E.SITES[target]}/versions/${VERSIONS[target]}`, status: 'FINALIZED', fileCount: String(Object.keys(BYTES[target]).length) } } };
}
const json = (url, body, extra = {}) => ({ status: 200, url, redirectCount: 0, headers: { 'content-type': 'application/json; charset=UTF-8', ...extra }, body: Buffer.from(JSON.stringify(body)) });

// Fake transport: records every request it receives and answers from fixture data.
function fakeTransport(o = {}) {
  const requests = [];
  const channelReads = { app: 0, marketing: 0 };
  const edgeBytes = {};
  for (const t of ['app', 'marketing']) for (const [p, b] of Object.entries(buffers(t)))
    if (!isRedirected(requestPathFor(p), ROUTING[t])) edgeBytes[`${E.ORIGINS[t]}${requestPathFor(p)}`] = b;
  const targetOf = url => (url.includes(`/sites/${E.SITES.marketing}/`) ? 'marketing' : 'app');
  async function transport(request) {
    requests.push(request);
    if (o.intercept) { const r = await o.intercept(request); if (r) return r; }
    const u = new URL(request.url);
    if (request.surface === 'provider') {
      const t = targetOf(request.url);
      if (u.pathname.endsWith('/channels/live')) {
        channelReads[t] += 1;
        return json(request.url, o.channel ? o.channel(t, channelReads[t]) : channelBody(t));
      }
      const entries = Object.keys(BYTES[t]).sort().map(p => ({ path: `/${p}`, hash: gzipSha256(Buffer.from(BYTES[t][p])), status: 'ACTIVE' }));
      const token = u.searchParams.get('pageToken');
      if (o.files) { const r = o.files(t, token, request.url, entries); if (r) return r; }
      return token === null ? json(request.url, { files: entries.slice(0, 2), nextPageToken: `${t}/p+1` }) : json(request.url, { files: entries.slice(2) });
    }
    const b = edgeBytes[`${u.origin}${u.pathname}`];
    if (!b) return { status: 404, url: request.url, redirectCount: 0, headers: {}, body: Buffer.from('nf') };
    const headers = { etag: '"e1"', age: '12', 'cache-control': 'max-age=3600', 'x-cache': 'HIT', 'x-served-by': 'cache-synthetic-1',
      'set-cookie': 'session=secret', 'x-goog-secret': 'nope', ...(o.edgeHeaders || {}) };
    if (o.gzip && request.headers['accept-encoding'] === 'gzip') {
      const z = zlib.gzipSync(b);
      return { status: 200, url: request.url, redirectCount: 0, headers: { ...headers, 'content-encoding': 'gzip', 'content-length': String(z.length) }, body: z };
    }
    return { status: 200, url: request.url, redirectCount: 0, headers: { ...headers, 'content-length': String(b.length) }, body: b };
  }
  return { transport, requests };
}
function clockFrom(step = 5) { let t = 0; return () => (t += step); }
async function run(o = {}, executorOptions = {}, mutate) {
  const s = setup();
  if (mutate) mutate(s);
  const fake = fakeTransport(o);
  const executor = E.createExecutor({ transport: fake.transport, clock: clockFrom(o.step), wallStartMs: Date.parse('2026-10-18T12:00:00.000Z'),
    concurrency: 3, syntheticAuthorizationMarker: MARKER, ...executorOptions });
  const result = await executor.capture({ planInput: s.planInput, candidate: s.candidate, localGzip: s.localGzip });
  assertIsolation(fake.requests, result);
  return { ...s, fake, result };
}
function assertFlags(r) { for (const f of ['deployable', 'certified', 'authorized', 'available']) assert.equal(r[f], false, f); }
// Every request is GET; the marker reaches only provider requests; nothing credential-like is recorded.
function assertIsolation(requests, result) {
  for (const r of requests) {
    assert.equal(r.method, 'GET');
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.headers));
    if (r.surface === 'provider') assert.ok(r.url.startsWith(PROVIDER_API));
    else {
      assert.deepEqual(Object.keys(r.headers).sort(), ['accept', 'accept-encoding']);
      assert.ok(Object.values(E.ORIGINS).some(origin => r.url.startsWith(`${origin}/`)));
    }
    for (const value of Object.values(r.headers)) if (r.surface === 'edge') assert.doesNotMatch(value, /synthetic-marker/);
  }
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /synthetic-marker:|session=secret|x-goog-secret|set-cookie|"authorization"|"cookie"/i);
  assertFlags(result);
  assert.equal(result.provenance, 'synthetic-fixture');
  if (result.transcript) assert.equal(result.transcript.provenance.kind, 'synthetic-fixture');
}
function refused(result, stage, reason) {
  assert.equal(result.outcome, 'refused', JSON.stringify(result.refusal));
  assert.equal(result.refusal.stage, stage);
  assert.match(result.refusal.reason, reason);
  assert.equal(result.replay, null);
}

test('fake-transport capture of both staging sites replays through the unchanged Part D contract', async () => {
  const { result, fake, planInput, candidate, localGzip } = await run();
  assert.equal(result.outcome, 'replayed', JSON.stringify(result.refusal));
  assert.equal(result.liveTransport, 'not-implemented');
  assert.equal(result.capture.credentialCategory, 'synthetic-marker');
  assert.deepEqual(result.requests, { before: 2, manifest: 4, edge: 6, after: 2 });
  assert.equal(result.replay.provenance, 'synthetic-fixture');
  assert.equal(result.replay.publicEdgeBytes, 'consistent');
  assert.equal(result.replayEvaluatedAt, result.transcript.completedAt);
  assertFlags(result.replay);
  // Phase order: before, manifest pagination, edge, after.
  const ids = result.transcript.exchanges.map(e => e.id);
  assert.deepEqual(ids.slice(0, 6), ['before:app', 'before:marketing', 'files:app:0', 'files:app:1', 'files:marketing:0', 'files:marketing:1']);
  assert.deepEqual(ids.slice(-2), ['after:app', 'after:marketing']);
  // The marker went to every provider request and to no edge request.
  assert.ok(fake.requests.filter(r => r.surface === 'provider').every(r => r.headers.authorization === MARKER));
  assert.ok(fake.requests.filter(r => r.surface === 'edge').every(r => !('authorization' in r.headers) && !('cookie' in r.headers)));
  // Edge diagnostics: allowlisted headers only; raw and decoded hashes kept separately.
  const ex = result.transcript.exchanges.find(e => e.id === 'edge:app:index.html');
  assert.deepEqual(ex.response.diagnostics, { rawSha256: sha(Buffer.from(BYTES.app['index.html'])), rawLength: 12,
    decodedSha256: sha(Buffer.from(BYTES.app['index.html'])), contentEncoding: 'identity', contentLength: 12, etag: '"e1"', age: '12',
    cacheControl: 'max-age=3600', xCache: 'HIT', xServedBy: 'cache-synthetic-1', responseUrl: ex.request.url, nonce: 'executor01', redirectCount: 0 });
  // The recorded transcript replays independently, and historically, keeping its provenance.
  const strict = replayCapture({ planInput, transcript: result.transcript, candidate, localGzip, receipt: null, now: result.transcript.completedAt });
  assert.equal(strict.transcriptFingerprint, result.replay.transcriptFingerprint);
  const later = replayCaptureHistorical({ planInput, transcript: result.transcript, candidate, localGzip, receipt: null, replayedAt: '2027-01-01T00:00:00.000Z' });
  assert.equal(later.provenance, 'synthetic-fixture');
  assert.equal(later.currentNow, false);
  assert.equal(later.freshAtCertification, 'not-established');
  assertFlags(later);
});

test('gzip edge responses are decoded before hashing; raw-byte diagnostics stay separate', async () => {
  const { result } = await run({ gzip: true }, { edgeAcceptEncoding: 'gzip' });
  assert.equal(result.outcome, 'replayed', JSON.stringify(result.refusal));
  const d = result.transcript.exchanges.find(e => e.id === 'edge:marketing:about/index.html').response.diagnostics;
  assert.equal(d.contentEncoding, 'gzip');
  assert.equal(d.decodedSha256, sha(Buffer.from(BYTES.marketing['about/index.html'])));
  assert.notEqual(d.rawSha256, d.decodedSha256);
});

test('encoding failures refuse', async () => {
  refused((await run({ edgeHeaders: { 'content-encoding': 'br' } })).result, 'capture', /unsupported or unrequested Content-Encoding br/);
  refused((await run({ edgeHeaders: { 'content-encoding': 'gzip' } })).result, 'capture', /unsupported or unrequested Content-Encoding gzip/);
  refused((await run({ intercept: r => r.surface === 'edge' && { status: 200, url: r.url, redirectCount: 0, headers: { 'content-encoding': 'gzip' }, body: Buffer.from('not gzip') } },
    { edgeAcceptEncoding: 'gzip' })).result, 'capture', /undecodable or oversized gzip/);
  refused((await run({ intercept: r => r.surface === 'provider' && { ...json(r.url, {}), headers: { 'content-type': 'text/html' } } })).result, 'capture', /not application\/json/);
  refused((await run({ intercept: r => r.surface === 'provider' && json(r.url, {}, { 'content-encoding': 'gzip' }) })).result, 'capture', /provider response is encoded/);
  refused((await run({ intercept: r => r.surface === 'provider' && { ...json(r.url, {}), body: Buffer.from('{not json') } })).result, 'capture', /not JSON/);
  refused((await run({ intercept: r => r.surface === 'provider' && json(r.url, [1]) })).result, 'capture', /not a JSON object/);
});

test('a wrong decoded edge hash refuses through the unchanged Part B byte comparison', async () => {
  const wrong = r => r.surface === 'edge' && r.url.includes('/about/') && { status: 200, url: r.url, redirectCount: 0, headers: {}, body: Buffer.from('tampered') };
  refused((await run({ intercept: wrong })).result, 'replay', /served bytes differ/);
  // SPA fallback: HTTP 200 with the wrong bytes is not content identity.
  const spa = r => r.surface === 'edge' && r.url.includes('/privacy.html') && { status: 200, url: r.url, redirectCount: 0, headers: {}, body: Buffer.from(BYTES.marketing['index.html']) };
  refused((await run({ intercept: spa })).result, 'replay', /served bytes differ/);
});

test('redirects, non-200, size violations and timeouts refuse without retry', async () => {
  refused((await run({ intercept: r => r.surface === 'edge' && { status: 301, url: r.url, redirectCount: 0, headers: { location: '/' }, body: Buffer.alloc(0) } })).result, 'capture', /edge redirect refused/);
  refused((await run({ intercept: r => r.surface === 'edge' && { status: 200, url: r.url, redirectCount: 1, headers: {}, body: Buffer.alloc(0) } })).result, 'capture', /edge redirect refused/);
  // A provider request answered from an edge origin, and an edge request answered by the provider.
  refused((await run({ intercept: r => r.surface === 'provider' && { ...json(r.url, {}), url: `${E.ORIGINS.app}/` } })).result, 'capture', /provider response URL differs/);
  refused((await run({ intercept: r => r.surface === 'edge' && { status: 200, url: `${PROVIDER_API}projects/lyfelabz-staging/sites/lyfelabz-staging/channels/live`, redirectCount: 0, headers: {}, body: Buffer.alloc(0) } })).result,
    'capture', /edge response URL differs/);
  for (const [status, kind] of [[401, 'unauthenticated'], [403, 'permission-denied'], [404, 'not-found'], [429, 'rate-limited'], [500, 'server-error'], [503, 'server-error']]) {
    const { result, fake } = await run({ intercept: r => r.surface === 'provider' && { ...json(r.url, {}), status } });
    refused(result, 'capture', new RegExp(`provider HTTP ${status} \\(${kind}\\); no retry`));
    assert.equal(fake.requests.length, 1, 'no retry');
  }
  refused((await run({ intercept: r => r.surface === 'edge' && { status: 200, url: r.url, redirectCount: 0, headers: {}, body: Buffer.alloc(E.EDGE_MAX_BYTES + 1) } })).result, 'capture', /edge response exceeds/);
  refused((await run({ intercept: r => r.surface === 'provider' && { ...json(r.url, {}), body: Buffer.alloc(E.PROVIDER_MAX_BYTES + 1) } })).result, 'capture', /provider response exceeds/);
  refused((await run({ intercept: r => r.surface === 'edge' && { status: 200, url: r.url, redirectCount: 0, headers: { 'content-length': '999' }, body: Buffer.from('x') } })).result, 'capture', /Content-Length differs/);
  const { result, fake } = await run({ intercept: r => r.surface === 'edge' && new Promise(() => {}) }, { timeoutMs: 20, concurrency: 1 });
  refused(result, 'capture', /edge request timeout after 20 ms; no retry/);
  assert.equal(fake.requests.filter(r => r.surface === 'edge').length, 1);
  assert.equal(fake.requests[fake.requests.length - 1].signal.aborted, true);
  refused((await run({ intercept: () => { throw new Error('socket hang up'); } })).result, 'capture', /provider transport failure: socket hang up/);
});

test('provider pagination failures refuse', async () => {
  refused((await run({ files: (t, token, url) => json(url, { files: [], nextPageToken: 'same' }) })).result, 'capture', /pagination loop/);
  refused((await run({ files: (t, token, url) => json(url, { files: [], nextPageToken: '' }) })).result, 'capture', /malformed continuation token/);
  refused((await run({ files: (t, token, url) => json(url, { files: [], nextPageToken: 7 }) })).result, 'capture', /malformed continuation token/);
  refused((await run({ files: (t, token, url) => json(url, { files: [], nextPageToken: 'x'.repeat(2049) }) })).result, 'capture', /malformed continuation token/);
  // Incomplete manifest: the last page omits files; the unchanged Part C contract refuses.
  refused((await run({ files: (t, token, url, entries) => json(url, { files: entries.slice(0, 1) }) })).result, 'replay', /provider file count 1 is not the version fileCount 4/);
  refused((await run({ channel: t => { const b = channelBody(t); b.release.version.name = `sites/${E.SITES[t]}/versions/NOT-HEX`; return b; } })).result, 'capture', /names no valid version/);
});

test('release changes, rollbacks and origin misbinding refuse', async () => {
  refused((await run({ channel: (t, n) => channelBody(t, { release: n }) })).result, 'replay', /changed between before and after/);
  refused((await run({ channel: t => channelBody(t, { type: 'ROLLBACK' }) })).result, 'replay', /ROLLBACK is not DEPLOY/);
  await assert.rejects(run({}, {}, s => { s.planInput.assignments[0].origin = E.ORIGINS.marketing; s.planInput.assignments[1].origin = E.ORIGINS.app; }),
    /origin .* is not the trusted origin/);
  await assert.rejects(run({}, {}, s => { s.planInput.trusted.origins.app = 'https://app.lyfelabz.com'; }), /unexpected trusted app origin/);
  await assert.rejects(run({}, {}, s => { s.planInput.project = s.planInput.trusted.project = 'lyfelabz-prod'; }), /only the lyfelabz-staging project/);
  await assert.rejects(run({}, {}, s => { s.planInput.trusted.sites.marketing = 'lyfelabz-marketing'; }), /unexpected trusted marketing site/);
});

test('only planned staging GET URLs pass the request guards', () => {
  const ok = `${PROVIDER_API}projects/lyfelabz-staging/sites/lyfelabz-staging/channels/live`;
  assert.ok(E.assertProviderUrl(ok));
  assert.ok(E.assertProviderUrl(`${PROVIDER_API}projects/293337283840/sites/lyfelabz-staging-marketing/versions/abc/files?pageToken=x`));
  for (const [url, reason] of [
    [`${PROVIDER_API}projects/lyfelabz-prod/sites/lyfelabz-prod/channels/live`, /production identity refused: lyfelabz-prod/],
    [`${PROVIDER_API}projects/182791689935/sites/lyfelabz-staging/channels/live`, /production identity refused/],
    [`${PROVIDER_API}projects/lyfelabz-staging/sites/lyfelabz-marketing/channels/live`, /production identity refused: lyfelabz-marketing/],
    [`${PROVIDER_API}projects/lyfelabz%2Dprod/sites/x/channels/live`, /request URL is not canonical|production identity/],
    [`${PROVIDER_API}projects/lyfelabz-staging/sites/other-site/channels/live`, /outside the approved resources/],
    [`${PROVIDER_API}projects/lyfelabz-staging/sites/lyfelabz-staging/releases`, /outside the approved resources/],
    [`${PROVIDER_API}projects/lyfelabz-staging/sites/lyfelabz-staging/versions/abc:populateFiles`, /outside the approved resources/],
    [`${PROVIDER_API}projects/lyfelabz-staging/sites/lyfelabz-staging/channels/live?alt=media`, /outside the approved resources/],
    [`${PROVIDER_API}projects/lyfelabz-staging/sites/lyfelabz-staging/versions/abc/files?pageToken=x&key=y`, /outside the approved resources/],
    ['https://example.com/v1beta1/projects/lyfelabz-staging/sites/lyfelabz-staging/channels/live', /provider request to another host/],
    [`${E.ORIGINS.app}/`, /provider request to another host/],
    ['http://firebasehosting.googleapis.com/v1beta1/projects/lyfelabz-staging/sites/lyfelabz-staging/channels/live', /outside the staging allowlist/],
    ['https://firebasehosting.googleapis.com:8443/v1beta1/projects/lyfelabz-staging/sites/lyfelabz-staging/channels/live', /outside the staging allowlist/],
    ['https://u:p@firebasehosting.googleapis.com/v1beta1/projects/lyfelabz-staging/sites/lyfelabz-staging/channels/live', /outside the staging allowlist/]
  ]) assert.throws(() => E.assertProviderUrl(url), reason, url);
  assert.ok(E.assertEdgeUrl(`${E.ORIGINS.app}/app/?hosting-release=n0nce1`, E.ORIGINS.app, 'n0nce1'));
  for (const [url, origin, reason] of [
    ['https://app.lyfelabz.com/?hosting-release=n0nce1', 'https://app.lyfelabz.com', /production identity refused: lyfelabz.com/],
    ['https://lyfelabz-prod.web.app/?hosting-release=n0nce1', 'https://lyfelabz-prod.web.app', /production identity refused/],
    ['https://evil.web.app/?hosting-release=n0nce1', 'https://evil.web.app', /untrusted origin/],
    [`${E.ORIGINS.marketing}/?hosting-release=n0nce1`, E.ORIGINS.app, /untrusted origin/],
    [`${E.ORIGINS.app}/`, E.ORIGINS.app, /exactly the planned nonce/],
    [`${E.ORIGINS.app}/?hosting-release=n0nce1&access=1`, E.ORIGINS.app, /exactly the planned nonce/],
    [`${E.ORIGINS.app}/?hosting-release=other`, E.ORIGINS.app, /exactly the planned nonce/]
  ]) assert.throws(() => E.assertEdgeUrl(url, origin, 'n0nce1'), reason, url);
});

test('executor options: synthetic marker only, no provenance or credential option', () => {
  const base = { transport: async () => null, clock: () => 0, wallStartMs: 1, concurrency: 1 };
  for (const marker of ['Bearer ya29.abc', 'ya29.secret', 'synthetic-marker:', 'synthetic-marker:UPPER', 'synthetic-marker:a b', 7])
    assert.throws(() => E.createExecutor({ ...base, syntheticAuthorizationMarker: marker }), /only a synthetic authorization marker/);
  for (const key of ['provenance', 'live', 'trusted', 'token', 'accessToken', 'credentials', 'baseUrl', 'fetch', 'headers', 'project'])
    assert.throws(() => E.createExecutor({ ...base, [key]: 'x' }), /unknown executor option/);
  assert.throws(() => E.createExecutor({ ...base, transport: 'https://x' }), /injected transport function/);
  assert.throws(() => E.createExecutor({ ...base, clock: undefined }), /injected monotonic clock/);
  assert.throws(() => E.createExecutor({ ...base, wallStartMs: 0 }), /wall-clock start/);
  assert.throws(() => E.createExecutor({ ...base, concurrency: 17 }), /1 to 16/);
  assert.throws(() => E.createExecutor({ ...base, timeoutMs: 30001 }), /1 to 30000/);
  assert.throws(() => E.createExecutor({ ...base, edgeAcceptEncoding: 'br' }), /identity or gzip/);
  assert.deepEqual(E.PROVENANCE, { kind: 'synthetic-fixture', tool: 'hosting-executor' });
  assert.ok(Object.isFrozen(E.PROVENANCE));
  assert.equal(E.LIVE_TRANSPORT, 'not-implemented');
});

test('capture input cannot carry provenance; window and clock limits hold', async () => {
  const s = setup();
  const fake = fakeTransport();
  const ex = E.createExecutor({ transport: fake.transport, clock: clockFrom(), wallStartMs: 1, concurrency: 1 });
  await assert.rejects(ex.capture({ ...s, provenance: 'live-staging-capture' }), /unknown capture input: provenance/);
  assert.equal(fake.requests.length, 0);
  // Over five minutes stops the capture.
  refused((await run({ step: 30000 })).result, 'capture', /observation window exceeds five minutes/);
  let t = 100;
  refused((await run({}, { clock: () => (t -= 1) })).result, 'capture', /monotonic clock moved backwards/);
  // Without a marker no provider request carries an authorization header at all.
  const { fake: f2, result } = await run({}, { syntheticAuthorizationMarker: null });
  assert.equal(result.capture.credentialCategory, 'none');
  assert.ok(f2.requests.every(r => !('authorization' in r.headers)));
});

test('executor output cannot be relabelled as live or offline evidence', async () => {
  const { result, planInput, candidate, localGzip } = await run();
  for (const kind of ['live-staging-capture', 'live-capture']) {
    const transcript = JSON.parse(JSON.stringify(result.transcript));
    transcript.provenance.kind = kind;
    assert.throws(() => replayCapture({ planInput, transcript, candidate, localGzip, receipt: null, now: transcript.completedAt }),
      /cannot be asserted by a supplied transcript|unsupported transcript provenance kind/);
    assert.throws(() => replayCaptureHistorical({ planInput, transcript, candidate, localGzip, receipt: null, replayedAt: transcript.completedAt }),
      /cannot be asserted by a supplied transcript|unsupported transcript provenance kind/);
  }
  // Header diagnostics that smuggle a credential are refused on replay.
  const transcript = JSON.parse(JSON.stringify(result.transcript));
  transcript.exchanges.find(e => e.id.startsWith('edge:')).response.diagnostics.xCache = `Bearer ${'a'.repeat(8)}`;
  assert.throws(() => replayCapture({ planInput, transcript, candidate, localGzip, receipt: null, now: transcript.completedAt }), /credential-like material/);
});

test('source has no network adapter, credential, environment or subprocess access', () => {
  const source = fs.readFileSync(path.join(__dirname, 'hosting-executor.cjs'), 'utf8');
  for (const forbidden of [/require\('node:(fs|http|https|http2|net|tls|dns|child_process|os|worker_threads)'\)/, /\bfetch\b/, /process\.env/, /Date\.now/,
    /execFile|spawn|execSync/, /gcloud|tokenFromGcloud|liveAccessToken|createLiveExchange|readApi/, /GOOGLE_APPLICATION_CREDENTIALS|google-auth|googleapis'|iamcredentials|generateAccessToken|impersonat/i,
    /'offline-record'|'live-staging-capture'|'live-capture'/, /readFileSync|writeFileSync|firebase-tools|firebase deploy/, /Bearer/])
    assert.doesNotMatch(source, forbidden, String(forbidden));
  assert.deepEqual(Object.keys(E).sort(), ['EDGE_MAX_BYTES', 'LIVE_TRANSPORT', 'ORIGINS', 'PROJECT', 'PROJECT_NUMBER', 'PROVENANCE', 'PROVIDER_MAX_BYTES',
    'RESULT_KIND', 'SITES', 'assertEdgeUrl', 'assertProviderUrl', 'createExecutor']);
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
          const listing = "  'scripts/hosting-release/hosting-executor.test.cjs',\n";
          assert.equal(source.split(listing).length, 2, 'prepare.cjs lists the suite exactly once');
          source = source.replace(listing, '');
        }
        if (source.includes('hosting-executor')) consumers.push(rel);
      }
    }
  }
  for (const directory of ['scripts', 'app/scripts', 'app/src', 'platform', '.github']) walk(path.join(ROOT, directory));
  // The Part C and Part D suites name this module only in their own no-consumer allowlists.
  assert.deepEqual(consumers.sort(), ['scripts/hosting-release/hosting-capture.test.cjs', 'scripts/hosting-release/hosting-executor.cjs',
    'scripts/hosting-release/hosting-executor.test.cjs', 'scripts/hosting-release/provider-manifest.test.cjs']);
});
