'use strict';

// A3-6 S6d: offline R2 revocation and supersede preparation. NON-AUTHORIZING.
//
// Under D5 R2 a signed disposition is an audit record only. Nothing revokes an
// approval or certification except a pinned revocation-list entry shipped by an
// artifact-changing redeploy of all nine endpoints, observed on every endpoint, with
// the old revisions deleted by a human afterwards. This module prepares and checks
// offline evidence for that later human procedure and performs none of it:
//
//   prepareRevocationPlan   disposition + target (+ replacement) + every known
//                           disposition + the releases it affects + the base list
//                           -> a candidate plan naming the proposed next pinned list
//   verifyRevocationPlan    re-derives the plan from the same inputs, byte for byte,
//                           against the CURRENT base list and clock (stale refuses)
//   checkRollout            replays an S6c capture (unchanged S6c code) and compares
//                           what serves with the revoked releases
//
// A supersede disposition alone has no runtime effect (owner decision S6d-D1): the
// plan for a supersede proposes pinning its target, exactly as for a revoke. Neither
// a plan nor a rollout report pins, revokes, authorizes or completes anything; their
// fixed literals say so and the schema admits no other value.
//
// Pure and offline apart from reading the pinned revocation-list source file to
// fingerprint it: no network, no Firestore, no Storage, no key, no signing, no
// clock (every instant is an explicit argument). Not part of the deployed Functions
// payload and not reachable from index.ts.
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_NUMBERS } = require('../hosting-release/backend-state.cjs');
const O = require('./provider-observation.cjs');
const ST = require('./statements.cjs');
const FR = require('./freshness.cjs');
const PC = require('./provider-capture.cjs');

const LIB = path.resolve(__dirname, '../../platform/functions/lib/teacherUnits');
function compiled(name) {
  try { return require(path.join(LIB, name)); }
  catch { return refuse(`compiled A3 module ${name} unavailable; run npm --prefix platform/functions run build`); }
}
function refuse(message) { throw new Error(`[a3-revocation] REFUSED: ${message}`); }
const K = compiled('a3-canonical.js');
const V = compiled('a3-validation.js');
const B = compiled('a3-bindings.js');
const SG = compiled('a3-signature.js');
const R = compiled('a3-authority-registry.js');
const L = compiled('a3-revocation-list.js');
// The source of the pinned production list; its SHA-256 is recorded so a plan names
// the exact list source it was prepared against.
const LIST_SOURCE = path.resolve(__dirname, '../../platform/functions/src/teacherUnits/a3-revocation-list.ts');

const PLAN_KIND = 'lyfelabz.teacherUnitsA3RevocationPlan';
const ROLLOUT_KIND = 'lyfelabz.teacherUnitsA3RevocationRolloutReport';
const AUTHORIZATION = 'none: candidate revocation plan; not a revocation, pin, approval, registration, deployment or activation';
const ROLLOUT_AUTHORIZATION = 'none: offline rollout comparison; not a revocation, approval, registration, deployment or activation';
const ENVIRONMENTS = Object.freeze({ 'lyfelabz-prod': 'production', 'lyfelabz-staging': 'staging' });
const DISPOSITION_KIND = 'teacher-units-approval-disposition';
const TARGET_VALIDATORS = Object.freeze({
  'teacher-units-deployment-approval': V.validateDeploymentApproval,
  'teacher-units-activation-approval': V.validateActivationApproval,
  'teacher-units-release-certification': V.validateReleaseCertification,
});
const AUTHORITY_SOURCES = Object.freeze({
  pinned: 'pinned-production-registry',
  pinnedEmpty: 'pinned-production-registry: empty (unconfigured); no signature can be verified',
  synthetic: 'synthetic-test-authority: caller-supplied, never pinned; offline testing only',
});
const PLAN_CLASSES = Object.freeze({
  pinned: 'pinned-authority-draft',
  unverifiable: 'unverifiable-draft: the disposition signature could not be verified',
  synthetic: 'synthetic-draft: synthetic test authority; never a production or staging plan',
});
const BASE_SOURCES = Object.freeze({
  pinned: 'artifact-pinned PRODUCTION_REVOCATION_LIST (compiled)',
  synthetic: 'synthetic test revocation entries: caller-supplied, never pinned',
});
const EFFECT = Object.freeze({
  revoke: 'none at runtime: a revoke disposition is an audit record only; its target is refused only after the proposed list is pinned and shipped by the R2 redeploy',
  supersede: 'none at runtime: a supersede disposition is an audit record only and does not revoke its target (S6d-D1); this plan therefore proposes pinning the target, which takes effect only after the R2 redeploy',
});
// The canonical R2 human procedure (D5 R2 and its three procedure requirements).
// Descriptive only: S6d executes none of it.
const PROCEDURE = Object.freeze([
  '1. Validate the disposition: signature against the pinned authority, freshness, binding, conflicts (this plan, then revocation verify).',
  '2. Shut down Teacher Units (policy shutdown; separately authorized).',
  '3. Redeploy all nine endpoints with the changed pinned revocation-list artifact; never an identical rebuild (separately authorized).',
  '4. Independently observe the changed artifact serving on all nine endpoints with 100% traffic (S6c capture, then revocation rollout-check).',
  '5. The human operator deletes the old revisions; rollback to a pre-revocation revision is prohibited.',
]);
const PROCEDURE_STATUS = 'descriptive only: S6d executed none of these steps';
const UNRESOLVED = Object.freeze([
  'D9: dispositions, approvals and releases are operator-supplied files; completeness of the known disposition set is not established',
  'S6d: the proposed list is not pinned; editing PRODUCTION_REVOCATION_LIST is a separately authorized code change',
  'S6d-D3: registry key removal is deferred and not planned here',
  'S6e: no staging or production signing, registration, shutdown, redeploy or revision deletion has been performed',
  'A3-7: integrated certification not performed',
]);
const STATUSES = Object.freeze(['passed', 'synthetic-passed', 'failed', 'unverifiable', 'not-observed']);

