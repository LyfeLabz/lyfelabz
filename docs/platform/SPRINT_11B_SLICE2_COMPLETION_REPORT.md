# Sprint 11B Slice 2 Completion Report

**Status:** Completed. Slice 2 of the Sprint 11A implementation sequence.
**Date:** 2026-07-13
**Anchor decision:** PDR-025 District Security Boundary.
**Governs:** The first callable-layer adoption of the shared `requireDistrictContext` helper landed in Slice 1.

---

## 1. Purpose

Sprint 11B Slice 2 begins consuming the shared district-context foundation introduced in Slice 1. The shared `requireDistrictContext` helper is now integrated into the authorization step of the three `classes` callables that form the top of the resource-ownership chain per PDR-025 §10: `classesCreate`, `classesUpdateMetadata`, and `classesArchive`.

Every one of these three callables previously duplicated a bespoke `assertAuthenticatedTeacher` helper that verified authentication, the `role: "teacher"` claim, and a non-empty `schoolId` claim. Slice 2 replaces those duplicated inline checks with a single call to `requireDistrictContext(request)` per callable, followed by a canonical `role-forbidden` refusal when the resolved role is not `"teacher"`. All authorization now flows through the shared helper, and no callable re-implements district validation on its own.

The slice is scope-bounded. It does not touch Firestore Rules, the app, LMS integration, the assessment pipeline, the display-name path, or any Firestore document shape. It does not modify the writer contract, the audit vocabulary, the platform contracts, or any PDR. It does not begin a broader platform-wide migration; enrollments, assignments, and submissions callables are intentionally untouched and remain on their existing inline authorization pending future slices.

## 2. Canonical authority used

- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (PDR-025) §6 canonical claim shape, §10 resource ownership chain, §12 callable enforcement contract, §15 stale-claim reconciliation, §17 closed-set error vocabulary, and §20 implementation checklist items 1 through 3.
- `docs/platform/SPRINT_11A_IMPLEMENTATION_INVENTORY.md` §13 Slice 2 (activation callables and downstream district enforcement) and §14 which frames the minimum scope for Sprint 11B.
- `docs/platform/SPRINT_11B_SLICE1_COMPLETION_REPORT.md` §7 (`requireDistrictContext` behavior) and §11 (Slice 2 deferral note).
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §2 (single-writer claim discipline) and Appendix A (canonical callable names).
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` for the rule-layer baseline preserved by this shared helper.
- `docs/platform/PLATFORM_CONTRACTS.md` for the client-storage prohibitions that continue to hold at the callable layer.

## 3. Files created

- `docs/platform/SPRINT_11B_SLICE2_COMPLETION_REPORT.md`. This report.

## 4. Files modified

- `platform/functions/src/classes/classes-create.ts`. Removes the inline `assertAuthenticatedTeacher` helper and introduces `assertActiveTeacherInDistrict` as a thin wrapper that awaits `requireDistrictContext(request)` and refuses `role-forbidden` when the resolved role is not `"teacher"`. The handler awaits this wrapper. Every subsequent behavior is preserved: request validation, idempotent replay detection, existing-record conflict detection, server-generated join code, canonical `classes/{classId}` write via `classCreationDocRef(classId).set(...)`, audit-event emission (`classes.created`), and response shape. The imports from `../shared` gain `requireDistrictContext`.
- `platform/functions/src/classes/classes-update-metadata.ts`. Same transformation. The handler awaits `assertActiveTeacherInDistrict(request)` and preserves the narrow-metadata diffing, the archived-class refusal (`classes.invalidStatus`), the cross-teacher and cross-school ownership refusal (`classes.forbidden`), the `classes.notFound` refusal, the audit event (`classes.metadataUpdated` with the `changedFields` payload), and the response shape.
- `platform/functions/src/classes/classes-archive.ts`. Same transformation. The handler awaits `assertActiveTeacherInDistrict(request)` and preserves the terminal archive semantics, the idempotent already-archived response, the ownership refusal, the `classes.notFound` refusal, the audit event (`classes.archived`), and the update-then-audit ordering.
- `platform/functions/src/classes/classes-create.test.ts`. Adds a `mockRequireDistrictContext` jest mock exported through the `../shared` mock. Simplifies `makeRequest` because the token payload is no longer read by the callable. Adds explicit tests for the six canonical district refusals that propagate through the shared helper (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`, `school-district-mismatch`, `district-unassigned`) and two refusals raised by the callable itself when the resolved role is not `"teacher"` (student and platform administrator both refuse with `role-forbidden`). Every prior assertion for validation, idempotency, conflict detection, audit emission, and downstream failure propagation is preserved.
- `platform/functions/src/classes/classes-update-metadata.test.ts`. Same mock introduction. Adds tests for four canonical district refusals (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`) and two `role-forbidden` refusals (student and platform administrator). Every prior assertion is preserved.
- `platform/functions/src/classes/classes-archive.test.ts`. Same mock introduction. Adds tests for four canonical district refusals (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`) and two `role-forbidden` refusals (student and platform administrator). Every prior assertion is preserved.
- `docs/platform/SPRINT_HISTORY.md`. Appends the Sprint 11B Slice 2 entry.

## 5. Shared authorization changes

