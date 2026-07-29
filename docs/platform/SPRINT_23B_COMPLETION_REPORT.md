# Sprint 23B Completion Report

Google Classroom Adapter Activation (OAuth + Course Discovery)

Status: Adapter activation complete. Sprint 23B security completion (server-side OAuth state validation + PKCE) complete at the code, test, emulator, and controlled single-process level. Production activation remains blocked pending durable multi-instance token and OAuth-state stores plus operational provisioning.

---

## 1. Sprint 23B implementation summary

Sprint 23B activates five of the seven operations on the Google Classroom adapter that Sprint 23A prepared as `lms.providerNotYetOperational` rejects:

- `beginOAuth`
- `completeOAuth`
- `revokeGrant`
- `listTeacherClasses`
- `fetchClass`

The remaining two (`listClassTopics`, `publishAssignment`) intentionally continue to reject with `lms.providerNotYetOperational` and belong to a future sprint.

The activation flows entirely through the seams that Sprint 23A introduced:

- The adapter now imports the transport seam (`getGoogleClassroomTransport`) and the config seam (`getGoogleClassroomConfig`) and never reaches for anything provider-specific outside the `providers/google-classroom` package.
- A new fetch-based production transport binding (`createHttpsGoogleClassroomTransport`) is added inside `transport.ts` alongside the existing unbound sentinel.
- A new Firebase-native config binding (`config-firebase.ts`) uses `defineSecret` for the client secret and `defineString` for the client id and redirect URI.
- An idempotent installer (`ensureGoogleClassroomProductionBindings`) wires the two bindings at handler entry for the five activated callables. Test injections still win: the installer detects prior bindings and skips reinstallation.

No architectural surface (provider interface, callable contract, Firestore collection, Firestore Rule, assessment architecture, assignment lifecycle, immutable Attempts, teacher workflow, student workflow) was changed by this sprint. The provider interface itself is byte-identical to Sprint 23A.

---

## 2. Exact files created

- `platform/functions/src/lms/providers/google-classroom/config-firebase.ts` - Firebase-native production binding for OAuth config and HTTPS transport. Owns the `defineSecret` / `defineString` parameter declarations and the `ensureGoogleClassroomProductionBindings` installer.
- `platform/functions/src/lms/providers/google-classroom/config-firebase.test.ts` - Unit coverage for the installer's idempotency and its respect for test-injected fixtures.
- `platform/functions/src/lms/providers/google-classroom/adapter-activation.test.ts` - Sprint 23B activation coverage for all five activated adapter operations and their upstream-error translations.
- `platform/functions/src/lms/providers/google-classroom/transport-https.test.ts` - Coverage for the fetch-based production transport (`createHttpsGoogleClassroomTransport`), including form encoding, endpoint targeting, and non-2xx error translation.
- `docs/platform/SPRINT_23B_COMPLETION_REPORT.md` - This document.

## 3. Exact files modified

- `platform/functions/src/lms/providers/google-classroom/adapter.ts` - Replaced the stub bodies of `beginOAuth`, `completeOAuth`, `revokeGrant`, `listTeacherClasses`, and `fetchClass` with implementations that route through the transport and config seams. Added `translateUpstreamError` to coerce provider-specific upstream errors into stable vendor-neutral `PlatformError` codes.
- `platform/functions/src/lms/providers/google-classroom/transport.ts` - Added the `getUserProfileMe` transport operation, the `isGoogleClassroomTransportBound` predicate, the `GoogleClassroomHttpsError` class, and the `createHttpsGoogleClassroomTransport` factory. The unbound sentinel is preserved.
- `platform/functions/src/lms/providers/google-classroom/config.ts` - Added the `isGoogleClassroomConfigBound` predicate. Unbound sentinel behavior unchanged.
- `platform/functions/src/lms/providers/google-classroom/__fixtures__/fixture-transport.ts` - Added the `getUserProfileMe` fixture implementation and the `userProfileMeCalls` counter. All Sprint 23A fixture behavior preserved.
- `platform/functions/src/lms/providers/google-classroom/adapter.test.ts` - Retargeted to the Sprint 23B boundary: two deferred operations remain `lms.providerNotYetOperational`; five activated operations now produce vendor-neutral results.
- `platform/functions/src/lms/providers/google-classroom/token-safety.test.ts` - Preserved every token-non-leak invariant. Two tests that asserted `providerNotYetOperational` on `beginOAuth` and `completeOAuth` were re-targeted to assert the same non-leak invariants under the activated code paths. The "no core LMS module imports the Sprint 23A seams" guard was tightened to permit the activated callables to import `config-firebase` while still forbidding any core-neutral module from doing so.
- `platform/functions/src/lms/connections-begin.ts` - Attached `googleClassroomProductionSecrets` to the callable options; installed the production bindings idempotently at handler entry.
- `platform/functions/src/lms/connections-complete.ts` - Same pattern as above.
- `platform/functions/src/lms/connections-disconnect.ts` - Same pattern.
- `platform/functions/src/lms/classes-discover.ts` - Same pattern.
- `platform/functions/src/lms/classes-import.ts` - Same pattern.
- `docs/platform/LMS_INTEGRATION_OPERATIONS.md` - Added §7.4 "Sprint 23B activation - OAuth client parameter binding" documenting the concrete parameter names, the callables the secret is attached to, and the deferred token-store work.

