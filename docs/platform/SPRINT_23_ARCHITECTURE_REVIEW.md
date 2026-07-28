# Sprint 23 Architecture Review

Google Classroom Integration - preserved architecture review, produced
before any Sprint 23A implementation begins.

Date: 2026-07-28
Status: Reviewed. Sliced 23A through 23E rollout approved.
Companion documents (frozen): `LMS_INTEGRATION_ARCHITECTURE.md`,
`LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`,
`LMS_INTEGRATION_OPERATIONS.md`, `LMS_EXPERIENCE.md`,
`ASSIGN_EXPERIENCE.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`,
`LYFELABZ_CLOUD_FUNCTION_CHARTER.md`,
`LYFELABZ_FIREBASE_SECURITY_MODEL.md`,
`LYFELABZ_PLATFORM_DECISIONS.md` (PDR-019, PDR-020).

Sprint 23 does not redesign any of the above. This review documents
the state of the world as it exists at the start of Sprint 23 and the
scoped path forward.

---

## 1. Executive Summary

The LMS integration surface is already scaffolded end-to-end from
prior sprints (SPRINT_10A_F3, PDR-020c, and later publication
authorization). The vendor-neutral core is complete and certified in
prior sprint reports. The Google Classroom provider adapter is
present, registered, and stubbed: every method rejects with the
stable `lms.providerNotYetOperational` error.

Sprint 23 is therefore not a design-and-build sprint. It is an
**activation** sprint: replace the stubbed adapter with a live
Google Classroom implementation while making no changes to the
frozen vendor-neutral core, callable contracts, Firestore collections,
security rules, assessment architecture, assignment lifecycle, or
teacher/student UX.

Sprint 23A is a preparation slice. It builds the internal seams
needed to activate the Google adapter in 23B without deploying live
behavior, provisioning credentials, or touching the production
adapter surface.

---

## 2. Discovered Existing Scaffolding

### 2.1 Vendor-neutral provider core

Location: `platform/functions/src/lms/`

| File | Purpose | Sprint 23 disposition |
|---|---|---|
| `providers/provider.ts` | `LmsProviderAdapter` interface, discovery/publication types, OAuth grant types | Frozen. No changes in 23A-E. |
| `providers/registry.ts` | Closed-set adapter registry keyed by `LmsProviderId` | Frozen. |
| `providers/google-classroom/adapter.ts` | Google adapter. All methods reject with `notYetOperational` | Activated across 23B-D. Untouched surface in 23A. |
| `tokens/token-store.ts` | `LmsTokenStore` interface + in-process default + `setLmsTokenStore` seam | In-process default preserved in 23A. Production binding is a 23B (or ops) obligation. |
| `shared/actor.ts` | Callable actor resolution for LMS callables | Frozen. |
| `shared/ids.ts` | Deterministic id generation for `lmsConnections`, `lmsClassLinks`, `lmsAssignmentPublications` | Frozen. |

### 2.2 Callable inventory (already wired in `functions/src/index.ts`)

All callables use `firebase-functions/v2/https` (Gen 2). All are
exported from `platform/functions/src/lms/index.ts`.

- `lmsProvidersList`
- `lmsConnectionsBegin`
- `lmsConnectionsComplete`
- `lmsConnectionsDescribe`
- `lmsConnectionsDisconnect`
- `lmsClassesDiscover`
- `lmsClassesImport`
- `lmsClassesRefresh`
- `lmsClassesListTopics`
- `lmsAssignmentsPublish`

Sprint 23 adds no new callables and does not rename any existing
callable. Sprint 23A explicitly makes no changes to any callable
implementation.

### 2.3 Firestore collection inventory (LMS)

Source of truth: `platform/functions/src/shared/types/lms.ts`.

- `lmsProviders` - provider directory seed data
- `lmsConnections` - per-teacher OAuth connection state (opaque
  `tokenRef` only; no token material)
- `lmsClassLinks` - per-class link between a LyfeLabz class and an
  upstream LMS class
- `lmsAssignmentPublications` - per-publication record of an
  assignment mirror pointing at the LyfeLabz surface

Typed references and narrow writer references are defined in
`platform/functions/src/shared/firestore/typed-ref.ts`. Sprint 23
adds no collection and modifies no writer reference.

### 2.4 Client surface

- OAuth redirect landing page: `app/lms-callback.html`
- Client integrations settings surface:
  `app/src/settings/integrations/` (`integrations.ts`, `wire.ts`,
  `types.ts`)

Sprint 23A does not modify the client surface.

### 2.5 Documentation baseline

- `docs/platform/LMS_INTEGRATION_ARCHITECTURE.md` (491 lines)
- `docs/platform/LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` (349 lines)
- `docs/platform/LMS_INTEGRATION_OPERATIONS.md`
- `docs/platform/LMS_EXPERIENCE.md`
- `docs/platform/ASSIGN_EXPERIENCE.md`
- `docs/platform/SPRINT_10A_F3_GOOGLE_CLASSROOM_IMPLEMENTATION_REPORT.md`
- `docs/platform/GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`

