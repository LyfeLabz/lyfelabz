# LyfeLabz Sprint 3 Completion Report

**Sprint:** Sprint 3, Teacher Platform Foundation
**Dates:** 2026-07-08 to 2026-07-09
**Status:** Complete, pending engineering review
**Companion documents:** SPRINT_3_STEP_1_SPECIFICATION.md, SPRINT_3_STEP_2_SPECIFICATION.md, SPRINT_3_STEP_3_SPECIFICATION.md, SPRINT_3_STEP_4_SPECIFICATION.md, SPRINT_3_STEP_5_SPECIFICATION.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, PLATFORM_STATE_MACHINE.md, SPRINT_2_COMPLETION_REPORT.md, SPRINT_HISTORY.md

---

## 1. Executive Summary

Sprint 3 delivered the first authenticated client surface on top of the Sprint 2 identity trust layer. It carried the Sprint 2 callables and Firestore Rules into a real browser through a minimum-viable Firebase Hosting scaffold, a Canonical Session Bootstrap that produces an Immutable Session Object, a protected router that dispatches by Session kind, a teacher entry experience that walks a caller from Google sign-in through provisioning and verification request into a pending state, and a Teacher Platform Shell that hosts the approved teacher's authenticated home.

Sprint 3 introduced no new lifecycle state, no new claim, no new Cloud Function, no new Firestore collection, and no new Firestore Rule. Every Sprint 2 architectural guarantee is preserved. Sprint 3 remains emulator-only. The instructional repository at the repository root was not modified.

---

## 2. Sprint Objectives

- Convert the Sprint 2 trusted-server identity model into a browser-reachable experience under a distinct `/app/**` path prefix, without disturbing the anonymous instructional site served from the repository root.
- Establish the single client-side procedure - the Canonical Session Bootstrap - that reads Firebase Authentication, custom claims, and `users/{uid}` exactly once and returns an Immutable Session Object.
- Route callers deterministically by Session kind, with fail-closed behavior on every error and drift path.
- Provide the entry experience for teachers: signed-out sign-in, provisioned onboarding role picker, teacher verification request, and pending-verification waiting screen.
- Provide the permanent home layout - the Teacher Platform Shell - for approved teachers, without introducing any classroom, roster, assignment, analytics, or administrator UI.
- Align the Firebase project on the canonical `lyfelabz-platform` project identifier.

---

## 3. Architecture Decisions

Sprint 3 implements the decisions recorded in the five Sprint 3 step specifications and the Step 1A amendments to `LYFELABZ_PLATFORM_ARCHITECTURE.md` and `LYFELABZ_FIREBASE_SECURITY_MODEL.md`.

- **`/app/**` is the sole authenticated path prefix.** All authenticated UI lives under `/app/**` on Firebase Hosting. Every other path continues to serve the anonymous instructional repository at the repository root. The Hosting rewrite is single: `/app/**` -> `/app/index.html`, so a future client-side router owns the whole prefix.
- **Canonical Session Bootstrap is the single client-side derivation path.** No route surface derives lifecycle, role, or school from any other source. The bootstrap performs at most one Firestore self-read of `users/{uid}`, at most one `get` of `schools/{schoolId}` (only when required), and at most one forced ID token refresh. It performs no client writes.
- **Immutable Session Object.** The bootstrap output is a frozen discriminated union with one `kind` per state. All fields are `readonly`. Any state change is realized by re-running the bootstrap, never by mutating the current session.
- **Fail closed.** Any error, drift between claims and record, missing record, malformed record, or network unavailability resolves to a session kind that denies protected surfaces.
- **Firestore is authoritative for lifecycle state.** Claims answer "may this caller do X"; the Firestore record answers "where is this account in the platform". On disagreement, the record wins.
- **No new rules.** Every client read Sprint 3 needs is already authorized by the Sprint 2 rules (`users/{uid}` self get and `schools/{schoolId}` authenticated get).
- **No new callable.** The client invokes only the Sprint 2 callables (`teachersRequestVerification` and, on the administrator surface stub, `teachersApproveVerification` in tests). Sprint 3 wires no new Cloud Function.
- **Canonical Firebase project.** The default Firebase project identifier is `lyfelabz-platform`. This is the single project name used by the Emulator Suite, the Hosting scaffold, and all future deployment steps.

