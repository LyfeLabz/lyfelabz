# My Units release readiness and operator runbook

## E2 simplified release and operator workflow

Active as of October 27, 2026 in LOCAL UNCOMMITTED source only. E2 supersedes older statements requiring the real-enable interlock, custom checkpoint/Build-provenance/registry qualification, exact desired/running image equality, explicit Run executionEnvironment and per-application-build Rules approval coupling. Historical evidence remains readable. No deployed state changes until separately authorized operations.

**Release preparation**

1. Owner selects the coherent release commit from the dirty tree; use a clean exact-commit checkout with installed dependencies. No automatic bulk commit. Build/check serially, at most two Jest workers.
2. E3 requires explicit staging authorization. Inspect current staging policy; close an enabled schema-1 marker with the retained legacy marker tool and verify old management refusal BEFORE replacing endpoints. Never enable through that marker. E2 does not run this migration.
3. Prepare a schema-2 configuration JSON with fields `kind: lyfelabz.teacherUnitsOptionBConfigurationApproval`, `schemaVersion: 2`, `projectId`, `backendBuildId`, `sourceSha`, `settings`, `automaticUpdatesAccepted: true`, `principalSubject`, `decisionRef`, `reviewedAt`. `settings` contains `runtimeServiceAccount`, `timeoutSeconds`, `maxInstanceRequestConcurrency`, `availableMemory`, `availableCpu`, `minInstanceCount`, `maxInstanceCount`, `ingressSettings: ALLOW_ALL`, and the reviewed user `environmentVariables` map. Provider-generated target/project variables are checked separately. Use actual reviewed settings, not invented fixture values. Unknown harmless provider metadata is retained, not a certification requirement.
4. Retain a clean compatible CLOSED-ONLY source ZIP with its actual schema-2 build record, source SHA and SHA-256; inspect the actual bytes before activation. A policy-controlled archive plus a currently closed policy is insufficient emergency recovery if policy writes fail. Keep the controlled artifact separately. Build both sequentially from the reviewed source. Default Functions build is closed-only. To deploy the controlled artifact, keep `A3_BUILD_PROFILE=policy-controlled` and `A3_EXPECTED_SOURCE_SHA=<reviewed SHA>` set through Firebase predeploy, which rebuilds. A controlled build never enables availability.
5. Deploy only `teacherUnitsArchive`, `teacherUnitsCapabilities`, `teacherUnitsCreate`, `teacherUnitsGet`, `teacherUnitsList`, `teacherUnitsReorder`, `teacherUnitsRestore`, `teacherUnitsSetResources`, `teacherUnitsUpdate`. Always pass `--project lyfelabz-staging` or `--project lyfelabz-prod`, `--config firebase.json`, and the exact nine `functions:<name>` entries to `--only`. No bare Functions deploy and no manual Cloud Run PATCH. A partial/mixed deployment stays closed.
6. Retrieve the actual deployed Rules source. Use Rules approval schema 2: the previous Rules schema minus `releaseSourceSha`, `backendBuildId`, `hostingArtifactFingerprint`, `placementFingerprint`. Retain exact project/default database, local/deployed hashes and bytes, ruleset resource, complete existing denial/equivalence report, review and report digest. The report format/matrix is unchanged. Reuse this record while the tested source and relevant assumptions stay unchanged. An actual access allow requires a separate targeted decision; different bytes alone do not justify deploying Rules. Required Teacher Units index groups are checked; unrelated index inventories do not block this release.
7. The existing prepare/certify commands retain `--intent teacher-units --rules-approval <schema2.json> --rules-report <report.json> --approval-digest <digest> --configuration-approval <schema2.json>`. Compute the Rules record digest with `digestApproval` from `scripts/teacher-units-release/option-b-rules-evidence.cjs`. This is content consistency, not a signature or a new review ceremony. Prepare, predeploy and certify all use the active verifier; do not use a general-intent fallback or skip flag. Deploy BOTH Hosting targets with `--only hosting:app,hosting:marketing`; staging Hosting uses `--config firebase.staging.json`, production Hosting uses `firebase.json`. Retain the previous live pair before deployment and inspect served bytes afterward.

Live channel verification uses the documented [Channel.release resource](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.channels). E2 uses read-only Hosting APIs; no provider API changes are needed.

**Current-release record**

Retain one private JSON record, assembled from the actual candidate, certification output and named human decisions. Its exact fields are:

- `kind: lyfelabz.teacherUnitsOptionBCurrentReleaseEvidence`, `schemaVersion: 2`, `projectId`, `policyInstanceId`, `policyGeneration`, `backendBuildId`, `placementFingerprint`, `approvalRef`, `preparedAt`, `observedAt`.
- `candidate` from the paired build; `observation`, `configurationApproval`, `rulesApproval`, original `rulesReport` JSON text and `approvalDigest`; `certifiedReceipt` from the certification output's `evidenceReceipt`. Schema-1 records never qualify.
- `hosting: {projectId, observedAt, app, marketing}`. Each surface contains actual `site`, `origin`, `version`, `files` (relative paths to SHA-256 hashes). Use the complete expected pair inventory from the build. Pre-enable independently reads the live channels and those served bytes; it does not trust the saved hashes as current observations.
- `review: {principalSubject, decisionRef, reviewedAt, iamScopeAccepted: true, routingAccepted: true, automaticUpdatesAccepted: true, purpose}`. Purpose is exactly `staging-validation` for staging or `production-activation` for production; decisionRef equals the explicit approvalRef. This records the actual accepted operator/route/runtime scope, not a claim of cryptographic attestation.
- `provenance: provider-observed` only for actual evidence. Synthetic test fixtures are not deployment evidence. No serialized credential verdict is accepted by the CLI.
- `rollback: {projectId, backendBuildId, sourceSha, deploymentMode: closed-only, artifactRef, artifactSha256, verifiedClosed: true, hosting: {app, marketing}}`. artifactRef is an absolute private path to the retained closed-only source ZIP. The CLI hashes/inspects this file and checks build/placement compatibility before activation. Both Hosting rollback versions must match the certified receipt's previous versions. verifiedClosed records verification of the compatible closed-only fallback using the build/profile and denial checks; it can precede staging activation. The actual staging enable/close rehearsal is recorded separately in production stagingAcceptance.
- `stagingAcceptance` is null for a bounded staging validation enable. Production requires `{projectId: lyfelabz-staging, sourceSha, decisionRef, acceptedAt, teacherWorkflowsPassed: true, securityTestsPassed: true, shutdownRehearsed: true}` for the same reviewed source. Never fabricate acceptance to start staging; the distinct purpose prevents that circular requirement.

