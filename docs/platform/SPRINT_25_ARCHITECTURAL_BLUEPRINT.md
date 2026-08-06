# Sprint 25 - Architectural Blueprint

Status: Proposed. Governing implementation document for Sprint 25.

Extends `SPRINT_25_DEFINITION.md` with the workflows, the OAuth flow,
the callable and Firestore interactions, the audit interactions, the
failure and retry behavior, and the certification and verification
plans. The definition is the scope-of-record; this blueprint is the
how-and-in-what-order layer. The authorizing decision is the proposed
PDR-030, pending ratification into `LYFELABZ_PLATFORM_DECISIONS.md`. The
surface reconciliation is `ADR_LMS_PUBLICATION_SURFACE_RECONCILIATION.md`.

Style: no em dashes. Use " - " (spaced hyphen).

---

## 1. Purpose

Sprint 24B produced a usable LyfeLabz class from Google Classroom:
connect, import, activate, synchronize roster. Sprint 25 closes the next
gap: letting a teacher send an existing LyfeLabz assignment out to the
linked Google Classroom course as a one-way pointer, from inside the one
Assign dialog, as an optional extension of assigning.

This blueprint sequences that work so each stage is independently
reviewable, deployable, and rollback-able without destabilizing the
certified foundation.

## 1.1 Guiding principle

Every Sprint 25 decision should reduce, not increase, the number of
decisions a teacher makes while assigning. Publication is one optional
toggle and one optional topic on a row she already sees. When two
implementation options are otherwise equivalent, the option that asks
the teacher for fewer inputs, fewer confirmations, and fewer detours
wins.

## 2. Terminology

The only teacher-facing labels authorized for Sprint 25:

| Term | Where it appears |
|---|---|
| Assign | The single workflow. Unchanged. |
| Also publish to Google Classroom | The opt-in publish toggle on an LMS-linked class row. |
| Google Classroom topic | The topic selector on an LMS-linked class row. |
| Publishing to Google Classroom succeeded | Confirmation line on success. |
| Publishing to Google Classroom did not succeed | Confirmation line on failure. |

The teacher-facing vocabulary never frames publication as a standalone
act. It is always subordinate to Assign. Internal engineering
identifiers, callable names, Firestore field names, and audit event
kinds are unchanged from the certified tree.

## 3. Surface ownership

The Assign dialog is the single authoritative origin of every
assignment record and the single place a teacher can publish. This is
load-bearing and is reaffirmed by PDR-019d and by
`ADR_LMS_PUBLICATION_SURFACE_RECONCILIATION.md`.

- **Assign dialog owns:** the publish toggle, the topic selector, the
  confirm-time publication call, the confirmation read-back, and the
  retry entry point on the assignment detail view.
- **Settings > Integrations owns:** account-level connection management
  only (connected account, status, reconnect, disconnect), exactly as
  narrowed by Sprint 24B. Settings exposes no publish affordance and no
  class workflow. See the reconciliation ADR for how the existing
  publish wiring seam is provided to Assign rather than surfaced in
  Settings.

## 4. Teacher workflow

1. The teacher opens Assign on a lesson. The dialog shows her class
   rows, all selected by default, exactly as today.
2. For any row whose class is LMS-linked and `active`, the row carries
   two additive affordances: a Google Classroom topic selector
   (prefilled from her last-used topic for that class) and an "Also
   publish to Google Classroom" toggle (off by default). Rows for
   classes that are not LMS-linked are unchanged and show neither
   control.
3. The teacher configures the assignment as she always does (date,
   release time, points). If she wants the assignment mirrored into
   Google Classroom for a given class, she turns that row's toggle on
   and optionally picks a topic.
4. She confirms the dialog once. LyfeLabz schedules the assignment for
   every selected class as authoritative.
5. For each selected LMS-linked row with the toggle on, LyfeLabz
   publishes a pointer to Google Classroom as a side effect. If this is
   the first time she publishes and the coursework scopes have not been
   granted, a one-time incremental consent prompt appears at this
   moment.
