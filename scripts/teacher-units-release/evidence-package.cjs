'use strict';

// A3-6 S6b: offline release evidence assembly. NON-AUTHORIZING.
//
// Connects the certified S1 to S6a contracts into one candidate package:
//   S4 deployment plan + S5 expected access + signed deployment approval
//   + S4 provider observation + S5 access review receipt  ->  A3-1 backend release
//   + optional certification (and report bytes), activation approval and
//     activation evidence                                  ->  evidence package
//
// A package is a candidate only. It is never an approval, certification,
// registration, provider verification or activation, and its fixed literals say
// so (providerVerified, releaseAuthorized and activationReady are always false).
// Structural, binding and hash failures refuse. Signature, revocation and
// freshness results are recorded (owner decision S6b-D2); an unknown or failed
// authority check is never recorded as passed. `verifyEvidencePackage` re-derives
// the whole package from the supplied evidence bytes and refuses any difference,
// so a caller-edited or resealed package (including its check list) refuses.
//
// Pure and offline: no network, no Firestore, no Storage, no key, no signing, no
// clock (every instant is an explicit argument). Not part of the deployed
// Functions payload and not reachable from index.ts.
const path = require('node:path');
const { PROJECT_NUMBERS, fingerprint } = require('../hosting-release/backend-state.cjs');
const O = require('./provider-observation.cjs');
const AR = require('./access-review.cjs');
const ST = require('./statements.cjs');
const FR = require('./freshness.cjs');

const LIB = path.resolve(__dirname, '../../platform/functions/lib/teacherUnits');
function compiled(name) {
  try { return require(path.join(LIB, name)); }
  catch { return refuse(`compiled A3 module ${name} unavailable; run npm --prefix platform/functions run build`); }
}
function refuse(message) { throw new Error(`[a3-evidence-package] REFUSED: ${message}`); }
const K = compiled('a3-canonical.js');
const V = compiled('a3-validation.js');
const B = compiled('a3-bindings.js');
const SG = compiled('a3-signature.js');
const R = compiled('a3-authority-registry.js');
const L = compiled('a3-revocation-list.js');

const PACKAGE_KIND = 'lyfelabz.teacherUnitsA3EvidencePackage';
const AUTHORIZATION = 'none: candidate evidence package; not an approval, certification, registration or activation';
const RELEASE_AUTHORIZATION = 'none: candidate backend release document; not registered, certified or approved';
const ENVIRONMENTS = Object.freeze({ 'lyfelabz-prod': 'production', 'lyfelabz-staging': 'staging' });
const STATUSES = Object.freeze(['passed', 'synthetic-passed', 'failed', 'absent', 'unverifiable', 'not-observed', 'deferred']);
const EVIDENCE_CLASSES = Object.freeze(['synthetic', 'operator-supplied-unverified']);
const AUTHORITY_SOURCES = Object.freeze({
  pinned: 'pinned-production-registry',
  none: 'none: no artifact-pinned staging registry exists',
  synthetic: 'synthetic-test-authority: caller-supplied, never pinned; offline testing only',
});
const PROVENANCE_NOTE = 'declared by the S5 receipt; a declaration is not proof of provider origin';
// Gates this slice cannot close. Fixed: a package can never omit one.
const UNRESOLVED = Object.freeze([
  'D9: evidence buckets do not exist; content object locations are labels, only supplied bytes are hash-checked',
  'D12: no policy-controlled build; the deployed a3-runtime-build.json is not observed',
  'D13: enabled Hosting candidate format undefined; hostingCandidateFingerprint is not verified',
  'G1: platform-injected environment variables unverified',
  'G2: base-image update policy support unverified',
  'G3: invoker IAM, inherited IAM and live routes unobserved (S5 level B never produced)',
  'G4: deploy-time build reproducibility unverified',
  'G5: per-collection Firestore IAM unverified',
  'O6: A3-3 callVerifier exception classification must be resolved before wiring',
  'S6c: a fresh provider observation (at most five minutes old) is required at enable',
  'S6d: revocation and supersede procedure not implemented; dispositions are not consulted',
  'S6e: no staging or production signing, registration or transition has been performed',
  'A3-7: integrated certification not performed',
]);

