# Sprint 12E Slice 1 Completion Report

## Sprint 12E-A Ratification Notice

PDR-029 (Assignment Summary and Recipient Population Policy) now ratifies the two documented interpretations recorded in this report.

- The representative-attempt policy (§10) is ratified as canonical: the highest valid completed attempt per student represents the student in every aggregate assignment score metric, with deterministic tie-breaking by higher `attemptNumber`, then later `completedAt`, then ascending `attemptId`. Raw `score` MUST NOT be used as a tie-breaker across attempts with differing `maxScore`. The direct-query implementation in `assessment-assignment-summary.ts` already produces the ratified representative-attempt semantics.
- The canonical assignment population is now defined as the frozen recipient set captured at first publication in the canonical subcollection `assignments/{assignmentId}/recipients/{studentId}`. The Sprint 12E Slice 1 implementation currently derives the population from the current active enrollment roster, not from the frozen recipient collection. This is a material policy deviation.

Consequences.

- Sprint 12E Slice 1 remains conditionally certified. The implementation must be remediated to read the frozen recipient collection before the slice is fully certified.
- Historical accuracy of the summary is not claimed until remediation lands. The completion-count invariant `completed + inProgress + notStarted === totalStudents` continues to hold on the current active roster and will continue to hold on the frozen recipient set after migration.
- No claim of complete historical accuracy is authorized until the summary callable reads the recipient collection.
- Remediation is expected under Sprint 12E Slice 2 (2A data model and publication writer, 2B session and attempt enforcement, 2C summary migration and recertification of this slice) per PDR-029 and `SPRINT_12E_A_ASSIGNMENT_SUMMARY_POLICY_RATIFICATION.md`.

## 1. Objective

Add a single bounded teacher-facing callable, `assessmentAssignmentSummary`, that returns an aggregate summary of student participation and completed-attempt score metrics for exactly one assignment belonging to a class the authenticated teacher currently owns. The callable is intended to power a future assignment summary card without returning any student-level or attempt-level payload.

## 2. Bounded Scope

- One callable, backend only.
- Aggregate response only. No student, attempt, session, enrollment, item-result, response, or answer-key value crosses the callable boundary.
- No rollups, no persistent cache, no background aggregation, no scheduled function, no schema change, no Firestore Rules change, no dependency change, no configuration change, no index change, no deployment, no commit.

## 3. Callable Added

`assessmentAssignmentSummary` (`platform/functions/src/assessments/assessment-assignment-summary.ts`). Wired into `platform/functions/src/assessments/index.ts` and re-exported from `platform/functions/src/index.ts`.

## 4. Input Contract

```ts
{ assignmentId: string }
```

- `assignmentId` must be a non-empty, trimmed, URL-safe token (letters, digits, hyphens, underscores; first and last character alphanumeric; up to 256 characters). Malformed or missing values are refused with `assignments.invalidAssignmentId`.
- Non-object or array payloads are refused with `assignments.invalidRequest`.
- Every owner-scoping, routing, filter, or aggregation key is refused with `assignments.invalidRequest`. The forbidden set is: `studentId`, `uid`, `userId`, `districtId`, `schoolId`, `classId`, `teacherId`, `assessmentId`, `assessmentRevisionId`, `activityId`, `attemptId`, `sessionId`, `startAt`, `endAt`, `from`, `to`, `groupBy`, `aggregate`, `filter`.
- No date range and no per-record identifier is accepted. The assignment record and the verified caller context determine the entire scope.

## 5. Authorization Chain

1. `requireDistrictContext(request)` enforces authentication, active status, canonical trusted claims, and district agreement per PDR-025 sections 5, 6, and 15.
2. Non-teacher callers are refused with `role-forbidden`.
3. Request shape is validated (section 4).
4. Assignment is loaded via `assignmentDocRef(assignmentId).get()`; a missing or empty record is refused with `assignments.notFound`.
5. Assignment ownership: `assignment.teacherId === caller.uid` AND `assignment.schoolId === caller.schoolId`. Any mismatch is refused with `assignments.forbidden`, so cross-teacher, cross-school, and cross-district requests are all denied with the canonical assignment-boundary identifier.
6. `assignment.classId` must be a non-empty string. A malformed record is refused with `assignments.notFound` so the retrieval layer never surfaces a data-invariant violation.
7. Class is loaded via `classDocRef(assignment.classId).get()`; missing is refused with `classes.notFound`.
8. Class ownership: `class.teacherId === caller.uid` AND `class.schoolId === caller.schoolId`. Any mismatch is refused with `classes.forbidden`. Class ownership fields are immutable per Data Model section 1.2.
9. Defense in depth on frozen ownership fields: `assignment.teacherId === class.teacherId` AND `assignment.schoolId === class.schoolId`. A stored inconsistency is refused with `assignments.notFound`.

