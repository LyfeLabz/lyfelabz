'use strict';

// A3-6 S6c: read-only provider capture and offline replay. One bounded capture
// runs the certified S4 observer, the certified S5 access review and the S6c
// surface observer through a single recording GET transport and a single clock,
// inside the S4 five-minute window. Every response's bytes, status and timing,
// and every clock reading, go into a canonical transcript; replaying the
// transcript through the same unchanged code must reproduce the observation,
// receipt, surface report and capture bundle byte for byte.
//
// What a capture is not: provider-verified, attested, an access review at level
// B, an approval, a certification, a registration, an activation, or a fresh
// observation for a later enable. A replayable transcript proves internal
// consistency with the captured bytes only; TLS origin cannot be proven after the
// fact. Credentials and request headers are never recorded. The live exchange
// issues GET only, to an allowlist of Google API hosts, refusing redirects.
const path = require('node:path');
const { PROJECT_NUMBERS, MAX_AGE_MS, LIMITS, fingerprint, tokenFromGcloud } = require('../hosting-release/backend-state.cjs');
const { sha256 } = require('../hosting-release/contract.cjs');
const O = require('./provider-observation.cjs');
const R = require('./access-review.cjs');
const SO = require('./surface-observation.cjs');

const K = require(path.join(path.resolve(__dirname, '../../platform/functions/lib/teacherUnits'), 'a3-canonical.js'));

const TRANSCRIPT_KIND = 'lyfelabz.teacherUnitsA3ProviderTranscript';
const CAPTURE_KIND = 'lyfelabz.teacherUnitsA3ProviderCapture';
const AUTHORITY = 'none: provider observation capture; not an approval, certification, registration or activation';
const ATTESTATION = 'none: transcript bytes are internally consistent only; provider origin is not cryptographically attested';
const FRESHNESS = 'historical: a completed capture is not a fresh observation for a later enable';
const EVIDENCE_CLASSES = Object.freeze(['synthetic', 'operator-captured-unattested']);
// The S5 provenance declaration that each class implies; it never raises the level.
const PROVENANCE_FOR = Object.freeze({ synthetic: 'synthetic-fixture', 'operator-captured-unattested': 'provider-get' });
const ENVIRONMENTS = Object.freeze({ 'lyfelabz-prod': 'production', 'lyfelabz-staging': 'staging' });
const REGION = 'us-central1';
const ALLOWED_HOSTS = Object.freeze(['firebase.googleapis.com', 'firestore.googleapis.com', 'cloudfunctions.googleapis.com', 'run.googleapis.com',
  `${REGION}-run.googleapis.com`, 'storage.googleapis.com', 'firebaserules.googleapis.com', 'firebasehosting.googleapis.com', 'compute.googleapis.com']);
const MODES = Object.freeze(['json', 'binary', 'probe']);
const WINDOW_NS = BigInt(MAX_AGE_MS) * 1000000n;
const FILES = Object.freeze({ transcript: 'transcript.json', observation: 'observation.json', receipt: 'receipt.json', surfaceReport: 'surface-report.json', bundle: 'capture.json' });
const UNRESOLVED = Object.freeze(['D9', 'D12', 'D13', 'G1', 'G2', 'G3', 'G4', 'G5', 'O6', 'S6d', 'S6e', 'A3-7', 'inheritedIam (S6c-D1)']);
// The S4 GET sources (provider-observation.cjs SOURCES, not exported; S4 is unchanged).
const S4_SOURCES = Object.freeze(['Firebase Management GET', 'Firestore Admin database/index/field GET', 'Cloud Functions v2 LIST/GET',
  'Cloud Run v2 service/revision GET', 'generation-pinned Cloud Storage GET', 'Firebase Rules release/ruleset GET']);
const PRINCIPAL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]+$/;

function refuse(message) { throw new Error(`[a3-provider-capture] REFUSED: ${message}`); }
const isRefusal = error => /REFUSED/.test(String(error?.message));
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const canonicalBytes = value => Buffer.from(K.canonicalJSON(value), 'utf8');

/** GET allowlist: https, an allowlisted Google API host, no credentials, port or fragment, and no custom method but getIamPolicy. */
function assertAllowedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return refuse('malformed request URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || !ALLOWED_HOSTS.includes(u.hostname)) refuse(`request outside the GET allowlist: ${u.protocol}//${u.host}`);
  const verb = /:([A-Za-z]+)$/.exec(u.pathname);
  if (verb && verb[1] !== 'getIamPolicy') refuse(`custom method outside the read allowlist: ${verb[1]}`);
  return u;
}
function host(url) { try { return new URL(url).host; } catch { return 'unknown host'; } }

