# Sprint 25 - B13 Certification Findings

Status: **B13 Attempt 1 - ATTEMPTED / NOT PASSED.** B13 (browser checklist
§B13, "Teacher cancels or closes consent") requires the operator to cancel or
close the real Google consent window and then observe that no scope widening,
no re-issued publish, and no coursework creation occur. In Attempt 1 the
cancellation condition was never exercised: the consent flow instead completed,
the connection widened, and a real Google Classroom coursework item was created.
The fixture itself was valid and readonly-only before the attempt. Attempt 1 is
therefore preserved here as historical evidence, and B13 is re-planned as
**Attempt 2** on a fresh isolated identity (`cert-teacher-004`).

Style: no em dashes. Use " - " (spaced hyphen).

This is an append-only findings record. No production code was changed to
author it. No Firestore document, callable, OAuth state, connection, token
bundle, or Google Classroom resource was modified. Nothing was staged or
committed. All backend values below were read read-only from the live
certification emulator (project `lyfelabz-prod`, Firestore `127.0.0.1:8080`,
Functions `5001`, Auth `9099`), which is running with
`--import ./sprint25-b9-pre-retest` and holds the live post-import state.

Governing documents:
- `SPRINT_25_BROWSER_CERTIFICATION_CHECKLIST.md` §B13 (canonical criterion)
- `SPRINT_25_CERTIFICATION_RUNBOOK.md` §5 step 6, §5 connection-state matrix,
  §7 failure-injection rules
- `SPRINT_25_B11_B12_CERTIFICATION_FINDINGS.md` §9 ("Next canonical
  checkpoint": B13, and the "do not disturb the widened CT-001 connection"
  guard)
- `SPRINT_25_B8_CERTIFICATION_FINDINGS.md` (the CT-001 widened-connection
  evidence this document must not disturb)

---

## 1. Canonical checkpoint under test

**B13** (browser checklist §B13): "Teacher cancels or closes consent."
Canonical setup: a readonly-only connection; toggle publication on; confirm;
**when the consent prompt appears, cancel or close it.** Canonical PASS
criterion: "PASS when cancellation produces no re-issue, no second popup, and
leaves the LyfeLabz assignment intact and retryable." Canonical evidence
requirement: "Functions log shows one begin, **no successful complete, and no
re-issued publish.**"

The decisive, required behavior for a B13 PASS is a **cancelled / denied /
closed** consent window that yields **no** `lmsConnectionsComplete`, **no**
scope widening, and **no** coursework creation.

---

## 2. B13 Attempt 1 - classification

**ATTEMPTED / NOT PASSED.**

Reason: the cancellation condition was never exercised. The consent flow that
B13 requires the operator to cancel instead ran to completion. Google
authorized the additional publication scopes, the connection widened, the token
bundle rotated, LyfeLabz re-issued the publication exactly once, and real
Google Classroom coursework `874805966316` was created. A completed consent is
the opposite of the state B13 certifies, so B13 cannot be marked PASS on this
attempt.

Attempt 1 is **not** a product defect and **not** an invalid fixture:

- The fixture was valid. Before the attempt, `cert-teacher-003` held a genuine
  readonly-only connection (exactly `classroom.courses.readonly` and
  `classroom.rosters.readonly`), established through the app with the real
  `labzlyfe` Google account, the same isolated-identity convention used for
  CT-002 and CT-003 in `seed-emulator.js`.
- The product behaved correctly through the successful widening / publication
  path: a first publish on a readonly-only token returned
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT`; incremental consent was requested for
  exactly the publication capability; on completed consent the connection
  widened and the publish was re-issued exactly once and succeeded. That is the
  certified B9 -> B8 happy path, not a B13 observation.
- What failed was the **certification opportunity**, not the code: the test
  environment did not present the operator with a consent state they cancelled.
  Whether the Google consent screen appeared and was completed rather than
  cancelled, or whether Google auto-authorized the publication scopes without a
  cancellable screen, cannot be proven from local backend evidence.

Explicitly not claimed: this document does **not** assert as fact that the
`labzlyfe` account or the OAuth app is admin-trusted / internal / org-scoped.
That is one possible explanation for a missing cancellable screen, but it is
unproven here. See §6 for the residual uncertainty this creates for Attempt 2.

---

## 3. Attempt 1 fixture and target (preserved evidence)

| Item | Value |
|---|---|
| LyfeLabz teacher (Auth uid) | `cert-teacher-003` |
| Real Google account used | `labzlyfe` (distinct from the `Chris Breezy` account backing CT-001/CT-002) |
| Google course (display name) | Cert 2 Lyfe Labz |
| Google course id | `874767260810` |
| LyfeLabz class id | `wo9h8rxa7696asxgcprj` |
| LyfeLabz class link id | `wo9h8rxa7696asxgcprj__googleclassroom__f2d7234f` (status `linked`) |
| LyfeLabz connection | `googleclassroom__cert-teacher-003` |
| Lesson assigned | What Is Life? (slug `what-is-life`) |
| LyfeLabz assignment id | `a-what-is-life-wo9h8rxa7696asxgcprj-cert-teacher-0-19e1luzjk62uh` |
| Publication record | `...19e1luzjk62uh__googleclassroom__b0892f93` (status `succeeded`) |
| Google coursework created | `874805966316` |
| Coursework URL (stored) | `https://classroom.google.com/c/ODc0NzY3MjYwODEw/a/ODc0ODA1OTY2MzE2/details` |
| Topic | none selected; no `lmsTopicId` stored |

