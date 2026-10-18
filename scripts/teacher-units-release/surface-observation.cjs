'use strict';

// A3-6 S6c: read-only observation of the access surfaces S5 records as
// unresolved (owner decision S6c-D2): deployed Hosting channel releases and their
// rewrites, Cloud Run domain mappings, serverless network endpoint groups with
// the backend services that use them, and the deployed A3 runtime build record
// inside the generation-pinned source archive S4 already retrieved.
//
// The only I/O is the injected `probe` (a GET that returns the HTTP status and
// parsed body) and `archive` (bytes S4 already read). Nothing here writes, signs
// or authorizes. A 403, 404, disabled API, unreadable location, pagination that
// does not finish or a response whose shape is not understood is never read as
// absence: it is recorded as `unreadable` or `incomplete`. Inherited IAM is not
// observed in v1 (owner decision S6c-D1: GET-only; Resource Manager
// getIamPolicy is a POST).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PROJECT_NUMBERS, LIMITS, fingerprint, archiveRuntime } = require('../hosting-release/backend-state.cjs');
const { sha256 } = require('../hosting-release/contract.cjs');
const O = require('./provider-observation.cjs');

const LIB = path.resolve(__dirname, '../../platform/functions/lib/teacherUnits');
const K = require(path.join(LIB, 'a3-canonical.js'));
const RA = require(path.join(LIB, 'a3-runtime-artifact.js'));

const SURFACE_KIND = 'lyfelabz.teacherUnitsA3SurfaceObservation';
const AUTHORITY = 'none: surface observation only; not an access review, approval, certification, registration or activation';
const REGION = 'us-central1';
const ENVIRONMENTS = Object.freeze({ 'lyfelabz-prod': 'production', 'lyfelabz-staging': 'staging' });
// Hosting sites per environment (DOMAIN_AND_HOSTING_CONTRACT.md). The tooling
// never reads the Firebase alias file; every listed site is inspected, and these
// are only the sites the contract expects to find.
const EXPECTED_SITES = Object.freeze({ 'lyfelabz-prod': ['lyfelabz-marketing', 'lyfelabz-prod'], 'lyfelabz-staging': ['lyfelabz-staging', 'lyfelabz-staging-marketing'] });
const SERVICES = Object.freeze(O.ENDPOINTS.map(e => e.toLowerCase()));
const STATUSES = Object.freeze(['observed-absent', 'observed-present', 'incomplete', 'unreadable', 'not-observed', 'inconsistent']);
const INHERITED_IAM = Object.freeze({ status: 'not-observed',
  reason: 'owner decision S6c-D1: S6c v1 is GET-only; Resource Manager getIamPolicy is a POST and is not implemented, so project, folder and organization IAM are not observed' });
const G3 = 'open: S6c records surfaces; it does not resolve gate G3 or establish a level B access review';

function refuse(message) { throw new Error(`[a3-surface-observation] REFUSED: ${message}`); }
class Incomplete extends Error {}
const incomplete = message => { throw new Incomplete(message); };
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
// A target value is a string with visible content; whitespace-only values are never a target (third correction).
const nonblank = v => typeof v === 'string' && v.trim().length > 0;
const text = (v, d) => (nonblank(v) ? v : incomplete(`${d} missing, blank or not a string`));

/** The GET surfaces S6c reads, with the read permissions they are expected to need [U: unverified until a live run]. */
function readPlan(project) {
  return [
    { surface: 'hosting', reads: [`GET https://firebasehosting.googleapis.com/v1beta1/projects/${project}/sites`, 'GET https://firebasehosting.googleapis.com/v1beta1/sites/<site>/channels'],
      permissions: ['firebasehosting.sites.list', 'firebasehosting.sites.get (channels and releases)'] },
    { surface: 'domainMappings', reads: [`GET https://${REGION}-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/${project}/domainmappings`],
      permissions: ['run.domainmappings.list'] },
    { surface: 'serverlessNetworkEndpointGroups', reads: [`GET https://compute.googleapis.com/compute/v1/projects/${project}/aggregated/networkEndpointGroups`,
      `GET https://compute.googleapis.com/compute/v1/projects/${project}/aggregated/backendServices`],
    permissions: ['compute.networkEndpointGroups.list', 'compute.backendServices.list', 'Compute Engine API enabled (a disabled API is recorded unreadable, never enabled by S6c)'] },
    { surface: 'buildRecord', reads: ['none: inspects the generation-pinned source archive bytes S4 already read'], permissions: [] },
    { surface: 'inheritedIam', reads: [], permissions: [], status: INHERITED_IAM.status },
  ];
}

