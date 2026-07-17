# Sprint 13E Completion Report: Teacher Assignment Reopen Workflow

**Dates:** 2026-07-17
**Status:** Implementation complete; conditionally certified pending resolution of the pre-existing `curriculum/curriculumManifest.test.ts` repository baseline failure.
**Preceding sprint:** Sprint 13D (Teacher Assignment Status Management Foundation - Close Assignment).

## 1. Architecture Review

Reviewed before implementation:

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/SPRINT_13D_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assignments/` (all callables and their tests)
- `platform/functions/src/index.ts`
- `platform/functions/src/shared/types/assignment.ts`
- `platform/functions/src/shared/types/audit-event.ts`
- `platform/functions/src/shared/firestore/typed-ref.ts`
- `platform/functions/src/shared/index.ts`
- `app/src/assignments/detail/`
- `app/src/index.ts`

No certified `assignmentsReopen` callable existed prior to this sprint. The canonical `assignmentsClose` callable and its typed write helper (`assignmentCloseDocRef`) and write shape (`AssignmentCloseWrite`) provide the exact seam pattern the inverse lifecycle transition must mirror: narrow field-scoped update through a typed reference, canonical `writeAuditEvent`, `requireDistrictContext` gate, owning-teacher and same-school ownership check on the loaded record, and idempotent handling of a repeated request. The Sprint 13D client seams (`close-wire.ts`, `AssignmentsCloseCallable`, `closeCallable` dep, `Close assignment` action, close confirmation dialog, `onStatusChange` re-registration path) provide the exact client pattern the inverse action must mirror.

## 2. Lifecycle Path Selected

Option C. No certified reopen callable existed and no backward-compatible additive extension of an existing lifecycle callable would satisfy the brief cleanly. One narrowly bounded new callable, `assignmentsReopen`, was created in the assignments domain. No archive, delete, edit, duplicate, notifications, grading, roster mutation, analytics, or bulk operation was introduced. No Firestore Rules relaxation, composite index, schema change, Google Classroom side effect, or LMS side effect was introduced.

## 3. Authorization

The certified backend authorization contract mirrors Sprint 13D exactly:

- Requires authentication.
- Requires `requireDistrictContext(request)` to resolve.
- Requires `context.role === "teacher"`; every other role (student, pending teacher, inactive teacher, platform administrator) is rejected with the canonical `role-forbidden` code before any Firestore access.
- Requires `existing.teacherId === context.uid` and `existing.schoolId === context.schoolId` on the loaded record; every other case is rejected with `assignments.forbidden`.
- Client identity is never trusted. The request payload carries only `assignmentId`.
- District boundary is enforced through `context.schoolId` derived from the certified helper against the denormalized `schoolId` on the assignment record.

## 4. Status Transition

The canonical `assignments/{assignmentId}.status` field transitions from `closed` back to `published` through the narrow `assignmentReopenDocRef(assignmentId).update({ status: "published" })` typed write. The write shape is a new `AssignmentReopenWrite` type declared alongside the other lifecycle write shapes in `platform/functions/src/shared/types/assignment.ts`. Recipients, attempts, sessions, summaries, answer keys, `lessonSlug`, `lessonVersion`, `classId`, `teacherId`, `schoolId`, and every other field are untouched. Already-`published` records are idempotent and return `{ status: "published", alreadyPublished: true }` with no second write and no second audit event. Non-`closed` non-`published` current statuses (`draft`, `archived`) are rejected with `assignments.invalidTransition`.

## 5. Confirmation Dialog

On the Assignment Detail surface, a `closed` assignment now renders a secondary `Reopen assignment` action inside the header lifecycle region when the `reopenCallable` seam is wired. This supersedes the Sprint 13D `Assignment closed` label so exactly one lifecycle action is visible. Activating the action opens a calm accessible confirmation dialog reusing the existing `.shell-assign-overlay` / `.shell-assign-dialog` / `.shell-assign-title` / `.shell-assign-body` / `.shell-assign-footer` visual language:

- Title: `Reopen this assignment?`
- Description: `Students will be able to submit new work again. Existing submissions and summaries will remain available.`
- Buttons: `Cancel` and `Reopen assignment`.
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` bound to the title, `aria-describedby` bound to the description.
- Focus lands on `Cancel` for calm defaults; Escape and click-outside dismiss without invoking the callable.

