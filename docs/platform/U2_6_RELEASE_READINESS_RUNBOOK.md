# U2.6 A1 release evidence and backend-before-Hosting safeguards

## Scope and status

A1 extends the existing paired Hosting build, preparation and certification.
It adds read-only backend observations and an exact-artifact compatibility
policy for the eight existing Teacher Units callables. It does not deploy,
activate Teacher Units, change callables or Rules, implement U3, or certify
teacher workflows. `TEACHER_UNITS_GATE_OPEN` remains false.

Implementation baseline: main `f52218d15a198b24b675fa6b9b26178626e344a8`, tree
`757d0e976a28366e9e2d55f0c697c38ab5c1bddb`. U2.5 is integrated. RA-3D remains
pending certification/integration. U3.1/U3.2, RA-4/RA-5 and U4 student grouping
are not implemented. RA-3B owns the shared assignment publisher; A1 does not
change that ownership or its contracts.

A successful A1 result certifies release-tool evidence, not feature activation
or runtime contract acceptance. No current deployment is inferred from this
runbook, git, aliases, labels or previous receipts.

## Identities and claims

| Term | Meaning and evidence |
| --- | --- |
| Source revision | Local commit SHA and dirty status. A dirty checkout is not an exact committed revision. |
| Locally built artifact | Paired Hosting file hashes and locally compiled Functions/package file hashes. |
| Deployment candidate | The exact local artifact fingerprints, placement fingerprint, Rules bytes and normalized index configuration recorded with the pair build. |
| Remotely observed Functions revision | Cloud Functions resource, successful build name, service revision, active state and latest-revision traffic status, plus generation-pinned source archive hashes. |
| Remotely observed Hosting revision | Live channel and version resource identities, release time/message, routing and fetched served bytes. A message alone is not source proof. |
| Historical receipt | A timestamped record of observations and comparisons. It cannot authorize a subsequent readiness check. |

A1 does not claim that a Functions commit SHA can be retrieved. The API reports
a deployed build/revision and immutable source provenance, not an independently
proven git SHA. The candidate SHA stays under `candidate.source`; it is never
copied into a deployed-source claim. Source archive hashes identify uploaded
packaged inputs, not the final container image, resolved installed dependencies,
or callable response semantics. Runtime patches can change the image without
changing those packaged inputs.

## Environment boundary

Only literal project IDs are accepted, before credentials or network access:

| Environment | Firebase project ID | Independently checked project number | Hosting sites |
| --- | --- | --- | --- |
| Production | `lyfelabz-prod` | `182791689935` | `lyfelabz-prod`, `lyfelabz-marketing` |
| Staging | `lyfelabz-staging` | `293337283840` | `lyfelabz-staging`, `lyfelabz-staging-marketing` |

The Firebase Management API must return the requested project ID, matching
number, resource name and ACTIVE state. Database, Functions, build, service,
Rules, index and Hosting resource names must belong to that project (or its
verified number where the backend uses numeric resource names). The database
must be `(default)` and native Firestore. Aliases and the gcloud default project
are never authority. Project identity pins require explicit review if a project
is recreated.

Credentials are obtained with `gcloud auth print-access-token --quiet`; Firebase
Hosting discovery separately uses the existing Firebase CLI credentials. Both
must be valid. Tokens are passed only in GET authorization headers, never logged
or stored in receipts. Configure authentication separately; these tools do not
log in, enable APIs, grant permissions or change remote configuration.

Required read access includes Firebase project metadata, Functions list/get,
immutable deployment source objects, Rules release/ruleset source, and Firestore
Admin database/index/field configuration. Missing permissions, expired credentials,
API errors and missing objects all refuse readiness. `gcloud`, Firebase CLI,
Node, npm, and `unzip` must be available. Tests also use `zip`.

## Read-only backend inventory

From the release checkout:

```sh
node scripts/hosting-release/backend-state.cjs --project lyfelabz-staging
# Or explicitly: --project lyfelabz-prod
```

This performs only GET/LIST operations and writes an ignored local
`dist/hosting-release/backend-<project>.json` on success. It does not build or
deploy. Inventory alone does not certify Hosting readiness. An incomplete
inventory exits nonzero and leaves any previous receipt historical; no fallback
reads that old receipt as current evidence.

Evidence retrieval:

1. Firebase Management project GET and Firestore database GET.
2. Paginated Cloud Functions v2 inventory. Unreachable locations refuse.
3. Each required Teacher Units endpoint GET: GEN_2, ACTIVE, Node 22, exact entry
   point, build/service/revision identities and 100% latest-revision traffic.
