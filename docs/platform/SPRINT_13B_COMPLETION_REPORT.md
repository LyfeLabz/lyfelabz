# Sprint 13B Completion Report: Teacher Assignment Detail Surface

**Dates:** 2026-07-17
**Status:** Implementation complete; conditionally certified pending repository-wide validation.
**Preceding sprint:** Sprint 13A (Teacher Assignment Summary UI Foundation).

## 1. Objective

Introduce the first authenticated teacher-facing Assignment Detail surface. The surface composes the certified Sprint 13A `renderAssignmentSummaryCard` unchanged and adds a small header of already-known assignment metadata (title, status, class name). No new backend contract, callable, Firestore Rule, index, LMS integration, or schema is introduced. The certified aggregate-only confidentiality boundary is preserved.

This sprint is scoped strictly to the presentation-layer composition. It does not introduce a student roster, per-student drill-down, editing controls, publish/archive controls, charts, exports, filtering, sorting, or live updates.

## 2. Certified Foundation Consumed Without Modification

- Sprint 13A `renderAssignmentSummaryCard` (composed exactly, mounted once per detail surface).
- Sprint 13A `AssignmentSummaryCallable` seam (passed through the detail deps to the summary card).
- Sprint 12E Slice 1 aggregate-only response allowlist and confidentiality exclusions.
- Sprint 12E Slice 2C frozen recipient population and representative-attempt tie-break policy.
- Teacher authorization and district enforcement on the underlying callable server-side.
- Sprint 6C persistent left-side navigation (Curriculum, Classes, Present Mode, Settings). The four-item navigation is unchanged.

No Cloud Functions code, Firestore Security Rules, callable contracts, LMS integration wiring, schema, or index configuration was changed.

## 3. Implementation Summary

### 3.1 Assignment Detail Surface

`app/src/assignments/detail/detail.ts` exports `renderAssignmentDetail(mount, { assignmentId, loadMetadata, summaryCallable, onBack? })`. The surface is a pure DOM builder that:

- Issues exactly one call to the injected `AssignmentDetailMetadataReader` on mount.
- Renders one of four states inside a stable-height container: loading, ready (header plus mounted Sprint 13A summary card), empty, error.
- Never derives, aggregates, or recomputes assignment metadata; every field rendered is exactly the field returned by the reader.
- Mounts the Sprint 13A summary card without modification, passing the injected `AssignmentSummaryCallable` and the resolved `assignmentId` through unchanged.
- Never imports from any firebase module and opens no listener. A posture test asserts the absence of firebase imports, callable helpers, snapshot listeners, and browser storage APIs in both `detail.ts` and `types.ts`.

### 3.2 Metadata Reader Seam

`app/src/assignments/detail/types.ts` declares:

- `AssignmentStatus` = `"draft" | "published" | "closed"`.
- `AssignmentDetailMetadata` = `{ assignmentId, title, status, className }`.
- `AssignmentDetailMetadataReader` = async input-to-metadata function. Resolves with `null` to trigger the empty state; rejects to trigger the error state.

The reader seam is the sole boundary between the detail surface and any data source. Tests inject in-memory fakes.

### 3.3 Session-Scoped Metadata Registry

`app/src/assignments/detail/registry.ts` exports `createAssignmentDetailRegistry()`, a purely in-memory `Map`-backed registry keyed by `assignmentId`. It stores only teacher-owned assignment metadata (title, status, class name); no student, recipient, attempt, or session identifier is ever registered. The registry is scoped to the active-teacher session and cleared by the entry point on any non-teacher bootstrap outcome.

### 3.4 Entry-Point Metadata Wire

`app/src/assignments/detail/wire.ts` exports `createAssignmentDetailMetadataReader(registry)`, which returns an `AssignmentDetailMetadataReader` backed by the injected registry. It imports nothing from any firebase module.

### 3.5 Entry-Point Wiring

`app/src/index.ts`:

- Constructs a per-tab `assignmentDetailRegistry` once at bootstrap.
- Rebinds `assignmentSummary`, `integrations`, and `assignments` per active-teacher session, and clears the assignment-detail registry on any non-teacher bootstrap outcome.
- Exposes `openAssignmentDetail(assignmentId)` inside the entry-point closure. The opener clears the app mount and calls `renderAssignmentDetail` with the certified summary callable, the metadata reader built over the session-scoped registry, and an `onBack` handler that re-runs the bootstrap so the teacher returns to the workspace shell.

The Sprint 13A additive wire and the certified integrations, assignments-lifecycle, and route-table wiring are unchanged.

