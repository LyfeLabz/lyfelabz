# Student Support Access (Student Support Workspace V1)

Status: Implemented on `feature/student-support-workspace-v1`, uncommitted,
not deployed. Bulk sharing backend (V2 P1, section 3.1) on
`feature/student-support-workspace-v2`, uncommitted, not deployed. Governing decision: PDR-032 in `LYFELABZ_PLATFORM_DECISIONS.md`.
Authorized for implementation by the product owner on 2026-10-27; final
ratification happens at owner review of this change.

This is the canonical contract for read-only, student-specific support
access. It is a narrow exception to the deferred co-teaching model, not
co-teaching.

---

## 1. What it is

A classroom teacher (the class owner) can let another verified teacher at
the same school (the support educator) see one student's existing Student
Detail for one class, read-only. The teacher can revoke that access at any
time.

It is not:

- co-teaching, shared class ownership, or `coTeacherIds`;
- a new role, claim, or identity family (support educators are ordinary
  active `teacher` accounts);
- cross-school or cross-district access;
- access to the class roster, class-wide results, assignments, Classroom
  data, accommodations, or any editing action;
- a notification, invitation, or account-creation workflow.

## 2. Grant record

Collection: `studentSupportGrants/{grantId}`. Server-only: no explicit Rules
block exists, so the terminal default-deny refuses every client read and
write for every role (the Grade Improvements precedent), pinned by
`platform/firebase/tests/student-support-grants.rules.test.ts`.

Document id: `${classId}__${studentId}__${granteeUid}`, so one
(class, student, grantee) triple has at most one record. Re-granting after a
revoke reactivates the same record.

| Field | Meaning |
| --- | --- |
| `classId` | The owner's class. |
| `studentId` | The one student the grant covers. |
| `ownerTeacherId` | The class's frozen `teacherId` at grant time. |
| `granteeUid` | The support educator's uid. |
| `schoolId` | The class's school (equal to both teachers' school). |
| `districtId` | The owner's verified district. |
| `status` | `active` or `revoked`. |
| `grantedAt`, `grantedBy` | Server timestamp and owner uid of the latest grant. |
| `revokedAt`, `revokedBy` | Present only while `status` is `revoked`. |

A grant covers exactly one class. It never authorizes the same student in
another class, including another teacher's class.

## 3. Callables

All are `platformCallable`s that require an authenticated, active `teacher`
(`requireDistrictContext`). No request accepts `teacherId`, `uid`, `userId`,
`schoolId`, or `districtId`.

| Callable | Caller | Behavior |
| --- | --- | --- |
| `supportAccessGrant({classId, studentId, granteeEmail})` | Owner | Class must be owned, `active`, same school. Student must have an `active` enrollment. The email resolves only to an active `teacher` in the owner's school (not the owner). Idempotent. Writes `supportAccess.granted` in the same transaction. Returns `{grant, outcome}`; `outcome` (`shared` or `alreadyShared`) was added in V2 and V1 clients ignore it. |
| `supportAccessGrantMany({classId, studentIds[], granteeEmails[]})` | Owner | Bulk form of `supportAccessGrant`. See section 3.1. |
| `supportAccessRevoke({grantId})` | Owner | The grant must name the caller as owner. Idempotent. Writes `supportAccess.revoked` in the same transaction. |
| `supportAccessRevokeMany({grantIds[]})` | Owner | Bulk form of `supportAccessRevoke`. See section 3.1. |
| `supportAccessListForClass({classId})` | Owner | Active grants on one owned class, with student and grantee names. |
| `supportAccessListMine({})` | Grantee | Active grants naming the caller that currently pass the full authorization check (section 4), with student, class, and owner names, and `classBlock`: the class record's `block`, read at list time (null if absent). Class and teacher metadata are never copied into grant records. |

Email lookup is equality on the stored `users/{uid}.email` (as typed and
lowercased). Stored emails are copied verbatim from Firebase Auth and have
no normalized twin, so when neither matches, one Firebase Auth
`getUserByEmail` lookup (case-insensitive; the same path the operator
bootstrap tools use) supplies a candidate uid whose canonical `users/{uid}`
record must still pass every check. No scan, migration, or new field.

Email lookup returns one uniform refusal (`supportAccess.granteeUnavailable`)
for every non-match: unknown email, another school, inactive account,
non-teacher, ambiguous match, or the owner's own email. A teacher can learn
only whether an email belongs to an active teacher at their own school.

### 3.1 Bulk grant and revoke (V2)

The bulk callables run the same per-grant transaction bodies
(`applyGrantInTransaction`, `applyRevokeInTransaction` in
`platform/functions/src/supportAccess/callables.ts`) as the single ones, so
record shape, ownership checks, idempotency, and audit are identical. A bulk
grant creates one independent student-level grant per (student, recipient)
pair. There is no class-wide grant and no separate permission model.

**Limits.** Counted on the raw arrays, before de-duplication:

| Request | Cap |
| --- | --- |
| `studentIds` per grant | 40 |
| `granteeEmails` per grant | 10 |
| `grantIds` per revoke | 200 |

