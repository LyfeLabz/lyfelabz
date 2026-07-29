# Sprint 23F - Operational Dependency Matrix

## Purpose

Single-source inventory of every operational dependency the LyfeLabz
Cloud Functions surface has on Firebase, Google Cloud, Secret
Manager, IAM, Firestore configuration, OAuth infrastructure, and
runtime environment variables.

Every row references the code that requires the dependency. The
matrix is derived by inspection; no dependency is listed on
recollection or general practice.

Applies to the repository state at Sprint 23F entry. Update this
matrix whenever a new secret, parameter, environment variable, or
Google Cloud API is introduced.

---

## 1. Secret Manager

| Secret | Purpose | Referenced by | Attached to |
| --- | --- | --- | --- |
| `GOOGLE_CLASSROOM_CLIENT_SECRET` | OAuth 2.0 client secret for the Google Classroom integration. | `platform/functions/src/lms/providers/google-classroom/config-firebase.ts:64` (`GOOGLE_CLASSROOM_CLIENT_SECRET_PARAM = defineSecret(...)`). Resolved in `ensureGoogleClassroomProductionBindings` at handler entry. | Every Google Classroom callable via `googleClassroomProductionSecrets`: `lmsConnectionsBegin`, `lmsConnectionsComplete`, `lmsConnectionsDisconnect`, `lmsClassesImport`, `lmsClassesDiscover`, `lmsClassesRefresh`, `lmsClassesSyncRoster`, `lmsClassesListTopics`, `lmsAssignmentsPublish`. |

No other Secret Manager secret is referenced by any Cloud Function
in `platform/functions/src`.

---

## 2. Firebase Functions typed parameters (non-secret)

| Parameter | Type | Purpose | Referenced by |
| --- | --- | --- | --- |
| `GOOGLE_CLASSROOM_CLIENT_ID` | string | OAuth 2.0 client id (public value; standardized alongside the client secret so a rotation touches one artifact set). | `platform/functions/src/lms/providers/google-classroom/config-firebase.ts:46`. |
| `GOOGLE_CLASSROOM_REDIRECT_URI` | string | Server-side OAuth callback URI. MUST match the OAuth client entry. | `platform/functions/src/lms/providers/google-classroom/config-firebase.ts:55`. |

---

## 3. Process environment variables

| Variable | Source | Read by | Effect |
| --- | --- | --- | --- |
| `K_SERVICE` | Cloud Functions / Cloud Run runtime. | `platform/functions/src/lms/shared/durable-storage.ts:82`. | Signals the LMS durable-storage installer to swap the in-process default stores for the Firestore-backed implementations. Auto-populated in production; unset under jest. |
| `FUNCTION_TARGET` | Cloud Functions / Firebase Emulator Suite. | `platform/functions/src/lms/shared/durable-storage.ts:83`. | Same effect as `K_SERVICE`. Either variable triggers the swap. |
| `LYFELABZ_LEGACY_SUBMISSIONS_WRITES_ENABLED` | Operator opt-in. | `platform/functions/src/shared/legacy-submissions-flag.ts:29`. | Default unset -> `submissionsCreate` and `submissionsFinalize` refuse. Set to `"true"` only for a controlled data-migration reconciliation run per PDR-026 §26. |
| `FIRESTORE_EMULATOR_HOST` | Firebase Emulator Suite. | `platform/functions/src/scripts/migration/external-identity-migration.ts:135`. | Required for `runBackfill` (emulator-only) alongside `FIREBASE_AUTH_EMULATOR_HOST`. Never set in production. |
| `FIREBASE_AUTH_EMULATOR_HOST` | Firebase Emulator Suite. | `platform/functions/src/scripts/migration/external-identity-migration.ts:136`. | See above. |
| `GCLOUD_PROJECT` | Cloud Functions runtime (auto). | `platform/functions/src/scripts/bootstrap-beta-teacher.ts:31`. | Read by the operator-only bootstrap script; irrelevant to deployed callables. |

---

## 4. Firebase / Google Cloud APIs

Required on the Firebase project:

- `cloudfunctions.googleapis.com`
- `cloudbuild.googleapis.com`
- `artifactregistry.googleapis.com`
- `run.googleapis.com`
- `eventarc.googleapis.com` (required by the blocking Auth trigger `authOnUserCreate`)
- `firestore.googleapis.com`
- `firebase.googleapis.com`
- `identitytoolkit.googleapis.com` (Firebase Auth Admin SDK)
- `secretmanager.googleapis.com`
- `logging.googleapis.com`
- `pubsub.googleapis.com`

Required on the LMS OAuth Google Cloud project (per
`LMS_INTEGRATION_OPERATIONS.md` §3.3):

- `classroom.googleapis.com`

No other Google API is invoked by any code path in
`platform/functions/src`.

---

## 5. IAM (deploying principal)

Minimum roles required on the target Firebase project to execute
`firebase deploy --only functions,firestore:rules,firestore:indexes`:

