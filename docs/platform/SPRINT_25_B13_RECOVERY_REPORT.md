# Sprint 25 - B13 Recovery Report (Attempt 2 staging)

Status: **Staged. Awaiting operator Google-side revocation.** This report is the
operator procedure and architecture review for B13 Attempt 2. The evidence of
B13 Attempt 1 is in `SPRINT_25_B13_CERTIFICATION_FINDINGS.md`; this report does
not repeat it. This report changes no production code, invokes no callable,
performs no OAuth, and performs no Google-side action. It stops before the
revocation.

Style: no em dashes. Use " - " (spaced hyphen).

Governing documents:
- `SPRINT_25_B13_CERTIFICATION_FINDINGS.md` (Attempt 1 evidence; CT-003
  immutability)
- `SPRINT_25_CERTIFICATION_RUNBOOK.md` §1.6, §5, §7, §8
- `SPRINT_25_BROWSER_CERTIFICATION_CHECKLIST.md` §B13
- `adapter.ts` (OAuth authorization parameters)

---

## 1. What was provisioned and verified (emulator-side)

`cert-teacher-004` was added to the live certification emulator using the new
additive `SEED_CT004_ONLY` isolated mode in `seed-emulator.js`, mirroring the
CT-002 / CT-003 convention. The mode touches only `cert-teacher-004` and
`users/cert-teacher-004`; it writes no LMS document and never touches CT-001,
CT-002, or CT-003.

Read-only verification after provisioning:

| Identity | Result |
|---|---|
| CT-004 Auth | EXISTS; displayName "Cert Teacher Four"; email `cert-teacher-004@lyfelabz-cert.example`; provider `google.com(cert-google-000000000000000004)`; claims `role=teacher, schoolId=school-beta, districtId=district-beta`; not disabled |
| CT-004 `users/` doc | EXISTS; active |
| CT-004 LMS footprint | 0 connections, 0 token bundles, 0 class links, 0 OAuth states, 0 owned classes, 0 assignments, 0 publications, 0 LMS audit events |
| CT-001 | UNCHANGED (4-scope widened connection; `coursework.me` absent; B8/B11/B12 publications intact; cell-types coursework `874752057518` under topic `871946939445`) |
| CT-002 | UNCHANGED (4-scope connection still carrying `coursework.students` - the preserved `include_granted_scopes` pollution evidence) |
| CT-003 | UNCHANGED (4-scope active connection; `scopesUpdatedAt` 2026-08-17T13:34:09.019Z; class `wo9h8rxa7696asxgcprj` linked to course `874767260810`; succeeded publication; coursework `874805966316`; both OAuth states; audit events) |

CT-004 is a clean teacher identity with no Google authorization of any kind. The
real `labzlyfe` Google identity is not encoded in the Auth fixture; it is
selected only later, by the operator, during the app OAuth flow.

---

## 2. The exact Google-side revocation target

Revoke exactly one thing: the OAuth authorization grant that the **`labzlyfe`**
Google account holds for the **LyfeLabz** OAuth application (the certification
OAuth client, by its consent-screen app name). Nothing else.

The purpose is to make `labzlyfe` behave like a never-authorized Google account
for LyfeLabz, so that a subsequent readonly initialConnect returns only the two
readonly scopes rather than reusing the publication scopes `labzlyfe` granted
during Attempt 1.

The revocation is performed **while signed into the `labzlyfe` account**, not
the `Chris Breezy` account. Revocation is per Google account; performing it from
the wrong account would either miss the target or disturb the CT-001/CT-002
authorization.

---

## 3. Exact manual revocation procedure (operator: Chris)

Google presents one of two equivalent UI variants depending on the account's
current console version. Both revoke all scopes for the app and neither deletes
Classroom data. Follow whichever matches what you see.

