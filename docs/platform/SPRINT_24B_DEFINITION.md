# Sprint 24B - Google Classroom Teacher Workflow

## 1. Purpose

Sprint 24A completed the infrastructure foundation for the Google
Classroom integration in the `lyfelabz-prod` production environment.
The certified surface today lets a teacher connect Google Classroom
via OAuth and link a Google Classroom course to a pre-existing
LyfeLabz class. It does not import any student, does not display any
roster, and does not run any roster synchronization.

Sprint 24B is the dedicated Google Classroom teacher workflow sprint.
It finishes the teacher experience so that connecting Google Classroom
in production produces a usable LyfeLabz class with real students
visible in a real class workspace.

Sprint 24B is scoped as a coordinated client-plus-server workflow
sprint. It does not redesign the LMS provider architecture, the
external identity bridge, the durable OAuth stores, or the callable
contracts. Those remain as certified by Sprints 23A through 23F and
verified in Sprint 24A.

## 2. Motivation

The Sprint 24A production verification exposed a UX gap that is worth
stating explicitly here so Sprint 24B does not merely repeat the
existing pattern.

Current working flow (verified in production):

1. Teacher creates a LyfeLabz class first.
2. Teacher connects Google Classroom.
3. Teacher opens the import dialog and manually chooses the
   pre-existing LyfeLabz class as the destination.
4. Teacher links the Google Classroom course into that class.

This inverts the natural mental model. The teacher already has a
class in Google Classroom; asking them to build a mirror in LyfeLabz
first is unnecessary friction. Sprint 24B corrects this by making
"import a Google Classroom class" the default path and treating
"link to an existing LyfeLabz class" as the secondary option.

## 3. Primary goals

### 3.1 Create-from-Classroom becomes the default import flow

The default Integrations flow becomes:

Connect Google Classroom -> choose Classroom course -> LyfeLabz
creates a new class automatically from the course -> initial roster
sync runs -> teacher lands on the new class workspace with students
visible.

The secondary option remains available: "link this Google Classroom
course to an existing LyfeLabz class". The picker still exists; it is
no longer the default.

Naming, schoolId inheritance, teacher ownership, and any class-level
metadata inherited from the Google Classroom course must be
deterministic and covered by tests. No prompt for optional fields
appears in the default flow.

### 3.2 Client invocation of `lmsClassesSyncRoster`

The client acquires a surface that invokes
`lmsClassesSyncRoster({ classId })` after a successful link (whether
that link came from the default create-from-Classroom flow or the
secondary link-to-existing flow).

The initial sync must run as part of the create-from-Classroom flow so
the teacher sees students on the first render of the class workspace.

A visible "Sync roster" action must also exist in the class workspace
for on-demand refresh.

### 3.3 Safe idempotent enrollment writes

The engine at
`platform/functions/src/lms/roster/sync-engine.ts` is already
provider-neutral and produces deterministic reconciliation counts.
Sprint 24B must exercise it against real production classes and
validate the invariants below in an emulator-first test plan and then
in a production dry run:

- Repeated syncs against the same upstream roster produce zero net
  writes and zero new enrollments after the first sync.
- Repeated syncs never create duplicate enrollment documents for the
  same student.
- The engine never reactivates a `transferred`, `withdrawn`, or
  `archived` enrollment (this is by design per the certified
  enrollment lifecycle table; the returning-student case is a
  `skipped` outcome).
- Removals from the upstream roster apply the single authorized exit
  transition `active -> withdrawn` and never `archived`.

### 3.4 Student identity reconciliation

Sprint 24B uses the certified external identity bridge
(`resolveActiveExternalIdentity` and the Sprint 23C-I schema) for
student identity resolution. Sprint 24B does not introduce
account-creation-on-import, email matching, or display-name matching.

Unresolved students (an upstream Classroom roster entry with no
matching `externalIdentities/{externalIdentityId}` document for the
Google `provider.sub`) are reported to the teacher as a count only.
Their provider account identifiers are not exposed in the UI or in
any callable response. The teacher's remediation path is out of scope
for Sprint 24B; the count is surfaced so the teacher understands the
gap. A future sprint may design a resolution UI.

