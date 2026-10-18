# D13 staging observation preparation and future runbook

Status: G2 offline preparation only. Teacher Units remains CLOSED. No live
execution, IAM operation, credential access, token minting, deployment or
activation is authorized by this document. Part F is integrated at `f2b0d0a`.

## Implemented offline operator workflow

The existing executor exports `dryRun({planInput, candidate, localGzip,
expectedIdentity})`. It is a pure API, with no CLI execution flag or environment
switch. It validates explicit staging configuration, a closed candidate, clean
source identity, local artifact paths/hashes and gzip prerequisites. It returns
the frozen request plan, minimum/maximum request estimates, expected identity,
fixed scope and missing operational prerequisites. It calls no broker or transport,
reads no file or credential and writes no evidence. Callers must supply local
artifact records; success checks their consistency, not filesystem authenticity.

The expected identity has exactly `project`, `serviceAccountEmail`, `accountId`.
The project is `lyfelabz-staging`; the email must belong to its service-account
namespace. The numeric account ID is not project number `293337283840`.
`hosting-observer@lyfelabz-staging.iam.gserviceaccount.com` is a proposed account,
not an account confirmed to exist. The owner must select and pin its actual ID.

`createExecutor` remains fixture-only and single-use. Its optional `fakeBroker`
is passed the expected identity, singleton scope, explicit time and
`mode: synthetic-only`. It can return only an exact `synthetic-credential` record:
non-secret `synthetic-marker:<label>`, matching identity and `verifiedAccountId`,
fixed scope and expiry covering the full five-minute window. These verifications
are synthetic assertions, not provider identity verification. A real token,
unknown credential field, identity mismatch or broker failure refuses; there is
no fallback to an operator token. The broker is never invoked by `dryRun`.

`createFixtureHttpsTransport` requires explicit `fixtureRequest` and
`fixtureResolve` doubles. No default connector, DNS resolver, socket construction,
authentication library or live entry point exists. Tests exercise its Node-shaped
HTTPS options and response streams entirely through doubles. Arbitrary injected
code is outside this trust boundary and never establishes live provenance.

Prepared controls:

- GET only; exact staging API resources and two public origins below.
- Direct transport, explicit SNI, certificate/hostname checks, fixed public IPv4
  lookup, no proxy/ambient agent, no redirects or retries. IPv6 and private/special
  destinations fail closed in this phase.
- Per-request timeout at most 30 seconds, shortened to the remaining absolute
  five-minute capture window; monotonic checks before/after requests; shared abort
  on deadline or failure; no late response accepted.
- Streaming limits: provider 8 MiB; edge 16 MiB; 16 KiB response headers;
  64 MiB aggregate raw responses and separately 64 MiB decoded responses.
- Provider identity encoding and exact JSON content type; fatal UTF-8; decoded
  duplicate-key rejection and nesting depth 64. Edge identity or requested gzip,
  bounded to 16 MiB decoded before hashing.
- Cursor grammar and 2048-character limit; repeated/empty/invalid cursors refuse;
  at most 1000 pages per site and 10,000 aggregate manifest entries.
- Provider synthetic markers never reach edge requests. No auth/cookie headers
  appear in transcripts. Edge diagnostics retain only the existing allowlist.

Failures return fixed codes/messages and a separate
`lyfelabz.hostingCaptureFailure` artifact with `complete: false`, counts, timing,
received byte count and completed-exchange digests/timestamps. No response body,
header, URL, cursor or raw transport exception enters it. No successful transcript
is exposed on failure. There is no evidence writer in G2; returned data is in memory.

## Trust and authority

The trusted-live pathway is explicitly disabled. No private live handle is issued.
Every executor result is `synthetic-fixture`; every authority flag is false.
Supplied `live-staging-capture` transcripts remain refused by unchanged strict and
historical replay. Historical replay never renews freshness or proves certification.
The four-minute performance target remains advisory; five minutes is the hard limit.

A future private collector must own the real connector, credential verification
and clock. It must not accept a caller's transport, token or provenance assertion
as authenticated evidence. An in-process opaque handle must not survive JSON
serialization. Durable trusted-live imports additionally need a digest anchored
in a separately protected evidence manifest/store, or a signed collector envelope
verified against an independently trusted key. A digest beside editable evidence,
or a supplied signature and supplied key, does not establish authenticity.
Collector attestation must confer no release certification/signing authority.

