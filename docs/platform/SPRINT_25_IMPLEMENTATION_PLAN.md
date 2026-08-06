# Sprint 25 Implementation Plan

Status: Implementation planning document. Authoritative source for
phase sequence, commit boundaries, and unresolved implementation
decisions. Produced from `SPRINT_25_DEFINITION.md`,
`SPRINT_25_ARCHITECTURAL_BLUEPRINT.md`, `PDR_030_LMS_ASSIGNMENT_PUBLICATION.md`,
and `ADR_LMS_PUBLICATION_SURFACE_RECONCILIATION.md`.

Style: no em dashes. Use " - " (spaced hyphen).

---

## 1. Codebase State at Planning Time

The following is what already exists in the certified tree and is
directly reused by Sprint 25 without modification to its shape.

### Fully implemented and unchanged

- `lmsAssignmentsPublish` callable
  (`platform/functions/src/lms/assignments-publish.ts`).
  Ownership checks, link and connection validation, publication-record
  write, mirror-pointer update, audit emission, and graceful-failure path
  are all present. The callable already calls `adapter.publishAssignment()`.
  Sprint 25 makes that call reach the live upstream.

  Correction to the earlier claim of "certified-shape, unchanged." The
  request/response contract, the record shapes, the mirror shape, and the
  audit vocabulary are unchanged. The callable's internal control flow is
  not left unchanged: the resolved decisions in §2 require a bounded
  restructure of the single `try/catch` in this file (see §2.3, §2.4, and
  §2.7). The current `catch` block runs for every post-resolution error,
  including errors thrown after a successful upstream write, and it
  unconditionally `.set()`s a `failed` record onto the same
  `publicationId`. That path (a) cannot see the upstream result, which is
  `const`-scoped inside the `try`, so it cannot log the upstream
  assignment id the orphan policy requires; (b) overwrites an
  already-written `succeeded` record when only the mirror update or the
  audit write fails, reporting a real success as a failure; and (c) treats
  a missing-coursework-scope outcome as a terminal failure, contrary to
  blueprint §11. Sprint 25 corrects the control flow without changing any
  external contract or record/audit shape.

- `lmsClassesListTopics` callable
  (`platform/functions/src/lms/classes-list-topics.ts`).
  Ownership checks, link and connection validation, and token resolution
  are all complete. The callable already calls
  `adapter.listClassTopics()`. Sprint 25 makes that call reach the live
  upstream.

- `lmsAssignmentPublications` Firestore collection, its typed refs,
  `LmsAssignmentPublicationCreationWrite`, and the
  `assignments/{assignmentId}.lmsPublicationRef` additive field.

- Firestore rules covering `lmsAssignmentPublications`.

- Reserved audit vocabulary `lms.assignmentPublished` and
  `lms.publishFailed`.

- Google Classroom transport layer
  (`platform/functions/src/lms/providers/google-classroom/transport.ts`).
  Both `listCourseTopics` and `createCourseWork` are implemented in the
  production HTTPS binding. The transport interface is correct. The
  transport types `GoogleClassroomTopicListRequest`,
  `GoogleClassroomTopicListResponse`, `GoogleClassroomCourseWorkCreateRequest`,
  and `GoogleClassroomCourseWorkResource` are defined. No transport
  changes are required.

- `GOOGLE_CLASSROOM_PUBLICATION_SCOPES` already declared in the adapter.

- Client seams: `createLmsCallables` (contains `publishAssignment` and
  `listClassTopics`), `createAssignmentsCallables`, and
  `createListClassLinks` are all implemented in
  `app/src/settings/integrations/wire.ts`.

- `assignmentsCreateDraft` and `assignmentsPublish` callables.

### Stubs that Sprint 25 replaces

- `adapter.listClassTopics()` - returns `notYetOperational`.
- `adapter.publishAssignment()` - returns `notYetOperational`.

### Bounded extensions Sprint 25 adds

- `lmsConnectionsBegin`: accept an optional capability or scope
  selector in addition to `providerId` and `redirectUri`.
- `adapter.beginOAuth`: select the scope set based on the requested
  capability rather than always using `GOOGLE_CLASSROOM_INITIAL_SCOPES`.
- `lmsConnectionsComplete`: when an active connection already exists for
  the same (teacher, provider) pair, merge newly granted scopes into it
  rather than returning `alreadyConnected: true` immediately. The
  existing early-return path continues to handle the truly-idempotent
  case (same scopes already present).

### New work

- Assign dialog extension: topic selector and publish toggle on LMS-linked
  `active` rows, topic fetch, confirm-time publish call, confirmation
  read-back, retry entry point.
- Providing the existing seams to the Assign surface per the ADR.

---

## 2. Implementation Design Decisions

These four decisions were deferred by the blueprint (§12.1) and must be
settled here before Phase 1 begins. None modifies the approved
architecture; each selects the implementation option the architecture
leaves open.

---

### 2.1 Client nonce policy

**Question.** Should a teacher retry re-use the original `attemptNonce`
or mint a new one? How does the client distinguish "retry the same
publish" from "publish again on purpose"?

**Context.** The `lmsAssignmentsPublish` callable derives the
`publicationId` from `lmsAssignmentPublicationIdFor(assignmentId,
providerId, attemptNonce)`. Reusing the nonce targets the same
publication record (idempotent on the LyfeLabz side). Minting a new
nonce creates a new record. Either way, `courseWork.create` creates a
new item in Google Classroom because Google Classroom carries no
upstream idempotency key.

**Options.**

A. Reuse the original nonce on retry. The same `publicationId` is
   targeted; if the prior `failed` record exists, it is overwritten by
   the retry outcome. Only one publication record exists per
   assignment-provider-nonce triple. A successful retry appears to
   "heal" the prior failure in place.

B. Always mint a new nonce for every call (initial or retry). Each
   attempt produces a new `publicationId` and a new publication record.
   The prior `failed` record is retained for audit. The append-only
   invariant (PDR-013) is strictly honored at the record level.

**Resolved: one nonce per logical publish action, not per callable
invocation.** This is a refinement of Option B, not raw Option B, and it
is coupled to the duplicate-execution guard in §2.2. The plan's original
"always mint a new nonce for every call" is rejected because it discards
the only idempotency lever the blueprint names (§12) and makes every
accidental double-execution create a second Google coursework item.

The unit of identity is the logical teacher action, not the HTTPS call:

- The client mints one `attemptNonce` when the teacher confirms a publish
  for a given row. It passes that same nonce on:
  - the initial `lmsAssignmentsPublish` call for that row,
  - the single automatic re-issue after incremental consent (§2.2 does
    not treat the pre-consent insufficient-scope outcome as a distinct
    attempt; see §2.7),
  - any transparent client-level re-dispatch of a dropped callable within
    the same confirm action.
- An explicit teacher-initiated retry from the assignment detail view
  mints a new nonce. It is a new logical action and a new ledger record.
- A deliberate later re-publish (a fresh confirm on a later visit) also
  mints a new nonce.
- When one confirm selects several LMS-linked classes, each row is a
  separate logical action with its own nonce. Each class also carries its
  own LyfeLabz `assignmentId` (one draft per class), so the derived
  `publicationId` values never collide.

