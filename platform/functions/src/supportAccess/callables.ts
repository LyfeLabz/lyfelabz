import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  classDocRef,
  enrollmentDocRef,
  isTransactionContention,
  log,
  normalizeEmail,
  platformCallable,
  requireDistrictContext,
  runFirestoreTransaction,
  studentSupportGrantDocRef,
  studentSupportGrantIdFor,
  studentSupportGrantRevokeDocRef,
  studentSupportGrantWriteDocRef,
  studentSupportGrantsCollectionRef,
  userRecordDocRef,
  usersByEmailQuery,
  writeAuditEventInTransaction,
  type ClassRecord,
  type StudentSupportGrantRecord,
  type UserRecord,
} from "../shared";
import { getAdminAuth } from "../shared/auth/admin";
import { createRosterDisplayNameResolver } from "../enrollments/resolve-roster-display-name";
import { authorizeStudentScopedRead, type StudentScopedReadActor } from "./authorize";

// Student Support Access (PDR-032, docs/platform/STUDENT_SUPPORT_ACCESS.md
// section 3). Grant management for the server-only `studentSupportGrants`
// collection.
//
//   supportAccessGrant         { classId, studentId, granteeEmail }  owner
//   supportAccessRevoke        { grantId }                           owner
//   supportAccessListForClass  { classId }                           owner
//   supportAccessListMine      {}                                    grantee
//
// Every call requires an authenticated, active teacher
// (`requireDistrictContext`). No request accepts an ownership key. Grant and
// revoke write their audit event in the same transaction as the record
// change, and only when the status actually changes.

const ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;
const GRANT_ID_PATTERN = /^[a-zA-Z0-9_-]{5,800}$/;
const OWNERSHIP_KEYS = ["uid", "userId", "teacherId", "ownerTeacherId", "granteeUid", "schoolId", "districtId"] as const;
const MAX_EMAIL_LENGTH = 320;

export type SupportGrantView = {
  readonly grantId: string;
  readonly classId: string;
  readonly studentId: string;
  readonly studentDisplayName: string;
  readonly granteeDisplayName: string;
  readonly granteeEmail: string | null;
  readonly grantedAt: number | null;
};

export type SharedStudentView = {
  readonly grantId: string;
  readonly classId: string;
  readonly classTitle: string;
  readonly studentId: string;
  readonly studentDisplayName: string;
  readonly ownerDisplayName: string;
};

function invalid(message: string): never {
  throw new PlatformError("supportAccess.invalidRequest", message);
}

function asPayload(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    invalid("Request payload must be a structured object.");
  }
  const payload = data as Record<string, unknown>;
  for (const key of OWNERSHIP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      invalid(`Field "${key}" is not permitted on the request.`);
    }
  }
  return payload;
}

function readId(payload: Record<string, unknown>, key: string, pattern = ID_PATTERN): string {
  const value = payload[key];
  if (typeof value !== "string" || !pattern.test(value)) invalid(`${key} is invalid.`);
  return value;
}

async function requireTeacher(request: CallableRequest<unknown>): Promise<StudentScopedReadActor> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError("role-forbidden", "Caller must be an active teacher.");
  }
  return { uid: context.uid, schoolId: context.schoolId, districtId: context.districtId };
}

async function loadOwnedClass(classId: string, actor: StudentScopedReadActor): Promise<ClassRecord> {
  const snap = await classDocRef(classId).get();
  const data = snap.exists ? snap.data() : undefined;
  if (!data || data.teacherId !== actor.uid || data.schoolId !== actor.schoolId) {
    throw new PlatformError("classes.forbidden", "Caller does not own this class.");
  }
  return data;
}

function displayNameOf(user: UserRecord | undefined, fallback: string): string {
  const name = typeof user?.displayName === "string" ? user.displayName.trim().replace(/\s+/g, " ") : "";
  return name.length > 0 ? name : fallback;
}

async function readUser(uid: string): Promise<UserRecord | undefined> {
  const snap = await userRecordDocRef(uid).get();
  const data = snap.exists ? snap.data() : undefined;
  return data !== undefined && data.authUid === uid ? data : undefined;
}

