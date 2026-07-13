# Sprint 11B Slice 3 Completion Report

**Status:** Completed. Slice 3 of the Sprint 11A implementation sequence.
**Date:** 2026-07-13
**Anchor decision:** PDR-025 District Security Boundary.
**Governs:** Extending the shared `requireDistrictContext` helper adopted in Slice 2 to the enrollment-management callable layer.

---

## 1. Purpose

Sprint 11B Slice 3 extends the district-context authorization model established in Slice 2 to the enrollment-ownership layer. The shared `requireDistrictContext` helper is now integrated into the authorization step of the three enrollments callables that form the second tier of the resource-ownership chain per PDR-025 §10: `enrollmentsJoinByCode`, `enrollmentsTeacherAdd`, and `enrollmentsSetStatus`.

Each of these three callables previously duplicated a bespoke `assertAuthenticatedStudent` or `assertAuthenticatedTeacher` helper that verified authentication, the caller's `role` claim, and a non-empty `schoolId` claim. Slice 3 replaces those duplicated inline checks with a single call to `requireDistrictContext(request)` per callable, followed by a canonical `role-forbidden` refusal when the resolved role does not match the callable's required role (`"student"` for `enrollmentsJoinByCode`, `"teacher"` for `enrollmentsTeacherAdd` and `enrollmentsSetStatus`). All authorization on these callables now flows through the shared helper, and no callable re-implements district validation on its own.

The slice is scope-bounded. It does not touch Firestore Rules, the app, LMS integration, the assessment pipeline, assignments, submissions, the display-name path, or any Firestore document shape. It does not modify the writer contract, the audit vocabulary, the platform contracts, or any PDR. It does not begin a broader platform-wide migration; assignments, submissions, and LMS callables are intentionally untouched and remain on their existing inline authorization pending future slices. Enrollment lifecycle behavior (schema, lifecycle states, exit-timestamp policy, idempotency, response contracts, audit events) is preserved without change.

## 2. Canonical authority used

- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (PDR-025) §6 canonical claim shape, §10 resource ownership chain, §12 callable enforcement contract, §15 stale-claim reconciliation, §17 closed-set error vocabulary, and §20 implementation checklist items 1 through 3.
- `docs/platform/SPRINT_11A_IMPLEMENTATION_INVENTORY.md` §13 (activation callables and downstream district enforcement) and §14 (Sprint 11B minimum scope framing).
- `docs/platform/SPRINT_11B_SLICE1_COMPLETION_REPORT.md` §7 (`requireDistrictContext` behavior).
- `docs/platform/SPRINT_11B_SLICE2_COMPLETION_REPORT.md` §5 (shared authorization contract) and §6 (deferred enrollments migration).
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §2 (single-writer claim discipline) and Appendix A (canonical callable names).
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` §4.4 (owning-teacher editor) preserved by this shared helper.
- `docs/platform/PLATFORM_CONTRACTS.md` for the client-storage prohibitions that continue to hold at the callable layer.

## 3. Files created

- `docs/platform/SPRINT_11B_SLICE3_COMPLETION_REPORT.md`. This report.

## 4. Files modified

- `platform/functions/src/enrollments/enrollments-join-by-code.ts`. Removes the inline `assertAuthenticatedStudent` helper and introduces `assertActiveStudentInDistrict` as a thin wrapper that awaits `requireDistrictContext(request)` and refuses `role-forbidden` when the resolved role is not `"student"`. The handler awaits this wrapper. Every subsequent behavior is preserved: request validation, join-code resolution via `classesCollectionRef().where(...).get()` scoped to the caller's `schoolId`, the defense-in-depth cross-school refusal, existing-record idempotent replay detection, terminal-status `enrollments.conflict` refusal, canonical `enrollments/{enrollmentId}` write via `enrollmentCreationDocRef(id).set(...)`, audit-event emission (`enrollments.created` with `source: "joinByCode"`), and response shape. Imports from `../shared` gain `requireDistrictContext`.
- `platform/functions/src/enrollments/enrollments-teacher-add.ts`. Same transformation. The handler awaits `assertActiveTeacherInDistrict(request)` and preserves the class-ownership refusal (`enrollments.forbidden` for cross-teacher or cross-school), the archived-class refusal (`enrollments.invalidClassStatus`), the target-student refusals (`enrollments.studentNotFound`, `enrollments.invalidTargetRole`, cross-school target `enrollments.forbidden`, `enrollments.invalidTargetStatus`), the idempotent-active-enrollment response, the terminal-status `enrollments.conflict` refusal, the canonical write, the audit event (`enrollments.created` with `source: "teacherAdd"`), and the response shape.
- `platform/functions/src/enrollments/enrollments-set-status.ts`. Same transformation. The handler awaits `assertActiveTeacherInDistrict(request)` and preserves the enrollment and class lookups, the cross-teacher and cross-school ownership refusal (`enrollments.forbidden`), the lifecycle transition table, the exit-timestamp stamping policy for `transferred`, `withdrawn`, and `active -> archived`, the idempotent already-in-status response, the invalid-transition refusal (`enrollments.invalidTransition`), the narrow status write via `enrollmentStatusChangeDocRef(...).update(...)`, the audit event (`enrollments.statusChanged`), and the response shape.
- `platform/functions/src/enrollments/enrollments-join-by-code.test.ts`. Adds a `mockRequireDistrictContext` jest mock exported through the `../shared` mock. Simplifies `makeRequest` because the token payload is no longer read by the callable. Adds explicit tests for the six canonical district refusals that propagate through the shared helper (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`, `school-district-mismatch`, `district-unassigned`) and two refusals raised by the callable itself when the resolved role is not `"student"` (teacher and platform administrator both refuse with `role-forbidden`). Every prior assertion for join-code validation, idempotency, terminal-status conflict, audit emission, ordering, and downstream failure propagation is preserved. The prior authentication and role tests that expected `enrollments.unauthenticated` and `enrollments.unauthorized` are replaced by the eight canonical-district-error tests above.
- `platform/functions/src/enrollments/enrollments-teacher-add.test.ts`. Same mock introduction. Adds tests for four canonical district refusals (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`) and two `role-forbidden` refusals (student and platform administrator). Every prior assertion for class lookup, ownership refusal, archived-class refusal, target-student verification, idempotency, terminal-status conflict, and audit emission is preserved.
- `platform/functions/src/enrollments/enrollments-set-status.test.ts`. Same mock introduction. Adds tests for four canonical district refusals (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`) and two `role-forbidden` refusals (student and platform administrator). Every prior assertion for lifecycle transitions, exit-timestamp policy, idempotency, invalid-transition refusal, ownership refusal, and audit emission is preserved.
- `docs/platform/SPRINT_HISTORY.md`. Appends the Sprint 11B Slice 3 entry.