Same-district or same-school access alone is insufficient at every step. `classId`, `teacherId`, `districtId`, `schoolId`, and all other owner-scoping keys are structurally impossible on the request, so the caller cannot override scope.

## 6. Assignment Lifecycle Interpretation

All four canonical assignment statuses (`draft`, `published`, `closed`, `archived`) are readable for the owning teacher. The pilot spec (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` section 17) permits `closed` submissions in the grace window and never restricts teacher-side reads of historical assignments. `draft` and `archived` assignments cannot produce sessions or attempts, so their summaries are inherently empty absent historical rows. The lifecycle itself is not a gate on this read; the ownership chain is. Malformed assignment records (missing or empty `classId`, ownership disagreement with the class record) are refused.

## 7. Canonical Student Population

The population is the set of unique `studentId`s from `enrollments` where `classId === assignment.classId`, `schoolId === caller.schoolId`, and `status === "active"`. Duplicate enrollment documents for a single student collapse into one entry.

The certified data model does not currently write a frozen `assignmentRecipients` snapshot at publish, so the current active roster is the only defensible "who is expected to complete this assignment right now" set. This is documented as a material deviation from a future recipient-snapshot model. See section 8.

## 8. Historical Enrollment Interpretation

Documented deviation. A student who completed the assignment and then transferred, withdrew, or was archived is no longer in the current active population and is therefore not counted in `totalStudents` or `completedStudents`. This preserves the invariant `completed + inProgress + notStarted === totalStudents` at the cost of some historical accuracy. A future architecture amendment introducing an `assignmentRecipients` (or equivalent frozen recipient snapshot) collection would close this gap; this slice deliberately does not invent that collection.

## 9. Student Status Classification

Each student in the population is classified exactly once in the deterministic order:

1. `completed` if the student has at least one valid frozen attempt in scope.
2. `inProgress` if the student has no valid completed attempt but has at least one `assessmentSessions` record with `status === "live"` in scope.
3. `notStarted` otherwise.

A student with both a completed attempt and a live session is classified as `completed` (completed wins). Multiple attempts by the same student count the student exactly once. Duplicate enrollments count the student exactly once. `assessmentAttemptsFinalize` deletes the session on successful commit (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` section 21), so a session that co-exists with a completed attempt is a transient race and does not change the classification.

## 10. Multiple-Attempt Selection Policy

Highest completed attempt per student, defined as: among that student's valid frozen attempts for the assignment, the one with the largest `percentage`. Ties are broken by higher `attemptNumber`, then by lexicographically larger `attemptId`. The selection is fully deterministic and does not depend on Firestore document order.

Evidence:

- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` section 20 enumerates the certified teacher-visible metrics with "Highest score" listed first.
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` section 18 defines the pilot's canonical `attemptRollups.bestAttemptId` and `bestScore` fields as the certified interpretation of "best" for teacher-facing surfaces.
- The rollup itself is intentionally not read by this slice; the direct-query summary preserves the same "highest" selection semantics so the future summary card renders the same number the rollup would.

This slice's certification is CONDITIONAL on this interpretation because the certified architecture does not explicitly enumerate a `summary` attempt-selection policy independent of the rollup fields. See section 24.

## 11. Metric Definitions

- `totalStudents`: `population.size`.
- `completedStudents`: unique students with at least one valid frozen attempt.
- `inProgressStudents`: unique students with no valid completed attempt and at least one `status === "live"` session.
- `notStartedStudents`: `totalStudents - completedStudents - inProgressStudents`.
- `completionPercentage`: `roundPercentage(completedStudents / totalStudents * 100)`; `0` when `totalStudents === 0`.
- `averagePercentage`: `roundPercentage(sum(selectedPercentages) / completedStudents)`; `null` when no student is completed.
- `highestPercentage`: `roundPercentage(max(selectedPercentages))`; `null` when no student is completed.
- `lowestPercentage`: `roundPercentage(min(selectedPercentages))`; `null` when no student is completed.
- `perfectScoreStudents`: number of completed students whose selected attempt has `maxScore > 0 && score === maxScore`.

The invariant `completedStudents + inProgressStudents + notStartedStudents === totalStudents` holds on the underlying integer counts, not on the rounded completion percentage.

## 12. Rounding Behavior

`Math.round` half-up rounding on the input, clamped to `[0, 100]`. Non-finite inputs coerce to `0`. Percentages are returned as bounded integers so the client never has to decide how to display a decimal aggregate.