function millis(value: unknown): number | null {
  const ts = value as { toMillis?: () => number } | undefined;
  if (ts === undefined || ts === null || typeof ts.toMillis !== "function") return null;
  const ms = ts.toMillis();
  return Number.isFinite(ms) ? ms : null;
}

// A stored record is trusted only when its id and frozen fields agree.
function grantMatchesId(grantId: string, data: StudentSupportGrantRecord | undefined): data is StudentSupportGrantRecord {
  return (
    data !== undefined &&
    grantId === studentSupportGrantIdFor(data.classId, data.studentId, data.granteeUid)
  );
}

// Same-school teacher lookup. Every non-match (unknown, another school,
// inactive, non-teacher, ambiguous, or the caller) is one uniform refusal, so
// the only thing a teacher can learn is whether an email belongs to an active
// teacher at their own school.
//
// `users/{uid}.email` is copied verbatim from the Firebase Auth record at
// provisioning and has no normalized twin, so the equality queries match the
// entered email as typed and lowercased. When neither matches (a record
// stored with different capitalization), ONE Firebase Auth `getUserByEmail`
// lookup resolves the identity case-insensitively, the same canonical
// email-to-identity path the operator bootstrap tools use. Its uid is only a
// candidate: the canonical `users/{uid}` record must pass every check below.
// No scan, no migration, no new field.
async function resolveGrantee(email: string, actor: StudentScopedReadActor): Promise<{ uid: string; user: UserRecord }> {
  const raw = email.trim();
  const normalized = normalizeEmail(raw);
  if (normalized === undefined || raw.length > MAX_EMAIL_LENGTH || !normalized.includes("@")) {
    invalid("granteeEmail is invalid.");
  }
  const lookups = Array.from(new Set([normalized, raw]));
  const snaps = await Promise.all(lookups.map((value) => usersByEmailQuery(value).get()));
  const matches = new Map<string, UserRecord>();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!data) continue;
      if (doc.id === actor.uid) continue;
      if (data.authUid !== doc.id) continue;
      if (data.status !== "active" || data.role !== "teacher") continue;
      if (data.schoolId !== actor.schoolId) continue;
      if (normalizeEmail(data.email) !== normalized) continue;
      matches.set(doc.id, data);
    }
  }
  if (matches.size === 0) {
    const authUid = await getAdminAuth()
      .getUserByEmail(normalized)
      .then((record) => record.uid)
      .catch(() => null);
    if (authUid !== null && authUid !== actor.uid) {
      const data = (await userRecordDocRef(authUid).get()).data();
      if (
        data !== undefined &&
        data.authUid === authUid &&
        data.status === "active" &&
        data.role === "teacher" &&
        data.schoolId === actor.schoolId &&
        normalizeEmail(data.email) === normalized
      ) {
        matches.set(authUid, data);
      }
    }
  }
  if (matches.size !== 1) {
    throw new PlatformError(
      "supportAccess.granteeUnavailable",
      "No other active teacher at your school matches that email.",
    );
  }
  const [[uid, user]] = Array.from(matches.entries()) as [[string, UserRecord]];
  return { uid, user };
}

function transactionConflict(err: unknown): never {
  if (isTransactionContention(err)) {
    throw new PlatformError("supportAccess.writeConflict", "Another update was in progress. Please try again.", err);
  }
  throw err;
}

// ---------- supportAccessGrant ----------

export type SupportAccessGrantResponse = { readonly grant: SupportGrantView };

