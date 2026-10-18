'use strict';

// D13 Part B: pure, offline Hosting deployment observation verifier. Non-operational.
// Nothing in a release, deployment or activation path requires this module. It
// performs no I/O (no network, no filesystem, no environment, no clock: `now` is an
// explicit input) and has no activation switch.
//
// It checks that explicitly supplied offline records are mutually consistent: the
// D13 Part A Hosting candidate, the local pair-build evidence, the expected project
// and sites, provider version metadata observed before and after public-edge byte
// verification, the public-edge served-file hashes, and optional provider
// version-file manifest evidence. A pass is observation consistency only. It is not
// provider-backed certification, deployment approval, activation or availability,
// and it does not prove an enabled build.
//
// Provider file hashes are never assumed to equal local SHA-256 hashes (owner
// decision 6). The provider manifest is validated structurally and its
// cryptographic binding to local bytes is always reported as unresolved.
//
// Schema (every record is a plain object of exactly these fields; no optional keys):
//   candidate      the A1 Hosting-only candidate (hosting-identity.cjs)
//   pairBuild      { kind: 'lyfelabz.hostingPairBuild', schemaVersion: 3, releaseIntent,
//                    source: { sha, dirty }, unitPlacement: { fingerprint },
//                    files: { app: { <path>: sha256 }, marketing: { <path>: sha256 } } }
//   expected       { project, sites: { app: <site id>, marketing: <site id> } }
//   routing        { app: Rules, marketing: Rules }, Rules = { ignore: [glob],
//                    redirects: [{ source | regex, destination, type }] }
//   observation    { kind: 'lyfelabz.hostingDeploymentObservation', schemaVersion: 1,
//                    project, startedAt, completedAt, provenance, sites: { app: Site, marketing: Site } }
//   provenance     { kind: 'synthetic-fixture' | 'offline-record', tool,
//                    versionSource: 'hosting-live-channel', byteSource: 'public-edge-cache-busted-get' }
//   Site           { site: 'projects/<project or number>/sites/<id>', versionBefore: Version,
//                    served: { observedAt, files: [{ path, sha256 }] }, versionAfter: Version,
//                    providerFiles: null | { observedAt, hashEncoding: 'provider-reported',
//                                            files: [{ path: '/<file>', hash }] } }
//   Version        { observedAt, versionName, versionStatus, releaseTime, message }
//   now            ISO-8601 UTC timestamp supplied by the caller
const { fingerprint, canonical, MAX_AGE_MS, PROJECT_NUMBERS } = require('./backend-state.cjs');
const { TARGETS, isRedirected, requestPathFor } = require('./contract.cjs');
const { releaseMessage } = require('./release.cjs');
const { FIREBASE_BUILTIN_IGNORES, isHostingIgnored } = require('../../app/scripts/lessonBuilder/hostingExclusion.cjs');
const { validateHostingCandidate, hostingCandidateFingerprint } = require('./hosting-identity.cjs');

// Owner decision 5: observations are no older than five minutes (A1 MAX_AGE_MS).
const MAX_OBSERVATION_AGE_MS = MAX_AGE_MS;
// No timestamp may be later than `now`. The clock-skew allowance is zero.
const CLOCK_SKEW_MS = 0;
// Only FINALIZED versions are acceptable, matching the S6c observer semantics.
const ACCEPTED_VERSION_STATUS = 'FINALIZED';
const OBSERVATION_KIND = 'lyfelabz.hostingDeploymentObservation';
// No live-capture provenance exists: live capture needs separate authorization.
const PROVENANCE_KINDS = Object.freeze(['synthetic-fixture', 'offline-record']);
const SCOPE = 'observation-consistency';
const LIMITATIONS = Object.freeze([
  'public-edge bytes are compared with local SHA-256 only as supplied in the offline observation',
  'provider version-file hashes are not reconciled with local SHA-256; provider-byte binding is unresolved',
  'version metadata and release message are provider-reported claims, not attestation of content',
  'no closed-versus-enabled bundle classification is performed (deferred)',
  'not provider-backed certification, deployment approval, activation or availability'
]);

