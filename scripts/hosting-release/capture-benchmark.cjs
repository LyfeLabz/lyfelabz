'use strict';

// D13 Part E: local-only capture benchmark. Non-operational. Nothing in a release,
// deployment or activation path requires this module. It drives the unchanged D13
// Part D planner and replay (`planCapture`, `replayCapture`) through a loopback
// fixture server so request sequencing, pagination, response decoding, transcript
// construction, replay compatibility and local timing can be measured offline.
//
// There is no live-provider mode. The only network peer is a fixture server this
// module starts on 127.0.0.1 with an ephemeral port. The logical plan keeps the
// trusted staging identities (Firebase Hosting API origin, both staging origins);
// the transport maps exactly those three logical origins onto the loopback server
// and refuses every other host. It never accepts a base URL, token, credential
// file, project other than lyfelabz-staging, or production origin; it never sends
// an Authorization header, never follows redirects, never reads proxy settings
// (an explicit non-proxy agent per run) and starts no subprocess.
//
// Evidence is always `synthetic-fixture` (the existing Part D kind): the benchmark
// exposes no provenance option, so a substituted local transport cannot emit a
// transcript labelled as an offline record or a live observation.
//
// Timing (owner decisions): the existing five-minute window is the hard limit
// (the runner stops, and the unchanged replay refuses, beyond it); four minutes is
// a performance target reported as `target-met` or `target-missed-within-limit`,
// never a certification condition. Elapsed time uses a monotonic clock; evidence
// timestamps are the explicit wall-clock start plus monotonic elapsed time, so they
// never move backwards.
//
// Encoding: provider reads request `identity`. Public-edge reads request the
// configured `Accept-Encoding` (`identity` or `gzip`); a `gzip` response is decoded
// before hashing, a missing or `identity` encoding is hashed as received, and any
// other encoding refuses. Edge SHA-256 is always over decoded bytes. This is HTTP
// response encoding only; Part C's provider-upload gzip hash semantics are untouched.
//
// A benchmark result is never live-provider, IAM, CDN, deployment-provenance or
// certification evidence; every authority flag is false.
const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { performance } = require('node:perf_hooks');

const { planCapture, replayCapture, MAX_WINDOW_MS, PROVIDER_API, TRANSCRIPT_KIND } = require('./hosting-capture.cjs');
const { fingerprint } = require('./backend-state.cjs');
const { TARGETS } = require('./contract.cjs');

const RESULT_KIND = 'lyfelabz.hostingCaptureBenchmark';
const PROJECT = 'lyfelabz-staging';
const SITES = Object.freeze({ app: 'lyfelabz-staging', marketing: 'lyfelabz-staging-marketing' });
const ORIGINS = Object.freeze({ app: 'https://lyfelabz-staging.web.app', marketing: 'https://lyfelabz-staging-marketing.web.app' });
const PROVIDER_ORIGIN = new URL(PROVIDER_API).origin;
const LOOPBACK = '127.0.0.1';
const TARGET_MS = 4 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_PAGES = 1000;
const CONCURRENCY = Object.freeze([1, 16]);
const ENCODINGS = Object.freeze(['identity', 'gzip']);
const CREDENTIAL_QUERY = /^(access_token|key|token|api_key|apikey|oauth_token|bearer)$/i;
const ESTABLISHES = Object.freeze(['capture-plan completeness', 'local transport behavior', 'request sequencing',
  'response decoding', 'transcript consistency', 'replay compatibility', 'local timing characteristics']);
const DOES_NOT_ESTABLISH = Object.freeze(['live Firebase availability', 'real provider IAM access', 'real CDN consistency',
  'provider or CDN latency', 'actual deployment provenance', 'operational certification', 'deployment authorization',
  'Teacher Units availability']);

function refuse(message) { throw new Error(`[capture-benchmark] REFUSED: ${message}`); }
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function classifyTiming(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) refuse('malformed elapsed time');
  if (elapsedMs > MAX_WINDOW_MS) return 'refused-window-exceeded';
  return elapsedMs < TARGET_MS ? 'target-met' : 'target-missed-within-limit';
}

