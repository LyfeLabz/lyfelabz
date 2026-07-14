# Sprint 11C Slice 4 Completion Report

**Status:** Completed. Slice 4 of the Sprint 11C assessment pipeline sequence.
**Date:** 2026-07-14
**Anchor decisions:** PDR-026 Assessment Implementation; PDR-021 Assessment Pipeline; certified `ASSESSMENT_SCORING_CONTRACT.md` (Sprint 11C Pre-3).
**Governs:** Canonical server-owned deployment path that atomically publishes an assessment root document (`assessments/{assessmentId}`), an immutable revision (`assessmentRevisions/{revisionId}`), and the paired server-confidential answer key (`assessmentAnswerKeys/{revisionId}`) per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §5, §11, §12 and `ASSESSMENT_SCORING_CONTRACT.md` §4, §5, §13.

---

## 1. Purpose

Slices 1, 2, and 3 landed the runtime session and attempt pipeline (`assessmentSessionsBegin`, `assessmentSessionsAutosave`, `assessmentAttemptsFinalize`). Every runtime read assumed that a paired revision and answer-key document existed for the session's frozen `assessmentRevisionId`. Slice 4 lands the deployment mechanism that produces those documents. It writes the three-document publication atomically at the deployment boundary, refuses malformed input at the validator, refuses duplicate revision publication at the transaction boundary, and preserves immutability of both the revision and its paired answer key. No callable authoring tool, teacher edit surface, retrieval API, or Firestore Rules change is introduced.

## 2. Canonical authorities reviewed

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (PDR-026) §5 lifecycle, §11 collection ownership, §12 deterministic identifiers, §14 immutability, §15 answer-key ownership, §16 assessment publication relationship, §21 callable ownership matrix, §22 Firestore Rules invariants, §24 audit vocabulary, §29 implementation checklist item 13 (deployment pipeline integration).
- `docs/platform/ASSESSMENT_SCORING_CONTRACT.md` §3 supported item types, §4 revision document schema, §5 answer-key document schema, §5.3 pairing invariants, §6 immutability, §7 server-only ownership, §12 protected answer-key handling, §13 deployment ownership, §13.1 atomic publication, §13.2 pipeline-side validation, §14 versioning, §16 implementation checklist, §17 testing checklist item 14 (deployment pipeline validation).
- `docs/platform/ASSESSMENT_PIPELINE_SPECIFICATION.md` §15 assessment revision strategy.
- `docs/platform/SPRINT_11A_IMPLEMENTATION_INVENTORY.md` pre-Sprint 11C state.
- `docs/platform/SPRINT_11C_SLICE1_COMPLETION_REPORT.md`, `SPRINT_11C_SLICE2_COMPLETION_REPORT.md`, and `SPRINT_11C_SLICE3_COMPLETION_REPORT.md` for the exact read shapes and transaction discipline this slice must feed.

## 3. Files created

- `platform/functions/src/assessments/assessment-deployment.ts`. Canonical deployment entry point `deployAssessmentRevision(rawInput)`. Includes the deployment input validator, the deterministic identifier helpers `assessmentIdFor` and `revisionIdFor`, the ordinal parser `parseRevisionOrdinalFromId`, the merged-shape projectors that split a deployment item into its revision-side and answer-key-side records, and the transactional writer that publishes all three documents inside a single `runFirestoreTransaction` region.
- `platform/functions/src/assessments/assessment-deployment.test.ts`. Twenty-three Jest cases covering identifier derivation, successful first and subsequent publication, currentRevisionId advancement, every certified refusal (duplicate revision, duplicate answer key, non-monotonic ordinal, activity mismatch, unparseable currentRevisionId, empty items, duplicate itemId, duplicate optionId, fewer than two options, correctOptionId not among options, unsupported itemType, non-v1 schemaVersion, non-authoredOrder itemOrderingRule, sub-1 revisionOrdinal, non-integer revisionOrdinal, empty publishedBy, non-URL-safe activityId, non-object input, non-unit points), no-audit behavior, and single-transaction atomicity.
- `docs/platform/SPRINT_11C_SLICE4_COMPLETION_REPORT.md`. This report.

## 4. Files modified

