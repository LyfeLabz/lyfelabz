# LyfeLabz Platform Sprint History

This document is the permanent engineering journal for the LyfeLabz platform. Each sprint appends a new section. Earlier sprints are not rewritten. When a decision made in an earlier sprint is later revisited, the revision is recorded in the sprint that made the change, not by editing history.

Companion documents:

- LYFELABZ_PLATFORM_ARCHITECTURE.md
- LYFELABZ_PLATFORM_DECISIONS.md
- LYFELABZ_ENGINEERING_STANDARDS.md

---

## Sprint 1: Firebase Foundation

**Dates:** 2026-07-07 to 2026-07-08
**Status:** Complete
**Detailed report:** SPRINT_1_COMPLETION_REPORT.md

### Objective

Initialize the Firebase infrastructure specified by Platform Architecture Version 1.0. Deliver a default-deny security baseline, a Cloud Functions scaffold, a single authentication provisioning trigger, an Emulator Suite configuration, an automated Firestore Rules test suite, and a continuous integration pipeline. Introduce no user-visible surface.

### Major accomplishments

- Provisioned the Firebase project on the Blaze plan under the LyfeLabz organizational account.
- Initialized the Firebase CLI under `platform/firebase/` with Firestore, Functions, Storage, Emulators, and a placeholder Hosting configuration.
- Established default-deny Firestore and Storage rules.
- Configured the Emulator Suite for Auth, Firestore, Functions, and Storage with the Emulator UI enabled.
- Scaffolded the Cloud Functions codebase with the full long-term domain structure and a `shared/` module of typed helpers, structured logging, and typed Firestore references.
- Implemented `authOnUserCreate` as the sole Cloud Function, writing a canonical provisioning record on user creation with idempotent semantics.
- Authored the Firestore Rules test suite that exercises the default-deny baseline against the Firestore emulator.
- Added `platform-ci.yml` as the continuous integration workflow, gating pull requests on lint, typecheck, build, and Rules tests.

### Important engineering decisions

- Default-deny as the baseline for all data access. Access is added only where a feature explicitly requires it.
- One canonical implementation per infrastructural concern.
- Typed Firestore reference builders so that Cloud Function code cannot silently drift from the data model.
- Structured logging that never influences trigger outcomes.
- Idempotent user provisioning: duplicate writes are treated as benign no-ops.
- Provisioning record is separate from an activated account. Role activation is a later sprint.
- No production deployments in Sprint 1. Emulator-only.
- Verification precedes commit. Each sprint step was verified locally before it was committed.
- Architecture-first: no implementation began until Platform Architecture Version 1.0 and the Engineering Standards were merged.

### Verification performed

- Emulator Suite starts cleanly with all Sprint 1 emulators available.
- Firestore Rules test suite passes against the emulator.
- `authOnUserCreate` produces the expected `users/{uid}` document under the emulator and handles re-invocation as a benign no-op.
- Cloud Functions TypeScript typechecks cleanly.
- Cloud Functions ESLint runs clean.
- Cloud Functions build produces the expected output.
- CI pipeline reproduces the local verification steps and passes on the sprint's final commit.

### Lessons learned

- Writing the Engineering Standards before any code paid off. Every subsequent step had a documented rule to appeal to.
- The Cloud Functions domain scaffold was worth building in full even though only one function was implemented. Future contributors will add functions into an existing structure rather than negotiate structure alongside features.
- Idempotent trigger semantics are easier to design at implementation time than to retrofit after a retry incident.
- Keeping Hosting configured but unused preserves a clean future path without any user-visible surface.

### Future dependencies created

Subsequent sprints inherit and depend on:

- The `platform/` engineering root.
- The default-deny rules baseline in both Firestore and Storage.
- The Cloud Functions domain scaffold under `platform/functions/src/`.
- The `shared/` module of typed helpers, structured logger, and platform error type.
- The `users/{uid}` provisioning contract established by `authOnUserCreate`.
- The Emulator Suite configuration and the local verification workflow it enables.
- The Firestore Rules test harness and its Jest configuration.
- The `platform-ci.yml` continuous integration pipeline.

### Repository state at sprint close

- `platform/firebase/` contains the canonical Firebase configuration and Rules test suite.
- `platform/functions/` contains the TypeScript Cloud Functions codebase and its build output.
- `.github/workflows/platform-ci.yml` is the active CI workflow.
- `docs/platform/` contains the architecture, decisions, standards, sprint specification, and completion report.
- The instructional repository at the repository root is untouched.

