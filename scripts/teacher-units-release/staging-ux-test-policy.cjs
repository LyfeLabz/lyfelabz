'use strict';

// Staging UX test availability policy (docs/platform/TEACHER_UNITS_STAGING_UX_TEST_DESIGN.md).
// Owner-approved for STAGING human UX testing only; uncertified. Writes exactly one
// document, platformConfig/teacherUnitsAvailability, in lyfelabz-staging and nowhere
// else. It writes no release, evidence, approval, history or audit document.
//
//   node scripts/teacher-units-release/staging-ux-test-policy.cjs show   --project lyfelabz-staging
//   node scripts/teacher-units-release/staging-ux-test-policy.cjs enable --project lyfelabz-staging
//   node scripts/teacher-units-release/staging-ux-test-policy.cjs close  --project lyfelabz-staging
//
// enable is create-only (fails if any policy exists). close is the server-side kill
// switch: enabled marker policy -> closed, release and evidence cleared, generation + 1,
// validated as an A3 shutdown transition. It refuses to touch a non-marker policy.
// Requires `npm --prefix platform/functions run build` and Application Default
// Credentials with Firestore write access to lyfelabz-staging.
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const FUNCTIONS_ROOT = path.resolve(__dirname, '../../platform/functions');
const LIB = path.join(FUNCTIONS_ROOT, 'lib/teacherUnits');
const STAGING = Object.freeze({ environment: 'staging', projectId: 'lyfelabz-staging', projectNumber: '293337283840' });
const POLICY_PATH = 'platformConfig/teacherUnitsAvailability';
const COMMANDS = Object.freeze(['show', 'enable', 'close']);

function refuse(message) { throw new Error(`[staging-ux-test-policy] REFUSED: ${message}`); }
function compiled(name) {
  try { return require(path.join(LIB, name)); }
  catch { return refuse(`compiled module ${name} unavailable; run npm --prefix platform/functions run build`); }
}
// The Functions package's own firebase-admin, so Timestamps match the compiled validators.
function functionsModule(name) { return require(require.resolve(name, { paths: [FUNCTIONS_ROOT] })); }
function modules() {
  return { V: compiled('a3-validation.js'), B: compiled('a3-bindings.js'), K: compiled('a3-canonical.js'),
    M: compiled('a3-staging-ux-test.js'), P: compiled('unit-placeable-resources.js') };
}

/** The only accepted target: the literal staging project, cloud-routed, no disagreeing env. */
function assertStagingTarget(project, env = process.env) {
  if (project !== STAGING.projectId) refuse(`--project must be exactly ${STAGING.projectId}; this tool never targets any other project`);
  if (env.FIRESTORE_EMULATOR_HOST !== undefined) refuse('FIRESTORE_EMULATOR_HOST is set; this tool writes only to cloud staging');
  for (const name of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']) {
    if (env[name] !== undefined && env[name] !== STAGING.projectId) refuse(`${name} disagrees with ${STAGING.projectId}`);
  }
}
function structural(result, description) {
  if (!result.ok) refuse(`${description} invalid at ${result.issue.path}: ${result.issue.reason}`);
  return result.value;
}
function runtimePlacementFingerprint(m) { return m.K.contentDigest([...m.P.UNIT_PLACEABLE_RESOURCE_ID_LIST]); }

/** Pure: the enabled marker policy for a missing document. */
function planEnable({ m, Timestamp, policyInstanceId = randomUUID(), now = new Date() }) {
  const policy = { ...STAGING, schemaVersion: 1, policyInstanceId, region: 'us-central1', databaseId: '(default)',
    mode: 'enabled', generation: 1, backendReleaseEligibility: { releaseId: m.M.STAGING_UX_TEST_RELEASE_ID },
    acceptedClientContractVersions: ['teacher-units-v2'], placementFingerprint: runtimePlacementFingerprint(m),
    activationEvidenceRef: m.M.STAGING_UX_TEST_EVIDENCE_REF, updatedAt: Timestamp.fromDate(now) };
  const valid = structural(m.V.validatePolicy(policy, STAGING), 'staging UX test policy');
  if (!m.M.isStagingUxTestPolicy(valid)) refuse('planned policy does not carry both staging UX test markers');
  return policy;
}

