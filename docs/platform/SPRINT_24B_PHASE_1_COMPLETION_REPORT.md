# Sprint 24B - Phase 1 Completion Report

Phase: 1 of 7 - Classes Surface Refactor (UI, routing, navigation only)
Governing authority: `docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md` §4.1
Preservation Mode: honored throughout.
Revision: 2 (post-compliance-review corrections applied).

## 1. Executive Summary

Phase 1 relocates every class-creation and class-import entry point
from Settings > Integrations to the Classes surface, per Blueprint
§3.1, §3.2, and §4.1. The Classes surface now exposes exactly two
teacher entry points:

- Primary: Import Class from Google Classroom (inert stub - real
  workflow lands in Phase 2)
- Secondary: Create LyfeLabz Class (existing manual create-class form,
  now labeled with the finalized terminology)

Settings > Integrations becomes an account-management surface only.
Every class-workflow control (Import a class, course picker, Imported
classes list, per-link refresh, per-link health surface) has been
removed. The account-level surface today exposes exactly the controls
the certified callable contract can support: the provider row, the
Connected / Not connected status pill, the Connect action, and the
Disconnect action. Additional account-level capabilities named in the
Blueprint (connected Google account email; last successful
synchronization timestamp; a distinct Reconnect label for the
expiredRefresh status) require server-side contract additions that
Phase 1 is not authorized to make and are enumerated below in §5.

Below the removed class-workflow controls, Settings > Integrations
renders a plain-language guidance sentence pointing teachers to the
Classes surface. Per Blueprint §3.4, that sentence is intentionally
not a redirect: no URL-addressable Integrations deep link exists, no
persistent legacy entry point currently routes teachers here for a
class workflow, and no shell-navigation callback is wired into the
Integrations surface. Guidance copy is the simpler of the two options
Blueprint §3.4 authorizes for the transitional affordance.

No callable was renamed, added, or removed. No Firestore write, rule,
or index changed. No Functions code changed. The `lmsClassesImport`,
`lmsClassesDiscover`, and `lmsClassesRefresh` callables remain on the
server, unchanged, awaiting Phase 2 wiring on the Classes side.

## 2. Files Modified

- `app/src/shell/surfaces/classes.ts`
  - Added `renderImportEntryPoint(doc)` producing the primary Import
    Class from Google Classroom stub button (`data-testid=
    classes-import-open`) plus a status paragraph (`data-testid=
    classes-import-status`, `id="classes-import-status"`). The button
    is `disabled`, carries `aria-disabled="true"`, an
    `aria-describedby` pointing at the status paragraph, and an
    accessible `title` tooltip, per Blueprint §4.1 stub requirement.
    The status paragraph is rendered before the button in DOM order so
    the id target exists before `aria-describedby` is announced.
  - Renamed the manual create-class button label from "Create class"
    to "Create LyfeLabz Class". `data-testid=classes-create-open` is
    preserved so existing focus, cancel, and submit tests continue to
    exercise the secondary entry point without modification.
  - Renamed the create-class form heading and submit button label to
    "Create LyfeLabz Class" (also "Creating" in-flight, unchanged).
  - Updated the empty-state prompt to reference both entry points.

- `app/src/settings/integrations/integrations.ts` (rewrite)
  - `ViewState` narrowed from `loading | unavailable | ready |
    importing` to `loading | unavailable | ready`.
  - Removed: `renderImporting`, `renderImportTable`,
    `renderImportedClasses`, `renderImportedRow`, `onImportBegin`,
    `onImportConfirm`, `onRefreshLink`, `healthByLinkId`,
    `refreshingLinkId`, and every health/pill copy helper.
  - Removed the per-provider "Import a class" button
    (`integrations-import-<providerId>`) from the connected row.
    Connect and Disconnect remain the only per-provider actions.
  - Intro copy updated to the account-management scope required by
    Blueprint §6.2.
  - Added the transitional guidance sentence (`data-testid=
    integrations-classes-guidance`, class `shell-integrations-guidance`)
    per Blueprint §3.4. This is guidance copy, not a redirect: it
    performs no navigation. The prior `integrations-classes-redirect`
    testid was retired to avoid overstating the affordance.
  - The IntegrationsCallables interface is unchanged (still declares
    `importClass`, `refreshClass`, `discoverClasses`,
    `listClassTopics`, `publishAssignment`) so other consumers (the
    Assignment Dialog, and the Phase 2 Classes orchestration) can
    still receive the wired seams. This is a Settings-side caller
    removal, not a callable removal, per Blueprint §4.1.

