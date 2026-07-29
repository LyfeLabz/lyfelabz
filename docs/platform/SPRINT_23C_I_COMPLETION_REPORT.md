# Sprint 23C-I Completion Report

Student External Identity Bridge

Status: Sprint 23C-I bridge implementation complete at the code, test, emulator (rules), and fixture level. Sprint 23C roster retrieval, roster reconciliation, production migration, durable operational provisioning, and Classroom roster synchronization remain separately gated.

---

## 1. Files created

- `platform/functions/src/shared/types/external-identity.ts` - canonical record + write shapes for `externalIdentities/{externalIdentityId}`.
- `platform/functions/src/shared/identity/external-identity-doc-id.ts` - deterministic SHA-256 document-ID helper and identifier validators.
- `platform/functions/src/shared/identity/external-identity-doc-id.test.ts`
- `platform/functions/src/shared/identity/external-identity-store.ts` - narrow server-side store: `createOrConfirm`, `resolveActiveIdentity`, `revoke`, `restore`, `listForUser`, `reconcileForUser`.
- `platform/functions/src/shared/identity/external-identity-store.test.ts`
- `platform/functions/src/shared/identity/external-identity-store.concurrency.test.ts` - transaction retry / uniqueness proof against a harness that models the Firestore retry-on-conflict contract.
- `platform/functions/src/shared/identity/executable-equivalence.test.ts` - fictional-identifier proof of Classroom `Student.userId` <-> Firebase Auth `google.com` provider UID equivalence.
- `platform/functions/src/shared/identity/index.ts`
- `platform/functions/src/identity/reconcile-my-external-identity.ts` - authenticated callable.
- `platform/functions/src/identity/reconcile-my-external-identity.test.ts`
- `platform/functions/src/identity/index.ts`
- `platform/functions/src/scripts/migration/external-identity-migration.ts` - emulator-only backfill service (inventory + write modes).
- `platform/functions/src/scripts/migration/external-identity-migration.test.ts`
- `platform/firebase/tests/external-identities.rules.test.ts` - rules-emulator-backed server-only access proof.
- `docs/platform/SPRINT_23C_I_COMPLETION_REPORT.md` - this document.

## 2. Files modified

- `platform/functions/src/auth/auth-on-user-create.ts` - added narrow identity-bridge write after the canonical provisioning path.
- `platform/functions/src/auth/auth-on-user-create.test.ts` - preserved every existing test; added the Sprint 23C-I identity-bridge cases (one Google provider, no Google, multiple providers with one Google, malformed, duplicated Google entries, collision, second-active refusal, transient failure, no-leak on logs, restored / confirmedNoop outcomes, no role/status mutation).
- `platform/functions/src/shared/types/audit-event.ts` - extended the `AuditAction` union with the seven `identity.*` actions.
- `platform/functions/src/shared/audit/write-audit-event.ts` - extended `VALID_ACTIONS` in lockstep.
- `platform/functions/src/shared/firestore/typed-ref.ts` - added `externalIdentitiesCollectionRef`, `externalIdentityDocRef`, and the narrow `externalIdentityCreationDocRef` / `externalIdentityRevocationDocRef` / `externalIdentityRestorationDocRef` write references.
- `platform/functions/src/shared/index.ts` - re-exported the identity types, helpers, refs, and store surface.
- `platform/functions/src/index.ts` - exported the `reconcileMyExternalIdentity` callable.
- `platform/firebase/firestore.rules` - added the `match /externalIdentities/{externalIdentityId}` block with an explicit `allow read, write: if false;` (mirrors `assessmentAnswerKeys` and `auditEvents`).
- `docs/platform/LMS_INTEGRATION_OPERATIONS.md` - added `§17A. Sprint 23C-I - Student External Identity Bridge` operational note.

## 3. Final schema

`externalIdentities/{externalIdentityId}` record shape (immutable ownership fields plus the lifecycle field):

