# U2.6 A3-6 release authority decision record (S0)

Status: **ALL S0 DECISIONS APPROVED (D1 to D15).** Documentation only. The human
owner has approved D1 (D1-B, with the D11 correction), D2, D3 (with refinements),
D4 (option 4b), D5 (R2, including the R2 procedure requirements), D6 (fix 1), D7
(fixes 2 and 3), D8 (fix 4 and corrections) and D9 to D15 (consolidated approved
directions); see section 8. These are architectural decisions only: no
infrastructure is provisioned, no key or registry entry exists, no evidence is
signed and no release is approved. No code, Rules, indexes, Functions,
Hosting, client gate, build profile, IAM, Storage, KMS or deployment configuration
is changed by this record. Teacher Units remains closed: `teacherUnitsAvailable()`
returns `false` and production wiring uses `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`.
This record authorizes no implementation, policy write, evidence write, deployment
or activation in any environment. This file is the canonical A3-6 decision record;
it records each approval and refinement in place, in the style of
`U2_6_A3_3_APPROVED_DECISIONS.md`. It has not been renamed.

Baseline: `main` at `4a8b77c0a51066074fba59561b060132e0e37ea6` (A3-5 integration),
clean tree.

**Provenance limitation.** The original approved A3 architectural specification and
the A3 contract completion supplement cited by `U2_6_A3_CONTRACTS.md` remain
unrecovered (see `U2_6_A3_3_APPROVED_DECISIONS.md` section 2). This record does not
reconstruct them. If either is recovered and conflicts with this record, the
original governs and this record must be reconciled by the human owner.

Statement classes:

- **[E] EXISTING APPROVED CONTRACT** - stated in committed A3-1 to A3-5 documents or code.
- **[R] RECOMMENDATION** - proposed here; not approved.
- **[O] OPTION** - an alternative considered, with its consequence.
- **[D] DEFERRED** - owned by a later phase or a separately authorized operation.
- **[U] UNVERIFIED** - not confirmed; where it was looked for is stated.
- **[A] APPROVED DECISION** - a recommendation approved by the human owner, as
  recorded in section 8.
- **[H] SEPARATE HUMAN AUTHORIZATION** - an operation that an approved decision
  anticipates but does not authorize; it needs its own explicit authorization.
- **[C] CONFLICT** - an option that would change an existing approved contract and
  therefore needs an explicit contract amendment, not only a decision.

## 1. Sources read

`U2_6_A3_CONTRACTS.md`, `U2_6_A3_2_RUNTIME_PROVENANCE.md`,
`U2_6_A3_3_APPROVED_DECISIONS.md`, `U2_6_A3_3_ENFORCEMENT.md`,
`U2_6_A3_3_BACKEND_INVENTORY.md`, `U2_6_RELEASE_READINESS_RUNBOOK.md`,
`TEACHER_UNITS.md` (A3 sections), `CURRENT_PLATFORM_STATE.md`;
`platform/functions/src/teacherUnits/a3-contracts.ts`, `a3-validation.ts`,
`a3-bindings.ts`, `a3-canonical.ts`, `a3-release-authority.ts`, `a3-enforcement.ts`,
`a3-runtime-provenance.ts`, `a3-runtime-artifact.ts`;
`platform/functions/scripts/write-a3-runtime-build.cjs`;
`scripts/hosting-release/backend-state.cjs`; `platform/firebase/firestore.rules`;
`.github/workflows/platform-ci.yml`.

Not inspected: live production or staging, deployed Functions or IAM, any KMS or
Storage configuration, any external approval system, any secret value.

## 2. Fixed constraints that every option must respect [E]

- Synthetic signatures, hashes and author fields confer no authority. Absent trust
  anchors deny availability.
- The verifier performs no I/O except `readEvidence`, limited to
  `teacherUnitsBackendReleases/` and `teacherUnitsReleaseEvidence/`, inside the
  current transaction, validated at its content address. It is re-run on every
  attempt; nothing is cached (Decision 4).
- Availability requires: enabled policy; every A3-1 binding; A3-2
  `runtimeConsistency === "matched"`; a `verified` verdict whose every field equals
  A3-3's independent computation.
- The expected Hosting fingerprint comes only from a verified activation approval
  statement. Environment variables, secrets and runtime configuration are rejected
  sources because they would be a mutable activation switch (Decision 3).
- No activation lease or age-based rejection (A3-1 policy section).
- Revocation does not automatically close an active policy; it invokes the
  separately controlled shutdown workflow (A3-1).
- Dependency order: candidate/plan, deployment approval, deployed observations,
  release, certification, activation approval, activation evidence, enabled
  policy. No ancestor references a future child's digest (A3-1).
- Ordinary builds are closed-only; a policy-controlled profile needs separate
  authorization (A3-1, A3-2).
- Replacing `UNCONFIGURED` requires A3-6, independent certification and separate
  human authorization, and is still not activation (A3-3 section 7).
- A3-3 backend contracts, RAP canonical resources and the shared publisher
  (`assignments/assignments-publish.ts`) are unchanged.

## 3. Principal classes used by the decisions