Why this satisfies append-only honesty (PDR-013). Distinct teacher
decisions (initial, explicit retry, deliberate re-publish) each get a
fresh nonce and therefore a distinct record, so the blueprint §14
observation - a `failed` record for the injected failure and a separate
`succeeded` record for the retry - holds exactly. Reusing the nonce
within a single action is the deliberate idempotency mechanism the
blueprint §12 describes ("a repeat call with the same `attemptNonce`
targets the same publication record"); it collapses only accidental
re-executions of one action, which are not distinct events and must not
become distinct ledger rows.

The Sprint 25 client therefore does pass `attemptNonce`. The original
plan statement that the client would not pass it is withdrawn; without a
client-stable nonce the server cannot distinguish an accidental
re-execution from a new attempt, and the §2.2 guard cannot exist.

---

### 2.2 Duplicate publication behavior

**Question.** What happens when a teacher opens the Assign dialog for a
lesson she already assigned to an LMS-linked class, turns the publish
toggle on again, and confirms?

**Context.** The toggle defaults to off (per the definition §5 UX
rules). The teacher must deliberately opt in a second time. A second
confirm would call `lmsAssignmentsPublish` again, which - with a fresh
nonce - creates a new publication record and a new coursework item in
Google Classroom.

**Options.**

A. No guard. The toggle is off by default. If the teacher opts in a
   second time, a second coursework item is created. The append-only
   audit records both attempts. The teacher sees the new publication
   outcome in the confirmation.

B. Check the assignment's `lmsPublicationRef` before calling the
   publish callable. If a successful publication already exists, show
   the toggle as off and non-interactive, with a label like
   "Already published to Google Classroom."

C. Same as B, but the toggle is still interactive and the teacher can
   override the guard with an explicit second opt-in.

**Resolved: add a bounded duplicate-execution guard. Reject the original
"no guard" recommendation.** The original rationale - that the off-by-
default toggle plus a second deliberate opt-in is "a strong enough guard"
- is exactly the reasoning this review is instructed to reject. A default
toggle is UI friction, not a duplicate-execution control, and it does
nothing against the real duplicate risk: a browser double-click, a
double-invoked handler, or a client-level callable retry that fires the
same confirm twice. With no upstream idempotency key, each of those
POSTs a second coursework item into Google.

Two duplicate concerns must be separated:

- (a) The same logical attempt executed more than once (double-click,
  double-dispatch, transparent retry, the automatic post-consent
  re-issue). This must be guarded. It is the "ordinary duplicate
  publication" the guard exists to prevent.
- (b) The teacher deliberately confirming the same lesson to the same
  class a second time on a later visit. This is re-publication, a
  non-goal for Sprint 25 (definition §4). It is neither implemented as a
  feature nor hard-blocked; a deliberate second confirm mints a new nonce
  and is honestly recorded as a new attempt.

The guard for (a) has two additive parts, neither of which is a schema
change and neither of which blocks legitimate recovery:

1. Server-side completed-attempt guard. At the top of the publish path,
   before the upstream call, the callable reads
   `lmsAssignmentPublicationCreationDocRef(publicationId).get()`. If a
   record already exists with `status: "succeeded"`, the callable returns
   that success without a second upstream POST and without a second
   record write. This is one additional Firestore read on the publish
   path only (not on dialog open, and not on any non-LMS row), keyed on
   the deterministic `publicationId`, so it reuses the nonce identity from
   §2.1. An `absent` or `failed` record proceeds to the upstream call, so
   a genuine retry after a real failure is never blocked.

2. Client-side in-flight submit lock. The confirm control and the per-row
   retry control are disabled while a publish call for that row is in
   flight. This closes the truly concurrent double-fire window that a
   read-then-write server guard cannot close atomically. Unlike the
   default-off toggle, an in-flight submit lock is a real
   duplicate-execution control: it prevents a second dispatch of the same
   action rather than merely discouraging a second decision.

The guard deliberately does not read assignment publication state on
dialog open (original Option B/C). That read is unnecessary for concern
(a) and does not address concern (b), which Sprint 25 does not block. The
common no-LMS-linked-class dialog open is therefore unchanged.

---

### 2.3 Uncertain upstream response handling

**Question.** How should a network timeout or an ambiguous non-2xx HTTP
response from `courseWork.create` be handled, given that Google
Classroom carries no upstream idempotency key?

**Context.** If the POST request to Google times out, the adapter does
not know whether the item was created. A retry with a fresh nonce
creates a new coursework item regardless.

**Options.**

A. Treat every upstream error (including timeout) as failure. Write a
   `failed` publication record. Return the graceful failure outcome to
   the client. The teacher can retry. If the original POST succeeded,
   the retry creates a second coursework item.

B. After a timeout, do a bounded reconcile read against the course's
   recent coursework to look for a matching item. If found, treat the
   original POST as succeeded.

**Resolved: Option A - treat an uncertain response as a failed attempt,
no reconciliation lookup.** The core recommendation stands. Option B's
title-based reconcile is unreliable (assignments may share a title) and
unauthenticated by any idempotency key; a false match would report
success for the wrong item, which is worse than an honest "did not
succeed." Three corrections to the original write-up are required.

Correction 1 - the catch-all only covers fetch-level errors, not a true
hang. `translateUpstreamError` does map a connection error (no status
code) to `lms.upstreamCallFailed`, and the callable then returns the
graceful `status: "failed"` shape. That path is real and correct for a
reset/refused/DNS-class failure. But the production transport calls
`fetch` with no `AbortController` and no request timeout, so a genuine
upstream hang does not surface as a quick error. It hangs until the Cloud
Functions execution deadline terminates the whole invocation. In that
case the callable never reaches its catch, no `failed` record is written,
no audit event is emitted, and the client receives a transport/deadline
callable error, not the graceful `failed` response. The plan's claim that
an uncertain response is always "treated as a failed attempt" with a
`failed` record is therefore only true for fetch-level errors.

Correction 2 - the client must treat a thrown callable error as "did not
succeed." Because the deadline case yields a thrown error rather than a
`status: "failed"` body, the Phase 3 confirmation logic maps both a
graceful `status: "failed"` response and a thrown callable error to the
same teacher-visible "Publishing to Google Classroom did not succeed"
line, and offers retry in both. It never treats a thrown error as a hard
stop or a success.

Correction 3 (recommended, bounded) - add an explicit request timeout to
the `createCourseWork` transport call via `AbortController`, sized well
inside the function deadline. This converts a hang into a fetch-level
abort error, which flows through `translateUpstreamError` to a recorded
`failed` outcome and an emitted `lms.publishFailed`, restoring the honest
"failed attempt" guarantee the decision depends on. Without it, the
genuinely uncertain case produces no durable LyfeLabz record at all,
which weakens both the audit chain and the certification claim. Retry
after any uncertain response still may create a second Google item (no
upstream idempotency key); that residual is accepted and documented, not
reconciled.

---

### 2.4 Orphan reconciliation after upstream success then local persistence failure

**Question.** If `courseWork.create` succeeds but the subsequent
Firestore write (`lmsAssignmentPublications` record write or
`lmsPublicationRef` mirror update) fails, how is the orphan (a
coursework item in Google with no LyfeLabz record) detected and
reconciled?

**Context.** This is the sequence in `assignments-publish.ts`:

1. `adapter.publishAssignment()` - creates item in Google (irreversible).
2. `lmsAssignmentPublicationCreationDocRef(publicationId).set(record)` -
   writes the LyfeLabz record.
3. `assignmentLmsPublicationDocRef(assignmentId).update(...)` - sets
   the mirror pointer.

If step 1 succeeds and step 2 or 3 throws, the item exists in Google
but is not recorded in LyfeLabz.

**Options.**

A. Accept the orphan. The existing `try/catch` in the callable writes
   a `failed` record in its catch block. If the Firestore write in step
   2 or 3 fails, the catch block attempts to write a `failed` record -
   which may also fail. The callable returns the graceful failure outcome
   to the client. Server-side logging captures the upstream assignment ID
   that was created. The teacher is told publication did not succeed and
   can retry; the retry creates a second coursework item.

B. Before the upstream call, write a `pending` record to
   `lmsAssignmentPublications`. After the upstream call succeeds, update
   it to `succeeded`. After the upstream call fails, update it to
   `failed`. A `pending` record that is never resolved is the detectable
   orphan signal.

C. Accept the orphan as in Option A but log the upstream assignment ID
   and lmsClassId with severity `error` so the orphan is searchable in
   the Functions log. No record write is added. No `pending` state is
   introduced.

**Resolved: Option C in intent (accept the orphan, log the upstream id at
error severity, no `pending` record), but the plan's implementation
description is wrong and is replaced.** Option B is still rejected:
`LmsAssignmentPublicationStatus` is `"succeeded" | "failed"` only, so a
`pending` state is a certified-shape change with no repair path in Sprint
25. Two facts about the current code invalidate the original Option C
write-up:

- There is no re-throw to log "between." The catch does not re-throw on a
  publish failure; it returns `status: "failed"`. The phrase "between the
  outer success and the re-throw" describes control flow that does not
  exist.
- The upstream result is not reachable from the catch. `published` is
  `const`-scoped inside the `try`, so "log the upstream assignment ID"
  cannot be a one-line addition in the catch. The result must be captured
  in a variable declared outside the `try`.

Corrected implementation (bounded, control-flow only, no schema change).
Split the single `try/catch` into two ordered phases:

- Phase A - the upstream call. `let published: LmsPublishedAssignment |
  undefined`. On failure here (nothing was created upstream, or the
  outcome is genuinely unknown per §2.3), write the `failed` record, emit
  `lms.publishFailed`, return the graceful failure. This is the only path
  that writes a `failed` record.
- Phase B - persistence and audit of a known upstream success. Once
  `published` is set, the coursework item exists. Persist in this order,
  and never downgrade the reported outcome to `failed` from here:
  1. Write the `succeeded` record.
  2. Update the `lmsPublicationRef` mirror.
  3. Emit `lms.assignmentPublished`.

Per-step failure handling in Phase B (see §2.5 cases 1, 3, 4):

- Record write fails (§2.5 case 1, the true orphan). The item exists but
  no LyfeLabz record does. Log at `error` severity with `providerId`,
  `linkId`, `lmsClassId`, `publicationId`, and the upstream assignment id
  from `published.lmsAssignmentId` (available because it is now hoisted).
  The upstream assignment id is an LMS resource id, not student PII and
  not a token, so logging it is permitted; the error body is not logged.
  Return "did not succeed" and offer retry; a retry may create a second
  item (accepted, logged, manually recoverable via the logged id).
- Mirror update fails but the record write succeeded (§2.5 case 3). Do
  not clobber the `succeeded` record. Keep it, log an `error`
  mirror-desync line with `publicationId`, and return success. The mirror
  pointer is a denormalized convenience; a missing pointer does not make
  the publish a failure and does not create a duplicate. The current
  single-catch code instead overwrites the `succeeded` record with a
  `failed` one here, which is a defect this restructure removes.
- Audit emission fails but record and mirror succeeded (§2.5 case 4). The
  publish is durably successful. Log an `error` audit-gap line and return
  success. Do not clobber the `succeeded` record to `failed`. In the
  current code `writeAuditEvent` is awaited outside `safeLog`, so an audit
  failure throws into the catch and inverts a real success into a
  reported failure plus a clobbered record; the restructure prevents that
  inversion.

No new Firestore state and no new audit kind are introduced. The change
is entirely internal control flow in `assignments-publish.ts`.

---

### 2.5 The one attempt model (all scenarios)

The nonce policy (§2.1), the duplicate guard (§2.2), the uncertain-
response policy (§2.3), and the orphan policy (§2.4) compose into one
model. Every scenario the review must cover is resolved by it.

| Scenario | Client nonce | New record? | Second Google item possible? | Teacher sees | Audit event | Retry offered |
|---|---|---|---|---|---|---|
| First publish (toggle on, confirm) | mint nonce N for the action | yes, one on outcome | not applicable | succeeded / did not succeed | `assignmentPublished` on success, `publishFailed` on real failure | on failure |
| Accidental duplicate confirmation of the same action | reuse N | no | no - server sees the `succeeded` record for N and skips the upstream POST; submit lock usually prevents the second dispatch first | same success line | none added | not applicable |
| Browser double-click / repeated client execution | reuse N | no | no - submit lock plus server `succeeded` guard | same line | none added | not applicable |
| Retry after an explicit Google failure | mint new nonce M | yes, a `succeeded` record for M; the `failed` record for N is retained | yes, but only because N produced no upstream item | success on retry | new `assignmentPublished` | already taken |
| Retry after a timeout / uncertain response | mint new nonce M | yes | yes - the original POST may have created an item; no upstream idempotency key (accepted residual) | success or did not succeed | new event per outcome | until success |
| Upstream success then local persistence failure | nonce N | no reliable record (write failed) | yes on retry (new nonce) | did not succeed | none (record + audit are what failed); `error` log carries the upstream id | yes; residual duplicate on retry |
| Deliberate later re-publication (non-goal) | mint new nonce | yes | yes - a distinct deliberate action, honestly recorded | success | new `assignmentPublished` | not applicable |
| Multiple LMS-linked classes in one confirm | one nonce per row; distinct `assignmentId` per class | one record per row | independent per row | per-row outcome line | one event per row | per row on failure |

---

### 2.6 Durable state, guarantees, and logging boundary per failure point

Part 4 of the review requires stating what the system can truthfully
guarantee, not merely that an orphan is "accepted." The corrected control
flow (§2.4) makes each answer precise.

| Failure point | Durable state | Upstream id available? | Store / log it? | Teacher status | Retry safe? | Recovery path | Certification expectation |
|---|---|---|---|---|---|---|---|
| 1. Google created coursework and returned an id; local record write fails | Upstream item exists; no LyfeLabz record | Yes, from the hoisted `published` | Store: no (the write is what failed); log: yes, `error` with the upstream id | Did not succeed | No - a retry may create a second item | Cloud Logging search on the logged upstream id; manual delete in Google | Honest failure with a logged, searchable orphan; residual named in the claim boundary |
| 2. Response times out; the item may or may not exist | Unknown upstream; no LyfeLabz record unless the abort timeout (§2.3) fired | No - there is no response body | Nothing to store or log beyond the sanitized error code | Did not succeed | No - a retry may duplicate | Manual reconcile in Google; the §2.3 abort timeout converts most hangs into a recorded `failed` | Named as the genuinely uncertain case; no no-duplicate guarantee on retry |
| 3. Record write succeeded; mirror update fails | Item exists; `succeeded` record exists; mirror pointer absent | Yes, and it is stored in the record | Log: yes, `error` mirror-desync | Succeeded (truthful) | Not offered - it succeeded | Mirror is a denormalization; self-heals on a later successful publish or a separate repair | No duplicate; success reported truthfully; record must not be clobbered |
| 4. Record and mirror succeeded; audit emission fails | Item, record, and mirror all durable; audit event missing | Yes, stored in the record | Log: yes, `error` audit-gap | Succeeded (truthful) | Not offered | Known logged audit gap; append-only ledger is otherwise intact | Success reported truthfully; a single audit gap is logged, not converted into a false failure |

In every case the provider error body stays sanitized: only the stable
`PlatformError` code, the endpoint identifier, and the fields named above
are logged. No student PII, no Google email, no OAuth token, and no raw
upstream payload is written to any record, audit payload, or log line.

No existing transaction, batch, or reconciliation utility removes these
risks without expanding Sprint 25 into synchronization, which is a
non-goal (definition §4). The write ordering in §2.4 (upstream, then
record, then mirror, then audit) is the available mitigation and is
sufficient for the certified environment; the abort timeout (§2.3) is the
one bounded addition that shrinks the uncertain window.

---

### 2.7 Insufficient-scope is not a publication failure

This falls out of §2.1 and §2.4 and must be settled with them. Blueprint
§11 states that a missing coursework scope "is not a failure" and routes
to incremental consent plus one automatic re-issue. The current callable
does not honor that: any error thrown by `adapter.publishAssignment`,
including the Phase 1 `lms.insufficientScope` code, falls into the single
catch, writes a `failed` record, and emits `lms.publishFailed`. Left as
is, every teacher's first publish would write a spurious `failed` record
and a spurious `lms.publishFailed` audit event before consent, which
corrupts the ledger and breaks the blueprint §14 expectation of exactly
one `lms.publishFailed` per injected failure.

Resolution. The callable special-cases `lms.insufficientScope` ahead of
the failure branch: it returns a distinct, non-terminal outcome to the
client and writes no `failed` record and no `lms.publishFailed` event.
The client then runs the incremental-consent handoff and re-issues the
publish once with the same nonce (§2.1). Only if the re-issue fails for a
non-scope reason is a `failed` record written. This is a bounded
control-flow addition consistent with blueprint §11; it changes no record
or audit shape.

---

### 2.8 Decision status

Settled by this plan (implementation-design decisions within the
architecture the blueprint left open):

- §2.1 nonce lifecycle: one nonce per logical action; reused within the
  action and its automatic re-issue; new nonce for explicit retry and for
  deliberate re-publish; one nonce per row for a multi-class confirm.
- §2.2 duplicate-execution guard: server-side `succeeded`-record short
  circuit before the upstream POST, plus a client in-flight submit lock.
  No dialog-open publication-state read. Deliberate re-publication is not
  blocked and is not a Sprint 25 feature.
- §2.3 uncertain response: treated as a failed attempt with no reconcile
  lookup; client maps both a graceful failure and a thrown callable error
  to "did not succeed"; add an `AbortController` timeout to the coursework
  POST.
- §2.4 orphan handling: accept the orphan, split the callable into an
  upstream phase and a persistence/audit phase, log the upstream id at
  `error` severity, and never clobber a written `succeeded` record.
- §2.7 insufficient-scope is non-terminal and writes no failure record or
  event.

Ratification status (updated 2026-08-06):

- PDR-030 is RATIFIED into `LYFELABZ_PLATFORM_DECISIONS.md` (inserted
  after PDR-029, with a Change Log entry), authorizing the coursework
  scope addition and the incremental-consent posture (blueprint §7,
  PDR-030b/c/d). Phase 2's scope expansion is now authorized. The
  standalone `PDR_030_LMS_ASSIGNMENT_PUBLICATION.md` status was updated
  to point at the ratified canonical record.
- No canonical document (definition, blueprint, PDR-030, ADR) is changed
  by this plan. The §2.4 and §2.7 control-flow corrections refine the
  definition §7 "reused unchanged" phrasing for `lmsAssignmentsPublish`
  to "external contract and record/audit shapes unchanged; internal
  control flow corrected." If the sprint owners read definition §7 as
  forbidding any change to the callable's internal control flow, that is
  the one point that needs their explicit confirmation, because blueprint
  §11 cannot be honored without it. See the escalation note in the final
  report.

---

## 3. Implementation Phases

Four phases, each independently reviewable, testable, and rollback-safe.
No phase begins until the prior phase's review is approved and its
commits are merged.

---

### Phase 1: Adapter Go-Live (Server Only)

**Objective.** Replace the two stubbed adapter methods
(`listClassTopics` and `publishAssignment`) with live upstream calls
through the existing transport. Map and sanitize all new upstream error
paths. No client change. No scope change. No OAuth change.

**Why this phase exists.** The callable, records, rules, and audit
vocabulary already exist and are testable in isolation. Activating the
adapter methods first - before touching the OAuth flow or the Assign
dialog - means every other phase can exercise a real adapter instead of
a stub. This is the lowest-risk first step and validates the full
server-side publication path before any client work begins.

**Reuse vs. modify.**

| Component | Status |
|---|---|
| `lmsAssignmentsPublish` callable | Contract, records, mirror, and audit vocabulary unchanged. Internal control flow restructured per §2.4, §2.7, plus the §2.2 guard and §2.3 timeout. |
| `lmsClassesListTopics` callable | Reused unchanged. |
| `lmsAssignmentPublications` collection | Reused unchanged. |
| `assignments.lmsPublicationRef` field | Reused unchanged. |
| Firestore rules | Reused unchanged. |
| Audit vocabulary | Reused unchanged. |
| Google Classroom transport (`listCourseTopics`, `createCourseWork`) | Reused unchanged. |
| `adapter.ts` (`listClassTopics`, `publishAssignment`) | Modified: stubs replaced with live transport calls. |
| `adapter.ts` (`translateUpstreamError`) | Extended: ensure no orphan upstream error shape falls through for the new operations. |

**Files expected to change.**

- `platform/functions/src/lms/providers/google-classroom/adapter.ts`
  (activate the two stubs; map errors).
- `platform/functions/src/lms/assignments-publish.ts` (control-flow
  restructure per §2.4, §2.7; `AbortController` timeout per §2.3; the
  server-side `succeeded`-record guard per §2.2).
- `platform/functions/src/lms/providers/google-classroom/transport.ts`
  only if the `AbortController` timeout is threaded through the transport
  rather than added at the adapter boundary (implementer's choice; keep
  the timeout provider-local either way).

The original plan listed the adapter as the only Phase 1 change. That was
based on the withdrawn "callable reused unchanged, one-line orphan log"
assumption. The callable restructure is the substance of commit 25-2.

**Major implementation tasks.**

1. Replace the `listClassTopics` stub with a live call to
   `transport.listCourseTopics`. Apply bounded pagination (matching the
   `listClassRoster` pattern). Map each `GoogleClassroomTopicResource`
   to `LmsTopic`. Translate upstream errors through the existing
   `translateUpstreamError` function. Sanitize: no topic content beyond
   `topicId` and `name` escapes the adapter.

2. Replace the `publishAssignment` stub with a live call to
   `transport.createCourseWork`. Map `LmsPublishAssignmentInput` to
   `GoogleClassroomCourseWorkCreateRequest`: `title` maps to `title`,
   `lyfelabzAssignmentUrl` maps to `link`, `lmsTopicId` maps to
   `topicId`. Map the response `GoogleClassroomCourseWorkResource` to
   `LmsPublishedAssignment`: `id` becomes `lmsAssignmentId`,
   `alternateLink` becomes `lmsAssignmentUrl` if present. Translate
   all upstream errors through `translateUpstreamError`. Restructure the
   callable's control flow per §2.4 and §2.7: split the single `try/catch`
   in `assignments-publish.ts` into an upstream phase and a
   persistence/audit phase, hoist the upstream result, add the
   `error`-severity orphan/mirror-desync/audit-gap log paths, stop
   clobbering a written `succeeded` record, treat `lms.insufficientScope`
   as non-terminal, and add the `AbortController` timeout to the coursework
   POST (§2.3). This is a bounded control-flow change, not the one-line
   catch addition the earlier draft assumed; it changes no external
   contract and no record or audit shape. It is in `assignments-publish.ts`,
   not the adapter.

3. Verify that `translateUpstreamError` already handles the 403 case
   that arises when the coursework scopes are absent. If the
   `lms.upstreamAuthorizationFailed` code it produces is not distinct
   enough for the client to route to the incremental consent path (Phase
   2), add a dedicated `lms.insufficientScope` code that the adapter
   emits specifically when the upstream 403 body contains the
   coursework-scope signal. This code is consumed by the Phase 2 client
   logic.

**Unit testing requirements.**

- Tests for `listClassTopics` via the fixture transport:
  - Single page of topics; multiple pages.
  - Empty topic list.
  - Topic list with a deleted or ARCHIVED topic (confirm behavior).
  - Upstream 401/403/404/429/503 errors mapped to correct
    `PlatformError` codes.
  - Malformed upstream response (missing `topicId` or `name`).

- Tests for `publishAssignment` via the fixture transport:
  - Successful publish: returned `lmsAssignmentId` and optional
    `lmsAssignmentUrl` present.
  - Publish with a `lmsTopicId`: `topicId` appears in the transport
    request body.
  - Publish without `lmsTopicId`: `topicId` absent from transport
    request body.
  - Upstream 401/403/404/429/503 errors mapped to correct
    `PlatformError` codes.
  - The `lms.insufficientScope` code emitted when upstream 403
    signals missing coursework scope (the specific error surface that
    drives the Phase 2 client incremental consent path).
  - Transport unbound error.

- Adapter-level tests do not need to exercise `lmsAssignmentsPublish`
  end to end; that is the callable's test suite.

- Callable-level tests for the restructured `lmsAssignmentsPublish` (the
  substance of commit 25-2, driven by a fixture adapter):
  - Upstream success then record write throws: no `succeeded` record
    survives, an `error` log carries the upstream assignment id, the
    response is "did not succeed" (§2.5 case 1).
  - Upstream success, record write ok, mirror update throws: the
    `succeeded` record is retained (not clobbered to `failed`), the
    response is "succeeded," a mirror-desync `error` is logged (§2.5
    case 3).
  - Upstream success, record and mirror ok, audit emission throws: the
    `succeeded` record is retained, the response is "succeeded," an
    audit-gap `error` is logged; the success is not inverted to a failure
    (§2.5 case 4).
  - `lms.insufficientScope` from the adapter: no `failed` record, no
    `lms.publishFailed` event, a distinct non-terminal response (§2.7).
  - A pre-existing `succeeded` record for the same `publicationId`: the
    upstream call is not made a second time and the existing success is
    returned (§2.2 server guard).
  - A pre-existing `failed` record for the same `publicationId`: the
    upstream call proceeds (retry within the action is not blocked).
  - Coursework POST timeout via the injected fetch abort: mapped to a
    recorded `failed` outcome, not a swallowed hang (§2.3).

**Browser testing requirements.**

None in this phase. Phase 1 is server-only. Browser testing is
integrated in Phase 4 certification.

**Backend verification requirements.**

After Phase 1 is merged, run the functions test suite
(`npm --prefix platform/functions test`) and confirm all existing tests
still pass. Run `npm --prefix app run verify` to confirm no client
regressions. No emulator-bound verification is required for Phase 1 in
isolation; that is Phase 4.

**Completion criteria.**

- `adapter.listClassTopics` calls the transport and returns `LmsTopic[]`;
  the stub is gone.
- `adapter.publishAssignment` calls the transport and returns
  `LmsPublishedAssignment`; the stub is gone.
- All new adapter unit tests pass.
- All existing adapter tests, callable tests, and app tests remain green.
- `npm --prefix app run verify` passes.
- No Google-specific concept (course ID, upstream error body, token)
  escapes the adapter into the callable or the audit payload.

**Rollback safety.**

Functions redeploy of the prior bundle reverts the adapter to the stubs.
`lmsAssignmentsPublish` returns `lms.providerNotYetOperational` again.
`lmsClassesListTopics` returns `lms.providerNotYetOperational` again.
No Firestore state is written by Phase 1 (no publication records are
created until the callable is invoked with a live assignment and link,
which does not happen until Phase 3 client work exists). Rollback is
safe.

**Dependencies.** None. Phase 1 is the starting point.

---

### Phase 2: Incremental Consent and Scope Widening

**Objective.** Extend `lmsConnectionsBegin`, `adapter.beginOAuth`, and
`lmsConnectionsComplete` to carry and record the coursework scope set
when publication requires it. These are bounded additive extensions of
existing callables. No new callable is introduced. No duplicate
connection is created.

**Why this phase exists.** The existing OAuth connection lifecycle
requests only the readonly scope set. Publication requires the coursework
scopes. This phase adds the mechanism that lets the teacher grant those
scopes incrementally - exactly once, at first publish, without minting a
second connection. Without this phase, `lmsAssignmentsPublish` always
encounters an `lms.insufficientScope` error and cannot succeed.

**Reuse vs. modify.**

| Component | Status |
|---|---|
| `lmsConnectionsBegin` callable | Modified: request shape extended to accept optional capability selector. |
| `adapter.beginOAuth` | Modified: selects `GOOGLE_CLASSROOM_PUBLICATION_SCOPES` when capability requests publication. |
| `lmsConnectionsComplete` | Modified: scope-merge path added for incremental consent. |
| `connections-complete-oauth-state.test.ts` | Extended with scope-merge tests. |
| `connections-lifecycle-integration.test.ts` | Extended with incremental consent scenario. |
| Client `wire.ts` `beginConnection` wrapper | Extended: passes `capability` from caller. |
| All OAuth state store, token store, and adapter - anything else | Reused unchanged. |

**Files expected to change.**

- `platform/functions/src/lms/connections-begin.ts` (accept
  `capability`, thread `intent` into `beginOAuth`)
- `platform/functions/src/lms/connections-complete.ts` (intent-aware
  create/widen/refuse; scope merge; token swap)
- `platform/functions/src/lms/providers/provider.ts` (additive optional
  `capability`/`intent` on the `beginOAuth` input type; the provider
  interface is provider-neutral, so the field is a neutral selector)
- `platform/functions/src/lms/providers/google-classroom/adapter.ts`
  (scope selection in `beginOAuth`)
- `platform/functions/src/lms/oauth-state/state-store.ts` (additive
  `intent` on the issue input, stored record, and `LmsOAuthStateBinding`;
  optional `expectedIntent` on consume)
- `platform/functions/src/lms/oauth-state/firestore-state-store.ts`
  (mirror the additive `intent` field in the durable store)
- `platform/functions/src/lms/oauth-state/state-store.test.ts` and
  `firestore-state-store.test.ts` (intent binding coverage)
- `platform/functions/src/lms/connections-lifecycle-integration.test.ts`
- `platform/functions/src/lms/connections-complete-oauth-state.test.ts`
- `app/src/settings/integrations/wire.ts` (add `capability` param to
  `beginConnection`)
- `app/src/settings/integrations/types.ts` (add optional `capability` to
  the `beginConnection` input; optionally surface `consentOutcome` on the
  complete result type)

The connection record shape (`LmsConnectionRecord` /
`LmsConnectionCreationWrite` in
`platform/functions/src/shared/types/lms.ts`) needs at most one additive
optional field (`scopesUpdatedAt?`); the existing `scopes` and `tokenRef`
fields already carry the widened set and the swapped reference, so no
required-field change and no renamed field is introduced. No Firestore
Rules change: all `lmsConnections` client writes are already denied and
the widen write is an Admin SDK write that bypasses Rules.

**Major implementation tasks.**

1. **`lmsConnectionsBegin` extension.** Add an optional
   `capability?: "publication"` field to `LmsConnectionsBeginRequest`.
   Pass the capability into `adapter.beginOAuth` so the adapter can
   select the appropriate scope set. No other logic change. The
   `capability` field is optional and defaults to the readonly scope set
   when absent, so all existing connection flows are unchanged.

2. **`adapter.beginOAuth` extension.** When the input carries
   `capability: "publication"`, include both `GOOGLE_CLASSROOM_INITIAL_SCOPES`
   and `GOOGLE_CLASSROOM_PUBLICATION_SCOPES` in the `scope` parameter
   of the authorization URL. `include_granted_scopes: "true"` is already
   present, so the teacher is not asked to re-grant readonly scopes she
   previously granted. When no capability is requested, use only
   `GOOGLE_CLASSROOM_INITIAL_SCOPES` as today.

3. **`lmsConnectionsComplete` scope-merge path.** The current early-return
   path fires when an `active` connection already exists for (teacher,
   provider). For the incremental consent case, the teacher has an
   existing active connection and is completing a fresh OAuth grant to
   add publication scopes. The callable must distinguish:

   - **Truly idempotent** (existing connection is active and the caller
     is not requesting scope expansion): return `alreadyConnected: true`
     as today.
   - **Scope expansion** (existing connection is active, a fresh code
     was exchanged, and the new grant includes scopes the existing
     connection does not already record): update the existing connection's
     `scopes` field with the union of old and new scopes. Write the new
     token through the token store. Emit no second `lms.connectionCreated`
     audit event (the connection identity is unchanged). Return
     `{ connectionId, providerId, alreadyConnected: true }` so the
     caller knows no second connection was created.

   The callable must verify the `upstreamAccountIdentifier` from the new
   grant against the identity of the existing token bundle before
   accepting the scope expansion. This comparison is new code, not a
   reused helper: no reusable helper for OAuth connection widening exists
   in the certified tree. It follows the same security principle as the
   certified import-time profile verification, and it implements the
   already-approved PDR-030d requirement rather than introducing a new
   architectural decision. The existing connection stores `tokenRef`,
   which must be resolved through the server-only token store to read the
   existing bundle's `upstreamAccountIdentifier`; that stored identifier
   is compared against the new OAuth grant identity, and if the two do
   not match, the callable refuses the scope widening with a
   plain-language error (not `lms.invalidOAuthState`).

   The scope-merge update uses an additive Firestore update (field-value
   union or full scope array update) rather than a set-and-overwrite, to
   preserve the connection's other fields.

4. **Client `wire.ts` `beginConnection` extension.** Pass an optional
   `capability` field from the caller into the `lmsConnectionsBegin`
   request. The Phase 3 Assign dialog client code will call
   `beginConnection({ providerId, redirectUri, capability: "publication" })`
   to trigger the publication-scope consent path.

**Phase 2 preparation design refinements (2026-08-06, verified against source).**

The four tasks above are correct in outline. The following refinements
are the precise, source-verified specification Phase 2 implements. They
do not change any canonical decision; they close gaps the outline left
implicit. Where a refinement and the outline differ, the refinement
governs Phase 2 coding.

*R1. Consent-intent request shape (provider-neutral).* The begin request
gains one optional, provider-neutral field:
`capability?: "publication"`. No raw Google scope string appears in the
client-facing `LmsConnectionsBeginRequest`. Absent `capability`, the flow
is byte-identical to today (readonly scope set). `capability:
"publication"` is the sole selector the client can send; the adapter, not
the client, maps it to `GOOGLE_CLASSROOM_PUBLICATION_SCOPES`. The union
`LmsProviderId` stays closed and no Google concept leaks past the adapter
(PDR-019h, PDR-030c).

*R2. OAuth state binding additions.* The state store record
(`InProcessLmsOAuthStateStore` and `FirestoreLmsTokenStore`'s sibling
`FirestoreLmsOAuthStateStore`) today binds `{ teacherId, providerId,
redirectUri }` plus the PKCE verifier, a 10-minute TTL, and a single-use
`consumedAt` marker. Phase 2 adds one additive field to the binding:
`intent` (provider-neutral; `"initialConnect"` default or
`"publication"`). `issue()` accepts and persists it; `peek()` and the
`LmsOAuthStateBinding` type expose it; `consume()` may accept an
`expectedIntent` for defense in depth. The teacher, provider, redirect,
TTL, and one-time-use protections already present are retained unchanged.
The binding does NOT carry a client-supplied connection id: the target
connection is derived server-side from `lmsConnectionIdFor(actor.uid,
providerId)`, so the callback never trusts client-supplied connection
ownership. `intent` is what lets `lmsConnectionsComplete` decide, before
exchanging the code, whether to take the idempotent short-circuit or the
scope-widening path (see R4), instead of inferring it only from the
returned scopes.

*R3. Authorization URL scope selection.* `beginOAuth` selects the scope
set from `intent`/`capability`: readonly-only for the initial connect
path; `GOOGLE_CLASSROOM_INITIAL_SCOPES` unioned with
`GOOGLE_CLASSROOM_PUBLICATION_SCOPES` for publication. `access_type=offline`,
`include_granted_scopes=true`, and `prompt=consent` are already present;
`include_granted_scopes=true` is what preserves the previously granted
readonly scopes so the teacher is not asked to re-grant them. No scope
beyond the two coursework scopes is ever requested (PDR-030b).

*R4. Completion: create vs. widen vs. refuse.* Today
`lmsConnectionsComplete` short-circuits to `alreadyConnected: true` for
any `active` connection BEFORE the state peek and BEFORE the code
exchange. Phase 2 makes the decision intent-aware. This is an internal
control-flow adjustment to the existing completed-connection
short-circuit, not an architectural redesign of the completion callable:

- **First connection** (no existing connection doc): unchanged. Exchange,
  store token, `.set()` the creation record, emit `lms.connectionCreated`.
- **Idempotent replay** (existing `active` connection, `intent` is not
  `publication`, or the peeked state shows no publication intent): return
  `alreadyConnected: true` as today, with no code exchange.
- **Scope widening** (existing `active` connection AND publication
  intent): do NOT short-circuit. Run the state peek (teacher, provider,
  redirect, intent all enforced), exchange the code, then merge (R5).
- **Already-authorized** (existing `active` connection already records
  every publication scope): after exchange, if the merged scope set
  equals the existing set, the path remains idempotent - no token swap,
  no write, return `alreadyConnected: true`. In practice the publish path
  only triggers consent on `lms.insufficientScope`, so this is a
  defensive branch.
- **Refuse** (identity mismatch): the new grant's
  `upstreamAccountIdentifier` is compared against the existing token
  bundle's identifier, resolved by reading the existing `tokenRef`
  through the token store (the connection document itself does not store
  the identifier; the token bundle does). This comparison is a new
  implementation that follows the same security principle as the
  certified import-time profile verification; no reusable helper for this
  connection-widening comparison exists. A mismatch is refused with a
  distinct plain-language error (NOT coerced to `lms.invalidOAuthState`)
  and leaves the existing connection untouched (PDR-030d).

*R5. Token replacement, refresh-token handling, and atomic ordering.*
The token store `store()` mints a fresh opaque `tokenRef` via `.create()`
(non-overwrite) and exposes no in-place update; there is deliberately no
publication-specific token store. Widening therefore composes a merged
bundle and swaps the reference in the exact order below, so a failure at
any step leaves the old connection fully usable.

Two distinct operations must not be conflated in this section. Local
token-store cleanup (the token store's own delete/revoke of a superseded
LyfeLabz token bundle) is a LyfeLabz-storage operation only. Provider
grant revocation (calling Google's OAuth token-revocation endpoint) is a
different operation, and Sprint 25 never performs it during a successful
scope widening: the widened connection keeps using the same underlying
Google grant, so revoking that grant would break the connection. Every
use of `revoke()` in this section means the local token-store delete
operation only, never Google's grant revocation.

1. Resolve the existing bundle from the connection's current `tokenRef`
   (old access token, old refresh token, old `upstreamAccountIdentifier`,
   old scopes).
2. Verify identity (R4 refuse branch) before any write.
3. Compose the merged bundle: `accessToken` = the fresh grant's;
   `refreshToken` = the fresh grant's refresh token IF Google returned
   one, ELSE carry forward the existing refresh token (Google routinely
   omits `refresh_token` on an incremental re-consent, so the prior
   refresh token MUST be preserved, never dropped); `scopes` = the
   set-union of old and newly granted scopes; `expiresAtEpochMs` = the
   fresh grant's; `upstreamAccountIdentifier` = unchanged.
4. `store()` the merged bundle, obtaining a new `tokenRef`.
5. Update the one connection document additively: `scopes` = merged union
   and `tokenRef` = the new reference (preserving `teacherId`, `schoolId`,
   `providerId`, `status: "active"`, `connectedAt`). An additive
   `scopesUpdatedAt` server timestamp MAY be written; no field is renamed
   or removed (PDR-019g).
6. Only after the connection update commits, best-effort `revoke()` the
   old `tokenRef` through the server-only token store. This is a local
   token-store delete of the superseded LyfeLabz bundle only; it MUST NOT
   call Google's OAuth grant-revocation endpoint, because the widened
   connection continues to use the same underlying Google grant. If the
   local token-store delete fails, the orphaned old bundle is inert (no
   connection references it) and is logged, not surfaced.

If step 4 or 5 throws, the connection still points at the old, valid
`tokenRef` and retains its old scope set: the existing connection is not
destroyed by a failed widen. The teacher can retry consent.

*R6. Duplicate-connection prevention.* The connection document id is
deterministic: `lmsConnectionIdFor(teacherId, providerId)` = one document
per (teacher, provider). Completion always targets that same id, so
widening is an update of the single existing document and a second active
connection cannot be minted by construction. The connection document
remains the single source of truth for the connection, and the
deterministic connection id continues to prevent duplicate active
connections. No new connection collection and no Google-specific client
authority flag are introduced.

*R7. Failure matrix (Phase 2 exact outcomes).*

| Failure point | Outcome |
|---|---|
| Teacher closes / denies consent | No code returned to the callback; the client maps a cancelled handoff to "consent cancelled". Existing connection unchanged. |
| State missing / expired / replayed / provider or redirect mismatch | Store throws its granular code; the callable coerces to the single `lms.invalidOAuthState`. No exchange, no write. |
| State intent mismatch | Same coercion to `lms.invalidOAuthState` (defense in depth). |
| New grant identity differs from connected identity | Distinct plain-language refusal (R4). Existing connection untouched. |
| Coursework scopes not actually granted (merged set == existing set) | Already-authorized branch: no write, `alreadyConnected: true`. The subsequent publish re-issue will still see `lms.insufficientScope` and the client surfaces "consent did not add the required scope". |
| Token exchange fails | `coerceOAuthStateError` path; graceful failure. No write. Existing connection untouched. |
| Token persistence (`store`) fails | Widen aborts before the connection update. Existing connection and its old `tokenRef` remain valid. |
| Connection merge (`update`) fails | New bundle is orphaned and inert; connection still points at the old valid `tokenRef`. Logged; existing connection usable. |
| Existing connection expired / revoked at consent time | A non-`active` connection is not widened; the client is routed to the existing account-level reconnect flow (`reconnectRequired`). |
| Simultaneous incremental-consent attempts | Each `begin` invalidates the teacher's prior pending OAuth state for the provider (a state-store operation, unrelated to token or grant revocation); `consume` is single-use and atomic, so at most one completion widens. A late second completion sees a consumed state and coerces to `lms.invalidOAuthState`. |

*R8. Client contract (sanitized, for the Phase 3 Assign surface).*
Completion returns the existing shape `{ connectionId, providerId,
alreadyConnected }` plus one additive, provider-neutral, token-free
discriminator so the Assign surface can distinguish outcomes without
seeing token material: `consentOutcome` in
`{ "widened", "alreadyAuthorized", "created" }`. The Phase 3 client maps
outcomes to: consent succeeded and publication may be retried
(`widened`/`alreadyAuthorized`); reconnect required (a non-`active`
connection, surfaced as `reconnectRequired`, reusing the existing status
vocabulary in `app/src/settings/integrations/types.ts`); consent
cancelled or denied (handoff returned no code); unexpected failure (any
thrown callable error). No token, Google email, or account id crosses the
boundary in any branch. Phase 2 provides this server response; the Assign
dialog that consumes it is Phase 3.

**The insufficient-scope guard (client side, consumed in Phase 3).**

When `lmsAssignmentsPublish` returns `lms.insufficientScope` (the
`PlatformError` code established in Phase 1 task 3), the Assign dialog
client runs the OAuth handoff with `capability: "publication"`, then
re-issues `lmsAssignmentsPublish` once. This client logic is implemented
in Phase 3. Phase 2 provides the server machinery that makes the handoff
work.

**Unit testing requirements.**

- `lmsConnectionsBegin`: `capability: "publication"` results in the
  publication scope set in the authorization URL. No `capability` results
  in the readonly scope set.
- `adapter.beginOAuth`: scope array includes publication scopes when
  capability is `"publication"`.
- `lmsConnectionsComplete` scope-merge path:
  - Existing active connection + publication intent + new grant with
    publication scopes + matching `upstreamAccountIdentifier` = scopes
    merged (set-union), existing `connectionId` returned, `tokenRef`
    swapped to the new bundle, `consentOutcome: "widened"`, no second
    `lms.connectionCreated` audit event.
  - New grant omits `refresh_token` = the prior refresh token is carried
    forward into the merged bundle (never dropped).
  - New grant includes a replacement `refresh_token` = the replacement is
    stored.
  - Mismatched `upstreamAccountIdentifier` = refused with the distinct
    plain-language error, existing connection and old `tokenRef`
    unchanged.
  - `store()` of the merged bundle fails = widen aborts, existing
    connection still points at the valid old `tokenRef`.
  - Connection `update()` fails = new bundle orphaned/inert, existing
    connection usable, no duplicate connection.
  - No existing connection = new connection created as before (unchanged),
    `consentOutcome: "created"`.
  - Existing active connection already carrying every publication scope =
    already-authorized branch, no token swap, no write,
    `consentOutcome: "alreadyAuthorized"`.
  - Non-`active` existing connection = not widened; surfaced as
    reconnect-required.
  - Consumed/expired/replayed/mismatched state = coerced to the single
    `lms.invalidOAuthState`.
- OAuth state store: `issue` persists `intent`; `peek` and the binding
  expose it; `consume` enforces `expectedIntent` when supplied; TTL and
  single-use remain enforced.
- Duplicate-connection guard: two completions for the same (teacher,
  provider) target the same deterministic `connectionId`; exactly one
  active connection exists after either ordering.
- Integration test: full begin/complete cycle with the capability
  selector, asserting exactly one connection document with the widened
  scope set after consent.

**Browser testing requirements.**

The existing integration tests cover this phase. The Phase 4 browser
certification exercise B6 ("first publish triggers a genuine incremental
consent for the coursework scopes; previously granted readonly scopes
are preserved") is the definitive browser proof.

**Backend verification requirements.**

After Phase 2 is merged: `npm --prefix platform/functions test` passes,
`npm --prefix app run verify` passes. The connection scope-merge path
can be verified manually in an emulator session if desired, but formal
emulator-bound verification is Phase 4.

**Completion criteria.**

- `lmsConnectionsBegin` accepts `capability: "publication"` and routes
  the scope set to the adapter.
- `adapter.beginOAuth` selects the publication scope set when requested.
- `lmsConnectionsComplete` merges scopes into the existing connection
  when an active connection exists and new scopes are granted. No second
  connection is created.
- Mismatched `upstreamAccountIdentifier` is refused.
- The prior refresh token is carried forward when Google omits one.
- Exactly one connection document exists after widening (no duplicate).
- No token, Google email, or account id crosses the callable boundary.
- All new and existing tests pass.
- `npm --prefix app run verify` passes.

**Phase 2 commit boundaries.** Phase 2 lands as one reviewable server
commit plus one thin client-wiring commit, in this order:

1. **Commit 2a - OAuth state intent binding.** Additive `intent` on the
   in-process and Firestore state stores, the binding type, and consume;
   store tests. No behavior change to existing flows (intent defaults to
   initial connect). Independently reviewable and green.
2. **Commit 2b - begin/adapter scope selection.** `capability` on
   `LmsConnectionsBeginRequest`, the neutral selector on the provider
   `beginOAuth` input, and the adapter scope-set selection. Existing
   connect flow byte-identical when `capability` is absent.
3. **Commit 2c - completion create/widen/refuse + token swap.** The
   intent-aware branch, identity revalidation, scope-union merge,
   refresh-token carry-forward, atomic tokenRef swap and old-ref local
   token-store delete (never a Google grant revocation),
   additive `consentOutcome`, and the additive `scopesUpdatedAt`. Server
   and integration tests.
4. **Commit 2d - client `beginConnection` capability param.** The thin
   `wire.ts` / `types.ts` extension so Phase 3 can request the publication
   capability. No visible client behavior until Phase 3.

Commits 2a-2c contain no client-visible change; 2d is inert until Phase 3
consumes it. Each commit is independently revertable by Functions redeploy
(2a-2c) or Hosting redeploy (2d).

**Browser certification checkpoint (deferred to Phase 4, exercised here in
the emulator).** Phase 2 is certified in unit and integration tests plus
an optional emulator walkthrough; genuine browser consent is a Phase 4
obligation and MUST NOT be claimed from mocks. The decisive Phase 4
browser observations for Phase 2's machinery are B6 (first publish
triggers a genuine incremental consent; previously granted readonly scopes
are preserved) and the §14 backend checks "connection scope set includes
the coursework scopes after consent; exactly one connection for the
teacher and provider; no duplicate." Add to the Phase 4 run an explicit
observation that a teacher who denies the incremental consent still holds
her original readonly connection intact and can still assign.

**Rollback safety.**

Functions redeploy reverts the scope extension. The existing connection
retains whatever scopes were granted, which is harmless. Client rollback
(Hosting redeploy) is not required for Phase 2 because no client-facing
behavior change is visible until Phase 3.

**Dependencies.** Phase 1 must be merged. PDR-030 must be ratified
(done 2026-08-06); the coursework scope expansion is authorized.

---

### Phase 3: Assign Dialog Extension

> **Phase 3 planning note (added when Phase 3 planning began).** Phase 3
> is now governed in detail by two Phase-3-specific documents that
> elaborate this section without changing it:
> `SPRINT_25_PHASE_3_DEFINITION.md` (scope-of-record) and
> `SPRINT_25_PHASE_3_ARCHITECTURAL_BLUEPRINT.md` (workflows, failure
> matrix, certification plan). A source review at Phase 3 planning time
> found that much of this phase is already built in the certified tree:
> the Assign dialog (`app/src/shell/surfaces/curriculum.ts`) already
> carries LMS link detection (`createListClassLinks`), the per-row topic
> selector wired to `lmsClassesListTopics`, the off-by-default "Also
> publish to Google Classroom" toggle, the confirm-time
> createDraft/publish/publishAssignment lifecycle, a dialog-level
> in-flight submit lock, and the `summarizeOutcomes` confirmation
> read-back. The genuine remaining Phase 3 work is narrower than a
> from-scratch build: (1) pass a client-stable per-row `attemptNonce` on
> the publish call (currently omitted, so the Phase 1 completed-attempt
> guard cannot function); (2) the insufficient-scope incremental consent
> handoff and single automatic re-issue (currently absent); (3) reconnect
> routing for an inactive-connection outcome; (4) the assignment
> detail-view retry entry point; and (5) hardened outcome mapping so a
> thrown callable error maps to "did not succeed." The client seams and
> types already carry `attemptNonce`, `capability`, `consentOutcome`, and
> `errorCode`. Phase 3 changes no server file. Where this note and the
> task list below differ in emphasis, the Phase 3 definition and blueprint
> govern; the task list below remains accurate as the target behavior.

**Objective.** Add the topic selector and opt-in publish toggle to
LMS-linked `active` class rows in the Assign dialog. Wire topic fetch,
confirm-time publication call, confirmation read-back, and retry entry
point. Provide the existing publication and topics seams to the Assign
surface per the ADR. The dialog remains one dialog throughout.

**Why this phase exists.** This is the teacher-facing surface. All prior
phases built and tested the server machinery. Phase 3 wires the client
to that machinery, making the publish workflow visible and exercisable
by a teacher.

**Reuse vs. modify.**

| Component | Status |
|---|---|
| `createLmsCallables` (publish, topics seams) | Reused. Provided to Assign surface from its current location in `wire.ts`. |
| `createAssignmentsCallables` | Reused unchanged. |
| `createListClassLinks` | Reused unchanged. |
| `createBrowserOAuthHandoff` | Reused unchanged. |
| Assign dialog (the surface file) | Extended: per-row topic selector and publish toggle for LMS-linked active rows. |
| `WorkspaceDeps` type | Extended: LMS publication seam injected at entry point. |
| `app/src/index.ts` entry point | Extended: wires publication seam to Assign surface. |
| Assignment detail view | Extended: retry entry point for failed publications. |
| Settings surface | Unchanged. No publish affordance added there (ADR §3.3). |

**Files expected to change.**

- The Assign dialog surface file (location determined by reading the
  current curriculum surface tree at implementation time).
- `app/src/shell/surfaces/workspace.ts` (inject publication seam into
  `WorkspaceDeps`).
- `app/src/shell/surfaces/curriculum.ts` (thread seam to Assign dialog).
- `app/src/index.ts` (wire the publication seam at entry point using
  existing callable bindings from `wire.ts`).
- Assignment detail surface (retry entry point).
- Possibly `app/src/settings/integrations/types.ts` (if the `capability`
  field added in Phase 2 requires a type update to the callable
  interface).

**Major implementation tasks.**

1. **Row LMS-link detection.** The Assign dialog already receives a list
   of classes. Thread `createListClassLinks` into the dialog so each
   class row can be augmented with its `linkId` and `lmsClassId` if the
   class is LMS-linked and `active`. This read happens when the dialog
   opens; it is a single Firestore query already implemented in
   `createListClassLinks`. Rows without a matching link show no LMS
   controls (absent, not disabled).

2. **Topic selector.** For each LMS-linked `active` row, call
   `lmsClassesListTopics({ linkId })` as the dialog opens. Populate the
   topic selector from the response. Prefill with the teacher's
   last-used topic for that class (stored in teacher preferences, or
   from local state if no preference exists). Topic fetch failure
   degrades to an empty selector; the toggle and assigning remain
   functional. Topic fetch runs concurrently with any other dialog-open
   data loads; it does not block dialog rendering.

3. **Publish toggle.** Add the "Also publish to Google Classroom" toggle
   to each LMS-linked `active` row, off by default. Toggle state is
   per-row and not remembered across dialog opens (off by default,
   always, per §5 UX rules of the definition).

4. **Confirm-time publication.** On confirm:
   a. Create and publish the authoritative LyfeLabz assignment through
      `assignmentsCreateDraft` then `assignmentsPublish` for every
      selected class. This is unchanged from the certified path.
   b. For each selected LMS-linked row with the publish toggle on, mint
      one `attemptNonce` for that row's action (§2.1) and call
      `lmsAssignmentsPublish({ assignmentId, linkId,
      lyfelabzAssignmentUrl, lmsTopicId?, attemptNonce })`. The
      `lyfelabzAssignmentUrl` is derived from the existing launcher URL
      contract. The same nonce is reused for the insufficient-scope
      re-issue in step c and for any transparent client re-dispatch; it is
      not re-minted per HTTPS call. Disable the confirm control while any
      row's publish call is in flight (§2.2 submit lock).
   c. If the publish call reports `lms.insufficientScope` (a non-terminal
      outcome, §2.7), run the incremental consent handoff using
      `beginConnection({ providerId, redirectUri, capability:
      "publication" })` and the existing `createBrowserOAuthHandoff`. On
      grant, re-issue the publish call once with the same nonce. If the
      re-issue fails for any non-scope reason, treat it as a publication
      failure.
   d. Map both a graceful `status: "failed"` response and a thrown
      callable error (deadline or transport, §2.3) to the same "did not
      succeed" per-row outcome. Collect per-row outcomes (succeeded /
      failed / skipped).

5. **Confirmation read-back.** Per row with a publish toggle on, display
   one of:
   - "The LyfeLabz assignment was scheduled. Publishing to Google
     Classroom succeeded."
   - "The LyfeLabz assignment was scheduled. Publishing to Google
     Classroom did not succeed."

   The LyfeLabz assignment is authoritative in either case. No stack
   trace, no administrator reference, no PII.

6. **Retry entry point.** On the assignment detail view for a class
   whose publication did not succeed, expose a retry control. Retry
   calls `lmsAssignmentsPublish` with the same `assignmentId` and
   `linkId`, a fresh nonce (§2.1), and the original `lyfelabzAssignmentUrl`.
   The retry control is disabled while its call is in flight (§2.2 submit
   lock). A successful retry updates the row's confirmation state.

7. **No Settings surface change.** The publication seam is provided to
   the Assign surface from its location in `wire.ts`. No publish toggle
   or topic selector is added to Settings > Integrations.

**Unit testing requirements.**

- Row augmentation: an LMS-linked `active` class row exposes the topic
  selector and toggle; a non-LMS row does not.
- Topic fetch failure degrades gracefully; toggle remains usable.
- Toggle defaults to off.
- On confirm with toggle off: `lmsAssignmentsPublish` is not called.
- On confirm with toggle on: `lmsAssignmentsPublish` is called after
  `assignmentsPublish` completes.
- Insufficient-scope response triggers incremental consent flow and
  re-issues the publish call.
- Confirmation reads back "succeeded" or "did not succeed" per row.
- Retry calls `lmsAssignmentsPublish` with a fresh nonce without
  re-issuing `assignmentsCreateDraft` or `assignmentsPublish`.
- Non-LMS rows are unchanged throughout.

**Browser testing requirements.**

The full browser certification is Phase 4. In Phase 3, after
implementing the dialog extension, manually verify in an emulator-bound
session that:
- The dialog opens and the LMS row shows the topic selector and toggle.
- Topic fetch returns topics from the adapter (now live from Phase 1).
- Confirming with toggle on calls the publish callable.
- The confirmation displays the correct outcome line.

This is pre-certification spot verification, not the formal browser
certification run.

**Backend verification requirements.**

After Phase 3 is merged: `npm --prefix app run verify` passes. No
formal emulator-bound verification until Phase 4.

**Completion criteria.**

- LMS-linked `active` rows show topic selector and publish toggle; other
  rows are unchanged.
- Confirm-time publication calls `lmsAssignmentsPublish` for toggled rows.
- Confirmation read-back names the LMS-side outcome per row.
- Retry entry point is present on the assignment detail view for failed
  publications.
- No publish affordance is added to Settings > Integrations.
- No Google-specific concept appears on the teacher surface or in any
  DOM attribute.
- All unit tests pass. `npm --prefix app run verify` passes.

**Rollback safety.**

Hosting redeploy removes the Assign row affordances. Assignments already
published remain valid. The dialog reverts to non-publishing behavior.
All prior `lmsAssignmentPublications` records and `lmsPublicationRef`
values remain valid and are simply not re-read by the reverted code.

**Dependencies.** Phases 1 and 2 must be merged.

---

### Phase 4: Certification and Verification

**Objective.** Execute the browser certification plan (blueprint §13)
and backend verification plan (blueprint §14) as one continuous genuine
run. Produce the Sprint 25 completion and certification report within
the claim boundary defined by the definition §9.

**Why this phase exists.** Sprint 25 is not complete until both
certifications pass. The browser certification plan (B1-B12) exercises
the full teacher workflow from OAuth sign-in through publication,
failure injection, and retry. The backend verification confirms every
write, pointer, audit event, and security invariant. Phase 4 is the
formal proof.

**Reuse vs. modify.**

| Component | Status |
|---|---|
| All implementation from Phases 1-3 | Unchanged. |
| Google Classroom API test double | Configured for certification scenarios. |
| Emulator Suite | Running at certification time. |
| Historical debugging artifact ("Cert Class 2B8") | Clear before certification per Sprint 24B §11 recommendation. |

**Files expected to change.**

- `docs/platform/SPRINT_25_FINAL_CERTIFICATION_REPORT.md` (created).
- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` (PDR-030 inserted on
  ratification).

**Major implementation tasks.**

1. **Pre-certification setup.** Clear the historical debugging artifact
   from the emulator per Sprint 24B §11. Confirm the emulator starts
   cleanly. Confirm the Google Classroom API test double is configured
   to respond to `createCourseWork`, `listCourseTopics`, and to simulate
   an injected upstream failure for scenario B9.

2. **Execute browser certification.** Run scenarios B1-B12 in sequence
   as one continuous genuine run. No auth injection. No Firestore
   patching. No direct callable invocation. Record observations.

3. **Execute backend verification.** For the exact assignment and class
   under test, verify:
   - Callable ledger (correct sequence and count of callable invocations).
   - Connection scope set (includes publication scopes after B6).
   - Exactly one connection (no duplicate).
   - Publication records (`succeeded` for B7/B10, `failed` for B9).
   - Mirror pointer set on success, absent before.
   - Audit chain: one `lms.assignmentPublished` per success, one
     `lms.publishFailed` per failure, correctly ordered.
   - Zero `secretmanager.googleapis.com` access in the Functions debug log.
   - No Google email, account id, student name, connection id, or token
     in any record, audit payload, or log line.

4. **Produce certification report.** Author
   `SPRINT_25_FINAL_CERTIFICATION_REPORT.md` with observed results for
   B1-B12, backend verification evidence, security and privacy
   verification, and the claim boundary consistent with the definition
   §9 (certifies the workflow in the certified environment; does not
   present test-double behavior as production certification; does not
   claim Google OAuth verification is complete).

**Unit testing requirements.** None added in Phase 4. All unit tests
from Phases 1-3 must be green before certification begins.

**Browser testing requirements.** The complete B1-B12 certification
scenario table from the blueprint §13.

**Backend verification requirements.** The complete checklist from the
blueprint §14.

**Completion criteria.**

- All B1-B12 observations are PASS.
- All backend verification items are confirmed.
- Zero Secret Manager access.
- No PII in any surface, record, payload, or log.
- `SPRINT_25_FINAL_CERTIFICATION_REPORT.md` is authored.
- Sprint 25 is declared complete and certified (within the claim
  boundary of the definition §9).

**Rollback safety.** Phase 4 writes no code. Rollback of any prior
phase is still available.

**Dependencies.** Phases 1, 2, and 3 must be merged and green.

---

## 4. Recommended Implementation Order

```
Phase 1 (Adapter Go-Live)
  - Implement adapter methods
  - Unit test adapter
  - Review and merge

Phase 2 (Incremental Consent and Scope Widening)
  - Extend connections-begin, adapter.beginOAuth, connections-complete
  - Unit test scope selection and scope-merge
  - Review and merge

Phase 3 (Assign Dialog Extension)
  - Wire seams to Assign surface
  - Add row controls
  - Unit test dialog behavior
  - Spot verify in emulator session
  - Review and merge

Phase 4 (Certification and Verification)
  - Execute B1-B12
  - Execute backend verification
  - Author certification report
  - Declare complete
```

This order matches the blueprint's four-stage sequence (§15) and the
general LyfeLabz engineering workflow (implement, unit test, browser
test, backend verification, documentation, commit). Each phase's risk
is contained: server work is proven before client work begins, and
OAuth flow is proven before teacher-facing affordances depend on it.

---

## 5. Estimated Commit Boundaries

Each boundary is independently reviewable and rollback-safe. A commit
may be split into multiple smaller commits within the same phase at the
implementer's discretion, provided each commit still leaves the test
suite green.

| Commit | Phase | Contents |
|---|---|---|
| 25-1 | 1 | `adapter.listClassTopics` live. Adapter unit tests for listClassTopics. |
| 25-2 | 1 | `adapter.publishAssignment` live. Adapter unit tests for publishAssignment. Orphan log path in callable. |
| 25-3 | 2 | `lmsConnectionsBegin` capability extension. `adapter.beginOAuth` scope selection. Callable unit tests. |
| 25-4 | 2 | `lmsConnectionsComplete` scope-merge path. Scope-merge unit tests. Integration test for incremental consent cycle. |
| 25-5 | 3 | Seam provision to Assign surface. `WorkspaceDeps` type extension. Entry point wiring. |
| 25-6 | 3 | LMS row detection and topic selector. Row unit tests. |
| 25-7 | 3 | Publish toggle, confirm-time publication call, insufficient-scope consent path. Unit tests. |
| 25-8 | 3 | Confirmation read-back and retry entry point. Unit tests. Pre-cert spot verify. |
| 25-9 | 4 | Certification report. `LYFELABZ_PLATFORM_DECISIONS.md` PDR-030 insertion (on ratification). |

---

## 6. Risk Assessment

| Phase | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| 1 | Transport not wired at test time (fixture transport path not exercised for new methods) | Low | Medium | Existing fixture transport pattern covers both methods; follow `listClassRoster` exactly. |
| 1 | Upstream error shapes for `createCourseWork` not fully mapped | Low | Low | `translateUpstreamError` already handles all known status codes; test explicitly for 403 with coursework-scope signal. |
| 2 | Widening identity revalidation (new code, not a reused helper) adds an unexpected token-store read | Medium | Low | Resolve the existing token bundle through the token store to read its `upstreamAccountIdentifier` and compare it against the new grant identity at complete time; this is one additional async read, not a blocking concern. |
| 2 | Scope-merge update in Firestore overwrites other connection fields | Low | High | Use a field-level Firestore update, not a full document set, for the scope merge. |
| 3 | Topic fetch blocks dialog open if slow | Medium | Medium | Run topic fetch concurrently with dialog rendering; degrade to empty selector on failure. |
| 3 | `linkId` not available in the Assign dialog at row-augmentation time | Low | Medium | `createListClassLinks` returns `{ linkId, classId, providerId, lmsClassId }` already; match by `classId` to augment the class row. |
| 3 | Consent popup blocked by the teacher's browser | Low | Low | The existing popup-blocked error path in `createBrowserOAuthHandoff` already handles this; surface a plain-language "please allow popups" message. |
| 4 | Google Classroom API test double does not faithfully simulate the insufficient-scope 403 | Medium | Medium | Configure the test double explicitly for scenario B9; document the exact error shape it must return to trigger the incremental consent path. |

---

## 7. Testing Strategy

### Pyramid

```
Unit tests (each phase)
  Adapter methods, callable extensions, dialog row logic, seam wiring.
  Fast, isolated, no emulator required.

Integration tests (Phase 2)
  Full begin/complete/scope-merge cycle through the callable chain.
  Emulator-bound or in-memory Firestore fake.

Pre-certification spot verification (Phase 3)
  Manual emulator-bound session. Not a formal certification run.
  Confirms dialog opens correctly and publish call reaches the adapter.

Browser certification (Phase 4)
  One continuous genuine run. No shortcuts. B1-B12.
  The definitive proof of the teacher workflow.

Backend verification (Phase 4)
  Emulator-bound read of Firestore state, callable ledger, and Functions log.
  Confirms invariants hold after the browser certification run.
```

### What tests prove vs. do not prove

Unit and integration tests prove that individual code paths produce
correct outputs. They do not prove that the teacher workflow works end
to end in the certified environment. Browser certification proves the
workflow. Backend verification proves the invariants. These three levels
are kept distinct per the definition §9.

---

## 8. Certification Checkpoints

| Checkpoint | Phase | What is checked | Claim if passed |
|---|---|---|---|
| CP1 | 1 | Adapter unit tests pass; callable test suite green. | Adapter methods reach the live upstream through the certified callable. |
| CP2 | 2 | Scope-merge unit tests and integration test pass. | Incremental consent adds scopes to the existing connection without a second connection. |
| CP3 | 3 | Dialog unit tests pass; pre-cert spot verify confirms dialog opens and publish call fires. | Assign dialog surfaces LMS controls for LMS-linked rows and fires the publish callable on confirm. |
| CP4 | 4 | B1-B12 PASS; backend verification confirmed; zero Secret Manager access; no PII. | Sprint 25 workflow is certified end to end in the certified environment. |

CP4 is the Sprint 25 completion certification. CP1-CP3 are engineering
checkpoints, not completion certifications.

---

## 9. Final Recommendation: Begin with Phase 1

**Begin with Phase 1 (Adapter Go-Live).**

The first phase to implement is the live adapter methods for
`listClassTopics` and `publishAssignment`. This is the correct first
step for the following reasons:

1. **Lowest risk.** The callable, Firestore collection, rules, audit
   vocabulary, transport interface, and transport production binding all
   already exist. Phase 1 replaces two stubs with live transport calls.
   There is no client change, no OAuth change, and no new Firestore
   schema.

2. **Unlocks everything else.** Phases 2, 3, and 4 all depend on a live
   adapter. Phase 3's spot verify and Phase 4's browser certification
   both require the adapter to reach the real upstream. Phase 1 is the
   prerequisite the blueprint names first.

3. **Independently testable.** The adapter methods can be exercised
   entirely through the existing fixture transport. The `lmsClassesListTopics`
   and `lmsAssignmentsPublish` callables are already in place to host
   the tests. No new callable, no new collection, and no new client code
   is required to prove Phase 1 complete.

4. **Matches blueprint sequencing.** The blueprint §15 names "Stage 1 -
   Adapter go-live (server only)" as the first stage explicitly because
   it is the lowest-risk starting point.

Begin with commit 25-1: implement `adapter.listClassTopics` and its
unit tests. Follow immediately with commit 25-2: implement
`adapter.publishAssignment`, its unit tests, and the orphan-log path
in the callable. Review and merge both before beginning Phase 2.

*End of implementation plan.*