- The three `classes` callables now route authentication, active-status, role, school-record, and district-record verification through a single shared helper. No callable re-implements any part of that flow.
- Refusals emitted directly by the shared helper propagate to the callable boundary as canonical PDR-025 §17 identifiers: `unauthenticated`, `account-inactive`, `claim-stale`, `claim-state-mismatch`, `school-district-mismatch`, `district-unassigned`, and `district-mismatch`. The callables do not rename, alias, or wrap these identifiers.
- Callable-local role narrowing (the requirement that the caller be a `"teacher"`) is expressed as a `role-forbidden` refusal per PDR-025 §17. No other district-error identifier is invented.
- The shared helper never mutates state, never emits an audit event, and never re-issues claims. The audit-event contract on each callable is unchanged.
- The `districtId` returned by the helper is passed through the `actor` structure inside each callable. It is not yet written to `classes/{classId}` documents or emitted on audit events; both are Slice 3 responsibilities per Sprint 11A §13.

## 6. Callables updated

Only the three `classes/*` callables were updated. This is the minimum coherent unit: all three callables shared an identical `assertAuthenticatedTeacher` pattern, and all three sit at the top of the resource-ownership chain per PDR-025 §10.

Callables intentionally not updated in this slice:

- `teachersApproveVerification` and `studentsCompleteOnboarding` remain unchanged. Both are activation callables whose callers are not yet `"active"` when the callable is invoked (platform administrator on the teacher path, `provisioned` student on the student path). Neither can meet `requireDistrictContext`'s active-status precondition. Their Slice 1 mechanical resolution of `districtId` from `schools/{schoolId}` is preserved.
- `enrollmentsJoinByCode`, `enrollmentsTeacherAdd`, `enrollmentsSetStatus`, every `assignments/*` callable, every `submissions/*` callable, every `lms/*` callable, and every trigger under `auth/` remain on their existing inline authorization. Migration of those callables is out of scope for this slice per the sprint constraint that broad platform-wide migration is not to begin.

## 7. Test coverage

`platform/functions/src/classes/classes-create.test.ts` gains eight new assertions: six for the canonical district refusals that propagate through `requireDistrictContext` (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`, `school-district-mismatch`, `district-unassigned`) and two for the callable-local `role-forbidden` refusal (student caller and platform administrator caller). Every prior assertion for request validation, idempotent replay, conflict detection, audit emission ordering, and downstream failure propagation is preserved. The three prior authorization tests that expected `classes.unauthenticated` and `classes.unauthorized` are replaced by the eight canonical-district-error tests above.

`platform/functions/src/classes/classes-update-metadata.test.ts` gains six new assertions: four canonical district refusals (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`) and two `role-forbidden` refusals (student and platform administrator). Every prior assertion for narrow-metadata diffing, idempotency, cross-teacher and cross-school refusal, archived-status refusal, class-not-found refusal, payload validation, and update-then-audit ordering is preserved.

`platform/functions/src/classes/classes-archive.test.ts` gains six new assertions with the same coverage pattern. Every prior assertion for terminal archive semantics, idempotency, cross-teacher and cross-school refusal, class-not-found refusal, invalid-classId refusal, update-then-audit ordering, and downstream failure propagation is preserved.

Full Jest suite:

```
Test Suites: 24 passed, 24 total
Tests:       366 passed, 366 total
```

Pre-slice baseline was 24 suites and 353 tests; the delta is 13 net new tests (eight added to `classes-create.test.ts`, six added to each of the other two, minus the three prior authorization tests replaced on each file).

## 8. Scope validation

- Firestore Rules were not modified. `platform/firebase/firestore.rules` is unchanged.
- Firestore indexes were not modified. `platform/firebase/firestore.indexes.json` is unchanged.
- No app code under `app/**` was modified.
- No LMS integration file, assessment pipeline file, or display-name path file was modified.
- No Firestore document shape and no collection schema was changed. `ClassRecord` in `platform/functions/src/shared/types/class.ts` is unchanged. The three `classes` callables still write exactly the same canonical fields to `classes/{classId}` they wrote before this slice.
- No audit event vocabulary was introduced. The `classes.created`, `classes.metadataUpdated`, and `classes.archived` events are emitted exactly as before.
- No architecture document, PDR, contract, certification report, or completion report was modified. Only the new Slice 2 completion report and the SPRINT_HISTORY append are added.
- No callable outside of `classes/*` was modified.
- No new district error identifier was introduced. Every refusal on the three callables uses an identifier that already existed in either the PDR-025 §17 closed set (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`, `school-district-mismatch`, `district-unassigned`, `role-forbidden`) or the callable's own pre-existing namespace (`classes.invalidRequest`, `classes.invalidClassId`, `classes.invalidTitle`, `classes.invalidGrade`, `classes.invalidBlock`, `classes.invalidAcademicTerm`, `classes.notFound`, `classes.forbidden`, `classes.conflict`, `classes.invalidStatus`).
- The shared writer contract in `platform/functions/src/shared/auth/claims.ts` is unchanged. The shared helper in `platform/functions/src/shared/auth/require-district-context.ts` is unchanged.
- No later Sprint 11 slice was started.

## 9. Certification

Only Sprint 11B Slice 2 was implemented. Slices 3 through 20 of the Sprint 11A recommended sequence are intentionally deferred. No Firestore Rules were modified. No app code was modified. No new callable was introduced. No callable outside the three `classes/*` handlers was modified. The two Slice 1 activation callables retain their mechanical `districtId` resolution and were not migrated to `requireDistrictContext` in this slice, because their callers are not yet `"active"` and cannot satisfy the helper's precondition. No architecture, PDR, contract, or certification report was modified. All new and existing unit tests pass locally. No commit was made.

---

## Change Log

- 2026-07-13 - Initial issuance under Sprint 11B Slice 2. No architecture contract was amended.