| Class | Who | Current controls |
|---|---|---|
| P0 | Signed-in clients (teachers, students, anyone) | Rules deny every Teacher Units, policy, release and evidence path (A3-5, `platformConfig`, terminal deny) |
| P1 | IAM principals that can write Firestore through the Admin API but cannot deploy code: operators, the Functions runtime service account (shared by every function in the codebase), the CI or deploy identity | None at the data layer. Admin access bypasses Rules |
| P2 | Principals that can deploy Functions code or change IAM | None in code. A deployer can replace any in-code check, including the verifier |
| P3 | Holders of an approval signing key | None yet (no signer exists) |

Consequence [R]: in-code verification can only defend against P0 and P1. P2 is
checked out of band, by the provider observation and IAM review in tooling (D10, D15)
before a release or activation is approved, and by A3-2 provenance at runtime.
Deploy-capable principals are trusted for code by construction.

## 4. Decisions

### D1 - Threat boundary for Firestore-write principals (P1)

Problem. Under current bindings a P1 principal can perform a **generation
rollback**: after generation N is activated with valid signed evidence and then
closed at N+1, P1 rewrites the policy as enabled at generation N with the old
activation evidence reference. Every binding passes because the runtime sees only
the current policy. Firestore-held mitigations (history, dispositions) can be
deleted by the same principal. P1 can also already write `teacherUnits/*` directly.

- [O] **D1-A Trusted.** P1 is trusted. The release authority prevents only
  unapproved activation by P0 and accidental activation. Residual risk documented.
- [O] **D1-B Semi-trusted (operator error, not malice).** P1 is not trusted to
  activate. Defend against stale or mistaken rewrites with Firestore-held history
  and procedure; defend against deliberate rollback of a *revoked* approval by
  invalidating the deployed revision (D5). Detection by audit logs.
- [O] **D1-C Adversarial.** Requires state P1 cannot alter: signed expiry
  (**[C]** conflicts with the A3-1 no-lease contract, and makes Teacher Units
  unavailable when an approval expires) or artifact-pinned activation state
  (**[C]** conflicts with the dependency order, because a release would have to name
  a future activation).
- [A] **Adopt D1-B.** (Approved; section 8.) It defends the realistic failure (operator error, stale
  tooling, an accidental restore) without changing approved contracts. Re-enabling a
  still-valid approval only restores an approved state; the dangerous case is a
  revoked approval, which D5 handles by forcing a new deployed revision. Record the
  residual: a malicious P1 can re-enable a revoked approval until the revocation
  redeploy completes.
- [A] **D1 correction (approved with the D9 to D15 consolidation).** An earlier draft
  said D11 reduces the P1 population. That claim is withdrawn. Runtime least
  privilege (D11: what the Teacher Units functions themselves may do) and exclusive
  authority to mutate the release policy (who may write
  `platformConfig/teacherUnitsAvailability`, release and evidence documents) are
  separate security properties. A dedicated Teacher Units runtime service account
  still needs Firestore write access, and every other function, operator and deploy
  identity with Firestore write access remains in P1. No approved decision reduces
  the P1 population; D1-B's residual stands unchanged. [U] Whether Firestore IAM can
  be restricted per collection is unverified (gate G5, section 7.1).

### D2 - Trust anchor location

- [O] Firestore document: rejected; P1-writable.
- [O] Secret Manager or environment variable: rejected; a mutable activation switch,
  the same reasoning Decision 3 applied to the Hosting fingerprint.
- [O] Runtime KMS `getPublicKey`: rejected; network I/O is outside Decision 4.
- [O] **Artifact-pinned public keys**: a compiled module under `lib/`, therefore
  covered by `runtimePayloadFingerprint`, bound by the signed deployment approval and
  checked by A3-2 at runtime.
- [A] **Artifact-pinned public keys.** (Approved; section 8.) It is the only option compatible with
  Decisions 3 and 4. The production registry ships **empty**, so even a wired
  verifier returns `authorityUnrecognized`. Populating it is a code change that rides
  a separately authorized policy-controlled build (D12). Key rotation and key
  removal require a redeploy; this is accepted because it also invalidates the old
  revision. Note: the approver of a deployment signs an artifact that contains the
  anchor list; a P2 principal could ship its own anchors, which is why P2 is
  verified by out-of-band observation, not by the verifier.

### D3 - Signer custody

- [O] Cloud KMS asymmetric ed25519 key (HSM or software protection), signing
  permission granted only to the named human approver.
- [O] Offline hardware key held by the approver.
- [O] Key file on a workstation: rejected; exfiltration indistinguishable from use.
- [R] **Cloud KMS, one key per environment** (staging and production keys never
  shared), signing permission only to the human approver, no service account
  signer, key versions never exported. Claude and CI never hold signing permission.
  [U] KMS ed25519 support and its exact algorithm name must be confirmed against
  current Google documentation during the infrastructure phase; not checked here.
  [D] Key ceremony and KMS creation are new infrastructure requiring separate
  authorization.
