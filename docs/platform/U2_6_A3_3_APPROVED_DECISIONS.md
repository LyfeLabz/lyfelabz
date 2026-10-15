# U2.6 A3-3 approved decisions (replacement decision record)

Status: replacement decision record. Documentation only. No enforcement code,
client code, Functions code, Rules, indexes, deployment configuration or release
tooling is changed by this record. Teacher Units remains closed. This record
authorizes no implementation, deployment or activation.

**This is not a recovered document.** The approved A3 architectural
specification and the A3 contract completion supplement cited by
`U2_6_A3_CONTRACTS.md` were not recovered after local investigation. Their
approval provenance is unknown. This record does not reconstruct, paraphrase or
replace them. If either is recovered and conflicts with this record, the
original governs and this record must be reconciled by the human owner.

Baseline: `8ae51fe9e476503546148d4837bec3289502baf5`, tree
`efc64bee4d2fc1324a3413c91c91791dd02b4e94`.
Worktree: `/Users/breezy/Documents/GitHub/lyfelabz-a3-3-enforcement`, branch
`codex/u26-a3-3-enforcement`.

Statement classes:

- **[E] EXISTING APPROVED CONTRACT** - stated in committed A3-1/A3-2 documents
  or code at the baseline.
- **[A] APPROVED DECISION** - proposed as a new recommendation and approved by
  the human owner for this record.
- **[D] DEFERRED REQUIREMENT** - owned by a later phase.
- **[U] UNVERIFIED ASSUMPTION** - not confirmed; location searched is stated.
- **[P] RESOLVED CONFLICT** - a conflict found during finalization and then
  decided by the human owner (section 5.1).

## 1. Approval record

The human owner approved the four decisions of the proposed A3-3 replacement
decision record, subject to two refinements (Decision 2 and Decision 3). The
approval covers documentation of these decisions. It is not authorization to
implement A3-3 enforcement, deploy, or activate Teacher Units.

## 2. Source provenance and limitations

Read at the baseline:

- `docs/platform/U2_6_A3_CONTRACTS.md` and `docs/platform/U2_6_A3_2_RUNTIME_PROVENANCE.md`.
- `platform/functions/src/teacherUnits/`: `a3-contracts.ts`, `a3-protocol.ts`,
  `a3-errors.ts`, `a3-bindings.ts`, `a3-runtime-provenance.ts`,
  `a3-runtime-identity.ts` (public surface), `teacher-units-capabilities.ts` and
  its test, `teacher-units.emulator.test.ts` (setup).
- `platform/functions/src/shared/errors/https-callable.ts`,
  `platform/functions/src/shared/firestore/transaction.ts`.
- Installed `@google-cloud/firestore` `7.11.6` transaction retry logic
  (`build/src/transaction.js`, `isRetryableTransactionError`).
- `app/src/teacherUnits/backendCompatibility.ts`, `releaseAvailability.ts`,
  `saveCoordination.ts`; `app/src/firebase-config.ts`.
- `scripts/hosting-release/backend-state.cjs` (A1 `hostingCandidate`).
- `fixtures/teacher-units-a3/v1.json`, `platform/functions/package.json`,
  `platform/functions/scripts/test-capabilities-transport.cjs`,
  `scripts/ux-review/start.sh`, `platform/firebase/firebase.json`.
- `docs/platform/U2_6_A3_3_BACKEND_INVENTORY.md` (untracked in this worktree,
  investigation only; cross-referenced in section 9, not modified).

Not inspected: live production or staging, deployed Functions configuration, the
deployed Hosting bundle, any external approval system. No production data or
provider API was accessed.

## 3. Established requirements that remain unchanged [E]

- Singleton `platformConfig/teacherUnitsAvailability`, exact validation, no
  default or fallback, exact project/number/region/database binding.
- Runtime identity resolved before tenant reads; previously initialized unbound
  shared clients refuse.
- Capability schema 2, client contract `teacher-units-v2`, supported versions
  exactly `["teacher-units-v2"]`. Mutation `compatibility` envelope schema 1
  with exactly six fields.