const DIGEST = /^[a-f0-9]{64}$/;
const SITE_ID = /^[a-z0-9-]+$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function refuse(message) { throw new Error(`[hosting-deployment] REFUSED: ${message}`); }
function record(value, keys, description) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) refuse(`${description} must be a plain object`);
  dataFields(value, description);
  const own = Object.getOwnPropertyNames(value);
  for (const key of own) if (!keys.includes(key)) refuse(`unknown ${description} field: ${key}`);
  for (const key of keys) if (!own.includes(key) || value[key] === undefined) refuse(`missing ${description} field: ${key}`);
  return value;
}
function dataFields(value, description) {
  if (Object.getOwnPropertySymbols(value).length) refuse(`${description} has symbol keys`);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d.enumerable || !('value' in d)) refuse(`${description}.${key} must be an enumerable data field`);
  }
}
function list(value, description) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse(`${description} must be an array`);
  dataFields(value, description);
  if (Object.getOwnPropertyNames(value).length !== value.length + 1) refuse(`${description} has non-index properties`);
  return value;
}
function map(value, description, check) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) refuse(`${description} must be a plain object`);
  dataFields(value, description);
  for (const key of Object.keys(value)) check(key, value[key]);
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
// Artifact-relative paths in the canonical pair-build form.
function relativePath(value, description) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('//') ||
      value.split('/').some(part => part === '' || part === '.' || part === '..')) refuse(`malformed ${description}`);
  return value;
}

function validateRules(rules, description) {
  record(rules, ['ignore', 'redirects'], description);
  list(rules.ignore, `${description}.ignore`).forEach((g, i) => text(g, `${description}.ignore[${i}]`));
  list(rules.redirects, `${description}.redirects`).forEach((r, i) => {
    const d = `${description}.redirects[${i}]`;
    const shape = typeof r?.regex === 'string' ? 'regex' : 'source';
    record(r, [shape, 'destination', 'type'], d);
    text(r[shape], `${d}.${shape}`); text(r.destination, `${d}.destination`);
    if (![301, 302].includes(r.type)) refuse(`unsupported ${d}.type`);
  });
}
// The existing certify rule: non-ignored files whose request path is not redirected.
function deployedFiles(files, rules) {
  const ignore = FIREBASE_BUILTIN_IGNORES.concat(rules.ignore);
  return Object.keys(files).filter(file => !isHostingIgnored(file, ignore)).sort();
}
function servedPaths(deployed, rules) {
  return deployed.filter(file => !isRedirected(requestPathFor(file), rules));
}

function validatePairBuild(pair) {
  record(pair, ['kind', 'schemaVersion', 'releaseIntent', 'source', 'unitPlacement', 'files'], 'pairBuild');
  if (pair.kind !== 'lyfelabz.hostingPairBuild' || pair.schemaVersion !== 3) refuse('unsupported pair-build evidence');
  text(pair.releaseIntent, 'pair-build release intent');
  record(pair.source, ['sha', 'dirty'], 'pairBuild.source');
  record(pair.unitPlacement, ['fingerprint'], 'pairBuild.unitPlacement');
  pattern(pair.unitPlacement.fingerprint, DIGEST, 'pair-build placement fingerprint');
  record(pair.files, TARGETS, 'pairBuild.files');
  for (const target of TARGETS) map(pair.files[target], `pairBuild.files.${target}`, (file, hash) => {
    relativePath(file, `pair-build ${target} path`); pattern(hash, DIGEST, `pair-build ${target} hash for ${file}`);
  });
}

function validateVersion(v, site, description) {
  record(v, ['observedAt', 'versionName', 'versionStatus', 'releaseTime', 'message'], description);
  const observedAt = time(v.observedAt, `${description} observation`);
  const releaseTime = time(v.releaseTime, `${description} release`);
  const m = /^(?:projects\/([^/]+)\/)?sites\/([a-z0-9-]+)\/versions\/([a-f0-9]+)$/.exec(text(v.versionName, `${description} version name`));
  if (!m) refuse(`malformed ${description} version name`);
  if (m[2] !== site.id || (m[1] !== undefined && !site.projects.includes(m[1]))) refuse(`${description} version belongs to another site or project`);
  text(v.versionStatus, `${description} version status`);
  if (v.versionStatus !== ACCEPTED_VERSION_STATUS) refuse(`${description} version status ${v.versionStatus} is not ${ACCEPTED_VERSION_STATUS}`);
  if (typeof v.message !== 'string') refuse(`malformed ${description} release message`);
  if (releaseTime > observedAt) refuse(`${description} release time is after its observation`);
  return observedAt;
}