/*
 * Listing invariants (certification F1 and F2, first and second corrections). Three
 * concepts are kept apart:
 *   1. identity and target: what an entry is and where it routes. An entry whose
 *      target cannot be established is not evaluated and makes the listing
 *      incomplete; a malformed target is never turned into a confirmed exposure.
 *   2. completeness and metadata: page fields, list kind, unreachable locations,
 *      pagination, and nonessential entry metadata. A problem here is recorded as
 *      an issue (`note`) and makes coverage incomplete; it never throws away entries
 *      or targets that were established independently.
 *   3. confirmed exposure: findings derived from established targets. Findings are
 *      computed from every entry observed, whatever the coverage, and stay blocking.
 * `observed-absent` is reached only with no issue at all: every page valid, every
 * entry and target valid, collections explicit and pagination ended.
 */
async function listAll(probe, url, { keys, kind, meta = () => {}, collection, item, next, tokenParam }) {
  const items = [], issues = [], tokens = new Set(); let current = url;
  const note = reason => { issues.push(reason); };
  const guarded = (fn, fallback) => { try { return fn(); } catch (error) { if (error instanceof Incomplete) { note(error.message); return fallback; } throw error; } };
  const done = status => ({ status, reason: status === 'ok' ? null : issues[0], items });
  for (let pages = 1; ; pages++) {
    if (pages > LIMITS.pages) { note('pagination limit exceeded'); return done('incomplete'); }
    const response = await probe(current);
    if (response.status !== 200) { issues.unshift(`HTTP ${response.status} is not evidence of absence`); return done('unreadable'); }
    const page = response.json;
    if (!plain(page)) { note('malformed or non-JSON listing'); return done('incomplete'); }
    const unknown = Object.keys(page).filter(k => !keys.includes(k));
    if (unknown.length) note(`listing has undocumented fields: ${unknown.sort().join(', ')}`);
    if (kind !== undefined && page.kind !== kind) note(`listing kind is ${typeof page.kind === 'string' ? page.kind : 'absent or malformed'}, expected ${kind}`);
    // Metadata is validated apart from the collection: its failure never discards entries.
    guarded(() => meta(page, note));
    const entries = guarded(() => collection(page, note), []);
    entries.forEach((raw, i) => { const value = guarded(() => item(raw, i, note), undefined); if (value !== undefined) items.push(value); });
    if (items.length > LIMITS.items) { note('listing item limit exceeded'); return done('incomplete'); }
    const token = guarded(() => next(page), null);
    if (token === null) return done('incomplete');
    if (token === undefined) return done(issues.length ? 'incomplete' : 'ok');
    if (typeof token !== 'string' || token === '' || tokens.has(token)) { note('invalid or repeated pagination token'); return done('incomplete'); }
    tokens.add(token);
    const following = new URL(current); following.searchParams.set(tokenParam, token); current = following.toString();
  }
}
const required = (page, key, d) => (Array.isArray(page[key]) ? page[key] : incomplete(`${d} collection is ${page[key] === undefined ? 'absent' : 'malformed'}; an omitted list is not evidence of absence`));
const optionalArray = (v, d) => (v === undefined ? [] : Array.isArray(v) ? v : incomplete(`${d} is malformed`));
const pageToken = key => page => (page[key] === undefined ? undefined : typeof page[key] === 'string' && page[key] !== '' ? page[key] : incomplete(`${key} is malformed`));
/** Nonessential metadata: recorded as an issue when malformed, returned as null; never fatal. */
const metaText = (v, d, note) => (typeof v === 'string' && v.length ? v : (note(`${d} missing or not a string`), null));
const metaList = (v, d, note) => { if (v === undefined) return []; if (Array.isArray(v)) return v; note(`${d} is malformed`); return []; };
// Coverage is the worst listing status; exposure is what was seen. A finding
// observed before or beside a failure is kept and stays blocking.
function combine(parts, present) {
  const bad = parts.find(p => p.status === 'unreadable') || parts.find(p => p.status === 'incomplete');
  return { status: bad ? bad.status : present ? 'observed-present' : 'observed-absent', reason: bad ? bad.reason : null,
    exposure: present ? 'observed-present' : bad ? 'none-observed-in-partial-coverage' : 'none' };
}

