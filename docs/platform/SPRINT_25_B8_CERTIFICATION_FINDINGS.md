# Sprint 25 - B8 Certification Findings (STOP condition diagnosis)

> **Addendum 2026-08-16 (see §11).** A LATER B8 attempt (Attempt 2, Cell
> Types) DID reach real Google Classroom with the "Final Exam" topic id and
> failed on an EXPIRED access token (HTTP 401 `invalid_token`), exposing a
> missing credential-refresh lifecycle (PDR-030h) rather than any topic or
> publication defect. Sections 1 - 10 below describe the EARLIER attempt
> (Attempt 1, Cell Organelles), which never reached Google because its
> assessment was not deployed. Both attempts are preserved. **B8 remains
> ATTEMPTED - NOT PASSED.** See §11 for the two-attempt distinction and the
> refresh fix.

Status: B8 is **NOT RUN / INCOMPLETE**, not FAIL. The 2:09 PM attempt never
reached the Google Classroom publication path. It failed one step earlier, on
the LyfeLabz-side `assignmentsPublish` lifecycle transition, because the
substituted lesson "Cell Organelles" (slug `organelles`) has no deployed
certification assessment. `assignmentsPublish` refused the `draft -> published`
transition with `assessments.notDeployed`, so `lmsAssignmentsPublish` was never
invoked and Google Classroom was never contacted. The Google Classroom
publication path (the actual subject of B8) was not exercised and cannot be
scored from this attempt.

This is a read-only diagnosis. No production code, no Firestore document, no
callable, no OAuth state, and no Google Classroom resource was modified.
Firestore was read through the emulator REST API with the emulator owner
bypass; every observation is a read.

Style: no em dashes. Use " - " (spaced hyphen).

Environment of record: Emulator Suite live (project `lyfelabz-prod`, Firestore
`127.0.0.1:8080`, Functions `5001`, emulator process up since 2026-08-14
21:31), Functions runtime log `platform/firebase/firebase-debug.log`
(timestamps UTC/Z; local is UTC-4, so 18:09Z = 2:09 PM).

---

## 1. Exact failure diagnosis

The operator substituted "Cell Organelles" for "Cell Types" for B8. Cell
Organelles resolves to lesson slug `organelles` (curriculum manifest:
`slug: "organelles"`, `title: "Cell Organelles"`). Its assessment document id
would be `assessment_organelles`.

The certification seed deploys assessments for exactly three cert lessons
(`platform/functions/src/scripts/assessments/cert-lessons.ts`, confirmed live):
`what-is-life`, `cell-types`, `biological-evolution`. `assessment_organelles`
does not exist.

On Assign, the client fired the two LyfeLabz lifecycle callables in order:

1. `assignmentsCreateDraft` - **succeeded**. It created a durable draft
   assignment `a-organelles-3la0b7o2jgw03cfzebw5-cert-teacher-001-886150a74185`
   on class `3la0b7o2jgw03cfzebw5` (the linked "LyfeLabz Testing" class) and
   emitted `assignments.created`.
2. `assignmentsPublish` - **failed before commit**. Its handler
   (`platform/functions/src/assignments/assignments-publish.ts:221`) calls
   `resolveCurrentAssessmentRevisionId("organelles")`, which reads
   `assessments/assessment_organelles`, finds it absent, and throws
   `assessments.notDeployed`
   (`platform/functions/src/shared/assessment-identifiers.ts:74-79`). The throw
   occurs before the `draft -> published` batch, so the assignment stayed
   `draft`, no `assessmentRevisionId` was stamped, no recipients were written,
   and no `assignments.published` audit event was emitted.

Because the LyfeLabz publish failed, the client computed `lyfelabzAssigned =
false` for the only selected class, so `assigned === 0`. `summarizeOutcomes`
(`app/src/shell/surfaces/curriculum.ts:1899-1906`) returns the base line and,
at line 1906, returns **before** any Google Classroom line is added. The Google
Classroom publish callable (`lmsAssignmentsPublish`) is gated on LyfeLabz
success and was never called. Hence the exact toast:

> "Cell Organelles: LyfeLabz assignment was not created. Google Classroom
> publication was not attempted."

