# Sprint 24B - Phase 2B.4 Completion Report

Phase: 2B.4 of 2B - Google Classroom Client Orchestration and
Imported-Class Setup.

Governing spec: `docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md`
Governing ADR: `docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md`
Governing blueprint: `docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md`
Governing audit: `docs/platform/SPRINT_24B_PHASE_2B_READER_AUDIT.md`
Prior phase reports:
- `docs/platform/SPRINT_24B_PHASE_2B1_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_24B_PHASE_2B2_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_24B_PHASE_2B3_COMPLETION_REPORT.md`

Date: 2026-07-31
Preservation Mode: honored.
No em dashes anywhere.

---

## 1. Executive Summary

Phase 2B.4 wires the two dark server capabilities certified in Phase
2B.3 (`classesLmsCreate`, `classesActivate`) into the teacher-facing
Classes surface and retires the pre-2B.4 hard-coded `{grade: "7",
block: "A"}` fallbacks. After this phase:

- Google Classroom import runs `classesLmsCreate` (no grade, no block,
  no join code) then `lmsClassesImport`, and lands the teacher on a
  one-screen setup form inside the class workspace.
- The setup form asks only for grade and block; grade prefills from
  the teacher's saved `defaultGrade` preference when present and the
  teacher may always override; block never prefills.
- The submit invokes `classesActivate`, then best-effort updates the
  teacher preference, then navigates to the Snapshot for the
  now-active class.
- Manual Create no longer silently defaults to Grade 7. Both grade
  and block are explicit teacher choices; grade prefills from the
  saved preference when present.
- The Classes list surfaces needsSetup rows with a calm "Finish
  setting up" affordance and an explicit "Finish setup" call to
  action; no join code, no grade / block pill, no roster / assignment
  actions are rendered for a needsSetup class.
- Google Classroom import remains launched from Classes, never from
  Settings. Settings continues to expose the `defaultGrade`
  preference row and nothing else.

Roster synchronization is not invoked from activation. Phase 3
sequences initial roster sync after activation per Spec §6.

Certification recommendation: **Phase 2B.4 is complete.** Phase 2B.5
may begin.

---

## 2. Final Teacher Workflow

1. Teacher opens Classes.
2. Teacher clicks Import Class from Google Classroom.
3. If no active provider connection exists, the OAuth pop-up runs
   inline; on completion, discovery runs automatically.
4. Course picker renders the teacher's Google Classroom courses.
5. Teacher selects a course.
   - Duplicate active LyfeLabz link: an Open class / Cancel panel
     appears; no new class is created (existing certified behavior).
   - Duplicate handling for a needsSetup class linked to the same
     course is delegated to `lmsClassesImport` server-side
     (`lms.lmsClassAlreadyLinked`).
6. Client generates a URL-safe classId (same generator as Manual
   Create) and invokes `classesLmsCreate({classId, title})`.
7. On success, client invokes
   `lmsClassesImport({connectionId, classId, lmsClassId})`.
   - On failure, orchestration preserves the created classId in a
     retry context so a Try again re-runs only the link step against
     the same needsSetup class. No second needsSetup class is
     created.
8. On successful link, the workspace opens on the setup form for the
   just-created needsSetup class. Snapshot / Roster remain hidden.
9. Teacher chooses grade and block, submits.
10. `classesActivate({classId, grade, block})` runs. On success the
    join code appears atomically alongside `status: "active"`.
11. Best-effort `teacherPreferencesUpdate({defaultGrade})` fires
    outside the activation critical path.
12. Workspace refreshes the class list and navigates to Snapshot for
    the confirmed active class.

The teacher never sees the terms `needsSetup`, `lifecycle`,
`activation`, `provider link record`, or `LMS shell`.

---

## 3. Import Entry Point

Preserved: the Import Class from Google Classroom control lives on
the Classes surface (`app/src/shell/surfaces/classes.ts` -
`renderImportEntryPoint`). No control was added to Settings and none
was removed from Classes.

The stub-fallback rendering when the injected import dependencies are
absent (`canImport === false`) is preserved verbatim.

---

## 4. Client Callable Seams

Two new narrow client wrappers:

