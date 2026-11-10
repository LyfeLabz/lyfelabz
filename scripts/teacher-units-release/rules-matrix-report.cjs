'use strict';
// Option B Rules evidence generator.
//
// Executes every case in requiredCases() against two Firestore Rules sources on the Firestore
// emulator (the repository Rules and the actual deployed Rules bytes) and records the observed
// outcome of each. Nothing is inferred: a case is "allow" only if the emulator completed the
// operation and "deny" only on a Firestore permission-denied error. Any other failure, any missing
// or surplus case, and any mismatch refuses and writes no report. Differing sources are never
// treated as equivalent here; the owner decides exact vs reviewed-equivalent on the approval.
//
//   firebase emulators:exec --only firestore --project demo-rules \
//     "node ../../scripts/teacher-units-release/rules-matrix-report.cjs --local <rules> --deployed <rules> \
//      --source-review <json> --out <report.json>"        (run from platform/firebase)
//
// The source review is a human claim and is only read from --source-review, never defaulted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const R = require('./option-b-rules-evidence.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');

const REPORT_KIND = 'lyfelabz.teacherUnitsOptionBRulesReport';
const FIREBASE_ROOT = path.resolve(__dirname, '../../platform/firebase');
const OUTCOMES = new Set(['allow', 'deny']);

class MatrixRefusal extends Error { constructor(message, rows) { super(`[rules-matrix] REFUSED: ${message}`); this.rows = rows; } }
const refuse = (message, rows) => { throw new MatrixRefusal(message, rows); };
const keyOf = c => `${c.role}\0${c.resource}\0${c.operation}`;

function utf8Source(value, label) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > 3 * 1024 * 1024 || !Buffer.from(value.toString('utf8'), 'utf8').equals(value)) refuse(`${label}: nonempty bounded UTF-8 Rules bytes required`);
  return { bytesBase64: value.toString('base64'), sha256: K.sha256Bytes(value) };
}
function checkSourceReview(review) {
  const fields = ['fullDiffReviewed', 'unrelatedChanges', 'accessBroadening', 'summary'];
  if (!review || typeof review !== 'object' || Array.isArray(review) || Object.keys(review).length !== fields.length || fields.some(f => !Object.hasOwn(review, f))) refuse('source review must be an owner-supplied record with exactly fullDiffReviewed, unrelatedChanges, accessBroadening and summary');
  if (review.fullDiffReviewed !== true || review.unrelatedChanges !== false || review.accessBroadening !== false) refuse('source review must state a full diff review with no unrelated or access-broadening drift');
  if (typeof review.summary !== 'string' || !review.summary.trim() || review.summary.length > 2000) refuse('source review summary required');
  return { fullDiffReviewed: true, unrelatedChanges: false, accessBroadening: false, summary: review.summary };
}
function checkTool(tool) {
  if (!tool || typeof tool.name !== 'string' || !tool.name || typeof tool.version !== 'string' || !tool.version ||
      !Array.isArray(tool.dependencies) || tool.dependencies.length < 1 ||
      tool.dependencies.some(d => !d || typeof d.name !== 'string' || !d.name || typeof d.version !== 'string' || !d.version)) refuse('observed tool and dependency identities required');
  return { name: tool.name, version: tool.version, dependencies: tool.dependencies.map(d => ({ name: d.name, version: d.version })) };
}

