# Sprint 11C Remediation - Slice 1 Completion Report

**Date:** 2026-07-14
**Scope:** Critical Findings C-1 through C-4 from the Independent Sprint 11 Implementation Review.
**Anchor decisions:** PDR-025, PDR-026.
**Anchor contracts:** `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `ASSESSMENT_SCORING_CONTRACT.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`.

The certified architecture is preserved. Only the four Critical findings are addressed.
No Important or Minor findings are implemented in this slice.

---

## Critical findings addressed

### C-1. Idempotent finalize replay after committed attempt

**Problem.** `assessmentAttemptsFinalize` deletes the target `assessmentSessions/{sessionId}` document inside the same transaction as the attempt write per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §8, §11. A client retry after commit therefore observed a missing session and was refused with `assessmentAttempts.sessionNotFound` instead of returning the existing attempt payload as required by §8 idempotency semantics.

**Correction.** The finalize transaction now detects a missing session, recovers the target `assignmentId` by parsing the deterministic session identifier (`{assignmentId}__{studentId}__{sessionOrdinal}`, §12), and queries `attempts` by `(studentId, assignmentId, idempotencyKey)` through the existing composite. When a match is found, the callable returns the existing attempt payload unchanged, writes no new attempt, and emits no additional audit event. When no match is found, `sessionNotFound` is still raised.

**Files.** `platform/functions/src/assessments/assessment-attempts-finalize.ts`.

### C-2. Assignment window + enrollment enforcement

**Problem.** `assessmentSessionsBegin` did not enforce `availableAt`, `windowClosesAt`, or the certified refusal-identifier set; `assessmentAttemptsFinalize` never re-verified enrollment or assignment window inside the finalize transaction.

**Correction.**

- `assessmentSessionsBegin` now refuses with `assignment-window-closed` when `availableAt` is in the future, when `windowClosesAt` has elapsed, or when the assignment `status` is `closed`. `draft` and `archived` refuse with `assignment-not-published`. `practice` mode refuses with `assignment-mode-invalid`. Missing assignments refuse with `assignment-not-found`. Missing or non-active enrollments refuse with `enrollment-inactive`.
- `assessmentAttemptsFinalize` now reads the referenced assignment and the caller's enrollment inside the finalize transaction. `archived`/`draft` assignments refuse with `assignment-not-published`; `closed` assignments refuse with `assignment-window-closed` unless within the certified one-hour grace period after `windowClosesAt` (§7.1, §17). `published` assignments beyond `windowClosesAt + grace` refuse with `assignment-window-closed`. Non-active enrollments refuse with `enrollment-inactive`.

Every refusal identifier is drawn from `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §25.

**Files.** `platform/functions/src/assessments/assessment-sessions-begin.ts`, `platform/functions/src/assessments/assessment-attempts-finalize.ts`.

### C-3. Central `PlatformError` -> `HttpsError` translation

**Problem.** Every callable threw `PlatformError` directly. The Firebase runtime coerced it to `INTERNAL` and discarded the canonical platform code, breaking the client contract.

**Correction.** A single shared translation layer was introduced at `platform/functions/src/shared/errors/https-callable.ts`. It exports `platformCallable(handler)` which wraps `onCall` and catches thrown `PlatformError` values, remapping them to the appropriate Firebase `FunctionsErrorCode` while preserving the canonical platform code in `HttpsError.details.code`. Existing `HttpsError` values pass through unchanged; unknown throwables are coerced to `internal` without leaking stack traces.

Every existing `onCall(handler)` export site was rewritten to `platformCallable(handler)` (mechanical import + call-site swap). No callable handler was modified. All 31 callables now benefit from the translation automatically.

Prefix-based mapping (authoritative in the shared module):

