# Sprint 25 Phase 3 Definition - Assign Dialog Publication Integration

Status: Proposed. Scope-of-record for Sprint 25 Phase 3. This document
defines what Phase 3 does and does not attempt. The how-and-in-what-order
layer is `SPRINT_25_PHASE_3_ARCHITECTURAL_BLUEPRINT.md`. Phase 3 is the
client-facing phase of Sprint 25. It connects the already-certified
publication infrastructure (Phase 1 adapter go-live, Phase 2 incremental
consent and scope widening) to the single canonical Assign dialog.

The Sprint 25 architecture established in Phases 1 and 2 is frozen. Phase
3 introduces no new architecture. It wires an existing, completed server
contract into an existing, mostly-built teacher surface.

Companion documents:
- `SPRINT_25_DEFINITION.md` (sprint scope-of-record)
- `SPRINT_25_ARCHITECTURAL_BLUEPRINT.md` (sprint blueprint; §4-§13)
- `SPRINT_25_IMPLEMENTATION_PLAN.md` (§3 Phase 3; §2 resolved decisions)
- `SPRINT_25_PHASE_1_COMPLETION_REPORT.md` (adapter go-live, callable control flow)
- `SPRINT_25_PHASE_2_COMPLETION_REPORT.md` (incremental consent, scope widening)
- `PDR_030_LMS_ASSIGNMENT_PUBLICATION.md` (authorizing decision, ratified)
- `ADR_LMS_PUBLICATION_SURFACE_RECONCILIATION.md` (single origin is Assign)
- `ASSIGN_EXPERIENCE.md` (the single canonical assignment workflow, §5, §7, §8)

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level
break, per repository standard.

---

## 1. Context

Sprint 25 Phases 1 and 2 are complete and reviewed (not yet browser
certified; that is Phase 4).

- Phase 1 replaced the two stubbed Google Classroom adapter methods
  (`listClassTopics`, `publishAssignment`) with live upstream calls, and
  restructured the `lmsAssignmentsPublish` callable's internal control
  flow so `lms.insufficientScope` is non-terminal, a written `succeeded`
  record is never clobbered, and a completed-attempt guard short-circuits
  a repeat of the same attempt.
- Phase 2 extended the certified OAuth connection lifecycle
  (`lmsConnectionsBegin`, `adapter.beginOAuth`, `lmsConnectionsComplete`)
  so the coursework publication scopes can be granted through incremental
  consent, widening the existing connection instead of minting a second
  one. It also added the thin, inert client wiring (`capability` on
  `beginConnection`, `consentOutcome` on the complete result).

The entire server contract Phase 3 consumes therefore already exists and
is unchanged by Phase 3:

- `lmsAssignmentsPublish` accepts `{ assignmentId, linkId,
  lyfelabzAssignmentUrl, title?, instructions?, lmsTopicId?, attemptNonce? }`
  and returns `{ publicationId, status: "succeeded" | "failed",
  lmsAssignmentId?, lmsAssignmentUrl?, errorCode?, errorMessage? }`.
- `lmsClassesListTopics({ linkId })` returns live topics.
- `lmsConnectionsBegin({ providerId, redirectUri, capability?:
  "publication" })` and `lmsConnectionsComplete` perform incremental
  consent and scope widening.

A substantial portion of the Assign dialog client is also already built
in the certified tree and is reused, not rebuilt. See §5.

## 2. Objectives

Phase 3 is responsible only for the following, and nothing else:

1. Integrate publication into the one Assign dialog as an optional
   extension of assigning, never as a separate workflow.
2. Publication destination selection: the opt-in "Also publish to Google
   Classroom" toggle on each LMS-linked `active` class row.
3. Google Classroom topic selection on those same rows.
4. Publication retry after incremental consent: when the first publish
   returns `lms.insufficientScope`, run incremental consent and re-issue
   the publish exactly once with the same attempt nonce.
5. Teacher-facing publication status: name the per-row publication
   outcome on the confirmation surface, and expose a retry entry point on
   the assignment detail view for a publication that did not succeed.

## 3. Scope

In scope:

- Passing a client-stable, per-row `attemptNonce` on every publish call
  for a row, so the Phase 1 server-side completed-attempt guard can
  function and so an automatic re-issue is not counted as a new attempt.
