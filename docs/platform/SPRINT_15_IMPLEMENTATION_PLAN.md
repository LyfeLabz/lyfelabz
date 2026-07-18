# Sprint 15: Teacher Dashboard and Attention Model Implementation Plan

**Date:** 2026-07-18
**Status:** Ready for implementation. Grounded in `SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`.
**Companion documents:** `SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`, `SPRINT_13_FINAL_CERTIFICATION.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md` (§7 Platform Posture), `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-029).

## 1. Sprint Objective

Implement the beta teacher dashboard and Assignment Detail attention additions defined in Sprint 14. Every slice is small, independently testable, and additive over the certified Sprint 13 lifecycle. No slice widens the four-item Teacher Workspace navigation. No slice modifies the Sprint 13A ten-field aggregate boundary. No slice introduces a notification, an inferred label, a ranking, a predictive signal, or an AI recommendation. Every displayed value traces to stored assignment, session, attempt, or submission data per Sprint 14 §4.4.

## 2. Invariants

The following are preserved by every slice. A slice that would break an invariant is rejected and re-scoped.

- Four-item Teacher Workspace navigation (Curriculum, Classes, Present Mode, Settings).
- Curriculum remains the primary landing surface.
- Session-scoped in-memory `assignmentDetailRegistry` is the single visible catalog of teacher-owned assignments. Every mutation continues to route through `onStatusChange`.
- `assignmentsTeacherList` is the single reload-hydration path. No parallel enumeration is introduced.
- Every mutation is server-authoritative via a callable that resolves through `requireDistrictContext` and the canonical ownership plus school gate.
- The Sprint 12E Slice 1 aggregate-only confidentiality boundary is preserved. The new `assignmentsRecipientList` callable returns the frozen recipient population (already authorized for the owning teacher under PDR-029o) and is not an aggregate analytics surface.
- No em dashes anywhere.

## 3. Slice Sequence

Seven slices. Each carries a user-visible outcome, files touched, data dependencies, Rules implications, hydration requirements, tests, and acceptance criteria. Slices are independently deployable; a later slice may be paused without regressing an earlier slice.

---

### Slice 1: Dashboard section scaffold

**User-visible outcome.** On Curriculum, an `Active assignments` region appears above the lesson grid when the signed-in teacher has one or more `published` assignments in the session registry. Each active assignment renders as a card with lesson title, class name, assignment state label (`Published`), and an `Open assignment` button that calls the existing entry-point opener. No counts yet; no `Show closed` toggle yet.

**Files or modules likely affected.**

- `app/src/shell/surfaces/curriculum.ts`: add the `renderActiveAssignmentsSection` composed above the existing filter and grid rendering. Read from the injected `CurriculumAssignmentDetailSeam.list` accessor. Pure DOM composition; no `firebase/*` import.
- `app/src/shell/surfaces/shared/`: introduce `activeAssignments.ts` if the composition helper is genuinely reusable, otherwise keep it colocated in `curriculum.ts`.
- `app/src/shell/shell.test.ts`: appended cases for section absence (no published assignments), single card, multi-card ordering, and re-render after `onStatusChange` (Publish, Close, Reopen).

**Backend / Firestore dependencies.** None. Reuses the certified `assignmentsTeacherList` hydration already performed by the shell bootstrap.

**Rules implications.** None.

**Client hydration.** No change. The section reads the already-hydrated registry.

**Tests.**

- Unit: `curriculum.ts` renders no section when the registry has zero `published` records.
- Unit: renders exactly one card per `published` assignment; ordering follows Sprint 14 §5.3.
- Unit: `onStatusChange` (draft to published, published to closed, closed to published) re-renders the section without a page reload.
- Unit: the `Open assignment` button invokes the entry-point opener with the correct `assignmentId`.
- Accessibility unit: the region uses `role="region"` with `aria-label="Active assignments"`; each card carries an `aria-label` combining title and class name.

**Acceptance criteria.** Section appears above the lesson grid only when at least one `published` assignment is registered; ordering is deterministic; opener wires correctly; no console errors; lint, typecheck, unit tests pass.

---

### Slice 2: Additive `publishedAt` projection

**User-visible outcome.** Card renders the published date, right-aligned. Same visual otherwise. Uses the same slice-1 card composition.

**Files or modules likely affected.**

- `platform/functions/src/assignments/assignments-teacher-list.ts`: additive optional `publishedAt: number | null` in the response projection. Field is copied from `assignments/{assignmentId}.publishedAt` when present, `null` for draft. No new request field.
- `platform/functions/src/assignments/assignments-teacher-list.test.ts`: appended tests for `publishedAt` presence on published and closed records and absence-as-null on drafts. Cross-owner and cross-district isolation regression checks preserved.
- `app/src/assignments/detail/hydrate.ts` and `hydrate-wire.ts`: parse the additive field into `AssignmentDetailMetadata` as an optional `publishedAt?: number`. Backward compatible.
- `app/src/assignments/detail/types.ts`: append optional `publishedAt?: number`.
- `app/src/shell/surfaces/curriculum.ts`: render the date in the card. Format `YYYY-MM-DD` in the teacher's local timezone from `publishedAt`.

**Backend / Firestore dependencies.** The `assignments/{assignmentId}.publishedAt` field is already written by `assignmentsPublish` per Sprint 13H. No new schema field.

**Rules implications.** None. The field is already inside the assignment record boundary.

**Client hydration.** Registry `AssignmentDetailMetadata` gains an optional field. Existing readers continue to work.

**Tests.**

- Backend: `publishedAt` projected as number for `published` and `closed`; projected as `null` (or omitted per the additive contract) for `draft`.
- Client: hydrate parser accepts a payload with and without `publishedAt`.
- Client: card renders the local calendar date on Slice 1 cards.

**Acceptance criteria.** Backward-compatible field addition; ordering by `publishedAt` becomes stable across renders; no other card content changes.

---

### Slice 3: Per-card progress counts

**User-visible outcome.** Each active assignment card renders the progress line: `${submittedCount} submitted / ${startedCount} started / ${totalEnrolled} total`.

**Files or modules likely affected.**

- `app/src/shell/surfaces/curriculum.ts` (or the new `activeAssignments.ts`): per-card summary fetch through an injected `AssignmentSummaryCallable` seam. One call per rendered active assignment on section mount; result cached on a session-scoped `Map<assignmentId, AssignmentSummary>` for the duration of the surface's lifetime; refreshed by `onStatusChange`.
- `app/src/assignments/summary/wire.ts`: no new wire needed; the existing seam is reused.
- `app/src/index.ts`: pass the summary callable to the Curriculum surface deps.
- `app/src/shell/shell.test.ts`: appended cases for progress line rendering, error fallback, and cache reuse across re-renders.

**Backend / Firestore dependencies.** Reuses the certified `assessmentAssignmentSummary` callable. No callable extension.

**Rules implications.** None.

**Client hydration.** Cards render the title, class, and state immediately on mount; progress line renders as counts resolve. Each card manages its own loading and error state.

**Tests.**

- Client: cards render `Loading progress...` while the summary is in flight (or a compact skeleton line; either is acceptable, but must be the same across cards).
- Client: cards render the progress line as `submitted / started / total` in the specified order.
- Client: on summary failure for one card, that card renders `Progress temporarily unavailable`; other cards render normally.
- Client: `onStatusChange` on Publish invalidates the cache entry for that `assignmentId` before the next render.
- Confidentiality: card composition asserts the summary card confidentiality tests from Sprint 13A remain green.

**Acceptance criteria.** Counts match the aggregate summary exactly; no per-student projection leaks into the card; cache prevents duplicate calls across re-renders in the same session.

---

### Slice 4: `Show closed` toggle

**User-visible outcome.** A single `Show closed` control appears immediately under the section title. When on, closed assignments render beneath the published set with the same card shape and ordering.

**Files or modules likely affected.**

- `app/src/shell/surfaces/curriculum.ts` (or `activeAssignments.ts`): toggle state; default off; controlled entirely inside the section; no persistence across reloads.
- `app/src/shell/shell.test.ts`: appended cases for toggle default, toggle on with only closed, toggle on with mixed, ordering, and `onStatusChange` reactivity.

**Backend / Firestore dependencies.** None. The closed set is already in the registry via `assignmentsTeacherList`.

**Rules implications.** None.

**Client hydration.** None.

**Tests.**

- Toggle defaults to off; only published render.
- Toggle on renders closed under published in `publishedAt` descending.
- Toggle preserves state across `onStatusChange` re-renders.
- Toggle is keyboard-focusable and announced.

**Acceptance criteria.** Toggle behavior matches Sprint 14 §5.4 exactly; drafts remain excluded from the dashboard.

---

### Slice 5: Assignment Detail roster grouping

**User-visible outcome.** Assignment Detail (published and closed) renders a roster grouped into `Submitted`, `In progress`, `Not started` beneath the Assignment Summary card. Names are drawn from the certified roster display-name resolver. `Submitted` rows also render the highest-valid-completed-attempt percentage per PDR-029a.

**Files or modules likely affected.**

- New callable `assignmentsRecipientList` at `platform/functions/src/assignments/assignments-recipient-list.ts` with adjacent test file. Request: `{ assignmentId: string }`. Response: `{ assignmentId, recipients: Array<{ studentId: string, studentDisplayName: string }> }`. Authorization mirrors `assessmentAssignmentSummary`: active teacher, owning teacher (`assignments/{assignmentId}.teacherId === uid`), same school (`assignments/{assignmentId}.schoolId === context.schoolId`), district boundary via `requireDistrictContext`. Reads `assignments/{assignmentId}/recipients/*`. Display names resolved through the canonical resolver in `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`. Emits one canonical info-level `assignments.recipientList` observability log line per call. Aggregate-only confidentiality: the callable never returns attempt data, session data, score data, or answer data.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` Appendix A: add the `assignmentsRecipientList` entry immediately after `assignmentsRecipientAdd`.
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`: append a Sprint 15 Reconciliation section noting that recipient enumeration is authorized for the owning teacher under PDR-029o and is not an aggregate analytics surface.
- `platform/functions/src/index.ts`: export the new callable.
- `app/src/assignments/detail/roster-wire.ts` (new): typed seam for the recipient callable and reuse of the existing `assessmentAttemptsListForClass` seam.
- `app/src/assignments/detail/detail.ts`: compose the roster panel beneath the Assignment Summary card. Grouping helper is a pure function against `{ recipients, completedAttempts }`; a recipient is `Submitted` when at least one completed attempt exists for the pair `(assignmentId, studentId)`; otherwise the recipient is `Not started` when there is no live session for the pair, else `In progress`.
- `app/src/index.ts`: wire the new callable seams into Detail.
- `app/src/assignments/detail/detail.test.ts`: appended tests for empty roster (no recipients), all-not-started, mixed, all-submitted, callable failure, confidentiality (no score fields on `In progress` or `Not started` rows, no answer fields on any row).

**Backend / Firestore dependencies.** Reads the certified `recipients` subcollection introduced by Sprint 12E Slice 2A. Reads `attempts` via the certified `assessmentAttemptsListForClass` on the assignment's `classId` and filters client-side by `assignmentId`. Session presence is derived from `assessmentAssignmentSummary`'s `inProgressStudents` count and the roster arithmetic `inProgress = totalRecipients - submitted - notStarted`; the callable itself does not need to enumerate sessions. If per-student session identification proves necessary, it is deferred to a follow-up slice and does not block the Sprint 15 dashboard.

**Rules implications.** Firestore Rules already permit the owning teacher to read `recipients/*` under PDR-029o. Confirm during Slice 5 whether the current rules bind reads via a Cloud Function only; if so, no rules change is needed because the callable performs the read on the caller's behalf.

**Client hydration.** Detail already hydrates per assignment. This slice adds two callables to the hydration set on the published or closed branches only. Drafts never trigger recipient hydration.

**Tests.**

- Backend: authorization (active teacher, owning teacher, same school, district boundary); shape rejection for extra fields; empty recipient set; multi-recipient set; cross-owner and cross-district isolation.
- Backend: display names resolved through the canonical resolver; no denormalized personal data written into recipient records (PDR-028h regression check).
- Client: grouping helper unit tests (all-Submitted, all-Not-Started, mixed).
- Client: confidentiality: no score field on non-`Submitted` rows; no answer field on any row.
- Client: failure of the recipient callable renders `Roster temporarily unavailable` beneath the Summary card without abolishing the Detail surface.

**Acceptance criteria.** Group counts match `assessmentAssignmentSummary` counts exactly; representative-attempt percentages match PDR-029a; teacher cannot enumerate a recipient set they do not own; no attempt or session data leaks onto non-`Submitted` rows.

---

### Slice 6: Per-question factual summary

**User-visible outcome.** Assignment Detail (published and closed) renders a per-question factual summary panel beneath the roster group. When the number of representative completed attempts is `< 3`, the panel renders `Question-level results will appear after more students submit.` and no per-question data is fetched. When the threshold is met, the panel renders each question's text, correct-response rate, and per-option response distribution.

**Files or modules likely affected.**

- `app/src/assignments/detail/question-summary.ts` (new): pure aggregator that accepts a list of `TeacherVisibleAttemptDetail` records and returns `{ questions: Array<{ questionId, prompt, correctPercentage, options: Array<{ optionId, chosenPercentage }> }> }`. No inference; no ordering by "most missed"; questions are ordered by the assessment's canonical question order.
- `app/src/assignments/detail/detail.ts`: compose the panel. Fetch each representative attempt via `assessmentAttemptGetForTeacher`. Cache aggregated results per assignment for the surface's lifetime.
- `app/src/assignments/detail/detail.test.ts`: appended tests for below-threshold silence, above-threshold rendering, ordering, and confidentiality (no student names on the panel).

**Backend / Firestore dependencies.** Reuses `assessmentAttemptsListForClass` (already required by Slice 5 for the Submitted roster) and `assessmentAttemptGetForTeacher`. No new callable. No backend change.

**Rules implications.** None.

**Client hydration.** One additional per-representative-attempt fetch when the threshold is met. Bounded by the completed count; cached per session.

**Tests.**

- Aggregator unit tests: all-correct, all-wrong, mixed, ties in option distribution.
- Threshold behavior: `< 3` completed attempts renders the deferred message with zero per-attempt fetches.
- Ordering: questions are rendered in the assessment's canonical order, never reordered by "most missed" or by any inferred priority.
- Confidentiality: the panel never renders a student name; only aggregate percentages.

**Acceptance criteria.** No per-attempt fetches below the threshold; aggregated correct-response rate matches a hand-computed value on the test fixtures; questions never reordered by any inference.

---

### Slice 7: Loading, empty, error, accessibility, and documentation reconciliation

**User-visible outcome.** Every state defined in Sprint 14 §5.5 and §5.6 is exercised end-to-end. Dark mode, mobile, and keyboard-only paths are validated. Documentation is reconciled.

**Files or modules likely affected.**

- `app/src/shell/surfaces/curriculum.ts` and `app/src/assignments/detail/detail.ts`: complete the loading, empty, and error branches per Sprint 14 §5.5 and Sprint 15 §Slice 3 through §Slice 6.
- `app/src/shell/shell.test.ts` and `app/src/assignments/detail/detail.test.ts`: appended states-and-errors tests.
- `docs/platform/SPRINT_15_COMPLETION_REPORT.md`: written at slice close.
- `docs/platform/SPRINT_HISTORY.md`: appended Sprint 15 entry.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`: `assignmentsRecipientList` entry added by Slice 5 is re-verified.
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`: the Sprint 15 reconciliation section added by Slice 5 is re-verified.

**Backend / Firestore dependencies.** None.

**Rules implications.** None.

**Client hydration.** Final integration validation.

**Tests.**

- Loading placeholders present and removed at the correct times.
- Empty states render as specified.
- Error states never abort the dashboard section or the Detail surface.
- Accessibility: `role="region"`, `aria-label`, keyboard focus order, contrast, and touch-target minimums.
- Full application suite green (except the pre-existing `curriculum/curriculumManifest.test.ts` baseline drift, which continues to be accepted as documented in `SPRINT_13_FINAL_CERTIFICATION.md` §11).

**Acceptance criteria.** Every Sprint 14 dashboard requirement is exercised by at least one automated test or one deliberately documented manual check; the pre-existing baseline failure remains the only outstanding suite failure; lint, typecheck, and build pass; no em dashes anywhere in modified files; no deployment; no commit unless explicitly requested.

## 4. Cross-Slice Guardrails

- Every callable read continues to route through `requireDistrictContext` and the canonical ownership plus school gate. The one new callable inherits this pattern.
- The Sprint 13B session-scoped `assignmentDetailRegistry` remains the sole in-memory catalog. The Slice 3 per-card summary cache and the Slice 6 per-question aggregation cache are attached to the same lifecycle (surface mount to surface unmount, or `onStatusChange` invalidation) and do not persist across reloads.
- No `localStorage`, `sessionStorage`, `IndexedDB`, realtime listener, or polling.
- No LMS side effect. No Google Classroom side effect. No notification.
- No copy language that ranks, predicts, or judges a student.

## 5. Testing Strategy Summary

- Backend callable tests for `assignmentsRecipientList` cover authorization, cross-owner isolation, cross-district isolation, shape rejection, empty roster, populated roster, and canonical resolver integration.
- Backend `assignmentsTeacherList` tests cover the additive `publishedAt` projection and continue to cover Sprint 13C, 13F, and 13G projections.
- Client tests cover Curriculum section rendering, ordering, `Show closed` toggle, per-card progress line, error fallbacks, roster grouping, per-question aggregation, threshold behavior, and confidentiality (no leakage of scores, attempt ids, session ids, or answers onto non-`Submitted` rows or the per-question panel).
- Full Cloud Functions regression and full application suite are run at the close of Slice 7.

## 6. Documentation Reconciliation Plan

- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`: Appendix A gains `assignmentsRecipientList`.
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`: gains a Sprint 15 reconciliation subsection under the existing §33 / §34 sequence, naming recipient enumeration as authorized for the owning teacher and not aggregate analytics.
- `SPRINT_HISTORY.md`: appended Sprint 15 entry summarizing the delivered slices.
- `SPRINT_15_COMPLETION_REPORT.md`: written at Slice 7 close.

## 7. Out of Scope

- Rollup materialization (`assignmentRollups`, `attemptRollups`).
- Any dashboard configuration beyond the `Show closed` toggle.
- A "most-missed question" ordering, an "at risk" grouping, or any other inferred signal.
- Draft-assignment dashboard cards.
- Archive-assignment surfacing.
- LMS or Google Classroom side effects.
- Notifications of any kind.

Every item in Sprint 14 §7 (Beta Non-Goals) is out of scope here.

## 8. Ready-to-Implement Checklist

Before Slice 1 begins:

- Sprint 14 specification is accepted.
- `TEACHER_EXPERIENCE_PHILOSOPHY.md` §7 Platform Posture is present.
- The pre-existing `curriculum/curriculumManifest.test.ts` baseline drift is either resolved or continues to be formally accepted as documented in `SPRINT_13_FINAL_CERTIFICATION.md` §11.
- The Sprint 15 slice sequence is agreed to as ordered; no slice is silently expanded during implementation.

If any of these is not true, Sprint 15 does not begin until it is.
