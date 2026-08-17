# Sprint 25 - B13 Architecture Reassessment and Closure

Status: **CLOSED. B13 disposition: PASS WITH LIMITATION. Sprint 25 is NOT
blocked.** This document ends the B13 fixture-manufacturing effort, records the
read-only architecture reassessment that replaced it, and states the final
disposition. It is append-only and preserves all prior B13 evidence.

Style: no em dashes. Use " - " (spaced hyphen).

This is a read-only architecture review. No production code was changed. No
callable was invoked. No OAuth flow was initiated. No Google API was called. No
stored token was read or used against Google. No emulator document was written.
No Google grant was revoked. Nothing was staged, committed, or pushed.

Governing / preserved documents (unchanged by this review):
- `SPRINT_25_B13_CERTIFICATION_FINDINGS.md` (Attempt 1 evidence; CT-003 frozen)
- `SPRINT_25_B13_RECOVERY_REPORT.md` (Attempt 2 evidence; CT-004 frozen)
- `SPRINT_25_B8_CERTIFICATION_FINDINGS.md`, `SPRINT_25_B11_B12_CERTIFICATION_FINDINGS.md`
- `SPRINT_25_BROWSER_CERTIFICATION_CHECKLIST.md` §B13
- `SPRINT_25_CERTIFICATION_RUNBOOK.md` §5, §7

Source files inspected for this review are listed in §16.

---

## 0. Why the B13 fixture-manufacturing effort was stopped

The B13 browser checkpoint requires a **readonly-only** connection as its
starting fixture, so that the first publish provokes a genuine one-time
incremental consent that the operator can cancel. Two attempts failed to
reproduce that fixture cheaply:

- **Attempt 1 (CT-003):** the consent ran to completion instead of being
  cancelled. The connection widened and real coursework `874805966316` was
  created. Correct product behavior, wrong certification path.
- **Attempt 2 (CT-004):** even after a confirmed Google-account "Delete all",
  a fresh readonly `initialConnect` returned the full four-scope widened set,
  because `include_granted_scopes=true` re-folds every scope Google still
  associates with the `(labzlyfe, LyfeLabz-client)` pair. Ran ~8 minutes after
  revocation; could not distinguish propagation lag from durable retention.

Continuing would mean a third identity, a second manual revocation, and an
overnight propagation wait, all to manufacture one Google-side UI state that our
own code does not control. That cost is disproportionate to the edge case, and
the effort was obscuring a more useful finding surfaced during Attempt 1: the
publication consent flow can display a **"Choose an account"** screen, which is
a real UX/architecture question worth documenting. We stopped to document that
finding and close B13 on the evidence we already hold.

---

## 1. Intended teacher workflow (the invariant to evaluate)

Establish Google identity **once**, at connection time. Preserve it thereafter.

1. Teacher signs into LyfeLabz.
2. Teacher connects Google Classroom, authenticates/selects their Google
   account. LyfeLabz stores a durable connection bound to that Google identity.
3. Later, the teacher opens a lesson, chooses Assign, selects a class, checks
   "Also publish to Google Classroom", and confirms.
4. If publication permission has **never** been granted, Google may show a
   **one-time incremental permission request for the same, already-connected
   Google identity** ("LyfeLabz would like to manage coursework"). Allow or
   Cancel.
5. After that permission is granted once, **every subsequent publish requires no
   Google interaction at all.**

The teacher should never conceptually re-establish or re-choose their Google
identity when publishing. Additional permission is "allow LyfeLabz one more
thing with the account you already connected", not "sign in again and maybe pick
a different account".

---

## 2. What the current implementation actually does

