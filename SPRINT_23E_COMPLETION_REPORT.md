# Sprint 23E - Production Identity Inventory Callable - Completion Report

## 1. Executive summary

Sprint 23E adds the narrowest possible secure administrative
invocation surface for the pre-existing Sprint 23C-I identity
backfill inventory. The new callable,
`identityMigrationRunProductionInventory`, is a read-only
production dry-run of `runInventory`. It exists so an operator
can determine whether any pre-Sprint-23C-I production
Google-signed-in users lack an
`externalIdentities/{externalIdentityId}` mapping, without any
Firestore write, any enrollment change, or any lifecycle
transition.

The emulator-locked `runBackfill` remains emulator-locked. No
production apply-mode caller was added, and none is authorized by
this sprint.

Discovery report from the first half of Sprint 23E (Options A vs
B vs C decision point) is superseded by this document. The user
selected Option B.

Validation baseline:

- Functions: **1315 tests passing** (previously 1284; +31).
- Firestore Rules: **220 tests passing** (unchanged).
- App: **754 tests passing** (unchanged).
- Typecheck, lint, build: all clean.

Certification recommendation: **production-dry-run-ready**. Not
apply-ready. Not production-backfill-certified.

## 2. What this sprint added

A single callable, one supporting extension to the existing
inventory service, one focused test file, additive coverage on
the existing service tests, one operational runbook, and this
report.

### 2.1 The callable

`identityMigrationRunProductionInventory`, wired at
`platform/functions/src/index.ts:24-27`, implemented in
`platform/functions/src/identity/identity-migration-run-production-inventory.ts`.

Contract:

- Authorization: caller MUST hold the canonical
  `platformAdministrator` custom claim
  (`platform/functions/src/shared/auth/claims.ts`, canonical Role
  union). Unauthenticated callers receive
  `identity.productionInventory.unauthenticated`. Any other
  authenticated role receives
  `identity.productionInventory.forbidden`.
- Read-only: the handler calls `runInventory` only. It never
  calls `runBackfill` and never forwards the emulator-only
  acknowledgement string, even if the client attempts to inject
  it into the request payload.
- Server-derived actor: the handler passes
  `actorUserId: request.auth.uid` to the migration service; the
  client cannot inject a different actor.
- Bounded input: `pageToken` (optional string), `pageSize`
  (integer in `[1, 1000]`, default 250), and
  `collisionSampleLimit` (integer in `[0, 500]`, default 50).
  Every out-of-range or malformed value throws
  `identity.productionInventory.invalidRequest`.
- Bounded output: `usersScanned`, `counts` (per
  `BackfillClassification`), `providerCollisionSamples`
  (SHA-256 hashes, bounded by `collisionSampleLimit`), and
  optional `nextPageToken`. No email, display name, provider
  account id, Firebase UID, or OAuth token appears in the
  response.
- Log payload: one structured `identity.productionInventoryComplete`
  line with the operator UID, scan count, has-next-page flag,
  and sample count. Never logs sample hashes, emails, or
  identifiers.

### 2.2 Inventory service extension

`runInventory`
(`platform/functions/src/scripts/migration/external-identity-migration.ts`)
now returns a bounded `providerCollisionSamples` array of hashed
`externalIdentityId` values (SHA-256, one-way) so an operator
inspecting a nonzero `providerCollision` count can look each
collision up directly under
`externalIdentities/{externalIdentityId}` for triage. The
default cap is 50; the caller can specify 0 to disable sample
collection entirely. Invalid `collisionSampleLimit` values raise
`identity.invalidRequest`.

`runBackfill` was updated to satisfy the extended return type by
returning an empty samples array (its collision path already
emits a `identity.collisionDetected` audit per collision, so
sample collection would duplicate audit signal). Its behavior is
unchanged; it remains emulator-locked.

### 2.3 Files created

- `platform/functions/src/identity/identity-migration-run-production-inventory.ts`
- `platform/functions/src/identity/identity-migration-run-production-inventory.test.ts`
- `docs/platform/SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md`
- `SPRINT_23E_COMPLETION_REPORT.md` (this document; replaces the
  discovery-only draft from earlier in the sprint)