6. The confirmation surface names both outcomes per row: the LyfeLabz
   assignment was scheduled, and publishing to Google Classroom either
   succeeded or did not succeed. The LyfeLabz assignment exists in either
   case.
7. If publication did not succeed, the teacher can retry from the
   assignment detail view for that class. Retry is the same publish call;
   it never recreates the LyfeLabz assignment.

The teacher never leaves the Assign dialog to publish. She never visits
Settings to publish. She decides where to assign; publication follows.

## 5. Browser workflow

- The Assign dialog derives each row's LMS-linked state from certified
  data (the class record and its active `lmsClassLinks` entry), never
  from a client-forced flag. This reuses the `createListClassLinks`
  reader and the class list already available to the surface.
- When a row is LMS-linked and `active`, the dialog requests that
  class's topics through `lmsClassesListTopics({ classId })` and
  populates the topic selector. Topic fetch failure degrades to an empty
  selector with the toggle still usable; it never blocks assigning.
- On confirm, for every selected class, the client first creates and
  publishes the authoritative LyfeLabz assignment through the existing
  `assignmentsCreateDraft` then `assignmentsPublish` callables. This is
  unchanged from the certified assignment path.
- For each selected LMS-linked row with the toggle on, the client then
  calls `lmsAssignmentsPublish` with the LyfeLabz identifiers, the
  canonical LyfeLabz assignment URL, and the chosen topic. Provider
  identifiers, upstream course ids, connection ids, and tokens are all
  resolved server-side; the client passes none of them.
- If the publish call reports that the coursework scopes are missing,
  the client runs the incremental consent handoff (see §7) and re-issues
  the publish call once.
- The confirmation surface reads back per-row outcomes. A publish
  failure sets the row's confirmation line and exposes a retry entry
  point; it never rolls back the LyfeLabz assignment.

The canonical LyfeLabz assignment URL passed to publication is produced
by the existing launcher URL contract (the per-assignment launch URL the
platform already computes for students). Sprint 25 reuses that contract;
it does not invent a new URL shape.

## 6. Server workflow

The server publish path already exists and is reused unchanged in shape.
Its certified sequence:

1. Authenticate the caller and re-derive the session.
2. Resolve and authorize the LyfeLabz assignment: teacher-owned, same
   school, and in a publishable lifecycle state (not closed, not
   archived).
3. Resolve and validate the class link: `linked`, owned by the caller,
   belonging to the assignment's class, and not superseded by another
   active link on the same class.
4. Resolve and validate the connection: owned by the caller and
   `active`.
5. Resolve the OAuth token through the server-only token store.
6. Resolve the provider adapter from the registry by provider id.
7. Call the adapter to publish the coursework item.
8. On success, write a `succeeded` record to `lmsAssignmentPublications`,
   set the additive `lmsPublicationRef` pointer on the assignment, and
   emit `lms.assignmentPublished`.
9. On failure, write a `failed` record, emit `lms.publishFailed`, and
   return a graceful outcome the client can render and retry.

The primary server change Sprint 25 introduces is inside step 7: the
Google Classroom adapter method that performs the coursework write is
currently a stub that returns `lms.providerNotYetOperational`. Sprint 25
replaces that stub with the live upstream call. The `lmsAssignmentsPublish`
callable itself, the records, the mirror, the audit emission, and the
vendor-neutral core are unchanged in shape. The one other server change
is the bounded incremental-consent extension described in §7 (the begin
request shape, the adapter scope selection, and the completion's
scope-merge). No other server behavior changes.

The adapter's live behavior at the architecture level:

- Create a coursework item in the linked course that points at the
  LyfeLabz assignment URL, under the chosen topic when one is supplied.
- The coursework is a pointer to where the work happens in LyfeLabz. It
  is not a copy of lesson content. This preserves the "assignments
  reference, never contain" rule.
- Map every upstream error shape onto the certified graceful-failure
  path. A missing coursework scope maps to a distinct, retryable
  insufficient-scope outcome that drives the incremental consent flow.
  A deleted topic, a rate-limit response, and a transient upstream
  failure all map to the retryable failed outcome.
