# Sprint 25 - B7 Certification Findings

Status: B7 PASSED. A single Google Classroom coursework item for "What Is Life?"
was published to the real linked course "LyfeLabz Testing" against the widened
connection, with no topic. Exactly one new LyfeLabz assignment was created for
the intended linked class only; the unrelated "B6 Testing Class" received no new
assignment. The publication reached the canonical `succeeded` state, the
assignment mirror pointer references it, exactly one `lms.assignmentPublished`
audit event exists for it, and the upstream Google Classroom coursework id was
captured. B7 fired no incremental consent, created no OAuth state, did not widen
or otherwise mutate the connection, and left the prior B9 and B4b evidence
intact. Certification advances to B8.

Style: no em dashes. Use " - " (spaced hyphen).

Backend correlation is read-only: the running Emulator Suite (project
`lyfelabz-prod`, Firestore `127.0.0.1:8080`) and the Functions runtime log
(`platform/firebase/firebase-debug.log`, timestamps UTC/Z; local time is UTC-4,
so 17:45Z = 1:45 PM). No Firestore write, no callable invocation, no code
change, no commit was performed by this correlation.

---

## 1. Checkpoint under test

B7 (browser certification checklist §B7): "Successful Classroom publication
without a topic." Pass criterion: publication succeeds and the coursework POST
carried no topic id, verified backend-side. Upstream nature: real-google,
MUTATING (one new coursework expected).

Operator action (as reported): assigned "What Is Life?" to only "LyfeLabz
Testing - Grade 7" (B6 Testing Class explicitly unchecked), "Also publish to
Google Classroom" checked, topic left at the default "No topic", Assign clicked
once. LyfeLabz showed: "Assigned What Is Life? to 1 class. Publishing to Google
Classroom succeeded." The operator then observed "What Is Life?" beneath the
"No topic" heading on the real Google Classroom Classwork page, posted 1:45 PM,
with the earlier B9 "Biological Evolution" item separately visible.

---

## 2. Canonical identifiers established

| Identifier | Value |
|---|---|
| New LyfeLabz assignment id | `a-what-is-life-3la0b7o2jgw03cfzebw5-cert-teacher-0-1d72s6eu67qt6` |
| Publication id | `a-what-is-life-3la0b7o2jgw03cfzebw5-cert-teacher-0-1d72s6eu67qt6__googleclassroom__d38cd722` |
| attemptNonce correlation (hash suffix of publicationId) | `d38cd722` |
| Linked LyfeLabz class | `3la0b7o2jgw03cfzebw5` ("LyfeLabz Testing", active, LMS-linked) |
| Class link | `3la0b7o2jgw03cfzebw5__googleclassroom__c5bafe12` (status linked) |
| Upstream course id | `871447706346` (base64 `ODcxNDQ3NzA2MzQ2`) |
| Upstream coursework id | `874733473900` (base64 `ODc0NzMzNDczOTAw`) |
| Upstream coursework URL | `https://classroom.google.com/c/ODcxNDQ3NzA2MzQ2/a/ODc0NzMzNDczOTAw/details` |
| Assignment createdAt | 2026-08-16T17:45:09.395Z (1:45:09 PM) |
| Publication publishedAt | 2026-08-16T17:45:10.180Z (1:45:10 PM) |
| lms.assignmentPublished audit id | `7uDic5ros8PYm7oCOsXG` |

The publicationId is deterministic: `{assignmentId}__googleclassroom__{hash}`,
where the hash is derived from the row `attemptNonce` (implementation plan
§2.5/§2.7; backend checklist V17). The stable suffix `d38cd722` is therefore the
attemptNonce correlation token. Because B7 ran on an already-widened connection,
there is no pre-consent/re-issue pair: a single publish, a single nonce, a
single publicationId.

---

## 3. Requirement-by-requirement correlation

### 3.1 Exactly one new assignment, correct class, B6 not assigned (criteria 1, 2)

Assignments collection now holds 8 documents (baseline captured 7 before B7). The
one new document is the assignment id above:

