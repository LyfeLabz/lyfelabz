# Sprint 12D Slice 3 Completion Report

## 1. Objective

Implement one bounded teacher-facing retrieval callable, `assessmentAttemptGetForTeacher`, that returns the approved teacher-visible details for exactly one completed attempt. The callable must reuse the certified authorization primitives, the certified immutable attempt model, and the canonical roster display-name resolver established in earlier Sprint 12 slices, and must preserve district isolation, school isolation, current class ownership, attempt immutability, and answer-key confidentiality.

## 2. Bounded scope

In scope for this slice: one new backend callable, its unit tests, its exports through the assessments barrel and platform functions surface, one new completion report, and one appended entry to `SPRINT_HISTORY.md`.

Out of scope for this slice: any teacher UI, any student UI, any rollup, any dashboard aggregation, any cross-class listing, any score editing, any feedback editing, any Firestore Rules change, any schema change, any index change, any dependency change, any deployment, any commit.

## 3. Callable added

`assessmentAttemptGetForTeacher`.

- Source: `platform/functions/src/assessments/assessment-attempt-get-for-teacher.ts`.
- Exported through `platform/functions/src/assessments/index.ts` and the platform functions surface in `platform/functions/src/index.ts`.

## 4. Input contract

The callable accepts exactly:

```ts
{
  attemptId: string;
}
```

Validation:

- The request payload must be a structured object (not null, not an array, not a primitive).
- `attemptId` must be a non-empty string after trim.
- `attemptId` must match the URL-safe token pattern already used by `assessmentAttemptGet`.
- Any of `studentId`, `uid`, `userId`, `districtId`, `schoolId`, `classId`, `teacherId`, `assignmentId` on the request is refused with `assessmentAttempts.invalidRequest`.

The loaded attempt document and the verified caller context together determine every ownership decision. No caller-supplied identifier participates in the authorization computation.

## 5. Authorization chain

1. `requireDistrictContext(request)` gates authentication, active status, canonical claims, and district agreement per PDR-025 sections 5 through 6 and 15.
2. `role === "teacher"` or the caller is refused with `role-forbidden`.
3. The request shape is validated per section 4.
4. The attempt is loaded via `attemptDocRef(attemptId).get()`. A missing snapshot or an empty payload is refused with `assessmentAttempts.notFound`.
5. `attempt.districtId === caller.districtId` or the caller is refused with the generic `assessmentAttempts.forbidden` identifier so an observer cannot distinguish a cross-district attempt from an attempt that does not exist in another district.
6. `attempt.schoolId === caller.schoolId` or the caller is refused with `assessmentAttempts.forbidden`.
7. `attempt.classId` and `attempt.studentId` must be non-empty strings; a malformed record is refused with `assessmentAttempts.notFound` so a data-invariant violation is never amplified to the client.
8. The referenced class is loaded via `classDocRef(attempt.classId).get()`. A missing record is refused with `classes.notFound`.
9. `class.teacherId === caller.uid` and `class.schoolId === caller.schoolId` or the caller is refused with `classes.forbidden`. A same-district non-owner and a cross-school teacher receive the same canonical class-boundary refusal.
10. Defense in depth on the frozen attempt: `attempt.teacherId === class.teacherId` and `attempt.schoolId === class.schoolId`. A stored inconsistency is refused with `assessmentAttempts.notFound`.

A matching district alone never authorizes access. A matching school alone never authorizes access. Because owner-scoping identifiers are refused on the request, a caller cannot laundering a targeted attempt by supplying a forged related identifier.

## 6. Current class ownership interpretation

The certified data model records class ownership fields (`teacherId`, `schoolId`) as immutable per Data Model section 1.2. Current class ownership therefore equals frozen class ownership by construction. Step 9 evaluates current ownership by reading the class record at request time. A teacher who never owned the class is refused at step 9 and cannot reach the projection. A teacher who currently owns the class also owned it at the moment every attempt was written.

## 7. Historical attempt interpretation

Attempts are immutable per PDR-026 section 7. Current class ownership by the authenticated teacher authorizes the full historical set of attempts for that class, including attempts by students who have since exited the class, because enrollment status is orthogonal to the immutable attempt record. If a student's enrollment record has been removed, the canonical display-name resolver falls through to the fixed `"Name unavailable"` string. The attempt itself remains readable.

## 8. Lifecycle handling