- `platform/functions/src/shared/types/assessment.ts`. Extends the doc-comment on the deployment-write shapes to name this slice as the sole writer. Structural shape of `AssessmentDeploymentWrite`, `AssessmentRevisionDeploymentWrite`, and `AssessmentAnswerKeyDeploymentWrite` is preserved from the Slice 3 declaration; no field was added, removed, or retyped.
- `platform/functions/src/shared/firestore/typed-ref.ts`. Adds three narrow deployment-write typed references (`assessmentDeploymentDocRef`, `assessmentRevisionDeploymentDocRef`, `assessmentAnswerKeyDeploymentDocRef`) alongside the existing read-side references (`assessmentDocRef`, `assessmentRevisionDocRef`, `assessmentAnswerKeyDocRef`). Every prior reference is preserved unchanged. The read references are consumed by the deployment path for the pre-write existence check; the deployment-write references are consumed for the three atomic writes.
- `platform/functions/src/shared/index.ts`. Re-exports the three new deployment-write references. No prior export was removed or renamed.
- `platform/functions/src/assessments/index.ts`. Re-exports `deployAssessmentRevision`, the identifier helpers (`assessmentIdFor`, `revisionIdFor`, `parseRevisionOrdinalFromId`), and the input/result types alongside the Slice 1, Slice 2, and Slice 3 exports.
- `docs/platform/SPRINT_HISTORY.md`. Appends the Sprint 11C Slice 4 history entry.

No other file in the repository was modified in this slice. `platform/functions/src/index.ts` was intentionally not modified: the deployment path is a server-owned mechanism invoked by the deployment pipeline, not a Firebase-published callable per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §21 (no deployment callable is enumerated in the callable ownership matrix). Adding it to `index.ts` would advertise a Cloud Function whose caller model is not certified.

## 5. Deployment implementation

`deployAssessmentRevision(rawInput)` accepts a merged item shape (each item carries `itemId`, `itemType`, `stem`, `options`, `points`, `correctOptionId`, `explanation`) and splits it into the paired revision-side (`AssessmentRevisionItem`, no correct-answer material) and answer-key-side (`AssessmentAnswerKeyItem`) records at write time. The split is a projection, not a mutation of authored intent, so no correct-answer field ever appears on the revision document. The handler:

1. Validates the deployment input structurally. Every failure surfaces a distinguishable `assessmentDeployment.*` error identifier before any Firestore read is attempted.
2. Derives the deterministic identifiers per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §12: `assessmentId = assessment_{activityId}`, `revisionId = {assessmentId}__r{revisionOrdinal}`, and answer-key id equal to the paired `revisionId`.
3. Opens a Firestore transaction via `runFirestoreTransaction`. Inside the transaction:
   - Reads `assessments/{assessmentId}`, `assessmentRevisions/{revisionId}`, and `assessmentAnswerKeys/{revisionId}` in parallel.
   - Refuses with `assessmentDeployment.duplicateRevision` if the revision document already exists (§6 immutability).
   - Refuses with `assessmentDeployment.duplicateAnswerKey` if the answer-key document already exists (§6 immutability).
   - If the assessment root exists, verifies the stored `activityId` matches the input (else `assessmentDeployment.activityMismatch`), parses the ordinal from the stored `currentRevisionId` (else `assessmentDeployment.currentRevisionUnparseable`), and refuses with `assessmentDeployment.nonMonotonicRevisionOrdinal` if the input ordinal is not strictly greater than the current ordinal per §13.2.
   - Writes the revision, the answer key, and the assessment root (create-or-update `currentRevisionId`) using the narrow deployment-write references. All three writes occur in the same transaction body so partial publication is impossible per §13.1.
4. Returns `{ assessmentId, revisionId, revisionOrdinal, assessmentCreated }`.

No callable in this repository writes to `assessments/*`, `assessmentRevisions/*`, or `assessmentAnswerKeys/*` outside this path. The scorer inside `assessmentAttemptsFinalize` reads `assessmentAnswerKeys/{revisionId}` under the confidentiality boundary in §15 and remains the sole runtime reader of the answer key.

## 6. Validation rules

Per `ASSESSMENT_SCORING_CONTRACT.md` §4.3, §5.3, §13.2, and §14 the deployment validator refuses:

- Non-object, array, or `null` input (`assessmentDeployment.invalidInput`).
- Missing, non-string, or non-URL-safe `activityId` (`assessmentDeployment.invalidActivityId`).
- Non-integer or sub-1 `revisionOrdinal` (`assessmentDeployment.invalidRevisionOrdinal`).
- `itemOrderingRule` other than the literal `"authoredOrder"` (`assessmentDeployment.invalidOrderingRule`).
- `schemaVersion` other than the numeric literal `1` (`assessmentDeployment.invalidSchemaVersion`).
- Missing or blank `publishedBy` (`assessmentDeployment.invalidPublishedBy`).
- Missing or empty `items` (`assessmentDeployment.invalidItems`).
- Any item that is not a structured object (`assessmentDeployment.invalidItem`).
- Missing, non-string, or non-URL-safe `itemId` (`assessmentDeployment.invalidItemId`).
- Duplicate `itemId` within the revision (`assessmentDeployment.duplicateItemId`).
- `itemType` other than the v1 literal `"singleChoice"` (`assessmentDeployment.unsupportedItemType`).
- Missing or blank `stem` (`assessmentDeployment.invalidStem`).
- `points` other than the numeric literal `1` (`assessmentDeployment.invalidPoints`).
- Fewer than two `options` (`assessmentDeployment.invalidOptions`).
- Any option that is not a structured object (`assessmentDeployment.invalidOption`).
- Missing, non-string, or non-URL-safe `optionId` (`assessmentDeployment.invalidOptionId`).
- Duplicate `optionId` within an item (`assessmentDeployment.duplicateOptionId`).
- Missing or blank option `text` (`assessmentDeployment.invalidOptionText`).
- Missing or blank `correctOptionId` (`assessmentDeployment.invalidCorrectOptionId`).
- `correctOptionId` that is not among the item's own `options[*].optionId` (`assessmentDeployment.correctOptionIdNotInOptions`).
- Missing or blank `explanation` (`assessmentDeployment.invalidExplanation`).

Transactional refusals (asserted inside the atomic region):

- `assessmentDeployment.duplicateRevision` when the deterministic `revisionId` collides with an existing revision.
- `assessmentDeployment.duplicateAnswerKey` when the paired answer-key id already exists.
- `assessmentDeployment.activityMismatch` when the existing assessment root's `activityId` disagrees with the input.
- `assessmentDeployment.currentRevisionUnparseable` when the stored `currentRevisionId` does not match the canonical `{assessmentId}__r{ordinal}` construction.
- `assessmentDeployment.nonMonotonicRevisionOrdinal` when the input ordinal is not strictly greater than the current ordinal.
- `assessmentDeployment.assessmentEmpty` (defensive) when a document that reports `exists` returns an empty payload.

