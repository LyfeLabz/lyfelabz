# U2.6 A3 contracts — A3-1

Status: pure contracts and validation only. Teacher Units remains closed by the
existing application/build gate. No policy or release record is created by these
modules. At A3-1 certification, A3 server enforcement was not connected and A2
capability discovery and mutation dispatch were unchanged (historical). A3-3 later
connects these contracts to the server (`U2_6_A3_3_ENFORCEMENT.md`); the contract
definitions below are unchanged by it.

Authority: the approved A3 architectural specification and approved A3 contract
completion supplement. Baseline HEAD is
`36ae3534baccbd57d93e81659da244ed74a163f6`; tree is
`6fee6d337eaf00d7f80fafed96d492b74aa8c4c6`.

## Contract sources

- `platform/functions/src/teacherUnits/a3-contracts.ts`: exact policy, identity,
  endpoint, release, approval, disposition and activation structures.
- `platform/functions/src/teacherUnits/a3-protocol.ts`: mutation compatibility and
  capability schema 2, plus strict parsing primitives and structural results.
- `app/src/teacherUnits/a3Protocol.ts`: byte-identical standalone protocol
  definitions for future A3-4 integration. A focused parity test prevents drift.
  Duplication avoids cross-package build/rootDir changes in A3-1; it adds no
  runtime import to either existing application path.
- `a3-validation.ts`: exact recursive schemas and supplied identity checks.
- `a3-canonical.ts`: A1-compatible canonical bytes, SHA-256, evidence references,
  strict textual JSON ingestion and domain-separated approval signing bytes.
- `a3-bindings.ts`: content addresses, candidate/activation/mutation comparisons,
  policy transitions, initialization, generations, duplicates and dispositions.
- `a3-errors.ts`: the twelve approved error names/categories. No existing error
  translator has been changed.
- `fixtures/teacher-units-a3/v1.json`: shared synthetic valid/invalid records,
  fixed identities/timestamps, explicit emulator expectations, and hash vectors.

Every validation result, including an entirely coherent enabled-policy binding,
reports `scope: "structure-only"` and `operationalVerification: "unverified"`.
There is no authorization, deployment-eligibility or activation decision on this
result. An enabled capability's `deploymentEligible` field is a parsed remote
*declaration*, not a validation result or independent certification.

## Policy and generations

The singleton is `platformConfig/teacherUnitsAvailability`. All fields are
required; unknown fields, unsupported versions, coercion, noncanonical UUID v4,
digests, contract tuples and partially shaped nested records are refused.
Production binds exactly to `lyfelabz-prod` / `182791689935`; staging binds to
`lyfelabz-staging` / `293337283840`. Emulator uses the explicitly selected expected
local identity and project number `"0"`. Cloud evaluators refuse emulator records.
No project default or fallback is supplied.

Initial policy must be generation 1, closed, with null backend release and
activation evidence. An enabled policy needs both references. Closed policy must
clear activation evidence; it may retain its selected release. Schema validity
never means management may execute.

Compare instance, generation and release by exact equality. Generations are
positive safe integers. An actual modification increments by exactly one; a
no-op changes neither generation nor content (including timestamp). Modification
at MAX_SAFE_INTEGER is refused; MAX_SAFE_INTEGER itself is a valid last generation.
Instance/schema/project/environment/region/database are immutable for the policy
lifetime. Release/contracts/placement preparation requires closure. Shutdown can
retain the prior release or clear a damaged release reference, clears activation
evidence and increments generation. Changing placement during shutdown is not a
preparation operation. Supplied transition checks do not implement operator IAM,
transactional compare-and-set, history creation or timestamp production.

The policy `updatedAt` is an actual installed SDK Firestore `Timestamp`, validated
without database access. JSON fixtures use `{seconds,nanoseconds}` solely as a
fixture codec; tests hydrate it to `Timestamp`. That JSON object is not accepted
as a policy timestamp. No activation lease or age-based rejection is introduced.

## Protocol

The next client contract is `teacher-units-v2`. The mandatory mutation
`compatibility` envelope has **schemaVersion 1**, not 2. Its six fields are the
schema version, client contract, policy instance, policy generation, backend
release digest and placement digest. Capability request/response schemaVersion
is **2**. Supported operation ordering is exactly create/list/get/update/archive/
restore/setResources/reorder; supported versions are exactly `["teacher-units-v2"]`.