Note: the "was not created" half of that toast is the known **defect 2.A**
(`SPRINT_25_B6_CERTIFICATION_FINDINGS.md` §2.A): a durable draft *was* created;
only publication failed. The wording is misleading but is a pre-existing OPEN
client-copy defect, not the cause of the stop.

---

## 2. Exact backend error code / message and origin

- Code: `assessments.notDeployed`.
- Message: `No deployed assessment exists for lessonSlug "organelles".`
- Origin: `resolveCurrentAssessmentRevisionId` in
  `platform/functions/src/shared/assessment-identifiers.ts:74-79`, called from
  `assignmentsPublishHandler` at
  `platform/functions/src/assignments/assignments-publish.ts:221`.

The error is a `PlatformError` returned to the client as the callable's error;
the Functions emulator does not print it at `[error]` severity. This is
consistent with the log: `assignmentsPublish` shows a clean
`Beginning -> Finished in 19.59ms` pair with `auth: VALID` and **no**
`assignments.published` line, and there is no `[error]` line anywhere in the
log.

---

## 3. Functions-log evidence (18:09 window)

Only two callables fired in the window, both LyfeLabz-side:

```
18:09:52.045Z  POST assignmentsCreateDraft
18:09:52.084Z  > assignments.created {assignmentId: a-organelles-...-886150a74185, classId: 3la0b7o2jgw03cfzebw5}
18:09:52.086Z  Finished "assignmentsCreateDraft" in 41.01ms   (auth: VALID)
18:09:52.095Z  POST assignmentsPublish
18:09:52.09xZ  > Callable request verification passed (auth: VALID)
18:09:52.11xZ  Finished "assignmentsPublish" in 19.59ms       (no assignments.published emitted)
```

- Callable inventory for the window (POST): `assignmentsCreateDraft` x1,
  `assignmentsPublish` x1. Nothing else.
- `lmsAssignmentsPublish`: **did not execute** at 18:09 (absent from the log).
- `lmsClassesListTopics`: last ran at 18:01:10 (the operator opening the Assign
  dialog and populating the topic selector - this is where "Final Exam" was
  fetched); it did **not** run at 18:09 and is not part of the failed attempt.
- `assignmentsPublish` ran 19.59 ms, no HTTPS round trip, confirming a local
  refusal, not an upstream call.
- No `lms.googleClassroomUpstreamDiagnostic`, no `401`, no `403`, no
  `insufficient_scope`, no `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, no `secretmanager`
  access anywhere in the window.

---

## 4. Firestore before/after delta

| Collection | B8 preflight baseline | Now | Delta |
|---|---|---|---|
| `assignments` | 8 | 9 | **+1 (the inert `organelles` draft)** |
| `lmsAssignmentPublications` | 4 | 4 | **0** |
| `lmsConnections` | 1 | 1 | 0 |
| `lmsClassLinks` | 1 | 1 | 0 |
| `lmsOAuthStates` | 5 | 5 | 0 |
| `assessments` | 3 | 3 | 0 (no `assessment_organelles`) |
| `auditEvents` (organelles) | - | +1 only (`assignments.created`) | +1 |

The one new assignment document:

```
assignments/a-organelles-3la0b7o2jgw03cfzebw5-cert-teacher-001-886150a74185
  lessonSlug: organelles
  title: Cell Organelles
  classId: 3la0b7o2jgw03cfzebw5
  status: draft
  createdAt: 2026-08-16T18:09:52.079Z
  (no assessmentRevisionId, no publishedAt, no lmsPublicationRef)