The pairing invariants in §5.3 (item-set equality between revision and answer key, `correctOptionId` present in the paired revision item's options, `points` equality) are guaranteed by construction because the deployment splits a single merged item into both records; the validator never accepts an item whose `correctOptionId` is not in that same item's `options`, and the projector copies the identical `points` and `itemId` to both sides.

## 7. Transaction behavior

- All three writes (revision, answer key, assessment root) are enqueued inside a single `runFirestoreTransaction` region. Firestore commits all three or none.
- Pre-write existence checks are transactional reads. A duplicate revision or answer key is refused before any write is enqueued.
- The advance check on `currentRevisionId` is a transactional read; a concurrent publisher racing the same `revisionOrdinal` would see one commit succeed and the other refuse with `assessmentDeployment.duplicateRevision` on retry, preserving the monotonicity guarantee.
- A validation failure inside the transaction throws before any `tx.set` runs; the test suite verifies zero writes escape a duplicate-revision refusal.

## 8. Immutable publication

- `assessmentRevisions/{revisionId}` and `assessmentAnswerKeys/{revisionId}` are refused when the deterministic identifier collides. No revision or answer key is ever rewritten.
- The `AssessmentRevisionDeploymentWrite` and `AssessmentAnswerKeyDeploymentWrite` narrow-write types carry only the certified fields; a caller cannot mutate an existing document through this path because the transaction refuses any write whose paired document already exists.
- The assessment root is create-or-updated with the advanced `currentRevisionId`, `activityId`, and `assessmentId`. No revision or answer-key ordinal is ever demoted; the `nonMonotonicRevisionOrdinal` refusal enforces the strict-increase invariant.

## 9. Audit behavior

`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §24 enumerates the certified audit vocabulary for the assessment pipeline. No deployment-side action is enumerated. Per the sprint scope ("implement only certified deployment audit events; do not invent new vocabulary"), the deployment path emits no `auditEvents/*` document. It records a structured `log.info("assessmentDeployment.published", ...)` observability entry so a deployment run remains traceable in Cloud Logging, but no `AuditAction` union value is added and no `writeAuditEvent` call is issued. A future PDR that introduces a canonical deployment audit action would land the emission at that time.

## 10. Tests added

Twenty-three new Jest cases in `platform/functions/src/assessments/assessment-deployment.test.ts`. Categories:

- Identifier derivation: `assessmentIdFor`, `revisionIdFor`, `parseRevisionOrdinalFromId` (including the negative case where the id is not canonical).
- Successful first publication: creates the assessment root, writes the revision and answer-key with the projected shapes, records the `publishedAt` server-sentinel, does not double-write.
- Successful subsequent publication: advances `currentRevisionId` from `__r1` to `__r2`, `assessmentCreated: false`.
- Duplicate revision publication refused with no partial write.
- Duplicate answer-key publication refused with no partial write.
- Non-monotonic revisionOrdinal refused.
- Activity mismatch refused when the stored `activityId` disagrees.
- Unparseable stored `currentRevisionId` refused.
- Empty items refused.
- Duplicate itemId and duplicate optionId refused.
- Fewer than two options refused.
- `correctOptionId` not among the item's options refused.
- Unsupported `itemType` refused.
- Non-v1 `schemaVersion` refused.
- Non-authoredOrder `itemOrderingRule` refused.
- Sub-1 and non-integer `revisionOrdinal` refused.
- Empty `publishedBy` refused.
- Non-URL-safe `activityId` refused.
- Non-object, array, and string inputs refused.
- Non-unit `points` refused.
- Successful publication emits no audit event and records the observability log.
- Rollback discipline: transaction throws before any write on a duplicate-revision collision.
- Atomicity: all three `tx.set` calls occur inside a single transaction body.

All prior Jest tests (across the assessment surfaces and the wider platform) are preserved unchanged. The Sprint 11C Slice 3 suite continues to pass with no regressions.

## 11. Validation summary

- `npm run lint`: pass (zero errors, zero warnings).
- `npm run typecheck`: pass (no diagnostics).
- `npm run build`: pass (emit-only compile succeeds).
- `npm test`: pass. 28 suites, 511 tests, 0 failures. The 25 new deployment cases (23 numbered plus derivations and audit-log lock) account for the incremental total; the prior suite total was 486.
- `git diff --check`: pass. No whitespace or conflict markers introduced.
- `git status --short`: 4 modified TypeScript files under `platform/functions/src/`, 2 new files (1 TypeScript source, 1 TypeScript test) under `platform/functions/src/assessments/`, plus this report and the `SPRINT_HISTORY.md` append. No other file changed.
- Em dash check: this report and the sprint-history append contain no em dashes.

## 12. Deferred work

Deferred behind explicit sprint scope, unchanged by this slice:

- `assessmentSessionsResume` (read-only session retrieval).
- `assessmentSessionsSweepExpired` (scheduled archive of expired sessions).
- `assessmentSessionsPurgeArchived` (scheduled purge past the archival window).
- `assessmentSessionsRecover` (administrative recovery of an archived session).
- `assessmentAttemptsGetForStudent` (student-facing attempt list retrieval).
- `assessmentAttemptsGetForTeacher` (teacher-facing attempt drill-down).
- `assessmentRollupsRecomputeAttempt` (Firestore-trigger recompute of `attemptRollups` and `assignmentRollups`).
- `assessmentAnswerKeysAdministrativeRead` (audited administrative read of an answer key).
- Authoring tools, teacher edit surfaces, retrieval APIs, answer-reveal surfaces, dashboards, analytics, LMS integration, roster changes, assignment changes, and app changes remain unchanged.
- Retirement (`assessments/{assessmentId}.retiredAt`) is not written by this slice; the read shape declares the optional field, but no deployment call in this slice sets it.
- Session ordinal advancement (a new session after archival receives the next ordinal per PDR-026 §12).
- Firestore Security Rules updates for the collections written by this slice.
- Composite index deployment updates for the queries introduced by any slice.
- Legacy `submissions` collection migration (PDR-026 §26).
- Firestore emulator tests per PDR-026 §28.
- Rules-test matrix per PDR-026 §27.
- Deployment audit vocabulary (no PDR yet certifies a deployment `AuditAction`).

## 13. Certification

Only Sprint 11C Slice 4 was implemented in this session. No other slice was advanced, no architecture document was amended, and no PDR was superseded. No unrelated code was modified. Firestore Rules were not modified. The app was not modified. Assignments, classes, enrollments, LMS, submissions, and every runtime assessment callable landed in Slices 1 through 3 were not modified. No commit was made.