- Compatibility excluded from create intent hashing and receipt identity; never
  persisted as replay authority. v2 create requires the original
  `expectedSchoolId`, including replay.
- Transactional, uncached authorization and availability on every management
  read/mutation, receipt replay, no-op, transaction retry and post-commit
  response read.
- Post-commit refusal becomes `responseUnavailable` with outcome unconfirmed and
  does not undo writes.
- Closed discovery remains available under canonical authentication.
- A3-2 provenance always reports `available: false` and unverified approval and
  deployment. A match is never permission.
- Synthetic signatures, hashes and author fields confer no authority; absent
  trust anchors deny availability.
- Ordinary builds are closed-only; a policy-controlled profile requires separate
  authorization.
- No activation, lease, permissive legacy contract or fallback policy.
- The twelve error names and categories in `a3-errors.ts`.
- No alternative assignment publisher; `assignments/assignments-publish.ts`
  remains canonical.

## 4. Approved decisions

### Decision 1 - Legacy protocol [A]

Legacy schema 1/v1 capability requests are rejected. There is no dual stack,
coexistence window, flag, environment switch, or legacy availability bypass.

Evidence: the only v1 client caller is constructed behind
`requireTeacherUnitsAvailable()`, which the controlled build fixes to `false`;
A1 Hosting candidates assert `teacherUnitsAvailability: 'closed'`. No released
client path reaches v1 discovery or mutations. [U] The deployed production
bundle was not inspected live.

Discovery (`teacherUnitsCapabilities`) order:

1. Resolve A3-2 runtime identity; failure: `teacherUnits.runtimeIdentityUnavailable`.
2. Canonical authentication (`assertActiveTeacher`), existing codes unchanged.
3. Non-object payload or key set not exactly `{schemaVersion, nonce,
   clientContractVersion}`: existing `teacherUnits.invalidRequest`.
4. `schemaVersion !== 2` or `clientContractVersion !== "teacher-units-v2"`
   (including the exact A2 v1 request): `teacherUnits.contractUnsupported`.
   Details: `{ code }` only.
5. Nonce grammar failure: `teacherUnits.invalidRequest`.
6. Authoritative transaction; schema 2 response only. Declarations follow [E]:
   closed with policy identity; missing policy unverified with nulls; known but
   ineligible enabled policy unverified with its identifiers,
   `deploymentEligible: false`, `acceptedClientContractVersions: []`. An invalid
   policy or read failure refuses with `policyInvalid` / `policyUnavailable`; no
   declaration is fabricated.

Mutations (create/update/archive/restore/setResources/reorder):

- `compatibility` is a required allowlisted key. Absent:
  `teacherUnits.compatibilityRequired`. Present but failing the A3-1
  `compatibilityRule` (including any schema or contract other than 1/v2):
  `teacherUnits.invalidCompatibility`. Both are decided before any transaction.
- Create with missing or malformed `expectedSchoolId`: existing
  `teacherUnits.invalidExpectedSchoolId`, before any transaction.

List/get: request shape unchanged; `compatibility` remains forbidden
(`invalidRequest`); availability is enforced transactionally.

### Decision 2 - Post-commit uncertainty [A]

"Committed" means this request's write transaction returned successfully after
writing at least one document. Replay and no-op paths do not commit in this
request; their checks run in the transaction that produces the response and
report their ordinary codes.

| Field | Value |
|---|---|
| Platform code | `teacherUnits.responseUnavailable` [E] |
| HTTPS code | `unavailable` [E] |
| `details` (exact) | `{ code: "teacherUnits.responseUnavailable", outcome: "unconfirmed", operation }`, where `operation` is one of `create`, `update`, `archive`, `restore`, `setResources`, `reorder` |
| Message | "Your change may have been saved, but it could not be confirmed. Reload your units before trying again." |
| Prohibited | unit data, unit ID, revision, policy or release identifiers, underlying reason, any `committed`, `rolledBack` or `retryAfter` field |

- Every throwable after a confirmed commit maps to this response, never to its
  original code (A3 refusals, authorization refusals, `notFound`, transient and
  unknown errors). The original code could otherwise be read as pre-commit;
  `teacherUnits.invalidRequest` is in the client's `PRE_COMMIT_REJECTION_CODES`.