```

It is inert: draft-only, no recipients, no assessment revision, no LMS pointer,
no upstream coursework.

- **No new `lmsAssignmentPublication` record** (question 6): the four existing
  records are unchanged (2 succeeded No-topic: what-is-life, biological-evolution;
  2 failed No-topic: cell-types Aug 8, biological-evolution Aug 15). No
  organelles publication record of any status exists.
- **No new audit event other than `assignments.created`** (question 8):
  `auditEvents` totals 31. `assignments.published` count is 8 (unchanged; the
  organelles publish never happened). Both `lms.publishFailed` events predate
  B8 (2026-08-08 22:45 cell-types; 2026-08-15 01:32 biological-evolution) and
  neither references organelles. Both `lms.assignmentPublished` events are B9
  (17:07) and B7 (17:45). No `lms.assignmentPublished` and no `lms.publishFailed`
  was written for organelles.

---

## 5. Was Google Classroom contacted for publication? (question 7)

**No. Proven, not assumed.**

- `lmsAssignmentsPublish` (the only callable that issues a coursework POST) does
  not appear in the log at 18:09.
- No upstream Google diagnostic, no `secretmanager` access, no non-2xx envelope,
  no HTTPS-duration signature anywhere in the window; `assignmentsPublish`
  returned in 19.59 ms locally.
- No organelles `lmsAssignmentPublication` record and no organelles LMS audit
  event exist.
- The client returned before the LMS line (§1), so it never dispatched the
  publish call.

Google Classroom was not contacted for this attempt.

---

## 6. Connection and OAuth state unchanged (questions 9, 10)

`lmsConnections/googleclassroom__cert-teacher-001` (read live):

```
status: active
scopes: [ classroom.courses.readonly,
          classroom.coursework.students,
          classroom.rosters.readonly,
          classroom.topics.readonly ]      (4; coursework.me absent)