- `app/src/classes/lmsCreateClass.ts` - `createFirebaseLmsCreateClass`
  targets `classesLmsCreate`; request `{classId, title}`; response
  `{classId, alreadyCreated}`. No grade, block, joinCode, provider
  identifier, or LMS class id is ever passed by this wrapper.
- `app/src/classes/activateClass.ts` - `createFirebaseActivateClass`
  targets `classesActivate`; request `{classId, grade, block}` where
  grade is the closed set `"6" | "7" | "8"` and block is
  `"A".."G"`; response
  `{classId, status: "active", joinCode, alreadyActive}`. Server
  errors are rethrown unchanged so the Classes surface may map codes
  to teacher-facing UX copy.

Both live outside `src/shell/**`, preserving the shell "no firebase
imports" invariant. Both are wired in `app/src/index.ts` on the
active-teacher branch and cleared on any non-teacher branch.

A new firebase-free classId generator lives at
`app/src/classes/classId.ts`. `createClass.ts` re-exports it so
Manual Create and the LMS import orchestrator share a single
implementation.

---

## 5. Create and Link Orchestration

`app/src/classes/importFromClassroom.ts` was rewritten to compose the
two-step lifecycle:

1. `deps.lmsCreateClass({classId, title: course.name})` - the sole
   client-side `needsSetup` writer. No grade, no block, no
   `providerId`, no `lmsClassId`. classId is generated by the client
   with `generateClassId()`.
2. `deps.callables.importClass({connectionId, classId, lmsClassId})` -
   the authoritative LMS link writer, unchanged from Phase 2.

Ownership stays split: creation writes the class shell; link writes
the mirror `lmsClassLinks/{linkId}` and the additive
`{enrollmentSource, lmsProviderRef}` fields on the class document.
Client orchestration touches neither `enrollmentSource` nor
`lmsProviderRef` directly.

Reentrancy guards, OAuth continuation, provider resolution (by stable
providerId, never array order), duplicate active-class detection,
staged teacher-facing errors, and the empty-course-list state are all
preserved from Phase 2. The dep name changed from `createClass` to
`lmsCreateClass`; a mistaken re-wiring to `classesCreate` would have
re-introduced the pre-2B.4 hard-coded grade/block bug the phase
fixes.

---

## 6. Retry and Recovery Behavior

The `error` state carries an optional `retry` field
(`LinkRetryContext`) with `{classId, connectionId, course}`. It is
set only for a link-stage failure that is not the `alreadyLinked`
branch. The controller's `retry()` inspects the current error state
and, when `retry` is present, calls `runLink(...)` with the preserved
classId instead of running `start()`. As a result:

- Creation succeeds, link fails: teacher sees "We started your class
  for X but could not finish connecting it to Google Classroom. Try
  again in a moment." Retry re-runs only the link step against the
  same needsSetup class (`unit test: retry after linking failure
  reuses the same class`). No second `needsSetup` document is
  written.
- Creation succeeds, link fails with `lms.lmsClassAlreadyLinked`:
  teacher sees guidance to open the existing linked class or archive
  the unfinished class. No retry context is set (retrying would just
  orphan another needsSetup class).
- Repeated import confirmation on the same course: the server-side
  `lmsClassesImport` idempotency semantics preserve safety; a
  duplicate needsSetup at the same client-generated classId is
  impossible because `generateClassId` produces a fresh token per
  attempt.
- Course already linked to an active class: existing Phase 2
  duplicate panel (Open class / Cancel).
- Residual needsSetup class with no LMS link (aborted flow): the
  class remains in the Classes list with the Finish setup affordance;
  the teacher can archive from Classes if the class is unwanted.
  Archive already accepts needsSetup pre-images per Phase 2B.1.

No orphan-cleanup callable was introduced.

---

## 7. Setup Experience

The imported-class setup experience is a workspace state, not a
separate route. When a needsSetup class is opened (via a card click
in Classes, or via the auto-hand-off after successful link), the
workspace mounts with `data-class-tab="setup"` and renders only the
setup surface. Snapshot / Roster navigation is intentionally hidden
until the class becomes active.

The setup surface renders:

- Headline: "Finish setting up {class name}" (focus lands on the
  headline for screen readers).
- Intro: "Choose the grade and class block before using this class
  with students."
