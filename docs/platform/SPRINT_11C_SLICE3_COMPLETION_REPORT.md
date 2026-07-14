# Sprint 11C Slice 3 Completion Report

**Status:** Completed. Slice 3 of the Sprint 11C assessment pipeline sequence.
**Date:** 2026-07-14
**Anchor decisions:** PDR-026 Assessment Implementation; PDR-021 Assessment Pipeline; ratified `ASSESSMENT_SCORING_CONTRACT.md` (Sprint 11C Pre-3).
**Governs:** Server-side finalization of a Live assessment session into an immutable authoritative attempt through the sole canonical writer of `attempts/*`, `assessmentAttemptsFinalize`. Introduces the v1 shape-level scorer that reads the server-confidential `assessmentAnswerKeys/{revisionId}` document, produces the certified per-item feedback subset, deletes the session inside the same Firestore transaction that writes the attempt, and emits exactly one `assessment.attemptFinalized` audit event on successful commit.

---

## 1. Purpose

Slice 1 landed `assessmentSessionsBegin`. Slice 2 landed `assessmentSessionsAutosave`. Slice 3 lands the terminal Live-to-Attempt transition per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §7 and §8: the certified callable `assessmentAttemptsFinalize` that reads the session under the caller's authenticated identity, verifies ownership, resolves the paired revision and server-confidential answer key, applies the v1 `singleChoice` scoring rule, writes the immutable attempt, deletes the session in the same transaction, and emits the canonical audit event. Every deferred callable in the PDR-026 §21 matrix (sweep, purge, recover, resume, attempt reads, rollup, administrative answer-key read) remains deferred. No Firestore Rules and no composite index are modified.

## 2. Canonical authorities reviewed

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (PDR-026) §5-§8 lifecycle, §11 collection ownership, §12 deterministic identifiers, §13 relationships, §14 immutability, §15 answer-key ownership, §17 assignment relationship, §21 callable ownership matrix, §22 Firestore Rules invariants, §24 audit vocabulary, §25 error contract, §29 implementation checklist.
- `docs/platform/ASSESSMENT_SCORING_CONTRACT.md` §3-§17. v1 supported item type is exclusively `singleChoice`, the response representation is `{itemId, response}` with `response` a string, the per-item rule is strict case-sensitive string equality, absolute score is the sum of `pointsEarned`, and the percentage is `round((score / maxScore) * 100, 2)` under banker's rounding. Every integrity failure surfaces a distinguishable identifier and leaves the session Live.
- `docs/platform/ASSESSMENT_PIPELINE_SPECIFICATION.md` §11 server-authoritative scoring, §14 attempt shape, §15 revision strategy.
- `docs/platform/SPRINT_11A_IMPLEMENTATION_INVENTORY.md` pre-Sprint 11C state.
- `docs/platform/SPRINT_11C_SLICE1_COMPLETION_REPORT.md` and `docs/platform/SPRINT_11C_SLICE2_COMPLETION_REPORT.md` for the exact session-record shape and the autosave-boundary validator this slice inherits.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §2 single-writer discipline.
- `docs/platform/PLATFORM_CONTRACTS.md` client-storage prohibitions.
- PDR-025 (`DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`) §6 canonical claim shape, §12 per-callable district-context requirement, §17 closed-set error vocabulary. The shared `requireDistrictContext` helper is consumed unchanged.
- `docs/platform/PLATFORM_STATE_MACHINE.md` user-status lifecycle.

## 3. Existing assessment surfaces inspected

