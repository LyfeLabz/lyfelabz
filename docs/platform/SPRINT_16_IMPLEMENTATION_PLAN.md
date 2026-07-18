# Sprint 16: Teacher Monitoring Workflow Implementation Plan

**Date:** 2026-07-18
**Status:** Ready for implementation. Grounded in `SPRINT_15_COMPLETION_REPORT.md`, `SPRINT_15_IMPLEMENTATION_PLAN.md`, `SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`, and the Sprint 15 code shipped to the working tree.
**Companion documents:** `SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`, `SPRINT_15_IMPLEMENTATION_PLAN.md`, `SPRINT_15_COMPLETION_REPORT.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md` (Platform Posture), `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `SPRINT_HISTORY.md`.

## 1. Sprint Objective

Complete the teacher monitoring workflow so the Curriculum dashboard and Assignment Detail reflect the current state of every published assignment accurately, efficiently, and consistently across the complete monitoring path:

`Curriculum -> Active assignment -> Assignment Detail -> Assignment Summary -> back to Curriculum`

No redesign. No new instructional or analytics surface. No AI. No inference. Every displayed value continues to trace to stored assignment, session, attempt, or submission data per Sprint 14 §4.4.

Sprint 16 hardens what Sprint 15 shipped. It does not extend the Attention Model, does not modify the assignment lifecycle, and does not widen the four-item Teacher Workspace navigation.

## 2. Invariants Preserved by Every Slice

A slice that would break any of the following is rejected and re-scoped.

- Four-item Teacher Workspace navigation (Curriculum, Classes, Present Mode, Settings).
- Curriculum remains the primary landing surface.
- Session-scoped in-memory `assignmentDetailRegistry` remains the single visible catalog of teacher-owned assignments. Every mutation continues to route through `onStatusChange`.
- `assignmentsTeacherList` remains the single reload-hydration path. `assessmentAssignmentSummary` remains the single per-assignment aggregate source. `assessmentAttemptsListForClass` remains the single per-attempt list source. `assignmentsRecipientList` remains the single recipient enumeration source.
- Sprint 12E Slice 1 aggregate-only confidentiality boundary is preserved. The recipient enumeration authorized under PDR-029o is not extended into aggregate analytics.
- No new callable. No new Firestore field. No new custom claim. No composite index. No Firestore Rules relaxation. No LMS or Google Classroom side effect. No notification. No `localStorage`, `sessionStorage`, `IndexedDB`, realtime listener, or polling.
- Sprint 14 §7 Beta Non-Goals continue to apply. No `at risk`, no `needs attention`, no engagement score, no ranking, no AI recommendation, no cross-assignment trend copy, no time-on-task.
- Zero em dashes across every new or modified file.

## 3. Repository Findings (Sprint 15 Baseline Audit)

Read against the current working tree, not memory.

### 3.1 Refresh paths already in place

- Curriculum -> Assign dialog -> publish, close, reopen, or draft edit invokes `activeAssignmentsController?.refresh()` through the `onConfirm` and `onLifecycleComplete` seams on `curriculum.ts:534` and `curriculum.ts:539`. Confirmed.
- Assignment Detail lifecycle actions (`performClose`, `performReopen`, `performPublish`, draft `performEditSave`) update `state.metadata` locally, call `deps.onStatusChange`, and `rerender()`. `rerender` re-composes `renderAssignmentSummaryCard`, `renderRosterPanel`, and `renderQuestionSummaryPanel`, each of which re-issues its own callable(s). Confirmed.
- `openAssignmentDetail` back navigation invokes `rerun()` in `index.ts:130-132`, which re-bootstraps the entire teacher session (auth, Functions, integrations, and a full `assignmentsTeacherList` re-hydration). Confirmed. This is heavier than needed for a Back click and is one of the workflow-polish targets in Slice 4.
- Active Assignments section owns a per-assignment `progressCache: Map<assignmentId, ProgressCacheEntry>`. `activeAssignmentsController.refresh()` prunes cache entries for assignments no longer in the registry but preserves cache entries for assignments still present (`activeAssignments.ts:212-218`). Confirmed. That preserves counts across a re-render but never re-fetches after a student submission during the session.

### 3.2 Consistency gaps

- The Assignment Summary card and the Roster panel each issue their own independent call to `assessmentAssignmentSummary` for the same `assignmentId` on the same Detail render (`detail.ts:849`, `detail.ts:924`). Two separate summary reads can return two different snapshots.
- The Roster panel and the Question Summary panel each issue their own independent call to `assessmentAttemptsListForClass` for the same `classId` on the same Detail render (`detail.ts:923`, `detail.ts:1060`). Two separate attempts reads can return two different snapshots.
- `groupRoster` derives `inProgress` and `notStarted` by taking `remaining` recipients (recipient set minus representative-attempt set) and slicing the first `min(summary.inProgressStudents, remaining.length)` alphabetically as `In progress`. When `summary.completedStudents` and `|representative|` disagree, or when `summary.inProgressStudents + summary.completedStudents + summary.notStartedStudents` does not equal `summary.totalStudents`, group counts on the Detail roster can disagree with the Assignment Summary card counts on the same page.
- Neither the Assignment Summary card nor the Roster panel exposes a shared, single-fetch summary result to the Detail surface. The dashboard card's progress line uses its own summary snapshot and cannot align with the Detail Summary card except by coincidence.

### 3.3 Performance gaps

Per Detail render for a published or closed assignment (measured against the current working tree):

- Two `assessmentAssignmentSummary` calls per assignmentId.
- Two `assessmentAttemptsListForClass` calls per classId.
- One `assignmentsRecipientList` call per assignmentId.
- `MIN_QUESTION_SUMMARY_ATTEMPTS` (=3) `assessmentAttemptGetForTeacher` calls per representative attempt at threshold.
- `openAssignmentDetail` back navigation triggers a full `rerun()` -> `bootstrapSession` -> `hydrateAssignmentDetailRegistry` cycle. Cost is one full authoritative registry re-hydration on every Back.

### 3.4 Accessibility signals in place

- Section-level `role="region"` with `aria-label="Active assignments"` on the dashboard section (`activeAssignments.ts:89-90`).
- Card-level `role="group"` with card-title-plus-class `aria-label` on each card (`activeAssignments.ts:231-235`).
- Progress line uses `aria-live="polite"` while loading and `aria-label` on the composed count line (`activeAssignments.ts:280`, `activeAssignments.ts:288`).
- Detail roster loading uses `role="status"` and `aria-live="polite"`; error uses `role="alert"` (`detail.ts:903-904`, `detail.ts:936`).
- Detail Question Summary deferred message uses `role="status"` with `aria-live="polite"` (`detail.ts:1097-1098`).
- Curriculum welcome heading is `tabindex=-1` and receives focus on mount (`curriculum.ts:367`, `curriculum.ts:374`).

### 3.5 Accessibility gaps

- Assignment Detail does not focus the assignment title on mount. A teacher who tabs into the surface starts from the Back button.
- Detail roster groups use `<h4>` headings with `role="group"` intended semantics; the wrapping `div` has no `role`, no `aria-label`, and no `aria-labelledby` pointing to the group heading. Screen readers do not announce the group boundary.
- Detail roster loading and error branches replace the entire host contents, so the initial `Roster` `<h3>` heading is removed after the async settle. Screen readers lose the section landmark.
- Detail question-summary list items expose `q.itemId` as the prompt (`detail.ts:1132`). The stored prompt should be preferred when available; otherwise it should be clearly labeled as an identifier.
- Empty rendering path for a published assignment with zero recipients renders the Summary card but not a roster group section, so a teacher sees no explicit "no students yet" acknowledgement.

### 3.6 Terminology and copy

The following strings ship today. Sprint 16 preserves each verbatim.

- Section title: `Active assignments`.
- Toggle: `Show closed`.
- Progress line format: `${completedStudents} submitted / ${completedStudents + inProgressStudents} started / ${totalStudents} total`.
- Progress loading: `Loading progress...`.
- Progress error: `Progress temporarily unavailable`.
- Roster heading: `Roster`; groups: `Submitted`, `In progress`, `Not started`.
- Roster loading: `Loading roster...`; error: `Roster temporarily unavailable`.
- Roster empty group: `No students in this group.`.
- Question panel below-threshold: `Question-level results will appear after more students submit.`.
- Question panel error: `Question results temporarily unavailable`.

Sprint 16 does not rename any of the above. Terminology remains identical to Sprint 15.

## 4. Slice Sequence

Seven slices. Each slice is independently landable, independently testable, and independently revertable. A slice that would silently expand scope is rejected and re-scoped before it lands.

Slices land in numerical order. A later slice may be paused without regressing an earlier slice.

---

### Slice 1: Dashboard refresh completeness

**Sprint goal alignment.** Ensure the Active Assignments section reflects the current assignment state after publish, close, reopen, student submission, and assignment updates without requiring manual navigation.

**Findings addressed.** §3.1 and §3.3. Dashboard progress line is cached for the section lifetime and never re-issues a summary read while the teacher stays on Curriculum. A round trip through Detail always causes a full `rerun()` on Back, so cached counts are refreshed by side effect, but the cost is one full registry re-hydration on every Back click.

**Scope.**

1. In `activeAssignments.ts`, `ActiveAssignmentsController.refresh()` gains an optional signature `refresh(invalidate?: { assignmentIds?: ReadonlyArray<string> } )`. Passing an `assignmentIds` list evicts those entries from `progressCache` before the render pass so the next render re-issues the summary call for exactly those assignments. Passing nothing preserves current behavior (already stable in Sprint 15).
2. In `curriculum.ts`, the `openAssignDialog` `onConfirm` and `onLifecycleComplete` seams pass the mutated `assignmentId` to `activeAssignmentsController?.refresh({ assignmentIds: [assignmentId] })` so a publish, close, reopen, or draft edit invalidates that card's progress cache and re-fetches on the next render.
3. In `index.ts`, `onStatusChange` gains one additional side effect: it calls a new stable seam `activeAssignmentsInvalidator(assignmentId)` on the Curriculum surface when Curriculum is mounted. The seam is set by Curriculum on mount and cleared on unmount. When Curriculum is not the active surface, `onStatusChange` continues to only re-register the registry; the next Curriculum mount reads the fresh registry as today.
4. In `index.ts`, the Assignment Detail `onBack` handler replaces `rerun()` with a lighter `remountCurriculum()` path when the teacher session is unchanged. The lighter path clears the mount and re-invokes the Curriculum surface renderer against the existing, already-hydrated registry and callable set. Auth, Functions, and integrations are not re-bootstrapped. A future auth transition (sign out, sign in as a different teacher) continues to invoke the full `rerun()`.

**Explicitly out of scope.**

- No listener. No polling. No push. No callable extension. No new backend field.
- No visible refresh affordance on the section unless a slice-3 consistency finding requires it.

**Files likely affected.**

- `app/src/shell/surfaces/shared/activeAssignments.ts`
- `app/src/shell/surfaces/shared/activeAssignments.test.ts`
- `app/src/shell/surfaces/curriculum.ts`
- `app/src/shell/shell.test.ts`
- `app/src/index.ts`

**Tests.**

- Section refresh with `{ assignmentIds: [id] }` evicts and re-fetches only the specified card.
- Section refresh with no argument preserves the existing "prune-only" behavior.
- `onConfirm` for a fresh publish invalidates the summary cache for that assignmentId and re-renders with a new snapshot.
- Detail Back navigation reuses the hydrated registry (no `bootstrapSession` call) when the session is unchanged.

**Acceptance criteria.** Every lifecycle mutation that already reaches `onStatusChange` also invalidates the relevant dashboard card's progress cache; Back from Detail reaches Curriculum without a full re-bootstrap on the happy path; no new Firestore read is introduced beyond the summary re-issue for the specific invalidated cards.

---

### Slice 2: Assignment Detail refresh consistency

**Sprint goal alignment.** Ensure the roster grouping and factual summaries remain synchronized with live assignment state and prevent stale data on the same surface.

**Findings addressed.** §3.1 and §3.2. On close, reopen, or publish, `rerender()` re-composes the Summary card, Roster panel, and Question Summary panel, each of which re-fetches. The three fetches are not shared: the Summary card and the Roster panel each read `assessmentAssignmentSummary`; the Roster panel and the Question Summary panel each read `assessmentAttemptsListForClass`.

**Scope.**

1. Introduce a small per-render `DetailFetchCache` local to the Detail surface. It memoizes exactly one in-flight or resolved value per `(callable, keyString)` pair for the lifetime of the current `state.kind === "ready"` render. Cache invalidation happens on every `state` transition and on every lifecycle-action success (close, reopen, publish). No persistence.
2. `renderAssignmentSummaryCard` gains an optional `preloadedSummary?: AssignmentSummary` deps field. When present, the card renders directly from the injected value and does not issue its own callable. When absent, existing behavior is preserved. Called by Detail with the shared summary result.
3. `renderRosterPanel` and `renderQuestionSummaryPanel` accept the shared `attemptsListForClass` result from the `DetailFetchCache` instead of issuing their own read.
4. On a successful `performClose`, `performReopen`, or `performPublish`, the `DetailFetchCache` is invalidated before `rerender()` runs so the recomposed sub-surfaces observe fresh values.

**Explicitly out of scope.**

- No new sub-surface, no drill-down, no per-student panel.
- No change to callable contracts.

**Files likely affected.**

- `app/src/assignments/detail/detail.ts`
- `app/src/assignments/detail/detail.test.ts`
- `app/src/assignments/summary/card.ts`

**Tests.**

- One Detail render results in exactly one `assessmentAssignmentSummary` call and exactly one `assessmentAttemptsListForClass` call for the same identity.
- Close, reopen, and publish invalidate the cache and trigger exactly one refresh per callable, not two.
- Failure of one shared callable does not silently render a stale value on the sibling panel.

**Acceptance criteria.** Duplicate reads are removed on the same render; state transitions invalidate cleanly; no sub-surface renders a value that came from a snapshot older than the current `state.kind === "ready"` transition.

---

### Slice 3: Progress consistency audit

**Sprint goal alignment.** Verify every displayed count originates from the same authoritative source. Dashboard, Assignment Summary card, and Assignment Detail must not disagree after normal operations.

**Findings addressed.** §3.2. Group counts on the Detail roster can disagree with Assignment Summary counts when `summary.inProgressStudents + summary.completedStudents + summary.notStartedStudents != summary.totalStudents`, or when the recipient set count disagrees with `summary.totalStudents`.

**Scope.**

1. Every count on the Assignment Detail surface is derived from exactly one authoritative source per §4.4 of Sprint 14:
   - `Submitted` group count is `summary.completedStudents`. The rendered list is filtered from representative attempts of recipients only, but the header count comes from summary.
   - `In progress` group count is `summary.inProgressStudents`.
   - `Not started` group count is `summary.notStartedStudents`.
   - Total header count and Summary card counts remain unchanged (they already read from summary).
2. When `|recipients| != summary.totalStudents`, the surface renders the summary total in the group headers but reveals the discrepancy as a calm inline note beneath the roster: `Roster and summary temporarily unaligned. Reopen this assignment to refresh.` Note is `role="status"` and `aria-live="polite"`. No red flag. No blocker.
3. Dashboard card progress line remains `${completedStudents} submitted / ${completedStudents + inProgressStudents} started / ${totalStudents} total`, all three sourced from the same `AssignmentSummary` snapshot. No change to the copy.
4. Every group header displays `Label (count)` where `count` is the summary-derived count above. The rendered list within a group may be shorter than the count when recipient enumeration lags summary; the roster shows every enumerated recipient row and the discrepancy note handles the difference.

**Explicitly out of scope.**

- No new callable, no new field, no reconciliation write. The discrepancy note is calm surfacing, not a fix.
- Naming students as `In progress` versus `Not started` remains outside Sprint 16 scope; the arithmetic split is a Sprint 15 documented behavior and is superseded only by a future per-student session-presence signal.

**Files likely affected.**

- `app/src/assignments/detail/detail.ts`
- `app/src/assignments/detail/roster.ts` (documentation only if the pure grouping helper does not require code change)
- `app/src/assignments/detail/detail.test.ts`

**Tests.**

- Group header counts equal summary counts exactly under aligned and misaligned inputs.
- Discrepancy note renders only when `|recipients| != summary.totalStudents` and never blocks the roster list.
- No count on the dashboard card ever disagrees with the Summary card when both are rendered against the same in-flight summary snapshot in the same session.

**Acceptance criteria.** Every count on Curriculum, Assignment Summary, and Assignment Detail traces to exactly one summary snapshot per render; the discrepancy note is calm, informative, and never carries a call-to-action beyond `Reopen this assignment to refresh.`

---

### Slice 4: Teacher workflow polish

**Sprint goal alignment.** Review the complete `Curriculum -> Active assignment -> Assignment Detail -> Assignment Summary -> back to Curriculum` workflow. Reduce unnecessary clicks. Improve loading transitions and empty states. Preserve the interface.

**Findings addressed.** §3.4 and §3.5.

**Scope.**

1. Assignment Detail focuses the assignment title on mount so keyboard-only teachers land inside the surface content, not on Back.
2. Loading transitions are unified across `renderRosterPanel` and `renderQuestionSummaryPanel`: both use the existing spinner utility class and the same loading copy pattern (`Loading roster...`, `Loading question results...`). No new copy is introduced beyond `Loading question results...` for the question panel, which currently renders no loading string.
3. Empty states:
   - Published assignment with zero recipients: the roster host renders `Roster` heading, a single-line calm note `No students are assigned yet.`, and no group section. Question panel remains silent below threshold.
   - Draft assignment: no roster and no question panel. Draft results panel already covers the empty case. No change.
   - Closed assignment with zero submissions: existing grouping renders `Submitted (0)` / `In progress (0)` / `Not started (N)` correctly. No change.
4. `Open assignment` on the dashboard card and `Back` on Detail both preserve scroll position on the Curriculum surface across the round trip. Implemented by snapshotting `window.scrollY` on `openAssignmentDetail` and restoring after Curriculum remounts.
5. `Back` label on Detail gains `aria-label="Back to Curriculum"` (currently `Back to previous workspace`), reflecting the actual navigation target of the lighter re-mount from Slice 1.

**Explicitly out of scope.**

- No new navigation item. No new setting. No dashboard configuration surface. No color change. No new icon. No new copy beyond `Loading question results...` and `No students are assigned yet.`
- No motion library. Loading remains the shipped spinner class.

**Files likely affected.**

- `app/src/assignments/detail/detail.ts`
- `app/src/index.ts` (scroll snapshot / restore)
- `app/src/assignments/detail/detail.test.ts`

**Tests.**

- Detail focuses the title on mount.
- Zero-recipient published assignment renders the empty-note.
- Scroll position is preserved across `Open assignment` -> `Back` round-trip.
- `Back` accessible label reads `Back to Curriculum`.

**Acceptance criteria.** Round trip requires no extra clicks; loading transitions read consistently across the four sub-surfaces; empty states are calm and factual; scroll position survives the round trip.

---

### Slice 5: Performance review

**Sprint goal alignment.** Audit and remove duplicate network calls, unnecessary hydration, and repeated Firestore reads. Optimize only where measurable. Do not prematurely optimize.

**Findings addressed.** §3.3.

**Scope.** Slice 2 removes the two duplicate reads inside a single Detail render. Slice 1 replaces the full `rerun()` on Back with a lighter re-mount. Slice 5 verifies both under integration test load and adds test guards.

1. Integration test: a full Detail render for a published assignment invokes each of `assessmentAssignmentSummary`, `assessmentAttemptsListForClass`, and `assignmentsRecipientList` exactly once per assignmentId or classId identity.
2. Integration test: a Detail Back navigation invokes zero `bootstrapSession` calls and zero `assignmentsTeacherList` calls on the happy path. It continues to invoke exactly one full `rerun()` when the auth state changes.
3. Above the question-summary threshold, per-representative-attempt `assessmentAttemptGetForTeacher` reads are cached for the surface lifetime so a subsequent lifecycle transition that keeps the roster stable does not re-fetch every attempt. Cache is invalidated on cache-invalidating events (close, reopen, publish) or on an explicit recipient-set change signaled by a next `assignmentsRecipientList` snapshot.
4. Firestore read count for a single monitoring session on a stable classroom (open Detail, wait, close, re-open Detail, back to Curriculum, re-open Detail): documented in the Sprint 16 completion report as the empirical count from the integration tests.

**Explicitly out of scope.**

- No microbenchmark. No performance library. No profiling harness beyond test counting.
- No caching that persists across a page reload.

**Files likely affected.**

- `app/src/assignments/detail/detail.ts`
- `app/src/assignments/detail/detail.test.ts`
- `app/src/shell/surfaces/shared/activeAssignments.ts`
- `app/src/shell/surfaces/shared/activeAssignments.test.ts`

**Tests.**

- Duplicate call assertions (per Slice 2, verified end-to-end here).
- Back navigation call-count assertion.
- Question-summary attempt cache assertion.

**Acceptance criteria.** No slice-2 or slice-1 regression; no new Firestore read introduced by any Sprint 16 slice; the tests explicitly assert the reduced call counts so regressions are caught.

---

### Slice 6: Accessibility review

**Sprint goal alignment.** Verify keyboard navigation, screen reader labels, focus management, loading announcements, empty states, and semantic structure across the complete teacher workflow.

**Findings addressed.** §3.4 and §3.5.

**Scope.**

1. Curriculum `Active assignments` region:
   - Retain `role="region"` and `aria-label="Active assignments"`.
   - Card `role="group"` gains `aria-labelledby` pointing to the card title id so the group announces its own name rather than a computed composite `aria-label`.
   - `Open assignment` button already reads its own accessible label; verify it renders as a genuine `button`.
2. Assignment Detail:
   - Focus the title on mount (Slice 4 already introduces this).
   - Back button `aria-label` reads `Back to Curriculum` (Slice 4).
3. Assignment Detail Roster:
   - The roster host wraps a persistent `<h3>Roster</h3>` that survives the loading and error branches so the section landmark is stable.
   - Each group is a `<section>` (or `<div role="group">`) with `aria-labelledby` referencing the `<h4>` group heading. Group counts render as part of the accessible name.
   - Loading uses `role="status"` and `aria-live="polite"`; error uses `role="alert"` (already correct).
4. Assignment Detail Question Summary:
   - The question panel host wraps a persistent `<h3>Question results</h3>` that survives the loading and threshold branches.
   - Below the threshold, the deferred message uses `role="status"` and `aria-live="polite"` (already correct).
   - Above the threshold, the question list is a semantic `<ol>` (already correct); each option list is a semantic `<ul>` (already correct); each correct-option marker is announced through text, not color.
5. Every affordance meets the shared touch-target minimum from the canonical mobile stylesheet. No color is the sole carrier of information.

**Explicitly out of scope.**

- No new heading level. No new landmark. No new modal.

**Files likely affected.**

- `app/src/assignments/detail/detail.ts`
- `app/src/shell/surfaces/shared/activeAssignments.ts`
- `app/src/assignments/detail/detail.test.ts`
- `app/src/shell/surfaces/shared/activeAssignments.test.ts`

**Tests.**

- Card group `aria-labelledby` references the card title id.
- Roster group `aria-labelledby` references the group heading id.
- Persistent `Roster` and `Question results` headings remain in the DOM across loading and error branches.
- Focus lands on the Detail title on mount.

**Acceptance criteria.** Every dashboard and Detail sub-surface passes semantic-structure and focus checks; no keyboard-only regression on the complete round trip; touch-target minimums preserved.

---

### Slice 7: End-to-end validation and documentation reconciliation

**Sprint goal alignment.** Perform the complete teacher scenario from create-draft through close-and-reopen and verify every step behaves consistently. Reconcile documentation.

**Scope.**

1. End-to-end test path (single test file):
   - Create draft -> Edit draft -> Publish -> Curriculum reflects the new `Published` card -> Open Detail -> Assignment Summary card renders -> Roster groups render with counts matching Summary -> Student submissions arrive (in-test seed) -> Detail state transitions through the roster and question-summary panels -> Close -> Detail lifecycle transitions -> Curriculum `Show closed` reveals the closed card -> Reopen -> Curriculum `Published` set updates -> Back to Curriculum on the lighter path.
2. Regression: existing full application suite continues green (except the pre-existing `curriculum/curriculumManifest.test.ts` baseline drift accepted in `SPRINT_13_FINAL_CERTIFICATION.md` §11).
3. Documentation:
   - `docs/platform/SPRINT_16_COMPLETION_REPORT.md`: written at slice close.
   - `docs/platform/SPRINT_HISTORY.md`: appended Sprint 16 entry.
   - `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`: no callable change; verify Appendix A is unchanged.
   - `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`: append a Sprint 16 Reconciliation section noting the shared per-render fetch cache and the summary-anchored group counts.
4. Terminology sweep against Sprint 14 §7 and Sprint 15 §Slice 7: no `at risk`, no `needs attention`, no engagement score, no ranking, no AI recommendation, no notification, no cross-assignment trend copy. No em dashes.

**Files likely affected.**

- `app/src/assignments/detail/detail.test.ts` (or a new dedicated e2e-style test module in the same directory)
- `docs/platform/SPRINT_16_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`

**Tests.**

- Full lifecycle path passes in a single integration test.
- Terminology sweep and em-dash sweep pass.
- Lint, typecheck, build pass in both `app/` and `platform/functions/`.

**Acceptance criteria.** Every Sprint 16 slice is exercised by at least one automated test; the pre-existing baseline failure remains the only outstanding suite failure; documentation is reconciled; no deployment; no commit unless explicitly requested.

## 5. Cross-Slice Guardrails

- Every callable read continues to route through `requireDistrictContext` and the canonical ownership plus school gate. No new callable is introduced.
- The Sprint 13B session-scoped `assignmentDetailRegistry` remains the sole in-memory catalog. The Slice 2 `DetailFetchCache` is attached to a single Detail render's `state.kind === "ready"` lifetime and does not persist across `state` transitions. The Slice 1 dashboard `progressCache` continues to be attached to the section's lifetime and is invalidated per-assignmentId on lifecycle events.
- No `localStorage`, `sessionStorage`, `IndexedDB`, realtime listener, or polling.
- No LMS side effect. No Google Classroom side effect. No notification.
- No copy language that ranks, predicts, or judges a student.

## 6. Testing Strategy Summary

- Unit tests for the `progressCache` invalidation seam, the `DetailFetchCache`, and the count-header derivation.
- Integration test for the Detail render call count (one per unique callable identity).
- Integration test for the Back navigation avoiding `rerun()` on the happy path.
- Accessibility unit tests for `aria-labelledby` wiring, persistent Roster and Question Results headings, and focus-on-mount for Detail title.
- End-to-end teacher-scenario test in Slice 7.

## 7. Documentation Reconciliation Plan

- `SPRINT_HISTORY.md`: appended Sprint 16 entry summarizing the delivered slices.
- `SPRINT_16_COMPLETION_REPORT.md`: written at Slice 7 close.
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`: Sprint 16 Reconciliation section noting the shared per-render fetch cache and summary-anchored group counts.
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`: no change (no callable added or modified).

## 8. Out of Scope

- Rollup materialization (`assignmentRollups`, `attemptRollups`) remains deferred under PDR-029n.
- Any dashboard configuration surface beyond the shipped `Show closed` toggle.
- Per-student session presence beyond the current arithmetic (`inProgress` naming remains a documented Sprint 15 limitation).
- "Most-missed question" ordering, `at risk` grouping, or any other inferred signal.
- Draft-assignment dashboard cards.
- Archive-assignment surfacing.
- LMS or Google Classroom side effects.
- Notifications of any kind.
- AI recommendations, next-step suggestions, or auto-generated feedback.
- Any change to the four-item Teacher Workspace navigation.
- Any change to Sprint 13 lifecycle behavior or Sprint 13A summary projection.

Every item in Sprint 14 §7 (Beta Non-Goals) is out of scope here.

## 9. Ready-to-Implement Checklist

Before Slice 1 begins:

- Sprint 15 is accepted (per `SPRINT_15_COMPLETION_REPORT.md`).
- The pre-existing `curriculum/curriculumManifest.test.ts` baseline drift continues to be accepted per `SPRINT_13_FINAL_CERTIFICATION.md` §11.
- The Sprint 16 slice sequence is agreed to as ordered; no slice is silently expanded during implementation.

If any of these is not true, Sprint 16 does not begin until it is.