/** execute(rulesText, cases) must resolve to one 'allow' | 'deny' per case, in order. */
async function buildReport({ localBytes, deployedBytes, sourceReview, tool, execute }) {
  const localSource = utf8Source(localBytes, 'local Rules'), deployedSource = utf8Source(deployedBytes, 'deployed Rules');
  const review = checkSourceReview(sourceReview), identity = checkTool(tool);
  if (typeof execute !== 'function') refuse('an executor is required');
  const cases = R.requiredCases();
  if (cases.length !== 252 || new Set(cases.map(keyOf)).size !== cases.length) refuse('required case set is not the expected 252 unique cases');
  const run = async (bytes, label) => {
    let outcomes;
    try { outcomes = await execute(bytes.toString('utf8'), cases); }
    catch (error) { return refuse(`${label} execution failed: ${error && error.message ? error.message : 'unknown error'}`); }
    if (!Array.isArray(outcomes) || outcomes.length !== cases.length) refuse(`${label} execution did not return exactly one outcome per case`);
    if (outcomes.some(o => !OUTCOMES.has(o))) refuse(`${label} execution returned an unrecognised outcome`);
    return outcomes;
  };
  const actualLocal = await run(localBytes, 'local'), actualDeployed = await run(deployedBytes, 'deployed');
  const results = cases.map((c, i) => ({ role: c.role, resource: c.resource, operation: c.operation, expected: c.expected,
    actualLocal: actualLocal[i], actualDeployed: actualDeployed[i],
    result: actualLocal[i] === c.expected && actualDeployed[i] === c.expected ? 'pass' : 'fail' }));
  const failed = results.filter(r => r.result !== 'pass');
  if (failed.length) refuse(`${failed.length} of ${results.length} cases did not match the expected outcome on both sources`, failed);
  const report = { kind: REPORT_KIND, schemaVersion: 1, matrixVersion: R.MATRIX_VERSION, localSource, deployedSource, tool: identity, results, sourceReview: review };
  const bytes = Buffer.from(`${JSON.stringify(report)}\n`, 'utf8'), sha256 = K.sha256Bytes(bytes);
  // Self-check with the existing validator so the output is exactly the accepted schema.
  try { R.validateReport(bytes, { testEvidence: { reportSha256: sha256 }, localRulesSourceHash: localSource.sha256, approvedDeployedSourceHash: deployedSource.sha256 }); }
  catch (error) { refuse(`generated report failed the existing validator: ${error.message}`); }
  return { bytes, sha256, cases: results.length, localSha256: localSource.sha256, deployedSha256: deployedSource.sha256, sourcesIdentical: localSource.sha256 === deployedSource.sha256 };
}

// ---- Emulator executor ----------------------------------------------------
const OWNER = 'teacher-owner-uid', OTHER = 'teacher-other-uid', STUDENT = 'student-uid', OTHER_SCHOOL_TEACHER = 'teacher-other-school-uid', ADMIN = 'platform-admin-uid';
const SCHOOL = 'school-a', OTHER_SCHOOL = 'school-b';
const UNIT = 'unitOwnerAAAAAAAAAAA', AUDIT = 'auditTeacherUnitAAAA', HEX = 'd'.repeat(64), HEX2 = 'e'.repeat(64), HISTORY = '00000000-0000-4000-8000-000000000001';
const ACTORS = {
  unauthenticated: { uid: null, profile: OWNER },
  owner: { uid: OWNER, claims: { role: 'teacher', schoolId: SCHOOL } },
  otherTeacher: { uid: OTHER, claims: { role: 'teacher', schoolId: SCHOOL } },
  otherSchoolTeacher: { uid: OTHER_SCHOOL_TEACHER, claims: { role: 'teacher', schoolId: OTHER_SCHOOL } },
  suspendedOwner: { uid: OWNER, claims: { role: 'teacher', schoolId: SCHOOL }, suspended: true },
  student: { uid: STUDENT, claims: { role: 'student', schoolId: SCHOOL } },
  platformAdministrator: { uid: ADMIN, claims: { role: 'platformAdministrator', schoolId: SCHOOL } },
};
const TARGETS = {
  'teacherUnits': ['teacherUnits', UNIT], 'teacherUnitCreateReceipts': ['teacherUnitCreateReceipts', HEX],
  'platformConfig/teacherUnitsAvailability': ['platformConfig', 'teacherUnitsAvailability'],
  'teacherUnitsAvailabilityHistory': ['teacherUnitsAvailabilityHistory', HISTORY], 'auditEvents': ['auditEvents', AUDIT],
  'terminal-default-deny': ['unmatchedOptionBDefaultDeny', 'probe'],
};
const GROUPS = ['teacherUnits', 'teacherUnitCreateReceipts', 'platformConfig', 'teacherUnitsAvailabilityHistory', 'auditEvents'];