- `platform/functions/src/assessments/assessment-sessions-begin.ts` (`assessmentSessionsBegin`). Preserved unchanged; the deterministic session identifier construction and the frozen ownership fields are consumed as-is.
- `platform/functions/src/assessments/assessment-sessions-autosave.ts` (`assessmentSessionsAutosave`). Preserved unchanged; the autosave-boundary validator's `{itemId, response}` shape is the authoritative session-response representation this slice consumes.
- `platform/functions/src/assessments/*.test.ts`. All prior test files preserved unchanged.
- `platform/functions/src/shared/types/assessment-session.ts`. Preserved unchanged. The `AssessmentSessionRecord` read shape is consumed by the scorer.
- `platform/functions/src/shared/firestore/typed-ref.ts`. Extended additively with revision, answer-key, attempt, and attempt-collection references. No prior reference is modified.
- `platform/functions/src/shared/types/audit-event.ts` and `platform/functions/src/shared/audit/write-audit-event.ts`. Extended additively with the `assessment.attemptFinalized` action per PDR-026 §24.
- `platform/functions/src/submissions/*`. The Sprint 5A `submissionsCreate` and `submissionsFinalize` callables remain preserved unchanged pending the reconciliation migration deferred by PDR-026 §26.
- The full PDR-026 §21 callable matrix beyond `assessmentSessionsBegin`, `assessmentSessionsAutosave`, and `assessmentAttemptsFinalize` (sweep, purge, recover, resume, attempt reads, rollup, administrative answer-key read) remains Missing after this slice.

## 4. Files created

- `platform/functions/src/shared/types/assessment.ts`. Canonical read shapes for `assessments/{assessmentId}`, `assessmentRevisions/{revisionId}`, and `assessmentAnswerKeys/{revisionId}` per `ASSESSMENT_SCORING_CONTRACT.md` §4 and §5. Includes the v1 discriminant literals (`ASSESSMENT_SCHEMA_VERSION_V1`, `AssessmentItemType`, `AssessmentItemOrderingRule`), the per-item shapes (`AssessmentRevisionItem`, `AssessmentRevisionItemOption`, `AssessmentAnswerKeyItem`), and the deployment-only write shapes reserved for a later deployment-pipeline slice. No callable in this slice writes any of these documents.
- `platform/functions/src/shared/types/attempt.ts`. Canonical read shape `AssessmentAttemptRecord` and creation-write shape `AssessmentAttemptCreationWrite` for `attempts/{attemptId}` per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §7 and `ASSESSMENT_SCORING_CONTRACT.md` §10.3. Includes the per-item `AssessmentAttemptItemResult` shape carrying `itemId`, `isCorrect`, `pointsEarned`, `correctOptionId`, `explanation`, and `studentResponse`.
- `platform/functions/src/shared/firestore/transaction.ts`. Thin `runFirestoreTransaction<T>(fn)` wrapper over `getAdminFirestore().runTransaction()`. Used by the finalize callable to satisfy the §8 requirement that the session read, session delete, attempt write, and idempotency-lookup query occur in one atomic operation.
- `platform/functions/src/assessments/assessment-attempts-finalize.ts`. The `assessmentAttemptsFinalize` callable and its internal handler export for unit testing. Includes the request-shape validator (structural refusal of every server-owned field including `score`, `maxScore`, `percentage`, `itemResults`, `responses`, `attemptNumber`, `assessmentRevisionId`, and every ownership field), the v1 scorer, the deterministic `attemptIdFor` helper, and the transactional finalize flow.
- `platform/functions/src/assessments/assessment-attempts-finalize.test.ts`. Thirty-four Jest cases covering the successful path, scoring correctness (all correct, all incorrect, mixed, all unanswered, some unanswered, response value that matches no option, ignored ghost item), idempotent replay, non-owner refusal, cross-district refusal, cross-school refusal, archived-session refusal, missing-session refusal, non-student caller refusal, canonical district-context refusals (`unauthenticated`, `account-inactive`, `district-mismatch`), request-shape refusals (non-object, non-string sessionId, non-string idempotencyKey, client-supplied score/correctness/response/attemptNumber/etc.), integrity failures (missing revision, missing answer key, non-v1 schemaVersion on either side, mismatched item sets, correctOptionId not in revision options, unsupported itemType, malformed session response value), revision resolution from the session's frozen `assessmentRevisionId`, determinism across two invocations, banker's rounding of the percentage, atomicity of the session delete and attempt write, and containment of the response payload to the certified feedback subset.
- `docs/platform/SPRINT_11C_SLICE3_COMPLETION_REPORT.md`. This report.

