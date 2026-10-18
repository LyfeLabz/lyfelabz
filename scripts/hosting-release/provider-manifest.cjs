'use strict';

// D13 Part C: offline Firebase Hosting provider file-manifest normalization and
// gzip-hash binding. Non-operational. Nothing in a release, deployment or
// activation path requires this module, and it performs no network or
// filesystem I/O. `compressionProfile()` reads only `process.versions` and runs
// in-memory compression; every other function is pure over supplied records.
//
// Provider semantics (Firebase Hosting REST v1beta1 discovery, revision 20261011,
// and firebase-tools 15.22.4 lib/deploy/hosting/uploader.js):
//   - `sites.versions.files.list` returns `{ files: [VersionFile], nextPageToken }`;
//     page tokens are short-lived; the last page has no token.
//   - VersionFile is `{ path, hash, status }`; `path` is the URI the content displays
//     at ("/" + the public-directory-relative POSIX path); `status` is EXPECTED or ACTIVE.
//   - `hash` is SHA-256 (lowercase hex) of the gzip-compressed file: "Gzipping the file
//     then taking the SHA256 hash of the newly compressed file". firebase-tools uses
//     `zlib.createGzip({ level: 9 })` (no override in deploy).
//   - A FINALIZED version can no longer be changed; `fileCount` is calculated after
//     finalization.
// The gzip header carries an OS byte (0x13 on macOS, 0x03 on Linux builds of Node's
// zlib) and deflate output can vary by zlib build and CPU, so identical version
// strings never prove identical output. Compatibility is decided only by byte-level
// calibration digests over fixed vectors.
//
// Provider manifest input (`normalizeProviderManifest`):
//   { expected: { project, projectNumber, site, versionName },
//     version: { name, status, fileCount },
//     provenance: { kind: 'synthetic-fixture' | 'offline-record', tool,
//                   source: 'firebasehosting.v1beta1.sites.versions.files.list', observedAt },
//     pages: [{ requestPageToken: null | <token>, response: { files: [VersionFile], nextPageToken? } }] }
// Binding input (`bindProviderManifest`):
//   { manifest: <normalized manifest>, uploaded: [<relative path>],
//     local: { profile: <compression profile>, files: { '/<path>': { sha256, gzipSha256 } } },
//     deployProfile: null | <compression profile recorded where the deploy ran> }
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MANIFEST_KIND = 'lyfelabz.providerFileManifest';
const PROFILE_KIND = 'lyfelabz.gzipCompressionProfile';
const PROVIDER_SOURCE = 'firebasehosting.v1beta1.sites.versions.files.list';
const PROVENANCE_KINDS = Object.freeze(['synthetic-fixture', 'offline-record']);
const HASH_ENCODING = 'sha256-of-gzip';
const REFERENCE = 'firebase-tools 15.22.4 lib/deploy/hosting/uploader.js zipStream (zlib.createGzip level 9)';
// The compression parameters firebase-tools uses (Node zlib defaults plus level 9).
const GZIP_PARAMETERS = Object.freeze({ level: 9, windowBits: 15, memLevel: 8, strategy: 0 });
const BINDINGS = Object.freeze(['bound', 'mismatch', 'unreproducible']);

// Fixed calibration inputs. Both profiles must produce identical gzip SHA-256 for
// every vector before any provider hash is compared.
function patterned(length) {
  const b = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) b[i] = (i * 31 + (i >> 7)) & 255;
  return b;
}
const CALIBRATION_VECTORS = Object.freeze({
  empty: () => Buffer.alloc(0),
  'hello-newline': () => Buffer.from('hello\n'),
  'all-bytes': () => Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
  'repeated-html': () => Buffer.from('<!doctype html><p>LyfeLabz Hosting calibration</p>\n'.repeat(2048)),
  'patterned-300000': () => patterned(300000)
});

const DIGEST = /^[a-f0-9]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const PAGE_TOKEN = /^[A-Za-z0-9_\-.~+/=]{1,4096}$/;
const VERSION_ID = /^[a-f0-9]+$/;

