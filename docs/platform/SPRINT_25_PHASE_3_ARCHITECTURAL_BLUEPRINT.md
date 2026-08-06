# Sprint 25 Phase 3 - Architectural Blueprint

Status: Proposed. Governing implementation document for Sprint 25 Phase 3
(Assign Dialog Publication Integration).

Extends `SPRINT_25_PHASE_3_DEFINITION.md` with the UX review findings, the
Assign workflow, the publication workflow, the incremental consent and
retry workflows, the topic-selection workflow, the failure handling
matrix, and the certification and verification plans. The definition is
the scope-of-record; this blueprint is the how-and-in-what-order layer.

Phase 3 introduces no new architecture. The Sprint 25 architecture in
`SPRINT_25_ARCHITECTURAL_BLUEPRINT.md`, `PDR_030_LMS_ASSIGNMENT_PUBLICATION.md`,
`ADR_LMS_PUBLICATION_SURFACE_RECONCILIATION.md`, and the resolved
implementation decisions in `SPRINT_25_IMPLEMENTATION_PLAN.md` §2 is
frozen. This blueprint connects the completed publication infrastructure
to the existing Assign experience and specifies the minimum UX to do so.

Style: no em dashes. Use " - " (spaced hyphen).

---

## 1. Purpose

Phases 1 and 2 built and reviewed the entire server contract for
publishing an existing LyfeLabz assignment to a linked Google Classroom
course, including the live adapter write, the topics read, and the
incremental consent that widens the existing connection. Phase 3 is the
teacher-facing phase: it wires that contract into the one Assign dialog
so a teacher can opt a class in to publication, pick a topic, grant the
coursework scopes once at first publish, see the outcome, and retry a
failure - all without leaving the workflow she already uses to assign.

Much of this surface is already built in the certified tree. This
blueprint is therefore a connect-and-complete plan, not a build-from-zero
plan. It states precisely what exists, what is missing, and where each
missing piece belongs.

## 1.1 Guiding principle

Every Phase 3 decision should reduce the number of decisions a teacher
makes while assigning. The only new teacher decisions are one opt-in
toggle and one optional topic per LMS-linked row, plus, exactly once, a
single incremental consent prompt at first publish. When two
implementation options are otherwise equivalent, the option that asks the
teacher for fewer inputs, fewer confirmations, and fewer detours wins.

## 2. Terminology

Phase 3 authorizes no new teacher-facing labels. It uses exactly the
Sprint 25 blueprint §2 vocabulary:

| Term | Where it appears |
|---|---|
| Assign | The single workflow. Unchanged. |
| Also publish to Google Classroom | The opt-in publish toggle on an LMS-linked class row. |
| Google Classroom topic | The topic selector on an LMS-linked class row. |
| Publishing to Google Classroom succeeded | Confirmation line on success. |
| Publishing to Google Classroom did not succeed | Confirmation line on failure. |

Two additional calm lines Phase 3 needs, consistent with the same voice
and introducing no provider or OAuth terminology beyond the Google
Classroom display name already authorized:

| Situation | Line |
|---|---|
| Consent cancelled or not granted | "Publishing to Google Classroom needs your permission. You can try again from the assignment." |
| Connection needs reconnect | "Google Classroom needs to be reconnected in Settings. Your assignment was scheduled." |

Internal engineering identifiers, callable names, Firestore field names,
audit event kinds, and provider error codes are never rendered to the
teacher.

## 3. Surface ownership

Unchanged from the Sprint 25 blueprint §3 and the reconciliation ADR.

- **Assign dialog owns:** the publish toggle, the topic selector, the
  per-row attempt nonce, the confirm-time publication call, the
  insufficient-scope incremental consent handoff and single re-issue, the
  confirmation read-back, and the reconnect prompt.
- **Assignment detail view owns:** the retry entry point for a class
  whose publication did not succeed.
- **Settings > Integrations owns:** account-level connection management
  only (connected account, status, reconnect, disconnect). It exposes no
  publish affordance and no topic selector. The reconnect prompt in the
  Assign dialog routes the teacher to this existing Settings flow; it does
  not add a publish control there.

## 4. UX review findings

The Assign dialog (`app/src/shell/surfaces/curriculum.ts`) already
implements most of the publication surface. The review below is the basis
for the "minimum UX necessary" requirement.

### 4.1 Where publication already appears (reuse, do not rebuild)