// --- Hosting -----------------------------------------------------------------
const REWRITE_KEYS = ['glob', 'regex', 'path', 'destination', 'function', 'functionRegion', 'run', 'dynamicLinks'];
function normalizeRewrite(r, d) {
  if (!plain(r)) incomplete(`${d} is not an object`);
  const unknown = Object.keys(r).filter(k => !REWRITE_KEYS.includes(k));
  if (unknown.length) incomplete(`${d} has unknown keys`);
  const patterns = ['glob', 'regex'].filter(k => r[k] !== undefined);
  if (patterns.length !== 1) incomplete(`${d} must have exactly one of glob or regex`);
  const targets = ['destination', 'path', 'function', 'run', 'dynamicLinks'].filter(k => r[k] !== undefined);
  if (targets.length !== 1) incomplete(`${d} must have exactly one target`);
  const pattern = `${patterns[0]}:${text(r[patterns[0]], `${d} pattern`)}`, target = targets[0];
  if (target === 'function') {
    const name = text(r.function, `${d} function`);
    return { pattern, target, name, region: r.functionRegion === undefined ? null : text(r.functionRegion, `${d} functionRegion`), teacherUnits: O.ENDPOINTS.includes(name) };
  }
  if (target === 'run') {
    if (!plain(r.run) || Object.keys(r.run).some(k => !['serviceId', 'region', 'tag', 'pinTag'].includes(k))) incomplete(`${d} run target is malformed`);
    const name = text(r.run.serviceId, `${d} run serviceId`);
    for (const k of ['region', 'tag']) if (r.run[k] !== undefined) text(r.run[k], `${d} run ${k}`);
    if (r.run.pinTag !== undefined && typeof r.run.pinTag !== 'boolean') incomplete(`${d} run pinTag is malformed`);
    return { pattern, target, name, region: r.run.region ?? null, teacherUnits: SERVICES.includes(name.toLowerCase()) };
  }
  if (target === 'dynamicLinks') { if (typeof r.dynamicLinks !== 'boolean') incomplete(`${d} dynamicLinks is malformed`); return { pattern, target, name: null, region: null, teacherUnits: false }; }
  return { pattern, target, name: text(r[target], `${d} ${target}`), region: null, teacherUnits: false };
}
const backendRewrite = r => r.target === 'function' || r.target === 'run';
/**
 * The served rewrites are the target; they are established from the version config
 * alone. Release and version names, release type and version status are metadata:
 * missing or malformed metadata, or a version that is not FINALIZED, is an issue and
 * never discards established rewrites. Without a release, version or config object
 * the channel's target cannot be established. Each rewrite is normalized on its own.
 */
