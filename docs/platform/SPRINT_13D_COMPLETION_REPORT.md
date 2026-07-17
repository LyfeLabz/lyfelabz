# Sprint 13D Completion Report: Teacher Assignment Status Management Foundation (Close Assignment)

**Dates:** 2026-07-17
**Status:** Implementation complete; conditionally certified pending resolution of the pre-existing `curriculum/curriculumManifest.test.ts` repository baseline failure.
**Preceding sprint:** Sprint 13C (Persistent Teacher Assignment Enumeration and Detail Access).

## 1. Architecture Review

Reviewed before implementation:

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/SPRINT_13A_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13B_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13C_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assignments/` (all callables)
- `platform/functions/src/index.ts`
- `app/src/assignments/`
- `app/src/shell/`
- `app/src/index.ts`

The canonical assignment-close backend callable already exists at `platform/functions/src/assignments/assignments-close.ts` and is exported from `platform/functions/src/assignments/index.ts` and `platform/functions/src/index.ts`. It is authenticated through `requireDistrictContext`, restricted to the active-teacher role, enforces owning-teacher and same-school ownership, transitions the canonical `assignments/{assignmentId}` `status` field from `published` to `closed` through the certified `assignmentCloseDocRef` typed write helper (Data Model 3.6), writes one canonical `assignments.closed` audit event through the certified `writeAuditEvent` helper, and is idempotent for records that are already `closed`. Eleven targeted backend tests were already in place and passing.

## 2. Lifecycle Path Selected

Option A. Reuse the existing certified `assignmentsClose` callable exactly. No new callable was introduced. No backwards-incompatible additive extension was made. No reopen, archive, delete, edit, duplicate, or roster mutation was introduced. No Firestore Rules relaxation, composite index, schema change, or Google Classroom or LMS side effect was introduced.

## 3. Authorization

The certified backend authorization contract is preserved without modification:

- Requires authentication.
- Requires `requireDistrictContext(request)` to resolve.
- Requires `context.role === "teacher"`; every other role is rejected with the canonical `role-forbidden` code before any Firestore access.
- Requires `existing.teacherId === context.uid` and `existing.schoolId === context.schoolId` on the loaded record; every other case is rejected with `assignments.forbidden`.
- Client identity is never trusted. The request payload carries only `assignmentId`.
- District boundary is enforced through `context.schoolId` derived from the certified helper against the denormalized `schoolId` on the assignment record.

## 4. Status Transition

The canonical `assignments/{assignmentId}.status` field transitions from `published` to `closed` through the narrow `assignmentCloseDocRef(assignmentId).update({ status: "closed" })` typed write. `recipients`, `attempts`, `sessions`, `summaries`, `lessonSlug`, `lessonVersion`, `classId`, `teacherId`, `schoolId`, and every other field are untouched. Already-`closed` records are idempotent and return `{ status: "closed", alreadyClosed: true }` with no second write and no second audit event. Non-`published` non-`closed` current statuses (`draft`, `archived`) are rejected with `assignments.invalidTransition`.

## 5. Confirmation Flow

On the Assignment Detail surface, a `published` assignment now renders a secondary `Close assignment` action inside the header lifecycle region. Activating the action opens a calm accessible confirmation dialog reusing the existing `.shell-assign-overlay` / `.shell-assign-dialog` / `.shell-assign-title` / `.shell-assign-body` / `.shell-assign-footer` visual language:

- Title: `Close this assignment?`
- Description: `Students will no longer be able to submit new work. Existing submissions and summaries will remain available.`
- Buttons: `Cancel` and `Close assignment`.
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` bound to the title, `aria-describedby` bound to the description.
- Focus lands on `Cancel` for calm defaults; Escape and click-outside dismiss without invoking the callable.

`Cancel` closes the dialog and leaves the assignment unchanged. `Close assignment` closes the dialog and invokes the certified callable exactly once. On success the header status pair updates to `Closed`, the action is removed, and a non-interactive `Assignment closed` label (with `role="status"` and `aria-live="polite"`) replaces it. On failure the assignment remains `Published`, the `Close assignment` action is preserved, and a generic teacher-facing error message renders through `role="alert"`. The error text does not name Firestore, callable identifiers, stack traces, or document paths.