The stored coursework URL base64 segments decode to course `874767260810`
(`ODc0NzY3MjYwODEw`) and coursework `874805966316` (`ODc0ODA1OTY2MzE2`), the
same two ids recorded above.

---

## 4. Attempt 1 timeline (backend-verified, UTC)

All timestamps are read from the live emulator Firestore documents. The
operator-reported draft-begin time and the persisted `createdAt` differ by
~0.14s (begin vs. persist) and are consistent.

| Step | Event | Evidence timestamp |
|---|---|---|
| initialConnect | OAuth state `e72c09cd...` issued (`intent: initialConnect`) | 2026-08-17T13:11:23.580Z |
| initialConnect | state consumed; readonly connection established | 2026-08-17T13:12:14.731Z / connectedAt 13:12:15.338Z |
| import/link | class link `f2d7234f` created (course `874767260810`) | 2026-08-17T13:22:51.519Z |
| assignmentsCreateDraft | operator-reported begin | 2026-08-17T13:33:38.910Z |
| assignmentsCreateDraft | assignment persisted (`createdAt`) | 2026-08-17T13:33:39.053Z |
| assignmentsPublish | LyfeLabz activation (`publishedAt` on assignment) | 2026-08-17T13:33:39.457Z |
| lmsAssignmentsPublish (1st) | real Google 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` on the readonly token | (no record written; non-terminal insufficient-scope) |
| lmsConnectionsBegin | publication-intent OAuth state `e02d26b7...` issued (`intent: publication`) | 2026-08-17T13:33:40.014Z |
| Google authorization | operator completed the real Google authorization | (28s interactive gap follows) |
| lmsConnectionsComplete | publication OAuth state consumed | 2026-08-17T13:34:08.564Z |
| token rotation | new token bundle `lms_token_11bbb738...` created (4 scopes) | 2026-08-17T13:34:09.010Z |
| connection widened | connection `scopesUpdatedAt` stamped (4 scopes) | 2026-08-17T13:34:09.019Z |
| lmsAssignmentsPublish (re-issue) | succeeded; coursework `874805966316` created | 2026-08-17T13:34:09.575Z |

The ~28-second gap between the publication OAuth state being issued
(13:33:40.014Z) and consumed (13:34:08.564Z) is consistent with a human
interacting with a real Google consent screen. That is evidence, not proof,
that a consent screen was shown; it does not establish whether a cancel control
was available or was simply not used.

---

## 5. Post-attempt scope state (preserved)

After Attempt 1, connection `googleclassroom__cert-teacher-003` (status
`active`) and token bundle `lms_token_11bbb738c95eeea042017266b8b03ce7` both
hold exactly four scopes:

- `https://www.googleapis.com/auth/classroom.courses.readonly`
- `https://www.googleapis.com/auth/classroom.rosters.readonly`
- `https://www.googleapis.com/auth/classroom.coursework.students`
- `https://www.googleapis.com/auth/classroom.topics.readonly`

`classroom.coursework.me` remains **absent** (consistent with the PDR-030g
scope correction; the widening used `classroom.coursework.students`).

`scopesUpdatedAt` = **2026-08-17T13:34:09.019Z** (backend-verified, matches the
recorded value exactly).

No topic was selected and no `lmsTopicId` was stored on the publication.

Sensitive material NOT recorded here (per runbook §6): the token bundle also
carries a real access token, a real refresh token, an `expiresAtEpochMs`, and
an upstream Google account identifier (`sub`). These are intentionally omitted
from this document. They exist in the emulator token bundle and must never be
copied into any doc, log, screenshot, or commit.

---

## 6. Why Attempt 1 is honestly not a B13 PASS, and what it does and does not prove

- **Proven:** the readonly-only starting fixture was genuine; the
  insufficient-scope -> incremental-consent -> single re-issue -> real
  coursework path executed correctly end to end; the widened scope set is
  exactly the four expected scopes with `coursework.me` absent.
- **Not proven:** the exact Google-side UI reason the operator did not land on a
  cancelled consent state. The local records cannot distinguish "a consent
  screen appeared and was completed instead of cancelled" from "Google
  auto-authorized without exposing a cancel opportunity."
- **Not asserted:** that `labzlyfe` or the OAuth app is admin-trusted /
  internal. This is a candidate explanation only and is not evidenced locally.

Because a B13 PASS requires a **cancelled** consent and Attempt 1 produced a
**completed** consent, Attempt 1 is `ATTEMPTED / NOT PASSED`. B13 remains
honestly certifiable on a fresh readonly-only fixture, subject to the residual
uncertainty in §8.

