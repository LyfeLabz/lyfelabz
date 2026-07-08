# LyfeLabz Sprint 2 Specification: Onboarding and Teacher Verification

**Status:** Approved implementation specification
**Sprint:** Sprint 2
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, LYFELABZ_ENGINEERING_STANDARDS.md, PLATFORM_STATE_MACHINE.md, SPRINT_1_COMPLETION_REPORT.md, SPRINT_HISTORY.md

This document is the authoritative implementation specification for Sprint 2. It records the architecture decisions approved during engineering review and describes the exact deliverables Sprint 2 produces. It contains no unresolved placeholders. Where lifecycle behavior appears, this document refers to `PLATFORM_STATE_MACHINE.md` rather than duplicating definitions.

---

## 1. Objective

Turn the Sprint 1 `users/{uid}` provisioning record into a complete, verified, activated identity, student or teacher, through a documented onboarding flow, a teacher verification workflow, and the first narrowly-scoped Firestore Rules built on top of the default-deny baseline.

Sprint 2 introduces the platform's first authenticated surfaces at the data and trusted-server layer. It does not build the student dashboard or the teacher dashboard as user-facing HTML.

---

## 2. Scope

Sprint 2 delivers:

- A canonical user record shape aligned with the amended Data Model §3.1.
- Shared TypeScript types for the `users` and `schools` collections.
- A shared custom-claims writer implementing the canonical shape in Cloud Function Charter §2.
- A shared audit-event writer implementing the Sprint 2 vocabulary.
- A student onboarding callable Cloud Function.
- A teacher onboarding and verification-request callable Cloud Function.
- Administrative approve and deny callable Cloud Functions.
- Optional extension of the Sprint 1 provisioning trigger to conform to the amended user record shape.
- The first narrowly-scoped Firestore Rules on top of default-deny.
- Rules tests and Cloud Function unit tests for every rule and function introduced.
- End-to-end Emulator Suite verification of the onboarding pipeline.
- Sprint 2 completion report and Sprint History append.

Sprint 2 is emulator-only. No production deployment occurs during Sprint 2.

---

## 3. Non-Goals

Sprint 2 does not deliver:

- Client-facing HTML for the role picker, the pending screen, the student dashboard, or the teacher dashboard.
- Automated verification via a verified school-domain list.
- A `schoolDomains` collection or any other new collection related to school verification.
- Suspend, reinstate, or archive workflows.
- Custom claims beyond the canonical shape in Cloud Function Charter §2.
- Any lifecycle field other than the canonical `status` field defined by `PLATFORM_STATE_MACHINE.md`.

---

## 4. Approved Architecture Decisions

The engineering review resolved each of the six architecture clarifications and the lifecycle-field question. The resolutions below are authoritative for Sprint 2 implementation. Two amendments were authored alongside this specification: an amendment to Data Model §3.1 and an amendment to Cloud Function Charter §2. All other resolutions apply within Sprint 2 without amending existing documents.

### 4.1 Provisioning payload vs canonical user record (CQ-1)

The `users/{uid}` document is the single canonical user record from provisioning onward. It grows through additive writes as the user progresses through the lifecycle defined in `PLATFORM_STATE_MACHINE.md`. Provisioning-required fields and activation-required fields are enumerated in the amended Data Model §3.1. The Sprint 1 field name `uid` is renamed to `authUid` in Step 9 to align with the amended Data Model.

### 4.2 Personal Google account policy (CQ-2)

The provisioning trigger `authOnUserCreate` remains universal and idempotent. It writes a `provisioned` user document for every Firebase Auth user regardless of domain. Personal-account policy per PDR-002 is enforced inside the onboarding callables:

- The callable throws a typed `PlatformError`.
- The boundary translator surfaces it to the client as a defined `HttpsError` code with a non-revealing message.
- The callable writes the `auth.activationRejected` audit event.
- The callable writes a structured log at `warn` per Engineering Standards §7.
- The `users/{uid}` document is not mutated. The user remains in `provisioned`.

A subsequent onboarding attempt from a compliant account is a first-class success path and requires no support intervention.

### 4.3 Verified school domain storage (CQ-3)

Sprint 2 introduces no storage for verified school domains. Every self-declared teacher enters the `pendingVerification` lifecycle state and is approved or denied by a Platform Administrator through Step 8. The auto-verification optimization named by PDR-003 is deferred to a future sprint that follows the completion of the school administration architecture. Storage location is TBD pending completion of the school administration architecture. No new collection related to school verification is introduced in Sprint 2.

