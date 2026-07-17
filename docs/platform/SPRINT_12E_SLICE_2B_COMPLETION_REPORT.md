# Sprint 12E Slice 2B Completion Report

## 1. Objective

Implement the PDR-029l recipient membership gate on `assessmentSessionsBegin` and `assessmentAttemptsFinalize`. A student MAY begin or finalize an assignment-linked assessment only if a canonical recipient document exists at `assignments/{assignmentId}/recipients/{studentId}` for the authenticated caller. Recipient membership is server-authoritative and fails closed on every anomaly.

## 2. Scope

Sprint 12E Slice 2B is a bounded enforcement slice. It modifies only the two callables named above and the shared recipient helper module that owns the canonical Firestore path. It does not touch autosave, teacher retrieval callables, student retrieval callables, assignment summaries, assignment publication, recipient persistence, Firestore Rules, rollups, the UI, or the LMS integration.

## 3. Recipient Enforcement Policy

The canonical rule enforced by this slice is:

> A student may begin or finalize an assignment-linked assessment only if `assignments/{assignmentId}/recipients/{studentId}` exists, is well-formed, references the same assignment, names the caller as the student, matches the caller's school and district, and has `status === "assigned"`.

No client-supplied ownership value participates. Recipient identity is student-based, not attempt-based. Membership is not inferred from enrollment, attempts, sessions, user profiles, or LMS profile data. The recipient record is the sole authority.

## 4. Session Enforcement

`assessmentSessionsBegin` invokes the canonical helper `isCanonicalRecipient` after the assignment-window and enrollment checks and before any session write. On failure the callable refuses with the new narrow refusal identifier `assessmentSessions.recipientRequired`. No session is created and no audit event is emitted on refusal. The idempotent-replay path for an existing Live session is unchanged in shape because the same helper still runs before the existing-session lookup and a canonical recipient must be present.

## 5. Finalization Enforcement

`assessmentAttemptsFinalize` invokes the same canonical helper inside the same Firestore transaction as the attempt write. The recipient read participates in the transaction's read set so a mid-transaction recipient change refuses the finalize instead of racing a stale snapshot. On failure the callable refuses with `assessmentAttempts.recipientRequired`. No attempt is written, no score is computed to persistence, no session delete occurs, and no audit event is emitted on refusal. Idempotent replay paths (both the session-present idempotency lookup and the session-absent post-commit replay recovered from the deterministic session identifier) return the previously scored attempt payload unchanged and do not re-run the recipient gate; the previously committed attempt is the canonical replay authority and the recipient was validated at first commit.

## 6. Authorization Order

Session begin ordering (unchanged prior steps, new step 6):

1. Authentication and district context (`requireDistrictContext`).
2. Role: `student`.
3. Request payload shape and `assignmentId` validation.
4. Assignment load and same-school + mode + lifecycle + window checks.
5. Active enrollment for the caller in the assignment's frozen class.
6. Recipient membership gate.
7. Existing-session lookup and canonical creation write.

Finalize ordering (unchanged prior steps, new step 8):

1. Authentication and district context.
2. Role: `student`.
3. Request payload shape and forbidden-key screen.
4. Transactional session load and ownership + district + school + `live` status checks.
5. Idempotency lookup and replay short-circuit.
6. Transactional assignment load and finalize-window check (with grace period).
7. Transactional enrollment load and `active` status check.
8. Transactional recipient membership gate.
9. Transactional revision and answer-key loads.
10. Deterministic local scoring and canonical attempt write.

## 7. Error Handling

Two new narrowly scoped refusal identifiers are introduced, both distinguishable from `assignment-not-found`, `assignment-window-closed`, `enrollment-inactive`, authentication and district refusals, and the request-shape refusals:

- `assessmentSessions.recipientRequired` on session begin.
- `assessmentAttempts.recipientRequired` on finalize.

Both are distinct from every prior identifier in the callables' refusal sets. Neither leaks any recipient field beyond the fact of membership.

## 8. Side-Effect Guarantees

On recipient refusal both callables guarantee:

- No session write, no session delete, no attempt write.
- No audit event emission.
- No score, per-item correctness, correct-answer material, or explanation material is computed or returned.
- No mutation of any Firestore document.

## 9. Files Reviewed

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`.
- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` (PDR-025, PDR-026, PDR-027, PDR-028, PDR-029).
- `docs/platform/SPRINT_12E_A_ASSIGNMENT_SUMMARY_POLICY_RATIFICATION.md`.
- `docs/platform/SPRINT_12E_SLICE_2A_COMPLETION_REPORT.md`.
- `docs/platform/SPRINT_HISTORY.md`.
- `platform/functions/src/assessments/assessment-sessions-begin.ts` and its test.
- `platform/functions/src/assessments/assessment-attempts-finalize.ts` and its test.
- `platform/functions/src/assignments/assignment-recipients.ts` and its test.
- `platform/functions/src/assignments/assignments-recipient-add.ts`.
- `platform/functions/src/shared/firestore/typed-ref.ts` (Slice 2A recipient typed refs).
- `platform/functions/src/shared/types/assignment-recipient.ts`.