scopesUpdatedAt: 2026-08-16T17:07:48.502Z  (the B9 widening; unchanged)
tokenRef: lms_token_0736b7602b3c9083e3c0decfafb60e9b  (unchanged from B7)
```

- All four required scopes present; `coursework.me` absent. Matches B7 exactly.
- `scopesUpdatedAt` and `tokenRef` unchanged.
- No `lmsConnectionsBegin` / `lmsConnectionsComplete` fired at 18:09 (grep count
  0). `lmsOAuthStates` still holds 5 documents, all `consumedAt` in the past
  (latest 17:07:48), none in-progress. No incremental-consent flow began.

---

## 7. Why Cell Organelles failed / was an invalid substitution (questions 11, 12)

| Lesson | slug | Deployed assessment? | Eligible to create a LyfeLabz assignment through publish? |
|---|---|---|---|
| What Is Life? | `what-is-life` | Yes (`assessment_what-is-life`) | Yes (published B7) |
| Cell Types | `cell-types` | Yes (`assessment_cell-types`) | Yes |
| Biological Evolution | `biological-evolution` | Yes (`assessment_biological-evolution`) | Yes (published B9) |
| **Cell Organelles** | `organelles` | **No** | **No - `assessments.notDeployed`** |

The substitution was **invalid**. Cell Organelles is not in the certification
lesson set, so it has no deployed assessment, so `assignmentsPublish` refuses to
publish it. Any Assign attempt on Cell Organelles in this environment fails
identically at the LyfeLabz lifecycle step, before Google Classroom is ever
reached. The choice to switch away from Cell Types was based on a UI misread
(next section), and the target chosen cannot be certified here.

---

## 8. Safest B8 recovery path (question 13) - evaluation only, not executed

Recovery target requirements for B8 ("successful Classroom publication **with a
topic**"): a lesson with (a) a deployed cert assessment and (b) no prior
*successful* Google Classroom publication *with a topic*. Note the decisive
landscape fact: **every succeeded publication so far is "No topic"** (B7
what-is-life, B9 biological-evolution). No publication has ever carried an
`lmsTopicId`, so B8's topic path is genuinely untested for all three cert
lessons.

- **Option A - Cell Types: RECOMMENDED.** `cell-types` has a deployed
  assessment. Its only Google publication is a stale **failed** No-topic record
  (Aug 8); it has **no** successful Google publication, so a topic publication
  is genuinely new and satisfies B8. The operator's reason for abandoning Cell
  Types - "it shows Assigned and View summary only opens the existing
  assignment" - is a **misread of the UI**. In
  `app/src/shell/surfaces/curriculum.ts:854-866`, the primary card button reads
  "✓ Assigned" only as a label; its click handler still calls `onAssign`, i.e.
  it still opens the Assign dialog. "View summary" is a *separate* secondary
  control. A fresh Assign-dialog open mints a new nonce and therefore a new
  `assignmentId` (`app/src/shell/surfaces/shared/assignmentId.ts`), producing a
  new draft -> publish -> `lmsAssignmentsPublish` with the selected topic. The
  completed-attempt guard in `lmsAssignmentsPublish` keys on the deterministic
  publicationId (assignmentId + nonce), so a fresh id is not short-circuited by
  the old failed cell-types record.

- **Option B - Another deployed-assessment lesson with no successful Google
  publication:** the only such lesson is `cell-types`. `what-is-life` and
  `biological-evolution` already have successful (No-topic) publications. Option
  B therefore resolves to Cell Types (same as A). (They would still satisfy B8's
  topic requirement, since neither has a topic publication, but Cell Types is
  the cleanest because it has no prior success at all.)

- **Option C - Repair/seed Cell Organelles: NOT recommended.** This requires
  deploying an `assessment_organelles` through the certified pipeline (adding
  `organelles` to `cert-lessons.ts` and reseeding). That is a code + seed change
  that widens the certification lesson set - out of scope for a B8 retry and
  unnecessary while Cell Types is available.

- **Option D - other:** none needed.

**Recommendation: run B8 on Cell Types**, selecting only "LyfeLabz Testing -
Grade 7", choosing the real topic "Final Exam", checking "Also publish to Google
Classroom", and clicking Assign once.

---

## 9. Cleanup required before retry? (question 14)

**No cleanup is required, and none should be performed now** (it would be a
Firestore mutation, which this diagnosis forbids).

- The stranded `organelles` draft is inert: it created no Google coursework, no
  publication record, no LMS audit event, and does not touch the connection. It
  will not collide with a Cell Types run (different slug, different assignmentId).
- Its only side effects on the baseline: `assignments` is now 9 not 8, and one
  `assignments.created` audit event exists. The **Google-Classroom-publication
  baseline is clean**: publications still 4, connection intact, no Google
  contact, no OAuth movement.
- Cosmetic residual: on a page reload the organelles card may show "✓ Assigned"
  despite being draft-only (known **defect 2.B**, `SPRINT_25_B6` §2.B). This is
  display-only and does not affect a Cell Types B8.
- If the team wants a pristine assignments count before B8, deleting the single
  organelles draft is the only cleanup, and it must be a deliberate, separately
  authorized Firestore edit - not part of this diagnosis.

---

## 10. B8 verdict and the exact next operator action

**B8 remains NOT RUN / INCOMPLETE** (question 15). The Google Classroom
publication path was never attempted, so there is nothing to score as PASS or
FAIL. The attempt failed on lesson eligibility upstream of B8's subject. B7
(PASS) and B4b (PASS) evidence is fully intact and untouched.

Exact next operator action (safe per the evidence above; do **not** treat this
as executed):

1. In Curriculum, click the Cell Types card's assign button (it shows
   "✓ Assigned" but still opens the Assign dialog).
2. In the dialog, select only "LyfeLabz Testing - Grade 7"; uncheck "B6 Testing
   Class".
3. Select the Google Classroom topic "Final Exam".
4. Check "Also publish to Google Classroom".
5. Click Assign exactly once.
6. Expect: a new `a-cell-types-...` draft -> published, then `lmsAssignmentsPublish`
   issuing one coursework POST carrying the "Final Exam" `lmsTopicId`, a new
   succeeded publication record with `lmsTopicId` set, one `lms.assignmentPublished`
   audit event carrying the topic, and the item appearing under "Final Exam" in
   the real course.

Nothing was staged, committed, mutated, or published by this diagnosis.
```

---

## 11. Addendum (2026-08-16): Attempt 2 reached real Google, and the root cause

This addendum is appended after the original diagnosis. Sections 1 - 10 are
preserved unchanged; they describe Attempt 1. This section records the later
Attempt 2 and the credential-refresh fix (PDR-030h).

### 11.1 The two B8 attempts, distinguished