- [A] **Approved with refinements** (section 8), replacing the recommendation above
  where they differ:
  1. `keyId` is the lowercase hex SHA-256 of the raw 32-byte ed25519 public key. It
     is independent of custody and of any KMS resource name; the registry and the
     verifier recompute it from the pinned public key and refuse a mismatch.
  2. Signing keys live in a **separate GCP key project** in which only the human
     owner holds ownership, so deploy or IAM rights in `lyfelabz-prod` or
     `lyfelabz-staging` (P2) do not confer signing permission (P3). The project is
     new infrastructure requiring separate authorization.
  3. The custody method (Cloud KMS or an offline hardware key) remains **to be
     confirmed before the key ceremony**, together with the [U] ed25519 support
     check. S1 does not depend on it.
  4. Staging and production keys are never shared.

### D4 - Authority registry content and separation of duties

Registry entry [R]: `{ keyId, environment, actions, authorityId, approverSubject,
approvalSystemId }`, where `actions` is a subset of `deploy-backend`,
`activate-teacher-units`, `certify-release`, `dispose-approval`. The verifier
requires an exact match of the signed statement's environment, action and
`ApprovalAuthorityV1.authorityId`, `approverSubject` and `approvalSystemId`.
`workflowId`, `workflowRunId` and `decisionId` are recorded and must be well formed,
but carry no authority.

- [O] Threshold approval (two or more distinct signers per action).
- [O] Separation of duties: deployment, certification and activation signed by
  different humans.
- [O] Single human authority per environment, action-scoped entries.
- [R] **Single human authority (the human owner) per environment, threshold 1,**
  because the project has one release owner. The verifier still checks action scope,
  so a deployment-approval key entry cannot authorize activation. Record the residual
  (no separation of duties). The registry format should not preclude adding a
  threshold later.
- [A] **Approved with option 4b** (section 8):
  1. **Per-action keys.** Each environment has a distinct key for each action
     (`deploy-backend`, `certify-release`, `activate-teacher-units`,
     `dispose-approval`). Each registry entry lists exactly one action; the verifier
     refuses a statement whose action is not that entry's action. A compromised key
     cannot sign another action.
  2. **Threshold 1.** One signature from the human owner per statement. The residual
     (no separation of duties, no second reviewer) is accepted; the format leaves
     room for a later threshold.
  3. **No automated signers.** Claude, CI, service accounts and any workload
     identity never hold signing permission and never appear in the registry.
  4. `approverSubject` is a label bound to the key in the registry, not proof of
     identity; the signature is the proof. `workflowId`, `workflowRunId` and
     `decisionId` are audit fields only.

### D5 - Revocation and disposition resolution

A content-addressed disposition cannot be found by the verifier, because its digest
is unknown until it exists and `readEvidence` reads only by content address.

- [O] **R1 deterministic lookup.** A new collection keyed by target approval
  digest, read in the same transaction (a read of a missing document should make a
  concurrent create conflict; **[U]** to be proven in the emulator, not checked).
  **[C]** Amends Decision 4's two-collection, content-addressed `readEvidence` scope.
  Adds a collection (covered by the terminal deny; an explicit Rules block would be
  a Rules change).
- [O] **R2 revoke by redeploy.** A revocation is: create the signed disposition
  (audit record), shut down immediately (D8 tooling), then redeploy the Teacher
  Units Functions. The new revision no longer matches any earlier release's
  `revisionResource`, so A3-2 provenance fails for every earlier release and
  activation. Compromised keys are removed from the artifact-pinned registry in the
  same redeploy, and revoked approval references may be pinned as a deny list
  (`revoked` reason). No interface, collection or Rules change.
- [O] **R3 query by target.** **[C]** Amends Decision 4 (query capability) and may
  need an index [U].
- [A] **Adopt R2.** (Approved; section 8.) It needs no contract amendment, no Rules or index change and no
  runtime lookup. The window between shutdown and redeploy is protected against P0
  and against operator error; under D1-B the residual is a malicious P1 within that
  window. R1 is recorded as optional later hardening that would need its own
  Decision 4 amendment and Rules review.
- [A] **R2 procedure requirements** (added during S0 review; approved with R2):
  1. The revocation redeploy must ship an artifact change (the deny-list entry or
     registry key removal), never an identical rebuild. firebase-tools may skip
     functions whose source is unchanged, which would leave the old revision serving
     [U] (skip behavior not checked; firebase-tools is not installed in this checkout).
  2. All nine endpoints are redeployed, and the A3 observer (D15) confirms each serves
     a new revision with 100% traffic before the revocation is recorded as complete.
  3. Earlier revisions must not regain traffic. A traffic rollback to an old revision
     (console, CLI, or an ordinary rollback) makes the old code report the old
     `K_REVISION`, so the old release and the revoked approval would match again.
     Old revisions of revoked releases are deleted after the redeploy is observed,
     and the IAM and route review (S5) refuses any tagged or routed old revision.
     Rollback to a pre-revocation revision is prohibited; rollback means a new
     compatible deploy.

### D6 - Approval expiry and freshness

- [O] Signed `expiresAt` checked at runtime. **[C]** This is a lease, prohibited by
  A3-1, and expiry makes Teacher Units unavailable.