### 4.4 Custom claims shape (CQ-4)

Custom claims contain exactly `role` and `schoolId`. `districtId` is a documented reserved slot for the PDR-015 district expansion path and is not written by Sprint 2 functions. Claims are written only when the user's `status` transitions to `active`. The absence of claims is the canonical signal that the user has no active authorization. The canonical shape and its constraints are documented in the amended Cloud Function Charter §2.

### 4.5 Audit event vocabulary (CQ-5)

Sprint 2 introduces the following audit `action` values. Every value follows the Engineering Standards §7 log-event convention: dotted, past-tense, domain-first. The domain prefix matches the Cloud Functions folder that owns the writer.

- `auth.userProvisioned` - `authOnUserCreate` writes the provisioning record.
- `auth.activationRejected` - onboarding callable rejects an activation attempt without mutating state.
- `students.activated` - `studentsCompleteOnboarding` transitions the user to `active`.
- `teachers.verificationRequested` - `teachersRequestVerification` transitions the user to `pendingVerification`.
- `teachers.verificationApproved` - `teachersApproveVerification` transitions the user to `active`.
- `teachers.verificationDenied` - `teachersDenyVerification` returns the user to `provisioned`.

The transition-producing events are also recorded in the transition table in `PLATFORM_STATE_MACHINE.md`.

### 4.6 Pending-screen scope (CQ-6)

Sprint 2 ships no client-facing HTML. The pending screen named by PDR-003 is deferred to Sprint 3 and will be authored alongside the role picker and the student and teacher landing shells as one cohesive onboarding-UI sprint. The trust layer is proven end-to-end in Step 10 before any client surface is authored.

### 4.7 Lifecycle field (`status`)

The canonical account lifecycle field is `status` on `users/{uid}`. Its enumerated values, its transitions, its responsible Cloud Functions, and its associated audit events are the canonical account lifecycle for the entire platform and are defined in `PLATFORM_STATE_MACHINE.md`. There is no other lifecycle field, on this document or any other. This specification does not restate the state machine; it references `PLATFORM_STATE_MACHINE.md` wherever lifecycle behavior applies.

---

## 5. Deliverables

Each deliverable maps to one step in the Sprint 2 Implementation Plan.

- **Step 2. Canonical user record shape and shared types.** Extend `shared/types/user.ts` to reflect the amended Data Model §3.1. Add the `Role` string-literal union. Add the `UserRecord` type as the single source of truth for reads and writes.
- **Step 3. `schools/` shared types and typed refs.** Add `shared/types/school.ts` and typed reference builders. Introduce no data and no rules. Introduce no verified-domain collection.
- **Step 4. Custom claims writer helper.** Add `shared/auth/claims.ts` as the single canonical path for custom-claims writes, implementing the shape in the amended Cloud Function Charter §2.
- **Step 5. Audit-event shared type, typed ref, and writer helper.** Add `shared/types/audit-event.ts` and `shared/audit/write-audit-event.ts` as the single canonical path for audit writes, using the Sprint 2 vocabulary in §4.5.
- **Step 6A. Student onboarding callable.** `studentsCompleteOnboarding`, per the transition table in `PLATFORM_STATE_MACHINE.md`.
- **Step 6B. Teacher onboarding and verification-request callable.** `teachersRequestVerification`, per the transition table in `PLATFORM_STATE_MACHINE.md`. Custom claims are not written by 6B.
- **Step 7. First narrowly-scoped Firestore Rules.** See §6.
- **Step 8. Administrative approve and deny callables.** `teachersApproveVerification` and `teachersDenyVerification`, per the transition table in `PLATFORM_STATE_MACHINE.md`.
- **Step 9. Provisioning trigger extension.** Extend `authOnUserCreate` to conform to the amended Data Model §3.1. Rename `uid` to `authUid`. Write `status: "provisioned"` at document create. Preserve idempotency.
- **Step 10. End-to-end verification and sprint close.** Function unit tests, Rules tests, Emulator Suite end-to-end run, README updates, Sprint 2 completion report, Sprint History append.

Every function ships with unit tests covering happy path, primary failure mode, and idempotency, per Engineering Standards §9.

---

## 6. Firestore Rules Introduced

The first affirmative rules on top of the default-deny baseline. Narrowly scoped.

- `users/{uid}`
  - `get` allowed when the authenticated caller's uid equals `{uid}`.
  - `update` allowed on the caller's own document for a fixed field allowlist. Sprint 2 allowlist: `displayName` only.
  - Denied writes for every other field, including `authUid`, `role`, `schoolId`, `status`, `createdAt`, `email`, `consentState`, `teacherProfile`, `studentProfile`, and `grade`.
  - `list` denied.
  - Cross-user reads denied.