// --- helpers -----------------------------------------------------------------
const canonical = value => K.canonicalJSON(value);
const sha = bytes => K.sha256Bytes(bytes);
const bytesOfCanonical = value => Buffer.from(canonical(value), 'utf8');
function plain(value, d) {
  try { return K.parseStrictJSON(canonical(value)); } catch { return refuse(`${d} must be plain canonical JSON data`); }
}
function bytesOf(value, d) {
  if (!Buffer.isBuffer(value) || value.length === 0) refuse(`${d} bytes required`);
  return Buffer.from(value);
}
function structural(result, d) {
  if (!result || !result.ok) refuse(`${d} invalid at ${result?.issue?.path}: ${result?.issue?.reason}`);
  return result.value;
}
function exactKeys(value, keys, d) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse(`${d} must be an object`);
  if (canonical(Object.keys(value).sort()) !== canonical([...keys].sort())) refuse(`${d} keys must be exactly ${[...keys].sort().join(', ')}`);
}
function targetOf(project) {
  if (!Object.hasOwn(ENVIRONMENTS, project)) refuse('an explicit supported project is required (lyfelabz-staging or lyfelabz-prod)');
  return Object.freeze({ environment: ENVIRONMENTS[project], projectId: project, projectNumber: PROJECT_NUMBERS[project] });
}
const sameIdentity = (v, e) => v && v.environment === e.environment && v.projectId === e.projectId && v.projectNumber === e.projectNumber;
const check = (name, status, detail) => {
  if (!STATUSES.includes(status)) refuse(`internal: unknown check status ${status}`);
  return { check: name, status, detail };
};
const strip = e => e.message.replace(/^\[[^\]]+\] REFUSED: /, '');

// --- authority and base list -------------------------------------------------
/** Production: the pinned registry and list only. Staging: no pinned registry or list
 * exists, so only explicit synthetic test authority is accepted (S6d-D2); without it
 * no base list exists to propose against and preparation refuses. */
function authorityFor(expected, supplied) {
  if (expected.environment === 'production') {
    if (supplied !== undefined) refuse('production uses only the artifact-pinned registry and revocation list');
    let sourceSha256;
    try { sourceSha256 = sha(fs.readFileSync(LIST_SOURCE)); } catch { refuse('pinned revocation-list source is unreadable'); }
    const empty = R.PRODUCTION_AUTHORITY_REGISTRY.entries.length === 0;
    return { registry: empty ? null : R.PRODUCTION_AUTHORITY_REGISTRY, list: L.PRODUCTION_REVOCATION_LIST,
      record: { source: empty ? AUTHORITY_SOURCES.pinnedEmpty : AUTHORITY_SOURCES.pinned, registrySha256: null },
      base: { source: BASE_SOURCES.pinned, sourceSha256 } };
  }
  if (supplied === undefined) refuse('unverifiable: no artifact-pinned staging registry or revocation list exists; only explicit synthetic test authority is accepted for staging (S6d-D2)');
  exactKeys(supplied, ['registryEntries', 'revocationEntries'], 'synthetic authority');
  const registryEntries = plain(supplied.registryEntries, 'synthetic registry'), revocationEntries = plain(supplied.revocationEntries, 'synthetic revocations');
  const registry = structural(R.createAuthorityRegistry(registryEntries), 'synthetic registry');
  const list = structural(L.createRevocationList(revocationEntries, expected), 'synthetic revocation list');
  return { registry, list, record: { source: AUTHORITY_SOURCES.synthetic, registrySha256: sha(canonical(registryEntries)) },
    base: { source: BASE_SOURCES.synthetic, sourceSha256: null } };
}
const listEntries = list => list.entries.map(e => ({ schemaVersion: e.schemaVersion, environment: e.environment, projectId: e.projectId,
  projectNumber: e.projectNumber, revokedEvidenceRef: e.revokedEvidenceRef }));