- [R] **No runtime expiry.** Freshness is enforced by tooling at registration and
  activation time: an approval must have been issued within a bounded window
  (recommended 24 hours, matching the A1 preparation expiry) when its evidence is
  registered and when the policy CAS enables it; provider observations must be at
  most five minutes old (the existing A1 bound). Statement schemas and the four
  canonical vectors are unchanged.
- [A] **Approved with fix 1** (section 8), replacing the recommendation above where
  they differ. There is no runtime expiry. Tooling enforces:
  1. A deployment, activation or disposition approval must have been issued within
     24 hours when its evidence is registered; the activation approval must also be
     within 24 hours when the policy CAS enables it.
  2. Certification statements (D7) have **no age limit**; their validity is bounded
     by the exact release they bind, which a redeploy invalidates.
  3. At enable, tooling takes a **fresh provider observation, at most five minutes
     old**, and refuses unless the deployed state equals the release manifest.
  4. Any statement whose `issuedAt` is in the future relative to the tooling clock
     is refused.
  These checks bind operators using the tooling; a P1 principal can bypass them,
  consistent with D1-B. At runtime the only freshness signal remains the A3-2
  revision match.

### D7 - Certification evidence and source

Today `validateEvidenceReference` refuses any certification kind, so no verdict can
ever be `verified`. A new evidence kind is required.

- [O] Unsigned certification report referenced by digest: rejected; a hash confers
  no authority.
- [R] **A signed certification statement**, kind `teacher-units-release-certification`,
  action `certify-release`, with the same `{statement, source}` shape as approvals.
  The statement binds environment identity, `backendReleaseId`,
  `hostingCandidateFingerprint`, `placementFingerprint`, `enforcementVersion`,
  `clientContractVersion`, the certification report as a `ContentObjectV1`, the
  authority and `issuedAt`. It references no policy instance or generation (those are
  children). The verifier checks its signature and authority and that its bindings
  equal the activation approval's. The certification source is the independent
  certification of the release (A3-7 for the first release). New schema; the existing
  vectors are unchanged; new vectors are added.
- [A] **Approved with fixes 2 and 3** (section 8):
  1. **Independence comes from the report, not the signature.** Under D4 threshold 1
     the human owner signs the certification with the per-action `certify-release`
     key. The signature attests only that the owner vouches for it; independence is
     carried by the certification report of an independent certification run,
     bound by its `ContentObjectV1` hash. The signature is never read as a second
     reviewer.
  2. **Certification is a disposition target.** `validateDispositionBinding` is
     extended so a disposition may target a certification statement (revoke only;
     a supersede replacement must be of the same kind). This is an A3-1 validator
     extension: S2 must show the four existing canonical vectors unchanged. Under R2
     the effective withdrawal is still the deny-list entry plus redeploy; the
     disposition is the signed audit record.

### D8 - Policy history and compare-and-set writer

- [R] Collection `teacherUnitsAvailabilityHistory`, document ID
  `{policyInstanceId}_{generation}` (deterministic, create-only), written in the
  same transaction as the policy CAS. Body: environment identity, previous and next
  policy digests (policy projected with `updatedAt` as seconds and nanoseconds),
  transition kind (`initialize`, `prepare`, `enable`, `shutdown`, `noop` is never
  written), evidence references used, operator subject and a free-text reason.
- [R] The CAS writer reads the policy and the history document for the next
  generation in one transaction, applies `validatePolicyTransition`, refuses if the
  history document exists, then writes both. Enable additionally runs the same
  verification the runtime verifier runs, under D6 freshness.
- [R] **No Rules change in A3-6.** The terminal deny already denies clients this
  collection (as it does for the release and evidence collections). An explicit
  documentary deny block for all three collections is recommended as a separate,
  explicitly authorized Rules slice with `test:rules`.
- [R] History is not read by the runtime verifier (that would be a Decision 4
  amendment); it is an audit and tooling record.
- [A] **Approved with fix 4 and corrections** (section 8), replacing the two
  recommendations above that concern the document ID and the enable check:
  1. **Content-addressed history IDs.** Each history document is stored at the
     SHA-256 of its canonical body (create-only; an identical retry is a validated
     duplicate). The generation-keyed ID is withdrawn because, after a D1-B
     rollback, an existing `{policyInstanceId}_{generation}` document would refuse
     the next shutdown. Compare-and-set comes from the transactional read of the
     policy document. Multiple history documents for one generation are reported
     by tooling as rollback evidence and never block a transition, least of all a
     shutdown.
  2. **Explicit Timestamp.** Tooling writes `updatedAt` as an explicit SDK
     `Timestamp` taken from its own clock and validates exactly the value it
     writes. A server-timestamp sentinel is not used, because the stored value
     would differ from the validated one.
  3. **Scoped enable checks.** At enable, tooling runs the verifier's pure checks
     (signatures, registry, bindings) using the same S3 module, plus the D6 fresh
     observation. It does not and cannot run A3-2 provenance, which only the
     running instance performs; runtime confirmation belongs to the activation
     phase.
  4. **Invalid-policy repair is separate.** `validatePolicyTransition` requires a
     valid previous policy, so an invalid policy cannot be shut down by the ordinary
     writer. The runtime already refuses every request with `policyInvalid`, so such
     a policy is closed in effect. Repair is a separate, separately authorized
     procedure, not ordinary shutdown.

