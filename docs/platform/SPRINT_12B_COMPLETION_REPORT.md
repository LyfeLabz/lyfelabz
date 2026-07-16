# Sprint 12B Slice 1 Completion Report: Assessment Firestore Rules

**Date:** 2026-07-16
**Status:** CERTIFIED: Sprint 12B is complete.
**Anchor decisions:** PDR-025 (District Security Boundary), PDR-026 (Assessment Implementation Contract).
**Anchor blueprint:** `docs/platform/SPRINT_12A_ASSESSMENT_DATA_ACCESS_REVIEW.md`.

## 1. Sprint objective

Translate the certified Sprint 12A access model into Firestore Rules for the five canonical assessment collections, preserve the Sprint 11 backend, keep every assessment mutation function-owned, protect answer keys explicitly, and enforce ownership plus district isolation for client reads. Add focused Rules tests covering only this slice. Do not commit.

## 2. Scope implemented

The following five collection match blocks were added to `platform/firebase/firestore.rules`:

- `assessments/{assessmentId}`
- `assessmentRevisions/{revisionId}`
- `assessmentAnswerKeys/{revisionId}`
- `assessmentSessions/{sessionId}`
- `attempts/{attemptId}`

Three small stateless helper functions were added alongside the existing `isSignedIn` and `isSelf` helpers.

Four new Rules-test files were added to `platform/firebase/tests/`, mirroring the naming and structure of the existing per-collection test suites.

No Cloud Functions, application, schema, configuration, or dependency file was changed.

## 3. Files reviewed

- `docs/platform/SPRINT_12A_ASSESSMENT_DATA_ACCESS_REVIEW.md`
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/ASSESSMENT_SCORING_CONTRACT.md`
- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` (PDR-025, PDR-026)
- `docs/platform/SPRINT_HISTORY.md`
- `platform/firebase/firestore.rules`
- `platform/firebase/tests/setup.ts`
- `platform/firebase/tests/submissions.rules.test.ts`
- `platform/firebase/tests/default-deny.rules.test.ts`
- `platform/functions/src/shared/types/assessment-session.ts`
- `platform/functions/src/shared/types/attempt.ts`
- `platform/functions/src/shared/types/assessment.ts`
- `platform/functions/src/shared/auth/claims.ts`
- `platform/functions/src/assessments/`
- `platform/functions/src/assignments/`
- `platform/functions/src/classes/`
- `platform/functions/src/enrollments/`
- `platform/functions/src/auth/`

## 4. Files created

- `platform/firebase/tests/assessments.rules.test.ts`
- `platform/firebase/tests/assessment-revisions.rules.test.ts`
- `platform/firebase/tests/assessment-answer-keys.rules.test.ts`
- `platform/firebase/tests/assessment-sessions.rules.test.ts`
- `platform/firebase/tests/attempts.rules.test.ts`
- `docs/platform/SPRINT_12B_COMPLETION_REPORT.md` (this document)

## 5. Files modified

- `platform/firebase/firestore.rules` (five new `match` blocks and three new helper functions added; no existing block was weakened or removed).
- `docs/platform/SPRINT_HISTORY.md` (one concise Sprint 12B Slice 1 entry appended).

## 6. Rules helpers added or reused

Reused (unchanged):

- `isSignedIn()` - returns true when `request.auth != null`.
- `isSelf(uid)` - returns true when the caller is authenticated as the requested uid.

Added (new, narrowly scoped):

- `matchesResourceDistrict()` - true when the caller's verified `districtId` claim is a non-empty string equal to `resource.data.districtId`. Trusts only the signed claim and the immutable district field on the target document.
- `isOwningStudent()` - true when `resource.data.studentId == request.auth.uid`.
- `isOwningTeacher()` - true when `resource.data.teacherId == request.auth.uid`.

None of the new helpers call `get()` or `exists()`. Session and attempt authorization is decidable on the target document alone because ownership and district fields are frozen at creation by the certified backend.

## 7. Exact collection match blocks added

Placed above the existing `auditEvents/{eventId}` block, in the order specified by Sprint 12A §14.2:

```
match /assessments/{assessmentId} {
  allow get: if isSignedIn();
}

match /assessmentRevisions/{revisionId} {
  allow get: if isSignedIn();
}

match /assessmentAnswerKeys/{revisionId} {
  allow read, write: if false;
}

match /assessmentSessions/{sessionId} {
  allow get: if isSignedIn()
    && isOwningStudent()
    && matchesResourceDistrict();
}

match /attempts/{attemptId} {
  allow get: if isSignedIn()
    && matchesResourceDistrict()
    && (isOwningStudent() || isOwningTeacher());
  allow create, update, delete: if false;
}
```

## 8. Access granted for each collection

| Collection | Client access granted |
| --- | --- |
| `assessments/{assessmentId}` | Any authenticated caller may `get`. |
| `assessmentRevisions/{revisionId}` | Any authenticated caller may `get`. |
| `assessmentAnswerKeys/{revisionId}` | None. Every client operation is denied. |
| `assessmentSessions/{sessionId}` | Owning student (uid equals `studentId`) with a verified `districtId` claim equal to the session's `districtId` may `get`. |
| `attempts/{attemptId}` | Owning student or owning teacher (uid equals `studentId` or `teacherId`) with a verified `districtId` claim equal to the attempt's `districtId` may `get`. |

## 9. Access explicitly denied for each collection

| Collection | Client access denied |
| --- | --- |
| `assessments/{assessmentId}` | `list`; `create`, `update`, `delete` (denied by terminal deny; no explicit block on writes because there is no confidentiality or immutability contract to document). |
| `assessmentRevisions/{revisionId}` | `list`; `create`, `update`, `delete`. |
| `assessmentAnswerKeys/{revisionId}` | Every `read` and every `write` for every role including `platformAdministrator`, by an explicit `if false`. Enumeration is denied because no `list` rule is authorized and no `get` rule is authorized. |
| `assessmentSessions/{sessionId}` | Teacher `get` (including the owning class teacher); non-owning student `get`; cross-district `get`; `list`; `create`, `update`, `delete`. |
| `attempts/{attemptId}` | Any caller who is neither the owning student nor the owning teacher; any caller whose `districtId` claim does not match the attempt; `list`; and `create`, `update`, `delete` by an explicit `if false` to document the PDR-026a immutability contract. |

## 10. Query and list behavior

- `assessments`, `assessmentRevisions`, `assessmentSessions`, `attempts`: `allow get` is used (not `allow read`) so collection enumeration is denied by omission. Documents are addressable by known ids in every authorized surface.
- `assessmentAnswerKeys`: explicit `allow read, write: if false;` denies every `get` and every `list`.
- Rules tests exercise the enumeration case for every collection to prove the omission is honored by the Rules engine.

## 11. Rules tests added

Five new test files were added under `platform/firebase/tests/`, following the existing per-collection convention:

- `assessments.rules.test.ts`
- `assessment-revisions.rules.test.ts`
- `assessment-answer-keys.rules.test.ts`
- `assessment-sessions.rules.test.ts`
- `attempts.rules.test.ts`

Each file uses `createTestEnvironment` from the shared `setup.ts` and follows the arrange-with-`withSecurityRulesDisabled`-then-assert pattern used by `submissions.rules.test.ts`. Callers are constructed with `authenticatedContext(uid, tokenOverrides)` so the `role`, `schoolId`, and `districtId` custom claims match the canonical shape written by `platform/functions/src/shared/auth/claims.ts`.

## 12. Positive cases verified

- Authenticated student and teacher may `get` an assessment.
- Authenticated student and teacher may `get` an assessment revision.
- Owning student in the same district may `get` their own `assessmentSessions/{sessionId}`.
- Owning student in the same district may `get` their own `attempts/{attemptId}`.
- Owning teacher (`teacherId == uid`) in the same district may `get` an `attempts/{attemptId}` in their class.

## 13. Negative and adversarial cases verified