function refuse(message) { throw new Error(`[provider-manifest] REFUSED: ${message}`); }
function plain(value, description) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) refuse(`${description} must be a plain object`);
  fields(value, description);
  return value;
}
function fields(value, description) {
  if (Object.getOwnPropertySymbols(value).length) refuse(`${description} has symbol keys`);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d.enumerable || !('value' in d)) refuse(`${description}.${key} must be an enumerable data field`);
  }
}
function record(value, keys, description, optional = []) {
  plain(value, description);
  const own = Object.getOwnPropertyNames(value);
  for (const key of own) if (!keys.includes(key) && !optional.includes(key)) refuse(`unknown ${description} field: ${key}`);
  for (const key of keys) if (!own.includes(key) || value[key] === undefined) refuse(`missing ${description} field: ${key}`);
  for (const key of optional) if (own.includes(key) && value[key] === undefined) refuse(`undefined ${description} field: ${key}`);
  return value;
}
function list(value, description) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse(`${description} must be an array`);
  fields(value, description);
  if (Object.getOwnPropertyNames(value).length !== value.length + 1) refuse(`${description} has non-index properties`);
  return value;
}
function text(value, description) {
  if (typeof value !== 'string' || !value) refuse(`malformed ${description}`);
  return value;
}
function digest(value, description) {
  if (typeof value !== 'string' || !DIGEST.test(value)) refuse(`malformed ${description}`);
  return value;
}
function time(value, description) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) refuse(`malformed ${description} timestamp`);
  return value;
}
function relativePath(value, description) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('//') ||
      value.split('/').some(part => part === '' || part === '.' || part === '..')) refuse(`malformed ${description}`);
  return value;
}
// Provider paths are "/" plus a canonical relative path.
function providerPath(value, description) {
  if (typeof value !== 'string' || !value.startsWith('/')) refuse(`malformed ${description}`);
  relativePath(value.slice(1), description);
  return value;
}
function sorted(entries) { return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))); }
function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) deepFreeze(v); Object.freeze(value); }
  return value;
}

// --- Compression ---------------------------------------------------------------

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
/** SHA-256 of the gzip of `bytes` under the firebase-tools parameters. */
function gzipSha256(bytes) {
  if (!Buffer.isBuffer(bytes)) refuse('gzip input must be a Buffer');
  return sha256(zlib.gzipSync(bytes, { ...GZIP_PARAMETERS }));
}

/** The local compression profile: runtime provenance plus calibration digests. */
function compressionProfile() {
  const header = zlib.gzipSync(Buffer.alloc(0), { ...GZIP_PARAMETERS });
  return deepFreeze({
    kind: PROFILE_KIND, schemaVersion: 1,
    node: process.versions.node, zlib: process.versions.zlib,
    implementation: 'node:zlib gzipSync', reference: REFERENCE,
    container: 'gzip', hashAlgorithm: 'sha256', parameters: { ...GZIP_PARAMETERS },
    header: { mtime: header.readUInt32LE(4), xfl: header[8], os: header[9] },
    calibration: sorted(Object.fromEntries(Object.entries(CALIBRATION_VECTORS).map(([name, make]) => [name, gzipSha256(make())])))
  });
}

function validateProfile(profile, description) {
  record(profile, ['kind', 'schemaVersion', 'node', 'zlib', 'implementation', 'reference', 'container', 'hashAlgorithm', 'parameters', 'header', 'calibration'], description);
  if (profile.kind !== PROFILE_KIND || profile.schemaVersion !== 1) refuse(`unsupported ${description}`);
  for (const key of ['node', 'zlib', 'implementation', 'reference', 'container', 'hashAlgorithm']) text(profile[key], `${description}.${key}`);
  record(profile.parameters, Object.keys(GZIP_PARAMETERS), `${description}.parameters`);
  for (const key of Object.keys(GZIP_PARAMETERS)) if (!Number.isInteger(profile.parameters[key])) refuse(`malformed ${description}.parameters.${key}`);
  record(profile.header, ['mtime', 'xfl', 'os'], `${description}.header`);
  for (const key of ['mtime', 'xfl', 'os']) if (!Number.isInteger(profile.header[key]) || profile.header[key] < 0) refuse(`malformed ${description}.header.${key}`);
  record(profile.calibration, Object.keys(CALIBRATION_VECTORS), `${description}.calibration`);
  for (const name of Object.keys(CALIBRATION_VECTORS)) digest(profile.calibration[name], `${description}.calibration.${name}`);
  return profile;
}