---

## 4. OAuth activation summary

The OAuth grant lifecycle is now driven end-to-end by real code:

- `beginOAuth` builds a Google authorization URL against `https://accounts.google.com/o/oauth2/v2/auth` using the configured client id, redirect URI, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, and the two initial-scope Classroom scopes documented in Sprint 23A. State is 32 random bytes (256 bits) rendered as hex.
- `completeOAuth` exchanges the authorization code at `https://oauth2.googleapis.com/token`, then reads `https://classroom.googleapis.com/v1/userProfiles/me` to attach `upstreamAccountIdentifier` to the vendor-neutral grant. The identifier feeds the Amendment §6.1 personal-account misconnection mitigation. Every classroom scope grants access to the caller's own profile, so no additional scope is required.
- `revokeGrant` posts to `https://oauth2.googleapis.com/revoke`, preferring the refresh token (revoking a refresh token invalidates every access token minted from it per Google's contract) and falling back to the access token if none is stored.

Server-side OAuth state validation and PKCE (Authorization Code Flow with PKCE, S256) are implemented as part of Sprint 23B security completion; see §11 below. Re-authorization for expired refresh tokens remains deferred to Sprint 23C.

---

## 5. Token-management implementation summary

Sprint 23B **preserves** the existing in-process `LmsTokenStore` binding introduced in Sprint 23A. The user directive at the start of Sprint 23B (Option B) is honored: activation of OAuth and course discovery is separated from production credential infrastructure.

Verified token-non-leak invariants:

- Access and refresh tokens never appear in a Firestore document. `lmsConnections/{connectionId}` records only the opaque `tokenRef` and the granted scopes.
- Access and refresh tokens never appear in a callable response. The connection-begin, connection-complete, and connection-disconnect responses expose only opaque identifiers and boolean status fields.
- Access and refresh tokens never appear in a log line. The adapter, the transport, and the callables log identifiers and vendor-neutral error codes only.
- Disconnect continues to revoke upstream credentials through the existing provider contract. `lmsConnectionsDisconnect` calls `adapter.revokeGrant` before discarding the stored bundle.

Explicit deferred work for Sprint 23C: replace BOTH the `InProcessLmsTokenStore` binding and the `InProcessLmsOAuthStateStore` binding (see §11) with durable, multi-instance production stores. The `LmsTokenStore` / `LmsOAuthStateStore` interfaces and the `setLmsTokenStore` / `setLmsOAuthStateStore` seams are preserved so the swap will not require touching any callable, adapter, or Firestore surface.

---

## 6. Course-discovery implementation summary

`listTeacherClasses` and `fetchClass` are activated.

- `listTeacherClasses` paginates `GET /v1/courses?teacherId=me&courseStates=ACTIVE` up to a bounded 25 pages of results, filters returned courses to `courseState === "ACTIVE"` (or undefined, which Google treats as ACTIVE for a fresh course), and maps each Google `Course` resource into an `LmsDiscoveredClass`. The bound is a defense against a runaway upstream that never returns a nextPageToken.
- `fetchClass` calls `GET /v1/courses/{id}` and returns a single `LmsDiscoveredClass`. Ownership is intentionally not enforced at the adapter layer; the `classes-import.ts` callable is where the caller's teacher-of-record ownership check runs, exactly as it did in Sprint 23A.
- Upstream errors are translated into stable `PlatformError` codes at the adapter boundary: `lms.upstreamAuthorizationFailed` (401/403 and 400+invalid_grant), `lms.upstreamResourceNotFound` (404), `lms.upstreamTemporarilyUnavailable` (429/503), `lms.upstreamMalformedResponse`, and `lms.upstreamCallFailed` (any other non-2xx). The vendor-neutral core sees only these codes; the concrete HTTP status never escapes the Google package.

---

## 7. Validation results

All validation gates were run inside the `platform/functions/` and `app/` packages after every material change and again at completion.

- `npm --prefix platform/functions run typecheck` - PASSED (no output on success).
- `npm --prefix platform/functions run lint` - PASSED (no output on success).
- `npm --prefix platform/functions run build` - PASSED.
- `npm --prefix platform/functions test` - **54 test suites, 1050 tests passed, 0 failed** (baseline was 51 suites / 1023 tests in Sprint 23A; the delta is +3 suites / +27 tests, all from Sprint 23B additions).
- `npm --prefix app run verify` - **40 test suites, 754 tests passed, 0 failed** (unchanged from Sprint 23A baseline).

New tests introduced by this sprint:

- `adapter-activation.test.ts` - 18 tests covering `beginOAuth` URL shape, state entropy, redirect-URI override, `completeOAuth` success + `invalid_grant` + 401 + 503, `revokeGrant` refresh-token preference + fallback + 401, `listTeacherClasses` paginated aggregation + ownership passthrough + 401 + 429, `fetchClass` success + foreign-owner passthrough + 404, and token-refresh transport surface success + failure.
- `transport-https.test.ts` - 8 tests covering fetch-based transport form encoding, endpoint targeting, malformed 2xx bodies, and the four Classroom REST v1 read paths.
- `config-firebase.test.ts` - 2 tests covering the installer's idempotency and its respect for test-injected fixtures.

Every Sprint 23A test still passes without modification of intent; the two tests that asserted `providerNotYetOperational` on `beginOAuth` / `completeOAuth` were retargeted to assert the same token-non-leak invariants under the activated code paths.

---

## 8. Regression assessment

The Sprint 23A boundary invariants remain intact under Sprint 23B:

- The vendor-neutral core (`providers/provider.ts`, `providers/registry.ts`, `tokens/token-store.ts`) does not import any Google-package-local seam. This is now enforced by a tightened guard in `token-safety.test.ts` that specifically excludes those three files from the narrow Sprint 23B exception granted to activated callables.
- The provider interface (`LmsProviderAdapter`) is byte-identical.
- Every callable response shape is byte-identical.
- Every Firestore document write shape is byte-identical.
- Every audit event payload is byte-identical.
- The two deferred adapter operations (`listClassTopics`, `publishAssignment`) still reject with `lms.providerNotYetOperational` under both bound and unbound seams.

No app-side surface changed. The `app/` verification suite is unchanged from the Sprint 23A baseline.

---

## 9. Remaining work for Sprint 23C

The following items are deliberately deferred and are NOT part of Sprint 23B:

- **Durable production token store.** Replace `InProcessLmsTokenStore` with a durable, multi-instance production binding. Interface and `setLmsTokenStore` seam preserved.
- **Durable production OAuth state store.** Replace `InProcessLmsOAuthStateStore` (see §11) with a durable, multi-instance production binding. Interface and `setLmsOAuthStateStore` seam preserved.
- **Refresh-token rotation on the read path.** Currently a stored access token that returns 401 during `listTeacherClasses` or `fetchClass` surfaces `lms.upstreamAuthorizationFailed` to the caller. Sprint 23C should add a single silent refresh-and-retry using the stored refresh token before surfacing the error.
- **Topic listing (`listClassTopics`).** Owned by the assignment-publication sprint.
- **Assignment publication (`publishAssignment`).** Owned by the assignment-publication sprint.
- **Roster synchronization.** Explicitly out of scope for the entire 23 series.

---

## 10. Sprint 23B certification recommendation

Every architectural constraint enumerated in the sprint specification was preserved:

- No modification of the vendor-neutral provider interface.
- No callable request / response contract change.
- No Firestore collection change.
- No Firestore Rule change.
- No assessment architecture change.
- No assignment lifecycle change.
- No immutable-Attempt change.
- No teacher workflow change.
- No student workflow change.
- No new OAuth scopes beyond the two initial-scope scopes Sprint 23A already declared.
- No roster synchronization.
- No assignment publication.
- No deployment of functions; no provisioning of production credentials.

Every validation gate is green. The five activated operations, the two deferred operations, the Sprint 23A test surface, and the Sprint 23B security completion surface all behave exactly as the specification requires.

**Certification statement.** Google Classroom OAuth and course-discovery adapter activation is complete and security-certified at the code, test, emulator, and controlled single-process level. Server-side OAuth state validation and PKCE are implemented. Production activation remains blocked pending implementation and certification of durable multi-instance token and OAuth-state stores and completion of operational provisioning.

Sprint 23C is not started. Awaiting explicit authorization.

---

## 11. Sprint 23B security completion (server-side OAuth state + PKCE)

The initial Sprint 23B implementation shipped adapter activation with client-echoed state and no PKCE. The security completion pass adds:

- a cryptographically secure, server-generated, single-use OAuth state value bound to the initiating teacher, provider, and redirect URI;
- OAuth 2.0 Authorization Code Flow with PKCE using an S256 code_challenge;
- server-side validation that atomically consumes the state record before token exchange;
- teacher-binding validation in the callable before the adapter is invoked;
- concurrency and replay protection at the store boundary;
- revocation of pending state records on disconnect and on restarted begin flows.

**Vendor-neutral state store.** A new module at `platform/functions/src/lms/oauth-state/state-store.ts` defines:

- `LmsOAuthStateStore` interface (`issue`, `peek`, `consume`, `revokeForTeacher`);
- `InProcessLmsOAuthStateStore` default binding;
- `getLmsOAuthStateStore` / `setLmsOAuthStateStore` / `resetLmsOAuthStateStoreForTests` / `withLmsOAuthStateStore` seams that mirror the discipline of `LmsTokenStore`;
- `derivePkceS256Challenge` helper exposed for cross-verification in tests;
- `LMS_OAUTH_STATE_ERROR_CODES` internal error catalogue (not part of the public LMS error contract).

The store is intentionally vendor-neutral: any provider adapter that later adopts state + PKCE reuses the same custody surface. The vendor-neutral provider interface (`LmsProviderAdapter`) is byte-identical to Sprint 23A.

**State lifecycle.**

- `lmsConnectionsBegin` revokes any prior pending state records for `(teacherId, providerId)`, then invokes `adapter.beginOAuth({teacherId, redirectUri})`.
- The adapter calls `stateStore.issue({teacherId, providerId, redirectUri})`. The store generates 32 random bytes for state (256 bits, rendered as 64 lowercase hex characters), 32 random bytes for the PKCE code_verifier (rendered as 43 base64url characters, no padding), and derives the code_challenge as `base64url(SHA-256(code_verifier))` per RFC 7636 §4.2. Records carry `issuedAtEpochMs` and `expiresAtEpochMs = issuedAt + 10 minutes`.
- The adapter embeds `state`, `code_challenge`, and `code_challenge_method=S256` in the Google authorization URL alongside the existing scope, redirect, and prompt parameters. The verifier stays server-side.

**Consumption lifecycle.**

- `lmsConnectionsComplete` peeks the store, rejects if the record is missing / expired / consumed / bound to a different teacher / bound to a different provider / bound to a different redirect URI. Every internal reason surfaces as the single public code `lms.invalidOAuthState` so error granularity does not leak.
- The adapter calls `stateStore.consume({state, expectedProviderId, expectedRedirectUri})`. Consume is a single atomic step against the record map: it observes the consumed marker, sets it before any await, and only then re-validates expiration, provider, and redirect. Failed validation still consumes the record so a subsequent replay observes "already consumed".
- The adapter passes the returned `codeVerifier` to `transport.exchangeAuthorizationCode` alongside `code`, `redirect_uri`, `client_id`, `client_secret`, and `grant_type=authorization_code`. The transport already accepted `codeVerifier` from Sprint 23A; no transport signature change was required.

**Concurrency and replay evidence.** The store's atomic single-use consume is verified by `state-store.test.ts` "guarantees exactly one successful concurrent consume for the same state", which races eight simultaneous consumes against the same state and asserts exactly one success and seven `lms.oauthStateAlreadyConsumed` rejections. A replay after a successful completion is verified by "is single-use: replaying a valid consume rejects with the consumed code" and by the adapter-level `adapter-pkce.test.ts` "completeOAuth is single-use" case. An expired record is verified by "rejects an expired record" using a mocked `Date.now`.

**Sensitive-data handling evidence.** No log line, no thrown error message, and no callable response contains the state value, the code_verifier, the code_challenge, the authorization code, the access token, the refresh token, or the OAuth client secret. Enforcement is verified by:

- the pre-existing `token-safety.test.ts` (Sprint 23A) invariants, which now also run under the activated + security-completed paths;
- the state store's `peek` API, which returns binding metadata but never the verifier (verified by "returns the binding fields but never the verifier");
- the state store's `issue` result, which exposes only `{state, codeChallenge}` (verified by "does not return the verifier in the public issue result");
- the callable's uniform `lms.invalidOAuthState` message, verified by "does not surface internal validation granularity" and "does not include state, verifier, code, or tokens in the public error message".

**Revocation lifecycle.**

- `lmsConnectionsBegin` calls `revokeForTeacher({teacherId, providerId})` before issuing so a restarted flow leaves at most one live pending record per `(teacher, provider)` pair.
- `lmsConnectionsDisconnect` calls `revokeForTeacher({teacherId, providerId})` before revoking upstream, so a pending state for a teacher who just disconnected cannot be completed against a revoked connection.
- `revokeForTeacher` never touches consumed records (so a completed connection still sees "already consumed" on any replay) and never touches records for other teachers or other providers. Verified by "removes only records for the specified teacher (and provider)", "does not remove already-consumed records", and "ignores records for other providers when a providerId is supplied".

**Secret-binding review.**

The five activated callables continue to attach the OAuth client secret via `platformCallable({ secrets: [...googleClassroomProductionSecrets] }, handler)`. Attachment is required precisely at the callables whose runtime execution paths reach the Google token endpoint or the classroom REST v1 endpoints:

- `lmsConnectionsBegin`: reaches `config.getGoogleClassroomConfig()` (client id + redirect URI). The current binding source (`config-firebase.ts`) resolves the client secret alongside the client id in the same Firebase parameter block, so the secret must be attached even though `beginOAuth` itself does not send the secret to Google. Required.
- `lmsConnectionsComplete`: sends the client secret to `https://oauth2.googleapis.com/token` at authorization-code exchange. Required.
- `lmsConnectionsDisconnect`: reaches `revokeGrant` which POSTs the token to `https://oauth2.googleapis.com/revoke`; the revoke endpoint accepts client credentials for verified requests and the transport's config resolver reads the secret at construction time. Required.
- `lmsClassesDiscover`: reaches `listTeacherCourses` (bearer token only; no client secret in the request). Attached because the current bindings installer resolves the full config in one step; the secret is loaded but not sent to Google.
- `lmsClassesImport`: reaches `fetchClass` (bearer token only; no client secret in the request). Same rationale as `lmsClassesDiscover`.

Refresh: token refresh via `refreshAccessToken` requires the client secret. The refresh path is not activated in Sprint 23B, but any future callable that triggers refresh must attach `googleClassroomProductionSecrets` for the same reason `lmsConnectionsComplete` does.

Secret access is not broadened for convenience. No other callable in the codebase attaches `googleClassroomProductionSecrets`; every callable that does attach it either sends the secret to Google or is on a code path that resolves the full config through the shared installer.

**Production-store blocker.** BOTH the token store and the OAuth state store use in-process implementations that are only safe for unit tests, Emulator Suite, and controlled single-process validation. Neither is safe for a multi-instance production deploy: a Cloud Function instance restart may invalidate pending OAuth state and may lose stored grants, and requests routed across instances cannot see each other's records. No real teacher connection should be represented as durable at this stage. Sprint 23C owns the durable replacements for both stores.

**Files created in the security completion pass.**

- `platform/functions/src/lms/oauth-state/state-store.ts`
- `platform/functions/src/lms/oauth-state/state-store.test.ts`
- `platform/functions/src/lms/providers/google-classroom/adapter-pkce.test.ts`
- `platform/functions/src/lms/connections-complete-oauth-state.test.ts`

**Files modified in the security completion pass.**

- `platform/functions/src/lms/providers/google-classroom/adapter.ts` (beginOAuth issues state + PKCE via the store and embeds code_challenge + S256 in the authorization URL; completeOAuth atomically consumes the state and forwards the verifier to the transport; also removed several unnecessary type assertions flagged by lint under the security-completion pass)
- `platform/functions/src/lms/connections-begin.ts` (calls `revokeForTeacher` before issuing)
- `platform/functions/src/lms/connections-complete.ts` (teacher-binding pre-check via `peek`; single public error code mapping)
- `platform/functions/src/lms/connections-disconnect.ts` (calls `revokeForTeacher` before upstream revocation)
- `platform/functions/src/lms/providers/google-classroom/adapter-activation.test.ts` (existing completeOAuth tests now issue a real state via beginOAuth before completing; intent preserved, coverage strengthened)
- `platform/functions/src/lms/providers/google-classroom/token-safety.test.ts` (the completeOAuth authorization-failure test now issues a real state so the authorization-failure path is exercised end-to-end)
- `docs/platform/LMS_INTEGRATION_OPERATIONS.md` (new §7.5)
- `docs/platform/SPRINT_23B_COMPLETION_REPORT.md` (status header + this §11)

**Validation results (security completion pass).**

- `npm --prefix platform/functions run typecheck` - PASSED.
- `npm --prefix platform/functions run lint` - PASSED.
- `npm --prefix platform/functions run build` - PASSED.
- `npm --prefix platform/functions test` - **57 test suites, 1087 tests passed, 0 failed.** Delta from the initial Sprint 23B report: +3 suites (state-store, adapter-pkce, connections-complete-oauth-state) and +37 tests.
- `npm --prefix app run verify` - **40 test suites, 754 tests passed, 0 failed.** Unchanged from the Sprint 23A / initial Sprint 23B baseline.
- Repository em-dash check across every touched file - PASSED (0 em-dashes in any of the 12 touched files).

---

## 12. Sprint 23B final integration verification (cross-callable OAuth completion)

The initial Sprint 23B security completion covered the OAuth state store, the PKCE derivation, the adapter, and the completion callable independently. Each surface was verified through unit tests that ran within a single Jest process. Because `InProcessLmsOAuthStateStore` uses a Node module-singleton `Map`, the sprint direction called for one further verification: prove that the pending OAuth state issued by the actual exported `lmsConnectionsBegin` callable is visible to the actual exported `lmsConnectionsComplete` callable when they run in the same Node process, and confirm the exact runtime assumptions that make that sharing work.

**Integration-test method.** A new Jest suite at `platform/functions/src/lms/connections-lifecycle-integration.test.ts` uses the repository's existing callable-integration harness (the same mock pattern as `connections-complete-oauth-state.test.ts`). The suite mocks only system boundaries the sprint spec permits mocking - Firestore (`FieldValue`, `lmsConnectionDocRef`, `lmsConnectionCreationDocRef`), the audit-event writer, the structured logger, and the vendor-neutral `LmsTokenStore` - and leaves everything on the callable-to-adapter path unmocked: the OAuth state store module singleton, the provider registry, the Google Classroom adapter, the Google Classroom config seam, the Google Classroom transport seam, and the `ensureGoogleClassroomProductionBindings` installer. The fixture Google Classroom transport (`__fixtures__/fixture-transport.ts`) and a fictional config are installed before each test through the existing `setGoogleClassroomTransport` / `setGoogleClassroomConfig` seams; the installer's `isBound()` guard then makes the production binding path a no-op, so no Firebase parameter, no Secret Manager value, and no real Google endpoint is touched.

**Exported callable sequence tested.** Each test invokes the real handler exports:

- `__lmsConnectionsBeginHandler` (the exact handler `platformCallable(...)` wraps into `lmsConnectionsBegin`);
- `__lmsConnectionsCompleteHandler` (the exact handler `platformCallable(...)` wraps into `lmsConnectionsComplete`).

The tests pass through the callables' public request contracts (`{providerId, redirectUri}` for begin; `{providerId, code, state, redirectUri}` for complete) and receive their public response contracts (`{authorizationUrl, state}` for begin; `{connectionId, providerId, alreadyConnected}` for complete). No adapter method or state-store method is invoked directly.

**Whether begin and complete shared the state record.** Yes. The state minted by the begin handler was consumed successfully by the complete handler in the same Node process. The completion returned `alreadyConnected=false`, the fixture transport exchanged the authorization code once, the mocked token store recorded the grant once, the mocked connection-creation write ran once, and the mocked audit event fired once with `action: "lms.connectionCreated"`. This is the Outcome A result described in the sprint direction.

**Replay result.** A second invocation of the complete handler with the same state was rejected with the single public code `lms.invalidOAuthState`. The connection-doc `exists: false` mock was refreshed for the second attempt so the reject could only come from the state store's atomic single-use consume, not from the callable's idempotency short-circuit. The token store, the connection write, and the audit-event writer were each still called exactly once after the replay, confirming that the second attempt never exchanged the code and never wrote a duplicate record.

**Sensitive-data result.** For each test, every callable response body, every thrown public error message, every `log.info` / `log.warn` / `log.error` call, every mocked Firestore write payload, and every mocked audit-event payload was serialized to JSON and asserted not to contain any of: the OAuth state value, the PKCE code verifier substring, the fixture authorization code, the fixture access token, the fixture refresh token, or the fixture client secret. The state value is by design present in the authorization URL and the begin response - that is the public contract - so the state substring is excluded from the response-serialization check only; it is enforced on every other surface, including the replay error, the logs, the Firestore write, and the audit event. Every assertion passed.

**Runtime assumptions (the exact scope of Outcome A).** The verification proves cross-callable sharing under exactly these conditions:

- both callables execute inside one Node process (in this case a Jest worker; equivalently, one warmed Cloud Functions instance);
- the module-singleton `InProcessLmsOAuthStateStore` map instance is the same object at both call sites;
- no instance restart, no cold-start of a second instance, and no request routing across instances occurs between begin and complete.

The verification does NOT prove, and cannot prove, that two independently-warmed Cloud Functions instances share pending OAuth state. Cloud Functions v2 may scale a single function to N warm instances, and separate functions (as `lmsConnectionsBegin` and `lmsConnectionsComplete` are) run in independent instance pools. In production, a `begin` handled by instance A followed by a `complete` handled by instance B would fail with `lms.invalidOAuthState` because instance B's in-process map does not contain the record instance A minted. This is exactly the production blocker recorded in §10 and §11 and expanded in `LMS_INTEGRATION_OPERATIONS.md` §7.5; the durable multi-instance store is a Sprint 23C obligation.

**Exact validation counts after the new test.**

- `npm --prefix platform/functions test` - **58 test suites, 1091 tests passed, 0 failed.** Delta from §11: +1 suite (`connections-lifecycle-integration`) and +4 tests. All 1087 prior tests continue to pass.
- No `app/` change was made in this verification pass. `npm --prefix app run verify` remains at 40 suites / 754 tests.

**Correctly narrowed certification statement (unchanged).** The single-process integration test proves the code and controlled single-process assumption behind §10's statement, so §10's certification stands verbatim:

> Google Classroom OAuth and course-discovery adapter activation is complete and security-certified at the code, test, emulator, and controlled single-process level. Server-side OAuth state validation and PKCE are implemented. Production activation remains blocked pending implementation and certification of durable multi-instance token and OAuth-state stores and completion of operational provisioning.

**Final Sprint 23B certification recommendation.** Approve as **provisionally certified at the controlled single-process level**. The production blocker recorded in §10, §11, and `LMS_INTEGRATION_OPERATIONS.md` §7.5 is preserved. Sprint 23C is not started; awaiting explicit authorization for the durable multi-instance OAuth-state and token-store bindings.

**Files added in the final integration verification pass.**

- `platform/functions/src/lms/connections-lifecycle-integration.test.ts`

**Files modified in the final integration verification pass.**

- `docs/platform/LMS_INTEGRATION_OPERATIONS.md` (new §7.6)
- `docs/platform/SPRINT_23B_COMPLETION_REPORT.md` (this §12)