- The insufficient-scope incremental consent handoff and single
  automatic re-issue, wired from the Assign confirm path into the
  existing `beginConnection` / `openOAuth` / `completeConnection` seams.
- Mapping the certified publish outcomes and thrown callable errors onto
  calm, provider-neutral teacher-facing status lines.
- The retry entry point on the assignment detail view for a class whose
  publication did not succeed, calling `lmsAssignmentsPublish` again with
  a fresh nonce and never re-running the LyfeLabz assignment lifecycle.
- A reconnect prompt that routes an inactive-connection publish outcome
  to the existing account-level reconnect flow, without blocking the
  LyfeLabz assignment.
- The client wiring that provides the existing publish, topics,
  class-links, and OAuth-handoff seams to the Assign surface and to the
  assignment detail surface.

## 4. Non-goals and hard boundaries

Phase 3 must not implement any of the following. Each is either a Sprint
25 non-goal (definition §4) or belongs to a different phase or a later
decision record:

- Submission synchronization in any direction.
- Grade synchronization or grade passback.
- Google Classroom coursework updates or edits after publication.
- Google Classroom coursework deletion.
- Any roster synchronization change.
- Any new Firestore collection.
- Any new audit event kind or new audit vocabulary.
- Any publication control, toggle, or topic selector in Settings.
  Settings > Integrations stays account-level only (ADR §3.3, PDR-030a).
- Any new OAuth behavior. Phase 3 consumes the Phase 2 incremental
  consent machinery exactly as delivered; it requests no new scope and
  changes no consent mechanics.
- Any change to the `lmsAssignmentsPublish`, `lmsClassesListTopics`,
  `lmsConnectionsBegin`, or `lmsConnectionsComplete` server callables.
  Phase 3 is client-only wiring on top of the frozen server contract.
- Any second publish surface, publish wizard, Google Classroom settings
  panel, or LMS-specific dialog.
- Any redesign of the Assign workflow. Phase 3 completes the additive
  affordances the Assign Experience already reserved; it changes nothing
  else about assigning.
- Automatic, background, or scheduled retry or publication. Retry is
  teacher-initiated only.

## 5. UX principles

The defining principle is inherited unchanged from `SPRINT_25_DEFINITION.md`
§5 and `ASSIGN_EXPERIENCE.md`:

**The teacher performs one action: Assign this lesson. Publishing to
Google Classroom is one optional delivery destination for an assignment
she already made. It is never a separate workflow.**

Derived Phase 3 rules:

- The topic selector and publish toggle appear only on rows for classes
  that are LMS-linked and `active`. On every other row they are absent,
  not shown as disabled controls.
- The publish toggle is off by default, every time the dialog opens.
- The teacher never leaves the Assign dialog to publish and never visits
  Settings to publish.
- The LyfeLabz assignment is authoritative and is created and published
  before any publication is attempted. A publication that does not
  succeed never rolls back, blocks, or blames.
- Every teacher-facing line is calm and provider-neutral: no stack trace,
  no callable name, no raw Google error, no OAuth terminology, no student
  PII, no Google email, no token.

## 6. What already exists versus what Phase 3 adds

Phase 3 is narrower than a from-scratch build because the certified tree
already carries most of the Assign dialog publication surface. This
inventory is authoritative; an implementation that rebuilds a component
listed as "exists" is out of specification.

### Already implemented (reuse unchanged)

- LMS link detection in the Assign dialog via the injected
  `createListClassLinks` reader, cached per teacher and keyed by
  `classId` (`app/src/shell/surfaces/curriculum.ts`).
- Per-row Google Classroom topic selector, populated from
  `lmsClassesListTopics({ linkId })`, degrading to an empty selector on
  fetch failure, prefilled from the teacher's last-used topic held in
  session preferences.
- The "Also publish to Google Classroom" per-row toggle (`publishToLms`),
  off by default.
- The confirm-time per-class lifecycle `runAssignmentLifecycle`:
  `assignmentsCreateDraft` then `assignmentsPublish` then
  `lmsAssignmentsPublish`, with independent per-class outcomes and the
  invariant that a publication failure never disturbs the authoritative
  LyfeLabz assignment.
- A dialog-level in-flight submit lock (`submissionInFlight`) that
  disables the confirm control and sets `aria-busy` for the duration of
  the lifecycle (§2.2 client submit-lock, at the confirm level).
