# Sprint 24B - Architectural Blueprint

Status: Approved. Governing implementation document for Sprint 24B.

Supersedes no prior document. Extends `SPRINT_24B_DEFINITION.md` with
the finalized terminology, the phased implementation plan, the provider
abstraction guardrails, the finalized teacher-facing UX decisions, the
certification boundaries, and the rollback strategy. `SPRINT_24B_DEFINITION.md`
remains the scope-of-record for what Sprint 24B does and does not
attempt; this blueprint is the how-and-in-what-order layer.

## 1. Purpose

Sprint 24A certified the Google Classroom integration foundation in
`lyfelabz-prod`. A teacher can connect Google Classroom, discover their
courses, and link a Google Classroom course to a pre-existing LyfeLabz
class. Nothing more. No roster is imported, no student is enrolled, no
roster view is rendered.

Sprint 24B closes the gap between "the integration is wired" and "the
teacher has a usable LyfeLabz class produced from Google Classroom".
This blueprint sequences that work into small, independently reviewable
phases so each phase can be shipped, verified, and rolled back without
destabilizing the certified foundation.

## 1.1 Guiding principle

Every Sprint 24B decision should reduce the number of decisions
required by a teacher to prepare a class for instruction.

This principle governs every phase, every UX decision, every callable
wiring, and every piece of teacher-facing copy in Sprint 24B. When two
implementation options are otherwise equivalent, the option that asks
the teacher for fewer inputs, fewer confirmations, or fewer detours
wins. Any decision that adds a prompt, a picker, or a required field
must justify itself against this principle in the phase's completion
report.

## 2. Finalized terminology

The following terms are the only teacher-facing labels authorized for
Sprint 24B. They are used in every UI surface, every audit-adjacent log
line intended for teacher review, and every doc string that appears in
teacher-visible copy.

| Term | Where it appears | Prohibited alternatives |
|---|---|---|
| Import Class from Google Classroom | Primary Classes entry point. Import button. Any teacher-visible copy that names the primary flow. | Create-from-Classroom. Create from Classroom. Import Classroom. Sync Classroom class. |
| Create LyfeLabz Class | Secondary Classes entry point. Manual class-creation form heading. | New class. Add class. Manual class. Blank class. |
| Sync roster | Class workspace header action and sync-summary heading. | Refresh roster. Update roster. Reload roster. Pull roster. |
| Reconnect Google Classroom | The action offered when a connection is in an expired-refresh state. | Refresh connection. Re-authenticate. Retry sign-in. |
| Connected Google account | Settings > Integrations panel account row. | Signed-in account. Linked account. |
| Last successful synchronization | Settings > Integrations panel timestamp row. | Last sync. Last refresh. Last update. |

Internal engineering identifiers, callable names, Firestore field names,
and audit event kinds are unchanged from Sprints 23A through 24A. No
callable is renamed. No collection is renamed. No audit event kind is
added or renamed. The finalized terminology governs only teacher-facing
strings and human-readable log labels.

Style: no em dashes anywhere. Use " - " (spaced hyphen) as the
sentence-level break, per repository standard.

## 3. Surface ownership map

Sprint 24B enforces a strict separation of concerns between the
Classes surface and the Settings > Integrations surface. The map below
is the final ownership contract for the sprint.

### 3.1 Classes surface owns

- Every teacher-initiated classroom workflow.
- The primary "Import Class from Google Classroom" entry point.
- The secondary "Create LyfeLabz Class" entry point.
- The inline OAuth connect step that runs on demand when the teacher
  clicks Import Class from Google Classroom and no active connection
  exists.
- The Google Classroom course picker.
- The link step that binds the chosen Google Classroom course to a
  LyfeLabz class (whether newly minted by the import flow or chosen
  from an existing class in the secondary flow).
- The initial roster synchronization that runs after a successful
  link.
- The on-demand Sync roster action inside the class workspace.
- The class-scoped Reconnect Google Classroom action, offered when the
  class workspace detects an expired-refresh connection state.
- The class workspace roster view, sync summary panel, and unresolved
  count.

### 3.2 Settings > Integrations owns

Only the account-level connection surface. Specifically:

- Connected Google account (email of the connecting teacher, from the
  certified describeConnections response).
- Connection status (active, expiredRefresh, disconnected).
- Last successful synchronization timestamp for the account.
- Reconnect (starts the OAuth flow through the existing
  `lmsConnectionsBegin` and `lmsConnectionsComplete` callables).
- Disconnect (calls the existing `disconnect` callable).

### 3.3 Settings > Integrations does not own

- Class creation.
- Class import.
- Class picking.
- Class linking.
- Roster synchronization.
- Any class workflow of any kind.

A teacher who never opens Settings during normal classroom setup is the
target user journey. Settings exists only for account-level
troubleshooting.

