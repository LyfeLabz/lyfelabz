# Sprint 13A Completion Report: Teacher Assignment Summary UI Foundation

**Dates:** 2026-07-17
**Status:** Complete
**Preceding sprint:** Sprint 12E Slice 2C (assessmentAssignmentSummary migration to the canonical frozen recipient population).

## 1. Objective

Expose the certified `assessmentAssignmentSummary` callable inside the authenticated teacher client as a reusable presentation-layer foundation. No backend behavior is added, altered, or reinterpreted. The card renders exactly the ten aggregate fields returned by the callable and preserves the aggregate-only confidentiality boundary certified by Sprint 12E.

This sprint is scoped to the presentation-layer foundation. It does not introduce a new teacher navigation destination, an assignment-detail route, drill-down surfaces, roster views, filtering, sorting, exports, live updates, or any additional teacher analytics surface.

## 2. Certified Foundation Consumed Without Modification

- `assessmentAssignmentSummary` callable (Sprint 12E Slice 1, migrated Slice 2C).
- Frozen assignment recipient population at `assignments/{assignmentId}/recipients/{studentId}` (PDR-029, Sprint 12E Slice 2A).
- Representative-attempt tie-break policy including the ratified `completedAt` tie-breaker (PDR-029 section 6).
- Aggregate-only response allowlist (`SPRINT_12E_SLICE_1_COMPLETION_REPORT.md` section 15).
- Confidentiality exclusions (`SPRINT_12E_SLICE_1_COMPLETION_REPORT.md` section 16).
- Teacher authorization and district enforcement on the callable server-side.

No Cloud Functions code, Firestore Security Rules, callable contracts, LMS integration wiring, schema, or index configuration was changed.

## 3. Implementation Summary

### 3.1 Reusable Summary Card

`app/src/assignments/summary/card.ts` exports `renderAssignmentSummaryCard(mount, { callable, assignmentId })`. The card is a pure DOM builder that:

- Issues exactly one call to the injected `AssignmentSummaryCallable` on mount.
- Renders one of four states inside a single container: loading, success (metrics), empty, error.
- Never derives, aggregates, or recomputes. Every rendered value is the callable response value.
- Never imports from `firebase/*` and opens no listener. A posture test asserts the absence of `firebase/`, `httpsCallable(`, `onSnapshot(`, `localStorage`, and `sessionStorage` in `card.ts` and `types.ts`.

### 3.2 Callable Wire

`app/src/assignments/summary/wire.ts` exports `createAssignmentSummaryCallable(functions)` which returns an `AssignmentSummaryCallable`. It parses the response strictly against the ten allowlisted fields and throws on shape mismatch. This is the only module that imports from `firebase/functions`.

### 3.3 Client Types

`app/src/assignments/summary/types.ts` names exactly the ten aggregate fields returned by the certified callable and the injected `AssignmentSummaryCallable` seam. No forbidden identifier is named.

### 3.4 Entry-Point Wiring

`app/src/index.ts` constructs the callable through `createAssignmentSummaryCallable(functions)` inside the active-teacher branch of `rerun`. The reference is rebuilt per active-teacher session so no cross-session state can leak. The Sprint 13A wire is additive and does not modify the certified integrations, assignments-lifecycle, or route-table wiring.

## 4. UI Behavior

- The card renders a single `.shell-card` region with heading `Assignment Summary`, `role`-labeled via `aria-labelledby`.
- Nine metrics are rendered in a `<dl>` grid in the order specified by the sprint: Total Students, Completed, In Progress, Not Started, Completion, Average, Highest, Lowest, Perfect Scores.
- Counts are formatted with `Intl.NumberFormat("en-US")`. Percentages are suffixed with `%`.
- Null values for `averagePercentage`, `highestPercentage`, and `lowestPercentage` render as a placeholder character rather than as `null` or `NaN`.
- No student-level metric, no ranking, and no additional derived metric is rendered.

## 5. Loading Behavior