- lessonSlug `what-is-life`, classId `3la0b7o2jgw03cfzebw5` (the linked class),
  status `published`, createdAt 2026-08-16T17:45:09.395Z.
- The Functions log records its lifecycle at 17:45:09: `assignmentsCreateDraft`
  (`assignments.created`) then `assignmentsPublish` (`assignments.published`),
  both naming this assignment id.

"B6 Testing Class" is LyfeLabz classId `8iq0gn44dt9y0tbkjfso`. The only
assignment on that class is `a-what-is-life-8iq0...-2411ta0zerick`, createdAt
2026-08-08 (pre-existing). No assignment on `8iq0gn44dt9y0tbkjfso` was created in
the B7 window. B6 Testing Class received no new assignment from this action.
PASS.

### 3.2 lmsAssignmentsPublish executed and succeeded (criteria 3, 4)

Functions log, B7 window:

```
[2026-08-16T17:45:09.359Z] POST assignmentsCreateDraft   -> assignments.created (this assignment)
[2026-08-16T17:45:09.404Z] POST assignmentsPublish       -> assignments.published (this assignment)
[2026-08-16T17:45:09.431Z] POST lmsAssignmentsPublish
   > Callable request verification passed {verifications:{app:MISSING,auth:VALID}}
   > lms.assignmentPublished {assignmentId: ...1d72s6eu67qt6, publicationId: ...d38cd722}
[2026-08-16T17:45:10.198Z] Finished "lmsAssignmentsPublish" in 766.162417ms
```

- `assignmentsPublish` precedes `lmsAssignmentsPublish` (backend checklist V2
  order holds); publication strictly follows the LyfeLabz publish (V4).
- Auth VALID (`app: MISSING` is the expected emulator state, not a failure).
- Clean Beginning -> Finished pair, no thrown error. The single success log line
  `lms.assignmentPublished` is emitted with this assignment/publication.
- 766 ms duration is a genuine HTTPS round trip to Google, not a sub-millisecond
  local return. (The paired ~1 ms "Finished" line immediately before is the CORS
  OPTIONS preflight, per the established B4b log pattern, not a second execution.)
- No `401`, no `403`, no `insufficient_scope`, no `invalid_token`, no
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, no upstream authorization failure, no
  transport failure, no timeout in the B7 window. The temporary B9 upstream
  diagnostic (`lms.googleClassroomUpstreamDiagnostic`, retained per PDR-030g,
  fires on every non-2xx upstream response) does NOT appear anywhere in the
  17:45 window. Its absence establishes a 2xx upstream response - the coursework
  POST succeeded. PASS.

### 3.3 Correlation across ids, timestamps, nonce (criterion 5)

The assignment id, the publicationId (which embeds the attemptNonce hash
`d38cd722`), the createdAt (17:45:09.395Z), the publishedAt (17:45:10.180Z), the
Functions log window (17:45:09.431Z -> 17:45:10.198Z), and the audit event
`occurredAt` (17:45:10.193Z) all reference the same logical publication and are
internally consistent. PASS.

### 3.4 lmsTopicId omitted for the No topic publication (criterion 6)

The publication record contains no `lmsTopicId` key at all (it is omitted, not
stored as null or an empty value). This is the canonical shape for a No topic
publication: an omitted field, not a fabricated identifier. Correspondingly, the
`lms.assignmentPublished` audit payload carries `providerId`, `linkId`,
`lmsClassId`, `lmsAssignmentId`, and `publicationId`, and carries no topic id.
(Contrast the B8 case, which is expected to carry the selected `lmsTopicId`.)
PASS.

### 3.5 Publication record reached succeeded (criterion 7)

`lmsAssignmentPublications/a-what-is-life-...-1d72s6eu67qt6__googleclassroom__d38cd722`:

```
status: "succeeded"
assignmentId: a-what-is-life-...-1d72s6eu67qt6
classId: 3la0b7o2jgw03cfzebw5
ownerUid: cert-teacher-001
schoolId: school-beta
providerId: googleClassroom
connectionId: googleclassroom__cert-teacher-001
lmsClassId: 871447706346
lmsAssignmentId: 874733473900
lmsAssignmentUrl: https://classroom.google.com/c/ODcxNDQ3NzA2MzQ2/a/ODc0NzMzNDczOTAw/details
publishedAt: 2026-08-16T17:45:10.180Z
(no lmsTopicId key)
```