async function grantHandler(request: CallableRequest<unknown>): Promise<SupportAccessGrantResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data);
  const classId = readId(payload, "classId");
  const studentId = readId(payload, "studentId");
  const granteeEmail = payload.granteeEmail;
  if (typeof granteeEmail !== "string") invalid("granteeEmail is invalid.");

  const classRecord = await loadOwnedClass(classId, actor);
  if (classRecord.status !== "active") {
    throw new PlatformError("supportAccess.classNotActive", "Support access needs an active class.");
  }
  const enrollmentSnap = await enrollmentDocRef(`${classId}__${studentId}`).get();
  const enrollment = enrollmentSnap.exists ? enrollmentSnap.data() : undefined;
  if (
    enrollment === undefined ||
    enrollment.status !== "active" ||
    enrollment.classId !== classId ||
    enrollment.studentId !== studentId ||
    enrollment.schoolId !== classRecord.schoolId
  ) {
    throw new PlatformError("supportAccess.studentNotEnrolled", "That student is not active in this class.");
  }

  const grantee = await resolveGrantee(granteeEmail, actor);
  const grantId = studentSupportGrantIdFor(classId, studentId, grantee.uid);

  let changed = false;
  try {
    await runFirestoreTransaction(async (tx) => {
      const snap = await tx.get(studentSupportGrantDocRef(grantId));
      const existing = snap.exists ? snap.data() : undefined;
      if (existing !== undefined) {
        if (
          !grantMatchesId(grantId, existing) ||
          existing.ownerTeacherId !== actor.uid ||
          existing.schoolId !== actor.schoolId ||
          existing.districtId !== actor.districtId
        ) {
          throw new PlatformError("supportAccess.notFound", "Support access record is inconsistent.");
        }
        if (existing.status === "active") {
          changed = false;
          return;
        }
      }
      tx.set(studentSupportGrantWriteDocRef(grantId), {
        classId,
        studentId,
        ownerTeacherId: actor.uid,
        granteeUid: grantee.uid,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
        status: "active",
        grantedAt: FieldValue.serverTimestamp(),
        grantedBy: actor.uid,
      });
      writeAuditEventInTransaction(tx, {
        actorUserId: actor.uid,
        actorRole: "teacher",
        action: "supportAccess.granted",
        targetType: "studentSupportGrant",
        targetId: grantId,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
        payload: { classId, studentId, granteeUid: grantee.uid },
      });
      changed = true;
    });
  } catch (err) {
    transactionConflict(err);
  }

  const resolveName = createRosterDisplayNameResolver({ classId, schoolId: actor.schoolId, districtId: actor.districtId });
  const student = await resolveName(studentId);
  const stored = await studentSupportGrantDocRef(grantId).get();
  log.info("supportAccess.granted", { actorUserId: actor.uid, grantId, changed });
  return {
    grant: {
      grantId,
      classId,
      studentId,
      studentDisplayName: student.displayName,
      granteeDisplayName: displayNameOf(grantee.user, "Teacher"),
      granteeEmail: normalizeEmail(grantee.user.email) ?? null,
      grantedAt: millis(stored.exists ? stored.data()?.grantedAt : undefined),
    },
  };
}

// ---------- supportAccessRevoke ----------

export type SupportAccessRevokeResponse = { readonly grantId: string; readonly status: "revoked" };

async function revokeHandler(request: CallableRequest<unknown>): Promise<SupportAccessRevokeResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data);
  const grantId = readId(payload, "grantId", GRANT_ID_PATTERN);

  let changed = false;
  try {
    await runFirestoreTransaction(async (tx) => {
      const snap = await tx.get(studentSupportGrantDocRef(grantId));
      const existing = snap.exists ? snap.data() : undefined;
      if (
        !grantMatchesId(grantId, existing) ||
        existing.ownerTeacherId !== actor.uid ||
        existing.schoolId !== actor.schoolId ||
        existing.districtId !== actor.districtId
      ) {
        throw new PlatformError("supportAccess.notFound", "Support access was not found.");
      }
      if (existing.status === "revoked") {
        changed = false;
        return;
      }
      tx.update(studentSupportGrantRevokeDocRef(grantId), {
        status: "revoked",
        revokedAt: FieldValue.serverTimestamp(),
        revokedBy: actor.uid,
      });
      writeAuditEventInTransaction(tx, {
        actorUserId: actor.uid,
        actorRole: "teacher",
        action: "supportAccess.revoked",
        targetType: "studentSupportGrant",
        targetId: grantId,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
        payload: { classId: existing.classId, studentId: existing.studentId, granteeUid: existing.granteeUid },
      });
      changed = true;
    });
  } catch (err) {
    transactionConflict(err);
  }
  log.info("supportAccess.revoked", { actorUserId: actor.uid, grantId, changed });
  return { grantId, status: "revoked" };
}