### 3.5 First real class workspace

The Classes > `<class>` surface is currently a placeholder
("The full class-level workspace will grow into this space..."). Sprint
24B builds the first real class workspace, scoped to the roster
experience:

- Student list with student display name (from LyfeLabz, not from
  Google), enrollment status, last sync time, and match state (matched
  identity, unresolved, withdrawn by sync).
- Header actions: Sync roster, Reconnect provider (visible only when
  the connection is in an expired-refresh state).
- Sync summary panel that appears after each sync, showing the exact
  counts returned by `lmsClassesSyncRoster`: `added`, `reactivated`
  (always zero under current lifecycle rules), `unchanged`,
  `withdrawn`, `unresolved`, `skipped`, and the
  `upstreamRosterEmpty` boolean.

The class workspace is scoped to the roster experience in Sprint 24B.
Assignment surfaces, attempt views, and any other class-level content
remain out of scope for this sprint.

### 3.6 Reconnect flow for expired refresh tokens

Google may invalidate an OAuth refresh token (user revocation, token
rotation, extended inactivity). Sprint 24B introduces:

- A server-side detection path that classifies upstream 401/403
  responses from the token exchange and reflects them into the
  connection status.
- A client-side surface that presents a Reconnect action in place of
  Sync roster when the connection is in an expired state.
- No silent token refresh loop. No automatic re-prompt without
  teacher action.

The reconnect flow reuses the existing `lmsConnectionsBegin` and
`lmsConnectionsComplete` callables. It does not introduce a new
provider callable.

### 3.7 Audit and observability

Sprint 24B relies on the existing audit stream. Every sync emits one
`lms.rosterSynchronized` audit event per invocation (as already
implemented in `platform/functions/src/lms/classes-sync-roster.ts` and
verified by the Sprint 23C test suite). Sprint 24B does not add or
rename audit event kinds. Sprint 24B does add:

- A structured log line at the client-invoked sync boundary that
  captures the reconciliation counts (never provider account
  identifiers, Firebase UIDs, or names).
- Verification that the audit event is present after every successful
  sync in the emulator suite and in the production verification plan.

## 4. Explicit non-goals

Sprint 24B does NOT:

- Rename any existing callable.
- Change any callable's request or response contract.
- Change the enrollment lifecycle table.
- Add a returning-student reactivation transition.
- Introduce account creation on roster import.
- Introduce email matching or display-name matching for student
  identity resolution.
- Sync grades, submissions, attempts, or assignments.
- Push any content into Google Classroom. Every upstream call remains
  read-only via the two authorized scopes
  (`classroom.courses.readonly`, `classroom.rosters.readonly`).
- Change the LMS provider architecture or add a second provider.
- Change the redirect URI, OAuth client, Secret Manager binding, or
  typed parameter shape.
- Modify Firestore Rules for `enrollments`, `classes`, `users`,
  `attempts`, `submissions`, or `assessments`.
- Add new indexes beyond what the roster read path demonstrably
  requires (any addition must be additive, documented in
  `platform/firebase/firestore.indexes.json`, and justified in the
  Sprint 24B completion report).

## 5. Architectural anchors

Sprint 24B builds on the certified artifacts below and does not
substitute for any of them.

- `platform/functions/src/lms/classes-sync-roster.ts` - the callable
  entry.
- `platform/functions/src/lms/roster/sync-engine.ts` - the
  provider-neutral reconciliation engine.
- `platform/functions/src/lms/providers/registry.ts` - the provider
  adapter registry.
- `platform/functions/src/lms/tokens/token-store.ts` - the durable
  token custody boundary.
- `platform/functions/src/shared/identity/*` - the external identity
  bridge and `resolveActiveExternalIdentity`.
- `app/src/settings/integrations/*` - the current Integrations
  surface, which Sprint 24B extends with the default
  create-from-Classroom flow and the roster sync trigger.
- `app/src/shell/surfaces/*` - the class workspace surface, which
  Sprint 24B fills out with the first real roster view.

