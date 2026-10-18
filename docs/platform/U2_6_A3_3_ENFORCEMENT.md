# U2.6 A3-3 transactional backend enforcement

Status: implemented, uncommitted, awaiting independent certification. Teacher
Units remains closed: production wiring uses the UNCONFIGURED release-authority
verifier, so every management read and mutation is refused. No deployment,
activation, policy write or evidence write occurred.

Authority: `U2_6_A3_3_APPROVED_DECISIONS.md` (human-approved replacement decision
record, including Option A in section 5.1), `U2_6_A3_CONTRACTS.md`,
`U2_6_A3_2_RUNTIME_PROVENANCE.md`. Investigation baseline:
`U2_6_A3_3_BACKEND_INVENTORY.md` (unmodified).

Baseline: `8ae51fe9e476503546148d4837bec3289502baf5`, tree
`efc64bee4d2fc1324a3413c91c91791dd02b4e94`. Worktree
`/Users/breezy/Documents/GitHub/lyfelabz-a3-3-enforcement`, branch
`codex/u26-a3-3-enforcement`.

## Architecture

- `a3-release-authority.ts`: the approved `ReleaseAuthorityVerifier` interface,
  strict verdict parsing (any non-plain, partial, extra-field or unknown verdict is
  `unverified/error`; each property is read once into a new frozen snapshot, which is
  the only value validated and returned) and `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`, which always
  returns `unverified/verifierUnconfigured`. No trust anchor, signer, revocation,
  certification or provider observation exists here.
- `a3-enforcement.ts`: `PRODUCTION_TEACHER_UNITS_ENFORCEMENT` (frozen; A3-2
  resolver with no profile, A3-2 provenance, UNCONFIGURED verifier), runtime
  identity acceptance, transactional availability evaluation, envelope binding,
  discovery declarations, pre-transaction envelope parsing and the post-commit
  `responseUnavailable` wrapper.
- Every handler is built by a factory `createTeacherUnits<Op>Handler(enforcement)`.
  Exported callables bind only the production enforcement. Other wiring exists
  only in tests and in the disposable transport fixture.

Request order on all nine endpoints: A3-2 runtime identity (before any tenant
read), canonical authentication, request validation (mutations: envelope, then
fields; create requires `expectedSchoolId`), then one authoritative transaction.

Each authoritative transaction attempt (`authorizeTeacherUnitsTransaction`):
identity still current, canonical user/school reauthorization, uncached read and
strict validation of `platformConfig/teacherUnitsAvailability`, release and
evidence reads at their content addresses, A3-1 deployment binding, A3-2
provenance (`runtimeConsistency === "matched"` for this endpoint and release),
release-authority verdict cross-checked field by field, A3-1 activation binding
with the expected Hosting fingerprint taken only from the verified verdict, then
(mutations) envelope binding. Only then are receipts, replays, no-ops and writes
evaluated. Nothing positive is cached. A3-2's constant `available: false` is not
read as a gate and not overridden.

Emulator identities must use a `demo-` project, the `explicit-local-profile`
source and project number `0`; production and staging IDs are refused as emulator
identities. Cloud identities are pinned to `lyfelabz-prod` / `lyfelabz-staging`.

## Error contract

| Condition | Code |
|---|---|
| Identity unresolved, unaccepted or stale | `runtimeIdentityUnavailable` |
| Non-retryable policy/evidence read failure | `policyUnavailable` |
| No policy document | `policyMissing` |
| Policy fails A3-1 validation for this identity | `policyInvalid` |
| Closed policy | `availabilityClosed` |
| Enabled but any release, evidence, provenance, verdict or binding check fails | `deploymentIneligible` |
| Envelope instance, generation or release differs from policy | `policyChanged` |
| Envelope placement differs | `placementMismatch` |
| Missing envelope (pre-transaction) | `compatibilityRequired` |
| Malformed envelope (pre-transaction) | `invalidCompatibility` |
| Legacy discovery request | `contractUnsupported` |
| Any failure after a confirmed commit | `responseUnavailable`, details `{ outcome: "unconfirmed", operation }` |

