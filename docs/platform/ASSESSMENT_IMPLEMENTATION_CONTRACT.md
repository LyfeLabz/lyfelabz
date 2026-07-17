# Assessment Implementation Contract

**Status:** Canonical implementation contract. Ratified under Sprint 10A step F-2.
**Date:** 2026-07-12
**Anchor decision:** PDR-026 in `LYFELABZ_PLATFORM_DECISIONS.md`.
**Implements:** PDR-008 (as amended by Sprint 9A), PDR-021, PDR-024.
**Reconciles:** `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` Sprint 9A Reconciliation Notice, `LYFELABZ_FIRESTORE_DATA_MODEL.md` Sprint 9A Reconciliation Notice, `LYFELABZ_FIREBASE_SECURITY_MODEL.md` submission clauses, `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` (read forward under Submission -> Attempt).
**Governs:** Server-side implementation of the LyfeLabz formative assessment pipeline, including sessions, attempts, revisions, answer keys, callable ownership, Firestore collection ownership, index strategy, audit events, and error semantics.

This document is an engineer-facing implementation contract. It does not redesign product behavior, introduce new educational features, add teacher-visible surfaces, or amend the assessment philosophy established during Sprint 9. It translates the certified architecture into one normative rule set that a future implementation sprint MUST follow.

Where this contract and any earlier document conflict on implementation detail, this contract prevails. Where this contract and `ASSESSMENT_PIPELINE_SPECIFICATION.md` conflict on product behavior, the specification prevails and this contract MUST be reconciled.

---

## Sprint 12E-A Reconciliation Notice

PDR-029 (Assignment Summary and Recipient Population Policy) ratifies two policies that were previously inferred from §17, §18, and §20: (a) the representative attempt for every aggregate assignment metric is the student's highest valid completed attempt, with deterministic tie-breaking by higher `attemptNumber`, then later `completedAt`, then ascending `attemptId`; and (b) an assignment has a frozen recipient population captured at first publication in the canonical subcollection `assignments/{assignmentId}/recipients/{studentId}`. §17 is amended by pointer: the assignment recipient collection is the canonical population source for teacher analytics (§20) and for the student My Assignments surface. `assessmentSessionsBegin` and `assessmentAttemptsFinalize` MUST enforce recipient membership under PDR-029l. Rollup adoption under §18 and §20 MUST preserve the representative-attempt and frozen-population semantics without redefinition. No callable rename, no schema change, and no commit is authorized by this notice; the concrete writer for the recipient collection, the Rules extension, and the summary migration land in a superseding Sprint 12E implementation slice.

---

## 1. Purpose

The LyfeLabz certified corpus ratified the formative assessment pipeline as session-authoritative, server-scored, unlimited-attempt, and immutable (PDR-021). The rules that follow from that stance are distributed across `ASSESSMENT_PIPELINE_SPECIFICATION.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md`, `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md`, and `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`. This contract collapses those statements into one authoritative reference so engineers do not have to reconstruct the assessment implementation model from many partial statements.

This document is the single source of truth for:

- who owns each piece of assessment-relevant state
- how sessions are created, autosaved, resumed, expired, archived, and recovered
- how attempts are produced, stamped, made immutable, and read back
- how answer keys are held server-confidential and consumed only by the scorer
- how internal assessment revisions are established and stamped onto attempts
- how each callable Cloud Function partitions the assessment surface
- what Firestore collections own which pieces of assessment state
- what indexes the pipeline requires
- what audit events every assessment transition MUST emit
- what remains explicitly deferred to a later implementation sprint

## 2. Scope

This contract governs:

- Session state, autosave semantics, and session lifecycle for the formative assessment pipeline.
- Attempt production, immutability, and read semantics.
- Server-side answer-key ownership and the scorer's consumption of it.
- Internal assessment revision boundaries and their stamping onto attempts.
- Firestore collection ownership for `assessmentSessions`, `attempts`, `assessments`, `assessmentAnswerKeys`, `assessmentRevisions`, and the read model surfaces that support `My Results` and teacher analytics.
- Callable Cloud Function ownership for every operation on the assessment surface.
- Firestore Security Rules invariants for the collections above.
- Composite index requirements for the queries the pipeline actually issues.
- Audit event vocabulary for the assessment lifecycle.

It does not govern:

- The educational philosophy of formative assessment, which remains owned by `ASSESSMENT_PIPELINE_SPECIFICATION.md`.
- District-boundary enforcement, which remains owned by `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`. Every callable named here also complies with that contract; the district rules are not restated in full below.
- The pilot student and teacher experience shells (`My Assignments`, `My Results`, `Improve My Score`, teacher analytics screens), which remain owned by `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`. This contract records only the implementation ownership of the data those surfaces consume.
- The instructional lesson HTML, quiz UI, or Practice Mode surface, which continue to render entirely on the client and are outside the recorded pipeline.
- The future summative assessment pipeline, which will be governed by its own architecture document when it is designed.

## 3. Authority and Precedence

This contract implements the following canonical documents:

- `ASSESSMENT_PIPELINE_SPECIFICATION.md` (Sprint 9A, PDR-021).
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-008 as amended, PDR-010, PDR-013, PDR-017, PDR-021, PDR-024, PDR-025, PDR-026).
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (callable authority boundaries).
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` (canonical document shapes).
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md` (rule-layer enforcement).
- `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` (index strategy).
- `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` (rollup discipline, read forward under Submission -> Attempt).
- `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (district enforcement contract).
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` (pilot surfaces that consume this pipeline).
- `PLATFORM_STATE_MACHINE.md` (user status lifecycle).
- `PLATFORM_CONTRACTS.md` (client storage prohibitions).

Precedence rules:

1. Where this contract and `ASSESSMENT_PIPELINE_SPECIFICATION.md` conflict on product behavior, the specification prevails.
2. Where this contract and any older implementation document (charter, data model, security model, rollup strategy, index strategy) conflict on assessment implementation, this contract prevails and the older document MUST be reconciled with a narrow Sprint 10A F-2 notice.
3. Where this contract and `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` intersect, both apply. District enforcement is additive to the rules below; nothing in this contract widens the district boundary.
4. Where existing implementation code (`submissionsCreate`, `submissionsFinalize`, the current `submissions` collection) diverges from this contract, the code MUST be reconciled during the sprint that implements the attempt write path. This contract never treats older implementation code as authoritative.

## 4. Terminology

- **Attempt.** The authoritative, immutable record of one completed formative assessment by one student on one assignment. The canonical entity name for formative assessment history. Replaces the historical term "submission" for the formative pipeline.
- **Session.** The transient, autosaving, resumable working state a student holds while working on an assessment. A session is not an attempt and is never counted as evidence of learning.
- **Submission.** The transient state inside the server-side scoring transaction between a submit request and a written attempt. Never externally observable. Not a persisted entity.
- **Retake.** Reserved for the future summative pipeline. A retake is not an attempt. This contract does not define retake semantics.
- **Assessment.** The scorable artifact attached to an activity (lesson quiz, extension, investigation, simulation, engineering challenge). Every assessment has a canonical identifier and one or more internal revisions.
- **Activity.** The instructional artifact the assessment is attached to. Activities are identified by the stable slug already used by the repository (`lesson_g7_earths-layers`, `challenge_welcome-to-floatia`, and so on).
- **Assessment revision.** The internal, platform-owned version of an assessment's scorable content at a point in time. See §14.
- **Answer key.** The server-confidential record of correct answers, rubrics, points, and explanations for an assessment revision. Never delivered to a client before submission. See §15.
- **Scorer.** The Cloud Function that reads the server-confidential answer key, compares a session's responses to it, and produces the score, item-level correctness, points earned, and feedback payload written onto the attempt.
- **Assignment.** The per-class publication of an activity by a teacher. Governed by `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.6 and the one-assignment-per-class rule (`ASSESSMENT_PIPELINE_SPECIFICATION.md` §12.1). This contract does not redefine the assignment shape; it defines the assessment surface that reads it.
- **Window.** The interval between an assignment's open moment and close moment. Governs new-session authorization.
- **Grace period.** The one-hour interval after window close during which sessions live at the close moment MAY still submit. See `ASSESSMENT_PIPELINE_SPECIFICATION.md` §7.1.
- **My Results.** The student-facing read surface defined in `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` §6.3. Consumes this pipeline; owned by the pilot specification.
- **Improve My Score.** The student action that opens a new authorized session on an assessment the student has previously attempted. See `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` §6.3.
- **Idempotency marker.** A client-supplied stable string that identifies a single logical submit intent. The scorer deduplicates on this marker; retries are safe.
- **Claim-refresh signal.** The response flag a callable returns when it has written a claim or otherwise invalidated the caller's cached authorization state. Present here only for parity with `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §6; no callable in this contract writes a claim.