A `closed` assignment renders the `Assignment closed` label directly and no action button. Neither state renders `Edit`, `Delete`, `Archive`, `Reopen`, or `Duplicate`.

## 6. Audit Behavior

The certified backend writes exactly one `assignments.closed` audit event per successful close through the canonical `writeAuditEvent` helper, carrying the actor uid, actor role (`teacher`), target type (`assignment`), target id, `schoolId`, `districtId`, and `{ classId }` payload. Already-`closed` idempotent calls do not write a second audit event. No new audit surface, code, or duplication was introduced in this sprint.

## 7. Client Integration

- `app/src/assignments/detail/types.ts` gained two additive types: `AssignmentsCloseResult` (the canonical `{ assignmentId, status: "closed", alreadyClosed }` response) and `AssignmentsCloseCallable` (the injected callable seam).
- `app/src/assignments/detail/close-wire.ts` (new) wires the certified `assignmentsClose` callable through `httpsCallable`. This is the seam that keeps the pure Assignment Detail surface free of `firebase/*` imports; it mirrors the Sprint 13A `summary/wire.ts` and Sprint 13C `hydrate-wire.ts` patterns. The wire parses the response through explicit field-shape checks, rejecting on any unexpected shape.
- `app/src/assignments/detail/detail.ts` renders the `Close assignment` action, the confirmation dialog, the closed-state label, and the pending / error UI. It imports nothing from `firebase/*`, opens no snapshot listener, and touches no browser storage. The posture test in `detail.test.ts` continues to enforce this. On successful close the local metadata is transitioned to `closed` in place; a `onStatusChange(metadata)` callback (optional) fires so the entry point can re-register the updated metadata into the session-scoped registry.
- `app/src/index.ts` binds `assignmentClose = createAssignmentsCloseCallable(functions)` inside the active-teacher branch of `rerun`, clears it on every non-teacher branch, and passes both `closeCallable` and `onStatusChange` (which calls `assignmentDetailRegistry.register(metadata)`) into `renderAssignmentDetail`. Every other seam wired into the entry point is unchanged.

## 8. Curriculum Compatibility

Sprint 13A Assignment Summary continues to render unchanged inside the Sprint 13B Assignment Detail surface. The Sprint 13C multiple-assignment selection interface continues to function unchanged: hydrated closed assignments still appear through `assignmentsTeacherList` and open the certified Assignment Detail surface, where the header now correctly reflects the `Closed` status and the closed-state label. After a successful close, the registered metadata is updated in place, so a subsequent navigation back to Curriculum reflects the new status through the existing selection labels (`className status`) without a full reload. Neither the four-item Teacher Workspace navigation nor the Curriculum surface itself was modified in this sprint.

## 9. Files Created

- `app/src/assignments/detail/close-wire.ts`.
- `app/src/assignments/detail/close-wire.test.ts`.
- `docs/platform/SPRINT_13D_COMPLETION_REPORT.md`.

## 10. Files Modified

- `app/src/assignments/detail/types.ts` (additive `AssignmentsCloseResult` and `AssignmentsCloseCallable` types).
- `app/src/assignments/detail/detail.ts` (Close assignment action, confirmation dialog, closed-state label, pending / error handling; no new firebase imports, no snapshot listener, no browser storage).
- `app/src/assignments/detail/detail.test.ts` (nine new lifecycle tests appended; posture test unchanged).
- `app/src/index.ts` (per-session `assignmentClose` binding; wiring passed into `renderAssignmentDetail`).
- `docs/platform/SPRINT_HISTORY.md` (Sprint 13D entry appended).

## 11. Tests Added

Backend targeted tests already existed at `platform/functions/src/assignments/assignments-close.test.ts` (11 tests) covering active teacher succeeds, student rejected, pending teacher rejected, inactive teacher rejected, wrong district rejected, wrong teacher rejected, already-closed handled safely, status updates correctly, audit behavior correct, and validation of malformed and missing inputs. No modification was required.

