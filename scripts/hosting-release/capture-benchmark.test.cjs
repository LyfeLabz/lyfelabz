'use strict';

// D13 Part E: local-only capture benchmark. Every request goes to a loopback
// fixture server started by the test; nothing contacts a provider or a public origin.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');
const { performance } = require('node:perf_hooks');

const B = require('./capture-benchmark.cjs');
const { replayCapture, PROVIDER_API } = require('./hosting-capture.cjs');
const { fingerprint } = require('./backend-state.cjs');
const { loadContract, readTargetSites, requestPathFor, isRedirected } = require('./contract.cjs');
const { localGzipManifest, gzipSha256 } = require('./provider-manifest.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHA = '2'.repeat(40);
const OLD_SHA = '3'.repeat(40);
const PLACEMENT = 'b'.repeat(64);
const VERSIONS = { app: 'a1b2c3d4e5f60001', marketing: 'a1b2c3d4e5f60002' };
const ROUTING = {
  app: { ignore: [], redirects: [{ regex: '^/legacy_.*\\.html$', destination: '/', type: 301 }] },
  marketing: { ignore: [], redirects: [{ regex: '^/lesson_.*\\.html$', destination: 'https://lyfelabz-staging.web.app/', type: 301 }] }
};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const MB = 1024 * 1024;

// Deterministic, HTML-like (compressible) bytes.
function bytesFor(name, size) {
  const unit = Buffer.from(`<section data-file="${name}"><p>LyfeLabz synthetic fixture ${sha(name).slice(0, 16)}</p></section>\n`);
  return Buffer.concat(Array(Math.ceil(size / unit.length)).fill(unit)).subarray(0, size);
}
// Staging-shaped fixture: 243 app files (7 redirected, 236 served) and 133 marketing
// files (50 redirected, 83 served), the counts of the 2026-10-17 staging certification.
function dataset({ appFiles = 243, appRedirected = 7, marketingFiles = 133, marketingRedirected = 50, totalBytes = 2 * MB } = {}) {
  const names = { app: ['index.html', 'app/index.html', 'app/dist/bundle.js', 'app/lms-callback.html'], marketing: ['index.html', 'privacy.html'] };
  for (let i = 0; i < appRedirected; i++) names.app.push(`legacy_${i}.html`);
  for (let i = 0; names.app.length < appFiles; i++) names.app.push(i % 2 ? `app/lessons/lesson_${i}.html` : `lesson_${i}.html`);
  for (let i = 0; i < marketingRedirected; i++) names.marketing.push(`lesson_${i}.html`);
  for (let i = 0; names.marketing.length < marketingFiles; i++) names.marketing.push(`blog/post_${i}/index.html`);
  const count = appFiles + marketingFiles;
  const bundle = Math.floor(totalBytes * 0.3);
  const each = Math.max(64, Math.floor((totalBytes - bundle) / (count - 1)));
  const bytes = {};
  for (const target of ['app', 'marketing']) {
    bytes[target] = {};
    for (const n of names[target]) bytes[target][n] = bytesFor(`${target}/${n}`, n === 'app/dist/bundle.js' ? bundle : each);
  }
  return bytes;
}
function hashes(bytes) {
  return Object.fromEntries(Object.entries(bytes).map(([t, m]) => [t, Object.fromEntries(Object.entries(m).map(([p, b]) => [p, sha(b)]))]));
}
function setup(bytes = dataset()) {
  const files = hashes(bytes);
  const candidate = { releaseIntent: 'general', source: { sha: SHA, dirty: false }, hostingArtifactFingerprint: fingerprint(files),
    placementFingerprint: PLACEMENT, applicationBuildFingerprint: 'd'.repeat(64), teacherUnitsAvailability: 'closed',
    availabilityEvidence: 'build-contract-assertion' };
  const planInput = {
    project: 'lyfelabz-staging', expectedCandidateFingerprint: fingerprint(candidate), nonce: 'benchmark01',
    pairBuild: { kind: 'lyfelabz.hostingPairBuild', schemaVersion: 3, releaseIntent: 'general', source: { sha: SHA, dirty: false },
      unitPlacement: { fingerprint: PLACEMENT }, files },
    routing: JSON.parse(JSON.stringify(ROUTING)),
    trusted: { project: 'lyfelabz-staging', sites: { ...B.SITES }, origins: { ...B.ORIGINS } },
    assignments: ['app', 'marketing'].map(target => ({ target, site: B.SITES[target], origin: B.ORIGINS[target] }))
  };
  const localGzip = Object.fromEntries(['app', 'marketing'].map(t => [t, JSON.parse(JSON.stringify(localGzipManifest(bytes[t])))]));
  return { bytes, candidate, planInput, localGzip };
}
function channelBody(target, { sha: s = SHA, version = VERSIONS[target], type = 'DEPLOY', fileCount, release = 1 } = {}) {
  return { name: `projects/lyfelabz-staging/sites/${B.SITES[target]}/channels/live`, url: B.ORIGINS[target], retainedReleaseCount: 10,
    release: { name: `sites/${B.SITES[target]}/channels/live/releases/r${release}`, type, releaseTime: '2026-10-18T11:00:00.000Z', message: `release ${s}`,
      version: { name: `sites/${B.SITES[target]}/versions/${version}`, status: 'FINALIZED', fileCount: String(fileCount) } } };
}
// Default scenario: stable releases, paginated manifests, edge bytes by request path.
function scenario(bytes, o = {}) {
  const pageSize = o.pageSize || 1000;
  const served = {};
  for (const t of ['app', 'marketing']) {
    served[t] = new Map();
    for (const [file, b] of Object.entries(bytes[t])) if (!isRedirected(requestPathFor(file), ROUTING[t])) served[t].set(requestPathFor(file), b);
  }
  const entries = t => Object.keys(bytes[t]).sort().map(p => ({ path: `/${p}`, hash: gzipSha256(bytes[t][p]), status: 'ACTIVE' }));
  return {
    channel: (t, n) => {
      const r = o.channel ? o.channel(t, n) : channelBody(t, { fileCount: Object.keys(bytes[t]).length });
      return typeof r.status === 'number' ? r : { status: 200, body: r };
    },
    files: (t, vid, token) => {
      if (o.files) { const r = o.files(t, vid, token); if (r) return r; }
      const all = entries(t);
      const k = token === null ? 0 : Number(/^p(\d+)$/.exec(token)?.[1] ?? NaN);
      if (vid !== VERSIONS[t] || !Number.isInteger(k)) return { status: 400, body: { error: { code: 400 } } };
      const page = { files: all.slice(k * pageSize, (k + 1) * pageSize) };
      if ((k + 1) * pageSize < all.length) page.nextPageToken = `p${k + 1}`;
      return { status: 200, body: page };
    },
    edge: (t, p, ae) => {
      if (o.edge) { const r = o.edge(t, p, ae); if (r) return r; }
      let b = served[t].get(p);
      if (!b) {
        if (!o.spaFallback) return { status: 404, body: Buffer.from('not found') };
        b = served[t].get('/');
      }
      if (o.compress && /\bgzip\b/.test(ae)) return { status: 200, headers: { 'content-encoding': 'gzip' }, body: zlib.gzipSync(b) };
      return { status: 200, body: b };
    },
    delayMs: o.delayMs, onRequest: o.onRequest
  };
}
async function run(t, { bytes, scenarioOptions = {}, mutate, concurrency = 4, ...options } = {}) {
  const s = setup(bytes);
  if (mutate) mutate(s);
  const fixture = await B.startFixtureServer(scenario(s.bytes, scenarioOptions));
  t.after(async () => {
    await fixture.close();
    assert.equal(fixture.server.listening, false);
    assert.equal(fixture.openConnections(), 0);
  });
  const result = await B.runBenchmark({ planInput: s.planInput, candidate: s.candidate, localGzip: s.localGzip, fixture, concurrency,
    wallStartMs: Date.now(), ...options });
  // Every request reached only the loopback fixture, never carried credentials.
  for (const r of fixture.requests) {
    assert.equal(r.remoteAddress, '127.0.0.1');
    assert.equal(r.localAddress, '127.0.0.1');
    assert.equal(r.method, 'GET');
    assert.equal(r.headers.authorization, undefined);
    assert.match(r.headers.host, /^127\.0\.0\.1:\d+$/);
  }
  return { ...s, fixture, result };
}
const refused = (result, stage, reason) => {
  assert.equal(result.outcome, 'refused', JSON.stringify(result.refusal));
  assert.equal(result.refusal.stage, stage);
  assert.match(result.refusal.reason, reason);
  assert.equal(result.replay, null);
  assertFlags(result);
};
function assertFlags(result) {
  for (const k of ['liveProvider', 'providerVerified', 'deploymentProvenanceEstablished', 'deployable', 'certified', 'authorized', 'available']) assert.equal(result[k], false, k);
  assert.equal(result.provenance, 'synthetic-fixture');
  assert.equal(result.transcript.provenance.kind, 'synthetic-fixture');
  assert.equal(result.timing.targetIsCertificationCondition, false);
}
// A virtual monotonic clock: each fixture request advances it by `stepMs`.
function virtualClock(stepMs) {
  const v = { skew: 0 };
  return { clock: () => performance.now() + v.skew, onRequest: () => { v.skew += stepMs; } };
}

// --- Successful captures ---------------------------------------------------------

test('staging-shaped two-site capture replays through the unchanged Part D contract', async t => {
  const { result, fixture } = await run(t);
  assert.equal(result.outcome, 'replay-consistent', JSON.stringify(result.refusal));
  assertFlags(result);
  assert.deepEqual(result.requests.byPhase, { before: 2, manifest: 2, edge: 319, after: 2 });
  assert.equal(result.requests.total, 325);
  assert.equal(fixture.requests.length, 325);
  assert.equal(result.requests.timeouts, 0);
  assert.ok(result.maxConcurrency <= 4);
  assert.equal(result.timing.classification, 'target-met');
  assert.deepEqual(Object.keys(result.timing.phasesMs), ['before', 'manifest', 'edge', 'after']);
  assert.equal(result.replay.scope, 'capture-replay-consistency');
  assert.equal(result.replay.provenance, 'synthetic-fixture');
  assert.equal(result.replay.publicEdgeBytes, 'consistent');
  assert.equal(result.replay.providerManifest, 'complete');
  assert.equal(result.replay.releaseVersionStable, true);
  assert.equal(result.replay.compressionProfileEvidence, 'missing');
  assert.equal(result.replay.receipt, 'absent');
  assert.equal(result.replay.deploymentProvenanceEstablished, false);
  for (const k of ['deployable', 'certified', 'authorized', 'available']) assert.equal(result.replay[k], false);
  // Request sequencing: provider before, manifest, edge, then after reads.
  const ids = result.transcript.exchanges.map(e => e.id);
  assert.deepEqual(ids.slice(0, 4), ['before:app', 'before:marketing', 'files:app:0', 'files:marketing:0']);
  assert.deepEqual(ids.slice(-2), ['after:app', 'after:marketing']);
  // Claimed origins are the trusted staging identities, never the loopback substitution.
  const transcript = JSON.stringify(result.transcript);
  assert.doesNotMatch(transcript, /127\.0\.0\.1|localhost|http:\/\//);
  for (const e of result.transcript.exchanges) assert.ok(e.request.url.startsWith(PROVIDER_API) || e.request.url.startsWith(B.ORIGINS.app + '/') || e.request.url.startsWith(B.ORIGINS.marketing + '/'));
  // The synthetic transcript cannot be relabelled as live evidence.
  const relabel = JSON.parse(transcript); relabel.provenance.kind = 'live-capture';
  const s = setup();
  assert.throws(() => replayCapture({ planInput: s.planInput, transcript: relabel, candidate: s.candidate, localGzip: s.localGzip, receipt: null, now: relabel.completedAt }), /live-capture/);
});

test('edge concurrency 4 and 8 at staging scale (about 41 MB): timing and byte report', async t => {
  const bytes = dataset({ totalBytes: 41 * MB });
  const report = {};
  for (const concurrency of [4, 8]) {
    const { result } = await run(t, { bytes, concurrency, scenarioOptions: { delayMs: c => (c.label === 'provider' ? 0 : 2) } });
    assert.equal(result.outcome, 'replay-consistent', JSON.stringify(result.refusal));
    assert.equal(result.maxConcurrency, concurrency);
    assert.equal(result.requests.total, 325);
    assert.ok(result.bytes.decoded > 34 * MB); // served (non-redirected) bytes of the 41 MB set
    assert.equal(result.timing.classification, 'target-met');
    report[concurrency] = { totalMs: Math.round(result.timing.totalMs), phasesMs: Object.fromEntries(Object.entries(result.timing.phasesMs).map(([k, v]) => [k, Math.round(v)])),
      wireBytes: result.bytes.wire, decodedBytes: result.bytes.decoded };
  }
  t.diagnostic(`benchmark ${JSON.stringify(report)}`);
});

test('multi-page manifests follow the token chain', async t => {
  const { result, fixture } = await run(t, { scenarioOptions: { pageSize: 50 } });
  assert.equal(result.outcome, 'replay-consistent', JSON.stringify(result.refusal));
  assert.deepEqual(result.requests.byPhase, { before: 2, manifest: 5 + 3, edge: 319, after: 2 });
  assert.ok(fixture.requests.some(r => r.query === '?pageToken=p4' && r.path.includes(B.SITES.app)));
});

test('gzip Content-Encoding is decoded before hashing; raw gzip bytes would not match', async t => {
  const { result, fixture, bytes } = await run(t, { edgeAcceptEncoding: 'gzip', scenarioOptions: { compress: true } });
  assert.equal(result.outcome, 'replay-consistent', JSON.stringify(result.refusal));
  assert.ok(result.bytes.wire < result.bytes.decoded);
  assert.ok(fixture.requests.filter(r => r.label !== 'provider').every(r => r.headers['accept-encoding'] === 'gzip'));
  assert.ok(fixture.requests.filter(r => r.label === 'provider').every(r => r.headers['accept-encoding'] === 'identity'));
  const html = bytes.app['index.html'];
  assert.notEqual(sha(zlib.gzipSync(html)), sha(html));
});

test('delayed responses still complete; timing reflects the delay', async t => {
  const { result } = await run(t, { concurrency: 8, scenarioOptions: { delayMs: () => 5 } });
  assert.equal(result.outcome, 'replay-consistent', JSON.stringify(result.refusal));
  assert.ok(result.timing.totalMs >= (6 + 319 / 8) * 5 * 0.9);
});

test('four to five minutes: target missed but within the hard limit (virtual clock)', async t => {
  const v = virtualClock(270000 / 325);
  const { result } = await run(t, { clock: v.clock, scenarioOptions: { onRequest: v.onRequest } });
  assert.equal(result.outcome, 'replay-consistent', JSON.stringify(result.refusal));
  assert.ok(result.timing.totalMs >= B.TARGET_MS && result.timing.totalMs <= 5 * 60 * 1000);
  assert.equal(result.timing.classification, 'target-missed-within-limit');
});

test('timing classification boundaries', () => {
  assert.equal(B.classifyTiming(0), 'target-met');
  assert.equal(B.classifyTiming(239999), 'target-met');
  assert.equal(B.classifyTiming(240000), 'target-missed-within-limit');
  assert.equal(B.classifyTiming(300000), 'target-missed-within-limit');
  assert.equal(B.classifyTiming(300001), 'refused-window-exceeded');
  assert.throws(() => B.classifyTiming(-1), /malformed/);
});

// --- Refusals --------------------------------------------------------------------

test('observation window over five minutes stops the capture', async t => {
  const v = virtualClock(2000);
  const { result, fixture } = await run(t, { clock: v.clock, scenarioOptions: { onRequest: v.onRequest } });
  refused(result, 'capture', /exceeds five minutes/);
  assert.equal(result.timing.classification, 'refused-window-exceeded');
  assert.ok(fixture.requests.length < 325);
});

test('repeated and missing page tokens refuse in replay', async t => {
  const repeat = await run(t, { scenarioOptions: { pageSize: 100, files: (tg, vid, token) => (tg === 'app' && token === 'p1' ? { status: 200, body: { files: [], nextPageToken: 'p1' } } : null) } });
  refused(repeat.result, 'replay', /continuation token is malformed or repeated/);
  const missing = await run(t, { scenarioOptions: { pageSize: 100, files: (tg, vid, token) => (tg === 'app' && token === null ? { status: 200, body: { files: [] } } : null) } });
  refused(missing.result, 'replay', /provider file count 0 is not the version fileCount 243/);
});

test('mid-window release change refuses', async t => {
  const { result } = await run(t, { scenarioOptions: { channel: (tg, n) => channelBody(tg, { fileCount: tg === 'app' ? 243 : 133, version: n > 0 && tg === 'app' ? 'a1b2c3d4e5f69999' : VERSIONS[tg], release: n > 0 && tg === 'app' ? 2 : 1 }) } });
  refused(result, 'replay', /releaseName changed between before and after/);
});

test('one site lagging on an older release refuses', async t => {
  const { result } = await run(t, { scenarioOptions: { channel: tg => channelBody(tg, { fileCount: tg === 'app' ? 243 : 133, sha: tg === 'marketing' ? OLD_SHA : SHA }) } });
  refused(result, 'replay', /marketing release message is not/);
});

test('ROLLBACK and SITE_DISABLE release types refuse', async t => {
  for (const type of ['ROLLBACK', 'SITE_DISABLE']) {
    const { result } = await run(t, { scenarioOptions: { channel: tg => channelBody(tg, { fileCount: tg === 'app' ? 243 : 133, type }) } });
    refused(result, 'replay', new RegExp(`release type ${type} is not DEPLOY`));
  }
});

test('a missing public-edge file refuses without retry', async t => {
  const { result, fixture } = await run(t, { scenarioOptions: { edge: (tg, p) => (tg === 'app' && p === '/app/lms-callback.html' ? { status: 404, body: Buffer.from('nf') } : null) } });
  refused(result, 'capture', /not served \(HTTP 404\)/);
  assert.equal(fixture.requests.filter(r => r.path === '/app/lms-callback.html').length, 1);
});

test('SPA fallback: HTTP 200 alone does not establish content identity', async t => {
  const { result } = await run(t, { scenarioOptions: { spaFallback: true, edge: (tg, p) => (tg === 'app' && p === '/app/lms-callback.html' ? { status: 200, body: dataset().app['index.html'] } : null) } });
  refused(result, 'replay', /served bytes differ for app\/lms-callback\.html/);
});

test('redirect responses refuse on edge and provider surfaces', async t => {
  const edge = await run(t, { scenarioOptions: { edge: (tg, p) => (p === '/privacy.html' ? { status: 301, headers: { location: 'https://example.com/' }, body: Buffer.alloc(0) } : null) } });
  refused(edge.result, 'capture', /redirect refused/);
  assert.equal(edge.fixture.requests.filter(r => r.label !== 'provider' && r.label !== 'app' && r.label !== 'marketing').length, 0);
  const provider = await run(t, { scenarioOptions: { channel: () => ({ status: 307, headers: { location: 'https://example.com/' }, body: {} }) } });
  refused(provider.result, 'capture', /redirect refused/);
});

test('provider HTTP 401, 403, 429 and 5xx refuse without retry', async t => {
  for (const [status, kind] of [[401, 'unauthenticated'], [403, 'permission-denied'], [429, 'rate-limited'], [500, 'server-error'], [503, 'server-error']]) {
    const { result, fixture } = await run(t, { scenarioOptions: { channel: (tg, n) => (tg === 'marketing' ? { status, body: { error: { code: status } } } : channelBody(tg, { fileCount: 243 })) } });
    refused(result, 'capture', new RegExp(`HTTP ${status} \\(${kind}\\); no retry`));
    assert.equal(fixture.requests.length, 2);
  }
});

test('request timeout refuses without retry', async t => {
  const { result, fixture } = await run(t, { timeoutMs: 50, scenarioOptions: { delayMs: c => (c.path === '/privacy.html' ? 400 : 0) } });
  refused(result, 'capture', /request timeout after 50 ms/);
  assert.equal(result.requests.timeouts, 1);
  assert.equal(fixture.requests.filter(r => r.path === '/privacy.html').length, 1);
});

test('incorrect byte decoding is detected', async t => {
  // Compressed bytes without a Content-Encoding label are hashed as received and mismatch.
  const unlabeled = await run(t, { edgeAcceptEncoding: 'gzip', scenarioOptions: { edge: (tg, p) => (p === '/privacy.html' ? { status: 200, body: zlib.gzipSync(dataset().marketing['privacy.html']) } : null) } });
  refused(unlabeled.result, 'replay', /served bytes differ for privacy\.html/);
  // An encoding that was not requested, or is unsupported, refuses.
  const unrequested = await run(t, { scenarioOptions: { edge: (tg, p) => (p === '/privacy.html' ? { status: 200, headers: { 'content-encoding': 'gzip' }, body: zlib.gzipSync(Buffer.from('x')) } : null) } });
  refused(unrequested.result, 'capture', /unrequested Content-Encoding gzip/);
  const brotli = await run(t, { edgeAcceptEncoding: 'gzip', scenarioOptions: { edge: (tg, p) => (p === '/privacy.html' ? { status: 200, headers: { 'content-encoding': 'br' }, body: zlib.brotliCompressSync(Buffer.from('x')) } : null) } });
  refused(brotli.result, 'capture', /Content-Encoding br/);
  const corrupt = await run(t, { edgeAcceptEncoding: 'gzip', scenarioOptions: { edge: (tg, p) => (p === '/privacy.html' ? { status: 200, headers: { 'content-encoding': 'gzip' }, body: Buffer.from('not gzip') } : null) } });
  refused(corrupt.result, 'capture', /undecodable gzip/);
});

test('missing, extra and duplicate exchanges refuse in the unchanged replay', async t => {
  const { result, planInput, candidate, localGzip } = await run(t);
  assert.equal(result.outcome, 'replay-consistent');
  const replay = mutate => {
    const transcript = JSON.parse(JSON.stringify(result.transcript)); mutate(transcript.exchanges);
    return () => replayCapture({ planInput, transcript, candidate, localGzip, receipt: null, now: transcript.completedAt });
  };
  assert.throws(replay(x => x.splice(10, 1)), /missing/);
  assert.throws(replay(x => x.splice(10, 0, JSON.parse(JSON.stringify(x[10])))), /duplicate/);
  assert.throws(replay(x => x.push(JSON.parse(JSON.stringify(x[0])))), /extra|duplicate/);
  assert.throws(replay(x => x.pop()), /missing/);
});

test('wrong origin assignment, project or site refuses before any request', async t => {
  const cases = [
    [s => { s.planInput.assignments[0].origin = B.ORIGINS.marketing; s.planInput.assignments[1].origin = B.ORIGINS.app; }, /origin|assignment|trusted/i],
    [s => { s.planInput.project = 'lyfelabz-prod'; s.planInput.trusted.project = 'lyfelabz-prod'; }, /only the lyfelabz-staging fixture project/],
    [s => { s.planInput.trusted.sites.app = 'lyfelabz-prod'; s.planInput.assignments[0].site = 'lyfelabz-prod'; }, /unexpected trusted app site/],
    [s => { s.planInput.trusted.origins.app = 'https://app.lyfelabz.com'; s.planInput.assignments[0].origin = 'https://app.lyfelabz.com'; }, /unexpected trusted app origin/]
  ];
  for (const [mutate, reason] of cases) {
    const s = setup(); mutate(s);
    const fixture = await B.startFixtureServer(scenario(s.bytes));
    try {
      await assert.rejects(B.runBenchmark({ planInput: s.planInput, candidate: s.candidate, localGzip: s.localGzip, fixture, concurrency: 4, wallStartMs: Date.now() }), reason);
      assert.equal(fixture.requests.length, 0);
    } finally { await fixture.close(); }
    assert.equal(fixture.openConnections(), 0);
  }
  // A fixture answering for another site is refused by replay.
  const { result } = await run(t, { scenarioOptions: { channel: tg => ({ ...channelBody(tg, { fileCount: tg === 'app' ? 243 : 133 }), name: 'projects/lyfelabz-staging/sites/other-site/channels/live' }) } });
  refused(result, 'replay', /live channel of site/);
});

test('external targets, credentials, base URLs and options are refused by the transport', async t => {
  const fixture = await B.startFixtureServer(scenario(setup().bytes));
  t.after(() => fixture.close());
  const tr = B.createLoopbackTransport(fixture, { timeoutMs: 1000 });
  try {
    const bad = [
      ['https://example.com/', { surface: 'edge' }, /external network target/],
      ['https://app.lyfelabz.com/', { surface: 'edge' }, /external network target/],
      ['https://lyfelabz.com/', { surface: 'edge' }, /external network target/],
      ['http://lyfelabz-staging.web.app/', { surface: 'edge' }, /outside the benchmark origins/],
      ['https://lyfelabz-staging.web.app:8443/', { surface: 'edge' }, /outside the benchmark origins/],
      ['https://user:pw@lyfelabz-staging.web.app/', { surface: 'edge' }, /outside the benchmark origins/],
      ['https://lyfelabz-staging.web.app/?access_token=abc', { surface: 'edge' }, /credential-bearing/],
      [`${PROVIDER_API}projects/lyfelabz-staging/sites/lyfelabz-staging/channels/live?key=abc`, { surface: 'provider' }, /credential-bearing/],
      ['https://lyfelabz-staging.web.app/', { surface: 'edge', headers: { authorization: 'Bearer canary' } }, /no headers or credentials/],
      ['https://lyfelabz-staging.web.app/', { surface: 'provider' }, /surface mismatch/],
      ['https://127.0.0.1/', { surface: 'edge' }, /external network target/]
    ];
    for (const [url, opts, reason] of bad) assert.throws(() => tr.get(url, opts), reason);
    assert.equal(fixture.requests.length, 0);
  } finally { tr.close(); }
  assert.throws(() => B.createLoopbackTransport({ address: () => ({ address: '0.0.0.0', port: 80 }) }), /loopback/);
  assert.throws(() => B.createLoopbackTransport({ address: () => ({ address: '10.0.0.1', port: 80 }) }), /loopback/);
  const s = setup();
  for (const extra of [{ token: 'canary' }, { baseUrl: 'https://example.com' }, { provenance: 'offline-record' }, { credentialsFile: '/tmp/x' }])
    await assert.rejects(B.runBenchmark({ planInput: s.planInput, candidate: s.candidate, localGzip: s.localGzip, fixture, concurrency: 4, wallStartMs: Date.now(), ...extra }), /unknown benchmark option/);
  await assert.rejects(B.runBenchmark({ planInput: s.planInput, candidate: s.candidate, localGzip: s.localGzip, fixture, concurrency: 0, wallStartMs: Date.now() }), /concurrency/);
  await assert.rejects(B.runBenchmark({ planInput: s.planInput, candidate: s.candidate, localGzip: s.localGzip, fixture, concurrency: 4 }), /wall-clock/);
});

test('staging fixture identities equal the trusted repository configuration', () => {
  const contract = loadContract();
  assert.deepEqual(contract.environments.staging.origins, { ...B.ORIGINS });
  assert.deepEqual(readTargetSites('lyfelabz-staging'), { ...B.SITES });
  assert.equal(B.PROJECT, 'lyfelabz-staging');
});

test('module source has no live mode, subprocess, environment or external network access', () => {
  const source = fs.readFileSync(path.join(__dirname, 'capture-benchmark.cjs'), 'utf8');
  for (const forbidden of [/child_process/, /process\.env/, /\bfetch\(/, /require\('node:https'\)/, /0\.0\.0\.0/, /gcloud auth/, /firebase deploy/,
    /tokenFromGcloud|liveAccessToken|createLiveExchange/, /['"]authorization['"]\s*:/i, /'live-capture'|'offline-record'/, /readFileSync|writeFileSync/]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /listen\(0, LOOPBACK/);
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
          const listing = "  'scripts/hosting-release/capture-benchmark.test.cjs',\n";
          assert.equal(source.split(listing).length, 2, 'prepare.cjs lists the suite exactly once');
          source = source.replace(listing, '');
        }
        if (source.includes('capture-benchmark')) consumers.push(rel);
      }
    }
  }
  for (const directory of ['scripts', 'app/scripts', 'app/src', 'platform', '.github']) walk(path.join(ROOT, directory));
  assert.deepEqual(consumers.sort(), ['scripts/hosting-release/capture-benchmark.cjs', 'scripts/hosting-release/capture-benchmark.test.cjs',
    'scripts/hosting-release/hosting-capture.test.cjs', 'scripts/hosting-release/provider-manifest.test.cjs']);
});
