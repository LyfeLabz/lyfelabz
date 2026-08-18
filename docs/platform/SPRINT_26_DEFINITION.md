# Sprint 26 Definition - LMS UX Hardening

Status: Proposed. Scope-of-record for Sprint 26. This document defines
what Sprint 26 does and does not attempt, grounded in the read-only
Sprint 26 architecture and UX investigation and in the final
product/scope decisions that followed it. The how-and-in-what-order
implementation layer will be a companion blueprint produced at the start
of implementation. This document does not authorize implementation.

Companion / precedent documents:
- `SPRINT_25_DEFINITION.md` (immediate structural precedent)
- `SPRINT_25_COMPLETION_REPORT.md` (certified, committed, closed foundation)
- `SPRINT_25_B13_ARCHITECTURE_REASSESSMENT_AND_CLOSURE.md` (B13 PASS WITH LIMITATION, not reopened)
- `SPRINT_24B_FINAL_CERTIFICATION_REPORT.md` (production-certified connection foundation)
- `ASSIGN_EXPERIENCE.md` (the single canonical assignment workflow)
- `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`
- `PDR_030_LMS_ASSIGNMENT_PUBLICATION.md` (PDR-030 series, including the
  incremental-consent and identity-revalidation decisions)
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-019, PDR-020, PDR-030)

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level
break, per repository standard.

---

## 1. Status

Proposed. Not started. No implementation, no code change, no test
change, no deployment is authorized by this document.

Sprint 25 (LMS Assignment Publication) is complete, certified,
committed, and closed. Its final B13 disposition remains PASS WITH
LIMITATION and is not reopened by Sprint 26. Nothing in the read-only
Sprint 26 investigation contradicted the Sprint 25 closure.

Sprint 26 is a hardening sprint layered on top of Sprint 25. It adds no
new LMS capability. It improves the teacher experience around
capabilities that already work.

## 2. Sprint title

**Sprint 26: LMS UX Hardening.**

The repository evidence gathered during the read-only investigation
supports formally defining Sprint 26 under this title.

## 3. Background - why Sprint 26 exists

The core Google Classroom integration is done and certified:

- initial connection,
- class import,
- `needsSetup` activation,
- roster synchronization,
- durable credential custody with automatic token refresh,
- assignment publication (Sprint 25), including incremental consent for
  the coursework scope, topic selection, publication retry, and the
  `lms.identityMismatch` hard reject on connection widening.

Sprint 26 is not a new LMS feature sprint. It exists to harden the
teacher experience around those certified capabilities. During Sprint
25 certification (notably the B11/B12/B13 sequence), several UX rough
edges surfaced that are not defects in the load-bearing security
architecture but do degrade the teacher experience.

The central product principle:

**The durable LMS connection owns the Google identity.**

The teacher should experience Google Classroom as an integrated
extension of LyfeLabz, not as a separate account system that repeatedly
asks them to choose identities, understand OAuth, or diagnose technical
authorization states.

Sprint 26 improves six things, and nothing else:

1. Google account continuity (the headline change).
2. Assignment workflow state correctness.
3. Google Classroom recovery UX.
4. Narrowly scoped connection-health UX.
5. Minimal consent-flow observability.
6. One known Settings spacing defect.

## 4. Evidence from the pre-definition architecture investigation

Each Sprint 26 workstream is anchored to concrete repository evidence
confirmed during the read-only investigation. File paths and line
anchors below are the evidence-of-record and are the starting points for
implementation; they are not a promise that no neighboring code moves.

### 4.1 Account continuity - the `login_hint` is deliberately blanked

`platform/functions/src/lms/providers/google-classroom/adapter.ts`
builds the Google authorization URL with `login_hint` present but
intentionally emptied and then deleted from the parameter string:

```
login_hint: "",
// login_hint is intentionally empty and stripped so the parameter
// string is deterministic in tests but Google still sees an
// omitted value.
params.delete("login_hint");
```

The mechanism to steer Google toward a specific account already exists
in the exact place Sprint 26 needs it. Today it is unconditionally
blank. Incremental publication authorization therefore does not
proactively prefer the Google identity already associated with the
durable LMS connection. This is the single most impactful Sprint 26
change.

### 4.2 Identity protection is already load-bearing and reactive

`platform/functions/src/lms/connections-complete.ts` hard-rejects a
mismatched upstream identity on the scope-widening path
(`lms.identityMismatch`, connections-complete.ts around line 236). The
completion handler carries a `consentOutcome` of `"created"`,
`"widened"`, or `"alreadyAuthorized"` and widens an existing active
connection's scope set only after the returned identity is validated
against the identity already stored on the connection. This protection
is sound and must remain load-bearing. It is reactive: it rejects the
wrong account at completion time but does nothing to steer Google toward
the right account at begin time. Sprint 26 adds the proactive steering
(4.1) without weakening this reactive validation.

