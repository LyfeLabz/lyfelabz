# Sprint 24B - Phase 2 Completion Report

Status: NOT CERTIFIED (2026-07-30). Certification is withdrawn pending
completion of Phase 2B per
`SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md` §9.2 and
`ADR_TEACHER_DEFAULT_CLASS_METADATA.md`. The orchestration,
OAuth handoff, duplicate detection, reentrancy, and provider-selection
work described below remain accurate and are carried forward by
Phase 2B. Only the metadata origination behavior is de-certified. See
§17 below for the full de-certification appendix.

Phase: 2 of 7 - Import Class from Google Classroom orchestration
Governing authority: `docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md`
§4.2, as amended by §9.1 and superseded in part by §9.2.
Secondary authority: `docs/platform/SPRINT_24B_DEFINITION.md`.
Governing ADR (metadata origination):
`docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md`.
Preservation Mode: honored throughout.

## 1. Executive Summary

Phase 2 replaces the Phase 1 stub with the primary Import Class from
Google Classroom orchestration, run entirely from the Classes surface.
A teacher clicks Import Class from Google Classroom on Classes,
completes OAuth inline if no active connection exists, picks a Google
Classroom course, and lands directly in the newly created LyfeLabz
class workspace. The teacher is never routed through Settings, never
prompted for destination class, name, grade, block, color, or period,
and never shown an intermediate success screen.

No new server callable was introduced. The Sprint 24A certified
callables (`lmsProvidersList`, `lmsConnectionsDescribe`,
`lmsConnectionsBegin`, `lmsConnectionsComplete`, `lmsClassesDiscover`,
`classesCreate`, `lmsClassesImport`) compose end-to-end from a new
client orchestration module (`app/src/classes/importFromClassroom.ts`).
Provider abstraction is preserved. Firestore Rules, indexes, schema,
`lmsClassesSyncRoster`, the roster reconciliation engine, and every
audit event kind are unchanged.

Phase 3 work (roster synchronization trigger) is not implemented and
not surfaced. Phase 4 through Phase 7 work is not implemented and not
surfaced.

## 2. Documentation Prerequisite Completed

`docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md` was amended with
§9.1 "Amendment - Deferred account-level Settings capabilities". The
amendment records that Connected Google account email and Last
successful synchronization timestamp are not available through the
currently certified connection-summary contract, and that both are
intentionally deferred to the approved later connection-lifecycle
phase (Phase 5). It also clarifies:

- The existing Connect control may initiate the same OAuth sequence
  used for reconnection.
- The distinct teacher-facing Reconnect state and label depend on
  Phase 5 expired-refresh classification.
- The later phase may extend the relevant callable response only as
  narrowly as necessary.
- Provider abstraction remains mandatory; the extended
  connection-summary shape must be provider-neutral.
- No provider account identifier is exposed beyond the minimum
  approved teacher-facing account information.
- The amendment does not reopen or alter Phase 1.

The Phase 1 completion report was not modified. No factual
cross-reference required correction.

## 3. Governing Phase 2 Scope

Blueprint §4.2 defines Phase 2 as the Import Class from Google
Classroom orchestration. The sequence when the teacher clicks the
primary entry point:

1. If no active connection exists, run OAuth inline using
   `lmsConnectionsBegin` / `lmsConnectionsComplete`.
2. Enumerate courses using `lmsClassesDiscover`.
3. Teacher picks a course.
4. Client invokes `classesCreate` followed by `lmsClassesImport`.
5. Only after `lmsClassesImport` returns a confirmed successful link,
   the client refreshes the teacher's class list and opens the newly
   created class in the class workspace. Phase 3 will pick up the
   initial roster sync.

Class metadata inheritance is deterministic and never prompts the
teacher. Title comes from the Google Classroom course name. Grade and
block fall through to the same defaults the manual create form uses,
per Blueprint §4.2 rationale: convenience metadata, editable later
from class settings.

## 4. Files Modified

- `app/src/index.ts`
  - Added the session-scoped `importFromClassroom`
    `ImportFromClassroomDeps` slot. Populated on the activeTeacher
    branch by composing the certified Integrations callable seam
    (`integrations.callables`), the certified OAuth handoff
    (`integrations.openOAuth`), the certified redirect URI, the
    certified `classesCreate` seam, the teacher-classes reader, and
    the class-links reader. Nulled on every non-teacher branch so
    cross-session state cannot leak. Threaded into the route table as
    a getter.

- `app/src/router/surfaces/index.ts`
  - Added `importFromClassroom` getter to `SurfaceDeps`. Resolved
    during activeTeacher dispatch and forwarded to
    `mountTeacherShell`.