## 5. Assessment Lifecycle

An assessment moves through the following server-managed lifecycle. Teachers never observe or configure any of these states.

1. **Authored.** The Platform Administrator authors the assessment items, distractors, correct answers, explanations, rubrics, and standards alignment. Authoring is out of scope for this contract; the platform ingests the authored content through the deployment pipeline governed by `PLATFORM_OPERATIONS_SPECIFICATION.md`.
2. **Published.** Deployment writes an `assessments/{assessmentId}` record and a paired `assessmentRevisions/{revisionId}` record. The published state makes the assessment available to be referenced by an assignment. Publication of an assessment is distinct from the publication of an assignment; the assignment publication authorizes students to attempt the assessment.
3. **Revised.** A subsequent deployment MAY write a new `assessmentRevisions/{revisionId}` record. The prior revision remains readable so that historical attempts remain interpretable. The `assessments/{assessmentId}` record's `currentRevisionId` field is updated to the new revision. Assessments never lose revisions.
4. **Retired.** An assessment MAY be marked retired when it is no longer offered on new assignments. Historical attempts remain readable. Retirement does not delete revisions or answer keys.

No teacher-facing surface exposes any of these states.

## 6. Session Lifecycle

The session lifecycle is defined by `ASSESSMENT_PIPELINE_SPECIFICATION.md` §6. This contract records the implementation obligations.

A session document lives at `assessmentSessions/{sessionId}` under the identifier construction in §11. Its lifecycle is:

- **Live.** Autosaving, resumable, awaiting further student action.
- **Submitted (transient).** Only observable inside the server-side submission transaction. Never returned by any read.
- **Archived.** Terminal. Recoverable within the archival window (§10). Never counted as an attempt.

Transitions:

| From | To | Trigger | Callable |
| --- | --- | --- | --- |
| (none) | Live | Student begins an authorized assessment | `assessmentSessionsBegin` |
| Live | Live | Autosave update | `assessmentSessionsAutosave` |
| Live | Submitted (transient) | Student submits | `assessmentAttemptsFinalize` (transaction) |
| Submitted (transient) | (deleted) | Attempt written | `assessmentAttemptsFinalize` (transaction) |
| Submitted (transient) | Live | Scoring failure | `assessmentAttemptsFinalize` (transaction rollback) |
| Live | Archived | Inactivity expiration | `assessmentSessionsSweepExpired` (scheduled) |
| Live | Archived | Grace period lapsed | `assessmentSessionsSweepExpired` (scheduled) |
| Archived | Live | Administrative recovery | `assessmentSessionsRecover` (administrative) |
| Archived | (deleted) | Recovery window elapsed | `assessmentSessionsPurgeArchived` (scheduled) |

Invariants:

- Only one Live session MAY exist per `(studentId, activityId, classId, assignmentId)` tuple at a time. `assessmentSessionsBegin` MUST refuse to create a second Live session and MUST return the existing Live session's identifier.
- A session's `assignmentId`, `classId`, `activityId`, and `assessmentRevisionId` are frozen at session creation. `assessmentSessionsAutosave` MUST NOT mutate any of these fields.
- Autosave writes are throttled server-side; the throttle interval is an operational constant, not a teacher-facing configuration.
- No client-authoritative score, correctness marker, or explanation payload is ever accepted onto a session document. Sessions carry answers only.
- Session documents MUST NOT contain any excerpt of the answer key.

## 7. Attempt Lifecycle

An attempt document lives at `attempts/{attemptId}` under the identifier construction in §11. Its lifecycle is:

- **Finalized.** Terminal. Immutable. The only externally observable state.

Attempts never carry a `draft`, `in-progress`, `submitted`, or `pending` state on the readable collection. The transient `Submitted` state described in §6 lives only inside the scoring transaction and never becomes a persisted attempt state.

Creation invariants (enumerated in `ASSESSMENT_PIPELINE_SPECIFICATION.md` §8):

- The submitting caller MUST be an authenticated student.
- The caller MUST hold an active enrollment in the class named on the session.
- The assignment MUST be within its window, or the session MUST be within the grace period.
- The idempotency marker MUST be unique per intended submission and stable across retries.
- The scorer MUST have produced a score, item-level correctness, item-level points earned, and a feedback payload.

Post-creation invariants:

- The attempt document is immutable. No callable MAY update or delete a finalized attempt.
- The attempt document's `assessmentRevisionId` is the revision the student was scored against; it is not the assessment's `currentRevisionId` at read time.
- The attempt's `attemptNumber` is a one-based ordinal within `(studentId, assignmentId)`. It is assigned by the scorer in the transaction that writes the attempt.
- The attempt's `classId`, `teacherId`, `schoolId`, and `districtId` are the values at the moment of submission. They are never rewritten if the student later moves classes or districts.

## 8. Submission Lifecycle

Submission is the transient state inside `assessmentAttemptsFinalize`. It is not a persisted lifecycle state.

The submission transaction MUST, in order:

1. Read the session document under the caller's authenticated identity.
2. Verify the session is Live and owned by the caller.
3. Verify the assignment window (or grace period) still permits submission.
4. Verify the caller's enrollment in the class is still active.
5. Resolve the `assessmentRevisionId` recorded on the session.
6. Read the server-confidential answer key at `assessmentAnswerKeys/{revisionId}`.
7. Compute the score, item-level correctness, item-level points earned, and feedback payload.
8. Compute `attemptNumber` from the count of existing attempts for `(studentId, assignmentId)`.
9. Write the `attempts/{attemptId}` document.
10. Delete the session document.
11. Emit a `assessment.attemptFinalized` audit event.
12. Return the score, item-level correctness for items the student answered, correct answers for those items, and explanations for those items.

If any step fails:

- The transaction MUST NOT partially commit. The attempt MUST NOT be written unless the session was deleted in the same transaction.
- On idempotent retry with the same idempotency marker, the callable MUST return the existing attempt payload without writing a second attempt and without emitting a second audit event.
- On unrecoverable scoring failure (answer-key integrity, revision resolution failure), the session MUST remain Live and the caller MUST receive a distinguishable error identifier from §22.

## 9. Assessment Revision Lifecycle

Assessment revisions are platform-owned. Teachers never observe or configure them.

- A revision document lives at `assessmentRevisions/{revisionId}` where `{revisionId}` is a stable, monotonically ordered identifier generated by the deployment pipeline.
- Every published assessment MUST have at least one revision.
- The `assessments/{assessmentId}.currentRevisionId` field points to the latest published revision. It is server-written only.
- A new revision is created when the change to the assessment content would meaningfully affect scoring or student experience (`ASSESSMENT_PIPELINE_SPECIFICATION.md` §15). Editorial corrections that do not affect item meaning MUST NOT create a new revision.
- Every attempt records the revision identifier it was scored against. Revisions are never deleted while any attempt references them.
- A revision has a paired `assessmentAnswerKeys/{revisionId}` document that is never client-readable. The pairing is by identifier; the two documents are always deployed together.
- A revision MUST NOT be modified after publication. To correct a published revision, deploy a new revision.

## 10. Archived Session Lifecycle

Archived sessions are the retention layer that supports session recovery without permitting them to be counted as attempts.

- A session enters the Archived state when either (a) inactivity has exceeded the session expiration constant, or (b) the assignment window has closed and the grace period has elapsed without submission.
- Archived sessions are retained for the archival recovery window (§20). They are never counted as attempts, never returned by any teacher-facing metric, and never included in growth calculations.
- Recovery of an archived session MUST be performed by an administrative callable (`assessmentSessionsRecover`, §17). Recovery returns the session to Live. Recovery does not produce an attempt.
- After the archival recovery window elapses, `assessmentSessionsPurgeArchived` deletes the session under the platform's ordinary retention policy.

## 11. Firestore Collection Ownership

The following collections are canonical for the assessment pipeline. Each row lists the sole authorized writer, the read audience, and the immutability posture.