---

## 3. Frozen Contracts (Sprint 23 Must Not Alter)

Explicitly frozen for Sprint 23 per project principles and prior
certification:

- Assessment architecture: `assessmentRevisionId`, assessment
  revisions, answer keys, `Attempts` immutability, session lifecycle,
  scoring contract
- Assignment lifecycle: draft/publish/close/reopen/archive, recipient
  management, teacher list, student list
- Class and enrollment contracts: `classes-create`, `classes-archive`,
  `classes-update-metadata`, `enrollments-*`
- Authentication and onboarding: Google Sign-In, teacher
  verification, student onboarding, `authOnUserCreate`
- Firestore Rules and Firebase Security Model
- Vendor-neutral `LmsProviderAdapter` interface
- All existing callable names, exports, request/response shapes
- All existing Firestore collection names and document shapes
- Teacher dashboard behavior
- Student workflow

Sprint 23 changes are confined to:

1. The Google Classroom adapter implementation
2. An internal Google-package-local HTTP transport and its bindings
3. A configuration/secret seam for the OAuth client (approach TBD -
   see §7)
4. The production binding of `LmsTokenStore` (deferred to 23B or the
   appropriate ops slice)
5. Documentation additions

---

## 4. Operational Gaps

Named as unresolved at the start of Sprint 23, tracked from
`LMS_INTEGRATION_OPERATIONS.md §2` and `LMS_INTEGRATION_ARCHITECTURE.md
§10.3`:

- **Google Cloud project for LMS OAuth.** Not confirmed as
  provisioned. Deferred; Sprint 23A does not require it.
- **OAuth client id and secret custody.** No secret binding in code.
  See §7.
- **Production `LmsTokenStore` binding.** In-process default only.
  Not production-safe. Must be replaced before 23B production
  activation.
- **Emulator/test harness.** No transport-level fixture exists. Sprint
  23A creates one, scoped to test-only use.
- **Live upstream integration.** All adapter methods stubbed. Sprint
  23A does not change this.

Sprint 23A resolves the last two only. The first three remain open
work for 23B and the ops workstream.

---

## 5. Scope Analysis (OAuth Scopes)

Declared in `providers/google-classroom/adapter.ts`:

- `GOOGLE_CLASSROOM_INITIAL_SCOPES`
  - `https://www.googleapis.com/auth/classroom.courses.readonly`
  - `https://www.googleapis.com/auth/classroom.rosters.readonly`
- `GOOGLE_CLASSROOM_PUBLICATION_SCOPES` (deferred incremental
  consent, not requested at initial connection)
  - `https://www.googleapis.com/auth/classroom.coursework.me`
  - `https://www.googleapis.com/auth/classroom.topics.readonly`

Sprint 23 decision, preserved: **do not add profile-email or
profile-photo scopes**. LyfeLabz's roster synchronization uses the
minimum data the frozen enrollment model requires.

### 5.1 Does the enrollment model require student emails?

Answer: **No, not from Classroom.** Review of
`platform/functions/src/enrollments/resolve-roster-display-name.ts`
and `platform/functions/src/shared/types/user.ts`:

- `userProfile.email` is populated only from Firebase Auth at user
  provisioning (`authOnUserCreate`), never from an LMS.
- The display-name resolver explicitly does not fall back to email
  for roster names.
- The enrollment write path resolves student identity by
  Firebase-Auth-backed `studentId`, not by Classroom-supplied email.

Sprint 23C roster synchronization will therefore key on the upstream
Classroom student profile id and Firebase-Auth-linked studentId, and
must not persist Classroom-supplied emails into `userProfile` or any
enrollment document. Adding an email or photo scope is not
justified by the current model.

### 5.2 Roster method on the vendor-neutral interface

The current `LmsProviderAdapter` interface has:

- `listTeacherClasses`
- `fetchClass`
- `listClassTopics`
- `publishAssignment`

It does **not** currently expose a class-student listing method. The
existing `lmsClassesRefresh` callable explicitly does not sync
rosters today (see its file header). Sprint 23C will need to decide
whether to (a) add a `listClassStudents` method to the vendor-neutral
interface, or (b) route roster sync through a Google-package-internal
call from the existing refresh callable.

Sprint 23A does not make this decision. It only builds a
transport-level `listCourseStudents` method inside the Google
Classroom package to keep 23C unblocked. No vendor-neutral change is
made in 23A. Any modification to the vendor-neutral provider
interface will be raised as a Stop Condition in the sprint that
actually needs it.

---

## 6. Approved 23A through 23E Rollout

Confirmed by the sprint owner (2026-07-28). Each slice ends with its
own completion report and a certification decision.

### 23A - Operational foundation (adapter preparation)

- Swappable Google Classroom HTTP transport interface, scoped to the
  Google package
- Test-only in-memory fixture transport with deterministic fictional
  data
