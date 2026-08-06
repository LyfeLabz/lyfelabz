# Sprint 25 Phase 2 Completion Report

**Date:** 2026-08-06
**Phase:** Sprint 25 Phase 2 - Incremental Consent and Scope Widening
**Status:** Complete (pre-commit review applied; not staged, not committed)

Style: no em dashes. Use " - " (spaced hyphen).

> **Pre-commit review note (2026-08-06).** This report is written as part of
> the final pre-commit implementation, security, and certification review of
> Phase 2. The review verified the code independently of the passing tests,
> corrected one genuine implementation defect (silent capability downgrade in
> `lmsConnectionsBegin`), and added the widening-failure and
> provider-revocation regression tests the review scope requires. Where this
> report and the implementation plan differ, the frozen plan governs the
> architecture; this report records only what was implemented and verified.

---

## 1. Implementation summary

Phase 2 extends the certified OAuth connection lifecycle so a teacher can
grant the Google Classroom coursework publication scopes through incremental
consent, at first publish, without minting a second connection and without
disturbing the certified readonly connection. It adds no new callable, no new
collection, and no Firestore Rules change. Every change is additive.

The mechanism has four moving parts:

1. A provider-neutral `capability` selector on `lmsConnectionsBegin`.
2. An additive, provider-neutral `intent` binding on the OAuth state record
   (both the in-process and the Firestore-backed store).
3. Scope-set selection in the Google Classroom adapter's `beginOAuth` driven
   by that intent.
4. An intent-aware create / widen / already-authorized / refuse decision in
   `lmsConnectionsComplete`, with identity revalidation, refresh-token
   carry-forward, an atomic tokenRef swap, and local-only old-bundle cleanup
   (never a Google grant revocation).

---

## 2. Files changed

Server (Cloud Functions):

- `platform/functions/src/lms/connections-begin.ts` - accept optional
  `capability: "publication"`; **reject any other non-empty value with a
  sanitized `lms.invalidCapability` error** (review correction, see §4);
  thread the derived `intent` into `adapter.beginOAuth`.
- `platform/functions/src/lms/connections-complete.ts` - intent-aware
  create / widen / already-authorized / refuse; identity revalidation against
  the existing token bundle; scope-union merge; refresh-token carry-forward;
  atomic tokenRef swap; local-only old-bundle cleanup; additive
  `consentOutcome` discriminator and `scopesUpdatedAt` timestamp.
- `platform/functions/src/lms/providers/provider.ts` - additive optional
  `intent?: LmsOAuthStateIntent` on the vendor-neutral `beginOAuth` input.
- `platform/functions/src/lms/providers/google-classroom/adapter.ts` -
  `beginOAuth` selects the initial scope set, or the initial set unioned with
  `GOOGLE_CLASSROOM_PUBLICATION_SCOPES`, from `intent`.
- `platform/functions/src/lms/oauth-state/state-store.ts` - additive
  `intent` on the issue input, stored record, and `LmsOAuthStateBinding`;
  optional `expectedIntent` on `consume` (defense in depth); `intentMismatch`
  error code.
- `platform/functions/src/lms/oauth-state/firestore-state-store.ts` - mirror
  the additive `intent` field in the durable store.
- `platform/functions/src/shared/types/lms.ts` - additive optional
  `scopesUpdatedAt?: Timestamp` on `LmsConnectionRecord`.

Client (thin wiring, inert until Phase 3):

- `app/src/settings/integrations/types.ts` - additive `capability?:
  "publication"` on `beginConnection`; additive `consentOutcome?` on the
  complete result.
- `app/src/settings/integrations/wire.ts` - pass `capability` through to
  `lmsConnectionsBegin`; parse and narrow `consentOutcome` from the complete
  response.

Tests (added / extended):

- `platform/functions/src/lms/connections-complete-oauth-state.test.ts`
- `platform/functions/src/lms/connections-lifecycle-integration.test.ts`
- `platform/functions/src/lms/oauth-state/state-store.test.ts`
- `platform/functions/src/lms/oauth-state/firestore-state-store.test.ts`
- `platform/functions/src/lms/providers/google-classroom/adapter-pkce.test.ts`

---

## 3. Request / response contracts

`lmsConnectionsBegin` request (additive field):

```
{ providerId: string, redirectUri: string, capability?: "publication" }
```

- `capability` omitted: initial (readonly) scope set. Byte-identical to the
  pre-Phase-2 flow.
- `capability: "publication"`: initial scopes unioned with the publication
  scopes.
- Any other value: refused with `lms.invalidCapability` (invalid argument).
  The raw value is never echoed in the error message.