### Completed milestone

**Firebase foundation established.** Platform Architecture Version 1.0 has been carried into an initialized, verified, and CI-gated infrastructure. Sprint 2 may begin.

---

## Sprint 2: Onboarding and Teacher Verification

**Dates:** 2026-07-08
**Status:** Complete, pending engineering review
**Detailed report:** SPRINT_2_COMPLETION_REPORT.md

### Objective

Turn the Sprint 1 `users/{uid}` provisioning record into a fully activated identity for both students and teachers, through a documented onboarding flow, a teacher verification workflow, and the first narrowly-scoped Firestore Rules over the default-deny baseline. Emulator-only.

### Scope

- Canonical `UserRecord` shape aligned with the amended Data Model §3.1, plus transition-specific write shapes.
- Canonical `SchoolRecord` shape and typed reference.
- Canonical `writeCustomClaims` helper, enforcing the `{ role, schoolId }` shape and the active-only invariant.
- Canonical `writeAuditEvent` helper, enforcing the Sprint 2 audit vocabulary and the server-time invariant.
- `studentsCompleteOnboarding` callable, transitioning `provisioned` to `active` for students.
- `teachersRequestVerification` callable, transitioning `provisioned` to `pendingVerification` for teachers.
- `teachersApproveVerification` callable, transitioning `pendingVerification` to `active`, gated on `platformAdministrator`.
- `teachersDenyVerification` callable, transitioning `pendingVerification` back to `provisioned`, gated on `platformAdministrator`.
- Extension of `authOnUserCreate` to the amended Data Model §3.1, including `authUid` rename, `status: "provisioned"` at create, and the `auth.userProvisioned` audit event.
- First affirmative Firestore Rules for `users/{uid}` (self get, self update of `displayName` only), `schools/{schoolId}` (authenticated get, no writes), and `auditEvents/{eventId}` (explicit server-only).
- Rules tests and unit tests for every rule and function introduced.

### Commits

- `2d4e97b` Implement canonical user record shape and function tests
- `efb354a` Add canonical school shared types
- `3fa3bcb` Add canonical custom claims helper
- `8b488c9` Add canonical audit event helper
- `164cb25` Add student onboarding callable
- `705129e` Add teacher verification request callable
- `4766d56` Add first affirmative Firestore rules
- `d19011e` Add teacher verification approval callables
- `6cc1697` Add system audit event support for provisioning

### Important engineering decisions

- The `users/{uid}` document is the single canonical user record from provisioning onward. Additive writes grow the record through the lifecycle.
- The account lifecycle is defined in exactly one place: `PLATFORM_STATE_MACHINE.md`. No second lifecycle field is permitted on any document.
- Custom claims contain exactly `{ role, schoolId }`. `districtId` remains a documented reserved slot for the PDR-015 expansion path.
- Every audit write and every claims write flows through exactly one helper. No callable reaches Firestore or Auth outside typed refs and canonical helpers.
- Every callable orders side effects: user record update, then claims (when applicable), then audit event. Failures short-circuit before the next side effect.
- Every callable is idempotent. Replays of a completed transition return `alreadyActive` / `alreadyPending` / `alreadyProvisioned` and perform no writes.
- Firestore Rules are strictly additive to the default-deny baseline. Every new self-mutable field is a repository-level decision paired with a rules test.
- The provisioning trigger remains universal. Personal-account rejection is scoped to onboarding callables via the `auth.activationRejected` vocabulary.

### Verification performed

- `platform/functions` builds, typechecks, and lints cleanly.
- 106 Cloud Function unit tests pass across 8 suites.
- 28 Firestore Rules tests pass across 4 suites, driven by the Firestore emulator.
- The lifecycle pipeline (provisioned to active for students; provisioned to pendingVerification to active or provisioned for teachers) is exercised by unit and rules tests; every transition, audit event, claim, idempotency branch, and security boundary is asserted.
- CI (`platform-ci.yml`) remained green throughout the sprint.

### Lessons learned

- Naming the audit vocabulary as a closed TypeScript union up front made every downstream helper trivially safe. Callers cannot introduce a new action without touching the shared type.
- Separating read shape (`UserRecord`) from write shape per transition (`StudentActivationWrite`, `TeacherDenialWrite`, ...) made the `FieldValue.delete()` sentinel a first-class citizen without polluting the read type.
- Explicit `alreadyX` short-circuits at the top of every callable made idempotency provable rather than emergent.
- The `safeLog` wrapper established in Sprint 1 continued to pay off. Logger failures never became lifecycle failures.
- Writing the amended Data Model §3.1, §3.8 and the amended Cloud Function Charter §2 before implementing the helpers meant every downstream decision had a written rule to appeal to.

