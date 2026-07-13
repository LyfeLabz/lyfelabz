# Sprint 11B Slice 1 Completion Report

**Status:** Completed. Slice 1 of the Sprint 11A implementation sequence.
**Date:** 2026-07-13
**Anchor decision:** PDR-025 District Security Boundary.
**Governs:** The shared district-context foundation that unblocks every downstream PDR-025 through PDR-028 implementation slice.

---

## 1. Purpose

Sprint 11B Slice 1 implements the first bounded slice identified by `SPRINT_11A_IMPLEMENTATION_INVENTORY.md` §13 and §14. The slice lands the smallest self-contained change that (a) extends the canonical custom-claims shape with `districtId`, (b) declares the closed-set district-boundary error identifier vocabulary from PDR-025 §17, and (c) introduces the shared `requireDistrictContext` authorization helper.

Because the certified claim type per PDR-025 §6 makes `districtId` unconditionally required, the two existing `writeCustomClaims` callers (`teachersApproveVerification`, `studentsCompleteOnboarding`) receive narrowly scoped mechanical updates that resolve and pass the canonical `districtId` from the server-side school record. No callable lifecycle is redesigned. No client-supplied district value is introduced. This keeps the TypeScript writer contract and the runtime writer contract in agreement; neither can accept a missing `districtId`.

The slice is scope-bounded: it changes only the shared module under `platform/functions/src/shared/**` and the two existing activation callables that already invoke `writeCustomClaims`. It does not modify Firestore Rules, the app, LMS integration, the assessment pipeline, the display-name path, indexes, or Firestore document shapes. No architecture document, PDR, contract, or certification report is modified.

## 2. Canonical authority used

- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (PDR-025) as the primary implementation authority. §6 canonical claim shape, §12 callable enforcement obligations, §15 stale-claim reconciliation, §17 error identifier vocabulary, and §20 implementation checklist items 1 and 2 are the load-bearing sections.
- `docs/platform/SPRINT_11A_IMPLEMENTATION_INVENTORY.md` §13 Slice 1 and §14 recommended Sprint 11B scope.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §2 canonical claim shape convention.
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §13 through §18 for teacher verification, student first-sign-in activation, and identity-family scoping (referenced but not modified).
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` for the rule-layer baseline that this shared helper unblocks.
- `docs/platform/PLATFORM_STATE_MACHINE.md` §1 for the closed `UserStatus` enumeration the helper compares against.
- `docs/platform/PLATFORM_CONTRACTS.md` for client-storage prohibitions inherited by the helper.

## 3. Files created

- `platform/functions/src/shared/errors/district-errors.ts`. Declares `DISTRICT_ERROR_IDS`, the discriminated `DistrictErrorId` union, and the `isDistrictErrorId` runtime guard. The identifiers are exactly the eleven names in PDR-025 §17 and are frozen in this closed set.
- `platform/functions/src/shared/auth/require-district-context.ts`. Declares the `DistrictContext` return shape, the `DistrictClaimToken` claim projection, and the `requireDistrictContext(request)` helper.
- `platform/functions/src/shared/auth/require-district-context.test.ts`. 34 colocated Jest unit tests.
- `docs/platform/SPRINT_11B_SLICE1_COMPLETION_REPORT.md`. This report.

## 4. Files modified

- `platform/functions/src/shared/auth/claims.ts`. Extends `CanonicalCustomClaims` with `districtId: string` (required, non-empty) and extends `WriteCustomClaimsInput` with `districtId: string` as strictly required at the TypeScript layer. The runtime writer continues to refuse a missing or empty value. `writeCustomClaims` writes the three-field canonical shape and returns it. Every previous invariant (single writer, `status === "active"` precondition, atomic replacement, `claims.notActive`, `claims.invalidUid`, `claims.invalidRole`, `claims.invalidSchoolId`, `claims.writeFailed`) is preserved. A new `claims.invalidDistrictId` refusal is introduced. The TypeScript type and the runtime contract agree.
- `platform/functions/src/shared/auth/claims.test.ts`. Pins the three-field canonical shape on the writer output, adds explicit missing-and-empty districtId refusal cases, and updates overwrite semantics assertions to include `districtId`.
- `platform/functions/src/shared/index.ts`. Barrel re-exports `requireDistrictContext`, `DistrictContext`, `DistrictClaimToken`, `DISTRICT_ERROR_IDS`, `DistrictErrorId`, and `isDistrictErrorId`.
- `platform/functions/src/teachers/teachers-approve-verification.ts`. Reads the target teacher's `schools/{schoolId}` document through the canonical typed reference and resolves `districtId` from the record. Refuses `school-district-mismatch` when the school document is missing or unreadable. Refuses `district-unassigned` when the resolved `districtId` is missing, empty, whitespace-only, or not a string. Passes the resolved `districtId` to `writeCustomClaims` in the canonical three-field shape. The callable authorization gate (Platform Administrator only), the target lookup and state guards, the idempotent short-circuit, the update-then-claims-then-audit ordering, and every existing refusal (`teachers.unauthenticated`, `teachers.unauthorized`, `teachers.invalidRequest`, `teachers.invalidTargetUid`, `teachers.userNotFound`, `teachers.invalidStatus`, `teachers.invalidTargetRole`, `teachers.invalidTargetSchoolId`) are preserved. The request payload does not accept a `districtId` field. No new district authorization enforcement is added to the callable.
- `platform/functions/src/students/students-complete-onboarding.ts`. Replaces the existence-only school probe with a canonical read of `schools/{schoolId}` that resolves `districtId`. Preserves the existing `students.schoolNotFound` behavior when the school document is missing. Refuses `district-unassigned` when the resolved `districtId` is missing, empty, whitespace-only, or not a string. Passes the resolved `districtId` to `writeCustomClaims` in the canonical three-field shape. The callable authorization gate, the request validation, the idempotent short-circuit, the update-then-claims-then-audit ordering, and every existing refusal (`students.unauthenticated`, `students.invalidRequest`, `students.invalidRole`, `students.invalidSchoolId`, `students.invalidDisplayName`, `students.userNotFound`, `students.invalidStatus`, `students.schoolNotFound`) are preserved. The request payload does not accept a `districtId` field. No new district authorization enforcement is added to the callable.
- `platform/functions/src/teachers/teachers-approve-verification.test.ts`. Mocks `schoolDocRef` alongside the existing user mock. Asserts that `writeCustomClaims` receives the resolved `districtId` in the canonical three-field shape. Adds refusal cases for a missing school document (`school-district-mismatch`) and for missing, empty, whitespace, and non-string school `districtId` (`district-unassigned`). Asserts that a client-supplied `districtId` on the request payload is ignored in favor of the server-resolved canonical value.
- `platform/functions/src/students/students-complete-onboarding.test.ts`. Extends the school snapshot fixture with `districtId`. Asserts that `writeCustomClaims` receives the resolved `districtId` in the canonical three-field shape. Adds refusal cases for missing, empty, whitespace, and non-string school `districtId` (`district-unassigned`). Asserts that a client-supplied `districtId` on the request payload is ignored in favor of the server-resolved canonical value.

## 5. District claims implemented

The canonical claim shape per PDR-025 §6 is now:

```
{
  role: "teacher" | "student" | "platformAdministrator",
  schoolId: string,
  districtId: string
}
```

All three values are enforced non-empty at write time. `writeCustomClaims` remains the single write path per Cloud Function Charter §2 and PDR-025 §6. The active-only precondition is preserved. The atomic replacement guarantee is preserved: the payload passed to `setCustomUserClaims` contains exactly `role`, `schoolId`, and `districtId`, so any prior extraneous claim fields are erased on write.

## 6. Error identifiers implemented

The closed set from PDR-025 §17 is declared in `platform/functions/src/shared/errors/district-errors.ts` and re-exported from the shared barrel:

- `unauthenticated`
- `account-inactive`
- `role-forbidden`
- `district-unassigned`
- `district-mismatch`
- `school-district-mismatch`
- `cross-district-reference`
- `claim-stale`
- `claim-state-mismatch`
- `server-only-field`
- `transfer-not-supported`

Names are canonical. No downstream callable may introduce a variant, alias, or additional identifier without a new PDR. `isDistrictErrorId` provides a runtime guard for tests and diagnostic surfaces that need to confirm an error code belongs to this closed set.

## 7. requireDistrictContext behavior

The helper implements exactly the responsibilities named in Sprint 11B scope item 3. On invocation with a `CallableRequest<unknown>`:

1. Verifies `request.auth.uid` is a non-empty string. Refuses `unauthenticated` when absent.
2. Reads `users/{uid}` through the canonical typed reference. Refuses `account-inactive` when the document does not exist, is unreadable, or has any non-`active` status.
3. Validates the record's `role` against the canonical `Role` union and `schoolId` as non-empty. Refuses `claim-state-mismatch` on a malformed record.
4. Reads `schools/{schoolId}` through the canonical typed reference. Refuses `school-district-mismatch` when the school document is missing or unreadable.
5. Resolves `districtId` from the school record. Refuses `district-unassigned` when the field is absent, empty, whitespace-only, or not a string.
6. Compares the caller's signed claim to the resolved values. Refuses `claim-stale` when any of `role`, `schoolId`, or `districtId` is missing, empty, or non-string on the token. Refuses `claim-state-mismatch` when the token role or schoolId disagrees with the record. Refuses `district-mismatch` when the token `districtId` disagrees with the resolved school district.
7. Returns `{ uid, role, schoolId, districtId }` on success.

The helper never mutates state, never emits audit events, never re-issues claims, and never performs role-scoped authorization. Callables that require these behaviors compose them separately per PDR-025 §12. The `district-mismatch` refusal message deliberately does not echo either the claimed district or the resolved district, per PDR-025 §17.

## 8. Unit test coverage

`platform/functions/src/shared/auth/require-district-context.test.ts` contains 34 tests grouped as follows:

- **Closed-set error identifier module** (3 tests): identifier order and content match PDR-025 §17, `isDistrictErrorId` recognizes every canonical identifier, and rejects non-canonical strings and non-string values.
- **Happy path** (2 tests): teacher context returned when caller, record, and claims agree; student context returned when every field agrees.
- **Authentication and account lifecycle** (7 tests): missing auth, empty uid, whitespace uid, missing user document, and every non-active status (`provisioned`, `pendingVerification`, `suspended`, `archived`).
- **Canonical record integrity** (4 tests): missing schoolId, whitespace schoolId, missing role, invalid role.
- **School and district resolution** (5 tests): missing school document, missing districtId, empty districtId, whitespace districtId, non-string districtId.
- **Claim vs record reconciliation** (8 tests): missing districtId claim, empty districtId claim, missing role claim, missing schoolId claim, token role vs record role mismatch, token schoolId vs record schoolId mismatch, token districtId vs resolved district mismatch, and non-leaking `district-mismatch` message.
- **Malformed data** (4 tests): undefined snapshot data on the user record, undefined snapshot data on the school record, non-string token role, non-string token districtId.

`platform/functions/src/shared/auth/claims.test.ts` was extended with three-field write shape assertions and two new refusal cases (missing districtId, empty and whitespace districtId), while every prior refusal case is preserved.

The `teachers-approve-verification.test.ts` and `students-complete-onboarding.test.ts` suites gained new assertions for canonical `districtId` resolution: the resolved value is written in the three-field claim shape, a client-supplied `districtId` on the request payload is ignored, and the certified error identifiers `school-district-mismatch` and `district-unassigned` are raised on the applicable failure paths. Every prior assertion in both suites is preserved.

Full Jest suite:

```
Test Suites: 24 passed, 24 total
Tests:       353 passed, 353 total
```

Pre-slice baseline was 23 suites and 310 tests; the delta is one new suite (34 helper tests) plus the extended claims, teachers, and students suites.

## 9. Scope confirmation

- Firestore Rules were not modified. `platform/firebase/firestore.rules` is unchanged.
- Firestore indexes were not modified. `platform/firebase/firestore.indexes.json` is unchanged.
- No app code under `app/**` was modified.
- No LMS integration file was modified. No assessment pipeline file was modified. No display-name path file was modified.
- No collection shape and no Firestore document shape was changed. The `UserRecord`, `SchoolRecord`, and every other type in `platform/functions/src/shared/types/*.ts` is unchanged.
- No audit event vocabulary was introduced. No callable emits any new audit event under this slice.
- No architecture document, PDR, contract, certification report, or completion report was modified.
- Callable lifecycle behavior is preserved. The two existing `writeCustomClaims` callers (`teachersApproveVerification` at `platform/functions/src/teachers/teachers-approve-verification.ts` and `studentsCompleteOnboarding` at `platform/functions/src/students/students-complete-onboarding.ts`) receive narrowly scoped mechanical updates only: each now resolves `districtId` from the canonical `schools/{schoolId}` record through the typed reference and passes it to `writeCustomClaims`. Neither is converted to `requireDistrictContext`, neither accepts a client-supplied `districtId`, neither has its callable authorization gate changed, and neither has any prior refusal, idempotency, or side-effect ordering altered. The certified district error vocabulary (`school-district-mismatch`, `district-unassigned`) from PDR-025 §17 is used at the resolution points; no new district error identifier was introduced.
- No later Sprint 11 slice was started.

## 10. Validation summary

- `npx jest --no-coverage` in `platform/functions/`: 353 tests across 24 suites, all passing.
- Type-check: `tsc` succeeds because every `writeCustomClaims` caller now passes the required `districtId`; `WriteCustomClaimsInput.districtId` is strictly required and the TypeScript and runtime contracts agree.
- Every file created or modified was reviewed for em dashes; none appear.
- Every unit test in `require-district-context.test.ts` was reviewed to confirm the assertion matches the specific PDR-025 §17 identifier expected for the case.
- The barrel re-exports were reviewed to confirm downstream slices can import the helper and the identifier module through `../shared` without reaching into subpaths.

## 11. Claim contract alignment note

PDR-025 §6 mandates a non-empty `districtId` on every canonical claim. The certified claim type must therefore require `districtId` unconditionally, and any writer whose runtime rejects a missing value must reject the same at the TypeScript layer. An optional-input transition on `WriteCustomClaimsInput.districtId` would allow the two existing `writeCustomClaims` callers to compile while failing at runtime; that mixed state was not acceptable and is not shipped.

Instead, the two existing callers receive the smallest architecture-conforming mechanical change required to resolve and pass the canonical `districtId`: each reads `schools/{schoolId}` through the canonical typed reference, refuses the certified district errors (`school-district-mismatch`, `district-unassigned`) on invalid data, and passes the resolved value to `writeCustomClaims`. Neither callable accepts a client-supplied district value. Neither has its lifecycle, its authorization gate, or its unrelated refusals redesigned. No new district authorization enforcement is added to these callables; the district ID is written into the canonical claims, and the shared `requireDistrictContext` helper remains the authorization surface downstream slices will adopt.

Downstream Slice 2 of the Sprint 11A sequence (§13 Slice 2 - PDR-025 activation callables adopt `requireDistrictContext`) remains the correct place for any broader lifecycle redesign of these callables and is intentionally deferred here.

## 12. Certification

Only Sprint 11B Slice 1 was implemented. Slices 2 through 20 of the Sprint 11A recommended sequence are intentionally deferred. No Firestore Rules were modified. No app code was modified. No callable lifecycle was redesigned. No client-supplied district ID was introduced. The district ID is resolved from canonical server-side records. The TypeScript type and the runtime writer contract agree. No architecture, PDR, contract, or certification report was modified. All new and existing unit tests pass locally. No commit was made.

---

## Change Log

- 2026-07-13 - Initial issuance under Sprint 11B Slice 1. No architecture contract was amended.
