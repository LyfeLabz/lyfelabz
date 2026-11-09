import { onSchedule } from "firebase-functions/v2/scheduler";
import type { UserRecord as AuthUser } from "firebase-admin/auth";
import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getAdminFirestore } from "../shared/firestore/admin";
import { getAdminAuth } from "../shared/auth/admin";
import { PlatformError } from "../shared/errors/platform-error";
import { platformCallable } from "../shared/errors/https-callable";
import { requireDistrictContext } from "../shared/auth/require-district-context";
import { resolvePilotSchoolId } from "../shared/config/teacher-pilot-allowlist";
import { writeAuditEventInTransaction } from "../shared/audit/write-audit-event";
import {
  ACCOUNT_BOUNDARIES, AUTHORIZATIONS, RELATIONSHIPS, legacyRelationshipId, recipientBoundaryRecords, hasValidLegacySupportGrant, ownerRevocationAt, issuedAfterRevocation, revokeRecipientOwner, normalizeSupportEmail, readAccountBoundary,
  readVerifiedGoogleIdentity, relationshipMatchesActor, supportRecordId, touchAccountBoundary,
  verifiedGoogleIdentity, type PendingAuthorization, type RecipientRelationship, type SupportActor,
} from "./recipient-policy";

const MAX_SCAN = 200;
const db = getAdminFirestore;
function invalid(): never { throw new PlatformError("supportAccess.invalidRequest", "Invalid support authorization request."); }
function forbidden(): never { throw new PlatformError("supportAccess.forbidden", "Support authorization is unavailable."); }
function payload(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(k => !keys.includes(k))) invalid();
  return data;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,800}$/.test(value)) invalid();
  return value;
}
async function teacher(request: CallableRequest<unknown>): Promise<SupportActor> {
  const a = await requireDistrictContext(request);
  if (a.role !== "teacher") forbidden();
  return a;
}
async function assertPilot(actor: SupportActor): Promise<void> {
  if (actor.schoolId !== await resolvePilotSchoolId()) forbidden();
}
type Operation = { id: string; generation: number };
const operations = "supportMutationOperations";
const generations = "supportMutationGenerations";
const cleanupJobs = "supportRemovalJobs";
const generationRef = (actor: SupportActor) =>
  db().collection(generations).doc(supportRecordId(actor.uid, actor.schoolId, actor.districtId));

export const supportAccessMutationGeneration = platformCallable({ maxInstances: 20 }, async request => {
  const actor = await teacher(request);
  const generation: unknown = (await generationRef(actor).get()).data()?.generation ?? 0;
  return { generation };
});

async function startOperation(actor: SupportActor, data: Record<string, unknown>, intent: unknown): Promise<Operation> {
  if (typeof data.operationId !== "string" || !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/.test(data.operationId) ||
    typeof data.expectedGeneration !== "number" || !Number.isSafeInteger(data.expectedGeneration) ||
    data.expectedGeneration < 0 || data.expectedGeneration >= Number.MAX_SAFE_INTEGER) invalid();
  const expected = data.expectedGeneration;
  const key = supportRecordId(actor.uid, actor.schoolId, actor.districtId, data.operationId);
  const fingerprint = supportRecordId(JSON.stringify(intent));
  return db().runTransaction(async tx => {
    const ref = db().collection(operations).doc(key);
    const receipt = (await tx.get(ref)).data();
    if (receipt) {
      if (receipt.fingerprint !== fingerprint || receipt.generation !== expected + 1) invalid();
      return { id: key, generation: receipt.generation as number };
    }
    const generation: unknown = (await tx.get(generationRef(actor))).data()?.generation ?? 0;
    if (generation !== expected) staleOperation();
    tx.set(generationRef(actor), { generation: expected + 1 });
    tx.create(ref, { fingerprint, generation: expected + 1, createdAt: FieldValue.serverTimestamp() });
    return { id: key, generation: expected + 1 };
  });
}

function staleOperation(): never {
  throw new PlatformError("supportAccess.conflict", "Student Support changed. Refresh and review the current access before trying again.");
}

async function assertOperation(tx: Transaction, actor: SupportActor, operation?: Operation): Promise<void> {
  if (operation && (await tx.get(generationRef(actor))).data()?.generation !== operation.generation) staleOperation();
}

function audit(tx: Transaction, actor: SupportActor, action: "supportAccess.authorizationSaved" | "supportAccess.authorizationRevoked" | "supportAccess.relationshipBound" | "supportAccess.relationshipRevoked" | "supportAccess.recipientRevoked", targetId: string): void {
  writeAuditEventInTransaction(tx, { actorUserId: actor.uid, actorRole: "teacher", action, targetType: action === "supportAccess.recipientRevoked" ? "supportRecipientBoundary" : action.startsWith("supportAccess.relationship") ? "supportRecipientRelationship" : "supportStudentAuthorization", targetId, schoolId: actor.schoolId, districtId: actor.districtId });
}
async function assertCurrentOwner(tx: Transaction, actor: SupportActor, classId: string, studentId?: string): Promise<void> {
  const [owner, cls] = await Promise.all([tx.get(db().collection("users").doc(actor.uid)), tx.get(db().collection("classes").doc(classId))]);
  if (owner.data()?.authUid !== actor.uid || owner.data()?.status !== "active" || owner.data()?.role !== "teacher" || owner.data()?.schoolId !== actor.schoolId ||
    cls.data()?.teacherId !== actor.uid || cls.data()?.schoolId !== actor.schoolId || cls.data()?.status !== "active") forbidden();
  if (studentId !== undefined) {
    const enrollment = (await tx.get(db().collection("enrollments").doc(`${classId}__${studentId}`))).data();
    if (enrollment?.status !== "active" || enrollment.classId !== classId || enrollment.studentId !== studentId || enrollment.schoolId !== actor.schoolId)
      throw new PlatformError("supportAccess.studentNotEnrolled", "That student is not active in this class.");
  }
}

