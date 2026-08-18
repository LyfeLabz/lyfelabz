# Sprint 26 - Completion Report (LMS UX Hardening)

Status: COMPLETE. Sprint 26 is certified through its narrowly scoped live
Google integration boundary. This report supersedes the interim Phase 6B
BLOCKED and RECOVERY findings as the disposition of record. It does not
rewrite Sprint 24/25 history, and it authorizes no production deployment.
A certification-discovered Phase 4 defect (the Settings Reconnect action
did not re-mint an active-but-unusable credential) was corrected before
closure and certified deterministically; see section 23. Sprint 26 remains
PASS.

Style: no em dashes. " - " is the sentence break.

## Final status

**PASS.**

A genuine `lms.reconnectRequired` provider-boundary condition (a dead
Google refresh token) was cured through the actual Sprint 26 product path
via one explicitly authorized, controlled, same-account reauthorization.
Live `login_hint` account continuity was observed on the real product
begin callable, completion-time identity revalidation succeeded on the
live widening path, and two live Google Classroom publications succeeded
(one requiring the incremental consent, then silent reuse). All targeted
Sprint 26 smoke tests pass. No token, secret, upstream Google identifier,
or student PII appears in any audit payload, log, or teacher surface.

A full PASS (rather than PASS WITH PROVIDER-BOUNDARY LIMITATION) is
warranted because the naturally dead refresh token provided legitimate
live evidence of the provider authorization boundary that Phase 6A
expected to remain unobservable, and `login_hint` was directly observed on
the real product callable, not only through deterministic tests.

## Identifier reconciliation (correcting the Phase 6A labeling)

- Google Classroom course id: **`871447706346`**.
- Historical Sprint 25 coursework id: **`874752057518`** (created inside
  course `871447706346`; the Phase 6A findings referred to it once as a
  "course", now corrected in that document and here).
- Sprint 26 live courseworks created in course `871447706346`:
  - `874953413992` - the live incremental-consent (widening) publication.
  - `874953414061` - Publication 1 (reused draft `s26cert-celltypes-1`).
  - `874954047705` - Publication 2 (new minimal draft `s26cert-celltypes-2`).

## 1. Sprint scope

Sprint 26 is a UX hardening sprint on top of certified Sprint 25. It adds
no LMS capability. It ships six product improvements (Definition §6):
account continuity via `login_hint`, assignment-state truthfulness
(Defects 2.A/2.B), Google Classroom recovery UX, session-local
connection-health UX, minimal PII-safe consent observability, and one
Settings spacing fix. Load-bearing identity security is preserved, never
weakened.

## 2. Implementation phases (1 through 5)

- Phase 1 - observability + contract: two PII-safe audit actions
  (`lms.connectionScopesWidened`, `lms.connectionWideningRejected`); the
  optional provider-neutral `accountHint` on `beginOAuth`; Google adapter
  converts it to `login_hint`.
- Phase 2 - account continuity: `resolvePublicationAccountHint` in
  `connections-begin.ts` resolves the durable connection's upstream
  identity transiently in memory for a publication-intent begin only, and
  threads it as `accountHint`. Best-effort, steering-only, never load-bearing.
- Phase 3 - assignment-state correctness: `PerClassOutcome.lyfelabzState`
  three-value discriminant (`draftFailed` / `savedNotPublished` /
  `published`); `qualifiesForAssignedBadge` gates the hydration-time
  Assigned badge on `published`/`closed`.
- Phase 4 - connection + recovery UX: identity-mismatch classified
  distinctly at the client consent boundary; session-local
  `connectionRecovery` signal drives a Settings "Connected, action needed"
  state with a Reconnect action.
- Phase 5 - Settings spacing: `.shell-settings-category-button { margin-top: 0 }`.

## 3. Automated baselines (Phase 6A) and Sprint 26 smoke tests (this run)

- Phase 6A baselines (unchanged): Functions 87 suites / 1586 tests PASS,
  typecheck + lint clean; App 58 suites / 975 tests, 974 PASS with the one
  pre-existing curriculum-manifest drift failure (section 11).
