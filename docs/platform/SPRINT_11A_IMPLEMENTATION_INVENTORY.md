# Sprint 11A Contract Implementation Inventory

**Status:** Inventory artifact. Certified under Sprint 11A.
**Date:** 2026-07-13
**Anchor decisions:** PDR-025, PDR-026, PDR-027, PDR-028.
**Governs:** A repository-to-contract evidence audit of the current implementation against the four canonical Sprint 10A implementation contracts. Does not alter architecture. Does not modify production code.

---

## 1. Purpose and Scope

Sprint 11A compares the current LyfeLabz repository implementation against the four canonical Sprint 10A implementation contracts (PDR-025 through PDR-028) and produces an evidence-based inventory of implemented, partially implemented, missing, and conflicting requirements. The inventory becomes the input to Sprint 11B.

This sprint does not:

- alter certified architecture,
- re-open ratified contracts,
- modify Cloud Functions, Firestore Rules, app code, tests, shared types, or configuration,
- perform any migration,
- commit any change.

It records only what the repository is, cited to files.

## 2. Canonical Authorities Reviewed

Controlling contracts:

- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (PDR-025). Controls district enforcement, canonical claim shape, callable and rule invariants, error contract, required tests.
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (PDR-026). Controls session, attempt, answer-key, revision, rollup ownership, callable matrix, indexes, audit vocabulary, and reconciliation with the current `submissions` surface.
- `docs/platform/GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` (PDR-027). Controls the deep-link URL contract, publication transaction, resolver, security boundaries.
- `docs/platform/ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` (PDR-028). Controls display-name ownership, resolver, Google and LMS interaction, callable matrix, audit vocabulary.

Supporting authorities:

- `docs/platform/SPRINT_10A_CERTIFICATION.md`, `docs/platform/SPRINT_10A_FINAL_RECONCILIATION_REPORT.md`, `docs/platform/SPRINT_10A_COMPLETION_REPORT.md`. Establish that implementation may resume against the four contracts and record the reconciliation posture inherited into Sprint 11A.
- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md`. Definitive text for PDR-025 through PDR-028.
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md`. Identity, roster placeholder lifecycle, first-sign-in matching.
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md`. Canonical shapes for `users`, `enrollments`, `assignments`, `auditEvents`, and the roster-placeholder position of ambiguity resolved by PDR-028 §7.1.
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md`. Rule-layer scoping baseline the contracts extend.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`. Callable authority baseline; Sprint 10A F-1 through F-4 notices reconcile it to the four contracts.
- `docs/platform/LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md`. Index-naming convention required by the contracts.
- `docs/platform/PLATFORM_STATE_MACHINE.md`. Closed user-status enumeration relied on by PDR-025 §7.
- `docs/platform/PLATFORM_CONTRACTS.md`. Client-storage prohibitions relevant to PDR-025 and PDR-027.
- `docs/platform/LMS_INTEGRATION_ARCHITECTURE.md`, `docs/platform/LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, `docs/platform/LMS_EXPERIENCE.md`. Roster authority, refresh delta, Assign Experience surface that hosts publication.
- `docs/platform/ASSESSMENT_PIPELINE_SPECIFICATION.md`. Sprint 9A ratification of session-authoritative pipeline PDR-026 collapses.
- `docs/platform/PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`. My Results, Improve My Score, teacher analytics surfaces consuming the pipeline.
- `docs/platform/PLATFORM_OPERATIONS_SPECIFICATION.md`. Canonical origin (`lyfelabz.com`) and `/app/**` routing prefix required by PDR-027 §8.1.
- `docs/platform/SPRINT_HISTORY.md`. Historical context; Sprint 10A entry.

Each authority above is cited only where the contracts route to it for interpretation.

## 3. Repository Areas Inspected

- `platform/functions/src/**` (Cloud Functions source, including `auth`, `teachers`, `students`, `classes`, `enrollments`, `assignments`, `submissions`, `lms`, `schools`, `audit`, and `shared`).
- `platform/functions/src/shared/**` (shared types, claims helper, audit-event writer, error class, typed Firestore refs).
- `platform/firebase/firestore.rules` (all rule matches).
- `platform/firebase/firestore.indexes.json` (composite index configuration).
- `platform/firebase/tests/**` (Rules test suites).
- `app/src/**` (session bootstrap, router, surfaces, curriculum, present mode).
- `docs/platform/**` (contract, PDR, and history documents referenced above).

Source files whose existence or absence is load-bearing for this inventory are cited by relative path in Sections 5 through 8.

## 4. Executive Findings

**Overall readiness.** The repository holds a mature Sprint 6-era foundation (`users`, `schools`, `classes`, `enrollments`, `assignments`, `submissions`, `lmsConnections`, `lmsClassLinks`, `lmsAssignmentPublications`) implemented under the certified Sprint 2 to Sprint 8 architecture. The four Sprint 10A implementation contracts have NOT yet been implemented. Nothing on disk yet honors the district claim contract of PDR-025, the session and attempt pipeline of PDR-026, the deep-link and resolver contract of PDR-027, or the display-name resolver and audit vocabulary of PDR-028.

**Already implemented foundations.** Sprint 2 provisioning, teacher verification request and approval, student onboarding, class create and metadata, join-code enrollment, teacher enrollment add, enrollment status transitions, assignment draft and publish and close and archive, current `submissions` two-callable pipeline, LMS OAuth connection lifecycle, LMS class discovery and import, and a first LMS publication callable (`lmsAssignmentsPublish`) are already implemented. The canonical claims helper `platform/functions/src/shared/auth/claims.ts` exists and is the single write path for the current `{ role, schoolId }` claim shape. Firestore Rules `platform/firebase/firestore.rules` implement narrowly-scoped affirmative reads on `users`, `schools`, `classes`, `enrollments`, `assignments`, `submissions`, `lmsProviders`, `lmsConnections`, `lmsClassLinks`, `lmsAssignmentPublications`, and enforce `auditEvents` server-only. All other paths remain default-deny.

**Major implementation gaps.**

- No `districtId` field is written to any Firestore document, no `districtId` claim is issued, no rule reads a `districtId`, no schools-to-district traversal exists, and no callable enforces district identity. The claim contract explicitly reserves the slot but does not populate it (`platform/functions/src/shared/auth/claims.ts:11-19`).
- No assessment collection (`assessments`, `assessmentRevisions`, `assessmentAnswerKeys`, `assessmentSessions`, `attempts`, `attemptRollups`, `assignmentRollups`) is defined; no session, attempt, scorer, or rollup callable exists; the current pipeline uses `submissions/{assignmentId}__{studentId}` with `submissionsCreate` and `submissionsFinalize`.
- The deep-link resolver (`lmsDeepLinkResolve`) does not exist; the current publication callable is named `lmsAssignmentsPublish` (plural), accepts a client-supplied `lyfelabzAssignmentUrl`, and no URL builder enforces the `https://lyfelabz.com/app/a/{assignmentId}` shape mandated by PDR-027 §8.
- No `enrollmentsSetDisplayNameOverride` callable exists; no display-name resolver, normalizer, or placeholder shape has been chosen; no `users.displayNameChanged`, `enrollments.displayNameOverrideChanged`, `roster.placeholderNameChanged`, or `roster.placeholderResolved` audit event is emitted anywhere.