/** Turns one exchanged response into what the S4/S5 `get` contract or the S6c `probe` expects. */
function deliver(url, mode, status, bytes) {
  const ok = status >= 200 && status < 300;
  if (mode === 'probe') {
    if (bytes.length > LIMITS.jsonBytes) return { status, json: undefined };
    let json; try { json = JSON.parse(bytes.toString('utf8')); } catch { json = undefined; }
    return { status, json };
  }
  if (!ok) refuse(`provider API ${host(url)} HTTP ${status}${[401, 403].includes(status) ? ' (credentials or read permission missing)' : ''}`);
  if (bytes.length > (mode === 'binary' ? LIMITS.archiveBytes : LIMITS.jsonBytes)) refuse(`oversized provider response: ${host(url)}`);
  if (mode === 'binary') return Buffer.from(bytes);
  try { return JSON.parse(bytes.toString('utf8')); } catch { return refuse(`unverifiable provider response: ${host(url)}`); }
}

/** One window and one monotonic clock for the whole capture (S4 + S5 + S6c). */
function windowClock(startedAt) {
  const start = O.instant(startedAt, 'capture start');
  let last = start;
  return value => {
    const t = O.instant(value, 'capture clock');
    if (t < last) refuse('capture clock moved backwards or transcript times are reordered');
    if (t - start > WINDOW_NS) refuse('capture window exceeded the five-minute observation limit; observe the provider again');
    last = t;
    return value;
  };
}

function createRecorder({ exchange, clock }) {
  if (typeof exchange !== 'function' || typeof clock !== 'function') refuse('an explicit exchange and clock are required');
  const startedAt = clock(), tick = windowClock(startedAt), events = [], binaries = new Map();
  const call = async (url, mode) => {
    assertAllowedUrl(url);
    const requestedAt = tick(clock());
    let result;
    try { result = await exchange(url, mode === 'binary' ? LIMITS.archiveBytes : LIMITS.jsonBytes); }
    catch (error) { if (isRefusal(error)) throw error; return refuse(`provider read failed: ${host(url)}`); }
    if (!plain(result) || !Number.isSafeInteger(result.status) || result.status < 100 || result.status > 599 || !Buffer.isBuffer(result.bytes)) refuse(`malformed exchange result: ${host(url)}`);
    const bytes = Buffer.from(result.bytes), completedAt = tick(clock());
    events.push({ type: 'read', method: 'GET', url, mode, status: result.status, sha256: sha256(bytes), body: bytes.toString('base64'), requestedAt, completedAt });
    if (mode === 'binary' && result.status >= 200 && result.status < 300) binaries.set(url, Buffer.from(bytes));
    return deliver(url, mode, result.status, bytes);
  };
  return {
    now: () => { const at = tick(clock()); events.push({ type: 'clock', at }); return at; },
    get: (url, binary = false) => call(url, binary ? 'binary' : 'json'),
    probe: url => call(url, 'probe'),
    archive: url => (binaries.has(url) ? Buffer.from(binaries.get(url)) : undefined),
    finish: () => ({ startedAt, completedAt: tick(clock()), events }),
  };
}

// --- transcript schema -------------------------------------------------------
const EVENT_KEYS = { clock: ['at', 'type'], read: ['body', 'completedAt', 'method', 'mode', 'requestedAt', 'sha256', 'status', 'type', 'url'] };
const TRANSCRIPT_KEYS = ['attestation', 'authority', 'deploymentPlanSha256', 'environment', 'events', 'evidenceClass', 'expectedAccessSha256', 'kind',
  'principal', 'projectId', 'projectNumber', 'region', 'schemaVersion', 'startedAt', 'completedAt'].sort();
