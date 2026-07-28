# Sprint 23A Completion Report

Slice: 23A - Operational Foundation (Adapter Preparation)
Sprint: 23 - Google Classroom Integration
Date: 2026-07-28
Author: LyfeLabz platform assistant
Companion: `docs/platform/SPRINT_23_ARCHITECTURE_REVIEW.md`

---

## 1. Executive Summary

Sprint 23A prepared the Google Classroom adapter for activation
without shipping any live provider behavior. Two Google-package-local
seams (`GoogleClassroomTransport`, `GoogleClassroomConfig`) were
introduced, a deterministic in-memory fixture transport was created,
and a comprehensive test surface was added covering the seams, the
fixture, the adapter activation boundary, and the token-safety
invariants.

The production adapter continues to reject every operation defined
by the vendor-neutral `LmsProviderAdapter` interface with the stable
`lms.providerNotYetOperational` error. No vendor-neutral core code,
no callable contract, no Firestore collection, no security rule, and
no UX surface was modified. All existing validation gates
(`typecheck`, `lint`, `build`, `test` on `platform/functions`; the
full `verify` chain on `app`) pass without weakening or skipping any
existing test.

Sprint 23A is ready for certification review. Sprint 23B remains
gated on operational secret binding and the config seam's production
source decision.

## 2. Architecture Preserved

Confirmed unchanged by this slice:

- Vendor-neutral `LmsProviderAdapter` interface
  (`platform/functions/src/lms/providers/provider.ts`) - byte-for-byte
  unchanged.
- Adapter registry
  (`platform/functions/src/lms/providers/registry.ts`) - unchanged.
- LMS token-store interface and in-process default
  (`platform/functions/src/lms/tokens/token-store.ts`) - unchanged.
- All ten LMS callables and their exports
  (`platform/functions/src/lms/index.ts`, all handler files) -
  unchanged.
- All Firestore typed references
  (`platform/functions/src/shared/firestore/typed-ref.ts`) -
  unchanged.
- Assessment architecture (`assessmentRevisionId`, revisions, answer
  keys, `Attempts` immutability, scoring contract) - untouched.
- Assignment lifecycle - untouched.
- Classes and enrollments contracts - untouched.
- Teacher dashboard and student workflow - untouched.
- Firestore Rules and Firebase Security Model - untouched.

## 3. Exact Files Created

- `docs/platform/SPRINT_23_ARCHITECTURE_REVIEW.md`
- `docs/platform/SPRINT_23A_COMPLETION_REPORT.md` (this document)
- `platform/functions/src/lms/providers/google-classroom/transport.ts`
- `platform/functions/src/lms/providers/google-classroom/config.ts`
- `platform/functions/src/lms/providers/google-classroom/transport.test.ts`
- `platform/functions/src/lms/providers/google-classroom/config.test.ts`
- `platform/functions/src/lms/providers/google-classroom/adapter.test.ts`
- `platform/functions/src/lms/providers/google-classroom/token-safety.test.ts`
- `platform/functions/src/lms/providers/google-classroom/__fixtures__/fixture-transport.ts`
- `platform/functions/src/lms/providers/google-classroom/__fixtures__/fixture-transport.test.ts`

## 4. Exact Files Modified

- `docs/platform/LMS_INTEGRATION_OPERATIONS.md` - appended Appendix T
  ("Test and Emulator Fixture Injection (Sprint 23A)"), clearly
  labeled as TEST-ONLY. No production procedure altered.

No other files were modified.

## 5. Transport Contract

`GoogleClassroomTransport` (declared in
`platform/functions/src/lms/providers/google-classroom/transport.ts`)
supports exactly the operations the frozen provider contract
requires. Google Classroom REST v1 request and response shapes live
inside this file; no vendor-specific types leak into the
vendor-neutral core (`providers/provider.ts` remains
Google-agnostic).

Operations:

- `exchangeAuthorizationCode(...)` - authorization-code exchange
- `refreshAccessToken(...)` - access-token refresh
- `revokeToken(...)` - token revocation
- `listTeacherCourses(...)` - paginated teacher-course discovery
- `fetchCourse(...)` - single-course retrieval
- `listCourseStudents(...)` - paginated student retrieval
- `listCourseTopics(...)` - paginated topic retrieval
- `createCourseWork(...)` - coursework creation

Binding surface:

- `getGoogleClassroomTransport()` - resolver
- `setGoogleClassroomTransport(t)` - install (test-only in Sprint 23A;
  production binding is a Sprint 23B obligation)
- `withGoogleClassroomTransport(t, fn)` - scoped install/restore
- `resetGoogleClassroomTransportForTests()` - restore unbound default

Default binding: unbound. Any resolution throws a `PlatformError`
with `code = "lms.googleClassroomTransportUnbound"`.

## 6. Configuration Approach

Sprint 23A adopted the getter/setter seam pattern (Option B in
`SPRINT_23_ARCHITECTURE_REVIEW.md` §7), matching the existing
`LmsTokenStore` convention already blessed by the certified
architecture. The repository had no prior use of
`firebase-functions/params`, no use of the deprecated
`functions.config()`, and no `process.env`-driven config in
`platform/functions/src`.