### Engineering improvements

- Added `shared/auth/admin.ts` as the single admin-SDK auth accessor, mirroring the `shared/firestore/admin.ts` pattern.
- Added typed-ref builders for `schools` and `auditEvents` so no Cloud Function reaches those collections through a string path.
- Introduced `ActorRole = Role | "system"` so triggers and callables share one audit vocabulary without leaking the `system` sentinel into user records or claims.
- Introduced a conditional-`schoolId` rule on the audit writer so the `auth.userProvisioned` event can legitimately omit `schoolId` while every user-actor event still requires it.

### Cumulative test counts

| Sprint | Rules tests | Function unit tests | Total |
|---|---|---|---|
| Sprint 1 | 4 (default-deny only) | (trigger covered by rules + emulator) | 4 |
| Sprint 2 | 28 | 106 | 134 |
| Cumulative (current) | 28 | 106 | **134** |

Sprint 1 rules tests are preserved as `default-deny.rules.test.ts` and are included in the current 28-test total.

### Future dependencies created

Subsequent sprints inherit and depend on:

- The canonical `UserRecord`, `SchoolRecord`, `AuditEventRecord` shapes.
- The canonical `writeCustomClaims` and `writeAuditEvent` helpers as the sole write paths.
- The `AuditAction` vocabulary and the `Role` / `UserStatus` unions.
- The first affirmative Firestore Rules and the self-update allowlist convention.
- The five-function callable surface: provisioning trigger plus student, teacher-request, admin-approve, admin-deny.
- The Sprint 2 side-effect ordering: user record, then claims (when applicable), then audit event.

### Repository state at sprint close

- The instructional repository remains untouched throughout Sprint 2.
- `platform/functions/` carries the five-function callable surface, the canonical shared helpers, and 106 unit tests.
- `platform/firebase/firestore.rules` carries the first affirmative rules over default-deny, backed by 28 rules tests.
- `docs/platform/` carries the Sprint 2 specification, the Platform State Machine, the Sprint 2 preview, the Sprint 2 completion report, and this history append.

### Completed milestone

**Identity trust layer established.** The full onboarding lifecycle - provisioning, student activation, teacher verification request, administrative approval, administrative denial - is implemented, tested, and internally consistent with the amended architecture. Sprint 3 may begin the client-facing onboarding surface.

---

## Sprint 3: Teacher Platform Foundation

**Dates:** 2026-07-08 to 2026-07-09
**Status:** Complete, pending engineering review
**Detailed report:** SPRINT_3_COMPLETION_REPORT.md
**Certification:** SPRINT_3_CERTIFICATION.md

### Objective

Carry the Sprint 2 identity trust layer into a real browser. Deliver a Firebase Hosting scaffold for a distinct `/app/**` client bundle, a Canonical Session Bootstrap that resolves an authenticated caller into an Immutable Session Object, a protected router that dispatches by Session kind, the teacher entry experience (signed-out sign-in through pending verification), and the permanent Teacher Platform Shell that hosts the approved teacher's authenticated home. Introduce no new lifecycle state, no new claim, no new Cloud Function, no new Firestore collection, and no new Firestore Rule. Emulator-only.

### Major deliverables

- Firebase Hosting scaffold in `platform/firebase/firebase.json`: repository root as `public`, a single rewrite mapping `/app/**` -> `/app/index.html`, and ignores that keep `platform/**`, `docs/**`, and `blog/**` out of the deployed surface.
- Placeholder `app/index.html` at Step 2 that established the `/app/**` prefix without loading any Firebase SDK.
- `app/` TypeScript client bundle (`@lyfelabz/app`) with esbuild build, `tsc` typecheck, ESLint lint, and Jest tests under JSDOM.
- Canonical Session Bootstrap (`app/src/session/bootstrap.ts`) with isolated authorization consistency check (`app/src/session/consistency.ts`), defensive user-record parser (`app/src/session/user-record.ts`), and shared `refreshSession()` helper.
- Immutable Session Object union in `app/src/session/types.ts` covering `unauthenticated`, `provisioned`, `pendingVerification`, `activeTeacher`, `activeStudent`, `activeAdministrator`, `suspendedUser`, `archivedUser`, and `error`.
- Protected router (`app/src/router/router.ts`) that dispatches by Session kind, with per-kind route surfaces under `app/src/router/surfaces/`.
- Teacher onboarding role picker and pending-verification surface wired to the Sprint 2 callables `teachersRequestVerification` and `studentsCompleteOnboarding`.
- Teacher Platform Shell (`app/src/shell/`) with header, navigation, home surface, and footer; placeholder navigation entries for Classes, Students, Assignments, and Settings.
- Canonical Firebase project alignment on `lyfelabz-platform` in `platform/firebase/.firebaserc`, with matching updates to `LYFELABZ_EMULATOR_SUITE_GUIDE.md` and `LYFELABZ_FIREBASE_BUILD_CHECKLIST.md` where the earlier name was referenced.
- Sprint 3 step specifications (Step 1 through Step 5) recorded under `docs/platform/`.

