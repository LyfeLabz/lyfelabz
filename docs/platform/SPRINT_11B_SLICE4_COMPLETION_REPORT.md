# Sprint 11B Slice 4 Completion Report

**Status:** Completed. Slice 4 of the Sprint 11A implementation sequence.
**Date:** 2026-07-13
**Anchor decision:** PDR-025 District Security Boundary.
**Governs:** Extending the shared `requireDistrictContext` helper adopted in Slices 2 and 3 to the assignment-management callable layer.

---

## 1. Purpose and scope

Sprint 11B Slice 4 extends the district-context authorization model established in Slices 2 and 3 to the assignment-management layer. The shared `requireDistrictContext` helper is now integrated into the authorization step of the five `assignments/*` callables that form the assignment tier of the resource-ownership chain per PDR-025 §10: `assignmentsCreateDraft`, `assignmentsUpdateDraft`, `assignmentsPublish`, `assignmentsClose`, and `assignmentsArchive`.

Each of these five callables previously duplicated a bespoke `assertAuthenticatedTeacher` helper that verified authentication, the caller's `role` claim, and a non-empty `schoolId` claim inline against `request.auth.token`. Slice 4 replaces those duplicated inline checks with a single call to `requireDistrictContext(request)` per callable, followed by a canonical `role-forbidden` refusal when the resolved role is not `"teacher"`. All authorization on these five callables now flows through the shared helper, and no callable re-implements district validation on its own.

The slice is scope-bounded. It does not touch Firestore Rules, the app, LMS integration, the assessment pipeline, submissions, enrollments, classes, the display-name path, or any Firestore document shape. It does not modify the writer contract, the audit vocabulary, the platform contracts, or any PDR. It does not begin a broader platform-wide migration; submissions callables, LMS callables, and every trigger under `auth/` are intentionally untouched and remain on their existing inline authorization pending future slices. Assignment lifecycle behavior (draft, published, closed, archived states; ownership rules; idempotency; audit event vocabulary; response contracts) is preserved without change.

## 2. Canonical authority

- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (PDR-025) §6 canonical claim shape, §10 resource ownership chain, §12 callable enforcement contract, §15 stale-claim reconciliation, §17 closed-set error vocabulary, and §20 implementation checklist items 1 through 3.
- `docs/platform/SPRINT_11A_IMPLEMENTATION_INVENTORY.md` §13 (activation callables and downstream district enforcement) and §14 (Sprint 11B minimum scope framing).
- `docs/platform/SPRINT_11B_SLICE1_COMPLETION_REPORT.md` §7 (`requireDistrictContext` behavior).
- `docs/platform/SPRINT_11B_SLICE2_COMPLETION_REPORT.md` §5 (shared authorization contract on `classes/*`).
- `docs/platform/SPRINT_11B_SLICE3_COMPLETION_REPORT.md` §5 (shared authorization contract on `enrollments/*`).
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §2 (single-writer claim discipline) and Appendix A (canonical callable names).
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` §4.4 (owning-teacher editor) preserved by this shared helper.
- `docs/platform/PLATFORM_CONTRACTS.md` for the client-storage prohibitions that continue to hold at the callable layer.

## 3. Assignment callables inspected

The five callables that compose the assignment lifecycle were inspected end to end:

- `assignmentsCreateDraft` (teacher-initiated draft creation, seed record for an assignment).
- `assignmentsUpdateDraft` (teacher-mediated field updates to a draft record).
- `assignmentsPublish` (teacher-mediated draft to published transition).
- `assignmentsClose` (teacher-mediated published to closed transition).
- `assignmentsArchive` (teacher-mediated terminal archive transition).

There is no separate assignment-restore or assignment-hard-delete callable to migrate; the terminal lifecycle transition is expressed entirely through `assignmentsArchive`.

## 4. Assignment callables modified

Only the five `assignments/*` handler files were updated:

- `platform/functions/src/assignments/assignments-create-draft.ts`. Removes the inline `assertAuthenticatedTeacher` helper and introduces `assertActiveTeacherInDistrict` as a thin wrapper that awaits `requireDistrictContext(request)` and refuses `role-forbidden` when the resolved role is not `"teacher"`. The handler awaits this wrapper. Every subsequent behavior is preserved: request validation, class-ownership resolution against `classes/{classId}`, cross-school and cross-teacher refusals, canonical `assignments/{assignmentId}` write, audit-event emission (`assignments.created`), and response shape. Imports from `../shared` gain `requireDistrictContext`.
- `platform/functions/src/assignments/assignments-update-draft.ts`. Same transformation. The handler awaits `assertActiveTeacherInDistrict(request)` and preserves the draft-state precondition, the field-update contract, the ownership refusal, the idempotent replay semantics, the canonical write, the audit event (`assignments.updated`), and the response shape.
- `platform/functions/src/assignments/assignments-publish.ts`. Same transformation. The handler awaits `assertActiveTeacherInDistrict(request)` and preserves the draft to published transition precondition, the ownership refusal, the canonical write, the audit event (`assignments.published`), and the response shape.
- `platform/functions/src/assignments/assignments-close.ts`. Same transformation. The handler awaits `assertActiveTeacherInDistrict(request)` and preserves the published to closed transition precondition, the ownership refusal, the canonical write, the audit event (`assignments.closed`), and the response shape.
- `platform/functions/src/assignments/assignments-archive.ts`. Same transformation. The handler awaits `assertActiveTeacherInDistrict(request)` and preserves the terminal archive transition precondition, the ownership refusal, the canonical write, the audit event (`assignments.archived`), and the response shape.

## 5. District authorization integration

- The five `assignments/*` callables now route authentication, active-status, role, school-record, and district-record verification through a single shared helper. No callable re-implements any part of that flow.
- Refusals emitted directly by the shared helper propagate to the callable boundary as canonical PDR-025 §17 identifiers: `unauthenticated`, `account-inactive`, `claim-stale`, `claim-state-mismatch`, `school-district-mismatch`, `district-unassigned`, and `district-mismatch`. The callables do not rename, alias, or wrap these identifiers.
- Callable-local role narrowing (teacher) is expressed as a `role-forbidden` refusal per PDR-025 §17. No other district-error identifier is invented.
- The shared helper never mutates state, never emits an audit event, and never re-issues claims. The audit-event contract on each callable is unchanged.
- The `districtId` returned by the helper is passed through the `actor` structure inside each callable. It is not yet written to `assignments/{assignmentId}` documents or emitted on audit events; both remain intentionally deferred and are not in scope for this slice.

## 6. Preserved assignment behavior

The following behaviors on the five callables are preserved exactly:

- **Lifecycle:** The draft, published, closed, and archived states, the allowed transition table, and the ordering constraints between them are unchanged.
- **Ownership:** The owning-teacher rule (only the teacher who owns the parent class may create, update, publish, close, or archive an assignment on that class) is unchanged. The cross-school defense-in-depth refusal is unchanged.
- **Audit vocabulary:** The four canonical audit event ids (`assignments.created`, `assignments.updated`, `assignments.published`, `assignments.closed`, `assignments.archived`) and their payload structures are unchanged.
- **Idempotency:** Every idempotent replay path documented in the assignment specification is preserved unchanged.
- **Response:** Every response shape returned by the five callables is unchanged.
- **Namespaced refusals:** Every pre-existing `assignments.*` namespace refusal is preserved unchanged, including `assignments.invalidRequest`, `assignments.invalidAssignmentId`, `assignments.invalidClassId`, `assignments.notFound`, `assignments.classNotFound`, `assignments.forbidden`, `assignments.conflict`, `assignments.invalidStatus`, and `assignments.invalidTransition`. The two prior authentication-namespace refusals `assignments.unauthenticated` and `assignments.unauthorized` are removed at the callable layer because the shared helper now emits their canonical PDR-025 §17 counterparts (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`, `school-district-mismatch`, `district-unassigned`, `claim-state-mismatch`) and the callable-local role narrowing emits `role-forbidden`.

## 7. Tests added or updated

Each of the five colocated test files was updated in the same pattern:

- `platform/functions/src/assignments/assignments-create-draft.test.ts`. Adds a `mockRequireDistrictContext` jest mock exported through the `../shared` mock. Simplifies `makeRequest` because the token payload is no longer read by the callable. Adds explicit tests for the six canonical district refusals that propagate through the shared helper (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`, `school-district-mismatch`, `district-unassigned`) and two callable-local `role-forbidden` refusals (student caller and platform administrator caller). Every prior assertion for request validation, class-ownership resolution, cross-school and cross-teacher refusal, canonical write, audit emission ordering, and downstream failure propagation is preserved. Prior authentication and role tests that expected `assignments.unauthenticated` and `assignments.unauthorized` are replaced by the eight canonical-district-error tests above.
- `platform/functions/src/assignments/assignments-update-draft.test.ts`. Same mock introduction. Adds tests for four canonical district refusals (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`) and two `role-forbidden` refusals (student and platform administrator). Every prior assertion for draft-state precondition, field-update contract, ownership refusal, idempotent replay, canonical write, and audit emission is preserved.
- `platform/functions/src/assignments/assignments-publish.test.ts`. Same mock introduction. Adds tests for four canonical district refusals and two `role-forbidden` refusals. Every prior assertion for draft to published transition, ownership refusal, canonical write, and audit emission is preserved.
- `platform/functions/src/assignments/assignments-close.test.ts`. Same mock introduction. Adds tests for four canonical district refusals and two `role-forbidden` refusals. Every prior assertion for published to closed transition, ownership refusal, canonical write, and audit emission is preserved.
- `platform/functions/src/assignments/assignments-archive.test.ts`. Same mock introduction. Adds tests for four canonical district refusals and two `role-forbidden` refusals. Every prior assertion for archive terminal transition, ownership refusal, canonical write, and audit emission is preserved.

## 8. Full validation results

- Lint clean: `npm run lint` reports zero errors and zero warnings.
- Typecheck clean: `npm run typecheck` reports zero errors.
- Build clean: `npm run build` completes without diagnostics.
- Full Jest suite: `npm test` reports 24 test suites passed and 407 tests passed.
- `git diff --check` reports no whitespace errors.

```
Test Suites: 24 passed, 24 total
Tests:       407 passed, 407 total
```

The pre-slice baseline was 24 suites and 380 tests; the delta is 27 net new tests distributed across the five assignment test files (approximately eight new tests for `assignments-create-draft.test.ts` and roughly six new tests each for the other four, offset by the prior authentication and role tests that were replaced).

## 9. Scope confirmation

- Firestore Rules were not modified. `platform/firebase/firestore.rules` is unchanged.
- Firestore indexes were not modified. `platform/firebase/firestore.indexes.json` is unchanged.
- No app code under `app/**` was modified.
- No LMS integration file, submissions callable, enrollments callable, classes callable, assessment pipeline file, or display-name path file was modified.
- No Firestore document shape and no collection schema was changed. `AssignmentRecord` in `platform/functions/src/shared/types/` is unchanged. The five `assignments/*` callables still write exactly the same canonical fields to `assignments/{assignmentId}` they wrote before this slice.
- No audit event vocabulary was introduced. The `assignments.created`, `assignments.updated`, `assignments.published`, `assignments.closed`, and `assignments.archived` events are emitted exactly as before, with unchanged `payload` structures.
- Assignment lifecycle behavior is preserved: the four canonical statuses (`draft`, `published`, `closed`, `archived`), the allowed-transitions table, the ownership rules, the idempotent response contracts, and the terminal-status conflict semantics are unchanged.
- No architecture document, PDR, contract, certification report, or prior completion report was modified. Only the new Slice 4 completion report and the SPRINT_HISTORY append are added.
- No callable outside of `assignments/*` was modified in this slice.
- No new district error identifier was introduced. Every refusal on the five callables uses an identifier that already existed in either the PDR-025 §17 closed set or the callable's own pre-existing `assignments.*` namespace.
- The shared writer contract in `platform/functions/src/shared/auth/claims.ts` is unchanged. The shared helper in `platform/functions/src/shared/auth/require-district-context.ts` is unchanged.
- The `classes/*` callables migrated in Slice 2 and the `enrollments/*` callables migrated in Slice 3 were not touched.
- No later Sprint 11 slice was started.

## 10. Deferred work

The following remain intentionally deferred and are out of scope for Slice 4:

- Persisting `districtId` onto `assignments/{assignmentId}` documents or emitting it on assignment audit events.
- Migration of the `submissions/*` callables to the shared helper.
- Migration of every `lms/*` callable to the shared helper.
- Migration of every trigger under `auth/*`.
- PDR-025 Rules invariants at the Firestore-Rules layer.
- PDR-025 stale-claim handling and app-side reconciliation.
- PDR-026, PDR-027, and PDR-028 implementation.

Broad platform-wide migration remains explicitly out of scope. Later slices in the Sprint 11A recommended sequence are deferred.

## 11. Separate note: CI lint correction in `require-district-context.test.ts`

Independent of Slice 4, `platform/functions/src/shared/auth/require-district-context.test.ts` was modified to satisfy a CI lint diagnostic. The correction is editorial and does not change any test behavior. Two changes were applied:

- The two local mocks `mockUserRecordDocRef` and `mockSchoolDocRef` are now typed as `jest.Mock` and no longer declare unused named parameters (`_uid`, `_schoolId`). The lint rule that flagged the underscore-prefixed unused parameter as forbidden inside a jest mock factory is now satisfied.
- The two fixture helpers `userSnapshot` and `schoolSnapshot` no longer cast an empty object literal to `never` for the `createdAt` field. The `{} as never` cast is replaced by a plain `{}`, which is accepted by the same test-side type surface without the lint error the cast produced.

The change is a lint-only correction. No assertion, no scenario, no fixture data value, and no test count is changed by it. The Slice 4 assignment migration does not depend on this correction, and the correction does not touch any assignment file, any shared helper, or any production code.

## 12. Certification

Only Sprint 11B Slice 4 was implemented, plus the CI lint correction in `platform/functions/src/shared/auth/require-district-context.test.ts` documented in §11. Slices 5 through 20 of the Sprint 11A recommended sequence are intentionally deferred. No Firestore Rules were modified. No app code was modified. No new callable was introduced. No callable outside the five `assignments/*` handlers was modified. The Slice 1 activation callables, the Slice 2 `classes/*` callables, and the Slice 3 `enrollments/*` callables were not modified. No architecture, PDR, contract, or certification report was modified. All new and existing unit tests pass locally (24 suites, 407 tests). Lint, typecheck, and build are clean. `git diff --check` is clean. No em dash appears in any created or modified document. No commit was made.

---

## Change Log

- 2026-07-13 - Initial issuance under Sprint 11B Slice 4. No architecture contract was amended.