// --- small helpers -------------------------------------------------------------
const canonical = value => K.canonicalJSON(value);
const sha = bytes => K.sha256Bytes(bytes);
/** Reads a caller value once through canonical serialization: accessors, hidden
 * fields and non-plain values refuse, and every later check uses the copy. */
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
  const actual = Object.keys(value).sort(), wanted = [...keys].sort();
  if (canonical(actual) !== canonical(wanted)) refuse(`${d} keys must be exactly ${wanted.join(', ')}`);
}
function targetOf(project) {
  if (!Object.hasOwn(ENVIRONMENTS, project)) refuse('an explicit supported project is required (lyfelabz-staging or lyfelabz-prod)');
  return Object.freeze({ environment: ENVIRONMENTS[project], projectId: project, projectNumber: PROJECT_NUMBERS[project] });
}
const sameIdentity = (value, expected) => value && value.environment === expected.environment && value.projectId === expected.projectId &&
  value.projectNumber === expected.projectNumber;
const check = (name, status, detail) => {
  if (!STATUSES.includes(status)) refuse(`internal: unknown check status ${status}`);
  return { check: name, status, detail };
};

/** A signed document plus its exact statement bytes (canonical, at the statement object hash). */
function signedInput(input, validator, expected, d) {
  exactKeys(input, ['document', 'statementBytes'], d);
  const document = plain(input.document, `${d} document`);
  structural(validator(document, expected), `${d} document`);
  const bytes = bytesOf(input.statementBytes, `${d} statement`);
  let statement;
  try { statement = ST.readStatementBytes(bytes, document.payload.source.statementObject.sha256); } catch (e) { refuse(`${d} ${e.message.replace(/^\[[^\]]+\] REFUSED: /, '')}`); }
  if (canonical(statement) !== canonical(document.payload.statement)) refuse(`${d} statement bytes are not the document statement`);
  if (!sameIdentity(document.payload.statement, expected)) refuse(`${d} wrong-project or wrong-environment identity`);
  return { document, bytes, ref: K.evidenceRef(document.payload), statement: document.payload.statement };
}
function contentInput(input, d) {
  exactKeys(input, ['object', 'bytes'], d);
  return { object: plain(input.object, `${d} content object`), bytes: bytesOf(input.bytes, d) };
}

// --- release assembly ----------------------------------------------------------
const RELEASE_INPUTS = ['project', 'plan', 'expected', 'deploymentApproval', 'observation', 'receipt', 'evaluatedAt', 'hostingRoot'];

/**
 * Pure release assembly. Derives the A3-1 BackendReleaseDocumentV1 from the
 * approved plan, the expected access, the signed deployment approval, the S4
 * observation and the S5 receipt, using only certified composition and
 * validation. Nothing is fabricated: every manifest field comes from one of these
 * inputs, and a missing input refuses. `evaluatedAt` (owner decision S6b-D1) is the
 * recorded historical instant at which the S4 and S5 checks are applied; it
 * defaults to the S5 review end. It says nothing about current validity.
 */