function validateEntries(entries, description, pathRule, hashKey) {
  const seen = new Map();
  list(entries, description).forEach((entry, i) => {
    const d = `${description}[${i}]`;
    record(entry, ['path', hashKey], d);
    pathRule(entry.path, `${d}.path`);
    pattern(entry[hashKey], DIGEST, `${d}.${hashKey}`);
    if (seen.has(entry.path)) refuse(`duplicate ${description} path: ${entry.path}`);
    seen.set(entry.path, entry[hashKey]);
  });
  return seen;
}
function exactSet(actual, expected, description) {
  const missing = expected.filter(p => !actual.has(p));
  const extra = [...actual.keys()].filter(p => !expected.includes(p)).sort();
  if (missing.length) refuse(`${description} missing: ${missing.join(', ')}`);
  if (extra.length) refuse(`${description} unexpected: ${extra.join(', ')}`);
}

/** Verifies an offline Hosting deployment observation. Throws on any inconsistency.
 * Returns a frozen, non-authorizing consistency result. */
function verifyHostingDeploymentObservation(input) {
  record(input, ['candidate', 'pairBuild', 'expected', 'routing', 'observation', 'now'], 'input');
  const { pairBuild, expected, routing, observation } = input;
  const now = time(input.now, 'now');

  // Candidate and local artifact identity (A1 hashing, Part A contract).
  const candidate = validateHostingCandidate(input.candidate);
  const candidateFingerprint = hostingCandidateFingerprint(candidate);
  if (candidate.source.dirty !== false) refuse('observation requires a candidate built from a clean source');
  validatePairBuild(pairBuild);
  if (pairBuild.releaseIntent !== candidate.releaseIntent) refuse('pair-build and candidate release intent differ');
  if (canonical(pairBuild.source) !== canonical(candidate.source)) refuse('pair-build and candidate source differ');
  if (pairBuild.unitPlacement.fingerprint !== candidate.placementFingerprint) refuse('pair-build and candidate placement differ');
  if (fingerprint(pairBuild.files) !== candidate.hostingArtifactFingerprint) refuse('pair-build files do not reproduce the candidate Hosting artifact fingerprint');

  // Expected identities and routing rules.
  record(expected, ['project', 'sites'], 'expected');
  if (typeof expected.project !== 'string' || !Object.hasOwn(PROJECT_NUMBERS, expected.project)) refuse('unsupported expected project');
  record(expected.sites, TARGETS, 'expected.sites');
  for (const target of TARGETS) pattern(expected.sites[target], SITE_ID, `expected ${target} site`);
  if (expected.sites.app === expected.sites.marketing) refuse('expected app and marketing sites must differ');
  record(routing, TARGETS, 'routing');
  for (const target of TARGETS) validateRules(routing[target], `routing.${target}`);

  // Observation envelope, provenance and freshness.
  record(observation, ['kind', 'schemaVersion', 'project', 'startedAt', 'completedAt', 'provenance', 'sites'], 'observation');
  if (observation.kind !== OBSERVATION_KIND || observation.schemaVersion !== 1) refuse('unsupported observation kind or schema');
  if (observation.project !== expected.project) refuse('observation project differs from the expected project');
  const p = record(observation.provenance, ['kind', 'tool', 'versionSource', 'byteSource'], 'observation.provenance');
  if (!PROVENANCE_KINDS.includes(p.kind)) refuse('unsupported provenance kind');
  text(p.tool, 'provenance tool');
  if (p.versionSource !== 'hosting-live-channel') refuse('unsupported provenance version source');
  if (p.byteSource !== 'public-edge-cache-busted-get') refuse('unsupported provenance byte source');
  const startedAt = time(observation.startedAt, 'observation start');
  const completedAt = time(observation.completedAt, 'observation completion');
  if (startedAt > completedAt) refuse('observation starts after it completes');
  if (completedAt > now + CLOCK_SKEW_MS) refuse('future observation timestamp');
  if (now - startedAt > MAX_OBSERVATION_AGE_MS) refuse('stale observation; older than five minutes');

  record(observation.sites, TARGETS, 'observation.sites');
  const projects = [expected.project, PROJECT_NUMBERS[expected.project]];
  const message = releaseMessage(candidate.source.sha, candidate.source.dirty);
  const sites = {};
  let manifests = 0;
  for (const target of TARGETS) {
    const o = record(observation.sites[target], ['site', 'versionBefore', 'served', 'versionAfter', 'providerFiles'], `observation.sites.${target}`);
    const id = expected.sites[target];
    if (!projects.some(pr => o.site === `projects/${pr}/sites/${id}`)) refuse(`${target} observed site is not the expected site ${id}`);
    const site = { id, projects };

    // Version identity before and after byte verification must be stable.
    const before = validateVersion(o.versionBefore, site, `${target} versionBefore`);
    const after = validateVersion(o.versionAfter, site, `${target} versionAfter`);
    for (const key of ['versionName', 'versionStatus', 'releaseTime', 'message'])
      if (o.versionBefore[key] !== o.versionAfter[key]) refuse(`${target} ${key} changed between before and after observations`);
    if (o.versionBefore.message !== message) refuse(`${target} release message is not ${JSON.stringify(message)}`);

    // Public-edge served bytes: exact coverage and SHA-256 equality.
    record(o.served, ['observedAt', 'files'], `${target} served`);
    const servedAt = time(o.served.observedAt, `${target} served`);
    if (!(startedAt <= before && before <= servedAt && servedAt <= after && after <= completedAt)) refuse(`${target} observations are out of order or outside the observation window`);
    const deployed = deployedFiles(pairBuild.files[target], routing[target]);
    const expectedServed = servedPaths(deployed, routing[target]);
    const served = validateEntries(o.served.files, `${target} served files`, relativePath, 'sha256');
    for (const file of served.keys()) if (deployed.includes(file) && !expectedServed.includes(file)) refuse(`${target} served files include redirected path: ${file}`);
    exactSet(served, expectedServed, `${target} served files`);
    for (const file of expectedServed) if (served.get(file) !== pairBuild.files[target][file]) refuse(`${target} served bytes differ for ${file}`);

    // Provider version-file manifest: structural only, never reconciled with SHA-256.
    let manifest = 'absent';
    if (o.providerFiles !== null) {
      const m = record(o.providerFiles, ['observedAt', 'hashEncoding', 'files'], `${target} providerFiles`);
      const at = time(m.observedAt, `${target} providerFiles`);
      if (at < startedAt || at > completedAt) refuse(`${target} provider manifest is outside the observation window`);
      if (m.hashEncoding !== 'provider-reported') refuse(`unsupported ${target} provider hash encoding`);
      const files = validateEntries(m.files, `${target} provider files`, (value, d) => {
        if (typeof value !== 'string' || !value.startsWith('/')) refuse(`malformed ${d}`);
        relativePath(value.slice(1), d);
      }, 'hash');
      exactSet(files, deployed.map(f => `/${f}`), `${target} provider files`);
      manifest = 'present'; manifests += 1;
    }
    sites[target] = Object.freeze({ site: o.site, versionName: o.versionBefore.versionName, servedPaths: expectedServed.length,
      redirectedPaths: deployed.length - expectedServed.length, providerFileManifest: manifest });
  }

  return Object.freeze({
    scope: SCOPE,
    project: expected.project,
    hostingCandidateFingerprint: candidateFingerprint,
    observationFingerprint: fingerprint(observation),
    provenance: p.kind,
    candidateFingerprintReconstructed: true,
    localAndPublicBytesConsistent: true,
    providerVersionMetadataStable: true,
    providerFileManifest: manifests === TARGETS.length ? 'present' : manifests === 0 ? 'absent' : 'partial',
    providerFileBinding: 'unresolved',
    sites: Object.freeze(sites),
    limitations: LIMITATIONS,
    deployable: false, certified: false, authorized: false, available: false
  });
}

module.exports = { verifyHostingDeploymentObservation, MAX_OBSERVATION_AGE_MS, CLOCK_SKEW_MS, ACCEPTED_VERSION_STATUS, SCOPE };
