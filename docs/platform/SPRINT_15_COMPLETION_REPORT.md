# Sprint 15 Completion Report

**Date:** 2026-07-18
**Status:** Complete. All seven slices shipped against the Sprint 14 specification.
**Companion documents:** `SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`, `SPRINT_15_IMPLEMENTATION_PLAN.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md` §7, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §35, `SPRINT_HISTORY.md` (Sprint 15 entry).

## 1. Executive Summary

Sprint 15 implemented the beta teacher dashboard defined by Sprint 14. The `Active assignments` region now renders at the top of the Curriculum surface when the signed-in teacher has one or more `published` assignments in the session-scoped registry, and the Assignment Detail surface gains a roster grouped by progress state (`Submitted`, `In progress`, `Not started`) and a per-question factual summary panel above the minimum-attempt threshold. The four-item Teacher Workspace navigation, the session-scoped in-memory `assignmentDetailRegistry`, and the Sprint 12E Slice 1 aggregate-only confidentiality boundary are all preserved.

The sprint introduced exactly one new callable (`assignmentsRecipientList`, authorized under PDR-029o) and one additive backend field (`publishedAt` on `AssignmentRecord`, projected through `assignmentsTeacherList`). No new lifecycle field, no new custom claim, no new Firestore collection, no Firestore Rules relaxation, no composite index, no LMS or Google Classroom side effect, no notification, no browser persistence, no realtime listener, and no polling was introduced. Zero em dashes across every new or modified file.

## 2. Slice-by-Slice Implementation Summary

### Slice 1: Dashboard section scaffold

Composed a new `renderActiveAssignmentsSection` helper in `app/src/shell/surfaces/shared/activeAssignments.ts` and mounted it above the intro paragraph on `curriculum.ts`. The section reads the already-hydrated registry through the injected `CurriculumAssignmentDetailSeam.list` accessor and renders a card per `published` assignment. The section is hidden when no `published` assignment is registered.

### Slice 2: Additive `publishedAt` projection

Extended `AssignmentRecord` with an optional `publishedAt: Timestamp` and `AssignmentPublishWrite` with a required `publishedAt: FieldValue`. `assignmentsPublish` writes `FieldValue.serverTimestamp()` inside the existing atomic batch on the initial `draft` -> `published` transition. `assignmentsTeacherList` projects the value as an epoch-ms number for `published` and `closed` and as `null` for `draft`; existing clients ignore the addition. The per-card date renders in `YYYY-MM-DD` local calendar format.

### Slice 3: Per-card progress counts

Wired the certified `assessmentAssignmentSummary` seam through `SurfaceDeps` -> `mountTeacherShell` -> workspace -> Curriculum -> `activeAssignments`. Each card issues one summary call on mount, caches the result on a per-assignment `Map`, and renders `${completed} submitted / ${started} started / ${total} total`. Failures render `Progress temporarily unavailable` per Sprint 14 §5.5 without disturbing sibling cards.

### Slice 4: `Show closed` toggle

Added a single `Show closed` control immediately under the section title, session-only, default off. When toggled on, closed assignments render beneath the published set using the same card shape and ordering.

### Slice 5: `assignmentsRecipientList` + Assignment Detail roster grouping

Introduced the sole new callable at `platform/functions/src/assignments/assignments-recipient-list.ts`. Authorization mirrors `assessmentAssignmentSummary` (active-teacher role, owning teacher, same school, district boundary via `requireDistrictContext`). Display names are resolved through the canonical roster display-name resolver in `enrollments/resolve-roster-display-name.ts`. The client wire at `app/src/assignments/detail/roster-wire.ts` and the pure grouping helper at `app/src/assignments/detail/roster.ts` compose the roster panel; the Assignment Detail surface renders the three groups (`Submitted` with representative-attempt percentage per PDR-029a; `In progress` and `Not started` with name only) beneath the certified Sprint 13A Assignment Summary card on published and closed.

### Slice 6: Per-question factual summary

Added a pure aggregator at `app/src/assignments/detail/question-summary.ts` with `MIN_QUESTION_SUMMARY_ATTEMPTS = 3`. Below the threshold, the panel renders `Question-level results will appear after more students submit.` and issues zero per-attempt fetches. Above the threshold, the surface fetches each representative attempt through `assessmentAttemptGetForTeacher` and renders the per-question correct-response rate and per-option distribution in the canonical question order of the first attempt.

### Slice 7: States, accessibility, and documentation reconciliation

