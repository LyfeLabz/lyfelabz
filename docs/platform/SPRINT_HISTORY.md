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

<!-- Append future sprints below this line using the same section structure. -->