### Important engineering decisions

- `/app/**` is the sole authenticated Hosting surface. Every other path continues to serve the anonymous instructional repository.
- The Canonical Session Bootstrap is the sole client-side derivation path for lifecycle-derived UI state. No route surface derives lifecycle, role, or school from any other source.
- The Session Object is deep-frozen and immutable. State changes are realized by re-running the bootstrap, not by mutation.
- Firestore is authoritative for lifecycle state. On disagreement with claims, the record wins.
- Fail closed on every error or drift path.
- No new Firestore Rule was added. Sprint 3 relies entirely on the Sprint 2 self-get and authenticated-get rules.
- No new Cloud Function was added. The client invokes only Sprint 2 callables.
- No new lifecycle state, no new claim, no new collection.
- Emulator-only. No production deployment was performed.

### Commits

- `7292ef0` Sprint 3: establish teacher platform architecture and hosting foundation
- `e6ce0fe` Sprint 3: add canonical session bootstrap foundation
- `1e818da` Sprint 3: implement teacher platform entry experience
- `5777d2f` Sprint 3: implement teacher platform shell and complete onboarding flow

### Repository validation

- `app` typecheck clean.
- `app` lint clean.
- `app` tests: 104 pass across 5 suites.
- `app` build: esbuild produces `dist/bundle.js` cleanly.
- `platform/functions` build, typecheck, and lint clean.
- `platform/functions` unit tests: 106 pass across 8 suites.
- Firestore Rules tests: 28 pass across 4 suites.
- `platform-ci.yml` continued green through the sprint's commit series.

### Local verification

- Emulator Suite hosts the `/app/**` client bundle and continues to serve the anonymous instructional repository unchanged.
- End-to-end onboarding walkthrough verified from a real browser: Google sign-in -> `authOnUserCreate` -> provisioned onboarding role picker -> `teachersRequestVerification` -> pending verification screen -> direct `teachersApproveVerification` call under a `platformAdministrator` claim -> Teacher Platform Shell.
- Every gate failure and error path routed the caller to a fail-closed surface without exposing protected content.

### Certification summary

Sprint 3 is certified complete pending engineering review. Every Sprint 2 architectural guarantee is preserved. The identity trust layer now has a browser-reachable client surface through which the Sprint 2 callables have been exercised end to end under the Emulator Suite. Sprint 3 introduced no new lifecycle state, no new claim, no new Cloud Function, no new Firestore collection, no new Firestore Rule, no classroom model, no enrollment model, no assignment model, and no dashboard functionality.

### Completed milestone

**Teacher platform foundation established.** The `/app/**` authenticated shell is live under the Emulator Suite. The Canonical Session Bootstrap, the Immutable Session Object, the protected router, the teacher entry experience, and the Teacher Platform Shell together form the permanent home that every future teacher feature will live inside. Sprint 4 may begin the first teacher feature.

---

<!-- Append future sprints below this line using the same section structure. -->

## Sprint 4A - School Foundation (in progress)

**Dates:** 2026-07-09
**Status:** Implementation complete; awaiting Technical Lead review and local verification by Chris. No commit produced by Sprint 4A itself.
**Companion documents:** LYFELABZ_CLOUD_FUNCTION_CHARTER.md (Appendix A), LYFELABZ_FIRESTORE_DATA_MODEL.md §3.2, TEACHER_PLATFORM_DOMAIN_ROADMAP.md Phase 2.

### Scope delivered

Sprint 4A ships the first callable in the Schools domain and nothing else.