function normalizeChannel(c, site, note) {
  if (!plain(c)) incomplete(`site ${site} channel is not an object`);
  const name = metaText(c.name, `site ${site} channel name`, note);
  if (name !== null && !name.startsWith(`sites/${site}/channels/`)) incomplete(`site ${site} channel ${name} belongs to another site`);
  const label = name ?? `site ${site} unnamed channel`;
  const rel = c.release;
  if (!plain(rel)) incomplete(`${label} release is ${rel === undefined ? 'absent' : 'malformed'}`);
  if (!plain(rel.version)) incomplete(`${label} release version is absent or malformed`);
  if (!plain(rel.version.config)) incomplete(`${label} release version config is absent or malformed`);
  const rewrites = [];
  metaList(rel.version.config.rewrites, `${label} rewrites`, note).forEach((r, i) => {
    try { rewrites.push(normalizeRewrite(r, `${label} rewrite ${i}`)); } catch (error) { if (error instanceof Incomplete) note(error.message); else throw error; }
  });
  const versionStatus = metaText(rel.version.status, `${label} version status`, note);
  if (versionStatus !== null && versionStatus !== 'FINALIZED') note(`${label} release version is ${versionStatus}, not FINALIZED`);
  const releaseType = rel.type === undefined ? null : metaText(rel.type, `${label} release type`, note);
  return { channel: label, release: metaText(rel.name, `${label} release name`, note), releaseType,
    version: metaText(rel.version.name, `${label} version name`, note), versionStatus, rewrites };
}
async function observeHosting(project, probe) {
  const sites = await listAll(probe, `https://firebasehosting.googleapis.com/v1beta1/projects/${project}/sites`, {
    keys: ['sites', 'nextPageToken'], collection: page => required(page, 'sites', 'sites'), next: pageToken('nextPageToken'), tokenParam: 'pageToken',
    item: s => {
      if (!plain(s)) incomplete('site entry is not an object');
      const m = /^projects\/([^/]+)\/sites\/([a-z0-9-]+)$/.exec(text(s.name, 'site name'));
      if (!m || (m[1] !== project && m[1] !== PROJECT_NUMBERS[project])) incomplete('site belongs to another project');
      return m[2];
    } });
  // Every site observed, even from a listing that later failed, is inspected.
  const names = [...new Set(sites.items)].sort();
  const parts = [sites], observed = [], findings = [];
  for (const site of names) {
    const channels = await listAll(probe, `https://firebasehosting.googleapis.com/v1beta1/sites/${site}/channels`, {
      keys: ['channels', 'nextPageToken'], collection: page => required(page, 'channels', `site ${site} channels`), next: pageToken('nextPageToken'),
      tokenParam: 'pageToken', item: (c, _i, note) => normalizeChannel(c, site, note) });
    const list = channels.items.sort((a, b) => (a.channel < b.channel ? -1 : 1));
    parts.push(channels);
    observed.push({ site, status: channels.status === 'ok' ? 'observed' : channels.status, reason: channels.reason, channels: list });
    for (const c of list) for (const r of c.rewrites.filter(backendRewrite)) findings.push(`Hosting ${c.channel} rewrites ${r.pattern} to ${r.target} ${r.name}${r.teacherUnits ? ' (Teacher Units)' : ''}`);
  }
  return { ...combine(parts, findings.length > 0), expectedSites: [...EXPECTED_SITES[project]], sites: observed,
    missingExpectedSites: sites.status === 'ok' ? EXPECTED_SITES[project].filter(s => !names.includes(s)) : null, findings };
}

// --- Cloud Run domain mappings ----------------------------------------------
async function observeDomainMappings(project, probe) {
  const listing = await listAll(probe, `https://${REGION}-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/${project}/domainmappings`, {
    keys: ['apiVersion', 'kind', 'metadata', 'items', 'unreachable'], kind: 'DomainMappingList', tokenParam: 'continue',
    meta: (page, note) => {
      if (metaList(page.unreachable, 'domain mapping unreachable', note).length) note('domain mapping listing reports unreachable locations');
      if (page.metadata !== undefined && !plain(page.metadata)) note('domain mapping list metadata is malformed');
    },
    collection: page => required(page, 'items', 'domain mappings'),
    next: page => (plain(page.metadata) ? pageToken('continue')(page.metadata) : undefined),
    // The route is the target; the mapping name is metadata.
    item: (m, i, note) => {
      if (!plain(m) || !plain(m.spec)) incomplete(`domain mapping ${i} is malformed`);
      const routeName = text(m.spec.routeName, `domain mapping ${i} routeName`);
      const name = plain(m.metadata) ? metaText(m.metadata.name, `domain mapping ${i} name`, note) : (note(`domain mapping ${i} metadata is malformed`), null);
      return { name, routeName, teacherUnits: SERVICES.includes(routeName.toLowerCase()) };
    } });
  const mappings = listing.items.sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
  const findings = mappings.filter(m => m.teacherUnits).map(m => `domain mapping ${m.name ?? '(unnamed)'} routes to Teacher Units service ${m.routeName}`);
  return { ...combine([listing], findings.length > 0), region: REGION, mappings, findings };
}

