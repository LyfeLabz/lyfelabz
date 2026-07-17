# Sprint 12E Slice 2C Completion Report: Summary Migration and Recertification

**Dates:** 2026-07-17
**Status:** Complete

## 1. Objective

Migrate the teacher-facing `assessmentAssignmentSummary` callable from the temporary current-active-enrollment population authority to the canonical frozen assignment-recipient population at `assignments/{assignmentId}/recipients/{studentId}` ratified by PDR-029 and persisted by Sprint 12E Slice 2A. Implement the PDR-029 section 6 representative-attempt tie-break policy in full, including the ratified `completedAt` tie-breaker. Preserve the certified aggregate-only response contract, add historical roster stability tests, and recertify Sprint 12E Slice 1 as fully complete.

## 2. Bounded Scope

- Modified only the summary callable, its unit tests, the Sprint 12E Slice 1 completion report, `SPRINT_HISTORY.md`, and this new completion report.
- Did not modify assignment publication, recipient creation, the late-recipient callable, session begin, attempt finalize, autosave, Firestore Rules, index configuration, schema shapes, enrollment behavior, UI, LMS wiring, or dependencies.
- Did not deploy. Did not commit.

## 3. PDR-029 Remediation Completed

- The Slice 1 Important item "no frozen assignment recipient snapshot exists" is resolved. The recipient snapshot ratified in PDR-029 section 8, persisted under Sprint 12E Slice 2A, and enforced on session begin and finalize under Sprint 12E Slice 2B is now the sole source of truth for the summary population.
- The Slice 1 Important item "no certified summary-specific attempt-selection policy exists" is resolved. `selectHighestCompletedAttempt` now implements the full PDR-029 section 6 canonical order.
- The Slice 1 Important item "current active enrollment is the population" is resolved by construction. The callable no longer touches the `enrollments` collection.

## 4. Canonical Recipient Population

`assessmentAssignmentSummary` reads `assignments/{assignmentId}/recipients` via the canonical `assignmentRecipientsCollectionRef(assignmentId)` typed reference and derives the assignment population from the returned recipient documents alone. The callable no longer queries `enrollments`, `users`, `attempts`, `sessions`, roster display names, or Google Classroom state to establish membership. The Slice 2A publication snapshot and the `assignmentsRecipientAdd` late-add path remain the only two writers.

## 5. Recipient Validation

Each recipient document must satisfy every predicate below before it is admitted to the population set:

- `data.studentId` is a non-empty string.
- The Firestore document identifier equals `data.studentId` (guaranteed by construction under Slice 2A; enforced here as defense in depth).
- `data.assignmentId` equals the requested assignment id.
- `data.classId` equals the loaded assignment's frozen `classId`.
- `data.teacherId` equals the authenticated caller's uid (also equal to the loaded assignment's `teacherId` after the assignment-level ownership check).
- `data.schoolId` equals the authenticated caller's verified `schoolId`.
- `data.districtId` equals the authenticated caller's verified `districtId`.
- `data.status` equals `"assigned"`.

No display name, email, LMS profile field, roster nickname, or user record is consulted.

## 6. Malformed Recipient Policy

Silent drop consistent with the repository's existing defense-in-depth pattern. Documented explicitly:

- A recipient that fails any of the section 5 predicates is dropped from the population set. It never contributes to `totalStudents`, so the count invariant `completed + inProgress + notStarted === totalStudents` cannot be corrupted by a malformed row.
- Ownership drift (wrong classId, schoolId, districtId, teacherId, assignmentId) and status drift (`status !== "assigned"`) are treated as data-invariant violations that the retrieval layer must not amplify to the client. The parent writers (`assignmentsPublish` and `assignmentsRecipientAdd`) are the certified enforcement point for those invariants.
- Duplicate recipient document ids are impossible by construction (the document id is `studentId`); the deduplicating `Set` is a defensive guard, not a correctness dependency.

This policy matches the malformed-row handling already used for enrollments in Slice 1, for attempts in every summary read, and for sessions in every summary read. The stricter alternative (fail the entire request on a single malformed row) was considered and rejected because it would let one legacy row from a paused migration deny an otherwise valid teacher read, and the count invariant already prevents misleading counts.

## 7. Status Classification

Precedence preserved: `completed > inProgress > notStarted`. Each recipient in the canonical population is counted exactly once.

