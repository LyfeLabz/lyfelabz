'use strict';
// A3-6 S6b evidence assembly tests. Offline: no emulator, no provider, no credentials.
// SYNTHETIC fixtures only; passing proves code behavior, never release readiness.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const E = require('./evidence-package.cjs');
const AR = require('./access-review.cjs');
const F = require('./fixtures/synthetic-package.cjs');
const { planFor } = require('./fixtures/synthetic-provider.cjs');
const { expectedFor, RECEIPT_LOCATION } = require('./fixtures/synthetic-access.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const V = require('../../platform/functions/lib/teacherUnits/a3-validation.js');

const STAGING = F.STAGING, PROD = 'lyfelabz-prod';
const ASSEMBLED = '2026-10-16T12:30:00.000Z';
const clone = v => JSON.parse(JSON.stringify(v));
const statusOf = (pkg, name) => pkg.checks.find(c => c.check === name);

async function setup({ project = STAGING, keys = F.testKeys(), revoke = [], registry, provenance, issuedAt, chainEdit, access, report } = {}) {
  const ev = await F.buildEvidence({ project, keys, provenance, issuedAt, access });
  const release = E.assembleRelease(ev.base);
  const chain = F.chainFor(ev, release.releaseId, { edit: chainEdit, report });
  const authority = project === PROD || keys === null ? undefined
    : { registryEntries: registry ? registry(ev) : F.registryEntries(project, keys), revocationEntries: F.revocationEntries(project, revoke.map(r => r(ev, release, chain))) };
  const inputs = { ...ev.base, ...chain.inputs, ...(authority ? { authority } : {}) };
  return { ev, release, chain, authority, inputs };
}
const assemble = (inputs, assembledAt = ASSEMBLED) => E.assembleEvidencePackage({ ...inputs, assembledAt });
function refuses(fn, pattern) {
  assert.throws(fn, error => { assert.match(error.message, /REFUSED/); assert.match(error.message, pattern); return true; });
}
const reseal = pkg => Buffer.from(K.canonicalJSON(pkg), 'utf8');
const codeOnly = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('fixtures are labelled synthetic, never provider-verified', () => {
  assert.equal(F.SYNTHETIC, 'synthetic, not provider-verified');
  assert.match(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-package.cjs'), 'utf8'), /SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED/);
});

test('static: the S6b module makes no request, holds no key, signs nothing, writes nothing and loads no fixture', () => {
  const code = codeOnly('evidence-package.cjs');
  for (const pattern of [/firebaserc/i, /generateKeyPair|createPrivateKey|\bsign\(|privateKey/, /kms|KeyManagement/i,
    /\bfetch\(|https?:\/\/|readApi|tokenFromGcloud|gcloud|node:https?\b|observeA3Backend|reviewA3Access/, /fixtures\//,
    /require\('node:fs'\)|writeFile|getFirestore|\.firestore\(|firebase-admin|@google-cloud/, /Date\.now\(|new Date\(\)/]) {
    assert.equal(pattern.test(code), false, `evidence-package.cjs matches ${pattern}`);
  }
});

test('network-free: assembly and verification make no request', async () => {
  const s = await setup();
  const calls = [], saved = { fetch: globalThis.fetch, http: http.request, https: https.request, hget: http.get, sget: https.get };
  const trap = name => () => { calls.push(name); throw new Error('network attempted'); };
  globalThis.fetch = trap('fetch'); http.request = trap('http'); https.request = trap('https'); http.get = trap('http.get'); https.get = trap('https.get');
  try { E.verifyEvidencePackage(assemble(s.inputs).bytes, s.inputs); }
  finally { globalThis.fetch = saved.fetch; http.request = saved.http; https.request = saved.https; http.get = saved.hget; https.get = saved.sget; }
  assert.deepEqual(calls, []);
});

test('release assembly derives a valid A3-1 release from the evidence only', async () => {
  const { ev, release } = await setup();
  const m = release.document.manifest;
  assert.equal(V.validateBackendRelease(release.document, F.identity(STAGING)).ok, true);
  assert.equal(release.releaseId, K.contentDigest(m));
  assert.equal(release.ref, `teacherUnitsBackendReleases/${release.releaseId}`);
  assert.equal(m.deploymentApprovalEvidenceRef, ev.deployment.ref);
  assert.equal(m.sourceSha, '1'.repeat(40));
  assert.equal(m.rules.sourceHash, ev.a.observation.rules.sourceHash);
  assert.deepEqual(m.endpoints.map(e => e.endpointName), V.ENDPOINTS);
  for (const e of m.endpoints) assert.equal(e.invocation.accessReviewReceipt.sha256, ev.base.receipt.object.sha256);
  assert.equal(release.evaluatedAt, JSON.parse(ev.base.receipt.bytes).observedAt, 'evaluatedAt defaults to the S5 review end');
  assert.match(release.authorization, /^none:/);
  assert.equal(release.bytes.toString('utf8'), K.canonicalJSON(release.document));
  assert.equal(E.assembleRelease(ev.base).bytes.equals(release.bytes), true, 'deterministic');
});

test('a complete synthetic package is non-authorizing and verifies only by re-derivation', async () => {
  const s = await setup();
  const a = assemble(s.inputs), p = a.package;
  assert.equal(p.kind, 'lyfelabz.teacherUnitsA3EvidencePackage');
  assert.equal(p.authorization, 'none: candidate evidence package; not an approval, certification, registration or activation');
  assert.equal(p.providerVerified, false); assert.equal(p.releaseAuthorized, false); assert.equal(p.activationReady, false);
  assert.equal(p.accessReviewLevel, 'A-structural');
  assert.equal(p.evidenceClass, 'synthetic');
  assert.equal(p.authority.source, E.AUTHORITY_SOURCES.synthetic);
  assert.deepEqual(p.unresolved, E.UNRESOLVED);
  // Synthetic authority is never recorded as passed.
  for (const c of p.checks.filter(c => /\.(signature|revocation)$/.test(c.check))) assert.equal(c.status, 'synthetic-passed', c.check);
  assert.equal(statusOf(p, 'buildRecord.deployed').status, 'not-observed');
  assert.equal(statusOf(p, 'hostingCandidate').status, 'deferred');
  assert.equal(statusOf(p, 'activationBinding').status, 'deferred');
  assert.equal(statusOf(p, 'accessReview.levelB').status, 'not-observed');
  assert.equal(statusOf(p, 'certification.report').status, 'passed');
  assert.equal(statusOf(p, 'observation.freshness.historical').status, 'passed');
  assert.equal(statusOf(p, 'observation.freshness.current').status, 'failed', 'thirty minutes later the observation is not current');
  assert.deepEqual(p.components.map(c => c.role), ['deploymentPlan', 'expectedAccess', 'providerObservation', 'accessReviewReceipt', 'deploymentApproval',
    'backendRelease', 'releaseCertification', 'certificationReport', 'activationApproval', 'activationEvidence']);
  assert.equal(E.verifyEvidencePackage(a.bytes, s.inputs).verified, true);
  assert.equal(assemble(s.inputs).bytes.equals(a.bytes), true, 'deterministic');
});

test('current freshness passes only inside the window, and never makes a package activation-ready', async () => {
  const s = await setup();
  const evaluatedAt = JSON.parse(s.inputs.receipt.bytes).observedAt;
  const p = assemble(s.inputs, evaluatedAt).package;
  assert.equal(statusOf(p, 'observation.freshness.current').status, 'passed');
  assert.match(statusOf(p, 'observation.freshness.current').detail, /enable still requires a fresh S6c observation/);
  assert.equal(p.activationReady, false);
});

test('staging without pinned authority records every authority check as unverifiable', async () => {
  const s = await setup();
  const { authority, ...inputs } = s.inputs;
  const p = assemble(inputs).package;
  assert.equal(p.authority.source, E.AUTHORITY_SOURCES.none);
  for (const c of p.checks.filter(c => /\.(signature|revocation)$/.test(c.check))) assert.equal(c.status, 'unverifiable', c.check);
});

test('production uses only the pinned empty registry: signers are unrecognized, never passed; caller authority refuses', async () => {
  const s = await setup({ project: PROD });
  const p = assemble(s.inputs).package;
  assert.equal(p.authority.source, E.AUTHORITY_SOURCES.pinned);
  for (const name of ['deploymentApproval', 'certification', 'activationApproval']) {
    assert.equal(statusOf(p, `${name}.signature`).status, 'failed');
    assert.match(statusOf(p, `${name}.signature`).detail, /authorityUnrecognized/);
  }
  assert.equal(statusOf(p, 'deploymentApproval.revocation').status, 'passed', 'the pinned production list is genuinely consulted');
  refuses(() => assemble({ ...s.inputs, authority: { registryEntries: F.registryEntries(PROD, s.ev.keys), revocationEntries: [] } }), /production uses only the artifact-pinned registry/);
});

test('a declared provider-get provenance is not proof: never provider-verified, and synthetic authority refuses', async () => {
  const s = await setup({ provenance: 'provider-get' });
  refuses(() => assemble(s.inputs), /synthetic test authority is accepted only for synthetic evidence/);
  const { authority, ...inputs } = s.inputs;
  const p = assemble(inputs).package;
  assert.equal(p.evidenceClass, 'operator-supplied-unverified');
  assert.equal(p.providerVerified, false);
  assert.equal(p.declaredProvenance.value, 'provider-get');
  assert.match(p.declaredProvenance.note, /not proof of provider origin/);
});

test('revoked, unknown and wrong-action authority are recorded as failed', async () => {
  const revoked = await setup({ revoke: [ev => ev.deployment.ref, (_e, _r, c) => c.refs.certification] });
  let p = assemble(revoked.inputs).package;
  assert.equal(statusOf(p, 'deploymentApproval.revocation').status, 'failed');
  assert.match(statusOf(p, 'deploymentApproval.revocation').detail, /^revoked/);
  assert.equal(statusOf(p, 'certification.revocation').status, 'failed');
  assert.equal(statusOf(p, 'activationApproval.revocation').status, 'synthetic-passed');

  const unknown = await setup({ registry: () => F.registryEntries(STAGING, F.testKeys()) });
  p = assemble(unknown.inputs).package;
  for (const name of ['deploymentApproval', 'certification', 'activationApproval']) assert.match(statusOf(p, `${name}.signature`).detail, /^authorityUnrecognized/);

  const wrongAction = await setup({ registry: ev => F.registryEntries(STAGING, { deploy: ev.keys.certify, certify: ev.keys.deploy, activate: ev.keys.activate }) });
  p = assemble(wrongAction.inputs).package;
  assert.equal(statusOf(p, 'deploymentApproval.signature').status, 'failed');
  assert.equal(statusOf(p, 'certification.signature').status, 'failed');
  assert.equal(statusOf(p, 'activationApproval.signature').status, 'synthetic-passed');

  const unsigned = await setup({ keys: null });
  p = assemble({ ...unsigned.inputs, authority: { registryEntries: F.registryEntries(STAGING, F.testKeys()), revocationEntries: [] } }).package;
  assert.equal(statusOf(p, 'deploymentApproval.signature').status, 'failed');
});

test('old and future approvals: freshness failures are recorded, never passed', async () => {
  const old = await setup({ issuedAt: '2026-10-15T11:00:00.000Z' });
  let p = assemble(old.inputs).package;
  assert.equal(statusOf(p, 'deploymentApproval.freshness.current').status, 'failed');
  assert.match(statusOf(p, 'deploymentApproval.freshness.current').detail, /more than 24 hours/);
  assert.equal(statusOf(p, 'certification.freshness.current').status, 'passed', 'certification has no age limit');
  const future = await setup({ issuedAt: '2026-10-16T13:00:00.000Z' });
  p = assemble(future.inputs).package;
  assert.match(statusOf(p, 'deploymentApproval.freshness.current').detail, /future/);
  assert.equal(statusOf(p, 'certification.freshness.current').status, 'failed');
});

test('stale and future evaluation instants refuse', async () => {
  const s = await setup();
  refuses(() => E.assembleRelease({ ...s.ev.base, evaluatedAt: '2026-10-16T12:06:00.000Z' }), /stale/);
  refuses(() => E.assembleRelease({ ...s.ev.base, evaluatedAt: '2026-10-16T11:59:00.000Z' }), /inconsistent|future/);
  refuses(() => E.assembleRelease({ ...s.ev.base, evaluatedAt: '2026-10-16 12:00' }), /canonical RFC 3339/);
  refuses(() => assemble(s.inputs, '2026-10-16T12:00:00.100Z'), /evaluatedAt is after assembledAt|future/);
  refuses(() => assemble(s.inputs, 'yesterday'), /canonical RFC 3339/);
});

test('cross-project and cross-environment inputs refuse', async () => {
  const s = await setup(), prod = await setup({ project: PROD });
  refuses(() => E.assembleRelease({ ...s.ev.base, project: PROD }), /identity|mismatch/);
  refuses(() => E.assembleRelease({ ...s.ev.base, project: 'demo-a3-s6b' }), /supported project/);
  refuses(() => E.assembleRelease({ ...s.ev.base, project: undefined }), /supported project/);
  refuses(() => E.assembleRelease({ ...s.ev.base, plan: prod.ev.base.plan }), /identity|mismatch/);
  refuses(() => E.assembleRelease({ ...s.ev.base, receipt: prod.ev.base.receipt }), /identity|not bound|mismatch/);
  refuses(() => E.assembleRelease({ ...s.ev.base, observation: prod.ev.base.observation }), /wrong-project|identity/);
  refuses(() => E.assembleRelease({ ...s.ev.base, deploymentApproval: prod.ev.base.deploymentApproval }), /identity|mismatch|invalid/);
  refuses(() => assemble({ ...s.inputs, certification: prod.inputs.certification }), /identity|mismatch|invalid/);
});

test('swapped plan or expected-access bytes refuse', async () => {
  const s = await setup();
  const other = planFor(s.ev.a.observation, { sourceArchive: { policy: 'exact', sha256: s.ev.a.observation.sourceArchiveHashes[0] } });
  refuses(() => E.assembleRelease({ ...s.ev.base, plan: { object: other.object, bytes: other.bytes } }), /does not bind this deployment plan/);
  refuses(() => E.assembleRelease({ ...s.ev.base, plan: { object: s.ev.base.plan.object, bytes: other.bytes } }), /do not match the content object hash/);
  const altered = expectedFor(s.ev.a.observation, { endpoint: e => { e.customAudiences = ['https://synthetic.example']; } });
  refuses(() => E.assembleRelease({ ...s.ev.base, expected: { object: altered.object, bytes: altered.bytes } }), /not bound to this expected-access|audiences|differs/);
  refuses(() => E.assembleRelease({ ...s.ev.base, expected: { object: s.ev.base.expected.object, bytes: altered.bytes } }), /do not match the content object hash/);
  const noncanonical = Buffer.from(JSON.stringify(JSON.parse(s.ev.base.plan.bytes), null, 1));
  refuses(() => E.assembleRelease({ ...s.ev.base, plan: { object: { ...s.ev.base.plan.object, sha256: K.sha256Bytes(noncanonical) }, bytes: noncanonical } }), /canonical|bind/);
});

test('mismatched service accounts refuse', async () => {
  const s = await setup();
  const altered = expectedFor(s.ev.a.observation, { endpoint: e => { if (e.endpointName === 'teacherUnitsGet') e.runtimeServiceAccountEmail = 'other@lyfelabz-staging.iam.gserviceaccount.com'; } });
  refuses(() => E.assembleRelease({ ...s.ev.base, expected: { object: altered.object, bytes: altered.bytes } }), /service account/);
});

test('approval candidate binding: plan object and fingerprints must match', async () => {
  for (const [edit, pattern] of [[c => { c.runtimePayloadFingerprint = 'd'.repeat(64); }, /runtimePayloadFingerprint differs/],
    [c => { c.placementFingerprint = 'd'.repeat(64); }, /placementFingerprint differs/],
    [c => { c.deploymentPlan = { ...c.deploymentPlan, generation: '2' }; }, /does not bind this deployment plan/],
    [c => { c.sourceSha = 'z'; }, /invalid/]]) {
    await assert.rejects(F.buildEvidence({ edit: { deploy: edit } }).then(ev => E.assembleRelease(ev.base)), error => { assert.match(error.message, pattern); return true; });
  }
});

test('eight, extra and reordered endpoints refuse', async () => {
  const s = await setup();
  const obs = clone(s.ev.base.observation);
  const eight = { ...obs, endpoints: obs.endpoints.slice(1) };
  refuses(() => E.assembleRelease({ ...s.ev.base, observation: eight }), /nine/);
  const extra = { ...obs, endpoints: [...obs.endpoints, obs.endpoints[0]] };
  refuses(() => E.assembleRelease({ ...s.ev.base, observation: extra }), /nine/);
  const reordered = { ...obs, endpoints: [obs.endpoints[1], obs.endpoints[0], ...obs.endpoints.slice(2)] };
  refuses(() => E.assembleRelease({ ...s.ev.base, observation: reordered }), /nine/);
});

test('incorrect receipt or observation fingerprint refuses', async () => {
  const s = await setup();
  const obs = clone(s.ev.base.observation); obs.endpoints[0].provider.metadata.buildId = 'tampered';
  refuses(() => E.assembleRelease({ ...s.ev.base, observation: obs }), /not bound to this S4 observation/);
  const receipt = JSON.parse(s.ev.base.receipt.bytes); receipt.s4ObservationFingerprint = 'd'.repeat(64);
  const bytes = reseal(receipt);
  refuses(() => E.assembleRelease({ ...s.ev.base, receipt: { object: AR.receiptContentObject(bytes, RECEIPT_LOCATION), bytes } }), /not bound to this S4 observation/);
  refuses(() => E.assembleRelease({ ...s.ev.base, receipt: { object: s.ev.base.receipt.object, bytes } }), /do not match the content object hash/);
});

test('noncanonical or substituted statement bytes refuse', async () => {
  const s = await setup();
  const d = s.ev.base.deploymentApproval;
  const spaced = Buffer.from(JSON.stringify(JSON.parse(d.statementBytes), null, 1));
  refuses(() => E.assembleRelease({ ...s.ev.base, deploymentApproval: { ...d, statementBytes: spaced } }), /do not match the statement object hash/);
  const doc = clone(d.document); doc.payload.source.statementObject.sha256 = K.sha256Bytes(spaced);
  refuses(() => E.assembleRelease({ ...s.ev.base, deploymentApproval: { document: doc, statementBytes: spaced } }), /statement digest mismatch|not canonical JSON/);
  refuses(() => assemble({ ...s.inputs, certification: { ...s.inputs.certification, statementBytes: s.inputs.activationApproval.statementBytes } }), /statement/);
  refuses(() => E.assembleRelease({ ...s.ev.base, deploymentApproval: { document: d.document } }), /keys must be exactly/);
});

test('altered certification report bytes refuse; absent report bytes are recorded as absent', async () => {
  const s = await setup();
  refuses(() => assemble({ ...s.inputs, certification: { ...s.inputs.certification, reportBytes: Buffer.from('altered') } }), /certificationReport\.sha256/);
  const { reportBytes, ...noReport } = s.inputs.certification;
  const p = assemble({ ...s.inputs, certification: noReport }).package;
  assert.equal(statusOf(p, 'certification.report').status, 'absent');
  assert.equal(p.components.some(c => c.role === 'certificationReport'), false);
});

test('missing and mismatched certification dependencies refuse', async () => {
  const s = await setup();
  const { certification, activationApproval, activationEvidence, ...releaseOnly } = s.inputs;
  const p = assemble(releaseOnly).package;
  assert.equal(statusOf(p, 'certification').status, 'absent');
  assert.equal(statusOf(p, 'activationApproval').status, 'absent');
  refuses(() => assemble({ ...releaseOnly, activationApproval }), /requires a certification/);
  refuses(() => assemble({ ...releaseOnly, certification, activationEvidence }), /requires its activation approval/);
  const wrongRelease = await setup({ chainEdit: { certify: f => { f.backendReleaseId = 'd'.repeat(64); } } });
  refuses(() => assemble(wrongRelease.inputs), /certification does not bind this release/);
  const wrongPlacement = await setup({ chainEdit: { certify: f => { f.placementFingerprint = 'd'.repeat(64); } } });
  refuses(() => assemble(wrongPlacement.inputs), /placement mismatch/);
  const actRelease = await setup({ chainEdit: { activate: f => { f.backendReleaseId = 'd'.repeat(64); } } });
  refuses(() => assemble(actRelease.inputs), /activation approval does not bind this release/);
  const hosting = await setup({ chainEdit: { activate: f => { f.hostingCandidateFingerprint = 'e'.repeat(64); } } });
  refuses(() => assemble(hosting.inputs), /hosting mismatch/);
  const otherCert = await setup({ chainEdit: { activate: f => { f.certificationEvidenceRef = `teacherUnitsReleaseEvidence/${'d'.repeat(64)}`; } } });
  refuses(() => assemble(otherCert.inputs), /does not name this certification/);
  const evidence = clone(activationEvidence); evidence.payload.enabledGeneration = 4;
  refuses(() => assemble({ ...s.inputs, activationEvidence: evidence }), /does not repeat its activation approval|invalid/);
});

test('missing required evidence refuses; nothing is inferred', async () => {
  const s = await setup();
  for (const key of ['plan', 'expected', 'deploymentApproval', 'receipt']) {
    const { [key]: _omit, ...rest } = s.ev.base;
    refuses(() => E.assembleRelease(rest), /must be an object|required/);
  }
  const { observation, ...noObservation } = s.ev.base;
  refuses(() => E.assembleRelease(noObservation), /observations are never inferred/);
  refuses(() => E.assembleEvidencePackage(s.inputs), /assembledAt/);
});

test('unknown inputs, unknown fields and accessor inputs refuse', async () => {
  const s = await setup();
  refuses(() => E.assembleRelease({ ...s.ev.base, extra: true }), /unknown release input extra/);
  refuses(() => assemble({ ...s.inputs, readiness: true }), /unknown package input readiness/);
  refuses(() => E.assembleRelease({ ...s.ev.base, plan: { ...s.ev.base.plan, note: 'x' } }), /keys must be exactly/);
  refuses(() => E.assembleRelease({ ...s.ev.base, observation: { ...s.ev.base.observation, extra: 1 } }), /not bound|unsupported|observation/);
  const doc = clone(s.ev.base.deploymentApproval.document); doc.payload.extra = 1;
  refuses(() => E.assembleRelease({ ...s.ev.base, deploymentApproval: { ...s.ev.base.deploymentApproval, document: doc } }), /invalid/);
  const accessor = { ...s.ev.base.observation };
  Object.defineProperty(accessor, 'projectId', { enumerable: true, get: () => STAGING });
  refuses(() => E.assembleRelease({ ...s.ev.base, observation: accessor }), /plain canonical JSON/);
  refuses(() => assemble({ ...s.inputs, authority: { ...s.inputs.authority, extra: [] } }), /keys must be exactly/);
});

test('forged readiness, classification or checks are refused even when resealed', async () => {
  const s = await setup();
  const original = assemble(s.inputs).package;
  const forge = edit => { const p = clone(original); edit(p); return reseal(p); };
  for (const [edit, pattern] of [
    [p => { p.providerVerified = true; }, /providerVerified must be false/],
    [p => { p.releaseAuthorized = true; }, /releaseAuthorized must be false/],
    [p => { p.activationReady = true; }, /activationReady must be false/],
    [p => { p.accessReviewLevel = 'B-provider-complete'; }, /accessReviewLevel/],
    [p => { p.authorization = 'approved'; }, /authorization must be/],
    [p => { p.unresolved = p.unresolved.slice(1); }, /unresolved gates/],
    [p => { p.ready = true; }, /keys must be exactly/],
    [p => { p.checks[0].status = 'verified'; }, /status verified unsupported/],
    [p => { p.components[0].extra = 1; }, /component key extra unsupported/],
  ]) refuses(() => E.verifyEvidencePackage(forge(edit), s.inputs), pattern);
  // Schema-valid edits are caught by re-derivation, not trusted.
  for (const [edit, field] of [
    [p => { statusOf(p, 'deploymentApproval.signature').status = 'passed'; }, /checks/],
    [p => { statusOf(p, 'buildRecord.deployed').status = 'passed'; }, /checks/],
    [p => { statusOf(p, 'observation.freshness.current').status = 'passed'; }, /checks/],
    [p => { p.evidenceClass = 'operator-supplied-unverified'; }, /evidenceClass/],
    [p => { p.authority.source = E.AUTHORITY_SOURCES.pinned; }, /authority/],
    [p => { p.release.releaseId = 'd'.repeat(64); }, /release/],
    [p => { p.components[0].suppliedSha256 = 'd'.repeat(64); }, /components/],
    [p => { p.checks.pop(); }, /checks/],
  ]) refuses(() => E.verifyEvidencePackage(forge(edit), s.inputs), field);
  refuses(() => E.verifyEvidencePackage(Buffer.from(JSON.stringify(original, null, 1)), s.inputs), /not canonical JSON/);
});

test('verification re-derives from the evidence: different evidence or authority refuses', async () => {
  const s = await setup();
  const bytes = assemble(s.inputs).bytes;
  refuses(() => E.verifyEvidencePackage(bytes, { ...s.inputs, assembledAt: ASSEMBLED }), /uses the package instants/);
  refuses(() => E.verifyEvidencePackage(bytes, { ...s.inputs, evaluatedAt: ASSEMBLED }), /uses the package instants/);
  const { authority, ...noAuthority } = s.inputs;
  refuses(() => E.verifyEvidencePackage(bytes, noAuthority), /authority, checks/);
  refuses(() => E.verifyEvidencePackage(bytes, { ...s.inputs, authority: { ...authority, revocationEntries: F.revocationEntries(STAGING, [s.ev.deployment.ref]) } }), /authority, checks/);
  const { reportBytes, ...noReport } = s.inputs.certification;
  refuses(() => E.verifyEvidencePackage(bytes, { ...s.inputs, certification: noReport }), /components, checks/);
  refuses(() => E.verifyEvidencePackage(bytes, { ...s.inputs, project: PROD }), /identity differs/);
  const prod = await setup({ project: PROD });
  refuses(() => E.verifyEvidencePackage(assemble(prod.inputs).bytes, s.inputs), /identity differs/);
});

test('a certification supplied alone must still bind this release and placement', async () => {
  const strip = s => { const { activationApproval, activationEvidence, ...rest } = s.inputs; return rest; };
  const ok = await setup();
  assert.equal(statusOf(assemble(strip(ok)).package, 'certification.release').status, 'passed');
  const wrongRelease = await setup({ chainEdit: { certify: f => { f.backendReleaseId = 'd'.repeat(64); } } });
  assert.throws(() => assemble(strip(wrongRelease)), /REFUSED: certification does not bind this release/);
  const wrongPlacement = await setup({ chainEdit: { certify: f => { f.placementFingerprint = 'd'.repeat(64); } } });
  assert.throws(() => assemble(strip(wrongPlacement)), /REFUSED: certification placement mismatch/);
});