`lmsConnectionsComplete` response (additive discriminator):

```
{ connectionId, providerId, alreadyConnected, consentOutcome? }
consentOutcome in { "created", "widened", "alreadyAuthorized" }
```

- `created`: a new connection document was written (first connection).
- `widened`: an existing active connection's scope set was widened.
- `alreadyAuthorized`: the new grant added no scopes; nothing was written.
- absent: the non-publication idempotent early return (`alreadyConnected:
  true`, no state consumed).

No token, Google email, Google account id, PKCE verifier, or raw upstream
scope string crosses the callable boundary in any branch.

---

## 4. Review correction applied: capability validation

**Defect.** `lmsConnectionsBegin` derived intent with
`payload.capability === "publication" ? "publication" : "initialConnect"`,
which silently downgraded **any** unrecognized capability value (a typo, a
future capability the server does not implement, or a tampered request) to an
initial connection. The review contract requires: capability omitted =>
initial connection; `capability: "publication"` => publication consent; any
other runtime value => sanitized invalid-argument failure. The silent
downgrade violated that contract and could mask a publication-scope consent
request as a readonly connect.

**Fix.** `lmsConnectionsBegin` now rejects any present-but-unrecognized
`capability` with `lms.invalidCapability` before issuing state, and the
request type is tightened from `capability?: string` to `capability?:
"publication"`. The raw value is not echoed. This is a bounded input-validation
tightening consistent with the sanitized-error posture; it changes no
architecture and expands no scope (Sprint 25's only selector is
"publication").

**Tests added.** Omitted capability requests only readonly scopes; an
unrecognized value rejects with `lms.invalidCapability` and issues no state;
the error message does not echo the raw value.

---

## 5. Identity revalidation

On the widening path, before any write:

1. The existing connection's `tokenRef` is resolved through the server-only
   token store. If resolution fails, widening is refused with the sanitized
   `lms.connectionTokenResolutionFailed`; the existing connection is untouched.
2. The resolved bundle's `upstreamAccountIdentifier` is compared against the
   new OAuth grant's `upstreamAccountIdentifier`.
3. A mismatch is refused with the distinct plain-language `lms.identityMismatch`
   (not coerced to `lms.invalidOAuthState`); the existing connection and its
   old token bundle are left intact and no new token is stored.

`upstreamAccountIdentifier` is a required `string` on both the token bundle
and the grant, so the type system precludes an absent identifier. If a
corrupted bundle were to surface a differing or absent identifier, the strict
`!==` comparison fails closed (refuses widening) whenever the new grant's
identifier is a real value, which it always is for a live Google profile.

---

## 6. Scope widening

- The adapter requests only the two coursework scopes in addition to the two
  readonly scopes; `include_granted_scopes=true` preserves previously granted
  readonly scopes.
- Granted scopes are read **only** from Google's token exchange response
  (`exchange.scope`), never from the requested scope set.
- The merged scope set is the stable sorted set-union of the existing bundle's
  scopes and the newly granted scopes.
- If the merge equals the existing set (the grant added nothing), the callable
  returns `alreadyAuthorized` and writes nothing. See §10 limitation 1 for why
  the completion callable cannot itself assert that the specific publication
  scopes are present without violating provider neutrality; the subsequent
  publish re-issue re-detects `lms.insufficientScope`.

---

## 7. Token lifecycle

The token store mints a fresh opaque `tokenRef` on `store()` and exposes no
in-place update, so widening composes a merged bundle and swaps the reference:

- `accessToken`: the fresh grant's.
- `refreshToken`: the fresh grant's if Google returned one, else the existing
  refresh token is carried forward (Google routinely omits `refresh_token` on
  incremental re-consent; it is never dropped).
- `scopes`: the merged sorted union.
- `expiresAtEpochMs`: derived from the fresh grant's `expiresInSeconds`.
- `upstreamAccountIdentifier`: unchanged.

No token reaches the client in any branch.

---

## 8. Rollback / atomicity guarantees

Widening write order and per-step guarantee:

1. Resolve the old bundle (read only).
2. Revalidate identity (no write).
3. Compose the merged bundle.
4. `store()` the merged bundle -> new `tokenRef`. **If this throws, the
   connection is never updated and still points at the old valid `tokenRef`;
   no cleanup runs.**
5. `update()` the connection document (`scopes`, `tokenRef`, `scopesUpdatedAt`).
   **If this throws, the new bundle is orphaned and inert, the connection still
   points at the old valid `tokenRef`, and cleanup does not run.**
6. Best-effort local `revoke()` of the old `tokenRef`. **If this throws, the
   widen still succeeds; the orphaned old bundle is inert.**

