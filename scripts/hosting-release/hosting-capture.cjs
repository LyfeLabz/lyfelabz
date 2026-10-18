'use strict';

// D13 Part D: offline Hosting evidence capture planner and recorded-response replay.
// Non-operational. Nothing in a release, deployment or activation path requires this
// module. It performs no I/O: no network, filesystem, environment, clock (`now` is an
// input), subprocess or credential access. There is no HTTP executor: a plan only
// describes requests, and replay only consumes exchanges recorded elsewhere and
// supplied as data. No live-capture provenance kind exists.
//
// planCapture(planInput) -> a deterministic, frozen plan for both sites:
//   planInput { project, expectedCandidateFingerprint, pairBuild, routing, nonce,
//               trusted: { project, sites: { app, marketing }, origins: { app, marketing } },
//               assignments: [{ target, site, origin }] }
//   `trusted` is explicit trusted configuration (the .firebaserc target map and the
//   Hosting contract origins, as the caller read them). `assignments` is the claimed
//   origin-to-site binding; each must equal the trusted mapping exactly (owner
//   decision 5). Site identity is never inferred from a URL.
//   The plan separates provider API requests (surface `provider-api`, GET only, two
//   permitted resources) from public Hosting origin requests (surface `public-origin`).
//   Phase order: before (live channel per site), manifest (complete versions.files.list
//   pagination per site), edge (cache-busted GET per served path), after (live channel).
//
// replayCapture({ planInput, transcript, candidate, localGzip, receipt, now })
//   transcript { kind: 'lyfelabz.hostingCaptureTranscript', schemaVersion: 1,
//                planFingerprint, provenance: { kind: 'synthetic-fixture' | 'offline-record', tool },
//                startedAt, completedAt, exchanges: [Exchange] }
//   Exchange   { id, observedAt, request: { method, url }, response }
//              provider response { status, body }; edge response { status, url, sha256 }
//   localGzip  { app, marketing } local gzip evidence (provider-manifest localGzipManifest),
//              prepared before the window.
//   receipt    null | { pre, post } deploy receipts (deploy-receipt.cjs).
// Replay maps each exchange to its planned request, normalizes the evidence into a
// D13 Part B observation (schema 2) and runs the Part B and Part C verifiers
// unchanged. A pass is replay consistency only: never certification, deployment
// approval, deployment provenance, activation or availability.
const { fingerprint, MAX_AGE_MS, PROJECT_NUMBERS } = require('./backend-state.cjs');
const { TARGETS, isRedirected, requestPathFor } = require('./contract.cjs');
const { releaseMessage } = require('./release.cjs');
const { FIREBASE_BUILTIN_IGNORES, isHostingIgnored } = require('../../app/scripts/lessonBuilder/hostingExclusion.cjs');
const { verifyHostingDeploymentObservation } = require('./hosting-deployment.cjs');
const { PROVIDER_SOURCE } = require('./provider-manifest.cjs');
const { validateDeployReceiptPair } = require('./deploy-receipt.cjs');

const PLAN_KIND = 'lyfelabz.hostingCapturePlan';
const TRANSCRIPT_KIND = 'lyfelabz.hostingCaptureTranscript';
const PROVIDER_API = 'https://firebasehosting.googleapis.com/v1beta1/';
const RESOURCES = Object.freeze({
  channel: 'firebasehosting.v1beta1.sites.channels.get',
  files: PROVIDER_SOURCE
});
const PROVENANCE_KINDS = Object.freeze(['synthetic-fixture', 'offline-record']);
// The complete identity-observation window (owner decision; A1 MAX_AGE_MS).
const MAX_WINDOW_MS = MAX_AGE_MS;
const MAX_PAGES = 1000;
const SCOPE = 'capture-replay-consistency';
const WINDOW = Object.freeze({
  maxDurationMs: MAX_WINDOW_MS, clockSkewMs: 0,
  inside: Object.freeze(['before release/version reads (both sites)', 'provider manifest pages (both sites)',
    'public-edge byte reads (both sites)', 'after release/version reads (both sites)']),
  outside: Object.freeze(['local artifact hashing', 'local gzip preparation', 'catalog navigation', 'route and redirect samples',
    'general functional checks'])
});
const LIMITATIONS = Object.freeze([
  'replayed exchanges are synthetic or offline records, never live-provider evidence',
  'a single public-edge observation is limited and does not prove global CDN consistency',
  'stable release metadata does not guarantee identical bytes at every CDN edge',
  'a bound manifest is content-to-version consistency only and does not establish which version is served',
  'manifest self-calibration is corroboration only and never overrides missing or incompatible deploy provenance',
  'a deploy receipt is operator-supplied and does not prove which profile performed the deploy',
  'not provider-backed certification, deployment approval, activation or availability'
]);

