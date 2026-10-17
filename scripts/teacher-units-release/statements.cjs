'use strict';

// A3-6 S6a: unsigned statement preparation, canonical signing bytes and assembly of a
// separately signed statement into its A3-1 evidence document. No key, no signing, no
// KMS: signing is a human operation outside this tool (D3, D4, D14). Every output is
// structure only; a prepared or assembled document confers no authority until its
// signature verifies against an artifact-pinned registry (S1, S3).
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { formatInstant } = require('./freshness.cjs');

const LIB = path.resolve(__dirname, '../../platform/functions/lib/teacherUnits');
function refuse(message) { throw new Error(`[a3-statements] REFUSED: ${message}`); }
function compiled(name) {
  try { return require(path.join(LIB, name)); }
  catch { return refuse(`compiled A3 module ${name} unavailable; run npm --prefix platform/functions run build`); }
}
const K = compiled('a3-canonical.js');
const V = compiled('a3-validation.js');
const B = compiled('a3-bindings.js');

// D14: the approval system identity of every statement this tool prepares. The D4
// registry entry for each action must name it; it cannot be overridden.
const APPROVAL_SYSTEM_ID = 'lyfelabz-operator-cli';
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KINDS = Object.freeze({
  'deployment-approval': Object.freeze({ kind: 'teacher-units-deployment-approval', action: 'deploy-backend', validate: V.validateDeploymentApprovalStatement }),
  'activation-approval': Object.freeze({ kind: 'teacher-units-activation-approval', action: 'activate-teacher-units', validate: V.validateActivationApprovalStatement }),
  'release-certification': Object.freeze({ kind: 'teacher-units-release-certification', action: 'certify-release', validate: V.validateReleaseCertificationStatement }),
  'approval-disposition': Object.freeze({ kind: 'teacher-units-approval-disposition', action: null, validate: V.validateApprovalDispositionStatement }),
});
const DOCUMENT_KINDS = Object.freeze(Object.fromEntries(Object.values(KINDS).map(k => [k.kind, k])));
// Fields the tool sets itself; supplying any of them refuses.
const RESERVED = Object.freeze(['environment', 'projectId', 'projectNumber', 'schemaVersion', 'kind', 'authority', 'issuedAt']);

function structural(result, description) {
  if (!result.ok) refuse(`${description} structure invalid at ${result.issue.path}: ${result.issue.reason}`);
  return result.value;
}
function plainCopy(value, description) {
  try { return K.parseStrictJSON(K.canonicalJSON(value)); } catch { return refuse(`${description} is not plain canonical JSON data`); }
}
function identityOf(expected) {
  return { environment: expected.environment, projectId: expected.projectId, projectNumber: expected.projectNumber };
}
function workflowRunId(value = randomUUID()) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) refuse('workflowRunId must be a lowercase UUID v4');
  return value;
}

/** Prepares one unsigned statement for `expected`. `fields` is the kind-specific body;
 * the identity, kind, authority (with the fixed approval system and a fresh run ID)
 * and issuedAt are set here. Returns the canonical statement bytes and the A3-1
 * domain-separated signing bytes for the human signer. */
function prepareStatement({ kind, expected, fields, authority, runId, now }) {
  const spec = Object.hasOwn(KINDS, kind) ? KINDS[kind] : refuse(`unknown statement kind: ${kind}`);
  const body = plainCopy(fields, 'statement fields');
  if (body === null || typeof body !== 'object' || Array.isArray(body)) refuse('statement fields must be an object');
  for (const key of RESERVED) if (Object.hasOwn(body, key)) refuse(`statement field ${key} is set by the tool`);
  if (spec.action !== null && Object.hasOwn(body, 'action')) refuse('statement field action is set by the tool');
  const a = plainCopy(authority, 'authority');
  if (a === null || typeof a !== 'object' || Object.keys(a).sort().join() !== 'approverSubject,authorityId,decisionId') {
    refuse('authority must be exactly {authorityId, approverSubject, decisionId}');
  }
  const statement = {
    ...identityOf(expected), schemaVersion: 1, kind: spec.kind, ...(spec.action === null ? {} : { action: spec.action }),
    ...(spec.kind === 'teacher-units-deployment-approval' ? { region: 'us-central1', databaseId: '(default)' } : {}), ...body,
    authority: { authorityId: a.authorityId, approverSubject: a.approverSubject, approvalSystemId: APPROVAL_SYSTEM_ID,
      workflowId: `teacher-units-release statement prepare ${kind}`, workflowRunId: workflowRunId(runId), decisionId: a.decisionId },
    issuedAt: formatInstant(now),
  };
  structural(spec.validate(statement, expected), `${kind} statement`);
  const statementBytes = Buffer.from(K.canonicalJSON(statement), 'utf8');
  const signingBytes = Buffer.from(K.approvalSigningBytes(statement));
  return Object.freeze({ statement, statementBytes, statementSha256: K.sha256Bytes(statementBytes),
    signingBytes, signingBytesSha256: K.sha256Bytes(signingBytes), authority: 'none: unsigned statement' });
}