- Sprint 26 targeted smoke tests re-run at final certification, all green
  (no source changed during certification, so targeted coverage suffices):
  - Functions: `connections-begin-account-hint`, google-classroom
    `adapter`, `connections-complete-oauth-state`, `write-audit-event`,
    `assignments-publish` (LMS), `credential-refresh-integration`,
    `credential-resolver`, `adapter-refresh`, `token-safety`, assignments
    `assignments-publish`, `assignments-create-draft` - 11 suites,
    61 + 93 = 154 tests PASS.
  - App: `curriculum.false-success`, `curriculum.lms-publish`,
    `lmsPublication`, `detail.lms-retry`, `integrations`,
    `settings.category-spacing-css` - 6 suites, 84 tests PASS.
  - Total: 17 suites, 238 tests, 0 failures.

## 4. Phase 6A evidence (deterministic)

The complete Sprint 26 diff was accounted for, security/privacy review
clean, teacher surfaces proven at the DOM-render level by deterministic
jsdom integration tests (saved-but-not-published messaging, draft-only
never Assigned after hydration, identity-mismatch distinct copy, Settings
action-needed/Reconnect, Settings spacing). See
`SPRINT_26_PHASE_6A_CERTIFICATION_FINDINGS.md`.

## 5. Phase 6B preservation / restart evidence

The in-memory widened Path B fixture was exported to
`platform/firebase/sprint26-pathb-cert-state/`, independently validated
through the real `FirestoreLmsTokenStore` abstraction, and restored into a
freshly built Sprint 26 emulator. Gates P0 through P7 passed. See
`SPRINT_26_PHASE_6B_RECOVERY_FINDINGS.md`.

## 6. Genuine dead-refresh-token discovery and correct behavior

The preserved `cert-teacher-001` connection's stored access token was
expired; the resolver attempted an in-place refresh against real Google;
Google rejected the refresh token (`invalid_grant` / 401). Sprint 26
normalized this to `lms.upstreamAuthorizationFailed` ->
`lms.reconnectRequired` and returned a graceful failure with no coursework
POST, no false success, and no orphan mirror pointer. This was a genuine
provider-boundary condition, which is what legitimized the controlled
reauthorization (it is not a manufactured incremental-OAuth attempt).

Note (code-grounded): `classes-refresh.ts` returns the `reconnectRequired`
verdict without mutating the connection document, so the connection
remains `status: active` with a dead credential. See section 15.

## 7. Controlled same-account recovery (baseline preserved)

Pre-reauth baseline (Gate R0) confirmed read-only before acting: emulator
running Sprint 26 with `--import ./sprint26-pathb-cert-state`;
`cert-teacher-001` active + widened (`scopesUpdatedAt 2026-08-16T17:07`);
`s26cert-celltypes-1` still `draft`, no `lmsPublicationRef`;
`lmsAssignmentPublications` = 7; HEAD `732017d`, nothing staged; snapshot
gitignored. The pre-reauth snapshot was treated as immutable and never
overwritten.

## 8. Live `login_hint` evidence (Gate R2, Definition §7.A)

The real `lmsConnectionsBegin` callable (the exact call the client consent
handoff makes) was invoked as `cert-teacher-001` against the running
Sprint 26 build:

- publication intent (`capability: "publication"`): `login_hint`
  **present and non-empty**; scope set = 4 including
  `classroom.coursework.students` + `classroom.topics.readonly`;
  `prompt=consent`; `access_type=offline`; `include_granted_scopes=true`;
  PKCE `code_challenge_method=S256` present; real Google endpoint;
  localhost certification redirect.
- initial-connect intent (control): `login_hint` **absent**; readonly
  scopes only.

The `login_hint` value was never printed, logged, or recorded - only its
presence and non-emptiness. This is live proof of account continuity
beyond the deterministic Phase 6A tests.

## 9. Human Google interaction (same account)