**Attempt 1 - Cell Organelles (slug `organelles`).** Documented in §1 - §10.
Never reached Google Classroom. `assignmentsPublish` refused the
`draft -> published` transition with `assessments.notDeployed` because the
substituted lesson has no deployed certification assessment, so
`lmsAssignmentsPublish` was never invoked. No coursework POST, no Google
contact, no OAuth movement. A single inert Cell Organelles draft remains as a
baseline residual.

**Attempt 2 - Cell Types (valid lesson).** DID reach the Google Classroom
publication path. `lmsAssignmentsPublish` invoked the adapter and issued the
real upstream call:

- `POST /v1/courses/{id}/courseWork`
- carrying the real selected topic id `871946939445` ("Final Exam")
- at approximately 2026-08-16T18:25:08Z

Real Google rejected it with **HTTP 401 UNAUTHENTICATED / `invalid_token`**.
The publication record is `failed` with `lms.upstreamAuthorizationFailed`. No
Google Classroom coursework was created by this attempt. This is NOT a topic
defect and NOT a scope defect (the connection holds the four correct scopes
including `classroom.coursework.students`; `classroom.coursework.me` is absent).

### 11.2 Root cause - missing credential-refresh lifecycle

The access token was minted during B9 scope widening at ~2026-08-16T17:07:48Z
with a ~1 hour expiry (~2026-08-16T18:07:47Z). B7 succeeded while it was valid.
By the Attempt 2 publication at ~18:25:08Z the access token was ~17 minutes
past expiry. The connection was still `active` and still held valid
refresh-token material, but nothing refreshed the access token:

1. `FirestoreLmsTokenStore.resolve()` returned the stored access token verbatim.
2. It did not check `expiresAtEpochMs` and did not refresh.
3. The bundle already stored refresh-token material and `expiresAtEpochMs`.
4. The transport `refreshAccessToken()` already existed but no production
   caller invoked it; `LmsProviderAdapter` exposed no refresh operation.
5. A scope-unchanged reconnect is ineffective (the `alreadyAuthorized` path
   discards the newly exchanged access token).
6. Settings still showed "Connected" because connection status is independent
   of credential freshness.

Access-token expiry is normal Google behavior; the defect was the absent
refresh caller.

### 11.3 The fix (PDR-030h)

Automatic access-token refresh is now performed centrally at credential
resolution. A new vendor-neutral resolver `resolveLiveCredential(tokenRef)`
refreshes an expired or near-expiry (5-minute skew) access token in place
before any upstream call, and is wired into `lmsAssignmentsPublish`,
`lmsClassesListTopics`, `lmsClassesImport`, `lmsClassesDiscover`,
`lmsClassesRefresh`, and the roster sync engine. Refresh preserves connection
identity (stable `tokenRef`, in-place `lmsTokenBundles` update inside a
Firestore compare-and-swap transaction), preserves the refresh token and the
four scopes, mints no OAuth state, and does not widen scope. An unrecoverable
refresh (`invalid_grant`) normalizes to `lms.reconnectRequired`. See PDR-030h
in `LYFELABZ_PLATFORM_DECISIONS.md`.

### 11.4 Certification state - preserved, not cleaned up

The failed Cell Types B8 publication record, its `lms.publishFailed` audit
event, the Cell Types LyfeLabz assignment, the inert Cell Organelles draft,
and the B9 / B4b / B7 evidence are all part of certification history and are
preserved. The current live connection retains its expired access token and
valid refresh-token material - an ideal fixture for the B8 retest, in which
the expired credential itself proves the self-heal.

### 11.5 Verdict

**B8 remains ATTEMPTED - NOT PASSED.** The refresh fix is implemented and
verified by automated tests (no real Google in unit/integration tests); the
real-Google B8 retest against the existing connection is a separate operator
step. Nothing was staged, committed, mutated, or published by this addendum.

### 11.6 UI / polish backlog (recorded, NOT implemented by the refresh fix)

These are user-experience items observed during certification. They are NOT
part of the credential-refresh implementation (PDR-030h) and are deferred; the
refresh fix is backend credential lifecycle only and introduces no UI change.

1. Settings > Integrations "Connected" means the connection record is `active`,
   not that the credential is healthy. A connection with an expired access
   token (recoverable by refresh) or an unrecoverable/revoked refresh token
   both still read "Connected".
