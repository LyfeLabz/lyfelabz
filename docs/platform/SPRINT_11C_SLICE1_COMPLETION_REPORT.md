# Sprint 11C Slice 1 Completion Report

**Status:** Completed. Slice 1 of the Sprint 11C assessment pipeline sequence.
**Date:** 2026-07-14
**Anchor decision:** PDR-026 Assessment Implementation.
**Governs:** Server-side foundation of the assessment-attempt lifecycle. Introduces the `assessmentSessions/{sessionId}` collection and the `assessmentSessionsBegin` callable that opens a Live session for an authenticated student. Explicitly excludes submission, scoring, answer-key retrieval, attempt writes, rollups, Google Classroom, Firestore Rules, and UI.

---

## 1. Purpose

Sprint 11B closed the district-authorization migration for the class, enrollment, and assignment layers. Sprint 11C begins the implementation of PDR-026, the certified formative assessment pipeline. Slice 1 lands only the initialization step of the attempt lifecycle: the writing of a canonical Live session on `assessmentSessions/{sessionId}` when an authenticated student begins an authorized assessment.

Per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §6, the attempt lifecycle from the student's perspective begins with a session. Attempts are the immutable, finalized artifact produced by the future `assessmentAttemptsFinalize` transaction (§7, §8). The session is the transient working state that lifecycle-initializes the attempt; without it, no attempt can ever be produced. Slice 1 delivers that initialization step and nothing more.

## 2. Canonical authority

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (PDR-026) §6 session lifecycle, §11 collection ownership, §12 canonical document identifiers, §13 collection relationships, §14 immutable versus mutable records, §17 assignment relationship, §21 Cloud Function ownership matrix, §24 audit event requirements, and §30 explicit non-goals.
- `docs/platform/ASSESSMENT_PIPELINE_SPECIFICATION.md` for the certified educational stance that the pipeline is session-authoritative, server-scored, unlimited-attempt, and immutable.
- `docs/platform/SPRINT_11A_IMPLEMENTATION_INVENTORY.md` §5 (assessment implementation status) and the observation that every PDR-026 §21 callable was Missing at the start of Sprint 11.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §2 (single-writer claim discipline) and Appendix A (canonical callable names).
- `docs/platform/PLATFORM_CONTRACTS.md` for the client-storage prohibitions that continue to hold at the callable layer.
- `docs/platform/PLATFORM_STATE_MACHINE.md` for the assessment session lifecycle diagram (Live is the only externally observable state introduced by this slice).
- PDR-025 (`DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`) §6 canonical claim shape, §10 resource ownership chain, §17 closed-set error vocabulary; the shared `requireDistrictContext` helper established in Sprint 11B Slice 1 is consumed unchanged.

## 3. Assessment callables inspected

- `platform/functions/src/submissions/submissions-create.ts` (`submissionsCreate`). The Sprint 5A creation callable for `submissions/{submissionId}` in the transient `submitted` state. Superseded by `assessmentAttemptsFinalize` per PDR-026 §26. Preserved unchanged; the reconciliation migration is deferred.
- `platform/functions/src/submissions/submissions-finalize.ts` (`submissionsFinalize`). The Sprint 5A finalization callable that transitions `submissions/{submissionId}` from `submitted` to `finalized`. Superseded by `assessmentAttemptsFinalize` per PDR-026 §26. Preserved unchanged; the reconciliation migration is deferred.
- No prior file under `platform/functions/src/assessments/*` exists. The full PDR-026 §21 callable matrix (`assessmentSessionsBegin`, `assessmentSessionsAutosave`, `assessmentSessionsSweepExpired`, `assessmentSessionsRecover`, `assessmentSessionsPurgeArchived`, `assessmentAttemptsFinalize`, `assessmentAttemptsGetForStudent`, `assessmentAttemptsGetForTeacher`, `assessmentRollupsRecomputeAttempt`, `assessmentAnswerKeysAdministrativeRead`) was Missing at the start of the slice. Slice 1 lands only the first row.

## 4. Files created