// --- inputs ------------------------------------------------------------------
function signedDisposition(input, expected) {
  exactKeys(input, ['document', 'statementBytes'], 'disposition');
  const document = plain(input.document, 'disposition document');
  structural(V.validateApprovalDisposition(document, expected), 'disposition document');
  let statement;
  try { statement = ST.readStatementBytes(bytesOf(input.statementBytes, 'disposition statement'), document.payload.source.statementObject.sha256); }
  catch (e) { refuse(`disposition ${strip(e)}`); }
  if (canonical(statement) !== canonical(document.payload.statement)) refuse('disposition statement bytes are not the document statement');
  if (!sameIdentity(document.payload.statement, expected)) refuse('disposition wrong-project or wrong-environment identity');
  return { document, ref: K.evidenceRef(document.payload), statement: document.payload.statement, statementSha256: document.payload.source.statementObject.sha256 };
}
function evidenceDocument(value, d, expected) {
  const document = plain(value, d);
  const kind = document?.payload?.kind;
  if (!Object.hasOwn(TARGET_VALIDATORS, kind)) refuse(`${d} must be a deployment approval, activation approval or release certification`);
  structural(TARGET_VALIDATORS[kind](document, expected), d);
  if (!sameIdentity(document.payload.statement, expected)) refuse(`${d} wrong-project or wrong-environment identity`);
  return { document, kind, ref: K.evidenceRef(document.payload), statement: document.payload.statement };
}
/** Every disposition the operator knows of (explicit, possibly empty). Conflicts and
 * cycles are found among these and the new disposition; signatures are not needed to
 * refuse, because a conflict blocks whichever side is genuine. */
function knownDispositions(value, expected, current) {
  if (!Array.isArray(value)) refuse('known dispositions are required as an explicit list (it may be empty)');
  const seen = new Set(), list = [];
  for (const [i, item] of value.entries()) {
    const document = plain(item, `known disposition ${i}`);
    structural(V.validateApprovalDisposition(document, expected), `known disposition ${i}`);
    if (!sameIdentity(document.payload.statement, expected)) refuse(`known disposition ${i} wrong-project or wrong-environment identity`);
    const ref = K.evidenceRef(document.payload);
    if (seen.has(ref)) refuse(`known disposition ${ref} is listed twice`);
    seen.add(ref);
    if (ref !== current.ref) list.push({ ref, statement: document.payload.statement });
  }
  return { refs: [...seen].sort(), others: list };
}
function assertNoConflict(current, others) {
  const s = current.statement;
  for (const o of others) {
    if (o.statement.targetApprovalRef === s.targetApprovalRef) refuse(`conflicting disposition ${o.ref} already disposes target ${s.targetApprovalRef}`);
    if (s.action === 'supersede' && o.statement.targetApprovalRef === s.replacementApprovalRef && o.statement.action === 'revoke') {
      refuse(`conflicting disposition ${o.ref} revokes the replacement ${s.replacementApprovalRef}`);
    }
  }
  // Supersession graph: target -> replacement. Any cycle refuses.
  const edges = new Map();
  for (const d of [...others, current]) if (d.statement.action === 'supersede') {
    const from = d.statement.targetApprovalRef;
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push(d.statement.replacementApprovalRef);
  }
  const state = new Map();
  const visit = node => {
    if (state.get(node) === 'open') refuse(`supersession cycle through ${node}`);
    if (state.get(node) === 'done') return;
    state.set(node, 'open');
    for (const next of edges.get(node) || []) visit(next);
    state.set(node, 'done');
  };
  for (const node of [...edges.keys()].sort()) visit(node);
}
const BINDINGS = Object.freeze({
  releaseId: 'signed backendReleaseId: the whole manifest, revisions and fingerprints, is content-bound to the signed target',
  deployment: 'canonical validateDeploymentBinding: fingerprints, source, mode and contract bound to the signed deployment approval candidate; revision identities are not signed and are unbound',
});
/** Releases the target's revocation stops serving. Each must be bound to the target. */
function revokedReleases(value, target, expected) {
  if (!Array.isArray(value) || value.length === 0) refuse('at least one revoked backend release is required; a rollout cannot be compared without one');
  const seen = new Set();
  const records = value.map((item, i) => {
    const document = plain(item, `revoked release ${i}`);
    structural(V.validateBackendRelease(document, expected), `revoked release ${i}`);
    const m = document.manifest, releaseId = K.contentDigest(m), ref = `teacherUnitsBackendReleases/${releaseId}`;
    structural(B.validateReleaseReference(ref, document, expected), `revoked release ${i} reference`);
    if (seen.has(ref)) refuse(`revoked release ${ref} is listed twice`);
    seen.add(ref);
    // Only signed evidence makes a release's comparison values trustworthy. A certification
    // or activation approval signs backendReleaseId, the content address of the whole
    // manifest (revisions included). A deployment approval signs only its candidate, so the
    // release must pass the canonical validateDeploymentBinding (approval reference,
    // identity, source, fingerprints, mode, contract); revision identities are not in the
    // signed candidate and stay unbound (recorded per release).
    let binding;
    if (target.kind === 'teacher-units-deployment-approval') {
      structural(B.validateDeploymentBinding(document, target.document, expected), `revoked release ${ref} deployment binding`);
      binding = BINDINGS.deployment;
    } else {
      if (target.statement.backendReleaseId !== releaseId) refuse(`revoked release ${ref} is not bound to the disposition target`);
      binding = BINDINGS.releaseId;
    }
    return { ref, releaseId, binding, runtimePayloadFingerprint: m.runtimePayloadFingerprint, functionsArtifactFingerprint: m.functionsArtifactFingerprint,
      revisions: m.endpoints.map(e => ({ endpointName: e.endpointName, revisionResource: e.revisionResource })) };
  });
  return records.sort((a, b) => (a.ref < b.ref ? -1 : 1));
}
function signatureCheck(document, authority, expected) {
  if (!authority.registry) return check('disposition.signature', 'unverifiable', authority.record.source);
  const result = SG.verifyApprovalSignature(document, authority.registry, expected);
  if (result.verdict !== 'verified') refuse(`disposition signature ${result.reason} against ${authority.record.source}`);
  const status = authority.record.source === AUTHORITY_SOURCES.synthetic ? 'synthetic-passed' : 'passed';
  return check('disposition.signature', status, `verified against ${authority.record.source}; key ${result.keyId}, action ${result.action}`);
}

