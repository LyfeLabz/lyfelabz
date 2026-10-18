'use strict';

// D13 Part D: pure, offline validator for a supplied pre/post Hosting deployment
// receipt pair. Non-operational. Nothing in a release, deployment or activation path
// requires this module. It performs no I/O: no network, filesystem, environment,
// clock (`now` is an input), subprocess or credential access. It never reads or
// deletes the Firebase Hosting hash cache and never invokes Firebase CLI or Node.
//
// A receipt is operator-supplied provenance (owner decision 2). A consistent pair
// says only that the same recorded compression profile, CLI and Node identity were
// reported immediately before and after one deployment invocation of one source and
// candidate. It is not cryptographic proof that the recorded profile performed the
// deploy, and `deploymentProvenanceEstablished` is always false.
//
// Controlled deployment policy (owner decision 3): the Firebase Hosting hash cache
// (`.firebase/hosting.<base64(public dir)>.cache`, keyed by path and mtime only) must
// be absent before deployment. A pre receipt reporting a present cache leaves the
// pair consistent but the policy `violated`.
//
// Receipt (every field required; no optional keys):
//   { kind: 'lyfelabz.hostingDeployReceipt', schemaVersion: 1, phase: 'pre' | 'post',
//     invocationId, recordedAt, source: { sha, dirty }, hostingCandidateFingerprint,
//     project, sites: { app, marketing },
//     firebaseCli: { version, executable }, node: { executable },
//     compressionProfile: <D13 Part C compressionProfile() record: Node and zlib
//                          versions, gzip parameters, header (mtime, xfl, os) and
//                          calibration digests>,
//     hashCache: { present: boolean, digest: null | sha256 },
//     provenance: { kind: 'synthetic-fixture' | 'offline-record', tool, supplier: 'operator' } }
const { canonical, PROJECT_NUMBERS } = require('./backend-state.cjs');
const { validateProfile } = require('./provider-manifest.cjs');

const RECEIPT_KIND = 'lyfelabz.hostingDeployReceipt';
const PROVENANCE_KINDS = Object.freeze(['synthetic-fixture', 'offline-record']);
const SCOPE = 'deploy-receipt-consistency';
const LIMITATIONS = Object.freeze([
  'a receipt is operator-supplied provenance, not cryptographic proof that the recorded profile performed the deploy',
  'version strings are recorded; compression compatibility is decided only by byte-level calibration in D13 Part C',
  'the hash-cache state is as reported by the operator; this validator never reads the cache',
  'not provider-backed certification, deployment approval, activation or availability'
]);

const DIGEST = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const SITE_ID = /^[a-z0-9-]+$/;
const INVOCATION = /^[A-Za-z0-9_-]{8,128}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const RECEIPT_KEYS = ['kind', 'schemaVersion', 'phase', 'invocationId', 'recordedAt', 'source', 'hostingCandidateFingerprint',
  'project', 'sites', 'firebaseCli', 'node', 'compressionProfile', 'hashCache', 'provenance'];