4. The API's `sourceProvenance.resolvedStorageSource`, with explicit object
   generation, is downloaded through Cloud Storage GET. Mutable source pointers
   and source labels are insufficient.
5. Archive entries are listed and streamed through `unzip`; entries are not
   extracted. Private temporary archives are removed on success or failure.
   The runtime map covers all `lib/**/*.js`, `lib/**/*.json`, `package.json`
   and `package-lock.json`. The ordered placement IDs are hashed separately.
6. Endpoint metadata is re-read around source retrieval. A changed endpoint
   refuses. Functions outside the eight required endpoints are inventoried
   with metadata only; their artifact compatibility is not certified.
7. Active `cloud.firestore` Rules release GET, referenced Ruleset GET and exact
   source-byte hash. The release is re-read; a change refuses.
8. Paginated composite-index and explicit-field/TTL inventories, normalized
   definitions, resource IDs and READY/ACTIVE states. Field override and TTL
   lists are combined without losing overrides. A second snapshot must match.

No Firestore application documents or Secret Manager values are requested. Evidence records contain
metadata, fingerprints and file hash maps, not source archives or credentials.

## Compatibility and order enforcement

`pair-build.json` schema 2 records `backendCandidate` along with the existing
Hosting file hashes and source/placement evidence. Building the pair locally
also rebuilds Functions into this checkout's ignored `lib` directory, clearing
old compiled output first. This is a local compilation, not a Functions deploy.

The `u26-a1-exact-backend-artifact-v1` policy requires:

- all eight endpoint archives have exactly the candidate's runtime file map;
- every endpoint's ordered placement fingerprint equals the Hosting candidate;
- active Rules source bytes equal the candidate Rules file;
- the normalized deployed index/field/TTL configuration equals the candidate;
- all listed required indexes and TTL policies are ready;
- the entire observation began no more than five minutes before the check,
  with valid, ordered timestamps and no future observation timestamp.

Exact equality is intentionally conservative. Unrelated packaged Functions
changes can require redeployment of the eight endpoints even if their contracts
would remain compatible. A1 does not infer semantic backward compatibility.
Unsupported index metadata/configuration is refused rather than discarded from
a fingerprint. There is no index release ID: the receipt identifies retrieved
configuration and states, not a fabricated index revision or source SHA.

Online `prepare.cjs` checks the current backend before printing the existing
paired Hosting command. Both Hosting baselines must be retrieved, including in
staging. Preparation is not a deploy authorization.

Most importantly, the existing Firebase Hosting predeploy hook
`node scripts/hosting-release/build-pair.cjs` rebuilds the pair and retrieves
backend evidence again for the Firebase-provided `GCLOUD_PROJECT`. Missing,
wrong-project or incompatible evidence makes the hook exit nonzero, cancelling
that configured deploy. It has no offline bypass. Each target runs the hook.

This enforces **compatible backend already deployed before the configured
Hosting deployment proceeds**. It does not automatically deploy the backend or
guarantee chronological order across arbitrary operator actions. A combined
Functions/Hosting deploy is not a supported way to satisfy this dependency: the
predeploy check observes the backend already deployed, not queued local Functions.

Limitations: operators can bypass hooks with another configuration or Hosting
clone/API operations; observations are not a cross-service transaction; backend
changes can occur after a check. Old/open clients are unaffected by deployment
tooling. These are explicit remaining risks, not an atomic deployment guarantee.

## Operational sequence

1. Identify the exact candidate and environment. Use a clean certified checkout
   for production. Verify the gate remains closed and record the source tree.
2. Separately authorize and deploy any required backend changes through the
   existing operational process. A1 executes none of these mutations.
3. Retrieve backend inventory and inspect the evidence, including object access,
   Rules source and index readiness. Resolve refusals; do not bypass them.
4. Prepare the paired release using the existing entry point:

   ```sh
   node scripts/hosting-release/prepare.cjs --project lyfelabz-staging
   # Production additionally pins the candidate:
   node scripts/hosting-release/prepare.cjs --project lyfelabz-prod --expect-sha <full-sha>
   ```

5. Review the prepared receipt and separately obtain deployment authorization.
   Preparation prints the existing paired Hosting command; it does not run it.
   Predeploy retrieves evidence again when that command is authorized and run.