// --- plan --------------------------------------------------------------------
const PLAN_INPUTS = ['project', 'disposition', 'target', 'replacement', 'knownDispositions', 'revokedReleases', 'authority', 'preparedAt'];

function derivePlan(inputs) {
  if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) refuse('plan inputs required');
  for (const key of Object.keys(inputs)) if (!PLAN_INPUTS.includes(key)) refuse(`unknown plan input ${key}`);
  const expected = targetOf(inputs.project);
  const preparedAt = inputs.preparedAt;
  O.instant(preparedAt, 'preparedAt');
  const disposition = signedDisposition(inputs.disposition, expected);
  const s = disposition.statement;
  if (inputs.target === undefined) refuse('the disposition target document is required');
  const target = evidenceDocument(inputs.target, 'disposition target', expected);
  if (target.ref !== s.targetApprovalRef) refuse('target document is not the disposition target');
  let replacement = null;
  if (s.action === 'supersede') {
    if (inputs.replacement === undefined || inputs.replacement === null) refuse('a supersede disposition requires its replacement document');
    replacement = evidenceDocument(inputs.replacement, 'replacement', expected);
    if (replacement.ref !== s.replacementApprovalRef) refuse('replacement document is not the disposition replacement');
  } else if (inputs.replacement !== undefined && inputs.replacement !== null) refuse('a revoke disposition takes no replacement');
  structural(B.validateDispositionBinding(disposition.document, target.document, replacement ? replacement.document : null, expected), 'disposition binding');

  let fresh;
  try { fresh = FR.assertStatementFresh(DISPOSITION_KIND, s, preparedAt, 'registration'); } catch (e) { refuse(`disposition ${strip(e)}`); }
  const authority = authorityFor(expected, inputs.authority);
  const signature = signatureCheck(disposition.document, authority, expected);

  const known = knownDispositions(inputs.knownDispositions, expected, disposition);
  assertNoConflict(disposition, known.others);

  // Base list: the current pinned list (or synthetic entries); neither ref may be pinned.
  const status = ref => L.revocationStatus(authority.list, ref, expected);
  for (const [name, ref] of [['target', target.ref], ['replacement', replacement && replacement.ref]]) {
    if (ref === null) continue;
    const st = status(ref);
    if (st === 'revoked') refuse(`${name} ${ref} is already pinned in the base revocation list; a no-op revocation cannot change the artifact`);
    if (st !== 'notRevoked') refuse(`${name} revocation status ${st}`);
  }
  const baseEntries = listEntries(authority.list);
  const nextEntries = [...baseEntries, { schemaVersion: 1, ...expected, revokedEvidenceRef: target.ref }]
    .sort((a, b) => (a.revokedEvidenceRef < b.revokedEvidenceRef ? -1 : 1));
  structural(L.createRevocationList(nextEntries, expected), 'proposed next revocation list');
  const baseSha256 = sha(canonical(baseEntries)), nextSha256 = sha(canonical(nextEntries));
  if (baseSha256 === nextSha256) refuse('proposed next revocation list is identical to the base list; R2 requires an artifact change');

  const releases = revokedReleases(inputs.revokedReleases, target, expected);
  const planClass = signature.status === 'unverifiable' ? PLAN_CLASSES.unverifiable
    : signature.status === 'synthetic-passed' ? PLAN_CLASSES.synthetic : PLAN_CLASSES.pinned;
  const checks = [
    check('identity', 'passed', `${expected.environment} ${expected.projectId} ${expected.projectNumber} for every document`),
    check('disposition.binding', 'passed', `validateDispositionBinding passed (${s.action})`),
    check('disposition.freshness', 'passed', `at preparedAt (registration window ${fresh.limit}); age ${fresh.ageNanoseconds} ns`),
    signature,
    check('conflicts', 'passed', `no conflicting disposition or supersession cycle among ${known.refs.length} known disposition(s); completeness of that set is not established`),
    check('base.notPinned', authority.record.source === AUTHORITY_SOURCES.synthetic ? 'synthetic-passed' : 'passed', `target${replacement ? ' and replacement' : ''} not pinned in ${authority.base.source}`),
    check('next.list', 'passed', 'proposed next list satisfies createRevocationList and differs from the base list'),
    check('releases.bound', 'passed', `${releases.length} revoked release(s) bound to the target`),
    check('deployedArtifact', 'not-observed', 'nothing is pinned or deployed by this plan'),
  ];
  const plan = { schemaVersion: 1, kind: PLAN_KIND, authorization: AUTHORIZATION, revocationEffective: false, releaseAuthorized: false, activationReady: false,
    ...expected, planClass, preparedAt,
    disposition: { ref: disposition.ref, action: s.action, issuedAt: s.issuedAt, statementSha256: disposition.statementSha256, effect: EFFECT[s.action] },
    target: { ref: target.ref, kind: target.kind }, replacement: replacement ? { ref: replacement.ref, kind: replacement.kind } : null,
    authority: authority.record,
    base: { source: authority.base.source, sourceSha256: authority.base.sourceSha256, entriesSha256: baseSha256, entryCount: baseEntries.length },
    proposed: { pin: target.ref, entriesSha256: nextSha256, entries: nextEntries, status: 'proposed only: not pinned, not shipped' },
    knownDispositions: known.refs, revokedReleases: releases, checks,
    procedure: { status: PROCEDURE_STATUS, steps: [...PROCEDURE] }, unresolved: [...UNRESOLVED] };
  assertPlanShape(plan);
  return { plan, bytes: bytesOfCanonical(plan) };
}