`Cancel` closes the dialog and leaves the assignment unchanged. `Reopen assignment` closes the dialog and invokes the certified callable exactly once. On success the header status pair updates to `Published`, the `Reopen assignment` action is removed, and the Sprint 13D `Close assignment` action renders in its place (when `closeCallable` is also wired). On failure the assignment remains `Closed`, the `Reopen assignment` action is preserved, and a generic teacher-facing error message renders through `role="alert"`. The error text does not name Firestore, callable identifiers, stack traces, or document paths.

When the `reopenCallable` seam is not supplied, the surface renders no reopen action and the Sprint 13D `Assignment closed` label continues to render unchanged. The Sprint 13D `Close assignment` action, its confirmation dialog, and its failure UI are unmodified when `reopenCallable` is present.

## 6. Audit Behavior

The certified backend writes exactly one `assignments.reopened` audit event per successful reopen through the canonical `writeAuditEvent` helper, carrying the actor uid, actor role (`teacher`), target type (`assignment`), target id, `schoolId`, `districtId`, and `{ classId }` payload. The `assignments.reopened` value was added to the canonical `AuditAction` union in `platform/functions/src/shared/types/audit-event.ts` alongside the other assignment lifecycle actions (`assignments.published`, `assignments.closed`, `assignments.archived`). Already-`published` idempotent calls do not write a second audit event.

## 7. Registry Update Behavior

The Sprint 13D `onStatusChange(metadata)` callback fires with the updated metadata after a successful reopen. The entry point re-registers the metadata into the Sprint 13B / 13C session-scoped `assignmentDetailRegistry` through the existing status-change path (`assignmentDetailRegistry.register(metadata)`). No page reload is performed. The registry deduplicates by canonical `assignmentId`, so the newly-published copy supersedes the previously-closed hydrated copy in place.

## 8. Curriculum Compatibility

Sprint 13A Assignment Summary continues to render unchanged inside the Assignment Detail surface. The Sprint 13C multiple-assignment selection interface continues to function unchanged: hydrated closed assignments still appear through `assignmentsTeacherList`; opening one now surfaces the `Reopen assignment` action; after a successful reopen, the registered metadata updates in place, so a subsequent navigation back to Curriculum reflects the new `Published` status through the existing selection labels (`className status`) without a full reload. Hydration behavior is unchanged. Neither the four-item Teacher Workspace navigation nor the Curriculum surface itself was modified in this sprint.

## 9. Files Created

- `platform/functions/src/assignments/assignments-reopen.ts`.
- `platform/functions/src/assignments/assignments-reopen.test.ts`.
- `app/src/assignments/detail/reopen-wire.ts`.
- `app/src/assignments/detail/reopen-wire.test.ts`.
- `docs/platform/SPRINT_13E_COMPLETION_REPORT.md`.

## 10. Files Modified

- `platform/functions/src/shared/types/assignment.ts` (additive `AssignmentReopenWrite` write shape).
- `platform/functions/src/shared/types/audit-event.ts` (additive `assignments.reopened` audit action).
- `platform/functions/src/shared/firestore/typed-ref.ts` (additive `assignmentReopenDocRef` typed reference).
- `platform/functions/src/shared/index.ts` (additive re-exports).
- `platform/functions/src/assignments/index.ts` (additive re-export of the new callable and its types).
- `platform/functions/src/index.ts` (additive callable registration).
- `app/src/assignments/detail/types.ts` (additive `AssignmentsReopenResult` and `AssignmentsReopenCallable` types).
- `app/src/assignments/detail/detail.ts` (Reopen assignment action, confirmation dialog, pending / error handling; no new firebase imports, no snapshot listener, no browser storage).
- `app/src/assignments/detail/detail.test.ts` (nine appended reopen-lifecycle tests; posture test unchanged and still passing).
- `app/src/index.ts` (per-session `assignmentReopen` binding; wired into `renderAssignmentDetail`).
- `docs/platform/SPRINT_HISTORY.md` (Sprint 13E entry appended).

## 11. Tests Added

Backend targeted tests (`platform/functions/src/assignments/assignments-reopen.test.ts`, 11 tests):

1. Active teacher succeeds and emits a single audit event.
2. Idempotent when already published (no second write, no second audit event).
3. Rejects a reopen from draft or archived with `assignments.invalidTransition`.
4. Propagates the canonical `unauthenticated` district error.
5. Propagates the canonical `account-inactive` district error.
6. Propagates the canonical `claim-stale` district error.
7. Propagates the canonical `district-mismatch` district error.
8. Rejects a non-teacher (student) active caller with `role-forbidden`.
9. Rejects a `platformAdministrator` active caller with `role-forbidden`.
10. Rejects cross-teacher and cross-school ownership with `assignments.forbidden`.
11. Rejects a not-found assignment and a malformed `assignmentId`.