// --- Loopback fixture server ---------------------------------------------------
// scenario { channel(target, readIndex), files(target, versionId, token), edge(target, requestPath, acceptEncoding),
//            delayMs?(ctx), onRequest?(ctx) }; each handler returns { status, headers?, body: Buffer | object }.
async function startFixtureServer(scenario) {
  const requests = [];
  const sockets = new Set();
  const channelReads = { app: 0, marketing: 0 };
  const server = http.createServer(async (req, res) => {
    const label = req.headers['x-benchmark-origin'];
    const u = new URL(req.url, `http://${LOOPBACK}`);
    const ctx = { label, method: req.method, path: u.pathname, query: u.search, headers: { ...req.headers },
      remoteAddress: req.socket.remoteAddress, localAddress: req.socket.localAddress, index: requests.length };
    requests.push(ctx);
    scenario.onRequest?.(ctx);
    const delay = scenario.delayMs?.(ctx) || 0;
    if (delay) await new Promise(r => setTimeout(r, delay));
    let spec;
    try { spec = respond(scenario, ctx, u, channelReads); } catch (error) { spec = { status: 500, body: { error: { message: String(error.message) } } }; }
    if (res.destroyed) return;
    const body = Buffer.isBuffer(spec.body) ? spec.body : Buffer.from(JSON.stringify(spec.body ?? {}));
    res.writeHead(spec.status, { 'content-length': body.length, ...(spec.headers || {}) });
    res.end(body);
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, LOOPBACK, resolve); });
  const address = server.address();
  if (address.address !== LOOPBACK) refuse('fixture server is not bound to loopback');
  return Object.freeze({
    server, requests, address: () => server.address(), openConnections: () => sockets.size,
    close: async () => {
      await new Promise(resolve => { server.close(() => resolve()); for (const s of sockets) s.destroy(); });
      for (let i = 0; sockets.size && i < 100; i++) await new Promise(r => setImmediate(r));
    }
  });
}

function respond(scenario, ctx, u, channelReads) {
  if (ctx.method !== 'GET') return { status: 405, body: { error: { code: 405 } } };
  if (ctx.label === 'provider') {
    let m = /^\/v1beta1\/projects\/([^/]+)\/sites\/([^/]+)\/channels\/live$/.exec(u.pathname);
    const target = m && m[1] === PROJECT ? TARGETS.find(t => SITES[t] === m[2]) : undefined;
    if (m) return target ? scenario.channel(target, channelReads[target]++) : { status: 404, body: { error: { code: 404, status: 'NOT_FOUND' } } };
    m = /^\/v1beta1\/projects\/([^/]+)\/sites\/([^/]+)\/versions\/([^/]+)\/files$/.exec(u.pathname);
    const ftarget = m && m[1] === PROJECT ? TARGETS.find(t => SITES[t] === m[2]) : undefined;
    if (ftarget) return scenario.files(ftarget, m[3], u.searchParams.get('pageToken'));
    return { status: 404, body: { error: { code: 404, status: 'NOT_FOUND' } } };
  }
  if (TARGETS.includes(ctx.label)) return scenario.edge(ctx.label, u.pathname, String(ctx.headers['accept-encoding'] || ''));
  return { status: 421, body: { error: { code: 421 } } };
}

