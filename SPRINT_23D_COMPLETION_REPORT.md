# Sprint 23D - Durable OAuth Token & State Storage - Completion Report

## 1. Executive summary

Sprint 23D replaces the two temporary, process-local OAuth *storage*
substrates that Sprint 23B and Sprint 23C shipped with durable,
multi-instance-safe Firestore-backed implementations. It does NOT
add an automatic token-refresh caller; the refresh-convergence
design in section 9 is a documented pattern for the first future
refresh caller (section 12), not an implemented and tested
production behavior in this sprint.

* `InProcessLmsOAuthStateStore` is now paired with
  `FirestoreLmsOAuthStateStore`, a Firestore-backed implementation
  that uses a transactional atomic-claim protocol to guarantee
  single-use consume semantics across concurrent Cloud Function
  instances.
* `InProcessLmsTokenStore` is now paired with
  `FirestoreLmsTokenStore`, a Firestore-backed implementation that
  persists the opaque token bundle behind a high-entropy reference
  and never exposes the reference derivation to a client.

Both durable stores are auto-installed at Cloud Function cold start
(both production Gen2 runtime and Firebase Emulator Suite) through a
new provider-neutral installer,
`ensureLmsDurableStorageBindings`. Unit tests neither set the
runtime env markers nor import `lms/index.ts`, so the InProcess
defaults remain the active binding under jest.

The sprint touched no roster synchronization logic, no callable
behavior, no provider contract, and no enrollment lifecycle. The
change surface is confined to:

* two new store implementations
* one production installer with a runtime-detection auto-run
* two new server-only Firestore collections with matching Rules
  denials
* focused unit-test coverage plus Firestore Rules coverage for the
  two new collections

Validation:

* Functions: **1284 tests passing** (previously 1249; +35).
* Firestore Rules: **220 tests passing** (previously 202; +18).
* App: **754 tests passing** (unchanged; regression-clean).
* Typecheck, lint, build all clean.

## 2. Root cause analysis of the current temporary storage

Both `InProcessLmsOAuthStateStore` and `InProcessLmsTokenStore`
store records in a JavaScript `Map` local to the Cloud Function
process. Every practical failure mode of that design was documented
in the file headers, and Sprint 23B explicitly named the durable
replacement as a Sprint 23C obligation. The core problems:

1. **Cold-start invalidation.** Any pending OAuth state (issued by a
   `lmsConnectionsBegin` on one Cloud Function instance) becomes
   irrecoverable if the completion callable is routed to a different
   warm instance or if the issuing instance is recycled before the
   teacher completes the consent screen.

2. **Cross-instance race.** Two concurrent callable invocations
   handled by different instances cannot observe each other's map
   entries. A teacher who initiates two OAuth flows in quick
   succession can produce state records that live on different
   instances and are pairwise invisible to the peer's completion.

3. **Missing durability.** The token bundle recorded by a completed
   OAuth exchange lives only in-process. Any restart discards the
   bundle, forcing the teacher to reconnect. Every consumer of
   `getLmsTokenStore().resolve(tokenRef)` (5 callables:
   `classes-import`, `classes-refresh`, `classes-list-topics`,
   `classes-sync-roster`, `assignments-publish`, plus
   `connections-disconnect`) is only correct in a single-instance
   deploy.

4. **No auditable substrate.** Neither store leaves any trace on the
   operational side that operations can query when diagnosing a
   failure. Firestore provides both the durability and the
   inspectable audit surface (subject to strict server-only Rules).

The sprint replaces both stores with Firestore-backed
implementations without changing any consumer.

## 3. Storage architecture

### 3.1 Collection: `lmsOAuthStates/{state}`

* **Document identifier.** The opaque 256-bit state value rendered as
  64 lowercase hex characters. High-entropy random; not derivable
  from teacherId or connectionId, so a Rules bug on any sibling
  surface does not permit enumeration.
* **Fields.**
  * `teacherId: string` - LyfeLabz Firebase Auth UID that initiated
    the flow.
  * `providerId: LmsProviderId` - closed vocabulary
    (`googleClassroom`).
  * `redirectUri: string` - bound at issue time; checked at consume.
  * `codeVerifier: string` - RFC 7636 PKCE verifier, server-only.
  * `codeChallenge: string` - derived S256 challenge (recorded for
    observability; the challenge itself is public in the upstream
    authorization URL).
  * `issuedAt: Timestamp`
  * `expiresAt: Timestamp` - 10-minute TTL (matches the in-process
    default).
  * `consumedAt: Timestamp | null` - null while pending; set on
    consume.
