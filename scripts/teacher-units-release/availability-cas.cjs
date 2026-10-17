'use strict';

// A3-6 S6a: availability-policy compare-and-set with content-addressed history (D8),
// EMULATOR ONLY. The policy write and the history create happen in one Firestore
// transaction; compare-and-set comes from the transactional policy read and the
// operator's confirmation digest, which binds the previous policy digest. History is
// append-only and never read by the runtime verifier; repeated generations are
// reported as rollback evidence and never authorize or block a transition.
const path = require('node:path');
const { assertStatementFresh } = require('./freshness.cjs');
const { instant } = require('./provider-observation.cjs');
const { assertEmulatorWriteTarget, assertDatabase, functionsModule } = require('./registration.cjs');

const LIB = path.resolve(__dirname, '../../platform/functions/lib/teacherUnits');
function refuse(message) { throw new Error(`[a3-availability-cas] REFUSED: ${message}`); }
function compiled(name) {
  try { return require(path.join(LIB, name)); }
  catch { return refuse(`compiled A3 module ${name} unavailable; run npm --prefix platform/functions run build`); }
}
const K = compiled('a3-canonical.js');
const V = compiled('a3-validation.js');
const B = compiled('a3-bindings.js');
const CV = compiled('a3-composite-verifier.js');
const R = compiled('a3-authority-registry.js');
const L = compiled('a3-revocation-list.js');
const { Timestamp } = functionsModule('firebase-admin/firestore');

// Same path A3-3 enforcement reads (TEACHER_UNITS_POLICY_PATH; equality is tested).
const POLICY_PATH = 'platformConfig/teacherUnitsAvailability';
const HISTORY_COLLECTION = 'teacherUnitsAvailabilityHistory';
const TRANSITIONS = Object.freeze(['initialize', 'prepare', 'enable', 'shutdown']);
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;

function structural(result, description) {
  if (!result.ok) refuse(`${description} structure invalid at ${result.issue.path}: ${result.issue.reason}`);
  return result.value;
}
const identityOf = e => ({ environment: e.environment, projectId: e.projectId, projectNumber: e.projectNumber });

/** D8 fix 2: an explicit SDK Timestamp from the tooling clock, never a sentinel. */
function timestampAt(now) {
  const ns = instant(now, 'tooling clock');
  return new Timestamp(Number(ns / 1000000000n), Number(ns % 1000000000n));
}
function withoutTimestamp(policy) { const { updatedAt, ...rest } = policy; void updatedAt; return rest; }

/** Pure: next policy, its history record and address, and the confirmation digest.
 * `previous` is the stored policy (validated) or null. */
function planTransition({ transition, previous, expected, options = {}, operatorSubject, reason, now }) {
  if (!TRANSITIONS.includes(transition)) refuse(`unknown transition: ${transition}`);
  const before = previous === null ? null : structural(V.validatePolicy(previous, expected), 'stored policy');
  const updatedAt = timestampAt(now);
  let next, evidenceRefs;
  if (transition === 'initialize') {
    if (before !== null) refuse('a policy already exists; initialize applies only to a missing policy');
    if (typeof options.policyInstanceId !== 'string' || !UUID_V4.test(options.policyInstanceId)) refuse('initialize requires a UUID v4 --policy-instance-id');
    if (typeof options.placementFingerprint !== 'string' || !DIGEST.test(options.placementFingerprint)) refuse('initialize requires a --placement-fingerprint digest');
    next = { ...identityOf(expected), schemaVersion: 1, policyInstanceId: options.policyInstanceId, region: 'us-central1', databaseId: '(default)',
      mode: 'closed', generation: 1, backendReleaseEligibility: null, acceptedClientContractVersions: ['teacher-units-v2'],
      placementFingerprint: options.placementFingerprint, activationEvidenceRef: null, updatedAt };
    evidenceRefs = [];
  } else {
    if (before === null) refuse(`${transition} requires an existing policy; initialize first`);
    if (before.generation === Number.MAX_SAFE_INTEGER) refuse('policy generation exhausted');
    const base = { ...withoutTimestamp(before), generation: before.generation + 1, updatedAt };
    if (transition === 'prepare') {
      if (before.mode !== 'closed') refuse('prepare requires a closed policy');
      const releaseId = options.releaseId;
      if (releaseId !== null && (typeof releaseId !== 'string' || !DIGEST.test(releaseId))) refuse('prepare requires --release-id <digest> or --release-id none');
      const placement = options.placementFingerprint === undefined ? before.placementFingerprint : options.placementFingerprint;
      if (typeof placement !== 'string' || !DIGEST.test(placement)) refuse('placement fingerprint must be a digest');
      next = { ...base, backendReleaseEligibility: releaseId === null ? null : { releaseId }, placementFingerprint: placement };
      evidenceRefs = releaseId === null ? [] : [`teacherUnitsBackendReleases/${releaseId}`];
    } else if (transition === 'enable') {
      if (before.mode !== 'closed' || before.backendReleaseEligibility === null) refuse('enable requires a closed policy with a prepared release');
      if (typeof options.activationEvidenceRef !== 'string') refuse('enable requires --activation-evidence <ref>');
      next = { ...base, mode: 'enabled', activationEvidenceRef: options.activationEvidenceRef };
      evidenceRefs = [`teacherUnitsBackendReleases/${before.backendReleaseEligibility.releaseId}`, options.activationEvidenceRef];
    } else {
      if (before.mode !== 'enabled') refuse('shutdown requires an enabled policy');
      if (typeof options.clearRelease !== 'boolean') refuse('shutdown requires an explicit release choice');
      next = { ...base, mode: 'closed', activationEvidenceRef: null,
        backendReleaseEligibility: options.clearRelease ? null : before.backendReleaseEligibility };
      evidenceRefs = [before.activationEvidenceRef];
    }
  }
  structural(V.validatePolicy(next, expected), 'next policy');
  if (typeof operatorSubject !== 'string' || operatorSubject === '') refuse('an --operator-subject label is required (recorded, unverified)');
  if (typeof reason !== 'string' || reason === '') refuse('a --reason is required');
  const history = { ...identityOf(expected), schemaVersion: 1, kind: 'teacher-units-availability-history', transition,
    policyInstanceId: next.policyInstanceId, nextGeneration: next.generation,
    previousPolicyDigest: before === null ? null : structural(B.availabilityPolicyDigest(before, expected), 'previous policy digest'),
    nextPolicyDigest: structural(B.availabilityPolicyDigest(next, expected), 'next policy digest'),
    evidenceRefs: [...new Set(evidenceRefs)].sort(), operatorSubject, reason };
  return checkPlan({ next, history, before, expected, transition });
}