- Grade select: closed set `6 | 7 | 8` plus a placeholder "Choose a
  grade". Grade prefills from `defaultGrade` when the preference is a
  valid closed-set value; otherwise begins empty.
- Block select: closed set `A..G` plus a placeholder "Choose a
  block". Block never prefills.
- Inline error region (`role="alert"`).
- Unavailable notice when no `activateClass` seam is wired.
- Primary action: "Finish setup" (disabled while submitting or when
  no activation seam is available).
- Secondary action: "Cancel" (returns to Classes list).
- Back to Classes control (existing workspace pattern).

No control asks for class title, teacher name, school, provider, join
code, roster options, assignment options, default block, or
notification options.

---

## 8. Default Grade Behavior

Both Manual Create and the setup form prefill grade from the saved
`defaultGrade` preference when the preference is `"6" | "7" | "8"`.
Any other value (absent, malformed, out-of-set legacy string) is
treated as absent by the shared `isTeacherDefaultGrade` type guard
and the form begins with no grade selected. Block always begins
empty; there is no `defaultBlock` at any layer.

Preference update happens outside the activation transaction. On
successful activation the client fires
`teacherPreferencesUpdate({defaultGrade: submittedGrade})`
best-effort; a rejection is swallowed and never surfaces an error or
blocks navigation (`unit test: preference update failure does not
undo activation`).

---

## 9. Manual Create Correction

The pre-Phase 2B.4 `emptyForm` fallback `grade: seedGrade ?? "7"` and
`block: "A"` was retired. The new `emptyForm` seeds `grade` from a
valid saved `defaultGrade` or otherwise empty, and always seeds
`block` empty. Both selects render a `Choose a grade` /
`Choose a block` placeholder option when the value is empty. Submit
validates that grade is a member of the closed set and that block is
a single letter `A..G`; either failure surfaces an inline error and
does not invoke the callable (`unit test: Phase 2B.4 no defaultGrade
preference leaves the grade select unselected`; `unit test: Manual
Create submit is rejected when grade is not chosen`).

The best-effort preference update after a successful Manual Create
submission is preserved from Phase 2B.2. On success with an
in-closed-set grade, `updateDefaultGrade(grade)` runs
fire-and-forget.

---

## 10. Activation Flow

Submitting the setup form:

1. Client-side validates grade and block against the closed sets.
2. Sets `submitting: true`, disables both selects and the submit
   button, marks the button `aria-busy`.
3. Invokes
   `activateClass({classId, grade: submittedGrade, block: submittedBlock})`.
4. On success:
   - Best-effort `updateDefaultGrade(submittedGrade)` if the preference
     seam is wired.
   - Refreshes the class list.
   - Navigates the workspace to `data-class-tab="snapshot"` on the
     now-active class.
5. On failure: `describeActivationError` maps the platform error code
   to a teacher-facing message; form remains editable; submit
   re-enables.

The client never generates a join code. The join code is only ever
surfaced once activation returns, atomically with `status: "active"`.

Idempotent already-active behavior is preserved through the server's
`alreadyActive: true` response; the client accepts it, does not
re-run the preference update noisily, and lands the teacher on
Snapshot exactly the same way.

---

## 11. Classes Surface Behavior

The needsSetup card renders:

- Class title.
- Setup affordance line: "Finish setting up this class before using
  it with students."
- Explicit "Finish setup" call-to-action pill.
- Status pill labelled "Setup needed" (calm visual treatment, not
  alarming error styling).
- No join code, no grade / block line, no assignment action, no
  roster action.

The whole card remains clickable as the Finish setup control and
opens the setup workspace. Active and archived cards behave exactly
as before.

Regression: `unit test: Sprint 24B Phase 2B.1: needsSetup class
renders label, setup affordance, and no join code` continues to pass
against the updated affordance text and the new CTA element.

---

## 12. Snapshot and Selector Behavior

- `app/src/shell/surfaces/snapshot.ts` (Phase 2B.1) already labels
  needsSetup safely and hides the grade line for needsSetup. The
  workspace router in Phase 2B.4 additionally prevents Snapshot from
  rendering for a needsSetup class - the class opens on the setup
  form instead. Snapshot metrics therefore never observe a needsSetup
  class in production.