## 6. Production verification plan

Sprint 24B production verification is a controlled, single-class,
teacher-supervised exercise executed against the `lyfelabz-prod`
project after the sprint's implementation and full validation baseline
pass in the emulator suite.

Prerequisites:

- Sprint 24A certification is on record.
- A production teacher account controls a real Google Classroom
  course with a real roster the teacher is authorized to touch.
- The LyfeLabz class that will receive the roster is either newly
  created by the default create-from-Classroom flow (preferred) or
  is a pre-existing test class whose enrollment state the teacher
  has captured before the test.

Execution:

1. Capture the pre-test enrollment count for the target class from
   the Firebase Console (Firestore > `enrollments` filtered by
   `classId`).
2. Execute the default flow: Connect Google Classroom (if not
   already connected), choose the Classroom course, allow LyfeLabz
   to create the class, wait for the initial sync.
3. Confirm the class workspace renders the expected student count.
4. Confirm the audit stream contains exactly one
   `lms.rosterSynchronized` event for the test class.
5. Re-trigger Sync roster. Confirm the counts returned are all
   `unchanged` (aside from `upstreamRosterEmpty=false`). Confirm the
   enrollment count in Firestore has not increased.
6. Withdraw a test student from the upstream Google Classroom course
   (teacher action in Google Classroom). Re-run Sync roster. Confirm
   the student's enrollment transitions to `withdrawn` and the audit
   event count is exactly one new event for the sync.
7. Confirm no provider account identifier, no Google email, no
   Google display name, and no OAuth token appears in any client
   response, log line, or audit event payload.

Boundaries:

- Do not run the production verification against a live student
  class. Use a controlled test class with a test roster or a small
  co-teacher-agreed class.
- Do not run the verification without the teacher present.
- Do not run the verification without pre-test enrollment counts
  captured.

## 7. Rollback boundaries

Sprint 24B rollback is the redeployment of the prior known-good
commit, per `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §11.

Specific to Sprint 24B:

- Rollback of the client surface (the create-from-Classroom flow and
  the class workspace) is a Hosting redeploy of the prior bundle. It
  does not affect Firestore state.
- Rollback of a client-invoked sync that produced unexpected
  reconciliation counts is not a Firestore mutation. The engine's
  outcomes are already the certified reconciliation contract; a
  disagreement with the outcome is a design defect, not a data
  corruption. The affected class's enrollments remain intact; the
  teacher's remediation is to re-run sync after the fix is deployed.
- Rollback never deletes a `lmsConnections`, `lmsClassLinks`,
  `lmsTokenBundles`, `externalIdentities`, `auditEvents`, or
  `enrollments` document. Any such deletion is out of scope for this
  sprint.

## 8. Certification boundary

Sprint 24B certification statements (to be written into a future
`SPRINT_24B_COMPLETION_REPORT.md`) may claim:

- The default flow is create-from-Classroom.
- The link-to-existing flow remains available and is the secondary
  option.
- `lmsClassesSyncRoster` is invoked from the client on link and on
  demand.
- Roster synchronization is idempotent on repeated invocation.
- Student identity reconciliation uses the certified external
  identity bridge only.
- Unresolved students are reported as a count without exposing
  provider account identifiers.
- The class workspace renders the roster with correct student status.
- The reconnect flow surfaces on expired refresh tokens.

Sprint 24B certification must not claim:

- That every production teacher has been onboarded.
- That every production Classroom is synchronized.
- That grade or submission synchronization exists.
- That Google verification of the OAuth app is complete.
- That every production edge case has been exercised.
- Any behavior of a second LMS provider (Sprint 24B remains scoped
  to Google Classroom).

## 9. Sprint sequencing

Sprint 24B depends on Sprint 24A being on record and on the certified
external identity bridge, durable OAuth custody, roster engine, and
provider registry remaining unchanged from their Sprint 23 shape.

Sprint 24B does not authorize Sprint 24C or later work. The
Classroom deep-link workflow described in PDR-027 remains a separate
future sprint and is not covered here.

*End of definition.*
