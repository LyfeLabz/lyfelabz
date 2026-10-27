# My Units Operation 2B: Option B implementation blueprint

## E2 active implementation supersession, October 27, 2026

E2 implements the E1 Phase 1 decision. For the active release, use the [E2 workflow](U2_6_RELEASE_READINESS_RUNBOOK.md#e2-simplified-release-and-operator-workflow) and schema-2 deployment observations/receipts. The historical B1/B2/B6 requirements below for the unconditional real-enable interlock, strict provider-shape/configuration digest approval, registry/provenance/checkpoint qualification and repeated independent qualification cycles no longer prescribe the active launch path. Schema-1 inspection stays isolated for retained evidence.

All application invariants remain: canonical transactional teacher authorization and tenant isolation, strict schema-2 policy/v3 compatibility, actual artifact/build/placement agreement, default closure, CAS, atomic audit, uncertainty and independent disablement. E2 adds no runtime fallback. Reviewed required settings replace full provider metadata equality; desired-image tags and omitted Run executionEnvironment do not block managed Functions GEN2 deployments. Runtime build hashing is unchanged.

Rules schema-2 evidence removes release SHA/build/Hosting/placement coupling while retaining actual local/deployed source bytes, exact observed ruleset/hash and the complete denial/equivalence matrix. Unchanged tested Rules can be reused across releases. No Rules source/deploy is performed. A compatible retained closed-only archive and paired Hosting rollback references are required for activation. Close first if possible; closed-only recovery also refuses an enabled policy.

Legacy staging marker closure is a prerequisite of E3, before any staging endpoint replacement; E2 does not perform it. Finish local focused tests and inspect the coherent diff, then proceed to separately authorized E3 staging preparation/closed rollout. Do not start another broad audit or provenance experiment.


Date: October 25, 2026 (America/New_York).

Status: **B1a-B1g locally implemented; B1h canonical documentation/handoff completed October 26, 2026, pending separately authorized independent B2 review**. All work remains uncommitted at `main` / `1b1089797b57bbc43b6fb8423dbcc61baeb2b4a6`. The owner accepts appropriately authorized database/deployment operators as part of the trust boundary. Local implementation/testing is not real-world IAM verification, staging certification, release approval or activation. Default builds remain closed; real-project enable is explicitly interlocked.

Companion decision: [adopted Option B ADR](ADR_MY_UNITS_OPTION_B_TRUSTED_OPERATOR_AVAILABILITY.md). Current domain and operator guidance: [Teacher Units](TEACHER_UNITS.md) and [release runbook](U2_6_RELEASE_READINESS_RUNBOOK.md#current-option-b-operator-and-release-workflow). The original Operation 2B/2C planning facts and historical evidence below retain their dates/scope. Current implementation, evidence limits and review questions are consolidated in the [B1h handoff](#b1h-integrated-review-handoff); this is preparation for one review, not that independent review.

## A. Executive recommendation

Replace the cryptographic release-authority graph with one server-only availability policy and a small operator CAS tool. Keep the existing callable/domain architecture, transactional authorization, compatibility negotiation, resource-placement agreement, create receipts, revision checks, application audits, and uncertainty handling.

Deploy all nine callables from one clean release build while availability is closed. Verify Functions, both Hosting sites, Rules behavior, effective IAM and routing. Enable only through a separately authorized audited transition after acceptance. Close server availability first on failure; restore compatible Functions and the recorded Hosting pair afterward.

Do not wire a verifier that always returns success. Remove the release-verifier dependency from the new execution path coherently. Do not provision signing keys, a key project, evidence buckets, or a verifier service for this feature. Ordinary release evidence remains necessary; requests do not fetch certification objects.

The sequence has five release gates: local replacement, independent security review, staging deployment/acceptance, production preparation/closed deployment, and final activation. B1 is a local phase divided into eight bounded batches, B1a-B1h, in J; it is not one implementation authorization or eight new certification gates. Material IAM findings or implementation defects may add remediation. Each external operation needs its own explicit authorization.

## B. Baseline, evidence and limits

### Historical Operation 2B baseline and Operation 2C starting state

- Checkout: `/Users/breezy/Documents/GitHub/lyfelabz`.
- Branch: `main`; HEAD: `1b1089797b57bbc43b6fb8423dbcc61baeb2b4a6`.
- Starting status: 14 modified tracked files, no staged changes and no untracked files. Their bytes were recorded before documentation edits. All are preserved.
- No runtime source, tests, compiler profiles, deployment scripts, configuration, or existing documentation was edited. No builds, suites, servers, cloud requests, deployments, IAM changes, policy writes, commits, or pushes ran.
- There are eight management endpoints, of which six mutate, plus Capabilities. This is nine callable endpoints, not nine management operations.

Starting modified files:

```text
CLAUDE.md
app/jest.config.js
app/src/assignments/detail/detail.test.ts
app/src/assignments/detail/detail.ts
app/src/assignments/detail/roster.test.ts
app/src/assignments/detail/roster.ts
app/src/assignments/summary/types.ts
app/src/assignments/summary/wire.ts
app/src/router/surfaces/index.ts
app/src/router/surfaces/surfaces.test.ts
docs/platform/CURRENT_PLATFORM_STATE.md
platform/functions/jest.config.js
platform/functions/src/assessments/assessment-assignment-summary.test.ts
platform/functions/src/assessments/assessment-assignment-summary.ts
```

Operation 2C started on the same branch/HEAD with those 14 modified tracked files plus the two untracked planning documents. It records a fresh in-memory hash baseline for all 1,741 tracked/untracked repository files before edits. Only the two documents may change; no extra scratch file is added to the repository. The completed critical review supplies six required corrections, now resolved in D-G/J; this is a correction operation, not a new proportionality assessment.

### Source-of-truth review

| Source | Use and finding |
|---|---|
| Complete Operation 2A assessment, chat `Assess My Units security design`, `01a173ef-f48a-7933-9a7c-740ee1c50552`, final response | Read in full. Recommends B, preserves application guarantees, relinquishes independent signed activation authority against privileged writers, estimates bounded implementation and staged acceptance. This operation records the owner's subsequent selection. |
| `CURRENT_PLATFORM_STATE.md`; `TEACHER_UNITS.md` | Current architecture routing and unit domain/authorization/consistency contract. Some deployment and certification status paragraphs are historical. |
| `LYFELABZ_FIREBASE_SECURITY_MODEL.md`; `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` referenced by `requireDistrictContext` | Ownership, active identity, tenant boundaries, server-only configuration, audit and default-deny requirements. Security model's Teacher Units direct-read description is stale relative to actual Rules. |
| `U2_6_A3_CONTRACTS.md`; `U2_6_A3_2_RUNTIME_PROVENANCE.md`; `U2_6_A3_3_APPROVED_DECISIONS.md`; `U2_6_A3_3_ENFORCEMENT.md`; `U2_6_A3_6_DECISION_RECORD.md` | Policy, protocol, runtime identity, transaction boundaries, signed authority decisions D1-D15, and implementation/certification history. Conflicts are mapped in the ADR. |
| `U2_6_RELEASE_READINESS_RUNBOOK.md`; `DOMAIN_AND_HOSTING_CONTRACT.md`; `TEACHER_UNITS_STAGING_UX_TEST_DESIGN.md` | Scoped deployment, clean build, placement, paired Hosting, rollback, and staging-only marker exception. |
| `RELEASE_2026-10-24_CLASS_RESULTS_CURRICULUM.md` | Certified Release 1 production baseline. |
| [S6f Operation 1C certification](/private/tmp/s6f-operation1c-20261024/CERTIFICATION.md) | PASS for discovery implementation at this baseline; supersedes Operation 1B's environment-blocked INCONCLUSIVE result. Not activation certification. |
| [Operation 1J report](/private/var/folders/b9/cykdz9y10fdbqc8zg2mg4bw00000gn/T/s6f-operation1j-y56ewlxg/REPORT.md), saved discovery/build/index/consistency evidence | One live staging discovery, 90 successful GETs, live/offline exit 0. All 101 files in its saved manifest were rehashed locally here with zero mismatches. Temporary grants removed. Saved replay consistency is not provider authentication or current readiness. |
| Actual Functions, client, Rules, compiler, release and rollback source | Nine exports; authorization prefix; create, shared mutation and reorder transactions; post-commit reads; capability protocol; closed compiler; eight-endpoint A1 observer; separate nine-endpoint S4/S6f tooling. |

No fresh production or staging state is claimed. Closure is established by inspected local code and the last recorded production release, not a new production read.

### Production closure and deployment baseline

Release 1 source: `14f7bdb55d47d027b6074fb5cc23f1886ba45e21`. Only `assessmentLessonSummary` was updated, followed by general paired Hosting. Production had 76 Functions and **no `teacherUnits*` endpoints**. The availability document was absent. App version `108562bef1fc513f`; marketing `5b50be665a93d424`. Those are recorded October 24 observations, to be refreshed before later production action.

Historical pre-B1 implementation baseline: Current `releaseAvailability.ts` returns false. `build-application.cjs` compiles both `general` and `teacher-units` closed; only `staging-ux-test` has an origin-gated test implementation. `PRODUCTION_TEACHER_UNITS_ENFORCEMENT` in `a3-enforcement.ts` binds `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`. `a3-release-authority.ts` defines that refusing implementation; it is not a selectable operational authority. The composite verifier/factory and empty registry/revocation modules are not wired to production callables. The staging marker bypass is restricted to the exact staging identity.

Current local B1 implementation supersedes that wiring: `a3-enforcement.ts` now checks Option B policy/build directly, without verifier, provenance/evidence graph or staging-marker authorization. Source/default `general` remains false/closed; explicit project/environment/origin-bound `teacher-units` compiles policy-capable UI with `server-policy-required` / `not-certified` evidence. Ordinary Functions builds are schema 2/v3 `closed-only`; only reviewed clean expected-SHA builds may be `policy-controlled`. Real enable remains interlocked in CLI/controller even after valid read-only preflight. No new live deployment/closure claim follows from these source facts.

Actual Rules deny all client access to `teacherUnits`, `teacherUnitCreateReceipts`, `platformConfig`, and `auditEvents`; terminal default deny protects unlisted release/history collections. Admin SDK authorization is an IAM/code boundary, not a Rules guarantee.

## C. Approved trust boundary and essential invariants

### Trust model

| Actor / component | Authority and boundary |
|---|---|
| Ordinary browser, teacher, student, application platform administrator | No availability-policy authority through application roles. Teacher identity authorizes only that teacher's own current-school unit operations. A browser flag or envelope supplies no authority. |
| Functions application code | Verifies Firebase callable identity, canonical active teacher and claims, resolves target environment/database, revalidates authorization and policy within each transaction, validates resources and revisions, writes domain audit events. |
| Database writers, runtime identities with database write capability | Trusted within their effective IAM scope. They can bypass the CLI and Rules, alter policy, unit data and history. Their permissions must be reviewed; the design does not promise collection-only IAM or exclusive human policy control. |
| Deployment, traffic-routing and IAM administrators | Trusted to ship and route approved code and preserve policy enforcement. Can replace enforcement. Clean source, scoped deployment, independent review and observed state constrain mistakes, not a malicious deployer. |
| Human release owner / authorized operator | Approves an exact release, performs attributed prepare/enable/close through reviewed tooling. Human approval is a recorded operational decision, not a cryptographic runtime statement. |
| CI | Credential-free checks. No automatic production activation or policy mutation. |
| Release records and hashes | Consistency and traceability evidence. Neither a digest nor an operator-supplied label independently proves approval or provider provenance. |

Accepted tradeoff: no independently signed activation boundary against a database writer. An authorized writer can restore a previously enabled policy or forge/delete application history. A deployer can ship different identifiers or logic. Audit review, least privilege, verified credentials and recovery are necessary but do not give cryptographic-equivalent assurance.

### Invariants to preserve

| ID | Required invariant | Existing anchor |
|---|---|---|
| I1 | Authenticated canonical `active` teacher only; application administrators do not inherit teacher access | `assertActiveTeacher`, `requireDistrictContext` |
| I2 | UID, school and district derive from canonical state and signed claims; owner and current-school isolation; indistinguishable not-found | `teacher-unit-access.ts` |
| I3 | User and school revalidation in the same transaction as unit reads/writes, on every attempt | `authorizeTeacherUnitsTransaction` |
| I4 | Ownership, grade, creation time and unit identity remain server-derived/immutable | Shared unit type and request allowlists |
| I5 | Callable-only unit/receipt access; clients cannot read/write policy/history/audits | Firestore Rules and terminal deny |
| I6 | Closed request schemas, bounded lists/text, canonical resources, duplicates rejected, no arbitrary field injection | Access helpers and `unit-placeable-resources` |
| I7 | Revision-based writes, atomic membership/reorder, authorized no-ops, archive/restore of the same record | Shared mutation core and reorder |
| I8 | Create receipts bound to teacher and original school; required `expectedSchoolId`; unchanged hash/id vectors | Create handler and durable create store |
| I9 | Unit/receipt/audit commit atomically; no duplicate audit on replay/no-op | `writeAuditEventInTransaction` |
| I10 | Uncertain commits remain uncertain; no automatic request resend; reconcile with authoritative reads | `respondAfterCommit`, pending mutations, create recovery |
| I11 | Availability evaluated uncached server-side on every management operation, including retries/replays/no-ops and response reads | Replacement of `a3-enforcement.ts` |
| I12 | Closure blocks subsequent operations from cached clients; generation changes invalidate old mutation permits | Policy read set and compatibility equality |
| I13 | Correct environment, database, backend build, client contract and ordered placement digest agree | Runtime identity, artifact/build record, discovery, parity gate |
| I14 | Unit membership never grants assignments, alters grades/scoring, reveals answer keys or broadens student access | Existing publisher/scorer/Results authorization, unchanged |
| I15 | Explicit scoped deployment, actual release evidence, paired Hosting recovery and closed rollback | Existing release contract plus Option B integration |

Unit Results continues to call existing authorized assessment aggregates; closing My Units does not revoke unrelated Results/assignment endpoints or recall already returned data. No student-facing unit capability is introduced.

## D. Complete server availability contract

### D1. Singleton and versions

Keep exactly `platformConfig/teacherUnitsAvailability` in database `(default)`. Use a new **policy schemaVersion 2**, distinguished from the old cryptographic schema 1. The sole production policy parser accepts schema 2 only after replacement; old schema 1, staging markers, legacy release references and unknown versions fail closed. Do not infer or auto-convert enabled legacy configuration.

New enforcement identifier: `teacher-units-option-b-v1`. New client contract: `teacher-units-v3`. These are the exact target tokens; active profiles, new standalone protocol copies, client validators, new fixtures and Option B observers must agree at the coherent cutover. Historical schema 1/v2 parsers and fixtures remain versioned and unchanged as specified in G5. A protocol bump makes the changed authority semantics explicit and makes cached v2 mutation clients fail closed.

One policy controls availability. History is adjacent release-control data, not a second runtime authority or a per-request evidence graph. Each actual transition also writes a canonical application audit event atomically, as specified in F2; history does not replace the platform audit sink.

### D2. Exact stored schema

Every field below is required. Unknown fields are rejected recursively. No coercion, accessors, sparse arrays, invalid Unicode, negative zero, nonfinite/unsafe numbers, arbitrary class objects, JSON timestamp stand-ins, or partial nested objects. Strings are compared exactly, never normalized on read.

| Field | Type and complete rule |
|---|---|
| `schemaVersion` | Literal `2` |
| `enforcementVersion` | Literal `teacher-units-option-b-v1` |
| `policyInstanceId` | Canonical lowercase UUID v4. Immutable in ordinary transitions. New instance only for explicit closed initialization/recovery. |
| `environment` | `production`, `staging`, or `emulator`, bound to the resolved server identity |
| `projectId` | Production exactly `lyfelabz-prod`; staging exactly `lyfelabz-staging`; emulator exact injected `demo-` project |
| `projectNumber` | Production `182791689935`; staging `293337283840`; emulator `0`, as strings |
| `region` | Literal `us-central1` |
| `databaseId` | Literal `(default)`, also checked against actual Admin client destination |
| `generation` | Integer 1..Number.MAX_SAFE_INTEGER. Every actual ordinary transition increments exactly one. No-op writes nothing. |
| `mode` | Exactly `closed` or `enabled` |
| `approvedBackendBuildId` | Null or 64 lowercase hex SHA-256. Required non-null when enabled. Closed preparation may select a build. |
| `acceptedClientContractVersions` | Exactly `[]` while closed; exactly `["teacher-units-v3"]` while enabled. No wildcard or implicit older versions. |
| `placementFingerprint` | 64 lowercase hex SHA-256 of the ordered canonical placeable resource ID array, using existing parity-gate bytes |
| `createdAt` | Installed SDK Firestore Timestamp; initialized by server timestamp, retained thereafter |
| `updatedAt` | SDK Timestamp set by server timestamp in the transition transaction |
| `updatedBy` | Exact object `{principalSubject, credentialSubject, delegationSubject}`. First two nonempty well-formed strings of at most 256 code points, no controls; delegationSubject same or null. Tool derives authenticated identities; never treats a supplied label as authentication. |
| `transitionId` | Canonical lowercase UUID v4, unique command identifier; matches committed history event ID |
| `reason` | Trimmed nonempty text, 1..1000 code points, no control characters; no credentials or student data |
| `approvalRef` | Null or trimmed 1..256-code-point reference without controls to the retained owner decision/release record. Required non-null on enable; not an executable URL or runtime-fetched object. |
| `lastEnabledAt` | SDK Timestamp or null; set on enable, retained on close/preparation |
| `lastClosedAt` | SDK Timestamp; set on initialization/close/recovery, retained on prepare/enable |

Chronology: `createdAt <= updatedAt`; non-null transition timestamps within that interval; enabling sets `lastEnabledAt == updatedAt`, closure sets `lastClosedAt == updatedAt`. Both may equal at initialization/recovery only as allowed by the actual transition; initialized/recovered policies are closed and lastEnabledAt null. Runtime checks stored shape and chronology, not wall-clock age. No activation lease or automatic expiry. Transitions are validated from before/after, not inferred solely from timestamps.

Operation 2C decision: retain the D2 field set for the first implementation; moving history-only fields out of the singleton is deferred to avoid another schema change. Runtime validates their stored shape/chronology but never treats attribution, reason or approvalRef as independent proof of approval and never retrieves history to authorize a request. This optional simplification is not a B1a prerequisite.

The writer validates the proposed non-timestamp values and permitted timestamp sentinel positions before writing. Policy and history use server timestamps from the same transaction. After commit it reads concrete Timestamps and validates equality/chronology. A stored sentinel or plain `{seconds,nanoseconds}` object is invalid at runtime. A failed readback means unconfirmed tool outcome, never permission to enable again blindly.

### D3. Backend identity and policy eligibility

Preserve pre-tenant-read runtime resolution against execution metadata and the actual bound Admin Firestore client, including exact project number, region, default database, service and revision. Preserve existing destination protections and explicit `demo-` test-profile injection for the first replacement; simplifying that security-sensitive resolver is not necessary to retire signing. An emulator flag, mutable target variable or request cannot impersonate production. Resolution failure refuses all nine endpoints.

Keep the private build-record path `lib/teacherUnits/a3-runtime-build.json`, and have the controlled writer emit schema 2 and new enforcement/contract values at B1c cutover. Parse it only through new `availability-runtime-build.ts` in the active B path; freeze `a3-runtime-artifact.ts` schema 1 parsing for historical consumers. Reuse its format-independent inventory algorithm without widening its legacy parser. Keep source SHA/tree, dirty flag, build mode, ordered placement fingerprint and application payload fingerprint. Add `backendBuildId` with this exact derivation:

```text
runtimePayloadFingerprint = existing canonical SHA256(file-path -> SHA256(bytes))
  over lib/**/*.js, lib/**/*.json, package.json, package-lock.json,
  excluding exactly lib/teacherUnits/a3-runtime-build.json
backendBuildId = SHA256(existing canonical JSON of {
  schemaVersion: 1,
  sourceSha, sourceTree, deploymentMode,
  enforcementVersion: "teacher-units-option-b-v1",
  clientContractVersion: "teacher-units-v3",
  placementFingerprint, runtimePayloadFingerprint
})
```

Canonical JSON is the existing recursively sorted-key encoding and UTF-8; ordered arrays are not sorted. Digests identify content/consistency, not signing authority. Including mode distinguishes an ordinary closed build from a policy-controlled build of the same commit. Excluding the record avoids self-reference. Dependencies' lock metadata participate; installed dependencies and base-image authenticity are not attested by this digest.

Ordinary Functions builds remain `closed-only`; only explicit, clean, expected-SHA `policy-controlled` builds may enable. Inspect the actual runtime artifact using the existing inventory/check mechanism, verify its build record and derived build ID, then compare the policy's approved ID and placement. Do not trust an arbitrary runtime environment variable containing a build ID. Decision retained for the first replacement: keep artifact checks at the existing enforcement boundary, including the current two inventory passes. This is a deliberate migration-risk tradeoff against Operation 2A's longer-term simplification recommendation, not a new security requirement. Defer instance-level caching/inspection optimization beyond B1; it requires a separately reviewed immutable-artifact lifetime design. No optimization is a B1a blocker. No enabled policy or positive availability result is cached.

An eligible management transaction requires all of: resolved identity still current; canonical teacher authorized; valid schema 2 policy for that target; enabled mode; policy-controlled clean build; exact approved build ID; v3 contract; exact placement equality. Any missing input denies. Fleet-wide traffic/configuration assurance is a release-tool check, not a claim established by one instance's build record.

### D4. Failure, staleness and concurrency semantics

| Condition | Management reads and mutations | Authenticated Capabilities |
|---|---|---|
| Policy absent | `policyMissing`, no unit read/write | `unverified`, null policy IDs, no accepted versions |
| Valid closed policy | `availabilityClosed` | `closed`, known policy instance/generation, accepted versions empty |
| Wrong schema/type/unknown field/invalid timestamp/target mismatch | `policyInvalid` | Refuse; no fabricated declaration |
| Read failure | `policyUnavailable`, except original SDK-retryable errors propagate to SDK | Same refusal/retry behavior; never use last good policy |
| Enabled but build/profile/contract/placement ineligible | `deploymentIneligible` | `unverified`, known identifiers, accepted versions empty |
| Mutation instance, generation or build differs from current policy | `policyChanged` after enabled eligibility | Discovery reports current state only |
| Otherwise-valid mutation envelope placement differs | `placementMismatch` | Discovery reports actual runtime placement |
| Valid enabled policy at maximum generation | Remains eligible if every normal B check passes; ordinary close must not claim closure until verified authorized closed recovery | Declares current enabled state truthfully; generation exhaustion alone is not invalidity |
| Request has old/malformed compatibility contract | `invalidCompatibility` before transaction; missing envelope `compatibilityRequired` | Old discovery schema/contract `contractUnsupported` |

All errors keep the current exact `teacherUnits.*` names and HTTPS mapping in `a3-errors.ts`. Preserve identity, authorization, request-validation order and established availability error precedence. A post-commit failure always becomes `responseUnavailable` with outcome unconfirmed regardless of this table.

Stale means disagreement with the current policy/build, not elapsed time. A stale mutation envelope is never accepted even if the requested domain result would be a no-op. No process-wide policy-generation cache can authorize a write. The CAS tool refuses a previously observed updateTime/instance/generation that no longer matches. Every retry reads current policy again.

A one-document runtime policy cannot detect a privileged writer restoring the entire old policy and all supporting state. History reconciliation detects ordinary rollback mistakes; privileged rollback/tampering remains an accepted trust-model risk. Do not promise global monotonicity against trusted administrators. Explicit restore recovery starts a new closed instance to invalidate old permits.

Concurrent enable and close are serialized by their read of the singleton. Exactly one CAS on a given prior state wins. The loser reports conflict and does not silently update its expected revision. For emergency closure the operator/tool may deliberately read the new state and issue another close with a new reviewed CAS; it never automatically rebases an enable. When close reports success, the resulting state must be read back, and fresh conflicting changes must be reported.

Closure is effective at the transaction serialization boundary. A mutation serialized before close may commit and a response in flight may arrive later. A mutation serialized after close cannot commit under an enabled policy. Closure cannot undo earlier writes or retract data already delivered. Response reads after close refuse and preserve uncertainty.

## E. Enforcement integration and client contract

### E1. Exact endpoint and transaction coverage

| Callable | Integration boundary and preserved behavior |
|---|---|
| `teacherUnitsCreate` | Factory resolves server identity; validates closed request, v3 envelope and original expectedSchoolId. Each create-loop/SDK attempt authorizes before receipt read. Unit + receipt + domain audit atomic; replay fully gated; response read gated again. |
| `teacherUnitsList` | Authorize and read policy in the same transaction as owner+school bounded query; preserve overflow-before-filter and stable ordering. No envelope accepted. |
| `teacherUnitsGet` | `readOwnedTeacherUnit` authorizes and checks policy before owner/unit projection. No envelope accepted. |
| `teacherUnitsUpdate` | Shared mutation core; policy and compatibility before no-op/revision decision; title/description/color allowlist unchanged. |
| `teacherUnitsArchive` | Same shared core, including already-archived no-op. No delete; immutable fields retained. |
| `teacherUnitsRestore` | Same shared core, including already-active no-op; restores original ID/resources/order. |
| `teacherUnitsSetResources` | Same shared core; validation of full bounded ordered membership and canonical placeability retained; no-op still gated. Resource dragging uses this endpoint. |
| `teacherUnitsReorder` | Own multi-unit transaction; authorize/policy before organization query, exact organization/revisions, atomic changed units/audits. Ordered no-op gated; post-commit list reauthorized. |
| `teacherUnitsCapabilities` | Same identity resolution, teacher precheck, strict request, transactional canonical recheck and uncached policy evaluation. May declare closed/unverified but never bypass authentication or fetch units. |

Required transaction prefix:

```text
resolve bound runtime identity before any tenant reads
canonical active-teacher precheck and closed request validation
for EVERY transaction attempt:
  assert runtime identity/destination current
  re-read users/{uid} and schools/{schoolId}; revalidate actor
  read singleton policy through this transaction
  parse policy; check target, build/profile, contract and placement
  for mutations compare exact compatibility envelope
  only then read receipt/units/query; evaluate domain rules/no-op/replay/revisions
  stage unit/receipt/domain audit writes, then commit atomically
if a write committed:
  fresh authorized/policy-checked response transaction
  any failure -> responseUnavailable, no compensating write
```

Keep all reads before writes. The policy, canonical user, and school join the transaction read set so concurrent changes force serialization/retry and revalidation. Do not read policy outside the transaction and pass an `available=true` boolean into the callback. Do not trust the earlier Capabilities result at the server. Reuse SDK retry classification and preserve the O6 lesson: only actual transaction-read errors classified as retryable get SDK retry treatment; arbitrary validator errors cannot masquerade as retryable availability evidence.

SDK internal retries remain the approved A3-3 **Option A**. That earlier retry decision is unrelated to the architecture **Option B** selected here. Preserve create's bounded ALREADY_EXISTS receipt convergence. Only pre-transaction validation/local refusal proves no dispatch/commit; in-transaction refusals can follow an earlier committed attempt. Do not move availability errors into the client's proven-precommit list.

### E2. Proposed exact wire versions

Introduce matching active modules `platform/functions/src/teacherUnits/availability-protocol.ts` and `app/src/teacherUnits/availabilityProtocol.ts`, with their own parity check. Freeze old `a3-protocol.ts` / `a3Protocol.ts` wire definitions and old fixtures for historical consumers; no v2 fallback exists in active B runtime. See G5 for the format boundary. Use capability request/response schema **3**, client contract `teacher-units-v3`, mutation envelope schema **2**. No v2 fallback or automatic negotiation to obsolete authority semantics.

Capability request remains exactly `{schemaVersion, nonce, clientContractVersion}`. Nonce grammar remains 16..64 URL-safe characters, generated fresh for each request. Response keeps existing backend/caller/teacherUnits fields, with:

- `backend.enforcementVersion = "teacher-units-option-b-v1"`.
- Add required `backend.backendBuildId` (64 lowercase hex), reporting the actual validated runtime build even while closed.
- Supported/accepted contract tuples use v3. Supported operations retain exact existing order: create/list/get/update/archive/restore/setResources/reorder.
- `availability.backendReleaseId` retains its wire field name to limit controller changes but now equals the policy's `approvedBackendBuildId`; it is no longer a Firestore release-manifest digest. Document this explicit semantic change. Null is allowed when missing or closed/unprepared. For an enabled declaration it must equal `backend.backendBuildId`.
- Existing state declarations and null/identity consistency rules are retained with that closed/unprepared allowance. `deploymentEligible` means this runtime passes Option B policy checks; it is not independent certification of the fleet.

Mutation envelope has exactly six fields (as today, with new versions):

```text
{ schemaVersion: 2, clientContractVersion: "teacher-units-v3",
  policyInstanceId, policyGeneration,
  backendReleaseId: approvedBackendBuildId, placementFingerprint }
```

Do not add ownership to an envelope or include it in receipt IDs/create intent hashes. Server compares every applicable field after its own eligibility check. Runtime placement must equal policy placement and the browser's independently computed ordered digest.

### E3. Client availability and cached clients

Keep source `releaseAvailability.ts` closed and strict compiler substitution. `general` remains closed and constructs no units seam. Redefine the explicit `teacher-units` intent to compile **policy-capable UI**, not authoritative availability. Record its artifact availability as `server-policy-required`; `runtimeAvailability` stays `not-certified`. Pin it to the approved app origin for its target. Unknown/preview origins and production use of staging-only intent refuse.

Functions deployment mode and client release intent are separate. A closed deployment can contain policy-capable code and Hosting while the server policy remains closed. This is required for verification before activation. No environment variable can select an enabled policy at request time.

In `backendCompatibility.ts` preserve trusted origin/project/Auth/Functions transport, UID/school/district/token/session-generation checks, nonce, ten-second deadline and single-use permit. Obtain fresh Capabilities on every explicit mutation attempt, including create reconcile, then consume immediately before dispatch. Do not persist a permit or automatically resend on generation/build changes.

### E4. Single shared capability lifecycle (required)

Create one seam-owned `capabilityState.ts` service per active-teacher bootstrap context, shared by My Units, Curriculum selection, Add to Unit, membership pickers and resource placement. It owns discovery/display state, not backend authority. Key context by UID, school, district, bootstrap generation, actual token session and trusted transport/origin/project. Do not create per-panel positive caches or put capabilities in local/session storage or durable create records.

States are exactly `unknown`, `checking`, `enabled`, `closed`, `unavailable`, `incompatible`, `stale`. Only a current `enabled` observation with validated v3 contract, actual/approved build equality, target/caller/nonce and placement agreement permits enabled unit controls. Unknown, checking, unavailable, stale, closed and incompatible states never enable actions. Pending/unconfirmed mutation evidence and original school-bound create intent are retained separately; availability loss never proves a write rolled back. Existing Assign, Results and student paths do not depend on this state.

Required consumers and refresh points:

- Bootstrap starts unknown. Entry to **either Curriculum or My Units**, including direct Curriculum entry without ever visiting My Units, requests discovery through this one service. Unit selection/Add to Unit/pickers remain disabled or unrendered until enabled. Curriculum integration in `curriculum.ts` and the common panel gate is mandatory.
- Opening Add to Unit or a membership/resource picker revalidates if stale/unknown; already in-flight identical-context display refreshes are coalesced. Returning from hidden visibility marks display state stale before revalidation. Entering a different surface also refreshes before enabling its unit actions. No background polling is required.
- A positive display observation expires after 30 seconds on a monotonic local clock. A local expiry timer increments the lifecycle epoch, changes enabled to stale and disables controls; it does not automatically call a backend. A refresh is triggered by the next relevant view/action/visibility event. Thirty seconds is a UI freshness bound, never a server authorization lease. No repeated idle discovery loop is introduced.
- Every explicit mutation still performs its own fresh discovery with its own nonce and existing ten-second deadline, then consumes a single-use permit immediately before dispatch with token/context/transport checks. A shared display result is never reused as a mutation permit. An explicit user gesture made while the current display state is enabled may finish this fresh verification; any new invalidation before consumption cancels it. A context-changing event never automatically resends an intent.

Ordering: maintain a lifecycle epoch and monotonically increasing request sequence. Every discovery captures context+epoch+sequence+nonce and deadline. Accept a response only if its context/epoch remain current, it is the latest authoritative request sequence, it has not expired/cancelled, and all nonce/caller/transport checks pass. A newer refresh supersedes an older display request. A closed/error/incompatible result or a server availability/compatibility refusal increments the epoch and revokes all outstanding display observations and unconsumed permits. An earlier delayed enabled response cannot reopen controls. Sign-out, account/school/district/bootstrap/token change, trusted-target change, placement change, explicit invalidation, visibility loss or disposal also increments epoch and suppresses late responses. A legitimate later enable requires a newly initiated current-context discovery; do not order different policy-instance UUIDs lexically. For one instance, never regress a previously observed generation.

Mutation discovery may publish its successfully checked result to the shared display service only through that same ordering/epoch machinery; it never hands its one-use permit to another caller. Keep dispatch outcomes distinct from local compatibility refusals, and preserve existing uncertain-outcome reconciliation. Dispose subscriptions/timers at bootstrap teardown; surface teardown releases its subscription without destroying shared unresolved intent state.

Cached-client closure remains server-enforced on every operation. A cached view can retain already returned data until refresh, expiry or action; no data recall is promised. Subsequent management reads/writes serialized after server close refuse even if UI code is stale. Read request shapes stay unchanged and take no envelope. Cached v2 list/get requests can receive only the same teacher-authorized data while enabled; v2 discovery/mutations are rejected.

Required client tests: direct Curriculum first entry; every listed consumer in all seven states; display coalescing without permit sharing; out-of-order enabled then closed/error; token/school/context changes during discovery and permit consumption; visibility expiry/return; 30-second expiry; newer policy generation followed by delayed older response; disposal; pending/lost write followed by closure; each mutation gets fresh discovery and no automatic resend. Keep shell Firebase imports outside the shell via the existing seam.

## F. Smallest operator control

### F1. Tool and command surface (proposed only)

Implement `scripts/teacher-units-release/availability-control.cjs`. Reuse safe project binding, canonical encoding, explicit credential selection and emulator safeguards. Replace active policy-writing use of legacy `availability-cas.cjs`; do not append an unsigned-success branch to its composite-verifier dependencies.

Commands: `show`, `prepare`, `enable`, `close`, `verify`, and separately authorized `recoverClosed`. Dry-run is the default for transitions; writes require explicit execution plus the exact displayed confirmation digest. Every invocation requires literal `--project`; never infer `.firebaserc`. Cloud mode refuses emulator variables; emulator mode accepts only an injected `demo-` target. CI tests fake/emulator paths without credentials. No new public callable, admin web UI, signer service or infrastructure is needed.

| Action | Preconditions and effects |
|---|---|
| `show` | Read singleton and recent history; report state, binding, generation, updateTime, identities, build/placement and inconsistencies. Report incomplete visibility as unknown. No writes. |
| `prepare` | Existing policy must be valid and closed, or confirmed absent for initialization. Select exact approved clean build and placement; remain closed with accepted contracts empty. First creation generation 1 and new UUID. Real changes increment generation; no-op unchanged. |
| `enable` | Valid closed prepared schema 2 policy; explicit owner approval for this target/build/next generation; independent review/staging/production closure evidence as applicable; fresh nine-endpoint and Hosting evidence. CAS only changes mode/accepted contracts/transition metadata, not selected build/placement. |
| `close` | Does not load certification, key, release/evidence documents, build archives, Hosting, or provider normalizer. Valid enabled policy -> closed, generation +1, contracts empty, may retain build/placement for traceability. Valid already-closed state -> verified no-op without generation/history write. |
| `verify` | Read policy and exact transition history event, check concrete timestamps, identities, prior/next binding and updateTime; report committed-current, committed-superseded, not-committed, conflicting or unconfirmed. No writes. |

Prepare/enable dry-run input binds exact before updateTime, instance, generation, next state/build/placement, project/database, verified operator identity, reason, approvalRef and transitionId. Exclude unpredictable commit timestamps from confirmation digest. Require confirmation within ten minutes and identical authenticated credential subject at execution. Fresh enable observations must be at most five minutes old at execution, not future-dated; preparation/release record within 24 hours. Changed deployments invalidate the evidence even within these limits. Closure needs no release evidence freshness.

Tool verifies actual credential subject and intended target before writes. Under impersonation, record effective credential service account and the separately verified initiating human/delegation context; if that context cannot be established, refuse enable. `--principal` or `--operator-subject` is never identity proof. Tool execution is human-controlled; no persistent credentials are added to CI. Provider audit records are corroboration where available; this plan does not assume Data Access logging is configured.

### F2. CAS, history and uncertain operator outcomes

Use existing server-only collection `teacherUnitsAvailabilityHistory`, new event schemaVersion **2**, document path `teacherUnitsAvailabilityHistory/{transitionId}` where transitionId is the command's UUID v4. Retain old content-addressed schema 1 events untouched and label them historical. IDs are neither generation-only nor approval digests. A prior generation's history must never prevent emergency close.

Exact new event fields:

```text
schemaVersion: 2
kind: "teacher-units-option-b-transition"
transitionId: UUID v4
transition: "initialize" | "prepare" | "enable" | "close" | "recoverClosed"
environment, projectId, projectNumber, region, databaseId: exact target tuple
previousUpdateTime: SDK Timestamp | null
previousPolicyInstanceId: UUID v4 | null
previousGeneration: positive safe integer | null
previousPolicyDigest: SHA256 | null
nextPolicy: full concrete schema 2 policy, including matching transitionId
operator: exact same object as nextPolicy.updatedBy
reason: same as nextPolicy.reason
approvalRef: same as nextPolicy.approvalRef
intentDigest: SHA256 of normalized confirmed command excluding server timestamps
committedAt: SDK Timestamp equal to nextPolicy.updatedAt
auditEventId: Firestore auto-ID for the canonical auditEvents record
```

Digest before policy using the existing canonical encoding, projecting SDK timestamps to exact seconds/nanoseconds. No free-form secret or raw malformed policy is copied into events. Previous valid state supplies the instance/generation/digest; absent supplies nulls. Malformed/legacy recovery records updateTime but nulls any unavailable validated previous fields, and preserves a private before-snapshot in the recovery evidence. History fields are strict and nested `nextPolicy` uses the same validator. Runtime does not fetch history. The writer enforces create-only history and exact event/command correspondence.

Keep `auditEvents` as the authoritative application audit sink. **Operation 2C owner direction authorizes this exact narrow extension for planning only.** Its implementation belongs to separately authorized B1d; approval does not widen a user Role, custom claim, IAM grant or callable privilege.

Allow the audit-only `operator` sentinel **if and only if** action is `teacherUnits.availabilityChanged`, targetType is `teacherUnitsAvailability`, targetId is exactly `platformConfig/teacherUnitsAvailability`, correlationId is the canonical transition UUID, actorUserId equals validated payload.operator.principalSubject, and the complete strict payload below validates. Conversely, this new action requires that exact operator/target tuple; it cannot be emitted as a teacher/student/system event. Reject missing/extra fields, malformed nested operator data, wrong targets, spoofed role/action combinations, and any schoolId/districtId supplied for this global exception. No arbitrary action gains a school-context exemption.

The payload has **exactly** `{transition, policyInstanceId, generation, mode, approvedBackendBuildId, placementFingerprint, operator, reason, approvalRef}`. Validate transition against initialize/prepare/enable/close/recoverClosed; canonical UUID instance; positive safe generation; exact mode; null-or-digest build with enabled requiring a build; digest placement; exact bounded operator object from D2; bounded nonempty reason; null-or-bounded approvalRef with enable requiring non-null. Initialize/recoverClosed require generation 1, closed mode and null build; prepare/close require closed mode; enable requires enabled mode. The tool additionally binds every field to the same validated transition/next policy, verified credential context, reason and approval. The generic writer validates schema and cross-field consistency; it does not authenticate a human from a supplied label or perform cloud credential checks.

The event uses the canonical top-level shape and server occurredAt; actorUserId deliberately records the external verified principal subject for this action only, rather than pretending it is an application UID or platform administrator. Existing teacher/student/platformAdministrator events keep their current school requirement, district validation and user-ID semantics; existing system-event exceptions remain unchanged. Do not loosen generic payload validation or unknown-role rejection for other actions.

Focused regression requirements: exact operator action+target accept; wrong action/target/role/UID/correlation and every payload missing/extra/type/boundary contradiction reject; teacher/student missing-school rejection unchanged; system behavior unchanged; existing `assignments.published`/`assignments.updated`, `classes.activated`, teacherUnits domain events and assessment-finalization audit behavior retain their original shapes and atomicity. Reuse the unchanged targeted consumer suites, plus a focused `assessment-lesson-summary.test.ts` Release 1 read-contract regression; do not invent an audit write for that read-only Function. No full suite is required merely to validate these documentation corrections.

Use the existing canonical `writeAuditEventInTransaction` helper after all reads/checks, record its allocated auditEventId in history, and commit **policy + history + canonical audit** together. No-op/verified duplicate commands emit no second audit. Concrete occurredAt/committedAt/policy.updatedAt must agree.

In one database transaction: read command event ID and current singleton; for existing matching event return its validated committed result without another transition; conflicting reuse of ID refuses. Otherwise compare supplied before snapshot/updateTime and generation, validate transition, stage policy set/update, canonical audit and history event create atomically. Every SDK rerun repeats the checks. An unconfirmed commit is reconciled by the same event ID and intent, never by issuing a second enable with a fresh ID.

Readback verifies the linked canonical audit as well as policy/history and must distinguish committed-but-superseded from still-current. If a later close won, an earlier enable is recorded as committed historically and does not imply currently enabled. If policy is unreadable, report unconfirmed, deny all management, retain evidence and avoid blind retries. If DB is unavailable neither enable nor close can be confirmed; management fails closed on policy read failure. If a defect prevents policy enforcement, use the separately authorized known-good closed backend/traffic recovery, not a false assurance that a failed write shut it down.

For a missing policy, ordinary close reports effective closure under B and does not create permission. A malformed policy or schema 1 policy is closed only relative to the schema-2-only B evaluator; do not extend that statement to still-serving legacy endpoints. Before replacing staging code, close its schema 1 marker through the retained legacy staging close procedure and verify refusal on the old endpoints.

**Generation exhaustion is not closure.** `Number.MAX_SAFE_INTEGER` is a valid last generation. If its valid policy is enabled, ordinary close must refuse with **still enabled; recovery required** and must not claim the service is closed, increment to an unsafe number, rewind generation, or write a partial event. An enabled policy at MAX-1 can close normally at MAX; a valid closed policy at MAX is already closed but cannot prepare/enable again in that instance.

`recoverClosed` is a distinct command requiring explicit repair authorization that identifies target, observed updateTime/instance/generation, replacement closed instance, reason and operator. Dry-run and execution use the same CAS/intent rules as F2. In a single transaction re-read policy and command history; refuse if the confirmed prior state changed. Replace, without delete, the singleton with schema 2, a fresh instance UUID, generation 1, mode closed, null approved build, empty accepted contracts, the confirmed valid placement digest and initialized server timestamps. Preserve a private before-snapshot; commit policy, recovery history and canonical operator audit atomically. A fresh instance plus null build and closed mode invalidates every old envelope and prevents an old enabled-generation permit from authorizing any transaction serialized after recovery. The runtime always reads the singleton uncached, including retries, replays, no-ops and response reads.

Until that commit/readback is verified, report the previous valid enabled state as still enabled, or report **unconfirmed** if its current state cannot be read. Recovery is not retroactive: mutations serialized before it may commit. A failed/uncertain recovery uses the same transitionId reconciliation; never report closure on intent or exit code alone. Compare all actual serving routes during external acceptance; legacy/noncompliant code cannot be made safe by a schema-2-only claim. Privileged restoration of an old entire policy remains the accepted trusted-writer risk, not a protection promised by recovery. Recovery cannot enable and never carries forward old activation approval. No deletion or automatic data migration is authorized here.

Boundary tests: enabled MAX-1 -> closed MAX succeeds; enabled MAX -> ordinary close refuses with unchanged policy/history/audit and still-enabled result; closed MAX -> verified close no-op but prepare/enable refuse; MAX+1/unsafe/fractional/negative generations are invalid; authorized recovery -> fresh closed instance generation 1 with empty contracts/null build; stale recovery CAS and reused conflicting transitionId refuse; history/audit failure rolls back all writes; lost recovery response reconciles without duplicate transition/audit; cached old permits/replays/no-ops fail after recovery; mutation/recovery races respect serialization. These are required in the pure B1a vectors where applicable and real B1c/B1e transaction tests for commit behavior.

### F3. IAM requirements and scopes

No IAM changes are authorized here. The following is the implementation permission specification to validate against the installed SDK/provider APIs during the separately authorized access review, not a claim that a suitable grant already exists.

| Principal/action | Required permissions and narrowest intended scope | Exclusions / verification gate |
|---|---|---|
| Read-only policy/status reviewer | `datastore.entities.get`; `datastore.entities.list` only for history queries; `datastore.databases.get` for transactional reads; metadata get only if the chosen target-verification API needs it | Exact target default database where grantable. No entity writes/deletes, IAM or deployment rights. |
| Availability operator using Admin SDK transactions | `datastore.databases.get`, `datastore.entities.get`, `datastore.entities.create`, `datastore.entities.update`; `datastore.entities.list` for history review only | Exact target default database where supported, not organization-wide. No entity delete, import/export, index changes, IAM administration, service creation, deploy, sign, KMS or Storage rights needed for the policy transaction. |
| Optional impersonated operator credential | `iam.serviceAccounts.getAccessToken` on that exact existing service account only; runtime data rights belong to that account | No project-wide Token Creator by default, no signBlob/signJwt or user-managed key creation. Effective inherited paths still reviewed. |
| Runtime Functions | Existing canonical reads, policy read, unit/receipt reads/writes and domain audit creates; query list and transaction rights | Actual database-level write rights may also allow policy/history edits. Review shared account permissions and all code using it; do not claim document IAM separation. No release evidence, signing, KMS or evidence-bucket access is needed by Option B. |
| Release observer | Only metadata/source permissions for the exact observation plan: reused 1J Functions/Run/Rules/index/Firebase reads, generation-pinned source `storage.objects.get`; Hosting read/list-version access for the existing pair; separately approved inherited IAM/route read visibility | Scope source reads to project source bucket and requested generation, Hosting to intended sites where supported. No policy/entity writes or deployments. Missing access must report an evidence gap. |
| Deployer / rollback operator | Existing reviewed Functions/Cloud Run/build/artifact/Hosting deployment permissions, narrowly scoped service-account actAs where required, exact target project | Keep separate from the policy-only operator where practical. Enumerate effective service-agent, build, inherited IAM and routing permissions from the actual deployment plan before authorization. Do not grant a broad canned Admin/Editor role to make a check pass. |

Firestore client Rules do not restrict these Admin credentials. This design does **not** assert that IAM can enforce per-document transition verbs or create-only history, or isolate `platformConfig/teacherUnitsAvailability` from all other documents. If the smallest available grant is database-wide, explicitly list that blast radius and every holder for owner acceptance before any grant. The CLI's CAS/approval checks are trusted tooling controls; IAM cannot be assumed to prevent a privileged operator bypassing them. New dedicated accounts are optional remediation after effective-permission evidence, not an automatic infrastructure prerequisite.

## G. Exact file-level implementation map

Paths are repository-relative in this table. These are future changes only. R = retain, M = modify, D = deprecate from active launch path, T = retire from active runtime. Historical files/evidence are not deleted by Operation 2B. Dependencies use groups: P policy/runtime; C client; O operator/release; V integrated verification.

### G1. Functions and protocol

| Exact file(s) | Current responsibility | Planned disposition/change | Invariants; required tests; dependency |
|---|---|---|---|
| `platform/functions/src/teacherUnits/availability-policy.ts` (new) | None | P: exact schema 2 parser, eligibility and transition definitions; no cryptography or cloud writer | I11-I13; missing/malformed/target/version/timestamp/state matrix; independent policy validator tests |
| `platform/functions/src/teacherUnits/availability-policy.test.ts` (new) | None | P: independent contract vectors, transition/error boundaries | I11-I13; all D2-D4 cases; P |
| `platform/functions/src/teacherUnits/a3-enforcement.ts` | Identity, evidence graph, provenance, verifier, staging branch, errors, post-commit wrapper | M: keep stable transaction-facing functions; replace availability computation with sole schema 2 evaluator and build equality. Remove verifier/provenance/evidence reads and staging marker path. Keep retry classification and responseUnavailable semantics | I3,I10-I13; full nine-path denial/enable/retry tests; P |
| `platform/functions/src/teacherUnits/a3-release-authority.ts` | Verifier interface and UNCONFIGURED refusing implementation | T from new callable dependency graph; preserve legacy utility only for historical tooling. Never replace constant with success. Remove verifier member from new enforcement factory | I11; production graph/import and emitted-artifact tests; P replacement first |
| `platform/functions/src/teacherUnits/a3-composite-verifier.ts` | Composite verifier/factory and signed release chain | T from launch/runtime; retained legacy tests/tooling may import until archival decision | Trust model; new graph must have no release-authority call; P/O |
| `platform/functions/src/teacherUnits/a3-runtime-provenance.ts` | Signed manifest + exact revision/config binding | T from active runtime; replace role with actual identity/build check in enforcement. Provider revision/traffic checks retained operationally | I13,I15; wrong artifact/build/revision observation; P/O |
| `platform/functions/src/teacherUnits/a3-runtime-artifact.ts` | Legacy schema 1 build parser and generic artifact inventory | R frozen historical parser/inventory; new `availability-runtime-build.ts` and test implement B schema 2 and build ID, reusing generic inventory only | I13; old archived record/replay stays unchanged; new build tamper/profile tests; B1b/B1c |
| `platform/functions/src/teacherUnits/a3-runtime-identity.ts`; `a3-runtime-metadata.ts` (same directory) | Bound cloud/emulator identity and destination | R security behavior; only protocol-type import adaptation if necessary | I2,I13; reuse identity, metadata, destination tests, no resolver redesign; P |
| `platform/functions/src/teacherUnits/a3-protocol.ts`; `app/src/teacherUnits/a3Protocol.ts` | Legacy standalone v2 wire definitions and primitives | R legacy formats; new Functions `availability-protocol.ts` / app `availabilityProtocol.ts` and their tests define v3/schema 3/envelope 2. Active callers change imports at cutover, not legacy parsers | I12-I13; separate old/new parity and strict wrong-format rejection; B1b/B1c/B1f |
| `platform/functions/src/teacherUnits/a3-errors.ts`; `platform/functions/src/shared/errors/https-callable.ts`; `https-callable.test.ts` (same errors directory) | Exact error catalog/translation | R codes, categories and translator; recovery tool status is an operator result, not a new callable code | I10-I11; reuse exact translator and unrelated-code regressions; B1c |
| `platform/functions/src/teacherUnits/teacher-unit-access.ts` | Canonical teacher recheck, transaction prefix, owner checks, post-commit read | M only prefix scope/type imports/comments to new evaluator; retain ownership/validation/projection | I1-I6,I11; transaction revoke/race and owner-school tests; P |
| `platform/functions/src/teacherUnits/teacher-unit-mutation.ts` | Shared CAS, no-op, domain audit and response read | M scope/protocol types only; preserve behavior and retry interpretation | I7,I9-I11; every shared-operation retry/no-op/post-commit test; P |
| `platform/functions/src/teacherUnits/teacher-units-create.ts` | Create, receipt, school binding and recovery | M factory scope/protocol integration; no receipt/hash/schema changes | I4,I8-I11; first/replay/concurrent-key/school-transfer/uncertain; P |
| `platform/functions/src/teacherUnits/teacher-units-get.ts` | Authorized single read | M enforcement wiring/type only | I1-I3,I11; closed/owner-school/auth races; P |
| `platform/functions/src/teacherUnits/teacher-units-list.ts` | Authorized owner+school query and limits | M wiring/type only | I1-I3,I6,I11; closed/query-scope/overflow/filter tests; P |
| `platform/functions/src/teacherUnits/teacher-units-update.ts` | Title/description/color mutation | M wiring/protocol only | I4,I6-I7,I11; no-op/revision/archived/color invariants; P |
| `platform/functions/src/teacherUnits/teacher-units-archive.ts` | Archive status transition | M wiring/protocol only | I7,I11; already-archived no-op/retry/response-read; P |
| `platform/functions/src/teacherUnits/teacher-units-restore.ts` | Restore same unit | M wiring/protocol only | I7,I11; already-active no-op/order/resources/retry; P |
| `platform/functions/src/teacherUnits/teacher-units-set-resources.ts` | Membership and resource order | M wiring/protocol only | I6-I7,I11,I13; placement, retired/unknown IDs, conflicts, no-op; P |
| `platform/functions/src/teacherUnits/teacher-units-reorder.ts` | Multi-unit atomic reorder | M scope/protocol integration; both write and list-response transactions retained | I3,I7,I9-I11; incomplete organization/concurrent create/archive/reorder/retry; P |
| `platform/functions/src/teacherUnits/teacher-units-capabilities.ts` | Authenticated schema 2 declaration | M schema 3 and actual build reporting, same transaction authorization | I1-I3,I11-I13; discovery failure/declaration matrix and parity; P/C |
| `platform/functions/src/teacherUnits/index.ts`; `platform/functions/src/index.ts` | Nine public exports | R exact names and count; no operator callable. Verify all bind replacement enforcement | I11,I15; compiled nine-export/production-wiring tests; P |
| `platform/functions/src/teacherUnits/unit-placeable-resources.ts`; `unit-placeable-resources.json` (same directory); `scripts/unit-placement/check-parity.cjs`; `check-parity.test.cjs` (same script directory) | Canonical placement and required parity | R IDs, order, validation and build/deploy parity | I6,I13; reuse ordered digest/parity tests; P/C/O |
| `platform/functions/src/shared/types/audit-event.ts`; `platform/functions/src/shared/audit/write-audit-event.ts`; `write-audit-event.test.ts` (same audit directory); `platform/functions/src/shared/audit/README.md`; `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md`; `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` | Canonical audit model and sole writer | M only F2 exact operator action/target and complete payload validation, owner-authorized for planning; preserve all existing user/system semantics | I9,I15; exact tuple/payload negatives, atomicity and Release 1 targeted consumer regressions; B1d |
| `platform/functions/src/shared/auth/require-district-context.ts`; `platform/functions/src/shared/types/teacher-unit.ts`; `platform/functions/src/shared/firestore/typed-ref.ts` | Canonical auth, domain model, typed refs | R; no new domain/admin privilege or receipt migration | I1-I9; source/dependency comparison plus existing domain tests; P |

### G2. Legacy contract retirement and compilation

| Exact files / module family | Current responsibility | Planned disposition/change | Tests and dependencies |
|---|---|---|---|
| Functions `teacherUnits/a3-ed25519.ts`, `a3-signature.ts`, `a3-authority-registry.ts`, `a3-revocation-list.ts` | Signature verification and artifact trust anchors | T from active runtime/launch prerequisites; no key population. Keep historical utility/test behavior until deliberate archival | No production imports; replacement invariants first; P/O |
| Functions `teacherUnits/a3-bindings.ts`, `a3-contracts.ts`, `a3-validation.ts` | Signed policy/release/evidence schemas and bindings | D for schema 1 graph; retain types/helpers still consumed by legacy tooling or identity. New policy parser never calls legacy approval validators | Import/consumer audit, no hidden old gate; P/O |
| Functions `teacherUnits/a3-canonical.ts` | Strict canonical encoding, hashing and signing bytes | R generic encoding/digest helpers; D signing-only helpers from active path | Existing canonical vectors; no algorithm drift; P/O |
| Functions `teacherUnits/a3-staging-ux-test.ts`; `a3-staging-ux-test.test.ts` | Historical staging marker logic | R module/tests for legacy close; T only from B runtime imports, not compiled legacy tooling | Legacy marker negative in B and historical close works; B1c/B3 |
| `platform/functions/scripts/write-a3-runtime-build.cjs`; `platform/functions/package.json` | Closed/policy-controlled postbuild record and postbuild invocation | M writer for B schema 2 ID/v3; R package.json and invocation path. Retain clean expected-SHA profile and stale-record deletion; no runtime selector or dependency changes | Profile tests, predeploy reproducibility and stale output; B1c |
| `platform/functions/tsconfig.build.json` | Compiled test exclusions | R for first replacement: legacy helpers remain packaged but unreachable from B authorization, preserving offline consumers. No broad archival/exclusion cleanup; new tests remain excluded by existing pattern | Compiled dependency graph and absence of test bypasses; B1c/B1h |
| `fixtures/teacher-units-a3/v1.json` | Legacy signed vectors | R historical; new `fixtures/teacher-units-option-b/v1.json` for policy/protocol/build cases | New fixture parity and old generic canonical vectors; P/C/O |

Retiring an active import is distinct from deleting a source file. Offline tooling currently loads compiled legacy modules, including `availability-cas.cjs`'s composite-verifier imports. The local operation must explicitly resolve these consumers before changing compilation exclusions: retain their inert compiled helpers or archive their commands/tests together. Do not break an installed command silently, leave stale `lib` files, or require finishing unused crypto tools to launch B. New runtime has zero dependencies on approval registries, signatures, disposition/certification lookups or marker enablement.

### G3. Client and tests

| Exact file(s) | Current responsibility | Planned disposition/change | Invariants; tests; dependency |
|---|---|---|---|
| `app/src/teacherUnits/backendCompatibility.ts`; `backendCompatibility.test.ts`; new `capabilityState.ts` / `capabilityState.test.ts` | Mutation-only discovery today; no common display authority | M active v3 imports and fresh one-use permit; new shared context/epoch/sequence state covers all E4 consumers | I10,I12-I13; Curriculum-first, stale response, expiry, no permit sharing/resend; B1f |
| `app/src/teacherUnits/wire.ts`; `wire.test.ts` | Eight callable adapters and dispatch envelope | M protocol types and per-action permit; retain payload snapshotting, correlation, response validation, no read envelope | I4,I6,I10,I12; adapter and reconciliation tests; C |
| `app/src/teacherUnits/releaseAvailability.ts`; `releaseAvailability.test.ts` | Closed source gate | R closed source; M tests for strict compiled policy-capable intent and origin refusal | I11-I13; compiler matrix and lazy boundary; C/O |
| `app/src/teacherUnits/releaseBoundary.ts`; `app/src/index.ts` | Lazy seam creation/bootstrap | M only necessary lifecycle wiring for capability refresh and availability state | I10,I12; closed no-construction/no-network, enabled-profile-but-server-closed; C |
| `app/src/teacherUnits/unitsController.ts`; `app/src/shell/surfaces/myUnits.ts`; `teacherUnitsPanel.ts` (same surfaces directory) | Controller, panel entry/visibility and actions | M minimal availability refresh/display integration; preserve reconciliation, notices, focus, subscriptions and request counts | I10,I12-I14; cached close, pending/late responses, no duplicate reads; C |
| `app/src/shell/surfaces/curriculum.ts` | Selection, Add to Unit and membership pills | M mandatory integration with shared E4 capability state, including direct Curriculum-first entry, picker/placement eligibility and response ordering; preserve assignment/Results behavior | I12-I14; all unavailable states disable actions and unchanged Results/Assign paths; B1f |
| `app/src/teacherUnits/errors.ts`; `mutationReconciliation.ts`; `pendingMutations.ts`; `createAttemptStore.ts`; `saveCoordination.ts` (same directory) | Outcome classification, durable school-bound create and pending coordination | R domain behavior and persisted formats; only new protocol fixture/import changes where needed | I8,I10; reuse uncertainty/school/persistence/interleaving suites, no new precommit availability classification; C |
| `app/src/teacherUnits/a3Protocol.test.ts`; Functions `teacherUnits/a3-contracts.test.ts` | Legacy v2 parity and signed vectors | R historical assertions/fixtures; active v3 parity lives in new availability-protocol / availabilityProtocol tests | I12-I13; neither old format can authorize B; B1b |
| Functions `teacherUnits/teacher-units.test.ts`; `teacher-units.emulator.test.ts`; `teacher-units-capabilities.test.ts`; `a3-enforcement-retry.test.ts` | Real handler/domain and transaction coverage | M fixtures/factories to new policy, replace verifier/evidence assertions; retain domain cases | All I1-I13; H matrix; P/C/O/V |
| Functions `teacherUnits/a3-release-authority.test.ts`; `a3-composite-verifier.test.ts`; `a3-signature.test.ts`; `a3-ed25519.test.ts`; `a3-authority-registry.test.ts`; `a3-revocation-list.test.ts`; `a3-certification-history.test.ts` | Legacy crypto mechanism certification | D as launch gates once no active consumer; retain historical results/tests if modules retained | Do not rewrite into unconditional-success tests; P/O |
| Functions `teacherUnits/a3-runtime-artifact.test.ts`; `a3-runtime-build-profile.test.ts`; `a3-runtime-provenance.test.ts`; `a3-runtime-identity.test.ts`; `a3-runtime-destination.test.ts`; `a3-runtime-metadata.test.ts`; `a3-test-support.test.ts` | Legacy artifact/provenance, current writer profile, identity and handler fixtures | R old artifact/provenance/identity tests; M build-profile and active handler test-support only; new B runtime-build tests separate | I13; historical schema 1 remains inspectable; B1b/B1c |
| `platform/functions/scripts/test-capabilities-transport.cjs`; `teacher-units-capabilities-transport.test.cjs` (same scripts directory) | Real callable transport harness | M requested versions and expected closed/identity refusals; positive factory profile remains demo-only | I1,I11-I13; real transport errors, never weaken cloud identity for emulator convenience; P/V |
| `app/scripts/build-application.cjs`; `build-application.test.js` (same directory) | Intent compiler, source/entry allowlists and build evidence | M explicit policy-capable teacher-units profile, `server-policy-required` evidence, origin/target binding, general closed and no permissive fallback | I12-I15; profile tamper/intent/source-path/unknown-target cases; C/O |
| `app/scripts/teacher-units-test-setup.js`; `app/jest.config.js`; `platform/functions/jest.config.js` | Test profile substitution and worker/config | R unless minimal necessary fixture mapping; dirty Jest configs belong to pre-existing work and require separate reconciliation before any future edit | Closed actual artifact test distinct from test mock; no weakened exclusions; C/V |
| `app/src/shell/shell.my-units.test.ts`; `myUnits.modernization.test.ts` (same shell directory); `app/src/shell/surfaces/curriculum.teacher-units.test.ts`; `curriculum.add-to-unit.test.ts` (same surfaces directory) | Navigation, Results, selection and membership UX | M narrow profile/availability lifecycle fixtures, retain feature assertions | I12-I14; old Results unaffected, closed absent and cached shutdown; C/V |
| `app/src/teacherUnits/unitsController.reconciliation.test.ts`; `createAttempt.reconciliation.test.ts`; `createAttempt.schoolBinding.test.ts`; `saveCoordination.persistence.test.ts` (same directory) | Critical recovery semantics | R assertions, M fixtures only if required; extend only new generation/closure intersections | I8,I10,I12; focused regression, no duplicated oracle tests; C/V |

### G4. Operator, deployment, Rules and documentation

| Exact file(s) | Current responsibility | Planned disposition/change | Invariants; tests; dependency |
|---|---|---|---|
| `scripts/teacher-units-release/availability-control.cjs`; `availability-control.test.cjs`; `availability-control.emulator.test.cjs` (new) | None | O: small schema 2 dry-run/CAS tool and tests, D/F contract | I11-I12,I15; identity, scope, history atomicity, all races/unknown outcomes; P |
| `scripts/teacher-units-release/availability-cas.cjs`; `availability-cas.emulator.test.cjs` | Emulator-only signed-graph CAS/history | D from B writer path; keep explicit legacy refusal/label, never redirect old enable commands silently | New CAS matrix replaces active gate; P/O |
| `scripts/teacher-units-release/staging-ux-test-policy.cjs`; `staging-ux-test-policy.test.cjs` | Legacy staging marker show/enable/close | R exact legacy close dependencies through transition; new CLI labels legacy commands and never invokes legacy enable for B. Source deletion is deferred | Old close remains runnable against schema 1; B rejects markers/schema 1; B1e/B3 |
| `scripts/teacher-units-release/cli.cjs`; `cli.test.cjs` | Legacy offline command router | M explicit new command routing or dispatch to new tool; mark old signing/register/revocation paths legacy/non-authorizing | No accidental live operation/default alias or fake principal; O |
| `scripts/teacher-units-release/provider-observation.cjs`; `provider-observation.test.cjs`; `access-review.cjs`; `access-review.test.cjs` | Certified historical shape/config/IAM normalization | R historical format behavior; new `option-b-observation.cjs` and test own B buildConfig/update/config acceptance, reusing only stable format-independent helpers | I13,I15; old replay unchanged; real saved-shape/new mixed-build/routing negatives; B1g |
| `scripts/teacher-units-release/provider-capture.cjs`; `provider-capture.test.cjs`; `surface-observation.cjs`; `surface-observation.test.cjs` | Historical capture/replay and schema 1 archive inspection | R legacy paths and schemas. New `option-b-evidence.cjs` and test inspect B records only with explicit format selection; do not widen historical runtime parser | I15; frozen old output and new-format tests; B1b/B1g |
| `scripts/teacher-units-release/staging-discovery.cjs`; `staging-discovery.test.cjs` | Certified non-authorizing discovery | R historical evidence/replay classification; changes only if chosen to consume new records, with focused recertification | Keep 1J reproducible; no implication discovery authorizes activation; O |
| `scripts/teacher-units-release/statements.cjs`; `registration.cjs`; `freshness.cjs`; `evidence-package.cjs`; `revocation-procedure.cjs` and their exact existing `*.test.cjs` counterparts, plus `registration.emulator.test.cjs` | Signed statements/registration/freshness/evidence/revocation | D signed launch dependencies; retain useful generic freshness/record helpers only. S6e signing and R2 ceremonies unnecessary | Consumer/import audit, no retained active crypto prerequisite; O |
| `scripts/hosting-release/backend-state.cjs`; `backend-state.test.cjs` | Legacy eight-endpoint exact backend/Rules hash comparator and release-intent dispatch | M add explicit versioned B nine-endpoint/evidence route with G6 approved-Rules comparison; retain legacy comparator/replay helper behavior and general path. No generic skip/normalization bypass | I13,I15; old receipts stable; B mixed/partial/unapproved rules reject; B1g |
| `scripts/hosting-release/prepare.cjs`; `certify.cjs`; `build-pair.cjs`; `release.cjs`; `release.test.cjs` | Paired preparation, predeploy build, live bytes, records, rollback | M B intent/evidence adapter, schema 2 build and nine-endpoint checks; general path unchanged. Policy stays closed during deployment; certification never enables | I13,I15; predeploy identical profile, actual served bytes, partial deployment/recovery, general closed; O |
| `scripts/hosting-release/hosting-identity.cjs`; `hosting-identity.test.cjs`; `hosting-deployment.cjs`; `hosting-deployment.test.cjs`; `provider-manifest.cjs`; `provider-manifest.test.cjs`; `hosting-capture.cjs`; `hosting-capture.test.cjs`; `deploy-receipt.cjs`; `deploy-receipt.test.cjs`; `hosting-executor.cjs`; `hosting-executor.test.cjs`; `capture-benchmark.cjs`; `capture-benchmark.test.cjs`; `hosting-credential-broker.cjs`; `hosting-credential-broker.test.cjs` | D13 optional identity/provider-manifest/capture/broker machinery | R existing optional behavior; D from mandatory activation dependency. No new signing/broker completion work. Adapt only proven shared consumer breakage within local operation; do not remove standard served-byte certification | Existing synthetic claims remain bounded; unchanged results reusable; O |
| `scripts/hosting-release/contract.cjs`; `hosting-contract.json`; `config.test.cjs`; `pair.test.cjs` | Environment/targets, paths, pair/config gates | R scope/paths/target protection; test new intent integration without weakening pair constraints | I15; target/config/paired-byte checks; O |
| `platform/firebase/firestore.rules`; `platform/firebase/firestore.indexes.json`; `firebase.json`; `firebase.staging.json`; `.firebaserc` | Access denial, indexes, deploy target/config | R by default. No Rules/index deploy merely for hash equality. No new collection allow rule | I5,I15; focused semantic denial on saved/live source; conditional separately authorized changes only |
| `platform/firebase/tests/teacher-units.rules.test.ts` | Callable-only role/access matrix | R and extend only for new history path/policy direct get/list/write denial if not already covered | I5; both repo and saved deployed-source behavior; V |
| `.github/workflows/platform-ci.yml` | Offline tooling and Rules/Functions jobs | M active B fixture/CAS/placement checks, retire crypto-only mandatory jobs only after consumer disposition; keep credential-free | I5,I13,I15; exact touched-path coverage, no deployment credentials; O/V |
| `docs/platform/TEACHER_UNITS.md`; `CURRENT_PLATFORM_STATE.md`; `LYFELABZ_FIREBASE_SECURITY_MODEL.md`; `U2_6_RELEASE_READINESS_RUNBOOK.md`; `DOMAIN_AND_HOSTING_CONTRACT.md` | Canonical routing/contracts | Later M active status/routing to B, correct stale S6f/direct-read statements with evidence, retain paired release constraints. Current-state file is dirty; do not overwrite existing content | Review cross-links and all superseded claims; P/C/O/V |
| `docs/platform/U2_6_A3_CONTRACTS.md`; `U2_6_A3_2_RUNTIME_PROVENANCE.md`; `U2_6_A3_3_APPROVED_DECISIONS.md`; `U2_6_A3_3_ENFORCEMENT.md`; `U2_6_A3_6_DECISION_RECORD.md`; `TEACHER_UNITS_STAGING_UX_TEST_DESIGN.md` | Historical/current A3 decisions and staging exception | Later M scoped supersession/status notes linking adopted ADR; preserve historical bodies, approvals, tests and evidence | Explicit decision mapping in companion ADR; no revisionist deletion; P/O/V |
| `docs/platform/RELEASE_2026-10-24_CLASS_RESULTS_CURRICULUM.md` | Release 1 facts | R immutable historical evidence; new release gets its own record | I15; no suggestion Release 1 deployed My Units |

No assignment publisher, scorer, answer-key path, enrollment policy, student rules, OAuth scopes, domain data schema or receipt retention/index policy needs changing. Any discovered need becomes explicit scope review, not hidden cleanup.

### G5. Active and historical format boundaries (required)

Use separate adapters, not widened legacy validators:

| Format / exact consumers | Required disposition |
|---|---|
| `platform/functions/src/teacherUnits/a3-protocol.ts`, `app/src/teacherUnits/a3Protocol.ts`, their existing tests | Freeze schema 2 discovery/schema 1 envelope/teacher-units-v2 definitions. New active modules named in G1/G3 accept v3 only. Reuse strict parsing primitives but never reinterpret an old wire record as B. |
| `platform/functions/src/teacherUnits/a3-bindings.ts`, `a3-contracts.ts`, `a3-validation.ts`, their existing tests; legacy signature/registry/revocation/certification helpers | Continue importing frozen old protocol and schema 1 policy. Their v2 mutation binding must not silently begin accepting v3. Preserve old canonical vectors; remove only their import from B enforcement. |
| `platform/functions/src/teacherUnits/a3-runtime-artifact.ts`, `a3-runtime-provenance.ts` and their tests | Keep old build validator schema 1/v2. New `availability-runtime-build.ts` accepts build schema 2/v3 only. Both may reuse the same unchanged raw inventory/hash algorithm and build-record path. The B writer cutover does not rewrite archive fixtures. |
| `scripts/teacher-units-release/surface-observation.cjs` and test | Keep historical schema 1 record inspection and old output bytes. It continues using old build validator; never make it infer B from a legacy record. |
| `scripts/teacher-units-release/staging-discovery.cjs` and test, plus dependency closure `provider-observation.cjs`, `access-review.cjs`, `provider-capture.cjs`, `surface-observation.cjs` and each test | Preserve historical replay version/output. Its `backend-state.cjs` dependencies canonical/fingerprint/archive/index helpers retain exact behavior even when a new B release path is added in that shared file. A changed dependency requires focused old-replay regression, even if S6f source is unchanged. |
| `scripts/teacher-units-release/fixtures/synthetic-access.cjs`, `synthetic-provider.cjs`, `synthetic-capture.cjs`, `synthetic-discovery.cjs`, `synthetic-release.cjs`, `synthetic-package.cjs`, `synthetic-revocation.cjs` | R all archived schema 1/v2 fixture generators and their dependency closure; notably synthetic-capture still emits schema 1/v2 build records. Add separate `fixtures/synthetic-option-b.cjs` for new adapter inputs. No wholesale fixture version replacement. |
| `fixtures/teacher-units-a3/v1.json`, old Functions/app protocol vectors, saved Operation 1J discovery/build transcripts and manifests | R original bytes and provenance labels. New `fixtures/teacher-units-option-b/v1.json` is separate. Retained reports are evidence, not live authorization. |
| `scripts/teacher-units-release/registration.cjs`, `availability-cas.cjs`, `statements.cjs`, `freshness.cjs`, `evidence-package.cjs`, `revocation-procedure.cjs`, existing tests and CLI routes | Keep callable legacy/offline inspection explicitly labeled; B operator command never delegates enable to old graph/markers. Keep compiled helpers available until a separately scoped archival operation. |
| New `scripts/teacher-units-release/option-b-evidence.cjs`, test and `option-b-observation.cjs`, test | Explicit B schema record/observation adapter with own versioned kind. A historical inspection request dispatches by explicit historical kind to unchanged old reader; B request accepts new schema only. Unknown or mixed versions refuse. New live-shaped inputs and normalization are fixtures until separately authorized external observation. |

Adapter results carry format and scope: historical inspection/replay is non-authorizing; B build/observation validation is consistency evidence, not owner approval. Never import a historical dispatcher into `availability-policy.ts`, new protocol eligibility or B availability enforcement. If a supposedly generic helper changes, either keep its old behavior or add a separately versioned helper and regression. New parsers are first added unwired, then production-facing imports change in B1c/B1f. This is a coherent replacement with retained historical readers, not a dual-stack authorization path.

### G6. Exact deployed Rules approval contract (required)

Current `backend-state.cjs:assertCompatible` requires observed sourceHash == candidate.rulesSourceHash. Keep that legacy exact comparator unchanged for old evidence. The explicit B release path adds a reviewed alternative; neither mode has a skip-rules flag.

New `scripts/teacher-units-release/option-b-rules-evidence.cjs` and test use strict duplicate-key-rejecting JSON ingestion and exact recursively validated fields for a local release approval attachment of kind `lyfelabz.teacherUnitsOptionBRulesApproval`, schemaVersion 1. Its exact fields are `{kind, schemaVersion, projectId, projectNumber, databaseId, releaseSourceSha, backendBuildId, hostingArtifactFingerprint, placementFingerprint, localRulesSourceHash, approvedRulesetResource, approvedDeployedSourceHash, comparison, testEvidence, review}`. All identities/digests/SHA values use the exact target and canonical grammars above. comparison is `exact` or `reviewed-equivalent`.

`testEvidence` is exactly `{reportSha256, reportRef, testedLocalSourceHash, testedDeployedSourceHash, matrixVersion, result}`. reportRef is a bounded nonempty local/private artifact reference; matrixVersion is `teacher-units-rules-equivalence-v1`; result must be `pass`. The report covers direct unit/receipt/config/history/audit get/list/create/update/delete, collection-group denial, all existing client roles including owner and application administrator, terminal/default-deny behavior and unchanged relevant existing access. It records actual source bytes/hashes, tool/dependency identity and executed results. Review the full source diff as well; a finite focused test matrix is not a proof that arbitrary rulesets are equivalent. No unexplained access-broadening or unrelated source change is permitted under reviewed-equivalent.

`review` is exactly `{principalSubject, decisionRef, reviewedAt}`: bounded authenticated reviewer subject, bounded retained owner approval reference, and valid UTC timestamp. This is trusted-operator approval evidence, not cryptographic authority. The attachment is canonically hashed; its digest is explicitly approved for the exact release and recorded in prepared/certified B receipts. Bind to source/build/Hosting/placement fields instead of including its own containing candidate digest, avoiding a circular hash.

At prepare, certify and pre-enable observation, independently obtain the actual deployed ruleset resource and its exact source hash. Require target, release/build/Hosting/placement, local source hash, attachment digest and tested source hashes to match the approved record exactly. Require observed rulesetResource and observed sourceHash both equal approvedRulesetResource/approvedDeployedSourceHash, even when newly created Rules have identical bytes. In exact mode require localRulesSourceHash == approvedDeployedSourceHash as well. In reviewed-equivalent mode allow only that explicitly reviewed pair and passing report bound to their bytes. No normalization, comment stripping, source omission, hash-only assertion or old receipt can grant acceptance. Missing approval, failed/incomplete report, unknown version or different resource/hash/target/release refuses and requires fresh review; a stale record cannot bless new Rules.

General release behavior and old eight-endpoint receipt interpretation remain unchanged. B receipts have a distinct versioned comparison claim containing the approval digest and exact observed Rules state. Add this contract to backend-state, prepare/certify/predeploy comparison and the operator's pre-enable evidence check. Test wrong ruleset with same hash, changed hash, wrong local source/target/build, tampered report/attachment, incomplete denial matrix, old receipt and equivalence used without explicit approval. Do not deploy Rules solely to produce equal hashes; actual necessary Rules changes remain separately authorized.

## H. Staging discrepancies and resolution

Saved Operation 1J is evidence from October 25, not a fresh acceptance read.

| Finding | Classification | Minimum resolution / release gate |
|---|---|---|
| Eight management builds `22cc00d2f5cea8aa321e84ea007f346bf25f5cb8`; older Capabilities `060bec7d7db965fad0e5bee871fdda38b21a931b`, dirty=true | Genuine release-coherence blocker | Deploy/verify all nine from one reviewed clean build while closed. Observe active revision, entry point, source/build ID, contract, placement and traffic. Capabilities cannot be omitted. |
| Different Rules hash (`d987...a8001` deployed, `35f0...de35` local) | Source/record discrepancy; no demonstrated access opening | Operation 2A's saved-source diff found only absent explicit Teacher Units/receipt deny blocks, with terminal default deny retained. Apply G6 exact ruleset/hash plus reviewed-equivalence approval and focused denial report, including owner/admin, history/config and collection-group cases. The B release gate must bind that approved deployed state instead of falling through to the old local-hash-only gate. No Rules deployment solely to match hashes. Any unrelated or access-broadening drift blocks acceptance. |
| Normalized indexes equal (`af9f156b...0262`), zero composite indexes, three field overrides READY | No identified index blocker | Reconfirm relevant query/index behavior at staging acceptance. No new receipt TTL or index deployment proposed. |
| All nine Run services rejected for present `service.buildConfig` | Strict evidence-tool limitation | Review actual field meaning and code-loading/build configuration against approved operational plan; add narrowly reviewed normalizer support/fixtures or use independently reviewed equivalent observation. Do not strip unknown fields or pretend S4 passed. Unsafe unreviewed configuration still blocks. |
| Automatic runtime updates | Observed operational policy, not an application bypass | Proposed B default accepts provider-managed patch updates, records actual base image/update mode, and requires smoke/error review on material runtime drift. Build identity covers application bytes, not unchanged image forever. Any mandatory `on-deploy` requirement is superseded by explicit owner acceptance in ADR; no update-policy change now. |
| Public Run invoker + unrestricted ingress | Transport exposure; not proof of data access | Observe Function and Run policies, test unauthenticated/role/tenant rejection on actual callable routes, review direct/tagged/custom routes and abuse posture. Public transport may be appropriate for callable authentication; do not grant new invoker rights without authorization. |
| Default Compute runtime/build identity; unverified effective rights | Genuine unresolved security gate | Enumerate relevant inherited IAM, roles, impersonation, actAs, deploy/route and data permissions. Record holders/blast radius. Reduce only demonstrably excessive rights under separate IAM authorization; dedicated identity is conditional, not assumed required or sufficient. |
| Existing project-wide Admin SDK Token Creator and indirect impersonation paths | Accepted earlier observer residual, not blanket B production approval | Re-evaluate against the actual runtime/operator/deployer boundary. Do not claim exclusive human policy authority or re-use removed observer grants. Missing effective permission evidence blocks enable. |
| Inherited IAM, routing, domain mappings/NEGs/backend services not observed | Evidence gap | Obtain bounded authorized visibility or record specific owner-approved exception with concrete risk. Do not mark absent evidence as safe. Unreviewed routes to incompatible serving code block enable. |
| Bytewise response inconsistencies on Capabilities/List/Update, parsed JSON equal | Serialization sensitivity, not observed semantic drift | Compare normalized meaningful fields while preserving array order and unknown fields; retain raw transcript. Distinguish semantic changes from key ordering. |
| Hosting bytes and authenticated callable/UI checks pending | Genuine acceptance gap | Certify both actual sites with existing release verifier; use selected canonical active teacher for real create/replay/read/update/archive/restore/resources/order, closure and rollback tests. Include focused student/assignment/Results regression. |

Old staging policy migration: under separate staging authorization close schema 1 marker availability first; verify old endpoints refuse. Deploy all nine B endpoints, which refuse legacy schema. CAS recover to fresh schema 2 closed instance with recorded before-state, then prepare. Deploy policy-capable Hosting and verify while closed. Only staging acceptance authorization may permit a staging enable/close rehearsal. Leave staging closed at completion unless the owner specifically directs otherwise. Existing units/receipts/audits stay intact.

## I. Planned verification matrix and certification scope

Historical Operation 2C planning scope: no tests ran in that operation. B1 implementation evidence is recorded separately in the B1h handoff; source/history review does not certify replacement code. Reuse prior certification only when source/dependency hashes and assumptions remain applicable. Operation 1C PASS combines unchanged Operation 1B evidence with formerly blocked checks; do not report the old INCONCLUSIVE status as current. S6f PASS certifies discovery, not the new policy.

| Verification | Minimum cases and expected result | Existing evidence/tests reused versus new work |
|---|---|---|
| Authentication/role | Signed-out; student; platform admin; missing canonical user; unverified/inactive/suspended/archived teacher, all nine endpoints | Reuse `teacher-units.test.ts`/Capabilities/domain assertions; rerun against new wiring, no role expansion |
| Claims/school/district | Missing/stale claims, same-UID transfer, school deletion/district removal/reassignment; change between precheck and transaction/retry/response | Retain real emulator authorization race cases and original expectedSchoolId behavior |
| Ownership | Cross-owner, school and district get/list/mutation/replay; uniform not-found, no foreign projections | Existing domain and Rules assertions, new enabled-B fixtures |
| Direct access | Unit and receipt get/list/create/update/delete, collection-group, policy/history/audit get/list/write denied to all client roles | Reuse Rules matrix, focused history path additions; run against saved deployed source as well as repository source |
| Schemas/resources | Unknown owner fields; malformed IDs/limits/text, nonplaceable/unknown/retired IDs, duplicates, archive constraints | Existing certified domain vectors; only protocol fixture adaptation |
| Concurrency/no-op | Stale revision mutation, equal-result no-op; reorder versus edit/archive/create/restore; partial writes never | Existing hermetic/emulator tests retained; new policy-close/generation race around each path |
| Retries/idempotency | First attempt committed then SDK retry; create same-key race, different payload, school transfer; no second unit/audit | Keep domain assertions, replace synthetic verifier/evidence setup with real B policy; all six mutations exercised |
| Uncertain response | Lost response, committed then closed/suspended before response, malformed post-commit data, ambiguous commit both landed/not landed | Retain `responseUnavailable` and reconciliation assertions; server never labels transaction refusal proven precommit; client no automatic resend |
| Policy failures | Missing, closed, wrong schema/target/unknown fields/timestamps; read unavailable/retryable, no last-good fallback | Rewrite old signed-evidence enforcement cases to schema 2 matrix; every management endpoint incl. no-op/replay |
| Build/profile | Wrong approved ID, dirty/policy-controlled mismatch, stale/missing/tampered build record, bad source/target, closed-only under enabled policy | Rewrite artifact/profile tests and new policy cases; no env-based build authority |
| Policy generation | Old instance/generation/build, delayed discovery, same generation altered build, close then re-enable, exhausted generation/recovery including enabled MAX remaining enabled until verified recovery | New exact-equality and CAS races; separately document privileged whole-state restore limitation |
| Placement | Browser/policy/runtime mismatch, actual catalog order change, only Functions or only Hosting updated | Existing parity vectors reused; new B eligibility and compiled intent integration |
| Capabilities | Schema 3 response declaration matrix, actual build report, nonce/caller/origin/deadline/token changes, old schema 2 refused | Add active v3 protocol vectors; preserve historical v2 vectors and rewrite active factory fixtures; retain security/lifetime assertions and mirrored-module parity |
| Cached clients | Permit minted before close, already-open panel, next list/get/mutation after close, pending write, visibility refresh, v2 bundle | New lifecycle/shutdown integration; preserve pending intents and accurate uncertainty |
| Operator | Identity spoof label, wrong project/emulator, stale confirmation/updateTime, enable/close race, duplicate transition ID, unknown commit, history create failure | New availability-control fake + real Firestore emulator cases; policy/history/canonical audit atomic and no silent enable rebase |
| Audit | Unit/receipt/audit atomic; policy/history/canonical audit atomic; concrete equal commit timestamps; history collision; attributed reason/approval | Reuse domain atomicity evidence; new operator-event tests. Do not claim history tamper-proof against Admin writers |
| Partial rollout | Eight new plus old Capabilities, old tagged revision, wrong client/new backend and reverse, one Hosting site fails | New nine-endpoint release fixtures/rehearsal; fresh prepared evidence invalid on mismatch; availability remains closed |
| Rollback | Close first, restore known-good closed backend and pair, old cached client attempts, new instance/generation before any re-enable | Existing pair rollback tests reused; B closed backend recovery rehearsal newly required |
| Production closure | General build no seam/discovery, missing/closed policy refuses all management even policy-capable bundle; no automatic enable during certify | Existing closed tests plus B compiled profile and operator-negative tests |
| Existing LyfeLabz regression | Curriculum Results/Class Results, Assign/Preview, student My Science/deep links, assessment/answer-key boundary and other general release paths | Reuse Release 1 evidence for unchanged code; targeted affected integration smoke; mandatory release prepare gates still apply |

For local implementation, run focused changed-policy/wiring/client/CAS suites and necessary typecheck/lint/build/emulator checks sequentially with at most two workers. Do not re-run crypto ceremonies or every historical independent slice. An independent reviewer must examine replacement authorization/availability and the compiled graph, not merely observe green fixtures.

Before external deployment, run the repository-required affected package and Hosting prepare gates for the exact release candidate. Reuse unchanged test results by hash where permitted, but do not bypass existing required `prepare` checks to save time. Full application suites are prohibited in this planning operation; later authorized implementation/release operations may require their normal gates. No concurrent builds, redundant servers or unrelated process termination.

## J. Bounded implementation sequence

This is a proposed sequence, not authorization to execute it. Each operation ends with reviewable evidence and preserves unrelated local work. Owner commit/push gates remain separate; a production clean release commit must exist before deployment.

### B1. Local implementation phase: eight bounded batches

B1a-B1h are implementation batches within one local phase, not permission to deploy and not new independent-certification stages. Each batch requires **separate explicit owner authorization** before execution, unless a later owner instruction explicitly authorizes a named group. Operation 2C authorizes none of them. No batch may use cloud resources, change IAM or policies, deploy, activate, commit or push. Run necessary local tests/builds sequentially with at most two workers; no servers unrelated to a batch are started or terminated.

The exact expected manifests below are a scope contract, not claims that files already changed. B1a is a hard **three-new-file ceiling** with zero other edits. Later batches have concrete expected lists/counts; if investigation shows an additional required consumer, report and revise that batch manifest before expanding its scope. Do not hide fixture or configuration changes behind a directory-level entry. There is no instruction to modify an otherwise unchanged file merely to reach a count. Broad historical cleanup and test rewrites outside these lists are deferred. Existing tests listed under focused verification need not be modified.

| Batch | Goal | New | Modified | Expected total |
|---|---|---:|---:|---:|
| B1a | Unwired policy foundation | 3 | 0 | **3** |
| B1b | Versioned protocol, build and offline evidence adapters | 9 | 0 | **9** |
| B1c | Coherent backend and build-writer cutover | 0 | 22 | **22** |
| B1d | Narrow canonical external-operator audit contract | 0 | 6 | **6** |
| B1e | Operator CAS and recovery tooling | 3 | 2 | **5** |
| B1f | Shared capability lifecycle and all unit UI entry points | 2 | 16 | **18** |
| B1g | Release adapters, Rules approval and controlled compiler profiles | 4 | 15 | **19** |
| B1h | Canonical adoption and integrated local handoff | 0 | 12 | **12** |

Counts apply to each batch, not Operation 2C edits. Reconciled manifests total 94 batch entries and 91 distinct paths: B1g deliberately revisits three B1e operator files. B1a-B1g cover 79 distinct paths; B1h adds twelve documentation targets. B1c was reconciled to 22, B1f to 18 and B1g to 19 under separate owner authorizations. All B1 batches have now run locally; independent B2 review is next and requires separate authorization.

#### B1a. Unwired policy foundation

- **Exact goal/scope:** Implement D2 strict policy types/parser and pure initialize/prepare/enable/close/recoverClosed transition rules. Represent an already resolved runtime/build expectation as explicit pure input; no metadata, Firebase reads/writes, factories, callable imports, generated build output or client changes.
- **Dependencies:** Operation 2C finalized contract. No IAM, live credential, runtime account, automatic-update or staging decision is needed to implement these pure rules.
- **Security invariants:** I11-I13; active schema 2 only, default closed, no authority from labels, immutable target/instance except explicit closed recovery; no effect on I1-I10/I14-I15 because production is unwired.
- **Focused tests:** Run only the new policy suite through existing installed Functions Jest configuration with <=2 workers when B1a is separately authorized. Cases: full D2 shape/state/chronology, wrong target/version/legacy marker, immutable bindings, no-op, enabled MAX-1 close to MAX, enabled MAX close refusal, closed MAX no-op, invalid unsafe numbers, fresh-instance closed recovery and stale expected-state refusal. Pure vectors use concrete SDK Timestamps; server-sentinel planning/commit validation is separate. No fixture represents itself as provider-certified.
- **Completion criteria:** Exactly three new files, no edits elsewhere. Module may import stable generic validators/types and SDK Timestamp but performs no I/O and is imported by no existing runtime module. Existing callable exports, verifier wiring, build writer, app and compiler remain byte-identical. Preserve the existing tree; STOP uncommitted. Real CAS/SDK races are not claimed tested by this pure batch.
- **Authorization:** separate owner implementation authorization required; no external execution authority.
- **Expected files:** 3 new + 0 modified = **3**.

New files:

- `platform/functions/src/teacherUnits/availability-policy.ts`
- `platform/functions/src/teacherUnits/availability-policy.test.ts`
- `fixtures/teacher-units-option-b/v1.json`

#### B1b. Versioned protocol, build and offline evidence adapters

- **Exact goal/scope:** Add active v3 standalone protocol/parity, schema 2 runtime-build parser/ID and explicit offline B evidence adapter, without switching current callers or writer. Reuse frozen raw inventory/canonical helpers. Keep old parsers/fixtures and S6f dependency behavior unchanged.
- **Dependencies:** B1a complete. G5 is the adapter boundary; new modules are unwired, so temporary old production wiring remains coherent.
- **Security invariants:** I12-I13,I15; no historical-format authorization fallback; no provider-authenticity claim from parsed records.
- **Focused tests:** New protocol parity and malformed/contradictory version/build/placement matrix; build ID/tamper/record-path/inventory vectors; explicit wrong-format refusal. Reuse targeted old protocol/artifact/surface/discovery replay tests by unchanged hashes, rerunning the boundary consumers if shared behavior is touched. No cloud calls or full-suite repetition.
- **Completion criteria:** All nine files new; active runtime still unchanged. Old schema 1/v2 inspection remains available and old replay outputs are unchanged; new adapter results are versioned and non-authorizing.
- **Authorization:** separate owner implementation authorization required; no external execution authority.
- **Expected files:** 9 new + 0 modified = **9**.

New files:

- `platform/functions/src/teacherUnits/availability-protocol.ts`
- `platform/functions/src/teacherUnits/availability-protocol.test.ts`
- `platform/functions/src/teacherUnits/availability-runtime-build.ts`
- `platform/functions/src/teacherUnits/availability-runtime-build.test.ts`
- `app/src/teacherUnits/availabilityProtocol.ts`
- `app/src/teacherUnits/availabilityProtocol.test.ts`
- `scripts/teacher-units-release/option-b-evidence.cjs`
- `scripts/teacher-units-release/option-b-evidence.test.cjs`
- `scripts/teacher-units-release/fixtures/synthetic-option-b.cjs`

#### B1c. Coherent backend and build-writer cutover

- **Exact goal/scope:** Switch all nine handlers and transaction prefix to B policy/new protocol/build adapter and remove verifier/evidence/provenance/marker imports from their authorization path. Switch writer to schema 2 at the same local cutover. Retain identity/destination behavior, stable callable names, domain receipts/hashes/errors and legacy parser modules. Do not alter tsconfig or delete packaged historical helpers.
- **Dependencies:** B1a and B1b complete. Client production gate remains false; no deployment or enabled policy writes are allowed. Do not distribute this intermediate candidate.
- **Security invariants:** I1-I15, especially every transaction retry/replay/no-op/response read, SDK retry identity, canonical ownership, school binding and uncertainty.
- **Focused tests:** Focused nine-endpoint policy/role/tenant matrix, real Firestore-emulator authorization/closure races, mutation idempotency and post-commit uncertainty; active/legacy format separation; compiled dependency and no-test-bypass audit; writer profile/stale-output/reproducibility tests; transport refusal tests. Necessary Functions typecheck/lint/build sequentially; no live metadata/cloud test.
- **Completion criteria:** All nine bind B enforcement; ordinary build remains closed-only; old or malformed policy cannot authorize; no always-success verifier; new wire versions consistent. Existing UI remains compiled closed and legacy evidence inspection still works. Source/test-only state is not independent certification or deployment approval.
- **Authorization:** separate owner implementation authorization required; no external execution authority.
- **Expected files:** 0 new + 22 modified = **22**.

Modified files:

Owner-authorized manifest reconciliation: add only the current-production wiring assertions and directly dependent typing in `a3-composite-verifier.test.ts`; its historical cryptographic and negative tests remain intact. This avoids retaining obsolete production verifier wiring merely to satisfy historical assertions.

- `platform/functions/src/teacherUnits/a3-composite-verifier.test.ts`
- `platform/functions/src/teacherUnits/a3-enforcement.ts`
- `platform/functions/src/teacherUnits/teacher-unit-access.ts`
- `platform/functions/src/teacherUnits/teacher-unit-mutation.ts`
- `platform/functions/src/teacherUnits/teacher-units-create.ts`
- `platform/functions/src/teacherUnits/teacher-units-list.ts`
- `platform/functions/src/teacherUnits/teacher-units-get.ts`
- `platform/functions/src/teacherUnits/teacher-units-update.ts`
- `platform/functions/src/teacherUnits/teacher-units-archive.ts`
- `platform/functions/src/teacherUnits/teacher-units-restore.ts`
- `platform/functions/src/teacherUnits/teacher-units-set-resources.ts`
- `platform/functions/src/teacherUnits/teacher-units-reorder.ts`
- `platform/functions/src/teacherUnits/teacher-units-capabilities.ts`
- `platform/functions/scripts/write-a3-runtime-build.cjs`
- `platform/functions/src/teacherUnits/teacher-units.test.ts`
- `platform/functions/src/teacherUnits/teacher-units.emulator.test.ts`
- `platform/functions/src/teacherUnits/teacher-units-capabilities.test.ts`
- `platform/functions/src/teacherUnits/a3-enforcement-retry.test.ts`
- `platform/functions/src/teacherUnits/a3-test-support.test.ts`
- `platform/functions/src/teacherUnits/a3-runtime-build-profile.test.ts`
- `platform/functions/scripts/test-capabilities-transport.cjs`
- `platform/functions/scripts/teacher-units-capabilities-transport.test.cjs`

#### B1d. Narrow canonical external-operator audit contract

- **Exact goal/scope:** Implement only owner-planning-approved F2 operator action/target iff restriction, exact payload validation and global-context exception through the existing canonical builder. Record the narrow schema change in audit/data/security docs. No user Role/claims/IAM expansion.
- **Dependencies:** B1a-B1c complete; separate implementation authorization is still required despite Operation 2C planning approval.
- **Security invariants:** I1-I2,I9,I14-I15; existing teacher/student school context and existing system behavior unchanged; no alternate audit sink.
- **Focused tests:** Focused writer tuple/payload negatives and user/system unchanged behavior. Reuse unchanged targeted assignments-publish, assignments-update-draft, classes-activate, assessment-attempts-finalize and Teacher Units domain audit suites; assessment-lesson-summary read-contract regression for Release 1. Do not edit those consumer tests just to add mirrored coverage.
- **Completion criteria:** Exactly six expected modified files. New exception is impossible for another action/target, cannot omit required payload fields or invent a user school, and cannot weaken pre-existing audit validation. No operator tool or policy write is executed.
- **Authorization:** separate owner implementation authorization required; no external execution authority.
- **Expected files:** 0 new + 6 modified = **6**.

Modified files:

- `platform/functions/src/shared/types/audit-event.ts`
- `platform/functions/src/shared/audit/write-audit-event.ts`
- `platform/functions/src/shared/audit/write-audit-event.test.ts`
- `platform/functions/src/shared/audit/README.md`
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md`
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md`

#### B1e. Operator CAS and recovery tooling

- **Exact goal/scope:** Implement explicit-project dry-run/show/prepare/enable/close/verify/recoverClosed command surface, verified credential-context checks, exact stale-CAS/command-ID reconciliation, and atomic policy+history+canonical audit. Route new commands explicitly; keep legacy routes labeled and isolated. Live writes require later external authorization and explicit execute/confirmation; development runs only fakes/demo emulator.
- **Dependencies:** B1a-B1d complete. B1g later supplies the reviewed current-release evidence producer; until then enable tests use labeled synthetic evidence and no real release is eligible operationally.
- **Security invariants:** I9-I13,I15; enabled MAX is still enabled until authorized recovery commits; closure independent of evidence chain; no silent enable rebase or duplicate audit.
- **Focused tests:** Fake credentials/target-spoof/dry-run tests and Firestore emulator transactions: close/enable/recovery contention, malformed/legacy repair, MAX boundary, audit/history failures atomic, lost commit/replay, stale updateTime, same command ID conflicting intent, committed-superseded verification. Negative cloud/project tests do not contact providers.
- **Completion criteria:** Exactly five expected files (3 new, 2 modified). Commands print truthful current/unconfirmed state; legacy close remains usable against retained old modules; new enable never calls legacy graph or markers. No credentials or cloud writes occur during implementation.
- **Authorization:** separate owner implementation authorization required; no external execution authority.
- **Expected files:** 3 new + 2 modified = **5**.

New files:

- `scripts/teacher-units-release/availability-control.cjs`
- `scripts/teacher-units-release/availability-control.test.cjs`
- `scripts/teacher-units-release/availability-control.emulator.test.cjs`

Modified files:

- `scripts/teacher-units-release/cli.cjs`
- `scripts/teacher-units-release/cli.test.cjs`

#### B1f. Shared capability lifecycle and all unit UI entry points

- **Exact goal/scope:** Implement E4 one bootstrap-scoped capability service, v3 adapter imports, ordered refresh/invalidation/expiry and all consumers. Curriculum-first integration is mandatory. Keep fresh single-use discovery per mutation and all existing durable/pending reconciliation. Compiler source/general gate remains closed; positive tests use existing test substitution, not a production override.
- **Dependencies:** B1a-B1e complete, particularly backend protocol and retained audit/domain behavior. New standalone client protocol from B1b is used; old mirrored protocol stays historical.
- **Security invariants:** I8,I10-I14; no enabled action from unknown/stale/unavailable, no shared mutation permit, no automatic resend; existing Results/Assign/student behavior independent.
- **Focused tests:** All E4 lifecycle/state/sequence/epoch/expiry and Curriculum-first cases; pending/lost outcomes and school transfer; adapter transport/session/nonce/deadline/single-use checks; targeted shell/selection/Results regressions. Existing app typecheck/lint as needed, sequential <=2 workers.
- **Completion criteria:** Exactly eighteen expected files (2 new, 16 modified). Every unit consumer uses the same state; stale responses cannot re-enable; disposal is correct; backend remains authority; general compiler output remains closed pending explicit B1g profile support.
- **Authorization:** separate owner implementation authorization required; no external execution authority.
- **Expected files:** 2 new + 16 modified = **18**.

New files:

- `app/src/teacherUnits/capabilityState.ts`
- `app/src/teacherUnits/capabilityState.test.ts`

Modified files:

- `app/src/teacherUnits/backendCompatibility.ts`
- `app/src/teacherUnits/backendCompatibility.test.ts`
- `app/src/teacherUnits/wire.ts`
- `app/src/teacherUnits/wire.test.ts`
- `app/src/teacherUnits/releaseBoundary.ts`
- `app/src/index.ts`
- `app/src/teacherUnits/unitsController.ts`
- `app/src/shell/surfaces/myUnits.ts`
- `app/src/shell/surfaces/teacherUnitsPanel.ts`
- `app/src/shell/surfaces/curriculum.ts`
- `app/src/shell/shell.my-units.test.ts`
- `app/src/shell/myUnits.modernization.test.ts`
- `app/src/shell/surfaces/curriculum.teacher-units.test.ts`
- `app/src/shell/surfaces/curriculum.add-to-unit.test.ts`

Owner-authorized manifest reconciliation adds the two active v3 test-fixture files below without relaxing runtime compatibility. Regression coverage must verify that removing Curriculum disposes its open Add to Unit dialog and subscriptions, including late asynchronous callbacks.

- `app/src/teacherUnits/createAttempt.reconciliation.test.ts`
- `app/src/teacherUnits/unitColor.test.ts`

#### B1g. Release adapters, Rules approval and controlled compiler profiles

- **Exact goal/scope:** Add explicit B nine-endpoint/config/build observation adapter and G6 exact approved Rules comparison/receipt binding. Add target/origin-bound policy-capable teacher-units compiler intent, preserving general closure and paired Hosting/rollback gates. Add credential-free CI checks and only focused new policy/history Rules tests, with no Rules source/index/config edit. All provider exchanges are supplied fixtures locally.
- **Dependencies:** B1a-B1f complete. Freeze old eight-endpoint/hash-only comparison and S6f legacy helpers; new B receipt kind selects new comparator, never a permissive generic bypass. Actual deployed Rules approval/report is collected only in authorized B3/B4.
- **Security invariants:** I5,I11-I15; no mixed nine-endpoint acceptance, unapproved Rules, source/version mismatch, wrong-origin opening or implicit enable. General and Release 1 release tooling remain protected.
- **Focused tests:** G6 complete record/hash/resource/test-evidence negative matrix; real saved provider-shaped buildConfig/automatic updates via fixtures; old transcript replay with unchanged bytes; legacy evidence and general release regression; compiler closed/policy-capable/source-tamper/target cases; pair/partial rollback; focused denied get/list/write/history tests. Required local release-gate tests run sequentially; no prepare/certify command is allowed to contact cloud during this batch.
- **Completion criteria:** Exactly nineteen expected files (4 new, 15 modified). Source false/general closed retained; only explicit controlled profile can construct policy-capable UI, still gated by backend. B tooling requires actual approved nine-endpoint/Rules/Hosting state, old replay is preserved, no cloud action or new infrastructure.
- **Authorization:** separate owner implementation authorization required; no external execution authority.
- **Expected files:** 4 new + 15 modified = **19**.

New files:

- `scripts/teacher-units-release/option-b-observation.cjs`
- `scripts/teacher-units-release/option-b-observation.test.cjs`
- `scripts/teacher-units-release/option-b-rules-evidence.cjs`
- `scripts/teacher-units-release/option-b-rules-evidence.test.cjs`

Modified files:

- `app/scripts/build-application.cjs`
- `app/scripts/build-application.test.js`
- `app/src/teacherUnits/releaseAvailability.test.ts`
- `scripts/hosting-release/backend-state.cjs`
- `scripts/hosting-release/backend-state.test.cjs`
- `scripts/hosting-release/prepare.cjs`
- `scripts/hosting-release/certify.cjs`
- `scripts/hosting-release/build-pair.cjs`
- `scripts/hosting-release/release.cjs`
- `scripts/hosting-release/release.test.cjs`
- `.github/workflows/platform-ci.yml`
- `platform/firebase/tests/teacher-units.rules.test.ts`

Owner-authorized reconciliation adds the existing B1e operator files to connect G6/current-release validation. A read-only pre-enable check validates current release, Rules, policy instance/generation and operator context; real-project enable remains explicitly interlocked pending independent review and separate release authorization. Tests must reject missing/stale/contradictory/legacy/synthetic production evidence, verify mocked valid preflight without persistence, and prove that no flag or environment variable removes the interlock.

- `scripts/teacher-units-release/availability-control.cjs`
- `scripts/teacher-units-release/availability-control.test.cjs`
- `scripts/teacher-units-release/availability-control.emulator.test.cjs`

#### B1h. Canonical adoption and integrated local handoff

- **Exact goal/scope:** Update active canonical routing/supersession/status, preserve historical bodies/evidence, reconcile dirty CURRENT_PLATFORM_STATE without overwriting other work, and record local integrated diff/test/hash evidence inside the two planning docs. No source cleanup or deletion of historical modules.
- **Dependencies:** B1a-B1g complete. All actual changes/hashes and focused results available; review source/dependency changes before reusing earlier evidence.
- **Security invariants:** I1-I15; truthful current-versus-historical status; no deployment/activation inferred from local completion.
- **Focused tests:** Documentation links/manifest/status checks and integrated critical policy/client/CAS/legacy-replay/closed-artifact verification; reuse per-batch passing results by hash, rerun only changed assumptions. Independent B2 is still required; no independent per-batch certification ladder.
- **Completion criteria:** Exactly twelve expected modified docs and no code changes in this batch. Local mechanism is coherent and documented, production remains closed, full manifest and known residuals are ready for one independent B2 review. STOP uncommitted; owner commit/push gates remain separate.
- **Authorization:** separate owner implementation authorization required; no external execution authority.
- **Expected files:** 0 new + 12 modified = **12**.

Modified files:

- `docs/platform/TEACHER_UNITS.md`
- `docs/platform/CURRENT_PLATFORM_STATE.md`
- `docs/platform/U2_6_RELEASE_READINESS_RUNBOOK.md`
- `docs/platform/DOMAIN_AND_HOSTING_CONTRACT.md`
- `docs/platform/U2_6_A3_CONTRACTS.md`
- `docs/platform/U2_6_A3_2_RUNTIME_PROVENANCE.md`
- `docs/platform/U2_6_A3_3_APPROVED_DECISIONS.md`
- `docs/platform/U2_6_A3_3_ENFORCEMENT.md`
- `docs/platform/U2_6_A3_6_DECISION_RECORD.md`
- `docs/platform/TEACHER_UNITS_STAGING_UX_TEST_DESIGN.md`
- `docs/platform/MY_UNITS_OPTION_B_IMPLEMENTATION_BLUEPRINT.md`
- `docs/platform/ADR_MY_UNITS_OPTION_B_TRUSTED_OPERATOR_AVAILABILITY.md`

### B2. Independent security review and focused correction verification

- **Goal:** independently accept changed trust enforcement and replacement release path.
- **Exact scope:** review B1 diff and evidence, reproduce high-risk failures/races using actual handlers/emulator/CAS; assess compiled imports and unchanged evidence reuse. No deployment or cloud mutation.
- **Files/modules:** G modified/new modules and I critical test cases; review report; bounded corrective diffs only under implementation authorization.
- **Dependencies:** complete B1 candidate, exact source/dependency hashes and reviewer independent of its implementation conclusions.
- **Focused tests:** auth/tenant/Rules, policy failure, close race, all mutation retries/no-ops/replays, post-commit uncertainty, client lifetime, operator stale-CAS and partial deployment. Do not independently recertify unused signature machinery.
- **Completion:** no unresolved material security findings; explicit accepted residuals and runtime/IAM permission plan; review tied to exact candidate. Corrections receive targeted review, not a restarted historical certification ladder.
- **Security gate:** no reliance on unverified schema shortcuts, trusted CLI labels or client authority.
- **Separate owner authorization:** **yes** to start independent review and any corrections outside B1 scope; review PASS grants no deployment authority.

### B3. Staging deployment, drift reconciliation and acceptance

- **Goal:** demonstrate B on real staging with the exact intended release and safe shutdown/recovery.
- **Exact scope:** authorized staging reads; close legacy marker; deploy all nine Functions closed; recover/prepare schema 2 closed policy; deploy/certify paired policy-capable Hosting; authorized staging enable/test/close/rollback rehearsal; resolve H evidence. Rules only if semantic comparison proves a required separately approved change. No production access.
- **Files/modules:** no planned app redesign; G release/observer/operator tools, staging release/acceptance report, any separately reviewed remediation.
- **Dependencies:** B2 accepted candidate; owner-selected existing teacher; clean commit/build; sufficient reviewed access. Any IAM remediation has its own exact approval, not an implied part of this step.
- **Focused tests:** real authenticated all-nine operations and negative callers, two-tab conflicts, current teacher revocation, cached close/generation/build mismatch, lost-response recovery, actual served bytes, route/traffic/permission evidence, pair and closed-backend rollback. Accessibility/screen-reader checks previously pending remain product acceptance items.
- **Completion:** nine active compatible builds, reviewed permissions/routes, effective Rules denial, matching placement/index behavior, served Hosting pair verified, concrete audit attribution, successful closure and rollback. Staging left closed unless explicitly otherwise directed.
- **Security gate:** no mixed Capabilities, unexplained config or unresolved material IAM/routing gap, no staging marker eligibility in B.
- **Separate owner authorization:** **yes**, enumerating staging policy/data writes, exact Functions and Hosting scopes and any invocation/IAM effect. Authenticated acceptance writes real staging units/audits, which are retained.

### B4. Production preparation and closed deployment

- **Goal:** establish a verified recoverable production candidate with My Units unavailable.
- **Exact scope:** separately authorized production read-only preflight, effective IAM/routing review, current rollback baselines, exact nine-endpoint scoped deploy from clean expected-SHA policy-controlled build, paired policy-capable Hosting preparation/deploy/certify, and only authorized closed policy initialize/prepare. No enable.
- **Files/modules:** G release tools/operator; new production closed-release record; no unrelated Functions, Rules, indexes, Storage, OAuth or data migrations.
- **Dependencies:** B3 acceptance and B2 findings resolved, owner-created reviewed release commit, exact production permission/deployment authorization, actual baseline refresh. Release 1 is historical, not proof current provider state still matches.
- **Focused tests:** closed production management denial on every endpoint, authenticated closed Capabilities, actual target/build/contract/placement/profile/revisions/traffic, actual paired served bytes and existing-feature smoke, rollback availability. Required prepare/package checks run for candidate once.
- **Completion:** closed policy readback verified, nine eligible-but-closed backends observed, pair certified, no unintended invoker/IAM/config drift, known-good closed backend artifact/revisions retained, production activation approval packet ready.
- **Security gate:** the new first-launch closed backend is recoverable. There is no earlier production Teacher Units release to roll back to. A Hosting rollback alone is insufficient.
- **Separate owner authorization:** **yes**, scoped production reads, nine Functions creation/update including any public invoker grants, both Hosting targets and closed policy/history writes. Any IAM/Rules change is separately explicit. STOP before activation.

### B5. Explicit final activation and bounded acceptance

- **Goal:** activate the already verified exact release, then verify actual behavior.
- **Exact scope:** one audited enable CAS for exact production instance/expected generation/build/placement/contract and named approval; fresh nine-endpoint/Hosting observation; owner-selected teacher smoke; audit/error observation; immediate authorized close on acceptance failure. No new build or deployment in this step.
- **Files/modules:** availability-control tool and new activation/acceptance record.
- **Dependencies:** B4 closed acceptance, current five-minute observations, reviewed blast radius, explicit owner activation approval. If any build/policy/target changes, return to preparation rather than rebase approval.
- **Focused tests:** real allowed teacher actions, audit correctness, negative role/tenant samples, no unrelated feature regression. Previously rehearsed rollback is available; do not invent a new untested shutdown during launch.
- **Completion:** policy/event concrete readback and accepted teacher behavior recorded; or close confirmed and incident/uncertain writes reconciled. Report exact current state, not just command exit 0.
- **Security gate:** activation is separate from deployment/certify. No self-approval or automatic enable in earlier operations.
- **Separate owner authorization:** **yes**, exact final enable and bounded production data smoke, including explicit failure-close authority. Absence of that authority keeps production closed.

### Rollback model for B3-B5

1. Close availability using the operator CAS without release-evidence dependencies; read back and confirm all serving compatible B endpoints deny management. A race requires a new deliberate close CAS, not automatic enable retry.
2. Preserve unit records, receipts and audits. Reconcile uncertain intents after service recovery; do not compensate by deleting data.
3. Restore the last verified compatible closed Functions build across nine endpoints, or keep the current verified build closed. Observe all routes/traffic. Do not route an obsolete schema 1 marker build during B recovery.
4. Restore both Hosting sites to their recorded pre-release certified pair. For first production launch the current Release 1 pair is a potential closed-UI fallback, refreshed/recorded at B4; the previous Release 1 rollback pair is not automatically the My Units launch baseline.
5. Verify closure with cached clients and actual denied operations. Re-enable only after fresh acceptance and new owner approval; generations never rewind, and recovery changes instance if monotonic state cannot be preserved.

## K. Remaining risks and unresolved decisions

| Item | Proposed resolution / when decision is required |
|---|---|
| Trusted writers can bypass approval, rewrite policy/data/history; deployers can bypass code | Owner accepted boundary. Record actual holders/effective scope before grants/activation; no crypto-equivalence claim. |
| Detailed schema/protocol tokens and build derivation | Implemented locally in B1a/B1b/B1c. Review exact bytes and negative cases in B2; external deployment/acceptance remains unauthorized. |
| Narrow operator audit extension | B1d implemented the exact F2 operator tuple/payload through the canonical writer; B1e/B1g integrate atomic CAS and preflight. No teacher/student role exception. Independent review remains pending. |
| IAM granularity and actual required SDK permissions | Confirm F3 permissions against actual APIs and target hierarchy. Database-wide scope may be the narrowest feasible; owner must accept concrete scope or authorize remediation before external use. |
| Dedicated runtime account versus reviewed shared/default account | Conditional on effective-permission evidence. Do not assume existing broad grants acceptable or require new identities solely for architectural symmetry. |
| Automatic base-image patching | Proposed accepted B operating posture; record and monitor actual updates. No promise that application digest attests full image forever. Owner may instead require separately scoped deployment-policy work. |
| Inherited routing/IAM/impersonation and provider buildConfig | Must be resolved at B3/B4; tool limitations cannot be turned into passing evidence. |
| Authenticated Hosting/callable/UX/accessibility acceptance | Still pending. Real canonical teacher identity chosen by owner; no automatic role/claims/account creation. |
| Database outage | Fails closed but operator cannot confirm a close write during outage. Recover known-good enforcement and reconcile; no availability promise during unreadable config. |
| SDK retry/response races | Existing uncertainty model retained. Requests serialized before closure and previously returned data cannot be recalled. |
| Policy history retention and provider audit coverage | Retain existing private release storage and append-only application events; no new bucket/retention lock implied. Operational owner chooses durable existing archive/location and verifies provider audit availability before launch. |
| Historical docs and unavailable original specification | B1h routes active guidance to Option B and labels retained historical bodies. Do not imply the unrecovered original A3 specification was read. |
| Unrelated dirty changes | Must be preserved and excluded/reconciled for clean candidate. Never ship them accidentally to achieve My Units release. |

## L. Historical Operation 2C documentation result and readiness record

Exactly **two new repository files** are proposed by Operation 2B:

1. `docs/platform/MY_UNITS_OPTION_B_IMPLEMENTATION_BLUEPRINT.md` (this complete blueprint).
2. `docs/platform/ADR_MY_UNITS_OPTION_B_TRUSTED_OPERATOR_AVAILABILITY.md` (proposed decision and supersession map).

Operation 2B created these two documents without changing existing repository files. Operation 2C updates only these two planning files in place; they remain untracked/uncommitted at this baseline. The 14 pre-existing modified tracked files remain unchanged. Existing canonical documents are listed for later scoped adoption; their historical/current status is not silently rewritten now.

Historical Operation 2B validation included local source/evidence inspection and the Operation 1J manifest rehash. Operation 2C validation is local source/review reconciliation, documentation manifest/link/consistency checks and before/after repository file hashes; no fresh evidence certification is claimed. No application test suite or build was run because the deliverable is planning-only.

Operation 2C corrected A/B status/baseline and D1-D3 parser/build and optional-scope decisions; D4/F2 generation-exhaustion recovery; E2-E4 active protocol and all-consumer capability lifecycle; F1-F2 operator command/audit contract; G1-G4 file dispositions plus new G5-G6 historical adapters and Rules approval; H/I migration/verification references; J bounded local manifests; K readiness; this L correction record; and the companion ADR. No implementation, fixture or test source was edited.

**Historical Operation 2C B1a readiness:** ready for separate implementation authorization at that planning baseline. There are no unresolved architectural decisions that block the three pure unwired files. Its schema/transition defaults, target grammars, MAX behavior, explicit recovery and fixture boundaries are fixed by D/F. External credential choice, actual IAM grants, deployed Rules equivalence approval, runtime update policy, authenticated acceptance and final activation decisions belong to later gates and must not be made prerequisites for B1a. If an implementation discoverably requires a fourth file, stop that batch and revise its manifest rather than silently expanding it.

**Historical Operation 2C recommendation (superseded by B1h handoff below):** separately authorize **B1a only**, the three new unwired files in J, using this corrected contract and a preserved baseline. No implementation begins on the strength of architecture selection alone. Leave all work uncommitted; no push, deployment, cloud write or activation.

## B1h integrated review handoff

### Candidate and review boundary

Prepared October 26, 2026 in `/Users/breezy/Documents/GitHub/lyfelabz`, `main`, HEAD `1b1089797b57bbc43b6fb8423dbcc61baeb2b4a6`, with the existing uncommitted B1 implementation and unrelated modifications preserved. The review subject is these exact working-tree bytes, not HEAD alone, not an isolated clean release commit and not the entire unrelated dirty diff. This package prepares the separately authorized independent Astra B2 review; it neither performs nor pre-accepts that review.

Read the [ADR](ADR_MY_UNITS_OPTION_B_TRUSTED_OPERATOR_AVAILABILITY.md), [current domain contract](TEACHER_UNITS.md), [supported operator/release workflow](U2_6_RELEASE_READINESS_RUNBOOK.md#current-option-b-operator-and-release-workflow), [paired Hosting contract](DOMAIN_AND_HOSTING_CONTRACT.md), and clearly labeled historical A3 records. G5 remains the active/historical import boundary. No source, test, Rules, CI or release-tool implementation changed during B1h.

### Batch traceability and entry points

| Batch / reconciled scope | Implementation and focused evidence | Retained invariants / remaining verification |
|---|---|---|
| B1a / 3 new | `availability-policy.ts`, its test, `fixtures/teacher-units-option-b/v1.json`: exact parsing, eligibility, transitions, CAS, MAX and explicit recovery | I11-I13/I15. Pure local validation cannot establish committed persistence, credentials or fleet state. Reproduce high-risk transition boundaries in B2. |
| B1b / 9 new | Active mirrored availability protocol, schema-2 runtime-build inspector, explicit offline B evidence adapter and fixtures | I12-I13. v3/schema-3 discovery/envelope-2, deterministic ID and placement; old readers remain separate. Actual packaged/deployed bytes still need external observation. |
| B1c / 22 modified | `a3-enforcement.ts`, all nine handlers, access/mutation prefix, schema-2 writer, policy/retry/transport and emulator fixtures | I1-I15. Uncached transactional authorization/availability including retries/replay/no-op/post-commit reads; source filename is historical, active enforcement is B. No live provider transport certification implied. |
| B1d / 6 modified | Canonical audit type/builder/writer/tests and scoped audit/data/security documentation | I1-I2/I9/I14-I15. Exact operator action/target/payload iff sentinel; no new user role or relaxed teacher/student context. Trusted Admin writers remain able to bypass it. |
| B1e / 5 paths, 3 revisited in B1g | `availability-control.cjs`, unit/emulator tests and CLI routing | I11-I13/I15. Verified credential/target, exact CAS, atomic policy/history/canonical audit, linked readback, uncertainty and explicit closed recovery. Effective real IAM/token profiles remain unverified. |
| B1f / 18 paths | `capabilityState.ts`, v3 adapters, bootstrap/seam/controllers, My Units/Curriculum/panels and reconciliation/color fixtures | I8/I10/I12-I14. All consumers share advisory state; expiry/epoch/sequence/context suppress old responses; fresh independent single-use mutation permits; pending intent preserved. Live authenticated/accessibility acceptance remains open. |
| B1g / 19 paths | Target-bound compiler, B observation/current-release/Rules adapters, operator preflight, explicit Hosting B candidate/receipt/predeploy routes, CI, Rules tests | I5/I11-I15. Nine coherent artifacts, exact approved deployed Rules state and paired Hosting, legacy replay unchanged, real enable interlocked. Actual provider shape/config/IAM/served bytes and release decisions remain external. |
| B1h / 12 docs | Current routing, scoped historical supersession, runbook, this inventory and handoff | Documentation/consistency checks only. No new independent certification or implementation authority. |

Exact per-batch paths are in J. The B1a-B1g union has 79 paths, including B1d's supporting documentation and three intentional operator-path overlaps between B1e/B1g. Six package/lock files below bind dependency inputs. Existing unrelated assignment/Results changes are not silently included in the My Units implementation scope; a future clean release candidate must explicitly reconcile/exclude them while preserving the certified production baseline.

### Security-sensitive seams and accepted assumptions

- Backend: `teacher-unit-access.ts`, `teacher-unit-mutation.ts`, create/reorder and response readers call the active `a3-enforcement.ts`. Review identity/destination resolution, two-pass artifact inventory, uncached policy checks and SDK retry ordering together; no request-time positive policy cache or signed-verifier success fallback exists.
- Client: `backendCompatibility.ts`, `wire.ts`, `capabilityState.ts`, bootstrap teardown and every Curriculum/My Units gate. Display lifetime is not a backend lease. The server remains final authority; retained data and earlier writes cannot be recalled.
- Operator: `availability-control.cjs` and canonical `write-audit-event.ts`. Pure policy validation does not authenticate operators. The supported direct-SA token/project/permission probe is distinct from release observation's selected gcloud read token. Exact audit attribution is derived from verified credentials; project-scope access review accepts concrete blast radius rather than promising collection-only IAM.
- Release: `option-b-observation.cjs`, `option-b-rules-evidence.cjs`, compiler and Hosting B dispatch. Configuration/Rules reports are trusted attributable review evidence, not independent cryptographic authority or exhaustive semantic proof. Unknown shapes refuse; synthetic fixtures do not establish actual provider compatibility.
- Database writers, deployers, traffic/IAM administrators and sufficiently privileged runtime identities are explicitly trusted. Their ability to rewrite policy/data/history or ship ignoring enforcement is accepted at the architecture level, subject to concrete effective-IAM/owner decisions. History is not tamper-proof against them. App roles gain no operator authority.

### Recorded focused results and limitations

These are prior local B1 results, not tests rerun by B1h and not independent review PASS. Counts from separate runs overlap and must not be summed into a coverage claim. Source/dependency hashes below identify the handoff candidate; logs are local observations, not cryptographic test attestations.

| Recorded run | Result and scope |
|---|---|
| B1e unit/CLI and local Firestore | 57 passed; 8 emulator cases passed before B1g additions. Original CAS/history/audit/uncertainty behavior retained. |
| B1f final focused client run | 329 passed across nine suites; final Add to Unit cleanup guard then passed all 40 targeted cases. App typecheck and targeted lint passed. |
| B1g compiler/closure run | 105 passed across compiler and releaseAvailability suites. Explicit target/origin, malformed metadata and general closure covered. |
| B1g final Node integration | 120 passed across observation/operator/backend-state/release. Includes strict unknown candidate metadata and valid mocked read-only preflight with no persistence. |
| B1g evidence/historical replay run | 167 passed, including B evidence/Rules and unchanged historical provider/capture/surface/discovery paths. No fresh cloud evidence. |
| B1g client regression run | 348 passed across nine protocol/lifecycle/adapter/My Units/Curriculum/Results suites. Synthetic/in-memory contexts, not real teacher acceptance. |
| B1g Rules emulator | 222 passed against repository Rules and a labeled local variant removing only explicit unit/receipt deny blocks while retaining default denial. This is not the actual deployed source or an approved deployed-equivalence report. |
| B1g operator emulator | 9 passed; atomic linked writes/races/rollback/readback/MAX/recovery and demo-only preflight boundaries. No cloud mutation. |
| B1g static/build checks | App and Rules typechecks, targeted JS/TS lint/syntax, CI YAML parse and diff checks passed. Actual default app compiled/independently verified `general` + `closed` + `not-certified`; actual default Functions build/inspection schema 2/v3 `closed-only`, dirty local source. These are not distributable clean-release artifacts or deployed fleet observations. |

B1a-B1d test entry points and assertions remain in the hashed manifests; B1h does not invent historical counts where a retained log is not cited. B2 should reproduce the security-critical seams/races and request original private evidence where needed, rather than recertify unused signing machinery or rely solely on a green count. Relevant log digests, where locally retained, are recorded below; `/tmp` logs are ephemeral and need an owner-selected existing durable private archive before release use. No new evidence-storage infrastructure is implied.

### Explicit questions for Astra

1. Do canonical authorization, database identity and policy/build checks remain in every management transaction attempt, replay/no-op and post-commit response read, including close versus retry races? Can any dispatched refusal incorrectly become proof of non-commit?
2. Does the exact direct-SA token/permission/access-review implementation establish its claimed subject and scope on real provider responses without widening unverifiable conditional grants? Which inherited writers/impersonators/deployers/runtime identities can bypass policy, and what concrete owner scope acceptance/remediation is required?
3. Can any active import, legacy schema/marker, compiled profile, historical receipt or runtime flag bypass B enforcement or lift the real-enable interlock? Keep historical standalone verification behavior distinct from active request authority.
4. Are single-use permits, display coalescing, epochs/sequences, non-regressing same-instance generations, token/school/bootstrap changes, expiry and dialog/bootstrap teardown safe against delayed enabled responses and lost writes? Do Assign/Results/student authorities remain independent?
5. Are exact CAS, command UUID idempotency, three-way atomic audit/history/policy writes, private malformed-state snapshots and enabled-MAX recovery truthful under contention, failed commits and unavailable readback? Does every closure claim remain policy-scoped until actual fleet verification?
6. Does G6 bind exact deployed resource and both byte hashes, report/attachment digests, complete dual-source denial results and full-diff review at prepare/certify/predeploy/preflight? Could source/resource/report substitution or an incomplete matrix become equivalence approval?
7. Does the strict nine-endpoint provider/configuration normalizer accept the actual saved/live provider shapes only under reviewed configuration, safely treating automatic patches, Run buildConfig, routes and old revisions? What remaining observation limits must block acceptance rather than become defaults?
8. Do clean target-bound compiler reconstruction, actual schema-2 build derivation, paired Hosting bytes, fresh evidence/rollback baselines and partial-deployment recovery protect Release 1? Specify the bounded reviewed source change and external gates needed before real enable could ever be operational; this handoff authorizes neither.

### External gates and stop state

B2 independent review is next, not begun. Material findings require separately authorized bounded corrections and focused re-review. Then separately authorize staging provider/IAM/impersonation/routing/actual Rules/report approval, nine-endpoint closed deployment/migration, paired served-byte and authenticated/accessibility acceptance. Provider shape support and token verification must be tested against actual authorized observations; synthetic assertions are not evidence of current IAM or deployed Rules safety.

The exact named operator, effective permission plan, durable private evidence location, current baseline/rollback pair and provider runtime-update acceptance still need concrete owner decisions. New grants/accounts or Rules/index changes are conditional, separately authorized remediation, never automatic prerequisites or hidden side effects. Production preparation/deployment must be a reviewed clean exact candidate, scoped Functions and both Hosting sites, while closed. Final activation and production availability/fleet verification remain separate gates. Real enable is still blocked in source; any later interlock change itself requires implementation authorization and independent review before an activation decision can be executed.

B1h leaves all changes uncommitted. No cloud read/write, IAM change, deployment, activation, commit, push, application/emulator suite or independent Astra review ran during this documentation operation.

### Exact implementation and dependency byte inventory

SHA-256 values below cover the 79 distinct B1a-B1g manifest paths plus six package/lock files. Aggregate SHA-256 is `242630e4b1280711fd0249d3e07c0c02f983eb87b666a2dea5f10cb24fe80fa7`, computed from lexically sorted UTF-8 lines `path<TAB>sha256<LF>` with no header. B1h docs are excluded from this source/dependency aggregate to avoid a self-referential digest. Review the B1h docs diff separately. Any implementation/dependency change invalidates this exact-candidate handoff and requires refreshed hashes and affected verification.

| Repository path | SHA-256 |
|---|---|
| `.github/workflows/platform-ci.yml` | `cc87c1af6d1e8c1fdd0247659997cefd7fb1a1761f23a6166d3fdaed8b11c072` |
| `app/package-lock.json` | `cc259ed5d4e546096ff2dc128ec5afcf053dc43b0bf56d2576af0b515cc04e2e` |
| `app/package.json` | `3d047badc24819ad25d7c11838dfb6ba7bdd2d8d0f85b9251a7f4b83dd5fd5b7` |
| `app/scripts/build-application.cjs` | `70fa4c2f3e0fdd67289f300035d3ce1ed2e2b01a931328c8b67244dbc71d29db` |
| `app/scripts/build-application.test.js` | `4cf9df966e9467e53b2309126a36deec20a8ae7639657607d8705a01a3528565` |
| `app/src/index.ts` | `ef67a7aeab16a1d7c51ee6bc26ccae87260b40940eae106d1bf0dce29c892d79` |
| `app/src/shell/myUnits.modernization.test.ts` | `354303afb4599ef8899d5cf71c0ceafaf0eabcd9d58239f0abcb14c8dd4f41be` |
| `app/src/shell/shell.my-units.test.ts` | `3862182d9517fc57025a3dc3b13df39432cbe9347c8e8fc73e421fb0e57eca3c` |
| `app/src/shell/surfaces/curriculum.add-to-unit.test.ts` | `7211c8bc1e7fbc229c78ee5a45bab49a66acf4c585670b788f794b508863e53c` |
| `app/src/shell/surfaces/curriculum.teacher-units.test.ts` | `318f5ad6256fed6c82bb30a9643845e28cabfbdd4c58bd8ea9c1f35e8e5578b6` |
| `app/src/shell/surfaces/curriculum.ts` | `4b8ed896b64f19cfc58e2522595327082cc915531fc7c81655950d847255a142` |
| `app/src/shell/surfaces/myUnits.ts` | `1d3b8a3cc3257c270e78800d6d084d8c570ff7ed338f7e1aadb3f5e3ace7f28b` |
| `app/src/shell/surfaces/teacherUnitsPanel.ts` | `b4aad9fd2e8dd9204dfe70214781cb055f1951a3ff94f7369a9b53c1d1e43768` |
| `app/src/teacherUnits/availabilityProtocol.test.ts` | `54e4ca995e790d7f2650fa01c14c5a2f7780a329b10540ec8fb21c4708a142fd` |
| `app/src/teacherUnits/availabilityProtocol.ts` | `f62f2410d0b7b88c8df45c8c23c0001b1c70e53180ad270e33c6af4bf9806c2a` |
| `app/src/teacherUnits/backendCompatibility.test.ts` | `f9ef0ee1f62549c0d02e3ff830d66f935d97c070f2a5781f4d156bbf44bcc817` |
| `app/src/teacherUnits/backendCompatibility.ts` | `30f64baec2a2af9ab4217f97154500aec1aa1d0b97bbe146f8b8c23d87c57d6b` |
| `app/src/teacherUnits/capabilityState.test.ts` | `f7a5d13ec7bd8735ba88865e186fd80ff1ed317d5adfb4607107e7bb227f1b64` |
| `app/src/teacherUnits/capabilityState.ts` | `da1e28ba7d403a1524de601b58ea2fffe49a278c2cb81f53be55c198fe3be71b` |
| `app/src/teacherUnits/createAttempt.reconciliation.test.ts` | `a3894bb0de46cb0a1871110ff0148beb7e9b8b8ea9d377abd7e97e02f469b064` |
| `app/src/teacherUnits/releaseAvailability.test.ts` | `ae7bf52b4b0e6824c30925e79ae39821e835b2c3b0375f3c1ccd126da0d39f4f` |
| `app/src/teacherUnits/releaseBoundary.ts` | `3561d445bc6ea14fd5361900c9257eabc0d33799781bde4cd0e0b7e6884b822a` |
| `app/src/teacherUnits/unitColor.test.ts` | `5e7fec1f6d3c0bda14ff08bad1e16c749147a2136eaa01a83176d6016551c8ce` |
| `app/src/teacherUnits/unitsController.ts` | `44a141e8da58d7700e2047eb8a5917849560901c2f212a58e8f5f51c0a518d4f` |
| `app/src/teacherUnits/wire.test.ts` | `6d29583b914fbfc58c8bfc58a832439e9e7ebed201aaebddcfec10a37fa3844a` |
| `app/src/teacherUnits/wire.ts` | `5007b927b74b033cb25b8d43bffe3220afce86bdb69739354c5845621114f5e2` |
| `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` | `21d59803b841c8e4f78a6367ca949f5881d5e3fe2a2290a2f854713af8276fc0` |
| `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md` | `1c7286473c5c0f3a5186cbc8406ec1a88432008c725399d2df8eb1f4f11a0c92` |
| `fixtures/teacher-units-option-b/v1.json` | `5d9a0d4e09c663ddfe3cbc2935141c174b0475f61db607c9f0afdeacabfd2805` |
| `platform/firebase/package-lock.json` | `049b35182b189dff26919b1414ccae7d890b42eaa627987b2f0978ac543cabf6` |
| `platform/firebase/package.json` | `12eb117660b37b9211b9f7d8e71ede33a06230656d42a491f3d5f363f11106d5` |
| `platform/firebase/tests/teacher-units.rules.test.ts` | `873bd9cc880e5330eb5fcb0bb43fc317020ad038e9b30f2c2ebd9f1fd56a0489` |
| `platform/functions/package-lock.json` | `b1de795c3e330096590fd66022cdd4423cd5cc18a00dc8536f26a9021222e6bd` |
| `platform/functions/package.json` | `79589c9f755c324e5d9792522dcd0c73c0a2356b5f9733b7ce783aeb264348c7` |
| `platform/functions/scripts/teacher-units-capabilities-transport.test.cjs` | `13f9d351e19f4cce4802b0c873a0b70d74c180c3bca3aae740e277971eb65b97` |
| `platform/functions/scripts/test-capabilities-transport.cjs` | `24d1d6db66a55bbe26c0097aa9a02f3b391fc174b6f97b559b9f69eef70ddc2e` |
| `platform/functions/scripts/write-a3-runtime-build.cjs` | `aab0841b0797840557de1cee24193376ea831bc3cd94c5a0fc08c0f6cbde22fe` |
| `platform/functions/src/shared/audit/README.md` | `5ce3d9b74730f02ec5443851c51e40e3a1a0235cdf60939898661eff5ad90a4d` |
| `platform/functions/src/shared/audit/write-audit-event.test.ts` | `ca2147406e05d895862a9d6e41ba5d2842169b890c0055ecf3778a3e54173f1f` |
| `platform/functions/src/shared/audit/write-audit-event.ts` | `e4fb96cd1062295fb1903ded8dfaddf8ce3b87a6a1f17b9afa7a9c9ce5dcf56a` |
| `platform/functions/src/shared/types/audit-event.ts` | `94fb344a9aea2f85e2d17972716ead43881917159097e69c445309cd2ec8739f` |
| `platform/functions/src/teacherUnits/a3-composite-verifier.test.ts` | `24f8b305a7230a96ae1209524855556e972e068ba20c1bacda24a42a4454e0b8` |
| `platform/functions/src/teacherUnits/a3-enforcement-retry.test.ts` | `a3d2cbd778ed681c6f524b0fa70936b130bfb84c543f05f16ce2c94bd6d6d759` |
| `platform/functions/src/teacherUnits/a3-enforcement.ts` | `3e6ade94e37e0275d95290e586c89ad69a8c85231d8552a21b63c481843c2a34` |
| `platform/functions/src/teacherUnits/a3-runtime-build-profile.test.ts` | `d08badcac2d33888a771c83c9fdf15eaf95e88f56b59aea190d2244dc75c5299` |
| `platform/functions/src/teacherUnits/a3-test-support.test.ts` | `1498e2204aa216bb6fe54c1e53ffe83e99629ac4b20afd4c05e2cb7b89e658cb` |
| `platform/functions/src/teacherUnits/availability-policy.test.ts` | `e2a65f1227bf0fe79c16f4b548d9efafc0899ca53984086e9a9f9d21b5726004` |
| `platform/functions/src/teacherUnits/availability-policy.ts` | `fc7758155f3a8f2e006ef93e5535e40727e93988b6deb367fe80b8d163b6f08e` |
| `platform/functions/src/teacherUnits/availability-protocol.test.ts` | `c56ad64b1cb6404a4f3539c87245641a7b51ced1ce79c71954e0d9c021fbc6eb` |
| `platform/functions/src/teacherUnits/availability-protocol.ts` | `f62f2410d0b7b88c8df45c8c23c0001b1c70e53180ad270e33c6af4bf9806c2a` |
| `platform/functions/src/teacherUnits/availability-runtime-build.test.ts` | `4e48b521e8db5317fb580ba75657ebae61762d326e7add4dba24858abf2c2b8e` |
| `platform/functions/src/teacherUnits/availability-runtime-build.ts` | `aa451c7097e5471c12148edd863b197953e9916cae09e9ba64925ddab527fca1` |
| `platform/functions/src/teacherUnits/teacher-unit-access.ts` | `4661fad5bbae4b247b7067074f6a9552278c99a1920254ab5ce69c59b93f0839` |
| `platform/functions/src/teacherUnits/teacher-unit-mutation.ts` | `88f80f11400bb078c4372ad1d197ff961e0ff5587cf7338d307e8fa1878806f1` |
| `platform/functions/src/teacherUnits/teacher-units-archive.ts` | `a3196a46a320b33abdba916bce963a602d6af8b9d49107bae919aefcef492729` |
| `platform/functions/src/teacherUnits/teacher-units-capabilities.test.ts` | `acd63cbed3306306e99bbff210bf645a3e24525eb0eb872c21efd7c0bdcd72ed` |
| `platform/functions/src/teacherUnits/teacher-units-capabilities.ts` | `c171a9af3845be24e3144d438b69db144e4056fa43e7baca4953b8a17f99e87e` |
| `platform/functions/src/teacherUnits/teacher-units-create.ts` | `fd891435ffc4e928c9b8f3fed7f31a310e5a7b5311096c57191f8a75e5a08d8d` |
| `platform/functions/src/teacherUnits/teacher-units-get.ts` | `5e25ce3d805ff0aa4c2970241b9b0d13e4e04039129c4e13378f6f6259643e50` |
| `platform/functions/src/teacherUnits/teacher-units-list.ts` | `60d31f98e3d78549e169bf41d2e268f4febf8939c6a813c8bac2fa30cb5a4740` |
| `platform/functions/src/teacherUnits/teacher-units-reorder.ts` | `95b24bc6434ff3341103dc8108f91f414abf0738e034e181b0fb25d4a4965762` |
| `platform/functions/src/teacherUnits/teacher-units-restore.ts` | `01f2a76ce76cb1850d35e381579f71fedd0e5b1e8187215f9b048d4c75711939` |
| `platform/functions/src/teacherUnits/teacher-units-set-resources.ts` | `2edb32bb245e349ae02e4db3c5fe27ab36811b8c7d20a9ab0e092de3b2b8528c` |
| `platform/functions/src/teacherUnits/teacher-units-update.ts` | `ca56550929c6ac711b7f48ba3646d63087478f9882f8998af206cd9d88502c77` |
| `platform/functions/src/teacherUnits/teacher-units.emulator.test.ts` | `2a2d02511d4ea5c396886ab67fed45bd2b188db61029f15bceb9a9f8de1b3a9a` |
| `platform/functions/src/teacherUnits/teacher-units.test.ts` | `b13b42b27dde1101189e42f8e80f93d7fb2fd1a755d94558758f456c2c7bd205` |
| `scripts/hosting-release/backend-state.cjs` | `32262da8acc56d3e90713b2e74b39b713ef1022826c89a11a4c6317c3c3c45bb` |
| `scripts/hosting-release/backend-state.test.cjs` | `473109fef54c7734ca4c75b0cb8198b753b49554ad228132c0e832af063b8f4c` |
| `scripts/hosting-release/build-pair.cjs` | `06ce8452b20b1a339c734481f2dd5bee5345ae7ea4440881ff4ff8ff5ee01824` |
| `scripts/hosting-release/certify.cjs` | `d2f9a40d4e94138ec741c13e85661c2ff8f72206959504434ddb58588f7a0357` |
| `scripts/hosting-release/prepare.cjs` | `7fc15cdcb493748762075f88afc43f0059ded97f1e9d8504a1ef0d4a9af830df` |
| `scripts/hosting-release/release.cjs` | `e176dea7bd3da11801e6e341d47b863aba2268b8a0c13f65b28b7b06e319fd6b` |
| `scripts/hosting-release/release.test.cjs` | `c8b811713e43e5fddf743682e623b2adf48008bd1390f83ca680d3f98876387d` |
| `scripts/teacher-units-release/availability-control.cjs` | `6da765ccca4299d2cc2e5101912b8896c3a37f404bc7bdc2daa9234b5366decf` |
| `scripts/teacher-units-release/availability-control.emulator.test.cjs` | `83d6c528fd25402c09e6853a972524fdfe1b7ef625d27f4ae9856db09568681a` |
| `scripts/teacher-units-release/availability-control.test.cjs` | `5382fb273b76d1d453775ce00a28e600aea72901c8e8609be27c7e0690a051da` |
| `scripts/teacher-units-release/cli.cjs` | `39ad1deb25d4904b4e527b0af978f3cf616ec49751f2ad9f564e7610ff0b526b` |
| `scripts/teacher-units-release/cli.test.cjs` | `a1e051bff1ca9ee6dc06af4c98091781a0946f119b9a09c6be135c8dd90f7e35` |
| `scripts/teacher-units-release/fixtures/synthetic-option-b.cjs` | `7a0f53e5471c86b05ce8efd3d92415229d539b97ca164b593c14e407efbfb261` |
| `scripts/teacher-units-release/option-b-evidence.cjs` | `8a4407b76ee00b30813809fd94933f9865c1242bb6b278dc595d3003ae0ba6d1` |
| `scripts/teacher-units-release/option-b-evidence.test.cjs` | `86dad88211aa535fa759f5367644d2fc3096fca25875c3d6522b4f257cfc5544` |
| `scripts/teacher-units-release/option-b-observation.cjs` | `36155949078b8cce3562b93fe17e9918364261f5cfb50b9a685b3571769c5360` |
| `scripts/teacher-units-release/option-b-observation.test.cjs` | `14eb346b7d5c984ce697643e9af6f6235dd9f105044be2aa8a7af1cd8357218e` |
| `scripts/teacher-units-release/option-b-rules-evidence.cjs` | `dd9ccfe314951d05841ed8d0c5985fb97c216ad99d4736cbcfafc2ce060ebe75` |
| `scripts/teacher-units-release/option-b-rules-evidence.test.cjs` | `a5427f9e00620e02b5dfc2e7d9bb790b666aafe37d60a1846aa3ebbe96d26b82` |

### Locally retained prior-run log digests

These local paths are ephemeral, not repository artifacts or evidence of external acceptance. B1h read and hashed them without rerunning their commands.

| Local prior-run log | SHA-256 |
|---|---|
| `/tmp/lyfelabz-b1e-cli.log` | `92024f37b60174b7f14a1023097b58e81afca985bc129b28567579806911074a` |
| `/tmp/lyfelabz-b1e-emulator.log` | `d722064dba097a8a95665c22dba9c00e97c741197ff915e88674ec074395270c` |
| `/tmp/b1f-final-tests.log` | `0934942d7322fd28e208944540594197097f4da41a5b4f7cd4b686dd2d7b102b` |
| `/tmp/lyfelabz-b1g-compiler-tests.log` | `5f503db04fc376c510f9ccb6bfe51726bb34885b74b6ea7015b8426d75d88787` |
| `/tmp/b1g-final-integration.log` | `d3d1b5b6050fe1ca49b746d0d295fb82615250bd4703d0020dcc93dd3aee9bef` |
| `/tmp/b1g-evidence-replay.log` | `e4f8e8e68b4430ec25fe261f017e56b7ec631f08b8bb466734269dca8dff6d00` |
| `/tmp/b1g-client-final.log` | `d1cab5b3d3a5a7f4d54bef485822dab292c4b64c2e2504763292610d6bdafc86` |
| `/tmp/b1g-rules-tests.log` | `e6d7019b860ca279e973ecf8b56bee0f855a849f003b6ac0919d9c826484004a` |
| `/tmp/b1g-operator-emulator.log` | `701ccd418575a49cc5b6f2979f54a1ff6bde3408507f6234f557f3029d8d664f` |
| `/tmp/b1g-app-typecheck.log` | `409d69e61d6c621a31e7f346f15a932d657bfe0292b29cfa46dd82565b0b0ead` |
| `/tmp/b1g-rules-typecheck.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `/tmp/b1g-app-build.log` | `0c7fabcfe1baef1fda7fb587a02399805ae3b6fb6dc2d258526f5a7088f8a5f4` |
| `/tmp/b1g-functions-build.log` | `77571080f20ec6ccb640d26c34d99f2b71db54d57485bce08c3fe6540c90d752` |

### B1h documentation verification result

Documentation verification found exactly twelve changed paths from the B1h starting snapshot, all in the authorized B1h manifest. The other 1,750 baseline files are byte-identical; the pre-existing unrelated current-state grade-passback edits remain present. All 64 local Markdown link targets/anchors in the twelve docs resolve. All listed B1a-B1g paths exist; the 85 implementation/dependency hashes and aggregate above were rechecked unchanged. Current operator template flag spellings were compared with the parser without executing them. Read-only source inspection confirmed source client closure and CLI/review/execution real-enable interlocks. `git diff --check` passed. No security-critical implementation contradiction was identified by this documentation consistency pass; it is not independent security acceptance.

No application, build, emulator or full-suite rerun was needed: B1h changed only documentation and preserved the implementation/dependency inputs supporting the recorded results. Existing source/deployment evidence remains bounded as stated above. Independent integrated Astra review is the next recommended operation, under separate owner authorization; it has not started.