## 13. Numeric Integrity Behavior

- Attempts with non-finite `percentage`, `score`, `maxScore`, or `attemptNumber` are silently dropped from selection (defense-in-depth against a data-invariant violation the retrieval layer must not amplify). If every attempt for a student is malformed, the student is not classified as completed.
- `maxScore === 0` never counts as a perfect score and never causes division by zero.
- The response never contains `NaN` or `Infinity`.
- `completionPercentage`, `averagePercentage`, `highestPercentage`, `lowestPercentage` are guaranteed to be either finite integers or (for the three score metrics) `null`.

## 14. Defense-in-Depth Filtering

Every returned attempt, session, and enrollment document is re-checked against the loaded assignment/class ownership fields before it contributes to a metric:

- Attempts: `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, non-empty `studentId`, and `studentId in population`.
- Sessions: `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, `status === "live"`, non-empty `studentId`, and `studentId in population`.
- Enrollments: `classId`, `schoolId`, `status === "active"`, non-empty `studentId`.

Mismatched documents are silently dropped rather than raising an error, matching the Sprint 12D pattern.

## 15. Response Allowlist

```ts
{
  assignmentId: string;
  classId: string;
  totalStudents: number;
  completedStudents: number;
  inProgressStudents: number;
  notStartedStudents: number;
  completionPercentage: number;
  averagePercentage: number | null;
  highestPercentage: number | null;
  lowestPercentage: number | null;
  perfectScoreStudents: number;
}
```

Object keys are enumerated explicitly. No source document is ever spread into the response.

## 16. Confidentiality Exclusions

Explicitly never returned: student ids, student names, student lists, attempt ids, individual scores, individual responses, item results, correct answers, explanations, answer-key data, assessment revision internals (`assessmentId`, `assessmentRevisionId`, `activityId`), `teacherId`, `districtId`, `schoolId`, enrollment records, session records, attempt records, audit metadata, deployment metadata, idempotency keys, or any unknown persisted field. Test coverage asserts absence for the full list.

## 17. Query and Scalability Characteristics

Three single-field equality queries executed in parallel:

- `attempts.where("assignmentId", "==", assignmentId)`
- `assessmentSessions.where("assignmentId", "==", assignmentId)`
- `enrollments.where("classId", "==", classId)`

All three use Firestore's auto-created single-field indexes. No composite index is introduced; `firestore.indexes.json` is unchanged.

The direct-query approach is bounded and suitable for the current pilot class sizes (tens of students per assignment). It is not the certified long-term shape: `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` sections 18 and 20 specify `attemptRollups` and `assignmentRollups` as the certified teacher-summary path. This slice implements the direct-query interim explicitly and does not claim it as permanent. See "Remaining work" in section 26.

## 18. Audit Behavior

No audit event is written. Retrieval reads remain unaudited, matching Sprint 12C, Sprint 12D Slice 1, and Sprint 12D Slice 3. A single observability `log.info` line is emitted with actor, assignment, class, and aggregate counts.

## 19. Files Reviewed