### 4.3 The provider contract already carries a capability selector

`platform/functions/src/lms/connections-begin.ts` already accepts an
optional provider-neutral `capability?: "publication"` selector, and
`platform/functions/src/lms/providers/provider.ts` `beginOAuth` already
threads intent into the adapter. The begin contract is the correct and
smallest place to add a narrowly scoped optional account hint. No new
callable is required.

### 4.4 Assignment Defect 2.A - draft-create vs publish failure conflation

`assignmentsCreateDraft` can succeed while `assignmentsPublish` fails.
The teacher-facing surface can then report that the LyfeLabz assignment
was not created, which is factually wrong because the durable LyfeLabz
draft exists. The detail surface already distinguishes a Google
Classroom publication failure line
(`app/src/assignments/detail/detail.ts` around line 1733,
`"Publishing to Google Classroom did not succeed."`) but the outcome
model does not cleanly separate "nothing was saved" from "the LyfeLabz
assignment was saved but Classroom publication did not complete." The
outcome representation, not merely one string, needs to carry enough
information to distinguish these states truthfully.

### 4.5 Assignment Defect 2.B - hydrated drafts can falsely light "Assigned"

`app/src/shell/surfaces/curriculum.ts` drives the "✓ Assigned" lesson
card badge from `sessionPersistedSlugs`. On surface-mount hydration
(curriculum.ts around lines 475 to 483) it calls `markPersisted` for
every entry returned by the registry list, guarded only by a stale
comment asserting that "Only entries that reached `published` status are
ever registered by the lifecycle path, so this is a truthful signal."
That assumption predates Sprint 25 draft creation. Curriculum hydration
marks every hydrated assignment as persisted regardless of status, so a
stranded `draft` can now light the "Assigned" badge. The badge signal is
wrong; the underlying draft functionality is legitimate.

### 4.6 Identity-mismatch teacher UX is generic