### D9 - Storage for statement objects, plans and receipts

`ContentObjectV1` fields (statement objects, deployment plans, access review
receipts, certification reports) need a bucket. The verifier never reads Storage;
tooling retrieves and hash-checks objects at registration time.

- [O] Existing default bucket: rejected. (Correction: `storage.rules` already denies
  every client read and write on every bucket, so client access is not the reason.
  The reasons are that a retention lock applies to a whole bucket and that the
  default bucket shares IAM with unrelated uses.)
- [R] **One dedicated bucket per environment**, uniform bucket-level access, no
  client access, object versioning on, a retention policy set but not locked until
  the first production use is approved. [D] New infrastructure; separate
  authorization.
- [A] **Approved: option 9b** (section 8), replacing the recommendation above:
  1. Separate evidence buckets for staging and for production, both inside the
     isolated key project approved in D3, outside `lyfelabz-prod` and
     `lyfelabz-staging`.
  2. Uniform bucket-level access and object versioning are required.
  3. A retention policy is **planned but not locked** until separately approved.
     While unlocked, a principal with sufficient bucket or project permission can
     shorten or remove retention and delete objects, so stored objects are
     **not immutable evidence**. Content hashes detect alteration; they do not
     prevent deletion. Only a locked retention policy makes objects undeletable for
     the retention period.
  4. Before first use, review inherited IAM (organization, folder and project),
     service-account impersonation paths, and every principal holding object or
     bucket deletion or retention-policy permissions.
  5. [H] No bucket creation, retention change or IAM change is authorized.

### D10 - Nonsecret environment allowlist, deployment plan, runtime updates

- [R] **Allowlist** derived from an observed staging deployment, not guessed. Any
  unlisted plain variable refuses eligibility. [U] The current deployed variable set
  was not observed.
- [R] **Deployment plan** is a JSON `ContentObjectV1` stating the exact deploy
  command (`firebase deploy --only functions:<nine names> --project <id>`), the nine
  endpoints and the expected normalized configuration. The observer refuses any
  difference from the plan.
- [R] **Runtime update policy `on-deploy`**, so the base image cannot change without
  a new revision. [U] Whether firebase-tools can set this for these Functions was not
  checked; if it cannot, `automatic` must be recorded explicitly and accepted as a
  residual, never inferred.
- [R] CPU and memory admissibility is checked against the observed execution
  environment and the plan; unverifiable means ineligible (A3-1 assigns this to A3-6).
- [A] **Approved direction** (section 8), superseding the recommendations above where
  they differ:
  1. Release approval binds the deployable artifact and the expected runtime
     configuration (the deployment plan content object).
  2. The deployment observer compares the actual deployed configuration against the
     approved plan and refuses any difference.
  3. Platform-injected environment variables are discovered from observation of a
     real deployment, never guessed or copied from documentation [U, gate G1].
  4. Build reproducibility is a **required verification gate**: `firebase.json`
     runs `npm run build` as `predeploy`, so the deploy rebuilds the code, and the
     deployed payload must equal the approved `runtimePayloadFingerprint`
     [U, gate G4]. The observer confirms by hashing the uploaded source archive.
  5. Base-image update behavior is unverified until confirmed [U, gate G2]. If
     `on-deploy` cannot be set, the actual policy is recorded as observed; it is
     never inferred.
  6. No Firebase CLI behavior is assumed without evidence.
  7. [D] Observer and plan tooling belong to S4 and S6.

### D11 - Runtime service account and invoker posture

All nine callables are declared with defaults (`platformCallable(handler)`; only
Capabilities pins the region), so they run as the default runtime service account
shared with every other function.

- [R] A **dedicated Teacher Units runtime service account** with the minimum
  Firestore role. (Correction: an earlier draft said this reduces P1 to that
  account plus operators; that claim is withdrawn, see the D1 correction.)
  [D] IAM change; separate authorization.
- [R] Invoker remains public (callables authenticate in application code), recorded
  in the IAM review. [U] The installed `firebase-functions` 5.1.1 default invoker for
  `onCall` was not confirmed from its source in this record.
- [A] **Approved direction** (section 8):
  1. A dedicated least-privilege Teacher Units runtime service account.
  2. That account holds no KMS permission and no evidence-bucket permission, and has
     no role in the key project.
  3. Runtime identity must match both the service account recorded in the release
     and the service account observed on each deployed endpoint (the existing A3-2
     check compares `serviceAccountEmail`).
  4. Invoker IAM is observed after deployment, never assumed. Repository evidence:
     installed `firebase-functions` 5.1.1 emits no invoker setting for these
     `onCall` declarations; whatever grant results is applied at deploy time
     [U, gate G3].
  5. This decision **does not reduce the P1 principal population** (D1 correction).
  6. [H] No service-account creation or IAM change is authorized.

### D12 - Policy-controlled build profile

- [R] Not built in A3-6. `write-a3-runtime-build.cjs` stays closed-only. A later,
  separately authorized operation adds a profile that requires a clean tree at an
  exact commit, the isolated release checkout rules in `CLAUDE.md`, and an explicit
  operator flag. Until then A3-2 can never report `matched` in the cloud.
