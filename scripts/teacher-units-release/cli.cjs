#!/usr/bin/env node
'use strict';

// A3-6 S6a operator CLI (D14). Offline validation, unsigned statement preparation,
// history reporting, and EMULATOR-ONLY registration and availability transitions.
//
//   node scripts/teacher-units-release/cli.cjs <command> [subcommand] --project <id> [flags]
//
// Every invocation needs an explicit --project (lyfelabz-prod, lyfelabz-staging, or a
// demo- emulator project). The project is never inferred from the Firebase alias file,
// a default alias or ambient configuration, and conflicting ambient identity refuses.
// Mutating commands (register, policy) are dry runs unless --execute is given with the
// --confirm digest the dry run printed, and they refuse every cloud project, including
// staging and production, before any I/O. The CLI holds no key, never signs, never
// calls KMS and makes no provider request. Nothing it prints is authority.
//
// A3-6 S6c adds `observe plan` (offline), `observe capture` (read-only provider GET
// capture, only with an explicit --live) and `observe verify` (offline replay). The
// capture transport lives in provider-capture.cjs; a capture is never authority.
//
// A3-6 S6d adds `revocation prepare`, `revocation verify` and `revocation rollout-check`:
// offline, read-only, non-authorizing R2 preparation (revocation-procedure.cjs). They
// pin, revoke, shut down, redeploy and delete nothing.
//
// A3-6 S6f adds `observe discover` (a dry run listing the reads unless --live is
// given) and `observe discover-verify` (offline replay): a staging-only,
// non-authorizing discovery that needs no deployment plan (staging-discovery.cjs).
// Discovery output is never certified, deployment or capture evidence.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { PROJECT_NUMBERS } = require('../hosting-release/backend-state.cjs');
const O = require('./provider-observation.cjs');
const AR = require('./access-review.cjs');
const ST = require('./statements.cjs');
const RG = require('./registration.cjs');
const CAS = require('./availability-cas.cjs');
const EP = require('./evidence-package.cjs');
const PC = require('./provider-capture.cjs');
const RV = require('./revocation-procedure.cjs');
const SD = require('./staging-discovery.cjs');

const LIB = path.resolve(__dirname, '../../platform/functions/lib/teacherUnits');
const K = require(path.join(LIB, 'a3-canonical.js'));
const CV = require(path.join(LIB, 'a3-composite-verifier.js'));
const R = require(path.join(LIB, 'a3-authority-registry.js'));
const L = require(path.join(LIB, 'a3-revocation-list.js'));
const { Timestamp } = RG.functionsModule('firebase-admin/firestore');

class Refusal extends Error {}
function refuse(message) { throw new Refusal(`[a3-operator-cli] REFUSED: ${message}`); }

const CLOUD = Object.freeze({ 'lyfelabz-prod': 'production', 'lyfelabz-staging': 'staging' });
const AMBIENT_PROJECT = Object.freeze(['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']);
const EMULATOR_VARIABLES = Object.freeze(['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FUNCTIONS_EMULATOR']);

// A3-6 S6b evidence inputs (files). Statement bytes are the exact canonical bytes.
const RELEASE_FLAGS = Object.freeze(['plan', 'plan-object', 'expected', 'expected-object', 'approval', 'approval-statement', 'observation',
  'receipt', 'receipt-object', 'evaluated-at']);
const PACKAGE_FLAGS = Object.freeze(['certification', 'certification-statement', 'certification-report', 'activation-approval',
  'activation-approval-statement', 'activation-evidence', 'registry', 'revocations']);

// A3-6 S6c capture inputs (files): the S4 plan and S5 expected access, bytes and objects.
const OBSERVE_FLAGS = Object.freeze(['plan', 'plan-object', 'expected', 'expected-object']);

// A3-6 S6d revocation inputs (files). Releases and known dispositions are JSON lists.
const REVOCATION_FLAGS = Object.freeze(['disposition', 'disposition-statement', 'target', 'replacement', 'dispositions', 'releases', 'registry', 'revocations']);