## 5. Files modified

- `platform/functions/src/shared/firestore/typed-ref.ts`. Adds the read references `assessmentDocRef`, `assessmentRevisionDocRef`, `assessmentAnswerKeyDocRef`; the read reference `attemptDocRef`; the collection reference `attemptsCollectionRef` (used by the idempotency-lookup query and the attempt-count query); and the narrow-write reference `attemptCreationDocRef` typed as `AssessmentAttemptCreationWrite`. Every prior reference is preserved unchanged.
- `platform/functions/src/shared/types/audit-event.ts`. Adds the literal `"assessment.attemptFinalized"` to the `AuditAction` union per PDR-026 §24. Every prior value is preserved.
- `platform/functions/src/shared/audit/write-audit-event.ts`. Adds the same literal to the `VALID_ACTIONS` allowlist. No other change.
- `platform/functions/src/shared/index.ts`. Re-exports the new typed references (`assessmentDocRef`, `assessmentRevisionDocRef`, `assessmentAnswerKeyDocRef`, `attemptCreationDocRef`, `attemptDocRef`, `attemptsCollectionRef`), the transaction helper (`runFirestoreTransaction`), and the new type identifiers from `types/assessment` and `types/attempt`. Every prior export is preserved.
- `platform/functions/src/assessments/index.ts`. Re-exports the new `assessmentAttemptsFinalize` callable, the `attemptIdFor` helper, and the request and response types alongside the Slice 1 and Slice 2 exports.
- `platform/functions/src/index.ts`. Exports `assessmentAttemptsFinalize` so Firebase deployment publishes it under the canonical PDR-026 §21 name. Every prior export is preserved.
- `docs/platform/SPRINT_HISTORY.md`. Appends the Sprint 11C Slice 3 history entry.

No other file in the repository was modified in this slice.

## 6. Callable implemented

`assessmentAttemptsFinalize` accepts `{ sessionId, idempotencyKey }` on an authenticated request and returns `{ attemptId, attemptNumber, score, maxScore, percentage, itemResults, replay }`. The handler:

1. Authorizes the caller through `requireDistrictContext(request)`. Every canonical PDR-025 refusal is propagated to the callable boundary unchanged and unaliased.
2. Refuses a non-student caller with `role-forbidden` per PDR-025 §17 and PDR-026 §21.
3. Validates the request payload. A non-object, array, or `null` payload is refused with `assessmentAttempts.invalidRequest`. Any client-supplied server-owned field (twenty-two enumerated keys including `score`, `maxScore`, `percentage`, `itemResults`, `responses`, `attemptNumber`, `attemptId`, `assessmentRevisionId`, and every ownership field) is refused with `assessmentAttempts.invalidRequest`. Missing or non-URL-safe `sessionId` is refused with `assessmentAttempts.invalidSessionId`. Missing or non-URL-safe `idempotencyKey` is refused with `assessmentAttempts.invalidIdempotencyKey`.
4. Opens a Firestore transaction through `runFirestoreTransaction`.
5. Inside the transaction, reads the session document. A missing session is refused with `assessmentAttempts.sessionNotFound`.
6. Verifies ownership and lifecycle. `studentId` MUST equal caller uid (else `assessmentAttempts.notOwned`). `districtId` MUST match the caller's verified claim (else `district-mismatch`). `schoolId` MUST match the caller's canonical claim (else `assessmentAttempts.forbidden`). `status` MUST equal `live` (else `assessmentAttempts.sessionNotLive`).
7. Idempotency lookup. Queries `attempts` where `studentId == caller && assignmentId == session.assignmentId && idempotencyKey == request.idempotencyKey`, limited to one. If a match exists, returns the existing attempt payload with `replay: true` without writing an attempt and without deleting the session (the session was already deleted on the original commit; a match here means the client is retrying against a previously completed submission).
8. Resolves the revision and answer key from the session's frozen `assessmentRevisionId` per `ASSESSMENT_SCORING_CONTRACT.md` §12.1. A missing revision is refused with `assessmentAttempts.revisionMissing`. A missing answer key is refused with `assessmentAttempts.answerKeyMissing`.
9. Applies the v1 scorer (`scoreAttempt`). Integrity failures (non-v1 `schemaVersion`, empty items, unsupported `itemType`, mismatched item sets, `correctOptionId` not among revision options, non-unit `points`, malformed session response value) each surface `assessmentAttempts.answerKeyIntegrity` or `assessmentAttempts.malformedSession` and leave the session Live.
10. Computes `attemptNumber = count(existing attempts for (studentId, assignmentId)) + 1`. Derives the deterministic identifier `{assignmentId}__{studentId}__a{attemptNumber}`. Refuses with `assessmentAttempts.writeConflict` if the derived identifier collides with an existing document.
11. Writes the canonical `AssessmentAttemptCreationWrite` payload to `attempts/{attemptId}` and deletes the session document. Both writes occur inside the same transaction per §8.
12. On successful commit, emits exactly one `assessment.attemptFinalized` audit event through the shared `writeAuditEvent` helper, carrying `assignmentId`, `classId`, `activityId`, `assessmentId`, `assessmentRevisionId`, `attemptNumber`, `score`, `maxScore`, `percentage`, and `districtId` in the payload. No event is emitted on idempotent replay or on any integrity failure.
13. Returns the certified feedback payload (`attemptId`, `attemptNumber`, `score`, `maxScore`, `percentage`, `itemResults`, `replay`). No raw answer-key material outside `itemResults` (each of whose `correctOptionId` and `explanation` are the permitted per-item fields) crosses the callable boundary.

