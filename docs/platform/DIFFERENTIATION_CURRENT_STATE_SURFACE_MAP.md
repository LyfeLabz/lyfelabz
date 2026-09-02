# LyfeLabz Differentiation Current-State Surface Map

**Status:** Evidence-gathering artifact (P1). Descriptive only.
**Purpose:** Give a later architecture-design session (Fable) an accurate,
repository-grounded picture of how LyfeLabz identity, classes, lessons,
assignments, student launch, sessions, attempts, reporting, LMS integration,
and security currently work, so that session does not need to rediscover the
platform before designing persistent student differentiation.
**Scope discipline:** This document selects **no** persistence scope, storage
model, generation strategy, or UI for differentiation. It records what exists
today and what a differentiation design must not break.

---

## 1. Scope and Method

Produced by targeted `rg` search and direct reads of canonical docs and
production source, per the working policy in `CLAUDE.md`. Primary evidence
sources, in the order actually used:

1. Production TypeScript source under `platform/functions/src/` (callables,
   canonical types).
2. `platform/firebase/firestore.rules` (606 lines, read in full for the
   collections named below).
3. Canonical contracts under `docs/platform/`: `CURRENT_PLATFORM_STATE.md`,
   `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`,
   `LYFELABZ_FIRESTORE_DATA_MODEL.md`,
   `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`,
   `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`,
   `ASSESSMENT_PIPELINE_SPECIFICATION.md`,
   `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `PDR_030_LMS_ASSIGNMENT_PUBLICATION.md`.
4. Older sprint/history documents were **not** read; nothing below depends on
   them.

Where a canonical doc and production code disagree, both are recorded and
neither is silently preferred (§14). No lesson content, lesson HTML, slide
deck, or unrelated subsystem was read or modified. No production code, test,
rule, or configuration file was changed. Roughly 30 repository files were
materially inspected (listed in §15).

---

## 2. Identity

**Canonical student identity.** `users/{uid}`, keyed by Firebase Auth `authUid`
(`platform/functions/src/shared/types/user.ts`). A student identity is created
only at first successful Google sign-in, never at roster import
(`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §16). The LyfeLabz Student ID
(the `uid`) is permanent within a district; a cross-district move creates a
new identity (§18). Activation-required fields (`role`, `schoolId`,
`displayName`) become required only when `status` leaves `provisioned`.

**Canonical teacher identity.** Same `users/{uid}` shape, `role: "teacher"`.
Teachers are gated by verification (`status: pendingVerification -> active`)
before any capability; unverified teachers cannot create classes, import,
mint join codes, view rosters, or read student data
(`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §4, §13). A pilot-only allowlist
guardrail (`platformConfig/teacherPilotAllowlist`) additionally gates the
`teachersApproveVerification` and `teachersActivatePilot` approval paths
server-side (`platform/functions/src/teachers/teachers-activate-pilot.ts`,
`platform/functions/src/shared/config/teacher-pilot-allowlist.ts`).

**Firebase/Auth relationship.** Firebase Authentication (Google Sign-In) is
the sole identity provider. Authorization is expressed by custom claims
`role`, `schoolId`, `districtId`, written only when `status === "active"`.
On disagreement between claims and the Firestore `users/{uid}` record, the
Firestore record wins (`CURRENT_PLATFORM_STATE.md` §4).

**Current `users/{uid}` shape relevant to differentiation**
(`platform/functions/src/shared/types/user.ts`):

```ts
type UserRecord = {
  authUid: string;
  status: "provisioned" | "pendingVerification" | "active" | "suspended" | "archived";
  createdAt: Timestamp;
  role?: "teacher" | "student" | "platformAdministrator";
  schoolId?: string;
  displayName?: string;
  email?: string;
  grade?: string;
  teacherProfile?: Record<string, unknown>;   // opaque, no defined fields
  studentProfile?: Record<string, unknown>;   // opaque, no defined fields
  consentState?: Record<string, unknown>;     // opaque, no defined fields
};
```

`studentProfile` is a typed placeholder (`Record<string, unknown>`) with an
explicit comment: "Nested activation-scoped profile shapes are defined in
later sprints. They are typed as opaque records here so that `UserRecord` can
be the single source of truth for reads without pre-committing to fields the
data model has not yet enumerated." **No field inside `studentProfile` is
defined, read, or written anywhere in the current codebase** (§11).

**Role/claims behavior.** Custom claims are `{ role, schoolId, districtId }`.
`districtId` is written as a claim, but it is **not** a stored field on every
domain document (§14 records where this matters). `schools/{schoolId}`
carries an optional `districtId` (`platform/functions/src/shared/types/school.ts`);
a caller's effective district is resolved via `requireDistrictContext()`
(`platform/functions/src/shared/auth/require-district-context.ts`), not by
reading `districtId` off every downstream record.

**Google Classroom identity relationship.** Primary match key is the Google
Classroom User ID; email is a secondary validator only
(`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §17). A roster import creates an
`awaitingFirstSignIn` **class-level roster placeholder**, not a `users/{uid}`
document; first sign-in resolves the placeholder to a real student identity,
atomically and idempotently (§16). External identifiers are held on the
mirror surface (`externalIdentities/{externalIdentityId}`,
`platform/functions/src/shared/identity/external-identity-store.ts`;
`platform/firebase/firestore.rules:565`), never on `users/{uid}` directly.

**Identity invariants downstream systems depend on:**
- `uid` is immutable and is the join key for `enrollments.studentId`,
  `assignments.teacherId`, `attempts.studentId`, etc.
- A student's identity is stable across every class/school move within a
  district; a differentiation setting keyed to `uid` would follow the
  student across classes automatically. A setting keyed to `enrollments`
  would not.

---

## 3. Classes, Rosters, and Enrollments

**Canonical class record.** `classes/{classId}`
(`platform/functions/src/shared/types/class.ts`). One teacher owner
(`teacherId`), one school (`schoolId`), immutable at creation. `status` is
the sole lifecycle field: `active | archived | needsSetup`. Every class has
exactly one **roster authority**, expressed by the optional
`enrollmentSource?: "lms"` field (absent/default = join-code/manual).
Manual classes carry a server-minted `joinCode`; LMS-linked classes never do
(the biconditional is enforced at write time in `classesCreate` /
`classesActivate`, and defended again at read time in
`enrollmentsJoinByCode`).

