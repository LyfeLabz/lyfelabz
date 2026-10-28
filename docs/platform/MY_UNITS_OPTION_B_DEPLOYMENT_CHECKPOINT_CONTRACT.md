# Option B deployment checkpoint contract — B6b-4C proposal

## Historical contract status after E2, October 27, 2026

Retained as historical experiment evidence. E1/E2 retire this custom checkpoint/provenance/registry/Cloud Run pinning qualification from the My Units launch path. Its missing evidence remains missing; no historical fixture is relabeled qualified. The offline registry correction and related tests are preserved, not required for E3.

Use the active schema-2 scoped verifier and [E2 workflow](U2_6_RELEASE_READINESS_RUNBOOK.md#e2-simplified-release-and-operator-workflow). Required deployment identity, nine endpoints, reviewed application build, effective serving configuration/routes, Rules denial, paired Hosting, CAS/audit and closed-only rollback remain enforced. The old exact metadata/provenance requirements below govern only reconstruction of this experiment, not current release or operator activation.


Status: **DRAFT — INDEPENDENT REVIEW REQUIRED. No deployment or activation authority.**

This proposal preserves the Option B blueprint's I13 (deployment/build/target consistency) and I15 (scoped deployment, actual evidence, closed recovery). It does not change availability policy, production acceptance, or the canonical experiment packet. A0 remains unqualified. Green offline tests establish rejection behavior only.

Evidence: [B6b-4 investigation](/private/tmp/lyfelabz-b6b4-investigation-20261027/REPORT.md), [B6b-3R2 deployment report](/private/tmp/lyfelabz-b6b3r2-run-20261026/REPORT.md), and [canonical packet evidence schema](/private/tmp/lyfelabz-b6b2-probe-20261026/EVIDENCE-SCHEMA.md). Provider documentation references below are carried forward from that investigation; this operation makes no provider calls.

## A. Current observer requirement

Two existing boundaries must remain distinct:

- `scripts/teacher-units-release/option-b-observation.cjs`: application/configuration consistency across nine Teacher Units endpoints, actual source archive/build-record bytes, explicit Run execution settings, traffic and independent configuration approval. `normalizeEndpoint` is only its metadata subcheck. It does not retrieve a Cloud Build response or require `results.images`.
- Canonical packet `tools/checkpoint.cjs` / `tools/request-plan.cjs`: offline refusing-probe qualification before a planned pin/restore request. It additionally requires raw Build provenance/output fields, registry linkage, source-byte review, snapshot hashes and independent qualification. A0 structural inspection tolerates an unspecified Run environment; that does not qualify provenance or pass the production observer. Restoration requires explicit GEN2 and matching immutable images.

Definitions: **PROVEN CORRECTION** means an observed mapping defect is established; **PROPOSED CORRECTION** means a change still requires review/implementation; **UNRESOLVED PROVIDER EVIDENCE** means no acceptable proof has been established. None means deployment approved.

### Required field contract

P = `lyfelabz-staging`, N = `293337283840`, region = `us-central1`. The probe ID is `optionBDeploymentProbe`; it is not a member of the application's nine-endpoint fleet. An observation plan must identify which of those two scopes it is testing.

| Evidence | Exact provider resource/API field | Normalization and required rejection |
|---|---|---|
| Function identity/profile | Functions v2 `Function.name`, `environment`, `state`, `buildConfig.runtime`, `entryPoint`; `serviceConfig` | Exact planned Function name, `GEN_2`, `ACTIVE`, `nodejs22`, expected entry point. Reject wrong/missing identity/runtime/state. Do not infer Run execution environment from Function GEN_2 |
| Declared source | Functions v2 `buildConfig.source.storageSource.{bucket,object,generation}` | Exact bucket/object match resolved source; when declared generation is supplied, it must equal resolved generation. No tag/path-only proof |
| Fixed source | Functions v2 `buildConfig.sourceProvenance.resolvedStorageSource.{bucket,object,generation}` | All three fields required; generation a positive decimal string. Reject missing or conflicting fields; preserve raw response |
| Source bytes | Storage JSON v1 object `bucket`, `name`, `generation`; generation-specific media GET | Match fixed source exactly; retain ZIP SHA-256 and reviewed member inventory. Reject extra/missing/duplicate/traversal/symlink members or changed bytes. No unknown source execution |
| Build association | Functions v2 `buildConfig.build`; Cloud Build v1 `Build.name`, `id`, `status`, `serviceAccount`, `startTime`, `finishTime` | Packet requires exact Function→Build name, ID suffix, `SUCCESS`, approved account and coherent times. Existing resource helper permits only the selected project's ID/number prefix; do not generally rewrite raw names or accept another project |
| Build-native source proof | Cloud Build v1 `sourceProvenance.resolvedStorageSource` | Packet compares all three fields with Function source and Storage metadata. Missing is unresolved/reject. Functions source alone is not an implemented replacement |
| Build output | Cloud Build v1 `results.images[].{name,digest}` | Packet requires selected application digest and corresponding image name. `buildStepImages` are builder inputs, not application output. Missing output rejects; success status cannot substitute |
| Registry identity | Artifact Registry v1 `DockerImage.name`, `uri` | Required reviewed mapping is exact project/location/repository/**package@digest** and URI equal to selected immutable revision image. Current packet incorrectly expects digest-only name and rejects actual URI grammar; see E. No alias/tag-only acceptance |
| Desired execution image | Run v2 Service `template.containers[0].image` | Production observer requires exactly one application container, same-project `@sha256:<64 lowercase hex>` URI. Tagged/missing/malformed image rejects even if revision is pinned |
| Revision execution image | Run v2 Revision `containers[0].image` | Require concrete digest and exact desired/serving execution-spec equality. Missing image/digest, different digest/package/project or extra container rejects. Two consistently wrong image identities still require separate provenance validation |
| Build destination | Run v2 Service `buildConfig.imageUri`, when present | Current observer requires equality to desired template image. It is not proof of running image. Preserve current check pending evidence/review; no automatic substitution of tag with revision digest |
| Run Build/source configuration | Run v2 Service `buildConfig.name`, `sourceLocation`, `functionTarget`, `serviceAccount`, `enableAutomaticUpdates`, `baseImage` | When reported, compare Build, source, principal, target and runtime-update policy with Function; retain unknown-field rejection. Existing sourceLocation check allows exact generation URI or same bucket/object without generation; no inference that the latter independently proves generation consumption |
| Revision source metadata | Run v2 Revision `containers[0].buildInfo.{functionTarget,sourceLocation}`, when present | Output-only metadata must match exact target and generation-specific Function source. No Build ID is present here. Strip buildInfo only for desired/serving writable-spec comparison after validation; retain it in raw evidence/config digest |
| Execution environment | Run v2 Service `template.executionEnvironment` and Revision `executionEnvironment` | Production observer requires explicit `EXECUTION_ENVIRONMENT_GEN2` on both. Missing, UNSPECIFIED, GEN1 or unknown value rejects. No defaulting, copying GEN_2, or assuming 512Mi implies GEN2 |
| Reconciliation | Run v2 Service `generation`, `observedGeneration`, `reconciling`, `terminalCondition`; Revision `conditions` | Equal nonzero Service generations, no reconciling, terminal Ready succeeded; allowed revision conditions succeeded and one Ready required. Failed/pending/unknown/duplicate conditions reject |
| Selected revision | Functions v2 `serviceConfig.service`, `revision`; Run Service `name`, `latestCreatedRevision`, `latestReadyRevision`; Revision `name`, `service` | Exact cross-resource association: service plus Function revision ID equals returned revision resource and both latest pointers. Reject stale/unexpected/replaced service/revision. Packet additionally requires service UID/etag and restore ownership continuity |
| Traffic | Run Service `traffic[]`, `trafficStatuses[]`; Function `allTrafficOnLatestRevision` | One 100% untagged target/status, allowed latest or explicit-revision allocation, selected revision ID matches status/explicit target; latest-created=latest-ready. Reject splits, tags, wrong/missing status or unknown allocation; desired traffic alone is insufficient |
| Capacity/account/target | Function `serviceConfig` versus template/revision serviceAccount, timeout, concurrency, limits/scaling, environment/target | Exact cross-resource equality and approved configuration. The existing effective min=0 comparison is confined to omitted protobuf scalar minimum; never extend it to execution environment, image, account or provenance |
| Expected application identity | Generation-specific source archive's actual Option B build record/runtime inventory; nine-endpoint inventories; approved target/build/config digests | Full observer validates policy-controlled, clean schema 2/v3 build and payload hashes, same build/bytes across nine endpoints, Firebase project/database identity and separate configuration approval. Probe metadata or a synthetic backendBuildId cannot certify this boundary |
| Retrieval integrity | Original response bytes, request method/URL/status/time/hash, all pages, repeated snapshots and approval | Preserve raw evidence. Failed/inaccessible/empty/partial/ambiguous responses are not absence or success. Existing full observer repeats snapshots/inventories; transport-envelope validation and duplicate raw-key ingestion still need an explicit checkpoint adapter (G). Never refresh historical timestamps to appear current |

Unknown accepted-shape fields remain rejected. Project-number equivalence is allowed only where existing helpers explicitly permit it; exact Function names and cross-resource comparisons retain their existing semantics. No general canonicalization of package paths, URLs, traffic arrays or metadata omissions is proposed.

## B. Security property protected

The checkpoint must bind reviewed generation-specific source bytes to the expected successful Build and its selected application output, then bind that immutable output to desired execution, the actual selected revision and unambiguous serving traffic. It must also preserve explicit execution/account/capacity constraints and target identity.

This is consistency/traceability evidence within the blueprint's trusted deployer/provider boundary, not proof against a malicious privileged deployer and not runtime policy authority. A human review label or SHA-256 alone is not a provider attestation. Automatic base-image updates mean application-image identity does not establish immutable identity of every runtime byte forever.

## C. Provider evidence actually observed

The five files in `scripts/teacher-units-release/checkpoint-contract/fixtures/` are unaltered historical HTTP-200 response bodies. `manifest.json` pins original paths, URLs, timestamps and raw-byte SHA-256 values; it also pins the unchanged production observer and canonical read dependencies. No accepting provider fixture exists.

Observed A0: Function GEN_2/ACTIVE; resolved source generation `1793060245557807`; Build `b582e6c6-7b0d-4805-bc9a-3cdfcc9630c9` SUCCESS; Build `sourceProvenance: {}` and no `results.images`; tagged Run desired `:version_1`; revision digest `sha256:5317d17196d094288cc35424655ee4a2cd7c4f96ec1f27d4658882fc50d05f0d`; both Run executionEnvironment fields absent. Revision `optionbdeploymentprobe-00001-bat` was latest-created/latest-ready with 100% serving traffic. Registry URI matched the revision digest. This is historical association, not a currently live resource.

B6b-4's later Build GET was semantically unchanged. Its Container Analysis state read said DISABLED; it did not retrieve provenance occurrences. Provider cleanup had removed the probe Function/service/revision/images/account. Source/build/log artifacts remain in retained evidence; image retention must not be assumed.

## D. Exact missing evidence

**UNRESOLVED PROVIDER EVIDENCE:**

1. Native Build resolved source and selected output records demanded by the packet are absent. The source-consumption/output-link properties matter; these exact JSON fields are one representation, not an intrinsic security property.
2. No independently reviewed equivalent replacement source-generation→Build→application-digest proof has been established. Build arguments/source labels/logs, Function/operation/Run associations corroborate the chain but are not an approved substitute.
3. No verified alternative provider-signed provenance for this probe was obtained. Disabled API/image deletion neither proves permission denial nor proves no historic attestation exists.
4. Explicit GEN2/digest pin acceptance/readback, later Firebase overwrite, retained-baseline restoration and buildConfig persistence have never been measured in the controlled probe.

The Build uses an explicit fetch/lifecycle path without top-level `source`/`images` declarations. That explains why the missing native fields are plausible; it does not prove exactly which source generation the unversioned fetch consumed. Keep qualification unresolved.

## E. Proposed supported mapping or evidence source

### PROVEN CORRECTION — registry resource identity

Current packet `checkpoint.cjs:133` expects `.../dockerImages/sha256:<digest>`. The actual valid name is:

```text
projects/lyfelabz-staging/locations/us-central1/repositories/gcf-artifacts/dockerImages/lyfelabz--staging__us--central1__option_b_deployment_probe@sha256:5317d17196d094288cc35424655ee4a2cd7c4f96ec1f27d4658882fc50d05f0d
```

The digest-only GET returned 400; GET of the provider-returned name returned 200. The [DockerImage v1 resource reference](https://docs.cloud.google.com/artifact-registry/docs/reference/rest/v1/projects.locations.repositories.dockerImages) documents package@digest identity.

B6b-4C additionally isolated `checkpoint.cjs:15`: its image regex permits only single separators between alphanumeric runs and rejects the **actual** `lyfelabz--staging__...` package URI. This is a directly related registry parsing defect, separate from absent Build fields. The existing production observer's digest regex accepts this URI; it remains unchanged.

**PROPOSED CORRECTION — smallest implementation:** in a separate reviewed packet revision, permit the exact approved probe package spelling (including its repeated separators), retain exact registry/project/repository/path/digest checks, and compare DockerImage.name with repository resource + `/dockerImages/` + the URI's validated **package@digest** suffix. Keep `DockerImage.uri === revision.containers[0].image`. Retain raw strings; do not rewrite provider JSON. Collector GET must use the validated provider-returned full name with correct path encoding. No general registry grammar expansion, cache-image acceptance, fallback repository or production observer change is included. Implementation/accepting mapping tests are proposed, not completed here.

### PROPOSED CORRECTION — additional provenance sources

Candidate future versioned evidence source: completed Functions operation (generation-pinned request and successful Build stage), Functions output build/sourceProvenance, Storage generation-specific bytes/inventory, exact successful Build/principal, Build-resource-bound complete lifecycle logs, exact registry package@digest, revision sourceLocation/image, and serving traffic. Every edge needs an explicit comparison and source trust statement.

A [documented signed provenance retrieval route](https://docs.cloud.google.com/build/docs/securing-builds/generate-validate-build-provenance) is a possibility, not evidence that this managed Build generated one. If obtained, require verified signature/trusted issuer, exact source generation, Build identity and subject digest; reject an unverified envelope or operator claim. Neither route is wired into acceptance here.

## F. Required fail-closed behavior

Retain rejection for missing/unsupported Run environment, tagged desired or revision image, missing/malformed digest, image/spec disagreement, wrong revision/latest pointers, traffic ambiguity, missing source/Build/image/provider evidence, unapproved source/runtime settings and inconsistent/drifting snapshots. No last-good fallback, empty-success default, qualification flag override or timestamp refresh.

A0 may be retained as an observed pre-pin state, but cannot pass the production execution profile or provenance qualification. The current production observer's `buildConfig.imageUri === desired image` check remains in force. If a later pin leaves tagged buildConfig alongside pinned desired execution, stop for review rather than stripping that field. Its destination semantics do not themselves authorize changing the check. [Run BuildConfig](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services#BuildConfig) and [revision Container/BuildInfo](https://docs.cloud.google.com/run/docs/reference/rest/v2/Container#BuildInfo) have different evidence roles.

## G. Focused test coverage

Run only the new local suite through:

```sh
/Users/breezy/.nvm/versions/node/v22.23.3/bin/node scripts/teacher-units-release/checkpoint-contract/run-tests.cjs
```

The trusted launcher uses the hash-pinned canonical Seatbelt profile and unchanged 13-case OS boundary suite, then runs only `checkpoint-contract/test.cjs`, sequentially with test concurrency 1. No canonical writes. No cloud clients/credentials/environment; kernel denies network/process-fork and writes outside disposable work. Applying Seatbelt requires the approved outer-sandbox exception on this host; failure blocks tests with no unsandboxed fallback. Historical packet/installed compiled local libraries are prerequisites, not rediscovered SDK dependencies.

The suite tests existing exported observer and packet functions. All accepting controls are explicitly synthetic subcheck scaffolding, including synthetic qualification booleans; they do not represent human review or provider approval. Retained A0 remains an immutable negative fixture. This is not a full nine-endpoint certification run.

| Required case | Executed coverage |
|---|---|
| Missing Build provenance | Missing/empty resolved source; missing results.images despite step digests; missing Build/proof; booleans do not bypass assertions |
| Incorrect registry identity | Wrong legacy resource name/digest/URI; separate existing failures for real URI grammar and package@digest resource mapping |
| Missing/unsupported execution environment | Revision/template omission; GEN1, UNSPECIFIED and unknown enum |
| Tagged desired image | Rejects desired tag even with concrete revision digest |
| Missing digest | Revision path without digest, missing desired image and malformed digest |
| Image mismatch | Desired/serving digest disagreement, cross-project image, registry URI disagreement |
| Revision mismatch | Wrong revision, wrong Function pointer, latest-created/latest-ready disagreement/missing pointer |
| Unexpected traffic | Split, non-100%, tagged route, wrong revision, unknown allocation and missing status |
| Missing provider evidence | Absent Function/Service/Revision/source/Build/image/checkpoint; injected inaccessible-read error propagates |
| Ambiguous/inconsistent evidence | Duplicate endpoint inventory, duplicate/contradictory readiness, generation/snapshot/source inconsistency, unknown field and mismatched build source |

Four **TODO declarations** are proposals, not executed assertions: corrected registry acceptance and full negative matrix; replacement provenance contract; raw transport-envelope/partial-page/duplicate-key boundary; controlled staging pin/redeploy/restore. The duplicate-key parser unit assertion does not claim the current GET adapter validates raw response bytes before parsing. No production behavior was altered to make an unresolved proposal pass. Exact TAP counts/results and hashes are in the review handoff/evidence packet.

## H. Remaining provider questions

- Can supported retained evidence establish exactly which source generation was consumed by the build's unversioned fetch, at the same assurance as the old native source contract?
- Is there an accessible signed provider attestation binding that generation, this Build and the selected output digest? What actually survived image cleanup?
- Does explicit Run GEN2/digest configuration work on this Functions-managed service, and what do all raw readbacks report?
- Does buildConfig.imageUri track a template-only pin or remain a tagged build destination? Does Firebase replace/preserve it on redeploy and restore?
- Under automatic runtime updates, which application/base-image relationships remain observable over time?

No API enablement, IAM expansion, deployment or PATCH is authorized to answer these here. Do not reopen completed identity-generation, IAM, SDK-discovery or P0 work without contradictory evidence.

## I. Minimal implementation scope

This operation adds only this proposal, the independent-review handoff, immutable negative fixtures/manifest, and an isolated focused test runner/suite. It does not implement a new acceptance adapter or edit existing production/canonical source.

After independent approval, a separate packet revision may change only its digest URI validation, DockerImage resource-name comparison and collector name construction; retain source/Build/output/freshness/ownership checks. A replacement provenance representation requires a separate explicit schema/version, authenticated evidence ingestion and reviewed edge comparisons; it must not be hidden inside the naming fix. Existing production `option-b-observation.cjs` and tests remain reference material. Full nine-endpoint/archive/configuration/Rules/IAM release requirements remain separate gates.

## J. Conditions for the next staging experiment

Independent review must approve the registry mapping and any replacement evidence contract, resolve or explicitly block missing provenance, and review focused rejection results. A separate exact-resource staging authorization must then define probe ownership, operation bounds, approved source, principal/runtime permissions, cleanup/retention and stop rules. This proposal supplies no authorization or passing qualification.

Before any planned pin, collect fresh complete Function/Build/source/image/service/revision evidence with stable repeated reads and a qualifying provenance path. Preserve etag/UID ownership checks; old A0 snapshots cannot be relabeled fresh. ValidateOnly/readback and explicit GEN2/digest evidence must precede claiming compatibility; later source redeploy and restoration require their own bounded checks. Stop immediately on missing proof, unexpected resource/identity/traffic, source/digest drift, unresolved buildConfig mismatch, broader permissions or unapproved provider effects. Keep the probe permanently refusing and My Units unavailable; no production rollout or availability-policy change follows from this experiment.
