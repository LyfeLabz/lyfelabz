# Sprint 23F - Operational Provisioning and Production Readiness - Completion Report

## 1. Executive summary

Sprint 23F is an operational readiness sprint. It ships zero
behavioral code changes. It produces three new operational documents
that, together with the pre-existing runbooks, make the LyfeLabz
Cloud Functions surface (including the Sprint 23A through Sprint 23E
LMS platform and the Sprint 23C-I external identity bridge) safe to
deploy to a Firebase production project.

Deliverables:

- `docs/platform/SPRINT_23F_OPERATIONAL_DEPENDENCY_MATRIX.md` -
  authoritative inventory of every operational dependency the Cloud
  Functions surface has on Firebase, Google Cloud, Secret Manager,
  IAM, Firestore configuration, OAuth infrastructure, and runtime
  environment variables. Every row references the code that requires
  the dependency.
- `docs/platform/SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md` -
  operational specification for the Firestore TTL policy on
  `lmsOAuthStates.expiresAt`. Sprint 23D introduced the durable
  Firestore-backed OAuth state store; this document is the missing
  operational specification for the sweeper policy. TTL is NOT
  enabled by Sprint 23F; the document defines the procedure the
  operator follows post-deploy.
- `docs/platform/SPRINT_23F_DEPLOYMENT_RUNBOOK.md` - one-document,
  step-by-step production deployment runbook another engineer can
  execute safely. Covers required permissions, APIs, secrets, typed
  parameters, function options, deploy order, post-deploy
  validation, rollback, and known failure modes.

Validation baseline (unchanged from Sprint 23E):

- Functions: 1315 tests passing
- Firestore Rules: 220 tests passing
- App: 754 tests passing
- Functions typecheck, lint, build: all clean

Certification recommendation: **repository operationally ready for
production deployment**. Infrastructure is NOT provisioned by this
sprint; deployment is NOT executed; production is NOT verified; the
inventory dry-run is NOT invoked; the backfill decision is NOT made.
Each of those remains a future operator activity, gated by the
runbook in this sprint.

---

## 2. Operational dependency matrix

Full matrix: `docs/platform/SPRINT_23F_OPERATIONAL_DEPENDENCY_MATRIX.md`.

Summary of dependencies discovered by inspection:

- Secret Manager: exactly one secret,
  `GOOGLE_CLASSROOM_CLIENT_SECRET`, referenced by
  `platform/functions/src/lms/providers/google-classroom/config-firebase.ts:64`
  and attached to nine LMS callables via
  `googleClassroomProductionSecrets`.
- Firebase Functions typed parameters: two non-secret string
  parameters, `GOOGLE_CLASSROOM_CLIENT_ID` and
  `GOOGLE_CLASSROOM_REDIRECT_URI`, both declared at
  `platform/functions/src/lms/providers/google-classroom/config-firebase.ts:46-62`.
- Process environment variables: six, all documented in the matrix.
  `K_SERVICE` and `FUNCTION_TARGET` are auto-populated by the
  runtime and drive the LMS durable-storage installer at
  `platform/functions/src/lms/shared/durable-storage.ts:82-83`.
  `LYFELABZ_LEGACY_SUBMISSIONS_WRITES_ENABLED` gates the deprecated
  legacy submissions writers per PDR-026 §26 and MUST be unset in
  production. `FIRESTORE_EMULATOR_HOST` and
  `FIREBASE_AUTH_EMULATOR_HOST` are read only by the emulator-only
  `runBackfill` service. `GCLOUD_PROJECT` is read only by the
  operator bootstrap script.
- Firebase / Google Cloud APIs: eleven on the Firebase project,
  plus `classroom.googleapis.com` on the LMS OAuth GCP project.
  Full list in the matrix §4.
- IAM: deploying-principal roles enumerated in the matrix §5;
  runtime-SA roles enumerated in the matrix §6.
- Firestore Rules: server-only collections denied to every client
  role (`lmsOAuthStates`, `lmsTokenBundles`, `externalIdentities`,
  `auditEvents`, plus the terminal default-deny). Verified against
  `platform/firebase/firestore.rules:490-558`.