function assembleRelease(inputs) {
  if (inputs === null || typeof inputs !== 'object') refuse('release inputs required');
  for (const key of Object.keys(inputs)) if (!RELEASE_INPUTS.includes(key)) refuse(`unknown release input ${key}`);
  const expected = targetOf(inputs.project), project = inputs.project;
  const plan = contentInput(inputs.plan, 'deployment plan');
  const access = contentInput(inputs.expected, 'expected-access plan');
  const receipt = contentInput(inputs.receipt, 'access review receipt');
  if (inputs.observation === undefined) refuse('S4 provider observation required; observations are never inferred');
  const observation = plain(inputs.observation, 'S4 observation');
  const approval = signedInput(inputs.deploymentApproval, V.validateDeploymentApproval, expected, 'deployment approval');

  // The recorded evaluation instant: by default the S5 review end, read from bytes
  // that must match the receipt content object (S5 re-verifies them below).
  if (sha(receipt.bytes) !== receipt.object.sha256) refuse('access review receipt bytes do not match the content object hash');
  let receiptValue;
  try { receiptValue = K.parseStrictJSON(receipt.bytes.toString('utf8')); } catch { refuse('access review receipt is not strict JSON'); }
  const evaluatedAt = inputs.evaluatedAt === undefined ? receiptValue?.observedAt : inputs.evaluatedAt;
  O.instant(evaluatedAt, 'evaluatedAt');

  const planValue = O.readPlan(plan.object, plan.bytes, project);
  const accessValue = AR.readExpectedAccess(access.object, access.bytes, project);

  // Plan and approval candidate binding: the approval names exactly this plan.
  const candidate = approval.statement.candidate;
  if (canonical(candidate.deploymentPlan) !== canonical(plan.object)) refuse('deployment approval candidate does not bind this deployment plan');
  for (const key of ['runtimePayloadFingerprint', 'functionsArtifactFingerprint', 'placementFingerprint']) {
    if (candidate[key] !== planValue.candidate[key]) refuse(`deployment approval candidate ${key} differs from the plan`);
  }
  // Expected-access and plan binding (S5 leaves this to release assembly).
  planValue.endpoints.forEach((planned, i) => {
    const e = accessValue.endpoints[i];
    if (e.endpointName !== planned.endpointName) refuse('expected-access and plan endpoints differ');
    if (e.runtimeServiceAccountEmail !== planned.execution.serviceAccountEmail) refuse(`${planned.endpointName} expected-access runtime service account differs from the plan`);
    if (e.ingress !== planned.execution.ingress) refuse(`${planned.endpointName} expected-access ingress differs from the plan`);
  });

  // S4 observation to plan, then S5 receipt to observation, plan and expected access.
  O.compareObservationToPlan(observation, plan.object, plan.bytes, project, evaluatedAt);
  const composed = AR.composeEndpoints(receipt.object, receipt.bytes, { project, observation, deploymentPlan: plan, expected: access,
    ...(inputs.hostingRoot === undefined ? {} : { hostingRoot: inputs.hostingRoot }), now: evaluatedAt });
  if (canonical(composed.endpoints.map(e => e.endpointName)) !== canonical(O.ENDPOINTS)) refuse('release requires exactly the nine sorted A3 endpoints');
  composed.endpoints.forEach((e, i) => {
    if (e.execution.serviceAccountEmail !== planValue.endpoints[i].execution.serviceAccountEmail ||
        e.execution.serviceAccountEmail !== accessValue.endpoints[i].runtimeServiceAccountEmail) refuse(`${e.endpointName} runtime service accounts disagree`);
  });

  // Every manifest field comes from the approval candidate or the observation.
  const manifest = { ...expected, schemaVersion: 1, enforcementVersion: candidate.enforcementVersion, region: 'us-central1', databaseId: '(default)',
    deploymentMode: candidate.deploymentMode, sourceSha: candidate.sourceSha, sourceTree: candidate.sourceTree,
    runtimePayloadFingerprint: candidate.runtimePayloadFingerprint, functionsArtifactFingerprint: candidate.functionsArtifactFingerprint,
    placementFingerprint: candidate.placementFingerprint, supportedClientContractVersions: [candidate.clientContractVersion],
    endpoints: composed.endpoints, rules: { rulesetResource: observation.rules.rulesetResource, sourceHash: observation.rules.sourceHash },
    readyIndexesConfigurationHash: observation.readyIndexesConfigurationHash, deploymentApprovalEvidenceRef: approval.ref };
  const document = { schemaVersion: 1, manifest };
  structural(V.validateBackendRelease(document, expected), 'backend release');
  structural(B.validateDeploymentBinding(document, approval.document, expected), 'backend release deployment binding');
  const releaseId = K.contentDigest(manifest), ref = `teacherUnitsBackendReleases/${releaseId}`;
  structural(B.validateReleaseReference(ref, document, expected), 'backend release reference');
  return Object.freeze({ authorization: RELEASE_AUTHORIZATION, ref, releaseId, document, bytes: Buffer.from(canonical(document), 'utf8'), evaluatedAt,
    expected, plan, access, receipt, receiptValue, observation, approval });
}

// --- authority ------------------------------------------------------------------
/** Production: the pinned (empty) registry and list only. Staging: no pinned
 * registry, so every authority check is unverifiable, unless explicit synthetic
 * test authority is supplied for synthetic evidence. Nothing else is accepted. */
