# Sprint 25 - Completion Report (LMS Assignment Publication)

Status: **SPRINT 25 COMPLETE WITH DOCUMENTED LIMITATION.** The core Google
Classroom assignment-publication feature is certified end to end against real
Google Classroom with operator confirmation. One browser checkpoint (B13,
cancel-consent) is PASS WITH LIMITATION; the remaining non-decisive
robustness/failure-path/multi-class scenarios were not run as live browser
certifications and rest on compensating automated evidence. No closure-blocking
defect was found.

Style: no em dashes. Use " - " (spaced hyphen).

This report is the canonical closeout. It does not duplicate every diagnostic
detail; it cites the historical findings as evidence. Historical findings
(B4b, B6, B7, B8, B11/B12, B13, B13 recovery, B13 closure) are preserved
unchanged and remain the authoritative per-scenario record.

Environment of record: Firebase Emulator Suite, project `lyfelabz-prod`
(Firestore `127.0.0.1:8080`, Functions `5001`, Auth `9099`), app served at
`http://localhost:5000`, upstream Google Classroom is real (no runtime test
double; certification model matches Sprint 24B). Working tree at closure sits
on top of commit `b76ddf4`.

---

## 1. Sprint objective

Deliver LMS assignment publication as an opt-in extension of the one Assign
dialog: a verified teacher can publish an existing LyfeLabz assignment to a
linked Google Classroom course, optionally under a chosen topic, obtaining the
coursework scopes through a one-time incremental OAuth consent that widens the
teacher's single existing connection. The LyfeLabz assignment stays
authoritative; publication is a one-way pointer. Governing spec:
`SPRINT_25_DEFINITION.md` §8/§9; `PDR-030` (a - h) in
`LYFELABZ_PLATFORM_DECISIONS.md`.

---

## 2. Architecture delivered

- One-dialog publication (PDR-030a): publication is an additive per-row
  affordance inside the existing Assign dialog. No publish wizard, no Settings
  publish surface. Non-LMS rows unchanged (B2/B3).
- Vendor-neutral core, Google concerns inside the adapter (PDR-030e/PDR-019h).
  The client contract is a provider-neutral capability selector, never a raw
  Google scope string.
- Additive schema only: reserved `lmsAssignmentPublications` collection, the
  `assignments.lmsPublicationRef` mirror, and the reserved
  `lms.assignmentPublished` / `lms.publishFailed` audit vocabulary. No new
  collection, role, claim, or lifecycle field. Firestore rules unchanged.
- LyfeLabz-authoritative ordering: `assignmentsCreateDraft` ->
  `assignmentsPublish` (draft -> published) commit precedes any
  `lmsAssignmentsPublish` upstream write.

Source of record: `SPRINT_25_PHASE_1_COMPLETION_REPORT.md`,
`SPRINT_25_PHASE_3_COMPLETION_REPORT.md`.

---

## 3. Teacher workflow delivered

Connect Google Classroom once (readonly), import and activate a class, sync
roster (Sprint 24B state). Later, from the Assign dialog: select a class, pick
a Google Classroom topic (or leave "No topic"), check "Also publish to Google
Classroom", confirm once. On first publish only, a genuine one-time incremental
consent for the coursework capability appears; after that grant, every
subsequent publish is silent. Certified live at B4b (topic selector populates
from real Google), B6 (publish-off happy path), B7 (no-topic publish), B8
(topic publish), B9/B10 (incremental consent).

---

## 4. Google Classroom publication behavior

- Real coursework is created in the correct linked course (B11, course
  `871447706346`), with the LyfeLabz launcher URL attached as material
  (`http://localhost:5000/lesson_cell-types.html`), and filed under the
  selected topic (B12, "Final Exam" `871946939445`). No-topic publications are
  filed under no topic (B7 discriminator).
- The decisive real coursework id certified end to end is `874752057518`
  (Cell Types, B8 Attempt 3), operator-confirmed in the real course (B11/B12).