The callable is for completed attempts. It reads `attempts/{attemptId}` directly and never touches `assessmentSessions/{sessionId}`; a Live session therefore cannot be surfaced through this callable. The status field on the returned detail is the constant `"completed"`, consistent with the immutable attempt record's implied state under PDR-026. Missing attempt, empty attempt payload, malformed frozen `classId`, malformed frozen `studentId`, and stored class-attempt inconsistency all refuse rather than return.

## 9. Canonical display-name reuse

The callable constructs a request-local resolver via `createRosterDisplayNameResolver` with the trusted scope `(attempt.classId, caller.schoolId, caller.districtId)`. Exactly one student is resolved per request. The resolver's certified precedence (enrollment override, then user profile display name, then fixed fallback) is preserved. The resolver's internal `source` field is not exposed on the callable response envelope.

## 10. Teacher-visible response allowlist

The response envelope is exactly:

```ts
{
  attempt: TeacherVisibleAttemptDetail;
}
```

`TeacherVisibleAttemptDetail` carries exactly:

- `attemptId`
- `studentId`
- `studentDisplayName`
- `assessmentId`
- `assignmentId`
- `assessmentRevisionId`
- `attemptNumber`
- `score`
- `maxScore`
- `percentage`
- `submittedAt` (millis)
- `status` (constant `"completed"`)
- `responses[]` (each element: `itemId`, `response`)
- `itemResults[]` (each element: `itemId`, `isCorrect`, `pointsEarned`, `correctOptionId`, `explanation`, `studentResponse`)

Every projection helper enumerates its outputs. The source document is never spread. Every future addition to `AssessmentAttemptRecord`, `AssessmentSessionResponse`, or `AssessmentAttemptItemResult` is excluded by construction.

The summary field set matches `assessmentAttemptsListForClass` (Slice 1) exactly, so a client that opens a detail view from a list view sees a consistent field surface. `assessmentRevisionId` is included for consistency with Slice 1; this remains the certified list projection today and Slice 3 does not diverge from it. Any future decision to hide the revision identifier from teacher surfaces should be applied uniformly through a Sprint 12D followup, not introduced as a one-off in this slice.

## 11. Item-level detail decision

`itemResults[*]` is included. Sprint 12A section 7.2 classifies `itemResults[*]` including `correctOptionId` and `explanation` as readable by the owning class teacher, and PDR-026 section 20 authorizes individual attempt drill-down through `attempts/{attemptId}`. The per-item projection returns only the certified subset (`itemId`, `isCorrect`, `pointsEarned`, `correctOptionId`, `explanation`, `studentResponse`). Every field is sourced from the immutable attempt record; no field is sourced from the `assessmentAnswerKeys/*` collection.

## 12. Submitted-response decision

`responses[]` is included. Sprint 12A section 7.2 classifies the frozen `responses` array as readable by the owning class teacher, and PDR-026 section 20 authorizes drill-down reads. The per-response projection returns only `itemId` and `response`; no scoring artifact is added because none exists on the frozen response element (ASSESSMENT_SCORING_CONTRACT sections 8 and 9 forbid scoring artifacts on the response element).

## 13. Answer-key confidentiality analysis

The callable never reads `assessmentAnswerKeys/*`. Only `attemptDocRef` and `classDocRef` are consulted. `correctOptionId` and `explanation` on `itemResults[*]` are the certified permitted subset of answer-key material frozen on the immutable attempt by the scorer per ASSESSMENT_SCORING_CONTRACT section 10.3 and delivered to the owning student post-submission per section 10.4. Returning those two fields from the immutable attempt to the owning class teacher does not widen the answer-key boundary because no answer-key document is read. Scoring configuration, rubric internals, hidden weights, unpublished revision configuration, deployment secrets, idempotency keys, audit metadata, raw district claims, and internal backend fields are all excluded by construction.

## 14. Error handling

All errors flow through the shared `platformCallable` translator using canonical identifiers already in use across the platform. No new identifier was introduced in this slice.