function exactKeys(value, keys, d) {
  if (!plain(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) refuse(`${d} has missing or unknown fields`);
}
function base64(value, d) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) refuse(`${d} body is not Base64`);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) refuse(`${d} body is not canonical Base64`);
  return bytes;
}
function principalOf(value) {
  if (value === undefined) return { status: 'not-recorded' };
  if (typeof value !== 'string' || !PRINCIPAL.test(value)) refuse('--principal must be a lowercase account email (an operator declaration, never verified)');
  return { status: 'operator-declared-unverified', value };
}
function assertTranscript(t, project) {
  exactKeys(t, TRANSCRIPT_KEYS, 'transcript');
  if (t.schemaVersion !== 1 || t.kind !== TRANSCRIPT_KIND || t.authority !== AUTHORITY || t.attestation !== ATTESTATION) refuse('not an S6c provider transcript, or its authority or attestation literal is altered');
  if (!EVIDENCE_CLASSES.includes(t.evidenceClass)) refuse('transcript evidence class unsupported (never provider-verified)');
  if (t.projectId !== project || t.environment !== ENVIRONMENTS[project] || t.projectNumber !== PROJECT_NUMBERS[project] || t.region !== REGION) refuse('cross-project or cross-environment transcript');
  if (!plain(t.principal)) refuse('transcript principal is malformed');
  if (canonicalJSONOf(principalOf(t.principal.status === 'not-recorded' ? undefined : t.principal.value)) !== canonicalJSONOf(t.principal)) refuse('transcript principal is malformed');
  if (!Array.isArray(t.events) || !t.events.length) refuse('transcript has no events');
  t.events.forEach((e, i) => {
    const d = `transcript event ${i}`;
    if (!plain(e) || !Object.hasOwn(EVENT_KEYS, e.type)) refuse(`${d} has an unknown type`);
    exactKeys(e, EVENT_KEYS[e.type], d);
    if (e.type === 'read') {
      if (e.method !== 'GET') refuse(`${d} method is not GET`);
      if (!MODES.includes(e.mode) || typeof e.url !== 'string' || !Number.isSafeInteger(e.status) || e.status < 100 || e.status > 599 || !/^[a-f0-9]{64}$/.test(e.sha256)) refuse(`${d} is malformed`);
      assertAllowedUrl(e.url);
      base64(e.body, d);
    }
  });
}
const canonicalJSONOf = value => K.canonicalJSON(value);

function createReplayer(transcript) {
  const tick = windowClock(transcript.startedAt), events = transcript.events, binaries = new Map();
  let i = 0;
  const next = type => {
    if (i >= events.length) refuse('transcript is missing a response or clock reading');
    const e = events[i++];
    if (e.type !== type) refuse(`transcript entries are reordered or unexpected at event ${i - 1}`);
    return e;
  };
  const call = async (url, mode) => {
    assertAllowedUrl(url);
    const e = next('read');
    if (e.url !== url || e.mode !== mode || e.method !== 'GET') refuse(`transcript request differs from the replayed request at event ${i - 1} (URL, method or mode)`);
    tick(e.requestedAt); tick(e.completedAt);
    const bytes = base64(e.body, `transcript event ${i - 1}`);
    if (sha256(bytes) !== e.sha256) refuse(`transcript response bytes altered at event ${i - 1}`);
    if (mode === 'binary' && e.status >= 200 && e.status < 300) binaries.set(url, Buffer.from(bytes));
    return deliver(url, mode, e.status, bytes);
  };
  return {
    now: () => tick(next('clock').at),
    get: (url, binary = false) => call(url, binary ? 'binary' : 'json'),
    probe: url => call(url, 'probe'),
    archive: url => (binaries.has(url) ? Buffer.from(binaries.get(url)) : undefined),
    finish: () => {
      if (i !== events.length) refuse('transcript has extra entries that the replay did not request');
      return { startedAt: transcript.startedAt, completedAt: tick(transcript.completedAt), events };
    },
  };
}

// --- capture -----------------------------------------------------------------
function plans(project, deploymentPlan, expected) {
  O.readPlan(deploymentPlan?.object, deploymentPlan?.bytes, project);
  R.readExpectedAccess(expected?.object, expected?.bytes, project);
}
function status(section) { return section.status; }

