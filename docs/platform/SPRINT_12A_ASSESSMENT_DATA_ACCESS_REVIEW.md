# Sprint 12A: Assessment Data Access Review

**Status:** Approved blueprint for Sprint 12B (Firestore Rules)
**Date:** 2026-07-16
**Anchor decisions:** PDR-025 (District Security Boundary), PDR-026 (Assessment Implementation Contract).
**Anchor contracts:** `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `docs/platform/ASSESSMENT_SCORING_CONTRACT.md`, `docs/platform/ASSESSMENT_PIPELINE_SPECIFICATION.md`, `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`, `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md`, `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`.
**Sprint category:** Documentation only. No code, Rules, tests, or configuration changed.

## 1. Executive Summary

Sprint 12A is a documentation and architecture verification pass over the Sprint 11 assessment implementation. It produces a code-grounded access control matrix that Sprint 12B can translate directly into Firestore Rules and Rules tests.

Findings:

- The assessment data topology is stable. Five canonical assessment collections (`assessments`, `assessmentRevisions`, `assessmentAnswerKeys`, `assessmentSessions`, `attempts`) are implemented and certified. Two additional collections named by the Implementation Contract (`attemptRollups`, `assignmentRollups`) are documented but not implemented and are correctly outside the Sprint 12B scope.
- Every assessment write path is a callable that runs under Admin SDK authority and bypasses Rules. No client write path exists for any assessment collection.
- The current `platform/firebase/firestore.rules` file contains no `match` block for any of the five assessment collections. All assessment reads and writes therefore fall through to the terminal deny rule. This is safe (nothing can be read or written by clients) but functionally incomplete (students and teachers cannot render their own results).
- Answer-key confidentiality is fully enforced today by the terminal deny rule. Sprint 12B MUST preserve that deny for every role including `platformAdministrator`.
- Assessment attempt immutability is fully enforced today: no client write path exists and the terminal deny denies every client update or delete. Sprint 12B MUST preserve immutability by refusing update and delete on `attempts/*` for every role.
- A small number of naming inconsistencies exist between the Implementation Contract and the shipped implementation (`state` vs `status`, `beganAt` vs `startedAt`). These are recorded as documentation gaps for Sprint 12B to reconcile inside the Rules text so that Rules names match implemented fields.

No architectural contradiction was found. No unresolved security decision blocks Sprint 12B.

Certification: **CERTIFIED: Sprint 12B may proceed.**

## 2. Scope and Sources Reviewed

### Implementation files reviewed

- `platform/functions/src/index.ts`
- `platform/functions/src/assessments/assessment-deployment.ts`
- `platform/functions/src/assessments/assessment-sessions-begin.ts`
- `platform/functions/src/assessments/assessment-sessions-autosave.ts`
- `platform/functions/src/assessments/assessment-attempts-finalize.ts`
- `platform/functions/src/shared/types/assessment.ts`
- `platform/functions/src/shared/types/assessment-session.ts`
- `platform/functions/src/shared/types/attempt.ts`
- `platform/functions/src/shared/types/assignment.ts`
- `platform/functions/src/shared/types/enrollment.ts`
- `platform/functions/src/shared/types/class.ts`
- `platform/functions/src/shared/types/user.ts`
- `platform/functions/src/shared/types/audit-event.ts`
- `platform/functions/src/shared/types/submission.ts`
- `platform/functions/src/shared/firestore/typed-ref.ts`
- `platform/functions/src/shared/auth/require-district-context.ts`

### Rules files reviewed

- `platform/firebase/firestore.rules`
- `platform/firebase/firestore.indexes.json`

### Rules tests reviewed

- `platform/firebase/tests/assignments.rules.test.ts`
- `platform/firebase/tests/audit-events.rules.test.ts`
- `platform/firebase/tests/classes.rules.test.ts`
- `platform/firebase/tests/default-deny.rules.test.ts`
- `platform/firebase/tests/enrollments.rules.test.ts`
- `platform/firebase/tests/lms.rules.test.ts`
- `platform/firebase/tests/schools.rules.test.ts`
- `platform/firebase/tests/submissions.rules.test.ts`
- `platform/firebase/tests/users.rules.test.ts`

There are no existing `assessments`, `assessmentRevisions`, `assessmentAnswerKeys`, `assessmentSessions`, or `attempts` Rules tests. Sprint 12C must add them.

### Contracts and architecture documents reviewed

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/ASSESSMENT_SCORING_CONTRACT.md`
- `docs/platform/ASSESSMENT_PIPELINE_SPECIFICATION.md`
- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md`
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md`
- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` (PDR-025, PDR-026)
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/PLATFORM_STATE_MACHINE.md`
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md`

### Completion and certification reports reviewed

- `docs/platform/SPRINT_11A_IMPLEMENTATION_INVENTORY.md`
- `docs/platform/SPRINT_11B_SLICE1_COMPLETION_REPORT.md` through `SPRINT_11B_SLICE4_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_11C_SLICE1_COMPLETION_REPORT.md` through `SPRINT_11C_SLICE4_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_11C_REMEDIATION_SLICE1_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_11D_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_11E_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`

## 3. Assessment Data Topology

### 3.1 `assessments/{assessmentId}`

- **Path:** `assessments/{assessmentId}` where `assessmentId = "assessment_" + activityId` per `assessment-deployment.ts:96-98`.
- **Purpose:** Assessment metadata pointer to the current revision.
- **Creator:** `deployAssessmentRevision` (deployment pipeline).
- **Mutation owner:** `deployAssessmentRevision` (advances `currentRevisionId` via a merged set on republication per `assessment-deployment.ts:476-479`).
- **District scope:** None. The assessment content surface is district-neutral, in accordance with `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §11 (deployment pipeline is Platform Administrator authority).
- **School scope:** None.
- **Class scope:** None.
- **Assignment scope:** None. Assignments carry `lessonSlug` and `lessonVersion`, from which the session derives the `assessmentId` and `assessmentRevisionId` per `assessment-sessions-begin.ts:200-210`.
- **Student ownership:** None.
- **Teacher ownership:** None (deployment pipeline authority only).
- **Lifecycle:** Created on first publication; `currentRevisionId` advances monotonically on subsequent revision publications; `retiredAt` may be stamped in a future slice.
- **Mutable or immutable:** `currentRevisionId` is mutable through the deployment pipeline only; per-callable mutation is refused.
- **Sensitive fields:** None. This document carries no answer-key material and no student data.
- **Authoritative fields:** `assessmentId`, `activityId`, `currentRevisionId`, `retiredAt?`.
- **References:** `activityId` (repository lesson slug); `currentRevisionId` (points into `assessmentRevisions/{revisionId}`).

### 3.2 `assessmentRevisions/{revisionId}`

- **Path:** `assessmentRevisions/{revisionId}` where `revisionId = "${assessmentId}__r${revisionOrdinal}"` per `assessment-deployment.ts:100-105`.
- **Purpose:** Scorable content shape (items, options, ordering rule, points) with no correct-answer material.
- **Creator:** `deployAssessmentRevision` via `tx.create(...)`.
- **Mutation owner:** None. The document is immutable after write per `ASSESSMENT_SCORING_CONTRACT.md` §6.
- **District scope:** None.
- **School, class, assignment, student, teacher scope:** None.
- **Lifecycle:** Created once, never mutated.
- **Mutable or immutable:** Immutable.
- **Sensitive fields:** None. Correct-answer material is intentionally absent per `ASSESSMENT_SCORING_CONTRACT.md` §4 and the split enforced in `assessment-deployment.ts:322-343`.
- **Authoritative fields:** `assessmentId`, `revisionOrdinal`, `activityId`, `itemOrderingRule`, `items[]` (each with `itemId`, `itemType`, `stem`, `options[]`, `points`), `publishedAt`, `publishedBy`, `schemaVersion`.
- **References:** `assessmentId` (parent); pairs by identical `revisionId` with `assessmentAnswerKeys/{revisionId}`.

### 3.3 `assessmentAnswerKeys/{revisionId}`

- **Path:** `assessmentAnswerKeys/{revisionId}` (same identifier as the paired revision).
- **Purpose:** Correct-answer material and per-item explanations. Server-confidential.
- **Creator:** `deployAssessmentRevision` via `tx.create(...)`.
- **Mutation owner:** None. Immutable after write.
- **District, school, class, assignment, student, teacher scope:** None.
- **Lifecycle:** Created once, never mutated.
- **Mutable or immutable:** Immutable.
- **Sensitive fields:** Every field is sensitive. `items[*].correctOptionId` and `items[*].explanation` are correct-answer material. Per PDR-026d and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22, the document is not client-readable by any role including `platformAdministrator`.
- **Authoritative fields:** `assessmentId`, `revisionOrdinal`, `items[]` (each with `itemId`, `correctOptionId`, `points`, `explanation`), `publishedAt`, `publishedBy`, `schemaVersion`.
- **References:** Pairs to `assessmentRevisions/{revisionId}` by identical identifier.

### 3.4 `assessmentSessions/{sessionId}`

- **Path:** `assessmentSessions/{sessionId}` where `sessionId = "${assignmentId}__${studentId}__${sessionOrdinal}"` per `assessment-sessions-begin.ts:182-188`.
- **Purpose:** Transient per-student working state during a Live assessment attempt.
- **Creator:** `assessmentSessionsBegin` via `create(...)` (server-enforced must-not-exist precondition) per `assessment-sessions-begin.ts:365-387`.
- **Mutation owner:** `assessmentSessionsAutosave` (only `responses` and `lastActivityAt`); `assessmentAttemptsFinalize` (deletes on successful commit); the deferred `assessmentSessionsSweepExpired`, `assessmentSessionsRecover`, and `assessmentSessionsPurgeArchived` callables per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §11.
- **District scope:** `districtId` is stamped at session creation from the caller's verified district claim per `assessment-sessions-begin.ts:349-357` and PDR-025.
- **School scope:** `schoolId` is stamped at session creation from the referenced assignment; assignment school MUST equal the caller's active school per `assessment-sessions-begin.ts:290-295`.
- **Class scope:** `classId` is stamped from the assignment and must match the caller's active enrollment per `assessment-sessions-begin.ts:317`.
- **Assignment scope:** `assignmentId` is stamped from the request; assignment must be `published`, `classroom`-mode, in-window per `assessment-sessions-begin.ts:296-315`.
- **Student ownership:** `studentId` is the caller's `uid`. One Live session per (`assignmentId`, `studentId`) pair enforced by the deterministic session id and `create(...)`.
- **Teacher relationship:** `teacherId` is denormalized from the assignment; teachers do NOT read live sessions (PDR-026, Sprint 9A reconciliation notice in `LYFELABZ_FIREBASE_SECURITY_MODEL.md`).
- **Lifecycle:** `live` at creation; `archived` after sweep or scorer rollback (both deferred); deleted on successful finalize.
- **Mutable or immutable:** Mutable while `live`; frozen when `archived`. Ownership fields (`studentId`, `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, `activityId`, `assessmentId`, `assessmentRevisionId`, `sessionOrdinal`, `startedAt`) are structurally excluded from every write shape after creation per `AssessmentSessionAutosaveWrite` in `assessment-session.ts:102-105`.
- **Sensitive fields:** `responses` (in-progress student answers); ownership context (student, class, teacher, school, district).
- **Authoritative fields:** `studentId`, `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, `activityId`, `assessmentId`, `assessmentRevisionId`, `sessionOrdinal`, `status`, `startedAt`, `responses?`, `lastActivityAt?`.
- **References:** parent `assignments/{assignmentId}`, `classes/{classId}`, `users/{studentId}`, `users/{teacherId}`, `schools/{schoolId}`, `assessmentRevisions/{assessmentRevisionId}`.

### 3.5 `attempts/{attemptId}`

- **Path:** `attempts/{attemptId}` where `attemptId = "${assignmentId}__${studentId}__a${attemptNumber}"` per `assessment-attempts-finalize.ts:217-223`.
- **Purpose:** Immutable authoritative record of a scored assessment attempt.
- **Creator:** `assessmentAttemptsFinalize` (sole writer) inside a Firestore transaction that also reads the session, revision, and answer key and deletes the session on success per `assessment-attempts-finalize.ts:583-844`.
- **Mutation owner:** None. No callable updates or deletes an attempt. Immutability is a PDR-026a invariant.
- **District scope:** `districtId` frozen at attempt creation from the session's `districtId`.
- **School scope:** `schoolId` frozen from session.
- **Class scope:** `classId` frozen from session.
- **Assignment scope:** `assignmentId` frozen from session.
- **Student ownership:** `studentId` frozen from session (equals authenticated caller at finalize time).
- **Teacher relationship:** `teacherId` denormalized from session, which itself denormalized from assignment.
- **Lifecycle:** `Finalized` (terminal) per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §7. No externally observable `draft`, `submitted`, or `pending` state exists.
- **Mutable or immutable:** Immutable after write.
- **Sensitive fields:** `score`, `maxScore`, `percentage`, `itemResults[*]` (`isCorrect`, `pointsEarned`, `correctOptionId`, `explanation`, `studentResponse`), `responses[]`. `correctOptionId` and `explanation` are the permitted subset of answer-key material delivered post-submission per `ASSESSMENT_SCORING_CONTRACT.md` §10.
- **Authoritative fields:** `studentId`, `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, `activityId`, `assessmentId`, `assessmentRevisionId`, `attemptNumber`, `score`, `maxScore`, `percentage`, `responses`, `itemResults`, `idempotencyKey`, `submittedAt`.
- **References:** parent `assignments`, `classes`, `users` (student and teacher), `schools`, `assessmentRevisions`; sibling attempts uniquely identified by `attemptNumber` within (`studentId`, `assignmentId`).

### 3.6 Supporting collections that affect assessment authorization

Only the aspects that materially affect Sprint 12B assessment Rules are recorded here. The exhaustive definitions live in `LYFELABZ_FIRESTORE_DATA_MODEL.md`.

- `users/{uid}`: authoritative role and `schoolId`; `districtId` is resolved through `schools/{schoolId}`. Read by `requireDistrictContext` at every callable entry. Rules currently allow only self `get` and a `displayName`-only self `update` (`firestore.rules:47-50`).
- `schools/{schoolId}`: authoritative `districtId`. Rules allow any authenticated `get`.
- `classes/{classId}`: `teacherId` is immutable at creation; ownership resolution for teacher-scoped reads. Rules allow owning-teacher `get` and `list`.
- `enrollments/{enrollmentId}` (id `"${classId}__${studentId}"`): `status` is the sole active-enrollment marker. Rules allow enrolled student `get`, and teacher `get`/`list` via a `classes/{classId}` lookup.
- `assignments/{assignmentId}`: `teacherId`, `classId`, `schoolId`, `lessonSlug`, `lessonVersion`, `mode`, `status`, `windowClosesAt`, `availableAt` are the fields consulted by begin/autosave/finalize.
- `auditEvents/{eventId}`: append-only server-only. Assessment writes emit `assessment.sessionBegan` and `assessment.attemptFinalized` per `audit-event.ts:33-34` and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §24.

## 4. Canonical Access Control Matrix

Columns: **AnonR** = Anonymous Read, **AnonW** = Anonymous Write, **StuR** = Student Read, **StuC** = Student Create, **StuU** = Student Update, **StuD** = Student Delete, **TchR** = Teacher Read, **TchC** = Teacher Create, **TchU** = Teacher Update, **TchD** = Teacher Delete, **Fn** = Function/Admin Only, **Cond** = Required Conditions. `deny` means Rules refuse the operation for every caller. `server` means the operation is performed by a callable under Admin SDK authority and bypasses Rules; the client-facing Rules answer for that verb is `deny`.

| Resource | AnonR | AnonW | StuR | StuC | StuU | StuD | TchR | TchC | TchU | TchD | Fn | Cond |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `assessments/{assessmentId}` | deny | deny | allow | deny | deny | deny | allow | deny | deny | deny | server (deployment) | Read requires `request.auth != null`. Writes are refused by Rules; only the deployment pipeline writes under admin authority. Document carries no answer-key material. Matches `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22. |
| `assessmentRevisions/{revisionId}` | deny | deny | allow | deny | deny | deny | allow | deny | deny | deny | server (deployment) | Read requires `request.auth != null`. Document is verified to carry no correct-answer material (§4 of the scoring contract; enforced in the deployment pipeline). |
| `assessmentAnswerKeys/{revisionId}` | deny | deny | deny | deny | deny | deny | deny | deny | deny | deny | server (scorer only) | Read denied for every role including `platformAdministrator` per PDR-026d and Contract §22. The scorer inside `assessmentAttemptsFinalize` is the sole reader; administrative inspection is routed through an audited callable. |
| `assessmentSessions/{sessionId}` | deny | deny | allow (own only) | deny | deny (allowed only if a future direct client autosave is authorized; current implementation is server-only) | deny | deny | deny | deny | deny | server (begin, autosave, finalize, sweep, recover, purge) | Student `get`: `isSignedIn() && resource.data.studentId == request.auth.uid && resource.data.districtId == request.auth.token.districtId`. Teacher reads are always refused (PDR-026, `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22). Every write path in the current implementation is server-only via typed refs in `typed-ref.ts:428-451`. |
| `attempts/{attemptId}` | deny | deny | allow (own only) | deny | deny | deny | allow (own teacher only) | deny | deny | deny | server (finalize sole writer) | Student `get`: `resource.data.studentId == request.auth.uid && resource.data.districtId == request.auth.token.districtId`. Teacher `get`: `resource.data.teacherId == request.auth.uid && resource.data.districtId == request.auth.token.districtId`. Update and delete refused for every role to preserve PDR-026a immutability. |
| `assignments/{assignmentId}` (assessment-facing view) | deny | deny | future (see finding I-3) | deny | deny | deny | allow (owner) | deny | deny | deny | server | Existing rule allows owning teacher only. Student assignment read is deferred (contract does not require it in Sprint 12B). |
| `enrollments/{enrollmentId}` | deny | deny | allow (own) | deny | deny | deny | allow (own class) | deny | deny | deny | server | Existing rule; not modified by Sprint 12B. |
| `classes/{classId}` | deny | deny | deny | deny | deny | deny | allow (owner) | deny | deny | deny | server | Existing rule; not modified by Sprint 12B. Students do not need class reads for the assessment surface. |
| `auditEvents/{eventId}` | deny | deny | deny | deny | deny | deny | deny | deny | deny | deny | server (audit helper only) | Append-only server-only per `LYFELABZ_FIREBASE_SECURITY_MODEL.md` §11. |

Explicit non-entries:

- `attemptRollups/{rollupId}` and `assignmentRollups/{rollupId}` are named by `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §11 and §22 but are not implemented in the certified backend. They MUST NOT be introduced by Sprint 12B; they are the deliverable of a later slice that also lands the rollup Cloud Function.

## 5. Field-Level Sensitivity Matrix

| Document | Field | Owning student | Owning teacher | Other district teacher | Administrator | Anonymous | No client |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `assessments/{assessmentId}` | `assessmentId`, `activityId`, `currentRevisionId`, `retiredAt` | readable | readable | readable | readable | denied | n/a |
| `assessmentRevisions/{revisionId}` | `items[*].stem`, `items[*].options`, `itemOrderingRule`, `points`, `publishedAt`, `publishedBy`, `schemaVersion` | readable | readable | readable | readable | denied | n/a |
| `assessmentAnswerKeys/{revisionId}` | Every field (`items[*].correctOptionId`, `items[*].explanation`, `items[*].points`, `publishedAt`, `publishedBy`, `schemaVersion`) | denied | denied | denied | denied | denied | server only |
| `assessmentSessions/{sessionId}` | `studentId`, `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, `activityId`, `assessmentId`, `assessmentRevisionId`, `sessionOrdinal`, `status`, `startedAt`, `responses`, `lastActivityAt` | readable (own) | denied | denied | denied | denied | server writer |
| `attempts/{attemptId}` | `studentId`, `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, `activityId`, `assessmentId`, `assessmentRevisionId`, `attemptNumber`, `score`, `maxScore`, `percentage`, `responses`, `submittedAt`, `idempotencyKey` | readable (own) | readable (own class) | denied | denied | denied | server writer |
| `attempts/{attemptId}` | `itemResults[*].correctOptionId`, `itemResults[*].explanation` (permitted answer-key subset per scoring contract §10.4) | readable (own) | readable (own class) | denied | denied | denied | server writer |
| `auditEvents/{eventId}` | Every field | denied | denied | denied | denied | denied | server writer, server reader |

`correctOptionId` and `explanation` are the ONLY answer-key derived values that ever cross the callable boundary, and they are delivered only inside the attempt record they belong to per `ASSESSMENT_SCORING_CONTRACT.md` §10.4. Every other answer-key field lives only in `assessmentAnswerKeys/*` and is server-confidential.

## 6. Mutation Ownership

| Collection | Client write | Callable | Trusted backend | Deployment pipeline | No actor after creation |
| --- | --- | --- | --- | --- | --- |
| `assessments/{assessmentId}` | denied | denied | denied | `deployAssessmentRevision` (merge set on `currentRevisionId`) | n/a |
| `assessmentRevisions/{revisionId}` | denied | denied | denied | `deployAssessmentRevision` (create only) | yes after create |
| `assessmentAnswerKeys/{revisionId}` | denied | denied | denied | `deployAssessmentRevision` (create only) | yes after create |
| `assessmentSessions/{sessionId}` | denied | `assessmentSessionsBegin` (create), `assessmentSessionsAutosave` (narrow update), `assessmentAttemptsFinalize` (delete inside finalize transaction) | future sweep, recover, purge callables | n/a | frozen when `archived` |
| `attempts/{attemptId}` | denied | `assessmentAttemptsFinalize` (create only) | none | n/a | yes after create |
| `auditEvents/{eventId}` | denied | audit-write helper across every write-emitting callable | none | n/a | yes after create |

Collections that MUST deny every direct client write in the Sprint 12B Rules:

- `assessments/{assessmentId}` (create, update, delete)
- `assessmentRevisions/{revisionId}` (create, update, delete)
- `assessmentAnswerKeys/{revisionId}` (create, update, delete)
- `assessmentSessions/{sessionId}` (create, update, delete)
- `attempts/{attemptId}` (create, update, delete)

## 7. Student Access Model

A student is authenticated when the callable helper `requireDistrictContext` resolves the caller as `role === "student"` and `status === "active"` with a signed claim triple `(role, schoolId, districtId)` that matches the canonical `users/{uid}` record.

Reads a student SHOULD be able to perform against Firestore directly through Rules:

- `assessments/{assessmentId}`: yes. Read allowed for any authenticated caller. Document carries no answer-key material.
- `assessmentRevisions/{revisionId}`: yes. Read allowed for any authenticated caller. Document is enforced to carry no answer-key material at the deployment boundary.
- `assessmentSessions/{sessionId}`: yes, own session only. Condition: `resource.data.studentId == request.auth.uid && resource.data.districtId == request.auth.token.districtId`.
- `attempts/{attemptId}`: yes, own attempt only. Same condition on `studentId` and `districtId`. Includes the permitted feedback subset (`itemResults[*].correctOptionId`, `itemResults[*].explanation`) which are the ONLY answer-key values a student ever sees.

Reads a student MUST NEVER perform:

- `assessmentAnswerKeys/{revisionId}`: denied by Rules for every role.
- Another student's session or attempt: denied by the `studentId == request.auth.uid` condition.
- A session or attempt from another district: denied by the `districtId` claim comparison.
- Any assignment metadata beyond what the callable already gates (student assignment reads are deferred).

Current implemented behavior versus future planned behavior:

- Current: no student can read anything, because the assessment collections are default-denied.
- Sprint 12B target: the student reads listed above are enabled.
- Future planned (not Sprint 12B): a student-facing assignment-read Rule to allow the "My Assignments" surface without a callable round-trip; the rollup collections `attemptRollups/*` when the rollup Cloud Function ships.

## 8. Teacher Access Model

A teacher is authenticated with `role === "teacher"`, `status === "active"`, and a signed claim triple that matches `users/{uid}`.

Reads a teacher SHOULD be able to perform:

- `assessments/{assessmentId}`: yes. Any authenticated caller.
- `assessmentRevisions/{revisionId}`: yes. Any authenticated caller.
- `attempts/{attemptId}`: yes, only where `resource.data.teacherId == request.auth.uid && resource.data.districtId == request.auth.token.districtId`. `teacherId` on `attempts` is the class's owning teacher, denormalized through the session from the assignment. Same-district AND class-ownership are both required per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22.
- `assignments/{assignmentId}`, `classes/{classId}`, `enrollments/{enrollmentId}`: already granted by the existing Rules.

Reads a teacher MUST NEVER perform:

- `assessmentSessions/{sessionId}`: denied for every teacher including the owning class teacher, per PDR-026 (teachers do not view live sessions) and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22.
- `assessmentAnswerKeys/{revisionId}`: denied for every role.
- Attempts in another district or another teacher's class: denied by the `teacherId == request.auth.uid` clause.

Class ownership requirement (evidence): the Implementation Contract §22 requires the attempt read caller to be the owning student OR the owning teacher (matched by `teacherId`), with district agreement. `attempts` carry `teacherId` denormalized at creation from the assignment (`assessment-attempts-finalize.ts:797-815`) and `teacherId` on `assignments` is immutable per `assignment.ts:34-40`. Same-district access alone is not sufficient; class ownership (matched by `teacherId`) is the class-ownership proxy that Rules can evaluate on the document itself.

## 9. Answer-Key Confidentiality Model

- **Storage.** Correct-answer material lives only in `assessmentAnswerKeys/{revisionId}`. The paired `assessmentRevisions/{revisionId}` document carries no correct-answer field; the split is enforced in `assessment-deployment.ts:322-343` (`projectRevisionItems` vs `projectAnswerKeyItems`).
- **Server readers.** Only the scorer inside `assessmentAttemptsFinalize` reads the document at request time (`assessment-attempts-finalize.ts:740-772`). No other callable reads it. No trigger, scheduled job, or dashboard reads it.
- **Client reads.** None, for any role, ever. This is a PDR-026d invariant and matches `LYFELABZ_FIREBASE_SECURITY_MODEL.md` §Sprint 9A Reconciliation Notice.
- **Post-submission answer reveal.** The reveal comes from the attempt record. The scorer writes `itemResults[*].correctOptionId` and `itemResults[*].explanation` onto `attempts/{attemptId}` per `assessment-attempts-finalize.ts:344-368`, and the student reads them by reading their own attempt. The answer-key document itself never crosses a client boundary.
- **Rule prevention.** Sprint 12B MUST include an explicit `match /assessmentAnswerKeys/{revisionId} { allow read, write: if false; }` block. The terminal default-deny already denies today, but an explicit block documents the intent, prevents accidental relaxation, and pairs with the dedicated Rules-test suite in Sprint 12C.
- **Enumeration leakage.** Firestore Security Rules deny by default include `list` refusals when the read `get` is denied. Sprint 12B MUST NOT introduce a `list` rule on `assessmentAnswerKeys/*`. The identifier construction `{assessmentId}__r{ordinal}` is also predictable, which is why the deny for `get` is what actually protects the document; predictability does not weaken the block because the read is refused regardless of whether the identifier is guessed.

## 10. Session Lifecycle Access Model

| Session state | Who may read (Rules) | Who may write (Rules) | Client direct writes? | Immutable? | Owning student read after finalize? |
| --- | --- | --- | --- | --- | --- |
| Not started (no document) | n/a | n/a | n/a | n/a | n/a |
| Live (autosaving) | owning student only | none | no; autosave is a callable | no (only `responses` and `lastActivityAt` mutate) | n/a |
| Submitted (transient) | n/a; only exists inside `assessmentAttemptsFinalize` transaction | n/a | no | n/a | n/a |
| Deleted after finalize | n/a | n/a | n/a | n/a | student reads the resulting attempt instead |
| Expired (Live past inactivity threshold) | (future) owning student read of an archived session, per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §10 | none from client | no | yes when archived | n/a |
| Archived | (future) owning student may read metadata; recovery is administrative | none from client | no | yes | n/a |
| Purged | n/a | n/a | n/a | n/a | n/a |
| Abandoned | not a distinct persisted state; treated as expired by the sweep | see Expired | see Expired | see Expired | n/a |

Notes for Sprint 12B:

- Only `live` and `archived` are enumerated on the implemented `AssessmentSessionStatus` union today (`assessment-session.ts:13`). The Rule for session read may be written against `resource.data.status in ["live", "archived"]` or unconditionally against `studentId` equality; the contract does not require the read to be gated by `status`.
- The Rules writer for Sprint 12B SHOULD NOT allow a client `update` on `assessmentSessions/*` today, because the certified implementation performs autosave through the callable. If a future slice introduces a direct-client autosave path, that Rules change is out of scope for Sprint 12B and requires a new PDR.

## 11. Attempt Immutability Model

- **Creation.** `assessmentAttemptsFinalize` is the sole writer. The write runs inside a transaction that reads the session, the assignment, the enrollment, the revision, and the answer key, then writes the attempt (`tx.set(attemptCreationDocRef(attemptId), ...)`) and deletes the session (`tx.delete(sessionRef)`), per `assessment-attempts-finalize.ts:589-844`.
- **Update path.** None. The typed reference set (`typed-ref.ts:531-551`) exposes only a create write shape.
- **Delete path.** None. No callable deletes an attempt.
- **Readers.** Owning student (matched by `studentId`) and owning teacher (matched by `teacherId`), same-district. The Rules for reads are the ONLY readers other than the scorer's transactional read of an existing attempt for idempotent replay.
- **Teacher score or feedback edits.** Not permitted. The teacher analytics surface (deferred) reads attempts through rollups; it does not mutate attempts.
- **Rules enforcement.** Sprint 12B MUST include `allow create, update, delete: if false;` on `attempts/{attemptId}`. The `create` deny is explicit because the terminal deny already covers it; the explicit block documents intent.
- **Administrative correction.** Not implemented. The Contract §22 permits an audited administrative callable that writes an adjacent correction record; that callable does not exist in the certified backend. No Rule for it is authorized by Sprint 12B.

## 12. District and Class Isolation

Authorization chain evidence:

- Student to session: `session.studentId == request.auth.uid && session.districtId == request.auth.token.districtId`. Session ownership is frozen at creation from the caller's `uid` and verified district (`assessment-sessions-begin.ts:345-357`).
- Student to attempt: same as session; attempt inherits ownership from session at write time (`assessment-attempts-finalize.ts:797-815`).
- Assignment to class: `assignment.classId` is immutable at creation (`assignment.ts:34-40`). Class ownership is authoritative on `classes/{classId}.teacherId`, which is also immutable at creation.
- Teacher to class: `class.teacherId == request.auth.uid`, evaluated on the document itself.
- Teacher to student: only through class ownership. The teacher never reads a student record directly under Sprint 12B.
- Teacher to attempt: `attempt.teacherId == request.auth.uid && attempt.districtId == request.auth.token.districtId`. The denormalized `teacherId` on the attempt is the class-ownership proxy; the same-district clause is additive.
- Assessment to district: none. Assessment content is district-neutral.
- Deployment to assignment: deployment writes are keyed by `activityId`; assignments reference the same lesson slug through `lessonSlug` and `lessonVersion`.
- Cross-school access: refused inside the callable at `assessment-sessions-begin.ts:290-295` (`assignment.schoolId !== actor.schoolId`).
- Cross-district access: refused by the district claim comparison and by `requireDistrictContext`.

Trusted vs untrusted values:

- Trusted: `request.auth.uid`, `request.auth.token.role`, `request.auth.token.schoolId`, `request.auth.token.districtId`, and every value already stored on the target `resource.data` (immutable ownership fields make this safe).
- Untrusted: every value in `request.resource.data`. Sprint 12B MUST NOT authorize a client write path whose ownership fields are read from `request.resource.data` without an independent claim comparison. In practice, Sprint 12B authorizes no client writes on any assessment collection, so this rule is automatically satisfied.

## 13. Existing Rules Gap Analysis

| Resource | Current behavior | Required behavior | Classification | Sprint 12B direction |
| --- | --- | --- | --- | --- |
| `assessments/{assessmentId}` | denied by terminal deny | authenticated `get`; write denied | not yet represented | Add `allow get: if isSignedIn();` |
| `assessmentRevisions/{revisionId}` | denied by terminal deny | authenticated `get`; write denied | not yet represented | Add `allow get: if isSignedIn();` |
| `assessmentAnswerKeys/{revisionId}` | denied by terminal deny (correct) | explicit deny for every operation | denied by default; make explicit | Add explicit `match` with `allow read, write: if false;` |
| `assessmentSessions/{sessionId}` | denied by terminal deny | owning-student `get`, same-district; no other client access | not yet represented | Add `allow get: if isSignedIn() && resource.data.studentId == request.auth.uid && resource.data.districtId == request.auth.token.districtId;` |
| `attempts/{attemptId}` | denied by terminal deny | owning-student OR owning-teacher `get`, same-district; explicit deny of create/update/delete | not yet represented | Add `get` (student or teacher path) and explicit `create, update, delete: if false;` |
| `assignments/{assignmentId}` student read | denied (owning-teacher only) | deferred | partially covered | Not modified by Sprint 12B |
| `attemptRollups/{rollupId}`, `assignmentRollups/{rollupId}` | denied by terminal deny | denied until rollup Cloud Function ships | denied by default | Not introduced by Sprint 12B |
| `auditEvents/{eventId}` | explicit deny | continue | fully covered | Not modified |

No collection is unintentionally exposed. The gap is exclusively functional: students and teachers cannot render their own results.

## 14. Required Sprint 12B Rules

Specification for Sprint 12B. This is not Rules code; a small pseudocode fragment appears where it clarifies intent.

### 14.1 Helper functions

- `isSignedIn()` (already exists).
- `isSelf(uid)` (already exists).
- `hasDistrictClaim()`: returns true when `request.auth.token.districtId is string && request.auth.token.districtId.size() > 0`.
- `matchesResourceDistrict()`: returns true when `resource.data.districtId == request.auth.token.districtId`.
- `isOwningStudent()`: returns true when `resource.data.studentId == request.auth.uid`.
- `isOwningTeacher()`: returns true when `resource.data.teacherId == request.auth.uid`.

Rule engine limits: helpers should be small and stateless. Do NOT introduce a helper that calls `get()` for assessments, because same-district plus document-ownership suffice on `assessmentSessions` and `attempts`; a second `get` would add cost without a Rules-visible benefit.

### 14.2 Collection match blocks

Introduce five new `match` blocks in `platform/firebase/firestore.rules`, in this order (grouping matches Sprint 11 code layout):

1. `match /assessments/{assessmentId}` - authenticated `get`; no `list`; write denied.
2. `match /assessmentRevisions/{revisionId}` - authenticated `get`; no `list`; write denied.
3. `match /assessmentAnswerKeys/{revisionId}` - `allow read, write: if false;`.
4. `match /assessmentSessions/{sessionId}` - owning-student, same-district `get`; no `list`; write denied.
5. `match /attempts/{attemptId}` - owning-student OR owning-teacher, same-district `get`; deny `list` in Sprint 12B (queries are the deliverable of the rollup slice); explicit `create, update, delete: if false;`.

### 14.3 Read rules (per collection)

- `assessments`: `allow get: if isSignedIn();`
- `assessmentRevisions`: `allow get: if isSignedIn();`
- `assessmentAnswerKeys`: `allow read: if false;`
- `assessmentSessions`: `allow get: if isSignedIn() && isOwningStudent() && matchesResourceDistrict();`
- `attempts`: `allow get: if isSignedIn() && matchesResourceDistrict() && (isOwningStudent() || isOwningTeacher());`

### 14.4 Write rules (per collection)

- Every assessment collection: no `allow create`, no `allow update`, no `allow delete`. The terminal deny plus the explicit `if false;` on `assessmentAnswerKeys` guarantees denial. Sprint 12B SHOULD write explicit `allow create, update, delete: if false;` on `attempts/{attemptId}` to document the immutability contract on the surface with the strongest immutability requirement.

### 14.5 Immutable-resource enforcement

- `attempts/*` must remain immutable. The Rules layer refuses every client write; the callable layer never issues a client-authority write to `attempts`.
- `assessmentRevisions/*` and `assessmentAnswerKeys/*` must remain immutable. Deployment uses `tx.create` per `assessment-deployment.ts:475-479`.
- `assessments/*` may advance `currentRevisionId` through the deployment pipeline's merge-set; no client write path.

### 14.6 District enforcement

- Every read rule that returns owner-scoped data compares `resource.data.districtId` against `request.auth.token.districtId`. This satisfies PDR-025e and Contract §22.
- Anonymous callers never receive a district claim, so the same-district clause automatically refuses them; the `isSignedIn()` guard is nonetheless retained for clarity.

### 14.7 Class and enrollment enforcement

- The teacher path on `attempts` relies on the denormalized `teacherId` per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22. This is intentional: it avoids a second `get()` at Rules time and inherits the immutable ownership guarantee of `classes/{classId}`.
- Enrollment status is enforced at callable time (`assessmentSessionsBegin` and `assessmentAttemptsFinalize`). Rules do NOT re-check enrollment for reads because the resource ownership fields already require the caller to be the resource's own student.

### 14.8 Answer-key denial

- Explicit `allow read, write: if false;` on `assessmentAnswerKeys/{revisionId}`.
- No helper allows access to `assessmentAnswerKeys/*` from any other Rule path.

### 14.9 Validation requirements

- Sprint 12B SHOULD NOT introduce a client write rule for any assessment collection. There is nothing to validate.
- If a future slice authorizes a client autosave write on `assessmentSessions/*`, that Rule MUST diff-enforce that only `responses` and `lastActivityAt` change, and MUST verify `request.resource.data.studentId == resource.data.studentId` and every other ownership field is unchanged. Sprint 12B does NOT introduce this rule.

### 14.10 Deny-by-default behavior

- The terminal `match /{document=**}` deny remains in place at the bottom of `firestore.rules`. Sprint 12B is additive.

## 15. Required Sprint 12C Test Matrix

Test names below use `arrange - act - assert` sentences that the test suite may translate into individual `it(...)` blocks.

### 15.1 Anonymous callers

- Anonymous `get` on `assessments/{...}` MUST fail.
- Anonymous `get` on `assessmentRevisions/{...}` MUST fail.
- Anonymous `get` on `assessmentAnswerKeys/{...}` MUST fail.
- Anonymous `get` on `assessmentSessions/{...}` MUST fail.
- Anonymous `get` on `attempts/{...}` MUST fail.
- Anonymous `create`, `update`, `delete` on each of the above MUST fail.
- Anonymous `list` on each of the above MUST fail.
- No previously granted public read is regressed (`schools/{...}` and `lmsProviders/{...}` remain authenticated-only, matching existing tests).

### 15.2 Students

- Student MAY `get` their own `assessmentSessions/{sessionId}` when `districtId` matches the claim.
- Student MAY NOT `get` another student's `assessmentSessions/{sessionId}` (same district).
- Student MAY NOT `get` a session where `session.districtId` does not match the claim.
- Student MAY `get` their own `attempts/{attemptId}` when district matches.
- Student MAY NOT `get` another student's attempt.
- Student MAY NOT `create`, `update`, or `delete` any `attempts/*` document.
- Student MAY NOT `create`, `update`, or `delete` any `assessmentSessions/*` document.
- Student MAY NOT `get` any `assessmentAnswerKeys/*` document.
- Student MAY `get` any `assessments/*` and any `assessmentRevisions/*` document.
- Student MAY NOT `list` `attempts/*` or `assessmentSessions/*` in Sprint 12B.
- Student MAY NOT successfully write a session that alters `studentId`, `assignmentId`, `classId`, `districtId`, `schoolId`, `teacherId`, `assessmentId`, `assessmentRevisionId`, or `sessionOrdinal` (verified indirectly by the deny of every client write path).

### 15.3 Teachers

- Teacher MAY `get` an `attempts/{attemptId}` where `teacherId == uid` and district matches.
- Teacher MAY NOT `get` an attempt in another teacher's class (same district, different teacher).
- Teacher MAY NOT `get` an attempt in another district.
- Teacher MAY NOT `get` any `assessmentSessions/*` including one for their own class.
- Teacher MAY NOT `get` any `assessmentAnswerKeys/*`.
- Teacher MAY `get` any `assessments/*` and `assessmentRevisions/*`.
- Teacher MAY NOT `create`, `update`, or `delete` any `attempts/*` document.
- Teacher MAY NOT `create`, `update`, or `delete` any `assessmentSessions/*` document.
- Teacher MAY NOT bypass ownership by supplying a matching district id alone (`districtId` clause alone is not sufficient; the ownership clause is also required).

### 15.4 Trusted backend

- A record created through a callable using the Admin SDK satisfies the read rules for the intended reader (positive-shape assertion; the emulator represents this as a signed-in caller with the corresponding claims).
- A client-authority equivalent of any callable write against `assessmentSessions/*`, `attempts/*`, `assessments/*`, `assessmentRevisions/*`, or `assessmentAnswerKeys/*` MUST be denied.
- An attempt document created by the callable remains immutable: client `update` and `delete` MUST fail regardless of role, district, or ownership.
- A finalized attempt cannot be "rolled back" through Rules: no client write path exists to reintroduce a session document at the finalized attempt's identifier.
- The answer key remains backend-only under every claim shape.

### 15.5 Adversarial cases

- Forged `districtId` in claim (client-signed) does not exist; emulator scenarios must therefore forge via test-only auth mocks. The rule must refuse a read where the mock claim's `districtId` does not equal the resource's `districtId`.
- Forged `studentId` in claim: a caller whose `uid` does not match the resource's `studentId` MUST NOT read that student's session or attempt.
- Forged `teacherId` in claim: a caller whose `uid` does not match the resource's `teacherId` MUST NOT read that attempt.
- Forged `classId` on a client-supplied write (no client write path exists) MUST fail because the write is denied outright.
- Forged `assignmentId` in the same way as above.
- Mismatched parent and child `districtId`: constructed by seeding an attempt whose `districtId` differs from the session-parent chain; the Rule refuses because the `districtId` claim comparison is on the attempt document itself.
- Cross-school access: a teacher from school B in district D MAY NOT read an attempt owned by a teacher in school A in the same district D; the `teacherId` clause fails.
- Cross-district access: refused for every role.
- Attempt to alter `score`, `teacherId`, `districtId`, or any field on `attempts/*`: refused because every client write is denied.
- Status rollback (session `archived` back to `live`): no client write path exists.
- Attempt deletion: refused.
- Session reassignment: refused (no client write path).
- Collection enumeration on `assessmentAnswerKeys/*`: refused (no `list` rule).

## 16. Findings and Decisions Required

### 16.1 Confirmed implementation facts

- **C-1.** `assessmentSessions/*` writes and `attempts/*` writes are exclusively callable-authored via typed Admin SDK references (`typed-ref.ts:414-551`). No client write path exists in the current code.
- **C-2.** The deployment pipeline is the sole writer of the three content collections and uses `tx.create` for the immutable revision and answer-key documents (`assessment-deployment.ts:475-479`).
- **C-3.** Only the scorer inside `assessmentAttemptsFinalize` reads `assessmentAnswerKeys/*` (`assessment-attempts-finalize.ts:740-772`).
- **C-4.** Attempt immutability is enforced structurally: there is no update or delete reference for `attempts/*` in `typed-ref.ts`.
- **C-5.** Session ownership fields are frozen at session creation and are structurally absent from the autosave write shape (`assessment-session.ts:102-105`).
- **C-6.** District enforcement runs in every callable via `requireDistrictContext` (`require-district-context.ts:70-189`).

### 16.2 Documentation gaps (Sprint 12B may proceed without resolving these)

- **D-1. Session status vocabulary drift.** `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22 refers to session-frozen fields including `beganAt`; the implementation uses `startedAt` (`assessment-session.ts:51-66`). Similar drift exists between `state` (contract §5, §22) and `status` (implementation).
  - Severity: **Minor**.
  - Evidence: `grep -n "beganAt\|startedAt\|status\|state" docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md platform/functions/src/shared/types/assessment-session.ts`.
  - Impact: Rules text written against the field names in the contract would not match the implemented documents. Sprint 12B MUST use the implemented names.
  - Recommended resolution: Sprint 12B does not need to modify the contract; the Rules text itself is the authoritative binding and MUST refer to `status` and `startedAt`. A future documentation reconciliation may amend the contract prose to match the implementation.

- **D-2. Rollup collections named but unimplemented.** `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22 enumerates Rules for `attemptRollups/*` and `assignmentRollups/*`, but the collections are not implemented in the certified backend.
  - Severity: **Informational**.
  - Evidence: `grep -rn "attemptRollups\|assignmentRollups" platform/functions/src` returns no matches; `platform/firebase/firestore.indexes.json` is empty.
  - Impact: Sprint 12B MUST NOT introduce Rules for these collections.
  - Recommended resolution: Defer to the rollup slice that ships the Cloud Function.

### 16.3 Rules gaps (Sprint 12B addresses all)

- **R-1. No assessment collections have `match` blocks.** All reads and writes on `assessments`, `assessmentRevisions`, `assessmentAnswerKeys`, `assessmentSessions`, and `attempts` fall through to the terminal deny.
  - Severity: **Important** (functional gap, not a security gap).
  - Evidence: `platform/firebase/firestore.rules` contains no reference to any assessment collection.
  - Impact: Students cannot render their attempts and sessions through Firestore; teachers cannot render class attempts. The platform is safe but not usable.
  - Recommended resolution: implement §14 in Sprint 12B.

- **R-2. Answer-key deny is only implicit.** The terminal deny covers `assessmentAnswerKeys/*` today, but no explicit block documents the intent.
  - Severity: **Minor**.
  - Evidence: `firestore.rules:322-324`.
  - Impact: A future edit that adds a permissive rule for `assessmentAnswerKeys/*` would not obviously conflict with an existing explicit block.
  - Recommended resolution: Sprint 12B adds `match /assessmentAnswerKeys/{revisionId} { allow read, write: if false; }`.

### 16.4 Test gaps

- **T-1.** No Rules tests exist for any assessment collection.
  - Severity: **Important**.
  - Evidence: `platform/firebase/tests/` contains no `assessment*` or `attempts*` test file.
  - Impact: The Sprint 12B Rules would ship without matching Rules-test coverage.
  - Recommended resolution: Sprint 12C adds the matrix in §15 as `platform/firebase/tests/assessments.rules.test.ts`, `assessment-sessions.rules.test.ts`, `assessment-answer-keys.rules.test.ts`, and `attempts.rules.test.ts` (mirroring the naming convention of the existing test set).

### 16.5 Architectural contradictions

- None found. Every certified backend behavior maps cleanly onto the Contract §22 rule intents.

### 16.6 Decisions required before Sprint 12B

- None. The Contract §22 rule intents are unambiguous, PDR-026d is unambiguous, and the Rules code path can be produced from §14 without additional decisions.

## 17. Sprint 12A Certification Recommendation

**CERTIFIED: Sprint 12B may proceed.**

The assessment data topology, ownership matrix, sensitivity matrix, mutation ownership, student and teacher access models, answer-key confidentiality model, session lifecycle model, attempt immutability model, district and class isolation chains, existing Rules gaps, Sprint 12B Rules specification, and Sprint 12C test matrix are all documented against implementation and certified contracts. No architectural decision is required before Sprint 12B begins. The recommended first bounded implementation slice is the addition of the five `match` blocks in §14.2 with the reads in §14.3 and the explicit denies in §14.4 and §14.5, plus the paired Sprint 12C test files enumerated in §15.