| Platform code family | Firebase code |
| --- | --- |
| `unauthenticated`, `claim-stale` | `unauthenticated` |
| `role-forbidden`, `district-mismatch`, `district-unassigned`, `school-district-mismatch`, `claim-state-mismatch`, `account-inactive` | `permission-denied` |
| `*.notFound`, `*.sessionNotFound`, `*.assignmentNotFound`, `*.revisionMissing`, `*.answerKeyMissing`, `assignment-not-found`, `session-not-found`, `assessment-not-found`, `assessment-revision-missing` | `not-found` |
| `*.conflict`, `*.writeConflict`, `*.alreadyExists` | `already-exists` |
| `*.invalidRequest`, `*.invalid*`, `*.malformedSession` | `invalid-argument` |
| everything else (`assignment-window-closed`, `enrollment-inactive`, business-rule refusals) | `failed-precondition` |

**Files.** `platform/functions/src/shared/errors/https-callable.ts` (new), `platform/functions/src/shared/index.ts`, plus a mechanical `onCall(...)` -> `platformCallable(...)` swap in every callable file.

### C-4. Dual write-path prevention

**Problem.** `submissions/*` (superseded per PDR-026 §26) and `attempts/*` (authoritative under PDR-026) were both server-writable via Admin SDK, in violation of §26 ("MUST NOT be simultaneously writable in production").

**Correction.** A single shared deployment gate was introduced at `platform/functions/src/shared/legacy-submissions-flag.ts`. `submissionsCreateHandler` and `submissionsFinalizeHandler` now invoke `assertLegacySubmissionsWritesEnabled()` at entry. The gate reads the `LYFELABZ_LEGACY_SUBMISSIONS_WRITES_ENABLED` environment variable; the default is inert (both handlers refuse with the canonical `submissions.legacyWritesDisabled` identifier). Only an explicit `true` opt-in during a data-migration reconciliation window re-enables the legacy writers. The attempts pipeline (`assessmentAttemptsFinalize`) is unaffected.

**Files.** `platform/functions/src/shared/legacy-submissions-flag.ts` (new), `platform/functions/src/shared/index.ts`, `platform/functions/src/submissions/submissions-create.ts`, `platform/functions/src/submissions/submissions-finalize.ts`.

---

## Files created

- `platform/functions/src/shared/errors/https-callable.ts`
- `platform/functions/src/shared/errors/https-callable.test.ts`
- `platform/functions/src/shared/legacy-submissions-flag.ts`
- `platform/functions/src/shared/legacy-submissions-flag.test.ts`
- `docs/platform/SPRINT_11C_REMEDIATION_SLICE1_COMPLETION_REPORT.md`

## Files modified

- `platform/functions/src/shared/index.ts` (re-exports for the two new shared modules)
- `platform/functions/src/assessments/assessment-attempts-finalize.ts` (C-1 replay path, C-2 assignment + enrollment reads, C-3 wrapper swap)
- `platform/functions/src/assessments/assessment-attempts-finalize.test.ts` (fixture coverage + C-1/C-2 tests)
- `platform/functions/src/assessments/assessment-sessions-begin.ts` (C-2 canonical codes + window enforcement, C-3 wrapper swap)
- `platform/functions/src/assessments/assessment-sessions-begin.test.ts` (canonical-code assertions + C-2 tests)
- `platform/functions/src/submissions/submissions-create.ts` (C-4 gate, C-3 wrapper swap)
- `platform/functions/src/submissions/submissions-finalize.ts` (C-4 gate, C-3 wrapper swap)
- `platform/functions/src/submissions/submissions-create.test.ts` (mock the C-4 gate)
- `platform/functions/src/submissions/submissions-finalize.test.ts` (mock the C-4 gate)
- Every other callable file (mechanical C-3 wrapper swap): `assessments/assessment-sessions-autosave.ts`, `assignments/assignments-{archive,close,create-draft,publish,update-draft}.ts`, `classes/classes-{archive,create,update-metadata}.ts`, `enrollments/enrollments-{join-by-code,set-status,teacher-add}.ts`, `lms/{assignments-publish,classes-discover,classes-import,classes-list-topics,classes-refresh,connections-begin,connections-complete,connections-describe,connections-disconnect,providers-list}.ts`, `schools/schools-create.ts`, `students/students-complete-onboarding.ts`, `teachers/teachers-{approve,deny,request}-verification.ts`
- Corresponding test files updated only where `jest.mock("../shared", ...)` needed `platformCallable` added

