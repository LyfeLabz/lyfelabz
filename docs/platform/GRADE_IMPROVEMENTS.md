# Grade Improvements V1

Status: implemented on branch `feature/grade-improvements-v1`, not integrated,
not deployed. This document describes the feature contract; it does not change
the certified platform state in `CURRENT_PLATFORM_STATE.md`.

## Purpose

When a student beats their own best quiz score, the teacher sees a compact
**Update Grade** pill on the Assignment Detail roster. The teacher updates
PowerSchool by hand, then marks the grade as updated in LyfeLabz.

LyfeLabz never reads, writes, or verifies PowerSchool. Every acknowledgment
records only that the teacher said they updated it. UI wording reflects that
("Grade marked updated to 90%"), never "synced" or "verified".

No dashboard, navigation entry, or notification center is added.

## Detection

Derived on every read from the immutable `attempts` records. Nothing about
scoring, finalize, best-score selection, Classroom passback, or Current
selection changes.

Per student, per assignment occurrence (`assignmentId`):

- **Best** is the canonical `selectHighestCompletedAttempt` (percentage first;
  raw score is never compared).
- **Baseline** is the effective acknowledged percentage when one is in effect,
  otherwise the **first completed attempt** (lowest `attemptNumber`, then
  earliest `submittedAt`, then attempt id).
- **Pending** if and only if `best.percentage > baseline`.

Consequences:

- A first attempt alone is never pending.
- A lower or equal retake is never pending.
- Several improvements before acknowledgment collapse into one pending state
  at the current best, still measured from the original baseline
  (60 -> 70 -> 90 shows one pill: "60% to 90%").
- After acknowledgment at 90%, a later 100% is pending again ("90% to 100%").

### Assignment-occurrence identity

Detection and acknowledgment are keyed on `assignmentId`, never on lesson
identity. A reassigned lesson is a different occurrence with its own baseline
and its own history. This is intentionally separate from the Current
occurrence grouping used by Student Detail cards and Classroom passback;
neither grouping utility is modified.

## Teacher workflow

1. Classes -> class -> Assignments -> assignment. A Completed row with a
   pending improvement shows **Update Grade** to the right of the attempt
   count.
2. Teacher updates the PowerSchool gradebook by hand.
3. Teacher clicks **Update Grade**: "Mark Grade as Updated? Have you updated
   {student}'s PowerSchool grade from 60% to 90%?" -> **Cancel** or
   **Yes, Updated**.
4. On success the pill disappears. Student Detail shows "Grade marked updated
   to 90% on {date}" beneath that assignment's score tiles, with
   **View update history** and **Undo**.

## Data model

Server-owned, Admin SDK only:

```
gradeImprovementAcks/{assignmentId}__{studentId}
  assignmentId, studentId, classId, teacherId, schoolId, districtId
  eventCount            // number of events; CAS guard for the log
  effective             // {eventId, percentage, attemptId} | null (cache)
  updatedAt             // server timestamp

gradeImprovementAcks/{recordId}/events/{e000001, e000002, ...}
  eventId, sequence, type: "acknowledged" | "reversed"
  assignmentId, studentId, classId, schoolId, districtId
  actorTeacherId        // verified caller uid
  percentage, attemptId // acknowledged values (copied onto a reversal)
  baselinePercentage    // acknowledged: the baseline shown; reversed: null
  targetEventId         // reversed: the acknowledgment it undoes
  createdAt             // server timestamp
```

Events are written only with `Transaction.create` and are never updated or
deleted. `effective` on the parent is recomputed from the full log inside the
same transaction that appends an event.

No new collection-group query and no composite index: reads use
single-field equality (`attempts.assignmentId`, `gradeImprovementAcks.assignmentId`,
`gradeImprovementAcks.studentId`) plus direct subcollection reads.

## Acknowledgment and reversal semantics

**Effective acknowledgment** = the highest-sequence `acknowledged` event that no
`reversed` event targets. A reversal undoes exactly the one acknowledgment it
names and never affects any other.

**Acknowledge** `{assignmentId, studentId, attemptId, percentage}` (transaction):

- If the effective acknowledgment already equals `(attemptId, percentage)`:
  `alreadyAcknowledged`, no write (duplicate click, retry, concurrent twin).