- **Where publication appears:** on each LMS-linked `active` class row
  inside the one Assign dialog, as the "Also publish to Google Classroom"
  toggle. This is correct and unchanged.
- **Where class selection belongs:** the class rows themselves. Every
  class the teacher teaches is a row, selected by default. LMS-linked
  state is derived from the certified `lmsClassLinks` reader
  (`createListClassLinks`), matched by `classId`. Rows that are not
  LMS-linked show neither the topic selector nor the toggle. This is
  correct and unchanged.
- **Where topic selection belongs:** the per-row topic selector on
  LMS-linked `active` rows only, populated from `lmsClassesListTopics`.
  This is correct and unchanged.
- **Where publication status belongs:** the confirmation surface names
  the per-row outcome after the lifecycle resolves (`summarizeOutcomes`).
  This is correct and unchanged for the success and failed lines.
- **When publication occurs:** after the authoritative LyfeLabz
  assignment reaches `published`, as a side effect, once per confirm for
  each toggled LMS-linked row. This ordering is correct and unchanged.

### 4.2 What is missing (the Phase 3 work)

1. **No attempt nonce is passed.** `runAssignmentLifecycle` mints one
   nonce per confirm and uses it only to derive the `assignmentId`. The
   `lmsAssignmentsPublish` call omits `attemptNonce`, so the server mints
   a fresh random nonce per call. The Phase 1 completed-attempt guard and
   the intended idempotency of an automatic re-issue therefore cannot
   function.
2. **No insufficient-scope handling.** The publish catch treats every
   failure identically as "did not succeed." It never inspects
   `errorCode === "lms.insufficientScope"`, never runs incremental
   consent, and never re-issues the publish. This is the core missing
   workflow.
3. **No reconnect routing.** An inactive-connection outcome is not
   distinguished from a generic failure, so the teacher is told
   "did not succeed" with no path to reconnect.
4. **No retry entry point.** The assignment detail view carries no LMS
   publication state and no retry control. The confirmation line names a
   failure but offers no way to act on it later.
5. **Outcome mapping is not hardened.** A thrown callable error (deadline
   or transport) is swallowed to `lmsSucceeded: false`, which is
   acceptable but must be made intentional and covered by tests so it is
   never treated as a hard stop or a success.

### 4.3 Minimum UX recommendation

Add no new controls beyond what the Assign Experience already reserves.
The toggle and topic selector are sufficient destination and topic
controls. The only genuinely new teacher-visible surfaces are:

- The one-time incremental consent prompt (the existing OAuth popup),
  shown only at first publish.
- The calm consent-cancelled and reconnect lines in §2, shown only when
  the corresponding condition occurs.
- The retry control on the assignment detail view, shown only for a class
  whose publication did not succeed.

No control is added that would introduce ambiguity or a second decision.
The teacher still decides only where to assign and, optionally, whether a
given class also publishes.

## 5. Assign workflow

Unchanged from `ASSIGN_EXPERIENCE.md` §4-§8 and Sprint 25 blueprint §4.
Restated for completeness with Phase 3's additive behavior in italics.

1. The teacher opens Assign on a lesson. The dialog shows her class rows,
   all selected by default.
2. For any row whose class is LMS-linked and `active`, the row carries
   the topic selector (prefilled from her last-used topic) and the "Also
   publish to Google Classroom" toggle (off by default). Other rows are
   unchanged.
3. The teacher configures date, release time, points, and, per LMS-linked
   row, optionally turns the toggle on and picks a topic.
4. She confirms once. *The confirm control is disabled and marked
   `aria-busy` for the duration (existing submit lock).*
5. For every selected class, LyfeLabz creates and publishes the
   authoritative assignment (`assignmentsCreateDraft` then
   `assignmentsPublish`).
6. For each selected LMS-linked row with the toggle on, LyfeLabz publishes
   a pointer to Google Classroom as a side effect. *Phase 3 mints one
   `attemptNonce` per such row and passes it. If the publish returns
   `lms.insufficientScope`, the incremental consent handoff runs and the
   publish is re-issued once with the same nonce (§7).*
7. The confirmation names both outcomes per row: the LyfeLabz assignment
   was scheduled, and publishing to Google Classroom either succeeded or
   did not succeed.
8. If publication did not succeed, the teacher can retry from the
   assignment detail view for that class (§8).

## 6. Publication workflow

Where each piece lives, end to end, for one toggled LMS-linked row:

1. **Client, dialog open.** `createListClassLinks` yields the row's
   `linkId`, `providerId`, and `lmsClassId`; `lmsClassesListTopics({
   linkId })` populates the topic selector.