- Sanitize every upstream error before it reaches the publication
  record, the audit payload, the log line, or the client. Upstream
  error bodies may contain identifiers; none may leak.

## 7. OAuth flow

Sprint 25 reuses the certified OAuth connection lifecycle and extends it
in three bounded, additive places so it can request and record the
coursework scopes through incremental consent. These are extensions of
existing callables, not new callables and not a second connection.

Required bounded changes (verified against current source):

- `lmsConnectionsBegin` today accepts only `{ providerId, redirectUri }`.
  It must additionally carry a requested capability or scope selector so
  the caller can ask for the coursework scope set rather than the fixed
  readonly set.
- The adapter `beginOAuth` method today hardcodes the readonly scope set
  into the authorization URL. It must select the scope set from the
  requested capability.
- `lmsConnectionsComplete` today writes a connection creation record. For
  incremental consent it must merge the newly granted scopes into the
  caller's existing connection rather than create a second connection.

With those extensions in place, the flow is:

- The connection created in Sprint 24A/24B holds the readonly scopes
  (`classroom.courses.readonly`, `classroom.rosters.readonly`). Roster
  synchronization uses those. Publication requires the additional
  coursework scopes (`classroom.coursework.me`,
  `classroom.topics.readonly`), which are declared in the adapter
  (`GOOGLE_CLASSROOM_PUBLICATION_SCOPES`) but not requested by the
  existing authorization URL.
- The first time a teacher publishes, the server reports that the
  coursework scopes are absent. The client runs the same OAuth handoff
  used for connect and reconnect (`lmsConnectionsBegin` then
  `lmsConnectionsComplete`, through the existing same-origin popup and
  postMessage handoff), this time requesting the coursework scope set.
- Google presents a scope-scoped consent prompt for exactly the
  coursework capability. `include_granted_scopes` preserves the
  previously granted readonly scopes so the teacher is not asked to
  re-grant them.
- On grant, the server widens the existing connection's recorded scope
  set. It does not create a second connection. The same
  `connectionId`, `tokenRef`, and account identity are retained.
- The granted Google identity is revalidated against the LyfeLabz
  identity using the existing profile-match misconnection mitigation. A
  mismatch is refused with a plain-language message.
- Tokens never cross the callable boundary. The client observes only
  that consent succeeded and that it may re-issue the publish call once.
- No silent scope escalation. Consent is requested only at the moment
  the teacher first chooses to publish, and only for the coursework
  capability.

The scope addition is authorized by the proposed PDR-030, not by
implementation. The Sprint 25 specification records the coursework scopes
as a proposed, incremental, opt-in consent change pending ratification.

## 8. Callable interactions

Every callable below already exists. Sprint 25 introduces no new
callable. Three existing callables are reused unchanged; three receive a
bounded additive extension, marked in the Change column.

| Callable | Role in Sprint 25 | Change |
|---|---|---|
| `assignmentsCreateDraft` | Creates the authoritative LyfeLabz assignment before any LMS publish. | None. |
| `assignmentsPublish` | Publishes the authoritative LyfeLabz assignment. | None. |
| `lmsClassesListTopics` | Supplies topics for the topic selector. | None. Wired into Assign. |
| `lmsConnectionsBegin` | Starts incremental coursework consent. | Requests the incremental scope set when publication requires it. |
| `lmsConnectionsComplete` | Completes incremental consent; widens the connection scope set. | Records the widened scope set on the existing connection. |
| `lmsAssignmentsPublish` | Publishes the assignment pointer to Google Classroom. | Signature unchanged. Live adapter behavior replaces the stub. |

The client passes only LyfeLabz identifiers, the LyfeLabz assignment
URL, and the chosen topic id to `lmsAssignmentsPublish`. The server
resolves everything else.

## 9. Firestore interactions

No new collection. No renamed field. All changes are additive and were
reserved by the certified data model.

- `lmsAssignmentPublications/{publicationId}` - written by the publish
  callable, one record per publish attempt, `succeeded` or `failed`.
  Carries owner and school denormalization for rule performance. Read
  scoped to the initiating teacher (and Platform Administrator under
  audit) by the existing rules.
