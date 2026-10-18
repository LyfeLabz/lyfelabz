# U2.6 A3-2 runtime identity and artifact provenance

Status: implemented foundation, uncommitted, awaiting independent certification.
Teacher Units remains closed. No callable imports or invokes these modules.

## Baseline and bounded plan

Main was clean at commit `e862a23a20f5d0d36d228e138e2db51ca7557aa7`,
tree `23dc1d7e7f3ed61ddeef4dabc88231a427f0e4ce`.
Worktree: `/Users/breezy/Documents/GitHub/lyfelabz-a3-2-runtime-provenance`.
Branch: `codex/u26-a3-2-runtime-provenance`.

The implementation follows `U2_6_A3_CONTRACTS.md`, existing A3-1 contract,
validation, canonicalization and binding modules, Teacher Units/A2 capability
code, the A1 release-readiness runbook and backend-state artifact inventory,
Functions configuration, engineering standards, Cloud Function charter and
platform security model. It adds execution-context resolution, a pre-read SDK
adapter, exact application-byte inventory, a private build record, and inert
release/runtime consistency checks. It preserves A3-1 public contracts and the
four canonical vectors. Structural results never become operational authority.

## Runtime identity

`resolveRuntimeIdentity` takes no callable request, client identity, environment
map, provider URL or metadata transport. Its only optional argument is an explicit
server-owned emulator profile. Cloud resolution reads project ID, numeric project
ID, region resource and execution service-account email from the fixed metadata
server. The implementation uses the documented
[Cloud Run metadata contract](https://docs.cloud.google.com/run/docs/container-contract#metadata-server).
Requests require a Google metadata response header and status 200, refuse redirects,
have a two-second deadline and a 4096-byte response bound, and do not use configurable
metadata host/proxy variables. No metadata tokens or credentials are requested.

Cloud identities pin production to `lyfelabz-prod` / `182791689935` and staging to
`lyfelabz-staging` / `293337283840`. The region resource must contain that same
number and `us-central1`. Cloud mode requires consistent `K_SERVICE` and
`K_REVISION` execution labels. These labels are compared with the release endpoint;
they are not independent deployment attestations. Supplied server project labels,
Firebase config and region must agree. Malformed or contradictory labels refuse.
Cloud refuses emulator destinations and explicit local profiles.

Emulator mode requires `FUNCTIONS_EMULATOR=true`, a strict explicit expected project
and number `0`, and an exact local-profile digest plus loopback HTTP Auth/Functions
origins and Firestore host with explicit ports. Auth and Firestore environment
hosts must match. Cloud execution labels refuse emulator mode. The profile is a
local configuration expectation, not a Google assertion or proof of actual routing.
No default emulator project is selected. The profile is copied and frozen.

The version-specific connection adapter supports Firestore `7.11.6`, google-gax
`4.6.1`, and the actual gRPC transport's grpc-js `1.14.4`. Installed Admin is
`12.7.0`. Unknown Firestore/GAX versions refuse before binding; unknown transport
classes or transport versions refuse at the actual factory. Relevant dependency
upgrades require independent recertification, including transitive transport changes.

Before initialization, public `settings()` pins both universe aliases to
`googleapis.com`, explicit servicePath/apiEndpoint, port, SSL and protocol. Cloud
is exactly `firestore.googleapis.com:443` with TLS/https. Emulator retains its
validated explicit loopback host/port with SSL disabled and HTTP. Nonapproved
universe inputs, contradictory endpoints and unsupported configuration refuse.
The adapter admits a closed set of standard Firestore/library settings. Custom
auth/transport implementations, credential selectors, GAPIC config, HTTP rule
replacement, and arbitrary gRPC/GAX channel namespaces are not admitted.

Settings slots and the settings reference are protected and additions are blocked.
The entire settings object is **not frozen**: customHeaders remains writable because
Firestore replaces emulator headers on every initializeIfNeeded invocation. Supplied
service-account credential data is copied, validated and frozen; generated scope
arrays and empty GAPIC configuration are immutable. Credential files, default
application credentials and their authorities still rely on trusted deployment
configuration and filesystem state; this adapter does not attest credential files.

Each binding retains the exact Firestore object, settings snapshot, pool, factory,
acquisition guard and generated clients. A unique opaque settings marker verifies
that the installed factory captures this Firestore object's settings; it also
rejects a real donor pool substituted before initial binding. The marker exposes
no mutable binding record. Pool and factory references are protected. Repeated
verification rechecks the retained binding rather than trusting historical pins.

The real factory is guarded on every lazy invocation. Actual Firestore and auxiliary
Locations GAPIC options must agree with the closed configuration and transport mode.
Their immutable options, transport references and initialization functions are
protected. Pool acquisition checks owned clients before reuse. Registered stub
promises are checked so foreign cached stubs cannot silently replace verified ones.
The SDK's request counts, client maps, idle collection, failure recovery and normal
REST-to-gRPC transition remain mutable and supported.

Actual GAX createStub is constrained per transport instance. REST consumes the
validated immutable protocol/host/port. For gRPC, a constructor guard checks the
**final** address, real ChannelCredentials security state and exact permitted channel
arguments after GAX's asynchronous selection and before constructing the socket
client. This does not infer TLS from ssl=true alone. Per-instance certificate
discovery is pinned off: the approved TLS profile uses default TLS credentials,
not an environment-selected mTLS client-certificate profile. Explicit servicePath
also prevents GAX's mTLS endpoint rewrite. Later universe/emulator/transport preference
or certificate environment changes cannot alter the pinned connection profile.

The installed LocationsClient shares the GAX transport. Its configuration and
initialization are guarded too. Cleanup closes an existing auxiliary stub without
initializing an unused one; installed GAX otherwise creates that unused stub while
closing the already-terminated parent. Existing auxiliary stubs still close normally.
No new channel, token or tenant RPC is requested during initial identity issuance:
temporary guarded constructors validate SDK compatibility and close without stub
initialization. Binding still precedes initializeIfNeeded and tenant use.

Previously initialized unbound clients and preexisting clients/channels refuse;
they are never retrofitted. Each immutable issued identity is associated with its
binding through a private WeakMap. Identity reliance checks the current shared Admin
client, project/database and observable binding integrity. A detected integrity
failure permanently invalidates that binding and all associated old identities,
refuses fresh issuance, and refuses guarded factory/acquisition/initialization paths.
Restoring corrupted state cannot revive the binding. Ordinary transient credential
or stub failures can retry when integrity remains intact. This is binding history,
not a positive availability cache. All results retain available=false.

This establishes connection-configuration consistency for trusted application code
using the verified client through the supported installed SDK lifecycle, with explicit
regressions for the two private-state mutation findings. It is not protection against
arbitrary malicious code with unrestricted backend privileges, malicious dependencies,
or wholesale prototype/module replacement. Private integration is isolated in
`a3-runtime-identity.ts`; none of these modules is imported by live callables.
Actual DNS, network egress/routing, provider TLS handshakes, IAM, traffic, external
approval authority and deployed buildpack behavior remain independently unverified.
Future integration must bind the shared client before its first use and use that
same client for subsequent operations. No A3-3 integration is performed here.

## Application artifact and private build record

Inventory reproduces A1's canonical map of relative path to SHA-256 file bytes:
`lib/**/*.js`, `lib/**/*.json`, `package.json`, `package-lock.json`. It requires
`lib/index.js` and compiled placement JSON, checks regular files and refuses symlinks
or special entries. Placement uses the existing ordered `resourceIds` digest.
Source maps and declarations are outside the approved runtime inventory.

`runtimePayloadFingerprint` excludes exactly
`lib/teacherUnits/a3-runtime-build.json`. `functionsArtifactFingerprint` includes it.
Both use unchanged A3-1 canonicalization. There is no circular digest: the build
record contains payload identity; the manifest contains full artifact identity.
The record is parsed with duplicate-key-rejecting strict JSON. Inspection compares
its payload and placement digests against observed bytes and repeats inventory to
refuse detectable changes during inspection. It does not attest an immutable whole
filesystem or container image.

The private record's exact fields are schemaVersion (1), enforcementVersion
(`teacher-units-a3-v1`), deploymentMode (`closed-only` or `policy-controlled`),
sourceSha, sourceTree, sourceDirty, runtimePayloadFingerprint, placementFingerprint,
and supportedClientContractVersions (`["teacher-units-v2"]`). Unknown fields refuse.
A policy-controlled record with sourceDirty=true refuses. This private local format
adds no fields to A3-1 documents, manifests or public protocols. All build-record
validation remains structure-only, operationally unverified.

Normal `npm run build` adds a postbuild step (`scripts/write-a3-runtime-build.cjs`)
that writes `closed-only` with Git HEAD/tree and actual dirty status. The generated
file is ignored compiler output, not a tracked release record. Source labels do not
prove that compiled bytes came from that source. A future independently authorized
build/approval workflow must establish that fact.

**D12 build profile.** The postbuild step selects the mode from the build process
environment, once, while the build runs:

- `A3_BUILD_PROFILE` unset or empty: `closed-only`, unchanged behavior (a dirty tree is
  recorded as `sourceDirty: true`, not refused; `A3_EXPECTED_SOURCE_SHA` is ignored).
- `A3_BUILD_PROFILE=policy-controlled`: requires `A3_EXPECTED_SOURCE_SHA` set to exactly
  40 lowercase hexadecimal characters equal to `git rev-parse HEAD`; a clean working tree
  (`git status --porcelain --untracked-files=normal` empty, so tracked, staged and untracked
  changes refuse); and `node_modules`, when present, not a symlink.
- Any other value (including different case or whitespace) refuses. A requested
  policy-controlled build is never downgraded to `closed-only`.
- Git HEAD and tree must resolve for every profile; a directory that is not a checkout, or
  a repository with no commit, refuses.

The script deletes any existing `a3-runtime-build.json` before any check and writes the
new record by temporary file and rename only after every check passes. A refused build
exits non-zero (failing `predeploy`) and leaves no record, so `inspectRuntimeArtifact`
refuses the artifact and no stale record from an earlier build can be read as the
requested one. Residual: the rest of `lib/` from the same `tsc` run remains on disk, and a
later ordinary build writes `closed-only` again.

The record schema and fingerprint semantics are unchanged: the mode is in the record,
so it changes `functionsArtifactFingerprint` but not `runtimePayloadFingerprint`. The
compiled runtime never reads these variables; there is no runtime or request-time switch.
Policy-controlled records bind the exact `sourceSha` and `sourceTree`. Reproducibility
still requires building from an isolated checkout of the exact release commit with real
installed dependencies (`CLAUDE.md`); the script checks only the clean-tree, exact-SHA
and non-symlinked `node_modules` conditions and cannot prove checkout isolation, the
integrity of installed dependencies or the toolchain. [U] Whether the Firebase CLI passes
the operator's environment to `predeploy` is unverified (gate G4) and needs staging
verification before it is relied on.

Four separate states: **technically selectable** (this profile builds a
policy-controlled artifact offline); **provenance matched** (`verifyRuntimeProvenance`
returns `matched`, still `available: false`); **deployment approved** (a signed approval
recognized by the A3-6 verifier, whose production registry is empty); **available**
(activation, still not authorized). Each earlier state grants none of the later ones.

Runtime default root is derived from the compiled module location. No cwd fallback,
package-search heuristic or buildpack-path assumption is silently substituted.
Unknown/missing packaging refuses. An explicit root parameter exists for local
artifact tooling/tests and is not exposed by any callable.

## Provenance, authority and unavailable state

`verifyRuntimeProvenance` requires an identity produced by this process's resolver.
It reuses A3-1 release-reference and deployment-binding checks: exact immutable
release path/manifest digest, exact evidence path/payload digest, exact statement
hash and candidate/manifest relationships, supported schemas/kinds and expected
environment. It adds equality with inspected runtime payload, full artifact,
placement, source labels and supported contract, plus this endpoint's execution
service, revision and service account. Emulator endpoint/profile relationships use
the existing A3-1 validators. No record is created or edited.

Even an exact match returns only `runtimeConsistency: "matched"` with
`approvalVerification: "unverified"`, `deploymentVerification: "unverified"`, and
`available: false`. Closed-only builds, missing inputs, digest mismatch, fabricated
identity or exceptions return unverified/unavailable. There is no positive
availability cache; artifacts are inspected on every verification call.

Trust anchors used: the provider's in-process metadata endpoint for cloud project,
number, region and execution account; the initialized server SDK for selected
Firestore identity/transport; and explicit server-owned local configuration for
emulator expectations. Hashes establish content consistency, not human authority.
No trusted signer, approval authority, key retrieval, revocation resolver, immutable
statement-object retrieval or certification source is configured or invented.
Synthetic signatures can pass structure and runtime consistency and still cannot
grant approval. This is intentional and covered by tests.

Staging must independently verify deployed buildpack filesystem assumptions before
using this foundation. Traffic, complete/inherited IAM, endpoint provider defaults,
actual Rules/index state, trusted signed approvals, revocation, source reproducibility,
container-image identity and automatic base-image updates remain unverified.
There is no claim of live provider inspection. Metadata tests mock provider transport.
No production/staging calls, tenant reads, deployment, activation, evidence writes
or credential operations were performed.

A3-3 transactional endpoint enforcement, A3-4 client migration, A3-5 Rules lockdown,
A3-6 protected release/approval registration and external deployment certification,
and A3-7 integrated security certification remain deferred. A future integrator must
resolve identity before tenant reads, supply fresh canonical records, and establish
operational authority separately; this module's matched result is never permission.

## Exact changed-file inventory

12 source changes (one existing tracked file modified, eleven new files):

1. `docs/platform/U2_6_A3_2_RUNTIME_PROVENANCE.md`
2. `platform/functions/package.json`
3. `platform/functions/scripts/write-a3-runtime-build.cjs`
4. `platform/functions/src/teacherUnits/a3-runtime-metadata.ts`
5. `platform/functions/src/teacherUnits/a3-runtime-metadata.test.ts`
6. `platform/functions/src/teacherUnits/a3-runtime-identity.ts`
7. `platform/functions/src/teacherUnits/a3-runtime-identity.test.ts`
8. `platform/functions/src/teacherUnits/a3-runtime-artifact.ts`
9. `platform/functions/src/teacherUnits/a3-runtime-artifact.test.ts`
10. `platform/functions/src/teacherUnits/a3-runtime-provenance.ts`
11. `platform/functions/src/teacherUnits/a3-runtime-provenance.test.ts`
12. `platform/functions/src/teacherUnits/a3-runtime-destination.test.ts`

The connection-integrity remediation changes only this report, runtime identity
implementation, destination/identity tests, and provenance identity-lifetime tests:
five files relative to the independently recertified A3-2 state. Total inventory
remains 12 files; no dependencies, lockfiles or live consumers change.

Ignored local output: copied existing app/Functions dependency directories, compiled
Functions lib including the closed-only runtime build record, and local outputs
produced by placement parity checks. No dependencies or lockfiles are changed.

## Verification and integrity

Connection-integrity verification is isolated under
`/private/tmp/lyfelabz-a32-option-b`. Before editing, the original two failures were
independently re-executed on Node `22.23.3` with zero network attempts. Corrected
real-SDK probes run against the emitted application bytes, with local metadata/Admin
and authentication-lookup seams and network blocking. Actual GAX credential creation,
address/channel selection, REST stub construction and GAPIC initialization execute.
Socket constructors and authentication lookup are local test seams; no tenant method
or external provider RPC is requested and no credentials are transmitted.

Validation on Node `22.23.3`:

- Eight Functions suites: 409/409 PASS, including all five A3-2 suites, unchanged
  A3-1 contracts/canonical vectors and existing Teacher Units/capability handlers.
- App A3 protocol/closed availability: 23/23 PASS.
- A1 backend-state/placement compatibility: 54/54 PASS.
- Total targeted regression tests: 486/486 PASS.
- Functions typecheck and changed-file ESLint: PASS.
- Isolated Functions build, placement prebuild and closed-only postbuild: PASS.
- Placement: 62 IDs; ad477c4c0213eb68e74238ea4eff9c417a7457461f8bc2b349ef7889cacf1ec7.
- All four approved canonical vectors independently recomputed: PASS.
- Separate real-SDK probes on Node 22 and Node `24.15.0`: PASS; zero network attempts.
- Main/worktree tracked bytes, index hashes, exclude and protected-file integrity,
  exact 12-file inventory and complete diff checks: PASS.

Cases include production/staging; approved IPv4/IPv6/local emulator profiles;
pre/post-issuance pool substitution; factory consistency; late credential, TLS-name
and channel namespace additions; mutation between GAPIC construction and channel
creation; actual final credential/address rejection; cached stub replacement; old
identity rejection; pool reuse/churn and REST-to-gRPC transition; repeated emulator
initialization; environment drift; transient authentication retries; previously
initialized unbound clients; unknown SDK and transitive transport versions.

Only the five declared files differ from the recertification snapshot. All other
A3-2 files retain their previous hashes. Main remains clean at the expected baseline
commit/tree; the worktree remains on its specified branch with 12 unstaged/uncommitted
changes. Existing A3-1 bytes, live callable/export/dispatch code, shared Admin
initialization, client gate, Rules/indexes, deployment configuration, protected
multilingual architecture and Git exclude remain unchanged. Teacher Units stays
closed. No stage, commit, push, merge, deployment, activation, transfer into main,
images or A3-3 work occurred.

Ready for independent recertification of the version-specific connection adapter.
Local results do not constitute independent certification, live provider verification
or operational approval. Node 22 deployed packaging and real provider connections
remain separate release responsibilities.