- `platform/functions/src/shared/types/assessment-session.ts`. Introduces `ASSESSMENT_SESSIONS_COLLECTION`, the `AssessmentSessionStatus` union (`live` and `archived` declared; only `live` reachable through this slice), the read-side `AssessmentSessionRecord`, and the narrow-write `AssessmentSessionCreationWrite`. Every ownership field enumerated in §13 is required at creation; no field is client-writable.
- `platform/functions/src/assessments/assessment-sessions-begin.ts`. The `assessmentSessionsBegin` callable, its `sessionIdFor` deterministic identifier helper, and an internal handler export for unit testing. Includes narrow refusals for the six PDR-025 district errors that propagate through the shared helper, the callable-local `role-forbidden` refusal for non-student callers, request-shape validation, assignment refusals, enrollment refusals, and the one-Live-session idempotent replay.
- `platform/functions/src/assessments/assessment-sessions-begin.test.ts`. Twenty new Jest cases covering canonical write, deterministic identifier construction, idempotent replay, conflict refusal on mismatched fields, conflict refusal on archived-status collision, six canonical district refusals, `role-forbidden`, request-shape refusals, malformed-`assignmentId` refusals, assignment refusals (missing, cross-school, practice-mode, non-published), enrollment refusals (missing, non-active), and audit-event non-emission on session write failure.
- `platform/functions/src/assessments/index.ts`. Barrel export for the new assessment callable namespace.
- `docs/platform/SPRINT_11C_SLICE1_COMPLETION_REPORT.md`. This report.

## 5. Files modified

- `platform/functions/src/shared/types/audit-event.ts`. Adds `"assessment.sessionBegan"` to the closed `AuditAction` union. No other action name is introduced. Every prior action is preserved.
- `platform/functions/src/shared/audit/write-audit-event.ts`. Adds `"assessment.sessionBegan"` to the `VALID_ACTIONS` list consumed by the canonical writer. The writer contract, evidentiary-value guarantee, server-time stamping, and every prior refusal remain unchanged.
- `platform/functions/src/shared/firestore/typed-ref.ts`. Adds the collection-level `assessmentSessionsCollectionRef`, the read-side `assessmentSessionDocRef`, and the narrow-write `assessmentSessionCreationDocRef`. No prior typed reference was modified.
- `platform/functions/src/shared/index.ts`. Re-exports the three typed references and the four new type identifiers introduced by this slice. Every prior export is preserved.
- `platform/functions/src/index.ts`. Exports the `assessmentSessionsBegin` callable so Firebase deployment publishes it under the canonical PDR-026 §21 name. No prior export was modified.
- `docs/platform/SPRINT_HISTORY.md`. Appends the Sprint 11C Slice 1 history entry.

## 6. Implementation completed

`assessmentSessionsBegin` is a callable that accepts `{ assignmentId }` on an authenticated request and returns `{ sessionId, alreadyLive }`. The handler:

1. Authorizes the caller through `requireDistrictContext(request)`. The shared helper enforces authentication, canonical `users/{uid}` active-status, canonical `schools/{schoolId}` district resolution, and the six-way agreement between the caller's signed claim and the resolved record per PDR-025 §11-§12 and §15. Every refusal it raises (`unauthenticated`, `account-inactive`, `claim-stale`, `claim-state-mismatch`, `school-district-mismatch`, `district-unassigned`, `district-mismatch`) is propagated to the callable boundary unchanged and unaliased.
2. Refuses a non-student caller with the canonical `role-forbidden` identifier per PDR-025 §17 and PDR-026 §21 (student-only surface).
3. Validates the request payload. A non-object payload is refused with `assessmentSessions.invalidRequest`. A missing or non-URL-safe `assignmentId` is refused with `assessmentSessions.invalidAssignmentId`.
4. Loads the referenced `assignments/{assignmentId}` document through the typed reference. A missing record is refused with `assessmentSessions.assignmentNotFound`.
5. Verifies the assignment is in the caller's school. A cross-school target is refused with `assessmentSessions.forbidden`. Because the caller's district was already verified in step 1 and the assignment's school is denormalized against the same district under PDR-025 §10, a same-school target is guaranteed to be a same-district target; no second district read is required.
6. Refuses a `practice`-mode target with `assessmentSessions.invalidAssignmentMode` per PDR-026 §17 (practice is client-only and never produces a session). Refuses a non-`published` target (draft, closed, archived) with `assessmentSessions.invalidAssignmentStatus`.
7. Verifies the caller's active enrollment through `enrollmentDocRef(...).get()` on the canonical `{classId}__{studentId}` identifier. Refuses a missing or non-`active` enrollment with `assessmentSessions.notEnrolled`.
8. Constructs the deterministic session identifier `{assignmentId}__{studentId}__1` per §12 and reads the existing document. On a matching Live session owned by the caller under the same class, teacher, school, district, activity, assessment, and revision, the handler returns `{ sessionId, alreadyLive: true }` with no second write and no second audit event, honoring the §6 one-Live-session invariant. Every non-matching existing record (different ownership, different denormalized identifier, archived status, or divergent frozen fields) is refused with `assessmentSessions.conflict`.
9. On a first-write path, writes a canonical `AssessmentSessionCreationWrite` payload. `studentId` is the caller's uid. `classId`, `teacherId`, and `schoolId` are denormalized from the referenced assignment record per §13. `districtId` is the caller's verified district. `activityId`, `assessmentId`, and `assessmentRevisionId` are derived deterministically from the assignment's frozen `lessonSlug` and `lessonVersion` per the interim rule in §9; the paired `assessmentRevisions/{revisionId}` document lands with a later slice, and the identifier already conforms to §12's `{assessmentId}__r{ordinal}` shape so the future revision document can be published under the same string without a rewrite. `sessionOrdinal` is 1. `status` is `live`. `startedAt` is `FieldValue.serverTimestamp()`.
10. Emits exactly one `assessment.sessionBegan` audit event with `actorRole: "student"`, `targetType: "assessmentSession"`, `targetId: sessionId`, `schoolId`, and a payload carrying `assignmentId`, `classId`, `activityId`, `assessmentId`, `assessmentRevisionId`, `sessionOrdinal`, and the caller's verified `districtId`. The event carries no PII and no answer-key excerpt per §24.

The multi-session ordinal rule of §12 (a new ordinal after an archived session) requires the archived-session lifecycle introduced by `assessmentSessionsSweepExpired` and `assessmentSessionsRecover`. Both are explicitly deferred. This slice therefore writes only the first session for a `(studentId, assignmentId)` pair and refuses a second-session attempt with `assessmentSessions.conflict`. The refusal is not the terminal shape of the rule; it is the correct behavior for the current slice, and it becomes an ordinal advancement in a later slice without any rewrite of the current one.

## 7. Tests added

`platform/functions/src/assessments/assessment-sessions-begin.test.ts` covers:

- deterministic identifier construction for the first-session ordinal and an explicit ordinal;
- canonical happy-path write with a single audit event and the exact canonical payload;
- idempotent replay on a matching Live session with no second write and no second audit event;
- refusal of a conflicting existing session with mismatched canonical fields;
- refusal of a session collision when the existing document is already archived;
- propagation of each of the six canonical district refusals (`unauthenticated`, `account-inactive`, `claim-stale`, `district-mismatch`, `school-district-mismatch`, `district-unassigned`);
- callable-local `role-forbidden` refusal for a non-student caller;
- request-shape refusals (`null` payload, non-object payload, missing `assignmentId`, empty `assignmentId`, non-URL-safe `assignmentId`);
- assignment refusals (missing record, cross-school school mismatch, `practice`-mode, non-`published` for each of `draft`, `closed`, `archived`);
- enrollment refusals (missing record, non-`active` status);
- audit-event non-emission when the session write fails.

Every prior test in the repository is preserved. No test was rewritten to accommodate this slice.

## 8. Full test totals

- Test suites: 25 passed, 25 total (up from 24).
- Tests: 428 passed, 428 total (up from 407).
- Snapshots: 0.
- Duration: approximately 3 seconds on the local runner.

## 9. Preserved behavior