- [A] **Approved: deferred** (section 8):
  1. The policy-controlled build profile stays deferred.
  2. Recorded fact: `firebase deploy` runs the `predeploy` build
     (`npm --prefix "$RESOURCE_DIR" run build`), and the build's `postbuild`
     (`scripts/write-a3-runtime-build.cjs`) currently always writes a closed-only
     `lib/teacherUnits/a3-runtime-build.json`. A record prepared in advance would be
     overwritten by the deploy.
  3. Any future profile selection must occur reproducibly inside the deploy-time
     build, from an isolated release checkout of the exact release commit.
  4. No request-time or runtime environment switch may select the profile.
  5. [H] No implementation, build change or client-gate change is authorized.

### D13 - Enabled Hosting candidate format

- [R] **Deferred to the activation phase.** A3-6 only consumes
  `hostingCandidateFingerprint` from a verified statement (Decision 3). A1 continues
  to refuse every non-closed candidate. Changing that, or the client gate, is
  activation work.
- [A] **Approved: deferred** (section 8):
  1. The enabled Hosting candidate format stays deferred to the activation phase.
  2. A real D7 certification binds `hostingCandidateFingerprint`, so no real
     certification can be signed until that format is defined.
  3. Schema design and tests for certification and the verifier may precede that
     operational decision, using synthetic fingerprints.
  4. [H] Defining the format for operational use, and any A1 or client-gate change,
     need separate authorization.

### D14 - Where tooling runs and approval system identity

- [O] CI with workload identity federation: rejected for now; current CI runs only
  `platform/**` checks and holds no credentials, and adding them is infrastructure.
- [R] **Operator CLI** under `scripts/teacher-units-release/`, run by the human owner
  with ADC; dry-run by default; refuses without an explicit `--project`; never reads
  `.firebaserc`. `approvalSystemId` is `lyfelabz-operator-cli`; `workflowId` names
  the tool command; `workflowRunId` is a fresh UUID per invocation; `decisionId`
  references the human decision record.
- [A] **Approved direction** (section 8):
  1. An operator CLI under `scripts/teacher-units-release/`.
  2. Dry-run by default.
  3. An explicit `--project` is required on every invocation.
  4. The target project is never inferred from `.firebaserc` or any default alias.
  5. `approvalSystemId` must match the authorized D4 registry entry for the action.
  6. [H] Signing, infrastructure writes, staging or production data writes, revision
     deletion, deployment and activation remain human-controlled operations, each
     separately authorized. Claude may implement the CLI in an authorized slice but
     never runs those operations.
  7. CI remains credential-free.

### D15 - Eight-endpoint A1 inventory versus nine A3 endpoints

`scripts/hosting-release/backend-state.cjs` requires eight endpoints and omits
`teacherUnitsCapabilities`; the A3 release inventory is nine.

- [O] Extend A1 to nine: changes a certified A1 claim and its receipts.
- [R] **A separate A3 observer** that reuses A1 retrieval internals and requires all
  nine endpoints. The A1 Hosting compatibility claim is unchanged; an eight-endpoint
  observation can never satisfy A3.
- [A] **Approved direction** (section 8):
  1. A separate nine-endpoint A3 observer, implemented in a later authorized slice
     (S4) [D].
  2. It reuses existing A1 retrieval components where appropriate.
  3. A1's certified eight-endpoint behavior is preserved unchanged.
  4. It observes and verifies the approved Firestore Rules ruleset resource and
     source hash (`rules.rulesetResource`, `rules.sourceHash`) and the ready-index
     configuration hash (`readyIndexesConfigurationHash`).

## 5. Proposed slices after approval

| Slice | Scope | Depends on | Infrastructure |
|---|---|---|---|
| S1 | Pure ed25519 verification and artifact-pinned registry (empty in production); test keys only in `*.test.ts` | D2, D3 keyId format, D4 4b (all approved) | None |
| S2 | Certification kind (D7), history schema (D8), deny-list format (D5); new vectors | D5, D7, D8 (all approved) | None |
| S3 | Composite verifier implementing Decision 4, not wired; emulator tests through the test factory | S1, S2 | None |
| S4 | Nine-endpoint provider normalizer and observer (D10, D15) over recorded fixtures | D10, D15 (approved) | Live run needs credentials |
| S5 | IAM and route review normalizer and receipt (D11) over recorded fixtures | S4 | Live run needs credentials |
| S6 | Operator CLI: create-only registration, policy CAS with history, shutdown, revocation procedure (D5, D6, D8, D14); emulator only | S2 | Running against staging or production is separate |

Every slice: production verifier remains `UNCONFIGURED`; client gate `false`;
closed-only builds; no Rules, index, publisher or A3-3 contract change; Functions
`test`, `typecheck`, `lint`, `build`, `test:emulator`; independent certification
per slice; A3-7 integrated certification afterwards.

## 6. Operations this record does not authorize

Each requires separate explicit human authorization: KMS keys and key ceremony;
Storage buckets; IAM or service-account changes; any Rules or index change
(including R1 or explicit deny blocks); a policy-controlled build; any staging or
production policy, history or evidence write (including initialization); any
deployment; wiring a verifier other than `UNCONFIGURED`; any change to
`teacherUnitsAvailable()` or the A1 closed-candidate assertion; activation.