- `app/src/shell/shell.ts`
  - Added `importFromClassroom` to `ShellDeps` and forwarded it into
    `WorkspaceDeps` for the Classes surface.

- `app/src/shell/surfaces/workspace.ts`
  - Added `importFromClassroom` to `WorkspaceDeps` and forwarded it
    into `renderClassesSurface` for the `classes` surface.

- `app/src/shell/surfaces/classes.ts`
  - Extended `ClassesSurfaceDeps` with the optional
    `importFromClassroom` seam.
  - Introduced a session-scoped `ImportController` created lazily on
    first Import click. The controller owns the orchestration state
    machine.
  - Replaced the Phase 1 inert stub with the real
    `renderImportEntryPoint`. When the seam is absent (tests) the
    button falls back to a disabled control with a plain-language
    status line, preserving Phase 1 accessibility semantics
    (`aria-disabled`, `aria-describedby`).
  - Added the staged inline progress panel
    (`classes-import-panel`) with ordered stages (Sign in to Google
    Classroom, Load your courses, Create your LyfeLabz class, Link
    to Google Classroom). Each stage carries a `data-status` of
    `pending`, `active`, `complete`, or `failed`.
  - Added the duplicate panel (`classes-import-duplicate`) with
    Open class and Cancel actions. No Import anyway control exists.
  - Added the error panel (`classes-import-error`) with an
    optional recovery hint and a Try again action for pre-link
    stages. The linking-stage error suppresses the retry action and
    surfaces the recovery guidance in prose, per §10 below.
  - Extended `ClassesState.list` with an `importState` field
    threaded through every state transition. Refactored
    `renderListState` to accept the new import-related handlers.
  - On the `linked` state (which is reached only after
    `lmsClassesImport` has confirmed the link), refreshes the
    teacher's classes list so the new class is present, then opens
    the class workspace. This hand-off is deterministic and confirmed,
    not optimistic; navigation never happens before the link result
    is in hand.

- `app/src/shell/surfaces/classes.test.ts`
  - Renamed the inert-stub test to make its test-only intent
    explicit and updated the copy expectation to the new
    "not available right now" fallback string.
  - Added Phase 2 tests documented in §12 below.

## 5. Files Created

