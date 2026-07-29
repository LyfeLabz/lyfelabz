# Sprint 23F - LMS Platform Production Deployment Runbook

## Purpose

This runbook is the single procedure another engineer follows to deploy
the LyfeLabz platform Cloud Functions surface (including the Sprint 23A
through Sprint 23E LMS platform) safely into a Firebase production
project.

It is operational. It does not modify code. It does not authorize a
production mutation beyond the deployment itself and the optional
read-only inventory dry-run described in
`SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md`.

The runbook subordinates to `PLATFORM_OPERATIONS_SPECIFICATION.md` and
`LMS_INTEGRATION_OPERATIONS.md`. Where a procedure implies a hosting
posture, environment name, or deployment path that conflicts with
those documents, they control.

Companion documents:

- `LMS_INTEGRATION_OPERATIONS.md` (canonical LMS operations)
- `SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md` (inventory dry-run)
- `SPRINT_23F_OPERATIONAL_DEPENDENCY_MATRIX.md` (dependency inventory)
- `SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md` (TTL provisioning)
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md`
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md`

---

## 1. Deployment target

- Firebase project id (production). Recorded in the operational
  runbook alongside the OAuth client entry from
  `LMS_INTEGRATION_OPERATIONS.md` §4.1. This runbook does NOT commit
  a project id to the repository.
- Firebase project id (staging), if a staging project is present.
  Recorded next to the production project id.
- Firebase CLI binding. `firebase use <project-id>` MUST be executed
  before any deploy step. A mismatch aborts the deploy.
- Deploying principal. Holds `roles/firebase.admin` or an equivalent
  minimum-privilege composition per §2. No principal deploys with a
  personal account outside the operational owner list.

---

## 2. Required IAM permissions

The deploying principal (or a service account it impersonates) MUST
hold the following on the deployment target project:

- `roles/firebase.admin` OR the composition of:
  - `roles/cloudfunctions.admin`
  - `roles/cloudbuild.builds.editor`
  - `roles/artifactregistry.admin`
  - `roles/iam.serviceAccountUser` (to attach the runtime service
    account)
  - `roles/serviceusage.serviceUsageAdmin` (to enable APIs)
  - `roles/datastore.owner` (to deploy Firestore Rules and indexes)
  - `roles/firebasehosting.admin` (only if this deploy also updates
    Hosting)
- `roles/secretmanager.admin` (only for the first-time creation and
  subsequent rotations of `GOOGLE_CLASSROOM_CLIENT_SECRET`; day-to-day
  deploys do NOT require this)

The Cloud Functions runtime service account (default
`<project-id>@appspot.gserviceaccount.com` unless a dedicated runtime
SA is bound in §5) requires:

- `roles/datastore.user` (Firestore read/write via Admin SDK)
- `roles/firebaseauth.admin` (Firebase Auth Admin SDK; required by
  `authOnUserCreate`, `reconcileMyExternalIdentity`, and
  `identityMigrationRunProductionInventory`)
- `roles/secretmanager.secretAccessor` scoped ONLY to
  `GOOGLE_CLASSROOM_CLIENT_SECRET` (attached automatically by
  `firebase-functions/params` `defineSecret` binding declared in
  `platform/functions/src/lms/providers/google-classroom/config-firebase.ts`)
- `roles/logging.logWriter` (structured log emission)

No wider role is granted. Grants outside this list are gating defects
for the pre-deploy checklist in §7.

---

## 3. Required Google Cloud APIs

Enable on the deployment target project before first deploy:

- `cloudfunctions.googleapis.com`
- `cloudbuild.googleapis.com`
- `artifactregistry.googleapis.com`
- `run.googleapis.com` (Cloud Functions v2 runs on Cloud Run)
- `eventarc.googleapis.com` (required by the `authOnUserCreate`
  background trigger)