## 7. Open items and residual risks

- [U] Firestore transactional conflict on a read of a missing document (relevant
  only to R1).
- [U] KMS ed25519 availability (D3; to be confirmed before the key ceremony).
- Open verification gates: see section 7.1.
- Residual under D1-B and R2: a malicious P1 can re-enable a revoked approval
  until the revocation redeploy completes.
- Residual under R2: a principal who can route traffic (P2), or an operator
  rollback, can restore a revoked revision until its old revisions are deleted.
- Residual under R2: revocation is not retroactive; requests that passed
  verification before shutdown, and their committed writes, stand.
- Residual under D4: no separation of duties with a single release owner.
- The original A3 specification remains unrecovered.
- Status discrepancy: `TEACHER_UNITS.md` still reports A3-5 Rules as awaiting
  independent certification, and the A3-3 documentation remediation recertification
  is recorded as pending (`U2_6_A3_3_ENFORCEMENT.md`). Neither is changed here.

### 7.1 Open verification gates [U]

None of these is verified. Each must be resolved with evidence before the decision
that depends on it is relied on operationally.

| Gate | Unverified fact | Depends on it |
|---|---|---|
| G1 | Exact platform-injected runtime environment-variable set | D10 allowlist |
| G2 | Firebase CLI support for `on-deploy` base-image updates | D10 runtime update policy |
| G3 | Actual invoker IAM state after deployment | D11, S5 IAM review |
| G4 | Reproducibility of the deployable artifact built by `predeploy` | D10, D12, deployment approval binding |
| G5 | Whether Firestore IAM can be restricted per collection | D1 residual, D11 |

## 8. Approval

Approval of D1 to D15 records documentation decisions only. It authorizes no
implementation, Rules or index change, deployment, revision deletion, policy or
evidence write, or activation. The residual risks in section 7 that follow from
D1-B and R2, and the threshold-1 residual of D4, are accepted as part of these
approvals. No key, key project, KMS resource, bucket, service account, IAM
binding or registry entry is created or provisioned; no evidence is signed; no
release is approved. R1 remains recorded as
optional later hardening requiring its own Decision 4 amendment and Rules review.

| Decision | Recommendation | Owner decision |
|---|---|---|
| D1 | D1-B semi-trusted | **Approved** (D1-B, as recommended; D11 P1-reduction claim withdrawn) |
| D2 | Artifact-pinned keys, empty production registry | **Approved** (as recommended) |
| D3 | KMS per environment, human signer only | **Approved with refinements** (keyId = SHA-256 of raw public key; separate key project; custody method to be confirmed before the key ceremony) |
| D4 | Single authority, threshold 1, action-scoped | **Approved, option 4b** (per-action keys, threshold 1, no automated signers) |
| D5 | R2 revoke by redeploy | **Approved** (R2, including the three R2 procedure requirements) |
| D6 | No runtime expiry; tooling freshness | **Approved with fix 1** (fresh five-minute observation at enable; no age limit on certification; future `issuedAt` refused) |
| D7 | Signed certification statement | **Approved with fixes 2 and 3** (independence from the report; certification as a disposition target) |
| D8 | History collection, CAS writer, no Rules change | **Approved with fix 4 and corrections** (content-addressed history IDs; explicit Timestamp; scoped enable checks; invalid-policy repair separate) |
| D9 | Dedicated bucket per environment | **Approved, option 9b** (key-project buckets; uniform access and versioning; retention unlocked until separately approved) |
| D10 | Observed allowlist, plan object, `on-deploy` | **Approved direction** (artifact and configuration bound; observed comparison; gates G1, G2, G4) |
| D11 | Dedicated runtime service account; public invoker | **Approved direction** (least-privilege account; no KMS or bucket access; invoker observed, gate G3; no P1 reduction) |
| D12 | Profile deferred | **Approved: deferred** (deploy-time reproducible selection only; no runtime switch) |
| D13 | Hosting format deferred | **Approved: deferred** (real certification signing waits for the format) |
| D14 | Operator CLI | **Approved direction** (dry-run default; explicit `--project`; human-only operations; CI credential-free) |
| D15 | Separate nine-endpoint observer | **Approved direction** (later slice; A1 unchanged; Rules and index hashes verified) |

## 9. Slice status

### S1 - Ed25519 verification and artifact-pinned registry

Status: implemented; remediated after a certification review (NOT CERTIFIED, one
P1 and five P3 findings); independently recertified (CERTIFIED, four nonblocking P3
findings); P3 hardening applied; uncommitted, awaiting independent final
verification. Not wired: no
non-test module outside S1 imports it (test-enforced), and production
still uses `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`. Teacher Units remains closed.

