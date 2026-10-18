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
- [A] **D12 implementation (offline, owner-authorized).** Owner decisions: explicit
  environment-variable selection; no target-project field in the build record; S6c keeps
  policy-controlled artifacts blocking until separately authorized; all release-authority,
  provenance, deployment and activation boundaries preserved.
  1. `write-a3-runtime-build.cjs` writes `closed-only` when `A3_BUILD_PROFILE` is unset or
     empty. `policy-controlled` requires `A3_EXPECTED_SOURCE_SHA` (40 lowercase hex) equal
     to HEAD, a clean tree including untracked files, resolvable HEAD and tree, and a
     non-symlinked `node_modules`. Unknown values refuse; a requested controlled build is
     never downgraded. Details: `U2_6_A3_2_RUNTIME_PROVENANCE.md`.
  2. Any previous record is deleted before checks; the new one is written only after
     every check, by rename. A refusal exits non-zero and leaves no record, so a stale
     record cannot stand in for the requested build.
  3. Record schema, fingerprints, `verifyRuntimeProvenance`, the A3-6 verifier, the
     registries, Firebase configurations and CI are unchanged. S6c finding wording now
     says policy-controlled artifacts remain blocking until separately authorized; its
     acceptance criteria are unchanged.
  4. Selectable is not provenance matched, which is not deployment approved, which is not
     available. A3-2 can now report `matched` for a controlled artifact; that is still
     `available: false` and grants nothing.
  5. [U] Firebase CLI propagation of the operator environment into `predeploy` is
     unverified (G4); the script cannot prove checkout isolation. The S6b
     `buildRecord.deployed` check text still reads "D12 deferred"; it remains accurate in
     that the deployed record is not read, and was left unchanged to avoid altering
     derived package output. Teacher Units remains CLOSED; no deployment or activation.

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
- [A] **D13 Part A (offline, non-operational contract, owner-authorized).** Owner
  decisions: Hosting identity is the Hosting-only candidate, not the combined
  `localCandidate`; the two-site (app and marketing) A1 scope is kept; enabled activation
  validation requires `teacherUnitsAvailability: 'enabled'`; S6b does not consume the
  derived fingerprint yet; schema design and offline tests only.
  1. `scripts/hosting-release/hosting-identity.cjs` (pure, no I/O) validates the exact A1
     `hostingCandidate()` field set (`releaseIntent`, `source {sha, dirty}`,
     `hostingArtifactFingerprint`, `placementFingerprint`, `applicationBuildFingerprint`,
     `teacherUnitsAvailability` `closed | enabled`, `availabilityEvidence`), derives
     `hostingCandidateFingerprint`, and structurally checks a synthetic enabled candidate
     against its Functions identity (`sourceSha`, `placementFingerprint`).
  2. Hashing is the existing A1 algorithm (`backend-state.cjs` `fingerprint`): recursively
     sorted object keys, `JSON.stringify`, UTF-8, SHA-256 lowercase hex, no domain prefix.
     Strict validation runs first: plain objects of the exact key set, strings and booleans
     only; unknown keys, missing or null fields, arrays, getters, symbols and unsupported
     values refuse. The candidate contains no arrays. The digest covers every candidate
     field. Fixed vectors are in `hosting-identity.test.cjs`.
  3. Enabled activation validation requires `enabled`, `teacher-units` intent, a clean
     source, exact Hosting and Functions source SHA equality and equal placement. A closed
     candidate refuses. A pass is structural only (`deployable`, `certified`, `authorized`
     and `available` are all `false`); it is not deployment approval, certification,
     activation or availability.
  4. Not changed: `build-application.cjs`, `backend-state.cjs`, `releaseAvailability.ts`,
     the client gate, Functions A3 code, Rules, indexes, registries, Firebase
     configurations, CI, S6b, S6c, S6d and S6f. No release, deployment or activation path
     requires the module (tested). The only other change is one line in `prepare.cjs`
     `HOSTING_TEST_FILES`, which the existing suite-registration guard requires, so Hosting
     `prepare` runs the test suite; it does not load the module into any release decision. Every produced Hosting candidate is still closed.
  5. [U] Deployed Hosting bytes are not verified by this module; the fingerprint names a
     local candidate (source-input hashes plus built file hashes), not what Hosting serves.
     D13 remains open: an enabled builder, A1 acceptance of enabled candidates, deployed-byte
     observation, S6b binding and operational adoption each need separate authorization.
- [A] **D13 Part B (offline, non-operational observation contract, owner-authorized).**
  Owner decisions: future operational certification combines public-edge byte
  verification with provider deployment-version evidence; version identity is observed
  before and after public-byte verification; closed-versus-enabled bundle classification is
  deferred; A1 fingerprint behavior (including ignored files) is unchanged; observations
  are no older than five minutes; Firebase provider file hashes are never assumed to equal
  local SHA-256 hashes.
  1. `scripts/hosting-release/hosting-deployment.cjs` (pure: no network, filesystem,
     environment or clock; `now` is an input) verifies explicitly supplied offline records:
     the Part A candidate, a pair-build projection (`kind`, `schemaVersion` 3,
     `releaseIntent`, `source`, `unitPlacement.fingerprint`, `files`), the expected project
     and two sites, the existing ignore and redirect rules per target, and an observation
     (`lyfelabz.hostingDeploymentObservation` v1) with provenance, a start and completion
     time and, per site, the site name, version metadata before, public-edge served hashes,
     version metadata after and an optional provider version-file manifest. The schema is
     documented in the module header. Unknown, missing or undefined fields, getters,
     symbols, non-plain objects, extra array properties and malformed values refuse.
  2. Rules: the candidate fingerprint is rebuilt with Part A; the source is clean; pair-build
     intent, source and placement equal the candidate and `fingerprint(files)` reproduces
     `hostingArtifactFingerprint`; both expected sites, distinct, under the expected project
     or project number; version name, status, release time and message identical before and
     after; status `FINALIZED` (the S6c semantics); message `release <sha>`; timestamps
     ordered start, before, served, after, completion; at most five minutes old and never
     later than `now` (clock-skew allowance zero); served paths exactly the non-ignored,
     non-redirected pair files (certify's rule), each SHA-256 equal, with no duplicate,
     missing, extra or redirected path; provenance `synthetic-fixture` or `offline-record`
     only (no live-capture kind exists).
  3. The provider manifest, when present, is structural: `hashEncoding: 'provider-reported'`,
     unique `/<file>` paths exactly equal to the non-ignored pair files, 64-hex hashes,
     inside the observation window. It is never compared with local hashes;
     `providerFileBinding` is always `unresolved`, even when values happen to match.
  4. The result (scope `observation-consistency`) reports the reconstructed fingerprint, the
     observation fingerprint, byte and version consistency, manifest `present`, `absent` or
     `partial`, binding `unresolved` and fixed limitations; `deployable`, `certified`,
     `authorized` and `available` are `false`. It is not provider-backed certification.
  5. Not changed: certify, release, backend-state, build-application, the client gate,
     Functions A3 code, Rules, indexes, registries, Firebase configurations, CI, S6b to S6f.
     No release, deployment or activation path requires the module (tested). `prepare.cjs`
     gains one `HOSTING_TEST_FILES` line, and the Part A no-consumer guard now allows this
     verifier, its only consumer.
  6. Status: integrated on main (`00a638e`), not independently certified. Observation schema 1
     is superseded by D13 Part C (schema 2) and is refused, not reinterpreted.
  7. [U] Still open: capturing real observations (version re-read in certify, the provider
     versions files list), reconciling provider hashes with local bytes, bundle
     classification, an enabled builder and S6b binding each need separate authorization.
- [A] **D13 Part C (offline provider manifest binding, owner-authorized).** Owner
  decisions: a locally reproduced gzip SHA-256 may establish a conditional
  content-to-provider-manifest match; the match is non-authorizing and does not establish
  which release is served; Node, zlib, gzip level and compression parameters are recorded;
  the five-minute limit covers the complete observation window; release identity (name and
  type `DEPLOY`) must be stable; no live staging capture (separately authorized).
  1. Provider semantics (Firebase Hosting REST v1beta1 discovery, revision 20261011, and
     firebase-tools 15.22.4 and 13.35.1 `uploader.js`): `versions.files.list` pages
     `{ files, nextPageToken }`; a VersionFile is `{ path, hash, status }` with path `/` plus
     the public-relative POSIX path and status `EXPECTED` or `ACTIVE`; the hash is SHA-256
     hex of the gzip-compressed file (`zlib.createGzip({ level: 9 })`); a FINALIZED version
     can no longer change and `fileCount` is set at finalization. The gzip header OS byte is
     0x13 under Node on macOS and 0x03 on Linux, so the same file yields different provider
     hashes by deploy platform.
  2. `scripts/hosting-release/provider-manifest.cjs` (no network or filesystem):
     `normalizeProviderManifest` requires explicit project, project number, site and version;
     a FINALIZED version; a continuation-token chain from a `null` first request to a last
     page without a token (missing, reordered, repeated or malformed tokens refuse); unique
     `/`-prefixed canonical paths; lowercase 64-hex hashes; `ACTIVE` status; a unique count
     equal to `fileCount`; `synthetic-fixture` or `offline-record` provenance only.
     `compressionProfile` records Node, zlib, implementation, the firebase-tools reference,
     gzip parameters (level 9, windowBits 15, memLevel 8, strategy 0), header bytes
     (mtime, XFL, OS) and calibration digests over five fixed vectors. `localGzipManifest`
     hashes supplied bytes (raw SHA-256 and gzip SHA-256); it never uses modification times
     or the Firebase hash cache.
  3. `bindProviderManifest` refuses incomplete or ambiguous evidence (manifest or local set
     not exactly the uploaded set). It returns `unreproducible` when the deploy profile is
     absent or any parameter, header byte or calibration digest differs (version strings are
     recorded, never decisive), `mismatch` when profiles are byte-compatible but a hash
     differs, and `bound` only when every uploaded file matches. `servingEstablished` is
     always `false`.
  4. `hosting-deployment.cjs` observation schema 2: each version record adds `releaseName`
     (live channel or site release, same site and project), `releaseType` (`DEPLOY` only;
     `ROLLBACK` and `SITE_DISABLE` refuse) and `fileCount`; every field is stable before and
     after public-byte observation on both sites; each site requires the complete provider
     manifest (inside the window, same provenance kind) and local gzip evidence whose raw
     SHA-256 equals the pair-build bytes; the observation carries `deployCompressionProfile`
     (`null` is `unreproducible`); local profiles must be identical across sites. The
     provider-uploaded set (non-ignored files, redirected paths included) is validated
     separately from the public-edge served set. The result reports
     `providerFileManifest: 'complete'`, the per-site and overall binding (any `mismatch`,
     else any `unreproducible`, else `bound`), `servingEstablishedByManifest: false`, and
     `deployable`, `certified`, `authorized`, `available` all `false`.
  5. Identity layers kept distinct: (1) local artifact identity (pair-build SHA-256);
     (2) canonical Hosting candidate identity (Part A fingerprint); (3) provider file-manifest
     identity (this binding, content-to-version only); (4) public-edge byte observation
     (Part B served hashes, the only evidence of what is served, with release metadata);
     (5) signed certification (S2/S6e, not produced); (6) deployment authorization (owner, not
     granted); (7) runtime availability (client gate and Functions, closed). No layer implies
     a later one.
  6. Not changed: certify, release, backend-state, build-application, the client gate,
     Functions A3 code, Rules, indexes, registries, Firebase configurations, CI, S6b to S6f.
     `prepare.cjs` gains one `HOSTING_TEST_FILES` line; the Part B no-consumer guard allows
     the Part C suite's allowlist mention. Integrated on main (`6f7c6f2`), not independently
     certified.
  7. [U] Still open: the deploy-side compression profile is a recorded claim (no capture tool
     records it yet); live capture of releases, versions and file lists; edge-cache staleness
     after a release; timing of a full observation within five minutes; bundle
     classification; an enabled builder; S6b binding.
- [A] **D13 Part D (offline capture planner, recorded-response replay and deploy receipt,
  owner-authorized).** Owner decisions: (1) manifest self-calibration is corroborating
  evidence only, never proof of deployment provenance; (2) a pre/post deployment receipt is
  acceptable for offline design but is not cryptographic proof that the recorded profile
  performed the deploy; (3) a future controlled deployment requires the Firebase Hosting hash
  cache to be absent before deployment; (4) a single public-edge observation is a limited
  observation, not proof of global CDN consistency; (5) explicit origin-to-site binding is
  required; (6) catalog navigation and general functional checks stay outside the five-minute
  identity-observation window.
  1. `scripts/hosting-release/hosting-capture.cjs` (no network, filesystem, environment,
     clock, subprocess or credential access; no HTTP executor). `planCapture` builds a
     deterministic, frozen two-site plan from explicit inputs: project, expected Hosting
     candidate fingerprint, pair build, routing, a cache-busting nonce, trusted configuration
     (`.firebaserc` sites and contract origins as the caller read them) and the claimed
     origin-to-site assignments. Each assignment must equal the trusted mapping; malformed
     origins (exact lowercase `https://host` only), unexpected targets, sites or projects,
     duplicate targets, sites or origins and ambiguous trusted configuration refuse. Site
     identity is never inferred from a URL. The plan separates provider API GETs (only
     `sites.channels.get` for the live channel and `sites.versions.files.list`, under
     `firebasehosting.googleapis.com/v1beta1`) from public-origin GETs, in the phase order
     before (both sites), manifest (complete pagination per site), edge (one cache-busted GET
     per served path), after (both sites), and records the five-minute window with what falls
     inside and outside it.
  2. `replayCapture` consumes a supplied transcript (`lyfelabz.hostingCaptureTranscript` v1,
     `synthetic-fixture` or `offline-record` only; no live-capture kind exists) bound to the
     plan fingerprint. Each exchange must be the planned request: provider reads in plan
     order, page `n + 1` requested with page `n`'s token, edge reads in any order inside the
     edge phase, GET only, HTTP 200, no followed redirect (response URL equals the planned
     origin, path and nonce), timestamps non-decreasing and inside the window. Missing,
     extra, duplicate and reordered exchanges refuse; the window is refused when longer than
     five minutes, stale, future or inverted. Live-channel responses must name the planned
     site and project; int64 `fileCount` strings are accepted. The evidence is normalized into
     a Part B observation schema 2 and verified by the unchanged Part B and Part C contracts,
     which own release type, version stability, message, served-byte, manifest and binding
     rules. The result separates plan validity, transcript completeness, origin-to-site
     consistency, manifest completeness, local gzip binding (Part C semantics unchanged),
     public-edge bytes (`single-observation`), release/version stability, receipt
     consistency, hash-cache policy, compression evidence (`compatible`, `incompatible` or
     `missing`) and per-site self-calibration (`consistent-with-local-profile` or
     `inconsistent`, corroboration only, never changing the binding). `deploymentProvenanceEstablished`
     and `servingEstablishedByManifest` are `false`; `deployable`, `certified`, `authorized`
     and `available` are all `false`.
  3. `scripts/hosting-release/deploy-receipt.cjs` (pure) validates a supplied pre/post
     `lyfelabz.hostingDeployReceipt` v1 pair: source, candidate fingerprint, invocation id,
     project and sites, Firebase CLI version and executable, Node executable, the Part C
     compression profile (Node and zlib versions, gzip parameters, header OS byte, calibration
     digests, validated by Part C `validateProfile`), hash-cache presence and digest,
     timestamps and `operator` provenance. Source, invocation, candidate, project, sites, CLI,
     Node and profile must be identical across the pair. A cache present before deployment
     leaves the pair consistent and the policy `violated`. It never reads or deletes the
     cache, never inspects the environment and never invokes Firebase CLI or Node. Replay
     requires the post receipt to precede the observation window.
  4. Not changed: certify, release, build-pair, backend-state, Parts A to C modules, the client
     gate, Functions A3 code, Rules, indexes, registries, Firebase configurations, CI and S6b
     to S6f. `prepare.cjs` gains two `HOSTING_TEST_FILES` lines. The Part B and Part C
     no-consumer guards (`hosting-deployment.test.cjs`, `provider-manifest.test.cjs`) add only
     the Part D files to their allowlists (owner-approved scope extension); no release,
     deployment or activation path requires any D13 module (tested).
  5. Status: implemented in the repository, uncommitted, not independently certified. Verified
     against synthetic transcripts only; it has never observed a real project.
  6. [U] Still open: an authorized read-only staging capture (transport, identity, IAM
     confirmation that `firebasehosting.sites.get` covers channel and files reads, and
     measured timing against the five-minute window), a capture mechanism that records the
     receipt where the deploy runs, edge-cache staleness and multi-edge consistency, bundle
     classification, an enabled builder and S6b binding.

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
findings); P3 hardening applied; independently verified and integrated on `main`
at `484de499f81e6fdec6594e66f164887bbfeb23ac`. S2 later extended
`a3-signature.ts` with the certification kind only (see S2 below). Not wired: no
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

### S2 - Certification statement, history schema and revocation list

Status: implemented on top of `484de49`. The first independent certification failed
with remediation required (two blocking P2 findings, F1 and F2, and two P3 findings,
F3 and F4); all four were remediated as described below. S2 then passed final
independent recertification and was committed and pushed by the human owner at
`6265564e05c15efea0e4b65abe05ee5fa7a2f1ec` (recorded at the owner's direction, O7;
no separate signed approval artifact exists). Not wired, not deployed. Teacher Units remains closed:
`teacherUnitsAvailable()` returns `false` and production still uses
`UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`. No key, signature, evidence, bucket, IAM,
Rules, index, Hosting or deployment change. Authorized decisions: O1(a) (extend the
S1 verifier with the certification kind only), O2 (standalone revocation-list
module), O3 (D8 history over the existing policy-transition semantics).

- **D7 certification** (`a3-contracts.ts`, `a3-validation.ts`). Kind
  `teacher-units-release-certification`, action `certify-release`, the established
  `{schemaVersion, payload: {schemaVersion, kind, statement, source}}` shape and
  `approvalRule` (statement digest equals `source.statementObject.sha256`). The
  statement binds exactly: environment identity, `backendReleaseId`,
  `hostingCandidateFingerprint`, `placementFingerprint`, `enforcementVersion`
  (`teacher-units-a3-v1`), `clientContractVersion` (`teacher-units-v2`),
  `certificationReport` (`ContentObjectV1`), `authority` and `issuedAt`. It has no
  policy instance or generation; any extra field is refused.
- **Evidence reference** (`a3-bindings.ts`). `validateEvidenceReference` accepts the
  certification kind at its content address. Every existing kind is unchanged. This
  is runtime-reachable: A3-3 `readEvidence` and the policy chain use this validator.
  A3-3 still requires `teacher-units-activation` and
  `teacher-units-activation-approval` at their positions, and tests show a valid
  certification substituted at either position refuses `deploymentIneligible`.
