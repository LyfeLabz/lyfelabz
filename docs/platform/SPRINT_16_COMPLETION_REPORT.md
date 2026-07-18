# Sprint 16 Completion Report: Teacher Monitoring Workflow Hardening

**Date:** 2026-07-18
**Status:** CERTIFIED against `SPRINT_16_IMPLEMENTATION_PLAN.md`. All seven slices are complete, the integrated teacher workflow is verified, and no unresolved Sprint 16 regression remains. The sole remaining app-suite failure is the unchanged curriculum-manifest baseline previously accepted in `SPRINT_13_FINAL_CERTIFICATION.md` §11 and does not limit Sprint 16 certification.
**Preservation notice:** No deployment. No commit was performed by this final slice.
**Companion documents:** `SPRINT_16_IMPLEMENTATION_PLAN.md`, `SPRINT_15_COMPLETION_REPORT.md`, `SPRINT_15_IMPLEMENTATION_PLAN.md`, `SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`, `SPRINT_13_FINAL_CERTIFICATION.md`, `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (§35 Sprint 15, §36 Sprint 16), `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `SPRINT_HISTORY.md`.

## 1. Executive Summary

Sprint 16 hardened the beta teacher monitoring workflow shipped by Sprint 15 into a reliable, efficient, accessible, and internally consistent integrated experience. The complete path `Curriculum -> Active assignment -> Assignment Detail -> Assignment Summary -> back to Curriculum` now reflects the current state of every published or closed assignment after every lifecycle action without duplicate reads, without stale snapshots, without silent count disagreement, and without an unnecessary re-bootstrap on Back.

Sprint 16 was client-only. Zero new callable, zero new Firestore field, zero new custom claim, zero Firestore Rules relaxation, zero composite index, zero schema change, zero LMS side effect, zero Google Classroom side effect, zero notification, zero browser persistence (`localStorage`, `sessionStorage`, `IndexedDB`), zero realtime listener, and zero polling was introduced. The four-item Teacher Workspace navigation (Curriculum, Classes, Present Mode, Settings), the session-scoped in-memory `assignmentDetailRegistry`, and the Sprint 12E Slice 1 aggregate-only confidentiality boundary are preserved.

## 2. Sprint Objective

Complete the teacher monitoring workflow so the Curriculum dashboard and Assignment Detail reflect the current state of every published assignment accurately, efficiently, and consistently across the full monitoring path. Preserve the Sprint 14 Beta Non-Goals. Confirm that Sprints 13 through 16 now form a reliable classroom-ready teacher workflow.

## 3. Slice-by-Slice Completion

### Slice 1: Dashboard refresh completeness

Implemented and shipped. `ActiveAssignmentsController.refresh(invalidate?)` accepts an optional `{ assignmentIds }` list that evicts those entries from the section-scoped `progressCache` before the next render pass; the render pass re-issues `assessmentAssignmentSummary` exactly once per invalidated card. Curriculum installs a stable per-tab `activeAssignmentsInvalidator(assignmentId)` seam on mount and clears it on unmount; `onStatusChange` fires the seam when Curriculum is the active surface. The Assignment Detail Back handler replaces the Sprint 15 full `rerun()` with a lighter `remountCurriculum()` path that re-invokes the Curriculum surface renderer against the existing, already-hydrated registry and callable set; a subsequent authentication transition (sign-out, teacher change) continues to invoke the full `rerun()`.

### Slice 2: Assignment Detail refresh consistency

Implemented and shipped. Introduced `DetailFetchCache` (`app/src/assignments/detail/fetch-cache.ts`), a per-`state.kind === "ready"` shared cache that memoizes exactly one in-flight or resolved value per `(callable, keyString)` pair. `renderAssignmentSummaryCard` accepts an optional `preloadedSummary` and renders directly from the injected value when present; `renderRosterPanel` and `renderQuestionSummaryPanel` share the same `assessmentAttemptsListForClass` and `assessmentAssignmentSummary` results through the cache. Cache invalidation happens on every state transition and on every lifecycle-action success (`performClose`, `performReopen`, `performPublish`). A rejected shared request is evicted so a subsequent retry issues a fresh call.