- Firestore indexes: no composite indexes; one
  collection-group field override on `recipients.studentId`
  (`platform/firebase/firestore.indexes.json`).
- Firestore TTL: none deployed; one required policy specified in
  `SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md`.
- Cloud Functions options: every callable inherits Firebase Functions
  v2 defaults; the LMS callables set `{ secrets: [...] }` only. No
  per-callable region, memory, or timeout override exists.
- Runtime: `nodejs20` per `platform/firebase/firebase.json`.
- OAuth infrastructure: recorded in
  `LMS_INTEGRATION_OPERATIONS.md` §3 through §6; unchanged by this
  sprint.

---

## 3. Secret Manager readiness

Findings:

- `GOOGLE_CLASSROOM_CLIENT_SECRET` is the only Secret Manager
  secret referenced by any Cloud Function. It is declared with
  `defineSecret` and bound to the nine LMS callables through the
  `googleClassroomProductionSecrets` array at
  `platform/functions/src/lms/providers/google-classroom/config-firebase.ts:64-74`.
- The runtime resolves the secret lazily inside
  `ensureGoogleClassroomProductionBindings` (`config-firebase.ts:86-111`).
  The function reads the secret only in the "not yet bound" branch,
  so unit tests that pre-inject a fixture never reach for a Secret
  Manager value.
