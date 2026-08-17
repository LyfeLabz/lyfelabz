# Sprint 25 - B11 / B12 Certification Findings

Status: **B11 PASS** and **B12 PASS**. The single Google Classroom
coursework item created by the successful B8 Attempt 3 ("Cell Types") was
operator-confirmed in the real linked Google Classroom course, its attached
material points at the LyfeLabz Cell Types assignment URL, and the item is
filed under the "Final Exam" topic. Both in-Classroom checkpoints are now
satisfied and correlate exactly with the backend evidence established in
`SPRINT_25_B8_CERTIFICATION_FINDINGS.md` §12 (Attempt 3). No new publication
was performed and no Google Classroom resource was modified.

Style: no em dashes. Use " - " (spaced hyphen).

This is a read-only certification closeout: no production code, no Firestore
document, no callable, no OAuth state, no connection, and no Google Classroom
resource was modified. Nothing was staged or committed. The evidence below
correlates operator browser-side observation with the already-established
backend record; it does not re-run any investigation.

Environment of record: Emulator Suite (project `lyfelabz-prod`, Firestore
`127.0.0.1:8080`, Functions `5001`), app served statically at
`http://localhost:5000`. The backend record for this coursework was captured
read-only in `SPRINT_25_B8_CERTIFICATION_FINDINGS.md` §12 and is unchanged.

---

## 1. Canonical checkpoints under test

- **B11** (browser checklist §B11): "Publication appears in the correct
  Classroom course." Canonical PASS criterion: "PASS when the item is present
  in the correct course **and** points at the LyfeLabz assignment URL." Both
  conditions are required.
- **B12** (browser checklist §B12): "Publication appears under the correct
  topic when selected." Canonical PASS criterion: "PASS when the item is under
  the selected topic; the B7 item (no topic) is not filed under any topic."

Both are real-google, decisive (in-Classroom visual) checkpoints. Their setup
prerequisite - a successful topic publication (B8) against the active widened
connection - was satisfied by B8 Attempt 3.

---

## 2. Correlated identifiers (single logical publication)

| Identifier | Value |
|---|---|
| LyfeLabz assignment id | `a-cell-types-3la0b7o2jgw03cfzebw5-cert-teacher-001-d4133126c1e9` |
| Publication id | `a-cell-types-3la0b7o2jgw03cfzebw5-cert-teacher-001-d4133126c1e9__googleclassroom__5355a53d` |
| attemptNonce / publication hash | nonce `d4133126c1e9` -> hash `5355a53d` |
| LyfeLabz class | `3la0b7o2jgw03cfzebw5` ("LyfeLabz Testing - Grade 7"), linkId `c5bafe12` |
| Google Classroom course id | `871447706346` |
| Google Classroom coursework id | `874752057518` |
| lmsTopicId | `871946939445` ("Final Exam") |
| Coursework URL (stored) | `https://classroom.google.com/c/ODcxNDQ3NzA2MzQ2/a/ODc0NzUyMDU3NTE4/details` |
| Observed attached-material URL | `http://localhost:5000/lesson_cell-types.html` |
| Lesson | Cell Types (slug `cell-types`) |
| Topic label | Final Exam |

The stored coursework URL base64 segments decode to course `871447706346`
and coursework `874752057518` - the same two ids the operator inspected -
so the operator's coursework and the backend `succeeded` publication record
are the same item. (Backend record: `SPRINT_25_B8_CERTIFICATION_FINDINGS.md`
§12.8.)

---

## 3. Operator evidence (exact, preserved verbatim)

Chris inspected the existing real Google Classroom "Cell Types" coursework
created by the successful B8 Attempt 3. No new publication was performed, no
coursework was edited, no topic was changed, no reconnect occurred, and no
OAuth flow occurred. The following was observed against the real linked
Google Classroom course:

1. **Cell Types is present in the correct real linked Google Classroom
   course** (course id `871447706346`, "LyfeLabz Testing").
2. **The attached material / link on that coursework points to exactly:**

   ```
   http://localhost:5000/lesson_cell-types.html
   ```

   This is the LyfeLabz Cell Types lesson URL in the local certification
   environment.
3. **The same Cell Types coursework appears beneath the "Final Exam" topic**
   in the real linked Google Classroom Classwork view (independently, visually
   confirmed by the operator).

