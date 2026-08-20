# Sprint 28 Architectural Blueprint - Teacher Workflow & UX Polish + Pre-Release Hardening

Status: Phase 1 architecture. Scope-of-record for HOW Sprint 28 is
implemented. This blueprint converts the approved Sprint 28 definition
(`SPRINT_28_DEFINITION.md`, the Phase 0 output) into a precise
architectural plan that can be reviewed before implementation begins. It
authorizes no production code, no test change, no deployment, no OAuth
initiation, and no Firebase or Google state change. It was produced by
direct repository inspection, not by relying on the Phase 0 report alone.

Companion documents:
- `SPRINT_28_DEFINITION.md` (approved scope of record; Phase 0)
- `SPRINT_28_IMPLEMENTATION_PLAN.md` (ordered phases derived from this blueprint)
- `SPRINT_27_COMPLETION_REPORT.md` (certified baseline preserved by Sprint 28)
- `SPRINT_27_PHASE_7_BROWSER_CERTIFICATION.md` (O1, O2 field observations)
- `SPRINT_27_ARCHITECTURAL_BLUEPRINT.md` (Decision precedents; deep-link contract)
- `SPRINT_27_IMPLEMENTATION_PLAN.md` (Phase 3 LMS self-heal precedent for O4)
- `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (v1 release sequence)
- CLAUDE.md (LESSON BUILD ARCHITECTURE, marker grammar, mobile-canonical stylesheet)

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level
break, per repository standard.

---

## 1. Purpose

The Sprint 28 definition fixed four bounded workstreams and their
boundaries. This blueprint records, per workstream, the exact existing
components, what is reused versus changed, the data and control flows,
the security and domain invariants, the accessibility requirements, the
risks, and the validation strategy. It resolves one open UX decision
(the student return-control wording) and surfaces one material Phase 0
correction (the v2 lesson build boundary) that changes how Workstream 2
is implemented.

The workstreams:

- **W1 - Assignment Detail teacher polish** (O1 Close-control
  reproduction-then-branch, O5 bounded late-recipient polish).
- **W2 - v2 assessment results UX** (O2 results scroll and focus, O3
  student return navigation).
- **W3 - Manual onboarding claims self-heal** (O4).
- **W4 - Assignable curriculum v2 migration** (Phase 2C amendment; §18).
- **W5 - Curriculum manifest drift evidence handoff** (O6; formerly W4; §8).

The original blueprint (Phase 1) defined four workstreams W1 through W4,
with W4 being the manifest handoff. The Phase 2C scope amendment inserts a
new W4 (curriculum migration, §18) and renames the manifest handoff W5.
Sections §2 through §17 predate the amendment and use the original W1 to W4
numbering; §18 is the amendment. Where §8 says "W4 disposition" it means the
manifest handoff now called W5.

## 2. Architectural baseline

### 2.1 Sprint 27 disposition preserved

Sprint 27 is complete and certified with documented limitations, committed
at `425f667`, not yet production deployed. Every Sprint 27 capability and
invariant recorded in `SPRINT_27_COMPLETION_REPORT.md` §5 and the Sprint
28 definition §3.3 and §9 is load-bearing and is preserved without
exception. The load-bearing set most relevant to Sprint 28:

- Caller-scoped student result reads over `assessmentAttemptsList`; no
  client `studentId`; no reuse of the class-scoped teacher callable for
  student surfaces.
- Server-authoritative LMS and manual onboarding; no client-asserted
  school, district, class, provider, or roster identity.
- Assignment-aware deep link: server-built
  `https://app.lyfelabz.com/app/a/{assignmentId}`, resolved read-only by
  `lmsDeepLinkResolve` with the full authorization order; URL possession
  is never authorization; the resolver never calls Google; closed
  assignments fail safely.
- Frozen recipient population; the teacher's explicit one-at-a-time
  `assignmentsRecipientAdd` (`source: manualAddition`) is the only
  extension.
- The Sprint 27 D1 fix: `app/index.html` loads its bundle from the
  absolute `/app/dist/bundle.js` so the deep-link route boots. Not
  reverted.

### 2.2 Deterministic baseline to be preserved

- Functions: typecheck clean, lint clean, 91 suites, 1699 tests, 0 failures.
- App: typecheck clean, lint clean, 65 suites, 1092 tests, 1091 passed, 1
  known failure (`curriculumManifest.test.ts`, the O6 SHA drift, owned by
  Sprint 29).
- Firestore Rules: 18 suites, 228 tests, 0 failures. Sprint 27 changed
  zero rules. Sprint 28 must not regress this and does not plan a rules
  change (§10.4).

### 2.3 Phase 0 correction (material): the v2 lesson build boundary

The Sprint 28 definition O2 code trace (§4, O2 "Breadth") states that
"Earths-layers is generated from `lesson-sources/` under the Sprint 18
lesson build system; the other three are hand-authored v2 artifacts."

**Direct inspection during Phase 1 shows this is not correct.** All four
v2 lessons are generated from canonical sources under the deterministic
lesson build system:

- Canonical sources exist for all four:
  `lesson-sources/lesson_earths-layers.html`,
  `lesson-sources/lesson_plate-tectonics.html`,
  `lesson-sources/lesson_water-cycle.html`,
  `lesson-sources/lesson_earthquakes.html`.
- Builder configs exist for all four under
  `app/scripts/lessonBuilder/lessons/` (`earths-layers.cjs`,
  `plate-tectonics.cjs`, `water-cycle.cjs`, `earthquakes.cjs`). Each
  declares `canonicalSource`, both build targets (`v1: lesson_<slug>.html`
  at the repo root; `v2: app/lessons/lesson_<slug>.html`), and the
  generated notice.
- Each v2 artifact carries the `<!-- GENERATED FILE. -->` notice.
- Plate Tectonics was migrated to the build system in commit `5f6f7b7`
  ("Sprint 19B: Migrate Plate Tectonics to deterministic lesson builds");
  Water Cycle and Earthquakes followed.
- The builder registry (`lessons/index.cjs`) reads every slug from disk;
  `npm --prefix app run lessons:verify` rebuilds all four in memory and
  fails on any drift; it is part of `app run verify`.

**Consequence for W2.** Every W2 edit to any of the four v2 lessons must
be made in the canonical source `lesson-sources/lesson_<slug>.html` and
then rebuilt with `npm --prefix app run lessons:build`. Direct edits to
the committed `app/lessons/lesson_<slug>.html` artifacts are prohibited
and are caught by `lessons:verify` in CI. This is a build-process
correction only; it does not widen scope, and it does not change the O2 or
O3 product behavior. It does change how the change is landed (source plus
rebuild, with V2-ONLY markers to keep v1 byte-for-byte unchanged; see
§6.4).

CLAUDE.md's "Applies today to: Earth's Layers only" note is stale relative
to the committed tree; Sprint 28 does not extend the build system to any
new lesson, so no CLAUDE.md change is required, and none is proposed.

## 3. Relevant existing components (verified, with anchors)

### 3.1 W1 - Assignment Detail