async function runCapture({ project, transport, deploymentPlan, expected, hostingRoot, evidenceClass, principal }) {
  const observation = await O.observeA3Backend({ project, get: transport.get, now: transport.now });
  const review = await R.reviewA3Access({ project, get: transport.get, observation, deploymentPlan, expected,
    provenance: PROVENANCE_FOR[evidenceClass], now: transport.now, ...(hostingRoot === undefined ? {} : { hostingRoot }) });
  const surfaceReport = await SO.observeSurfaces({ project, probe: transport.probe, archive: transport.archive, observation, now: transport.now });
  const finished = transport.finish();
  const transcript = { schemaVersion: 1, kind: TRANSCRIPT_KIND, authority: AUTHORITY, attestation: ATTESTATION, evidenceClass,
    environment: ENVIRONMENTS[project], projectId: project, projectNumber: PROJECT_NUMBERS[project], region: REGION, principal,
    deploymentPlanSha256: deploymentPlan.object.sha256, expectedAccessSha256: expected.object.sha256,
    startedAt: finished.startedAt, completedAt: finished.completedAt, events: finished.events };
  const bytes = { transcript: canonicalBytes(transcript), observation: canonicalBytes(observation), receipt: review.bytes, surfaceReport: canonicalBytes(surfaceReport) };
  const reads = finished.events.filter(e => e.type === 'read');
  const bundle = { schemaVersion: 1, kind: CAPTURE_KIND, authority: AUTHORITY, attestation: ATTESTATION, freshness: FRESHNESS,
    providerVerified: false, releaseAuthorized: false, activationReady: false, accessReviewLevel: 'A-structural', levelB: 'not-claimed', g3: SO.G3,
    evidenceClass, declaredReceiptProvenance: PROVENANCE_FOR[evidenceClass], environment: ENVIRONMENTS[project], projectId: project,
    projectNumber: PROJECT_NUMBERS[project], region: REGION, principal,
    deploymentPlanSha256: deploymentPlan.object.sha256, expectedAccessSha256: expected.object.sha256,
    window: { startedAt: finished.startedAt, completedAt: finished.completedAt, maxAgeMs: MAX_AGE_MS },
    reads: { total: reads.length, nonSuccess: reads.filter(e => e.status < 200 || e.status > 299).length },
    s4ObservationFingerprint: fingerprint(observation),
    files: Object.fromEntries(Object.keys(bytes).map(k => [k, { path: FILES[k], sha256: sha256(bytes[k]) }])),
    surfaces: { inheritedIam: status(surfaceReport.inheritedIam), hosting: status(surfaceReport.hosting), domainMappings: status(surfaceReport.domainMappings),
      serverlessNetworkEndpointGroups: status(surfaceReport.serverlessNetworkEndpointGroups), buildRecord: status(surfaceReport.buildRecord),
      blocking: surfaceReport.blocking.length },
    unresolved: [...UNRESOLVED] };
  return { transcript, observation, receipt: review.receipt, surfaceReport, bundle, bytes: { ...bytes, bundle: canonicalBytes(bundle) } };
}

/**
 * Every local check a capture makes before its first request; the CLI runs it before
 * obtaining a credential (certification F3). The local Hosting configuration is
 * checked here with the certified S5 `checkLocalHosting`; S5 still re-checks it
 * during the review, unchanged.
 */
function checkCaptureInputs({ project, deploymentPlan, expected, evidenceClass, principal, hostingRoot } = {}) {
  if (!Object.hasOwn(ENVIRONMENTS, project)) refuse('an explicit supported --project is required (lyfelabz-staging or lyfelabz-prod)');
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) refuse('explicit evidence class required: synthetic or operator-captured-unattested');
  const declared = principalOf(principal);
  plans(project, deploymentPlan, expected);
  if (hostingRoot === undefined) R.checkLocalHosting(project); else R.checkLocalHosting(project, hostingRoot);
  return declared;
}

/** Records one capture through `exchange(url, limit) -> {status, bytes}` and `clock()`. Nothing is written. */
async function captureA3Provider({ project, exchange, clock, deploymentPlan, expected, hostingRoot, evidenceClass, principal } = {}) {
  const declared = checkCaptureInputs({ project, deploymentPlan, expected, evidenceClass, principal, hostingRoot });
  const transport = createRecorder({ exchange, clock });
  return runCapture({ project, transport, deploymentPlan, expected, hostingRoot, evidenceClass, principal: declared });
}

/**
 * Offline. Replays the transcript through the unchanged S4, S5 and S6c code and
 * requires every supplied file to equal the re-derived bytes exactly. Nothing a
 * file claims is trusted. The result is historical and non-authorizing.
 */