// ---------- supportAccessListForClass ----------

export type SupportAccessListForClassResponse = {
  readonly classId: string;
  readonly grants: readonly SupportGrantView[];
};

async function listForClassHandler(request: CallableRequest<unknown>): Promise<SupportAccessListForClassResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data);
  const classId = readId(payload, "classId");
  await loadOwnedClass(classId, actor);

  const snap = await studentSupportGrantsCollectionRef().where("classId", "==", classId).get();
  const rows: Array<{ id: string; data: StudentSupportGrantRecord }> = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!grantMatchesId(doc.id, data)) continue;
    if (data.status !== "active") continue;
    if (data.classId !== classId) continue;
    if (data.ownerTeacherId !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId || data.districtId !== actor.districtId) continue;
    rows.push({ id: doc.id, data });
  }

  const resolveName = createRosterDisplayNameResolver({ classId, schoolId: actor.schoolId, districtId: actor.districtId });
  const grants: SupportGrantView[] = await Promise.all(
    rows.map(async ({ id, data }) => {
      const [student, grantee] = await Promise.all([resolveName(data.studentId), readUser(data.granteeUid)]);
      return {
        grantId: id,
        classId,
        studentId: data.studentId,
        studentDisplayName: student.displayName,
        granteeDisplayName: displayNameOf(grantee, "Teacher"),
        granteeEmail: normalizeEmail(grantee?.email) ?? null,
        grantedAt: millis(data.grantedAt),
      };
    }),
  );
  grants.sort(
    (a, b) =>
      a.studentDisplayName.localeCompare(b.studentDisplayName) ||
      a.granteeDisplayName.localeCompare(b.granteeDisplayName) ||
      (a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0),
  );
  return { classId, grants };
}

// ---------- supportAccessListMine ----------

export type SupportAccessListMineResponse = { readonly students: readonly SharedStudentView[] };

async function listMineHandler(request: CallableRequest<unknown>): Promise<SupportAccessListMineResponse> {
  const actor = await requireTeacher(request);
  asPayload(request.data ?? {});

  const snap = await studentSupportGrantsCollectionRef().where("granteeUid", "==", actor.uid).get();
  const candidates: Array<{ id: string; data: StudentSupportGrantRecord }> = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!grantMatchesId(doc.id, data)) continue;
    if (data.status !== "active" || data.granteeUid !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId || data.districtId !== actor.districtId) continue;
    candidates.push({ id: doc.id, data });
  }

  // Only grants that pass the full read check right now are listed, so the
  // list never offers a student whose Student Detail would be refused.
  const students: SharedStudentView[] = [];
  for (const { id, data } of candidates) {
    let classRecord: ClassRecord;
    try {
      const access = await authorizeStudentScopedRead(actor, data.classId, data.studentId);
      if (access.via !== "grant") continue;
      classRecord = access.classRecord;
    } catch {
      continue;
    }
    const resolveName = createRosterDisplayNameResolver({
      classId: data.classId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
    });
    const [student, owner] = await Promise.all([resolveName(data.studentId), readUser(classRecord.teacherId)]);
    students.push({
      grantId: id,
      classId: data.classId,
      classTitle: classRecord.title,
      studentId: data.studentId,
      studentDisplayName: student.displayName,
      ownerDisplayName: displayNameOf(owner, "Teacher"),
    });
  }
  students.sort(
    (a, b) =>
      a.studentDisplayName.localeCompare(b.studentDisplayName) ||
      a.classTitle.localeCompare(b.classTitle) ||
      (a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0),
  );
  log.info("supportAccess.listedMine", { actorUserId: actor.uid, count: students.length });
  return { students };
}

export const supportAccessGrant = platformCallable(grantHandler);
export const supportAccessRevoke = platformCallable(revokeHandler);
export const supportAccessListForClass = platformCallable(listForClassHandler);
export const supportAccessListMine = platformCallable(listMineHandler);

// Exported for direct unit testing without going through the callable wrapper.
export const __supportAccessHandlers = {
  grant: grantHandler,
  revoke: revokeHandler,
  listForClass: listForClassHandler,
  listMine: listMineHandler,
};
