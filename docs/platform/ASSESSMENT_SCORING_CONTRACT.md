# LyfeLabz Assessment Scoring Contract

**Status:** Canonical. Ratified as the v1 scoring specification for the LyfeLabz assessment pipeline.

**Sprint anchor:** Sprint 11C Pre-3 (architecture only).

**Precedence.** This contract is subordinate to `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (PDR-026) and to `ASSESSMENT_PIPELINE_SPECIFICATION.md` (PDR-021). It resolves the shape-level ambiguity those documents left open by fixing the v1 answer-key document shape, the v1 revision document shape, the v1 response representation, and the v1 scoring rule. Nothing in this contract widens, narrows, or reinterprets PDR-021 or PDR-026.

---

## 1. Purpose

The certified assessment architecture defines how sessions become attempts, who owns each collection, which callable is the sole writer of `attempts/*`, and how answer keys are protected. It does not define what an item looks like inside `assessmentRevisions/{revisionId}`, what an answer key looks like inside `assessmentAnswerKeys/{revisionId}`, what a student response looks like on the wire and on the session, or how the scorer decides that a response is correct.

Sprint 11C Slice 3 was halted because those shapes were not yet canonical. This document fixes them. Its sole purpose is to allow Sprint 11C Slice 3 (the `assessmentAttemptsFinalize` callable and its scorer) to be implemented without a further architectural decision.

This contract records the LyfeLabz v1 scoring architecture. It is deliberately narrow. Every item type, response representation, and scoring rule not enumerated here is out of scope for v1 and requires a superseding Platform Decision Record before it may be implemented.

## 2. Relationship to PDR-026

PDR-026 (Assessment Implementation Contract) is preserved without amendment. This contract is the shape-level companion to PDR-026 sub-decisions PDR-026d and PDR-026e:

- **PDR-026d** requires that answer keys live only in `assessmentAnswerKeys/{revisionId}` and are read only by the scorer at request time. This contract fixes the shape of that document for v1.
- **PDR-026e** requires that assessment revisions are platform-owned, monotonic, immutable after publication, and never surface to teachers. This contract fixes the scorable-content shape of that document for v1.

The following PDR-026 sub-decisions apply to this contract without restatement: PDR-026a (attempt is the sole authoritative record), PDR-026b (sessions and attempts are distinct collections), PDR-026c (`assessmentAttemptsFinalize` is the sole writer of `attempts/*`), PDR-026f (rollups own the read path), PDR-026g (district enforcement is additive), PDR-026h (audit vocabulary is fixed), PDR-026i (Practice Mode is client-only).

The following certified statements are inherited without change:

- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §11 (Firestore Collection Ownership), §12 (Canonical Document Identifiers), §14 (Immutable versus Mutable Records), §15 (Answer Key Ownership), §16 (Assessment Publication Relationship), and §22 (Firestore Security Rules Contract).
- `ASSESSMENT_PIPELINE_SPECIFICATION.md` §11 (Server-authoritative scoring), §14 (Attempt shape), §15 (Assessment Revision Strategy), and §16 (Curriculum Governance).

This contract does not restate those statements. Where a reader needs the certified rule, this contract references it by section.

## 3. Supported Item Types

LyfeLabz v1 supports exactly one assessment item type:

- **Single-answer multiple choice.** The item presents a stem and a fixed, ordered list of options. Exactly one option is the correct answer. The student selects exactly one option per item.

No other item type is supported in v1. In particular, v1 does not support: multi-select multiple choice, ordered-response items, matching items, short-answer items, numeric-response items, drag-and-drop items, rubric-scored items, open-response items, or model-scored items. Any of those requires a future Platform Decision Record that also defines its answer-key shape, its response shape, its comparison rule, and its per-item points behavior. See Section 15.

The scorer MUST refuse to score any item whose declared type is not the v1 type. Unknown item types are an answer-key integrity failure per Section 12.

## 4. `assessmentRevisions/{revisionId}` Document Schema

`assessmentRevisions/{revisionId}` holds the scorable-content shape of an assessment revision. It contains no correct-answer material. It is authored by the deployment pipeline (see Section 13) and is never modified after publication (see Section 6).

### 4.1 Document shape

```
assessmentRevisions/{revisionId} {
  assessmentId: string                       // "assessment_{activityId}"
  revisionOrdinal: number                    // integer >= 1, monotonic per assessmentId
  activityId: string                         // repository activity slug
  itemOrderingRule: "authoredOrder"          // v1 supports only authored order
  items: AssessmentRevisionItem[]            // 1 or more items, ordered
  publishedAt: Timestamp                     // server-stamped at deployment
  publishedBy: string                        // deployment pipeline principal
  schemaVersion: 1                           // canonical schema version, always 1 in v1
}
```

### 4.2 Item shape

Each element of `items` is a `AssessmentRevisionItem`:

```
AssessmentRevisionItem {
  itemId: string                             // stable, unique within this revision
  itemType: "singleChoice"                   // v1 supports only this literal
  stem: string                               // student-visible question text
  options: AssessmentRevisionItemOption[]    // 2 or more options
  points: 1                                  // v1 requires exactly 1 (see Section 9)
}

AssessmentRevisionItemOption {
  optionId: string                           // stable, unique within this item ("A", "B", "C", "D" is the canonical convention)
  text: string                               // student-visible option text
}
```

### 4.3 Invariants

- `revisionId` MUST equal `{assessmentId}__r{revisionOrdinal}` (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §12).
- `assessmentId` MUST equal the paired `assessmentAnswerKeys/{revisionId}.assessmentId`.
- `items` MUST NOT be empty.
- Each `itemId` MUST be unique within `items`.
- Each `optionId` MUST be unique within its item's `options`.
- Every field explicitly listed above is required. No additional fields are permitted at v1.
- `itemOrderingRule` MUST be the literal `"authoredOrder"` in v1. The scorer presents items to the student in `items` array order.
- `schemaVersion` MUST be the numeric literal `1` in v1. A future revision shape MUST bump this integer and MUST be introduced under a superseding PDR.

### 4.4 What this document deliberately does not carry

- No `correctAnswer`, no `correctOptionId`, no `answerKey` field, no per-option `isCorrect` flag. All correct-answer material lives in `assessmentAnswerKeys/{revisionId}` (Section 5).
- No `explanation`, no `distractorRationale`, no `rubric`. Student-visible explanations live in the answer-key document (Section 5) so that answer-key confidentiality (PDR-026d) is not violated by a client read of the revision.
- No teacher-configurable fields. Revisions are platform-owned (PDR-026e).

## 5. `assessmentAnswerKeys/{revisionId}` Document Schema

`assessmentAnswerKeys/{revisionId}` holds the correct-answer material for a revision. It is the load-bearing confidentiality boundary of the pipeline (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §15). Firestore Security Rules refuse all client reads and all client writes for every role including `platformAdministrator`. Only the scorer reads this document at request time.

### 5.1 Document shape

```
assessmentAnswerKeys/{revisionId} {
  assessmentId: string                       // matches the paired revision
  revisionOrdinal: number                    // matches the paired revision
  items: AssessmentAnswerKeyItem[]           // one entry per revision item, same order
  publishedAt: Timestamp                     // server-stamped at deployment
  publishedBy: string                        // deployment pipeline principal
  schemaVersion: 1                           // canonical schema version, always 1 in v1
}
```

### 5.2 Item shape

Each element of `items` is an `AssessmentAnswerKeyItem`:

```
AssessmentAnswerKeyItem {
  itemId: string                             // matches the paired revision item's itemId
  correctOptionId: string                    // one of the paired item's options[*].optionId
  points: 1                                  // v1 requires exactly 1 (see Section 9)
  explanation: string                        // student-visible explanation delivered post-submit
}
```

### 5.3 Pairing invariants (enforced by the deployment pipeline and by the scorer)

- The answer key's `revisionId` MUST equal the paired revision's `revisionId`.
- `assessmentId` and `revisionOrdinal` MUST match the paired revision.
- The set of `itemId` values in the answer key MUST be exactly the set of `itemId` values in the revision. No answer-key item MAY reference an itemId that does not exist in the revision, and no revision item MAY be missing from the answer key.
- For each answer-key item, `correctOptionId` MUST match exactly one of the paired revision item's `options[*].optionId`.
- For each answer-key item, `points` MUST equal the paired revision item's `points`. In v1 both are always `1` (Section 9).
- `schemaVersion` on the answer key MUST equal `schemaVersion` on the paired revision.
- The two documents are always deployed together (Section 13). A revision without a paired answer key MUST NOT exist in Firestore, and the deployment pipeline MUST refuse such a publication.

### 5.4 Confidentiality

- No callable in the assessment pipeline other than `assessmentAttemptsFinalize` and `assessmentAnswerKeysAdministrativeRead` reads this document (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §21).
- The scorer MUST NOT persist `correctOptionId` or `explanation` for items the student did not answer onto the attempt document (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §15).
- The scorer MUST NOT return `correctOptionId` or `explanation` for items the student did not answer in the callable response payload.
- No client asset, no bundled JavaScript, no cached Firestore document, and no URL parameter MAY carry any field from this document.

## 6. Immutable Revision Policy

- Every field of every `assessmentRevisions/{revisionId}` document is immutable after publication (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §14).
- Every field of every `assessmentAnswerKeys/{revisionId}` document is immutable after publication.
- To correct a published revision, deploy a new revision with a new `revisionOrdinal` and a new paired answer key. Both new documents are new records; the prior revision and its paired answer key remain readable so historical attempts remain interpretable (`ASSESSMENT_PIPELINE_SPECIFICATION.md` §15).
- Revisions MUST NOT be deleted while any `attempts/{attemptId}.assessmentRevisionId` references them (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §9). Answer keys MUST NOT be deleted while their paired revision exists.
- `assessments/{assessmentId}.currentRevisionId` is updated by the deployment pipeline when a new revision publishes. Every attempt records the `assessmentRevisionId` it was scored against, which is the revision the session captured at creation (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §7), not the current revision at read time.

## 7. Server-Only Ownership

The v1 scoring model has one trusted producer of a score.

- The sole trusted producer of a score is the `assessmentAttemptsFinalize` Cloud Function scorer (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §21, PDR-026c).
- No browser MAY compute an authoritative score. No callable other than `assessmentAttemptsFinalize` MAY read `assessmentAnswerKeys/*` for scoring purposes.
- The scorer MUST reject any request in which the client attempts to supply a score, an item-level correctness flag, a per-item points value, a correct-answer value, or an explanation. Any such field appearing in the request payload MUST cause a request-shape refusal.
- Student responses persisted through `assessmentSessionsAutosave` are structurally forbidden from carrying any scoring artifact (see Sprint 11C Slice 2 completion report). The scorer inherits that guarantee: the session's `responses` payload never contains a scoring value.
- The scorer MUST NOT invoke a language model, an external API, or a third-party service for v1 scoring. Scoring is a local, deterministic comparison against the answer-key document.

## 8. Student Response Schema

The v1 student response representation is the same shape on the wire, on the session, and on the attempt. This uniformity is deliberate: it lets the same validation layer serve autosave, resume, and finalize without a shape transform.

### 8.1 Element shape

Each response is a single element:

```
AssessmentSessionResponse {
  itemId: string                             // matches an itemId in the session's revision
  response: string                           // v1: the selected optionId (e.g. "A")
}
```

### 8.2 Response value

For the v1 `singleChoice` item type, `response` is the `optionId` of the option the student selected. It is a string. It MUST match exactly one `optionId` in the paired revision item's `options[*].optionId` when the attempt is scored (Section 9). A response that does not match any option is not correct.

### 8.3 Wire and storage invariants

- `responses` is an array of `AssessmentSessionResponse` elements on `assessmentSessions/{sessionId}` (see Sprint 11C Slice 2).
- `responses` is an array of `AssessmentSessionResponse` elements on `attempts/{attemptId}` at the same key. The scorer copies the session's `responses` to the attempt verbatim after validation.
- No element MAY carry any field other than `itemId` and `response`.
- No element MAY carry a scoring artifact key (`isCorrect`, `correctAnswer`, `pointsEarned`, `explanation`, `score`, `correctness`, and any related key). This is enforced at the autosave boundary (Sprint 11C Slice 2) and again at the finalize boundary.
- Duplicate `itemId` values within a single `responses` array are forbidden.
- `response` MUST be a string. v1 does not accept boolean, number, array, object, `null`, or `undefined` values.
- Missing items are permitted (a student may submit without answering every item). See Section 9.

### 8.4 Non-answers

A student who does not answer an item is represented by the absence of that `itemId` from the `responses` array. v1 does not distinguish between "unanswered" and "explicitly cleared" states. A blank `response` string is not permitted at v1; if a UI needs to record "cleared", it removes the element from the array.

## 9. Scoring Algorithm

The scorer is deterministic and local. Given a session and its paired revision and answer key, the score is fully determined.

### 9.1 Per-item scoring rule

For each `AssessmentAnswerKeyItem` in the paired answer key:

1. Look up the matching `AssessmentSessionResponse` in the session's `responses` array by `itemId`.
2. If no response is present for that `itemId`, the item is incorrect. Award zero points. Record correctness as `false`. Record `pointsEarned` as `0`.
3. If a response is present and `response == correctOptionId` (strict string equality), the item is correct. Award full credit. Record correctness as `true`. Record `pointsEarned` as the answer-key item's `points` value (in v1, always `1`).
4. If a response is present and `response != correctOptionId`, the item is incorrect. Award zero points. Record correctness as `false`. Record `pointsEarned` as `0`.

Comparison is case-sensitive strict string equality. The scorer MUST NOT trim, lowercase, normalize whitespace, or apply any locale-aware collation. Option identifiers are canonical strings authored by the deployment pipeline; the student's response is one of them or it is not.

### 9.2 Ignored responses

If the student's `responses` array contains an element whose `itemId` is not present in the paired revision, that element is ignored by the scorer. It does not contribute to the score and it does not cause a scoring failure. It remains on the persisted `attempts/{attemptId}.responses` array unchanged, because attempts are what the student actually submitted.

### 9.3 Determinism

Two invocations of the scorer against the same session, the same revision, and the same answer key MUST produce identical `score`, identical `pointsEarned`, and identical per-item correctness. There is no randomness, no time-of-day dependence, and no external dependency in v1 scoring.

### 9.4 No partial credit, no negative scoring

- Partial credit is not supported in v1. A `singleChoice` item is worth its `points` value in full or zero.
- Negative scoring is not supported in v1. No item MAY subtract from the attempt score.

## 10. Attempt Score Calculation

The attempt-level `score` is the sum of `pointsEarned` across all items in the paired answer key.

### 10.1 Absolute score

```
attempt.score = sum(item.pointsEarned) for item in paired answer key
```

### 10.2 Maximum score

```
attempt.maxScore = sum(item.points) for item in paired answer key
```

In v1, because every item has `points == 1`, `attempt.maxScore == count(items in paired answer key)`.

### 10.3 Attempt fields written by the scorer

The scorer writes the following fields onto `attempts/{attemptId}`, in addition to the ownership and lifecycle fields enumerated in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §7 and §17:

```
attempts/{attemptId} {
  score: number                              // integer, sum of pointsEarned
  maxScore: number                           // integer, sum of item points
  percentage: number                         // see Section 11
  responses: AssessmentSessionResponse[]     // verbatim from the session
  itemResults: AssessmentAttemptItemResult[] // one per answer-key item, in answer-key order
  ...ownership and lifecycle fields (see ASSESSMENT_IMPLEMENTATION_CONTRACT.md §7, §17)
}

AssessmentAttemptItemResult {
  itemId: string                             // matches the answer-key item
  isCorrect: boolean                         // Section 9.1
  pointsEarned: number                       // Section 9.1
  correctOptionId: string                    // the answer-key correctOptionId
  explanation: string                        // the answer-key explanation
  studentResponse: string | null             // the student's response value, or null if unanswered
}
```

### 10.4 Feedback payload

The `assessmentAttemptsFinalize` callable response payload contains: `attemptId`, `attemptNumber`, `score`, `maxScore`, `percentage`, and `itemResults` (per Section 10.3). The response payload MUST NOT contain any answer-key material for items the student did not answer beyond what the certified feedback payload permits (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §15). In v1 the scorer delivers `correctOptionId` and `explanation` for every item, including unanswered items, because the certified feedback contract at `ASSESSMENT_PIPELINE_SPECIFICATION.md` §11.1 delivers correct answers and explanations for items the student answered; unanswered items receive the same feedback shape so the student can learn from what they left blank, subject to a future PDR narrowing that behavior.

## 11. Percentage Calculation

The attempt-level `percentage` is a real number in the closed interval `[0, 100]` computed at scoring time and persisted onto the attempt.

### 11.1 Formula

```
attempt.percentage =
  (attempt.maxScore == 0) ? 0 : round((attempt.score / attempt.maxScore) * 100, 2)
```

The scorer rounds to two decimal places using banker's rounding (round half to even) to remain deterministic across runtimes.

### 11.2 Zero-item guard

If `attempt.maxScore` is zero (an empty answer key, which the deployment pipeline MUST refuse per Section 5.3 and Section 13), the scorer MUST refuse to write the attempt. It emits an answer-key integrity failure (Section 12) and leaves the session Live. This guard exists so that a defensive division against a corrupted payload cannot produce an interpretable-looking `percentage` value.

### 11.3 Persisted on the attempt

`attempt.percentage` is written once at attempt creation and is immutable thereafter (attempts are immutable, `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §14). The rollup Cloud Function reads `attempt.percentage` verbatim and does not recompute it (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §21). No downstream surface (My Results, Improve My Score, teacher analytics) recomputes the percentage.

## 12. Protected Answer-Key Handling

The scorer's interaction with the answer key is the load-bearing security boundary of the pipeline.

### 12.1 Read boundary

- The scorer reads `assessmentAnswerKeys/{revisionId}` exactly once per scoring request, inside the scoring transaction described in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §8.
- The scorer MUST resolve `revisionId` from the session's frozen `assessmentRevisionId` field (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §6). It MUST NOT resolve the revision from the current `assessments/{assessmentId}.currentRevisionId` at scoring time, because that value MAY have advanced since session creation.
- The scorer MUST NOT log the answer-key document, MUST NOT emit it in an error message, and MUST NOT include it in any observability payload.

### 12.2 Integrity failures

The scorer MUST refuse to write an attempt and MUST leave the session Live if any of the following integrity failures are detected:

- The paired answer key does not exist for the session's `assessmentRevisionId`.
- The answer key's `schemaVersion` is not `1`.
- The answer key's `items` array is empty.
- An answer-key item's `correctOptionId` does not match any `optionId` in the paired revision item's `options`.
- The set of `itemId` values in the answer key does not equal the set of `itemId` values in the revision.
- An answer-key item's `points` is not the numeric literal `1`.
- The paired revision does not exist for the session's `assessmentRevisionId`.
- The paired revision's `schemaVersion` is not `1`.
- A revision item's `itemType` is not the v1 literal `"singleChoice"`.

Each integrity failure surfaces a distinguishable error identifier (Section 16). The session is not consumed. The student may retry submission after the deployment pipeline republishes a corrected revision and answer-key pair.

### 12.3 Response leakage prohibitions

- The scorer MUST NOT include the answer-key document in any Firestore write. The `attempts/{attemptId}.itemResults` array carries the permitted subset (Section 10.3) and nothing more.
- The scorer MUST NOT include the raw answer-key document in the callable response payload. The response payload carries the feedback shape defined in Section 10.4.
- The scorer MUST NOT return `correctOptionId` or `explanation` for items outside the paired answer key.

### 12.4 Administrative read

The `assessmentAnswerKeysAdministrativeRead` callable (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §21) is the sole authorized non-scorer read path for `assessmentAnswerKeys/*`. It refuses every role except `platformAdministrator` and emits `assessment.answerKeyRead` (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §24). It is not part of the scoring flow.

## 13. Deployment Ownership

The deployment pipeline is the sole writer of `assessments/*`, `assessmentRevisions/*`, and `assessmentAnswerKeys/*` (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §11 and §21). This contract fixes what that pipeline MUST do at the deployment boundary for v1.

### 13.1 Atomic publication

Publication of a new revision writes three documents at the deployment boundary:

1. `assessments/{assessmentId}` (created on first publication, updated on subsequent publications to advance `currentRevisionId`).
2. `assessmentRevisions/{revisionId}`.
3. `assessmentAnswerKeys/{revisionId}`.

All three writes MUST be visible atomically. A revision without a paired answer key MUST NOT be observable to the scorer at any moment. The deployment pipeline MUST use a Firestore batched write or a transaction to satisfy this invariant.

### 13.2 Pipeline-side validation

The deployment pipeline MUST validate the following before publishing:

- The revision document conforms to Section 4.
- The answer-key document conforms to Section 5.
- The pairing invariants in Section 5.3 hold.
- Every revision item is the v1 `singleChoice` type with two or more options and `points == 1`.
- Every answer-key item's `correctOptionId` matches an `optionId` in the paired revision item.
- `revisionOrdinal` is strictly greater than the current `assessments/{assessmentId}.currentRevisionId` ordinal, if any.

A validation failure MUST refuse the entire publication. Partial publication MUST NOT occur.

### 13.3 Retirement

An assessment MAY be retired by the deployment pipeline. Retirement writes `assessments/{assessmentId}.retiredAt` and does not modify any revision or answer-key document. Retired assessments remain scorable for existing sessions (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §16). The scorer MUST NOT treat retirement as a scoring failure.

### 13.4 Deletion is prohibited outside retention

- Deleting `assessments/*`, `assessmentRevisions/*`, or `assessmentAnswerKeys/*` outside the platform's retention policy is prohibited.
- The deployment pipeline MUST NOT delete a revision or its paired answer key while any `attempts/{attemptId}.assessmentRevisionId` references them.

## 14. Versioning

Two version boundaries govern the v1 scoring model.

### 14.1 Schema version

The `schemaVersion` field on `assessmentRevisions/{revisionId}` and on `assessmentAnswerKeys/{revisionId}` is the shape-of-the-document version. In v1 it is always the numeric literal `1`. A future document shape (for example, one that permits multi-select responses or per-item points other than `1`) MUST bump `schemaVersion` and MUST be introduced under a superseding Platform Decision Record.

The scorer MUST refuse a `schemaVersion` value that is not `1` in v1 (Section 12.2). This refusal is a fail-safe: it guarantees that a future schema deployed against a legacy scorer does not silently mis-score.

### 14.2 Revision ordinal

The `revisionOrdinal` field is the content-of-the-assessment version. Ordinals are monotonic per `assessmentId`, start at `1`, and are never reused (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §12). A new revision is created when the change to the assessment content would meaningfully affect scoring or student experience (`ASSESSMENT_PIPELINE_SPECIFICATION.md` §15).

These two version boundaries are independent. A revision bump does not imply a schema bump, and a schema bump does not imply a revision bump on a specific assessment.

### 14.3 Contract version

This document is v1 of the scoring contract. Any change to the scoring rule (Section 9), the response representation (Section 8), the answer-key shape (Section 5), or the revision shape (Section 4) MUST be authorized by a superseding Platform Decision Record and MUST bump this contract's version.

## 15. Future Extension Strategy

The v1 scoring model is intentionally narrow. Extensions are anticipated in `ASSESSMENT_PIPELINE_SPECIFICATION.md` §17 and in the PDR-026 anti-decisions. This section names the extension shape the v1 architecture leaves room for, without authorizing any of them.

### 15.1 Item type extensions

A new item type (multi-select, ordered, matching, short-answer, numeric, drag-and-drop, rubric, open-response, model-scored) requires a superseding Platform Decision Record. The PDR MUST define:

- the item's revision-side shape (extending `AssessmentRevisionItem`),
- the item's answer-key-side shape (extending `AssessmentAnswerKeyItem`),
- the item's response representation on the wire and on the session,
- the item's comparison rule and its per-item points behavior (including partial credit, if any),
- the item's per-item scoring artifact shape on the attempt,
- and the item's `schemaVersion` bump requirements.

New item types are added by extending the item shape's discriminator (`itemType`) rather than by creating a parallel collection.

### 15.2 Variable points

Per-item points other than `1` and partial credit are not supported in v1. A future PDR MAY introduce them by relaxing the `points == 1` invariant on Section 4.2 and Section 5.2, provided the PDR also defines the per-item scoring rule for the new points regime and bumps `schemaVersion`.

### 15.3 Rubrics and model scoring

Rubric-scored items and language-model-scored items are anti-decisions under PDR-026. Any addition requires a superseding PDR that also defines the validation posture for the scoring output (`ASSESSMENT_PIPELINE_SPECIFICATION.md` §17).

### 15.4 Response-shape uniformity

Future item types SHOULD preserve the `{itemId, response}` element shape on the wire. Where the response requires a compound value (for example, an ordered list of `optionId` values), the `response` field's type widens to the union of permitted shapes and the per-item-type validator branches on `itemType`. The autosave validator (Sprint 11C Slice 2) is designed to accommodate this widening without a shape transform.

### 15.5 Item ordering rules

`itemOrderingRule` is a fixed literal in v1 to leave room for future orderings (for example, randomized-per-student ordering with a seed persisted on the session). A future PDR that introduces a new ordering rule MUST define how the session captures the effective ordering and how the scorer maps the student's responses back to the answer key.

## 16. Required Implementation Checklist

The following checklist is the acceptance surface for Sprint 11C Slice 3 (and any subsequent implementation slice that lands the v1 scoring model). Each item is a required implementation deliverable. This section does not implement anything; it enumerates what a compliant implementation MUST include.

1. Shared TypeScript types for `AssessmentRevisionItem`, `AssessmentRevisionItemOption`, `AssessmentAnswerKeyItem`, `AssessmentAttemptItemResult`, and the v1 discriminant literals (`"singleChoice"`, `"authoredOrder"`, `schemaVersion: 1`). Types live in `platform/functions/src/shared/types/` alongside the existing assessment session types.
2. Typed Firestore references for `assessments/*`, `assessmentRevisions/*`, and `assessmentAnswerKeys/*`, with narrow read shapes for the scorer and a deployment-write shape for the pipeline (never both on the same reference).
3. Request and response types for `assessmentAttemptsFinalize` that structurally forbid a client-supplied score, item correctness, points earned, correct-answer value, or explanation. Structural refusal is preferred to allow-listing.
4. Scorer implementation that resolves the session's frozen `assessmentRevisionId`, reads the paired revision and answer-key documents, applies the Section 9 rule per item, computes the Section 10 attempt-level totals, computes the Section 11 percentage, and writes the attempt and the Section 10.3 fields inside the certified scoring transaction.
5. Integrity-failure branches for each condition listed in Section 12.2, each surfacing a distinguishable error identifier consistent with `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22.
6. Idempotent finalize per PDR-026c and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §8: a retry with the same idempotency marker returns the existing attempt payload without a second write and without a second audit event.
7. Session-to-attempt transactional handoff per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §8: the session is deleted in the same transaction that writes the attempt.
8. Response-validation reuse: the finalize handler MUST reuse the Sprint 11C Slice 2 response validator so the autosave-boundary and finalize-boundary guarantees are identical. The finalize handler MUST additionally verify that every `itemId` in the incoming responses (if any) is present in the paired revision.
9. Audit-event emission of exactly one `assessment.attemptFinalized` event per successful attempt, per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §24.
10. Rollup trigger and read-path plumbing per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §21. The rollup MUST read `attempt.percentage` verbatim (Section 11.3).
11. Firestore Security Rules for `assessmentRevisions/*` (server, teacher preview) and `assessmentAnswerKeys/*` (server only), per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22. Answer-key reads are refused for every client role.
12. Deployment pipeline integration for `assessments/*`, `assessmentRevisions/*`, and `assessmentAnswerKeys/*` that writes the three documents atomically at the deployment boundary and refuses to publish a revision without a paired answer key (Section 13).
13. Composite Firestore indexes as required by the scorer's revision and answer-key reads (both are single-document reads by identifier, so no composite index is required in v1; the index review MUST confirm this).

## 17. Required Testing Checklist

The following checklist is the acceptance surface for Jest coverage of the v1 scoring model.

1. **Scoring correctness.** For each of these input shapes, the scorer produces the expected `score`, `maxScore`, `percentage`, and per-item `itemResults`:
   - All items correct.
   - All items incorrect.
   - Mixed correct and incorrect.
   - One or more items unanswered.
   - All items unanswered.
   - A response whose value matches no option in the paired revision.
   - A response element whose `itemId` is not present in the paired revision (Section 9.2).
2. **Determinism.** Two scorer invocations against the same session, revision, and answer key produce byte-identical `attempts/{attemptId}` documents (modulo the server-stamped timestamps).
3. **Idempotency.** A retry with the same idempotency marker after a successful attempt returns the existing attempt payload, writes no second document, and emits no second audit event.
4. **Answer-key confidentiality.** The scorer's Firestore reads include `assessmentAnswerKeys/{revisionId}` exactly once. No other callable reads that collection in the finalize flow. The callable response payload contains no answer-key material beyond the Section 10.4 permitted subset. No test log captures the answer-key document.
5. **Answer-key integrity failures.** Each condition in Section 12.2 produces the expected error identifier, does not write an attempt, does not delete the session, and does not emit `assessment.attemptFinalized`.
6. **Revision resolution.** The scorer resolves the revision from the session's frozen `assessmentRevisionId`, not from the current `assessments/{assessmentId}.currentRevisionId`. A test in which the current revision has advanced since session creation MUST score against the session's frozen revision.
7. **Percentage boundaries.** `percentage` is `0` for zero correct, is `100` for all correct, and rounds to two decimals for intermediate values. A hypothetical `maxScore == 0` input refuses per Section 11.2.
8. **Response validation.** The finalize handler refuses a request that carries a scoring artifact on any response element, refuses duplicate `itemId` values, refuses non-string `response` values, refuses missing `itemId`, and refuses per-element malformed shapes. Coverage mirrors the Sprint 11C Slice 2 autosave coverage.
9. **Ownership and lifecycle refusals.** The finalize handler refuses non-owner callers, cross-district callers, cross-school callers, archived sessions, and missing sessions with the canonical error identifiers.
10. **District boundary.** The finalize handler routes through `requireDistrictContext` and produces the four canonical district refusals consistent with the other assessment callables.
11. **Audit event.** Exactly one `assessment.attemptFinalized` event is emitted per successful attempt. No event is emitted on integrity failure. No event is emitted on idempotent replay.
12. **Attempt immutability.** After finalize succeeds, subsequent writes to `attempts/{attemptId}` are refused by Firestore Rules. The rollup Cloud Function's read of `attempt.percentage` is byte-equal to the scorer's write.
13. **Answer-key confidentiality regression.** A separate rules test confirms that no client role, including `platformAdministrator`, can read `assessmentAnswerKeys/*` directly.
14. **Deployment pipeline validation.** Unit coverage of the deployment-side validator refuses each Section 5.3 pairing violation, each Section 4.3 revision-shape violation, and each Section 13.2 pairing-vs-current-revision violation.

## 18. Reconciliation

The following certified documents are read by, but not modified by, this contract:

- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-021, PDR-026). No decision is amended. This contract is the shape-level companion to PDR-026d and PDR-026e; a reconciliation note is appropriate at PDR-026's next revision so that the decision record cites this contract as the canonical scoring shape.
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (Sprint 10A F-2). The contract's Section 11 collection-ownership table already names `assessmentRevisions/{revisionId}` as carrying "item stems, choices where applicable, ordering rule, item points" and `assessmentAnswerKeys/{revisionId}` as carrying "correct answers, rubrics, per-item points, explanations, distractor rationales". The v1 shape defined here is a strict subset (no rubrics, no distractor rationales in v1). A reconciliation note is appropriate at the next revision so §11 cites this contract for the v1 shape.
- `ASSESSMENT_PIPELINE_SPECIFICATION.md` (PDR-021). §11.1, §14, §15, and §17 remain authoritative for their respective concerns. The v1 scoring rule in Section 9 of this contract is the concrete instantiation of the pipeline spec's server-authoritative scoring principle; no pipeline-spec statement is altered.
- `SPRINT_11A_IMPLEMENTATION_INVENTORY.md`. The inventory catalogs the pre-Sprint 11C state. This contract does not modify the inventory; it becomes referenced material for the Sprint 11C Slice 3 completion report.

No behavior is changed by this contract. It only eliminates ambiguity in the certified architecture so Sprint 11C Slice 3 can proceed. If any future edit to a certified document conflicts with this contract, the conflict is resolved in favor of the certified document and a superseding PDR is required to change the scoring shape.
