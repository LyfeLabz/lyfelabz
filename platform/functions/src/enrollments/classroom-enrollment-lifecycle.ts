import { FieldValue } from "firebase-admin/firestore";

import {
  enrollmentClassroomReactivationDocRef,
  enrollmentClassroomWithdrawalDocRef,
  enrollmentDocRef,
  runFirestoreTransaction,
  writeAuditEvent,
  type ClassroomEnrollmentReactivationWrite,
  type ClassroomEnrollmentWithdrawalWrite,
  type EnrollmentRecord,
} from "../shared";

import { addActiveEnrollmentAsRecipients } from "./membership-enrollment";

// Google Classroom roster-synchronization enrollment transitions, with
// durable withdrawal provenance (forward-only; see `EnrollmentExitSource`).
//
// These are the ONLY two Classroom-reconciliation enrollment writes:
//
//   - `withdrawEnrollmentForClassroomSync`: `active -> withdrawn` because
//     the student is no longer in the linked Classroom class. Stamps
//     `exitSource: "lmsRosterSync"` and `exitLinkId` (the link whose roster
//     caused it) and audits `lms.classroomEnrollmentWithdrawn`. Used by BOTH
//     Classroom writers: membership refresh (`lmsClassesRefreshRoster`) and
//     the enrollment sync engine (`lmsClassesSyncRoster`).
//
//   - `reactivateClassroomWithdrawnEnrollment`: `withdrawn -> active` for an
//     enrollment that Classroom synchronization ITSELF withdrew for the
//     class's CURRENT link, once the student is back in that Classroom
//     class. The platform's only withdrawn -> active write; deliberately
//     narrow and not a generic transition.
//
// Both re-read the enrollment inside a Firestore transaction, so a
// concurrent teacher transition can never be overwritten with Classroom
// provenance, and a teacher withdrawal / archive / transfer that lands
// first is never reactivated.

// `active -> withdrawn` with Classroom provenance. Returns whether this call
// withdrew the enrollment (false when it is missing or not `active`). The
// enrollment document and everything keyed to it are kept. Idempotent.
export async function withdrawEnrollmentForClassroomSync(input: {
  readonly enrollmentId: string;
  // The `lmsClassLinks` id whose roster no longer contains the student.
  readonly linkId: string;
  // The teacher whose refresh/sync ran (audit actor).
  readonly actorUid: string;
}): Promise<boolean> {
  const withdrawn = await runFirestoreTransaction<EnrollmentRecord | null>(async (tx) => {
    const snap = await tx.get(enrollmentDocRef(input.enrollmentId));
    if (!snap.exists) return null;
    const enrollment = snap.data();
    if (!enrollment || enrollment.status !== "active") return null;
    const write: ClassroomEnrollmentWithdrawalWrite = {
      status: "withdrawn",
      exitedAt: FieldValue.serverTimestamp(),
      exitSource: "lmsRosterSync",
      exitLinkId: input.linkId,
    };
    tx.update(enrollmentClassroomWithdrawalDocRef(input.enrollmentId), write);
    return enrollment;
  });
  if (withdrawn === null) return false;

  await writeAuditEvent({
    actorUserId: input.actorUid,
    actorRole: "teacher",
    action: "lms.classroomEnrollmentWithdrawn",
    targetType: "enrollment",
    targetId: input.enrollmentId,
    schoolId: withdrawn.schoolId,
    payload: {
      classId: withdrawn.classId,
      studentId: withdrawn.studentId,
      providerId: "googleClassroom",
    },
  });
  return true;
}

export type ClassroomReactivationOutcome =
  // This call moved the enrollment back to `active`.
  | "reactivated"
  // Already active (e.g. a repeated refresh): nothing to do.
  | "alreadyActive"
  // Anything else: missing, archived, transferred, a teacher withdrawal, a
  // withdrawal with unknown (historical) provenance, a withdrawal caused by
  // a different Classroom link, or a record that disagrees with the caller.
  | "notEligible";

// Classroom-managed reactivation. The CALLER must already have established,
// from the fresh Classroom roster, that the student is present upstream and
// that their canonical Google identity mapping resolves to an ACTIVE
// `student` user record in the class's school. This primitive then
// reactivates the enrollment only when the enrollment itself proves that
// Classroom synchronization withdrew it for the class's CURRENT link:
// `status === "withdrawn"`, `exitSource === "lmsRosterSync"`, and
// `exitLinkId === linkId`. Absent provenance (every historical withdrawal)
// is never eligible.
//
// On success the SAME enrollment document becomes `active` (ownership and
// `enrolledAt` untouched, so all attempts and history stay attached), the
// withdrawn-only fields (`exitedAt`, `exitSource`, `exitLinkId`) are
// cleared, `lms.classroomEnrollmentReactivated` is audited, and the student
// is best-effort added to the class's currently published assignments
// through the same recipient logic a new enrollment uses.
export async function reactivateClassroomWithdrawnEnrollment(input: {
  readonly enrollmentId: string;
  readonly classId: string;
  readonly studentId: string;
  readonly schoolId: string;
  // The class's CURRENT `lmsClassLinks` id.
  readonly linkId: string;
  // The teacher whose refresh ran (audit actor).
  readonly actorUid: string;
}): Promise<ClassroomReactivationOutcome> {
  const outcome = await runFirestoreTransaction<ClassroomReactivationOutcome>(async (tx) => {
    const snap = await tx.get(enrollmentDocRef(input.enrollmentId));
    if (!snap.exists) return "notEligible";
    const enrollment = snap.data();
    if (
      !enrollment ||
      enrollment.studentId !== input.studentId ||
      enrollment.classId !== input.classId ||
      enrollment.schoolId !== input.schoolId
    ) {
      return "notEligible";
    }
    if (enrollment.status === "active") return "alreadyActive";
    if (
      enrollment.status !== "withdrawn" ||
      enrollment.exitSource !== "lmsRosterSync" ||
      enrollment.exitLinkId !== input.linkId
    ) {
      return "notEligible";
    }
    const write: ClassroomEnrollmentReactivationWrite = {
      status: "active",
      exitedAt: FieldValue.delete(),
      exitSource: FieldValue.delete(),
      exitLinkId: FieldValue.delete(),
    };
    tx.update(enrollmentClassroomReactivationDocRef(input.enrollmentId), write);
    return "reactivated";
  });
  if (outcome !== "reactivated") return outcome;

  await writeAuditEvent({
    actorUserId: input.actorUid,
    actorRole: "teacher",
    action: "lms.classroomEnrollmentReactivated",
    targetType: "enrollment",
    targetId: input.enrollmentId,
    schoolId: input.schoolId,
    payload: {
      classId: input.classId,
      studentId: input.studentId,
      providerId: "googleClassroom",
      previousStatus: "withdrawn",
    },
  });

  await addActiveEnrollmentAsRecipients({
    classId: input.classId,
    studentId: input.studentId,
    schoolId: input.schoolId,
  });
  return "reactivated";
}