**Enrollment/roster representation.** `enrollments/{enrollmentId}`
(`platform/functions/src/shared/types/enrollment.ts`). Document ID is
deterministic: `enrollmentIdFor(classId, studentId) = "${classId}__${studentId}"`
(`platform/functions/src/enrollments/enrollments-join-by-code.ts:104-106`).
This means **one enrollment document per (class, student) pair by
construction** — a student in N classes has N separate enrollment documents,
each independently addressable and independently readable/writable.

```ts
type EnrollmentRecord = {
  studentId: string;
  classId: string;
  schoolId: string;      // denormalized from class, no districtId field
  status: "active" | "transferred" | "withdrawn" | "archived";
  enrolledAt: Timestamp;
  displayNameOverride?: string;
  exitedAt?: Timestamp;
};
```

**Enrollment identifiers.** `studentId` + `classId` are the compound key;
the document ID itself encodes both, so a differentiation record scoped to
"this student in this class" already has a natural, existing document to
attach to (the enrollment) if a per-class scope were ever chosen — this
document does not recommend that scope, it records that the identifier
shape exists.

**Student identity linkage.** `enrollments.studentId` = `users/{uid}`. No
enrollment carries a display name copy from `users`; `displayNameOverride`
is the only per-class name variance, written only by
`enrollmentsSetDisplayNameOverride` (per
`ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`, not independently
re-verified here).

**Teacher ownership/authorization linkage.** Enrollment rules resolve
ownership by reading the parent `classes/{classId}.teacherId`
(`platform/firebase/firestore.rules:149-165`) — a `get()` lookup, not a
denormalized field on the enrollment.

**Google Classroom imported roster representation.** LMS-linked classes are
mirrored via `lmsClassLinks/{linkId}` (one active link per LyfeLabz class)
and, per enrollment, an optional `lmsRosterRef` pointer (documented in the
Firestore Data Model §3.4; not independently re-verified in code for this
task, per the strict search boundary). Roster authority for an LMS-linked
class is Google Classroom; the LyfeLabz `enrollments` collection is a mirror,
refreshed by teacher-initiated sync (`classesSyncRoster`,
`platform/functions/src/lms/classes-sync-roster.ts`).

**Roster reconciliation behavior.** First sign-in reconciles a Classroom
placeholder to a real `enrollments` document; ambiguous matches are held for
administrative resolution, never resolved by student choice
(`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §17).

**Active/inactive/withdrawn state.** `EnrollmentStatus`: `active`,
`transferred`, `withdrawn`, `archived` (terminal, applied when the enrolling
class archives). Only `active` enrollments authorize a student to launch an
assignment or begin a session (§6, §7).

**Multi-class participation.** A student can be enrolled in many classes
simultaneously; each is a distinct `enrollments/{classId}__{studentId}`
document with independent status. There is **no** array of class IDs on
`users/{uid}` and no array of student IDs on `classes/{classId}` — the
enrollments collection is the sole join table (`LYFELABZ_FIRESTORE_DATA_MODEL.md`
§4.3-§4.4, confirmed structurally by the class/enrollment types above).

**Denormalized fields.** `enrollments.schoolId` is the only denormalization
on the enrollment record. Notably **`districtId` is not stored on
`enrollments` or on `classes`** in the current type definitions (§14).

---

## 4. Lesson and Activity Representation

**Canonical lesson/activity identifier.** The repository file-naming slug,
e.g. `lesson_g7_earths-layers`. This slug is used interchangeably as
`lessonSlug` (on the assignment) and `activityId` (on sessions/attempts) —
confirmed in code: `activityId: assignment.lessonSlug` at
`platform/functions/src/assessments/assessment-sessions-begin.ts:230`. There
is currently **no separate lesson-catalog Firestore collection** wired into
the assessment pipeline; the slug itself is the identifier, and the two
generated HTML artifacts (`/lesson_<slug>.html` and
`/app/lessons/lesson_<slug>.html`) are the delivery surfaces
(`CURRENT_PLATFORM_STATE.md` §10; the `lessons/{slug}` catalog record
described in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §2.5/§3.5 is a design
document, not confirmed as implemented in this task's search boundary).

**Version/revision concepts actually used.** Not lesson HTML versioning —
**assessment revisioning**. `assessments/{assessmentId}` (deterministic ID
`assessment_{activityId}`) has one or more
`assessmentRevisions/{assessmentId}__r{ordinal}` documents, each paired with
an `assessmentAnswerKeys/{revisionId}` document
(`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §9, §12). A new revision is created
only when a change would meaningfully affect scoring or student experience.
This is the only "version" concept the current pipeline freezes and stamps.

**Where assignment records point to lessons/activities.**
`assignments/{assignmentId}.lessonSlug` (required, frozen at creation, never
rewritten by `assignmentsUpdateDraft` after publication) — see §5.
`assignments/{assignmentId}.assessmentRevisionId` is stamped exactly once,
on the first `draft -> published` transition, from the assessment's
currently-deployed revision
(`platform/functions/src/shared/types/assignment.ts:121-140`). Every
downstream session and attempt scores against **that exact stamped
revision**, not whatever is newest at attempt time.

**Version-freezing behavior used by sessions/attempts.** A session
(`assessmentSessions/{sessionId}`) freezes `activityId`, `assessmentId`,
`assessmentRevisionId` at creation and never rewrites them (autosave writes
only `responses` and `lastActivityAt`). An attempt
(`attempts/{attemptId}`) freezes the same triple permanently. **This is the
existing "one canonical artifact, frozen per student session" mechanism** —
it currently freezes one revision of one assessment for one activity, not a
per-student *variant* of the underlying lesson content itself.

**How the system identifies exactly what a student launches.** The
assignment's `lessonSlug` (which HTML lesson) +
`assignment.mode` (`practice` routes to the lesson surface with no
assessment pipeline; `classroom` routes through the session/attempt
pipeline) + the stamped `assessmentRevisionId` (which scored content). There
is currently **no field, on any document in the launch path, that selects
among multiple presentations of the same `lessonSlug`.**

