import { FieldValue } from "firebase-admin/firestore";

import {
  PlatformError,
  enrollmentCreationDocRef,
  enrollmentDocRef,
  log,
  schoolDocRef,
  writeAuditEvent,
  type EnrollmentCreationWrite,
} from "../shared";

import { enrollmentIdFor } from "./enrollments-join-by-code";
import { reconcileRecipientsForNewEnrollment } from "../assignments/assignment-recipients";

// Canonical "create a class enrollment from trusted Google Classroom
// membership" step. Shared by the two callers that establish an enrollment
// from a verified identity match against Classroom membership:
//
//   - `materializeLmsEnrollmentsFromMembership` (the student's own first
//     `Continue with Google Classroom` onboarding), and
//   - the teacher's manual roster refresh (`lmsClassesRefreshRoster` with
//     enrollment reconciliation), for a student who ALREADY has an active
//     LyfeLabz account and was newly added to this Classroom class.
//
// The caller is responsible for the identity match and for confirming the
// class is an active LMS class in the student's school. This step only:
//   1. preserves an existing enrollment at the deterministic id exactly as
//      it is (idempotent; it NEVER reactivates an ended enrollment - the
//      only withdrawn -> active write is the narrow Classroom-managed
//      `reactivateClassroomWithdrawnEnrollment`, which the teacher's manual
//      refresh calls separately),
//   2. otherwise creates the `active` enrollment,
//   3. emits the `lms.membershipEnrollmentCreated` audit event, and
//   4. best-effort adds the student as a recipient of the class's currently
//      published assignments (`addActiveEnrollmentAsRecipients`; a failure
//      never undoes the enrollment).

export type MembershipEnrollmentOutcome =
  | { readonly kind: "created" }
  | { readonly kind: "existing"; readonly status: string };

// Resolve the district of the trusted school record (recipient records
// freeze `districtId`). Mirrors `resolveSchoolDistrictId` in
// `students-complete-lms-onboarding.ts`.
async function resolveDistrictId(schoolId: string): Promise<string> {
  const snapshot = await schoolDocRef(schoolId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "students.schoolNotFound",
      "Referenced school does not exist.",
    );
  }
  const school = snapshot.data();
  const districtId = school?.districtId;
  if (typeof districtId !== "string" || districtId.trim().length === 0) {
    throw new PlatformError(
      "district-unassigned",
      "The referenced school is not assigned to a district.",
    );
  }
  return districtId;
}

export async function createEnrollmentFromTrustedMembership(input: {
  readonly classId: string;
  readonly schoolId: string;
  readonly studentId: string;
  // Who established the enrollment: the student during their own
  // onboarding, or the class's teacher during a manual roster refresh.
  readonly actor: { readonly userId: string; readonly role: "student" | "teacher" };
  // PII-free audit marker for the path that created the enrollment.
  readonly source: "lmsMembership" | "teacherRosterRefresh";
}): Promise<MembershipEnrollmentOutcome> {
  const { classId, schoolId, studentId } = input;
  const enrollmentId = enrollmentIdFor(classId, studentId);
  const existing = await enrollmentDocRef(enrollmentId).get();
  if (existing.exists) {
    const status = existing.data()?.status;
    return { kind: "existing", status: typeof status === "string" ? status : "unknown" };
  }

  const creation: EnrollmentCreationWrite = {
    studentId,
    classId,
    schoolId,
    status: "active",
    enrolledAt: FieldValue.serverTimestamp(),
  };
  await enrollmentCreationDocRef(enrollmentId).set(creation);

  await writeAuditEvent({
    actorUserId: input.actor.userId,
    actorRole: input.actor.role,
    action: "lms.membershipEnrollmentCreated",
    targetType: "class",
    targetId: classId,
    schoolId,
    payload: { providerId: "googleClassroom", source: input.source },
  });

  await addActiveEnrollmentAsRecipients({ classId, studentId, schoolId });

  return { kind: "created" };
}

// Phase B Core, Automatic Enrollment Reconciliation slice (Layer 1
// promptness only - see `reconcileRecipientsForNewEnrollment`'s own doc
// comment). An enrollment has just become active (newly created, or
// reactivated by Classroom reconciliation); best-effort add the student as a
// recipient of every currently published assignment in this class. That
// step is idempotent and never mutates an existing recipient, so a returning
// student's earlier recipient records are untouched. Never throws: a
// reconciliation failure never undoes the already-successful enrollment
// change.
export async function addActiveEnrollmentAsRecipients(input: {
  readonly classId: string;
  readonly studentId: string;
  readonly schoolId: string;
}): Promise<void> {
  const { classId, studentId, schoolId } = input;
  try {
    const districtId = await resolveDistrictId(schoolId);
    const result = await reconcileRecipientsForNewEnrollment({
      classId,
      studentId,
      schoolId,
      districtId,
    });
    try {
      log.info("enrollments.newEnrollmentRecipientsReconciled", {
        studentId,
        classId,
        assignmentsConsidered: result.assignmentsConsidered,
        recipientsAdded: result.recipientsAdded,
      });
    } catch {
      // Logging is observability, not lifecycle.
    }
  } catch (err) {
    try {
      log.warn("enrollments.newEnrollmentRecipientReconciliationFailed", {
        studentId,
        classId,
        error: err instanceof Error ? err.message : "unknown",
      });
    } catch {
      // Logging is observability, not lifecycle.
    }
  }
}