Human decisions and Rules reports are trusted release records, not provider-signed proofs. The tool refreshes backend/Hosting observations and validates the retained closed-only artifact each time; it never renews review, certification, Rules-test or acceptance timestamps. Changed security-relevant facts require a new dry-run/confirmation. Defaults remain a five-minute current observation, 24-hour preparation and ten-minute saved confirmation; exact policy CAS is rechecked transactionally. These checks do not eliminate provider changes occurring after observation.

**Operator commands, only under separate external authorization**

Use `node scripts/teacher-units-release/cli.cjs availability <command>`. Every cloud command requires `--live --project <exact project> --credentials <private direct service-account JSON> --access-review <private access-review JSON>`. Existing supported credential verification pins the actual token subject, project number and required permissions; it never creates accounts, grants IAM, discovers a browser principal or trusts an operator-label argument. `--live` allows connection; it never by itself enables or writes.

- `show`: read current policy/history. Missing/unreadable state is never claimed enabled or safely closed.
- `prepare --build-root <clean Functions artifact> --expected-source-sha <SHA> --release-prepared-at <UTC> --reason <reason> --out <private plan>`: dry-run only. First initialization creates closed generation 1 without an approved build; after executing that plan, a second prepare pins the build while remaining closed. A legacy/malformed policy requires separate `recoverClosed` with exact recovery authorization.
- `checkEnable --current-release-evidence <record.json> --approval-ref <decision>`: read-only current verification. It prints explicit-confirmation-required, not activation permission.
- `enable --current-release-evidence <record.json> --approval-ref <decision> --reason <reason> --out <private enable-plan.json>`: authenticate, verify the prepared closed policy/current release and save a dry-run plan. No write. Review its target, expected CAS, proposed mode, transition ID and confirm digest.
- `enable --current-release-evidence <same record.json> --plan <enable-plan.json> --execute --confirm <exact digest>`: repeat current checks and operator authentication, require unchanged release identity/exact policy CAS, then atomically write policy, history and canonical audit. The command/target are bound to the saved plan. Do not automatically rebase stale plans. A status of unconfirmed/conflicting is nonzero and is not success.
- `verify --plan <saved plan>`: reconcile exact transition/history/audit after a lost acknowledgement. Replay of an already committed real enable returns its current/superseded status without reenabling a later closed policy.
- `close --reason <reason> --out <private close-plan.json>`, followed by `close --plan <close-plan.json> --execute --confirm <digest>`: independent emergency closure. No current-release record, registry, provenance, Hosting or rollback archive is needed. Check committed-current with shutdownConfirmed, then verify callable denial across all serving routes. A preexisting closed policy may return verified-noop. MAX generation or malformed policy requires separately authorized recoverClosed; failure/unconfirmed write is never closure.

Plans include private before-state and are saved create-only with mode 0600. Keep the exact saved plan and release record in approved private storage for reconciliation; do not publish credentials or student data. Policy/history/audit are transactional; history is not tamper-proof against trusted Admin writers. Backend closure is authoritative. A Hosting rollback alone cannot disable server access.

If close cannot be confirmed, deploy the retained compatible closed-only build across all nine endpoints under explicit recovery authorization and verify all routes; never restore the legacy-marker runtime. Restore both recorded Hosting versions if required. Preserve units/receipts/audits. Re-enable requires fresh explicit approval.

**E3 and production boundaries**

Next: E3 staging preparation/closed rollout, with real credential support, deployed Rules denial, actual endpoint generation/region migration checks, required indexes, legacy marker closure, nine closed Functions and paired Hosting verification. E3 does not implicitly authorize staging enable or production work. Later staging workflow/security/shutdown acceptance authorizes only its bounded test window. Production deployment is separately authorized and CLOSED; production activation needs its own named decision and failure-close authority. E2 changed local code only and supplies no cloud evidence or activation approval. No broad audit or provider-provenance experiment is a prerequisite.


## Historical B1 Option B operator and release workflow

Status at B1h, October 26, 2026: B1a-B1g are local implementations, uncommitted and not independently reviewed. B1h changes documentation only. These templates describe supported interfaces for **later separately authorized operations**. They were not executed during B1h and authorize no cloud read/write, deployment, activation or IAM change. An uncommitted dirty working tree is not a distributable release candidate.