### 3.4 Deep-link redirect (transitional)

Sprint 24A left no URL-based deep link into Settings > Integrations. The
only entry today is the in-memory `subview` toggle in
`app/src/shell/surfaces/settings.ts`. Sprint 24B preserves the
Connected Services entry point in Settings (now scoped per §3.2) and
leaves it addressable from the Settings root. No new URL query
parameter, hash fragment, or route is introduced for Settings.

If any in-app affordance previously routed a teacher into Settings for
a class workflow (for example, an "Import a class" call-to-action inside
Integrations that will be removed in Phase 1), that affordance is
replaced with an inline redirect that either:

- swaps the Settings subview back to `root` and navigates the shell
  outlet to the Classes surface, or
- replaces the removed control with a plain-language sentence pointing
  the teacher to the Classes surface.

The redirect is transitional. It exists only for teachers who had
learned the Sprint 8C flow. It carries no analytics, no telemetry, and
no persisted state. It will be reviewed for removal in a future sprint
once the Classes-first workflow is the only workflow production teachers
use.

## 4. Phased implementation plan

Sprint 24B ships as seven phases. Each phase is independently reviewed,
independently deployable, and independently rollback-able. No phase is
allowed to begin without written approval of the prior phase's
certification report.

Every phase preserves the "no firebase/* imports in the shell tree"
invariant established by Sprint 3 Step 5. Every phase preserves the
provider abstraction guardrails in §5. Every phase respects the
Preservation Mode rule in `CLAUDE.md`.

### 4.1 Phase 1 - Classes Surface Refactor (UI, routing, navigation only)

Goal: relocate every class creation and class import entry point from
Settings to Classes. No backend change, no callable change, no
Firestore schema change, no roster synchronization, no import
orchestration.

Scope:

- Add two entry points to the Classes list view:
  - Primary: Import Class from Google Classroom.
  - Secondary: Create LyfeLabz Class.
- Rewire the existing manual create-class form so it is opened from the
  Create LyfeLabz Class entry point on the Classes surface. The
  existing `createClass` callable seam is unchanged.
- Remove from Settings > Integrations:
  - The "Import a class" button on each active connection row.
  - The Google Classroom course picker view (`kind: "importing"`
    branch).
  - The "Imported classes" list, refresh action, and per-link health
    surface. These will be redesigned as part of the class workspace
    in Phase 4. Interim behavior: link health is not surfaced in
    Settings.
- Preserve in Settings > Integrations:
  - Connected Google account row (email from describeConnections).
  - Connection status pill.
  - Reconnect action wired to the existing OAuth begin/complete
    callables.
  - Disconnect action wired to the existing disconnect callable.
- The Sprint 24A `lmsClassesImport` callable is not removed. It stays
  on the server, unchanged. Only the Settings-side caller is removed.
  Phase 2 will wire a new Classes-side caller.
- The primary Import Class from Google Classroom entry point in Phase 1
  is a stub: it renders an inert control with an accessible tooltip and
  a status line explaining that the import workflow lands in a later
  phase. It does not open a connect popup, discover courses, or link
  classes. This preserves Phase 1 as pure UI/routing.

Non-scope:

- No new callable.
- No changes to Firestore Rules, indexes, or schema.
- No changes to `lmsClassesSyncRoster`.
- No changes to the class workspace roster view.
- No changes to audit event emission.

Deliverables:

- Edits to `app/src/shell/surfaces/classes.ts` to introduce the two
  entry points.
- Edits to `app/src/settings/integrations/integrations.ts` to remove
  the class-workflow controls listed above.
- Edits to `app/src/shell/surfaces/settings.ts` only if necessary to
  keep the Connected Services entry point coherent after Integrations
  controls are removed.
- Unit tests covering the new Classes entry points, the removed
  Settings controls, and the Settings-to-Classes transitional redirect.
- Phase 1 completion report entered in `docs/platform/`.

Definition of done: `npm --prefix app run verify` is green; the two
entry points are visible on Classes; Settings exposes no class
workflow; every existing test that expected the removed Settings
controls has been updated or replaced.

### 4.2 Phase 2 - Import Class from Google Classroom orchestration

Status: superseded in part by §9.2. Sections of §4.2 that describe
metadata inheritance (Title / Grade / Block rules and the associated
rationale) are de-authorized. The as-shipped Phase 2 implementation
is de-certified pending the resequenced Phase 2B specified in §9.2.
The orchestration, OAuth handoff, duplicate detection, reentrancy,
and provider-selection work delivered by the original Phase 2 remain
in place and are carried forward by Phase 2B; only the metadata
origination behavior is replaced.

Goal: implement the primary Import Class from Google Classroom flow
end-to-end, so the entry point stub introduced in Phase 1 becomes a
real workflow. The flow runs entirely within the Classes surface.