2. **Client, confirm.** The dialog runs the certified lifecycle
   (`createDraft` then `publish`) to produce the authoritative
   `assignmentId`. LMS publication is skipped for any class whose LyfeLabz
   assignment did not reach `published`.
3. **Client, publish call.** The dialog mints one `attemptNonce` for this
   row action and calls `lmsAssignmentsPublish({ assignmentId, linkId,
   lyfelabzAssignmentUrl, title, lmsTopicId?, attemptNonce })`. The
   `lyfelabzAssignmentUrl` is derived from the existing launcher URL
   contract (`window.location.origin + lesson.href`). Provider ids,
   upstream course ids, connection ids, and tokens are never passed; the
   server resolves them.
4. **Server (frozen, Phases 1-2).** The callable authorizes the
   assignment, link, and connection; resolves the token server-side;
   calls the adapter to create the coursework item; writes a `succeeded`
   or `failed` record; sets `lmsPublicationRef` on success; emits the
   reserved audit event. `lms.insufficientScope` is returned non-terminal
   with no record and no audit event.
5. **Client, outcome.** The dialog maps the resolved outcome (or a thrown
   callable error) to a per-row status and, on the last row, calls
   `summarizeOutcomes` to render the confirmation.

The client passes only LyfeLabz identifiers, the LyfeLabz assignment URL,
the optional topic id, and the attempt nonce. Everything else is
server-resolved.

## 7. Incremental consent workflow

This is the core Phase 3 addition. It is wired entirely from the Assign
confirm path using the Phase 2 machinery and the existing browser OAuth
handoff. It performs exactly one automatic re-issue and never loops.

Sequence for one toggled LMS-linked row:

1. Teacher chooses a Classroom-linked class (toggle on) and confirms.
2. The client calls `lmsAssignmentsPublish(...)` with the row's
   `attemptNonce`.
3. The resolved outcome is `{ status: "failed", errorCode:
   "lms.insufficientScope", publicationId }`. No `failed` record and no
   `lms.publishFailed` audit event were written (Phase 1 §2.7). This is
   not a publication failure; it is a request for permission.
4. The client launches incremental publication consent:
   - `beginConnection({ providerId: row.link.providerId, redirectUri,
     capability: "publication" })` (Phase 2 selects the coursework scope
     set; `include_granted_scopes` preserves readonly scopes).
   - `openOAuth({ authorizationUrl, redirectUri, expectedState: state })`
     opens the existing same-origin popup and awaits the code.
   - `completeConnection({ providerId, code, state, redirectUri })`
     widens the existing connection (Phase 2 identity revalidation,
     scope-union merge, token swap). The result carries `consentOutcome`
     in `{ "widened", "alreadyAuthorized", "created" }`.
5. **On consent success** (`completeConnection` resolves): the client
   re-issues `lmsAssignmentsPublish(...)` exactly once, with the same
   `attemptNonce`. Because the connection scopes now include the
   coursework scopes, the re-issue proceeds to the upstream write.
   - If the re-issue succeeds, the row outcome is "succeeded" and the flow
     continues normally.
   - If the re-issue returns `lms.insufficientScope` again (the teacher
     granted consent but not the coursework scope, so the merged scope set
     did not gain it and Phase 2 returned `alreadyAuthorized`), the client
     **stops**. It does not reopen OAuth and does not enter a consent
     loop. The row outcome is "did not succeed" with the calm
     consent-needed line (§2). Retry remains available from the detail
     view.
   - If the re-issue fails for any non-scope reason, it is a publication
     failure (§9) and retry is offered.
6. **On consent cancellation** (`openOAuth` rejects with `cancelled` or
   `popup-blocked`, or the teacher denies): the client **stops**. It does
   not re-issue the publish. The row outcome is "did not succeed" with the
   consent-needed line (for `popup-blocked`, a "please allow popups" line
   reusing the existing handoff error path). Retry remains available.

Invariants:

- The LyfeLabz assignment is fully assigned regardless of publication or
  consent outcome. Consent runs only after the authoritative assignment
  has reached `published`.
- Exactly one automatic re-issue per confirm action for a row. The same
  `attemptNonce` is reused for the re-issue so the server treats it as the
  same logical attempt, not a new one (§2.1 of the implementation plan).
- No silent scope escalation: consent is requested only when a publish
  actually returns `lms.insufficientScope`, and only for the coursework
  capability.

