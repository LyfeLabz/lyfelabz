'use strict';

// D13 Parts F/G2: offline staging capture preparation. No live entry point exists.
// All transports, HTTPS connectors, DNS answers and brokers are injected fixtures.
// No socket, authentication, credential discovery or environment lookup is implemented.
// Synthetic markers are the only accepted authorization values. Output is synthetic.
// A future live pathway needs a separately authorized broker, internal transport and
// independently protected evidence anchor. Serialized labels cannot establish trust.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { checkServerIdentity } = require('node:tls');
const { isIP } = require('node:net');

const { planCapture, replayCapture, MAX_WINDOW_MS, PROVIDER_API, TRANSCRIPT_KIND, DIAGNOSTIC_HEADERS } = require('./hosting-capture.cjs');
const { fingerprint, PROJECT_NUMBERS, LIMITS } = require('./backend-state.cjs');
const { TARGETS } = require('./contract.cjs');
const { FIREBASE_BUILTIN_IGNORES, isHostingIgnored } = require('../../app/scripts/lessonBuilder/hostingExclusion.cjs');

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
const PAGE_TOKEN = /^[A-Za-z0-9_\-.~+/=]{1,2048}$/;
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/firebase.readonly';
const SAFETY_LIMITS = Object.freeze({ aggregateBytes: 64 * 1024 * 1024, headerBytes: 16 * 1024,
  fileEntries: 10000, pages: MAX_PAGES, depth: 64 });
const AUTHORITY = Object.freeze({ deployable: false, certified: false, authorized: false, available: false });
const internalErrors = new WeakSet();
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

