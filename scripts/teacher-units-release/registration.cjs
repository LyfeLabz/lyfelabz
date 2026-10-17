'use strict';

// A3-6 S6a: create-only registration of A3 release and evidence documents, EMULATOR
// ONLY. Every write target must be a `demo-` project on a loopback Firestore emulator;
// staging and production writes are not implemented in this slice and refuse. A
// registered document is content-addressed data, never authority: the runtime verifier
// re-checks every signature against the artifact-pinned registry on every request.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { assertStatementFresh, SIGNED_KINDS } = require('./freshness.cjs');
const { readStatementBytes } = require('./statements.cjs');

const FUNCTIONS_ROOT = path.resolve(__dirname, '../../platform/functions');
const LIB = path.join(FUNCTIONS_ROOT, 'lib/teacherUnits');
function refuse(message) { throw new Error(`[a3-registration] REFUSED: ${message}`); }
function compiled(name) {
  try { return require(path.join(LIB, name)); }
  catch { return refuse(`compiled A3 module ${name} unavailable; run npm --prefix platform/functions run build`); }
}
const K = compiled('a3-canonical.js');
const B = compiled('a3-bindings.js');
const S = compiled('a3-signature.js');
const R = compiled('a3-authority-registry.js');
const L = compiled('a3-revocation-list.js');
// The Functions package's own firebase-admin, so Timestamps and documents share the
// SDK instance the compiled A3 validators check against.
function functionsModule(name) { return require(require.resolve(name, { paths: [FUNCTIONS_ROOT] })); }

const DEMO_PROJECT = /^demo-[a-z0-9-]+$/;
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/;
const RELEASE_PREFIX = 'teacherUnitsBackendReleases/';
const EVIDENCE_PREFIX = 'teacherUnitsReleaseEvidence/';

/** Defense in depth, independent of the CLI: a write target is only ever an emulator. */
function assertEmulatorWriteTarget(expected, env = process.env) {
  if (expected === null || typeof expected !== 'object' || expected.environment !== 'emulator' || expected.projectNumber !== '0' ||
      typeof expected.projectId !== 'string' || !DEMO_PROJECT.test(expected.projectId)) {
    refuse('writes are emulator-only in S6a: a demo- project is required; staging and production writes are not implemented');
  }
  const host = env.FIRESTORE_EMULATOR_HOST;
  if (typeof host !== 'string' || !LOOPBACK_HOST.test(host)) refuse('writes require FIRESTORE_EMULATOR_HOST on a loopback address');
  for (const name of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']) {
    if (env[name] !== undefined && env[name] !== expected.projectId) refuse(`${name} disagrees with the target project`);
  }
}
// The client itself must be emulator-routed, whatever `env` a caller passes. Installed
// @google-cloud/firestore 7.11.6 records an emulator connection in its settings as
// ssl false with a loopback servicePath and a port; a cloud client has none of these.
// A different private shape fails closed.
const LOOPBACK_SERVICE = Object.freeze(['127.0.0.1', 'localhost', '::1', '[::1]']);
function assertDatabase(db, expected) {
  let projectId, settings;
  try { projectId = db.projectId; settings = db._settings; } catch { projectId = undefined; }
  if (projectId !== expected.projectId) refuse('Firestore client is not bound to the target emulator project');
  if (!settings || settings.ssl !== false || !LOOPBACK_SERVICE.includes(settings.servicePath) || !Number.isInteger(settings.port)) {
    refuse('Firestore client is not routed to a loopback emulator');
  }
}

/** A Firestore client for the emulator target. Never resolves credentials. */
function emulatorFirestore(expected, env = process.env) {
  assertEmulatorWriteTarget(expected, env);
  const { initializeApp, deleteApp } = functionsModule('firebase-admin/app');
  const { getFirestore } = functionsModule('firebase-admin/firestore');
  const app = initializeApp({ projectId: expected.projectId }, `a3-s6a-${randomUUID()}`);
  const db = getFirestore(app);
  assertDatabase(db, expected);
  return { db, close: () => deleteApp(app) };
}

function structural(result, description) {
  if (!result.ok) refuse(`${description} structure invalid at ${result.issue.path}: ${result.issue.reason}`);
  return result.value;
}
function snapshot(value, description) {
  try { return K.parseStrictJSON(K.canonicalJSON(value)); } catch { return refuse(`${description} is not plain canonical JSON data`); }
}
function requireNotRevoked(list, ref, expected) {
  const status = L.revocationStatus(list, ref, expected);
  if (status === 'revoked') refuse(`${ref} is on the pinned revocation list`);
  if (status !== 'notRevoked') refuse(`revocation status unresolved for ${ref} (${status})`);
}