## 8. Retry workflow

Retry is teacher-initiated only. Phase 3 introduces no automatic,
background, or scheduled retry.

- Retry is exposed on the assignment detail view for a class whose
  publication did not succeed. The detail surface receives the minimal
  seam it needs: the publish callable, the `linkId`, and the
  `lyfelabzAssignmentUrl` for that assignment.
- Retry calls `lmsAssignmentsPublish({ assignmentId, linkId,
  lyfelabzAssignmentUrl, lmsTopicId?, attemptNonce })` with a **fresh**
  nonce. A retry is a distinct logical action and a distinct ledger record
  (implementation plan §2.1). It never re-runs `assignmentsCreateDraft` or
  `assignmentsPublish`; the LyfeLabz assignment already exists and is
  authoritative.
- The retry control is disabled while its call is in flight (the same
  in-flight submit-lock pattern the confirm control uses).
- A retry that itself returns `lms.insufficientScope` runs the same
  single-consent-then-one-re-issue handoff as §7. It does not loop.
- A successful retry updates the detail view's publication status to
  succeeded.

Because Google Classroom `courseWork.create` has no upstream idempotency
key, a retry after a genuinely uncertain original response (timeout) may
create a second coursework item. This residual is accepted and documented
(implementation plan §2.3, §2.6); it is not reconciled in Sprint 25.

## 9. Topic-selection workflow

The topic selector should feel native to LyfeLabz, not like a Google
Classroom control.

- **Default topic behavior.** The selector is prefilled with the
  teacher's last-used topic for that class, held in session preferences
  (`sessionPreferences.lmsTopicId`). When the prefilled topic id is not
  present in the freshly loaded topic list, the selection falls back to
  "No topic" rather than silently selecting a stale id.
- **No-topic behavior.** "No topic" is a valid, first-class selection.
  When chosen, the publish call omits `lmsTopicId` and the coursework item
  is created without a topic. Publishing never requires a topic.
- **Topic loading.** Topics load as the dialog opens, concurrently with
  other dialog-open data; topic fetch never blocks dialog rendering or the
  confirm control. While loading, the selector shows a non-selectable
  loading option and resolves to the real list (or empty) on completion.
- **Unavailable topics.** A topic fetch failure degrades to an empty
  selector ("No topic" only). The toggle and assigning remain fully
  usable. The teacher is never shown a provider error; the absence of
  topics is silent and non-blocking.
- **Retry behavior.** Topic fetch is cached per `linkId` for the session.
  A subsequent dialog open for the same class reuses the cached list. A
  failed fetch caches an empty list for the session; a fresh, explicit
  reload of topics is not a Sprint 25 feature and is out of scope. The
  teacher can still publish with "No topic," and can pick a topic on a
  later dialog open once the transient condition clears and the cache is
  reset (page reload).

## 10. Publication status UX

Every state maps to one calm, provider-neutral line. No provider
terminology, no OAuth terminology, no raw Google error, no callable name.

| State | Teacher sees | Retry offered |
|---|---|---|
| Publication succeeded | "The LyfeLabz assignment was scheduled. Publishing to Google Classroom succeeded." | No |
| Publication failed | "The LyfeLabz assignment was scheduled. Publishing to Google Classroom did not succeed." | Yes, on the detail view |
| Retry available | The detail view shows a plain retry control for that class. | It is the retry |
| Publication skipped (toggle off) | No publication line; only the LyfeLabz scheduling confirmation. | Not applicable |
| Publication not attempted (LyfeLabz assignment did not reach `published`) | "LyfeLabz assignment was not created. Google Classroom publication was not attempted." | Not applicable; the teacher re-assigns |
| Consent cancelled or not granted | "Publishing to Google Classroom needs your permission. You can try again from the assignment." | Yes, on the detail view |
| Connection needs reconnect | "Google Classroom needs to be reconnected in Settings. Your assignment was scheduled." | After reconnect, from the detail view |

The multi-class aggregate line already produced by `summarizeOutcomes`
(succeeded for N, did not succeed for M) is retained.

## 11. Failure handling

For every failure, the teacher message, retry availability, and whether
the assignment proceeds. The assignment always proceeds; a publication
failure never rolls it back.