Owner and school denormalization present; well-formed succeeded record (backend
checklist V14). PASS.

### 3.6 Assignment lmsPublicationRef mirror (criterion 8)

`assignments/a-what-is-life-...-1d72s6eu67qt6.lmsPublicationRef` =
`a-what-is-life-...-1d72s6eu67qt6__googleclassroom__d38cd722`, which is exactly
the succeeded publication document id. The mirror pointer matches the record
(backend checklist V15). PASS.

### 3.7 Exactly one lms.assignmentPublished audit event (criterion 9)

`auditEvents` holds exactly two `lms.assignmentPublished` events total: one for
biological-evolution `28x9thcelm9k7` (the B9 evidence) and one for this B7
publication:

```
[7uDic5ros8PYm7oCOsXG] action=lms.assignmentPublished
  targetId=a-what-is-life-...-1d72s6eu67qt6
  payload={providerId:googleClassroom, linkId:3la0b7o2jgw03cfzebw5__googleclassroom__c5bafe12,
           lmsClassId:871447706346, lmsAssignmentId:874733473900,
           publicationId:a-what-is-life-...-1d72s6eu67qt6__googleclassroom__d38cd722}
  occurredAt=2026-08-16T17:45:10.193Z
```

Exactly one success event for the B7 attempt, correlated to the assignment and
publication (backend checklist V16). A separate `assignments.published` event
(LyfeLabz-side lifecycle, a different action) also exists for this assignment;
that is expected and is not an LMS publish event. No `lms.publishFailed` event
exists for this assignment. PASS.

### 3.8 Upstream Google Classroom coursework id captured (criterion 10)

`lmsAssignmentId` = `874733473900` and `lmsAssignmentUrl` are stored on the
succeeded record and echoed in the audit payload. `ODc0NzMzNDczOTAw` base64
-decodes to `874733473900` and `ODcxNDQ3NzA2MzQ2` to `871447706346`, so the URL
and the id agree, and the course id matches the linked class. PASS.

### 3.9 Real-Google No topic correlation (criterion 11)

- Backend: publishedAt 2026-08-16T17:45:10Z = 1:45 PM local. Operator observed
  "What Is Life?" posted at 1:45 PM in the real course. The times match.
- The publication record and audit payload carry the real coursework id
  `874733473900` in course `871447706346` ("LyfeLabz Testing").
- lmsTopicId is omitted (§3.4), consistent with the item appearing beneath the
  Google Classroom "No topic" heading.

The backend succeeded record and the operator's real-Google observation describe
the same coursework item, filed under no topic. PASS.

### 3.10 No duplicate What Is Life? coursework (criterion 12)

- Exactly one succeeded what-is-life publication record exists; it carries a
  single `lmsAssignmentId` `874733473900`.
- The Functions log contains exactly one substantive (real HTTPS)
  `lmsAssignmentsPublish` execution in the B7 window (766 ms at 17:45:10); there
  is no second what-is-life publish anywhere in the log.
- Exactly one `lms.assignmentPublished` audit event for what-is-life (§3.7).
- No incremental-consent re-issue occurred (§3.11), so there is no second
  coursework POST.

A single coursework item was created. No duplicate. PASS.

### 3.11 Connection active and widened four-scope credential intact (criterion 13)

`lmsConnections/googleclassroom__cert-teacher-001`:

```
status: active
scopes: [ classroom.courses.readonly,
          classroom.coursework.students,
          classroom.rosters.readonly,
          classroom.topics.readonly ]   (4)
scopesUpdatedAt: 2026-08-16T17:07:48.502Z   (the B9 widening; unchanged by B7)
tokenRef: lms_token_0736b7602b3c9083e3c0decfafb60e9b
```

- All four required scopes present. `classroom.coursework.me` absent (correct;
  PDR-030g scope correction).