/** Strict reader for statement bytes: strict JSON, exactly canonical, matching hash. */
function readStatementBytes(bytes, expectedSha256) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) refuse('statement bytes required');
  if (expectedSha256 !== undefined && K.sha256Bytes(bytes) !== expectedSha256) refuse('statement bytes do not match the statement object hash');
  const text = bytes.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(bytes) !== 0) refuse('statement bytes are not valid UTF-8');
  let statement;
  try { statement = K.parseStrictJSON(text); } catch { refuse('statement bytes are not strict JSON'); }
  if (K.canonicalJSON(statement) !== text) refuse('statement bytes are not canonical JSON');
  return statement;
}

/** Wraps statement bytes and a separately produced signature into the A3-1 evidence
 * document. Structure only: the signature is not verified here (registration does). */
function assembleSignedDocument({ statementBytes, statementObject, signerKeyId, signatureBase64, expected }) {
  const statement = readStatementBytes(statementBytes);
  const spec = statement && Object.hasOwn(DOCUMENT_KINDS, statement.kind) ? DOCUMENT_KINDS[statement.kind] : refuse('statement kind is not a signed A3 statement');
  structural(spec.validate(statement, expected), 'statement');
  const location = plainCopy(statementObject, 'statement object location');
  if (location === null || typeof location !== 'object' || Object.keys(location).sort().join() !== 'bucket,generation,object') {
    refuse('statement object location must be exactly {bucket, object, generation}');
  }
  const payload = { schemaVersion: 1, kind: spec.kind, statement,
    source: { statementObject: { ...location, sha256: K.sha256Bytes(statementBytes) }, signerKeyId, signatureAlgorithm: 'ed25519', signatureBase64 } };
  const document = { schemaVersion: 1, payload };
  const ref = K.evidenceRef(payload);
  structural(B.validateEvidenceReference(ref, document, expected), 'signed evidence document');
  return Object.freeze({ ref, document, signatureVerification: 'not performed' });
}

/** The unsigned activation evidence (A3-1) repeating a registered activation approval's
 * bindings and naming it as the authorization. */
function prepareActivationEvidence({ approvalRef, approval, expected }) {
  const a = structural(B.validateEvidenceReference(approvalRef, approval, expected), 'activation approval');
  if (a.payload.kind !== 'teacher-units-activation-approval') refuse('an activation approval is required');
  const s = a.payload.statement;
  const payload = { ...identityOf(s), schemaVersion: 1, kind: 'teacher-units-activation', policyInstanceId: s.policyInstanceId,
    enabledGeneration: s.enabledGeneration, backendReleaseId: s.backendReleaseId, clientContractVersion: s.clientContractVersion,
    placementFingerprint: s.placementFingerprint, hostingCandidateFingerprint: s.hostingCandidateFingerprint,
    certificationEvidenceRef: s.certificationEvidenceRef, authorizationEvidenceRef: approvalRef };
  const document = { schemaVersion: 1, payload };
  const ref = K.evidenceRef(payload);
  structural(B.validateEvidenceReference(ref, document, expected), 'activation evidence');
  return Object.freeze({ ref, document });
}

module.exports = { APPROVAL_SYSTEM_ID, KINDS, DOCUMENT_KINDS, workflowRunId, prepareStatement, readStatementBytes,
  assembleSignedDocument, prepareActivationEvidence };