// --- Serverless NEGs and backend services -----------------------------------
const link = (v, d, note) => { const t = metaText(v, d, note); if (t === null) return null; const i = t.indexOf('/projects/'); if (i < 0) { note(`${d} is malformed`); return null; } return t.slice(i); };
const AGGREGATED_KEYS = ['kind', 'id', 'items', 'nextPageToken', 'selfLink', 'warning', 'unreachables'];
const aggregatedMeta = key => (page, note) => {
  if (metaList(page.unreachables, `${key} unreachables`, note).length) note(`${key} listing reports unreachable scopes`);
  if (page.warning !== undefined && page.warning?.code !== 'NO_RESULTS_ON_PAGE') note(`${key} listing warning`);
};
/** Compute aggregated list: `items` is a required map of scopes; each scope has its list or an empty-page warning. */
const aggregated = key => (page, note) => {
  if (!plain(page.items)) incomplete(`${key} items map is ${page.items === undefined ? 'absent' : 'malformed'}; an omitted map is not evidence of absence`);
  const items = [];
  for (const [scope, value] of Object.entries(page.items)) {
    if (!plain(value)) { note(`${key} scope ${scope} is malformed`); continue; }
    if (value[key] !== undefined) {
      if (Array.isArray(value[key])) items.push(...value[key]); else note(`${key} scope ${scope} list is malformed`);
      if (value.warning !== undefined) note(`${key} scope ${scope} carries a warning with results`);
    } else if (value.warning?.code !== 'NO_RESULTS_ON_PAGE') note(`${key} scope ${scope} has neither results nor an empty-page warning`);
  }
  return items;
};
// Documented serverless NEG target fields (Compute v1). `primary` names the routed resource.
const NEG_TARGETS = Object.freeze({
  cloudRun: { fields: ['service', 'tag', 'urlMask'], primary: 'service', ours: v => SERVICES.includes(v.toLowerCase()), describe: v => `Cloud Run service ${v}` },
  cloudFunction: { fields: ['function', 'urlMask'], primary: 'function', ours: v => O.ENDPOINTS.includes(v), describe: v => `function ${v}` },
  appEngine: { fields: ['service', 'version', 'urlMask'], primary: 'service', ours: () => false, describe: v => `App Engine service ${v}` },
  serverlessDeployment: { fields: ['platform', 'resource', 'version', 'urlMask'], primary: 'resource', ours: () => true, describe: () => 'serverless deployment target is not evaluable' },
});
/**
 * A target is evaluated only when it is structurally valid: a plain object with
 * documented fields, each a nonempty string, naming a resource or a URL mask. A
 * malformed or empty target is an issue (never absence, never an invented exposure).
 */