// Byte-level compatibility only: version strings are recorded, never decisive.
function profileIncompatibility(local, deploy) {
  if (deploy === null) return 'deploy compression profile was not recorded';
  for (const [description, p] of [['local', local], ['deploy', deploy]]) {
    if (p.container !== 'gzip' || p.hashAlgorithm !== 'sha256') return `${description} profile is not gzip with SHA-256`;
    for (const [key, value] of Object.entries(GZIP_PARAMETERS)) if (p.parameters[key] !== value) return `${description} profile ${key} is ${p.parameters[key]}, not ${value}`;
  }
  for (const key of ['mtime', 'xfl', 'os']) if (local.header[key] !== deploy.header[key]) return `gzip header ${key} differs`;
  for (const name of Object.keys(CALIBRATION_VECTORS)) if (local.calibration[name] !== deploy.calibration[name]) return `calibration vector ${name} differs`;
  return null;
}

/** Local per-file evidence for supplied artifact bytes ({ <relative path>: Buffer }). */
function localGzipManifest(files) {
  plain(files, 'local files');
  const out = {};
  for (const [file, bytes] of Object.entries(files)) {
    relativePath(file, `local file path ${file}`);
    if (!Buffer.isBuffer(bytes)) refuse(`local file ${file} must be a Buffer`);
    out[`/${file}`] = { sha256: sha256(bytes), gzipSha256: gzipSha256(bytes) };
  }
  return deepFreeze({ profile: compressionProfile(), files: sorted(out) });
}

// --- Provider manifest -------------------------------------------------------

/** Normalizes complete `versions.files.list` evidence for one FINALIZED version. */
function normalizeProviderManifest(input) {
  record(input, ['expected', 'version', 'provenance', 'pages'], 'provider manifest input');
  const e = record(input.expected, ['project', 'projectNumber', 'site', 'versionName'], 'expected');
  text(e.project, 'expected project'); text(e.site, 'expected site');
  if (typeof e.projectNumber !== 'string' || !/^\d+$/.test(e.projectNumber)) refuse('malformed expected project number');
  const name = /^(?:projects\/([^/]+)\/)?sites\/([a-z0-9-]+)\/versions\/([^/]+)$/.exec(text(e.versionName, 'expected version name'));
  if (!name || !VERSION_ID.test(name[3])) refuse('malformed expected version name');
  if (name[2] !== e.site || (name[1] !== undefined && ![e.project, e.projectNumber].includes(name[1]))) refuse('expected version belongs to another site or project');

  const v = record(input.version, ['name', 'status', 'fileCount'], 'version');
  if (v.name !== e.versionName) refuse('version name is not the expected version');
  if (v.status !== 'FINALIZED') refuse(`version status ${String(v.status)} is not FINALIZED`);
  if (!Number.isSafeInteger(v.fileCount) || v.fileCount < 0) refuse('malformed version fileCount');

  const p = record(input.provenance, ['kind', 'tool', 'source', 'observedAt'], 'provenance');
  if (!PROVENANCE_KINDS.includes(p.kind)) refuse('unsupported provenance kind');
  text(p.tool, 'provenance tool');
  if (p.source !== PROVIDER_SOURCE) refuse('unsupported provenance source');
  time(p.observedAt, 'provenance');

  const pages = list(input.pages, 'pages');
  if (!pages.length) refuse('no provider manifest pages');
  const files = {};
  const tokens = new Set();
  let expectedToken = null;
  pages.forEach((page, i) => {
    const d = `pages[${i}]`;
    record(page, ['requestPageToken', 'response'], d);
    if (page.requestPageToken !== expectedToken) refuse(`${d} does not continue the previous page (missing or reordered page)`);
    const r = record(page.response, ['files'], `${d}.response`, ['nextPageToken']);
    list(r.files, `${d}.response.files`).forEach((f, j) => {
      const fd = `${d}.response.files[${j}]`;
      record(f, ['path', 'hash', 'status'], fd);
      providerPath(f.path, `${fd}.path`);
      digest(f.hash, `${fd}.hash`);
      if (f.status !== 'ACTIVE') refuse(`${fd}.status ${String(f.status)} is not ACTIVE`);
      if (Object.hasOwn(files, f.path)) refuse(`duplicate provider path: ${f.path}`);
      files[f.path] = f.hash;
    });
    if (Object.hasOwn(r, 'nextPageToken')) {
      if (typeof r.nextPageToken !== 'string' || !PAGE_TOKEN.test(r.nextPageToken)) refuse(`malformed ${d} continuation token`);
      if (tokens.has(r.nextPageToken)) refuse(`${d} repeats a continuation token; pagination does not terminate`);
      tokens.add(r.nextPageToken);
      if (i === pages.length - 1) refuse('pagination is incomplete: the last page has a continuation token');
      expectedToken = r.nextPageToken;
    } else if (i !== pages.length - 1) refuse(`${d} ends pagination but more pages follow`);
  });
  const count = Object.keys(files).length;
  if (count !== v.fileCount) refuse(`provider file count ${count} is not the version fileCount ${v.fileCount}`);

  return deepFreeze({
    kind: MANIFEST_KIND, schemaVersion: 1,
    project: e.project, site: e.site, versionName: v.name, versionStatus: v.status, fileCount: v.fileCount,
    hashEncoding: HASH_ENCODING, pageCount: pages.length,
    provenance: { kind: p.kind, tool: p.tool, source: p.source, observedAt: p.observedAt },
    files: sorted(files)
  });
}