function emulatorExecutor({ root = FIREBASE_ROOT, env = process.env } = {}) {
  const rootRequire = createRequire(path.join(root, 'package.json'));
  const { initializeTestEnvironment } = rootRequire('@firebase/rules-unit-testing');
  const fs_ = rootRequire('firebase/firestore');
  const hostSpec = env.FIRESTORE_EMULATOR_HOST;
  if (!hostSpec) refuse('FIRESTORE_EMULATOR_HOST is required; run under firebase emulators:exec --only firestore');
  const [host, port] = hostSpec.split(':');
  if (!['127.0.0.1', 'localhost'].includes(host) || !/^\d+$/.test(port || '')) refuse('a local Firestore emulator is required');
  const { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } = fs_;
  const classify = async action => {
    try { await action(); return 'allow'; }
    catch (error) {
      if (error && error.code === 'permission-denied') return 'deny';
      throw new Error(`unexpected non-denial failure: ${error && (error.code || error.message) || 'unknown'}`);
    }
  };
  async function seed(testEnv, suspended) {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore(), at = new Date('2026-10-01T00:00:00Z');
      const user = (uid, o = {}) => setDoc(doc(db, 'users', uid), { authUid: uid, status: 'active', role: 'teacher', schoolId: SCHOOL, displayName: 'Teacher', createdAt: at, ...o });
      await user(OWNER, suspended ? { status: 'suspended' } : {}); await user(OTHER); await user(STUDENT, { role: 'student' });
      await user(OTHER_SCHOOL_TEACHER, { schoolId: OTHER_SCHOOL }); await user(ADMIN, { role: 'platformAdministrator' });
      const owned = { teacherId: OWNER, schoolId: SCHOOL };
      await setDoc(doc(db, 'teacherUnits', UNIT), { ...owned, grade: '7', title: 'Earth Systems', description: '', status: 'active', archivedAt: null, createdAt: at, updatedAt: at, resourceIds: [], sortOrder: 0, revision: 1 });
      await setDoc(doc(db, 'teacherUnitCreateReceipts', HEX), { ...owned, unitId: UNIT });
      await setDoc(doc(db, 'auditEvents', AUDIT), { ...owned, actorUid: OWNER, action: 'teacherUnits.created', targetId: UNIT });
      await setDoc(doc(db, 'platformConfig', 'teacherUnitsAvailability'), { schemaVersion: 1, state: 'closed' });
      await setDoc(doc(db, 'teacherUnitsAvailabilityHistory', HISTORY), { schemaVersion: 2, command: 'close', generation: 2, ...owned });
      await setDoc(doc(db, 'unmatchedOptionBDefaultDeny', 'probe'), { serverOnly: true });
    });
  }
  function operation(db, c, actor) {
    if (c.resource === 'existing-own-profile') return () => getDoc(doc(db, 'users', actor.uid ?? actor.profile));
    if (c.resource.startsWith('collection-group:')) {
      const group = c.resource.slice('collection-group:'.length);
      if (!GROUPS.includes(group) || c.operation !== 'list') throw new Error(`unmapped case ${c.resource}/${c.operation}`);
      return () => getDocs(collectionGroup(db, group));
    }
    const target = TARGETS[c.resource];
    if (!target) throw new Error(`unmapped resource ${c.resource}`);
    const col = collection(db, target[0]), ref = doc(col, target[1]), data = { teacherId: OWNER, schoolId: SCHOOL };
    switch (c.operation) {
      case 'get': return () => getDoc(ref);
      case 'list': return () => getDocs(col);
      case 'create': return () => setDoc(doc(col, HEX2), data);
      case 'update': return () => updateDoc(ref, { schoolId: SCHOOL, title: 'x' });
      case 'delete': return () => deleteDoc(ref);
      default: throw new Error(`unmapped operation ${c.operation}`);
    }
  }
  return async function execute(rulesText, cases) {
    const testEnv = await initializeTestEnvironment({ projectId: `lyfelabz-rules-matrix-${crypto.randomBytes(4).toString('hex')}`, firestore: { host, port: Number(port), rules: rulesText } });
    try {
      const outcomes = [];
      for (const c of cases) {
        const actor = ACTORS[c.role];
        if (!actor) throw new Error(`unmapped role ${c.role}`);
        await seed(testEnv, Boolean(actor.suspended));
        const ctx = actor.uid === null ? testEnv.unauthenticatedContext() : testEnv.authenticatedContext(actor.uid, actor.claims);
        outcomes.push(await classify(operation(ctx.firestore(), c, actor)));
      }
      return outcomes;
    } finally { await testEnv.cleanup(); }
  };
}