### Slice 3: Progress consistency audit

Implemented and shipped. Every count on the Assignment Detail surface is derived from exactly one authoritative `assessmentAssignmentSummary` snapshot per render, per §4.4 of the Sprint 14 specification. Group headers read `Submitted (summary.completedStudents)`, `In progress (summary.inProgressStudents)`, `Not started (summary.notStartedStudents)`. When the enumerated recipient set disagrees with `summary.totalStudents` or the summary counts disagree with themselves, the surface renders exactly the approved calm inline note beneath the roster via `role="status"` and `aria-live="polite"`: `Roster and summary are temporarily out of sync. The latest details will appear after refresh.` (approved copy in `app/src/assignments/detail/reconciliation.ts`). No red flag. No blocker. No reconciliation write.

### Slice 4: Teacher workflow polish

Implemented and shipped. Assignment Detail focuses the assignment title on the first successful ready render and does not steal focus on internal panel hydration or lifecycle rerenders. The Back control's accessible name is `Back to Curriculum`. The published-with-zero-recipients branch renders the persistent `Roster` heading plus the calm empty note `No students are assigned yet.` The Question Summary panel announces loading through `role="status"`. Curriculum scroll position is preserved across `Open assignment -> Back` via a teacher-scoped, session-scoped, safely clamped `curriculumScrollGuard`; a full bootstrap fallback remains available after any authentication transition.

### Slice 5: Performance review

Implemented and shipped. A single Assignment Detail render for a published assignment issues exactly one `assessmentAssignmentSummary`, one `assessmentAttemptsListForClass`, and one `assignmentsRecipientList` call per unique identity; per-representative-attempt `assessmentAttemptGetForTeacher` reads are shared across pending-state rerenders through the same `DetailFetchCache`. A lifecycle-triggered rerender (close, reopen, publish) invalidates the cache once and re-issues exactly one refresh per callable identity. A Detail Back navigation on the happy path invokes zero `bootstrapSession` calls and zero `assignmentsTeacherList` calls; the full `rerun()` continues to be invoked only when the auth state changes. Explicit test guards assert the reduced call counts so regressions are caught.

### Slice 6: Accessibility review

Implemented and shipped. Active Assignments region retains `role="region"` and `aria-label="Active assignments"`; each card now exposes a stable `role="group"` with `aria-labelledby` pointing at the card title id (rather than a hand-composed `aria-label` that could drift from copy). Assignment Detail Roster host exposes a persistent `<h3>Roster</h3>` that survives loading and error branches so the section landmark is stable; each group is wrapped in a labeled group with `aria-labelledby` referencing the `<h4>` group heading (count included in the accessible name). Assignment Detail Question Summary host exposes a persistent `<h3>Question results</h3>` across loading, deferred, and result branches. `Show closed` exposes checked state and an accessible label; hidden closed assignments are absent from the DOM when the toggle is off. No duplicate ids, empty accessible labels, positive `tabindex` values, or click-only non-interactive controls were introduced.

### Slice 7: End-to-end validation, reconciliation, and final certification

This report. One integrated regression test (`Sprint 16 Slice 7: integrated teacher monitoring workflow` in `app/src/shell/shell.test.ts`) exercises the complete workflow through the Curriculum + Active Assignments seams: initial published render with authoritative counts, invalidator-driven close, hidden closed card while `Show closed` is off, toggle reveal with the fresh Slice 3 counts, Slice 6 `aria-labelledby` verification, reopen back to Published with exactly one summary refresh, and a source-level forbidden-API sweep. Documentation is reconciled in this report, `SPRINT_HISTORY.md`, and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §36.

## 4. Final Integrated Teacher Workflow

Verified end-to-end through the Slice 1 through Slice 7 test corpus (existing 30+ Sprint 16 tests in `detail.test.ts` and `shell.test.ts`, plus the Slice 7 integrated regression):

