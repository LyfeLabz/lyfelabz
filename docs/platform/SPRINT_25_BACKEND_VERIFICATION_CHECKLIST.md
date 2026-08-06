# Sprint 25 - Backend Verification Checklist

Status: Prepared for execution. Not yet executed. This document is the
backend verification checklist for the Sprint 25 Google Classroom
assignment-publication workflow. It is executed against the running
Emulator Suite for the exact assignment, class, connection, and
publication under test after the browser certification run.

Governing documents:
- `SPRINT_25_ARCHITECTURAL_BLUEPRINT.md` §14 (backend verification plan),
  §9 (Firestore), §10 (audit)
- `SPRINT_25_IMPLEMENTATION_PLAN.md` §2.1 - §2.7 (resolved control flow)
- `SPRINT_25_PHASE_1_COMPLETION_REPORT.md` (callable control flow, guards)
- `SPRINT_25_PHASE_2_COMPLETION_REPORT.md` (connection widening, token
  lifecycle, local-only cleanup)
- `SPRINT_25_BROWSER_CERTIFICATION_CHECKLIST.md` (the run that produces
  the state verified here)
- `SPRINT_25_CERTIFICATION_RUNBOOK.md` (execution order and evidence
  rules)

Style: no em dashes. Use " - " (spaced hyphen).

Verification is read-only. Do not patch Firestore, invoke callables
directly, or inject auth to make a check pass. Every state verified here
must have been produced by the genuine browser run.

---

## 0. Data sources

