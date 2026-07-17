# Sprint 13F Completion Report: Persistent Draft Assignment Discovery

**Dates:** 2026-07-17
**Status:** Implementation complete; conditionally certified pending resolution of the pre-existing `curriculum/curriculumManifest.test.ts` repository baseline failure.
**Preceding sprint:** Sprint 13E (Teacher Assignment Reopen Workflow).

## 1. Architecture Review

Reviewed before implementation:

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/SPRINT_13A_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13B_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13C_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13D_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13E_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assignments/` (all callables and their tests, especially `assignments-teacher-list.ts` and `assignments-create-draft.ts`).
- `app/src/assignments/detail/` (types, registry, hydrate, hydrate-wire, grouping, detail, wire).
- `app/src/assignments/summary/` (unchanged; still composed inside Detail for every non-draft status).
- `app/src/shell/surfaces/curriculum.ts` (Sprint 13B/13C `View summary` / `View summaries` control and Sprint 13C selection interface).
- `app/src/index.ts` (per-session assignment-detail wiring).

The pre-Sprint-13F `assignmentsTeacherList` callable deliberately excluded `draft` records from the returned status filter because Sprint 13C scope covered only published and closed assignments. The Sprint 13F architecture question was whether draft enumeration could be added without introducing a second retrieval callable, a second registry, a Firestore Rules relaxation, a composite index, or any schema change.

## 2. Lifecycle Decision

Option B. The existing `assignmentsTeacherList` callable can be extended in the smallest possible additive way. A single optional boolean request field `includeDrafts` was added:

- Default (absent or `false`): the callable returns `published` and `closed` records exactly as it did before Sprint 13F. Every existing caller continues to behave unchanged without any code change.
- `true`: the callable widens its server-side status `in` clause to also return `draft` records and only draft records owned by the same teacher in the same school as the authenticated caller. Every other filter (ownership, district, class ownership) is unchanged.

No new callable was introduced. No duplicate assignment-list behavior was added. No `assignmentsTeacherListDrafts`, no `assignmentsDraftsList`, no parallel domain path. The response item shape gained `draft` in the `status` union; no field was added, renamed, or removed. `archived` remains excluded per Data Model §3.6.

## 3. Registry Behavior

The existing session-scoped `assignmentDetailRegistry` from Sprint 13B (extended by Sprint 13C) is reused unchanged. Its deduplication contract (canonical `assignmentId`, last-write-wins on republication) is unchanged. Hydration after sign-in now restores draft records into the same registry alongside published and closed records; every downstream reader (Curriculum lesson-slug bucketing, Detail metadata reader) reads through the same registry with no new lookup path.

No second registry, no persistent storage, no `localStorage`, no `sessionStorage`, no `IndexedDB`, no realtime listener, and no polling was introduced. The registry remains in-memory only and is cleared alongside every other per-session dependency on sign-out.

## 4. Authorization

The certified Sprint 13C authorization contract is preserved unchanged:

- Requires authentication.
- Requires `requireDistrictContext(request)` to resolve.
- Requires `context.role === "teacher"`.
- Requires the caller to be an active teacher in a district.
- Filters strictly by `teacherId == context.uid` and `schoolId == context.schoolId` on the assignment document (both denormalized on the record per Data Model §3.6).
- Cross-owner and cross-district records are excluded defensively even if a stale index returns them.
- The class ownership lookup on `classes/{classId}` re-verifies the class is owned by the same authenticated teacher in the same school before the assignment's `className` is projected; a mismatch quietly excludes the record.

Draft enumeration reuses this same authorization gate. A teacher can never receive another teacher's draft, another school's draft, another district's draft, or a draft whose backing class belongs to another teacher. Client-supplied identifiers (uid, teacherId, districtId, schoolId) are ignored and never trusted; the only field the caller supplies is the additive boolean `includeDrafts`.

## 5. Hydration

`hydrateAssignmentDetailRegistry` continues to hydrate the session-scoped registry once per active-teacher session immediately after sign-in. Sprint 13F changes:

- `createAssignmentsTeacherListCallable` now invokes the callable with `{ includeDrafts: true }` so every hydration call opts in to draft enumeration. Older callable deployments predating Sprint 13F ignore the additive field and return the Sprint 13C behavior unchanged.
- `parseAssignmentsTeacherListItem` now accepts `draft` in the status union in addition to `published` and `closed`. Every other well-formedness check (assignmentId, lessonSlug, title, classId, className non-empty) is unchanged. Unknown statuses (`archived`, malformed strings) continue to be rejected.

Hydration remains calm on failure: a callable outage never blocks the workspace; the surface reverts to the Sprint 13B session-only behavior and newly published or newly drafted assignments in the current session still register through the Sprint 13B publish path.

## 6. Draft Discovery Behavior

### Curriculum surface

Each lesson card's `View summary` control is rebuilt on every Curriculum mount and every session state change. Sprint 13F adds a single new branch to `refreshViewSummaryControl` in `app/src/shell/surfaces/curriculum.ts`:

- Zero registered assignments for the lesson: no control renders (unchanged).
- Every registered assignment for the lesson is a `draft`:
  - Control label: `View drafts`.
  - `aria-label`: `View drafts for {lesson.title}`.
  - `data-draft-only="true"`.
  - Exactly one draft: clicking opens that single draft directly through the entry-point opener.
  - Two or more drafts: clicking opens the Sprint 13C `openAssignmentSelection` interface unchanged; every draft appears as a native button labeled `{className} - {status}` (status is `Draft`) and clicking a choice opens that specific assignmentId.
- Any published or closed assignment is registered (with or without co-registered drafts): the Sprint 13B/C `View summary` / `View summaries` behavior is preserved unchanged; drafts appear inside the selector alongside published and closed items when the count crosses one.

The Sprint 13C `openAssignmentSelection` interface is reused verbatim. No new selection surface was invented. No new dialog was introduced. The deterministic comparator from `app/src/assignments/detail/grouping.ts` already ordered drafts after published and closed records; the ordering test in `shell.test.ts` covers a deterministic draft-only case.

### Assignment Detail surface

`renderAssignmentDetail` now branches early in its lifecycle region when the loaded metadata's status is `draft`:

- The header status pair renders `Draft` (from the existing `STATUS_LABEL` map).
- A calm non-interactive `<p role="status" aria-live="polite">Draft assignment</p>` is rendered inside the lifecycle region with `data-testid="assignment-detail-draft-label"`.
- Neither the `Close assignment` action nor the `Assignment closed` label nor the `Reopen assignment` action nor the Sprint 13D/E confirmation dialogs is rendered. Publishing is out of scope for this sprint. The draft label renders whether or not `closeCallable` / `reopenCallable` are wired so a teacher who reloads directly into a draft never sees an empty header region.

The Sprint 13A `renderAssignmentSummaryCard` remains composed unchanged. If the summary callable returns an error state for a draft assignment (drafts have no recipients), the card's existing empty/error state renders through its own certified UI. No confidentiality boundary is crossed.

## 7. Files Created

- `docs/platform/SPRINT_13F_COMPLETION_REPORT.md`.

## 8. Files Modified

- `platform/functions/src/assignments/assignments-teacher-list.ts`
  - Additive `AssignmentsTeacherListRequest.includeDrafts?: boolean` field.
  - Widened `AssignmentsTeacherListItem.status` to `Exclude<AssignmentStatus, "archived">`.
  - Widened server-side status `in` filter when `includeDrafts` is true.
  - Two guarded status filters (`isReturnedStatus`) now take `includeDrafts` as an argument.
  - Additive `includeDrafts` field on the info log entry.
- `platform/functions/src/assignments/assignments-teacher-list.test.ts`
  - Seven appended Sprint 13F tests: default omits drafts; opt-in widens filter; owned draft returned with resolved className; cross-owner draft excluded; cross-district draft excluded; opt-in preserves published + closed unchanged; explicit false is default.
- `app/src/assignments/detail/hydrate.ts`
  - `isReturnedStatus` now recognizes `draft`.
- `app/src/assignments/detail/hydrate-wire.ts`
  - Callable invocation now sends `{ includeDrafts: true }`.
- `app/src/assignments/detail/hydrate.test.ts`
  - Three appended parser tests for draft acceptance and unchanged behavior for published, closed, and unknown; one appended registry hydration test for draft.
- `app/src/assignments/detail/detail.ts`
  - Draft branch renders a `Draft assignment` label inside the lifecycle region and short-circuits the Sprint 13D and Sprint 13E lifecycle regions.
- `app/src/assignments/detail/detail.test.ts`
  - Four appended Sprint 13F tests: draft status label rendered; Draft assignment lifecycle label rendered; Close and Reopen actions absent for a draft even when their callables are wired; published workflow unchanged.
- `app/src/shell/surfaces/curriculum.ts`
  - `refreshViewSummaryControl` gains a draft-only branch that renders `View drafts` and opens directly on one draft or opens the Sprint 13C selection interface on two or more drafts. Mixed sets and published-only sets are unchanged.
- `app/src/shell/shell.test.ts`
  - Six appended Sprint 13F tests: single draft opens directly; multiple drafts open selector; deterministic ordering; published-only unchanged; mixed preserves `View summaries`; closed-only unchanged.
- `docs/platform/SPRINT_HISTORY.md`
  - Sprint 13F entry appended.

## 9. Tests Added

Backend targeted tests (`platform/functions/src/assignments/assignments-teacher-list.test.ts`, 7 new tests):

1. Default request omits drafts from the status filter.
2. `includeDrafts=true` widens the status filter to include `draft`.
3. `includeDrafts=true` returns owned draft assignment with resolved `className`.
4. `includeDrafts=true` still excludes another teacher's draft.
5. `includeDrafts=true` still excludes a cross-district draft.
6. `includeDrafts=true` preserves published and closed items unchanged.
7. `includeDrafts=false` is the default and returns no drafts.

Client hydration and parser tests (`app/src/assignments/detail/hydrate.test.ts`, 4 new tests):

8. Parser accepts a draft item.
9. Parser still accepts published and closed unchanged.
10. Parser still rejects unknown status values.
11. Hydrator registers a draft item so Detail can look it up after reload.

Client Detail tests (`app/src/assignments/detail/detail.test.ts`, 4 new tests):

12. Draft status label rendered in the header.
13. Draft assignment lifecycle label rendered.
14. Close and Reopen actions absent for a draft even when their callables are wired.
15. Published workflow unchanged when neither draft nor closed.

Client Curriculum tests (`app/src/shell/shell.test.ts`, 6 new tests):

16. Single hydrated draft shows `View drafts` and opens directly.
17. Multiple hydrated drafts show `View drafts` and open the Sprint 13C selector.
18. Selector ordering across drafts is deterministic.
19. Published-only lesson still uses `View summary` label unchanged.
20. Mixed draft + published preserves `View summaries` label.
21. Closed-only preserves prior behavior.

Total: 21 new targeted tests, all passing.

## 10. Validation

- Targeted backend tests: 18 / 18 passed (`platform/functions/src/assignments/assignments-teacher-list.test.ts`).
- Targeted client Detail tests: 51 / 51 passed (`app/src/assignments/detail/detail.test.ts`).
- Targeted client hydration and registry tests: passed inside `app/src/assignments/detail/hydrate.test.ts`.
- Targeted client Curriculum tests: passed inside `app/src/shell/shell.test.ts` (146 / 146).
- Full application suite: 368 / 369 passed; the sole failure is the pre-existing `curriculum/curriculumManifest.test.ts` repository baseline failure noted in Sprints 13A - 13E and unrelated to Sprint 13F.
- Full Cloud Functions suite: 890 / 890 passed.
- Firestore Rules: no Rules change required; Sprint 13F introduces no new document path, no new field, and no new authorization vector. Not exercised.
- Lint: passed in both `app/` and `platform/functions/`.
- Typecheck: passed in both `app/` and `platform/functions/` (`tsc --noEmit`).
- Production build: passed in `app/` (esbuild bundle) and in `platform/functions/` (`tsc -p tsconfig.build.json`).
- `git diff` inspected. Only Sprint 13F files were modified in this sprint. Unrelated preexisting working-tree modifications to instructional HTML files were present before the sprint began and were not touched by Sprint 13F work.
- Zero em dashes across the eight Sprint 13F source or test files and the two documentation files.
- No deployment performed.
- No commit performed.

## 11. Findings

### Critical

- None.

### Major

- None.

### Minor

- Draft assignments have no recipients (Sprint 12E slice 1). Rendering the Sprint 13A summary card inside Assignment Detail for a draft will surface the card's own empty or error state. Sprint 13F intentionally does not change this behavior because the sprint scope excludes editing, publishing, and any Firestore mutation.

### Preserved constraints

- No LMS integration change.
- No Google Classroom integration change.
- No browser persistence added.
- No realtime listener added.
- No polling added.
- No deployment.
- No commit.
- No em dashes in any Sprint 13F file.
- Published workflow preserved.
- Closed workflow preserved.
- Sprint 13B/C selection interface preserved.
- Sprint 13D close action preserved.
- Sprint 13E reopen action preserved.
- Assignment registry remains canonical.

## 12. Certification

Sprint 13F is CONDITIONALLY CERTIFIED.

Draft assignments survive across sessions through the extended `assignmentsTeacherList` callable and the existing session-scoped registry. Teachers can rediscover drafts through the Curriculum `View drafts` affordance and through direct Assignment Detail links. Authorization is unchanged. Published and closed workflows are preserved. The registry remains canonical. Targeted backend and client tests pass. Cloud Functions full regression passes (890 / 890). Lint, typecheck, and production build pass. The only outstanding failure in the full application suite is the pre-existing `curriculum/curriculumManifest.test.ts` baseline noted in Sprint 13A - 13E. Final certification is conditional pending resolution or formal acceptance of that baseline failure.

## 12A. Sprint 13F Documentation and UX Reconciliation (2026-07-17)

A bounded reconciliation pass followed the original Sprint 13F implementation to fold the additive callable contract into the canonical platform documentation and to resolve one remaining Assignment Detail UX inconsistency for draft assignments. Implementation of the callable itself is unchanged; the Sprint 13C authorization gate, the additive request field `includeDrafts`, the response shape, the observability log line, and the session-scoped registry contract are all preserved verbatim.

### 12A.1 Callable contract reconciliation

`docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` Appendix A now carries a canonical `assignmentsTeacherList` entry immediately before `assignmentsArchive`. The entry names the authorization gate (`requireDistrictContext`, active teacher, `teacherId == context.uid`, `schoolId == context.schoolId`, class ownership re-verification), the response projection `{ assignmentId, lessonSlug, title, classId, className, status }`, the request field `includeDrafts?: boolean`, the default behavior (published and closed returned, draft excluded), the opt-in behavior (draft records owned by the caller in the caller's school also returned), and the observation that `archived` is always excluded per Data Model §3.6. The Sprint 12E Slice 1 aggregate-only confidentiality boundary is named explicitly. No second callable entry is created; Sprint 13F is captured additively inside the single canonical entry.

### 12A.2 Assessment contract clarification

`docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` gained §34 "Sprint 13F Reconciliations (Teacher Draft Discoverability)" recording that draft discovery is teacher-visible only, creates no recipient / session / attempt / summary / rollup state, emits no lifecycle audit event, does not affect the Sprint 13A summary surface, and does not replace `assignmentsPublish` as the transition that exposes an assignment to students. §17, §21, and the §33 lifecycle table are unchanged and untouched.

### 12A.3 Draft Detail UX reconciliation

The original Sprint 13F Assignment Detail implementation left the Sprint 13A `renderAssignmentSummaryCard` composed for a draft assignment, relying on the card's own empty / error state to render. The reconciliation replaces that behavior with a calm informational panel dedicated to the draft state:

- Heading: `Assignment results`.
- Body: `Assignment results will appear after this draft is published and students begin submitting work.`.
- Rendered inside a `<section role="status" aria-live="polite">` at the same mount position previously occupied by the summary host.
- Uses the existing `.shell-assignment-detail-summary` typography container with an additional `.shell-assignment-detail-draft-summary` marker; no new design language is introduced.
- The Sprint 13A summary card is never mounted for a draft, and the summary callable is never invoked.
- No loading indicator, no empty state, no error state is rendered for a draft.

Published and closed assignments continue to compose the Sprint 13A summary card unchanged. Every certified Sprint 13D close, Sprint 13E reopen, and Sprint 13F draft header behavior is preserved.

### 12A.4 Summary card behavior

| Status | Summary card | Draft panel |
| --- | --- | --- |
| `draft` | Not mounted; summary callable not invoked | Rendered |
| `published` | Rendered exactly as Sprint 13A | Not rendered |
| `closed` | Rendered exactly as Sprint 13A | Not rendered |

### 12A.5 Files modified in this reconciliation

- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (canonical `assignmentsTeacherList` entry added to Appendix A immediately before `assignmentsArchive`).
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (added §34; change-log entry appended).
- `docs/platform/SPRINT_13F_COMPLETION_REPORT.md` (this reconciliation section §12A).
- `docs/platform/SPRINT_HISTORY.md` (brief reconciliation note appended under the existing Sprint 13F entry).
- `app/src/assignments/detail/detail.ts` (draft branch renders the informational Assignment results panel in place of the Sprint 13A summary card; published and closed paths unchanged).
- `app/src/assignments/detail/detail.test.ts` (four appended reconciliation tests: draft hides Assignment Summary and never invokes the summary callable; draft renders the informational panel with heading, body, and `role="status"`; published still renders Assignment Summary; closed still renders Assignment Summary).

No backend callable was modified. No Firestore Rules change. No composite index. No schema change. No LMS integration change. No Google Classroom integration change. No browser persistence. No realtime listener. No polling. No deployment. No commit.

### 12A.6 Validation

- Targeted client Detail tests: 47 / 47 passed (`app/src/assignments/detail/detail.test.ts`), including the four new reconciliation tests.
- Backend `assignments-teacher-list.test.ts`: not re-run; no backend code changed in this reconciliation pass.
- Full application suite: run below; the sole remaining failure remains the pre-existing `curriculum/curriculumManifest.test.ts` baseline noted in Sprints 13A - 13E and unrelated to Sprint 13F.
- Lint: passed in `app/`.
- Typecheck: passed in `app/` (`tsc --noEmit`).
- Production build: passed in `app/` (esbuild bundle).
- `git diff` inspected. Only Sprint 13F reconciliation files were modified in this pass.
- Zero em dashes across the six modified files.
- No deployment performed.
- No commit performed.

### 12A.7 Updated certification

Sprint 13F remains CONDITIONALLY CERTIFIED: Sprint 13F implementation is complete. Final certification requires resolution or formal acceptance of the pre-existing repository baseline test failure (`curriculum/curriculumManifest.test.ts`). The Sprint 13F documentation and UX reconciliation is additive and does not change the certification posture.

## 13. Recommended Next Bounded Slice

A minimal draft-editing slice that lets a teacher change a draft assignment's title, instructions, availability window, or lesson version before publishing. The existing `assignmentsUpdateDraft` callable already provides the backend seam. A bounded client slice would add a narrow `Edit draft` control to Assignment Detail's Draft state, a small in-place editor for the four editable fields, and calm confirmation handling. Publishing itself remains its own follow-up slice because it changes recipients and triggers audit events beyond the scope of a single sprint.