- `assignments/{assignmentId}.lmsPublicationRef` - the additive mirror
  pointer, set only on a successful publish through the narrow
  publication write path. The authoritative assignment record is never
  otherwise rewritten by the publish path.
- `lmsConnections/{connectionId}` - the recorded scope set widens on
  incremental consent. This is an update to an existing document, not a
  new document, and not a new field: the scope set already exists on the
  connection record.

The publish path opens no client Firestore listener over publication
records. Publication outcome reaches the client through the callable
response, not through a client subscription.

## 10. Audit interactions

Sprint 25 emits only reserved events through the canonical
`writeAuditEvent` helper. Append-only. No new kind.

- `lms.assignmentPublished` - exactly one per successful publish. Payload
  carries provider id, link id, upstream class id, upstream assignment
  id, publication id, and optional topic id. No student data, no Google
  email, no token.
- `lms.publishFailed` - exactly one per failed publish. Payload carries
  provider id, link id, upstream class id, publication id, and a
  sanitized error code. No student data, no Google email, no token.

One publish attempt produces exactly one audit event, success or
failure. A retry is a new attempt and produces a new event.

## 11. Failure handling

Failure is a routine event, not an exception the teacher must resolve.

- A missing coursework scope is not a failure. It routes to incremental
  consent (§7) and a single automatic re-issue of the publish call.
- Any other upstream failure (deleted topic, rate limit, transient
  error, permission error) writes a `failed` publication record, emits
  `lms.publishFailed`, and returns a graceful outcome.
- The LyfeLabz assignment is authoritative and is never rolled back by a
  publication failure. It was created and published before the publish
  call ran.
- The confirmation surface names the failure in one plain-language line
  ("Publishing to Google Classroom did not succeed"). It never shows a
  stack trace, never blames the teacher, and never asks her to contact
  an administrator without a plain-language description.
- Upstream error content is sanitized before it reaches any record,
  audit payload, log line, or client response.
- Ordering: the LyfeLabz assignment is created and published first, then
  the upstream publish is attempted, then the publication record and
  mirror pointer are written. This guarantees the LyfeLabz assignment is
  never rolled back by a publication failure.
- An **expired or revoked connection** at publish time is surfaced, not
  hidden. The publish path today rejects a non-`active` connection with a
  plain-language error. The Assign confirmation maps that outcome to a
  reconnect prompt that reuses the existing account-level reconnect flow;
  it never fails silently and never blocks the LyfeLabz assignment.

The "upstream success followed by a local persistence failure" case (the
coursework item is created in Google, but the subsequent LyfeLabz record
or mirror write fails) is a genuine reconciliation gap, not a solved
problem, because the Google Classroom `courseWork.create` API carries no
upstream idempotency key. This case, together with duplicate-confirmation
and uncertain-response retry, is an unresolved implementation decision
recorded in §12.1. It must be resolved before coding, not assumed.

## 12. Retry behavior

- Retry is offered on the assignment detail view for the class whose
  publication did not succeed.
- Retry re-issues `lmsAssignmentsPublish` for the same LyfeLabz
  assignment and link. It never recreates or re-publishes the LyfeLabz
  assignment record.
- A successful retry sets `lmsPublicationRef`, writes a `succeeded`
  record, and emits `lms.assignmentPublished`. The prior `failed` record
  is retained for audit; records are append-only.
- Retry is teacher-initiated only. Sprint 25 introduces no automatic
  retry, no background retry, and no scheduled retry.

The LyfeLabz-side idempotency lever already exists: the publish callable
derives the publication id from `lmsAssignmentPublicationIdFor(assignmentId,
providerId, attemptNonce)`, so a repeat call with the same `attemptNonce`
targets the same publication record (idempotent on the LyfeLabz side) and
a new nonce produces a new record. The callable already accepts an
optional `attemptNonce`. The LMS side has no equivalent: `courseWork.create`
creates a new coursework item on every call.

### 12.1 Unresolved implementation decisions (resolve before coding)

These decisions are intentionally not assumed by this blueprint. Each
must be settled in the Sprint 25 implementation planning step and cannot
be left to code discovery.