---

## 4. B11 - Publication appears in the correct Classroom course

Canonical PASS requires both (a) presence in the correct real course and
(b) the item pointing at the LyfeLabz assignment URL.

### 4.1 Present in the correct real course (condition a)

- The operator observed the "Cell Types" coursework in the real linked course
  "LyfeLabz Testing".
- The backend succeeded publication record for this item carries
  `lmsClassId` (Google course) `871447706346`, which is the linked course for
  LyfeLabz class `3la0b7o2jgw03cfzebw5` via class link `c5bafe12`
  (`SPRINT_25_B8_CERTIFICATION_FINDINGS.md` §12.8, §12.7).
- Real Google accepted the coursework write and returned coursework id
  `874752057518` in that course, with a real `classroom.google.com` URL and
  no error - the decisive real upstream write (§12.8). Condition a: **met.**

### 4.2 Points at the LyfeLabz assignment URL (condition b)

- The operator observed the coursework's attached material link as
  `http://localhost:5000/lesson_cell-types.html`.
- This matches the publish path exactly. In the Google Classroom adapter the
  coursework material `link` is set to the client-supplied
  `lyfelabzAssignmentUrl`
  (`platform/functions/src/lms/providers/google-classroom/adapter.ts:659`,
  `link: input.lyfelabzAssignmentUrl`), which originates from
  `payload.lyfelabzAssignmentUrl`
  (`platform/functions/src/lms/assignments-publish.ts:142-145`).
- For `cell-types`, the LyfeLabz launcher URL is the v1 path
  `/lesson_cell-types.html`: `cell-types` is not present in the Sprint 18
  `launchOverrides` table (only `earths-layers` launches to the
  `/app/lessons/...` v2 path), so the canonical launcher URL for Cell Types is
  the v1 root path. `http://localhost:5000/lesson_cell-types.html` is exactly
  that v1 launcher URL served in the certification environment. Condition b:
  **met.**

Note on completeness: the operator reported the base launcher URL. The Sprint
17 launcher contract is `/lesson_<slug>.html?assignment=<id>`; whether the
`?assignment=` query segment was present or trimmed in the operator's view,
the host + path (`localhost:5000/lesson_cell-types.html`) unambiguously
identify the LyfeLabz Cell Types lesson and no other resource. The material
therefore points at the LyfeLabz assignment URL.

### 4.3 B11 verdict

Both canonical conditions are established: the item is present in the correct
real course, and its attached material points at the LyfeLabz Cell Types
assignment URL. **B11: PASS.**

---

## 5. B12 - Publication appears under the correct topic when selected

Canonical PASS requires the item to sit under the selected topic, and the B7
(No topic) item to remain filed under no topic.

### 5.1 Item filed under the selected topic

- The operator visually confirmed that the exact Cell Types coursework appears
  beneath the "Final Exam" topic in the real Google Classroom Classwork view.
- The backend succeeded publication record carries `lmsTopicId`
  `871946939445` (`SPRINT_25_B8_CERTIFICATION_FINDINGS.md` §12.8), the topic id
  the client sent for the operator-selected "Final Exam".
- The single `lms.assignmentPublished` audit event for this publication
  carries the same `lmsTopicId` `871946939445` - the only assignmentPublished
  event that carries a topic (§12.10).
- Real Google accepted the coursework creation using topic id `871946939445`
  (no `NOT_FOUND` / invalid-topic error), confirming `871946939445` is a valid
  topic in course `871447706346` (§12.9). The visual placement under "Final
  Exam" completes the label -> id confirmation that the backend record alone
  could not independently reconstruct (§12.9 explicitly named this in-Classroom
  placement as checkpoint B12).

### 5.2 B7 No-topic comparison preserved

The B7 publication for "What Is Life?"
(`a-what-is-life-...-1d72s6eu67qt6__googleclassroom__d38cd722`) carries **no**
`lmsTopicId` key at all - the field is omitted, not null or empty
(`SPRINT_25_B7_CERTIFICATION_FINDINGS.md` §3.4). Correspondingly its
`lms.assignmentPublished` audit payload carries no topic id, and the item
appears beneath Google Classroom's "No topic" heading (§3.9). This contrast is
the decisive discriminator for B12: the topic-selected Cell Types item is filed
under "Final Exam" (`lmsTopicId` present, `871946939445`), while the No-topic
What Is Life? item is filed under no topic (`lmsTopicId` absent). The
comparison is preserved intact.