- `completed`: at least one valid frozen attempt exists for the recipient student, assignment, class, teacher, school, and district. Selected via the PDR-029 tie-break helper described in section 9.
- `inProgress`: no valid completed attempt exists and at least one valid live session exists for the same scope. Session lifecycle semantics are unchanged; sessions with `status !== "live"` are not counted.
- `notStarted`: no valid completed attempt exists and no valid live session exists.

## 8. Count Invariant

`completedStudents + inProgressStudents + notStartedStudents === totalStudents` is enforced by construction: `notStartedStudents` is computed as `totalStudents - completedStudents - inProgressStudents` after every recipient is classified exactly once. A targeted regression test asserts the invariant on a mixed population.

## 9. Representative-Attempt Policy

`selectHighestCompletedAttempt` implements the PDR-029 section 6 canonical order per representative attempt:

1. Higher `percentage` wins.
2. Higher `attemptNumber` wins.
3. Later `completedAt` wins when both attempts carry comparable timestamps.
4. Ascending `attemptId` wins as the final deterministic fallback.

Raw `score` is never used for comparison because `maxScore` may differ across assessment revisions. Non-finite `percentage`, `score`, `maxScore`, or `attemptNumber` values drop the candidate entirely.

One representative attempt per completed student contributes to `averagePercentage`, `highestPercentage`, `lowestPercentage`, and `perfectScoreStudents`. Multiple attempts by one student contribute exactly one completed count.

## 10. Tie-Breaking Policy

Ratified deterministic order is enumerated in section 9. The behavior is verified by targeted tests:

- Higher percentage wins.
- Higher `attemptNumber` breaks equal-percentage ties.
- Later `completedAt` breaks equal-percentage and equal-attemptNumber ties.
- Ascending `attemptId` wins on total tie.
- Raw score never outranks percentage.
- A lower later attempt never replaces a higher earlier attempt.

## 11. completedAt Handling

The certified on-disk representation of an attempt's completion instant is `AssessmentAttemptRecord.submittedAt`, a Firestore `Timestamp` frozen by `assessmentAttemptsFinalize` via `FieldValue.serverTimestamp()`. PDR-029 names this instant "completedAt"; the code names it `submittedAt`. The helper reads through a small `completedAtMillis` adapter that:

- Returns a finite millisecond number when the Timestamp exposes a `toMillis()` method returning a finite number.
- Returns `null` for `undefined`, `null`, or any object without a numeric `toMillis()`.

A valid `completedAtMillis` outranks a missing one at rule 3, so a well-formed attempt never loses to a malformed peer. Two missing values tie at rule 3 and fall through to rule 4. Session `startedAt` and Firestore document creation time are not substitutes and are not consulted. Rule 3 comparisons therefore never depend on undocumented timestamp fields.

## 12. Historical Roster Stability

The following stability tests pass under the new implementation:

- Student active at publication remains in the summary after enrollment becomes inactive.
- Student remains after enrollment is removed entirely.
- Student remains after transfer to another class.
- Student remains after transfer to another school (recipient still owned by the historical assignment; caller authorization is separate).
- Newly enrolled student without a recipient record is excluded.
- Late recipient added via `manualAddition` is included.
- Current active roster changes do not change `totalStudents`.
- Removed recipient history remains visible in aggregate metrics.
- Recipient population is independent of user-profile existence.
- Missing display name does not affect membership.
- Duplicate recipient documents cannot inflate counts.
- Empty recipient population yields zero students even when the class currently has active enrollments.

## 13. Late-Recipient Behavior

Recipient records written with `source === "manualAddition"` under `assignmentsRecipientAdd` are indistinguishable from `source === "classPublication"` records for summary purposes. Both satisfy the section 5 predicates and both contribute to `totalStudents` from the moment they are written. A targeted test covers the manualAddition inclusion path.

## 14. Non-Recipient Exclusion

Attempts and sessions for students who are not canonical recipients are excluded from the summary metrics even when the record's own ownership fields match the assignment, class, school, and district. This is what makes the summary historically stable under roster churn. Two targeted tests cover the attempt and session paths.

## 15. Direct-Query Pilot Behavior

The callable remains the bounded direct-query pilot implementation authorized by Sprint 12E Slice 1. Reads issued per invocation:

