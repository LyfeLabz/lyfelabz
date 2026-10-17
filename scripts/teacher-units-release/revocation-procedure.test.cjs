'use strict';
// A3-6 S6d revocation preparation and rollout comparison tests. Offline: no emulator,
// no provider, no credentials. SYNTHETIC fixtures only; passing proves code behavior,
// never that anything was revoked, pinned or deployed.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const RP = require('./revocation-procedure.cjs');
const PC = require('./provider-capture.cjs');
const X = require('./fixtures/synthetic-revocation.cjs');
const F = require('./fixtures/synthetic-package.cjs');
const { buildCapture } = require('./fixtures/synthetic-capture.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const L = require('../../platform/functions/lib/teacherUnits/a3-revocation-list.js');
const R = require('../../platform/functions/lib/teacherUnits/a3-authority-registry.js');

const STAGING = X.STAGING, PROD = 'lyfelabz-prod';
const LATER = '2026-10-16T12:00:00.000Z';
const clone = v => JSON.parse(JSON.stringify(v));
const reseal = (bytes, edit) => { const v = JSON.parse(bytes.toString('utf8')); edit(v); return Buffer.from(K.canonicalJSON(v), 'utf8'); };
const signedInput = d => ({ document: d.document, statementBytes: d.statementBytes });
const statusOf = (plan, name) => plan.checks.find(c => c.check === name).status;

let shared;
async function setup() {
  if (!shared) shared = await X.buildRevocation();
  return shared;
}
/** Inputs for a disposition over the deployment approval (default) or another target. */
async function inputsFor({ action = 'revoke', target, replacement, key, issuedAt, known = [], releases, authority, project = STAGING } = {}) {
  const s = await setup();
  const t = target || s.ev.deployment;
  const r = action === 'supersede' ? (replacement === undefined ? s.replacement : replacement) : null;
  const d = X.disposition({ action, target: t.ref, replacement: r ? r.ref : null, key: key === undefined ? s.keys.dispose : key, issuedAt });
  const inputs = { project, disposition: signedInput(d), target: t.document, knownDispositions: known,
    revokedReleases: releases || [s.release.document], authority: authority === undefined ? s.authority : authority };
  if (r) inputs.replacement = r.document;
  return { s, d, inputs };
}
const prepare = inputs => RP.prepareRevocationPlan({ ...inputs, preparedAt: X.PREPARED });
const refuses = (fn, pattern) => assert.throws(fn, e => /REFUSED/.test(e.message) && pattern.test(e.message), `expected ${pattern}`);
const rejects = (p, pattern) => assert.rejects(p, e => /REFUSED/.test(e.message) && pattern.test(e.message), `expected ${pattern}`);

test('fixtures are labelled synthetic, never provider-verified', () => {
  assert.equal(X.SYNTHETIC, 'synthetic, not provider-verified');
  assert.match(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-revocation.cjs'), 'utf8'), /SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED/);
  assert.deepEqual(L.PRODUCTION_REVOCATION_LIST.entries, []);
  assert.deepEqual(R.PRODUCTION_AUTHORITY_REGISTRY.entries, []);
});

test('revoke: a synthetic draft that proposes the pin and claims no effect', async () => {
  const { s, d, inputs } = await inputsFor();
  const { plan, bytes, sha256 } = prepare(inputs);
  assert.equal(sha256, K.sha256Bytes(bytes));
  for (const key of ['revocationEffective', 'releaseAuthorized', 'activationReady']) assert.equal(plan[key], false);
  assert.match(plan.authorization, /^none: /);
  assert.equal(plan.planClass, RP.PLAN_CLASSES.synthetic);
  assert.equal(plan.disposition.ref, d.ref);
  assert.equal(plan.disposition.effect, RP.EFFECT.revoke);
  assert.equal(plan.replacement, null);
  assert.equal(plan.proposed.pin, s.ev.deployment.ref);
  assert.equal(plan.proposed.status, 'proposed only: not pinned, not shipped');
  assert.deepEqual(plan.proposed.entries.map(e => e.revokedEvidenceRef), [s.ev.deployment.ref]);
  assert.notEqual(plan.proposed.entriesSha256, plan.base.entriesSha256);
  assert.equal(plan.base.entryCount, 0);
  assert.equal(statusOf(plan, 'disposition.signature'), 'synthetic-passed');
  assert.ok(!plan.checks.some(c => c.status === 'passed' && c.check === 'disposition.signature'));
  assert.equal(statusOf(plan, 'deployedArtifact'), 'not-observed');
  assert.deepEqual(plan.procedure.steps, [...RP.PROCEDURE]);
  assert.equal(plan.procedure.status, RP.PROCEDURE_STATUS);
  assert.equal(plan.procedure.steps.length, 5);
  assert.equal(plan.revokedReleases[0].ref, s.release.ref);
  assert.equal(plan.revokedReleases[0].revisions.length, 9);
});

test('revoke with a replacement refuses, in the inputs and in a tampered statement', async () => {
  const { s, inputs } = await inputsFor();
  refuses(() => prepare({ ...inputs, replacement: s.replacement.document }), /revoke disposition takes no replacement/);
  // A revoke statement carrying a replacement is contradictory and cannot be built or smuggled.
  assert.throws(() => X.disposition({ action: 'revoke', target: s.ev.deployment.ref, replacement: s.replacement.ref, key: s.keys.dispose }));
  const tampered = clone(inputs.disposition.document);
  tampered.payload.statement.replacementApprovalRef = s.replacement.ref;
  refuses(() => prepare({ ...inputs, disposition: { ...inputs.disposition, document: tampered } }), /disposition document invalid|contradictory/);
});

test('supersede: proposes pinning the target; the supersede alone has no runtime effect (S6d-D1)', async () => {
  const { s, inputs } = await inputsFor({ action: 'supersede' });
  const { plan } = prepare(inputs);
  assert.equal(plan.disposition.action, 'supersede');
  assert.equal(plan.disposition.effect, RP.EFFECT.supersede);
  assert.match(plan.disposition.effect, /does not revoke its target/);
  assert.equal(plan.proposed.pin, s.ev.deployment.ref);
  assert.deepEqual(plan.replacement, { ref: s.replacement.ref, kind: 'teacher-units-deployment-approval' });
  assert.equal(plan.revocationEffective, false);
});

test('invalid supersede: missing, mismatched or cross-kind replacement refuses', async () => {
  const { s, inputs } = await inputsFor({ action: 'supersede' });
  const { replacement, ...missing } = inputs;
  assert.ok(replacement);
  refuses(() => prepare(missing), /requires its replacement/);
  refuses(() => prepare({ ...inputs, replacement: s.chain.inputs.certification.document }), /replacement document is not the disposition replacement/);
  // A certification may not replace a deployment approval.
  const cert = { ref: s.chain.refs.certification, document: s.chain.inputs.certification.document };
  const cross = await inputsFor({ action: 'supersede', replacement: cert });
  refuses(() => prepare(cross.inputs), /replacement approval action mismatch/);
});

test('wrong target kind, wrong target document and wrong identity refuse', async () => {
  const { s, inputs } = await inputsFor();
  refuses(() => prepare({ ...inputs, target: s.chain.inputs.activationEvidence }), /must be a deployment approval, activation approval or release certification/);
  refuses(() => prepare({ ...inputs, target: s.replacement.document }), /target document is not the disposition target/);
  refuses(() => prepare({ ...inputs, target: undefined }), /target document is required/);
  refuses(() => prepare({ ...inputs, project: PROD }), /wrong-project|invalid/);
  refuses(() => prepare({ ...inputs, project: 'demo-x' }), /explicit supported project/);
  refuses(() => prepare({ ...inputs, extra: 1 }), /unknown plan input extra/);
});

test('certification and activation approval targets bind their releases by release ID', async () => {
  const s = await setup();
  for (const target of [{ ref: s.chain.refs.certification, document: s.chain.inputs.certification.document },
    { ref: s.chain.refs.activation, document: s.chain.inputs.activationApproval.document }]) {
    const { inputs } = await inputsFor({ target });
    assert.equal(prepare(inputs).plan.target.ref, target.ref);
    refuses(() => prepare({ ...inputs, revokedReleases: [X.releaseVariant(s.release).document] }), /not bound to the disposition target/);
  }
});

test('stale and future dispositions refuse (D6, 24 hours at preparation)', async () => {
  const stale = await inputsFor({ issuedAt: '2026-10-15T11:29:00.000Z' });
  refuses(() => prepare(stale.inputs), /more than 24 hours/);
  const future = await inputsFor({ issuedAt: '2026-10-16T11:31:00.000Z' });
  refuses(() => prepare(future.inputs), /in the future/);
});

test('signatures: wrong key refuses; staging without synthetic authority is unverifiable and refuses', async () => {
  const s = await setup();
  const wrong = await inputsFor({ key: s.keys.deploy });
  refuses(() => prepare(wrong.inputs), /disposition signature/);
  const unsigned = await inputsFor({ key: null });
  refuses(() => prepare(unsigned.inputs), /disposition signature/);
  const { inputs } = await inputsFor({ authority: undefined });
  delete inputs.authority;
  refuses(() => prepare(inputs), /unverifiable: no artifact-pinned staging registry/);
});

test('production: pinned empty registry yields an unverifiable draft, never a verified signature', async () => {
  const k = X.keys();
  const ev = await F.buildEvidence({ project: PROD, keys: k });
  const release = require('./evidence-package.cjs').assembleRelease(ev.base);
  const d = X.disposition({ action: 'revoke', target: ev.deployment.ref, key: k.dispose, project: PROD });
  const inputs = { project: PROD, disposition: signedInput(d), target: ev.deployment.document, knownDispositions: [], revokedReleases: [release.document] };
  refuses(() => prepare({ ...inputs, authority: { registryEntries: X.registryEntries(PROD, k), revocationEntries: [] } }), /production uses only the artifact-pinned/);
  const { plan, bytes } = prepare(inputs);
  assert.equal(plan.planClass, RP.PLAN_CLASSES.unverifiable);
  assert.equal(statusOf(plan, 'disposition.signature'), 'unverifiable');
  assert.equal(plan.authority.source, RP.AUTHORITY_SOURCES.pinnedEmpty);
  assert.match(plan.base.source, /PRODUCTION_REVOCATION_LIST/);
  const source = fs.readFileSync(path.resolve(__dirname, '../../platform/functions/src/teacherUnits/a3-revocation-list.ts'));
  assert.equal(plan.base.sourceSha256, K.sha256Bytes(source));
  assert.equal(RP.verifyRevocationPlan(bytes, inputs, LATER).verified, true);
  // A resealed claim of a verified pinned draft, or another list source, refuses.
  refuses(() => RP.verifyRevocationPlan(reseal(bytes, p => { p.planClass = RP.PLAN_CLASSES.pinned; }), inputs, LATER), /does not match.*planClass/);
  refuses(() => RP.verifyRevocationPlan(reseal(bytes, p => { p.base.sourceSha256 = '0'.repeat(64); }), inputs, LATER), /does not match.*base/);
  refuses(() => RP.verifyRevocationPlan(reseal(bytes, p => { p.checks[3].status = 'passed'; }), inputs, LATER), /does not match.*checks/);
});

test('already-pinned target or replacement refuses (no-op revocation cannot change the artifact)', async () => {
  const s = await setup();
  const pinTarget = await inputsFor({ authority: { ...s.authority, revocationEntries: F.revocationEntries(STAGING, [s.ev.deployment.ref]) } });
  refuses(() => prepare(pinTarget.inputs), /target .* already pinned/);
  const pinReplacement = await inputsFor({ action: 'supersede', authority: { ...s.authority, revocationEntries: F.revocationEntries(STAGING, [s.replacement.ref]) } });
  refuses(() => prepare(pinReplacement.inputs), /replacement .* already pinned/);
  // An unrelated existing pin is kept, and the next list stays sorted and valid.
  const other = await inputsFor({ authority: { ...s.authority, revocationEntries: F.revocationEntries(STAGING, [s.chain.refs.activation]) } });
  const { plan } = prepare(other.inputs);
  assert.equal(plan.base.entryCount, 1);
  assert.deepEqual(plan.proposed.entries.map(e => e.revokedEvidenceRef), [s.chain.refs.activation, s.ev.deployment.ref].sort());
});

test('conflicting dispositions, revoked replacements, duplicates and supersession cycles refuse', async () => {
  const s = await setup();
  const k = s.keys.dispose;
  const otherRevoke = X.disposition({ action: 'revoke', target: s.ev.deployment.ref, key: k, issuedAt: '2026-10-16T10:00:00.000Z' });
  const conflict = await inputsFor({ known: [otherRevoke.document] });
  refuses(() => prepare(conflict.inputs), /conflicting disposition .* already disposes target/);
  const revokeReplacement = X.disposition({ action: 'revoke', target: s.replacement.ref, key: k });
  const revoked = await inputsFor({ action: 'supersede', known: [revokeReplacement.document] });
  refuses(() => prepare(revoked.inputs), /revokes the replacement/);
  const back = X.disposition({ action: 'supersede', target: s.replacement.ref, replacement: s.ev.deployment.ref, key: k });
  const cycle = await inputsFor({ action: 'supersede', known: [back.document] });
  refuses(() => prepare(cycle.inputs), /supersession cycle/);
  const dup = await inputsFor({ known: [revokeReplacement.document, revokeReplacement.document] });
  refuses(() => prepare(dup.inputs), /listed twice/);
  refuses(() => prepare({ ...dup.inputs, knownDispositions: undefined }), /explicit list/);
  refuses(() => prepare({ ...dup.inputs, knownDispositions: [s.ev.deployment.document] }), /known disposition 0 invalid/);
  // The disposition itself in the known set is not a conflict; unrelated dispositions are recorded.
  const { d, inputs } = await inputsFor();
  const self = prepare({ ...inputs, knownDispositions: [d.document, revokeReplacement.document] });
  assert.deepEqual(self.plan.knownDispositions, [d.ref, revokeReplacement.ref].sort());
});

test('missing evidence: releases and statement bytes are required', async () => {
  const { s, inputs } = await inputsFor();
  refuses(() => prepare({ ...inputs, revokedReleases: [] }), /at least one revoked backend release/);
  refuses(() => prepare({ ...inputs, revokedReleases: [s.release.document, s.release.document] }), /listed twice/);
  refuses(() => prepare({ ...inputs, disposition: { document: inputs.disposition.document } }), /keys must be exactly/);
  refuses(() => prepare({ ...inputs, disposition: { ...inputs.disposition, statementBytes: Buffer.from('{}') } }), /disposition/);
  refuses(() => RP.prepareRevocationPlan(inputs), /preparedAt/);
});

test('verify: honest re-derivation passes; changed inputs, base list, claims and staleness refuse', async () => {
  const { s, inputs } = await inputsFor({ action: 'supersede' });
  const { bytes } = prepare(inputs);
  const ok = RP.verifyRevocationPlan(bytes, inputs, LATER);
  assert.equal(ok.verified, true);
  for (const key of ['revocationEffective', 'releaseAuthorized', 'activationReady']) assert.equal(ok[key], false);
  // Stale base list: another entry pinned since preparation.
  refuses(() => RP.verifyRevocationPlan(bytes, { ...inputs, authority: { ...s.authority, revocationEntries: F.revocationEntries(STAGING, [s.chain.refs.activation]) } }, LATER), /does not match.*base/);
  // Changed authority evidence.
  const k2 = X.keys();
  refuses(() => RP.verifyRevocationPlan(bytes, { ...inputs, authority: { ...s.authority, registryEntries: X.registryEntries(STAGING, k2) } }, LATER), /disposition signature/);
  const extended = { ...s.authority, registryEntries: [...s.authority.registryEntries, ...X.registryEntries(STAGING, k2)].sort((a, b) => (a.keyId < b.keyId ? -1 : 1)) };
  refuses(() => RP.verifyRevocationPlan(bytes, { ...inputs, authority: extended }, LATER), /does not match.*authority/);
  // Changed disposition, target, replacement and releases.
  const other = X.disposition({ action: 'supersede', target: s.ev.deployment.ref, replacement: s.replacement.ref, key: s.keys.dispose, issuedAt: '2026-10-16T11:05:00.000Z' });
  refuses(() => RP.verifyRevocationPlan(bytes, { ...inputs, disposition: signedInput(other) }, LATER), /does not match.*disposition/);
  refuses(() => RP.verifyRevocationPlan(bytes, { ...inputs, target: s.replacement.document }, LATER), /target document is not/);
  refuses(() => RP.verifyRevocationPlan(bytes, { ...inputs, replacement: s.ev.deployment.document }, LATER), /replacement document is not/);
  refuses(() => RP.verifyRevocationPlan(bytes, { ...inputs, revokedReleases: [s.release.document, X.releaseVariant(s.release).document] }, LATER), /deployment binding invalid at \$: candidate runtimePayloadFingerprint mismatch/);
  refuses(() => RP.verifyRevocationPlan(bytes, { ...inputs, revokedReleases: [] }, LATER), /at least one revoked backend release/);
  // Altered fixed claims refuse at the schema even when resealed.
  for (const edit of [p => { p.revocationEffective = true; }, p => { p.releaseAuthorized = true; }, p => { p.activationReady = true; },
    p => { p.authorization = 'approved'; }, p => { p.disposition.effect = 'revoked'; }, p => { p.proposed.status = 'pinned'; },
    p => { p.procedure.status = 'executed'; }, p => { p.procedure.steps.pop(); }, p => { p.unresolved = []; }, p => { p.extra = 1; }]) {
    refuses(() => RP.verifyRevocationPlan(reseal(bytes, edit), inputs, LATER), /revocation plan/);
  }
  // Resealed but inconsistent content refuses through re-derivation.
  refuses(() => RP.verifyRevocationPlan(reseal(bytes, p => { p.proposed.pin = p.replacement.ref; p.proposed.entries[0].revokedEvidenceRef = p.replacement.ref; }), inputs, LATER), /pin the target/);
  refuses(() => RP.verifyRevocationPlan(reseal(bytes, p => { p.knownDispositions = []; p.revokedReleases[0].runtimePayloadFingerprint = 'f'.repeat(64); }), inputs, LATER), /does not match/);
  refuses(() => RP.verifyRevocationPlan(Buffer.concat([bytes, Buffer.from('\n')]), inputs, LATER), /not canonical/);
  // Staleness and timing.
  refuses(() => RP.verifyRevocationPlan(bytes, inputs, '2026-10-16T11:29:00.000Z'), /in the future/);
  refuses(() => RP.verifyRevocationPlan(bytes, inputs, 'not-a-time'), /tooling clock/);
  refuses(() => RP.verifyRevocationPlan(bytes, inputs, undefined), /tooling clock/);
  refuses(() => RP.verifyRevocationPlan(bytes, { ...inputs, preparedAt: X.PREPARED }, LATER), /do not supply it/);
  refuses(() => RP.verifyRevocationPlan(bytes, { ...inputs, project: PROD }, LATER), /identity differs/);
});

// --- rollout -----------------------------------------------------------------
let captured;
const ROLLOUT_NOW = '2026-10-16T13:00:00.000Z';
async function capture(options = {}) {
  const c = await buildCapture(options);
  const result = await PC.captureA3Provider({ ...c, evidenceClass: 'synthetic' });
  return { c, result };
}
/** A release document certified by a synthetic signed certification (backendReleaseId binds the whole manifest). */
function certify(s, document) {
  const chain = F.chainFor(s.ev, K.contentDigest(document.manifest));
  return { release: { document }, target: { ref: chain.refs.certification, document: chain.inputs.certification.document } };
}
// Default: a signed (certified) variant release whose revisions and fingerprints differ from the capture.
async function rolloutSetup({ pick = s => X.certifiedVariant(s), preparedAt = X.PREPARED } = {}) {
  const s = await setup();
  if (!captured) captured = await capture();
  const picked = pick(s);
  const variant = picked.release;
  const { inputs } = await inputsFor({ target: picked.target, releases: [variant.document] });
  const { bytes } = RP.prepareRevocationPlan({ ...inputs, preparedAt });
  const { c, result } = captured;
  return { s, variant, inputs, planBytes: bytes,
    rollout: { project: STAGING, planBytes: bytes, planInputs: inputs, now: ROLLOUT_NOW, capture: { ...result.bytes },
      deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot } };
}

test('rollout: different revisions and artifacts pass the comparison, and nothing more is established', async () => {
  const { rollout, planBytes } = await rolloutSetup();
  const { report, bytes } = await RP.checkRollout(rollout);
  assert.equal(report.rolloutComparison, 'passed', report.findings.join('; '));
  assert.deepEqual(report.findings, []);
  for (const key of ['revocationComplete', 'revocationEffective', 'releaseAuthorized', 'activationReady', 'providerVerified']) assert.equal(report[key], false);
  assert.equal(report.oldRevisionsDeleted, 'not-observed');
  assert.match(report.deployedRevocationList, /^not-observed: a different revision and artifact fingerprint do not establish/);
  assert.match(report.providerOrigin, /^unverifiable/);
  assert.equal(report.evidenceClass, 'synthetic');
  assert.equal(report.planSha256, K.sha256Bytes(planBytes));
  assert.equal(report.endpoints.length, 9);
  assert.ok(report.endpoints.every(e => e.matchesRevokedRevision === false));
  assert.equal(report.artifact.matchesRevokedArtifact, false);
  assert.equal(bytes.toString('utf8'), K.canonicalJSON(report));
});

test('rollout: a revoked revision or artifact still serving fails the comparison', async () => {
  // Deployment-approval target with its genuine, canonically bound release.
  const both = await rolloutSetup({ pick: s => ({ release: s.release, target: s.ev.deployment }) });
  const r1 = (await RP.checkRollout(both.rollout)).report;
  assert.equal(r1.rolloutComparison, 'failed');
  assert.ok(r1.findings.some(f => /revoked revision still serving/.test(f)));
  assert.ok(r1.findings.some(f => /revoked artifact fingerprint still serving/.test(f)));
  assert.equal(r1.revocationComplete, false);
  const artifactOnly = await rolloutSetup({ pick: s => X.certifiedVariant(s, { fingerprints: false }) });
  const r2 = (await RP.checkRollout(artifactOnly.rollout)).report;
  assert.deepEqual(r2.findings, ['revoked artifact fingerprint still serving']);
  const revisionOnly = await rolloutSetup({ pick: s => { const v = clone(s.release.document); v.manifest.runtimePayloadFingerprint = 'd'.repeat(64); v.manifest.functionsArtifactFingerprint = 'e'.repeat(64); return certify(s, v); } });
  const r3 = (await RP.checkRollout(revisionOnly.rollout)).report;
  assert.ok(r3.findings.length > 0 && r3.findings.every(f => /revoked revision still (serving|routed)/.test(f)));
});

test('rollout: a capture taken before the plan cannot observe the redeploy', async () => {
  const { rollout } = await rolloutSetup({ preparedAt: '2026-10-16T12:30:00.000Z' });
  const { report } = await RP.checkRollout(rollout);
  assert.equal(report.rolloutComparison, 'failed');
  assert.ok(report.findings.some(f => /capture started before the plan/.test(f)));
});

test('rollout: tampered capture, wrong project, mismatched releases and missing evidence refuse', async () => {
  const { rollout, s, variant } = await rolloutSetup();
  const observation = reseal(rollout.capture.observation, o => { o.endpoints[0].configuration.revisionResource += 'x'; });
  await rejects(RP.checkRollout({ ...rollout, capture: { ...rollout.capture, observation } }), /observation\.json differs/);
  const bundle = reseal(rollout.capture.bundle, b => { b.providerVerified = true; });
  await rejects(RP.checkRollout({ ...rollout, capture: { ...rollout.capture, bundle } }), /capture\.json differs/);
  await rejects(RP.checkRollout({ ...rollout, project: PROD }), /identity differs/);
  const pi = rollout.planInputs;
  await rejects(RP.checkRollout({ ...rollout, planInputs: { ...pi, revokedReleases: [s.release.document] } }), /not bound to the disposition target/);
  await rejects(RP.checkRollout({ ...rollout, planInputs: { ...pi, revokedReleases: [variant.document, s.release.document] } }), /not bound to the disposition target/);
  await rejects(RP.checkRollout({ ...rollout, planInputs: { ...pi, revokedReleases: [] } }), /at least one revoked backend release/);
  await rejects(RP.checkRollout({ ...rollout, capture: undefined }), /capture files are required/);
  const { transcript, ...partial } = rollout.capture;
  assert.ok(transcript);
  await rejects(RP.checkRollout({ ...rollout, capture: partial }), /capture files required exactly/);
  await rejects(RP.checkRollout({ ...rollout, deploymentPlan: undefined }), /REFUSED/);
  await rejects(RP.checkRollout({ ...rollout, planBytes: reseal(rollout.planBytes, p => { p.revocationEffective = true; }) }), /revocationEffective/);
  await rejects(RP.checkRollout({ ...rollout, extra: 1 }), /unknown rollout input/);
  // Fixed literals refuse at the shared plan schema before re-derivation.
  for (const [edit, pattern] of [[p => { p.disposition.effect = 'revoked'; }, /effect must be the fixed audit-only/],
    [p => { p.procedure.steps[1] = 'executed'; }, /fixed descriptive R2 procedure/], [p => { p.procedure.status = 'executed'; }, /fixed descriptive R2 procedure/],
    [p => { p.unresolved = []; }, /unresolved gates/], [p => { p.proposed.status = 'pinned'; }, /stay proposed only/],
    [p => { p.planClass = 'verified'; }, /class unsupported/], [p => { p.authority.source = 'pinned'; }, /authority source unsupported/]]) {
    await rejects(RP.checkRollout({ ...rollout, planBytes: reseal(rollout.planBytes, edit) }), pattern);
  }
});

test('rollout: the plan is fully re-derived first; altered evidence, authority, base list or plan refuses before any comparison', async () => {
  const { rollout, s } = await rolloutSetup();
  const pi = rollout.planInputs;
  const replay = PC.verifyCapture;
  let replays = 0;
  PC.verifyCapture = async (...a) => { replays++; return replay(...a); };
  try {
    const other = X.disposition({ action: 'revoke', target: K.evidenceRef(pi.target.payload), key: s.keys.dispose, issuedAt: '2026-10-16T11:05:00.000Z' });
    const cases = [
      [{ planInputs: undefined }, /original revocation plan inputs are required/],
      [{ planInputs: { ...pi, project: PROD } }, /plan inputs identity differs/],
      [{ now: undefined }, /tooling clock/],
      [{ now: '2026-10-16T11:00:00.000Z' }, /in the future/],
      [{ planInputs: { ...pi, disposition: signedInput(other) } }, /does not match.*disposition/],
      [{ planInputs: { ...pi, disposition: { document: pi.disposition.document } } }, /keys must be exactly/],
      [{ planInputs: { ...pi, target: s.replacement.document } }, /target document is not/],
      [{ planInputs: { ...pi, target: undefined } }, /target document is required/],
      [{ planInputs: { ...pi, replacement: s.replacement.document } }, /takes no replacement/],
      [{ planInputs: { ...pi, authority: { ...s.authority, registryEntries: X.registryEntries(STAGING, X.keys()) } } }, /disposition signature/],
      [{ planInputs: { ...pi, authority: undefined } }, /unverifiable: no artifact-pinned staging/],
      [{ planInputs: { ...pi, authority: { ...s.authority, revocationEntries: F.revocationEntries(STAGING, [s.chain.refs.activation]) } } }, /does not match.*base/],
      [{ planInputs: { ...pi, knownDispositions: undefined } }, /explicit list/],
      [{ planInputs: { ...pi, knownDispositions: [X.disposition({ action: 'revoke', target: K.evidenceRef(pi.target.payload), key: s.keys.dispose, issuedAt: '2026-10-16T10:00:00.000Z' }).document] } }, /conflicting disposition/],
      [{ planBytes: reseal(rollout.planBytes, p => { p.knownDispositions = ['teacherUnitsReleaseEvidence/' + '0'.repeat(64)]; }) }, /does not match.*knownDispositions/],
      [{ planBytes: reseal(rollout.planBytes, p => { p.base.entriesSha256 = '0'.repeat(64); }) }, /does not match.*base/],
      [{ planBytes: reseal(rollout.planBytes, p => { p.revokedReleases[0].revisions[0].revisionResource += 'x'; }) }, /does not match.*revokedReleases/],
    ];
    for (const [edit, pattern] of cases) await rejects(RP.checkRollout({ ...rollout, ...edit }), pattern);
    assert.equal(replays, 0, 'no capture is replayed or compared before the plan verifies');
  } finally { PC.verifyCapture = replay; }
});

test('rollout comparison (pure): eight, ten, partial, tagged and alternate routes fail', async () => {
  const { s, variant, planBytes } = await rolloutSetup();
  assert.ok(s && variant);
  const plan = JSON.parse(planBytes.toString('utf8'));
  const observation = JSON.parse(captured.result.bytes.observation.toString('utf8'));
  assert.deepEqual(RP.assessRollout(observation, plan).findings, []);
  const edit = fn => { const o = clone(observation); fn(o); return RP.assessRollout(o, plan).findings; };
  assert.match(edit(o => o.endpoints.pop()).join(), /exactly the nine sorted A3 endpoints, observed 8/);
  assert.match(edit(o => o.endpoints.push(clone(o.endpoints[0]))).join(), /observed 10/);
  assert.match(edit(o => { o.endpoints[1].configuration.traffic[0].percent = 50; }).join(), /partial traffic 50/);
  assert.match(edit(o => { o.endpoints[1].configuration.traffic[0].tag = 'canary'; }).join(), /tagged route canary/);
  assert.match(edit(o => { const c = o.endpoints[2].configuration; c.traffic.push({ revisionResource: `${c.serviceResource}/revisions/x`, percent: 0, tag: null }); }).join(), /expected one serving route, observed 2/);
  assert.match(edit(o => { const c = o.endpoints[2].configuration; c.traffic[0].revisionResource = `${c.serviceResource}/revisions/x`; }).join(), /alternate serving revision/);
  assert.match(edit(o => { const c = o.endpoints[3].configuration; c.traffic[0].revisionResource = plan.revokedReleases[0].revisions[3].revisionResource; }).join(), /revoked revision still routed/);
  assert.match(edit(o => { o.functionsArtifactFingerprint = plan.revokedReleases[0].functionsArtifactFingerprint; }).join(), /revoked artifact/);
  assert.match(edit(o => { o.endpoints = undefined; }).join(), /observed 0/);
});

test('no network, credentials, signing or provider mutation; static scan', async () => {
  const calls = [], saved = { fetch: globalThis.fetch, http: http.request, https: https.request };
  const trap = name => () => { calls.push(name); throw new Error('network attempted'); };
  globalThis.fetch = trap('fetch'); http.request = trap('http'); https.request = trap('https');
  const token = PC.liveAccessToken;
  PC.liveAccessToken = () => { calls.push('token'); throw new Error('credential attempted'); };
  try {
    const { rollout, inputs, planBytes } = await rolloutSetup();
    RP.verifyRevocationPlan(planBytes, inputs, LATER);
    await RP.checkRollout(rollout);
  } finally { globalThis.fetch = saved.fetch; http.request = saved.http; https.request = saved.https; PC.liveAccessToken = token; }
  assert.deepEqual(calls, []);
  const code = fs.readFileSync(path.join(__dirname, 'revocation-procedure.cjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbidden of [/\bfetch\(/, /https?\.request/, /firebase-admin|@google-cloud/, /\bsign\(/, /createPrivateKey|privateKey/, /tokenFromGcloud|liveAccessToken|createLiveExchange/,
    /writeFile|mkdir|unlink|rmSync|appendFile/, /\.firebaserc/, /child_process/, /fixtures\//, /new Date\(|Date\.now/]) {
    assert.doesNotMatch(code, forbidden, `revocation-procedure.cjs must not contain ${forbidden}`);
  }
});

test('D6 freshness: enforced at preparation at the 24-hour boundary; historical verification persists and reports current freshness separately', async () => {
  const { inputs } = await inputsFor(); // issued 2026-10-16T11:00:00Z
  const at = t => RP.prepareRevocationPlan({ ...inputs, preparedAt: t });
  assert.ok(at('2026-10-17T10:59:59.999Z').plan);
  const edge = at('2026-10-17T11:00:00.000Z');
  refuses(() => at('2026-10-17T11:00:00.001Z'), /more than 24 hours/);
  refuses(() => at('2026-10-16T10:59:59.999Z'), /in the future/);
  // Historical verification of the fresh plan, before, at and after the window.
  const { bytes } = prepare(inputs);
  const v = now => RP.verifyRevocationPlan(bytes, inputs, now);
  assert.equal(v('2026-10-17T10:59:59.999Z').currentFreshness.status, 'within-window');
  assert.equal(v('2026-10-17T11:00:00.000Z').currentFreshness.status, 'within-window');
  const late = v('2026-10-17T11:00:00.001Z');
  assert.equal(late.verified, true);
  assert.match(late.verification, /^historical/);
  assert.equal(late.currentFreshness.status, 'outside-window');
  assert.match(late.currentFreshness.detail, /a new signed disposition is required/);
  for (const key of ['revocationEffective', 'releaseAuthorized', 'activationReady']) assert.equal(late[key], false);
  const year = v('2027-10-16T11:00:00.000Z');
  assert.equal(year.verified, true);
  assert.equal(year.currentFreshness.status, 'outside-window');
  // A plan prepared at the edge still verifies later; preparation freshness is re-applied at preparedAt, never renewed.
  assert.equal(RP.verifyRevocationPlan(edge.bytes, inputs, '2026-10-20T00:00:00.000Z').verified, true);
  // A resealed later preparedAt (an attempt to renew or to reach outside the window) refuses by re-derivation.
  refuses(() => RP.verifyRevocationPlan(reseal(bytes, p => { p.preparedAt = '2026-10-17T11:00:00.001Z'; }), inputs, '2026-10-18T00:00:00.000Z'), /more than 24 hours/);
  refuses(() => RP.verifyRevocationPlan(reseal(bytes, p => { p.preparedAt = '2026-10-16T12:00:00.000Z'; }), inputs, '2026-10-18T00:00:00.000Z'), /does not match.*checks/);
  refuses(() => RP.verifyRevocationPlan(reseal(bytes, p => { p.preparedAt = 'yesterday'; }), inputs, LATER), /preparedAt/);
});

test('rollout after the 24-hour window: still verified historically, freshness reported, never authorizing', async () => {
  const { rollout } = await rolloutSetup();
  const { report } = await RP.checkRollout({ ...rollout, now: '2026-10-18T00:00:00.000Z' });
  assert.equal(report.rolloutComparison, 'passed');
  assert.match(report.planVerification, /^historical/);
  assert.equal(report.currentFreshness.status, 'outside-window');
  for (const key of ['revocationComplete', 'revocationEffective', 'releaseAuthorized', 'activationReady', 'providerVerified']) assert.equal(report[key], false);
  assert.match(report.deployedRevocationList, /^not-observed/);
  assert.match(report.providerOrigin, /^unverifiable/);
  assert.equal(report.oldRevisionsDeleted, 'not-observed');
});

test('P2: deployment-target releases must satisfy the canonical validateDeploymentBinding before any comparison value is used', async () => {
  const s = await setup();
  const B = require('../../platform/functions/lib/teacherUnits/a3-bindings.js');
  const replay = PC.verifyCapture;
  let replays = 0;
  PC.verifyCapture = async (...a) => { replays++; return replay(...a); };
  try {
    const deployment = { release: s.release, target: s.ev.deployment };
    // A. The genuine release is accepted, recorded with its binding, and the comparison fails honestly.
    const genuine = await rolloutSetup({ pick: () => deployment });
    const plan = JSON.parse(genuine.planBytes.toString('utf8'));
    assert.match(plan.revokedReleases[0].binding, /^canonical validateDeploymentBinding/);
    assert.match(plan.revokedReleases[0].binding, /revision identities are not signed and are unbound/);
    const before = replays;
    const honest = (await RP.checkRollout(genuine.rollout)).report;
    assert.equal(replays, before + 1);
    assert.equal(honest.rolloutComparison, 'failed');
    assert.ok(honest.findings.includes('revoked artifact fingerprint still serving'));
    const pi = genuine.rollout.planInputs;

    // B and E. Sol's substitution (revisions and fingerprints) refuses at preparation and in rollout-check, before replay.
    const substituted = X.releaseVariant(s.release).document;
    assert.equal(B.validateDeploymentBinding(substituted, s.ev.deployment.document).ok, false);
    refuses(() => prepare({ ...pi, revokedReleases: [substituted] }), /deployment binding invalid at \$: candidate runtimePayloadFingerprint mismatch/);
    const n = replays;
    await rejects(RP.checkRollout({ ...genuine.rollout, planInputs: { ...pi, revokedReleases: [substituted] } }), /deployment binding invalid/);
    // F. A resealed plan with the substitute's internally consistent, recomputed release ID and values also refuses.
    const forged = reseal(genuine.planBytes, p => {
      const r = p.revokedReleases[0], m = substituted.manifest;
      r.releaseId = K.contentDigest(m); r.ref = `teacherUnitsBackendReleases/${r.releaseId}`;
      r.runtimePayloadFingerprint = m.runtimePayloadFingerprint; r.functionsArtifactFingerprint = m.functionsArtifactFingerprint;
      r.revisions = m.endpoints.map(e => ({ endpointName: e.endpointName, revisionResource: e.revisionResource }));
    });
    await rejects(RP.checkRollout({ ...genuine.rollout, planBytes: forged }), /does not match.*revokedReleases/);
    await rejects(RP.checkRollout({ ...genuine.rollout, planBytes: forged, planInputs: { ...pi, revokedReleases: [substituted] } }), /deployment binding invalid/);
    await rejects(RP.checkRollout({ ...genuine.rollout, planBytes: reseal(genuine.planBytes, p => { p.revokedReleases[0].binding = 'trusted'; }) }), /release binding unsupported/);
    await rejects(RP.checkRollout({ ...genuine.rollout, planBytes: reseal(genuine.planBytes, p => { p.revokedReleases[0].binding = RP.BINDINGS.releaseId; }) }), /does not match.*revokedReleases/);

    // D. Fingerprints alone substituted refuse.
    const fingerprintOnly = clone(s.release.document);
    fingerprintOnly.manifest.functionsArtifactFingerprint = 'e'.repeat(64);
    refuses(() => prepare({ ...pi, revokedReleases: [fingerprintOnly] }), /candidate functionsArtifactFingerprint mismatch/);
    await rejects(RP.checkRollout({ ...genuine.rollout, planInputs: { ...pi, revokedReleases: [fingerprintOnly] } }), /candidate functionsArtifactFingerprint mismatch/);
    const sourceOnly = clone(s.release.document);
    sourceOnly.manifest.sourceSha = '9'.repeat(40);
    refuses(() => prepare({ ...pi, revokedReleases: [sourceOnly] }), /candidate sourceSha mismatch/);

    // G. Wrong approval, release identity or environment refuses.
    const otherApproval = clone(s.release.document);
    otherApproval.manifest.deploymentApprovalEvidenceRef = s.replacement.ref;
    refuses(() => prepare({ ...pi, revokedReleases: [otherApproval] }), /deployment binding invalid/);
    const wrongProject = clone(s.release.document);
    wrongProject.manifest.projectId = 'lyfelabz-prod';
    refuses(() => prepare({ ...pi, revokedReleases: [wrongProject] }), /revoked release 0 invalid/);
    refuses(() => prepare({ ...pi, revokedReleases: [{ manifest: {} }] }), /revoked release 0 invalid/);
    refuses(() => prepare({ ...pi, revokedReleases: [null] }), /revoked release 0 invalid/);
    const cert = X.certifiedVariant(s);
    const certInputs = (await inputsFor({ target: cert.target, releases: [cert.release.document] })).inputs;
    refuses(() => prepare({ ...certInputs, revokedReleases: [X.releaseVariant(s.release, { suffix: 'other' }).document] }), /not bound to the disposition target/);
    assert.equal(replays, n, 'no capture is replayed for an unbound or substituted release');

    // C. Revision identities alone are not signed by a deployment approval: the substitute binds,
    // and is recorded as unbound, but cannot turn the comparison from failed to passed because the
    // bound artifact fingerprint of the revoked release still serves.
    const revisionOnly = X.releaseVariant(s.release, { fingerprints: false }).document;
    assert.equal(B.validateDeploymentBinding(revisionOnly, s.ev.deployment.document).ok, true);
    const relabelled = await rolloutSetup({ pick: () => ({ release: { document: revisionOnly }, target: s.ev.deployment }) });
    const r = (await RP.checkRollout(relabelled.rollout)).report;
    assert.equal(r.rolloutComparison, 'failed');
    assert.deepEqual(r.findings, ['revoked artifact fingerprint still serving']);

    // H. A comparison over signed, content-bound values still passes.
    const valid = (await RP.checkRollout((await rolloutSetup()).rollout)).report;
    assert.equal(valid.rolloutComparison, 'passed');
    // J. Fixed non-authorizing fields are unchanged in every report.
    for (const report of [honest, r, valid]) {
      for (const key of ['revocationComplete', 'revocationEffective', 'releaseAuthorized', 'activationReady', 'providerVerified']) assert.equal(report[key], false);
      assert.equal(report.oldRevisionsDeleted, 'not-observed');
      assert.match(report.deployedRevocationList, /^not-observed/);
      assert.match(report.providerOrigin, /^unverifiable/);
    }
  } finally { PC.verifyCapture = replay; }
});