- On mount the card immediately renders a `role="status" aria-live="polite"` region containing the platform-standard `.shell-spinner` and the loading label `Loading assignment summary`.
- The container height is preserved via `.shell-assignment-summary` so no layout shift occurs when the state transitions to success, empty, or error.
- The loading indicator is removed once the callable resolves or rejects.

## 6. Empty-State Behavior

- Triggered by `totalStudents === 0`.
- Renders a friendly, student-facing sentence: `No students are assigned to this activity yet. The summary will appear once students are added.`
- Announced via `role="status" aria-live="polite"`.
- Never exposes implementation vocabulary such as `recipient`, `enrollment`, `roster`, `collection`, or `Firestore`. A regression test asserts absence of every forbidden vocabulary token.

## 7. Error Behavior

- Any rejection from the callable transitions to the error state.
- Renders a `role="alert"` region with the teacher-facing sentence: `We could not load this assignment summary right now. Try again in a moment.`
- A `Try again` button rebinds the load and clears the error state on success. Only one in-flight request per card is honored via a monotonic load token.
- Never exposes backend identifiers, error codes, stack traces, or Firestore surface vocabulary. A regression test seeds a rejection whose message contains `Firestore permission-denied at attempts/{attempt-42}` and asserts that no fragment of that message reaches the DOM.

## 8. Confidentiality Preservation

The card renders only the ten allowlisted aggregate fields from `SPRINT_12E_SLICE_1_COMPLETION_REPORT.md` section 15. A confidentiality regression test asserts that the rendered subtree never contains any of `studentId`, `student-id`, `recipientId`, `attemptId`, `sessionId`, `teacherId`, `districtId`, `schoolId`, `displayName`, `response`, `answerKey`, or `explanation`.

## 9. Refresh Behavior

- Exactly one callable request per mount is issued. A dedicated test asserts a per-mount call count of 1.
- The assignment identifier is a mount input. A second mount with a different `assignmentId` triggers exactly one additional request scoped to that assignment (test asserts the ordered call log `["assign-A", "assign-B"]`).
- No polling. No real-time listener. No client-side caching beyond the platform-standard callable behavior.

## 10. Performance

- Exactly one callable request per mount.
- No direct Firestore read.
- No attempt, session, recipient, or enrollment read from the client.
- The wire response parser is O(1) over the ten allowlisted fields.

## 11. Accessibility

- The card exposes an `aria-labelledby` reference to a real `<h3>` heading whose id is stable (`assignment-summary-headline`).
- Metrics are marked up as a `<dl>` with `<dt>` labels and `<dd>` values so screen readers announce label + value pairs.
- Loading and empty states are announced via `role="status" aria-live="polite"`.
- The error state is announced via `role="alert"`.
- The retry control is a native `<button type="button">` reachable via keyboard.
- No text color is introduced by the sprint; the card inherits the certified `.shell-card` design tokens.

## 12. Responsive Behavior

- The metric grid uses a `<dl>` container with the class `shell-assignment-summary-grid`, sized by the existing responsive tokens on `.shell-card`. No new breakpoint, spacing scale, or typography scale is introduced.
- No horizontal-scroll container is required at any viewport. Metrics stack cleanly.

## 13. Files Created

- `app/src/assignments/summary/types.ts` (client-side shape and callable seam).
- `app/src/assignments/summary/wire.ts` (certified callable wire; sole `firebase/functions` import).
- `app/src/assignments/summary/card.ts` (reusable DOM-builder card).
- `app/src/assignments/summary/card.test.ts` (targeted UI test suite; 18 tests).
- `docs/platform/SPRINT_13A_COMPLETION_REPORT.md`.

## 14. Files Modified

- `app/src/index.ts` (per-session wiring of `createAssignmentSummaryCallable`).
- `docs/platform/SPRINT_HISTORY.md` (Sprint 13A entry).

## 15. Files Explicitly Not Modified

