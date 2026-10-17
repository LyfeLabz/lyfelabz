'use strict';

// SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED (A3-6 S6d). Test-only.
// Builds staging dispositions over the S6b synthetic evidence set, signed by
// ephemeral in-process Ed25519 test keys that are pinned nowhere. Revoked-release
// variants rename revisions and fingerprints so a synthetic S6c capture can be
// compared with them. Nothing here is release, revocation or provider evidence.
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const E = require('../evidence-package.cjs');
const F = require('./synthetic-package.cjs');

const LIB = path.resolve(__dirname, '../../../platform/functions/lib/teacherUnits');
const K = require(path.join(LIB, 'a3-canonical.js'));
const R = require(path.join(LIB, 'a3-authority-registry.js'));

const SYNTHETIC = 'synthetic, not provider-verified';
const STAGING = F.STAGING;
const ACTIONS = Object.freeze({ ...F.ACTIONS, dispose: 'dispose-approval' });
// The synthetic statements are issued at 11:00Z; plans are prepared at 11:30Z and the
// default synthetic S6c capture starts at 12:10Z.
const PREPARED = '2026-10-16T11:30:00.000Z';

function testKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { privateKey, publicKeyBase64: raw.toString('base64'), keyId: R.ed25519KeyId(raw) };
}
const keys = () => ({ ...F.testKeys(), dispose: testKey() });
const registryEntries = (project, k) => F.registryEntries(project, k, { actions: ACTIONS });

function disposition({ action, target, replacement = null, key, project = STAGING, issuedAt = F.ISSUED }) {
  return F.signed('approval-disposition', { action, targetApprovalRef: target, replacementApprovalRef: replacement }, key, project, issuedAt);
}

/** A copy of `release` whose revisions (and optionally fingerprints) are renamed. */
function releaseVariant(release, { suffix = 'old', fingerprints = true } = {}) {
  const document = JSON.parse(JSON.stringify(release.document));
  for (const e of document.manifest.endpoints) {
    e.revisionResource = `${e.serviceResource}/revisions/${e.endpointName.toLowerCase()}-${suffix}`;
    e.traffic = [{ revisionResource: e.revisionResource, percent: 100, tag: null }];
  }
  if (fingerprints) {
    document.manifest.runtimePayloadFingerprint = 'd'.repeat(64);
    document.manifest.functionsArtifactFingerprint = 'e'.repeat(64);
  }
  return { document, ref: `teacherUnitsBackendReleases/${K.contentDigest(document.manifest)}` };
}

/** A release variant and a synthetic certification that signs its backendReleaseId, so
 * the variant's revisions and fingerprints are content-bound to signed (test) evidence. */
function certifiedVariant(setup, options) {
  const variant = releaseVariant(setup.release, options);
  const chain = F.chainFor(setup.ev, K.contentDigest(variant.document.manifest));
  return { release: variant, target: { ref: chain.refs.certification, document: chain.inputs.certification.document } };
}

/** Staging evidence, its release, a second deployment approval and the dispose key. */
async function buildRevocation({ project = STAGING, issuedAt } = {}) {
  const k = keys();
  const ev = await F.buildEvidence({ project, keys: k, issuedAt });
  const release = E.assembleRelease(ev.base);
  const chain = F.chainFor(ev, release.releaseId);
  const candidate = { ...ev.deployment.document.payload.statement.candidate, sourceSha: '3'.repeat(40) };
  const replacement = F.signed('deployment-approval', { candidate }, k.deploy, project, issuedAt);
  const authority = { registryEntries: registryEntries(project, k), revocationEntries: [] };
  return { ev, release, chain, replacement, keys: k, authority, project };
}

module.exports = { SYNTHETIC, STAGING, ACTIONS, PREPARED, keys, registryEntries, disposition, releaseVariant, certifiedVariant, buildRevocation };