### 2.4 Files modified

- `platform/functions/src/identity/index.ts`
  (re-export the new callable)
- `platform/functions/src/index.ts`
  (top-level Cloud Functions export)
- `platform/functions/src/scripts/migration/external-identity-migration.ts`
  (`providerCollisionSamples` on `ExternalIdentityInventorySummary`,
  new `collisionSampleLimit` option on
  `MigrationServiceOptions`, revised
  `detectExistingMappingCollision`,
  `runInventory` sample collection,
  `runBackfill` empty-samples projection)
- `platform/functions/src/scripts/migration/external-identity-migration.test.ts`
  (mock for `computeExternalIdentityDocId`, five new
  `runInventory` tests covering sample cap, zero cap, invalid
  limits, determinism, empty samples, existing
  `runBackfill` `Object.keys` assertion extended for the new
  field)

## 3. Read-only proof

The callable never writes to Firestore beyond the two bookend
audit events that `runInventory` already emits
(`identity.migrationAttempted` at start,
`identity.migrationCompleted` at end), both server-authored on
the server-only `auditEvents` collection.

Test evidence in
`platform/functions/src/identity/identity-migration-run-production-inventory.test.ts`:

- `NEVER invokes runBackfill`: asserts the `runBackfill` mock is
  not called on any authorized invocation.
- `NEVER forwards the emulator-only write acknowledgement to any
  downstream`: attempts to inject
  `executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY"` in
  the request payload and asserts the option is absent from the
  downstream call and `runBackfill` is still not called.
- `passes the server-derived actorUserId`: attempts to inject a
  spoof `actorUserId` in the payload and asserts the downstream
  call carries the real `request.auth.uid`.

Test evidence in
`platform/functions/src/scripts/migration/external-identity-migration.test.ts`:

- `writes no Firestore document and no per-record audit`
  (existing, unchanged).
- Preservation of the exactly-attempted-plus-completed audit
  bookend invariant (existing, unchanged).

## 4. Authorization proof

Test evidence in the callable test file:

- Unauthenticated caller: rejected with
  `identity.productionInventory.unauthenticated`; `runInventory`
  not invoked.
- Authenticated caller with no role claim: rejected with
  `identity.productionInventory.forbidden`.
- Parametric coverage for roles `"teacher"`, `"student"`,
  `"not-a-role"`, and `""`: each rejected with
  `identity.productionInventory.forbidden`.
- Caller with role `"platformAdministrator"`: accepted;
  `runInventory` invoked exactly once.

The authorization gate mirrors the existing pattern already used
by `teachersApproveVerification`, `teachersDenyVerification`, and
`schoolsCreate`, so it inherits the same reviewed behavior.

## 5. Redaction proof

- Response contract: `usersScanned` (number), `counts` (a fixed
  `Record<BackfillClassification, number>`),
  `providerCollisionSamples` (bounded string array of SHA-256
  identifiers), optional `nextPageToken` (string). No other
  field is projected by `projectResponse`.
- Sample identifiers are one-way SHA-256 hashes of
  `(providerId, providerAccountId)` computed by
  `computeExternalIdentityDocId`. The raw provider account
  identifier never appears in the sample array.
- Log payload contains only `actorUserId`, `usersScanned`,
  `hasNextPage`, and `providerCollisionSamplesCount`.

Test evidence:

- `never adds an email, displayName, providerAccountId, or token
  field`: asserts the serialized response contains none of those
  substrings.
- `only logs actorUserId, usersScanned, hasNextPage, and
  providerCollisionSamplesCount`: asserts the exact log payload
  shape and that no sample hash, email, or provider account id
  appears in any log call.
- `returns hashed providerCollisionSamples up to the default cap
  (50)`: on the inventory service side, asserts every returned
  sample matches `/^[0-9a-f]{64}$/` and no raw `pa-N` provider
  account id appears in the serialized samples.

