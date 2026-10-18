'use strict';

// D13 Part A: pure, offline Hosting candidate identity contract. Non-operational.
// Nothing in a release, deployment or activation path requires this module. It
// performs no I/O, reads no environment and has no activation switch.
//
// A valid fingerprint is only an identity. It is not deployment approval, signed
// certification, activation or availability, and it does not prove which bytes
// Hosting actually serves.
//
// Identity: the A1 digest (backend-state `fingerprint`: recursively sorted object
// keys, JSON.stringify, UTF-8, SHA-256 lowercase hex, no domain prefix) of the
// complete Hosting-only candidate. Strict validation runs first so that only plain
// objects, strings and booleans of the exact field set reach the digest.
const { fingerprint } = require('./backend-state.cjs');

const CANDIDATE_KEYS = Object.freeze(['applicationBuildFingerprint', 'availabilityEvidence', 'hostingArtifactFingerprint',
  'placementFingerprint', 'releaseIntent', 'source', 'teacherUnitsAvailability']);
const SOURCE_KEYS = Object.freeze(['dirty', 'sha']);
const FUNCTIONS_KEYS = Object.freeze(['placementFingerprint', 'sourceSha']);
const RELEASE_INTENTS = Object.freeze(['general', 'teacher-units']);
const AVAILABILITY = Object.freeze(['closed', 'enabled']);
const DIGEST = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

function refuse(message) { throw new Error(`[hosting-identity] REFUSED: ${message}`); }
function plainRecord(value, keys, description) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) refuse(`${description} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length) refuse(`${description} has symbol keys`);
  const own = Object.getOwnPropertyNames(value);
  for (const key of own) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d.enumerable || !('value' in d)) refuse(`${description}.${key} must be an enumerable data field`);
    if (!keys.includes(key)) refuse(`unknown ${description} field: ${key}`);
  }
  // Missing and null are both refused; there are no optional fields.
  for (const key of keys) if (!own.includes(key) || value[key] === null || value[key] === undefined) refuse(`missing ${description} field: ${key}`);
}
function pattern(value, re, description) {
  if (typeof value !== 'string' || !re.test(value)) refuse(`malformed ${description}`);
}
function oneOf(value, allowed, description) {
  if (typeof value !== 'string' || !allowed.includes(value)) refuse(`unsupported ${description}`);
}

/** A: structural validation of the canonical Hosting-only candidate. Returns a
 * fresh copy containing exactly the A1 field set. */
function validateHostingCandidate(candidate) {
  plainRecord(candidate, CANDIDATE_KEYS, 'candidate');
  oneOf(candidate.releaseIntent, RELEASE_INTENTS, 'release intent');
  plainRecord(candidate.source, SOURCE_KEYS, 'candidate.source');
  pattern(candidate.source.sha, GIT_SHA, 'source sha');
  if (typeof candidate.source.dirty !== 'boolean') refuse('malformed source dirty flag');
  pattern(candidate.hostingArtifactFingerprint, DIGEST, 'Hosting artifact fingerprint');
  pattern(candidate.placementFingerprint, DIGEST, 'placement fingerprint');
  pattern(candidate.applicationBuildFingerprint, DIGEST, 'application build fingerprint');
  oneOf(candidate.teacherUnitsAvailability, AVAILABILITY, 'Teacher Units availability');
  if (candidate.availabilityEvidence !== 'build-contract-assertion') refuse('unsupported availability evidence');
  return {
    releaseIntent: candidate.releaseIntent,
    source: { sha: candidate.source.sha, dirty: candidate.source.dirty },
    hostingArtifactFingerprint: candidate.hostingArtifactFingerprint,
    placementFingerprint: candidate.placementFingerprint,
    applicationBuildFingerprint: candidate.applicationBuildFingerprint,
    teacherUnitsAvailability: candidate.teacherUnitsAvailability,
    availabilityEvidence: candidate.availabilityEvidence
  };
}

/** B: deterministic Hosting candidate fingerprint over every candidate field. */
function hostingCandidateFingerprint(candidate) {
  return fingerprint(validateHostingCandidate(candidate));
}

/** C: structural validation of an enabled Hosting candidate against its Functions
 * release identity ({ sourceSha, placementFingerprint }, as in the deployment
 * approval candidate). Structural only: the result grants nothing. */
function validateEnabledActivationCandidate(candidate, functionsIdentity) {
  const c = validateHostingCandidate(candidate);
  plainRecord(functionsIdentity, FUNCTIONS_KEYS, 'Functions identity');
  pattern(functionsIdentity.sourceSha, GIT_SHA, 'Functions source sha');
  pattern(functionsIdentity.placementFingerprint, DIGEST, 'Functions placement fingerprint');
  if (c.teacherUnitsAvailability !== 'enabled') refuse('enabled activation requires an enabled Hosting candidate');
  if (c.releaseIntent !== 'teacher-units') refuse('enabled activation requires teacher-units release intent');
  if (c.source.dirty !== false) refuse('enabled activation requires a clean source');
  if (c.source.sha !== functionsIdentity.sourceSha) refuse('Hosting and Functions source sha differ');
  if (c.placementFingerprint !== functionsIdentity.placementFingerprint) refuse('Hosting and Functions placement differ');
  return Object.freeze({ hostingCandidateFingerprint: fingerprint(c), scope: 'structural-only',
    deployable: false, certified: false, authorized: false, available: false });
}

module.exports = { validateHostingCandidate, hostingCandidateFingerprint, validateEnabledActivationCandidate };
