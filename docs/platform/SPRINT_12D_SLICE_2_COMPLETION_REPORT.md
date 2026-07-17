# Sprint 12D Slice 2: Canonical Roster Display-Name Resolver and Integration into assessmentAttemptsListForClass

**Date:** 2026-07-16
**Category:** Cloud Functions (retrieval-layer helper, no schema, no Rules, no deployment)
**Certification:** CERTIFIED: Sprint 12D Slice 2 is complete.

## 1. Objective

Establish one reusable, tested backend source of truth for teacher-facing student display names, then integrate it into the certified teacher class attempt retrieval callable so every summary carries a resolved `studentDisplayName`. No new callable is exported. No new authorization surface is added. Sprint 12D Slice 1 remains authoritative for teacher retrieval authorization.

## 2. Bounded scope

In scope:

- One canonical roster display-name resolver, colocated with the enrollments domain, that reconciles the enrollment `displayNameOverride`, the user profile `displayName`, and a fixed non-empty fallback per PDR-028 sections 9 and 12.
- A request-local memoizing factory so multiple attempts by the same student trigger exactly one resolution per request.
- Integration into `assessmentAttemptsListForClass`, adding `studentDisplayName` to each `TeacherClassAttemptSummary`.
- Focused unit tests for the resolver and the memoizing factory.
- Updated integration tests for the callable.
- One completion report and a Sprint History appendage.

Out of scope (explicitly not implemented):

- `assessmentAttemptGetForTeacher` and every other teacher retrieval callable.
- Any UI, rollup, aggregation, dashboard, pagination, or persistent cache.
- Firestore Rules, schema, index, dependency, and configuration changes.
- Attempt mutation. Answer-key exposure. Display-name editing paths.
- Google profile re-read policy, LMS refresh reconciliation.
- The roster placeholder shape choice deferred by PDR-028 section 7.1.

## 3. PDR-028 interpretation

PDR-028 (Roster Display Name Implementation Contract) is the sole authority. Section 6 pins the two authorized name sources (the canonical `users/{uid}.displayName` and the per-class `enrollments/{enrollmentId}.displayNameOverride`). Section 9 defines the resolver precedence. Section 12 mandates a single resolver for every teacher-facing per-enrollment name render, forbids client fallbacks, and requires a stable degradation path when no name is available.

## 4. Canonical precedence order

The resolver, executed in a trusted class scope `(classId, schoolId, districtId)` for a `studentId`, applies precedence in order:

1. Non-blank `enrollments/{enrollmentId}.displayNameOverride` where the enrollment document at `enrollmentIdFor(classId, studentId)` also matches the trusted `studentId`, `classId`, and `schoolId`.
2. Non-blank `users/{studentId}.displayName` where the user record's `schoolId` (when present) matches the trusted `schoolId`.
3. Fixed non-empty fallback string `Name unavailable`.

The resolver never reads:

- the Google profile display name,
- the LMS-reported name,
- an email address (as fallback or otherwise),
- any name stored on an attempt, session, or submission document,
- a user record whose stored `schoolId` disagrees with the trusted `schoolId`.

## 5. Normalization behavior

The shared normalizer (`normalizeDisplayName`) trims leading and trailing whitespace and collapses internal runs of whitespace to a single space, aligned with PDR-028 section 13.1. Legitimate punctuation, diacritics, capitalization, and internal single spaces are preserved. Non-string, empty, and whitespace-only inputs return `null`, which causes the resolver to fall through to the next approved source.

## 6. Safe fallback behavior

The resolver returns the fixed string `Name unavailable` when neither approved source yields a normalized name. PDR-028 section 9.4 requires the teacher-facing surface to render `Name unavailable` on the null branch; returning the same literal at the API boundary avoids inventing a second identity policy and ensures every retrieval response carries a stable, non-empty, non-sensitive string. No email, no shortened student identifier, and no LMS-reported name are ever used as a fallback.

## 7. Resolver input and output contract

Inputs:

- `scope: { classId: string; schoolId: string; districtId: string }`. All three MUST be non-empty and MUST already be verified by the caller (class ownership and district agreement).
- `studentId: string`. MUST be a non-empty, trimmed opaque student identifier.

Output:

```ts
type ResolvedRosterDisplayName = {
  readonly studentId: string;
  readonly displayName: string;
  readonly source: "enrollmentOverride" | "userProfile" | "fallback";
};
```

`displayName` is always a non-empty string. `source` is retained internally so future callers can distinguish precedence branches for observability; it is NOT exposed on the teacher-facing response envelope in this slice.

Invalid inputs (blank `studentId`, untrimmed `studentId`, or a scope with any empty field) short-circuit to the fallback branch without performing any Firestore read.

## 8. District, school, class, enrollment, and student integrity checks

