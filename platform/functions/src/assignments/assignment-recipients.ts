import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
} from "firebase-admin/firestore";

import {
  PlatformError,
  assignmentRecipientCreationDocRef,
  assignmentRecipientDocRef,
  assignmentRecipientsCollectionRef,
  assignmentsCollectionRef,
  enrollmentsCollectionRef,
  type AssignmentRecipientCreationWrite,
  type AssignmentRecipientRecord,
  type AssignmentRecipientSource,
  type AssignmentRecord,
  type EnrollmentRecord,
} from "../shared";

// Narrow, assignment-domain-specific helpers for the canonical recipient
// subcollection at `assignments/{assignmentId}/recipients/{studentId}` per
// PDR-029h. These helpers are intentionally not a generic membership
// framework.
//
// Student Progress & Assignment Membership, Phase B Core: most of this
// file's exports are consumed only by callables inside the `assignments`
// domain, but `reconcileRecipientsForNewEnrollment` below is deliberately
// ALSO consumed cross-domain, by the enrollment-creation pathways in
// `enrollments/` and `students/`, immediately after each of them
// establishes a genuinely new active enrollment. There is no existing
// import-boundary lint rule in this codebase restricting that direction
// (the reverse direction - `assignments-recipient-add.ts` importing
// `enrollmentIdFor` from `../enrollments/enrollments-join-by-code` -
// already exists), and this file remains the correct home for it because
// it is the shared, non-authorizing recipient-write primitive every one
// of those callers needs to reuse rather than duplicate.

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

// Phase B Core, Slice 1. Result of `ensureAssignmentRecipient`. `added` is
// `true` when this call wrote a new recipient document, and `false` when
// the recipient already existed and no mutation occurred (idempotent
// no-op) - the identical two-outcome shape `assignmentsRecipientAdd` has
// always returned to its own caller.
export type EnsureAssignmentRecipientResult = {
  readonly added: boolean;
};

// Phase B Core, Slice 1. The single shared low-level operation underlying
// every present and future recipient-creation path in this domain: given
// an ALREADY-AUTHORIZED context, ensure exactly one canonical recipient
// document exists for (assignmentId, studentId).
//
// This helper performs NO authorization, ownership, or eligibility
// checking of its own. It is not a generic membership framework and must
// never be reachable from a client directly. Every one of the following
// facts MUST already be established by the caller, through its own
// authorization sequence, before this helper is invoked - this helper
// trusts `context` completely and re-verifies none of it:
//   - the assignment identified by `context.assignmentId` exists, has
//     `status === "published"`, and its frozen `teacherId`/`schoolId`
//     equal the corresponding fields on `context`
//   - the class identified by `context.classId` exists and its ownership
//     (`teacherId`/`schoolId`) is internally consistent with the
//     assignment
//   - `studentId` has an `active` enrollment in `context.classId` /
//     `context.schoolId`
// `assignmentsRecipientAdd` establishes all three today through its own
// certified sequence (PDR-029j) before calling this. Later Phase B slices
// (a teacher-initiated bulk reconcile callable, an enrollment-time
// reconciliation hook, and a session-begin self-heal path) will each
// establish these same facts through whatever authorization sequence is
// correct for their own caller - none of that is implemented here, and
// this helper's contract is written so adding those callers later never
// requires touching this function's own logic.
//
// Idempotent by construction: a pre-existing recipient document for this
// (assignmentId, studentId) pair is left completely untouched - its
// `source` and `assignedAt` are never overwritten - and `{ added: false }`
// is returned. Otherwise exactly one recipient document is created with
// the given `source` and `{ added: true }` is returned.
//
// Deliberately emits no audit event and no log line. Every caller of this
// helper has its own actor identity and actor role (a teacher clicking
// "Add" is not the same actor as a future system-initiated reconciliation
// triggered by a student's own enrollment or session-begin call), and the
// correct audit `action` name and payload shape belong to the caller, not
// to this shared primitive. `assignmentsRecipientAdd` continues to own its
// own `assignments.recipientAdded` audit event and log lines exactly as
// before this extraction.
export async function ensureAssignmentRecipient(
  context: RecipientOwnershipContext,
  studentId: string,
  source: AssignmentRecipientSource,
): Promise<EnsureAssignmentRecipientResult> {
  const existing = await assignmentRecipientDocRef(
    context.assignmentId,
    studentId,
  ).get();
  if (existing.exists) {
    const enforcementContext: RecipientEnforcementContext = {
      assignmentId: context.assignmentId,
      studentId,
      schoolId: context.schoolId,
      districtId: context.districtId,
    };
    if (!isCanonicalRecipientData(existing.data(), enforcementContext)) {
      throw new PlatformError(
        "assignments.recipientIntegrityViolation",
        "Existing recipient document does not match canonical ownership fields",
      );
    }
    return { added: false };
  }
  await assignmentRecipientCreationDocRef(context.assignmentId, studentId).set(
    buildRecipientCreationWrite(context, studentId, source),
  );
  return { added: true };
}

function isNonEmptyStringValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Phase B Core, Automatic Enrollment Reconciliation slice. Result of
// `reconcileRecipientsForNewEnrollment`, useful only for safe operational
// logging at the caller - it names no student and carries only bounded
// counts.
export type ReconcileRecipientsForNewEnrollmentResult = {
  readonly assignmentsConsidered: number;
  readonly recipientsAdded: number;
};

// Phase B Core, Automatic Enrollment Reconciliation slice (Layer 1 -
// enrollment-time promptness only; the stronger Layer 2 convergence
// guarantee inside `assessmentSessionsBegin` is a later, separate slice
// and is NOT implemented by this function).
//
// Preconditions the CALLER must have already established, through its own
// trusted server pathway, before invoking this function - it performs no
// enrollment authorization of its own and is not reachable from a client:
//   - `studentId` now has a genuinely new `active` enrollment in
//     `classId` (this function is meant to be called once per such
//     transition, not on every idempotent replay of an already-active
//     enrollment)
//   - `schoolId` and `districtId` are the verified, authoritative values
//     for that enrollment (never client-supplied)
//
// Behavior: finds every assignment for `classId` (single-field `classId`
// query - the same "no new index" shape `loadInitialRecipientPopulation`
// and `assignmentsRecipientsReconcile` already use, status filtered in
// code) whose `status === "published"` and whose frozen `schoolId`
// matches the trusted `schoolId` (defense in depth against a malformed or
// cross-scope assignment record), then idempotently ensures `studentId`
// is a canonical recipient of EACH one via `ensureAssignmentRecipient`,
// source `"lateJoinReconciliation"`, `assignedBy` set to that assignment's
// own frozen `teacherId` (matching the existing convention: every
// recipient source stamps `assignedBy` as the owning teacher, never a
// generic "system" placeholder).
//
// If more than one `published` assignment already exists for the same
// class (a known historical-duplicate state per the prior architecture
// audit), this deliberately reconciles the student into ALL of them - it
// never groups by `lessonSlug` and never infers or chooses a single
// "correct" occurrence, because no authoritative occurrence relationship
// exists yet to choose from. `draft`, `closed`, and `archived` assignments
// are never touched: a `closed` assignment is never reopened and never
// gains a recipient, exactly matching `assignmentsRecipientAdd`'s and
// `assignmentsRecipientsReconcile`'s own certified refusal of anything but
// `published`.
//
// Never creates an assignment. Never calls any Classroom-facing function.
// Never mutates an existing recipient (each per-assignment call is
// `ensureAssignmentRecipient`'s own idempotent existence-check-then-write).
// This function does not swallow errors itself - it propagates them so
// each caller's own try/catch and logging policy applies; per-caller
// integration is what makes a single assignment's reconciliation failure
// non-fatal to the enrollment operation that triggered it.
export async function reconcileRecipientsForNewEnrollment(input: {
  readonly classId: string;
  readonly studentId: string;
  readonly schoolId: string;
  readonly districtId: string;
}): Promise<ReconcileRecipientsForNewEnrollmentResult> {
  const snapshot = await assignmentsCollectionRef()
    .where("classId", "==", input.classId)
    .get();

  const published: Array<{ readonly assignmentId: string; readonly teacherId: string }> = [];
  for (const doc of snapshot.docs) {
    const data = doc.data() as AssignmentRecord | undefined;
    if (!data) continue;
    if (data.classId !== input.classId) continue;
    if (data.schoolId !== input.schoolId) continue;
    if (data.status !== "published") continue;
    if (!isNonEmptyStringValue(data.teacherId)) continue;
    published.push({ assignmentId: doc.id, teacherId: data.teacherId });
  }

  const results = await Promise.all(
    published.map(({ assignmentId, teacherId }) => {
      const context: RecipientOwnershipContext = {
        assignmentId,
        classId: input.classId,
        teacherId,
        schoolId: input.schoolId,
        districtId: input.districtId,
        assignedBy: teacherId,
      };
      return ensureAssignmentRecipient(
        context,
        input.studentId,
        "lateJoinReconciliation",
      );
    }),
  );

  return {
    assignmentsConsidered: published.length,
    recipientsAdded: results.filter((r) => r.added).length,
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

// Shared canonical-recipient validation predicate used by both
// `isCanonicalRecipient` and `ensureAssignmentRecipient`. ONE definition
// of "canonical" per PDR-029l: the document must match every ownership
// field against the server-derived enforcement context and carry
// status === "assigned".
export function isCanonicalRecipientData(
  data: FirebaseFirestore.DocumentData | undefined,
  context: RecipientEnforcementContext,
): boolean {
  if (!data) return false;
  if (data.assignmentId !== context.assignmentId) return false;
  if (data.studentId !== context.studentId) return false;
  if (data.schoolId !== context.schoolId) return false;
  if (data.districtId !== context.districtId) return false;
  if (data.status !== "assigned") return false;
  return true;
}

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
  return isCanonicalRecipientData(snapshot.data(), context);
}

// Historical Assignment Resolution, Implementation Slice 6. Extracted,
// behavior-preserving, from `assignmentsRecipientsReconcile`'s handler body
// (Student Progress & Assignment Membership, Phase B Core, Slice 2). This is
// the identical active-enrollment predicate `loadInitialRecipientPopulation`
// already applies, reused here by direct query rather than by calling that
// function because `reconcileAssignmentRecipients` below needs the raw
// filtered `studentId` set to diff against existing recipients, not that
// function's already-deduplicated, already-sorted return array.
export async function loadActiveEnrolledStudentIds(
  classId: string,
  schoolId: string,
): Promise<ReadonlySet<string>> {
  const snapshot = await enrollmentsCollectionRef()
    .where("classId", "==", classId)
    .get();
  const seen = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data() as EnrollmentRecord | undefined;
    if (!data) continue;
    if (data.classId !== classId) continue;
    if (data.schoolId !== schoolId) continue;
    if (data.status !== "active") continue;
    if (!isNonEmptyStringValue(data.studentId)) continue;
    seen.add(data.studentId);
  }
  return seen;
}