| Collection | Purpose | Written by | Readable by | Immutable after write |
| --- | --- | --- | --- | --- |
| `assessments/{assessmentId}` | Assessment metadata (title, activityId, currentRevisionId, retired flag) | Deployment pipeline (Platform Administrator authority) | Server; teacher preview (read-only) | Metadata updates permitted through the deployment pipeline only; individual fields not mutated by any callable |
| `assessmentRevisions/{revisionId}` | Scorable content shape (item stems, choices where applicable, ordering rule, item points) with no correct-answer material | Deployment pipeline | Server; scorer; teacher preview (read-only, without answer key) | Yes |
| `assessmentAnswerKeys/{revisionId}` | Correct answers, rubrics, per-item points, explanations, distractor rationales | Deployment pipeline | Scorer only | Yes |
| `assessmentSessions/{sessionId}` | Live and archived student working state | `assessmentSessionsBegin`, `assessmentSessionsAutosave`, `assessmentSessionsSweepExpired`, `assessmentSessionsRecover`, `assessmentSessionsPurgeArchived` | Owning student; server | No while Live; frozen when Archived |
| `attempts/{attemptId}` | Immutable authoritative attempt record | `assessmentAttemptsFinalize` only | Owning student; owning class teacher; server rollups | Yes |
| `attemptRollups/{assignmentId}__{studentId}` | Per-(student, assignment) read model that supports `My Results`, `Improve My Score`, and the five teacher metrics | Rollup Cloud Function triggered by `attempts` writes | Owning student; owning class teacher; server | Rewritten on every attempt; never client-writable |
| `assignmentRollups/{assignmentId}` | Per-assignment aggregate rollup that supports the teacher assignment view | Rollup Cloud Function triggered by `attempts` and `attemptRollups` writes | Owning class teacher; server | Rewritten on every attempt; never client-writable |
| `auditEvents/{eventId}` | Append-only audit sink (canonical collection in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8) | Server only | Server; Platform Administrator (audited surface) | Yes |

The existing `submissions/{submissionId}` collection is superseded by `attempts/{attemptId}`. The implementation sprint that lands the attempt write path MUST plan the data migration under §26 and MUST NOT run both collections in production simultaneously.

## 12. Canonical Document Identifiers

Identifier construction is deterministic so that uniqueness is enforced at the write boundary without a hot document or a transactional query, following the pattern established by `LYFELABZ_FIRESTORE_DATA_MODEL.md` §5.