**Relationship between public (v1) and authenticated (v2) content.**
`app/src/assignments/studentList/launchOverrides.ts` maps a `lessonSlug` to
its v2 authenticated path (`/app/lessons/lesson_<slug>.html`) for the 49
routed slugs; any non-listed slug launches to the byte-identical v1 URL
(`CURRENT_PLATFORM_STATE.md` §10). This mapping is **slug-keyed and global**
— it does not vary by student, class, or teacher. It is the one place in the
current architecture where "which artifact does this slug resolve to" is
already indirected through a lookup table, though today the lookup has no
per-student dimension.

---

## 5. Assignment Record

**Collection/path.** `assignments/{assignmentId}`, top-level (not nested
under class or teacher). Document ID is server-generated and opaque
(`ASSIGNMENTS_COLLECTION = "assignments"`,
`platform/functions/src/shared/types/assignment.ts:4`).

**Canonical shape** (`AssignmentRecord`):

```ts
{
  classId: string;
  teacherId: string;       // denormalized from class
  schoolId: string;        // denormalized from class
  lessonSlug: string;      // frozen at creation
  mode: "practice" | "classroom";
  status: "draft" | "published" | "closed" | "archived";
  createdAt: Timestamp;
  assessmentRevisionId?: string;   // stamped once, on first publish
  title?: string;
  instructions?: string;
  windowClosesAt?: Timestamp;
  availableAt?: Timestamp;
  lmsPublicationRef?: string;      // mirror pointer only
  publishedAt?: Timestamp;
}
```

There is **no `districtId` field on the assignment document** (§14). There
is no per-student field of any kind on the assignment document itself —
student-level population is a **separate subcollection** (below).

**One assignment represents the entire class.** Confirmed: "Every assignment
belongs to exactly one class... one assignment per class per activity"
(`ASSESSMENT_PIPELINE_SPECIFICATION.md` §12.1). A teacher who targets N
classes in one gesture produces N independent `assignments/{assignmentId}`
documents (fan-out), never one assignment shared across classes. **This is
the single most load-bearing fact for a differentiation design**: today,
"one assignment, one class, everyone in the class sees the same
`lessonSlug`" is structural, not incidental.

**Existing student-specific assignment state.** The frozen, append-only
`assignments/{assignmentId}/recipients/{studentId}` subcollection (PDR-029h,
`platform/functions/src/shared/types/assignment-recipient.ts`):

```ts
{
  assignmentId: string;
  studentId: string;       // also the document ID
  classId: string;
  teacherId: string;
  schoolId: string;
  districtId: string;      // recipients DO carry districtId, unlike the parent assignment
  assignedAt: Timestamp;
  assignedBy: string;
  source: "classPublication" | "manualAddition";  // "lmsImport" reserved, unused
  status: "assigned";      // the only defined value
}
```

This is the platform's **existing per-student membership record for an
assignment** — it currently records only *that* a student is a recipient
(for authorization and analytics population), never *what version or
presentation* that student should receive. It is append-only; direct client
read/write is denied at the rules layer
(`platform/firebase/firestore.rules:227-262`); the two writers are
`assignmentsPublish` (initial snapshot at first publication) and
`assignmentsRecipientAdd` (late manual addition).

**Creation/publication path.** `assignmentsCreateDraft` (writes `draft`) ->
`assignmentsUpdateDraft` (teacher-editable metadata only:
`title, instructions, lessonSlug, mode, windowClosesAt, availableAt` — never
ownership or status) -> `assignmentsPublish` (stamps
`assessmentRevisionId` + `publishedAt`, snapshots the recipient population)
-> `assignmentsClose` / `assignmentsReopen` -> `assignmentsArchive`. Every
write shape is narrow-by-construction (a `close` write can only set
`status: "closed"`, nothing else), specifically to prevent a callable from
being "laundered" into an unrelated field change
(`platform/functions/src/shared/types/assignment.ts`, comments throughout).

**State transitions relevant to student launch.** `draft` is invisible to
students. `published` and `closed` are the only statuses the deep-link
resolver and session-begin will route into (closed = read/informational
only, no new sessions). `archived` refuses everything.

---

## 6. Student Launch and Authorization Pipeline

Sequence for a Google-Classroom-originated deep link (also the general
shape for any authenticated arrival at an assignment):

```
Classroom coursework link
  -> https://lyfelabz.com/app/a/{assignmentId}   (URL carries ONLY the opaque assignmentId)
  -> /app/** bootstrap establishes identity (sign-in if needed; arriving URL preserved through the round trip)
  -> client invokes lmsDeepLinkResolve({ assignmentId })
  -> lmsDeepLinkResolveHandler (platform/functions/src/lms/deep-link-resolve.ts)
       1. requireDistrictContext(request)  -> authenticated, active, role check deferred
       2. role === "student"                (else role-forbidden)
       3. load assignments/{assignmentId}    (else assignment-not-found)
       4. assignment.schoolId === actor.schoolId   (else district-mismatch -- see note below)
       5. assignment.status !== "draft"/"archived" (else assignment-not-published / assignment-archived)
       6. active enrollment in assignment.classId  (else enrollment-inactive)
       7. compute internalTarget + attemptContext (recipient-aware; read-only)
       8. emit lms.deepLinkResolved audit event
  -> client dispatches to internalTarget with no further class/assignment picker (silent arrival)
  -> for internalTarget = "assignmentLaunch": student proceeds into the session pipeline (assessmentSessionsBegin)
  -> for internalTarget = "lessonPractice": student opens the lesson surface directly, no session/attempt created
  -> for internalTarget = "informational": student sees a calm non-leaking surface, no session created
```

**Relevant client routes.** `/app/a/{assignmentId}` (the only shape; no
query string, no fragment, no secondary identifier —
`GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` §8.1-§8.2, enforced
by a `FORBIDDEN_REQUEST_KEYS` allowlist-refusal list in the resolver itself:
`studentId, uid, userId, districtId, schoolId, classId, teacherId,
recipientId, sessionId` are all refused if a client attempts to assert them
— `platform/functions/src/lms/deep-link-resolve.ts:90-99`).

**Server callables in the pipeline (real names, verified in
`platform/functions/src/`):**
- `lmsDeepLinkResolve` — read-only resolver, student-only, never writes
  session/attempt/assignment/publication/link state, writes only the audit
  event.