1. Curriculum mount hydrates the session-scoped registry from `assignmentsTeacherList` (Sprint 13C, unchanged). Curriculum installs the per-assignment invalidator seam.
2. Teacher creates, edits, and publishes a draft through the certified Sprint 13 callables (`assignmentsCreateDraft`, `assignmentsUpdateDraft`, `assignmentsPublish`); each mutation calls `onStatusChange`, which re-registers the mutated record and fires the Slice 1 invalidator when Curriculum is the active surface.
3. The Active Assignments card renders with the authoritative Slice 3 progress line sourced from a single `assessmentAssignmentSummary` snapshot; ordering is `publishedAt` descending, `className` ascending, `title` ascending, `assignmentId` ascending (Sprint 15).
4. Teacher clicks `Open assignment`; `openAssignmentDetail` snapshots the current Curriculum scroll offset (Slice 4) and mounts Assignment Detail.
5. Assignment Detail focuses the title once (Slice 4). The shared `DetailFetchCache` (Slice 2) issues exactly one call per unique identity for Assignment Summary, Roster, and Question Summary (Slice 5). Roster group headers anchor to summary counts (Slice 3). Persistent `Roster` and `Question results` headings and labeled group regions expose stable landmarks (Slice 6).
6. If recipients and summary disagree, the calm synchronization note is announced through `role="status"` and does not block the roster list (Slice 3).
7. Teacher closes the assignment through `assignmentsClose` (Sprint 13D, unchanged). The Detail cache invalidates and re-issues exactly one refresh per callable identity (Slice 2 + Slice 5). `onStatusChange` fires the dashboard invalidator, which purges the affected card's progress cache; the closed card is hidden while `Show closed` is off (Slice 1 + Slice 4).
8. Teacher enables `Show closed`; the closed card surfaces with the fresh Slice 3 counts. No duplicate summary read is issued (Slice 5).
9. Teacher reopens through `assignmentsReopen` (Sprint 13E, unchanged); the card returns to the published set with exactly one dashboard refresh.
10. Teacher clicks `Back to Curriculum` (Slice 4 label). The lighter `remountCurriculum()` path re-renders Curriculum against the existing hydrated registry (Slice 1); authentication, Functions, integrations, and `assignmentsTeacherList` hydration are not repeated. Curriculum scroll position is restored (Slice 4).

## 5. Refresh and Synchronization Behavior

Locked and asserted by test:

- `assignmentsPublish`, `assignmentsClose`, `assignmentsReopen`, and `assignmentsUpdateDraft` invalidate the affected dashboard card's progress cache when Curriculum owns the mount, and re-issue exactly one `assessmentAssignmentSummary` read when the card renders. A hidden closed card issues no wasted read.
- Full refresh (`ActiveAssignmentsController.refresh()` with no argument) remains available as the fallback path and preserves the Sprint 15 prune-only behavior for entries still present in the registry.
- No polling, no realtime listener, no timer-driven refresh, no push, and no browser persistence was introduced.

## 6. Data-Source and Count Consistency

- Assignment-level counts (dashboard card and Assignment Summary card) are sourced exclusively from `assessmentAssignmentSummary` (Sprint 14 §4.4).
- Roster group headers remain anchored to the authoritative summary counts (`summary.completedStudents`, `summary.inProgressStudents`, `summary.notStartedStudents`). When the enumerated roster and aggregate snapshot differ, the interface preserves both factual views and displays only the approved calm synchronization note.
- Roster group memberships remain composed against the certified `assignmentsRecipientList` recipients and `assessmentAttemptsListForClass` representative-attempt selection per PDR-029a; every recipient appears in exactly one group.
- Named student information (recipient display names, submitted attempt display names) remains confined to Assignment Detail. The dashboard card projects only aggregate counts.

## 7. Performance Guarantees

Per Assignment Detail render for a published or closed assignment (test-guarded):

- One `assessmentAssignmentSummary` call per `assignmentId`.
- One `assessmentAttemptsListForClass` call per `classId`.
- One `assignmentsRecipientList` call per `assignmentId`.
- At most `MIN_QUESTION_SUMMARY_ATTEMPTS` (=3) `assessmentAttemptGetForTeacher` calls per representative attempt when the threshold is met; below the threshold, zero per-attempt fetches (Sprint 15 Slice 6, preserved).
- Concurrent consumers observe the same in-flight or resolved snapshot; pending-state rerenders do not cause duplicate reads.
- A lifecycle-success rerender invalidates the cache exactly once and refetches exactly once per callable identity.
- Back navigation on the happy path invokes zero `bootstrapSession` calls and zero `assignmentsTeacherList` calls; a full `rerun()` continues to run on authentication transitions.