**Conflicts requiring correction.**

- The current `lmsAssignmentsPublish` accepts `lyfelabzAssignmentUrl` from the client (`platform/functions/src/lms/assignments-publish.ts:60-113`). PDR-027 §8.3 requires the server to be the sole constructor of the deep-link URL. This is a certified reconciliation obligation on the sprint that lands PDR-027, not a defect of Sprint 10A.
- The current pipeline collection `submissions/{submissionId}` and its two-callable split are superseded by `attempts/{attemptId}` and `assessmentAttemptsFinalize` per PDR-026 §11, §21, and §26. Reconciliation is required, not amendment. `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §Sprint 10A F-2 Reconciliation Notice already routes forward.
- The `CanonicalCustomClaims` type omits `districtId` (`platform/functions/src/shared/auth/claims.ts:17-20`). PDR-025 §6 makes `districtId` part of the canonical shape and requires an atomic replacement path.
- The Sprint 2 rules-allowlisted self-write on `users/{uid}.displayName` (`platform/firebase/firestore.rules:33-49`) satisfies PDR-028 Option A once the `usersOnDisplayNameChange` trigger is added; without the trigger, no audit event is emitted on a change and PDR-028 §20 is not honored.
- Firestore Rules on `classes`, `enrollments`, `assignments`, `submissions`, `lmsConnections`, `lmsClassLinks`, `lmsAssignmentPublications` scope by `teacherId`, `studentId`, `ownerUid` only; no rule compares a `districtId` claim to a document `districtId`. This is not yet a conflict because no district claim exists; it becomes a conflict the moment the claim contract lands.

**Test coverage condition.** Rules tests exist for `assignments`, `audit-events`, `classes`, `default-deny`, `enrollments`, `lms`, `schools`, `submissions`, and `users` (`platform/firebase/tests/*.rules.test.ts`). Cloud Functions have per-callable Jest tests colocated with each callable. Every PDR-025 rule and callable matrix case involving `districtId`, every PDR-026 case involving `assessment*` or `attempts`, every PDR-027 case involving `lmsAssignmentPublish` / `lmsDeepLinkResolve`, and every PDR-028 case involving `enrollmentsSetDisplayNameOverride` or display-name audit events is Missing.

**Recommended first coding step.** Land the shared district context helper, the canonical claim shape extension (`districtId`), and the closed-set district-error identifier module. This is the smallest change that (a) unblocks every downstream contract, (b) is verifiable independently in the Emulator Suite, (c) touches only the shared module and the claims helper without rewriting any existing callable, and (d) is the first bullet on the PDR-025 §20 implementation checklist. Sprint 11B scope is stated in §14.

## 5. PDR-025 District Security Boundary Inventory

Requirement matrix. Row IDs preserved from `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`.

| # | Contract requirement | Status | Evidence | Explanation |
| - | -------------------- | ------ | -------- | ----------- |
| §6 canonical claim shape `{ role, schoolId, districtId }` (all three strings, non-empty) | Partially Implemented | `platform/functions/src/shared/auth/claims.ts:17-20`, `platform/functions/src/shared/auth/claims.ts:11-19` | `CanonicalCustomClaims` currently ships `{ role, schoolId }` only; `districtId` is documented as reserved and intentionally not part of the type. |
| §6 claims issuer restricted to admin credential | Implemented | `platform/functions/src/shared/auth/claims.ts:53-101`, `platform/functions/src/shared/auth/admin.ts` | `writeCustomClaims` is the single writer and runs under `firebase-admin`. |
| §6 precondition claims only when `status === "active"` | Implemented | `platform/functions/src/shared/auth/claims.ts:66-72` | `claims.notActive` refusal exists. |
| §6 clear claims on transition out of `active` | Missing | (no suspend/archive/withdrawal callable exists) | Not implementable until §14 transition callables are authorized. |
| §6 platform administrator absence sentinel | Missing | `platform/functions/src/shared/auth/claims.ts:31-33` | Administrator role listed in the Role union; no callable issues an administrator claim under either sentinel. |
| §6 forbidden client submission of `districtId` / `schoolId` / `role` | Partially Implemented | `platform/functions/src/teachers/teachers-request-verification.ts`, `platform/functions/src/classes/classes-create.ts`, `platform/functions/src/enrollments/enrollments-join-by-code.ts` | Each callable derives `schoolId` server-side; no callable currently reads a `districtId` because the field does not exist. |
| §7 activation state machine, district projection per state | Partially Implemented | `platform/functions/src/teachers/teachers-approve-verification.ts`, `platform/functions/src/students/students-complete-onboarding.ts`, `platform/functions/src/shared/types/user.ts` | State machine is correctly implemented for `provisioned` -> `pendingVerification` / `active`; the `districtId` field is absent from every write shape. |
| §7 `awaitingFirstSignIn` roster placeholder state | Missing | (no LMS-derived placeholder enrollment or `rosterPlaceholders/*` document is written; `platform/functions/src/lms/classes-import.ts` does not create per-student placeholders) | The LMS roster placeholder path is not yet implemented. |
| §8 teacher verification atomic write of `role`, `schoolId`, `districtId` claims | Partially Implemented | `platform/functions/src/teachers/teachers-approve-verification.ts` | Approves and writes `{ role, schoolId }` claims only. `districtId` is not resolved or written. |
| §9 student activation and district assignment (`enrollmentsActivateOnFirstSignIn`) | Missing | (no callable of this name exists in `platform/functions/src/index.ts`) | Sprint 6 delivered join-code enrollment; the first-sign-in activation callable is not implemented. |
| §10 resource ownership chain: `districtId` denormalized on `classes`, `enrollments`, `assignments`, `submissions`, `auditEvents` | Missing | `platform/functions/src/shared/types/class.ts`, `enrollment.ts`, `assignment.ts`, `submission.ts`, `audit-event.ts` | No write shape carries `districtId`; no rule reads it. |
| §11 Rules invariants (caller district vs resource district; server-only writes; default deny) | Partially Implemented | `platform/firebase/firestore.rules` (all matches) | Server-only write posture, default-deny terminal rule, and role-scoped reads are implemented. District-based comparison is absent because the claim and denormalized fields do not exist. |
| §11 server-only writes on `users.role/status/schoolId/districtId/schoolIds/verification*` | Implemented (subset covered) | `platform/firebase/firestore.rules:47-49` | Self-update allowlist is limited to `displayName`; every other field is denied. |
| §12 callable enforcement contract per row of the callable matrix | Partially Implemented | Callable files under `platform/functions/src/{teachers,students,classes,enrollments,assignments,submissions,lms,schools}` | Auth, active-status, role, and parent-ownership checks are broadly present; every district-derivation and comparison row is absent. |
| §13 cross-district reference prevention | Missing | (no callable resolves a school's `districtId` today) | Awaits §6 claim shape and §10 denormalization. |
| §14 district transfer safe default (no client-driven mutation) | Implemented | `platform/firebase/firestore.rules:47-49` and terminal deny | No client can write `districtId`; the field simply does not exist. |
| §15 stale-claim behavior (deny on mismatch; do not fall back to record) | Missing | `platform/functions/src/shared/auth/*` | No claim vs record reconciliation helper exists. |
| §16 audit vocabulary for district-relevant transitions | Partially Implemented | `platform/functions/src/shared/audit/write-audit-event.ts`, `platform/functions/src/shared/types/audit-event.ts` | Audit writer exists; event names for `auth.userProvisioned`, `teachers.verification*`, `classes.*`, etc. emit under current shapes. No event carries `districtId`, and `security.staleClaim`, `users.suspended`, `users.reinstated`, `users.archived` names are not emitted anywhere. |
| §17 canonical error identifiers (`district-mismatch`, `district-unassigned`, `school-district-mismatch`, `cross-district-reference`, `claim-stale`, `claim-state-mismatch`, `server-only-field`, `transfer-not-supported`) | Missing | `platform/functions/src/shared/errors/platform-error.ts` | The `PlatformError` class exists but the closed set above is not declared anywhere in the shared module. |
| §18 required Firestore Rules tests | Missing | `platform/firebase/tests/*.rules.test.ts` | The existing tests cover same-role scoping; none exercise cross-district denial, stale claim denial, forged parent denial, or a `districtId` claim. |
| §19 required Cloud Function tests (idempotent replay, cross-district refusal, atomic activation, claim-refresh signal, one audit event per transition) | Missing | `platform/functions/src/**/*.test.ts` | The existing tests cover the current claim shape only. |
| §20 implementation checklist item 1: shared TypeScript types for claim shape and error identifiers | Missing | `platform/functions/src/shared/auth/claims.ts:17-20`, `platform/functions/src/shared/errors/platform-error.ts` | Not present. |
| §20 checklist item 2: single claims helper that atomically writes `role`, `schoolId`, `districtId` | Partially Implemented | `platform/functions/src/shared/auth/claims.ts:53-101` | Single helper exists; atomicity across three fields awaits §20 item 1. |
| §20 checklist items 3-9 (validation, transaction boundaries, audit emission, rules, indexes, tests, app-side session reconciliation) | Missing | (broad) | Not implemented. |
| §20 checklist items 10-11 (migration and deployment validation) | Not Applicable | (out of scope until item 1 lands) | Sprint 11A only inventories. |

## 6. PDR-026 Assessment Implementation Inventory

| # | Contract requirement | Status | Evidence | Explanation |
| - | -------------------- | ------ | -------- | ----------- |
| §5 assessment lifecycle (authored, published, revised, retired) | Missing | (no `assessments/*` collection referenced anywhere in `platform/functions/src` or `platform/firebase/firestore.rules`) | No authoring, deployment, or lifecycle path exists. |
| §6 session lifecycle (`Live`, transient `Submitted`, `Archived`) | Missing | (no `assessmentSessions` collection or callable exists) | Autosave, resume, and expire semantics are entirely absent. |
| §6 one-Live-session invariant | Missing | (no session collection) | Awaits §6. |
| §7 attempt lifecycle (finalized, immutable, `attemptNumber` ordinal) | Missing | (no `attempts` collection; the current surface is `submissions/{assignmentId}__{studentId}` with a single-attempt shape and no attempt ordinal) | See `platform/functions/src/shared/types/submission.ts`, `platform/functions/src/submissions/submissions-finalize.ts`. |
| §8 submission transaction inside `assessmentAttemptsFinalize` | Missing | (callable does not exist; the current split is `submissionsCreate` + `submissionsFinalize` at `platform/functions/src/submissions/submissions-create.ts` and `submissions-finalize.ts`) | The two-callable split is superseded by PDR-026 §21 and §26. |
| §9 assessment revision lifecycle (`assessmentRevisions/*`) | Missing | (no collection or writer) | Not implemented. |
| §10 archived session recovery and purge | Missing | (no scheduled functions of these names exist in `platform/functions/src/index.ts`) | Not implemented. |
| §11 collection ownership matrix (`assessments`, `assessmentRevisions`, `assessmentAnswerKeys`, `assessmentSessions`, `attempts`, `attemptRollups`, `assignmentRollups`) | Missing | (none of the seven collections is defined in code) | Reconciliation with `submissions` is required by §26. |
| §12 deterministic identifier construction (`assessment_{activityId}`, `{assessmentId}__r{ordinal}`, `{assignmentId}__{studentId}__{sessionOrdinal}`, `{assignmentId}__{studentId}__a{attemptNumber}`) | Missing | (no identifier constructor helper for any of the above; the current submission identifier `{assignmentId}__{studentId}` is defined at `platform/functions/src/shared/types/submission.ts:5`) | Awaits §11. |
| §13 collection relationships (attempt as leaf, rollup as derived) | Missing | (no rollups exist) | Awaits §11. |
| §14 immutability posture on attempts, revisions, answer keys, audit events | Partially Implemented | `platform/firebase/firestore.rules:317-319` | `auditEvents` immutability is enforced. All other rows await §11. |
| §15 answer-key confidentiality (`assessmentAnswerKeys/*` unreadable by every role) | Missing | (no rule match for `assessmentAnswerKeys/*`; would inherit terminal deny once created) | Rule-layer enforcement can be added trivially once the collection lands. |
| §16 assessment vs assignment publication separation | Not Applicable | (no assessment publication path exists to violate the separation) | Deferred. |
| §17 assignment relationship fields consumed (`mode`, `status`, `availableAt`, `windowClosesAt`, `lessonSlug`, `lessonVersion`) | Partially Implemented | `platform/functions/src/shared/types/assignment.ts`, `platform/functions/src/assignments/assignments-publish.ts` | Assignment shape already carries these fields (Sprint 6D). No callable in this contract yet consumes them. |
| §18-§20 student results, my results read contract, teacher analytics ownership (`attemptRollups`, `assignmentRollups`, `My Results` query) | Missing | (no rollup collection; app has no My Results read implementation) | Awaits §11. |
| §21 Cloud Function ownership matrix (`assessmentSessionsBegin`, `Autosave`, `Resume`, `assessmentAttemptsFinalize`, `assessmentAttemptsGetForStudent`, `GetForTeacher`, `SweepExpired`, `PurgeArchived`, `Recover`, `assessmentRollupsRecomputeAttempt`, `assessmentAnswerKeysAdministrativeRead`) | Missing | `platform/functions/src/index.ts` | None of the eleven callables is exported. |
| §22 Firestore Rules invariants for each of the seven assessment collections | Missing | `platform/firebase/firestore.rules` | No rule match exists for `assessmentSessions`, `attempts`, `attemptRollups`, `assignmentRollups`, `assessments`, `assessmentRevisions`, or `assessmentAnswerKeys`. |
| §23 composite indexes | Missing | `platform/firebase/firestore.indexes.json` (empty `indexes: []`) | Not present. |
| §24 audit vocabulary (`assessment.sessionBegan`, `assessment.attemptFinalized`, `sessionArchived`, `sessionPurged`, `sessionRecovered`, `answerKeyRead`) | Missing | `platform/functions/src/shared/audit/write-audit-event.ts` | Emitter exists; no assessment-namespaced action names are emitted by any callable. |
| §25 error contract (`session-not-found`, `session-not-owned`, `session-not-live`, `session-frozen-field-write`, `session-already-live`, `attempt-idempotent-replay`, `attempt-write-conflict`, `answer-key-integrity`, `scorer-unavailable`, `assessment-retired`, `assessment-revision-missing`, `assignment-mode-invalid`) | Missing | `platform/functions/src/shared/errors/platform-error.ts` | Closed set not declared. |
| §26 reconciliation with existing `submissions` surface | Not Applicable in Sprint 11A | `platform/functions/src/submissions/*`, `platform/firebase/firestore.rules:207-216`, `platform/firebase/tests/submissions.rules.test.ts` | Contract mandates a documentation-only step in Sprint 10A; the migration is authored by the sprint that lands the attempt pipeline. |
| §27 required Firestore Rules tests | Missing | `platform/firebase/tests/*.rules.test.ts` | No test targets any assessment collection. |
| §28 required emulator tests | Missing | `platform/functions/src/**/*.test.ts` | No test targets any assessment callable. |
| §29 implementation checklist items 1-14 | Missing | (broad) | Not implemented. |

## 7. PDR-027 Google Classroom Deep-Link Inventory

| # | Contract requirement | Status | Evidence | Explanation |
| - | -------------------- | ------ | -------- | ----------- |
| §5 provider registry with `googleClassroom` closed set | Implemented | `platform/functions/src/lms/providers-list.ts`, `platform/functions/src/lms/providers/registry.ts`, `platform/firebase/firestore.rules:226-228` | Provider registry, callable, and `lmsProviders` rule are present. |
| §6 canonical assignment identity unaffected by publication | Implemented | `platform/functions/src/shared/types/assignment.ts`, `platform/functions/src/lms/assignments-publish.ts` | Publication updates only the mirror pointer; the assignment record is unchanged. |
| §6 optional `lmsPublicationRef` on `assignments/{assignmentId}` | Partially Implemented | `platform/functions/src/lms/assignments-publish.ts` (writes an LMS publication reference on success) | Field is written on success; confirm exact key name aligns with contract during PDR-027 sprint. |
| §7 external assignment identifier fields on `lmsAssignmentPublications` (`provider`, `providerCourseId`, `providerCourseWorkId`, `providerCourseWorkAlternateLink`, optional `providerTopicId`) | Partially Implemented | `platform/functions/src/shared/types/lms.ts`, `platform/functions/src/lms/assignments-publish.ts` | Publication document is written by the current callable; specific field names must be reconciled to the contract's names in the sprint that lands PDR-027. |
| §8.1 URL shape `https://lyfelabz.com/app/a/{assignmentId}` | Missing | `platform/functions/src/lms/assignments-publish.ts:60-84` | The callable accepts `lyfelabzAssignmentUrl` from the client; no URL builder enforces the shape. |
| §8.2 URL prohibited content (no tokens, no PII, no lesson slug) | Missing | `platform/functions/src/lms/assignments-publish.ts` | The callable does not validate URL content beyond `non-empty string`. |
| §8.3 server-side URL emission (no client-supplied URL) | Conflicting | `platform/functions/src/lms/assignments-publish.ts:60-84` | Client currently supplies `lyfelabzAssignmentUrl`; PDR-027 §8.3 forbids this. |
| §8.4 URL verification (`assignmentId` shape check; `Referer` not trusted; query and fragment stripped) | Missing | (no resolver callable exists) | Requires `lmsDeepLinkResolve`. |
| §9 client storage prohibitions for deep-link arrivals | Not Applicable | (app has no deep-link arrival handler yet) | Awaits §10. |
| §10 link resolution lifecycle (`lmsDeepLinkResolve`) | Missing | `platform/functions/src/lms/index.ts` | Callable not exported. |
| §10.1 resolution rules (auth, role, status, assignment load, district match, enrollment active, assignment status) | Missing | (no callable) | Awaits §10. |
| §10.2 resolution payload (`assignmentId`, `classId`, `activityId`, `internalTarget`, `attemptContext`) | Missing | (no callable) | Awaits §10. |
| §10.3 resolver non-responsibilities (does not write sessions, attempts, assignments, publications, links) | Not Applicable | (no callable) | Awaits §10. |
| §11 publication transaction (verify caller, load link, verify link status, publish LyfeLabz draft, compute deterministic id, refresh OAuth, construct URL, call Classroom, on success write publication and audit, on failure emit `lms.publishFailed`) | Partially Implemented | `platform/functions/src/lms/assignments-publish.ts` | Callable exists (`lmsAssignmentsPublish`, plural), performs OAuth refresh through the token store, calls Classroom adapter, records outcome. Reconciliations required: rename to `lmsAssignmentPublish`, remove client URL, adopt deterministic ordinal identifier `{assignmentId}__{lmsClassLinkId}__p{ordinal}`, add ownership drift detection, add `district-mismatch` refusal. |
| §11.2 publication ordering with the Assign Experience (publication requires assignment `published` or in-flight transition) | Partially Implemented | `platform/functions/src/lms/assignments-publish.ts` | Callable accepts `draft` and `published`; contract requires the transition path be explicit. |
| §12 deterministic `publicationId` construction `{assignmentId}__{lmsClassLinkId}__p{ordinal}` | Missing | `platform/functions/src/lms/shared/ids.ts` | Present id constructors do not produce the ordinal-suffixed identifier the contract requires. |
| §13 ownership matrix (only `lmsAssignmentPublish` writes `lmsAssignmentPublications/*` and `assignments/{assignmentId}.lmsPublicationRef`) | Implemented (constraint honored today) | `platform/functions/src/lms/assignments-publish.ts` | The existing callable is the sole writer of the publication mirror. |
| §14 multiple-class publication behavior (per-target callable, no batched payload) | Partially Implemented | `platform/functions/src/lms/assignments-publish.ts` | Callable is per-target; fan-out orchestration lives in the Assign Experience layer. |
| §15 multiple-teacher publication behavior (owning teacher only; ownership drift refusal with `lms.ownershipDrift`) | Missing | `platform/functions/src/lms/assignments-publish.ts` | Owning-teacher check is performed via `assignment.teacherId`. Drift detection on the Classroom side is not implemented. |
| §16 Classroom synchronization ownership boundaries (LyfeLabz never posts to stream, comments, grades, etc.) | Implemented (by absence) | `platform/functions/src/lms/providers/google-classroom/adapter.ts` | Adapter surface does not implement any prohibited call. |
| §17 callable ownership matrix (`lmsAssignmentPublish`, `lmsAssignmentUnpublish`, `lmsDeepLinkResolve`, `lmsClassImport`, `lmsClassRefresh`, `lmsClassUnlink`, `lmsOwnershipDriftHandler`) | Partially Implemented | `platform/functions/src/index.ts` | `lmsAssignmentsPublish` (name mismatch), `lmsClassesImport`, `lmsClassesRefresh` present; `lmsDeepLinkResolve`, `lmsAssignmentUnpublish`, `lmsClassUnlink`, `lmsOwnershipDriftHandler` missing. |
| §18 interaction with refresh, unlink, broken link | Partially Implemented | `platform/functions/src/lms/classes-refresh.ts` | Refresh callable exists; unlink and broken-link publication interactions await downstream contracts. |
| §19 security boundaries (server-authoritative Classroom calls, no cross-district publication, no answer-key exposure, no score exposure) | Partially Implemented | `platform/functions/src/lms/assignments-publish.ts`, token store at `platform/functions/src/lms/tokens/token-store.ts` | Server-side Classroom calls and token store are correctly server-only; district and answer-key concerns are downstream. |
| §20 district enforcement expectations | Missing | `platform/functions/src/lms/assignments-publish.ts` | No `districtId` derivation or comparison. |
| §21 error contract (`publication-class-mismatch`, `publication-duplicate`, `link-not-linked`, `connection-revoked`, `ownership-drift`, `provider-unavailable`, `provider-refused`, `provider-rate-limited`, `deep-link-shape-invalid`, `idempotency-marker-mismatch`) | Partially Implemented | `platform/functions/src/lms/assignments-publish.ts`, `platform/functions/src/lms/tokens/token-store.ts` | Several LMS-scoped identifiers exist under `lms.*` namespaces; the exact canonical names above must be adopted by the sprint that lands PDR-027. |
| §22 required indexes on `lmsAssignmentPublications` (`assignmentId, lmsClassLinkId, ordinal desc`; `teacherId, publishedAt desc`; `districtId, publishedAt desc`) | Missing | `platform/firebase/firestore.indexes.json` | Empty. |
| §23 audit vocabulary (`lms.assignmentPublished`, `lms.publishFailed`, `lms.deepLinkResolved`, `lms.ownershipDrift`, `lms.assignmentUnpublished`) | Partially Implemented | `platform/functions/src/lms/assignments-publish.ts` | `lms.assignmentPublished` and `lms.publishFailed` are emitted; `lms.deepLinkResolved`, `lms.ownershipDrift`, `lms.assignmentUnpublished` are not. |
| §24 emulator tests | Partially Implemented | `platform/functions/src/lms/classes-refresh.test.ts` | Only `classes-refresh` has a test file. Every publication and resolver test is missing. |
| §25 unit tests (URL builder, parser, deterministic identifier, adapter link material discipline, static import graph) | Missing | (broad) | Not implemented. |
| §26 implementation checklist items 1-12 | Missing | (broad) | Not implemented. |