// Existing canonical recipients for the assignment, defensively filtered
// exactly as `assessmentAssignmentSummary`'s population read already is: the
// recipient doc id must equal its own `studentId` field, and every
// ownership field must match the authoritative reconciliation context. A
// malformed or cross-scope row is silently dropped rather than amplified,
// consistent with the defense-in-depth pattern used throughout this domain.
//
// Collapsed from the pre-extraction two-object shape
// (`loadExistingRecipientStudentIds(assignmentId, classId, actor,
// assignment)`, where `actor.schoolId` and `assignment.schoolId` were
// checked as two separately-named fields) into the single flattened
// `RecipientOwnershipContext.schoolId`. This is behavior-preserving, not a
// weakening: every caller of `reconcileAssignmentRecipients` already
// independently verifies `assignment.schoolId === actor.schoolId` (or the
// Slice-3-resolver-guaranteed equivalent) before constructing this context,
// so the two checks were always comparing values already proven equal by
// that point - collapsing them removes a literally-redundant comparison
// against an already-guaranteed-equal value, not a distinct security check.
export async function loadExistingRecipientStudentIds(
  context: RecipientOwnershipContext,
): Promise<ReadonlySet<string>> {
  const snapshot = await assignmentRecipientsCollectionRef(
    context.assignmentId,
  ).get();
  const seen = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data() as AssignmentRecipientRecord | undefined;
    if (!data) continue;
    if (doc.id !== data.studentId) continue;
    if (data.assignmentId !== context.assignmentId) continue;
    if (data.classId !== context.classId) continue;
    if (data.teacherId !== context.teacherId) continue;
    if (data.schoolId !== context.schoolId) continue;
    if (data.districtId !== context.districtId) continue;
    if (data.status !== "assigned") continue;
    if (!isNonEmptyStringValue(data.studentId)) continue;
    seen.add(data.studentId);
  }
  return seen;
}

// Result of `reconcileAssignmentRecipients`: the identical two-count
// aggregate shape `assignmentsRecipientsReconcile` has always returned.
export type ReconcileAssignmentRecipientsResult = {
  readonly added: number;
  readonly alreadyCurrent: number;
};

