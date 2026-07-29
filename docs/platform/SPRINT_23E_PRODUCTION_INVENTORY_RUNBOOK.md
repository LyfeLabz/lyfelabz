# Sprint 23E - Production Identity Inventory Runbook

## Purpose

This runbook explains how to invoke the read-only production dry-run
of the Sprint 23C-I external identity backfill, and how to
interpret its output.

The dry run answers one question:

> Are there production Firebase Auth users who signed in with Google
> before Sprint 23C-I whose `externalIdentities/{externalIdentityId}`
> mapping is missing, so Google Classroom roster synchronization
> will classify them as `unresolved`?

The dry run performs NO identity writes, NO enrollment writes, NO
role changes, and NO lifecycle transitions. `runBackfill` remains
emulator-locked and MUST NOT be invoked in production. A production
apply-mode caller does not exist and MUST NOT be added by this
runbook.

## Callable

`identityMigrationRunProductionInventory`

- Handler: `platform/functions/src/identity/identity-migration-run-production-inventory.ts`
- Service: `platform/functions/src/scripts/migration/external-identity-migration.ts` `runInventory`
- Authorization: `platformAdministrator` custom claim (§Authorization)

## Authorization

- The caller MUST hold the canonical `platformAdministrator` role
  claim (see `platform/functions/src/shared/auth/claims.ts`).
- Every other authenticated caller receives
  `identity.productionInventory.forbidden`.
- Every unauthenticated caller receives
  `identity.productionInventory.unauthenticated`.
- No emulator env vars are consulted for authorization. The
  callable is safe to invoke against production because it is
  read-only; `runBackfill` remains the sole write path and is
  emulator-locked by `assertBackfillSafe`.

## Preconditions

1. The caller is signed in with a Google account whose LyfeLabz
   user has been granted the `platformAdministrator` role. If no
   such account exists yet, granting the role goes through the
   canonical `writeCustomClaims` helper; that flow is separate
   from this runbook.
2. The caller has an app surface capable of invoking a Firebase
   Cloud Functions v2 callable. Any authenticated Firebase SDK
   client works: web (`httpsCallable(getFunctions(app),
   "identityMigrationRunProductionInventory")`), the Firebase CLI
   `functions:shell`, or a script that mints a Firebase ID token
   for the administrator account.
3. The caller has read a Sprint 23C-I completion report
   (`docs/platform/SPRINT_23C_I_COMPLETION_REPORT.md`) and this
   Sprint 23E completion report
   (`SPRINT_23E_COMPLETION_REPORT.md`) so they know exactly what
   the classification buckets mean.

## Invocation

Request payload (all fields optional):

```json
{
  "pageToken": "<opaque cursor returned by a prior page>",
  "pageSize": 250,
  "collisionSampleLimit": 50
}
```

- `pageToken`: omit for the first page; supply the value returned
  as `nextPageToken` on a subsequent call to resume.
- `pageSize`: integer in `[1, 1000]`. Default 250. Prefer 250 for
  a full sweep; use smaller pages if the run is being throttled or
  inspected page by page.
- `collisionSampleLimit`: integer in `[0, 500]`. Default 50. Zero
  disables sample collection; counts still populate.

Response payload:

```json
{
  "usersScanned": 1234,
  "counts": {
    "eligibleSingleGoogleProvider": 987,
    "multipleProvidersOneGoogle": 12,
    "noGoogleProvider": 100,
    "orphanUserDocument": 0,
    "orphanAuthUser": 3,
    "providerCollision": 2,
    "disabledAuthUser": 5,
    "pendingOrProvisionedUser": 125
  },
  "providerCollisionSamples": [
    "1a2b3c...<sha256>",
    "9f8e7d...<sha256>"
  ],
  "nextPageToken": "<opaque or omitted>"
}
```

The response contains ONLY the fields listed above. It never
carries an email, display name, provider account identifier,
Firebase UID, or OAuth token.

## Interpretation

### Classification buckets