- Extended the canonical shared School types with `SchoolCreationWrite`, matching Data Model §3.2 with `createdAt` as a `FieldValue` at the write boundary and the read-side `SchoolRecord` unchanged.
- Extended the canonical typed-reference layer with `schoolCreationDocRef`, mirroring the existing `userDocRef` (write) versus `userRecordDocRef` (read) split.
- Extended the canonical `AuditAction` union with `schools.created` in exactly one place (`shared/types/audit-event.ts`) and extended the `writeAuditEvent` `VALID_ACTIONS` allowlist to match.
- Implemented `schoolsCreate` (`platform/functions/src/schools/schools-create.ts`), Platform Administrator-only, that validates the payload, creates a canonical `schools/{schoolId}` document via the typed reference, and emits exactly one `schools.created` audit event through the canonical `writeAuditEvent` helper. Idempotent under a client-supplied `schoolId`: an existing document whose canonical fields match returns `alreadyCreated: true`; a conflict returns `schools.conflict`.
- Registered `schoolsCreate` in `platform/functions/src/index.ts` and enumerated it in Cloud Function Charter Appendix A alongside the Sprint 2 callables.

Explicitly out of scope and not shipped in Sprint 4A:

- Any school update, archive, or resolution callable.
- Any administrator client surface inside `/app/**`.
- Any classroom, roster, enrollment, assignment, submission, gradebook, or analytics work.
- Any change to Firestore Rules, custom claims, lifecycle states, Session Bootstrap, Session types, router, Teacher Platform Shell, authentication flow, teacher verification flow, or student onboarding flow.

### Repository validation

- `platform/functions` typecheck clean.
- `platform/functions` lint clean.
- `platform/functions` build clean (`tsc -p tsconfig.build.json`).
- `platform/functions` unit tests: 128 pass across 9 suites (Sprint 3 baseline: 106 pass across 8 suites; +22 tests, +1 suite).
- `app` typecheck, lint, and unit tests (104 / 5) continue to pass; no `app/` file was modified in Sprint 4A.
- Firestore Rules tests: 28 pass across 4 suites; `firestore.rules` was not modified.

### Architectural guarantees preserved

- Firestore remains authoritative.
- `status` remains the only lifecycle field on `users/{uid}`; no lifecycle field was introduced on `schools/{schoolId}`.
- Audit events remain append-only and flow exclusively through `writeAuditEvent`. The canonical vocabulary grew by exactly one value (`schools.created`) in one file.
- Custom claims remain `{ role, schoolId }`; `districtId` remains reserved only. No new claim was introduced and no claim was written by `schoolsCreate`.
- Immutable Session Object, Session Bootstrap, router, Teacher Platform Shell, authentication flow, teacher verification flow, and student onboarding flow are unchanged.
- Firestore Rules remain unchanged. `schoolsCreate` writes through the Admin SDK, which bypasses Rules, so the existing `schools/{schoolId}` client contract (authenticated get, no list, no writes) continues to hold and the default-deny terminal rule is preserved.
- No new collection beyond the certified `schools` collection was introduced.

---

## Sprint 5B - Closed as Satisfied by Sprint 5A

**Date:** 2026-07-09
**Status:** Closed without code changes; awaiting Technical Lead review and local verification by Chris. No commit produced by Sprint 5B.
**Certification:** SPRINT_5B_CERTIFICATION.md

### Finding

A pre-implementation architecture review confirmed that the Sprint 5A commit (`28cd62b Sprint 5A: Implement Submission Foundation`) shipped the full server-side Submission Foundation - both `submissionsCreate` and `submissionsFinalize` - together with the Firestore Rules, canonical types, audit vocabulary (`submissions.created`, `submissions.finalized`), and tests that Sprint 5B was scoped to introduce. Every Sprint 5B invariant is already implemented and covered by tests.

Sprint 5B is closed as satisfied. No file affecting runtime, Rules, Cloud Functions, `/app/**`, or any deployment surface was modified.

### Files created or modified by Sprint 5B closure

- Created `docs/platform/SPRINT_5B_CERTIFICATION.md` (this closure record).
- Appended this section to `docs/platform/SPRINT_HISTORY.md`.

No other files were created, edited, renamed, or deleted.

### Architectural guarantees preserved

- Firestore remains authoritative.
- `status` remains the only lifecycle field on every domain document, including `submissions/{submissionId}` (values `submitted` and `finalized` per Data Model §3.7).
- Audit events remain append-only and flow exclusively through `writeAuditEvent`; the canonical vocabulary is unchanged by this closure.
- Custom claims remain `{ role, schoolId }`; `districtId` remains reserved only.
- Immutable Session Object, Session Bootstrap, router, Teacher Platform Shell, authentication flow, teacher verification flow, and student onboarding flow are unchanged.
- Firestore Rules remain unchanged from the Sprint 5A baseline. Client writes to `submissions/{submissionId}` remain denied; both submission callables write through the Admin SDK from the Cloud Function trust boundary.
- No new collection was introduced.