function authorityFor(expected, supplied, evidenceClass) {
  if (expected.environment === 'production') {
    if (supplied !== undefined) refuse('production uses only the artifact-pinned registry and revocation list');
    return { source: AUTHORITY_SOURCES.pinned, registry: R.PRODUCTION_AUTHORITY_REGISTRY, revocationList: L.PRODUCTION_REVOCATION_LIST,
      record: { source: AUTHORITY_SOURCES.pinned, registrySha256: null, revocationListSha256: null } };
  }
  if (supplied === undefined) return { source: AUTHORITY_SOURCES.none, record: { source: AUTHORITY_SOURCES.none, registrySha256: null, revocationListSha256: null } };
  if (evidenceClass !== 'synthetic') refuse('synthetic test authority is accepted only for synthetic evidence (S5 receipt provenance synthetic-fixture)');
  exactKeys(supplied, ['registryEntries', 'revocationEntries'], 'synthetic authority');
  const registryEntries = plain(supplied.registryEntries, 'synthetic registry'), revocationEntries = plain(supplied.revocationEntries, 'synthetic revocations');
  const registry = structural(R.createAuthorityRegistry(registryEntries), 'synthetic registry');
  const revocationList = structural(L.createRevocationList(revocationEntries, expected), 'synthetic revocation list');
  return { source: AUTHORITY_SOURCES.synthetic, registry, revocationList,
    record: { source: AUTHORITY_SOURCES.synthetic, registrySha256: sha(canonical(registryEntries)), revocationListSha256: sha(canonical(revocationEntries)) } };
}
const passedFor = authority => (authority.source === AUTHORITY_SOURCES.pinned ? 'passed' : 'synthetic-passed');
function signatureCheck(name, document, authority, expected) {
  if (!authority.registry) return check(`${name}.signature`, 'unverifiable', authority.source);
  const result = SG.verifyApprovalSignature(document, authority.registry, expected);
  if (result.verdict === 'verified') return check(`${name}.signature`, passedFor(authority), `verified against ${authority.source}; key ${result.keyId}, action ${result.action}`);
  return check(`${name}.signature`, 'failed', `${result.reason} against ${authority.source}`);
}
function revocationCheck(name, ref, authority, expected) {
  if (!authority.revocationList) return check(`${name}.revocation`, 'unverifiable', authority.source);
  const status = L.revocationStatus(authority.revocationList, ref, expected);
  if (status === 'notRevoked') return check(`${name}.revocation`, passedFor(authority), `notRevoked in ${authority.source}`);
  return check(`${name}.revocation`, 'failed', `${status} in ${authority.source}`);
}
function freshnessCheck(name, statement, at, stage) {
  try {
    const r = FR.assertStatementFresh(statement.kind, statement, at, stage);
    return check(`${name}.freshness.current`, 'passed', `at assembledAt (${stage} window ${r.limit}); age ${r.ageNanoseconds} ns`);
  } catch (e) { return check(`${name}.freshness.current`, 'failed', e.message.replace(/^\[[^\]]+\] REFUSED: /, '')); }
}

// --- evidence package ---------------------------------------------------------
const PACKAGE_INPUTS = [...RELEASE_INPUTS, 'assembledAt', 'certification', 'activationApproval', 'activationEvidence', 'authority'];