## 8. Accessibility Results

Verified against the Sprint 16 test corpus:

- Active Assignments region: `role="region"`, `aria-label="Active assignments"`; card `role="group"` with `aria-labelledby` pointing at the visible title id.
- Assignment Detail: title focused once on the first successful ready render; internal hydration does not steal focus back; retry after error re-focuses the title on the next ready render.
- Back control: accessible name `Back to Curriculum`.
- Roster: persistent `Roster` heading survives loading and error branches; each group is a wrapped region with `aria-labelledby` referencing the `<h4>` heading; the group count is part of the accessible name.
- Question Summary: persistent `Question results` heading survives loading, deferred, and result branches; deferred message uses `role="status"` + `aria-live="polite"`; loading uses `role="status"`.
- `Show closed`: checked state exposed; accessible label `Show closed assignments`; hidden closed cards absent from the DOM when off.
- Heading hierarchy is coherent (`h2` section title, `h3` card and Detail section titles, `h4` roster group titles).
- No duplicate ids, empty accessible labels, positive `tabindex` values, or click-only non-interactive controls were introduced.
- No color is the sole carrier of information.
- Touch-target minimums are preserved through the canonical mobile stylesheet inherited by every surface.

## 9. Files Created

- `docs/platform/SPRINT_16_COMPLETION_REPORT.md` (this report).

Files created by Slices 1 through 6 (already committed on `main`):

- `app/src/assignments/detail/fetch-cache.ts` (Slice 2).
- `app/src/assignments/detail/fetch-cache.test.ts` (Slice 2).
- `app/src/assignments/detail/reconciliation.ts` (Slice 3).
- `app/src/assignments/detail/reconciliation.test.ts` (Slice 3).
- `app/src/shell/curriculumScrollGuard.ts` (Slice 4).
- `app/src/shell/curriculumScrollGuard.test.ts` (Slice 4).

## 10. Files Modified

Slice 7 (this slice):

- `app/src/shell/shell.test.ts` (appended one `Sprint 16 Slice 7: integrated teacher monitoring workflow` integrated regression test).
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (appended §36 Sprint 16 Reconciliations and a corresponding Change Log entry).
- `docs/platform/SPRINT_HISTORY.md` (appended Sprint 16 completion entry).

Files modified across Slices 1 through 6 (already committed on `main`):

- `app/src/index.ts` (Slice 1 lighter Back path, hoisted `remountCurriculum` and `activeAssignmentsInvalidator`; Slice 4 scroll guard).
- `app/src/shell/surfaces/curriculum.ts` (Slice 1 invalidator seam installation).
- `app/src/shell/surfaces/shared/activeAssignments.ts` (Slice 1 invalidator + targeted refresh; Slice 6 `aria-labelledby`).
- `app/src/shell/surfaces/shared/activeAssignments.test.ts` (Slice 1 + Slice 6 tests).
- `app/src/shell/shell.ts` (Slice 1 seam plumbing).
- `app/src/shell/shell.test.ts` (Slice 1 dashboard integration tests).
- `app/src/shell/surfaces/workspace.ts` (Slice 1 seam plumbing).
- `app/src/router/surfaces/index.ts` (Slice 1 seam plumbing).
- `app/src/assignments/detail/detail.ts` (Slices 2, 3, 4, 5, 6).
- `app/src/assignments/detail/detail.test.ts` (Slices 2 through 6 tests, appended).
- `app/src/assignments/detail/attempts-wire.ts` (Slice 5 shared fetch integration).
- `app/src/assignments/detail/hydrate.ts`, `roster-wire.ts`, `roster.ts`, `roster.test.ts`, `question-summary.ts`, `question-summary.test.ts`, `types.ts` (fetch-cache and reconciliation integration).

No backend file was modified by any Sprint 16 slice.

## 11. Tests Executed