- `app/src/shell/surfaces/settings.ts`
  - Copy update to the Connected Services category body, describing
    the new account-only scope and pointing teachers at Classes for
    class import and creation. Blueprint §3.4 explicitly allows this
    scoped copy update; no other Settings root behavior changed.

- `app/src/shell/surfaces/classes.test.ts`
  - One test covering both Phase 1 Classes entry points (Import stub
    present, disabled, labeled, `aria-disabled`, `aria-describedby`
    wired; Create LyfeLabz Class present and labeled; DOM order
    Import-before-Create; status paragraph id).
  - One additional test confirming exactly the two approved entry
    points render on Classes and no legacy Settings-side class-workflow
    control has leaked back in.

## 3. Files Created

- `app/src/settings/integrations/integrations.test.ts`
  - Five tests covering:
    1. Connected state exposes no class-workflow controls (no import
       button, no import panel, no imported-classes list, no candidate
       picker, no per-link health surface, no roster refresh) and the
       transitional guidance sentence is present. The prior
       `integrations-classes-redirect` testid must not linger.
    2. Account-level capability matrix: connected row exposes exactly
       the Status pill and the Disconnect action. Explicitly asserts
       the absence of every removed class-workflow testid.
    3. Reconnect in Phase 1 is the same DOM control as Connect: it is
       rendered when no active connection exists and drives the
       certified OAuth pair. A distinct Reconnect label for the
       expiredRefresh status is a Phase 5 deliverable.
    4. Disconnected state shows Connect and never the import button.
    5. Load and connect flow never invoke `discoverClasses`,
       `importClass`, or `refreshClass` - the Settings surface is now
       inert against every class-workflow callable.

- `docs/platform/SPRINT_24B_PHASE_1_COMPLETION_REPORT.md` (this file).

## 4. Architectural Compliance Review

Compared line-by-line against Blueprint §4.1 Scope, Non-scope,
Deliverables, and Definition of Done:

- Two entry points on Classes: implemented (Import Class from Google
  Classroom primary stub; Create LyfeLabz Class secondary).
- Existing manual create-class form rewired: `classesCreate` seam is
  unchanged; only the label copy shifted to the finalized
  terminology.
- Removed from Settings > Integrations: "Import a class" button, the
  `kind: "importing"` course-picker branch, the Imported classes list,
  the refresh action, and the per-link health surface. All confirmed
  absent by the new test suite.
- Preserved in Settings > Integrations: provider row (Google Classroom
  display name from `listProviders`), Connected / Not connected status
  pill from the certified `describeConnections` `status` field, Connect
  action wired to `lmsConnectionsBegin` / `lmsConnectionsComplete`,
  Disconnect action wired to `lmsConnectionsDisconnect`. See §5 for
  the account-level capability matrix.
- `lmsClassesImport` remains on the server, unchanged. Only the
  Settings-side caller was removed. Confirmed by grepping
  `wire.ts:113` - the callable definition still exists on the wire
  seam.
- Import Class from Google Classroom in Phase 1 is an inert control
  with accessible tooltip and status line, per Blueprint §4.1 stub
  language. See §7.
- Non-scope respected: no new callable, no Firestore Rules change, no
  indexes change, no schema change, no `lmsClassesSyncRoster` change,
  no class workspace roster change, no audit event change.

Provider abstraction guardrails (Blueprint §5): the stub button
carries no hardcoded provider id in a persisted contract; the label
uses the Google Classroom display name as an authored teacher-facing
string. The Phase 2 wiring will consume the injected provider list
per §5.

Finalized terminology (Blueprint §2): the two teacher-facing labels
that Phase 1 introduces or changes are "Import Class from Google
Classroom" and "Create LyfeLabz Class". Prohibited alternatives do not
appear anywhere in the Phase 1 diff.

Style: no em dashes were added anywhere. Verified by grep of every
Phase 1 modified file and the report itself.

