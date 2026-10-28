import {
  PlatformError,
  classDocRef,
  enrollmentDocRef,
  studentSupportGrantDocRef,
  studentSupportGrantIdFor,
  userRecordDocRef,
  type ClassRecord,
  type StudentSupportGrantRecord,
} from "../shared";

// Student Support Access (PDR-032c, docs/platform/STUDENT_SUPPORT_ACCESS.md
// section 4). The ONE server-side check for student-scoped teacher reads.
//
// The caller must already have passed `requireDistrictContext` as an active
// teacher; `actor` is that verified context, never client input. The check
// admits:
//   - the class owner (frozen `teacherId` + `schoolId`), exactly as every
//     student-scoped read admitted before this helper existed; or
//   - a grantee holding the active grant for exactly (classId, studentId,
//     caller), whose class is active, whose student's enrollment is active,
//     and whose owner is still an active teacher at the class's school.
//
// It returns the class OWNER's uid. Callers compare every frozen row
// ownership field against `ownerTeacherId`, never against the caller, so a
// grantee sees exactly the rows the owner would see for that one student.
//
// Every refusal is `classes.forbidden`, indistinguishable from a class the
// caller has never seen. Any unexpected failure while evaluating a grant also
// fails closed with the same code.

export type StudentScopedReadActor = {
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
};

export type StudentScopedReadAccess = {
  readonly classRecord: ClassRecord;
  readonly ownerTeacherId: string;
  readonly via: "owner" | "grant";
  // Present only for `via: "grant"`.
  readonly grantId?: string;
};

function forbidden(): never {
  throw new PlatformError("classes.forbidden", "Caller does not have access to this class.");
}

async function loadClassOrForbidden(classId: string): Promise<ClassRecord> {
  const snap = await classDocRef(classId).get();
  const data = snap.exists ? snap.data() : undefined;
  if (!data) {
    throw new PlatformError("classes.forbidden", "Class was not found.");
  }
  return data;
}

// Grant-path checks 3-6 (contract section 4). Throws on any mismatch.
async function assertActiveGrant(
  actor: StudentScopedReadActor,
  classId: string,
  studentId: string,
  classRecord: ClassRecord,
): Promise<string> {
  if (classRecord.status !== "active") forbidden();

  const grantId = studentSupportGrantIdFor(classId, studentId, actor.uid);
  const [grantSnap, enrollmentSnap, ownerSnap] = await Promise.all([
    studentSupportGrantDocRef(grantId).get(),
    enrollmentDocRef(`${classId}__${studentId}`).get(),
    userRecordDocRef(classRecord.teacherId).get(),
  ]);

  const grant: StudentSupportGrantRecord | undefined = grantSnap.exists
    ? grantSnap.data()
    : undefined;
  if (
    grant === undefined ||
    grant.status !== "active" ||
    grant.classId !== classId ||
    grant.studentId !== studentId ||
    grant.granteeUid !== actor.uid ||
    grant.ownerTeacherId !== classRecord.teacherId ||
    grant.schoolId !== classRecord.schoolId ||
    grant.schoolId !== actor.schoolId ||
    grant.districtId !== actor.districtId
  ) {
    forbidden();
  }

  const enrollment = enrollmentSnap.exists ? enrollmentSnap.data() : undefined;
  if (
    enrollment === undefined ||
    enrollment.status !== "active" ||
    enrollment.studentId !== studentId ||
    enrollment.classId !== classId ||
    enrollment.schoolId !== classRecord.schoolId
  ) {
    forbidden();
  }

  const owner = ownerSnap.exists ? ownerSnap.data() : undefined;
  if (
    owner === undefined ||
    owner.authUid !== classRecord.teacherId ||
    owner.status !== "active" ||
    owner.role !== "teacher" ||
    owner.schoolId !== classRecord.schoolId
  ) {
    forbidden();
  }

  return grantId;
}

export async function authorizeStudentScopedRead(
  actor: StudentScopedReadActor,
  classId: string,
  studentId: string,
): Promise<StudentScopedReadAccess> {
  const classRecord = await loadClassOrForbidden(classId);
  return authorizeStudentScopedReadForLoadedClass(actor, classId, studentId, classRecord);
}

// Same check for a class record the caller already loaded (used by
// `assessmentAttemptGetForTeacher`, which resolves the class from the
// attempt's frozen `classId`).
export async function authorizeStudentScopedReadForLoadedClass(
  actor: StudentScopedReadActor,
  classId: string,
  studentId: string,
  classRecord: ClassRecord,
): Promise<StudentScopedReadAccess> {
  if (classRecord.schoolId !== actor.schoolId) forbidden();
  if (classRecord.teacherId === actor.uid) {
    return { classRecord, ownerTeacherId: classRecord.teacherId, via: "owner" };
  }
  let grantId: string;
  try {
    grantId = await assertActiveGrant(actor, classId, studentId, classRecord);
  } catch (err) {
    if (err instanceof PlatformError && err.code === "classes.forbidden") throw err;
    forbidden();
  }
  return {
    classRecord,
    ownerTeacherId: classRecord.teacherId,
    via: "grant",
    grantId,
  };
}