- No compensating write, audit edit or receipt removal. The underlying reason is
  logged server-side only.
- The shared translator maps `teacherUnits.responseUnavailable` to `unavailable`
  explicitly (today it is unmapped and would default to `failed-precondition`).

**Approved refinement 2 (ambiguous commit failures) [A]:**

- Uncertain-outcome handling is preserved for Firestore commit failures whose
  commit status cannot be established.
- Ambiguous commit failures are never classified as confirmed pre-commit
  rejections.
- Potentially committed mutations are not automatically retried at the
  request level. Reruns performed inside the Firestore SDK are governed by the
  approved Option A in section 5.1.
- Acceptance criteria 9 and 10 require tests for this distinction.

### Decision 3 - Hosting and emulator identity [A]

The expected Hosting candidate fingerprint is the `hostingCandidateFingerprint`
of the activation approval statement, used only when the Decision 4 verifier
returns `verified` for that exact approval reference. A3-3 then passes it to the
unchanged `validateActivationBinding`. Rejected sources: request fields
(self-attested), the activation evidence's own field (circular), the Functions
build record (ordering, closed-only), environment/runtime configuration or
secrets (mutable activation switch), live Hosting observation (A3-6 scope).

Without a verified value, an enabled policy evaluates as unverified and
management operations refuse with `teacherUnits.deploymentIneligible`.

[E, from code] Every A1 Hosting candidate currently asserts `closed`; no Hosting
candidate that could enable Teacher Units can be produced today.

Emulator identity:

- The emulator profile reaches enforcement only by server-side injection into a
  handler/enforcement factory. Production exports in `index.ts` bind no profile
  and expose no parameter, environment variable or request field that supplies
  one. Cloud mode refuses explicit profiles [E, A3-2].
- `FUNCTIONS_EMULATOR=true` without an injected profile:
  `teacherUnits.runtimeIdentityUnavailable` on all nine endpoints, including
  discovery.
- Teacher Units A3 emulator identities require a `demo-` project ID;
  `lyfelabz-prod` and `lyfelabz-staging` are refused as emulator projects.
  This applies only to Teacher Units A3 enforcement, not to other callables.
- Test verifiers that return `verified` live only in test files and must be
  absent from the compiled `lib` inventory. [U] `tsconfig` exclusion of every
  test helper was not verified.

**Approved refinement 3 (emulator inventory and migration) [A]:** inventory
below. Enforcement of demo-only identities must ship together with the listed
migrations and regression tests, so no existing workflow breaks silently.

| Workflow / test | Current project and path | Effect of A3-3 | Required migration and regression |
|---|---|---|---|
| `platform/functions` `npm run test:emulator` (incl. `teacher-units.emulator.test.ts`) | `demo-bootstrap`, Firestore emulator only; handlers imported directly; already refuses non-`demo-` projects | Handlers need an identity and verifier | Construct handlers through the test factory with an injected `demo-bootstrap` profile and injected verifiers. Add cases: no profile refuses; unconfigured verifier refuses every management operation; injected `verified` path exercises replay, no-op, retry and post-commit. |
| `platform/functions/scripts/test-capabilities-transport.cjs` | `demo-bootstrap`, real Auth/Functions/Firestore emulators, compiled production `teacherUnitsCapabilities` export, v1 request | v1 rejected by design; production export has no profile | Assert `contractUnsupported` for the v1 request and `runtimeIdentityUnavailable` through the production export. Any positive v2 transport test uses a fixture-only handler built by the factory with an injected `demo-` profile. |
| `teacher-units-capabilities.test.ts` | Mocks `lyfelabz-prod`; expects schema 1/v1 response; accepts `demo-bootstrap` emulator | Expectations obsolete | Rewrite for schema 2 declarations, legacy rejection, demo-only emulator, and refusal of `lyfelabz-prod`/`lyfelabz-staging` as emulator projects. |
| `scripts/ux-review/start.sh` | `emulators:start --project lyfelabz-prod`, includes Functions; client `EMULATOR_CONFIG.projectId` is `lyfelabz-prod` | All Teacher Units endpoints refuse `runtimeIdentityUnavailable`; other callables unaffected | No script change in A3-3. Document the expected refusal. Teacher Units UI is already closed by the build gate. [U] Not verified that no UX-review flow calls Teacher Units endpoints. |
| A3-1/A3-2 tests and fixtures | `demo-a3-test` | Already compliant | Keep passing unchanged. |
| App `backendCompatibility` tests and client emulator mapping to `lyfelabz-prod` | Client v1 module | Not changed in A3-3 | A3-4 migration (section 7). |