// command -> allowed flags (value flags and boolean flags). --project is always required.
// Only mutating commands accept --execute and --confirm; any other command refuses them.
const COMMANDS = Object.freeze({
  'validate plan': { values: ['plan', 'plan-object'], cloudOnly: true },
  'validate expected-access': { values: ['expected', 'expected-object'], cloudOnly: true },
  'validate chain': { values: ['chain', 'registry', 'revocations', 'local-profile'] },
  'statement prepare': { values: ['kind', 'fields', 'authority-id', 'approver-subject', 'decision-id', 'out-dir'] },
  'statement assemble': { values: ['statement', 'bucket', 'object', 'generation', 'signer-key-id', 'signature', 'out'] },
  'activation-evidence prepare': { values: ['approval', 'out'] },
  'history report': { values: ['records'] },
  'register': { values: ['document', 'statement-bytes', 'registry', 'revocations', 'local-profile', 'confirm'], booleans: ['execute'], mutates: true },
  'policy initialize': { values: ['policy-instance-id', 'placement-fingerprint', 'operator-subject', 'reason', 'confirm'], booleans: ['execute'], mutates: true },
  'policy prepare': { values: ['release-id', 'placement-fingerprint', 'operator-subject', 'reason', 'confirm'], booleans: ['execute'], mutates: true },
  'policy enable': { values: ['activation-evidence', 'registry', 'revocations', 'local-profile', 'operator-subject', 'reason', 'confirm'], booleans: ['execute'], mutates: true },
  'policy shutdown': { values: ['operator-subject', 'reason', 'confirm'], booleans: ['execute', 'clear-release', 'keep-release'], mutates: true },
  // A3-6 S6b: offline, read-only, non-authorizing evidence assembly. No --execute.
  'release assemble': { values: [...RELEASE_FLAGS, 'out'], cloudOnly: true },
  'package assemble': { values: [...RELEASE_FLAGS, ...PACKAGE_FLAGS, 'out'], cloudOnly: true },
  'package verify': { values: [...RELEASE_FLAGS.filter(f => f !== 'evaluated-at'), ...PACKAGE_FLAGS, 'package'], cloudOnly: true },
  // A3-6 S6c: read-only provider observation. No --execute or --confirm; capture needs --live.
  'observe plan': { values: [], cloudOnly: true },
  'observe capture': { values: [...OBSERVE_FLAGS, 'principal', 'out'], booleans: ['live'], cloudOnly: true },
  'observe verify': { values: [...OBSERVE_FLAGS, 'capture'], cloudOnly: true },
  // A3-6 S6d: offline, read-only, non-authorizing revocation preparation. No --execute.
  'revocation prepare': { values: [...REVOCATION_FLAGS, 'out'], cloudOnly: true },
  'revocation verify': { values: [...REVOCATION_FLAGS, 'revocation-plan'], cloudOnly: true },
  'revocation rollout-check': { values: [...REVOCATION_FLAGS, ...OBSERVE_FLAGS, 'revocation-plan', 'capture', 'out'], cloudOnly: true },
  // A3-6 S6f: staging-only, non-authorizing discovery. No --execute or --confirm; requests need --live.
  'observe discover': { values: ['principal', 'out'], booleans: ['live'], cloudOnly: true, stagingOnly: true },
  'observe discover-verify': { values: ['discovery'], cloudOnly: true, stagingOnly: true },
});

function parse(argv) {
  if (!Array.isArray(argv) || argv.length < 2) refuse('usage: <command> <subcommand> --project <id> [flags]');
  const name = argv.slice(0, 2).join(' ');
  const two = Object.hasOwn(COMMANDS, name);
  const command = two ? name : argv[0];
  if (!Object.hasOwn(COMMANDS, command)) refuse(`unknown command: ${name}`);
  const spec = COMMANDS[command], flags = {}, rest = argv.slice(two ? 2 : 1);
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (typeof token !== 'string' || !token.startsWith('--') || token.includes('=')) refuse(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (Object.hasOwn(flags, key)) refuse(`--${key} given more than once`);
    if ((spec.booleans || []).includes(key)) { flags[key] = true; continue; }
    if (key !== 'project' && !spec.values.includes(key)) refuse(`--${key} is not accepted by ${command}`);
    const value = rest[++i];
    if (typeof value !== 'string' || value.startsWith('--') || value === '') refuse(`--${key} requires a value`);
    flags[key] = value;
  }
  return { command, spec, flags };
}