---

## 7. cert-teacher-003 is now IMMUTABLE historical evidence

`cert-teacher-003` and every artifact it owns are frozen as the permanent
record of B13 Attempt 1. From this point forward, do **not**:

- overwrite, reconnect, disconnect, or delete its connection
  (`googleclassroom__cert-teacher-003`);
- delete its token bundle (`lms_token_11bbb738c95eeea042017266b8b03ce7`);
- delete its class (`wo9h8rxa7696asxgcprj`) or class link
  (`wo9h8rxa7696asxgcprj__googleclassroom__f2d7234f`);
- delete its assignment (`...19e1luzjk62uh`) or its succeeded publication
  (`...__googleclassroom__b0892f93`);
- delete its OAuth states (`e72c09cd...` initialConnect, `e02d26b7...`
  publication);
- delete its audit events;
- delete or edit the real Google Classroom coursework `874805966316` in course
  `874767260810`.

**Cleanup / reseed guard.** A future cleanup, reseed, or emulator restart must
NOT treat `cert-teacher-003` as a disposable failed fixture. It is not a failed
fixture; it is the evidence of a valid fixture whose certification attempt
completed the wrong path. Note two distinct risks:

1. `seed-emulator.js` never writes or deletes any LMS document, so re-running it
   cannot by itself erase CT-003's LMS evidence. However a full (non-isolated)
   run does delete-and-reimport CT-003's Auth record; prefer the isolated
   `SEED_CT004_ONLY` mode when only CT-004 is needed.
2. The decisive risk is the **live emulator state itself**: it exists only in
   the running process memory plus the `--import` snapshot. A restart without a
   fresh export, a re-import of an older snapshot, or a manual collection clear
   would destroy the CT-003 (and CT-001/CT-002) live evidence. Do not restart,
   re-import, or clear the certification emulator without first exporting and
   preserving the current state.

The revocation planned for Attempt 2 (see §8) is performed **Google-side against
the `labzlyfe` account** and will make CT-003's stored refresh/access tokens
non-functional upstream. This does **not** delete or alter any CT-003 Firestore
document; the LyfeLabz-side evidence records persist byte-for-byte. CT-003 is
frozen and will not be exercised against live Google again, so the upstream
token becoming inert is acceptable and expected.

---

## 8. B13 Attempt 2 - plan and residual uncertainty

Attempt 2 uses a fresh isolated identity, `cert-teacher-004` (provisioned via
the additive `SEED_CT004_ONLY` mode; see the Sprint 25 recovery report), so
CT-003 is never disturbed.

The readonly-only precondition for B13 cannot be met simply by reconnecting
`labzlyfe` again, because the LyfeLabz authorization URL sets
`include_granted_scopes=true` (`adapter.ts`). `labzlyfe` now holds the
publication scopes from Attempt 1, so a fresh readonly initialConnect by that
account would pull those scopes back into the new connection - the exact
`include_granted_scopes` pollution that made CT-002 unusable. Therefore Attempt
2 requires **revoking the `labzlyfe` -> LyfeLabz authorization grant first**, so
a subsequent readonly initialConnect returns only
`classroom.courses.readonly` + `classroom.rosters.readonly`.

Residual uncertainty (flagged before any mutation): Google does not document a
guaranteed visible screen sequence. `prompt=consent` forces re-display of the
consent screen for a normal external/unverified app, which is the case that
gives the operator a cancel opportunity at publication. But if the app/account
relationship is org-internal or admin-trusted, the consent screen can be
bypassed regardless of `prompt=consent`, and revocation of a user grant would
not restore a cancellable screen. This possibility must be checked (OAuth
consent screen User Type; whether `labzlyfe` is inside the app's Workspace org)
before the revocation, or Attempt 2 risks reproducing Attempt 1. The 28-second
interactive gap in Attempt 1 (§4) is weak evidence a screen did appear, which
slightly favors the external/unverified case, but does not settle it.

The full Attempt 2 architecture review and the exact operator revocation
procedure are recorded in the Sprint 25 recovery report accompanying this
findings document.

---

## 9. Verification performed for this document

- Read the canonical B13 criterion (`SPRINT_25_BROWSER_CERTIFICATION_CHECKLIST.md`
  §B13) and the runbook ordering / connection-state matrix / failure-injection
  rules (`SPRINT_25_CERTIFICATION_RUNBOOK.md` §5, §7).
- Read the live emulator (read-only) and captured, for CT-003: the connection,
  token bundle (scopes only; secrets omitted), class link, assignment,
  succeeded publication, both OAuth states, and audit events. Correlated every
  value above against those documents.
- Confirmed the OAuth authorization parameters in source
  (`adapter.ts`: `include_granted_scopes=true`, `prompt=consent`,
  `access_type=offline`; initialConnect scope set vs. publication scope set).
- No callable was invoked; no Firestore, OAuth, connection, token, or Google
  Classroom resource was modified; nothing was staged or committed.