Declared in
`platform/functions/src/lms/providers/google-classroom/config.ts`:

```ts
type GoogleClassroomConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
};
```

Binding surface:

- `getGoogleClassroomConfig()` - resolver (throws
  `lms.googleClassroomConfigUnbound` when unbound)
- `setGoogleClassroomConfig(c)` - install (test-only in Sprint 23A)
- `withGoogleClassroomConfig(c, fn)` - scoped install/restore
- `resetGoogleClassroomConfigForTests()` - restore unbound default

Sprint 23B will replace the default binding with a Firebase-native
source (Secret Manager for `clientSecret`, typed parameters for the
non-secret values). No secret was committed, logged, returned to
clients, placed in fixture files, or stored in Firestore.

## 7. Fixture Inventory

`createFixtureGoogleClassroomTransport(options?)` in
`__fixtures__/fixture-transport.ts` provides an in-memory transport
covering:

- authorization-code exchange success and configurable failure
  (`authorization-failure`, `rate-limited`, `temporary-unavailable`,
  `malformed`)
- access-token refresh success and configurable failure
- token revocation (idempotent, records revoked tokens)
- paginated teacher-course discovery (page size 2, deterministic
  numeric page tokens over 3 fixture courses)
- single-course retrieval (owned + a foreign-owned course for
  ownership-check tests)
- paginated student retrieval (page size 2 over a 3-student roster,
  1-student roster, and empty roster)
- paginated topic retrieval (uses the REST v1 `topic` field name)
- coursework creation (idempotent under repeated calls with the same
  LyfeLabz link within a single fixture instance)
- malformed-payload injection
- upstream authorization failure injection
- upstream rate-limit / temporary-service failure injection

Every identifier, name, and token is fictional. Verified guard: the
`assertNoSecretIn` helper in `token-safety.test.ts` fails the test
suite if any fixture secret leaks into an error message or callable
response.

## 8. Security and Token-Handling Evidence

Sprint 23A ships no live adapter behavior, so no callable can write
Google-sourced token material into Firestore or return it to any
client. The following invariants are additionally proven by
`token-safety.test.ts`:

- Fixture access tokens
  (`fixture-access-token-xxxxxxxx`), refreshed access tokens
  (`fixture-access-token-refreshed-yyyyyyyy`), refresh tokens
  (`fixture-refresh-token-zzzzzzzz`), authorization codes
  (`fixture-auth-code-alpha`), and the fixture client secret
  (`fixture-oauth-client-secret-never-real`) never appear in any
  `PlatformError.message` returned by the adapter or the seams.
- `translateThrown` coerces a `providerNotYetOperational`
  `PlatformError` into an `HttpsError` whose `message` and `details`
  carry no token material.
- The transport unbound error and the config unbound error carry no
  token or secret material.
- `withGoogleClassroomConfig` scopes the client secret to a single
  block: on failure the prior binding is restored.
- No core LMS module (adapter, provider, registry, callables)
  imports the Sprint 23A seams. This is enforced by a walk over
  `src/lms/**` that runs on every test invocation.

## 9. OAuth Scope Decision

Preserved exactly as declared in
`providers/google-classroom/adapter.ts`:

- Initial scopes (requested at connection time):
  - `https://www.googleapis.com/auth/classroom.courses.readonly`
  - `https://www.googleapis.com/auth/classroom.rosters.readonly`
- Publication scopes (deferred incremental consent, not requested
  during initial connection):
  - `https://www.googleapis.com/auth/classroom.coursework.me`
  - `https://www.googleapis.com/auth/classroom.topics.readonly`

Explicitly rejected in Sprint 23A: Google profile-email
(`classroom.profile.emails`) and profile-photo
(`classroom.profile.photos`) scopes. The frozen LyfeLabz enrollment
model does not require Classroom-supplied student emails: `userProfile.email`
is populated only from Firebase Auth at user provisioning (see
`platform/functions/src/shared/types/user.ts` and
`platform/functions/src/enrollments/resolve-roster-display-name.ts`).
The fixture transport's student payloads intentionally omit email and
photo fields; a runtime guard in `fixture-transport.test.ts` fails if
those fields are ever added back without an accompanying type change
that a reviewer will see.

## 10. Tests Added

Six new test files, all under
`platform/functions/src/lms/providers/google-classroom/`:

- `transport.test.ts` (5 cases) - transport seam binding lifecycle,
  unbound-default throw, restore-on-failure guarantee
- `config.test.ts` (5 cases) - config seam binding lifecycle
- `__fixtures__/fixture-transport.test.ts` (18 cases) - every
  fixture behavior enumerated in the Sprint 23A specification §3
- `adapter.test.ts` (17 cases) - production adapter still rejects
  every operation with `lms.providerNotYetOperational`, both before
  and after the seams are installed; adapter identity preserved;
  static-analysis check that the adapter source does not import the
  seams