Closed declarations accept no versions. Enabled declarations need eligible=true,
non-null policy instance/generation/release and accepted v2. Missing policy is
unverified with null identifiers, eligible=false and no accepted versions. A
known but ineligible enabled policy is unverified with its known identifiers and
no accepted versions. Contradictions refuse parsing. Emulator capability parsing
requires an explicit expected project identity; it does not verify routing.

Future A3-4 must preserve independent transport, origin, project, Auth/Functions
app, token/session, nonce, deadline and placement checks. Obtain fresh discovery
for each explicit mutation attempt, retain the single-use lifetime check and
attach compatibility immediately before dispatch. Do not persist it as replay
authority. Keep it outside create intent hashing and receipt identity. Create v2
must require original expectedSchoolId even on replay. Preserve original school,
idempotency key and uncertainty; never automatically resend on policy change.
List/get remain without compatibility envelopes but need future server availability.
None of those existing flows are connected or modified in A3-1.

## Cloud and emulator endpoint observations

The release inventory is the exact sorted nine endpoint names, including
teacherUnitsCapabilities. Cloud endpoints require GEN_2, nodejs22, us-central1,
matching entryPoint and full normalized Function/build/service/revision resources.
Build location is preserved; it need not equal Function region. The selected
traffic tuple is exactly 100%, matching the revision, with null tag. Do not erase
zero-percent tagged routes during future provider normalization.

Execution includes service account, quantities, scaling, command/args/directory,
nonsecret environment values, numeric secret-version bindings, ingress and
none/connector/direct-VPC networking. Build includes build service account,
nonsecret environment, repository, generation-pinned source object/hash and
explicit automatic/on-deploy update policy. The image is an observed repository
and digest, never inferred from an unobserved value.

Canonical sorted unique arrays apply to endpoint names, environment names, secret
binding names, volume names/items, IAM members/bindings, tags and audiences.
Command/argument order remains meaningful. Secret/plain name collisions and
duplicate mount paths are refused. Explicit secret items and numeric versions
are required; latest/aliases are refused. Actual filesystem permissions and
secret contents are not validated. A plain FIREBASE_CONFIG must parse and match
the endpoint project. Operational nonsecret classification, provider default
resolution, update-policy detection and configuration-plan approval are later gates.

The approved v1 profile has one application container and no sidecars, sandbox
launchers, alternate code sources or unreviewed code-loading mounts. Normalized
unknown fields fail. These modules do not normalize raw provider API responses;
an adapter must resolve documented defaults and identities without guessing.

Emulator endpoints have no fake Cloud Run provenance. Their exact loopback
Auth/Firestore/Functions destinations and local-profile digest must match supplied
expectations. Emulator releases use null Rules resource; cloud releases require a
matching project Rules resource. Null never represents unavailable cloud evidence.

## Content addresses and authority

Backend documents contain exactly `{schemaVersion:1,manifest}` at
`teacherUnitsBackendReleases/{SHA256(canonicalJSON(manifest))}`. Evidence documents
contain exactly `{schemaVersion:1,payload}` at
`teacherUnitsReleaseEvidence/{SHA256(canonicalJSON(payload))}`. Wrappers are never
hashed for their path. All normalized manifest/payload fields participate.
No document ID or server-created metadata is inserted into the hashed body.

Approval payloads contain exact statement/source objects. Source identifies the
immutable statement object, its byte hash, signer key identifier, algorithm
ed25519 and canonical padded base64 signature encoding (64 decoded bytes).
Its statement object hash must equal the canonical statement bytes. Signing bytes
are UTF-8 `lyfelabz.teacher-units-approval-v1\n` followed by canonical statement
JSON. These helpers **do not verify signatures, retrieve objects, trust keys,
identify a human, read revocation status or approve a deployment plan**.
Synthetic zero-byte signatures deliberately pass shape checks without authority.

Deployment approval binds the predeployment source/artifact/placement candidate
and immutable deployment-plan attachment; it does not name a future release ID.
Release binds observed endpoint configuration and the deployment approval.
Activation approval binds the existing release, policy instance, intended enabled
generation, placement, Hosting candidate, contract and certification reference.
Activation payload repeats those bindings and references that separate approval.
Its wrapper introduces no timestamp or digest field.