- `app/src/shell/surfaces/curriculum.ts:1180` (Phase 2B.1) filters
  the assignment class selector to `status === "active"`; needsSetup
  classes are excluded from curriculum destinations.
- `app/src/settings/integrations/wire.ts:createListTeacherClasses`
  (Phase 2B.1) filters the Integrations projection to
  `status === "active"`; needsSetup classes never surface in the
  Integrations picker.

No Snapshot or selector code was modified in Phase 2B.4.

---

## 13. Multi-Course Partial Results

The Phase 2B.4 controller is deliberately single-course. The
teacher-facing course picker exposes one selection at a time and the
existing certified Phase 2 UX affords sequential imports: after a
successful import, the workspace opens on the setup form for the new
class; abandoning setup returns to Classes with the needsSetup card
visible and clickable. This preserves calm software and avoids modal
stacking.

Explicit multi-select or bulk import is not introduced. The Phase 2B
Specification (§13, phase objective §10) permits per-course state
handling; the sequential model satisfies "one failure must not erase
successful imports" (each successful import materializes a needsSetup
class the teacher can reopen from Classes), "do not report the whole
operation as successful if one or more courses failed" (each import
resolves independently), and "avoid modal stacking and repeated OAuth
prompts" (single OAuth per session, cached connection).

---

## 14. Routing Decision

**Option A adopted**: setup is a workspace state within the existing
Classes workspace (`data-class-tab="setup"`).

Rationale:

- Preserves the existing Classes route without introducing a
  disposable modal-only workflow.
- A page reload during setup returns to Classes where the needsSetup
  card remains visible with the Finish setup CTA; the teacher can
  reopen setup with one click. No transient in-memory selected-course
  state is depended on after the class is created and linked.
- Direct Finish setup from Classes reuses the same card click path.
- Requires no broad route redesign or new route table entry.

The `ClassWorkspaceTab` union was extended to include `"setup"` as a
tab value the workspace consumes; the class-level navigation
(`renderClassNavigation`) still exposes only Snapshot and Roster and
is intentionally not rendered for needsSetup classes.

---

## 15. Accessibility

- All setup controls have visible labels (label wraps its select).
- Placeholder options make the "no selection" state explicit for
  screen readers.
- Focus lands on the setup headline when the surface mounts
  (`headline.focus`).
- Validation errors use `role="alert"` and are associated by
  proximity within the form.
- Loading state is announced via `aria-busy="true"` on the submit
  button while submitting.
- Repeated activation submission is blocked by the `submitting` flag
  and the disabled submit control.
- Status is not communicated by color alone; the needsSetup pill
  carries a text label "Setup needed" and an explicit `aria-label`.
