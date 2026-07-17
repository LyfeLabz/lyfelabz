# Sprint 12E-A Assignment Summary Policy Ratification

## 1. Objective

Ratify the canonical policies required by `assessmentAssignmentSummary` before its implementation is committed and certified. Two decisions require explicit ratification.

- Which completed attempt represents a student in teacher-facing aggregate assignment metrics.
- Which students belong to the canonical population of an assignment over time.

Sprint 12E-A is documentation only. No Cloud Functions, no Firestore Rules, no application code, no schemas, no indexes, no dependencies, and no configuration are modified. No commit is authorized by this slice.

## 2. Documents Reviewed

- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` (PDR-001 through PDR-028)
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/ASSESSMENT_SCORING_CONTRACT.md`
- `docs/platform/ASSESSMENT_PIPELINE_SPECIFICATION.md`
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
- `docs/platform/PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/SPRINT_12A_ASSESSMENT_DATA_ACCESS_REVIEW.md`
- `docs/platform/SPRINT_12B_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12C_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12D_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12D_SLICE_2_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12D_SLICE_3_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12E_SLICE_1_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`

## 3. Implementation Inspected

- `platform/functions/src/assessments/assessment-assignment-summary.ts` and its test file (Sprint 12E Slice 1 delivery).
- `platform/functions/src/assessments/index.ts` and `platform/functions/src/index.ts` (callable wiring).
- `platform/functions/src/assignments/` (`assignments-create-draft.ts`, `assignments-update-draft.ts`, `assignments-publish.ts`, `assignments-close.ts`, `assignments-archive.ts`, `index.ts`).
- `platform/functions/src/enrollments/` (`enrollments-join-by-code.ts`, `enrollments-set-status.ts`, `enrollments-teacher-add.ts`, `resolve-roster-display-name.ts`, `index.ts`).
- `platform/functions/src/shared/types/assignment.ts` (`AssignmentRecord`, `AssignmentPublishWrite`, `AssignmentCloseWrite`, `AssignmentArchiveWrite`).

Findings from inspection.

- Assignment records carry immutable ownership fields (`classId`, `teacherId`, `schoolId`) frozen at draft creation and preserved through every lifecycle transition.
- Assignment publication (`assignmentsPublish`) advances `status` from `draft` to `published` without touching any other field. Publication is idempotent under the `alreadyPublished` return field. No recipient snapshot is written today.
- No `assignmentRecipients` collection, subcollection, or embedded field exists anywhere in the code base.
- `assessmentAssignmentSummary` derives the population from `enrollments where classId == assignment.classId AND schoolId == caller.schoolId AND status == "active"`. It is therefore a current-active-roster read, not a frozen-population read.
- Every completed attempt for the assignment is loaded and reduced per student to the highest-percentage attempt via `selectHighestCompletedAttempt`, with ties broken by higher `attemptNumber`, then by ascending `attemptId`. Later `completedAt` is not currently used as a tie-breaker; the code will need a narrow extension when the recipient migration lands.
- All attempts, sessions, and enrollments are defense-in-depth filtered against the loaded assignment and class ownership fields; malformed rows are silently dropped.

## 4. Decisions Requiring Ratification

- Representative attempt for aggregate assignment summary metrics.
- Deterministic tie-breaking across representative-attempt candidates.
- Canonical assignment population over time.
- Persistence shape for the frozen recipient population.
- Publication behavior with respect to recipients.
- Late-recipient behavior.
- Removed-student behavior.
- Assignment lifecycle interaction with recipients.
- Enrollment lifecycle interaction with recipients.
- Session and attempt enforcement implications.
- Pilot direct-query summary policy.
- Future rollup policy.

## 5. Representative-Attempt Decision

Ratified: the representative attempt for each student in every aggregate assignment score metric is the student's highest valid completed attempt for that assignment. All completed attempts remain preserved. Individual attempt drill-down (via `assessmentAttemptsGetForStudent` and `assessmentAttemptsGetForTeacher`) continues to expose the full attempt history. Additional attempts MUST NOT inflate the number of completed students. A later lower attempt MUST NOT reduce the student's aggregate representation. An improved attempt MUST update the summary representation.

Rationale.

