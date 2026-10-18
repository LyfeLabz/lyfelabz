'use strict';

// A3-6 S6f: staging-only, non-authorizing provider discovery.
//
// Certified S6c capture verifies an approved deployment plan; it cannot discover
// one. Discovery records what the staging provider returns for the S4 and S5 read
// surfaces without any plan, keeps partial observations, and classifies each
// resource as observed-present, observed-absent, unreadable, incomplete,
// inconsistent or not-observed. Absence is established only by a complete, valid
// listing; a 401, 403, 404, transport failure, partial pagination or unreadable
// listing is never absence.
//
// What discovery is not: certified evidence, deployment evidence, an S4
// observation, an S5 access review, an S6c capture, a deployment plan, an
// approval, a certification, a registration, an activation or a fresh
// observation. It resolves none of the gates G1 to G5. A replayable transcript is
// internally consistent only: a fully consistent forged transcript cannot be
// authenticated offline, and TLS origin cannot be proven after the fact.
//
// Staging only. The target is fixed to lyfelabz-staging (293337283840) and is
// enforced here independently of the CLI, and again on every request URL,
// including URLs built from provider-returned names. Credentials and request
// headers are never recorded. The live exchange is the certified S6c GET-only
// exchange (redirects refused, bounded bodies, 30 s timeout).
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_NUMBERS, MAX_AGE_MS, LIMITS, canonical, fingerprint, normalizeRemoteIndexes, archiveRuntime } = require('../hosting-release/backend-state.cjs');
const { sha256 } = require('../hosting-release/contract.cjs');
const O = require('./provider-observation.cjs');
const R = require('./access-review.cjs');
const PC = require('./provider-capture.cjs');
const SO = require('./surface-observation.cjs');

const K = require(path.join(path.resolve(__dirname, '../../platform/functions/lib/teacherUnits'), 'a3-canonical.js'));

const PROJECT = 'lyfelabz-staging';
const PROJECT_NUMBER = '293337283840';
const ENVIRONMENT = 'staging';
const REGION = 'us-central1';
// Production identities that no discovery request may name, raw or percent-decoded.
const FORBIDDEN = Object.freeze(['lyfelabz-prod', '182791689935']);
if (PROJECT_NUMBERS[PROJECT] !== PROJECT_NUMBER) throw new Error('[a3-staging-discovery] REFUSED: staging project number binding changed');
// The documented Cloud Functions v2 source bucket convention [U: not observed live].
const SOURCE_BUCKET = `gcf-v2-sources-${PROJECT_NUMBER}-${REGION}`;
const REPOSITORY_ROOT = path.resolve(__dirname, '../..');

const TRANSCRIPT_KIND = 'lyfelabz.teacherUnitsA3StagingDiscoveryTranscript';
const REPORT_KIND = 'lyfelabz.teacherUnitsA3StagingDiscoveryReport';
const BUNDLE_KIND = 'lyfelabz.teacherUnitsA3StagingDiscovery';
const AUTHORITY = 'none: staging discovery; not deployment evidence and not an observation for capture, plan approval, release, certification, registration or activation';
const ATTESTATION = 'none: transcript bytes are internally consistent only; a fully consistent forged transcript cannot be authenticated offline';
const FRESHNESS = 'historical: discovery establishes no freshness and is never an observation for a later capture or enable';
const EVIDENCE_CLASSES = Object.freeze(['synthetic', 'operator-discovered-unattested']);
const CLAIMS = Object.freeze({ certifiedEvidence: false, deploymentEvidence: false, providerVerified: false, planProduced: false,
  releaseAuthorized: false, activationReady: false });
const GATES = Object.freeze({ G1: 'not-resolved', G2: 'not-resolved', G3: 'not-resolved', G4: 'not-resolved', G5: 'not-resolved' });
const UNRESOLVED = Object.freeze(['G1', 'G2', 'G3', 'G4', 'G5', 'D9', 'D12', 'D13', 'S6c live capture', 'S6e', 'A3-7', 'inheritedIam (S6c-D1)']);
const DEFERRED = Object.freeze({
  hosting: 'not-observed: deferred to S6c capture', domainMappings: 'not-observed: deferred to S6c capture',
  serverlessNetworkEndpointGroups: 'not-observed: deferred to S6c capture', backendServices: 'not-observed: deferred to S6c capture',
  inheritedIam: 'not-observed: GET-only (S6c-D1)' });
const FILES = Object.freeze({ transcript: 'discovery-transcript.json', report: 'discovery-report.json', bundle: 'discovery.json' });
const STATUSES = SO.STATUSES;
const MAX_READS = 400;
const WINDOW_MS = MAX_AGE_MS;
// The S6c live exchange aborts each request after 30 s; no read starts once less
// than this margin remains, so a started read completes inside the window.
const MARGIN_MS = 45000;
const TERMINATIONS = Object.freeze(['read-limit', 'time-budget', 'window-exceeded', 'guard-refusal', 'identity-mismatch']);
const MODES = Object.freeze(['json', 'binary']);
const PRINCIPAL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]+$/;

function refuse(message) { throw new Error(`[a3-staging-discovery] REFUSED: ${message}`); }
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const canonicalBytes = value => Buffer.from(K.canonicalJSON(value), 'utf8');
const bound = (text, max = 300) => String(text).replace(/[^\x20-\x7e]/g, '?').slice(0, max);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Staging-only target, enforced in the module independently of the CLI. */
function stagingOnly(project) {
  if (project !== PROJECT) refuse(`staging discovery requires the explicit project ${PROJECT}; production and every other project are refused`);
}

// --- request URL guard (layered on the certified S6c allowlist) --------------
const ID = `(?:${PROJECT}|${PROJECT_NUMBER})`;
const TOKEN = { pattern: /^[\x21-\x7e]{1,2048}$/ };
const POLICY_VERSION = { values: ['3'], required: true };
// Query allowlists are Maps built from own literal keys only (certification F1): an
// inherited property name such as toString, __proto__ or hasOwnProperty is never a rule.
const ROUTES = Object.freeze([
  { host: 'firebase.googleapis.com', path: new RegExp(`^/v1beta1/projects/${PROJECT}$`), query: {} },
  { host: 'firestore.googleapis.com', path: new RegExp(`^/v1/projects/${PROJECT}/databases/\\(default\\)$`), query: {} },
  { host: 'firestore.googleapis.com', path: new RegExp(`^/v1/projects/${PROJECT}/databases/\\(default\\)/collectionGroups/-/indexes$`), query: { pageToken: TOKEN } },
  { host: 'firestore.googleapis.com', path: new RegExp(`^/v1/projects/${PROJECT}/databases/\\(default\\)/collectionGroups/-/fields$`),
    query: { filter: { values: ['indexConfig.usesAncestorConfig=false', 'ttlConfig:*'], required: true }, pageToken: TOKEN } },
  { host: 'cloudfunctions.googleapis.com', path: new RegExp(`^/v2/projects/${PROJECT}/locations/-/functions$`), query: { pageToken: TOKEN } },
  { host: 'cloudfunctions.googleapis.com', path: new RegExp(`^/v2/projects/${ID}/locations/${REGION}/functions/[A-Za-z][A-Za-z0-9_-]{0,62}$`), query: {} },
  { host: 'cloudfunctions.googleapis.com', path: new RegExp(`^/v2/projects/${ID}/locations/${REGION}/functions/[A-Za-z][A-Za-z0-9_-]{0,62}:getIamPolicy$`), query: { 'options.requestedPolicyVersion': POLICY_VERSION } },
  { host: 'run.googleapis.com', path: new RegExp(`^/v2/projects/${ID}/locations/${REGION}/services/[a-z][a-z0-9-]{0,62}$`), query: {} },
  { host: 'run.googleapis.com', path: new RegExp(`^/v2/projects/${ID}/locations/${REGION}/services/[a-z][a-z0-9-]{0,62}/revisions/[a-z][a-z0-9-]{0,99}$`), query: {} },
  { host: 'run.googleapis.com', path: new RegExp(`^/v2/projects/${ID}/locations/${REGION}/services/[a-z][a-z0-9-]{0,62}:getIamPolicy$`), query: { 'options.requestedPolicyVersion': POLICY_VERSION } },
  { host: 'storage.googleapis.com', path: new RegExp(`^/storage/v1/b/${SOURCE_BUCKET}/o/[A-Za-z0-9%._~-]{1,3072}$`),
    query: { alt: { values: ['media'], required: true }, generation: { pattern: /^[1-9][0-9]{0,18}$/, required: true } } },
  { host: 'firebaserules.googleapis.com', path: new RegExp(`^/v1/projects/${PROJECT}/releases/cloud\\.firestore$`), query: {} },
  { host: 'firebaserules.googleapis.com', path: new RegExp(`^/v1/projects/${ID}/rulesets/[A-Za-z0-9_-]{1,128}$`), query: {} },
].map(r => Object.freeze({ host: r.host, path: r.path, query: new Map(Object.keys(r.query).map(k => [k, Object.freeze({ ...r.query[k] })])) })));
const QUERY_KEY = /^[A-Za-z][A-Za-z0-9.]{0,63}$/;
const CREDENTIAL_QUERY = /^(?:access_token|key|api_key|apikey|token|oauth_token|bearer_token|authorization|x-goog-api-key|signature|x-goog-signature|x-goog-credential)$/i;

