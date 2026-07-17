import { FieldValue } from "firebase-admin/firestore";

import {
  enrollmentsCollectionRef,
  type AssignmentRecipientCreationWrite,
  type AssignmentRecipientSource,
  type EnrollmentRecord,
} from "../shared";

// Narrow, assignment-domain-specific helpers for the canonical recipient
// subcollection at `assignments/{assignmentId}/recipients/{studentId}` per
// PDR-029h. These helpers are intentionally not a generic membership
// framework and are exported only to callables inside this domain.

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Canonical frozen ownership snapshot used to construct one recipient
// document. Every field is required so no recipient can be written with a
// partial ownership snapshot. The caller derives each field from a trusted
// server-side source: the assignment record, the class record, and the
// authenticated caller's district context.
export type RecipientOwnershipContext = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly assignedBy: string;
};

// Build one canonical `AssignmentRecipientCreationWrite` payload with the
// server-timestamp sentinel already applied. The write shape is exhaustive
// so that a single spread never omits an ownership field.
export function buildRecipientCreationWrite(
  context: RecipientOwnershipContext,
  studentId: string,
  source: AssignmentRecipientSource,
): AssignmentRecipientCreationWrite {
  return {
    assignmentId: context.assignmentId,
    studentId,
    classId: context.classId,
    teacherId: context.teacherId,
    schoolId: context.schoolId,
    districtId: context.districtId,
    assignedAt: FieldValue.serverTimestamp(),
    assignedBy: context.assignedBy,
    source,
    status: "assigned",
  };
}

// Canonical population rule for the initial recipient snapshot per
// PDR-029l. Returns the sorted, deduplicated set of `studentId` values for
// which a recipient document must be created during first publication.
//
// Population rules:
//   - The enrollment record must exist and be non-empty.
//   - `enrollment.classId` must equal the assignment's `classId`.
//   - `enrollment.schoolId` must equal the assignment's `schoolId`.
//   - `enrollment.status` must equal `"active"`.
//   - `enrollment.studentId` must be a non-empty string.
//   - Duplicate enrollment records for the same student contribute exactly
//     one recipient.
//
// Malformed rows and rows that fail any of these predicates are silently
// dropped consistent with the defense-in-depth filtering pattern used by
// `assessmentAssignmentSummary`. The sole documented cause of a mismatch
// is a data-invariant violation that the writer layer must not amplify.
//
// The returned array is sorted lexicographically so batch commits are
// deterministic and unit tests can assert exact write ordering.
export async function loadInitialRecipientPopulation(
  assignmentClassId: string,
  assignmentSchoolId: string,
): Promise<readonly string[]> {
  const snapshot = await enrollmentsCollectionRef()
    .where("classId", "==", assignmentClassId)
    .get();
  const seen = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data() as EnrollmentRecord | undefined;
    if (!data) continue;
    if (data.classId !== assignmentClassId) continue;
    if (data.schoolId !== assignmentSchoolId) continue;
    if (data.status !== "active") continue;
    if (!isNonEmptyString(data.studentId)) continue;
    seen.add(data.studentId);
  }
  return Array.from(seen).sort();
}