- `app/src/classes/importFromClassroom.ts` - client orchestration
  module. Consumes only injected callables (per Blueprint §4.2
  Deliverables). Opens no Firestore listener. Imports no firebase/*
  module. Exposes a state machine (`ImportState`) covering idle,
  connecting, discovering, courses, duplicate, creating, linking,
  linked, and error. Exposes a controller (`ImportController`) with
  `start`, `selectCourse`, `retry`, and `cancel`. Provider abstraction
  is enforced by reading provider id and display name from
  `lmsProvidersList` at flow start; no provider id is hard-coded.

- `app/src/classes/importFromClassroom.test.ts` - orchestration unit
  tests (see §12).

- `docs/platform/SPRINT_24B_PHASE_2_COMPLETION_REPORT.md` - this file.

## 6. Teacher Workflow Implemented

The Phase 2 teacher outcome required by the invocation is met:

- The teacher starts from Classes.
- The teacher clicks Import Class from Google Classroom on Classes.
- If no active connection exists, the OAuth flow begins inline; on
  successful authorization, discovery runs automatically without a
  second Import click and without a Settings redirect.
- If an active connection exists, discovery runs immediately.
- The teacher picks a Google Classroom course.
- The client composes `classesCreate` and `lmsClassesImport` in that
  order. No new orchestration callable is introduced.
- The teacher is never asked for destination LyfeLabz class, class
  name, grade, block, color, period, or optional metadata.
- The Google Classroom course name is used as the class title.
- Grade and block fall through to the shared server-compatible
  defaults ("7", "A"), matching the manual create-class form and the
  same values the Sprint 20 beta form defaults to. These fields are
  convenience metadata that a teacher can edit later from class
  settings without affecting the roster, identity bridge, or any
  downstream callable, per Blueprint §4.2 rationale.
- There is no intermediate success screen. On `linked` (reached only
  after the certified `lmsClassesImport` callable returns a
  successful link result), the surface refreshes the teacher's class
  list and opens the newly created class in the class workspace
  directly. The hand-off is confirmed, not optimistic.

The secondary Create LyfeLabz Class entry point continues to operate
exactly as in Phase 1.

## 7. OAuth Continuation Behavior

The Sprint 8C OAuth architecture uses a browser-scoped popup +
postMessage handshake (`createBrowserOAuthHandoff` in
`app/src/settings/integrations/wire.ts`). The main Classes page never
navigates away. There is therefore no full-page redirect to survive:
the pending import intent is the live in-memory `ImportController`
instance, and it stays resident on the page for the entire OAuth
round-trip.

Detailed lifecycle:

- Initiation: the teacher clicks `classes-import-open`, which invokes
  `onStartImport` in `app/src/shell/surfaces/classes.ts`. That resolves
  the session-scoped `ImportController` (created lazily on first click)
  and calls `controller.start()`.
- Provider resolution: `resolveProvider` calls the certified
  `lmsProvidersList` and matches the returned records against the
  stable `googleClassroom` provider id from the certified server-side
  registry (`platform/functions/src/lms/providers/google-classroom/adapter.ts`).
  Provider selection does not depend on array order and is unchanged
  when Google Classroom is not the first entry.
- Active-connection lookup: `findActiveConnection` calls
  `lmsConnectionsDescribe` (via `describeConnections`) and returns the
  first `active` connection for the target providerId, or null.
- OAuth handoff (when no active connection exists): `runOAuth` calls
  `lmsConnectionsBegin`, then opens the authorization URL in a
  named-target popup (`lyfelabz-lms-oauth`) via the injected
  `OAuthHandoff`. The main page does not navigate.
- Callback delivery: the same-origin callback page
  (`app/lms-callback.html`, served at `/app/lms-callback.html`)
  extracts the OAuth `code` and `state` from its own URL and posts them
  to the opener as a `{ type: "lyfelabz-lms-oauth", code, state }`
  payload. The handoff verifies `ev.origin === win.location.origin` and
  that `state === expectedState` before resolving. Mismatches produce a
  `state-mismatch` error, which the orchestration converts to a plain
  connecting-stage message. Because delivery is a same-origin
  postMessage into the still-resident controller, no client-side
  persistence of the pending import intent is required or used.
- Distinguishing import from account connection: the controller that
  invoked `beginConnection` is the same instance that awaits the
  handoff and continues to `lmsConnectionsComplete` and
  `lmsClassesDiscover`. There is no cross-controller signal; the code
  path never confuses "connect from Settings" with "connect during
  import" because the two controllers are distinct.
- Continuation to discovery: `runOAuth` returns synchronously (from the
  caller's perspective) once the popup posts back; `start` then awaits
  `loadCourses`, which invokes `lmsClassesDiscover` automatically. No
  second Import click is required.
- Replay prevention: the OAuth `state` parameter is validated in the
  handoff before the code is ever surfaced. The popup is closed and
  the message listener is removed the moment the promise settles;
  additional postMessages from a stale popup are rejected by the
  `settled` guard. The `state` value is a server-issued nonce per
  Sprint 8B and cannot be re-used.
- Cancel / deny: closing the popup surfaces a `cancelled` code via the
  poll loop; provider-side denial surfaces an `error` payload. Both
  are translated to friendly connecting-stage messages. The controller
  transitions to `error`; the teacher can dismiss and retry from the
  same primary entry point.
- Popup blocked: surfaced as `popup-blocked`, translated to
  "Your browser blocked the sign-in window. Allow pop-ups for
  LyfeLabz and try again." No raw code leaks.
- Settings is never navigated to during this flow.

The audit-invocation concern about a "full-page redirect" is
architecturally inapplicable here. If a future sprint replaces the
popup-based handoff with a redirect-based handoff, the pending intent
would need to be persisted (e.g. sessionStorage keyed by the OAuth
state parameter) and reconstructed on return. That is out of scope for
Sprint 24B.

## 8. Provider Abstraction and Selection Review

- Provider selection uses stable metadata from the certified provider
  contract. `resolveProvider` calls `lmsProvidersList` and matches by
  the stable `providerId` string authored in the server-side registry
  (`platform/functions/src/lms/providers/google-classroom/adapter.ts`,
  where `GOOGLE_CLASSROOM_PROVIDER_ID = "googleClassroom"`). The
  matching field is `providerId`. Array order is not consulted.
- Behavior when Google Classroom is unavailable: `resolveProvider`
  throws a connecting-stage `StageError` with the message "Google
  Classroom is not available on your account yet. Ask your school
  administrator to enable it." The controller transitions to `error`;
  no OAuth or discovery is attempted.
- Behavior when more than one provider is returned: unchanged.
  Additional providers are ignored by this specific Import Class from
  Google Classroom entry point; other providers would be reached
  through their own future entry points.
- Provider abstraction remains intact: the resolved `providerId` is
  threaded as an opaque string through every downstream callable
  (`beginConnection`, `describeConnections`, `completeConnection`,
  `discoverClasses`); no other client code branches on it. The
  provider-neutral roster reconciliation engine and the provider
  registry are unchanged.
- Teacher-facing copy references Google Classroom by the display name
  returned from `lmsProvidersList`, not a client-side constant. Only
  the stub-fallback copy on the disabled Phase 1 fallback button uses
  a static "Google Classroom" label; when the seam is wired, the live
  display name is authoritative.
- The provider registry (`platform/functions/src/lms/providers/registry.ts`)
  was not modified. `listProviders` remains authoritative.
- Tests covering selection:
  1. "provider selection: Google Classroom is selected when it is not
     the first provider returned" - deliberately puts a `canvasLMS`
     stub in position [0] and Google Classroom in position [1];
     asserts the flow discovers on the Google Classroom connection.
  2. "provider selection: Google Classroom unavailable surfaces a
     plain-language error" - returns only a Canvas stub; asserts the
     flow errors at the connecting stage with the approved message,
     never calls `discoverClasses`.
  3. "provider abstraction: provider metadata is read from
     listProviders, not hard-coded strings" - swaps the display name
     to "Google Classroom (Beta)" and asserts the teacher-facing
     prose picks up the new label without a client change.

## 9. Duplicate Import Behavior

Ordering: the controller queries the teacher's active `lmsClassLinks`
and `classes` (via the injected `listClassLinks` and
`listTeacherClasses` seams) **before** invoking either `classesCreate`
or `lmsClassesImport`. If the picked course's `lmsClassId` already
appears in an active link, the flow transitions to the `duplicate`
state without creating any LyfeLabz class and without any server-side
side effect. Confirmed by the test "duplicate course detected
client-side surfaces the Open class / Cancel panel," which asserts
that `calls` contains no `createClass:*` or `importClass:*` entry.

Duplicate information source: `IntegrationsClassLink` rows for the
authenticated teacher, joined against `IntegrationsLyfeLabzClass`
rows from the classes reader by `link.classId === class.id`. The
existing class id is `link.classId`; the class name is `class.title`
if the join finds a match, or the fallback string "your linked
class" if it does not.

The duplicate panel presents:

- The linked LyfeLabz class title.
- Open class (`data-testid="classes-import-open-existing"`).
- Cancel (`data-testid="classes-import-cancel"`).
- No Import anyway action anywhere in the DOM.

The Sync roster now action is deferred to Phase 3 per the
invocation's phase-boundary rule; this is a deliberate omission, not
an oversight.

Race between duplicate detection and `lmsClassesImport`: if
`listClassLinks` succeeds and reports no link, but another tab links
the same course between that check and the server-side
`lmsClassesImport` call, the server-side `alreadyLinked` error is
authoritative. In that race the just-created LyfeLabz class is a
benign orphan; the teacher sees the linking-stage recovery panel
described in §10.

Best-effort limitation: if the injected `listClassLinks` reader is
absent or throws (rules-side denial, transient Firestore error), the
client-side pre-check returns null and the flow proceeds to
`classesCreate` then `lmsClassesImport`. In that failure mode the
server-side `alreadyLinked` code becomes the sole duplicate signal,
which produces the orphan LyfeLabz class described above. The
current certified callable contracts do not offer a "pre-check
against server-side link state" primitive, and Phase 2 is explicitly
not authorized to introduce one; the exact limitation is recorded
here and in §10 rather than hidden.

## 10. Partial-Failure Recovery

- `classesCreate` failure: the flow stops at the creating stage. The
  teacher sees a plain-language message and a Try again action that
  re-runs the flow from provider resolution. No LyfeLabz class was
  created; no cleanup is required.
- `lmsClassesImport` failure after successful create: the flow stops
  at the linking stage. The teacher sees a message that names the
  created class by its Google Classroom title, explains that linking
  did not complete, and guides them to rename or archive the new
  class from Classes. The Try again action is intentionally suppressed
  on this stage to avoid a second `classesCreate` attempt (which
  would produce a second orphan class); the teacher can invoke
  Import Class from Google Classroom again from the primary entry
  point after closing the error panel.
- No new destructive cleanup callable was created. Blueprint §4.1
  explicitly names archive / removal work as out of scope for Phase 2.
- Raw OAuth errors, raw upstream API errors, callable names, Firestore
  document ids, provider account identifiers, and Firebase UIDs are
  never surfaced. Every message is authored teacher-facing prose in
  the orchestration module.

## 11. Phase Boundary Verification

Phase 3 through Phase 7 work is not implemented. Explicitly:

- `lmsClassesSyncRoster` is not invoked from the Classes surface, from
  the class workspace, or from anywhere else in Phase 2.
- The class workspace roster view is not implemented. The Snapshot
  and roster placeholder surfaces render exactly as they did after
  Phase 1.
- Sync roster action, unresolved-count display, reconciliation
  display, and roster reconciliation state are not added.
- `expiredRefresh` classification, the distinct Reconnect label, and
  the class-scoped Reconnect action are not added. The Settings
  Connect action continues to double as Reconnect per §9.1 of the
  blueprint amendment.
- Connected Google account email and Last successful synchronization
  timestamp are not rendered in Settings.
- Production certification is not claimed.

## 11.1 Reentrancy Protections

The `ImportController` guards against duplicate submission at two
levels. UI-side: the primary `classes-import-open` button carries
`disabled = true` and `aria-disabled = true` for every non-idle,
non-error state (`connecting`, `discovering`, `courses`, `duplicate`,
`creating`, `linking`, `error`), so a rapid second click is dropped
before it reaches the controller. Controller-side: two synchronous
in-flight flags (`startInFlight`, `selectInFlight`) reject a second
call to `start` or `selectCourse` even if two events dispatch inside
the same JavaScript turn (for example, a keyboard-and-mouse
double-fire on a course tile). The state-machine `state.kind` gate
alone is not sufficient here, because the state does not transition
until the first `await` inside the handler resolves; the boolean
flags close that window.

The consequence is that one teacher action produces at most one
`classesCreate` invocation and at most one `lmsClassesImport`
invocation. Callback replay is prevented by the OAuth state check
described in §7, and by the fact that the popup is closed and its
message listener removed as soon as the first valid message settles
the handoff promise. Controller recreation across a full page reload
would restart the flow from idle; no persistent client state carries
half-finished imports across reloads (and the popup handshake means
there is no reload to plan for).

Reentrancy tests:

- "reentrancy: a double-click on a course tile does not create two
  LyfeLabz classes" - fires two `selectCourse` calls back-to-back
  before the first resolves; asserts exactly one `createClass` and
  exactly one `importClass` invocation.
- "reentrancy: a double-click on Import does not initiate two OAuth
  flows" - fires two `start` calls before the first resolves; asserts
  exactly one `beginConnection` and exactly one `openOAuth`
  invocation.

## 12. Tests Performed

New and updated tests added by Phase 2:

- `app/src/classes/importFromClassroom.test.ts` (15 tests):
  1. Connected teacher proceeds directly to course discovery.
  2. Disconnected teacher runs OAuth inline and returns to discovery
     without a second Import invocation.
  3. Course selection creates class and links it, ending in the
     linked state (verifies exact `classesCreate` + `lmsClassesImport`
     order).
  4. Duplicate course detected client-side surfaces the Open class /
     Cancel panel and does not call `classesCreate` or
     `lmsClassesImport`.
  5. OAuth popup-blocked surfaces a plain-language message; the
     raw `popup-blocked` code does not leak.
  6. `classesCreate` failure stops at the creating stage; internal
     names and raw codes do not appear in the message.
  7. `lmsClassesImport` failure after successful create surfaces
     recovery guidance that names the created class.
  8. Empty course list surfaces a teacher-facing empty state (not a
     spinner).
  9. Cancel returns the state machine to idle without extra callables.
  10. Provider selection: Google Classroom is selected when it is
      not the first provider returned (a `canvasLMS` stub sits at
      index [0] and Google Classroom at index [1]).
  11. Provider selection: when Google Classroom is not registered at
      all, the flow errors at the connecting stage with the approved
      plain-language message and never calls `discoverClasses`.
  12. Reentrancy: two concurrent `selectCourse` calls produce exactly
      one `createClass` and exactly one `importClass` invocation.
  13. Reentrancy: two concurrent `start` calls produce exactly one
      `beginConnection` and exactly one `openOAuth` invocation.
  14. OAuth cancelled by the teacher surfaces a friendly
      connecting-stage message; no class is created; no import call
      is issued.
  15. Provider abstraction: teacher-facing prose picks up whatever
      `displayName` the certified `listProviders` returns for the
      Google Classroom record (test uses "Google Classroom (Beta)").

- `app/src/shell/surfaces/classes.test.ts` (added 5 Phase 2 tests):
  1. Import button is active when the import-from-classroom seam is
     wired and Settings is not present on the Classes surface.
  2. Connected teacher click-Import-pick-course lands in the class
     workspace with the expected class id; no create form is
     rendered, no intermediate success screen appears.
  3. Disconnected teacher begins OAuth from Classes and continues to
     discovery automatically (no second Import click, no Settings
     redirect).
  4. Duplicate course surfaces Open class / Cancel; no Import anyway
     testid exists; `classesCreate` / `lmsClassesImport` are not
     invoked.
  5. Link-stage failure after successful create shows recovery text
     naming the created class and marks the linking stage `failed`.

Full app verification chain:

- `npm --prefix app run curriculum:verify` - FAIL (pre-existing
  drift; see §14).
- `npm --prefix app run lessons:verify` - green.
- `npm --prefix app run typecheck` - green.
- `npm --prefix app run lint` - green.
- `npm --prefix app run test` - 778 tests pass; 1 pre-existing failure
  in `src/curriculum/curriculumManifest.test.ts` unchanged from
  Phase 1. Confirmed unchanged: the failing test is the same
  `Canonical curriculum manifest (Sprint 6D.0) > checked-in manifest
  matches a freshly parsed canonical index.html`, reporting drift
  between `index.html` and `app/src/curriculum/curriculum.manifest.json`.
  Sprint 24B does not touch curriculum files (Preservation Mode plus
  the invocation's explicit direction: "Do not modify unrelated
  curriculum files as part of Sprint 24B").

Preview server: not started. Both surfaces are behind Firebase
Authentication + activeTeacher session gating. The DOM and callable
contract is covered exhaustively by jsdom-based unit tests and the
orchestration state machine tests. A dev-server pass cannot exercise
a real teacher session, an active Google Classroom OAuth cycle, or
the certified callable seams without production auth state. This
matches the Phase 1 verification decision.

## 13. Results

- Import Class from Google Classroom is active from Classes.
- Disconnected teachers begin OAuth from Classes and continue
  automatically to discovery.
- Connected teachers proceed directly to discovery.
- Course selection invokes the approved certified client sequence
  (`classesCreate` then `lmsClassesImport`), in that order, from the
  Classes side.
- Metadata is deterministic. The teacher is never prompted for
  destination, name, grade, block, color, or period.
- Duplicate detection produces teacher-facing recovery UX with
  Open class and Cancel, and no Import anyway control.
- Partial failures stop at the correct progress stage and surface
  recovery guidance keyed to the stage.
- Raw provider and backend details are never rendered.
- Provider abstraction is preserved end-to-end; the orchestration
  works against a synthetic non-Google provider by construction.
- Settings > Integrations remains account-management only. No class
  workflow was reintroduced.
- The existing Create LyfeLabz Class behavior remains intact and is
  covered by every previous Phase 1 test.
- No Phase 3 behavior was introduced.

## 14. Known Risks and Deferred Work

- The pre-existing curriculum-manifest drift continues to fail the
  `curriculum:verify` gate on any branch built from main. This is not
  a Phase 2 regression. It was documented in the Phase 1 report and
  is explicitly out of Sprint 24B scope per the invocation.
- Sync roster now is intentionally omitted from the duplicate panel.
  It belongs to Phase 3 per Blueprint §4.3, and the invocation
  explicitly forbids surfacing Phase 3 behavior in Phase 2. When
  Phase 3 lands, the duplicate panel will grow an active Sync roster
  now action alongside Open class and Cancel.
- No certified cleanup callable exists for the benign orphan class
  produced when linking fails after `classesCreate` succeeds. Phase 2
  chose plain-language recovery guidance over creating a new
  destructive callable, per the invocation's architecture rules.
- Grade and block defaults are shared with the manual create-class
  form. When a teacher-default preference is added (Blueprint §9
  future enhancement), the same site should read from it.
- The account-level Settings capabilities documented in the §9.1
  amendment remain deferred to Phase 5.
- Duplicate detection is best-effort client-side; if the
  `listClassLinks` read fails, the orchestration falls through to the
  server-side `alreadyLinked` check on `lmsClassesImport`, which is
  authoritative.

## 15. Architectural Compliance

- No new callable was introduced.
- No `lmsClassesImportAsNew` or equivalent orchestration callable
  was created.
- No provider-specific backend contract was added.
- No new audit event kind was emitted.
- No Firestore schema change was made.
- No Firestore Rules change was made.
- No destructive cleanup was performed.
- No unrelated refactoring was performed.
- Every new client module accepts callables as injected dependencies.
  No firebase/* import was added to any file under `app/src/shell/**`
  or `app/src/classes/**`. `app/src/index.ts` remains the sole seam
  that constructs the callable adapters.
- The Sprint 3 Step 5 shell invariant (no firebase/* imports in the
  shell tree) is preserved.
- Provider abstraction (§5) is preserved; provider id is opaque and
  never branched on.
- Finalized terminology (§2) is used: "Import Class from Google
  Classroom" for the primary action, "Create LyfeLabz Class" for the
  secondary action.
- No em dashes were added anywhere. Verified by grep of every Phase 2
  modified file and this report.

## 15.1 Post-Report Audit Corrections

The Phase 2 focused audit produced two narrow implementation
corrections and one language correction. All corrections stay inside
the Blueprint §4.2 authorization envelope. No new callable, no
Firestore schema change, no persisted-state addition.

1. Provider selection: `resolveProvider` in
   `app/src/classes/importFromClassroom.ts` no longer selects
   `providers[0]`. It now matches on the stable provider id
   `googleClassroom` from the certified server-side registry. New
   tests verify Google Classroom is chosen when it is not first, and
   that an unavailable-provider case surfaces the approved error
   without any OAuth or discovery call.

2. Reentrancy: `ImportController.start` and
   `ImportController.selectCourse` now carry synchronous in-flight
   flags (`startInFlight`, `selectInFlight`) so a rapid second
   invocation is rejected before it reaches the state machine.
   Combined with the existing UI-side `disabled` gating on the
   primary Import button, one teacher action produces at most one
   `classesCreate` and one `lmsClassesImport`. New tests fire two
   concurrent `start` calls and two concurrent `selectCourse` calls
   and assert exactly one downstream invocation per callable.

3. Report language: the "optimistic" characterization of the
   workspace hand-off was removed. Navigation to the class workspace
   happens only after `lmsClassesImport` returns a confirmed
   successful link; the hand-off is deterministic and confirmed, not
   optimistic. Sections 3, 4, 6, and 7 above have been updated to
   describe the flow accurately.

Additional tests added by the audit pass (see §12):

- Provider selection: Google Classroom not first.
- Provider selection: Google Classroom unavailable.
- Reentrancy: concurrent `selectCourse` calls.
- Reentrancy: concurrent `start` calls.
- OAuth cancelled by the teacher.
- Provider display-name inheritance (replaces the earlier
  synthetic-provider test).

## 16. Sprint 24B Phase 2 Certification Recommendation

Recommend approval of Phase 2 with the following notes on file:

- Phase 2 delivers the primary Import Class from Google Classroom
  orchestration end-to-end from the Classes surface, within the
  Blueprint §4.2 authorization envelope as amended by §9.1. It does
  not deliver, and is not authorized to deliver, any Phase 3 through
  Phase 7 behavior.
- The Sync roster now action in the duplicate panel is deferred to
  Phase 3, exactly as the invocation's phase-boundary rule directs.
- The account email and last-successful-sync deferrals recorded in
  the §9.1 amendment remain scheduled for Phase 5.
- The one failing test in the app suite (curriculum manifest drift)
  is a pre-existing failure on the untouched main branch and does not
  block Phase 2 certification.

Phase 3 (Roster synchronization trigger) is not authorized to begin
until this Phase 2 report is explicitly approved.

## 17. De-Certification Appendix (2026-07-30)

This appendix records the withdrawal of Phase 2 certification. The
rest of this report is retained unchanged so the accurate accounting
of the OAuth handoff, orchestration state machine, duplicate
detection, reentrancy, and provider-selection work stays on file.

### 17.1 What is de-certified

The metadata origination behavior described in §6 ("Grade and block
fall through to the shared server-compatible defaults ('7', 'A')")
is de-certified. Persisting hard-coded `grade: "7"` and
`block: "A"` on every imported class is an architectural defect and
must not be characterized as an acceptable behavior of the import
path. The rationale previously given (that grade and block are
convenience metadata editable later from class settings) is
withdrawn. Untruthful metadata on a non-interactive creation path
is a correctness defect, not a convenience question:

- Curriculum eligibility, lesson filters, and grade-scoped
  surfaces treat every imported class as Grade 7 regardless of
  reality.
- Analytics and dashboards attribute imported classes to Block A
  regardless of reality.
- No teacher intervention step is guaranteed to correct the
  values, because no prompt is presented and no downstream
  surface flags the class as needing editing.

The same defect exists in Manual Create insofar as the form
initial state is Grade 7 / Block A, but Manual Create is
interactive: the teacher is guaranteed to see and confirm both
fields before submission, so the defect is contained to a "default
selection" rather than a "silent persisted value."

### 17.2 What remains valid

The following Phase 2 deliverables remain in place and are carried
forward by Phase 2B without change:

- The Classes-side import entry point and its inline OAuth path
  (§7).
- The `ImportController` state machine, including reentrancy
  protections (§11.1).
- Provider selection by stable `providerId` from the certified
  registry (§8).
- Client-side duplicate detection with the Open class / Cancel
  panel and the absence of an "Import anyway" control (§9).
- Partial-failure recovery UX at the creating and linking stages
  (§10).
- The confirmed (not optimistic) hand-off to the class workspace
  after `lmsClassesImport` returns a successful link (§6, §15.1).

None of these behaviors is affected by the metadata-origination
resolution.

### 17.3 Metadata blocker (recorded)

- Site of the defect: `app/src/classes/importFromClassroom.ts` (the
  `classesCreate` invocation composed by the import orchestration)
  and, as its direct source, the Manual Create form default values
  in the Classes surface.
- Nature of the defect: the client submits `grade: "7"` and
  `block: "A"` because the write shape `ClassCreationWrite` requires
  both fields and no other value is available at import time.
- Contributing invariants: `ClassCreationWrite` requires
  `grade` and `block` at the write boundary;
  `ClassLmsLinkWrite` intentionally does not accept metadata (per
  PDR-019i, PDR-019j), so the LMS-link callable cannot be used to
  correct the values after creation.
- Downstream effect: every imported class is persisted as Grade 7
  Block A in `lyfelabz-prod` from the moment of import until a
  teacher manually edits both fields.

### 17.4 Approved architectural resolution

The ratified resolution is the hybrid model in
`ADR_TEACHER_DEFAULT_CLASS_METADATA.md`:

- Teacher-level `defaultGrade` preference at
  `users/{uid}/preferences/teacher`; optional-absent representation;
  provider-neutral.
- No teacher-level `defaultBlock`. `block` is per-class.
- Imported classes are written with a new
  `ClassLmsCreationWrite` shape that sets `status: "needsSetup"`
  and omits `grade` and `block`.
- The single lifecycle field on a class remains `status`. The
  `ClassStatus` union is extended to
  `"active" | "archived" | "needsSetup"`. No second lifecycle
  field is introduced.
- A new activation callable performs the atomic transition from
  `needsSetup` to `active` with valid `grade` and `block`.
- The teacher completes a one-screen setup form inside the imported
  class workspace. Grade is pre-filled from `defaultGrade` when
  present; block is always a teacher choice.
- Google Classroom import remains uninterrupted; no metadata
  prompt appears during import.

### 17.5 Additional work required before Phase 2 (2B) certification

Per Blueprint §9.2.4, the following work is required. None of it
is authorized to begin until Phase 2B is explicitly opened.

1. Teacher preference data contract (`preferences/teacher` subdoc,
   reader on the `activeTeacher` branch, writer, closed-set
   validation, Rules).
2. `ClassStatus` extension to include `"needsSetup"`, plus the
   discriminated union at the type boundary and an audit of every
   server-side class reader.
3. New `ClassLmsCreationWrite` seam. Client import path stops
   invoking `classesCreate`; invokes the new
   create-as-needsSetup seam instead. `lmsClassesImport` is
   unchanged.
4. Imported-class setup workspace (grade + block form; activation
   handler; teacher-facing copy; no exposure of the internal
   `needsSetup` term).
5. New `classesActivate` (or equivalent) callable with
   `ClassActivationWrite`. Atomic transition. Idempotent on
   `active`. Rejects `archived`.
6. Removal of hard-coded `"7"` and `"A"` at every write site
   (import path first, Manual Create default second). Manual
   Create pre-fills grade from `defaultGrade` when present.
7. Firestore Rules updates covering the preference doc,
   `needsSetup` creation authority, assignment eligibility guards,
   and join-code enrollment guards.
8. Regression coverage for existing `active` classes (loaders,
   assignment eligibility, roster viewer, Snapshot metrics,
   archive callable).
9. Phase 2B completion report
   (`SPRINT_24B_PHASE_2B_COMPLETION_REPORT.md`) that certifies the
   above and re-certifies the carried-forward Phase 2 surface.

The implementation-ready authorization envelope for the above work
is `docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md`.
No Phase 2B code work is authorized outside that specification.

### 17.6 Consequences for downstream phases

Phase 3 (Roster synchronization trigger), Phase 4 (Class workspace
roster view), and every subsequent phase remain blocked until
Phase 2B is implemented and certified. Phase 3 must additionally
decide, at authorization time, whether the initial roster sync
runs against `needsSetup` classes or waits until activation.

*End of Phase 2 report, including de-certification appendix.*