/**
 * Every discovery request passes the certified S6c allowlist (https, allowlisted
 * Google API host, no credentials, port or fragment, no custom method but
 * getIamPolicy) and then this staging guard: canonical URL form, no production
 * identity raw or decoded, an exact staging path, and an exact query allowlist.
 */
function assertDiscoveryUrl(url) {
  if (typeof url !== 'string') refuse('request URL must be a string');
  const u = PC.assertAllowedUrl(url);
  if (u.href !== url) refuse(`request URL is not in canonical form: ${u.hostname}`);
  let decoded;
  try { decoded = decodeURIComponent(url); } catch { return refuse(`malformed percent-encoding in request URL: ${u.hostname}`); }
  for (const id of FORBIDDEN) if (url.toLowerCase().includes(id) || decoded.toLowerCase().includes(id)) refuse(`request names a production identity (${id}); staging discovery never targets production`);
  const keys = [...u.searchParams.keys()];
  for (const key of keys) if (CREDENTIAL_QUERY.test(key)) refuse(`credential-bearing query parameter refused: ${bound(key, 64)}`);
  const route = ROUTES.find(r => r.host === u.hostname && r.path.test(u.pathname));
  if (!route) refuse(`request path outside the staging discovery allowlist: ${u.hostname}`);
  if (url.includes('?') && !u.search) refuse(`empty query refused: ${u.hostname}`);
  if (new Set(keys).size !== keys.length) refuse(`duplicate query parameter refused: ${u.hostname}`);
  for (const key of keys) {
    if (!QUERY_KEY.test(key) || !route.query.has(key)) refuse(`unknown query parameter refused: ${bound(key, 64)}`);
    const rule = route.query.get(key);
    const value = u.searchParams.get(key);
    if ((rule.values && !rule.values.includes(value)) || (rule.pattern && !rule.pattern.test(value))) refuse(`query parameter ${key} has an unapproved value`);
  }
  for (const [key, rule] of route.query) if (rule.required && !keys.includes(key)) refuse(`required query parameter missing: ${key}`);
  if (u.hostname === 'storage.googleapis.com') {
    const object = decodeURIComponent(u.pathname.split('/o/')[1]);
    if (!/^[A-Za-z0-9._/-]{1,1024}$/.test(object) || object.startsWith('/') || object.split('/').some(s => s === '..' || s === '.' || s === '')) refuse('source object path is unsafe');
  }
  return u;
}

// --- provider-derived names (first layer: validated before any URL is built) --
const NAMES = Object.freeze({
  function: new RegExp(`^projects/${ID}/locations/([a-z0-9-]{1,63})/functions/([A-Za-z0-9_-]{1,63})$`),
  service: new RegExp(`^projects/${ID}/locations/${REGION}/services/[a-z][a-z0-9-]{0,62}$`),
  revision: /^[a-z][a-z0-9-]{0,99}$/,
  ruleset: new RegExp(`^projects/${ID}/rulesets/[A-Za-z0-9_-]{1,128}$`),
});
const named = (re, value) => typeof value === 'string' && re.test(value) && !FORBIDDEN.some(id => value.toLowerCase().includes(id));
const INT64_MAX = 9223372036854775807n;
function sourceOf(fn) {
  const s = fn?.buildConfig?.sourceProvenance?.resolvedStorageSource;
  if (!plain(s)) return { problem: 'incomplete', reason: 'resolved generation-pinned source missing' };
  const { bucket, object, generation } = s;
  if (typeof bucket !== 'string' || typeof object !== 'string' || typeof generation !== 'string') return { problem: 'incomplete', reason: 'resolved source bucket, object or generation malformed' };
  if (bucket !== SOURCE_BUCKET) return { problem: 'inconsistent', reason: FORBIDDEN.some(id => bucket.toLowerCase().includes(id)) ? 'source bucket names a production identity; not read' : 'source bucket is not the staging Functions source bucket; not read' };
  if (!/^[A-Za-z0-9._/-]{1,1024}$/.test(object) || object.startsWith('/') || object.split('/').some(p => p === '..' || p === '.' || p === '')) return { problem: 'inconsistent', reason: 'source object path is unsafe; not read' };
  if (!/^[1-9][0-9]{0,18}$/.test(generation) || BigInt(generation) > INT64_MAX) return { problem: 'incomplete', reason: 'source generation is not a canonical positive int64' };
  return { bucket, object, generation,
    url: `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media&generation=${generation}` };
}

// --- active-credential sanitization (certification F2) -------------------------
// A provider response can echo the request's access token (for example in an error
// message). Discovery knows exactly one secret, the active token, and removes it from
// every response body and failure reason BEFORE anything is hashed, recorded or
// parsed, so the transcript, the replay and every derived file are free of it and
// replay stays deterministic. Matching, per character of the token: the literal
// character, a percent escape `%XX` with hex digits in any case (uppercase, lowercase
// or mixed), or a JSON `\u00XX` escape in any hex case (and `\/` for a slash), in any
// mixture; plus the token's hex encoding in any case; plus standard and URL-safe
// Base64 at all three byte alignments (the characters that depend only on the token,
// so an embedding in any larger Base64 value, including `Bearer <token>`, is found).
// This is not universal redaction: other secrets, or the token under any other
// transformation, cannot be recognized, so the raw transcript stays sensitive. The
// report never copies free-text provider error messages.
//
// Four distinct things: (1) the ORIGINAL provider response, which is never stored when
// it contained the token; (2) the SANITIZED RECORDED response, whose bytes the
// transcript hashes; (3) operator-captured, unattested evidence: whether sanitization
// ran is an operator-side declaration that replay cannot confirm, and nothing is
// provider-attested; (4) offline integrity verification, which proves only that the
// files are consistent with the recorded (sanitized) bytes. The number of redaction
// markers is derived from the recorded bytes as a diagnostic: a marker can also be
// provider-originated, and zero markers prove neither that scanning ran nor that the
// original response held no sensitive material.
const REDACTED = Buffer.from('[REDACTED-ACTIVE-CREDENTIAL]', 'ascii');
const MIN_CREDENTIAL = 16;
const SANITIZATION = Object.freeze(['active-credential-removed-before-recording', 'not-applied']);
const SANITIZATION_NOTE = 'operator-declared at recording; replay cannot confirm it; markers are diagnostic only and may be provider-originated';
const reEscape = c => c.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
const hexAnyCase = b => [...b.toString(16).padStart(2, '0')].map(d => (/[a-f]/.test(d) ? `[${d}${d.toUpperCase()}]` : d)).join('');
function credentialMatchers(token) {
  if (typeof token !== 'string' || token.length < MIN_CREDENTIAL || !/^[\x21-\x7e]+$/.test(token)) refuse('the active credential is malformed; it is never recorded');
  const raw = Buffer.from(token, 'ascii');
  const textual = [...raw].map(b => {
    const alternatives = [reEscape(String.fromCharCode(b)), `%${hexAnyCase(b)}`, `\\\\u00${hexAnyCase(b)}`];
    if (b === 0x2f) alternatives.push('\\\\/');
    return `(?:${alternatives.join('|')})`;
  }).join('');
  const cores = new Set();
  for (let k = 0; k < 3; k++) {
    const b64 = Buffer.concat([Buffer.alloc(k), raw]).toString('base64').replace(/=+$/, '');
    const core = b64.slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + raw.length)) / 6));
    cores.add(core); cores.add(core.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  const base64 = [...cores].filter(c => c.length >= MIN_CREDENTIAL).sort((a, b) => b.length - a.length || byText(a, b)).map(reEscape);
  return [new RegExp(textual, 'g'), new RegExp([...raw].map(hexAnyCase).join(''), 'g'), new RegExp(base64.join('|'), 'g')];
}
function redactor(token) {
  if (token === undefined) return { bytes: b => b, text: t => t };
  const matchers = credentialMatchers(token), marker = REDACTED.toString('latin1');
  const text = input => matchers.reduce((out, re) => out.replace(re, marker), input);
  return { bytes: b => Buffer.from(text(b.toString('latin1')), 'latin1'), text: t => Buffer.from(text(Buffer.from(String(t), 'utf8').toString('latin1')), 'latin1').toString('utf8') };
}
const markers = buf => { let n = 0, at = -1; while ((at = buf.indexOf(REDACTED, at + 1)) !== -1) n++; return n; };
/** Redacts the CLI's error text for the active credential before it is printed. */
function redactText(text, token) { return token === undefined ? String(text) : redactor(token).text(String(text)); }