The existing connection remains usable whenever widening fails at any step
before the connection update commits.

---

## 9. Local cleanup vs provider revocation (critical)

A successful widening performs **only** a local token-store delete of the
superseded bundle (`getLmsTokenStore().revoke(oldTokenRef)`). It **never**
calls `adapter.revokeGrant()`, Google's OAuth grant-revocation endpoint, or
any Google revoke path, because the widened connection continues to use the
same underlying Google grant; revoking it would break the connection.

Regression test added: on a successful widening, `adapter.revokeGrant` is
asserted **not** called, and the local token-store `revoke` is asserted called
exactly once with the old `tokenRef`.

---

## 10. Known limitations

1. **`alreadyAuthorized` does not prove the publication scopes are present.**
   The completion callable is vendor-neutral and cannot name Google's
   publication scopes without violating provider neutrality (PDR-019h). If a
   teacher denies the coursework scopes, the grant returns the previously held
   scopes, the merge is unchanged, and the callable returns `alreadyAuthorized`
   while writing nothing. This is the frozen plan's behavior (§R7): the
   subsequent publish re-issue re-detects `lms.insufficientScope` and the
   client surfaces "consent did not add the required scope." No incorrect
   durable state results.
2. **Non-active existing connection under publication intent.** If the existing
   connection is `revoked`/`stale` at consent time, `hasActiveConnection` is
   false and the flow falls through to the new-connection path, recreating an
   active connection with the granted scopes. In the normal flow this path is
   not reached, because publish requires an active connection and routes a
   non-active connection to the account-level reconnect flow before any
   publication-intent consent runs. The recreated connection is keyed on the
   same deterministic id, so no duplicate is possible.
3. **Concurrency guarantee is bounded.** Two simultaneous completions for the
   same teacher/provider cannot both widen: `begin` invalidates prior pending
   state and `consume` is single-use and atomic, so at most one completion
   consumes the state; the loser coerces to `lms.invalidOAuthState`. The
   widening read-then-update is not itself transactional, which is acceptable
   because state single-use serializes the flow upstream.
4. **In-process stores.** The default in-process token and OAuth-state stores
   remain the certified-environment bindings; durable production bindings are
   an operational prerequisite tracked separately, unchanged by Phase 2.

---

## 11. Exact commands run (platform/functions)

```
npx jest src/lms/connections-complete-oauth-state.test.ts   -> 20 passed
npx jest src/lms/connections-lifecycle-integration.test.ts  -> all passed
npx jest src/lms/oauth-state                                 -> all passed
npx jest src/lms/providers/google-classroom/adapter-pkce.test.ts -> all passed
npx jest                     -> 79 suites, 1487 tests, all pass; exit 0
npm run typecheck            -> clean (exit 0)
npm run lint                 -> clean (exit 0)
npm run build                -> clean (exit 0)
```

## 12. Exact commands run (app)

```
npm run typecheck            -> clean (exit 0)
npm run lint                 -> clean (exit 0)
npx jest src/settings/integrations -> 2 suites, 8 tests, all pass
npm run lessons:verify       -> OK (exit 0)
npm run curriculum:verify    -> DRIFT (pre-existing; see below)
```

**Curriculum verification (reported separately as known pre-existing drift).**
`curriculum:verify` reports that root `index.html` and
`src/curriculum/curriculum.manifest.json` disagree. Both files are **unmodified
versus HEAD**, so the drift exists on the committed baseline and is entirely
independent of Sprint 25 Phase 2, which changed zero curriculum files. This is
the same drift documented in the Phase 1 completion report.

---

## 13. Test counts

- Functions full suite: 79 suites, 1487 tests, all pass.
- New / extended Phase 2 tests include: capability scope selection and intent
  binding (adapter-pkce, both state stores), intent default and mismatch
  (both state stores, `expectedIntent` on consume), created / widened /
  alreadyAuthorized / identity-mismatch / refresh carry-forward and
  replacement (connections-complete), capability omitted / invalid / no-echo
  (integration), and the widening-failure regressions added by this review:
  token-bundle-resolution failure, `store()` failure, connection `update()`
  failure, best-effort cleanup failure, and provider-revoke-never-called.

---

## 14. Deferred browser certification

Genuine browser certification (blueprint §13, decisive observations B6 and B8)
and emulator-bound backend verification (blueprint §14) are Phase 4
obligations. They are **not** performed or claimed here. Phase 2 is proven only
by engineering validation (unit and integration tests). No test-double behavior
is presented as production certification, and no claim is made that Google
OAuth verification is complete or that production rollout is authorized.

*End of report.*