Variant A (connections page - most common):
1. Sign in as **`labzlyfe`** (only). Go to `myaccount.google.com/connections`
   (Google Account -> Security -> "Your connections to third-party apps &
   services").
2. Select "See all connections" if shown, then select the **LyfeLabz** app
   entry (the certification OAuth client's consent-screen app name).
3. Review the listed access. Then click **"Delete all connections you have with
   [LyfeLabz]"**.
4. Confirm.

Variant B (Security "Access to your Google Account"):
1. Sign in as **`labzlyfe`** (only). Google Account -> Security -> "Access to
   your Google Account" (or "Third-party apps with account access").
2. Select the **LyfeLabz** app entry -> **"See details"**.
3. Click **"Remove access"** -> **"Confirm"**.

What you should expect to see: the LyfeLabz app entry listing the Classroom
access it currently holds (courses, rosters, coursework, topics), and after
confirming, the app no longer appears in the connections list.

Do not perform any other action on this page. Do not touch any entry other than
LyfeLabz. Do not sign into `Chris Breezy` for this step.

---

## 4. What revocation WILL affect (Task 5.4, 5.5)

- It removes **all** LyfeLabz OAuth scopes for `labzlyfe` in one action
  (courses.readonly, rosters.readonly, coursework.students, topics.readonly).
  `[PROVEN by Google documentation: "If you remove access, the app can't access
  your Google Account."]`
- It makes the LyfeLabz-stored `labzlyfe` refresh/access tokens (currently held
  in CT-003's token bundle) non-functional against real Google.
  `[EXPECTED based on OAuth behavior: revoking a grant invalidates its issued
  refresh token.]` This does not delete or alter the CT-003 Firestore token
  bundle document; it only makes the stored credential inert upstream. CT-003 is
  frozen and will not be used against live Google again.

---

## 5. What revocation will NOT affect (Task 5.5, 5.6, 5.7, 5.8)

- **Google Classroom itself is not affected.** Revoking an OAuth grant does not
  disable or alter Classroom for the account. `[PROVEN by Google
  documentation.]`
- **Existing coursework `874805966316` is not deleted.** Removing third-party
  access does not delete data the app already created. `[PROVEN by Google
  documentation: "This doesn't delete your data on the app."]` The coursework
  remains in course "Cert 2 Lyfe Labz" (`874767260810`).
- **Chris Breezy is isolated.** CT-001 and CT-002 authorize LyfeLabz through the
  separate `Chris Breezy` Google account. Revoking the `labzlyfe` grant is a
  different account's authorization and does not touch it, **provided the
  operator revokes from the `labzlyfe` account only**. `[PROVEN: revocation is
  per-account; EXPECTED caveat: only if performed on the correct account.]`
- **cert-teacher-001 and cert-teacher-002 are not affected.** Their connections
  and tokens are backed by `Chris Breezy`, not `labzlyfe`, and their Firestore
  evidence is not touched by a Google-side action at all. `[PROVEN: distinct
  Google accounts; the emulator records are local and untouched.]`

---

## 6. Should coursework 874805966316 remain? (Task 5.6, Final Q13)

**Yes - leave it in place.** It is the real-upstream artifact of B13 Attempt 1
and is referenced by the findings doc as evidence. Per runbook §8, operator-owned
test coursework may be left in a clearly-labeled test course ("Cert 2 Lyfe
Labz" qualifies). Deleting it would remove Attempt 1 evidence for no benefit;
revocation does not require it to be deleted.

---

## 7. Will initialConnect after revocation return only readonly scopes? (Task 5.10, 6.F)

**Yes, this is the specific purpose of the revocation.** The initialConnect
authorization URL requests only `classroom.courses.readonly` +
`classroom.rosters.readonly` (`adapter.ts` `GOOGLE_CLASSROOM_INITIAL_SCOPES`),
but it also sets `include_granted_scopes=true`. That parameter adds back any
scopes the account has **previously granted to this client**. After a full
revocation, `labzlyfe` has no previously-granted LyfeLabz scopes, so
`include_granted_scopes` has nothing to add, and the resulting connection holds
exactly the two readonly scopes.

This is the same mechanism, run in reverse, that made CT-002 unusable: CT-002
reconnected with the `Chris Breezy` account that had already granted the
coursework scope, so `include_granted_scopes=true` pulled it back in.
`[PROVEN by OAuth spec + adapter source for the mechanism; the exact returned
scope set is EXPECTED and must be verified at Attempt 2 step F.]`

---

## 8. Attempt 2 architecture review (Task 6)

Intended sequence: (A) CT-004 clean; (B) revoke `labzlyfe` -> LyfeLabz; (C) sign
in locally as CT-004; (D) Import Class from Google Classroom; (E) initialConnect
with `labzlyfe`; (F) STOP and verify the connection holds exactly
courses.readonly + rosters.readonly and none of coursework.students /
coursework.me / topics.readonly; (G) import/link "Cert 2 Lyfe Labz"; (H) verify
import did not widen scopes; (I) prepare a fresh assignment; (J) "Also publish to
Google Classroom"; (K) trigger publication; (L) **cancel/deny/close** the Google
publication consent; (M) verify canonical B13 behavior (one begin, no complete,
no re-issue, no coursework, LyfeLabz assignment intact and retryable).

Assessment: **architecturally sound, with one decisive external dependency
(§9).** Specific checks:

- The revoke-first ordering is correct and necessary: without it, step E would
  re-pollute CT-004 via `include_granted_scopes=true` (the CT-002 failure mode),
  and step F would fail before B13 is even reached.
- The step-F STOP is the right gate; it is exactly the verification Attempt 1
  lacked. Do not proceed to G until F confirms readonly-only.
- Step H (import must not widen) matches PDR-030c: topic listing and import
  never trigger consent; publication is the sole consent trigger. A widening at
  H would be a real defect and should stop the run.
- Steps I - M reproduce the B9 consent trigger but with the operator cancelling
  at L instead of completing. That is the correct and only honest way to produce
  B13 (runbook §7: "Natural: cancel/close the real Google consent window").
- One caution: at step K, `include_granted_scopes=true` is still set on the
  publication authorization URL. After a clean revoke + readonly reconnect this
  is harmless (there are no extra granted scopes to fold in), but it is the same
  parameter that caused CT-002; the step-F verification is what guarantees the
  starting state is clean.

No production code should be changed to make certification easier (runbook §7,
Task 7). The `include_granted_scopes=true` / `prompt=consent` posture is the
shipped behavior and must be certified as-is.

---

## 9. Google UI uncertainty (Task 7) - flag before mutating

Does `prompt=consent` plus a genuinely revoked account reliably expose a
cancellable consent screen when the publication scopes are later requested?

- `prompt=consent` forces the consent screen to be **re-displayed** for a normal
  external / unverified OAuth app, even for already-granted scopes. For the
  publication step, `coursework.students` will be un-granted after revocation, so
  it is also a genuine new-scope request. Both conditions point to a visible,
  cancellable consent screen at step K. `[EXPECTED based on OAuth behavior.]`
- Google does **not** publish a guaranteed, itemized screen sequence for this
  flow. There is no documentation that proves the exact screens Chris will see.
  `[NOT PROVEN by Google documentation.]`
- **Flagged risk:** if the OAuth consent screen is configured as **Internal**
  (org-only) or the app is **admin-trusted / domain-wide delegated** for the
  Workspace that `labzlyfe` belongs to, Google can bypass the user consent
  screen regardless of `prompt=consent`. In that case the authorization is
  admin-conferred, not a user grant, so a user-level revocation would not restore
  a cancellable screen, and Attempt 2 would reproduce Attempt 1. `[EXPECTED
  failure mode; not proven to apply here, and not proven not to.]`

Pre-revocation gate (do this before revoking, to avoid a wasted Attempt 2):
confirm in the Google Cloud console that the certification OAuth client's OAuth
consent screen **User Type is External** (not Internal), and that `labzlyfe` is
a normal external account rather than a member of the app's Workspace org with
admin pre-authorization. If User Type is External and no admin trust applies, a
cancellable consent screen at step K is the expected outcome. If it is Internal
or admin-trusted, STOP and re-plan: revocation will not help.

The 28-second interactive gap during Attempt 1 (findings §4) is weak evidence a
screen was shown, which favors the External case, but is not conclusive.

---

## 10. Is B13 still honestly certifiable? (Final Q18)

Yes, conditionally. B13 is certifiable on the clean CT-004 fixture **iff** the
pre-revocation gate (§9) confirms an External / non-admin-trusted consent
configuration, so that a real cancellable consent screen appears at step K. If
that gate fails, B13 is not honestly certifiable by this method and must be
recorded NOT-CERTIFIABLE-HERE with the Phase 1 consent-cancellation unit tests as
the compensating evidence (runbook §7), rather than faked.

---

## 11. State mutations performed by this recovery step

- Emulator: exactly one additive write path - `SEED_CT004_ONLY` provisioned
  `cert-teacher-004` (Auth import + custom claims + `users/cert-teacher-004`
  doc). No LMS document written. CT-001/CT-002/CT-003 unchanged (verified).
- Google: none.
- Production Firestore / Auth / Functions / Secret Manager / OAuth clients:
  none.

---

## 12. The one next operator action

**Revoke the `labzlyfe` -> LyfeLabz OAuth authorization grant, from the
`labzlyfe` Google account only, per §3 - but first complete the §9
pre-revocation gate check.** Then STOP for a verification checkpoint before any
new OAuth connection. Do not sign into CT-004 yet. Do not begin initialConnect
yet.

> SUPERSEDED IN PART by §13 - §17 below (operator evidence 2026-08-17). The §3
> manual procedure assumed a visible `LyfeLabz` entry in `labzlyfe`'s Google
> Account connections. The operator checked and there is no such entry, so the
> §12 / §3 manual-UI revocation is currently BLOCKED. The §9 gate is partly
> resolved (External / In production confirmed). No revocation was performed.
> See §13 - §17 for the reassessment and the corrected next action.

---

## 13. New operator evidence (2026-08-17) - reassessment trigger

Operator (Chris) inspected Google Cloud Console for project `lyfelabz-prod`:

- Google Auth Platform -> Audience: **User type = External**, **Publishing
  status = In production**, banner "Your app requires verification."
- Signed into the real `labzlyfe` Google account and opened the Google Account
  third-party connections area.
- **Finding: `LyfeLabz` does NOT appear** in `labzlyfe`'s third-party
  connections / apps list. The operator therefore could not perform the §3
  "Delete all connections" / "Remove access" step. Nothing was removed.

No assumption is made that the operator looked in the wrong place. This section
records the reassessment; no Google-side action was taken and no token was used
against Google.

## 14. Why the §3 visibility assumption was wrong

The §3 procedure told the operator to look for the literal name **LyfeLabz**.
The Google Account connections page does not key on that string; it lists the
app by the **OAuth consent-screen App name** (Google Auth Platform ->
Branding). If that Branding field is not exactly "LyfeLabz" (a project name, a
blank/default, or any other configured brand), the grant is present but listed
under a different label, and a search for "LyfeLabz" finds nothing.

A grant can issue access + refresh tokens, hold sensitive Classroom scopes, and
support incremental authorization yet still not appear under the searched name
for documented reasons: (a) it is listed under a different consent-screen App
name; (b) consumer-account propagation lag (Google documents that third-party
app details can take time to surface); or (c) the grant was already revoked or
lapsed upstream while the local refresh token remains stored. UI absence alone
does not distinguish (a)/(b) (grant still live) from (c) (grant gone). This is
NOT proven to be an Internal-app or admin-trust bypass: External + In
production rules out Internal, and `labzlyfe@gmail.com` is a consumer account
with no Workspace admin, so admin pre-authorization / domain-wide delegation
does not apply either.

## 15. OAuth client architecture (confirmed from source)

- Authorization endpoint: `https://accounts.google.com/o/oauth2/v2/auth`
  (`adapter.ts`). Token endpoint: `https://oauth2.googleapis.com/token`.
  Revocation endpoint: `https://oauth2.googleapis.com/revoke` (`transport.ts`).
- The certification run uses the emulator OAuth client id
  `182791689935-727m5sggg0fc69ak77g4o6aeh33ju366.apps.googleusercontent.com`
  (redirect `http://localhost:5000/app/lms-callback.html`, from
  `functions/.env.local`). Production uses a different client id
  `182791689935-4bqrkrd3nnd0mab2kng2f7ltkgrk2ub9.apps.googleusercontent.com`
  (redirect `https://app.lyfelabz.com/app/lms-callback.html`). Both are Web
  application clients in the SAME Google Cloud project `182791689935`, which is
  the project the operator inspected. The connections UI groups by app/brand,
  not by individual client, so both clients surface under one connections
  entry. Client ids are non-secret; the client secret is Secret Manager only
  and is not reproduced here.
- Firebase Auth Google sign-in and the LMS Classroom OAuth are DIFFERENT OAuth
  clients. In the certification emulator, Firebase Auth is emulated (fake
  `google.com` provider), so `labzlyfe` never performed a real Firebase-Auth
  Google grant here; the only real Google grant `labzlyfe` holds is to the LMS
  client above.

## 16. Supported Google revocation mechanisms (for the record)

- **Google Account UI** (`myaccount.google.com/connections` -> Remove access):
  removes the whole user-level grant (all scopes) for the app; per Google, "this
  doesn't delete your data on the app." Requires finding the entry (blocked -
  §13).
- **Official token revocation endpoint** `https://oauth2.googleapis.com/revoke`:
  accepts an access OR refresh token; per Google docs, revoking an access token
  also revokes its corresponding refresh token, and revoking the grant removes
  the app's access; 200 on success, 400 on error. This is already implemented in
  the product as `adapter.revokeGrant` -> `transport.revokeToken`, exercised by
  the `lmsConnectionsDisconnect` callable. **The callable also mutates local
  state** (`store.revoke(tokenRef)` + connection -> `revoked`), so it must NOT be
  run against CT-003 (immutable evidence). A standalone POST of CT-003's stored
  refresh token to the revoke endpoint would revoke labzlyfe's grant without the
  local mutation, but it requires reading the token material and is deferred.
- **Google Cloud Console**: can delete/disable the OAuth client, but that is a
  production-config change affecting all users of the client (including Chris
  Breezy via CT-001/CT-002) and is out of scope for a single-account cert reset.

## 17. Corrected recovery posture - no mutation performed

No revocation was performed. The manual-UI path (§3/§12) is blocked until the
app's real connections label is known. The decisive, safe next step is a
read-only Cloud Console check of the consent-screen App name, then re-checking
`labzlyfe`'s connections for that exact name. Only if the grant is then
confirmed genuinely absent (not merely mislabeled) does revocation become
unnecessary or the programmatic endpoint (§16) become the fallback, and only
under explicit operator authorization in a later turn. CT-001/CT-002/CT-003 and
coursework `874805966316` remain untouched; nothing was staged, committed, or
pushed.

---

## 18. New operator evidence (2026-08-17, second console pass) - App name confirmed

The operator (Chris) completed the exact read-only §17 check.

- Google Cloud Console, project `lyfelabz-prod`, Google Auth Platform ->
  Branding: the exact **App name is `LyfeLabz`**. User support email
  `cgbreezy7@gmail.com`. Verification status banner: **"Your branding needs to
  be verified before it can be shown to users."**
- Signed into the real `labzlyfe` Google account, the Google Account
  third-party connections page shows **no `LyfeLabz` connection**.

Effect on the §14 hypothesis set: the **narrow** form of hypothesis (a) -
"the grant is listed under a DIFFERENT configured App name" - is **eliminated**.
The configured App name IS exactly `LyfeLabz`, yet a search for `LyfeLabz` in
`labzlyfe`'s connections finds nothing. The hypothesis that the authorization
was merely hiding under a different consent-screen App name is closed.

## 19. What the Branding "needs to be verified" message does and does not explain

The message must be read against three distinct, non-interchangeable layers.
Only the first is governed by branding verification.

1. **Consent-screen branding visibility.** Branding verification gates whether
   the app's **name and logo are displayed on the OAuth consent screen**. Until
   verified, Google presents the consent screen with a generic / unverified
   treatment instead of the intended brand. This is a **display property of the
   live consent flow**, nothing more. `[Google-documented: brand verification
   gates display of app name and logo.]`
2. **OAuth grant existence.** Whether an access + refresh token grant exists is
   a function of whether `labzlyfe` completed authorization, and is
   **independent of branding verification**. Branding verification neither
   creates nor destroys grants. `[Google-documented: verification governs
   display/scope-eligibility, not the existence of an already-issued grant.]`
3. **Google Account third-party connections visibility**
   (`myaccount.google.com/connections`). Google does **not** document that an
   unverified brand **removes** an authorized app from this list. What is
   consistent with how unbranded apps surface is that the entry appears under a
   **fallback identity** (for example a project-number or client-derived label)
   rather than the intended brand string.

**Conclusion (no speculation beyond documentation).** The Branding message can
explain why a search for the **literal string `LyfeLabz` fails** in the
connections UI (an unverified brand need not be shown under its configured App
name), but it does **not** support the conclusion that **the grant is gone**.
It therefore **reopens a mislabel variant**, it does not confirm absence of the
authorization. Distinguishing "present under a fallback label" from "genuinely
revoked / lapsed" cannot be done from a name-specific UI search alone.

## 20. Revised hypothesis set for the connections-UI absence

| # | Hypothesis | Status after §18 evidence |
|---|---|---|
| (a) | Grant listed under a DIFFERENT configured App name | **Eliminated** - App name is exactly `LyfeLabz` |
| (a') | Grant present but shown under a **fallback / non-brand label** because branding is unverified (e.g. project `182791689935`) | **Open** - newly the leading benign explanation |
| (b) | Consumer-account propagation lag | Open, weaker - hours have elapsed since Attempt 1 (13:34Z 2026-08-17) |
| (c) | Grant already revoked / lapsed upstream; local refresh token stale | Open |

A name-only search for `LyfeLabz` cannot separate (a') from (b)/(c). Internal /
admin-trust bypass remains excluded (External + In production; `labzlyfe` is a
consumer account with no Workspace admin), per §14.

## 21. Read-only re-verification of certification identities (2026-08-17)

Read read-only from the live emulator (`127.0.0.1:8080`, project
`lyfelabz-prod`) via the firebase-admin SDK. No callable invoked, no document
written, no token value or upstream account identifier printed.

| Identity | Verified state |
|---|---|
| **CT-003** | connection `active`; **4 scopes** (`courses.readonly`, `rosters.readonly`, `coursework.students`, `topics.readonly`); `coursework.me` **absent**; `scopesUpdatedAt` **2026-08-17T13:34:09.019Z** (matches §5 of findings exactly); no `revokedAt`; tokenRef present; **token bundle exists** with **refresh token present**, access token present, `expiresAtEpochMs` present; class `wo9h8rxa7696asxgcprj` (`classes`) `active`; class link `...f2d7234f` `linked`; assignment `...19e1luzjk62uh` present; publication `...b0892f93` `succeeded` (bundle JSON carries coursework `874805966316`); both OAuth states `e72c09cd` + `e02d26b7` present |
| **CT-001** | UNCHANGED - `active`; 4 scopes; `coursework.me` absent; `scopesUpdatedAt` 2026-08-16T17:07:48.502Z; no `revokedAt`; token bundle + refresh token intact |
| **CT-002** | UNCHANGED - `active`; 4 scopes (still carrying `coursework.students`, the `include_granted_scopes` pollution evidence); `scopesUpdatedAt` absent (widened only at grant, not via this field); token bundle + refresh token intact |

CT-003 B13 Attempt-1 evidence is intact and byte-for-byte unchanged. CT-001 and
CT-002 remain preserved and isolated.

## 22. Programmatic revocation - safety analysis (source-confirmed + Google-documented)

If the fallback endpoint (§16) is later authorized, a **standalone POST** of
CT-003's stored refresh token to `https://oauth2.googleapis.com/revoke`
(bypassing the `lmsConnectionsDisconnect` callable) would behave as follows.

**What it WOULD revoke.**
- Exactly `labzlyfe`'s OAuth grant to the LyfeLabz client. `adapter.revokeGrant`
  prefers the **refresh token** (`adapter.ts:378`); revoking a refresh token
  invalidates every access token minted from it. `[Source-confirmed at
  adapter.ts:375-378; Google-documented revoke contract.]` This removes all four
  scopes in one action and makes CT-003's stored credential inert upstream.

**What it would NOT affect.**
- **Chris Breezy / CT-001 / CT-002.** A grant is per `(resource-owner account,
  client)`. `labzlyfe` and `Chris Breezy` are different Google accounts, hence
  different grants and different refresh tokens, even though CT-001/002/003 all
  use the same OAuth client project `182791689935`. Revoking `labzlyfe`'s refresh
  token cannot touch Chris Breezy's separate grant. `[Google-documented:
  revocation acts on the specific token and its associated tokens within one
  grant.]`
- **Google Classroom coursework `874805966316`.** Revocation does not delete
  user data. `[Google-documented: removing access does not delete data the app
  created.]`
- **Local Firestore state.** The revoke endpoint is a Google-only call. The
  local mutations (`store.revoke(tokenRef)` + connection -> `revoked`) live in
  `connections-disconnect.ts:115-133`, **not** in `transport.revokeToken`
  (`transport.ts:743-750`). A direct POST that does not go through the callable
  therefore writes **nothing** to Firestore. CT-003's connection, token bundle,
  class, link, assignment, publication, OAuth states, and audit events remain
  byte-for-byte intact. `[Source-confirmed.]`

**Residual cost / caveats.**
- The POST requires **reading CT-003's refresh-token material** out of the
  immutable evidence bundle to send it. Reading is not a mutation, but the value
  must never be logged, printed, screenshotted, or committed.
- A standalone POST leaves **no audit event and no local record** that
  revocation occurred; the operator must record it manually in this append-only
  doc.
- Revocation is **necessary but not sufficient** for a B13 PASS. The §9
  admin-trust / auto-authorization uncertainty is **not** resolved by
  revocation: even after a clean revoke, if Google auto-authorizes the
  publication scopes without a cancellable screen, Attempt 2 reproduces
  Attempt 1. External + In production makes this less likely, not impossible.

**Post-revocation scope expectation (Task 9 / §7 restated).** After a genuine
full revocation, a fresh CT-004 `initialConnect` with `labzlyfe` should return
**only** `classroom.courses.readonly` + `classroom.rosters.readonly` despite
`include_granted_scopes=true`, because that parameter only re-adds
**previously granted** scopes for this `(account, client)` pair and, post-revoke,
there are none to fold in. `[Source + OAuth-documented mechanism; the exact
returned set must still be verified at the Attempt-2 step-F STOP gate.]`

## 23. Revised conclusion and corrected next action

**Is programmatic revocation now justified?** It is **safe** and **justified as
the fallback**, and it doubles as a definitive diagnostic (200 = grant was live
and is now reset; 400 `invalid_token` = grant was already gone, confirming (c)).
But it is **not yet the recommended FIRST action**, because the §18 evidence did
not eliminate the benign **fallback-label** hypothesis (a') - it only ruled out
an exact-name mismatch. One **strictly cheaper, strictly read-only, non-mutating**
step remains that could either resolve this without using any token OR re-enable
the safest manual-UI revocation:

> Re-scan `labzlyfe`'s **full** third-party connections list (not a search for
> `LyfeLabz`) for **any** unfamiliar entry, in particular one bearing the Cloud
> project number **`182791689935`** or a generic Google-assigned app label.

- If such an entry is found -> the grant is present under a fallback label
  (a'); use the **manual §3 "Remove access"** path on that entry. Safest, no
  token read, no programmatic call.
- If the full list is genuinely empty -> the manual path is exhausted;
  **programmatic revocation (§16/§22) becomes the recommended recovery**, to be
  executed only under explicit operator authorization in a later turn, and even
  then chiefly to force a known-clean starting state for Attempt 2 (or to
  confirm (c) if it returns 400).

**Remaining uncertainty that keeps programmatic revocation from being
"just do it":** (1) the unresolved fallback-label ambiguity (a'), which may make
the safer manual path still viable; (2) the §9 auto-authorization risk, which
revocation cannot cure and which gates whether B13 is honestly certifiable at
all; (3) the token-read handling requirement in §22.

CT-001/CT-002/CT-003 and coursework `874805966316` remain untouched. No
Google-side action was taken, no token was used against Google, and nothing was
staged, committed, or pushed by this reassessment.

---

## 24. New operator evidence (2026-08-17, third connections pass) - manual upstream revocation COMPLETED

The prior connections-UI ambiguity (§13, §18, §20) is now resolved by direct
operator action. Chris signed into the real `labzlyfe` Google account and
inspected the FULL Google Account third-party connections list (not a
name-filtered search).

- **`LyfeLabz` WAS present** in `labzlyfe`'s full third-party connections list,
  listed under the actual configured app name `LyfeLabz`. It was NOT hidden
  under a fallback project-number / client-derived label. This eliminates the
  remaining "fallback-label" hypothesis (a') from §20: the grant was real,
  present, and correctly named all along.
- Opening the `LyfeLabz` connection, Google displayed: "LyfeLabz has some access
  to your Google Account", with the visible permissions:
  1. View your Google Classroom classes
  2. View your Google Classroom class rosters
  3. Manage course work and grades for students in the Google Classroom classes
     you teach and view the course work and grades for classes you administer
  4. "+1 more"
  This is consistent with the four-scope widened authorization observed after
  B13 Attempt 1 (courses.readonly, rosters.readonly, coursework.students,
  topics.readonly).
- The operator selected Google's **"Delete all"**. Google's confirmation
  explained: some LyfeLabz features may not work after deletion; the LyfeLabz
  account and data already shared with LyfeLabz would NOT be deleted; the action
  removes the links/access between the Google Account and LyfeLabz.
- The operator clicked **Confirm**. Google then displayed the success message:
  "You're no longer using LyfeLabz with your Google Account. You can start using
  LyfeLabz again with your Google Account at any time."

**Conclusion: the manual Google-account-side revocation succeeded.** The
upstream `labzlyfe` -> LyfeLabz OAuth authorization has been removed through
Google's own account UI. This is the clean Google-account authorization baseline
for B13 Attempt 2.

Constraints observed during this step (operator-reported):
- No LyfeLabz `lmsConnectionsDisconnect` callable was used.
- No programmatic call to Google's revoke endpoint was made.
- No CT-003 local state was intentionally mutated.
- LyfeLabz was NOT reconnected; no new OAuth flow was initiated; CT-004 was not
  touched; CT-003 local state was not deleted.

## 25. Architectural consequence - programmatic revocation no longer required

The programmatic revocation fallback analyzed in §16 and §22 (a standalone POST
of CT-003's stored refresh token to `https://oauth2.googleapis.com/revoke`) is
**no longer needed**. The upstream grant was removed manually through Google's
account UI, so there is no remaining reason to read CT-003's token material or
invoke any revoke path. The §22 token-read handling caveat is therefore moot for
Attempt 2 staging. The programmatic path remains documented only as historical
analysis, not as a pending action.

## 26. Intentional local/upstream divergence - CT-003 preserved as historical evidence

CT-003's LOCAL emulator state still records the four-scope widened connection
produced by B13 Attempt 1 (`scopesUpdatedAt` 2026-08-17T13:34:09.019Z, token
bundle with refresh token, class link to course `874767260810`, succeeded
publication, coursework `874805966316`, both OAuth states, audit events). This
is EXPECTED and correct. A manual Google-account revocation removes the UPSTREAM
grant only; it does not and should not alter the local Firestore evidence.

Do NOT "repair" CT-003's local state to match the now-revoked upstream state.
The divergence is deliberate historical evidence:
- LOCAL CT-003: the state produced by B13 Attempt 1.
- UPSTREAM `labzlyfe`: grant manually revoked to create a clean baseline for
  B13 Attempt 2.

## 27. Post-revocation read-only checkpoint (2026-08-17)

Read-only inspection of the live certification emulator (`127.0.0.1:8080` /
`:9099`, project `lyfelabz-prod`) via firebase-admin. No callable invoked, no
document written, no token value or upstream account identifier printed.

| Identity | Verified state |
|---|---|
| **CT-003** | UNCHANGED - connection `active`; 4 scopes (courses.readonly, rosters.readonly, coursework.students, topics.readonly); `coursework.me` absent; `scopesUpdatedAt` 2026-08-17T13:34:09.019Z; no `revokedAt`; tokenRef present; token bundle present with refresh token; class `wo9h8rxa7696asxgcprj` ("Cert 2 Lyfe Labz") linked to course `874767260810`; assignment `...19e1luzjk62uh` published; publication `...b0892f93` succeeded (coursework `874805966316`); 2 consumed OAuth states; 8 audit events |
| **CT-001** | UNCHANGED - `active`; 4 scopes; `coursework.me` absent; `scopesUpdatedAt` 2026-08-16T17:07:48.502Z; cell-types coursework `874752057518` (succeeded pub); token bundle + refresh token intact |
| **CT-002** | UNCHANGED - `active`; 4 scopes still carrying `coursework.students` (the include_granted_scopes pollution evidence); `scopesUpdatedAt` absent; 0 class links / 0 assignments / 0 publications; 1 audit event (connectionCreated) |
| **CT-004** | CLEAN - Auth exists (Cert Teacher Four, `cert-teacher-004@lyfelabz-cert.example`, provider `google.com(cert-google-...0004)`, claims role=teacher/school-beta/district-beta, not disabled); `users/cert-teacher-004` active; 0 lmsConnections, 0 lmsTokenBundles, 0 lmsClassLinks, 0 lmsOAuthStates, 0 owned classes, 0 assignments, 0 publications, 0 audit events |

CT-004 was already provisioned by the §1 `SEED_CT004_ONLY` staging step and
required no re-seeding. It is a clean teacher identity with no Google
authorization. The `labzlyfe` Gmail address is not encoded in the fixture.

## 28. B13 Attempt-2 STOP gate (post-OAuth, before importing anything)

After the operator later signs in as CT-004 and performs initialConnect with the
real `labzlyfe` account, STOP and inspect the resulting connection before any
import. This restates §8 step F as an explicit pass/fail gate.

Expected initialConnect scope request (from `adapter.ts`
`GOOGLE_CLASSROOM_INITIAL_SCOPES`): exactly `classroom.courses.readonly` +
`classroom.rosters.readonly`. Publication scopes are NOT requested at
initialConnect; explicitly absent from the request: `classroom.coursework.students`,
`classroom.coursework.me`, `classroom.topics.readonly`. (`include_granted_scopes=true`
is still set, but after the manual revocation `labzlyfe` has no previously
granted LyfeLabz scopes to fold back in, so the returned set should be readonly
only. This is the specific behavior Attempt 2 verifies; it is NOT proven until
the live OAuth completes.)

PASS (all must hold):
- CT-004 connection `active`
- exactly TWO stored scopes
- `classroom.courses.readonly` present
- `classroom.rosters.readonly` present
- `classroom.coursework.students` absent
- `classroom.coursework.me` absent
- `classroom.topics.readonly` absent
- `scopesUpdatedAt` absent
- exactly one valid token bundle (refresh token present)
- no imported class / class link
- no assignment and no publication

STOP / FAIL (any one halts the run):
- any publication scope unexpectedly appears
- `scopesUpdatedAt` exists
- unexpected class link / assignment / publication state exists
- anything indicating the previous upstream widened grant survived the manual
  revocation (would reproduce Attempt 1 and, per §9, points to admin-trust /
  auto-authorization that revocation cannot cure)

## 29. B13 test objective preserved

Attempt 2 still tests exactly: "Teacher cancels or closes incremental
publication consent." The certifying sequence remains: readonly initial
connection -> import/link "Cert 2 Lyfe Labz" without widening (import must never
trigger consent; a widening at import is a real defect that stops the run) ->
create a fresh assignment -> select "Also publish to Google Classroom" ->
incremental publication OAuth is triggered -> the operator CANCELS / CLOSES the
Google consent window rather than granting it. The required post-cancel
evidence: LyfeLabz does not reissue OAuth automatically, no second popup, the
LyfeLabz assignment remains intact and scheduled, Google Classroom coursework is
NOT created, the teacher receives the calm retryable message, the connection
remains readonly-only after cancellation, and publication remains retryable.

Do not let the run drift into another successful authorization. The §9
admin-trust / auto-authorization uncertainty is still the decisive external
dependency and is only resolved by observing the live consent screen at the
publication step.

## 30. State mutations performed by this checkpoint

- Emulator: NONE (read-only inspection only). No seed, no re-provision - CT-004
  was already clean and complete.
- Google: NONE by this step (the manual revocation in §24 was performed by the
  operator in Google's own UI, not by this session).
- Documentation: this report appended §24 - §30 (append-only; prior sections
  unchanged).
- Production Firestore / Auth / Functions / Secret Manager / OAuth clients: none.
- VCS: nothing staged, committed, or pushed.

---

## 31. B13 Attempt-2 post-OAuth checkpoint (2026-08-17) - GATE FAIL

Read-only inspection of the live certification emulator (`127.0.0.1:8080` /
`:9099`, project `lyfelabz-prod`) via firebase-admin, immediately after the
operator completed a fresh CT-004 `initialConnect` with the real `labzlyfe`
Google account (course-selection screen reached, "Cert 2 Lyfe Labz" visible, NOT
imported). No callable invoked, no document written, no OAuth initiated by this
session, no Google contact, no token value or upstream account identifier
printed. This applies the §28 STOP gate.

### CT-004 connection observed state

- `lmsConnections/googleclassroom__cert-teacher-004`: **exists**, status
  **active**, `connectedAt` 2026-08-17T17:43:31.432Z, `revokedAt` absent,
  `scopesUpdatedAt` **absent**, `tokenRef` present.
- Stored scopes (**4, not 2**):
  1. `classroom.courses.readonly` - PRESENT (expected)
  2. `classroom.rosters.readonly` - PRESENT (expected)
  3. `classroom.coursework.students` - **PRESENT (unexpected - publication scope)**
  4. `classroom.topics.readonly` - **PRESENT (unexpected - publication scope)**
- `classroom.coursework.me` - absent.
- Token bundle: exactly **one** bundle for CT-004; `tokenRef` resolves to it;
  refresh-token material **present** (presence only; value never read/printed);
  access token present; bundle scopes **exactly match** the connection's 4
  scopes.
- OAuth state: exactly **one** `initialConnect` state (`72ff5939...`),
  `consumedAt` present; **no dangling/unconsumed flow**.
- Downstream: **0** owned classes, **0** class links, **0** assignments, **0**
  publications. Audit: **1** event `lms.connectionCreated` targeting
  `lmsConnection:googleclassroom__cert-teacher-004`. Course discovery created no
  class/link/import artifact.

### Gate evaluation

**FAIL.** The §28 STOP condition "any publication scope unexpectedly appears" is
met twice: `classroom.coursework.students` and `classroom.topics.readonly` are
both present on a connection that requested only the two readonly scopes. The
returned set is byte-identical to the CT-001 / CT-002 / CT-003 widened
`include_granted_scopes` set (`courses.readonly`, `rosters.readonly`,
`coursework.students`, `topics.readonly`). `scopesUpdatedAt` is absent, which
confirms the scopes were widened **at the grant itself** (folded in by
`include_granted_scopes=true` during initialConnect), not by a later incremental
consent - exactly the CT-002 pollution mechanism.

### What this means

The manual Google-account "Delete all" revocation recorded in §24 did **not**
reset Google's accumulated grant for the LyfeLabz OAuth client on the `labzlyfe`
account. A fresh readonly-only `initialConnect` still returned the full widened
4-scope set. Google re-associated the previously granted publication scopes to
the new authorization despite the two-scope request. This is the accumulated-scope
problem the recovery was intended to solve, and it survived manual revocation.

This is consistent with the §9 / §22 caveat that revocation is necessary but not
sufficient, and it indicates one of: (i) the "Delete all" did not fully clear the
client grant server-side (or had not propagated at 17:43:31Z), or (ii) the
`(labzlyfe, LyfeLabz-client)` pair retains accumulated scope association that
`include_granted_scopes=true` re-folds regardless of the UI-level deletion.
Distinguishing these is an architectural question, not a repair; per the run
protocol no repair, no re-import, and no new OAuth flow was performed.

### Preservation re-verification (unchanged)

- **CT-001**: active; 4 scopes (`coursework.me` absent); `scopesUpdatedAt`
  2026-08-16T17:07:48.502Z; refresh token present; 2 classes, 1 link, 11
  assignments, 6 publications (3 succeeded), 37 audit events. Cell-types
  succeeded publication `lmsAssignmentId` **874752057518** under topic
  **871946939445**, course **871447706346** - intact (B8/B11/B12 evidence).
- **CT-002**: active; 4 scopes still carrying `coursework.students` (the
  `include_granted_scopes` pollution evidence); `scopesUpdatedAt` absent;
  refresh token present; 0 classes/links/assignments/publications; 1 audit event
  (`connectionCreated`) - intact.
- **CT-003**: active; 4 scopes; `scopesUpdatedAt` 2026-08-17T13:34:09.019Z;
  refresh token present; 1 class, 1 link, 1 assignment, 1 succeeded publication;
  succeeded publication `lmsAssignmentId` **874805966316**, course
  **874767260810**; 8 audit events - intact (B13 Attempt-1 evidence,
  byte-for-byte).

### Disposition

STOP for architectural review. No repair performed. No new OAuth flow initiated.
CT-004's polluted connection is left as-is as the evidence of this failure; it
must NOT be imported/linked, and no assignment/publication should be attempted on
it, because its starting state is not readonly-only. The B13 test objective (§29)
requires a genuinely readonly-only starting connection, which this attempt did
not produce.

### State mutations performed by this checkpoint

- Emulator: NONE (read-only inspection only).
- Google: NONE.
- Documentation: this report appended §31 (append-only; prior sections
  unchanged).
- Production Firestore / Auth / Functions / Secret Manager / OAuth clients: none.
- VCS: nothing staged, committed, or pushed.

**B13 ATTEMPT-2 POST-OAUTH GATE FAIL - STOP**

---

## 32. Reclassification of Attempt 2 (2026-08-17) - supersedes the §31 conclusion in part

This section revisits the §31 conclusion in light of the revocation-to-reconnect
elapsed time and Google's revocation semantics. It does NOT erase §31; §31's
read-only observations stand exactly as recorded (CT-004 returned four scopes;
the gate failed on the readonly-only precondition). What is corrected is §31's
INTERPRETIVE overreach: the phrasings that the "Delete all" revocation "did
**not** reset Google's accumulated grant" and that the accumulated-scope problem
"survived manual revocation" are **too strong** for the evidence. They are
superseded by the narrower, defensible classification below.

### 32.1 Revised classification

**POST-REVOCATION RETEST INCONCLUSIVE - NOT DISTINGUISHABLE FROM REVOCATION
PROPAGATION LAG (Attempt 2 invalidated as a clean readonly baseline; retained as
historical evidence).**

The Attempt-2 retest was run only about eight minutes after the operator's
Google-side "Delete all". That window is too short to conclude that manual
revocation permanently fails to clear the accumulated `(labzlyfe, LyfeLabz-client)`
scope association. The four-scope result is equally consistent with (i) a
revocation that had not yet fully propagated server-side at reconnect time and
(ii) a durable accumulated-scope association that `include_granted_scopes=true`
re-folds regardless of the UI-level deletion. Attempt 2 cannot separate (i) from
(ii). Therefore it invalidates the run as a clean readonly baseline but does not
prove permanent retained-grant behavior.

### 32.2 PROVEN vs NOT PROVEN

PROVEN (backend-verified / operator-observed):
- CT-004's fresh `initialConnect` returned exactly four scopes
  (`courses.readonly`, `rosters.readonly`, `coursework.students`,
  `topics.readonly`), byte-identical to the widened `include_granted_scopes` set
  (§31). `scopesUpdatedAt` absent, so the widening happened AT the grant, not via
  a later incremental consent.
- The connection was created ~8 minutes after the operator's confirmed Google
  "Delete all" success message (§24, §35).
- `include_granted_scopes=true` re-adds previously granted scopes for the
  `(account, client)` pair (Google-documented; §34).

NOT PROVEN:
- WHY Google still returned the four scopes (propagation lag vs durable
  accumulated-scope retention vs something else).
- Whether the grant would have been cleared after a longer wait.
- The exact propagation duration Google needs (Google publishes none; §34).
- That the "Delete all" permanently fails - a single 8-minute test cannot
  establish permanence.

## 33. What Google's primary OAuth documentation actually says (verification result)

Task 2 required verifying the revocation-semantics claims against **current
primary Google OAuth documentation only** (not forums, not inference). Pages
checked read-only this pass:
`https://developers.google.com/identity/protocols/oauth2/web-server` and
`https://developers.google.com/identity/protocols/oauth2`.

1. **Scope of revocation.** These pages describe revocation via the
   `https://oauth2.googleapis.com/revoke` endpoint and the account-level
   "Revoke current credentials" / connections page, and state that after
   revoking, the app hits an `invalid_grant` error. The whole-grant / all-scopes
   framing and "removing access does not delete your data" language used earlier
   in this report (§16, §22) is consistent with Google's account-UI help text and
   is retained. `[Google-documented.]`
2. **`include_granted_scopes` behavior.** Confirmed verbatim: "If you set this
   parameter's value to `true` and the authorization request is granted, then the
   new access token will **also cover any scopes to which the user previously
   granted the application access**." This is exactly the re-fold mechanism that
   produced the four-scope CT-004 result. `[Google-documented, verbatim.]`
3. **Propagation-delay warning - NOT CONFIRMED in primary docs.** The specific
   wording that revocation "might take some time before the revocation has full
   effect" was **not found** on either primary Google OAuth page checked this
   pass. Honesty requires stating this plainly: the report does **not** rest the
   reclassification on a Google-documented propagation delay, because that exact
   statement could not be verified in primary Google OAuth documentation.
   `[NOT PROVEN from the primary Google OAuth pages checked. Do not cite Google as
   the source of a "revocation takes time" guarantee.]`
4. **Exact propagation duration.** Google publishes **no** exact duration or
   guaranteed waiting period for revocation to take full effect, and equally
   publishes no guarantee that revocation is instantaneous or atomic. `[Google
   documents no duration in either direction.]`

**Consequence for the reclassification.** The §32 classification does not depend
on a documented Google delay. It rests on the weaker but solid ground that (a)
Google nowhere documents revocation as instantaneous/atomic, (b) the retest ran
only ~8 minutes after revocation, and (c) a single short-window test cannot
distinguish propagation lag from durable accumulated-scope retention. The burden
of proof is on the claim "manual revocation permanently fails," and one
8-minute test does not meet it.

## 34. Exact revoke-to-reconnect elapsed time

| Event | Timestamp | Source |
|---|---|---|
| Operator "Delete all" success message (§24) | ~2026-08-17 13:35 local (~17:35Z) | **operator-reported**, not backend-verifiable |
| CT-004 `connectedAt` (§31) | 2026-08-17T17:43:31.432Z (13:43:31 local, UTC-4) | **backend-verified** Firestore |

Elapsed: **approximately 8 to 9 minutes** (~8m31s using the operator's ~17:35Z
revocation instant). The reconnect instant is backend-verified; the revocation
instant is operator-reported and cannot be verified backend-side, so treat "~8
minutes" as approximate.

## 35. CT-004 is preserved as Attempt-2 historical evidence

CT-004 is now frozen exactly as CT-003 was frozen for Attempt 1. Do NOT: import a
class, create/link a class, create an assignment, publish, initiate any OAuth
flow, disconnect, overwrite/reconnect the connection, delete its OAuth state, or
delete its token bundle. Do not repurpose the `cert-teacher-004` identity.

Recorded CT-004 Attempt-2 state (from §31, read-only):
- connection `googleclassroom__cert-teacher-004` **active**, `connectedAt`
  2026-08-17T17:43:31.432Z, `revokedAt` absent.
- **four** scopes received immediately at initialConnect (`courses.readonly`,
  `rosters.readonly`, `coursework.students`, `topics.readonly`); `coursework.me`
  absent.
- `scopesUpdatedAt` **absent** (widened at the grant by `include_granted_scopes`,
  not by later incremental consent).
- exactly one token bundle (refresh token present, value never read/printed),
  scopes matching the connection.
- exactly one consumed `initialConnect` OAuth state; no dangling flow.
- **zero** owned classes, class links, assignments, publications; one
  `lms.connectionCreated` audit event.

Identity distinction preserved:

| Identity | Distinguishing evidence |
|---|---|
| **CT-002** | `include_granted_scopes` reuse of the **Chris Breezy** account: reconnected against an account that had already granted the coursework scope, so the readonly reconnect folded it back in. No downstream artifacts. |
| **CT-003** | B13 **Attempt 1** - successful incremental widening + real publication; coursework **874805966316** in course **874767260810**; `scopesUpdatedAt` 2026-08-17T13:34:09.019Z. |
| **CT-004** | B13 **Attempt 2** - post-manual-revocation `initialConnect` performed only ~8 minutes after "Delete all", still received the accumulated four-scope set; zero downstream artifacts. Distinct from CT-002 because the revocation was against the **labzlyfe** account (not Chris Breezy) and was a fresh grant, not a plain reuse. |

## 36. CT-004's initialConnect recreated a live labzlyfe -> LyfeLabz grant

CT-004 completed a real OAuth authorization with the `labzlyfe` account and now
holds a live token bundle with a refresh token and four scopes. That is, by
definition, a **recreated** `labzlyfe` -> LyfeLabz grant. The §24 "Delete all"
baseline no longer holds: the account is authorized to the client again.

**Therefore a second manual "Delete all" is required** before any Attempt 3, for
the same reason the first one was required: without removing the grant, a fresh
readonly `initialConnect` will again re-fold the accumulated publication scopes
via `include_granted_scopes=true`. `[Grant existence: backend-verified via
CT-004's token bundle. Re-fold mechanism: Google-documented, §33.2.]`

This is the one substantive difference from the §24 state: revocation must now be
repeated because our own certification action re-authorized the account.

## 37. Attempt-3 architecture (reviewed)

Recommended sequence, on a fresh identity so CT-004 stays immutable:

- **A.** Preserve CT-004 (and CT-001/002/003) untouched.
- **B.** Manually "Delete all" the labzlyfe -> LyfeLabz connection AGAIN (§36),
  from the `labzlyfe` account only.
- **C.** Verify in Google's connections UI that LyfeLabz no longer appears.
- **D.** **WAIT** for a conservative propagation window (§38) with NO LyfeLabz
  OAuth of any kind during the wait.
- **E.** Provision a fresh isolated identity **cert-teacher-005** (additive seed
  only; see §39 for now-vs-later).
- **F.** Sign in as CT-005 and perform a single readonly `initialConnect` with
  `labzlyfe`.
- **G.** STOP immediately after initialConnect - before any import/link.
- **H.** Verify the §28 gate: **exactly two** scopes (`courses.readonly` +
  `rosters.readonly`), all three publication scopes absent, `scopesUpdatedAt`
  absent. Only then proceed to import and the B13 cancel test.

Assessment: **sound.** It is the §8/§28 architecture with two corrections forced
by Attempt 2 - a repeated revocation (because CT-004 recreated the grant) and a
real waiting period (because the 8-minute gap is the specific weakness that made
Attempt 2 inconclusive). The unresolved §9 auto-authorization risk still gates
whether B13 is honestly certifiable at all and is NOT cured by any of this; it is
only settled by observing the live consent screen at the publication step.

If Attempt 3 - run after a genuine wait - STILL returns four scopes, that is
strong (not yet absolute) evidence for durable accumulated-scope retention
(mechanism ii), and B13 would then be recorded NOT-CERTIFIABLE-BY-THIS-METHOD
with the Phase 1 consent-cancellation unit tests as the compensating evidence
(runbook §7). A delayed Attempt 3 is therefore informative either way.

## 38. Waiting strategy (no invented Google SLA)

Google publishes no propagation SLA (§33.4), so this is a conservative operator
choice, not a guarantee.

| Wait | Assessment |
|---|---|
| 30 min | Only marginally better than the 8-minute failure; if it fails, still weak at distinguishing lag from retention. Not recommended. |
| 1 hour | Better, but a still-polluted result remains ambiguous. Acceptable floor, not preferred. |
| Several hours | Meaningfully stronger; propagation lag becomes an unlikely explanation for a persisting pollution. Acceptable. |
| Overnight / next day | Strongest. If pollution persists after ~12+ hours, propagation lag is implausible and the result cleanly favors durable retention; if it clears, Attempt 3 gets its clean readonly baseline. |

**Recommendation: revoke now, resume Attempt 3 later - overnight / next day is
preferred; several hours is the acceptable minimum.** Because "clean evidence >
speed" is the stated priority, prefer the overnight wait: it converts an
ambiguous retest into an informative one regardless of outcome. Do NOT retry at
30-60 minutes - a second short-window ambiguous result adds no evidence.

## 39. CT-005: provision now or later?

**Later - provision CT-005 at the start of Attempt 3, not now.** Provisioning is
additive and low-risk in principle (the `SEED_CT004_ONLY` pattern), but doing it
now yields no benefit during the wait (CT-005 would sit idle), it would require
either an existing isolated seed mode or a new `SEED_CT005_ONLY` code path
(a code change the current STOP posture forbids), and the current directive is to
mutate nothing. Deferring keeps this pass strictly read-only + documentation.

## 40. Preservation result (Task 8) - source: §31 read-only checkpoint

No new emulator I/O was performed in this pass, to honor the STOP / no-reseed /
no-restart directive and avoid any risk to the frozen evidence. Preservation is
confirmed from the §31 read-only checkpoint (2026-08-17, post-Attempt-2, the most
recent recorded read-only verification). A fresh read-only re-verification can be
run on explicit request.

| Identity | Preservation (per §31) |
|---|---|
| **CT-001** | INTACT - active; 4 scopes (`coursework.me` absent); cell-types succeeded publication `874752057518` under topic `871946939445`, course `871447706346` (B8/B11/B12 evidence). |
| **CT-002** | INTACT - active; 4 scopes still carrying `coursework.students` (include_granted_scopes pollution evidence); 0 downstream artifacts. |
| **CT-003** | INTACT - active; succeeded publication coursework **874805966316**, course **874767260810**; `scopesUpdatedAt` 2026-08-17T13:34:09.019Z (B13 Attempt-1 evidence, byte-for-byte). |
| **CT-004** | INTACT - active; four scopes; `scopesUpdatedAt` absent; token bundle with refresh token; **zero** classes / class links / assignments / publications (no downstream artifacts to protect beyond the connection + token bundle + one OAuth state). |

## 41. State mutations and VCS for this reclassification pass

- Emulator: **NONE** (no read, no write - preservation sourced from §31).
- Google: **NONE** (no revocation, no OAuth, no token used).
- Documentation: this report appended §32 - §42 (append-only; §1 - §31 unchanged;
  §31's overly strong conclusion superseded in interpretation by §32, not erased).
- Production Firestore / Auth / Functions / Secret Manager / OAuth clients: none.
- VCS: nothing staged, committed, or pushed.

## 42. The one next operator action

**Manually "Delete all" the newly recreated `labzlyfe` -> LyfeLabz Google Account
connection again (§36), from the `labzlyfe` account only, then STOP.** Do not
combine it with any reconnection, import, or new OAuth flow. The propagation wait
(§38) and CT-005 provisioning (§39) come in a later turn, after this revocation
is confirmed in Google's connections UI.

**B13 ATTEMPT-2 PRESERVED - DELAYED ATTEMPT-3 REQUIRED**

---

## 43. B13 investigation CLOSED (2026-08-17) - supersedes the §42 next action

The fixture-manufacturing effort (Attempt 1, Attempt 2, and the planned delayed
Attempt 3) is **stopped**. No Attempt 3 will be run, no CT-005 provisioned, no
further Google revocation performed, and no OAuth flow initiated. The decision
and its rationale are recorded in the new closure document
`SPRINT_25_B13_ARCHITECTURE_REASSESSMENT_AND_CLOSURE.md`.

Summary of the closure (full detail in that document):

- **Why stopped:** reproducing a readonly-only Google grant is blocked by
  `include_granted_scopes=true` plus Google's durable accumulated-scope
  association for the `(labzlyfe, LyfeLabz-client)` pair. Repeated revocation
  plus an overnight propagation wait is disproportionate to an edge case whose
  LyfeLabz-side behavior is already deterministically unit-tested.
- **What was learned (read-only architecture review):** the account chooser
  appears because `adapter.beginOAuth` sends `prompt=consent` with **no
  `login_hint`** and its input contract carries no account identifier
  (`adapter.ts:252-268`, `provider.ts:159-163`). Identity continuity of the
  stored connection **is** enforced, reactively, by the widening-time
  `lms.identityMismatch` check (`connections-complete.ts:232-239`), so a wrong
  account can be shown but can never corrupt the connection. Subsequent
  publishing after the grant is silent (`assignments-publish.ts:304-321`).
- **B13 disposition:** **PASS WITH LIMITATION.** Core feature certified live
  (CT-001 B8/B11/B12, CT-003 Attempt 1); the cancel-consent branch is covered by
  compensating unit tests (`assignments-publish.test.ts:417-465`,
  `connections-complete-oauth-state.test.ts:464-507`).
- **Sprint 25:** **NOT blocked.**
- **Recommended follow-up (later sprint, not Sprint 25):** add `login_hint`
  account continuity so the chooser is suppressed and the connected account is
  pre-selected.

CT-001, CT-002, CT-003, and CT-004 remain frozen and are not disturbed by this
closure. Coursework `874805966316` remains in place. This section wrote nothing
to the emulator, called no Google API, used no token, and staged/committed/pushed
nothing.

**B13 CLOSED - PASS WITH LIMITATION - SEE SPRINT_25_B13_ARCHITECTURE_REASSESSMENT_AND_CLOSURE.md**