// --- transport: failure-tolerant recording and exact replay ------------------
function failureReason(error, url, clean = t => t) {
  const message = String(error?.message || '');
  let host; try { host = new URL(url).host; } catch { host = 'unknown host'; }
  return bound(clean(/^\[a3-[a-z-]+\] REFUSED: /.test(message) ? message : `[a3-staging-discovery] REFUSED: provider read failed: ${host}`), 300);
}
function monotonic(start) {
  let last = O.instant(start, 'discovery start');
  return value => {
    const t = O.instant(value, 'discovery clock');
    if (t < last) refuse('discovery clock moved backwards or transcript times are reordered');
    last = t;
    return value;
  };
}
/** Records every exchange outcome, including transport failures, as an event. Nothing is written here. */
function createRecorder({ exchange, clock, activeCredential }) {
  if (typeof exchange !== 'function' || typeof clock !== 'function') refuse('an explicit exchange and clock are required');
  const clean = redactor(activeCredential);
  const startedAt = clock(), tick = monotonic(startedAt), events = [];
  return {
    startedAt,
    now() { const at = tick(clock()); events.push({ type: 'clock', at }); return at; },
    async read(url, mode) {
      assertDiscoveryUrl(url);
      const limit = mode === 'binary' ? LIMITS.archiveBytes : LIMITS.jsonBytes;
      const requestedAt = tick(clock());
      let result, failed = null;
      try {
        result = await exchange(url, limit);
        if (!plain(result) || !Number.isSafeInteger(result.status) || result.status < 100 || result.status > 599 || !Buffer.isBuffer(result.bytes)) failed = failureReason(new Error(`[a3-staging-discovery] REFUSED: malformed exchange result: ${new URL(url).host}`), url, clean.text);
        else if (result.bytes.length > limit) failed = failureReason(new Error(`[a3-staging-discovery] REFUSED: oversized provider response: ${new URL(url).host}`), url, clean.text);
      } catch (error) { failed = failureReason(error, url, clean.text); }
      const completedAt = tick(clock());
      if (failed !== null) { const e = { type: 'failure', method: 'GET', url, mode, reason: failed, requestedAt, completedAt }; events.push(e); return { ...e }; }
      // The active credential is removed before the bytes are hashed, recorded or parsed.
      const bytes = clean.bytes(Buffer.from(result.bytes));
      const e = { type: 'read', method: 'GET', url, mode, status: result.status, sha256: sha256(bytes), body: bytes.toString('base64'), requestedAt, completedAt };
      events.push(e);
      return { ...e, bytes };
    },
    finish() { return { startedAt, completedAt: tick(clock()), events }; },
  };
}
function base64(value, d) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) refuse(`${d} body is not Base64`);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) refuse(`${d} body is not canonical Base64`);
  return bytes;
}
/** Feeds recorded outcomes back in order; any request, order, status or body difference refuses. */
function createReplayer(transcript) {
  const tick = monotonic(transcript.startedAt), events = transcript.events;
  let i = 0;
  const next = () => { if (i >= events.length) refuse('transcript is missing a response or clock reading'); return events[i++]; };
  return {
    startedAt: transcript.startedAt,
    now() { const e = next(); if (e.type !== 'clock') refuse(`transcript entries are reordered or unexpected at event ${i - 1}`); return tick(e.at); },
    async read(url, mode) {
      assertDiscoveryUrl(url);
      const e = next();
      if ((e.type !== 'read' && e.type !== 'failure') || e.url !== url || e.mode !== mode || e.method !== 'GET') refuse(`transcript request differs from the replayed request at event ${i - 1} (type, URL, method or mode)`);
      tick(e.requestedAt); tick(e.completedAt);
      if (e.type === 'failure') return { ...e };
      const bytes = base64(e.body, `transcript event ${i - 1}`);
      if (sha256(bytes) !== e.sha256) refuse(`transcript response bytes altered at event ${i - 1}`);
      return { ...e, bytes };
    },
    finish() {
      if (i !== events.length) refuse('transcript has extra entries that the replay did not request');
      return { startedAt: transcript.startedAt, completedAt: tick(transcript.completedAt), events };
    },
  };
}

// --- session: budget, termination and outcome classification -----------------
function createSession(transport) {
  const start = O.instant(transport.startedAt, 'discovery start');
  const elapsedMs = at => Number((O.instant(at, 'discovery clock') - start) / 1000000n);
  const s = { reads: 0, termination: null, eventCount: 0 };
  const terminate = (reason, detail) => { if (!s.termination) s.termination = { reason, afterEvents: s.eventCount, detail: bound(detail, 300) }; };
  s.terminate = terminate;
  s.read = async (url, mode = 'json') => {
    if (s.termination) return { kind: 'stopped' };
    if (s.reads >= MAX_READS) { terminate('read-limit', `the ${MAX_READS}-read limit was reached; no further request was made`); return { kind: 'stopped' }; }
    const at = transport.now(); s.eventCount++;
    if (elapsedMs(at) > WINDOW_MS - MARGIN_MS) { terminate('time-budget', `less than ${MARGIN_MS} ms of the ${WINDOW_MS} ms window remained; no further request was made`); return { kind: 'stopped' }; }
    // Second layer: every URL, including those built from provider names, is re-checked before any request.
    try { assertDiscoveryUrl(url); } catch (error) { terminate('guard-refusal', error.message); return { kind: 'stopped' }; }
    s.reads++;
    const e = await transport.read(url, mode); s.eventCount++;
    if (elapsedMs(e.completedAt) > WINDOW_MS) terminate('window-exceeded', 'a read completed after the five-minute window; no further request was made');
    if (e.type === 'failure') return { kind: 'failure', reason: e.reason };
    let json;
    if (mode === 'json') { try { json = JSON.parse(e.bytes.toString('utf8')); } catch { json = undefined; } }
    return { kind: 'response', status: e.status, json, bytes: e.bytes, completedAt: e.completedAt };
  };
  return s;
}
const ok = r => r.kind === 'response' && r.status >= 200 && r.status < 300;
const REASON = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/;
function providerError(status, json) {
  const e = plain(json) && plain(json.error) ? json.error : null;
  // Structured fields only (certification F2): reasons and status must be identifier
  // tokens; free-text messages, details and bodies are never copied into the report.
  const reasons = new Set(); let unrecognized = 0;
  const reasonOf = d => { if (!plain(d) || d.reason === undefined) return; if (typeof d.reason === 'string' && REASON.test(d.reason)) reasons.add(d.reason); else unrecognized++; };
  if (e && Array.isArray(e.details)) e.details.forEach(reasonOf);
  if (e && Array.isArray(e.errors)) e.errors.forEach(reasonOf);
  const list = [...reasons].sort(byText);
  const kind = status === 401 ? 'unauthenticated' : status === 403 ? (list.some(r => /SERVICE_DISABLED|accessNotConfigured|API_DISABLED/i.test(r)) ? 'api-disabled' : 'permission-denied')
    : status === 404 ? 'not-found' : status === 429 ? 'rate-limited' : 'http-error';
  return { kind, httpStatus: status, providerCode: e && Number.isSafeInteger(e.code) ? e.code : null,
    providerStatus: e && typeof e.status === 'string' && /^[A-Z][A-Z_]{0,63}$/.test(e.status) ? e.status : null, reasons: list, unrecognizedReasons: unrecognized,
    message: e && typeof e.message === 'string' ? 'present: not copied (see the transcript event; sensitive)' : null };
}
/** The status of one read, or null when it is a 2xx JSON object. Never absence. */
function outcome(r) {
  if (r.kind === 'stopped') return { status: 'not-observed', reason: 'discovery terminated before this read' };
  if (r.kind === 'failure') return { status: 'unreadable', reason: { kind: 'transport', detail: r.reason } };
  if (!ok(r)) return { status: 'unreadable', reason: providerError(r.status, r.json) };
  if (r.json !== undefined && !plain(r.json)) return { status: 'incomplete', reason: 'response is not a JSON object' };
  if (r.json === undefined) return { status: 'incomplete', reason: 'response is not JSON' };
  return null;
}
const present = extra => ({ status: 'observed-present', ...extra });
const notObserved = reason => ({ status: 'not-observed', reason });