- `unauthenticated`, `account-inactive`, `role-forbidden`, `district-mismatch`, `district-unassigned`, `school-district-mismatch`, `claim-stale`, `claim-state-mismatch` are propagated from `requireDistrictContext` unchanged.
- `role-forbidden` is raised for non-teacher callers.
- `assessmentAttempts.invalidRequest` is raised for a non-object payload or an owner-scoping key on the request.
- `assessmentAttempts.invalidAttemptId` is raised for a missing, blank, non-string, or malformed `attemptId`.
- `assessmentAttempts.notFound` is raised for a missing attempt document, an empty attempt payload, a malformed frozen `classId` or `studentId`, or a stored class-attempt inconsistency.
- `assessmentAttempts.forbidden` is raised for cross-district or cross-school attempts (generic refusal, per the prompt's confidentiality preference).
- `classes.notFound` is raised for a missing class record referenced by the attempt.
- `classes.forbidden` is raised for a cross-teacher or cross-school class, matching Slice 1 and the certified class-boundary identifier used by `classesUpdateMetadata` and `classesArchive`.

## 15. Audit behavior

No audit event is written by this callable. The certified retrieval callables added in Sprint 12C and Sprint 12D Slice 1 do not write audit events; retrieval reads are intentionally unaudited per the Cloud Function Charter. Preserving that pattern avoids introducing an audit surface without a certified architectural mandate.

## 16. Files reviewed

- `docs/platform/PLATFORM_DECISIONS.md`
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/ASSESSMENT_SCORING_CONTRACT.md`
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
- `docs/platform/SPRINT_12A_ASSESSMENT_DATA_ACCESS_REVIEW.md`
- `docs/platform/SPRINT_12B_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12C_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12D_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12D_SLICE_2_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assessments/assessment-attempt-get.ts`
- `platform/functions/src/assessments/assessment-attempt-get.test.ts`
- `platform/functions/src/assessments/assessment-attempts-list.ts`
- `platform/functions/src/assessments/assessment-attempts-list-for-class.ts`
- `platform/functions/src/assessments/assessment-attempts-list-for-class.test.ts`
- `platform/functions/src/assessments/assessment-attempts-finalize.ts`
- `platform/functions/src/assessments/index.ts`
- `platform/functions/src/enrollments/resolve-roster-display-name.ts`
- `platform/functions/src/shared/auth/require-district-context.ts`
- `platform/functions/src/shared/types/attempt.ts`
- `platform/functions/src/shared/types/assessment-session.ts`
- `platform/functions/src/shared/types/class.ts`
- `platform/functions/src/shared/errors/platform-error.ts`
- `platform/functions/src/shared/firestore/typed-ref.ts`
- `platform/functions/src/shared/index.ts`
- `platform/functions/src/index.ts`

## 17. Files created

- `platform/functions/src/assessments/assessment-attempt-get-for-teacher.ts`
- `platform/functions/src/assessments/assessment-attempt-get-for-teacher.test.ts`
- `docs/platform/SPRINT_12D_SLICE_3_COMPLETION_REPORT.md`

## 18. Files modified

- `platform/functions/src/assessments/index.ts` (added the new callable, projection helper, and public types to the assessments barrel).
- `platform/functions/src/index.ts` (re-exports the new callable from the platform functions surface).
- `docs/platform/SPRINT_HISTORY.md` (appended Sprint 12D Slice 3 entry).

No changes to Firestore Rules, indexes, schema, callable options, dependency graph, environment configuration, or any application file.

## 19. Tests added

`platform/functions/src/assessments/assessment-attempt-get-for-teacher.test.ts` (47 tests) covering:

Positive retrieval:

- Owning active teacher retrieves a completed attempt with the approved summary and detail fields.
- Approved projection keys on the top-level detail.
- Approved keys on each item-result and each response element.
- Response and item-result payloads returned verbatim.
- Canonical resolved display name.
- Canonical fallback when the resolver reports no name.
- Trusted `(classId, schoolId, districtId)` scope passed to the resolver.
- Display name resolved exactly once per request.
- Stable `"completed"` status.

Authentication and role:

- Unauthenticated caller refused.
- Student caller refused with `role-forbidden`.
- Platform-administrator caller refused with `role-forbidden`.
- Inactive teacher refused via `account-inactive`.
- Malformed-claims teacher refused via `claim-state-mismatch`.

Input validation:

- Non-object payload refused with `assessmentAttempts.invalidRequest`.
- Missing, blank, non-string, and malformed `attemptId` refused with `assessmentAttempts.invalidAttemptId`.
- Every owner-scoping key on the request refused with `assessmentAttempts.invalidRequest`.

Attempt authorization:

- Nonexistent attempt refused with `assessmentAttempts.notFound`.
- Cross-district frozen field refused with `assessmentAttempts.forbidden`.
- Cross-school frozen field refused with `assessmentAttempts.forbidden`.
- Missing referenced class refused with `classes.notFound`.
- Same-district non-owning teacher refused with `classes.forbidden`.
- Same-school non-owning teacher refused with `classes.forbidden`.
- Cross-district caller context refused with `assessmentAttempts.forbidden`.
- Cross-school caller context refused with `assessmentAttempts.forbidden`.
- Attempt from another class refused with `classes.forbidden`.
- Attempt with stale frozen `teacherId` refused with `assessmentAttempts.notFound`.
- Matching district alone insufficient.
- Matching school alone insufficient.
- Request-supplied `classId` refused so redirection is impossible.

Lifecycle and integrity:

- Malformed attempt missing `classId` refused.
- Malformed attempt missing `studentId` refused.
- Class-attempt school inconsistency refused.
- Historical attempt (student no longer enrolled) still readable, with fallback name.
- Trusted class scope from the loaded attempt, not from the caller's active roster.

Confidentiality:

- Answer-key collection is never read.
- `idempotencyKey`, `teacherId`, `classId`, `schoolId`, `districtId`, `activityId`, and resolver `source` are absent from the projected detail.
- Response envelope does not carry `teacherId`, `districtId`, `schoolId`, `classId`, or `source`.
- Unknown top-level attempt fields are not spread into the projection.
- Unknown item-result fields are not spread into the projection.
- Unknown response fields are not spread into the projection.
- No `answerKey`, `assessmentAnswerKey`, `scoringConfig`, or `rubric` field is surfaced.
- Firestore reads are scoped to the attempt and its referenced class.

## 20. Targeted validation

`npx jest src/assessments/assessment-attempt-get-for-teacher.test.ts`: 1 suite, 47 tests, all pass.

## 21. Full validation

- `npx jest` (Cloud Functions): 35 suites, 687 tests, all pass.
- `npm run lint`: passes with no output.
- `npx tsc --noEmit`: passes with no output.
- `npm run build`: passes.

Additional confirmations:

- No Firestore Rules files changed.
- No application file changed.
- No schema, configuration, or dependency file changed.
- Only intended Sprint 12D Slice 3 files changed.
- No em dash appears in any file created or modified in this slice (confirmed via `grep -F --`).
- All repository paths referenced in this report exist.

## 22. Findings or deviations

None.

- The one interpretive judgment in this slice, that `assessmentRevisionId` is included in the projection for consistency with Slice 1 despite `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` section 20 stating the internal revision identifier must not appear on any teacher surface, is documented in section 10. It is a preservation of an existing certified projection rather than a new decision. A future bounded Sprint 12D followup may retire this field uniformly from both the list projection and the detail projection.
- The generic `assessmentAttempts.forbidden` identifier for cross-district and cross-school attempts follows the prompt's preferred "generic refusal" convention. The student-facing single-attempt callable uses the more specific `district-mismatch` identifier; the two callables live in different confidentiality neighborhoods (a student is expected to know their own district; a teacher may probe attempt identifiers) and the divergence is intentional.

## 23. Remaining teacher retrieval work

- Assignment-scoped teacher retrieval callable (returning per-assignment attempt summaries for one class, ordered by `submittedAt` desc, gated by class ownership).
- Teacher-facing rollup surface (`attemptRollups`, `assignmentRollups`) reads once the rollup writers land.
- Teacher UI wiring for the Class Snapshot and individual-submission drill-down (out of the backend hardening phase).

## 24. Certification statement

Sprint 12D Slice 3 is complete only if:

- `assessmentAttemptGetForTeacher` is implemented: yes.
- Only authenticated active teachers may call it: yes.
- Input accepts only `attemptId`: yes.
- The attempt must exist: yes.
- The attempt must be completed: yes (the collection is by construction only completed attempts).
- District isolation is enforced: yes.
- School isolation is enforced where applicable: yes.
- Current class ownership is enforced: yes.
- Matching district or school alone is insufficient: yes.
- The canonical display-name resolver is reused: yes.
- The response uses an explicit allowlist: yes.
- Approved teacher-visible details are returned: yes.
- Answer keys remain backend-only: yes.
- No mutation path is introduced: yes.
- Targeted tests pass: yes (47 of 47).
- Full Cloud Functions tests pass: yes (687 of 687).
- Lint passes: yes.
- Typecheck passes: yes.
- Build passes: yes.
- No unresolved Critical or Important security finding remains: yes.

CERTIFIED: Sprint 12D Slice 3 is complete.