- `firestore.googleapis.com`
- `firebase.googleapis.com`
- `identitytoolkit.googleapis.com` (Firebase Auth Admin SDK surface)
- `secretmanager.googleapis.com`
- `logging.googleapis.com`
- `pubsub.googleapis.com` (Eventarc dependency)
- `classroom.googleapis.com` (Google Classroom REST API; enable in the
  LMS OAuth GCP project per `LMS_INTEGRATION_OPERATIONS.md` §3.3, NOT
  on the Firebase project unless the two projects are the same)

An API enabled outside this list is not a defect but MUST be reviewed
against `LMS_INTEGRATION_OPERATIONS.md` §3.3 before the next rotation.

---

## 4. Secret Manager provisioning

The LMS platform requires exactly one Secret Manager secret in the
Firebase project:

- `GOOGLE_CLASSROOM_CLIENT_SECRET` (the OAuth 2.0 client secret from
  `LMS_INTEGRATION_OPERATIONS.md` §4.1)

Provision it before the first deploy:

```bash
firebase functions:secrets:set GOOGLE_CLASSROOM_CLIENT_SECRET
```

The CLI prompts for the value. Paste the client secret from the LMS
OAuth GCP project's OAuth client entry. The value is never committed
to the repository, pasted into a chat, or written to any Firestore
document.

Verify the secret is bound (returns the version metadata, never the
value):

```bash
firebase functions:secrets:access GOOGLE_CLASSROOM_CLIENT_SECRET
```

The secret is attached to the five Google Classroom callables via
`googleClassroomProductionSecrets` in
`platform/functions/src/lms/providers/google-classroom/config-firebase.ts`.
No other Cloud Function is granted access.

Rotation follows `LMS_INTEGRATION_OPERATIONS.md` §8.1.

---

## 5. Environment parameters

The LMS platform declares two non-secret Firebase Functions v2 typed
parameters:

- `GOOGLE_CLASSROOM_CLIENT_ID` (string parameter, non-secret)
- `GOOGLE_CLASSROOM_REDIRECT_URI` (string parameter, non-secret)

Both are declared in
`platform/functions/src/lms/providers/google-classroom/config-firebase.ts`
and default to the empty string. The Firebase CLI will prompt for a
non-default value on first deploy. Suggested provisioning:

```bash
firebase functions:params:set GOOGLE_CLASSROOM_CLIENT_ID
firebase functions:params:set GOOGLE_CLASSROOM_REDIRECT_URI
```

The redirect URI value MUST exactly match one of the URIs authorized
on the OAuth client entry (see `LMS_INTEGRATION_OPERATIONS.md` §4.2).
A mismatch causes every `lmsConnectionsBegin` and
`lmsConnectionsComplete` invocation to reject.

Additional environment variables:

- `LYFELABZ_LEGACY_SUBMISSIONS_WRITES_ENABLED` (optional). Default
  behavior is inert; the legacy `submissionsCreate` and
  `submissionsFinalize` callables refuse writes unless this variable
  is set to `"true"`. Production deployments MUST leave this variable
  unset per PDR-026 §26. It exists exclusively for a controlled
  data-migration reconciliation run.

The Cloud Functions runtime automatically populates `K_SERVICE` and
`FUNCTION_TARGET`. The LMS durable-storage installer keys off those
variables in
`platform/functions/src/lms/shared/durable-storage.ts`; no operator
action is required.

---

## 6. Function options (region, memory, timeout, runtime)

All callables are wrapped by `platformCallable` in
`platform/functions/src/shared/errors/https-callable.ts`. That factory
delegates to `onCall` from `firebase-functions/v2/https` and passes
through any `CallableOptions` provided by the caller.

Current explicit option surface:

- `secrets: googleClassroomProductionSecrets` on the five Google
  Classroom callables (`lmsConnectionsBegin`,
  `lmsConnectionsComplete`, `lmsConnectionsDisconnect`,
  `lmsClassesImport`, `lmsClassesDiscover`,
  `lmsClassesRefresh`, `lmsClassesSyncRoster`, `lmsClassesListTopics`,
  `lmsAssignmentsPublish`)
