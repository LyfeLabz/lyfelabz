# Sprint 28.6 - Implementation Plan

**Status:** Canonical execution sequence for Sprint 28.6. Produced by Sprint
28.6B. Pairs with `SPRINT_28_6_ARCHITECTURAL_BLUEPRINT.md` (the contract source
of truth). This document sequences the work so every replacement path exists
**before** the old path is removed.

**Do not begin implementation until 28.6C is authorized.** Sprint 28.6B ends
here; it made documentation changes only.

Baseline: branch `main`, HEAD `8cd6150`. Preserve the uncommitted Sprint 28.5E/F
docs and the local `scripts/ux-review/` tooling. No auto-commit, push, or deploy.

---

## Sequencing principle

Two hard ordering constraints govern the whole sprint:

1. **Classes assignment path (28.6C) BEFORE Active Assignments removal (28.6D).**
   The teacher must never lose the assignment-management entry point.
2. **Class workspace usable BEFORE Classes becomes the default landing (both in
   28.6D, D after C).**

Everything else is arranged to minimize risk and keep the tree green between
phases. 28.6G (Student My Science) is independent of the teacher phases and may
run in parallel once 28.6B is accepted.

Each phase ends with a green deterministic baseline (App `verify`; Functions
Jest; Rules where touched) and no em dashes. No phase commits, pushes, or
deploys; Chris performs commits.

---

## 28.6C - Classes & Class Workspace Operational Architecture

**Goal:** stand up the class-centered operational assignment path so it can
replace Curriculum → Active Assignments. This is a re-home + filter of existing,
certified pieces, not a rebuild.

**Scope**
- Class workspace gains **Overview · Assignments · Students**, implemented by
  extending the existing Snapshot/Roster segmented switcher (Sprint 28.5 D3), not
  new routing.
  - Overview = existing Snapshot surface (class name, grade/block, roster/link
    state, assignment count).
  - Assignments = `renderActiveAssignmentsSection` re-parameterized to filter
    `assignmentsTeacherList` items by the selected `classId` (items already carry
    `classId`); each row opens Assignment Detail.
  - Students = existing Roster surface.
- Top-level class card gains: grade/block line + assignment count (from the
  already-loaded teacher assignment list, grouped by `classId`; no per-class
  call). Optional single most-recent-assignment `N / M completed` line via a lazy
  `assessmentAssignmentSummary` read - include only if batching stays non-N+1;
  otherwise omit for now.
- `+ Add a class` entry on the Classes surface (including empty state) invoking
  the shared Import / Create workflows (no duplicate implementation).
- Assignment Detail entry point now reachable via Classes → Class → Assignments →
  row. Late-recipient add flow and Close/Reopen ride along unchanged
  (presentation demotion is 28.6D-adjacent but may land here since Detail is
  touched; keep backend untouched).

**Likely files**
- `app/src/shell/surfaces/classes.ts` (class card metrics, `+ Add a class`,
  section switcher).
- `app/src/shell/surfaces/snapshot.ts` (Overview mapping).
- `app/src/shell/surfaces/shared/activeAssignments.ts` (add `classId` filter
  parameter; keep the Curriculum mount working until 28.6D).
- `app/src/shell/surfaces/workspace.ts` (outlet wiring for the class-scoped
  Assignments → Assignment Detail path).
- `app/src/assignments/detail/*` (entry from class context; no capability change).
- Reuse: `assignmentsTeacherList`, `assessmentAssignmentSummary`,
  `assignmentsRecipientCandidatesList`, `assignment-recipients`,
  `classes/listClasses`.

**Required tests**
- Class card renders correct assignment count grouped by `classId` (no N+1).
- Class Assignments section lists only the selected class's assignments and opens
  Assignment Detail by `assignmentId`.
- `+ Add a class` invokes the same Import/Create workflow entry as Settings.
- Assignment Detail late-recipient add + Close/Reopen still pass their existing
  suites from the new entry path (no regression).
- No new Functions/Rules behavior → Functions/Rules baselines unchanged.

**Stop conditions**
- Do NOT remove Active Assignments from Curriculum in this phase.
- Do NOT change default landing or nav order in this phase.
- Do NOT alter any callable, rule, or the assignment lifecycle backend.

### 28.6C - Execution record

**Disposition: COMPLETE.** The class-centered operational path
(Classes -> Class -> Assignments -> Assignment Detail -> return) is implemented,
reuses existing architecture, and passes deterministic regression coverage. No
Functions or Firestore Rules change was required; both baselines are untouched.
Migration safety held: Curriculum -> Active Assignments and the default
Curriculum landing, nav order, and Present Mode are all unchanged (28.6D still
owns those).

**Implementation (production files):**
- `app/src/shell/surfaces/shared/activeAssignments.ts` - added two optional,
  default-off params to `renderActiveAssignmentsSection`: `classIdFilter`
  (filters the registry to one class before every split/count) and `flat`
  (renders the certified assignment cards directly, no accordion). The
  Curriculum accordion path is byte-identical when both are omitted, so
  Curriculum keeps working through 28.6C. Reuses the existing renderCard /
  progress cache / ordering / Show-closed toggle - no row renderer duplicated.
- `app/src/assignments/detail/detail.ts` - added optional `backLabel`
  (default `"Back to Curriculum"`); the Classes path passes `"Back to class"`.
- `app/src/shell/surfaces/curriculum.ts` - extended the shared
  `CurriculumAssignmentDetailSeam.open` to accept optional
  `AssignmentDetailOpenOptions` ({ onBack, backLabel }); Curriculum callers are
  unchanged (no options).
- `app/src/index.ts` - `openAssignmentDetail(id, options?)` uses
  `options.onBack` when supplied (else the certified `remountCurriculum` +
  scroll-restore path) and threads `backLabel`. Deep-link/direct Detail entry
  is unchanged.
- `app/src/shell/shell.ts` - extracted the single `navigateTo` transition
  (shared by nav clicks and a new `navigateToSurface` seam) and added a
  shell-owned, one-shot `classesReturn` location so returning from Detail
  re-lands in the class's Assignments section. Threaded `assignmentDetail`,
  `assignmentSummary`, `navigateToSurface`, and the classesReturn getter/setter
  into `workspaceDeps`.
- `app/src/shell/surfaces/workspace.ts` - added the new deps to `WorkspaceDeps`
  and passed them to `renderClassesSurface`.
- `app/src/shell/surfaces/classes.ts` - the core change: `ClassWorkspaceTab`
  gains `assignments`; the switcher is relabelled Overview / Assignments /
  Students (internal keys `snapshot`/`roster` kept so certified testids hold);
  the class card gains an assignment count grouped from the already-loaded
  teacher registry (published+closed, drafts excluded) and compact grade
  (`G6 · Block A`); a new `renderClassAssignmentsSurface` reuses the flat,
  classId-filtered Active Assignments renderer with a calm empty state routing
  to Curriculum; a "+ Add a class" labelled grouping wraps the existing
  Import/Create workflows (no duplicate implementation); one-shot return-context
  restore on mount.

**Data source / boundedness:** class-card counts and the class Assignments
section both read the single session-hydrated `assignmentsTeacherList` registry
(already carries `classId`) and filter in memory. No per-class callable, no
N+1: the only per-card summary reads are the pre-existing lazy
`assessmentAssignmentSummary` calls for the *visible* cards of the *one* opened
class, exactly as Curriculum already did. Count semantics == section semantics
(published + closed; drafts never surfaced or counted).

**Tests added:** `app/src/shell/surfaces/classes.assignments.test.ts` (16 -
card name/grade/block, count grouped by classId, other-class isolation, empty
count, empty-state Add-a-class, create workflow reuse, Overview/Assignments/
Students switcher, class-scoped filtering incl. Show-closed, open records
return context + opens by id with `backLabel`, empty Assignments -> Curriculum,
one-shot return restore). `app/src/shell/shell.class-assignments.test.ts` (5 -
real-shell open into the outlet with chrome intact + Classes active, Back
returns to the class Assignments section, Curriculum-origin path unaffected,
default landing unchanged, nav order + Present Mode unchanged). One certified
assertion updated for the compact-grade card (`app/src/shell/shell.test.ts`:
`Grade 6` -> `G6`).

**Validation:** `typecheck` clean; `lint` clean; app Jest 1943/1944 passing.
The single failure is the pre-existing curriculum-manifest SHA drift
(`curriculum:verify` DRIFT / `curriculumManifest.test.ts`), which predates this
phase (this phase modified none of `index.html`,
`app/src/curriculum/curriculum.manifest.json`, or the manifest generator) and
is out of scope - not regenerated. `lessons:verify` OK. Functions/Rules
untouched (no run needed for correctness of these app-only changes). Local
UX-review environment confirmed serving the rebuilt bundle and seeded accounts;
the authenticated click-through could not be automated because the Auth
emulator `signInViaPopup` frame relay is unsupported in the headless review
browser (tooling limitation, not a defect).

**Bounded deviations from blueprint:** none material. The optional class-card
"most recent assignment completed/total" preview line (Blueprint §5, explicitly
optional) was omitted: it would require a per-card summary read on the list
(N+1) or new projection work, so assignment count alone is used for the cleaner,
bounded card. The blueprint's flat class Assignments intent is met by extending
the shared renderer with a `flat` variant rather than duplicating it.

---

## 28.6D - Teacher Navigation + Curriculum Simplification

**Goal:** now that Classes owns the operational path, make Classes the home,
simplify Curriculum to lesson-centric, and retire Present Mode.

**Scope**
- Navigation: reorder `NAVIGATION_ITEMS` to Classes · Curriculum · Settings;
  point the brand/`Workspace` item's `targetSurface` at `classes`; set default
  `activeKey`/initial surface to `classes`; remove the `present-mode` item and
  drop `"present-mode"` from `WorkspaceSurfaceKey`.
- Curriculum: **remove the Active Assignments section** (its replacement lives in
  Classes as of 28.6C). Curriculum becomes lesson cards only.
- Curriculum lesson card gains **Assign** (primary, existing), **Preview**
  (quieter), **View Summary** (secondary; unavailable until 28.6E data exists),
  **Resources · N** disclosure.
- Preview control opens `buildLessonBasePath(slug)` (no `?assignment`) in a new
  tab (`rel="noopener"`). No callable.
- Leave `presentMode.ts` / `app/src/presentMode/*` dormant (not deleted).

**Likely files**
- `app/src/shell/navigation.ts` (order, brand target, remove Present Mode,
  default active).
- `app/src/shell/shell.ts` / `router/routes.ts` (initial surface = classes;
  surface-key type change).
- `app/src/shell/surfaces/curriculum.ts` (remove Active Assignments mount; add
  card actions).
- `app/src/curriculum/curriculumManifest.ts` (already exposes title/grade/topic/
  resources; no change expected beyond consumption).
- Reuse `buildLessonBasePath` from `app/src/assignments/studentList/launch.ts`.

**Required tests**
- Nav renders Classes/Curriculum/Settings in order; default landing is Classes;
  Present Mode absent; `aria-current` on the active item.
- Curriculum no longer renders Active Assignments; renders Assign/Preview/
  Resources; View Summary shows an unavailable/empty state pre-28.6E.
- Preview opens the override-aware v2 path with no `?assignment`; a preview visit
  creates no session/attempt (assert inert runtime; no callable invoked).
- Existing routing/selected-state tests updated for the new default and the
  removed surface.

**Stop conditions**
- Must land AFTER 28.6C (dependency: Active Assignments now lives in Classes).
- Do NOT delete Present Mode source; only remove it from nav/routing.
- Preview must never append `?assignment` and never mint a fake identity.

### 28.6D - Execution record

**Disposition: COMPLETE.** The teacher information-architecture transition
landed as client/presentation work only. No Functions, Firestore Rules, or
Firestore index change was required or made. The curriculum manifest was not
regenerated. Migration safety held: 28.6C's Classes -> Class -> Assignments ->
Assignment Detail path is the sole assignment-management entry point, and it was
in place before this phase removed Active Assignments from Curriculum.

**Teacher default / navigation transition.**
- Default landing surface changed from Curriculum to **Classes**
  (`shell.ts` initial `activeKey = "classes"`; `navigation.ts` `renderNavigation`
  default `activeKey = "classes"`).
- Primary navigation reordered to **Classes · Curriculum · Settings** with the
  LYFELABZ brand item first; the brand `targetSurface` moved from `curriculum`
  to `classes`. `WorkspaceSurfaceKey` dropped `"present-mode"`.
- Fixed a mount-ordering seam: the shell now attaches its body to the connected
  mount **before** rendering the initial surface, because the Classes surface
  guards its first paint on `mount.isConnected` (Curriculum did not). DOM order
  (header, body, footer) is unchanged.
- Deep-link / explicit-destination behavior preserved: Assignment Detail is still
  opened by `assignmentId` through the outlet seam regardless of the active
  surface, and the active nav context is left untouched while Detail overlays.

**Present Mode disposition.** Removed from the primary navigation and from the
`WORKSPACE_SURFACES` registry (unreachable through the outlet). The
`presentMode.ts` surface module and `app/src/presentMode/*` remain **dormant**
in the tree (not deleted); their unit tests (`launchContext.test.ts`,
`returnControl.test.ts`) stay green. The `onLaunchPresentMode` / `LaunchPresentMode`
plumbing is retained as documented dormant wiring so a future genuine
classroom-presentation tool can restore the destination without re-threading.
No future Present Mode features (timers, pacing, sync, polling) were added.

**Active Assignments removal.** The `renderActiveAssignmentsSection` mount and its
per-assignment invalidator were removed from `curriculum.ts`. The shared renderer
itself is untouched and now belongs to the Classes Assignments workflow (28.6C).
The Curriculum-side per-assignment **View summary / View summaries / View drafts**
opener (Sprint 13B/13C/13F) and its selection interface were also removed: they
navigated into a specific assignment's Detail (operational, assignment-specific),
which is now a Classes concern, and would have pre-labelled that as "View Summary"
against the locked 28.6E lesson-analytics meaning. Assign lifecycle, publication,
recipient freezing, OAuth, and the assignment registry `register()` are unchanged;
the registry is still hydrated and fed on publish (now consumed by Classes).

**Curriculum lesson card (final 28.6D contract).** Title · compact grade tag
(`G6`/`G7`, presentation-only) · science-domain label · **Assign** (primary,
unchanged, always re-assignable) · **Preview** (quieter link) · **Resources · N**
(disclosure, only when formal resources exist). View Summary is intentionally
**absent** in 28.6D (see below). The quiet "✓ Assigned" history badge is retained
(Task 11) but never disables Assign and its accessible name is "Assign … again".

**Preview architecture implemented.** A per-card `<a target="_blank"
rel="noopener">` whose `href` is `buildLessonBasePath(slug)` (the override-aware
v2 path) with **no** `?assignment` query. Reuses the existing launcher seam; no
callable, no duplicate renderer. By construction the standalone/inert v2 runtime
returns before any Firebase init, so Preview creates no session/attempt/result,
needs no fake student, and touches no assignment or Classroom state. A regression
test asserts every surfaced lesson resolves to a `/app/lessons/...` v2 override
(no legacy v1 fallback).

**Resources behavior.** Sourced from the existing manifest via new read-only
selectors (`getUnitBySlug`, `getFormalResourcesForLesson`, `FORMAL_RESOURCE_LABEL`).
Formal inventory confirmed against the 28.6B count: 3 simulations + 4
investigations + 5 extensions + 1 challenge = **13**, across 13 lessons. Legacy
games are excluded (`game: 0`; the selector filters to the four formal types).
Interaction is a native `<button aria-expanded/aria-controls>` toggling an inline
panel; each resource shows a human-readable type, its title, and an **Open** link
to the canonical manifest URL in a new tab (Open/Preview only, never assignable).
A lesson with no formal resources shows no Resources control.