function evaluateNegTarget(kind, target, label, note) {
  const spec = NEG_TARGETS[kind];
  if (!plain(target)) { note(`${label} ${kind} target is malformed`); return null; }
  const unknown = Object.keys(target).filter(k => !spec.fields.includes(k));
  if (unknown.length) note(`${label} ${kind} target has undocumented fields`);
  const bad = spec.fields.filter(k => target[k] !== undefined && !nonblank(target[k]));
  if (bad.length) note(`${label} ${kind} ${bad.join(', ')} malformed`);
  const valid = k => target[k] !== undefined && !bad.includes(k);
  if (!valid(spec.primary) && !valid('urlMask')) { note(`${label} ${kind} target names no valid resource or URL mask`); return null; }
  if (valid(spec.primary) && spec.ours(target[spec.primary])) return spec.describe(target[spec.primary]);
  if (valid('urlMask')) return `${kind} URL mask can route to any service, including Teacher Units`;
  return null;
}
function normalizeNeg(n, i, note) {
  if (!plain(n)) incomplete(`network endpoint group ${i} is malformed`);
  const name = metaText(n.name, `network endpoint group ${i} name`, note), label = name ?? `network endpoint group ${i}`;
  const selfLink = link(n.selfLink, `${label} selfLink`, note);
  if (n.kind !== undefined && n.kind !== 'compute#networkEndpointGroup') note(`${label} kind is unexpected`);
  const type = metaText(n.networkEndpointType, `${label} networkEndpointType`, note);
  const present = Object.keys(NEG_TARGETS).filter(k => n[k] !== undefined);
  if (type !== 'SERVERLESS' && !present.length) return { name, selfLink, type, target: null, teacherUnits: false, reason: null };
  if (type !== 'SERVERLESS') note(`${label} carries serverless targets but its type is ${type ?? 'unknown'}`);
  if (!present.length) note(`${label} serverless target is absent`);
  if (present.length > 1) note(`${label} has more than one serverless target`);
  const reasons = present.map(k => evaluateNegTarget(k, n[k], label, note)).filter(Boolean);
  return { name, selfLink, type, region: n.region === undefined ? null : link(n.region, `${label} region`, note), target: present.join('+') || null,
    teacherUnits: reasons.length > 0, reason: reasons[0] ?? null };
}
function normalizeBackendService(b, i, note) {
  if (!plain(b)) incomplete(`backend service ${i} is malformed`);
  const name = metaText(b.name, `backend service ${i} name`, note), label = name ?? `backend service ${i}`;
  if (b.kind !== undefined && b.kind !== 'compute#backendService') note(`${label} kind is unexpected`);
  // Each backend is read on its own: a malformed neighbour never hides a valid group.
  const groups = metaList(b.backends, `${label} backends`, note).map((x, j) => (plain(x) ? link(x.group, `${label} backend ${j} group`, note) : (note(`${label} backend ${j} is malformed`), null)))
    .filter(g => g !== null).sort();
  return { name, selfLink: link(b.selfLink, `${label} selfLink`, note), groups };
}
async function observeServerlessNegs(project, probe) {
  const base = `https://compute.googleapis.com/compute/v1/projects/${project}/aggregated`;
  const negList = await listAll(probe, `${base}/networkEndpointGroups`, { keys: AGGREGATED_KEYS, kind: 'compute#networkEndpointGroupAggregatedList',
    meta: aggregatedMeta('networkEndpointGroups'), collection: aggregated('networkEndpointGroups'), item: normalizeNeg, next: pageToken('nextPageToken'), tokenParam: 'pageToken' });
  const backendList = await listAll(probe, `${base}/backendServices`, { keys: AGGREGATED_KEYS, kind: 'compute#backendServiceAggregatedList',
    meta: aggregatedMeta('backendServices'), collection: aggregated('backendServices'), item: normalizeBackendService, next: pageToken('nextPageToken'), tokenParam: 'pageToken' });
  // Findings from whatever was observed are kept even when either listing is partial.
  const key = n => n.selfLink ?? `(no selfLink) ${n.name ?? ''}`;
  const negs = negList.items.filter(n => n.type === 'SERVERLESS' || n.target !== null).sort((a, b) => (key(a) < key(b) ? -1 : 1));
  const relevant = new Set(negs.filter(n => n.teacherUnits && n.selfLink !== null).map(n => n.selfLink));
  const backendServices = backendList.items.filter(b => b.groups.some(g => relevant.has(g))).sort((a, b) => (String(a.selfLink) < String(b.selfLink) ? -1 : 1));
  const findings = [...negs.filter(n => n.teacherUnits).map(n => `serverless NEG ${key(n)}: ${n.reason}`),
    ...backendServices.map(b => `backend service ${b.selfLink ?? b.name ?? '(unnamed)'} uses a Teacher Units serverless NEG`)];
  return { ...combine([negList, backendList], findings.length > 0), negs, backendServices, findings };
}