type RecipientRequestCache = { actor: SupportActor; auth: Map<string, AuthUser | null>; bound: Set<string> };

export async function saveRecipientAuthorization(actor: SupportActor, classId: string, studentId: string, rawEmail: string, cache?: RecipientRequestCache, operation?: Operation): Promise<{ id: string; status: "pending" | "activated"; alreadyShared: boolean; grantId?: string | null; granteeDisplayName?: string | null }> {
  const email = normalizeSupportEmail(rawEmail);
  if (!email) throw new PlatformError("supportAccess.invalidEmail", "Use a valid @weston.org address.");
  if (cache) {
    if (cache.actor.uid !== actor.uid || cache.actor.schoolId !== actor.schoolId || cache.actor.districtId !== actor.districtId) forbidden();
  } else await assertPilot(actor);
  // Per-request lookup caching preserves the existing bulk lookup bound of
  // ten recipients. Canonical role/scope and every activation are still read
  // in their committing transactions. No Auth user is created here.
  let authUser: AuthUser | null;
  if (cache?.auth.has(email)) authUser = cache.auth.get(email) ?? null;
  else {
    authUser = await getAdminAuth().getUserByEmail(email).catch((err: unknown) => {
      if ((err as { code?: string }).code === "auth/user-not-found") return null;
      throw err;
    });
    cache?.auth.set(email, authUser);
  }
  if (authUser?.uid === actor.uid) throw new PlatformError("supportAccess.granteeUnavailable", "This recipient is unavailable.");
  let recipientIdentity: { email: string; identity: string } | null = null;
  if (authUser) { try { recipientIdentity = verifiedGoogleIdentity(authUser); } catch { /* Remain pending. */ } }
  const relationshipId = supportRecordId(actor.uid, actor.schoolId, actor.districtId, email);
  const authorizationId = supportRecordId(relationshipId, classId, studentId);
  const saved = await db().runTransaction(async tx => {
    await assertCurrentOwner(tx, actor, classId, studentId);
    const relRef = db().collection(RELATIONSHIPS).doc(relationshipId);
    const authRef = db().collection(AUTHORIZATIONS).doc(authorizationId);
    const [relSnap, authSnap] = await Promise.all([tx.get(relRef), tx.get(authRef)]);
    await assertOperation(tx, actor, operation);
    const pairReceipt = operation ? authRef.collection("mutationReceipts").doc(operation.id) : null;
    if (pairReceipt && (await tx.get(pairReceipt)).exists) return null;
    const prior = relSnap.data() as RecipientRelationship | undefined;
    const previous = authSnap.data() as PendingAuthorization | undefined;
    if (prior && (prior.ownerTeacherId !== actor.uid || prior.email !== email || prior.schoolId !== actor.schoolId || prior.districtId !== actor.districtId)) forbidden();
    if (previous && (previous.relationshipId !== relationshipId || previous.ownerTeacherId !== actor.uid || previous.classId !== classId || previous.studentId !== studentId)) forbidden();
    const recipient = authUser ? (await tx.get(db().collection("users").doc(authUser.uid))).data() : undefined;
    const knownUid = authUser && recipient?.authUid === authUser.uid && recipient?.status === "active" && recipient.role === "teacher" && recipient.schoolId === actor.schoolId ? authUser.uid : null;
    const grant = knownUid ? await tx.get(db().collection("studentSupportGrants").doc(`${classId}__${studentId}__${knownUid}`)) : null;
    const existingRestriction = authUser ? await readAccountBoundary(tx, authUser.uid) : false;
    const recipientClasses = authUser ? await tx.get(db().collection("classes").where("teacherId", "==", authUser.uid).limit(1)) : null;
    const revokedAt = knownUid ? await ownerRevocationAt(tx, knownUid, actor, recipientIdentity) : undefined;
    // Explicit owner re-sharing reopens a revoked intent; reconciliation never does.
    const alreadyShared = previous !== undefined && previous.status !== "revoked" && prior?.status !== "revoked" && issuedAfterRevocation(previous.authorizedAt, revokedAt) && (previous.status === "pending" ? grant?.data()?.status !== "revoked" : grant?.data()?.status === "active");
    if (pairReceipt) tx.create(pairReceipt, { createdAt: FieldValue.serverTimestamp() });
    if (alreadyShared) return { id: authorizationId, status: previous.status as "pending" | "activated", alreadyShared: grant?.data()?.status === "active" };
    if (knownUid !== null) touchAccountBoundary(tx, knownUid, existingRestriction || recipientClasses?.empty === true, recipientIdentity, recipient?.email);
    tx.set(relRef, { ...prior, ownerTeacherId: actor.uid, email, schoolId: actor.schoolId, districtId: actor.districtId,
      status: prior?.recipientUid ? "active" : "pending", authorizedAt: FieldValue.serverTimestamp(), revision: (prior?.revision ?? 0) + 1,
      recipientUid: prior?.recipientUid ?? null, googleIdentity: prior?.googleIdentity ?? null,
      ...(!prior ? { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid } : {}), updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    tx.set(authRef, { ...previous, relationshipId, ownerTeacherId: actor.uid, classId, studentId, schoolId: actor.schoolId, districtId: actor.districtId,
      status: "pending", authorizedAt: FieldValue.serverTimestamp(), revision: (previous?.revision ?? 0) + 1, grantId: null, expectedGrantVersion: grant?.updateTime ? `${grant.updateTime.seconds}:${grant.updateTime.nanoseconds}` : null,
      ...(!previous ? { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid } : {}), updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, actor, "supportAccess.authorizationSaved", authorizationId);
    return { id: authorizationId, status: "pending" as const, alreadyShared: grant?.data()?.status === "active" && issuedAfterRevocation(grant.data()?.grantedAt, revokedAt) };
  });
  if (saved === null) {
    const current = (await db().collection(AUTHORIZATIONS).doc(authorizationId).get()).data();
    if (!current || current.status === "revoked") staleOperation();
    return { id: authorizationId, status: current.status === "activated" ? "activated" : "pending",
      alreadyShared: current.status === "activated", grantId: typeof current.grantId === "string" ? current.grantId : null };
  }
  if (authUser) {
    try {
    let identity: { email: string; identity: string } | null = null;
    try { identity = verifiedGoogleIdentity(authUser); } catch { /* Keep pending until a verified identity can bind. */ }
    const recipient = (await db().collection("users").doc(authUser.uid).get()).data();
    if (identity && recipient?.status === "active" && recipient.role === "teacher" && recipient.schoolId === actor.schoolId) {
      const recipientActor = { ...actor, uid: authUser.uid };
      if (cache?.bound.has(relationshipId) || await bindRelationship(recipientActor, relationshipId, identity)) {
        cache?.bound.add(relationshipId);
        await activateAuthorization(recipientActor, authorizationId, identity);
        const current = (await db().collection(AUTHORIZATIONS).doc(authorizationId).get()).data();
        return { ...saved, status: current?.status === "activated" ? "activated" : "pending", grantId: typeof current?.grantId === "string" ? current.grantId : null, granteeDisplayName: typeof recipient.displayName === "string" ? recipient.displayName : "Teacher" };
      }
    }
    } catch {
      // The owner authorization already committed. Report it as pending,
      // rather than claiming nothing was saved after a transient activation
      // failure. Recipient bootstrap will retry through the audited path.
      return { ...saved, status: "pending" };
    }
  }
  return saved;
}

// Binding and grant activation are separate retryable transactions. Each pending
// row checks the relationship again, so removal during reconciliation wins.
async function bindRelationship(actor: SupportActor, relationshipId: string, identity: { email: string; identity: string }): Promise<boolean> {
  return db().runTransaction(async tx => {
    const ref = db().collection(RELATIONSHIPS).doc(relationshipId);
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const r = snap.data() as RecipientRelationship;
    if (!relationshipMatchesActor(r, actor, identity)) return false;
    const revokedAt = await ownerRevocationAt(tx, actor.uid, { ...actor, uid: r.ownerTeacherId }, identity);
    if (!issuedAfterRevocation(r.authorizedAt, revokedAt)) return false;
    const mapping = (await tx.get(db().collection("externalIdentities").doc(identity.identity))).data();
    if (mapping?.status === "active" && mapping.userId !== actor.uid) return false;
    if ((await recipientBoundaryRecords(tx, actor.uid, identity)).some(record => record.uid !== actor.uid && record.data.restricted === true)) return false;
    const [recipient, owner, owned] = await Promise.all([
      tx.get(db().collection("users").doc(actor.uid)), tx.get(db().collection("users").doc(r.ownerTeacherId)),
      tx.get(db().collection("classes").where("teacherId", "==", actor.uid).limit(1)),
    ]);
    const restricted = await readAccountBoundary(tx, actor.uid);
    if (recipient.data()?.authUid !== actor.uid || recipient.data()?.status !== "active" || recipient.data()?.role !== "teacher" || recipient.data()?.schoolId !== actor.schoolId ||
      owner.data()?.authUid !== r.ownerTeacherId || owner.data()?.status !== "active" || owner.data()?.role !== "teacher" || owner.data()?.schoolId !== actor.schoolId) return false;
    touchAccountBoundary(tx, actor.uid, restricted || owned.empty, identity, recipient.data()?.email);
    if (r.status !== "active" || r.recipientUid === null) {
      tx.update(ref, { status: "active", recipientUid: actor.uid, googleIdentity: identity.identity, revision: r.revision + 1, updatedAt: FieldValue.serverTimestamp() });
      audit(tx, actor, "supportAccess.relationshipBound", relationshipId);
    }
    return true;
  });
}
async function activateAuthorization(actor: SupportActor, authorizationId: string, identity: { email: string; identity: string }): Promise<boolean> {
  return db().runTransaction(async tx => {
    const ref = db().collection(AUTHORIZATIONS).doc(authorizationId);
    const snap = await tx.get(ref);
    const a = snap.data() as PendingAuthorization | undefined;
    if (!a || a.status !== "pending" || a.schoolId !== actor.schoolId || a.districtId !== actor.districtId) return false;
    const relation = (await tx.get(db().collection(RELATIONSHIPS).doc(a.relationshipId))).data() as RecipientRelationship | undefined;
    if (!relation || relation.ownerTeacherId !== a.ownerTeacherId || relation.status !== "active" || relation.recipientUid !== actor.uid || !relationshipMatchesActor(relation, actor, identity)) return false;
    const revokedAt = await ownerRevocationAt(tx, actor.uid, { ...actor, uid: a.ownerTeacherId }, identity);
    if (!issuedAfterRevocation(a.authorizedAt, revokedAt)) return false;
    const recipient = (await tx.get(db().collection("users").doc(actor.uid))).data();
    if (recipient?.authUid !== actor.uid || recipient?.status !== "active" || recipient.role !== "teacher" || recipient.schoolId !== actor.schoolId) return false;
    await assertCurrentOwner(tx, { ...actor, uid: a.ownerTeacherId }, a.classId, a.studentId);
    const grantId = `${a.classId}__${a.studentId}__${actor.uid}`;
    const grantRef = db().collection("studentSupportGrants").doc(grantId);
    const grantSnap = await tx.get(grantRef);
    const grant = grantSnap.data();
    if (grant?.status === "revoked") {
      const expected: unknown = snap.data()?.expectedGrantVersion;
      const actual = grantSnap.updateTime ? `${grantSnap.updateTime.seconds}:${grantSnap.updateTime.nanoseconds}` : null;
      const cleanupCutoff: unknown = grant.removalCutoff;
      if ((!expected || expected !== actual) &&
        (!(cleanupCutoff instanceof Timestamp) || !issuedAfterRevocation(a.authorizedAt, cleanupCutoff))) return false;
    }
    if (grant && (grant.ownerTeacherId !== a.ownerTeacherId || grant.schoolId !== a.schoolId || grant.districtId !== a.districtId || grant.classId !== a.classId || grant.studentId !== a.studentId || grant.granteeUid !== actor.uid)) forbidden();
    // An activated row is never revisited. Explicit re-sharing creates a new
    // pending revision and is the sole way to intentionally reactivate a grant.
    const needsGrant = grant?.status !== "active" || !issuedAfterRevocation(grant.grantedAt, revokedAt);
    if (needsGrant) {
      tx.set(grantRef, { classId: a.classId, studentId: a.studentId, ownerTeacherId: a.ownerTeacherId, granteeUid: actor.uid,
        schoolId: a.schoolId, districtId: a.districtId, status: "active", grantedAt: FieldValue.serverTimestamp(), grantedBy: a.ownerTeacherId });
      writeAuditEventInTransaction(tx, { actorUserId: a.ownerTeacherId, actorRole: "teacher", action: "supportAccess.granted", targetType: "studentSupportGrant", targetId: grantId, schoolId: a.schoolId, districtId: a.districtId, payload: { classId: a.classId, studentId: a.studentId, granteeUid: actor.uid } });
    }
    tx.update(ref, { status: "activated", grantId,
      grantIssuedAt: needsGrant ? FieldValue.serverTimestamp() : (grant?.grantedAt as Timestamp), revision: a.revision + 1, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
}
export async function reconcileRecipient(actor: SupportActor, cursor: string | null = null): Promise<{ remaining: boolean; cursor: string | null }> {
  let identity;
  try { identity = await readVerifiedGoogleIdentity(actor.uid); }
  catch (err) {
    if (err instanceof PlatformError && err.code === "supportAccess.forbidden") return { remaining: false, cursor: null };
    throw err;
  }
  const relations = await db().collection(RELATIONSHIPS).where("email", "==", identity.email).limit(MAX_SCAN + 1).get();
  if (relations.size > MAX_SCAN) throw new PlatformError("supportAccess.unavailable", "Too many support relationships to resolve safely.");
  let budget = 40;
  const [afterRelationship, afterAuthorization] = (cursor ?? "").split(":");
  for (const row of relations.docs) {
    if (row.id < afterRelationship) continue;
    if (!await bindRelationship(actor, row.id, identity)) continue;
    let query = db().collection(AUTHORIZATIONS).where("relationshipId", "==", row.id).where("status", "==", "pending").orderBy("__name__");
    if (row.id === afterRelationship && afterAuthorization) query = query.startAfter(afterAuthorization);
    const pending = await query.limit(budget + 1).get();
    const selected = pending.docs.slice(0, budget);
    for (const authorization of selected) {
      try { await activateAuthorization(actor, authorization.id, identity); }
      catch (err) { if (!(err instanceof PlatformError) || !["supportAccess.forbidden", "supportAccess.studentNotEnrolled"].includes(err.code)) throw err; }
    }
    budget -= selected.length;
    if (pending.size > selected.length || budget === 0) return { remaining: true, cursor: `${row.id}:${selected[selected.length - 1]?.id ?? afterAuthorization ?? ""}` };
  }
  return { remaining: false, cursor: null };
}

export async function revokeAuthorization(actor: SupportActor, authorizationId: string, operation?: Operation, cutoff?: Timestamp): Promise<void> {
  await db().runTransaction(async tx => {
    const ref = db().collection(AUTHORIZATIONS).doc(authorizationId);
    const snap = await tx.get(ref);
    const a = snap.data() as PendingAuthorization | undefined;
    if (!a || a.ownerTeacherId !== actor.uid || a.schoolId !== actor.schoolId || a.districtId !== actor.districtId) forbidden();
    await assertOperation(tx, actor, operation);
    if (cutoff && issuedAfterRevocation(a.authorizedAt, cutoff)) return;
    const grantRef = a.grantId ? db().collection("studentSupportGrants").doc(a.grantId) : null;
    const grant = grantRef ? (await tx.get(grantRef)).data() : undefined;
    if (grant && (grant.ownerTeacherId !== actor.uid || grant.schoolId !== actor.schoolId || grant.districtId !== actor.districtId || grant.classId !== a.classId || grant.studentId !== a.studentId)) forbidden();
    const activatedAt: unknown = snap.data()?.grantIssuedAt ?? snap.data()?.updatedAt;
    const sameGrant = !(activatedAt instanceof Timestamp) || !issuedAfterRevocation(grant?.grantedAt, activatedAt);
    if (operation && grant?.status === "active" && !sameGrant) staleOperation();
    if (grantRef && grant?.status === "active" && sameGrant && (!cutoff || !issuedAfterRevocation(grant.grantedAt, cutoff))) {
      tx.update(grantRef, { status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: actor.uid, ...(cutoff ? { removalCutoff: cutoff } : { removalCutoff: FieldValue.delete() }) });
      writeAuditEventInTransaction(tx, { actorUserId: actor.uid, actorRole: "teacher", action: "supportAccess.revoked", targetType: "studentSupportGrant", targetId: grantRef.id, schoolId: actor.schoolId, districtId: actor.districtId, payload: { classId: a.classId, studentId: a.studentId, granteeUid: grant.granteeUid } });
    }
    if (a.status !== "revoked") {
      tx.update(ref, { status: "revoked", revision: a.revision + 1, updatedAt: FieldValue.serverTimestamp() });
      audit(tx, actor, "supportAccess.authorizationRevoked", authorizationId);
    }
  });
}
async function closeRelationship(actor: SupportActor, relationshipId: string, operation?: Operation, legacyGrantId?: string, cancelInvitation = false): Promise<FirebaseFirestore.DocumentReference> {
  // Close every binding this owner holds for the same UID. Email changes may
  // have created more than one relationship; an older pending row must not
  // restore access through a second binding after Remove teacher.
  return db().runTransaction(async tx => {
    const jobRef = db().collection(cleanupJobs).doc(operation?.id ?? supportRecordId("removal", relationshipId));
    if ((await tx.get(jobRef)).exists) return jobRef;
    await assertOperation(tx, actor, operation);
    const ref = db().collection(RELATIONSHIPS).doc(relationshipId);
    let r = (await tx.get(ref)).data() as RecipientRelationship | undefined;
    let legacyBoundary: { restricted: boolean; email: unknown } | undefined;
    if (legacyGrantId !== undefined) {
      const grant = (await tx.get(db().collection("studentSupportGrants").doc(legacyGrantId))).data();
      if (!grant || typeof grant.granteeUid !== "string" || typeof grant.classId !== "string" ||
        typeof grant.studentId !== "string" || grant.ownerTeacherId !== actor.uid ||
        grant.schoolId !== actor.schoolId || grant.districtId !== actor.districtId ||
        legacyRelationshipId(actor, grant.granteeUid) !== relationshipId ||
        `${grant.classId}__${grant.studentId}__${grant.granteeUid}` !== legacyGrantId) forbidden();
      if (r && r.recipientUid !== grant.granteeUid) forbidden();
      if (!r) {
        const uid = grant.granteeUid;
        const [user, owned, cls, enrollment, restricted] = await Promise.all([
          tx.get(db().collection("users").doc(uid)),
          tx.get(db().collection("classes").where("teacherId", "==", uid).limit(1)),
          tx.get(db().collection("classes").doc(grant.classId)),
          tx.get(db().collection("enrollments").doc(`${grant.classId}__${grant.studentId}`)),
          readAccountBoundary(tx, uid),
        ]);
        const candidate = user.data();
        const isSupportRecipient = candidate?.authUid === uid && candidate.role === "teacher" &&
          candidate.status === "active" && candidate.schoolId === actor.schoolId && owned.empty &&
          grant.status === "active" && cls.data()?.status === "active" && cls.data()?.teacherId === actor.uid &&
          cls.data()?.schoolId === actor.schoolId && enrollment.data()?.status === "active" &&
          enrollment.data()?.classId === grant.classId && enrollment.data()?.studentId === grant.studentId &&
          enrollment.data()?.schoolId === actor.schoolId;
        legacyBoundary = { restricted: restricted || isSupportRecipient, email: candidate?.email as unknown };
        r = { ownerTeacherId: actor.uid, email: null, recipientUid: uid, googleIdentity: null,
          schoolId: actor.schoolId, districtId: actor.districtId, status: "revoked", revision: 1 };
      }
    }
    if (!r || r.ownerTeacherId !== actor.uid || r.schoolId !== actor.schoolId || r.districtId !== actor.districtId) forbidden();
    if (operation && (cancelInvitation ? r.recipientUid !== null || legacyGrantId !== undefined : !r.recipientUid)) {
      throw new PlatformError("supportAccess.conflict", "Refresh and review whether this is a pending invitation or a teacher with access.");
    }
    const relationships = new Map([[relationshipId, r]]);
    if (legacyBoundary && r.recipientUid) {
      tx.create(ref, { ...r, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      touchAccountBoundary(tx, r.recipientUid, legacyBoundary.restricted, undefined, legacyBoundary.email);
      audit(tx, actor, "supportAccess.relationshipRevoked", relationshipId);
    }
    if (r.recipientUid) {
      revokeRecipientOwner(tx, r.recipientUid, actor);
      audit(tx, actor, "supportAccess.recipientRevoked", supportRecordId(actor.uid, r.recipientUid, actor.schoolId, actor.districtId));
    }
    for (const [key, current] of relationships) if (current.status !== "revoked") {
      tx.update(db().collection(RELATIONSHIPS).doc(key), { status: "revoked", revision: current.revision + 1, updatedAt: FieldValue.serverTimestamp() });
      audit(tx, actor, "supportAccess.relationshipRevoked", key);
    }
    tx.create(jobRef, { actor, relationshipIds: [...relationships.keys()], recipientUid: r.recipientUid,
      scanBindings: Boolean(r.recipientUid), cutoff: FieldValue.serverTimestamp(), attemptedAt: FieldValue.serverTimestamp(), pending: true });
    return jobRef;
  });
}

async function drainRemoval(ref: FirebaseFirestore.DocumentReference): Promise<boolean> {
  const job = (await ref.get()).data();
  if (!job?.pending) return false;
  const actor = job.actor as SupportActor;
  const cutoff = job.cutoff as Timestamp;
  const ids = job.relationshipIds as string[];
  const phase = (job.phase ?? 0) as number;
  let query: FirebaseFirestore.Query;
  if (phase < ids.length) {
    query = db().collection(AUTHORIZATIONS).where("relationshipId", "==", ids[phase])
      .where("status", "in", ["pending", "activated"]);
  } else if (phase === ids.length + 1 && job.scanBindings) {
    query = db().collection(RELATIONSHIPS).where("recipientUid", "==", job.recipientUid)
      .where("ownerTeacherId", "==", actor.uid).where("schoolId", "==", actor.schoolId)
      .where("districtId", "==", actor.districtId);
  } else if (phase === ids.length && job.recipientUid) {
    query = db().collection("studentSupportGrants").where("granteeUid", "==", job.recipientUid)
      .where("ownerTeacherId", "==", actor.uid).where("status", "==", "active");
  } else {
    await ref.update({ pending: false });
    return false;
  }
  query = query.orderBy("__name__");
  if (job.cursor) query = query.startAfter(job.cursor);
  const rows = await query.limit(40).get();
  for (const row of rows.docs) {
    if (phase < ids.length) await revokeAuthorization(actor, row.id, undefined, cutoff);
    else if (phase > ids.length) await db().runTransaction(async tx => {
      const current = (await tx.get(row.ref)).data() as RecipientRelationship | undefined;
      if (!current || current.ownerTeacherId !== actor.uid || current.schoolId !== actor.schoolId ||
        current.districtId !== actor.districtId || current.recipientUid !== job.recipientUid ||
        issuedAfterRevocation(current.authorizedAt, cutoff)) return;
      const child = db().collection(cleanupJobs).doc(supportRecordId(ref.id, row.id));
      if (row.id === ids[0] || (await tx.get(child)).exists) return;
      if (current.status !== "revoked") {
        tx.update(row.ref, { status: "revoked", revision: current.revision + 1, updatedAt: FieldValue.serverTimestamp() });
        audit(tx, actor, "supportAccess.relationshipRevoked", row.id);
      }
      tx.create(child, { actor, relationshipIds: [row.id], recipientUid: null, cutoff,
        attemptedAt: FieldValue.serverTimestamp(), pending: true });
    });
    else await db().runTransaction(async tx => {
      const current = (await tx.get(row.ref)).data();
      if (!current || current.status !== "active" || issuedAfterRevocation(current.grantedAt, cutoff)) return;
      if (current.ownerTeacherId !== actor.uid || current.schoolId !== actor.schoolId ||
        current.districtId !== actor.districtId || current.granteeUid !== job.recipientUid) return;
      tx.update(row.ref, { status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: actor.uid, removalCutoff: cutoff });
      writeAuditEventInTransaction(tx, { actorUserId: actor.uid, actorRole: "teacher", action: "supportAccess.revoked",
        targetType: "studentSupportGrant", targetId: row.id, schoolId: actor.schoolId, districtId: actor.districtId,
        payload: { classId: current.classId, studentId: current.studentId, granteeUid: current.granteeUid } });
    });
  }
  return db().runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (!current?.pending) return false;
    if (current.phase !== job.phase || current.cursor !== job.cursor) return true;
    const more = rows.size === 40;
    const pending = more || phase < ids.length || (phase === ids.length && job.scanBindings === true);
    tx.update(ref, { phase: more ? phase : phase + 1, cursor: more ? rows.docs[39].id : null, pending });
    return pending;
  });
}

export const supportAccessDrainRemovals = onSchedule({ schedule: "every 5 minutes", maxInstances: 1 }, async () => {
  const jobs = await db().collection(cleanupJobs).where("pending", "==", true).orderBy("attemptedAt").limit(10).get();
  const results = await Promise.allSettled(jobs.docs.map(async job => {
    await job.ref.update({ attemptedAt: FieldValue.serverTimestamp() });
    await drainRemoval(job.ref);
  }));
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") console.error("Student Support cleanup failed", { jobId: jobs.docs[index].id });
  }
});
export const supportAccessReconcileMine = platformCallable({ maxInstances: 20 }, async request => {
  const data = payload(request.data ?? {}, ["cursor"]);
  if (data.cursor !== undefined && data.cursor !== null && (typeof data.cursor !== "string" || !/^[a-f0-9]{64}:[a-f0-9]{0,64}$/.test(data.cursor))) invalid();
  return reconcileRecipient(await teacher(request), typeof data.cursor === "string" ? data.cursor : null);
});
export const supportAccessV21RevokeAuthorization = platformCallable({ maxInstances: 20 }, async request => {
  const data = payload(request.data, ["authorizationId", "grantId", "operationId", "expectedGeneration"]);
  const actor = await teacher(request);
  if ((data.authorizationId === undefined) === (data.grantId === undefined)) invalid();
  const target = id(data.authorizationId ?? data.grantId);
  const operation = await startOperation(actor, data, ["revoke", data.authorizationId === undefined ? "grant" : "authorization", target]);
  if (data.authorizationId !== undefined) await revokeAuthorization(actor, target, operation);
  else await db().runTransaction(async tx => {
    await assertOperation(tx, actor, operation);
    const ref = db().collection("studentSupportGrants").doc(target);
    const grant = (await tx.get(ref)).data();
    if (!grant || grant.ownerTeacherId !== actor.uid || grant.schoolId !== actor.schoolId || grant.districtId !== actor.districtId) forbidden();
    const receipt = db().collection(operations).doc(operation.id);
    if ((await tx.get(receipt)).data()?.grantRevokeApplied === true) return;
    tx.update(receipt, { grantRevokeApplied: true });
    tx.update(ref, { status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: actor.uid, removalCutoff: FieldValue.delete() });
    writeAuditEventInTransaction(tx, { actorUserId: actor.uid, actorRole: "teacher", action: "supportAccess.revoked",
      targetType: "studentSupportGrant", targetId: target, schoolId: actor.schoolId, districtId: actor.districtId,
      payload: { classId: grant.classId, studentId: grant.studentId, granteeUid: grant.granteeUid } });
  });
  return { status: "revoked" };
});
export const supportAccessV21RemoveRecipient = platformCallable({ maxInstances: 20 }, async request => {
  const data = payload(request.data, ["relationshipId", "grantId", "cancelInvitation", "operationId", "expectedGeneration"]);
  const actor = await teacher(request);
  const relationshipId = id(data.relationshipId);
  const grantId = data.grantId === undefined ? undefined : id(data.grantId);
  if (data.cancelInvitation !== undefined && data.cancelInvitation !== true) invalid();
  const cancelInvitation = data.cancelInvitation === true;
  const operation = await startOperation(actor, data, [cancelInvitation ? "cancelInvitation" : "remove", relationshipId, grantId ?? null]);
  await closeRelationship(actor, relationshipId, operation, grantId, cancelInvitation);
  return { status: "revoked" };
});

// Exported for hermetic transaction/concurrency tests, not deployed separately.
export const __recipientAuthorization = { bindRelationship, activateAuthorization, closeRelationship, drainRemoval, payload };
// Keep the collection name visible for schema inventory tooling.
export const SUPPORT_ACCOUNT_BOUNDARY_COLLECTION = ACCOUNT_BOUNDARIES;

export async function authorizeManyHandler(request: CallableRequest<unknown>, versioned = false): Promise<unknown> {
  const actor = await teacher(request);
  const data = payload(request.data, versioned ? ["classId", "studentIds", "granteeEmails", "operationId", "expectedGeneration"] : ["classId", "studentIds", "granteeEmails"]);
  const classId = id(data.classId);
  if (!Array.isArray(data.studentIds) || data.studentIds.length < 1 || data.studentIds.length > 40 ||
      !Array.isArray(data.granteeEmails) || data.granteeEmails.length < 1 || data.granteeEmails.length > 10) invalid();
  const students = [...new Set(data.studentIds.map(id))];
  const emails = [...new Set(data.granteeEmails.map((e: unknown) => {
    if (typeof e !== "string" || !e.trim() || e.length > 1024) invalid();
    return e.trim().toLowerCase();
  }))];
  await assertPilot(actor);
  await db().runTransaction(tx => assertCurrentOwner(tx, actor, classId));
  const operation = versioned ? await startOperation(actor, data, ["share", classId, students, emails]) : undefined;
  const results: Array<Record<string, unknown>> = [];
  const summary = { shared: 0, pending: 0, alreadyShared: 0, failed: 0 };
  const cache: RecipientRequestCache = { actor, auth: new Map(), bound: new Set() };
  for (const studentId of students) for (const granteeEmail of emails) {
    try {
      const result = await saveRecipientAuthorization(actor, classId, studentId, granteeEmail, cache, operation);
      const outcome = result.status === "pending" ? "pending" : result.alreadyShared ? "alreadyShared" : "shared";
      summary[outcome]++;
      results.push({ studentId, granteeEmail, outcome, authorizationId: result.id, grantId: result.grantId ?? null, granteeDisplayName: result.granteeDisplayName ?? null, reason: null });
    } catch (err) {
      const code = err instanceof PlatformError ? err.code : "supportAccess.unavailable";
      if (code === "supportAccess.conflict") throw err;
      const reason = code === "supportAccess.invalidEmail" ? "invalidEmail" : code === "supportAccess.studentNotEnrolled" ? "studentNotEnrolled" : code === "supportAccess.granteeUnavailable" ? "granteeUnavailable" : "unavailable";
      summary.failed++;
      results.push({ studentId, granteeEmail, outcome: "failed", reason, grantId: null, granteeDisplayName: null });
    }
  }
  return { classId, results, summary };
}
export async function recipientWorkspace(actor: SupportActor, legacyOwnerIds: readonly string[], candidates?: ReadonlyMap<string, { classId: string; studentId: string }>): Promise<{ supportOnly: boolean; recognizedRecipient: boolean }> {
  // Existing valid UID grants are the only compatibility seed. Historical
  // revoked grants are never inspected to reconstruct a designation.
  for (const ownerTeacherId of new Set(legacyOwnerIds)) {
    const owner = { ...actor, uid: ownerTeacherId };
    const key = legacyRelationshipId(owner, actor.uid);
    await db().runTransaction(async tx => {
      const ref = db().collection(RELATIONSHIPS).doc(key);
      const current = (await tx.get(ref)).data() as RecipientRelationship | undefined;
      const owned = await tx.get(db().collection("classes").where("teacherId", "==", actor.uid).limit(1));
      const recipient = (await tx.get(db().collection("users").doc(actor.uid))).data();
      const restricted = await readAccountBoundary(tx, actor.uid);
      const existing = await tx.get(db().collection(RELATIONSHIPS).where("recipientUid", "==", actor.uid).limit(201));
      if (existing.size > 200) throw new PlatformError("supportAccess.unavailable", "Support identity needs operator review.");
      if (recipient?.authUid !== actor.uid || recipient.status !== "active" || recipient.role !== "teacher" || recipient.schoolId !== actor.schoolId) return;
      const recognized = existing.docs.some(row => {
        const r = row.data() as RecipientRelationship;
        return r.ownerTeacherId === ownerTeacherId && r.schoolId === actor.schoolId && r.districtId === actor.districtId && r.status === "active";
      });
      if (recognized) {
        touchAccountBoundary(tx, actor.uid, restricted || owned.empty, null, recipient.email);
        return;
      }
      if (current?.status === "revoked" || await ownerRevocationAt(tx, actor.uid, owner)) return;
      if (!await hasValidLegacySupportGrant(actor, tx, ownerTeacherId, candidates?.get(ownerTeacherId))) return;
      if (!current) {
        tx.create(ref, { ownerTeacherId, email: null, schoolId: actor.schoolId, districtId: actor.districtId,
          status: "active", authorizedAt: FieldValue.serverTimestamp(), revision: 1, recipientUid: actor.uid, googleIdentity: null,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), source: "existingActiveGrant" });
        audit(tx, actor, "supportAccess.relationshipBound", key);
      }
      touchAccountBoundary(tx, actor.uid, restricted || owned.empty, null, recipient.email);
    });
  }
  const [relations, owned] = await Promise.all([
    db().collection(RELATIONSHIPS).where("recipientUid", "==", actor.uid).limit(201).get(),
    db().collection("classes").where("teacherId", "==", actor.uid).limit(1).get(),
  ]);
  if (relations.size > 200) throw new PlatformError("supportAccess.unavailable", "Support authorization needs operator review.");
  const recognizedRecipient = legacyOwnerIds.length > 0 || relations.docs.some(d => {
    const r = d.data() as RecipientRelationship;
    return r.status === "active" && r.schoolId === actor.schoolId && r.districtId === actor.districtId;
  });
  return { supportOnly: owned.empty && recognizedRecipient, recognizedRecipient };
}

export async function ownerAuthorizationViews(actor: SupportActor, classId: string, activeGrants: ReadonlyMap<string, Timestamp>): Promise<Array<Record<string, unknown>>> {
  const rows = await db().collection(AUTHORIZATIONS).where("classId", "==", classId).get();
  const relationships = new Map<string, RecipientRelationship | undefined>();
  const recipients = new Map<string, Record<string, unknown> | undefined>();
  const result: Array<Record<string, unknown>> = [];
  for (const row of rows.docs) {
    const a = row.data() as PendingAuthorization;
    if (a.ownerTeacherId !== actor.uid || a.schoolId !== actor.schoolId || a.districtId !== actor.districtId) continue;
    if (!relationships.has(a.relationshipId)) relationships.set(a.relationshipId, (await db().collection(RELATIONSHIPS).doc(a.relationshipId).get()).data() as RecipientRelationship | undefined);
    const relation = relationships.get(a.relationshipId);
    if (!relation || relation.ownerTeacherId !== actor.uid || relation.schoolId !== actor.schoolId || relation.districtId !== actor.districtId || relation.status === "revoked") continue;
    if (relation.recipientUid && !recipients.has(relation.recipientUid)) recipients.set(relation.recipientUid, (await db().collection("users").doc(relation.recipientUid).get()).data());
    const recipient = relation.recipientUid ? recipients.get(relation.recipientUid) : undefined;
    const grantedAt = a.grantId ? activeGrants.get(a.grantId) : undefined;
    const issuedAt: unknown = row.data().grantIssuedAt;
    const current = a.status === "activated" && grantedAt !== undefined &&
      issuedAt instanceof Timestamp && issuedAt.isEqual(grantedAt);
    result.push({ grantId: current ? a.grantId : row.id, canonicalGrantId: current ? a.grantId : null, authorizationId: row.id, relationshipId: a.relationshipId,
      classId, studentId: a.studentId, granteeEmail: relation.email, granteeDisplayName: recipient?.schoolId === actor.schoolId && typeof recipient.displayName === "string" ? recipient.displayName : relation.email,
      invitationOnly: relation.recipientUid === null,
      status: a.status === "activated" ? (current ? "active" : grantedAt ? "superseded" : "removed") : a.status === "revoked" ? "removed" : relation.status === "active" ? "pendingActivation" : "pending", grantedAt: null });
  }
  return result;
}

export const supportAccessV21GrantMany = platformCallable({ maxInstances: 20 }, request => authorizeManyHandler(request, true));
