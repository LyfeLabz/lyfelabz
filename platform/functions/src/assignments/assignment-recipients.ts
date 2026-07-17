import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
} from "firebase-admin/firestore";

import {
  assignmentRecipientDocRef,
  enrollmentsCollectionRef,
  type AssignmentRecipientCreationWrite,
  type AssignmentRecipientRecord,
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

// Ownership snapshot required by `isCanonicalRecipient` to verify that a
// recipient record represents the authenticated caller against the target
// assignment. Every field is derived server-side: `assignmentId` and
// `studentId` from the request + caller identity, and `schoolId` +
// `districtId` from the caller's verified district context (PDR-025). No
// client-supplied ownership value participates.
export type RecipientEnforcementContext = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly schoolId: string;
  readonly districtId: string;
};

// Reader abstraction so the same helper serves both the plain `.get()`
// call site in `assessmentSessionsBegin` and the transactional `tx.get()`
// call site in `assessmentAttemptsFinalize` without duplicating Firestore
// path construction. Callers pass a bound `tx.get` (or `(ref) => ref.get()`)
// so the read participates in whatever surrounding read set is required.
export type RecipientReader = (
  ref: DocumentReference<AssignmentRecipientRecord>,
) => Promise<DocumentSnapshot<AssignmentRecipientRecord>>;

// Canonical assignment-recipient membership check per PDR-029l. Returns
// `true` only when the recipient document exists AND every ownership field
// on the record matches the enforcement context. Every other outcome
// (missing document, empty data, ownership mismatch, non-`assigned`
// status) fails closed with `false`. The caller translates `false` into
// its own domain-scoped refusal identifier so no client observes a
// broader authorization framework.
//
// Exactly one document read per invocation; no enumeration, no query, no
// derivation from enrollment, sessions, attempts, or user profiles.
export async function isCanonicalRecipient(
  context: RecipientEnforcementContext,
  read: RecipientReader,
): Promise<boolean> {
  const ref = assignmentRecipientDocRef(
    context.assignmentId,
    context.studentId,
  );
  const snapshot = await read(ref);
  if (!snapshot.exists) return false;
  const data = snapshot.data();
  if (!data) return false;
  if (data.assignmentId !== context.assignmentId) return false;
  if (data.studentId !== context.studentId) return false;
  if (data.schoolId !== context.schoolId) return false;
  if (data.districtId !== context.districtId) return false;
  if (data.status !== "assigned") return false;
  return true;
}
