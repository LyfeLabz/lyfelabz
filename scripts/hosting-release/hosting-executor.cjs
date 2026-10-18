'use strict';

// D13 Part F: staging-only Hosting capture executor over an injected transport.
// Non-operational. Nothing in a release, deployment or activation path requires this
// module. It has no network adapter: every request goes to a transport function the
// caller injects, and the clock is injected too. It reads no environment, file,
// credential or proxy setting, starts no subprocess and mints no token. The production
// network adapter is not implemented (separately authorized).
//
// The executor drives the unchanged D13 Part D plan (`planCapture`): before reads for
// both sites, complete provider file-list pagination, public-edge reads with bounded
// concurrency, after reads. Each request is checked against the plan and a fixed
// staging allowlist before it reaches the transport; each response is checked for
// status, redirect, size, encoding and content type before it is recorded. The
// transcript is then verified by the unchanged Part D replay (and through it the Part
// B and Part C contracts), evaluated at the capture's own completion time.
//
// Two isolated request classes:
//   provider  https://firebasehosting.googleapis.com/v1beta1/ only, project
//             lyfelabz-staging (or 293337283840), the two staging sites, only the live
//             channel GET and the version files GET; JSON; identity encoding. Only these
//             requests may carry an authorization header, and in this operation only a
//             synthetic, non-secret marker (`synthetic-marker:<label>`) for isolation tests.
//   edge      exactly the two staging web.app origins with the planned path and
//             cache-busting nonce; no authorization, cookie or other credential header;
//             identity or gzip encoding, decoded before SHA-256, raw-byte diagnostics
//             kept separately.
// Production projects, numbers, sites and domains, arbitrary hosts and non-GET methods
// refuse. There is no general-purpose request interface and no retry.
//
// Provenance trust boundary: the output is always `synthetic-fixture`, the existing kind,
// because an injected transport cannot prove where its bytes came from. No option sets
// or raises provenance, and the executor never produces `offline-record` or the reserved
// `live-staging-capture`. A future trusted live pathway would be a module-internal
// adapter enabled by a separately authorized change, never an argument.
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const { planCapture, replayCapture, MAX_WINDOW_MS, PROVIDER_API, TRANSCRIPT_KIND, DIAGNOSTIC_HEADERS } = require('./hosting-capture.cjs');
const { fingerprint, PROJECT_NUMBERS, LIMITS } = require('./backend-state.cjs');
const { TARGETS } = require('./contract.cjs');

const RESULT_KIND = 'lyfelabz.hostingExecutorCapture';
const PROVENANCE = Object.freeze({ kind: 'synthetic-fixture', tool: 'hosting-executor' });
const LIVE_TRANSPORT = 'not-implemented';
const PROJECT = 'lyfelabz-staging';
const PROJECT_NUMBER = '293337283840';
if (PROJECT_NUMBERS[PROJECT] !== PROJECT_NUMBER) throw new Error('[hosting-executor] REFUSED: staging project number binding changed');
const SITES = Object.freeze({ app: 'lyfelabz-staging', marketing: 'lyfelabz-staging-marketing' });
const ORIGINS = Object.freeze({ app: 'https://lyfelabz-staging.web.app', marketing: 'https://lyfelabz-staging-marketing.web.app' });
const PROVIDER_ORIGIN = new URL(PROVIDER_API).origin;
// Production identities no request may name, raw or percent-decoded.
const FORBIDDEN = Object.freeze(['lyfelabz-prod', '182791689935', 'lyfelabz-marketing', 'lyfelabz.com']);
const SITE_PATTERN = `(?:${SITES.app}|${SITES.marketing})`;
const PROJECT_PATTERN = `(?:${PROJECT}|${PROJECT_NUMBER})`;
const CHANNEL_PATH = new RegExp(`^/v1beta1/projects/${PROJECT_PATTERN}/sites/${SITE_PATTERN}/channels/live$`);
const FILES_PATH = new RegExp(`^/v1beta1/projects/${PROJECT_PATTERN}/sites/${SITE_PATTERN}/versions/[a-f0-9]+/files$`);
const PROVIDER_MAX_BYTES = LIMITS.jsonBytes;
const EDGE_MAX_BYTES = LIMITS.fileBytes;
const MAX_TIMEOUT_MS = 30000;
const MAX_PAGES = 1000;
const MAX_TOKEN_LENGTH = 2048;
const CONCURRENCY = Object.freeze([1, 16]);
const ENCODINGS = Object.freeze(['identity', 'gzip']);
const SYNTHETIC_MARKER = /^synthetic-marker:[a-z0-9-]{1,64}$/;
const PROVIDER_CONTENT_TYPE = /^application\/json(?:;\s*charset=utf-8)?$/i;
const EDGE_REQUEST_HEADERS = Object.freeze(['accept', 'accept-encoding']);
const LIMITATIONS = Object.freeze([
  'an injected transport cannot prove where its bytes came from; evidence is synthetic-fixture',
  'no production network adapter exists; a live staging capture needs separate authorization',
  'edge diagnostic headers are one edge location report and do not establish global CDN consistency',
  'not provider-backed certification, deployment approval, activation or availability'
]);