Client targeted tests appended to `app/src/assignments/detail/detail.test.ts` under `describe("renderAssignmentDetail - reopen lifecycle (Sprint 13E)")`, 9 tests:

1. Closed assignment shows the `Reopen assignment` action when the reopen callable is wired (label is superseded).
2. Published assignment continues to show the Sprint 13D `Close assignment` action.
3. Closed assignment falls back to the Sprint 13D `Assignment closed` label when reopen is not wired.
4. Clicking `Reopen assignment` opens the confirmation dialog with the exact prescribed prompt.
5. Cancel leaves the assignment unchanged and never invokes the callable.
6. Confirm invokes the callable exactly once and updates the header to `Published`, with the lifecycle action swapping to `Close assignment`.
7. Failure preserves the `Closed` state and renders a generic error message (no Firestore, callable, or `assignments.` vocabulary leaked).
8. Escape closes the confirmation dialog without invoking the callable.
9. Back button remains functional in the reopened state after a successful reopen.

Client wire tests (`app/src/assignments/detail/reopen-wire.test.ts`, 4 tests): invokes the callable with the correct name and payload; propagates already-published idempotent responses; rejects malformed responses; rejects when the callable itself rejects.

## 12. Validation

- Targeted backend `assignments-reopen` suite: 11 of 11 passed.
- Full Cloud Functions regression: 40 suites, 883 of 883 tests passed.
- Targeted Assignment Detail suite (`src/assignments/detail`): 5 suites, 62 of 62 tests passed.
- Full application test suite: 354 of 355 tests passed. Sole failure: `curriculum/curriculumManifest.test.ts`, exactly as observed at Sprint 13B, 13C, and 13D. The failure reproduces outside Sprint 13E scope; Sprint 13E did not modify curriculum manifests, curriculum generation, or build tooling.
- Application lint: passed.
- Cloud Functions lint: passed.
- Application typecheck: passed.
- Cloud Functions typecheck: passed.
- Application production build (`npm run build`): passed.
- Firestore Rules: unchanged, no rules-suite run required for this sprint.
- Assignment Summary (Sprint 13A) rendering: unchanged and verified by the Sprint 13B / 13D detail-surface tests that continue to pass.
- Registry update: verified through the reopen-lifecycle test that observes `onStatusChange` firing exactly once with `status: "published"` after a successful reopen.
- Selector status update: verified through the Sprint 13C hydration and selection tests that continue to pass; registry re-registration deduplicates by `assignmentId` so a reopened assignment supersedes the closed copy in place.
- No backend contract changes beyond the additive new callable and its supporting typed write / audit action.
- No deployment.
- No commit.
- No changes to LMS integration, Google Classroom, notification system, browser persistence, realtime listener wiring, or polling behavior.
- Em dashes: zero across `SPRINT_13E_COMPLETION_REPORT.md` and the new Sprint 13E entry in `SPRINT_HISTORY.md` (verified through targeted grep).

## 13. Findings

None of severity higher than informational.

- Informational: Consistent with Sprint 13D, the Sprint 13A summary card inside the detail surface continues to load through the certified `assessmentAssignmentSummary` callable. When a teacher reopens an assignment the summary metrics do not refresh automatically because that would require re-invoking the summary callable; the existing card behavior is preserved without modification per Sprint 13A boundary. Refresh occurs naturally on the next reopen of the detail surface. This is intentional and out of scope for Sprint 13E.
- Informational: When both `closeCallable` and `reopenCallable` seams are wired, the detail surface guarantees exactly one lifecycle action visible per status. When only `closeCallable` is wired, the Sprint 13D behavior is preserved verbatim (Close action on Published, `Assignment closed` label on Closed). When only `reopenCallable` is wired, Published renders no lifecycle action (no Close action) and Closed renders the Reopen action. Full lifecycle coverage requires wiring both seams, which the entry point now does.

## 14. Certification

CONDITIONALLY CERTIFIED: Sprint 13E implementation is complete and its assignment reopen lifecycle is reconciled into the canonical platform contracts. Final certification requires resolution or formal acceptance of the pre-existing repository baseline test failure.

## 14A. Sprint 13E Documentation Reconciliation (2026-07-17)

### 14A.1 Why reconciliation was required