Regression test required: production exports cannot accept an injected emulator
profile (no exported callable takes or reads one; the cloud path refuses an
explicit profile).

### Decision 4 - Release authority [A]

```ts
type ReleaseAuthorityInput = Readonly<{
  identity: RuntimeIdentity; endpointName: EndpointName;
  policy: TeacherUnitsAvailabilityPolicyV1;            // validated, read in this transaction
  releaseRef: string; release: BackendReleaseDocumentV1;
  deploymentApprovalRef: string; deploymentApproval: DeploymentApprovalDocumentV1;
  activationEvidenceRef: string; activationEvidence: ActivationEvidenceDocumentV1;
  activationApprovalRef: string; activationApproval: ActivationApprovalDocumentV1;
  readEvidence: (ref: string) => Promise<unknown>;     // A3-3-supplied, same transaction,
}>;                                                    // content-address-validated, two collections only
type ReleaseAuthorityVerdict =
  | Readonly<{ verdict: "verified"; releaseId: string; deploymentApprovalRef: string;
      activationEvidenceRef: string; activationApprovalRef: string; certificationEvidenceRef: string;
      hostingCandidateFingerprint: string; policyInstanceId: string; enabledGeneration: number }>
  | Readonly<{ verdict: "unverified"; reason: "verifierUnconfigured" | "signatureUnverified" |
      "authorityUnrecognized" | "dispositionUnresolved" | "revoked" | "certificationUnverified" |
      "providerEligibilityUnverified" | "inputMismatch" | "error" }>;
interface ReleaseAuthorityVerifier { verify(input: ReleaseAuthorityInput): Promise<ReleaseAuthorityVerdict>; }
```

- The verifier performs no I/O except `readEvidence`, which is limited to
  `teacherUnitsBackendReleases/` and `teacherUnitsReleaseEvidence/` inside the
  current transaction. It is re-run on every attempt; nothing is cached.
- Availability is true only when all hold: policy mode `enabled`; every A3-1
  binding validator passes; A3-2 `runtimeConsistency === "matched"`; verdict
  `verified`; every verdict field equals the value A3-3 computes independently.
- A3-2 artifact integrity and A3-3 authorization remain distinct. A3-3 does not
  read, reinterpret or override A3-2's constant `available: false`; "matched"
  is one necessary input, never permission.
- Any exception, non-plain or unknown shape, extra field or mismatch is
  unverified.
- The only production-wired implementation is `UNCONFIGURED`, which always
  returns `{ verdict: "unverified", reason: "verifierUnconfigured" }`. There is
  no runtime selection mechanism. Teacher Units therefore remains unavailable.
- A3-3 introduces no operational approval authority, trust anchor, signer key,
  revocation resolver, provider observer or certification source.

## 5. Contract consistency results

Checked against A3-1/A3-2 documents and code at the baseline.