function derivePackage(inputs) {
  if (inputs === null || typeof inputs !== 'object') refuse('package inputs required');
  for (const key of Object.keys(inputs)) if (!PACKAGE_INPUTS.includes(key)) refuse(`unknown package input ${key}`);
  const { assembledAt, certification, activationApproval, activationEvidence, authority: supplied, ...releaseInputs } = inputs;
  const release = assembleRelease(releaseInputs);
  const { expected, observation, receiptValue, approval } = release;
  const assembled = O.instant(assembledAt, 'assembledAt');
  const evaluated = O.instant(release.evaluatedAt, 'evaluatedAt');
  if (evaluated > assembled) refuse('evaluatedAt is after assembledAt');
  if (O.instant(observation.observedAt, 'observation end') > assembled || O.instant(receiptValue.observedAt, 'review end') > assembled) {
    refuse('observation or access review is in the future relative to assembledAt');
  }
  const evidenceClass = receiptValue.provenance === 'synthetic-fixture' ? 'synthetic' : 'operator-supplied-unverified';
  const authority = authorityFor(expected, supplied, evidenceClass);
  const manifest = release.document.manifest;

  const components = [
    { role: 'deploymentPlan', kind: O.PLAN_KIND, address: release.plan.object, suppliedSha256: sha(release.plan.bytes) },
    { role: 'expectedAccess', kind: AR.EXPECTED_KIND, address: release.access.object, suppliedSha256: sha(release.access.bytes) },
    { role: 'providerObservation', kind: O.OBSERVATION_KIND, address: null, suppliedSha256: sha(canonical(observation)), observationFingerprint: fingerprint(observation) },
    { role: 'accessReviewReceipt', kind: AR.RECEIPT_KIND, address: release.receipt.object, suppliedSha256: sha(release.receipt.bytes) },
    { role: 'deploymentApproval', kind: approval.document.payload.kind, address: approval.ref, suppliedSha256: sha(canonical(approval.document)),
      statementObject: approval.document.payload.source.statementObject, statementBytesSha256: sha(approval.bytes) },
    { role: 'backendRelease', kind: 'teacher-units-backend-release', address: release.ref, suppliedSha256: sha(release.bytes) },
  ];
  const checks = [
    check('identity', 'passed', `${expected.environment} ${expected.projectId} ${expected.projectNumber} us-central1 for every component`),
    check('plan.approvalCandidate', 'passed', 'deployment approval candidate binds this plan content object and its fingerprints'),
    check('expectedAccess.plan', 'passed', 'runtime service accounts and ingress equal the plan for all nine endpoints'),
    check('observation.plan', 'passed', 'S4 compareObservationToPlan matched at evaluatedAt'),
    check('accessReview.observation', 'passed', 'S5 assertAccessReview re-applied at evaluatedAt; receipt bound to this observation, plan and expected access'),
    check('endpoints.nine', 'passed', 'exactly the nine sorted A3 endpoints'),
    check('serviceAccounts', 'passed', 'plan, expected access and observed runtime service accounts agree'),
    check('release.deploymentBinding', 'passed', 'validateBackendRelease, validateDeploymentBinding and the release reference passed'),
    check('accessReview.levelB', 'not-observed', `S5 level A only; unresolved: ${AR.unresolvedSurfaces().join(', ')}`),
    check('buildRecord.deployed', 'not-observed', 'D12 deferred: the deployed a3-runtime-build.json is not read; sourceSha and sourceTree come from the deployment approval candidate, not from the deployed artifact'),
    check('hostingCandidate', 'deferred', 'D13 deferred: no Hosting candidate is verified'),
    check('storage.retrieval', 'unverifiable', 'D9: content object locations are not retrieved; only supplied bytes are hash-checked'),
    check('observation.freshness.historical', 'passed', `S4 and S5 windows satisfied at evaluatedAt ${release.evaluatedAt}; historical only, never current activation validity`),
  ];
  try { FR.assertObservationFresh(observation, assembledAt); checks.push(check('observation.freshness.current', 'passed', 'within five minutes at assembledAt; enable still requires a fresh S6c observation')); }
  catch (e) { checks.push(check('observation.freshness.current', 'failed', e.message.replace(/^\[[^\]]+\] REFUSED: /, ''))); }
  checks.push(signatureCheck('deploymentApproval', approval.document, authority, expected));
  checks.push(revocationCheck('deploymentApproval', approval.ref, authority, expected));
  checks.push(freshnessCheck('deploymentApproval', approval.statement, assembledAt, 'registration'));

  // Certification (D7). Bindings and hashes refuse; authority is recorded.
  let cert = null;
  if (certification === undefined) {
    if (activationApproval !== undefined || activationEvidence !== undefined) refuse('activation evidence requires a certification');
    checks.push(check('certification', 'absent', 'no certification supplied'));
  } else {
    if (certification === null || typeof certification !== 'object') refuse('certification input must be an object');
    const { reportBytes, ...signed } = certification;
    cert = signedInput(signed, V.validateReleaseCertification, expected, 'certification');
    const s = cert.statement;
    if (s.backendReleaseId !== release.releaseId) refuse('certification does not bind this release');
    if (s.placementFingerprint !== manifest.placementFingerprint) refuse('certification placement mismatch');
    if (s.enforcementVersion !== manifest.enforcementVersion || s.clientContractVersion !== manifest.supportedClientContractVersions[0]) refuse('certification enforcement or contract mismatch');
    components.push({ role: 'releaseCertification', kind: cert.document.payload.kind, address: cert.ref, suppliedSha256: sha(canonical(cert.document)),
      statementObject: cert.document.payload.source.statementObject, statementBytesSha256: sha(cert.bytes) });
    checks.push(check('certification.release', 'passed', 'binds this release, placement, enforcement and contract'));
    if (reportBytes === undefined) checks.push(check('certification.report', 'absent', 'certification report bytes not supplied; the report hash is unverified'));
    else {
      const bytes = bytesOf(reportBytes, 'certification report');
      if (sha(bytes) !== s.certificationReport.sha256) refuse('certification report bytes do not match certificationReport.sha256');
      components.push({ role: 'certificationReport', kind: 'certification-report', address: s.certificationReport, suppliedSha256: sha(bytes) });
      checks.push(check('certification.report', 'passed', 'supplied report bytes match certificationReport.sha256; content and independence not assessed'));
    }
    checks.push(signatureCheck('certification', cert.document, authority, expected));
    checks.push(revocationCheck('certification', cert.ref, authority, expected));
    checks.push(freshnessCheck('certification', s, assembledAt, 'registration'));
  }

  let act = null;
  if (activationApproval === undefined) {
    if (activationEvidence !== undefined) refuse('activation evidence requires its activation approval');
    checks.push(check('activationApproval', 'absent', 'no activation approval supplied'));
  } else {
    act = signedInput(activationApproval, V.validateActivationApproval, expected, 'activation approval');
    if (act.statement.backendReleaseId !== release.releaseId) refuse('activation approval does not bind this release');
    if (act.statement.certificationEvidenceRef !== cert.ref) refuse('activation approval does not name this certification');
    structural(B.validateCertificationBinding(cert.document, act.document, release.document, expected), 'certification binding');
    components.push({ role: 'activationApproval', kind: act.document.payload.kind, address: act.ref, suppliedSha256: sha(canonical(act.document)),
      statementObject: act.document.payload.source.statementObject, statementBytesSha256: sha(act.bytes) });
    checks.push(check('activationApproval.certification', 'passed', 'validateCertificationBinding passed for this release, certification and approval'));
    checks.push(signatureCheck('activationApproval', act.document, authority, expected));
    checks.push(revocationCheck('activationApproval', act.ref, authority, expected));
    checks.push(freshnessCheck('activationApproval', act.statement, assembledAt, 'registration'));
  }
  if (activationEvidence === undefined) checks.push(check('activationEvidence', 'absent', 'no activation evidence supplied'));
  else {
    const evidence = plain(activationEvidence, 'activation evidence');
    structural(V.validateActivationEvidence(evidence, expected), 'activation evidence');
    const rebuilt = ST.prepareActivationEvidence({ approvalRef: act.ref, approval: act.document, expected });
    if (canonical(rebuilt.document) !== canonical(evidence)) refuse('activation evidence does not repeat its activation approval');
    components.push({ role: 'activationEvidence', kind: evidence.payload.kind, address: rebuilt.ref, suppliedSha256: sha(canonical(evidence)) });
    checks.push(check('activationEvidence.approval', 'passed', 'repeats the activation approval bindings exactly; unsigned, no authority'));
    checks.push(revocationCheck('activationEvidence', rebuilt.ref, authority, expected));
  }
  checks.push(check('activationBinding', 'deferred', 'validateActivationBinding and the S3 chain need an enabled policy (S6a enable, S6c cloud enable)'));

  const pkg = { schemaVersion: 1, kind: PACKAGE_KIND, authorization: AUTHORIZATION, providerVerified: false, accessReviewLevel: 'A-structural',
    releaseAuthorized: false, activationReady: false, ...expected, region: 'us-central1', evidenceClass,
    declaredProvenance: { value: receiptValue.provenance, note: PROVENANCE_NOTE }, evaluatedAt: release.evaluatedAt, assembledAt,
    authority: authority.record, release: { ref: release.ref, releaseId: release.releaseId }, components, checks, unresolved: [...UNRESOLVED] };
  assertPackageShape(pkg);
  return { pkg, bytes: Buffer.from(canonical(pkg), 'utf8'), release };
}