- No callable sets `region`, `memory`, `timeoutSeconds`, `cpu`,
  `minInstances`, `maxInstances`, `concurrency`, or `vpcConnector`.

Runtime defaults (Firebase Functions v2 / Cloud Run):

- Runtime: `nodejs20` (declared in `platform/firebase/firebase.json`)
- Region: `us-central1`
- Memory: `256MiB`
- Timeout: `60s`
- Concurrency: `80`
- Min instances: `0`
- Max instances: `100`

Deployment consistency posture:

- All callables inherit the defaults above. No per-callable override
  is present. A future sprint that needs a different region, memory,
  or timeout MUST introduce the override at the callable's declaration
  site and record the change in the operational runbook.
- The default region (`us-central1`) is the recommended posture for
  the initial deployment. A region change is a one-way migration for
  Cloud Functions v2 (renamed functions must be redeployed and the
  originals deleted) and is not authorized by this runbook.

The background trigger `authOnUserCreate` is declared under
`platform/functions/src/auth/`. It uses the Firebase Authentication
blocking trigger contract exported by `firebase-functions/v2`; deploy
options match the callable defaults above.

---

## 7. Pre-deploy checklist

Execute in order. An unmet item is a gating defect.

1. **Repository state clean.** `git status` shows a clean working
   tree on the commit intended for deploy.
2. **Firebase CLI project binding correct.** `firebase use` reports
   the intended production project id.
3. **IAM sanity.** The deploying principal holds the roles listed in
   §2 on the project.
4. **APIs enabled.** The APIs listed in §3 are enabled. Missing APIs
   are the most common cause of a first-deploy failure.
5. **Secret Manager provisioned.** `GOOGLE_CLASSROOM_CLIENT_SECRET`
   is set per §4. `firebase functions:secrets:access
   GOOGLE_CLASSROOM_CLIENT_SECRET` returns the current version
   metadata.
6. **Parameters provisioned.** `GOOGLE_CLASSROOM_CLIENT_ID` and
   `GOOGLE_CLASSROOM_REDIRECT_URI` are set per §5.
7. **Firestore Rules pass local validation.** From `platform/firebase`
   run `firebase emulators:exec --only firestore "true"` (smoke) and
   from `platform/functions` run `npm test` to confirm the 220 Rules
   tests still pass. The current baseline is 220 Rules tests, 1315
   Functions tests, 754 App tests.
8. **Runtime build clean.** From `platform/functions` run
   `npm run build && npm run typecheck && npm run lint`. All three
   MUST exit zero.
9. **`lmsProviders` seed present** in the target project. See
   `LMS_INTEGRATION_OPERATIONS.md` §12. If missing, seed before
   deploying so the first `lmsConnectionsBegin` invocation resolves.
10. **Runbook readership acknowledged.** The deploying engineer has
    read `LMS_INTEGRATION_OPERATIONS.md` §7, §8, and §13, and this
    runbook end to end.

---

## 8. Deployment order

Execute from `platform/firebase`. Each command targets the currently
bound Firebase project.

1. **Firestore Rules and indexes.**

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

   Rules are the security surface for the OAuth state, token bundle,
   and external identity collections. Deploying Rules FIRST ensures
   any subsequent function that opens those collections observes the
   `allow read, write: if false` surface.

2. **Cloud Functions.**

   ```bash
   firebase deploy --only functions
   ```

   The first deploy provisions every function listed in
   `platform/functions/src/index.ts`. The Firebase CLI prompts for
   any unset typed parameter (see §5). On subsequent deploys, only
   the functions whose implementation changed since the last deploy
   are redeployed.

3. **Firestore TTL policies.** After the first deploy, apply the TTL
   policy on `lmsOAuthStates.expiresAt` per
   `SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md`. TTL is provisioned
   through the Firebase Console or `gcloud firestore fields ttls
   update` because the Firebase CLI does not currently manage TTL as
   a first-class resource. This step is one-time and is not repeated
   on subsequent deploys.