## 10. Files Modified

- `platform/functions/src/assignments/assignment-recipients.ts` (added `RecipientEnforcementContext`, `RecipientReader`, and `isCanonicalRecipient`).
- `platform/functions/src/assessments/assessment-sessions-begin.ts` (recipient gate wired between enrollment check and session-conflict lookup; new refusal identifier).
- `platform/functions/src/assessments/assessment-sessions-begin.test.ts` (recipient enforcement tests and default mock).
- `platform/functions/src/assessments/assessment-attempts-finalize.ts` (transactional recipient gate wired between enrollment check and revision load; new refusal identifier).
- `platform/functions/src/assessments/assessment-attempts-finalize.test.ts` (recipient enforcement tests, default recipient fixture, transaction stub extended).
- `docs/platform/SPRINT_HISTORY.md` (Sprint 12E Slice 2B entry appended).

## 11. Tests Added

`assessment-sessions-begin.test.ts`:

- Refuses when no recipient document exists.
- Refuses when the recipient document has empty data.
- Refuses when the recipient names a different student.
- Refuses a cross-school recipient.
- Refuses a cross-district recipient.
- Refuses when the recipient references a different assignment.
- Creates a session when a canonical recipient exists.

`assessment-attempts-finalize.test.ts`:

- Refuses finalize when no recipient document exists.
- Refuses finalize when the recipient names a different student.
- Refuses a cross-school recipient.
- Refuses a cross-district recipient.
- Refuses when the recipient references a different assignment.
- Refuses a recipient whose status is not `assigned`.
- Idempotent replay skips the recipient check and returns the existing attempt payload unchanged.

Each refusal test asserts that no attempt is written, no session is deleted, no audit event is emitted, and the canonical recipient typed reference was invoked with the expected `(assignmentId, studentId)` arguments where applicable.

Every prior positive and negative regression test on both callables continues to pass unchanged.

## 12. Targeted Validation

- `npx jest src/assessments/assessment-sessions-begin.test.ts src/assessments/assessment-attempts-finalize.test.ts`: 2 suites, 84 tests, all passed.

## 13. Full Validation

- `npm run typecheck` (Cloud Functions): passed with no errors.
- `npm run lint` (Cloud Functions): passed with no warnings and no errors.
- `npm run build` (Cloud Functions): passed with no errors.
- `npm test` (Cloud Functions): 38 test suites, 830 tests, all passed.
- Firestore Rules test suite: not modified; not re-run under this slice per scope.

## 14. Findings

- No Critical, Important, or Minor findings surfaced during implementation or validation.
- The Slice 2A audit note that recipient records carry `teacherId` and `classId` in addition to the PDR-029h minimum shape is confirmed load-bearing: the enforcement helper can decide membership on the recipient itself without a second read on the assignment or the class record.
- The new refusal identifiers extend the callable-scoped refusal namespace already established by `assessmentSessions.*` and `assessmentAttempts.*` per the certified refusal set convention. No broad authorization framework was introduced.

## 15. Remaining Slice 2C Work

- Migrate `assessmentAssignmentSummary` to read the recipient collection as the canonical population, replacing the current-active-enrollment approximation.
- Extend `selectHighestCompletedAttempt` with the ratified `completedAt` tie-breaker per PDR-029c.
- Recertify Sprint 12E Slice 1 under the new population semantics.
- Add targeted tests for both changes.

## 16. Certification Statement

- Assignment-linked session creation requires a canonical recipient.
- Assignment-linked finalization requires a canonical recipient.
- Non-assignment behavior is unchanged.
- Anonymous behavior is unchanged.
- Recipient lookup is server-authoritative and uses exactly one direct document read per invocation.
- Recipient lookup fails closed on missing, malformed, wrong-student, wrong-assignment, cross-school, cross-district, and non-`assigned` records.
- No unauthorized session can begin.
- No unauthorized attempt can finalize.
- Targeted Cloud Functions tests pass.
- Full Cloud Functions test suite passes.
- Lint passes.
- Typecheck passes.
- Build passes.
- No publication, recipient-persistence, Firestore Rules, summary, UI, LMS, schema, dependency, configuration, or index files were modified.
- No deployment occurred.
- No commit was made.

CERTIFIED: Sprint 12E Slice 2B is complete.