- Else if the current pending improvement is not exactly
  `(attemptId, percentage)`: refuse with `gradeImprovements.stale`. A teacher
  can never acknowledge a score they were not shown. The UI shows "Nothing
  was marked" and refreshes the pill to the newer score.
- Else append `acknowledged`.

**Reverse** `{assignmentId, studentId, eventId}` (transaction):

- Unknown acknowledgment: `gradeImprovements.notFound`.
- Already reversed: `alreadyReversed`, no write.
- Not the effective acknowledgment: `gradeImprovements.stale` (an Undo shown
  for an older acknowledgment can never cancel a newer one).
- Else append `reversed`. The baseline falls back to the previous unreversed
  acknowledgment, or to the first attempt; the pill reappears when the best
  is above it.

Re-acknowledging after an Undo appends a new event; history is never
rewritten. Quiz attempts are never touched.

## Callables

| Callable | Request | Scope |
| --- | --- | --- |
| `gradeImprovementsListForAssignment` | `{assignmentId}` | Assignment Detail; pending improvements only |
| `gradeImprovementsListForStudent` | `{classId, studentId}` | Student Detail; per-occurrence effective state + history (newest first) |
| `gradeImprovementsAcknowledge` | `{assignmentId, studentId, attemptId, percentage}` | append `acknowledged` |
| `gradeImprovementsReverse` | `{assignmentId, studentId, eventId}` | append `reversed` |

## Security model

- `requireDistrictContext` on every call (authenticated, active, canonical
  claims, district agreement); role must be `teacher`.
- Ownership is derived, never supplied: the assignment and its class must both
  carry the caller's `teacherId` and `schoolId` and agree with each other (the
  `assessmentAssignmentSummary` chain). `teacherId`, `schoolId`, `districtId`,
  `uid`, `userId` (and `classId` on assignment-scoped calls) on a request are
  refused with `gradeImprovements.invalidRequest`.
- Student association is proven by the student's own attempts on that
  assignment, admitted only when every frozen ownership field matches.
- Stored records and events are re-checked against the authorized scope on
  every read.
- Firestore Rules: no new block. The terminal default-deny covers both paths;
  `platform/firebase/tests/grade-improvement-acks.rules.test.ts` proves every
  client role is refused get/list/create/update/delete.
- Contention that exhausts transaction retries maps to
  `gradeImprovements.writeConflict` (retryable).

## Client integration

- `app/src/assignments/gradeImprovements/`: `types.ts` (shapes, parsers, no
  firebase), `wire.ts` (Firebase callables), `session.ts` (session holder),
  `roster-pill.ts`, `student-history.ts`, `confirm-dialog.ts` (reuses the
  `.shell-assign-*` dialog and registers with `shell/openModals`).
- `app/src/index.ts` installs the seam for an active-teacher session and
  clears it on sign-out. Assignment Detail and Student Detail read the holder
  when their deps do not supply a seam. This avoids threading a new dep
  through `shell/surfaces/workspace.ts` and `router/surfaces/index.ts`
  (Units Modernization overlap files).
- Both surfaces are best-effort: a failed read renders nothing extra and
  never alters the roster or the score tiles.
- Roster layout: rows keep their three columns unless a pill is shown; then
  every row gains the same fixed fourth column so scores and attempt counts
  stay aligned. At 480px and below the pill wraps under the score.

## Known limitations

- Only the owning teacher can act; history shows "by you". There is no
  co-teacher model.
- Assignment Detail reads every attempt of the assignment per open (bounded by
  class size x attempts, single-field query, same pattern as
  `assessmentAssignmentSummary`).
- Student Detail reads one events subcollection per occurrence with history.
- The pill does not auto-refresh while a page stays open; reopening the
  assignment (or a stale refusal) re-reads it.
- No audit-event type is added; the append-only event log is the record.

## Deployment prerequisites (not performed)

- Functions: deploy the four new callables (`--only
  functions:gradeImprovementsListForAssignment,functions:gradeImprovementsListForStudent,functions:gradeImprovementsAcknowledge,functions:gradeImprovementsReverse`
  with explicit `--project`). They use `platformCallable` with no options,
  like the existing assessment callables; no callable manifest needs updating.
- Hosting: the app bundle and `app/index.html` CSS change. Release Hosting
  only after the Functions are live, or the pill read fails silently (best
  effort, no visible error).
- No Firestore Rules, index, OAuth, or configuration change. No migration.