- `scopesUpdatedAt` is unchanged from the B9 widening at 17:07:48 and predates
  the B7 action at 17:45. No `lmsConnectionsBegin`/`lmsConnectionsComplete` fired
  in the B7 window (the last consent pair was 17:07:48). B7 did not widen,
  re-consent, or swap the token (backend checklist V11: tokenRef changes only if
  widening commits; no widening -> tokenRef unchanged).
- Exactly one connection document for the (teacher, provider) pair (V8). PASS.

### 3.12 No stale or in-progress OAuth state (criterion 14)

`lmsOAuthStates` holds 5 documents, all with a `consumedAt` set and an
`expiresAt` in the past (latest consumedAt 2026-08-16T17:07:48Z). No document is
in-progress, and no new OAuth state was created in the B7 window (consistent with
B7 firing no consent). B7 left no stale or in-progress OAuth state. PASS.

### 3.13 B9 and B4b evidence intact (criterion 15)

- B9 publication `a-biological-evolution-...-28x9thcelm9k7__googleclassroom__88c6cf85`
  remains `succeeded`, lmsAssignmentId `874734574049`, unchanged.
- B9 assignment `...-28x9thcelm9k7` still carries its `lmsPublicationRef` to that
  record; its `lms.assignmentPublished` audit event (`063BzZzHybSRNfQiUcbG`) is
  intact.
- B4b was a read-only topic-selector checkpoint that created no Firestore state;
  nothing to mutate. The widened connection it verified is unchanged (§3.11).
- The prior failed records (biological-evolution `e133b713`, cell-types
  `68970da1`) are retained unchanged (append-only ledger).

No earlier certification evidence was mutated or invalidated. PASS.

---

## 4. Security and privacy spot-checks (supporting)

- Zero Secret Manager access anywhere in the log (`secretmanager` absent),
  including the B7 publish path (backend checklist V21).
- No token material, access/refresh token, OAuth code, or client secret appears
  in the publication record, audit payload, or B7 log lines (V22).
- No student PII appears on the publish path; the publish path reads no roster
  (V23).
- No ERROR-severity line exists anywhere in the log.

---

## 5. B7 acceptance decision

Every canonical B7 requirement is satisfied:

1. New assignment identified: `a-what-is-life-...-1d72s6eu67qt6`. PASS.
2. Exactly one new assignment, linked class only; B6 Testing Class not assigned. PASS.
3. `lmsAssignmentsPublish` execution found in the Functions log. PASS.
4. Callable completed successfully; no 401/403/insufficient_scope/invalid_token/
   upstream-auth/transport/timeout. PASS.
5. Correlated by assignment id, publication id, attemptNonce (`d38cd722`), and
   timestamps. PASS.
6. `lmsTopicId` omitted entirely for the No topic publication. PASS.
7. Publication record reached `succeeded`. PASS.
8. Assignment `lmsPublicationRef` mirrors the succeeded record. PASS.
9. Exactly one `lms.assignmentPublished` audit event, correlated. PASS.
10. Upstream coursework id `874733473900` captured. PASS.
11. Real-Google No topic observation correlates (posted 1:45 PM). PASS.
12. No duplicate What Is Life? coursework. PASS.
13. Connection active; widened four-scope credential intact; `coursework.me`
    absent. PASS.
14. No stale or in-progress OAuth state. PASS.
15. B9 and B4b evidence intact. PASS.

**B7: PASS.**

B7 was a MUTATING checkpoint that created exactly one real Google Classroom
coursework item, filed under no topic, correctly recorded end to end in the
emulator (assignment, succeeded publication, mirror pointer, single success
audit event) and confirmed by the operator in the real course.

The widened-connection publish path without a topic is now certified. This feeds
the topic-publication scenario B8 (publish with a selected topic), the next
certification checkpoint.

B9 evidence is preserved. B4b evidence is preserved. The temporary B9 upstream
diagnostic in `providers/google-classroom/transport.ts` is intentionally
retained per PDR-030g and is NOT removed by this task. B8 was not performed and
is not marked complete. Nothing was staged or committed.