/** Re-validates a plan with the certified S2 binding, so a tampered history (previous
 * digest, transition, generation or evidence) refuses before any write. */
function checkPlan({ next, history, before, expected, transition }) {
  structural(B.validateAvailabilityHistoryBinding(history, before, next, expected), 'availability history');
  const historyRef = `${HISTORY_COLLECTION}/${K.contentDigest(history)}`;
  structural(B.validateAvailabilityHistoryReference(historyRef, history, expected), 'availability history address');
  const intent = { kind: 'lyfelabz.teacherUnitsA3PolicyTransitionIntent', schemaVersion: 1, ...identityOf(expected), transition,
    previousPolicyDigest: history.previousPolicyDigest, next: withoutTimestamp(next), evidenceRefs: history.evidenceRefs,
    operatorSubject: history.operatorSubject, reason: history.reason };
  return Object.freeze({ transition, next, history, historyRef, intent, confirmDigest: K.contentDigest(intent) });
}

// D8 fix 3: at enable, the verifier's pure checks through the certified S3 core, over
// documents read in this transaction, plus D6 activation-approval freshness. A3-2
// provenance is a runtime-only check and is not (and cannot be) performed here. A
// provider observation does not exist for an emulator target; cloud enable is S6c.
async function verifyEnable(tx, db, next, expected, deps, now) {
  if (!deps || !R.isAuthorityRegistry(deps.registry) || !L.isRevocationList(deps.revocationList)) refuse('enable requires a branded authority registry and revocation list');
  if (!expected.localProfile) refuse('emulator enable requires the explicit local profile');
  const read = async (ref, what) => {
    const snap = await tx.get(db.doc(ref));
    if (!snap.exists) refuse(`${what} not registered: ${ref}`);
    return snap.data();
  };
  const releaseRef = `teacherUnitsBackendReleases/${next.backendReleaseEligibility.releaseId}`;
  const release = await read(releaseRef, 'release');
  const deploymentApprovalRef = release?.manifest?.deploymentApprovalEvidenceRef;
  const deploymentApproval = await read(String(deploymentApprovalRef), 'deployment approval');
  const activationEvidence = await read(next.activationEvidenceRef, 'activation evidence');
  const activationApprovalRef = activationEvidence?.payload?.authorizationEvidenceRef;
  const activationApproval = await read(String(activationApprovalRef), 'activation approval');
  const certification = await read(String(activationApproval?.payload?.statement?.certificationEvidenceRef), 'certification');
  // endpointName is not validated by S3 (A3-2 binds the endpoint); any one endpoint name.
  const verdict = CV.verifyReleaseAuthorityChain({ identity: expected, endpointName: V.ENDPOINTS[0], policy: next, releaseRef, release,
    deploymentApprovalRef, deploymentApproval, activationEvidenceRef: next.activationEvidenceRef, activationEvidence,
    activationApprovalRef, activationApproval, certification }, { registry: deps.registry, revocationList: deps.revocationList });
  if (verdict.verdict !== 'verified') refuse(`release authority chain unverified: ${verdict.reason}`);
  assertStatementFresh('teacher-units-activation-approval', activationApproval.payload.statement, now, 'enable');
  return verdict;
}

