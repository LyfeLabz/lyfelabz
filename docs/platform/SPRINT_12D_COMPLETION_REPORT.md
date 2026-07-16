# Sprint 12D Slice 1: Teacher Assessment Retrieval APIs

**Date:** 2026-07-16
**Category:** Cloud Functions (retrieval layer, no schema, no Rules, no deployment)
**Certification:** CERTIFIED: Sprint 12D Slice 1 is complete.

## 1. Objective

Begin the authenticated-teacher retrieval layer for the certified assessment pipeline by adding one bounded callable that consumes the certified data model directly. This sprint does not redesign, extend, or weaken any certified backend behavior. It surfaces the completed attempt summaries for one class to the teacher who currently owns that class, and to no other caller.

## 2. Bounded scope

In scope:

- One Cloud Functions callable that returns completed attempt summaries for exactly one class owned by the authenticated teacher.
- A focused unit-test suite for the new callable.
- Documentation for the new slice.

Out of scope (explicitly not implemented):

- `assessmentAttemptGetForTeacher` and every other retrieval callable.
- Assignment-scoped attempt retrieval and cross-class retrieval.
- Rollups, aggregation, analytics, dashboards, pagination, caching.
- Firestore Rules changes, schema changes, index changes.
- Application integration and every teacher or student UI surface.
- Attempt mutation, feedback editing, score editing, answer-reveal changes.

## 3. Function added

`assessmentAttemptsListForClass`, exported from `platform/functions/src/index.ts` and wrapped by the shared `platformCallable` translator so canonical platform error identifiers surface on the wire.

- Returns the completed attempt summaries for exactly one class owned by the authenticated teacher, newest first.
- Response type: `{ classId: string; attempts: readonly TeacherClassAttemptSummary[] }`.

## 4. Input contract

Accepted request payload:

```
{ classId: string }
```

Validation:

- The payload must be a structured object; `null`, arrays, and non-object values are refused with `assessmentAttempts.invalidRequest`.
- Every owner-scoping key (`studentId`, `uid`, `userId`, `districtId`, `schoolId`, `teacherId`) is refused with `assessmentAttempts.invalidRequest`. No student, teacher, district, or school identifier is ever accepted from the client.
- `classId` must be present, a non-blank string, and match the shared URL-safe class-id token pattern used across the classes surface (`/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/`). A missing, blank, non-string, or malformed value is refused with `classes.invalidClassId`.

## 5. Authorization chain

Enforced in order before any query or projection runs:

1. `requireDistrictContext(request)` (the certified Sprint 11A helper) gates authentication, active user status, canonical claims, and the district agreement between the caller's user record, the resolved school district, and the caller's signed token claim (PDR-025 sections 5-6 and 15).
2. The caller's role MUST equal `teacher`. A student or platform-administrator caller is refused with `role-forbidden`.
3. Request shape is validated per section 4.
4. The class record is loaded via `classDocRef(classId).get()`. A missing document is refused with `classes.notFound`.
5. Class ownership: the record's frozen `teacherId` MUST equal the caller's verified uid AND the record's frozen `schoolId` MUST equal the caller's verified `schoolId`. Any mismatch is refused with `classes.forbidden`.

Firestore Rules remain authoritative at the storage layer. The callable layer is authoritative at the API layer. Neither layer relies solely on the other.

## 6. Class ownership enforcement

Ownership is enforced from the loaded class record only. The callable never trusts a client-supplied `teacherId`, `schoolId`, or `districtId`; the request shape validator explicitly rejects each of those keys. Because class ownership fields (`teacherId`, `schoolId`) are immutable per Data Model section 1.2, current class ownership is a stable authorization signal: a class cannot be transferred to another teacher, and a class cannot be moved between schools.

## 7. District and school isolation

- The verified caller context supplies `districtId` and `schoolId`.
- The loaded class must match the caller's verified `schoolId` (which implicitly requires the class to belong to the caller's district, because a school belongs to exactly one district per the district-boundary contract).
- A same-district teacher who does not own the class is refused. A matching district alone never authorizes access. A matching school alone never authorizes access.
- After class ownership passes, every retrieved attempt is filtered defensively against `districtId`, `schoolId`, and `teacherId` derived from the caller. Any candidate whose frozen ownership fields disagree is silently dropped, consistent with the retrieval-layer discipline established in Sprint 12C.

## 8. Attempt query behavior

- Query: `attemptsCollectionRef().where("classId", "==", classId).get()`.
- Uses the auto-created single-field `classId` index. No composite index is introduced. No configuration or schema change was required.
- Results are ordered newest first by `submittedAt` (millis). A secondary sort by `attemptId` provides stable ordering across ties.
- No pagination in this slice.