| Bucket | Meaning | Backfill would help? |
| --- | --- | --- |
| `eligibleSingleGoogleProvider` | Active user with exactly one well-formed google.com provider entry and no existing bridge mapping. | Yes, would be created on backfill. |
| `multipleProvidersOneGoogle` | Active user with multiple linked providers, one of which is a well-formed google.com entry. | Yes, would be created on backfill. |
| `pendingOrProvisionedUser` | User doc exists but `status` is `provisioned` or `pendingVerification`. Not yet onboarded; separate from the eligible bucket so the operator can see them. | Yes on the identity layer; downstream onboarding is unaffected. |
| `noGoogleProvider` | No `google.com` provider entry (or exactly zero recognized entries). | No. Not a Classroom user. |
| `orphanAuthUser` | Firebase Auth user exists but no `users/{uid}` doc. | No. Requires separate provisioning triage. |
| `orphanUserDocument` | `users/{uid}` doc exists but no matching Auth record. Currently never emitted by `runInventory` (it iterates Auth); reserved. | N/A. |
| `disabledAuthUser` | Firebase Auth `disabled === true`. | No. |
| `providerCollision` | The stored bridge already binds this account's provider identifier to a DIFFERENT Firebase UID. Manual triage required before any backfill could safely act. | Not until the collision is resolved. |

### Decision guidance

Interpret the result set as follows.

- If `eligibleSingleGoogleProvider + multipleProvidersOneGoogle
  + pendingOrProvisionedUser` is `0` across every page of the sweep,
  no backfill is required. Sprint 23E closes as
  production-dry-run-ready and no later apply-mode sprint is
  warranted. Every Google-signup user is already covered by the
  Sprint 23C-I `authOnUserCreate` bridge write.

- If those buckets are collectively `> 0` on ANY page, a
  pre-Sprint-23C-I population exists whose Classroom roster members
  would today be counted `unresolved`. A follow-up sprint should
  consider adding a production apply-mode caller. That sprint MUST
  add its own safeguard vocabulary distinct from the emulator
  string, an authorization allowlist that is at least as tight as
  the `platformAdministrator` gate, a rollback tool, and a written
  apply-mode runbook. This dry-run runbook does NOT authorize an
  apply.

- If `providerCollision > 0`, STOP before any later apply sprint
  can proceed. Each `providerCollisionSamples` entry is a SHA-256
  hash of `(providerId, providerAccountId)` and IS the document
  identifier under `externalIdentities/{externalIdentityId}`.
  Operator triage:
  1. For each hashed identifier, read the persisted document
     directly with an admin Firestore client to see the bound
     `userId`, `status`, and `source`.
  2. Compare against the observed Auth user's `providerData`.
  3. Resolve the collision manually via `revokeExternalIdentity`
     (if the persisted binding is wrong) or by re-provisioning
     the Auth user (if the observed record is wrong). Both
     actions are outside this runbook.

### Pagination

`nextPageToken` on the response is the resumption cursor. Iterate
until it is absent. Do not concatenate `providerCollisionSamples`
arrays across pages naively if the same collision is expected on
adjacent pages: sample arrays may contain repeats across pages if
the Auth pagination yields the same collision on multiple pages
during the sweep (Firebase Auth pagination is stable, so this is
not expected in practice, but callers that dedupe should key on
the hash string).

## Audit evidence

Each invocation emits exactly:

- One `identity.migrationAttempted` audit event at start.
- One `identity.migrationCompleted` audit event at end.

Both are actor-attributed: `actorUserId` is the invoking
administrator's Firebase UID. Both live on the server-only
`auditEvents` collection. No per-record audit event is emitted; a
production dry-run over N users produces exactly the same two
audit events regardless of N.

A structured log line `identity.productionInventoryComplete` is
emitted by the callable itself with the operator's UID, the scan
count, the has-next-page boolean, and the number of samples
returned. No PII appears in the log.

## Rerun safety

The callable is safe to rerun. It performs no writes, and the two
bookend audit events are idempotent with respect to the audit
stream (each rerun adds a fresh attempted/completed pair). A
partial run that fails mid-sweep can be resumed by re-invoking
with the last successfully returned `nextPageToken`.

## Explicit non-goals

- This runbook does NOT authorize a production apply.
- This runbook does NOT authorize `runBackfill` invocation.
- This runbook does NOT authorize any Firestore write, any
  Firebase Auth mutation, or any enrollment change.
- This runbook does NOT authorize sharing the response payload
  outside the operator team. Aggregate counts and hashed
  identifiers are safe by construction, but broader distribution
  should still go through the platform data-handling review.

## Related documents

- `docs/platform/SPRINT_23C_I_COMPLETION_REPORT.md` - the bridge
  and the emulator backfill service.
- `docs/platform/LMS_INTEGRATION_OPERATIONS.md` - operational
  narrative for the LMS surface.
- `SPRINT_23D_COMPLETION_REPORT.md` - the durable OAuth storage
  substrate.
- `SPRINT_23E_COMPLETION_REPORT.md` - the sprint that added this
  callable and this runbook.