## 5. Enrollment authorization changes

- The three `enrollments/*` callables now route authentication, active-status, role, school-record, and district-record verification through a single shared helper. No callable re-implements any part of that flow.
- Refusals emitted directly by the shared helper propagate to the callable boundary as canonical PDR-025 §17 identifiers: `unauthenticated`, `account-inactive`, `claim-stale`, `claim-state-mismatch`, `school-district-mismatch`, `district-unassigned`, and `district-mismatch`. The callables do not rename, alias, or wrap these identifiers.
- Callable-local role narrowing (student for `enrollmentsJoinByCode`, teacher for `enrollmentsTeacherAdd` and `enrollmentsSetStatus`) is expressed as a `role-forbidden` refusal per PDR-025 §17. No other district-error identifier is invented.
- The shared helper never mutates state, never emits an audit event, and never re-issues claims. The audit-event contract on each callable (`enrollments.created` for the two creation paths, `enrollments.statusChanged` for the lifecycle transition) is unchanged.
- The pre-existing enrollment-namespace refusals used by resource-level ownership and lifecycle checks continue to hold and are unmodified: `enrollments.invalidRequest`, `enrollments.invalidJoinCode`, `enrollments.invalidClassId`, `enrollments.invalidStudentId`, `enrollments.invalidEnrollmentId`, `enrollments.invalidStatus`, `enrollments.invalidDisplayNameOverride`, `enrollments.joinCodeNotFound`, `enrollments.notFound`, `enrollments.classNotFound`, `enrollments.studentNotFound`, `enrollments.forbidden`, `enrollments.conflict`, `enrollments.invalidClassStatus`, `enrollments.invalidTargetRole`, `enrollments.invalidTargetStatus`, and `enrollments.invalidTransition`.
- The `districtId` returned by the helper is passed through the `actor` structure inside each callable. It is not yet written to `enrollments/{enrollmentId}` documents or emitted on audit events; both remain intentionally deferred and are not in scope for this slice.

## 6. Callables updated

Only the three `enrollments/*` callables were updated:

- `enrollmentsJoinByCode` (student self-service enrollment creation).
- `enrollmentsTeacherAdd` (teacher-mediated enrollment creation).
- `enrollmentsSetStatus` (teacher-mediated lifecycle transition, covering the enrollment `transferred`, `withdrawn`, and `archived` states in a single canonical writer).

There is no separate enrollment-withdrawal or enrollment-archival callable to migrate; the lifecycle is expressed entirely through `enrollmentsSetStatus`, so covering it once covers every enrollment lifecycle transition.

Callables intentionally not updated in this slice:

- `teachersApproveVerification` and `studentsCompleteOnboarding` remain unchanged. Both are activation callables whose callers are not yet `"active"` when the callable is invoked and cannot meet `requireDistrictContext`'s active-status precondition. Their Slice 1 mechanical resolution of `districtId` from `schools/{schoolId}` is preserved.
- The three `classes/*` callables migrated in Slice 2 (`classesCreate`, `classesUpdateMetadata`, `classesArchive`) are unchanged.
- Every `assignments/*` callable, every `submissions/*` callable, every `lms/*` callable, and every trigger under `auth/` remain on their existing inline authorization. Migration of those callables is out of scope for this slice per the sprint constraint that broad platform-wide migration is not to begin.

## 7. Tests updated

`platform/functions/src/enrollments/enrollments-join-by-code.test.ts` gains eight new assertions: six for the canonical district refusals that propagate through `requireDistrictContext` (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`, `school-district-mismatch`, `district-unassigned`) and two for the callable-local `role-forbidden` refusal (teacher caller and platform administrator caller). Every prior assertion for join-code payload validation, idempotent replay, terminal-status conflict, audit emission ordering, and downstream failure propagation is preserved. Three prior authorization tests that expected `enrollments.unauthenticated` and `enrollments.unauthorized` are replaced by the eight canonical-district-error tests above.

`platform/functions/src/enrollments/enrollments-teacher-add.test.ts` gains six new assertions: four canonical district refusals (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`) and two `role-forbidden` refusals (student and platform administrator). Every prior assertion for class lookup, cross-teacher and cross-school refusal, archived-class refusal, target-student refusals, idempotency, terminal-status conflict, and audit emission is preserved. Two prior authorization tests that expected `enrollments.unauthenticated` and `enrollments.unauthorized` are replaced by the six canonical-district-error tests above.

`platform/functions/src/enrollments/enrollments-set-status.test.ts` gains six new assertions with the same coverage pattern. Every prior assertion for lifecycle transitions, exit-timestamp policy, idempotency, invalid-transition refusal, cross-teacher and cross-school refusal, enrollment-not-found refusal, class-not-found refusal, payload validation, and audit emission is preserved. Two prior authorization tests that expected `enrollments.unauthenticated` and `enrollments.unauthorized` are replaced by the six canonical-district-error tests above.

Full Jest suite:

```
Test Suites: 24 passed, 24 total
Tests:       380 passed, 380 total
```

Pre-slice baseline was 24 suites and 366 tests; the delta is 14 net new tests (eight added to `enrollments-join-by-code.test.ts`, six added to `enrollments-teacher-add.test.ts`, six added to `enrollments-set-status.test.ts`, minus seven prior authorization tests replaced across the three files).

## 8. Scope validation

- Firestore Rules were not modified. `platform/firebase/firestore.rules` is unchanged.
- Firestore indexes were not modified. `platform/firebase/firestore.indexes.json` is unchanged.
- No app code under `app/**` was modified.
- No LMS integration file, assignments callable, submissions callable, assessment pipeline file, or display-name path file was modified.
- No Firestore document shape and no collection schema was changed. `EnrollmentRecord` and `ClassRecord` in `platform/functions/src/shared/types/` are unchanged. The three `enrollments` callables still write exactly the same canonical fields to `enrollments/{enrollmentId}` they wrote before this slice.
- No audit event vocabulary was introduced. The `enrollments.created` and `enrollments.statusChanged` events are emitted exactly as before, with unchanged `payload` structures.
- Enrollment lifecycle behavior is preserved: the schema, the four canonical statuses (`active`, `transferred`, `withdrawn`, `archived`), the allowed-transitions table, the exit-timestamp stamping policy, the idempotent response contracts, and the terminal-status conflict semantics are unchanged.
- No architecture document, PDR, contract, certification report, or prior completion report was modified. Only the new Slice 3 completion report and the SPRINT_HISTORY append are added.
- No callable outside of `enrollments/*` was modified.
- No new district error identifier was introduced. Every refusal on the three callables uses an identifier that already existed in either the PDR-025 §17 closed set (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`, `school-district-mismatch`, `district-unassigned`, `role-forbidden`) or the callable's own pre-existing `enrollments.*` namespace.
- The shared writer contract in `platform/functions/src/shared/auth/claims.ts` is unchanged. The shared helper in `platform/functions/src/shared/auth/require-district-context.ts` is unchanged.
- The `classes/*` callables migrated in Slice 2 were not touched.
- No later Sprint 11 slice was started.

## 9. Certification

Only Sprint 11B Slice 3 was implemented. Slices 4 through 20 of the Sprint 11A recommended sequence are intentionally deferred. No Firestore Rules were modified. No app code was modified. No new callable was introduced. No callable outside the three `enrollments/*` handlers was modified. The Slice 1 activation callables and the Slice 2 `classes/*` callables were not modified. No architecture, PDR, contract, or certification report was modified. All new and existing unit tests pass locally. No em dash appears in any created or modified document. No commit was made.

---

## Change Log

- 2026-07-13 - Initial issuance under Sprint 11B Slice 3. No architecture contract was amended.