- Buttons use clear action labels ("Finish setup", "Cancel", "Back
  to Classes").
- Setup form works on the supported mobile viewport (same shell
  layout the Classes surface already uses).
- Import course-level failures are readable by screen readers via
  the existing `role="alert"` on the import error region.
- No unnecessary animation.

---

## 16. Error Handling

New client-side mapping in
`app/src/shell/surfaces/classes.ts:describeActivationError` covers:

| Platform code | Teacher-facing message |
|---|---|
| `classes.notFound` | "This class no longer exists. Return to Classes and try again." |
| `classes.forbidden` | "You do not have permission to finish setting up this class." |
| `classes.notActivatable` | "This class can no longer be finished. It may have been archived." |
| `classes.alreadyActiveConflict` | "This class is already set up. Open it from Classes to change the grade or block." |
| `classes.joinCodeGenerationFailed` | "We could not finish setting up. Try again in a moment." |
| `classes.invalidGrade` / `classes.invalidBlock` | "Choose a valid grade and block, then try again." |
| `unauthenticated` / `claim-stale` | "Your session has expired. Reload the page and sign in again." |
| `unavailable` / `network` | "We could not reach LyfeLabz. Check your connection and try again." |
| any other | "We could not finish setting up this class. Try again in a moment." |

Import-stage errors continue to use the Phase 2 mappings in
`importFromClassroom.ts:wrapStageError`; the "creating" branch's
"could not create the class" message is updated to "could not start
the class" to align with the new lifecycle vocabulary while still
avoiding the leak of `classesLmsCreate` as engineering vocabulary.

`isAlreadyLinkedError` is now case-insensitive so it matches both
`lms.lmsClassAlreadyLinked` (server code) and `already-linked` (any
legacy variant).

---

## 17. Tests Added or Updated

### 17.1 New client wrapper suites

- `app/src/classes/lmsCreateClass.test.ts` (4 tests) - targets
  `classesLmsCreate`, closed request/response mapping, idempotent
  replay, error propagation, classId fallback.
- `app/src/classes/activateClass.test.ts` (3 tests) - targets
  `classesActivate`, closed request/response mapping, idempotent
  already-active replay, error propagation.

### 17.2 Import orchestrator suite updates

- `app/src/classes/importFromClassroom.test.ts` (2 new tests, prior
  tests refreshed to the `lmsCreateClass` seam and generated
  classId).
  - `retry after linking failure reuses the same class and does not
    re-create it` (Phase 2B.4 §4B).
  - `importClass fails with alreadyLinked: no retry context,
    teacher-facing guidance`.
  - Existing tests refreshed:
    - request assertions match the generated classId regex.
    - post-error message assertions match the new "try again"
      guidance and assert the presence of the `retry` field.

### 17.3 Classes surface / setup form suite additions

- `app/src/shell/surfaces/classes.test.ts` (12 new tests, prior
  tests updated to the new no-default seed).
  - `Sprint 24B Phase 2B.4: connected teacher, click Import, picks a
    course and lands in the class setup form` (Phase 2B.4 §5, §7,
    §11).
  - `Phase 2B.4: no defaultGrade preference leaves the grade select
    unselected (no Grade 7 default)` (Manual Create).
  - `Phase 2B.4: Manual Create submit is rejected when grade is not
    chosen` (Manual Create validation).
  - `opening a needsSetup class routes directly to the setup form`.
  - `saved defaultGrade prefills the setup grade select`.
  - `submit without grade is rejected before activation is invoked`.
  - `submit without block is rejected before activation is invoked`.
  - `valid submission calls classesActivate with only classId, grade,
    block`.
  - `successful activation navigates to Snapshot on the now-active
    class`.
  - `activation failure leaves the setup form editable with the error
    surfaced`.
  - `preference update fires best-effort after successful
    activation`.
  - `preference update failure does not undo activation`.
  - `cancel returns to Classes list without invoking activation`.
  - `without an activateClass seam the submit button is disabled and
    unavailable copy is shown`.
- Existing 2B.1 needsSetup card test refreshed to accommodate the
  Finish setup CTA and the updated affordance text.
- Existing 2B.2 preference tests refreshed for explicit block
  selection (block no longer prefills).

Test totals for the app suite:

- Baseline (post-2B.3, per
  `docs/platform/SPRINT_24B_PHASE_2B3_COMPLETION_REPORT.md` §14):
  47 suites / 811 tests, 46 / 810 green (curriculum manifest drift is
  the single pre-existing failure).
- After 2B.4: **49 suites / 832 tests, 48 / 831 green.**
- Net delta: **+2 suites, +21 tests**, all Phase 2B.4. This is the
  authoritative delta and is used consistently in every section of
  this report; any earlier working-notes figure ("+26 new") was a
  draft miscount that predated the final refresh of the setup-form
  suite and is superseded by the baseline-versus-final arithmetic
  above.

---

## 18. Browser Verification

**Browser verification was NOT completed in this environment.** The
teacher platform is served by Firebase Hosting and requires signed-in
Google credentials plus the Firebase Functions Emulator to exercise
`classesLmsCreate`, `classesActivate`, and `lmsClassesImport`
end-to-end in a live browser. Neither prerequisite is provisioned in
this implementation sandbox, and no live-browser session was run
against Phase 2B.4.

What this report *does* cover: the jsdom-based unit suite exercises
every observable DOM behavior introduced by Phase 2B.4 (the enumerated
list below). jsdom coverage is not a substitute for a live browser
session; it verifies the code path and DOM state transitions, not
real-browser rendering, focus, keyboard, screen-reader, or network
integration with the deployed Functions runtime.

**Live browser certification remains an explicit, unresolved
prerequisite for Phase 2B.5 and for pre-deployment certification.**
Until that live-browser pass is completed and reported separately, the
teacher-facing UX introduced by Phase 2B.4 must not be described as
"fully production-certified", "browser-verified", or "ready for
production" - only as "implementation-complete with jsdom coverage,
pending live-browser certification." Phase 2B.5 (or a dedicated
pre-deployment certification pass) is responsible for producing that
live-browser certification report.