- One `assignmentDocRef(assignmentId).get()`.
- One `classDocRef(assignment.classId).get()`.
- One `assignmentRecipientsCollectionRef(assignmentId).get()` (subcollection read).
- One `attemptsCollectionRef().where("assignmentId", "==", assignmentId).get()` (auto-index equality query).
- One `assessmentSessionsCollectionRef().where("assignmentId", "==", assignmentId).get()` (auto-index equality query).

No composite index is introduced. No pagination is added (the pilot is bounded by classroom-sized populations). The rollup migration path (`assignmentRollups`, `attemptRollups`) remains explicit future work per PDR-029 section 20 and the Assessment Implementation Contract sections 18 and 20.

## 16. Response Confidentiality

The response contract is preserved exactly. Fields returned:

- `assignmentId`, `classId`, `totalStudents`, `completedStudents`, `inProgressStudents`, `notStartedStudents`, `completionPercentage`, `averagePercentage`, `highestPercentage`, `lowestPercentage`, `perfectScoreStudents`.

Fields never returned (asserted by exact-key allowlist tests):

- Student ids, recipient ids, attempt ids, session ids, attempt arrays, session arrays, response payloads, item results, raw scores, per-student percentages, answer-key fields, ownership metadata, display names, or LMS references.

## 17. Numeric Integrity

- Score metrics are computed from representative attempts only.
- `NaN` and `Infinity` are excluded from every aggregate.
- Percentages are clamped to `[0, 100]` and rounded to the nearest integer with half-up rounding.
- `averagePercentage`, `highestPercentage`, and `lowestPercentage` are `null` when no recipient has completed.
- `perfectScoreStudents` counts a representative attempt only when `maxScore > 0` and `score === maxScore`, so a stale `percentage === 100` on an incorrectly finalized record cannot inflate the count.
- `maxScore === 0` never creates a false perfect score.
- Invalid attempts drop out of selection and cannot corrupt aggregates.

## 18. Files Reviewed

- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md`
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/SPRINT_12E_A_ASSIGNMENT_SUMMARY_POLICY_RATIFICATION.md`
- `docs/platform/SPRINT_12E_SLICE_1_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12E_SLICE_2A_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12E_SLICE_2B_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assessments/assessment-assignment-summary.ts`
- `platform/functions/src/assessments/assessment-assignment-summary.test.ts`
- `platform/functions/src/assignments/assignment-recipients.ts`
- `platform/functions/src/shared/firestore/typed-ref.ts`
- `platform/functions/src/shared/types/assignment-recipient.ts`
- `platform/functions/src/shared/types/attempt.ts`
- `platform/functions/src/shared/index.ts`

## 19. Files Created

- `docs/platform/SPRINT_12E_SLICE_2C_COMPLETION_REPORT.md` (this report).

## 20. Files Modified

- `platform/functions/src/assessments/assessment-assignment-summary.ts` (recipient population migration; `completedAt` tie-breaker; documentation and shape updates).
- `platform/functions/src/assessments/assessment-assignment-summary.test.ts` (recipient seeder, historical stability tests, malformed recipient tests, tie-break tests).
- `docs/platform/SPRINT_12E_SLICE_1_COMPLETION_REPORT.md` (recertification section).
- `docs/platform/SPRINT_HISTORY.md` (Slice 2C entry appended).

## 21. Tests Added

New coverage under `assessment-assignment-summary.test.ts`:

- Empty recipient population with a populated class enrollment set is still zero students.
- Ten historical roster stability scenarios per section 12.
- Eight malformed recipient predicate drops (wrong doc id, wrong assignmentId, wrong classId, wrong teacherId, wrong schoolId, wrong districtId, non-assigned status, blank studentId).
- Multiple live sessions collapse to one in-progress student.
- Malformed session records do not affect classification.
- Invalid maxScore does not produce a false perfect score.
- Late `manualAddition` recipient inclusion.
- Non-recipient attempts and sessions do not affect completion or in-progress counts.
- Assertion that `assignmentRecipientsCollectionRef` is called with the requested `assignmentId`.
- Full PDR-029 tie-break coverage on `selectHighestCompletedAttempt`: percentage, attemptNumber, completedAt, attemptId; raw-score vs percentage; missing/malformed `completedAt`; cross-revision comparability; lower-later never replaces higher-earlier.