## 5. Settings Capability Matrix

Blueprint §3.2 identifies five account-level Settings capabilities.
Each is evaluated below against the certified client contract
(`describeConnections` returns `connectionId`, `providerId`, `status`,
and `scopes` per `platform/functions/src/lms/connections-describe.ts`).

| Capability                             | Blueprint | Phase 1 State                                                                                              | Notes                                                                                                                                                             |
|---------------------------------------|-----------|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Connected Google account (email)      | §3.2, §6.2 | Not rendered.                                                                                              | `LmsConnectionSummary` does not carry the connecting teacher's email. Adding it requires a server-side callable-response extension, which Phase 1 forbids.         |
| Connection status                     | §3.2, §6.2 | Rendered.                                                                                                  | Pill reflects the certified `status` field. Active shows "Connected"; absence of an active connection shows "Not connected".                                       |
| Reconnect                             | §3.2, §6.2 | Rendered as the Connect action; there is no separate Reconnect label yet.                                  | The same DOM control drives `lmsConnectionsBegin` + `lmsConnectionsComplete`. A distinct Reconnect label appears when the `expiredRefresh` status ships in Phase 5. |
| Disconnect                            | §3.2, §6.2 | Rendered.                                                                                                  | Wired to `lmsConnectionsDisconnect`.                                                                                                                               |
| Last successful synchronization       | §3.2, §6.2 | Not rendered.                                                                                              | Not in the certified `describeConnections` response and not otherwise available on the client seam. Requires a server-side surface addition in a later phase.      |

The two absent capabilities (account email; last successful
synchronization) are documented deferrals, not certified capabilities
Phase 1 removed. Phase 1 removes nothing that was previously exposed
on the client for account-level use.

Recommended future phase to add each deferred capability:

- Account email: earliest opportunity is Phase 5, alongside the
  `expiredRefresh` status extension of `LmsConnectionSummary`, so the
  callable-response schema change happens once. Alternatively a
  discrete Phase 1.5 patch could add the email-only extension without
  waiting for the token classification work.
- Last successful synchronization timestamp: Blueprint §4.4 introduces
  the sync summary panel inside the class workspace. Surfacing the same
  timestamp inside Settings requires the account-level aggregate to be
  computed server-side. Natural home is Phase 5 or later, once the
  reconnect flow already justifies a callable-response change.

Neither deferral is invented backend behavior. Both are recognized in
Blueprint §3.2 as required, and both are recognized in this report as
requiring server-side work outside the Phase 1 authorization envelope.
Recommend adding both to the Phase 5 scope in a Blueprint amendment.

## 6. Transitional Navigation Decision

Blueprint §3.4 explicitly offers two options for the transitional
affordance and requires only one of them:

1. An inline redirect that swaps the Settings subview back to `root`
   and navigates the shell outlet to Classes, OR
2. A plain-language sentence pointing the teacher at Classes.

Phase 1 chose option 2. The rationale, restated explicitly:

- There is no URL-addressable Integrations deep link (confirmed by
  Blueprint §3.4 first paragraph). No production teacher can arrive
  here from a link, a bookmark, an email, or a support ticket.
- There is no persistent legacy entry point (for example, a durable
  in-app button on another surface) that routes teachers into
  Integrations for a class workflow. The removed "Import a class"
  affordance was itself only reachable from inside Integrations.
- Integrations receives no shell-navigation callback. Adding one would
  require threading a callback through `WorkspaceDeps` and
  `SettingsDeps`, which is outside the Phase 1 scope envelope and is
  not the simplest accurate implementation.

Because there is no actionable legacy path, an actionable redirect
target does not exist. The plain-language guidance sentence, keyed as
`data-testid=integrations-classes-guidance`, is the simplest accurate
implementation. It is intentionally not labeled a redirect anywhere in
the DOM, the code, or this report.

If a future Phase surfaces a URL-addressable Integrations route (see
Blueprint §9 "URL-addressable Settings > Integrations route"), option
1 becomes the natural fit and the guidance sentence should be replaced
with a real navigation control at that time.

## 7. Disabled Import-Entry-Point Review

The primary Import Class from Google Classroom control is inert in
Phase 1 per Blueprint §4.1. Reviewed against every constraint the
compliance pass named:

- Visibly primary in hierarchy: the button appears above the secondary
  Create LyfeLabz Class control in DOM order (locked by a unit test),
  the class name `shell-classes-import-open` is distinct from the
  secondary control, and the empty-state prompt references it first.
- Accessible: `disabled` and `aria-disabled="true"` mirror the
  standard disabled-button pattern; the button carries `title` for
  pointer users; `aria-describedby="classes-import-status"` binds the
  button to the explanatory status paragraph, so screen readers
  announce the "coming soon" reason on focus rather than only when the
  tooltip fires. The status paragraph is emitted with `id=
  classes-import-status` immediately after the button.
- Disabled state understandable: the button label matches the future
  action ("Import Class from Google Classroom"), the tooltip and
  the status paragraph both use plain-language "coming soon" copy, and
  the sentence tells the teacher what will happen once it is
  activated ("It will open the Google Classroom picker directly from
  Classes.").
- Does not mislead a production teacher: no internal engineering
  vocabulary ("stub", "Phase 2", "Sprint 24B", "not yet wired") is
  visible to the teacher; the copy is safe to ship between Phase 1
  and Phase 2.
- Activation phase: Blueprint §4.2 wires the real workflow. The stub
  ships with the Phase 2 wiring and is removed at that point.

No OAuth call, no import call, and no discovery call is issued from
the Classes surface in Phase 1. Verified by inspection of
`renderImportEntryPoint` (no `addEventListener`) and by the
Settings-side test that asserts inertness against the three class
callables.

## 8. Preservation Mode Verification

- No lesson artifact was touched.
- No canonical HTML page was touched.
- No CSS was authored inside instructional lessons.
- Only the client-side anchors named in Blueprint §10 were edited:
  `app/src/shell/surfaces/classes.ts`,
  `app/src/settings/integrations/integrations.ts`, and
  `app/src/shell/surfaces/settings.ts`. `app/src/index.ts` did not
  require any Phase 1 wiring change; the Import stub does not call any
  callable, and the existing `createClass` seam continues to serve the
  secondary entry point.
- No opportunistic refactor was performed. Class-workflow types on
  `IntegrationsCallables` (`importClass`, `refreshClass`,
  `discoverClasses`, `listClassTopics`, `publishAssignment`) were
  deliberately preserved because other consumers (the Assignment
  Dialog, the Phase 2 Classes orchestration) still need them wired.
- No feature was added beyond what Phase 1 authorizes.

## 9. Tests Run

- `npm --prefix app run typecheck` - green.
- `npm --prefix app run lint` - green.
- `npm --prefix app run lessons:verify` - green.
- `npm --prefix app run test` - 763 tests pass; 1 pre-existing
  failure in `src/curriculum/curriculumManifest.test.ts`. Confirmed
  unrelated to Phase 1 by stashing every working-tree change
  (`git stash -u`) and re-running the manifest test, which still
  fails on the untouched main branch. Fixing the manifest drift is
  outside Sprint 24B scope; Preservation Mode plus the Sprint 24B
  scope discipline forbid touching curriculum files here. The failing
  test is `Canonical curriculum manifest (Sprint 6D.0) > checked-in
  manifest matches a freshly parsed canonical index.html`, and it
  reports drift between `index.html` and
  `app/src/curriculum/curriculum.manifest.json`. Recommend a targeted
  fix outside Sprint 24B.
- Preview server: not started. Both surfaces are behind Firebase
  Authentication + activeTeacher session gating; the DOM contract is
  covered exhaustively by jsdom-based unit tests, and a dev-server
  pass cannot exercise a real teacher session without production auth
  state. This matches the original Phase 1 verification decision.

New and updated tests added by Phase 1 (post-correction):

- `classes.test.ts`: two Phase 1 tests. The first covers both entry
  points, the stub inertness (`disabled`, `aria-disabled`,
  `aria-describedby`), the status-paragraph id, and DOM ordering
  (Import above Create). The second confirms exactly the two approved
  entry points exist on Classes and no legacy class-workflow control
  from the old Settings surface has leaked back in.
- `integrations.test.ts` (new file): five tests covering
  account-only scope, the capability matrix (Status + Disconnect
  present; every removed class-workflow testid absent), the Phase 1
  Reconnect-as-Connect equivalence, disconnected-state absence of the
  import button, and inertness against the three class-workflow
  callables during load and connect.

## 10. Results

- Classes is the single teacher entry point for class creation.
- Exactly two entry points exist on Classes: Import Class from Google
  Classroom (primary, stub) and Create LyfeLabz Class (secondary).
- Settings > Integrations exposes no class creation or class import
  control. Provider row shows only Connect (when disconnected) or
  Disconnect (when connected), plus the Connected / Not connected
  pill.
- Existing routing is preserved: navigation left-side items unchanged;
  Settings root category list unchanged; Connected Services still
  routes into the (narrowed) Integrations subview.
- Existing production behavior is preserved end-to-end for account
  management: `lmsConnectionsBegin`, `lmsConnectionsComplete`, and
  `lmsConnectionsDisconnect` continue to be wired through the exact
  same handler paths.
- No account-level capability that was previously exposed on the
  client has been removed; the two Blueprint-named capabilities that
  are not yet rendered (account email; last successful synchronization
  timestamp) require a server-side contract extension and are
  recommended for Phase 5.
- The transitional Settings-to-Classes affordance is honest
  plain-language guidance, per Blueprint §3.4 option 2.
- The disabled primary Import entry point is production-safe: no
  engineering vocabulary, screen-reader-linked explanation,
  keyboard-consistent disabled semantics.
- No regressions observed: every prior test in the app suite still
  passes; the one preexisting curriculum-manifest drift failure is
  reproducible on the untouched main branch.

## 11. Known Risks

- The pre-existing curriculum-manifest drift will fail
  `npm --prefix app run verify` at the `curriculum:verify` gate on any
  branch built from main. This is not a Phase 1 regression, but it
  will prevent a clean green verify chain until it is separately
  reconciled. Recommend a targeted fix outside Sprint 24B.
- The Import Class from Google Classroom stub is inert. Teachers who
  click it will see the button as disabled and read the status line
  explaining that the workflow is coming soon. This is the Blueprint's
  intended UX for Phase 1 (Blueprint §4.1). Confirmed no keyboard or
  screen-reader trap: `disabled` combined with `aria-disabled="true"`,
  `aria-describedby` to the status paragraph, and the `title` tooltip
  is the standard accessible pattern.
- The IntegrationsCallables interface still declares the callable
  seams that Settings no longer invokes. This preserves the wire seam
  for other consumers (Assignment Dialog LMS publication and the
  Phase 2 Classes orchestration) and is intentional. Removing them
  would be an opportunistic cleanup that Preservation Mode forbids.
- Two Blueprint-named account-level capabilities (connected Google
  account email; last successful synchronization timestamp) are not
  yet rendered because the certified client contract does not carry
  the data. This is a documented deferral, not a certified-capability
  removal. Recommend a Blueprint amendment folding both into Phase 5.

## 12. Updated Sprint 24B Phase 1 Certification Recommendation

Recommend approval of Phase 1 with the following notes on file:

- Phase 1 delivers every element inside the Blueprint §4.1
  authorization envelope. It does not deliver, and is not authorized
  to deliver, the account email row or the last-successful-sync
  timestamp row named in Blueprint §3.2, because both require a
  server-side callable-response extension that Phase 1 forbids. This
  report treats those as documented deferrals rather than certified
  gaps.
- Recommend an amendment to Blueprint §4.5 (or a discrete Phase 1.5
  amendment) folding the account email row and the last successful
  synchronization row into the Phase 5 callable-response extension
  that already introduces `expiredRefresh`. The same schema change
  covers all three fields, which minimizes provider-abstraction churn.
- The transitional affordance is guidance copy, not a redirect. If a
  future URL-addressable Integrations route ships, the guidance
  sentence should be replaced with an actual navigation control at
  that time.
- The one failing test in the app suite (curriculum manifest drift)
  is a pre-existing failure on the untouched main branch and does not
  block Phase 1 certification.

Phase 2 (Import Class from Google Classroom orchestration) is not
authorized to begin until this revised report is explicitly approved.

*End of Phase 1 report, Revision 2.*