2. Settings layout polish, including inconsistent spacing around Notification
   Preferences / Connected Services.
3. Assignment Summary screen needs visual / hierarchy redesign.
4. Misleading "LyfeLabz assignment was not created" toast when a draft was in
   fact created (pre-existing defect 2.A, `SPRINT_25_B6` §2.A).
5. Draft-only lesson can display a stale "✓ Assigned" state (pre-existing
   defect 2.B, `SPRINT_25_B6` §2.B).

---

## 12. B8 Retest / Attempt 3 (2026-08-16, ~8:33 PM local) - Automatic Expired-Credential Recovery

This section is appended after Attempt 1 (§1 - §10) and Attempt 2 (§11), both
preserved unchanged. It records the third B8 attempt, which is also the live
certification of the automatic access-token refresh fix (PDR-030h). This is a
read-only diagnosis: no callable was invoked, no Firestore document, OAuth
state, connection, or Google Classroom resource was modified, and nothing was
staged or committed. Firestore was read through the emulator REST API
(`127.0.0.1:8080`, project `lyfelabz-prod`, owner bypass); every observation is
a read. The Functions runtime log window read was everything after the prior
observation boundary (`firebase-debug.log` line 10356 / byte 2994866). Times in
the log are UTC/Z; local is UTC-4, so `00:32Z` on 2026-08-17 is 8:32 PM local on
2026-08-16.

### 12.1 Precondition - expired credential deliberately preserved

The connection `googleclassroom__cert-teacher-001` entered the retest with its
Attempt-2 access token still expired: `tokenRef`
`lms_token_0736b7602b3c9083e3c0decfafb60e9b`, `expiresAtEpochMs`
`1786903667487` (2026-08-16T18:07:47.487Z), roughly 6.4 hours past expiry by the
retry. The refresh token was present and the four scopes intact. This expired
fixture is what the retest exercises.

### 12.2 Operator workflow (as reported)

Fresh Assign dialog for Cell Types; only "LyfeLabz Testing - Grade 7" selected;
"B6 Testing Class - Grade 6" unchecked; Google Classroom topic "Final Exam"
selected; "Also publish to Google Classroom" checked; Assign clicked exactly
once.

### 12.3 Browser success message

> "Assigned Cell Types to 1 class. Publishing to Google Classroom succeeded."

### 12.4 Callable chain (Functions log, single occurrence each)

| Time (Z) | Callable | Outcome |
|---|---|---|
| 00:31:12 | `lmsClassesListTopics` (POST x1) | topic selector populated; **token refreshed here** (see 12.5) |
| 00:32:57.402 | `assignmentsCreateDraft` (POST x1) | `assignments.created` a-cell-types-...-d4133126c1e9 |
| 00:32:57.857 | `assignmentsPublish` (POST x1) | `assignments.published` (recipientCount 0) |
| 00:32:58.260 | `lmsAssignmentsPublish` (POST x1) | `lms.assignmentPublished`, 1130 ms (real Google round trip) |
| 00:32:59 | `assessmentAssignmentSummary` (x2) | summary reads (0 students) |

Exactly one of each mutating callable. No second `lmsAssignmentsPublish`, no
`lmsConnectionsBegin` / `lmsConnectionsComplete`, no reconnect, no `[error]`
line, no `401`, no `invalid_token`, no `insufficient_scope` anywhere in the
window.

### 12.5 Automatic refresh - log evidence

During `lmsClassesListTopics` (the topic-selector fetch that is part of the B8
dialog workflow), the new resolver refreshed the expired credential in place:

```
00:31:12  lms.accessTokenRefreshStarted  reason=expired  tokenRef=...b60e9b  priorExpiryEpochMs=1786903667487
00:31:13  lms.accessTokenRefreshed        reason=expired  tokenRef=...b60e9b  priorExpiryEpochMs=1786903667487  refreshedExpiryEpochMs=1786930271765
```

Exactly one refresh event (one `accessTokenRefreshStarted`, one
`accessTokenRefreshed`), `reason=expired`. No `accessTokenRefreshFailed`, no
`reconnectRequired`, no OAuth consent, no OAuth begin/complete. By the
`lmsAssignmentsPublish` at 00:32:58 the credential was already fresh, so the
publish rode the refreshed token and succeeded with no upstream authorization
failure. The refresh is Functions-log only (not an audit-ledger event), which is
consistent with PDR-030h.