// Each dependency must already be registered (A3-1 dependency order) and bind to the
// proposed document; checked inside the registration transaction.
function dependenciesOf(ref, document, expected) {
  if (ref.startsWith(RELEASE_PREFIX)) {
    return [{ ref: document.manifest.deploymentApprovalEvidenceRef,
      check: dep => structural(B.validateDeploymentBinding(document, dep, expected), 'release deployment binding') }];
  }
  const p = document.payload, releaseOf = id => `${RELEASE_PREFIX}${id}`;
  switch (p.kind) {
    case 'teacher-units-deployment-approval': return [];
    case 'teacher-units-release-certification':
      return [{ ref: releaseOf(p.statement.backendReleaseId), check: dep => structural(B.validateReleaseReference(releaseOf(p.statement.backendReleaseId), dep, expected), 'certified release') }];
    case 'teacher-units-activation-approval': {
      const release = releaseOf(p.statement.backendReleaseId);
      const deps = [{ ref: release, check: dep => structural(B.validateReleaseReference(release, dep, expected), 'activated release') }];
      deps.push({ ref: p.statement.certificationEvidenceRef, check: (dep, all) => structural(B.validateCertificationBinding(dep, document, all.get(release), expected), 'certification binding') });
      return deps;
    }
    case 'teacher-units-activation': {
      const approval = p.authorizationEvidenceRef;
      return [{ ref: approval, check: dep => {
        const a = structural(B.validateEvidenceReference(approval, dep, expected), 'activation approval');
        if (a.payload.kind !== 'teacher-units-activation-approval') refuse('activation evidence must name an activation approval');
        for (const key of ['policyInstanceId', 'enabledGeneration', 'backendReleaseId', 'clientContractVersion', 'placementFingerprint', 'hostingCandidateFingerprint', 'certificationEvidenceRef']) {
          if (a.payload.statement[key] !== p[key]) refuse(`activation evidence ${key} differs from its approval`);
        }
      } }];
    }
    case 'teacher-units-approval-disposition': {
      // A disposition records a decision about its target, which may already be pinned
      // as revoked; its target and replacement are therefore not revocation-checked.
      const s = p.statement, refs = [s.targetApprovalRef, ...(s.replacementApprovalRef ? [s.replacementApprovalRef] : [])];
      const bind = (dep, all) => structural(B.validateDispositionBinding(document, all.get(s.targetApprovalRef),
        s.replacementApprovalRef ? all.get(s.replacementApprovalRef) : null, expected), 'disposition binding');
      return refs.map((r, i) => ({ ref: r, disposed: true, check: i === refs.length - 1 ? bind : () => undefined }));
    }
    default: return refuse('unsupported evidence kind');
  }
}

/** Pure preparation: content address, statement bytes, signature against the supplied
 * branded registry, D6 freshness, revocation, and the confirmation digest. */
function prepareRegistration({ document, expected, registry, revocationList, statementBytes, now }) {
  const doc = snapshot(document, 'document');
  let ref;
  if (doc && typeof doc === 'object' && Object.hasOwn(doc, 'manifest')) {
    ref = `${RELEASE_PREFIX}${K.contentDigest(doc.manifest)}`;
    structural(B.validateReleaseReference(ref, doc, expected), 'release document');
  } else {
    ref = K.evidenceRef(doc?.payload);
    structural(B.validateEvidenceReference(ref, doc, expected), 'evidence document');
  }
  if (!R.isAuthorityRegistry(registry)) refuse('an authority registry produced by createAuthorityRegistry is required');
  if (!L.isRevocationList(revocationList)) refuse('a revocation list produced by createRevocationList is required');
  const kind = ref.startsWith(RELEASE_PREFIX) ? 'teacher-units-backend-release' : doc.payload.kind;
  if (SIGNED_KINDS.includes(kind)) {
    // Stand-in for retrieving the statement object: the supplied bytes must be exactly
    // the canonical statement at its recorded hash.
    const statement = readStatementBytes(statementBytes, doc.payload.source.statementObject.sha256);
    if (K.canonicalJSON(statement) !== K.canonicalJSON(doc.payload.statement)) refuse('statement bytes differ from the document statement');
    const signature = S.verifyApprovalSignature(doc, registry, expected);
    if (signature.verdict !== 'verified') refuse(`signature unverified: ${signature.reason}`);
    assertStatementFresh(kind, doc.payload.statement, now, 'registration');
  } else if (statementBytes !== undefined) refuse('statement bytes apply only to signed statements');
  const dependencies = dependenciesOf(ref, doc, expected);
  for (const r of [ref, ...dependencies.filter(d => !d.disposed).map(d => d.ref)]) if (r.startsWith(EVIDENCE_PREFIX)) requireNotRevoked(revocationList, r, expected);
  if (ref.startsWith(RELEASE_PREFIX)) requireNotRevoked(revocationList, doc.manifest.deploymentApprovalEvidenceRef, expected);
  const intent = { kind: 'lyfelabz.teacherUnitsA3RegistrationIntent', schemaVersion: 1, environment: expected.environment,
    projectId: expected.projectId, projectNumber: expected.projectNumber, ref, documentSha256: K.contentDigest(doc),
    dependencies: dependencies.map(d => d.ref) };
  return Object.freeze({ ref, kind, document: doc, dependencies, intent, confirmDigest: K.contentDigest(intent) });
}