- `token-safety.test.ts` (8 cases) - token, code, and secret leakage
  invariants; guard that no core LMS module imports the seams

## 11. Full Validation Results

Executed 2026-07-28 from the repository working tree.

### 11.1 `platform/functions`

Command: `npm --prefix platform/functions run typecheck`
Result: **PASS** (`tsc --noEmit`, zero errors)

Command: `npm --prefix platform/functions run lint`
Result: **PASS** (`eslint --ext .ts src`, zero errors, zero warnings)

Command: `npm --prefix platform/functions run build`
Result: **PASS** (`tsc -p tsconfig.build.json`, zero errors)

Command: `npm --prefix platform/functions test`
Result: **PASS**
- Test Suites: **51 passed, 51 total** (up from 45 before Sprint 23A
  by the six new suites added in §10)
- Tests: **1029 passed, 1029 total**
- Snapshots: 0 total
- Time: 3.3 s

### 11.2 `app`

Command: `npm --prefix app run verify`
(which runs `curriculum:verify && lessons:verify && typecheck && lint && test`)
Result: **PASS**
- Test Suites: **40 passed, 40 total**
- Tests: **754 passed, 754 total**
- Snapshots: 0 total
- Time: 6.9 s

No existing test was weakened, skipped, rewritten, or deleted.

## 12. Regression Assessment

- Callable names and exports: unchanged (`platform/functions/src/index.ts`
  and `platform/functions/src/lms/index.ts` untouched).
- Firestore collection names: unchanged (`LMS_PROVIDERS_COLLECTION`,
  `LMS_CONNECTIONS_COLLECTION`, `LMS_CLASS_LINKS_COLLECTION`,
  `LMS_ASSIGNMENT_PUBLICATIONS_COLLECTION` untouched).
- Firestore Rules: unchanged (no rules file was edited).
- `assessmentRevisionId`, assessment revisions, immutable `Attempts`:
  untouched.
- Assignment lifecycle: untouched.
- Teacher dashboard behavior: unchanged (no app-side edits;
  `app` verify passes).
- Student workflow: unchanged.
- Existing class and enrollment contracts: untouched.
- Existing 1029 platform tests + 754 app tests all pass.

## 13. Deferred Work (23B through 23E)

Sprint 23B - Adapter activation for connect and discovery:

- Replace the unbound transport default with a real HTTPS transport.
- Select and wire the production `GoogleClassroomConfig` source
  (Secret Manager for `clientSecret`, typed parameters for the
  non-secret values).
- Bind a production `LmsTokenStore` (Secret-Manager-backed or
  approved equivalent) via `setLmsTokenStore` at cold start.
- Activate `beginOAuth`, `completeOAuth`, `revokeGrant`,
  `listTeacherClasses`, `fetchClass` in the adapter.
- Certify against a Google Classroom test instance.

Sprint 23C - Roster synchronization activation:

- Decide whether to add a `listClassStudents` method to the
  vendor-neutral `LmsProviderAdapter` interface. If added, raise as
  the Stop Condition it triggers and update the certified
  architecture accordingly.
- Wire the Google-package `listCourseStudents` transport into the
  existing `lmsClassesRefresh` callable.
- Reconcile enrollment writes against the frozen enrollment model
  without introducing Classroom-supplied emails or photos.

Sprint 23D - Publication activation:

- Incremental consent for `GOOGLE_CLASSROOM_PUBLICATION_SCOPES`.
- Activate `listClassTopics` and `publishAssignment`.
- End-to-end assignment-publication test against the Classroom test
  instance.

Sprint 23E - Sprint 23 final certification:

- End-to-end validation, regression assessment, and final
  certification report.

## 14. Known Risks

- **Transport shape drift in 23B.** Google Classroom REST v1
  responses may vary (optional fields, pagination edges, error
  envelopes) from the fixture assumptions. Mitigation: fixtures
  reflect documented v1 shapes; the adapter is the single boundary
  that maps upstream errors to `PlatformError` before returning.
- **Secret-source selection in 23B.** The config seam defers the
  actual source choice. If Secret Manager is not chosen, the
  reviewer must confirm the alternative is server-only, durable, and
  documented in `LMS_INTEGRATION_OPERATIONS.md`.
- **Roster method interface change in 23C.** Adding
  `listClassStudents` to `LmsProviderAdapter` will modify the
  vendor-neutral core, which is a Stop Condition. Sprint 23C must
  raise this explicitly before any code lands.
- **`LmsTokenStore` production binding.** The in-process default is
  not production-safe. Sprint 23B must replace it before any live
  provider call is made.

## 15. Certification Decision

**Recommendation: Certify Sprint 23A as complete.**

- Every deliverable specified in the Sprint 23A prompt is present.
- Every stop condition was respected.
- Every validation gate ran green without weakening any existing
  test.
- No production behavior changed.
- The production adapter still rejects every operation with the
  existing stable error contract.

Awaiting explicit authorization before committing this slice or
beginning Sprint 23B.

*End of Sprint 23A Completion Report.*
