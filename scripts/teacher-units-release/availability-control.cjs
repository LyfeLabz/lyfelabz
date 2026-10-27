'use strict';
// Option B operator control. No import of historical authorization or markers.
// Cloud execution is never implicit. Explicit direct service-account keys or
// pinned per-project impersonation are supported; user credentials are never the
// operator identity. Actual external use still requires owner authorization.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../../platform/functions');
const req = name => require(require.resolve(name, { paths: [ROOT] }));
const lib = name => require(path.join(ROOT, 'lib', name));
const K = lib('teacherUnits/a3-canonical.js');
const P = lib('teacherUnits/availability-policy.js');
const V = lib('teacherUnits/availability-protocol.js');
const B = lib('teacherUnits/availability-runtime-build.js');
const A = lib('shared/audit/write-audit-event.js');
const T = lib('shared/types/audit-event.js');
const { Timestamp, FieldValue } = req('firebase-admin/firestore');
const POLICY = 'platformConfig/teacherUnitsAvailability', HISTORY = 'teacherUnitsAvailabilityHistory';
const CLOUD = { 'lyfelabz-prod': ['production', '182791689935'], 'lyfelabz-staging': ['staging', '293337283840'] };
const READ = ['datastore.databases.get', 'datastore.entities.get'];
const WRITE = [...READ, 'datastore.entities.create', 'datastore.entities.update'];
class Refusal extends Error { constructor(code) { super(`Option B REFUSED: ${code}`); this.code = code; } }
function deny(code) { throw new Refusal(code); }
function checked(r) { if (!r.ok) deny(r.issue.reason); return r.value; }
function exact(value, fields) { V.object(Object.fromEntries(fields.map(k => [k, () => {}])))(value, '$'); return value; }
function equal(a, b) { return K.canonicalJSON(encode(a)) === K.canonicalJSON(encode(b)); }
function encode(v) {
  if (v instanceof Timestamp) return { seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}
function ts(v) { exact(v, ['seconds', 'nanoseconds']); V.integer(-62135596800, 253402300799)(v.seconds, '$'); V.integer(0, 999999999)(v.nanoseconds, '$'); return new Timestamp(v.seconds, v.nanoseconds); }
function policyFrom(v) { const r = { ...v }; for (const k of ['createdAt', 'updatedAt', 'lastEnabledAt', 'lastClosedAt']) if (r[k] !== null) r[k] = ts(r[k]); return r; }
function millis(v) { if (typeof v !== 'string' || new Date(Date.parse(v)).toISOString() !== v) deny('invalid time'); return Date.parse(v); }
function target(project, env = {}) {
  if (typeof project !== 'string') deny('explicit --project required');
  for (const k of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']) if (env[k] !== undefined && env[k] !== project) deny('ambiguous ambient target');
  if (env.FIREBASE_CONFIG !== undefined && K.parseStrictJSON(env.FIREBASE_CONFIG).projectId !== project) deny('ambiguous Firebase target');
  const cloud = Object.hasOwn(CLOUD, project);
  if (cloud && ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FUNCTIONS_EMULATOR'].some(k => env[k] !== undefined)) deny('cloud/emulator mismatch');
  if (!cloud && !/^demo-[a-z0-9-]+$/.test(project)) deny('unsupported target');
  return Object.freeze({ environment: cloud ? CLOUD[project][0] : 'emulator', projectId: project,
    projectNumber: cloud ? CLOUD[project][1] : '0', region: 'us-central1', databaseId: '(default)' });
}
const cas = (snapshot, identity) => {
  const valid = snapshot.exists ? P.validateAvailabilityPolicy(snapshot.data(), identity) : null;
  return { updateTime: snapshot.exists ? snapshot.updateTime : null,
    policyInstanceId: valid?.ok ? valid.value.policyInstanceId : null, generation: valid?.ok ? valid.value.generation : null };
};
const state = (raw, identity) => { const r = P.validateAvailabilityPolicy(raw, identity); return raw === null ? 'missing' : r.ok ? r.value.mode : 'invalid'; };
function context(c, identity, permissions, now) {
  exact(c, ['operator', 'target', 'permissions', 'expiresAt', 'source']);
  if (!equal(c.target, identity) || !Array.isArray(c.permissions) || permissions.some(p => !c.permissions.includes(p))) deny('operator not authorized for target');
  if (!['verified-provider', 'synthetic-demo'].includes(c.source) || (c.source === 'synthetic-demo' && identity.environment !== 'emulator')) deny('unverified credentials');
  if (!Number.isSafeInteger(c.expiresAt) || c.expiresAt <= now + 30000) deny('expired or ambiguous credentials');
  // Reuse the canonical audit validator for exact attribution grammar.
  A.buildAuditEventWrite(auditInput({ transitionId: '00000000-0000-4000-8000-000000000001', transition: 'initialize', next: {
    policyInstanceId: '00000000-0000-4000-8000-000000000002', generation: 1, mode: 'closed', approvedBackendBuildId: null,
    placementFingerprint: 'a'.repeat(64), updatedBy: c.operator, reason: 'Credential shape check', approvalRef: null } }));
  return checked(V.validate(() => {}, c));
}
function auditInput(plan) {
  const p = plan.next;
  return { actorRole: 'operator', actorUserId: p.updatedBy.principalSubject, action: 'teacherUnits.availabilityChanged',
    targetType: 'teacherUnitsAvailability', targetId: POLICY, correlationId: plan.transitionId,
    payload: { transition: plan.transition, policyInstanceId: p.policyInstanceId, generation: p.generation, mode: p.mode,
      approvedBackendBuildId: p.approvedBackendBuildId, placementFingerprint: p.placementFingerprint,
      operator: p.updatedBy, reason: p.reason, approvalRef: p.approvalRef } };
}
function at(now, previous) {
  const t = Timestamp.fromMillis(now);
  if (previous && t.toMillis() <= previous.updatedAt.toMillis()) return new Timestamp(previous.updatedAt.seconds + 1, 0);
  return t;
}
function nextPolicy(command, raw, identity, operator, options, now, transitionId) {
  const valid = P.validateAvailabilityPolicy(raw, identity), before = valid.ok ? valid.value : null;
  if (command === 'close' && before?.mode === 'enabled' && before.generation === Number.MAX_SAFE_INTEGER) deny('still enabled; recovery required');
  if (command === 'close' && before?.mode === 'closed') return { transition: 'close', next: before };
  const time = at(now, before);
  const transition = command === 'prepare' && raw === null ? 'initialize' : command;
  let next;
  if (transition === 'initialize' || transition === 'recoverClosed') {
    next = { ...identity, schemaVersion: 2, enforcementVersion: 'teacher-units-option-b-v1', policyInstanceId: options.policyInstanceId,
      generation: 1, mode: 'closed', approvedBackendBuildId: null, acceptedClientContractVersions: [], placementFingerprint: options.placementFingerprint,
      createdAt: time, updatedAt: time, lastClosedAt: time, lastEnabledAt: null };
  } else {
    if (!before) deny('valid existing policy required; separate recovery for legacy/malformed state');
    next = { ...before, generation: before.generation + 1, updatedAt: time };
    if (transition === 'prepare') {
      next.approvedBackendBuildId = options.backendBuildId; next.placementFingerprint = options.placementFingerprint;
      if (before.mode === 'closed' && before.approvedBackendBuildId === next.approvedBackendBuildId && before.placementFingerprint === next.placementFingerprint)
        return { transition, next: before };
    } else if (transition === 'enable') { next.mode = 'enabled'; next.acceptedClientContractVersions = ['teacher-units-v3']; next.lastEnabledAt = time; }
    else if (transition === 'close') { next.mode = 'closed'; next.acceptedClientContractVersions = []; next.lastClosedAt = time; }
    else deny('unknown transition');
  }
  return { transition, next: { ...next, updatedBy: operator, transitionId, reason: options.reason, approvalRef: options.approvalRef ?? null } };
}
function transitionInput(plan, raw, observed) {
  return { transition: plan.transition, previous: raw, observedUpdateTime: observed.updateTime, expected: plan.expected,
    next: plan.next, recoveryAuthorization: plan.recoveryAuthorization };
}
function intentFor(p) {
  const next = { ...p.next };
  // Only server-generated timestamp positions are excluded. Retained historical
  // timestamps remain bound by the previous validated digest and exact CAS.
  for (const k of ['createdAt', 'updatedAt', 'lastEnabledAt', 'lastClosedAt']) delete next[k];
  return { schemaVersion: 1, kind: 'teacher-units-option-b-intent', target: p.target, command: p.command, transition: p.transition,
    transitionId: p.transitionId, expected: encode(p.expected), previousPolicyDigest: p.previousPolicyDigest,
    next: encode(next), recoveryAuthorization: encode(p.recoveryAuthorization), issuedAt: p.issuedAt,
    // Executor is independent of attribution retained by an unchanged policy.
    executor: p.executor, credentialSubject: p.credentialSubject, evidence: p.evidence, privateBeforeDigest: p.privateBeforeDigest };
}
function serializePlan(p) { return encode(p); }
function restorePlan(value) {
  const p = K.parseStrictJSON(K.canonicalJSON(value));
  exact(p, ['schemaVersion', 'kind', 'target', 'command', 'transition', 'transitionId', 'expected', 'previousPolicyDigest', 'next', 'recoveryAuthorization',
    'issuedAt', 'executor', 'credentialSubject', 'evidence', 'privateBeforeSnapshot', 'privateBeforeDigest', 'confirm']);
  if (p.schemaVersion !== 1 || p.kind !== 'teacher-units-option-b-plan') deny('unsupported plan version');
  V.uuid(p.transitionId, '$.transitionId');
  const transitions = { prepare: ['initialize', 'prepare'], enable: ['enable'], close: ['close'], recoverClosed: ['recoverClosed'] };
  if (!Object.hasOwn(transitions, p.command) || !transitions[p.command].includes(p.transition)) deny('command/transition mismatch');
  if (!['prepare', 'enable'].includes(p.command) && p.evidence !== null) deny('closure/recovery must not depend on release evidence');
  exact(p.executor, ['principalSubject', 'credentialSubject', 'delegationSubject']);
  exact(p.expected, ['updateTime', 'policyInstanceId', 'generation']);
  p.expected = { ...p.expected, updateTime: p.expected.updateTime === null ? null : ts(p.expected.updateTime) };
  p.next = policyFrom(p.next);
  if (p.recoveryAuthorization) p.recoveryAuthorization = { ...p.recoveryAuthorization, expected: { ...p.recoveryAuthorization.expected,
    updateTime: p.recoveryAuthorization.expected.updateTime === null ? null : ts(p.recoveryAuthorization.expected.updateTime) } };
  V.nullable(V.digest)(p.previousPolicyDigest, '$.previousPolicyDigest');
  V.nullable(V.digest)(p.privateBeforeDigest, '$.privateBeforeDigest');
  if (p.privateBeforeDigest !== (p.privateBeforeSnapshot === null ? null : K.contentDigest(p.privateBeforeSnapshot))) deny('private before-snapshot digest mismatch');
  const prior = P.validateAvailabilityPolicy(p.privateBeforeSnapshot === null ? null : restoreBefore(p.privateBeforeSnapshot), p.target);
  if (p.previousPolicyDigest !== (prior.ok ? K.contentDigest(encode(prior.value)) : null)) deny('validated previous-policy digest mismatch');
  p.next = checked(P.validateAvailabilityPolicy(p.next, p.target));
  const proposed = checked(P.validateAvailabilityTransition(transitionInput(p, p.privateBeforeSnapshot === null ? null : restoreBefore(p.privateBeforeSnapshot), p.expected), p.target));
  if (proposed.kind === 'change' && p.next.transitionId !== p.transitionId) deny('command/next-policy transition ID mismatch');
  if (p.executor.credentialSubject !== p.credentialSubject || (proposed.kind === 'change' && !equal(p.executor,p.next.updatedBy))) deny('executor attribution mismatch');
  if (proposed.kind === 'change') A.buildAuditEventWrite(auditInput(p));
  if (p.confirm !== K.contentDigest(intentFor(p))) deny('confirmation intent mismatch');
  return p;
}
function sentinelPolicy(plan, previous) {
  const next = { ...plan.next }, stamp = FieldValue.serverTimestamp();
  next.updatedAt = stamp;
  if (['initialize', 'recoverClosed'].includes(plan.transition)) { next.createdAt = stamp; next.lastClosedAt = stamp; }
  else if (plan.transition === 'enable') next.lastEnabledAt = stamp;
  else if (plan.transition === 'close') next.lastClosedAt = stamp;
  else { next.createdAt = previous.createdAt; next.lastClosedAt = previous.lastClosedAt; next.lastEnabledAt = previous.lastEnabledAt; }
  return next;
}
function historyFor(plan, next, auditEventId) {
  return { schemaVersion: 2, kind: 'teacher-units-option-b-transition', transitionId: plan.transitionId, transition: plan.transition, ...plan.target,
    previousUpdateTime: plan.expected.updateTime, previousPolicyInstanceId: plan.expected.policyInstanceId, previousGeneration: plan.expected.generation,
    previousPolicyDigest: plan.previousPolicyDigest, nextPolicy: next, operator: next.updatedBy, reason: next.reason, approvalRef: next.approvalRef,
    intentDigest: plan.confirm, committedAt: next.updatedAt, auditEventId };
}
function validateHistory(h, plan, audit) {
  exact(h, ['schemaVersion', 'kind', 'transitionId', 'transition', 'environment', 'projectId', 'projectNumber', 'region', 'databaseId',
    'previousUpdateTime', 'previousPolicyInstanceId', 'previousGeneration', 'previousPolicyDigest', 'nextPolicy', 'operator', 'reason', 'approvalRef', 'intentDigest', 'committedAt', 'auditEventId']);
  if (!(h.committedAt instanceof Timestamp) || typeof h.auditEventId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(h.auditEventId)) deny('invalid committed evidence');
  if (h.previousUpdateTime !== null && !(h.previousUpdateTime instanceof Timestamp)) deny('SDK previous updateTime required');
  V.nullable(V.uuid)(h.previousPolicyInstanceId, '$'); V.nullable(V.generation)(h.previousGeneration, '$');
  V.nullable(V.digest)(h.previousPolicyDigest, '$'); V.digest(h.intentDigest, '$');
  const next = checked(P.validateAvailabilityPolicy(h.nextPolicy, plan.target));
  // Validate retained timestamps and the before/after transition using the
  // private snapshot carried by this exact confirmation, not history as authority.
  const previous = plan.privateBeforeSnapshot === null ? null : restoreBefore(plan.privateBeforeSnapshot);
  const actualPlan = { ...plan, next };
  checked(P.validateAvailabilityTransition(transitionInput(actualPlan, previous, plan.expected), plan.target));
  if (!equal(h, historyFor(plan, next, h.auditEventId)) || !equal(intentFor({ ...plan, next }), intentFor(plan))) deny('history/intent binding mismatch');
  if (!(audit?.occurredAt instanceof Timestamp) || !equal(audit.occurredAt, h.committedAt)) deny('audit timestamp mismatch');
  const { occurredAt, ...record } = audit; void occurredAt;
  if (!equal(record, A.buildAuditEventWrite(auditInput({ ...plan, next })).record)) deny('audit attribution mismatch');
  return next;
}
// Private lossless before-snapshot codec. Type tags preserve the distinction
// between real SDK timestamps and malformed JSON stand-ins; raw values never
// enter history/audit. Numeric strings also preserve malformed NaN/-0/floats.
function packBefore(v, depth = 0) {
  if (depth > 16) deny('private snapshot depth exceeded');
  if (v instanceof Timestamp) return ['timestamp', v.seconds, v.nanoseconds];
  if (v === null) return ['null'];
  if (typeof v === 'string') { V.stringRule(v, '$'); return ['string', v]; }
  if (typeof v === 'boolean') return ['boolean', v];
  if (typeof v === 'number') return ['number', Object.is(v, -0) ? '-0' : String(v)];
  if (Array.isArray(v)) return ['array', v.map(x => packBefore(x, depth + 1))];
  const record = V.plainRecord(v, '$');
  return ['record', Object.keys(record).sort().map(k => [k, packBefore(record[k], depth + 1)])];
}
function restoreBefore(v, depth = 0) {
  if (depth > 16 || !Array.isArray(v)) deny('invalid private snapshot');
  if (v[0] === 'timestamp' && v.length === 3) return ts({ seconds: v[1], nanoseconds: v[2] });
  if (v[0] === 'null' && v.length === 1) return null;
  if (v[0] === 'string' && v.length === 2 && typeof v[1] === 'string') return v[1];
  if (v[0] === 'boolean' && v.length === 2 && typeof v[1] === 'boolean') return v[1];
  if (v[0] === 'number' && v.length === 2 && typeof v[1] === 'string') {
    const n = Number(v[1]); if (String(n) !== v[1] && !(Object.is(n, -0) && v[1] === '-0')) deny('invalid numeric snapshot'); return n;
  }
  if (v.length !== 2 || !Array.isArray(v[1])) deny('invalid private snapshot');
  if (v[0] === 'array') return v[1].map(x => restoreBefore(x, depth + 1));
  if (v[0] === 'record') {
    const keys = new Set();
    return Object.fromEntries(v[1].map(pair => {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || keys.has(pair[0])) deny('invalid record snapshot');
      keys.add(pair[0]); return [pair[0], restoreBefore(pair[1], depth + 1)];
    }));
  }
  deny('unknown private snapshot version');
}
// Canonical audit grammar and server timestamp (buildAuditEventWrite), with the
// event allocated on the SAME bound Firestore instance as the transaction. The
// Functions helper allocates on the ambient Admin app, which an explicitly
// impersonated operator process never initializes.
function boundAuditWriter(db) {
  const events = db.collection(T.AUDIT_EVENTS_COLLECTION);
  return (tx, input) => {
    const { write, record } = A.buildAuditEventWrite(input);
    const ref = events.doc(); tx.set(ref, write);
    return { eventId: ref.id, record };
  };
}
/** All adapters are trusted server dependencies. Tests inject synthetic demo
 * contexts; the CLI never accepts a caller-provided credential verdict. */
function createController({ db, identity, authenticate, writeAudit,
  inspectBuild = B.inspectAvailabilityRuntimeArtifact, releaseEvidence = async () => deny('current-release evidence unavailable'), now = Date.now, uuid = randomUUID }) {
  identity = checked(V.validate(() => {}, identity));
  if (!equal(identity, target(identity.projectId, {}))) deny('invalid project/environment tuple');
  if (db.projectId !== identity.projectId || db.databaseId !== '(default)') deny('database target mismatch');
  writeAudit ??= boundAuditWriter(db);
  const policyRef = db.doc(POLICY);
  const auth = async permissions => context(await authenticate(), identity, permissions, now());
  async function verify(input) {
    const plan = restorePlan(serializePlan(input)); if (!equal(plan.target, identity)) deny('verify target mismatch'); await auth(READ);
    try {
      return await db.runTransaction(async tx => {
        const [p, e] = await Promise.all([tx.get(policyRef), tx.get(db.doc(`${HISTORY}/${plan.transitionId}`))]);
        const raw = p.exists ? p.data() : null, observed = cas(p, identity);
        if (!e.exists) return { status: equal(observed, plan.expected) ? 'not-committed' : 'conflicting', availability: state(raw, identity), shutdownConfirmed: false };
        const h = e.data();
        if (h.intentDigest !== plan.confirm || h.transitionId !== plan.transitionId) return { status: 'conflicting', availability: state(raw, identity), shutdownConfirmed: false };
        if (typeof h.auditEventId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(h.auditEventId)) deny('invalid audit reference');
        const audit = await tx.get(db.doc(`auditEvents/${h.auditEventId}`));
        const next = validateHistory(h, plan, audit.exists ? audit.data() : null);
        // Server timestamp transforms and storage updateTime need not have the
        // same precision. Compare transform fields to each other, and storage
        // updateTimes to each other, never coerce one into the other.
        if (!equal(e.updateTime, audit.updateTime)) deny('non-atomic evidence updateTimes');
        const current = P.validateAvailabilityPolicy(raw, identity);
        if (!current.ok) return { status: 'unconfirmed', availability: state(raw, identity), shutdownConfirmed: false };
        const same = equal(current.value, next);
        if (same && !equal(p.updateTime, e.updateTime)) deny('policy updateTime differs from committed event');
        return { status: same ? 'committed-current' : 'committed-superseded', availability: current.value.mode,
          shutdownConfirmed: same && next.mode === 'closed', scope: 'schema-2-policy-and-linked-evidence', fleetVerification: 'not-performed', transitionId: plan.transitionId };
      }, { readOnly: true });
    } catch { return { status: 'unconfirmed', availability: 'unconfirmed', shutdownConfirmed: false }; }
  }
  // A read-only validation result is not an enable proposal or release approval.
  async function preEnable(options = {}) {
    const c = await auth(WRITE);
    if (identity.environment === 'emulator') deny('current-release pre-enable check requires an explicit real-project target; synthetic transitions stay demo-only');
    const snapshot = await policyRef.get();
    const policy = checked(P.validateAvailabilityPolicy(snapshot.exists ? snapshot.data() : null, identity));
    if (policy.mode !== 'closed' || policy.approvedBackendBuildId === null) deny('pre-enable requires a prepared closed policy');
    const before = cas(snapshot, identity);
    const supplied = await releaseEvidence({ target: identity, policy, operator: c.operator, now: now() });
    const result = require('./option-b-observation.cjs').validateCurrentRelease(supplied, {
      target: identity, policy, now: new Date(now()).toISOString(), approvalRef: options.approvalRef,
    });
    // Evidence work may outlast credential/context/policy validity. Re-read the
    // singleton; this does not reserve a generation or commit availability.
    const after = await policyRef.get();
    if (!equal(before, cas(after, identity)) || !equal(policy, after.data())) deny('policy changed during pre-enable validation');
    const current = await auth(WRITE);
    if (!equal(current.operator, c.operator)) deny('operator changed during pre-enable validation');
    return { ...result, comparison: result, expected: encode(before), operator: current.operator, liveEnable: 'explicit-confirmation-required', policyInstanceId: policy.policyInstanceId,
      policyGeneration: policy.generation, availability: 'closed', shutdownConfirmed: false,
      scope: 'current-release-consistency-only', fleetVerification: 'not-performed' };
  }
  async function review(command, options = {}) {
    if (!['show', 'prepare', 'enable', 'close', 'recoverClosed'].includes(command)) deny('unknown command');
    const c = await auth(command === 'show' ? [...READ, 'datastore.entities.list'] : WRITE);
    let snapshot;
    try { snapshot = await policyRef.get(); }
    catch (error) { if (command === 'show') return { status: 'unconfirmed', availability: 'unconfirmed', recentHistory: null, shutdownConfirmed: false }; throw error; }
    const raw = snapshot.exists ? snapshot.data() : null;
    if (command === 'show') {
      const parsed = P.validateAvailabilityPolicy(raw, identity);
      let recent;
      try { recent = await db.collection(HISTORY).orderBy('committedAt', 'desc').limit(10).get(); }
      catch { return { status: 'unconfirmed', availability: state(raw, identity), recentHistory: null, shutdownConfirmed: false }; }
      const ids = recent.docs.map(d => d.id);
      return { status: 'observed', availability: state(raw, identity), expected: encode(cas(snapshot, identity)), policy: parsed.ok ? encode(parsed.value) : null,
        recentHistory: ids, historyScope: 'schema-2-indexed-window-only; legacy records remain historical',
        inconsistencies: parsed.ok && !ids.includes(parsed.value.transitionId) ? ['current transition not present in recent history window'] : [], shutdownConfirmed: false };
    }
    if (command === 'close' && raw === null) return { status: 'verified-noop', availability: 'missing', shutdownConfirmed: false, scope: 'schema-2-only' };
    let evidence = null;
    if (command === 'prepare') {
      const inspected = inspectBuild(options.buildRoot);
      const build = checked(B.validateAvailabilityRuntimeBuild(inspected.build));
      if (build.sourceDirty || build.deploymentMode !== 'policy-controlled' || build.sourceSha !== options.expectedSourceSha) deny('approved clean controlled build required');
      const age = now() - millis(options.releasePreparedAt); if (age < 0 || age > 86400000) deny('stale preparation record');
      options = { ...options, backendBuildId: build.backendBuildId, placementFingerprint: build.placementFingerprint };
      evidence = { backendBuildId: build.backendBuildId, releasePreparedAt: options.releasePreparedAt, sourceSha: build.sourceSha };
    }
    if (command === 'enable') {
      if (identity.environment !== 'emulator') {
        const current = await preEnable(options);
        if (!equal(encode(cas(snapshot, identity)), current.expected) || !equal(current.operator, c.operator)) deny('policy or operator changed while reviewing enable');
        evidence = current.comparison;
      } else {
        evidence = await releaseEvidence({ target: identity, policy: raw, operator: c.operator, now: now() });
        // Explicit synthetic fixtures authorize transitions only in the demo harness.
        exact(evidence, ['kind', 'observedAt', 'preparedAt', 'backendBuildId', 'placementFingerprint', 'approvalRef']);
        if (evidence.kind !== 'synthetic-option-b-release' || evidence.backendBuildId !== raw?.approvedBackendBuildId || evidence.placementFingerprint !== raw?.placementFingerprint || evidence.approvalRef !== options.approvalRef) deny('release evidence mismatch');
        for (const [field, age] of [['observedAt', 300000], ['preparedAt', 86400000]]) if (now() - millis(evidence[field]) < 0 || now() - millis(evidence[field]) > age) deny('stale release evidence');
      }
    }
    const transitionId = uuid();
    const proposed = nextPolicy(command, raw, identity, c.operator, { ...options, policyInstanceId: options.policyInstanceId ?? uuid() }, now(), transitionId);
    const expected = cas(snapshot, identity);
    const previous = P.validateAvailabilityPolicy(raw, identity);
    const plan = { schemaVersion: 1, kind: 'teacher-units-option-b-plan', target: identity, command, transitionId, ...proposed, expected,
      previousPolicyDigest: previous.ok ? K.contentDigest(encode(previous.value)) : null,
      recoveryAuthorization: options.recoveryAuthorization ?? null, issuedAt: new Date(now()).toISOString(), executor: c.operator, credentialSubject: c.operator.credentialSubject,
      evidence, privateBeforeSnapshot: raw === null ? null : packBefore(raw), privateBeforeDigest: raw === null ? null : K.contentDigest(packBefore(raw)) };
    const validated = checked(P.validateAvailabilityTransition(transitionInput(plan, raw, expected), identity));
    plan.next = validated.nextPolicy;
    if (validated.kind === 'change') A.buildAuditEventWrite(auditInput(plan));
    plan.confirm = K.contentDigest(intentFor(plan));
    return serializePlan(plan);
  }
  async function execute(input, confirmation) {
    const plan = restorePlan(input);
    if (!equal(plan.target, identity) || plan.confirm !== confirmation || plan.privateBeforeDigest !== (plan.privateBeforeSnapshot === null ? null : K.contentDigest(plan.privateBeforeSnapshot))) deny('target/confirmation mismatch');
    const age = now() - millis(plan.issuedAt); if (age < 0 || age > 600000) deny('confirmation expired');
    const c = await auth(WRITE);
    if (c.operator.credentialSubject !== plan.credentialSubject || !equal(c.operator, plan.executor)) deny('credential context changed');
    if (plan.command === 'prepare') {
      exact(plan.evidence, ['backendBuildId', 'releasePreparedAt', 'sourceSha']);
      const preparedAge = now() - millis(plan.evidence.releasePreparedAt);
      if (preparedAge < 0 || preparedAge > 86400000) deny('preparation record expired');
      if (plan.transition === 'prepare' && plan.evidence.backendBuildId !== plan.next.approvedBackendBuildId) deny('prepared build binding mismatch');
    }
    if (plan.command === 'enable') {
      if (identity.environment !== 'emulator') {
        const reconciled = await verify(serializePlan(plan));
        if (reconciled.status.startsWith('committed-')) return reconciled;
        const current = await preEnable({ approvalRef: plan.next.approvalRef });
        const stable = value => { const copy = { ...value }; delete copy.observedAt; return copy; };
        if (!equal(current.operator, c.operator) || !equal(current.expected, encode(plan.expected)) || !equal(stable(current.comparison), stable(plan.evidence))) deny('release or CAS changed; new explicit confirmation required');
      } else {
        const fresh = await releaseEvidence({ target: identity, policy: plan.next, operator: c.operator, now: now() });
        if (!equal(fresh, plan.evidence) || now() - millis(fresh.observedAt) > 300000 || now() - millis(fresh.preparedAt) > 86400000) deny('release observations changed or expired');
      }
    }
    let staged = false, noop = false, dispatchError = false;
    try {
      await db.runTransaction(async tx => {
        if (c.expiresAt <= now() + 30000) deny('credential expired during retry');
        if (plan.command === 'enable' && (now() - millis(plan.issuedAt) > 600000 || now() - millis(plan.evidence.observedAt) > 300000)) deny('enable evidence expired during retry');
        const [p, event] = await Promise.all([tx.get(policyRef), tx.get(db.doc(`${HISTORY}/${plan.transitionId}`))]);
        if (event.exists) {
          const h = event.data(); if (typeof h.auditEventId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(h.auditEventId)) deny('conflicting event');
          const a = await tx.get(db.doc(`auditEvents/${h.auditEventId}`)); validateHistory(h, plan, a.exists ? a.data() : null); return;
        }
        const raw = p.exists ? p.data() : null, observed = cas(p, identity);
        if (!equal(observed, plan.expected) || (plan.privateBeforeDigest !== (raw === null ? null : K.contentDigest(packBefore(raw))))) deny('stale compare-and-set');
        const result = checked(P.validateAvailabilityTransition(transitionInput(plan, raw, observed), identity));
        if (result.kind === 'noop') { noop = true; return; }
        const next = sentinelPolicy(plan, raw);
        // The canonical helper must be bound to this SAME Firestore instance.
        if (writeAudit === A.writeAuditEventInTransaction && lib('shared/firestore/admin.js').getAdminFirestore() !== db) deny('canonical audit database binding mismatch');
        const audit = writeAudit(tx, auditInput(plan));
        if (!audit || !/^[A-Za-z0-9]{20}$/.test(audit.eventId)) deny('invalid canonical audit allocation');
        tx.set(policyRef, next);
        tx.create(db.doc(`${HISTORY}/${plan.transitionId}`), historyFor(plan, next, audit.eventId));
        staged = true;
      });
    } catch { dispatchError = true; }
    let result;
    try { result = await verify(serializePlan(plan)); }
    catch { result = { status: 'unconfirmed', availability: 'unconfirmed', shutdownConfirmed: false }; }
    if (noop && !staged && !dispatchError && result.status === 'not-committed') return { status: 'verified-noop', availability: result.availability, scope: 'schema-2-policy-only', fleetVerification: 'not-performed', shutdownConfirmed: result.availability === 'closed' };
    if (dispatchError && !result.status.startsWith('committed-')) return { status: result.status === 'conflicting' ? 'conflicting' : 'unconfirmed', verification: result.status, availability: result.availability, shutdownConfirmed: false };
    return result;
  }
  return { review, execute, verify, preEnable };
}

/** Independently inspect the selected effective service-account access token,
 * pinned project identity and effective permissions. Provider transport is
 * injected in tests; no serialized --principal/authenticated label is used.
 * Database-conditional grants are not widened if a project permission probe
 * cannot establish them: this profile refuses. Project-wide blast radius must
 * already have a retained explicit owner access review; this tool grants none. */
async function verifyCredential({ client, identity, email, accessReview, impersonated = false, now = Date.now, write = false, list = false }) {
  exact(accessReview, ['schemaVersion', 'projectId', 'projectNumber', 'databaseId', 'principalSubject', 'permissionCheckScope', 'blastRadiusAccepted', 'approvalRef', ...(impersonated ? ['acceptedProjectRoles'] : [])]);
  if (impersonated && (!Object.hasOwn(IMPERSONATION, identity.projectId) || email !== IMPERSONATION[identity.projectId] ||
      !equal(accessReview.acceptedProjectRoles, ['roles/editor']))) deny('explicit Editor access approval for the pinned operator required');
  if (accessReview.schemaVersion !== 1 || accessReview.projectId !== identity.projectId || accessReview.projectNumber !== identity.projectNumber ||
      accessReview.databaseId !== '(default)' || accessReview.principalSubject !== email || accessReview.permissionCheckScope !== 'project' ||
      accessReview.blastRadiusAccepted !== true || typeof accessReview.approvalRef !== 'string' || !accessReview.approvalRef.trim()) deny('owner access review required for supported permission-check scope');
  const response = await client.getAccessToken();
  if (typeof response?.token !== 'string' || !response.token) deny('missing credential');
  const info = await client.getTokenInfo(response.token);
  if (info.email !== email || ![true, 'true'].includes(info.email_verified) || !Number.isSafeInteger(info.expiry_date) || info.expiry_date <= now() + 30000 ||
      !Array.isArray(info.scopes) || !info.scopes.includes('https://www.googleapis.com/auth/cloud-platform')) deny('ambiguous, expired or wrong effective credential');
  const project = (await client.request({ method: 'GET', url: `https://cloudresourcemanager.googleapis.com/v3/projects/${identity.projectId}` })).data;
  if (project.projectId !== identity.projectId || project.name !== `projects/${identity.projectNumber}` || project.state !== 'ACTIVE') deny('provider project identity mismatch');
  const permissions = [...(write ? WRITE : READ), ...(list ? ['datastore.entities.list'] : [])];
  const result = (await client.request({ method: 'POST', url: `https://cloudresourcemanager.googleapis.com/v1/projects/${identity.projectId}:testIamPermissions`, data: { permissions } })).data;
  if (!Array.isArray(result.permissions) || permissions.some(p => !result.permissions.includes(p))) deny('required IAM permissions not verified; no grant or scope expansion attempted');
  return { operator: { principalSubject: info.email, credentialSubject: info.email, delegationSubject: null }, target: identity,
    permissions: result.permissions, expiresAt: info.expiry_date, source: 'verified-provider' };
}
function parse(argv) {
  const command = argv[0]; if (!['show', 'prepare', 'enable', 'close', 'verify', 'recoverClosed', 'checkEnable'].includes(command)) deny('unknown availability command');
  const booleans = ['execute', 'live'], values = ['project', 'credentials', 'access-review', 'plan', 'out', 'confirm', 'build-root', 'expected-source-sha',
    'current-release-evidence', 'release-prepared-at', 'reason', 'approval-ref', 'policy-instance-id', 'placement-fingerprint', 'recovery-authorization'];
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    const key = typeof argv[i] === 'string' && argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!key || Object.hasOwn(flags, key) || ![...booleans, ...values].includes(key)) deny('unknown, duplicate or identity-label argument');
    if (booleans.includes(key)) flags[key] = true;
    else { const v = argv[++i]; if (typeof v !== 'string' || !v || v.startsWith('--')) deny('missing flag value'); flags[key] = v; }
  }
  if (!flags.project) deny('explicit --project required');
  if (Boolean(flags.execute) !== Boolean(flags.confirm) || flags.execute && !flags.plan) deny('execute requires saved plan and exact confirmation');
  if (['show', 'verify', 'checkEnable'].includes(command) && (flags.execute || flags.confirm)) deny('read-only command');
  if (command === 'verify' && !flags.plan) deny('verify requires the saved command plan');
  if (flags.plan && command !== 'verify' && !flags.execute) deny('a saved plan requires verify or explicit execution');
  return { command, flags };
}
function readJSON(file) { if (typeof file !== 'string') deny('explicit input file required'); return K.parseStrictJSON(fs.readFileSync(file, 'utf8')); }
// The installed Admin SDK supports certificate/ADC Firestore credentials, not
// arbitrary getAccessToken objects. Bind its certificate to the same explicitly
// selected, independently inspected service-account key; never discover ADC.
function selectedApp(identity, key) {
  const { getApps, initializeApp, cert } = req('firebase-admin/app');
  if (getApps().some(a => a.name === '[DEFAULT]')) deny('ambient default Admin app present; use a fresh operator process');
  return initializeApp({ projectId: identity.projectId, credential: cert({ projectId: key.project_id,
    clientEmail: key.client_email, privateKey: key.private_key }) });
}
// One pinned operator identity per project; each needs its own owner access review.
const IMPERSONATION = Object.freeze({ 'lyfelabz-staging': 'lyfelabz-staging@appspot.gserviceaccount.com',
  'lyfelabz-prod': 'lyfelabz-prod@appspot.gserviceaccount.com' });