| Failure | Surfaced how | Teacher message | Retry | Assignment proceeds |
|---|---|---|---|---|
| Classroom disconnected / connection not active (`lms.connectionNotActive`, `lms.connectionNotFound`) | Thrown callable error inspected client-side | Reconnect line (§2), routes to Settings reconnect | Yes, after reconnect, from detail view | Yes |
| Insufficient scope, first publish (`lms.insufficientScope`) | Resolved outcome `errorCode` | None yet - runs incremental consent and one re-issue (§7) | Automatic single re-issue; then detail-view retry | Yes |
| Insufficient scope after consent (re-issue still insufficient) | Resolved outcome `errorCode` | Consent-needed line (§2) | Yes, from detail view; no auto reopen | Yes |
| Provider unavailable / upstream call failed (`lms.upstreamCallFailed`) | Resolved `status: "failed"` | "did not succeed" | Yes | Yes |
| Timeout / uncertain response | Resolved `failed` (Phase 1 abort timeout) or thrown callable error | "did not succeed" | Yes (may duplicate upstream; documented residual) | Yes |
| Permission denied, non-scope 403 (`lms.upstreamAuthorizationFailed` path) | Resolved `status: "failed"` | "did not succeed" | Yes | Yes |
| Class link removed / not active / mismatch / superseded (`lms.linkNotActive`, `lms.linkNotFound`, `lms.linkClassMismatch`, `lms.linkSuperseded`) | Thrown callable error inspected client-side | "did not succeed" (the class is no longer linked; no reconnect implied) | Yes, but will fail until the link is restored; the teacher re-imports the class | Yes |
| Topic removed upstream | Resolved `status: "failed"` from the coursework write | "did not succeed" | Yes (the teacher can pick "No topic" or another topic on re-assign) | Yes |
| Duplicate retry / accidental double dispatch of the same action | Server completed-attempt guard on the same nonce; client in-flight submit lock | Same success line; no second coursework item | Not applicable | Yes |

Client classification rule (implementation plan §2.3 correction 2): a
resolved `{ status: "failed" }` and a thrown callable error both map to
"did not succeed" and both offer retry. A thrown error is never treated as
a hard stop or a success. The distinction between a reconnect-class error
and a generic failure is made by inspecting the sanitized error code the
callable surfaces; the exact code-to-line mapping is confirmed against
`assignments-publish.ts` at implementation time and never rendered to the
teacher.

## 12. Files Phase 3 touches (client only)

Phase 3 changes no server file. It touches only client wiring and the two
consuming surfaces. Exact file set confirmed at implementation time; the
anchors below are the discovered locations.

- `app/src/shell/surfaces/curriculum.ts` - add the per-row `attemptNonce`
  in `runAssignmentLifecycle`, the insufficient-scope incremental consent
  handoff and single re-issue, the reconnect routing, and the hardened
  outcome mapping. The topic selector, toggle, link detection, submit
  lock, and `summarizeOutcomes` are already present.
- `app/src/shell/surfaces/workspace.ts` and/or the curriculum surface
  deps - thread the OAuth handoff (`openOAuth`), `redirectUri`, and the
  `beginConnection` / `completeConnection` callables to the Assign confirm
  path. The `IntegrationsDeps` seam already carries all of these.
- `app/src/assignments/detail/*` - add the retry entry point for a failed
  publication (new detail-surface seam for the publish callable, `linkId`,
  and `lyfelabzAssignmentUrl`; new retry UI state and control).
- `app/src/index.ts` - provide the seams to the surfaces from the existing
  `wire.ts` bindings. No duplicate callable binding is created (ADR §3.2).
- No change to `app/src/settings/integrations/wire.ts` or `types.ts`
  callable shapes; the `attemptNonce`, `capability`, and `consentOutcome`
  fields already exist there. No publish affordance is added to Settings.

## 13. Browser certification plan (Phase 4 executes; Phase 3 spot-verifies)

Executed in Phase 4 as one continuous genuine run through the real
teacher shell against the Emulator Suite, exercising real Google
Classroom through the real HTTPS transport (the Sprint 24B certification
model). No auth injection, no Firestore patching, no direct callable
invocation. Phase 3 performs an emulator-bound spot verification of the
happy path and the consent trigger only; the full table is Phase 4.

