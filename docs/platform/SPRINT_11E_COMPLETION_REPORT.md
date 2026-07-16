# Sprint 11E Completion Report

**Date:** 2026-07-16
**Scope:** Certification-remediation sprint closing the residual Important findings surfaced by the Sprint 11D independent follow-up review (I-1, I-2, I-4, I-6, I-7, I-8).
**Anchor decisions:** PDR-025, PDR-026.
**Anchor contracts:** `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `ASSESSMENT_SCORING_CONTRACT.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`.

The certified architecture is preserved. No PDR is added or amended. Firestore Rules, retrieval APIs, dashboards, LMS features, assessment authoring, and app-side surfaces are untouched.

---

## Findings addressed

### I-1. Finalize audit consistency

Resolved by documentation reconciliation. The certified pattern across every callable in `platform/functions/src` emits the audit event as a best-effort post-commit side effect, immediately after the state-transition transaction resolves and only on the success path. This matches the deployed implementation without exception. The reconciliation is now recorded in `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §5 (Audit creation) and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §32.1. The state transition is the authoritative source of truth; the audit sink is observability, not lifecycle. Idempotent replay paths continue to emit no event, preserving the one-event-per-successful-transition invariant.

### I-2. Republication erasing future assessment metadata

Resolved by code. `deployAssessmentRevision` in `platform/functions/src/assessments/assessment-deployment.ts` previously wrote the parent `assessments/{assessmentId}` document with a full-document `tx.set(...)` that would silently erase any field the deployment writer does not own. The write is now `tx.set(..., { merge: true })` so a republication narrows the write to the three deployment-owned fields (`assessmentId`, `activityId`, `currentRevisionId`) and preserves any non-deployment metadata a future revision may add to the parent document. Immutable revision and answer-key documents continue to use `tx.create(...)` (their Sprint 11D immutability guarantee is unchanged). A new Jest case `I-2 (Sprint 11E): republication merges the parent assessment write rather than overwriting future fields` pins the merge option and the deployment-owned field set.

### I-4. Error-vocabulary reconciliation

Resolved by documentation reconciliation. `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §6 now carries the canonical error-vocabulary table matching the exact selectors implemented in `platform/functions/src/shared/errors/https-callable.ts`. The table names every suffix and exact code the mapper recognizes for `unauthenticated`, `permission-denied`, `not-found`, `already-exists`, `invalid-argument`, and the `failed-precondition` conservative default. Canonical platform identifiers remain preserved verbatim on `HttpsError.details.code`. No canonical identifier is renamed. Any future mapper change to add a new suffix MUST update this table in the same slice.

### I-6. Attempt counting optimization

Resolved by documentation reconciliation. The Firebase Admin SDK's `AggregateQuery.count()` is available inside `runTransaction` (verified in `platform/functions/node_modules/@google-cloud/firestore/build/src/transaction.d.ts`, which exports a `Transaction.get(aggregateQuery)` overload returning `Promise<AggregateQuerySnapshot>`). However, substituting the aggregate count for the current `tx.get(query)` snapshot count in `assessmentAttemptsFinalize` would remove the individual attempt documents from the transactional read set that make the monotonic-ordinal derivation free. The snapshot-count pattern is retained. `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §32.2 records the reasoning: deterministic `attemptId = {assignmentId}__{studentId}__a{attemptNumber}` requires an ordinal that is strictly monotonic across concurrent commits, and the snapshot count over the transactional read set couples the ordinal derivation to Firestore's transactional contention detection so a concurrent attempt-write forces a retry against a fresh count. The certified `(studentId, assignmentId)` composite index already serves this query; no new index is required. No behavior change.

### I-7. Persisted attempt response purity