/** Explicit project only. Ambient configuration may agree with it or be absent;
 * anything else is ambiguous and refuses. */
function resolveTarget(project, env) {
  if (typeof project !== 'string') refuse('an explicit --project is required; it is never inferred');
  for (const name of AMBIENT_PROJECT) if (env[name] !== undefined && env[name] !== project) refuse(`ambiguous project: ${name} disagrees with --project`);
  if (env.FIREBASE_CONFIG !== undefined) {
    let config;
    try { config = K.parseStrictJSON(env.FIREBASE_CONFIG); } catch { refuse('ambiguous project: FIREBASE_CONFIG is not strict JSON'); }
    if (!config || typeof config !== 'object' || config.projectId !== project) refuse('ambiguous project: FIREBASE_CONFIG disagrees with --project');
  }
  if (Object.hasOwn(CLOUD, project)) {
    const present = EMULATOR_VARIABLES.filter(name => env[name] !== undefined);
    if (present.length) refuse(`ambiguous environment: ${present.join(', ')} set for cloud project ${project}`);
    return Object.freeze({ project, cloud: true, expected: { environment: CLOUD[project], projectId: project, projectNumber: PROJECT_NUMBERS[project] } });
  }
  if (!RG.DEMO_PROJECT.test(project)) refuse('unsupported --project: lyfelabz-prod, lyfelabz-staging or a demo- emulator project');
  if (env.FIRESTORE_EMULATOR_HOST !== undefined && !RG.LOOPBACK_HOST.test(env.FIRESTORE_EMULATOR_HOST)) refuse('ambiguous environment: FIRESTORE_EMULATOR_HOST is not a loopback address');
  return Object.freeze({ project, cloud: false, expected: { environment: 'emulator', projectId: project, projectNumber: '0' } });
}

function reader(cwd) {
  const file = (value, flag) => {
    if (typeof value !== 'string') refuse(`--${flag} is required`);
    try { return fs.readFileSync(path.resolve(cwd, value)); } catch { return refuse(`--${flag} file is unreadable`); }
  };
  const json = (value, flag) => { try { return K.parseStrictJSON(file(value, flag).toString('utf8')); } catch (e) { if (e instanceof Refusal) throw e; return refuse(`--${flag} is not strict JSON`); } };
  return { file, json };
}
function writeNew(cwd, value, flag, bytes) {
  if (typeof value !== 'string') refuse(`--${flag} is required`);
  try { fs.writeFileSync(path.resolve(cwd, value), bytes, { flag: 'wx' }); } catch { refuse(`--${flag} could not be created (existing files are never overwritten)`); }
}
function required(flags, key) { if (typeof flags[key] !== 'string') refuse(`--${key} is required`); return flags[key]; }

function withLocalProfile(target, flags, io) {
  if (flags['local-profile'] === undefined) return target.expected;
  if (target.cloud) refuse('--local-profile applies only to emulator projects');
  return { ...target.expected, localProfile: io.json(flags['local-profile'], 'local-profile') };
}
/** Production uses the pinned (empty) registry and list; staging has no pinned registry;
 * an emulator project takes explicit files, which can never name a cloud identity. */