* **Indexes.** `revokeForTeacher` runs a query on
  `(teacherId, consumedAt)` or `(teacherId, providerId, consumedAt)`.
  Firestore auto-indexes single-field equality; the composite for
  the three-field predicate will auto-declare on first query in the
  emulator and can be pre-declared in `firestore.indexes.json` as
  the operational team observes it. No composite is required for
  the certified logic to run.
* **TTL policy.** The operational runbook will install a Firestore
  TTL policy on `expiresAt` so expired state records are physically
  removed by Firestore. The store's consume path enforces expiry
  logically regardless of physical presence.

### 3.2 Collection: `lmsTokenBundles/{tokenRef}`

* **Document identifier.** `lms_token_${hex(16bytes)}` (128-bit
  random reference prefixed for log correlation). Not derivable from
  the connection id. The client-readable
  `lmsConnections/{connectionId}.tokenRef` field is the only place
  the identifier leaks into a client-readable document; the paired
  Rules block on `lmsTokenBundles` denies every client operation on
  the token document itself.
* **Fields.** `providerId`, `teacherId`, `accessToken`,
  `refreshToken?`, `scopes[]`, `expiresAtEpochMs?`,
  `upstreamAccountIdentifier`, `createdAt`, `updatedAt`.
* **Indexes.** None required. Every read is a doc lookup by
  reference; there are no queries on this collection.

### 3.3 Ownership

* **Sole writer paths for `lmsOAuthStates`:**
  `lmsConnectionsBegin` (issue), `lmsConnectionsComplete`
  (consume), `lmsConnectionsDisconnect` (revokeForTeacher).
* **Sole writer paths for `lmsTokenBundles`:**
  `lmsConnectionsComplete` (store), `lmsConnectionsDisconnect`
  (revoke), plus any future refresh caller (revoke on the token
  document after a refresh success is intentionally deferred; see
  "Refresh convergence" below).

## 4. Concurrency strategy

### 4.1 OAuth state consume - atomic claim outside validation

The consume path uses a two-step commit protocol so a validation
failure (expired, provider mismatch, redirect mismatch) still marks
the record consumed and prevents replay. Firestore transactions
roll back pending writes on throw, so validation MUST occur
outside the transaction.

Step 1. A Firestore transaction:

* reads the state document,
* refuses if `consumedAt !== null` with
  `lms.oauthStateAlreadyConsumed`,
* schedules `tx.update(docRef, {consumedAt: serverTimestamp()})`,
* returns the captured fields.

Two concurrent claims are serialized by the admin SDK's optimistic-
concurrency retry: the losing caller retries, observes the freshly
persisted `consumedAt`, and refuses with
`lms.oauthStateAlreadyConsumed`.

Step 2. Outside the transaction, the store validates:

* expiration against `Date.now()` against the persisted `expiresAt`,
* `providerId` equality (timing-safe compare),
* `redirectUri` equality (timing-safe compare).

Any failure surfaces the granular internal code
(`lms.oauthStateExpired`, `lms.oauthStateProviderMismatch`,
`lms.oauthStateRedirectMismatch`). The
`connections-complete` callable already coerces every internal
code into the single public `lms.invalidOAuthState` code
(certified in Sprint 23B), so no error-granularity change reaches
the client.

### 4.2 OAuth state revokeForTeacher - batched delete

`revokeForTeacher` runs a Firestore query filtered on
`teacherId`, `consumedAt == null`, and optional `providerId`,
then batch-deletes the matching rows. Consumed rows are preserved
so a completed OAuth exchange leaves an inspectable trail; the
operational TTL sweeps them out after `expiresAt`.

### 4.3 Token bundle writes

* `store` uses `.create()` (guarantees non-overwrite) on a
  fresh high-entropy reference. Collisions loop.
* `resolve` is a single doc read with corruption checks. A missing
  document surfaces `lms.tokenNotFound` (unchanged public
  vocabulary); a document present but structurally malformed
  surfaces `lms.tokenCorrupted`.
* `revoke` is `.delete()`, idempotent for missing documents.

## 5. Files created

* `platform/functions/src/lms/oauth-state/firestore-state-store.ts` -
  `FirestoreLmsOAuthStateStore` implementation.
* `platform/functions/src/lms/oauth-state/firestore-state-store.test.ts` -
  16 tests covering issue, peek, consume, expiration, replay
  prevention, concurrent-consume convergence, mismatch cases, and
  revokeForTeacher.
* `platform/functions/src/lms/tokens/firestore-token-store.ts` -
  `FirestoreLmsTokenStore` implementation.
* `platform/functions/src/lms/tokens/firestore-token-store.test.ts` -
  12 tests covering store, resolve, revoke, corruption handling.
* `platform/functions/src/lms/shared/durable-storage.ts` -
  `ensureLmsDurableStorageBindings` installer plus the
  `isFunctionsRuntime` runtime-detection helper.