Sprint 13E introduced the new teacher-facing `closed` -> `published` transition and the `assignmentsReopen` callable, but the canonical assessment contract (`docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`) and the canonical callable inventory (`docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`) did not yet name the transition, its authorization, its idempotency, its invalid-transition rejection, or its interaction with the frozen recipient collection, sessions, attempts, and summaries. Downstream contracts that read the assignment lifecycle had no single normative reference for reopen behavior. This reconciliation pass adds that reference without altering implementation, tests, Rules, indexes, schema, or LMS integration.

### 14A.2 Canonical contract sections updated

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`: added §33 "Sprint 13E Reconciliations (Assignment Close and Reopen Lifecycle)" with subsections §33.1 through §33.12, and a matching Change Log entry dated 2026-07-17. §17 (Assignment Relationship) is narrowed by pointer to §33 rather than rewritten.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`: added the `assignmentsReopen` inventory entry immediately after `assignmentsClose` and before `assignmentsArchive`, preserving the existing formatting and Sprint 4D grouping.

### 14A.3 Close semantics confirmed

§33.2 records that `assignmentsClose` advances `published` -> `closed` through the narrow `assignmentCloseDocRef` typed write, refuses new sessions per §17 and §21, preserves in-grace submission per §17 and `ASSESSMENT_PIPELINE_SPECIFICATION.md` §7.1, preserves every existing attempt, summary, rollup, and frozen recipient, keeps the assignment teacher-discoverable through Sprint 13C `assignmentsTeacherList`, and never archives or deletes the assignment.

### 14A.4 Reopen semantics confirmed

§33.3 records that `assignmentsReopen` advances `closed` -> `published` through the narrow `assignmentReopenDocRef` typed write, re-authorizes new `assessmentSessionsBegin` calls for frozen recipients, permits session resume only where §6 already permits it, does not reset the session expiration constant or extend an already-elapsed grace period, does not regenerate the frozen recipient collection, does not restart attempt numbering, does not reclassify representative attempts, and does not create a new assignment record.

### 14A.5 Authorization rules

§33.4 records the identical authorization gate implemented in `platform/functions/src/assignments/assignments-close.ts` and `platform/functions/src/assignments/assignments-reopen.ts`: authenticated caller resolved through `requireDistrictContext`, `role === "teacher"`, owning teacher, same school, server-authoritative identity, and rejection of every client-supplied ownership field.

### 14A.6 Idempotency

§33.5 records that both callables are idempotent under the target state. `assignmentsClose` on an already-`closed` record returns `alreadyClosed: true` with no write and no audit event. `assignmentsReopen` on an already-`published` record returns `alreadyPublished: true` with no write and no audit event.

### 14A.7 Invalid transitions

§33.6 records that `draft` cannot be reopened, `archived` cannot be reopened, `archived` cannot be closed through the active lifecycle callable, and every other unsupported current status is rejected with `assignments.invalidTransition` (verified against the two handler files). Rejected transitions fail closed with no partial write, no lifecycle audit event, and no side effect on recipients, sessions, attempts, summaries, rollups, or LMS integration.

### 14A.8 Frozen-recipient behavior

§33.7 records that the frozen collection at `assignments/{assignmentId}/recipients/{studentId}` is never mutated by either callable and remains the sole authorized membership source under PDR-029l. Neither callable adds, removes, regenerates, replaces, or re-evaluates the recipient population.

### 14A.9 Session behavior while closed

§33.8 records that `assessmentSessionsBegin` refuses new sessions against a non-`published` assignment, that in-grace finalization for sessions live at close remains authorized until grace elapses per `ASSESSMENT_PIPELINE_SPECIFICATION.md` §7.1, and that existing Live and Archived session state is preserved.

### 14A.10 Session behavior after reopening

§33.8 records that eligible frozen recipients may begin new sessions as soon as the record is `published`, that resume of an existing Live session obeys the canonical rules in §6, that the 24-hour inactivity expiration is not reset, that Archived sessions are not returned to Live merely because the assignment reopened (recovery remains `assessmentSessionsRecover` only), and that an already-elapsed grace period is not extended.

### 14A.11 Attempt and summary preservation

§33.9 and §33.10 record that every prior `attempts/{attemptId}` remains immutable, that attempt numbering continues from the current maximum under the certified snapshot-count pattern in §32.2, that representative-attempt selection under PDR-029 is not reclassified, that `attemptRollups/*` and `assignmentRollups/*` remain readable while closed and after reopening, and that new post-reopen attempts participate in aggregate recomputation through the existing `assessmentRollupsRecomputeAttempt` trigger.