---

## 4. Completed Implementation Steps

### 4.1 Step 1 - Architecture review

A full read of the Sprint 2 identity trust layer, the Platform State Machine, the Firestore Data Model, the Firebase Security Model, and the Cloud Function Charter was performed. The Sprint 3 scope was narrowed to a minimum-viable authenticated shell that exercises the Sprint 2 callables end to end without introducing any new lifecycle state, claim, or collection. Non-goals were fixed in writing: no classroom model, no enrollment model, no assignment model, no gradebook, no analytics, no administrator dashboard, no verified-domain storage.

### 4.2 Step 1A - Platform architecture amendments

`LYFELABZ_PLATFORM_ARCHITECTURE.md` and `LYFELABZ_FIREBASE_SECURITY_MODEL.md` were amended to record two narrow additions:

- `/app/**` is introduced as the first authenticated Hosting surface. The anonymous instructional repository continues to serve from the repository root without a client bundle dependency.
- The Firebase Security Model records that the client's session bootstrap performs exactly one self-read of `users/{uid}` and one `get` of `schools/{schoolId}` when required, and that no client `list` or cross-user read is authorized in Sprint 3.

No amendment to `PLATFORM_STATE_MACHINE.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, or `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` was required, since Sprint 3 introduces no new state, no new field, and no new function.

### 4.3 Step 2 - Hosting scaffold

Firebase Hosting was added to `platform/firebase/firebase.json`:

- `public` resolves from `platform/firebase/` to the repository root (`../..`), preserving flat-root URLs for every existing lesson.
- Standard ignores plus `platform/**`, `docs/**`, and `blog/**` keep engineering trees out of the deployed surface.
- A single rewrite maps `/app/**` -> `/app/index.html`.

A placeholder `app/index.html` was created rendering only the plain text `LyfeLabz Platform`. No Firebase SDK was loaded and no client-side script was included at this step. Local verification confirmed that a request under `/app/**` reached the placeholder while every existing lesson URL continued to serve unchanged.

### 4.4 Step 3 - Canonical Session Bootstrap

The `app/` package was established as a TypeScript client bundle (`@lyfelabz/app`) built with esbuild, typechecked with `tsc`, linted with ESLint, and unit-tested with Jest under a JSDOM environment. The bundle depends on the modular Firebase SDK (Auth and Firestore imports only).

Client bundle files created:

- `app/src/firebase.ts` - single Firebase App initialization module. Exports the initialized `Auth` and `Firestore` instances. No other module calls `initializeApp`.
- `app/src/session/types.ts` - the Canonical Session Object union, `Role` and `UserStatus` unions, the narrow `UserRecordRead` read shape, the `CanonicalClaims` shape, and the seam interfaces (`BootstrapAuthInput`, `BootstrapFirestoreInput`, `BootstrapEnv`) that keep unit tests SDK-free.
- `app/src/session/user-record.ts` - a defensive parser that validates the Firestore payload against `UserRecordRead` and rejects malformed records.
- `app/src/session/consistency.ts` - the authorization consistency check between claims and the Firestore record, isolated for standalone unit testing.
- `app/src/session/bootstrap.ts` - the bootstrap function itself. Waits for `onAuthStateChanged`, forces at most one token refresh, reads `users/{uid}` under the caller's own credentials, cross-checks record and claims, and returns a frozen `Session`. Never throws to the caller: every failure path resolves to `{ kind: "error", reason }`.
- `app/src/router/router.ts` and `app/src/router/routes.ts` - the dispatch table that maps `Session["kind"]` to the route surface responsible for that kind. Step 3 shipped stub surfaces per kind rendering only the caller's display name and school name where available.
- `app/src/index.ts` - the client entry point. Waits for the bootstrap, hands the resulting Session to the router, and mounts the router into `app/index.html`.

Unit tests were authored alongside the source: `bootstrap.test.ts`, `consistency.test.ts`, `router.test.ts`. All tests use in-memory fakes for Auth and Firestore. No emulator dependency exists for unit tests.

### 4.5 Step 4 - Teacher authentication experience

Step 4 replaced the Step 3 stubs with a designed, accessible, minimal experience for every Session kind produced by the bootstrap:

- **Signed-out** (`unauthenticated`) - the teacher platform entry point. Presents the LyfeLabz teacher headline and a single Google sign-in action. A secondary link returns the caller to the public lessons.
- **Provisioned** - a role picker that collects displayName and dispatches to `teachersRequestVerification` (teacher path) or `studentsCompleteOnboarding` (student path). On success the router re-runs the bootstrap and re-dispatches to the next Session kind.
- **Pending verification** - a plain-language waiting screen for teachers who have submitted a verification request. Provides a manual "Check status" affordance backed by `refreshSession()`, and a persistent sign-out control. No polling.
- **Active student**, **suspended user**, **archived user**, **error** - minimal surfaces per Step 4 §7-§10. Each surface renders deterministically from the Session Object it receives and exposes sign-out where applicable.

Supporting modules created:

- `app/src/session/refreshSession.ts` - the single shared helper the router owns for re-running the bootstrap after a callable succeeds or a manual refresh is requested.
- `app/src/router/surfaces/index.ts` and `app/src/router/surfaces/shared.ts` - the route surfaces for each Session kind and the small shared helpers they consume.

Unit coverage was extended: `app/src/router/surfaces/surfaces.test.ts` asserts, per surface, that the correct copy renders, the correct control is offered, the correct callable is invoked, and that state changes route through `refreshSession()`.

### 4.6 Step 5 - Teacher Platform Shell

Step 5 replaced the Step 4 minimal `activeTeacher` surface with the permanent Teacher Platform Shell. Deliverables:

- `app/src/shell/shell.ts` - the three-region layout (header, main, footer) that hosts the Home surface today and every future teacher feature surface.
- `app/src/shell/header.ts` - the header composition, identity summary, and sign-out control.
- `app/src/shell/navigation.ts` - the shell navigation. Exactly one destination (Home) is enabled today. Classes, Students, Assignments, and Settings are visible non-actionable placeholders that clearly indicate a future destination.
- `app/src/shell/footer.ts` - the single low-visibility "LyfeLabz Teacher Platform" line.
- `app/src/shell/surfaces/home.ts` - the shell-scoped home surface that greets the teacher, states platform status, summarizes identity, and previews future capabilities via non-actionable placeholder cards.
- `app/src/shell/surfaces/shared/identityCard.ts`, `.../placeholderCard.ts`, `.../verificationPill.ts` - small presentational helpers.

`app/index.html` was updated to host the shell mount and the canonical LyfeLabz styling used by the shell.

Unit coverage for the shell was authored: `app/src/shell/shell.test.ts` asserts the shell's regions, identity display rules, navigation state, keyboard focus order, and sign-out wiring.

---

## 5. Deliverables in Detail

### 5.1 Firebase Hosting foundation

- `platform/firebase/firebase.json` carries the single `hosting` block that serves the repository root and rewrites `/app/**` -> `/app/index.html`.
- The anonymous instructional repository is unaffected. Every existing lesson URL continues to serve exactly as it does under the current GitHub Pages configuration.
- No redirects, headers, `cleanUrls`, or `trailingSlash` overrides were introduced.
- No production deployment was performed. Hosting is exercised only through the Emulator Suite.

### 5.2 Canonical Session Bootstrap

- Runs at most once per authenticated session.
- Composes exactly these inputs in exactly this order: Firebase Auth resolution -> optional forced token refresh -> custom claims read -> Firestore `users/{uid}` read -> authorization consistency check -> school context (when required) -> Session Object construction.
- Performs at most one Firestore read of the caller's own `users/{uid}` document.
- Performs no client writes, no direct claim mutation, and no callable invocation.
- Fails closed. Every error path (auth-init failure, unreadable record, missing record, invalid record shape, network unavailability) resolves to `{ kind: "error", reason }`.

### 5.3 Immutable Session Object

- Discriminated union with nine kinds: `unauthenticated`, `provisioned`, `pendingVerification`, `activeTeacher`, `activeStudent`, `activeAdministrator`, `suspendedUser`, `archivedUser`, `error`.
- Every field is `readonly`. The outer object is frozen after construction.
- No timestamp, claim, or token content is embedded in the object. Downstream surfaces re-derive as needed.
- Role is expressed by the discriminator on active kinds; the object carries no separate `role` field.

### 5.4 Protected routing

- `app/src/router/router.ts` maps `Session["kind"]` to a route surface.
- Every dispatch is a pure function of the Session Object.
- Route surfaces never read `window.location.search`, cookies, `localStorage`, or `sessionStorage` for lifecycle input.
- State transitions are realized by calling `refreshSession()`, which re-runs the bootstrap and lets the router re-dispatch.

### 5.5 Teacher onboarding

- Signed-out teachers reach the sign-in surface at `/app/`, sign in with Google, and are handed to `authOnUserCreate` on first sign-in.
- Provisioned teachers reach the role picker, submit displayName, and are dispatched to `teachersRequestVerification`.
- On callable success the router re-runs the bootstrap and dispatches to the next Session kind.

### 5.6 Teacher verification request

- The provisioned role picker is the sole client surface that invokes `teachersRequestVerification`.
- The callable is invoked exactly once per submission. Errors surface as inline retryable messages.
- On success, the record transitions to `pendingVerification` server-side and the client re-dispatches to the pending surface via `refreshSession()`.

### 5.7 Pending verification experience

- A plain-language waiting screen with a manual "Check status" affordance and a persistent sign-out control.
- No polling. The status check is user-initiated and drives a `refreshSession()` call.
- When the administrator approves the teacher (via the Sprint 2 callable), the next refresh re-dispatches the caller to the Teacher Platform Shell.

### 5.8 Teacher Platform Shell

- Permanent three-region layout (header, navigation, content, footer) that hosts the approved teacher's home.
- Home surface greets the teacher by displayName, states platform status, summarizes identity (displayName, email, school), and previews future capabilities via non-actionable placeholder cards.
- Navigation lists Home (active) and Classes, Students, Assignments, Settings as visible non-actionable placeholders.
- Reads only fields already on the `activeTeacher` Session Object. Emits zero Firestore reads and zero callable invocations on mount, on navigation, and on refresh.

### 5.9 Canonical Firebase project alignment

- `platform/firebase/.firebaserc` was aligned on the canonical project identifier `lyfelabz-platform`.
- Documentation touched in Step 5 (`LYFELABZ_EMULATOR_SUITE_GUIDE.md`, `LYFELABZ_FIREBASE_BUILD_CHECKLIST.md`) was updated to reference the canonical project identifier where a stale name was present.

### 5.10 End-to-end emulator verification

The full onboarding path was walked through the Emulator Suite from a real browser:

Google Authentication -> `authOnUserCreate` -> `users/{uid}` write with `status: "provisioned"` -> Canonical Session Bootstrap resolves `{ kind: "provisioned" }` -> role picker submits teacher onboarding -> `teachersRequestVerification` transitions the record to `pendingVerification` -> `refreshSession()` re-runs the bootstrap and dispatches to the pending surface -> direct callable invocation of `teachersApproveVerification` under a `platformAdministrator` claim transitions the record to `active` and writes canonical claims -> `refreshSession()` re-runs the bootstrap and dispatches to the Teacher Platform Shell.

---

## 6. Repository Validation Summary

The following checks were run and pass on the sprint's final commit:

| Check | Result |
|---|---|
| `app` typecheck | Pass |
| `app` lint | Pass |
| `app` tests (Jest, JSDOM) | 104 / 104 pass across 5 suites |
| `app` build (esbuild) | Pass |
| `platform/functions` build | Pass |
| `platform/functions` typecheck | Pass |
| `platform/functions` lint | Pass |
| `platform/functions` unit tests | 106 / 106 pass across 8 suites |
| Firestore Rules tests | 28 / 28 pass across 4 suites |
| Local emulator verification | Full onboarding walk succeeds |
| CI pipeline (`platform-ci.yml`) | Green |

---

## 7. Local Verification Summary

Local verification exercised the shipped surface from a real browser against the Emulator Suite:

1. Hosting served the placeholder `/app/` route after Step 2 and served the full client bundle after Step 3.
2. The anonymous instructional repository continued to serve unchanged at every existing lesson URL throughout Sprint 3.
3. A signed-out caller reached the sign-in surface, signed in with Google (against the Auth emulator), and observed `authOnUserCreate` write the expected `users/{uid}` record.
4. The Canonical Session Bootstrap resolved to `provisioned`, then `pendingVerification` after the role picker succeeded, then `activeTeacher` after direct administrator approval.
5. The Teacher Platform Shell rendered only after the caller passed the active-teacher gate, and its non-actionable placeholders correctly indicated future destinations without exposing any classroom, roster, or assignment functionality.
6. Every gate failure and error path routed the caller to a fail-closed surface without exposing protected content.

---

## 8. Known Deferred Work

Every item below is a deliberate deferral, not a defect.

- **Production deployment.** Sprint 3 remains emulator-only, per the standing Sprint 1 and Sprint 2 posture. A first production deploy is a separate decision that belongs in a dedicated deployment sprint.
- **Administrator dashboard.** `platformAdministrator` is exercised only by direct callable invocation. No administrator UI ships in Sprint 3.
- **Student surface.** The `activeStudent` route surface remains a minimal placeholder. Student features are out of Sprint 3 scope.
- **Classroom, roster, enrollment, assignment, submission, gradebook, and analytics UI.** All deferred. Sprint 3 delivers the gate, not the product.
- **Verified school domain storage and auto-verification (PDR-003).** Deferred, pending the school administration architecture.
- **Suspend, reinstate, archive workflows.** Reserved transitions in `PLATFORM_STATE_MACHINE.md`. Sprint 3 renders `suspendedUser` and `archivedUser` as deliberate refusal surfaces but does not implement the transitions themselves.
- **Automated end-to-end integration harness.** Sprint 3 verification is unit-test coverage on the client plus manual emulator walkthrough. A future sprint may add an integration harness that drives the full onboarding walk against a live emulator.
- **Continuous integration coverage for `app/`.** CI continues to gate `platform/functions` and Firestore Rules. Extending `platform-ci.yml` to include `app` typecheck, lint, test, and build is a natural follow-up.

---

## 9. Architectural Guarantees Preserved

Sprint 3 preserves every Sprint 2 guarantee:

- `status` on `users/{uid}` remains the sole lifecycle field.
- Firestore remains authoritative for lifecycle state.
- Audit events remain append-only, written exclusively through the canonical `writeAuditEvent` helper on the server side.
- Custom claims remain exactly `{ role, schoolId }`.
- The Immutable Session Object is the sole client-side derivation path for lifecycle-derived UI state.
- No new lifecycle state, no new claim, no new Cloud Function, no new Firestore collection, and no new Firestore Rule were introduced.
- No classroom, enrollment, assignment, or dashboard model was introduced.

---

## 10. Readiness Assessment

Sprint 3 is complete and internally consistent with:

- `LYFELABZ_PLATFORM_ARCHITECTURE.md` (as amended by Step 1A)
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md` (as amended by Step 1A)
- `LYFELABZ_FIRESTORE_DATA_MODEL.md`
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `PLATFORM_STATE_MACHINE.md`
- `SPRINT_3_STEP_1_SPECIFICATION.md` through `SPRINT_3_STEP_5_SPECIFICATION.md`

Sprint 4 may begin once this report and the accompanying certification are accepted by engineering review.

---

*End of report. No implementation code was modified by this document. No commits are produced by this document.*