**Whole-request refusals** (nothing is written):
`supportAccess.invalidRequest` for a non-object payload, an ownership key, a
missing, empty, non-array, or over-cap list, a non-string or malformed id, or
a non-string, blank, or over-1024-character email entry. For grants, also
`classes.forbidden` (class not owned or another school) and
`supportAccess.classNotActive`, the single grant's codes, because every pair
shares the class.

**`supportAccessGrantMany` response.** `{classId, results[], summary}`.
`results` has one entry per de-duplicated (student, recipient) pair, in
student order then recipient order: `{studentId, granteeEmail, outcome,
grantId, granteeDisplayName, reason}`. `granteeEmail` is the entry trimmed
and lowercased. `summary` counts `shared`, `alreadyShared`, and `failed`.

| `outcome` | Meaning |
| --- | --- |
| `shared` | Newly granted, or a revoked grant reactivated. One `supportAccess.granted` event. |
| `alreadyShared` | Already active. Not rewritten (`grantedAt` unchanged), no event. |
| `failed` | Not shared; `grantId` and `granteeDisplayName` are null. |

| `reason` (failed only) | Meaning |
| --- | --- |
| `invalidEmail` | The entry is not an email address (syntax only). |
| `granteeUnavailable` | The uniform recipient refusal of section 3: unknown, another school, inactive, non-teacher, ambiguous, or the owner. Nothing distinguishes these cases, and no uid is returned. |
| `studentNotEnrolled` | No `active` enrollment in this class (withdrawn, unknown, or never enrolled). |
| `recordInconsistent` | A stored record under this id disagrees with its id or the caller. Left untouched. |
| `writeConflict` | That student's transaction lost to concurrent writes. Retrying is safe. |
| `unavailable` | That student's transaction failed for another reason. Retrying is safe. |

A recipient failure is reported in preference to a student failure for the
same pair. Duplicate student ids, and emails equal after normalization,
collapse to one pair, so no record or event is written twice in a request.

**`supportAccessRevokeMany` response.** `{results[], summary}`, one entry per
de-duplicated grant id: `{grantId, outcome, reason}`, with `outcome`
`revoked` (one `supportAccess.revoked` event), `alreadyRevoked` (no event),
or `failed` with `reason` `notFound`, `writeConflict`, or `unavailable`.
`notFound` covers both a missing grant and a grant naming another owner, so a
caller never learns whether another teacher's grant exists, and such a
grant is never written. `summary` counts the three outcomes.

**Transactions and partial results.** A bulk grant commits each student's
pairs in one transaction (at most 10 grants and 10 audit events). A bulk
revoke commits in transactions of 50 grants. Transactions run one at a time.
Every transaction stays far below Firestore's 500-write limit, and a failure
affects only that transaction's entries, so `results` always reports exactly
what committed. Outcomes are recomputed on each SDK transaction retry. A
repeated request (for example a client retry) returns `alreadyShared` or
`alreadyRevoked` for entries that already committed and writes nothing for
them. Recipients are resolved, and enrollments read, once per request, before
any transaction, as the single grant does.

## 4. Authorization (`authorizeStudentScopedRead`)

`platform/functions/src/supportAccess/authorize.ts` is the one shared
server check for student-scoped reads. It returns the class owner's uid so
every downstream row filter compares frozen ownership against the OWNER,
never against the caller.