- App full suite (`npm test` in `app/`): 507 of 508 pass across 22 suites. The sole remaining failure is the pre-existing `curriculum/curriculumManifest.test.ts` baseline drift documented in `SPRINT_13_FINAL_CERTIFICATION.md` §11.
- App typecheck (`npm run typecheck` in `app/`): pass (zero errors).
- App lint (`npm run lint` in `app/`): pass (zero errors).
- App build (`npm run build` in `app/`): pass (esbuild bundle produced).
- Cloud Functions suite: not re-run in Sprint 16 because no backend file was modified across any Sprint 16 slice. Sprint 15's certified backend baseline (907 of 907 passing across 40 suites) remains authoritative per `SPRINT_15_COMPLETION_REPORT.md` §7.

## 12. Validation Matrix

| Check | Result |
| --- | --- |
| App Jest suite | 507 / 508 (accepted baseline) |
| App typecheck | Pass |
| App lint | Pass |
| App production build | Pass |
| Cloud Functions suite | Not re-run (no backend delta this sprint) |
| Backend files modified in Sprint 16 | None |
| Callables added in Sprint 16 | None |
| Firestore fields added in Sprint 16 | None |
| Firestore Rules relaxations in Sprint 16 | None |
| Composite indexes added in Sprint 16 | None |
| `onSnapshot` introduced | None |
| Polling introduced | None |
| Refresh timers introduced | None |
| `localStorage` / `sessionStorage` / `IndexedDB` introduced | None |
| LMS / Google Classroom side effects introduced | None |
| Notifications introduced | None |
| Em dashes across Sprint 16 files | Zero |
| Terminology sweep (`at risk`, `needs attention`, engagement score, ranking, AI recommendation, cross-assignment trend copy) | Pass |
| Documentation link validity for changed docs | Pass |
| Deployment performed | None |
| Commit performed by Slice 7 | None |

## 13. Known Accepted Baseline Issues

`app/src/curriculum/curriculumManifest.test.ts` continues to report `Curriculum manifest drift detected between root index.html and app/src/curriculum/curriculum.manifest.json.` This is the same signature previously accepted in `SPRINT_13_FINAL_CERTIFICATION.md` §11. Sprint 16 did not worsen it and did not attempt to fix it, because it is unrelated to Sprint 16 scope and blocking neither publication nor verification of any Sprint 16 slice. It remains the sole outstanding app-suite failure.

## 14. Remaining Work

None within Sprint 16 scope. Every slice defined in `SPRINT_16_IMPLEMENTATION_PLAN.md` §4 has shipped and is exercised by at least one automated test.

Deferred items (out of Sprint 16 scope, unchanged from Sprint 15):

- Persistent rollup materialization (`assignmentRollups`, `attemptRollups`) remains deferred under PDR-029n and `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md`.
- Per-student session presence beyond the arithmetic split remains deferred; the `In progress` naming is a documented Sprint 15 limitation and is superseded only by a future per-student session-presence signal.
- Every item enumerated in Sprint 14 §7 Beta Non-Goals remains out of scope.

## 15. Certification Statement

Sprint 16 is CERTIFIED against `SPRINT_16_IMPLEMENTATION_PLAN.md`. All seven slices are complete, the integrated teacher workflow is verified, and no unresolved Sprint 16 regression remains. Every slice defined in the plan has shipped, is internally consistent with Sprints 13, 14, and 15, is exercised by automated tests, and preserves the Sprint 12E Slice 1 aggregate-only confidentiality boundary, the four-item Teacher Workspace navigation, the session-scoped `assignmentDetailRegistry`, and the reload-hydration path through `assignmentsTeacherList`. Refresh, caching, count consistency, navigation, focus, performance, and accessibility are all verified.

Sprint 16 certified: yes. The previously accepted curriculum-manifest baseline remains documented but is not a Sprint 16 certification condition. The sole remaining app-suite failure is the unchanged `curriculum/curriculumManifest.test.ts` baseline previously accepted in `SPRINT_13_FINAL_CERTIFICATION.md` §11; Sprint 16 did not modify or worsen it, and it does not limit Sprint 16 certification.

No backend code changed in Sprint 16. No deployment occurred. No commit was performed by this final slice.