const DIGEST = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const SITE_ID = /^[a-z0-9-]+$/;
const NONCE = /^[a-z0-9]{6,32}$/;
const ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const EXCHANGE_ID = /^[a-z]+:[a-z]+(?::.+)?$/;

function refuse(message) { throw new Error(`[hosting-capture] REFUSED: ${message}`); }
function plainObject(value, description) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) refuse(`${description} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length) refuse(`${description} has symbol keys`);
  for (const key of Object.getOwnPropertyNames(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d.enumerable || !('value' in d)) refuse(`${description}.${key} must be an enumerable data field`);
  }
  return value;
}
function record(value, keys, description, optional = []) {
  plainObject(value, description);
  const own = Object.getOwnPropertyNames(value);
  for (const key of own) if (!keys.includes(key) && !optional.includes(key)) refuse(`unknown ${description} field: ${key}`);
  for (const key of keys) if (!own.includes(key) || value[key] === undefined) refuse(`missing ${description} field: ${key}`);
  return value;
}
function list(value, description) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse(`${description} must be an array`);
  if (Object.getOwnPropertyNames(value).length !== value.length + 1) refuse(`${description} has non-index properties`);
  return value;
}
function text(value, description) {
  if (typeof value !== 'string' || !value) refuse(`malformed ${description}`);
  return value;
}
function pattern(value, re, description) {
  if (typeof value !== 'string' || !re.test(value)) refuse(`malformed ${description}`);
  return value;
}
function time(value, description) {
  pattern(value, TIMESTAMP, `${description} timestamp`);
  const n = Date.parse(value);
  if (!Number.isFinite(n)) refuse(`malformed ${description} timestamp`);
  return n;
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) deepFreeze(v); Object.freeze(value); }
  return value;
}

// --- Planning ------------------------------------------------------------------

function validateOrigins(input) {
  const { project } = input;
  if (typeof project !== 'string' || !Object.hasOwn(PROJECT_NUMBERS, project)) refuse('unsupported project');
  const trusted = record(input.trusted, ['project', 'sites', 'origins'], 'trusted');
  if (trusted.project !== project) refuse('trusted configuration names another project');
  record(trusted.sites, TARGETS, 'trusted.sites');
  record(trusted.origins, TARGETS, 'trusted.origins');
  for (const target of TARGETS) {
    pattern(trusted.sites[target], SITE_ID, `trusted ${target} site`);
    pattern(trusted.origins[target], ORIGIN, `trusted ${target} origin`);
  }
  if (trusted.sites.app === trusted.sites.marketing) refuse('ambiguous trusted configuration: one site for both targets');
  if (trusted.origins.app === trusted.origins.marketing) refuse('ambiguous trusted configuration: one origin for both targets');

  const assignments = list(input.assignments, 'assignments');
  if (assignments.length !== TARGETS.length) refuse('assignments must bind exactly the app and marketing targets');
  const seen = { target: new Set(), site: new Set(), origin: new Set() };
  const bound = {};
  assignments.forEach((a, i) => {
    const d = `assignments[${i}]`;
    record(a, ['target', 'site', 'origin'], d);
    if (!TARGETS.includes(a.target)) refuse(`${d} names an unexpected target`);
    pattern(a.site, SITE_ID, `${d} site`);
    pattern(a.origin, ORIGIN, `${d} origin`);
    for (const key of ['target', 'site', 'origin']) {
      if (seen[key].has(a[key])) refuse(`duplicate ${key} assignment: ${a[key]}`);
      seen[key].add(a[key]);
    }
  });
  // Trust is checked only after the whole assignment set is unambiguous.
  for (const a of assignments) {
    if (a.site !== trusted.sites[a.target]) refuse(`${a.target} assignment names unexpected site ${a.site}`);
    if (a.origin !== trusted.origins[a.target]) refuse(`origin ${a.origin} is not the trusted origin for ${a.target} site ${a.site}`);
    bound[a.target] = { site: a.site, origin: a.origin };
  }
  return bound;
}

function validatePlanArtifacts(input) {
  const pair = record(input.pairBuild, ['kind', 'schemaVersion', 'releaseIntent', 'source', 'unitPlacement', 'files'], 'pairBuild');
  if (pair.kind !== 'lyfelabz.hostingPairBuild' || pair.schemaVersion !== 3) refuse('unsupported pair-build evidence');
  record(pair.source, ['sha', 'dirty'], 'pairBuild.source');
  pattern(pair.source.sha, GIT_SHA, 'pair-build source sha');
  if (pair.source.dirty !== false) refuse('capture requires a pair build from a clean source');
  record(pair.files, TARGETS, 'pairBuild.files');
  for (const target of TARGETS) {
    plainObject(pair.files[target], `pairBuild.files.${target}`);
    for (const [file, hash] of Object.entries(pair.files[target])) pattern(hash, DIGEST, `pair-build ${target} hash for ${file}`);
  }
  record(input.routing, TARGETS, 'routing');
  for (const target of TARGETS) {
    record(input.routing[target], ['ignore', 'redirects'], `routing.${target}`);
    list(input.routing[target].ignore, `routing.${target}.ignore`);
    list(input.routing[target].redirects, `routing.${target}.redirects`);
  }
  pattern(input.expectedCandidateFingerprint, DIGEST, 'expected Hosting candidate fingerprint');
  pattern(input.nonce, NONCE, 'cache-busting nonce');
  return pair;
}

// The served set uses the same primitives as the Part B verifier (certify's rule);
// Part B independently recomputes and enforces it during replay.
function servedFiles(files, rules) {
  const ignore = FIREBASE_BUILTIN_IGNORES.concat(rules.ignore);
  return Object.keys(files).filter(file => !isHostingIgnored(file, ignore))
    .filter(file => !isRedirected(requestPathFor(file), rules)).sort();
}

function channelUrl(project, site) { return `${PROVIDER_API}projects/${project}/sites/${site}/channels/live`; }
function filesUrl(project, site, versionId, token) {
  return `${PROVIDER_API}projects/${project}/sites/${site}/versions/${versionId}/files${token === null ? '' : `?pageToken=${encodeURIComponent(token)}`}`;
}
function edgeUrl(origin, file, nonce) { return `${origin}${requestPathFor(file)}?hosting-release=${nonce}`; }

/** Deterministic, frozen two-site capture plan. Performs no I/O. */
function planCapture(input) {
  record(input, ['project', 'expectedCandidateFingerprint', 'pairBuild', 'routing', 'nonce', 'trusted', 'assignments'], 'plan input');
  const bound = validateOrigins(input);
  const pair = validatePlanArtifacts(input);
  const { project, nonce } = input;
  const sites = {};
  const before = [], manifest = [], edge = [], after = [];
  for (const target of TARGETS) {
    const { site, origin } = bound[target];
    sites[target] = { site, siteResource: `projects/${project}/sites/${site}`, origin };
    const read = phase => ({ id: `${phase}:${target}`, phase, target, surface: 'provider-api', method: 'GET',
      resource: RESOURCES.channel, url: channelUrl(project, site) });
    before.push(read('before'));
    after.push(read('after'));
    manifest.push({ id: `files:${target}`, phase: 'manifest', target, surface: 'provider-api', method: 'GET', resource: RESOURCES.files,
      urlTemplate: `${PROVIDER_API}projects/${project}/sites/${site}/versions/{versionId}/files`,
      versionFrom: `before:${target}`,
      pagination: { firstPageToken: null, continueWith: 'nextPageToken', complete: 'last page has no nextPageToken', maxPages: MAX_PAGES } });
    for (const file of servedFiles(pair.files[target], input.routing[target]))
      edge.push({ id: `edge:${target}:${file}`, phase: 'edge', target, surface: 'public-origin', method: 'GET', origin, file,
        url: edgeUrl(origin, file, nonce), expectedSha256: pair.files[target][file] });
  }
  return deepFreeze({
    kind: PLAN_KIND, schemaVersion: 1,
    project, projectNumber: PROJECT_NUMBERS[project],
    expectedCandidateFingerprint: input.expectedCandidateFingerprint,
    sourceSha: pair.source.sha, releaseMessage: releaseMessage(pair.source.sha, false),
    providerApi: { base: PROVIDER_API, methods: ['GET'], resources: [RESOURCES.channel, RESOURCES.files] },
    sites, nonce, window: WINDOW,
    requests: { before, manifest, edge, after }
  });
}

// --- Replay --------------------------------------------------------------------

const CHANNEL_KEYS = ['name', 'release'];
const CHANNEL_OPTIONAL = ['url', 'createTime', 'updateTime', 'expireTime', 'ttl', 'retainedReleaseCount', 'labels'];
const RELEASE_KEYS = ['name', 'version', 'type', 'releaseTime'];
const RELEASE_OPTIONAL = ['message', 'releaseUser'];
const VERSION_KEYS = ['name', 'status', 'fileCount'];
const VERSION_OPTIONAL = ['config', 'labels', 'createTime', 'createUser', 'finalizeTime', 'finalizeUser', 'deleteTime', 'deleteUser', 'versionBytes', 'preview'];

// REST encodes int64 fileCount as a decimal string; numbers are accepted too.
function fileCount(value, description) {
  const n = typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 0) refuse(`malformed ${description} fileCount`);
  return n;
}

function liveVersion(exchange, project, site, description) {
  const body = record(exchange.response.body, CHANNEL_KEYS, `${description} channel`, CHANNEL_OPTIONAL);
  const names = [`sites/${site}/channels/live`, `projects/${project}/sites/${site}/channels/live`, `projects/${PROJECT_NUMBERS[project]}/sites/${site}/channels/live`];
  if (!names.includes(body.name)) refuse(`${description} channel is not the live channel of site ${site} in ${project}`);
  const release = record(body.release, RELEASE_KEYS, `${description} release`, RELEASE_OPTIONAL);
  const version = record(release.version, VERSION_KEYS, `${description} version`, VERSION_OPTIONAL);
  const message = Object.hasOwn(release, 'message') ? release.message : '';
  // Part B owns release and version identity, type and status rules.
  return { observedAt: exchange.observedAt, releaseName: text(release.name, `${description} release name`), releaseType: text(release.type, `${description} release type`),
    releaseTime: text(release.releaseTime, `${description} release time`), message,
    versionName: text(version.name, `${description} version name`), versionStatus: text(version.status, `${description} version status`),
    fileCount: fileCount(version.fileCount, description) };
}

function validateLocalGzip(localGzip) {
  record(localGzip, TARGETS, 'localGzip');
  return localGzip;
}

/** Replays a supplied transcript against its plan and the Part B/C contracts.
 * Throws on any inconsistency. Returns a frozen, non-authorizing result. */
function replayCapture(input) {
  record(input, ['planInput', 'transcript', 'candidate', 'localGzip', 'receipt', 'now'], 'replay input');
  const plan = planCapture(input.planInput);
  const now = time(input.now, 'now');
  const { project } = plan;
  const t = record(input.transcript, ['kind', 'schemaVersion', 'planFingerprint', 'provenance', 'startedAt', 'completedAt', 'exchanges'], 'transcript');
  if (t.kind !== TRANSCRIPT_KIND || t.schemaVersion !== 1) refuse('unsupported transcript kind or schema');
  if (t.planFingerprint !== fingerprint(plan)) refuse('transcript was recorded for another plan');
  const p = record(t.provenance, ['kind', 'tool'], 'transcript.provenance');
  if (!PROVENANCE_KINDS.includes(p.kind)) refuse('unsupported transcript provenance kind; no live-capture kind is authorized');
  text(p.tool, 'transcript provenance tool');
  const startedAt = time(t.startedAt, 'transcript start');
  const completedAt = time(t.completedAt, 'transcript completion');
  if (startedAt > completedAt) refuse('observation window starts after it completes');
  if (completedAt - startedAt > MAX_WINDOW_MS) refuse('observation window exceeds five minutes');
  if (completedAt > now) refuse('future observation timestamp');
  if (now - startedAt > MAX_WINDOW_MS) refuse('stale observation; older than five minutes');
  validateLocalGzip(input.localGzip);

  // Exchanges: provider reads in plan order, then edge reads in any order, then after reads.
  const exchanges = list(t.exchanges, 'transcript.exchanges');
  const seen = new Set();
  let cursor = 0;
  let last = startedAt;
  function next(description) {
    if (cursor >= exchanges.length) refuse(`missing exchange: ${description}`);
    const ex = exchanges[cursor];
    const d = `exchanges[${cursor}]`;
    cursor += 1;
    record(ex, ['id', 'observedAt', 'request', 'response'], d);
    pattern(ex.id, EXCHANGE_ID, `${d} id`);
    if (seen.has(ex.id)) refuse(`duplicate exchange: ${ex.id}`);
    seen.add(ex.id);
    const at = time(ex.observedAt, `${d} observation`);
    if (at < startedAt || at > completedAt) refuse(`${ex.id} is outside the observation window`);
    if (at < last) refuse(`${ex.id} is recorded out of time order`);
    last = at;
    record(ex.request, ['method', 'url'], `${d}.request`);
    if (ex.request.method !== 'GET') refuse(`${ex.id} uses method ${String(ex.request.method)}; only GET is permitted`);
    return ex;
  }
  function provider(id, url) {
    const ex = next(id);
    if (ex.id !== id) refuse(`exchange ${ex.id} is not the planned ${id} (missing, extra or reordered exchange)`);
    if (ex.request.url !== url) refuse(`${id} request is not the planned provider request`);
    record(ex.response, ['status', 'body'], `${id} response`);
    if (ex.response.status !== 200) refuse(`${id} provider response is HTTP ${String(ex.response.status)}`);
    return ex;
  }

  const versions = { before: {}, after: {} };
  for (const r of plan.requests.before) versions.before[r.target] = liveVersion(provider(r.id, r.url), project, plan.sites[r.target].site, r.id);

  const manifests = {};
  for (const m of plan.requests.manifest) {
    const { site } = plan.sites[m.target];
    const versionName = versions.before[m.target].versionName;
    const versionId = /\/versions\/([a-f0-9]+)$/.exec(versionName)?.[1];
    if (!versionId) refuse(`${m.target} before read names a malformed version`);
    const pages = [];
    const tokens = new Set();
    let token = null;
    let observedAt = null;
    for (let n = 0; ; n += 1) {
      if (n >= MAX_PAGES) refuse(`${m.target} provider manifest exceeds ${MAX_PAGES} pages`);
      const ex = provider(`${m.id}:${n}`, filesUrl(project, site, versionId, token));
      const body = record(ex.response.body, [], `${m.id}:${n} body`, ['files', 'nextPageToken']);
      // An empty page may omit `files`; Part C validates every entry and the token chain.
      const response = { files: Object.hasOwn(body, 'files') ? body.files : [] };
      if (Object.hasOwn(body, 'nextPageToken')) response.nextPageToken = body.nextPageToken;
      pages.push({ requestPageToken: token, response });
      observedAt = ex.observedAt;
      if (!Object.hasOwn(body, 'nextPageToken')) break;
      if (typeof body.nextPageToken !== 'string' || tokens.has(body.nextPageToken)) refuse(`${m.id}:${n} continuation token is malformed or repeated`);
      tokens.add(body.nextPageToken);
      token = body.nextPageToken;
    }
    manifests[m.target] = { provenance: { kind: p.kind, tool: p.tool, source: PROVIDER_SOURCE, observedAt }, pages };
  }

  const planned = new Map(plan.requests.edge.map(r => [r.id, r]));
  const served = Object.fromEntries(TARGETS.map(target => [target, { observedAt: null, files: [] }]));
  while (cursor < exchanges.length && typeof exchanges[cursor]?.id === 'string' && exchanges[cursor].id.startsWith('edge:')) {
    const ex = next('edge');
    const r = planned.get(ex.id);
    if (!r) refuse(`unexpected edge exchange: ${ex.id}`);
    planned.delete(ex.id);
    if (ex.request.url !== r.url) refuse(`${ex.id} request is not the planned origin, path and cache-busting nonce`);
    record(ex.response, ['status', 'url', 'sha256'], `${ex.id} response`);
    if (ex.response.url !== r.url) refuse(`${ex.id} was answered from another origin or path (redirect followed)`);
    if (ex.response.status !== 200) refuse(`${ex.id} not served (HTTP ${String(ex.response.status)})`);
    pattern(ex.response.sha256, DIGEST, `${ex.id} sha256`);
    served[r.target].files.push({ path: r.file, sha256: ex.response.sha256 });
    served[r.target].observedAt = ex.observedAt;
  }
  if (planned.size) refuse(`missing edge exchanges: ${[...planned.keys()].sort().join(', ')}`);
  for (const target of TARGETS) {
    if (served[target].observedAt === null) refuse(`no public-edge observation for ${target}`);
    served[target].files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  for (const r of plan.requests.after) versions.after[r.target] = liveVersion(provider(r.id, r.url), project, plan.sites[r.target].site, r.id);
  if (cursor !== exchanges.length) refuse(`extra exchange after the plan: ${String(exchanges[cursor]?.id)}`);

  // Receipt: operator-supplied provenance for the deploy compression profile.
  let receipt = null;
  if (input.receipt !== null) {
    const pair = record(input.receipt, ['pre', 'post'], 'receipt');
    receipt = validateDeployReceiptPair({ pre: pair.pre, post: pair.post, now: input.now,
      expected: { project, sites: { app: plan.sites.app.site, marketing: plan.sites.marketing.site },
        sourceSha: plan.sourceSha, hostingCandidateFingerprint: plan.expectedCandidateFingerprint } });
    if (Date.parse(receipt.postRecordedAt) > startedAt) refuse('the post-deployment receipt must precede the observation window');
  }

  const observation = {
    kind: 'lyfelabz.hostingDeploymentObservation', schemaVersion: 2, project, startedAt: t.startedAt, completedAt: t.completedAt,
    provenance: { kind: p.kind, tool: p.tool, versionSource: 'hosting-live-channel', byteSource: 'public-edge-cache-busted-get' },
    deployCompressionProfile: receipt ? receipt.compressionProfile : null,
    sites: Object.fromEntries(TARGETS.map(target => [target, {
      site: plan.sites[target].siteResource, versionBefore: versions.before[target], served: served[target],
      versionAfter: versions.after[target], providerManifest: manifests[target], localGzip: input.localGzip[target]
    }]))
  };
  const verified = verifyHostingDeploymentObservation({
    candidate: input.candidate, pairBuild: input.planInput.pairBuild,
    expected: { project, sites: { app: plan.sites.app.site, marketing: plan.sites.marketing.site } },
    routing: input.planInput.routing, observation, now: input.now
  });
  if (verified.hostingCandidateFingerprint !== plan.expectedCandidateFingerprint) refuse('candidate fingerprint is not the planned Hosting candidate');

  // Self-calibration: do the local gzip hashes alone reproduce every provider hash?
  // Corroboration only; it never changes the Part C binding.
  const selfCalibration = {};
  for (const target of TARGETS) {
    const hashes = Object.fromEntries(manifests[target].pages.flatMap(page => page.response.files).map(f => [f.path, f.hash]));
    const local = input.localGzip[target].files;
    selfCalibration[target] = Object.keys(hashes).every(file => local[file]?.gzipSha256 === hashes[file]) ? 'consistent-with-local-profile' : 'inconsistent';
  }
  const reasons = TARGETS.map(target => verified.sites[target].providerFileBindingReason);
  const compressionProfileEvidence = receipt === null ? 'missing' : reasons.every(r => r === null) ? 'compatible' : 'incompatible';

  return deepFreeze({
    scope: SCOPE,
    planFingerprint: t.planFingerprint,
    transcriptFingerprint: fingerprint(t),
    observationFingerprint: verified.observationFingerprint,
    hostingCandidateFingerprint: verified.hostingCandidateFingerprint,
    project, provenance: p.kind,
    planValid: true,
    transcriptComplete: true,
    originToSite: 'consistent',
    providerManifest: verified.providerFileManifest,
    localGzipBinding: verified.providerFileBinding,
    publicEdgeBytes: verified.localAndPublicBytesConsistent ? 'consistent' : 'inconsistent',
    publicEdgeObservation: 'single-observation',
    releaseVersionStable: verified.providerVersionMetadataStable && verified.providerReleaseIdentityStable,
    receipt: receipt === null ? 'absent' : 'consistent',
    hashCachePolicy: receipt === null ? 'unknown' : receipt.hashCachePolicy,
    compressionProfileEvidence,
    selfCalibration,
    servingEstablishedByManifest: verified.servingEstablishedByManifest,
    deploymentProvenanceEstablished: false,
    sites: Object.fromEntries(TARGETS.map(target => [target, { ...verified.sites[target], origin: plan.sites[target].origin }])),
    limitations: LIMITATIONS,
    deployable: false, certified: false, authorized: false, available: false
  });
}

module.exports = { planCapture, replayCapture, MAX_WINDOW_MS, PROVIDER_API, PLAN_KIND, TRANSCRIPT_KIND, SCOPE };