| Source | How to read it |
|---|---|
| Firestore emulator | Emulator UI at `http://localhost:4000/firestore`, or a read-only Node script bound to `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. |
| Callable ledger | The Functions emulator log (`platform/firebase/firebase-debug.log`), one entry per callable invocation, in order. |
| Audit chain | `auditEvents` collection in the Firestore emulator. |
| Functions structured logs | The Functions emulator log, including `error`-severity lines for orphan / mirror-desync / audit-gap paths. |
| Secret Manager access | Functions debug log; grep for `secretmanager.googleapis.com`. |

Each check states whether it is **emulator-supported** (read from the
running emulator), **browser-supported** (observed during the browser
run), or **production-log-supported** (only visible in deployed Cloud
Logging, hence out of scope for emulator certification and deferred).

---

## 1. Checklist (V1 - V25)

### V1. Assignment createDraft callable ledger entry
- **Source:** callable ledger. **Support:** emulator-supported.
- **Expected:** For each published class, `assignmentsCreateDraft`
  appears before any publication callable.
- **Forbidden:** A publication callable with no preceding draft for that
  class.
- **Pass/fail:** PASS when every publication is preceded by a draft.

### V2. Assignment publish callable ledger entry
- **Source:** callable ledger. **Support:** emulator-supported.
- **Expected:** `assignmentsPublish` follows `assignmentsCreateDraft` and
  precedes `lmsAssignmentsPublish` for each published class.
- **Forbidden:** `lmsAssignmentsPublish` before `assignmentsPublish`.
- **Pass/fail:** PASS when order holds for every class.

### V3. Classroom publication callable ledger entry
- **Source:** callable ledger. **Support:** emulator-supported.
- **Expected:** `lmsAssignmentsPublish` appears once per toggle-on row
  per logical action (plus exactly one pre-consent insufficient-scope
  attempt and one post-consent re-issue where B9 applied), each carrying
  an `attemptNonce`.
- **Forbidden:** A duplicate publish for a single toggle-on confirm that
  is not the bounded post-consent re-issue.
- **Pass/fail:** PASS when publish invocations match the one-attempt model
  (implementation plan §2.5).

### V4. Publication occurs only after the LyfeLabz assignment is published
- **Source:** callable ledger + `assignments/{assignmentId}`. **Support:**
  emulator-supported.
- **Expected:** The assignment doc exists and is in a published lifecycle
  state before the succeeded publication record is written.
- **Forbidden:** A succeeded publication whose assignment was never
  published.
- **Pass/fail:** PASS when publication strictly follows LyfeLabz publish.

### V5. Initial insufficient-scope attempt creates no failed publication record
- **Source:** `lmsAssignmentPublications`. **Support:** emulator-supported.
- **Expected:** The pre-consent `lms.insufficientScope` outcome wrote
  **no** record for that `publicationId`.
- **Forbidden:** A `failed` record keyed on the pre-consent attempt.
- **Pass/fail:** PASS when no record exists for the insufficient-scope
  pre-consent attempt (implementation plan §2.7; Phase 1 report Phase A).

### V6. Initial insufficient-scope attempt creates no lms.publishFailed audit event
- **Source:** `auditEvents`. **Support:** emulator-supported.
- **Expected:** No `lms.publishFailed` event for the pre-consent
  insufficient-scope attempt.
- **Forbidden:** Any `lms.publishFailed` tied to the insufficient-scope
  pre-consent attempt.
- **Pass/fail:** PASS when the audit ledger has no spurious failure for
  first publish.

### V7. Incremental consent widens the existing connection document
- **Source:** `lmsConnections/{connectionId}`. **Support:**
  emulator-supported.
- **Expected:** After B9, the existing connection's `scopes` field
  includes the two coursework scopes (union of prior readonly and newly
  granted); `scopesUpdatedAt` set; same `connectionId`.
- **Forbidden:** The coursework scopes recorded on a new document.
- **Pass/fail:** PASS when the existing connection carries the widened
  scope set.

### V8. No duplicate LMS connection document is created
- **Source:** `lmsConnections` filtered by teacher + provider. **Support:**
  emulator-supported.
- **Expected:** Exactly one connection document for the (teacher,
  provider) pair (deterministic `lmsConnectionIdFor`).
- **Forbidden:** Two or more connection docs for the pair.
- **Pass/fail:** PASS when exactly one connection exists after widening.

### V9. Existing readonly scopes remain present
- **Source:** `lmsConnections/{connectionId}.scopes`. **Support:**
  emulator-supported.
- **Expected:** `classroom.courses.readonly` and
  `classroom.rosters.readonly` are still present after widening.
- **Forbidden:** Loss of a previously granted readonly scope.
- **Pass/fail:** PASS when readonly scopes survive the widening.

### V10. Required publication scopes are present after successful consent
- **Source:** `lmsConnections/{connectionId}.scopes`. **Support:**
  emulator-supported.
- **Expected:** `classroom.coursework.me` and `classroom.topics.readonly`
  are present after a successful B9 grant that led to a B7/B8 success.
- **Forbidden:** A succeeded publication whose connection lacks the
  coursework scopes.
- **Pass/fail:** PASS when both coursework scopes are recorded. (Note: a
  denied-scope path, B14, yields `alreadyAuthorized`/permission-needed
  and MUST NOT show the coursework scopes; verify that inverse where B14
  ran.)

### V11. TokenRef changes only after successful widening
- **Source:** `lmsConnections/{connectionId}.tokenRef` before/after B9.
  **Support:** browser-supported (capture before) + emulator-supported.
- **Expected:** `tokenRef` is swapped to a new opaque reference only when
  widening committed (`consentOutcome: "widened"`). An
  `alreadyAuthorized` or refused path leaves `tokenRef` unchanged.
- **Forbidden:** A changed `tokenRef` on a path that wrote nothing.
- **Pass/fail:** PASS when `tokenRef` changes iff widening committed.

### V12. Old local token bundle cleanup occurs after connection update
- **Source:** Functions log (best-effort local `revoke` line) + token
  store state. **Support:** emulator-supported.
- **Expected:** After the connection update commits, the superseded local
  token bundle is deleted (local token-store `revoke`). A cleanup failure
  is logged and does not fail the widening.
- **Forbidden:** Cleanup before the connection update commits.
- **Pass/fail:** PASS when cleanup is local-only and strictly after the
  update.

### V13. Google grant revocation is never invoked during widening
- **Source:** Functions log; adapter revoke path. **Support:**
  emulator-supported.
- **Expected:** No call to `adapter.revokeGrant` / Google's OAuth
  token-revocation endpoint during a successful widening. Only the local
  token-store delete runs (Phase 2 report §9).
- **Forbidden:** Any Google grant revocation on the widening path.
- **Pass/fail:** PASS when no Google revoke occurs. (Backed by the Phase 2
  regression test asserting `adapter.revokeGrant` is not called.)

### V14. Successful publication record has status succeeded
- **Source:** `lmsAssignmentPublications/{publicationId}`. **Support:**
  emulator-supported.
- **Expected:** For B7/B8 the record exists with `status: "succeeded"`,
  carrying `lmsAssignmentId` (and `lmsAssignmentUrl` if returned), owner
  and school denormalization present.
- **Forbidden:** A succeeded publish with no `succeeded` record, or a
  record missing owner/school denormalization.
- **Pass/fail:** PASS when the succeeded record is well-formed.

### V15. Assignment lmsPublicationRef matches the publication record
- **Source:** `assignments/{assignmentId}.lmsPublicationRef` and the
  publication doc id. **Support:** emulator-supported.
- **Expected:** On success the mirror pointer is set and references the
  `succeeded` publication. Absent before any successful publish.
- **Forbidden:** A mirror pointer set with no matching succeeded record,
  or a succeeded publish (mirror-write ok) with no pointer.
- **Pass/fail:** PASS when the mirror matches the record. (A mirror-desync
  where the record is succeeded but the pointer write failed is V20, not
  a failure of V15's success case.)

### V16. Exactly one lms.assignmentPublished audit event for the successful attempt
- **Source:** `auditEvents`. **Support:** emulator-supported.
- **Expected:** One `lms.assignmentPublished` per successful publish,
  payload carrying provider id, link id, upstream class id, upstream
  assignment id, publication id, optional topic id.
- **Forbidden:** Zero or duplicate success events for one attempt.
- **Pass/fail:** PASS when exactly one success event exists per success.

### V17. Re-issued publication uses the same attemptNonce
- **Source:** callable ledger. **Support:** emulator-supported.
- **Expected:** The pre-consent insufficient-scope attempt and the single
  post-consent re-issue carry the identical `attemptNonce`, so they
  derive the same `publicationId`.
- **Forbidden:** A re-issue with a fresh nonce inside one logical action.
- **Pass/fail:** PASS when the re-issue nonce equals the initial nonce.

### V18. Manual retry uses a fresh attemptNonce and a separate publication record
- **Source:** callable ledger + `lmsAssignmentPublications`. **Support:**
  emulator-supported.
- **Expected:** A detail-view retry (B18) uses a new `attemptNonce`,
  producing a distinct `publicationId` and a distinct record; the prior
  `failed` record is retained (append-only).
- **Forbidden:** A retry that reuses the failed attempt's nonce, or that
  overwrites the prior record.
- **Pass/fail:** PASS when retry is a new record and the prior record
  survives.

### V19. Failed publication produces the approved failed record and audit event where applicable
- **Source:** `lmsAssignmentPublications` + `auditEvents`. **Support:**
  emulator-supported.
- **Expected:** For a confirmed upstream failure (B16), one `failed`
  record and exactly one `lms.publishFailed` event, both with sanitized
  payloads. (An uncertain/timeout path, implementation plan §2.3, records
  a `failed` outcome via the abort timeout; a genuine deadline that never
  reached the catch may leave no record - if that path occurs, record it
  as the named uncertain residual, not a V19 failure.)
- **Forbidden:** A confirmed upstream failure with no `failed` record or
  no failure audit event.
- **Pass/fail:** PASS when confirmed failures write the approved record
  and event.

### V20. Mirror or audit failure cannot clobber a succeeded record
- **Source:** `lmsAssignmentPublications` + Functions `error` logs.
  **Support:** emulator-supported (only observable if a Phase B2/B3
  failure occurred naturally; otherwise verified by the Phase 1 callable
  tests).
- **Expected:** If the mirror update (B2) or audit emission (B3) throws
  after the `succeeded` record is written, the record stays `succeeded`
  and an `error`-severity desync/audit-gap line is logged. The outcome is
  reported succeeded.
- **Forbidden:** A `succeeded` record overwritten to `failed` by a
  later-step failure (the pre-Sprint-25 defect §2.4 removed).
- **Pass/fail:** PASS when no succeeded record is clobbered. If no such
  failure occurs in the run, cite the Phase 1 callable tests (Phase B2/B3
  cases) as the standing evidence.

### V21. Zero Secret Manager access during the certified path unless explicitly expected by the current token architecture
- **Source:** Functions debug log grep for `secretmanager.googleapis.com`.
  **Support:** emulator-supported.
- **Expected:** No Secret Manager access during the publish path. The
  publish callable resolves the stored access token directly and does not
  attach the Secret Manager secret; topic listing likewise. Secret access
  during the certified path, if any, is confined to the OAuth
  connect/complete callables that bind the client secret for the token
  exchange, and only when a token exchange runs.
- **Forbidden:** Secret Manager access on the `lmsAssignmentsPublish` or
  `lmsClassesListTopics` path.
- **Pass/fail:** PASS when the publish and topics paths make zero Secret
  Manager calls. Note the OAuth-exchange access as the one expected,
  bounded exception and confirm it does not occur on the pure publish
  path.

### V22. No token material appears in client responses, Firestore-readable fields, callable ledger data, or audit payloads
- **Source:** callable responses (browser network capture),
  `lmsAssignmentPublications`, `lmsConnections`, `auditEvents`.
  **Support:** browser-supported + emulator-supported.
- **Expected:** No access token, refresh token, OAuth code, client
  secret, or `accessToken` field in any client-readable field, callable
  response, or audit payload.
- **Forbidden:** Any token material in a client-readable location.
- **Pass/fail:** PASS when no token material is present. (Backed by the
  Phase 1 privacy test and the Phase 3 no-PII DOM tests.)

### V23. No student PII is read or written by the publication workflow
- **Source:** `lmsAssignmentPublications`, `auditEvents`, Functions logs.
  **Support:** emulator-supported.
- **Expected:** No student name, student email, or Google account id in
  any publication record, audit payload, or log line. The publish path
  reads no roster.
- **Forbidden:** Any student PII on the publish path.
- **Pass/fail:** PASS when no student PII appears.

### V24. No joinCode or enrollment mutation occurs because of assignment publication
- **Source:** `classes/{classId}`, `enrollments`. **Support:**
  emulator-supported.
- **Expected:** Publishing an assignment writes no `joinCode` and mutates
  no `enrollments` document. Class and roster state are untouched by
  publication.
- **Forbidden:** Any join-code write or enrollment change attributable to
  a publish.
- **Pass/fail:** PASS when class and enrollment state are unchanged.

### V25. Multi-class results remain isolated by assignment, link, topic, and nonce
- **Source:** `lmsAssignmentPublications`, `assignments`, callable ledger.
  **Support:** emulator-supported.
- **Expected:** For B21, each class has its own `assignmentId`, its own
  `linkId`, its own optional topic, and its own `attemptNonce`, producing
  independent publication records. One row's failure leaves the other
  row's succeeded record and mirror intact.
- **Forbidden:** Cross-row nonce reuse, colliding `publicationId`, or one
  row's failure affecting another's record.
- **Pass/fail:** PASS when per-row records are fully isolated.

---

## 2. Verification decision

Every V-check that is emulator-supported must pass for the state produced
by the browser run. Checks that depend on a failure or edge path not
naturally produced in the run (V20, parts of V19) are satisfied by the
committed Phase 1/2/3 unit and integration evidence, cited explicitly.
Any production-log-supported observation (none are required here) is out
of emulator scope and deferred. Any FAIL on an emulator-supported check
stops certification and opens a defect against the responsible callable.

*End of backend verification checklist.*