- `docs/platform/PLATFORM_DECISIONS.md`
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/ASSESSMENT_SCORING_CONTRACT.md`
- `docs/platform/SPRINT_12A_ASSESSMENT_DATA_ACCESS_REVIEW.md`
- `docs/platform/SPRINT_12B_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12C_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12D_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12D_SLICE_2_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12D_SLICE_3_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assessments/*`
- `platform/functions/src/assignments/*` (patterns for `assignmentDocRef`, error identifiers)
- `platform/functions/src/enrollments/resolve-roster-display-name.ts` (reference only; not used by this callable)
- `platform/functions/src/shared/*` (typed refs, types, errors, `requireDistrictContext`, callable wrapper)

## 20. Files Created

- `platform/functions/src/assessments/assessment-assignment-summary.ts`
- `platform/functions/src/assessments/assessment-assignment-summary.test.ts`
- `docs/platform/SPRINT_12E_SLICE_1_COMPLETION_REPORT.md`

## 21. Files Modified

- `platform/functions/src/assessments/index.ts` (added the new callable, projection helper, and its types to the domain re-export list).
- `platform/functions/src/index.ts` (added the callable to the platform-level re-export list).
- `docs/platform/SPRINT_HISTORY.md` (appended the Sprint 12E Slice 1 entry).

No Firestore Rules, schema, application-code, dependency, index, or configuration file was modified.

## 22. Tests Added

`platform/functions/src/assessments/assessment-assignment-summary.test.ts` (83 tests). Coverage:

- Positive summary: empty class, all not-started, one in-progress, one completed, mixed population, multiple attempts by one student, completed-with-live-session precedence, closed/archived/draft assignment summaries.
- Metrics: count invariant, completion percentage correctness (including 0/N), null score metrics when no completions, average/highest/lowest correctness, perfect-score via raw score/maxScore, multiple perfect scores, deterministic rounding.
- Authentication and role: unauthenticated, student, `platformAdministrator`, inactive teacher, malformed claim.
- Input validation: null/array body, missing/blank/non-string/malformed `assignmentId`, and each of the 17 forbidden request keys.
- Assignment and class authorization: nonexistent assignment, missing class reference, missing referenced class, cross-teacher and cross-school assignment ownership, cross-district context, matching-district-only and matching-school-only insufficiency, class ownership mismatch, assignment-vs-class ownership disagreement, forged assignment id.
- Population integrity: cross-assignment / cross-class / cross-district / cross-school attempt exclusion, out-of-population student attempt exclusion, cross-scope session exclusion, non-live session exclusion, out-of-population session exclusion, duplicate enrollment de-duplication, non-active enrollment exclusion, cross-class and cross-school enrollment exclusion, malformed attempt rows dropped without corrupting metrics.
- Numeric integrity: zero-max-score handled without division error, no `NaN`/`Infinity` in response.
- Confidentiality: exactly the approved projection keys are present; a large forbidden-key list is asserted absent.
- Query scoping: `assignmentDocRef(assignmentId)`, `classDocRef(assignment.classId)`, and the three collection refs are all called.
- Direct helper: `selectHighestCompletedAttempt` tie-breaking and malformed-input behavior.

## 23. Targeted Validation

`npx jest --testPathPattern="assessment-assignment-summary"` -> 1 suite, 83 tests, all pass.

## 24. Full Validation

- `npx jest` (full Cloud Functions suite) -> 36 suites, 770 tests, all pass.
- `npm run lint` -> clean.
- `npm run typecheck` -> clean.
- `npm run build` -> clean.
- No Firestore Rules files changed.
- No application HTML/CSS/JS files changed.
- No schema, configuration, dependency, or index files changed.
- No em dashes appear in any created or modified documentation (spaced hyphen `-` used throughout per project style).
- All referenced repository paths exist.

## 25. Findings or Deviations

### Important - documented (not a blocker)

- **No frozen assignment recipient snapshot exists.** The population is derived from the current active enrollment roster, so a student who completed the assignment and then transferred or withdrew disappears from the summary. This is faithful to the current data model and preserves the count invariant. A future architecture amendment introducing an `assignmentRecipients` (or equivalent) collection is required to give the summary full historical accuracy. This slice deliberately does not invent that collection.
- **No certified summary-specific attempt-selection policy exists.** The "highest completed attempt" policy is inferred from `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` sections 18 and 20 (which put "Highest score" first among the teacher-visible metrics and define `bestScore` / `bestAttemptId` as the pilot canonical). This slice adopts that interpretation for the summary. Ratification of an explicit summary policy is recommended.
- **The direct-query implementation is interim.** The certified long-term shape uses `assignmentRollups` and `attemptRollups`. This slice is scoped to a bounded direct-query implementation suitable for pilot class sizes and is explicit that the rollup migration is a separate future slice.

### Minor

- The `districtId` denormalization on `attempts` and `assessmentSessions` (per `AssessmentAttemptRecord` and `AssessmentSessionRecord`) is used for defense-in-depth filtering because the class record itself does not carry `districtId`. Authorization on the class boundary is already achieved by matching the caller's district-verified `schoolId`.

No Critical finding remains open.

## 26. Remaining Summary and Workspace Work

- Migrate the summary path to read from `assignmentRollups` and `attemptRollups` once those collections and their maintenance function are implemented (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` sections 18 and 20).
- Introduce a frozen assignment-recipient snapshot to give the summary full historical accuracy (see section 8).
- Ratify the summary-specific attempt-selection policy in a PDR or architecture amendment (see section 10).
- Follow-on teacher-facing slices (out of scope here): assignment attempt list, roster progress list, and the teacher assignment summary UI.

## 27. Certification Statement

CONDITIONALLY CERTIFIED: Sprint 12E Slice 1 requires the listed remediation.

The conditional certification reflects two documented interpretations that remain to be explicitly ratified: (a) the "highest completed attempt" attempt-selection policy for teacher summaries and (b) the "current active roster" canonical population absent a frozen recipient snapshot. Both interpretations are traceable to the certified contracts and produce a safe, bounded, aggregate-only response with correct district, school, class, and assignment isolation. The implementation itself is complete, tested, lint- and typecheck- and build-clean.