const impersonationUrl = email => `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`;
const OPERATOR_SCOPES = ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email'];
// Explicit standard impersonation config only. Never use ADC, configured token
// endpoints, delegates, or the source user's token for Firestore/provider calls.
function operatorCredential(identity, key) {
  const { GoogleAuth, OAuth2Client, Impersonated } = req('google-auth-library');
  if (key.type === 'impersonated_service_account') {
    const fields = ['type', 'source_credentials', 'service_account_impersonation_url'];
    exact(key, [...fields, ...['delegates', 'quota_project_id'].filter(k => Object.hasOwn(key, k))]);
    const email = Object.hasOwn(CLOUD, identity.projectId) && identity.projectNumber === CLOUD[identity.projectId][1] ? IMPERSONATION[identity.projectId] : undefined;
    if (!email || key.service_account_impersonation_url !== impersonationUrl(email) ||
        key.delegates !== undefined && !equal(key.delegates, []) ||
        key.quota_project_id !== undefined && key.quota_project_id !== identity.projectId) deny('unapproved impersonation target or delegates');
    const source = key.source_credentials;
    exact(source, ['type', 'client_id', 'client_secret', 'refresh_token']);
    if (source.type !== 'authorized_user' || ['client_id', 'client_secret', 'refresh_token'].some(k => typeof source[k] !== 'string' || !source[k].trim())) deny('invalid explicit impersonation source');
    const sourceClient = new OAuth2Client({ clientId: source.client_id, clientSecret: source.client_secret });
    sourceClient.setCredentials({ refresh_token: source.refresh_token });
    const client = new Impersonated({ sourceClient, targetPrincipal: email, targetScopes: OPERATOR_SCOPES,
      delegates: [], lifetime: 600, endpoint: 'https://iamcredentials.googleapis.com' });
    return { client, email, impersonated: true };
  }
  if (key.type !== 'service_account' || typeof key.client_email !== 'string' || !/^[a-zA-Z0-9_.-]+@[a-z0-9.-]+\.gserviceaccount\.com$/.test(key.client_email) ||
      typeof key.private_key !== 'string' || key.token_uri !== 'https://oauth2.googleapis.com/token' ||
      key.universe_domain !== undefined && key.universe_domain !== 'googleapis.com' ||
      Object.keys(key).some(k => ['service_account_impersonation_url', 'credential_source', 'source_credentials', 'token_url'].includes(k))) deny('explicit direct service-account or approved staging impersonation credentials required');
  const auth = new GoogleAuth({ scopes: OPERATOR_SCOPES });
  return { client: auth.fromJSON(key), email: key.client_email, impersonated: false };
}
function impersonatedFirestore(identity, client) {
  // The Admin SDK certificate path cannot bind a custom OAuth client. Use the
  // installed Firestore SDK's explicit GoogleAuth transport; never initialize ADC.
  const { GoogleAuth } = req('google-auth-library');
  const { Firestore } = req('@google-cloud/firestore');
  if (req('firebase-admin/app').getApps().some(a => a.name === '[DEFAULT]')) deny('ambient default Admin app present; use a fresh operator process');
  const auth = new GoogleAuth({ authClient: client, projectId: identity.projectId });
  // Firestore debug settings serialization must never expose source refresh credentials.
  Object.defineProperty(auth, 'toJSON', { value: () => '[explicit impersonated operator auth]' });
  return new Firestore({ projectId: identity.projectId, databaseId: identity.databaseId,
    auth, host: 'firestore.googleapis.com', ssl: true });
}
async function connect(identity, flags, command) {
  if (identity.environment === 'emulator') deny('demo emulator requires an explicitly injected local operator profile; no credential impersonation fallback');
  if (!flags.live) deny('cloud connection requires separate external authorization and explicit --live');
  const key = readJSON(flags.credentials), accessReview = readJSON(flags['access-review']);
  const { client, email, impersonated } = operatorCredential(identity, key);
  const authenticate = () => verifyCredential({ client, identity, email, accessReview, impersonated,
    write: !['show', 'verify'].includes(command), list: command === 'show' });
  await authenticate();
  const { deleteApp } = req('firebase-admin/app');
  const app = impersonated ? null : selectedApp(identity, key);
  let db;
  const close = () => impersonated ? db?.terminate() : deleteApp(app);
  try {
    db = impersonated ? impersonatedFirestore(identity, client) : lib('shared/firestore/admin.js').getAdminFirestore();
    db.settings({ host: 'firestore.googleapis.com', ssl: true });
    if (db.projectId !== identity.projectId || db.databaseId !== '(default)' || db._settings?.ssl === false ||
        ['host', 'servicePath', 'apiEndpoint'].some(k => db._settings?.[k] !== undefined && db._settings[k] !== 'firestore.googleapis.com')) deny('bound database destination mismatch');
    const releaseEvidence = async () => {
      const bundle = readJSON(flags['current-release-evidence']);
      if (bundle?.projectId !== identity.projectId) deny('current-release evidence target mismatch before provider access');
      const token = await client.getAccessToken();
      if (typeof token?.token !== 'string' || !token.token) deny('verified current-release credential token unavailable');
      const get = require('../hosting-release/backend-state.cjs').readApi({ token: token.token });
      return require('./option-b-observation.cjs').refreshCurrentRelease(bundle, { get, now: () => new Date().toISOString() });
    };
    return { controller: createController({ db, identity, authenticate, releaseEvidence }), close };
  } catch (error) { await close(); throw error; }

}
async function main(argv, ctx = {}) {
  const stdout = ctx.stdout || process.stdout, stderr = ctx.stderr || process.stderr;
  let connection;
  try {
    const { command, flags } = parse(argv), identity = target(flags.project, ctx.env || process.env);
    let savedPlan;
    if (flags.plan) {
      savedPlan = readJSON(flags.plan); const restored = restorePlan(savedPlan);
      if (!equal(restored.target, identity)) deny('saved plan target mismatch');
      if (flags.execute && restored.command !== command) deny('saved plan command mismatch');
    }
    connection = ctx.connect ? await ctx.connect(identity, flags, command) : await connect(identity, flags, command);
    const controller = connection.controller;
    if (command === 'checkEnable') {
      const result = await controller.preEnable({ approvalRef: flags['approval-ref'] });
      stdout.write(`${K.canonicalJSON(result)}\n`); return 0;
    }
    let result;
    if (command === 'verify') result = await controller.verify(savedPlan);
    else if (flags.execute) {
      const plan = savedPlan; if (plan.command !== command) deny('saved plan command mismatch');
      result = await controller.execute(plan, flags.confirm);
    } else {
      const recoveryAuthorization = flags['recovery-authorization'] ? readJSON(flags['recovery-authorization']) : null;
      if (recoveryAuthorization?.expected?.updateTime) recoveryAuthorization.expected.updateTime = ts(recoveryAuthorization.expected.updateTime);
      result = await controller.review(command, { buildRoot: flags['build-root'], expectedSourceSha: flags['expected-source-sha'],
        releasePreparedAt: flags['release-prepared-at'], reason: flags.reason, approvalRef: flags['approval-ref'],
        policyInstanceId: flags['policy-instance-id'], placementFingerprint: flags['placement-fingerprint'], recoveryAuthorization });
      if (result.kind === 'teacher-units-option-b-plan') {
        if (command === 'recoverClosed' && !flags.out) deny('recovery requires a private --out plan/before snapshot');
        if (flags.out) fs.writeFileSync(flags.out, `${K.canonicalJSON(result)}\n`, { flag: 'wx', mode: 0o600 });
        result = { status: 'dry-run', command, target: result.target, transitionId: result.transitionId, expected: result.expected,
          proposedMode: result.next.mode, confirm: result.confirm, planSaved: Boolean(flags.out), persistence: 'not-performed', shutdownConfirmed: false };
      }
    }
    stdout.write(`${JSON.stringify(result)}\n`); return ['unconfirmed', 'conflicting'].includes(result.status) ? 2 : 0;
  } catch (error) {
    // Never echo provider errors, credential bytes, tokens or arbitrary exception text.
    stderr.write(`Option B REFUSED: ${error instanceof Refusal ? error.code : 'operation could not be verified'}\n`); return 1;
  } finally { if (connection?.close) { try { await connection.close(); } catch { stderr.write('Option B connection cleanup could not be confirmed\n'); } } }
}
module.exports = { POLICY, HISTORY, READ, WRITE, Refusal, target, encode, ts, cas, auditInput, serializePlan, restorePlan,
  createController, verifyCredential, selectedApp, operatorCredential, impersonatedFirestore, parse, main };
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; });