1. The class exists and its `schoolId` equals the caller's school.
2. If the caller owns the class: allowed (unchanged owner behavior,
   including archived classes and withdrawn students' history).
3. Otherwise the grant `${classId}__${studentId}__${callerUid}` must exist
   with `status: "active"` and every frozen field matching the class, the
   student, the caller, and the caller's school and district.
4. The class `status` is `active`.
5. The student's enrollment `${classId}__${studentId}` is `active`.
6. The owner's `users/{uid}` record is `active`, role `teacher`, same school.
   The caller's own active status, role, school, and district are already
   enforced by `requireDistrictContext`.

Every failure is `classes.forbidden`, indistinguishable from a class the
caller has never seen. The check runs on every request; nothing is cached in
claims or tokens.

## 5. Reads open to a grantee

| Callable | Change |
| --- | --- |
| `assessmentAttemptsListForStudent({classId, studentId})` | New. One student's completed-attempt summaries, through the same projection and display-name resolver as `assessmentAttemptsListForClass`. Owners may call it too. |
| `assessmentStudentAssignmentsForClass` | Owner or grantee via the shared check. |
| `assessmentAttemptGetForTeacher` | Owner, or a grantee holding an active grant for the attempt's frozen `classId` and `studentId`. |
| `gradeImprovementsListForStudent` | Owner or grantee via the shared check (history only). |

Still owner-only, unchanged: `assessmentAttemptsListForClass`,
`enrollmentsListForClass`, `gradeImprovementsAcknowledge`,
`gradeImprovementsReverse`, `gradeImprovementsListForAssignment`, every
assignment, class, roster, Classroom, accommodation, and summary callable.
Firestore Rules are unchanged for `classes`, `attempts`, `enrollments`, and
`assignments`: a grantee has no direct document access.

## 6. Revocation

Revocation sets `status: "revoked"`. Every later server read by that grantee
fails the check in section 4 immediately. Revocation does not erase
information already rendered in a grantee's open browser tab; that remains
visible until the tab navigates or reloads. Grants also stop working,
without being revoked, while the class is not active, the enrollment is not
active, or the owner is not an active teacher at that school.

## 7. Client

- Classes surface: a "Shared students" section lists `supportAccessListMine`
  results. Choosing a student opens the existing Student Detail renderer
  (`renderStudentDetailSurface`) in read-only mode, wired to
  `assessmentAttemptsListForStudent`. Each student shows the classroom
  teacher, class, and block (`Mr. Brown · Science 7 · B Block`, from
  `ownerDisplayName`, `classTitle`, `classBlock`); the block is omitted when
  absent or already in the class name. A failed read shows an error with
  Try again, never an empty list.
- Student Support Workspace (V2 P3, `app/src/shell/supportWorkspace.ts`): a
  teacher whose owned-class list (every status) is empty and whose shared
  list is not sees the same shell with Classes presented as the "Student
  Support" landing, navigation reduced to Student Support, and Curriculum,
  My Units, and Settings refused through navigation, intra-shell seams,
  direct URLs (a fresh load that asks for another surface shows a neutral
  "Loading your workspace" status, with no navigation, until the owned-class
  read, and for zero classes the shared read, resolves; the results are
  handed to the mounted surface, not re-fetched), and Back/Forward (a teaching-only entry lands on Student
  Support and is replaced). It is a presentation of the two reads, not a
  role: nothing is persisted. It lasts for that page life, so revoking the
  last grant shows "No students are shared with you right now."; the next
  load, with no classes and no shares, shows the existing onboarding. No
  existing account state identifies a former support educator, and none is
  added. Teachers who own a class keep the full workspace with the Shared
  students section. With zero owned classes and a failed shared read the
  workspace is unresolved: a neutral "We could not finish loading your
  workspace." with Try again, never onboarding or "no shared students".
- Read-only mode hides the grade-update Undo. The server already refuses it.
- Settings > Student Services (V2): a "Share Student Progress" section,
  below Reading Accessibility for the chosen class, lets the owner check
  students (Select all / Clear all), add several support-teacher emails
  (syntax-checked, normalized, de-duplicated), and share in one
  `supportAccessGrantMany` call. Results show shared, already shared, and
  each failed pair; failed students and emails stay selected for correction.
  Active grants (`supportAccessListForClass`) can be removed one at a time
  (`supportAccessRevoke`) or, after confirmation, in bulk
  (`supportAccessRevokeMany`); the list is re-read after every change. There
  is no Save: each change takes effect when the server confirms it. Class
  settings no longer hosts sharing.
- Wiring uses the session-installed holder pattern
  (`app/src/supportAccess/session.ts`), like Grade Improvements.
- The owner's Student Detail keeps its existing class-wide attempts read; the
  grantee's uses `assessmentAttemptsListForStudent`. Both feed the same
  renderer. A grantee's view has no roster, so no Previous/Next, and no
  assignment registry, so an attempt outside every server group shows the
  generic title "Assignment".
- Browser history reuses the existing Student Detail seam: opening a shared
  student pushes the standard `shell-student-detail` entry (stable ids only);
  browser Back returns to the Classes list with Shared students, Forward
  re-opens only a student the server-authorized Shared students list
  contains, and the in-app "Back to Classes" replaces the entry with the
  Classes list (`exit-workspace`), as leaving a class workspace does.

## 8. Question review (shared, PDR-032e)

Student Detail shows a "Review questions" disclosure per card for owners and
grantees alike. It lists each attempt individually and, per question: number,
question text, correct or incorrect, the student's answer, the correct answer,
and the frozen explanation when present.

- Correctness, the student's selected option, the correct option, and the
  explanation come from the immutable attempt (`itemResults`).
- Question and choice text come from the immutable
  `assessmentRevisions/{attempt.assessmentRevisionId}` through the existing
  revision content reader and `buildQuestionDetail` consistency check.
- Attempts delivered with an adapted presentation carry
  `canonicalContent: false` on the teacher attempt projection. For them the
  review shows results only (number, correct or incorrect, explanation), with
  a neutral note, never canonical wording the student did not see.
- Show Your Thinking remains a separate, ungraded written response. No
  correctness is shown for it.
- All item types in schema v1 are `singleChoice`.

## 9. Audit

`supportAccess.granted` and `supportAccess.revoked`, one per grant whose
status changes (bulk calls included), target type
`studentSupportGrant`, target id the grant id, with `schoolId` and
`districtId`. Payload: `classId`, `studentId`, `granteeUid`. Reads are logged
as structured logs with `via: "owner" | "grant"`.

## 10. Production surfaces

Functions (new and modified callables, including `supportAccessGrantMany`
and `supportAccessRevokeMany`) and Hosting (paired `app` and
`marketing` release). No Firestore Rules change (default-deny), no index,
OAuth, migration, or new infrastructure.