- `schools/{schoolId}`
  - `get` allowed on a fixed metadata allowlist for any authenticated caller. Sprint 2 allowlist: `name`, `shortName`, `timezone`.
  - `list` denied.
  - All writes denied.

- `auditEvents/{eventId}`
  - Default-deny remains. No client reads, no client writes.

Every rule change lands with Rules tests exercising both an allow path and at least one deny path per Engineering Standards §9. Rule-helper conventions follow the canonical patterns documented in the Sprint 2 rule-helper module authored during Step 7.

---

## 7. Cloud Functions Introduced

Each function is single-purpose, idempotent, structured-logged at seams, boundary-translated at the callable interface, and produces exactly the audit event(s) named in §4.5 and in the transition table in `PLATFORM_STATE_MACHINE.md`.

- `authOnUserCreate` (extended in Step 9). Writes the provisioning record. Idempotent under retries. Produces `auth.userProvisioned`.
- `studentsCompleteOnboarding` (Step 6A). Transitions `provisioned` to `active` for students. Writes custom claims via the Step 4 helper. Produces `students.activated`. Personal-account rejection produces `auth.activationRejected` with no state change.
- `teachersRequestVerification` (Step 6B). Transitions `provisioned` to `pendingVerification` for teachers. Does not write custom claims. Produces `teachers.verificationRequested`. Personal-account rejection produces `auth.activationRejected` with no state change.
- `teachersApproveVerification` (Step 8). Callable only by a Platform Administrator. Transitions `pendingVerification` to `active`. Writes custom claims via the Step 4 helper. Produces `teachers.verificationApproved`.
- `teachersDenyVerification` (Step 8). Callable only by a Platform Administrator. Transitions `pendingVerification` to `provisioned`. Does not write custom claims. Produces `teachers.verificationDenied`.

No admin UI is authored in Sprint 2. Administrative callables are exercised from an authenticated administrative script under Emulator Suite conditions only.

---

## 8. Audit Events

Every audit event is written by the canonical helper introduced in Step 5. Every event conforms to the Data Model §3.8 field set. The Sprint 2 vocabulary is enumerated in §4.5. The state-changing events are enumerated in the transition table in `PLATFORM_STATE_MACHINE.md`. `auth.activationRejected` is the sole Sprint 2 event that records an outcome without a state change.

Client-driven audit writes are structurally impossible: `auditEvents` remains default-deny, and every writer runs under trusted-server credentials per Cloud Function Charter §2 and Security Model §11.

---

## 9. Acceptance Criteria

Sprint 2 is complete when all of the following hold.

- The amended Data Model §3.1 and the amended Cloud Function Charter §2 are merged.
- `PLATFORM_STATE_MACHINE.md` is merged and referenced by every downstream artifact that touches lifecycle behavior.
- Every function named in §7 exists, is unit-tested for happy path, primary failure mode, and idempotency, and produces the audit events named in §4.5.
- Every rule named in §6 exists and is covered by Rules tests exercising both an allow path and at least one deny path.
- The Emulator Suite end-to-end run in Step 10 exercises the full onboarding pipeline: Auth user creation, student activation, teacher verification request, teacher approval, teacher denial-to-provisioned, and personal-account rejection without state change. Every step is verified against `users/{uid}` state, custom-claims state, and the `auditEvents` collection.
- Continuous integration remains green throughout Sprint 2.
- Sprint 2 ships no client-facing HTML.
- No new collection is introduced in Sprint 2 beyond `schools` and `auditEvents`, both of which are defined by the Data Model.
- No second lifecycle field is introduced anywhere.
- No production deployment occurs during Sprint 2.
- Sprint 2 closes with its own completion report and a new section in `SPRINT_HISTORY.md`.

---

## 10. Out of Scope

The following are intentional deferrals, not defects. Each is scoped to a later sprint.

- Client-facing onboarding UI, including role picker, pending screen, and dashboards.
- Verified school-domain storage and the auto-verification path from PDR-003.
- Suspend, reinstate, and archive workflows and their associated transitions.
- The administrative dashboard for teacher verification.
- Deployment of rules and functions to the live Firebase project.
- Every collection and every function reserved for later sprints by Platform Architecture Version 1.0.

Each deferred item is already specified at the architecture level. Sprint 2 deliberately does not begin any of them.