const PLAN_KEYS = ['schemaVersion', 'kind', 'authorization', 'revocationEffective', 'releaseAuthorized', 'activationReady', 'environment', 'projectId',
  'projectNumber', 'planClass', 'preparedAt', 'disposition', 'target', 'replacement', 'authority', 'base', 'proposed', 'knownDispositions', 'revokedReleases',
  'checks', 'procedure', 'unresolved'];
function assertPlanShape(p) {
  exactKeys(p, PLAN_KEYS, 'revocation plan');
  const fixed = { schemaVersion: 1, kind: PLAN_KIND, authorization: AUTHORIZATION, revocationEffective: false, releaseAuthorized: false, activationReady: false };
  for (const [key, value] of Object.entries(fixed)) if (p[key] !== value) refuse(`revocation plan ${key} must be ${JSON.stringify(value)}; a plan never revokes or authorizes`);
  if (!Object.values(PLAN_CLASSES).includes(p.planClass)) refuse('revocation plan class unsupported');
  exactKeys(p.disposition, ['ref', 'action', 'issuedAt', 'statementSha256', 'effect'], 'revocation plan disposition');
  if (!Object.hasOwn(EFFECT, p.disposition.action) || p.disposition.effect !== EFFECT[p.disposition.action]) refuse('revocation plan disposition effect must be the fixed audit-only statement');
  exactKeys(p.target, ['ref', 'kind'], 'revocation plan target');
  if (p.replacement !== null) exactKeys(p.replacement, ['ref', 'kind'], 'revocation plan replacement');
  exactKeys(p.authority, ['source', 'registrySha256'], 'revocation plan authority');
  if (!Object.values(AUTHORITY_SOURCES).includes(p.authority.source)) refuse('revocation plan authority source unsupported');
  exactKeys(p.base, ['source', 'sourceSha256', 'entriesSha256', 'entryCount'], 'revocation plan base');
  exactKeys(p.proposed, ['pin', 'entriesSha256', 'entries', 'status'], 'revocation plan proposed list');
  if (p.proposed.status !== 'proposed only: not pinned, not shipped' || p.proposed.pin !== p.target.ref) refuse('revocation plan proposed list must pin the target and stay proposed only');
  if (!Array.isArray(p.knownDispositions) || !Array.isArray(p.revokedReleases) || p.revokedReleases.length === 0 || !Array.isArray(p.checks)) refuse('revocation plan lists malformed');
  for (const r of p.revokedReleases) {
    exactKeys(r, ['ref', 'releaseId', 'binding', 'runtimePayloadFingerprint', 'functionsArtifactFingerprint', 'revisions'], 'revocation plan release');
    if (!Object.values(BINDINGS).includes(r.binding)) refuse('revocation plan release binding unsupported');
    if (!Array.isArray(r.revisions)) refuse('revocation plan release revisions malformed');
    for (const v of r.revisions) exactKeys(v, ['endpointName', 'revisionResource'], 'revocation plan release revision');
  }
  for (const c of p.checks) { exactKeys(c, ['check', 'status', 'detail'], 'revocation plan check'); if (!STATUSES.includes(c.status)) refuse(`revocation plan check status ${c.status} unsupported`); }
  exactKeys(p.procedure, ['status', 'steps'], 'revocation plan procedure');
  if (p.procedure.status !== PROCEDURE_STATUS || canonical(p.procedure.steps) !== canonical(PROCEDURE)) refuse('revocation plan procedure must be the fixed descriptive R2 procedure');
  if (canonical(p.unresolved) !== canonical(UNRESOLVED)) refuse('revocation plan unresolved gates malformed');
  O.instant(p.preparedAt, 'plan preparedAt');
}
function readPlanBytes(planBytes) {
  const bytes = bytesOf(planBytes, 'revocation plan');
  let claimed;
  try { claimed = K.parseStrictJSON(bytes.toString('utf8')); } catch { refuse('revocation plan is not strict JSON'); }
  if (canonical(claimed) !== bytes.toString('utf8')) refuse('revocation plan bytes are not canonical JSON');
  assertPlanShape(claimed);
  return { bytes, claimed };
}

