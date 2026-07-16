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

---

## Sprint 6D - Teacher Curriculum Landing Page

**Date:** 2026-07-09
**Status:** Implementation complete. Sprint 6D certification is now gated on Sprint 6D.0 (Canonical Curriculum Manifest Extraction). See the Sprint 6D.0 entry below.
**Companion documents:** TEACHER_EXPERIENCE_PHILOSOPHY.md (§3.2, §3.4, §3.9, §4.2), TEACHER_PLATFORM_DOMAIN_ROADMAP.md (Phase 2 amendment), PRESENT_MODE_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md (PDR-010).

### Objective

Replace the Sprint 6C transitional Curriculum surface with the teacher curriculum landing page. Deliver the teacher-facing view of the LyfeLabz curriculum described in §3.2 and §4.2 of the philosophy: the familiar grade-and-topic organization of the canonical curriculum, teacher-only activation controls per lesson, and an unrestricted preview link back to the canonical instructional repository. Activation is UI-only; no backend surface is added.

### Major accomplishments

- Introduced `app/src/shell/surfaces/shared/lessonCatalog.ts`, a static, read-only catalog of the 47 lessons currently published in the canonical curriculum index at the repository root. The catalog stores slug, title, grade, topic, and href (`/lesson_${slug}.html`) per entry. No lesson content is duplicated; the catalog references the canonical instructional repository per PDR-007 and §3.9 of the philosophy.
- Rewrote `renderCurriculumSurface` to mount the teacher curriculum landing page. The surface renders a welcome headline, a brief teacher-facing intro, grade and topic filter rows that mirror the canonical filter box (All Grades / Grade 6 / Grade 7; All Topics / Life Science / Earth & Space / Physical Science / Tech & Engineering), a responsive lesson grid, a curriculum-empty notice, and the preserved return-to-lessons link.
- Reused the canonical LyfeLabz lesson-card language. Each card renders a grade badge, topic badge with topic-tinted background, lesson title, a preview link that opens the canonical lesson, and a placeholder activation toggle. The card's `data-lesson-active`, `data-grade`, and `data-topic` attributes make lesson activation state and filter posture machine-readable.
- Introduced the placeholder activation contract. Every lesson defaults to `Active`. The per-card toggle flips state between `Active` and `Inactive`, updates `aria-pressed`, updates the aria-label (`Activate ${lesson.title} for students` / `Deactivate ${lesson.title} for students`), and applies the `shell-lesson-card-inactive` class for visual distinguishability (reduced opacity, muted background, muted title color). Activation state lives in client-local memory per mount and is discarded on remount by design. PDR-010 curation semantics land in Phase 5.
- Introduced the filter contract. Grade and topic filter pills carry `aria-pressed`, dispatch on click, and combine with AND semantics against `data-grade` and `data-topic` on each card. The curriculum-empty notice appears only when no cards match.
- Added the surface CSS to `app/index.html` under the canonical shell stylesheet: `.shell-curriculum-*`, `.shell-filter-*`, `.shell-lesson-*` selectors. Responsive grid uses `repeat(auto-fill, minmax(240px, 1fr))`. Touch-target minimums under `@media (pointer: coarse)` are preserved on filter pills and toggles.
- Expanded `app/src/shell/shell.test.ts` `Curriculum surface composition` block to cover: welcome copy, intro copy, filter controls, lesson grid population, per-card composition (title, grade badge, topic badge, preview link, toggle), default activation state, toggle click flipping activation and visual state, grade filter behavior, topic filter behavior, AND-combined filter behavior, absence of uid/schoolId/claim payload, empty-name fallback, and focus behavior. Total: **129 tests across 5 suites**.

### Architecture posture

Sprint 6D introduces no new backend behavior.

- Firestore remains authoritative. No client read change. No `lessons/{lessonId}` read is issued; the catalog is a static, teacher-facing bridge.
- All writes remain server-mediated. The activation toggle writes only to per-mount memory. No callable is invoked.
- Firestore Rules remain default-deny. No rule change.
- `status` remains the sole lifecycle field. No lifecycle field is introduced for activation.
- Audit events remain append-only. No new vocabulary is registered.
- The Immutable Session Object, Session Bootstrap, and protected router state machine are unchanged.
- Custom claims remain `{ role, schoolId }`; `districtId` remains reserved.
- No new Cloud Functions, no Firestore Rules changes, no Firestore indexes changes, no Storage Rules changes. `platform/functions/**` and `platform/firebase/**` were not modified.
- The shell no-Firebase-import invariant is preserved. The static-source assertion in `shell.test.ts` continues to guard it.
- Preservation mode remains intact. No file at the repository root is modified.
- The `active teacher surface (Step 5 shell)` assertion in `app/src/router/surfaces/surfaces.test.ts` continues to pass because the Curriculum surface preserves the `Welcome, Ada.` headline.

### Repository validation

- `app` typecheck clean.
- `app` lint clean.
- `app` build clean (esbuild).
- `app` unit tests: **129 pass across 5 suites** (Sprint 6C baseline: 125 / 5; +4 tests net, no suite added).
- `platform/functions` typecheck, lint, and build clean.
- `platform/functions` unit tests: **295 pass across 22 suites** (unchanged).
- `platform/firebase` Rules tests: **94 pass across 8 suites** (unchanged).

### Recommendation

Proceed to the Sprint 6D review pass after Technical Lead review of this history entry and local verification by Chris. No commit is recommended until both reviews are complete.

---

## Sprint 6D.0 - Canonical Curriculum Manifest Extraction

**Date:** 2026-07-10
**Status:** Implementation complete; awaiting Technical Lead review and local verification by Chris.
**Companion documents:** SPRINT_6D_0_SPECIFICATION.md, SPRINT_6D_0_COMPLETION_REPORT.md, TEACHER_EXPERIENCE_PHILOSOPHY.md (§3.9), PRESENT_MODE_ARCHITECTURE.md (§12), TEACHER_PLATFORM_DOMAIN_ROADMAP.md (Phase 2 amendment), LYFELABZ_PLATFORM_DECISIONS.md (PDR-007, PDR-010, PDR-018).

### Objective

Replace the manually maintained TypeScript curriculum registry introduced by Sprint 6D with a deterministic build-time extraction from the canonical root `index.html`. Preserve the one-canonical-curriculum principle (PDR-007 and TEACHER_EXPERIENCE_PHILOSOPHY.md §3.9) by making the manifest a derived artifact rather than an independently editable source of truth. Sprint 6D certification depends on this prerequisite.

### Major accomplishments