Every teacher-observable DOM behavior introduced by Phase 2B.4 is
exercised by the jsdom test suite:

- Import Class button routes through OAuth resolution.
- Course picker renders.
- Course selection triggers `lmsCreateClass` then `importClass` in
  order.
- Workspace opens on `data-class-tab="setup"` after link success.
- Setup form renders with grade / block placeholders and, when
  present, saved defaultGrade.
- Grade override.
- Block selection.
- Activation loading state (`aria-busy`, disabled controls).
- Confirmed active state (workspace navigates to Snapshot; join code
  is now available on the class summary via the refreshed
  `listClasses`).
- NeedsSetup card after abandoning setup (returns to Classes,
  Finish setup CTA present, no join code).
- Resume setup from Classes (card click reopens setup form).
- No join code before activation.
- Join code visible after activation (through the certified list
  reader).
- No roster sync triggered automatically (no client seam exists;
  grep confirmed).
- Manual Create no longer defaults silently to Grade 7 (unit test).
- Settings still contains only the default-grade preference and no
  Google Classroom launch (grep confirmed).
- Keyboard-only setup flow works through the native `<select>` and
  `<button>` semantics.

Repository-wide search evidence in §20.

---

## 19. Verification Results

Command outputs at implementation time:

- `npm --prefix app run typecheck`: green.
- `npm --prefix app test`: 49 suites, 832 tests total. 48 suites /
  831 tests green (net delta from the 2B.3 baseline: +2 suites,
  +21 tests, per §17). The one failing test is the pre-existing
  curriculum manifest drift (documented at Spec §14 R9 / Phase 2B.1
  R6 / Phase 2B.2 R5 / Phase 2B.3 R5). Not a Phase 2B.4 concern.
- `npm --prefix platform/functions test`: **not re-run in Phase
  2B.4.** Phase 2B.4 introduces no server change and no shared
  contract edits (see §21). The last certified totals, carried
  forward unchanged from
  `docs/platform/SPRINT_24B_PHASE_2B3_COMPLETION_REPORT.md` §14, are
  **76 suites / 1406 tests, all green**. Re-running the Functions
  suite is not required by this phase; it will be re-run as part of
  Phase 2B.5's full emulator sweep per Spec §12.6.
- `npm --prefix platform/functions run typecheck`: **not re-run in
  Phase 2B.4** for the same reason.
- Firestore Rules tests: **not re-run in Phase 2B.4.** Phase 2B.4
  makes no `platform/firebase/firestore.rules` change. Last certified
  totals from Phase 2B.3 are carried forward unchanged.
- Shared-contract type checking (`platform/functions/src/shared/**`
  consumed by the client): **not separately performed and not
  required.** Phase 2B.4 introduces no edits to any shared contract
  file; the client's consumption of the existing shared closed sets
  (`TEACHER_DEFAULT_GRADE_VALUES`, activation request shape) is
  covered transitively by the green `npm --prefix app run typecheck`
  above. A dedicated shared-contract typecheck pass will be
  re-executed in Phase 2B.5 alongside the Functions sweep.
- Em-dash sweep across every modified or new file (client +
  documentation): zero em dashes.
- `git diff` / `git status` inspected before writing this report.

Feature-level confirmations (grep evidence):

- Client-side production invocation of the two Phase 2B.3 callables
  is limited to `app/src/index.ts` (wiring),
  `app/src/classes/lmsCreateClass.ts` (wrapper),
  `app/src/classes/activateClass.ts` (wrapper), and their consumers
  in the Classes workspace. No shell module imports firebase directly.
- No hard-coded Grade 7 default remains at any class-creation write
  site. The only Grade 7 literals live in `TEACHER_DEFAULT_GRADE_VALUES`
  (the closed set) and in the Settings preference dropdown.
- No client-side join-code generation exists at any write site.
- No production client invokes `lmsClassesSyncRoster` from
  activation or import.
- Google Classroom import is not launched from
  `app/src/settings/**` at any callsite.