- `app/src/assignments/detail/detail.ts` - the pure-DOM Assignment Detail
  builder. The Close control renders at
  [detail.ts:924](../../app/src/assignments/detail/detail.ts) in the
  `else if (deps.closeCallable !== undefined || deps.reopenCallable !==
  undefined)` branch, gated on `metadata.status === "published" &&
  deps.closeCallable !== undefined`. The inverse Reopen renders on
  `metadata.status === "closed" && deps.reopenCallable !== undefined`; a
  `closed` assignment with no reopen seam falls back to the non-interactive
  `Assignment closed` label. The rendering is provenance-agnostic: it does
  not branch on `enrollmentSource`, manual vs LMS, or publication origin.
- `renderLateRecipientPanel` (`detail.ts`, from ~line 1313) already
  provides: a `Students not yet assigned` heading, a loading state
  ("Loading students..."), an error state, an empty state ("Every enrolled
  student is already assigned."), per-row display name with an accessible
  `aria-label` ("Add {name} to this assignment"), a section-level in-flight
  lock (`submitting` disables every Add button), an in-place button-text
  change to "Adding...", and a single non-leaking action-error line. The
  section renders only for a `published` assignment when both seams
  (`recipientCandidatesListCallable`, `recipientAddCallable`) are wired.
- `app/src/index.ts` wires the lifecycle and late-recipient seams for every
  active-teacher session: `assignmentClose =
  createAssignmentsCloseCallable(functions)` and the reopen counterpart are
  assigned unconditionally in the active-teacher branch (index.ts:458), and
  passed as `closeCallable: assignmentClose ?? undefined` (index.ts:325) and
  `recipientAddCallable: assignmentRecipientAdd ?? undefined`. They are
  nulled on every non-teacher session outcome.
- `app/src/assignments/detail/wire.ts` -
  `createAssignmentDetailMetadataReader(registry)` returns
  `registry.lookup(assignmentId)`. The metadata (including `status`) is read
  from a session-scoped in-memory registry, not from a fresh Firestore read
  at open time.
- `app/src/assignments/detail/registry.ts` - the session-scoped
  `AssignmentDetailRegistry`. `lookup` returns `null` when the assignment is
  absent, which drives the detail surface to its EMPTY state (no header, no
  lifecycle control).
- `app/src/assignments/detail/hydrate.ts` -
  `hydrateAssignmentDetailRegistry` populates the registry from
  `assignmentsTeacherList`. `parseAssignmentsTeacherListItem` DROPS an item
  (returns null, so it is never registered) if any of `assignmentId`,
  `lessonSlug`, `title`, `classId`, `className`, or a valid `status` is
  missing or malformed. Hydration failure is calm (silent), so a hydration
  miss leaves the registry without that assignment.
- The registry is also populated in-session by `register()` after a publish
  and re-registered by `onStatusChange` after each lifecycle transition.

### 3.2 W2 - v2 assessment results

- The four v2 lesson artifacts
  (`app/lessons/lesson_{earths-layers,plate-tectonics,water-cycle,earthquakes}.html`),
  all generated from `lesson-sources/lesson_<slug>.html` (see §2.3).
- Per-lesson results markup: a `.score-board#el-score` (hidden until submit
  reveals it with `.show`), containing `#el-score-num`, `#el-score-msg`, a
  `.mystery-loop`, `#el-submit-status`, and a "Try Again" button
  (earths-layers lines 1608-1616).
- Per-lesson submit function `elSubmitQuiz` (earths-layers lines
  2013-2098): scores locally, reveals the score board
  (`sb.classList.add('show')`), calls `sb.scrollIntoView({ behavior:
  'smooth', block: 'start' })` where `sb` is `#el-score`, and, in assignment
  context, writes "Submitting..." then "Submitted to your teacher" into
  `#el-submit-status` after `finalize`. `elAssigned =
  window.lyfelabz.lessonQuiz.hasAssignmentContext()` is read at the top of
  submit.
- Sticky chrome: a top nav (`position: sticky; top: 0; z-index: 1000`,
  roughly 64px desktop, 52px at the phone breakpoint) plus
  `.quiz-progress-sticky` (`position: sticky; top: 64px`, lowered to `top:
  52px` on mobile). The `.score-board` rule has `margin-top` but no
  `scroll-margin-top` (earths-layers line 521), so `block: 'start'` aligns
  the score-board top to viewport y=0 under both sticky layers.
- The score board has no `role="status"`, no `aria-live`, and no
  `tabindex`, and submit performs no focus move, so a keyboard or
  screen-reader student is not moved to or told about the result.
- `app/src/runtime/entry.ts` - the headless assessment runtime adapter. It
  exposes `window.lyfelabz.lessonQuiz` with `hasAssignmentContext()`,
  `autosave`, `finalize`, `mapIndexSelectionsToResponses`, and
  `window.lyfelabz.assessmentRuntime`. `detectAssignmentId(win)` reads the
  `?assignment=<id>` query (or hash) param; assignment context is present
  when that id is present. The runtime owns no results UI, no scroll, and no
  focus behavior. A single runtime edit cannot fix O2 or O3.
- `app/src/assignments/studentList/launchOverrides.ts` - the four v2 slugs
  map to `/app/lessons/lesson_<slug>.html`.
- `app/src/assignments/studentList/launch.ts` - `buildLessonBasePath` and
  `buildAssignmentLaunchUrl` compose `<basePath>?assignment=<encodedId>`;
  the v2 lesson is a full-page navigation OUT of the SPA. The student
  workspace is the SPA at `/app/` (lands on My Assignments per PDR-024i).
- `app/src/assignments/deepLink/arrival.ts` - the deep-link arrival surface
  offers "Go to My Assignments" on every informational and failure state,
  but the successful silent handoff navigates to the standalone lesson,
  which then has no return control.

### 3.3 W3 - Manual onboarding

- `platform/functions/src/students/students-complete-onboarding.ts` - the
  manual (join-code) activation callable. Activation is three non-atomic
  steps: `userRecordDocRef(uid).update(activation)` (status active), then
  `writeCustomClaims(...)`, then `writeAuditEvent(...)`. A Firestore
  transaction cannot enclose the claims write. The idempotent replay branch
  (lines 175-193) matches on `user.status === "active" && user.role ===
  "student" && user.schoolId === input.schoolId` and returns `alreadyActive:
  true` WITHOUT reading or re-asserting claims.
- `platform/functions/src/students/students-complete-lms-onboarding.ts` -
  the certified LMS counterpart. Its idempotent branch (lines 300-355) reads
  `readCustomClaims(uid)`, computes `claimsHealthy` from `role === "student"
  && schoolId === recordSchoolId && districtId non-empty`, and only when
  unhealthy re-derives `districtId` from the school the record already names
  and re-asserts the canonical claims through `writeCustomClaims`. Healthy
  claims are a bounded no-op; there is no enrollment re-scan and no second
  activation audit event. It also fails closed on an active student record
  missing its school (a corrupt record, not a replay).
- `platform/functions/src/shared/auth/claims.ts` - `writeCustomClaims`
  (canonical writer; enforces the active-only invariant and the exact
  `{ role, schoolId, districtId }` shape) and `readCustomClaims(uid) ->
  CustomClaimsView` (`{ role?, schoolId?, districtId? }`, only canonical
  non-empty values survive; a read failure resolves to `{}` so the caller
  fails toward re-asserting claims). Both are exported from `../shared`.

### 3.4 W4 - Curriculum manifest

- `app/src/curriculum/curriculumManifest.test.ts` - re-parses the root
  `index.html`, rebuilds the manifest, and compares it to the checked-in
  `app/src/curriculum/curriculum.manifest.json`, including a
  `canonicalSourceSha256` comparison. The one failing assertion is the SHA
  comparison; all 19 structural assertions pass.
- `app/scripts/build-curriculum-manifest.cjs` - the regenerator invoked by
  `npm --prefix app run curriculum:build`.

## 4. W1 architecture - Assignment Detail teacher polish

### 4.1 O1 - reproduce first, then branch (no speculative Close button)

Phase 0 established, and Phase 1 re-confirmed, that the committed code
renders lifecycle controls type-agnostically, wires the close callable for
every active teacher, and contains no manual-vs-LMS suppression. Therefore
Sprint 28 does NOT implement a speculative Close button. The first W1
execution step is a clean deterministic-plus-browser reproduction of the
missing Close control. The implementation branches on the reproduction
evidence. The reproduction design (matrix, evidence, branches) is §5.

### 4.2 O1 architectural understanding of the failure surface

The Close control's presence depends on exactly two inputs at render time:

1. `deps.closeCallable !== undefined`. For an active-teacher session this
   is always wired (`app/src/index.ts:458, :325`). If the teacher session is
   not `activeTeacher`, no lifecycle seam is wired at all.
2. `metadata.status === "published"`, where `metadata =
   registry.lookup(assignmentId)`. Three distinct states produce "no Close
   control":
   - **Registry miss.** `lookup` returns `null` and the detail surface
     renders its EMPTY state (no header). Causes: the assignment was never
     registered (hydration dropped it because the `assignmentsTeacherList`
     projection lacked a required field, or hydration failed calmly, or the
     assignment was published in a prior session and never re-hydrated), or
     the "View summary" navigation reached an id absent from the registry.
   - **Stale or wrong status.** A registry entry exists but its `status` is
     `draft` or `closed` (for example a stale hydrated status not superseded
     by an in-session transition), so the published-only Close branch is not
     taken.
   - **Correct render.** A registry entry with `status === "published"`
     exists and the seam is wired, so the Close control renders. If Sprint 27
     saw its absence in this state, the cause is discoverability (a small
     secondary header button that was not noticed).

The parser-drop path (§3.1) is the most probable functional candidate:
`parseAssignmentsTeacherListItem` silently drops any teacher-list item
missing `classId` or `className`, and an LMS-published assignment that
projects those fields differently from a manual one would be dropped from
hydration, so a post-reload "View summary" open would find no registry
entry and render empty. This is a hypothesis to be confirmed by the
reproduction, not a defect to be assumed.

### 4.3 O1 conditional branches (chosen after reproduction)

- **Branch A - reproducible render or state defect.** Trace the root cause
  to one of the three states in §4.2. If hydration drops the LMS assignment,
  repair the projection or the parser so a valid LMS-published assignment is
  registered with `status: "published"` (preserving the parser's
  malformed-item rejection for genuinely malformed items). If an in-session
  status is stale, repair the registration or re-registration seam. In every
  case, fix within the existing render or state seam; preserve lifecycle
  semantics (published shows Close, closed shows Reopen, one action visible
  at a time); add a deterministic regression test that asserts the Close
  control renders for the reproduced state. Do not redesign Assignment
  Detail.
- **Branch B - control renders correctly in a clean state.** Close O1 by
  verification. Investigate whether the Sprint 27 observation was a stale or
  transient registry state in the seeded cert environment, or a
  discoverability problem. If discoverability, apply the smallest justified
  polish (clearer placement or labeling of the lifecycle control) plus a
  test that pins the rendered control; do not manufacture a defect.
- **Branch C - another state condition explains the absence** (for example
  the assignment was genuinely `closed` at that render, so the correct
  control is Reopen, not Close; or the session was not `activeTeacher`).
  Document the domain reason. Fix only if the state itself is invalid or
  misleading to the teacher; otherwise record the finding and close O1.

No defect is manufactured merely because Sprint 27 observed one.

### 4.4 O5 - bounded late-recipient polish

The existing `renderLateRecipientPanel` (§3.1) already carries the heading,
loading, error, empty, per-row accessibility, in-flight lock, and frozen
semantics. The three bounded gaps and their smallest fixes:

- **Add-success confirmation.** Today a successful add tears the panel down
  and rerenders (`onAdded()` -> cache drop -> rerender); the student simply
  disappears from the candidate list and appears in the roster above, with
  no explicit confirmation. Add a brief, accessible success confirmation
  ("Added to the assignment") announced through an `aria-live` region. The
  simplest home that survives the rerender is a short-lived confirmation
  surfaced by the detail surface on the `onRecipientAdded` path (which
  already knows an add succeeded), or a confirmation line rendered by the
  re-fetched panel keyed on a "just added" signal. It must be
  screen-reader announced and not color-dependent.
- **Calm informational state for a lifecycle status where a late add is
  impossible.** Today the section is simply ABSENT for a `closed` (or
  `draft`) assignment (rendered only for `published`, and the server
  returns an empty candidate list for non-published anyway, PDR-029j). Add
  a calm informational note in place of silent absence, explaining that
  students cannot be added while the assignment is closed (or is still a
  draft). This is a static, provenance-agnostic informational line; it
  introduces no new callable and no candidate read for a non-published
  assignment.
- **In-flight announcement.** The "Adding..." button-text change is a
  visual-only change today. Announce it through `aria-live` (a status
  region, or `aria-live` on the action row) so a screen-reader teacher hears
  that the add is in progress.

O5 introduces no automatic recipient mutation, no bulk gesture, and no
select-all. Frozen-recipient semantics remain locked. Assignment Detail is
not redesigned; every change is additive to the existing panel.

## 5. O1 reproduction design

### 5.1 Reproduction matrix

The reproduction runs in the Firebase Emulator Suite plus browser (the
Sprint 27 Phase 7 environment), against seeded canonical state, with no
live Google mutation (the closed-assignment resolver negative is already
certified; no Sprint 28 item needs a real `courseWork.create`). The matrix
crosses assignment provenance, lifecycle status, and navigation path:

| Dimension | Values to cover |
|---|---|
| Provenance | manual class published assignment; LMS-linked (`enrollmentSource: lms`) published assignment |
| Lifecycle status | `published` (Close expected); `closed` (Reopen expected) |
| Hydrated state | reached in the same session as publish (in-session `register`); reached after a full reload (hydration via `assignmentsTeacherList`) |
| Registry / session state | `activeTeacher` session with seams wired; `registry.lookup(assignmentId)` present vs null; the projected `status` value |
| Control rendering | header rendered (ready) vs empty state; Close present vs Reopen present vs neither |
| Close callable availability | `deps.closeCallable` wired (expected for active teacher) |

At minimum: manual-published in-session, manual-published post-reload,
LMS-published in-session, LMS-published post-reload, and the same four for
`closed` (Reopen). The manual-published cases are the control group; the
LMS-published post-reload case is the primary suspect (parser-drop
hypothesis, §4.2).

### 5.2 Evidence to capture before any fix

At the exact failing (or passing) render, capture:

- `registry.lookup(assignmentId)`: null, or the full metadata object with
  its `status`, `classId`, `className`, `lessonSlug`.
- The raw `assignmentsTeacherList` response item for that assignment: does
  the assignment appear at all, and does it carry `classId`, `className`, and
  a valid `status`? (Confirms or refutes the parser-drop hypothesis.)
- The detail surface load state: `ready` (header shown) vs `empty` (lookup
  null) vs `error`.
- Which lifecycle control rendered: Close, Reopen, `Assignment closed`
  label, or none.
- Whether the session was `activeTeacher` and whether `closeCallable` was
  wired.
- The navigation path used (in-session publish vs post-reload hydration vs
  Curriculum "View summary").

This evidence deterministically selects Branch A, B, or C (§4.3) before any
code changes.

### 5.3 Deterministic reproduction (preferred first step)

Because `metadata` flows from an injectable registry and the parser is a
pure function, most of the matrix is reproducible deterministically without
a browser: feed `parseAssignmentsTeacherListItem` an LMS-published
teacher-list item shape and assert whether it survives; render
`renderAssignmentDetail` with a registry stub at each `status` and assert
the control. The browser run then confirms the real
`assignmentsTeacherList` projection for an LMS-published assignment.
Deterministic-first keeps the fix (if any) test-anchored and avoids relying
on a single browser observation.

## 6. W2 architecture - v2 assessment results UX

### 6.1 O2 - the smallest safe results scroll-and-focus pattern

Target behavior on submission: results render, the viewport positions the
beginning of the results below the sticky chrome, focus moves to the
results, assistive technology receives a completion or result
announcement, and the visible score and submission confirmation are
immediately available.

Chosen mechanics (per the definition disposition, minimized):

- **Scroll offset via `scroll-margin-top`.** Add a `scroll-margin-top` to
  the results target (`.score-board`) equal to the combined sticky-chrome
  height (nav plus `.quiz-progress-sticky`), with the phone-breakpoint value
  matching the reduced sticky heights. `scrollIntoView({ block: 'start' })`
  honors `scroll-margin-top`, so the existing scroll call lands the score
  board below the sticky layers with NO JavaScript change to the scroll
  line. This is the elegant half: a pure CSS offset fixes the viewport
  position.
- **Focus target and `tabindex="-1"`.** The focus target is the results
  region so the student lands on the score, not on a heading buried inside
  it. Give the score board (or a results heading at its top)
  `tabindex="-1"` so it is programmatically focusable without becoming a Tab
  stop, and call `.focus({ preventScroll: true })` on submit right after
  the board is revealed. `preventScroll: true` means the CSS-offset scroll
  (via `scrollIntoView`) owns the viewport position and focus does not fight
  it.
- **Order: scroll before focus.** Reveal the board, call `scrollIntoView`
  (offset-aware), then `focus({ preventScroll: true })`. Scroll owns
  position; focus owns keyboard and SR context without re-scrolling.
- **Announcement semantics.** Give the results region `role="status"` and
  `aria-live="polite"` (a polite live region so it does not interrupt, and
  because the score is not an error). Because the score number and message
  are written into the region as it becomes visible, the polite live region
  announces the completion and score to a screen reader. The visible
  "Submitted to your teacher" (or the Exploration-mode line) remains the
  visible confirmation.
- **Reduced motion.** The lessons already carry a `prefers-reduced-motion:
  reduce` block that forces `scroll-behavior: auto`. The smooth scroll
  therefore degrades to an instant jump for reduced-motion users, which is
  correct; no additional handling is needed. The focus move is
  motion-neutral.
- **Sticky-nav interaction.** The offset must equal the ACTUAL sticky stack
  height at each breakpoint. At the 480 phone breakpoint the nav is ~52px
  and `.quiz-progress-sticky` moves to `top: 52px`; the offset value is
  breakpoint-aware. When the mobile menu is open, `.quiz-progress-sticky`
  becomes `position: static` (it leaves the sticky stack), which only
  reduces the overlap, so a fixed offset is safe (it never under-shoots into
  hidden content in the menu-open case).
- **Keyboard behavior.** After submit, focus sits on the results region;
  the "Try Again" button and (in assignment context) the O3 return control
  are the next Tab stops, so a keyboard student reaches both without a mouse.
- **Repeated submissions and attempts.** `elSubmitQuiz` guards on
  `elQuizState.submitted`, and "Try Again" (`elResetQuiz`) clears the board
  and rebuilds the quiz. The focus and announcement fire once per submit;
  reset returns focus to the quiz via its existing scroll to `#quiz`. The
  live region re-announces on the next submit because the content is
  rewritten. No new attempt-state machinery is introduced.

### 6.2 O3 - the student return control

Approved wording (§13): **`Back to My Assignments`**. Destination: the
student My Assignments surface at `/app/` (the SPA root, which lands on My
Assignments per PDR-024i).

- **Assignment-context detection.** Reuse the existing trusted runtime
  signal `window.lyfelabz.lessonQuiz.hasAssignmentContext()`, which is
  `true` exactly when the lesson was opened with `?assignment=<id>`
  (`detectAssignmentId`). No new context mechanism is introduced. `elAssigned`
  is already read at the top of `elSubmitQuiz`, so the control's rendering
  reuses that value.
- **Destination and why the deep link is untouched.** The control is a
  plain navigation to the fixed path `/app/` (a full-page navigation back
  into the SPA, because the v2 lesson is a standalone artifact outside the
  SPA). It does NOT re-enter the certified deep-link resolver
  (`/app/a/{assignmentId}`): the assignment is already completed, so the
  student is returned to the workspace, not made to re-resolve the completed
  deep link. It exposes no assignmentId and no internal identifier. It is
  not an arbitrary `returnUrl` mechanism; the destination is a single fixed
  in-product path. The already-certified deep-link authorization
  architecture is not changed (arrival, resolver, auth round-trip all
  untouched).
- **Rendering conditions.** The control lives inside the results surface
  (`#el-score`), which is `display: none` until submit reveals it, and is
  additionally gated to render only when `elAssigned` is true. This gives
  two-layer safety: it appears only AFTER submission (a child of the revealed
  score board) and only in assignment context. In v2 practice or standalone
  (no `?assignment=`), `elAssigned` is false and the control stays hidden. In
  v1 it never exists at all (V2-ONLY markers, §6.4). It does not appear
  before submission.
- **Keyboard and focus behavior.** The control is a native focusable element
  (an anchor or button with a visible text label, not color-dependent). It
  sits after "Try Again" in the results region, so O2's post-submit focus on
  the results region puts it within reach by Tab. It is keyboard-activatable
  by Enter or Space per its element type.
- **Practice and non-assignment behavior preserved.** Because rendering is
  gated on `hasAssignmentContext()` and the control is V2-ONLY, v1 lessons,
  v2 practice launches, and standalone visits are byte-for-byte unchanged.
- **Deep-link / auth flow changes.** None. The return control is a client
  navigation to `/app/`; it needs no server change, no resolver change, and
  no auth-flow change.

### 6.3 Shared helper versus per-lesson change (decision and justification)

**Decision: apply the same narrowly standardized change to each of the
four canonical lesson sources; do NOT introduce a new shared UI helper.**

Justification:

- The assessment runtime is deliberately headless (`entry.ts` owns no
  results UI, no scroll, no focus). Injecting results-positioning, focus,
  announcement, or a return control into the runtime would expand its role
  into a UI component, which the definition explicitly forbids ("do not
  pretend there is already a central UI component if there is not"). So a
  runtime-hosted shared helper is rejected.
- The four sources are near-identical, and the deterministic build system
  plus `lessons:verify` plus the instructional-equivalence contract already
  enforce consistency across them, so "the same small snippet in four
  sources" does not create uncontrolled drift; it is machine-checked.
- A shared CSS home does exist for the scroll offset ONLY: the canonical
  `<style id="mobile-canonical">` block, which CLAUDE.md records as the owner
  of "sticky quiz progress offset behavior." Placing `scroll-margin-top` for
  `.score-board` there would apply to every page in one edit. This is
  rejected for W2 because (a) it touches v1 and every non-quiz page, which
  the O2 scope ("does not touch v1 lessons") deliberately avoids, and (b) the
  focus and announcement changes cannot live in a stylesheet anyway, so the
  change would be split across two homes. Keeping the whole O2 change
  together in each source under V2-ONLY markers is cleaner and scope-safe.

### 6.4 W2 build boundary and v1 preservation (V2-ONLY markers)

Because all four v2 lessons are generated (§2.3), every W2 change is made
in `lesson-sources/lesson_<slug>.html` and rebuilt with `lessons:build`.
To keep v1 byte-for-byte unchanged (O2 and O3 scope), the changes are
placed in `V2-ONLY` marker regions using the context-appropriate grammar
(HTML top-level for markup, block-comment grammar inside `<script>` and
`<style>`), with the new labels declared in each lesson's `*.cjs` config
(`markers.v2Only`, `expectedContexts`, and any required-signature or
`equivalenceExclusions` entries the contract needs). Specifically:

- **O2 scroll offset.** A V2-ONLY `<style>` rule adding `scroll-margin-top`
  to `.score-board` (with the phone-breakpoint value). No JS change, no v1
  change.
- **O2 focus and announcement.** V2-ONLY additions: `tabindex="-1"`,
  `role="status"`, and `aria-live="polite"` on the results region, and a
  V2-ONLY focus call in `elSubmitQuiz` placed adjacent to the existing
  `scrollIntoView` line. The existing v1 `scrollIntoView({ block: 'start' })`
  call is preserved verbatim in the v1 output, so the
  instructional-equivalence "scrollIntoView call {function, target, kind}"
  comparison stays equal (v2 adds focus as adjacent non-scroll statements
  with the same scroll call); if the contract flags any difference, a
  declared `equivalenceExclusions` entry covers it.
- **O3 return control.** V2-ONLY markup inside `#el-score`, hidden until
  `elAssigned` reveals it, plus the V2-ONLY reveal line in `elSubmitQuiz`.
  Never present in v1 output.

The `lessons:verify` step must pass after rebuild (proving the committed
artifacts equal a fresh build), and the marker scanner must accept the new
regions (correct context, declared labels, balanced, non-nested).

## 7. W3 architecture - Manual onboarding claims self-heal

### 7.1 The seam and the fix

`studentsCompleteOnboarding` shares the exact non-atomic activation seam
the LMS path already self-heals: record update to `active`, then
`writeCustomClaims`, then `writeAuditEvent`, with no transaction spanning
the claims write. A prior attempt that reached `active` but failed the
claims write leaves the record `active` while the token carries no `role`,
`schoolId`, or `districtId`; the idempotent replay currently returns
`alreadyActive: true` without repair, so the student is persistently
stranded on the pending surface.

The fix mirrors the certified LMS self-heal (§3.3) narrowly: in the
idempotent branch, read the caller's own claims and, only when they are
missing or stale, re-derive `districtId` from the school the record already
names and re-assert the canonical student claims through
`writeCustomClaims`. Healthy claims stay a bounded no-op. No enrollment
re-scan, no second activation audit event, and no onboarding redesign.

### 7.2 Canonical sources for each claim

The self-heal reads and re-asserts server-owned claims only; it accepts no
new client authority field.

- **role.** Canonical value `"student"` (this is the student onboarding
  callable). Compared against `claims.role`.
- **schoolId.** The `users/{uid}` record's `schoolId`. In the manual
  idempotent branch the record is entered only when `user.status ===
  "active" && user.role === "student" && user.schoolId === input.schoolId`,
  so the record `schoolId` equals the client-supplied `input.schoolId` AND
  is non-empty (the request validator rejects an empty `schoolId`). The
  self-heal uses the RECORD `schoolId` (`user.schoolId`) as the canonical
  source, matching the LMS path's use of the record value, so it never
  depends on the client value beyond the branch's existing equality gate.
- **districtId.** Re-derived server-side from the school the record names,
  via the existing `resolveSchoolDistrictId(schoolId)` (reads
  `schools/{schoolId}.districtId`; fails closed with `district-unassigned`
  or `school-district-mismatch`). Never client-supplied.

### 7.3 Comparison and repair rules

- `claimsHealthy` is true when `claims.role === "student" && claims.schoolId
  === user.schoolId && isNonEmptyString(claims.districtId)`. (`readCustomClaims`
  already normalizes so only canonical non-empty values are present.)
- When `claimsHealthy` is true: NO write. Return `alreadyActive: true`,
  exactly as today, plus a benign info log. The audit stream, the record,
  and the token are unchanged.
- When `claimsHealthy` is false: re-derive `districtId` via
  `resolveSchoolDistrictId(user.schoolId)` and call `writeCustomClaims({
  uid, status: "active", role: "student", schoolId: user.schoolId,
  districtId })`. Emit a `warn` log (`students.onboardingClaimsRepaired`),
  and return `alreadyActive: true`. No second `students.activated` audit
  event (the activation already happened; the repair restores authorization
  the activation intended).

### 7.4 Failure semantics and incomplete canonical data

- If the record is `active`/`student` but `user.schoolId` is empty (a
  corrupt record, not a healthy replay): fail closed with a
  `students.invalidStatus`-class error rather than writing a claim with an
  empty `schoolId`. This mirrors the LMS path's corrupt-record guard.
  (Note: in the manual branch the schoolId equality gate makes an empty
  `user.schoolId` reachable only if `input.schoolId` were also empty, which
  the validator already rejects, so this guard is defense-in-depth.)
- If the school record is missing or has no `districtId`:
  `resolveSchoolDistrictId` already throws `students.schoolNotFound`,
  `school-district-mismatch`, or `district-unassigned`. The repair fails
  closed with the canonical error; no partial claim is written. The student
  is not silently degraded; the calling client surfaces the recoverable
  error and can retry after the school data is corrected.
- `writeCustomClaims` failure propagates (`claims.writeFailed`); the retry
  is safe (idempotent) once the underlying cause clears.

### 7.5 Security invariants for W3

- Authorization is not weakened: the callable still requires an
  authenticated caller, still activates only from `provisioned` on the
  non-idempotent path, and the self-heal runs only in the existing
  idempotent branch that already proved the record is `active`/`student` for
  this caller.
- No client authority field is added; `schoolId` still comes from the
  record and `districtId` from the school record; no cross-school or
  cross-district escalation is possible (the repair re-asserts exactly the
  claims the record already implies).
- Server authority and idempotency are preserved; a healthy replay writes
  nothing.

### 7.6 Reuse versus divergence from the LMS precedent

The manual self-heal reuses `readCustomClaims`, `resolveSchoolDistrictId`,
and `writeCustomClaims`, and mirrors the LMS branch's structure. It does
NOT blindly copy the LMS enrollment/qualification logic (the manual path
has no LMS enrollment concept). The one manual-domain difference is that the
manual idempotent branch is gated on `user.schoolId === input.schoolId`;
the self-heal keys on the record `schoolId`, so the client value never
participates in the repair beyond that pre-existing equality gate.

## 8. W4 disposition - curriculum manifest drift evidence handoff

The known manifest failure is SHA-only. Phase 0 established the root cause:
the most recent `index.html` change (commit `4fd2bab`) added exactly one
cosmetic line, `scroll-margin-top: 80px` on the `#how` marketing anchor,
after the manifest was last regenerated (`c8fe03e`). All 19 structural
curriculum assertions pass; only the embedded SHA fingerprint differs.
Regenerating the manifest (`npm --prefix app run curriculum:build`) would
update only the SHA and re-green the test, blessing a known benign change.

Sprint 28 does not regenerate the manifest and changes no curriculum
source, generated manifest, SHA, or manifest test. The Sprint 28 definition
§4 (O6) already records sufficient root-cause evidence for Sprint 29 to
regenerate the manifest as a mechanical release-hygiene step. This
blueprint and the implementation plan reference that disposition (§14, and
the plan's Phase 6 documentation reconciliation and Sprint 29 boundary) so
Sprint 29 can regenerate without reopening the investigation. No further
manifest-handoff evidence is needed; the definition is sufficient.

Note (Phase 2C amendment): the manifest-drift handoff described in this
section is renamed W5. The new W4 is the assignable curriculum v2 migration
(§18). The two are independent: W4 changes generated lesson artifacts and
the launch-override table but never touches `index.html`, so it does not
interact with the curriculum manifest or its SHA (§18, definition §16.8).

## 9. Data and control flows

### 9.1 O1 render decision (existing)

```
teacher opens Assignment Detail (Curriculum -> View summary, or in-session)
  -> loadMetadata = registry.lookup(assignmentId)
       null            -> EMPTY state (no header, no lifecycle control)
       status=draft    -> Draft label + (Edit/Publish if wired)
       status=closed   -> Reopen (if reopen wired) or "Assignment closed"
       status=published -> Close (if close wired)   <-- O1 target
  registry populated by: hydrate(assignmentsTeacherList) + in-session register + onStatusChange
```

### 9.2 O2/O3 results flow (target)

```
student submits (elSubmitQuiz)
  -> score locally, reveal #el-score (.show)
  -> #el-score.scrollIntoView({block:'start'})   [now offset by V2-ONLY scroll-margin-top]
  -> #el-score.focus({preventScroll:true})       [V2-ONLY]
  -> role=status + aria-live=polite region announces the score  [V2-ONLY]
  -> if hasAssignmentContext(): finalize -> "Submitted to your teacher"
        + reveal V2-ONLY "Back to My Assignments" control (href /app/)
  -> if not: Exploration-mode line; no return control
```

### 9.3 O4 manual onboarding self-heal (target)

```
studentsCompleteOnboarding (idempotent branch: record active + student + schoolId matches)
  -> claims = readCustomClaims(uid)
       healthy (role=student, schoolId matches record, districtId non-empty)
            -> no write; return alreadyActive:true
       unhealthy
            -> districtId = resolveSchoolDistrictId(user.schoolId)   [fail closed]
            -> writeCustomClaims(active, student, schoolId, districtId)
            -> return alreadyActive:true   [no second students.activated audit]
```

## 10. Security and domain invariants (consolidated)

- **Deep links.** Unchanged. URL possession is not authorization;
  authenticated identity, enrollment, recipient membership, lifecycle
  status, and school/district boundaries all remain enforced; the resolver
  stays read-only and never calls Google; closed assignments fail safely.
  W2's O3 return control does not re-enter the resolver and adds no
  `returnUrl` mechanism.
- **Recipient semantics.** Frozen. W1's O5 adds only clarity (success
  confirmation, informational state, in-flight announcement); no automatic
  or bulk recipient addition anywhere; the one-at-a-time teacher
  `manualAddition` remains the only extension.
- **Student results.** Caller-scoped only; no client `studentId`; no reuse
  of teacher or class-scoped result APIs. Sprint 28 touches no results read.
- **LMS onboarding.** Server-authoritative; unchanged. The student never
  chooses class, school, district, or provider membership.
- **Manual onboarding.** W3 adds self-heal without weakening authorization;
  it reads and re-asserts server-owned claims only; no new client authority
  field.
- **Google Classroom / OAuth.** Not reopened. No live provider mutation is
  required by any Sprint 28 item.
- **Firestore Rules.** Sprint 28 plans no rules change; the rules suite is
  re-run to confirm 228/228 regardless (§10.4 of the definition).
- **No secret, token, PII, or Google identity** in any URL, payload, audit
  event, log line, or client surface.

## 11. Accessibility requirements

- **O2.** On submission, the results are keyboard-and-screen-reader
  reachable: viewport lands the full score and confirmation below the
  sticky chrome (`scroll-margin-top`), focus moves to the results region
  (`tabindex="-1"`, `focus({preventScroll:true})`), and a polite live
  region (`role="status"`, `aria-live="polite"`) announces the score.
  Verified at the 480, 720, and 960 canonical breakpoints and with reduced
  motion (the existing `prefers-reduced-motion` block forces instant
  scroll).
- **O3.** The return control is a native focusable element with a visible
  text label, reachable by keyboard, not color-dependent, and correctly
  placed in Tab order after the results.
- **O5.** The add-success confirmation and the in-flight "Adding..." state
  are announced through `aria-live`; the calm informational state for a
  non-addable lifecycle status is readable text, not a color signal.

## 12. Explicit non-goals

Sprint 28 rejects, per the definition §7: whole-workspace or Assignment
Detail redesign; whole-curriculum v2 migration (the v1 Practice/Classroom
toggle is not a defect; Sprint 28 improves the four existing v2 lessons and
touches no v1 instructional behavior); any new LMS architecture, provider,
or capability; reopening certified OAuth architecture (including Sprint 25
B13); a new student rollup or analytics backend; any weakening of
frozen-recipient semantics; any new platform concept, claim key, or
lifecycle field; curriculum-manifest regeneration (Sprint 29); production
deployment and final v1 certification (Sprint 29); and unrelated cleanup or
opportunistic refactors. Sprint 28 additionally does not introduce a shared
runtime UI component for results (§6.3) and does not edit the v2 lesson
artifacts directly (§6.4).

## 13. Decision record - student return control

Approved for Sprint 28 planning:

- **Wording:** `Back to My Assignments`.
- **Destination:** the student My Assignments surface at `/app/` (the SPA
  root, which lands on My Assignments per PDR-024i).
- **The student is NOT routed back through the completed assignment
  deep-link resolver** for return navigation; the assignment is complete, so
  return goes to the workspace.
- **Non-assignment and practice behavior is preserved:** the control is
  rendered only in assignment context (`hasAssignmentContext()`), only after
  submission, and only in the v2 artifact (V2-ONLY), so v1, practice, and
  standalone are byte-for-byte unchanged.

## 14. Risk analysis

- **R1 - O1 has no reproducible defect.** The most likely outcome is Branch
  B (renders correctly; the Sprint 27 observation was transient state or
  discoverability). Mitigation: O1 is scoped as verify-plus-polish, not a
  guaranteed fix; the reproduction gate (§5) prevents manufacturing a
  defect, and the deterministic-first approach keeps any change
  test-anchored.
- **R2 - v2 build-boundary drift.** Editing an artifact directly instead of
  its source would fail `lessons:verify` and be lost on the next build.
  Mitigation: §2.3 and §6.4 make the source-plus-rebuild path explicit; the
  plan gates each W2 phase on `lessons:verify` green.
- **R3 - instructional-equivalence contract flags the V2-ONLY scroll/focus
  difference.** Mitigation: keep the v1 `scrollIntoView` call verbatim and
  add v2 focus as adjacent statements so the compared
  `{function, target, kind}` tuple stays equal; use a declared
  `equivalenceExclusions` entry if the contract still flags it.
- **R4 - sticky-offset value drift across breakpoints.** A wrong
  `scroll-margin-top` value would under- or over-shoot. Mitigation:
  browser-certify the landing at 480, 720, and 960; the menu-open case only
  reduces overlap, so a fixed offset never hides content.
- **R5 - O4 school data incomplete at repair time.** Mitigation: the repair
  fails closed on missing school or districtId (§7.4); no partial claim is
  written; the retry is safe once data is corrected.
- **R6 - O5 success confirmation lifetime.** A confirmation that survives
  the panel rerender must not become a stale banner. Mitigation: scope the
  confirmation to the post-add rerender and announce it once via `aria-live`;
  it is informational, not a persistent state.

## 15. Validation strategy

- **Deterministic (jsdom/unit).** O1 render-by-status and
  parser-drop coverage; O5 success confirmation, informational state, and
  in-flight announcement; O4 self-heal cases (healthy no-op, missing claims
  repaired, stale claims repaired, corrupt-record and missing-district fail
  closed, initial activation unchanged, idempotency, authorization
  unchanged, no cross-school/district escalation); W2 focus target,
  announcement semantics, `hasAssignmentContext`-gated return control
  presence/absence, and destination, to the extent jsdom can assert them.
  The four v2 lessons additionally pass `lessons:verify` and the
  instructional-equivalence contract after rebuild.
- **Browser-only (reserved for certification).** True viewport landing
  below sticky chrome at 480/720/960; smooth-scroll and reduced-motion
  behavior; real screen-reader announcement; the O1 reproduction on a
  genuinely LMS-published assignment; the O5 teacher flow; the O3 return
  navigation landing on `/app/` from a completed assignment. Where jsdom
  cannot meaningfully prove browser behavior (scroll geometry, focus paint,
  SR output), the plan reserves it for browser certification rather than
  asserting fake values.
- **Suites return to baseline.** Functions, App (with the O6 manifest
  failure remaining the only expected app red until Sprint 29), and
  Firestore Rules return to their Sprint 27 baselines.

## 16. Sprint 29 boundary

Unchanged from the definition §14. Sprint 29 (Teacher Platform v1 Release
Certification) owns: the curriculum-manifest SHA regeneration and a complete
deterministic baseline; the Google OAuth verification and Data Access
disposition; Secret Manager rotation; documentation reconciliation;
production deployment; production teacher and student smoke and end-to-end
tests; and final v1 production certification. Sprint 28 contributes the O6
root-cause evidence and changes no manifest artifact.

## 17. Definition of architectural completion

Architecture is complete when:

- W1 (O1 reproduce-first with a matrix and conditional branches; O5 bounded
  polish), W2 (O2 scroll/focus/announcement; O3 return control; build
  boundary; shared-vs-per-lesson decision), W3 (O4 self-heal with claim
  sources, comparison, and failure semantics), and W4 (manifest handoff)
  are each resolved with a single chosen approach and a stated rationale
  (done: §4 through §8).
- The material Phase 0 correction (all four v2 lessons are generated) is
  recorded with its consequence for W2 (done: §2.3, §6.4).
- The security and domain invariants, accessibility requirements, non-goals,
  risks, validation strategy, and Sprint 29 boundary are recorded (done: §10
  through §16).
- No production code, test, or Firebase/Google state is changed by the
  Phase 1 task.

Disposition: ARCHITECTURE COMPLETE - READY FOR REVIEW, pending the explicit
implementation authorization the definition requires.

## 18. W4 architecture - assignable curriculum v2 migration (Phase 2C amendment)

Status: architecture for the approved Phase 2C scope amendment (definition
§16). This section is the HOW for migrating the Category B surfaceable
lessons onto the existing v2 assignment-aware student contract. It reuses
the deterministic build system already proven by the four v2 lessons; it
introduces no new platform architecture. The audit evidence is in
`SPRINT_28_CURRICULUM_MIGRATION_AUDIT.md`.

### 18.1 The assignable surface (verified)

- The only assignment target is a `lessonSlug`
  (`assignmentsCreateDraft` validates it as a URL-safe token; the assignable
  set is defined by the teacher Curriculum surface, which iterates
  `getSurfaceableLessons()`).
- Surfaceable lessons = manifest units with a `lesson` resource that are not
  gated = 49 lessons. Non-lesson resources and the gated `ragebaiting`
  lesson are not assignment targets.
- Category A (already v2): earths-layers, plate-tectonics, water-cycle,
  earthquakes. Category B (migrate): the other 45. Category C/E: none.
  Category D: everything non-assignable.

### 18.2 The reusable migration pattern (from the four built lessons)

The four v2 lessons prove the exact transformation. A migrated lesson's
canonical source (`lesson-sources/lesson_<slug>.html`) differs from its
current hand-authored v1 artifact by exactly:

1. Three runtime wiring points, using the per-lesson prefix, all in the
   SHARED (non-marked) body so both v1 and v2 outputs carry them:
   - `window.lyfelabz.lessonQuiz.autosave(<prefix>QuizState.selected)` on
     answer selection.
   - `var <prefix>Assigned = window.lyfelabz.lessonQuiz.hasAssignmentContext();`
     at the top of the submit function.
   - the assignment-context block:
     `if (<prefix>Assigned) { ... window.lyfelabz.lessonQuiz.finalize(selected) ...; return; }`
     which posts to the certified runtime and renders "Submitted to your
     teacher" / error states. The runtime re-scores from the deployed answer
     key; local scoring is preserved for student-facing feedback.
2. V1-ONLY marker regions wrapping the legacy classroom apparatus so it
   survives in the v1 output only: the Practice/Classroom mode-toggle
   markup, the student-info form markup, the classroom CSS and coarse-pointer
   touch-target CSS, the Apps Script endpoint constant, the mode-state
   variable, `setQuizMode`, the mode-init IIFE, `validateStudentInfo`, the
   classroom validation guard, the practice-completion branch, and the Apps
   Script submit branch. (Twelve regions in the earths-layers precedent; the
   exact set per lesson follows that lesson's existing legacy code.)
3. One V2-ONLY region: the standalone/exploration completion message shown
   when a v2 lesson is opened without assignment context.
4. The W2 hardening (see §18.4): scroll offset, focus, live-region
   announcement, and the `Back to My Assignments` control, added V2-ONLY.

Plus, outside the source:

5. A builder config `app/scripts/lessonBuilder/lessons/<slug>.cjs` declaring
   `canonicalSource`, both output paths, the generated notices, the
   `requiredLabels` (v1Only + v2Only), `expectedContexts`, the per-lesson
   `v1RequiredSignatures` / `v2ProhibitedSignatures` / `sharedRequiredSignatures`,
   the `equivalenceExclusions` for the legacy-form DOM ids and scroll
   targets, and `pilotContractMinimums`. The registry auto-discovers any
   `<slug>.cjs`, so registration is "drop the file."
6. An answer-key payload `platform/functions/src/scripts/assessments/<slug>.r1.json`
   authored from the lesson's existing quiz (co-requisite; deploy deferred to
   Sprint 29).
7. The slug added to `LESSON_LAUNCH_OVERRIDES` - only after the lesson's
   build, legacy-absence, equivalence, and runtime checks pass.

The only per-lesson variation is the prefix (wl, ct, cd, ...) and each
lesson's own legacy code shape. The transformation itself is identical.

### 18.3 Systematic, not heterogeneous

The build engine is generic (no lesson identity in the engine), the config
registry auto-discovers, `lessons:verify` rebuilds every configured lesson
in memory and fails on any drift, and the instructional-equivalence
contract is data-driven per config. This makes W4 a repeated deterministic
transformation with machine-checked consistency, not 45 unrelated projects.
Complexity per lesson: low to moderate. Low for the wiring and markers
(mechanical, precedented). Moderate only where a lesson's legacy code
diverges from the earths-layers shape, or where v1 byte reproduction needs
care (§18.5). Aggregate complexity is moderate because of count and the
answer-key co-requisite, not because of architecture.

### 18.4 W2 lands before W4 (sequencing decision)

The W2 (O2/O3) hardening - `scroll-margin-top` offset, `tabindex`/focus,
`role="status"`/`aria-live`, and the `Back to My Assignments` control - is
authored into the four Category A sources first (Phase 3). Those V2-ONLY
snippets then become the canonical template every Category B migration
clones. Migrating first and hardening second would require a second edit
pass over 45 lessons. Therefore Phase 3 (W2) precedes Phase 5 (W4). This is
the verified-preferable order the definition §16.4 fixes.

### 18.5 Preservation strategy

- Instructional equivalence is enforced by the existing contract, which
  compares titles, headings, learning goals, vocabulary, quiz questions and
  correct indices, explanations, More Learning, Connections, scroll targets,
  and runtime wiring between the v1 and v2 outputs of the same source. A
  migration that changed instructional content would fail this contract.
- v1 public content and URL are preserved: the root `lesson_<slug>.html`
  keeps its filename (no rename, no redirect stub needed) and its
  instructional content. It does change from hand-authored to generated and
  gains the GENERATED FILE notice - exactly the transition the four existing
  v2 lessons already underwent and the accepted precedent. The legacy
  Practice/Classroom path stays intact in the v1 output via V1-ONLY markers,
  so non-assignment v1 behavior is unchanged.
- The primary per-lesson risk is v1 byte reproduction: the canonical source,
  built to v1, must reproduce the lesson's instructional v1 output. The
  build is verified by `lessons:verify`; any normalization difference beyond
  the notice is caught before commit. Care in extracting the source (so the
  generated v1 equals the intended v1) is the main hand-work per lesson.
- The answer key is authored from the quiz that already exists in the
  lesson, so scoring semantics are not invented or changed. Deployment is
  Sprint 29.

### 18.6 Answer-key co-requisite (the explicit exception)

`assignmentsPublish` calls `resolveCurrentAssessmentRevisionId(lessonSlug)`
and refuses publication if no assessment revision is deployed. This gates
publication for BOTH practice and classroom modes and is independent of the
frontend v1/v2 state. Consequences:

- A frontend-migrated lesson is still unpublishable end to end until its
  assessment is deployed. Sprint 28 authors the `<slug>.r1.json` payloads
  (deterministic, testable) but does not deploy them; deployment to
  production Firestore is a mutation owned by Sprint 29.
- The three Category A lessons without an authored answer key
  (plate-tectonics, water-cycle, earthquakes) get answer keys authored in
  W4 as well, closing the gap the audit found (only earths-layers currently
  has both a v2 build and an answer key).
- The answer-key deployment pipeline (`deployAssessmentRevision`) already
  exists; W4 authors payloads for it, it does not build new deployment
  architecture.

### 18.7 Test strategy for W4 (design only; not built in the audit)

Deterministic contract validation asserted systematically across generated
outputs, not per lesson by hand:

- Build determinism: `lessons:verify` green for every configured lesson.
- Marker correctness: the marker scanner accepts every new region (correct
  context, declared labels, balanced, non-nested).
- Instructional equivalence: the contract passes for every migrated lesson
  (or a declared `equivalenceExclusions` entry honestly covers a legacy-form
  difference).
- v2 contract, asserted across all generated v2 outputs by a shared test:
  the assignment-context hook (`hasAssignmentContext`) is wired; the runtime
  finalize path is present; the legacy chooser signatures are absent from v2
  (`v2ProhibitedSignatures`); `role="status"`/`aria-live`/`tabindex` and the
  `scroll-margin-top` offset are present on the results region; the
  `Back to My Assignments` control is present and points at `/app/`.
- v1 non-regression, asserted across all generated v1 outputs: the legacy
  Practice/Classroom signatures are still present (`v1RequiredSignatures`),
  and the v2-only additions are absent from v1.
- Answer-key fidelity: a test that each `<slug>.r1.json` item's
  `correctOptionId` matches the lesson's authored quiz correct index and
  that stems/options/explanations align.

Browser certification samples, it does not exhaustively re-test 45 lessons.
Because the transformation and the build machinery are identical across
lessons, deterministic checks prove the invariants for all; browser
certification then samples a representative few chosen by structural
variation (for example one Grade 6 and one Grade 7, one with a
prefix-collision such as photosynthesis's `el` prefix, and one whose legacy
code diverged most from the earths-layers shape) plus re-certifies the four
Category A lessons that carry the W2 hardening. Live Google mutation is not
required for any of it.

### 18.8 W4 risks

- R7 - v1 byte reproduction drift on a lesson whose legacy code diverges
  from the earths-layers shape. Mitigation: `lessons:verify` gates every
  build; extract the source carefully; the equivalence contract catches
  instructional drift.
- R8 - answer-key transcription error. Mitigation: the answer-key-fidelity
  test cross-checks each payload against the lesson's own quiz; deployment is
  a separate Sprint 29 step with its own verification.
- R9 - scope creep into instructional redesign under cover of migration.
  Mitigation: the equivalence contract forbids content change; the plan's
  stop/review gate rejects any question or content edit.
- R10 - a Category B lesson turns out to have a non-standard quiz not caught
  by the audit sample. Mitigation: the audit confirmed all 49 surfaceable
  lessons carry `<prefix>SubmitQuiz` and a `<prefix>-score` board; any
  genuine outlier discovered at migration time is reclassified to Category C
  and deferred with a named reason rather than forced.

*End of Phase 2C W4 architecture amendment.*

*End of Sprint 28 architectural blueprint.*