## 8. PDR-028 Roster Display Name Inventory

| # | Contract requirement | Status | Evidence | Explanation |
| - | -------------------- | ------ | -------- | ----------- |
| §5 canonical identity versus display identity | Implemented | `platform/functions/src/shared/types/user.ts`, `platform/firebase/firestore.rules:47-49`, `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` | Identity is `authUid`; the display name is a distinct field; no callable branches on display-name value. |
| §6 sole writers of `users/{uid}.displayName` (activation callables + user self-update) | Partially Implemented | `platform/functions/src/auth/auth-on-user-create.ts:32-35`, `platform/functions/src/teachers/teachers-approve-verification.ts`, `platform/functions/src/students/students-complete-onboarding.ts`, `platform/firebase/firestore.rules:33-49` | Provisioning seed, activation writes, and the Sprint 2 rules-allowlisted self-write are present. `usersUpdateProfile` and `usersFirstSignInActivation` are missing. |
| §6 sole writer of `enrollments/{enrollmentId}.displayNameOverride` (`enrollmentsSetDisplayNameOverride`) | Partially Implemented | `platform/functions/src/enrollments/enrollments-join-by-code.ts:97-104,230-233`, `platform/functions/src/enrollments/enrollments-teacher-add.ts:119-127,281-283`, `platform/functions/src/shared/types/enrollment.ts:22-50` | The override field is written today by two callables (join and teacher-add) at enrollment creation. There is no dedicated `enrollmentsSetDisplayNameOverride` callable to change the override on an existing enrollment, and no clear-field path exists. |
| §6 sole writer of roster placeholder name (server-only, `lmsClassImport` and `lmsClassRefresh`) | Missing | `platform/functions/src/lms/classes-import.ts:45-47` | Import explicitly does not touch enrollments; the placeholder shape is not chosen. |
| §7 Firestore ownership model | Partially Implemented | see rows above | Fields exist on `users` and `enrollments`; no placeholder collection or subcollection exists. |
| §7.1 roster placeholder shape (enrollment-as-placeholder OR separate `rosterPlaceholders/*`) | Missing | (no `placeholderName` field on `enrollments`; no `rosterPlaceholders` collection exists) | Choice deferred to the sprint that lands PDR-028. |
| §8 collection relationships (single-source `users.displayName`; per-class override never propagates) | Implemented | `platform/functions/src/shared/types/user.ts`, `platform/functions/src/shared/types/enrollment.ts` | The current shapes honor this. |
| §9 enrollment and roster resolution (`override -> displayName -> placeholder -> null`) | Missing | (no shared resolver exists in `platform/functions/src/shared` or `app/src`) | Not implemented. |
| §10.1 provisioning seed of `users/{uid}.displayName` from Firebase Auth record | Implemented | `platform/functions/src/auth/auth-on-user-create.ts:32-35` | The initial seed exists and does not emit `users.displayNameChanged`. |
| §10.2 activation writes may ratify `displayName`, emit `users.displayNameChanged` only when value changes | Partially Implemented | `platform/functions/src/teachers/teachers-approve-verification.ts`, `platform/functions/src/students/students-complete-onboarding.ts` | Activation writes exist; no callable currently emits `users.displayNameChanged`. |
| §10.3 user-initiated rename path (Option A `usersOnDisplayNameChange` trigger, or Option B `usersUpdateProfile` callable) | Partially Implemented | `platform/firebase/firestore.rules:33-49` | The Sprint 2 self-write path exists; neither the trigger nor the callable exists. Convergence decision unresolved. |
| §10.4 no Google profile re-read after §10.1 | Implemented (by absence) | `platform/functions/src/auth/auth-on-user-create.ts:32-35`, `platform/functions/src/**` | No callable reads a Google profile after `authOnUserCreate`. |
| §10.5 LMS refresh delta handling (placeholder path only; no `users/*` write) | Missing | `platform/functions/src/lms/classes-refresh.ts` | Refresh does not touch display names today because no placeholder exists. |
| §10.6 per-class override change semantics (set and clear, `enrollments.displayNameOverrideChanged`) | Missing | (no post-enrollment override mutation path) | See §6 row. |
| §10.7 placeholder resolution on first sign-in (`usersFirstSignInActivation`, `roster.placeholderResolved`) | Missing | (no callable of this name exists) | Not implemented. |
| §11 Google profile interaction rules | Implemented | See §10.1 and §10.4 rows | Correctly honored by the current provisioning path. |
| §11.1 placeholder-name sourcing at import | Missing | `platform/functions/src/lms/classes-import.ts` | Not implemented. |
| §11.2 placeholder-name refresh | Missing | `platform/functions/src/lms/classes-refresh.ts` | Not implemented. |
| §11.3 placeholder resolution | Missing | (no first-sign-in callable) | Not implemented. |
| §12 teacher roster behavior (single resolver, no client fallback, sort client-side, placeholder rendering, historical consistency, cross-class denial) | Missing | `app/src/**` | No teacher roster surface consumes a resolver today. |
| §13.1 shared display-name normalizer (trim, collapse whitespace, `displayName.empty`, `displayName.tooLong` 60 code points, refuse control chars) | Missing | `platform/functions/src/shared/**` | No shared normalizer. Per-callable checks in `enrollments-join-by-code.ts:95-104` and `enrollments-teacher-add.ts:119-127` inline non-canonical validation. |
| §14 callable ownership matrix (`authOnUserCreate`, `teachersCompleteVerification`, `studentsCompleteOnboarding`, `usersFirstSignInActivation`, `usersUpdateProfile`, `enrollmentsSetDisplayNameOverride`, `lmsClassImport`, `lmsClassRefresh`) | Partially Implemented | `platform/functions/src/index.ts` | Present today: `authOnUserCreate`, `teachersApproveVerification` (naming), `studentsCompleteOnboarding`, `lmsClassesImport`, `lmsClassesRefresh`. Missing: `usersFirstSignInActivation`, `usersUpdateProfile` (or `usersOnDisplayNameChange` trigger), `enrollmentsSetDisplayNameOverride`. |
| §14.1 convergence decision (Option A or Option B) | Missing (decision deferred) | See §10.3 row | Awaits sprint scope. |
| §15 Firestore Security Rule expectations for display-name reads/writes | Partially Implemented | `platform/firebase/firestore.rules:47-49,125-142,169-183` | Self-update allowlist and enrollment scoping honored; `displayNameOverride` diff-restriction on `update` is not enforced because no client `update` is authorized today. |
| §16 error contract (`displayName.empty`, `displayName.tooLong`, `displayName.invalidCharacter`, `displayName.unchanged`, `enrollments.notFound`, `enrollments.forbidden`, `roster.placeholderNotFound`, `roster.placeholderAlreadyResolved`) | Missing | `platform/functions/src/shared/errors/platform-error.ts` | Not declared. |
| §17 required indexes (`users` `(schoolId, role, displayName asc)`; enrollments existing indexes) | Missing | `platform/firebase/firestore.indexes.json` | Empty. |
| §18 required emulator tests | Missing | `platform/functions/src/**/*.test.ts` | No test covers the display-name synchronization rules. |
| §19 required unit tests (normalizer, resolver purity, audit vocabulary, static import graph) | Missing | (broad) | Not implemented. |
| §20 audit vocabulary (`users.displayNameChanged`, `enrollments.displayNameOverrideChanged`, `roster.placeholderNameChanged`, `roster.placeholderResolved`) | Missing | `platform/functions/src/shared/audit/write-audit-event.ts` | Emitter exists; none of the four action names is written. |
| §21 implementation checklist items 1-12 | Missing | (broad) | Not implemented. |