- **D7 fix 3 dispositions.** `validateDispositionBinding` accepts a certification
  target. `revoke` has no replacement; `supersede` requires a replacement of the same
  kind (certification to certification only; no cross-kind replacement in either
  direction).
- **Certification-to-activation binding.** `validateCertificationBinding(certification,
  activationApproval, release)` requires the certification to sit at the activation
  approval's `certificationEvidenceRef` and to equal it, and the release, in
  environment identity, `backendReleaseId` (also equal to the release manifest
  digest), `hostingCandidateFingerprint`, `placementFingerprint` (also equal to the
  manifest), `enforcementVersion` (the manifest's) and `clientContractVersion` (the
  approval's and the manifest's). Structural only; it is not called by
  `validateActivationBinding` or enforcement (test-enforced). Wiring is S3.
- **S1 extension (O1(a)).** One entry added to the `KINDS` map in `a3-signature.ts`:
  `teacher-units-release-certification` maps to `certify-release` and validates with
  `validateReleaseCertification`. Algorithms, signing bytes, the snapshot, registry
  branding, key admission, identity binding and failure reasons are unchanged.
- **D8 history** (`validateAvailabilityHistory`, `availabilityPolicyDigest`,
  `validateAvailabilityHistoryReference`, `validateAvailabilityHistoryBinding`).
  Document fields: environment identity, `schemaVersion: 1`,
  `kind: "teacher-units-availability-history"`, `transition` (`initialize`,
  `prepare`, `enable`, `shutdown`), `policyInstanceId` and `nextGeneration` (the next
  policy's own values; `nextGeneration` is 1 exactly for `initialize`),
  `previousPolicyDigest` (null only for `initialize`), `nextPolicyDigest`, `evidenceRefs` (strictly ascending, unique release
  or evidence content addresses), `operatorSubject`, `reason`. Stored at
  `teacherUnitsAvailabilityHistory/{sha256(canonical document)}`. A policy digest is
  the SHA-256 of the whole policy with `updatedAt` projected as explicit
  `{seconds, nanoseconds}`; it requires a valid policy, so a server-timestamp sentinel
  or JSON timestamp is refused. The binding derives the transition from the existing
  semantics: no previous policy plus `validateInitialPolicy` is `initialize`;
  otherwise `validatePolicyTransition` must pass, an unchanged generation (a noop) is
  refused, closed to closed is `prepare`, closed to enabled is `enable`, enabled to
  closed is `shutdown`, and enabled to enabled has no approved kind and is refused.
  `enable` must record the activation evidence reference; `prepare` that sets a
  release must record that release reference; `initialize` records none. The
  binding also requires `policyInstanceId` and `nextGeneration` to equal the next
  policy's. No CAS writer, transaction or storage (S6).
- **D8 fix 4 reporting (F2 remediation).** A history record's generation is the
  generation it produces, and its durable grouping key is
  `(environment identity, policyInstanceId, nextGeneration)`: the same pair the
  withdrawn `{policyInstanceId}_{generation}` ID named, now carried in the
  content-addressed body instead of the ID, so no generation-keyed uniqueness can
  block a shutdown. After a D1-B rollback to generation N, the next shutdown produces
  a second record for N+1. `reportRepeatedHistoryGenerations(records)` takes
  `{ref, document}` pairs, snapshots them once, validates each at its content
  address, refuses mixed environments and repeated records, and returns every
  `(policyInstanceId, nextGeneration)` group with more than one record. It reads no
  policy and never refuses a transition. Retrieving the records (a collection read)
  is S6 tooling.
- **Certification report self-reference (F3 remediation).** A certification is
  refused when `certificationReport` names the statement's own Storage object
  version, that is the same `bucket`, `object` and object `generation` as
  `source.statementObject`, whatever hash it claims. Sharing only a bucket, an object
  name at another generation, or other metadata is accepted. Retrieving the report
  bytes, checking their hash and reviewing their independence remain registration
  and report-review gates (S6, A3-7); an S1 signature is never independent-report
  verification.
- **History immutable duplicates (F4 remediation, S2 portion).**
  `validateImmutableDuplicate` now routes `teacherUnitsAvailabilityHistory/` paths to
  the history content-address validator: an identical retry validates as a duplicate,
  and any other proposal at that address is a conflict. A history document is never
  accepted at an evidence or release address. **Deferred to S6 (already assigned by
  section 5):** create-only writes, the transactional read that makes a concurrent
  create conflict, and the emulator tests proving them. S2 provides no writer, so
  this is a named S6 gate, not a claimed S2 guarantee.
- **D5 revocation list** (`a3-revocation-list.ts`). Entry
  `{schemaVersion: 1, environment, projectId, projectNumber, revokedEvidenceRef}`.
  `createRevocationList(entries, identity)` snapshots its input through canonical
  serialization, requires a pinned identity (or a `demo-` emulator project), entries
  for exactly that identity, valid `teacherUnitsReleaseEvidence/` references and
  strictly ascending unique order, and returns a frozen, branded list.
  `revocationStatus(list, ref, expected)` fails closed (F1 remediation): it returns
  `inputMismatch` when the query is not a canonical `teacherUnitsReleaseEvidence/`
  reference (any malformed string or non-string) or the expected identity is
  malformed or unreadable; `listUnrecognized` for an unbranded list or a list bound to
  another identity; otherwise `revoked` or `notRevoked`. `inputMismatch` is the
  existing S1 and A3-3 failure name. Callers must treat both failures as refusal,
  never as `notRevoked`. A reference cannot carry its environment, so cross-list
  leakage is prevented by the list's identity binding.
  `PRODUCTION_REVOCATION_LIST` is empty and bound to production. No R1 lookup, no
  tooling; nothing imports it (test-enforced).
- **Fixtures.** `fixtures/teacher-units-a3/v1.json` gains `valid.releaseCertification`,
  `valid.availabilityHistory`, 20 invalid cases and two vectors (the certification
  payload and the history document). The four existing vectors and every existing
  valid and invalid entry are byte-identical (the change is insertions only).
- **Interpretations recorded for certification review.** D8 lists the history
  content but not field names; the names, `schemaVersion` and `kind` above follow the
  existing document conventions. `prepare` covers any non-noop closed-to-closed
  transition. The per-transition evidence requirements are the minimum the transition
  itself implies. D5 does not fix the deny-list entry shape; the shape above is the
  O2 approval. `policyInstanceId` and `nextGeneration` were added in remediation
  (F2): policy digests alone cannot recover generation once the singleton policy is
  overwritten.
- Tests: `a3-certification-history.test.ts`, `a3-revocation-list.test.ts`, S2 cases in
  `a3-signature.test.ts`, fixture validators in `a3-contracts.test.ts`, and two A3-3
  regression cases in `teacher-units.test.ts`. Mutation checks were run in a scratch copy,
  including for each remediation. One overlapping guard survives by design: in the
  history branch of `validateImmutableDuplicate`, validating the existing record is
  also implied by canonical equality with the validated proposal (the same pattern
  as the A3-1 release and evidence branches).

### S3 - Composite release-authority verifier

Status: implemented on top of `6265564`. The independent certification reported two
P3 findings (F1, F2); both were remediated as described below. S3 then passed focused
independent recertification and was integrated on main by the human owner at
`c67d8b4bbf19f60fbec5e9a6c56a82fb6d52c600` (recorded at the owner's direction, S4 O8).
Not wired and not deployed. Teacher Units
remains closed: `teacherUnitsAvailable()` returns `false`, production still uses
`UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`, and `PRODUCTION_AUTHORITY_REGISTRY` and
`PRODUCTION_REVOCATION_LIST` are empty. No key, signature, evidence, bucket, IAM,
Rules, index, Hosting, client, build or deployment change. No S1 or S2 source, A3-3
enforcement or handler, `a3-release-authority.ts`, `index.ts` or canonical fixture
changed.

**Owner-authorized implementation decisions (S3 reconnaissance, O1 to O7).** Recorded
at the human owner's direction; no separate signed approval artifact exists.

- **O1.** A revocation list that is unrecognized for the runtime identity
  (`listUnrecognized`) maps to `dispositionUnresolved`. A malformed revocation query
  maps to `inputMismatch`. Both fail closed. No new reason is added.
- **O2.** S1's specific `authorityUnrecognized` and `signatureUnverified` reasons are
  preserved for all three signed documents, including the certification.
- **O3.** All four evidence references (deployment approval, activation evidence,
  activation approval, certification) are checked against the pinned revocation
  list, including the unsigned activation evidence.
- **O4.** S3 performs no runtime disposition lookup (R2, D5). Superseded approvals and
  certifications remain valid at runtime unless pinned; **S6 must address superseded
  approvals and certifications in the revocation procedure.**
- **O5.** The S1 (`a3-signature.test.ts`) and S2 (`a3-certification-history.test.ts`)
  import-allowlist tests each admit `teacherUnits/a3-composite-verifier.ts` only.
  Independent S3 not-wired and production-reachability tests were added.
- **O6.** Exceptions from `readEvidence` propagate unchanged from S3. **Mandatory
  pre-wiring gate:** A3-3 `callVerifier` (`a3-enforcement.ts`) catches every verifier
  exception and returns unverified `error`, so once a real verifier is wired an
  SDK-retryable Firestore error or `policyUnavailable` raised inside `readEvidence`
  would surface as `deploymentIneligible` instead of an SDK transaction rerun or
  `policyUnavailable`. This fails closed but misclassifies a transient failure. It
  must be resolved, with its own authorization and tests, before any verifier other
  than `UNCONFIGURED` is wired. S3 does not modify A3-3. **Update:** the correction is implemented (see "O6 - A3-3
  verifier exception boundary" below) and awaits independent certification.
- **O7.** S2 status above records its final recertification and owner integration at
  `6265564`.

Confirmed: no runtime `issuedAt` age or ordering check (D6); no `endpointName` check
(A3-2 provenance already binds the endpoint); no production verifier instance and no
activation.

- `platform/functions/src/teacherUnits/a3-composite-verifier.ts`:
  `verifyReleaseAuthorityChain(chain, deps)` is the pure, synchronous core (the
  Decision 4 input without `readEvidence`, plus the certification document or
  `null`); S6 may reuse it for the checks tooling can run (D8 fix 3), never for A3-2
  provenance. `createCompositeReleaseAuthorityVerifier(deps)` is the asynchronous
  Decision 4 adapter. `deps` is exactly `{registry, revocationList}`, each branded by
  `createAuthorityRegistry` / `createRevocationList`; there are no defaults and the
  module exports no verifier instance. No Firestore, network, clock or cache.
- **Algorithm** (first failure returns):
  - V0 snapshot: every input field captured once from own data descriptors (no getter
    runs; exact key set); documents and identity through canonical serialization
    into deep-frozen private copies; the policy `Timestamp` must have exactly the SDK
    prototype and exactly its own data fields `_seconds` and `_nanoseconds` (installed
    `@google-cloud/firestore` 7.11.6), captured from their descriptors and rebuilt with
    the SDK constructor (F1). Any failure: `inputMismatch`.
  - V1 structure (`inputMismatch`): runtime identity pinned (cloud) or `demo-` with a
    local profile (emulator); policy valid for that identity and `enabled`;
    `releaseRef` is the policy's release and `validateReleaseReference` passes;
    `deploymentApprovalRef` is the manifest's and `validateDeploymentBinding` passes;
    `activationEvidenceRef` is the policy's and is activation evidence at its content
    address; `activationApprovalRef` is the evidence's `authorizationEvidenceRef` and
    is an activation approval at its content address; `validateActivationBinding`
    passes using the approval statement's Hosting fingerprint **provisionally**.
  - V2: the adapter calls `readEvidence` exactly once, for the approval statement's
    `certificationEvidenceRef`, only after V1 passes. Exceptions propagate (O6).
  - V3 revocation: the four references (O3); `revoked`, `dispositionUnresolved` (O1),
    `inputMismatch`.
  - V4, V5: deployment approval (`deploy-backend`) and activation approval
    (`activate-teacher-units`) signatures through `verifyApprovalSignature`, S1
    reasons preserved (O2).
  - V6: certification missing, malformed, wrong kind or failing
    `validateCertificationBinding` (release, Hosting, placement, enforcement,
    contract, environment, self-reference): `certificationUnverified`.
  - V7: certification signature (`certify-release`), S1 reasons preserved.
  - V8: verdict built only from the signature-verified activation approval statement
    and the content addresses of verified documents (so the Hosting fingerprint
    enters a verdict only after V5), then parsed by `parseReleaseAuthorityVerdict`;
    a parse that does not return `verified` is `error`.
- **Tests.** `a3-composite-verifier.test.ts` (hermetic, synthetic Ed25519 keys
  generated in-process): verified staging, production and emulator chains with exact
  fields; pure core parity; empty production registry refusal; forged, flipped-bit,
  malleated (S + L) and wrong-action signatures for each signed document; registry
  and statement authority mismatches; cross-project and cross-environment replay;
  each structural binding; all four revocation targets; unrecognized lists;
  missing, malformed, substituted, mis-bound and self-referencing certifications;
  accessors, stateful Proxies and caller mutation during `readEvidence`; exactly one
  `readEvidence` call; exception propagation; no caching; dependency branding; and
  the S3 not-wired, production-reachability (import graph from `index.ts`), build
  exclusion and closed-gate checks. `a3-test-support.test.ts` gains an additive
  signed-chain builder and test registry and revocation-list helpers (the existing
  unsigned chain is unchanged). `teacher-units.emulator.test.ts` gains an additive
  S3 block that injects the composite verifier through the existing handler factory
  over real Firestore documents read by A3-3's own `readEvidence`.
- **Mutation evidence** (scratch copy): removing each of the revocation check, each
  signature check, the certification binding, the snapshot, `readEvidence`
  propagation, read-after-structure ordering, final verdict parsing, the exact
  `Timestamp` class check, dependency branding, the exact input key set, the
  demo-only emulator identity, the deployment-approval reference binding, the
  activation binding, or verdict sourcing from the snapshot, or importing S3 or S2
  from `a3-enforcement.ts`, each fails at least one test. Surviving mutants are
  redundant guards covered by the A3-1 validators or by construction: the
  policy-enabled check, the release, activation-evidence and activation-approval
  reference equalities, the null-certification guard, the cloud pin re-check and the
  signer action re-check. They are kept as defense in depth. **Correction (F2):** an
  earlier version of this list called the input data-property (accessor) guard
  redundant. It is not: without it an `endpointName` accessor is captured as
  `undefined` and the chain still verifies, because S3 deliberately does not validate
  `endpointName` (A3-2 binds the endpoint). The guard is required and is now pinned by
  a permanent regression test.
- **Certification remediation (F1, F2; both P3).**
  - F1 root cause: the policy snapshot required the exact SDK `Timestamp` prototype
    but then read `seconds` and `nanoseconds` by property access. A genuine
    `Timestamp` with an own `seconds` or `nanoseconds` accessor (or data property)
    shadowing the prototype getter therefore ran caller code, and the chain could
    return `verified`. Fix (S3 module only): the Timestamp's own properties are
    captured with one descriptor read and must be exactly the enumerable data fields
    `_seconds` and `_nanoseconds`; their values are passed to the SDK constructor,
    which re-validates the ranges. No getter runs. The approved timestamp contract,
    the shared A3-1 validators and S1/S2 are unchanged. An SDK that changes this
    private shape fails closed.
  - F2: a permanent test proves an `endpointName` accessor is refused by the adapter
    and the core with `inputMismatch` and is never invoked.
  - Tests: `a3-composite-verifier.test.ts` "policy timestamp (certification F1)" and
    "input accessor guard (certification F2)". Targeted scratch mutations, each killed
    by a permanent test returning `verified` where `inputMismatch` is required (no
    compile-failure counted): the exact pre-fix getter read; reading the SDK fields by
    property access; dropping the exact own-shape check; relaxing the exact prototype
    check to `instanceof`; removing the prototype check; removing the data-property
    guard (killed by the F2 test).
- **Remaining dependencies.** S4 (nine-endpoint observer, D10 allowlist, gates G1, G2,
  G4), S5 (IAM and route review, G3), S6 (operator CLI: create-only registration, CAS
  with history, freshness, shutdown, the R2 revocation procedure including superseded
  approvals and certifications (O4), report retrieval and independence review),
  D12 (policy-controlled build), D13 (enabled Hosting format), the O6 pre-wiring gate,
  separately authorized wiring, and A3-7 integrated certification.

### S4 - Nine-endpoint provider observer

Status: **certified and integrated on main (`8c7cc55`)**, on top of `c67d8b4`; not
deployed, never run against a real project. The independent certification reported
four findings (F1 to F4); all are remediated as described below. Focused
recertification then reported four further findings (A to D), also remediated below,
and the owner records targeted recertification as passed before integration (commit
`8c7cc55`, "Add certified A3-6 S4 provider observer"). Status corrected in S5 at the
owner's direction (S5-D7); this line previously read "awaiting targeted
recertification". Verified only against synthetic fixtures (O5); no response was
recorded from staging or production, so this is implementation verification, not
provider verification. Teacher Units remains closed: `teacherUnitsAvailable()`
returns `false`, production uses `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`, and the
production registry and revocation list are empty. No S1, S2, S3, A3-3, A3-4, A3-5,
RAP, publisher, Rules, index, Hosting, Functions source, build-profile, IAM or
infrastructure change.

**Owner-approved implementation decisions (S4 reconnaissance, O1 to O8).** Recorded at
the human owner's direction; no separate signed approval artifact exists.

- **O1.** The observer emits a private observation record. Each endpoint is the A3-1
  `CloudEndpointConfigurationV1` shape **without** `invocation`; S5 owns
  `InvocationAccessV1` and `accessReviewReceipt`. No placeholder is emitted. The
  observed Cloud Run access flags (`invokerIamDisabled`, `defaultUriDisabled`,
  `iapEnabled`, `customAudiences`) are recorded in a separate `provider.accessForS5`
  block for S5 review, never interpreted.
- **O2.** `scripts/hosting-release/backend-state.cjs` gains an export-only addition of
  `resource` and `onlyKeys` (`timestamp` was exported initially and withdrawn in the
  F4 remediation). A1 behavior, its eight-endpoint inventory
  and its tests are unchanged.
- **O3.** CommonJS under `scripts/teacher-units-release/`, using the compiled A3
  protocol, validation and canonical modules. Not part of the deployed Functions
  payload and not reachable from `index.ts`.
- **O4.** Every observed environment variable must equal the approved plan exactly;
  an unplanned variable refuses (gate G1 open). No allowlist is defined. Refusals
  name a variable, never its value.
- **O5.** Synthetic fixtures only, labelled `SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED`.
- **O6.** Platform CI runs the S4 fixture tests after the Functions build, with no
  credentials and no provider calls.
- **O7.** A minimal deployment-plan comparison contract (below). Plan generation,
  signing, registration and release authority remain S6.
- **O8.** S3 status corrected above.

**Files.** `scripts/teacher-units-release/provider-observation.cjs`,
`provider-observation.test.cjs`, `fixtures/synthetic-provider.cjs`; export-only change
to `scripts/hosting-release/backend-state.cjs`; `.github/workflows/platform-ci.yml`.

**Provider sources.** Field sets come from the Cloud Functions v2 and Cloud Run v2
message definitions in Google Cloud SDK 583.0.0 (`generated_clients/apis/cloudfunctions/v2`,
`run/v2`). Any field outside those sets refuses. Reads (GET only, through A1
`readApi` and `list`): Firebase project, Firestore database, Functions v2 LIST and
per-endpoint GET, Cloud Run v2 service and revision GET, the generation-pinned source
archive, the Rules release and ruleset, and Firestore indexes and fields. Endpoint
metadata, the Rules release, the index snapshot and the Functions inventory are each
read twice and must be unchanged; the whole observation must finish within the A1
five-minute deadline.

**Normalization (Cloud Run revision is authoritative for execution).** Identity is pinned
to the A3 project pins; resource names using the project number are bound to the
pinned project ID. Refusals include: not GEN_2 ACTIVE nodejs22 in us-central1;
missing, duplicate, cross-region or unknown `teacherUnits*` endpoints; any traffic
split or extra route, including a zero-percent tagged route; Functions and Cloud Run
revision or service-account disagreement; reconciling, unready or deleting resources;
an image not pinned by digest; a source archive not matching the pinned generation;
endpoints running different application payloads; more than one container, sidecars,
`sourceCode`, sandbox, encryption key, service mesh, node selector, binary
authorization, SSH, service-level scaling overrides, worker pools, event triggers;
non-secret volume types; secret versions that are `latest`, an alias or absent; an
absent or ambiguous runtime update policy (G2); absent CPU, memory, timeout,
concurrency or execution environment. Proto3 JSON omitted scalars are read as their
documented zero values (instance minimum 0, absent maximum null, empty maps).

**Plan contract `lyfelabz.teacherUnitsA3DeploymentPlan` v1.** A `ContentObjectV1`
attachment whose bytes must hash to its `sha256` and be exactly `canonicalJSON` of a
plan with fields: environment identity, `region`, `databaseId`, `deployCommand` (exactly
`firebase deploy --only functions:<nine sorted names> --project <id>`), `candidate`
(`runtimePayloadFingerprint`, `functionsArtifactFingerprint`, `placementFingerprint`),
`rules.sourceHash`, `readyIndexesConfigurationHash`, `sourceArchive` (see the
archive distinction below), and nine sorted endpoints each with the complete A3-1
`execution` block, the `build` block without `source`, and the `runtimeProfile`
(F1 remediation). Comparison is exact; every difference refuses. CPU
and memory admissibility here means explicitly observed values and execution
environment equal to the approved plan on a Ready revision; no provider limit table
is asserted.

**Verification (implementation only).** Initially 25 fixture tests (34 after the
F1 to F4 remediation), including
`validateEndpoint` acceptance of each observed endpoint once a test-only invocation
block is added, A1 eight-endpoint rejection, GET-only transport through A1 `readApi`,
determinism, and A1, S4 and A3-2 fingerprint equality on synthetic and on the real
compiled Functions artifact. A scratch mutation pass removing 13 individual guards was
killed by the suite each time.

**Certification remediation (F1 to F4).** The independent certification demonstrated
four defects. Each is remediated in the S4 files only; A1 behavior, S1 to S3, A3-3 to
A3-5 and every canonical fixture are unchanged.

- **F1 - incomplete comparison.** Root cause: the plan compared only the A3-1
  `execution` and `build` blocks, and accepted provider objects were key-checked only
  at the top level, so `cpuIdle`, `startupCpuBoost`, the Cloud Run CPU and concurrency
  utilization thresholds, session affinity, the termination grace period, the
  container port and an unknown nested `startupProbe` field all still returned
  `matched: true`. Fix: every accepted field is now classified as (A) normalized into
  the observed configuration and compared against the plan, (B) refused, or
  (C) metadata recorded but not compared. (A) is a per-endpoint `runtimeProfile`
  holding the revision execution environment, session affinity, grace period,
  annotations, utilization thresholds, launch stage, and container CPU idle, startup
  boost, ports, startup, liveness and readiness probes and `buildInfo.functionTarget`;
  the service launch stage, threat detection, annotations and scaling; and the
  Functions `buildpackStack`, `dockerRegistry` and the complete declared
  `serviceConfig` (except its service, revision and URI identity fields, which are
  bound elsewhere). (B) adds `buildInfo.sourceLocation`, template
  `healthCheckDisabled`, and non-numeric secret versions in the Functions declaration.
  (C) is labels, `buildId`, the source token, descriptions, URIs, etags, UIDs,
  creators, clients and status-only fields (`scalingStatus`, conditions other than
  readiness); each is still type- and field-checked. Every nested object (probes,
  ports, conditions, scaling, binary authorization, build info, Functions secret and
  VPC entries, the service template) is checked against its documented field set; an
  absent field is `null`, never an inferred default. The Cloud Run service `template`
  must normalize to exactly the serving revision. Fractional numbers are carried as
  exact decimal text because A3 canonical JSON admits only safe integers.
- **F2 - observation-wide consistency.** Root cause: each endpoint was bracketed
  only around its own source retrieval, so an early endpoint could change after its
  second read. Fix: after the Rules, index and inventory checks, a final pass re-reads
  the Functions, Cloud Run service and revision resources of all nine endpoints and
  refuses any difference from the captured snapshots, including a vanished resource
  or a failed read. Provider APIs offer no global transactional snapshot: this narrows
  but does not eliminate time-of-check/time-of-use races. A change after the final
  pass, or one reverted between reads, is not detected.
- **F3 - source generation.** Root cause: a declared `storageSource.generation`
  was ignored, so generation 999 was accepted against a different resolved
  generation. Fix: a declared generation must be a canonical int64 equal to the
  resolved generation; a missing or malformed resolved generation and empty bucket or
  object names refuse. A1 archive retrieval is unchanged.
- **F4 - timestamps.** Root cause: the A1 helper (`Date.parse`) accepts impossible
  dates and arbitrary formats. Fix: an S4-local validator accepts only Google JSON
  Timestamps (RFC 3339, `Z`, 0, 3, 6 or 9 fractional digits) whose calendar fields
  round-trip. It covers function, Cloud Run service and revision create and update
  times, condition transition times, the Rules release and the observation clock.
  Ordering is checked only within one resource (create no later than update) and
  against the observation clock (nothing is in the future). No build resource is
  read, so no build timestamp exists to validate. The A1 helper is unchanged; the
  earlier export of `timestamp` from A1 was withdrawn as no longer needed.
- **Archive distinction (owner decision).** Four concepts remain distinct: the
  runtime payload fingerprint (canonical runtime files without the build record),
  the Functions artifact fingerprint (the normalized artifact inventory), the
  placement fingerprint and the source archive hash (exact uploaded bytes, recorded
  per endpoint and in `sourceArchiveHashes`). Different archive bytes can carry the
  same runtime payload and are not refused for that alone. The plan's `sourceArchive`
  is `{policy: "unbound"}` (hash recorded, not approved) or
  `{policy: "exact", sha256}` (every endpoint must match). Runtime equivalence is never
  claimed as archive reproducibility; G4 stays open. No fingerprint definition changed.
- **Regressions and mutations.** Permanent tests reproduce each certification
  counterexample (the seven F1 fields plus an unknown nested probe field, the early
  endpoint traffic change, generation 999 and invalid timestamps). Compile-safe scratch
  mutations of nested validation, plan completeness, final revalidation, generation
  agreement, timestamp parsing, template equality and archive binding were each killed
  by a behavioral test failure. Two survivors were equivalent: renaming a profile key
  (the same data is still compared) and the hour-range check (an hour of 24 already
  fails the calendar round trip).

**Second focused remediation (A to D).** F1 to F4 corrections and their regressions are
unchanged.

- **A - Cloud Run base image.** Root cause: `baseImageUri` fed only the
  `runtimeUpdatePolicy`, which is taken from the serving revision, so a template that
  named a different base image still matched. Fix: `baseImageUri` (or `null` when
  absent) is part of the normalized container profile, so it is in both the
  template-versus-revision equality and the plan comparison.
- **B - update policy shape.** Root cause: `typeof [] === "object"`, so `[]` passed as
  an empty `AutomaticUpdatePolicy`. Fix: both policies must be plain JSON objects
  (prototype `Object.prototype`, not null, not an array); automatic must be exactly
  `{}` and on-deploy exactly `{runtimeVersion: <nonempty string>}`.
- **C - Rules creation timestamps.** Root cause: only the release `updateTime` was
  validated. Fix: the release `createTime` and `updateTime` (update required) and the
  ruleset `createTime` use the strict S4 validator, are not in the future, and the
  release `createTime` is no later than its `updateTime`. No ordering is asserted
  between the ruleset and the release.
- **D - disabled Rules release.** Root cause: the release object was not
  field-checked, and `disabled` (a documented `Release` boolean in Firebase Rules v1)
  was ignored. Fix: the release is checked against its documented fields; `disabled`
  must be absent or a boolean, and `true` refuses. An enabled or absent flag stays
  eligible.
- **Bounded field review.** Sources: Cloud Functions v2, Cloud Run v2, Firebase Rules
  v1 and Firestore Admin v1 messages in Google Cloud SDK 583.0.0. One further bypass
  was demonstrated and fixed: the Firestore database response was checked only for
  `name` and `type`, so a database with `deleteTime` set or
  `firestoreDataAccessMode: DATA_ACCESS_MODE_DISABLED` was accepted. It is now checked
  against its documented fields; `deleteTime` and disabled native data access refuse,
  and `createTime` and `updateTime` are strict. The ruleset is now field-checked:
  `attachmentPoint` refuses when present (its meaning for `cloud.firestore` is
  unverified), a source language other than `FIREBASE_RULES` refuses, and file and
  metadata objects are field-checked. Remaining accepted-but-uncompared fields, each
  justified as metadata: database encryption, edition, location, retention, tags and
  similar storage settings (they do not affect whether these Rules and endpoints are
  served); the ruleset file `fingerprint` (the content hash is computed
  independently); labels, IDs, etags, URIs, creators and clients; status-only Cloud
  Run conditions and scaling status; and the index TTL state (A1 records only TTL
  presence, and TTL does not affect access). The Cloud Run `invokerIamDisabled`,
  `defaultUriDisabled`, `iapEnabled` and `customAudiences` flags remain recorded for
  S5 and are not interpreted in S4 (O1).
- **Regressions and mutations.** Permanent tests reproduce each counterexample (the
  template base image, `automaticUpdatePolicy: []`, malformed, future and misordered
  Rules creation times, `disabled: true`) and the database bypass. All five new tests
  fail against the pre-remediation module. Targeted scratch mutations of each
  correction were killed by a behavioral test failure. One equivalent survivor:
  removing the explicit array check from the plain-object test, because the prototype
  check already rejects arrays.

**Unresolved [U].** G1 (platform-injected variables), G2 (update policy actually
reported), G4 (deploy-time rebuild reproducibility) and the following provider facts
need a separately authorized real observation: whether deployed revision images are
digest-pinned, whether `executionEnvironment`, `buildConfig.serviceAccount` and
`buildConfig.dockerRepository` are reported, the Cloud Run `traffic` form written by
Firebase deploys, and whether Cloud Run returns `buildConfig` on these services. Each
currently refuses when absent or present respectively, so a live run may refuse until
they are resolved. The Functions `serviceConfig` values are compared verbatim against
the plan (F1) but are not cross-converted against Cloud Run, because their unit
conventions are unverified.

**Remaining dependencies.** S5 (IAM and route review, `invocation`, G3), S6 (plan
generation, operator CLI, registration, freshness at enable, revocation), D12, D13,
the S3 O6 pre-wiring gate, a separately authorized staging observation, and A3-7.

### S5 - IAM and route review (fixture-based, level A)

Status: **certified and integrated on main (`99e480e`)**, on top of `8c7cc55`; not
deployed, never run against a real project. The independent certification failed with
findings F1 to F6; all are remediated as described below, and the targeted
recertification passed before integration (commit `99e480e`, "Integrate certified A3-6
S5 access review"). Status corrected in S6b at the owner's direction (S6b-D4); this line
previously read "awaiting targeted recertification". Verified only
against synthetic fixtures labelled `SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED`; this is
implementation verification, not provider verification, and gate G3 stays open.
Teacher Units remains closed: `teacherUnitsAvailable()` returns `false`, production
uses `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`, and the production registry and
revocation list are empty. No S1 to S4, A3-3, A3-4, A3-5, RAP, publisher, Rules,
index, Hosting, Functions source, IAM, service-account or infrastructure change.

**Owner decisions (S5 reconnaissance).** Recorded at the human owner's direction; no
separate signed approval artifact exists.

- **S5-D1.** D11's public-callable model is preserved: an explicit Cloud Run
  `roles/run.invoker` grant to `allUsers`, with authentication in callable code. The
  expected Cloud Functions policy is not invented; it is stated in the expected-access
  contract.
- **S5-D2.** `invokerIamDisabled: true` refuses. An explicit IAM grant is the
  canonical posture.
- **S5-D3.** Organization, folder and project inheritance is in scope for final G3.
  It is not observed in this slice, so it is recorded as unresolved and blocks full
  eligibility.
- **S5-D4.** `iapEnabled` must be `false`. No IAP administration or configuration.
- **S5-D5.** Final G3 covers deployed Hosting routes, domain mappings, load balancer
  backends, default endpoint URLs and ingress. Local `firebase.json` alone is
  insufficient; unverified live routes remain unresolved.
- **S5-D6.** A separate, versioned expected-access attachment. The S4 deployment-plan
  schema is unchanged.
- **S5-D7.** The stale S4 certification status above is corrected.

**Files.** `scripts/teacher-units-release/access-review.cjs`, `access-review.test.cjs`,
`fixtures/synthetic-access.cjs`; `.github/workflows/platform-ci.yml` (fixture test step,
no credentials). CommonJS, using the compiled A3 protocol, validation and canonical
modules, the S4 exports (`assertA3Observation`, `ENDPOINTS`, `FIELDS`, `instant`) and
A1 `canonical`, `fingerprint`, `resource`, `readApi`. Not reachable from `index.ts`
and not part of the deployed Functions payload.

**Evidence levels.** A: structurally valid access review (produced by S5). B: complete
provider-verified access review (never produced by S5 v1). C: release-authorized
access evidence (S6 signing and registration). The receipt schema admits only
`reviewLevel: "A-structural"`, `providerComplete: false` and `releaseAuthorized: false`,
and only `status: "unresolved"` for inherited IAM, deployed Hosting releases, domain
mappings and load balancer backends, so a fixture can never present itself as B or C.
`assertProviderCompleteAccessReview` always refuses in v1.

**Reads (GET only, injected transport, explicit `--project`).** For each of the nine
endpoints: Cloud Functions v2 function GET and `:getIamPolicy?options.requestedPolicyVersion=3`;
Cloud Run v2 service GET, serving revision GET and
`:getIamPolicy?options.requestedPolicyVersion=3`. All 45 reads are made in two
observation-wide passes (90 reads); any difference between passes,
including an etag, refuses. Provider APIs offer no transactional snapshot: a change
reverted between passes, or made after the second pass, is not detected. The review
must start after the S4 observation ended and finish within the S4 five-minute window;
no read is made after the window expires. A read failure refuses.

**Policy normalization.** Documented fields only (`auditConfigs`, `bindings`, `etag`,
`version`; binding `condition`, `members`, `role`; SDK 583.0.0). Refusals: unknown
fields; `auditConfigs` present; missing or non-base64 etag; versions other than unset,
1 or 3 (unset is read as 1, as IAM documents); malformed roles; empty or duplicate
members; duplicate roles; **any IAM condition** (not evaluable safely). Members are
accepted only when their meaning is evaluable from the policy alone: `allUsers`,
lowercase `user:` and `serviceAccount:` emails. Groups, domains, principal sets,
deleted principals, legacy project convenience values and `allAuthenticatedUsers`
refuse. A service account is accepted only from the reviewed project (its
`iam.gserviceaccount.com` domain, the project-number Compute default, the App Engine
default, or a `service-<number>@` service agent); any other is cross-project and
refuses. Bindings are sorted canonically and carry `condition: null`.

**Eligibility.** Gen2 invocation is authorized by Cloud Run `run.routes.invoke`, so
the Functions policy never establishes invocation security alone. Rules applied to
the approved plan and to the observation alike: the Cloud Run policy has exactly one
`roles/run.invoker` binding whose members are exactly `allUsers`; `allUsers` appears
only in `roles/run.invoker` (Cloud Run) or `roles/cloudfunctions.invoker` (Functions).
Then, per endpoint: `invokerIamDisabled` false; `iapEnabled` false; resource identities,
the current Function, service and revision re-validated by the certified S4
normalizer and reproducing the S4 record exactly (F2); the S4 deployment plan
comparison passing; bound default URLs (F3); no revision route URL; and exact equality with
the expected-access plan for runtime service account, ingress, `defaultUriDisabled`,
`customAudiences` and both policies' bindings. The policy version is recorded, not
compared: without conditions it carries no meaning and the provider chooses it.

**Expected-access contract `lyfelabz.teacherUnitsA3ExpectedAccess` v1.** A
`ContentObjectV1` attachment whose bytes must hash to its `sha256` and be exactly
canonical JSON: `schemaVersion`, `kind`, `environment`, `projectId`, `projectNumber`,
`region`, and nine sorted endpoints each with `runtimeServiceAccountEmail`, `ingress`,
`invokerIamDisabled: false`, `iapEnabled: false`, `defaultUriDisabled`,
`customAudiences` and complete `functionAllowPolicy` and `serviceAllowPolicy`
(`IamAllowPolicyV1`, conditions must be `null`). It does not reference the S4 plan;
binding the two is S6 release assembly.

**Routes.** Locally checked: the environment's own Hosting config (`firebase.json` for
production, `firebase.staging.json` for staging) refuses any rewrite with `function` or
`run`, or any unknown rewrite key; its hash is recorded as `checked-local-only`. Observed
from provider configuration (not network reachability): default URLs (function `url`,
Cloud Run `uri` and `urls`, https only), revision and tag routes, and ingress.
Unresolved: deployed Hosting releases, domain mappings, load balancer serverless
backends, and inherited IAM. Their absence is never claimed.

**Receipt `lyfelabz.teacherUnitsA3AccessReviewReceipt` v1.** Canonical JSON binding
project, number, environment and region; provenance (`synthetic-fixture` or
`provider-get`, a declaration that never raises the level); the S4 observation
fingerprint and window; the S4 deployment-plan hash; the expected-access hash; the review window and sources; the
inheritance and route statuses; and per endpoint the function, service and revision
resources, runtime service account, ingress, access flags, both policies (resource,
etag, normalized content and its SHA-256), default URLs and the revision route.
`receiptContentObject` gives its `ContentObjectV1` address at a caller-chosen location;
nothing is stored or signed. `assertAccessReview` verifies the bytes and re-applies
every rule against the S4 observation and the expected-access plan, so a resealed
forgery still refuses. `composeEndpoints` adds `InvocationAccessV1` to each S4
configuration and requires the A3-1 `validateEndpoint` to pass; the result stays
level A.

**Verification at first submission (implementation only).** 26 fixture tests covering the adversarial
cases set for this slice, including Cloud Run public access despite a restrictive
Functions policy, `invokerIamDisabled`, unexpected or public bindings, unevaluable and
cross-project principals, conditions, malformed policies, etag and content changes
between passes, unreadable policies, IAP, audiences, runtime identity, ingress,
missing and eight-endpoint substitution, cross-project and cross-environment
substitution, local Hosting rewrites, tagged and old revision routes, missing route
evidence, changes since S4, forged and resealed receipts, staleness, GET-only transport
through A1 `readApi`, and level-B refusal. 30 compile-safe scratch mutations of the
access guards were each killed. The `invokerIamDisabled` guard is also backed by the
receipt schema literal; its mutant is killed through the specific refusal message,
because the schema still refuses it.

**Certification remediation (F1 to F6).** The independent certification demonstrated
six defects. Each is remediated in the S5 files only; S1 to S4, A3-1 and every other
protected surface are unchanged.

- **F1 - forged level B.** Root cause: `assertProviderCompleteAccessReview` derived
  completeness from caller-supplied `providerComplete`, `provenance` and status fields,
  so a forged object, or a verified result edited afterwards, passed. Fix: the level B
  helper refuses for every argument and reads none of them; the verified result is
  frozen and its `unresolved` list is a fixed constant. There is no level B path.
- **F2 - current provider drift.** Root cause: S5 compared a hand-picked set of fields,
  so persistent changes to the service template, `reconciling`, latest revisions,
  function state and nested fields, and a missing template or URIs, were accepted.
  Fix: S5 also reads the serving revision and passes the current Function, service and
  revision to the certified S4 `normalizeEndpoint` (unchanged), then requires the
  normalized configuration, runtime profile and provider record to equal the S4
  observation exactly; the S4 deployment plan is now a required input and is compared
  through S4 `compareObservationToPlan`. Gap: the S4 normalizer is given the S4-recorded
  archive record rather than re-downloading the archive; a different resolved source
  generation refuses, and generation-pinned objects are immutable.
- **F3 - route and receipt integrity.** Root cause: default URLs were checked only for
  `https`, never bound, and the local Hosting path and hash were caller data never
  re-derived. Fix: the Functions URL must be exactly
  `https://us-central1-<project>.cloudfunctions.net/<endpoint>`; Cloud Run URIs must be
  `https://<service>-<project number>.us-central1.run.app` or
  `https://<service>-<hash>-uc.a.run.app`; a Cloud Run URI is required unless
  `defaultUriDisabled`; `uri` must be among `urls`; the Functions `serviceConfig.uri`
  must be among them. The Hosting path is fixed per environment and the hash comes only
  from reading that file; `assertAccessReview` re-checks the file and re-applies every
  URL rule, so a resealed substitution refuses. Gap: the hash form of a Cloud Run URL
  carries no project identity, so it is bound to the service name and region only. The
  URL forms are documented conventions, unverified against a live response; a live
  difference refuses.
- **F4 - contract mismatches.** Root cause: S5's content-object and policy schemas were
  looser than A3-1. Fix: generation must be a positive decimal no greater than
  9223372036854775807, and an IAM binding must have members, at the S5 schema and in
  the posture check, before composition.
- **F5 - etags.** Root cause: a character-class check accepted `a` and `abc==`. Fix:
  only the canonical standard Base64 encoding of a nonempty byte sequence is accepted
  (alphabet, padding, length and a byte-exact round trip). Two-pass etag equality is
  unchanged.
- **F6 - final deadline.** Root cause: no test exercised a window that expires after
  the last provider read. Fix: a test moves the clock past the window only after all 90
  reads and asserts that no receipt is produced, against a control run that produces
  one.

**Remediation verification.** 34 fixture tests. A scratch script reproduced all 18
certification counterexamples as accepted by the pre-remediation module and refused
after remediation. Behavioral mutation (a mutant counts only if a probe shows an unsafe
input becomes accepted and the suite fails): 11 of 11 independent guards killed
(level B, exact S4 comparison, S4 re-validation, Functions URL binding, Cloud Run URI
binding, Cloud Run URI presence, the Hosting route binding (probed for both path and
hash), generation bound, etag round trip, final deadline, and the empty-binding check
with both layers removed). Redundant, not
claimed as kills: the empty-binding schema check and posture check each alone (the
other refuses), and the etag length check (the round trip refuses).

**Unresolved [U] (gate G3).** Deployed invoker IAM; inherited organization, folder and
project IAM; deployed Hosting release rewrites (the Firebase Hosting API schema is not
in the installed SDK); Cloud Run domain mappings; load balancer serverless network
endpoint groups; the deploy-time invoker grant firebase-tools writes for `onCall`; the
etag and version form real policies return; whether real Cloud Run responses report
`trafficStatuses` as the fixtures assume. Each needs a separately authorized real
observation, and observers for the unresolved surfaces need a later slice.

**Remaining dependencies.** Independent certification of S5; observers for inherited
IAM and live routes (with owner-approved read permissions); a separately authorized
staging observation; S6 (expected-access and plan assembly, signing, registration,
freshness at enable, revocation); D12, D13; the S3 O6 pre-wiring gate; A3-7.

### S6a - Offline operator tooling core, emulator-only writers

Status: **certified and integrated on main (`abe0cb5`)**, on top of `99e480e`; not
deployed, never run against a real project. Independently certified on October 17, 2026
after remediation of findings F1 to F3, then integrated by the human owner (commit
`abe0cb5`, "Add certified A3-6 S6a operator tooling"). Status corrected in S6b at the
owner's direction (S6b-D4); this line previously read "awaiting independent
certification". Verified only
against synthetic fixtures (`SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED`) and the Firestore
emulator for a `demo-` project. Teacher Units remains closed: `teacherUnitsAvailable()`
returns `false`, production uses `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`, and the
production registry and revocation list are empty. No S1 to S5, A3-1 to A3-5, RAP,
publisher, Rules, index, Hosting, Functions source, build-profile, IAM, Storage, KMS or
infrastructure change. S6b to S6e are not implemented.

**Files.** `scripts/teacher-units-release/cli.cjs`, `freshness.cjs`, `statements.cjs`,
`registration.cjs`, `availability-cas.cjs`; tests `cli.test.cjs`, `freshness.test.cjs`,
`statements.test.cjs` (offline) and `registration.emulator.test.cjs`,
`availability-cas.emulator.test.cjs` (Firestore emulator); `fixtures/synthetic-release.cjs`;
`.github/workflows/platform-ci.yml`. CommonJS over the compiled A3 modules (canonical,
validation, bindings, signature, authority registry, revocation list, composite verifier)
and the S4/S5 exports, none modified. Not reachable from `index.ts`; not in the deployed
Functions payload.

**CLI (D14).** `node scripts/teacher-units-release/cli.cjs <command> --project <id>`.
- `--project` is required exactly once: `lyfelabz-prod`, `lyfelabz-staging` or a `demo-`
  emulator project. It is never inferred, and the Firebase alias file is never read
  (test-enforced by a file-read spy and a source scan). `GOOGLE_CLOUD_PROJECT`,
  `GCLOUD_PROJECT`, `CLOUDSDK_CORE_PROJECT` or `FIREBASE_CONFIG` disagreeing with it, any
  emulator variable for a cloud project, or a non-loopback `FIRESTORE_EMULATOR_HOST`
  refuses as ambiguous.
- Every output carries `approvalSystemId: lyfelabz-operator-cli` and a fresh
  `workflowRunId` (UUID v4) per invocation; prepared statements carry the same values and
  cannot override them.
- Commands, each separate: A offline validation (`validate plan`, `validate
  expected-access`, `validate chain`); C preparation (`statement prepare`, `statement
  assemble`, `activation-evidence prepare`); reporting (`history report`, offline over an
  export or read-only against an emulator); emulator-only writes (`register`, `policy
  initialize|prepare|enable|shutdown`). Class B (provider observation) is not exposed; no
  command makes a provider request.
- Mutating commands are dry runs by default. `--execute` requires the `--confirm <digest>`
  the dry run printed, and every mutating command refuses every cloud project, including
  staging and production, before any file, network or Firestore access.
- No key, signing, or KMS call exists in the tool. `statement prepare` writes the
  canonical statement bytes and the A3-1 signing bytes for a human signer; `statement
  assemble` wraps a separately produced signature and does not verify it. Output files
  are created exclusively and never overwritten.
- Authority inputs: production uses only the artifact-pinned (empty) registry and
  revocation list, and refuses caller-supplied ones; staging refuses (no pinned staging
  registry exists); an emulator project takes explicit registry and revocation files,
  which `createAuthorityRegistry` and `createRevocationList` bind to `demo-` identities.

**Freshness (D6).** `assertStatementFresh(kind, statement, now, stage)`: future `issuedAt`
refuses for every signed kind; deployment, activation and disposition approvals refuse
when more than 24 hours old at registration; the activation approval also at enable;
certification has no age limit. `assertObservationFresh` applies the five-minute window
to an S4-shaped observation; S6a has no provider observation of its own. Bounds are A1's
`MAX_PREPARE_AGE_MS` and `MAX_AGE_MS`.

**Registration (emulator only).** `prepareRegistration` computes the content address and
validates the release or evidence document with the A3-1 validators; for a signed kind it
requires statement bytes that are exactly the canonical statement at its recorded hash
(the local stand-in for statement-object retrieval, D9), a `verified` S1 signature against
the supplied branded registry, and D6 freshness; it refuses any pinned-revoked reference
or dependency. `register` accepts no prepared object (certification remediation F2): it takes the raw
inputs, refuses any other input key, a non-digest `--confirm` and a non-function clock,
snapshots the document (canonical JSON), the statement bytes (a copy) and the target
identity when called, and in every transaction attempt, including each SDK rerun,
rebuilds the whole preparation from those snapshots with that attempt's tooling clock
(remediation F1): content address and destination, statement bytes, signature, D6
freshness, revocation, dependencies and the confirmation digest, which must equal
`--confirm`. Caller mutation after the call cannot reach the write, and a dry-run
verdict is never reused. In each attempt every dependency must already be
registered and bind (release to its deployment approval, certification to its release,
activation approval to its release and certification, activation evidence to its
approval, disposition to its target and replacement through
`validateDispositionBinding`); then the target is read; an identical existing document is
a validated duplicate (`validateImmutableDuplicate`), anything else refuses; otherwise
`create`. Disposition targets are not revocation-checked, because a disposition records a
decision about a reference that may already be pinned.

**Availability CAS (D8, emulator only).** `planTransition` builds the next policy with an
explicit SDK `Timestamp` from the tooling clock, the history document over the certified
S2 contract and `validateAvailabilityHistoryBinding`, its content address, and a
confirmation digest over the intent (identity, transition, previous policy digest, next
policy without `updatedAt`, evidence references, operator subject, reason).
`executeTransition` runs one transaction: read the policy (an invalid stored policy
refuses; repair stays separate), re-plan, compare the confirmation digest (so a changed
previous policy refuses), at enable verify the registered chain through the certified S3
core `verifyReleaseAuthorityChain` and D6 activation-approval freshness, read the history
address (an existing document refuses, identical or not), then `set` the policy and
`create` the history. Refusals propagate unchanged and are never retried; only the
installed SDK's own reruns of retryable errors apply, and each rerun re-reads and re-plans.
History is never read by the runtime verifier. `readHistory` and `reportHistoryRecords`
report repeated generations with `authorization: "none: rollback evidence only"` and never
block a transition; any invalid stored record refuses the whole report.

**Emulator-only enforcement.** Three independent layers: the CLI refuses cloud projects
for mutating commands before I/O; the writers themselves (`assertEmulatorWriteTarget`)
require a `demo-` emulator identity, a loopback `FIRESTORE_EMULATOR_HOST` and agreeing
ambient project variables; and `assertDatabase` requires the Firestore client to be bound
to the target project and routed to a loopback emulator (installed
`@google-cloud/firestore` 7.11.6 settings `ssl: false`, loopback `servicePath`, integer
`port`; a cloud-routed client has none, and a different private shape fails closed).

**Interpretations recorded for certification review.**
1. The confirmation digest does not bind `updatedAt`, which is taken from the tooling
   clock inside the transaction; it binds the previous policy digest and every other next
   policy field. A rerun with the same clock after a competing commit is refused by the S2
   binding as a no-op; with a later clock, by the digest.
2. `enable` history records the release and activation evidence references (the evidence
   names its approval and certification); `prepare` records the release when one is set;
   `shutdown` records the previous activation evidence.
3. Registration verifies signatures and dependency order in addition to D6 freshness.
4. Emulator `enable` has no provider observation: D6 3 (fresh observation equal to the
   manifest) applies to cloud enable, which is S6c and not implemented.
5. `operatorSubject` is a recorded, unverified label.
6. Superseded approvals and certifications remain valid unless pinned (S3 O4, D5 R2).
   This is a **documented limitation, not a satisfied refusal** (remediation F3): a
   registered supersede (or revoke) disposition is a signed audit record only and
   blocks nothing in S6a, at registration or at enable. The approved contract makes the
   pinned revocation list, shipped by an artifact-changing redeploy, the only blocking
   mechanism; R1 deterministic lookup and R3 query by target were not adopted, and a
   tooling-side disposition lookup would need its own Decision 4 amendment. Registering a
   disposition prints `effect: "audit record only: not a revocation; ..."`, and a
   verified enable reports `dispositions: "not consulted: ..."`. A test registers a
   supersede disposition with its replacement chain, shows enable and dependent
   registration refuse once the target is pinned, and shows the superseded approval
   still enables while unpinned. **Required future gate:** the R2 revocation and
   supersede procedure (S6d, separately authorized: pin, artifact-changing redeploy of all
   nine endpoints, observer confirmation, old-revision deletion). Superseded-evidence
   refusal is not satisfied until that gate exists.

**Certification remediation (Sol FAIL: F1, F2, F3).** Within the same 13 files; no S1
to S5 change. F1 and F2 as described under Registration; F3 as interpretation 6. New
emulator tests: F1 boundary crossing on an SDK rerun (the installed SDK's own retry loop,
driven by a retryable `ABORTED` code 10 after the first attempt: an activation approval
fresh at 24 h - 1 ms refuses at 24 h + 1 ms on the rerun, a clock moving before
`issuedAt` refuses as future, certification still creates at 400 days, the clock is read
once per attempt); F1 expired dry-run verdict; F2 forged prepared object and arbitrary
destination keys; F2 modified bytes or document under an old confirmation, cross-project
inputs, non-digest confirmations; F2 caller mutation during an attempt (document, bytes
and identity tampered inside the clock callback: the original is written); F3 above. The
real-contention rerun of registration is not separately reproduced; the injected
`ABORTED` exercises the same SDK retry path. Remediation mutants (scratch, in place,
restored): 15, all killed; 13 behaviorally. Two are killed only by a refusal message and
are layered guards: the confirm digest-format check (the confirmation equality refuses
underneath) and the writer emulator-target guard (pre-existing; `assertDatabase` refuses
underneath).

**Verification.** Offline: 32 tests (`cli` 15, `freshness` 9, `statements` 8). Emulator:
31 tests (`registration` 17, `availability-cas` 14) after remediation, including concurrent identical
registrations (one create, five validated duplicates), concurrent CAS (exactly one commit,
SDK reruns observed under contention, a refusal never retried), stale and mismatched
confirmations, conflicting and identical existing history, invalid stored policy, invalid
transitions, tampered history through the S2 binding, D1-B rollback reported as a
repeated generation, revoked, superseded, unrecognized, zero-signed and wrong-generation
chains refusing enable, cloud targets and cloud-routed clients refused by the writers, and
CLI dry-run then execute flows. Behavioral mutation (scratch copy; each mutant must make a
suite fail): 49 mutants, 47 killed. Two survivors are equivalent by construction: the
statement-bytes equality check (implied by the hash check plus the A3-1 rule that the
statement object hash is the canonical statement digest) and an approval-system override
(the authority key-set check already refuses the key). Layered guards killed only by a
refusal message or the static write scan, and therefore defense in depth rather than sole
protection: the CLI cloud-mutation guard (the writer guards refuse underneath; removing
both is killed behaviorally), `--execute`/`--confirm` pairing (the writer requires the
digest), the explicit invalid-policy refusal (the planner's validation refuses), the
history-existence read and `create` for history (removing both is killed behaviorally),
and `create` for registration (the transactional read and duplicate check precede it).

**Unresolved and remaining.** Statement-object and report retrieval from Storage (D9
buckets do not exist); release and plan assembly (S6b); live read-only observation (S6c);
revocation and supersede preparation (S6d); any staging or production write, signing,
registration or transition (S6e, separately authorized); D12, D13; the S3 O6 pre-wiring
gate; gates G1 to G5; A3-7. The CI emulator step has not yet run in GitHub Actions.

### S6b - Offline release evidence assembly (non-authorizing)

Status: **certified and integrated on main (`b7a629d`)**, on top of `4273ab5` (S6a
integrated at `abe0cb5`); not deployed, never run against a real project. Independently
certified on October 17, 2026, then integrated by the human owner (commit `b7a629d`, "Add
certified A3-6 S6b release evidence assembly"). Status corrected in S6c at the owner's
direction (S6c-D3); this line previously read "uncommitted ... awaiting independent
certification". Verified only against synthetic fixtures (`SYNTHETIC FIXTURE - NOT
PROVIDER-VERIFIED`). Teacher Units remains closed: `teacherUnitsAvailable()` returns
`false`, production uses `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`, and the production
registry and revocation list are empty. No S1 to S5, A3-1 to A3-5, RAP, publisher, Rules,
index, Hosting, Functions source, build-profile, IAM, Storage, KMS or infrastructure
change; the only S6a change is additive CLI commands (S6b-D3). S6c to S6e are not
implemented.

**Owner decisions (S6b reconnaissance).** Recorded at the human owner's direction; no
separate signed approval artifact exists.

- **S6b-D1.** The S4 and S5 checks run at a recorded historical `evaluatedAt`, defaulting
  to the S5 review end. Freshness is evaluated separately at `assembledAt`. A historical
  observation is never described as currently activation-valid.
- **S6b-D2.** A structurally valid package may be assembled when signature, revocation or
  freshness checks fail, are absent or are unverifiable. Each such condition is recorded;
  a failed or unknown authority check is never recorded as passed.
- **S6b-D3.** Strictly additive changes to the certified S6a `cli.cjs` and its tests.
- **S6b-D4.** The stale S5 and S6a status lines above are corrected.

**Files.** `scripts/teacher-units-release/evidence-package.cjs`,
`evidence-package.test.cjs`, `fixtures/synthetic-package.cjs`; additive changes to
`cli.cjs` and `cli.test.cjs`; `.github/workflows/platform-ci.yml` (one offline step);
this record. CommonJS over the compiled A3 modules (canonical, validation, bindings,
signature, authority registry, revocation list) and the S4, S5 and S6a exports, none
modified. Not reachable from `index.ts`; not in the deployed Functions payload.

**Release assembly (`assembleRelease`, pure).** Inputs: the S4 plan (object and bytes),
the S5 expected access (object and bytes), the signed deployment approval with its exact
statement bytes, the S4 observation and the S5 receipt (object and bytes). Every input is
read once through canonical serialization (accessors and non-plain values refuse), and an
unknown input key or a missing input refuses; no observation is ever inferred. Checks, in
order: explicit `lyfelabz-prod` or `lyfelabz-staging` identity (project, environment,
number, region); approval statement bytes canonical at the statement object hash and equal
to the document statement; approval `candidate.deploymentPlan` exactly the plan content
object, and its three fingerprints equal to the plan candidate; expected-access runtime
service account and ingress equal to the plan for all nine endpoints (the binding S5 leaves
to S6); S4 `compareObservationToPlan` and S5 `composeEndpoints` (which re-applies
`assertAccessReview`, including the observation fingerprint, plan hash and expected-access
hash bindings) at `evaluatedAt`; nine sorted endpoints; plan, expected and observed service
accounts agreeing. The manifest takes `sourceSha`, `sourceTree`, the fingerprints, the
deployment mode, the enforcement and contract versions from the approval candidate, the
endpoints from S5 composition, and the Rules and index hashes from the observation; the
deployment approval reference is its content address. `validateBackendRelease`,
`validateDeploymentBinding` and `validateReleaseReference` must pass. Output: the release
document, its canonical bytes, its `releaseId` and
`authorization: "none: candidate backend release document; ..."`.

**Package `lyfelabz.teacherUnitsA3EvidencePackage` v1.** Canonical JSON with fixed
literals that the schema admits in no other form: `authorization` ("none: candidate
evidence package; not an approval, certification, registration or activation"),
`providerVerified: false`, `accessReviewLevel: "A-structural"`, `releaseAuthorized: false`,
`activationReady: false`. It records identity; `evidenceClass` (`synthetic` when the S5
receipt declares `synthetic-fixture`, otherwise `operator-supplied-unverified`; never
provider-verified, and the declared provenance is carried with the note that a declaration
is not proof); `evaluatedAt` and `assembledAt`; the authority source and the SHA-256 of any
synthetic registry and revocation input; the release reference; each component's role,
kind, content address and supplied-byte SHA-256 (plan, expected access, observation and its
A1 fingerprint, receipt, deployment approval and statement bytes, release, and when
supplied the certification, certification report, activation approval and activation
evidence); an ordered check list (`passed`, `synthetic-passed`, `failed`, `absent`,
`unverifiable`, `not-observed`, `deferred`); and a fixed list of unresolved gates (D9, D12,
D13, G1 to G5, O6, S6c, S6d, S6e, A3-7).

- Optional components refuse on any binding or hash failure: the certification must bind
  this release, placement, enforcement and contract version; supplied report bytes must
  hash to `certificationReport.sha256` (absent bytes are recorded `absent`, never passed);
  an activation approval requires the certification it names and must pass
  `validateCertificationBinding`; activation evidence requires its approval and must equal
  what S6a `prepareActivationEvidence` rebuilds. `validateActivationBinding` and the S3
  chain need an enabled policy and are recorded `deferred` (S6a enable, S6c).
- **Authority.** Production uses only the pinned registry and revocation list and refuses
  caller-supplied authority, so every production signature is recorded `failed`
  (`authorityUnrecognized`). Staging has no pinned registry: signature and revocation
  checks are `unverifiable`. Explicit synthetic test authority is accepted only for staging
  and only for synthetic evidence; its results are `synthetic-passed`, never `passed`.
  Interpretation for review: the instruction to permit explicit registry inputs for `demo`
  is met this way because S4 and S5 accept only cloud identities, so no `demo-` package can
  exist; the S6b commands are therefore cloud-project only.
- **Freshness.** `observation.freshness.historical` records that the S4 and S5 windows were
  satisfied at `evaluatedAt`. `observation.freshness.current` applies the five-minute window
  at `assembledAt`; even when it passes, its detail states that enable still requires a fresh
  S6c observation. Approval and certification freshness use S6a `assertStatementFresh` at
  `assembledAt` (24 hours for approvals, no limit for certification, future refused) and
  are recorded. An observation, receipt or `evaluatedAt` later than `assembledAt` refuses.
- **D12 and D13.** `buildRecord.deployed` is always `not-observed`: S4 does not read the
  deployed `a3-runtime-build.json`, and `sourceSha` and `sourceTree` come from the approval
  candidate, not from the deployed artifact. `hostingCandidate` is always `deferred`. The
  synthetic source SHA, tree, Hosting fingerprint and report exist only in
  `fixtures/synthetic-package.cjs`.

**Verification (`verifyEvidencePackage`).** Checks canonical bytes and the fixed schema
(unknown keys, literals, statuses and the unresolved list), refuses a supplied `assembledAt`
or `evaluatedAt` and any project other than the package's, then re-derives the whole package
from the supplied evidence at the package's own instants and requires byte-exact equality.
No recorded check, status, class or literal is trusted: a resealed package with an edited
status, class, authority source, component hash or release ID refuses, as does verification
with different authority inputs or evidence.

**CLI (S6b-D3).** `release assemble`, `package assemble` and `package verify`, each offline
and read-only, cloud projects only, using the existing explicit `--project`, target
resolution, strict readers and exclusive output files. None accepts `--execute` or
`--confirm`. Signed components take a document and its statement bytes together; the
registry and revocation files go together; `package verify` takes no `--evaluated-at`.
`package assemble` uses the tooling clock as `assembledAt`. Existing S6a commands are
unchanged.

**Verification.** Offline: `evidence-package.test.cjs` 26 tests; `cli.test.cjs` 18 (15
existing plus 3 S6b). The matrix covers cross-project and cross-environment components,
swapped and noncanonical plan and expected-access bytes, altered certification report
bytes, noncanonical and substituted statement bytes, wrong release IDs, mismatched service
accounts, eight, extra and reordered endpoints, tampered observation and resealed receipt
fingerprints, stale, future and malformed instants, forged readiness, level, class and
check claims (resealed), declared `provider-get` provenance over synthetic data, revoked,
unknown, wrong-action and zero signatures, missing and mismatched certification
dependencies, missing evidence, unknown keys and accessor inputs, network-free execution
(trapped `fetch`, `http` and `https`), a static scan, and exclusive CLI output. Behavioral
mutation (scratch backup, in place, restored and hash-checked): 43 mutants. 22 are killed
behaviorally (an unsafe input becomes accepted or a recorded status changes, and a test
fails). 13 are killed only by a refusal message: each guard is layered, and another layer
still refuses (S5 refuses a service-account or plan mismatch; S5 re-runs the S4 plan
comparison; re-derivation refuses forged literals and unresolved lists; identity and input
checks refuse under the verify-project and unknown-package-input guards; the CLI pairing
guards fall through to required-flag refusals; the activation-needs-certification guard
falls through to a non-REFUSED TypeError, which still fails closed). 8 survive and are
redundant by construction or by a certified layer: expected-versus-plan ingress and the two
composed-endpoint checks (S4 plus S5 imply them transitively), `validateDeploymentBinding`
(the manifest is built from the candidate), statement equality (the A3-1 statement digest
check plus the hash check imply it), the signed-identity check (the A3-1 validators bind
identity), and the future-versus-`assembledAt` and `evaluatedAt`-order guards, which imply
each other (removing both together is killed behaviorally). The certification-only release
and placement guards were initially a coverage gap (killed only by a message or surviving);
a permanent certification-only test now kills both behaviorally.

**Unresolved and remaining.** Everything in the package's unresolved list: D9 storage
retrieval, D12 deployed build record, D13 Hosting candidate, G1 to G5, the O6 pre-wiring
gate, S6c live observation and fresh enable observation, S6d revocation and supersede,
S6e any staging or production signing, registration or transition, and A3-7. The new CI step
has not yet run in GitHub Actions. `TEACHER_UNITS.md` still describes S4 as awaiting
recertification and S5 and S6 as deferred; it is outside the S6b file inventory and is
unchanged.

### S6c - Read-only provider observation (capture and replay, non-authorizing)

Status: **certified and integrated on main (`5e8f147`)**, on top of `b7a629d` (S6b
integrated); not deployed, never run against a real project, and no live capture has been
performed. Independently certified after the three certification corrections below, then
integrated by the human owner (commit `5e8f147`, "Add certified A3-6 S6c provider
observation tooling"). Status corrected in S6d at the owner's direction (S6d-D4); this line
previously read "uncommitted ... Awaiting independent certification". Verified only against injected synthetic exchanges
(`SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED`). Teacher Units remains closed:
`teacherUnitsAvailable()` returns `false`, production uses
`UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`, and the production registry and revocation list
are empty. No S1 to S6b implementation, A3-1 to A3-5, RAP, publisher, Rules, index, Hosting,
Functions source or entry point, build-profile, IAM, Storage, KMS or infrastructure change;
the only S6a/S6b change is additive CLI commands (S6b-D3 precedent).

**Owner decisions (S6c authorization).** Recorded at the human owner's direction; no
separate signed approval artifact exists.

- **S6c-D1.** GET-only. Resource Manager `getIamPolicy` (a POST) is not implemented;
  inherited project, folder and organization IAM are recorded `not-observed`. Neither G3
  nor a level B access review is claimed.
- **S6c-D2.** Read-only observation of deployed Hosting releases and rewrites, Cloud Run
  domain mappings, serverless NEGs and their backend services, and the deployed A3 runtime
  build record. A 403, 404, disabled API, incomplete listing or ambiguous response is never
  read as absence.
- **S6c-D3.** The stale S6b status line above and the stale S4 to S6 status in
  `TEACHER_UNITS.md` are corrected.
- **S6c-D4.** The capture architecture is implemented and tested offline only; no live
  provider capture is authorized in this slice.

**Files.** `scripts/teacher-units-release/provider-capture.cjs`, `surface-observation.cjs`,
`provider-capture.test.cjs`, `surface-observation.test.cjs`, `fixtures/synthetic-capture.cjs`;
additive changes to `cli.cjs` and `cli.test.cjs`; `.github/workflows/platform-ci.yml` (one
offline step); this record; `TEACHER_UNITS.md`. CommonJS over the compiled A3 modules
(canonical, runtime artifact) and the S4 and S5 exports and A1 helpers, none modified. Not
reachable from `index.ts`; not in the deployed Functions payload.

**Capture (`captureA3Provider`).** One recording transport and one clock serve the certified
S4 `observeA3Backend`, the certified S5 `reviewA3Access` and the S6c surface observer, in
that order. The plan and expected access are hash-checked (S4 `readPlan`, S5
`readExpectedAccess`) before any request. Every request must be `https` to an allowlisted
Google API host (Firebase, Firestore, Cloud Functions, Cloud Run and its `us-central1`
regional host, Storage, Firebase Rules, Firebase Hosting, Compute) with no credentials, port
or fragment in the URL and no custom method other than `getIamPolicy`. The transport records,
for each read in order: the exact URL, method `GET`, mode (`json`, `binary`, `probe`), HTTP
status, the response bytes (Base64) and their SHA-256, and request and completion times; and
every clock reading S4, S5 and S6c take. One monotonic clock enforces the A1 five-minute
window from the capture start across the whole capture, before and after each read and at
completion; a backwards or malformed reading refuses. For S4 and S5 a non-2xx response
refuses (their certified contract); for S6c surfaces it is recorded. A failed exchange
refuses the capture; nothing falls back to fixture data. Nothing is written by the module.

**Transcript `lyfelabz.teacherUnitsA3ProviderTranscript` v1.** Canonical JSON holding fixed
`authority` and `attestation` literals, `evidenceClass`, explicit identity (environment,
project, number, region), the principal, the deployment plan and expected-access SHA-256,
the window, and the events. Credentials, the Authorization header and tokens are never
recorded (test-enforced, including the Base64 form).

**Provenance.** `synthetic` (injected fixtures; S5 provenance `synthetic-fixture`) or
`operator-captured-unattested` (the CLI live path; S5 provenance `provider-get`). Neither
establishes provider origin: replay proves consistency with the captured bytes only, and TLS
origin cannot be proven after the fact. The principal is `not-recorded` or
`operator-declared-unverified` (a `--principal` email), never verified and never
authorization. A consistent relabel of synthetic bytes as unattested reaches only
`operator-captured-unattested`, which S6b classes `operator-supplied-unverified`.

**Bundle `lyfelabz.teacherUnitsA3ProviderCapture` v1** (`capture.json`) binds the SHA-256
of `transcript.json`, `observation.json`, `receipt.json` and `surface-report.json`, the S4
observation fingerprint, the window, read counts and surface statuses, with fixed literals
`providerVerified: false`, `releaseAuthorized: false`, `activationReady: false`,
`accessReviewLevel: "A-structural"`, `levelB: "not-claimed"`, the G3-open statement, the
historical freshness statement, and the unresolved list (D9, D12, D13, G1 to G5, O6, S6d,
S6e, A3-7, inherited IAM).

**Verification (`verifyCapture`, offline).** Strict transcript schema (exact keys, `GET`
only, allowlisted URLs, canonical Base64, canonical bytes), identity and plan bindings, then
a replay transport feeds the recorded responses and clock readings, in order, into the same
unchanged S4, S5 and S6c code. Each replayed request must match the next event's URL, method
and mode; each body must match its hash; a missing, extra or reordered event refuses. Every
file must equal the re-derived bytes exactly, so no recorded label, status, hash, timestamp
or literal is trusted. Verification is historical: it applies no current freshness and is
never a fresh observation for enable (D6 fix 1). The S5 local Hosting check is re-run against
the current repository file, so a changed local Hosting file refuses replay.

**Surfaces (`surface-observation.cjs`).** Statuses: `observed-absent`, `observed-present`,
`incomplete`, `unreadable`, `not-observed`, `inconsistent`. Listings follow pagination with a
bounded page count; a repeated token, an unreachable location or scope, an unexpected
warning, an unknown field where meaning matters, or a malformed entry is `incomplete`; any
non-200 is `unreadable`.
- Hosting: every site listed for the project (expected sites recorded from
  `DOMAIN_AND_HOSTING_CONTRACT.md`; the alias file is never read), every channel including
  preview channels, `FINALIZED` versions only. Any rewrite to `function` or `run` is
  `observed-present` and blocking, as S5 already refuses locally.
- Cloud Run domain mappings (`us-central1` v1 API): a mapping whose `routeName` is a Teacher
  Units service is present and blocking.
- Serverless NEGs and backend services (Compute aggregated lists): a NEG naming a Teacher
  Units Cloud Run service or function, or using a URL mask or serverless deployment that can
  route to it, is present and blocking, as is any backend service using such a NEG.
- Build record: from the generation-pinned archive bytes S4 already captured. The bytes must
  hash to the observed archive hash, the archive's artifact fingerprint must equal the
  observation, the record bytes must equal the archive inventory hash, be canonical,
  pass the A3 runtime build schema and match the observed payload and placement
  fingerprints. The actual `deploymentMode` is recorded; `policyControlled` is `true` only for
  an observed `policy-controlled` record, which is blocking because D12 is deferred. Uncaptured
  archive bytes are `not-observed`.
- Inherited IAM: always `not-observed` (S6c-D1).

Findings are recorded in `blocking`; they do not refuse the capture, so the evidence of an
exposure is kept. A surface report is never an access review and never resolves G3.

**CLI (additive).** `observe plan` (offline; lists the GET surfaces and expected read
permissions [U]; reads no credentials). `observe capture --live` (cloud projects only;
refuses without `--live`; no `--execute` or `--confirm`; an existing `--out` refuses before
any request or credential; the token is obtained through A1 `tokenFromGcloud` only after
every local check; writes the five files exclusively into a new directory; class
`operator-captured-unattested`). `observe verify` (offline replay). Existing commands are
unchanged.

**Verification.** Offline: `provider-capture.test.cjs` 18, `surface-observation.test.cjs`
10, `cli.test.cjs` 23 (18 existing plus 5 S6c). Behavioral mutation (in place with
hash-checked restore; 53 mutants over the three S6c-touched modules): 50 behavioral kills,
2 message-only (layered: the plan and expected-access binding, refused underneath by the
re-derived receipt; the capture class set, refused underneath by S5's provenance check),
1 equivalent survivor (the record-bytes hash check: the bytes come from the same archive
whose inventory produced the hash). Two initial survivors (repeated pagination token, archive
artifact fingerprint) gained permanent behavioral tests.

**Certification correction (Sol FAIL: F1, F2, F3).** Within the same 10 files; no S1 to
S6b, A3-1 to A3-5, Rules, index or configuration change. Each finding was reproduced before
the fix (offline): F1, `{}` and `{unexpected: 1}` as HTTP 200 for Hosting sites, domain
mappings and Compute each gave `observed-absent`; F2, a Teacher Units domain mapping on page
one followed by HTTP 403 on page two gave `unreadable` with an empty `blocking` list; F3, a
missing local Hosting configuration was refused only after 95 provider reads.

- **F1 - strict successful shapes.** Every listing page must be a plain object whose keys are
  all documented for that listing (an undocumented key is `incomplete`) and must carry its
  collection explicitly as a list (Hosting `sites` and `channels`, domain mapping `items`,
  the Compute aggregated `items` map); an omitted or malformed collection is `incomplete`,
  never empty. Interpretation for review: because proto3 JSON omits empty repeated fields, a
  genuinely empty listing that omits its collection is recorded `incomplete` (fail closed).
  A pagination token must be a nonempty string; any other value is `incomplete`. A channel
  must carry a release with a version and config; a version that is not `FINALIZED`, an
  unexpected domain mapping list `kind`, a malformed aggregated scope, and every malformed
  entry are `incomplete`. Optional repeated fields inside a validated resource (version
  `rewrites`, backend service `backends`, `unreachable(s)`) may be omitted but must be lists
  when present. `observed-absent` is reached only when every page was valid and pagination
  ended. An incomplete sites listing records `missingExpectedSites: null`.
- **F2 - findings survive failures.** Listings now return every entry already observed with
  their status: a later failed, malformed or repeated page, and a malformed sibling entry
  (each entry is normalized on its own), no longer discard earlier entries. Sites from a
  partial listing are still inspected; a malformed rewrite no longer discards the other
  rewrites of its version; NEG findings are kept when the backend-service listing fails.
  Each surface reports coverage in `status` (the worst listing status) and what was seen in
  `exposure` (`observed-present`, `none-observed-in-partial-coverage`, `none`); a finding stays
  in `findings` and `blocking` whatever the coverage. Replay re-derives the same findings and
  the bundle's blocking count.
- **F3 - local preflight.** `checkCaptureInputs` now also runs the certified S5
  `checkLocalHosting` for the environment's Hosting file (unchanged; S5 still re-checks it
  during the review). The capture runs it before starting the transport, and the CLI runs it
  with the same Hosting root before obtaining a credential. Target, evidence class,
  principal, plan and expected access were already checked there.

Correction tests: `provider-capture.test.cjs` 19 (+1), `surface-observation.test.cjs` 15
(+5), `cli.test.cjs` 24 (+1). They cover HTTP 200 with missing or malformed collections,
channels, releases, rewrites, mappings, scopes and resources; missing and invalid
pagination; valid complete empty listings; a dangerous mapping before a 403, a malformed
page or a repeated token; a dangerous rewrite before malformed pagination, malformed
siblings and a failed later sites page; a dangerous NEG before an unreadable or malformed
backend-service listing; replay and bundle verification keeping the blocking finding; and
missing, unreadable (a directory) and malformed Hosting configuration, invalid plan,
expected access, target, class and principal, each with zero clock readings, zero provider
reads and, through the CLI, zero credential retrievals, followed by an honest capture and
replay. Targeted behavioral mutation: 19 mutants (F1 9, F2 6 plus the version status, F3
3), all killed behaviorally. The original 53-mutant set, re-anchored where code moved: 51
behavioral, 1 message-only (plan and expected-access binding, refused underneath by the
re-derived receipt), 1 equivalent (record-bytes hash); the capture class set is now killed
behaviorally.

**Second certification correction (Sol FAIL: F1-A to F1-C, F2-A to F2-C).** Within
`surface-observation.cjs` and its tests; F3 and the first F1 and F2 corrections are unchanged.
Reproduced first on the unchanged bytes: a NEG with `cloudRun.service: 42`, a NEG with
`cloudRun: {}` and a Compute list with the wrong `kind` each gave `observed-absent`; a
dangerous domain mapping beside malformed `unreachable`, a dangerous NEG beside malformed
`unreachables` and a dangerous rewrite in a release without `name` each gave `incomplete`
with no blocking finding.

Root causes (shared, not per case): (1) collection metadata was validated inside the
collection extractor, so a metadata error threw and discarded every entry on the page
(F2-A, F2-B); (2) entry normalizers were all-or-nothing, so missing nonessential metadata
discarded an already-established target (F2-C); (3) nested targets were tested only for a
match, so a malformed or empty target was silently not dangerous and therefore absent
(F1-A, F1-B); (4) list `kind` was admitted but never compared (F1-C).

Invariant correction. The listing layer now separates (1) identity and target, (2)
completeness and metadata, and (3) confirmed exposure. Page metadata (`kind`, unreachable
locations, warnings, list metadata, undocumented fields) is validated apart from the
collection and recorded as an issue; it never removes entries. Each entry is normalized on
its own; its nonessential metadata (names, selfLinks, release and version names, release
type, version status, entry `kind`) is recorded as an issue and returned as `null`, never
fatal. An entry is dropped only when its target cannot be established (no release, version
or config; no valid domain mapping route; a malformed entry object). Serverless NEG targets
(`cloudRun`, `cloudFunction`, `appEngine`, `serverlessDeployment`) must be plain objects
with documented fields, each a nonempty string, naming a resource or a URL mask; a
malformed, empty or undocumented target is an issue and never an invented exposure. A NEG
carrying a target is evaluated even when its endpoint type is missing or inconsistent (an
issue), and a dangerous NEG without a selfLink stays blocking (it cannot be linked to a
backend service). Backend-service backends are read one by one. Compute list `kind` must be
`compute#networkEndpointGroupAggregatedList` or `compute#backendServiceAggregatedList`, and
the domain mapping list `DomainMappingList`; an absent kind is an issue. Findings are
computed from every established target whatever the coverage, and `observed-absent` still
requires no issue at all. The omitted-collection fail-closed rule is unchanged.

Tests: `surface-observation.test.cjs` 25 (+10): the six exact cases; a matrix over Hosting,
domain mappings, NEGs and backend services combining a valid dangerous entry with each of a
malformed sibling, malformed collection metadata, a wrong list kind, missing entry metadata,
a failed subsequent page, a malformed nested target, a valid but incomplete response and a
malformed pagination token, asserting both partial coverage and the retained finding in the
surface and in `blocking`; negative controls (malformed targets never become exposures,
undocumented target fields are incomplete, ordinary valid resources and explicit empty
listings stay `observed-absent`); a NEG missing selfLink or endpoint type; a listing with
the right kind but no collection; and a full capture plus offline replay keeping four
findings under metadata failures. Two existing tests had fixture data that the stricter rules
now correctly reject (a domain mapping page without `kind`; a `serverlessDeployment` target
naming no resource); their data was corrected, not their assertions.

Targeted behavioral mutation of the invariants (in place, hash-checked restore): 23 mutants,
21 behavioral kills, 0 message-only, 2 equivalent as layers, 0 surviving defects. The two
layered mutants are separating metadata from the collection and making metadata lists
non-fatal: each alone is caught by the other layer (no output changes), and the two removed
together reintroduce F2-A and F2-B and are killed behaviorally. Earlier mutants whose anchors
moved were re-anchored to the new code: 8 more, all behavioral (one, the required aggregated
items map, first survived because the kind check masked it, and gained a permanent test).
The rest of the original set and the first correction set are unchanged in result.

**Third certification correction (whitespace-only targets).** Reproduced first:
`cloudRun: {service: " "}` gave `observed-absent`, and `cloudRun: {urlMask: " "}` gave a
fabricated Teacher Units exposure, both reproduced identically by replay. Root cause: target
strings were checked for type and nonzero length only. Correction in `surface-observation.cjs`:
one `nonblank` rule (a string whose trimmed length is positive) now governs every NEG target
field (`cloudRun`, `cloudFunction`, `appEngine`, `serverlessDeployment`) and the `text`
helper used for target identity (Hosting `run.serviceId` and `function`, domain mapping
`routeName`, rewrite patterns, site names). A blank or wrong-typed value is an issue, never
converted, never a target; valid strings are kept exactly. Nonessential metadata rules are
unchanged. Tests: `surface-observation.test.cjs` 27 (+2), covering space, tab, newline,
mixed whitespace, empty, numeric, null, array and object values for service, URL mask,
function and deployment resource, blank Hosting run targets and domain mapping routes,
valid dangerous and harmless controls, a dangerous NEG beside a blank-target sibling, and
both original reproductions through full capture and offline replay. Targeted mutation: 3
mutants (trim removed everywhere, from NEG targets only, from `text` only), all killed
behaviorally.

**Unresolved [U].** Every provider shape for Hosting v1beta1 channels, Cloud Run v1 domain
mappings and Compute aggregated lists is as documented, not observed; a live difference is
recorded `incomplete`. Read permissions in `observe plan` are expected, not verified.
Inherited IAM, organization policy and network reachability are not observed. G1 to G5 stay
open. A live capture needs separate authorization and an operator credential.

### S6d - Offline revocation and supersede preparation (non-authorizing)

Status: **certified and integrated on main (`38d068f`)**, on top of `5e8f147` (S6c
integrated); not deployed, never run against a real project. Independently certified after
the P2 certification correction below, then integrated by the human owner (commit
`38d068f`, "Add certified A3-6 S6d revocation tooling"). Status corrected in O6 at the
owner's direction; this line previously read "uncommitted ... Awaiting independent
certification".
Verified only against synthetic fixtures (`SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED`).
Teacher Units remains closed: `teacherUnitsAvailable()` returns `false`, production uses
`UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`, and the production registry and revocation list
are empty. No S1 to S6c implementation, A3-1 to A3-5, RAP, publisher, revocation-list or
registry source, Rules, index, Hosting, Functions source or entry point, build-profile, IAM,
Storage, KMS or infrastructure change; the only S6a to S6c change is additive CLI commands
(S6b-D3 precedent). Nothing was pinned, signed, registered, shut down, redeployed or deleted.

**Owner decisions (S6d authorization).** Recorded at the human owner's direction; no
separate signed approval artifact exists.

- **S6d-D1.** A supersede disposition alone has no runtime revocation effect. An R2 plan for
  a supersede proposes pinning the target approval or certification, exactly as for a
  revoke. Preparing a plan never pins or revokes anything.
- **S6d-D2.** No staging authority is provisioned. Staging supports synthetic validation and
  explicit unverifiable status only; a signature is never reported verified when the
  required authority is unavailable.
- **S6d-D3.** Registry key removal is deferred entirely.
- **S6d-D4.** The stale S6c status lines (above and in `TEACHER_UNITS.md`) are corrected.
- **S6d-D5.** A non-authorizing offline rollout comparison is included. It never reports
  revocation complete, release authorized or activation ready.

**Files.** `scripts/teacher-units-release/revocation-procedure.cjs`,
`revocation-procedure.test.cjs`, `fixtures/synthetic-revocation.cjs`; additive changes to
`cli.cjs` and `cli.test.cjs`; `.github/workflows/platform-ci.yml` (one offline step); this
record; `TEACHER_UNITS.md`. CommonJS over the compiled A3 modules (canonical, validation,
bindings, signature, authority registry, revocation list) and the S4, S6a and S6c exports,
none modified. Not reachable from `index.ts`; not in the deployed Functions payload.

**Plan (`prepareRevocationPlan`, pure).** Inputs: the explicit project; the signed
disposition with its exact statement bytes; the target document; the replacement document
(supersede only, refused for revoke); every known disposition as an explicit list (it may
be empty); the revoked backend release documents (at least one); synthetic test authority
(staging only); and the tooling clock as `preparedAt`. Checks, all refusing: identity of
every document; canonical statement bytes at the statement object hash and equal to the
document statement; target and replacement documents at the disposition's references and of
a disposable kind; `validateDispositionBinding` (same kind, same identity, revoke has no
replacement); D6 freshness at `preparedAt` (24 hours, future refused); the S1 signature
against the pinned registry, or synthetic authority for staging; no other known disposition
for the same target, no known revoke of the replacement, no known duplicate and no
supersession cycle across the known set and the new disposition; neither target nor
replacement already pinned in the base list (a no-op cannot change the artifact, R2
requirement 1); the proposed next list (base entries plus the target, sorted) passes
`createRevocationList` and has a different digest; each release is bound to the target and
none is listed twice. Binding (P2 correction): a certification or activation approval target
signs `backendReleaseId`, the content address of the whole manifest, so the release must be
exactly that manifest; a deployment approval target signs only its candidate, so the release
must pass the canonical `validateDeploymentBinding` (approval reference, identity,
`sourceSha`, `sourceTree`, runtime payload, Functions artifact and placement fingerprints,
enforcement version, deployment mode, client contract). Each plan release records which
binding applies (`binding`, a fixed value).

**Authority (S6d-D2).** Production uses only the pinned registry and the compiled
`PRODUCTION_REVOCATION_LIST` and refuses caller-supplied authority. Because the pinned
registry is empty (unconfigured), a production signature is recorded `unverifiable` and the
plan class is `unverifiable-draft`; a nonempty pinned registry would verify, and a failed
verification refuses. Staging has no pinned registry or list: without synthetic authority
preparation refuses (`unverifiable`), because no base list exists to propose against; with
it the signature is `synthetic-passed` and the class `synthetic-draft`, never `passed`. The
production base records the SHA-256 of `a3-revocation-list.ts`, so a plan names the list
source it was prepared against.

**Plan `lyfelabz.teacherUnitsA3RevocationPlan` v1.** Canonical JSON with fixed literals the
schema admits in no other form: `authorization` ("none: candidate revocation plan; ..."),
`revocationEffective: false`, `releaseAuthorized: false`, `activationReady: false`, the
fixed audit-only `effect` for the disposition action, `proposed.status` ("proposed only: not
pinned, not shipped") with `proposed.pin` equal to the target, the fixed five-step R2
procedure marked "descriptive only: S6d executed none of these steps", and a fixed
unresolved list. It records the identity, class, `preparedAt`, the disposition, target and
replacement, the authority source, the base (source, source SHA-256, entries SHA-256,
count), the proposed entries and their SHA-256, the known disposition references, each
revoked release's revisions and artifact fingerprints, and an ordered check list.

**Verification (`verifyRevocationPlan`).** Checks canonical bytes and the fixed schema,
refuses a supplied `preparedAt` and any other project, then re-derives the plan at its own
`preparedAt` from the supplied evidence and the CURRENT base list and requires byte-exact
equality. A changed base list (stale plan), disposition, target, replacement, authority,
release, source fingerprint, class, check or literal refuses, resealed or not. A clock before
`preparedAt`, or a missing or malformed clock, refuses.

**Freshness (pre-certification correction).** D6 fix 1 bounds freshness only at
registration and at enable (items 1 and 3), refuses future `issuedAt` (item 4) and sets no
runtime or historical expiry. S6d therefore separates four things. (1) Validity of the
signed disposition and its binding: signature, statement bytes and
`validateDispositionBinding`, re-checked on every verification. (2) Preparation freshness:
S6a `assertStatementFresh` at `preparedAt` (more than 24 hours refuses, exactly 24 hours
passes, future refuses); preparing a plan is treated as the registration-stage check.
(3) Historical verification: re-derivation at the plan's own `preparedAt`, which re-applies
(2) there and never at the current clock, so an old disposition is never renewed; a plan
verifies after its window, indefinitely. (4) Current eligibility: `currentFreshness`
(`within-window` or `outside-window`, same 24-hour bound) at the verifying clock, reported
separately; `outside-window` says a registration now would refuse and a new signed
disposition is required, and neither value is authorization. This replaces the earlier
universal 24-hour expiry of verification, which D6 does not support. No conflict with a
canonical contract was found.

**Rollout comparison (`checkRollout`).** Inputs: the plan bytes, the revoked release
plan inputs (the same inputs as `revocation verify`, including the current base list and
authority evidence), the verifying clock, the five S6c capture files and the deployment plan
and expected access for replay. Correction: the plan is first verified by the same
`verifyRevocationPlan` (full re-derivation, byte equality, base-list binding, disposition,
target, replacement and authority evidence, fixed claims); there is no second verifier, and
no capture is replayed or compared unless it succeeds. The revoked releases come from the
re-derived plan. Previously rollout-check checked only the plan schema and re-derived the
release list. The report records `planVerification` (the fixed historical statement) and
`currentFreshness` separately. The capture is verified by
the unchanged S6c `verifyCapture` replay (a tampered or resealed capture refuses). The
comparison records findings for: not exactly the nine sorted endpoints; not exactly one
route per endpoint; partial traffic; a tagged route; an alternate routed revision; a
revoked revision serving or routed; a revoked runtime payload or Functions artifact
fingerprint serving; a capture that started at or before `preparedAt`. Report
`lyfelabz.teacherUnitsA3RevocationRolloutReport` v1 carries `rolloutComparison` (`passed`
only with no finding) and fixed literals: `revocationComplete`, `revocationEffective`,
`releaseAuthorized`, `activationReady` and `providerVerified` all `false`,
`oldRevisionsDeleted: "not-observed"`, `deployedRevocationList: "not-observed: a different
revision and artifact fingerprint do not establish that the deployed artifact contains the
proposed pinned list"`, and `providerOrigin` `unverifiable`. The evidence class is the
capture's (`synthetic` or `operator-captured-unattested`) and is never raised.

**CLI (additive).** `revocation prepare` (`--out`), `revocation verify`
(`--revocation-plan`) and `revocation rollout-check` (`--revocation-plan`, the same plan-input flags as
`revocation verify`, `--capture`, the S6c plan and expected-access flags, `--out`): offline, read-only, cloud
projects only, explicit `--project` with the existing ambient-identity refusals, unknown
flags refuse, no `--execute`, `--confirm` or `--live`, `--registry` and `--revocations` only
together, exclusive output files. Existing commands are unchanged.

**What S6d proves offline, and what it does not.** Offline: identity, signature (where
authority exists), freshness, binding, conflicts and cycles within the supplied set, the
artifact change of the proposed list, staleness against the current list, plan integrity,
replay consistency of a capture and the revision and fingerprint comparison. Not established:
completeness of the known disposition set (D9); provider origin of a capture; that the
deployed artifact contains the proposed list; deletion of old revisions; anything between
shutdown and redeploy (the D1-B P1 window); inherited IAM. These need S6e or later live,
separately authorized work.

**Verification.** Offline: `revocation-procedure.test.cjs` 23 tests; `cli.test.cjs` 26 (24
existing plus 2 S6d). The matrix covers revoke with and without a supplied or smuggled
replacement; valid and invalid supersede (missing, mismatched and cross-kind replacement);
wrong target kind, document and identity; deployment approval, certification and activation
approval targets with bound and unbound releases; stale and future dispositions; wrong-key and
zero signatures; staging without authority; production with the empty pinned registry
(`unverifiable`, never passed) and refused supplied authority; already-pinned target and
replacement; conflicting dispositions, a revoked replacement, duplicates and a supersession
cycle; missing releases, known dispositions and statement bytes; stale base list, changed
authority, disposition, target, replacement, releases and list source; resealed plans with
edited literals, classes, checks or content; staleness and a clock before `preparedAt`;
rollout pass, revoked revision and artifact still serving, revision-only and artifact-only
matches, a capture older than the plan, tampered observation and bundle, wrong project,
mismatched releases, missing capture files, resealed plan literals; pure comparison of
eight and ten endpoints, partial traffic, tagged, extra and alternate routes and a routed
revoked revision; trapped `fetch`, `http`, `https` and credential retrieval with zero calls;
a static scan (no fetch, request, SDK, signing, key, token, file write, alias file, child
process, fixture or clock); and through the CLI explicit project, ambient refusal, cloud
only, no `--execute` or `--confirm`, unknown and stray arguments, paired authority, missing
and unreadable inputs and exclusive output. Behavioral mutation (in place with hash-checked
restore): 53 mutants. 39 behavioral kills. 7 message-only, each layered (target already
pinned and the `notRevoked` requirement; target and replacement reference checks, refused
underneath by `validateDispositionBinding`; empty release list, refused underneath as
unbound; verify project, refused underneath by identity validation; plan canonical bytes and
rollout plan identity, refused by re-derivation or the release binding). 7 equivalent
survivors: known-disposition identity (the A3-1 validator binds identity), non-`notRevoked`
status (only `revoked` or `notRevoked` is reachable for a list built for this identity and
validated references), the unchanged-digest guard (the target is never already pinned, so an
entry is always added), the next-list validation (built from a validated list plus one
validated, unique reference), statement-bytes equality (implied by the hash check and the
A3-1 statement digest rule, as in S6a), rollout capture identity (bound by S6c replay) and the
rollout report literal check (the report is built from the same constants). Four initial
survivors (plan effect, procedure, unresolved and proposed status in the rollout path, which
then did not re-derive the plan) gained permanent behavioral tests.

Correction tests: preparation 1 ms inside, exactly at and 1 ms outside 24 hours and 1 ms
before issue; historical verification inside, at, 1 ms after and one year after the window
(verified, `outside-window` reported, nothing authorizing); a plan prepared at the edge
verified days later; resealed `preparedAt` values refuse; missing and malformed clocks
refuse; rollout-check refusing missing plan inputs, a cross-project input set, a missing or
early clock, an altered or partial disposition, altered or missing target, a smuggled
replacement, changed, absent or stale authority and base list, missing and conflicting known
dispositions, and resealed plan content, each with zero capture replays; rollout after the
window still passing with freshness reported; and through the CLI the late verify and a
rollout-check without plan inputs refusing before any output. Targeted mutation of the two
corrected boundaries: 14 mutants, 11 behavioral kills, 1 message-only (the plan-inputs
project check; verification refuses the identity underneath), 2 equivalent (the future
refusal inside `currentFreshness`, unreachable because verification already refuses
`preparedAt` after the clock and preparation refuses `issuedAt` after `preparedAt`; the report
`planVerification` literal check, built from the same constant). Mutants that reintroduce a
universal expiry, renew at the current clock, skip plan verification or drop the reported
freshness are all killed behaviorally.

**Certification correction (Sol FAIL: P2, comparison integrity).** Reproduced first on the
unchanged bytes: with one signed revoke disposition, one deployment approval target, one
authority and one S6c capture, the genuine release gave `rolloutComparison: failed`, while a
substituted manifest with renamed revisions and replaced fingerprints gave `passed`;
`validateDeploymentBinding` rejected the substitute (`candidate runtimePayloadFingerprint
mismatch`). Root cause: for a deployment approval target the release was bound only by
`manifest.deploymentApprovalEvidenceRef`, an unsigned field, so its revisions and fingerprints
(the comparison values) were operator-supplied; recomputing the release's own content address
proved nothing. Correction: the canonical certified `validateDeploymentBinding` (A3-1, the
same validator S6b release assembly uses) is required for every deployment-target release
before any of its values enter a plan, and therefore before rollout comparison and capture
replay; no second validator was added. Limitation for review, not a block: a deployment
approval candidate does not contain revision identities (the S4 plan has none), so for a
deployment target the revisions remain unsigned and the plan records them as unbound. They
cannot turn a failed comparison into passed: a revoked revision that still serves runs the
revoked artifact, whose fingerprints are now bound, and the artifact finding remains (tested).
Signed revision binding exists only through a certification or activation approval target.

Correction tests: `revocation-procedure.test.cjs` 24 (+1), `cli.test.cjs` 27 (+1). They cover
the genuine release accepted and honestly failing; Sol's substitute refused at preparation, in
rollout-check (plan inputs substituted) and through the CLI, each with zero capture replays
and no output; a resealed plan carrying the substitute's recomputed, internally consistent
release ID and values refused; an edited or swapped `binding` value refused; fingerprint-only
and source-only substitutions refused; another approval reference, another project, empty
and null manifests refused; a substituted manifest for a certification target refused as
unbound; a revision-only substitute that binds but leaves the comparison `failed`; a signed
(certified) variant still passing; and every fixed non-authorizing report field unchanged.
Fixtures and earlier tests that compared against unsigned variant manifests now certify the
variant (`certifiedVariant`), because those passing comparisons were themselves the defect.
Targeted mutation of the new boundary: 8 mutants, 6 behavioral kills (skipping the binding,
reverting to the reference-only check, ignoring its result, trusting a recomputed digest for a
certification target, taking the deployment branch for every target, mislabelling the
binding), 2 message-only, each layered (binding against an approval whose candidate copies the
release values: the validator's own content-address check of the approval refuses; the plan
binding value check: re-derivation refuses), 0 surviving.

**Unresolved and remaining.** Pinning the proposed entries in `PRODUCTION_REVOCATION_LIST`
(a separately authorized code change), shutdown, redeploy, live capture, old-revision
deletion and any cloud registration (S6e); registry key removal (S6d-D3); D9 storage
retrieval; G1 to G5; O6; A3-7. The certified S6b package and S6c bundle unresolved lists
still name S6d as not implemented; they are fixed literals of certified modules and are
unchanged. The new CI step has not yet run in GitHub Actions.

### O6 - A3-3 verifier exception boundary (pre-wiring gate)

Status: **independently certified and integrated at
`36670e5b61500455271b9764bea6fa68f89a520f`**, on top of `38d068f` (S6d integrated); not
deployed. Status corrected in S6f at the owner's direction; this line previously read
"implemented in the repository ...; uncommitted ... Awaiting independent certification".
Authorized by the human owner after
the S6e reconnaissance, which found S6e cloud writers blocked by prerequisites (empty
pinned registries, D9 storage, D12, D13, G1 to G5) and recommended O6 as the next
operation. Teacher Units remains closed: `teacherUnitsAvailable()` returns `false`,
production uses `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`, the production registry and
revocation list are empty, and S3 is not wired. No A3-1 contract, validator, binding or
fixture, S1 to S6d module, `a3-release-authority.ts`, `index.ts`, Rules, index, Hosting,
Firebase configuration, client gate, CI, build or release tooling change.

**Root cause.** A3-3 `callVerifier` caught every verifier exception and returned
unverified `error`. The verifier's `readEvidence` reads through A3-3 `txRead`, which
propagates SDK-retryable errors unchanged and turns every other read failure into
`policyUnavailable`; `evaluateAvailabilityInTransaction` rethrows exactly those two
classes. Because `callVerifier` swallowed them first, a retryable error during the
certification read became `deploymentIneligible` instead of an SDK rerun, and a
non-retryable read failure became `deploymentIneligible` instead of `policyUnavailable`.
Fail-closed, but misclassified. Unreachable in production today: the `UNCONFIGURED`
verifier never reads or throws.

**Correction** (`a3-enforcement.ts`, `callVerifier` and the `readEvidence` closure only).
Inside each evaluation the closure reads through a local wrapper over `txRead` that adds
any error object `txRead` throws to a per-attempt set and rethrows it unchanged.
`callVerifier` receives that set; in its catch it rethrows the caught value only when the
set contains that exact object (`Set.has`, identity) and the object is SDK-retryable
(the existing `isSdkRetryableTransactionError`, parity-tested against SDK 7.11.6) or a
`PlatformError` with code `teacherUnits.policyUnavailable`. Everything else, including a
verifier-created error of any code, name, message or shape, a replacement thrown after
the verifier caught a read failure, a wrapped error, the existing `invalid evidence`,
`invalid release evidence` and `unsupported evidence reference` errors and malformed
verdicts, remains unverified `error`. The original object is rethrown, so its identity
and code reach the SDK and the existing outer classification. The set is created in every
call of the eligibility check, so each SDK rerun starts empty, re-reads every document and
re-runs the verifier; nothing is cached. No second retry classifier was added. The
existing `policyUnavailable` contract (non-retryable policy or evidence read failure) is
now honored for evidence the verifier reads; no conflict was found.

Interpretation for review: a verifier that catches a read failure and returns a verdict
is not escalated; A3-3 still requires that verdict to be `verified` and every binding to
hold. The certified S3 adapter propagates `readEvidence` exceptions unchanged (S3 O6),
so this case does not arise with it.

**Tests.** `a3-enforcement-retry.test.ts` (+29 cases, 50 total): each SDK-retryable gRPC
code (1, 2, 4, 8, 10, 13, 14, 16), an ABORTED contention message and the expired
INVALID_ARGUMENT, raised by the certification read, propagate as the same object; a
non-retryable read becomes `policyUnavailable` with the original as cause; each
retryable shape and a `policyUnavailable` refusal created by the verifier is ineligible;
an equal-shaped copy, a fresh `policyUnavailable` and a wrapped error substituted after a
swallowed read (retryable and non-retryable) are ineligible; invalid and unsupported
evidence are ineligible; an earlier attempt's error object rethrown in a later attempt is
ineligible (per-attempt set); production enforcement uses `UNCONFIGURED`.
`teacher-units.test.ts` (+5, 135 total): verifier-originated ABORTED, transaction-expired
and `policyUnavailable`, and a replaced read failure, refuse `deploymentIneligible` on
every management operation with no write and `unverified` discovery; a non-retryable
certification read refuses `policyUnavailable` on every management operation with no
write. `teacher-units.emulator.test.ts` (+6, S3 block): with the certified S3 composite
verifier, real Firestore documents and the installed SDK's own rerun loop, a fault
injected into the real `Transaction.get` for the certification address (ABORTED,
UNAVAILABLE, expired INVALID_ARGUMENT) propagates, the SDK reruns, the rerun re-reads the
certification and verifies (one verdict, two certification reads); an update faulted once
commits exactly once with one extra certification read and no extra verdict compared with
an unfaulted update; a non-retryable fault refuses `policyUnavailable` after one read
with no verdict or write; a verifier-originated ABORTED-shaped error refuses every
operation with one verification per request (no rerun) and no write.

**Mutation evidence** (in place, hash-checked restore). Hermetic suites
(`a3-enforcement-retry`, `teacher-units`): 8 compile-safe mutants, all killed
behaviorally (an outcome assertion fails, not a message): removing the identity check
(18 failures); replacing it with a code-and-message shape match (2); suppressing
retryable propagation (11); suppressing `policyUnavailable` propagation (2); letting any
retryable-shaped error escape (15); sharing the set across attempts (1); not recording
read failures (13); reverting to the pre-O6 wrapper (13). The retryable and
`policyUnavailable` suppressions are also killed in the emulator suite (4 and 1
failures). No message-only kills and no equivalent survivors. A first form of the
identity-removal mutant failed to compile (unused variable) and was not counted.

**Remaining limitations.** Classification relies on `txRead` throwing only SDK-retryable
errors or `policyUnavailable` (unchanged A3-3 behavior). Errors from `tx.get` are compared
by identity, so a provider that rethrows a different object would fail closed. Reruns
stay bounded by the SDK's `maxAttempts`; a persistent retryable fault exhausts them as
any other A3-3 read does. Wiring a verifier still needs separate authorization, A3-7 and
the remaining S6e prerequisites; O6 does not wire anything.

### S6f - Staging discovery (non-authorizing prerequisite to S6e)

Status: implemented on top of `36670e5` (O6 integrated) and integrated on main (`3bfad46`); not
deployed, never run against a real project (this line previously read "implemented in the repository
...; uncommitted"). The independent certification (Sol 6.1) failed
with findings F1 to F4; the corrections below are implemented. The recertification passed F1
and F4 and failed F2 and F3; the second corrections below are implemented. The next
recertification passed F1 to F4 and redaction provenance and failed the process-wide
working-directory behavior of the F3 reader; the working-directory correction, the bounded file
read and the final same-descriptor size check below are implemented. **Implementation complete;
accepted by the human owner for continued development on the existing verification evidence.
Independent certification is INCONCLUSIVE:** Sol verified the corrected file reader and found no
remaining implementation defect, but its environment blocked fixture writes and emulator sockets,
so its regression evidence is incomplete. The full regression (offline release tooling, Hosting
release, parity, Functions and app builds and tests, the three emulator suites, and Node 20, 22 and
24 for the offline and Hosting suites) was run by Claude, not independently. S6f is not
independently certified. No live staging discovery and no Teacher Units activation are authorized.
Authorized
by the human owner after the staging discovery design reconnaissance, which found that the
certified S6c capture cannot run without an approved deployment plan and expected access, and
that both require facts only an observation can supply (G1 variables, G2 update policy, the full
S4 execution and runtime profile, deployed fingerprints, Rules and index hashes, and the S5 IAM
bindings). Teacher Units remains closed: `teacherUnitsAvailable()` returns `false`, production
uses `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`, the production registry and revocation list are
empty, and S3 is not wired. No S1 to S6d or O6 implementation, A3-1 to A3-5, RAP, publisher,
Rules, index, Hosting, Functions source or entry point, build-profile, IAM, Storage, KMS or
infrastructure change; the only certified-module change is additive CLI commands (S6b-D3
precedent). The certified `observe capture` and `observe verify` are unchanged. The O6 status
line above is corrected at the owner's direction; the certified S6b and S6c fixed unresolved
lists are fixed literals and are not rewritten.

**Files.** `scripts/teacher-units-release/staging-discovery.cjs`,
`staging-discovery.test.cjs`, `fixtures/synthetic-discovery.cjs`; additive changes to
`cli.cjs` and `cli.test.cjs`; `.github/workflows/platform-ci.yml` (one offline step); this
record; `TEACHER_UNITS.md`. CommonJS over the certified S4 exports (`ENDPOINTS`,
`normalizeEndpoint`, `payloadSummary`, `instant`), S5 `normalizePolicy`, S6c
`assertAllowedUrl` and `STATUSES`, and A1 `archiveRuntime`, `normalizeRemoteIndexes`,
`canonical`, `fingerprint` and `LIMITS`, none modified. The CLI live path uses the certified S6c
`liveAccessToken` and `createLiveExchange` (GET only, redirects refused, bounded bodies, 30 s
timeout). Not reachable from `index.ts`; not in the deployed Functions payload.

**Staging only, enforced three times.** The CLI dispatch refuses any project other than
`lyfelabz-staging` for both commands (after the existing explicit `--project`, ambient-project
and emulator-variable refusals); the module refuses it again in `discover`, `verifyDiscovery`
and `discoveryPlan`; and every request URL passes the S6c allowlist and then a staging guard:
canonical form (`href` equal to the request), no `lyfelabz-prod` or `182791689935` raw or
percent-decoded anywhere including query values, an exact staging path per host (project ID or
the bound number 293337283840, region `us-central1`), an exact query allowlist (credential-bearing
keys such as `access_token` and `key` refused by name, unknown and duplicate keys refused,
required keys enforced), and source archives only from `gcf-v2-sources-293337283840-us-central1`
(documented convention [U]) with a safe object path. Provider-derived names (function, service,
revision, ruleset, source bucket and object) are validated before any URL is built; a name that
fails is recorded `inconsistent` and never read. The session re-checks every URL before the
request (a failure ends discovery with `guard-refusal`, keeping the evidence), and the recorder
checks it once more.

**Reads (GET only, about 82 for a healthy project).** Firebase project (an identity mismatch
ends discovery), Firestore database, the Functions v2 listing (first pass), for each of the nine
endpoints listed once in `us-central1` the Function, Cloud Run service and serving revision, the
generation-pinned source archive (deduplicated), a second Function/service/revision pass, the
Functions and Cloud Run `getIamPolicy` (version 3), the Rules release and ruleset, Firestore
indexes and both field filters, and the Functions listing again (second pass). Hosting, domain
mappings, serverless NEGs and backend services stay with S6c capture; inherited IAM is not
observed (S6c-D1).

**Classification.** Statuses are the S6c set: `observed-present`, `observed-absent`,
`unreadable`, `incomplete`, `inconsistent`, `not-observed`. An endpoint is `observed-absent`
only when both Functions passes are complete, valid and identical and it is not listed. A 401,
403, 404, other non-2xx, transport failure, partial or malformed page, undocumented listing key,
omitted collection, unreachable location, repeated or malformed pagination token, a listed name
not bound to staging, or a listing that changed between passes is never absence. Non-2xx reads
are `unreadable` with structured fields only: the HTTP status, a numeric `error.code`, an
identifier-shaped `error.status` and identifier-shaped `details[].reason` values (others are
counted, not copied); a provider message is recorded as present, never copied (F2). The kind
(`unauthenticated`, `api-disabled`, `permission-denied`, `not-found`, `rate-limited` or
`http-error`) is a best-effort reading of unattested provider fields. Extra
`teacherUnits*` functions are reported and never read. Each endpoint carries non-authorizing
diagnostics: the certified S4 `normalizeEndpoint` result (`accepted` with configuration and
runtime-profile SHA-256 and artifact fingerprints, or `refused` with the S4 reason) and the S5
`normalizePolicy` result for both policies; Cloud Run access flags are recorded, not
interpreted. G1 observations are variable names only; G2 is the reported update policy.

**Budget.** At most 400 provider reads; no read starts once less than 45 s (the 30 s exchange
timeout plus margin) of the five-minute window remains; a read completing after the window ends
discovery. Each termination (`read-limit`, `time-budget`, `window-exceeded`, `guard-refusal`,
`identity-mismatch`) stops further requests, is recorded with its event position, marks what
was not read `not-observed`, and the partial evidence is written. A backwards or malformed
clock refuses with no output.

**Evidence (three files).** `discovery-transcript.json`
(`lyfelabz.teacherUnitsA3StagingDiscoveryTranscript` v1): identity, evidence class
(`synthetic` or `operator-discovered-unattested`, never a capture class), declared principal,
window, termination, and every event in order: clock readings, reads (URL, `GET`, mode `json` or
`binary`, status, SHA-256, Base64 body of the sanitized recorded response, times) and
transport failures (URL, mode, bounded refusal reason, times), plus a declared sanitization
value (second correction, below). `discovery-report.json` (`...StagingDiscoveryReport`): derived statuses
and diagnostics. `discovery.json` (`...StagingDiscovery`): the SHA-256 of both files and fixed
claims `certifiedEvidence`, `deploymentEvidence`, `providerVerified`, `planProduced`,
`releaseAuthorized` and `activationReady` all `false`, G1 to G5 `not-resolved`, and an
unresolved list. No discovery file carries a certified kind; the S4, S5, S6b, S6c and S6d
consumers refuse them (tested).

**Verification (`observe discover-verify`, offline).** Strict transcript schema (exact keys,
literals, staging identity, class, principal, every event URL through the staging guard, `GET`
only, canonical Base64, failure reasons), canonical bytes, then exact replay through the same
code: each replayed request must match the next event's type, URL, mode and method, each body
must match its hash, transport failures are reproduced at their recorded positions, a missing,
extra or reordered event refuses, and all three files must equal the re-derived bytes. No
network, clock or credential is used. **Consistency is not authenticity:** a fully consistent
forged transcript, with report and bundle regenerated from it, cannot be detected offline, and
TLS origin cannot be proven after the fact. A verified discovery is historical and never
authorizes anything.

**Sensitive evidence.** The transcript may hold environment-variable values, source archives,
IAM bindings and provider metadata. `--out` must be outside the repository working tree (checked
lexically and after resolving symlinks), must not exist (nor `<out>.incomplete`), and its parent
must exist. Files are written exclusively (`wx`, 0600) into a new 0700 `<out>.incomplete`
directory, the bundle last, which is then renamed to `<out>`; verification refuses unfinished
output through any alias (F3, below). Raw bodies are never printed; reports carry variable
names, never values (tested with a value canary). The access token is obtained only after every
local check, is used only in the request header by the certified live exchange, and is removed
from every recorded response before hashing (F2, below); a non-refusal exchange error is
recorded only as a generic host message. A token canary through the real live exchange is
absent from stdout, stderr, all three files and every decoded body, in raw, Base64, Base64url,
hex and `Bearer` Base64 forms, including when the provider echoes it.

**CLI (additive).** `observe discover` is a dry run (read plan, no credential, no request) unless
`--live` is given; with `--live` it needs `--out` and accepts `--principal`. `observe
discover-verify --discovery <dir>` is offline. Both are staging only; neither accepts
`--execute`, `--confirm` or the capture plan flags. Existing commands are unchanged.

**Verification at first submission.** Offline: `staging-discovery.test.cjs` 27 tests, `cli.test.cjs` 30 (27
existing plus 3 S6f). Cases: nine healthy, zero, five, an extra Teacher Units function; 401, 403
and 404 listings; a disabled API; a missing revision; an oversized archive and a failed read as
transport failures with continued discovery and replay; oversized JSON; undocumented listing
keys, an omitted collection, an unknown function field (S4 refused); a repeated pagination
token; listing and endpoint drift between passes; production service names, a listed production
function, production-number and foreign source buckets, and a production pagination token
(guard-refusal); a URL guard table; module, CLI, ambient-project and emulator-variable refusals
with zero credential retrievals and zero reads; time budget, read limit and window overrun;
tampered, resealed, reordered, re-statused, re-bodied, re-identified and re-claimed evidence;
cross-consumer isolation; output inside the repository, through a symlink, colliding, with an
`.incomplete` sibling or a missing parent; permissions; value and token canaries; network-free
verification; a static scan.

Behavioral mutation (in place with hash-checked restore; S6f module and CLI): 37 mutants, all
killed. 31 behavioral. 4 message-only, each layered: the CLI staging dispatch (the module refuses
first, before any credential), the transcript literal check (re-derivation refuses), the
credential-query rejection (the query allowlist refuses) and the lexical repository check (the
parent-missing or resolved-path check refuses). 1 killed only by the static scan and
behaviorally equivalent (`wx` within a directory this run created exclusively), 1 killed by the
explicit margin assertion. A first pass left five survivors: four were test gaps (production
values in pagination tokens and object names, the session guard layer, event URL binding on
replay, and a margin test that read the mutated constant) and gained permanent tests; one
reported kill was produced only by a fixture timing flake (separately zipped synthetic archives
differ in timestamps), which was corrected. One mutant run wrote synthetic output inside the
repository through the disabled check; it was removed, and the test now uses a path whose parent
does not exist.

**Certification correction (Sol 6.1 FAIL: F1 to F4).** Within the eight S6f files only; no
certified S4, S5, S6c or S6d module, A3-3 enforcement, configuration, Rules, index or app change.
Each finding was reproduced first on the unchanged bytes.

- **F1 - query allowlist bypass.** Reproduced: `toString`, `__proto__`, `hasOwnProperty` and
  `%74oString` were accepted as query keys. Root cause: the allowlist was a plain object looked
  up with `route.query[key]`, so inherited `Object.prototype` members were truthy rules. Fix: each
  route's allowlist is a `Map` built from the literal's own keys, membership is `Map.has` on the
  decoded key, required keys iterate the `Map`, and keys must also be identifier-shaped. Unknown,
  inherited, encoded-inherited and duplicate (including encoded duplicate) keys refuse; credential
  keys and production guards are unchanged. Other dynamic lookups in the S6f code were reviewed:
  `EVENT_KEYS` uses `Object.hasOwn`, and the rest index fixed internal keys or read provider JSON by
  fixed field names that no `Object.prototype` member shares.
- **F2 - provider error echoes the credential.** Reproduced: a synthetic 403 whose message
  contained a fake token put it into `discovery-report.json` and the decoded transcript. Root
  cause: response bodies were recorded verbatim and the report copied the provider message. Fix:
  the CLI passes the active token to discovery (`activeCredential`), and the recorder removes it
  from every response body and failure reason before anything is hashed, recorded or parsed,
  replacing each occurrence with `[REDACTED-ACTIVE-CREDENTIAL]` and recording a per-event count.
  Supported encodings: raw, percent-encoded, JSON slash-escaped, lowercase and uppercase hex, and
  standard and URL-safe Base64 at all three byte alignments (the token-only characters, so an
  embedding in any larger Base64 value, such as `Bearer <token>` or an `Authorization` header, is
  found). The report no longer copies free-text provider messages or non-identifier reasons. CLI
  errors from the discovery are redacted for the token before printing. A credential shorter
  than 16 characters or with whitespace refuses. Replay needs no token: it re-derives from the
  redacted bytes, so determinism and tamper detection are unchanged (an edited redaction count
  changes the re-derived report). **Limitation:** this protects the active token in the listed
  encodings only; other secrets, or the token in other transformations, cannot be recognized, so
  the raw transcript remains sensitive. A token-bearing archive is redacted like any body and is
  then honestly unverifiable. Found while testing F2: the A1 unpacker's error text carries a random
  temporary path, which made a corrupt-archive report non-replayable; absolute paths in that reason
  are now replaced with `<path>`.
- **F3 - unfinished directory alias.** Reproduced: an `.incomplete` directory verified through a
  `/.` suffix, a `//` suffix and a symlink. Root cause: the check was a lexical regular expression
  on the argument. Fix: `readOutput` resolves the canonical target with `realpath`, refuses any
  resolved path with a component ending in `.incomplete`, requires a directory, opens each file
  with `O_NOFOLLOW` and `O_NONBLOCK` and requires a regular file, then resolves again and refuses
  if the path, device or inode changed while reading. Residual: a writer with access to the evidence
  directory can still change file contents after the read; such a writer can forge consistent
  evidence anyway.
- **F4 - rollback protection test gap.** The contract (a backwards clock refuses with no output;
  equal readings are allowed) is unchanged. Added tests: a backwards reading at several clock
  positions refuses discovery with no evidence, through the module and the CLI; a non-decreasing
  flat clock still verifies; resealed transcripts with an earlier request, completion, clock or
  completion-at-start time refuse replay.

Correction tests: `staging-discovery.test.cjs` 33 (+6), `cli.test.cjs` 32 (+2). Focused mutation in
a separate temporary copy (scripts copied; the repository files' hashes verified unchanged
afterwards): 24 mutants. 22 behavioral kills: F1 object-lookup revert and `Map` membership
removed; F2 body redaction skipped, failure-reason redaction skipped, Base64 cores removed,
aligned-only Base64, Base64url removed, hex removed, percent removed, JSON escape removed, message
copied, reason shape removed, CLI token not passed, archive path normalization removed; F3
lexical-only, basename-only, following file symlinks, regular-file check removed, post-read
recheck removed, inode recheck removed; F4 rollback protection removed and equal readings refused.
0 message-only, 0 static-only. 2 equivalent: the identifier-shape check on query keys (every
declared key passes it, and the `Map` refuses every undeclared key) and the CLI error redaction
(no current path places the token in a discovery error message; kept as defense in depth). 0
surviving defects. A first focused pass left two further survivors that were test gaps (a canary
whose Base64 had no `+` or `/`, and no non-regular-file case); the canary and a FIFO case were added.

**Second certification correction (Sol 6.1 recertification: F1 and F4 passed; F2 and F3 FAIL).**
Within the eight S6f files only; no certified module or other file changed. Both defects were
reproduced first on the unchanged bytes.

- **F2 - lowercase percent escapes.** Reproduced through the real CLI live path (synthetic token,
  synthetic transport behind the certified live exchange): a 401 body carrying the token with
  lowercase percent escapes (`%2f`) left it in the decoded transcript, the report recorded zero
  redactions, and offline verification accepted the evidence. Root cause: the percent form was a
  single exact string produced by `encodeURIComponent`, which emits uppercase hex. Fix: matching is
  now per character of the token: the literal character, a percent escape with hex digits in any
  case, or a JSON `\u00XX` escape in any case (and `\/` for a slash), in any mixture within one
  occurrence; the hex encoding matches in any case; standard and URL-safe Base64 at all three
  alignments are unchanged. The same matchers apply to response bodies, error bodies, failure
  reasons and CLI error text. Mixed case within one escape cannot occur for this token: the
  credential must be printable ASCII, whose first hex digit is always numeric, so mixed case means
  differently cased escapes within one occurrence, which is covered. No other rewriting of provider
  responses was added.
- **F2 - redaction provenance.** Per-event redaction counts are removed: they were unattested
  metadata that a balanced, resealed edit could change without detection, and a zero count proved
  nothing. Four things are now distinguished in the code and in the evidence: (1) the original
  provider response, which is never stored when it contained the token; (2) the sanitized
  recorded response, the bytes the transcript hashes and replay uses; (3) operator-captured,
  unattested evidence: the transcript carries a declared `sanitization`
  (`active-credential-removed-before-recording` on the CLI live path, `not-applied` when no
  credential was supplied), which replay cannot confirm, and nothing is provider-attested; (4)
  offline integrity verification, which proves only consistency with the sanitized recorded bytes.
  The report and bundle carry the declaration and a marker count re-derived from the recorded
  bytes, labelled diagnostic only (a marker can be provider-originated, and zero markers prove
  neither that scanning ran nor that nothing sensitive was present). Verification cannot reject
  inconsistent sanitization metadata from sanitized bytes alone, because the original response is
  not retained; this limitation is stated, not hidden. An edited declaration changes the
  re-derived report and refuses unless the whole evidence set is regenerated (a consistent forgery,
  which offline verification cannot detect).
- **F3 - concurrent directory substitution.** Reproduced with a deterministic hook: verification
  began on a finalized directory, the unfinished directory was swapped into its pathname at the
  first file open and the original restored after the third, and the reader accepted the
  substituted bytes, because each file was opened by pathname and the final `realpath`/`stat`
  check saw the restored original. Fix: Node has no portable `openat`, so the reader binds once to
  the directory itself by changing the process working directory to it (the working directory
  holds the inode whatever later happens to the pathname), checks the bound directory's current
  kernel path (native `realpath` of `.`, since Node caches `process.cwd()`) for an `.incomplete`
  component, opens every file by relative name with `O_NOFOLLOW` and `O_NONBLOCK`, requires a
  regular file, checks the bound directory's current path again after the reads, and restores the
  previous working directory. A pathname swap or symlink therefore cannot change which directory
  supplies the evidence. The read is synchronous (nothing else runs in the process meanwhile);
  `process.chdir` is unavailable in worker threads, where the reader refuses. The previous
  device/inode comparison was dead code under this binding and was removed. Trust model: the
  evidence comes from the directory that carried a finalized name when it was bound and still does
  after the reads; a local writer with access to that directory can still change its files, and
  such a writer can forge consistent evidence anyway.

Second correction tests: `staging-discovery.test.cjs` 35 (+2), `cli.test.cjs` 33 (+1), and the
CLI live-path echo test now includes lowercase and mixed-case percent forms. F3 uses controlled
`fs.openSync` and `process.chdir` hooks, not timing: Sol's substitute-and-restore interleaving, a
substitution left in place, substitution at binding restored before the reads, symlink
replacement of the pathname, a bound unfinished directory promoted to a finalized name during the
reads, file replacement by a symlink and by a FIFO, nested and aliased unfinished paths, and the
finalized control with offline replay. F1 and F4 reproduction cases were re-run unchanged.

Focused mutation (separate temporary copy outside the repository; repository file hashes verified
unchanged): 18 mutants. 17 behavioral kills: lowercase percent matching, JSON `\u` escapes, any-case
hex, active-token propagation, provider-body redaction, failure-reason redaction, CLI error
redaction (the token reaches stderr), the forced sanitization declaration; binding-time check,
directory binding, final identity check, cached working directory, non-regular-file refusal,
`O_NOFOLLOW`, working directory not restored; rollback protection (F4); the F1 object-lookup
revert. 0 message-only. 1 equivalent: limiting each escape to all-uppercase or all-lowercase hex
(mixed case within one escape cannot occur for a printable-ASCII credential). 0 meaningful
survivors. In the previous round the CLI error-redaction mutant was reported equivalent; a test now
raises an error carrying the token after the credential is obtained and kills it behaviorally.

**Working-directory correction (Sol 6.1 recertification: F1 to F4 and provenance passed; FAIL on
process-wide working directory).** Within the eight S6f files only. The second F3 reader changed the
caller's working directory with `process.chdir`. Reproduced on the unchanged bytes: (A) renaming or
removing the caller's directory during verification made the pathname-based restore fail with
ENOENT and left the process in the evidence directory; (B) replacing the caller's pathname with a
new directory restored the process into a different inode; (C) a worker thread blocked at the
reader's first file open read `discovery.json` by a relative path from the evidence directory.

Alternatives considered. (A) Descriptor-relative access: Node has no portable `openat`, and
neither `/dev/fd/N/<name>` (macOS) nor a portable equivalent resolves a name beneath a directory
descriptor here (`/proc/self/fd/N/<name>` is Linux only); rejected. (C) A private snapshot: copying
reads by pathname, so a substitution during the copy selects the wrong source, which is the
original defect; rejected. (B) An isolated helper process: chosen, because it keeps the proven
directory binding (a working directory holds the bound inode) while confining it to a process that
owns nothing else.

Correction. `readOutput` never changes the caller's working directory and never consults it for an
absolute path. It runs a fixed helper source (`HELPER_SOURCE`, a constant in the module) with
`process.execPath -e`, exactly one validated absolute-path argument, `cwd` set to the filesystem
root, an empty environment (so `NODE_OPTIONS` and every credential variable are absent), no shell,
a 60 s timeout with SIGKILL, and a bounded output (three frames of at most 256 MiB each). The
helper uses only `fs` and `path`, makes no request and reads no credential. It binds its own
working directory to the target once, checks the bound directory's current kernel path for an
`.incomplete` component before and after the reads, opens each file by relative name with
`O_NOFOLLOW` and `O_NONBLOCK`, requires a regular file within the size bound, and writes
length-prefixed frames. The parent accepts only exit status 0 with exactly three well-formed frames
and no trailing bytes; every other outcome refuses (fail closed). Trust boundary: the evidence comes
from the directory that carried a finalized name when the helper bound to it and still did after
the reads; a local writer with access to that directory can still change its files, and such a
writer can forge consistent evidence anyway.

Tests (`staging-discovery.test.cjs` 37; `cli.test.cjs` 33). Deterministic interleavings run the
identical helper source with a prefix that performs filesystem actions at the helper's Nth file
open or at its working-directory change; there are no sleeps. Covered: the caller's directory
renamed, removed and replaced with another inode during verification (the caller stays in its own
inode, `process.chdir` is never called in the caller, evidence correct), and the production
reader with the caller's directory already removed; a worker thread that the helper waits for
mid-read, which sees the caller's directory and gets ENOENT for a relative evidence read; Sol's
substitution with restoration, a substitution left in place, binding-time substitution, symlink
replacement of the pathname, a bound unfinished directory promoted during the reads, a file replaced
by a symlink and by a FIFO, nested and symlinked unfinished aliases, finalized controls with offline
replay, a hostile `NODE_OPTIONS` and credential variable in the caller's environment that never
reach the helper, and malformed or failing helper results. A static check binds the exported helper
source to the module literal, forbids `process.chdir` outside it, permits one `spawnSync` of
`process.execPath`, and limits the helper to `fs` and `path`.

Focused mutation (separate temporary copy; repository hashes verified unchanged): 16 mutants. 15
behavioral kills: directory-source binding removed, incomplete refusal removed, `O_NOFOLLOW`
removed, non-regular refusal removed, binding-time check removed, final check removed, helper
environment inherited, helper started in the caller's directory, caller `process.chdir`
reintroduced, an in-process read reintroduced, trailing-frame check removed, rollback protection
(F4), lowercase percent matching and active-token propagation (F2), the F1 object-lookup revert. 1
message-only: accepting a failed helper exit status (the framing check still refuses, fail closed).
0 static-only, 0 equivalent, 0 survivors.

**Bounded file-read correction.** An independent probe that grew an evidence file between the
helper's `fstat` size check and its read made the helper allocate 268,435,457 bytes before rejecting
the file: the limit was checked only against the `fstat` size, and `readFileSync(fd)` then read to
end of file whatever the file had become (the parent's frame and `maxBuffer` bounds still held, and
no invalid evidence was accepted). Correction, in the helper only: a file larger than the limit at
`fstat` refuses before any read; otherwise the file is read incrementally in chunks of at most 64 KiB,
never requesting more than its `fstat` size plus one byte, so no read or buffer can exceed the limit
plus one byte; any difference between the bytes read and the `fstat` size (growth or shrinkage)
refuses (`changed size while it was read`). The helper still writes nothing on failure, the evidence
format is unchanged, and the parent's checks are unchanged. Tests (`staging-discovery.test.cjs` 39):
the same helper source with a 4 KiB limit substituted (the production constant is asserted to be
256 MiB) and an in-helper instrumentation prefix covering a file exactly at the limit (accepted), one
byte over (refused before any read, no output), 1 MiB growth after `fstat` for a small file and for a
file at the limit (refused; the largest read request and helper allocation stay at most the limit plus
one byte), truncation during the read (refused), malformed and truncated helper output, and valid
evidence through the production reader with offline replay. Mutation (temporary copy outside the
repository): reverting to the unbounded read, removing the per-read cap, and accepting a size change
are each killed behaviorally; removing the pre-read oversize check is message-only (the post-read
length check still refuses). Limitation: the limit applies per file; the aggregate remains bounded
by three files and the parent's `maxBuffer`.

**Final same-descriptor size check.** Independent review found that a size change after the last
positive read and before acceptance (a late shrink or late growth) was accepted on Node 20 and 22:
the bytes read were compared only with the initial `fstat` size. Correction, in the helper only: the
sequence is now (1) initial `fstat` of the open descriptor (non-regular refuses; over the limit
refuses before any read), (2) the bounded incremental read (at most the initial size plus one byte),
(3) a final `fstat` of the SAME descriptor before acceptance; the bytes are accepted only when the
bytes read, the initial size and the final size are all equal and the descriptor is still a
regular file, otherwise the file refuses (`changed size while it was read`). Tests
(`staging-discovery.test.cjs` 40): the production helper source with an in-helper hook that, at the
first end-of-file read (after the last positive read, before acceptance), truncates or appends to the
file; both refuse with no output, and an unchanged control is accepted with exact bytes. Both late
cases are accepted by the previous implementation (verified in a temporary copy) and refused now.
Limitation: size checks detect only size changes. A same-size rewrite of the bytes, or a change after
the final check, is not detected; a local writer with access to the evidence directory can forge
consistent evidence anyway, and offline verification still requires the bytes to re-derive exactly.

**Not established; remaining.** Discovery is not provider-verified; the read permissions are
expected, not verified; every provider shape is as documented, not observed; the source bucket
convention is unverified; two passes narrow but do not eliminate races; G1 to G5, D9, D12, D13,
live S6c capture, S6e and A3-7 remain open. **A live staging discovery requires separate,
explicit owner authorization after independent certification and integration;** it uses an
existing read-only staging credential chosen by the owner and makes no IAM change. Production
discovery is not implemented. The new CI step has not yet run in GitHub Actions.