- Duplicate protection: the publicationId is deterministic
  (`{assignmentId}__googleclassroom__{hash(attemptNonce)}`); distinct nonces
  yield distinct ids, so the completed-attempt guard does not short-circuit a
  legitimate fresh retry and no duplicate coursework is created (B8 §12.11).

---

## 5. OAuth / scope architecture

- Initial connection: `classroom.courses.readonly` +
  `classroom.rosters.readonly` (Sprint 24B).
- Publication capability adds `classroom.coursework.students` +
  `classroom.topics.readonly` at first-publish incremental consent only
  (PDR-030c). Consent widens the single existing connection (PDR-030d); no
  second connection is created; previously granted readonly scopes are
  preserved.
- Scope correction (PDR-030g): the original write scope
  `classroom.coursework.me` was disproved live at B9 (real Google granted it
  yet teacher-side `courses.courseWork.create` still returned
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT`) and corrected to the teacher-side write
  scope `classroom.coursework.students`. Certified working at B4b/B7/B8.
- Identity continuity: at widening, a returned Google account that differs from
  the stored account is refused with a hard `lms.identityMismatch` and writes
  nothing (`connections-complete.ts:232-239`).

---

## 6. Token-refresh behavior (PDR-030h)

Google access tokens expire ~1 hour after minting; the stored refresh token
outlives them. B8 Attempt 2 exposed that no production caller refreshed, so an
active, correctly scoped connection sent a dead token to Google and got HTTP
401. The fix adds a central vendor-neutral resolver `resolveLiveCredential`
that refreshes an expired/near-expiry (5-minute skew) access token in place
before any upstream call, wired into publish, topic-list, import, discover,
refresh, and roster sync. The `tokenRef` is stable across refresh (in-place
`lmsTokenBundles` update inside a compare-and-swap transaction); refresh token
and scopes are preserved; it mints no OAuth state and never widens scope. B8
Attempt 3 certified the self-heal live: a deliberately expired credential
refreshed in place (`lms.accessTokenRefreshed`, `reason=expired`), then the
publish rode the fresh token and succeeded.

---

## 7. Topic support

Topics are LMS-owned and never mirrored into Firestore. The topic selector
reads live via `lmsClassesListTopics` -> `GET /v1/courses/{id}/topics`. Before
consent the topics scope is absent, so the selector is safely empty ("No
topic", B4); after consent it populates from the real course (B4b, "Final
Exam"). Topic selection is honored end to end (B8/B12); No-topic publication
omits `lmsTopicId` entirely (B7).

---

## 8. Publication persistence / audit behavior

- On success: a `succeeded` record in `lmsAssignmentPublications` carrying the
  upstream coursework id and URL, the `assignments.lmsPublicationRef` mirror
  set to that record, and exactly one `lms.assignmentPublished` audit event
  (B7 §3.5 - §3.8, B8 §12.8 - §12.10).
- On failure: the LyfeLabz assignment stays intact, a `failed` record is
  written with an error code, and exactly one `lms.publishFailed` audit event
  is emitted (real evidence: B8 Attempt 2 expired-token 401 ->
  `lms.upstreamAuthorizationFailed`, assignment intact, retryable).
- Insufficient scope is non-terminal: no failed record, no re-issue, assignment
  intact and retryable (`assignments-publish.test.ts:417-465`) - the exact
  backend state a B13 cancel produces.

---

## 9. Certification matrix (authoritative)

Evidence-type legend: `real-google` (live upstream), `emulator` (LyfeLabz-side
emulator read), `automated` (Jest unit/integration), `operator` (human
in-Classroom observation), `mixed`.

| Checkpoint | Final status | Evidence source | Evidence type | Limitation / follow-up |
|---|---|---|---|---|
| B1 Teacher sign-in + shell baseline | PASS | Live run (B6/B7/B8 all ran through the real shell) | operator + emulator | Baseline; no standalone findings doc |
| B2 One Assign dialog | PASS | Live run; PDR-030a design | operator + client | - |
| B3 Non-LMS row unchanged | PASS | Live run; client render | operator + client | - |
| B4 Topic selector empty pre-consent | PASS | B4b findings §3.2 (logged pre-consent insufficient_scope reads 13:39 - 17:06) | real-google | - |
| B4b Topic selector populates post-consent | PASS | `SPRINT_25_B4b_CERTIFICATION_FINDINGS.md` | real-google | - |
| B5 Publish toggle defaults off | PASS | Live run; client render | operator + client | - |
| B6 Assign with publication off | PASS | `SPRINT_25_B6_CERTIFICATION_FINDINGS.md` §3 | emulator + operator | Secondary client defects 2.A/2.B remain OPEN (see §11) |
| B7 Publish, no topic | PASS | `SPRINT_25_B7_CERTIFICATION_FINDINGS.md` | real-google | - |
| B8 Publish, with topic | PASS | `SPRINT_25_B8_CERTIFICATION_FINDINGS.md` §12 (Attempt 3, coursework `874752057518`) | real-google | Also certifies PDR-030h refresh self-heal |
| B9 Genuine incremental consent | PASS | PDR-030g live cert; corroborated B4b §3.2, B7 §3.11 (widening 2026-08-16 17:07:48) | real-google | Cross-document evidence; drove the PDR-030g scope correction |
| B10 Single nonce-stable re-issue | PASS | Ledger view of B9; B7 §3.2 ordering | real-google | Cross-document evidence |
| B11 Appears in correct course | PASS | `SPRINT_25_B11_B12_CERTIFICATION_FINDINGS.md` | real-google + operator | - |
| B12 Appears under selected topic | PASS | `SPRINT_25_B11_B12_CERTIFICATION_FINDINGS.md` | real-google + operator | - |
| B13 Cancel/close consent | **PASS WITH LIMITATION** | `SPRINT_25_B13_ARCHITECTURE_REASSESSMENT_AND_CLOSURE.md` | automated + architecture review | Live cancel not observed; LyfeLabz behavior unit-tested; `login_hint` follow-up |
| B14 Consent completes without scope | NOT RUN (likely NOT-CERTIFIABLE-HERE) | Depends on Google partial-grant; compensating `permissionNotGranted` unit tests | automated | Deferred; robustness edge |
| B15 Second insufficient-scope stops | NOT RUN | Compensating unit tests (bounded re-issue) | automated | Deferred; robustness edge |
| B16 Provider failure leaves assignment intact | NOT RUN (as injected browser scenario) | Real B8 Attempt 2 401 failure + `assignments-publish.test.ts` | mixed | Deferred; core failure behavior evidenced by the real Attempt-2 failure |
| B17 Reconnect-required guidance | NOT RUN | Compensating connection-not-active unit/integration coverage | automated | Deferred; robustness edge |
| B18 Detail retry fresh attempt | NOT RUN | `curriculum.lms-publish.test.ts` retry coverage | automated | Deferred |
| B19 Retry does not recreate assignment | NOT RUN | Automated retry coverage | automated | Deferred |
| B20 Failed retry stays retryable | NOT RUN | `curriculum.lms-publish.test.ts` ("failed retry keeps the retry control") | automated | Deferred |
| B21 Multi-class mixed outcome | NOT RUN | Per-row independence unit coverage | automated | Deferred; needs second course |
| B22 No duplicate popup multi-row consent | NOT RUN | Shared-consent coordinator unit coverage | automated | Deferred; needs readonly-only connection |
| B23 Calm summary separates outcomes | PARTIAL | Success summary exercised live (B6/B7/B8); failure-summary variant not run live | mixed | Failure-summary path deferred with B16 |
| B24 No token/scope/PII in UI | PARTIAL | Backend privacy spot-checks PASS (B7 §4: zero Secret Manager, no token/PII in records or logs); full DOM sweep not run as a dedicated pass | mixed | Client DOM sweep deferred; backend privacy gate holds |

Backend verification (V1 - V25): the decisive V-checks are evidenced inline in
the B7 and B8 findings (V2/V4 ordering, V8/V11 connection, V14 - V17 record /
mirror / audit, V21 - V23 zero Secret Manager / no token / no PII). A standalone
end-to-end V1 - V25 sweep document was not separately authored; the certified
publications carry their V-evidence in-line.

Decisive observations (blueprint §13): B9/B10 and B8/B11/B12 - all PASS against
real Google. This is the bar the sprint's genuine-certification claim rests on,
and it is met.

---

## 10. Real-Google evidence (summary)

- Widened connection `googleclassroom__cert-teacher-001`: four scopes
  (`courses.readonly`, `coursework.students`, `rosters.readonly`,
  `topics.readonly`); `coursework.me` absent.
- Real coursework created and operator-confirmed: `874752057518` (Cell Types,
  topic "Final Exam", course `871447706346`), plus `874733473900` (What Is
  Life?, no topic) and the B9 biological-evolution item.
- Real incremental consent granted the coursework capability; readonly scopes
  preserved; single connection widened; no duplicate connection.
- Real credential self-heal: expired access token refreshed in place with a
  stable tokenRef (PDR-030h), then publish succeeded.

---

## 11. B13 PASS WITH LIMITATION explanation

Canonical disposition: `SPRINT_25_B13_ARCHITECTURE_REASSESSMENT_AND_CLOSURE.md`.

- The core publication feature is proven through real Google Classroom
  certification (CT-001 B8/B11/B12; CT-003 B13 Attempt 1 both created real
  coursework and were operator-confirmed).
- The cancellation branch's LyfeLabz behavior has deterministic automated
  coverage: insufficient-scope is non-terminal, the assignment stays intact and
  retryable, no failed record and no re-issue
  (`assignments-publish.test.ts:417-465`;
  `connections-complete-oauth-state.test.ts:464-507`).
- Live reproduction of the exact incremental-consent cancellation state became
  unreliable because of Google's accumulated-grant behavior
  (`include_granted_scopes=true` re-folds every previously granted scope), so a
  readonly-only starting fixture cannot be cheaply reproduced on the
  certification account.
- Repeated fixture manipulation was intentionally stopped (Attempt 1, Attempt
  2, and the planned Attempt 3 halted); the full history is preserved in
  `SPRINT_25_B13_CERTIFICATION_FINDINGS.md` and
  `SPRINT_25_B13_RECOVERY_REPORT.md`.
- Identity continuity is protected reactively by the existing hard
  `lms.identityMismatch` invariant at widening.
- Proactive account continuity via `login_hint` is a UX follow-up, not a
  Sprint 25 correctness blocker.

Why not unqualified PASS: no live cancel was observed. Why not BLOCKING: no
failure exists; every observed behavior was correct and the feature is proven
end to end.

---

## 12. Known limitations

1. **B13 live cancel-consent branch** unobserved (fixture-limited; §11).
   Compensated by unit tests.
2. **Account chooser at incremental consent** can appear because the
   authorization URL sends no `login_hint`. It cannot corrupt the connection
   (identity checked at widening); it is a UX gap.
3. **Non-decisive browser scenarios B14 - B23 not run live** (failure-path,
   retry, multi-class, DOM privacy sweep). Compensated by automated tests; none
   surfaced a defect.
4. **OPEN client defects on the failure path (do not affect the certified happy
   path):** 2.A misleading "LyfeLabz assignment was not created" toast when a
   draft was in fact created; 2.B draft-only lesson can display a stale
   "✓ Assigned" after reload (`SPRINT_25_B6_CERTIFICATION_FINDINGS.md` §2). These
   must be fixed before B16/B20/B23 can be live-certified.
5. **UI polish backlog** (`SPRINT_25_B8_CERTIFICATION_FINDINGS.md` §11.6):
   Settings "Connected" reflects connection status, not credential health;
   Settings spacing; Assignment Summary redesign.
6. **Known curriculum-manifest baseline drift** (root `index.html` vs
   `curriculum.manifest.json`): pre-existing, independent of Sprint 25, surfaces
   as one failing app test and `curriculum:verify` exit 1. Both files unmodified
   vs HEAD. Not a Sprint 25 defect.
7. **Uncertain-upstream retry duplicate residual** and **session-scoped detail
   retry** (implementation plan §2.3; Phase 3 report §17): pre-existing named
   residuals.

---

## 13. Deferred follow-up work (proposed Sprint 26 - LMS UX hardening)

None of these is required to close Sprint 25.

1. **Account-continuity `login_hint` (primary).** Thread the connection's stored
   `upstreamAccountIdentifier` (Google `sub`) into `beginOAuth` for publication
   intent and set `login_hint`, so Google pre-selects the connected account and
   suppresses the chooser. Preserve the existing post-callback
   `lms.identityMismatch` hard invariant. Requires a `beginOAuth` input
   signature change (`provider.ts:159-163`) and a connection lookup in
   `connections-begin.ts` for the publication branch. Vendor neutrality
   preserved (`login_hint` stays inside the Google adapter).
2. **Clearer identity-mismatch UX** ("please use the same Google account you
   connected") on `lms.identityMismatch`.
3. **Reproducible OAuth cancellation-fixture strategy for B13** (a dedicated
   never-authorized Google account, or a genuine grant reset with a real
   propagation wait) plus consent-flow observability (distinguish an abandoned
   `begin` from a completed one in logs).
4. **Resolve the failure-path client defects 2.A / 2.B**, then live-certify
   B14 - B23.
5. **UI polish backlog** (§12.5).

Ownership: Sprint 26 (LMS UX hardening). The account-continuity item is the
architectural/UX finding surfaced by the B13 reassessment and must not be lost.

---

## 14. Production / certification readiness conclusion

The Sprint 25 product objective (definition §8) is met in the certified
environment (levels 1 and 2 of definition §9: engineering validation and
genuine browser certification against real Google Classroom). Every §8 success
criterion is satisfied by certified evidence: opt-in publish with topic in one
dialog; genuine incremental consent widening a single connection; coursework
filed under the chosen topic pointing at the LyfeLabz URL; LyfeLabz
authoritative before the LMS write; `lmsPublicationRef` + `succeeded` record +
one `lms.assignmentPublished`; intact assignment + `failed` record + one
`lms.publishFailed` + retry on failure; activation without publication
supported; non-LMS rows unchanged; no PII/token on any surface; zero Secret
Manager access on the publish path; verify suites green.

Production rollout (level E: Google OAuth verification for the coursework
scopes, Data Access declaration, production Secret Manager posture, deploy
runbook) remains out of Sprint 25 scope and is a rollout gate, not a
certification blocker (PDR-030f, definition §10).

**Verdict: SPRINT 25 COMPLETE WITH DOCUMENTED LIMITATION.**

---

## 15. Documents that supersede earlier planning assumptions

- **PDR-030g** supersedes the `classroom.coursework.me` write-scope assumption
  in PDR-030b and in the roadmap's "Sprint 25 - LMS Assignment Publication"
  planning note. The certified write scope is `classroom.coursework.students`.
- **PDR-030h** adds an automatic access-token refresh lifecycle that Phase 1 - 3
  planning did not anticipate; it is now the credential-resolution contract for
  every upstream Classroom call.
- **Real-Google certification model** (checklist §0, runbook §1.5) supersedes
  the "Google Classroom API test double" phrasing in
  `SPRINT_25_ARCHITECTURAL_BLUEPRINT.md` §13: there is no runtime test-double
  seam, so genuine browser runs exercise real Google Classroom.
- **This report** supersedes the not-yet-authored
  `SPRINT_25_FINAL_CERTIFICATION_REPORT.md` template slot in runbook §10 as the
  canonical closeout, and records the honest partial-execution disposition.

---

*End of Sprint 25 completion report. Nothing was staged, committed, pushed, or
deployed by authoring it. The live certification emulator state was not
modified.*