1. **Client nonce policy.** Whether a retry reuses the original
   `attemptNonce` (idempotent record, but a fresh upstream POST still
   duplicates the coursework item) or mints a new nonce, and how the
   client distinguishes "retry the same publish" from "publish again on
   purpose."
2. **Duplicate confirmation.** What happens when the teacher confirms the
   same assignment with the publish toggle on twice, and whether the
   surface guards against an unintended second coursework item.
3. **Uncertain upstream response.** How a timeout or ambiguous upstream
   response (the POST may or may not have created the item) is handled,
   given there is no upstream idempotency key to make a retry safe.
4. **Upstream success then local persistence failure.** How the orphan
   case (coursework created in Google, LyfeLabz record write failed) is
   detected and reconciled, and whether a compensating read or a
   teacher-visible reconcile affordance is required.

Options for 1 through 4 exist (deterministic nonce reuse, a pre-write
"attempting" record, a bounded reconcile read against the course), but
selecting among them is an architecture decision the implementation plan
must record. The browser certification plan (§13) exercises the chosen
behavior; it does not presuppose it.

## 13. Browser certification plan

Executed as one continuous genuine run through the real teacher shell
against the Emulator Suite with a Google Classroom API test double. No
auth injection, no Firestore patching, no direct callable invocation.

| ID | Observation | Expected |
|----|-------------|----------|
| B1 | Genuine teacher OAuth sign-in; shell renders. | PASS |
| B2 | Open Assign on a lesson; an LMS-linked `active` class row shows the topic selector and the off-by-default publish toggle. | PASS |
| B3 | A non-LMS class row shows neither control (absent, not disabled). | PASS |
| B4 | Topic selector is populated from the linked course's topics and prefilled with the last-used topic. | PASS |
| B5 | Turn the publish toggle on, pick a topic, confirm the dialog. | PASS |
| B6 | First publish triggers a genuine incremental consent for the coursework scopes; previously granted readonly scopes are preserved. | PASS |
| B7 | On success, the confirmation reads "The LyfeLabz assignment was scheduled. Publishing to Google Classroom succeeded." | PASS |
| B8 | A coursework item appears in the linked course (test double) under the chosen topic, pointing at the LyfeLabz assignment URL. | PASS |
| B9 | Injected upstream failure: the LyfeLabz assignment is intact, the confirmation reads "did not succeed," and a retry entry point is offered. | PASS |
| B10 | Retry from the assignment detail view succeeds and updates the confirmation. | PASS |
| B11 | Publication without an activated LyfeLabz assignment is refused; activation without publication is supported. | PASS |
| B12 | No Google email, student name, Google account id, or token appears anywhere on the teacher surface or in any DOM attribute. | PASS |

B6 and B8 are the decisive observations: incremental consent is genuine,
and the upstream write is real.

## 14. Backend verification plan

Verified against the running Emulator Suite for the exact assignment and
class under test. All LyfeLabz-side writes remain emulator-bound.

- **Callable ledger.** `assignmentsCreateDraft` and `assignmentsPublish`
  precede `lmsAssignmentsPublish` for each published class.
  `lmsConnectionsBegin` and `lmsConnectionsComplete` appear once for the
  incremental consent. No duplicate publish for a single toggle-on
  confirm.
- **Connection.** The connection scope set includes the coursework
  scopes after consent. Exactly one connection for the teacher and
  provider; no duplicate.
- **Publication record.** `lmsAssignmentPublications` holds a
  `succeeded` record for the successful publish and a `failed` record
  for the injected failure, with owner and school denormalization
  present and no student PII.
- **Mirror pointer.** `assignments/{assignmentId}.lmsPublicationRef` is
  set on success and absent when no publication has succeeded.
- **Audit chain.** Exactly one `lms.assignmentPublished` per successful
  publish and exactly one `lms.publishFailed` per failed publish,
  correctly ordered, with PII-free payloads.
- **Security.** Zero `secretmanager.googleapis.com` access in the
  Functions debug log during certification. No token in any callable
  response or client-readable Firestore field. Tokens resolved
  server-side only.