- No file under `platform/functions/**`.
- No Firestore Security Rules file.
- No `firestore.indexes.json`.
- No LMS integration file.
- No file under `app/src/shell/**` (the shell tree's no-Firebase-import invariant is preserved).
- No callable contract, response allowlist, or schema.

Verified via `git status`: the only tracked additions are `app/src/assignments/**`, and the only modified tracked file inside the platform is `app/src/index.ts` and `docs/platform/**` documents produced by this sprint.

## 16. Tests Added

18 tests grouped as:

- Loading (2): spinner renders on mount; spinner disappears after resolve.
- Success (4): all nine metrics render; exact values render; zero counts render; null score metrics render as placeholder.
- Empty (2): empty-state message renders when `totalStudents === 0`; empty state never exposes recipient or Firestore vocabulary.
- Error (3): error state renders on rejection; retry re-invokes the callable and recovers; rejection message never leaks to the DOM.
- Confidentiality (1): forbidden identifiers absent across all rendered subtrees.
- Request behavior (2): exactly one call per mount; per-assignment isolation on separate mounts.
- Accessibility (2): heading and `aria-labelledby` present; loading and empty states announce via `aria-live=polite`.
- Posture (2): `card.ts` and `types.ts` import nothing from `firebase/*` and open no listener.

## 17. Validation Results

### 17.1 Sprint 13A implementation validation

- Targeted Sprint 13A UI tests: 18 of 18 passed.
- Cloud Functions regression: 38 suites, 861 of 861 tests passed.
- Lint: passed.
- Typecheck (`tsc --noEmit`): passed.
- Production build (`esbuild`): passed. Output `dist/bundle.js` (unchanged shape, additive wire only).
- Backend files unchanged: confirmed via `git status platform`.
- Firestore Rules unchanged: no file under `platform/**` or `firestore.rules`-equivalent was modified.
- Only intended UI files changed: `app/src/index.ts` and the new `app/src/assignments/summary/**` module.
- Em dashes across created or modified documentation: zero. Verified by `grep --` across `docs/platform/SPRINT_13A_COMPLETION_REPORT.md` and the Sprint 13A section of `docs/platform/SPRINT_HISTORY.md`.
- No deployment.
- No commit.

### 17.2 Repository baseline validation

- Full app test suite: 275 tests passed, 1 test failed.
- Failing test, exactly as observed:

    ```text
    curriculum/curriculumManifest.test.ts
    ```

- The failure reproduces outside Sprint 13A on the pre-sprint baseline.
- The failure is unrelated to any Sprint 13A files.
- Sprint 13A did not modify curriculum manifests.
- Sprint 13A did not modify curriculum generation.
- Sprint 13A did not modify build tooling.
- No further speculation about the cause is offered beyond this observed evidence.

## 18. Findings

### Blocking

None.

### Non-blocking observations

- The reusable card is a foundation. No teacher-facing assignment-detail page currently exists in the client to mount it into. Sprint 13B (recommended next slice) should introduce a bounded assignment-detail surface that consumes this card, together with the navigation seam that opens it. That work was deliberately deferred to avoid a scope creep that would alter the shell's workspace-navigation contract during this presentation-layer foundation sprint.
- The pre-existing curriculum manifest drift failure noted in section 17 is unrelated to Sprint 13A. It should be addressed in an unrelated hardening slice (`npm run curriculum:build` inside `app/`).

## 19. Recommended Next Bounded Slice

**Sprint 13B: Teacher Assignment Detail Surface.**

- Introduce a bounded assignment-detail surface reachable from an existing teacher navigation entry (either the Classes workspace roster row for a published assignment, or a lightweight `My Assignments` list). The surface's initial content is the Sprint 13A summary card, mounted with the certified callable seam.
- Preserve the current four-item Teacher Workspace navigation.
- Do not introduce drill-down, student roster, or per-student analytics; those remain owned by future sprints against the yet-to-be-introduced attempt-list and roster-progress callables.

## 20. Confirmations

- No backend, Firestore Rules, callable contract, LMS integration, deployment, or schema change occurred.
- No commit was made.

## 21. Certification

CONDITIONALLY CERTIFIED: Sprint 13A implementation is complete. Final certification requires resolution or formal acceptance of the pre-existing curriculumManifest test failure.