```
providerId:         "google.com"                                (readonly)
providerAccountId:  string, exact bytes preserved               (readonly)
userId:             Firebase Auth UID                            (readonly)
status:             "active" | "revoked"
source:             "authOnUserCreate" | "authReconciliation" | "adminMigration"  (creation origin; not rewritten on transitions)
createdAt:          server Timestamp
updatedAt:          server Timestamp
```

`externalIdentityId` is derived by `computeExternalIdentityDocId({ providerId, providerAccountId })` and is a SHA-256 lowercase 64-character hex hash. The raw provider account identifier never appears in the document path, audit target ID, log payload, or callable response.

Write shapes at the write boundary:
- `ExternalIdentityCreationWrite`: all record fields; `createdAt` and `updatedAt` are `FieldValue`.
- `ExternalIdentityRevocationWrite`: only `status: "revoked"` and `updatedAt`.
- `ExternalIdentityRestorationWrite`: only `status: "active"` and `updatedAt`.

The revocation and restoration write shapes structurally exclude `providerId`, `providerAccountId`, `userId`, `source`, and `createdAt`; a transition cannot silently reassign ownership, rewrite the creation origin, or backdate creation.

No profile, email, display-name, Classroom, or token field is added to the record. Per the sprint directive, no additional field was required.

## 4. Hashing and lookup behavior

Document-ID derivation:
- Canonical input: `"v1" + "\x00" + providerId + "\x00" + providerAccountId`.
- NUL separators are explicit `"\x00"` escapes in source (not literal NUL bytes).
- SHA-256, lowercase hex, exactly 64 characters.
- Provider account identifier validated: string, non-empty, non-whitespace-only, exact string preservation, no NUL byte, max 512 characters.
- No numeric conversion; long numeric-looking identifiers preserve precision.
- Approved provider vocabulary: `"google.com"` only.

Lookup (`resolveActiveExternalIdentity`):
- Compute hashed document ID.
- Fetch exactly one document.
- Verify stored `providerId` matches.
- Verify stored `providerAccountId` matches BYTE-EXACT.
- Require `status === "active"`.
- Return only the Firebase UID (or unresolved).
- Never expose the raw provider identifier to any callable client.

## 5. Uniqueness and concurrency evidence

Store test suites and specific invariant proofs:

- `external-identity-store.test.ts`:
  - Invariant #1 - "one provider account maps to only one UID": test `collision - same provider account, different UID - is refused and existing record preserved`.
  - Invariant #2 - "one Firebase UID has at most one active identity per provider": test `second active identity for the same UID and same provider is refused`.
  - Invariant #4 - "restore only for original UID": test `refuses restore for a DIFFERENT UID`.
  - Invariant #5 - immutability while active: tests `active -> revoked, preserves immutable fields, returns 'revoked'` and `restore path - revoked mapping for the same UID is transitioned back to active, createdAt preserved`.
  - Idempotency: `idempotent confirmation of the same (account, uid) returns 'confirmedNoop' with no write`.
  - Public-error non-leak: `Public error must not leak the conflicting UID`.

- `external-identity-store.concurrency.test.ts` (transaction-retry harness modeled on `Firestore.runTransaction`):
  - `two concurrent attempts to link DIFFERENT Google identities to the SAME UID cannot both become active` - one commits, the other refuses with `identity.secondActiveForUser`; final state has exactly one active mapping.
  - `two concurrent attempts to create the SAME (providerId, providerAccountId) for the SAME UID converge on a single active record` - one `created`, one `confirmedNoop`.
  - `two concurrent attempts to link the SAME provider account to DIFFERENT UIDs - exactly one wins; the other refuses with identity.collision`.