- "Highest score" is the first teacher-visible metric enumerated in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §20. The pilot rollup fields `bestScore` and `bestAttemptId` (§18) already define the canonical "best" attempt.
- Highest-attempt aligns with the LyfeLabz product principles "Celebrate Improvement" and "Preserve Learning Across Years." Latest-attempt would penalize an improvement pass and is rejected. First-attempt would hide growth and is rejected.
- Attempt history remains available. Aggregate metrics use one representative attempt per student; the individual attempt view is not affected by this rule.
- Attempts with non-finite `percentage`, `score`, `maxScore`, or `attemptNumber` are dropped from selection. If every attempt for a student is malformed, the student is not classified as completed.
- Cross-revision comparability: `percentage` is the sole cross-revision comparable score field. Raw `score` is not comparable across attempts whose `maxScore` differs and MUST NOT be used for representative-attempt selection or as a summary metric.

## 6. Tie-Breaking Decision

Ratified deterministic order.

1. Higher `percentage` wins.
2. Higher `attemptNumber` wins.
3. Later `completedAt` wins when both attempts carry comparable timestamps.
4. Ascending `attemptId` wins as the final technical fallback.

Raw `score` MUST NOT be used as a tie-breaker. Max-score comparability is not guaranteed across assessment revisions, so raw score comparisons across attempts against different `assessmentRevisionId` values are not safe.

The tie-break policy is a technical determinism rule and MUST NOT be surfaced to teachers or students as an instructional signal.

The current implementation (`selectHighestCompletedAttempt`) matches rules 1, 2, and 4 today. Rule 3 (later `completedAt`) is added under this ratification and will be introduced in the Sprint 12E Slice 2C migration; the change is a narrow, non-breaking extension of the existing helper.

## 7. Assignment-Population Decision

Ratified: every assignment has a frozen recipient population. First publication captures the assignment's recipient set atomically. Roster changes after publication do not silently rewrite the population.

- Students later removed from the class remain in the historical assignment population.
- Students who transfer, withdraw, or are archived do not disappear from historical completion metrics.
- Students who join the class after first publication are not silently added to the assignment.
- Assignment summaries remain stable when the current roster changes.
- Attempts from students outside the recipient population do not affect summary metrics.

The current Sprint 12E Slice 1 implementation reads current active enrollments as the population. This is a bounded pilot approximation and is a material deviation from PDR-029. Remediation is required under Sprint 12E Slice 2C.

## 8. Recipient Persistence Decision

Ratified persistence shape: `assignments/{assignmentId}/recipients/{studentId}`.

- The document identifier is `studentId` so each recipient is unique per assignment by construction.
- The subcollection lives inside the assignment ownership boundary so the existing rules on the parent assignment govern access.
- A top-level `assignmentRecipients` collection is rejected. It fragments assignment ownership across two roots, complicates rules composition, and duplicates the assignment index strategy.
- An embedded recipient array or map on the assignment document is rejected. It risks the Firestore document-size limit at moderate roster sizes, forces every recipient write to contest the assignment document, and breaks field-level append-only immutability.

Minimum required fields per record: `assignmentId`, `studentId`, `classId`, `schoolId`, `districtId`, `assignedAt` (server timestamp), `assignedBy` (uid of the teacher whose action produced the recipient), `source` (one of `classPublication`, `manualAddition`, `lmsImport`), and `status` set to `assigned`.

Fields intentionally NOT included in the minimum shape.