- `roles/firebase.admin` OR the composition documented in
  `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §2.
- `roles/secretmanager.admin` only for first-time secret creation
  and rotation.

---

## 6. IAM (Cloud Functions runtime service account)

Default runtime SA is `<project-id>@appspot.gserviceaccount.com`
unless a dedicated SA is bound. Required roles:

- `roles/datastore.user` (Firestore reads and writes via Admin SDK).
  Consumed by every callable that reads or writes Firestore.
- `roles/firebaseauth.admin` (Firebase Auth Admin SDK). Consumed by
  `authOnUserCreate`, `reconcileMyExternalIdentity`, and
  `identityMigrationRunProductionInventory` (via `runInventory`
  which calls `getAuth().listUsers`).
- `roles/secretmanager.secretAccessor` scoped to
  `GOOGLE_CLASSROOM_CLIENT_SECRET`. Attached automatically by the
  `firebase-functions/params` `defineSecret` binding.
- `roles/logging.logWriter` (structured log emission).

No wider role is required.

---

## 7. Firestore Rules

`platform/firebase/firestore.rules` governs every client-facing
Firestore access. Server-only collections deny every client
operation (`allow read, write: if false`). The server accesses these
collections through the Admin SDK, which bypasses Rules. Collections
that require the server-only posture:

- `lmsOAuthStates/{state}` (firestore.rules:501)
- `lmsTokenBundles/{tokenRef}` (firestore.rules:515)
- `externalIdentities/{externalIdentityId}` (firestore.rules:541)
- `auditEvents/{eventId}` (firestore.rules:551)
- Every collection not explicitly matched (terminal
  `match /{document=**}` deny at firestore.rules:556).

Client-readable / conditionally-writable collections retain their
Sprint 10 through Sprint 23C surface (users, schools, classes,
enrollments, assignments, recipients, submissions, lmsProviders,
lmsConnections, lmsClassLinks, lmsAssignmentPublications,
assessments, assessmentRevisions, assessmentAnswerKeys,
assessmentSessions, attempts). No Sprint 23F change is proposed to
that surface.

---

## 8. Firestore indexes and TTL

Indexes: `platform/firebase/firestore.indexes.json` declares:

- `indexes`: empty (no composite indexes required).
- `fieldOverrides`: one collection-group override on
  `recipients.studentId` (ascending) for the assignment recipient
  query surface.

TTL: no TTL policy is deployed by the Firebase CLI. See
`SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md` for the required policy on
`lmsOAuthStates.expiresAt`. TTL provisioning is a post-deploy
operator activity through the Firebase Console or `gcloud`.

---

## 9. OAuth infrastructure

- Google Cloud project holding the OAuth client. Separate from the
  Firebase project per `LMS_INTEGRATION_OPERATIONS.md` §3.1.
- OAuth 2.0 client (Web application). Client id, client secret, and
  redirect URI recorded in the LMS runbook.
- Consent screen. Testing mode or Production per pilot phase.
- Scopes:
  `https://www.googleapis.com/auth/classroom.courses.readonly`,
  `https://www.googleapis.com/auth/classroom.rosters.readonly`.
  Declared in
  `platform/functions/src/lms/providers/google-classroom/config.ts`
  (or the adapter's scope constant).

---

## 10. Cloud Functions configuration

All callables are wrapped by `platformCallable`
(`platform/functions/src/shared/errors/https-callable.ts:208`). No
callable sets `region`, `memory`, `timeoutSeconds`, `cpu`,
`concurrency`, `minInstances`, or `maxInstances`. Every callable
inherits the Firebase Functions v2 defaults documented in
`SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §6.

The five Google Classroom callables and the four LMS class /
assignment callables additionally set
`{ secrets: [...googleClassroomProductionSecrets] }` so the runtime
binds `GOOGLE_CLASSROOM_CLIENT_SECRET`.

Runtime: `nodejs20` per `platform/firebase/firebase.json`.

Background triggers:

- `authOnUserCreate`. Firebase Authentication blocking trigger.
  Exported from `platform/functions/src/auth`.

---

## 11. Callable authorization surface

Every callable that requires authentication reads `request.auth` and
enforces role per the caller's `role` custom claim. The canonical
Role union lives in `platform/functions/src/shared/auth/claims.ts`
(values: `student`, `teacher`, `platformAdministrator`, plus the
lifecycle-only `provisioned` and `pendingVerification` statuses on
the user document).

Role-scoped callables:

- `student`: assessment sessions, assessment attempts, assessment
  attempt get, assignments list for student, enrollments join by
  code, assessment sessions autosave.
- `teacher`: class management, assignment management, enrollment
  management, assessment attempt get for teacher, assessment
  attempts list for class, assessment assignment summary, every LMS
  callable (verified via the `teacherId` derivation from
  `request.auth`), submissions.
- `platformAdministrator`:
  `identityMigrationRunProductionInventory` only.
- Authenticated (any role): `reconcileMyExternalIdentity`.

Unauthenticated callables: none. Every export in
`platform/functions/src/index.ts` requires an authenticated caller.

Background triggers do not consult `request.auth`; `authOnUserCreate`
runs system-authored.

---

## 12. Deployment assumptions

- Firebase project id is bound via `firebase use` before every
  deploy. A mismatch aborts the deploy.
- Functions codebase source path is `../functions` relative to
  `platform/firebase/firebase.json`, resolving to
  `platform/functions`. Do not move without updating the config.
- `lmsProviders/googleClassroom` seed is present before the first
  live teacher connection. Seeding is documented in
  `LMS_INTEGRATION_OPERATIONS.md` §12.
- Firestore Rules deploy is executed BEFORE the Functions deploy on
  first deploy so server-only collections carry the deny surface
  before any function opens them.
- No other repository or codebase declares Cloud Functions for this
  project. `platform/firebase/firebase.json` declares a single
  functions codebase.

---

*End of matrix. Update this file whenever a new secret, parameter,
env var, API, IAM binding, or callable authorization requirement is
introduced.*