Current contracts: [Teacher Units](TEACHER_UNITS.md), [ADR](ADR_MY_UNITS_OPTION_B_TRUSTED_OPERATOR_AVAILABILITY.md), [blueprint D-F/G6](MY_UNITS_OPTION_B_IMPLEMENTATION_BLUEPRINT.md), [Hosting pairing](DOMAIN_AND_HOSTING_CONTRACT.md). Review package: [B1h integrated handoff](MY_UNITS_OPTION_B_IMPLEMENTATION_BLUEPRINT.md#b1h-integrated-review-handoff).

### Credentials and explicit target

Every operator invocation supplies literal `--project lyfelabz-prod` or `--project lyfelabz-staging`; aliases/defaults, ambient target conflicts, and cloud/emulator mixing refuse. Project IDs/numbers are pinned to production `182791689935` and staging `293337283840`, region `us-central1`, database `(default)`. No ordinary browser, teacher or application administrator can perform operator transitions.

`cli.cjs availability` dispatches to `availability-control.cjs`. The supported real operator credential profile is explicit direct service-account JSON via `--credentials`, with `--live` and private `--access-review`. It independently checks effective token email/verification, expiry/scope, provider project identity and effective permission responses. User/browser/impersonated or ambiguous profiles refuse. No credential bytes belong in plans, audit, logs or documentation. Token/provider behavior and inherited rights still require authorized real-world acceptance.

The access-review JSON has exactly `schemaVersion:1`, `projectId`, `projectNumber`, `databaseId`, `principalSubject`, `permissionCheckScope:"project"`, `blastRadiusAccepted:true`, `approvalRef`. It must match the independently verified subject and target; its retained owner decision accepts the actual project-level blast radius. It is not authentication by itself. Unverifiable conditional grants refuse; the tool neither grants IAM nor widens scope.

`verify` requires `datastore.databases.get` and `datastore.entities.get`. `show` also requires `datastore.entities.list`. Transitions and persistence-read-only `checkEnable` additionally require `datastore.entities.create` and `datastore.entities.update`. This permission profile does not prove collection-scoped exclusivity, safe inherited impersonation, or effective IAM least privilege. Review actual holders/roles/conditions before external use.

Hosting release observation uses the existing selected `gcloud auth print-access-token` read transport (or an injected test transport), after explicit project/candidate/evidence validation. This is distinct from the operator's explicit service-account profile. No observer token or receipt authorizes policy mutation.

### Inspect, initialize and prepare

Templates use placeholders that must be replaced with reviewed private inputs. Run only under separate external authorization:

```sh
node scripts/teacher-units-release/cli.cjs availability show \
  --project '<PROJECT>' --live \
  --credentials '<PRIVATE_SA_JSON>' --access-review '<PRIVATE_ACCESS_REVIEW_JSON>'

node scripts/teacher-units-release/cli.cjs availability prepare \
  --project '<PROJECT>' --live \
  --credentials '<PRIVATE_SA_JSON>' --access-review '<PRIVATE_ACCESS_REVIEW_JSON>' \
  --build-root '<ABSOLUTE_FUNCTIONS_ARTIFACT_ROOT>' \
  --expected-source-sha '<APPROVED_40HEX_SHA>' \
  --release-prepared-at '<UTC_ISO_MILLISECONDS>' \
  --reason '<REASON>' --approval-ref '<OWNER_DECISION_REF>' \
  --out '<NEW_PRIVATE_PLAN_JSON>'
```

`show` reports observed schema-2 policy and a bounded recent history window; missing/invalid/unreadable state is not confirmed shutdown. `prepare` inspects exact clean `policy-controlled` schema-2 build bytes and source SHA; preparation evidence must be no older than 24 hours and never future-dated. A missing singleton first initializes UUID/generation 1 **closed and unprepared**, with null approved build and empty contracts. After verified initialization, make a second fresh prepare proposal to select the build. Existing valid closed preparation increments generation only on a real change; a no-op writes nothing. Never silently convert malformed or legacy marker state.

A proposal is dry-run by default. Review target, operator, exact updateTime/instance/generation CAS, transition UUID, build/placement and confirmation digest. `--out` creates a private, new-only plan file. Confirm and verify the same command ID:

```sh
node scripts/teacher-units-release/cli.cjs availability prepare \
  --project '<PROJECT>' --live \
  --credentials '<PRIVATE_SA_JSON>' --access-review '<PRIVATE_ACCESS_REVIEW_JSON>' \
  --plan '<SAVED_PRIVATE_PLAN>' --execute --confirm '<EXACT_CONFIRMATION_DIGEST>'

node scripts/teacher-units-release/cli.cjs availability verify \
  --project '<PROJECT>' --live \
  --credentials '<PRIVATE_SA_JSON>' --access-review '<PRIVATE_ACCESS_REVIEW_JSON>' \
  --plan '<SAME_SAVED_PRIVATE_PLAN>'
```

Execution requires the same verified operator/credential subject, unchanged CAS, valid transition, and confirmation age at most ten minutes. The transaction stages policy, create-only history and canonical operator audit together. Failed history/audit staging cannot be reported as a partial successful transition. Verification independently reads all three linked records.

### Current release and Rules preflight; enable remains blocked

`option-b-observation.cjs` validates current nine-endpoint schema-2/v3 artifacts, exact project/build/placement and reviewed configuration. The Rules attachment is strict duplicate-free JSON of kind `lyfelabz.teacherUnitsOptionBRulesApproval`; G6 binds release SHA/build/Hosting/placement, local source hash, exact deployed ruleset resource/hash, report bytes/digest, tested byte pair and reviewer/owner reference. `exact` needs equal local/deployed hashes. `reviewed-equivalent` accepts only the explicitly approved pair with the complete dual-source passing matrix and full-diff review. Even equal bytes at a different ruleset resource require fresh approval. No hash stripping, normalization or skip flag is supported; a mismatch never authorizes deploying Rules.

The configuration approval binds the actually observed configuration digest, including reviewed Run `buildConfig` and runtime-update posture. The current-release bundle also binds policy UUID/generation, a certified B receipt, current paired served file hashes, and explicit effective-IAM/routing/runtime residual review. Old receipts/signatures and synthetic production evidence refuse. Provider observations/Hosting evidence expire after five minutes; preparation/certification/review bounds are checked separately. No finite emulator matrix proves arbitrary Rules equivalence or actual deployed-source acceptance.

```sh
node scripts/teacher-units-release/cli.cjs availability checkEnable \
  --project '<PROJECT>' --live \
  --credentials '<PRIVATE_SA_JSON>' --access-review '<PRIVATE_ACCESS_REVIEW_JSON>' \
  --current-release-evidence '<PRIVATE_CURRENT_BUNDLE>' \
  --approval-ref '<OWNER_DECISION_REF>'
```

`checkEnable` needs a prepared closed policy. It refreshes provider backend observations with bound credentials, validates retained independent Rules/Hosting/IAM evidence, then rereads policy CAS and operator context. It does not fabricate refreshed Hosting/review dates. Its result is consistency evidence only: `liveEnable:"interlocked"`, `authority:"none"`, `shutdownConfirmed:false`, `fleetVerification:"not-performed"`.

**There is no executable real-project enable workflow in this candidate.** CLI enable refuses before connection; controller proposal/execution also interlock. No flag, environment variable, synthetic fixture or successful preflight lifts that protection. A later separately authorized, independently reviewed source correction is needed to make a real enable path operational; an owner activation decision alone cannot bypass the current interlock. Demo transitions exist only through explicit local test injection, not a supported real-target shortcut.

### Closure, unknown outcomes and recovery

Emergency close does not load signed evidence, build artifacts, Hosting or release observations. Use `availability close` with the same explicit binding/credentials, `--reason`, `--approval-ref` and a new private `--out`; review then execute the saved close plan with the exact digest, as in the prepare execution template. Verify that same plan afterward. Credential/IAM/database availability and CAS still apply; there is no unaudited bypass.

Results distinguish `committed-current`, `committed-superseded`, `verified-noop`, `not-committed`, `conflicting` and `unconfirmed`. A timeout/refusal after dispatch is not proof a write failed. Keep the original plan/transition ID, reconcile linked evidence with `verify`, and do not automatically rebase/resend or create a new command. `committed-superseded` reports current observed availability, not the older transition as current. Missing policy is not a verified successful shutdown. Verified closed results are schema-2 policy/history/audit scoped; they do not prove fleet routing, compatible deployed code or recall of earlier data/writes.

Enabled generation `Number.MAX_SAFE_INTEGER` stays enabled. Ordinary close reports **still enabled; recovery required**. Separately authorize `recoverClosed`: bind exact target and observed updateTime/UUID/generation, fresh replacement UUID, placement, verified operator, reason and decision reference in `--recovery-authorization '<PRIVATE_AUTHORIZATION_JSON>'`; propose with `--policy-instance-id`, `--placement-fingerprint`, `--reason`, `--approval-ref`, and mandatory new private `--out`. The plan contains a private typed before-state snapshot; malformed raw data is not copied into canonical audit/history. Confirm within the normal CAS window and verify. Recovery creates generation 1 closed, null build and empty contracts; it neither resets an enabled instance silently nor implies a successful close before verified persistence. Re-prepare separately afterward.

### Release sequence and remaining acceptance

Local build/test, staging certification, closed production deployment, activation approval and verified production availability are distinct states. B receipts explicitly report activation not approved, availability not verified and fleet verification not performed. Before any external operation: complete the integrated B2 review, select an exact reviewed clean source/dependency candidate and separately authorize the relevant environment/scope.

For later authorized B preparation/certification, use explicit `--project`, `--intent teacher-units`, and private `--rules-approval`, `--rules-report`, `--approval-digest`, `--configuration-approval` inputs. Preparation supports `--expect-sha`; certify reuses the prepared source/evidence and paired baselines. The same controlled compiler/backend profile is reconstructed by predeploy. `general` retains closed compilation and paired Hosting checks without a Teacher Units backend-readiness claim. The target-bound policy-capable profile, preparation and certification never enable policy.

Staging must reconcile all nine deployed builds, actual IAM/impersonation/routes/Run configuration, exact deployed Rules/report approval, indexes, both Hosting sites/served bytes and authenticated teacher/negative tenant/role/accessibility workflows. Close and verify the old staging marker before the reviewed closed replacement; explicitly recover fresh schema-2 closed state. New Rules deployment is conditional on a separately approved necessary change. Rehearsing real enable/close additionally needs the interlock implementation gate resolved and separate authorization. Production closed deployment, final activation and final availability/fleet observation remain later decisions. On failure close policy if possible, reconcile uncertainty, restore known-good compatible closed backend and both recorded Hosting baselines, then verify actual routes and cached-client refusal. Policy readback alone never closes this release gate.

## Historical A1 reference

The original A1 record below is preserved for historical eight-endpoint receipt/replay and closed-profile evidence. Its original source baselines, certification statements and both-intents-closed claims are version-specific, not the active B compiler or launch prerequisites. Legacy replay cannot authorize current B requests. General release safeguards and applicable source/import/paired-byte protections remain required.


# U2.6 A1 release evidence and deployment safeguards

## Scope and certification meaning

A1 extends the existing paired Hosting preparation, build hook and certification.
It executes no deployment, activation or callable invocation. Teacher Units remains
closed. Source baseline: `f52218d15a198b24b675fa6b9b26178626e344a8`, tree
`757d0e976a28366e9e2d55f0c697c38ab5c1bddb`.

Release intent is required explicitly when preparing and certifying:

| Intent | Prerequisites and resulting claim |
| --- | --- |
| `general` | Existing catalog, placement parity, artifact ownership, routing, shared bytes and paired-release checks. The controlled application build and all supported Teacher Units boundaries must be closed. Teacher Units readiness is **not evaluated**, with no backend compatibility claim. Its eight callables may be undeployed. No Functions build, gcloud token or backend inventory is required. |
| `teacher-units` | All general artifact/pair checks plus fresh independent evidence that the eight Teacher Units endpoint packages, placement, Firestore Rules and indexes match the candidate. Status is **compatible-backend-observed**, not activation approval, authenticated workflow certification or runtime semantic confirmation. |

Missing and unknown intent refuse; there is no default or fallback. Intent is an
operator's reviewed scope declaration, recorded with the exact artifact hashes.
Both intents compile closed; neither intent authorizes activation. The shared
`releaseAvailability.ts` boundary has no enabled production state. Bootstrap uses
a lazy factory; controller/seam, callable adapter, store and panel constructors
refuse before effects, and Curriculum ignores injected seams while closed.
The application compiler supplies a fixed closed implementation and permits only
the reviewed entry point/import consumers. Test-only enabled fixtures are excluded
from the production graph. Existing U1/U2 test fixtures are not activation evidence.

`app/dist/application-build.json` is deterministic (no timestamps), with policy,
intent, the closed **build-contract assertion**, compiler/options, builder
implementation hash, canonical availability identity/resolved imports, source and
replacement hashes, source extension inventory, input hashes/import graph, and
actual emitted output hash. Schema 2 / `teacher-units-canonical-closed-v2` declares
`availabilityEvidence: "build-contract-assertion"` and
`runtimeAvailability: "not-certified"`. The candidate/receipt repeats the assertion
category alongside `teacherUnitsAvailability: "closed"`; that field is not a
remotely verified or independently certified runtime claim. Both intents are separately
recorded. Candidate validation independently recompiles from current inputs and
requires exact evidence and bundle equality; a local state label is not authority.
The parsed application HTML script inventory must retain only its reviewed Firebase
configuration script and the controlled bundle. Additional/inline scripts, a
substituted bundle URL or a base element refuse; the full entry HTML hash is bound
to the Hosting copy. This is an entry configuration check, not arbitrary-code analysis.
The Hosting bundle hash must match this reconstructed output, and the candidate
binds the complete build evidence fingerprint and paired artifact fingerprint.
Preparation and certification use this same validation. Predeploy validates the
prepared artifacts before rebuilding, then validates the reconstructed candidate.
Missing, edited, stale, enabled, unknown, relabelled or substituted evidence refuses.
Rejected v2 source-regex and v3 suffix-loader evidence cannot satisfy the current
canonical build contract. Old build evidence, candidates and receipts refuse;
rebuild and prepare again. No rejected snapshot is amended.

## Canonical resolution and application source contract (A1 v4/v5/v6/v7)

The compiler intercepts availability **import resolution**, before esbuild's
extension/directory search. Only the exact canonical path
`app/src/teacherUnits/releaseAvailability.ts` (explicit `.ts` or extensionless)
is accepted, and it resolves to a private `teacher-units-availability-contract`
namespace. The namespace loader supplies the reviewed closed implementation.
A loaded-file suffix match is not the replacement mechanism. A separate refusal
check rejects any default-file load of that canonical identity (including an alias
or tsconfig path that evades the controlled import shape); it never supplies an
alternative implementation. Every dependency
edge to that module records the canonical identity, original specifier and importer.
Source hashes distinguish checked-in bytes from the replacement supplied to esbuild.

Before compilation, a recursive filesystem inventory of **all** `app/src` entries,
including untracked and hidden entries, permits regular `.ts` and `.json` files
only. This matches the inspected tree: 285 TypeScript files and four JSON data
files. Dependencies under `app/node_modules` retain ordinary package resolution;
this allowlist does not ban their legitimate JavaScript. The resolver extension
order is explicit in compiler options and bound to evidence.

Symlinks, other file types, unreviewed source extensions (including `.tsx`, `.js`,
`.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`) and shadow/duplicate availability names
refuse. Availability candidates in alternate directories, case variants, arbitrary
suffixes and directory forms refuse even if not imported. The only reviewed
same-stem exception is `releaseAvailability.test.ts`, which still cannot enter
the production import graph. Case-variant imports also refuse rather than letting
the host filesystem select an implementation.

The check runs in the application builder/reconstructor and before the supported
`npm --prefix app run typecheck` and `lint` commands. The existing auxiliary
runtime and lab-report build commands also run this inventory first. TypeScript
and ESLint continue
to cover `.ts`. JSON is not inherently inert: package browser mappings and tsconfig
paths can redirect compiled code away from the modules those verification tools
examine. The recursive source inventory prohibits `package.json`, `jsconfig.json` and every
`tsconfig*.json` filename under `app/src`, case-insensitively, at any directory
depth (including untracked/hidden directories). The four existing JSON data files
remain allowed; no nested configuration files existed in the inspected source.
No repository data files are deleted or rewritten. New source extensions require a
reviewed contract and matching compiler/linter configuration change. Calling raw
esbuild, raw tsc or raw eslint directly is not the certified release route.
Preparation, predeploy and certification independently reconstruct with this
builder, so an old safe bundle/receipt cannot conceal a newly added shadow.

The JSON configuration refusal executes before application/auxiliary builds,
TypeScript and ESLint via their existing source checks. Release preparation builds
first; candidate reconstruction, predeploy and certification run the same builder
and therefore refuse a newly introduced source configuration even when an older
bundle and receipt were valid. Builder/source-contract fingerprints change under
v5/v6/v7, requiring reconstruction/preparation; the closed availability implementation
and emitted artifact hash comparisons remain unchanged.

Repository-relative imports outside `app/src` are a separate, unenforced boundary.
The inspected source has no such imports, and its current compiled repository
inputs are `app/src` plus the reviewed HTML entry (dependencies are separate).
The builder currently accepts other inputs within the repository root. A synthetic
new `../shared/original` import with an outside `.js` implementation, `.d.ts`
declaration and `app/shared/package.json` browser redirect compiled different code
while root TypeScript checks still passed. JSON refusal inside `app/src` does not
cover this constructed equivalent; outside `.ts` imports alone normally trigger
TypeScript's `rootDir` check, but declaration-backed JavaScript can avoid it.
No Teacher Units activation was demonstrated. No outside import/configuration was
added to the real application, and no node_modules policy was changed. A future
bounded input allowlist and review/fingerprinting of trusted root resolver configs
need separate approval. Until then, source review must account for new outside
imports and root resolver configuration changes; evidence remains an assertion
about reconstructed artifacts, not verifier semantic equivalence for arbitrary
repository inputs.

V6 adds the exact `jsconfig.json` basename to the same case-insensitive refusal.
A nested jsconfig paths/baseUrl redirect to outside JavaScript can otherwise make
esbuild emit a different `firebase/functions` implementation from root
TypeScript/ESLint/Jest. The filesystem scan covers untracked and Git-ignored
source directories; it does not depend on the production Git dirty check.

The installed compiler is esbuild 0.24.2. Its resolver discovers `package.json`,
then `tsconfig.json` or (if absent) `jsconfig.json` in source directories. Arbitrary
config basenames are not auto-discovered by the fixed API options. `tsconfig*.json`
is a deliberate broader refusal; config `extends` cannot originate from a new
source tsconfig/jsconfig because those entry configs refuse. Root/ancestor
configuration and explicit trusted build-option changes remain separate boundaries.
[Resolver discovery source](https://github.com/evanw/esbuild/blob/v0.24.2/internal/resolver/resolver.go#L1470-L1517).

Yarn PnP supports `.pnp.data.json`, `.pnp.cjs` and `.pnp.js`, but the current
resolver's PnP lookup starts at the fixed `absWorkingDir` (`app`) and traverses
parents, not `app/src`. Executable PnP source suffixes already refuse. Local probes
confirm source-local JSON PnP and `jsconfig.build.json`/`esbuild.config.json` do not
redirect the current build. This is a compiler-version/setup finding, not a promise
that every JSON filename is inert. Root/ancestor PnP and resolver config provenance
are deferred; no dependency policy was changed.
[PnP lookup source](https://github.com/evanw/esbuild/blob/v0.24.2/internal/resolver/resolver.go#L480-L503).

The following remain deferred, without implying they are safe:

- Relative/import resolution outside `app/src`, and root/nested resolver config
  fingerprinting. Source config files are refused, but ancestor resolver metadata
  is not a separately certified identity.
- Git-ignored source directories: the source contract scans them, while Git's
  normal dirty check can miss changes in ignored files. Input artifact hashes and
  reconstruction do not make Git cleanliness an exhaustive source provenance claim.
- Auxiliary runtime/lab-report builds run the source check, but their full compiler
  paths and artifact evidence are outside the A1 main application contract.
- Unconditional guarded Teacher Units construction may throw and crash teacher
  bootstrap. Refusal prevents activation but does not establish graceful recovery
  for arbitrary caller changes.
- The eight callable endpoints are not protected by a client availability flag;
  server ownership/school/authorization checks remain essential while the UI is
  closed. No callable, authorization or Rules changes are part of V6.

V7 closes the demonstrated APFS Unicode resolver bypass. The inspected application
source has 313 entries (files and directories), all ASCII names; no required source
asset needs a non-ASCII filename. Before resolving or compiling, the same actual
filesystem inventory rejects every non-ASCII filename **component** below `app/src`,
including directory names, hidden/untracked/Git-ignored entries and NFC/NFD spellings.
It checks the names returned by the filesystem, without normalizing them into an
accepted spelling. The source root must have the literal `src` directory entry in
`app`; a Unicode/case alias of that root is not accepted. Repository ancestors and
dependency paths outside this source boundary are not subject to this new rule.
ASCII case variants of prohibited configs remain covered by the existing filename
rules. If a filesystem returns an ASCII-equivalent prohibited name, those rules
still refuse it.

The exact `pacKage.json` (U+212A) attack was reproduced against certified v6 on
macOS 27.0.1 case-insensitive APFS: ASCII `package.json` lookup succeeds and both
intents reconstructed redirected artifacts. V7 refuses it in the source contract
before writing a candidate. `jsconfİg.json` and `tsconfİg.json` (U+0130), previously
refused only by esbuild's failed ASCII lookup, now refuse in the source contract too.
Known normalized-name, directory-alias and ignored-path fixtures are covered. This
is a filename boundary, not arbitrary runtime-reachability proof; no source content
or ordinary ASCII-named JSON data is restricted by this change. Non-ASCII text
inside legitimate source/data remains permitted.

Both clean intent bundles remain byte-identical to v6; the builder and filename
policy evidence fingerprints change and require fresh preparation. No activation
mechanism or dependency-resolution architecture was introduced. The outside-source,
resolver-provenance, Git cleanliness, auxiliary evidence, bootstrap-crash and direct
callable findings above remain deferred.

The hashes of a constant replacement and the label `closed` prove neither runtime
reachability nor arbitrary JavaScript behavior. They identify what the controlled
builder supplied. Reconstructed emitted bytes and their Hosting hashes bind that
assertion to the candidate. Local compiled-bundle regressions on
`app.lyfelabz.com` check the reviewed constructors and Curriculum rendering;
they are synthetic browser harnesses, not authenticated staging certification.
The exact hostname-conditional `.tsx` exploit is demonstrated to enable a raw
esbuild bundle, while the controlled builder refuses it before emitting artifacts.

These safeguards cover the reviewed constructors and integration paths. They do
not prove every conceivable JavaScript path unreachable and do not replace source
review, callable authorization, or authenticated staging. Duplicated UI, new
unreviewed entry paths, or modified boundary/build tooling require review. Bundle
text scanning is not used as an absence proof. General releases require no
Teacher Units deployment; strict intent retains fresh authoritative backend checks.
A future activation mechanism is outside this operation.

Preparation, rebuilt predeploy artifacts and certification must have the same
intent and candidate. Changing scope requires new preparation. The configured
predeploy reads the online preparation record; it cannot silently select general
when a backend read fails. General readiness cannot become Teacher Units PASS.

U2.5 is integrated. RA-3D awaits certification/integration. U3.1/U3.2, RA-4/RA-5
and U4 grouping are not implemented. RA-3B retains shared publisher ownership.
None is made release-ready by A1.

## Identity and evidence boundaries

| Term | Meaning |
| --- | --- |
| Source revision | Local commit SHA and dirty status; uncommitted bytes are not an exact committed revision. |
| Local artifact | Built Hosting file hashes; Teacher Units intent additionally records compiled Functions and package hashes. |
| Candidate | Source identity, declared intent, Hosting/placement fingerprints and scope-specific inputs. It is not a deployed revision. |
| Remote revision | Independently retrieved Hosting version/routing/served bytes, or Functions build/service revision, traffic state and generation-pinned source archive. |
| Historical receipt | Timestamped observations and individual supported comparisons. It does not prove current deployment. |

Only literal project IDs are accepted. Aliases and gcloud's default project are
never deployment identity evidence.

| Environment | Project | Pinned number | Hosting sites |
| --- | --- | --- | --- |
| Production | `lyfelabz-prod` | `182791689935` | `lyfelabz-prod`, `lyfelabz-marketing` |
| Staging | `lyfelabz-staging` | `293337283840` | `lyfelabz-staging`, `lyfelabz-staging-marketing` |

Teacher Units inventory independently checks Firebase project ID/number/ACTIVE
state and native `(default)` Firestore. Backend resource names must identify that
project or its pinned number. Project recreation requires review of the pins.

Hosting reads `firebase hosting:sites:list --project <literal> --json` before
`hosting:channel:list`. Membership must identify `projects/<id-or-number>/sites/<site>`.
Channel/version responses may use documented `sites/<site>/...` or legacy
`projects/<id-or-number>/sites/<site>/...`. Both must identify the exact site;
short names are accepted only after independent membership proof. Wildcards,
wrong projects/sites, duplicate live channels, missing membership and malformed
versions refuse explicitly. Specifying a CLI project alone proves nothing.

General releases need Firebase CLI Hosting credentials only. Teacher Units also
needs `gcloud auth print-access-token --quiet` and read permissions for Firebase
project metadata, Cloud Functions v2 list/get, immutable source objects, Rules
release/ruleset source and Firestore Admin database/index/field inventory.
401/403, missing credentials, unavailable APIs and missing evidence refuse the
applicable scope. Tools do not log in, enable APIs, grant permissions or modify
remote configuration. Tokens and API error bodies are never stored or logged.

## Backend inventory and exact comparison

```sh
node scripts/hosting-release/backend-state.cjs --project lyfelabz-staging
# Production uses the explicit literal lyfelabz-prod.
```

Inventory performs GET/LIST reads and writes an ignored local observation on
success. It does not build, deploy or certify Hosting. Failure leaves prior files
historical; they are never used as current backend authority.

The required endpoints are `teacherUnitsArchive`, `teacherUnitsCreate`,
`teacherUnitsGet`, `teacherUnitsList`, `teacherUnitsReorder`, `teacherUnitsRestore`,
`teacherUnitsSetResources` and `teacherUnitsUpdate`.

1. Retrieve project/database identity and complete paginated Functions inventory.
2. GET each required GEN_2, ACTIVE Node 22 endpoint, with exact entry point,
   build/service/revision identity and all traffic on the latest revision.
3. Download `sourceProvenance.resolvedStorageSource` with an explicit object
   generation. List/stream the zip without extracting paths. Hash all
   `lib/**/*.js`, `lib/**/*.json`, `package.json` and `package-lock.json`, and the
   ordered placement resource IDs. Recheck endpoint metadata around retrieval.
4. Read active `cloud.firestore`, referenced Ruleset source and release again.
5. Read composite indexes, explicit field overrides and TTL fields, including
   pagination. Merge duplicate field observations only when identical. Normalize
   and take a second snapshot; changes refuse.

`u26-a1-exact-backend-artifact-v1` requires exact package file maps for all eight
endpoints, equal placement fingerprints, equal Firestore Rules bytes and equal
normalized deployed indexes/TTL configuration. The entire backend observation
must be at most five minutes old. Preparation and certification fetch backend
**after** long Hosting comparisons, preventing those comparisons from expiring
an otherwise fresh observation. Slow backend retrieval itself still refuses.

Functions outside these eight endpoints have inventory metadata only. Comparing
an entire uploaded package is conservative: an unrelated packaged code change
may require redeployment of the eight endpoints, but does not certify all other
Functions. The policy does not verify IAM, secrets, runtime environment values,
final container image, installed dependency resolution or response semantics.

Firestore Rules coverage is `cloud.firestore` only. **Storage Rules are not
retrieved or certified.** Reading a deployment source object through Cloud Storage
IAM does not establish Storage Rules compatibility. General Hosting has no
backend Rules or Functions compatibility claim.

No deployed git SHA is fabricated: Functions expose build/revision/provenance,
not independently proven source commit identity. Archive matches identify
packaged inputs, not the final running image. Indexes have no immutable release
ID: their evidence is retrieved configuration, resource names and readiness.

## Index normalization contract

Normalization follows the Firestore Admin REST contracts and the inspected global
firebase-tools **15.22.4** `lib/firestore/api.js` (`processIndex`,
`listFieldOverrides`, `makeIndexSpec`). The repository's
`platform/firebase/package-lock.json` pins **13.35.1**, which strips `__name__`
in `listIndexes` and omits newer metadata rather than using the same 15.x
`processIndex` normalization. These versions are not interchangeable evidence.
A1 compares direct Admin REST responses with its explicit supported normalization;
it does not claim that the repository CLI performs the same comparison. No CLI
upgrade is required or performed by A1. Supported Standard values normalize omitted defaults and
explicit `ANY_API`, `SPARSE_ALL`, `multikey:false`, `unique:false` equivalently.
Other density/API/uniqueness/multikey semantics and unknown metadata refuse.

The global `collectionGroups/__default__/fields/*` response is not a local
collection override. Its effective configuration must equal the three Standard
COLLECTION defaults (ascending, descending, array contains); changed defaults,
TTL, unexpected paths or uncertain inheritance refuse. It is not blindly
filtered out merely because a name contains `__default__`.

An explicit `indexConfig` with omitted `indexes` represents an empty repeated
list and normalizes to `[]`; a missing `indexConfig` remains uncertain. TTL-only
inherited configurations must identify the same project's global default and
return the supported effective indexes. Nonzero TTL expiration offsets refuse.
Single-field indexes must contain exactly their associated field.

Composite candidate normalization adds the CLI's `__name__` suffix when omitted,
using its last directional field (or ASCENDING when none). Already explicit
suffix order is preserved, so a different server suffix remains a mismatch.
Field order, query scope, array mode, TTL and meaningful differences are retained.
Vector, Enterprise, shard/search and unknown semantics require reviewed support,
not omission from a fingerprint.

## Operational sequence and local effects

Required tools: Node/npm and app dependencies for either scope, Firebase CLI for
live Hosting, plus gcloud/unzip and installed `platform/functions` dependencies
(including TypeScript and package lock) for Teacher Units comparison. Tests use
zip. Install dependencies separately in the isolated release checkout; the tools
do not install them or copy another checkout's generated artifacts.

Preparation builds the app bundle before app verification and Hosting tests.
The pair build writes ignored `app/dist`, paired Hosting output and
`dist/hosting-release/pair-build.json`. Teacher Units intent also clears/rebuilds
ignored `platform/functions/lib`. General intent never builds or clears Functions.
Predeploy rebuilds the same pair for each Hosting target. These are local effects,
not deployment; dependencies and ignored output must not be assumed portable.

1. Review candidate source, scope and environment. Production requires a clean
   checkout; staging can explicitly use `--allow-dirty` for investigation.
2. Only for Teacher Units scope, separately authorize/deploy needed compatible
   backend changes using the existing process, then resolve read-only inventory
   refusals. A1 performs no backend mutation.
3. Prepare with explicit intent, for example:

   ```sh
   node scripts/hosting-release/prepare.cjs --project lyfelabz-staging --intent general
   node scripts/hosting-release/prepare.cjs --project lyfelabz-staging --intent teacher-units
   # Production additionally pins the candidate:
   node scripts/hosting-release/prepare.cjs --project lyfelabz-prod --intent general --expect-sha <full-sha>
   ```

4. Inspect both live baselines, changes and the scoped receipt. Separately approve
   deployment. Preparation only prints the existing paired command; it does not
   execute it. `hosting:app,hosting:marketing`, explicit project/config and source
   message are preserved. Both baselines must be verifiable, including staging.
5. The existing `build-pair.cjs` Firebase predeploy hook reads the same project's
   online preparation, validates intent/candidate/age, rebuilds, proves current
   Hosting membership and, only for Teacher Units, retrieves backend again.
   Missing, old-schema, offline, wrong-project or changed preparation refuses.
6. After a separately authorized deploy, certify the same scope and checkout:

   ```sh
   node scripts/hosting-release/certify.cjs --project lyfelabz-staging --intent general
   # Backend-dependent release: --intent teacher-units
   ```

Certification checks recorded/local bytes, both live versions/messages/routing,
all served paths, homepages, redirects, routes and catalog navigation. Required
backend verification occurs before writing success, without scope fallback.

Local staging preparation may use `--offline [--allow-dirty]` with explicit intent.
It records `local-only-not-ready`, no evidence receipt and no deploy/certify
instructions. Production offline preparation refuses. Direct execution of
`build-pair.cjs` is the guarded Firebase hook; it needs online preparation and
Firebase's `GCLOUD_PROJECT`. For a local-only programmatic build call
`buildPair({intent:'general'})`; it does not provide online readiness.

## What the hook enforces, and what it does not

For Teacher Units intent, the configured hook enforces a compatible backend
**already observed deployed before Hosting proceeds**. It does not deploy the
backend, guarantee chronological order across arbitrary commands, or make a
combined Functions/Hosting deploy a supported dependency sequence. General
intent does not enforce Teacher Units deployment order because it makes no such
readiness claim.

Both target hooks run, but the paired release is **not atomic**. Certification
**detects**, rather than prevents, a partial live pair and issues historical
rollback references without writing success. Observations are not cross-service
transactions. Another deployment can occur after a check. Alternate configs,
Hosting clone/API operations and operator bypasses remain outside hook enforcement.

## Deterministic receipts and rollback

Pair/prepared/certified wrappers are schema 3. Embedded
`lyfelabz.releaseEvidenceReceipt` is schema 2. Object keys/unordered inventories
are canonicalized; ordered placement/index fields retain their meaning. Given
identical input/timestamps, receipt bytes are deterministic. Real retrieval IDs
and timestamps naturally differ. Schemas from the rejected snapshot must be
prepared again; old records cannot gain authority through relabeling.

Receipts include declared intent, environment/project, local candidate, both
Hosting observations and scoped backend claims. General receipts contain
`backend:null`, `compatibility:null`, `teacherUnitsReadiness:not-evaluated`.
Teacher Units receipts require actual compatible evidence. Each claim is only as
strong as its independently retrieved source. A saved receipt never substitutes
for a new current Teacher Units backend read.

Preparation expires after 24 hours; future/inconsistent timestamps refuse. Its
rollback sites, versions and receipt must agree with the same candidate/project.
The prior live baselines are **observed prior versions, not automatically
known-good rollback targets**. Review the ledger and prior certified receipt.

Rollback commands are printed, never executed, and restore **both sites**. Hosting
clone bypasses the build hook: verify project membership and compatibility for
the prior candidate before separately approving it. For Teacher Units scope,
retrieve fresh backend evidence and compare that prior candidate; refuse unknown
or incompatible evidence. General rollback still requires closed-feature scope
review and paired Hosting evidence. Do not treat an old receipt as current proof.

Hosting rollback changes no Functions/Rules/indexes. Backend rollback requires a
separately approved compatible redeployment; preserve application/audit data and
review retention of additive indexes. Old clients calling newer Functions and
new clients calling older Functions remain runtime risks. U3 draft endpoints
can silently ignore new fields; A1 does not implement an acknowledgment contract.

## Limits, live blockers and deferred work

Backend pagination is capped at 100 pages and 10,000 items per list. API response
bodies are streamed with 8 MiB JSON and 64 MiB archive limits; each GET has a
30-second deadline. Zip listings allow at most 10,000 entries and 8 MiB output;
selected files allow 16 MiB each and 64 MiB aggregate runtime data. Unzip commands
have 30-second deadlines. Unsafe/duplicate paths and incomplete runtime archives
refuse. Private temporary archives are deleted on success/refusal. Hosting CLI
reads have a 60-second timeout and 8 MiB captured-output limit. CLI internal
pagination is delegated to firebase-tools; whole-process bounds still apply.

If generation-pinned archives or API identities cannot be retrieved, Teacher
Units readiness refuses. A2's authenticated capability/fingerprint response is
the smallest later alternative; manually supplied hashes/labels/old receipts are
not independent proof. Final container attestation is deferred.

Offline fixtures prove normalization, scope separation and refusals; they do not
certify today's deployments. Operational certification still needs authorized
positive live responses from both environments and real source archives. The
previous staging Management API read returned HTTP 403; it establishes neither
current identity nor readiness. This remediation performs no live deployment.

A2: authoritative client/server capability confirmation and runtime fail-closed
behavior. A3: server availability/authorization posture, Rules policy decisions,
cache/environment safeguards and CI controls. Authenticated staging, accessibility,
activation approval and gate change remain C1/C2. U3 integration stays separate.
These are not implemented by remediation. Storage Rules/full-Functions coverage,
atomic paired release prevention and comprehensive dependency detection remain
outside A1's claims.

## Verification and references

```sh
npm --prefix app run build
node --test scripts/hosting-release/*.test.cjs scripts/app-hosting/build.test.cjs scripts/marketing-hosting/*.test.cjs scripts/unit-placement/check-parity.test.cjs
npm --prefix app run verify
npm --prefix platform/functions run typecheck
npm --prefix platform/functions run lint
npm --prefix platform/functions run build
npm --prefix platform/functions test -- --runInBand
```

All release tests inject API/CLI/credential transports; none deploys, changes
remote configuration or invokes a Teacher Units callable. Zip tests use synthetic
local archives. Application/Functions tests are also synthetic; they do not
replace authenticated staging certification.

- [Firestore Field, default, inheritance and TTL contract](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.collectionGroups.fields)
- [Firestore Index contract and server-added suffix](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.indexes)
- [Firebase index configuration](https://firebase.google.com/docs/reference/firestore/indexes)
- [Hosting channel resource](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.channels)
- [Hosting version resource](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions)
- [Hosting project/site membership](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/projects.sites)
- [Cloud Functions revision and source provenance](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions)
- [Firebase project identity](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects)
- [Firebase Rules release and source](https://firebase.google.com/docs/reference/rules/rest)
- [Generation-pinned Storage GET](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get)
- [Firebase hooks and GCLOUD_PROJECT](https://firebase.google.com/docs/cli#hooks)

## Late certification failure and rollback

If backend retrieval or final receipt validation fails after both Hosting versions
are live, certification still refuses, writes no success receipt, and prints the
paired rollback commands using the previously verified preparation baselines.
These baselines are historical rollback evidence, not current backend authority.
Rolling back Hosting alone does not roll back Functions, Rules or indexes. A1
does not execute recovery; review both versions and backend compatibility first.
