'use strict';

// A1: only GET requests and a read-only credential command. Receipts are
// observations, never authorization inputs. No deployment or callable invocation.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { environmentForProject, repositoryRoot, sha256 } = require('./contract.cjs');
const { placementFingerprint } = require('../unit-placement/check-parity.cjs');

const PROJECT_NUMBERS = Object.freeze({ 'lyfelabz-prod': '182791689935', 'lyfelabz-staging': '293337283840' });
const REQUIRED_FUNCTIONS = Object.freeze([
  'teacherUnitsArchive', 'teacherUnitsCreate', 'teacherUnitsGet', 'teacherUnitsList',
  'teacherUnitsReorder', 'teacherUnitsRestore', 'teacherUnitsSetResources', 'teacherUnitsUpdate'
]);
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_PREPARE_AGE_MS = 24 * 60 * 60 * 1000;
function refuse(message) { throw new Error(`[backend-state] REFUSED release readiness: ${message}`); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function canonical(value) { return JSON.stringify(stable(value)); }
function fingerprint(value) { return sha256(canonical(value)); }
function sorted(values) { return [...values].sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0); }
function timestamp(value, description) {
  const n = Date.parse(value);
  if (!Number.isFinite(n)) refuse(`${description} timestamp missing or invalid`);
  return n;
}
function resource(name, project, suffix) {
  const prefixes = [project, PROJECT_NUMBERS[project]].map(p => `projects/${p}/`);
  if (typeof name !== 'string' || !prefixes.some(p => name.startsWith(p)) || !suffix.test(name)) refuse(`wrong-project or malformed resource identity: ${name}`);
  return name;
}
function filesUnder(directory, prefix = '') {
  if (!fs.existsSync(directory)) refuse(`local Functions artifact missing: ${directory}; build Functions first`);
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    if (entry.isSymbolicLink()) refuse('symlink in Functions artifact');
    const rel = prefix + entry.name;
    return entry.isDirectory() ? filesUnder(path.join(directory, entry.name), `${rel}/`) : [rel];
  });
}
function runtimeFile(file) { return /^lib\/.*\.(js|json)$/.test(file) || ['package.json', 'package-lock.json'].includes(file); }
function localCandidate(pair, root = repositoryRoot) {
  if (!pair?.source || typeof pair.source.dirty !== 'boolean' || !pair.files?.app || !pair.files?.marketing || !/^[a-f0-9]{40}$/.test(pair.source.sha || '') || !/^[a-f0-9]{64}$/.test(pair.unitPlacement?.fingerprint || '')) refuse('invalid local pair candidate');
  const directory = path.join(root, 'platform/functions');
  const files = [...filesUnder(path.join(directory, 'lib'), 'lib/').filter(runtimeFile), 'package.json', 'package-lock.json'].sort();
  if (!files.includes('lib/index.js') || !files.includes('lib/teacherUnits/unit-placeable-resources.json')) refuse('incomplete local Functions artifact');
  const runtimeFiles = Object.fromEntries(files.map(file => [file, sha256(fs.readFileSync(path.join(directory, file)))]));
  const placement = JSON.parse(fs.readFileSync(path.join(directory, 'lib/teacherUnits/unit-placeable-resources.json'), 'utf8'));
  if (placementFingerprint(placement.resourceIds) !== pair.unitPlacement.fingerprint) refuse('local compiled placement fingerprint differs from Hosting candidate');
  return {
    source: { sha: pair.source.sha, dirty: pair.source.dirty },
    hostingArtifactFingerprint: fingerprint(pair.files),
    functionsArtifactFingerprint: fingerprint(runtimeFiles), runtimeFiles,
    placementFingerprint: pair.unitPlacement.fingerprint,
    rulesSourceHash: sha256(fs.readFileSync(path.join(root, 'platform/firebase/firestore.rules'))),
    indexes: normalizeLocalIndexes(JSON.parse(fs.readFileSync(path.join(root, 'platform/firebase/firestore.indexes.json'), 'utf8')))
  };
}
function indexDefinition(index) {
  if (!['COLLECTION', 'COLLECTION_GROUP'].includes(index.queryScope) || !Array.isArray(index.fields)) refuse('unknown index definition');
  if (Object.keys(index).some(k => !['name','state','queryScope','fields','apiScope'].includes(k))) refuse('unsupported index metadata');
  if (index.apiScope && index.apiScope !== 'ANY_API') refuse('unsupported index API scope');
  const fields = index.fields.map(f => {
    if (Object.keys(f).some(k => !['fieldPath','order','arrayConfig'].includes(k))) refuse('unsupported index field');
    if (typeof f.fieldPath !== 'string' || !f.fieldPath || Boolean(f.order) === Boolean(f.arrayConfig) || (!['ASCENDING','DESCENDING'].includes(f.order) && f.arrayConfig !== 'CONTAINS')) refuse('unknown index ordering');
    return { fieldPath: f.fieldPath, ...(f.order ? { order: f.order } : { arrayConfig: f.arrayConfig }) };
  });
  return { queryScope: index.queryScope, fields };
}
function normalizeLocalIndexes(config) {
  if (!Array.isArray(config.indexes) || !Array.isArray(config.fieldOverrides) || Object.keys(config).some(k => !['indexes','fieldOverrides'].includes(k))) refuse('unsupported local index configuration');
  const indexes = config.indexes.map(i => {
    const { collectionGroup, ...definition } = i;
    return { collectionGroup, ...indexDefinition(definition) };
  });
  const fieldOverrides = config.fieldOverrides.map(f => {
    if (Object.keys(f).some(k => !['collectionGroup','fieldPath','ttl','indexes'].includes(k)) || !Array.isArray(f.indexes) || (f.ttl !== undefined && typeof f.ttl !== 'boolean')) refuse('unsupported field override');
    for (const i of f.indexes) {
      if (Object.keys(i).some(k => !['queryScope','order','arrayConfig'].includes(k)) || Boolean(i.order) === Boolean(i.arrayConfig)) refuse('unsupported field index');
    }
    return { collectionGroup: f.collectionGroup, fieldPath: f.fieldPath, ttl: f.ttl === true,
      indexes: sorted((f.indexes || []).map(i => indexDefinition({ queryScope:i.queryScope, fields: [{ fieldPath: f.fieldPath, ...(i.order ? {order:i.order} : {arrayConfig:i.arrayConfig}) }] }))) };
  });
  return { indexes: sorted(indexes), fieldOverrides: sorted(fieldOverrides) };
}
function normalizeRemoteIndexes(indexes, fields, project) {
  const result = indexes.map(i => {
    resource(i.name, project, /\/databases\/\(default\)\/collectionGroups\/[^/]+\/indexes\/[^/]+$/);
    if (i.state !== 'READY') refuse(`index not READY: ${i.name}`);
    return { collectionGroup: i.name.split('/')[5], ...indexDefinition(i) };
  });
  const overrides = fields.map(f => {
    resource(f.name, project, /\/databases\/\(default\)\/collectionGroups\/[^/]+\/fields\/[^/]+$/);
    if (f.ttlConfig && f.ttlConfig.state !== 'ACTIVE') refuse(`TTL not ACTIVE: ${f.name}`);
    const config = f.indexConfig;
    if (!config || config.reverting === true || !Array.isArray(config.indexes)) refuse(`field index identity uncertain: ${f.name}`);
    const collectionGroup = f.name.split('/')[5];
    const fieldPath = decodeURIComponent(f.name.split('/')[7]);
    const definitions = config.indexes.map(i => {
      if (i.state !== 'READY') refuse(`field index not READY: ${f.name}`);
      return indexDefinition(i);
    });
    return { collectionGroup, fieldPath, ttl: Boolean(f.ttlConfig), indexes: sorted(definitions) };
  });
  return { indexes: sorted(result), fieldOverrides: sorted(overrides) };
}
function tokenFromGcloud(run = execFileSync) {
  let token;
  try { token = run('gcloud', ['auth', 'print-access-token', '--quiet'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30000 }).trim(); }
  catch { refuse('missing credentials: gcloud auth print-access-token failed (credentials are never logged)'); }
  if (!token || /\s/.test(token)) refuse('missing credentials: invalid access token');
  return token;
}
function readApi({ token, fetchImpl = fetch }) {
  return async (url, binary = false) => {
    let response;
    try { response = await fetchImpl(url, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }); }
    catch { refuse(`deployment API unavailable: ${new URL(url).host}`); }
    if (!response.ok) refuse(`deployment API ${new URL(url).host} HTTP ${response.status}${[401,403].includes(response.status) ? ' (credentials or read permission missing)' : ''}`);
    try { return binary ? Buffer.from(await response.arrayBuffer()) : await response.json(); }
    catch { refuse(`unverifiable deployment API response: ${new URL(url).host}`); }
  };
}
async function list(get, url, key) {
  const rows = []; const tokens = new Set();
  do {
    const page = await get(url);
    if (!page || typeof page !== 'object' || Array.isArray(page)) refuse(`invalid ${key} inventory response`);
    if (page.unreachable?.length) refuse('deployment inventory has unreachable locations');
    if (page[key] !== undefined && !Array.isArray(page[key])) refuse(`invalid ${key} inventory`);
    rows.push(...(page[key] || []));
    if (!page.nextPageToken) break;
    if (typeof page.nextPageToken !== 'string' || tokens.has(page.nextPageToken)) refuse('invalid inventory pagination');
    tokens.add(page.nextPageToken);
    const next = new URL(url); next.searchParams.set('pageToken', page.nextPageToken); url = next.toString();
  } while (true);
  return rows;
}
// Never extract archive entries to disk. unzip only lists and streams selected
// runtime files. Temporary archive is private and deleted on success or refusal.
function archiveRuntime(bytes, run = execFileSync) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-backend-'));
  try {
    const archive = path.join(directory, 'source.zip'); fs.writeFileSync(archive, bytes, { mode: 0o600 });
    const names = run('unzip', ['-Z1', archive], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], maxBuffer: 8 * 1024 * 1024 }).trim().split('\n');
    if (new Set(names).size !== names.length || names.some(n => n.startsWith('/') || n.includes('\\') || n.split('/').includes('..'))) refuse('unsafe or duplicate archive paths');
    const files = names.filter(runtimeFile).sort();
    const runtimeFiles = Object.fromEntries(files.map(f => [f, sha256(run('unzip', ['-p', archive, f], { stdio: ['ignore','pipe','pipe'], maxBuffer: 16 * 1024 * 1024 }))]));
    const manifest = JSON.parse(run('unzip', ['-p', archive, 'lib/teacherUnits/unit-placeable-resources.json'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }));
    if (!Array.isArray(manifest.resourceIds) || !manifest.resourceIds.length || new Set(manifest.resourceIds).size !== manifest.resourceIds.length || manifest.resourceIds.some(id => typeof id !== 'string' || !id)) refuse('invalid deployed placement manifest');
    return { runtimeFiles, artifactFingerprint: fingerprint(runtimeFiles), placementFingerprint: placementFingerprint(manifest.resourceIds), archiveHash: sha256(bytes) };
  } catch (error) { refuse(`deployed source archive unverifiable: ${error.message}`); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function functionIdentity(fn, project) {
  resource(fn.name, project, /\/locations\/[^/]+\/functions\/[^/]+$/);
  const id = fn.name.split('/').pop();
  if (fn.environment !== 'GEN_2' || fn.state !== 'ACTIVE' || fn.buildConfig?.runtime !== 'nodejs22' || fn.buildConfig?.entryPoint !== id || !fn.buildConfig?.build || !fn.serviceConfig?.revision || fn.serviceConfig?.allTrafficOnLatestRevision !== true) refuse(`unknown/inactive deployed revision or traffic split: ${id}`);
  resource(fn.buildConfig.build, project, /\/locations\/[^/]+\/builds\/[^/]+$/);
  resource(fn.serviceConfig.service, project, /\/locations\/[^/]+\/services\/[^/]+$/);
  if (fn.name.split('/')[3] !== fn.serviceConfig.service.split('/')[3]) refuse('Functions service region identity mismatch');
  timestamp(fn.updateTime, 'function update');
  const source = fn.buildConfig.sourceProvenance?.resolvedStorageSource;
  if (!source?.bucket || !source.object || !/^[0-9]+$/.test(String(source.generation || ''))) refuse(`immutable deployed Functions source unavailable: ${id}`);
  return { name: fn.name, state: fn.state, runtime: fn.buildConfig.runtime, entryPoint: id, build: fn.buildConfig.build,
    service: fn.serviceConfig.service, revision: fn.serviceConfig.revision, allTrafficOnLatestRevision: true,
    updateTime: fn.updateTime, source: { bucket: source.bucket, object: source.object, generation: String(source.generation) } };
}
async function inspectBackend({ project, get, unpack = archiveRuntime, now = () => new Date().toISOString() }) {
  const environment = environmentForProject(project);
  const startedAt = now();
  const remoteProject = await get(`https://firebase.googleapis.com/v1beta1/projects/${project}`);
  if (remoteProject.projectId !== project || String(remoteProject.projectNumber) !== PROJECT_NUMBERS[project] || remoteProject.state !== 'ACTIVE' || remoteProject.name !== `projects/${project}`) refuse('wrong-project Firebase identity');
  const db = await get(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`);
  resource(db.name, project, /\/databases\/\(default\)$/);
  if (db.type !== 'FIRESTORE_NATIVE') refuse('unknown Firestore database identity/type');
  const functionsUrl = `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/-/functions`;
  const inventory = await list(get, functionsUrl, 'functions');
  for (const fn of inventory) resource(fn.name, project, /\/locations\/[^/]+\/functions\/[^/]+$/);
  const functions = []; const archives = new Map();
  for (const id of REQUIRED_FUNCTIONS) {
    const matches = inventory.filter(fn => fn.name.split('/').pop() === id);
    if (matches.length !== 1) refuse(`missing or ambiguous Functions evidence: ${id}`);
    // GET, not just LIST, proves current traffic/provenance for this endpoint.
    const url = `https://cloudfunctions.googleapis.com/v2/${matches[0].name}`;
    const fn = functionIdentity(await get(url), project);
    if (timestamp(fn.updateTime, 'function update') > timestamp(now(), 'observation')) refuse('future Function deployment timestamp');
    if (fn.entryPoint !== id || fn.name !== matches[0].name) refuse('Functions identity changed');
    const storageUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(fn.source.bucket)}/o/${encodeURIComponent(fn.source.object)}?alt=media&generation=${fn.source.generation}`;
    if (!archives.has(storageUrl)) archives.set(storageUrl, unpack(await get(storageUrl, true)));
    const artifact = archives.get(storageUrl);
    // Bracket source retrieval with current endpoint metadata. This is not a
    // cross-service transaction, nor a guarantee against a later deployment.
    if (canonical(fn) !== canonical(functionIdentity(await get(url), project))) refuse(`Functions changed during inventory: ${id}`);
    functions.push({ ...fn, ...artifact });
  }
  const releaseUrl = `https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`;
  const release = await get(releaseUrl);
  if (release.name !== `projects/${project}/releases/cloud.firestore`) refuse('wrong-project Rules release');
  resource(release.rulesetName, project, /\/rulesets\/[^/]+$/);
  if (timestamp(release.updateTime, 'Rules release') > timestamp(now(), 'observation')) refuse('future Rules deployment timestamp');
  const ruleset = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  if (ruleset.name !== release.rulesetName || !Array.isArray(ruleset.source?.files) || ruleset.source.files.length !== 1 || typeof ruleset.source.files[0].content !== 'string') refuse('Rules source identity uncertain');
  if (canonical(release) !== canonical(await get(releaseUrl))) refuse('Rules changed during inventory');
  const indexesUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/-/indexes`;
  const fieldsUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/-/fields`;
  async function indexSnapshot() {
    const indexes = await list(get, indexesUrl, 'indexes');
    const fields = [...await list(get, `${fieldsUrl}?filter=indexConfig.usesAncestorConfig%3Dfalse`, 'fields'),
      ...await list(get, `${fieldsUrl}?filter=ttlConfig%3A*`, 'fields')];
    const byName = new Map();
    for (const f of fields) {
      if (byName.has(f.name) && canonical(byName.get(f.name)) !== canonical(f)) refuse('field identity changed during inventory');
      byName.set(f.name, f);
    }
    return { configuration: normalizeRemoteIndexes(indexes, [...byName.values()], project), resources: sorted(indexes.map(i => ({ name:i.name, state:i.state }))), fieldResources: sorted([...byName.values()].map(f => ({ name:f.name, ttlState:f.ttlConfig?.state || null }))) };
  }
  const indexes = await indexSnapshot();
  if (canonical(indexes) !== canonical(await indexSnapshot())) refuse('indexes changed during inventory');
  const evidence = {
    kind: 'lyfelabz.backendObservation', schemaVersion: 1, startedAt, observedAt: now(),
    project, projectNumber: PROJECT_NUMBERS[project], environment: environment.name, database: db.name,
    functions: sorted(functions), inventory: sorted(inventory.map(f => ({ name:f.name, environment:f.environment || 'UNKNOWN', state:f.state || 'UNKNOWN', updateTime:f.updateTime || null }))),
    rules: { release: release.name, ruleset: ruleset.name, updateTime: release.updateTime, file: ruleset.source.files[0].name, sourceHash: sha256(ruleset.source.files[0].content) },
    indexes: { ...indexes, configurationHash: fingerprint(indexes.configuration) },
    sources: ['Firebase Management GET', 'Cloud Functions v2 LIST/GET', 'generation-pinned Cloud Storage GET', 'Firebase Rules release/ruleset GET', 'Firestore Admin database/index/field GET']
  };
  assertFresh(evidence, project, now());
  return evidence;
}
function assertFresh(evidence, project, now = new Date().toISOString()) {
  const environment = environmentForProject(project);
  if (evidence?.kind !== 'lyfelabz.backendObservation' || evidence.schemaVersion !== 1 || evidence.project !== project || evidence.projectNumber !== PROJECT_NUMBERS[project] || evidence.environment !== environment.name) refuse('wrong-project or unsupported backend evidence');
  const current = timestamp(now, 'current');
  const start = timestamp(evidence.startedAt, 'observation start');
  const end = timestamp(evidence.observedAt, 'observation end');
  if (start > end || end > current || current - start > MAX_AGE_MS) refuse('stale or future backend observation; retrieve deployment evidence again');
}
function assertCompatible(candidate, evidence, now) {
  assertFresh(evidence, evidence?.project, now);
  if (!candidate?.runtimeFiles || fingerprint(candidate.runtimeFiles) !== candidate.functionsArtifactFingerprint || !/^[a-f0-9]{64}$/.test(candidate.placementFingerprint || '') || !Array.isArray(evidence.functions) || evidence.functions.length !== REQUIRED_FUNCTIONS.length) refuse('missing Functions evidence');
  for (const id of REQUIRED_FUNCTIONS) {
    const matches = evidence.functions.filter(f => f.entryPoint === id);
    if (matches.length !== 1) refuse(`missing Functions evidence: ${id}`);
    const f = matches[0];
    if (!f.runtimeFiles || typeof f.runtimeFiles !== 'object') refuse(`missing Functions artifact: ${id}`);
    if (f.placementFingerprint !== candidate.placementFingerprint) refuse(`incompatible placement fingerprint: ${id}`);
    if (fingerprint(f.runtimeFiles) !== f.artifactFingerprint || f.artifactFingerprint !== candidate.functionsArtifactFingerprint || canonical(f.runtimeFiles) !== canonical(candidate.runtimeFiles)) refuse(`unknown or incompatible Functions artifact: ${id}`);
  }
  if (evidence.rules?.sourceHash !== candidate.rulesSourceHash) refuse('Rules source identity uncertain or incompatible');
  if (!evidence.indexes?.configuration || fingerprint(evidence.indexes.configuration) !== evidence.indexes.configurationHash || canonical(candidate.indexes) !== canonical(evidence.indexes.configuration)) refuse('index identity uncertain or incompatible');
  return { policy: 'u26-a1-exact-backend-artifact-v1', compatible: true };
}
async function verifyBackend({ project, pair, get, token, fetchImpl, run, unpack, now, root } = {}) {
  environmentForProject(project); // before credentials, network, or filesystem reads
  const candidate = localCandidate(pair, root);
  if (environmentForProject(project).name === 'production' && candidate.source.dirty !== false) refuse('production candidate must be built from a clean checkout');
  if (!pair.backendCandidate || canonical(pair.backendCandidate) !== canonical(candidate)) refuse('local backend candidate changed since pair build; rebuild the pair');
  const evidence = await inspectBackend({ project, get: get || readApi({ token: token || tokenFromGcloud(run), fetchImpl }), unpack, now });
  const compatibility = assertCompatible(candidate, evidence, now?.());
  return { candidate, evidence, compatibility };
}
function receipt({ phase, project, candidate, evidence, hosting, recordedAt = new Date().toISOString() }) {
  if (!['prepared','certified'].includes(phase)) refuse('unknown release receipt phase');
  assertFresh(evidence, project, recordedAt);
  const compatibility = assertCompatible(candidate, evidence, recordedAt);
  if (!hosting?.app || !hosting?.marketing) refuse('missing paired Hosting evidence');
  return stable({ kind:'lyfelabz.releaseEvidenceReceipt', schemaVersion:1, phase, recordedAt,
    project, environment:environmentForProject(project).name, candidate, backend:evidence, compatibility,
    hosting, authority:'historical observation only; every readiness check retrieves current deployment evidence' });
}
// Prepared records are historical rollback observations, not current backend
// authority. Validate their scope and candidate, then always fetch backend anew.
function verifyPrepared(prepared, project, candidate, now = new Date().toISOString()) {
  const environment = environmentForProject(project);
  if (prepared?.kind !== 'lyfelabz.hostingPreparedRelease' || prepared.schemaVersion !== 2 ||
      prepared.project !== project || prepared.environment !== environment.name ||
      canonical(prepared.source) !== canonical(candidate.source) ||
      canonical(prepared.candidate) !== canonical(candidate) ||
      prepared.evidenceReceipt?.phase !== 'prepared' || prepared.evidenceReceipt.project !== project ||
      canonical(prepared.evidenceReceipt.candidate) !== canonical(candidate)) refuse('missing, historical-schema, wrong-project or different-candidate prepare evidence; prepare again');
  const preparedTime = timestamp(prepared.preparedAt, 'prepared');
  const current = timestamp(now, 'current');
  if (preparedTime > current || current - preparedTime > MAX_PREPARE_AGE_MS) refuse('stale or future prepare receipt; a fresh pre-release baseline is required');
  // This checks consistency at the historical observation time. It does NOT
  // turn that receipt into a fresh observation or a known-good rollback target.
  assertFresh(prepared.evidenceReceipt.backend, project, prepared.evidenceReceipt.recordedAt);
  assertCompatible(candidate, prepared.evidenceReceipt.backend, prepared.evidenceReceipt.recordedAt);
  if (canonical(prepared.evidenceReceipt.hosting) !== canonical(prepared.surfaces)) refuse('rollback evidence differs from prepared receipt');
  for (const target of ['app','marketing']) {
    const baseline = prepared.surfaces?.[target]?.baseline;
    if (!/^[a-f0-9]+$/.test(baseline?.version || '')) refuse(`missing rollback baseline evidence: ${target}`);
    timestamp(baseline.releaseTime, 'Hosting baseline');
    if (timestamp(baseline.releaseTime, 'Hosting baseline') > timestamp(prepared.preparedAt, 'prepared')) refuse('future Hosting rollback baseline');
    const expectedSite = require('./contract.cjs').readTargetSites(project)[target];
    if (prepared.surfaces[target].site !== expectedSite) refuse('wrong-project rollback site');
  }
}
module.exports = { PROJECT_NUMBERS, REQUIRED_FUNCTIONS, MAX_AGE_MS, MAX_PREPARE_AGE_MS, canonical, fingerprint, localCandidate,
  normalizeLocalIndexes, normalizeRemoteIndexes, tokenFromGcloud, readApi, archiveRuntime, inspectBackend,
  assertFresh, assertCompatible, verifyBackend, receipt, verifyPrepared };

// Standalone inventory does not build or deploy, and does not certify readiness.
async function main(argv = process.argv.slice(2)) {
  const { parseArgs, writeRecord } = require('./release.cjs');
  const args = parseArgs(argv, { values:['project'], flags:[] });
  environmentForProject(args.project);
  const evidence = await inspectBackend({ project:args.project, get:readApi({ token:tokenFromGcloud() }) });
  const file = writeRecord(`backend-${args.project}.json`, evidence);
  console.log(`Backend observed for ${args.project}; historical evidence saved to ${file}. This inventory alone does not certify release readiness.`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode=1; });