### Repository validation

Unchanged from the Sprint 5A baseline. Re-verified at closure time:

- `platform/functions` typecheck clean.
- `platform/functions` lint clean.
- `platform/functions` build clean (`tsc -p tsconfig.build.json`).
- `platform/functions` unit tests: **295 pass across 22 suites**.
- `platform/firebase` Rules tests: **94 pass across 8 suites** (driven by the Firestore emulator).
- `app` typecheck clean.
- `app` lint clean.
- `app` unit tests: **104 pass across 5 suites**.

### Recommendation

Proceed to Sprint 6 after Technical Lead review of `SPRINT_5B_CERTIFICATION.md` and local verification by Chris. No commit is recommended until both reviews are complete.

---

## Sprint 6A - Teacher Workspace Foundation

**Date:** 2026-07-09
**Status:** Implementation complete; awaiting Technical Lead review and local verification by Chris. No commit produced by Sprint 6A itself.
**Detailed report:** SPRINT_6A_COMPLETION_REPORT.md
**Specification:** SPRINT_6A_SPECIFICATION.md

### Scope delivered

Sprint 6A ships the client-side Teacher Workspace outlet foundation and nothing else.

- Introduced the typed `WorkspaceSurface` contract and the `WORKSPACE_SURFACES` registry keyed by the canonical `NavigationKey` union in `app/src/shell/surfaces/workspace.ts`.
- Added `mountWorkspaceOutlet`, which mounts exactly one `<section id="app-main" data-testid="workspace-outlet">` region and renders the registered surface for the requested active key.
- Refactored `mountTeacherShell` to render the Home surface through the outlet at `activeKey = "home"` instead of calling `renderHomeSurface` directly. The Home surface itself is unchanged and remains the only active workspace surface.
- Extracted and exported the `NavigationKey` type from `navigation.ts` so the contract and the navigation list share one canonical set of keys. The runtime navigation array and the disabled posture of every non-home item are unchanged.
- Added a shared, minimal "coming soon" renderer at `app/src/shell/surfaces/shared/emptyState.ts` used by the registered classes/students/assignments/settings surfaces. Unreachable through the shell in Sprint 6A because those navigation items remain disabled; present only for contract completeness.
- Extended `app/src/shell/shell.test.ts` with a `Workspace outlet (Sprint 6A)` block: outlet mounting, home rendering through the outlet, active-key advertisement, registry shape, contract totality, disabled-navigation no-op on active surface, and focus regression on the surface headline.

Explicitly out of scope and not shipped in Sprint 6A: live classes/students/assignments/settings surfaces, submissions review, analytics, grading, teacher feedback, student UI, administrator UI, new Cloud Functions, Firestore Rules changes, Firestore indexes, Storage Rules changes, teacher preferences documents, URL or history routing, deep links, nav persistence, new custom claims, and any change to the Immutable Session Object, Session Bootstrap, or protected router state machine.

### Architectural guarantees preserved

- Firestore remains authoritative; the outlet performs zero reads and opens zero listeners.
- All writes remain server mediated; the outlet issues no writes and invokes no callables.
- Firestore Rules remain default-deny and unchanged from the Sprint 5B baseline.
- `status` remains the sole lifecycle field; no lifecycle-adjacent state was introduced.
- Audit events remain append-only through `writeAuditEvent`; the canonical vocabulary is unchanged.
- The Immutable Session Object, Session Bootstrap, and protected router state machine are unchanged.
- Custom claims remain `{ role, schoolId }`; `districtId` remains reserved.
- No new backend behavior. `platform/functions/**`, `platform/firebase/firestore.rules`, and `platform/firebase/tests/**` were not modified.
- Navigation posture is preserved: `home` remains the only enabled item; every other item remains `disabled`, `aria-disabled="true"`, `tabindex="-1"`, with a `"Label - Coming soon"` label and a no-op click handler.

### Repository validation

- `app` typecheck clean.
- `app` lint clean.
- `app` build clean (esbuild).
- `app` unit tests: **111 pass across 5 suites** (Sprint 5B baseline: 104 / 5; +7 outlet tests, no suite added).
- `platform/functions` typecheck, lint, and build clean.
- `platform/functions` unit tests: **295 pass across 22 suites** (unchanged).
- `platform/firebase` Rules tests: **94 pass across 8 suites** (unchanged).