Resolved by documentation reconciliation. The autosave request validator in `platform/functions/src/assessments/assessment-sessions-autosave.ts` already enforces the two-field shape in two independent ways: (1) the top-level element check refuses any key other than `itemId` and `response` (`assessmentSessions.invalidResponses`), which is stricter than a silent strip; and (2) `normalizeResponse` returns an explicit two-field projection `{ itemId, response }` so even if the top-level check were bypassed the persisted shape carries only the canonical fields. The finalize path copies the session `responses` unmodified inside the transaction, so the same two-field guarantee carries through to `attempts/{attemptId}.responses`. Existing Jest coverage already includes `rejects an element that carries an unexpected key` and structural assertions on the persisted write shape. `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §32.3 records the guarantee.

### I-8. Session-ordinal reconciliation

Resolved by documentation reconciliation. The current `sessionOrdinal = 1` implementation is the certified deferral behavior; multi-session ordinal semantics belong to the archived-session lifecycle callables (`assessmentSessionsSweepExpired`, `assessmentSessionsRecover`), which are out of scope for the current pipeline. The Sprint 11D report already noted the deferral; Sprint 11E lifts it into the contract at `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §32.4 so future readers see the deferral in the authoritative document. No behavior change.

### Documentation reconciliation

- `SPRINT_11D_COMPLETION_REPORT.md` receives an appended "Sprint 11E reconciliation" section (prior sections preserved verbatim) that lists which follow-up residuals each finding needed and points forward to this report.
- `SPRINT_HISTORY.md` receives a Sprint 11E entry.
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` receives §32 (Sprint 11E Reconciliations) plus a Change Log entry.
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §5 and §6 are updated to record the audit-write ordering and the canonical error-vocabulary table.

---

## Files created

- `docs/platform/SPRINT_11E_COMPLETION_REPORT.md`

## Files modified

Code:

- `platform/functions/src/assessments/assessment-deployment.ts`
- `platform/functions/src/assessments/assessment-deployment.test.ts`

Docs:

- `docs/platform/SPRINT_11D_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`

---

## Tests added

- `assessments/assessment-deployment.test.ts`
  - `I-2 (Sprint 11E): republication merges the parent assessment write rather than overwriting future fields`
  - Mock transaction `set(...)` signature extended to record the third-argument `options` value so the merge assertion can inspect it. The `txSets` fixture type gained the corresponding optional `options` field. All pre-existing tests continue to pass unchanged (existing assertions read only `.ref` and `.data`).

No tests were added for the documentation-only findings (I-1, I-4, I-6, I-7, I-8).

---

## Validation results

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` (functions) | PASS |
| Typecheck | `npm run typecheck` (functions) | PASS |
| Build | `npm run build` (functions) | PASS |
| Jest suite | `npm test` (functions) | PASS |
| Diff whitespace | `git diff --check` | PASS |
| Em-dash sweep | `grep -R "U+2014" docs/platform/SPRINT_11E_COMPLETION_REPORT.md docs/platform/SPRINT_HISTORY.md` | PASS (0 hits) |

Concrete Jest totals are recorded in the terminal report accompanying this sprint.

No commit was created.

---

## Remaining backend findings

None. Every Important finding surfaced by the Sprint 11D independent follow-up review has been resolved either by the smallest architecture-conforming code correction (I-2) or by documentation reconciliation against the deployed pattern (I-1, I-4, I-6, I-7, I-8).

Minor findings and out-of-scope surfaces recorded in the Sprint 11D report (Firestore Rules amendments, retrieval APIs, dashboards, session ordinal redesign beyond the current single-ordinal implementation, deployment automation enhancements, LMS client-side surfaces, and unrelated documentation reconciliations) remain deferred to their appropriate future scope.

---

## Scope confirmation

Only Sprint 11E certification-remediation work was performed. No new feature, no new PDR, no new callable, no new Firestore collection, no rules change, no rename of any canonical identifier, and no touch of retrieval APIs, LMS, dashboards, workspace, or app code. The single behavioral change is the narrowed parent-assessment write in `deployAssessmentRevision`; every other change is documentation reconciliation. No commit was made.