Dependency order:

candidate/plan -> deployment approval -> deployed observations -> release ->
certification -> activation approval -> activation evidence -> enabled policy.

No ancestor references its future child's digest. Activation evidence can be
created before the transactional policy compare-and-set; a failed compare-and-set
leaves unused evidence, never permission for a different generation. Canonical
Hosting identity is the digest of the complete existing A1 hostingCandidate, not
only its file maps. Supplied activation validation requires that expected digest.
Certification and approval references must be distinct. Certification assertions
and certification-kind/source verification remain later writer/certification gates;
no unapproved certification payload schema is invented here. Unsupported evidence
kinds are rejected by the registered evidence-document parser.

Duplicate handling is validation of an existing/proposed pair at its correct
content address, including wrapper schema and canonical equality. Actual writers
must use create-only preconditions. Dispositions are immutable signed-source
records; revoke has no replacement, supersede requires a distinct approval for
the same action/environment. Current disposition resolution and human authority
are external. Revocation does not automatically close an active policy: it must
invoke the separately controlled shutdown workflow. No record is edited here.

## Canonical encoding

Use the existing A1 algorithm: recursively sort object keys with JavaScript
`.sort()`, then JSON.stringify, UTF-8, SHA-256 lowercase hex. Preserve ordinary
ECMAScript integer-index property enumeration; this is not claimed to be RFC 8785.
Preserve Unicode exactly, without NFC, trimming or locale sorting. Reject unpaired
surrogates, undefined, sparse/custom arrays, class instances, accessors, hidden
fields, symbols, custom functions/toJSON, cycles, nonfinite values, unsafe numbers,
fractions and negative zero. Strict textual JSON ingestion rejects duplicate keys,
including escaped-equivalent keys, before JSON.parse discards them.

Textual numeric tokens are checked using exact decimal coefficient/exponent
arithmetic before `JSON.parse`. Their mathematical value must be a safe integer;
fractional values, underflow, overflow and negative zero refuse ingestion.
Exact integer spellings such as `1.0`, `1e3` and `10e-1` remain valid. Numeric-looking
strings are unchanged. Huge exponents are bounded before exponentiation.

Canonical event instants use UTC Gregorian years 0001–9999, exactly nine fractional
digits, no leap second. Do not lose nanoseconds while normalizing provider inputs.
Policy SDK Timestamp is not part of any canonical evidence payload; transition
comparison projects it to seconds/nanoseconds explicitly.

## P2 remediation numeric contract and responsibility boundary

The confirmed concurrency, timeout and Storage generation reproductions are
corrected without changing schema field types. Decimal strings use `BigInt`
comparison after positive canonical-decimal validation.