// The shared reconciliation engine (Historical Assignment Resolution,
// Implementation Slice 6). Given an ALREADY-AUTHORITATIVE
// `RecipientOwnershipContext` and a canonical recipient source, brings the
// named assignment's recipients up to date with the class's current active
// enrollment: every active-enrolled student who is not yet a canonical
// recipient gets one created; canonical recipients are left untouched;
// integrity-violating (malformed/noncanonical) existing recipients cause
// `ensureAssignmentRecipient` to throw `assignments.recipientIntegrityViolation`
// exactly as before.
//
// This function performs NO authentication, NO role check, and NO
// assignment/class ownership or status validation of its own - it trusts
// `context` completely, mirroring `ensureAssignmentRecipient`'s own
// documented contract exactly one layer up. Every fact `context` encodes
// (that `context.assignmentId` genuinely belongs to `context.teacherId` /
// `context.schoolId` / `context.classId`, and that the assignment is
// eligible for reconciliation) MUST already be established by the caller
// through the caller's own authorization sequence before this function is
// invoked. It is deliberately NOT a second authorization surface: it is
// reachable only from server-side code that has already done that work,
// never exported as a Firebase callable, and never given a raw client
// request or auth object.
//
// This is what makes the engine safe to reuse from a future
// Current-resolution-based caller (Slice 7) that never accepts an
// `assignmentId` from the client at all: that caller establishes context
// through an entirely different chain (resolving and validating a live
// Current pointer, per `resolveValidCurrentAssignmentId`/
// `requireValidCurrentAssignmentId` in `./resolve-current-assignment.ts`)
// and then constructs the identical `RecipientOwnershipContext` shape from
// its own already-authoritative result - this function has no dependency
// on, or awareness of, which authorization chain produced its input.
//
// Partial-success semantics are UNCHANGED from the pre-extraction inline
// implementation: `ensureAssignmentRecipient` is invoked once per missing
// student via `Promise.all`, concurrently, not transactionally. If one
// student's call throws (e.g. an integrity violation on a different,
// unrelated malformed existing recipient row does not occur here, since
// only MISSING students are ensured - but a concurrent write racing this
// call could still surface `assignments.recipientIntegrityViolation` for a
// student whose recipient was concurrently created in a noncanonical shape
// between this call's enrollment snapshot and its own write), the
// `Promise.all` rejects immediately and this function propagates that
// rejection; any other students' `ensureAssignmentRecipient` calls that had
// already completed successfully in the same batch are NOT rolled back and
// their writes remain. This was already true of the original inline
// implementation and is preserved exactly, not "improved" into an
// all-or-nothing operation.
export async function reconcileAssignmentRecipients(
  context: RecipientOwnershipContext,
  source: AssignmentRecipientSource,
): Promise<ReconcileAssignmentRecipientsResult> {
  const [activeEnrolledStudentIds, existingRecipientStudentIds] =
    await Promise.all([
      loadActiveEnrolledStudentIds(context.classId, context.schoolId),
      loadExistingRecipientStudentIds(context),
    ]);

  const missing = Array.from(activeEnrolledStudentIds).filter(
    (studentId) => !existingRecipientStudentIds.has(studentId),
  );

  // Concurrency note (unchanged from the pre-extraction implementation):
  // each `ensureAssignmentRecipient` call independently re-checks existence
  // immediately before writing (Slice 1's own idempotency guarantee), so a
  // concurrent reconcile (or a concurrent `assignmentsRecipientAdd`) racing
  // on the same student can never result in two documents at the same
  // (assignmentId, studentId) path - the recipient document id is
  // deterministic, so "duplicate" is structurally impossible regardless of
  // timing. `added` below counts only the students THIS invocation's own
  // calls actually created; a student found already-missing in this call's
  // initial snapshot but created by a concurrent caller a moment before
  // this call's own write reads back as `added: false` from
  // `ensureAssignmentRecipient` and is correctly folded into
  // `alreadyCurrent`, not double-counted as newly added by both callers.
  const results = await Promise.all(
    missing.map((studentId) =>
      ensureAssignmentRecipient(context, studentId, source),
    ),
  );
  const added = results.filter((r) => r.added).length;
  const alreadyCurrent = activeEnrolledStudentIds.size - added;

  return { added, alreadyCurrent };
}