4. **Hosting (optional).** If the deploy also updates static assets:

   ```bash
   firebase deploy --only hosting
   ```

   Hosting deploys are decoupled from the Functions surface and may
   be executed independently.

Do not run `firebase deploy` without an `--only` scope. An unscoped
deploy can silently redeploy resources the runbook does not intend to
touch.

---

## 9. Post-deploy validation

Execute in order. Any failure aborts the rollout and triggers §11.

1. **Function inventory.** `firebase functions:list` reports every
   function declared in `platform/functions/src/index.ts`. No stale
   function remains that is not exported by the current code.
2. **Callable smoke.** From an authenticated client (LyfeLabz web app
   or Firebase CLI `functions:shell`), invoke `lmsProvidersList`. It
   returns the seeded Google Classroom provider entry.
3. **Auth blocking trigger smoke.** Create a new Firebase Auth user
   (through the LyfeLabz sign-in surface) with a Google identity.
   Confirm the `externalIdentities/{externalIdentityId}` document was
   written by the `authOnUserCreate` trigger.
4. **Structured log surface.** Cloud Logging shows structured entries
   `lms.durableOAuthStateStoreInstalled` and
   `lms.durableTokenStoreInstalled` on the first cold start of each
   function that touches the durable storage installer.
5. **OAuth end-to-end.** Execute `LMS_INTEGRATION_OPERATIONS.md` §15
   against the deployed surface. A successful run terminates in a
   revoked connection and confirms the OAuth client secret, redirect
   URI, and OAuth state store all bind correctly.
6. **Inventory dry-run (optional but recommended).** If a platform
   administrator claim has been provisioned on an operational
   account, invoke `identityMigrationRunProductionInventory` per
   `SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md`. The response
   confirms whether a Sprint 23C-I backfill is warranted.

---

## 10. Inventory execution and backfill decision

The inventory dry-run is READ-ONLY. It emits two audit events per
invocation (`identity.migrationAttempted`,
`identity.migrationCompleted`) and one structured log line. It never
writes to any user, enrollment, or external identity document.

Execute per `SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md`. Interpret
the result per that runbook's classification bucket table.

Backfill decision:

- If `eligibleSingleGoogleProvider + multipleProvidersOneGoogle +
  pendingOrProvisionedUser == 0` across every page: no backfill is
  required. Close the sprint as production-dry-run-ready.
- If any of those buckets is nonzero: a follow-up sprint MUST design
  a production apply-mode caller. This runbook does NOT authorize the
  apply.
- If `providerCollision > 0`: STOP. Operator triage is required per
  the inventory runbook.

The current sprint does NOT execute the dry-run. Sprint 23F is
repository operational readiness. Live invocation is a post-deploy
operator activity.

---

## 11. Rollback

Rollback is per `PLATFORM_OPERATIONS_SPECIFICATION.md`. Cloud
Functions v2 does not support in-place version rollback via the
Firebase CLI; rollback is a redeploy of the prior known-good commit.

Procedure:

1. Identify the prior known-good commit (the last commit whose deploy
   completed §9 without a failure).
2. `git checkout <prior-commit>` on the deploying workstation.
3. Re-execute §7 through §9 against the same Firebase project. The
   redeploy overwrites the failing function surface with the prior
   known-good binaries.
4. Record the rollback in the operational runbook with the failing
   commit sha, the restored commit sha, and the initiating principal.

Rules and indexes rollback:

- A Rules regression is rolled back by redeploying the prior known-
  good `firestore.rules` (`firebase deploy --only firestore:rules`).
- A destructive index change is not authorized by this runbook.
  Additive indexes are the only index change allowed by the current
  repository (`platform/firebase/firestore.indexes.json`), and every
  additive index is safe to leave in place across a Functions
  rollback.

Secret rotation rollback: retain the prior secret version through the
rotation window per `LMS_INTEGRATION_OPERATIONS.md` §8.1.

---

## 12. Known failure modes