| Field | Structural bound | Source |
|---|---|---|
| `execution.concurrency` | integer 1–1000 | [Cloud Run concurrency](https://docs.cloud.google.com/run/docs/about-concurrency) |
| `execution.timeoutNanoseconds` | decimal string 1–3600000000000 | [Cloud Run request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout) |
| Every `ContentObjectV1.generation` | decimal string 1–9223372036854775807 | [Storage generation is a signed long](https://docs.cloud.google.com/storage/docs/json_api/v1/objects), [Run CloudStorageSource int64](https://docs.cloud.google.com/run/docs/reference/rpc/google.cloud.run.v2#cloudstoragesource) |
| `execution.minimumInstances` | integer 0–2147483647 | [Run RevisionScaling int32](https://docs.cloud.google.com/run/docs/reference/rpc/google.cloud.run.v2#revisionscaling) |
| Non-null `execution.maximumInstances` | integer 1–2147483647 | Same int32 source; null retains the approved absent-maximum meaning |
| Secret volume `defaultMode` | integer 0–511, unchanged | [SecretVolumeSource](https://docs.cloud.google.com/run/docs/reference/rest/v2/Volume#SecretVolumeSource) |
| Non-null secret item `mode` | integer 1–511, unchanged | [VersionToPath](https://docs.cloud.google.com/run/docs/reference/rest/v2/Volume#VersionToPath); null represents inheritance |

Instance bounds describe the provider wire type, not the available project quota.
Actual limits vary with regional quota and resources and remain an observer gate:
[maximum-instance limits](https://docs.cloud.google.com/run/docs/configuring/max-instances-limits).

The approved final numeric clarification assigns CPU/memory representation to
A3-1 and actual provider admissibility to A3-6. `execution.cpuMilli` must be a
positive JavaScript safe integer in millicores: fractions, zero, negative values,
nonfinite values and unsafe numbers refuse. No fixed vCPU allowlist is imposed.
`execution.memoryBytes` must be a positive canonical decimal string matching
`^[1-9][0-9]*$`. It is never converted to a JavaScript number; arbitrarily large
integer strings retain their exact bytes. There is no universal memory minimum
or maximum in this structural contract. The approved 256 MiB fixture is preserved.

Structural acceptance does not assert that every such CPU or memory value is
deployable, or permitted for every Cloud Run execution environment. A3-6 must
independently verify CPU/memory admissibility against the deployed execution
environment, current provider configuration and approved deployment plan.
Unsupported or unverifiable configurations must prevent release eligibility.
Function generation `GEN_2` must not be silently equated with the Cloud Run
execution environment. This clarification changes no schema field or type,
adds no provider observation code and confers no deployment authority.

Secret versions retain the approved positive canonical decimal grammar. The
[Secret Manager version resource](https://docs.cloud.google.com/secret-manager/docs/reference/rest/v1/projects.secrets.versions)
documents sequential IDs beginning at 1, but supplies no numeric upper bound for
the resource-name segment. Do not apply Storage's signed-long cap to secret
versions without an authoritative basis. Resolution/existence remains external.

Other numeric fields were audited: policy/envelope/activation generations retain
positive safe-integer semantics; Timestamp seconds/nanoseconds retain installed
SDK ranges; schema and IAM versions retain exact literals; traffic percent remains
the exact approved 100. No provider-generation field beyond immutable Storage
object generation is present in these normalized records.

Approved vector digests:

- `{}`: `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`
- `{"a":1,"b":2}`: `43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777`
- `{"a":[2,1],"z":{"a":false,"b":null}}`:
  `a64aef6aa08ed641425787ecf8dbb2f1be979f13c950d190f28a49fb6fca08da`
- Approved synthetic activation payload:
  `9e1e6fa22a53093fd4ea3107a98f5d0f6affe11aad6ae8b786d73e70c05aec04`

## Remaining integrations and operational limits

A3-2 must establish runtime identity before tenant reads, reproduce the exact
application payload inventory and validate the build file. The inventory is
lib/**/*.js, lib/**/*.json, package.json and package-lock.json, excluding exactly
lib/teacherUnits/a3-runtime-build.json for payload hashing. A1 full artifact identity
still includes that file. Normal builds remain closed-only; a policy-controlled
profile needs separate authorization. No build/profile generator is introduced here.

The installed Firestore SDK's resolved identity getter is outside public typings
and currently used after canonical reads in A2. A3-2 must resolve its pre-read
adapter or stop. Staging must verify deployed buildpack filesystem assumptions;
unknown packaging never gets a fallback.

Execution metadata can verify project/number/region/service-account and K_SERVICE/
K_REVISION. It cannot attest fleet traffic, complete IAM, approved human decisions
or an unchanged whole container image. Cloud Run automatic base-image updates can
change the runtime without a new revision. Application payload identity and the
observed image must remain separate, with update mode explicit.

A3-3 must enforce canonical authorization, uncached policy, release and activation
bindings transactionally on every management read/mutation, receipt replay, no-op,
transaction retry and post-commit response read. Closed discovery remains available
under canonical authentication. Post-commit refusal becomes responseUnavailable with
outcome unconfirmed; it does not undo writes. Error translation is not connected by
A3-1; A3-3 connects it in the shared HTTPS translator.

A3-5 must implement callable-only Rules; A3-6 must implement protected approval,
provider normalization/observation, IAM/route review, freshness, history/CAS,
create-only evidence registration and shutdown/rollback tooling. Local getIamPolicy
excludes inherited permissions; hashes and author fields are not proof of approval.
IAM principals, trusted workflow/keys, storage retention, revocation resolution,
nonsecret allowlist, deployment plan interpretation and certification source remain
operational decisions. They do not become satisfied through schema success.

A3-7 integrated security review and later separately authorized staging/production
operations remain required. No deployment, activation, lease, permissive legacy
contract, fallback policy, UI change or A3-2 work is part of A3-1.