- **Privacy.** No Google email, Google account id, student display name,
  connection identifier, or token in any publication record, audit
  payload, or log line.

## 15. Implementation sequence

Four stages, each independently reviewable and rollback-able. No stage
begins until the prior stage's review is approved.

- **Stage 1 - Adapter go-live (server only).** Replace the stubbed
  Google Classroom coursework write with the live upstream call. Map and
  sanitize upstream errors onto the certified graceful-failure path.
  Exercise entirely through `lmsAssignmentsPublish` against the Google
  Classroom API test double. No client change, no scope change. Lowest
  risk first, because the callable, records, rules, and audit already
  exist and are testable in isolation.
- **Stage 2 - Incremental consent and scope widening.** Add the
  coursework scopes to the requested set when publication requires them.
  Widen the existing connection's scope set on grant. Add the
  insufficient-scope guard. Certify the consent flow in the browser.
- **Stage 3 - Assign dialog extension.** Add the topic selector and
  opt-in publish toggle to LMS-linked `active` rows only. Wire topics and
  the confirm-time publish call. Provide the existing publish and topics
  seams to the Assign surface per the reconciliation ADR. Confirmation
  read-back and the retry entry point per §11 and §12. The dialog remains
  one dialog.
- **Stage 4 - Certification and verification.** Execute §13 and §14.
  Produce the Sprint 25 completion and certification report within the
  claim boundary in the definition.

## 16. Provider abstraction guardrails

Sprint 25 does not weaken provider neutrality.

- No client surface names `googleClassroom` in a persisted contract.
  Provider ids are opaque strings passed through certified callables.
- Every Google concept lives inside the adapter and its transport and
  config siblings. The vendor-neutral core sees only the adapter
  interface.
- Teacher-facing copy references Google Classroom by display name from
  the certified providers list, not from a client constant.
- The provider registry and the roster reconciliation engine are not
  modified.

## 17. Rollback strategy

Rollback is a Hosting redeploy plus a Functions redeploy of the prior
known-good bundle.

- Stage 1 rollback: Functions redeploy reverts the adapter to the stub;
  `lmsAssignmentsPublish` returns the not-operational outcome again.
  Additive Firestore state is unaffected.
- Stage 2 rollback: Functions redeploy reverts scope widening; the
  connection retains whatever scopes were granted, which is harmless.
- Stage 3 rollback: Hosting redeploy removes the Assign row affordances;
  the dialog reverts to non-publishing behavior. Assignments already
  published remain valid.
- Rollback deletes no `lmsAssignmentPublications`, `lmsConnections`,
  `lmsClassLinks`, `assignments`, `auditEvents`, or `enrollments`
  document. `lmsPublicationRef` values written before rollback remain
  valid and are simply not re-read by the reverted code.

## 18. Anchors

Certified anchors Sprint 25 reuses and does not restructure:

- `platform/functions/src/lms/assignments-publish.ts` (callable; unchanged shape)
- `platform/functions/src/lms/classes-list-topics.ts` (topics)
- `platform/functions/src/lms/tokens/*` (server-only token store)
- `platform/functions/src/lms/providers/registry.ts` (provider registry)
- `platform/functions/src/shared/types/lms.ts`, `shared/types/assignment.ts` (reserved shapes)
- `platform/firebase/firestore.rules` (publication and connection rules)

Certified anchors Sprint 25 modifies in bounded places:

- `platform/functions/src/lms/providers/google-classroom/adapter.ts`
  (replace the stubbed coursework write with the live call; select the
  coursework scope set when incremental consent requests it)
- `platform/functions/src/lms/connections-begin.ts` (carry a requested
  capability or scope selector in the request shape)
- `platform/functions/src/lms/connections-complete.ts` (merge newly
  granted scopes into the caller's existing connection rather than create
  a second connection)

Client anchors Sprint 25 extends:

- The Assign dialog surface (per-row topic selector and publish toggle,
  confirm-time publish call, confirmation read-back, retry entry point)
- The client wiring that provides the existing publish and topics seams
  to the Assign surface, per the reconciliation ADR

*End of blueprint.*