## 9. Cross-Contract Dependencies

- **Claim shape.** PDR-025 §6 owns the canonical claim shape `{ role, schoolId, districtId }`. PDR-026 §21 (`assessmentSessionsBegin`, `assessmentAttemptsFinalize`, teacher analytics reads) and PDR-027 §17 (`lmsAssignmentPublish`, `lmsDeepLinkResolve`) and PDR-028 §14 (every rename path) all consume the shape as a precondition. The claim contract must land first.
- **Denormalized `districtId`.** PDR-025 §10 requires `districtId` on `classes`, `enrollments`, `assignments`, `submissions` (superseded by `attempts` per PDR-026 §26), `auditEvents`, and the new assessment collections. PDR-026 §11 and PDR-027 §13 both rely on the denormalization for rule-layer decisions.
- **Error identifier vocabulary.** PDR-025 §17, PDR-026 §25, PDR-027 §21, and PDR-028 §16 all preserve pre-existing names; the shared errors module (`platform/functions/src/shared/errors/platform-error.ts`) is a single load-bearing surface for all four contracts.
- **Audit event writer.** `platform/functions/src/shared/audit/write-audit-event.ts` is one sink for every canonical event listed in the four contracts. The `districtId` field on every emitted event is required by PDR-025 §16 and inherited by PDR-026 §24, PDR-027 §23, and PDR-028 §20.
- **Assignment record fields.** PDR-027 §6 adds `lmsPublicationRef`; PDR-026 §17 reads `assignments/{assignmentId}.mode/status/availableAt/windowClosesAt`. Both contracts leave the assignment shape otherwise untouched (Sprint 6D authoritative).
- **Roster placeholder shape.** PDR-028 §7.1 owns the choice; PDR-025 §7 references the `awaitingFirstSignIn` state on the same shape. The two contracts must agree on the same shape at implementation time.
- **`usersFirstSignInActivation`.** Both PDR-025 §9 and PDR-028 §14 name this callable. It is one implementation, not two.
- **Lifecycle callable ownership (`assignmentsPublish`).** PDR-026 §17 reads `assignments/{assignmentId}` state; PDR-027 §11 publishes it. The Sprint 6D callable (`platform/functions/src/assignments/assignments-publish.ts`) is preserved.