Sequence when the teacher clicks Import Class from Google Classroom:

1. If no active Google Classroom connection exists for the teacher,
   the flow runs the OAuth connect step inline. The existing
   `lmsConnectionsBegin` and `lmsConnectionsComplete` callables are
   the only path used. No new provider callable is introduced. No
   silent token refresh loop is added.
2. Once an active connection exists, the flow calls the existing
   `lmsClassesDiscover` callable to enumerate the teacher's Google
   Classroom courses.
3. The teacher picks one course from the returned list.
4. Sprint 24B's new provider-neutral "create-and-link" client
   orchestration is invoked. Server side, this is the composition of
   the existing `classesCreate` callable and the existing
   `lmsClassesImport` callable, invoked in that order by the client.
   No new callable is introduced in Phase 2.
5. The client optimistically opens the newly created class in the
   class workspace and hands off to Phase 3 for the initial roster
   sync.

Class metadata inheritance is deterministic, uninterrupted, and covered
by tests. The import flow never prompts the teacher for additional
metadata. Every field is populated from information already available
at import time. If a field cannot be populated, the class is still
created and the teacher can edit it later from class settings.

Initial rule set:

- Title: the Google Classroom course name.
- Grade: derived from the teacher's default grade if present in the
  authenticated session; otherwise left at the server-side default and
  editable later from class settings. No inline prompt. No silent
  guess against Classroom course fields.
- Block: derived from the teacher's default block if present;
  otherwise left at the server-side default and editable later from
  class settings. No inline prompt. No silent guess against Classroom
  course fields.
- SchoolId, teacherId, and status: inherited from the certified
  `classesCreate` server-side behavior. Client does not compute them.

Rationale: the import experience must remain uninterrupted per the
guiding principle in §1.1. Grade and block are convenience metadata,
not correctness metadata; either can be edited from class settings
without affecting the roster, the identity bridge, or any downstream
callable.

Failure modes handled inline:

- OAuth popup blocked.
- OAuth cancelled.
- Course discovery empty.
- Course already linked to another LyfeLabz class (the existing
  `alreadyLinked` error code is surfaced with a Classes-appropriate
  message).
- Ownership drift.
- Class creation failure (server rejects grade/block validation).

The secondary Create LyfeLabz Class entry point continues to run the
manual form path unchanged from Phase 1.

Non-scope:

- No new server callable.
- No change to `lmsClassesSyncRoster`.
- No roster display work.

Deliverables:

- New `app/src/classes/importFromClassroom.ts` module that owns the
  client orchestration. Consumes injected callables only. Opens no
  Firestore listener. Imports no firebase/* module.
- Wiring change in `app/src/index.ts` to inject the OAuth begin,
  OAuth complete, discover, `classesCreate`, and `lmsClassesImport`
  callables into the Classes surface.
- Unit tests for every branch of the orchestration.
- Phase 2 completion report.

### 4.3 Phase 3 - Roster synchronization trigger

Goal: invoke `lmsClassesSyncRoster` from the client, both as the
final step of the Phase 2 import flow and as an on-demand action inside
the class workspace.

Sequence:

- On successful link (whether from Phase 2's import flow or the
  secondary link-to-existing flow rebuilt in a later sprint), the
  client invokes `lmsClassesSyncRoster({ classId })` once.
- Inside the class workspace, a Sync roster header action invokes
  `lmsClassesSyncRoster({ classId })` on demand.
- The client emits one structured log line at the sync boundary
  capturing only the reconciliation counts. No provider account
  identifier, Firebase UID, or student name is logged.
- The audit event `lms.rosterSynchronized` continues to be emitted
  server-side, exactly once per successful invocation, unchanged from
  Sprint 23C.

Idempotency invariants exercised in the emulator suite:

- Repeat sync against unchanged upstream roster produces zero net
  writes and zero new enrollments.
- Repeat sync never creates a duplicate enrollment for the same
  student.
- The engine never reactivates a `transferred`, `withdrawn`, or
  `archived` enrollment.
- Removals from the upstream roster apply `active -> withdrawn` only.

Non-scope:

- No new server callable.
- No engine change (`platform/functions/src/lms/roster/sync-engine.ts`
  is unchanged).
- No display of unresolved student provider identifiers.

Deliverables:

- New client seam wiring `lmsClassesSyncRoster` into the Classes
  surface and the class workspace.
- Emulator-first test plan exercising the four invariants.
- Phase 3 completion report.

### 4.4 Phase 4 - Class workspace roster view

Goal: replace the class workspace placeholder with a real roster view
scoped to the Sprint 24B roster experience.

Scope:

- Student list with the LyfeLabz-owned display name, enrollment
  status, last sync time, and match state (matched identity,
  unresolved, withdrawn by sync).
- Header actions: Sync roster; Reconnect Google Classroom (visible
  only when the connection is in an expired-refresh state, per
  Phase 5).
- Sync summary panel that appears after each sync, showing the exact
  counts returned by `lmsClassesSyncRoster` (`added`, `reactivated`
  always zero, `unchanged`, `withdrawn`, `unresolved`, `skipped`, and
  the `upstreamRosterEmpty` boolean).
- Unresolved students are shown as a count only. Their provider
  account identifiers, Google emails, and Google display names are
  never exposed. A future sprint may design a resolution UI; Sprint
  24B stops at the count.

Non-scope:

- Assignment surfaces inside the class workspace.
- Attempt views inside the class workspace.
- Any grade or submission display.
- The class-scoped Reconnect Google Classroom action's server-side
  detection (Phase 5).

Deliverables:

- Real roster rendering inside
  `app/src/shell/surfaces/classes.ts` (or a factored sibling file).
- Injected roster reader seam.
- Unit tests for every roster state and every sync summary state.
- Phase 4 completion report.

### 4.5 Phase 5 - Reconnect flow for expired refresh tokens

Goal: introduce the server-side detection and client-side surfacing of
an expired Google OAuth refresh token.

Scope:

- Server-side: the token-exchange path classifies upstream 401/403
  responses and reflects an `expiredRefresh` status into the
  connection state.
- Client-side: the class workspace header shows Reconnect Google
  Classroom in place of Sync roster while the connection is in
  `expiredRefresh`. The Settings > Integrations account row shows
  the same status pill and Reconnect action.
- Reconnect reuses `lmsConnectionsBegin` and `lmsConnectionsComplete`.
  No new provider callable is added.
- No silent refresh loop. No automatic re-prompt.

Non-scope:

- No change to the OAuth client, scopes, redirect URI, Secret Manager
  binding, or typed parameter shape.
- No new provider adapter.

Deliverables:

- Server-side classification patch in the token-exchange path.
- Client-side gating in the class workspace header and the Settings
  account row.
- Emulator tests covering the classification and the surfacing.
- Phase 5 completion report.

### 4.6 Phase 6 - Audit and observability finalization

Goal: verify the observability contract end-to-end in the emulator
suite and lock down the log-line shape for production.

Scope:

- Verification that exactly one `lms.rosterSynchronized` audit event
  is emitted per successful invocation.
- Verification that the client-side structured log line at the sync
  boundary carries only reconciliation counts and the class id, and
  never carries provider account identifiers, Firebase UIDs, emails,
  display names, or OAuth token material.
- No new audit event kinds. No renames.

Deliverables:

- Emulator suite test additions.
- Phase 6 completion report.

### 4.7 Phase 7 - Production verification and Sprint 24B certification

Goal: execute the production verification plan in
`SPRINT_24B_DEFINITION.md` §6 and produce the Sprint 24B completion
report.

Scope:

- Controlled, single-class, teacher-supervised production run.
- Pre-test enrollment count capture.
- Default flow executed, sync counts verified, audit event verified.
- Withdrawal test executed and verified.
- Certification statement written strictly within the boundaries in
  `SPRINT_24B_DEFINITION.md` §8.

Deliverables:

- `docs/platform/SPRINT_24B_COMPLETION_REPORT.md`.

## 5. Provider abstraction guardrails

Sprint 24B does not weaken the provider-neutral architecture certified
by Sprints 23A through 23F. The following guardrails are enforced in
every phase.

- No client-side surface names `googleClassroom` in a way that leaks
  into a persisted contract. Provider ids are opaque strings passed
  through the certified callables.
- Every new client module in Sprint 24B accepts providers as an
  injected list. No hard-coded provider id branch is introduced in
  Classes, in the class workspace, or in the import orchestration.
- The class-scoped Reconnect action is provider-neutral. The client
  reads the provider id from the connection object and forwards it
  to `lmsConnectionsBegin`.
- Teacher-facing copy references Google Classroom by display name
  only. Display names come from the certified `listProviders`
  response, not from client-side constants.
- The provider registry
  (`platform/functions/src/lms/providers/registry.ts`) is not
  modified.
- The token-exchange classification introduced in Phase 5 is
  provider-neutral. It reflects a status enum, not a Google-specific
  error string.
- The provider-neutral roster reconciliation engine
  (`platform/functions/src/lms/roster/sync-engine.ts`) is not
  modified.

## 6. UX decisions (finalized)

### 6.1 Import Class from Google Classroom, disconnected state

Behavior: the button is always visible on the Classes surface, whether
or not the teacher has an active Google Classroom connection. When
clicked with no active connection, the flow runs the OAuth connect
step inline, then proceeds to the course picker. The teacher does not
need to visit Settings.

Rationale: the Classes surface owns every teacher-initiated classroom
workflow. Requiring a Settings detour would recreate the friction
Sprint 24B is designed to eliminate.

### 6.2 Settings > Integrations, account-level only

Behavior: the panel contains only the connected Google account, the
connection status, the last successful synchronization timestamp, the
Reconnect action, and the Disconnect action. Every class-specific
action is removed.

Rationale: separates account custody from classroom workflow. A
teacher who never opens Settings during normal classroom setup is the
target user journey.

### 6.3 Manual class creation stays available and stays secondary

Behavior: Create LyfeLabz Class remains available on the Classes
surface with the existing manual create form. It is visually and
navigationally secondary to Import Class from Google Classroom.

Rationale: teachers without a Google Classroom course still need to
create a LyfeLabz class. Preservation Mode prohibits removing this
path.

### 6.4 Class workspace roster view

Behavior: the placeholder is replaced with a real roster (Phase 4) and
a Sync roster header action. The Reconnect action replaces Sync roster
only when the connection is in `expiredRefresh`.

Rationale: single header slot, single primary action, driven by
connection state.

### 6.5 Unresolved students are a count only

Behavior: unresolved students are surfaced as a count in the sync
summary. Provider account identifiers, emails, and Google display
names are never rendered. A future sprint may design a resolution UI.

Rationale: enforces the certified identity-bridge boundary.

## 7. Certification boundaries

Sprint 24B certification statements may claim:

- The Classes surface owns every teacher-initiated classroom workflow.
- Settings > Integrations is scoped to account-level connection
  management only.
- The primary teacher entry point is Import Class from Google
  Classroom.
- The secondary teacher entry point is Create LyfeLabz Class.
- `lmsClassesSyncRoster` is invoked from the client on link and on
  demand.
- Roster synchronization is idempotent on repeated invocation.
- Student identity reconciliation uses the certified external identity
  bridge only.
- Unresolved students are reported as a count without exposing
  provider account identifiers.
- The class workspace renders the roster with correct student status.
- The Reconnect flow surfaces on expired refresh tokens.

Sprint 24B certification must not claim:

- That every production teacher has been onboarded.
- That every production Classroom is synchronized.
- That grade or submission synchronization exists.
- That Google verification of the OAuth app is complete.
- That every production edge case has been exercised.
- Any behavior of a second LMS provider.

## 8. Rollback strategy

Rollback of Sprint 24B is a Hosting redeploy of the prior known-good
bundle, per `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §11. Phase-specific
notes:

- Phase 1 rollback: redeploy the prior Hosting bundle. Firestore state
  is unaffected because Phase 1 makes no Firestore write.
- Phase 2 rollback: redeploy the prior Hosting bundle. Any classes
  created by the primary import flow before rollback remain intact;
  the teacher can continue using them. Firestore state is unaffected.
- Phase 3 rollback: redeploy the prior Hosting bundle. Enrollments
  already written by the roster engine remain intact. Repeat sync
  after redeploy of a corrected client is safe because the engine is
  idempotent.
- Phase 4 rollback: redeploy the prior Hosting bundle. The class
  workspace reverts to the Sprint 24A placeholder. Firestore state is
  unaffected.
- Phase 5 rollback: functions redeploy of the prior known-good bundle
  reverts the token-exchange classification. The client-side gating
  falls back to the always-Sync-roster header.
- Phase 6 rollback: not applicable. Phase 6 is verification only.
- Phase 7 rollback: not applicable. Phase 7 is certification.

Rollback never deletes an `lmsConnections`, `lmsClassLinks`,
`lmsTokenBundles`, `externalIdentities`, `auditEvents`, or `enrollments`
document.

## 9. Future enhancements (out of scope for Sprint 24B)

The following items are recognized, deliberately deferred, and
recorded here so future sprints have a running list of the natural
next moves after Sprint 24B. None of these items is authorized by
Sprint 24B.

- Unresolved student resolution UI (invite-by-code, teacher-mediated
  match, or a per-student remediation flow). Requires an identity
  bridge extension.
- URL-addressable Classes routes (`/classes`, `/classes/:id`,
  `/classes/:id/roster`) with browser back/forward parity.
- URL-addressable Settings > Integrations route for direct account
  linking from support tickets.
- A second LMS provider adapter (Canvas, Schoology, or a district
  LMS).
- Bidirectional grade or submission sync. Requires expanded OAuth
  scopes and an explicit re-consent flow.
- Google Classroom deep-link content publishing (PDR-027). Requires
  the Google Classroom add-on developer flow.
- Automatic per-teacher default grade/block derivation from the
  identity provider or from prior class history, so imported classes
  arrive fully populated without any later edit in class settings.
- Class settings surface for post-import metadata edits (grade,
  block, and any other convenience field). Sprint 24B assumes an
  existing edit path is or will be reachable through the class
  workspace; a dedicated design pass may be warranted.
- A revived Imported classes health surface, redesigned as a
  per-class widget inside the class workspace rather than a Settings
  list.
- Batch import (multi-course select) inside the Classes import flow.
- Teacher-configurable sync cadence and notification preferences.
- District administration surface for connection posture and roster
  health across many teachers.
- Google OAuth app verification for large-scale rollout beyond the
  100-user testing cap.

## 9.1 Amendment - Deferred account-level Settings capabilities

The Phase 1 implementation surfaced a narrow scope question about two
account-level Settings capabilities named in §3.2:

1. Connected Google account (the connecting teacher's email).
2. Last successful synchronization timestamp.

Neither field is available through the currently certified
connection-summary contract. `describeConnections` returns
`connectionId`, `providerId`, `status`, and `scopes` only. Rendering
either field in Settings therefore requires a server-side extension of
the callable response shape.

Phase 1 is UI/routing only and is not authorized to make that change.
Both capabilities are intentionally deferred to the approved later
connection-lifecycle phase (currently Phase 5, "Reconnect flow for
expired refresh tokens", §4.5), which is the earliest phase that
already justifies a callable-response schema change on this seam.

Related clarifications that this amendment also records:

- The existing Connect control on the Settings > Integrations account
  row may initiate the same OAuth sequence used for reconnection. In
  Phase 1 there is no separate teacher-facing Reconnect label; the
  same DOM control drives `lmsConnectionsBegin` and
  `lmsConnectionsComplete`.
- The distinct teacher-facing Reconnect state and label named in §2
  and §3.2 depend on the later expired-refresh classification work in
  §4.5. Only once the `expiredRefresh` status flows through the
  connection summary can the surface render a distinct Reconnect state.
- The later phase may extend the relevant callable response, or the
  connection-summary seam it feeds, only as narrowly as necessary to
  carry the connected account email, the last successful
  synchronization timestamp, and the expired-refresh status. No other
  connection-summary field is authorized by this amendment.
- Provider abstraction remains mandatory (§5). The extended
  connection-summary shape must be provider-neutral: it expresses
  account identity as a generic account label field per provider, not
  as a Google-specific attribute.
- No provider account identifier may be exposed beyond the minimum
  approved teacher-facing account information (the connected Google
  account email as authored by the provider, and nothing more). No
  provider-side user id, subject claim, or opaque account identifier
  is rendered.

This amendment does not reopen or alter Phase 1. It records the
deferred scope and its target phase so the Phase 5 authorization
envelope can absorb these two additive fields alongside the
`expiredRefresh` status change.

## 9.2 Amendment - Phase 2B (Teacher default grade and needsSetup class lifecycle)

Governing ADR:
`docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md` (ratified
2026-07-30). This amendment inserts Phase 2B between the original
§4.2 (Phase 2) and §4.3 (Phase 3). Phase 3 is blocked until Phase
2B is implemented and certified.

Rationale. The Phase 2 audit found that Google Classroom import
persists `grade: "7", block: "A"` on every imported class. Those
values are hard-coded client constants inherited from the Manual
Create form. In an interactive Manual Create they are a starting
point the teacher confirms; in a non-interactive import they are
persisted without a teacher present to correct them. The values are
untruthful and load-bearing across curriculum surfaces, assignment
eligibility, and dashboards. This is an architectural defect, not
an implementation bug. Sprint 24B does not ship until it is fixed.

### 9.2.1 Phase 2B goal

Replace the hard-coded metadata inheritance with the hybrid model
ratified in the ADR:

- Teacher-level `defaultGrade` preference (optional-absent) as a
  convenience pre-fill only.
- Per-class `block` selection. No teacher-level `defaultBlock`.
- Imported classes are created in a `needsSetup` lifecycle state
  and are not instruction-eligible until the teacher completes a
  brief one-screen setup form inside the class workspace.
- `grade` and `block` remain required before a class becomes
  `active`.
- Google Classroom import remains uninterrupted; no metadata prompt
  during import.

### 9.2.2 Phase 2B scope (in scope)

Client:

- Add a session-scoped reader for
  `users/{uid}/preferences/teacher`, exposed as
  `activeTeacher.preferences.defaultGrade` (or the closest existing
  equivalent). The reader must tolerate an absent document and an
  absent field per ADR §7.2.
- Add a Settings row that lets the teacher view and change
  `defaultGrade`. Copy: "Default grade for new classes."
- Change the import orchestration
  (`app/src/classes/importFromClassroom.ts`) to invoke a new
  create-as-needsSetup path in place of `classesCreate` when
  importing from Google Classroom. The composition order remains
  create-then-`lmsClassesImport`. `lmsClassesImport` is unchanged.
- On successful link, open the class workspace as today. The
  workspace's initial state for a `needsSetup` class is the setup
  form. The setup form pre-fills grade from `defaultGrade` when
  present and prompts for block unconditionally.
- On successful setup form submission, invoke the new activation
  callable. Transition the workspace to the ordinary active-class
  experience. Optionally update `defaultGrade` to the submitted
  grade.
- Update Manual Create to (a) pre-fill grade from `defaultGrade`
  when present, otherwise render grade as unselected; (b) render
  block as unselected. Retire the hard-coded `"7"` and `"A"`
  defaults at the write site. On successful create, optionally
  update `defaultGrade` to the submitted grade.
- Render `needsSetup` classes in the Classes list with a "Finish
  setting up this class" affordance. Do not surface the join code,
  assignment destination, or student-facing entry points for a
  `needsSetup` class.

Server:

- Extend `ClassStatus` with `"needsSetup"` per ADR §7.3.
- Introduce a narrow `ClassLmsCreationWrite` write shape for the
  import path (writes `status: "needsSetup"`, omits `grade` /
  `block`).
- Introduce a narrow `ClassActivationWrite` and an activation
  callable (working name: `classesActivate`) per ADR §7.5. The
  callable performs an atomic transaction that writes `grade`,
  `block`, and `status: "active"` in one commit. The callable is
  idempotent on a class that is already `active` and rejects on a
  class that is `archived`.
- Audit every server-side class reader (assignment surfaces,
  enrollment path, roster viewer, snapshot metrics, archive
  callable, curriculum eligibility) and extend eligibility guards
  from "not archived" to "status === 'active'" wherever that
  distinction matters.
- Add Firestore Rules per Phase 2B Implementation Specification
  §2 and §9.7:
  - `users/{uid}/preferences/teacher`: owner read/write with a
    `{ defaultGrade, updatedAt }` shape allowlist and closed-set
    validation on `defaultGrade`. Delete denied.
  - No other Rules change is required or authorized. The
    class-creation, assignment-eligibility, and join-code guards
    listed in earlier drafts are callable-layer requirements
    because every class, assignment, and enrollment mutation is
    performed by a Cloud Functions callable under the Firebase
    Admin SDK, which bypasses Rules.
- Introduce the shared server-side eligibility helper
  (`assertClassSupports(op, record)`) per Specification §4 and
  adopt it in the callables listed in §4.3 so `needsSetup`
  behavior is explicit per operation.
- Add the preference writer as a callable
  (`teacherPreferencesUpdate`) per Specification §9.3-§9.4.

No provider adapter is modified. The provider registry is not
modified. The certified `lmsClassesImport` callable is not
modified.

### 9.2.3 Phase 2B non-scope

- No Phase 3 behavior (`lmsClassesSyncRoster` invocation from the
  Classes surface). Roster synchronization is gated on
  `status === "active"` per Phase 2B Implementation Specification
  §6 (Option B): a `needsSetup` class never synchronizes its
  roster. Phase 3 therefore sequences the initial sync after the
  activation callable returns; the decision is not deferred to
  Phase 3.
- No Phase 4 roster view work.
- No Phase 5 `expiredRefresh` classification.
- No new audit event kinds.
- No provider-abstraction changes.
- No renaming of existing callables, collections, or audit events.
- No backfill of existing class documents.

### 9.2.4 Phase 2B deliverables

- Firestore schema and type extensions:
  `platform/functions/src/shared/types/class.ts` (extend
  `ClassStatus`; introduce discriminated read type; introduce
  `ClassLmsCreationWrite` and `ClassActivationWrite`).
- New activation callable (`platform/functions/src/classes/`).
- Preference read/write path (subdoc + reader + writer + Rules).
- Client orchestration change in
  `app/src/classes/importFromClassroom.ts` (swap
  `classesCreate` for the new needsSetup create seam on the import
  branch).
- Workspace setup form for `needsSetup` classes in the Classes
  surface.
- Settings row for `defaultGrade`.
- Manual Create pre-fill wiring; removal of hard-coded `"7"` /
  `"A"` at the write boundary.
- Rules updates covering preference doc, needsSetup creation
  authority, assignment eligibility, and join-code enrollment.
- Unit tests covering: import writes `needsSetup` and omits
  grade/block; activation writes are atomic and idempotent;
  archived classes reject activation; assignment surfaces exclude
  `needsSetup` classes; join-code enrollment rejects `needsSetup`;
  Manual Create no longer writes hard-coded defaults; preference
  reader tolerates absent doc; preference writer validates the
  closed set.
- Regression coverage confirming existing `active` classes behave
  identically (no change in assignment eligibility, no change in
  Snapshot metrics, no change in roster viewer behavior).
- A completion report (`SPRINT_24B_PHASE_2B_COMPLETION_REPORT.md`)
  that re-certifies Phase 2's surface (import orchestration,
  OAuth, duplicate detection, reentrancy, provider selection) and
  certifies Phase 2B's new work (preference model, lifecycle
  extension, activation).

### 9.2.5 Definition of done

- `npm --prefix app run verify` is green.
- Every import produces a `needsSetup` class with no `grade` and no
  `block` persisted.
- Every activation transition is atomic; no observable intermediate
  state with `active` + missing metadata.
- No assignment surface accepts a `needsSetup` class.
- No join-code enrollment succeeds against a `needsSetup` class.
- Manual Create writes the teacher-selected grade and block; no
  hard-coded `"7"` or `"A"` remains at any write site.
- The Phase 2 as-shipped implementation is de-certified in
  `SPRINT_24B_PHASE_2_COMPLETION_REPORT.md` and Phase 2B is
  certified in its own report.

### 9.2.6 Rollback

Phase 2B rollback is a Hosting redeploy plus a Functions redeploy
of the prior known-good bundle, per
`SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §11. Firestore state written by
Phase 2B (`needsSetup` classes, `defaultGrade` preference docs)
survives rollback and remains valid under the pre-Phase-2B code:

- `needsSetup` class documents become unrecognized-status
  documents to the rolled-back reader. Every existing reader
  either narrows on `status === "active"` (safe: the class is
  silently excluded) or narrows on
  `status === "archived"` (safe: the class is silently excluded).
  No reader crashes on an unknown status value; the discriminated
  union at the type boundary means the "unknown status" arm falls
  through the default guard.
- `preferences/teacher` documents are inert to the rolled-back
  reader.

Rollback does not delete any document.

### 9.2.7 Impact on subsequent phases

- Phase 3 (Roster synchronization trigger): blocked until Phase 2B
  is certified. Initial roster sync runs only against `active`
  classes per Phase 2B Implementation Specification §6; Phase 3
  therefore sequences the initial sync after the activation
  callable returns.
- Phase 4 (Class workspace roster view): the workspace shell must
  render the setup form as the primary state for `needsSetup`
  classes and the roster view for `active` classes. Phase 4's
  header actions (Sync roster, Reconnect) apply only to `active`
  classes.
- Phase 5 through Phase 7: unchanged.

### 9.2.8 Certification boundaries

Phase 2B certification may claim:

- Imported classes are created as `needsSetup` and never carry
  untruthful `grade` or `block` at rest.
- `defaultGrade` is a teacher-scoped, provider-neutral preference
  stored under the identity boundary.
- The activation callable is the only path from `needsSetup` to
  `active`, is atomic, is idempotent on `active`, and rejects
  against `archived`.
- Assignment surfaces, join-code enrollment, Snapshot metrics, and
  student-facing entry points exclude `needsSetup` classes.
- Manual Create writes the teacher-selected metadata; no
  hard-coded `"7"` or `"A"` remains at any write site.

Phase 2B certification must not claim:

- Any Phase 3 through Phase 7 behavior.
- Any change to provider adapters, the roster reconciliation
  engine, the identity bridge, or the token store.
- Any change to `lmsClassesImport` or `lmsClassesSyncRoster`.

## 10. Anchors

Certified anchors that Sprint 24B builds on and does not modify:

- `platform/functions/src/lms/classes-sync-roster.ts`
- `platform/functions/src/lms/roster/sync-engine.ts`
- `platform/functions/src/lms/providers/registry.ts`
- `platform/functions/src/lms/tokens/token-store.ts`
- `platform/functions/src/shared/identity/*`
- `platform/firebase/firestore.rules` (LMS surface unchanged)
- `platform/firebase/firestore.indexes.json` (any addition must be
  additive, documented, and justified in the Sprint 24B completion
  report)

Client-side anchors that Sprint 24B extends:

- `app/src/shell/surfaces/classes.ts` (Classes surface: entry points,
  import orchestration hookup, class workspace)
- `app/src/settings/integrations/integrations.ts` (Settings panel
  narrowed to account-level)
- `app/src/shell/surfaces/settings.ts` (Connected Services entry point
  copy update only)
- `app/src/index.ts` (entry-point wiring for the new callable
  injections)

## 11. Sprint sequencing

Sprint 24B depends on Sprint 24A being on record and on the certified
external identity bridge, durable OAuth custody, roster engine, and
provider registry remaining unchanged from their Sprint 23 shape.

Sprint 24B does not authorize Sprint 24C or later work. The Google
Classroom deep-link workflow described in PDR-027 remains a separate
future sprint and is not covered here.

*End of blueprint.*