// --- Loopback transport ----------------------------------------------------------
// Maps exactly the three planned logical origins to the fixture server. Takes the
// fixture object, never a host, port or base URL.
function createLoopbackTransport(fixture, { timeoutMs = DEFAULT_TIMEOUT_MS, edgeAcceptEncoding = 'identity', maxSockets = CONCURRENCY[1] } = {}) {
  const address = fixture?.address?.();
  if (!address || address.address !== LOOPBACK || !Number.isInteger(address.port)) refuse('transport requires a loopback fixture server');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) refuse('timeout must be 1 to 30000 ms');
  if (!ENCODINGS.includes(edgeAcceptEncoding)) refuse('edge Accept-Encoding must be identity or gzip');
  if (!Number.isInteger(maxSockets) || maxSockets < CONCURRENCY[0] || maxSockets > CONCURRENCY[1]) refuse('maxSockets must be 1 to 16');
  const labels = new Map([[PROVIDER_ORIGIN, 'provider'], [ORIGINS.app, 'app'], [ORIGINS.marketing, 'marketing']]);
  // An explicit per-run agent: it reads no proxy environment (only Node's global agents
  // consult it) and reuses at most `maxSockets` loopback connections, destroyed by close().
  const agent = new http.Agent({ keepAlive: true, maxSockets });
  let inFlight = 0;
  const stats = { maxInFlight: 0, wireBytes: 0, decodedBytes: 0, requests: 0, timeouts: 0 };

  function get(url, options) {
    const keys = Object.keys(options || {});
    if (keys.length !== 1 || keys[0] !== 'surface' || !['provider', 'edge'].includes(options.surface)) refuse('transport accepts only a provider or edge surface (no headers or credentials)');
    let u;
    try { u = new URL(url); } catch { refuse('malformed request URL'); }
    if (u.href !== url) refuse('request URL is not canonical');
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) refuse(`request outside the benchmark origins: ${u.protocol}//${u.host}`);
    const label = labels.get(u.origin);
    if (!label) refuse(`external network target refused: ${u.host}`);
    if ((label === 'provider') !== (options.surface === 'provider')) refuse(`surface mismatch for ${u.host}`);
    for (const key of u.searchParams.keys()) if (CREDENTIAL_QUERY.test(key)) refuse(`credential-bearing request refused: ${key}`);
    const acceptEncoding = label === 'provider' ? 'identity' : edgeAcceptEncoding;
    stats.requests += 1;
    inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, value) => { if (settled) return; settled = true; inFlight -= 1; fn(value); };
      const req = http.request({ host: LOOPBACK, family: 4, port: address.port, method: 'GET', path: `${u.pathname}${u.search}`, agent,
        headers: { host: `${LOOPBACK}:${address.port}`, 'accept-encoding': acceptEncoding, 'x-benchmark-origin': label } }, res => {
        const chunks = []; let size = 0;
        res.on('data', c => { size += c.length; if (size > MAX_BODY_BYTES) req.destroy(new Error('oversized response')); else chunks.push(c); });
        res.on('error', e => done(reject, e));
        res.on('end', () => {
          try {
            if (res.statusCode >= 300 && res.statusCode < 400) refuse(`redirect refused: ${u.host}${u.pathname} (HTTP ${res.statusCode})`);
            const wire = Buffer.concat(chunks, size);
            stats.wireBytes += wire.length;
            const encoding = String(res.headers['content-encoding'] || 'identity').trim().toLowerCase();
            let body;
            if (encoding === 'identity') body = wire;
            else if (encoding === 'gzip' && acceptEncoding === 'gzip') {
              try { body = zlib.gunzipSync(wire); } catch { refuse(`undecodable gzip response: ${u.host}${u.pathname}`); }
            } else refuse(`unsupported or unrequested Content-Encoding ${encoding}: ${u.host}${u.pathname}`);
            stats.decodedBytes += body.length;
            done(resolve, { status: res.statusCode, encoding, wireBytes: wire.length, body });
          } catch (error) { done(reject, error); }
        });
      });
      req.setTimeout(timeoutMs, () => { stats.timeouts += 1; req.destroy(new Error(`request timeout after ${timeoutMs} ms: ${u.host}${u.pathname}`)); });
      req.on('error', e => done(reject, /^\[capture-benchmark\]/.test(e.message) ? e : new Error(`[capture-benchmark] REFUSED: ${e.message}`)));
      req.end();
    });
  }
  return Object.freeze({ get, stats, close: () => agent.destroy() });
}