function refuse(message) { throw new Error(`[hosting-executor] REFUSED: ${message}`); }
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function forbiddenIdentity(url) {
  let decoded;
  try { decoded = decodeURIComponent(url); } catch { refuse('undecodable request URL'); }
  for (const name of FORBIDDEN) if (url.includes(name) || decoded.includes(name)) refuse(`production identity refused: ${name}`);
}
function parse(url) {
  let u;
  try { u = new URL(url); } catch { refuse('malformed request URL'); }
  if (u.href !== url) refuse('request URL is not canonical');
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) refuse(`request outside the staging allowlist: ${u.protocol}//${u.host}`);
  forbiddenIdentity(url);
  return u;
}
/** Provider requests: the Firebase Hosting API, the two planned GET resources only. */
function assertProviderUrl(url) {
  const u = parse(url);
  if (u.origin !== PROVIDER_ORIGIN) refuse(`provider request to another host: ${u.host}`);
  const keys = [...u.searchParams.keys()];
  if (CHANNEL_PATH.test(u.pathname) && keys.length === 0) return u;
  if (FILES_PATH.test(u.pathname) && (keys.length === 0 || (keys.length === 1 && keys[0] === 'pageToken'))) return u;
  refuse(`provider request outside the approved resources: ${u.pathname}`);
}
/** Edge requests: exactly a trusted staging origin, the cache-busting nonce only. */
function assertEdgeUrl(url, origin, nonce) {
  const u = parse(url);
  if (!Object.values(ORIGINS).includes(u.origin) || u.origin !== origin) refuse(`edge request to an untrusted origin: ${u.host}`);
  const keys = [...u.searchParams.keys()];
  if (keys.length !== 1 || u.searchParams.get('hosting-release') !== nonce) refuse(`edge request without exactly the planned nonce: ${u.pathname}`);
  return u;
}
function assertStagingPlanInput(planInput) {
  if (planInput?.project !== PROJECT || planInput?.trusted?.project !== PROJECT) refuse('the executor accepts only the lyfelabz-staging project');
  for (const target of TARGETS) {
    if (planInput.trusted?.sites?.[target] !== SITES[target]) refuse(`unexpected trusted ${target} site`);
    if (planInput.trusted?.origins?.[target] !== ORIGINS[target]) refuse(`unexpected trusted ${target} origin`);
  }
}