Concurrency harness scope note: the concurrency proof runs inside the Jest process against a harness that models the Firestore transaction contract (read-set version tracking, commit-time conflict detection, retry-on-conflict). The `platform/functions` test suite does not currently boot the Firestore emulator inside its own harness, and Sprint 23C-I did not authorize adding one repo-wide. The rules-emulator-backed suite in `platform/firebase/tests/external-identities.rules.test.ts` covers server-only access under the real Firestore emulator; the transaction-retry contract itself is exercised in-process against the harness above.

## 6. Auth-on-create behavior

- Happy path (exactly one valid `google.com` provider entry): emits `auth.userProvisioned` (unchanged), then `createOrConfirmExternalIdentity(source: "authOnUserCreate")`, then `identity.mappingCreated` (or `identity.mappingRestored` on the restore branch, or no identity audit on the `confirmedNoop` branch).
- No Google provider: bridge is not invoked; only `auth.userProvisioned` is emitted; valid case.
- Multiple providers with exactly one `google.com`: the single Google entry is used.
- Malformed / conflicting Google provider data (missing uid on the entry, or duplicate google.com entries): bridge is not invoked; a structured `identity.bridgeSkippedMalformed` warn is logged with only the Firebase UID; no PII (email, displayName, raw provider account id) is logged. The provisioning transition is preserved and reconciliation via the callable remains the recovery lane.
- Idempotent replay (users/{uid} ALREADY_EXISTS): swallowed unchanged; the bridge is not invoked on this branch either, preserving the one-audit-per-transition invariant.
- Collision or second-active-for-user refusal: caught, `identity.collisionDetected` audit event emitted (target ID is a stable `authOnUserCreate-{uid}` structural marker, not the raw provider account identifier), warn logged, NOT re-thrown - the trigger does not enter a Firebase retry loop that could never make progress.
- Transient store error (any other exception): re-thrown so Firebase's built-in trigger retry can heal a transient Firestore error. Idempotency of both `users/{uid}` provisioning and `createOrConfirmExternalIdentity` makes the retry safe.

The identity-bridge sub-step never leaves an unrecoverable partial state: the eventual-consistency recovery lane is the `reconcileMyExternalIdentity` callable and the emulator-only admin migration.

## 7. Reconciliation callable behavior

`reconcileMyExternalIdentity` (`platform/functions/src/identity/reconcile-my-external-identity.ts`):

- Requires authentication; unauthenticated caller refused with `identity.unauthenticated`.
- Never trusts a client-supplied provider account identifier. The request payload is ignored for identity purposes. The caller's UID is drawn from `request.auth.uid`; the observed provider link state is derived server-side from `getAuth().getUser(uid)` via the Admin SDK.
- Rejects a Firebase Auth record with duplicate `google.com` provider entries as `identity.invalidRequest` (malformed input rather than guess).
- Rejects a `google.com` provider entry with an empty `uid` as `identity.malformedProviderRecord`.
- Per-provider outcomes drive per-transition audit events:
  - `created` -> `identity.mappingCreated`
  - `restored` -> `identity.mappingRestored`
  - `confirmedNoop` -> `identity.mappingConfirmed`
  - `revoked` -> `identity.mappingRevoked`
  - `absent` / `alreadyRevoked` / `alreadyActive` -> no audit event
- Response projection includes only `providerId` (public vocabulary) and `externalIdentityId` (SHA-256 hash), plus safe `link` / `revoke` outcome vocabulary. No raw provider account identifier, email, display name, photo URL, or token appears in the response.
- Wraps Auth read failure as `identity.authReadFailed`; the structured log payload includes only the caller UID.

## 8. Migration safeguards

`platform/functions/src/scripts/migration/external-identity-migration.ts` exports `runInventory` (read-only) and `runBackfill` (emulator-only write mode) as PROGRAMMATIC functions. It is NOT exported from `platform/functions/src/index.ts`; the deployed Cloud Function bundle has no callable that reaches it.