---

## Implementation summary

The four Critical corrections are minimal and architecture-conforming.

- C-1 uses the existing composite index. No new index. No new query shape.
- C-2 uses the certified refusal-identifier set (§25). No new lifecycle field, no new grace-period model.
- C-3 centralizes the translation in a single shared module. Every callable benefits automatically through a mechanical import + call-site swap.
- C-4 uses a single environment-variable gate. Default is inert; production deployments cannot silently keep both write paths live.

The certified architecture is not redesigned. No Important or Minor findings are addressed.

---

## Tests added

New tests specifically covering the remediation:

- C-1
  - `assessment-attempts-finalize.test.ts` -> `C-1: replays the existing attempt after the session has been deleted` (no duplicate writes, no duplicate audit events).
  - `assessment-attempts-finalize.test.ts` -> `C-1: still refuses with sessionNotFound when there is no matching attempt`.
- C-2
  - `assessment-sessions-begin.test.ts` -> `C-2: refuses when the assignment window has not yet opened`.
  - `assessment-sessions-begin.test.ts` -> `C-2: refuses when the assignment window has already closed`.
  - `assessment-sessions-begin.test.ts` -> `C-2: refuses when the caller is not enrolled at all with enrollment-inactive`.
  - `assessment-sessions-begin.test.ts` -> `rejects a non-published assignment target with certified refusals` (updated to the canonical code split).
  - `assessment-attempts-finalize.test.ts` -> `C-2: refuses finalize when the assignment is closed past the grace period`.
  - `assessment-attempts-finalize.test.ts` -> `C-2: permits finalize inside the certified one-hour grace period`.
  - `assessment-attempts-finalize.test.ts` -> `C-2: refuses finalize when the caller's enrollment is not active`.
  - `assessment-attempts-finalize.test.ts` -> `C-2: refuses finalize when the assignment is not found`.
  - `assessment-attempts-finalize.test.ts` -> `C-2: refuses finalize when the assignment is archived`.
- C-3
  - `https-callable.test.ts` -> full coverage of `mapPlatformCodeToHttpsCode` and `translateThrown` (preserved canonical identifier, correct HttpsError code mapping, unknown-throwable coercion, HttpsError pass-through).
- C-4
  - `legacy-submissions-flag.test.ts` -> gate defaults to disabled, throws canonical identifier when disabled, enables on explicit true (case- and whitespace-insensitive), stays disabled for every other value.

All pre-existing tests are preserved. Existing tests that asserted non-canonical refusal identifiers now assert the certified identifiers, without deleting any test case.

---

## Validation results

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` (functions) | PASS |
| Typecheck | `npm run typecheck` (functions) | PASS |
| Build | `npm run build` (functions) | PASS |
| Jest suite | `npx jest` (functions) | PASS: 30 suites, 535 tests |
| Diff whitespace | `git diff --check` | PASS |
| Em-dash sweep | `git diff | grep U+2014` | PASS (0 hits) |

No files were committed.

---

## Remaining review findings intentionally deferred

Every Important and Minor finding from the Independent Sprint 11 Implementation Review is deferred to a subsequent slice. Explicitly not addressed here (per the sprint task):

- Firestore Rules amendments
- Retrieval APIs (`assessmentAttemptsGetForStudent`, `assessmentAttemptsGetForTeacher`)
- Dashboards / rollup surfaces
- Deployment automation enhancements
- Session ordinal redesign
- Performance optimizations
- Documentation reconciliations beyond this slice's Critical findings

---

## Scope confirmation

Only Critical findings C-1 through C-4 were implemented. No Important or Minor findings were addressed. No commit was made.