### 14A.12 Audit behavior

§33.11 records the canonical audit vocabulary. Successful reopen emits exactly one `assignments.reopened` event with `{ classId }` payload via `writeAuditEvent`; successful close emits exactly one `assignments.closed` event with `{ classId }` payload. Idempotent no-ops and rejected transitions emit no lifecycle audit event. `assignments.reopened` is a canonical member of the `AuditAction` union alongside `assignments.published`, `assignments.closed`, and `assignments.archived`; no additional lifecycle audit action is introduced.

### 14A.13 Cloud Function Charter update

`docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` now names `assignmentsReopen` in the canonical inventory: callable name, active-teacher requirement (via `requireDistrictContext`), district and ownership enforcement, `assignmentId` input, `closed` -> `published` transition, idempotent behavior on already-`published`, `assignments.reopened` audit, and the explicit non-mutation of recipients, attempts, sessions, summaries, ownership, and LMS linkage. The `assignmentsClose` entry is preserved verbatim and is not duplicated.

### 14A.14 PDR decision

No new Platform Decision Record is warranted. The reopen behavior is a narrow additive clarification of the already-certified assignment lifecycle enumeration in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.6 and of the assessment surface's dependency on `.status` values in §17. The additive `closed` -> `published` transition does not widen the district boundary, does not change any Firestore Rule, does not introduce a new callable pattern, does not introduce a new audit sink, and does not amend any PDR clause. The existing decision-record conventions require a PDR only when a canonical policy is introduced or altered; §33 introduces no policy that is not already implicit in the certified data model and callable pattern. `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` is therefore not modified.

### 14A.15 Files modified

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (added §33 and Change Log entry).
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (added `assignmentsReopen` inventory entry after `assignmentsClose`).
- `docs/platform/SPRINT_13E_COMPLETION_REPORT.md` (this §14A reconciliation section; original §§1 through 15 preserved verbatim).
- `docs/platform/SPRINT_HISTORY.md` (added the Sprint 13E documentation reconciliation note; original Sprint 13E entry preserved verbatim).

### 14A.16 Validation

- Documentation-only pass; no implementation, test, Rules, index, schema, LMS, Google Classroom, or deployment change performed.
- Verified `assignmentsReopen` appears exactly once in `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` inventory.
- Verified `assignments.reopened` appears in the canonical audit vocabulary (§33.11) and in the charter entry.
- Verified idempotent close and reopen behavior is documented (§33.5).
- Verified invalid-transition rejection with `assignments.invalidTransition` is documented (§33.6, verified against `platform/functions/src/assignments/assignments-close.ts` line 149 and `platform/functions/src/assignments/assignments-reopen.ts` line 153).
- Verified reopen semantics do not conflict with session expiration (§6, §33.8), grace period (§17, §33.2, §33.8), frozen recipients (PDR-029l, §33.7), attempt numbering (§8, §12, §32.2, §33.9), or representative-attempt policy (PDR-029, §33.9, §33.10).
- Verified only the four approved documentation files changed; no code, test, Rules, index, or schema file was modified.
- Em-dash search across the four modified documentation files: zero em dashes (verified through `grep -c` on the U+2014 character).
- No deployment; no commit.

### 14A.17 Updated certification statement

CONDITIONALLY CERTIFIED: Sprint 13E implementation is complete and its assignment reopen lifecycle is reconciled into the canonical platform contracts. Final certification requires resolution or formal acceptance of the pre-existing repository baseline test failure.

## 15. Recommended Next Bounded Slice

The next narrowly bounded slice should introduce a certified teacher-facing view of assignments currently in the `draft` state so a teacher who created a draft in a previous session can find and publish it without re-creating it. The Sprint 13C `assignmentsTeacherList` callable already restricts its response to `["published", "closed"]`; a bounded additive extension could widen the allowlist to include `draft` under a narrow, teacher-explicit code path (or introduce a new `assignmentsTeacherListDrafts` callable if the additive extension would compromise the certified Sprint 13C boundary). Client integration should surface the drafts through a calm, distinct visual affordance on the Curriculum surface (never mixed into the `View summary` / `View summaries` control), reuse the existing publish confirmation flow, and preserve the four-item Teacher Workspace navigation. Archive, delete, duplicate, notifications, roster mutation, grading, and bulk operations remain out of scope.