- `assessmentSessionsBegin` — creates or resolves the Live session (§7).
- `assignmentsListForStudent` — serves the "My Assignments" list via a
  **collection-group query on `recipients.studentId`**
  (`assignmentRecipientsCollectionGroupRef()`,
  `platform/functions/src/assignments/assignments-list-for-student.ts:221-243`),
  then re-verifies each recipient against its live parent assignment before
  returning it to the client.

**Request/response shapes.** `LmsDeepLinkResolveRequest = { assignmentId }`.
`LmsDeepLinkResolveResponse = { assignmentId, classId, lessonSlug,
internalTarget: "assignmentLaunch" | "lessonPractice" | "informational",
attemptContext: "authorized" | "informational" }`
(`platform/functions/src/lms/deep-link-resolve.ts:69-77`). **The response
already carries `lessonSlug`** — this is the one place in the current
pipeline where "which lesson artifact" is explicitly communicated back to
the client as part of authorization, and it is presently a single scalar
resolved purely from the assignment record.

**Authorization checks, in the actual enforced order:** authenticated ->
active student -> assignment exists -> same-school (see district note) ->
not draft/archived -> active enrollment -> (for classroom-mode, open-window
assignments) canonical recipient membership via
`isCanonicalRecipient()` (`platform/functions/src/assignments/assignment-recipients.ts`,
consumed at `deep-link-resolve.ts:~290`) determines `authorized` vs.
`informational`.

**Informational vs. authorized outcomes.** Yes — `attemptContext` is exactly
this binary. `informational` covers: closed assignment, practice mode,
closed begin-window, or enrolled-but-not-a-recipient. This existing
authorized/informational split is a natural seam a differentiation feature
could reuse for expressing "you are enrolled, but nothing to show you yet"
without inventing a new outcome type — recorded as an observation, not a
recommendation.

**Where student-specific information is available during the pipeline.**
The resolver holds `actor.uid`, `actor.schoolId`, `actor.districtId` (from
`requireDistrictContext`) for its own duration but returns none of it to the
client. `assessmentSessionsBegin` (next stage) additionally has the
student's prior session/attempt history available via Firestore reads
scoped to that student. **No stage in the current pipeline reads
`users/{uid}.studentProfile`, an accommodation flag, a reading level, or any
other per-student instructional-configuration field** — none exists to
read (§11).

---

## 7. Assessment Sessions

**Collection/path.** `assessmentSessions/{sessionId}`.

**Session ID strategy.** Deterministic:
`{assignmentId}__{studentId}__{sessionOrdinal}`, where `sessionOrdinal` is
the one-based count of sessions this student has begun for this assignment,
including archived ones (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §12).

**Ownership fields, frozen at creation, never rewritten by autosave:**
`studentId, assignmentId, classId, teacherId, schoolId, districtId,
activityId, assessmentId, assessmentRevisionId, sessionOrdinal`
(`platform/functions/src/shared/types/assessment-session.ts:384-399`). Note:
sessions **do** carry `districtId` directly, unlike assignments and
enrollments (§14).

**Frozen lesson/activity/revision identifiers.** `activityId` (=
`lessonSlug`), `assessmentId`, `assessmentRevisionId` — all resolved once
at session creation from the parent assignment and never re-resolved, even
if the assignment's assessment is later revised.

**Responses/draft behavior.** `responses?: readonly {itemId, response:
unknown}[]` — the *only* mutable field set besides `lastActivityAt`, written
exclusively by `assessmentSessionsAutosave`
(`AssessmentSessionAutosaveWrite` type is intentionally narrow: it cannot
touch any ownership field, `status`, or `startedAt`). Sessions never carry a
score, correctness marker, or explanation.

**Lifecycle/status as actually implemented.** The type enum is `"live" |
"archived"`, but **only `"live"` is ever written by current production
code** — no callable that transitions a session to `"archived"` exists in
the repository today (§14). Contract-specified callables
`assessmentSessionsSweepExpired`, `assessmentSessionsPurgeArchived`,
`assessmentSessionsRecover`, `assessmentSessionsResume` are **not present**
in `platform/functions/src/assessments/`. Practically: sessions are created
and autosaved; there is currently no automatic expiry, archival, or
recovery running in production.

**Start/autosave/finalize relationship.** `assessmentSessionsBegin` (create
or return-existing-live) -> `assessmentSessionsAutosave` (repeated) ->
`assessmentAttemptsFinalize` (terminal: reads the session, writes an
`attempts` document, deletes the session in the same transaction per
contract; not independently re-verified line-by-line in this task but
consistent with the collection-ownership matrix in
`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §11 and the callable's presence at
`platform/functions/src/assessments/assessment-attempts-finalize.ts`).

**What happens after successful finalization.** The session document is
deleted; the only durable record is the new `attempts/{attemptId}`
document. There is no "submitted" session state observable by any reader.

**Behavior on a new attempt/reassessment.** A new `assessmentSessionsBegin`
call for the same `(studentId, assignmentId)` produces a new session with
the next `sessionOrdinal`, still resolving the **same frozen
`assessmentRevisionId`** the assignment was published with (not whatever is
newest) — see §4 and §8.

---

## 8. Attempts and Reassessment

**Collection/path.** `attempts/{attemptId}`, top-level.

**Attempt ID strategy.** Deterministic:
`{assignmentId}__{studentId}__a{attemptNumber}`, dense and never reused
(`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §12).

**Attempt number/ordinal behavior.** One-based, assigned by the scorer
inside the finalize transaction, computed from the count of existing
attempts for `(studentId, assignmentId)`.

**Assignment/student/class relationships and frozen identifiers**
(`platform/functions/src/shared/types/attempt.ts:289-307`,
`AssessmentAttemptRecord`):

```ts
{
  studentId, assignmentId, classId, teacherId, schoolId, districtId,
  activityId, assessmentId, assessmentRevisionId,
  attemptNumber: number,
  score: number, maxScore: number, percentage: number,
  responses: readonly {itemId, response}[],
  itemResults: readonly {itemId, isCorrect, pointsEarned, correctOptionId, explanation, studentResponse}[],
  idempotencyKey: string,
  submittedAt: Timestamp,
}
```