- **`GOOGLE_CLASSROOM_CLIENT_SECRET` unset.** First `lmsConnectionsBegin`
  or `lmsConnectionsComplete` call throws a Secret Manager not-found
  error and rejects with a stable LMS error code. Fix: provision per
  §4 and redeploy.
- **`GOOGLE_CLASSROOM_REDIRECT_URI` mismatch.** Google returns a 400
  during the token exchange; the callable rejects with
  `lms.upstreamAuthorizationFailed`. Fix: correct the parameter per
  §5 or the OAuth client entry per `LMS_INTEGRATION_OPERATIONS.md`
  §4.2, then redeploy.
- **APIs disabled.** Deploy fails with a permission-denied on the
  first function that requires the API. Fix: enable per §3.
- **Missing `lmsProviders/googleClassroom`.** `lmsProvidersList`
  returns an empty list; `lmsConnectionsBegin` rejects with a
  provider-not-registered error. Fix: seed per
  `LMS_INTEGRATION_OPERATIONS.md` §12.
- **Cold-start invalidation of pending OAuth state.** Sprint 23D
  moved OAuth state and token custody to Firestore
  (`FirestoreLmsOAuthStateStore`, `FirestoreLmsTokenStore`). If the
  durable-storage installer fails to run because the runtime env
  vars are absent (misconfigured emulator harness), pending state
  falls back to the in-process default and cross-instance flows
  fail. Fix: confirm the log line
  `lms.durableOAuthStateStoreInstalled` appears on cold start; if
  absent, the runtime detection in
  `platform/functions/src/lms/shared/durable-storage.ts` is failing
  and the deploy should be rolled back per §11.
- **`identityMigrationRunProductionInventory` forbidden for known
  admin.** Caller lacks the `platformAdministrator` custom claim.
  Fix: grant via the canonical `writeCustomClaims` helper (see
  `platform/functions/src/shared/auth/claims.ts`).
- **Firestore TTL not applied.** Consumed OAuth state records
  accumulate in `lmsOAuthStates`. This does not break correctness;
  the consume path already rejects consumed records. Fix: apply TTL
  per `SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md`.

---

## 13. Recovery steps

Recovery is per `PLATFORM_OPERATIONS_SPECIFICATION.md`. LMS-specific
recovery notes:

- **Destroyed token bundle.** A revoked or manually deleted
  `lmsTokenBundles/{tokenRef}` document is unrecoverable by design
  (see `LMS_INTEGRATION_OPERATIONS.md` §9.4). The affected teacher
  reconnects through the Integrations surface.
- **Corrupted OAuth state.** Consumed or expired
  `lmsOAuthStates/{state}` records are correctness-safe to delete
  manually. Pending records may be revoked via
  `revokeForTeacher({teacherId, providerId})` before the teacher
  restarts the connection flow.
- **Stale `externalIdentities` mapping.** A production apply-mode
  caller does not exist. Manual triage runs against the Admin SDK
  per `SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md` §Decision
  guidance.

---

## 14. Expected validation baseline

The current repository baseline (Sprint 23F entry):

- Functions: 1315 tests passing
- Firestore Rules: 220 tests passing
- App: 754 tests passing
- Typecheck, lint, build: clean

A deploy MUST NOT proceed if any of the above regresses. The
Sprint 23F completion report records the exact post-sprint totals.

---

## 15. Non-goals

This runbook does NOT:

- authorize a production mutation beyond the deploy and the optional
  read-only inventory dry-run,
- authorize a `runBackfill` invocation (emulator-locked per
  `assertBackfillSafe`),
- rotate any secret,
- change any callable's contract,
- add or remove a Firestore collection,
- modify Firestore Rules beyond redeploying the current
  `platform/firebase/firestore.rules`,
- deploy Hosting content (Hosting is decoupled per §8 step 4).

---

*End of runbook. Every procedure in this document reads or deploys
existing artifacts; nothing here mutates production state beyond the
deployment itself.*
