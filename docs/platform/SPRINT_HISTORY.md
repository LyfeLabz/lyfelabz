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