## 7. Transaction behavior

- The session read, session-idempotency-lookup query, revision read, answer-key read, attempt-collision precheck, attempt-count query, attempt write, and session delete all occur inside a single `runFirestoreTransaction` region. If any read or validation fails, the transaction body throws before the writes are enqueued; no partial commit is possible.
- Reads precede writes per admin-SDK transaction semantics. The scorer runs on the transactional reads and the results are written in the same transaction body.
- Idempotency lookup is a query inside the transaction. A match short-circuits the write path.
- The audit event is emitted after successful commit. Audit is observability of a completed transition and never fabricates a success for a rolled-back transaction (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §24).

## 8. Attempt creation

`attempts/{attemptId}` is written with the following fields:

- Ownership: `studentId`, `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, `activityId`, `assessmentId`, `assessmentRevisionId` (all copied verbatim from the session's frozen ownership fields).
- Ordinal: `attemptNumber` (1-based count of existing attempts for `(studentId, assignmentId)` plus one).
- Scoring: `score`, `maxScore`, `percentage` (each server-computed).
- Responses: `responses` (verbatim from the session).
- Item results: `itemResults` (one entry per answer-key item, in answer-key order; each entry carries the permitted feedback subset).
- Idempotency: `idempotencyKey` (the caller-supplied stable string).
- Timestamp: `submittedAt` (server-stamped via `FieldValue.serverTimestamp()`).

The attempt document is written exactly once. No callable in this slice modifies or deletes an attempt.

## 9. Scoring implementation

Per `ASSESSMENT_SCORING_CONTRACT.md` §9-§11:

- v1 supports exactly one item type (`singleChoice`). Any other `itemType` on a revision item raises an integrity failure.
- Per-item rule: strict case-sensitive string equality between the student's `response` and the answer key's `correctOptionId`. Full credit on match, zero credit otherwise. Unanswered items score zero. A response element whose `itemId` is not in the revision is ignored by the scorer.
- Per-item `points` is required to equal `1` on both the revision and the answer-key item.
- Absolute score is the sum of `pointsEarned` across the answer-key items.
- Maximum score is the sum of item `points` across the answer-key items.
- Percentage is `round((score / maxScore) * 100, 2)` using banker's rounding (round half to even) implemented locally so the result is deterministic across Node runtimes.
- Zero-item answer keys refuse (`assessmentAttempts.answerKeyIntegrity`) rather than divide by zero.
- Deterministic: two invocations against the same session, revision, and answer key produce identical `score`, `maxScore`, `percentage`, and `itemResults`.
- The scorer resolves the revision from the session's frozen `assessmentRevisionId`, never from `assessments/{assessmentId}.currentRevisionId` at scoring time. A test asserts the `revisionDocRef` and `answerKeyDocRef` are called with the session's frozen id.

## 10. Session transition

On successful commit, the session document is deleted in the same transaction that writes the attempt. Post-commit the session is unreachable from `assessmentSessionsAutosave` (which refuses with `assessmentSessions.sessionNotFound`) and from a resume-style read. The lifecycle-enforcement invariants introduced by Slices 1 and 2 continue to hold: no autosave can occur on a session that does not exist. A subsequent begin against the same `(assignmentId, studentId)` pair would collide on the deterministic session identifier unless the session ordinal advances (deferred to a later slice).

## 11. Replay behavior

A retry with the same `idempotencyKey` after a successful commit:

- Finds the existing attempt via the idempotency-lookup query.
- Returns the existing attempt payload with `replay: true`.
- Does not write a second attempt.
- Does not delete the session (already deleted on the original commit).
- Does not emit a second audit event.

A retry with a different `idempotencyKey` after a successful commit fails at the session-existence check because the session was deleted; the caller receives `assessmentAttempts.sessionNotFound`.

## 12. Audit events

Exactly one `assessment.attemptFinalized` audit event is emitted per successful attempt write. The event carries:

- `actorUserId` = caller uid; `actorRole` = `student`.
- `action` = `assessment.attemptFinalized`.
- `targetType` = `attempt`; `targetId` = the deterministic attempt id.
- `schoolId` = caller's canonical claim.
- Payload: `assignmentId`, `classId`, `activityId`, `assessmentId`, `assessmentRevisionId`, `attemptNumber`, `score`, `maxScore`, `percentage`, `districtId`.

No event is emitted on idempotent replay. No event is emitted on any integrity failure or lifecycle refusal. The event is emitted after the transaction commits so a rolled-back scoring failure never produces a successful audit record.

## 13. Structured errors

Distinguishable identifiers used by this slice:

- Request shape: `assessmentAttempts.invalidRequest`, `assessmentAttempts.invalidSessionId`, `assessmentAttempts.invalidIdempotencyKey`.
- Ownership and lifecycle: `assessmentAttempts.sessionNotFound`, `assessmentAttempts.notOwned`, `assessmentAttempts.forbidden`, `assessmentAttempts.sessionNotLive`, `district-mismatch`.
- Revision and answer-key resolution: `assessmentAttempts.revisionMissing`, `assessmentAttempts.answerKeyMissing`.
- Scorer integrity: `assessmentAttempts.answerKeyIntegrity`, `assessmentAttempts.malformedSession`.
- Attempt write: `assessmentAttempts.writeConflict`.
- District context: propagated unchanged from `requireDistrictContext` (`unauthenticated`, `account-inactive`, `claim-stale`, `claim-state-mismatch`, `school-district-mismatch`, `district-unassigned`, `district-mismatch`).
- Role: `role-forbidden` for a non-student caller.

Each identifier maps directly to a category enumerated in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §25. The namespacing prefix (`assessmentAttempts.`) mirrors the Slice 1 and Slice 2 conventions (`assessmentSessions.`) to keep the assessment-pipeline vocabulary distinguishable at the callable boundary.

## 14. Tests added

Thirty-four new Jest cases in `platform/functions/src/assessments/assessment-attempts-finalize.test.ts`. Categories:

- Identifier derivation: canonical `attemptIdFor` composite.
- Successful path: fully correct submission writes the immutable attempt with every field verified; audit event emitted exactly once with the canonical payload.
- Scoring correctness: mixed submission with the correct percentage; some items unanswered with `null` `studentResponse`; all items unanswered scoring zero; response value that matches no option scoring zero; a ghost `itemId` outside the revision ignored by the scorer but persisted verbatim on the attempt's `responses`.
- Idempotency: existing attempt with the same idempotency marker returned unchanged with `replay: true`, no second write, no second audit event.
- Authorization: non-student `role-forbidden`; propagated `unauthenticated`, `account-inactive`, `district-mismatch` from `requireDistrictContext`.
- Request shape: non-object, string, and array payloads refused; every server-owned field refused; missing and malformed `sessionId` refused; missing and malformed `idempotencyKey` refused.
- Ownership and lifecycle: missing session, non-owner caller, cross-district session, cross-school session, archived session each refused with the canonical identifier and no write, no audit.
- Integrity: missing revision, missing answer key, non-v1 `schemaVersion` on either side, mismatched item sets, `correctOptionId` not among revision options, unsupported `itemType`, non-string session response value.
- Revision resolution: the scorer resolves the revision from the session's frozen `assessmentRevisionId`, verified through the ref-ID mock.
- Determinism: two invocations against identical inputs produce identical scoring output.
- Percentage rounding: banker's rounding of 1-of-3 to 33.33.
- Transaction discipline: attempt write and session delete both recorded inside a single transaction invocation; on integrity failure no attempt is written and no audit event is emitted.
- Response payload discipline: the callable response carries exactly the certified feedback subset (`attemptId`, `attemptNumber`, `score`, `maxScore`, `percentage`, `itemResults`, `replay`) and no other key.

All prior Jest tests (both across the assessment surfaces and across the wider platform) are preserved unchanged. The Sprint 11B suite continues to pass with no regressions.

## 15. Validation summary

- `npm run lint`: pass (zero errors, zero warnings).
- `npm run typecheck`: pass (no diagnostics).
- `npm run build`: pass (emit-only compile succeeds).
- `npm test`: pass. 27 suites, 486 tests, 0 failures. The 34 new finalize cases account for the incremental total.
- `git diff --check`: pass. No whitespace or conflict markers introduced.
- `git status --short`: 5 modified TypeScript files under `platform/functions/src/`, 5 new files (3 TypeScript sources, 1 TypeScript test, 1 markdown report), plus this report and the `SPRINT_HISTORY.md` append. No other file changed.
- Em dash check: this report and the sprint-history append contain no em dashes.

## 16. Deferred work

Deferred behind explicit sprint scope, unchanged by this slice:

- `assessmentSessionsResume` (read-only session retrieval).
- `assessmentSessionsSweepExpired` (scheduled archive of expired sessions).
- `assessmentSessionsPurgeArchived` (scheduled purge past the archival window).
- `assessmentSessionsRecover` (administrative recovery of an archived session).
- `assessmentAttemptsGetForStudent` (student-facing attempt list retrieval).
- `assessmentAttemptsGetForTeacher` (teacher-facing attempt drill-down).
- `assessmentRollupsRecomputeAttempt` (Firestore-trigger recompute of `attemptRollups` and `assignmentRollups` on attempt writes).
- `assessmentAnswerKeysAdministrativeRead` (audited administrative read of an answer key).
- Deployment-pipeline integration for `assessments/*`, `assessmentRevisions/*`, and `assessmentAnswerKeys/*` (atomic three-document publication).
- Session ordinal advancement (a new session after archival receives the next ordinal per PDR-026 §12).
- Firestore Security Rules updates for the collections introduced or referenced by this slice.
- Composite index deployment updates for the queries introduced by this slice.
- Legacy `submissions` collection migration (PDR-026 §26).
- Firestore emulator tests per PDR-026 §28.
- Rules-test matrix per PDR-026 §27.
- Any teacher-facing analytics, LMS integration, or app surface changes.

## 17. Certification

Only Sprint 11C Slice 3 was implemented in this session. No other slice was advanced, no architecture document was amended, and no PDR was superseded. No unrelated code was modified. Firestore Rules were not modified. The app was not modified. Assignments, classes, enrollments, LMS, and submissions were not modified. No commit was made.