/** Prepares a candidate plan. `preparedAt` is the explicit tooling clock. */
function prepareRevocationPlan(inputs) {
  const { plan, bytes } = derivePlan(inputs);
  return Object.freeze({ authorization: AUTHORIZATION, plan, bytes, sha256: sha(bytes) });
}

/**
 * D6 freshness of the disposition at the current tooling clock, reported separately
 * from historical verification. D6 bounds freshness only at registration and enable
 * (fix 1, items 1 and 4); it sets no expiry on a historical plan, so an old plan still
 * verifies. `outside-window` means only that registering this disposition now would
 * refuse; it never renews the disposition, and `within-window` is never authorization.
 * The same bound as S6a `assertStatementFresh` (more than 24 hours refuses).
 */
function currentFreshness(issuedAt, now) {
  const issued = O.instant(issuedAt, 'disposition issuedAt'), current = O.instant(now, 'tooling clock');
  if (issued > current) refuse('disposition issuedAt is in the future relative to the tooling clock');
  const age = current - issued, within = age <= FR.APPROVAL_MAX_AGE_NS;
  return Object.freeze({ status: within ? 'within-window' : 'outside-window', at: now, ageNanoseconds: age.toString(), limit: '24h',
    detail: within ? 'the disposition is within the D6 24-hour registration window now; this is not authorization'
      : 'the disposition is older than the D6 24-hour registration window now; registering it now would refuse, and a new signed disposition is required' });
}

/**
 * Historical verification. Re-derives the plan at its own preparedAt from the
 * supplied evidence and the CURRENT base list and requires byte-exact equality, so a
 * changed base list, disposition, target, replacement, authority, release or fixed
 * claim refuses. Preparation freshness is re-applied at preparedAt (never at `now`),
 * so an old disposition is never renewed; current freshness at `now` is reported
 * separately and does not decide verification. `now` before preparedAt refuses.
 */
function verifyRevocationPlan(planBytes, inputs, now) {
  const { bytes, claimed } = readPlanBytes(planBytes);
  if (inputs === null || typeof inputs !== 'object') refuse('plan inputs required');
  if (Object.hasOwn(inputs, 'preparedAt')) refuse('verification uses the plan preparedAt; do not supply it');
  if (inputs.project !== claimed.projectId) refuse('revocation plan identity differs from the explicit project');
  const current = O.instant(now, 'tooling clock');
  if (O.instant(claimed.preparedAt, 'plan preparedAt') > current) refuse('revocation plan preparedAt is in the future');
  const derived = derivePlan({ ...inputs, preparedAt: claimed.preparedAt });
  if (!derived.bytes.equals(bytes)) {
    const diff = PLAN_KEYS.filter(k => canonical(claimed[k]) !== canonical(derived.plan[k]));
    refuse(`revocation plan does not match the evidence it references or the current base list: ${diff.join(', ') || 'bytes'}`);
  }
  // The re-derived plan equals the claim, so its issuedAt is the disposition's.
  return Object.freeze({ verified: true, verification: HISTORICAL,
    scope: 'the plan is exactly what the supplied evidence and the current base list yield; it remains a non-authorizing candidate',
    currentFreshness: currentFreshness(derived.plan.disposition.issuedAt, now),
    authorization: AUTHORIZATION, revocationEffective: false, releaseAuthorized: false, activationReady: false, planClass: claimed.planClass, sha256: sha(bytes), plan: claimed });
}