### Recommendation

Proceed to the first live non-home workspace surface after Technical Lead review of `SPRINT_6A_COMPLETION_REPORT.md` and local verification by Chris. No commit is recommended until both reviews are complete.

---

## Sprint 6B - Classroom Workspace (Read-Only)

**Dates:** 2026-07-09
**Status:** Implementation complete; awaiting Technical Lead review and local verification by Chris. No commit produced by Sprint 6B itself.
**Detailed report:** SPRINT_6B_COMPLETION_REPORT.md
**Specification:** SPRINT_6B_SPECIFICATION.md

### Objective

Activate the first live non-home workspace surface: a read-only Classroom Workspace inside the Teacher Platform Shell. Verified teachers can navigate from Home to Classes and see the classrooms they own, rendered from the certified `classes/{classId}` backend under the Sprint 4B teacher-owned list rule.

### Major accomplishments

- Introduced a client-side `ClassSummary` shape and a `ListClasses` seam at `app/src/classes/**`. The Firestore adapter `createFirestoreListClasses(db)` issues the certified-admissible `where("teacherId", "==", uid)` query and reads only the fields the workspace consumes (`title`, `grade`, `status`).
- Delivered `renderClassesSurface` (`app/src/shell/surfaces/classes.ts`): loading state, empty state, error state, and a keyboard-accessible read-only card grid with title, optional grade line, and status pill.
- Activated the Classes item in `NAVIGATION_ITEMS`. Home and Classes are now the enabled items; Students, Assignments, and Settings retain the Sprint 6A `"Label - Coming soon"` disabled posture.
- Added a mutable active-surface key inside `mountTeacherShell`. On Classes or Home selection the shell swaps the workspace outlet content, moves `aria-current="page"` to the newly active nav button, and lands focus on the surface headline.
- Wired the fetcher through the existing dependency-injection path: `SurfaceDeps.listClasses` → `ShellDeps.listClasses` → `WorkspaceDeps.listClasses` → `renderClassesSurface`. The shell continues to import no `firebase/*` module.

### Architecture posture

Sprint 6B introduces no new backend behavior.

- Firestore remains authoritative. The client read is admitted by the same Sprint 4B rule; no rule change was made.
- All writes remain server-mediated. The Classroom Workspace issues no writes and invokes no callables.
- `status` remains the sole lifecycle field; no lifecycle-adjacent state was introduced.
- Audit events remain append-only through `writeAuditEvent`; the canonical vocabulary is unchanged.
- The Immutable Session Object, Session Bootstrap, and protected router state machine are unchanged.
- Custom claims remain `{ role, schoolId }`; `districtId` remains reserved.
- No new Cloud Functions, no Firestore Rules changes, no Firestore indexes changes. `platform/functions/**`, `platform/firebase/firestore.rules`, `platform/firebase/firestore.indexes.json`, and `platform/firebase/tests/**` were not modified.
- Navigation posture for deferred items is preserved: Students, Assignments, and Settings remain `disabled`, `aria-disabled="true"`, `tabindex="-1"`, with a `"Label - Coming soon"` label and a no-op click handler.
- The shell no-Firebase-import invariant is preserved. The Firestore-touching module lives outside `app/src/shell/**` and is injected as a fetcher.

### Repository validation

- `app` typecheck clean.
- `app` lint clean.
- `app` build clean (esbuild).
- `app` unit tests: **120 pass across 5 suites** (Sprint 6A baseline: 111 / 5; +9 tests, no suite added).
- `platform/functions` typecheck, lint, and build clean.
- `platform/functions` unit tests: **295 pass across 22 suites** (unchanged).
- `platform/firebase` Rules tests: **94 pass across 8 suites** (unchanged).

### Recommendation

Proceed to the Enrollment or Roster surface after Technical Lead review of `SPRINT_6B_COMPLETION_REPORT.md` and local verification by Chris. No commit is recommended until both reviews are complete.

---

## Sprint 6C - Teacher Workspace Navigation Foundation

**Date:** 2026-07-09
**Status:** Implementation complete; awaiting Technical Lead review and local verification by Chris.
**Companion documents:** SPRINT_6C_SPECIFICATION.md, PRESENT_MODE_ARCHITECTURE.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, PHASE_2_ARCHITECTURE_PLANNING_REPORT.md.

### Objective