- The confirmation read-back `summarizeOutcomes`, which already emits
  "Publishing to Google Classroom succeeded" and "Publishing to Google
  Classroom did not succeed" per the Assign Experience §7.
- The client seams and types already carry the Phase 3 fields:
  `attemptNonce` on the publish input, `capability` on
  `beginConnection`, `consentOutcome` on the complete result, and
  `errorCode` on the publication outcome.

### Phase 3 additions (the genuine remaining work)

1. **Per-row attempt nonce.** `runAssignmentLifecycle` currently mints
   one nonce for the whole confirm and uses it only to derive the
   `assignmentId`; it does not pass `attemptNonce` to
   `lmsAssignmentsPublish`, so the server mints a fresh random nonce on
   every call and the Phase 1 completed-attempt guard cannot function on
   any re-issue or retry. Phase 3 mints one `attemptNonce` per LMS-linked
   row action and passes it on the initial call and its automatic
   re-issue.
2. **Insufficient-scope incremental consent and single re-issue.** The
   current publish catch treats every failure identically. Phase 3
   inspects the resolved outcome for `errorCode ===
   "lms.insufficientScope"`, runs the incremental consent handoff
   (`beginConnection({ capability: "publication" })`, `openOAuth`,
   `completeConnection`), and re-issues the publish once with the same
   nonce. A second insufficient-scope outcome stops; it does not loop.
3. **Reconnect routing.** An inactive-connection publish outcome
   (`lms.connectionNotActive` / `lms.connectionNotFound`) is mapped to a
   calm reconnect prompt that reuses the existing account-level reconnect
   flow. The LyfeLabz assignment still proceeds.
4. **Retry entry point on the assignment detail view.** A publication
   that did not succeed exposes a teacher-initiated retry on the class's
   assignment detail view, calling `lmsAssignmentsPublish` again with a
   fresh nonce and never re-running `assignmentsCreateDraft` or
   `assignmentsPublish`.
5. **Outcome mapping hardening.** Both a graceful `status: "failed"`
   response and a thrown callable error (deadline or transport) map to
   the same "did not succeed" teacher-visible line and offer retry.

## 7. Success criteria

Phase 3 is successful when all of the following hold in unit and
emulator spot verification (the formal browser certification is Phase 4):

- A verified teacher, assigning a lesson to an LMS-linked `active` class,
  sees the topic selector and the off-by-default publish toggle only on
  LMS-linked `active` rows, and neither control on any other row.
- On confirm with the toggle on, the client passes a client-stable
  per-row `attemptNonce` to `lmsAssignmentsPublish`.
- A first publish that returns `lms.insufficientScope` triggers the
  incremental consent handoff and a single automatic re-issue with the
  same nonce. A grant produces a successful re-issue; a cancellation or a
  repeated insufficient-scope outcome stops with a calm message and no
  loop.
- The confirmation surface names the per-row publication outcome; the
  LyfeLabz assignment exists regardless of publication outcome.
- A publication that did not succeed offers a retry on the assignment
  detail view; the retry never re-creates or re-publishes the LyfeLabz
  assignment.
- No publish or topic affordance appears in Settings.
- No Google email, student name, Google account id, token, callable
  name, or raw Google error appears on any teacher surface or in any DOM
  attribute.
- `npm --prefix app run verify` passes; the app test suite is green
  except for the pre-existing curriculum-manifest drift documented in the
  Phase 1 and Phase 2 reports, which is independent of Sprint 25.

## 8. Certification posture

Phase 3 is proven by engineering validation (unit tests and an
emulator-bound spot verification that the dialog opens, topics load, the
publish call fires, consent is triggered on insufficient scope, and the
confirmation reads back the outcome). Phase 3 does not perform or claim
the genuine browser certification; that is Phase 4 (blueprint §13,
decisive observations B6 and B8). No test-double behavior is presented as
production certification, and no claim is made that Google OAuth
verification is complete or that production rollout is authorized.

## 9. Rollback posture

Phase 3 is client-only. Rollback is a Hosting redeploy of the prior
known-good bundle. The dialog reverts to its pre-Phase-3 publish behavior
(topic selector and toggle present but without the nonce, consent, and
retry wiring). All `lmsAssignmentPublications` records and
`lmsPublicationRef` values written before rollback remain valid and are
simply not re-read by the reverted client. Rollback deletes no document.

*End of Phase 3 definition.*