### 12.6 Token bundle self-healing (`lmsTokenBundles/lms_token_0736b7602b3c9083e3c0decfafb60e9b`)

| Field | Baseline | After Attempt 3 | Result |
|---|---|---|---|
| `tokenRef` | ...b60e9b | ...b60e9b | **unchanged (stable)** |
| `expiresAtEpochMs` | 1786903667487 (18:07:47Z) | **1786930271765 (2026-08-17T01:31:11.765Z)** | advanced ~7.4 h later |
| refresh token | present | present | preserved |
| scopes | 4 | 4 | preserved |
| `classroom.coursework.me` | absent | absent | still absent |
| `updatedAt` | - | 2026-08-17T00:31:12.775Z | in-place update at refresh |

Scopes (unchanged, exactly four): `classroom.courses.readonly`,
`classroom.coursework.students`, `classroom.rosters.readonly`,
`classroom.topics.readonly`.

Connection `googleclassroom__cert-teacher-001` remains `status: active`, same
`tokenRef`, same four scopes, `scopesUpdatedAt` `2026-08-16T17:07:48.502Z`
(1786900068502) unchanged. No new connection document; `lmsConnections` count
still 1. This is the decisive production proof of tokenRef-stable automatic
credential maintenance: the access token self-healed in place with no identity
change, no re-consent, and no scope widening.

### 12.7 New assignment (`assignments/a-cell-types-3la0b7o2jgw03cfzebw5-cert-teacher-001-d4133126c1e9`)

```
lessonSlug: cell-types
title: Cell Types
classId: 3la0b7o2jgw03cfzebw5   (LyfeLabz Testing - Grade 7; class doc grade=7; linked lmsClassId 871447706346)
status: published
assessmentRevisionId: assessment_cell-types__r1   (deployed Cell Types assessment)
publishedAt: 2026-08-17T00:32:57.944Z
lmsPublicationRef: a-cell-types-...-d4133126c1e9__googleclassroom__5355a53d
```

Exactly one new assignment; `assignments` 10 -> 11. It is on the Grade 7
LyfeLabz class only. No assignment was created on the Grade 6 B6 Testing Class
(`8iq0gn44dt9y0tbkjfso`); its only assignment predates this retest (Aug 8).

### 12.8 New publication (`lmsAssignmentPublications/a-cell-types-...-d4133126c1e9__googleclassroom__5355a53d`)

```
status: succeeded            (no errorCode / errorMessage)
providerId: googleClassroom
connectionId: googleclassroom__cert-teacher-001
classId: 3la0b7o2jgw03cfzebw5   linkId c5bafe12
lmsClassId (Google course):   871447706346
lmsTopicId:                   871946939445   (PRESENT)
lmsAssignmentId (coursework): 874752057518   (NEW, distinct from all prior)
lmsAssignmentUrl: https://classroom.google.com/c/ODcxNDQ3NzA2MzQ2/a/ODc0NzUyMDU3NTE4/details
publishedAt: 2026-08-17T00:32:59.371Z
```

The URL's base64 segments decode to the same course id (871447706346) and
coursework id (874752057518), internally consistent. This is a NEW record;
`lmsAssignmentPublications` 5 -> 6. The failed Attempt-2 record
(`...-7591334f9592__googleclassroom__404d8b6d`, status failed,
`lms.upstreamAuthorizationFailed`, same topic 871946939445, publishedAt
2026-08-16T18:25:08.694Z) is intact, as is the older stale failed cell-types
No-topic record (`...-5fc808008236__...__68970da1`). No additional failed
publication was written.

attemptNonce / hash correlation: the new assignment nonce `d4133126c1e9`
produces publication hash `5355a53d`; the failed Attempt-2 nonce `7591334f9592`
produced hash `404d8b6d`. Distinct nonces yield distinct deterministic
publication ids, so the completed-attempt guard did not short-circuit the retry
and no duplicate publication exists.