function fault(code, message) {
  const error = new Error(`[hosting-executor] REFUSED: ${message}`);
  error.code = code;
  internalErrors.add(error);
  return error;
}
function refuse(message, code = 'E_POLICY') { throw fault(code, message); }
// Only fixed messages cross the persistence boundary. Even a transport error with
// a forged executor prefix/code cannot inject text into an artifact.
function safeFailure(error) {
  if (!internalErrors.has(error)) return { code: 'E_TRANSPORT', reason: 'transport failure (details redacted)' };
  const rules = [
    [/not application\/json/, 'E_CONTENT_TYPE', 'provider response is not application/json'],
    [/provider response is encoded/, 'E_ENCODING', 'provider response is encoded; identity was requested'],
    [/not a JSON object/, 'E_JSON', 'provider response is not a JSON object'],
    [/not JSON/, 'E_JSON', 'provider response is not JSON'],
    [/HTTP (401|403|404|429|500|503)/, 'E_HTTP', 'HTTP error; no retry'],
    [/Content-Encoding/, 'E_ENCODING', 'unsupported or unrequested Content-Encoding'],
    [/undecodable or oversized gzip/, 'E_DECOMPRESSION', 'undecodable or oversized gzip edge response'],
    [/response URL differs/, 'E_RESPONSE_URL', 'response URL differs from the request'],
    [/redirect/, 'E_REDIRECT', 'redirect refused before following'],
    [/Content-Length differs/, 'E_LENGTH', 'Content-Length differs from the received bytes'],
    [/provider response exceeds/, 'E_SIZE', 'provider response exceeds the byte limit'],
    [/edge response exceeds/, 'E_SIZE', 'edge response exceeds the byte limit'],
    [/continuation token|pagination loop/, 'E_PAGINATION', 'malformed continuation token or pagination loop'],
    [/names no valid version|unexpected channel identity/, 'E_IDENTITY', 'before read names no valid version or unexpected channel identity'],
    [/five minutes/, 'E_DEADLINE', 'observation window exceeds five minutes; capture stopped'],
    [/clock/, 'E_CLOCK', 'invalid monotonic clock'],
    [/timeout/, 'E_TIMEOUT', 'request timeout; no retry']
  ];
  for (const [pattern, code, reason] of rules) if (pattern.test(error.message)) return { code, reason };
  const messages = {
    E_HTTP: 'HTTP error; no retry', E_CANCELLED: 'capture cancelled', E_TLS: 'TLS certificate or hostname validation failed',
    E_DNS: 'unapproved DNS destination', E_HEADERS: 'invalid or oversized response headers',
    E_SIZE: 'streaming response size limit exceeded', E_AGGREGATE: 'aggregate response byte limit exceeded',
    E_ENTRIES: 'aggregate file-entry limit exceeded', E_PAGES: 'maximum page count exceeded',
    E_UTF8: 'provider response is not valid UTF-8', E_DUPLICATE_JSON: 'duplicate JSON key refused',
    E_JSON: 'provider response is not JSON', E_BROKER: 'fake broker identity, scope or expiry verification failed',
    E_REPLAY: 'offline consistency replay refused', E_POLICY: 'staging capture policy refused'
  };
  const code = Object.hasOwn(messages, error.code) ? error.code : 'E_POLICY';
  return { code, reason: messages[code] };
}
function replayFailure(error) {
  // Existing pure contracts can contain untrusted paths/values in their messages.
  const text = typeof error?.message === 'string' ? error.message : '';
  if (/served bytes differ/.test(text)) return { code: 'E_REPLAY_BYTES', reason: 'served bytes differ from the approved artifact' };
  if (/changed between before and after/.test(text)) return { code: 'E_REPLAY_STABILITY', reason: 'release metadata changed between before and after observations' };
  if (/ROLLBACK is not DEPLOY/.test(text)) return { code: 'E_REPLAY_TYPE', reason: 'release type ROLLBACK is not DEPLOY' };
  if (/provider file count/.test(text)) return { code: 'E_REPLAY_MANIFEST', reason: 'provider file count differs from version fileCount' };
  return { code: 'E_REPLAY', reason: 'offline consistency replay refused' };
}
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
  if (FILES_PATH.test(u.pathname) && (keys.length === 0 || (keys.length === 1 && keys[0] === 'pageToken' && PAGE_TOKEN.test(u.searchParams.get('pageToken'))))) return u;
  refuse(`provider request outside the approved resources: ${u.pathname}`);
}
/** Edge requests: exactly a trusted staging origin, the cache-busting nonce only. */
function assertEdgeUrl(url, origin, nonce) {
  const u = parse(url);
  if (!Object.values(ORIGINS).includes(u.origin) || u.origin !== origin) refuse(`edge request to an untrusted origin: ${u.host}`);
  const keys = [...u.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'hosting-release' || typeof nonce !== 'string' || !/^[a-z0-9]{6,32}$/.test(nonce) || u.searchParams.get('hosting-release') !== nonce) refuse(`edge request without exactly the planned nonce: ${u.pathname}`);
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
  let bytes = 2;
  for (const [key, value] of Object.entries(headers)) {
    if (key !== key.toLowerCase() || typeof value !== 'string') refuse(`malformed ${description} header`);
    bytes += Buffer.byteLength(key) + Buffer.byteLength(value) + 4;
    if (bytes > SAFETY_LIMITS.headerBytes || /[\r\n\x00]/.test(value)) refuse('invalid or oversized response headers', 'E_HEADERS');
    Object.defineProperty(out, key, { value, enumerable: true });
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

// Fatal UTF-8 and a bounded structural scan precede JSON.parse. Key comparison
// uses decoded strings, so escaped-equivalent duplicate keys are also refused.
function providerJson(bytes) {
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { refuse('invalid provider UTF-8', 'E_UTF8'); }
  let i = 0;
  const space = () => { while (/[ \t\r\n]/.test(source[i] || 'x')) i++; };
  function string() {
    const start = i++;
    while (i < source.length) {
      const c = source[i++];
      if (c === '\\') i++;
      else if (c === '"') return JSON.parse(source.slice(start, i));
    }
    refuse('provider response is not JSON', 'E_JSON');
  }
  function value(depth) {
    if (depth > SAFETY_LIMITS.depth) refuse('provider response is not JSON', 'E_JSON');
    space();
    if (source[i] === '"') { string(); return; }
    if (source[i] === '{') {
      i++; space(); const keys = new Set();
      if (source[i] === '}') { i++; return; }
      while (i < source.length) {
        space(); if (source[i] !== '"') refuse('provider response is not JSON', 'E_JSON');
        const key = string();
        if (keys.has(key)) refuse('duplicate JSON key', 'E_DUPLICATE_JSON');
        keys.add(key); space();
        if (source[i++] !== ':') refuse('provider response is not JSON', 'E_JSON');
        value(depth + 1); space();
        const c = source[i++]; if (c === '}') return;
        if (c !== ',') refuse('provider response is not JSON', 'E_JSON');
      }
    } else if (source[i] === '[') {
      i++; space(); if (source[i] === ']') { i++; return; }
      while (i < source.length) {
        value(depth + 1); space(); const c = source[i++];
        if (c === ']') return;
        if (c !== ',') refuse('provider response is not JSON', 'E_JSON');
      }
    } else {
      const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(i));
      if (!m || (m[0][0] === '-' || /\d/.test(m[0][0])) && !Number.isFinite(Number(m[0]))) refuse('provider response is not JSON', 'E_JSON');
      i += m[0].length; return;
    }
    refuse('provider response is not JSON', 'E_JSON');
  }
  try {
    value(0); space(); if (i !== source.length) refuse('provider response is not JSON', 'E_JSON');
    const body = JSON.parse(source);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) refuse('provider response is not a JSON object', 'E_JSON');
    return body;
  } catch (error) {
    if (internalErrors.has(error)) throw error;
    refuse('provider response is not JSON', 'E_JSON');
  }
}
function exact(value, keys, description) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length ||
      Object.getOwnPropertyNames(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k) || !('value' in Object.getOwnPropertyDescriptor(value, k))))
    refuse(`invalid ${description}`);
}
function expectedIdentity(identity) {
  exact(identity, ['project', 'serviceAccountEmail', 'accountId'], 'expected identity');
  if (identity.project !== PROJECT || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@lyfelabz-staging\.iam\.gserviceaccount\.com$/.test(identity.serviceAccountEmail) ||
      !/^[0-9]{10,30}$/.test(identity.accountId) || identity.accountId === PROJECT_NUMBER) refuse('invalid expected service-account identity');
  return Object.freeze({ ...identity });
}
async function fakeCredential(broker, identity, nowMs) {
  let c;
  try { c = await broker(Object.freeze({ ...identity, scope: OAUTH_SCOPE, nowMs, mode: 'synthetic-only' })); }
  catch { refuse('fake broker failed', 'E_BROKER'); }
  try {
    exact(c, ['kind', 'marker', 'project', 'serviceAccountEmail', 'accountId', 'verifiedAccountId', 'scope', 'expiresAt'], 'fake credential');
    if (c.kind !== 'synthetic-credential' || typeof c.marker !== 'string' || !SYNTHETIC_MARKER.test(c.marker) || c.project !== identity.project ||
        c.serviceAccountEmail !== identity.serviceAccountEmail || c.accountId !== identity.accountId || c.verifiedAccountId !== identity.accountId ||
        c.scope !== OAUTH_SCOPE || typeof c.expiresAt !== 'string' || !Number.isFinite(Date.parse(c.expiresAt)) ||
        Date.parse(c.expiresAt) < nowMs + MAX_WINDOW_MS) refuse('invalid fake credential', 'E_BROKER');
    return c.marker;
  } catch { refuse('fake broker identity, scope or expiry verification failed', 'E_BROKER'); }
}
function validateArtifacts(input, plan) {
  exact(input.candidate, ['applicationBuildFingerprint', 'availabilityEvidence', 'hostingArtifactFingerprint',
    'placementFingerprint', 'releaseIntent', 'source', 'teacherUnitsAvailability'], 'candidate');
  exact(input.candidate.source, ['sha', 'dirty'], 'candidate source');
  if (input.candidate.availabilityEvidence !== 'build-contract-assertion' ||
      ['applicationBuildFingerprint', 'placementFingerprint', 'hostingArtifactFingerprint'].some(key => typeof input.candidate[key] !== 'string' || !/^[a-f0-9]{64}$/.test(input.candidate[key])) ||
      !['general', 'teacher-units'].includes(input.candidate.releaseIntent)) refuse('invalid application build identity');
  exact(input.localGzip, TARGETS, 'local gzip evidence');
  if (input.candidate?.teacherUnitsAvailability !== 'closed' || input.candidate?.source?.dirty !== false ||
      fingerprint(input.candidate) !== plan.expectedCandidateFingerprint ||
      fingerprint(input.planInput.pairBuild.files) !== input.candidate.hostingArtifactFingerprint ||
      input.candidate.source.sha !== plan.sourceSha || input.candidate.releaseIntent !== input.planInput.pairBuild.releaseIntent ||
      input.candidate.placementFingerprint !== input.planInput.pairBuild.unitPlacement?.fingerprint) refuse('local candidate prerequisites differ');
  for (const target of TARGETS) {
    exact(input.localGzip[target], ['profile', 'files'], 'local gzip target');
    // Preflight only: the unchanged Part C replay owns full profile validation
    // and compatibility. Do not add a direct consumer of that contract here.
    const profile = input.localGzip[target].profile;
    if (!profile || Object.getPrototypeOf(profile) !== Object.prototype || profile.kind !== 'lyfelabz.gzipCompressionProfile' ||
        profile.schemaVersion !== 1 || profile.container !== 'gzip' || profile.hashAlgorithm !== 'sha256' ||
        !profile.calibration || Object.values(profile.calibration).length !== 5 ||
        Object.values(profile.calibration).some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) refuse('local compression profile prerequisites differ');
    const files = input.planInput.pairBuild.files[target];
    for (const [file, hash] of Object.entries(files)) {
      if (!file || file.startsWith('/') || /[\\?#%\x00-\x20\x7f]/.test(file) || file.split('/').some(p => !p || p === '.' || p === '..') || !/^[a-f0-9]{64}$/.test(hash)) refuse('invalid local artifact path or hash');
    }
    const deployed = Object.keys(files).filter(file => !isHostingIgnored(file,
      FIREBASE_BUILTIN_IGNORES.concat(input.planInput.routing[target].ignore)));
    const gzip = input.localGzip[target].files;
    if (!gzip) refuse('missing local gzip files');
    exact(gzip, Object.keys(gzip), 'local gzip files');
    for (const entry of Object.values(gzip)) exact(entry, ['sha256', 'gzipSha256'], 'local gzip entry');
    if (!gzip || Object.keys(gzip).length !== deployed.length || deployed.some(file => gzip[`/${file}`]?.sha256 !== files[file] || !/^[a-f0-9]{64}$/.test(gzip[`/${file}`]?.gzipSha256))) refuse('local gzip prerequisites differ');
  }
  for (const request of [...plan.requests.before, ...plan.requests.after]) assertProviderUrl(request.url);
  for (const request of plan.requests.manifest) assertProviderUrl(request.urlTemplate.replace('{versionId}', '0'));
  for (const request of plan.requests.edge) assertEdgeUrl(request.url, request.origin, plan.nonce);
  if (plan.requests.edge.length > SAFETY_LIMITS.fileEntries) refuse('aggregate file-entry limit exceeded', 'E_ENTRIES');
}
// Planning only. No broker invocation, credential lookup, network or local writes.
function dryRun(input) {
  exact(input, ['planInput', 'candidate', 'localGzip', 'expectedIdentity'], 'dry-run input');
  const identity = expectedIdentity(input.expectedIdentity);
  assertStagingPlanInput(input.planInput);
  const plan = planCapture(input.planInput);
  validateArtifacts(input, plan);
  return Object.freeze({ kind: 'lyfelabz.hostingCaptureDryRun', mode: 'dry-run', plan, expectedIdentity: identity, scope: OAUTH_SCOPE,
    minimumRequests: 6 + plan.requests.edge.length, maximumRequests: 4 + 2 * MAX_PAGES + plan.requests.edge.length,
    prerequisites: Object.freeze(['live execution separately authorized', 'real broker absent', 'IAM and identity verification absent', 'protected evidence anchor absent']),
    liveExecutionEnabled: false, trustedLiveProvenance: false, ...AUTHORITY });
}
// Fixture-only HTTPS architecture. Deliberately no https client or default connector:
// even constructing this object requires both test doubles. Logical DNS is IPv4
// public-unicast only; IPv6 and special/private ranges fail closed in this phase.
function publicAddress(address) {
  if (typeof address !== 'string' || isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 ||
    a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
function createFixtureHttpsTransport(options) {
  exact(options, ['fixtureRequest', 'fixtureResolve'], 'fixture transport options');
  const { fixtureRequest, fixtureResolve } = options;
  if (typeof fixtureRequest !== 'function' || typeof fixtureResolve !== 'function') refuse('explicit fixture connectors required');
  let aggregate = 0;
  return async function fixtureTransport(request) {
    if (request.method !== 'GET' || !['provider', 'edge'].includes(request.surface)) refuse('GET-only fixture transport');
    const u = request.surface === 'provider' ? assertProviderUrl(request.url) : assertEdgeUrl(request.url, new URL(request.url).origin, new URL(request.url).searchParams.get('hosting-release'));
    const h = headerMap(request.headers, 'request');
    const allowed = request.surface === 'provider' ? ['accept', 'accept-encoding', 'authorization'] : EDGE_REQUEST_HEADERS;
    if (Object.keys(h).some(k => !allowed.includes(k)) || h.authorization !== undefined && !SYNTHETIC_MARKER.test(h.authorization) ||
        h.accept !== (request.surface === 'provider' ? 'application/json' : '*/*') ||
        !(request.surface === 'provider' ? h['accept-encoding'] === 'identity' : ENCODINGS.includes(h['accept-encoding']))) refuse('fixture request header policy');
    if (!request.signal || request.signal.aborted) throw fault('E_CANCELLED', 'capture cancelled');
    // A malicious test double is never a trust anchor and can only produce synthetic evidence.
    const answers = await fixtureResolve(u.hostname, Object.freeze({ signal: request.signal }));
    if (request.signal.aborted) throw fault('E_CANCELLED', 'capture cancelled');
    if (!Array.isArray(answers) || !answers.length || answers.some(a => !publicAddress(a))) refuse('unapproved DNS destination', 'E_DNS');
    const address = answers[0];
    const maxBytes = request.surface === 'provider' ? PROVIDER_MAX_BYTES : EDGE_MAX_BYTES;
    if (request.maxBytes !== maxBytes) refuse('fixture request byte policy');
    return new Promise((resolve, reject) => {
      let req, res, settled = false, size = 0;
      const chunks = [];
      const done = (error, result) => {
        if (settled) return;
        settled = true; request.signal.removeEventListener('abort', abort);
        if (error) { req?.destroy(); res?.destroy(); reject(error); } else resolve(result);
      };
      const abort = () => done(fault('E_CANCELLED', 'capture cancelled'));
      request.signal.addEventListener('abort', abort, { once: true });
      const lookup = (hostname, settings, callback) => {
        if (hostname !== u.hostname) return callback(fault('E_DNS', 'unapproved DNS destination'));
        callback(null, settings?.all ? [{ address, family: 4 }] : address, 4);
      };
      try {
        req = fixtureRequest(Object.freeze({ protocol: 'https:', hostname: u.hostname, port: 443, method: 'GET', path: u.pathname + u.search,
          headers: Object.freeze({ ...h }), agent: false, lookup, family: 4, servername: u.hostname,
          rejectUnauthorized: true, checkServerIdentity: checkServerIdentity, maxHeaderSize: SAFETY_LIMITS.headerBytes,
          signal: request.signal, followRedirects: false, proxy: false }), response => {
          res = response;
          if (settled || request.signal.aborted) { res.destroy(); return; }
          try {
            if (res.socket?.remoteAddress !== address || !res.socket.encrypted || !res.socket.authorized || checkServerIdentity(u.hostname, res.socket.getPeerCertificate())) refuse('TLS validation failed', 'E_TLS');
            if (!Number.isInteger(res.statusCode)) refuse('invalid response status');
            if (res.statusCode >= 300 && res.statusCode < 400) refuse('redirect refused before following', 'E_REDIRECT');
            if (res.statusCode !== 200) refuse('HTTP error; no retry', 'E_HTTP');
            if (!Array.isArray(res.rawHeaders) || res.rawHeaders.length % 2) refuse('invalid response headers', 'E_HEADERS');
            let bytes = 2; const headers = {};
            for (let i = 0; i < res.rawHeaders.length; i += 2) {
              const key = res.rawHeaders[i], value = res.rawHeaders[i + 1];
              if (typeof key !== 'string' || typeof value !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n\x00]/.test(value)) refuse('invalid response headers', 'E_HEADERS');
              bytes += Buffer.byteLength(key) + Buffer.byteLength(value) + 4;
              const lower = key.toLowerCase();
              if (Object.hasOwn(headers, lower)) refuse('duplicate response header', 'E_HEADERS');
              Object.defineProperty(headers, lower, { value, enumerable: true });
            }
            if (bytes > SAFETY_LIMITS.headerBytes) refuse('oversized response headers', 'E_HEADERS');
            res.on('error', () => done(fault('E_POLICY', 'response stream failed')));
            res.on('aborted', () => done(fault('E_POLICY', 'response stream aborted')));
            res.on('close', () => { if (!settled) done(fault('E_POLICY', 'response stream closed early')); });
            res.on('data', chunk => {
              if (settled) return;
              if (request.signal.aborted) return abort();
              if (!Buffer.isBuffer(chunk)) return done(fault('E_SIZE', 'response body must be bytes'));
              size += chunk.length; aggregate += chunk.length;
              if (size > maxBytes) return done(fault('E_SIZE', 'streaming response size limit exceeded'));
              if (aggregate > SAFETY_LIMITS.aggregateBytes) return done(fault('E_AGGREGATE', 'aggregate response byte limit exceeded'));
              chunks.push(chunk);
            });
            res.on('end', () => { if (request.signal.aborted) return abort(); done(null, { status: res.statusCode, url: request.url, redirectCount: 0, headers, body: Buffer.concat(chunks, size) }); });
          } catch (error) { done(internalErrors.has(error) ? error : fault('E_TLS', 'TLS validation failed')); }
        });
        req.on('error', error => done(fault(['ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error.code) ? 'E_TLS' : 'E_POLICY', 'fixture connection failed')));
        if (settled) req.destroy(); else if (request.signal.aborted) abort(); else req.end();
      } catch { done(fault('E_POLICY', 'fixture connection failed')); }
    });
  };
}

// createExecutor({ transport, clock, wallStartMs, concurrency, timeoutMs?, edgeAcceptEncoding?,
//                  syntheticAuthorizationMarker?, fakeBroker?, expectedIdentity? }) -> { capture({ planInput, candidate, localGzip }) }
//   transport(request) -> Promise<{ status, url, redirectCount, headers, body: Buffer }>
//     request { surface: 'provider' | 'edge', method: 'GET', url, headers, maxBytes, signal }
//   clock() -> monotonic milliseconds; wallStartMs is the explicit wall-clock start.
function createExecutor(options) {
  const allowed = ['transport', 'clock', 'wallStartMs', 'concurrency', 'timeoutMs', 'edgeAcceptEncoding', 'syntheticAuthorizationMarker', 'fakeBroker', 'expectedIdentity'];
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

  const identity = options.fakeBroker === undefined && options.expectedIdentity === undefined ? null : expectedIdentity(options.expectedIdentity);
  if (options.fakeBroker !== undefined && typeof options.fakeBroker !== 'function') refuse('explicit fake broker required');
  if (identity !== null && (options.fakeBroker === undefined || syntheticAuthorizationMarker !== null)) refuse('fake broker must be explicit and cannot fall back to a marker');
  let session = null;
  async function send(surface, url, headers, maxBytes) {
    session.check();
    const controller = new AbortController();
    let timer;
    const abort = () => controller.abort(session.controller.signal.reason);
    session.controller.signal.addEventListener('abort', abort, { once: true });
    let rejectCancelled;
    const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
    const onAbort = () => rejectCancelled(controller.signal.reason || fault('E_CANCELLED', 'capture cancelled'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const remaining = MAX_WINDOW_MS - session.elapsedMs();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = remaining <= timeoutMs ? fault('E_DEADLINE', 'observation window exceeds five minutes; capture stopped') : fault('E_TIMEOUT', 'request timeout; no retry');
        controller.abort(error); reject(error);
      }, Math.min(timeoutMs, Math.max(0, remaining)));
    });
    const request = Object.freeze({ surface, method: 'GET', url, headers: Object.freeze({ ...headers }), maxBytes, signal: controller.signal });
    try {
      const response = await Promise.race([Promise.resolve().then(() => { session.check(); return transport(request); }), timeout, cancelled]);
      session.check();
      if (Buffer.isBuffer(response?.body)) {
        session.bytes += response.body.length;
        if (session.bytes > SAFETY_LIMITS.aggregateBytes) refuse('aggregate response byte limit exceeded', 'E_AGGREGATE');
      }
      return response;
    } catch (error) { session.cancel(error); throw error; }
    finally {
      clearTimeout(timer);
      session.controller.signal.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', onAbort);
    }
  }
  async function provider(url) {
    assertProviderUrl(url);
    const headers = { accept: 'application/json', 'accept-encoding': 'identity' };
    if (session.marker !== null) headers.authorization = session.marker;
    const response = await send('provider', url, headers, PROVIDER_MAX_BYTES);
    const h = checkResponse(response, url, PROVIDER_MAX_BYTES, 'provider');
    if (!PROVIDER_CONTENT_TYPE.test(h['content-type'] || '')) refuse('provider response is not application/json');
    if ((h['content-encoding'] || 'identity').trim().toLowerCase() !== 'identity') refuse('provider response is encoded; identity was requested');
    session.decodedBytes += response.body.length;
    if (session.decodedBytes > SAFETY_LIMITS.aggregateBytes) refuse('aggregate decoded byte limit exceeded', 'E_AGGREGATE');
    return providerJson(response.body);
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
    session.check();
    session.decodedBytes += decoded.length;
    if (session.decodedBytes > SAFETY_LIMITS.aggregateBytes) refuse('aggregate decoded byte limit exceeded', 'E_AGGREGATE');
    const decodedSha256 = sha256(decoded);
    const diagnostics = { rawSha256: sha256(raw), rawLength: raw.length, decodedSha256, contentEncoding: encoding,
      contentLength: Object.hasOwn(h, 'content-length') ? Number(h['content-length']) : null,
      etag: null, age: null, cacheControl: null, xCache: null, xServedBy: null, responseUrl: response.url, nonce, redirectCount: 0 };
    for (const [header, field] of Object.entries(DIAGNOSTIC_HEADERS)) if (Object.hasOwn(h, header)) diagnostics[field] = h[header];
    return { decodedSha256, diagnostics };
  }

  // Single use prevents overlapping runs from sharing cancellation or byte budgets.
  async function capture(input) {
    const keys = Object.keys(input || {});
    for (const key of keys) if (!['planInput', 'candidate', 'localGzip'].includes(key)) refuse(`unknown capture input: ${key}`);
    if (session !== null) refuse('executor is single-use');
    assertStagingPlanInput(input.planInput);
    const plan = planCapture(input.planInput);
    const mono0 = clock();
    if (!Number.isFinite(mono0)) refuse('invalid monotonic clock');
    let last = mono0;
    const elapsed = () => {
      const t = clock();
      if (!Number.isFinite(t) || t < last) refuse('monotonic clock moved backwards');
      last = t;
      return t - mono0;
    };
    const controller = new AbortController();
    const cancel = error => { if (!controller.signal.aborted) controller.abort(error); };
    session = { controller, cancel, bytes: 0, decodedBytes: 0, elapsedMs: () => last - mono0, marker: syntheticAuthorizationMarker, check: () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (elapsed() > MAX_WINDOW_MS) { const error = fault('E_DEADLINE', 'observation window exceeds five minutes; capture stopped'); cancel(error); throw error; }
    } };
    const deadlineTimer = setTimeout(() => cancel(fault('E_DEADLINE', 'observation window exceeds five minutes; capture stopped')), MAX_WINDOW_MS);
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
    let fileEntries = 0;
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
      validateArtifacts(input, plan);
      if (identity !== null) {
        let rejectAbort;
        const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
        const onAbort = () => rejectAbort(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        try { session.marker = await Promise.race([fakeCredential(options.fakeBroker, identity, wallStartMs), cancelled]); }
        finally { controller.signal.removeEventListener('abort', onAbort); }
        session.check();
      }
      const before = await liveChannels('before');
      for (const m of plan.requests.manifest) {
        const bodyBefore = before[m.target];
        const site = SITES[m.target];
        const names = [`sites/${site}/channels/live`, `projects/${PROJECT}/sites/${site}/channels/live`, `projects/${PROJECT_NUMBER}/sites/${site}/channels/live`];
        const versionName = String(bodyBefore?.release?.version?.name || '');
        const match = new RegExp(`^(?:projects/(?:${PROJECT}|${PROJECT_NUMBER})/)?sites/${site}/versions/([a-f0-9]+)$`).exec(versionName);
        if (!names.includes(bodyBefore?.name)) refuse('unexpected channel identity', 'E_IDENTITY');
        const versionId = match?.[1];
        if (!versionId) refuse(`${m.target} before read names no valid version`);
        const base = m.urlTemplate.replace('{versionId}', versionId);
        const seen = new Set();
        let token = null;
        for (let n = 0; ; n += 1) {
          if (n >= MAX_PAGES) refuse('maximum page count exceeded', 'E_PAGES');
          const url = token === null ? base : `${base}?pageToken=${encodeURIComponent(token)}`;
          counts.manifest += 1;
          const body = await provider(url);
          if (body.files !== undefined && !Array.isArray(body.files)) refuse('provider response is not JSON');
          fileEntries += body.files?.length || 0;
          if (fileEntries > SAFETY_LIMITS.fileEntries) refuse('aggregate file-entry limit exceeded', 'E_ENTRIES');
          exchanges.push({ id: `${m.id}:${n}`, observedAt: observed(), request: { method: 'GET', url }, response: { status: 200, body } });
          if (!Object.hasOwn(body, 'nextPageToken')) break;
          const next = body.nextPageToken;
          if (typeof next !== 'string' || next.length > MAX_TOKEN_LENGTH || !PAGE_TOKEN.test(next)) refuse(`${m.target} manifest page ${n} has a malformed continuation token`);
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
          } catch (error) { failure = failure || error; cancel(error); }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, plan.requests.edge.length) }, worker));
      if (failure) throw failure;
      await liveChannels('after');
      transcript = { kind: TRANSCRIPT_KIND, schemaVersion: 1, planFingerprint: fingerprint(plan), provenance: { ...PROVENANCE },
        startedAt, completedAt: observed(), exchanges };
    } catch (error) {
      cancel(error);
      refusal = { stage: 'capture', ...safeFailure(error) };
    } finally { clearTimeout(deadlineTimer); }
    if (transcript !== null) {
      try {
        // The unchanged Part D replay owns release stability, manifest, binding and byte rules.
        replay = replayCapture({ planInput: input.planInput, transcript, candidate: input.candidate, localGzip: input.localGzip,
          receipt: null, now: transcript.completedAt });
      } catch (error) {
        refusal = { stage: 'replay', ...replayFailure(error) };
        transcript = null;
      }
    }
    let duration;
    try { duration = elapsed(); } catch { duration = Math.max(0, last - mono0); }
    // Never serialize response bodies, URLs, cursors, headers or error strings on
    // failure. Completed exchange digests retain integrity diagnostics only.
    const failureEvidence = refusal === null ? null : Object.freeze({
      kind: 'lyfelabz.hostingCaptureFailure', schemaVersion: 1, complete: false, provenance: PROVENANCE.kind,
      code: refusal.code, startedAt, elapsedMs: duration, receivedBytes: session.bytes,
      requests: { ...counts }, completedExchanges: exchanges.map(e => ({ exchangeIdSha256: sha256(Buffer.from(e.id)),
        observedAt: e.observedAt, responseSha256: sha256(Buffer.from(JSON.stringify(e.response))) })),
      trustedLiveProvenance: false, ...AUTHORITY
    });
    return Object.freeze({
      kind: RESULT_KIND, schemaVersion: 1,
      outcome: refusal === null ? 'replayed' : 'refused',
      provenance: PROVENANCE.kind,
      liveTransport: LIVE_TRANSPORT,
      capture: Object.freeze({ executor: PROVENANCE.tool, transport: 'injected', project: PROJECT, projectNumber: PROJECT_NUMBER,
        sites: SITES, origins: ORIGINS, credentialCategory: identity !== null ? 'fake-broker' : syntheticAuthorizationMarker === null ? 'none' : 'synthetic-marker',
        edgeAcceptEncoding, concurrency, timeoutMs }),
      requests: Object.freeze({ ...counts }),
      replayEvaluatedAt: replay === null ? null : transcript.completedAt,
      transcript, replay, refusal, failureEvidence,
      timing: Object.freeze({ elapsedMs: duration, hardLimitMs: MAX_WINDOW_MS }),
      trustedLiveProvenance: false,
      limitations: LIMITATIONS,
      deployable: false, certified: false, authorized: false, available: false
    });
  }
  return Object.freeze({ capture });
}

module.exports = { createExecutor, assertProviderUrl, assertEdgeUrl, RESULT_KIND, PROVENANCE, LIVE_TRANSPORT, PROJECT, PROJECT_NUMBER,
  SITES, ORIGINS, PROVIDER_MAX_BYTES, EDGE_MAX_BYTES, createFixtureHttpsTransport, dryRun, OAUTH_SCOPE, SAFETY_LIMITS };