function headerMap(headers, description) {
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers) || Object.getPrototypeOf(headers) !== Object.prototype) refuse(`${description} headers must be a plain object`);
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key !== key.toLowerCase() || typeof value !== 'string') refuse(`malformed ${description} header`);
    out[key] = value;
  }
  return out;
}
// Shared response checks for both request classes.
function checkResponse(response, url, maxBytes, description) {
  if (response === null || typeof response !== 'object') refuse(`${description} transport returned no response`);
  if (!Number.isInteger(response.status)) refuse(`${description} response has no status`);
  if (response.redirectCount !== 0 || (response.status >= 300 && response.status < 400)) refuse(`${description} redirect refused (HTTP ${response.status})`);
  if (response.url !== url) refuse(`${description} response URL differs from the request (redirect or substitution)`);
  if (!Buffer.isBuffer(response.body)) refuse(`${description} response body must be bytes`);
  if (response.body.length > maxBytes) refuse(`${description} response exceeds ${maxBytes} bytes`);
  const headers = headerMap(response.headers, description);
  if (Object.hasOwn(headers, 'content-length') && !(/^(0|[1-9]\d*)$/.test(headers['content-length']) && Number(headers['content-length']) === response.body.length))
    refuse(`${description} Content-Length differs from the received bytes`);
  if (response.status !== 200) {
    const kind = { 401: 'unauthenticated', 403: 'permission-denied', 404: 'not-found', 429: 'rate-limited' }[response.status] || (response.status >= 500 ? 'server-error' : 'http-error');
    refuse(`${description} HTTP ${response.status} (${kind}); no retry`);
  }
  return headers;
}