/** Pure: the shutdown of a stored enabled marker policy. Never touches any other policy. */
function planClose({ m, Timestamp, previous, now = new Date() }) {
  const before = structural(m.V.validatePolicy(previous, STAGING), 'stored policy');
  if (!m.M.isStagingUxTestPolicy(before)) refuse('stored policy is not a staging UX test marker policy; it is left untouched');
  if (before.mode !== 'enabled') refuse('stored marker policy is already closed');
  const next = { ...previous, mode: 'closed', generation: before.generation + 1, backendReleaseEligibility: null,
    activationEvidenceRef: null, updatedAt: Timestamp.fromDate(now) };
  structural(m.B.validatePolicyTransition(previous, next, STAGING), 'shutdown transition');
  return next;
}

function display(policy) {
  if (policy === undefined) return '(no policy document)';
  return JSON.stringify(policy, (key, value) => (value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value), 2);
}

/** Cloud Firestore client for lyfelabz-staging (ADC). Refuses an emulator-routed client. */
function stagingFirestore() {
  const { initializeApp, deleteApp } = functionsModule('firebase-admin/app');
  const { getFirestore } = functionsModule('firebase-admin/firestore');
  const app = initializeApp({ projectId: STAGING.projectId }, `staging-ux-test-${randomUUID()}`);
  const db = getFirestore(app);
  let settings;
  try { settings = db._settings; } catch { settings = undefined; }
  if (db.projectId !== STAGING.projectId || (settings && settings.ssl === false)) {
    deleteApp(app); refuse('Firestore client is not bound to cloud lyfelabz-staging');
  }
  return { db, close: () => deleteApp(app) };
}

async function run({ command, project, env = process.env, firestore = stagingFirestore, log = console.log, now = () => new Date() }) {
  if (!COMMANDS.includes(command)) refuse(`command must be one of ${COMMANDS.join(', ')}`);
  assertStagingTarget(project, env);
  const m = modules();
  const { Timestamp } = functionsModule('firebase-admin/firestore');
  const { db, close } = firestore();
  try {
    const ref = db.doc(POLICY_PATH);
    if (command === 'show') {
      const snap = await ref.get();
      log(`[staging-ux-test-policy] ${STAGING.projectId}/${POLICY_PATH}:\n${display(snap.exists ? snap.data() : undefined)}`);
      return { before: snap.exists ? snap.data() : undefined, after: undefined };
    }
    if (command === 'enable') {
      const policy = planEnable({ m, Timestamp, now: now() });
      log(`[staging-ux-test-policy] creating (create-only) ${STAGING.projectId}/${POLICY_PATH}:\n${display(policy)}`);
      await ref.create(policy);
      return { before: undefined, after: policy };
    }
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) refuse('no policy document to close');
      const previous = snap.data();
      const next = planClose({ m, Timestamp, previous, now: now() });
      tx.set(ref, next);
      return { before: previous, after: next };
    });
    log(`[staging-ux-test-policy] closed ${STAGING.projectId}/${POLICY_PATH}\nbefore:\n${display(result.before)}\nafter:\n${display(result.after)}`);
    return result;
  } finally {
    await close();
  }
}

function parse(argv) {
  const [command, ...rest] = argv;
  if (rest.length !== 2 || rest[0] !== '--project') refuse('usage: staging-ux-test-policy.cjs <show|enable|close> --project lyfelabz-staging');
  return { command, project: rest[1] };
}

if (require.main === module) {
  run(parse(process.argv.slice(2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { STAGING, POLICY_PATH, assertStagingTarget, planEnable, planClose, run, parse, modules, functionsModule };