- District: the resolver consumes an already-district-agreed scope produced by `requireDistrictContext` at the callable boundary. No user record carries a `districtId` field in the certified data model, so district agreement is preserved transitively through `schoolId`, which belongs to exactly one district.
- School: an enrollment document whose stored `schoolId` disagrees with the trusted `schoolId` is ignored. A user record whose stored `schoolId` disagrees is ignored.
- Class: an enrollment document whose stored `classId` disagrees with the trusted `classId` is ignored. The enrollment id is derived deterministically from `(classId, studentId)`; a document that happens to be found at another `classId` cannot influence the result.
- Enrollment: an enrollment document whose stored `studentId` disagrees with the intended student is ignored.
- Student: a user record whose stored `authUid` disagrees with the intended student is ignored. No user record for another student can supply the name.

Inactive, withdrawn, transferred, or archived enrollment states do NOT gate the resolver, per PDR-028 section 12.5 historical consistency: teachers viewing historical attempts see the current canonical name plus the current per-class override.

## 9. Data access strategy

Two point reads per unique student per request:

- `enrollmentDocRef(enrollmentIdFor(classId, studentId)).get()`
- `userRecordDocRef(studentId).get()`

Both reads are launched in parallel via `Promise.all`. No new Firestore collection, no new index, and no new query shape is introduced. The auto-created single-field indexes used by the existing enrollments and users domains suffice.

## 10. Request-local caching or batching strategy

`createRosterDisplayNameResolver(scope)` returns a memoizing resolver closed over an in-request `Map<studentId, Promise<ResolvedRosterDisplayName>>`. Concurrent lookups of the same student share one in-flight promise. Sequential lookups share the same resolved value. A new factory call clears the cache, so no state persists across requests. No collection, document, or global cache is introduced.

## 11. Integration into assessmentAttemptsListForClass

`assessmentAttemptsListForClass` now:

1. Runs the existing certified authorization chain unchanged (`requireDistrictContext`, teacher-role gate, request-shape validator, class load, class ownership check).
2. Executes the existing `attempts.where("classId", "==", classId)` query and defense-in-depth filter against the caller-verified `teacherId`, `schoolId`, `districtId` unchanged.
3. Constructs a per-request `createRosterDisplayNameResolver` bound to the trusted scope.
4. Resolves display names for admitted attempts, memoizing per unique `studentId`.
5. Projects each admitted attempt through `projectTeacherClassAttemptSummary`, now accepting the resolved display name and attaching it as `studentDisplayName`.
6. Applies the existing newest-first sort by `submittedAt` (with `attemptId` as tiebreaker) unchanged.
7. Returns the existing envelope `{ classId, attempts }` unchanged aside from the per-attempt addition of `studentDisplayName`.

The callable does not implement its own fallback. It does not spread enrollment or user documents. It does not trust an attempt-local name. It does not accept a client-supplied `studentDisplayName`.

## 12. Teacher response contract change

`TeacherClassAttemptSummary` gains one field:

- `studentDisplayName: string` (always non-empty).

Every other projected field (`attemptId`, `studentId`, `assessmentId`, `assignmentId`, `assessmentRevisionId`, `attemptNumber`, `score`, `maxScore`, `percentage`, `submittedAt`, `status`) is unchanged. The response envelope `{ classId, attempts }` is unchanged.

## 13. Sensitive fields still excluded

Every exclusion certified in Sprint 12D Slice 1 remains enforced: `itemResults`, `responses`, `correctOptionId`, `explanation`, `idempotencyKey`, `districtId`, `schoolId`, `teacherId`, `classId` (per attempt), and `activityId` remain absent from the projection. Integration tests re-assert absence with the display-name addition present. No user or enrollment record is spread. No email, no LMS-reported name, no Google profile name, and no student-only identifier beyond `studentId` crosses the boundary.

## 14. Files reviewed