| Concern | Current behavior | Source |
|---|---|---|
| Initial connect scope | Requests exactly `classroom.courses.readonly` + `classroom.rosters.readonly` | `adapter.ts:53-56`, `238-245` |
| Publication scope | Adds `classroom.coursework.students` + `classroom.topics.readonly` when `intent="publication"` | `adapter.ts:76-79`, `238-245` |
| Consent trigger | Publish is attempted on the stored token; only a real 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` routes the client to incremental consent | `assignments-publish.ts:304-336`, `adapter.ts:124-134` |
| Account chooser | The authorization URL sends `prompt=consent` and **no `login_hint`** (it is set empty then stripped), so Google is free to show "Choose an account" | `adapter.ts:252-268` |
| Identity captured | `upstreamAccountIdentifier` = `profile.id` from `userProfiles/me` (the Google `sub`), read after the token exchange | `adapter.ts:305-321`, `transport.ts:752-762` |
| Identity continuity | On the widening path, the new grant's account must equal the stored account or the widening is refused with `lms.identityMismatch` | `connections-complete.ts:232-239` |
| Subsequent publish | Uses the stored credential via `resolveLiveCredential` (refreshes the access token in place if stale); no OAuth | `assignments-publish.ts:304-321`, credential-resolver |

So the backend already enforces the important half of the invariant (identity
continuity is checked, subsequent publishing is silent), but the authorization
URL does not yet **steer** Google toward the connected account, which is why the
chooser can appear.

---

## 3. Answers to the reassessment questions

### Q1. Why does publication scope widening show account selection?

`adapter.beginOAuth` builds the authorization URL (`adapter.ts:238-273`) with:

- `prompt: "consent"` - forces Google to re-display the consent screen. It does
  **not** select an account.
- `login_hint` set to `""` and then `params.delete("login_hint")`
  (`adapter.ts:263-268`) - **no account hint is sent.**
- `include_granted_scopes: "true"` and `access_type: "offline"`.

The `beginOAuth` input contract is `{ teacherId, redirectUri, intent }`
(`provider.ts:159-163`). It carries **no Google-account identifier**, so the
adapter has nothing to hint even in principle. When the browser holds more than
one signed-in Google session and no `login_hint` is supplied, Google's standard
behavior is to present the "Choose an account" screen. That is the exact path
responsible. It is not a defect in consent handling; it is a missing account
hint.

### Q2. Is the incremental-consent request bound to the stored Google identity?

Precisely:

- **LyfeLabz teacher identity** (Firebase Auth `uid`): bound. The OAuth state
  record carries `teacherId`; the completion callable enforces
  `binding.teacherId === actor.uid` before consuming
  (`connections-complete.ts:179-191`). PKCE S256 binds the code exchange to the
  originating begin call.
- **LMS connection**: deterministic id `googleclassroom__<uid>`; resolved by the
  teacher, not by the Google account.
- **Google OAuth account**: **not** bound at issuance. The authorization URL
  pins no account (`login_hint` empty, no `hd`).
- **upstreamAccountIdentifier**: the Google `sub` (`profile.id`), read **after**
  the token exchange at completion (`adapter.ts:305-321`).
- **OAuth state / nonce**: binds `teacherId` + `providerId` + `redirectUri` +
  `intent` + PKCE verifier. It does **not** record the expected Google account.
- **Returned token identity**: validated at completion, but **only on the
  widening path** (`connections-complete.ts:232-239`).

Conclusion: the incremental-consent request is **not** proactively bound to the
stored Google identity (nothing in the URL or state pins the account). Identity
continuity is enforced **reactively** - after the exchange, by an equality check
that rejects a mismatch. Binding is reject-after-the-fact, not pin-before.

### Q3. Could a teacher connect with account A then select account B at widening?

Traced against the code:

1. `beginOAuth(publication)` sends no `login_hint`, so Google lets the teacher
   pick account B.
2. Google returns a code for B. `lmsConnectionsComplete` takes the widening path
   (active connection + publication intent, `connections-complete.ts:214`).
3. It resolves the old bundle (account A's identifier), then
   `adapter.completeOAuth` exchanges the code and reads B's `profile.id`, so
   `grant.upstreamAccountIdentifier = B` (`connections-complete.ts:220-233`).
4. The equality check at `connections-complete.ts:232-239` fires:
   `oldBundle.upstreamAccountIdentifier (A) !== grant.upstreamAccountIdentifier
   (B)` -> throws `lms.identityMismatch`. This is **before** the new token bundle
   is stored (`store()` is at line 277) and before the connection document is
   updated (line 281).

Result: the connection is **not** corrupted. The A-connection, the assignment,
and the readonly/widened scope state are all left intact; the publish stays at
insufficient-scope and remains retryable. Unit-tested at
`connections-complete-oauth-state.test.ts:464-507`.

What the code does **not** prevent: the teacher being **shown** account B and
selecting it. Two residual effects follow from selecting B: (a) a real OAuth
grant to B is minted at Google (harmless but present), and (b) the teacher
receives an "identity mismatch" failure rather than being steered to A in the
first place. So the gap is UX-level (wrong account is reachable), not
correctness-level (wrong account cannot corrupt the connection). Note the check
exists only on widening; a brand-new `initialConnect` has no prior identity to
compare, which is correct - the first connection is what establishes the
identity.

### Q4. Can the flow be configured to prefer/require the connected identity?

Yes, with `login_hint`. Setting `login_hint=<connected account email or sub>`
makes Google pre-select that account and skip the chooser when that account is
present in the session; if it is not signed in, Google prompts for that specific
account. It is a strong preference, not an absolute lock (a determined user can
still switch accounts), which is why it pairs naturally with the existing
completion-time equality check for defense in depth.

Feasibility here: the stored `upstreamAccountIdentifier` is the Google `sub`,
which Google accepts as a `login_hint`. The change required is to thread the
existing connection's stored identifier into `beginOAuth` (its input type has no
account field today, `provider.ts:159-163`) and populate `login_hint` for
publication intent. `hd` can pin a Workspace domain but does not apply to
consumer accounts and is not an account-level lock. The reliable guarantee stays
two-layer: `login_hint` (soft pin, removes the chooser) plus the completion-time
identity check (hard reject). This is follow-up engineering, not Sprint 25 (see
§4 engineering follow-up).

### Q5. Should LyfeLabz verify the returned identity matches the stored one?

It already does, on the widening path (`connections-complete.ts:232-239`), and
yes, this should remain a **hard invariant**. Recommendation: keep it exactly as
is; do not weaken or remove it. The initial-connect path correctly has no prior
identity to check. Refresh does not need its own check because the refresh_token
grant is inherently identity-bound. The only improvement worth making is the UX
message on mismatch ("please use the same Google account you connected"), which
belongs with the `login_hint` follow-up.

### Q6. Is subsequent publishing after the grant silent?

Yes. `assignments-publish.ts:304` resolves the stored credential via
`resolveLiveCredential(connection.tokenRef)`, which refreshes the access token in
place from the stored refresh token when near expiry - no teacher interaction -
and then calls `adapter.publishAssignment` with the stored token
(`assignments-publish.ts:313-321`). No `beginOAuth`, no consent. Incremental
consent is triggered **only** by the 403 `INSUFFICIENT_SCOPE` branch
(`assignments-publish.ts:326-336`). Once the connection holds
`coursework.students`, that 403 no longer occurs, so publication is fully silent.
This is corroborated by the CT-001 B11/B12 evidence: repeated publications on the
already-widened connection succeeded with no re-consent. Implementation path:
`assignments-publish.ts:304-321` -> `credential-resolver.resolveLiveCredential`
-> `adapter.publishAssignment`; the sole consent trigger is the 403 branch.

### Q7. Reassess B13: is the realistic scenario the correct one to certify?

Yes. The correct B13 scenario is exactly:

> existing readonly connection -> teacher publishes for the first time ->
> one-time incremental consent for the SAME Google account -> teacher CANCELS ->
> LyfeLabz keeps the assignment intact and retryable, creates no coursework,
> re-issues no publish, and leaves the connection readonly-only.

This matches `SPRINT_25_CERTIFICATION_RUNBOOK.md` and recovery report §29. The
account-chooser observed during Attempt 1 is a **separate** UX finding, not the
B13 criterion, and should not be folded into B13's pass/fail.

### Q8. Does the current B13 procedure conflate consent-cancellation with account-selection cancellation?

Yes, partially, and they must be separated. Because no `login_hint` is sent, the
live flow can surface an **account chooser before the consent screen**.
"Cancel/close" at that chooser is cancelling **account selection**, not
**incremental consent**. The written browser procedure ("cancel/close the Google
consent window") does not tell the operator which screen they are on.

Separation:

- **B13-consent (canonical):** cancel at the incremental **consent** screen.
  This is the criterion B13 is meant to certify.
- **B13-chooser (distinct):** an account chooser appears at all. Its existence is
  a UX finding to fix via `login_hint` (§4); cancelling there is a different
  upstream path (no state consumed, no completion reached).

Both produce the same backend outcome (one begin, no complete, no coursework,
assignment intact and retryable), so LyfeLabz's robustness is identical either
way. The operator simply needs to know which screen was cancelled for the
evidence to mean what B13 claims.

### Q9. Does the inability to manufacture a clean readonly-only `labzlyfe` grant block Sprint 25?

No. Classified:

- **Core feature failure:** NONE. CT-001 proved connect -> discover -> import ->
  assign -> widen -> publish -> real coursework, and Chris confirmed the item in
  real Google Classroom (B8/B11/B12). The feature works.
- **Product / architecture issue:** the missing `login_hint` (account chooser) is
  a real UX gap, but not a correctness failure - identity is protected by the
  completion-time check. Enhancement, deferred.
- **Certification-fixture limitation:** THIS is what blocks a live B13.
  `include_granted_scopes=true` plus Google's durable accumulated-scope
  association means an account that has ever granted the publication scopes
  cannot cheaply be returned to a readonly-only grant. That is a test-fixture
  problem, not a product defect.
- **Untested edge case:** the live-browser cancel-consent branch is unobserved,
  but the LyfeLabz-side behavior it would exercise is deterministically covered
  by unit tests (§10).

So the blocker is a fixture limitation with compensating evidence, not a feature
or architecture failure. It does not block the sprint.

### Q10. Recommended disposition

**B - PASS WITH LIMITATION.** See §5.

---

## 4. Whether identity continuity is enforced (direct answer)

Yes, but reactively. There is a **hard** completion-time invariant on the
widening path: a widening whose Google account differs from the stored account is
refused with `lms.identityMismatch` and writes nothing
(`connections-complete.ts:232-239`, tested at
`connections-complete-oauth-state.test.ts:464-507`). What is **not** yet enforced
is proactive steering: the authorization URL does not pin the connected account
(`login_hint` empty), so the wrong account is reachable on the Google screen even
though it can never corrupt the connection. Identity continuity of the stored
connection is therefore guaranteed; identity **pre-selection** in the UI is not.

---

## 5. B13 disposition: PASS WITH LIMITATION

**Disposition: B - PASS WITH LIMITATION.**

Certified (live, real Google, operator-confirmed): the core publication feature
and the successful incremental-widening path - CT-001 (B8/B11/B12) and CT-003
(B13 Attempt 1) both created real coursework and Chris confirmed it in Google
Classroom.

Limitation: the specific B13 branch - the teacher **cancels** the one-time
incremental consent - was not exercised in a live browser, because a
readonly-only starting fixture cannot be cheaply reproduced on the certification
Google account (`include_granted_scopes` + durable Google scope accumulation).

Compensating evidence for the uncertified branch (all deterministic unit tests):

- `assignments-publish.ts` treats `lms.insufficientScope` as **non-terminal**:
  no failed record, no `lms.publishFailed` audit, assignment intact, retryable -
  `assignments-publish.test.ts:417-465`. This is the exact backend state a B13
  cancel produces.
- Widening rejects a different Google account with `lms.identityMismatch` without
  mutating state - `connections-complete-oauth-state.test.ts:464-507`.
- Widening never revokes the upstream grant; the connection stays usable -
  `connections-complete-oauth-state.test.ts:607-649`.

Why B and not C (DEFERRED): the cancellation behavior B13 certifies is entirely
LyfeLabz-side backend logic, and that logic is directly unit-tested. A live
browser cancel would only additionally confirm that Google renders a cancellable
screen, which is a Google UI property outside our code and outside our control.
The residual gap is an unobserved Google UI state, not unverified LyfeLabz
behavior, so PASS WITH LIMITATION is the honest and defensible classification
rather than treating a well-tested backend path as unknown.

Why not A (unqualified PASS): honesty. No live cancel was observed; the
limitation must be named, not hidden.

Why not D (BLOCKING FAILURE): there is no failure. Every observed behavior was
correct; the feature is proven end to end.

---

## 6. Whether Sprint 25 remains blocked

**Not blocked.** The core Google Classroom assignment-publication feature is
certified on live Google with operator confirmation. B13 is the only open
browser checkpoint, and it is a fixture-limited edge case with compensating
unit-test evidence, dispositioned PASS WITH LIMITATION. Sprint 25 can proceed to
close.

---

## 7. Recommended engineering follow-up (later sprint, not Sprint 25)

These are enhancements, not corrections. None is required to close Sprint 25.

1. **Account-continuity `login_hint` (primary).** Thread the connected
   connection's `upstreamAccountIdentifier` (the Google `sub`) into
   `beginOAuth` for publication intent and set `login_hint` to it, so Google
   pre-selects the connected account and suppresses the chooser. Pairs with the
   existing completion-time identity check. Requires a `beginOAuth` input
   signature change (`provider.ts:159-163`) and a lookup of the existing
   connection in `connections-begin.ts` for the publication branch. Vendor
   neutrality preserved: `login_hint` stays inside the Google adapter.
2. **Clearer identity-mismatch UX.** When `lms.identityMismatch` fires, surface
   "Please use the same Google account you connected" rather than a generic
   error, since after (1) this should be rare.
3. **Certification-fixture strategy for B13.** Document that a live readonly-only
   fixture requires either a never-authorized Google account or a genuine Google
   grant reset with a real propagation wait (recovery report §37-§38). Prefer a
   fresh dedicated Google account over repeated revocation of an account that has
   already accumulated the publication scopes.
4. **Optional consent-flow observability.** Distinguish, in logs, an abandoned
   `begin` (no matching complete within the state TTL) from a completed one, so a
   future live B13 can be evidenced from the backend without inferring the Google
   UI state.

Rationale for deferral: the codebase is in Preservation / Repository Hardening
posture, the feature is proven, and (1)-(4) are UX and test-infrastructure
improvements. They belong in a scoped follow-up (suggested: Sprint 26 LMS UX
hardening), not bolted onto Sprint 25 closure.

---

## 8. Final report (requested items 1-16)

1. **Intended teacher workflow:** connect Google once and establish identity
   then; every later publish reuses that identity; a one-time incremental
   consent for the SAME account is acceptable on first publish; after that,
   publishing is silent. (§1)
2. **What the implementation does:** readonly connect, publication scope added
   on `intent=publication`, consent triggered only by a real 403, stored-token
   reuse on subsequent publishes, identity checked at widening, but the
   authorization URL sends no `login_hint`. (§2)
3. **Identity continuity enforced?** Yes, reactively - hard
   `lms.identityMismatch` reject at widening; not proactively pinned in the URL.
   (§4)
4. **Account chooser expected/avoidable?** Expected today (no `login_hint` +
   multiple browser sessions); avoidable via `login_hint`. (§3 Q1/Q4)
5. **Subsequent publishing silent?** Yes - stored credential + in-place refresh,
   no OAuth. (§3 Q6)
6. **What CT-001 already proved:** full connect -> import -> assign -> widen ->
   publish -> real coursework, operator-confirmed in Google Classroom
   (B8/B11/B12). (§5)
7. **What B13 actually needs to prove:** that a **cancelled** one-time
   incremental consent leaves the assignment intact and retryable with no
   coursework and no re-issue. (§3 Q7)
8. **Why we are stopping fixture manipulation:** reproducing a readonly-only
   Google grant is blocked by `include_granted_scopes` + durable Google scope
   accumulation; the cost (new identity, repeat revocation, overnight wait) is
   disproportionate to an edge case whose LyfeLabz behavior is already
   unit-tested. (§0, §3 Q9)
9. **Recommended B13 disposition:** PASS WITH LIMITATION. (§5)
10. **Does B13 block Sprint 25?** No. (§6)
11. **Engineering follow-up:** `login_hint` account continuity; clearer mismatch
    UX; documented fixture strategy; consent-flow observability - all deferred.
    (§7)
12. **Files inspected:** see §16.
13. **Files modified:** this new document; and an appended closure marker (§43)
    in `SPRINT_25_B13_RECOVERY_REPORT.md`. No source or test file changed.
14. **Tests/checks performed:** read-only source and documentation inspection
    and targeted `grep`/`sed` reads to confirm the OAuth URL parameters, the
    identity check, the silent-publish path, and the compensating unit tests. No
    test suite was executed, no callable invoked, no emulator I/O. (§17)
15. **VCS status:** nothing staged, committed, or pushed.
16. **One recommended next Sprint 25 action for Chris:** mark B13 **PASS WITH
    LIMITATION** in `SPRINT_25_BROWSER_CERTIFICATION_CHECKLIST.md` citing this
    document, and proceed to Sprint 25 closure. The `login_hint` account-chooser
    fix goes on the Sprint 26 follow-up list, not Sprint 25.

---

## 16. Files inspected (read-only)

- `platform/functions/src/lms/providers/google-classroom/adapter.ts`
- `platform/functions/src/lms/providers/google-classroom/transport.ts` (relevant sections)
- `platform/functions/src/lms/providers/provider.ts` (`beginOAuth` / `completeOAuth` contracts)
- `platform/functions/src/lms/connections-begin.ts`
- `platform/functions/src/lms/connections-complete.ts`
- `platform/functions/src/lms/assignments-publish.ts`
- `platform/functions/src/lms/assignments-publish.test.ts` (insufficient-scope non-terminal tests)
- `platform/functions/src/lms/connections-complete-oauth-state.test.ts` (identity-mismatch / widening tests)
- `platform/functions/src/lms/connections-lifecycle-integration.test.ts` (widening path)
- `docs/platform/SPRINT_25_B13_CERTIFICATION_FINDINGS.md`
- `docs/platform/SPRINT_25_B13_RECOVERY_REPORT.md`

## 17. State mutations performed by this review

- Emulator: NONE (no read, no write).
- Google: NONE (no OAuth, no API call, no token used, no revocation).
- Documentation: created this file; appended a closure marker (§43) to
  `SPRINT_25_B13_RECOVERY_REPORT.md`. Prior sections of all documents unchanged.
- Production Firestore / Auth / Functions / Secret Manager / OAuth clients: none.
- VCS: nothing staged, committed, or pushed.

---

**B13 CLOSED - PASS WITH LIMITATION - SPRINT 25 NOT BLOCKED - MOVE FORWARD.**
</content>
</invoke>
