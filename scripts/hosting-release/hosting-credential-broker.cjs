'use strict';

// D13 G4: synthetic-only credential contract. Production dependencies are absent.
// Injected responses establish fixture consistency, never authenticated identity.
// No network, credential discovery, environment, filesystem or operational entry.
const PROJECT = 'lyfelabz-staging';
const PROJECT_NUMBER = '293337283840';
const EMAIL = 'hosting-observer@lyfelabz-staging.iam.gserviceaccount.com';
const SCOPE = 'https://www.googleapis.com/auth/firebase.readonly';
const LIFETIME_MS = 600000;
const WINDOW_MS = 300000;
const MARGIN_MS = 30000;
const TIMEOUT_MS = 30000;
const INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const FLAGS = Object.freeze({ deployable: false, certified: false, authorized: false, available: false });
const OPERATOR = /^synthetic-operator:[a-z0-9-]{1,64}$/;
const HOSTING = /^synthetic-hosting:[a-z0-9-]{1,64}$/;
const errors = new WeakMap();
function fail(code = 'E_CONTRACT') {
  const e = new Error('Offline credential broker refused');
  e.code = code; errors.set(e, code); throw e;
}
function record(value, required, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail();
  const keys = Object.getOwnPropertyNames(value);
  if (required.some(k => !keys.includes(k)) || keys.some(k => !required.includes(k) && !optional.includes(k))) fail();
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d.enumerable || !('value' in d) || d.value === undefined) fail();
  }
}
function text(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9@._:-]{1,128}$/.test(value)) fail(); }
function pin(value) {
  record(value, ['project', 'projectNumber', 'serviceAccountEmail', 'accountId']);
  if (value.project !== PROJECT || value.projectNumber !== PROJECT_NUMBER || value.serviceAccountEmail !== EMAIL ||
      typeof value.accountId !== 'string' || !/^[1-9][0-9]{9,29}$/.test(value.accountId) || value.accountId === PROJECT_NUMBER) fail('E_IDENTITY');
  return Object.freeze({ ...value });
}
function freezeRequest(method, url, body) {
  if (body) { Object.freeze(body.scope); Object.freeze(body); }
  return Object.freeze(body ? { method, url, body } : { method, url });
}
// Pure builder. No override keys, delegates, alternate lifetime or scope accepted.
function buildMintRequest(identity) {
  try {
    const p = pin(identity);
    return freezeRequest('POST', `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${p.accountId}:generateAccessToken`,
      { scope: [SCOPE], lifetime: '600s' });
  } catch { fail('E_IDENTITY'); }
}
function targetMetadata(body, p) {
  record(body, ['projectId', 'email', 'uniqueId', 'disabled']);
  if (body.projectId !== p.project || body.email !== p.serviceAccountEmail || body.uniqueId !== p.accountId || body.disabled !== false) fail('E_IDENTITY');
}
function timestamp(value) {
  // Canonical millisecond UTC subset; refuses normalized invalid calendar dates.
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail('E_EXPIRY');
  const n = Date.parse(value);
  if (!Number.isSafeInteger(n) || new Date(n).toISOString() !== value) fail('E_EXPIRY');
  return n;
}
function mintResponse(body, sent, received) {
  record(body, ['accessToken', 'expireTime']);
  if (typeof body.accessToken !== 'string' || !HOSTING.test(body.accessToken)) fail('E_CREDENTIAL');
  const expiry = timestamp(body.expireTime);
  // Issuance must fit inside this exact 600-second request interval, zero skew.
  if (expiry < sent + LIFETIME_MS || expiry > received + LIFETIME_MS) fail('E_EXPIRY');
  return { marker: body.accessToken, expiry };
}
function inspection(body, p, mintExpiry, sent, received) {
  // Service-account access-token profile, not user tokens, ID tokens or v1 fields.
  // Google documents azp/aud as the service account's unique ID. Email is optional.
  record(body, ['azp', 'aud', 'scope', 'exp', 'expires_in'], ['email', 'email_verified', 'access_type']);
  if (body.azp !== p.accountId || body.aud !== p.accountId ||
      Object.hasOwn(body, 'email') && body.email !== p.serviceAccountEmail ||
      Object.hasOwn(body, 'email_verified') && ![true, 'true'].includes(body.email_verified) ||
      Object.hasOwn(body, 'access_type') && body.access_type !== 'online') fail('E_IDENTITY');
  if (body.scope !== SCOPE) fail('E_SCOPE');
  const integer = x => typeof x === 'number' && Number.isSafeInteger(x) || typeof x === 'string' && /^(0|[1-9][0-9]*)$/.test(x) && Number.isSafeInteger(Number(x));
  if (!integer(body.exp) || !integer(body.expires_in)) fail('E_EXPIRY');
  const expiry = Number(body.exp) * 1000;
  const remaining = Number(body.expires_in) * 1000;
  // Whole-second metadata can round down by less than one second.
  if (!Number.isSafeInteger(expiry) || remaining <= 0 || remaining > LIFETIME_MS ||
      expiry > mintExpiry || mintExpiry - expiry >= 1000 ||
      expiry + 999 < sent + remaining || expiry >= received + remaining + 1000) fail('E_EXPIRY');
  return Math.min(mintExpiry, expiry, sent + remaining);
}
function providerRequest(request) {
  record(request, ['method', 'url']);
  if (request.method !== 'GET' || typeof request.url !== 'string') fail('E_ENDPOINT');
  let u;
  try { u = new URL(request.url); } catch { fail('E_ENDPOINT'); }
  const site = '(?:lyfelabz-staging|lyfelabz-staging-marketing)';
  const base = `/v1beta1/projects/${PROJECT}/sites/${site}`;
  if (u.href !== request.url || u.origin !== 'https://firebasehosting.googleapis.com' || u.username || u.password || u.port || u.hash) fail('E_ENDPOINT');
  if (new RegExp(`^${base}/channels/live$`).test(u.pathname) && !u.search) return Object.freeze({ ...request });
  const keys = [...u.searchParams.keys()];
  if (new RegExp(`^${base}/versions/[a-f0-9]+/files$`).test(u.pathname) &&
      (!u.search || keys.length === 1 && keys[0] === 'pageToken' && /^[A-Za-z0-9_\-.~+/=]{1,2048}$/.test(u.searchParams.get('pageToken')))) return Object.freeze({ ...request });
  fail('E_ENDPOINT');
}