- Anonymous callers cannot `get` any of the five collections.
- Anonymous callers cannot `create`, `update`, or `delete` any of the five collections.
- Collection enumeration is denied on all five collections, including filtered enumeration by `studentId` or `teacherId`.
- Answer keys are denied for anonymous, student, teacher, and same-district teacher, and every write is denied.
- Non-owning student cannot `get` another student's session or attempt.
- Cross-district student and cross-district teacher cannot `get` a session or attempt from another district.
- Class teacher cannot `get` a Live session (per PDR-026).
- Same-district teacher without class ownership cannot `get` an attempt in another teacher's class.
- Owning teacher whose district claim is forged (mismatched `districtId`) cannot `get` the attempt.
- Owning student whose district claim is forged cannot `get` their own session.
- Owning student cannot directly `create`, `update`, or `delete` a session (autosave is server-only).
- Owning student cannot `update` or `delete` their own attempt.
- Owning teacher cannot `update` or `delete` an attempt (score correction and administrative deletion are not permitted).

## 14. Confirmation of answer-key confidentiality

`match /assessmentAnswerKeys/{revisionId} { allow read, write: if false; }` explicitly denies every client operation for every role. The dedicated Rules-test suite verifies denial for anonymous, student, teacher, and same-district teacher on `get` and `list`, and denial for every client `create`, `update`, and `delete`. The scorer inside `assessmentAttemptsFinalize` remains the sole reader through the Admin SDK and is not governed by client Rules.

## 15. Confirmation of attempt immutability

`match /attempts/{attemptId}` grants only `get` and explicitly denies `create`, `update`, and `delete`. Rules-test coverage proves that neither the owning student nor the owning teacher can `update` (score correction) or `delete` an attempt. `assessmentAttemptsFinalize` remains the sole writer through the Admin SDK.

## 16. Confirmation of district and class isolation

- District: every ownership-scoped read compares `resource.data.districtId` against `request.auth.token.districtId`. Rules tests verify that a mismatched or forged district claim refuses the read even when the ownership condition is otherwise satisfied.
- Class: the teacher path on `attempts` uses the denormalized `teacherId` on the attempt document, which is frozen at creation from the session's `teacherId` (denormalized from the immutable `assignments/{assignmentId}.teacherId`, itself equal to `classes/{classId}.teacherId`). Same-district access alone is insufficient; a Rules test proves a same-district teacher who does not own the class cannot `get` the attempt.

## 17. Validation results

- Targeted Rules tests (assessments, revisions, answer keys, sessions, attempts): all pass.
- Full Firestore Rules test suite (`npm run test:rules` from `platform/firebase`): 14 suites, 173 tests, all pass.
- No Cloud Functions files, application files, schema files, configuration files, or dependency files were modified. Only `platform/firebase/firestore.rules`, five new files under `platform/firebase/tests/`, `docs/platform/SPRINT_HISTORY.md`, and this completion report were touched.
- Zero em dashes appear in any created or modified file.
- Every repository path referenced in this document exists.

## 18. Findings or deviations

### 18.1 Findings

None. Every certified backend behavior maps cleanly onto the Rules implemented in this slice.

### 18.2 Documentation drift acknowledged (no reconciliation performed)

- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §22 refers to session fields `beganAt` and `state`; the implementation uses `startedAt` and `status`. The Rules text uses the implemented names. Contract reconciliation is out of scope for this slice per Sprint 12A §16.2.

### 18.3 Deviation from Sprint 12A test placement

Sprint 12A §15 recommended deferring Rules tests to Sprint 12C. The Sprint 12B Slice 1 objective explicitly directs that focused Rules tests for this slice be added alongside the Rules changes. Tests were therefore added in this slice. This tightens coverage without changing the certified access model.

## 19. Remaining work for the next Sprint 12 slice

- Assessment retrieval Cloud Functions (student results view, teacher class-attempts view) and their paired UI surfaces.
- The rollup slice: introduce `attemptRollups/*` and `assignmentRollups/*` alongside the rollup Cloud Function; add the paired Rules and Rules tests.
- Student assignment reads through the `assignments/{assignmentId}` collection (deferred; not required by Sprint 12B).
- Direct-client autosave path on `assessmentSessions/*` if a future PDR authorizes it; would require a diff-enforced update rule.
- Documentation reconciliation of `beganAt` versus `startedAt` and `state` versus `status` in the contract prose.

## 20. Certification statement

CERTIFIED: Sprint 12B is complete.