// A disposition is the signed audit record of a decision. Registering one changes no
// verifier outcome: only a pinned revocation-list entry shipped by redeploy refuses its
// target (D5 R2, S3 O4). Printed with every disposition so it is never read as revocation.
const DISPOSITION_EFFECT = 'audit record only: not a revocation; only a pinned revocation-list entry shipped by redeploy refuses its target (D5 R2, S3 O4)';
const DIGEST = /^[a-f0-9]{64}$/;
const REGISTER_INPUTS = Object.freeze(['db', 'document', 'statementBytes', 'registry', 'revocationList', 'expected', 'confirm', 'now', 'env']);

/** Create-only write in one transaction. The writer accepts no prepared object: it
 * snapshots the raw inputs when called and, in every transaction attempt (including
 * each SDK rerun), rebuilds the whole preparation from those snapshots with that
 * attempt's tooling clock: content address and destination, statement bytes,
 * signature, D6 freshness, revocation, dependencies and the confirmation digest.
 * Dependencies and target are read first; an identical existing document is a
 * validated duplicate; anything else refuses. `now` is the tooling clock function. */
async function register(input) {
  if (input === null || typeof input !== 'object') refuse('registration inputs required');
  for (const key of Object.keys(input)) {
    if (!REGISTER_INPUTS.includes(key)) refuse(`register does not accept ${key}; it rebuilds every registration input itself`);
  }
  const { db, registry, revocationList, confirm, now = () => new Date().toISOString(), env = process.env } = input;
  // Immutable snapshots taken at the call: later caller mutation cannot reach the write.
  const expected = Object.freeze(snapshot(input.expected, 'target identity'));
  let documentText;
  try { documentText = K.canonicalJSON(input.document); } catch { refuse('document is not plain canonical JSON data'); }
  if (input.statementBytes !== undefined && !Buffer.isBuffer(input.statementBytes)) refuse('statement bytes must be a Buffer');
  const bytes = input.statementBytes === undefined ? undefined : Buffer.from(input.statementBytes);
  if (typeof now !== 'function') refuse('a tooling clock function is required');
  assertEmulatorWriteTarget(expected, env);
  assertDatabase(db, expected);
  if (typeof confirm !== 'string' || !DIGEST.test(confirm)) refuse('a --confirm <digest> from the dry run is required');
  return db.runTransaction(async tx => {
    const prepared = prepareRegistration({ document: K.parseStrictJSON(documentText), expected, registry, revocationList,
      statementBytes: bytes === undefined ? undefined : Buffer.from(bytes), now: now() });
    if (prepared.confirmDigest !== confirm) refuse('confirmation digest does not match this registration; run the dry run again');
    const found = new Map();
    for (const dep of prepared.dependencies) {
      const snap = await tx.get(db.doc(dep.ref));
      if (!snap.exists) refuse(`dependency not registered: ${dep.ref}`);
      found.set(dep.ref, snap.data());
    }
    for (const dep of prepared.dependencies) dep.check(found.get(dep.ref), found);
    const target = db.doc(prepared.ref);
    const existing = await tx.get(target);
    const effect = prepared.kind === 'teacher-units-approval-disposition' ? { effect: DISPOSITION_EFFECT } : {};
    if (existing.exists) {
      if (!B.validateImmutableDuplicate(prepared.ref, existing.data(), prepared.document, expected).ok) refuse(`a different document already exists at ${prepared.ref}`);
      return Object.freeze({ status: 'duplicate', ref: prepared.ref, ...effect });
    }
    tx.create(target, prepared.document);
    return Object.freeze({ status: 'created', ref: prepared.ref, ...effect });
  });
}

module.exports = { DISPOSITION_EFFECT, DEMO_PROJECT, LOOPBACK_HOST, functionsModule, assertEmulatorWriteTarget, assertDatabase, emulatorFirestore,
  prepareRegistration, register };