## 10. Existing Implementation That Must Be Preserved

- Canonical claims helper (`platform/functions/src/shared/auth/claims.ts`) as the single write path; extend, do not duplicate.
- `PlatformError` typed error class (`platform/functions/src/shared/errors/platform-error.ts`) as the single throwable used by callables.
- Typed Firestore reference helpers (`platform/functions/src/shared/firestore/typed-ref.ts`) and shared type barrel (`platform/functions/src/shared/index.ts`).
- Audit event writer (`platform/functions/src/shared/audit/write-audit-event.ts`) as the single audit sink.
- Sprint 2 rules-allowlisted self-write on `users/{uid}.displayName` (`platform/firebase/firestore.rules:33-49`). Preserve under PDR-028 §14.1 Option A unless the sprint that lands PDR-028 chooses Option B.
- Server-only write posture and default-deny terminal rule (`platform/firebase/firestore.rules:317-323`).
- Existing role, ownership, and status invariants on `users`, `schools`, `classes`, `enrollments`, `assignments`, `submissions`, `lmsConnections`, `lmsClassLinks`, `lmsAssignmentPublications`, and `auditEvents`.
- Every certified per-callable audit event already emitted by callables under `platform/functions/src/{auth,teachers,students,classes,enrollments,assignments,submissions,schools,lms}/`.
- The LMS OAuth token store as the sole server-side token surface (`platform/functions/src/lms/tokens/token-store.ts`).
- Rules test setup and existing tests under `platform/firebase/tests/`.
- App-side session bootstrap and consistency helpers (`app/src/session/bootstrap.ts`, `app/src/session/consistency.ts`) as the sole client authorization entry point.