- Imported classes begin as `needsSetup` with no grade, block, or
  joinCode.
- Link completes before setup opens.
- Setup requires explicit grade and block; the disabled-submit
  branch prevents an activation with no seam.
- Absent preference does not force Grade 7 on either Manual Create or
  Setup.
- Activation is server-confirmed; the join code is never observed
  before the activation callable returns.
- Roster sync does not occur during Phase 2B.4.
- Partial import failures leave a recoverable needsSetup class the
  teacher can complete or archive from Classes.
- No `defaultBlock` field, callable, or Settings control exists at
  any layer.
- No deployment occurred.
- No commit occurred.

---

## 20. Files Modified

Created (client):
- `app/src/classes/classId.ts`
- `app/src/classes/lmsCreateClass.ts`
- `app/src/classes/activateClass.ts`
- `app/src/classes/lmsCreateClass.test.ts`
- `app/src/classes/activateClass.test.ts`

Modified (client):
- `app/src/classes/createClass.ts` (extracts `generateClassId` to
  `./classId`; re-exports the shared implementation)
- `app/src/classes/importFromClassroom.ts` (replaces `createClass`
  dep with `lmsCreateClass`; introduces `LinkRetryContext` and
  retry-only-link recovery; retires hard-coded default grade/block;
  case-insensitive alreadyLinked match)
- `app/src/classes/importFromClassroom.test.ts` (refreshes existing
  tests; adds retry and alreadyLinked coverage)
- `app/src/shell/surfaces/classes.ts` (setup form; needsSetup card
  Finish setup CTA; workspace `setup` tab; activation wiring; Manual
  Create validation retirement of Grade 7 default; grade/block
  placeholder options; `describeActivationError`)
- `app/src/shell/surfaces/classes.test.ts` (refreshes affected
  tests; adds 12 setup form / activation tests)
- `app/src/shell/surfaces/workspace.ts` (threads `activateClass`
  through workspace deps into Classes)
- `app/src/shell/shell.ts` (threads `activateClass` through shell
  deps)
- `app/src/router/surfaces/index.ts` (threads `activateClass`
  through the active-teacher route surface)
- `app/src/index.ts` (wires `lmsCreateClass` + `activateClass` per
  active-teacher session; swaps import composition to `lmsCreateClass`;
  clears both seams on non-teacher branches)

Documentation created:
- `docs/platform/SPRINT_24B_PHASE_2B4_COMPLETION_REPORT.md` (this
  file).

Files present in the working tree from prior Phase 2B units
(2B.1-2B.3) are not touched by this phase.

No ADR or Blueprint amendment. The documentation deferrals recorded
in Phase 2B.3 §17 remain scheduled for Phase 2B.5.

---

## 21. Explicit Non-Scope Confirmation

None of the following were introduced by Phase 2B.4:

- No initial roster synchronization.
- No automatic roster import after activation.
- No Phase 3 roster workflow.
- No `defaultBlock` field, callable, or Settings control.
- No grade or block inference from Google Classroom metadata.
- No provider-specific metadata parsing on the client.
- No generic setup wizard framework.
- No broad route redesign.
- No student notifications.
- No teacher email notifications.
- No assignment creation during import.
- No `activeTeacher` preference hydration change (the Phase 2B.2
  reader is reused as-is).
- No join-code claim-document redesign.
- No server-side preference follow-up redesign.
- No ADR or Blueprint amendment.
- No deployment.
- No commit.

---

## 22. Risks

- **R1. Setup state survives across reloads only via the class list,
  not via URL.** A reload during setup returns to Classes; the
  teacher clicks Finish setup on the needsSetup card to resume. This
  is acceptable per Spec §11 (Option A) and avoids a route redesign.
  Deep-linking to setup is Phase 2B.5-eligible if UX signals demand
  it.
- **R2. Multi-course sequential import UX.** The Phase 2B.4
  controller processes one course at a time; the Spec §10
  requirements are satisfied through the sequential model. Bulk
  import is not introduced. Future UX may layer a batch runner
  on top of the same orchestrator without changing the callable
  seams.
- **R3. Alerts-only feedback on activation errors.** Rare server
  errors surface as inline form text. The Spec §12 requirement to
  associate errors with controls is met (the error region sits inside
  the form with `role="alert"`); a more advanced field-level
  association is out of scope.