| Document | Identifier | Notes |
| --- | --- | --- |
| `assessments/{assessmentId}` | Stable slug of the form `assessment_{activityId}` where `activityId` is the repository activity slug (e.g. `assessment_lesson_g7_earths-layers`) | One assessment per activity |
| `assessmentRevisions/{revisionId}` | `{assessmentId}__r{ordinal}` where `{ordinal}` is a monotonic integer starting at 1 | Ordinals are never reused |
| `assessmentAnswerKeys/{revisionId}` | Same as the paired `assessmentRevisions` document | Pairing is by identical identifier |
| `assessmentSessions/{sessionId}` | `{assignmentId}__{studentId}__{sessionOrdinal}` where `{sessionOrdinal}` is the one-based count of sessions this student has begun for this assignment (including archived ones) | New sessions after archival receive the next ordinal |
| `attempts/{attemptId}` | `{assignmentId}__{studentId}__a{attemptNumber}` where `{attemptNumber}` is the one-based ordinal produced by the scorer | Attempt numbers are dense per (student, assignment) and never reused |
| `attemptRollups/{rollupId}` | `{assignmentId}__{studentId}` | Deterministic per pair |
| `assignmentRollups/{rollupId}` | `{assignmentId}` | Deterministic per assignment |
| `auditEvents/{eventId}` | Server-generated random identifier | Follows `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8 |

Callables MUST refuse client-supplied identifiers that do not match the deterministic construction above and MUST refuse writes whose derived identifier collides with an existing document unless idempotency semantics apply.

## 13. Collection Relationships

The reference graph is one-directional and follows the rule "each attempt is a leaf; each session is a leaf; each rollup is derived."

- `attempts/{attemptId}` references `assignmentId`, `classId`, `teacherId`, `studentId`, `schoolId`, `districtId`, `activityId`, `assessmentId`, and `assessmentRevisionId`. All references are frozen at attempt creation.
- `assessmentSessions/{sessionId}` references the same set except that `attemptNumber` does not exist on sessions.
- `attemptRollups/{rollupId}` references `assignmentId`, `classId`, `teacherId`, `studentId`, `schoolId`, `districtId`. It is derived exclusively from the ordered set of attempts for its pair.
- `assignmentRollups/{rollupId}` references `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId` and is derived from the ordered set of attempts for the assignment.
- `assessmentRevisions/{revisionId}` references `assessmentId`. No revision references any student, class, or assignment.
- `assessmentAnswerKeys/{revisionId}` references its paired revision only. It carries no student, class, or assignment reference.
- `assessments/{assessmentId}` references `activityId` and `currentRevisionId`.

No attempt document references another attempt. Growth is derived from the ordered set of attempts by (studentId, assignmentId), not from a pointer chain.

## 14. Immutable versus Mutable Records

The following table is exhaustive for the collections owned by this contract.

| Field domain | Mutability |
| --- | --- |
| Attempt (`attempts/{attemptId}`) all fields | Immutable after write |
| Assessment revision (`assessmentRevisions/{revisionId}`) all fields | Immutable after write |
| Answer key (`assessmentAnswerKeys/{revisionId}`) all fields | Immutable after write |
| Session Live-state answers, timing markers | Mutable by autosave |
| Session Live-state ownership fields (`studentId`, `assignmentId`, `classId`, `activityId`, `assessmentRevisionId`) | Frozen at session creation |
| Session state (`Live` -> `Archived`) | Set by scheduled sweep or scorer rollback |
| Assessment (`assessments/{assessmentId}`) `currentRevisionId` | Server-written by the deployment pipeline |
| Assessment (`assessments/{assessmentId}`) `retiredAt` | Server-written by the deployment pipeline |
| `attemptRollups` and `assignmentRollups` | Rewritten atomically on every triggering attempt write |
| Audit events | Immutable after write; no update, no delete |

Teacher annotations, when they exist, live adjacent to the attempt and never mutate it. This contract does not implement teacher annotations; when introduced, they MUST be added as a distinct collection with its own callable ownership.

## 15. Answer Key Ownership

Answer keys are the load-bearing confidentiality boundary of the pipeline.

- Answer keys live at `assessmentAnswerKeys/{revisionId}` and nowhere else.
- Firestore Security Rules MUST refuse all client reads and all client writes on `assessmentAnswerKeys/*` for every role, including `platformAdministrator`. Administrative inspection MUST route through an audited callable, not a rule permission.
- Only `assessmentAttemptsFinalize` reads `assessmentAnswerKeys/*` at request time. No other callable in this contract reads the answer key.
- The scorer MUST NOT copy answer-key fields onto the attempt document verbatim except for the fields explicitly enumerated in the feedback payload (correct answer text, explanation text, per-item points for items the student answered). Rubrics, distractor rationales, and any authoring metadata MUST NOT leave the answer key.
- The scorer MUST NOT return the answer key over the callable response before submission. The response payload MUST contain the score, item-level correctness, correct answers for items the student answered, and per-item explanations, and MUST NOT contain any answer-key material for items the student did not answer.
- The client MUST NOT be presented with the answer key in any Firestore document, any callable response, any cached asset, any bundled JavaScript, or any URL parameter.
- A Practice Mode surface (anonymous, unauthenticated exploration) MAY compute local right/wrong feedback against a copy of the assessment items that does not include the answer key. Any such copy MUST be limited to the item stems and permitted metadata and MUST NOT include the answer key or per-item explanations. The Practice Mode surface produces no session, no attempt, and no audit event (`ASSESSMENT_PIPELINE_SPECIFICATION.md` §4).

## 16. Assessment Publication Relationship

Assessment publication is distinct from assignment publication.

- The Platform Administrator publishes an assessment (and any subsequent revision) through the deployment pipeline. Publication writes the `assessments/{assessmentId}`, `assessmentRevisions/{revisionId}`, and `assessmentAnswerKeys/{revisionId}` documents atomically at the deployment boundary.
- A teacher publishes an assignment through `assignmentsPublish`. The publication authorizes students to attempt the assessment for that class within the window.
- The assessment revision recorded on an attempt is the revision that was current at the moment of submission, not the revision that was current at the moment the assignment was published. A revision published mid-window applies to sessions that submit after the revision goes live, subject to the invariant in `ASSESSMENT_PIPELINE_SPECIFICATION.md` §15 that revisions are internal and never surface to teachers.
- An assessment that is retired remains available for scoring against existing sessions and remains queryable through historical attempts. A retired assessment MUST NOT be referenced by a new assignment; `assignmentsCreateDraft` MUST refuse to reference a retired assessment.

## 17. Assignment Relationship

The assignment is the authorization boundary for authoritative attempts. This contract does not redefine the assignment shape; it names the assignment fields the assessment pipeline reads.

- `assignments/{assignmentId}.classId`, `.teacherId`, `.schoolId`, `.districtId` (denormalized under `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §10), `.lessonSlug`, `.lessonVersion`, `.mode`, `.status`, `.availableAt`, `.windowClosesAt` are the fields the assessment pipeline reads.
- The `mode` field's `classroom` value authorizes attempt production. The `practice` value is not part of the attempt pipeline; a `practice`-mode assignment does not produce sessions or attempts and MUST be refused by `assessmentSessionsBegin`. This preserves the existing Practice Mode carve-out.
- The `status` field's `published` value authorizes new sessions. `closed` refuses new sessions but permits in-grace submissions. `draft` and `archived` refuse both.
- One assignment per class (`ASSESSMENT_PIPELINE_SPECIFICATION.md` §12.1). Fan-out to multiple classes produces multiple assignment records, one per class. This contract does not itself perform the fan-out; the assignment publication callable does.

## 18. Student Results Ownership

`My Results` is the pilot surface defined in `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` §6.3. This contract records only the implementation ownership of the data it reads.

- The student's `My Results` list is served by a query against `attemptRollups` filtered by `studentId` and ordered by `assignmentId`. It reads one document per attempted assignment.
- Each rollup document carries the fields the pilot surface renders: `bestScore`, `firstScore`, `latestScore`, `attemptCount`, `bestAttemptId`, `latestAttemptId`, `assessmentId`, `activityId`, and the `districtId`/`schoolId`/`classId`/`teacherId` at the time of the most recent attempt.
- The status indicators defined in `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` §6.3 are derived on the client from `bestScore` and the assessment's item count. The rollup does not carry an indicator field.
- `Improve My Score` invokes `assessmentSessionsBegin` for a new session under the same assignment. `assessmentSessionsBegin` refuses only if the assignment window is closed and no grace period applies, if the assignment is archived, or if the caller's enrollment is not active. There is no attempt cap by default.
- The `My Results` surface MUST NOT read the `attempts` collection directly for the list view. It reads the rollup. It MAY read a specific `attempts/{attemptId}` when the student opens a specific attempt for detail (the item-level correctness and explanations recorded at the moment of that attempt).

## 19. My Results Read Contract

- Query: `attemptRollups` where `studentId == currentUserId`, ordered by `assignmentId` ascending or by the rollup's `lastSubmittedAt` descending as the pilot surface prefers.
- Rate: Continuous within a session. Cached in application memory for the session; refreshed on `My Results` navigation.
- Index: `(studentId, lastSubmittedAt desc)` composite. See §23.
- Rules: The student MUST be authenticated, `status === "active"`, `role === "student"`, and `districtId` claim MUST match the rollup's `districtId`. See §21.
- Per-attempt read: Query `attempts` where `attemptId == selectedAttemptId`, then verify the returned document's `studentId` equals the caller's `uid`. Rules also enforce.

## 20. Teacher Analytics Ownership

The five teacher-visible metrics defined in `ASSESSMENT_PIPELINE_SPECIFICATION.md` §14 (Highest score, First score, Latest score, Attempt count, Growth) are served by `assignmentRollups` and by aggregated projections of `attemptRollups`.

- Per-student metrics for a teacher's assignment view are read from `attemptRollups` filtered by `assignmentId` and joined implicitly by `studentId`. No cross-collection join is required; the rollup already carries the fields the surface needs.
- Class-level aggregates (assignment average, participation rate) are read from `assignmentRollups`. The rollup is rewritten atomically by the rollup Cloud Function on every attempt write.
- No teacher-facing surface reads `attempts` in bulk. Individual attempt drill-down MAY read `attempts/{attemptId}` after the teacher has selected a specific student on a specific assignment.
- The teacher surface MUST NOT expose the internal `assessmentRevisionId`. It appears on `attempts` for historical fidelity but never on any teacher screen (`ASSESSMENT_PIPELINE_SPECIFICATION.md` §15).

Additional analytics MUST NOT be added to the teacher surface without a new PDR. The rollup shape MAY carry additional internal fields (for platform observability) provided they are not projected onto the teacher UI.

## 21. Cloud Function Ownership Matrix

Every callable that touches the assessment pipeline is listed here. Names are canonical for this contract. Where an older charter entry (e.g. `submissionsCreate`, `submissionsFinalize`) covers the same responsibility, the older name is superseded and reconciled to the name below under §26.

| Callable | Trigger | Owner responsibility | Idempotent? |
| --- | --- | --- | --- |
| `assessmentSessionsBegin` | Callable, student | Creates or resolves the caller's Live session for an authorized assignment. Refuses cross-district and unauthorized targets. Refuses practice-mode and non-published assignments. Refuses when a Live session already exists (returns existing). | Yes |
| `assessmentSessionsAutosave` | Callable, student | Persists in-progress answers and timing markers to the caller's Live session. Refuses cross-district and non-owner writes. Refuses to mutate frozen ownership fields. Throttled server-side. | Yes under identical payload |
| `assessmentSessionsResume` | Callable, student | Returns the caller's Live session if one exists for the (student, assignment). Never returns a session that does not belong to the caller. | Yes (read-only) |
| `assessmentAttemptsFinalize` | Callable, student | Runs the submission transaction described in §8. Sole writer of `attempts/{attemptId}`. Deletes the session on success. Emits `assessment.attemptFinalized`. | Yes under the client-supplied idempotency marker |
| `assessmentAttemptsGetForStudent` | Callable, student | Returns the caller's attempts for a specific assignment ordered by `attemptNumber`. Sole authorized read surface for the student attempt list where the direct Firestore read is not sufficient (e.g. cross-district revocation checks). | Yes (read-only) |
| `assessmentAttemptsGetForTeacher` | Callable, teacher | Returns attempts for an assignment the teacher owns, optionally filtered by student. Sole authorized read surface for teacher attempt drill-down. | Yes (read-only) |
| `assessmentSessionsSweepExpired` | Scheduled | Archives sessions whose last activity exceeds the session expiration constant and sessions whose grace period has elapsed. Never produces attempts. Emits `assessment.sessionArchived` per swept document. | Yes |
| `assessmentSessionsPurgeArchived` | Scheduled | Deletes archived sessions past the archival recovery window. Emits `assessment.sessionPurged` per purged document. | Yes |
| `assessmentSessionsRecover` | Administrative callable, `platformAdministrator` | Returns an archived session to Live under audited authority. Refuses recovery when the archival recovery window has elapsed. Emits `assessment.sessionRecovered`. | Yes |
| `assessmentRollupsRecomputeAttempt` | Firestore document event on `attempts/{attemptId}` create | Rewrites `attemptRollups/{assignmentId}__{studentId}` and `assignmentRollups/{assignmentId}`. Deterministic from the ordered set of attempts. | Yes |
| `assessmentAnswerKeysAdministrativeRead` | Administrative callable, `platformAdministrator` | Audited read of an answer key for content review. Not authorized for any other role. Emits `assessment.answerKeyRead`. | Yes (read-only) |

Ownership rules:

- No callable other than `assessmentAttemptsFinalize` writes to `attempts/*`.
- No callable other than `assessmentSessionsBegin`, `assessmentSessionsAutosave`, `assessmentSessionsSweepExpired`, `assessmentSessionsRecover`, `assessmentSessionsPurgeArchived`, and the transaction inside `assessmentAttemptsFinalize` writes to `assessmentSessions/*`.
- No callable other than the deployment pipeline writes to `assessments/*`, `assessmentRevisions/*`, or `assessmentAnswerKeys/*`.
- No callable other than `assessmentRollupsRecomputeAttempt` writes to `attemptRollups/*` or `assignmentRollups/*`.
- Every callable is single-purpose. A callable that appears to need two responsibilities is two callables.

Every callable additionally satisfies the district enforcement contract in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12.

## 22. Firestore Security Rules Contract

Firestore Security Rules MUST enforce the following invariants. Rule code is not written by this contract; the invariants are.

Rules MUST trust:

- The authenticated `request.auth.uid`.
- The signed claims `request.auth.token.role`, `request.auth.token.schoolId`, `request.auth.token.districtId`.
- The values already stored in the resource being read or written.

Rules MUST enforce, at a minimum:

- `assessmentSessions/{sessionId}`
  - Read: caller MUST equal the session's `studentId` and the caller's `districtId` claim MUST equal the session's `districtId`. No teacher role reads Live sessions.
  - Create: server only. Client `create` is refused. `assessmentSessionsBegin` writes under an admin credential.
  - Update: caller MUST equal the session's `studentId`. Updates MUST NOT change `studentId`, `assignmentId`, `classId`, `activityId`, `assessmentId`, `assessmentRevisionId`, `districtId`, `schoolId`, `teacherId`, `sessionOrdinal`, or `beganAt`. Field-diff enforcement is preferred over allow-listing so that a future field addition fails safe.
  - Delete: server only.
- `attempts/{attemptId}`
  - Read: caller is the owning student (matched by `studentId`) or the owning teacher (matched by `teacherId`), and the caller's `districtId` claim matches the attempt's `districtId`.
  - Create: server only.
  - Update: refused for every role.
  - Delete: refused for every role.
- `attemptRollups/{rollupId}`
  - Read: caller is the owning student or the owning teacher, and district matches.
  - Create, Update, Delete: server only.
- `assignmentRollups/{rollupId}`
  - Read: caller is the owning teacher and district matches.
  - Create, Update, Delete: server only.
- `assessments/{assessmentId}`
  - Read: any authenticated caller MAY read (title, activityId, currentRevisionId, retiredAt). Answer-key material is not present on this document.
  - Create, Update, Delete: refused for every role except the deployment path.
- `assessmentRevisions/{revisionId}`
  - Read: any authenticated caller MAY read the scorable content shape (item stems, permitted metadata). The document MUST NOT contain answer-key material; enforcement of the split lives in the deployment pipeline.
  - Create, Update, Delete: refused for every role except the deployment path.
- `assessmentAnswerKeys/{revisionId}`
  - Read: refused for every role, including `platformAdministrator`. Access is exclusively through `assessmentAnswerKeysAdministrativeRead` under audit.
  - Create, Update, Delete: refused for every role except the deployment path.
- `auditEvents/{eventId}`
  - Governed by `LYFELABZ_FIREBASE_SECURITY_MODEL.md`. No client write, no update, no delete.

Rules MUST default to deny. Any collection or field not covered by an explicit rule is inaccessible.

Rules MUST NOT trust any ownership value supplied in `request.resource.data` unless that same value is separately compared to the caller's claim or to a resolved server-side value.

## 23. Required Composite Indexes

The composite indexes named here MUST exist for the pipeline's queries. Names use the existing `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` §3.1 convention.

`assessmentSessions`

- `(studentId, assignmentId)` - serves the pre-write existence check in `assessmentSessionsBegin` and the resume query in `assessmentSessionsResume`.
- `(state, lastActivityAt asc)` - serves the sweep in `assessmentSessionsSweepExpired`.
- `(state, archivedAt asc)` - serves the purge in `assessmentSessionsPurgeArchived`.

`attempts`

- `(studentId, assignmentId, attemptNumber asc)` - serves `assessmentAttemptsGetForStudent` and the attempt-count computation inside `assessmentAttemptsFinalize`.
- `(assignmentId, submittedAt desc)` - serves `assessmentAttemptsGetForTeacher` and analytics reads.
- `(teacherId, submittedAt desc)` - serves the teacher's recent-attempts stream.
- `(classId, submittedAt desc)` - serves class-scoped audit queries.
- `(districtId, submittedAt desc)` - serves district-scoped administrative queries; reserved until first use.

`attemptRollups`

- `(studentId, lastSubmittedAt desc)` - serves `My Results`.
- `(assignmentId, bestScore desc)` - serves the teacher assignment view.

`assignmentRollups`

- `(teacherId, lastSubmittedAt desc)` - serves the teacher's recent-activity view.
- `(classId, lastSubmittedAt desc)` - serves the class view.

`assessmentRevisions`

- `(assessmentId, ordinal desc)` - serves the "current revision" resolution when only the assessment id is known.

`auditEvents`

- Reuses the indexes in `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` §3.1.7. No new index is introduced by this contract.

The implementation sprint MUST review the emulator's index emissions after every callable is landed and MUST reconcile the deployed index configuration to this contract.

## 24. Audit Event Requirements

All assessment-relevant transitions MUST emit an `auditEvents/{eventId}` document under the canonical shape in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8 (required fields: `actorUserId`, `actorRole`, `action`, `targetType`, `targetId`, `occurredAt`; conditionally required `schoolId`; where the event resolves to a district, `districtId` MUST also be recorded per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §16).

Required event vocabulary for the assessment pipeline:

| Transition | Canonical `action` | Actor | Target | Notes |
| --- | --- | --- | --- | --- |
| Session created | `assessment.sessionBegan` | `student` | `assessmentSessions/{sessionId}` | Records `assignmentId`, `assessmentId`, `assessmentRevisionId`, `sessionOrdinal` |
| Session autosaved | Not audited per event. `assessment.sessionAutosaveSampled` MAY be emitted at a bounded sample rate for observability; every autosave MUST NOT emit an event | n/a | n/a | Autosave is throttled but not audited event-by-event |
| Session resumed | Not audited. Resume is a read | n/a | n/a | n/a |
| Attempt finalized | `assessment.attemptFinalized` | `student` | `attempts/{attemptId}` | Records `assignmentId`, `assessmentId`, `assessmentRevisionId`, `attemptNumber`, `score` |
| Attempt finalization refused | Recorded as a denial payload on the same `assessment.attemptFinalized` audit event with `outcome: "refused"` and a reason code from §22, or omitted for pre-write validation failures | Caller | Attempted target | Do not create a new event name |
| Session archived by sweep | `assessment.sessionArchived` | `system` | `assessmentSessions/{sessionId}` | Records `reason: "expired"` or `reason: "graceElapsed"` |
| Session archived on rollback | `assessment.sessionArchived` | `system` | `assessmentSessions/{sessionId}` | Records `reason: "scorerRollback"` |
| Session purged | `assessment.sessionPurged` | `system` | `assessmentSessions/{sessionId}` | Records `assignmentId`, `studentId` |
| Session recovered | `assessment.sessionRecovered` | `platformAdministrator` | `assessmentSessions/{sessionId}` | Records the recovery reason payload |
| Answer key read | `assessment.answerKeyRead` | `platformAdministrator` | `assessmentAnswerKeys/{revisionId}` | Records the review reason payload |
| Rollup recomputed | Not audited per event. Rollup recomputation is a projection of already-audited attempt writes | n/a | n/a | Do not fabricate a second audit sink |

The `auditEvents` collection is append-only. No callable and no rule permits update or delete, including for `platformAdministrator`.

## 25. Error Contract

Callables MUST return stable error identifiers for assessment failures. The following identifiers are canonical. Where an identifier already exists in the certified architecture, that name is preserved.

- `unauthenticated`
- `account-inactive`
- `role-forbidden`
- `district-mismatch` (per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §17)
- `enrollment-inactive`
- `assignment-not-found`
- `assignment-not-published`
- `assignment-window-closed`
- `assignment-mode-invalid` (used when a `practice`-mode assignment is targeted for the recorded pipeline)
- `assessment-not-found`
- `assessment-retired`
- `assessment-revision-missing`
- `session-not-found`
- `session-not-owned`
- `session-not-live`
- `session-frozen-field-write`
- `session-already-live` (returned by `assessmentSessionsBegin` when a Live session exists; MUST accompany the existing session identifier so the client can resume)
- `attempt-idempotent-replay` (informational; the callable MUST return the existing attempt payload)
- `attempt-write-conflict`
- `answer-key-integrity`
- `scorer-unavailable`
- `rollup-inconsistent` (raised only when a rollup consistency check fails; MUST NOT be returned to student callers)

Callables MUST NOT leak the score of another student, another class's roster, or any answer-key material in any error payload.

## 26. Reconciliation with the Existing `submissions` Surface

The current implementation surface (`submissions/{submissionId}`, `submissionsCreate`, `submissionsFinalize`) predates the Sprint 9A specification and this contract. The implementation sprint that lands the attempt write path MUST address reconciliation as follows.

- The `submissions/{submissionId}` collection is superseded by `attempts/{attemptId}`. The rename is not cosmetic; the shape changes (§7, §11), the writer changes (`assessmentAttemptsFinalize` sole writer), the lifecycle changes (no `submitted` externally observable state), and the identifier construction changes (§12).
- The `submissionsCreate` and `submissionsFinalize` callables are superseded by `assessmentAttemptsFinalize`. The two-callable split is retired; the transaction described in §8 is a single callable.
- No production data migration is authorized under Sprint 10A F-2. This is a documentation-only step. The implementation sprint MUST plan the migration with these constraints:
  - No pre-existing `submissions` document is deleted until an equivalent `attempts` document has been written and verified.
  - The two collections MUST NOT be simultaneously writable in production; the implementation sprint stages the migration behind a deployment flag.
  - `attemptRollups` and `assignmentRollups` are rebuilt from the migrated `attempts` collection, not from the historical `submissions` collection.
  - The migration validation checklist mirrors the district migration checklist in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §20.

Sprint 10A F-2 does not perform, schedule, or begin the migration.

## 27. Required Firestore Rules Tests

The implementation sprint that lands the attempt write path MUST include a rules-test matrix. Required cases include, at a minimum:

- Student MAY read own session; MAY NOT read another student's session.
- Teacher MUST NOT read any session, including for a class the teacher owns.
- Session update by owner MUST succeed for answer fields; MUST fail for frozen ownership fields.
- Session update by non-owner MUST be refused.
- Student MAY read own attempt.
- Teacher MAY read attempts on assignments the teacher owns; MUST NOT read attempts on other teachers' assignments.
- Cross-district read of any collection MUST be refused for every role.
- Client `create`, `update`, or `delete` on `attempts/*` MUST be refused.
- Client `create` or `delete` on `assessmentSessions/*` MUST be refused. Only server writes create or delete sessions.
- Client read of `assessmentAnswerKeys/*` MUST be refused for every role, including `platformAdministrator`.
- Client write of `attemptRollups/*` and `assignmentRollups/*` MUST be refused.
- `auditEvents/*` remains append-only; no client write, no update, no delete.

The tests themselves are not written in Sprint 10A F-2.

## 28. Required Emulator Tests

The implementation sprint MUST also include emulator tests covering, at a minimum:

- `assessmentSessionsBegin` refuses a practice-mode target, a non-published target, a cross-district target, and an archived-assignment target; returns the existing Live session when one exists; is idempotent under replay.
- `assessmentSessionsAutosave` refuses non-owner writes, refuses frozen-field mutations, refuses to accept a `score` or `correctness` payload; is idempotent under identical payload.
- `assessmentSessionsResume` returns no session when none exists; returns the caller's session when one exists; refuses cross-district access.
- `assessmentAttemptsFinalize` writes exactly one attempt per idempotency marker; is idempotent under retry; refuses when the window is closed and the session was not live at close; permits submission within the grace period; increments `attemptNumber` by one; deletes the session on success; leaves the session Live on scoring failure; emits exactly one `assessment.attemptFinalized` event per successful attempt.
- `assessmentAttemptsGetForStudent` returns only the caller's own attempts.
- `assessmentAttemptsGetForTeacher` returns attempts only for assignments owned by the caller.
- `assessmentSessionsSweepExpired` archives exactly the sessions past the expiration constant; emits one `assessment.sessionArchived` per swept document; is safe to re-run.
- `assessmentSessionsPurgeArchived` deletes exactly the sessions past the archival recovery window; is safe to re-run.
- `assessmentSessionsRecover` refuses recovery past the archival window; emits `assessment.sessionRecovered`; is idempotent under an already-Live target.
- `assessmentRollupsRecomputeAttempt` is deterministic from the ordered set of attempts; is safe under out-of-order delivery; is safe under duplicate delivery; never mutates `attempts/*`.
- `assessmentAnswerKeysAdministrativeRead` refuses every role except `platformAdministrator`; emits `assessment.answerKeyRead`.

The tests themselves are not written in Sprint 10A F-2.

## 29. Implementation Checklist

The implementation sprint that lands the attempt write path MUST address:

1. Shared TypeScript types for the canonical shapes of `assessments`, `assessmentRevisions`, `assessmentAnswerKeys`, `assessmentSessions`, `attempts`, `attemptRollups`, and `assignmentRollups`.
2. A single scorer helper that reads `assessmentAnswerKeys/{revisionId}` and produces the score, item-level correctness, item-level points earned, and feedback payload. The helper MUST be the sole reader of the answer key at request time.
3. A single session helper that constructs deterministic session identifiers, enforces the one-Live-session invariant, and refuses frozen-field mutation.
4. Transaction boundaries that keep the session read, session delete, attempt write, and audit event write in a single atomic operation inside `assessmentAttemptsFinalize`.
5. Idempotency implementation: the scorer stores the idempotency marker on the attempt document; a retry that matches the stored marker returns the existing attempt payload without a second write.
6. Firestore Security Rules updated to enforce §22.
7. Composite indexes updated to include every index in §23.
8. Rollup Cloud Function that recomputes `attemptRollups` and `assignmentRollups` deterministically on `attempts` create.
9. Scheduled sweep and purge functions with idempotent semantics.
10. Emulator tests per §27 and §28.
11. Migration plan for the existing `submissions` collection per §26.
12. Deployment validation: staging environment MUST run the full rules-test matrix and the emulator suite before rules and callables are promoted to production.
13. Deployment pipeline integration for `assessments`, `assessmentRevisions`, and `assessmentAnswerKeys` that writes the three documents atomically at the deployment boundary and refuses to publish a revision without a paired answer key.
14. Observability: latency histograms per callable, error-rate dashboards per error identifier in §25, and an oncall runbook for `scorer-unavailable`.

## 30. Explicit Non-Goals

This contract does not introduce:

- A summative pipeline. Retake semantics remain reserved for a future architecture document.
- A teacher-editable answer key, per-class assessment fork, or teacher-authored assessment revision.
- A per-assignment attempt cap surface. The platform default remains uncapped.
- A live-session viewer for teachers.
- Teacher annotations on attempts. When introduced, they will be a distinct collection with its own callable ownership.
- A rubric-scored open-response item type. Extension is compatible with the attempt shape (§17 of the specification) but is not implemented here.
- A language-model scoring pathway. Extension is compatible but is not implemented here.
- A parent view. Not in scope.
- A grade-export surface. Not in scope.
- A Practice Mode server pathway. Practice Mode remains client-only and continues to produce no session, no attempt, and no audit event.
- A new user-facing state. All lifecycle states are internal.

Any of the above requires a new PDR that supersedes the relevant section of this contract.

## 31. Open Implementation Gaps

The following are the only implementation gaps that cannot be resolved from the certified architecture. Each is narrow and non-blocking under the safe defaults recorded above.

- **G-10A-4. Session autosave throttle constant.** The specification requires autosave to be durable and resilient without prescribing a specific throttle interval. Impact: the implementation sprint MUST pick a server-side throttle (recommended: coalesce autosave writes at a small number of seconds per session) and record it in the operational runbook. This contract does not require a specific number.
- **G-10A-5. Assessment revision authoring workflow.** The deployment pipeline owns revision writes, but the concrete authoring tooling (how the Platform Administrator produces a revision candidate and its paired answer key) is not specified by the certified corpus. Recommendation: introduce a `docs/platform/ASSESSMENT_AUTHORING_WORKFLOW.md` alongside the implementation sprint. This contract does not require it to exist for the attempt write path to be correct.
- **G-10A-6. Rollup consistency reconciliation.** `attemptRollups` and `assignmentRollups` are deterministic from `attempts`, but the certified architecture does not specify how the platform reconciles a rollup that has diverged (through, for example, a bug in the recompute function). Recommendation: the implementation sprint provides an administrative recompute callable that reads `attempts` in bounded batches and rewrites the rollup, guarded by `role === "platformAdministrator"` and an audit event. This contract does not require the callable to exist in the initial implementation.
- **G-10A-7. Cross-year retention discipline for archived sessions.** The archival recovery window is a configurable operational constant, but the specification does not fix its value. Recommendation: the implementation sprint sets an initial value in the runbook and records the value here as an amendment. This contract does not require a specific value.
- **G-10A-8. Assessment identifier construction for engineering challenges without a slug collision.** The identifier construction in §12 assumes every activity carries a distinct slug. The current repository uses distinct slugs (see `CLAUDE.md` file naming rule). If a future activity type introduces a slug collision, `assessmentId` disambiguation MUST be added; this contract defers that decision until a collision arises.

No blocking gap remains. Implementation of the attempt write path can proceed against this contract with the five narrow decisions above deferred to their appropriate future scope.

---

## 32. Sprint 11E Reconciliations

The following clarifications are recorded here so the contract matches the certified, deployed implementation. No new requirement is introduced; each item narrows or clarifies existing language against the canonical implementation pattern.

### 32.1 Audit event write ordering (reconciles §29.4)

§29.4 lists the audit event write alongside the session read, session delete, and attempt write inside the finalize transaction. The canonical implementation pattern across every callable in `platform/functions/src` emits the audit event as a best-effort post-commit write, immediately after the transaction resolves and only when the state transition itself committed. The reconciliation is:

- The state transition (attempt write plus session delete for `assessmentAttemptsFinalize`, and the equivalent commit for every other callable) is the authoritative source of truth. On commit, the transition is durable regardless of whether the audit event write subsequently succeeds.
- The audit event write is issued exactly once per successful commit and only on the success path. A commit followed by a transient audit-write failure yields a state transition without an audit event; the state transition is not rolled back. The audit sink is observability, not lifecycle.
- Idempotent replay paths (e.g. §8 attempt idempotency) emit no audit event, matching the "one event per successful transition" invariant.

This pattern is uniform across `src/assessments/**`, `src/assignments/**`, `src/classes/**`, `src/enrollments/**`, `src/submissions/**`, `src/lms/**`, `src/teachers/**`, `src/students/**`, and `src/schools/**`. The transaction-scoped alternative would require an additional Firestore write per operation inside every transaction; the certified architecture does not require it, and no callable currently implements it.

### 32.2 Attempt count in `assessmentAttemptsFinalize` (reconciles §8 and §29)

The finalize transaction derives the new `attemptNumber` from a transactional `.get(query)` that reads the existing attempts for the (studentId, assignmentId) pair and takes the snapshot size. This snapshot-count pattern is canonical for two reasons the certified architecture depends on:

- Deterministic ordinal semantics per §12: `attemptId = {assignmentId}__{studentId}__a{attemptNumber}`. The ordinal must be strictly monotonic across concurrent finalize attempts for the same (studentId, assignmentId) pair; a snapshot count over the transactional read set participates in Firestore's transactional contention detection so a concurrent attempt-write causes the transaction to retry with the fresh count. The deterministic attemptId then refuses a colliding derived id at the `assessmentAttempts.writeConflict` boundary.
- The certified `(studentId, assignmentId)` composite index (§23) already serves this query. No new index is required.

The Firebase Admin SDK's `AggregateQuery.count()` is available inside `runTransaction` (see `@google-cloud/firestore/build/src/transaction.d.ts`), but substituting it here would remove the document-level entries from the transactional read set that make the monotonic-ordinal guarantee free. Retaining the snapshot count keeps the read set and the ordinal derivation coupled. No code change is required.

### 32.3 Persisted response purity in `assessmentSessionsAutosave` (clarifies §6, §15)

Persisted session response records contain exactly `{ itemId, response }` per §6 and §15. The autosave request validator enforces this in two independent ways:

- The top-level element check refuses any key other than `itemId` and `response` (`assessmentSessions.invalidResponses`). A client that includes an extra field is rejected at the request boundary rather than having the field silently stripped.
- The normalized element written to Firestore is an explicit two-field projection (`{ itemId, response }`), so even if the top-level check were bypassed, the persisted shape carries only the two canonical fields.

The response value itself is validated recursively for JSON-serializable primitives, bounded depth, and the absence of scoring-artifact keys (`score`, `isCorrect`, `pointsEarned`, `explanation`, etc.). Attempt persistence copies the session `responses` unmodified inside the finalize transaction, so the same two-field shape carries through to `attempts/{attemptId}.responses`.

### 32.4 Session ordinal deferral (reconciles §12)

The current implementation writes `sessionOrdinal = 1` at `assessmentSessionsBegin` and does not increment across archival cycles. Multi-session ordinal semantics remain deferred to the archived-session lifecycle callables (`assessmentSessionsSweepExpired`, `assessmentSessionsRecover`), which are out of scope for the current pipeline and are named as reserved surfaces in §22. The deterministic session identifier construction in §12 remains authoritative once those callables ship. No behavior change is warranted in the current slice.

## 33. Sprint 13E Reconciliations (Assignment Close and Reopen Lifecycle)

The following clarifications narrow §17 (Assignment Relationship) against the certified Sprint 13D `assignmentsClose` and Sprint 13E `assignmentsReopen` implementations. No new pipeline requirement is introduced; §33 records the assignment-lifecycle semantics the assessment pipeline already depends on, in one place, so the assessment surface can rely on them without reconstructing behavior from the assignment domain.

The assessment pipeline is unchanged by §33. Session expiration (§6), grace-period (§17 and `ASSESSMENT_PIPELINE_SPECIFICATION.md` §7.1), autosave, attempt numbering (§8, §12), representative-attempt selection under PDR-029, and the frozen recipient population under PDR-029l all continue to apply verbatim.

### 33.1 Canonical assignment lifecycle transitions

The certified `assignments/{assignmentId}.status` field admits the enumeration named in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.6: `draft`, `published`, `closed`, `archived`. The lifecycle-mutating transitions authorized on the active teacher-facing surface are exactly:

| From | To | Callable | Audit action |
| --- | --- | --- | --- |
| `draft` | `published` | `assignmentsPublish` | `assignments.published` |
| `published` | `closed` | `assignmentsClose` | `assignments.closed` |
| `closed` | `published` | `assignmentsReopen` | `assignments.reopened` |
| `draft` / `published` / `closed` | `archived` | `assignmentsArchive` | `assignments.archived` |

Every other current-status / callable pairing is a disallowed transition and MUST be rejected with the canonical `assignments.invalidTransition` error identifier, verified against the implemented handlers (`platform/functions/src/assignments/assignments-close.ts`, `platform/functions/src/assignments/assignments-reopen.ts`). No partial write occurs on rejection and no lifecycle audit event is emitted on rejection.

### 33.2 Close semantics (reconciles §17)

`assignmentsClose` advances `assignments/{assignmentId}.status` from `published` to `closed` through the narrow `assignmentCloseDocRef(assignmentId).update({ status: "closed" })` typed write and modifies no other field. Closing means:

- no new student assessment session may begin against the assignment; `assessmentSessionsBegin` continues to refuse non-`published` targets per §17 and §21.
- no new attempt may be finalized after the grace period elapses; in-grace submission behavior at §17 and `ASSESSMENT_PIPELINE_SPECIFICATION.md` §7.1 is preserved verbatim.
- every existing `attempts/{attemptId}` document remains immutable and preserved per §7 and §14.
- every existing assignment summary and rollup remains readable per §18, §19, §20, and PDR-029.
- the frozen recipient set at `assignments/{assignmentId}/recipients/{studentId}` remains untouched per PDR-029l.
- the assignment remains teacher-discoverable through the Sprint 13C `assignmentsTeacherList` allowlist (`["published", "closed"]`).
- the assignment is neither archived nor deleted; `archived` remains a distinct terminal state reachable only through `assignmentsArchive`.

### 33.3 Reopen semantics (extends §17)

`assignmentsReopen` advances `assignments/{assignmentId}.status` from `closed` back to `published` through the narrow `assignmentReopenDocRef(assignmentId).update({ status: "published" })` typed write and modifies no other field. Reopening means:

- authorized frozen recipients (PDR-029l) MAY begin new assessment sessions again through `assessmentSessionsBegin` as soon as the record is `published`.
- authorized frozen recipients MAY resume an existing session only where the existing canonical session rules in §6 still permit resume; expired sessions do not become valid again merely because the assignment reopened.
- reopening does not reset the session expiration constant, does not extend an already-elapsed grace period, and does not mutate any prior `assessmentSessions/{sessionId}` record.
- reopening does not regenerate or replace the frozen recipient collection at `assignments/{assignmentId}/recipients/{studentId}`. The population captured at first publication remains authoritative; the roster is not re-evaluated against current class enrollment.
- every existing `attempts/{attemptId}` document remains immutable and preserved per §7 and §14. Attempt numbering under §8 and §12 continues from the current maximum; reopening does not restart or renumber attempts and does not reclassify the current representative attempt.
- every existing assignment summary and rollup remains readable and continues to include the historical attempts already recorded. New attempts finalized after reopening participate in aggregate recomputation under the existing representative-attempt policy (PDR-029) without erasing prior values.
- reopening does not create a new assignment record and does not alter `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, `lessonSlug`, `lessonVersion`, `mode`, or any LMS / Google Classroom linkage. No metadata edit is possible through this callable.
- reopening does not touch `assessmentSessions/*`, `attempts/*`, `attemptRollups/*`, `assignmentRollups/*`, `assessmentAnswerKeys/*`, or any Google Classroom coursework.

### 33.4 Authorization

`assignmentsClose` and `assignmentsReopen` MUST both satisfy the identical authorization gate implemented in `platform/functions/src/assignments/assignments-close.ts` and `platform/functions/src/assignments/assignments-reopen.ts`:

- Authenticated caller (`requireDistrictContext` resolves; every other case rejected with `unauthenticated`, `account-inactive`, `claim-stale`, or `district-mismatch` per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12).
- `context.role === "teacher"`; every other role (student, pending teacher, inactive teacher, platform administrator) is rejected with `role-forbidden` before any Firestore access.
- `existing.teacherId === context.uid` AND `existing.schoolId === context.schoolId` on the loaded assignment record; every other case is rejected with `assignments.forbidden`.
- District boundary is enforced through the server-derived `context.districtId` against the record's denormalized `schoolId`.

Client identity is never trusted. The request payload carries only `assignmentId`. Any client-supplied teacher, school, or district field is ignored; ownership fields are derived server-side from the loaded record and the resolved district context.

### 33.5 Idempotency

`assignmentsClose` against an already-`closed` record returns `{ status: "closed", alreadyClosed: true }` with no second write, no second state transition, and no second audit event.

`assignmentsReopen` against an already-`published` record returns `{ status: "published", alreadyPublished: true }` with no second write, no second state transition, and no second audit event.

Each side of the idempotent path emits an informational observability log (`assignments.closeIdempotent`, `assignments.reopenIdempotent`) but never an audit event.

### 33.6 Invalid transitions

`assignmentsClose` rejects every current status other than `published` (and the idempotent `closed`) with `assignments.invalidTransition`. In particular, `draft` cannot be closed through this callable and `archived` cannot be closed through this callable; archival is served by `assignmentsArchive`.

`assignmentsReopen` rejects every current status other than `closed` (and the idempotent `published`) with `assignments.invalidTransition`. In particular, `draft` cannot be reopened and `archived` cannot be reopened; the terminal `archived` state is not recoverable through the active lifecycle callable set.

Rejected transitions fail closed: no partial write, no lifecycle audit event, and no side effect on recipients, sessions, attempts, summaries, rollups, or LMS integration.

### 33.7 Recipient behavior

The frozen recipient collection at `assignments/{assignmentId}/recipients/{studentId}` remains the sole authorized population source under PDR-029l for both `assessmentSessionsBegin` membership enforcement and the teacher-facing assignment summary surface. Neither `assignmentsClose` nor `assignmentsReopen`:

- adds a recipient,
- removes a recipient,
- regenerates the recipient collection,
- replaces the recipient collection with current class enrollment, or
- re-evaluates the roster against enrollment changes since first publication.

Any future recipient mutation continues to use the separately certified recipient-management path and is out of scope for the lifecycle callables named here.

### 33.8 Assessment session behavior

While `closed`:

- `assessmentSessionsBegin` MUST refuse new session creation against a non-`published` assignment per §17 and §21.
- new attempt finalization MUST be refused once the grace period at `ASSESSMENT_PIPELINE_SPECIFICATION.md` §7.1 has elapsed; in-grace finalization for sessions live at close remains authorized until grace elapses.
- existing stored session state (Live and Archived) remains preserved and is not mutated by the close write.

After reopening:

- eligible frozen recipients MAY begin new sessions through `assessmentSessionsBegin` as soon as the record is `published`.
- eligible frozen recipients MAY resume an existing Live session only if the canonical session rules in §6 still permit resume; the 24-hour session-inactivity expiration constant is not reset by reopening.
- an Archived session is not returned to Live merely because the assignment reopened; recovery of an archived session remains the sole responsibility of `assessmentSessionsRecover` under audited authority per §21.
- reopening does not extend an already-elapsed grace period and does not mutate any prior session record.

### 33.9 Attempt and submission behavior

Reopening does not restart attempt numbering, does not erase prior scores, and does not replace the representative-attempt selection recorded on `attemptRollups/{assignmentId}__{studentId}` or `assignmentRollups/{assignmentId}` per §8, §12, and PDR-029. New attempts finalized after reopening receive the next `attemptNumber` derived by the certified snapshot-count pattern in §32.2 and participate in representative-attempt selection under the same policy. No prior attempt is relabeled or reclassified.

### 33.10 Summary behavior

Assignment summaries remain readable while `closed` and remain readable after reopening. Reopening does not clear or reset aggregate counts on `attemptRollups/*` or `assignmentRollups/*`. New attempts recorded after reopening may change aggregate results under the existing rollup recomputation trigger (`assessmentRollupsRecomputeAttempt`, §21). Historical recipients with no new attempt continue to be represented under the frozen-recipient summary contract at PDR-029l without alteration.

### 33.11 Audit contract

The canonical audit vocabulary for the assignment lifecycle callables is:

| Callable | Successful transition | Idempotent no-op |
| --- | --- | --- |
| `assignmentsClose` | Exactly one `assignments.closed` event | No event |
| `assignmentsReopen` | Exactly one `assignments.reopened` event | No event |

Each successful lifecycle write emits its audit event exactly once via `writeAuditEvent`, carrying `actorUserId`, `actorRole: "teacher"`, `targetType: "assignment"`, `targetId: assignmentId`, `schoolId`, `districtId`, and a `{ classId }` payload. Failed or unauthorized requests write no lifecycle audit event unless an existing security-audit policy separately requires one. The `assignments.reopened` value is a canonical member of the `AuditAction` union alongside `assignments.published`, `assignments.closed`, and `assignments.archived`; no additional lifecycle audit action is introduced by Sprint 13E.

### 33.12 Relationship between close and reopen

`assignmentsClose` and `assignmentsReopen` are inverse lifecycle callables on the same field with symmetric authorization, symmetric idempotency, symmetric audit vocabulary, and symmetric write narrowness. Neither callable is a metadata-edit path; ownership, class, lesson, revision, and LMS references are frozen across both transitions. The pair together defines the complete `published` <-> `closed` bidirectional segment of the assignment lifecycle. Movement into or out of `draft` remains owned by `assignmentsPublish`, and terminal `archived` remains owned by `assignmentsArchive`.

## 34. Sprint 13F Reconciliations (Teacher Draft Discoverability)

The following clarification narrows §17 and §21 against the certified Sprint 13F extension of `assignmentsTeacherList`. No new pipeline behavior is introduced; §34 records the confidentiality and lifecycle invariants the assessment surface already depends on, in one place, so that teacher-facing draft discovery cannot silently create student-visible state.

### 34.1 Draft discovery is teacher-visible only

The optional `includeDrafts: true` request field on `assignmentsTeacherList` widens the returned status filter to include `draft` records owned by the authenticated teacher in the caller's own school. No student surface consumes this callable, and no student-role code path is authorized to invoke it. A draft assignment MUST NOT become student-visible through any surface until publication (`assignmentsPublish`) occurs.

### 34.2 Draft discovery creates no recipient, session, attempt, or summary state

Enumerating draft assignments through `assignmentsTeacherList`:

- creates no `assignments/{assignmentId}/recipients/{studentId}` document; the frozen-recipient collection under PDR-029l is authored only at first publication.
- creates no `assessmentSessions/*` document; `assessmentSessionsBegin` continues to refuse non-`published` targets per §17 and §21.
- creates no `attempts/*` document and never triggers `assessmentRollupsRecomputeAttempt`.
- creates no `attemptRollups/*` or `assignmentRollups/*` document; the aggregate-only summary surface (§18, §19, §20, PDR-029) remains unchanged for a draft.
- emits no lifecycle audit event; the callable remains a read-only enumeration under the Sprint 13C audit-vocabulary boundary and emits only its aggregate observability log line.

### 34.3 Draft discovery does not affect summaries

The Sprint 13A `assessmentAssignmentSummary` callable continues to refuse non-`published`/non-`closed` targets in its own certified boundary. A teacher client that renders `assignments/{assignmentId}` in a `draft` state MUST NOT compose the Sprint 13A summary surface against that assignment; the teacher client for a draft renders a calm informational panel in place of the summary card so no student-population read is attempted against a draft record.

### 34.4 Publication remains the transition that exposes an assignment to students

The certified §33.1 transition table is unchanged. `assignmentsPublish` continues to be the sole lifecycle-mutating callable authorized to advance an assignment from `draft` to `published`. Draft discoverability is a teacher-facing read affordance and MUST NOT be interpreted as a lifecycle transition, a publish substitute, or a mechanism for exposing an assignment to any student surface. Movement into `archived` remains owned by `assignmentsArchive`; the terminal state is not reachable through Sprint 13F draft discovery.

## Change Log

- 2026-07-12 - Initial issuance under Sprint 10A step F-2. Ratified by PDR-026.
- 2026-07-16 - Sprint 11E reconciliation. Added §32 recording audit-write ordering, attempt-count derivation, response-purity guarantees, and session-ordinal deferral against the certified implementation. No behavioral requirement is added; §32 clarifies existing sections against the deployed pattern.
- 2026-07-17 - Sprint 13E reconciliation. Added §33 recording the canonical assignment close and reopen lifecycle semantics against the certified Sprint 13D `assignmentsClose` and Sprint 13E `assignmentsReopen` implementations. No pipeline behavior is added; §33 narrows §17 by naming the transitions, authorization gate, idempotency, invalid-transition rejection, frozen-recipient preservation, session/attempt/summary preservation, and audit vocabulary the assessment surface relies on.
- 2026-07-17 - Sprint 13F reconciliation. Added §34 recording that the Sprint 13F extension of `assignmentsTeacherList` with `includeDrafts` is teacher-visible only, creates no recipient/session/attempt/summary state, never affects summaries, and does not replace `assignmentsPublish` as the transition that exposes an assignment to students. No pipeline behavior is added; §34 narrows §17 and §21 against the certified Sprint 13F implementation.
