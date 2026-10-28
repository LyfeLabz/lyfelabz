import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// Student Support Access (PDR-032, docs/platform/STUDENT_SUPPORT_ACCESS.md).
// One server-only record per (class, student, grantee): a class owner lets
// another active teacher at the same school read that one student's Student
// Detail for that one class, read-only. Firestore Rules deny every client
// read and write; only the `supportAccess*` callables write it, and every
// student-scoped read re-validates it through `authorizeStudentScopedRead`.
export const STUDENT_SUPPORT_GRANTS_COLLECTION = "studentSupportGrants";

export type StudentSupportGrantStatus = "active" | "revoked";

// Deterministic document id, so a (class, student, grantee) triple has at
// most one record and a re-grant after revoke reactivates the same record.
// Class ids, student uids and teacher uids are URL-safe tokens without "__".
export function studentSupportGrantIdFor(
  classId: string,
  studentId: string,
  granteeUid: string,
): string {
  return `${classId}__${studentId}__${granteeUid}`;
}

export type StudentSupportGrantRecord = {
  readonly classId: string;
  readonly studentId: string;
  readonly ownerTeacherId: string;
  readonly granteeUid: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly status: StudentSupportGrantStatus;
  readonly grantedAt: Timestamp;
  readonly grantedBy: string;
  readonly revokedAt?: Timestamp;
  readonly revokedBy?: string;
};

// Grant (create or reactivate) write. `revokedAt`/`revokedBy` are cleared
// with `FieldValue.delete()` on reactivation.
export type StudentSupportGrantWrite = {
  readonly classId: string;
  readonly studentId: string;
  readonly ownerTeacherId: string;
  readonly granteeUid: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly status: "active";
  readonly grantedAt: FieldValue;
  readonly grantedBy: string;
  readonly revokedAt?: FieldValue;
  readonly revokedBy?: FieldValue;
};

export type StudentSupportGrantRevokeWrite = {
  readonly status: "revoked";
  readonly revokedAt: FieldValue;
  readonly revokedBy: string;
};