## 11. Conflicts and Reconciliation Needs

Every conflict listed here is a certified reconciliation the sprint that lands the relevant contract MUST honor. Sprint 11A does not resolve them.

1. **Claim shape omits `districtId`.**
   - Current: `CanonicalCustomClaims = { role, schoolId }` at `platform/functions/src/shared/auth/claims.ts:17-20`.
   - Required: `{ role, schoolId, districtId }` per PDR-025 §6.
   - Affected: `platform/functions/src/shared/auth/claims.ts`, every callable that invokes `writeCustomClaims` (`teachers-approve-verification.ts`, `students-complete-onboarding.ts`, and any future first-sign-in callable), and every Rules invariant that consumes `token.districtId` under PDR-025 §11.
   - Action: extend the shape, extend the writer's atomicity guarantee, extend claim-refresh signaling; migrate existing `active` users' Firestore records to carry a resolved `districtId`.
   - Migration required: yes, per PDR-025 §20 item 10.
2. **Submissions collection versus attempts collection.**
   - Current: `submissions/{assignmentId}__{studentId}` with `submissionsCreate` and `submissionsFinalize` at `platform/functions/src/submissions/*` and Rules at `platform/firebase/firestore.rules:207-216`.
   - Required: `attempts/{attemptId}` with `assessmentAttemptsFinalize` sole writer per PDR-026 §11, §21, §26.
   - Action: staged migration per PDR-026 §26; two collections MUST NOT be simultaneously writable in production.
   - Migration required: yes.