// --- package schema (fixed non-authorizing literals; unknown keys refuse) -------
const PACKAGE_KEYS = ['schemaVersion', 'kind', 'authorization', 'providerVerified', 'accessReviewLevel', 'releaseAuthorized', 'activationReady',
  'environment', 'projectId', 'projectNumber', 'region', 'evidenceClass', 'declaredProvenance', 'evaluatedAt', 'assembledAt', 'authority', 'release',
  'components', 'checks', 'unresolved'];
const COMPONENT_KEYS = ['role', 'kind', 'address', 'suppliedSha256'];
const OPTIONAL_COMPONENT_KEYS = ['statementObject', 'statementBytesSha256', 'observationFingerprint'];
function assertPackageShape(p) {
  exactKeys(p, PACKAGE_KEYS, 'evidence package');
  const fixed = { schemaVersion: 1, kind: PACKAGE_KIND, authorization: AUTHORIZATION, providerVerified: false, accessReviewLevel: 'A-structural',
    releaseAuthorized: false, activationReady: false, region: 'us-central1' };
  for (const [key, value] of Object.entries(fixed)) if (p[key] !== value) refuse(`evidence package ${key} must be ${JSON.stringify(value)}; a package is never authorization or provider verification`);
  if (!EVIDENCE_CLASSES.includes(p.evidenceClass)) refuse('evidence package evidenceClass unsupported');
  exactKeys(p.declaredProvenance, ['value', 'note'], 'evidence package declaredProvenance');
  exactKeys(p.authority, ['source', 'registrySha256', 'revocationListSha256'], 'evidence package authority');
  if (!Object.values(AUTHORITY_SOURCES).includes(p.authority.source)) refuse('evidence package authority source unsupported');
  exactKeys(p.release, ['ref', 'releaseId'], 'evidence package release');
  if (!Array.isArray(p.components) || !Array.isArray(p.checks) || canonical(p.unresolved) !== canonical(UNRESOLVED)) refuse('evidence package components, checks or unresolved gates malformed');
  for (const c of p.components) {
    if (c === null || typeof c !== 'object') refuse('evidence package component malformed');
    for (const key of Object.keys(c)) if (!COMPONENT_KEYS.includes(key) && !OPTIONAL_COMPONENT_KEYS.includes(key)) refuse(`evidence package component key ${key} unsupported`);
    for (const key of COMPONENT_KEYS) if (!Object.hasOwn(c, key)) refuse(`evidence package component ${key} missing`);
  }
  for (const c of p.checks) {
    exactKeys(c, ['check', 'status', 'detail'], 'evidence package check');
    if (!STATUSES.includes(c.status)) refuse(`evidence package check status ${c.status} unsupported`);
  }
  O.instant(p.evaluatedAt, 'package evaluatedAt'); O.instant(p.assembledAt, 'package assembledAt');
}