// createFixtureBroker({identity, operator, clock, fixtures}) -> { acquire({signal}) }
// clock() -> {wallMs, monotonicMs}; fixtures are explicit, mandatory test doubles.
// Each dependency returns {request: exactRequestObject, body: syntheticRecord}.
// Reference association prevents accidental response/request swaps, not forgery by
// arbitrary injected code. All results and capabilities remain synthetic-only.
function createFixtureBroker(options) {
  try {
    record(options, ['identity', 'operator', 'clock', 'fixtures']);
    const identity = pin(options.identity);
    record(options.operator, ['sourceId', 'subject']);
    text(options.operator.sourceId); text(options.operator.subject);
    const operator = Object.freeze({ ...options.operator });
    const clock = options.clock;
    if (typeof clock !== 'function') fail();
    record(options.fixtures, ['operator', 'target', 'mint', 'inspect', 'provider']);
    const fixtures = Object.freeze({ ...options.fixtures });
    if (Object.values(fixtures).some(f => typeof f !== 'function')) fail();
    let used = false;
    async function acquire(input) {
      let controller, timer, detach = () => {}, marker = null, last = null, setupStart = null, acquiring = true;
      try {
        record(input, ['signal']);
        if (!(input.signal instanceof AbortSignal) || used) fail();
        used = true;
        controller = new AbortController();
        const abort = () => controller.abort();
        input.signal.addEventListener('abort', abort, { once: true });
        detach = () => input.signal.removeEventListener('abort', abort);
        if (input.signal.aborted) abort();
        function now() {
          const t = clock(); record(t, ['wallMs', 'monotonicMs']);
          if (!Number.isSafeInteger(t.wallMs) || t.wallMs <= 0 || !Number.isSafeInteger(t.monotonicMs) || t.monotonicMs < 0 ||
              last && (t.monotonicMs < last.monotonicMs || t.wallMs - last.wallMs !== t.monotonicMs - last.monotonicMs)) fail('E_CLOCK');
          last = { ...t };
          if (acquiring && setupStart !== null && t.wallMs - setupStart >= TIMEOUT_MS) fail('E_TIMEOUT');
          return t.wallMs;
        }
        async function call(fn, request, privateMarker) {
          if (controller.signal.aborted) fail('E_CANCELLED');
          const sent = now();
          let onAbort;
          const cancelled = new Promise((_, reject) => {
            onAbort = () => { const e = new Error('Offline credential broker refused'); e.code = 'E_CANCELLED'; errors.set(e, 'E_CANCELLED'); reject(e); };
            controller.signal.addEventListener('abort', onAbort, { once: true });
          });
          try {
            const response = await Promise.race([Promise.resolve().then(() => {
              if (controller.signal.aborted) fail('E_CANCELLED');
              return fn(Object.freeze({ request, marker: privateMarker, signal: controller.signal }));
            }), cancelled]);
            if (controller.signal.aborted) fail('E_CANCELLED');
            if (now() - sent >= TIMEOUT_MS) fail('E_TIMEOUT');
            record(response, ['request', 'body']);
            if (response.request !== request) fail('E_ASSOCIATION');
            return response.body;
          } finally { controller.signal.removeEventListener('abort', onAbort); }
        }
        const start = now(); setupStart = start;
        timer = setTimeout(abort, TIMEOUT_MS);
        const operatorRequest = Object.freeze({ sourceId: operator.sourceId });
        const op = await call(fixtures.operator, operatorRequest, null);
        record(op, ['sourceId', 'subject', 'marker']);
        if (op.sourceId !== operator.sourceId || op.subject !== operator.subject) fail('E_OPERATOR');
        if (typeof op.marker !== 'string' || !OPERATOR.test(op.marker)) fail('E_CREDENTIAL');
        const targetRequest = freezeRequest('GET', `https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/${identity.accountId}`);
        targetMetadata(await call(fixtures.target, targetRequest, op.marker), identity);
        const mintRequest = buildMintRequest(identity);
        const mintSent = now();
        const minted = mintResponse(await call(fixtures.mint, mintRequest, op.marker), mintSent, now());
        marker = minted.marker;
        const inspectRequest = freezeRequest('POST', INFO_URL);
        const infoSent = now();
        const expiry = inspection(await call(fixtures.inspect, inspectRequest, marker), identity, minted.expiry, infoSent, now());
        const completed = now();
        if (completed - start >= TIMEOUT_MS) fail('E_TIMEOUT');
        if (expiry - completed < WINDOW_MS + MARGIN_MS) fail('E_EXPIRY');
        clearTimeout(timer); acquiring = false;
        let closed = false, busy = false, dispatched = false;
        function close() { closed = true; marker = null; controller.abort(); detach(); }
        const capability = Object.create(null);
        Object.defineProperties(capability, {
          close: { value: close },
          request: { value: async request => {
            try {
              if (closed || busy || controller.signal.aborted) fail('E_CANCELLED');
              busy = true;
              const current = now();
              if (current >= expiry || !dispatched && expiry - current < WINDOW_MS + MARGIN_MS) fail('E_EXPIRY');
              dispatched = true;
              const safe = providerRequest(request);
              timer = setTimeout(abort, TIMEOUT_MS);
              // No raw provider response escapes this contract's private fixture seam.
              const body = await call(fixtures.provider, safe, marker);
              record(body, ['accepted']);
              if (body.accepted !== true || now() >= expiry) fail();
              return Object.freeze({ provenance: 'synthetic-fixture', accepted: true, ...FLAGS });
            } catch { close(); throw Object.assign(new Error('Offline credential broker refused'), { code: 'E_CAPABILITY' }); }
            finally { clearTimeout(timer); busy = false; }
          } }
        });
        Object.freeze(capability);
        return Object.freeze({ kind: 'lyfelabz.offlineCredentialBroker', provenance: 'synthetic-fixture',
          trustedLiveProvenance: false, productionDependencies: 'not-implemented', identity,
          scope: SCOPE, expiresAt: new Date(expiry).toISOString(), captureWindowMs: WINDOW_MS, safetyMarginMs: MARGIN_MS,
          capability, ...FLAGS });
      } catch (e) {
        marker = null; controller?.abort(); detach(); clearTimeout(timer);
        // Never expose callback errors, provider bodies, request objects or markers.
        return Object.freeze({ kind: 'lyfelabz.offlineCredentialBroker', provenance: 'synthetic-fixture',
          outcome: 'refused', code: errors.get(e) || 'E_DEPENDENCY', capability: null,
          trustedLiveProvenance: false, productionDependencies: 'not-implemented', ...FLAGS });
      }
    }
    return Object.freeze({ acquire });
  } catch { throw Object.assign(new Error('Offline credential broker configuration refused'), { code: 'E_CONFIG' }); }
}
module.exports = { buildMintRequest, createFixtureBroker, PROJECT, PROJECT_NUMBER, EMAIL, SCOPE, LIFETIME_MS, WINDOW_MS, MARGIN_MS };