| Item | Result |
|---|---|
| All codes used exist in `a3-errors.ts` or are existing Teacher Units codes (`invalidRequest`, `invalidExpectedSchoolId`) | Consistent; no new code |
| Categories: `contractUnsupported`, `compatibilityRequired`, `policy*`, `availabilityClosed`, `deploymentIneligible`, `policyChanged`, `placementMismatch` failed-precondition; `invalidCompatibility` invalid-argument; `policyUnavailable`, `runtimeIdentityUnavailable`, `responseUnavailable` unavailable | Consistent with `a3-errors.ts`. The shared translator currently maps none of them except by default (`failed-precondition`); explicit mappings are required (criterion 11) |
| Refusal precedence (criterion 6) | No conflict; A3-1 defines no precedence |
| Discovery declarations | Consistent with `validateCapabilityResponse` closed/unverified/enabled rules |
| Invalid policy refuses discovery instead of declaring | Consistent; A3-1 defines no declaration for invalid policy |
| Emulator without injected profile refuses discovery | Consistent with A3-1/A3-2 (no default emulator project; explicit profile required). "Closed discovery remains available" is preserved for resolvable identities |
| Demo-only emulator projects | Additional restriction on the A3-1 explicit emulator identity; does not weaken it |
| Hosting fingerprint source | Consistent with `validateActivationBinding` taking a supplied expectation |
| Verifier combination rule | Consistent with A3-2 `available: false` semantics |
| Compatibility outside intent hash and receipt | Unchanged |

### 5.1 Resolved conflict: Firestore SDK automatic transaction retry [P]

Evidence: `runFirestoreTransaction` calls `firestore.runTransaction(fn)` with
SDK defaults. Installed `@google-cloud/firestore` `7.11.6`
(`isRetryableTransactionError`) re-executes the whole transaction callback after
commit errors with codes ABORTED, CANCELLED, UNKNOWN, DEADLINE_EXCEEDED,
INTERNAL, UNAVAILABLE, UNAUTHENTICATED and RESOURCE_EXHAUSTED. Several of these
can follow a commit whose outcome is unknown. A previous attempt may therefore
have committed before the SDK reruns the callback.

Two consequences:

1. Refinement 2 says potentially committed mutations are not automatically
   retried. The canonical transaction helper already does this inside the SDK
   for every Teacher Units mutation. Existing idempotence (create receipts;
   equal-change no-ops before revision comparison; already-archived/active and
   already-ordered no-ops) makes most reruns converge, but this has not been
   certified for every operation. [U]
2. A rerun that refuses inside the transaction (for example `availabilityClosed`
   after a policy change, an authorization refusal, `writeConflict`, or a
   revision conflict) reports an ordinary code although an earlier attempt may
   have committed. **Correction to the proposed record:** its A3-4 note that an
   in-transaction refusal on a first dispatch may be treated as a confirmed
   pre-commit rejection is withdrawn. Only refusals decided before any
   transaction starts are proof of no commit.

**Human owner decision: Option A approved.** SDK-internal reruns are kept.
Option B is recorded only as the rejected alternative. Options considered:

- **Option A (APPROVED):** keep SDK reruns as established platform behavior,
  treated as re-execution of the same idempotent intent under full
  revalidation, not as a new client attempt. Require: (a) tests proving every
  mutation's rerun after a committed first attempt converges to replay or no-op
  with no second write or audit; (b) every in-transaction refusal is documented
  as not proof of no commit, and A3-4 classifies it as unresolved; (c) only
  pre-transaction validation codes are confirmed pre-commit rejections.
- **Option B (rejected):** configure Teacher Units mutation transactions with
  `maxAttempts: 1`. No hidden reruns, but every contention abort surfaces as
  `writeConflict` and every ambiguous commit error as an uncertain failure. This
  changes established contention behavior and transaction helper usage.

## 6. A3-3 implementation acceptance criteria [A]

Criteria 9 and 10 implement the approved section 5.1 Option A.

1. All nine endpoints resolve A3-2 runtime identity before any tenant read,
   using the same verified shared client.
2. Discovery behaves exactly as in Decision 1 and never emits schema 1; the
   exact A2 v1 request returns `contractUnsupported`.
3. Discovery declarations and refusals follow Decision 1 step 6.
4. Mutations enforce `compatibilityRequired` / `invalidCompatibility` before any
   transaction; v2 create requires `expectedSchoolId` on first attempt and
   replay.
5. Every authoritative transaction performs, in order: user/school
   reauthorization; uncached policy read; release and evidence reads;
   availability computation; envelope binding; only then receipt, replay, no-op
   or unit decisions.
6. Refusal precedence: `runtimeIdentityUnavailable`, `policyUnavailable`,
   `policyMissing`, `policyInvalid`, `availabilityClosed`,
   `deploymentIneligible`, `policyChanged`, `placementMismatch`.