function authorityFor(target, flags, io) {
  if (target.expected.environment === 'production') {
    if (flags.registry !== undefined || flags.revocations !== undefined) refuse('production uses only the artifact-pinned registry and revocation list');
    return { registry: R.PRODUCTION_AUTHORITY_REGISTRY, revocationList: L.PRODUCTION_REVOCATION_LIST };
  }
  if (target.expected.environment === 'staging') refuse('no artifact-pinned staging authority registry exists');
  const registry = R.createAuthorityRegistry(io.json(required(flags, 'registry'), 'registry'));
  if (!registry.ok) refuse(`registry invalid at ${registry.issue.path}: ${registry.issue.reason}`);
  const identity = { environment: 'emulator', projectId: target.project, projectNumber: '0' };
  const list = L.createRevocationList(io.json(required(flags, 'revocations'), 'revocations'), identity);
  if (!list.ok) refuse(`revocation list invalid at ${list.issue.path}: ${list.issue.reason}`);
  return { registry: registry.value, revocationList: list.value };
}
// Chain files use the fixture codec {seconds, nanoseconds} for the policy timestamp.
function hydratePolicy(policy) {
  const t = policy?.updatedAt;
  if (!t || typeof t !== 'object' || Object.keys(t).sort().join() !== 'nanoseconds,seconds') refuse('chain policy updatedAt must be {seconds, nanoseconds}');
  try { return { ...policy, updatedAt: new Timestamp(t.seconds, t.nanoseconds) }; } catch { return refuse('chain policy updatedAt is out of range'); }
}
function printable(value) {
  return JSON.parse(JSON.stringify(value, (key, v) => {
    if (v instanceof Timestamp) return { seconds: v.seconds, nanoseconds: v.nanoseconds };
    if (v && v.type === 'Buffer' && Array.isArray(v.data)) return undefined;
    return typeof v === 'function' ? undefined : v;
  }));
}

async function withEmulator(target, env, run) {
  const { db, close } = RG.emulatorFirestore(target.expected, env);
  try { return await run(db); } finally { await close(); }
}

/** S6b inputs from files. Optional components are absent unless their flag is given;
 * a partial signed component (document without statement bytes) refuses. */
function evidenceInputs(target, flags, io, { verify = false } = {}) {
  const pair = (doc, bytes, d) => {
    if ((flags[doc] === undefined) !== (flags[bytes] === undefined)) refuse(`--${doc} and --${bytes} must be given together (${d})`);
    return flags[doc] === undefined ? undefined : { document: io.json(flags[doc], doc), statementBytes: io.file(flags[bytes], bytes) };
  };
  const inputs = { project: target.project,
    plan: { object: io.json(required(flags, 'plan-object'), 'plan-object'), bytes: io.file(required(flags, 'plan'), 'plan') },
    expected: { object: io.json(required(flags, 'expected-object'), 'expected-object'), bytes: io.file(required(flags, 'expected'), 'expected') },
    deploymentApproval: pair('approval', 'approval-statement', 'deployment approval') || refuse('--approval and --approval-statement are required'),
    observation: io.json(required(flags, 'observation'), 'observation'),
    receipt: { object: io.json(required(flags, 'receipt-object'), 'receipt-object'), bytes: io.file(required(flags, 'receipt'), 'receipt') } };
  if (!verify && flags['evaluated-at'] !== undefined) inputs.evaluatedAt = flags['evaluated-at'];
  const certification = pair('certification', 'certification-statement', 'certification');
  if (certification) inputs.certification = flags['certification-report'] === undefined ? certification : { ...certification, reportBytes: io.file(flags['certification-report'], 'certification-report') };
  else if (flags['certification-report'] !== undefined) refuse('--certification-report requires --certification');
  const activation = pair('activation-approval', 'activation-approval-statement', 'activation approval');
  if (activation) inputs.activationApproval = activation;
  if (flags['activation-evidence'] !== undefined) inputs.activationEvidence = io.json(flags['activation-evidence'], 'activation-evidence');
  if ((flags.registry === undefined) !== (flags.revocations === undefined)) refuse('--registry and --revocations must be given together');
  if (flags.registry !== undefined) inputs.authority = { registryEntries: io.json(flags.registry, 'registry'), revocationEntries: io.json(flags.revocations, 'revocations') };
  return inputs;
}

/** S6c plan and expected-access inputs, read and hash-checked before any request. */
function observeInputs(flags, io) {
  return { deploymentPlan: { object: io.json(required(flags, 'plan-object'), 'plan-object'), bytes: io.file(required(flags, 'plan'), 'plan') },
    expected: { object: io.json(required(flags, 'expected-object'), 'expected-object'), bytes: io.file(required(flags, 'expected'), 'expected') } };
}