// ---- Observed tool identity -------------------------------------------------
function observedTool(root = FIREBASE_ROOT) {
  const rootRequire = createRequire(path.join(root, 'package.json'));
  const dependencies = ['@firebase/rules-unit-testing', 'firebase'].map(name => ({ name, version: JSON.parse(fs.readFileSync(rootRequire.resolve(`${name}/package.json`), 'utf8')).version }));
  const cli = execFileSync('firebase', ['--version'], { encoding: 'utf8' }).trim().split('\n').pop().trim();
  dependencies.push({ name: 'firebase-tools', version: cli });
  const cache = path.join(process.env.HOME || '', '.cache/firebase/emulators');
  const jars = fs.existsSync(cache) ? fs.readdirSync(cache).filter(f => /^cloud-firestore-emulator-v[\d.]+\.jar$/.test(f)) : [];
  if (jars.length === 1) dependencies.push({ name: 'cloud-firestore-emulator', version: jars[0].replace(/^cloud-firestore-emulator-v|\.jar$/g, '') });
  dependencies.push({ name: 'node', version: process.versions.node });
  return { name: 'lyfelabz-rules-matrix-report', version: `script-sha256:${K.sha256Bytes(fs.readFileSync(__filename))}`, dependencies };
}

async function main(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) refuse(`malformed arguments near ${argv[i]}`);
    flags[argv[i].slice(2)] = argv[i + 1];
  }
  for (const k of Object.keys(flags)) if (!['local', 'deployed', 'source-review', 'out'].includes(k)) refuse(`unknown flag --${k}`);
  for (const k of ['local', 'deployed', 'source-review', 'out']) if (!flags[k]) refuse(`--${k} is required`);
  if (fs.existsSync(flags.out)) refuse('--out already exists (existing output is never overwritten)');
  let review;
  try { review = JSON.parse(fs.readFileSync(flags['source-review'], 'utf8')); } catch { refuse('--source-review must be readable JSON'); }
  const result = await buildReport({ localBytes: fs.readFileSync(flags.local), deployedBytes: fs.readFileSync(flags.deployed), sourceReview: review, tool: observedTool(), execute: emulatorExecutor() });
  fs.writeFileSync(flags.out, result.bytes, { flag: 'wx', mode: 0o600 });
  return result;
}

module.exports = { MatrixRefusal, buildReport, emulatorExecutor, observedTool, main };

if (require.main === module) {
  main(process.argv.slice(2)).then(r => {
    console.log(JSON.stringify({ cases: r.cases, result: 'all cases pass on both sources', reportSha256: r.sha256, localRulesSha256: r.localSha256, deployedRulesSha256: r.deployedSha256,
      sources: r.sourcesIdentical ? 'identical' : 'DIFFERENT: owner must choose reviewed-equivalent explicitly; this tool does not classify them' }, null, 1));
  }, e => {
    console.error(e.message);
    if (e.rows) for (const r of e.rows.slice(0, 40)) console.error(`  ${r.role} ${r.resource} ${r.operation}: expected ${r.expected} local ${r.actualLocal} deployed ${r.actualDeployed}`);
    process.exit(1);
  });
}