The shared translator maps all twelve A3 codes exactly as `a3-errors.ts`, checked
first so no suffix rule can reclassify them. Client-facing messages carry no
evidence; the underlying cause stays server-side.

Discovery: schema 2 only. Closed, missing and enabled-but-unverified policies are
declared per A3-1; invalid or unreadable policies refuse. The server validates its
own response with `validateCapabilityResponse` before returning it.

## SDK reruns and uncertain outcomes (Option A)

Firestore SDK reruns re-execute the whole authoritative prefix. After a commit
that landed but was not acknowledged, a rerun converges: create replays its
receipt, update/archive/restore/setResources/reorder resolve as no-ops; no second
write or audit occurs. A refusal raised inside a transaction is never treated as
proof that nothing was written; only pre-transaction refusals are. The handlers
issue no request-level resubmission. The existing create `ALREADY_EXISTS` loop is
retained: that error is a definite precondition failure of an uncommitted
transaction. Retryable read errors propagate unchanged so the SDK can rerun: exactly the
installed SDK 7.11.6 `isRetryableTransactionError` set, including INVALID_ARGUMENT
only for an expired transaction (parity-tested against the installed source).
Reruns stay bounded by the SDK's own `maxAttempts`.

Verifier boundary (A3-6 O6). The release-authority verifier's `readEvidence` reads
through the same transactional read helper, so its failures are classified exactly as
above. An exception from the verifier propagates only when it is the exact error
object that A3-3's own `readEvidence` raised during the current attempt and that
object is SDK-retryable or a `policyUnavailable` refusal; the SDK then reruns, or the
request refuses `policyUnavailable`. Matching is by object identity, never by code,
name, message or shape: an error the verifier creates itself, or one it substitutes
after catching a read failure, is unverified `error` and refuses
`deploymentIneligible`. The record of raised errors is created fresh in every
attempt, and nothing read is cached across attempts. Under the production
`UNCONFIGURED` verifier, which never reads or throws, behavior is unchanged.

## Emulator compatibility

- `npm run test:emulator`: migrated. The real A3-2 resolver binds the shared client
  to an injected `demo-bootstrap` profile before first use; policy and evidence are
  real Firestore documents. Provenance and verdict are test-only injections
  (compiled-artifact provenance cannot match under ts-jest; A3-6 does not exist).
- `test-capabilities-transport.cjs`: migrated to refusal assertions. firebase-tools
  15.22.4 sets `K_SERVICE` and `K_REVISION` in the Functions emulator, and the
  committed A3-2 resolver refuses those labels in emulator mode, so no Teacher
  Units endpoint (production export or factory fixture with an injected profile)
  can resolve identity under the real Functions emulator. A3-2 was not changed.
  Positive discovery is proven by the Firestore-emulator suite.
- `scripts/ux-review/start.sh` (`--project lyfelabz-prod`): unchanged. Teacher Units
  endpoints refuse `runtimeIdentityUnavailable` there; other callables are
  unaffected; the client release gate is already closed.
- Test-only support lives in `a3-test-support.test.ts`; `*.test.ts` is excluded by
  `tsconfig.build.json`, and the compiled `lib` was checked for test helpers.

## Deferred

A3-4 client migration (v2 discovery and envelope, unresolved classification of
in-transaction refusals and `responseUnavailable`, emulator project mapping), A3-5
callable-only Rules, A3-6 trust anchors and verifier, evidence registration,
policy CAS, enabled Hosting candidate format, and A3-7 integrated certification.
Historical finding: at implementation time `docs/platform/TEACHER_UNITS.md` still
described the pre-A3 optional `expectedSchoolId`. Independent certification ranked
this P2; remediation has since updated that document to the A3-3 contract
(required `expectedSchoolId`, `compatibility` envelope, schema 2 discovery, A3
codes, refusal uncertainty). Recertification of that remediation is pending.