/** S6d plan inputs from files. Synthetic test authority is a registry and revocation pair. */
function revocationInputs(target, flags, io) {
  const list = (flag, d) => { const v = io.json(required(flags, flag), flag); if (!Array.isArray(v)) refuse(`--${flag} must be a JSON list of ${d}`); return v; };
  const inputs = { project: target.project,
    disposition: { document: io.json(required(flags, 'disposition'), 'disposition'), statementBytes: io.file(required(flags, 'disposition-statement'), 'disposition-statement') },
    target: io.json(required(flags, 'target'), 'target'), knownDispositions: list('dispositions', 'known disposition documents'),
    revokedReleases: list('releases', 'revoked backend release documents') };
  if (flags.replacement !== undefined) inputs.replacement = io.json(flags.replacement, 'replacement');
  if ((flags.registry === undefined) !== (flags.revocations === undefined)) refuse('--registry and --revocations must be given together');
  if (flags.registry !== undefined) inputs.authority = { registryEntries: io.json(flags.registry, 'registry'), revocationEntries: io.json(flags.revocations, 'revocations') };
  return inputs;
}

async function run({ command, flags }, target, ctx) {
  const io = reader(ctx.cwd), now = ctx.now;
  switch (command) {
    case 'validate plan': {
      O.readPlan(io.json(required(flags, 'plan-object'), 'plan-object'), io.file(required(flags, 'plan'), 'plan'), target.project);
      return { valid: true, scope: 'structure-only deployment plan; not observed, not approved' };
    }
    case 'validate expected-access': {
      AR.readExpectedAccess(io.json(required(flags, 'expected-object'), 'expected-object'), io.file(required(flags, 'expected'), 'expected'), target.project);
      return { valid: true, scope: 'structure-only expected-access plan; not observed, not approved' };
    }
    case 'validate chain': {
      const expected = withLocalProfile(target, flags, io);
      const deps = authorityFor(target, flags, io);
      const chain = io.json(required(flags, 'chain'), 'chain');
      if (!chain || typeof chain !== 'object') refuse('chain must be an object');
      const verdict = CV.verifyReleaseAuthorityChain({ ...chain, identity: expected, policy: hydratePolicy(chain.policy) }, deps);
      if (verdict.verdict !== 'verified') refuse(`release authority chain unverified: ${verdict.reason}`);
      return { verdict, scope: 'pure S3 checks only; not A3-2 provenance, not provider eligibility, not authorization' };
    }
    case 'statement prepare': {
      const prepared = ST.prepareStatement({ kind: required(flags, 'kind'), expected: target.expected, fields: io.json(required(flags, 'fields'), 'fields'),
        authority: { authorityId: required(flags, 'authority-id'), approverSubject: required(flags, 'approver-subject'), decisionId: required(flags, 'decision-id') },
        runId: ctx.workflowRunId, now: new Date(now()) });
      const dir = required(flags, 'out-dir');
      writeNew(ctx.cwd, path.join(dir, 'statement.json'), 'out-dir', prepared.statementBytes);
      writeNew(ctx.cwd, path.join(dir, 'signing-bytes.bin'), 'out-dir', prepared.signingBytes);
      return { statementSha256: prepared.statementSha256, signingBytesSha256: prepared.signingBytesSha256,
        authority: prepared.authority, signing: 'not performed: a human signs signing-bytes.bin outside this tool' };
    }
    case 'statement assemble': {
      const assembled = ST.assembleSignedDocument({ statementBytes: io.file(required(flags, 'statement'), 'statement'),
        statementObject: { bucket: required(flags, 'bucket'), object: required(flags, 'object'), generation: required(flags, 'generation') },
        signerKeyId: required(flags, 'signer-key-id'), signatureBase64: required(flags, 'signature'), expected: target.expected });
      writeNew(ctx.cwd, required(flags, 'out'), 'out', `${K.canonicalJSON(assembled.document)}\n`);
      return { ref: assembled.ref, signatureVerification: assembled.signatureVerification };
    }
    case 'activation-evidence prepare': {
      const approval = io.json(required(flags, 'approval'), 'approval');
      const prepared = ST.prepareActivationEvidence({ approvalRef: K.evidenceRef(approval?.payload), approval, expected: target.expected });
      writeNew(ctx.cwd, required(flags, 'out'), 'out', `${K.canonicalJSON(prepared.document)}\n`);
      return { ref: prepared.ref, authority: 'none: unsigned activation evidence' };
    }
    case 'history report': {
      if (flags.records !== undefined) return CAS.reportHistoryRecords(io.json(flags.records, 'records'), target.expected);
      if (target.cloud) refuse('history report reads only an emulator; pass --records <export> for offline review');
      return withEmulator(target, ctx.env, db => CAS.readHistory({ db, expected: target.expected, env: ctx.env }));
    }
    case 'release assemble': {
      const inputs = evidenceInputs(target, flags, io);
      for (const key of ['certification', 'activationApproval', 'activationEvidence', 'authority']) if (inputs[key] !== undefined) refuse('release assemble takes only release inputs');
      const release = EP.assembleRelease(inputs);
      writeNew(ctx.cwd, required(flags, 'out'), 'out', release.bytes);
      return { ref: release.ref, releaseId: release.releaseId, evaluatedAt: release.evaluatedAt, authorization: release.authorization };
    }
    case 'package assemble': {
      const assembled = EP.assembleEvidencePackage({ ...evidenceInputs(target, flags, io), assembledAt: now() });
      writeNew(ctx.cwd, required(flags, 'out'), 'out', assembled.bytes);
      return { sha256: assembled.sha256, release: { ref: assembled.release.ref, releaseId: assembled.release.releaseId },
        evidenceClass: assembled.package.evidenceClass, checks: assembled.package.checks.map(c => `${c.check}: ${c.status}`),
        providerVerified: false, releaseAuthorized: false, activationReady: false, authorization: assembled.authorization };
    }
    case 'package verify': {
      const verified = EP.verifyEvidencePackage(io.file(required(flags, 'package'), 'package'), evidenceInputs(target, flags, io, { verify: true }));
      return { verified: true, sha256: verified.sha256, scope: verified.scope, authorization: verified.authorization };
    }
    case 'observe plan':
      return PC.capturePlan(target.project);
    case 'observe capture': {
      if (flags.live !== true) refuse('observe capture makes provider requests only with an explicit --live; use observe plan to see the reads');
      const out = path.resolve(ctx.cwd, required(flags, 'out'));
      if (fs.existsSync(out)) refuse('--out already exists (existing output is never overwritten)');
      const capture = { project: target.project, ...observeInputs(flags, io), evidenceClass: 'operator-captured-unattested', principal: flags.principal };
      PC.checkCaptureInputs({ ...capture, hostingRoot: ctx.hostingRoot });
      // Only now, after every local check, is a credential obtained. A failed read refuses; nothing falls back.
      const exchange = ctx.exchange || PC.createLiveExchange({ token: PC.liveAccessToken() });
      const captured = await PC.captureA3Provider({ ...capture, exchange, clock: now, hostingRoot: ctx.hostingRoot });
      try { fs.mkdirSync(out); } catch { refuse('--out could not be created (existing output is never overwritten)'); }
      for (const [key, file] of Object.entries(PC.FILES)) writeNew(out, file, 'out', captured.bytes[key]);
      return { out: flags.out, bundleSha256: createHash('sha256').update(captured.bytes.bundle).digest('hex'),
        evidenceClass: captured.bundle.evidenceClass, window: captured.bundle.window, reads: captured.bundle.reads, surfaces: captured.bundle.surfaces,
        providerVerified: false, releaseAuthorized: false, activationReady: false, freshness: captured.bundle.freshness, authorization: captured.bundle.authority };
    }
    case 'observe verify': {
      const dir = required(flags, 'capture');
      const files = Object.fromEntries(Object.entries(PC.FILES).map(([key, file]) => [key, io.file(path.join(dir, file), 'capture')]));
      return PC.verifyCapture({ project: target.project, files, ...observeInputs(flags, io), hostingRoot: ctx.hostingRoot });
    }
    case 'observe discover': {
      SD.stagingOnly(target.project);
      if (flags.live !== true) {
        if (flags.out !== undefined || flags.principal !== undefined) refuse('--out and --principal apply only with --live; without --live observe discover is a dry run');
        return { dryRun: true, plan: SD.discoveryPlan(target.project) };
      }
      // Every local check precedes the credential: output location, then the principal.
      const out = SD.prepareOutput(required(flags, 'out'), { cwd: ctx.cwd });
      if (flags.principal !== undefined && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]+$/.test(flags.principal)) refuse('--principal must be a lowercase account email (an operator declaration, never verified)');
      // The token is passed to discovery only so that a provider echo of it is removed before recording.
      const token = ctx.exchange ? undefined : PC.liveAccessToken();
      const exchange = ctx.exchange || PC.createLiveExchange({ token });
      let discovered;
      try {
        discovered = await SD.discover({ project: target.project, exchange, clock: now, evidenceClass: 'operator-discovered-unattested', principal: flags.principal, activeCredential: token });
        SD.writeOutput(out, discovered.bytes);
      } catch (error) { throw new Refusal(SD.redactText(error && error.message ? error.message : 'unexpected failure', token)); }
      const b = discovered.bundle;
      return { out: flags.out, bundleSha256: createHash('sha256').update(discovered.bytes.bundle).digest('hex'), evidenceClass: b.evidenceClass, window: b.window,
        termination: b.termination, summary: b.summary, ...SD.CLAIMS, gates: b.gates, authorization: b.authority,
        sensitivity: 'the transcript may hold environment values, source archives and IAM data; it is not printed' };
    }
    case 'observe discover-verify':
      SD.stagingOnly(target.project);
      return SD.verifyDiscovery({ project: target.project, files: SD.readOutput(required(flags, 'discovery'), { cwd: ctx.cwd }) });
    case 'revocation prepare': {
      const prepared = RV.prepareRevocationPlan({ ...revocationInputs(target, flags, io), preparedAt: now() });
      writeNew(ctx.cwd, required(flags, 'out'), 'out', prepared.bytes);
      const p = prepared.plan;
      return { sha256: prepared.sha256, planClass: p.planClass, disposition: p.disposition, proposedPin: p.proposed.pin,
        checks: p.checks.map(c => `${c.check}: ${c.status}`), procedure: p.procedure, revocationEffective: false, releaseAuthorized: false,
        activationReady: false, authorization: prepared.authorization };
    }
    case 'revocation verify': {
      const verified = RV.verifyRevocationPlan(io.file(required(flags, 'revocation-plan'), 'revocation-plan'), revocationInputs(target, flags, io), now());
      return { verified: true, verification: verified.verification, currentFreshness: verified.currentFreshness, sha256: verified.sha256,
        planClass: verified.planClass, scope: verified.scope, revocationEffective: false,
        releaseAuthorized: false, activationReady: false, authorization: verified.authorization };
    }
    case 'revocation rollout-check': {
      const dir = required(flags, 'capture');
      const capture = Object.fromEntries(Object.entries(PC.FILES).map(([key, file]) => [key, io.file(path.join(dir, file), 'capture')]));
      const checked = await RV.checkRollout({ project: target.project, planBytes: io.file(required(flags, 'revocation-plan'), 'revocation-plan'),
        planInputs: revocationInputs(target, flags, io), now: now(), capture, ...observeInputs(flags, io), ...(ctx.hostingRoot === undefined ? {} : { hostingRoot: ctx.hostingRoot }) });
      writeNew(ctx.cwd, required(flags, 'out'), 'out', checked.bytes);
      const r = checked.report;
      return { sha256: checked.sha256, planVerification: r.planVerification, currentFreshness: r.currentFreshness,
        rolloutComparison: r.rolloutComparison, findings: r.findings, evidenceClass: r.evidenceClass,
        deployedRevocationList: r.deployedRevocationList, providerOrigin: r.providerOrigin, oldRevisionsDeleted: r.oldRevisionsDeleted,
        revocationComplete: false, revocationEffective: false, releaseAuthorized: false, activationReady: false, authorization: checked.authorization };
    }
    case 'register': {
      const expected = withLocalProfile(target, flags, io);
      const deps = authorityFor(target, flags, io);
      const inputs = { document: io.json(required(flags, 'document'), 'document'), expected, registry: deps.registry, revocationList: deps.revocationList,
        statementBytes: flags['statement-bytes'] === undefined ? undefined : io.file(flags['statement-bytes'], 'statement-bytes') };
      if (!flags.execute) {
        const prepared = RG.prepareRegistration({ ...inputs, now: now() });
        return { dryRun: true, ref: prepared.ref, kind: prepared.kind, confirm: prepared.confirmDigest, intent: prepared.intent,
          ...(prepared.kind === 'teacher-units-approval-disposition' ? { effect: RG.DISPOSITION_EFFECT } : {}) };
      }
      // The writer rebuilds and re-verifies everything per transaction attempt.
      return withEmulator(target, ctx.env, db => RG.register({ db, ...inputs, confirm: flags.confirm, now, env: ctx.env }));
    }
    default: {
      const transition = command.slice('policy '.length);
      const expected = transition === 'enable' ? withLocalProfile(target, flags, io) : target.expected;
      const options = {};
      if (transition === 'initialize') Object.assign(options, { policyInstanceId: flags['policy-instance-id'], placementFingerprint: flags['placement-fingerprint'] });
      if (transition === 'prepare') {
        const id = required(flags, 'release-id');
        Object.assign(options, { releaseId: id === 'none' ? null : id }, flags['placement-fingerprint'] === undefined ? {} : { placementFingerprint: flags['placement-fingerprint'] });
      }
      if (transition === 'enable') options.activationEvidenceRef = required(flags, 'activation-evidence');
      if (transition === 'shutdown') {
        if (Boolean(flags['clear-release']) === Boolean(flags['keep-release'])) refuse('shutdown requires exactly one of --clear-release or --keep-release');
        options.clearRelease = Boolean(flags['clear-release']);
      }
      const common = { expected, transition, options, operatorSubject: flags['operator-subject'], reason: flags.reason, now, env: ctx.env };
      if (!flags.execute) {
        const plan = await withEmulator(target, ctx.env, db => CAS.dryRunTransition({ db, ...common }));
        return { dryRun: true, transition, confirm: plan.confirmDigest, intent: plan.intent, historyPreview: plan.history,
          note: 'the history address and updatedAt are fixed when --execute runs; the confirmation binds everything else' };
      }
      const enableDependencies = transition === 'enable' ? authorityFor(target, flags, io) : undefined;
      return withEmulator(target, ctx.env, db => CAS.executeTransition({ db, ...common, confirm: flags.confirm, enableDependencies }));
    }
  }
}