**View Summary intermediate state (Option C - hidden until 28.6E).** No View
Summary control renders on the Curriculum card in 28.6D. No fake analytics, no
client fan-out, and no assignment-specific summary mislabelled as lesson-level
analytics. No user-facing "coming soon" placeholder. This preserves the locked
28.6E meaning ("how has this lesson performed across the classes/assignments I
own"); the callable and surface are 28.6E's to add.

**Files changed.**
- Production: `app/src/shell/navigation.ts`, `app/src/shell/shell.ts`,
  `app/src/shell/surfaces/workspace.ts`, `app/src/shell/surfaces/curriculum.ts`,
  `app/src/curriculum/curriculumManifest.ts`, `app/index.html` (shell host-page
  CSS for `.shell-lesson-preview` and the `.shell-lesson-resources*` disclosure,
  plus the coarse-pointer tap-target rule).
- Tests: `app/src/shell/shell.test.ts` (nav order, default landing, Present Mode
  absence, brand-lands-on-Classes, removed obsolete Present Mode / View summary
  (13B/13C/13F) / Sprint 16 dashboard-refresh blocks, updated the CSS
  required-class list), `app/src/shell/shell.class-assignments.test.ts` (28.6C
  migration-safety block re-pointed to the 28.6D transition),
  `app/src/shell/shell.detail-outlet.test.ts`, `app/src/router/router.test.ts`,
  `app/src/router/surfaces/surfaces.test.ts`,
  `app/src/shell/surfaces/curriculum.layout.test.ts`,
  `app/src/shell/surfaces/curriculum.false-success.test.ts`,
  `app/src/curriculum/curriculumManifest.test.ts` (new formal-resource selector
  block); new `app/src/shell/surfaces/curriculum.preview-resources.test.ts`.

**Validation.** `typecheck` clean; `lint` clean; `lessons:verify` OK. App Jest
**1913/1914 passing**. The single failure is the pre-existing curriculum-manifest
SHA drift (`curriculum:verify` DRIFT / `curriculumManifest.test.ts`), the known
Sprint-29-owned baseline documented in 28.6C; this phase did not touch the root
`index.html` curriculum source or the manifest JSON, and did not regenerate the
manifest. Authenticated click-through remains un-automatable (Auth-emulator popup
relay unsupported in the headless browser, per 28.6C); a static CSS harness of
the revised cards was produced for visual review.

**Bounded deviations from blueprint.** The blueprint card mockup shows a "View
Summary" affordance; per the 28.6D task boundary and Blueprint §18 ("absent or
clearly unavailable" until 28.6E) it is hidden in this phase (Option C), not
rendered. The Sprint 13B/13C/13F Curriculum "View summary" opener was removed
rather than relabelled, because relabelling per-assignment navigation as lesson
analytics would violate the locked 28.6E meaning. No other material deviation.

### Sprint 28.6D.1 Resource Hierarchy Polish

**Disposition: COMPLETE.** A bounded production UI refinement of the Curriculum
lesson card. No 28.6D architecture was reopened: the curriculum manifest, the
formal-resource selectors, resource URLs, parent-lesson relationships, resource
types/counts (3 simulations + 4 investigations + 5 extensions + 1 challenge =
**13**, games excluded), Preview, and the assignment path are all unchanged.
Resources remain Open/Preview only, never assignable. View Summary stays absent
(28.6E owns it). Client/presentation only - no Functions, Rules, index, or
manifest change.

**Why.** Review found the Resources area was the weakest part of the card: the
large outlined `Resources · N` pill competed visually with Assign/Preview, the
gray type capsule + title read as a second content block, and the card ran tall
with too much air between the title and the primary actions. The fix is
hierarchy only: Lesson identity -> primary actions -> quiet supplemental
resources.

**Spacing.** `.shell-lesson-actions` top margin tightened 0.55rem -> 0.35rem so
lesson identity and Assign/Preview read as one connected unit. The two-line
title clamp and equal-height card contract are preserved; nothing else in the
card metrics changed.

**Section separation (footer).** `.shell-lesson-resources` gains a light
`border-top: 1px solid var(--tw-hairline-soft)` plus 0.4rem padding-top - the
lightest treatment that makes Resources read as a supporting-material footer.
No heavy rule.

**Collapsed Resources pattern.** The outlined pill is gone. The disclosure is a
borderless, left-aligned text row: a count label with correct grammar - **"1
Resource"** (singular) / **"N Resources"** (plural, via the pure
`formatResourceCountLabel` helper) - followed by a CSS `::after` chevron (`›`)
that rotates 90deg to point down under `[aria-expanded="true"]`. State is carried
by shape + `aria-expanded`, never by color; no icon library. A zero-resource
lesson still renders no disclosure at all (no "0 Resources", no disabled
control). Reduced-motion disables the caret transition.

**Expanded resource-row pattern.** Each resource is a compact row, not a nested
card: a small uppercase muted **type eyebrow** (letter-spaced, no capsule/pill
background), the **resource title** as the primary row content, and a quiet
secondary **Open** link. The Open link's discernible name still carries the
resource type + title + new-tab semantics, so the identity is fully represented
in text even though the visible word is "Open". Rows use `flex-wrap`, so on
narrow widths the title wraps and Open repositions/drops naturally; multiple
resources stay a concise scannable list (no giant per-resource buttons, no
oversized padding).

**Card hierarchy (final).** Lesson identity (grade tag · domain · title) ->
Assign (primary green, unchanged prominence) / Preview (secondary) -> Resources
(quietest; visually secondary to both).

**Accessibility preserved.** Native `<button>` disclosure with
`aria-expanded`/`aria-controls`; keyboard activation and a visible focus ring
(`--tw-focus-ring`) on the now-borderless toggle; resource type still present in
text; discernible Open link names; new-tab (`target=_blank rel=noopener`)
semantics retained. No icon-only controls, no added ARIA.

**Tests.**
- Updated `app/src/shell/surfaces/curriculum.preview-resources.test.ts`:
  singular collapsed label ("1 Resource", no `·` bullet), plural grammar via the
  exported helper (the surfaced manifest carries at most one formal resource per
  lesson, so the plural DOM path is not reachable through the real surface),
  and the expanded row now asserting a type eyebrow + a distinct title element +
  a secondary "Open" link that still names the resource.
- Updated `app/src/shell/shell.test.ts`: added `shell-lesson-resource-type` and
  `shell-lesson-resource-title` to the required-styled-class list, plus a lean
  CSS regression asserting the toggle rule dropped the outlined pill
  (`border: none`, no `border-radius: 99px`), the type lost its capsule
  background and is uppercased, and the resources footer has a `border-top`.

**Validation.** `typecheck` clean; `lint` clean. App Jest **1915/1916
passing**; the sole failure is the same pre-existing curriculum-manifest SHA
drift baseline (Sprint-29-owned) - this phase did not touch the root
`index.html` curriculum source or the manifest JSON and did not regenerate the
manifest. Authenticated click-through remains un-automatable (Auth-emulator
limitation per 28.6C); a temporary static harness built from the real production
CSS + the exact card DOM was rendered at 1280 and mobile for visual review of
the one-resource, multi-resource, and zero-resource cards, then deleted (not
added to production).

**Files changed.**
- Production: `app/src/shell/surfaces/curriculum.ts` (singular/plural helper +
  restructured resource row), `app/index.html` (Curriculum card CSS: tightened
  action spacing, resources footer border, borderless caret disclosure, eyebrow
  type + title + secondary Open, reduced-motion).
- Tests: `app/src/shell/surfaces/curriculum.preview-resources.test.ts`,
  `app/src/shell/shell.test.ts`.
- Documentation: this note.

---

## 28.6E - Lesson-Level View Summary Analytics

**Goal:** implement the bounded server aggregation and the Curriculum View
Summary surface.

**Scope**
- New callable `assessmentLessonSummary` per Blueprint Sections 10-11:
  input `{ lessonSlug }`; caller-scoped auth via `requireDistrictContext`; reuse
  the `assignmentsTeacherList` query shape (`teacherId== schoolId== status in
  [published,closed]`) then filter `lessonSlug` in memory; per matched assignment
  read `recipients` + `attempts`; aggregate to `classesAssigned`, `students`,
  `studentsCompleted`, `completionPercentage`, `averageBestPercentage`,
  `assignmentsConsidered`. Unique-student semantics; PDR-029 tie-break extended
  with a final `assignmentId` tiebreak; half-up rounding. **No new index.**
- Register the callable in `platform/functions/src/assessments/index.ts` and the
  functions root index.
- Client: `app/src/assignments/summary/*` gains a lesson-summary wire; Curriculum
  card View Summary control fetches and renders the aggregates (table/definition
  list; Completion shown as `X / Y students completed`).

**Likely files**
- `platform/functions/src/assessments/assessment-lesson-summary.ts` (new).
- `platform/functions/src/assessments/index.ts`; `platform/functions/src/index.ts`.
- `app/src/assignments/summary/wire.ts`, `types.ts`.
- `app/src/shell/surfaces/curriculum.ts` (View Summary rendering + entry states).

**Required tests (Functions, exhaustive - security + determinism)**
- Auth: non-teacher `role-forbidden`; cross-teacher/cross-school/cross-district
  assignments excluded; client-supplied owner-scoping keys refused.
- Query: only owned published/closed assignments of the slug considered; drafts/
  archived excluded; malformed rows dropped.
- Semantics: distinct-class count; unique-student dedup across repeated
  assignments (same class re-assign and two-class cases); completion numerator =
  unique students with ≥1 completed attempt; average over completed students only;
  best-attempt selection deterministic across assignments (tie-break incl.
  `assignmentId`).
- Empty/unknown slug → all-zero / `null` average, no error; malformed slug →
  `assignments.invalidRequest`.
- Projection: no identifiers/PII/answer-key/response values cross the boundary.
- Confirm `firestore.indexes.json` unchanged (still `"indexes": []`).

**Stop conditions**
- Do NOT add a Firestore composite index.
- Do NOT implement any deferred advanced-analytics field.
- Do NOT do client-side fan-out across classes the teacher does not own.

### 28.6E - Execution record

**Disposition: COMPLETE.** The lesson-level View Summary capability is
implemented end to end: a new bounded, caller-scoped callable
(`assessmentLessonSummary`), a typed client wire, and a Curriculum-owned
lesson-summary surface reached from a gold-accented View Summary control on
the lesson card. No Firestore Rules change and no new Firestore composite
index were required or made (`firestore.indexes.json` remains
`"indexes": []`). The curriculum manifest was not regenerated. Classes
remains the operational home; no student-specific information moved back
into Curriculum.

**Callable (`platform/functions/src/assessments/assessment-lesson-summary.ts`).**
- Input `{ lessonSlug }` only. `lessonSlug` validated against the canonical
  `LESSON_SLUG_PATTERN`; forbidden owner-scoping/aggregation keys
  (`teacherId`, `schoolId`, `districtId`, `classId`, `studentId`,
  `assignmentId`, `status`, `includeDrafts`, `groupBy`, `aggregate`,
  `filter`, ...) are all refused with the single canonical
  `assignments.invalidRequest`.
- Authorization reuses the certified teacher-summary pattern:
  `requireDistrictContext` gates authentication/active/claims/district
  agreement; non-teachers get `role-forbidden`. Ownership is derived
  entirely from the verified caller context (`uid`, `schoolId`,
  `districtId`) - never a client identifier.
- Query strategy is the exact `assignmentsTeacherList` indexed shape
  (`teacherId == uid`, `schoolId == schoolId`, `status in
  [published, closed]`), then an in-memory filter to
  `record.lessonSlug === lessonSlug` plus a belt-and-suspenders ownership
  re-check. Per matched assignment it reads the frozen `recipients`
  subcollection and `attempts.where(assignmentId==id)` in parallel
  (bounded by the matched set; no fan-out over unowned classes, no
  sessions read). Every recipient and attempt is re-validated against the
  loaded assignment and caller context exactly as
  `assessmentAssignmentSummary` does.
- Output `{ lessonSlug, classesAssigned, students, studentsCompleted,
  completionPercentage, averageBestPercentage, assignmentsConsidered }` -
  bounded numeric aggregates only. No student/attempt/recipient/class/
  session identifier, name, email, response, item result, or answer-key
  value crosses the boundary.

**Aggregation semantics (unique-student, Blueprint §11).** A pure,
Firestore-free `aggregateLessonSummary(...)` helper carries the math so the
semantics are deterministically testable:
- **Classes Assigned** = distinct `classId` among the matched owned
  published/closed assignments (a class assigned twice counts once).
- **Students** = distinct `studentId` across the union of the matched
  assignments' frozen `recipients` populations (a student who received the
  lesson in two assignments counts once).
- **Completion** = `studentsCompleted / students`, half-up integer percent;
  `studentsCompleted` = distinct population students with >=1 valid
  completed attempt in any matched assignment; `0` when `students === 0`.
- **Average Best Score** = mean of each distinct completed student's single
  best completed percentage across all matched assignments; denominator is
  distinct completed students (non-completers never contribute a zero);
  `null` when no completed students.
- **Best-attempt selection** reuses the certified per-assignment
  `selectHighestCompletedAttempt` (PDR-029 §6) unchanged; the only added
  logic is the documented cross-assignment tie-break (ascending
  `assignmentId`) applied after rules 1-4, so lesson-level selection is
  fully deterministic and never depends on read order. No second
  best-attempt algorithm was invented. Half-up rounding matches
  `assessmentAssignmentSummary`.

**Repeated-assignment proof.** The load-bearing scenario (Class A #1: S1
best 60, S2 no completion; Class A #2: S1 best 90, S2 70; Class B #3: S1
recipient, S3 80) computes exactly `classesAssigned 2`, `students 3`,
`studentsCompleted 3`, `completion 100%`, `averageBestPercentage 80`
((90+70+80)/3), `assignmentsConsidered 3` - covered by both a callable test
and a pure-helper test.

**Curriculum View Summary surface.**
- The lesson-card control (`app/src/shell/surfaces/curriculum.ts`) is
  rendered only when the lesson-summary callable is wired, and is visible
  only for a lesson with owned published/closed assignment history - driven
  by the existing quiet assignment-history signal (`assignmentDetail.list()`
  filtered to published/closed, the same signal that lights "✓ Assigned"),
  so no extra request is made to paint the card and never-assigned lessons
  show no dead control. `refreshAssignControl` reveals it in step with a
  first in-session assignment.
- Visual hierarchy: Assign (primary green) -> Preview (neutral secondary)
  -> View Summary (restrained gold-accented analytical secondary,
  right-aligned) -> Resources (quietest footer disclosure). New
  `--tw-gold*` tokens carry the accent; text stays calm ink for AA
  contrast.