## 6. Determinism proof

- Callable: the `response projection` and `determinism` blocks
  both assert that repeat calls with identical input against
  unchanged upstream state return `toEqual`-identical output.
- Service: `is deterministic - two runs against identical input
  produce identical output` asserts the full
  `ExternalIdentityInventorySummary` shape is stable across
  repeated `runInventory` calls with the same mocked Auth state.
- Sample cap: the sample cap test proves the array is truncated
  to exactly `collisionSampleLimit` when more collisions exist.

## 7. Request validation

Validated by `validateRequest` and asserted by the parametric
`rejects invalid request: %s` test:

- `pageToken` empty string
- `pageToken` non-string
- `pageSize` non-integer
- `pageSize < 1`
- `pageSize > 1000`
- `collisionSampleLimit < 0`
- `collisionSampleLimit` non-integer
- `collisionSampleLimit > 500`

Every rejection uses the same
`identity.productionInventory.invalidRequest` code, which maps
via the existing `platformCallable` translation layer to
`invalid-argument` on the wire.

## 8. Operational runbook

`docs/platform/SPRINT_23E_PRODUCTION_INVENTORY_RUNBOOK.md`
documents:

- authorization prerequisites
- invocation payload shape
- response shape
- classification bucket meanings
- decision guidance (when a follow-up apply sprint is warranted)
- collision triage procedure
- pagination
- audit evidence
- rerun safety
- explicit non-goals (no apply authorization, no runBackfill
  authorization, no PII distribution authorization)

## 9. Firestore rules

No rule change was required. The store's server-only
`allow read, write: if false;` block on
`externalIdentities/{externalIdentityId}` already denies every
client read and every client write. The callable is a server-side
consumer of `runInventory`; it reads Firebase Auth via the Admin
SDK and writes only the pre-authorized audit-event pattern. The
existing rules test at
`platform/firebase/tests/external-identities.rules.test.ts`
continues to pass unchanged.

## 10. What was NOT built

- No production apply-mode caller. `runBackfill` remains
  emulator-locked.
- No rollback tool.
- No new custom-claim provisioning surface for
  `platformAdministrator`. The role already exists in the
  canonical `Role` union and the canonical `writeCustomClaims`
  helper.
- No client UI. The callable is invocable from any authenticated
  Firebase SDK client, including `functions:shell` and
  admin-scripted paths.
- No deployment. No commit. No production data was read during
  this sprint.

## 11. Remaining production blockers

Unchanged from Sprint 23D except item 1 is now
`dry-run-ready`:

1. Production identity backfill: **production-dry-run-ready**.
   Apply-mode remains blocked pending the outcome of the dry
   run.
2. Firestore TTL provisioning for `lmsOAuthStates.expiresAt`.
3. Secret Manager binding for provider credentials.
4. Deployment and operational certification.
5. Future automatic token refresh and convergence testing.

## 12. Validation totals

- Functions: **1315 tests passing** (previously 1284).
- Firestore Rules: **220 tests passing**.
- App: **754 tests passing** (unchanged).
- Typecheck: clean.
- Lint: clean.
- Build: clean.
- Em-dash grep on every touched file: zero matches.

## 13. Certification recommendation

- **Discovery**: complete.
- **Dry-run-ready**: yes. The callable is safe to invoke against
  production Firebase Auth by a `platformAdministrator` today.
- **Apply-authorized**: no. A production apply would require a
  new safeguard vocabulary distinct from
  `I_UNDERSTAND_EMULATOR_ONLY`, an operator authorization
  allowlist at least as tight as the current gate, a rollback
  tool, and a written apply-mode runbook. None of those exists
  in this sprint and none is authorized by this sprint.
- **Production-executed**: no. No production data was read.
- **Production-certified**: no.

Sprint 23E closes as production-dry-run-ready. The next step is
for an authorized operator to invoke the callable per the
runbook, publish the aggregate counts, and decide whether a
follow-up sprint is warranted to add an apply-mode caller.