Reauthorization ran through the actual product browser path (the in-app
browser cannot drive the Google sign-in popup; a human operator drove a
real browser). The operator used the SAME certification Google account
throughout. Google's chooser behavior is provider-controlled and
explicitly non-normative to this certification (Definition §11.C/§15).

Recovery path used (Gate R1, canonical for this exact condition): Settings
-> Disconnect Google Classroom -> Connect Google Classroom re-minted a
fresh working credential (the new-connection completion path). Google
returned the initial readonly scope set, so the connection then required
the incremental publishing consent, delivered through the natural Assign
-> "Also publish to Google Classroom" flow, which opened the
publication-intent OAuth carrying `login_hint`.

## 10. Completion-time identity revalidation (live)

The incremental publishing consent completed through
`lmsConnectionsComplete`'s widening path. That path resolves the existing
bundle and compares `oldBundle.upstreamAccountIdentifier` against
`grant.upstreamAccountIdentifier`; a mismatch would throw
`lms.identityMismatch` before any mutation and emit
`lms.connectionWideningRejected`. The connection widened successfully
(`scopesUpdatedAt 2026-08-18T12:05:01.734Z`, coursework scope added) with
**zero** `connectionWideningRejected` events, which proves completion-time
identity validation succeeded for the same account. No identity value was
observed or recorded.

## 11. Credential recovery (Gate R3)

After widening: single `cert-teacher-001` connection, `status: active`,
4 scopes (`courses.readonly`, `coursework.students`, `rosters.readonly`,
`topics.readonly`), fresh `tokenRef`, no duplicate connection, no residual
reconnect state. The credential was proven usable by the live publication
that immediately followed. No token or secret was printed.

## 12. Publication 1 - reused stranded draft (Definition §14)

Through the production callables (no OAuth; silent reuse of the widened
connection):

- `assignmentsPublish(s26cert-celltypes-1)` advanced the LyfeLabz lifecycle
  `draft -> published` (`alreadyPublished: false`).
- `lmsAssignmentsPublish(...)` returned `succeeded`, coursework
  **`874953414061`**, URL
  `https://classroom.google.com/c/ODcxNDQ3NzA2MzQ2/a/ODc0OTUzNDE0MDYx/details`
  (base64 decodes to course `871447706346` / coursework `874953414061`).

Persisted state: `s26cert-celltypes-1.status = published`,
`lmsPublicationRef = s26cert-celltypes-1__googleclassroom__a4cf6312`,
exactly one `succeeded` publication record, no duplicate, no orphan.

## 13. Publication 2 - silent reuse (Definition §16)

A minimal new labeled cert assignment `s26cert-celltypes-2` was created,
published (lifecycle), and published to Google via callable:

- coursework **`874954047705`**, course `871447706346`, `succeeded`.
- No OAuth redirect, no account chooser, no reconnect, no re-widening:
  the connection `scopesUpdatedAt` remained `2026-08-18T12:05:01.734Z`
  across both publications, and no new connection was created. "No account
  chooser" here means no OAuth flow was initiated at all.

`lmsAssignmentPublications` count moved 7 -> 10 (baseline 7 + the live
widening publication + Publication 1 + Publication 2).

## 14. Assignment-state evidence (Defects 2.A and 2.B, live)