7. Replay, no-op and every SDK transaction rerun repeat all checks; a concurrent
   policy change causes a rerun or refusal, never a write against a stale policy.
8. Create intent hash and receipt identity bytes are unchanged against existing
   vectors with and without a compatibility envelope.
9. Post-commit: tests inject each failure source after a confirmed commit
   (A3 refusal, authorization refusal, `notFound`, transient, unknown) and
   assert the exact Decision 2 response and that unit, receipt and audit
   persist unchanged.
10. Ambiguous commit: tests simulate a commit error whose outcome is unknown,
    both where the write did and did not land, and assert: the response is never
    a pre-transaction validation code or any code in the client
    `PRE_COMMIT_REJECTION_CODES`; no second write or audit occurs; the server
    issues no new request-level retry; and, per Option A, every mutation's SDK
    rerun after a committed first attempt converges to replay or no-op with no
    second write or audit, and every in-transaction refusal is documented and
    tested as not proof of no commit.
11. Shared translator maps all twelve A3 codes exactly as `a3-errors.ts`, with
    tests.
12. `UNCONFIGURED` is the only production verifier. A test proves list, get and
    every mutation refuse under production wiring in cloud and emulator modes,
    even with a structurally perfect enabled policy and synthetic signatures.
13. Emulator: Decision 3 behavior, every migration and regression in the
    refinement 3 table, the production-export regression, and a check that the
    compiled `lib` contains no test verifier or injected profile.
14. Canonical vectors, A3-1/A3-2 suites and existing Teacher Units suites pass;
    Functions `test`, `typecheck`, `lint`, `build`, and `test:emulator` pass.
15. No change to Rules, indexes, Hosting, client gate, client code, publisher,
    dependencies or deployment configuration; no policy or evidence writes.

## 7. Deferred responsibilities [D]

- **A3-4 (client):** v2 discovery and compatibility envelope; fresh discovery
  per mutation attempt; no automatic resend on policy change; classify
  `responseUnavailable` and every in-transaction refusal as unresolved; only
  pre-transaction validation codes are confirmed pre-commit rejections; keep
  `responseUnavailable` out of `compatibilityBlocked`; replace the client
  emulator mapping to `lyfelabz-prod` for Teacher Units; migrate
  `backendCompatibility` tests.
- **A3-5:** callable-only Firestore Rules for Teacher Units collections.
- **A3-6:** trust anchors and signer verification, authority registry,
  statement-object retrieval, revocation and disposition resolution,
  certification source, provider normalization and eligibility observation,
  IAM/route review, create-only evidence registration, policy history and
  compare-and-set, shutdown and rollback, the enabled Hosting candidate format,
  and any Rules/index a disposition lookup would need (which requires explicit
  approval). Replacing `UNCONFIGURED` requires A3-6, independent certification
  and separate human authorization; it is still not activation.
- **A3-7:** integrated security certification, including the verifier.

## 8. No authorization for activation or deployment

This record authorizes no implementation, deployment, policy write, evidence
write or activation in any environment. Each requires separate explicit human
authorization.

## 9. Cross-reference: A3-3 backend inventory

`docs/platform/U2_6_A3_3_BACKEND_INVENTORY.md` remains unmodified. Its endpoint
inventory, transaction boundaries and the four contract differences it reported
are resolved as follows: difference 1 by Decision 1; difference 2 by Decision 1
and criterion 4; difference 3 by Decision 2 and the translator criterion;
difference 4 by criterion 1. Its statement that the approved design documents
were not found remains accurate; this record does not supply them. No factual
correction to that report is required.

## 10. Remaining risks and assumptions

- [U] Deployed bundle and Functions match the source read here.
- [U] `tsconfig`/build exclusion of every test helper from `lib`.
- [U] No UX-review flow exercises Teacher Units endpoints.
- [U] Every mutation's SDK rerun converges after a committed attempt (section 5.1).
- A3-2 artifact inspection on every request inside rerun transactions has an
  unmeasured latency cost.
- A future revocation lookup may need an index (Rules/index change).
- Approval provenance of the original specification is unknown.