The backend correctly rejects a different Google identity, but the
teacher-facing path does not clearly explain that specific condition. It
is not visibly distinguished from a generic permission failure. The
teacher needs plain-language recovery guidance ("please use the same
Google account you connected") without exposure of `lms.identityMismatch`,
scopes, tokens, or upstream identifiers.

### 4.7 Connection recovery dead-end in Settings

`app/src/settings/integrations/integrations.ts` renders connection state
as a binary: `status.textContent = active ? "Connected" : "Not
connected"` (around line 221), and when `active` it offers only a
`Disconnect` button (around lines 246 to 259). Yet the types and wiring
already model a richer state:
`app/src/settings/integrations/types.ts` includes
`"reconnectRequired"`, and `app/src/settings/integrations/wire.ts`
already reads a `rawStatus === "reconnectRequired"`. Meanwhile the
assignment flow can tell the teacher that Google Classroom "needs to be
reconnected in Settings" (`detail.ts` around line 1736), but Settings
shows the connection as Connected with a Disconnect action and no direct
Reconnect path. This is a concrete dead-end: the teacher is sent to
Settings to reconnect and finds no reconnect action.

### 4.8 Observability asymmetry

Scope widening currently has structured logging but no durable audit
event; identity mismatch has neither a durable audit trail equivalent to
the successful outcomes. Existing LMS audit vocabulary follows the
`lms.<camelCase>` convention (for example `lms.rosterSynchronized`,
`lms.upstreamAuthorizationFailed`). B13 diagnosis therefore relied
disproportionately on observing Google's UI and manipulating live
fixtures rather than on LyfeLabz-controlled durable evidence.

### 4.9 Settings spacing defect

The shared/base button rule applies a top margin that
`.shell-settings-category-button`
(`app/src/shell/surfaces/settings.ts` around line 264) does not reset,
creating excessive vertical space around the Connected Services
category. Because Sprint 26 already touches Google connection UX in
Settings, this localized spacing correction belongs here.

## 5. Product principles

- **The durable LMS connection owns the Google identity.** LyfeLabz
  supplies the connected identity to Google using Google's supported
  account-continuity mechanism, and independently validates the identity
  Google returns.
- **Steering is not enforcement.** `login_hint` is a UX steering
  mechanism, not an identity-security boundary. The completion-time
  identity validation is the boundary and is never weakened, removed,
  bypassed, or conditionally skipped.
- **Semantic truthfulness.** Teacher-facing outcome messages must be
  true. A saved draft is never described as "not created."
- **Calm software.** The teacher never needs to reason about scopes,
  refresh tokens, OAuth failures, or account identifiers. Recovery
  actions are obvious and singular.
- **Integrate rather than duplicate.** Sprint 26 extends existing
  callables, contracts, surfaces, and audit vocabulary. It builds no
  parallel surface, no diagnostic console, and no generic OAuth
  framework.
- **Provider neutrality (PDR-019h).** Only the smallest provider-neutral
  contract change needed lands in the vendor-neutral core. Google's
  `login_hint` is converted only inside the Google-specific adapter.
- **Privacy is not widened (PDR-019k).** No student PII, no upstream
  Google account identifier, no token, and no secret enters any teacher
  surface, audit payload, or log line.

## 6. In-scope work

Sprint 26 has eight in-scope workstreams:

- **A. Google account continuity.** Proactively prefer the durable
  connection's Google identity during incremental publication
  authorization, using Google's supported account-continuity mechanism
  (`login_hint`).
- **B. Preserve the identity-mismatch invariant.** Keep
  `lms.identityMismatch` a hard backend reject. Account hinting never
  replaces callback validation.
- **C. Assignment Defect 2.A.** Truthfully distinguish draft-create
  failure from publish failure from full success.
- **D. Assignment Defect 2.B.** A stranded draft must not light the
  "Assigned" lesson card. Draft functionality is preserved.
- **E. Identity-mismatch teacher UX.** Distinguish identity mismatch
  from generic permission failure, with plain-language recovery.
- **F. Connection / recovery UX.** Remove the Settings reconnect
  dead-end and give an obvious action-needed recovery path.
- **G. Minimal consent-flow observability.** Add PII-safe durable
  evidence for meaningful LyfeLabz-controlled consent outcomes.
- **H. Settings spacing defect.** Fix the Connected Services top-margin
  spacing, no broader redesign.

## 7. Detailed requirements per workstream

### 7.A Google account continuity (headline)

The current architecture protects Google identity reactively:

```
existing durable LMS connection
  -> incremental authorization occurs
  -> Google identity returned
  -> LyfeLabz compares returned upstream identity against the identity
     already associated with the connection
  -> lms.identityMismatch hard-rejects a mismatch before connection
     mutation
```

That protection is sound and must remain load-bearing. The weakness is
that incremental Google authorization does not proactively prefer the
Google identity already associated with the durable connection.

Intended Sprint 26 architecture:

```
existing durable LMS connection
  -> retrieve the Google identity associated with that connection
  -> when beginning incremental publication authorization, pass that
     identity to the Google OAuth authorization request using the
     appropriate Google-supported account hint
  -> Google is encouraged to continue with the already-connected account
  -> callback still independently validates the returned identity
  -> lms.identityMismatch remains a hard reject
```

Likely implementation shape (kept minimal; do not over-generalize the
provider abstraction):

1. Extend the OAuth begin contract with a narrowly scoped optional
   account hint. `connections-begin.ts` already carries the optional
   `capability` selector; the account hint is the natural sibling.
2. Obtain the existing connection's upstream identity during
   publication-intent begin.
3. Thread that value to the Google Classroom adapter through the
   provider-neutral `beginOAuth` contract.
4. Convert it to Google's `login_hint` only inside the Google-specific
   adapter (adapter.ts), replacing the currently blanked value with the
   supplied hint when present, and preserving the deterministic
   omitted-value behavior when absent.

Constraints:

- `login_hint` is a hint, not an enforcement boundary. Do not weaken,
  remove, bypass, or conditionally skip completion-time identity
  validation.
- The acceptance criteria must not claim Google can never display an
  account chooser. Google controls its own authorization UI.
- Preserve provider neutrality; do not create a generic OAuth
  identity-selection framework.

Privacy requirements (all mandatory):

- Never expose the upstream Google account identifier to the teacher.
- Never include it in audit payloads.
- Never intentionally log it.
- Never expose it to unrelated systems.
- Never place tokens or secrets into authorization diagnostics.

Phase 2 resolution (canonical). Phase 2 implemented the shape above and
resolved the account-identity resolution path and its fallback semantics:

- **Resolution path.** For a publication-intent begin only,
  `connections-begin.ts` locates the durable connection by its
  deterministic id (`lmsConnectionIdFor(teacherId, providerId)`), and,
  when that document is an active connection owned by the teacher for the
  provider, resolves its existing credential bundle transiently in memory
  through the established server-only token-store abstraction
  (`getLmsTokenStore().resolve(tokenRef)`). The bundle's
  `upstreamAccountIdentifier` becomes the provider-neutral `accountHint`;
  the Google adapter converts it to `login_hint`. The identifier is read
  only where already persisted and held only transiently in memory; it is
  never copied onto the connection document, never placed in the OAuth
  state record, never logged, never audited, and never returned to the
  client.
- **No side effects.** `resolve` is a pure read on both the in-process and
  Firestore stores (a single document read); it performs no token refresh,
  rotation, or mutation. Only `persistRefreshedCredential` mutates, and it
  is never called on this path. Account hinting therefore never triggers
  credential maintenance.
- **Fallback semantics (best-effort, steering-only).** The hint is
  optional and never load-bearing. Every absence or failure degrades to no
  hint rather than fabricating an identity or blocking authorization:
  initial connect performs no lookup at all; a publication begin with no
  active durable connection supplies no hint; a bundle-resolution failure
  or a corrupted bundle missing the required `upstreamAccountIdentifier`
  supplies no hint. A genuinely broken durable connection is never masked
  as healthy here: the completion handler independently re-resolves the
  bundle and returns `lms.connectionTokenResolutionFailed` for a broken
  connection, and completion-time identity revalidation still hard-rejects
  a wrong account (`lms.identityMismatch`). Begin degrades the optional
  hint rather than pre-empting the flow that can recover the connection.

### 7.B Preserve the identity-mismatch invariant

`lms.identityMismatch` must remain a hard backend rejection when
incremental authorization returns a Google identity different from the
one already associated with the durable LMS connection. Account hinting
must never replace callback validation.

Automated tests must continue proving that a mismatch:

- is rejected,
- does not overwrite the existing connection,
- does not mutate stored credentials incorrectly,
- does not widen the connection,
- leaves the existing connection intact and recoverable.

### 7.C Assignment workflow Defect 2.A - draft vs publish messaging

Fix the misleading state/message when `assignmentsCreateDraft` succeeds
but `assignmentsPublish` fails, which can currently report that the
LyfeLabz assignment was not created even though the durable draft
exists.

Sprint 26 must distinguish at least three product outcomes:

1. **Draft creation failed.** Nothing was successfully saved.
2. **LyfeLabz assignment saved, publication did not complete.** The
   assignment exists and can be recovered/retried.
3. **Publication completed successfully.** The intended workflow
   completed.

Requirements:

- The exact teacher-facing sentences are not fixed by this document.
  Implementation chooses concise language consistent with the existing
  teacher workspace. The requirement is semantic truthfulness.
- The outcome model must carry enough information to distinguish these
  states, rather than forcing multiple states through one misleading
  boolean.
- Existing multi-class, partial-success, publication, and retry
  semantics must be preserved.

Phase 3 resolution (canonical). The per-class `PerClassOutcome` in
`curriculum.ts` replaced the ambiguous `lyfelabzAssigned: boolean` with a
discriminated `lyfelabzState` of exactly three values, resolving the open
question in section 15:

- `draftFailed` - `assignmentsCreateDraft` failed; no durable LyfeLabz
  assignment exists for that class.
- `savedNotPublished` - the draft was created durably but
  `assignmentsPublish` did not complete; the assignment is recoverable
  through the certified draft-enumeration path and the assignment detail
  surface's publish action.
- `published` - the LyfeLabz assignment reached `published`.

`summarizeOutcomes` counts these states independently, so a
saved-but-not-published class is never reported as "not created", a genuinely
unsaved class is never reported as recoverable, and a published class is never
downgraded by another class's failure. Only `published` rows are eligible for
the optional Google Classroom publication line, which is unchanged.

### 7.D Assignment workflow Defect 2.B - "Assigned" card semantics

Establish this semantic rule:

> A lesson card should display "Assigned" only when the lesson has an
> assignment state that qualifies as successfully assigned according to
> the established published workflow. A stranded draft must NOT cause the
> card to display "Assigned."

Requirements:

- Correct the hydration path in `curriculum.ts` so `markPersisted` is
  driven by qualifying (published) status, not by mere presence in the
  hydrated registry. Retire the stale comment assumption noted in 4.5.
- Drafts must not disappear from the architecture. They may remain
  registered/available for appropriate draft recovery or viewing
  behavior. This fix corrects the badge signal only; it does not destroy
  legitimate draft functionality.
- Do not introduce cleanup tooling for historical stranded drafts.

Phase 3 resolution (canonical). The statuses that qualify a lesson card for
the "Assigned" badge are `published` and `closed`; `draft` does not qualify.
`curriculum.ts` gates the hydration-time `markPersisted` on
`qualifiesForAssignedBadge(status)`. `closed` qualifies because a closed
assignment was published and is still historically an assignment of that
lesson; the Active Assignments dashboard already treats a closed assignment as
a real (renderable) assignment (`isRenderableCard` admits `published` and
`closed`), and the View summary control already treats a non-draft as a
summary. Restricting the badge to `published` alone would have desynchronized
the lesson card from those surfaces and removed the badge from legitimately
closed assignments. A stranded `draft` still hydrates and remains available to
the View drafts control and the assignment detail surface; it simply no longer
lights the successful badge. The stale "only published entries are ever
registered" comment at the hydration site was corrected to describe this
actual invariant.

### 7.E Identity-mismatch teacher UX

Distinguish identity mismatch from generic permission failure in the
teacher-facing path. Communicate the concept in plain terms, for example
"Please use the same Google account you connected." Exact wording is
refined during implementation.

Do not expose: `lms.identityMismatch`, OAuth terminology, scopes,
tokens, or upstream account identifiers.

The teacher needs:

- a clear explanation,
- an obvious recovery action,
- confidence that their existing Google Classroom connection was not
  silently replaced.

Phase 4 resolution (canonical). Identity mismatch is classified at the
client consent boundary, not flattened into the generic decline. The
backend already hard-rejects a mismatched account at completion
(`lms.identityMismatch`); that throw reaches the client at the consent
completion step inside the shared publication module. Before Phase 4 the
consent handoff caught every throw alike and returned "permission not
granted". Phase 4 inspects only the stable sanitized code
(`IDENTITY_MISMATCH_CODE`) and returns a distinct `identityMismatch`
consent result, which `runPublicationAction` maps to a distinct
`PublicationActionResult` kind and `AssignmentLmsPublicationState` value.
Recovery is the existing same-nonce retry (the "Try again" control on the
detail surface, or reassigning from curriculum) - deliberately NOT a
Settings reconnect, because the durable connection is intact (the backend
rejects before any mutation). Both the Assign summary and the detail panel
render the same core instruction ("the same Google account you first
connected") with no OAuth term, error code, or account identifier, and
never imply the connection was replaced. Identity mismatch therefore does
NOT arm the Settings action-needed signal (§7.F): making Settings a
required destination for it would be misleading.

### 7.F Google Classroom connection / recovery UX

Remove the Settings reconnect dead-end (4.7). The intended teacher-facing
connection model is simple. States may conceptually resemble:

- Connected,
- Connected, action needed,
- Not connected.

Do not expose technical OAuth state names. The exact representation is
driven by what the architecture can reliably know (the
`reconnectRequired` signal already exists in the integrations types and
wiring).

Requirements:

- Teachers needing reconnection must have an obvious recovery action.
- An active-but-unhealthy connection must not look indistinguishable
  from a fully healthy connection when LyfeLabz already knows action is
  required.
- Identity mismatch must have specific recovery language (shared with
  7.E).
- Existing successful connection behavior remains simple.
- Do not turn Settings into a diagnostic console. Do not create
  unnecessary dialogs or multi-step flows. Keep scope narrow.

Phase 4 resolution (canonical). The "connected, action needed" state is
**session-local, not durable**, and this resolves the section 15 open
question. LyfeLabz has no durable "needs reauthorization" connection
field: the connection document status is only `active` or `revoked` (the
defined-but-never-written `stale` value notwithstanding), and the
`reconnectRequired` health verdict is computed per class-refresh and never
persisted on the connection. Rather than introduce durable
connection-health persistence (out of scope; would require a stop-and-
review), Phase 4 derives action-needed only from a condition LyfeLabz
actually observed this session: a publication attempt that returned the
connection-not-usable outcome (`reconnectRequired`). That observation is
recorded in an in-memory, uid-scoped, non-persisted client store (the same
posture as the publication retry-context store), read by the Settings
integrations surface through an injected `connectionRecovery` seam. The
three implemented connection states are:

- **Not connected** - no active connection (unchanged); offers Connect.
- **Connected** - active connection, no session-observed problem
  (unchanged); offers Disconnect.
- **Connected, action needed** - active connection for which LyfeLabz
  observed a reconnect-required outcome this session; offers a primary
  **Reconnect** action plus secondary Disconnect, with a calm recovery
  line. Source of truth: the session-local signal.

Reconnect reuses the certified begin/complete connect flow with the
initial scope set and never disconnects first, so the durable connection
is preserved if the teacher abandons reauthorization; a successful
reconnect clears the signal. Because the signal is session-local it is
honestly forgotten on reload; if the connection genuinely still needs
recovery, the next publication attempt re-arms it. Only `reconnectRequired`
arms the signal; identity mismatch never does (§7.E).

### 7.G Minimal consent-flow observability

Add minimal PII-safe observability sufficient to make future diagnosis
easier. At minimum, define appropriate PII-safe diagnostic/audit
evidence for:

- connection permissions successfully widened,
- connection widening rejected because the returned identity did not
  match the durable connection identity.

Requirements:

- Event names follow existing repository conventions (`lms.<camelCase>`,
  emitted through the canonical audit helper). Suggested working names,
  to be reconciled with convention at implementation:
  `lms.connectionScopeWidened` and a mismatch-rejection event such as
  `lms.connectionWideningRejected`. Final names are an implementation
  decision. Phase 1 finalized the names as `lms.connectionScopesWidened`
  (plural, reusing verbatim the existing structured-log signal name
  emitted at the same lifecycle point in `connections-complete.ts`, so a
  single vocabulary covers the widening outcome) and
  `lms.connectionWideningRejected`. The successful-widening payload
  carries only `{ providerId }`; the rejection payload carries only
  `{ providerId, reason: "identityMismatch" }`. Neither records any
  scope array, either Google identity, tokens, or PII.
- Audit/log payloads must NEVER contain: access tokens, refresh tokens,
  OAuth authorization codes, OAuth secrets, student PII, upstream Google
  account identifiers, or unnecessary provider-returned personal data.

Scope edit (mandatory): Do NOT make "abandoned OAuth begin" detection or
TTL-based consent-abandonment lifecycle tracking a required Sprint 26
feature. If implementation inspection later reveals an abandonment
signal already exists and exposing it safely is genuinely trivial, it
may be documented as OPTIONAL. Otherwise defer it. Sprint 26
observability remains minimal.

### 7.H Settings spacing defect

Fix the excessive vertical spacing around the Connected Services
category caused by the unreset base-button top margin on
`.shell-settings-category-button` (4.9).

Requirements:

- Fix the excessive spacing.
- Preserve established Settings hierarchy and the teacher-workspace
  visual system.
- Do not redesign the Settings page. Do not expand into general visual
  polish.

## 8. Teacher-facing experience Sprint 26 must produce

**Initial connection.** The teacher connects Google Classroom. LyfeLabz
establishes the durable connection and remembers the Google identity
associated with it. This workflow does not become more complicated.

**First publication requiring additional permission.** The teacher
creates an assignment and chooses Google Classroom publication. If Google
needs additional permission, LyfeLabz begins incremental authorization
using the Google identity already associated with the durable connection
as the account hint. The common experience should feel like "Allow
LyfeLabz to do one more thing with the Google Classroom account you
already connected," not "Choose which Google account LyfeLabz should
use."

**If Google still presents account selection.** Google may still display
its own chooser; that is outside LyfeLabz's direct control. If the
teacher selects another identity, LyfeLabz rejects it through the
existing identity-mismatch invariant, the existing connection remains
intact, and the teacher receives clear recovery language telling them to
continue with the same Google account they previously connected.

**Successful widening.** Once the additional permission is granted for
the correct identity, subsequent publication continues silently using
the durable connection, as certified in Sprint 25.

**Draft saved but Classroom publication fails.** The teacher is told the
LyfeLabz assignment was saved. The UI must not say the assignment was
never created. The teacher understands that Google Classroom publication
did not complete and that they can retry appropriately.

**Lesson-card state.** A draft alone must not make a lesson card appear
successfully Assigned. Published assignment state continues to drive the
successful assignment signal.

**Connection recovery.** If LyfeLabz knows the Google Classroom
connection requires teacher action, Settings presents a clear state and
an obvious next action. The teacher never needs to reason about scopes,
refresh tokens, or OAuth failures.

## 9. Security / privacy invariants

These invariants are load-bearing and are never weakened by Sprint 26:

- Completion-time identity validation remains the security boundary;
  `login_hint` is steering only.
- `lms.identityMismatch` remains a hard backend reject on connection
  widening.
- Server-only tokens (PDR-019e). Tokens never cross the callable
  boundary and never enter diagnostics.
- No student PII is read or written by any Sprint 26 path.
- No upstream Google account identifier is exposed to the teacher, placed
  in an audit payload, intentionally logged, or leaked to unrelated
  systems.
- No new token, secret, authorization code, or PII logging is
  introduced.
- Provider neutrality (PDR-019h): Google concepts live only in the Google
  adapter.

## 10. Preservation requirements

Sprint 26 must explicitly preserve, unchanged:

- existing Google Classroom initial connection behavior,
- existing class import behavior,
- `needsSetup` activation behavior,
- roster synchronization,
- durable credential custody,
- automatic token refresh,
- successful assignment publication,
- Classroom topic selection,
- duplicate protections,
- publication retry behavior,
- connection intent/nonce protections,
- PKCE behavior,
- teacher binding,
- callback identity validation,
- `lms.identityMismatch`,
- existing Sprint 25 certification evidence,
- existing B13 PASS WITH LIMITATION closure,
- existing no-student-PII posture,
- existing no-secret/token exposure posture,
- existing manual-class join-code behavior,
- existing LMS-linked class behavior.

Sprint 26 does not rewrite Sprint 24 or Sprint 25 history. Where Sprint
26 supersedes an earlier assumption (for example the stale "only
published entries are registered" comment in `curriculum.ts`), it says so
explicitly without altering historical evidence.

## 11. Acceptance criteria

Acceptance is separated into deterministic automated evidence, local/
browser integration evidence, and narrowly scoped live production
certification. These three levels are kept distinct and must not be
conflated.

### 11.A Automated acceptance criteria

**Account continuity**

- Publication-intent OAuth can receive the durable connection's Google
  account identity as an account hint.
- The Google adapter includes the supported `login_hint` when the
  account hint is present.
- Initial connection does not incorrectly require or fabricate a login
  hint.
- Absence of an existing hint is handled safely (deterministic
  omitted-value behavior preserved).
- The hint is not intentionally logged or placed in audit events.
- Existing identity-mismatch validation remains active.

**Identity invariant**

- A mismatched Google identity still hard-rejects widening.
- The existing connection remains unchanged.
- Existing credentials are not overwritten by the mismatched grant.
- No incorrect permission widening occurs.

**Assignment Defect 2.A** - automated tests distinguish:

- draft creation failure,
- draft created but publication failed,
- successful publication,

with truthful teacher-facing outcome summaries for each, and existing
multi-class / partial-success behavior still correct.

**Assignment Defect 2.B**

- A hydrated draft does not trigger Assigned.
- A hydrated published assignment does trigger Assigned.
- The draft remains available where legitimate draft functionality
  requires it.
- Existing in-session badge timing protections remain correct.

**Recovery UX**

- Identity mismatch maps to specific teacher-facing recovery language.
- Generic permission-not-granted behavior remains distinct.
- Reconnect-required behavior has a usable next action.
- The existing healthy connection state remains correct.

**Observability**

- Successful permission widening creates the approved PII-safe
  diagnostic/audit evidence.
- Identity-mismatch rejection creates the approved PII-safe diagnostic/
  audit evidence.
- Payloads contain no upstream Google identity, tokens, secrets, or
  student PII.

**Settings spacing**

- Connected Services no longer inherits the unintended extra top margin.
- No broad Settings layout regression is introduced.

### 11.B Browser / local integration acceptance criteria

Use deterministic fixtures/emulators where possible. At minimum verify:

- the saved-but-not-published assignment path shows truthful messaging,
- the resulting draft remains recoverable/retryable,
- draft-only state does not display Assigned after hydration/reload,
- published state does display Assigned,
- Settings renders the intended connection/recovery states,
- reconnect/action-needed UX provides an obvious next action,
- Settings spacing is visually consistent with neighboring categories,
- existing assignment and Google Classroom success paths remain intact.

### 11.C Live Google production certification

Kept intentionally small. The goal is to confirm the integration
boundary, not to reproduce every Google authorization UI state. Live
certification focuses on what LyfeLabz controls. At minimum:

1. Confirm that incremental publication authorization correctly supplies
   the connected Google identity through the supported account-continuity
   mechanism in the real Google flow.
2. Confirm that authorization/publication still succeeds for the correct
   connected identity.
3. Confirm that subsequent publication still reuses the established
   widened Google connection without unnecessary authorization.

Sprint 26 success is NOT defined as "Google must never display an
account chooser." `login_hint` is a hint, not an enforcement boundary.
Sprint 26 succeeds if LyfeLabz correctly supplies the account hint,
preserves the backend identity invariant, correct-identity authorization
succeeds, and subsequent publication remains functional.

Live certification does NOT need to reproduce: consent cancellation,
deliberate identity mismatch, a pristine readonly-only Google grant, an
account chooser, cert-teacher-005, manually revoked grants, or B13. Those
behaviors are established through deterministic tests and existing Sprint
25 evidence.

## 12. Certification strategy

- **Engineering validation.** Unit and integration tests plus emulator
  runs exercise the begin/complete callables and the Google adapter,
  including the account-hint threading and the preserved identity-
  mismatch reject. Proves code paths, not the teacher workflow.
- **Genuine browser / local verification.** Deterministic fixtures/
  emulators drive the intended teacher UX per 11.B. Proves the workflow
  in a controlled environment.
- **Narrowly scoped live Google certification.** Confirms the real
  integration boundary per 11.C, focused on what LyfeLabz controls.

The three levels must not be conflated. Live certification confirms the
boundary; it does not attempt to reproduce provider-controlled UI states.

## 13. Explicit non-goals

Sprint 26 explicitly excludes:

- no new LMS provider,
- no new Google Classroom feature family,
- no B13 reopening,
- no cert-teacher-005 requirement,
- no OAuth-grant manipulation for certification,
- no requirement to reproduce Google consent cancellation,
- no requirement that Google always suppress account selection,
- no weakening of identity validation,
- no broad Settings redesign,
- no broad teacher-workspace redesign,
- no historical stranded-draft migration,
- no new token/secret/PII logging,
- no unnecessary generic OAuth framework,
- no production deployment as part of implementation unless separately
  authorized.

Explicitly deferred (out of scope unless a genuine correctness
dependency is discovered during implementation):

- **B13 live reproduction.** Disposition remains PASS WITH LIMITATION.
  Do not require another clean Google identity, cert-teacher-005,
  revoking grants, manipulating `include_granted_scopes`, manufacturing
  the Google cancellation screen, or damaging preserved certification
  state.
- **Abandoned-consent lifecycle machinery.** No new TTL-based detection
  or durable state solely to determine that authorization was begun but
  never completed, unless it proves essentially free using existing
  architecture (then OPTIONAL only).
- **Broad Settings redesign.** Boundary is the spacing defect plus the
  narrowly required connection/recovery UX.
- **Broad teacher-workspace polish.** Belongs to a future UX sprint.
- **Historical stranded-draft cleanup.** Correct current/future
  semantics first; historical cleanup is a separate future decision.
- **Provider abstraction expansion.** Smallest provider-neutral contract
  change only.
- **Google domain pinning.** No `hd` / Workspace-domain restriction as a
  substitute for account continuity; domain selection is not identity
  validation.

## 14. Implementation phases

The phase ordering follows repository dependencies. If repository
architecture suggests a safer ordering during implementation, document
the evidence and adjust.

- **Phase 1: Minimal observability and contracts.** Add the narrowly
  required audit/diagnostic event definitions. Prepare the minimal OAuth
  begin contract change needed for account hinting (the optional account
  hint sibling to the existing `capability` selector). Add/update
  foundational tests. Do NOT build abandoned-consent lifecycle
  machinery.
- **Phase 2: Google account continuity.** Obtain the durable connection
  identity during publication-intent begin. Thread the account hint
  through the provider contract. Add the Google-specific `login_hint`
  inside the adapter. Preserve completion-time identity mismatch. Add
  deterministic account-hint tests.
- **Phase 3: Assignment state correctness.** Correct the outcome
  representation for draft-create vs publication failure. Correct
  teacher-facing summaries. Correct hydration-driven Assigned semantics.
  Add regression tests.
- **Phase 4: Connection and recovery UX.** Surface identity mismatch
  distinctly. Provide clear same-account recovery language. Provide a
  usable reconnect/action-needed path. Keep technical OAuth details
  hidden.
- **Phase 5: Settings repair.** Fix the Connected Services spacing
  defect. No broader redesign.
- **Phase 6: Integrated verification and certification.** Full relevant
  automated suites, local/browser verification, and narrowly scoped live
  Google certification.

## 15. Risks and open questions

- **Google may still show a chooser.** `login_hint` does not guarantee
  chooser suppression under all session/account conditions. Mitigation:
  acceptance criteria explicitly do not depend on chooser suppression;
  the identity invariant and recovery UX handle the wrong-account case.
- **Determinism of adapter tests.** The adapter currently blanks
  `login_hint` partly for deterministic test strings. Implementation
  must keep tests deterministic while proving the hint is populated when
  present and omitted when absent.
- **Where "connected, action needed" state is authoritative.** Resolved in
  Phase 4. There is no durable backend action-needed field, so the state is
  session-local: it is derived only from a `reconnectRequired` publication
  outcome LyfeLabz actually observed this session, held in an in-memory
  uid-scoped client store, and read by Settings through an injected seam. No
  durable connection-health persistence and no diagnostic console were
  introduced. See 7.F.
- **Outcome-model shape for 2.A.** Whether the truthful three-state
  outcome is best expressed by extending the existing detail outcome
  types or by a small new discriminated result. Resolve during Phase 3
  against the existing detail surface types.
- **Audit event naming reconciliation.** Resolved in Phase 1. Final
  names are `lms.connectionScopesWidened` and
  `lms.connectionWideningRejected`, added to the canonical `AUDIT_ACTIONS`
  tuple and emitted through the canonical audit helper. See 7.G.
- **Draft retention semantics (2.B).** Confirm the intended draft
  recovery/viewing behavior so the badge fix does not strand or hide
  legitimate drafts.

## 16. Definition of Done

Sprint 26 is complete when all of the following hold:

- Incremental Google authorization appropriately prefers the durable
  connection identity using Google's supported mechanism.
- The backend still independently rejects identity mismatch.
- Assignment messaging accurately distinguishes creation failure from
  publication failure from success.
- Drafts do not falsely trigger the Assigned lesson-card state.
- Identity mismatch has clear teacher-facing recovery language.
- Reconnect/action-needed states have an obvious teacher action.
- Minimal safe observability exists for meaningful permission-widening
  outcomes.
- Settings spacing is corrected without redesign.
- Automated regression coverage proves LyfeLabz-controlled behavior.
- Browser/local verification proves the intended teacher UX.
- Narrowly scoped live Google verification confirms the real integration
  boundary.
- No new OAuth loops, identity regressions, publication regressions,
  token exposure, PII exposure, or LMS workflow regressions are
  introduced.

*End of definition.*