## 9. Historical membership and ownership interpretation

Class ownership fields (`teacherId`, `schoolId`) are immutable per Data Model section 1.2. Every attempt stamped with the requested `classId` therefore shares the same frozen `teacherId` and `schoolId` as the current class record. Current class ownership by the authenticated teacher authorizes the full historical set of attempts for that class, including attempts by students who have since exited the class, because enrollment status is orthogonal to the immutable attempt record. A teacher who never owned the class is refused with `classes.forbidden` and cannot reach the query at all.

## 10. Response allowlist

Each attempt summary carries exactly the following fields, via an explicit projection helper (`projectTeacherClassAttemptSummary`) that never spreads the source document:

- `attemptId`
- `studentId`
- `assessmentId`
- `assignmentId`
- `assessmentRevisionId`
- `attemptNumber`
- `score`
- `maxScore`
- `percentage`
- `submittedAt` (millis)
- `status` (constant `"completed"`)

The response envelope also carries the requested `classId` so a client can correlate the response with the request without inferring it from the URL.

## 11. Sensitive fields excluded

The projection excludes every one of the following present on the source document:

- `itemResults`, `responses`, `correctOptionId`, `explanation` (answer-key and scoring internals).
- `idempotencyKey` (scorer-internal deduplication).
- `districtId`, `schoolId`, `teacherId`, `classId` (owner-routing metadata; the response envelope echoes the requested `classId` intentionally, but the per-attempt projection does not).
- `activityId` (internal lesson-slug denormalization).
- Every future addition to the `AssessmentAttemptRecord` shape is excluded by construction because the projection enumerates its outputs.

The tests explicitly assert that each of `itemResults`, `responses`, `correctOptionId`, `explanation`, `idempotencyKey`, `districtId`, `schoolId`, `teacherId`, `classId`, and `activityId` is absent from every projected attempt summary, and that `teacherId`, `schoolId`, and `districtId` are absent from the response envelope.

## 12. Display-name resolution decision

`studentDisplayName` is intentionally NOT returned in this slice.

The certified data model records a display name on `users/{uid}.displayName` (Data Model section 3.1) and permits per-class overrides via `enrollments/{enrollmentId}.displayNameOverride` (Data Model section 3.5). No reusable backend helper currently reconciles those two sources into a single canonical roster display name. Per the prompt's guidance, the retrieval boundary must not invent a second resolver. This slice therefore returns only `studentId`; canonical display-name resolution is captured as the next bounded integration requirement (see section 22).

## 13. Error handling

All errors flow through the shared `platformCallable` translator using canonical identifiers already in use across the platform. No new identifier was introduced in this slice.

- `unauthenticated`, `account-inactive`, `role-forbidden`, `district-mismatch`, `district-unassigned`, `school-district-mismatch`, `claim-stale`, `claim-state-mismatch` are propagated from the certified `requireDistrictContext` helper unchanged.
- `role-forbidden` is raised for non-teacher callers.
- `assessmentAttempts.invalidRequest` is raised for a non-object payload or an owner-scoping key on the request; identical to the identifier already used by `assessmentAttemptsList` and `assessmentAttemptGet`.
- `classes.invalidClassId` is raised for a missing, blank, non-string, or malformed `classId`; identical to the identifier already used by `classesUpdateMetadata` and `classesArchive`.
- `classes.notFound` is raised for a missing class record; identical to the identifier already used by `classesUpdateMetadata` and `classesArchive`.
- `classes.forbidden` is raised for a cross-teacher or cross-school class; identical to the identifier already used by `classesUpdateMetadata` and `classesArchive`, so a same-district non-owner and a cross-school teacher receive the same canonical class-boundary refusal.

## 14. Audit behavior

No audit event is written by this callable. The certified retrieval callables added in Sprint 12C do not write audit events either; retrieval reads are intentionally unaudited per the Cloud Function Charter's existing pattern. Preserving that pattern avoids introducing an audit surface without a certified architectural mandate.

## 15. Files reviewed