Replace the Sprint 6A/6B top-nav shape with the persistent left-side navigation panel defined in §3.3 of `TEACHER_EXPERIENCE_PHILOSOPHY.md`. Introduce the permanent teacher-workspace navigation identity: LYFELABZ, Curriculum, Classes, Present Mode, Settings. Rename the Sprint 6B Home surface to Curriculum as a copy-only change with a transitional status paragraph.

### Major accomplishments

- Introduced the persistent left-side navigation contract: LYFELABZ (brand item that activates the Curriculum surface), Curriculum (active), Classes (active), Present Mode (disabled coming-soon), Settings (disabled coming-soon).
- Added the `WorkspaceSurfaceKey` type (`curriculum | classes | present-mode | settings`) and the `NavigationItem` `variant` distinction (`brand | item`). The brand item never carries `aria-current` and dispatches to the Curriculum surface.
- Renamed the Sprint 6B Home surface to Curriculum. `app/src/shell/surfaces/home.ts` becomes `app/src/shell/surfaces/curriculum.ts`; `renderHomeSurface` becomes `renderCurriculumSurface`. Behavior is identical except that the transitional status paragraph now reads `"The curriculum landing arrives in a future sprint. New capabilities will appear here as they are released."`, mitigating the §11 risk called out in the Phase 2 Architecture Planning Report.
- Rewired the workspace registry: `WORKSPACE_SURFACES` now registers `curriculum`, `classes`, `present-mode`, and `settings`. The `home`, `students`, and `assignments` surface keys are removed.
- Set the default active surface on shell mount to `curriculum` in `mountTeacherShell`. Selecting LYFELABZ from any surface returns the outlet to Curriculum without double-mounting.
- Preserved the keyboard-accessible disabled contract for Present Mode and Settings: `disabled`, `aria-disabled="true"`, `tabindex="-1"`, `"Label - Coming soon"` copy, no dispatch on click.
- Preserved the responsive shell-body grid: 224px sidebar plus 1fr outlet above 720px, single-column with horizontally scrolling nav row below 720px, and touch-target minimums under `@media (pointer: coarse)`.
- Added a `PRESENT_MODE_ARCHITECTURE.md` architecture-only document. It defines Present Mode's purpose, entry, exit, security posture, privacy posture, prohibited data, filter behavior, grade persistence strategy, URL strategy, the reason Present Mode reuses the canonical LyfeLabz surface rather than duplicating it, and the deferred implementation-sprint decisions.
- Expanded `app/src/shell/shell.test.ts` to cover: the new nav item order and copy, the LYFELABZ brand posture, the Curriculum surface rename, the removed `home`/`students`/`assignments`/`reports` items, the disabled coming-soon contract for Present Mode and Settings, the `data-active-surface="curriculum"` default, the four-key `WORKSPACE_SURFACES` registry, and the LYFELABZ re-render behavior from both Curriculum and Classes.

### Architecture posture

Sprint 6C introduces no new backend behavior.

- Firestore remains authoritative. No client read change.
- All writes remain server-mediated. No callable is invoked by the navigation change.
- Firestore Rules remain default-deny. No rule change.
- `status` remains the sole lifecycle field.
- Audit events remain append-only through `writeAuditEvent`; vocabulary is unchanged.
- The Immutable Session Object, Session Bootstrap, and protected router state machine are unchanged.
- Custom claims remain `{ role, schoolId }`; `districtId` remains reserved.
- No new Cloud Functions, no Firestore Rules changes, no Firestore indexes changes, no Storage Rules changes. `platform/functions/**`, `platform/firebase/firestore.rules`, `platform/firebase/firestore.indexes.json`, `platform/firebase/storage.rules`, and `platform/firebase/tests/**` were not modified.
- The shell no-Firebase-import invariant is preserved. The static-source assertion in `shell.test.ts` continues to guard it.
- Preservation mode remains intact. No file at the repository root is modified.

### Repository validation

- `app` typecheck clean.
- `app` lint clean.
- `app` build clean (esbuild).
- `app` unit tests: **125 pass across 5 suites** (Sprint 6B baseline: 120 / 5; +5 tests, no suite added).
- `platform/functions` typecheck, lint, and build clean.
- `platform/functions` unit tests: **295 pass across 22 suites** (unchanged).
- `platform/firebase` Rules tests: **94 pass across 8 suites** (unchanged).

### Recommendation

Proceed to Sprint 6D (Curriculum Landing bridge) after Technical Lead review of `SPRINT_6C_COMPLETION_REPORT.md` and local verification by Chris. No commit is recommended until both reviews are complete.
