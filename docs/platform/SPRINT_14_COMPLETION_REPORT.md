# Sprint 14 Completion Report: Teacher Dashboard and Attention Model Design

**Date:** 2026-07-18
**Status:** COMPLETE (documentation and design only). No production code was modified.
**Companion documents:** `SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`, `SPRINT_15_IMPLEMENTATION_PLAN.md`, `SPRINT_13_FINAL_CERTIFICATION.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md` (§7 Platform Posture).

## 1. Sprint Objective

Define the minimum teacher dashboard and attention model required to support the certified Sprint 13 assignment lifecycle. Reconcile that design with the current repository state. Produce an implementation-ready Sprint 15 plan.

## 2. Scope

- Documentation-only. No callable, Firestore Rules, index, schema, LMS, Google Classroom, notification, browser persistence, realtime listener, or polling change was introduced.
- A concise Platform Posture section was appended to `TEACHER_EXPERIENCE_PHILOSOPHY.md` as §7. No new standalone philosophical document was created.
- The Sprint 14 dashboard and attention model specification (`SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`) was produced.
- The Sprint 15 implementation plan (`SPRINT_15_IMPLEMENTATION_PLAN.md`) was produced.
- The Sprint 14 entry was appended to `SPRINT_HISTORY.md`.

## 3. Repository Findings Summary

- The certified Sprint 13 teacher assignment lifecycle (draft, published, closed, reopen, plus persistent rediscovery) is stable and internally consistent per `SPRINT_13_FINAL_CERTIFICATION.md`.
- Curriculum remains the primary landing experience under `TEACHER_EXPERIENCE_PHILOSOPHY.md` §3.2.
- The four-item Teacher Workspace navigation (Curriculum, Classes, Present Mode, Settings) is canonical and remains untouched.
- The session-scoped `assignmentDetailRegistry` and `assignmentsTeacherList` reload-hydration path already provide the enumeration a dashboard needs; no parallel enumeration is required.
- `assessmentAssignmentSummary` provides the aggregate progress counts the dashboard needs. `assessmentAttemptsListForClass` provides the completed-attempt roster required for the `Submitted` group in Assignment Detail. `assessmentAttemptGetForTeacher` provides the per-attempt `itemResults` required for the per-question factual summary in Assignment Detail.
- Two gaps were identified for the beta dashboard, both addressed by narrowly bounded additive work in Sprint 15:
  - Frozen recipient enumeration for the owning teacher. Sprint 15 introduces one new callable, `assignmentsRecipientList`, mirroring the authorization gate of `assessmentAssignmentSummary`.
  - Per-question aggregation across completed attempts. Sprint 15 aggregates client-side above a minimum-attempt threshold; persistent `assignmentRollups` / `attemptRollups` remain the deferred scalable path under PDR-029n.

## 4. Final Dashboard Definition (summary of Sprint 14 §5)

- Placement: an `Active assignments` section at the top of the Curriculum surface, above the lesson grid. The section is silent when there are no `published` (or, when `Show closed` is on, `closed`) assignments.
- Card contents: lesson title, class name, progress line (`${submittedCount} submitted / ${startedCount} started / ${totalEnrolled} total`), published date, and an `Open assignment` affordance to the certified Assignment Detail surface.
- Ordering: most recent `publishedAt` first, then class name ascending, then title ascending, then `assignmentId` as the final tie-breaker.
- Controls: a single deterministic `Show closed` toggle, defaulting to off. Drafts remain reachable through the certified Curriculum `View drafts` control (Sprint 13F).
- States: loading, empty-published-only-hidden, empty-with-closed-toggle-on, per-card summary error fallback (`Progress temporarily unavailable`), and section-level list error fallback (`Assignments temporarily unavailable` with `Try again`).
- Accessibility: `role="region"` with `aria-label="Active assignments"`; per-card `aria-label` combining title and class name; canonical mobile touch-target minimums.

## 5. Final Teacher Attention Model (summary of Sprint 14 §4)

Assignment state, student progress state, and teacher attention information are kept distinct.