/** One transaction: read policy, re-plan, compare the confirmation digest, (enable)
 * verify the chain, refuse any existing history at the address, then set the policy
 * and create the history. Refusals propagate unchanged and are never retried; only the
 * SDK's own retryable-error reruns apply, and each rerun re-plans from fresh reads. */
async function executeTransition({ db, expected, transition, options, operatorSubject, reason, confirm, now = () => new Date().toISOString(),
  enableDependencies, env = process.env }) {
  assertEmulatorWriteTarget(expected, env);
  assertDatabase(db, expected);
  if (typeof confirm !== 'string' || !DIGEST.test(confirm)) refuse('--confirm <digest> from the dry run is required');
  return db.runTransaction(async tx => {
    const policySnap = await tx.get(db.doc(POLICY_PATH));
    let previous = null;
    if (policySnap.exists) {
      previous = policySnap.data();
      if (!V.validatePolicy(previous, expected).ok) refuse('stored policy is invalid; invalid-policy repair is a separate, separately authorized procedure (D8)');
    }
    const at = now();
    const plan = planTransition({ transition, previous, expected, options, operatorSubject, reason, now: at });
    if (plan.confirmDigest !== confirm) refuse('confirmation digest does not match the current transition (the policy changed or the inputs differ); run the dry run again');
    const verdict = transition === 'enable' ? await verifyEnable(tx, db, plan.next, expected, enableDependencies, at) : null;
    const historyDoc = db.doc(plan.historyRef);
    const existing = await tx.get(historyDoc);
    if (existing.exists) {
      const duplicate = B.validateImmutableDuplicate(plan.historyRef, existing.data(), plan.history, expected).ok;
      refuse(duplicate ? `history ${plan.historyRef} already records this exact transition; nothing written`
        : `a different document already exists at ${plan.historyRef}`);
    }
    tx.set(db.doc(POLICY_PATH), plan.next);
    tx.create(historyDoc, plan.history);
    return Object.freeze({ status: 'committed', transition, historyRef: plan.historyRef, nextGeneration: plan.next.generation,
      previousPolicyDigest: plan.history.previousPolicyDigest, nextPolicyDigest: plan.history.nextPolicyDigest,
      releaseAuthority: verdict ? 'pure S3 checks verified; not A3-2 provenance; not activation' : 'not evaluated',
      ...(verdict ? { dispositions: 'not consulted: a registered supersede or revoke disposition does not block enable; only the pinned revocation list does (D5 R2, S3 O4)' } : {}) });
  });
}

/** Dry run: the plan from the current stored policy. Reads only. */
async function dryRunTransition({ db, expected, transition, options, operatorSubject, reason, now = () => new Date().toISOString(), env = process.env }) {
  assertEmulatorWriteTarget(expected, env);
  assertDatabase(db, expected);
  const snap = await db.doc(POLICY_PATH).get();
  const previous = snap.exists ? snap.data() : null;
  if (previous !== null && !V.validatePolicy(previous, expected).ok) refuse('stored policy is invalid; invalid-policy repair is a separate, separately authorized procedure (D8)');
  return planTransition({ transition, previous, expected, options, operatorSubject, reason, now: now() });
}

/** D8 fix 4: every stored history record, validated at its address, with repeated
 * generations reported. A report never authorizes or blocks anything. */
function reportHistoryRecords(records, expected) {
  const repeated = structural(B.reportRepeatedHistoryGenerations(records, expected), 'history records');
  return Object.freeze({ records: records.length, repeatedGenerations: repeated, authorization: 'none: rollback evidence only' });
}
async function readHistory({ db, expected, env = process.env }) {
  assertEmulatorWriteTarget(expected, env);
  assertDatabase(db, expected);
  const snaps = await db.collection(HISTORY_COLLECTION).get();
  const records = snaps.docs.map(d => ({ ref: `${HISTORY_COLLECTION}/${d.id}`, document: d.data() })).sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  return reportHistoryRecords(records, expected);
}

module.exports = { POLICY_PATH, HISTORY_COLLECTION, TRANSITIONS, timestampAt, planTransition, checkPlan, dryRunTransition,
  executeTransition, reportHistoryRecords, readHistory };
