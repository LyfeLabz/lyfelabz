# Sprint 14: Teacher Dashboard and Attention Model Specification

**Date:** 2026-07-18
**Status:** Documentation and design. No production code is modified by Sprint 14.
**Companion documents:** `SPRINT_13_FINAL_CERTIFICATION.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md` (Platform Posture section), `SPRINT_15_IMPLEMENTATION_PLAN.md`, `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-018, PDR-024, PDR-029).

## 1. Objective

Define the minimum teacher dashboard and teacher attention model required to support the certified Sprint 13 teacher assignment lifecycle during the beta. Reconcile that definition against the current repository state. Produce an implementation-ready Sprint 15 slice sequence. Introduce no new philosophical documents, no new governance framework, and no scope beyond the beta teacher platform.

Sprint 14 does not modify production code. It amends `TEACHER_EXPERIENCE_PHILOSOPHY.md` with a concise Platform Posture section, produces this specification, produces the Sprint 15 implementation plan, and appends a Sprint 14 entry to `SPRINT_HISTORY.md`. Every implementation decision here is grounded in data surfaces that already exist or in narrowly scoped additive callables identified explicitly in §7 and §8.

## 2. Repository Findings

### 2.1 Certified assignment lifecycle (Sprint 13)

- Callables in Appendix A of `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`: `assignmentsCreateDraft`, `assignmentsUpdateDraft`, `assignmentsPublish`, `assignmentsClose`, `assignmentsReopen`, `assignmentsArchive`, `assignmentsTeacherList`, `assignmentsRecipientAdd`, `assessmentAssignmentSummary`.
- Canonical statuses on `assignments/{assignmentId}`: `draft`, `published`, `closed`, `archived` (per Data Model §3.6). `archived` is intentionally never surfaced by any Sprint 13 client.
- Frozen recipient population under PDR-029 (`assignments/{assignmentId}/recipients/{studentId}`) with fields `assignmentId`, `studentId`, `classId`, `schoolId`, `districtId`, `assignedAt`, `assignedBy`, `source`, `status`.

### 2.2 Client surfaces already in place

- Four-item Teacher Workspace navigation (Sprint 6C): Curriculum, Classes, Present Mode, Settings. Canonical. Not widened without a repository-level decision.
- Curriculum surface (`app/src/shell/surfaces/curriculum.ts`): the teacher landing page. Owns lesson cards, activation, and the entry point into the Assignment Dialog. Sprint 13B remediation surfaces `View summary`, `View summaries`, and `View drafts` controls per lesson card, backed by the session-scoped `assignmentDetailRegistry` and the certified `assignmentsTeacherList` reload-hydration path.
- Assignment Detail surface (`app/src/assignments/detail/detail.ts`): the deep-inspection surface for a single assignment. Renders header (title, status, class name), Sprint 13A Assignment Summary card (published and closed), Draft results panel (draft), and the lifecycle actions (Edit draft, Publish assignment, Close assignment, Reopen assignment).
- Assignment Summary card (`app/src/assignments/summary/card.ts`): aggregate-only ten-field projection returned by `assessmentAssignmentSummary` and rendered as a calm read-only card.

### 2.3 Data surfaces already available to the client

- `assignmentsTeacherList({ includeDrafts })`: read-only enumeration of every non-archived assignment owned by the caller in the caller's school. Response fields: `assignmentId`, `lessonSlug`, `title`, `classId`, `className`, `status`, `instructions?`. Draft records included only when `includeDrafts === true`.
- `assessmentAssignmentSummary({ assignmentId })`: aggregate-only per-assignment metrics. Fields: `assignmentId`, `classId`, `totalStudents`, `completedStudents`, `inProgressStudents`, `notStartedStudents`, `completionPercentage`, `averagePercentage`, `highestPercentage`, `lowestPercentage`, `perfectScoreStudents`.
- `assessmentAttemptsListForClass({ classId })`: per-attempt list, one entry per completed attempt, containing `attemptId`, `studentId`, `studentDisplayName`, `assignmentId`, `attemptNumber`, `score`, `maxScore`, `percentage`, `submittedAt`, `status`. Client can filter by `assignmentId` for a per-assignment completed-student roster.
- `assessmentAttemptGetForTeacher({ attemptId })`: per-attempt full detail including `itemResults` for per-question inspection of a single attempt.

### 2.4 Data surfaces missing for the beta dashboard

- No teacher-facing enumeration of the frozen recipient population exists. Recipient reads are authorized under PDR-029o but no callable currently returns the recipient list. This is required for a "Not Started" and "In Progress" per-student roster on Assignment Detail. Sprint 15 introduces one bounded read-only callable: `assignmentsRecipientList`.
- No per-assignment per-question aggregate exists. `itemResults` is per-attempt only. A "most-missed question" panel therefore requires either a new aggregate callable or client-side aggregation over completed attempts. Sprint 15 selects client-side aggregation over completed attempts as the bounded path; a persistent rollup remains the deferred scalable path under PDR-029n and the `assignmentRollups`/`attemptRollups` plan in `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md`.

### 2.5 Governing philosophy

- `TEACHER_EXPERIENCE_PHILOSOPHY.md` §3.2 keeps Curriculum as the primary landing experience. Analytics remains a supporting surface.
- Sprint 9D reconciliation names the pilot Teacher Workspace scope: recent submissions, students who have not submitted the latest assignment, activate or deactivate lessons, publish assignments to Google Classroom, launch Present Mode, open lesson, class roster.
- The Sprint 14 dashboard operationalizes that pilot scope for the Sprint 13 lifecycle. It does not introduce a competing landing surface.

## 3. Placement Decision

The dashboard is not a new left-side navigation item. The four-item navigation is preserved. The Curriculum surface remains the primary landing experience.

The dashboard is a calm section rendered above the lesson grid on the Curriculum surface. It appears only when the signed-in teacher has one or more active assignments. When the teacher has no active assignments, the dashboard section is silent (not rendered), and the Curriculum lesson grid is the surface, exactly as today.

This placement satisfies three constraints:

- Curriculum remains the landing experience.
- The teacher never has to reach a second surface to see the state of assignments the lifecycle already exposes.
- The Assignment Detail surface remains the single deep-inspection surface for one assignment.

The dashboard section is titled `Active assignments`. It does not compete with Curriculum lesson cards.

## 4. Teacher Attention Model

### 4.1 Separation of concerns

Three concepts are kept distinct and never conflated.

- **Assignment state.** The certified lifecycle statuses: `draft`, `published`, `closed`, `archived`. The dashboard surfaces `published` only; `draft` remains reachable through Curriculum `View drafts`; `closed` remains reachable through Curriculum `View summaries`; `archived` remains intentionally silent.
- **Student progress state.** Derived mechanically from data the callables already return. Three states, no fourth:
  - `notStarted`: the student is a frozen recipient and has no assessment session and no attempt for the assignment.
  - `inProgress`: the student is a frozen recipient and has a live assessment session but no completed attempt.
  - `completed`: the student is a frozen recipient and has at least one completed attempt.
  The three states are already computed server-side by `assessmentAssignmentSummary` (`notStartedStudents`, `inProgressStudents`, `completedStudents`). No fourth state is invented. There is no `at risk`, no `stuck`, no `disengaged`, no `improving`, no `needs help`.
- **Teacher attention information.** Purely factual counts and factual per-question and per-student values that trace back to stored assignment, session, attempt, or submission data. No inference, no prediction, no ranking.

### 4.2 Attention information the dashboard displays

Per active assignment card:

- Lesson title.
- Class name.
- Assignment state label (`Published`, or `Closed` when the closed set is shown; see §5.4).
- Published date (local calendar date, rendered from `publishedAt` on the assignment record; if `publishedAt` is not projected today, add it to `assignmentsTeacherList` as an additive optional field in Sprint 15 Slice 2).
- Started count: `inProgressStudents + completedStudents`.
- Submitted count: `completedStudents`.
- Total enrolled count: `totalStudents` from the frozen recipient population.
- Open Assignment Detail affordance.

The card never displays:

- A red flag, warning icon, or attention badge.
- An "at risk" count.
- A "needs review" count.
- A "recommended action" prompt.
- A push toward a specific student or a specific question.

### 4.3 Attention information the Assignment Detail displays

Per Assignment Detail (published or closed):

- Existing Sprint 13A Assignment Summary card (unchanged).
- Roster grouped by progress state:
  - `Submitted`: the student's display name and the highest valid completed attempt percentage. The percentage is factually rendered; no letter grade, no color band, no threshold-based label.
  - `In progress`: the student's display name only. No timer, no elapsed time badge, no nudge.
  - `Not started`: the student's display name only. No time-since-published surfacing, no reminder affordance.
- Per-question factual summary (when at least the Sprint 15 minimum-attempt threshold is met, see §7): question text, correct-response rate, and per-option response distribution. The panel is silent below the threshold. The threshold prevents a single wrong attempt from producing a "most missed" reading.
- Existing Sprint 13 lifecycle actions (Edit draft, Publish, Close, Reopen) unchanged.

The Assignment Detail never displays:

- An engagement score, a readiness prediction, a group recommendation, or a study-plan suggestion.
- A rank of students against each other.
- A ranked list of "students who need attention".
- A "next steps" panel.

### 4.4 Data derivation table

Every displayed value must be traceable. This table is normative for Sprint 15.

| Displayed value | Derived from | Callable path |
| --- | --- | --- |
| Active assignment card list | `status === "published"` filter over hydrated registry | `assignmentsTeacherList({ includeDrafts: false })` |
| Lesson title | `title` on the assignment record | `assignmentsTeacherList` |
| Class name | `className` on the assignment record | `assignmentsTeacherList` |
| Assignment state | `status` on the assignment record | `assignmentsTeacherList` |
| Published date | `publishedAt` on the assignment record | `assignmentsTeacherList` (additive projection, Sprint 15 Slice 2) |
| Total enrolled | `totalStudents` | `assessmentAssignmentSummary` |
| Submitted count | `completedStudents` | `assessmentAssignmentSummary` |
| Started count | `inProgressStudents + completedStudents` | `assessmentAssignmentSummary` |
| Not started count | `notStartedStudents` | `assessmentAssignmentSummary` |
| Submitted roster (names, percentages) | `attempts` filtered by `assignmentId`, deduplicated to representative attempt per PDR-029a | `assessmentAttemptsListForClass` |
| In-progress roster (names) | frozen recipients minus submitted, intersected with recipients with a live session | `assignmentsRecipientList` (new, Sprint 15 Slice 4) plus session existence signal derived from summary counts |
| Not-started roster (names) | frozen recipients minus (submitted union in-progress) | `assignmentsRecipientList` (new, Sprint 15 Slice 4) |
| Per-question correct-rate and option distribution | per-attempt `itemResults` aggregated over completed attempts | `assessmentAttemptGetForTeacher` per representative attempt, aggregated client-side |

`assignmentsRecipientList` is the sole new callable authorized by this specification. It returns `{ assignmentId, recipients: [{ studentId, studentDisplayName }] }`. Authorization mirrors `assessmentAssignmentSummary`: active-teacher role, owning teacher, same school, district-boundary derived from context. Confidentiality: aggregate-only boundary continues to bind every downstream analytics surface; the recipient roster is not aggregate data. It is the frozen population that PDR-029o already authorizes for the owning teacher and the named student.

### 4.5 Explicitly excluded signals

The following signals are intentionally not derivable and not shown:

- Attempt duration, average time on task, or fastest-completion ordering.
- Cross-assignment student trends.
- Cross-class comparisons.
- Assignment-level or student-level composite scores of any kind.
- Silent server-side inference beyond the mechanical counts above.

Anything not listed in the derivation table in §4.4 is out of scope.

## 5. Dashboard Definition

### 5.1 Section identity

- Section title: `Active assignments`.
- Location: at the top of the Curriculum surface content area, above the grade or topic filters and the lesson grid.
- Visibility: rendered only when at least one owned assignment currently has `status === "published"`. Otherwise the section is absent; the Curriculum lesson grid is unchanged.

### 5.2 Card contents

Each card corresponds to one `published` assignment. Card contents, in reading order:

1. Lesson title (line 1).
2. Class name (line 2).
3. Progress line: `${submittedCount} submitted / ${startedCount} started / ${totalEnrolled} total`.
4. Published date, right-aligned.
5. Open Assignment Detail affordance (button labelled `Open assignment`).

The card is a single visual unit. No expanding sub-panels on the dashboard. No inline roster. No inline question chart.

### 5.3 Ordering

Cards are ordered deterministically:

1. Most recent `publishedAt` first.
2. Class name ascending (ties on `publishedAt`).
3. Assignment title ascending (ties on `publishedAt` and `className`).
4. `assignmentId` ascending (final tie-breaker).

This ordering is stable across renders and never depends on inferred priority.

### 5.4 Show closed toggle

A single deterministic control appears immediately under the section title: `Show closed`. When toggled on, the card list also renders `closed` assignments beneath the `published` set, using the same card structure and ordering (published date descending). The toggle defaults to off. This is the sole configuration on the dashboard.

Drafts are not surfaced on the dashboard. Drafts remain reachable through the Curriculum `View drafts` control certified in Sprint 13F.

### 5.5 Loading, empty, and error states

- Loading: a single unobtrusive `Loading assignments...` placeholder for the section during registry hydration. No skeleton animation library. No spinner overlay on the full Curriculum surface.
- Empty (no published or closed assignments): section is not rendered.
- Empty (`Show closed` on and only closed assignments present): section renders the closed list under the toggle with the same card structure.
- Error (summary hydration fails for one assignment): the card renders lesson title, class name, and state, and the progress line is replaced by `Progress temporarily unavailable`. Retry is offered by opening Assignment Detail. Errors never abort the whole dashboard.
- Error (list hydration fails): the section renders `Assignments temporarily unavailable` with a `Try again` affordance. The Curriculum lesson grid remains unaffected.

### 5.6 Accessibility

- Section is a `region` with `aria-label="Active assignments"`.
- Each card is a `group` with `aria-label` set to the assignment title plus class name.
- The progress line is announced as a single accessible string.
- Every affordance meets the existing LyfeLabz touch-target minimum from the canonical mobile stylesheet.
- No color is the sole carrier of information. The state label is always textual.

## 6. Assignment Detail Preservation

The Assignment Detail surface remains the single deep-inspection surface for one assignment. Sprint 15 extends it additively; nothing on the current header, summary card, or lifecycle-action row is removed or moved.

Additive additions on Assignment Detail:

- Roster grouped by progress state (`Submitted`, `In progress`, `Not started`) beneath the Assignment Summary card. Each group is a labelled list. Group counts match the summary counts exactly. Empty groups render `No students in this group.` rather than being hidden, so the teacher sees a complete factual picture.
- Per-question factual summary panel beneath the roster grouping. Rendered only when the number of completed attempts meets the Sprint 15 minimum-attempt threshold (`>= 3`, see §7). Below the threshold, the panel renders a single line: `Question-level results will appear after more students submit.`

The Assignment Summary card is not modified. The four-item navigation is not modified. The Sprint 13A ten-field aggregate projection is not modified.

## 7. Beta Non-Goals

The following are intentionally excluded from the Sprint 14 dashboard and the Sprint 15 implementation. They may not be added without an explicit repository-level decision.

- Gradebook. LyfeLabz does not compute or display a report-card grade.
- Messaging. LyfeLabz does not send email, DM, chat, or in-app messages.
- Notifications. LyfeLabz does not raise push, email, marketing, or engagement notifications.
- Attendance.
- Student ranking of any kind.
- Engagement scoring of any kind.
- Predictive analytics.
- AI-generated recommendations, next-step suggestions, or auto-generated feedback.
- Administrator performance dashboards.
- Parent portal or parent-facing views.
- Cross-assignment trend analysis.
- Automated grouping of students.
- Suggested interventions.
- Time-on-task metrics.
- Cross-class or cross-teacher comparisons.
- Any dashboard configuration surface beyond the single `Show closed` toggle.

These non-goals are operational, not aspirational. They prevent silent scope drift during Sprint 15 implementation.

## 8. Sprint 15 Preview

The Sprint 15 implementation plan (`SPRINT_15_IMPLEMENTATION_PLAN.md`) turns this specification into ordered slices. In brief:

1. Dashboard section scaffold on Curriculum, driven by the existing session-scoped registry (`published` set only, no per-card counts yet).
2. Additive `publishedAt` projection on `assignmentsTeacherList`.
3. Per-card progress counts via the existing `assessmentAssignmentSummary` callable (one call per active assignment; result cached in the session registry for the surface's lifetime).
4. New read-only callable `assignmentsRecipientList` and Assignment Detail roster grouping (`Submitted`, `In progress`, `Not started`).
5. Per-question factual summary on Assignment Detail, above the minimum-attempt threshold, aggregated client-side from `assessmentAttemptGetForTeacher`.
6. Loading, empty, and error states for the dashboard section and the Detail additions.
7. Accessibility, dark mode, and mobile validation; documentation reconciliation.

## 9. Documents Modified by Sprint 14

- `docs/platform/TEACHER_EXPERIENCE_PHILOSOPHY.md`: appended `§7 Platform Posture` and a Sprint 14 Reconciliation Notice.
- `docs/platform/SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`: this specification.
- `docs/platform/SPRINT_14_COMPLETION_REPORT.md`: the Sprint 14 completion report.
- `docs/platform/SPRINT_15_IMPLEMENTATION_PLAN.md`: the ordered Sprint 15 slice sequence.
- `docs/platform/SPRINT_HISTORY.md`: appended Sprint 14 entry.

No production code was modified.