New client tests:

- `app/src/assignments/detail/detail.test.ts` (nine appended tests, all under `describe("renderAssignmentDetail - close lifecycle (Sprint 13D)")`):
  1. Published assignment shows the Close assignment action when the callable is wired.
  2. Closed assignment shows the Assignment closed label and no action.
  3. No lifecycle scaffold is rendered when the callable is not wired.
  4. Clicking Close assignment opens the confirmation dialog.
  5. Cancel leaves the assignment unchanged and never invokes the callable.
  6. Confirm invokes the callable exactly once and updates the header to Closed.
  7. Failure preserves the Published state and renders a generic error message.
  8. Escape closes the confirmation dialog without invoking the callable.
  9. Back button remains functional in the closed state after a successful close.
- `app/src/assignments/detail/close-wire.test.ts` (four tests): invokes the callable with the correct name and payload; propagates already-closed idempotent responses; rejects malformed responses; rejects when the callable itself rejects.

## 12. Validation

- Targeted backend `assignments-close` suite: 11 of 11 passed.
- Full Cloud Functions regression: 39 suites, 872 of 872 tests passed.
- Targeted Assignment Detail suite (`src/assignments/detail`): 4 suites, 49 of 49 tests passed (30 detail, plus registry / hydrate / grouping suites).
- Targeted Assignment Summary suite: unchanged and passing (18 tests).
- All assignments client tests: 5 suites, 67 of 67 tests passed.
- Shell suite (Curriculum / navigation / summary-selection): 140 of 140 tests passed.
- Full application test suite: 341 of 342 tests passed. Sole failure: `curriculum/curriculumManifest.test.ts`, exactly as observed at Sprint 13B and 13C. The failure reproduces outside Sprint 13D scope; Sprint 13D did not modify curriculum manifests, curriculum generation, or build tooling.
- Application lint: passed.
- Cloud Functions lint: passed.
- Application typecheck: passed.
- Cloud Functions typecheck: passed.
- Application production build (`npm run build`): passed.
- Firestore Rules: unchanged, no rules-suite run required for this sprint.
- No deployment.
- No commit.
- No changes to LMS integration, Google Classroom, notification system, browser persistence, realtime listener wiring, or polling behavior.
- Manual `git status` inspection confirms only the intended Sprint 13D files under `app/src/assignments/detail/`, `app/src/index.ts`, and `docs/platform/SPRINT_13D_COMPLETION_REPORT.md` / `docs/platform/SPRINT_HISTORY.md` are modified. The seven unrelated top-level HTML files that were already dirty on entry to this session remain unchanged by Sprint 13D.
- Em dashes: zero across `SPRINT_13D_COMPLETION_REPORT.md` and the new Sprint 13D entry in `SPRINT_HISTORY.md` (verified through targeted grep).

## 13. Findings

None of severity higher than informational.

- Informational: The Sprint 13A summary card inside the detail surface continues to load through the certified `assessmentAssignmentSummary` callable. When a teacher closes an assignment the summary metrics do not refresh automatically because that would require re-invoking the summary callable; the existing card behavior is preserved without modification per Sprint 13A boundary. Refresh occurs naturally on the next reopen. This is intentional and out of scope for Sprint 13D.

## 14. Certification

CONDITIONALLY CERTIFIED: Sprint 13D implementation is complete. Final certification requires resolution or formal acceptance of the pre-existing repository baseline test failure (`curriculum/curriculumManifest.test.ts`), which is unrelated to Sprint 13D scope and reproduces outside it.

## 15. Recommended Next Bounded Slice

The next narrowly bounded slice should introduce a certified assignment reopening path, `assignmentsReopen`, so a teacher may transition a `closed` assignment back to `published` when a class needs additional submission time. It should reuse the district / role / owning-teacher authorization already certified for `assignmentsClose`, transition only the canonical `status` field, emit exactly one `assignments.reopened` audit event, and surface a single secondary `Reopen assignment` action beneath the Assignment closed label on the detail surface. It should not introduce archive, delete, edit, duplicate, notifications, roster mutation, or bulk operations.