// --- listings ------------------------------------------------------------------
/**
 * Follows pagination; every page must be a valid JSON object of documented keys.
 * Only a listing that ended with no issue is complete. Entries already seen are
 * kept whatever happens to a later page.
 */
async function listing(s, url, key, { omittedIsEmpty = false } = {}) {
  const out = { status: null, pages: 0, entries: [], issues: [], failure: null, complete: false };
  const tokens = new Set();
  let next = url;
  for (;;) {
    if (out.pages >= LIMITS.pages) { out.issues.push('pagination limit reached'); break; }
    const r = await s.read(next);
    out.pages++;
    const failed = outcome(r);
    if (failed) { out.failure = failed; break; }
    const page = r.json;
    const undocumented = Object.keys(page).filter(k => ![key, 'nextPageToken', 'unreachable'].includes(k)).sort(byText);
    if (undocumented.length) out.issues.push(`undocumented listing fields: ${bound(undocumented.join(', '), 120)}`);
    if (page.unreachable !== undefined && (!Array.isArray(page.unreachable) || page.unreachable.length)) out.issues.push('listing reports unreachable locations or a malformed unreachable list');
    if (page[key] === undefined) { if (!omittedIsEmpty) out.issues.push(`listing page omits ${key}; never read as empty`); }
    else if (!Array.isArray(page[key])) out.issues.push(`malformed ${key} collection`);
    else for (const entry of page[key]) { if (plain(entry) && typeof entry.name === 'string') out.entries.push(entry); else out.issues.push('malformed listing entry'); }
    if (page.nextPageToken === undefined) { out.complete = true; break; }
    const token = page.nextPageToken;
    if (typeof token !== 'string' || !TOKEN.pattern.test(token) || tokens.has(token)) { out.issues.push('malformed or repeated pagination token'); break; }
    tokens.add(token);
    next = `${url}${url.includes('?') ? '&' : '?'}pageToken=${encodeURIComponent(token)}`;
  }
  out.status = out.failure ? (out.pages > 1 && out.failure.status === 'not-observed' ? 'incomplete' : out.failure.status)
    : out.issues.length || !out.complete ? 'incomplete' : 'observed-present';
  return out;
}
const WORST = ['inconsistent', 'unreadable', 'incomplete', 'not-observed'];
const worst = statuses => WORST.find(w => statuses.includes(w)) || 'observed-present';
function inventoryPass(raw) {
  const functions = [], issues = [...raw.issues];
  let unbound = 0;
  for (const entry of raw.entries) {
    const m = named(NAMES.function, entry.name) ? NAMES.function.exec(entry.name) : null;
    if (!m) { unbound++; continue; }
    functions.push({ name: entry.name, id: m[2], location: m[1], environment: typeof entry.environment === 'string' ? bound(entry.environment, 40) : null,
      state: typeof entry.state === 'string' ? bound(entry.state, 40) : null, updateTime: typeof entry.updateTime === 'string' ? bound(entry.updateTime, 40) : null });
  }
  if (unbound) issues.push(`${unbound} listed function name(s) not bound to the staging project`);
  functions.sort((a, b) => byText(a.name, b.name));
  const status = unbound ? 'inconsistent' : raw.status;
  return { status, pages: raw.pages, functions, issues, reason: raw.failure ? raw.failure.reason : null };
}
function presenceOf(id, first, second, overall) {
  const a = first.functions.filter(f => f.id === id), b = second.functions.filter(f => f.id === id);
  if (overall === 'observed-present') {
    if (a.length === 1) return present({ name: a[0].name, location: a[0].location });
    if (a.length === 0) return { status: 'observed-absent', reason: 'not in a complete, valid two-pass Functions listing' };
    return { status: 'inconsistent', reason: 'listed more than once' };
  }
  if (a.length > 1 || b.length > 1) return { status: 'inconsistent', reason: 'listed more than once' };
  if (overall === 'inconsistent' && a.length === 1 && b.length === 1 && canonical(a[0]) === canonical(b[0])) return present({ name: a[0].name, location: a[0].location });
  if (overall === 'inconsistent' && (a.length || b.length)) return { status: 'inconsistent', reason: 'listing differs between passes for this endpoint' };
  if (a.length === 1 || b.length === 1) return present({ name: (a[0] || b[0]).name, location: (a[0] || b[0]).location, note: 'listed in an incomplete listing' });
  return { status: overall, reason: 'absence is never inferred from an incomplete, unreadable or inconsistent listing' };
}