- Introduced `app/scripts/curriculumParser.cjs`, a dependency-free deterministic parser that reads the canonical curriculum markup - `.topic-group[data-group]` -> `.subject-block[data-topic][data-grades]` -> `.unit-card[id="unit-*"]` -> `.unit-links a.ulink.*` - and emits a normalized manifest.
- Introduced `app/scripts/build-curriculum-manifest.cjs`, the CLI entry point. Regenerates `app/src/curriculum/curriculum.manifest.json` on invocation and runs a byte-for-byte drift check under `--check` mode. Exposes `npm run curriculum:build` and `npm run curriculum:verify` on the `app` package.
- Generated `app/src/curriculum/curriculum.manifest.json`. Marked `"generated": true` with `canonicalSource: "index.html"` and a SHA-256 fingerprint of the parsed source. Contains topic groups, units, resources, orphan placeholders, and total counts by grade, topic, and resource type. Timestamps are intentionally omitted so regeneration on an unchanged canonical index is byte-identical.
- Introduced `app/src/curriculum/curriculumManifest.ts`, the sole authoritative curriculum accessor for the teacher application. Exposes `CURRICULUM_MANIFEST`, `TOPIC_LABEL`, `getAllUnits`, `getSurfaceableLessons`, `getTopicGroups`, `getOrphanUnits`, and the resource / unit / topic / grade types.
- Rewired `app/src/shell/surfaces/curriculum.ts` to consume `getSurfaceableLessons()` and `TOPIC_LABEL` from the typed selector. Filter logic, activation semantics, aria contract, and rendering are unchanged. The 47 non-gated lesson-card assertion in `shell.test.ts` continues to pass unchanged.
- Removed `app/src/shell/surfaces/shared/lessonCatalog.ts` entirely. No thin wrapper remains; the shadow curriculum registry is gone.
- Added `app/src/curriculum/curriculumManifest.test.ts` covering: manifest fingerprint sanity, drift (checked-in JSON equals a freshly parsed manifest), unique slugs and hrefs, topic group order and labels, gated behavioral-science, `getSurfaceableLessons` filtering (47 non-gated lessons), orphan reporting on gated topic groups only, resource totals reconciliation, and 12 parser strict-failure guarantees. Total: **20 new tests across 1 new suite**.
- Recorded the manifest prerequisite in `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (Phase 2 UX Direction Amendment, Sprint 6D subsection).

### Architecture posture

Sprint 6D.0 introduces no new backend behavior.

- No Firestore read, no callable, no rule change, no lifecycle field, no custom claim, no Session field, no audit vocabulary term.
- The shell no-Firebase-import invariant is preserved. The static-source assertion in `shell.test.ts` continues to guard it. The manifest is a checked-in JSON asset imported through TypeScript's `resolveJsonModule`.
- No `localStorage`, `sessionStorage`, or `document.cookie` access is introduced.
- Preservation mode remains intact. Root `index.html` is unmodified.
- Sprint 6D activation-toggle, filter, welcome-copy, and empty-name-fallback tests continue to pass unchanged.

### Canonical resource totals

Extracted from the current canonical `index.html` (SHA-256 `dc46aa78…101b69`).

- Total units: **48** (47 non-gated lesson units + 1 gated behavioral-science lesson unit).
- Orphan placeholders (gated topic groups only): 2.
- Units by grade: 6 -> 22, 7 -> 26.
- Units by topic: Life Science 12, Earth & Space 15, Physical Science 11, Tech & Engineering 9, Behavioral Science 1 (gated).
- Resources by type: lesson 48, extension 5, investigation 4, simulation 3, challenge 1, activity 0, game 0, map 0, disease 0. Total resources: **61**.

### Repository validation

- `app` typecheck clean.
- `app` lint clean.
- `app` build clean (esbuild).
- `app` unit tests: **149 pass across 6 suites** (Sprint 6D baseline: 129 / 5; delta +20 tests, +1 suite).
- `app` curriculum manifest verification: `npm run curriculum:verify` reports `manifest matches canonical index.html (units=48)`.
- `app` curriculum manifest regeneration: `npm run curriculum:build` is byte-stable on an unchanged canonical `index.html`.
- `platform/functions` typecheck, lint, and build clean.
- `platform/functions` unit tests: **295 pass across 22 suites** (unchanged).
- `platform/firebase` Rules tests: **94 pass across 8 suites** (unchanged).

### Recommendation

Proceed to the Sprint 6D certification pass after Technical Lead review of this history entry and local verification by Chris. No commit is recommended until both reviews are complete.

---

## Sprint 6D - Teacher Curriculum Landing Page (Certification)

**Date:** 2026-07-09
**Status:** Certified. Sprint 6D.0 satisfied the sole outstanding prerequisite; no additional runtime code changes were required. Awaiting Technical Lead review and local verification by Chris.
**Companion documents:** SPRINT_6D_COMPLETION_REPORT.md, SPRINT_6D_0_COMPLETION_REPORT.md, TEACHER_EXPERIENCE_PHILOSOPHY.md (§3.2, §3.4, §3.9, §4.2), PRESENT_MODE_ARCHITECTURE.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md (Phase 2 amendment), LYFELABZ_PLATFORM_DECISIONS.md (PDR-007, PDR-010, PDR-018).

### Objective

Certify the Teacher Curriculum Landing Page using the generated canonical curriculum manifest established by Sprint 6D.0. Do not redesign the feature or expand scope. Finish the sprint.

### Certification outcome

Sprint 6D.0 became a prerequisite sprint. The manually maintained shadow curriculum registry (`app/src/shell/surfaces/shared/lessonCatalog.ts`) was removed and the Curriculum surface (`app/src/shell/surfaces/curriculum.ts`) was rewired to read only through the typed selector `app/src/curriculum/curriculumManifest.ts` over the generated `curriculum.manifest.json`. The Sprint 6D behavioral contract - welcome copy, curriculum intro, filter controls, 47 non-gated lesson cards in canonical order, per-card composition, default activation, click-to-toggle activation, grade filter, topic filter, AND-combined filter, absence of uid/schoolId/claim payload, empty-name fallback, focus behavior, and the return-to-public-lessons link - continues to pass unchanged. No further runtime code changes were required for Sprint 6D certification.

Sprint 6D is now certified. The teacher curriculum landing page no longer relies on a manually maintained curriculum registry; all curriculum metadata reads flow through the canonical generated manifest.

### Architecture posture

- No conflict with the certified architecture; no architecture amendment required.
- No Firestore read, no callable, no rule change, no lifecycle field, no custom claim, no Session field, no audit vocabulary term is introduced.
- Activation remains UI-only per-mount client state; PDR-010 curation semantics land in Phase 5.
- Preview links launch canonical instructional pages (`/lesson_${slug}.html`), preserving PDR-007.
- Shell no-Firebase-import invariant preserved. No `localStorage`, `sessionStorage`, or `document.cookie` access. No `firebase/*` import reaches `app/src/shell/**`.
- Preservation mode intact. Root `index.html` unmodified.
- The generated manifest is the sole curriculum metadata source consumed by the authenticated application. `grep -rn "lessonCatalog\|LESSON_CATALOG\|curriculum.manifest.json" app/src` returns only the three expected occurrences inside `curriculumManifest.ts` (module comment, JSON import, and a historical `LESSON_CATALOG` reference in a code comment).

### UX posture

- Curriculum remains the teacher's primary landing experience.
- The curriculum remains recognizable as LyfeLabz. Grade + topic organization, badge vocabulary, and lesson labels mirror the canonical index byte-for-byte.
- The Teacher Platform manages instruction (per-lesson activation controls scoped to the authenticated shell). Canonical LyfeLabz delivers instruction (Preview link).
- No dashboard mentality. No analytics chrome, no KPI tile, no submission rollup.
- Simplicity preserved. Welcome + intro + two filter rows + one lesson grid + empty-state notice + return link.
- Scales naturally: adding grades or topics is a canonical-index change followed by `npm run curriculum:build`; the typed unions and filter contracts extend without a surface code change.

### Repository validation

- `app` `npm run curriculum:verify` clean.
- `app` typecheck, lint, build clean.
- `app` unit tests: **149 pass across 6 suites** (Sprint 6D.0 baseline: 149 / 6; delta 0 / 0).
- `platform/functions` typecheck, lint, build clean.
- `platform/functions` unit tests: **295 pass across 22 suites** (unchanged).
- `platform/firebase` Rules tests: **94 pass across 8 suites** (unchanged).
- Aggregate: **538 tests / 36 suites**.

### Recommendation

Sprint 6D is certified. Proceed to the Sprint 6D certification review pass after Technical Lead review of this history entry, the Sprint 6D completion report, and local verification by Chris. No commit is recommended until both reviews are complete.

---

## Documentation - Teacher Journey Narrative

**Date:** 2026-07-10
**Status:** Documentation only. Awaiting Technical Lead review and local verification by Chris.
**Companion documents:** TEACHER_JOURNEY.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, PRESENT_MODE_ARCHITECTURE.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md.

### Objective

Create a foundational product narrative describing what it should feel like to teach with LyfeLabz across a full school day. The narrative complements the certified philosophy and architecture documents; it does not replace them.

### Deliverables

- Created `docs/platform/TEACHER_JOURNEY.md`. Nine chapters: Purpose, Core Philosophy, Before the First Bell, Teaching a Lesson, Between Classes, Planning Period, After School, Guiding Product Rules, Future Vision. Each chapter ends with a small Product Rules section that distills the design principles discovered from that moment.
- Updated `docs/platform/TEACHER_PLATFORM_DOMAIN_ROADMAP.md` to add TEACHER_JOURNEY.md to the companion-documents line and to insert a short reference block directing future teacher-facing implementation work to the journey.
- Updated `docs/platform/SPRINT_HISTORY.md` with this entry.

### Architecture posture

- No runtime code, Firebase configuration, Firestore Rules, Cloud Functions, or instructional content is modified.
- No Firestore collection, callable, custom claim, lifecycle field, Session field, or audit vocabulary term is introduced.
- The certified architecture (LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, PLATFORM_STATE_MACHINE.md, LYFELABZ_PLATFORM_DECISIONS.md) is unchanged.
- The Teacher Experience Philosophy and the Present Mode Architecture remain authoritative for their respective concerns. The journey defers to both in every case of conflict.
- Preservation mode is intact. The instructional repository at the repository root is not touched.

### Philosophy summary

The Teacher Journey names, in narrative form, the following load-bearing product principles.

- Curriculum is the teacher's home. The Teacher Workspace opens on curriculum, not on a dashboard.
- Preparation comes before analytics. Every class opens on a Snapshot before it exposes a spreadsheet.
- The one-dialog day. Scheduling for all classes happens in a single dialog, with each class independently configurable, the default date always Today, and release time a per-day teacher decision.
- Defaults reflect the common case. Preferences are remembered. Schedules are not assumed.
- Present Mode is separate by construction. Its privacy guarantees are structural, not conditional.
- One canonical curriculum. Teacher browsing, Present Mode, and student access all reference the same instructional experience.
- Complement Google Classroom and PowerSchool. Do not replace them.
- Reduce clicks honestly. Removed clicks that also remove a decision the teacher wanted to make are regressions, not wins.
- Teachers are never trapped. LyfeLabz is one tab among many.

### Validation

- No em dashes present in the new or edited documents. Verified with a repository grep for the em-dash character across `TEACHER_JOURNEY.md` and `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`, which returned no matches.
- Internal document references (TEACHER_EXPERIENCE_PHILOSOPHY.md, PRESENT_MODE_ARCHITECTURE.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, SPRINT_HISTORY.md, SPRINT_6D_0_COMPLETION_REPORT.md, SPRINT_6D_COMPLETION_REPORT.md) resolve to existing files under `docs/platform/`.
- No runtime files were modified. No `app/**`, `platform/**`, `firebase/**`, root `index.html`, or lesson HTML was touched.
- No new features, callables, roles, claims, lifecycle fields, or Firestore collections are introduced.

### Recommendation

No commit is recommended until Technical Lead review of this history entry, review of TEACHER_JOURNEY.md, and local verification by Chris are complete.

---

## Documentation - Assign Experience Product Specification

**Date:** 2026-07-10
**Status:** Documentation only. Awaiting Technical Lead review and local verification by Chris.
**Companion documents:** ASSIGN_EXPERIENCE.md, TEACHER_JOURNEY.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, PRESENT_MODE_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md.

### Objective

Document the canonical Assign Experience before Sprint 6E implementation begins. Give future sprints a shared product specification for the teacher assignment workflow so that Assignment Foundation surfaces implement the experience rather than invent it.

### Deliverables

- Created `docs/platform/ASSIGN_EXPERIENCE.md`. Ten chapters: Purpose, Design Philosophy, Opening the Assignment Dialog, Preparing an Entire Day, Configuring Individual Classes, Scheduling, Confirmation, Revisiting Existing Assignments, Design Rules, Future Growth. Each of chapters 1 through 8 and chapter 10 ends with a Design Rules block that distills the product decisions from that section.
- Updated `docs/platform/TEACHER_PLATFORM_DOMAIN_ROADMAP.md` to add ASSIGN_EXPERIENCE.md to the companion-documents line and to insert a short reference block identifying the Assign Experience as the canonical workflow document for assignment-related implementation.
- Updated `docs/platform/SPRINT_HISTORY.md` with this entry.

### Architecture posture

- No runtime code, Firebase configuration, Firestore Rules, Cloud Functions, or instructional content is modified.
- No Firestore collection, callable, custom claim, lifecycle field, Session field, or audit vocabulary term is introduced.
- The certified architecture (LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, PLATFORM_STATE_MACHINE.md, LYFELABZ_PLATFORM_DECISIONS.md) is unchanged.
- The Teacher Experience Philosophy, the Teacher Journey, and the Present Mode Architecture remain authoritative for their respective concerns. The Assign Experience defers to all of them and to the Assignment Foundation phase in every case of conflict.
- Preservation mode is intact. The instructional repository at the repository root is not touched.

### Philosophy summary

The Assign Experience names, in specification form, the following load-bearing product principles.

- Assigning is one workflow. LyfeLabz has one dialog for scheduling every selected class.
- Preparation, not delivery. The workflow is designed for the moment before students arrive.
- Every class the teacher teaches appears as its own row. Every class is selected by default.
- Each row is independently configurable. Exceptions live inside the same dialog, never in a second one.
- The default assignment date is always Today. Release time and Google Classroom topic are prefilled from the teacher's remembered preferences.
- Points default to the total possible quiz score for the resource.
- LyfeLabz remembers preferences. LyfeLabz does not assume today's schedule.
- Scheduling is a single confirmation for the entire day. Validation errors surface in place.
- The lesson card updates to "✓ Assigned" in place. Clicking it reopens the same dialog with the current information populated.
- Unassign is a deselection inside the dialog, not a dedicated workflow.
- After scheduling, the teacher returns to exactly where she was. Curriculum is a control panel, not a dashboard.

### Validation

- No em dashes present in the new or edited documents. Verified with a repository grep for the em-dash character across `ASSIGN_EXPERIENCE.md`, the updated portion of `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`, and this history entry, which returned no matches.
- Internal document references (TEACHER_JOURNEY.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, PRESENT_MODE_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, SPRINT_HISTORY.md) resolve to existing files under `docs/platform/`.
- No runtime files were modified. No `app/**`, `platform/**`, `firebase/**`, root `index.html`, or lesson HTML was touched.
- No new features, callables, roles, claims, lifecycle fields, or Firestore collections are introduced.

### Recommendation

No commit is recommended until Technical Lead review of this history entry, review of ASSIGN_EXPERIENCE.md, review of the roadmap reference block, and local verification by Chris are complete.

---

## Sprint 6E - Assign Experience (Curriculum card)

**Date:** 2026-07-10
**Status:** Implementation complete. Awaiting Technical Lead review and local verification by Chris.
**Detailed report:** SPRINT_6E_COMPLETION_REPORT.md
**Companion documents:** ASSIGN_EXPERIENCE.md, TEACHER_JOURNEY.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, PRESENT_MODE_ARCHITECTURE.md.

### Objective

Deliver the first working version of the Assign Experience described in ASSIGN_EXPERIENCE.md. Land the one-dialog day, per-class row configuration, remembered-preference defaults, and the "✓ Assigned" card state inside the Teacher Workspace Curriculum surface. Do not introduce Firestore writes, callables, Cloud Functions, Google Classroom integration, teacher-preference persistence, or backend scheduling. Sprint 6E is a UI implementation sprint.

### Major accomplishments

- Extended `app/src/shell/surfaces/curriculum.ts` with the canonical Assign workflow. Every lesson card now carries an Assign control that opens a single modal dialog with one row per active class, every row selected by default. Each row exposes date, release time, Google Classroom topic, and points. The confirm control is disabled until at least one row is selected.
- Prefilled defaults follow ASSIGN_EXPERIENCE.md sections 4 and 5. Assignment date defaults to Today, release time defaults to the teacher's remembered value for this session, Google Classroom topic defaults to the last topic entered, and points default to the LyfeLabz ten-question quiz total.
- Implemented session-scoped in-memory storage. Assignments and last-used release time and Google Classroom topic live in module-scoped state and clear on full page reload. No `localStorage`, `sessionStorage`, `document.cookie`, Firestore, or callable is used.
- Wired class list retrieval through the existing `deps.listClasses` fetcher already provided to the workspace outlet. The dialog prefetches the class list on curriculum mount so the modal opens without a round trip; only active classes appear as assignable rows.
- Confirming the dialog closes the modal, returns the teacher to the same Curriculum location with scroll position preserved, updates the card in place to "✓ Assigned", and surfaces a concise, self-dismissing success confirmation.
- Clicking "✓ Assigned" reopens the same dialog with the current per-row values populated. Removing an assignment is a deselection inside the dialog: clearing every row and reconfirming returns the card to the unassigned state.
- Preserved every Sprint 6D behavior. The activation toggle, filter pills, welcome copy, return link, and lesson count are unchanged. The dialog is an additional per-card control, not a replacement.
- Updated `app/src/shell/surfaces/workspace.ts` to route the workspace `listClasses` dependency into the curriculum surface. No other route surface changed.
- Added ten new tests to `app/src/shell/shell.test.ts` covering the Assign control, dialog composition, default values, disabled-confirm rule, ✓ Assigned card state, dialog revisit with persisted values, deselection removal, session-scoped preference memory, cancellation, and the empty-class friendly state.

### Architecture posture

- No Cloud Function, callable, Firestore Rule, custom claim, lifecycle field, Session field, audit vocabulary term, or route change was introduced.
- No teacher-preference persistence, no `assignments/{...}` document, no scheduling record, and no Google Classroom API call was written. PDR-010 and the Assignment Foundation phase (Phase 5) remain the canonical owners of those concerns.
- The certified architecture (`LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `PLATFORM_STATE_MACHINE.md`, `LYFELABZ_PLATFORM_DECISIONS.md`) is unchanged.
- The shell "no firebase imports" invariant (Sprint 3 Step 5) is preserved. The curriculum surface imports only the injected `ListClasses` type and the existing manifest reader.
- Preservation mode is intact. The instructional repository at the repository root is not touched.

### Verification performed

- `app`: TypeScript typecheck clean; ESLint clean; esbuild bundle produced (`dist/bundle.js`); Jest suite runs 159/159 passing across 6 suites.
- `platform/functions`: TypeScript typecheck clean; ESLint clean; TypeScript build clean; Jest suite runs 295/295 passing across 22 suites.
- `platform/firebase`: Firestore Rules test suite runs 94/94 passing across 8 suites under the Firestore emulator.
- All ten new Sprint 6E tests exercise the assign control, dialog, per-class rows, default values, confirm-disabled contract, ✓ Assigned card state, dialog revisit, session-scoped preference memory, cancellation, and the empty-class state.

### Recommendation

No commit is recommended until Technical Lead review of `SPRINT_6E_COMPLETION_REPORT.md` and local verification by Chris are complete.

---

## Sprint 6F - Present Mode Workspace Foundation

**Date:** 2026-07-10
**Status:** Implementation complete. Awaiting Technical Lead review and local verification by Chris.
**Companion documents:** PRESENT_MODE_ARCHITECTURE.md, TEACHER_JOURNEY.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md.

### Objective

Establish Present Mode as a real Teacher Workspace destination inside the authenticated shell. Deliver a preparation-focused foundation state that answers the teacher question "What can I prepare to present?" and reserves the eventual presentation launch mechanism for a future sprint. No presentation engine, no lesson launch controls, no backend persistence.

### Major accomplishments

- Created `app/src/shell/surfaces/presentMode.ts`. The surface renders a Present Mode title, an intro explaining the surface's purpose, a preparation-focused paragraph, an ordered list of three preparation steps (choose a lesson from Curriculum, open Present Mode when ready to teach, teach without leaving the workflow), and a concise future-controls notice. The surface loads no teacher-scoped or student-scoped data, opens no Firestore listener, invokes no callable, and imports no `firebase/*` module.
- Promoted the Present Mode navigation item from a disabled coming-soon entry to a real available destination in `app/src/shell/navigation.ts`. Selecting the item switches the workspace outlet to the Present Mode surface and carries `aria-current="page"` when active. Settings remains a disabled coming-soon item until its own implementation sprint.
- Wired the Present Mode entry in `WORKSPACE_SURFACES` (`app/src/shell/surfaces/workspace.ts`) to `renderPresentModeSurface`. The four canonical workspace-surface keys (`curriculum`, `classes`, `present-mode`, `settings`) are unchanged. The workspace outlet advertises `data-active-surface="present-mode"` when Present Mode is active.
- Preserved every Sprint 6C, 6D, and 6E behavior. Curriculum remains the default landing surface; Classes retains its listing behavior; the Assign Experience dialog is untouched; the shared shell header, footer, sign-out, and identity-summary contracts are intact. Focus lands on the surface headline when Present Mode is activated, matching the accessibility posture of Curriculum and Classes.
- Added Sprint 6F tests to `app/src/shell/shell.test.ts`. The new suite covers navigation availability, `aria-current` activation, canonical outlet routing, focus management, absence of coming-soon or dashboard labels, absence of form controls and disabled inputs, absence of Session or claim payload rendering, absence of curriculum or class rosters that would be teacher-scoped in a projection, and no-double-mount behavior when navigating away and back. The pre-existing "disabled coming-soon" and "clicking a disabled navigation item" tests were updated to reflect Settings as the only remaining disabled destination.

### Architecture posture

- No Cloud Function, callable, Firestore Rule, custom claim, lifecycle field, Session field, audit vocabulary term, Hosting rewrite, or `/app/**` URL route was introduced.
- The certified architecture (`LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `PLATFORM_STATE_MACHINE.md`, `LYFELABZ_PLATFORM_DECISIONS.md`) is unchanged.
- The shell "no firebase imports" invariant (Sprint 3 Step 5) is preserved. The Present Mode surface imports only the Session type.
- Sprint 6F implements the Teacher Workspace-side foundation for Present Mode. The eventual full-page launch of the canonical LyfeLabz surface described by `PRESENT_MODE_ARCHITECTURE.md` section 3 remains the responsibility of a future sprint. The current preparation surface renders no curriculum content and duplicates nothing from canonical LyfeLabz, so `PDR-018` is preserved.
- Preservation mode is intact. The instructional repository at the repository root is not touched.

### Accessibility and responsive behavior

- The surface headline is a keyboard-focusable `h2#surface-headline` marked `tabIndex=-1`. The workspace outlet references it via `aria-labelledby`. Focus lands on the headline when the surface mounts, matching Curriculum and Classes.
- No form control, disabled input, or misleading control is rendered. Assistive technology encounters only heading, text, and list elements.
- The surface reuses shell CSS conventions (`shell-welcome`, `shell-status`, `shell-present-*`) so responsive behavior follows the existing workspace shell layout.

### Explicit non-goals confirmed

- No presentation engine was added.
- No lesson slide extraction, launch control, full-screen mode, timer, poll, quiz control, or student device control was added.
- No Google Classroom, Google Meet, or PowerSchool integration was added.
- No Firestore read or write, Cloud Function, callable, or `localStorage`/`sessionStorage`/`document.cookie` usage was added.
- No mock classroom data, fake analytics, recent-lesson history, or favorites were added.

### Verification performed

- `app`: TypeScript typecheck clean; ESLint clean; esbuild bundle produced (`dist/bundle.js`); Jest suite runs 174/174 passing across 6 suites.
- `platform/functions`: TypeScript typecheck clean; ESLint clean; TypeScript build clean; Jest suite runs 295/295 passing across 22 suites.
- `platform/firebase`: Firestore Rules test suite runs 94/94 passing across 8 suites under the Firestore emulator.
- Fifteen new Present Mode tests exercise navigation availability, active-state routing, outlet composition, focus management, absence of forbidden labels and controls, absence of teacher-scoped or curriculum payload, and no-double-mount behavior.

### Recommendation

No commit is recommended until Technical Lead review of this history entry and local verification by Chris are complete.

---

## Platform Contracts Documentation Amendment

**Date:** 2026-07-10
**Status:** Documentation amendment. Awaiting Technical Lead review.
**Companion documents:** PLATFORM_CONTRACTS.md, PRESENT_MODE_ARCHITECTURE.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_JOURNEY.md, ASSIGN_EXPERIENCE.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md.

### Objective

Create `docs/platform/PLATFORM_CONTRACTS.md` as the canonical home for cross-cutting technical contracts shared across multiple LyfeLabz platform features. Centralize agreements previously implicit in feature architecture, without moving feature-specific behavior out of feature architecture.

### Major accomplishments

- Created `PLATFORM_CONTRACTS.md` with twelve numbered sections covering purpose and scope, authority and conflict resolution, naming and namespace conventions, browser storage roles, versioned client-side schemas, route and navigation boundaries, the public and authenticated surface boundary, projector-safety rules, accessibility minimums, safe-failure rules, a certified contract registry, and the amendment process.
- Registered the certified Present Mode contracts (namespace pattern, return-context storage key, schema version, initial return surface, same-tab launch, and public-surface return behavior) in the cross-cutting contract registry without moving any feature-specific detail out of `PRESENT_MODE_ARCHITECTURE.md`.
- Added a concise cross-reference to `PRESENT_MODE_ARCHITECTURE.md` recording that its certified storage key, schema, navigation, and safe-return behavior are also registered in `PLATFORM_CONTRACTS.md`.
- Reviewed `LYFELABZ_PLATFORM_DECISIONS.md`. Its structure is a per-decision PDR log, not a cross-reference index. No modification was made; adding a new PDR is not required for this documentation amendment.

### Architecture posture

- No production code changed.
- No test changed.
- No runtime behavior changed.
- No Cloud Function, callable, Firestore Rule, custom claim, lifecycle field, Session field, audit vocabulary term, Hosting rewrite, or `/app/**` URL route was introduced.
- No feature architecture behavior was relocated. `PRESENT_MODE_ARCHITECTURE.md` remains authoritative for Present Mode.
- Sprint 6G was not implemented. This amendment is documentation only.
- No speculative contracts were added for future Snapshot, Settings, notifications, or analytics surfaces.

### Verification performed

- Working directory: `/Users/breezy/Documents/GitHub/lyfelabz`.
- Confirmed the required source documents exist under `docs/platform/` via `ls docs/platform/`.
- Read the certified architecture and product documents named in the sprint brief before writing.
- Confirmed no em dashes were introduced in the new or modified documentation via a repository-wide em-dash grep against `docs/platform/PLATFORM_CONTRACTS.md`, `docs/platform/PRESENT_MODE_ARCHITECTURE.md`, and `docs/platform/SPRINT_HISTORY.md`. Zero matches in prose.
- Confirmed only the three intended documentation files changed via `git status`.

No App, Functions, or Firestore test suite was executed. Repository policy does not require runtime test execution for documentation-only changes and none of the modified files are consumed by those suites.

### Recommendation

No commit is recommended until Technical Lead review is complete. Future implementation sprints must follow the certified contracts registered in `PLATFORM_CONTRACTS.md`.

---

## Sprint 6G: Present Mode Launch and Return

**Date:** 2026-07-10
**Status:** Implemented. No commits.
**Companion documents:** PRESENT_MODE_ARCHITECTURE.md (section 14), PLATFORM_CONTRACTS.md (sections 4, 5, 6, 8, 9), TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_JOURNEY.md, ASSIGN_EXPERIENCE.md.

### Objective

Implement the certified launch-and-return flow between the Teacher Platform and the canonical LyfeLabz instructional experience. Preserve the canonical instructional experience as the sole presentation engine. Give the teacher a single semantic launch action in Present Mode and, on the canonical instructional experience, a small return affordance that appears only when a valid, non-sensitive return marker is present.

### What was implemented

- Present Mode launch button on the Present Mode workspace surface, exposing the accessible name `Launch Present Mode` and rendering as a semantic keyboard-operable button.
- Certified sessionStorage return-context creation, keyed by the certified string `lyfelabz.presentMode.returnContext` under the platform namespace pattern `lyfelabz.<feature>.<purpose>`.
- Same-tab launch navigation using `window.location.assign("/")`.
- Return-context validation that fails safely on absent markers, malformed JSON, unsupported schema versions, unsupported returnSurface values, and missing required fields.
- Lightweight return script for the canonical instructional experience, shipped as a self-contained plain-JS artifact at `assets/present-mode-return.js` and loaded from the canonical curriculum root `index.html`. The script imports no Firebase SDK, reads no authentication state, and injects nothing when the marker is absent or invalid.
- Conditional return affordance rendered by the script when a valid marker is present, exposing the certified accessible name `Return to Teacher Workspace`.
- Return navigation that same-tab hands the tab back to the Teacher Workspace entry URL (`/app/teacher`), where the shell resolves Curriculum as the default landing surface.
- Marker cleanup performed by the return script before it navigates back to the Teacher Workspace.
- Accessibility support on both controls: semantic `<button>` elements with explicit `aria-label` values, keyboard operability, and no icon-only affordances.

### Certified contracts respected

- Storage key: `lyfelabz.presentMode.returnContext`.
- Schema: `{ version: 1, returnSurface: "curriculum" }`. The stored payload carries only the two certified fields and no teacher, class, or student data.
- Launch navigation: `window.location.assign("/")` (same-tab).
- Return script posture: always loads on the canonical instructional experience, no-ops without a valid marker, imports no Firebase SDK, reads no authenticated state, and preserves public instructional behavior.
- Projector safety: no teacher, class, or student identifier is stored, read, or rendered by either the launch button or the return control.

### Architecture protection

- No parallel router. No parallel Teacher Workspace shell. No parallel instructional surface. The Teacher Platform lives under `/app/**`, the canonical instructional experience lives at the repository root, and both share a single Firebase Hosting origin as certified.
- No backend persistence introduced. No Firestore record. No callable. No custom claim. No lifecycle field. No audit vocabulary term. No Session Object field.
- No second presentation engine introduced. The canonical instructional experience remains the presentation experience.
- The public instructional experience is unchanged for a visitor without a valid marker. The return script exits immediately when the marker is absent or invalid.
- The Assign Experience, Curriculum surface, Classes surface, and shell composition are preserved and their existing tests continue to pass unchanged.
- The shell posture invariant (no `sessionStorage`, `localStorage`, `document.cookie`, `firebase/auth`, `firebase/firestore`, `firebase/functions`, `onSnapshot`, or `httpsCallable` in `app/src/shell/**`) is preserved by keeping every launch-context and return-script implementation outside `src/shell/`.

### Files created

- `app/src/presentMode/launchContext.ts` (certified schema, key, validators, launch-handler factory).
- `app/src/presentMode/launchContext.test.ts` (contract, validation, and launch-behavior tests).
- `app/src/presentMode/returnControl.ts` (TypeScript reference implementation for the return script).
- `app/src/presentMode/returnControl.test.ts` (jsdom tests for both the reference implementation and the plain-JS artifact).
- `assets/present-mode-return.js` (plain-JS return script loaded by the canonical instructional experience).

### Files modified

- `app/src/shell/surfaces/presentMode.ts` (renders the launch button; invokes the injected handler).
- `app/src/shell/surfaces/workspace.ts` (threads the launch handler through the workspace outlet).
- `app/src/shell/shell.ts` (widens `ShellDeps` with the injected launch handler).
- `app/src/shell/shell.test.ts` (adds launch-button, invocation, and privacy assertions; updates the Sprint 6F no-button assertion to expect the single certified launch button).
- `app/src/router/surfaces/index.ts` (widens `SurfaceDeps`; passes the handler through the active-teacher surface).
- `app/src/router/routes.ts` (updates `createSignOutOnlyRouteTable` with a noop launch handler).
- `app/src/router/surfaces/surfaces.test.ts` (default deps include the launch handler).
- `app/src/index.ts` (wires the browser-backed launch handler at the entry point).
- `app/src/curriculum/curriculum.manifest.json` (regenerated: only the `canonicalSourceSha256` field changes because `index.html` now includes the return-script tag; no unit, resource, or topic changes).
- `index.html` (adds `<script src="assets/present-mode-return.js" defer></script>` immediately before `</body>`).
- `docs/platform/SPRINT_HISTORY.md` (this entry).

### Tests added

- `launchContext.test.ts`: certified storage key, schema version, returnSurface allowlist, launch URL, safe validation for malformed, missing, unsupported-version, unsupported-surface, and non-object inputs, safe failure on private-mode storage, and launch-handler payload privacy.
- `returnControl.test.ts`: no-op for absent, malformed, unsupported-version, and unsupported-surface markers; semantic-button rendering with the certified accessible name; return navigation to the Teacher Workspace entry URL; marker cleanup; and identical behavior between the TypeScript reference implementation and the plain-JS artifact under jsdom.
- `shell.test.ts`: launch button renders with the certified accessible name; clicking it invokes the injected handler exactly once; the button exposes no teacher, class, or student identifiers; existing shell, curriculum, classes, and Present Mode behavior is preserved.

### Verification performed

App package (working directory `/Users/breezy/Documents/GitHub/lyfelabz/app`):

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` produced `dist/bundle.js` (956.6 kB).
- `npm test -- --runInBand` passed 214 tests across 8 suites.
- `npm run curriculum:build` regenerated the canonical curriculum manifest; only the `canonicalSourceSha256` field changed, reflecting the added return-script tag in `index.html`.

Functions package (working directory `/Users/breezy/Documents/GitHub/lyfelabz/platform/functions`):

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm test -- --runInBand` passed 295 tests across 22 suites.

Firestore Rules package (working directory `/Users/breezy/Documents/GitHub/lyfelabz/platform/firebase`):

- `npm run test:rules` passed 94 tests across 8 suites.

### Confirmations

- No backend persistence was added.
- No presentation engine was added.
- Public instructional access is unchanged when no marker is present.
- No commits were made.

---

## Sprint 6H: Settings Workspace Foundation

**Dates:** 2026-07-10
**Status:** Complete

### Objective

Promote Settings from a disabled coming-soon placeholder into a real Teacher Workspace destination that renders through the shared workspace outlet. Establish only the canonical Settings workspace foundation. No teacher preferences are implemented. No persistence is added. No backend functionality is introduced. Completes the permanent Teacher Workspace navigation defined in TEACHER_EXPERIENCE_PHILOSOPHY.md §3.3.

### Certified scope

Settings answers one teacher question: "Where will I manage how LyfeLabz works for me?" The surface is a private, teacher-only foundation state. It renders a title, an introductory paragraph, a purpose explanation, a list of future preference categories, and a growth notice. It renders no controls, opens no Firestore listener, invokes no callable, imports no `firebase/*` module, and loads no teacher-scoped or student-scoped data.

The future categories named on the surface are informational only:

- Classroom Preferences
- Present Mode Preferences
- Notification Preferences
- Connected Services
- Account Preferences

No controls exist for any of them. Their eventual implementation is deferred to future sprints in the Teachers domain (see TEACHER_PLATFORM_DOMAIN_ROADMAP.md).

### Navigation activation

The persistent left-side navigation defined in Sprint 6C now activates every canonical workspace-surface key. Settings is promoted from `available: false` to `available: true` in `NAVIGATION_ITEMS`. The nav item is fully selectable, keyboard accessible, and highlighted through the existing `aria-current="page"` mechanism. No new routing is introduced. No new navigation component is introduced. The workspace outlet contract from Sprint 6C is preserved.

### Workspace outlet integration

`WORKSPACE_SURFACES.settings` now renders `renderSettingsSurface` instead of the shared coming-soon renderer. All four canonical workspace-surface keys - `curriculum`, `classes`, `present-mode`, and `settings` - render a real teacher-facing destination. Every permanent left-side navigation item is now an available workspace destination.

### Accessibility

- The Settings headline is a semantic `<h2>` with `id="surface-headline"`, `tabindex="-1"`, and receives focus on activation, matching the pattern established by Curriculum, Classes, and Present Mode.
- The future preference categories render as a semantic `<ul>` labelled by a semantic `<h3>` heading via `aria-labelledby`.
- The Settings nav item exposes `aria-current="page"` when active, matching the other workspace destinations.
- The surface uses no color-only meaning.
- No form controls, no disabled controls, and no fake settings are rendered.

### Architecture protection

- Teacher Workspace shell, left navigation, Curriculum, Classes, Present Mode, Assign Experience, authenticated routing, and the workspace outlet are preserved.
- No new routes were introduced.
- No browser storage, backend persistence, Firebase, preferences, profile editing, notifications, Google Classroom, Google Drive, analytics, or account management was introduced.
- The shell posture invariant (no `sessionStorage`, `localStorage`, `document.cookie`, `firebase/auth`, `firebase/firestore`, `firebase/functions`, `onSnapshot`, or `httpsCallable` in `app/src/shell/**`) is preserved: the Settings surface loads nothing.

### Files created

- `app/src/shell/surfaces/settings.ts` (Settings workspace surface: title, intro, purpose, future-category list, growth notice; focuses the headline on mount).

### Files modified

- `app/src/shell/navigation.ts` (Settings promoted to `available: true`; header comment updated to describe Sprint 6H).
- `app/src/shell/surfaces/workspace.ts` (Settings workspace-surface entry now renders `renderSettingsSurface`; comment updated).
- `app/src/shell/shell.test.ts` (Sprint 6H test suite; existing Sprint 6C/6F assertions that assumed Settings was a disabled coming-soon item are updated to reflect Settings as an available destination; no existing assertion has been weakened).
- `docs/platform/SPRINT_HISTORY.md` (this entry).

### Tests added or updated

- New `Settings workspace surface (Sprint 6H)` describe block with behavioral tests covering: nav availability, `aria-current` behavior, workspace-outlet switching, headline focus, LYFELABZ-return behavior, structural content (headline, intro, purpose, category list, growth notice), the five certified future categories, prohibition of `coming soon`/`under construction`/placeholder text, absence of form controls or sample data, absence of Session claim payload, and no double-mounting on repeat activation.
- The Sprint 6C `Navigation composition and disabled posture` assertions are updated to reflect that every navigation item is now available; the disabled contract still holds vacuously because `NAVIGATION_ITEMS` no longer contains an unavailable entry.
- The Sprint 6C outlet-completeness assertion continues to exercise the `settings` surface through `mountWorkspaceOutlet` (its description is updated to note that Settings is now an implemented surface).
- The Sprint 6F Present Mode assertions and the Curriculum, Classes, and Assign Experience assertions are preserved unchanged.

### Verification performed

App package (working directory `/Users/breezy/Documents/GitHub/lyfelabz/app`):

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` produced `dist/bundle.js` (959.6 kB).
- `npm test -- --runInBand` passed 227 tests across 8 suites (up from 214).

Functions package (working directory `/Users/breezy/Documents/GitHub/lyfelabz/platform/functions`):

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm test -- --runInBand` passed 295 tests across 22 suites.

Firestore Rules package (working directory `/Users/breezy/Documents/GitHub/lyfelabz/platform/firebase`):

- `npm run test:rules` passed 94 tests across 8 suites.

### Confirmations

- No backend persistence was added.
- No teacher preferences were implemented.
- No runtime behavior outside the Settings workspace changed.
- No commits were made.

---

## Sprint 6 Certification: Teacher Workspace Version 1

**Date:** 2026-07-10
**Status:** Certified. Documentation-only sprint. No production code, tests, runtime behavior, or commits.
**Detailed certification:** `SPRINT_6_CERTIFICATION.md`
**Completion report:** `SPRINT_6_COMPLETION_REPORT.md`
**Companion documents:** `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_PLATFORM_DECISIONS.md`, `PLATFORM_CONTRACTS.md`, `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md`, `TEACHER_JOURNEY.md`, `ASSIGN_EXPERIENCE.md`, `PRESENT_MODE_ARCHITECTURE.md`, and per-sprint completion reports for 6A through 6H.

### Objective

Certify the completed Teacher Workspace produced across Sprints 6A, 6B, 6C, 6D, 6D.0, 6D Certification, 6E, 6F, 6G, and 6H (with the accompanying Present Mode Architecture Amendment and Platform Contracts Documentation Amendment) as Teacher Workspace Version 1. Distinguish explicitly between Completed and Intentionally Deferred scope.

### What was certified

- Teacher Workspace shell, workspace outlet, and persistent left-side navigation (LYFELABZ, Curriculum, Classes, Present Mode, Settings) with `aria-current="page"` on the active item and `data-active-surface` on the outlet.
- Curriculum surface backed by the canonical `curriculum.manifest.json`, with grade and topic filters, activation toggle, welcome copy, and the Assign Experience dialog per lesson card.
- Assign Experience: one dialog per lesson card, independent per-class rows, default selections, session-scoped remembered preferences, the `✓ Assigned` card state, and the reopen workflow. Sprint 6G did not alter Assign behavior.
- Classes surface as a canonical read-only foundation with no Snapshot, no analytics, and no backend persistence.
- Present Mode preparation surface with a single semantic `Launch Present Mode` action, certified same-tab launch via `window.location.assign("/")`, certified return-context marker under `lyfelabz.presentMode.returnContext` with schema `{ version: 1, returnSurface: "curriculum" }`, and the certified `Return to Teacher Workspace` control on the canonical instructional experience.
- Settings surface as a canonical teacher-only foundation state with informational future preference categories and no controls, persistence, or fake settings.
- Platform contract conformance: namespace, browser storage, versioned client-side schema, routing boundary, public/authenticated separation, projector safety, accessibility, and safe failure, per `PLATFORM_CONTRACTS.md`.
- Teacher Journey shape supported end-to-end: Prepare → Assign → Present Mode → Teach → Return.

### Intentionally deferred (not part of Version 1)

Snapshot for Classes; class analytics and spreadsheet-style workspace; teacher preferences and backend persistence for Assign; Google Classroom, Google Drive, and Google Meet integration; notifications; presentation tools, speaker notes, timers, broadcasting, and classroom synchronization; accommodations and private student supports.

### Files created

- `docs/platform/SPRINT_6_CERTIFICATION.md`
- `docs/platform/SPRINT_6_COMPLETION_REPORT.md`

### Files modified

- `docs/platform/SPRINT_HISTORY.md` (this entry).

### Repository validation

App package (working directory `/Users/breezy/Documents/GitHub/lyfelabz/app`):

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` produced `dist/bundle.js` (959.6 kB).
- `npm test -- --runInBand` passed 227 tests across 8 suites.

Functions package (working directory `/Users/breezy/Documents/GitHub/lyfelabz/platform/functions`):

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm test -- --runInBand` passed 295 tests across 22 suites.

Firestore Rules package (working directory `/Users/breezy/Documents/GitHub/lyfelabz/platform/firebase`):

- `npm run test:rules` passed 94 tests across 8 suites.

### Confirmations

- No production code was modified.
- No tests were modified.
- No runtime behavior was changed.
- No commits were made.

---

## Sprint 7A: Class Snapshot Experience and Architecture

**Date:** 2026-07-10
**Status:** Complete. Documentation-only sprint.
**Commit:** `0b29d5d` Sprint 7A: Design Class Snapshot experience and architecture
**Companion documents:** `CLASS_SNAPSHOT_EXPERIENCE.md`, `SNAPSHOT_ARCHITECTURE.md`.

### Objective

Ratify the Class Snapshot experience and its underlying architecture before implementation begins. Establish the Snapshot as the teacher's preparation-focused entry into a specific class - the answer to "what do I need to know about this class right now, before I teach?" - without introducing an analytics dashboard or a gradebook surrogate.

### Major accomplishments

- Created `CLASS_SNAPSHOT_EXPERIENCE.md` as the canonical product specification for the class-scoped Snapshot: purpose, non-goals, information density constraints, ordering rules, and the design principle that Snapshot is a preparation surface, not an analytics surface.
- Created `SNAPSHOT_ARCHITECTURE.md` as the companion architecture document: data sources, read shapes, projection boundaries, and the rules that keep Snapshot bounded and cheap.
- Documented the load-bearing product decisions: Snapshot always opens on a preparation view; recent submissions and the roster of students who have not yet submitted the latest assignment are load-bearing content; Snapshot never introduces engagement or marketing chrome; color is never load-bearing.

### Architecture posture

- No production code, tests, runtime behavior, Cloud Functions, Firestore Rules, custom claims, or lifecycle fields were introduced.
- Preservation mode intact. The instructional repository at the repository root was not touched.

---

## Sprint 7B: Class Snapshot Foundation

**Date:** 2026-07-10
**Status:** Implementation complete.
**Commit:** `81a2247` Sprint 7B: Implement Class Snapshot foundation
**Companion documents:** `CLASS_SNAPSHOT_EXPERIENCE.md`, `SNAPSHOT_ARCHITECTURE.md`.

### Objective

Land the client-side Class Snapshot foundation inside the Teacher Workspace Classes surface. Deliver the preparation-focused Snapshot view that opens when a teacher selects a class card, without introducing a new backend surface or an analytics dashboard.

### Major accomplishments

- Introduced `app/src/shell/surfaces/snapshot.ts` as the canonical Class Snapshot render surface. The Snapshot opens on selection of a class card and shows the preparation-first content ratified in Sprint 7A.
- Extended `app/src/shell/surfaces/classes.ts` with the class-card selection affordance that opens the Snapshot and the return path back to the Classes list.
- Wired the Snapshot through the existing workspace outlet (`app/src/shell/surfaces/workspace.ts`) so the shell composition and navigation contracts from Sprints 6A-6H are preserved.
- Extended `app/src/shell/shell.ts` with the composition needed to route selected-class state through the outlet.

### Architecture posture

- No Cloud Function, Firestore Rule, custom claim, lifecycle field, Session field, audit vocabulary term, or new callable surface was introduced.
- Certified architecture and platform contracts are unchanged. No new browser storage was introduced. The shell no-Firebase-import invariant is preserved; any Firestore-touching reader is injected through the existing dependency seam.
- Preservation mode intact.

---

## Sprint 8: LMS Foundation and Assignment Publication

**Date:** 2026-07-11
**Status:** Implementation complete.
**Commit:** `50ca28e` Sprint 8: LMS foundation and assignment publication
**Companion documents:** `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, `LMS_INTEGRATION_OPERATIONS.md`, `LMS_EXPERIENCE.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (§1.a, §2), `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-019, PDR-020).

### Objective

Ratify the LMS integration architecture, ship the first LMS foundation (Google Classroom), and connect the Assign Experience to an authoritative, server-mediated assignment lifecycle with optional one-way publication to a linked LMS.

### Major accomplishments

- Ratified LMS implementation sequencing and initial scope. Google Classroom is the initial LMS. Publication is one-way: LyfeLabz is the authoritative assignment record; publication is a side effect.
- Added provider-neutral LMS infrastructure (`platform/functions/src/lms/**`) with a canonical provider interface, a Google Classroom adapter, and server-mediated callables for connection begin / complete / describe / disconnect, class discovery / import, topic listing, and assignment publication.
- Added the teacher `Integrations` experience under the Settings surface (`app/src/settings/integrations/**`). Teachers can begin an LMS connection, complete OAuth, describe the current connection, and disconnect. Tokens are server-only and never appear in any client-reachable artifact.
- Added `LMS_EXPERIENCE.md` (product specification), `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, and `LMS_INTEGRATION_OPERATIONS.md` (runbook).
- Extended the Assign Experience with optional Google Classroom publication and connected Assign to the authoritative assignment lifecycle.
- Extended `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, and `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` with the initial LMS collections, direct Rules coverage, external-integrations principles (§1.a), and Section 2 responsibilities. Added the LMS audit vocabulary.
- Preserved provider neutrality, default-deny security, and the "no LMS SDK on the canonical instructional origin" invariant. Present Mode remains structurally separate.

### Architecture posture

- The client is never authoritative for LMS operations. All OAuth tokens, refresh tokens, and upstream credentials are held server-side. Every consequential LMS operation emits an `auditEvents` record under the reserved vocabulary.
- Assign remains the one workflow. Publication is opt-in per class row and never blocks activation.
- Preservation mode intact.

---

## Sprint 8E: LMS Refresh and Reconciliation

**Date:** 2026-07-11
**Status:** Implementation complete.
**Commit:** `7585214` Sprint 8E: LMS refresh and reconciliation
**Companion documents:** `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, `LMS_INTEGRATION_OPERATIONS.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (§2).

### Objective

Add the manual LMS refresh and reconciliation workflow that keeps a teacher's LMS-linked classes in sync with their upstream state, detects ownership drift and revoked access, and surfaces plain-language guidance without silent retries or automatic ownership reassignment.

### Major accomplishments

- Added a provider-neutral reconciliation callable (`platform/functions/src/lms/classes-refresh.ts`) that reads the upstream class state, compares it to the LyfeLabz mirror under the certified enrollment vocabulary (`active`, `transferred`, `withdrawn`, `archived`), and never hard-deletes an enrollment record.
- Detects ownership drift, revoked access, and missing upstream classes. On revocation, the connection is marked revoked and the class link is marked stale; the teacher sees a plain-language message on the next visit.
- Added class health evaluation and guidance surfaced through the Integrations experience. Refresh is manual and idempotent.
- Extended the teacher Integrations experience (`app/src/settings/integrations/**`) with refresh controls and health messaging.
- Reused the existing LMS audit vocabulary; no new vocabulary terms were introduced. Rules-level protections remain intact.

### Architecture posture

- Provider neutrality preserved. Default-deny security preserved. No token ever crosses the client boundary.
- No new custom claim, lifecycle field, or Firestore collection was introduced.
- Preservation mode intact.

---

## Sprint 9A: Assessment Pipeline Architecture Decision Workshop

**Date:** 2026-07-12
**Status:** Certified. Architecture-only sprint. No production code, Cloud Functions, or Firebase configuration was modified.
**Commit:** `451e407` Sprint 9A: Add canonical assessment pipeline specification and reconcile architecture
**Reconciliation report:** `SPRINT_9A_RECONCILIATION_REPORT.md`
**Canonical specification:** `ASSESSMENT_PIPELINE_SPECIFICATION.md`
**Decision record:** PDR-021 in `LYFELABZ_PLATFORM_DECISIONS.md`.

### Objective

Ratify the LyfeLabz formative assessment pipeline as a single canonical specification, remove ambiguity around submission versus attempt, formalize session semantics, lock in server-authoritative scoring and server-confidential answer keys, and reconcile every downstream document to defer to the new specification.

### Load-bearing ratifications

- Attempt is the single authoritative assessment record. There is no separate Submission entity. Session is a separate entity holding transient, resumable, autosaving working state.
- Scoring is server-authoritative; answer keys are server-confidential.
- Every assignment belongs to exactly one class; multi-class assignment is expressed as automatic per-class fan-out.
- The Practice / Classroom mode toggle is retired.
- Formative attempts are unlimited by default. Retake is reserved for the future summative pipeline.
- Assignment windows are backed by a one-hour grace period for sessions live at close.
- Sessions expire 24 hours after last activity and are archived; archived sessions are recoverable within a bounded window.
- Every attempt carries the internal assessment revision identifier at submission time. Revision boundaries are platform-owned.

### Files created

- `docs/platform/ASSESSMENT_PIPELINE_SPECIFICATION.md`
- `docs/platform/SPRINT_9A_RECONCILIATION_REPORT.md`

### Files reconciled

- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-008 reconciliation notice; PDR-021 added with seven sub-decisions).
- `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md`, `LYFELABZ_PLATFORM_DOMAIN_MODEL.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `PLATFORM_CONTRACTS.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `ASSIGN_EXPERIENCE.md`, `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_ENGINEERING_STANDARDS.md`.

### Architecture posture

- No application source, Cloud Function source, Firebase configuration, Firestore Rules, or emulator configuration was modified.
- Preservation mode intact.

---

## Sprint 9B: Platform Operations Architecture Decision Workshop

**Date:** 2026-07-12
**Status:** Certified. Architecture-only sprint. No production code, Cloud Functions, or Firebase configuration was modified.
**Commit:** `974617b` Sprint 9B: Add canonical platform operations specification and reconcile architecture
**Reconciliation report:** `SPRINT_9B_RECONCILIATION_REPORT.md`
**Canonical specification:** `PLATFORM_OPERATIONS_SPECIFICATION.md`
**Decision record:** PDR-022 in `LYFELABZ_PLATFORM_DECISIONS.md`.

### Objective

Ratify the LyfeLabz platform operations architecture as a single canonical specification. Establish Firebase Hosting as the permanent canonical production origin, formalize the three permanent environments, define the Certified Release, define rollback and maintenance mode, define operational monitoring and incident response, and set the operational Pilot Readiness bar for the Weston teacher pilot.

### Load-bearing ratifications

- Firebase Hosting is the permanent canonical production origin at `https://lyfelabz.com/`. Public curriculum and the authenticated platform share the origin under path-based routing. GitHub Pages is retained only as a migration safety net and will be retired.
- Three permanent environments: Development (local emulators), Preview (Firebase Hosting Preview Channels or a dedicated preview project mirroring production), and Production. No deployment moves from Development to Production without passing through Preview. A future Staging environment is deferred.
- A Certified Release is defined by ten criteria (architecture certified, documentation reconciled, implementation complete, local verification passed, security verification passed, operational documentation updated, preview deployment verified, Platform Administrator approval recorded, production deployment completed, and post-deployment health verified). Only Certified Releases are valid rollback targets.
- Rollback is one action and targets a previous Certified Release from Firebase Hosting's release history. Repairs happen in Preview; production is redeployed only after recertification.
- Production deployments never interrupt active classroom sessions, assessment sessions, or Present Mode.
- Section 22 defines the operational Pilot Readiness Certification for the Weston teacher pilot (twelve criteria).

### Files created

- `docs/platform/PLATFORM_OPERATIONS_SPECIFICATION.md`
- `docs/platform/SPRINT_9B_RECONCILIATION_REPORT.md`

### Files reconciled

- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-014 Sprint 9B reconciliation notice; PDR-022 added with eleven sub-decisions).
- `LYFELABZ_PLATFORM_ARCHITECTURE.md` (Section 12 superseded), `LYFELABZ_FIREBASE_BUILD_CHECKLIST.md`, `LMS_INTEGRATION_OPERATIONS.md`, `LYFELABZ_ENGINEERING_STANDARDS.md`.

### Architecture posture

- No application source, Cloud Function source, Firebase configuration, Firestore Rules, or emulator configuration was modified.
- Preservation mode intact.

---

## Sprint 9C: Identity and Onboarding Architecture Decision Workshop

**Date:** 2026-07-12
**Status:** Certified. Architecture-only sprint. No production code, Cloud Functions, or Firebase configuration was modified.
**Commit:** `7b1dfc7` Sprint 9C: Add canonical identity and onboarding specification and reconcile architecture
**Reconciliation report:** `SPRINT_9C_RECONCILIATION_REPORT.md`
**Canonical specification:** `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
**Decision record:** PDR-023 in `LYFELABZ_PLATFORM_DECISIONS.md`.

### Objective

Ratify the LyfeLabz identity, onboarding, verification, roster authority, and authenticated-experience-shell architecture as a single canonical specification. Promote the District entity to a first-class security boundary, replace the maintained verified-domain automated verification path with a verification-code path, and formalize roster authority as one-per-class.

### Load-bearing ratifications

- Authentication is not authorization. Google Workspace authenticates; the platform authorizes through the canonical claims (`role`, `schoolId`, `districtId`). `districtId` is promoted from a reserved slot to a claim written on every `active` identity.
- Domain hierarchy is `Platform → District → School → Teacher Identity → Class → Enrollment`. District is a first-class security boundary.
- Teacher identity is district-bound. Multi-school membership is expressed at the teacher-identity layer without relaxing class ownership.
- Verification prefers a one-time institution-bound verification code (§13.1). Request Teacher Access (§13.2) is the fallback. The maintained verified-domain automated path is retired.
- Every class has exactly one roster authority: Google Classroom for LMS-linked classes; LyfeLabz for manual classes. Join codes exist only for manual classes.
- Student identity is created only at first successful Google sign-in. Roster placeholders (`awaitingFirstSignIn`) exist on the class until then. Students never resolve identity ambiguity by hand.
- Three callable surfaces are named as canonical: verification-code redemption, join-code redemption, and first-sign-in activation. Names, signatures, and error codes are finalized by the implementation sprint that introduces them.
- The global header is uniform across LyfeLabz. Identity is never hidden inside the hamburger menu.

### Files created

- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
- `docs/platform/SPRINT_9C_RECONCILIATION_REPORT.md`

### Files reconciled

- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-003 Sprint 9C reconciliation notice; PDR-015 Sprint 9C reconciliation notice; PDR-023 added with fifteen sub-decisions).
- `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_PLATFORM_DOMAIN_MODEL.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_SPRINT_2_ONBOARDING_AND_VERIFICATION.md`, `PLATFORM_STATE_MACHINE.md`, `PLATFORM_CONTRACTS.md`, `LMS_INTEGRATION_ARCHITECTURE.md`, `TEACHER_JOURNEY.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md`.

### Architecture posture

- No application source, Cloud Function source, Firebase configuration, Firestore Rules, or emulator configuration was modified.
- Preservation mode intact.

---

## Sprint 9D: Platform Transition and Pilot Readiness

**Date:** 2026-07-12
**Status:** Certified. Architecture-only sprint. No production code, Cloud Functions, or Firebase configuration was modified.
**Commit:** `f8766d2` Sprint 9D: Add Platform Transition specification and reconcile Sprint 9 architecture
**Reconciliation report:** `SPRINT_9D_RECONCILIATION_REPORT.md`
**Canonical specification:** `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`
**Decision record:** PDR-024 in `LYFELABZ_PLATFORM_DECISIONS.md`.

### Objective

Close Sprint 9 by ratifying the product philosophy that governs the platform's transition from an instructional website into the first production teacher pilot, and the long-term learning-journey posture that follows. Define the product Pilot Readiness bar as a peer to Sprint 9B's operational Pilot Readiness bar.

### Load-bearing ratifications

- Teach First, Configure Second. First-time verified teachers receive an optional, non-blocking Welcome Guide, not a setup wizard.
- LyfeLabz is not a Learning Management System. The Teacher Workspace does not include a calendar, planner, curriculum-mapping tool, gradebook, messaging system, recommendation engine, or analytics dashboard.
- Activation and publication are separate. Activation controls access to lessons inside LyfeLabz. Publication sends assignments into Google Classroom.
- Google Classroom is the student assignment hub. LyfeLabz never competes for the student's attention with a second assignment list. Deep links land the student in the correct authorized attempt context silently.
- The student identity menu is exactly `My Assignments` and `My Results`. Submit equals completion. `Improve My Score` is offered on every less-than-perfect best score.
- Status indicators are `Ready to Begin`, `Improving`, `Well Done!`, `Perfect Score`, each carrying an accessible label. Color is never load-bearing.
- Learning belongs to the student. Archived lessons remain permanently accessible through the student's login. Teacher class archival never removes student learning history.
- Multi-year portfolio. Completed learning accumulates across Grade 6 through Grade 8 under the permanent LyfeLabz Student ID as a preservation surface, not a test-prep product.
- Calm software. No email, push, marketing, or engagement notifications.
- Pilot Readiness is both operational and product. Section 10.1 defines the product bar; `PLATFORM_OPERATIONS_SPECIFICATION.md` §22 continues to define the operational bar.

### Files created

- `docs/platform/PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`
- `docs/platform/SPRINT_9D_RECONCILIATION_REPORT.md`

### Files reconciled

- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-022 Sprint 9D reconciliation notice; PDR-024 added with eighteen sub-decisions).
- `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` (Sprint 9 Foundational Specification Set cross-reference), `PLATFORM_OPERATIONS_SPECIFICATION.md` (Sprint 9 Foundational Specification Set cross-reference), `ASSESSMENT_PIPELINE_SPECIFICATION.md` (Sprint 9 Foundational Specification Set cross-reference), `TEACHER_EXPERIENCE_PHILOSOPHY.md`, `TEACHER_JOURNEY.md`, `LMS_EXPERIENCE.md`, `ASSIGN_EXPERIENCE.md`, `CLASS_SNAPSHOT_EXPERIENCE.md`.

### Architecture posture

- No application source, Cloud Function source, Firebase configuration, Firestore Rules, or emulator configuration was modified.
- Preservation mode intact.

---

## Sprint 9E: Platform Architecture Certification

**Date:** 2026-07-12
**Status:** **Architecture Certified. Implementation may resume.** Architecture-only sprint. No production code, Cloud Functions, or Firebase configuration was modified. No commits were made.
**Detailed certification:** `SPRINT_9E_PLATFORM_ARCHITECTURE_CERTIFICATION.md`
**Companion documents:** `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_PLATFORM_DECISIONS.md`, `ASSESSMENT_PIPELINE_SPECIFICATION.md`, `PLATFORM_OPERATIONS_SPECIFICATION.md`, `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`, `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`.

### Objective

Certify that the LyfeLabz platform architecture is complete, internally consistent, and ready for implementation to resume. Confirm that engineers can build against the certified corpus without inventing platform behavior. Record any genuine architectural gap as a future decision item rather than solving it in Sprint 9E.

### Certification method

The four Sprint 9 foundational specifications (9A - 9D), the master platform architecture, the Platform Decision Records (PDR-001 - PDR-024), the domain and data model documents, the security model, the Cloud Function charter, `PLATFORM_CONTRACTS.md`, `PLATFORM_STATE_MACHINE.md`, and the teacher and student experience specifications were reviewed as a single unified architectural corpus. Each Sprint 9E charter criterion (canonical ownership, internal consistency, cross references, user journey completeness, security boundaries, platform philosophy, operational readiness) was evaluated against the corpus. Findings and unresolved items were recorded.

### Certification conclusion

**Architecture Certified. Implementation may resume.**

The three documentation-only conditions identified during Sprint 9E were resolved editorially within Sprint 9E and no new blocking inconsistency was discovered:

- **G-1 resolved.** `SPRINT_HISTORY.md` was back-filled with entries for Sprints 7A, 7B, 8, 8E, 9A, 9B, 9C, and 9D drawn from the certified per-sprint documents and reconciliation reports. The Sprint 9E entry is updated to reflect the certified conclusion.
- **G-2 resolved.** `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` Appendix A now enumerates the three Sprint 9C identity callables (verification-code redemption, join-code redemption, first-sign-in activation) with their authority boundaries, atomicity, idempotency, and audit vocabulary. Concrete function names, argument shapes, and error codes are left to the first implementation sprint that introduces them.
- **G-6 resolved.** `LYFELABZ_PLATFORM_ARCHITECTURE.md` §9 was rewritten as a high-level narrative that defers to `ASSESSMENT_PIPELINE_SPECIFICATION.md` for every load-bearing behavior (attempt versus session, server-authoritative scoring, answer-key custody, immediate feedback, revision stamping, submit equals completion, per-class assignments, and the removal of the Practice / Classroom mode toggle).

Three items previously carried as future decisions - G-3 (School Administrator role), G-4 (suspension, reinstatement, and archival of user identities), and G-5 (parent accounts) - are reclassified as intentional future architecture or roadmap boundaries. They are explicitly outside the current pilot architecture and do not require engineers to invent behavior during the certified implementation scope.

### Architecture strengths recorded

- Four coherent Sprint 9 specifications with declared internal precedence.
- Explicit reconciliation notices at the top of `LYFELABZ_PLATFORM_ARCHITECTURE.md` and inline in `LYFELABZ_PLATFORM_DECISIONS.md`.
- Session / attempt separation, server-authoritative scoring, and server-confidential answer keys.
- District promoted to a first-class security boundary.
- One roster authority per class.
- Activation and publication kept separate; Google Classroom remains the assignment hub.
- Pilot bounded by an explicit Sprint 9D §4.2 out-of-scope list guarding against LMS drift.
- Two readiness bars for the pilot: operational (Sprint 9B §22) and product (Sprint 9D §10.1).

### Files created

- `docs/platform/SPRINT_9E_PLATFORM_ARCHITECTURE_CERTIFICATION.md`

### Files modified

- `docs/platform/SPRINT_HISTORY.md` (this entry).

### Confirmations

- No application source, Cloud Function source, Firestore configuration, security rules, or emulator configuration was modified.
- No test file was modified.
- No runtime behavior was changed.
- No commits were made.

---

## Sprint 10A Step F-1: District Security Boundary Implementation Contract

**Date:** 2026-07-12
**Status:** Step F-1 complete. Architecture-only step. No production code, Cloud Functions, Firestore Rules, configuration, or tests were modified. No commits were made. Sprint 10A remains open; F-2 has not been started.
**Reconciliation report:** `SPRINT_10A_F1_DISTRICT_SECURITY_BOUNDARY_REPORT.md`
**Canonical specification:** `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`
**Decision record:** PDR-025 in `LYFELABZ_PLATFORM_DECISIONS.md`.

### Objective

Address the first primary finding from the Sprint 9E independent architecture review by reconciling the district enforcement model into a single implementation contract. Translate the certified architecture (PDR-023c, PDR-023d, PDR-015 Sprint 9C notice) into engineer-facing normative rules for server-side district isolation across Firestore, Cloud Functions, custom claims, session behavior, and audit events, without redesigning identity, onboarding, or platform-operations behavior.

### Load-bearing ratifications

- Firestore `users/{uid}` is the durable authority for role, account state, school membership, and district membership. Custom claims are an authorization projection of that record.
- The recognized custom claim shape is `{ role, schoolId, districtId }`. All three are server-issued. Claims are written only when `status === "active"` and cleared on any transition out of `active`.
- Clients MUST NOT submit `districtId`, `schoolId`, or `role` as authoritative input. Every callable derives ownership from server state.
- Firestore Security Rules compare the caller's `districtId` claim to the resource's canonical district ownership. Rules default to deny.
- Cross-district references are refused at both the callable layer and the rule layer.
- Platform administrator access is explicit and bounded. The administrator claim shape MAY omit `districtId` and `schoolId` as the canonical administrator sentinel; the sentinel is unavailable to any other role.
- Client-driven `districtId` mutation is denied. A district transfer callable is not authorized in Sprint 10A; new-identity provisioning per PDR-023d and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §18 is the interim path.
- Stale sessions fail closed. When token claims and the canonical record disagree, both the callable and the rule layer deny the operation.
- Every district-relevant transition emits an `auditEvents` record under the certified append-only vocabulary. No second audit sink is created.

### Files created

- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/SPRINT_10A_F1_DISTRICT_SECURITY_BOUNDARY_REPORT.md`

### Files reconciled

- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-025 added with eleven sub-decisions; change log extended).
- `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LMS_INTEGRATION_ARCHITECTURE.md`, `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (narrow edits retiring the residual `reserved districtId` language and pointing at PDR-025).

### Architecture posture

- No application source, Cloud Function source, Firebase configuration, Firestore Rules, or emulator configuration was modified.
- No test file was modified.
- No runtime behavior was changed.
- Preservation mode intact.

### Confirmations

- No em dash appears in any created or modified document.
- No commits were made. F-2 has not been started.

---

## Sprint 10A Step F-2: Assessment Implementation Contract

**Date:** 2026-07-12
**Status:** Step F-2 complete. Architecture-only step. No production code, Cloud Functions, Firestore Rules, configuration, or tests were modified. No commits were made. Sprint 10A remains open; further steps beyond F-2 have not been started.
**Reconciliation report:** `SPRINT_10A_F2_ASSESSMENT_IMPLEMENTATION_REPORT.md`
**Canonical specification:** `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
**Decision record:** PDR-026 in `LYFELABZ_PLATFORM_DECISIONS.md`.

### Objective

Address the second primary finding from the Sprint 9E independent architecture review by reconciling the formative assessment pipeline into a single implementation contract. Translate the certified architecture (PDR-021, PDR-008 as amended by Sprint 9A, PDR-024) into engineer-facing normative rules for sessions, attempts, revisions, answer keys, callable ownership, Firestore collection ownership, index strategy, and audit events, without redesigning any product behavior established by PDR-021.

### Load-bearing ratifications

- `attempts/{attemptId}` supersedes `submissions/{submissionId}` for the formative pipeline. Attempts are immutable after write.
- `assessmentSessions/{sessionId}` is a distinct collection from `attempts`. Only one Live session MAY exist per (student, assignment).
- `assessmentAttemptsFinalize` is the sole writer of `attempts/*`. The pre-Sprint 9A `submissionsCreate` / `submissionsFinalize` split is retired.
- Answer keys live only in `assessmentAnswerKeys/{revisionId}`. Firestore Security Rules refuse client reads for every role, including `platformAdministrator`. Administrative inspection routes through an audited callable.
- Assessment revisions are internal, monotonic, and never surface to teachers. Every attempt records the revision it was scored against; revisions are never deleted while an attempt references them.
- `attemptRollups/{assignmentId}__{studentId}` and `assignmentRollups/{assignmentId}` serve `My Results`, `Improve My Score`, and the five-metric teacher surface. Both are rewritten atomically on every attempt write by a single rollup Cloud Function. No teacher surface reads `attempts/*` in bulk.
- Every callable also satisfies the district enforcement contract in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12.
- Assessment audit vocabulary is fixed. Autosave and rollup recomputation are not audited event-by-event. No second audit sink is created.
- Practice Mode remains client-only. `practice`-mode assignments are refused by `assessmentSessionsBegin`.

### Files created

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/SPRINT_10A_F2_ASSESSMENT_IMPLEMENTATION_REPORT.md`

### Files reconciled

- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-026 added with nine sub-decisions; change log extended).
- `ASSESSMENT_PIPELINE_SPECIFICATION.md` (narrow implementation-contract pointer added to the front matter; no behavior clause changed).
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (Sprint 10A F-2 Reconciliation Notice prepended; Sprint 9A notice preserved).
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` (Sprint 10A F-2 Reconciliation Notice prepended; Sprint 9A notice preserved).

### Architecture posture

- No application source, Cloud Function source, Firebase configuration, Firestore Rules, or emulator configuration was modified.
- No test file was modified.
- No runtime behavior was changed.
- Preservation mode intact.

### Confirmations

- No em dash appears in any created or modified document.
- No commits were made. Sprint 10A has not been closed by this step.

---

## Sprint 10A Step F-3: Google Classroom Deep-Link Implementation Contract

**Date:** 2026-07-12
**Status:** Step F-3 complete. Architecture-only step. No production code, Cloud Functions, Firestore Rules, configuration, or tests were modified. No commits were made. Sprint 10A remains open; further steps beyond F-3 have not been started.
**Reconciliation report:** `SPRINT_10A_F3_GOOGLE_CLASSROOM_IMPLEMENTATION_REPORT.md`
**Canonical specification:** `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`
**Decision record:** PDR-027 in `LYFELABZ_PLATFORM_DECISIONS.md`.

### Objective

Address the third primary finding from the Sprint 9E independent architecture review by reconciling the Google Classroom deep-link, publication, and resolution model into a single implementation contract. Translate the certified architecture (PDR-019, PDR-020, PDR-024f, PDR-024g, PDR-024h) into engineer-facing normative rules for the deep-link URL, the resolution callable, the publication callable, multiple-class publication behavior, multiple-teacher publication behavior, Classroom synchronization ownership, Cloud Function ownership, Firestore ownership, and audit vocabulary, without redesigning any product behavior established by PDR-019, PDR-020, or PDR-024.

### Load-bearing ratifications

- LyfeLabz owns the deep-link URL. The shape `https://lyfelabz.com/app/a/{assignmentId}` is the sole authorized Classroom coursework link material. The URL never carries a token, session identifier, student identifier, score, answer-key excerpt, or Classroom coursework identifier.
- The canonical LyfeLabz `assignmentId` is the load-bearing authorization key. Classroom coursework identifiers are recorded for reconciliation only.
- `lmsAssignmentPublish` is the sole writer of `lmsAssignmentPublications/*` and of `assignments/{assignmentId}.lmsPublicationRef`. The transaction is atomic; failed Classroom writes leave no publication document. Idempotency is enforced by a client-supplied marker AND a deterministic identifier.
- `lmsDeepLinkResolve` is read-only. It never writes to `assessmentSessions/*`, `attempts/*`, `assignments/*`, `lmsAssignmentPublications/*`, or `lmsClassLinks/*`. Session creation remains the sole responsibility of `assessmentSessionsBegin`.
- Fan-out publication is per (assignment, class). Each target succeeds or fails independently. The deterministic identifier refuses a second publication of the same assignment against the same Classroom course.
- LyfeLabz enforces a single teacher-of-record per LyfeLabz class. Classroom co-teachers do not authorize LyfeLabz publication. Ownership drift refuses publication and marks the link stale; LyfeLabz never silently reassigns class ownership.
- Classroom synchronization is bounded to list, read-roster, and create-one-coursework operations. LyfeLabz never posts to the class stream, comments, messages, grades, edits published coursework after create, deletes Classroom state, or reads non-LyfeLabz Classroom content.
- Every callable also satisfies the district enforcement contract in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12. Cross-district publications and resolutions are refused. Every publication document carries `districtId`.
- The audit vocabulary is fixed: `lms.assignmentPublished`, `lms.publishFailed`, `lms.deepLinkResolved`, `lms.ownershipDrift`, and (reserved for future unpublish) `lms.assignmentUnpublished`. No second audit sink is created.

### Files created

- `docs/platform/GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/SPRINT_10A_F3_GOOGLE_CLASSROOM_IMPLEMENTATION_REPORT.md`

### Files reconciled

- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-027 added with ten sub-decisions; change log extended).
- `LMS_INTEGRATION_ARCHITECTURE.md` (Sprint 10A F-3 Reconciliation Notice prepended; every load-bearing decision preserved).
- `LMS_EXPERIENCE.md` (Sprint 10A F-3 Reconciliation Notice prepended; teacher-facing surfaces remain authoritative).
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (Sprint 10A F-3 Reconciliation Notice prepended; Sprint 10A F-2 and Sprint 9A notices preserved).
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` (Sprint 10A F-3 Reconciliation Notice prepended; Sprint 10A F-2 and Sprint 9A notices preserved; no document shape changed).
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` (Sprint 10A F-3 Reconciliation Notice prepended; §5 remains authoritative for product behavior).

### Architecture posture

- No application source, Cloud Function source, Firebase configuration, Firestore Rules, or emulator configuration was modified.
- No test file was modified.
- No runtime behavior was changed.
- Preservation mode intact.

### Confirmations

- No em dash appears in any created or modified document.
- No commits were made. Sprint 10A has not been closed by this step.

---

## Sprint 10A Step F-4: Roster Display Name Implementation Contract

**Date:** 2026-07-12
**Status:** Step F-4 complete. Architecture-only step. No production code, Cloud Functions, Firestore Rules, configuration, or tests were modified. No commits were made. Sprint 10A remains open; certification of Sprint 10A has not been started.
**Reconciliation report:** `SPRINT_10A_F4_ROSTER_DISPLAY_NAME_IMPLEMENTATION_REPORT.md`
**Canonical specification:** `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`
**Decision record:** PDR-028 in `LYFELABZ_PLATFORM_DECISIONS.md`.

### Objective

Address the fourth and final primary finding from the Sprint 9E independent architecture review by defining the canonical ownership model for teacher-readable roster display names. Eliminate the circular reference recorded by the review: the display name a teacher reads on a roster may be resolved from the user, from the enrollment override, or from the placeholder, and prior to this step the "authoritative" answer was not uniformly named. Translate the certified architecture (PDR-003, PDR-005, PDR-011, PDR-019, PDR-023) into engineer-facing normative rules for canonical ownership, Firestore ownership, Cloud Function ownership, the teacher-facing roster resolver, Google profile interaction, LMS roster refresh, historical consistency, and audit vocabulary, without redesigning any product behavior established by PDR-003, PDR-005, PDR-011, PDR-019, or PDR-023.

### Load-bearing ratifications

- `users/{uid}.displayName` is the sole canonical display name for a signed-in person. No other collection duplicates it. No callable derives an authorization decision from it.
- `enrollments/{enrollmentId}.displayNameOverride` is the sole authorized per-class presentation override. It never propagates to `users/{uid}.displayName`, never propagates to another enrollment, and never becomes the canonical display name.
- The roster placeholder name is not a display name for a LyfeLabz identity. It is written only by `lmsClassImport` and `lmsClassRefresh` and is retired at placeholder resolution.
- The teacher-facing roster resolver is a single, canonical function: per-class override, then resolved `users/{uid}.displayName`, then placeholder name, then null.
- The Google profile display name is a source only at first sign-in. LyfeLabz never re-reads it into any canonical field afterwards.
- The LMS-reported display name never overwrites `users/{uid}.displayName` for a resolved enrollment. LMS refresh applies confirmed name-change deltas to placeholders only.
- A single shared normalizer validates every display-name write.
- No attempt, session, submission, rollup, class, or assignment carries a denormalized display-name copy.
- Every callable also satisfies the district enforcement contract in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12.
- The audit vocabulary is fixed: `users.displayNameChanged`, `enrollments.displayNameOverrideChanged`, `roster.placeholderNameChanged`, `roster.placeholderResolved`. No second audit sink is created.

### Files created

- `docs/platform/ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/SPRINT_10A_F4_ROSTER_DISPLAY_NAME_IMPLEMENTATION_REPORT.md`

### Files reconciled

- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-028 added with ten sub-decisions; change log extended).
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` (Sprint 10A F-4 Reconciliation Notice prepended; prior Sprint 10A F-3, Sprint 10A F-2, Sprint 9A, and Sprint 9C notices preserved; no document shape changed).
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (Sprint 10A F-4 Reconciliation Notice prepended; prior Sprint 10A F-3, Sprint 10A F-2, and Sprint 9A/9C notices preserved).
- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` (Sprint 10A F-4 Reconciliation Notice prepended; Sprint 9D notice preserved; identity architecture preserved).
- `LMS_INTEGRATION_ARCHITECTURE.md` (Sprint 10A F-4 Reconciliation Notice prepended; Sprint 10A F-3 and Sprint 9C notices preserved; every load-bearing decision preserved).
- `LMS_EXPERIENCE.md` (Sprint 10A F-4 Reconciliation Notice prepended; Sprint 10A F-3 and Sprint 9D notices preserved; teacher-facing surfaces remain authoritative).

### Architecture posture

- No application source, Cloud Function source, Firebase configuration, Firestore Rules, or emulator configuration was modified.
- No test file was modified.
- No runtime behavior was changed.
- Preservation mode intact.

### Confirmations

- No em dash appears in any created or modified document.
- No commits were made. Sprint 10A has not been closed by this step.

---

## Sprint 10A: Implementation Contract Layer

**Dates:** 2026-07-12 to 2026-07-13
**Status:** Complete and certified. Documentation-only sprint. No implementation code, Cloud Functions, Firestore Rules, indexes, configuration, or tests were modified. No commits were made.
**Detailed report:** SPRINT_10A_COMPLETION_REPORT.md
**Certification:** SPRINT_10A_CERTIFICATION.md
**Reconciliation report:** SPRINT_10A_FINAL_RECONCILIATION_REPORT.md
**Step reports (preserved above):** SPRINT_10A_F1, F-2, F-3, F-4.

### Objective

Close the four primary findings from the Sprint 9E independent architecture review by producing an implementation contract layer that sits between the certified product architecture and the implementation sprint. Give each implementation responsibility a single canonical owner. Ratify each owner as a versioned Platform Decision Record. Change no runtime code.

### Major accomplishments

- Ratified four new Platform Decision Records: PDR-025 District Security Boundary, PDR-026 Assessment Implementation, PDR-027 Google Classroom Deep-Link, PDR-028 Roster Display Name. No pre-Sprint 10A PDR was amended.
- Delivered four implementation contracts: `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`, `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`, `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`. Each contract names, for its authority slice, every callable, Firestore collection, audit event, claim, rule invariant, idempotency contract, and error identifier the implementation sprint MUST honor.
- Prepended reconciliation notices to every certified document that references implementation ownership so no reader is routed to the older document by mistake. Sprint 9A, Sprint 9C, and Sprint 9D notices were preserved above the older content unchanged.
- Performed a final cross-contract reconciliation review. Applied two narrow, in-place corrections without amending any PDR: two `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §5 bullets that pre-dated Sprint 9C were replaced with statements referencing PDR-025; a Sprint 10A F-2 Reconciliation Notice was prepended to `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` so residual `submissions*` names route to PDR-026.
- Certified Sprint 10A. The implementation contract layer is internally consistent, externally consistent with the Sprint 9E product architecture certification, and free of duplicated ownership or unassigned responsibility. Implementation is authorized to resume.

### Load-bearing ratifications

- District enforcement is authoritative in PDR-025 and additive under PDR-026g, PDR-027h, and PDR-028i.
- Custom claim shape is `{ role, schoolId, districtId }`. All three are server-issued. Claims are written only when `status === "active"` and cleared on every transition out of `active`. Client-driven `districtId` mutation is denied at both the callable and rule layers.
- `attempts/{attemptId}` supersedes `submissions/{submissionId}` for the formative pipeline. `assessmentAttemptsFinalize` is the sole writer. `assessmentAnswerKeys/*` is unreadable to every client role.
- The deep-link URL `https://lyfelabz.com/app/a/{assignmentId}` is the sole authorized Classroom coursework link material. `lmsAssignmentPublish` is the sole writer of `lmsAssignmentPublications/*`. `lmsDeepLinkResolve` is read-only.
- `users/{uid}.displayName` is the sole canonical display name. `enrollments/{enrollmentId}.displayNameOverride` is the sole per-class presentation override and never propagates. The canonical resolver ordering is override, then resolved user display name, then placeholder, then null.
- Audit vocabulary is partitioned across contracts. No two contracts define the same event. No contract creates a second audit sink.

### Product architecture versus implementation architecture

Sprint 9 completed the platform's product architecture: what LyfeLabz does, how it behaves, and what its data model, state machine, and security posture are. Sprint 10A completed the platform's implementation architecture: who owns each implementation responsibility and how each responsibility is realized in the codebase. Both layers are required before implementation begins. Sprint 10A did not redesign product architecture.

### Files created

- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/SPRINT_10A_F1_DISTRICT_SECURITY_BOUNDARY_REPORT.md`
- `docs/platform/SPRINT_10A_F2_ASSESSMENT_IMPLEMENTATION_REPORT.md`
- `docs/platform/SPRINT_10A_F3_GOOGLE_CLASSROOM_IMPLEMENTATION_REPORT.md`
- `docs/platform/SPRINT_10A_F4_ROSTER_DISPLAY_NAME_IMPLEMENTATION_REPORT.md`
- `docs/platform/SPRINT_10A_FINAL_RECONCILIATION_REPORT.md`
- `docs/platform/SPRINT_10A_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_10A_CERTIFICATION.md`

### Files reconciled

- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-025 through PDR-028 appended; change log extended).
- `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md` (Sprint 9C notice updated in place to point at PDR-025).
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md` (Sprint 10A F-2, F-3, F-4 reconciliation notices prepended above the preserved Sprint 9A and Sprint 9C notices).
- `ASSESSMENT_PIPELINE_SPECIFICATION.md` (implementation-contract pointer recorded in the precedence block).
- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` (Sprint 10A F-4 notice prepended above the preserved Sprint 9D notice).
- `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_EXPERIENCE.md` (Sprint 10A F-3 and F-4 notices prepended above the preserved Sprint 9C and Sprint 9D notices).
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` (Sprint 10A F-3 notice prepended).
- `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (Sprint 10A F-1 pointer added; two §5 bullets corrected in the final reconciliation pass).
- `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (Sprint 10A F-2 Reconciliation Notice prepended in the final reconciliation pass; no table cell, invariant, or callable behavior statement rewritten).
- `SPRINT_HISTORY.md` (step-level F-1 through F-4 and final reconciliation entries preserved above; this consolidated Sprint 10A summary replaces the earlier standalone Final Reconciliation entry).

### Architecture posture

- No PDR authored before Sprint 10A was amended. No implementation contract was redesigned. No product behavior clause was rewritten.
- No file under `platform/functions/**`, `platform/firebase/**`, `platform/emulator/**`, or `app/**` was modified.
- No test file was modified. No CI, Firebase, or emulator configuration was modified.
- Preservation mode remains intact. No file at the repository root was modified.

### Repository validation

Sprint 10A is documentation only. The certified test baselines from Sprint 9E carry forward unchanged.

- `platform/functions` typecheck, lint, and build unchanged.
- `platform/functions` unit test baseline unchanged.
- `platform/firebase` Rules test baseline unchanged.
- `app` typecheck, lint, build, and unit test baseline unchanged.

### Confirmations

- No em dash appears in any created or modified document.
- No documentation link introduced by Sprint 10A resolves to a missing file.
- No commits were made.

### Certification statement

Sprint 10A is complete and certified. The implementation contract layer defined by PDR-025 through PDR-028 is internally consistent, externally consistent with the Sprint 9E certified product architecture, and free of duplicated ownership or unassigned responsibility. Implementation may resume. See `SPRINT_10A_CERTIFICATION.md` for the authoritative certification artifact.

---

## Sprint 11A: Certified Contract Implementation Inventory

**Dates:** 2026-07-13
**Status:** Complete (inventory only)
**Detailed report:** SPRINT_11A_IMPLEMENTATION_INVENTORY.md

### Objective

Compare the current LyfeLabz repository against the four canonical Sprint 10A implementation contracts (PDR-025 District Security Boundary, PDR-026 Assessment Implementation, PDR-027 Google Classroom Deep-Link, PDR-028 Roster Display Name) and produce an evidence-based inventory that names, for each contract requirement and required test category, whether the repository is Implemented, Partially Implemented, Missing, Conflicting, or Not Applicable. Recommend a bounded implementation sequence. Select exactly one Sprint 11B slice. Change no runtime code.

### Documents reviewed

- The four Sprint 10A implementation contracts (`DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`, `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`, `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`).
- `SPRINT_10A_CERTIFICATION.md`, `SPRINT_10A_FINAL_RECONCILIATION_REPORT.md`, `SPRINT_10A_COMPLETION_REPORT.md`.
- Supporting authorities: `LYFELABZ_PLATFORM_DECISIONS.md`, `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md`, `PLATFORM_STATE_MACHINE.md`, `PLATFORM_CONTRACTS.md`, `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, `LMS_EXPERIENCE.md`, `ASSESSMENT_PIPELINE_SPECIFICATION.md`, `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`, `PLATFORM_OPERATIONS_SPECIFICATION.md`.
- Repository code and configuration under `platform/functions/src/**`, `platform/firebase/firestore.rules`, `platform/firebase/firestore.indexes.json`, `platform/firebase/tests/**`, and `app/src/**`.

### The four contract assessments

- **PDR-025 District Security Boundary.** The canonical claim shape reserves `districtId` but ships as `{ role, schoolId }` only (`platform/functions/src/shared/auth/claims.ts:17-20`). No Firestore document carries `districtId`. No rule compares it. No callable derives or enforces it. The activation callables, resource ownership chains, cross-district prevention, stale-claim behavior, canonical error identifiers, and Rules and emulator test matrices from §11 through §19 are Missing. The claims writer, `PlatformError`, audit-event writer, and Sprint 2 self-write allowlist are preserved foundations.
- **PDR-026 Assessment Implementation.** The seven assessment collections (`assessments`, `assessmentRevisions`, `assessmentAnswerKeys`, `assessmentSessions`, `attempts`, `attemptRollups`, `assignmentRollups`) do not exist. None of the eleven §21 callables is exported. `submissions/{submissionId}` with `submissionsCreate` and `submissionsFinalize` remains in place and is superseded by `attempts/{attemptId}` and `assessmentAttemptsFinalize` per §21 and §26. Composite indexes, audit vocabulary, and error identifiers are Missing.
- **PDR-027 Google Classroom Deep-Link.** The publication callable exists as `lmsAssignmentsPublish` (plural) at `platform/functions/src/lms/assignments-publish.ts` and is the sole writer of the publication mirror. Three reconciliations are required by the contract: rename to `lmsAssignmentPublish`; remove the client-supplied `lyfelabzAssignmentUrl` and introduce a single server-side URL builder for `https://lyfelabz.com/app/a/{assignmentId}` per §8.3; adopt the deterministic ordinal identifier per §12. `lmsDeepLinkResolve`, `lmsAssignmentUnpublish`, `lmsClassUnlink`, and `lmsOwnershipDriftHandler` are Missing. Required indexes on `lmsAssignmentPublications` and the resolver audit event `lms.deepLinkResolved` are Missing.
- **PDR-028 Roster Display Name.** `users.displayName` and `enrollments.displayNameOverride` fields exist. The Sprint 2 rules-allowlisted self-write is present. `enrollmentsSetDisplayNameOverride`, `usersUpdateProfile` or the `usersOnDisplayNameChange` trigger, `usersFirstSignInActivation`, the shared normalizer, the shared resolver, and the roster placeholder shape are Missing. The four required audit event names are not emitted anywhere. `lmsClassImport` does not yet write placeholder names.

### Recommended implementation sequence

Twenty bounded slices in dependency order. Slice 1 lands the shared district context (extends the canonical claim shape, adds the district error identifier vocabulary, introduces the `requireDistrictContext` helper). Slices 2 through 5 propagate `districtId` through activation callables, denormalization on child resources, Firestore Rules, and app-side session reconciliation. Slices 6 through 9 land the display-name normalizer, resolver, audit vocabulary, the rename path, the override callable, and the roster placeholder shape and first-sign-in activation callable. Slices 10 through 12 land the deep-link URL builder and parser, the publication callable reconciliation, and the deep-link resolver. Slices 13 through 19 land the assessment collection scaffolding, session callables, attempt transaction, rollup Cloud Function, scheduled sweep/purge/recover, administrative answer-key read, the `submissions` migration, and the `My Results` and teacher analytics consumers. Slice 20 reserves the unpublish callable and the district transfer callable. Full detail is in `SPRINT_11A_IMPLEMENTATION_INVENTORY.md` §13.

### Selected Sprint 11B scope

Slice 1 - PDR-025 shared district context. Extend `platform/functions/src/shared/auth/claims.ts` so `CanonicalCustomClaims` and `WriteCustomClaimsInput` require `districtId`. Extend `platform/functions/src/shared/errors/platform-error.ts` with the closed set of district-boundary error identifiers from PDR-025 §17 (`unauthenticated`, `account-inactive`, `role-forbidden`, `district-unassigned`, `district-mismatch`, `school-district-mismatch`, `cross-district-reference`, `claim-stale`, `claim-state-mismatch`, `server-only-field`, `transfer-not-supported`). Add a new `platform/functions/src/shared/auth/require-district-context.ts` helper that verifies auth, reads `users/{uid}`, refuses non-`active` status, resolves `districtId` through `schools/{schoolId}`, and compares the caller claim to the record. Add colocated unit tests. This is the first PDR-025 §20 checklist item, unblocks every downstream contract, touches only the shared module, is verifiable through Jest without an emulator round-trip, and carries no migration risk because no callable yet consumes the extended shape.

### Files created

- `docs/platform/SPRINT_11A_IMPLEMENTATION_INVENTORY.md`

### Files modified

- `docs/platform/SPRINT_HISTORY.md` (this entry only)

### Confirmation

- No production code, Cloud Function, app code, shared type, Firestore Rule, index, test, or configuration was modified.
- No certified architecture contract, PDR, completion report, or certification report was modified.
- No em dash appears in either created or modified document.
- Every matrix conclusion in the inventory carries repository evidence.
- Every checklist item and required test category from PDR-025 through PDR-028 is represented.
- Exactly one Sprint 11B implementation slice was selected.
- No commits were made.

## Sprint 11B Slice 1: PDR-025 Shared District Context

Sprint 11B implements the first slice identified by the Sprint 11A implementation inventory (§13, §14). The slice extends the canonical custom-claims shape with `districtId`, declares the closed-set district-boundary error identifier vocabulary from PDR-025 §17, and introduces the shared `requireDistrictContext` authorization helper. The two existing `writeCustomClaims` callers (`teachersApproveVerification`, `studentsCompleteOnboarding`) receive narrowly scoped mechanical updates so that the certified claim type can be made strictly required without an unsafe optional-input transition. No callable lifecycle is redesigned. No Firestore Rules, app code, LMS integration, assessment pipeline, or display-name path is modified.

### Canonical authority

- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (PDR-025), primary implementation authority for §6 canonical claim shape, §12 callable enforcement obligations, §15 stale-claim reconciliation, and §17 error identifier vocabulary.
- `docs/platform/SPRINT_11A_IMPLEMENTATION_INVENTORY.md` §13 Slice 1 and §14 recommended Sprint 11B scope.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §2 canonical claim shape convention.
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md` for identity and school-to-district resolution rules.
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` for the rule-layer baseline this helper unblocks.
- `docs/platform/PLATFORM_CONTRACTS.md` §client-storage prohibitions inherited by the helper.
- `docs/platform/PLATFORM_STATE_MACHINE.md` §1 for the closed user-status enumeration.

### Files created

- `platform/functions/src/shared/errors/district-errors.ts` (closed-set `DISTRICT_ERROR_IDS`, `DistrictErrorId` type, `isDistrictErrorId` guard).
- `platform/functions/src/shared/auth/require-district-context.ts` (shared authorization helper).
- `platform/functions/src/shared/auth/require-district-context.test.ts` (34 unit tests).
- `docs/platform/SPRINT_11B_SLICE1_COMPLETION_REPORT.md` (this slice's completion report).

### Files modified

- `platform/functions/src/shared/auth/claims.ts` (add `districtId` to `CanonicalCustomClaims` and to `WriteCustomClaimsInput` as strictly required; runtime validation for non-empty districtId; write the three-field canonical shape). The TypeScript and runtime contracts agree.
- `platform/functions/src/shared/auth/claims.test.ts` (pin the three-field canonical shape; add missing-and-empty districtId refusal cases; update overwrite semantics assertions).
- `platform/functions/src/shared/index.ts` (barrel re-exports for `requireDistrictContext`, `DistrictContext`, `DistrictClaimToken`, `DISTRICT_ERROR_IDS`, `DistrictErrorId`, `isDistrictErrorId`).
- `platform/functions/src/teachers/teachers-approve-verification.ts` (resolve `districtId` from the canonical `schools/{schoolId}` record via the typed reference, refuse with `school-district-mismatch` when the school document is missing or unreadable, refuse with `district-unassigned` when the school has no valid districtId, and pass the resolved value to `writeCustomClaims`). The callable does not accept a client-supplied district value. No other callable behavior is redesigned.
- `platform/functions/src/students/students-complete-onboarding.ts` (replace the existence-only school probe with a canonical school read that returns the resolved `districtId`, refuse with `district-unassigned` when the school has no valid districtId, and pass the resolved value to `writeCustomClaims`). Existing `students.schoolNotFound` behavior is preserved. The callable does not accept a client-supplied district value.
- `platform/functions/src/teachers/teachers-approve-verification.test.ts` (mock `schoolDocRef`; assert `writeCustomClaims` receives the resolved `districtId`; add refusal cases for missing school, missing/empty/whitespace/non-string school `districtId`; assert a client-supplied district value is ignored).
- `platform/functions/src/students/students-complete-onboarding.test.ts` (extend the school snapshot fixture with `districtId`; assert `writeCustomClaims` receives the resolved `districtId`; add refusal cases for missing/empty/whitespace/non-string school `districtId`; assert a client-supplied district value is ignored).

### Tests added

- 22 new assertions across the extended `claims.test.ts` (three-field write shape, missing-districtId refusal, empty-districtId refusal, overwrite semantics with the three-field shape).
- 34 unit tests colocated with the new helper (`require-district-context.test.ts`) covering: closed-set identifier export, `isDistrictErrorId` guard, authenticated happy path (teacher and student), missing authentication, empty and whitespace uid, missing user document, every non-active status value, malformed record data (missing role, invalid role, missing schoolId, whitespace schoolId, undefined snapshot data), missing school document, missing school data, missing/empty/whitespace/non-string districtId on school, missing/empty token claims for `role`, `schoolId`, `districtId`, non-string token values, role and schoolId mismatch between token and record, districtId mismatch between token and resolved school district, and non-leaking `district-mismatch` error message.
- New assertions in `teachers-approve-verification.test.ts` and `students-complete-onboarding.test.ts` covering canonical `districtId` resolution from the school record, `writeCustomClaims` receiving the resolved value in the three-field shape, missing-school refusal via `school-district-mismatch` (teachers), missing/empty/whitespace/non-string school `districtId` refusal via `district-unassigned`, and confirmation that any client-supplied district value on the request payload is ignored.
- Full Jest suite green: 353 tests across 24 suites (up from 344 across 24).

### Scope boundary

Slice 1 is deliberately narrow. It touches the shared module and the two existing `writeCustomClaims` callers only. It does not modify Firestore Rules, the app, the LMS integration, the assessment pipeline, the display-name path, indexes, or Firestore document shapes. No callable lifecycle is redesigned. No client-supplied district value is introduced on any callable. The two callable edits are the smallest architecture-conforming mechanical change required to keep the certified claim type and the runtime writer contract in agreement. It writes exactly one implementation slice from the Sprint 11A §13 sequence.

### Deferred Sprint 11 slices

- Slice 2 (PDR-025 activation callables issue district claim) is intentionally deferred.
- Slice 3 (PDR-025 denormalization on child resources) is intentionally deferred.
- Slice 4 (PDR-025 Rules invariants) is intentionally deferred.
- Slice 5 (PDR-025 stale-claim handling and app-side reconciliation) is intentionally deferred.
- Slices 6 through 20 (PDR-026, PDR-027, PDR-028 implementation) are intentionally deferred.

### Claim contract alignment note

`WriteCustomClaimsInput.districtId` and `CanonicalCustomClaims.districtId` are both strictly required, matching PDR-025 §6 exactly. The TypeScript contract and the runtime writer contract agree, so no caller can compile while omitting the field. `districtId` is resolved from the canonical `schools/{schoolId}` document on the server; no client-supplied district value is accepted anywhere on the two callable request payloads. The certified error vocabulary from PDR-025 §17 (`school-district-mismatch`, `district-unassigned`) is used at the resolution points; no new district error identifier was introduced.

### Confirmation

- No Firestore Rules were modified.
- No app code was modified.
- No later Sprint 11 slices were started.
- Every new and existing Jest test passes locally.
- No em dash appears in any created or modified document.
- No commits were made.

## Sprint 11B Slice 2: PDR-025 Callables Adopt requireDistrictContext

**Date:** 2026-07-13
**Report:** `docs/platform/SPRINT_11B_SLICE2_COMPLETION_REPORT.md`
**Anchor:** PDR-025 District Security Boundary §10, §12, §17, §20 items 1 through 3.
**Objective:** Begin consuming the shared district-context foundation. Integrate `requireDistrictContext()` into the callable-layer authorization flow at exactly the minimum coherent surface: the three `classes/*` callables that sit at the top of the resource-ownership chain and previously shared a duplicated inline authentication helper.

### Files created

- `docs/platform/SPRINT_11B_SLICE2_COMPLETION_REPORT.md`.

### Files modified

- `platform/functions/src/classes/classes-create.ts`. Replaces the inline `assertAuthenticatedTeacher` helper with `assertActiveTeacherInDistrict`, a thin wrapper that awaits `requireDistrictContext(request)` and refuses `role-forbidden` when the resolved role is not `"teacher"`. Preserves request validation, idempotency, conflict detection, the canonical `classes/{classId}` write, audit emission, and response shape.
- `platform/functions/src/classes/classes-update-metadata.ts`. Same transformation. Preserves narrow-metadata diffing, cross-teacher and cross-school ownership refusal (`classes.forbidden`), archived-status refusal (`classes.invalidStatus`), audit emission, and response shape.
- `platform/functions/src/classes/classes-archive.ts`. Same transformation. Preserves terminal archive semantics, idempotency, ownership refusal, audit emission, and update-then-audit ordering.
- `platform/functions/src/classes/classes-create.test.ts`. Introduces a `mockRequireDistrictContext` on the `../shared` mock. Adds tests for six canonical district refusals (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`, `school-district-mismatch`, `district-unassigned`) and two `role-forbidden` refusals (student and platform administrator callers). Preserves every prior assertion.
- `platform/functions/src/classes/classes-update-metadata.test.ts`. Same mock introduction. Adds four canonical district refusals and two `role-forbidden` refusals. Preserves every prior assertion.
- `platform/functions/src/classes/classes-archive.test.ts`. Same mock introduction. Adds four canonical district refusals and two `role-forbidden` refusals. Preserves every prior assertion.
- `docs/platform/SPRINT_HISTORY.md`. This entry.

### Shared authorization changes

- The three `classes` callables now route authentication, active-status, role, school-record, and district-record verification through a single shared helper. No callable re-implements any part of that flow.
- Refusals emitted by the shared helper propagate to the callable boundary as canonical PDR-025 §17 identifiers: `unauthenticated`, `account-inactive`, `claim-stale`, `claim-state-mismatch`, `school-district-mismatch`, `district-unassigned`, `district-mismatch`. The callables do not rename, alias, or wrap these identifiers.
- The role-narrowing refusal (caller must be `"teacher"`) is expressed as `role-forbidden` per PDR-025 §17. No new district-error identifier is introduced.
- The shared helper never mutates state, never emits an audit event, and never re-issues claims. Every callable's audit-event contract is unchanged.
- The `districtId` returned by the helper is threaded through the `actor` structure inside each callable but is not yet written to `classes/{classId}` documents or emitted on audit events. Both are Slice 3 responsibilities.

### Callables updated

- `classesCreate`
- `classesUpdateMetadata`
- `classesArchive`

Callables intentionally not updated:

- `teachersApproveVerification` and `studentsCompleteOnboarding` remain on the Slice 1 mechanical `districtId` resolution because their callers are not yet `"active"` when the callable is invoked and cannot satisfy the helper's precondition.
- Every `enrollments/*`, `assignments/*`, `submissions/*`, and `lms/*` callable retains its existing inline authorization pending a future slice. Broad platform-wide migration is out of scope.

### Test coverage

- `classes-create.test.ts`: 8 new assertions (6 canonical district refusals + 2 `role-forbidden` refusals), 3 prior authorization tests replaced.
- `classes-update-metadata.test.ts`: 6 new assertions (4 canonical district refusals + 2 `role-forbidden` refusals), 2 prior authorization tests replaced.
- `classes-archive.test.ts`: 6 new assertions (4 canonical district refusals + 2 `role-forbidden` refusals), 2 prior authorization tests replaced.
- Full Jest suite green: 366 tests across 24 suites (up from 353 across 24).

### Scope boundary

Slice 2 is deliberately narrow. It touches only the three `classes/*` handler files and their colocated test files, plus this history entry and the Slice 2 completion report. It does not modify Firestore Rules, the app, LMS integration, the assessment pipeline, the display-name path, indexes, Firestore document shapes, the shared writer contract, the shared district-context helper, the audit vocabulary, any PDR, any architecture document, or any prior completion report.

### Deferred Sprint 11 slices

- Slice 3 (PDR-025 denormalization on child resources) is intentionally deferred.
- Slice 4 (PDR-025 Rules invariants) is intentionally deferred.
- Slice 5 (PDR-025 stale-claim handling and app-side reconciliation) is intentionally deferred.
- Slices 6 through 20 (PDR-026, PDR-027, PDR-028 implementation) are intentionally deferred.

### Confirmation

- No Firestore Rules were modified.
- No app code was modified.
- No Firestore document shape or index was modified.
- No callable outside the three `classes/*` handlers was modified.
- Every new and existing Jest test passes locally.
- No em dash appears in any created or modified document.
- No commits were made.


## Sprint 11B Slice 3: PDR-025 Enrollment Callables Adopt requireDistrictContext

**Date:** 2026-07-13
**Anchor decision:** PDR-025 District Security Boundary.
**Slice scope:** Extending the shared `requireDistrictContext` helper adopted in Slice 2 to the three enrollment-management callables. No other layer touched.

### Purpose

Slice 3 continues the Sprint 11A implementation sequence by extending the district-context authorization model from the `classes/*` layer to the `enrollments/*` layer. The three enrollments callables (`enrollmentsJoinByCode`, `enrollmentsTeacherAdd`, `enrollmentsSetStatus`) now delegate authentication, active-status, role, school-record, and district-record verification to `requireDistrictContext(request)`, and refuse a role mismatch with the canonical PDR-025 §17 `role-forbidden` identifier.

### Files created

- `docs/platform/SPRINT_11B_SLICE3_COMPLETION_REPORT.md`. Slice 3 completion report.

### Files modified

- `platform/functions/src/enrollments/enrollments-join-by-code.ts`. Inline `assertAuthenticatedStudent` replaced with `assertActiveStudentInDistrict` wrapping `requireDistrictContext` and refusing `role-forbidden` for non-student callers.
- `platform/functions/src/enrollments/enrollments-teacher-add.ts`. Inline `assertAuthenticatedTeacher` replaced with `assertActiveTeacherInDistrict` wrapping `requireDistrictContext` and refusing `role-forbidden` for non-teacher callers.
- `platform/functions/src/enrollments/enrollments-set-status.ts`. Same transformation.
- `platform/functions/src/enrollments/enrollments-join-by-code.test.ts`. Introduces `mockRequireDistrictContext`; adds tests for the six canonical district refusals and two `role-forbidden` refusals; preserves every prior assertion.
- `platform/functions/src/enrollments/enrollments-teacher-add.test.ts`. Introduces `mockRequireDistrictContext`; adds tests for four canonical district refusals and two `role-forbidden` refusals; preserves every prior assertion.
- `platform/functions/src/enrollments/enrollments-set-status.test.ts`. Same test-side transformation.
- `docs/platform/SPRINT_HISTORY.md`. This entry.

### Authorization contract

- Every district refusal propagates unchanged: `unauthenticated`, `account-inactive`, `claim-stale`, `claim-state-mismatch`, `school-district-mismatch`, `district-unassigned`, `district-mismatch`.
- Callable-local role refusal uses the canonical `role-forbidden` identifier.
- Every pre-existing enrollment-namespace refusal is preserved unchanged, including `enrollments.forbidden`, `enrollments.conflict`, `enrollments.invalidClassStatus`, `enrollments.invalidTransition`, `enrollments.joinCodeNotFound`, `enrollments.notFound`, `enrollments.classNotFound`, `enrollments.studentNotFound`, `enrollments.invalidTargetRole`, and `enrollments.invalidTargetStatus`.
- Enrollment schema, lifecycle states, exit-timestamp policy, audit vocabulary, and idempotency semantics are unchanged.
- The `districtId` returned by the helper is passed through the `actor` structure inside each callable but is not yet persisted to `enrollments/{enrollmentId}` or emitted on audit events; those are intentionally out of scope for this slice.

### Callables not migrated in this slice

- `teachersApproveVerification` and `studentsCompleteOnboarding` remain on the Slice 1 mechanical `districtId` resolution because their callers are not yet `"active"` when the callable is invoked and cannot satisfy the helper's precondition.
- The three `classes/*` callables migrated in Slice 2 are unchanged.
- Every `assignments/*`, `submissions/*`, `lms/*` callable, and every `auth/*` trigger retains its existing inline authorization pending a future slice. Broad platform-wide migration is out of scope.

### Test coverage

- `enrollments-join-by-code.test.ts`: 8 new assertions (6 canonical district refusals + 2 `role-forbidden` refusals), 3 prior authorization tests replaced.
- `enrollments-teacher-add.test.ts`: 6 new assertions (4 canonical district refusals + 2 `role-forbidden` refusals), 2 prior authorization tests replaced.
- `enrollments-set-status.test.ts`: 6 new assertions (4 canonical district refusals + 2 `role-forbidden` refusals), 2 prior authorization tests replaced.
- Full Jest suite green: 380 tests across 24 suites (up from 366 across 24).

### Scope boundary

Slice 3 is deliberately narrow. It touches only the three `enrollments/*` handler files and their colocated test files, plus this history entry and the Slice 3 completion report. It does not modify Firestore Rules, the app, LMS integration, the assessment pipeline, assignments, submissions, the display-name path, indexes, Firestore document shapes, the shared writer contract, the shared district-context helper, the audit vocabulary, any PDR, any architecture document, or any prior completion report.

### Deferred Sprint 11 slices

- Slice 4 (PDR-025 Rules invariants) is intentionally deferred.
- Slice 5 (PDR-025 stale-claim handling and app-side reconciliation) is intentionally deferred.
- Slices 6 through 20 (PDR-026, PDR-027, PDR-028 implementation) are intentionally deferred.

### Confirmation

- No Firestore Rules were modified.
- No app code was modified.
- No Firestore document shape or index was modified.
- No callable outside the three `enrollments/*` handlers was modified.
- Every new and existing Jest test passes locally.
- No em dash appears in any created or modified document.
- No commits were made.

## Sprint 11B Slice 4: PDR-025 Assignment Callables Adopt requireDistrictContext

**Date:** 2026-07-13
**Anchor decision:** PDR-025 District Security Boundary.
**Slice scope:** Extending the shared `requireDistrictContext` helper adopted in Slices 2 and 3 to the five assignment-management callables. No other layer touched.

### Purpose

Slice 4 continues the Sprint 11A implementation sequence by extending the district-context authorization model from the `classes/*` and `enrollments/*` layers to the `assignments/*` layer. The five assignments callables (`assignmentsCreateDraft`, `assignmentsUpdateDraft`, `assignmentsPublish`, `assignmentsClose`, `assignmentsArchive`) now delegate authentication, active-status, role, school-record, and district-record verification to `requireDistrictContext(request)`, and refuse a role mismatch with the canonical PDR-025 §17 `role-forbidden` identifier.

### Files created

- `docs/platform/SPRINT_11B_SLICE4_COMPLETION_REPORT.md`. Slice 4 completion report.

### Files modified

- `platform/functions/src/assignments/assignments-create-draft.ts`. Inline `assertAuthenticatedTeacher` replaced with `assertActiveTeacherInDistrict` wrapping `requireDistrictContext` and refusing `role-forbidden` for non-teacher callers.
- `platform/functions/src/assignments/assignments-update-draft.ts`. Same transformation.
- `platform/functions/src/assignments/assignments-publish.ts`. Same transformation.
- `platform/functions/src/assignments/assignments-close.ts`. Same transformation.
- `platform/functions/src/assignments/assignments-archive.ts`. Same transformation.
- `platform/functions/src/assignments/assignments-create-draft.test.ts`. Introduces `mockRequireDistrictContext`; adds tests for the six canonical district refusals and two `role-forbidden` refusals; preserves every prior assertion.
- `platform/functions/src/assignments/assignments-update-draft.test.ts`. Introduces `mockRequireDistrictContext`; adds tests for four canonical district refusals and two `role-forbidden` refusals; preserves every prior assertion.
- `platform/functions/src/assignments/assignments-publish.test.ts`. Same test-side transformation.
- `platform/functions/src/assignments/assignments-close.test.ts`. Same test-side transformation.
- `platform/functions/src/assignments/assignments-archive.test.ts`. Same test-side transformation.
- `docs/platform/SPRINT_HISTORY.md`. This entry.

Separately, `platform/functions/src/shared/auth/require-district-context.test.ts` received a CI lint correction. The two local mocks `mockUserRecordDocRef` and `mockSchoolDocRef` are now typed as `jest.Mock` without unused underscore-prefixed parameters, and the two fixture helpers `userSnapshot` and `schoolSnapshot` no longer cast `createdAt: {}` to `never`. The correction is editorial, does not change any test behavior, and is unrelated to the Slice 4 assignment migration. It is documented distinctly from Slice 4 in the completion report.

### Authorization contract

- Every district refusal propagates unchanged: `unauthenticated`, `account-inactive`, `claim-stale`, `claim-state-mismatch`, `school-district-mismatch`, `district-unassigned`, `district-mismatch`.
- Callable-local role refusal uses the canonical `role-forbidden` identifier.
- Every pre-existing assignment-namespace refusal is preserved unchanged, including `assignments.invalidRequest`, `assignments.invalidAssignmentId`, `assignments.invalidClassId`, `assignments.notFound`, `assignments.classNotFound`, `assignments.forbidden`, `assignments.conflict`, `assignments.invalidStatus`, and `assignments.invalidTransition`.
- Assignment schema, four canonical lifecycle states (`draft`, `published`, `closed`, `archived`), allowed-transitions table, ownership rules, audit vocabulary (`assignments.created`, `assignments.updated`, `assignments.published`, `assignments.closed`, `assignments.archived`), idempotent replay semantics, and response contracts are unchanged.
- The `districtId` returned by the helper is passed through the `actor` structure inside each callable but is not yet persisted to `assignments/{assignmentId}` or emitted on audit events; those are intentionally out of scope for this slice.

### Callables not migrated in this slice

- The three `classes/*` callables migrated in Slice 2 and the three `enrollments/*` callables migrated in Slice 3 are unchanged.
- `teachersApproveVerification` and `studentsCompleteOnboarding` remain on the Slice 1 mechanical `districtId` resolution.
- Every `submissions/*` callable, every `lms/*` callable, and every trigger under `auth/*` retains its existing inline authorization pending a future slice. Broad platform-wide migration is out of scope.

### Test totals

- Full Jest suite green: 24 suites, 407 tests (up from 24 suites, 380 tests in Slice 3).
- Lint clean, typecheck clean, build clean, `git diff --check` clean.

### Deferred Sprint 11 slices

- Slice 5 (PDR-025 Rules invariants) is intentionally deferred.
- Slice 6 (PDR-025 stale-claim handling and app-side reconciliation) is intentionally deferred.
- Slices 7 through 20 (PDR-026, PDR-027, PDR-028 implementation, plus `submissions/*`, `lms/*`, and `auth/*` migrations) are intentionally deferred.

### Confirmation

- No Firestore Rules were modified.
- No app code was modified.
- No Firestore document shape or index was modified.
- No callable outside the five `assignments/*` handlers was modified.
- The CI lint correction in `require-district-context.test.ts` is a separate editorial change and does not modify any production code or test behavior.
- Every new and existing Jest test passes locally.
- No em dash appears in any created or modified document.
- No commits were made.

---

## Sprint 11C Slice 1: Assessment Attempt Foundation

**Dates:** 2026-07-14
**Status:** Complete
**Detailed report:** SPRINT_11C_SLICE1_COMPLETION_REPORT.md

### Purpose

Slice 1 of Sprint 11C lands the canonical initialization of the assessment-attempt lifecycle governed by PDR-026 (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md`). The slice introduces the `assessmentSessions/{sessionId}` collection foundation and the `assessmentSessionsBegin` callable that opens a Live session for an authenticated student against a published classroom-mode assignment. Autosave, resume, sweep, recover, purge, and the finalize/scorer transaction that writes attempts are explicitly deferred to later slices.

### Files created

- `platform/functions/src/shared/types/assessment-session.ts`. Canonical `AssessmentSessionRecord`, `AssessmentSessionCreationWrite`, `AssessmentSessionStatus`, and `ASSESSMENT_SESSIONS_COLLECTION` per ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6, §11, §12.
- `platform/functions/src/assessments/index.ts`. Barrel export for the new assessment callable namespace.
- `platform/functions/src/assessments/assessment-sessions-begin.ts`. The `assessmentSessionsBegin` callable and its `sessionIdFor` deterministic identifier helper.
- `platform/functions/src/assessments/assessment-sessions-begin.test.ts`. Jest coverage for canonical write, idempotent replay, conflict refusal, six district refusals, `role-forbidden`, request validation, assignment refusals, enrollment refusals, and audit event non-emission on write failure.
- `docs/platform/SPRINT_11C_SLICE1_COMPLETION_REPORT.md`. Slice 1 completion report.

### Files modified

- `platform/functions/src/shared/types/audit-event.ts`. Adds `"assessment.sessionBegan"` to the canonical `AuditAction` union.
- `platform/functions/src/shared/audit/write-audit-event.ts`. Adds `"assessment.sessionBegan"` to the closed `VALID_ACTIONS` list so the canonical writer accepts the new event.
- `platform/functions/src/shared/firestore/typed-ref.ts`. Adds `assessmentSessionsCollectionRef`, `assessmentSessionDocRef`, and `assessmentSessionCreationDocRef` typed references.
- `platform/functions/src/shared/index.ts`. Exports the new typed references and the new session types.
- `platform/functions/src/index.ts`. Exports the `assessmentSessionsBegin` callable.
- `docs/platform/SPRINT_HISTORY.md`. This entry.

### Assessment callables inspected

- `submissionsCreate` and `submissionsFinalize` (`platform/functions/src/submissions/*`). These are the existing (Sprint 5A) attempt-adjacent surface superseded by PDR-026 §26. They are preserved unchanged in this slice; the reconciliation migration is deferred per the sprint scope.
- No prior `assessments/*` callable exists in the tree. The Sprint 11A inventory records every callable in the PDR-026 §21 matrix as Missing.

### Test totals

- Full Jest suite green: 25 suites, 428 tests (up from 24 suites, 407 tests at Sprint 11B Slice 4 completion).
- Lint clean, typecheck clean, build clean, `git diff --check` clean.

### Deferred work

- `assessmentSessionsAutosave`, `assessmentSessionsSweepExpired`, `assessmentSessionsPurgeArchived`, `assessmentSessionsRecover`, `assessmentAttemptsFinalize`, `assessmentAttemptsGetForStudent`, `assessmentAttemptsGetForTeacher`. The paired assessments/revisions/answer-keys collections, `attempts/*`, `attemptRollups/*`, and `assignmentRollups/*` are deferred with them. Firestore Rules invariants and composite indexes for every assessment collection are deferred.

### Confirmation

- Only Sprint 11C Assessment Slice 1 was implemented.
- No Firestore Rules were modified.
- No app code was modified.
- No callable outside the newly created `assessments/*` handler was modified except for the additive audit-vocabulary and typed-ref changes required to publish it.
- Every new and existing Jest test passes locally.
- No em dash appears in any created or modified document.
- No commits were made.

---

## Sprint 11C Slice 2: Assessment Session Autosave

**Dates:** 2026-07-14
**Status:** Complete
**Detailed report:** SPRINT_11C_SLICE2_COMPLETION_REPORT.md

### Purpose

Slice 2 of Sprint 11C lands the durable autosave step of the assessment-attempt lifecycle governed by PDR-026 (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md`). The slice introduces the `assessmentSessionsAutosave` callable that persists the student's in-progress `responses` and a server-stamped `lastActivityAt` timing marker onto the Live session written by the Slice 1 `assessmentSessionsBegin` callable. Resume, sweep, purge, recover, finalize, attempt reads, rollups, and the administrative answer-key read remain deferred to later slices.

### Files created

- `platform/functions/src/assessments/assessment-sessions-autosave.ts`. The `assessmentSessionsAutosave` callable, its request and response types, and its internal handler export for unit testing.
- `platform/functions/src/assessments/assessment-sessions-autosave.test.ts`. Jest coverage for canonical write, idempotent coalescing, differing-payload mutation, empty-payload boundary coalescing, non-owner refusal, cross-district refusal, cross-school refusal, archived-session refusal, missing-session refusal, four canonical district refusals, `role-forbidden`, request-shape refusals, malformed `sessionId` refusals, per-element response refusals, forbidden-scoring-key refusals, non-serializable value refusals, 200-response cap, and 64 KiB serialized payload cap.
- `docs/platform/SPRINT_11C_SLICE2_COMPLETION_REPORT.md`. Slice 2 completion report.

### Files modified

- `platform/functions/src/shared/types/assessment-session.ts`. Adds the canonical `AssessmentSessionResponse` `{itemId, response}` element type, adds the optional `responses` and `lastActivityAt` fields on the read-side `AssessmentSessionRecord`, and adds the narrow-write `AssessmentSessionAutosaveWrite` type carrying only `responses` and the `FieldValue`-typed `lastActivityAt`. Every Slice 1 field, type, and identifier is preserved.
- `platform/functions/src/shared/firestore/typed-ref.ts`. Adds the narrow-write `assessmentSessionAutosaveDocRef` typed reference. The Slice 1 collection-level, read, and creation-write references are preserved unchanged.
- `platform/functions/src/shared/index.ts`. Re-exports the new `assessmentSessionAutosaveDocRef` typed reference and the two new type identifiers (`AssessmentSessionAutosaveWrite`, `AssessmentSessionResponse`).
- `platform/functions/src/assessments/index.ts`. Re-exports the new callable and its request and response types alongside the Slice 1 `assessmentSessionsBegin` exports.
- `platform/functions/src/index.ts`. Publishes `assessmentSessionsAutosave` alongside `assessmentSessionsBegin`.
- `docs/platform/SPRINT_HISTORY.md`. This entry.

### Callable contract

`assessmentSessionsAutosave` accepts `{ sessionId, responses }` on an authenticated request and returns `{ sessionId, persisted }`. The handler enforces authentication and district context through `requireDistrictContext`, refuses non-student callers with `role-forbidden`, validates the request shape and every response element, loads the referenced session, refuses non-owner (`assessmentSessions.notOwned`), cross-district (`district-mismatch`), and cross-school (`assessmentSessions.forbidden`) callers, refuses a non-Live session (`assessmentSessions.sessionNotLive`) and a missing session (`assessmentSessions.sessionNotFound`), coalesces identical replays without a Firestore write, and writes the narrow autosave payload with `FieldValue.serverTimestamp()` on `lastActivityAt` for a differing payload.

### Narrow mutable write type

The `AssessmentSessionAutosaveWrite` type carries only `responses` and `lastActivityAt`. Every frozen ownership field (`studentId`, `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, `activityId`, `assessmentId`, `assessmentRevisionId`), `sessionOrdinal`, `status`, and `startedAt` is structurally unreachable through this callable. Frozen-field enforcement is structural rather than diffed. Scoring artifacts (`score`, `correctness`, `isCorrect`, `correctAnswer`, `pointsEarned`, `explanation`, and related keys) are additionally forbidden inside any nested `response` value so a client-authoritative scoring value cannot enter the session document through this callable.

### Ownership and live-session enforcement

The session's `studentId`, `districtId`, `schoolId`, and `status` are compared against the caller's verified identity and against the required Live lifecycle state before any write is attempted. Every refusal surfaces a canonical error identifier consistent with PDR-026 §25 and PDR-025 §17. No enrollment re-check is issued at the autosave boundary; enrollment was verified at session creation and the session's frozen `classId` and `teacherId` denormalize the relationship as it existed at creation. Lifecycle-authoritative refusal on enrollment change happens at the deferred finalize step.

### Payload validation

Per-element validation refuses missing or malformed `itemId`, missing `response`, unexpected element keys, duplicate `itemId` values within a single call, non-serializable response values (functions, symbols, `undefined`, `bigint`, non-finite numbers), and any scoring artifact key inside a nested response value. Payload-size ceilings cap the array at 200 elements and cap the serialized `responses` payload at 65,536 bytes of UTF-8 JSON. Every request-layer refusal surfaces `assessmentSessions.invalidRequest`, `assessmentSessions.invalidSessionId`, or `assessmentSessions.invalidResponses`.

### Idempotent coalescing

Autosave is idempotent under identical payload per PDR-026 §21. A replay whose `responses` array is byte-equivalent to the currently stored `responses` returns `{ persisted: false }` with no Firestore write and no `lastActivityAt` restamp. This satisfies the §31 G-10A-4 throttle recommendation for the well-behaved client that resends the current working state. Coalescing also applies at the initial boundary where the stored `responses` is absent and the incoming payload is empty. Coalescing is payload-based rather than time-based; a differing payload received arbitrarily soon after a prior write is still persisted so a legitimate answer change is never silently dropped.

### No per-autosave audit event

Per PDR-026 §24, autosave writes are not audited event-by-event. No audit event is emitted by this callable. The audit vocabulary and `VALID_ACTIONS` list are unchanged; `assessment.sessionBegan` from Slice 1 remains the sole audit event on the session lifecycle at the end of this slice. A sampled `assessment.sessionAutosaveSampled` observability event MAY be introduced in a later slice.

### Test totals

- Full Jest suite green: 26 suites, 452 tests (up from 25 suites, 428 tests at Sprint 11C Slice 1 completion; 25 new tests all in `assessment-sessions-autosave.test.ts`, and one new suite).
- Lint clean, typecheck clean, build clean.
- No audit event is emitted for autosave.
- 200-response element cap and 64 KiB serialized payload cap are both enforced at the request-validation layer and both covered by dedicated cases.
- Identical-response coalescing returns `persisted: false` with no Firestore write and no `lastActivityAt` restamp; covered by a dedicated case and by the empty-payload boundary case.

### Deferred assessment slices

- `assessmentSessionsResume`, `assessmentSessionsSweepExpired`, `assessmentSessionsPurgeArchived`, `assessmentSessionsRecover`, `assessmentAttemptsFinalize`, `assessmentAttemptsGetForStudent`, `assessmentAttemptsGetForTeacher`, `assessmentRollupsRecomputeAttempt`, `assessmentAnswerKeysAdministrativeRead`. The paired `assessments/*`, `assessmentRevisions/*`, and `assessmentAnswerKeys/*` collections and their deployment pipeline are deferred with the scorer. The `attempts/*`, `attemptRollups/*`, and `assignmentRollups/*` collections are deferred with the scorer. Firestore Rules invariants and composite indexes for every assessment collection are deferred. The `submissions/*` to `attempts/*` reconciliation migration per PDR-026 §26 is deferred.

### Confirmation

- Only Sprint 11C Assessment Slice 2 was implemented; the documentation task changed only the two documentation files above.
- No Firestore Rules were modified.
- No app code was modified.
- No callable outside the newly created `assessments/*` autosave handler was modified except for the additive typed-ref, type, and barrel-export changes required to publish it.
- Every new and existing Jest test passes locally.
- No em dash appears in any created or modified document.
- No commits were made.

---

## Sprint 11C Pre-3: Assessment Scoring Contract

**Dates:** 2026-07-14
**Status:** Architecture only. No implementation.

### Purpose

Sprint 11C Slice 3 was intentionally halted. The certified architecture (PDR-021, PDR-026, `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `ASSESSMENT_PIPELINE_SPECIFICATION.md`) did not yet define enough shape-level information to safely implement the server-side scorer. Specifically, the certified documents did not fix the `assessmentRevisions/{revisionId}` document shape, the `assessmentAnswerKeys/{revisionId}` document shape, the supported v1 item types, the response representation, the comparison rule, or the deployment pipeline shape for assessment content. Sprint 11C Pre-3 creates the canonical scoring contract required before Sprint 11C Slice 3 implementation can resume.

### Files created

- `docs/platform/ASSESSMENT_SCORING_CONTRACT.md`. The canonical v1 scoring specification. Fixes the revision and answer-key document shapes, the v1 `singleChoice` item type, the response schema, the deterministic scoring algorithm, the attempt-score and percentage calculations, the answer-key confidentiality boundary at scoring time, the deployment ownership boundary, the schema-version and revision-ordinal versioning boundaries, the future extension strategy, the required implementation checklist for Sprint 11C Slice 3, and the required testing checklist. Includes reconciliation notes back to PDR-026, the assessment implementation contract, the assessment pipeline specification, and the Sprint 11A inventory.

### Files modified

- `docs/platform/SPRINT_HISTORY.md`. This entry.

### Architecture decisions documented

- v1 supports exactly one item type: single-answer multiple choice (`itemType: "singleChoice"`).
- v1 response shape is `{itemId, response}` where `response` is the selected `optionId`. The wire, session, and attempt use the same element shape.
- v1 answer-key items carry `{itemId, correctOptionId, points, explanation}`. Every item is worth exactly one point. Partial credit and negative scoring are prohibited.
- v1 scoring rule is strict case-sensitive string equality between `response` and `correctOptionId`. Full credit on match, zero credit otherwise. Unanswered items score zero.
- v1 attempt score is the sum of `pointsEarned`. Percentage is `round((score / maxScore) * 100, 2)` with banker's rounding. Zero-item answer keys refuse.
- v1 revision and answer-key documents carry `schemaVersion: 1`. Any future schema bump requires a superseding PDR.
- The deployment pipeline is the sole writer of `assessments/*`, `assessmentRevisions/*`, and `assessmentAnswerKeys/*` and MUST write the three documents atomically at the deployment boundary. A revision without a paired answer key MUST NOT be observable.
- The scorer resolves the revision from the session's frozen `assessmentRevisionId`, never from `assessments/{assessmentId}.currentRevisionId` at scoring time.
- Answer-key confidentiality at scoring time: read exactly once inside the scoring transaction, never logged, never included in Firestore writes or callable responses beyond the certified feedback subset.
- Each answer-key integrity failure surfaces a distinguishable error identifier and leaves the session Live.

### Reconciliations performed

- Reviewed `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-021, PDR-026), `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `ASSESSMENT_PIPELINE_SPECIFICATION.md`, and `SPRINT_11A_IMPLEMENTATION_INVENTORY.md`.
- Confirmed the v1 shape is a strict subset of the collection ownership rows in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §11 (no rubrics, no distractor rationales in v1).
- No certified document was modified. Reconciliation notes on future revisions of PDR-026 and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §11 are recorded in Section 18 of the new contract so that those documents can cite the scoring contract at their next revision.
- No behavior is changed. The scoring contract only eliminates ambiguity so Sprint 11C Slice 3 can proceed.

### Validation results

- No production code was written or modified. `platform/functions/src/` is unchanged.
- No test file was created or modified.
- No Firestore Rules file was modified.
- No app code was modified.
- The repository contains only the two documentation changes listed above.
- The new contract was scanned for em dashes; none appear.

### Confirmation

- Only the canonical scoring contract was authored. No code changed.
- No Firestore Rules were modified.
- No app code was modified.
- No commit was made.

## Sprint 11C Slice 3 - Assessment Attempt Finalization (2026-07-14)

### Purpose

Land the terminal Live-to-Attempt transition of the assessment pipeline. Sprint 11C Slice 3 introduces the canonical `assessmentAttemptsFinalize` callable per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §7 and §8 and the v1 scorer defined by `ASSESSMENT_SCORING_CONTRACT.md`. The callable reads a Live session under the caller's authenticated identity, resolves the paired revision and server-confidential answer key from the session's frozen `assessmentRevisionId`, applies the v1 `singleChoice` scoring rule, writes an immutable `attempts/{attemptId}` document, deletes the session inside the same Firestore transaction, and emits exactly one `assessment.attemptFinalized` audit event on successful commit. Every other PDR-026 §21 callable (sweep, purge, recover, resume, attempt reads, rollup, administrative answer-key read) remains deferred.

### Files created

- `platform/functions/src/shared/types/assessment.ts`. Canonical read shapes for `assessments/*`, `assessmentRevisions/*`, and `assessmentAnswerKeys/*`; v1 discriminant literals and item shapes; deployment-only write shapes reserved for a later slice.
- `platform/functions/src/shared/types/attempt.ts`. Canonical read shape and narrow creation-write shape for `attempts/*`; per-item feedback shape `AssessmentAttemptItemResult`.
- `platform/functions/src/shared/firestore/transaction.ts`. `runFirestoreTransaction` wrapper used by the finalize callable.
- `platform/functions/src/assessments/assessment-attempts-finalize.ts`. The `assessmentAttemptsFinalize` callable, its internal handler export, the deterministic `attemptIdFor` helper, and the v1 scorer.
- `platform/functions/src/assessments/assessment-attempts-finalize.test.ts`. Thirty-four Jest cases.
- `docs/platform/SPRINT_11C_SLICE3_COMPLETION_REPORT.md`. The completion report.

### Files modified

- `platform/functions/src/shared/firestore/typed-ref.ts`. Adds read references for revision, answer key, attempt; adds the attempts collection reference; adds the narrow-write attempt-creation reference.
- `platform/functions/src/shared/types/audit-event.ts`. Adds `"assessment.attemptFinalized"` to the `AuditAction` union.
- `platform/functions/src/shared/audit/write-audit-event.ts`. Adds the same literal to the runtime allowlist.
- `platform/functions/src/shared/index.ts`. Re-exports the new refs, the transaction helper, and the new type identifiers.
- `platform/functions/src/assessments/index.ts`. Re-exports the finalize callable, the `attemptIdFor` helper, and the request and response types.
- `platform/functions/src/index.ts`. Publishes `assessmentAttemptsFinalize` under the canonical PDR-026 §21 name.
- `docs/platform/SPRINT_HISTORY.md`. This entry.

### Callable landed

- `assessmentAttemptsFinalize` accepts `{ sessionId, idempotencyKey }` and returns `{ attemptId, attemptNumber, score, maxScore, percentage, itemResults, replay }`. Sole writer of `attempts/*`; sole deleter of the referenced session on successful commit. Session read, idempotency lookup, revision and answer-key reads, attempt-collision precheck, attempt-count query, attempt write, and session delete occur inside a single Firestore transaction per PDR-026 §8. The `assessment.attemptFinalized` audit event is emitted after successful commit and never fabricated on a rolled-back transaction.

### Scoring implementation

- v1 supports exclusively `itemType: "singleChoice"`.
- Per-item rule: strict case-sensitive string equality between the student's `response` and the answer key's `correctOptionId`. Full credit or zero.
- Unanswered items score zero and record `studentResponse: null`.
- A response element whose `itemId` is not in the revision is ignored by the scorer and persisted verbatim on the attempt's `responses`.
- `attempt.score = sum(item.pointsEarned)`. `attempt.maxScore = sum(item.points)`. `attempt.percentage = round((score / maxScore) * 100, 2)` under banker's rounding.
- Zero-item answer keys refuse rather than divide by zero (`assessmentAttempts.answerKeyIntegrity`).
- The scorer resolves the revision from the session's frozen `assessmentRevisionId`, never from the assessment's current revision at scoring time.
- Two invocations against the same session, revision, and answer key produce identical scoring output.

### Server-owned data protections

- The client MUST NOT supply a score, per-item correctness, points-earned value, correct-answer value, explanation, item results, responses, attempt number, attempt identifier, or any ownership field on the request. A twenty-two-key structural refusal returns `assessmentAttempts.invalidRequest` before the transaction opens.
- Ownership fields on the attempt are copied verbatim from the session's frozen ownership fields.
- Answer-key material never crosses the callable boundary outside the per-item `correctOptionId` and `explanation` fields on `itemResults`. The full answer-key document is read exactly once per finalize inside the scoring transaction and never logged or emitted in an error payload.

### Idempotency

- The client supplies an idempotency marker. A retry with the same marker after a successful commit returns the existing attempt payload with `replay: true`; no second attempt is written and no second audit event is emitted.

### Audit vocabulary

- Adds `"assessment.attemptFinalized"` to the canonical `AuditAction` union and the runtime allowlist per PDR-026 §24. The event payload carries `assignmentId`, `classId`, `activityId`, `assessmentId`, `assessmentRevisionId`, `attemptNumber`, `score`, `maxScore`, `percentage`, `districtId`.

### Tests added

- Thirty-four new Jest cases covering the successful path, scoring correctness across all mixture patterns, banker's rounding, idempotent replay, all authorization and lifecycle refusals, all integrity failures, revision resolution from the session's frozen id, determinism, atomicity of session delete and attempt write, and containment of the response payload to the certified feedback subset.
- All prior Jest tests are preserved unchanged and continue to pass.

### Validation results

- `npm run lint` passes with zero errors and zero warnings.
- `npm run typecheck` passes with no diagnostics.
- `npm run build` passes.
- `npm test` passes. 27 suites, 486 tests, 0 failures.
- `git diff --check` passes.
- The completion report and this entry contain no em dashes.

### Deferred work

- Every PDR-026 §21 callable beyond `assessmentSessionsBegin`, `assessmentSessionsAutosave`, and `assessmentAttemptsFinalize` remains Missing.
- Deployment-pipeline integration for `assessments/*`, `assessmentRevisions/*`, and `assessmentAnswerKeys/*` remains deferred.
- Session-ordinal advancement, Firestore Security Rules updates, composite index deployment updates, legacy `submissions` migration, emulator tests per PDR-026 §28, and rules-test matrix per PDR-026 §27 all remain deferred.
- Rollups, LMS integration, teacher analytics, and app surfaces remain unchanged by this slice.

### Confirmation

- Only Sprint 11C Slice 3 was implemented.
- No other slice was advanced.
- No architecture document was amended and no PDR was superseded.
- Firestore Rules were not modified.
- The app was not modified.
- Assignments, classes, enrollments, LMS, and submissions were not modified.
- No commit was made.

## Sprint 11C Slice 4 - Assessment Content Deployment Foundation

Date: 2026-07-14

### Purpose

Introduce the canonical server-owned deployment path that atomically publishes an assessment root document, an immutable revision, and the paired server-confidential answer key per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §5, §11, §12 and `ASSESSMENT_SCORING_CONTRACT.md` §4, §5, §13.

### Authorities reviewed

- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §5, §11, §12, §14, §15, §16, §21, §22, §24, §29.
- `ASSESSMENT_SCORING_CONTRACT.md` §3, §4, §5, §5.3, §6, §7, §12, §13, §13.1, §13.2, §14, §16, §17.
- `ASSESSMENT_PIPELINE_SPECIFICATION.md` §15.
- `SPRINT_11A_IMPLEMENTATION_INVENTORY.md`.
- `SPRINT_11C_SLICE1_COMPLETION_REPORT.md`, `SPRINT_11C_SLICE2_COMPLETION_REPORT.md`, `SPRINT_11C_SLICE3_COMPLETION_REPORT.md`.

### Deployment implementation

- New `deployAssessmentRevision(rawInput)` entry point at `platform/functions/src/assessments/assessment-deployment.ts`. Validates the merged deployment input, derives the canonical identifiers per §12 (`assessment_{activityId}`, `{assessmentId}__r{ordinal}`), splits the merged item shape into the paired revision-side (no correct-answer material) and answer-key-side records, and writes the three documents atomically inside a single `runFirestoreTransaction` region.
- Three narrow deployment-write typed references added to `platform/functions/src/shared/firestore/typed-ref.ts`: `assessmentDeploymentDocRef`, `assessmentRevisionDeploymentDocRef`, `assessmentAnswerKeyDeploymentDocRef`. The read-side references (`assessmentDocRef`, `assessmentRevisionDocRef`, `assessmentAnswerKeyDocRef`) are consumed inside the transaction for the pre-write existence checks.
- Deployment path is a server-owned mechanism; it is intentionally not exported from `platform/functions/src/index.ts` because no deployment callable is enumerated in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §21.

### Validation rules

- Structural validator refuses non-object input, missing or malformed `activityId`, non-integer or sub-1 `revisionOrdinal`, non-`authoredOrder` `itemOrderingRule`, non-v1 `schemaVersion`, blank `publishedBy`, empty items, duplicate itemIds, unsupported `itemType`, blank stems, non-unit `points`, fewer than two options, malformed options, duplicate optionIds, blank option text, blank `correctOptionId`, `correctOptionId` not among the item's options, and blank explanations.
- Transactional validator refuses duplicate revision publication, duplicate answer-key publication, activity mismatch on the existing assessment root, unparseable `currentRevisionId`, and non-monotonic `revisionOrdinal` per §13.2.

### Transaction behavior

- All three writes (revision, answer key, assessment root) enqueue inside a single `runFirestoreTransaction` region so partial publication is impossible per §13.1.
- Pre-write existence checks are transactional reads; a concurrent publisher racing the same ordinal sees one commit succeed and the other refuse on retry.
- A validation refusal inside the transaction throws before any `tx.set` runs.

### Immutable publication

- `assessmentRevisions/{revisionId}` and `assessmentAnswerKeys/{revisionId}` are refused when the deterministic identifier collides. No revision or answer key is ever rewritten.
- The `AssessmentRevisionDeploymentWrite` and `AssessmentAnswerKeyDeploymentWrite` narrow-write shapes carry only the certified fields; a caller cannot mutate an existing document through this path.
- The assessment root is create-or-updated with the advanced `currentRevisionId`; no ordinal is ever demoted.

### Audit behavior

- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §24 does not certify a deployment audit action. Per the sprint scope ("implement only certified deployment audit events; do not invent new vocabulary"), the deployment path emits no `auditEvents/*` document. A structured `log.info("assessmentDeployment.published", ...)` observability entry is recorded so a deployment run remains traceable in Cloud Logging.

### Tests added

- Twenty-three new Jest cases covering identifier derivation, first and subsequent successful publication, every certified refusal (duplicate revision, duplicate answer key, non-monotonic ordinal, activity mismatch, unparseable currentRevisionId, empty items, duplicate ids, unsupported item type, malformed shapes), no-audit behavior, and single-transaction atomicity.
- All prior Jest tests preserved unchanged and continue to pass.

### Validation results

- `npm run lint` passes with zero errors and zero warnings.
- `npm run typecheck` passes with no diagnostics.
- `npm run build` passes.
- `npm test` passes. 28 suites, 511 tests, 0 failures.
- `git diff --check` passes.
- The completion report and this entry contain no em dashes.

### Deferred work

- Every PDR-026 §21 callable beyond the runtime session and attempt path landed in Slices 1 through 3 remains Missing.
- Authoring tools, teacher edit surfaces, retrieval APIs, answer-reveal surfaces, dashboards, analytics, LMS integration, roster changes, assignment changes, and app changes remain unchanged.
- Retirement is not written by this slice.
- Session ordinal advancement, Firestore Security Rules updates for the deployment-owned collections, composite index deployment updates, legacy `submissions` migration, emulator tests per PDR-026 §28, and rules-test matrix per PDR-026 §27 all remain deferred.
- Deployment audit vocabulary remains uncertified.

### Confirmation

- Only Sprint 11C Slice 4 was implemented.
- No other slice was advanced.
- No architecture document was amended and no PDR was superseded.
- Firestore Rules were not modified.
- The app was not modified.
- Assignments, classes, enrollments, LMS, submissions, and every runtime assessment callable landed in Slices 1 through 3 were not modified.
- No commit was made.

---

## Sprint 11C Remediation - Slice 1 (Critical Findings C-1 through C-4)

**Anchor decisions:** PDR-025, PDR-026.
**Governance:** Independent Sprint 11 Implementation Review Critical findings only. The certified architecture is preserved; no redesign, no new features.

### Critical findings addressed

- C-1. `assessmentAttemptsFinalize` now performs an idempotent replay when a client retries after a committed attempt (the session having already been deleted in-transaction per §8, §11). The retry parses `assignmentId` from the deterministic session identifier, queries the existing `(studentId, assignmentId, idempotencyKey)` composite, and returns the existing attempt payload with no additional write and no additional audit event. A retry with a novel idempotency marker still refuses with `sessionNotFound`.
- C-2. Certified assignment-window and enrollment invariants (§7, §17, §21, §25) are enforced. `assessmentSessionsBegin` refuses `availableAt` in the future, `windowClosesAt` in the past, and every non-published status through the canonical refusal identifiers (`assignment-window-closed`, `assignment-not-published`, `assignment-not-found`, `assignment-mode-invalid`, `enrollment-inactive`). `assessmentAttemptsFinalize` reads the assignment and the enrollment inside the finalize transaction and honors the one-hour grace period after window close (§7.1).
- C-3. A single shared `platformCallable` wrapper (`src/shared/errors/https-callable.ts`) translates every thrown `PlatformError` into a Firebase `HttpsError` while preserving the canonical platform identifier in `HttpsError.details.code`. Every existing callable now uses the wrapper; no individual callable handler was rewritten.
- C-4. A single shared deployment gate (`src/shared/legacy-submissions-flag.ts`) is invoked by `submissionsCreate` and `submissionsFinalize`. The gate defaults to disabled and refuses with the canonical `submissions.legacyWritesDisabled` identifier so the legacy `submissions/*` write path and the authoritative `attempts/*` write path cannot both be active in production per PDR-026 §26.

### Files created

- `platform/functions/src/shared/errors/https-callable.ts`
- `platform/functions/src/shared/errors/https-callable.test.ts`
- `platform/functions/src/shared/legacy-submissions-flag.ts`
- `platform/functions/src/shared/legacy-submissions-flag.test.ts`
- `docs/platform/SPRINT_11C_REMEDIATION_SLICE1_COMPLETION_REPORT.md`

### Files modified

- `platform/functions/src/shared/index.ts`
- `platform/functions/src/assessments/assessment-attempts-finalize.ts`
- `platform/functions/src/assessments/assessment-attempts-finalize.test.ts`
- `platform/functions/src/assessments/assessment-sessions-begin.ts`
- `platform/functions/src/assessments/assessment-sessions-begin.test.ts`
- `platform/functions/src/submissions/submissions-create.ts`
- `platform/functions/src/submissions/submissions-create.test.ts`
- `platform/functions/src/submissions/submissions-finalize.ts`
- `platform/functions/src/submissions/submissions-finalize.test.ts`
- Every other callable and its test file, for the mechanical `onCall` -> `platformCallable` swap (C-3). No handler logic was changed.

### Tests added

- C-1: two new cases in `assessment-attempts-finalize.test.ts` covering the successful replay after session deletion and the negative case with a novel idempotency marker.
- C-2: five new cases in `assessment-attempts-finalize.test.ts` covering assignment-window refusal, grace-period behavior, inactive enrollment, missing assignment, and archived assignment. Three new cases in `assessment-sessions-begin.test.ts` covering `availableAt` in the future, `windowClosesAt` in the past, and enrollment-not-found through the certified identifiers. The existing non-published-status test now asserts the certified refusal codes.
- C-3: a new `https-callable.test.ts` covering the code-mapping table, canonical identifier preservation in `details.code`, HttpsError pass-through, and unknown-throwable coercion.
- C-4: a new `legacy-submissions-flag.test.ts` covering the disabled default, the canonical refusal identifier, the case-insensitive true opt-in, and rejection of every other value.

All pre-existing tests are preserved.

### Validation results

- `npm run lint` passes with zero errors and zero warnings.
- `npm run typecheck` passes with no diagnostics.
- `npm run build` passes.
- `npm test` passes. 30 suites, 535 tests, 0 failures.
- `git diff --check` passes.
- The completion report and this entry contain no em dashes.

### Deferred work

- Every Important and Minor finding from the Independent Sprint 11 Implementation Review is deferred to a subsequent slice.
- Firestore Rules, retrieval APIs, dashboards, deployment automation, session ordinal redesign, performance optimizations, and non-Critical documentation reconciliations are out of scope for this slice.

### Confirmation

- Only Critical findings C-1 through C-4 were implemented.
- No Important or Minor finding was implemented.
- The certified architecture is unchanged.
- Firestore Rules were not modified.
- No commit was made.

## Sprint 11D: Important Findings Remediation

**Date:** 2026-07-16
**Anchor decisions:** PDR-025, PDR-026.
**Anchor contracts:** ASSESSMENT_IMPLEMENTATION_CONTRACT.md, ASSESSMENT_SCORING_CONTRACT.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md.

Sprint 11D closes the Important findings (I-1 through I-9) and refinements (R-1, R-2) from the Sprint 11C independent implementation review and remediation follow-up. The certified architecture is preserved. Firestore Rules, retrieval APIs, dashboards, and Minor findings remain out of scope.

### Important findings addressed

- I-1 Audit consistency: verified every callable/writer emits exactly one canonical audit event per operation; strengthened with I-5 district context wiring.
- I-2 Deployment overwrite protection: `deployAssessmentRevision` now writes the immutable revision and answer-key documents through `tx.create(...)`.
- I-3 Assessment begin race: `assessmentSessionsBegin` now writes through `.create()` and maps ALREADY_EXISTS to the canonical `assessmentSessions.conflict` refusal.
- I-4 Error vocabulary reconciliation: `shared/errors/https-callable.ts` mapper adds suffix mappings for `.unauthenticated`, `.unauthorized`, `.forbidden`, `.notOwned`, `.notEnrolled`.
- I-5 District context in audit records: `WriteAuditEventInput` / `AuditEventWrite` / `AuditEventRecord` now carry an optional top-level `districtId`; every callable with district context supplies it.
- I-6 Attempt count: reviewed, existing implementation confirmed architecture-conforming, no change.
- I-7 Finalize response construction: reviewed against `ASSESSMENT_SCORING_CONTRACT.md` §10.4, confirmed conforming, no change.
- I-8 Session ordinal: reviewed, multi-session ordinal semantics remain deferred to future sweep/recover callables, no change.
- I-9 Documentation reconciliation: this history entry plus the Sprint 11D completion report cover the scope.
- R-1 `parseAssignmentIdFromSessionId` is right-anchored so assignmentIds containing `__` survive the round-trip.
- R-2 Bundled with I-4 above.

### Files added

- `docs/platform/SPRINT_11D_COMPLETION_REPORT.md`

### Files modified

- `platform/functions/src/shared/errors/https-callable.ts` and its test
- `platform/functions/src/shared/audit/write-audit-event.ts` and its test
- `platform/functions/src/shared/types/audit-event.ts`
- `platform/functions/src/assessments/assessment-{deployment,sessions-begin,attempts-finalize}.ts` and their tests
- `platform/functions/src/assignments/assignments-{archive,close,create-draft,publish,update-draft}.ts` and their tests
- `platform/functions/src/classes/classes-{archive,create,update-metadata}.ts` and their tests
- `platform/functions/src/enrollments/enrollments-{join-by-code,set-status,teacher-add}.ts` and their tests
- `platform/functions/src/lms/{assignments-publish,classes-import,classes-refresh,connections-complete,connections-disconnect}.ts`
- `platform/functions/src/lms/shared/actor.ts`
- `platform/functions/src/teachers/teachers-approve-verification.ts` and its test
- `platform/functions/src/students/students-complete-onboarding.ts` and its test
- `docs/platform/SPRINT_HISTORY.md` (this entry)

### Validation results

- `npm run lint` passes with zero errors and zero warnings.
- `npx tsc --noEmit -p tsconfig.json` passes with no diagnostics.
- `npm run build` passes.
- `npm test` passes. 30 suites, 546 tests, 0 failures.
- `git diff --check` passes.
- The completion report and this entry contain no em dashes.

### Confirmation

- Only the Sprint 11D Important findings (I-1 through I-9) and the two refinements (R-1, R-2) were implemented.
- No Critical or Minor finding was introduced.
- The certified architecture is unchanged.
- Firestore Rules were not modified.
- No commit was made.
