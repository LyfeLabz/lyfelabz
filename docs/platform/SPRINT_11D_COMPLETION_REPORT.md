# Sprint 11D Completion Report

**Date:** 2026-07-16
**Scope:** Important findings I-1 through I-9 plus refinements R-1 and R-2 identified in the Sprint 11C independent implementation review and remediation follow-up review.
**Anchor decisions:** PDR-025, PDR-026.
**Anchor contracts:** `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `ASSESSMENT_SCORING_CONTRACT.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`.

The certified architecture is preserved. Only the nine Important findings and two refinements are addressed. Firestore Rules, retrieval APIs, dashboards, app/LMS code, and Minor findings are untouched.

---

## Findings addressed

### I-1. Audit event consistency

Cross-checked every writer path against `writeAuditEvent` per `shared/audit/**` invariants. All callable-boundary writers already emit an event per operation (verified across `src/assessments/**`, `src/assignments/**`, `src/submissions/**`, `src/enrollments/**`, `src/classes/**`, `src/lms/**`, `src/teachers/**`, `src/students/**`, `src/schools/**`, `src/auth/**`). No duplicates and no omissions were introduced by this sprint. Consistency was strengthened by wiring canonical `districtId` context onto every user-actor emission where district context is available (see I-5).

### I-2. Deployment overwrite protection

`deployAssessmentRevision` now writes the two immutable documents through `tx.create(...)` rather than `tx.set(...)`. The pre-existing transactional `tx.get(...)` existence check is retained; `tx.create` adds a server-side "must-not-exist" precondition that refuses even a hypothetical concurrent second commit that beat the transaction's retry logic. `assessments/{assessmentId}` remains a `tx.set(...)` because it is legitimately create-OR-update (its `currentRevisionId` advances on republication).

### I-3. Assessment begin race

`assessmentSessionsBegin` now creates the session through `assessmentSessionCreationDocRef(sessionId).create(creation)` rather than `.set(creation)`. `create` refuses a second write at the write boundary; a `code === 6` / `"already-exists"` failure is translated to the canonical `assessmentSessions.conflict` identifier so the caller observes the same refusal a mid-check conflict would have raised. No new document, index, or ordinal machinery is introduced.

### I-4. Error vocabulary reconciliation

`shared/errors/https-callable.ts` now maps namespaced identifiers ending in `.unauthenticated` to `unauthenticated`, and identifiers ending in `.unauthorized`, `.forbidden`, `.notOwned`, or `.notEnrolled` to `permission-denied`. The canonical platform identifier is preserved verbatim on `HttpsError.details.code`. No canonical identifier is renamed. Ties into R-2.

### I-5. District context in audit records

`WriteAuditEventInput`, `AuditEventWrite`, and `AuditEventRecord` now carry an optional top-level `districtId` field per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §7. `writeAuditEvent(...)` validates the value is a non-empty string when supplied and persists it verbatim. Every callable that has district context in scope now supplies it: all assessments, assignments, classes, enrollments, LMS reconciliation, teachers approve-verification, and students onboarding writers. The `LmsAuthenticatedTeacher` shape gained an optional `districtId` claim projection so LMS audit emissions can carry the context. Pre-district system events (`auth.userProvisioned`) and events without a resolvable district (`schools.created`, teacher pre-verification events) legitimately continue to omit the field, matching the schoolId conditional-requirement precedent.

### I-6. Attempt count

Reviewed. The existing implementation is already minimal and architecture-conforming: a single `where(studentId, assignmentId).get()` inside the finalize transaction produces the count, plus a deterministic `attemptId` `tx.get` used only to refuse a write conflict. No smaller architecture-conforming implementation exists without redesigning attempt numbering, which the sprint task forbids. No code change.

### I-7. Finalize response construction

Reviewed against `ASSESSMENT_SCORING_CONTRACT.md` §10.4. The response payload carries exactly `attemptId`, `attemptNumber`, `score`, `maxScore`, `percentage`, `itemResults` plus a server-added `replay: boolean` metadata flag introduced in Sprint 11C Remediation Slice 1 (C-1). `replay` is not answer-key material, is not client-authored, and is out-of-band from the §10.4 confidentiality concern (that section governs what leakage the response MAY NOT include, not the presence of server metadata flags). No shape drift beyond the sanctioned Slice-1 flag. No code change.

### I-8. Session ordinal

Reviewed. Multi-session ordinals are explicitly deferred to the archived-session lifecycle callables (`assessmentSessionsSweepExpired`, `assessmentSessionsRecover`), which are out of scope for the current pipeline. The current single-ordinal (`FIRST_SESSION_ORDINAL = 1`) implementation is architecture-conforming for the certified slice. No code change.

### I-9. Documentation reconciliation

This report documents the corrections. `SPRINT_HISTORY.md` receives a matching entry. No other doc required changes for these findings.

### R-1. Composite identifier parse hardening

`parseAssignmentIdFromSessionId` in `assessment-attempts-finalize.ts` is now right-anchored. The trailing segment must be numeric; the two preceding `__` separators are stripped once from the right so an assignmentId that legally contains `__` (the pattern permits repeated `_` characters) survives the round-trip. The pre-Sprint-11D `split("__")[0]` would silently truncate such identifiers. Exposed as `__parseAssignmentIdFromSessionId` for unit coverage.

### R-2. Coarse Firebase error-code mapping

Bundled with I-4 above. The mapper now recognizes namespaced identifiers ending in the canonical auth and permission suffixes so every callable domain's `{domain}.{suffix}` variants map consistently without a per-call-site rewrite. Preserves the canonical platform identifier in `details.code`.

---

## Files created

- `docs/platform/SPRINT_11D_COMPLETION_REPORT.md`

## Files modified

Code:

- `platform/functions/src/shared/errors/https-callable.ts`
- `platform/functions/src/shared/errors/https-callable.test.ts`
- `platform/functions/src/shared/audit/write-audit-event.ts`
- `platform/functions/src/shared/audit/write-audit-event.test.ts`
- `platform/functions/src/shared/types/audit-event.ts`
- `platform/functions/src/assessments/assessment-deployment.ts`
- `platform/functions/src/assessments/assessment-deployment.test.ts`
- `platform/functions/src/assessments/assessment-sessions-begin.ts`
- `platform/functions/src/assessments/assessment-sessions-begin.test.ts`
- `platform/functions/src/assessments/assessment-attempts-finalize.ts`
- `platform/functions/src/assessments/assessment-attempts-finalize.test.ts`
- `platform/functions/src/assignments/assignments-{archive,close,create-draft,publish,update-draft}.ts` (plus corresponding `*.test.ts`)
- `platform/functions/src/classes/classes-{archive,create,update-metadata}.ts` (plus corresponding `*.test.ts`)
- `platform/functions/src/enrollments/enrollments-{join-by-code,set-status,teacher-add}.ts` (plus corresponding `*.test.ts`)
- `platform/functions/src/lms/{assignments-publish,classes-import,classes-refresh,connections-complete,connections-disconnect}.ts`
- `platform/functions/src/lms/shared/actor.ts`
- `platform/functions/src/teachers/teachers-approve-verification.ts` (plus test)
- `platform/functions/src/students/students-complete-onboarding.ts` (plus test)

Docs:

- `docs/platform/SPRINT_HISTORY.md`

---

## Tests added

- `shared/errors/https-callable.test.ts`
  - `I-4: maps namespaced .unauthenticated suffix to unauthenticated`
  - `I-4: maps namespaced permission suffixes to permission-denied`
- `shared/audit/write-audit-event.test.ts`
  - `I-5: persists a supplied districtId at the top level of the audit record`
  - `I-5: refuses an empty-string districtId`
  - `I-5: permits an omitted districtId for legacy pre-district events`
- `assessments/assessment-deployment.test.ts`
  - `I-2: uses tx.create for the immutable revision and answer-key writes`
- `assessments/assessment-sessions-begin.test.ts`
  - `I-3: maps a create-time ALREADY_EXISTS race to assessmentSessions.conflict`
- `assessments/assessment-attempts-finalize.test.ts`
  - `R-1: parseAssignmentIdFromSessionId is right-anchored -> preserves an assignmentId that contains __`
  - `R-1: parseAssignmentIdFromSessionId is right-anchored -> returns undefined when the trailing segment is not a numeric ordinal`
  - `R-1: parseAssignmentIdFromSessionId is right-anchored -> returns undefined for a session identifier without the ordinal separator`
  - `R-1: parseAssignmentIdFromSessionId is right-anchored -> preserves the plain three-segment canonical shape`
- Additionally, every existing audit-event assertion was extended to assert the newly supplied top-level `districtId` where district context is available. No pre-existing test case was removed.

---

## Validation results

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` (functions) | PASS |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` (functions) | PASS |
| Build | `npm run build` (functions) | PASS |
| Jest suite | `npm test` (functions) | PASS: 30 suites, 546 tests |
| Diff whitespace | `git diff --check` | PASS |
| Em-dash sweep | `grep -R "U+2014" docs/platform/SPRINT_11D_COMPLETION_REPORT.md` | PASS (0 hits) |

No commit was created.

---

## Remaining Minor findings

Every Minor finding from the Sprint 11C independent implementation review and remediation follow-up remains deferred. Explicitly not addressed here:

- Firestore Rules amendments
- Retrieval APIs (`assessmentAttemptsGetForStudent`, `assessmentAttemptsGetForTeacher`)
- Dashboards / rollup surfaces
- Deployment automation enhancements
- Session ordinal redesign beyond the current single-ordinal implementation
- Performance optimizations
- App / LMS client-side surfaces
- Documentation reconciliations beyond those directly implicated by this sprint's Important corrections

---

## Scope confirmation

Only the nine Sprint 11D Important findings (I-1 through I-9) and the two refinements (R-1, R-2) were implemented. No Critical, Important, or Minor finding from any other slice was introduced. No commit was made.

---

## Sprint 11E reconciliation

The Sprint 11D follow-up review surfaced small residuals against I-1, I-2, I-4, I-6, I-7, and I-8. Sprint 11E closes them without redesigning the certified architecture. Prior sections of this report are preserved verbatim. The Sprint 11E notes below point forward to the current state.

- I-1. Reconciled by documentation. `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §5 (Audit creation) and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §32.1 now record that the canonical implementation pattern emits the audit event post-commit as best-effort observability, with the state transition as the authoritative source of truth. This matches the deployed pattern across every callable in `platform/functions/src`.
- I-2. Reconciled by code. `deployAssessmentRevision` now writes the parent `assessments/{assessmentId}` document through `tx.set(..., { merge: true })` so a republication no longer erases fields the deployment writer does not own. Immutable revision and answer-key writes still use `tx.create`. A new Jest case pins the merge option and the deployment-owned field set.
- I-4. Reconciled by documentation. `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §6 now carries the canonical error-vocabulary table matching the actual selectors in `shared/errors/https-callable.ts`. No canonical identifier is renamed.
- I-6. Reconciled by documentation. `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §32.2 records why the in-transaction snapshot count remains canonical (monotonic ordinal derivation coupled with the transactional read set) even though `AggregateQuery.count()` is available inside `runTransaction` on the Admin SDK. No behavior change.
- I-7. Reconciled by documentation. `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §32.3 records that the autosave validator both rejects unexpected element keys at the request boundary AND persists an explicit two-field projection, so the persisted shape is guaranteed to contain only `{ itemId, response }`. The behavior exceeds the "strip extras" requirement.
- I-8. Reconciled by documentation. `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §32.4 records the explicit deferral of multi-session ordinal semantics to the archived-session lifecycle callables (`assessmentSessionsSweepExpired`, `assessmentSessionsRecover`), matching the deferral already recorded in the Sprint 11D report.

See `docs/platform/SPRINT_11E_COMPLETION_REPORT.md` for the full Sprint 11E record.