Every field above is written once by `assessmentAttemptsFinalize` and never
updated or deleted by any other callable (`ATTEMPTS_COLLECTION = "attempts"`
comment: "no callable ever updates or deletes a written document"). Firestore
Rules deny client `create`/`update`/`delete` on `attempts/*` outright
(`platform/firebase/firestore.rules:507-524`, not individually transcribed
here but confirmed present as its own match block, mirroring the
`submissions` denial pattern above it).

**Score/result fields relevant to historical integrity.** `score`,
`maxScore`, `percentage`, and per-item `itemResults` (including the
student's own response, the correct option, and the delivered explanation)
are frozen at write time and never recomputed against a later assessment
revision.

**Finalization path.** `assessmentAttemptsFinalize` — sole writer, verified
via `platform/functions/src/assessments/assessment-attempts-finalize.ts`
and its export at `platform/functions/src/assessments/index.ts`.

**Immutability expectations.** Absolute: rules deny every client mutation;
the canonical types comment states no callable updates or deletes a written
attempt. The only "correction" pattern contemplated anywhere in the certified
docs is an *adjacent* record, never an overwrite (`ASSESSMENT_PIPELINE_SPECIFICATION.md`
§17).

**Improve My Score / reassessment behavior.** A student may begin a new
session (`assessmentSessionsBegin`) for the same assignment at any time the
assignment is open (or in a closed-with-recipient-still-eligible informational
state per the resolver); there is no attempt cap enforced by default
(`ASSESSMENT_PIPELINE_SPECIFICATION.md` §11.4). Each submission produces an
**independent** new `attempts/{...__a{N}}` document; nothing is overwritten.

**How multiple attempts remain associated with one assignment.** Purely by
the shared `(assignmentId, studentId)` prefix in the deterministic attempt
ID and by the `assignmentId` field on every attempt — there is no pointer
chain from one attempt to the next (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
§13: "No attempt document references another attempt").

**Which artifact/version is used when reassessing.** The session (and thus
the resulting attempt) freezes `assessmentRevisionId` from the **assignment's
stamped revision at publish time**, not from whatever is current when the
student re-attempts (§4, §7). Every attempt on the same assignment — first
attempt or fifth — is scored against the identical revision, which is what
makes historical attempts reproducible/comparable within one assignment.

**What makes a historical attempt reproducible vs. non-reproducible.**
Reproducible: the exact `assessmentRevisionId`, `itemResults`, `responses`,
and `score` are frozen and immutable — replaying the stored data
reconstructs exactly what the student saw and answered. Non-reproducible:
the *lesson HTML* the student read before attempting is **not** versioned
or referenced by the attempt at all — only `activityId` (the slug) is
stored, not a lesson-content version. If lesson prose changes after a
student's attempt, the attempt record does not capture which wording the
student actually read. This is a pre-existing property of the current
architecture, unrelated to differentiation, but directly relevant to any
design that would show different students different lesson presentations
under the same `lessonSlug` and later need to explain "what did this
specific attempt's student actually see."

---

## 9. Completion, Results, and Teacher Reporting

**How completion is determined.** There is no separate "completion" flag.
"Submit = completion" (`CURRENT_PLATFORM_STATE.md` §9): a student is
"completed" for an assignment once at least one `attempts` document exists
for `(studentId, assignmentId)`. `notStarted` / `inProgress` /
`completed` categorization is computed live, not stored — see next point.

**How teacher surfaces determine complete vs. incomplete.**
`assessmentAssignmentSummary` (`platform/functions/src/assessments/assessment-assignment-summary.ts`)
computes this **on read**, by loading the frozen `recipients` population for
the assignment plus live queries against `assessmentSessions` and `attempts`
for that assignment, and classifying each recipient as
not-started/in-progress/completed. Response shape:

```ts
{
  assignmentId, classId,
  totalStudents, completedStudents, inProgressStudents, notStartedStudents,
  completionPercentage,
  averagePercentage: number | null, highestPercentage: number | null, lowestPercentage: number | null,
  perfectScoreStudents,
}
```

This is a **bounded aggregate projection**: no student identifier, no
per-student score, no response content crosses this boundary (comment:
"Every field is a bounded numeric aggregate; no student, attempt, session,
recipient, item-result, response, or answer-key value crosses the
boundary").

**Important divergence from the canonical contract:** `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
§11, §18, §20 specifies precomputed `attemptRollups/{assignmentId}__{studentId}`
and `assignmentRollups/{assignmentId}` documents, rewritten by an
`assessmentRollupsRecomputeAttempt` trigger, as the read model for both `My
Results` and teacher analytics. **Neither collection nor that trigger
exists anywhere in `platform/functions/src/`** (confirmed by repository-wide
search — zero matches for `attemptRollups`, `assignmentRollups`, or
`assessmentRollupsRecomputeAttempt`). Current production reporting is
computed **on demand** from `attempts` + `assessmentSessions` +
`recipients` by `assessmentAssignmentSummary` (teacher, per-assignment) and
`assessmentLessonSummary` (teacher, per-lesson-across-assignments,
`platform/functions/src/assessments/assessment-lesson-summary.ts`). Per-student
detail for a teacher is read through `assessmentAttemptGetForTeacher` /
`assessmentAttemptsListForClass`; a student's own history is read through
`assessmentAttemptsList` / `assessmentAttemptGet`. See §14.

**How scores/results are associated with assignments/students.** Directly:
every `attempts` document carries both `assignmentId` and `studentId`
(§8); every read-model callable filters on one or both.

**How multiple attempts affect displayed results.** `selectHighestCompletedAttempt`
(exported from `assessment-assignment-summary.ts`) is the representative-attempt
selector — the highest valid completed attempt, tie-broken by higher
`attemptNumber`, then later `completedAt`, then ascending `attemptId`, per
the Sprint 12E-A reconciliation notice in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
line 18. Growth/first/latest/highest are all derived by scanning the ordered
attempt set at read time, not from a stored "current" pointer.

**Does teacher reporting assume identical instructional content for every
student?** Yes, structurally. `assessmentAssignmentSummary` aggregates by
`assignmentId` alone; there is no dimension in its response, its input
population (`recipients`), or its underlying reads (`attempts`,
`assessmentSessions`) that varies by *which version of the lesson* a given
student saw. Every recipient of an assignment is currently assumed, by the
absence of any contrary field, to have been shown the same `lessonSlug` at
the same `assessmentRevisionId`.

**Is any student-specific presentation/version identifier already visible
in reporting?** No. Neither `recipients`, `assessmentSessions`,
`attempts`, nor either summary callable's response carries any field that
would distinguish "which presentation of the lesson this student received."

---

## 10. Google Classroom Integration Boundary

**How a LyfeLabz assignment maps to Google Classroom coursework.** One-way,
per-`(assignment, linked class)` publication via `lmsAssignmentPublish`
(callable name per contract; production entry point
`platform/functions/src/lms/assignments-publish.ts`), writing
`lmsAssignmentPublications/{assignmentId}__{lmsClassLinkId}__p{ordinal}` and
the assignment's optional `lmsPublicationRef` mirror pointer. Never
bidirectional; Classroom never authors a LyfeLabz assignment
(`GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` §11, §27).

**What identifier/deep link Google Classroom receives.** Exactly one URL,
`https://lyfelabz.com/app/a/{assignmentId}` — no query string, no fragment,
no lesson slug, no student/teacher/school/district identifier, no session
identifier, no score (§6, §8.1-§8.2 of the deep-link contract, and the
`FORBIDDEN_REQUEST_KEYS` refusal list confirms the resolver-side symmetry).

**Does Google Classroom know anything about the internal lesson version?**
No. The URL is opaque to Classroom; Classroom stores only the coursework
title/description/topic derived from the LyfeLabz assignment record at
publish time, plus the link material. `assessmentRevisionId`,
`lessonSlug`, and every other internal identifier are resolved entirely
server-side, after the student arrives.

**Do all students currently receive the same external link?** Yes — one
deep-link URL per `(assignment, class)` publication, shared by every
student in that Classroom course. There is no per-student link variant
(consistent with §5: one assignment = one class, and §6: the URL carries
only `assignmentId`).

**What LyfeLabz resolves after the student follows that link.** The full
pipeline in §6 — identity, district/school match, enrollment, recipient
membership, then routing.

**Where roster identity enters the authorization path.** At the enrollment
check (§6 step 6) and the recipient check (§6 step 7) — both are LyfeLabz-side
state, resolved independently of anything Classroom reports at click time.
The resolver is explicitly "Classroom-agnostic": it never reads a Classroom
OAuth grant or Classroom-side roster at resolution time
(`platform/functions/src/lms/deep-link-resolve.ts`, header comment).

**Score/grade fields relevant to future grade passback.** None exist today
and none are read/written by the publish path. Grade-back is explicitly
out of scope permanently (`LMS_INTEGRATION_ARCHITECTURE.md` §11.3, restated
in the deep-link contract §21, §27, and PDR-030e). If a differentiation
feature ever needed grade-passback fidelity, that fidelity does not exist
in the current LMS boundary to build on or break.

---

## 11. Existing Student-Specific Settings

Explicit search for: accommodations, student services, differentiation,
reading level, student profile, accessibility settings, individual
overrides, per-student instructional configuration.

**What exists:**

| Concept | State | Evidence |
| --- | --- | --- |
| "Student Services" settings tab | **UI-only inert placeholder.** No accommodation controls, no toggles, no persistence, no callable, no backend. | `app/src/shell/surfaces/settings.ts:378-399` — `renderStudentServicesPanel()`. Code comment: "Sprint 28.6H.5 (Part E, Task E1/E2): Student Services is a deliberate, inert placeholder for where student accommodations/supports will live... No persistence, no callable, no backend." Renders a single static sentence: "Student accommodations and supports will be managed here." |
| `users/{uid}.studentProfile` | **Schema field, typed as opaque, zero defined sub-fields, zero readers/writers.** | `platform/functions/src/shared/types/user.ts:22` — `export type StudentProfile = Record<string, unknown>;` with comment "Nested activation-scoped profile shapes are defined in later sprints." No code anywhere reads or writes into this field. |
| `users/{uid}.teacherProfile`, `.consentState` | Same pattern as `studentProfile` — opaque placeholders, unused. | Same file. |
| Reading level | **Not found anywhere** — no field, no UI, no doc concept. | Repository-wide search, no matches outside this task's own working notes. |
| Accessibility settings | Only the platform-wide a11y/mobile canonical stylesheet rules in `CLAUDE.md` (contrast, touch targets, breakpoints) — **not** a per-student concept. | `CLAUDE.md` "ACCESSIBILITY" section. |
| Per-student instructional configuration / individual overrides | **Not found.** No collection, field, or callable of any kind currently varies instructional content, presentation, or assessment difficulty by student. | Repository-wide search across `platform/`, `app/src/`, `docs/platform/`. |

**Distinguishing production vs. placeholder vs. concept-only:** Every hit
above is either (a) a UI placeholder that intentionally implies nothing is
functional, or (b) a typed-but-empty schema slot with no reader or writer.
**Nothing found constitutes a production implementation, a partially-wired
feature, or even a committed field shape for differentiation.** No TODO or
comment anywhere in the searched surfaces sketches a concrete
differentiation data model beyond the settings-panel placeholder text
itself.

---

## 12. Current System Invariants

Each invariant below is verified against current production code or rules,
not aspirational documentation. A differentiation design that violates one
of these breaks something that exists today, not something planned.

1. **One assignment authorizes exactly one class; a teacher assigning N
   classes produces N independent assignment documents, never a shared
   one.** Evidence: `ASSESSMENT_PIPELINE_SPECIFICATION.md` §12.1; structurally
   confirmed by `AssignmentRecord` carrying a single `classId`
   (`platform/functions/src/shared/types/assignment.ts`).
2. **`lessonSlug` is frozen on the assignment at creation and is the sole
   pointer to instructional content; it is never rewritten after
   publication except via the narrow, pre-publication
   `assignmentsUpdateDraft` path.** Evidence: field comments in
   `assignment.ts:39` ("`lessonSlug` is frozen at creation per §12.4").
3. **`assessmentRevisionId` is stamped exactly once, on first publish, and
   every session/attempt under that assignment scores against that exact
   revision regardless of when the student attempts.** Evidence:
   `assignment.ts:121-140`; `assessment-sessions-begin.ts:222-230`.
4. **A student may launch (begin a session) only while actively enrolled in
   the assignment's class and only if listed in the assignment's frozen
   `recipients` population (for classroom-mode, open-window
   assignments).** Evidence: `deep-link-resolve.ts` steps 6-7;
   `isCanonicalRecipient()` in `assignment-recipients.ts`.
5. **Attempts are immutable once written; no callable and no Firestore Rule
   permits update or delete.** Evidence: `attempt.ts` header comment; rules
   deny block for `attempts/{attemptId}` (`platform/firebase/firestore.rules`,
   mirroring the `submissions` denial pattern at lines 264-273).
6. **Assignment authorization (recipient/enrollment/window/status) is
   determined entirely server-side; the deep-link URL and the client both
   carry zero authority — `assignmentId` possession confers nothing on its
   own.** Evidence: `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`
   §8.4, §19; `FORBIDDEN_REQUEST_KEYS` refusal list in
   `deep-link-resolve.ts:90-99`.
7. **A student's canonical identity (`uid`) is permanent within a district
   and is shared across every class/enrollment the student holds; there is
   no per-class identity fork.** Evidence:
   `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §5, §18; one `users/{uid}`
   document, many `enrollments` documents referencing it.
8. **Enrollment is the sole join between a student and a class; there is no
   array-of-students on the class or array-of-classes on the user.**
   Evidence: `enrollmentIdFor(classId, studentId)` deterministic ID
   construction (`enrollments-join-by-code.ts:104-106`); absence of any such
   array field in `class.ts` / `user.ts`.
9. **Google Classroom never learns the internal lesson slug or assessment
   revision; the deep-link is opaque and Classroom-agnostic on resolution.**
   Evidence: `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` §8.2,
   §10.3; deep-link resolver header comment.
10. **Teacher-visible aggregates are bounded projections computed on read
    from `attempts`/`assessmentSessions`/`recipients`; no precomputed
    per-student rollup document currently exists to consult or extend.**
    Evidence: absence of `attemptRollups`/`assignmentRollups` in
    `platform/functions/src/`; `assessment-assignment-summary.ts` reads the
    three source collections directly.
11. **No field on any currently-implemented document (`users`, `classes`,
    `enrollments`, `assignments`, `recipients`, `assessmentSessions`,
    `attempts`) varies instructional content or presentation by student.**
    Evidence: §11 search; type definitions enumerated in §2-§8 above contain
    no such field.

---

## 13. Current Factual Uncertainties

QUESTION: Does `districtId` live as a stored field on `assignments` and
`enrollments`, or only as a derived/claim-level concept?
EVIDENCE FOUND: The canonical `AssignmentRecord` and `EnrollmentRecord`
types (`platform/functions/src/shared/types/assignment.ts`,
`.../enrollment.ts`) carry `schoolId` but **no `districtId` field**.
`assessmentSessions` and `attempts` **do** carry `districtId` directly
(`assessment-session.ts`, `attempt.ts`). The deep-link resolver's own code
comment states: "the AssignmentRecord carries schoolId, not districtId...
this is the canonical district check" and cites a "same-school invariant"
(PDR-025 §10) as the reason same-school is treated as equivalent to
same-district (`deep-link-resolve.ts:234-244`).
WHY CURRENT REPOSITORY DOES NOT RESOLVE IT: The canonical
`LYFELABZ_FIRESTORE_DATA_MODEL.md` Sprint 9C notice and
`DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (not independently
re-read in full for this task; referenced by multiple other contracts)
describe `districtId` as present more broadly. This task did not open the
district-boundary contract in full, so it cannot confirm whether the
same-school-implies-same-district proxy is documented there as the
permanent design or is itself an implementation shortcut awaiting
reconciliation. A differentiation feature that needs to reason about
"district" as a scope should verify this before assuming a stored
`districtId` exists on every record it touches.

QUESTION: Is the `attemptRollups` / `assignmentRollups` rollup architecture
(specified in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §11, §18, §20) a
future/never-built design, or was it built and later removed?
EVIDENCE FOUND: Zero references to `attemptRollups`, `assignmentRollups`, or
`assessmentRollupsRecomputeAttempt` anywhere in `platform/functions/src/`.
Teacher/student read surfaces are served entirely by on-demand aggregation
callables (`assessmentAssignmentSummary`, `assessmentLessonSummary`,
`assessmentAttemptsList`, `assessmentAttemptGetForTeacher`).
WHY CURRENT REPOSITORY DOES NOT RESOLVE IT: No sprint completion report
confirming or denying rollup construction was read in this task (out of
scope per the strict search boundary and the instruction not to treat old
sprint findings as current state). The most defensible reading of the
evidence is that the rollup design was never implemented and the platform
shipped an equivalent on-read aggregation instead, but this document cannot
confirm that from code alone.

QUESTION: Is the legacy `submissions/{submissionId}` collection and its
`submissionsCreate`/`submissionsFinalize` callables fully retired, or still
reachable in any deployed environment?
EVIDENCE FOUND: Both callables remain exported from
`platform/functions/src/index.ts:61` and the collection retains an active
(read-only) Firestore Rules block. A dedicated gate
(`platform/functions/src/shared/legacy-submissions-flag.ts`) makes the
legacy write path inert by default via the
`LYFELABZ_LEGACY_SUBMISSIONS_WRITES_ENABLED` environment variable, refusing
writes with `submissions.legacyWritesDisabled` unless an operator explicitly
opts in "during a data-migration reconciliation run."
WHY CURRENT REPOSITORY DOES NOT RESOLVE IT: Whether that environment
variable is currently set `true` in any deployed environment (production or
otherwise) is operational/deployment state, not something visible from the
repository's source tree.

QUESTION: Does a `lessons/{slug}` Firestore catalog collection (described in
`LYFELABZ_FIRESTORE_DATA_MODEL.md` §2.5/§3.5) actually exist and get read by
any current callable, or is the lesson catalog purely the repository's
static HTML files plus the `lessonSlug` string?
EVIDENCE FOUND: No file under `platform/functions/src/` references a
`lessons` collection, a `LESSONS_COLLECTION` constant, or any lesson-catalog
type. Every callable inspected in this task resolves lesson identity purely
through the `lessonSlug` string field on the assignment.
WHY CURRENT REPOSITORY DOES NOT RESOLVE IT: This task's search boundary
explicitly excluded reading lesson HTML/content and did not exhaustively
grep every functions-adjacent script (e.g. `platform/functions/src/scripts/`)
for a lesson-catalog writer. It is possible a catalog exists as a deployment
artifact outside the callable surface this task inspected.

QUESTION: Is session archival/expiry/recovery (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
§10, §6) actually running anywhere (e.g. as a Cloud Scheduler job configured
outside `platform/functions/src/`), or is it entirely unimplemented?
EVIDENCE FOUND: No `assessmentSessionsSweepExpired`,
`assessmentSessionsPurgeArchived`, or `assessmentSessionsRecover` callable
exists in `platform/functions/src/assessments/`. The `AssessmentSessionStatus`
type still enumerates `"archived"` as a value.
WHY CURRENT REPOSITORY DOES NOT RESOLVE IT: A scheduled function could in
principle be defined and deployed from infrastructure-as-code outside this
task's search boundary (`platform/functions/src/` was treated as
authoritative for Cloud Functions per `CURRENT_PLATFORM_STATE.md` §3's
routing table, but this task did not inspect Firebase deployment
configuration or `firebase.json` scheduler bindings).

---

## 14. Current System Invariants and Uncertainties Cross-Reference

(Intentionally folded into §12 and §13 above; this heading is a pointer for
navigation only and adds no new content — the numbered document structure
requested §12 "Current System Invariants" and §13 "Current Factual
Uncertainties" as the two governance sections, and both are complete above.)

---

## 15. High-Value File Map

| Concern | Canonical/current file(s) | Why it matters |
| --- | --- | --- |
| Platform orientation / routing | [CURRENT_PLATFORM_STATE.md](CURRENT_PLATFORM_STATE.md) | Start here for any future session; routes to every subsystem contract. |
| User/identity shape | [platform/functions/src/shared/types/user.ts](../../platform/functions/src/shared/types/user.ts) | Canonical `UserRecord`; shows the empty `studentProfile` placeholder. |
| Identity/onboarding rules | [IDENTITY_AND_ONBOARDING_SPECIFICATION.md](IDENTITY_AND_ONBOARDING_SPECIFICATION.md) | Canonical identity, verification, roster-authority contract. |
| Class shape | [platform/functions/src/shared/types/class.ts](../../platform/functions/src/shared/types/class.ts) | Canonical `ClassRecord`; roster authority, join-code invariant. |
| Enrollment shape + ID construction | [platform/functions/src/enrollments/enrollments-join-by-code.ts](../../platform/functions/src/enrollments/enrollments-join-by-code.ts), [.../shared/types/enrollment.ts](../../platform/functions/src/shared/types/enrollment.ts) | Deterministic `{classId}__{studentId}` ID; the (student, class) join. |
| Assignment shape | [platform/functions/src/shared/types/assignment.ts](../../platform/functions/src/shared/types/assignment.ts) | One-class-per-assignment; frozen `lessonSlug`/`assessmentRevisionId`. |
| Assignment recipients (existing per-student membership) | [platform/functions/src/shared/types/assignment-recipient.ts](../../platform/functions/src/shared/types/assignment-recipient.ts), [.../assignments/assignment-recipients.ts](../../platform/functions/src/assignments/assignment-recipients.ts) | The one existing per-student assignment record; frozen population source. |
| Student launch / deep-link resolver | [platform/functions/src/lms/deep-link-resolve.ts](../../platform/functions/src/lms/deep-link-resolve.ts) | Full authorization sequence; response shape carries `lessonSlug`. |
| Deep-link contract | [GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md](GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md) | Canonical URL shape, resolver rules, publication lifecycle. |
| My Assignments (student list) | [platform/functions/src/assignments/assignments-list-for-student.ts](../../platform/functions/src/assignments/assignments-list-for-student.ts) | Collection-group query over `recipients`; student-facing projection. |
| Session shape + creation | [platform/functions/src/shared/types/assessment-session.ts](../../platform/functions/src/shared/types/assessment-session.ts), [.../assessments/assessment-sessions-begin.ts](../../platform/functions/src/assessments/assessment-sessions-begin.ts) | Frozen ownership fields; `activityId = lessonSlug` resolution. |
| Attempt shape | [platform/functions/src/shared/types/attempt.ts](../../platform/functions/src/shared/types/attempt.ts) | Immutable record shape; what "reproducible history" actually stores. |
| Assessment pipeline contract | [ASSESSMENT_IMPLEMENTATION_CONTRACT.md](ASSESSMENT_IMPLEMENTATION_CONTRACT.md), [ASSESSMENT_PIPELINE_SPECIFICATION.md](ASSESSMENT_PIPELINE_SPECIFICATION.md) | Canonical rules; also the source of the rollup-vs-implementation gap. |
| Teacher/student reporting (actual read model) | [platform/functions/src/assessments/assessment-assignment-summary.ts](../../platform/functions/src/assessments/assessment-assignment-summary.ts), [.../assessment-lesson-summary.ts](../../platform/functions/src/assessments/assessment-lesson-summary.ts) | Real on-read aggregation; confirms no rollup collections exist. |
| Firestore Security Rules | [platform/firebase/firestore.rules](../../platform/firebase/firestore.rules) | Ground truth for every collection's actual access boundary (606 lines). |
| Security philosophy | [LYFELABZ_FIREBASE_SECURITY_MODEL.md](LYFELABZ_FIREBASE_SECURITY_MODEL.md) | Ownership model, ownership-immutability discipline, review checklist. |
| Existing "Student Services" placeholder | [app/src/shell/surfaces/settings.ts](../../app/src/shell/surfaces/settings.ts) (lines ~378-399) | The only UI surface referencing student accommodations today; confirmed inert. |
| LMS publication decision record | [PDR_030_LMS_ASSIGNMENT_PUBLICATION.md](PDR_030_LMS_ASSIGNMENT_PUBLICATION.md) | Confirms one-way, one-link-per-class publication; no grade passback. |
| Firestore data model (design doc) | [LYFELABZ_FIRESTORE_DATA_MODEL.md](LYFELABZ_FIRESTORE_DATA_MODEL.md) | Original collection design rationale; several sections superseded by later contracts (read the Sprint reconciliation notices at the top). |

---

**P1 is evidence gathering only. No persistent differentiation architecture
has been selected.**