async function verifyCapture({ project, files, deploymentPlan, expected, hostingRoot } = {}) {
  if (!Object.hasOwn(ENVIRONMENTS, project)) refuse('an explicit supported --project is required (lyfelabz-staging or lyfelabz-prod)');
  if (!plain(files) || JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(Object.keys(FILES).sort()) || Object.values(files).some(b => !Buffer.isBuffer(b))) {
    refuse(`capture files required exactly: ${Object.values(FILES).join(', ')}`);
  }
  plans(project, deploymentPlan, expected);
  let transcript;
  try { transcript = K.parseStrictJSON(files.transcript.toString('utf8')); } catch { return refuse('transcript is not strict JSON'); }
  assertTranscript(transcript, project);
  if (!canonicalBytes(transcript).equals(files.transcript)) refuse('transcript bytes are not canonical');
  if (transcript.deploymentPlanSha256 !== deploymentPlan.object.sha256 || transcript.expectedAccessSha256 !== expected.object.sha256) refuse('transcript is not bound to this deployment plan and expected access');
  const replay = await runCapture({ project, transport: createReplayer(transcript), deploymentPlan, expected, hostingRoot,
    evidenceClass: transcript.evidenceClass, principal: transcript.principal });
  for (const key of Object.keys(FILES)) if (!replay.bytes[key].equals(files[key])) refuse(`${FILES[key]} differs from the replayed capture`);
  return Object.freeze({ verified: 'replay-consistent: re-derived from the transcript bytes only', providerVerified: false, releaseAuthorized: false,
    activationReady: false, freshness: FRESHNESS, evidenceClass: replay.bundle.evidenceClass, window: replay.bundle.window,
    surfaces: replay.bundle.surfaces, bundleSha256: sha256(files.bundle) });
}

// --- live exchange (future, separately authorized execution only) -----------
/** GET only, allowlisted hosts, redirects refused, bounded bodies. The token is used for the header and never returned or recorded. */
function createLiveExchange({ token, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || !token || /\s/.test(token)) refuse('missing credentials: invalid access token');
  if (typeof fetchImpl !== 'function') refuse('no fetch implementation');
  return async (url, limit) => {
    const target = assertAllowedUrl(url);
    let response;
    try { response = await fetchImpl(url, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }); }
    catch { return refuse(`provider API unavailable or redirected: ${target.host}`); }
    if (response.redirected || (response.status >= 300 && response.status < 400)) refuse(`redirect refused: ${target.host}`);
    if (typeof response.url === 'string' && response.url && new URL(response.url).href !== target.href) refuse(`response URL differs from the request: ${target.host}`);
    try {
      if (!response.body || Number(response.headers.get('content-length') || 0) > limit) throw new Error('body limit');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) { await response.body.cancel?.().catch(() => {}); throw new Error('body limit'); }
        chunks.push(Buffer.from(chunk));
      }
      return { status: response.status, bytes: Buffer.concat(chunks, size) };
    } catch { return refuse(`unverifiable or oversized provider response: ${target.host}`); }
  };
}
/** Ambient ADC through gcloud, at capture time only. Its principal is never treated as authorization. */
function liveAccessToken(run) { return tokenFromGcloud(run); }

/** Offline description of the capture: every GET surface and the read permissions expected [U]. */
function capturePlan(project) {
  if (!Object.hasOwn(ENVIRONMENTS, project)) refuse('an explicit supported --project is required (lyfelabz-staging or lyfelabz-prod)');
  return { project, method: 'GET only', hosts: [...ALLOWED_HOSTS], windowMs: MAX_AGE_MS,
    s4: { sources: [...S4_SOURCES], permissions: ['firebase.projects.get', 'datastore.databases.get', 'datastore.indexes.list', 'cloudfunctions.functions.list',
      'cloudfunctions.functions.get', 'run.services.get', 'run.revisions.get', 'storage.objects.get (Functions source bucket)', 'firebaserules.releases.get', 'firebaserules.rulesets.get'] },
    s5: { sources: [...R.SOURCES], permissions: ['cloudfunctions.functions.getIamPolicy', 'run.services.getIamPolicy'] },
    s6c: SO.readPlan(project),
    note: 'permissions are expected, unverified [U]; a denied read refuses (S4, S5) or is recorded unreadable (S6c surfaces), never absent',
    credentials: 'observe plan reads no credentials and makes no request' };
}

module.exports = { TRANSCRIPT_KIND, CAPTURE_KIND, AUTHORITY, ATTESTATION, FRESHNESS, EVIDENCE_CLASSES, ALLOWED_HOSTS, FILES, UNRESOLVED,
  assertAllowedUrl, createRecorder, createReplayer, checkCaptureInputs, captureA3Provider, verifyCapture, createLiveExchange, liveAccessToken, capturePlan };