// createExecutor({ transport, clock, wallStartMs, concurrency, timeoutMs?, edgeAcceptEncoding?,
//                  syntheticAuthorizationMarker? }) -> { capture({ planInput, candidate, localGzip }) }
//   transport(request) -> Promise<{ status, url, redirectCount, headers, body: Buffer }>
//     request { surface: 'provider' | 'edge', method: 'GET', url, headers, maxBytes, signal }
//   clock() -> monotonic milliseconds; wallStartMs is the explicit wall-clock start.
function createExecutor(options) {
  const allowed = ['transport', 'clock', 'wallStartMs', 'concurrency', 'timeoutMs', 'edgeAcceptEncoding', 'syntheticAuthorizationMarker'];
  for (const key of Object.keys(options || {})) if (!allowed.includes(key)) refuse(`unknown executor option: ${key}`);
  const { transport, clock, wallStartMs, concurrency, timeoutMs = MAX_TIMEOUT_MS, edgeAcceptEncoding = 'identity', syntheticAuthorizationMarker = null } = options;
  if (typeof transport !== 'function') refuse('an injected transport function is required');
  if (typeof clock !== 'function') refuse('an injected monotonic clock is required');
  if (!Number.isSafeInteger(wallStartMs) || wallStartMs <= 0) refuse('an explicit wall-clock start is required');
  if (!Number.isInteger(concurrency) || concurrency < CONCURRENCY[0] || concurrency > CONCURRENCY[1]) refuse('edge concurrency must be an integer from 1 to 16');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) refuse('timeout must be an integer from 1 to 30000 ms');
  if (!ENCODINGS.includes(edgeAcceptEncoding)) refuse('edge Accept-Encoding must be identity or gzip');
  // Only a synthetic, non-secret marker is accepted; a real bearer token is refused.
  if (syntheticAuthorizationMarker !== null && (typeof syntheticAuthorizationMarker !== 'string' || !SYNTHETIC_MARKER.test(syntheticAuthorizationMarker)))
    refuse('only a synthetic authorization marker is accepted; live credentials are not supported');

  async function send(surface, url, headers, maxBytes) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error(`[hosting-executor] REFUSED: ${surface} request timeout after ${timeoutMs} ms; no retry`)); }, timeoutMs);
    });
    const request = Object.freeze({ surface, method: 'GET', url, headers: Object.freeze({ ...headers }), maxBytes, signal: controller.signal });
    try { return await Promise.race([Promise.resolve().then(() => transport(request)), timeout]); }
    catch (error) { if (/^\[hosting-executor\]/.test(error.message)) throw error; return refuse(`${surface} transport failure: ${error.message}`); }
    finally { clearTimeout(timer); }
  }
  async function provider(url) {
    assertProviderUrl(url);
    const headers = { accept: 'application/json', 'accept-encoding': 'identity' };
    if (syntheticAuthorizationMarker !== null) headers.authorization = syntheticAuthorizationMarker;
    const response = await send('provider', url, headers, PROVIDER_MAX_BYTES);
    const h = checkResponse(response, url, PROVIDER_MAX_BYTES, 'provider');
    if (!PROVIDER_CONTENT_TYPE.test(h['content-type'] || '')) refuse('provider response is not application/json');
    if ((h['content-encoding'] || 'identity').trim().toLowerCase() !== 'identity') refuse('provider response is encoded; identity was requested');
    let body;
    try { body = JSON.parse(response.body.toString('utf8')); } catch { refuse('provider response is not JSON'); }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) refuse('provider response is not a JSON object');
    return body;
  }
  async function edge(url, origin, nonce) {
    assertEdgeUrl(url, origin, nonce);
    // Provider credentials never reach an edge request: the header set is fixed here.
    const headers = { accept: '*/*', 'accept-encoding': edgeAcceptEncoding };
    if (Object.keys(headers).some(k => !EDGE_REQUEST_HEADERS.includes(k))) refuse('edge request carries a non-allowlisted header');
    const response = await send('edge', url, headers, EDGE_MAX_BYTES);
    const h = checkResponse(response, url, EDGE_MAX_BYTES, 'edge');
    const raw = response.body;
    const encoding = (h['content-encoding'] || 'identity').trim().toLowerCase();
    let decoded;
    if (encoding === 'identity') decoded = raw;
    else if (encoding === 'gzip' && edgeAcceptEncoding === 'gzip') {
      try { decoded = zlib.gunzipSync(raw, { maxOutputLength: EDGE_MAX_BYTES }); } catch { refuse(`undecodable or oversized gzip edge response: ${new URL(url).pathname}`); }
    } else refuse(`unsupported or unrequested Content-Encoding ${encoding}: ${new URL(url).pathname}`);
    const decodedSha256 = sha256(decoded);
    const diagnostics = { rawSha256: sha256(raw), rawLength: raw.length, decodedSha256, contentEncoding: encoding,
      contentLength: Object.hasOwn(h, 'content-length') ? Number(h['content-length']) : null,
      etag: null, age: null, cacheControl: null, xCache: null, xServedBy: null, responseUrl: response.url, nonce, redirectCount: 0 };
    for (const [header, field] of Object.entries(DIAGNOSTIC_HEADERS)) if (Object.hasOwn(h, header)) diagnostics[field] = h[header];
    return { decodedSha256, diagnostics };
  }

  async function capture(input) {
    const keys = Object.keys(input || {});
    for (const key of keys) if (!['planInput', 'candidate', 'localGzip'].includes(key)) refuse(`unknown capture input: ${key}`);
    assertStagingPlanInput(input.planInput);
    const plan = planCapture(input.planInput);
    const mono0 = clock();
    let last = mono0;
    const elapsed = () => {
      const t = clock();
      if (!Number.isFinite(t) || t < last) refuse('monotonic clock moved backwards');
      last = t;
      return t - mono0;
    };
    const stamp = ms => new Date(wallStartMs + Math.floor(ms)).toISOString();
    const observed = () => {
      const at = elapsed();
      if (at > MAX_WINDOW_MS) refuse('observation window exceeds five minutes; capture stopped');
      return stamp(at);
    };
    const exchanges = [];
    const counts = { before: 0, manifest: 0, edge: 0, after: 0 };
    let refusal = null;
    let transcript = null;
    let replay = null;
    const startedAt = stamp(0);

    async function liveChannels(name) {
      const out = {};
      for (const r of plan.requests[name]) {
        counts[name] += 1;
        const body = await provider(r.url);
        exchanges.push({ id: r.id, observedAt: observed(), request: { method: 'GET', url: r.url }, response: { status: 200, body } });
        out[r.target] = body;
      }
      return out;
    }
    try {
      const before = await liveChannels('before');
      for (const m of plan.requests.manifest) {
        const versionId = /\/versions\/([a-f0-9]+)$/.exec(String(before[m.target]?.release?.version?.name || ''))?.[1];
        if (!versionId) refuse(`${m.target} before read names no valid version`);
        const base = m.urlTemplate.replace('{versionId}', versionId);
        const seen = new Set();
        let token = null;
        for (let n = 0; ; n += 1) {
          if (n >= MAX_PAGES) refuse(`${m.target} manifest exceeds ${MAX_PAGES} pages`);
          const url = token === null ? base : `${base}?pageToken=${encodeURIComponent(token)}`;
          counts.manifest += 1;
          const body = await provider(url);
          exchanges.push({ id: `${m.id}:${n}`, observedAt: observed(), request: { method: 'GET', url }, response: { status: 200, body } });
          if (!Object.hasOwn(body, 'nextPageToken')) break;
          const next = body.nextPageToken;
          if (typeof next !== 'string' || !next || next.length > MAX_TOKEN_LENGTH) refuse(`${m.target} manifest page ${n} has a malformed continuation token`);
          if (seen.has(next)) refuse(`${m.target} manifest pagination loop (repeated continuation token)`);
          seen.add(next);
          token = next;
        }
      }
      const queue = [...plan.requests.edge];
      let failure = null;
      async function worker() {
        while (queue.length && !failure) {
          const r = queue.shift();
          try {
            counts.edge += 1;
            const { decodedSha256, diagnostics } = await edge(r.url, r.origin, plan.nonce);
            // Completion order keeps observedAt non-decreasing, as replay requires.
            exchanges.push({ id: r.id, observedAt: observed(), request: { method: 'GET', url: r.url },
              response: { status: 200, url: r.url, sha256: decodedSha256, diagnostics } });
          } catch (error) { failure = failure || error; }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, plan.requests.edge.length) }, worker));
      if (failure) throw failure;
      await liveChannels('after');
      transcript = { kind: TRANSCRIPT_KIND, schemaVersion: 1, planFingerprint: fingerprint(plan), provenance: { ...PROVENANCE },
        startedAt, completedAt: observed(), exchanges };
    } catch (error) {
      refusal = { stage: 'capture', reason: error.message };
    }
    if (transcript !== null) {
      try {
        // The unchanged Part D replay owns release stability, manifest, binding and byte rules.
        replay = replayCapture({ planInput: input.planInput, transcript, candidate: input.candidate, localGzip: input.localGzip,
          receipt: null, now: transcript.completedAt });
      } catch (error) {
        refusal = { stage: 'replay', reason: error.message };
      }
    }
    return Object.freeze({
      kind: RESULT_KIND, schemaVersion: 1,
      outcome: refusal === null ? 'replayed' : 'refused',
      provenance: PROVENANCE.kind,
      liveTransport: LIVE_TRANSPORT,
      capture: Object.freeze({ executor: PROVENANCE.tool, transport: 'injected', project: PROJECT, projectNumber: PROJECT_NUMBER,
        sites: SITES, origins: ORIGINS, credentialCategory: syntheticAuthorizationMarker === null ? 'none' : 'synthetic-marker',
        edgeAcceptEncoding, concurrency, timeoutMs }),
      requests: Object.freeze({ ...counts }),
      replayEvaluatedAt: replay === null ? null : transcript.completedAt,
      transcript, replay, refusal,
      limitations: LIMITATIONS,
      deployable: false, certified: false, authorized: false, available: false
    });
  }
  return Object.freeze({ capture });
}

module.exports = { createExecutor, assertProviderUrl, assertEdgeUrl, RESULT_KIND, PROVENANCE, LIVE_TRANSPORT, PROJECT, PROJECT_NUMBER,
  SITES, ORIGINS, PROVIDER_MAX_BYTES, EDGE_MAX_BYTES };