- Defect 2.A: the live incremental-consent Assign showed truthful full
  success ("Assigned Cell Types to 1 class. Publishing to Google Classroom
  succeeded."). The earlier dead-token attempt on `s26cert-celltypes-1`
  had correctly NOT reported full success and left a durable unpublished
  draft (no false "not created").
- Defect 2.B: `s26cert-celltypes-1` remained an unpublished `draft` (not
  Assigned) after the failed attempt, then transitioned truthfully to
  `published` (Assigned-eligible) only after the successful Publication 1.

## 15. Recovery / Settings UX evidence and one code-grounded observation

The genuine `reconnectRequired` provider-boundary condition was recovered
through the actual application path (Disconnect -> Connect, then the
publication-consent widening). Per Definition §21 this is not a blocker.

Code-grounded follow-up observation (discovered during live certification;
CORRECTED before sprint closure - see section 23): for a dead-refresh-token
connection that remains `status: active` (`classes-refresh.ts` returns the
`reconnectRequired` verdict without revoking), the Phase 4 Settings
**Reconnect** action, as originally shipped, began an initial-connect
(non-publication) authorization, and `lmsConnectionsComplete`'s intent-aware
idempotent early return (`hasActiveConnection && intent !== "publication"`)
returned `alreadyConnected: true` without exchanging the code or minting a
new credential. The Reconnect affordance was present and obvious, but for
this specific edge it did not itself re-mint the credential; the working
recovery at the time was Disconnect -> Connect followed by the
publish-consent widening. This was a security-safe, data-integrity-safe UX
completeness gap, but it meant the button labeled Reconnect did not actually
reconnect an active-but-unusable connection. It was determined to be within
Sprint 26 Phase 4 scope (definition §7.F explicitly aimed to remove the
Settings reconnect dead-end) and was corrected before commit through an
explicit "reconnect" OAuth intent. See section 23 for the full disposition.

## 16. Audit / privacy evidence (Definition §7.G, §9)

- `lms.connectionScopesWidened` emitted exactly once
  (`2026-08-18T12:05:01.744Z`), payload `{ providerId: "googleClassroom" }`
  only, after the connection update committed.
- `lms.connectionWideningRejected`: zero (correct for a same-account
  success).
- Leakage sweep across `auditEvents`, `lmsAssignmentPublications`, and
  `lmsConnections`: zero documents contain token-shaped, refresh-token,
  access-token, API-key, or private-key material. No upstream Google
  identity or email in any audit payload. No student roster data was read.

## 17. Manifest-drift disposition

Unchanged and unrelated: the single Phase 6A app failure is the
pre-existing `curriculumManifest.test.ts` `canonicalSourceSha256` drift
(root `index.html` changed 2026-07-30, before Sprint 25 and 26). No Sprint
26 path touches it; not fixed here (regeneration is out of scope).

## 18. B13 preservation

B13 remains CLOSED as PASS WITH LIMITATION and is not reopened. No consent
cancellation was reproduced, no grant was revoked after success, and no new
certification identity (`cert-teacher-005`) was created. The B13 artifacts
(`cert-teacher-002/003/004`) were left untouched.

## 19. Snapshots

- Immutable pre-reauth Path B snapshot:
  `platform/firebase/sprint26-pathb-cert-state/` (unchanged, metadata
  2026-08-18 00:06). Gitignored.
- Healthy post-certification snapshot:
  `platform/firebase/sprint26-certified-cert-state/` (created 2026-08-18
  08:11 from the running healthy emulator). Gitignored. Named to match the
  pre-existing `platform/firebase/*-cert-state/` ignore rule; verified with
  `git check-ignore`.
- Neither snapshot is visible to git.

## 20. Final verdict

**Sprint 26: PASS.** Definition-of-Done (§16) satisfied: account
continuity supplies the durable identity via `login_hint`; the backend
still hard-rejects identity mismatch; assignment messaging distinguishes
creation failure from publication failure from success; drafts do not
falsely trigger Assigned; identity-mismatch recovery language is distinct;
reconnect/action-needed has an obvious action; PII-safe widening
observability exists; Settings spacing corrected; automated regression and
narrowly scoped live Google verification both green. No OAuth loop,
identity regression, publication regression, token/PII exposure, or LMS
workflow regression was introduced.

## 21. Deferred items

- Phase 4 Reconnect on an active-but-unusable connection (section 15) -
  RESOLVED before closure by the certification follow-up correction; see
  section 23. No longer deferred.
- Abandoned-consent lifecycle machinery - remains out of scope.
- Historical stranded-draft cleanup - remains out of scope.
- Broader Settings / teacher-workspace polish - future UX sprint.
- Provider-controlled account-chooser behavior - non-normative by design.
- Curriculum-manifest SHA drift - pre-existing, unrelated.

## 22. Git status / deployment

- HEAD `732017d`, unchanged. Nothing staged, committed, pushed, or
  deployed. No `firebase deploy`. No production Hosting/Functions/OAuth/
  Firestore change.
- Working tree after the certification follow-up correction (section 23)
  and the final closeout documentation pass: 24 modified tracked files. The
  follow-up added `platform/functions/src/lms/oauth-state/state-store.ts` to
  the Sprint 26 diff and further edited already-modified files -
  `connections-begin.ts`, `connections-complete.ts`,
  `connections-complete-oauth-state.test.ts`, `shared/types/audit-event.ts`,
  `shared/audit/write-audit-event.test.ts`, and the four Settings
  integrations files. The final closeout pass added one documentation-only
  edit, `docs/platform/TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (the per-sprint
  implementation-status ledger updated to record Sprint 26 as complete,
  matching the Sprint 24A/24B/25 precedent), bringing the modified-tracked
  count from 23 to 24 with no production or test code change. New untracked docs
  (`SPRINT_26_DEFINITION.md`,
  `SPRINT_26_PHASE_6A_CERTIFICATION_FINDINGS.md`,
  `SPRINT_26_PHASE_6B_BLOCKED_FINDINGS.md`,
  `SPRINT_26_PHASE_6B_RECOVERY_FINDINGS.md`, this report) and untracked
  tests (`settings.category-spacing-css.test.ts`,
  `connections-begin-account-hint.test.ts`). The follow-up correction added
  no new files; its harnesses were deterministic tests only.
- Both certification snapshots are gitignored and invisible to git.

The user will review and commit separately.

## 23. Certification follow-up (2026-08-18): Reconnect recovery correction

Discovered during live certification (section 15), determined to be within
Sprint 26 Phase 4 scope, corrected before sprint closure, and certified
deterministically without repeating provider-boundary certification.

### 23.1 Root cause

For a connection that is still `status: active` but whose stored credential
is unusable (a dead Google refresh token; `classes-refresh.ts` returns the
`reconnectRequired` verdict without revoking), the Settings **Reconnect**
action began a plain initial-connect authorization. At completion,
`lmsConnectionsComplete`'s intent-aware idempotent early return
(`hasActiveConnection && binding.intent !== "publication"`) returned
`alreadyConnected: true` without exchanging the fresh code or minting a new
credential. The unusable credential was left in place, so the button labeled
Reconnect did not reconnect.

### 23.2 Invariant the early return protects (preserved)

The early return exists so a duplicate or replayed initial-connect (teacher
double-submits, closes the tab and reconnects, or a stale callback replays)
never mints a second credential, overwrites a healthy connection, or thrashes
the token store. That idempotency is preserved: a genuine duplicate
initial-connect (intent `initialConnect`) still short-circuits unchanged. The
correction does NOT weaken idempotency globally.

### 23.3 Correction (explicit reconnect intent)

A third provider-neutral OAuth-state intent, `reconnect`, was threaded
through the existing OAuth-state architecture:

- `lmsConnectionsBegin` accepts an optional `reconnect: boolean` (sibling to
  the existing `capability` selector; the two are mutually exclusive and a
  contradictory combination is refused with `lms.invalidReconnect`). It binds
  the `reconnect` intent in the OAuth state record and requests the base
  (initial) scope set - never the publication scope. It also supplies the
  durable connection's `login_hint` (same steering as publication), so the
  teacher is guided back to the connected account.
- `lmsConnectionsComplete` excludes `reconnect` from the idempotent early
  return and adds a credential-recovery branch that reuses the widening
  path's safe shape: it resolves the existing bundle, re-validates identity
  (`oldBundle.upstreamAccountIdentifier !== grant.upstreamAccountIdentifier`
  hard-rejects with `lms.identityMismatch` before any mutation - the SAME
  invariant as widening, not a second weaker check), stores a fresh bundle
  carrying the new credential and the base scope set, updates the SAME
  connection document (`update`, not `set` - no duplicate connection),
  best-effort revokes the old local token bundle, and NEVER revokes the
  upstream Google grant. It returns `consentOutcome: "recovered"`.
- Settings `onReconnect` passes `reconnect: true`; `onConnect` does not.

### 23.4 Scope semantics (least privilege preserved)

Reconnect restores only the base connection scopes. A connection that had
been widened for publication returns to base scope on reconnect; publication
scope is re-widened later through the existing incremental-consent path
(`capability: "publication"` + `login_hint`), exactly as before. Reconnect
and publication widening remain distinct product concepts.

### 23.5 Observability

Two PII-safe, low-cardinality audit actions were added:
`lms.connectionRecovered` (payload `{ providerId }`, emitted only after the
connection document update commits) and `lms.connectionRecoveryRejected`
(payload `{ providerId, reason: "identityMismatch" }`, emitted best-effort
before the hard reject). Neither is falsely emitted as
`lms.connectionScopesWidened` or `lms.connectionCreated`. Both are best-effort
through `safeAudit`, so audit persistence is never load-bearing for the
security or lifecycle outcome. Neither carries a scope array, either Google
identity, tokens, or PII.

### 23.6 Files changed by the follow-up (distinct from prior Sprint 26 work)

- `platform/functions/src/lms/oauth-state/state-store.ts` - added `reconnect`
  to `LmsOAuthStateIntent` (new to the Sprint 26 diff).
- `platform/functions/src/lms/connections-begin.ts` - `reconnect` request
  field, validation, three-way intent derivation, broadened account-hint
  helper (`resolvePublicationAccountHint` -> `resolveDurableConnectionAccountHint`).
- `platform/functions/src/lms/connections-complete.ts` - early-return guard
  excludes reconnect; new credential-recovery branch; `recovered` outcome.
- `platform/functions/src/shared/types/audit-event.ts` - two new actions.
- `platform/functions/src/lms/connections-complete-oauth-state.test.ts`,
  `platform/functions/src/lms/connections-begin-account-hint.test.ts`,
  `platform/functions/src/shared/audit/write-audit-event.test.ts` - new tests.
- App: `app/src/settings/integrations/integrations.ts` (Reconnect sends
  `reconnect: true`), `.../types.ts` and `.../wire.ts` (`reconnect` input,
  `recovered` outcome), `.../integrations.test.ts` (asserts the reconnect
  signal is sent; plain Connect is not).

### 23.7 Verification

- Functions: typecheck clean, lint clean, 87 suites / 1598 tests PASS
  (baseline 1586 + 12 new reconnect/audit tests).
- App: typecheck clean, lint clean, 58 suites / 976 tests, 975 PASS with the
  one pre-existing, unrelated curriculum-manifest SHA drift failure (baseline
  974 PASS + 1 new reconnect test; the manifest failure is unchanged).
- Deterministic recovery-intent proof (no real Google): the jsdom
  integrations test proves Settings action-needed -> Reconnect ->
  `beginConnection({ reconnect: true })`; the begin-handler test drives the
  real handler and inspects the generated Google authorization URL
  (`login_hint` present, base scopes only, publication scope absent),
  stopping at the authorization URL. No OAuth was granted; no real Google
  action was taken; no new coursework was created.

### 23.8 Live certification preservation

No real Google grant was modified by this correction. The existing Sprint 26
live evidence (sections 8 through 16: live `login_hint`, completion-time
identity revalidation, two live publications, `lms.connectionScopesWidened`,
audit/privacy posture, course `871447706346`, courseworks `874953413992`,
`874953414061`, `874954047705`) remains valid. The provider boundary was
already proven; the correction is certified deterministically, which is
sufficient because it changes only how the completion handler dispatches a
new (reconnect) intent - it does not alter the provider-transport boundary.

### 23.9 Verdict

**Sprint 26: PASS (unchanged).** The certification-discovered Phase 4
Reconnect defect is corrected and deterministically certified before final
commit. No idempotency weakening, no identity-mismatch weakening, no durable
connection-health persistence, no new Google grant, and no live Google
testing were required.