TLS authenticates the response source to a trusted collector. It does not prove
which source, build profile, toolchain or compression profile performed a deployment.
Manifest matching, public bytes, deployment provenance and certification remain
separate findings. Missing deploy receipts stay missing, with `unreproducible`
compression binding where required. Do not fabricate receipts by self-calibration.

## Future separately authorized identity setup

The owner must explicitly authorize account creation, bindings, impersonation and
capture execution separately from G2. An authorized administrator must:

1. Select/create a dedicated keyless staging observer; record email and actual
   numeric service-account ID. Do not create or download a key.
2. Grant `roles/firebasehosting.viewer` on `lyfelabz-staging` only. Do not grant
   Firebase Admin, Hosting Admin, basic Viewer/Editor/Owner or production roles.
   Site/channel-level IAM grants are not assumed to exist.
3. Grant the named operator impersonation rights on that account only, normally
   `roles/iam.serviceAccountTokenCreator`. Direct access-token generation requires
   `iam.serviceAccounts.getAccessToken`; Token Creator includes broader signing
   capabilities, so its grant needs explicit review. Do not grant it project-wide.
4. Consider a time-limited IAM Condition on impersonation. This limits the minting
   grant; it does not constrain OAuth scopes or shorten already minted tokens.
5. Review effective direct/inherited production access, groups/principal sets,
   custom roles and impersonation paths with an appropriately privileged auditor.
   Missing policy visibility or an Unknown result is a blocker. The capture
   account does not receive IAM-auditor permissions for this review.
6. Confirm required APIs already enabled. Any API enablement or IAM correction is
   a separate setup action, never automatic recovery during observation.

The public role description supports Hosting Viewer for read-only Hosting, but
exact permission mapping for channels.get and versions.files.list remains an
operational verification gate. Stop on 403; do not automatically expand IAM.
Public production pages can be accessed anonymously regardless of IAM. The
collector must independently prohibit production network destinations.