- Assignment state: the certified lifecycle labels only (`draft`, `published`, `closed`; `archived` remains silent).
- Student progress state: `notStarted`, `inProgress`, `completed`. Derived mechanically from the counts `assessmentAssignmentSummary` already returns. No fourth state is invented.
- Teacher attention information on the dashboard: factual counts and published date, plus the `Open assignment` affordance.
- Teacher attention information on Assignment Detail: the certified Assignment Summary card (unchanged), a roster grouped by progress state, and a per-question factual summary above the minimum-attempt threshold. Empty groups are rendered explicitly; below the threshold, the per-question panel renders a single deferred-availability line and fetches nothing.

Every displayed value traces to stored assignment, session, attempt, or submission data per the derivation table in Sprint 14 §4.4.

## 6. Explicit Beta Non-Goals (summary of Sprint 14 §7)

Excluded from the beta dashboard and from Sprint 15: gradebook, messaging, notifications, attendance, student ranking, engagement scoring, predictive analytics, AI-generated recommendations, administrator performance dashboards, parent portal, cross-assignment trend analysis, automated grouping, suggested interventions, time-on-task metrics, cross-class or cross-teacher comparisons, and any dashboard configuration surface beyond the single `Show closed` toggle.

## 7. Sprint 15 Implementation Slices (summary of Sprint 15 §3)

1. Dashboard section scaffold on Curriculum.
2. Additive `publishedAt` projection on `assignmentsTeacherList`.
3. Per-card progress counts via `assessmentAssignmentSummary`.
4. `Show closed` toggle.
5. New `assignmentsRecipientList` callable and Assignment Detail roster grouping.
6. Per-question factual summary above the minimum-attempt threshold.
7. Loading, empty, error, accessibility, and documentation reconciliation.

The Sprint 15 plan carries per-slice user-visible outcomes, file lists, backend and Firestore dependencies, Rules implications, hydration requirements, tests, and acceptance criteria.

## 8. Files Created or Modified

Created:

- `docs/platform/SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`.
- `docs/platform/SPRINT_14_COMPLETION_REPORT.md` (this document).
- `docs/platform/SPRINT_15_IMPLEMENTATION_PLAN.md`.

Modified:

- `docs/platform/TEACHER_EXPERIENCE_PHILOSOPHY.md` (appended §7 Platform Posture and Sprint 14 Reconciliation Notice).
- `docs/platform/SPRINT_HISTORY.md` (appended Sprint 14 entry).

No production code file was modified.

## 9. Validation Results

- Terminology check: dashboard, attention model, and non-goals language matches the certified Sprint 13 assignment lifecycle terminology (`draft`, `published`, `closed`, `archived`; `assignmentDetailRegistry`; `assignmentsTeacherList`; `assessmentAssignmentSummary`).
- Em dash check: zero em dashes across `SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md`, `SPRINT_14_COMPLETION_REPORT.md`, `SPRINT_15_IMPLEMENTATION_PLAN.md`, and the appended `TEACHER_EXPERIENCE_PHILOSOPHY.md` §7 section.
- Repository-relative links: verified against the current `docs/platform/` directory. Every referenced document exists.
- Internal consistency: `SPRINT_14_DASHBOARD_AND_ATTENTION_MODEL_SPECIFICATION.md` §4.4 derivation table, `TEACHER_EXPERIENCE_PHILOSOPHY.md` §7 posture, and `SPRINT_15_IMPLEMENTATION_PLAN.md` §3 slices agree on data sources, callable identities, and confidentiality boundaries.
- No production behavior changed. No callable, Firestore Rules, index, schema, LMS, Google Classroom, notification, browser persistence, realtime listener, or polling change.
- No deployment. No commit.

## 10. Blockers Requiring Resolution Before Implementation

None. Sprint 15 is ready to begin against the plan in `SPRINT_15_IMPLEMENTATION_PLAN.md`. The pre-existing `curriculum/curriculumManifest.test.ts` baseline drift documented in `SPRINT_13_FINAL_CERTIFICATION.md` §11 continues to be the only outstanding suite failure and remains formally accepted for the purpose of proceeding.