/** Returns the exit code. `ctx` is injectable for tests; defaults are the process. */
async function main(argv, ctx = {}) {
  const context = { env: ctx.env || process.env, cwd: ctx.cwd || process.cwd(), stdout: ctx.stdout || process.stdout,
    stderr: ctx.stderr || process.stderr, now: ctx.now || (() => new Date().toISOString()), workflowRunId: ctx.workflowRunId || randomUUID(),
    exchange: ctx.exchange, hostingRoot: ctx.hostingRoot };
  try {
    const parsed = parse(argv);
    if (parsed.spec.mutates && Boolean(parsed.flags.execute) !== (parsed.flags.confirm !== undefined)) refuse('--execute and --confirm <digest> must be given together');
    const target = resolveTarget(parsed.flags.project, context.env);
    if (parsed.spec.mutates && target.cloud) refuse(`${parsed.command} is emulator-only in S6a; staging and production writes are not implemented`);
    if (parsed.spec.cloudOnly && !target.cloud) refuse(`${parsed.command} applies only to lyfelabz-staging or lyfelabz-prod`);
    if (parsed.spec.stagingOnly && target.project !== 'lyfelabz-staging') refuse(`${parsed.command} applies only to lyfelabz-staging; production is never a discovery target`);
    const result = await run(parsed, target, context);
    context.stdout.write(`${JSON.stringify(printable({ command: parsed.command, project: target.project, workflowRunId: context.workflowRunId,
      approvalSystemId: ST.APPROVAL_SYSTEM_ID, result }), null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error && typeof error.message === 'string' && /REFUSED/.test(error.message) ? error.message : `[a3-operator-cli] REFUSED: ${error && error.message ? error.message : 'unexpected failure'}`;
    context.stderr.write(`${message}\n`);
    return 1;
  }
}

module.exports = { COMMANDS, parse, resolveTarget, main };
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; });