## 4. Assignment Detail Layout

When the ready state is entered, the surface renders exactly:

1. The assignment title (`<h3>`).
2. A definition list containing the assigned class and the assignment status.
3. The Sprint 13A Assignment Summary card, mounted once via `renderAssignmentSummaryCard`.

Nothing more. No recipient information, no student identity, no attempt information, no session information, and no raw assessment data is rendered. A confidentiality regression test asserts that the rendered subtree never contains any of `studentId`, `student-id`, `recipientId`, `attemptId`, `sessionId`, `teacherId`, `districtId`, `schoolId`, `displayName`, `answerKey`, or `explanation`.

## 5. Assignment Header

The header uses only existing tokens (`.shell-card`, `.shell-assignment-detail-*`). It presents:

- Assignment title.
- Class name.
- Status label mapped from the certified lifecycle values (`draft` -> "Draft", `published` -> "Published", `closed` -> "Closed").

No editing control, no publish control, no archive control, and no assignment-creation control is added. Those remain owned by future sprints.

## 6. Summary Integration

`renderAssignmentSummaryCard` is imported directly from `../summary/card` and mounted once, unchanged, into the ready state's summary host. The detail surface does not duplicate rendering logic, does not duplicate callable logic, and does not create a second summary component. A test asserts that exactly one `[data-testid=assignment-summary]` element is rendered per ready detail.

## 7. Loading Behavior

- On mount, the surface renders a `role="status" aria-live="polite"` region containing the platform-standard `.shell-spinner` and the loading label `Loading assignment`.
- The container is preserved via `.shell-assignment-detail` so no layout shift occurs when the state transitions to ready, empty, or error.
- Once metadata resolves, the metadata header renders synchronously and the Sprint 13A summary card enters its own loading state until the summary callable resolves. The two loading indicators do not compete for the same container.

## 8. Empty Assignment State

- Triggered when the metadata reader resolves with `null` (assignment metadata unavailable through the wired reader).
- Renders a teacher-facing sentence: `We could not find this assignment. Return to your workspace and open the assignment again.`
- Announced via `role="status" aria-live="polite"`.
- The Sprint 13A summary card is not mounted and the summary callable is not invoked.
- The rendered subtree never exposes vocabulary such as `recipient`, `recipients`, `roster`, `enrollment`, `collection`, `Firestore`, `callable`, or `permission-denied`. A regression test asserts absence of every forbidden token.

## 9. Error State

- Any rejection from the metadata reader transitions the surface into the error state.
- Renders a `role="alert"` region with the teacher-facing sentence: `We could not load this assignment right now. Try again in a moment.`
- A `Try again` button rebinds the load and clears the error state on success. Only the most recent in-flight load is honored via a monotonic load token.
- Rejection messages never leak to the DOM. A regression test seeds a rejection whose message contains `Firestore permission-denied at attempts/{attempt-42} for user student-77` and asserts that no fragment of that message reaches the DOM.
- Summary-callable failures are surfaced by the Sprint 13A summary card's own error UI, not by the detail's error state, so the metadata header remains visible while the retry is scoped to the card.

## 10. Navigation

- When `onBack` is provided, the header renders a native `<button type="button">` labeled `Back` with `aria-label="Back to previous workspace"`. Clicking it invokes `onBack()`.
- When `onBack` is omitted (test isolation), the Back button is not rendered.
- The entry-point-wired `openAssignmentDetail(assignmentId)` uses an `onBack` handler that re-runs the Canonical Session Bootstrap so the teacher returns to the workspace shell in its default surface (Curriculum). No browser history abstraction is added.
- The permanent four-item Teacher Workspace navigation is unchanged.

## 11. Accessibility

- The surface exposes an `aria-labelledby` reference to a real `<h2>` headline whose id is stable (`assignment-detail-headline`).
- Metadata is marked up as a `<dl>` with `<dt>` labels and `<dd>` values so screen readers announce label plus value pairs.
- Loading and empty states are announced via `role="status" aria-live="polite"`.
- The error state is announced via `role="alert"`.
- The retry and Back controls are native `<button>` elements reachable via keyboard.
- No text color is introduced by the sprint; the surface inherits the certified `.shell-card` design tokens.

## 12. Responsive Behavior

- The metadata definition list and summary host stack cleanly at every viewport, sized by the existing responsive tokens on `.shell-card`. No new breakpoint, spacing scale, or typography scale is introduced.
- No horizontal-scroll container is required at any viewport. The Sprint 13A summary card's existing responsive behavior is preserved.

## 13. Performance