function validateManifest(m) {
  record(m, ['kind', 'schemaVersion', 'project', 'site', 'versionName', 'versionStatus', 'fileCount', 'hashEncoding', 'pageCount', 'provenance', 'files'], 'manifest');
  if (m.kind !== MANIFEST_KIND || m.schemaVersion !== 1 || m.hashEncoding !== HASH_ENCODING || m.versionStatus !== 'FINALIZED') refuse('unsupported manifest');
  plain(m.files, 'manifest files');
  for (const [file, hash] of Object.entries(m.files)) { providerPath(file, `manifest path ${file}`); digest(hash, `manifest hash for ${file}`); }
  if (Object.keys(m.files).length !== m.fileCount) refuse('manifest file count differs');
  return m;
}

/**
 * Compares local gzip SHA-256 with a normalized provider manifest. Throws when the
 * evidence is incomplete or ambiguous. Returns `bound`, `mismatch` or
 * `unreproducible`. A `bound` result is content-to-manifest consistency only: it
 * does not establish which version is released or served, and grants nothing.
 */
function bindProviderManifest(input) {
  record(input, ['manifest', 'uploaded', 'local', 'deployProfile'], 'binding input');
  const manifest = validateManifest(input.manifest);
  const uploaded = list(input.uploaded, 'uploaded').map((file, i) => `/${relativePath(file, `uploaded[${i}]`)}`);
  if (new Set(uploaded).size !== uploaded.length) refuse('duplicate uploaded path');
  const local = record(input.local, ['profile', 'files'], 'local');
  validateProfile(local.profile, 'local profile');
  const deploy = input.deployProfile === null ? null : validateProfile(input.deployProfile, 'deploy profile');
  plain(local.files, 'local files');
  for (const [file, entry] of Object.entries(local.files)) {
    providerPath(file, `local path ${file}`);
    record(entry, ['sha256', 'gzipSha256'], `local entry ${file}`);
    digest(entry.sha256, `local sha256 for ${file}`); digest(entry.gzipSha256, `local gzip hash for ${file}`);
  }
  const exact = (actual, description) => {
    const missing = uploaded.filter(p => !actual.includes(p)).sort();
    const extra = actual.filter(p => !uploaded.includes(p)).sort();
    if (missing.length) refuse(`${description} missing: ${missing.join(', ')}`);
    if (extra.length) refuse(`${description} unexpected: ${extra.join(', ')}`);
  };
  exact(Object.keys(manifest.files), 'provider manifest');
  exact(Object.keys(local.files), 'local gzip evidence');

  const reason = profileIncompatibility(local.profile, deploy);
  const mismatched = reason ? [] : uploaded.filter(p => local.files[p].gzipSha256 !== manifest.files[p]).sort();
  const binding = reason ? 'unreproducible' : mismatched.length ? 'mismatch' : 'bound';
  return deepFreeze({
    scope: 'content-to-provider-manifest', binding, reason,
    versionName: manifest.versionName, comparedFiles: reason ? 0 : uploaded.length, mismatchedPaths: mismatched,
    localProfile: { node: local.profile.node, zlib: local.profile.zlib, header: { ...local.profile.header }, parameters: { ...local.profile.parameters } },
    deployProfile: deploy && { node: deploy.node, zlib: deploy.zlib, header: { ...deploy.header }, parameters: { ...deploy.parameters } },
    servingEstablished: false
  });
}

module.exports = {
  normalizeProviderManifest, bindProviderManifest, compressionProfile, localGzipManifest, gzipSha256, validateProfile,
  CALIBRATION_VECTORS, GZIP_PARAMETERS, BINDINGS, HASH_ENCODING, PROVIDER_SOURCE, MANIFEST_KIND, PROFILE_KIND
};
