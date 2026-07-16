# Sprint 12C Slice 1: Assessment Retrieval APIs

**Date:** 2026-07-16
**Category:** Cloud Functions (retrieval layer, no schema, no Rules, no deployment)
**Certification:** CERTIFIED: Sprint 12C Slice 1 is complete.

## 1. Objective

Begin the authenticated-student retrieval layer for the certified assessment pipeline by adding two bounded callables that consume the certified data model directly. This sprint does not redesign, extend, or weaken any certified backend behavior. It surfaces attempt history and single-attempt detail to the student who owns those records and to no other caller.

## 2. Scope

In scope:

- Two Cloud Functions callables that return an authenticated student's own completed attempt records.
- Focused unit tests for the new callables.
- Documentation for the new slice.

Out of scope (explicitly not implemented):

- Teacher retrieval, class retrieval, assignment retrieval, submission progress.
- Rollups, aggregation, analytics, pagination, dashboard APIs.
- My Results UI, Teacher Workspace UI, Student UI.
- Firestore Rules changes.
- Cloud Function redesign, schema changes, field renaming, answer-reveal logic, scoring changes.
- Application integration.

## 3. Functions added

Two callables, both exported from `platform/functions/src/index.ts` and both wrapped by the shared `platformCallable` translator so canonical platform error identifiers surface on the wire.

1. `assessmentAttemptsList`
   - Returns the authenticated student's completed attempts, newest first.
   - Empty request payload. The callable never accepts a student identifier or any district-scoping input; identity is derived entirely from `requireDistrictContext(request)`.
   - Response type: `{ attempts: readonly AssessmentAttemptSummary[] }`.

2. `assessmentAttemptGet`
   - Returns a single completed attempt owned by the authenticated student.
   - Request payload: `{ attemptId: string }` where `attemptId` matches the shared URL-safe token pattern used by the assessment pipeline.
   - Response type: `{ attempt: AssessmentAttemptSummary }`.

## 4. Files created

- `platform/functions/src/assessments/assessment-attempts-list.ts`
- `platform/functions/src/assessments/assessment-attempts-list.test.ts`
- `platform/functions/src/assessments/assessment-attempt-get.ts`
- `platform/functions/src/assessments/assessment-attempt-get.test.ts`
- `docs/platform/SPRINT_12C_COMPLETION_REPORT.md`

## 5. Files modified

- `platform/functions/src/assessments/index.ts` (re-exports for the two new callables and the shared summary projection).
- `platform/functions/src/index.ts` (re-exports the two new callables from the platform function surface).
- `docs/platform/SPRINT_HISTORY.md` (appended Sprint 12C entry).

No changes to certified backend behavior, Firestore Rules, indexes, schema, callable options, dependency graph, or configuration.

## 6. Authorization model

Every retrieval callable enforces the following, in order, before any project or return step runs:

1. `requireDistrictContext(request)` (the certified Sprint 11A helper) gates authentication, active user status, canonical claims, and the district agreement between the caller's user record, the resolved school district, and the caller's signed token claim (PDR-025 §5-§6, §15).
2. The caller's role MUST equal `student`. A non-student caller is refused with `role-forbidden`.
3. For `assessmentAttemptGet` only, the request shape is validated: any ownership-scoping key (`studentId`, `uid`, `userId`, `districtId`, `schoolId`, `classId`, `teacherId`) is refused with `assessmentAttempts.invalidRequest`; a missing or malformed `attemptId` is refused with `assessmentAttempts.invalidAttemptId`.
4. `assessmentAttemptGet` verifies that the loaded attempt's frozen `studentId`, `districtId`, and `schoolId` each match the caller's verified identity. Any mismatch is refused with `assessmentAttempts.notOwned`, `district-mismatch`, or `assessmentAttempts.forbidden` respectively.
5. `assessmentAttemptsList` scopes its Firestore query to `attempts.where("studentId", "==", uid)`, then discards (silently, per data-invariant contract) any candidate whose frozen `districtId` or `schoolId` does not match the caller's verified identity. This is defense in depth on top of the studentId equality filter.

Firestore Rules remain authoritative at the storage layer. The callable layer is authoritative at the API layer. Neither layer relies solely on the other.

## 7. Returned fields

The retrieval callables return only the following per-attempt projection:

- `attemptId`
- `assessmentId`
- `assignmentId`
- `assessmentRevisionId`
- `attemptNumber`
- `score`
- `maxScore`
- `percentage`
- `submittedAt` (milliseconds since epoch)
- `status` (constant literal `"completed"`)

The projection is emitted from a single helper (`projectAttemptSummary`) shared by both callables so the approved field set is enforced in exactly one place.

## 8. Hidden fields

None of the following ever cross the retrieval callable boundary. Each is present on the persisted attempt record and is deliberately excluded by the projection:

- `itemResults` (contains `correctOptionId` and `explanation`, which are answer-key material per ASSESSMENT_SCORING_CONTRACT.md §10.4 and are delivered only through the finalize response boundary).
- `responses` (the student's raw session responses).
- `idempotencyKey` (finalize replay internal).
- `teacherId`, `classId`, `activityId` (teacher-only or class-scope metadata).
- `schoolId`, `districtId` (district-security internals).

The projection never spreads the source record, so a future addition to the persisted record shape cannot silently widen the retrieval surface.

## 9. Error handling

Errors follow the repository's canonical translation layer (`platformCallable` + `translateThrown`) so every refusal reaches the client as a Firebase `HttpsError` whose `message` and `details.code` carry the canonical platform identifier.

Identifiers used by this slice:

- `unauthenticated` (from `requireDistrictContext`).
- `account-inactive`, `claim-stale`, `claim-state-mismatch`, `district-unassigned`, `district-mismatch`, `school-district-mismatch` (from `requireDistrictContext`).
- `role-forbidden` (non-student caller).
- `assessmentAttempts.invalidRequest` (malformed payload or forbidden ownership field).
- `assessmentAttempts.invalidAttemptId` (missing or malformed `attemptId`).
- `assessmentAttempts.notFound` (attempt document missing).
- `assessmentAttempts.notOwned` (attempt owned by another student).
- `assessmentAttempts.forbidden` (cross-school access).

No new error identifier is introduced. Every code above is already present in the canonical identifier space or in a codified prefix rule.

## 10. Tests added

Two focused unit-test files with 21 tests total. Both suites mock the shared helpers and the Firestore typed references so no emulator is required.

`assessment-attempts-list.test.ts` (10 tests):

- Returns only the authenticated student's attempts, projected to the approved fields.
- Never surfaces answer-key, scoring-internal, or audit fields.
- Returns an empty array when the student has no attempts.
- Never returns another student's attempts.
- Drops attempts whose frozen `districtId` does not match the caller's verified `districtId`.
- Drops attempts whose frozen `schoolId` does not match the caller's verified `schoolId`.
- Refuses an unauthenticated caller with the canonical district-boundary identifier.
- Refuses a non-student caller with `role-forbidden`.
- Refuses a request that supplies a `studentId` (or any owner-scoping field).
- Scopes the Firestore query to the caller's uid via the `studentId` equality filter.

`assessment-attempt-get.test.ts` (11 tests):

- Returns the caller's own attempt, projected to the approved fields.
- Never surfaces answer-key, scoring-internal, or audit fields.
- Refuses an unauthenticated caller.
- Refuses a non-student caller.
- Refuses when the attempt does not exist.
- Refuses when the attempt belongs to another student.
- Refuses cross-district access with the canonical `district-mismatch` identifier.
- Refuses cross-school access with the canonical `assessmentAttempts.forbidden` identifier.
- Refuses a missing or malformed `attemptId`.
- Refuses a request that supplies any ownership-scoping field.
- Refuses a non-object payload.

## 11. Validation results

All commands were run from `platform/functions`.

- Targeted retrieval tests (`npx jest src/assessments/assessment-attempts-list.test.ts src/assessments/assessment-attempt-get.test.ts`): 2 suites, 21 tests, all pass.
- Full assessments suite (`npx jest src/assessments/`): 6 suites, 142 tests, all pass.
- Full Cloud Functions suite (`npm test`): 32 suites, 568 tests, all pass.
- Lint (`npm run lint`): passes.
- Typecheck (`npm run typecheck`): passes.
- Build (`npm run build`): passes.
- Only the files enumerated in sections 4 and 5 were changed.
- No em dashes appear in any created or modified file.

## 12. Remaining retrieval work

Not attempted in this slice. Each item is a separate future bounded slice:

- Teacher retrieval of a class's attempts.
- Assignment-scoped attempt aggregation for the teacher surface.
- Submission progress and rollup APIs.
- Pagination and cursor semantics on the list callable.
- District-administrator retrieval surfaces.
- App integration (student My Results UI, Teacher Workspace UI).
- Analytics aggregation.

## 13. Certification statement

CERTIFIED: Sprint 12C Slice 1 is complete.

- Both retrieval callables are implemented and exported from the platform function surface.
- Only authenticated students can retrieve their own attempts.
- Cross-student access is impossible: the list callable filters by the caller's uid, and the get callable refuses any attempt whose frozen `studentId` does not equal the caller's uid.
- Cross-district access is impossible: `requireDistrictContext` refuses a mismatched claim, and both callables additionally verify the attempt's frozen `districtId` against the caller's verified `districtId`.
- Answer keys remain confidential: the projection excludes `itemResults` (`correctOptionId`, `explanation`) and `responses`, and does not spread the source record.
- Scoring internals remain confidential: `idempotencyKey`, `activityId`, and every non-approved field are excluded.
- All 21 new tests pass. The full Cloud Functions test suite (568 tests) passes. Lint, typecheck, and build all pass.
- No certified backend behavior changed. No schema, Rules, index, or configuration files were touched. No deployment occurred. No commit was made.