const HISTORICAL = 'historical: re-derived at preparedAt (preparation freshness applied there) against the current base list; not current approval freshness';

// --- rollout comparison -------------------------------------------------------
const NOT_ESTABLISHED = Object.freeze({
  deployedRevocationList: 'not-observed: a different revision and artifact fingerprint do not establish that the deployed artifact contains the proposed pinned list',
  providerOrigin: 'unverifiable: capture provenance is synthetic or operator-captured-unattested; replay proves consistency with the captured bytes only',
  oldRevisionsDeleted: 'not-observed',
});
/** Pure comparison over an S4 observation (already replayed by the caller). */
function assessRollout(observation, plan) {
  const findings = [];
  // S4 endpoints are {configuration, runtimeProfile, provider}; the configuration holds the serving revision.
  const endpoints = (Array.isArray(observation?.endpoints) ? observation.endpoints : []).map(e => e?.configuration);
  const names = endpoints.map(e => String(e?.endpointName));
  if (endpoints.length !== O.ENDPOINTS.length || names.join() !== O.ENDPOINTS.join()) findings.push(`expected exactly the nine sorted A3 endpoints, observed ${endpoints.length}`);
  const revokedRevisions = new Set(plan.revokedReleases.flatMap(r => r.revisions.map(v => v.revisionResource)));
  const revokedArtifacts = new Set(plan.revokedReleases.flatMap(r => [r.runtimePayloadFingerprint, r.functionsArtifactFingerprint]));
  const serving = endpoints.map(e => {
    const traffic = Array.isArray(e?.traffic) ? e.traffic : [];
    if (traffic.length !== 1) findings.push(`${e?.endpointName}: expected one serving route, observed ${traffic.length}`);
    for (const t of traffic) {
      if (t?.percent !== 100) findings.push(`${e?.endpointName}: partial traffic ${t?.percent}`);
      if (t?.tag !== null) findings.push(`${e?.endpointName}: tagged route ${t?.tag}`);
      if (t?.revisionResource !== e?.revisionResource) findings.push(`${e?.endpointName}: alternate serving revision ${t?.revisionResource}`);
      if (revokedRevisions.has(t?.revisionResource)) findings.push(`${e?.endpointName}: revoked revision still routed ${t?.revisionResource}`);
    }
    const revoked = revokedRevisions.has(e?.revisionResource);
    if (revoked) findings.push(`${e?.endpointName}: revoked revision still serving ${e?.revisionResource}`);
    return { endpointName: e?.endpointName ?? null, revisionResource: e?.revisionResource ?? null, matchesRevokedRevision: revoked };
  });
  const artifact = { runtimePayloadFingerprint: observation?.runtimePayloadFingerprint ?? null, functionsArtifactFingerprint: observation?.functionsArtifactFingerprint ?? null };
  artifact.matchesRevokedArtifact = revokedArtifacts.has(artifact.runtimePayloadFingerprint) || revokedArtifacts.has(artifact.functionsArtifactFingerprint);
  if (artifact.matchesRevokedArtifact) findings.push('revoked artifact fingerprint still serving');
  return { endpoints: serving, artifact, findings };
}

const ROLLOUT_INPUTS = ['project', 'planBytes', 'planInputs', 'now', 'capture', 'deploymentPlan', 'expected', 'hostingRoot'];

/**
 * Offline. First verifies the plan through `verifyRevocationPlan` (the same full
 * re-derivation as `revocation verify`, from the original plan inputs and the current
 * base list), then the S6c capture by replay (unchanged S6c code), and only then
 * compares what serves with the plan's revoked releases. A rollout
 * comparison that passes says only that different revisions and artifacts serve;
 * it never establishes the deployed list contents, provider origin or deletion of
 * old revisions, and never reports revocation complete.
 */