/** Assembles a candidate package. `assembledAt` is the explicit tooling clock. */
function assembleEvidencePackage(inputs) {
  const { pkg, bytes, release } = derivePackage(inputs);
  return Object.freeze({ authorization: AUTHORIZATION, package: pkg, bytes, sha256: sha(bytes), release: { ref: release.ref, releaseId: release.releaseId,
    document: release.document, bytes: release.bytes } });
}

/**
 * Verifies package bytes by re-deriving the package from the supplied evidence,
 * at the package's own recorded evaluatedAt and assembledAt, and requiring
 * byte-exact equality. No recorded check, status, class or literal is trusted:
 * each must be what the evidence itself yields.
 */
function verifyEvidencePackage(packageBytes, inputs) {
  const bytes = bytesOf(packageBytes, 'evidence package');
  let claimed;
  try { claimed = K.parseStrictJSON(bytes.toString('utf8')); } catch { refuse('evidence package is not strict JSON'); }
  if (canonical(claimed) !== bytes.toString('utf8')) refuse('evidence package bytes are not canonical JSON');
  assertPackageShape(claimed);
  if (inputs === null || typeof inputs !== 'object') refuse('package inputs required');
  if (Object.hasOwn(inputs, 'assembledAt') || Object.hasOwn(inputs, 'evaluatedAt')) refuse('verification uses the package instants; do not supply assembledAt or evaluatedAt');
  if (inputs.project !== claimed.projectId) refuse('evidence package identity differs from the explicit project');
  const derived = derivePackage({ ...inputs, evaluatedAt: claimed.evaluatedAt, assembledAt: claimed.assembledAt });
  if (!derived.bytes.equals(bytes)) {
    const diff = PACKAGE_KEYS.filter(k => canonical(claimed[k]) !== canonical(derived.pkg[k]));
    refuse(`evidence package does not match the evidence it references: ${diff.join(', ') || 'bytes'}`);
  }
  return Object.freeze({ verified: true, scope: 'the package is exactly what the supplied evidence yields; it remains a non-authorizing candidate',
    authorization: AUTHORIZATION, sha256: sha(bytes), package: claimed });
}

module.exports = { PACKAGE_KIND, AUTHORIZATION, RELEASE_AUTHORIZATION, STATUSES, AUTHORITY_SOURCES, UNRESOLVED, assembleRelease,
  assembleEvidencePackage, verifyEvidencePackage };