- The resolver reads the secret on every upstream call so a rotated
  secret takes effect without redeploying (see the transport
  factory's `resolveConfig` callback at `config-firebase.ts:97-107`).
- No other repository code path reads a Secret Manager secret. A
  grep for `defineSecret` and `SecretManager` across
  `platform/functions/src` returns only the Google Classroom
  binding. No environment-variable fallback exists for the client
  secret; the deploy will fail closed if the secret is unset.
- Local development uses the fixture transport
  (`__fixtures__/fixture-transport.ts`) and injected config values
  through the `setGoogleClassroomTransport` and
  `setGoogleClassroomConfig` seams. No secret is required for the
  Emulator Suite or the Jest test surface.

No repository change was required. The standardized Secret Manager
usage predates Sprint 23F.

---

## 4. Firestore TTL readiness

Findings:

- `lmsOAuthStates` requires a TTL policy on `expiresAt`. The store
  writes `expiresAt` as a Firestore `Timestamp` ten minutes after
  issuance (`platform/functions/src/lms/oauth-state/firestore-state-store.ts:77`
  and `:165`). Correctness does not depend on the sweeper because
  the consume path rejects expired records unconditionally
  (`firestore-state-store.ts:247`), but storage cost does grow
  without a sweeper.
- `lmsTokenBundles` does NOT receive a TTL policy. Bundles are
  scoped to the lifetime of the LyfeLabz connection record and are
  removed by `lmsConnectionsDisconnect` or by an authorization-error
  fallback. Automatic expiry would defeat the connection lifecycle
  contract.
- `externalIdentities` does NOT receive a TTL policy. Records are
  retained for the lifetime of the Firebase Auth user; a future
  lifecycle sprint owns the deletion transition
  (`LMS_INTEGRATION_OPERATIONS.md` §17A).
- `auditEvents` does NOT receive a TTL policy. Append-only per
  PDR-013.

Operational documentation was missing. Sprint 23F adds
`SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md`, which specifies the
collection, the field, the retention semantics, the Firebase
Console and gcloud CLI provisioning procedures, verification,
rollback, and the explicit non-goal set. TTL is NOT enabled by
this sprint; the document defines the post-deploy operator
procedure.

---

## 5. Deployment readiness

Findings:

- Every callable is wrapped by `platformCallable`
  (`platform/functions/src/shared/errors/https-callable.ts:208`).
  Handlers register through the wrapper; no direct `onCall` usage
  exists in production surface code.
- No callable overrides `region`, `memory`, `timeoutSeconds`, `cpu`,
  `concurrency`, `minInstances`, or `maxInstances`. Every callable
  inherits Firebase Functions v2 defaults (us-central1, 256MiB,
  60s, 80 concurrency, min 0, max 100). Deployment consistency is
  therefore trivially uniform.
- Runtime is `nodejs20` (`platform/firebase/firebase.json`).
- Nine LMS callables set `{ secrets: [...googleClassroomProductionSecrets] }`.
  Verified by grep against every callable file.
- Background trigger: `authOnUserCreate` (Firebase Authentication
  blocking trigger, exported from `platform/functions/src/auth`).
- Deployment order, IAM requirements, API enablement, and secret
  provisioning are captured in
  `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §2 through §8.

No repository change was required. Consistency is inherited by
default because no callable diverges from the shared factory.

---

## 6. Inventory readiness

Findings against `identityMigrationRunProductionInventory`:

- Authorization: enforced in
  `platform/functions/src/identity/identity-migration-run-production-inventory.ts:86-104`.
  Unauthenticated callers receive
  `identity.productionInventory.unauthenticated`. Non-administrator
  authenticated callers receive `identity.productionInventory.forbidden`.
  Only holders of the canonical `platformAdministrator` custom
  claim reach the handler.
- Structured logging: exactly one
  `identity.productionInventoryComplete` line per invocation
  (`identity-migration-run-production-inventory.ts:196-203`),
  carrying the operator UID, scan count, has-next-page flag, and
  sample count. No PII, no upstream identifier, no sample hash
  content.
- Redaction: response projection at
  `identity-migration-run-production-inventory.ts:168-178` returns
  only aggregate counts, an optional `nextPageToken`, and the
  bounded SHA-256 `providerCollisionSamples` array. Email, display
  name, provider account identifier, Firebase UID, and OAuth
  material are structurally excluded.
- Pagination: `pageToken` is a Firebase Auth cursor; `pageSize` is
  validated to `[1, 1000]` (default 250) and `collisionSampleLimit`
  to `[0, 500]` (default 50). Every out-of-range or malformed value
  throws `identity.productionInventory.invalidRequest`.
- Bounded samples: `runInventory`
  (`platform/functions/src/scripts/migration/external-identity-migration.ts:325`)
  respects the caller's limit and never grows the sample array past
  it, per-page. The samples are SHA-256 hashes computed via
  `computeExternalIdentityDocId`; the raw provider account
  identifier never enters the array.
- Deterministic output: the classifier is a pure function of the
  Firebase Auth user record and the persisted external identity
  document. Given the same Auth page state, the same input produces
  identical counts and identical hash values in the samples array.
- Runbook: `SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md` accurately
  describes authorization, invocation, response shape,
  classification buckets, pagination, audit evidence, and rerun
  safety. No repository or runbook update was required by Sprint
  23F beyond cross-referencing from
  `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §10.
- Rerun safety: verified. The callable performs no Firestore writes
  beyond the two bookend audit events per invocation. A rerun with
  the same `pageToken` and page size against unchanged Auth state
  produces identical aggregate output.

---

## 7. Security review

Findings by surface:

- **OAuth state storage.** `FirestoreLmsOAuthStateStore`
  (`platform/functions/src/lms/oauth-state/firestore-state-store.ts`).
  The verifier is written to Firestore under a server-only rule
  (`firestore.rules:501` denies every client operation), never
  returned by `peek`, and returned by `consume` only to the token
  exchange caller. State value is high-entropy (32 bytes /
  256 bits). Consume uses a transactional atomic-claim protocol so
  concurrent consumes serialize and exactly one succeeds.
- **Token bundle storage.** `FirestoreLmsTokenStore`
  (`platform/functions/src/lms/tokens/firestore-token-store.ts`).
  Tokens live under a server-only rule (`firestore.rules:515`
  denies every client operation). The token reference is a
  128-bit random value prefixed for log correlation; the reference
  is deliberately not derivable from the connection id so a
  hypothetical Rules regression on the connection surface would
  not let a client enumerate token documents by guessing paths.
  The store's public surface never returns the raw bundle to a
  callable response.
- **Identity storage.** `externalIdentities/{externalIdentityId}`
  (server-only per `firestore.rules:541`). The document id is a
  SHA-256 hash of `(providerId, providerAccountId)` so the raw
  provider account identifier never appears in the document path,
  audit target id, log payload, or query cursor. Writers are
  `authOnUserCreate`, `reconcileMyExternalIdentity`, and the
  emulator-only administrative migration service; all bypass Rules
  through the Admin SDK.
- **Audit logging.** Registered actions live in
  `shared/types/audit-event.ts` with a runtime validator in
  `shared/audit/write-audit-event.ts`. The audit stream is
  server-only (`firestore.rules:551`). LMS actions
  (`lms.connectionCreated`, `lms.connectionRevoked`,
  `lms.classImported`, `lms.rosterSynchronized`, and the identity
  bookend pair) all carry aggregate payloads and never carry token
  material, provider account identifiers, or PKCE material.
- **Error handling.** Every callable throws a `PlatformError` with
  a stable string code. The `platformCallable` factory
  (`shared/errors/https-callable.ts:229-240`) translates thrown
  errors through `translateThrown`, which surfaces the stable code
  to the client as an `HttpsError`. Internal reasons are collapsed
  onto stable codes at the callable boundary (e.g. every OAuth
  state internal failure surfaces as `lms.invalidOAuthState`).
- **Callables.** Every export in
  `platform/functions/src/index.ts` requires an authenticated
  caller. Role-scoped callables (student, teacher,
  platformAdministrator) enforce `context.role` at handler entry.
  `reconcileMyExternalIdentity` accepts any authenticated caller
  and derives the actor UID and provider data from
  `request.auth.uid` and the Admin SDK re-read of the Auth
  record; never trusts a client-supplied provider identifier.
  `identityMigrationRunProductionInventory` requires the
  `platformAdministrator` claim.
- **Firestore Rules.** The `lmsOAuthStates`, `lmsTokenBundles`,
  `externalIdentities`, and `auditEvents` collections deny every
  client operation. Every collection not explicitly matched hits
  the terminal `match /{document=**}` deny at
  `firestore.rules:556`. Rules coverage: 220 tests passing,
  including the Sprint 23D `lms-durable-storage.rules.test.ts` and
  the Sprint 23C-I `external-identities.rules.test.ts`.

Verified guarantees:

- Tokens never logged. Only production log line touching the token
  surface is `lms.durableTokenStoreInstalled` at
  `platform/functions/src/lms/shared/durable-storage.ts:63`, which
  carries an empty payload.
- Refresh tokens never returned to a client. `FirestoreLmsTokenStore.resolve`
  is called only from the callables that need to invoke the upstream
  provider, and the resulting bundle is never assembled into a
  callable response.
- OAuth state never exposed. `peek` structurally excludes the
  verifier; `consume` returns the verifier only inside the token
  exchange path and never to a callable response.
- Identity inventory redacted. Response shape verified in Section 6.
- Provider payloads not leaked. `LmsRosterStudent` carries only
  the opaque `providerAccountId`; the callable response for
  `lmsClassesSyncRoster` carries only aggregate counts.

No new security defect was identified. No repository change was
required.

---

## 8. Runbook summary

Three operational documents produced. All three cross-reference the
pre-existing `LMS_INTEGRATION_OPERATIONS.md`, `PLATFORM_OPERATIONS_SPECIFICATION.md`,
`LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, and
`SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md`.

- `SPRINT_23F_OPERATIONAL_DEPENDENCY_MATRIX.md`: 12 sections
  covering Secret Manager, typed parameters, process environment
  variables, Google Cloud APIs (both projects), deploying-principal
  IAM, runtime SA IAM, Firestore Rules, Firestore indexes and TTL,
  OAuth infrastructure, Cloud Functions options, callable
  authorization surface, and deployment assumptions.
- `SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md`: TTL scope, Firebase
  Console procedure, gcloud CLI procedure, Firebase CLI limitation,
  verification, rollback, retention expectations, cost posture,
  explicit non-goals.
- `SPRINT_23F_DEPLOYMENT_RUNBOOK.md`: deployment target, required
  IAM, required APIs, Secret Manager provisioning, environment
  parameters, function options, pre-deploy checklist, deployment
  order, post-deploy validation, inventory execution and backfill
  decision guidance, rollback, known failure modes, recovery,
  expected validation baseline, explicit non-goals.

The three documents together satisfy Section 7 ("Deployment
Runbook") of the sprint direction. `SPRINT_23F_DEPLOYMENT_RUNBOOK.md`
is the single entry point another engineer follows; the matrix and
TTL specification are companion references it links out to.

---

## 9. Files created

- `docs/platform/SPRINT_23F_OPERATIONAL_DEPENDENCY_MATRIX.md`
- `docs/platform/SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md`
- `docs/platform/SPRINT_23F_DEPLOYMENT_RUNBOOK.md`
- `SPRINT_23F_COMPLETION_REPORT.md` (this file)

## 10. Files modified

None. Sprint 23F is documentation-only. No repository code path,
no callable contract, no Firestore Rules block, no Firestore
indexes file, no `firebase.json`, and no test file was modified.
Every finding in Sections 3 through 7 was satisfied by pre-existing
implementation.

---

## 11. Validation totals

Executed at Sprint 23F exit:

- Functions: 1315 tests passing, 71 test suites
- Firestore Rules: 220 tests passing, 17 test suites
- App: 754 tests passing, 40 test suites
- Functions typecheck: clean
- Functions lint: clean
- Functions build: clean

No delta against the Sprint 23E baseline. Sprint 23F did not add
tests because no operational improvement required new test
coverage; every finding was verifiable against pre-existing
implementation and pre-existing test surface.

Touched files searched for:

- Secrets: none present.
- Debug logging: none present.
- TODOs: none present (all remaining sprint boundaries are captured
  as documented operator work in the runbooks).
- Em dashes: zero across the four new files.

---

## 12. Remaining production blockers

Repository operational readiness is complete. Sprint 23F closes
every repository-side operational blocker. The remaining blockers
are OUTSIDE the repository and follow the deployment runbook:

1. **Production deployment.** Execute
   `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §7 (pre-deploy) and §8
   (deployment). Operator activity.
2. **Firestore TTL provisioning.** Apply the policy per
   `SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md` §2 after the first
   Functions deploy. Operator activity.
3. **Production inventory execution.** Invoke
   `identityMigrationRunProductionInventory` per
   `SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md` after platform
   administrator claim is provisioned on an operational account.
   Operator activity.
4. **Backfill decision.** Interpret the inventory result per
   `SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md` §Decision
   guidance. If the eligible buckets are collectively zero, no
   production apply-mode sprint is required. If nonzero, a future
   sprint designs the apply caller. Decision, not implementation.
5. **Future automatic token refresh.** Documented as future
   architecture in `LMS_INTEGRATION_OPERATIONS.md` §17 and
   `SPRINT_23D_COMPLETION_REPORT.md` §12. Not a Sprint 23F
   obligation.

Each of the five items is a documented commitment with a linked
runbook or specification. None require a repository change to
initiate.

---

## 13. Certification recommendation

**Repository operationally ready for production deployment.**

Certifications explicitly NOT claimed:

- **Infrastructure ready.** Firebase project, Secret Manager
  secrets, Firebase Functions parameters, IAM grants, and TTL
  policy are not provisioned by this sprint.
- **Deployment executed.** No `firebase deploy` was invoked.
- **Production verified.** The post-deploy validation in
  `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §9 has not been executed.
- **Inventory executed.** No production invocation of
  `identityMigrationRunProductionInventory` occurred.
- **Backfill required or executed.** The decision is contingent on
  the inventory result and is deferred to a future operator
  activity.

Each of the above is gated by an explicit item in the deployment
runbook. The repository is ready; the operational environment is
the operator's next step.

---

## 14. Scope constraints observed

Sprint 23F did not:

- deploy any surface,
- run production inventory,
- execute any production backfill,
- modify roster reconciliation,
- modify identity contracts,
- modify provider contracts,
- modify Classroom integration,
- add UI,
- implement automatic token refresh,
- commit changes.

The four new files were created only; no existing file was
modified.

---

*End of report. Sprint 23F ships operational readiness. Deployment
and production activity are the operator's next step, gated by the
deployment runbook.*