### 12.9 "Final Exam" topic identity (what is and is not proven)

Proven from existing evidence, without any new Google request:

- The operator selected "Final Exam" (browser workflow). Per B4b §3.5 - §3.6,
  the real linked course's topic selector offered exactly "No topic" and
  "Final Exam"; "Final Exam" is a real topic in course 871447706346.
- The client supplied topic id `871946939445`.
- The backend persisted that id (publication `lmsTopicId` and audit
  `lmsTopicId` both `871946939445`).
- Real Google accepted the coursework creation using that topic id (the publish
  succeeded, returned coursework id 874752057518 and a real
  classroom.google.com URL, with no NOT_FOUND / invalid-topic error), which
  confirms `871946939445` is a valid topic in the real course.
- The same id `871946939445` is the one Attempt 2 (§11.1) recorded for the
  operator-selected "Final Exam."

Not independently reconstructable here: the exact label -> id string mapping
from a live Google response body (the runtime does not log response bodies, and
no new Google call was made). The in-Classroom visual confirmation that the item
is filed under "Final Exam" is exactly checkpoint B12.

### 12.10 Audit ledger

New event `lms.assignmentPublished` at 2026-08-17T00:32:59.387Z:

```
targetId (assignmentId): a-cell-types-...-d4133126c1e9
payload.providerId:      googleClassroom
payload.linkId:          3la0b7o2jgw03cfzebw5__googleclassroom__c5bafe12
payload.lmsClassId:      871447706346
payload.lmsAssignmentId: 874752057518
payload.publicationId:   a-cell-types-...-d4133126c1e9__googleclassroom__5355a53d
payload.lmsTopicId:      871946939445    (the only assignmentPublished event carrying a topic)
```

Counts: `lms.assignmentPublished` 2 -> 3; `lms.publishFailed` 3 (unchanged; no
new failure event for this retry). Both prior `lms.publishFailed` cell-types /
biological-evolution records are preserved.

### 12.11 Duplicate / negative checks

- Exactly one new Cell Types LyfeLabz assignment (10 -> 11).
- Exactly one new publication (5 -> 6), status succeeded.
- Exactly one new Google coursework id (874752057518).
- Exactly one new `lms.assignmentPublished` (2 -> 3).
- Exactly one `lmsAssignmentsPublish` call; no duplicate retry.
- No OAuth state created (`lmsOAuthStates` still 5, all consumed, latest
  17:07:48Z, none in progress).
- No connection replacement (1 connection, same id and tokenRef).
- No scope widening; `classroom.coursework.me` still absent.
- No reconnect / no OAuth begin/complete.
- No B6 (Grade 6) assignment.
- No additional failed publication.
- The inert Cell Organelles draft (§4) and both prior failed cell-types /
  biological-evolution publication records remain preserved.

### 12.12 B8 verdict

**B8 PASS - certified against the canonical criterion** ("PASS when publication
succeeds with the topic id sent"). The publication succeeded with topic id
871946939445 sent and persisted, backed by a real coursework write
(874752057518) to the real course (871447706346). Because the credential was
deliberately expired beforehand, this retest also certifies the automatic
expired-credential refresh fix (PDR-030h): the access token self-healed in place
with a stable tokenRef, preserved refresh token and scopes, no re-consent, and
no OAuth-state or connection change. In-Classroom visual confirmation (item in
the correct course B11, under the "Final Exam" topic B12) is the next step and
is not part of this backend proof.

Nothing was staged, committed, mutated, or published by this diagnosis.

### 12.13 Cross-reference - B11 / B12 completed (2026-08-16)

The in-Classroom visual confirmations anticipated in §12.9 and §12.12 have
since been performed by the operator against the real linked course and both
PASS. The Cell Types coursework (id `874752057518`, publication `__5355a53d`)
was confirmed present in the correct real course `871447706346` with attached
material `http://localhost:5000/lesson_cell-types.html` (B11), and filed under
the "Final Exam" topic `871946939445` (B12). See
`SPRINT_25_B11_B12_CERTIFICATION_FINDINGS.md`. This B8 verdict (§12.12) is
unchanged; this is a forward cross-reference only.