- Configuration seam for OAuth client (approach pending §7 approval)
- Adapter continues to reject every operation with
  `lms.providerNotYetOperational`
- Full test coverage of transport shapes, error translation,
  pagination, cleanup, and unchanged production activation boundary
- Documentation: this architecture review, a clearly labeled
  test/emulator section in `LMS_INTEGRATION_OPERATIONS.md`, and
  `SPRINT_23A_COMPLETION_REPORT.md`

**Non-goals for 23A:** live network calls, real credentials, GCP
provisioning, function deployment, production token store, any
change to production adapter behavior, any UX change.

### 23B - Adapter activation for connect and discovery

- Default transport swaps from unbound to a real HTTPS transport
- OAuth client credentials wired via the seam chosen in 23A
- Production `LmsTokenStore` binding (durable, server-only,
  Secret-Manager-backed or approved equivalent)
- Adapter `beginOAuth`, `completeOAuth`, `revokeGrant`,
  `listTeacherClasses`, `fetchClass` return live results
- Certification against a Classroom test instance

### 23C - Roster synchronization activation

- Decide whether roster sync requires a vendor-neutral interface
  addition (Stop Condition if so; needs its own PDR update)
- Wire the Google-package roster call into `lmsClassesRefresh`
- Reconcile enrollment writes against the frozen enrollment model
  without introducing Classroom-supplied emails or photos

### 23D - Publication activation

- Incremental consent for `GOOGLE_CLASSROOM_PUBLICATION_SCOPES`
- Live `listClassTopics` and `publishAssignment`
- End-to-end assignment publication test against Classroom test
  instance

### 23E - Sprint 23 final certification

- Full end-to-end validation against Classroom test instance
- Regression assessment across teacher dashboard, student workflow,
  assessment pipeline, assignment lifecycle
- Sprint 23 final certification report

---

## 7. Open Config-Seam Decision (blocks 23A implementation)

Sprint 23A must add a configuration seam so the adapter's OAuth
client id, client secret, and redirect uri can be injected at
runtime. The repository has **no established convention** for typed
parameters or secrets:

- No use of `firebase-functions/params` (`defineSecret`,
  `defineString`, `defineInt`, `defineBoolean`) anywhere in
  `platform/functions/src`
- No use of the deprecated `functions.config()` anywhere in
  `platform/functions/src`
- Gen 2 callables throughout (`firebase-functions/v2/https`), SDK
  `firebase-functions ^5.0.1`, Node 20

Per the Sprint 23A specification the review options are reported
back to the sprint owner and no configuration mechanism is selected
by Sprint 23A implementation without explicit approval. Options
under review are recorded in the immediate follow-up message to
this document.

---

## 8. Risk Register (Sprint 23A only)

- **Config-seam divergence.** Adopting a mechanism the repository has
  never used before creates a precedent every future secret will
  inherit. Mitigation: stop and report before selecting one.
- **Transport shape drift.** Google Classroom REST v1 responses can
  differ subtly (pagination tokens, optional fields, error envelopes)
  from the fixture assumptions. Mitigation: fixtures reflect the
  documented v1 shapes; adapter maps every transport failure to a
  stable `PlatformError` before the boundary.
- **Test-only seam leaking into production.** Mitigation: seam is
  package-local, default binding is unbound, production adapter
  continues to short-circuit at `notYetOperational` in 23A, tests
  restore prior bindings.
- **Fixture PII contamination.** Mitigation: fixture data is entirely
  fictional; explicit test forbids any recognizable real name,
  email, or LyfeLabz-affiliated identifier.

---

## 9. Sprint 23A Success Criteria (recorded here for the completion
report)

- Zero changes to callable names, exports, Firestore collections,
  Firestore Rules, assessment architecture, assignment lifecycle,
  teacher dashboard, student workflow, or vendor-neutral provider
  interface
- Adapter still rejects every stubbed operation with the existing
  stable error contract, proven by test
- Transport seam and fixture transport are covered by focused unit
  tests
- All existing validation gates pass without weakening or skipping
- Token-safety fixture tests confirm tokens and authorization codes
  are never written to Firestore, never returned to clients, and
  redacted from logs and errors
- `LMS_INTEGRATION_OPERATIONS.md` receives a clearly labeled
  test/emulator section (not a production procedure)
- `SPRINT_23A_COMPLETION_REPORT.md` produced with the full contents
  enumerated in the sprint specification

---

## 10. Stop Conditions Restated

Sprint 23A halts and reports before doing any of the following:

- Modifying the vendor-neutral provider interface
- Modifying an existing callable contract
- Adding a Firestore collection
- Changing Firestore Rules
- Changing the assignment or assessment architecture
- Exposing token material outside the server boundary
- Using real credentials
- Deploying code
- Provisioning Google Cloud resources
- Requesting additional OAuth scopes
- Changing teacher or student UX
- Introducing a configuration mechanism inconsistent with the
  repository

End of Sprint 23 Architecture Review.