// --- surfaces -------------------------------------------------------------------
async function observeProject(s) {
  const r = await s.read(`https://firebase.googleapis.com/v1beta1/projects/${PROJECT}`);
  const failed = outcome(r);
  if (failed) return failed;
  const p = r.json;
  if (p.projectId !== PROJECT || String(p.projectNumber) !== PROJECT_NUMBER || p.name !== `projects/${PROJECT}`) {
    s.terminate('identity-mismatch', 'the Firebase project identity does not match lyfelabz-staging (293337283840)');
    return { status: 'inconsistent', reason: 'Firebase project identity does not match lyfelabz-staging (293337283840)' };
  }
  return present({ state: typeof p.state === 'string' ? bound(p.state, 40) : null });
}
async function observeDatabase(s) {
  const r = await s.read(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`);
  const failed = outcome(r);
  if (failed) return failed;
  const db = r.json;
  if (db.name !== `projects/${PROJECT}/databases/(default)`) return { status: 'inconsistent', reason: 'database name does not match the staging default database' };
  return present({ type: typeof db.type === 'string' ? bound(db.type, 40) : null, deleteTimePresent: db.deleteTime !== undefined,
    dataAccessMode: typeof db.firestoreDataAccessMode === 'string' ? bound(db.firestoreDataAccessMode, 60) : null });
}
function names(list) { return [...new Set(list)].sort(byText); }
const envName = v => typeof v === 'string' && /^[\x21-\x7e]{1,256}$/.test(v);
/** G1/G2 observations: variable NAMES only, never values; update policy as reported. */
function gateObservations(fn, revision) {
  const sc = plain(fn?.serviceConfig) ? fn.serviceConfig : {}, bc = plain(fn?.buildConfig) ? fn.buildConfig : {};
  let malformed = 0;
  const keysOf = obj => (plain(obj) ? Object.keys(obj).filter(k => envName(k) || (malformed++, false)) : []);
  const secretKeys = Array.isArray(sc.secretEnvironmentVariables) ? sc.secretEnvironmentVariables.map(v => (plain(v) && envName(v.key) ? v.key : (malformed++, null))).filter(Boolean) : [];
  const containers = Array.isArray(revision?.containers) ? revision.containers : [];
  const revisionPlain = [], revisionSecret = [];
  for (const c of containers) for (const v of (plain(c) && Array.isArray(c.env) ? c.env : [])) {
    if (!plain(v) || !envName(v.name)) { malformed++; continue; }
    (v.valueSource !== undefined ? revisionSecret : revisionPlain).push(v.name);
  }
  const automatic = bc.automaticUpdatePolicy !== undefined, onDeploy = bc.onDeployUpdatePolicy !== undefined;
  return {
    g1: { functionEnvironmentNames: names(keysOf(sc.environmentVariables)), functionSecretNames: names(secretKeys), buildEnvironmentNames: names(keysOf(bc.environmentVariables)),
      revisionEnvironmentNames: names(revisionPlain), revisionSecretNames: names(revisionSecret), malformedEntries: malformed, values: 'never recorded in the report' },
    g2: { reportedUpdatePolicy: automatic && onDeploy ? 'ambiguous' : automatic ? 'automatic' : onDeploy ? 'on-deploy' : 'absent',
      baseImageUriPresent: containers.some(c => plain(c) && typeof c.baseImageUri === 'string') },
  };
}
async function snapshot(s, entry, id) {
  const fnRead = await s.read(`https://cloudfunctions.googleapis.com/v2/${entry.name}`);
  const result = { fnRead, fn: outcome(fnRead), serviceName: null, revisionId: null, serviceRead: null, revisionRead: null };
  if (!result.fn && fnRead.json.name !== entry.name) result.fn = { status: 'inconsistent', reason: 'function name differs from the listing' };
  if (result.fn) { result.service = notObserved('function unavailable'); result.revision = notObserved('function unavailable'); return result; }
  result.fn = present();
  const sc = fnRead.json.serviceConfig;
  if (!plain(sc) || !named(NAMES.service, sc.service) || !named(NAMES.revision, sc.revision)) {
    const reason = `${id} service or revision name missing or not bound to staging ${REGION}; not read`;
    result.service = { status: 'inconsistent', reason }; result.revision = { status: 'inconsistent', reason };
    return result;
  }
  result.serviceName = sc.service; result.revisionId = sc.revision;
  result.serviceRead = await s.read(`https://run.googleapis.com/v2/${sc.service}`);
  result.service = outcome(result.serviceRead) || (result.serviceRead.json.name === sc.service ? present() : { status: 'inconsistent', reason: 'service name differs from the function serviceConfig' });
  const revisionName = `${sc.service}/revisions/${sc.revision}`;
  result.revisionRead = await s.read(`https://run.googleapis.com/v2/${revisionName}`);
  result.revision = outcome(result.revisionRead) || (result.revisionRead.json.name === revisionName ? present() : { status: 'inconsistent', reason: 'revision name differs from the function serviceConfig' });
  return result;
}
const readView = r => (r === null ? null : r.kind === 'response' ? { status: r.status, sha256: sha256(r.bytes) } : { kind: r.kind, reason: r.reason || null });
async function observeArchive(s, source, archives) {
  if (archives.has(source.url)) return archives.get(source.url);
  const r = await s.read(source.url, 'binary');
  let result;
  if (r.kind !== 'response' || !ok(r)) result = r.kind === 'response' ? { status: 'unreadable', reason: providerError(r.status, (() => { try { return JSON.parse(r.bytes.toString('utf8')); } catch { return undefined; } })()) } : outcome(r);
  else {
    const base = { bucket: source.bucket, object: source.object, generation: source.generation, archiveSha256: sha256(r.bytes), sizeBytes: r.bytes.length };
    try {
      const unpacked = archiveRuntime(r.bytes);
      result = present({ ...base, runtimePayloadFingerprint: O.payloadSummary(unpacked.runtimeFiles), functionsArtifactFingerprint: unpacked.artifactFingerprint,
        placementFingerprint: unpacked.placementFingerprint, archive: { ...unpacked, runtimePayloadFingerprint: O.payloadSummary(unpacked.runtimeFiles), source: { bucket: source.bucket, object: source.object, generation: source.generation } } });
    } catch (error) {
      // The A1 unpacker's message can carry a random temporary path; paths are replaced so replay is deterministic.
      result = { status: 'incomplete', reason: `archive unverifiable: ${bound(String(error.message).replace(/\/[^\s'"]*/g, '<path>'))}`, ...base };
    }
  }
  archives.set(source.url, result);
  return result;
}
function stripMessage(error) { return bound(String(error?.message || 'unknown').replace(/^\[[a-z0-9-]+\] REFUSED: /, ''), 500); }
async function policyDiagnostic(s, url, d) {
  const r = await s.read(url);
  const failed = outcome(r);
  if (failed) return { ...failed, diagnostic: 'not-run' };
  try {
    const normalized = R.normalizePolicy(r.json, PROJECT, d);
    return present({ diagnostic: 'accepted', version: normalized.policy.version, bindings: normalized.policy.bindings });
  } catch (error) { return present({ diagnostic: 'refused', reason: stripMessage(error) }); }
}
async function observeEndpoint(s, id, pass, archives) {
  const record = { endpoint: id, listing: null, function: notObserved('not listed exactly once in the first Functions listing'),
    service: notObserved('function not observed'), revision: notObserved('function not observed'), consistency: notObserved('function not observed'),
    source: notObserved('function not observed'), s4Diagnostic: { result: 'not-run', reason: 'function, service, revision and source archive were not all observed' },
    s5Diagnostic: { functionPolicy: notObserved('function not observed'), servicePolicy: notObserved('service not observed') },
    observations: null };
  const matches = pass.functions.filter(f => f.id === id);
  if (matches.length !== 1) return record;
  const entry = matches[0];
  if (entry.location !== REGION) {
    record.function = { status: 'inconsistent', reason: `listed outside ${REGION}; not read` };
    return record;
  }
  const first = await snapshot(s, entry, id);
  Object.assign(record, { function: first.fn, service: first.service, revision: first.revision });
  if (first.fn.status !== 'observed-present') return record;
  const fn = first.fnRead.json;
  const source = sourceOf(fn);
  let archive = null;
  if (source.problem) record.source = { status: source.problem, reason: source.reason };
  else {
    archive = await observeArchive(s, source, archives);
    const { archive: unpacked, ...visible } = archive;
    record.source = visible;
  }
  const second = await snapshot(s, entry, id);
  const views = x => [readView(x.fnRead), readView(x.serviceRead), readView(x.revisionRead)];
  if ([second.fnRead, second.serviceRead, second.revisionRead].some(r => r && r.kind === 'stopped')) record.consistency = notObserved('second pass not completed');
  else record.consistency = canonical(views(first)) === canonical(views(second)) ? { status: 'observed-present', detail: 'function, service and revision unchanged across two passes' }
    : { status: 'inconsistent', reason: 'function, service or revision changed between passes' };
  record.observations = gateObservations(fn, first.revision.status === 'observed-present' ? first.revisionRead.json : null);
  record.s5Diagnostic.functionPolicy = await policyDiagnostic(s, `https://cloudfunctions.googleapis.com/v2/${entry.name}:getIamPolicy?options.requestedPolicyVersion=3`, `${id} function policy`);
  if (first.serviceName) {
    record.s5Diagnostic.servicePolicy = await policyDiagnostic(s, `https://run.googleapis.com/v2/${first.serviceName}:getIamPolicy?options.requestedPolicyVersion=3`, `${id} service policy`);
    if (first.service.status === 'observed-present') {
      const svc = first.serviceRead.json, flag = v => (typeof v === 'boolean' ? v : null);
      record.s5Diagnostic.serviceAccess = { ingress: typeof svc.ingress === 'string' ? bound(svc.ingress, 60) : null, invokerIamDisabled: flag(svc.invokerIamDisabled),
        iapEnabled: flag(svc.iapEnabled), defaultUriDisabled: flag(svc.defaultUriDisabled), interpretation: 'recorded only; not an access review' };
    }
  }
  if (first.service.status === 'observed-present' && first.revision.status === 'observed-present' && archive && archive.status === 'observed-present') {
    try {
      const n = O.normalizeEndpoint({ project: PROJECT, endpointName: id, fn, service: first.serviceRead.json, revision: first.revisionRead.json,
        archive: archive.archive, at: O.instant(first.revisionRead.completedAt, 'discovery clock') });
      record.s4Diagnostic = { result: 'accepted', configurationSha256: fingerprint(n.configuration), runtimeProfileSha256: fingerprint(n.runtimeProfile),
        artifact: n.artifact, note: 'normalizes under the certified S4 rules at this read; not an observation, not a plan' };
    } catch (error) { record.s4Diagnostic = { result: 'refused', reason: stripMessage(error) }; }
  }
  return record;
}
async function observeRules(s) {
  const r = await s.read(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`);
  const release = outcome(r) || (r.json.name === `projects/${PROJECT}/releases/cloud.firestore` ? null : { status: 'inconsistent', reason: 'Rules release name does not match staging' });
  if (release) return { release, ruleset: notObserved('release not observed') };
  const rel = r.json;
  const releaseRecord = present({ disabled: typeof rel.disabled === 'boolean' ? rel.disabled : null, updateTime: typeof rel.updateTime === 'string' ? bound(rel.updateTime, 40) : null });
  if (!named(NAMES.ruleset, rel.rulesetName)) return { release: releaseRecord, ruleset: { status: 'inconsistent', reason: 'ruleset name missing or not bound to staging; not read' } };
  const rs = await s.read(`https://firebaserules.googleapis.com/v1/${rel.rulesetName}`);
  const failed = outcome(rs);
  if (failed) return { release: releaseRecord, ruleset: failed };
  const files = rs.json.source?.files;
  if (rs.json.name !== rel.rulesetName) return { release: releaseRecord, ruleset: { status: 'inconsistent', reason: 'ruleset name differs from the release' } };
  if (!Array.isArray(files) || files.length !== 1 || !plain(files[0]) || typeof files[0].content !== 'string') return { release: releaseRecord, ruleset: { status: 'incomplete', reason: 'ruleset does not carry exactly one source file' } };
  return { release: releaseRecord, ruleset: present({ rulesetResource: rel.rulesetName, sourceHash: sha256(files[0].content) }) };
}
async function observeIndexes(s) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups/-`;
  const indexes = await listing(s, `${base}/indexes`, 'indexes', { omittedIsEmpty: true });
  const a = await listing(s, `${base}/fields?filter=indexConfig.usesAncestorConfig%3Dfalse`, 'fields', { omittedIsEmpty: true });
  const b = await listing(s, `${base}/fields?filter=ttlConfig%3A*`, 'fields', { omittedIsEmpty: true });
  const parts = { indexes: summaryOf(indexes), ancestorOverrides: summaryOf(a), ttlFields: summaryOf(b) };
  const status = worst([indexes.status, a.status, b.status]);
  if (status !== 'observed-present') return { status, listings: parts, readyIndexesConfigurationHash: null, diagnostic: 'not-run' };
  const byName = new Map();
  for (const f of [...a.entries, ...b.entries]) {
    if (byName.has(f.name) && canonical(byName.get(f.name)) !== canonical(f)) return { status: 'inconsistent', listings: parts, readyIndexesConfigurationHash: null, diagnostic: 'field differs between filters' };
    byName.set(f.name, f);
  }
  try {
    const normalized = normalizeRemoteIndexes(indexes.entries, [...byName.values()], PROJECT);
    return present({ listings: parts, readyIndexesConfigurationHash: fingerprint(normalized), diagnostic: 'accepted', indexCount: indexes.entries.length });
  } catch (error) { return present({ listings: parts, readyIndexesConfigurationHash: null, diagnostic: 'refused', reason: stripMessage(error) }); }
}
function summaryOf(l) { return { status: l.status, pages: l.pages, entries: l.entries.length, issues: l.issues, reason: l.failure ? l.failure.reason : null }; }

// --- run ------------------------------------------------------------------------
function principalOf(value) {
  if (value === undefined) return { status: 'not-recorded' };
  if (typeof value !== 'string' || !PRINCIPAL.test(value)) refuse('--principal must be a lowercase account email (an operator declaration, never verified)');
  return { status: 'operator-declared-unverified', value };
}
async function runDiscovery({ transport, evidenceClass, principal, sanitization }) {
  const s = createSession(transport);
  const project = await observeProject(s);
  const database = await observeDatabase(s);
  const pass1raw = await listing(s, `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/-/functions`, 'functions');
  const pass1 = inventoryPass(pass1raw);
  const archives = new Map(), endpoints = [];
  for (const id of O.ENDPOINTS) endpoints.push(await observeEndpoint(s, id, pass1, archives));
  const rules = await observeRules(s);
  const indexes = await observeIndexes(s);
  const pass2 = inventoryPass(await listing(s, `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/-/functions`, 'functions'));
  const view = p => p.functions;
  const overall = pass1.status === 'observed-present' && pass2.status === 'observed-present'
    ? (canonical(view(pass1)) === canonical(view(pass2)) ? 'observed-present' : 'inconsistent') : worst([pass1.status, pass2.status]);
  for (const e of endpoints) e.listing = presenceOf(e.endpoint, pass1, pass2, overall);
  const extra = names([...pass1.functions, ...pass2.functions].map(f => f.id).filter(id => /^teacherUnits/.test(id) && !O.ENDPOINTS.includes(id)));
  const finished = transport.finish();
  const reads = finished.events.filter(e => e.type !== 'clock');
  const identity = { environment: ENVIRONMENT, projectId: PROJECT, projectNumber: PROJECT_NUMBER, region: REGION };
  const window = { startedAt: finished.startedAt, completedAt: finished.completedAt, maxAgeMs: WINDOW_MS, marginMs: MARGIN_MS, maxReads: MAX_READS };
  const transcript = { schemaVersion: 1, kind: TRANSCRIPT_KIND, authority: AUTHORITY, attestation: ATTESTATION, evidenceClass, ...identity, principal, sanitization,
    startedAt: finished.startedAt, completedAt: finished.completedAt, termination: s.termination, events: finished.events };
  const passSummary = p => ({ status: p.status, pages: p.pages, functions: p.functions.length, issues: p.issues, reason: p.reason });
  const report = { schemaVersion: 1, kind: REPORT_KIND, authority: AUTHORITY, freshness: FRESHNESS, evidenceClass, ...identity, window,
    reads: { total: reads.length, transportFailures: reads.filter(e => e.type === 'failure').length, nonSuccess: reads.filter(e => e.type === 'read' && (e.status < 200 || e.status > 299)).length,
    },
    sanitization: { activeCredential: sanitization, declaration: SANITIZATION_NOTE,
      markersInRecordedEvidence: reads.reduce((n, e) => n + (e.type === 'read' ? markers(Buffer.from(e.body, 'base64')) : markers(Buffer.from(e.reason, 'utf8'))), 0) },
    termination: s.termination, project, database,
    inventory: { status: overall, passes: [passSummary(pass1), passSummary(pass2)], teacherUnitsFunctions: names([...pass1.functions, ...pass2.functions].map(f => f.id).filter(id => /^teacherUnits/.test(id))),
      extraTeacherUnitsFunctions: extra, absenceRule: 'observed-absent only from a complete, valid, unchanged two-pass listing' },
    endpoints, rules, indexes, deferredSurfaces: { ...DEFERRED }, gates: { ...GATES }, claims: { ...CLAIMS } };
  const bytes = { transcript: canonicalBytes(transcript), report: canonicalBytes(report) };
  const counts = Object.fromEntries(STATUSES.map(st => [st, endpoints.filter(e => e.listing.status === st).length]));
  const bundle = { schemaVersion: 1, kind: BUNDLE_KIND, authority: AUTHORITY, attestation: ATTESTATION, freshness: FRESHNESS, ...CLAIMS, gates: { ...GATES },
    evidenceClass, ...identity, principal, window, termination: s.termination ? s.termination.reason : null,
    summary: { endpointListing: counts, extraTeacherUnitsFunctions: extra.length, reads: report.reads, sanitization: report.sanitization },
    files: { transcript: { path: FILES.transcript, sha256: sha256(bytes.transcript) }, report: { path: FILES.report, sha256: sha256(bytes.report) } },
    unresolved: [...UNRESOLVED] };
  return { transcript, report, bundle, bytes: { ...bytes, bundle: canonicalBytes(bundle) } };
}

/** Records one discovery through `exchange(url, limit) -> {status, bytes}` and `clock()`. Nothing is written. */
/**
 * `activeCredential` (optional) is the access token the exchange sends; it is used
 * only to remove that token from recorded responses and is never stored.
 */
async function discover({ project, exchange, clock, evidenceClass, principal, activeCredential } = {}) {
  stagingOnly(project);
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) refuse('explicit evidence class required: synthetic or operator-discovered-unattested (never a capture class)');
  const declared = principalOf(principal);
  if (activeCredential !== undefined) credentialMatchers(activeCredential);
  return runDiscovery({ transport: createRecorder({ exchange, clock, activeCredential }), evidenceClass, principal: declared,
    sanitization: activeCredential === undefined ? 'not-applied' : 'active-credential-removed-before-recording' });
}

// --- offline verification -------------------------------------------------------
const EVENT_KEYS = { clock: ['at', 'type'], read: ['body', 'completedAt', 'method', 'mode', 'requestedAt', 'sha256', 'status', 'type', 'url'],
  failure: ['completedAt', 'method', 'mode', 'reason', 'requestedAt', 'type', 'url'] };
const TRANSCRIPT_KEYS = ['attestation', 'authority', 'completedAt', 'environment', 'events', 'evidenceClass', 'kind', 'principal', 'projectId', 'projectNumber',
  'region', 'sanitization', 'schemaVersion', 'startedAt', 'termination'];
function exactKeys(value, keys, d) {
  if (!plain(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) refuse(`${d} has missing or unknown fields`);
}
function assertTranscript(t) {
  exactKeys(t, TRANSCRIPT_KEYS, 'transcript');
  if (t.schemaVersion !== 1 || t.kind !== TRANSCRIPT_KIND || t.authority !== AUTHORITY || t.attestation !== ATTESTATION) refuse('not an S6f discovery transcript, or its authority or attestation literal is altered');
  if (!EVIDENCE_CLASSES.includes(t.evidenceClass)) refuse('transcript evidence class unsupported');
  if (!SANITIZATION.includes(t.sanitization)) refuse('transcript sanitization declaration unsupported');
  if (t.projectId !== PROJECT || t.environment !== ENVIRONMENT || t.projectNumber !== PROJECT_NUMBER || t.region !== REGION) refuse('cross-project or cross-environment transcript');
  if (!plain(t.principal) || K.canonicalJSON(principalOf(t.principal.status === 'not-recorded' ? undefined : t.principal.value)) !== K.canonicalJSON(t.principal)) refuse('transcript principal is malformed');
  if (t.termination !== null) {
    exactKeys(t.termination, ['afterEvents', 'detail', 'reason'], 'transcript termination');
    if (!TERMINATIONS.includes(t.termination.reason) || !Number.isSafeInteger(t.termination.afterEvents) || typeof t.termination.detail !== 'string') refuse('transcript termination is malformed');
  }
  if (!Array.isArray(t.events) || !t.events.length) refuse('transcript has no events');
  t.events.forEach((e, i) => {
    const d = `transcript event ${i}`;
    if (!plain(e) || !Object.hasOwn(EVENT_KEYS, e.type)) refuse(`${d} has an unknown type`);
    exactKeys(e, EVENT_KEYS[e.type], d);
    if (e.type === 'clock') return;
    if (e.method !== 'GET') refuse(`${d} method is not GET`);
    if (!MODES.includes(e.mode)) refuse(`${d} mode is malformed`);
    assertDiscoveryUrl(e.url);
    if (e.type === 'failure') { if (typeof e.reason !== 'string' || !/^\[a3-[a-z-]+\] REFUSED: [\x20-\x7e]{1,280}$/.test(e.reason)) refuse(`${d} failure reason is malformed`); return; }
    if (!Number.isSafeInteger(e.status) || e.status < 100 || e.status > 599 || !/^[a-f0-9]{64}$/.test(e.sha256)) refuse(`${d} is malformed`);
    base64(e.body, d);
  });
}
/**
 * Offline. Replays the transcript through the same discovery code and requires
 * every file to equal the re-derived bytes exactly. Nothing a file claims is
 * trusted. Consistency is not authenticity: a fully consistent forged transcript
 * cannot be detected offline. The result is historical and non-authorizing.
 */
async function verifyDiscovery({ project, files } = {}) {
  stagingOnly(project);
  if (!plain(files) || JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(Object.keys(FILES).sort()) || Object.values(files).some(b => !Buffer.isBuffer(b))) {
    refuse(`discovery files required exactly: ${Object.values(FILES).join(', ')}`);
  }
  let transcript;
  try { transcript = K.parseStrictJSON(files.transcript.toString('utf8')); } catch { return refuse('transcript is not strict JSON'); }
  assertTranscript(transcript);
  if (!canonicalBytes(transcript).equals(files.transcript)) refuse('transcript bytes are not canonical');
  const replay = await runDiscovery({ transport: createReplayer(transcript), evidenceClass: transcript.evidenceClass, principal: transcript.principal,
    sanitization: transcript.sanitization });
  for (const key of Object.keys(FILES)) if (!replay.bytes[key].equals(files[key])) refuse(`${FILES[key]} differs from the replayed discovery`);
  return Object.freeze({ verified: 'replay-consistent: re-derived from the transcript bytes only; not authenticated', ...CLAIMS, gates: { ...GATES },
    freshness: FRESHNESS, evidenceClass: replay.bundle.evidenceClass, window: replay.bundle.window, termination: replay.bundle.termination,
    summary: replay.bundle.summary, bundleSha256: sha256(files.bundle) });
}

// --- sensitive output ------------------------------------------------------------
function within(child, parent) { return child === parent || child.startsWith(parent + path.sep); }
function exists(p) { try { fs.lstatSync(p); return true; } catch { return false; } }
/** Every output check, before any credential or request: outside the repository, new, parent present. */
function prepareOutput(out, { cwd = process.cwd(), repositoryRoot = REPOSITORY_ROOT } = {}) {
  if (typeof out !== 'string' || !out) refuse('--out is required');
  const target = path.resolve(cwd, out);
  if (within(target, path.resolve(repositoryRoot))) refuse('--out is inside the repository working tree; discovery evidence is sensitive and is written only outside it');
  let parent;
  try { parent = fs.realpathSync(path.dirname(target)); } catch { return refuse('--out parent directory does not exist'); }
  const final = path.join(parent, path.basename(target));
  const root = fs.realpathSync(repositoryRoot);
  if (within(final, root)) refuse('--out is inside the repository working tree; discovery evidence is sensitive and is written only outside it');
  if (exists(final) || exists(`${final}.incomplete`)) refuse('--out already exists (existing output is never overwritten)');
  return final;
}
/**
 * Writes into an exclusive `<out>.incomplete` directory (0700, files 0600, `wx`),
 * the bundle last, then renames it to `<out>`. A directory still named
 * `.incomplete` is never a complete discovery.
 */
function writeOutput(final, bytes) {
  const pending = `${final}.incomplete`;
  try { fs.mkdirSync(pending, { mode: 0o700 }); } catch { refuse('--out could not be created (existing output is never overwritten)'); }
  fs.chmodSync(pending, 0o700);
  for (const key of ['transcript', 'report', 'bundle']) {
    try { fs.writeFileSync(path.join(pending, FILES[key]), bytes[key], { flag: 'wx', mode: 0o600 }); } catch { refuse(`${FILES[key]} could not be created exclusively; ${path.basename(pending)} is left incomplete`); }
  }
  if (exists(final)) refuse(`--out appeared during discovery; ${path.basename(pending)} is left incomplete`);
  fs.renameSync(pending, final);
  return final;
}
// --- evidence reader in an isolated helper process (working-directory correction) ---
// Node has no portable descriptor-relative open (`openat`; neither /dev/fd/N/<name> nor
// /proc/self/fd/N/<name> resolves on every supported platform), so binding reads to one
// directory needs a working directory bound to it. Changing the CALLER's working directory
// is process-global (other threads see it, and restoring by pathname can fail or land in
// another inode), so the bound read runs only in a short-lived helper process. The helper:
// starts in `/` (independent of the caller's directory); changes its own working directory
// once to the target, which binds that directory's inode whatever later happens to the
// pathname; asks the kernel for the bound directory's current path (native `realpath` of
// `.`; Node caches process.cwd()) and refuses any `.incomplete` component; opens each
// file by a relative name with O_NOFOLLOW and O_NONBLOCK and requires a regular file
// (read incrementally, never more than its fstat size + 1 bytes; the same descriptor's size is
// re-checked before acceptance, refusing any size change)
// within a size bound; checks the bound directory's current path again; and writes the
// three files as length-prefixed frames. Its source is the fixed constant below: it uses
// only `fs` and `path`, makes no request, reads no credential, takes exactly one validated
// absolute-path argument and runs with an empty environment (so NODE_OPTIONS and every
// credential variable are absent), no shell, a timeout and a bounded output. Any helper
// failure refuses (fail closed). The caller's working directory is never changed.
const HELPER_SOURCE = String.raw`'use strict';
const fs = require('fs'), path = require('path');
const NAMES = ['discovery-transcript.json', 'discovery-report.json', 'discovery.json'];
const LIMIT = 268435456;
const fail = code => { process.stderr.write(code); process.exit(3); };
const target = process.argv[1];
if (process.argv.length !== 2 || typeof target !== 'string' || !path.isAbsolute(target) || target.length > 4096 || target.includes('\0')) fail('bad-arguments');
const unfinished = p => p.split(path.sep).some(part => part.endsWith('.incomplete'));
try { process.chdir(target); } catch { fail('unreadable-directory'); }
const bound = () => { let here; try { here = fs.realpathSync.native('.'); } catch { return fail('changed'); } if (unfinished(here)) fail('incomplete'); };
bound();
const frames = [Buffer.from('S6F1')];
for (const name of NAMES) {
  let fd, bytes, regular = false, oversized = false, changed = false;
  try {
    fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    regular = st.isFile();
    if (regular && st.size > LIMIT) oversized = true;
    else if (regular) {
      // Bounded read: at most size + 1 bytes are ever requested (size <= LIMIT), so growth after
      // fstat can never allocate past the limit; any growth or shrinkage refuses.
      const chunks = []; let total = 0;
      for (;;) {
        const want = Math.min(65536, st.size + 1 - total);
        if (want <= 0) break;
        const chunk = Buffer.allocUnsafe(want), got = fs.readSync(fd, chunk, 0, want, null);
        if (got === 0) break;
        chunks.push(chunk.subarray(0, got)); total += got;
      }
      // Final same-descriptor size check: a change after the last positive read refuses too.
      const end = fs.fstatSync(fd);
      if (total === st.size && end.isFile() && end.size === st.size) bytes = Buffer.concat(chunks, total); else changed = true;
    }
  } catch { bytes = undefined; } finally { if (fd !== undefined) fs.closeSync(fd); }
  if (fd !== undefined && !regular) fail('not-regular');
  if (oversized) fail('too-large');
  if (changed) fail('changed-file');
  if (bytes === undefined || bytes.length > LIMIT) fail('unreadable-file');
  const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(bytes.length));
  frames.push(size, bytes);
}
bound();
process.stdout.write(Buffer.concat(frames));
`;
const HELPER_LIMIT = 268435456;
const HELPER_TIMEOUT_MS = 60000;
const HELPER_REFUSALS = Object.freeze(new Map([
  ['bad-arguments', 'the evidence reader refused its arguments'],
  ['unreadable-directory', '--discovery directory is unreadable or not a directory'],
  ['changed', '--discovery changed while it was read'],
  ['incomplete', 'an .incomplete directory is never a complete discovery'],
  ['not-regular', '--discovery file is unreadable or not a regular file'],
  ['unreadable-file', '--discovery file is unreadable or not a regular file'],
  ['too-large', '--discovery file exceeds the evidence size limit'],
  ['changed-file', '--discovery file changed size while it was read'],
]));
/** Runs `source` as the helper for one absolute target. Exported for the deterministic tests only. */
function spawnHelper(source, target) {
  const { spawnSync } = require('node:child_process');
  return spawnSync(process.execPath, ['-e', source, target], { cwd: path.parse(target).root || '/', env: {}, shell: false, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'], timeout: HELPER_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 3 * (HELPER_LIMIT + 8) + 4 });
}
/** Interprets a helper run; anything but one well-formed success refuses. */
function interpretHelper(result) {
  if (!result || result.error || result.signal !== null || result.status !== 0) {
    const code = result && Buffer.isBuffer(result.stderr) ? result.stderr.toString('latin1').slice(0, 64) : '';
    return refuse(HELPER_REFUSALS.has(code) ? HELPER_REFUSALS.get(code) : 'the evidence reader failed; verification refuses (fail closed)');
  }
  const out = result.stdout;
  if (!Buffer.isBuffer(out) || out.length < 4 || out.subarray(0, 4).toString('latin1') !== 'S6F1') refuse('the evidence reader returned malformed output');
  const files = {}; let at = 4;
  for (const key of ['transcript', 'report', 'bundle']) {
    if (at + 8 > out.length) refuse('the evidence reader returned malformed output');
    const size = out.readBigUInt64BE(at); at += 8;
    if (size > BigInt(HELPER_LIMIT) || at + Number(size) > out.length) refuse('the evidence reader returned malformed output');
    files[key] = Buffer.from(out.subarray(at, at + Number(size))); at += Number(size);
  }
  if (at !== out.length) refuse('the evidence reader returned malformed output');
  return files;
}
/**
 * Reads a finalized discovery for verification. The directory-bound read happens in the
 * helper process; this process's working directory is never changed. Residual: a local
 * writer with access to the bound directory can still change its files; such a writer can
 * forge consistent evidence anyway.
 */
function readOutput(dir, { cwd } = {}) {
  if (typeof dir !== 'string' || !dir || dir.includes('\0')) refuse('--discovery is required');
  // An absolute path never consults the caller's working directory (which may have been removed).
  let base = cwd;
  if (!path.isAbsolute(dir) && base === undefined) { try { base = process.cwd(); } catch { return refuse('--discovery is relative and the current working directory is unavailable'); } }
  const target = path.isAbsolute(dir) ? path.resolve(dir) : path.resolve(base, dir);
  if (target.length > 4096) refuse('--discovery path is too long');
  return interpretHelper(spawnHelper(HELPER_SOURCE, target));
}

/** Offline description of the discovery: every GET surface, limits and deferred surfaces. */
function discoveryPlan(project) {
  stagingOnly(project);
  return { project: PROJECT, projectNumber: PROJECT_NUMBER, method: 'GET only', hosts: [...new Set(ROUTES.map(r => r.host))].sort(byText),
    reads: ['Firebase project', 'Firestore database', 'Cloud Functions v2 LIST (two passes)', 'per endpoint: Function, Cloud Run service and revision (two passes)',
      'per endpoint: Functions and Cloud Run getIamPolicy', `generation-pinned source archives in ${SOURCE_BUCKET} only`, 'Rules release and ruleset', 'Firestore indexes and fields'],
    limits: { windowMs: WINDOW_MS, marginMs: MARGIN_MS, maxReads: MAX_READS, exchangeTimeoutMs: 30000 },
    deferredSurfaces: { ...DEFERRED }, claims: { ...CLAIMS }, gates: { ...GATES },
    output: 'three files, written outside the repository into a new 0700 directory; the transcript is sensitive (environment values, source archives, IAM)',
    credentials: 'dry run: no credential is read and no request is made; a live discovery requires --live and separate owner authorization' };
}

module.exports = { PROJECT, PROJECT_NUMBER, SOURCE_BUCKET, TRANSCRIPT_KIND, REPORT_KIND, BUNDLE_KIND, AUTHORITY, ATTESTATION, CLAIMS, GATES, FILES,
  EVIDENCE_CLASSES, MAX_READS, WINDOW_MS, MARGIN_MS, REPOSITORY_ROOT, REDACTED, stagingOnly, redactText, assertDiscoveryUrl, discover, verifyDiscovery, discoveryPlan,
  prepareOutput, writeOutput, readOutput, HELPER_SOURCE, spawnHelper, interpretHelper };