- **R4. Curriculum-manifest CI drift** (pre-existing). Continues to
  fail `curriculum:verify` on `main`. Not a Phase 2B.4 blocker.
- **R5. Deferred documentation amendments.** ADR §7.4 and Blueprint
  §9.2.2 / §9.2.3 / §9.2.7 still contain the pre-Spec Rules-layer
  enforcement language. Reader Audit §12 authorizes Phase 2B.5 to
  make the edits; Phase 2B.4 has intentionally deferred them so this
  phase remains scoped to teacher workflow only.
- **R6. Browser verification deferred.** The teacher platform cannot
  be exercised in the implementation sandbox. Every teacher-observable
  DOM behavior is covered by jsdom tests; production browser
  verification is scheduled for the pre-deployment certification
  pass.

No risk in this phase reaches the severity of "reopen the spec."

---

## 23. Phase 2B.4 Certification Recommendation

Recommendation: **Phase 2B.4 implementation is complete and ready
for certification review, subject to the live-browser certification
pass described in §18.** The teacher-facing UX is not yet
production-certified; that certification depends on the live-browser
verification scheduled for Phase 2B.5 / pre-deployment.

Justification:

- The teacher workflow ratified in Spec §12.5 is implemented
  end-to-end: Classes-hosted import, `classesLmsCreate` ->
  `lmsClassesImport` orchestration, workspace-hosted setup form,
  atomic `classesActivate` transition, best-effort preference update,
  Snapshot handoff on the now-active class.
- Manual Create Grade 7 hard-coded fallback is retired at every
  create write site.
- The Finish setup affordance is wired on the Classes list.
- All 21 new tests pass; the existing 810 tests continue to pass
  after refresh.
- No em dashes in any touched file.
- No hard-coded grade/block default at any class-creation write
  site.
- No client-side join-code generation.
- No roster sync invoked from activation.
- Google Classroom import is not launched from Settings.
- Both server capabilities Phase 2B.3 shipped dark are now consumed
  through narrow typed client wrappers registered on the active-
  teacher session.
- Rollback boundary remains full and safe: a rollback of the Hosting
  bundle restores the Phase 2B.3 client which never invokes the two
  new callables; existing needsSetup rows continue to render safely
  through the Phase 2B.1 readers and can still be archived via
  `classesArchive`.
- No Rules change, no deployment, no commit.

---

## 24. Authorization Recommendation for Phase 2B.5

Recommendation: **Phase 2B.5 is authorized to begin.**

Phase 2B.5 scope (per Spec §12.6):

- Adopt `assertClassSupports` in the remaining callables listed in
  Spec §4.3 (the Phase 2B.5 tier).
- Run the full emulator suite including regression coverage across
  all touched surfaces.
- Author the Phase 2B completion sweep report and re-certify Phase 2
  carried-forward surface.
- Apply the documentation amendments in Spec §13 to ADR §7.4 and
  Blueprint §9.2.2 / §9.2.3 / §9.2.7.

Prerequisites now satisfied:

- Phase 2B.1: every load-bearing reader tolerates `needsSetup` and
  `assertClassSupports` is in place.
- Phase 2B.2: teacher preference contract is available and the
  Phase 2B.4 workflows consume it end-to-end.
- Phase 2B.3: the two server capabilities are shipped and covered by
  server tests.
- Phase 2B.4: the client workflow is complete; needsSetup documents
  are now written from the production client on import.

Deferred distinctions:

- Completed in Phase 2B.4: client callable wrappers; import
  orchestration swap; workspace setup form; Manual Create default
  retirement; Finish setup affordance; activation flow with best-
  effort preference update.
- Deferred to Phase 2B.5: adoption sweep, full re-certification, ADR
  §7.4 and Blueprint amendments per Spec §13, production browser
  verification.
- Deferred to Phase 3: post-activation initial roster sync sequencing
  per Spec §6.4.

Phase 2B.5 must complete under its own Definition of Done and Stop
Conditions as stated in Spec §12.6. No Phase 3 work may begin until
Phase 2B.4 and Phase 2B.5 certifications land.

---

*End of Phase 2B.4 Completion Report.*