- `docs/platform/SPRINT_12A_ASSESSMENT_DATA_ACCESS_REVIEW.md`
- `docs/platform/SPRINT_12B_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12C_COMPLETION_REPORT.md`
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/PLATFORM_DECISIONS.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assessments/assessment-attempts-list.ts`
- `platform/functions/src/assessments/assessment-attempts-list.test.ts`
- `platform/functions/src/assessments/assessment-attempt-get.ts`
- `platform/functions/src/assessments/assessment-attempt-get.test.ts`
- `platform/functions/src/assessments/index.ts`
- `platform/functions/src/classes/classes-update-metadata.ts`
- `platform/functions/src/classes/classes-archive.ts`
- `platform/functions/src/assignments/assignments-close.ts`
- `platform/functions/src/enrollments/enrollments-set-status.ts`
- `platform/functions/src/shared/auth/require-district-context.ts`
- `platform/functions/src/shared/types/attempt.ts`
- `platform/functions/src/shared/types/class.ts`
- `platform/functions/src/shared/types/user.ts`
- `platform/functions/src/shared/errors/district-errors.ts`
- `platform/functions/src/shared/firestore/typed-ref.ts`
- `platform/functions/src/shared/index.ts`
- `platform/functions/src/index.ts`

## 16. Files created

- `platform/functions/src/assessments/assessment-attempts-list-for-class.ts`
- `platform/functions/src/assessments/assessment-attempts-list-for-class.test.ts`
- `docs/platform/SPRINT_12D_COMPLETION_REPORT.md`

## 17. Files modified

- `platform/functions/src/assessments/index.ts` (added the new callable and projection helper to the assessments barrel).
- `platform/functions/src/index.ts` (re-exports the new callable from the platform function surface).
- `docs/platform/SPRINT_HISTORY.md` (appended Sprint 12D entry).

No changes to Firestore Rules, indexes, schema, callable options, dependency graph, environment configuration, or any application file.

## 18. Tests added

`platform/functions/src/assessments/assessment-attempts-list-for-class.test.ts` (33 tests) covering:

Positive:

- Owning active teacher retrieves attempts for their class.
- Multiple student attempts are returned.
- Multiple attempts by the same student are returned.
- Attempts are ordered newest first.
- Empty authorized class returns an empty array.
- Only attempts matching the requested class are returned.
- Approved projection fields are present.
- Answer-key, scoring-internal, routing, and audit fields are absent.

Authentication and role:

- Unauthenticated caller refused.
- Student caller refused with `role-forbidden`.
- Platform-administrator caller refused with `role-forbidden`.
- Inactive teacher refused via `account-inactive` from the district-context helper.
- Malformed-claims teacher refused via `claim-state-mismatch` from the district-context helper.

Class authorization and input:

- Missing, blank, non-string, and malformed `classId` refused with `classes.invalidClassId`.
- Non-object request payload refused with `assessmentAttempts.invalidRequest`.
- Nonexistent class refused with `classes.notFound`.
- Same-district teacher who does not own the class refused with `classes.forbidden`.
- Cross-school teacher refused with `classes.forbidden`.
- Cross-district teacher refused because the class school does not match.
- Matching district alone does not authorize.
- Matching school alone does not authorize.
- Every owner-scoping key on the request refused with `assessmentAttempts.invalidRequest`.
- A forged `classId` cannot expose another teacher's class.

Data isolation:

- Attempts from another class are excluded.
- Attempts whose frozen `districtId` mismatches the caller are excluded.
- Attempts whose frozen `schoolId` mismatches the caller are excluded.
- Attempts whose frozen `teacherId` mismatches the caller are excluded.
- Attempts across unrelated assignments within the same class are included.
- Another teacher's attempts are never returned.
- Query targets the requested class.

## 19. Targeted validation

`npx jest src/assessments/assessment-attempts-list-for-class.test.ts` -> 33 tests, all pass.

## 20. Full validation

- `npm test` -> 33 test suites, 601 tests, all pass.
- `npm run lint` -> clean.
- `npm run typecheck` -> clean.
- `npm run build` -> clean.
- `platform/firebase/firestore.rules` unchanged.
- No application files changed.
- No schema, index, or configuration files changed.
- Only intended Sprint 12D files changed.
- No em dashes appear in any created or modified documentation.
- Every referenced repository path exists.

## 21. Findings or deviations

None. No Critical or Important security finding was surfaced during implementation.

## 22. Remaining teacher retrieval work

Bounded slices remaining for the teacher retrieval surface, in likely order:

1. Canonical roster display-name resolver. Reconcile `users/{uid}.displayName` with `enrollments/{enrollmentId}.displayNameOverride` in a reusable backend helper, then extend `TeacherClassAttemptSummary` to include `studentDisplayName`.
2. `assessmentAttemptGetForTeacher`. Single-attempt teacher retrieval, gated by current class ownership on the attempt's frozen `classId`.
3. Assignment-scoped retrieval. `assessmentAttemptsListForAssignment` scoped to one assignment belonging to a class the caller owns.
4. Roster-completion projections for teacher dashboards, once the display-name resolver and single-attempt retrieval are certified.
5. Firestore Rules extension for teacher `get`/`list` on `attempts`, if and when a client-side direct read path becomes necessary. The callable-only pattern established in Sprint 12C remains sufficient for the foreseeable teacher surfaces.

## 23. Certification statement

CERTIFIED: Sprint 12D Slice 1 is complete.
