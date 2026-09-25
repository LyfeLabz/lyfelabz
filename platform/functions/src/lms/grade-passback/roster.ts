import {
  assignmentRecipientDocRef,
  enrollmentDocRef,
  type AssignmentRecord,
} from "../../shared";
import { enrollmentIdFor } from "../../enrollments/enrollments-join-by-code";

// Canonical grade-sync roster boundary for ONE student against the grade
// destination: the student must be a canonical recipient of the destination
// assignment AND actively enrolled in its class. This is the single-student
// form of the same two rules the reconciliation preview applies to the
// whole class (`loadExistingRecipientStudentIds` +
// `loadActiveEnrolledStudentIds`), checked field-for-field identically.
// Read-only: two document reads.
export async function isInGradeSyncRoster(input: {
  readonly assignmentId: string;
  readonly record: AssignmentRecord;
  readonly studentId: string;
  readonly districtId: string;
}): Promise<boolean> {
  const { assignmentId, record, studentId, districtId } = input;
  const [recipientSnapshot, enrollmentSnapshot] = await Promise.all([
    assignmentRecipientDocRef(assignmentId, studentId).get(),
    enrollmentDocRef(enrollmentIdFor(record.classId, studentId)).get(),
  ]);
  const recipient = recipientSnapshot.exists ? recipientSnapshot.data() : undefined;
  if (
    !recipient ||
    recipient.studentId !== studentId ||
    recipient.assignmentId !== assignmentId ||
    recipient.classId !== record.classId ||
    recipient.teacherId !== record.teacherId ||
    recipient.schoolId !== record.schoolId ||
    recipient.districtId !== districtId ||
    recipient.status !== "assigned"
  ) {
    return false;
  }
  const enrollment = enrollmentSnapshot.exists ? enrollmentSnapshot.data() : undefined;
  return (
    enrollment !== undefined &&
    enrollment.classId === record.classId &&
    enrollment.schoolId === record.schoolId &&
    enrollment.studentId === studentId &&
    enrollment.status === "active"
  );
}