async function checkRollout(inputs) {
  if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) refuse('rollout inputs required');
  for (const key of Object.keys(inputs)) if (!ROLLOUT_INPUTS.includes(key)) refuse(`unknown rollout input ${key}`);
  const expected = targetOf(inputs.project);
  if (inputs.planInputs === null || typeof inputs.planInputs !== 'object' || Array.isArray(inputs.planInputs)) refuse('the original revocation plan inputs are required');
  if (inputs.planInputs.project !== inputs.project) refuse('revocation plan inputs identity differs from the explicit project');
  // The one plan verifier: full re-derivation, byte equality, base-list binding, evidence and fixed claims.
  const verified = verifyRevocationPlan(inputs.planBytes, inputs.planInputs, inputs.now);
  const plan = verified.plan, planBytes = bytesOf(inputs.planBytes, 'revocation plan');

  if (inputs.capture === null || typeof inputs.capture !== 'object') refuse('the S6c capture files are required');
  const replay = await PC.verifyCapture({ project: inputs.project, files: inputs.capture, deploymentPlan: inputs.deploymentPlan, expected: inputs.expected,
    ...(inputs.hostingRoot === undefined ? {} : { hostingRoot: inputs.hostingRoot }) });
  let observation, bundle;
  try { observation = K.parseStrictJSON(inputs.capture.observation.toString('utf8')); bundle = K.parseStrictJSON(inputs.capture.bundle.toString('utf8')); }
  catch { refuse('replayed capture files are not strict JSON'); }
  if (!sameIdentity(observation, expected) || !sameIdentity(bundle, expected)) refuse('capture identity differs from the explicit project');
  const assessed = assessRollout(observation, plan);
  const findings = [...assessed.findings];
  const captureStart = O.instant(replay.window.startedAt, 'capture start');
  if (captureStart <= O.instant(plan.preparedAt, 'plan preparedAt')) findings.push('capture started before the plan was prepared; it cannot observe the R2 redeploy');
  const report = { schemaVersion: 1, kind: ROLLOUT_KIND, authorization: ROLLOUT_AUTHORIZATION, revocationComplete: false, revocationEffective: false,
    releaseAuthorized: false, activationReady: false, providerVerified: false, oldRevisionsDeleted: 'not-observed', ...expected,
    planSha256: sha(planBytes), planVerification: HISTORICAL, currentFreshness: { ...verified.currentFreshness },
    captureBundleSha256: replay.bundleSha256, evidenceClass: replay.evidenceClass, window: { startedAt: replay.window.startedAt, completedAt: replay.window.completedAt },
    rolloutComparison: findings.length === 0 ? 'passed' : 'failed', findings, endpoints: assessed.endpoints, artifact: assessed.artifact,
    deployedRevocationList: NOT_ESTABLISHED.deployedRevocationList, providerOrigin: NOT_ESTABLISHED.providerOrigin };
  assertRolloutShape(report);
  const reportBytes = bytesOfCanonical(report);
  return Object.freeze({ authorization: ROLLOUT_AUTHORIZATION, report, bytes: reportBytes, sha256: sha(reportBytes) });
}
const ROLLOUT_KEYS = ['schemaVersion', 'kind', 'authorization', 'revocationComplete', 'revocationEffective', 'releaseAuthorized', 'activationReady', 'providerVerified',
  'oldRevisionsDeleted', 'environment', 'projectId', 'projectNumber', 'planSha256', 'planVerification', 'currentFreshness', 'captureBundleSha256', 'evidenceClass', 'window',
  'rolloutComparison', 'findings', 'endpoints', 'artifact', 'deployedRevocationList', 'providerOrigin'];
function assertRolloutShape(r) {
  exactKeys(r, ROLLOUT_KEYS, 'rollout report');
  const fixed = { schemaVersion: 1, kind: ROLLOUT_KIND, authorization: ROLLOUT_AUTHORIZATION, revocationComplete: false, revocationEffective: false,
    releaseAuthorized: false, activationReady: false, providerVerified: false, oldRevisionsDeleted: NOT_ESTABLISHED.oldRevisionsDeleted,
    deployedRevocationList: NOT_ESTABLISHED.deployedRevocationList, providerOrigin: NOT_ESTABLISHED.providerOrigin };
  for (const [key, value] of Object.entries(fixed)) if (r[key] !== value) refuse(`rollout report ${key} must be ${JSON.stringify(value)}`);
  if (!PC.EVIDENCE_CLASSES.includes(r.evidenceClass)) refuse('rollout report evidence class unsupported');
  if (r.planVerification !== HISTORICAL) refuse('rollout report must record the full historical plan verification');
  if (!['passed', 'failed'].includes(r.rolloutComparison) || (r.rolloutComparison === 'passed') !== (r.findings.length === 0)) refuse('rollout report comparison inconsistent with findings');
}

module.exports = { PLAN_KIND, ROLLOUT_KIND, AUTHORIZATION, ROLLOUT_AUTHORIZATION, AUTHORITY_SOURCES, PLAN_CLASSES, EFFECT, PROCEDURE, PROCEDURE_STATUS,
  UNRESOLVED, NOT_ESTABLISHED, BINDINGS, prepareRevocationPlan, verifyRevocationPlan, assessRollout, checkRollout };