* `platform/functions/src/lms/shared/durable-storage.test.ts` -
  7 tests covering the installer's idempotency, its refusal to
  overwrite an injected fixture, and its runtime-detection helper.
* `platform/functions/src/lms/shared/firestore-fake-for-tests.ts` -
  in-memory Firestore fake used only by the two Firestore-backed
  store test suites. Implements the narrow admin-SDK surface those
  suites exercise (doc.create/get/delete, collection.where(...).get,
  batch.delete/commit, runTransaction with retry-on-conflict).
* `platform/firebase/tests/lms-durable-storage.rules.test.ts` -
  18 tests proving every client role is denied every operation on
  `lmsOAuthStates` and `lmsTokenBundles`.
* `SPRINT_23D_COMPLETION_REPORT.md` (this file).

## 6. Files modified

* `platform/functions/src/lms/index.ts` - imports the durable-storage
  installer and invokes it when a Cloud Functions runtime env marker
  is present. Unit tests are unaffected.
* `platform/firebase/firestore.rules` - adds `lmsOAuthStates` and
  `lmsTokenBundles` blocks with an explicit
  `allow read, write: if false;` deny. Every other rule is
  unchanged.

No code that reads a `getLmsTokenStore()` or a
`getLmsOAuthStateStore()` was modified. The narrow-write typed-ref
module, the LMS callables, the provider adapter, and the transport
layer are all untouched.

## 7. Test summary

* **Functions unit tests: 1284 pass, 0 fail** (previously 1249).
  35 net new tests split across the three new suites listed above.
  Every previously-passing Sprint 23A/B/C test still passes without
  modification.
* **Firestore Rules tests: 220 pass, 0 fail** (previously 202).
  18 net new tests in `lms-durable-storage.rules.test.ts`.
* **App tests: 754 pass, 0 fail** (unchanged; no app surface was
  touched).

### Coverage highlights

* OAuth state lifecycle: issue -> peek -> consume -> replay-refuse.
* OAuth state expiration: expired consume commits the consumed
  marker so the record cannot be replayed.
* Concurrent consume convergence: proven with a transaction hook
  that lands a concurrent second consume between the primary
  consume's read and commit. The primary transaction observes the
  version conflict on commit, retries, sees the consumed marker,
  and refuses with `lms.oauthStateAlreadyConsumed`.
* revokeForTeacher scoping: does not touch other teachers'
  records; does not touch consumed records; honors the optional
  providerId narrowing.
* Token store lifecycle: store -> resolve -> revoke, plus
  corruption handling for a partially-populated document, plus
  idempotent revoke.
* Runtime detection: installer is a no-op without env markers
  (jest); becomes active with `K_SERVICE` or `FUNCTION_TARGET`
  set (Cloud Functions Gen2 or emulator).
* Firestore Rules: every client role (unauth, student, teacher,
  platformAdministrator) denied get / list / create / update /
  delete on both collections.

## 8. Validation summary

| Suite | Command | Result |
| --- | --- | --- |
| Functions typecheck | `npx tsc --noEmit` | pass (exit 0) |
| Functions build | `npx tsc -p tsconfig.build.json` | pass (exit 0) |
| Functions lint | `npx eslint --ext .ts src` | pass (exit 0) |
| Functions tests | `npx jest` | 1284 pass |
| Firestore Rules tests | `npm run test:rules` | 220 pass |
| App verify | `npm --prefix app run verify` | 754 pass |

No new warnings. No em dashes introduced in any source or in this
report.

## 9. Refresh convergence

Sprint 23D does not add a refresh caller. The Google Classroom
transport already exposes `refreshAccessToken` for future use, but
no callable currently invokes it - the certified LMS callables
each call `adapter.<operation>` once per request with the current
`accessToken` and surface upstream `401`/`403` as
`lms.upstream.accessRevoked`, which triggers the certified
`connection-revoked` path.

When a Sprint later adds an automatic refresh loop (whether in
`classes-refresh`, `classes-sync-roster`, or a background
maintenance job), the durable token store already provides the
substrate for a race-free swap:

* The refresh caller resolves the current bundle, calls
  `adapter.refreshAccessToken(...)`, and then performs a
  Firestore-transaction read-modify-write on the same token
  document. Two concurrent refreshers converge on the first
  commit; the loser observes the fresher bundle on retry and
  discards its exchange result. No changes to the `LmsTokenStore`
  contract are required; the pattern is a standard Firestore
  transaction over `lmsTokenBundles/{tokenRef}`.

Documenting the strategy without implementing an unused caller is
consistent with the sprint constraint "no placeholder
implementations."

## 10. Remaining production blockers

Sprint 23C's remaining blockers (from its completion report) were:

1. Durable multi-instance OAuth token *storage*.
   **Cleared** by this sprint for the storage substrate:
   `FirestoreLmsTokenStore` persists every bundle in
   `lmsTokenBundles/{tokenRef}`; every production reader
   (`classes-import`, `classes-refresh`, `classes-list-topics`,
   `classes-sync-roster`, `assignments-publish`,
   `connections-disconnect`, `roster/sync-engine`,
   `classes-discover`) resolves through `getLmsTokenStore()` which is
   swapped to the Firestore-backed implementation at cold start.
   *Not cleared* by this sprint: an automatic token-refresh caller.
   No callable currently invokes `adapter.refreshAccessToken`; the
   sprint charter forbids adding placeholder callers. The
   Firestore-transaction read-modify-write pattern described in
   section 9 is the intended convergence design and can be
   implemented and exercised end to end only when the first refresh
   caller lands. See section 12 for the exact activation boundary.
2. Durable OAuth state storage.
   **Cleared** by this sprint. Atomic single-use consume is proven
   by the concurrent-consume convergence test in
   `platform/functions/src/lms/oauth-state/firestore-state-store.test.ts`.
3. Production identity backfill.
   **Deferred** to Sprint 23E per the sprint charter.
4. Operational provisioning and deployment.
   **Deferred** to Sprint 23F. The new operational surfaces this
   sprint introduces are two Firestore collections
   (`lmsOAuthStates`, `lmsTokenBundles`), both server-only, both
   deny-by-Rules. Operational provisioning is limited to:
     * Installing a Firestore TTL policy on
       `lmsOAuthStates.expiresAt`. Not yet declared in
       `platform/firebase/firestore.indexes.json` or `firebase.json`
       (Firestore TTL is a project-level, non-Rules operational
       setting). Until installed, expired state records remain in
       the collection indefinitely; the store's `consume` path still
       refuses them logically (see section 4.1 step 2), so no
       expired state is ever honored, but physical retention is
       unbounded.
     * `lmsTokenBundles` has no automatic expiration or TTL. Bundles
       are removed only when `connections-disconnect` (or a future
       refresh-rotation path) calls `revoke`. This is by design; a
       teacher connection is valid until the teacher disconnects or
       the upstream provider revokes access.
     * Optional composite index on
       `(teacherId, consumedAt, providerId)` for
       `revokeForTeacher` if the emulator warns on first query.
     * The existing operational runbook step that binds
       `GOOGLE_CLASSROOM_CLIENT_ID`, `GOOGLE_CLASSROOM_CLIENT_SECRET`,
       and `GOOGLE_CLASSROOM_REDIRECT_URI` in Firebase Functions
       parameters/Secret Manager.

## 11. Certification recommendation

Sprint 23D is ready for certification of its stated scope: the
durable OAuth state store and durable OAuth token bundle store
that replace the two in-process substrates. Every certified
callable, provider contract, and enrollment lifecycle is
preserved untouched. Concurrent single-use OAuth-state consume is
proven by transactional test. Full functions, rules, and app
validation chains pass with no new warnings and no regressions.

The multi-instance refresh-convergence mechanism itself is a
documented forward design (section 9), not an implemented and
tested production behavior, because no production caller invokes
`adapter.refreshAccessToken` in this sprint or any prior sprint.
Certifying Sprint 23D does not certify automatic refresh.

Recommended next sprint: Sprint 23E (Production Identity
Backfill).

## 12. Future activation boundary for automatic refresh

When a future sprint introduces the first production caller of
`adapter.refreshAccessToken`, that sprint owns:

* Wrapping the resolve/refresh/persist cycle in a
  `runTransaction` over `lmsTokenBundles/{tokenRef}` that
  read-modify-writes the token document. The transaction MUST
  compare a stable version discriminant (e.g. the persisted
  `updatedAt` timestamp or a monotonically incremented
  `refreshGeneration` field added at that time) so a stale
  refresher observes the fresher bundle on retry and discards
  its exchange result rather than overwriting it.
* Handling the case where the upstream refresh grant is rejected
  (invalid_grant, revoked) by transitioning the connection to
  `stale` and dropping the token bundle, so the certified
  reconnect flow triggers on the next callable request.
* Adding an integration test that starts two logical instances
  from the same stale bundle, drives them concurrently through
  the refresh path, and asserts that the final durable bundle is
  deterministic, that only one upstream refresh grant was
  consumed (or that both were consumed and the loser's result
  was discarded), and that no token material appears in any log
  or error surface.

Until that sprint lands, the `lmsTokenBundles` document is only
written by `connections-complete` (create) and
`connections-disconnect` (delete); no read-modify-write path
exists, so the multi-instance refresh race documented in the
sprint charter cannot occur in production.