// --- Runner ----------------------------------------------------------------------

function assertStagingFixture(planInput) {
  if (planInput?.project !== PROJECT || planInput?.trusted?.project !== PROJECT) refuse('the benchmark accepts only the lyfelabz-staging fixture project');
  for (const target of TARGETS) {
    if (planInput.trusted?.sites?.[target] !== SITES[target]) refuse(`unexpected trusted ${target} site`);
    if (planInput.trusted?.origins?.[target] !== ORIGINS[target]) refuse(`unexpected trusted ${target} origin`);
  }
}

function providerBody(response, id) {
  if (response.status !== 200) {
    const kind = { 401: 'unauthenticated', 403: 'permission-denied', 404: 'not-found', 429: 'rate-limited' }[response.status] || (response.status >= 500 ? 'server-error' : 'http-error');
    refuse(`${id} provider response is HTTP ${response.status} (${kind}); no retry`);
  }
  try { return JSON.parse(response.body.toString('utf8')); } catch { refuse(`${id} provider response is not JSON`); }
}

// runBenchmark({ planInput, candidate, localGzip, fixture, concurrency, timeoutMs?, edgeAcceptEncoding?,
//                clock? (monotonic ms), wallStartMs (explicit wall-clock start) })
async function runBenchmark(input) {
  const allowed = ['planInput', 'candidate', 'localGzip', 'fixture', 'concurrency', 'timeoutMs', 'edgeAcceptEncoding', 'clock', 'wallStartMs'];
  for (const key of Object.keys(input || {})) if (!allowed.includes(key)) refuse(`unknown benchmark option: ${key}`);
  const { planInput, candidate, localGzip, fixture, concurrency, timeoutMs = DEFAULT_TIMEOUT_MS, edgeAcceptEncoding = 'identity',
    clock = () => performance.now(), wallStartMs } = input;
  if (!Number.isInteger(concurrency) || concurrency < CONCURRENCY[0] || concurrency > CONCURRENCY[1]) refuse('edge concurrency must be an integer from 1 to 16');
  if (!Number.isSafeInteger(wallStartMs) || wallStartMs <= 0) refuse('an explicit wall-clock start is required');
  if (typeof clock !== 'function') refuse('clock must be a function');
  assertStagingFixture(planInput);
  const plan = planCapture(planInput);
  const transport = createLoopbackTransport(fixture, { timeoutMs, edgeAcceptEncoding, maxSockets: concurrency });
  const mono0 = clock();
  let last = mono0;
  const elapsed = () => {
    const t = clock();
    if (!Number.isFinite(t) || t < last) refuse('monotonic clock moved backwards');
    last = t;
    return t - mono0;
  };
  const stamp = ms => new Date(wallStartMs + Math.floor(ms)).toISOString();
  const exchanges = [];
  const phases = {};
  const counts = { before: 0, manifest: 0, edge: 0, after: 0 };
  let refusal = null;

  async function exchange(phase, id, url, surface) {
    counts[phase] += 1;
    const response = await transport.get(url, { surface });
    const at = elapsed();
    if (at > MAX_WINDOW_MS) refuse('observation window exceeds five minutes; capture stopped');
    return { response, observedAt: stamp(at) };
  }
  async function phase(name, fn) {
    const start = elapsed();
    try { await fn(); } finally { phases[name] = elapsed() - start; }
  }
  async function liveChannels(name) {
    const out = {};
    for (const r of plan.requests[name]) {
      const { response, observedAt } = await exchange(name, r.id, r.url, 'provider');
      const body = providerBody(response, r.id);
      exchanges.push({ id: r.id, observedAt, request: { method: 'GET', url: r.url }, response: { status: 200, body } });
      out[r.target] = body;
    }
    return out;
  }

  try {
    let before;
    await phase('before', async () => { before = await liveChannels('before'); });
    await phase('manifest', async () => {
      for (const m of plan.requests.manifest) {
        const versionId = /\/versions\/([^/]+)$/.exec(String(before[m.target]?.release?.version?.name || ''))?.[1];
        if (!versionId) refuse(`${m.target} before read names no version`);
        const base = m.urlTemplate.replace('{versionId}', encodeURIComponent(versionId));
        const seen = new Set();
        let token = null;
        for (let n = 0; ; n += 1) {
          if (n >= MAX_PAGES) refuse(`${m.target} manifest exceeds ${MAX_PAGES} pages`);
          const url = token === null ? base : `${base}?pageToken=${encodeURIComponent(token)}`;
          const id = `${m.id}:${n}`;
          const { response, observedAt } = await exchange('manifest', id, url, 'provider');
          const body = providerBody(response, id);
          exchanges.push({ id, observedAt, request: { method: 'GET', url }, response: { status: 200, body } });
          const nextToken = body && typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null;
          // A repeated token ends pagination here; the unchanged replay refuses the chain.
          if (nextToken === null || seen.has(nextToken)) break;
          seen.add(nextToken);
          token = nextToken;
        }
      }
    });
    await phase('edge', async () => {
      const queue = [...plan.requests.edge];
      let failure = null;
      async function worker() {
        while (queue.length && !failure) {
          const r = queue.shift();
          try {
            const { response, observedAt } = await exchange('edge', r.id, r.url, 'edge');
            if (response.status !== 200) refuse(`${r.id} not served (HTTP ${response.status}); no retry`);
            // Completion order keeps observedAt non-decreasing, as replay requires.
            exchanges.push({ id: r.id, observedAt, request: { method: 'GET', url: r.url }, response: { status: 200, url: r.url, sha256: sha256(response.body) } });
          } catch (error) { failure = failure || error; }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, plan.requests.edge.length) }, worker));
      if (failure) throw failure;
    });
    await phase('after', async () => { await liveChannels('after'); });
  } catch (error) {
    refusal = { stage: 'capture', reason: error.message };
  } finally {
    transport.close();
  }

  const totalMs = elapsed();
  const transcript = {
    kind: TRANSCRIPT_KIND, schemaVersion: 1, planFingerprint: fingerprint(plan),
    provenance: { kind: 'synthetic-fixture', tool: 'capture-benchmark' },
    startedAt: stamp(0), completedAt: stamp(totalMs), exchanges
  };
  let replay = null;
  if (!refusal) {
    try {
      replay = replayCapture({ planInput, transcript, candidate, localGzip, receipt: null, now: transcript.completedAt });
    } catch (error) { refusal = { stage: 'replay', reason: error.message }; }
  }
  return Object.freeze({
    kind: RESULT_KIND, schemaVersion: 1, evidenceClass: 'local-benchmark', provenance: 'synthetic-fixture',
    outcome: refusal ? 'refused' : 'replay-consistent', refusal,
    concurrency, edgeAcceptEncoding,
    timing: { totalMs, phasesMs: phases, classification: refusal && /five minutes/.test(refusal.reason) ? 'refused-window-exceeded' : classifyTiming(totalMs),
      targetMs: TARGET_MS, hardLimitMs: MAX_WINDOW_MS, targetIsCertificationCondition: false },
    requests: { total: transport.stats.requests, byPhase: counts, timeouts: transport.stats.timeouts },
    bytes: { wire: transport.stats.wireBytes, decoded: transport.stats.decodedBytes },
    maxConcurrency: transport.stats.maxInFlight,
    transcript, replay,
    establishes: refusal ? [] : ESTABLISHES, doesNotEstablish: DOES_NOT_ESTABLISH,
    liveProvider: false, providerVerified: false, deploymentProvenanceEstablished: false,
    deployable: false, certified: false, authorized: false, available: false
  });
}

module.exports = { runBenchmark, startFixtureServer, createLoopbackTransport, classifyTiming, RESULT_KIND, PROJECT, SITES, ORIGINS,
  TARGET_MS, ESTABLISHES, DOES_NOT_ESTABLISH };