- No modification to `submissions/*`, `assignments/*`, `enrollments/*`, `classes/*`, `lms/*`, `auth/*`, `students/*`, `teachers/*`, or `schools/*`.
- The Sprint 5A submissions surface remains authoritative for the current classroom-mode write path pending the reconciliation migration in a future slice. Assignment lifecycle behavior, enrollment lifecycle behavior, class lifecycle behavior, and district-boundary enforcement are unchanged.
- No modification to Firestore Rules, indexes, or storage rules.
- No modification to app code, PDRs, architecture documents, or any platform contract.
- The `requireDistrictContext` helper, the `writeAuditEvent` helper, and every other shared surface are unchanged. Only additive references and one additive audit action name were introduced.
- Every prior audit-vocabulary value is preserved; only the additive `assessment.sessionBegan` action is introduced.
- Every prior typed reference is preserved; only three additive references are introduced.
- The audit writer's evidentiary-value guarantee is preserved: `occurredAt` remains server-stamped, and no callable-supplied timestamp is ever accepted.

## 10. Validation summary

- `npm run lint` under `platform/functions`: clean.
- `npm run typecheck` under `platform/functions`: clean.
- `npm run build` under `platform/functions`: clean.
- `npm test` under `platform/functions`: 26 suites, 448 tests, all green.
- `git diff --check`: clean (no whitespace errors, no conflict markers).
- Documentation grep for em dashes on created and modified files: clean.
- No commit was created.

## 11. Deferred work

- `assessmentSessionsAutosave` (Slice 2 or later). Autosave will extend `AssessmentSessionRecord` with a `responses` array and introduce a narrow autosave write reference. No response array is accepted on session-begin in this slice.
- `assessmentSessionsSweepExpired` and `assessmentSessionsPurgeArchived` (scheduled) and `assessmentSessionsRecover` (administrative). These callables introduce the archived-session state, the archived-session recovery window, and the multi-session ordinal advancement.
- `assessmentAttemptsFinalize`, the paired answer-key read at `assessmentAnswerKeys/{revisionId}`, the scorer, and the immutable `attempts/{attemptId}` write. `attemptRollups` and `assignmentRollups` are deferred with the scorer per §11 and §20.
- `assessmentAttemptsGetForStudent` and `assessmentAttemptsGetForTeacher` per §21.
- The `assessments/{assessmentId}`, `assessmentRevisions/{revisionId}`, and `assessmentAnswerKeys/{revisionId}` collections and the deployment pipeline that authors them. This slice denormalizes `activityId`, `assessmentId`, and `assessmentRevisionId` on the session from the referenced assignment's frozen `lessonSlug` and `lessonVersion`; the paired documents land with the deployment pipeline in a later slice.
- Reconciliation of `submissions/{submissionId}` with `attempts/{attemptId}` per §26. The two collections must not run simultaneously in production; the migration is authored by the sprint that lands the attempt write path.
- Firestore Rules invariants for every assessment collection per §22 and §27. The `assessmentSessions/*` collection currently inherits the terminal default-deny; the callable is the sole authorized writer under an admin credential.
- Composite indexes per §23 (session resume, attempt list per student, attempt list per assignment).
- `assessment.attemptFinalized`, `assessment.sessionArchived`, `assessment.sessionPurged`, `assessment.sessionRecovered`, and `assessment.answerKeyRead` audit actions per §24 are deferred to the slices that first emit them.
- Every PDR-025 §17 identifier that requires per-target district enforcement beyond the caller's context is deferred with the callable that first needs it. The shared same-schoolId invariant used here is sufficient for the session-begin surface.

## 12. Certification

Only Sprint 11C Assessment Slice 1 was implemented. No submission surface was added. No scorer, answer key, answer reveal, or attempt document was written. No Google Classroom or LMS callable was touched. No Firestore Rules, storage rules, index, or app code was modified. No architecture document or PDR was amended. No commit was created.

The certified architecture, the certified district security boundary, the certified assignment authorization chain, the certified audit contract, and the certified assessment implementation contract remain change-controlled and unmodified except through the additive, minimally scoped changes enumerated in §4 and §5 of this report.