3. **Deep-link URL supplied by client.**
   - Current: `lmsAssignmentsPublish` accepts `lyfelabzAssignmentUrl` from the payload at `platform/functions/src/lms/assignments-publish.ts:60-84`.
   - Required: PDR-027 §8.3 makes the server the sole constructor of the URL; the client never sees the URL before it is written.
   - Action: remove the client field; introduce the single deep-link URL builder (`https://lyfelabz.com/app/a/{assignmentId}`).
   - Migration required: no. Existing published Classroom coursework records are unaffected because the URL builder produces the same shape they already carry.
4. **Publication callable name.**
   - Current: `lmsAssignmentsPublish` (plural) at `platform/functions/src/lms/assignments-publish.ts`.
   - Required: `lmsAssignmentPublish` (singular) per PDR-027 §17.
   - Action: rename the export and the callable name at deployment; preserve the request payload shape where compatible.
   - Migration required: coordinated client cutover only.
5. **Rules do not compare `districtId`.**
   - Current: `platform/firebase/firestore.rules` scopes by `teacherId`, `studentId`, `ownerUid`.
   - Required: PDR-025 §11 requires a `districtId` claim vs resource `districtId` comparison on every district-scoped read and write.
   - Action: extend every rule after the claim shape and denormalization land.
   - Migration required: implicit in item 1.
6. **`displayNameOverride` written outside `enrollmentsSetDisplayNameOverride`.**
   - Current: `enrollments-join-by-code.ts` and `enrollments-teacher-add.ts` write `displayNameOverride` at enrollment creation.
   - Required: PDR-028 §6 permits creation-time writes but names `enrollmentsSetDisplayNameOverride` as the sole authorized post-enrollment writer; every change after creation MUST emit `enrollments.displayNameOverrideChanged`.
   - Action: introduce the callable; leave creation-time writes untouched but ensure the new callable is the sole mutator on existing enrollments.
   - Migration required: no.
7. **No display-name audit events.**
   - Current: no callable emits `users.displayNameChanged`, `enrollments.displayNameOverrideChanged`, `roster.placeholderNameChanged`, or `roster.placeholderResolved`.
   - Required: PDR-028 §20.
   - Action: land the trigger (Option A) or the callable (Option B) and update each activation callable to emit only on value change.
   - Migration required: no.

## 12. Missing Test Coverage

**Functions unit tests.** Missing coverage for:

- Extended claim shape write and reissue behavior (`platform/functions/src/shared/auth/claims.test.ts` currently pins the two-field shape).
- Every callable in the PDR-026 §21 matrix.
- `lmsAssignmentPublish` (renamed) unit test coverage of the URL builder, deterministic identifier, ownership-drift refusal, and idempotent-replay path (only `platform/functions/src/lms/classes-refresh.test.ts` exists today).
- `lmsDeepLinkResolve` unit tests per PDR-027 §25.
- Display-name normalizer, resolver purity, and the static import graph assertion per PDR-028 §19.

**Firestore Rules tests.** Missing coverage for:

- Every case in PDR-025 §18 (same-district permit, cross-district deny, inactive account deny, stale-claim deny, forged payload deny, forged parent deny, school-district mismatch, class-district mismatch, enrollment mismatch, assignment mismatch, submission mismatch, platform administrator scoping, server-only writes on identity fields, audit-event write restrictions).
- Every case in PDR-026 §27 (student session self read, teacher session read denied, session frozen-field write denied, non-owner session update denied, student attempt read, teacher attempt read scoping, cross-district denial, client attempt-write denial, client session create denial, answer-key read denial for every role including administrator, client rollup write denial, audit-event write restrictions).
- Any case in PDR-028 §15 that exercises cross-class deny and cross-district deny on display-name reads.

**App tests.** Missing coverage for:

- Claim-refresh signal handling per PDR-025 §15 and §20 item 9 (`app/src/session/bootstrap.ts` and `app/src/session/consistency.ts` do not yet exercise the `districtId` claim path against a canonical record).
- Deep-link arrival router (`app/src/router/routes.ts` has no `/app/a/{assignmentId}` handler).
- Roster resolver (`app/src` has no shared resolver for display-name rendering).

**Integration or emulator coverage.** Missing coverage for:

- PDR-026 §28 (session begin, autosave, resume, finalize, sweep, purge, recover, rollup recompute, answer-key administrative read).
- PDR-027 §24 (publication happy path, idempotency, refusal branches, fan-out, resolver happy path and refusals).
- PDR-028 §18 (activation writes emit audit event only on change; override set and clear; placeholder resolve; static write-path assertion).

## 13. Recommended Implementation Sequence

Every slice is bounded by "one logical prompt, one local emulator verification". Slices are ordered so each unblocks the next.

1. **Slice 1 - PDR-025 shared district context.**
   - Requirement: PDR-025 §6, §17, §20 items 1-3.
   - Files: `platform/functions/src/shared/auth/claims.ts` (extend `CanonicalCustomClaims`), `platform/functions/src/shared/errors/platform-error.ts` (add district-error identifiers), new `platform/functions/src/shared/auth/require-district-context.ts` (verify caller, load `users/{uid}`, resolve `schools/{schoolId}.districtId`, return typed context).
   - Tests: `platform/functions/src/shared/auth/claims.test.ts` extended; new `require-district-context.test.ts`.
   - Dependencies: none.
   - Completion: helper importable; existing callables unchanged; claims test suite green.

2. **Slice 2 - PDR-025 activation callables issue district claim.**
   - Requirement: PDR-025 §8 and §9.
   - Files: `platform/functions/src/teachers/teachers-approve-verification.ts`, `platform/functions/src/students/students-complete-onboarding.ts`, `platform/functions/src/shared/types/user.ts` (extend write shapes to carry `districtId`).
   - Tests: existing per-callable tests extended.
   - Dependencies: Slice 1.

3. **Slice 3 - PDR-025 denormalization on child resources.**
   - Requirement: PDR-025 §10, §13.
   - Files: `classes-create.ts`, every `enrollments-*.ts`, every `assignments-*.ts`, every `submissions-*.ts`, `lms/assignments-publish.ts`, shared types for each.
   - Tests: per-callable emulator tests, Rules tests for direct-comparison invariants.
   - Dependencies: Slices 1-2.

4. **Slice 4 - PDR-025 Rules invariants.**
   - Requirement: PDR-025 §11, §18.
   - Files: `platform/firebase/firestore.rules`, `platform/firebase/tests/*.rules.test.ts`.
   - Dependencies: Slice 3.

5. **Slice 5 - PDR-025 stale-claim handling and app-side reconciliation.**
   - Requirement: PDR-025 §15, §20 item 9.
   - Files: `app/src/session/consistency.ts`, `app/src/session/bootstrap.ts`.
   - Dependencies: Slices 1-4.

