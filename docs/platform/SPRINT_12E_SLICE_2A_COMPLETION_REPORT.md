# Sprint 12E Slice 2A Completion Report

## 1. Objective

Implement the canonical assignment-recipient persistence model ratified in PDR-029 and reconciled by the Sprint 12E-A Ratification. This slice introduces the frozen recipient subcollection, wires the initial recipient snapshot into first assignment publication, adds one explicit teacher-mediated late-recipient callable, adds the required audit behavior, adds Firestore Rules for the new subcollection, and delivers targeted and full test coverage for every change.

## 2. Bounded Scope

Sprint 12E Slice 2A is a foundation slice. It does not migrate `assessmentAssignmentSummary`, does not enforce recipient membership at session begin or attempt finalization, does not add rollups, and does not add any teacher or student UI. Those responsibilities remain assigned to Sprint 12E Slice 2B and Sprint 12E Slice 2C per PDR-029 and the Sprint 12E-A ratification.

## 3. PDR-029 Requirements Implemented

- PDR-029h recipient persistence shape.
- PDR-029h recipient field allowlist and confidentiality contract.
- PDR-029i publication behavior for the initial recipient snapshot.
- PDR-029j late-recipient behavior.
- PDR-029l enrollment-lifecycle interaction with recipients.
- PDR-029 append-only recipient invariant.
- Sprint 12E-A Reconciliation Notice on `LYFELABZ_FIRESTORE_DATA_MODEL.md` (subcollection registered in the implementation).
- Sprint 12E-A Reconciliation Notice on `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (`assignmentsPublish` extended with the initial snapshot writer and the new `assignmentsRecipientAdd` callable registered).

## 4. Recipient Path

Canonical path:

```
assignments/{assignmentId}/recipients/{studentId}
```

The recipient document identifier is the canonical `studentId`. The subcollection lives inside the assignment ownership boundary so the existing assignment ownership fields govern access consistency and the new recipient rules block extends the parent match block directly.

## 5. Recipient Document Contract

Every recipient document carries exactly these fields.

- `assignmentId` (string).
- `studentId` (string).
- `classId` (string).
- `teacherId` (string).
- `schoolId` (string).
- `districtId` (string).
- `assignedAt` (Timestamp; server-stamped).
- `assignedBy` (string; uid of the teacher whose action produced the recipient).
- `source` (`"classPublication"` for the initial snapshot; `"manualAddition"` for late recipient additions).
- `status` (`"assigned"`).

Fields intentionally excluded per PDR-029h:

- No display name of any kind.
- No email address.
- No student profile or LMS profile fields.
- No assessment content.
- No answer-key data.
- No enrollment identifier.
- No per-recipient window, mode, or assessment revision override.
- No publication identifier (the LMS mirror pointer remains on the parent assignment).

## 6. Recipient Immutability

Recipient documents are append-only membership records. No callable path updates or deletes an existing recipient record. Retried initial snapshots reuse the deterministic `studentId` document identifier and the batch commit is atomic; the initial snapshot is never partially applied. Retried late-recipient additions detect the existing recipient by direct read and return an idempotent no-op response without a second write and without a second audit event.

## 7. Initial Publication Snapshot Behavior

`assignmentsPublish` now performs one atomic Firestore batch commit that both advances the assignment `status` from `draft` to `published` and creates the initial recipient snapshot. The batch is constructed as:

- One `assignmentPublishDocRef(...).update({ status: "published" })` write.
- One `assignmentRecipientCreationDocRef(...).set(...)` write per unique active enrolled student.

The batch commit is atomic: if it fails, the assignment does not advance to `published` and no recipient documents are created. The audit event is written only after the batch commits successfully; a batch failure therefore leaves neither a lifecycle change nor a recipient snapshot behind, and no audit event is emitted.

Republishing an already-published assignment returns `alreadyPublished: true` with no additional read of enrollments, no batch, and no audit event. Every other current lifecycle state remains rejected with `assignments.invalidTransition`, unchanged from prior behavior.

## 8. First-Publication Detection

First publication is detected server-side from the loaded assignment record's `status` field. A `draft` value triggers the batch that both writes the recipient snapshot and advances the lifecycle field. A `published` value is treated as an already-published no-op with no recipient re-snapshot. Every other value is rejected with `assignments.invalidTransition`. No client-supplied `isFirstPublication` signal is accepted, consistent with the server-authoritative model in the Cloud Function Charter.

## 9. Enrollment Population Rule

The initial snapshot population is derived from the canonical enrollments collection. The population predicate is:

- Enrollment document exists and is non-empty.
- `enrollment.classId` equals the assignment's frozen `classId`.
- `enrollment.schoolId` equals the assignment's frozen `schoolId`.
- `enrollment.status` equals `"active"`.
- `enrollment.studentId` is a non-empty string.
- Duplicate rows sharing a `studentId` collapse into one recipient.

Cross-class, cross-school, and cross-district records are excluded. Malformed rows are silently dropped consistent with the defense-in-depth filtering pattern used by `assessmentAssignmentSummary`. Attempts, sessions, user profiles, LMS profile data, and Google Classroom rosters are never used to derive the population.

## 10. Empty-Class Behavior

Publishing an assignment to a class with zero valid active enrollments succeeds. The assignment status advances to `published`, zero recipient documents are created, and the audit event carries `recipientCount: 0`. Late-joining students are not silently added; explicit `assignmentsRecipientAdd` is required.

## 11. Atomicity and Failure Behavior

The status transition and the recipient snapshot writes commit through one Firestore batch. Firestore batches are atomic by contract. Pilot classes remain far below the admin-SDK 500-write batch limit; the recipient-writer helper is narrow and would need an explicit reconciliation notice before adopting a different atomic strategy for larger populations. A batch commit failure is propagated to the caller; no partial state is left in Firestore and no audit event is emitted.

## 12. Idempotency Behavior

- Retrying `assignmentsPublish` on an already-published assignment is a no-op with respect to both lifecycle and recipients.
- Reopening, closing, archiving, and updating draft metadata never mutate recipient records.
- Retrying `assignmentsRecipientAdd` for a recipient that already exists returns `added: false` without a second write and without a second audit event. The existing recipient's `source`, `assignedAt`, `assignedBy`, and every ownership field remain unchanged.

## 13. Late-Recipient Callable

New callable: `assignmentsRecipientAdd`. The callable is registered in `platform/functions/src/assignments/index.ts` and re-exported at the functions entrypoint alongside the other assignment lifecycle callables.

## 14. Late-Recipient Input Contract

Accepted keys:

- `assignmentId` (non-empty URL-safe string).
- `studentId` (non-empty URL-safe string).

Every other key is refused with `assignments.invalidRequest`. The explicit forbidden list covers `classId`, `teacherId`, `schoolId`, `districtId`, `source`, `status`, `assignedAt`, `assignedBy`, `lmsCourseId`, `lmsCourseworkId`, `lmsPublicationRef`, `windowClosesAt`, `availableAt`, and `mode`. Ownership fields, source, status, and timestamps are all derived server-side.

## 15. Authorization Model

The late-recipient callable enforces the following ordered checks.

1. Caller is authenticated with a district context (`requireDistrictContext`).
2. Caller has the `teacher` role.
3. Request payload is a structured object with the accepted key set only.
4. Assignment exists.
5. Assignment's frozen `teacherId` equals caller uid and frozen `schoolId` equals caller schoolId.
6. Assignment references a non-empty `classId`.
7. Assignment lifecycle is `published`.
8. Class exists.
9. Class's frozen `teacherId` equals caller uid and frozen `schoolId` equals caller schoolId.
10. Assignment and class ownership fields are internally consistent.
11. A canonical enrollment record exists at `enrollments/{classId}__{studentId}` whose ownership fields match the assignment.
12. Enrollment status is `active`.

Same-district or same-school access is insufficient. Caller cannot override source, status, timestamps, or any ownership field through input.

## 16. Assignment Lifecycle Behavior

- `draft`: refused with `assignments.invalidTransition`. No frozen recipient population exists yet.
- `published`: permitted. Recipient added under `source: "manualAddition"`.
- `closed`: refused with `assignments.invalidTransition` consistent with the PDR-029 archived-and-closed protection.
- `archived`: refused with `assignments.invalidTransition`.

## 17. Enrollment Requirement

Late recipient addition requires an active enrollment for the same student in the assignment's frozen class and school. Every non-active enrollment status (`transferred`, `withdrawn`, `archived`) is refused with `assignments.recipientEnrollmentInactive`. Missing, malformed, or cross-class or cross-school enrollment records are refused with `assignments.recipientEnrollmentMissing`.

## 18. Audit Behavior

Two audit surfaces are affected.

- `assignments.published`: preserved as the existing lifecycle event and additively carries `recipientCount` on its payload. No per-recipient audit event is emitted during the initial snapshot because PDR-029 assigns snapshot ownership to publication.
- `assignments.recipientAdded`: new canonical audit event added to the `AuditAction` vocabulary. Emitted only when a manual late-recipient write actually created a new recipient document. The payload carries `assignmentId`, `studentId`, `classId`, and `source: "manualAddition"`. `schoolId` and `districtId` are carried at the audit-event top level as usual. No display name, email, response, or assessment content is ever included.

## 19. Firestore Rules Behavior

Rules block added at:

```
match /assignments/{assignmentId}/recipients/{studentId} {
  allow read: if false;
  allow create, update, delete: if false;
}
```

Direct client reads (get and list) are denied. Direct client writes (create, update, delete) are denied and denied explicitly rather than through the terminal deny alone to document the append-only invariant at the surface. `assignmentsPublish` and `assignmentsRecipientAdd` are the sole writers and both run through the Admin SDK from the Cloud Function trust boundary and therefore bypass Rules.

## 20. Confidentiality

Recipient records carry no display name, no email, no user profile fields, no LMS profile fields, no assessment content, and no answer-key fields. The callable response is a narrow allowlist of `{ assignmentId, studentId, added }`. The audit event carries no display name and no email.

## 21. Files Reviewed

- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` (PDR-029).
- `docs/platform/SPRINT_12E_A_ASSIGNMENT_SUMMARY_POLICY_RATIFICATION.md`.
- `docs/platform/SPRINT_12E_SLICE_1_COMPLETION_REPORT.md`.
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`.
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md`.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`.
- `docs/platform/SPRINT_HISTORY.md`.
- `platform/functions/src/assignments/` (every existing lifecycle callable).
- `platform/functions/src/assessments/assessment-assignment-summary.ts`.
- `platform/functions/src/enrollments/enrollments-join-by-code.ts` and `enrollments-teacher-add.ts`.
- `platform/functions/src/shared/types/*.ts`.
- `platform/functions/src/shared/firestore/*.ts`.
- `platform/functions/src/shared/audit/write-audit-event.ts`.
- `platform/firebase/firestore.rules`.
- `platform/firebase/tests/assignments.rules.test.ts` and `setup.ts`.

## 22. Files Created

- `platform/functions/src/shared/types/assignment-recipient.ts`.
- `platform/functions/src/shared/firestore/batch.ts`.
- `platform/functions/src/assignments/assignment-recipients.ts`.
- `platform/functions/src/assignments/assignment-recipients.test.ts`.
- `platform/functions/src/assignments/assignments-recipient-add.ts`.
- `platform/functions/src/assignments/assignments-recipient-add.test.ts`.
- `platform/firebase/tests/assignment-recipients.rules.test.ts`.
- `docs/platform/SPRINT_12E_SLICE_2A_COMPLETION_REPORT.md` (this report).

## 23. Files Modified

- `platform/functions/src/shared/types/audit-event.ts` (new `assignments.recipientAdded` action added to the canonical `AuditAction` vocabulary).
- `platform/functions/src/shared/firestore/typed-ref.ts` (recipient collection reference, read reference, and creation-write reference added; import block extended).
- `platform/functions/src/shared/index.ts` (recipient types, recipient typed refs, and the batch helper re-exported).
- `platform/functions/src/assignments/assignments-publish.ts` (initial recipient snapshot integrated into an atomic batch commit; recipient count added to the audit payload).
- `platform/functions/src/assignments/assignments-publish.test.ts` (existing tests preserved; new snapshot, empty-class, deduplication, cross-class, cross-school, malformed-row, and batch-failure tests added).
- `platform/functions/src/assignments/index.ts` (new `assignmentsRecipientAdd` callable exported).
- `platform/functions/src/index.ts` (new `assignmentsRecipientAdd` callable exported at the functions entrypoint).
- `platform/firebase/firestore.rules` (new recipients subcollection rules block; existing assignment rules preserved).
- `docs/platform/SPRINT_HISTORY.md` (Sprint 12E Slice 2A entry appended).

## 24. Tests Added

Cloud Functions test additions.

- `assignment-recipients.test.ts` covers the recipient write builder (both source values) and the initial-population loader across active, duplicate, non-active, cross-class, cross-school, and malformed inputs.
- `assignments-publish.test.ts` extended with first-publication snapshot behavior, empty-class publication, enrollment deduplication, exclusion of non-active and cross-class and cross-school and malformed enrollments, batch-failure propagation, and side-effect ordering. Every prior authorization regression and idempotency test is preserved.
- `assignments-recipient-add.test.ts` covers the positive path, the idempotent no-op path, unauthenticated and student and platformAdministrator and account-inactive callers, invalid and forbidden input fields, missing and cross-owner assignments, draft and closed and archived lifecycle rejections, missing and cross-class and cross-school class records, and the enrollment requirement across missing, cross-class, cross-school, transferred, withdrawn, and archived enrollment states.

Firestore Rules test additions.

- `assignment-recipients.rules.test.ts` proves anonymous, student-self, cross-student, teacher-self, and cross-district reads are denied; that the recipients subcollection cannot be listed; and that create, update, and delete are denied for teacher, student, and unauthenticated callers.

## 25. Targeted Validation

- `npx jest src/assignments/` (Cloud Functions): 122 targeted tests passed across every assignment file including the two new files.
- `npm run test:rules` executed the recipients Rules test as part of the full Rules suite (see section 26).

## 26. Full Validation

- `npm run typecheck` (Cloud Functions): passed with no errors.
- `npm test` (Cloud Functions): 38 test suites, 816 tests, all passed.
- `npm run lint` (Cloud Functions): passed with no warnings and no errors.
- `npm run build` (Cloud Functions): passed with no errors.
- `npm run test:rules` (Firestore Rules under the firestore emulator): 15 test suites, 187 tests, all passed.

## 27. Findings or Deviations

- Recipient records intentionally carry `teacherId` in addition to `classId`, `schoolId`, and `districtId`. PDR-029h treats `teacherId` as optional because a recipient read can join through the assignment. `teacherId` is included here to keep the confidentiality-safe ownership snapshot self-contained on the recipient document so the future recipient-membership gates in `assessmentSessionsBegin` and `assessmentAttemptsFinalize` can decide authorization on the recipient itself without a second read. This is a superset of the PDR-029h minimum shape and does not weaken any confidentiality invariant; no display name, email, or profile field is added.
- PDR-029h enumerates `lmsImport` in the `source` union. Sprint 12E Slice 2A does not accept it because no writer stamps it; adding it to the accepted union without a writer would create a value no callable can produce. It is reserved for a future slice that authorizes an LMS-side recipient writer with its own audit event.
- The `assignments.published` audit payload additively carries `recipientCount`. This is a Sprint 12E-A additive field, permitted by the `AuditPayload` shape (Data Model §3.8), and consistent with the ratification note that permits documenting recipient count on the existing publication audit event.

## 28. Remaining Slice 2B Work

- Extend `assessmentSessionsBegin` to refuse a session for any student not present at `assignments/{assignmentId}/recipients/{studentId}`.
- Extend `assessmentAttemptsFinalize` to refuse an attempt whose `(studentId, assignmentId)` does not resolve to a recipient record.
- Add targeted tests covering both gates.
- Confirm no regression in the existing retrieval callables.

## 29. Remaining Slice 2C Work

- Migrate `assessmentAssignmentSummary` to read the recipient collection as the canonical population, replacing the current-active-enrollment approximation.
- Extend `selectHighestCompletedAttempt` to add the ratified `completedAt` tie-breaker per PDR-029c.
- Add targeted tests.
- Recertify Sprint 12E Slice 1 under the new population semantics.

## 30. Certification Statement

- Sprint 12E Slice 2A canonical recipient path exists.
- Recipient document identifiers equal `studentId` by construction.
- Initial publication creates the frozen recipient snapshot atomically with the status transition.
- Retries are idempotent for both callables.
- Republishing does not rebuild the recipient population.
- Roster changes do not alter existing recipients.
- Empty-class publication is handled explicitly.
- Late recipient addition is explicit and requires an active class enrollment for the same student.
- Late recipient addition verifies assignment and class ownership consistency.
- Existing recipients are never overwritten.
- Manual additions emit exactly one canonical `assignments.recipientAdded` audit event.
- No-op additions emit no duplicate audit event.
- Direct client writes are denied by the recipients Rules block.
- Direct client reads are denied by the recipients Rules block.
- Recipient records contain no display names or profile data.
- District and school isolation remain enforced through the frozen ownership snapshot and the district-context authorization.
- Targeted Cloud Functions tests pass.
- Full Cloud Functions test suite passes.
- Full Firestore Rules test suite passes.
- Typecheck passes.
- Lint passes.
- Build passes.
- No unresolved Critical or Important security finding remains.
- No unrelated file was modified.
- No deployment occurred.
- No commit was made.

CERTIFIED: Sprint 12E Slice 2A is complete.