- Exactly one metadata read per mount (per-mount call count of 1 asserted by a targeted test).
- Exactly one summary-callable request per mount (asserted by Sprint 13A's own tests, preserved because the card is mounted unchanged).
- No recipients read. No attempts read. No sessions read. No enrollments read.
- No polling. No real-time listener. No client-side caching beyond the platform-standard callable behavior.

## 14. Files Created

- `app/src/assignments/detail/types.ts` (client-side shape and metadata-reader seam).
- `app/src/assignments/detail/detail.ts` (Assignment Detail DOM builder).
- `app/src/assignments/detail/registry.ts` (session-scoped in-memory metadata registry).
- `app/src/assignments/detail/wire.ts` (entry-point metadata-reader wire).
- `app/src/assignments/detail/detail.test.ts` (targeted UI test suite; 21 tests).
- `docs/platform/SPRINT_13B_COMPLETION_REPORT.md` (this document).

## 15. Files Modified

- `app/src/index.ts` (per-session wiring of `assignmentDetailRegistry`, entry-point `openAssignmentDetail`, and registry clearing on non-teacher bootstrap outcomes).
- `docs/platform/SPRINT_HISTORY.md` (Sprint 13B entry).

## 16. Files Explicitly Not Modified

- No file under `platform/functions/**`.
- No Firestore Security Rules file.
- No `firestore.indexes.json`.
- No LMS integration file.
- No callable contract, response allowlist, or schema.
- No file under `app/src/shell/**`. The shell tree's no-firebase-import invariant and the permanent four-item navigation are preserved.
- No file under `app/src/router/**`.
- No Sprint 13A file. The certified summary card is composed by import, not modified.

Verified via `git status`: the only Sprint 13B additions are `app/src/assignments/detail/**`, and the only Sprint 13B modification to platform source is `app/src/index.ts`.

## 17. Tests Added

21 tests grouped as:

- Loading (3): spinner renders on mount; spinner disappears after metadata resolves; summary card renders its own loading state while metadata is present.
- Success rendering (3): title, class, and status render; the Sprint 13A summary card is mounted exactly once; draft and closed statuses map to distinct visible labels.
- Navigation (3): Back button renders when `onBack` is provided and fires on click; Back button is omitted when `onBack` is not provided; opening a second detail after a return re-invokes both readers per open.
- Empty (3): empty state renders when the reader resolves with `null`; empty state never mounts the summary card and never invokes the summary callable; empty state never exposes forbidden vocabulary.
- Error (4): error alert renders on rejection; retry re-invokes the reader and recovers on success; rejection messages never leak to the DOM; summary-callable failures surface via the card's error state without erasing the header.
- Confidentiality (1): forbidden identifiers absent across all rendered subtrees.
- Accessibility (2): stable headline id referenced by `aria-labelledby`; empty and error states announce via the correct roles.
- Request posture (2): metadata reader is called exactly once per mount; source module opens no firebase imports, listeners, or browser storage.

## 18. Validation Results

### 18.1 Sprint 13B implementation validation

- Targeted Sprint 13B UI tests: 21 of 21 passed.
- Cloud Functions regression: 38 suites, 861 of 861 tests passed.
- Lint: passed.
- Typecheck (`tsc --noEmit`): passed.
- Production build (`esbuild`): passed. Output `dist/bundle.js` (additive Sprint 13B wire only; certified surfaces unchanged).
- Backend files unchanged: confirmed via `git status platform`.
- Firestore Rules unchanged: no file under `platform/**` or `firestore.rules`-equivalent was modified.
- Callable contracts unchanged: no file under `app/src/settings/integrations/**` or `app/src/assignments/summary/**` was modified.
- Only intended UI files changed: `app/src/index.ts` and the new `app/src/assignments/detail/**` module.
- Em dashes across created or modified documentation: zero. Verified by `grep --` across `docs/platform/SPRINT_13B_COMPLETION_REPORT.md` and the Sprint 13B section of `docs/platform/SPRINT_HISTORY.md`.
- No deployment.
- No commit.

### 18.2 Repository baseline validation

- Full app test suite: 296 tests passed, 1 test failed.
- Failing test, exactly as observed:

    ```text
    curriculum/curriculumManifest.test.ts
    ```

- The failure reproduces outside Sprint 13B on the pre-sprint baseline (identical failure recorded in Sprint 13A's completion report).
- The failure is unrelated to any Sprint 13B files.
- Sprint 13B did not modify curriculum manifests.
- Sprint 13B did not modify curriculum generation.
- Sprint 13B did not modify build tooling.
- No further speculation about the cause is offered beyond this observed evidence.

## 19. Findings

### Blocking

None.

### Non-blocking observations

- The Sprint 13B `openAssignmentDetail` opener is wired at the entry point and is directly invocable from that scope, but no in-shell affordance yet triggers it inside the four-item Teacher Workspace navigation. The bounded scope of Sprint 13B (a presentation-layer detail surface that composes the certified Sprint 13A card) does not include a redesign of any existing workspace surface, and the certified assignment lifecycle does not yet expose a client-visible persistent assignment enumeration to hang an affordance from. A follow-up sprint should introduce that enumeration and attach a lightweight "View summary" affordance from an already-assigned lesson card in the Curriculum surface.
- The pre-existing curriculum manifest drift failure noted in section 18.2 is unrelated to Sprint 13B. It should be addressed in an unrelated hardening slice (`npm run curriculum:build` inside `app/`).

## 20. Recommended Next Bounded Slice

**Sprint 13C: Assigned-Lesson Opener + Session Registry Population.**

- Introduce the smallest bounded modification to the Curriculum surface that persists minted assignment metadata into the Sprint 13B `assignmentDetailRegistry` after `assignmentsPublish` succeeds, so the "View summary" opener has real data to resolve.
- Attach one "View summary" secondary affordance on already-assigned lesson cards. Clicking it invokes the entry-point `openAssignmentDetail(assignmentId)` wired in Sprint 13B.
- Preserve the four-item Teacher Workspace navigation. Do not introduce a new workspace surface, drill-down, per-student analytics, or editing controls.

## 21. Confirmations

- No backend, Firestore Rules, callable contract, LMS integration, deployment, schema, or configuration change occurred.
- No commit was made.

## 22. Certification

CONDITIONALLY CERTIFIED: Sprint 13B implementation is complete. Final certification requires resolution or formal acceptance of the pre-existing repository baseline test failure.

## 23. Remediation - Visible Entry-Path Integration (2026-07-17)

### 23.1 Why the original implementation was incomplete

Sprint 13B introduced the Assignment Detail surface, the session-scoped registry, the entry-point metadata wire, and the `openAssignmentDetail(assignmentId)` opener, but no visible teacher-facing control invoked that opener. The certified four-item Teacher Workspace navigation offered no path to the detail surface, and the assignment publication flow did not populate the registry with the metadata that the opener resolves against. Consequently the required user path (publish an assignment, then reach its detail surface through the UI) could not be completed by an authenticated teacher.

### 23.2 Assignment ID capture

The Assignment Dialog already mints and passes a canonical `assignmentId` per (teacher, lesson, class, dialog-open) tuple through `assignmentsCreateDraft` and `assignmentsPublish`. The remediation consumes that same identifier immediately after the certified `assignmentsPublish` call resolves successfully; no new callable is invoked, no field is synthesized, and no Firestore read is issued. If the publish call throws, no capture occurs.

### 23.3 Registry population

After each successful per-class publish the Curriculum surface calls the injected `assignmentDetail.register(metadata)` seam with exactly the four fields already required by the Sprint 13B registry contract: `assignmentId`, `title`, `className`, `status: "published"`. No recipient, student, attempt, session, score, or ownership field is stored. Failed publications register nothing.

### 23.4 View summary affordance

Each already-assigned lesson card renders one additional secondary action, a native `<button type="button">` labelled exactly `View summary` with `aria-label` `View summary for {lesson title}` and `data-testid` `lesson-view-summary-{slug}`. The control is only rendered when a valid assignment ID is registered for that card in the current active-teacher session AND the entry-point seam is wired. Before publication and on non-teacher sessions the control is absent. The existing `Preview`, activation toggle, and `Assign` controls are unchanged; the fifth workspace-navigation slot is not touched.

### 23.5 Navigation behavior

Selecting `View summary` invokes the entry-point `assignmentDetail.open(assignmentId)` seam, which is wired to `openAssignmentDetail(assignmentId)`. The certified detail surface renders. The certified `Back` control on the detail surface re-runs the Canonical Session Bootstrap so the teacher returns to the workspace shell in its default surface (Curriculum). The four-item Teacher Workspace navigation is unchanged.

### 23.6 Multiple-assignment behavior

Each lesson card stores its own most-recent published `assignmentId` in a UID-scoped, in-memory map keyed by lesson slug. One card cannot invoke another card's assignment. Publishing a second lesson does not overwrite the first lesson's entry. Re-rendering the Curriculum surface within the same active-teacher session preserves the affordances.

### 23.7 Registry lifecycle

The session-scoped registry created at bootstrap is cleared on any non-teacher bootstrap outcome, exactly as before. The remediation additionally scopes the lesson-slug to assignment-ID map by teacher UID so a same-tab teacher swap cannot leak the prior teacher's mapping. No persistence to `localStorage`, `sessionStorage`, IndexedDB, or Firestore is introduced.

### 23.8 Accessibility

The `View summary` control is a native `<button>` with a descriptive `aria-label`, is keyboard reachable through natural DOM order, adds no nested interactive control, and does not disturb the card's `<h3>` title. The certified `Back` control on the detail surface remains keyboard reachable. No new focus trap or heading level is introduced.

### 23.9 Responsive behavior

The control reuses the existing `.shell-lesson-actions` flex layout used by the certified `Preview`, activation, and `Assign` controls. It wraps cleanly at narrow widths without introducing horizontal scroll, new breakpoints, or new spacing tokens.

### 23.10 Tests added

Nine remediation tests in `app/src/shell/shell.test.ts` under `Assign Experience - Sprint 13B remediation`:

- `View summary` is absent before publication.
- Successful publish registers metadata and reveals `View summary` on the correct card, and the affordance is not attached to any other card.
- Clicking `View summary` invokes the entry-point opener exactly once with the correct `assignmentId`.
- Failed publish does not register anything and does not reveal `View summary`.
- Multiple published lessons each retain their own `View summary` that opens its own assignment (isolation).
- Curriculum re-render preserves `View summary` for the active session.
- `View summary` is absent when no `assignmentDetail` seam is wired.
- `_resetCurriculumSessionStateForTest` clears the session-scoped assignment-ID map (lifecycle proxy).
- The four-item Teacher Workspace navigation remains unchanged when the seam is wired.

### 23.11 Files modified in remediation

- `app/src/index.ts` (adds the `assignmentDetailSeam` and wires it through the route table).
- `app/src/router/surfaces/index.ts` (forwards `assignmentDetail` through `SurfaceDeps` with the same getter pattern as `integrations` and `assignments`).
- `app/src/shell/shell.ts` (forwards `assignmentDetail` on `ShellDeps` and into the workspace deps object).
- `app/src/shell/surfaces/workspace.ts` (forwards `assignmentDetail` on `WorkspaceDeps` and into `renderCurriculumSurface`).
- `app/src/shell/surfaces/curriculum.ts` (records the seam on `CurriculumSurfaceDeps`, populates the registry after successful publish, renders the visible `View summary` affordance, and clears the map in the test-only reset helper).
- `app/src/shell/shell.test.ts` (adds nine remediation tests).
- `docs/platform/SPRINT_13B_COMPLETION_REPORT.md` (this remediation section).
- `docs/platform/SPRINT_HISTORY.md` (remediation note).

No Cloud Functions file, Firestore Security Rules file, callable contract, LMS integration file, schema, index, dependency, or navigation-model file was modified.

### 23.12 Validation results

- Targeted Curriculum + Assign tests (`app/src/shell/shell.test.ts`): 132 of 132 passed, including all 9 new remediation tests.
- Targeted Assignment Detail tests (`app/src/assignments/detail/detail.test.ts`): 21 of 21 passed.
- Targeted Assignment Summary tests (`app/src/assignments/summary/card.test.ts`): all passed as part of the assignments suite.
- Full application test suite: 305 of 306 tests passed. The only failure is the pre-existing `curriculum/curriculumManifest.test.ts` baseline drift, reproduced identically outside the remediation. Not introduced by this remediation.
- Cloud Functions regression: 38 suites, 861 of 861 tests passed.
- Lint: passed.
- Typecheck (`tsc --noEmit`): passed.
- Production build (`esbuild`): passed. Output `dist/bundle.js` (additive wiring; certified surfaces unchanged).
- Em dashes across the modified documentation: zero.
- No deployment. No commit.

### 23.13 Updated certification

CONDITIONALLY CERTIFIED: Sprint 13B implementation is now functionally complete. An authenticated teacher can visibly select `View summary` on a published lesson card to open the Assignment Detail surface and return to the workspace shell. Final certification remains conditional only on resolution or formal acceptance of the pre-existing `curriculum/curriculumManifest.test.ts` baseline drift.

### 23.14 Recommended next bounded slice

Sprint 13C: Persistent Assignment Enumeration. Introduce a certified server-side reader that lists a teacher's published assignments so the Curriculum affordance is present across a full page reload (today's remediation is session-scoped by design). Preserve the four-item navigation; do not introduce per-student drill-down, editing, or archiving.