// --- Deployed A3 runtime build record ---------------------------------------
// Reads one named entry from archive bytes without extracting anything to disk.
function archiveEntry(bytes, name, run = execFileSync) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6c-'));
  try {
    const archive = path.join(directory, 'source.zip'); fs.writeFileSync(archive, bytes, { mode: 0o600 });
    const names = run('unzip', ['-Z1', archive], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: LIMITS.jsonBytes, timeout: 30000 }).trim().split('\n');
    if (names.filter(n => n === name).length !== 1) return null;
    return run('unzip', ['-p', archive, name], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: LIMITS.fileBytes, timeout: 30000 });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function inspectArchive(source, bytes, observation) {
  const entry = { archiveSha256: source.sha256, source: { bucket: source.bucket, object: source.object, generation: source.generation } };
  if (!Buffer.isBuffer(bytes)) return { ...entry, status: 'not-observed', reason: 'the source archive bytes were not captured', record: null, findings: [] };
  const inconsistent = reason => ({ ...entry, status: 'inconsistent', reason, record: null, findings: [`build record: ${reason}`] });
  if (sha256(bytes) !== source.sha256) return inconsistent('captured archive bytes do not match the observed archive hash');
  let runtime;
  try { runtime = archiveRuntime(bytes); } catch { return inconsistent('the captured archive is not a readable Functions source archive'); }
  if (runtime.artifactFingerprint !== observation.functionsArtifactFingerprint) return inconsistent('archive artifact fingerprint differs from the S4 observation');
  const recordHash = runtime.runtimeFiles[RA.RUNTIME_BUILD_PATH];
  if (recordHash === undefined) return { ...entry, status: 'observed-absent', reason: 'the archive carries no A3 runtime build record', record: null, findings: ['build record: absent from the deployed archive'] };
  const recordBytes = archiveEntry(bytes, RA.RUNTIME_BUILD_PATH);
  if (!recordBytes || sha256(recordBytes) !== recordHash) return inconsistent('build record bytes do not match the archive inventory hash');
  let parsed;
  try { parsed = K.parseStrictJSON(recordBytes.toString('utf8')); } catch { return inconsistent('build record is not strict JSON'); }
  const valid = RA.validateRuntimeBuild(parsed);
  if (!valid.ok) return inconsistent('build record fails the A3 runtime build schema');
  const record = valid.value;
  if (recordBytes.toString('utf8') !== `${K.canonicalJSON(record)}\n`) return inconsistent('build record is not in its canonical written form');
  if (record.runtimePayloadFingerprint !== observation.runtimePayloadFingerprint || record.placementFingerprint !== observation.placementFingerprint) {
    return inconsistent('build record fingerprints differ from the observed artifact');
  }
  const findings = [];
  // D12 makes a policy-controlled build selectable, but none is authorized for deployment, so one stays blocking.
  if (record.deploymentMode !== 'closed-only') findings.push(`build record: deployment mode ${record.deploymentMode} observed; policy-controlled artifacts remain blocking until separately authorized (D12 selection is not deployment authorization)`);
  return { ...entry, status: 'observed-present', reason: null, recordSha256: recordHash, deploymentMode: record.deploymentMode,
    policyControlled: record.deploymentMode === 'policy-controlled', sourceDirty: record.sourceDirty, record: JSON.parse(K.canonicalJSON(record)), findings };
}
function observeBuildRecord(observation, archive) {
  const sources = new Map();
  for (const e of observation.endpoints) { const s = e.configuration.build.source; sources.set(s.sha256, s); }
  const archives = [...sources.values()].sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1)).map(s => {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(s.bucket)}/o/${encodeURIComponent(s.object)}?alt=media&generation=${s.generation}`;
    return inspectArchive(s, archive(url), observation);
  });
  const status = ['inconsistent', 'not-observed', 'observed-absent'].find(st => archives.some(a => a.status === st)) || 'observed-present';
  const modes = [...new Set(archives.filter(a => a.status === 'observed-present').map(a => a.deploymentMode))].sort();
  return { status, deploymentModes: modes, archives, findings: archives.flatMap(a => a.findings) };
}

/** Observes the S6c surfaces after a verified S4 observation. */
async function observeSurfaces({ project, probe, archive, observation, now } = {}) {
  if (!Object.hasOwn(ENVIRONMENTS, project)) refuse('an explicit supported --project is required (lyfelabz-staging or lyfelabz-prod)');
  if (typeof probe !== 'function' || typeof archive !== 'function' || typeof now !== 'function') refuse('explicit probe, archive and clock are required; S6c holds no credentials');
  const startedAt = now();
  O.assertA3Observation(observation, project, startedAt);
  const hosting = await observeHosting(project, probe);
  const domainMappings = await observeDomainMappings(project, probe);
  const serverlessNetworkEndpointGroups = await observeServerlessNegs(project, probe);
  const buildRecord = observeBuildRecord(observation, archive);
  const observedAt = now();
  const blocking = [...hosting.findings, ...domainMappings.findings, ...serverlessNetworkEndpointGroups.findings, ...buildRecord.findings];
  const report = { schemaVersion: 1, kind: SURFACE_KIND, authority: AUTHORITY, environment: ENVIRONMENTS[project], projectId: project,
    projectNumber: PROJECT_NUMBERS[project], region: REGION, s4ObservationFingerprint: fingerprint(observation), startedAt, observedAt,
    inheritedIam: { ...INHERITED_IAM }, hosting, domainMappings, serverlessNetworkEndpointGroups, buildRecord, blocking, g3: G3, levelB: 'not-claimed' };
  return JSON.parse(K.canonicalJSON(report));
}

module.exports = { SURFACE_KIND, AUTHORITY, EXPECTED_SITES, STATUSES, INHERITED_IAM, G3, readPlan, observeSurfaces, archiveEntry };