Loading, empty, and error branches were exercised end-to-end on both the dashboard section and the Assignment Detail additions. Region and group `role`/`aria-label` attributes were confirmed. Documentation was reconciled in `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` Appendix A (new `assignmentsRecipientList` entry; `assignmentsPublish` and `assignmentsTeacherList` entries updated for the additive `publishedAt` field) and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (new §35 Sprint 15 Reconciliations).

## 3. Files Created

- `app/src/shell/surfaces/shared/activeAssignments.ts`
- `app/src/shell/surfaces/shared/activeAssignments.test.ts`
- `app/src/assignments/detail/roster.ts`
- `app/src/assignments/detail/roster.test.ts`
- `app/src/assignments/detail/roster-wire.ts`
- `app/src/assignments/detail/attempts-wire.ts`
- `app/src/assignments/detail/question-summary.ts`
- `app/src/assignments/detail/question-summary.test.ts`
- `platform/functions/src/assignments/assignments-recipient-list.ts`
- `platform/functions/src/assignments/assignments-recipient-list.test.ts`
- `docs/platform/SPRINT_15_COMPLETION_REPORT.md`

## 4. Files Modified

Client:

- `app/src/shell/surfaces/curriculum.ts`
- `app/src/shell/shell.ts`
- `app/src/shell/surfaces/workspace.ts`
- `app/src/router/surfaces/index.ts`
- `app/src/index.ts`
- `app/src/assignments/detail/types.ts`
- `app/src/assignments/detail/hydrate.ts`
- `app/src/assignments/detail/detail.ts`

Backend:

- `platform/functions/src/shared/types/assignment.ts`
- `platform/functions/src/assignments/assignments-publish.ts`
- `platform/functions/src/assignments/assignments-publish.test.ts`
- `platform/functions/src/assignments/assignments-teacher-list.ts`
- `platform/functions/src/assignments/assignments-teacher-list.test.ts`
- `platform/functions/src/assignments/index.ts`
- `platform/functions/src/index.ts`

Documentation:

- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/SPRINT_HISTORY.md`

## 5. Backend Changes

- One new callable: `assignmentsRecipientList` (aggregate-only projection of the frozen recipient population; authorized under PDR-029o).
- One additive field: `publishedAt` on `AssignmentRecord` (server-stamped on the initial `draft` -> `published` transition; preserved across subsequent `close` and `reopen` cycles because those narrow lifecycle writes intentionally exclude the field).
- One additive projection: `publishedAt` on `AssignmentsTeacherListItem` (epoch-ms number for `published` and `closed`; `null` for `draft`).
- No new Firestore collection. No new lifecycle field. No new custom claim. No Firestore Rules relaxation. No composite index. No schema change beyond the additive `publishedAt` field.

## 6. Client Changes

- New Active Assignments dashboard section rendered at the top of the Curriculum surface.
- New Assignment Detail roster grouping and per-question factual summary panel.
- Backward-compatible parsing of the new `publishedAt` projection in `hydrate.ts`.
- Three new callable wires (`roster-wire.ts`, `attempts-wire.ts`) covering the new recipient callable and the reuse of the certified `assessmentAttemptsListForClass` and `assessmentAttemptGetForTeacher` retrieval surfaces.
- All new modules are firebase-free; every side effect is injected through a typed seam.

## 7. Tests Executed

- App full suite: `npm test` in `app/` -> 439 of 440 pass. The sole failure is the pre-existing `curriculum/curriculumManifest.test.ts` baseline drift documented in `SPRINT_13_FINAL_CERTIFICATION.md` §11.
- Cloud Functions full suite: `npm test` in `platform/functions/` -> 907 of 907 pass.
- New tests: dashboard rendering / ordering / opener / a11y / toggle / progress line loading, success, and error branches; pure roster-grouping helper; pure per-question aggregator; new `assignmentsRecipientList` callable authorization, projection, defense-in-depth filtering, empty roster, and confidentiality (no attempt, session, score, or answer fields in the response).

## 8. Validation Results

- Typecheck (app): pass.
- Typecheck (functions): pass.
- Lint (app): pass.
- Lint (functions): pass.
- Build (app): pass.
- Build (functions): pass.
- Terminology check against Sprint 14 §7 beta non-goals: pass (no `at risk`, no `needs attention`, no engagement score, no ranking, no AI recommendation, no notification, no cross-assignment trend copy).
- Em dash check across every new or modified file: pass (zero em dashes).
- No deployment. No commit.

## 9. Remaining Sprint 15 Work

None. Every slice defined in `SPRINT_15_IMPLEMENTATION_PLAN.md` has shipped. The pre-existing `curriculum/curriculumManifest.test.ts` baseline drift remains formally accepted per `SPRINT_13_FINAL_CERTIFICATION.md` §11. Sprint 16 planning is out of scope for this report.