- `docs/platform/ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md`
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/SPRINT_12A_ASSESSMENT_DATA_ACCESS_REVIEW.md`
- `docs/platform/SPRINT_12C_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_12D_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assessments/assessment-attempts-list-for-class.ts`
- `platform/functions/src/assessments/assessment-attempts-list-for-class.test.ts`
- `platform/functions/src/assessments/index.ts`
- `platform/functions/src/enrollments/enrollments-join-by-code.ts`
- `platform/functions/src/enrollments/enrollments-teacher-add.ts`
- `platform/functions/src/enrollments/index.ts`
- `platform/functions/src/shared/firestore/typed-ref.ts`
- `platform/functions/src/shared/types/enrollment.ts`
- `platform/functions/src/shared/types/user.ts`
- `platform/functions/src/shared/auth/require-district-context.ts`
- `platform/functions/src/shared/errors/platform-error.ts`
- `platform/functions/src/shared/index.ts`

## 15. Files created

- `platform/functions/src/enrollments/resolve-roster-display-name.ts`
- `platform/functions/src/enrollments/resolve-roster-display-name.test.ts`
- `docs/platform/SPRINT_12D_SLICE_2_COMPLETION_REPORT.md`

## 16. Files modified

- `platform/functions/src/assessments/assessment-attempts-list-for-class.ts` (added the resolver import, added `studentDisplayName` to `TeacherClassAttemptSummary`, threaded the resolved value through `projectTeacherClassAttemptSummary`, wired the request-local memoizing resolver into the handler).
- `platform/functions/src/assessments/assessment-attempts-list-for-class.test.ts` (added the resolver mock, extended the projected-fields assertion to include `studentDisplayName`, added the display-name integration test cases).
- `platform/functions/src/enrollments/index.ts` (barrel export of the reusable resolver symbols).
- `docs/platform/SPRINT_HISTORY.md` (appended Sprint 12D Slice 2 entry).

No Firestore Rules, application file, schema, index, dependency, or configuration change. No new callable is exported from `platform/functions/src/index.ts`.

## 17. Resolver tests added

`platform/functions/src/enrollments/resolve-roster-display-name.test.ts` (30 tests).

`normalizeDisplayName` (5 tests): trims and collapses whitespace; returns null for non-string, empty, and whitespace-only inputs; preserves punctuation and diacritics; is idempotent.

`resolveRosterDisplayName` (22 tests):

- Precedence: override wins; profile wins in absence of override; fallback when neither exists; blank override does not replace a valid profile name; whitespace-only profile falls through to fallback; whitespace is trimmed and collapsed on the resolved value.
- Scope and integrity: enrollment from another class is ignored; enrollment with disagreeing `schoolId` is ignored; enrollment stored under a different `studentId` is ignored; user record for another `authUid` is ignored; user record with disagreeing `schoolId` is ignored; historical override is honored for a withdrawn enrollment; missing enrollment falls through; missing user document falls through.
- Stability and confidentiality: resolver always returns a non-empty string; resolver does not return an email address as a fallback; resolver output shape is exactly `{ studentId, displayName, source }` and does not spread source documents; fallback is stable across repeated calls; punctuation and diacritics are preserved; blank or untrimmed `studentId` short-circuits to fallback without any Firestore read; scope with a missing `classId` short-circuits to fallback.

`createRosterDisplayNameResolver` (3 tests): each unique student is resolved exactly once per request; concurrent lookups share one in-flight promise; a new factory clears the cache.

## 18. Integration tests added or updated

`platform/functions/src/assessments/assessment-attempts-list-for-class.test.ts` (42 tests, up from 33).

Updated:

- The projected-fields assertion now expects `studentDisplayName` in the allowlist.

Added:

- `studentDisplayName` is attached to every returned attempt.
- Canonical fallback string is returned when the resolver reports no name.
- Multiple attempts by the same student reuse a single resolved name and trigger exactly one resolver invocation for that student.
- Multiple students receive their own correctly attributed names.
- The resolver receives the trusted `(classId, schoolId, districtId)` scope from the callable context.
- Attempts filtered out by the defense-in-depth ownership check never trigger a resolver invocation for the excluded student, so a leaked name for a cross-class, cross-district, or cross-school attempt is impossible.
- Existing sensitive-field exclusions still pass alongside the display-name addition.
- Existing newest-first ordering still passes.
- An empty class still returns an empty array and does not invoke the resolver.

All previous authorization, role-gate, input-validation, class-load, class-ownership, cross-district, cross-school, cross-teacher, and data-isolation tests from Sprint 12D Slice 1 continue to pass unchanged.

## 19. Targeted validation

- `npx jest src/enrollments/resolve-roster-display-name.test.ts` -> 1 suite, 30 tests, all pass.
- `npx jest src/assessments/assessment-attempts-list-for-class.test.ts` -> 1 suite, 42 tests, all pass.

## 20. Full validation

- `npm test` -> 34 suites, 640 tests, all pass.
- `npm run lint` -> clean.
- `npm run typecheck` -> clean.
- `npm run build` -> clean.
- `platform/firebase/firestore.rules` unchanged.
- No application file changed.
- No schema, index, dependency, or configuration file changed.
- Only the intended Sprint 12D Slice 2 files changed (plus the pre-existing HTML working-copy modifications that predate this sprint).
- No em dashes appear in any created or modified documentation.
- Every referenced repository path exists.

## 21. Findings or deviations

None. No Critical or Important finding was surfaced during implementation.

Minor implementation note: the resolver imports `enrollmentDocRef` and `userRecordDocRef` from the shared barrel and reimplements the two-line `enrollmentIdFor(classId, studentId)` derivation locally rather than importing it from `enrollments-join-by-code.ts`. Importing from the join-by-code module would transitively register that callable at module-load time inside the resolver's unit tests, which mock `../shared`. The derivation is stable and documented as a shared internal convention; the two callsites MUST stay in sync.

## 22. Remaining teacher retrieval work

Bounded slices remaining, in likely order:

1. `assessmentAttemptGetForTeacher`. Single-attempt teacher retrieval, gated by current class ownership on the attempt's frozen `classId`, projecting the same summary shape and reusing the canonical resolver.
2. Assignment-scoped retrieval (`assessmentAttemptsListForAssignment`), scoped to one assignment belonging to a class the caller owns.
3. Roster-completion projections for teacher dashboards, now unblocked by the canonical display-name resolver.
4. Firestore Rules extension for teacher direct `get`/`list` on `attempts`, only if and when a callable-only path becomes insufficient.

## 23. Certification statement

CERTIFIED: Sprint 12D Slice 2 is complete.