The full targeted suite is 114 tests, all passing.

## 22. Targeted Validation

- `npx jest --testPathPattern="assessment-assignment-summary"`: 1 suite, 114 tests, all passed.

Recipient helper tests were reviewed and not modified by this slice (`assignmentRecipientsCollectionRef` and the `isCanonicalRecipient` helper are consumed unchanged). The Slice 2A recipient helper suite continues to pass in the full run.

## 23. Full Validation

- `npm run typecheck` (Cloud Functions): passed.
- `npm run lint` (Cloud Functions): passed with no warnings and no errors.
- `npm run build` (Cloud Functions): passed.
- `npm test` (Cloud Functions): 38 test suites, 861 tests, all passed.
- Firestore Rules test suite: not modified; not re-run under this slice per scope.
- `git diff --stat` confirms only the four intended platform files changed (summary implementation, summary tests, Slice 1 report, this report and Sprint History). Pre-existing modifications to grade 7 lesson HTML files were present in the working tree at slice start and are unrelated to this slice.
- No em dashes in any created or modified documentation (verified with `grep`).
- No Firestore Rules file changed.
- No publication, recipient-add, session-begin, attempt-finalize, autosave, enrollment, UI, LMS, dependency, configuration, schema-implementation, or index file changed.
- No deployment occurred.
- No commit occurred.

## 24. Findings and Deviations

### Important

- **Timestamp field naming asymmetry.** PDR-029 section 6 rule 3 names the completion instant `completedAt`; the certified attempt record persists the same instant as `submittedAt` (frozen by `assessmentAttemptsFinalize`). This slice resolves the asymmetry by adopting `submittedAt` as the sole on-disk representation of `completedAt` and documenting the equivalence in code and in this report. Introducing a second timestamp field on the attempt record was rejected as out of scope and unnecessary. A future editorial pass on PDR-029 may harmonize the naming.

### Minor

- The Slice 2A recipient record carries `teacherId` and `classId` beyond the PDR-029h minimum shape. This slice benefits from that superset: the recipient record can be validated against the caller and the loaded assignment without a second read on any other collection.
- The Slice 1 note that `districtId` is denormalized on `attempts` and `assessmentSessions` for defense-in-depth filtering still applies. The class record itself does not carry `districtId`, so the district check is anchored on the caller's verified context.

No Critical finding.

## 25. Sprint 12E Slice 1 Recertification

Recertified. Every Important remediation item enumerated in the Slice 1 completion report is now resolved:

- Frozen assignment-recipient snapshot exists (Slice 2A) and is the summary population authority (this slice).
- Representative-attempt selection policy is ratified (PDR-029 section 6) and implemented in full, including the ratified `completedAt` tie-breaker (this slice).
- Direct-query pilot implementation remains approved. Rollup migration remains explicit future work.

The Slice 1 completion report has been updated with an explicit "Sprint 12E Slice 2C Recertification" section that preserves the original conditional-certification record and adds the final certification statement.

## 26. Remaining Future Rollup Work

- Migrate the summary path to `assignmentRollups` and `attemptRollups` once those collections and their maintenance function are implemented (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` sections 18 and 20). Rollup adoption must preserve identical semantics for the representative-attempt policy, the tie-break policy, and the frozen recipient population.
- Followup teacher-facing surfaces remain out of scope until the summary UI ships: assignment attempt list, roster progress list, and teacher assignment summary card.

## 27. Certification Statement

- Summary membership comes exclusively from frozen assignment recipients.
- Current roster changes do not change historical membership.
- Late recipients are included via `manualAddition` recipient records.
- Non-recipients are excluded from every summary metric.
- Each recipient is counted exactly once.
- Completed, in-progress, and not-started precedence is preserved.
- Representative-attempt policy matches PDR-029 section 6.
- `completedAt` tie-breaker is implemented.
- Attempt id is only the final fallback.
- Score metrics use representative attempts only.
- Response allowlist remains aggregate-only.
- Historical stability tests pass.
- Targeted tests pass.
- Full Cloud Functions test suite passes.
- Lint passes.
- Typecheck passes.
- Build passes.
- No unresolved Critical or Important finding remains.
- Sprint 12E Slice 1 is fully certified.

CERTIFIED: Sprint 12E Slice 2C is complete.