### 5.3 B12 verdict

The topic-selected coursework is visually filed under "Final Exam" and its
backend record carries `lmsTopicId` `871946939445`; the B7 No-topic item
carries no topic id and sits under no topic. **B12: PASS.**

---

## 6. Duplicate-publication check

No new publication was performed for B11/B12; these are visual confirmations of
the existing B8 Attempt 3 item. The duplicate-negative checks established at
B8 Attempt 3 stand (`SPRINT_25_B8_CERTIFICATION_FINDINGS.md` §12.11):

- Exactly one succeeded Cell Types publication (`__5355a53d`), one Google
  coursework id (`874752057518`), one `lms.assignmentPublished` (topic-bearing)
  event.
- The failed Attempt-2 record (`__404d8b6d`, same topic, expired-token 401) and
  the older stale failed No-topic cell-types record (`__68970da1`) remain
  distinct and preserved; distinct nonces yield distinct deterministic
  publication ids, so no duplicate coursework exists.
- No second `lmsAssignmentsPublish`, no OAuth state created, no connection
  replacement, no scope widening.

No duplicate Cell Types coursework exists.

---

## 7. Prior certification evidence intact

- **B8** (`SPRINT_25_B8_CERTIFICATION_FINDINGS.md`): unchanged. This document
  adds only a forward cross-reference; the B8 Attempt 3 §12 verdict and record
  are not altered. The in-Classroom confirmations §12.9 / §12.12 anticipated
  (item in correct course = B11, under "Final Exam" = B12) are now completed
  here.
- **B7** (No-topic What Is Life?): unchanged; its No-topic record is preserved
  and reused as the B12 discriminator (§5.2).
- **B4b / B9 / B6** evidence: untouched.
- The active widened connection `googleclassroom__cert-teacher-001` (four
  scopes; `classroom.coursework.me` absent) is untouched; no OAuth movement.

---

## 8. Verification performed

- Read the canonical B11/B12/B13 criteria from
  `SPRINT_25_BROWSER_CERTIFICATION_CHECKLIST.md` (§B11 lines 276-287, §B12
  lines 289-297, §B13 lines 299-312).
- Read the runbook ordering and connection-state matrix
  (`SPRINT_25_CERTIFICATION_RUNBOOK.md` §5, lines 329-357).
- Correlated operator evidence against the existing backend record
  (`SPRINT_25_B8_CERTIFICATION_FINDINGS.md` §12), the B7 No-topic record
  (`SPRINT_25_B7_CERTIFICATION_FINDINGS.md` §3.4/§3.9), and the coursework URL
  base64 decode.
- Confirmed the attached-material link derivation in source
  (`.../google-classroom/adapter.ts:659`,
  `assignments-publish.ts:142-145`) and the launcher-URL contract for
  `cell-types` (v1 path; not in `launchOverrides`).
- No callable was invoked; no Firestore, OAuth, connection, or Google
  Classroom resource was read-mutated or modified; nothing was staged or
  committed.

---

## 9. Next canonical checkpoint

Per `SPRINT_25_CERTIFICATION_RUNBOOK.md` §5 ordering, after the in-Classroom
confirmations (step 5: B11, B12) the next checkpoint is step 6, the
bounded consent-failure scenarios, beginning with:

- **B13 - Teacher cancels or closes consent.**

Special state requirement (runbook §5 step 6 and the connection-state matrix,
line 352): B13 needs a **fresh readonly-only connection** - "a connection that
again lacks the coursework scopes; prepare a fresh readonly-only connection
(disconnect and reconnect readonly, or use a second test teacher) rather than
un-widening the primary one." The current connection is the **widened**
four-scope connection, which is the wrong state for B13.

**B13 must not be started yet.** The current widened connection holds the
B4b / B7 / B8 / B11 / B12 certification evidence. Disconnecting or
re-consenting it now would destroy that evidence. B13 will be planned
separately so a fresh readonly-only connection can be prepared without
disturbing the widened connection. Do not disconnect, do not initiate consent,
and do not issue B13 operator instructions from this closeout.