| ID | Observation | Expected |
|----|-------------|----------|
| P3-1 | Successful publication: toggle on, topic chosen, confirm; coursework item appears; confirmation reads "succeeded." | PASS |
| P3-2 | Publication with a topic: the coursework item is filed under the chosen topic. | PASS |
| P3-3 | No topic: "No topic" selected; the coursework item is created with no topic; publish still succeeds. | PASS |
| P3-4 | Incremental consent success: first publish returns insufficient scope, a genuine consent prompt appears, readonly scopes are preserved, the single re-issue succeeds. | PASS |
| P3-5 | Incremental consent cancellation: the teacher closes the consent popup; the publish is not re-issued; the calm consent-needed line shows; the LyfeLabz assignment is intact; retry is offered on the detail view. | PASS |
| P3-6 | Repeated insufficient scope: consent completes but the coursework scope is not granted; the single re-issue returns insufficient scope again; the client stops, shows the consent-needed line, and does not reopen OAuth. | PASS |
| P3-7 | Provider outage: injected upstream failure; the assignment is intact; confirmation reads "did not succeed"; retry is offered. | PASS |
| P3-8 | Retry: from the detail view, a retry with a fresh nonce succeeds and updates the status; the LyfeLabz lifecycle is not re-run. | PASS |
| P3-9 | Disconnected Classroom: connection not active at publish time; the reconnect line shows and routes to Settings; the assignment is intact. | PASS |
| P3-10 | Stale topic: the prefilled last-used topic id is absent from the freshly loaded list; the selector falls back to "No topic" rather than selecting a stale id. | PASS |
| P3-11 | Non-LMS row: shows neither the topic selector nor the toggle (absent, not disabled). | PASS |
| P3-12 | Privacy: no Google email, student name, Google account id, token, callable name, or raw Google error on any teacher surface or DOM attribute. | PASS |

P3-4 and P3-6 are the decisive Phase 3 observations: consent is genuine
and the re-issue is bounded to exactly one, with no loop.

## 14. Verification plans (kept distinct)

The four levels of validation are kept separate and must not be
conflated.

- **Browser certification (Phase 4).** The genuine continuous run through
  the real teacher shell (§13, and the sprint blueprint §13 B1-B12). It
  proves the teacher workflow in the certified environment. Phase 3 does
  not claim it.
- **Backend verification (Phase 4).** Emulator-bound reads for the exact
  assignment and class under test, per sprint blueprint §14: callable
  ledger (`assignmentsCreateDraft` and `assignmentsPublish` precede
  `lmsAssignmentsPublish`; `lmsConnectionsBegin` / `lmsConnectionsComplete`
  appear once for the consent; no duplicate publish for one toggle-on
  confirm; the automatic re-issue reuses the nonce and does not add a
  ledger row); the widened connection scope set with exactly one
  connection; `succeeded` and `failed` publication records; the
  `lmsPublicationRef` mirror; the audit chain (one `lms.assignmentPublished`
  per success, one `lms.publishFailed` per real failure, none for the
  pre-consent insufficient-scope path); zero Secret Manager access; and no
  PII or token in any record, payload, or log.
- **Emulator verification (Phase 3 spot check).** After the dialog wiring
  lands, an emulator-bound session confirms the dialog opens, topics load
  from the live adapter, confirming with the toggle on fires the publish
  call with the nonce, an insufficient-scope outcome triggers the consent
  handoff, and the confirmation reads back the outcome. This is
  pre-certification spot verification, not a formal certification run.
- **Production rollout verification (out of sprint).** Google OAuth
  verification for the coursework scopes, production Secret Manager
  posture, and the deployment runbook checklist. These gate rollout only
  and are tracked separately (definition §10). Phase 3 does not touch
  them.

## 15. Rollback strategy

Phase 3 is a Hosting redeploy of the client bundle. Reverting removes the
nonce, consent-handoff, reconnect-routing, and detail-view retry wiring;
the dialog returns to its pre-Phase-3 publish behavior. Assignments
already published remain valid. No `lmsAssignmentPublications`,
`lmsConnections`, `assignments`, `auditEvents`, `lmsClassLinks`, or
`enrollments` document is deleted. `lmsPublicationRef` values written
before rollback remain valid and are simply not re-read by the reverted
client. Because Phase 3 changes no server file, no Functions redeploy is
part of a Phase 3 rollback.

## 16. Provider abstraction guardrails

Phase 3 does not weaken provider neutrality.

- No client surface names `googleClassroom` in a persisted contract.
  Provider ids are opaque strings from the row's `link.providerId`, passed
  through certified callables.
- The only capability selector the client sends is the provider-neutral
  `capability: "publication"` (Phase 2). No raw Google scope string is
  named client-side.
- Teacher-facing copy references Google Classroom by display name only.
- The provider registry, adapter, roster reconciliation engine, and every
  server callable are unmodified.

*End of Phase 3 blueprint.*