- The surface (`app/src/shell/surfaces/lessonSummary.ts`) renders into the
  Curriculum outlet: the lesson grid is wrapped in `curriculum-view` and
  hidden (not destroyed) while the summary mounts alongside, so the Teacher
  Workspace shell stays mounted and Curriculum remains the active global
  nav context. It shows an intentional loading state (`role="status"`, no
  zero-value flash), the four metric cards (Completion carries the explicit
  `X / Y students completed` fraction; a null Average renders "No completed
  scores yet", never 0%), a calm "open the class under Classes" pointer,
  and an error callout (`role="alert"`, calm copy, keyboard Retry, no raw
  Firebase/callable detail). Back to Curriculum restores the grid and
  returns focus to the triggering control.

**Wiring.** `assessmentLessonSummary` is exported through
`assessments/index.ts` and the functions root `index.ts` (same registry as
the other assessment callables). Client injection follows the established
testable seam: `createLessonSummaryCallable` (`assignments/summary/wire.ts`)
-> entry-point `lessonSummary` slot (teacher-only, null for student/other)
-> route table -> `SurfaceDeps` -> `mountTeacherShell` -> `WorkspaceDeps` ->
`renderCurriculumSurface`. Typed contract `LessonSummary` /
`LessonSummaryCallable` with response validation (no `any`).

**Tests.**
- Functions: `assessment-lesson-summary.test.ts` (38) - non-teacher
  `role-forbidden`, district-gate propagation, malformed/empty/forbidden-key
  requests, zero-data (never assigned; assigned-no-completions), single
  assignment, same-class re-assign dedup, the repeated-assignment proof,
  cross-assignment best selection, half-up rounding, closed included,
  draft/archived excluded, other-lesson excluded, other-teacher excluded,
  cross-school excluded, malformed-recipient drop, non-population attempt
  exclusion, late-recipient inclusion, no-PII projection shape, and pure
  `aggregateLessonSummary` determinism (incl. the assignmentId tie-break).
- App: `lessonSummary.test.ts` (9) - loading, four-metric render,
  zero-completion, null-average note, error `role=alert` + keyboard retry +
  recovery, Back button, aggregate-only (no table/roster/student rows).
  `curriculum.view-summary.test.ts` (6) - control visible with history,
  hidden when never assigned, absent when no callable wired, open hides the
  grid and mounts the surface, Back restores the grid, action-order/gold
  hierarchy.

**Validation.** Functions `tsc` + `eslint` clean; full Functions Jest
**1746/1746**. App `typecheck` + `lint` clean; `lessons:verify` OK; app
Jest **1929/1930** - the sole failure is the pre-existing curriculum-manifest
SHA drift (`curriculumManifest.test.ts`, Sprint-29-owned baseline; this
phase touched neither the root `index.html` curriculum source nor the
manifest JSON and did not regenerate it). `firestore.indexes.json`
unchanged (`"indexes": []`); no Rules change. Authenticated click-through
remains un-automatable (Auth-emulator popup relay unsupported in the
headless review browser, per 28.6C/D); a temporary static harness built
from the real production CSS + the exact card/surface DOM was rendered for
visual review of the card control and the metric grid, then deleted (not
added to production).

**Bounded deviations from blueprint.** None material. Per-class-doc
ownership re-verification (used by the single-assignment
`assessmentAssignmentSummary` because it starts from an arbitrary
client-supplied `assignmentId`) is intentionally not repeated here: the
lesson summary starts from the server's own `teacherId == uid && schoolId
== schoolId` query, so every considered assignment is caller-owned by
construction and no client identifier is trusted; recipients/attempts are
still re-validated per-record. This keeps reads bounded (recipients +
attempts per matched assignment only, no extra class read per assignment)
exactly as Blueprint §10 mandates.

---

## 28.6F - Settings Simplification

**Goal:** restrained, functional Settings; remove Default Grade; make class
management the administrative home.

**Scope**
- Settings sections: **Classes & Google Classroom** (connection state; Import
  primary; Create secondary) · **Account** · **Preferences** (only if a real
  preference remains; else omit).
- Remove Default Grade UI and the Manual Create prefill read/write (Blueprint
  Section 14). Keep per-class grade/block and `needsSetup`. Leave stored
  `defaultGrade` docs inert - no migration.
- Ensure Settings class-management and Classes `+ Add a class` share one workflow
  implementation.

**Likely files**
- `app/src/shell/surfaces/settings.ts` (section restructure; remove Default
  Grade; import primary / create secondary).
- `app/src/classes/createClass.ts` / manual-create form (remove prefill).
- `app/src/teacherPreferences/*` (remove Default Grade read/write consumers).
- `platform/functions/src/teachers/teacher-preferences-update.ts` (leave deployed;
  ignore `defaultGrade` or leave unused - no repurpose).

**Required tests**
- Settings renders the three (or two) sections; no future-facing placeholders; no
  Default Grade control.
- Manual Create no longer reads/writes `defaultGrade`; class creation still
  requires per-class grade/block; `needsSetup` path intact.
- `+ Add a class` and Settings invoke the same Import/Create workflow.
- Remove/adjust Default-Grade tests; preserve remaining teacher-preferences infra
  tests.

**Stop conditions**
- Do NOT migrate or delete stored preference documents.
- Do NOT remove per-class grade/block or `needsSetup`.

### 28.6F - Execution record

**Disposition: COMPLETE.** Settings is simplified to the locked v1 model, the
global Default Grade preference is removed from the product, and Settings +
Classes now reuse one class-management workflow implementation. Client /
presentation work only: no Functions, Firestore Rules, or Firestore index
change was made, and the curriculum manifest was not regenerated. All certified
Google Classroom, `needsSetup`, activation, manual-class, and join-code
behavior is preserved.

**Final Settings architecture.** A single administrative section, **Classes &
Google Classroom** (`app/src/shell/surfaces/settings.ts`):
- A read-only Google Classroom connection line (`role="status"`), derived from
  the existing Integrations `describeConnections` seam - "Connected" when any
  connection is active, "not connected" otherwise, with a calm loading and a
  calm error state. No scopes / tokens / provider ids / credential metadata
  ever render.
- **Import Class from Google Classroom** - primary (filled) hierarchy.
- **Create LyfeLabz Class** - secondary (outlined) hierarchy.
- **Manage Google Classroom connection** - opens the existing Integrations
  subview (connect / reconnect / disconnect stay where they safely live); shown
  only when the Integrations seam is wired.
There is **no Account section** and **no Preferences section**: the signed-in
identity and Log out both already live in the shell header (and the surface
deliberately never re-renders Session identity - a standing privacy invariant),
and after Default Grade removal no real v1 teacher preference remains. Product
restraint over filler, per the blueprint.

**Removed from the live surface.** The five future-facing preference
"categories" (Classroom / Present Mode / Notifications / Connected Services /
Account previews - four were inert placeholders), the "What Settings will
organize" heading, the future-growth notice, and the global Default Grade
select. No "Coming Soon" or disabled placeholders replaced them. The dead
`.shell-settings-category-button` CSS rule was removed with them.

**Settings audit (every prior visible item).**
| Previous item | Disposition | Reason |
| --- | --- | --- |
| Intro "Manage your LyfeLabz preferences…" | Replaced | One calm sentence answering "How is LyfeLabz configured?" |
| "What Settings will organize" heading | Removed | Roadmap framing |
| Classroom Preferences (preview, inert) | Removed | Future-facing placeholder |
| Present Mode Preferences (preview, inert) | Removed | Future-facing placeholder; Present Mode left v1 in 28.6D |
| Notification Preferences (preview, inert) | Removed | Future-facing placeholder |
| Connected Services (live → Integrations) | Reframed | Folded into Classes & Google Classroom as "Manage Google Classroom connection" (same Integrations subview) |
| Account Preferences (preview, inert) | Removed | Future-facing placeholder; real identity/Log out live in the header |
| Default grade for new classes (select) | Removed | Locked decision (Blueprint §14): grade/block belongs to the class |
| Future-growth notice | Removed | Roadmap filler |
| (new) Classes & Google Classroom section | Added | Administrative home for class setup: connection state + Import (primary) + Create (secondary) |

**Default Grade disposition.**
- **UI:** the Settings default-grade select is gone; the Manual Create and
  imported-class setup forms no longer seed grade from any preference - grade
  and block always begin empty and must be chosen for each class.
- **Client read/write:** removed. `teacherPreferences/read.ts` (+ its test) and
  `teacherPreferences/update.ts` were deleted; the resolved-preference state,
  the fail-closed read, the best-effort write after create/activate, and the
  getters were removed from `index.ts`, `router/surfaces/index.ts`, `shell.ts`,
  `workspace.ts`, `settings.ts`, and `classes.ts`. No dead client call remains
  (the `teacherPreferencesUpdate` wrapper had no other caller).
- **Grade domain kept:** `teacherPreferences/types.ts` retains only the closed
  grade union (`TeacherDefaultGrade` / `TEACHER_DEFAULT_GRADE_VALUES` /
  `isTeacherDefaultGrade`), which is the per-class grade domain used by the
  class create form, the setup form, and the `classesActivate` client seam. The
  name is retained to avoid an out-of-scope rename across certified call sites.
- **Backend callable:** `teacherPreferencesUpdate` is left **deployed but
  dormant** - unchanged, no client caller. No Functions change (backend risk
  avoided per the blueprint's "leave inert" guidance).
- **Historical data:** existing `users/{uid}/preferences/teacher.defaultGrade`
  documents remain inert and unread. **No migration; no production mutation.**
- **Proof class setup no longer depends on it:** a Manual Create and an imported
  needsSetup class both start with empty grade/block and reject submit until the
  teacher chooses (existing per-class validation), verified by tests.

**Shared class-management architecture (one implementation, two entry points).**
The Import / Create workflow lives only on the Classes surface (`classes.ts`,
the `+ Add a class` grouping from 28.6C). Settings' Import / Create controls are
**openers**, not a second form: they call an injected `openClassManagement`
seam. That seam (owned by `shell.ts`) records a one-shot **class-management
intent** (`"import"` | `"create"`) - mirroring the existing 28.6C `classesReturn`
one-shot - and performs the same navigation as the Classes nav item. The next
Classes mount consumes the intent once: `"create"` opens the certified Manual
Create form and focuses the class-name input; `"import"` reveals and focuses the
certified Import entry point (the teacher confirms with one click so the OAuth
pop-up stays inside a user gesture). Classes `+ Add a class` and the zero-class
empty state open the very same controls. No duplicate import or create
implementation exists; Settings imports no create/import form rendering.

**Google import hierarchy / manual hierarchy.** Import is primary
(`.shell-settings-class-action--primary`, filled green, first in DOM); Create is
secondary (`.shell-settings-class-action--secondary`, outlined). A CSS
regression pins both rules present and distinct. Disconnected import is handled
by the existing import flow (which drives OAuth); no separate "Connect" UI was
built. OAuth scopes, consent, login_hint, token custody, identity binding,
publication adapter, topic discovery, and roster sync are untouched.

**Classes + Add a class behavior.** Unchanged from 28.6C and preserved:
discoverable on populated and empty Classes; the empty state is never a dead
end; both entry points now demonstrably drive the same workflow.

**Tests.**
- Added `settings.test.ts` (rewritten, 13): section + heading, Import/Create
  present with primary/secondary hierarchy and DOM order, Import/Create invoke
  the opener with the correct intent, connected/not-connected/unwired connection
  states, Manage opens Integrations, Default Grade absent, removed categories /
  growth notice absent, no empty Preferences / stray form controls, no Session
  identity leak, unwired disabled state + note.
- Added to `classes.assignments.test.ts` (Sprint 28.6F block, 4): create intent
  opens the shared Create form, import intent reveals the shared Import entry
  point, intent consumed exactly once, no-intent leaves the form closed.
- Added to `shell.test.ts`: an end-to-end reuse test (Settings Create routes the
  outlet to Classes and opens the certified Manual Create form) plus a
  Settings-CSS regression (primary/secondary rules present & distinct; dead
  category-button rule gone); rewrote the four obsolete Settings-content tests.
- Updated `classes.test.ts`: the "default grade preference" describe became
  "Manual Create grade/block (per-class)" - removed the prefill / best-effort
  write / preference-failure tests; kept and reframed the empty-grade,
  grade-required, chosen-grade/block-submitted, and needsSetup coverage.
- Removed `teacherPreferences/read.test.ts` and the obsolete
  `settings.category-spacing-css.test.ts` (both guarded removed behavior).
- Trimmed a stale `updateDefaultGrade: null` dep in
  `curriculum.class-cache-invalidation.test.ts`.

**Validation.** `typecheck` clean; `lint` clean; `lessons:verify` OK. App Jest
**1926/1927 passing** - the sole failure is the pre-existing curriculum-manifest
SHA drift (`curriculumManifest.test.ts`), the known Sprint-29-owned baseline
documented in 28.6C/D/E; this phase touched neither the root `index.html`
curriculum source nor the manifest JSON and did not regenerate the manifest.
No Functions or Rules change (both baselines untouched, so not re-run for
ceremony). `firestore.indexes.json` untouched. Authenticated click-through
remains un-automatable (Auth-emulator popup relay unsupported in the headless
review browser, per 28.6C/D/E); a temporary static harness of the exact Settings
DOM + production CSS was built for visual structure review and then deleted
(not added to production).

**Files changed.**
- Production app: `app/src/shell/surfaces/settings.ts`,
  `app/src/shell/surfaces/classes.ts`, `app/src/shell/surfaces/workspace.ts`,
  `app/src/shell/shell.ts`, `app/src/index.ts`,
  `app/src/router/surfaces/index.ts`, `app/src/teacherPreferences/types.ts`,
  `app/src/teacherPreferences/index.ts`, `app/index.html` (Settings CSS);
  deleted `app/src/teacherPreferences/read.ts`,
  `app/src/teacherPreferences/update.ts`.
- Functions: none.
- Tests: `app/src/shell/surfaces/settings.test.ts`,
  `app/src/shell/surfaces/classes.test.ts`,
  `app/src/shell/surfaces/classes.assignments.test.ts`,
  `app/src/shell/shell.test.ts`,
  `app/src/shell/surfaces/curriculum.class-cache-invalidation.test.ts`;
  deleted `app/src/teacherPreferences/read.test.ts`,
  `app/src/shell/surfaces/settings.category-spacing-css.test.ts`.
- Documentation: this record.

**Bounded deviations from blueprint.** None material. Settings consists of the
single Classes & Google Classroom section (the blueprint permits omitting
Account / Preferences when nothing real remains); the connection state is a
read-only mirror while connection *management* stays in the existing
Integrations experience, avoiding new async state or invented connection detail
on the top-level surface.

---

## 28.6G - Student My Science

**Goal:** single domain-grouped student page; integrated results; canonical
titles; retire My Results. Independent of 28.6C-F; may run in parallel after
28.6B.

**Scope**
- Merge `My Assignments` + `My Results` into **My Science** (Blueprint Section
  15): domain grouping from manifest `topic` via `lessonSlug`; canonical domain
  order; unfinished-then-completed tiers; unfinished/completed card contracts;
  canonical lesson title with stored-assignment-title fallback; best score +
  attempt count on completed cards; Open assignment via existing
  `buildAssignmentLaunchUrl`.
- Student shell: LYFELABZ · identity · Log out · `My Science`; remove the My
  Results destination/nav.

**Likely files**
- `app/src/router/surfaces/*` (`makeActiveStudentSurface`).
- `app/src/assignments/studentList/*`, `app/src/assignments/studentResults/*`
  (merge into one domain-grouped view; reuse existing derive logic).
- `app/src/curriculum/curriculumManifest.ts` (title + topic resolution by slug -
  add a small `getUnitBySlug`/title+topic selector if not present).

**Required tests**
- Cards grouped by canonical domain in the locked order; empty domains omitted;
  unresolvable slug → trailing "More" group + stored-title fallback.
- Within-domain ordering: unfinished before completed, then deterministic key.
- Completed card shows best %/score + attempt count and remains re-launchable
  (no separate Results action); Improve My Score preserved where < 100%.
- Canonical title used (not the stored assignment title); stored assignment
  document unchanged; teacher-facing title unaffected.
- Caller-scoped privacy boundary preserved (no cross-student data).
- Accessibility: h1/h2 hierarchy, status not color-only, focus visible.

**Stop conditions**
- Do NOT mutate stored assignment titles or historical assignment documents.
- Do NOT duplicate domain metadata into student/assignment documents.

### 28.6G - Execution record

**Disposition: COMPLETE.** The two separate student destinations (My
Assignments and My Results) are consolidated into a single domain-grouped
student landing, **My Science**. Client / presentation work only: no
Functions, Firestore Rules, or Firestore index change was required or made
(`firestore.indexes.json` remains `"indexes": []`); the curriculum manifest
was not regenerated. No new callable, query, or index was needed - the student
already owned every seam (`assignmentsListForStudent` + `assessmentAttemptsList`
via `aggregateByAssignment`). No STOP condition was triggered. Sprint 27
deep-link authorization is preserved; the assessment attempt/best-score
semantics are reused unchanged.

**Previous student architecture.** One route (`activeStudent` -> `/app/student`)
rendered a single surface (`makeActiveStudentSurface`) with a WAI-ARIA tablist
switching between two views: **My Assignments** (published assignments, launch,
status decoration) and **My Results** (best score, attempt count, Improve My
Score). The header was `LYFELABZ` + an h1 "Welcome, {name}." + an intro
paragraph naming the two tabs, with a "Return to public lessons" link and a
Sign out control. There was never a separate route for My Results - it was a
tab, so no independent route needed a compatibility redirect (Test group J is
N/A; documented below).

**Final My Science architecture.** The same single route now renders one page:
a minimal header, an h1 **My Science**, then the student's work grouped by
canonical science domain. Each assignment is shown together with its own
result/state; there is no view switcher and no My Assignments / My Results
label anywhere. Within a domain, unfinished work is listed first (prominent);
completed work follows (quieter, but visible and re-launchable).

**Minimal student header.** `LYFELABZ` wordmark, the student's safe display
name (`student-name`, the same identity field the product already showed - no
uid / schoolId / provider id / email), and the existing Log out control
(`renderSignOut`, product-wide "Sign out" copy retained rather than diverging
the shared control for one surface). No teacher navigation, no tabs, no
dashboard chrome. The "Return to public lessons" link was removed to honor the
locked minimal-shell contract (Blueprint section 15: "the student needs no
persistent navigation beyond the page itself"; Log out is the exit).

**Domain grouping.** Domains and their labels come only from the canonical
curriculum manifest (`getUnitBySlug(lessonSlug).topic` + `TOPIC_LABEL`); a new
`STUDENT_DOMAIN_ORDER` array carries only the locked ORDER, not a second
registry. Locked order (rendered with the exact canonical manifest labels,
which differ in punctuation from the blueprint prose per the sprint's "use the
repository's exact canonical domain strings" instruction): **Earth & Space,
Life Science, Physical Science, Tech & Engineering**. `behavioral-science` is
gated and never appears. A domain with no work is omitted (no empty shells). A
card whose slug cannot be resolved to one of the four domains (unknown slug, a
gated slug, or a completed attempt whose assignment is no longer listed) lands
in a single trailing **Other** group rather than being dropped. Within a
domain: unfinished before completed, then newest `publishedAt` first (null
last), then `lessonSlug` ascending, then `assignmentId` ascending - fully
deterministic.

**Canonical lesson titles (presentation only).** The card title is the
canonical manifest lesson title for the `lessonSlug`
(e.g. stored "Earth's Layers - Check for Understanding" -> displayed
"Layers of Time" for the `layers-of-time` slug). The stored teacher-authored
assignment title is never mutated and is never regex-parsed; it is used only as
the fallback when the slug is unresolvable in the manifest (in which case the
card also groups into Other). A completed attempt with no live assignment
record has no slug and no stored title, so it uses the safe existing label
"Assignment no longer listed".

**Assignment status model.** Reuses the certified aggregate semantics
(`aggregateByAssignment` / `deriveStatus`). There is no reliable student-side
"in progress" signal (the attempts callable returns only completed attempts and
the assignment list returns only published assignments), so no card is
mislabeled "In progress": **unfinished** = a published assignment with no
completed attempt (status chip "Ready to Begin", primary Open assignment, no
score); **completed** = has >=1 completed attempt (status chip Improving /
Well Done! / Perfect Score, integrated best result, quieter card, still
launchable); **closed / no live assignment** = a completed attempt whose
assignment is no longer published -> shown in Other with its result and NO
launch control (respects the closed-assignment restriction; renders no invalid
action and mints no attempt/session).

**Integrated results.** Best score is the certified best completed attempt
(`selectBestAttempt`, PDR-029 tie-break) reused verbatim - no second best-score
algorithm. The completed card shows the best **percentage** prominently plus the
raw `score / maxScore` fraction, and the attempt count as quiet secondary
metadata. Completed work stays re-launchable through the one Open assignment
control (Improve My Score is folded into it via the same launcher), reusing the
certified `buildAssignmentLaunchUrl`; there is no separate results page or
Results button.

**My Assignments / My Results disposition.** Both are removed as concepts from
the student surface (no tablist, no nav labels, no separate route). The
underlying result/attempt data infrastructure (`assessmentAttemptsList` wire,
`aggregateByAssignment`, `selectBestAttempt`) is **reused, not deleted** - the
consolidation is surface-level. No old independent route existed (the split was
a tab within one surface), so no compatibility redirect was built (Test group J
is N/A).

**Deep-link preservation.** The Sprint 27 deep-link arrival surface
(`renderDeepLinkArrival`) and its authorization/resolution contract are
untouched; the bootstrap still routes an authorized student deep link straight
to the assignment and never through My Science. The only change is a
presentation-consistency one: the arrival fallback button label
"Go to My Assignments" -> "Go to My Science" (behavior and the internal
`onGoToMyAssignments` seam name unchanged; the deep-link tests assert on testid
and behavior, not the label text, so none regressed).

**Read-only guarantee.** Rendering My Science invokes only the two caller-scoped
READ callables (published assignments + the student's own completed attempts)
and never creates or mutates an attempt, session, result, recipient, or
enrollment. A permanent regression test asserts exactly this (each read callable
runs once; `onLaunchAssignment` is never called by rendering). A results-read
failure degrades gracefully (domain-grouped cards with no status/score, still
launchable) rather than failing the page or mislabeling completion; only a
primary (assignments) read failure shows the calm recoverable error.

**Results-transition scroll/focus (Task 19).** Already fixed by Sprint 28 O2 and
NOT rewritten. The v2 lesson artifact scrolls the results into view with
`sb.scrollIntoView({ block: 'start' })`, offsets it below the sticky chrome via
`.score-board { scroll-margin-top: 120px }` (104px at <=600px), and moves focus
to the results region with `sb.focus({ preventScroll: true })` after the scroll
(results region carries `tabindex=-1 role=status aria-live=polite`). This is a
deterministic render/focus seam, not a timed hack. Cited regression:
`app/scripts/lessonBuilder/__tests__/w2-results-contract.test.js` (the "O2:"
tests), green (539 tests in that suite).

**Tests.**
- Rewrote the three obsolete student describe blocks in
  `app/src/router/surfaces/surfaces.test.ts` into four My Science blocks (IA;
  domain grouping & canonical titles; status/results & ordering; empty/loading/
  error/read-only/a11y) using real manifest slugs: minimal-header + no-tab/no-
  teacher-nav + no id leak; locked domain order + empty-domain omission +
  gated/unknown -> Other; canonical title vs stored title + no suffix strip +
  stored title unmutated; unfinished prominence + integrated completed result +
  certified best score across repeated attempts + unfinished-before-completed
  ordering + closed/historical card (result kept, no launch) + no cross-domain
  duplication; empty/loading (no empty flash)/error (recoverable, no raw code)/
  degraded results/read-only/launch URL + no-identity-leak + accessible name +
  h1->h2->h3 hierarchy + textContent XSS safety.
- Rewrote `app/src/router/surfaces/student-workspace-css.test.ts` to pin the new
  served CSS (primary launch action; quiet-completed card + outline launch; the
  `student-name` truncation that keeps Log out on-screen; the reused
  `assignments-error` callout).
- Updated `app/src/router/router.test.ts` (student dispatch test -> My Science)
  and the stale comment in `app/src/assignments/deepLink/arrival.test.ts`.

**Validation.** `typecheck` clean; `lint` clean; `lessons:verify` OK. App Jest
**1925/1926 passing**; the sole failure is the pre-existing curriculum-manifest
SHA drift (`curriculumManifest.test.ts`), the known Sprint-29-owned baseline
documented in 28.6C-F - this phase touched neither the root `index.html`
curriculum source nor the manifest JSON and did not regenerate the manifest.
The teacher shell suite (`shell.test.ts`, 114) and the O2 results-contract suite
(539) are green. No Functions or Rules change (both baselines untouched);
`firestore.indexes.json` unchanged (`"indexes": []`). Authenticated
click-through remains un-automatable (the Auth-emulator popup relay is
unsupported in the headless review browser, and local `file://` harness pages
render as non-screenshottable static snapshots, per 28.6C-F); a temporary static
harness built from the real production CSS + the exact card DOM was used for
structure review and then deleted (not added to production).

**Files changed.**
- Production app: `app/src/router/surfaces/index.ts` (consolidated
  `makeActiveStudentSurface`, pure `buildMyScienceItems` / `compareMyScienceItems`
  join+ordering, `renderMyScience` / `renderMyScienceCard`, manifest imports;
  removed the tablist/two-view machinery and the now-unused
  `filterLaunchableItems`), `app/src/assignments/deepLink/arrival.ts` (fallback
  label only), `app/index.html` (student My Science CSS section + the student
  480px media rule).
- Functions: none. Rules: none. Indexes: none. Manifest: not regenerated.
- Tests: `app/src/router/surfaces/surfaces.test.ts`,
  `app/src/router/surfaces/student-workspace-css.test.ts`,
  `app/src/router/router.test.ts`,
  `app/src/assignments/deepLink/arrival.test.ts` (comment).
- Documentation: this record.

**Bounded deviations from blueprint.** (1) Domain labels use the exact canonical
manifest strings ("Earth & Space", not the blueprint prose "Earth & Space
Science"), per the sprint's explicit "use the repository's exact canonical
domain strings if punctuation differs" instruction and to avoid a second
registry. (2) The completed-card launch is a single "Open assignment" control
rather than a distinct "Improve My Score" button; Improve My Score is folded
into that one relaunch action (Blueprint section 15: "Primary action: Open
assignment ... No separate Results action"). (3) The shared Log out control
keeps its product-wide "Sign out" copy rather than diverging to "Log out" for
one surface. None are material.

---

## 28.6H - Human Acceptance Recertification

**Goal:** Chris personally re-inspects both workspaces on the local deterministic
environment after C-G land.

**Scope**
- Reseed/refresh the local `scripts/ux-review/` environment as needed so the
  seeded data exercises: Classes default landing, class workspace Overview/
  Assignments/Students, Assignment Detail via Classes, demoted Close/Reopen,
  late-recipient add, Curriculum Preview + Resources + View Summary (with a lesson
  assigned across ≥2 classes and a repeated-assignment case to exercise the
  unique-student semantics), simplified Settings, and Student My Science domain
  grouping with a completed + unfinished mix.
- Produce a `SPRINT_28_6_HUMAN_ACCEPTANCE_*` record capturing Chris's findings.

**Required tests**
- Full deterministic baseline green (App verify; Functions Jest; Rules).
- No em dashes; no horizontal page scroll at 1280/1024/768/narrow.

**Stop conditions**
- No production deploy, no Google/Firebase mutation, no manifest regeneration
  (Sprint 29 owns those).

### Sprint 28.6H - Human Acceptance UX Corrections (execution record)

**Disposition: COMPLETE (pending Chris's final live visual review).** This phase
corrects the UX problems a direct human walkthrough of the local Sprint 28.6
experience surfaced - problems the automated/static tests did not adequately
reveal. Client/presentation work only: no Functions, Firestore Rules, indexes,
Classroom APIs, OAuth, or analytics callables were added or changed
(`firestore.indexes.json` remains `"indexes": []`); the curriculum manifest was
not regenerated. Sprint 28.6 is **not** certified here - after these corrections
Chris performs one final human visual review, and only then is 28.6 closed.

**Human findings and corrections.**

1. **Classes landing hierarchy was backwards (Finding 1).** With one or more
   classes, the class cards are now the dominant content; the large permanent
   "Add a class / Import / Create" block is gone from the populated view,
   replaced by a small secondary **"+ Add class"** disclosure near the heading.
   Clicking it reveals the SAME certified Import / Create workflow (no second
   implementation; the shared 28.6C/F workflow). Zero-class state keeps the
   Import / Create workflow prominent and direct. The "Choose a class to open
   its workspace." filler is removed.
2. **Active status removed from ordinary teacher UI (Finding 2).** The "Active"
   badge is gone from the class cards and the class-workspace header (an
   appearing class is implicitly active). **Backend activation/status semantics
   are unchanged** - `needsSetup`, activation, class-status persistence, and the
   imported-class lifecycle are untouched. This is presentation-only.
3. **Class Workspace hierarchy corrected (Finding 3).** The CLASS is now the
   primary object: `Back to Classes`, then the **class name** and a compact
   `G6 · Block B` line, then the `Overview | Assignments | Students` tabs (which
   now visually belong to that class), with administrative actions on the right.
   The class identity appears before the tabs; admin never precedes it.
4. **Sync roster de-emphasized (Finding 4).** Sync roster is removed from the
   Overview content and no longer dominates. It now lives behind a quiet
   **"Manage class"** disclosure in the tab row, shown only when there is a real
   management action (an active LMS-linked class with the sync seam wired) - no
   fake actions fill the menu. The existing `lmsClassesSyncRoster` implementation
   is reused unchanged; a sync in progress (manual or the automatic
   post-activation sync) reveals the panel so its status stays visible.
5. **Placeholder / product-marketing copy removed (Finding 5).** "One place to
   check in on your class between moments.", "Classroom activity will appear here
   when assignments and submissions exist.", and the roster foundation copy are
   gone. Overview now shows real, locally-available data (assignment count from
   the already-loaded teacher registry, join code) or a calm real empty state
   ("No assignments yet."). Students shows a "Students" heading + a real empty
   state ("No students yet." with the join-code next step). No new analytics, no
   new callable, no new Firestore read, no N+1.
6. **Curriculum grid density (Finding 6).** The lesson grid changed from an
   auto-fill track (which produced 5 across at 1280) to explicit column counts:
   **4** desktop, reflowing to 3 / 2 / 1 as the workspace narrows. Card
   readability over maximum density; no horizontal page scroll.
7. **Assign / Preview geometry (Finding 7).** Assign and Preview are a paired
   primary/secondary set of equal width and height (shared flex basis, centered
   content); label length no longer sizes them. Assign stays primary green,
   Preview outlined/neutral.
8. **Assigned-history badge removed from the card (Finding 8).** The "✓ Assigned"
   indicator is gone from the action row. Assign always reads "Assign" and stays
   available on both never-assigned and previously-assigned lessons (a lesson is
   always re-assignable). The assignment-history signal is retained on the card
   dataset (`data-lesson-assigned`) only to drive the conditional View Summary
   control - View Summary still appears only for a lesson with owned
   published/closed assignment history.
9. **View Summary hierarchy (Finding 9).** View Summary is now a quiet,
   borderless text-style control (gold-accented underline) that drops to its own
   line beneath the paired buttons rather than crushing into a two-line box. It
   remains a real, keyboard-focusable control with a visible focus ring; the card
   is never made wholly clickable.
10. **Resources layout (Finding 10).** The quiet `N Resources ›` disclosure is
    unchanged; the wider cards keep the expanded resource row (type eyebrow +
    title + Open) stable, and Open no longer jumps under the title only because
    the card was too narrow.
11. **Settings copy simplified (Finding 11).** The generic intro sentence ("Set
    up how LyfeLabz works for you and your classes.") is removed; Settings begins
    with its heading then its configuration content.
12. **Settings section named "Google Classroom"; class-creation buttons removed
    (Finding 12).** The section is renamed from "Classes & Google Classroom" to
    **Google Classroom** (the persistent configuration concept is the connection).
    The permanent Import / Create class buttons are **removed from Settings** -
    class creation is owned by Classes → `+ Add class` (the same shared workflow).
    The read-only connection state and the "Manage Google Classroom connection"
    control remain. Settings is allowed to be sparse; no filler was added.
13-14. **My Science student header + page identity (Findings 13/14).** The
    minimal persistent header (LYFELABZ wordmark · student display name · Sign
    out) is preserved, and My Science now reads as a real student workspace: the
    root that hosts the student header uses a wide, left-aligned desktop layout
    (68rem) instead of the narrow 32rem auth card, with the `My Science` h1 below
    the header. No teacher sidebar/nav, no My Assignments / My Results tabs, no
    extra PII.
15. **My Science desktop grid (Finding 15).** Within each science domain the
    assignment cards form a responsive grid (~3 desktop / 2 tablet / 1 phone)
    instead of one tall mobile-width column. Domain grouping and the canonical
    order (Earth & Space, Life Science, Physical Science, Tech & Engineering) are
    preserved; empty domains are omitted.
16. **Compact student cards (Finding 16).** Card padding and inter-line gaps are
    tightened; the score line is compact (`100% · 10/10`) rather than the tall
    "Best score 100% (10 / 10)". Cards stay comfortable, not cramped.
17. **Objective student statuses (Finding 17).** The subjective result labels
    (Perfect Score / Well Done! / Improving) are removed. My Science shows only
    objective states: **Completed** (the score carries performance) and **Ready
    to Begin**. Best percentage, raw score, and attempt count remain (compact).
    Open assignment still launches the assessment directly - no intermediate
    detail page - and completed work stays re-launchable per the certified
    lifecycle.

**Archive / end-of-year: future requirement (documented, NOT implemented).** See
the dedicated note below. A certified `classesArchive` callable and an
`archived` class status already exist in the backend, but there is no
teacher-facing archive workflow and the Classes list does not separate Current
from Archived. 28.6H did **not** add any archive UI and did **not** change
Firestore lifecycle semantics.

**Tests (added/changed).**
- `app/src/shell/surfaces/classes.test.ts`: needsSetup card no longer renders a
  status pill; the duplicate-import flow reveals "+ Add class" first; roster-sync
  tests open "Manage class" first.
- `app/src/shell/surfaces/classes.assignments.test.ts`: Students renders the
  "Students" heading + real empty state.
- `app/src/shell/surfaces/snapshot.test.ts`: rewritten for the Overview (no
  name/status/grade line, no placeholder copy, real summary or empty state).
- `app/src/shell/surfaces/settings.test.ts`: rewritten for "Google Classroom"
  heading, no intro, no Import/Create buttons, connection + Manage retained.
- `app/src/shell/shell.test.ts`: class card has no status badge; assign records
  the card signal (no "✓ Assigned"); Settings heading "Google Classroom" and
  class creation owned by Classes; workspace identity above tabs; Overview
  empty-state / no placeholder; Students heading; focus lands on the section
  heading; plus CSS regressions for the 4-column grid, equal Assign/Preview, and
  the borderless View Summary.
- `app/src/shell/teacher-workspace-polish-css.test.ts`: Curriculum density test
  updated to the explicit 4-column model.
- `app/src/shell/surfaces/curriculum.false-success.test.ts`,
  `curriculum.layout.test.ts`, `curriculum.success-banner.test.ts`: assigned
  signal asserted via the card dataset instead of the removed button badge.
- `app/src/router/surfaces/surfaces.test.ts`: objective "Completed" status +
  compact score format.
- `app/src/router/surfaces/student-workspace-css.test.ts`: CSS regressions for
  the wide My Science root, the multi-column grid, and the compact card.

**Validation.** `typecheck` clean; `lint` clean; `lessons:verify` OK. App Jest
**1933/1934 passing**; the sole failure is the pre-existing curriculum-manifest
SHA drift (`curriculumManifest.test.ts`) between the ROOT `index.html` and the
checked-in manifest - the known Sprint-29-owned baseline documented in
28.6C-G. This phase modified `app/index.html` (the app shell host page) but did
**not** touch the ROOT `index.html`, the manifest JSON, or the manifest
generator, and did not regenerate the manifest. No Functions or Rules change
(both baselines untouched); `firestore.indexes.json` unchanged.

**Human-review limitation.** This phase exists because prior static/browser
automation failed to reveal the real visual problems. Authenticated click-through
of the live shell remains un-automatable here (the Auth-emulator pop-up relay is
unsupported in the headless review browser, per 28.6C-G). The corrections are
validated by behavioral tests and CSS structural regressions; **static CSS
reasoning alone is not claimed to prove human acceptance.** Chris performs the
final live teacher + student visual review at 1280 / 1024 / 768 / narrow before
Sprint 28.6 is closed.

### Future product requirement - Class archiving / end-of-year (NOT in 28.6H)

At the end of a school year, a teacher needs a way to remove old classes from the
everyday **Current Classes** workspace without deleting historical data. The
everyday Classes workspace should represent the teacher's working (current)
classes; archived classes should preserve their historical assignments, frozen
recipients, attempts/results, and analytics/history - **archive must not mean
delete**.

Current architectural situation (verified):
- The backend already has a certified `classesArchive` callable that performs a
  terminal `active`/`needsSetup` → `archived` transition (idempotent), and
  `archived` is a defined `ClassSummary` status.
- There is **no** teacher-facing archive workflow, and the Classes list does not
  separate Current from Archived, so an archived class would today sit mixed into
  the everyday list.

A future sprint (its own architectural review) should evaluate: an **Archive
class** action; an **Archived Classes** access path (separate from Current
Classes); how historical assignments, frozen recipients, and attempts/results
are preserved and surfaced; the analytics/history relationship; the Google
Classroom relationship for archived/imported classes; and whether archived
classes remain read-only or partially manageable. **Do not implement it before
that review.** 28.6H changed no Firestore lifecycle semantics.

---

## Sprint 28.6H.3 Teacher Information Architecture + Curriculum Hierarchy Finalization

**Disposition: COMPLETE WITH BOUNDED LIMITATION** (the two investigation
requirements - class-card operational-attention data and a "newly completed
since last check" checkpoint - have no safe zero-cost implementation today and
are documented, not built; every requested *safe* UI change landed). Client /
presentation work only: no Cloud Functions, Firestore Rules, Firestore index,
OAuth, or Google Classroom API change was made (`firestore.indexes.json` remains
`"indexes": []`; Functions Jest 1746/1746 unchanged). The curriculum manifest
was not regenerated. This phase supersedes several earlier 28.6H presentation
decisions where Chris's live review reversed them (assignment count and "+ Add
class" on the Classes landing; Overview; "Manage class" in the class workspace;
class creation being owned solely by Classes).

**Final information architecture (locked by this phase).**
- **Classes** - "What is happening with my students?" Everyday operational home.
- **Curriculum** - "What do I want to teach?" Lesson-centric library.
- **Settings** - "How are my classes and integrations configured?" Administrative
  home for Google Classroom connection **and** all class management.

### Classes landing (Part A)
- **A1 - assignment inventory count removed.** The class card no longer shows
  "N assignments" / "No assignments"; the count was not decision-useful and the
  Assignments tab already exposes inventory. It was NOT replaced with another
  statistic. (`classes.ts` `renderClassCard`.)
- **A2 - "+ Add class" removed from the landing.** The populated Classes landing
  carries no add control; class creation/import moved to Settings. The underlying
  Import / Create workflows are preserved and still render here transiently when
  opened from Settings via the shared one-shot class-management intent (one
  implementation, two entry points). The zero-class state still shows the
  workflow directly so a brand-new teacher is never at a dead end.
- **A3 - larger, more useful cards.** Roomier padding, a comfortable minimum
  height, and a slightly wider grid track give the everyday class tile real
  presence. Preserved identity: class name + `G6 · Block A`.
  - **Student/enrollment count: NOT surfaced (limitation).** `ClassSummary` /
    `listClasses` carry only title / grade / block / joinCode / status /
    enrollmentSource - no enrollment count. A per-class roster read would be an
    N+1. Per Task A3 no new read was invented; the card omits the count.
- **A4 - operational-attention investigation (no build).** Assignment completion
  is available only per-assignment via the certified `assessmentAssignmentSummary`
  callable, which returns **counts** (`completedStudents` / `totalStudents` /
  `inProgressStudents` / `notStartedStudents`) and, by the certified
  confidentiality boundary, **no student identifiers or names**. So: incomplete
  *counts* per assignment are derivable (already used on the Assignments cards);
  incomplete *student names* are not available client-side; class-card-level
  "who hasn't completed" would require a per-assignment summary call for every
  class (N+1) plus, for names, a new server projection. Not built this phase; a
  future backend aggregation would be required to put attention data on the card.
- **A5 - "newly completed since last check" investigation (no build).** No
  trustworthy teacher-view checkpoint exists in the repository (no last-viewed
  class / last-acknowledged-completion / notification-checkpoint state). This is
  NOT derivable from latest submissions or attempts-created-today. The smallest
  future architecture: a per-teacher, per-assignment durable "last acknowledged
  completed set" (or a `lastViewedAt` watermark compared against completion
  timestamps), written when the teacher views an assignment summary and read to
  diff newly-completed students. Deliberately NOT implemented (would be invented
  semantics); documented as architectural truth.

### Class Workspace (Part B)
- **B1 - Overview removed** from the navigation model (not hidden by CSS). Final
  class navigation is exactly `Assignments | Students`. The `snapshot.ts` surface
  is left dormant in the tree (mirroring Present Mode); a stale `snapshot` tab
  defensively renders Assignments.
- **B2 - Assignments is the default.** A class card opens directly to
  Class -> Assignments; a just-activated class also lands on Assignments. The
  class identity (name + `G6 · Block A`) remains above the tabs; Back to Classes
  is unchanged.
- **B3 - "Manage class" removed** from every everyday class-workspace location
  (header, tab row, Assignments, Students). The automatic post-activation roster
  sync (backend behavior) still fires; only its workspace UI is gone.
- **B4 - assignment cards use completion language.** The former
  "N submitted / N started / N total" wording is replaced with teacher-oriented
  authoritative completion text: primary `18 of 24 completed`, optional secondary
  `4 not started · 2 started` (all from `assessmentAssignmentSummary` fields). No
  status invented; lifecycle / frozen-recipient / scoring / attempt authority
  unchanged.
- **B5 - assignment titles (report only).** Teacher-facing cards keep the stored
  teacher-authored assignment title (the title the teacher intentionally wrote);
  the student side already uses canonical manifest titles (28.6G). The manifest
  is available (`getUnitBySlug`) if a future decision wants canonical titles on
  the teacher side too, but no risky title migration or second registry was made.

### Settings - administrative home (Part C)
- **C1/C2 - structure.** Two sections: **Google Classroom** (read-only
  connection state via the existing Integrations `describeConnections` seam +
  "Manage Google Classroom connection") and **Class Management**. No email /
  provider identity is available through the connection seam, so
  "Connected as <email>" is intentionally not shown (only "Connected." /
  "not connected."). OAuth behavior unchanged.
- **C3 - class creation/import reused, not duplicated.** Settings hosts **Import
  Class from Google Classroom** (primary) and **Create LyfeLabz Class**
  (secondary) as **openers** that invoke the shared `openClassManagement` intent
  (the certified 28.6F seam); the actual create/import form is the ONE
  implementation hosted on the Classes surface. No second create/import surface.
- **C4 - roster sync lives in Settings -> Class Management.** For Google
  Classroom-linked **active** classes only, each row exposes the certified
  `lmsClassesSyncRoster` action, reusing the exported `renderRosterSyncPanel`
  (same aggregate-only copy, same error taxonomy). Manual LyfeLabz classes never
  expose Classroom sync. Opening Settings never triggers a sync. Settings reads
  the class list once (same query shape Classes uses; no per-class fan-out).
- **C5 - archive investigation (no build).** A certified `classesArchive`
  callable exists (terminal `active`/`needsSetup` -> `archived`, idempotent), and
  `archived` is a defined `ClassSummary` status - but there is **no restore /
  unarchive callable**, and `listClasses` does **not** filter archived classes
  (they would sit mixed into the everyday list). The lifecycle is therefore
  one-way and incomplete; per the stop condition no archive UX was exposed. A
  future sprint must add a restore path and a Current/Archived split before any
  Archive action is surfaced (see the existing "Future product requirement" note
  above).

### Curriculum card hierarchy (Part D)
- **D1 - lesson is the primary object;** actions never outweigh identity.
- **D2 - compact matched Assign/Preview.** The pair is an inline equal-column
  grid (`display: inline-grid; grid-auto-columns: 1fr; align-self: flex-start`),
  so the two controls are equal AND compact (left-aligned, content-sized) rather
  than stretched across the whole card. Assign stays primary green; Preview stays
  neutral/outlined; Preview behavior (open v2 path, no `?assignment`, new tab) is
  unchanged.
- **D3 - shared quiet footer.** View Summary (left) and the Resources disclosure
  (right, via `margin-left:auto`) share one footer row; the expanded Resources
  panel renders full-width beneath it. The hairline boundary is applied only when
  the row holds a visible control (`:has`), so a never-assigned lesson with no
  resources shows no empty footer. Cases: both / View-Summary-only / Resources-
  only / neither all render correctly.
- **D4 - View Summary** stays a quiet, keyboard-focusable, borderless gold-accent
  text control; analytics/callable/authorization/navigation semantics unchanged.
- **D5 - Resources** preserved (`N Resource ›` grammar, caret, expand/collapse,
  13 formal resources, Open-in-new-tab); only relocated into the footer.
- **D6 - reduced dead space** (card min-height 8.75rem -> 8rem; View Summary +
  Resources merged into one row instead of two stacked blocks).
- **D7 - grid preserved** at 4 / 3 / 2 / 1 (large / medium / small / mobile).

### Responsive behavior (Part E)
Validated structurally (CSS regressions + the served bundle) at 1280 / 1024 /
768 / narrow: Classes cards keep a useful width and reflow; Class Workspace
Assignments/Students stay usable with the class identity clear; Settings controls
and the roster-sync list stack cleanly; Curriculum compact actions and the footer
do not collide and Resources expansion stays readable. No horizontal page scroll
is introduced (`minmax(0,1fr)` tracks, `flex-wrap` footer).

### Accessibility (Part F)
Native buttons/links throughout; visible focus rings; `aria-current` tab state on
`Assignments | Students`; focus lands on the default section heading (Assignments)
when a class opens and on Students when selected; Resources keeps
`aria-expanded`/`aria-controls`; View Summary stays a real focusable control;
roster-sync status uses `aria-live`; removing Overview did not break focus/route
semantics (the default focus target moved from the Overview heading to the
Assignments heading).

### Live-bundle rebuild requirement (Part H)
`npm --prefix app run build` was run; `app/dist/bundle.js` is newer than every
modified source and byte-for-byte contains the new implementation ("Class
Management", "settings-rostersync", "shell-lesson-footer", the "of ${...}
completed" wording). The compiled bundle was not hand-edited. The running
UX-review hosting emulator serves `app/dist/bundle.js` live from disk; a fetch
through the emulator returned a byte-identical artifact containing the new code,
so the emulator is confirmed to serve the rebuilt bundle (no stale asset). The
emulator's own `scripts/ux-review/start.sh` rebuilds the bundle on every launch,
so a stale-bundle regression cannot recur.

### Tests
- Rewrote `settings.test.ts` (Google Classroom + Class Management sections;
  Import/Create openers with correct intent; roster sync only for LMS-linked
  classes, invoked once, no auto-sync on render).
- `classes.assignments.test.ts`: card carries no assignment count; nav is
  `Assignments | Students` (Overview absent); Assignments is the default.
- `classes.test.ts`: activation lands on Assignments; the workspace renders no
  roster-sync UI while the automatic post-activation sync still fires; the
  duplicate-import flow is driven via the shared class-management intent; the two
  workspace roster-UI describes were removed (behavior now covered by
  `settings.test.ts`).
- `shared/activeAssignments.test.ts`: completion wording (`X of Y completed` +
  `not started · started`).
- `curriculum.action-layout.test.ts` / `curriculum.view-summary.test.ts`: View
  Summary now lives in the shared footer, outside the actions stack and the pair.
- `shell.test.ts`: class opens on Assignments; Overview/snapshot absent; the
  dormant snapshot preview is not rendered; Settings has both sections and its
  Create routes into the shared Classes workflow; CSS regressions updated for the
  compact pair grid, the shared footer border (`:has`), and the borderless
  Resources toggle.

### Full validation
- App: `typecheck` clean; `lint` clean; `lessons:verify` OK; Jest **1925/1926**.
- Functions: Jest **1746/1746** (no backend change; run for confirmation).
- **Known baseline failure (separate):** the pre-existing curriculum-manifest SHA
  drift (`curriculumManifest.test.ts` / `curriculum:verify`) between the ROOT
  `index.html` and the checked-in manifest - Sprint-29-owned. This phase touched
  neither the root `index.html` curriculum source nor the manifest JSON and did
  not regenerate the manifest. It remains the sole failing test.

### Limitations / human handoff
- Operational-attention data on the class card (A4) and "newly completed since
  last check" (A5) are documented, not built - each needs new backend work
  (per-assignment fan-out / a durable teacher checkpoint) to be truthful.
- Archive UX (C5) is not exposed: the lifecycle is one-way (no restore, archived
  classes not separated from current) and must be completed first.
- Authenticated click-through remains un-automatable locally (Auth-emulator
  pop-up relay unsupported in the headless review browser, as in 28.6C-H); the
  changes are validated by behavioral tests, CSS structural regressions, a clean
  bundle load (no console errors), and served-bundle verification. Human visual
  acceptance is NOT claimed here.

---

## Sprint 28.6H.4 Final Teacher Visual Polish + Settings Organization

**Disposition: COMPLETE.** A narrow human-acceptance correction phase driven by
Chris's live emulator review. The Sprint 28.6H.3 teacher information
architecture is accepted and was NOT redesigned. Client / presentation work
only: no Cloud Functions, Firestore Rules, Firestore index, OAuth, or Google
Classroom API change (`firestore.indexes.json` remains `"indexes": []`); the
curriculum manifest was not regenerated. No STOP condition was triggered.

**Assignments empty-state cleanup (Part A).** The class Assignments section no
longer renders the introductory sentence "The assignments you have given this
class." (removed for both empty and populated states, so the "Assignments"
heading flows directly into the cards). The empty state is exactly **"No
assignments yet."** - the over-explaining hint ("Choose a lesson in
Curriculum...") and the "Go to Curriculum" button were removed
(`classes.ts` `renderClassAssignmentsSurface`).

**Students empty-state cleanup (Part B).** The empty state is exactly **"No
students yet."** - the class-code explanatory sentence ("Students who join with
the class code ... appear here.") was removed (`classes.ts`
`renderRosterSurface`; the now-unused `summary` param was dropped).

**Curriculum header cleanup (Part C).** The subtitle "Activate the LyfeLabz
lessons your students can access." was removed and NOT replaced; the welcome
heading flows directly into the grade / topic filters. The reclaimed vertical
space contributes to the desktop two-row density target.

**Curriculum button geometry - concrete contract (Part D, Tasks D1/D2).** Assign
and Preview now resolve to the EXACT same width and height from ONE shared rule
(`.shell-lesson-assign, .shell-lesson-preview`): `width: 7rem` (112px cap,
within the 110-125px contract), `height: 2.75rem` (44px, within 42-46px and the
44px touch minimum), `box-sizing: border-box`. Label length can no longer size
them. The prior `inline-grid; grid-auto-columns: 1fr` pair was replaced (its 1fr
columns did NOT equalize under intrinsic shrink-to-fit sizing, which produced
the mismatched live widths). The pair is now a plain `display: flex;
flex-wrap: nowrap` row whose two controls carry `flex: 0 1 auto` - grow 0 (never
a page-level CTA, Task J #15) but shrink 1, so on the narrow 4-column desktop
card (~165-200px content) the two controls shrink EQUALLY and stay identical on
one line instead of wrapping. Faithful local measurement (real production CSS +
exact card DOM served over HTTP inside `#app-root`, at 1280x800): Assign and
Preview are byte-equal at **97 x 44** and vertically aligned. A latent
`button { margin-top: 1rem }` global reset had been shifting the Assign
`<button>` 16px below the Preview `<a>` and inflating the pair; it is now zeroed
on Assign, Preview, View Summary, the Resources toggle, the Sync roster button,
and the Settings tab.

**Curriculum card density (Part D, Tasks D3/D4/D6).** The generic
`.shell-card { padding: 1.15rem 1.25rem }` was overriding the lesson-card
padding (equal specificity, later source), so the effective padding was trimmed
to `0.7rem 0.9rem` in the authoritative late `.shell-lesson-card` rule -
removing vertical dead space AND freeing horizontal room for the button pair.
Title-row top margin 0.4->0.25rem; actions top margin 0.35->0.25rem; footer-row
separation 0.4->0.3rem; card min-height floor 7.25->6.5rem. The two-line title
clamp is preserved (D4: one- and two-line titles reserve the same height).
Faithful intrinsic card heights: plain **157px**, resources-only **200px**,
View-Summary+Resources **200px** (down from the pre-phase wrapped ~267-376px).

**Desktop two-row target (Part D, Task D6).** Verified on the real rendered
Curriculum (faithful harness, 1280x800 with the 224px sidebar + filters): **two
full rows of lesson cards are visible** (three at 900px height), with a
preserved 4-column grid and no horizontal page scroll. Achieved by removing dead
space and correctly sizing the controls - not by shrinking text, dropping to 5
columns, or clipping.

**View Summary / Resources footer (Part D, Task D5).** Unchanged model: View
Summary (quiet gold-accent text control) on the left, the `N Resource ›`
disclosure on the right, sharing one restrained hairline footer; the expanded
resource panel renders full-width beneath. Zeroing the footer buttons' global
margin stopped the footer from wrapping to a tall two-line block on narrow
cards. Resource expand/collapse remains readable; grid preserved 4/3/2/1.

**Settings tab architecture (Part E, Task E1).** Settings became a SCALABLE
tabbed surface (`role=tablist` / `role=tab` aria-selected / `role=tabpanel`
aria-labelledby). Exactly ONE real category renders today - **Class
Management** - with no dead Accommodations tab and no placeholder categories; a
future real category is added by appending one tab + panel with no structural
change.

**Class Management tab (Part E, Tasks E2-E7).** The single panel owns everything
(one implementation, reused handlers): the Google Classroom connection, Import /
Create, and the compact Classes list.
- **Connection (E3):** heading "Google Classroom", concise **"Connected" /
  "Not connected"** (dropped the verbose "Google Classroom: not connected."),
  and **"Manage connection"** (shortened) which still opens the existing
  Integrations subview. No new provider-profile read; OAuth unchanged.
- **Import / Create (E4):** shortened to **"Import Class"** (primary) and
  **"Create Class"** (secondary); both remain openers that route to the ONE
  shared class-creation/import workflow on the Classes surface via the certified
  one-shot intent. No duplicate implementation.
- **Compact class rows (E5):** the oversized bordered management card was
  replaced with compact hairline-separated rows: class name on top, a
  `G6 · Block B · Google Classroom` / `G6 · Block A · LyfeLabz` meta line
  beneath. The list now shows every active class (linked and manual). Google
  Classroom-linked classes expose the certified `lmsClassesSyncRoster` action
  (shared panel reused verbatim); manual LyfeLabz classes never do. Faithful
  measurement: rows ~66px, no horizontal overflow.
- **Roster-sync copy (E6):** the explanatory sentence "Sync brings the latest
  Google Classroom roster into LyfeLabz." was removed; the aria-live region is
  retained (empty) so a later sync's success/error status is still announced.
- **Visual simplicity (E7):** no repeated "Google Classroom" labels, no giant
  buttons, no large empty cards, no roadmap filler.

**Archive / Accommodations (Parts F/G).** Neither implemented. No Archive control
and no Accommodations tab were added; the new tab architecture leaves room for a
real Accommodations category once it exists. Backend archive semantics unchanged.

**Responsive validation (Part H).** Faithful local harness at 1280 / 768 / and
the 3-column range: Assign/Preview stay equal and side-by-side (97px at 1280,
68px at 768), the grid reflows 4/3/2/1, Settings rows and Sync roster stack
without overflow. No horizontal page scroll at any width measured.

**Accessibility (Part I).** Native buttons/links throughout; WAI-ARIA tab
semantics with a non-color selected cue (green underline + aria-selected);
Resources keep `aria-expanded`/`aria-controls`; View Summary stays a real
focusable control with a visible focus ring; roster-sync status stays an
`aria-live` region even when idle (empty); 44px touch targets preserved on the
paired buttons, the tab, and the sync button.

**Served bundle (Part L).** `npm --prefix app run build` rebuilt
`app/dist/bundle.js` (newer than every modified source); it byte-for-byte
contains the new implementation (settings-tab ids, "Manage connection", "Not
connected") and none of the removed copy. The running UX-review hosting emulator
(`http://127.0.0.1:5000/app/`) returned a byte-identical bundle and an
`index.html` carrying the final `flex: 0 1 auto` geometry, so the emulator is
confirmed serving the rebuilt artifact (no stale asset). The bundle was not
hand-edited; `bundle.js` is a build artifact and is not git-tracked.

**Tests.** `settings.test.ts` rewritten for the tabbed surface (tablist/tab/
tabpanel, no Accommodations, no Archive, shortened labels, "Connected"/"Not
connected", both linked+manual rows with sync only on linked, roster-sync copy
removed, compact rows not cards). `classes.assignments.test.ts` updated for the
exact empty states (Assignments "No assignments yet." with no goto/hint/purpose;
Students "No students yet." with no class-code hint; populated Assignments has no
purpose line). `shell.test.ts`: Settings tab integration; the equal fixed-size
button geometry (shared width/height rule, flex 0 1 auto, no grow); the compact
pair (flex nowrap, no inline-grid); card-density regression; Settings tab +
compact-row CSS; and the curriculum-intro-absent assertion.

**Validation.** `typecheck` clean; `lint` clean; `lessons:verify` OK; app Jest
**1932/1933**. The sole failure is the pre-existing curriculum-manifest SHA
drift (`curriculumManifest.test.ts` / `curriculum:verify`) between the ROOT
`index.html` and the checked-in manifest - the known Sprint-29-owned baseline
documented across 28.6C-H.3. This phase touched neither the root `index.html`
curriculum source nor the manifest JSON and did not regenerate the manifest.
No Functions or Rules change (`firestore.indexes.json` unchanged).

**Limitations / human handoff.** Fixed-width equal buttons cap at 112px but the
accepted 4-column desktop density (card content ~165-200px) means they render
compact (~97px at 1280) and shrink equally on narrower cards rather than holding
a rigid 112px; this is the deliberate resolution of the 110-125px suggestion
against the mandated 4-column no-wrap grid. Authenticated click-through of the
live shell remains un-automatable locally (Auth-emulator pop-up relay
unsupported in the headless review browser, as in 28.6C-H.3); the corrections
were validated with faithful `#app-root`-scoped harnesses built from the real
production CSS + exact DOM served over HTTP, plus behavioral and CSS regression
tests and served-bundle verification. Final human visual acceptance is Chris's.

---

## Sprint 28.6H.5 Teacher Assignment Cards + Summary Cleanup + Resource Actions + Settings Refinement

**Disposition: COMPLETE.** A narrow human-acceptance correction phase after H.4.
The H.4 baseline and the teacher information architecture were NOT reopened.
Client / presentation work only: no Cloud Functions, Firestore Rules, Firestore
index, OAuth, or Google Classroom API change (`firestore.indexes.json` remains
`"indexes": []`); the curriculum manifest was not regenerated. No STOP condition
was triggered. No operational-attention / student-platform work.

**Class Workspace assignment cards (Part A).** `renderCard` in
`shared/activeAssignments.ts` gained a `classScoped` flag (true only for the
flat Class Workspace Assignments list; the certified aggregate accordion is
unchanged and keeps the stored title, class name, and state for its tests).
- **A1 - canonical lesson title.** In the class workspace the card shows the
  canonical curriculum lesson title resolved from the assignment's `lessonSlug`
  via the existing `getUnitBySlug` manifest accessor (e.g. stored "Earth's
  Layers - Check for Understanding" displays as **"Earth's Layers"**). The
  stored assignment title is never mutated and never string-stripped; an
  unresolvable / legacy slug falls back safely to the stored title. The Open
  button's accessible name follows the displayed title.
- **A2 - class name removed** from cards inside that class's own Assignments tab
  (the workspace already establishes the class). The class name is still shown
  where class context is not established (the aggregate accordion).
- **A3 - PUBLISHED label removed** from the normal class list card. Lifecycle
  state is unchanged and still carried on `data-status`; only the visible label
  is dropped (retained in the accordion context).
- **A4 - completion, date, and Open assignment preserved.** No new information
  added (no incomplete-student names, no newly-completed, no checkpoint).
- **A5 - reduced card height.** The class-scoped card carries a
  `shell-active-assignment-card-compact` variant (tighter padding/gap); there is
  no fixed/min-height, so height is content-driven. Faithful measurement: the
  minimal card (canonical title + completion + date + Open) is **138px**, down
  from ~176px with the removed class name + PUBLISHED lines; no large empty
  lower half.

**Lesson View Summary cleanup (Part B, `lessonSummary.ts`).**
- **B1** - the introductory sentence ("How this lesson has performed across your
  classes and assignments.") is removed and not replaced; the title flows
  directly into the metric cards.
- **B2** - the Classes navigation instruction ("To see which students still need
  to finish, open the class under Classes.") is removed and not replaced (no
  Classes button, no other navigation instruction added).
- **B3** - the Completion secondary line reads **"X / Y completed"** (the word
  "students" dropped), e.g. "18 / 24 completed".
- **B4** - the locked analytics (Classes Assigned, Students, Completion, Average
  Best Score), unique-student semantics, denominators, best-attempt/rounding,
  authorization, and the callable contract are all unchanged. Copy only.

**Expanded resource Open action (Part C, `curriculum.ts` + CSS).** The bare
green-text Open became a compact **outlined** control:
`.shell-lesson-resource-open` is a fixed **4.75rem x 2.375rem (76 x 38px)** box
(within the 70-85 / 36-40 contract), transparent fill with a 1px green-tinted
border, one consistent sizing rule for every resource row, strictly smaller than
Assign/Preview (7rem x 2.75rem) so it reads as a tertiary action. Navigation is
unchanged (same `<a href target=_blank rel=noopener>`, same accessible name);
keyboard focus ring preserved; coarse-pointer bumps it to 44px. The resource row
switched to `align-items: center`; long titles wrap and the Open drops below the
title cleanly (verified: no overlap, no clip, no horizontal overflow).

**Settings connection layout (Part D, `settings.ts` + CSS).** The connection
status and its "Manage connection" action now share ONE compact inline row
(`.shell-settings-connection-row`, "Not connected   Manage connection"), so the
action reads as belonging to the connection state rather than a separate block
(the large vertical gap is gone; the row stacks at narrow widths via
`flex-wrap`). Manage connection stays a quiet text-link (Task D2). Class
Management vertical spacing was tightened (section top margins 1.5rem -> 1rem /
1.25rem) so the panel reads as one compact administrative workspace (Task D3).

**Student Services Settings tab (Part E, `settings.ts` + CSS).** Settings now
has TWO tab categories - **Class Management** (default) and **Student Services**
- reusing the H.4 in-memory tab architecture (no routing change, no
persistence). Selecting a tab swaps the panel in place; both tabs are always
present, exactly one panel is rendered (single-panel tab swap, so no
`aria-controls` reference dangles), `aria-selected` + `tabindex` track the
active tab, and focus moves to the selected tab after the swap. Student Services
is a deliberate, inert placeholder: it renders only the restrained line
**"Student accommodations and supports will be managed here."** - NO
accommodation controls, NO disabled toggles, NO persistence, NO callable, NO
backend (Task E1/E2). The tab is never labelled "Accommodations".

**H.4 Settings preserved (Part F).** Class Management as administrative home;
Google Classroom connection management; Import Class (primary) / Create Class
(secondary) as shared-workflow openers; compact class rows; Sync roster only for
linked active Google Classroom classes; manual LyfeLabz classes never expose
sync; no roster-sync explanatory paragraph; no Archive control (Part G).

**Responsive validation (Part H).** Faithful `#app-root`-scoped harness (real
production CSS + exact DOM served over HTTP) at 1280 and narrower: assignment
cards drop the class name / PUBLISHED and shrink with completion + date + Open
intact; View Summary title flows into the metrics; the outlined resource Open is
clearly actionable, tertiary, and wraps cleanly under long titles; Settings
shows two tabs with a clear active state, the status + Manage connection on one
row, and compact class rows. No horizontal page scroll at any measured width.

**Accessibility (Part I).** Semantic headings; native buttons/links; visible
focus rings (including the outlined resource Open); WAI-ARIA tab semantics with
`aria-selected` and roving `tabindex`; keyboard tab selection with managed
focus; resource disclosure `aria-expanded`/`aria-controls` unchanged; the Open
link keeps its full accessible name; assignment-card accessible name follows the
canonical title; coarse-pointer touch targets preserved.

**Served bundle (Part L).** `npm --prefix app run build` rebuilt
`app/dist/bundle.js` (newer than every modified source); it contains the new
implementation (`settings-tab-student-services`, the Student Services line,
`settings-connection-row`, the `getUnitBySlug`/`resolveDisplayTitle` canonical
resolver) and none of the removed copy. The running UX-review emulator
(`http://127.0.0.1:5000/app/`) returned a byte-identical bundle and a fresh
`index.html` (the compact assignment-card CSS), so the emulator is confirmed
serving the rebuilt artifact (no stale asset). `bundle.js` is a build artifact,
not git-tracked; not hand-edited.

**Tests.** `lessonSummary.test.ts` (subtitle + foot absent; "X / Y completed").
`classes.assignments.test.ts` (canonical title displayed; stored suffix not
shown; unresolvable-slug fallback; class name + PUBLISHED absent; completion /
date / Open preserved; compact variant class; `data-status` preserved).
`settings.test.ts` (two tabs, Class Management default, Student Services
selectable with the restrained placeholder and no form controls, tab
round-trip, Manage connection grouped in the connection row and still a quiet
link). `shell.test.ts` (outlined resource-Open CSS: fixed 76x38, bordered,
smaller than Assign/Preview). The certified accordion tests are unchanged
(non-class-scoped path untouched).

**Validation.** `typecheck` clean; `lint` clean; `lessons:verify` OK; app Jest
**1940/1941**. The sole failure is the pre-existing curriculum-manifest SHA
drift (`curriculumManifest.test.ts` / `curriculum:verify`) between the ROOT
`index.html` and the checked-in manifest - the known Sprint-29-owned baseline
documented across 28.6C-H.4. This phase touched neither the root `index.html`
curriculum source nor the manifest JSON and did not regenerate the manifest.
No Functions or Rules change (`firestore.indexes.json` unchanged).

**Limitations / human handoff.** Within a Class Workspace assignment row, cards
still equalize height per grid row (H.4 posture), so a card next to a 2-line
canonical title shows some bottom whitespace - retained deliberately for
row-consistency ("where practical"); the intrinsic minimal card is materially
shorter. Authenticated click-through of the live shell remains un-automatable
locally (Auth-emulator pop-up relay unsupported in the headless review browser,
as in 28.6C-H.4); the changes were validated with faithful `#app-root`-scoped
harnesses (real production CSS + exact DOM served over HTTP), behavioral and CSS
regression tests, and served-bundle verification. Final human visual acceptance
is Chris's.

---

## Sprint 28.6H.6 Assignment Status Visual Language + Curriculum Assigned State + Class Management Flow Cleanup

**Disposition: COMPLETE.** A narrow follow-up to H.5 from Chris's live emulator
review. The teacher architecture and the student platform were not reopened.
Client / presentation work only: no Cloud Functions, Firestore Rules, Firestore
index, persistence, OAuth, or Google Classroom API change
(`firestore.indexes.json` remains `"indexes": []`); the curriculum manifest was
not regenerated. No operational-attention work. No STOP condition triggered.

**Bottom-aligned assignment actions (Part A).** The class-scoped assignment card
(`shared/activeAssignments.ts` compact variant) now pushes Open assignment to
the bottom with `margin-top: auto` (resilient flex layout, no absolute
positioning, no per-status pixel offsets). Because the grid stretches cards to a
shared row height, every Open control in a grid row bottom-aligns even when one
card carries an extra "N not started" line - verified faithfully (a short and a
tall card sharing a row both measured 170px with their Open buttons at the same
top). The operational "not started" line is retained; the card stays compact and
content-driven (Part A2) - the minimal card measured 136px.

**Completed assignment state (Part B).** A class-scoped card receives the
`shell-active-assignment-card-complete` treatment ONLY when the certified summary
is loaded, `totalStudents > 0`, and `completedStudents === totalStudents`. A
zero-recipient assignment (`0 of 0`) is never treated as completed, and a partial
/ not-started assignment stays neutral. The treatment is a very subtle pale-green
tint (`rgba(61,220,132,0.07)`) + a restrained green-tinted border, with the
completion count in a restrained success green; no saturated fill, banner, badge,
checkmark, or primary-green button repaint. The completion count text stays
authoritative (color is supplemental). Incomplete cards stay neutral/white (Part
B3 - no red/yellow/warning states). No persistence, no new backend read (reuses
the existing per-card `assessmentAssignmentSummary`).

**Curriculum previously-assigned state (Part C).** A lesson card that has been
assigned at least once (the existing session assignment-history signal
`isAssigned`, hydrated from the certified published/closed registry - no new
persistence/backend) receives `shell-lesson-card-assigned`: a very subtle cool
blue/slate tint (`rgba(90,120,160,0.08)`) + slate border. This is a DIFFERENT
concept and a DIFFERENT hue from the Classes pale-green completed state (verified
distinct; never green). The tint never fires on a deactivated card
(`:not(.shell-lesson-card-inactive)`). Assign is unchanged (still "Assign", still
enabled, still re-assignable - never renamed, disabled, badged, or replaced);
Preview, View Summary, and Resources are unchanged. The class is kept in step
with the assignment-history signal by `refreshAssignControl`. No badge label was
added (Task C4).

**Class Management decision surface (Parts D/E, `settings.ts`).** Settings ->
Class Management is now a DECISION surface with two clearly distinct class-source
areas: a **Google Classroom** section (heading + connection status + Manage
connection + **Import Class** primary) and a separate **LyfeLabz Classes**
section (heading + **Create LyfeLabz Class** secondary), followed by the compact
managed-class list. Import and Create no longer sit together as an ambiguous
pair; the manual creation action can no longer be mistaken for a Google Classroom
operation. Manage connection stays grouped with the connection status (H.5) and
stays a quiet text-link; Import stays primary, Create stays secondary (Task E3).

**Decision vs task separation (Parts F/G, `classes.ts`).** The shared
class-management workflow is now DECISION-vs-TASK separated via a `listAddMode`
signal set from the one-shot Settings intent (and from an in-surface choice).
Once a task is chosen, the routed task surface shows ONLY that task:
- **Manual create task (Part F):** only the focused form - no "Add a class"
  wrapper heading (F1), no Google Classroom import action anywhere in the task
  (F2), the "Create LyfeLabz Class" heading (F3), the existing Class name / Grade
  / Block fields + validation (F3), and a **"Create Class"** submit (F4). Cancel
  returns to the Settings -> Class Management decision surface via the existing
  `navigateToSurface("settings")` seam (F5) - no new routing architecture; a
  harness without the seam falls back to the in-Classes decision state.
- **Google Classroom import task (Part G):** only the import workflow; the manual
  Create form/action is never shown alongside it. Existing OAuth / discovery /
  import / needsSetup / activation / roster-sync semantics are unchanged; the
  in-flight import controller is still aborted on cancel.
- **Decision state (zero-class landing):** presents the two class sources as
  distinct labelled groups (Google Classroom / LyfeLabz Classes) instead of an
  "Add a class" wrapper.

**Student Services preserved (Part H).** Settings tabs remain Class Management
(default) | Student Services; the Student Services placeholder line ("Student
accommodations and supports will be managed here.") is unchanged. No
accommodation toggles, persistence, or backend.

**Responsive validation (Part L).** Faithful `#app-root`-scoped harness (real
production CSS + exact DOM served over HTTP) at 1280 and narrower: Open
assignment controls bottom-align within a grid row; extra progress lines do not
shift alignment; completed tint stays subtle and incomplete cards stay neutral;
Curriculum assigned tint stays subtle and cohesive with Assign green unchanged;
Class Management reads as two distinct sources; the focused Create form fits
narrow screens. No horizontal page scroll at any measured width.

**Accessibility (Part K).** The new card colors are supplemental only - Classes
completion remains explicit in text ("N of N completed"), Curriculum remains
driven by existing assignment data. The pale-green / slate tints keep dark ink
titles at acceptable contrast; Assign/Preview/badge/link contrast, visible focus,
keyboard behavior, and the tab semantics are unchanged. No new status badges were
added to the visible UI.

**Served bundle (Part O).** `npm --prefix app run build` rebuilt
`app/dist/bundle.js` (newer than every modified source); it contains the new
implementation (`shell-active-assignment-card-complete`,
`shell-lesson-card-assigned`, `settings-lyfelabz-section`,
`classes-add-lyfelabz-heading`, `listAddMode`) and the CSS
(`shell-settings-lyfelabz`, the completed / assigned tints, `margin-top: auto`).
The running UX-review emulator (`http://127.0.0.1:5000/app/`) returned a
byte-identical bundle and a fresh `index.html`, confirming no stale asset.
`bundle.js` is a build artifact (not git-tracked); not hand-edited.

**Tests.** `classes.assignments.test.ts` (completed-state condition incl. the
zero-recipient guard, partial/not-started neutral, bottom-action structure,
H.5 title behavior; the focused create task - no "Add a class", no import,
"Create Class" submit, Cancel -> Settings; the focused import task - no create
form; the zero-class two-source decision). `curriculum.view-summary.test.ts`
(assigned-state class from existing data, never-assigned neutral, Assign
unchanged). `settings.test.ts` (Import in the Google Classroom section, Create
LyfeLabz Class in the LyfeLabz Classes section, correct hierarchy and DOM order).
`shell.test.ts` CSS regressions (Open `margin-top: auto`; completed pale-green
not primary-green; Curriculum assigned cool/slate distinct from the green
completed state).

**Validation.** `typecheck` clean; `lint` clean; `lessons:verify` OK; app Jest
**1953/1954**. The sole failure is the pre-existing curriculum-manifest SHA drift
(`curriculumManifest.test.ts` / `curriculum:verify`), the known Sprint-29-owned
baseline documented across 28.6C-H.5. This phase touched neither the root
`index.html` curriculum source nor the manifest JSON and did not regenerate the
manifest. No Functions or Rules change.

**Limitations / human handoff.** Assignment cards align within a grid ROW; cards
that wrap onto different rows (more cards than columns) are separate rows by
design, so their Open buttons are not cross-row aligned - matching normal card
grids. The Cancel -> Settings return uses the existing surface-navigation seam;
in a harness without it, Cancel falls back to the in-Classes decision state.
Authenticated click-through of the live shell remains un-automatable locally
(Auth-emulator pop-up relay unsupported in the headless review browser, as in
28.6C-H.5); the changes were validated with faithful `#app-root`-scoped harnesses
(real production CSS + exact DOM served over HTTP), behavioral and CSS regression
tests, and served-bundle verification. Final human visual acceptance is Chris's.

---

## Sprint 28.6H.7 Operational Assignment Ordering + Curriculum Assign-Again State + Contextual Google Classroom Authorization

**Disposition: COMPLETE.** A narrow follow-up to H.6 from Chris's live emulator
review. The teacher architecture and the student platform were not reopened.
Client / presentation work only: no Cloud Functions, Firestore Rules, Firestore
index, persistence, new OAuth architecture, or Google Classroom API change
(`firestore.indexes.json` remains `"indexes": []`); the curriculum manifest was
not regenerated. No STOP condition triggered.

**Incomplete-first assignment ordering (Part A).** The class-scoped
(flat) Class Workspace Assignments list now renders a stable
incomplete-first partition: assignments with outstanding work render before
fully completed ones, preserving the certified `compareCards` relative order
within each group (Task A3). The partition reuses the H.6 completed definition
exactly, extracted into one shared `isProgressComplete` helper
(`shared/activeAssignments.ts`): completed only when the summary is loaded,
`totalStudents > 0`, and `completedStudents === totalStudents` - so `0 of 0` is
never completed (Task A2/A4). The partition is DOM order (not CSS `order`), so
visual and screen-reader order agree (Part L). Because per-card completion is
only known once its summary resolves, a settle in flat mode schedules a single
microtask-coalesced re-render that re-partitions; the accordion path keeps its
in-place single-card refresh. Presentation only - no timestamps, lifecycle,
stored ordering, queries, or Firestore data mutated (Task A4). The H.6 card
language is preserved (Task A5): outstanding = neutral/white, completed = subtle
pale-green, canonical title, completion + progress text, date, bottom-aligned
Open assignment.

**Curriculum Assign Again state (Part B).** A previously assigned lesson (the
existing session assignment-history signal - no new persistence/backend) now
shows BOTH the H.6 cool-slate card tint AND a muted-green **"Assign Again"**
action; a never-assigned lesson keeps the full-strength green **"Assign"** (Task
B1). "Assign Again" reads as an action, never a status ("Assigned" was avoided).
The behavior is identical - same assignment dialog/workflow, always enabled,
always re-assignable (Task B2); only the presentation changes, kept in step with
the history signal via `refreshAssignControl` and a shared `applyAssignState`
helper. The muted treatment (`.shell-lesson-assign.shell-lesson-assign-again`,
Task B3/B4) is a solid desaturated green fill `#43765a` with white text
(measured **5.28:1** contrast, AA) and the solid-Assign micro-shadow dropped so
it reads receded - never gray, outlined-only, disabled-looking, or like the
neutral Preview; the focus ring is re-asserted so focus stays visible (Part L).
The two-class selector wins over the base/polish rules regardless of source
order. The H.6 slate card tint is preserved (Task B5) and is never the Classes
pale-green.

**Contextual Google Classroom authorization (Parts C-F, D).** The permanent
"Connected / Not connected / Manage connection" presentation and the Integrations
subview were removed from the primary Settings -> Class Management surface
(`settings.ts`): the connection-status line, the Manage connection control, the
`subview`/`draw` integrations branch, and the `renderIntegrationsSurface` import
are gone, and their now-dead CSS was removed (no orphaned spacing). The Google
Classroom section is simply **Google Classroom -> [Import Class]** (primary),
with **LyfeLabz Classes -> [Create LyfeLabz Class]** (secondary) preserved (Part
G). **No new OAuth was written.** Contextual authorization is provided entirely
by the EXISTING certified import controller (`createImportFromClassroom.start()`,
Part P): it resolves the provider, checks `describeConnections` for an active
connection, runs the certified `beginConnection -> openOAuth ->
completeConnection` OAuth ONLY when no usable connection exists (D2), proceeds
directly to `discoverClasses` when one does (D1), reconsents when the connection
is not active (expired/revoked/insufficient scope, D3), and continues into course
discovery after a successful authorization (D4) - all covered by the controller's
18 certified tests (connected->direct discovery, disconnected->inline OAuth,
cancel, popup-blocked, reentrancy/no-double-OAuth, etc.). Settings "Import Class"
routes (via the certified one-shot intent) into the focused import task on the
Classes surface, whose Import entry point invokes `start()` inside the user
gesture. The underlying OAuth / scopes / token custody / connection records /
identity binding / revalidation / incremental consent / reconnect / cancellation
/ course discovery / roster sync / publication are all unchanged; the
Integrations module file is preserved in the tree (dormant, no longer bundled),
so the connection capability's implementation is not deleted (Part F). No new
Integrations/Account screen was invented; explicit disconnect is not surfaced on
this primary surface this phase (deferred per Part F).

**Focused flows preserved (Parts H/I/J/K).** The focused manual create task is
unchanged (heading "Create LyfeLabz Class"; Class name / Grade / Block;
"Create Class" submit; Cancel returns to Settings; no "Add a class" wrapper, no
Google import action). The focused import task never shows the manual create
form. Roster sync for linked Google Classroom classes is unchanged (manual
classes still expose none). Student Services is unchanged (placeholder intact).

**Responsive validation (Part M).** Faithful `#app-root`-scoped harness (real
production CSS + exact DOM served over HTTP) at 1280 and narrower: incomplete
cards render first and completed cards follow with relative order stable; Open
assignment stays bottom-aligned; the pale-green completed tint stays subtle;
Curriculum shows white + full-green Assign for unused lessons and slate +
muted-green Assign Again for used ones (both obviously clickable, distinct from
Preview); Settings reads "Google Classroom -> Import Class / LyfeLabz Classes ->
Create LyfeLabz Class" with no connection UI and no orphaned spacing
(heading->Import gap 6px). No horizontal page scroll at any measured width.

**Accessibility (Part L).** Assignment DOM order matches visual order (partition
before render, no CSS `order`). Assign Again is a real active control with AA
contrast (5.28:1), preserved hover and a re-asserted focus ring, and never reads
disabled. Import Class remains a normal accessible button; the certified import
controller keeps its existing loading/error/cancel announcements and busy
handling. Tabs unchanged.

**Served bundle (Part Q).** `npm --prefix app run build` rebuilt
`app/dist/bundle.js` (newer than every modified source; smaller, since the
Integrations subview is no longer bundled); it contains the new implementation
("Assign Again", `shell-lesson-assign-again`, `isProgressComplete`,
`scheduleFlatRerender`) and none of the removed strings (`renderIntegrationsSurface`,
"Manage connection", `settings-open-integrations`). The running UX-review
emulator (`http://127.0.0.1:5000/app/`) returned a byte-identical bundle and a
fresh `index.html` (muted-green CSS present, connection-row CSS removed),
confirming no stale asset. `bundle.js` is a build artifact (not git-tracked); not
hand-edited.

**Tests.** `classes.assignments.test.ts` (incomplete-first ordering incl.
relative-order preservation and the 0-of-0 guard; completed/neutral tint; H.6
card contract). `curriculum.view-summary.test.ts` (Assign Again label + muted
class + slate tint; unused = full green Assign; Assign Again opens the same
dialog). `curriculum.action-layout` / `curriculum.layout` /
`curriculum.false-success` / `curriculum.success-banner` / `shell.test.ts`
updated so assigned-lesson assertions expect "Assign Again" (failure-case
assertions correctly stay "Assign"). `settings.test.ts` (no Connected /
Not connected / Manage connection on the primary surface; Import Class present;
sections preserved). `shell.test.ts` CSS regression (muted-green Assign Again:
solid `#43765a` fill, not transparent/`#1f6b3d`, `box-shadow: none`, focus ring
re-asserted; base Assign stays `#1f6b3d`). Contextual authorization is covered by
the existing 18 `importFromClassroom.test.ts` tests, reused unchanged.

**Validation.** `typecheck` clean; `lint` clean; `lessons:verify` OK; app Jest
**1959/1960**. The sole failure is the pre-existing curriculum-manifest SHA drift
(`curriculumManifest.test.ts`), the known Sprint-29-owned baseline documented
across 28.6C-H.6. This phase touched neither the root `index.html` curriculum
source nor the manifest JSON and did not regenerate the manifest. No Functions or
Rules change.

**Limitations / human handoff.** The incomplete-first partition depends on each
card's summary, which loads asynchronously; the list re-orders once (one
microtask-coalesced reflow) as summaries settle. Explicit Google Classroom
disconnect is not reachable from the primary Class Management surface this phase
(the connection capability and its module are preserved dormant; a future phase
owns an explicit home if a certified requirement needs one). Authenticated
click-through of the live shell remains un-automatable locally (Auth-emulator
pop-up relay unsupported in the headless review browser, as in 28.6C-H.6); the
changes were validated with faithful `#app-root`-scoped harnesses (real
production CSS + exact DOM served over HTTP), behavioral and CSS regression
tests, the certified import-controller suite, and served-bundle verification.
Final human visual acceptance is Chris's.

---

## Sprint 28.6H.8 Curriculum Reassign Treatment + Direct Google Classroom Import Flow + Classes Landing Cleanup

**Disposition: COMPLETE.** A narrow follow-up to H.7 from Chris's live emulator
review. The teacher architecture and the student platform were not reopened.
Client / presentation + frontend-state work only: no Cloud Functions, Firestore
Rules, Firestore index, persistence, new OAuth architecture, or Google Classroom
API change (`firestore.indexes.json` remains `"indexes": []`); the curriculum
manifest was not regenerated. No STOP condition triggered.

**Curriculum Reassign (Part A/B).** The previously-assigned lesson action is
relabelled from "Assign Again" to **"Reassign"** (Task A1) and restyled from a
muted-green FILL to a green **OUTLINE**
(`.shell-lesson-assign.shell-lesson-reassign`): transparent background (the H.6/H.7
cool-slate assigned-card tint shows through), assignment-green border + text
(`#1f6b3d`), the solid-Assign micro-shadow dropped. A never-assigned lesson keeps
the solid full-strength green "Assign". The behavior is identical - same
assignment dialog/workflow, always enabled, always re-assignable (Task A2); only
presentation changes, kept in step with the history signal via the shared
`applyAssignState` + `refreshAssignControl`. Measured: green text 6.50:1 on
white (higher on the slate card), AA; hover adds a very light green wash
(`rgba(31,107,61,0.08)`); the focus ring is re-asserted so focus stays visible.
The outline reads as a secondary assignment action, clearly distinct from the
neutral gray Preview and never disabled-looking (Part K). The slate card tint is
preserved (Task B3/B5) and is never the Classes pale-green.

**Classes landing cleanup (Part C).** The operational Classes landing no longer
hosts ANY class-administration control - the "Import Class from Google Classroom"
leftover and the manual "Create LyfeLabz Class" opener are gone from both the
populated and the zero-class landing (`renderListState`). A populated landing is
just the "Classes" heading, the class count, and the class cards. The zero-class
landing (Part C2) is a concise Settings pointer - "No classes yet." + "Add or
import a class in Settings." + a restrained **Go to Settings** action wired to
the existing `navigateToSurface("settings")` seam - never a second Import/Create
decision surface.

**Direct Google Classroom import (Parts D/E, `renderListState` + intent).** When
a class-source task is chosen, the Classes surface renders ONLY that focused task
(never the generic Classes landing): a manual create task shows only the form; an
import task (`addMode === "import"`) shows a **"Import from Google Classroom"**
heading (Task E1) then the certified import workflow, with existing class cards /
count / manual create action all absent (Task E2/D3). Settings -> Class Management
-> Import Class now routes STRAIGHT into that focused task and **auto-starts** the
certified import controller (`onStartImport()` invoked as the routed intent is
consumed), so there is no intermediate generic Classes landing and no second
Import click (Task D1/D3). The import entry point renders in `directLaunch` mode:
the standalone "Import Class from Google Classroom" button is suppressed and a
calm "Connecting to Google Classroom…" placeholder covers the brief idle window.
Cancel returns to Settings -> Class Management via the certified seam (Task E3);
the imported-class success destination (needsSetup class -> setup form) is
unchanged (Task E4); `listAddMode` is reset when leaving a task (open class, back
to list, create/import success) so a later visit shows the operational landing.

**Contextual authorization preserved (Part D2/O).** No new OAuth was written. The
auto-start reuses the certified `createImportFromClassroom.start()`: active
connection -> straight to course discovery; no/expired/revoked/insufficient-scope
connection -> the existing `beginConnection -> openOAuth -> completeConnection`
reconsent -> discovery. **User-gesture review (Part O):** `openOAuth` opens a
`win.open` pop-up ~3 network awaits after `start()`; the certified second-click
flow already depended on transient activation surviving that chain, and
auto-start adds only the (fast) `listClasses` await plus a sync surface swap
after the Settings "Import Class" click, so `win.open` stays inside the click's
~5s activation window. The certified popup-blocked message + retry remains the
explicit fallback if activation ever expires - no silent weakening. The
Integrations connection-management UI stays removed (H.7); no Connected /
Not connected / Manage connection returned (Part J).

**Preserved (Parts F/G/H/I).** Manual create task unchanged (heading "Create
LyfeLabz Class"; Class name / Grade / Block; "Create Class" submit; Cancel ->
Settings; no "Add a class", no Google import). Settings decision surface
unchanged (Google Classroom -> Import Class; LyfeLabz Classes -> Create LyfeLabz
Class; no connection UI). Class Workspace Assignments (incomplete-first ordering,
pale-green completed, bottom-aligned Open) untouched. Student Services unchanged.

**Responsive validation (Part L).** Faithful `#app-root`-scoped harness at 1280
and narrower: solid green Assign on white cards, green-outline Reassign on slate
cards (never disabled, distinct from Preview); the Classes landing shows only
class cards (no orphaned import space); the focused import task shows the Google
Classroom import heading + course selection with no generic landing; the
zero-class landing is a concise Settings pointer. No horizontal page scroll.

**Served bundle (Part P).** `npm --prefix app run build` rebuilt
`app/dist/bundle.js` (newer than every modified source); it contains the new
implementation ("Reassign", `shell-lesson-reassign`, "Import from Google
Classroom", "Add or import a class in Settings", `classes-go-to-settings`,
`directLaunch`) and none of the removed strings ("Assign Again",
`shell-lesson-assign-again`). The running UX-review emulator returned a
byte-identical bundle and a fresh `index.html` (reassign CSS present),
confirming no stale asset. `bundle.js` is a build artifact (not git-tracked);
not hand-edited.

**Tests.** Curriculum label/CSS suites updated to "Reassign" + the green-outline
class (`curriculum.action-layout`, `curriculum.view-summary`,
`curriculum.layout`, `curriculum.false-success`, `curriculum.success-banner`,
`curriculum.class-cache-invalidation`, `shell.test.ts`). `classes.test.ts`
create/import workflow tests rewired to reach the form/import via the shared
class-management intent (Classes no longer hosts landing buttons) and to
auto-start the import (no manual Import click). `classes.assignments.test.ts`:
zero-class landing is a Settings pointer; the import intent launches the focused
task directly (no generic landing / second Import button); intent consumed once.
`shell.test.ts`: no-classes landing shows "No classes yet." + Settings guidance,
no admin controls; assigned-lesson action reads "Reassign". Contextual
authorization stays covered by the 18 certified `importFromClassroom.test.ts`
tests, reused unchanged.

**Validation.** `typecheck` clean; `lint` clean; `lessons:verify` OK; app Jest
**1958/1959**. The sole failure is the pre-existing curriculum-manifest SHA drift
(`curriculumManifest.test.ts`), the known Sprint-29-owned baseline documented
across 28.6C-H.7. This phase touched neither the root `index.html` curriculum
source nor the manifest JSON and did not regenerate the manifest. No Functions or
Rules change.

**Limitations / human handoff.** Direct import auto-start relies on the Settings
"Import Class" click's transient activation covering the certified controller's
few fast awaits before `win.open`; the certified popup-blocked message + retry is
the explicit fallback (no OAuth rewrite, no silent weakening). Explicit Google
Classroom disconnect remains not surfaced on the primary Class Management surface
(deferred since H.7; the connection capability/module is preserved). Authenticated
click-through of the live shell remains un-automatable locally (Auth-emulator
pop-up relay unsupported in the headless review browser, as in 28.6C-H.7); the
changes were validated with faithful `#app-root`-scoped harnesses (real
production CSS + exact DOM served over HTTP), behavioral and CSS regression tests,
the certified import-controller suite, and served-bundle verification. Final
human visual acceptance is Chris's.

---

## Sprint 28.6H.9 Final Teacher Navigation + Action-State Polish

**Disposition: COMPLETE.** A narrow human-acceptance correction pass on H.8 from
Chris's live emulator review. No teacher architecture or student platform was
reopened. Client / presentation + frontend-state work only: no Cloud Functions,
Firestore Rules, Firestore index, persistence, OAuth architecture, or Google
Classroom controller change (`firestore.indexes.json` remains `"indexes": []`);
the curriculum manifest was not regenerated. No STOP condition triggered.

**Correction 1 - Reassign treatment (root cause: stale served artifact, not a
source bug).** The H.8 outlined-Reassign implementation was already correct in
source and needed no CSS rewrite. Verified empirically rather than by eye: a
faithful harness built from the real `index.html` `<style>` blocks + the exact
assigned/unassigned card DOM was rendered in the browser, and the two-class rule
`.shell-lesson-assign.shell-lesson-reassign` (specificity 0,2,0) reliably wins
over the base solid-green `.shell-lesson-assign` (0,1,0) and the Sprint-20
refinement block (`.shell-lesson-assign`, 0,1,0, which sets only box-shadow /
radius and is neutralised by the reassign rule's `box-shadow: none`). No
higher-specificity or later descendant rule sets a green background on the
button. Computed styles over the running emulator confirm: Reassign = transparent
fill + green text/border `rgb(31,107,61)` (OUTLINE); a never-assigned Assign =
solid `rgb(31,107,61)` fill + white text. The `applyAssignState` label/class
toggle is present in the rebuilt bundle. **Root cause of the reviewer seeing
solid green:** the emulator was serving a stale artifact (the recurring 28.6
stale-served-bundle/`index.html` issue) whose reassign CSS/class had not caught
up to source; a rebuilt, byte-verified served artifact renders the outline
reliably. No source change was required; reliability is delivered by the
mandatory rebuild + served-artifact verification below. Assignment semantics
unchanged (same workflow, always enabled, always re-assignable).

**Correction 2 - Back to Settings on focused Settings child tasks.** Both focused
tasks reached from Settings -> Class Management (Import from Google Classroom;
Create LyfeLabz Class) now render a persistent **"Back to Settings"** control at
the top, mirroring the certified "Back to Classes" idiom
(`shell-classes-back-to-settings` shares the `shell-class-workspace-back` visual
rules + focus ring). It is parent navigation, distinct from the task actions, so
it coexists with the create form's Create Class / Cancel and the import task's
Cancel / Close. It returns to Settings (whose default tab is Class Management),
reusing the existing `navigateToSurface("settings")` seam via the certified
`onCancelImport` / `onCancelCreate` return handlers (which also tear down any
in-flight import); no new routing architecture. Rendered only when the
settings-return seam is wired, so harnesses without it are unaffected. The
operational Classes landing (not a child task) shows no Back to Settings control.

**Correction 3 - simplified Google Classroom import task.** The numbered
four-step process stepper ("Sign in to Google Classroom / Load your courses /
Create your LyfeLabz class / Link to Google Classroom") is removed from the
focused import task in every state. The presentational `renderImportStages`
function and its `IMPORT_STAGE_LABEL` / `IMPORT_STAGE_ORDER` tables were deleted
(the now-unused `ImportStage` type import removed); no controller behavior
changed - the stepper was pure presentation derived from `importState`. The
focused task is now just Back to Settings, the "Import from Google Classroom"
heading, and the live authorization / loading / course-selection content + task
actions. No explanatory paragraph replaced the list. The cancellation message
("Google Classroom sign-in was cancelled. Try again whenever you are ready.")
remains controller-owned and unchanged.

**Correction 4 - import cancellation action hierarchy.** The import task's
Try again / Close (and the Cancel / Close rows) previously had no dedicated CSS
and fell back to the plain gray browser button, reading with equal weight. Added
`.shell-classes-import-retry` (canonical primary green `#1f6b3d` fill / `#175a31`
hover, matching Assign / Create) and `.shell-classes-import-cancel` (neutral
outlined secondary: white fill, `#333` text, faint border, matching Create's
Cancel), a flex action-row layout (Try again first / primary), a re-asserted
focus ring on both, and a coarse-pointer 44px touch-target minimum. Computed
styles over the emulator confirm Try again `rgb(31,107,61)` fill / white text vs
Close white fill / `rgb(51,51,51)` text. Behavior (certified retry / OAuth /
safe-exit) is unchanged; only presentation of the existing controls changed.

**Emulator validation.** Authenticated live click-through remains un-automatable
locally (Auth-emulator pop-up relay unsupported in the headless review browser,
as in 28.6C-H.8). Validation used a faithful `#app-root`-scoped harness (the real
production `index.html` `<style>` + the exact focused-task / card DOM) served over
HTTP through the running UX-review emulator, so the real cascade is exercised:
- assigned slate card + green-OUTLINE Reassign beside unassigned white card +
  SOLID green Assign (Preview unchanged);
- focused import task: Back to Settings + "Import from Google Classroom" heading,
  NO numbered stepper, cancellation copy, green Try again + neutral Close;
- focused create task: Back to Settings + "Create LyfeLabz Class" + Create Class /
  Cancel;
- computed backgrounds/borders assert the exact primary/secondary/outline colors;
- responsive at desktop / mobile: 44px touch targets on Try again / Close, no
  horizontal page scroll, Reassign stays outlined.

**Tests.** `classes.assignments.test.ts` (Sprint 28.6H.9 block, 3): Back to
Settings on the focused create task and focused import task each returns to
Settings (never Classes / Curriculum); no Back to Settings on the operational
landing. `classes.test.ts`: the linking-error test now asserts the stepper is
absent; a new Correction 3/4 test drives a recoverable (discovering-stage) import
error and asserts no stepper plus the Try again (`shell-classes-import-retry`,
first) / Close (`shell-classes-import-cancel`) hierarchy (a `discoverClasses`
override was added to the test harness). Reassign coverage is unchanged and
already strong: `shell.test.ts` locks the outlined `.shell-lesson-assign
.shell-lesson-reassign` rule (transparent fill, green text/border, no solid fill,
hover wash, focus ring) and `curriculum.view-summary` / `curriculum.action-layout`
assert the "Reassign" label, the class, always-enabled, and same-workflow.

**Validation.** `typecheck` clean; `lint` clean; `lessons:verify` OK. App Jest
**1962/1963 passing**. The sole failure is the pre-existing curriculum-manifest
SHA drift (`curriculumManifest.test.ts`), the known Sprint-29-owned baseline
documented across 28.6C-H.8 - it compares the root `index.html` against the
manifest JSON, neither of which this phase touched; the manifest was not
regenerated. No Functions or Rules change (baselines untouched, not re-run).

**Served bundle (MANDATORY).** `npm --prefix app run build` rebuilt
`app/dist/bundle.js` (22:17, newer than every modified source). The bundle
contains the new implementation (`Back to Settings`, `classes-back-to-settings`,
`shell-lesson-reassign`, `Reassign`) and none of the removed stepper strings
(`classes-import-stages`, `Sign in to Google Classroom`, `Load your courses`,
`Link to Google Classroom`, `Import progress`). The running UX-review emulator
returned a **byte-identical** `bundle.js` (`cmp` clean) and a served `index.html`
carrying the new CSS (`shell-classes-back-to-settings`, `shell-classes-import-retry`,
`.shell-lesson-assign.shell-lesson-reassign`), confirming no stale asset.
`bundle.js` is a build artifact (not git-tracked); not hand-edited.

**Files changed.**
- Production: `app/src/shell/surfaces/classes.ts` (remove import stepper +
  `ImportStage` import; add `renderBackToSettings` + wire it into both focused
  tasks), `app/index.html` (Back to Settings visual rules + focus ring; import
  Try again / Close action hierarchy CSS + coarse-pointer touch targets).
- Tests: `app/src/shell/surfaces/classes.assignments.test.ts`,
  `app/src/shell/surfaces/classes.test.ts`.
- Documentation: this record.

**Limitations / human handoff.** Authenticated live click-through remains
un-automatable locally (Auth-emulator pop-up relay); validated with the faithful
HTTP-served harness, behavioral + CSS regression tests, and byte-verified served
artifacts. Explicit Google Classroom disconnect remains not surfaced on the
primary Class Management surface (deferred since H.7). Final human visual
acceptance is Chris's.

---

## Phase gate summary

| Phase | Depends on | Must NOT do |
| --- | --- | --- |
| 28.6C | 28.6B accepted | Remove Active Assignments from Curriculum; change default landing |
| 28.6D | **28.6C** | Delete Present Mode source; ship View Summary data (28.6E) |
| 28.6E | 28.6D (entry surface) | Add composite index; build advanced analytics; client fan-out |
| 28.6F | independent of C/D/E (schedule after D for nav coherence) | Migrate/delete preference docs; remove per-class grade/block |
| 28.6G | 28.6B accepted (parallel) | Mutate stored assignment titles; duplicate domain metadata |
| 28.6H | **C, D, E, F, G** | Deploy; mutate external state; regenerate manifest |

---

## What this plan does not touch

Assignment lifecycle backend; authorization contracts; answer-key custody;
deep-link resolver; publication; Firestore rules; the curriculum manifest
generator and its output; lesson sources and generated lesson artifacts; legacy
games; Present Mode source (dormant, not deleted). All Sprint 29 release work
(privacy/OAuth disclosure, allowlist, assessment deployment, manifest
regeneration, production deployment/certification) remains deferred.