`runBackfill` execution is gated by `assertBackfillSafe`, which requires ALL of:
1. `executeWritesAcknowledgement === "I_UNDERSTAND_EMULATOR_ONLY"` (explicit opt-in string).
2. `process.env.FIRESTORE_EMULATOR_HOST` present (Firestore emulator running).
3. `process.env.FIREBASE_AUTH_EMULATOR_HOST` present (Firebase Auth emulator running).

Any missing element throws `identity.migrationWriteSafeguardMissing`. Because the safeguard requires BOTH emulator env vars, a stray production-credentialed process without the emulator hosts cannot execute a write. Combined with the non-export from the deployed function surface, write-mode cannot execute in production without both a code-change AND emulator infrastructure.

Additional inventory / backfill behavior:
- Deterministic pagination via `nextPageToken`; a partial run resumes.
- Inventory writes nothing to Firestore.
- Idempotent write-mode - re-runs count `confirmedNoop` and do NOT emit per-record audit events (matching the sprint directive's guidance for large idempotent runs).
- No enrollment mutation, no role or status change, no lifecycle transition, no activation.
- Every run emits exactly one `identity.migrationAttempted` + one `identity.migrationCompleted` audit event.
- Collisions caught and counted; each emits one `identity.collisionDetected` event with a structural marker target ID.
- No email, raw provider identifier, or profile field in any log payload or return value.

## 9. Rules + audit evidence

Rules (`platform/firebase/firestore.rules`):
- New `match /externalIdentities/{externalIdentityId}` block with `allow read, write: if false;`.
- Terminal deny handles hypothetical subcollections.

Rules tests (`platform/firebase/tests/external-identities.rules.test.ts`):
- Every authenticated role (unauthenticated, student, teacher, platformAdministrator) denied `get`, `list`, `create`, `update`, `delete`.
- Hypothetical subcollection reads and writes also denied.
- 16 test suites total pass under `firebase emulators:exec --only firestore jest`; the new external-identities suite adds 12 tests.

Audit vocabulary (both `shared/types/audit-event.ts` `AuditAction` union AND `shared/audit/write-audit-event.ts` `VALID_ACTIONS` array updated in lockstep):
- `identity.mappingCreated`
- `identity.mappingConfirmed`
- `identity.collisionDetected`
- `identity.mappingRevoked`
- `identity.mappingRestored`
- `identity.migrationAttempted`
- `identity.migrationCompleted`

Every identity audit event uses `targetType: "externalIdentity"` and `targetId: <hashed document ID>` (never the raw provider account identifier). System-actor emissions omit `schoolId` per the existing audit-writer contract.

## 10. Privacy / sensitive-data evidence

- `computeExternalIdentityDocId` output NEVER contains the raw provider account identifier (test `does NOT contain the raw provider account identifier as a substring` in `external-identity-doc-id.test.ts`; also `(privacy)` assertion in `executable-equivalence.test.ts`).
- Reconciliation callable response NEVER contains the raw provider account identifier, email, or display name (test `returns the projection with no raw provider identifier and no profile metadata` in `reconcile-my-external-identity.test.ts`).
- `authOnUserCreate` log stream never emits the raw provider account identifier on any successful path (test `does NOT log the raw provider account identifier on any successful path`).
- Migration service log stream and summary never contain email or raw provider identifier (test `logs and returns without leaking emails or provider identifiers`).
- Collision audit events use a structural marker target ID (`collision-observed-N` for the migration path, `authOnUserCreate-{uid}` for the trigger path), never the raw provider account identifier.
- Rules deny every client read of the record body, so the raw provider account identifier stored in the record can never reach a client.

## 11. Validation results

All exact commands executed from the repo root; every command completed successfully.

- `npm --prefix platform/functions run typecheck`: PASS (tsc --noEmit clean).
- `npm --prefix platform/functions run lint`: PASS (eslint clean; 0 problems).
- `npm --prefix platform/functions run build`: PASS.
- `npm --prefix platform/functions test`: PASS - 64 test suites, 1208 tests passing.
- `npm --prefix platform/firebase run test:rules`: PASS under `firebase emulators:exec --only firestore jest` - 16 test suites, 202 tests passing.
- `npm --prefix app run verify`: PASS - curriculum:verify, lessons:verify, typecheck, lint, and test (40 test suites, 754 tests) all green.
- Em-dash sweep on every touched file: clean (no U+2014 present in any newly created or modified file).

## 12. Regression assessment

Every pre-Sprint-23C-I test suite was preserved. The specific counts above reflect:
- functions suite delta: +7 new test files (~124 tests), no existing test removed or weakened.
- rules suite delta: +1 new file (12 tests), no existing test removed or weakened.
- app suite delta: 0.

The auth-on-user-create test file preserved every prior test (canonical provisioning, optional field handling, uid-persistence guard, `auth.invalidUserRecord` refusal, idempotent replay, `auth.userProvisioned` shape, idempotent-skip zero-audit). Sprint 23C-I cases were added under a new `describe` block; the prior cases continue to pass unchanged.

## 13. Remaining lifecycle limitations

1. User deletion. No Firebase Auth user-deletion trigger currently exists in `platform/functions/src/auth/`. When a lifecycle sprint adds one, external-identity records for the deleted UID should transition to `revoked` (never deleted) and preserve `providerId`, `providerAccountId`, `userId`, `createdAt`. The store already exposes `revokeExternalIdentity` and `listExternalIdentitiesForUser` for that integration; no schema change is required. Historical mappings must NOT be deleted automatically; the Firebase UID on a mapping must NEVER be nulled; the sprint that ships this is out of scope for 23C-I.
2. Provider-link / provider-unlink real-time detection. Firebase Auth does not fire a trigger when a user links or unlinks a provider on an existing account. The bridge updates only on Auth user creation, on the reconciliation callable, or via the admin migration service. A future sprint may introduce a scheduled reconciliation sweep; this is out of scope for 23C-I.
3. Production migration and durable operational provisioning. `runBackfill` is emulator-only. Production activation is separately gated behind the same operational readiness described in the Sprint 23B completion report for the token store and OAuth-state store, and would additionally require an explicit production migration authorization outside 23C-I.

## 14. Sprint 23C dependency status

Sprint 23C-I ships the resolver Sprint 23C's roster engine will consume:

```ts
resolveActiveExternalIdentity({ providerId: "google.com", providerAccountId })
  -> { resolved: true, userId } | { resolved: false }
```

Given a Google Classroom `Student.userId`, the roster engine can call this helper server-side and receive the paired LyfeLabz Firebase UID with no email, display-name, or Classroom-profile involvement. When the resolver returns unresolved for a given Classroom `Student.userId`, the roster engine has an unambiguous signal that no existing LyfeLabz account is linked to that Google identity, and can defer to whatever surface the eventual roster reconciliation authorizes (never provisioning a Firebase user itself; provisioning remains gated by the platform's normal onboarding path).

The bridge is READ-ONLY from Sprint 23C's perspective. It NEVER writes when the roster engine calls it. Writes only flow from the three explicit writer paths (`authOnUserCreate` trigger, `reconcileMyExternalIdentity` callable, emulator-only admin migration).

## 15. Sprint 23C-I certification recommendation

Recommend certification of Sprint 23C-I at the code, test, emulator (rules), and fixture level.

Certification boundary (verbatim):

"LyfeLabz's server-controlled external identity bridge is implemented and certified at the code, test, emulator, and fixture level. Firebase UID remains the canonical platform identity. Google provider identifiers can be associated deterministically with existing LyfeLabz users without email or display-name matching. Production backfill, provider-lifecycle operations, durable LMS custody, operational provisioning, and Classroom roster synchronization remain separately gated."

Explicitly NOT claimed:
- Production migration completed.
- Every existing user is mapped.
- Automatic provider-link detection.
- Automatic provider-unlink detection.
- Classroom roster synchronization is active.
- Production readiness.

---

*End of report.*