Sources: [Hosting Viewer](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasehosting),
[Hosting permissions](https://firebase.google.com/docs/projects/iam/permissions),
[account-scoped impersonation](https://docs.cloud.google.com/iam/docs/create-short-lived-credentials-direct),
[IAM Conditions](https://docs.cloud.google.com/iam/docs/conditions-overview).

## Future credential broker requirements

No functional broker is implemented in G2. A separately authorized broker must:

- Select the operator identity/configuration explicitly, without ADC, Firebase
  login, environment token selection or ambient gcloud account fallback.
- Call only the fixed IAM Credentials service for the pinned account:
  `POST https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{pinnedAccount}:generateAccessToken`.
- Request exactly `https://www.googleapis.com/auth/firebase.readonly`, no delegates,
  normally 600 seconds. The minting request's own authorization is distinct from
  the resulting narrowly scoped provider token. Do not forward it to Hosting.
- Introspect effective scope, expiry and account identifier inside the broker;
  compare the account's returned numeric identifier with the pinned ID. Email may
  be unavailable without an additional scope; do not widen scope to obtain it.
- Keep credentials in memory/private IPC. Never print tokens, pass them in shell
  arguments or URLs, persist raw token responses or log authorization headers.
- Refuse any mismatch/expiry/verification failure and never substitute a user token.

Ordinary `gcloud auth print-access-token` has no documented custom-scope flag. Its
ADC counterpart supports `--scopes` but is not the deterministic selection mechanism
approved here. Prefer the explicit IAM Credentials scope array. Confirm actual
returned identity/scope during the separately authorized run.

Sources: [generateAccessToken](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken),
[token properties](https://docs.cloud.google.com/docs/authentication/token-types),
[tokeninfo form-body example](https://docs.cloud.google.com/sdk/gcloud/reference/auth/application-default/print-access-token).

## Future first read-only observation

Preflight: explicit execution approval; reviewed collector revision; pinned account
and project; effective IAM review; verified singleton scope/expiry/account ID;
approved local artifacts for the intended deployed candidate (not an assumption
that repository HEAD is deployed); exact source/candidate/file/gzip/routing records;
private evidence destination; direct TLS and bounded plan. Complete local hashing,
gzip preparation and credential verification before the observation window.

Project ID: `lyfelabz-staging`. Project number: `293337283840`.
Sites: `lyfelabz-staging`, `lyfelabz-staging-marketing`.

Only these Hosting API GET resources are permitted:

```text
https://firebasehosting.googleapis.com/v1beta1/projects/lyfelabz-staging/sites/lyfelabz-staging/channels/live
https://firebasehosting.googleapis.com/v1beta1/projects/lyfelabz-staging/sites/lyfelabz-staging-marketing/channels/live
https://firebasehosting.googleapis.com/v1beta1/projects/lyfelabz-staging/sites/lyfelabz-staging/versions/{observedHexVersion}/files
https://firebasehosting.googleapis.com/v1beta1/projects/lyfelabz-staging/sites/lyfelabz-staging-marketing/versions/{observedHexVersion}/files
```

File continuation permits only `?pageToken={encodedReturnedCursor}`. Construct URLs
from pinned resources and validated IDs, never arbitrary provider-supplied URLs.
Origins are exactly `https://lyfelabz-staging.web.app` and
`https://lyfelabz-staging-marketing.web.app`; GET only planned served paths with
`?hosting-release={runNonce}` and no credentials. The public
[discovery document](https://raw.githubusercontent.com/googleapis/google-api-python-client/main/googleapiclient/discovery_cache/documents/firebasehosting.v1beta1.json)
defines these project-prefixed methods and the approved scope.

Sequence inside one five-minute window:

1. Record wall/monotonic start immediately before the first channel request.
2. Read both live channels. Check exact identities, expected release message,
   DEPLOY type, FINALIZED versions and file counts.
3. Retrieve complete manifests for both observed versions.
4. Fetch every planned non-ignored, non-redirected served path with bounded
   concurrency (start with 4), decode and hash bytes, retain allowlisted diagnostics.
5. Read both channels again; require unchanged metadata and exact file coverage.
6. Complete and validate within 300,000 ms from start. Evaluate any later freshness
   at the actual decision time; historical replay cannot refresh the observation.

Volume is four channel requests plus manifest pages plus served paths. At the
previous synthetic staging shape: 325 GETs (4 + 2 + 319), about 38.5 MB served.
Actual volume must be obtained from the approved plan; page counts can exceed the
minimum. No retries, redirect samples, general navigation or functional tests are
part of this identity window. One edge location never proves global CDN consistency.

Future output writer: private directory (0700), create-only files (0600, exclusive
creation), no symlink traversal/overwrite, evidence digests and minimal export.
Exclude credentials/cookies/raw exceptions; minimize provider actor metadata and
redact transient cursors in archival views. Bind any normalized/redacted view to
its collector manifest. Do not treat an unsigned editable archive as trusted-live.
Cloud evidence-store creation/configuration is outside this runbook's authorization.

On any failed check: cancel outstanding requests; preserve incomplete, redacted
failure diagnostics; stop without changing cloud state. A read-only observation
has no deployment rollback. Permission expansion, redeployment or release rollback
is not recovery for a failed observation.

Post-run: verify identity/scope metadata; request allowlist/counts; complete manifests;
window and release stability; public-byte comparisons; separate compression/provenance
findings; evidence integrity/redaction; false authority flags; unchanged repository
and cloud configuration. Any imported archive remains untrusted until its external
anchor is independently verified. No operational certification is inferred.

Prohibited during observation: IAM/API changes, keys, deployment/upload/release or
channel/version mutation, cache deletion, production requests, Functions invocations,
Firestore/Storage operations, release signing/registration, policy transitions,
certification or activation. G1 to G5 and remaining D13 work are not closed by this run.

## D13 G4 offline credential-broker contract

Status: implemented locally, uncommitted, not independently certified. Teacher
Units remains CLOSED. This slice authorizes no credential access, token minting,
IAM/API changes, cloud requests, deployment or activation. G3 reconnaissance
verified G2 integration at `76764c9aa5b4757f85c249154c1fbd0119af61dd`.

`hosting-credential-broker.cjs` exports `buildMintRequest(identity)` and
`createFixtureBroker({identity, operator, clock, fixtures})`. No production
adapter, operational CLI, executor integration or live switch exists. The existing
executor and strict/historical replay contracts are unchanged.

Identity is exactly `{project, projectNumber, serviceAccountEmail, accountId}`.
Project and number are the staging pins above; email is exactly the proposed
`hosting-observer@lyfelabz-staging.iam.gserviceaccount.com`. No real immutable ID
is known or supplied by this implementation. An explicit numeric ID is mandatory
and cannot equal the project number. Test IDs are invented synthetic values only.
Email alone never suffices, including after account deletion/recreation.

The pure builder constructs only the pinned IAM Credentials POST, using the
immutable ID in `projects/-/serviceAccounts/{accountId}:generateAccessToken`,
`scope: ["https://www.googleapis.com/auth/firebase.readonly"]` and
`lifetime: "600s"`. Delegates, override endpoints, alternate scope/lifetime,
unknown fields and credential inputs refuse. The request contains no credential.
The API's documented response is `{accessToken, expireTime}`; it contains no
principal assertion. Its authenticated association will require a future private
connector and cannot be established by this fixture contract.

The fixture flow separates explicitly selected operator identity, target account
metadata, mint request/response association, inspection, and credential capability.
Operator is `{sourceId, subject}` and must match the fixture response. Target
metadata must match project ID, email and immutable ID, with `disabled: false`.
Each dependency receives an immutable request and must return that same request
reference with its body. This detects response mix-ups, not malicious injected code.
Every result is `synthetic-fixture`, with no trusted-live provenance and all four
authority flags false. No supplied label upgrades that evidence.

Only `synthetic-operator:<label>` and `synthetic-hosting:<label>` markers are
accepted. Operator markers reach only target-metadata and mint fixtures. Hosting
markers reach only inspection and the provider fixture. The fixed inspection
request is POST `https://oauth2.googleapis.com/tokeninfo`; a future connector must
place the token in the Authorization header, never a URL. The private capability
permits only the two staging sites' project-ID-prefixed channel/files GETs, with
validated pageToken continuation. It accepts no caller headers, edge request,
production resource or arbitrary endpoint. It returns only a sanitized synthetic
acknowledgment, never a provider body. There is no marker getter, evidence writer,
credential discovery, retry or refresh. Serialization exposes no marker.

The inspection validator implements the documented service-account access-token
profile: required `azp` and `aud` both equal the immutable ID; exact singleton
scope; required `exp` and `expires_in`. It does not substitute user-token `sub`,
v1 `issued_to`/`audience`, email or caller labels. Email is optional and must match
if present; optional verification/access-type fields must not contradict the
selected profile. No extra scope is requested to obtain email.

Mint expiry must fit the 600-second issuance interval. The offline timestamp
parser deliberately accepts canonical millisecond UTC timestamps only, a narrower
subset than the API's RFC 3339 format. Inspection whole-second values are checked
against mint expiry and request timing, allowing less than one second of rounding.
Effective expiry is the earliest conservative bound. Acquisition requires at least
300 seconds plus a 30-second safety margin remaining. Wall and monotonic clocks
are injected; backwards motion or disagreement refuses. Acquisition has a shared
30-second cancellation deadline. First provider dispatch rechecks the full window
plus margin; concurrent capability use refuses. Capability calls are bounded, refuse expiry or
cancellation, and close permanently on failure. Token lifetime never changes the
five-minute observation freshness contract.

Errors expose fixed codes/messages only. Failed acquisition releases no capability;
late responses cannot change a refused result. Callback code is untrusted fixture
code and is outside the contract's no-network guarantee; tests and verification
must block external traffic and credential-file reads independently.

Authoritative references:

- [generateAccessToken](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken)
- [Service-account access-token field meanings](https://docs.cloud.google.com/docs/authentication/token-types)
- [Google authentication-library token inspection](https://raw.githubusercontent.com/googleapis/google-auth-library-nodejs/main/src/auth/oauth2client.ts)

Unresolved before operational use: approved immutable ID and operator source;
account/API/IAM setup and effective-access audit; actual tokeninfo field availability
with the singleton scope; real Viewer success for both GET methods; reviewed private
production dependencies and live evidence boundary. Missing metadata must stop
validation without scope expansion or fallback. Tokeninfo is online corroboration,
not a signed archival attestation. Fixture verification establishes none of these
provider facts. No live provenance handles, signing or evidence storage are added.


G4 local verification (Node 24.15.0): focused broker tests 49/49; full registered
Hosting suites 316 pass, zero fail, one optional externally started Hosting-emulator
test skipped (no emulator URL); D13 suites are included in that run. Part E's
separate loopback run passes 24/24. S6 offline suites pass 259/259. Application
verification passes all gates and 209 suites / 7884 tests, with a nonfatal Jest
worker-teardown warning. Functions pass 184 suites / 5472 tests, lint, typecheck
and build; the resulting ignored runtime record is `closed-only`. Tests ran with
an empty credential environment under an OS sandbox allowing loopback and denying
external networking and known cloud credential directories. The first Hosting run
was blocked by a sandbox loopback-bind rule; after correcting that test restriction,
the full run passed as above. The skipped emulator test is not counted as passing.
Final source/diff review, no-consumer check, diff whitespace check and the five-file
em dash sweep pass. No cloud or real credential operation occurred. This is local
verification, not independent certification or authorization for live operation.
