# U2.6 A1 release evidence and deployment safeguards

## Scope and certification meaning

A1 extends the existing paired Hosting preparation, build hook and certification.
It executes no deployment, activation or callable invocation. Teacher Units remains
closed. Source baseline: `f52218d15a198b24b675fa6b9b26178626e344a8`, tree
`757d0e976a28366e9e2d55f0c697c38ab5c1bddb`.

Release intent is required explicitly when preparing and certifying:

| Intent | Prerequisites and resulting claim |
| --- | --- |
| `general` | Existing catalog, placement parity, artifact ownership, routing, shared bytes and paired-release checks. The existing Teacher Units entry gate must be closed. Teacher Units readiness is **not evaluated**, with no backend compatibility claim. Its eight callables may be undeployed. No Functions build, gcloud token or backend inventory is required. |
| `teacher-units` | All general artifact/pair checks plus fresh independent evidence that the eight Teacher Units endpoint packages, placement, Firestore Rules and indexes match the candidate. Status is **compatible-backend-observed**, not activation approval, authenticated workflow certification or runtime semantic confirmation. |

Missing and unknown intent refuse; there is no default or fallback. Intent is an
operator's reviewed scope declaration, recorded with the exact artifact hashes.
The general candidate also hashes `app/src/index.ts` and verifies its single known
`TEACHER_UNITS_GATE_OPEN = false` declaration. That check limits the current U2
entry point; it is **not server authorization**, a semantic dependency detector,
or evidence that independently invoked callables are safe. Review new client
backend dependencies before selecting intent. A future backend-dependent feature
cannot be certified by relabeling a Teacher Units receipt as general.

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

Normalization follows the Firestore Admin REST contracts and inspected installed
firebase-tools `lib/firestore/api.js` (`processIndex`, `listFieldOverrides`,
`makeIndexSpec`). Supported Standard values normalize omitted defaults and
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