- No denormalized display name (PDR-028h).
- No `teacherId` copy (the parent assignment already owns the canonical teacher-of-record; recipient reads join through the assignment record).
- No `enrollmentId` (the enrollment record and the recipient record are independent; the recipient's authorization is student-based, not enrollment-based, per PDR-029l).
- No `publicationId` (`assignments/{assignmentId}.lmsPublicationRef` already carries the LMS mirror pointer).
- No LMS course id or coursework id (the LMS ownership boundary remains in `lmsAssignmentPublications`).
- No per-recipient window override, per-recipient mode override, or per-recipient assessment revision id.

Additional fields may be added in a superseding sprint under an explicit reconciliation notice.

## 9. Publication Behavior

- The `draft` to `published` transition in `assignmentsPublish` becomes the sole event that creates the canonical recipient population. The recipient snapshot MUST be captured atomically with the status transition.
- Republishing a `published` assignment is a no-op with respect to the recipient population.
- Reopening a `closed` assignment MUST NOT change the recipient population.
- Editing teacher-editable metadata (`title`, `instructions`, `windowClosesAt`, `availableAt`) via `assignmentsUpdateDraft` MUST NOT change the recipient population.
- Duplicating an assignment produces a new `assignmentId` and a new recipient population captured at that new assignment's first publication.
- An archived assignment MUST NOT gain recipients unless a superseding sprint authorizes restoration.
- An LMS resync does not add or remove recipients. Late Classroom-side additions follow section 10.

## 10. Late-Recipient Behavior

A newly enrolled student MUST NOT be silently added to any previously published assignment. When a teacher elects to assign an existing published assignment to a student who joined after publication, a new immutable recipient record is created for that student with `source === "manualAddition"` and `assignedAt` stamped at the moment of the write.

- The teacher receives a prompt when they attempt the manual addition. The exact prompt copy is out of scope for this slice.
- A bulk "assign to newly enrolled students" gesture is prohibited until a superseding sprint authorizes it and defines the ownership check, audit event, and rate limits.
- The recipient inherits the assignment's window and mode. Per-recipient window overrides MUST NOT be introduced without a superseding PDR.
- Google Classroom re-publication for the added recipient follows PDR-027 and is not automatic.
- Adding a recipient changes summary metrics immediately for future attempts (the new student becomes part of the population); historical attempts by other students are not disturbed.

## 11. Removed-Student Behavior

- Removing a student from a class MUST NOT delete recipient records.
- Historical attempts remain readable to the owning teacher and to the student under PDR-025 and PDR-026.
- The removed student remains in the assignment summary.
- The removed student's current platform authorization continues to follow enrollment and archive rules; assignment inclusion is a separate historical fact.
- Assignment history MUST NOT be rewritten by roster changes.

## 12. Assignment Lifecycle Behavior

- Draft: no recipient population exists. Previewing a draft does not create recipients. Changing the class before publication remains allowed only where existing assignment contracts permit it.
- Published: publication atomically creates the recipient population. LMS publication behavior follows PDR-027.
- Closed: recipients remain unchanged. Attempts and summary remain historically readable. New attempts follow the certified closure and grace-period rules in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §17.
- Archived: recipients remain unchanged. Summary remains readable to authorized teachers. New recipients MUST NOT be added.

## 13. Enrollment Lifecycle Behavior

- Active at publication: student is captured in the recipient snapshot.
- Invited but not active at publication: not captured in the initial snapshot. A recipient record may be created later under section 10.
- Removed after publication: recipient record persists; historical summary unchanged.
- Transferred to another class: recipient record persists for the original assignment.
- Transferred to another school or district: recipient record persists; live reads continue to be gated by PDR-025 district enforcement.
- Re-enrolled: no additional recipient record is created; the existing record still applies.
- Joins after publication: not silently added. Handled under section 10.
- Never signed in: recipient record may exist for a resolved roster placeholder only if the placeholder is resolved to an active `users/{uid}` before the recipient write. A placeholder in the `awaitingFirstSignIn` state MUST NOT receive a recipient record.
- Has an enrollment but no user profile: same as above; not eligible for a recipient record.

Assignment inclusion is separate from current platform authorization, current teacher visibility, current student visibility, and canonical display-name resolution. Display-name availability MUST NOT be used to include or exclude a student from a historical assignment summary.

## 14. Sessions and Attempts Implications

- `assessmentSessionsBegin` MUST refuse to create a session for a student who is not a recipient of the target assignment.
- `assessmentSessionsAutosave` and `assessmentSessionsResume` continue to be caller-owned. Recipient enforcement is implicit through the parent session's authorization gate at begin time.
- `assessmentAttemptsFinalize` MUST refuse to persist an attempt whose `(studentId, assignmentId)` does not resolve to a recipient record. This becomes the sole authoritative gate for attempt production.
- Completed attempts remain associated with the frozen assignment recipient. A removed student's historical attempt remains part of the summary.
- Attempts from non-recipients are excluded and treated as integrity violations.
- Recipient invalidation (if authorized in a superseding sprint) MUST NOT erase attempts.
- Multiple attempts by a single student do not create multiple recipient records. Recipient identity is student-based, not attempt-based.
- Existing teacher and student retrieval callables (`assessmentAttemptsGetForTeacher`, `assessmentAttemptsGetForStudent`, `assessmentAssignmentSummary`, and future teacher assignment attempt list and roster progress list callables) read the recipient collection as the canonical population.

Concrete callable extension is out of scope for this slice.

## 15. Pilot Direct-Query Decision

Ratified: the direct-query implementation of `assessmentAssignmentSummary` is acceptable for the bounded pilot provided it reads the frozen recipient population once Sprint 12E Slice 2 lands. Direct-query is not the historical-population authority; the recipient collection is.

- Pilot suitability: tens of students per assignment.
- The direct-query path avoids introducing a new document event, a rollup writer, and a rollup schema during the pilot.
- The direct-query path preserves identical semantics to the future rollup path.

## 16. Future Rollup Decision

Ratified: persistent `assignmentRollups` and `attemptRollups` remain the certified long-term shape per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §18 and §20.

- Rollup adoption MUST preserve identical semantics for the representative-attempt policy, the tie-break policy, and the frozen recipient population.
- Rollups MUST NOT redefine any teacher-facing metric.
- Rollups MAY carry additional internal observability fields provided they are never projected onto the teacher UI.
- Rollup adoption is triggered when observed class sizes or query volume exceed the bounded pilot envelope.

## 17. PDR Added

- PDR-029: Assignment Summary and Recipient Population Policy, added to `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md`.

## 18. Documents Modified

- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` (PDR-029 added; Change Log entry appended).
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (Sprint 12E-A Reconciliation Notice added before §1; §17 amended by pointer).
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md` (Sprint 12E-A Reconciliation Notice added enumerating the `assignments/{assignmentId}/recipients/{studentId}` subcollection).
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (Sprint 12E-A Reconciliation Notice added enumerating recipient-writer and recipient-enforcement responsibilities).
- `docs/platform/SPRINT_12E_SLICE_1_COMPLETION_REPORT.md` (Sprint 12E-A Ratification Notice added).
- `docs/platform/SPRINT_HISTORY.md` (Sprint 12E-A entry appended).

## 19. Documents Created

- `docs/platform/SPRINT_12E_A_ASSIGNMENT_SUMMARY_POLICY_RATIFICATION.md` (this report).

## 20. Contradictions Reconciled

- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §17 previously named the assignment as the authorization boundary without stating a frozen recipient population. The new Sprint 12E-A Reconciliation Notice makes the frozen recipient collection the canonical population source.
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §20 previously enumerated "Highest score" among the five teacher-visible metrics without normatively defining a summary-level representative-attempt policy. PDR-029a now ratifies the representative-attempt policy in normative language.
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.6 previously defined the assignment record without a recipient subcollection. The new Sprint 12E-A Reconciliation Notice records the additive subcollection without amending the assignment document shape.
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` previously named `assignmentsPublish` as a lifecycle-only writer. The new Sprint 12E-A Reconciliation Notice extends its responsibility to include the initial recipient snapshot write.
- The Sprint 12E Slice 1 completion report previously left the two ratification items open. The new Sprint 12E-A Ratification Notice states the ratification and preserves the conditional certification.

No other document is amended.

## 21. Remaining Implementation Work

- Sprint 12E Slice 2A: introduce the `assignments/{assignmentId}/recipients/{studentId}` subcollection type, wire `assignmentsPublish` to write the initial snapshot atomically with the status transition, add Firestore Rules for the subcollection, add the manual-addition callable, add tests, and register the `assignments.recipientAdded` audit event.
- Sprint 12E Slice 2B: extend `assessmentSessionsBegin` and `assessmentAttemptsFinalize` to enforce recipient membership, add tests, and confirm no regressions in retrieval callables.
- Sprint 12E Slice 2C: migrate `assessmentAssignmentSummary` to read the recipient collection as the canonical population, extend `selectHighestCompletedAttempt` to add the ratified `completedAt` tie-breaker, add tests, and recertify Sprint 12E Slice 1.
- Long-term: introduce persistent `assignmentRollups` and `attemptRollups` under `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §18 and §20 when class sizes or query volume exceed the pilot envelope. Rollups MUST preserve PDR-029a, PDR-029b, PDR-029c, and PDR-029d verbatim.

## 22. Sprint 12E Slice 1 Certification Status

Sprint 12E Slice 1 remains conditionally certified. The representative-attempt policy is ratified. The current-active-enrollment population is not the canonical long-term policy and the summary callable must be remediated to read the frozen recipient collection under Sprint 12E Slice 2C before Sprint 12E Slice 1 is fully certified. Historical accuracy of the summary is not claimed until remediation lands.

## 23. Validation

- `git status` and `git diff` reviewed. Only documentation files were modified.
- No Cloud Functions files were modified.
- No Firestore Rules files were modified.
- No application (HTML, CSS, JS) files were modified.
- No schema, index, configuration, or dependency files were modified.
- PDR-029 number is unique and sequentially follows PDR-028 in `LYFELABZ_PLATFORM_DECISIONS.md`.
- All reconciliation references use real document names and real section labels.
- All created and modified files were searched for the em-dash character. Zero em dashes present.
- No deployment occurred.
- No commit occurred.

## 24. Certification Statement

CERTIFIED: Sprint 12E-A policy ratification is complete.

Sprint 12E Slice 1 remains CONDITIONALLY CERTIFIED under this ratification and requires the remediation sequence enumerated in section 21.