6. Certify from the same candidate checkout:

   ```sh
   node scripts/hosting-release/certify.cjs --project lyfelabz-staging
   # Or explicitly: --project lyfelabz-prod
   ```

Certification verifies unchanged local artifacts, current backend compatibility,
scoped schema-2 preparation evidence, both live Hosting versions, bytes, routing,
homepages and catalog navigation. It writes a certified receipt only after every
check succeeds. A partial Hosting release refuses certification.

For local-only work, staging `prepare --offline [--allow-dirty]` remains available.
It records a local candidate with `readiness: local-only-not-ready`, no backend
receipt, and no deploy/certify instructions. Production offline preparation is
refused. Direct execution of `build-pair.cjs` now means the guarded predeploy;
use offline preparation for local release builds.

## Receipts and rollback

Existing prepared/certified wrappers move to schema 2 and embed a deterministic
`lyfelabz.releaseEvidenceReceipt` schema 1. Object keys and unordered inventories
are canonicalized; ordered placement IDs/index fields retain their meaning.
Identical inputs and timestamps produce identical receipt bytes. Observation
times and remotely assigned IDs naturally vary between retrievals.

Prepared receipts contain local candidate identity, backend observations,
compatibility policy and both historical live Hosting baselines. Certified
receipts additionally identify the verified live pair and previous versions.
Preparation evidence expires after 24 hours (and future timestamps refuse); if
the approval window expires, prepare again before deployment. A previous schema,
different project, different candidate, missing baseline or
inconsistent receipt cannot supply certification's rollback references. A fresh
backend read is still mandatory; historical freshness is checked at the receipt's
own observation time and never refreshed by changing its label.

Preparation baselines are observed prior versions, **not automatically known-good
or certified rollback targets**. Check the release ledger and preserve the prior
certified receipt before approving rollback. The existing paired clone commands
restore both sites; no rollback command is executed by these tools. Hosting clone
bypasses the build hook, so retrieve current backend evidence and establish
compatibility with the prior candidate before authorizing it. If exact matching
blocks an otherwise safe rollback, stop for an explicit reviewed plan; do not
silently weaken the policy or reuse a receipt.

Backend rollback requires separately authorized redeployment of compatible prior
Functions/Rules; it is not performed by a Hosting clone. Retain compatible
additive indexes where appropriate. Preserve unit, receipt, assignment and audit
data. Older clients calling newer Functions and newer clients calling older
Functions remain runtime concerns deferred to A2/U3. The existing U2 school-bound
create safely refuses an older server; future U3 draft fields can be silently
ignored without an authoritative acknowledgment.

## Limitations and deferred work

If generation-pinned source archives are absent, inaccessible or no longer
retained, A1 cannot establish packaged Functions identity and refuses. The
smallest later alternative is A2's authenticated runtime capability/fingerprint
response, with operation-level confirmation where required. A manually entered
hash, label or old receipt is not a substitute. Final container attestation and
runtime semantics are not fabricated from an archive match.

A2: client/server capability handshake, runtime placement confirmation and client
fail-closed behavior. A3: server availability posture, Rules district-parity
choice, cache/environment policies and CI protections. C1/C2: authenticated
staging, actual screen-reader certification, activation approval and gate change.
No such behavior is implemented by A1. U3 contracts remain separate.

Independent review must check the API fixtures and actual authorized read-only
responses before declaring operational certification. Offline tests prove
refusal/normalization/wiring behavior, not today's deployed state. Live API
availability and real archive shape remain an operational certification item.

## Verification

```sh
node --test scripts/hosting-release/*.test.cjs scripts/app-hosting/build.test.cjs scripts/marketing-hosting/*.test.cjs scripts/unit-placement/check-parity.test.cjs
```

Build the app first if running artifact regression suites from a pristine
checkout. Tests inject credentials/API/Hosting transports; no test deploys,
changes remote configuration or invokes a Teacher Units callable. Real archive
parsing is tested with a temporary synthetic zip.

## API references

- [Cloud Functions Function/BuildConfig/source provenance and traffic fields](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions)
- [Firebase project identity](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects)
- [Firebase Rules release and Ruleset source](https://firebase.google.com/docs/reference/rules/rest)
- [Firestore field override and TTL inventory](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.fields/list)
- [Firestore composite index inventory](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.indexes/list)
- [Generation-specific Cloud Storage object GET](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get)
- [Firebase predeploy hooks and GCLOUD_PROJECT](https://firebase.google.com/docs/cli#hooks)