function refuse(message) { throw new Error(`[deploy-receipt] REFUSED: ${message}`); }
function record(value, keys, description) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) refuse(`${description} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length) refuse(`${description} has symbol keys`);
  const own = Object.getOwnPropertyNames(value);
  for (const key of own) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d.enumerable || !('value' in d)) refuse(`${description}.${key} must be an enumerable data field`);
    if (!keys.includes(key)) refuse(`unknown ${description} field: ${key}`);
  }
  for (const key of keys) if (!own.includes(key) || value[key] === undefined) refuse(`missing ${description} field: ${key}`);
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
function absolutePath(value, description) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0')) refuse(`malformed ${description}`);
  return value;
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) deepFreeze(v); Object.freeze(value); }
  return value;
}

function validateReceipt(r, phase) {
  const d = `${phase} receipt`;
  record(r, RECEIPT_KEYS, d);
  if (r.kind !== RECEIPT_KIND || r.schemaVersion !== 1) refuse(`unsupported ${d}`);
  if (r.phase !== phase) refuse(`${d} phase is ${String(r.phase)}`);
  pattern(r.invocationId, INVOCATION, `${d} invocation id`);
  const at = time(r.recordedAt, d);
  record(r.source, ['sha', 'dirty'], `${d}.source`);
  pattern(r.source.sha, GIT_SHA, `${d} source sha`);
  if (typeof r.source.dirty !== 'boolean') refuse(`malformed ${d} source dirty flag`);
  pattern(r.hostingCandidateFingerprint, DIGEST, `${d} Hosting candidate fingerprint`);
  if (typeof r.project !== 'string' || !Object.hasOwn(PROJECT_NUMBERS, r.project)) refuse(`unsupported ${d} project`);
  record(r.sites, ['app', 'marketing'], `${d}.sites`);
  pattern(r.sites.app, SITE_ID, `${d} app site`); pattern(r.sites.marketing, SITE_ID, `${d} marketing site`);
  record(r.firebaseCli, ['version', 'executable'], `${d}.firebaseCli`);
  pattern(r.firebaseCli.version, /^\d+\.\d+\.\d+$/, `${d} Firebase CLI version`);
  absolutePath(r.firebaseCli.executable, `${d} Firebase CLI executable`);
  record(r.node, ['executable'], `${d}.node`);
  absolutePath(r.node.executable, `${d} Node executable`);
  validateProfile(r.compressionProfile, `${d} compression profile`);
  record(r.hashCache, ['present', 'digest'], `${d}.hashCache`);
  if (typeof r.hashCache.present !== 'boolean') refuse(`malformed ${d} hash-cache presence`);
  if (r.hashCache.present ? !(typeof r.hashCache.digest === 'string' && DIGEST.test(r.hashCache.digest)) : r.hashCache.digest !== null)
    refuse(`${d} hash-cache digest must be a SHA-256 when present and null when absent`);
  record(r.provenance, ['kind', 'tool', 'supplier'], `${d}.provenance`);
  if (!PROVENANCE_KINDS.includes(r.provenance.kind)) refuse(`unsupported ${d} provenance kind`);
  text(r.provenance.tool, `${d} provenance tool`);
  if (r.provenance.supplier !== 'operator') refuse(`unsupported ${d} provenance supplier`);
  return at;
}

/**
 * Validates a supplied { pre, post } receipt pair against the expected release
 * identity ({ project, sites: { app, marketing }, sourceSha, hostingCandidateFingerprint }).
 * Throws on any inconsistency. Returns a frozen, non-authorizing result.
 */
function validateDeployReceiptPair({ pre, post, expected, now, ...extra } = {}) {
  if (Object.keys(extra).length) refuse(`unknown input field: ${Object.keys(extra)[0]}`);
  record(expected, ['project', 'sites', 'sourceSha', 'hostingCandidateFingerprint'], 'expected');
  record(expected.sites, ['app', 'marketing'], 'expected.sites');
  const current = time(now, 'now');
  const preAt = validateReceipt(pre, 'pre');
  const postAt = validateReceipt(post, 'post');
  if (preAt > postAt) refuse('pre receipt is recorded after the post receipt');
  if (postAt > current) refuse('future receipt timestamp');

  if (pre.invocationId !== post.invocationId) refuse('receipts name different deployment invocations');
  if (canonical(pre.source) !== canonical(post.source)) refuse('receipt source differs between pre and post');
  if (pre.source.sha !== expected.sourceSha) refuse('receipt source sha is not the expected release source');
  if (pre.source.dirty !== false) refuse('receipt requires a clean source');
  for (const r of [pre, post]) {
    if (r.hostingCandidateFingerprint !== expected.hostingCandidateFingerprint) refuse(`${r.phase} receipt names another Hosting candidate`);
    if (r.project !== expected.project) refuse(`${r.phase} receipt names another project`);
    if (canonical(r.sites) !== canonical(expected.sites)) refuse(`${r.phase} receipt names other sites`);
  }
  if (canonical(pre.firebaseCli) !== canonical(post.firebaseCli)) refuse('Firebase CLI identity differs between pre and post');
  if (canonical(pre.node) !== canonical(post.node)) refuse('Node executable differs between pre and post');
  if (canonical(pre.compressionProfile) !== canonical(post.compressionProfile)) refuse('compression profile differs between pre and post');
  if (pre.provenance.kind !== post.provenance.kind) refuse('receipt provenance differs between pre and post');

  return deepFreeze({
    scope: SCOPE,
    invocationId: pre.invocationId,
    sourceSha: pre.source.sha,
    hostingCandidateFingerprint: pre.hostingCandidateFingerprint,
    project: pre.project,
    sites: { ...pre.sites },
    preRecordedAt: pre.recordedAt,
    postRecordedAt: post.recordedAt,
    firebaseCli: { ...pre.firebaseCli },
    node: { executable: pre.node.executable, version: pre.compressionProfile.node, zlib: pre.compressionProfile.zlib },
    compressionProfile: JSON.parse(JSON.stringify(pre.compressionProfile)),
    receiptConsistent: true,
    hashCachePolicy: pre.hashCache.present ? 'violated' : 'satisfied',
    provenance: pre.provenance.kind,
    supplier: 'operator',
    deploymentProvenanceEstablished: false,
    limitations: LIMITATIONS,
    deployable: false, certified: false, authorized: false, available: false
  });
}

module.exports = { validateDeployReceiptPair, RECEIPT_KIND, SCOPE };
