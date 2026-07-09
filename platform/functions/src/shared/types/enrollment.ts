import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export const ENROLLMENTS_COLLECTION = "enrollments";

// Canonical enrollment lifecycle field per Data Model §3.4. `status` is the
// only lifecycle field on an enrollment document and never coexists with any
// second lifecycle field, consistent with the platform-wide "status is the
// only lifecycle field" invariant. The enumeration follows §3.4 exactly:
// `active` on creation, `transferred` and `withdrawn` for mid-year exits,
// and `archived` as the terminal state applied when the enrolling class is
// archived. No additional transitions are introduced without a documented
// architecture amendment.
export type EnrollmentStatus =
  | "active"
  | "transferred"
  | "withdrawn"
  | "archived";

// Canonical enrollment record shape per Data Model §3.4.
//
// Required fields: studentId, classId, schoolId, status, enrolledAt.
// Optional fields: displayNameOverride, exitedAt.
//
// `schoolId` is a permitted denormalization per §3.4, justified because every
// security rule for enrollments must be able to test school membership
// without a second read. Immutable ownership per §1.2: studentId, classId,
// and schoolId are set at creation and never change.
export type EnrollmentRecord = {
  readonly studentId: string;
  readonly classId: string;
  readonly schoolId: string;
  readonly status: EnrollmentStatus;
  readonly enrolledAt: Timestamp;
  readonly displayNameOverride?: string;
  readonly exitedAt?: Timestamp;
};

// Write shape for the join-by-code and teacher-add creation callables.
// Conforms to Data Model §3.4: studentId, classId, schoolId, and status are
// required on creation, enrolledAt is stamped by the server via
// `FieldValue.serverTimestamp()`, and displayNameOverride is optional. The
// initial status is always `active` at creation per §3.4; other lifecycle
// values are reached only through `enrollmentsSetStatus`.
export type EnrollmentCreationWrite = {
  readonly studentId: string;
  readonly classId: string;
  readonly schoolId: string;
  readonly status: "active";
  readonly enrolledAt: FieldValue;
  readonly displayNameOverride?: string;
};

// Write shape for the status-transition callable (enrollmentsSetStatus).
// Ownership fields (studentId, classId, schoolId) and enrolledAt are
// intentionally absent so no status transition can silently reassign
// ownership or overwrite the creation timestamp. `exitedAt` is stamped by
// the server on transitions to `transferred` or `withdrawn` per §3.4 and is
// absent when the terminal `archived` state is reached through class
// archival. The narrow shape guarantees this write path never turns into a
// metadata edit.
export type EnrollmentStatusChangeWrite = {
  readonly status: EnrollmentStatus;
  readonly exitedAt?: FieldValue;
};