6. **Slice 6 - PDR-028 shared normalizer, resolver, audit vocabulary.**
   - Requirement: PDR-028 §9, §13.1, §16, §20.
   - Files: new `platform/functions/src/shared/display-name/normalizer.ts`, new `resolver.ts`; extend `platform/functions/src/shared/errors/platform-error.ts` and audit types.
   - Dependencies: Slice 1.

7. **Slice 7 - PDR-028 rename path (Option A recommended: `usersOnDisplayNameChange` trigger).**
   - Requirement: PDR-028 §10.3, §14.1.
   - Files: new `platform/functions/src/users/users-on-display-name-change.ts`; index export.
   - Dependencies: Slice 6.

8. **Slice 8 - PDR-028 `enrollmentsSetDisplayNameOverride` and audit emission on activation callables.**
   - Requirement: PDR-028 §10.2, §10.6, §14.
   - Files: new `enrollments-set-display-name-override.ts`; extensions on `teachers-approve-verification.ts`, `students-complete-onboarding.ts`.
   - Dependencies: Slices 1, 6.

9. **Slice 9 - PDR-028 roster placeholder shape and `usersFirstSignInActivation`.**
   - Requirement: PDR-028 §7.1, §10.7, §11; PDR-025 §7 `awaitingFirstSignIn`.
   - Files: shape choice recorded; new `users-first-sign-in-activation.ts`; `lms/classes-import.ts` extended to write placeholders.
   - Dependencies: Slices 1-8.

10. **Slice 10 - PDR-027 URL builder, parser, deterministic identifier.**
    - Requirement: PDR-027 §8, §12, §26 items 2-3.
    - Files: new `platform/functions/src/lms/deep-link/url.ts`, extend `lms/shared/ids.ts`.
    - Dependencies: Slice 1.

11. **Slice 11 - PDR-027 publication callable reconciliation.**
    - Requirement: PDR-027 §11, §15, §21, §23.
    - Files: rename to `lms/assignment-publish.ts` (singular export); remove client URL; add ownership-drift refusal; add `district-mismatch` refusal.
    - Dependencies: Slices 1-4, Slice 10.

12. **Slice 12 - PDR-027 `lmsDeepLinkResolve`.**
    - Requirement: PDR-027 §10.
    - Files: new `lms/deep-link-resolve.ts`; new `app/src/router` deep-link handler at `/app/a/{assignmentId}`.
    - Dependencies: Slices 1-5, Slice 10.

13. **Slice 13 - PDR-026 assessment collection scaffolding.**
    - Requirement: PDR-026 §11, §12, §14.
    - Files: shared types for the seven assessment collections, deterministic id constructors, Rules matches for `assessmentAnswerKeys` (deny-all), `assessments`, `assessmentRevisions` (authenticated read), `assessmentSessions`, `attempts`, `attemptRollups`, `assignmentRollups`.
    - Dependencies: Slice 4.

14. **Slice 14 - PDR-026 session callables (`assessmentSessionsBegin`, `Autosave`, `Resume`).**
    - Requirement: PDR-026 §6, §21.
    - Dependencies: Slice 13.

15. **Slice 15 - PDR-026 attempt transaction (`assessmentAttemptsFinalize`).**
    - Requirement: PDR-026 §7, §8, §21.
    - Dependencies: Slice 14.

16. **Slice 16 - PDR-026 rollup Cloud Function.**
    - Requirement: PDR-026 §21 (`assessmentRollupsRecomputeAttempt`).
    - Dependencies: Slice 15.

17. **Slice 17 - PDR-026 scheduled sweep, purge, and administrative recover; answer-key administrative read.**
    - Requirement: PDR-026 §10, §21.
    - Dependencies: Slices 15-16.

18. **Slice 18 - PDR-026 `submissions` -> `attempts` migration and cutover.**
    - Requirement: PDR-026 §26.
    - Dependencies: Slices 13-17.

19. **Slice 19 - PDR-026 read-model consumers (`My Results`, teacher analytics).**
    - Requirement: PDR-026 §18-§20.
    - Dependencies: Slices 15-18.

20. **Slice 20 - PDR-027 unpublish callable (deferred G-10A-9); PDR-025 transfer callable and administrator sentinel (deferred G-10A-2, G-10A-3).**
    - Requirement: PDR-027 §17 (reserved), PDR-025 §14.
    - Dependencies: all prior slices.

## 14. Recommended Sprint 11B Scope

**Slice 1 - PDR-025 shared district context.** Exactly:

- Extend `platform/functions/src/shared/auth/claims.ts` so `CanonicalCustomClaims` and `WriteCustomClaimsInput` require `districtId` alongside `role` and `schoolId`. Preserve the single-writer property, the `status === "active"` precondition, and the atomic replacement guarantee. Update the claims unit test to pin the three-field shape.
- Extend `platform/functions/src/shared/errors/platform-error.ts` (or a colocated constants module) with the closed set of district-boundary error identifiers from PDR-025 §17 (`unauthenticated`, `account-inactive`, `role-forbidden`, `district-unassigned`, `district-mismatch`, `school-district-mismatch`, `cross-district-reference`, `claim-stale`, `claim-state-mismatch`, `server-only-field`, `transfer-not-supported`). Names are canonical; the module declares them as a typed union so downstream callables cannot invent variants.
- Add a new `platform/functions/src/shared/auth/require-district-context.ts` helper that: verifies `request.auth.uid`; reads `users/{uid}`; refuses non-`active` status with `account-inactive`; reads `schools/{schoolId}` and derives `districtId`; refuses `district-unassigned` when absent; compares the caller claim to the record and refuses `claim-stale` on disagreement; returns a typed `{ uid, role, schoolId, districtId }` context.
- Add colocated unit tests (`require-district-context.test.ts`) covering: happy path, missing user record, non-active status, missing school record, missing `districtId` on school, disagreeing claim, disagreeing role.

Why this slice comes first:

- It is the first PDR-025 §20 implementation checklist item and unblocks every downstream contract.
- It touches only the shared module. It changes no callable behavior, no rule, no Firestore document, and no client.
- It is independently verifiable through the Jest suite under `platform/functions` without an emulator round-trip.
- It carries no migration risk because no callable yet consumes the extended shape.
- It exhibits the atomic replacement discipline PDR-025 §6 requires: the change is one file, one type, one helper, one test file, and one closed-set error module.

## 15. Open Implementation Questions

No open implementation questions were identified.

## 16. Sprint 11A Certification Statement

Sprint 11A produced an evidence-based inventory of the current LyfeLabz repository against PDR-025 through PDR-028. Every checklist item and every required test category from each of the four contracts has an entry in Section 5 through Section 8 with a status and repository evidence. Cross-contract dependencies, existing implementation to preserve, conflicts, missing tests, and a bounded implementation sequence are documented. Exactly one Sprint 11B implementation slice is selected.

The inventory is complete enough to begin Sprint 11B. This is an inventory certification only. It does not certify any implementation that has not yet occurred.

---

## Change Log

- 2026-07-13 - Initial issuance under Sprint 11A. No production implementation was changed. No architecture contract was amended.