- `platform/functions/src/teacherUnits/a3-authority-registry.ts`: registry entry
  schema `{schemaVersion:1, environment, projectId, projectNumber, keyId,
  publicKeyBase64, action, authorityId, approverSubject, approvalSystemId}`.
  `keyId` must equal the SHA-256 of the raw 32-byte public key (D3); entries are in
  strictly ascending `keyId` order, so no key serves two actions or environments
  (D4 4b); one action per entry; production and staging identities are pinned and
  emulator entries require a `demo-` project. Approver subjects that are Google
  service-account emails or IAM `serviceAccount:`, `group:`, `domain:`,
  `principal:` or `principalSet:` identifiers are refused; this is a partial
  structural guard for D4 "no automated signers", which key custody (D3) enforces.
  Public keys must decode canonically to a non-identity point of the prime-order
  subgroup (`a3-ed25519.ts`). Input is read once through canonical serialization and
  only that validated copy is stored. Registries are branded: lookups and
  `verifyApprovalSignature` recognize no signer in any registry object not produced
  by `createAuthorityRegistry`. `PRODUCTION_AUTHORITY_REGISTRY` is empty and frozen
  (D2).
- `platform/functions/src/teacherUnits/a3-ed25519.ts`: RFC 8032 decoding, encoding,
  addition and scalar multiplication over public data, and
  `isPrimeOrderEd25519PublicKey`, which refuses every small-order and mixed-order key
  and every noncanonical encoding.
- `platform/functions/src/teacherUnits/a3-signature.ts`: `verifyApprovalSignature`
  snapshots its input once through canonical serialization, validates it with the
  A3-1 approval validators against a required expected identity, maps the kind to
  its registry action (`deploy-backend`, `activate-teacher-units`,
  `dispose-approval`), requires an exact entry match on environment, `projectId`,
  `projectNumber`, action, `authorityId`, `approverSubject` and `approvalSystemId`,
  and verifies Ed25519 over
  `approvalSigningBytes(statement)`. Results: `verified`, or `unverified` with
  `inputMismatch`, `authorityUnrecognized` or `signatureUnverified`. `workflowId`,
  `workflowRunId` and `decisionId` are not bound. No I/O, clock or cache. A failure
  to resolve or bind the signer is `authorityUnrecognized`; only the cryptographic
  check yields `signatureUnverified`.
- `certify-release` exists as a registry action; its statement kind arrives in S2.
- Remediated P1 (certification review): OpenSSL as installed locally accepts
  small-order public keys, and with such a key the fixed signature R = identity,
  S = 0 verifies arbitrary statements. A recertification probe found all eight
  torsion encodings accepted by OpenSSL on Node 24.15.0 (OpenSSL 3.5.5) and Node
  22.23.3 (OpenSSL 3.5.8), with the forgery verifying for every one (from 31 to 256
  of 256 test messages). The registry now refuses them.
- What the tests enforce: the curve code reproduces OpenSSL's public key from its
  seed; `isPrimeOrderEd25519PublicKey` refuses each of the eight torsion encodings,
  six noncanonical small-order encodings and a mixed-order key; the registry refuses
  each of the eight torsion encodings and the seven mixed-order keys formed from an
  honest key. OpenSSL acceptance itself is not asserted: for each torsion key the
  ed25519 test requires the forgery to verify only when OpenSSL accepts the key, so a
  future OpenSSL that rejects small-order keys does not fail the suite.
- Remediated P3 (certification review): single input read in registry construction;
  registry branding; failure-reason split; subject-guard wording and coverage; test
  gaps (production and emulator statement paths, a repository-wide not-wired scan).
- Hardened after recertification (four P3 findings, tests and this section only;
  no S1 source change):
  1. Verifier snapshot: an input whose `statement` changes between reads, at every
     switch point, cannot present a staging-signed statement as verified for
     production.
  2. Identity binding: an emulator entry for another `demo-` project is refused.
     Because production and staging identities are pinned, no valid entry can differ
     from a statement in `environment` or `projectNumber` alone (tested); the
     verifier's own `environment`, `projectId` and `projectNumber` comparisons are
     each tested separately with a stubbed registry lookup.
  3. Section 9 accuracy: the P1, test-coverage and runtime statements corrected.
  4. Signature scalar: S1 has no scalar check of its own; `crypto.verify` (OpenSSL)
     refuses S >= L. A test now pins that a malleated signature (S + L, which a
     verifier that reduced S mod L would accept) is refused, both by `crypto.verify`
     and by `verifyApprovalSignature`. This matters later because evidence
     references digest the payload, signature included.
  Each new test was confirmed in a scratch copy to fail when its protection is
  removed: the snapshot; each identity comparison; S reduced mod L before
  verification.
- Observation (A3-1, unchanged): `canonicalJSON` reads an object's values twice
  (descriptor check, then serialization). A stateful Proxy can therefore make the
  snapshot differ from an earlier read, but the stored registry entry and the
  verified statement are always the snapshot that was validated.
- Runtime coverage: tests and probes ran on local Node 24.15.0 (OpenSSL 3.5.5) and
  local Node 22.23.3 (OpenSSL 3.5.8); both refuse S >= L and pass the S1 suites.
  [U] The deployed Cloud Functions Node 22 runtime and its OpenSSL build were not
  tested.
- Tests: `a3-ed25519.test.ts`, `a3-authority-registry.test.ts`,
  `a3-signature.test.ts` (test keys are generated only in test files, which
  `tsconfig.build.json` excludes from the compiled `lib`).
