# ADR: My Units trusted-operator availability (Option B)

## E2 active release decision, October 27, 2026

Owner-authorized E2 implements E1 Phase 1 locally. The active release profile is schema 2 in `scripts/teacher-units-release/option-b-observation.cjs`; schema-1 observers/receipts remain historical readers. Custom Cloud Build provenance, registry package verification, checkpoint qualification, desired/serving image equality and explicit Run executionEnvironment fields are retired as launch requirements. This deliberately relinquishes that supply-chain attestation, within the already accepted trusted deployer/operator boundary.

Retain exact project/nine-endpoint scope, reviewed application bytes/build, required runtime settings, ready serving revision/routes, effective Rules denial evidence, required indexes, paired Hosting checks and a retained compatible closed-only recovery archive. Rules schema-2 evidence binds tested Rules sources rather than each application release. Real activation now requires a valid prepared closed policy, current schema-2 release evidence, environment-specific owner decision, verified operator credentials, exact saved CAS/confirmation and atomic policy/history/canonical audit. Production additionally requires matching staging acceptance. Close/recoverClosed have no release-evidence dependency.

This supersedes conflicting launch prerequisites and interlock-status statements in the historical sections below. It does not change runtime authorization, policy/protocol schemas, teacher UI or deployed state. See [the E2 workflow](U2_6_RELEASE_READINESS_RUNBOOK.md#e2-simplified-release-and-operator-workflow). No cloud operation, activation, IAM/Rules change, commit or push is authorized by this implementation.


Date: October 25, 2026 (America/New_York).

Status: **owner-adopted architecture, locally implemented through B1a-B1g; B1h documentation consolidated October 26, 2026; independent review and all external acceptance/release gates pending**. Implementation is uncommitted and not deployment or activation authorization. Real-project enable remains interlocked. The Operation 2B/2C historical planning record below is preserved with its original scope; subsequent owner instructions separately authorized each B1 batch.

Implementation specification: [Operation 2B blueprint, corrected by Operation 2C](MY_UNITS_OPTION_B_IMPLEMENTATION_BLUEPRINT.md). Baseline: `main`, `1b1089797b57bbc43b6fb8423dbcc61baeb2b4a6`, plus the 14 preserved pre-existing modified files listed in that document.

## Context and decision

My Units is a teacher-owned curriculum organization feature with authenticated Results integration. It needs strong identity and school/district isolation, callable-only access, safe concurrent writes, atomic audit, reconciliation of uncertain writes, deployment compatibility, controlled activation and effective shutdown.

The previous A3 architecture additionally required independent signed deployment/activation/certification statements, artifact-pinned approval keys and revocations, a separate key project and evidence storage, runtime evidence-graph verification, and a staged registration/revocation process. Those controls supplied an additional activation boundary against some privileged database-writer actions. They did not prevent a privileged writer altering unit data or a deployer replacing enforcement, and single-owner per-action signing did not create a second independent human approver.

Operation 2A concluded that this machinery was disproportionate to the feature's demonstrated risk and operational scale. Operation 1J showed real deployment drift and review gaps, together with strict evidence-tool assumptions that did not match provider-managed configuration. Neither the assessment nor discovery established readiness to launch.

**The owner selected Option B.** Preserve the essential application guarantees and explicit release authority, and replace cryptographic release approval with trusted, appropriately authorized database and deployment operators, a small audited server policy, ordinary release evidence and scoped recoverable deployment.

This relinquishes independent cryptographic approval enforcement against privileged policy writers. It does not claim cryptographic-equivalent assurance. The owner accepts that these writers, deployment/traffic administrators and appropriately authorized runtime accounts are part of the security boundary.

## Adopted architecture and local implementation status

Use one server-only policy at `platformConfig/teacherUnitsAvailability`. Missing, invalid, stale, disabled or unreadable policy never authorizes management mutations; management reads also fail closed. The detailed schema, validation, build derivation, error behavior and transition contract are in blueprint D-F.

Policy schema 2 binds environment/project number/default database, policy instance and generation, approved actual backend build, `teacher-units-v3`, ordered resource-placement digest, enabled/closed mode, attributed operator/approval/reason and transition timestamps. New enforcement identifier is `teacher-units-option-b-v1`. Wire capability schema is 3 and mutation envelope schema is 2. Old signed policy schema 1 and staging markers cannot authorize the new runtime.

Every callable resolves actual runtime identity before tenant reads. Within each management transaction, revalidate canonical teacher/user/school/district, read uncached policy, compare runtime build/profile/placement and mutation compatibility, then evaluate receipt/unit/revision/no-op decisions. Repeat on SDK retries and replay. Reauthorize response reads after writes; failure preserves `responseUnavailable` and uncertainty. Capabilities remains authenticated and can truthfully declare closed without granting unit access.

The first replacement retains the existing bound runtime/destination resolver and two-pass request-time artifact inventory checks to limit migration scope. Optimization is expressly deferred beyond B1, not a launch prerequisite. Retain the initial policy metadata fields as well; moving history-only fields out of policy is optional later simplification, not new B1 scope. No positive availability/policy cache is introduced. Signed release-manifest/provenance lookup and release-authority verifier are removed from the active dependency graph. A build ID is an operational content/consistency identifier, not proof of provider or human approval. Ordinary Functions builds and general client builds remain closed. Explicit policy-capable builds still require enabled server policy.

Use a small human-operated dry-run/CAS tool with verified credentials, explicit target, stale-action rejection, atomic policy/history writes and unconfirmed-outcome reconciliation. Closure must not depend on signatures, certification objects, Hosting availability or provider-normalizer success. History is release-control trace data; every transition also appends a canonical `auditEvents` event in the same transaction through the existing writer. Operation 2C authorizes planning the audit-only operator sentinel, not implementing it. The exception is valid if and only if action is teacherUnits.availabilityChanged, targetType is teacherUnitsAvailability and targetId is platformConfig/teacherUnitsAvailability, with the complete strict F2 payload, actor/subject/correlation cross-checks and no supplied school/district. The new action also requires that operator tuple. Every pre-existing teacher/student school requirement and system behavior remains unchanged; targeted shared-writer and Release 1 consumer regressions are required. No application role or fabricated school is introduced. History remains client-inaccessible and create-only through tooling; it is not tamper-proof against trusted Admin writers. No public operator callable or new cloud service is needed.

## Historical Operation 2C contract corrections, implemented locally in B1

1. **Generation exhaustion:** valid enabled MAX_SAFE_INTEGER remains enabled. Ordinary close reports failure/still enabled; recovery required. Separately authorized recoverClosed CAS replaces the exact current singleton with a fresh closed instance/generation 1/null build/empty contracts, atomically with history and canonical audit. Only verified commit/readback establishes closure. New instance and uncached backend checks invalidate old permits after serialization. MAX-1/MAX/unsafe and failed/stale/uncertain recovery boundaries are explicit tests; see blueprint D4/F2/I/J.
2. **Rules evidence:** retain legacy exact-hash comparison; add the explicit G6 B approval attachment binding exact deployed ruleset identity/hash, local source hash, focused denial/equivalence report, reviewer/owner decision and release/build/Hosting/placement. Versioned B receipts record the approval digest. Prepare, certify and pre-enable reject any unapproved resource/hash/report/candidate change. No skip or hash-normalization bypass, and no deployment just to match source hashes.
3. **Historical compatibility:** freeze old protocol/build validators, schema 1/v2 fixtures and S6f dependency behavior. Separate new active availability-protocol/runtime-build modules and explicit B evidence/observation adapters. Preserve a3-bindings, surface-observation, synthetic-capture/discovery and historical replay dependencies as enumerated in G5. Historical dispatch is never imported as runtime authorization fallback.
4. **Client state:** one bootstrap-scoped capability lifecycle serves My Units, Curriculum selection, Add to Unit, membership and placement. Only fresh validated enabled state permits unit controls. Context/epoch/request-sequence checks suppress stale responses; invalidation and 30-second display expiry disable actions. Every mutation still obtains its own fresh ten-second single-use permit. Direct Curriculum entry and all E4 tests are mandatory; backend checks remain authoritative.
5. **Canonical audit:** record the owner's narrow planning approval above, exact tuple/payload validation and atomic policy+history+canonical audit. No teacher/student school-context exemption or new application privilege. Implementation belongs to separately authorized B1d, not Operation 2C.
6. **Bounded local implementation:** replace monolithic B1 with B1a-B1h in blueprint J, with exact expected new/modified manifests, focused verification and completion gates. B1a is exactly three new unwired files; no caller/compiler/tool is changed. Later batches have expected scope manifests; additional discovered files require an explicit manifest revision before expansion. One integrated independent B2 review follows coherent local completion; no per-batch certification ladder.

## Essential requirements retained

1. Authentication and canonical active-teacher authorization; no teacher privilege inherited from an application administrator role.
2. Teacher, school and district isolation; server-derived immutable ownership/identity; uniform owner-school not-found behavior.
3. Transactional authorization revalidation, including every SDK retry, replay and no-op.
4. Callable-only units/receipts; default-deny policy/history/audit access from all clients.
5. Closed bounded schemas, canonical resource validation and placement parity.
6. Revision concurrency and atomic reorder/membership, same-record archive/restore.
7. School-bound create idempotency, original expectedSchoolId and unchanged receipt/hash identity.
8. Atomic domain audits; no duplicate mutation/audit from replay or no-op.
9. Honest uncertain outcomes, no automatic request resend and authoritative reconciliation.
10. Server availability on every management read/write and post-commit response read; cached clients cannot bypass closure.
11. Actual backend build, client contract, policy instance/generation and placement agreement.
12. Separation from assignment authority, student access, scoring, grades, answer keys and completion definitions.
13. Clean exact-commit deployment, actual provider/served-byte observations, scoped surfaces and known-good closed rollback.

## Precise supersession of existing decisions

The table records the intended new decision, not a claim that historical implementation has already changed. Existing enforcement stays in place until the coherent replacement is implemented, independently reviewed and separately deployed. Historical approvals, source, vectors and certification evidence remain traceable.

| Prior source / decision | Option B disposition |
|---|---|
| `U2_6_A3_CONTRACTS.md`, policy/release/evidence content addresses and authority graph | Supersede schema 1 runtime policy/evidence dependencies with blueprint schema 2. Preserve strict parsing/canonical hashes where useful, exact target binding and fail-closed behavior. Historical release/evidence objects remain available. |
| Same document, protocol v2 / capability schema 2 / envelope schema 1 | Use new versioned active modules for v3 / schema 3 / schema 2, explicitly redefining wire backendReleaseId as approved backend build ID. Retain old modules unchanged for schema 1/v2 historical inspection; no runtime fallback. Preserve lifetime, origin, caller, nonce, placement and single-use checks. |
| `U2_6_A3_2_RUNTIME_PROVENANCE.md`, signed release/config/revision match required for availability | Supersede signed release-manifest binding. Retain actual runtime/destination identity, artifact/build consistency and explicit closed/policy-controlled profiles; observe fleet/config/routing through release controls. |
| `U2_6_A3_3_APPROVED_DECISIONS.md`, Decision 1 discovery | Update versions/declarations only as specified. Preserve canonical authentication and transactional declaration. |
| Same, Decision 2 uncertainty and section 5.1 SDK retry Option A | **Retain unchanged.** Its rejected retry Option B is unrelated to this architecture Option B. Transaction refusals are not proof no attempt committed. |
| Same, Decision 3 verified Hosting fingerprint source | Supersede signed activation fingerprint authority. Hosting/source/build/placement consistency is ordinary reviewed release evidence, not runtime signed authority. Preserve trusted target/emulator separation. |
| Same, Decision 4 verifier and criterion 12 UNCONFIGURED-only wiring | Supersede as a future launch requirement only after replacement review. Remove the verifier dependency, never change UNCONFIGURED into success. No legacy verifier selection fallback. |
| `U2_6_A3_3_ENFORCEMENT.md`; `TEACHER_UNITS.md` A3 enforcement/activation prerequisites | Replace evidence/provenance/verifier steps with B checks. Preserve all transaction boundaries and domain semantics. Replace historical per-slice/signing prerequisites with integrated risk-focused review/acceptance. |
| `U2_6_A3_6_DECISION_RECORD.md` section 2 fixed constraints | Supersede only requirements for signature authority, verified approval-derived Hosting expectation, runtime evidence graph and old dependency ladder. Preserve no runtime activation lease, default closure, safe retry and domain/resource boundaries. |
| D1, semi-trusted writer model D1-B | Replace with explicitly trusted writer/operator boundary. Privileged policy/history rollback and direct unit-data mutation are accepted residuals constrained operationally by IAM/review/audit/recovery. |
| D2, artifact-pinned approval keys | Retire from active release/availability requirements. No registry population required. |
| D3, per-environment signer custody and separate key project | Retire key-project/KMS/hardware-key ceremony requirement for My Units. No key provisioning. |
| D4, per-action keys and action authority registry | Replace with explicit named human release approval and authenticated operator credential attribution. No signature or independent second-approver claim. |
| D5, R2 disposition/redeploy/key-removal and old-revision deletion ceremony | Replace with server close, verified compatible closed backend/paired Hosting recovery and fresh approval before re-enable. Continue checking traffic/tags/routes; destructive revision deletion is not an automatic launch prerequisite. |
| D6, signed statement freshness | Retire signed-statement registration age rules. Keep no runtime lease and retain proportionate fresh observations: five-minute execution observation, 24-hour preparation and ten-minute CAS confirmation per blueprint. |
| D7, signed certification statement/disposition target | Replace with independent review report tied to exact source/dependencies and ordinary release evidence. Independence comes from review, not owner signature. |
| D8, signed-dependent CAS and content-addressed history IDs | Preserve atomic CAS/history and no-op semantics; replace event schema/IDs with blueprint F2 command UUIDs, authenticated attribution, server commit timestamps, narrow owner-planning-approved canonical atomic audit and unknown-outcome reconciliation. Enabled generation exhaustion is not closure; use separately authorized verified closed-instance recovery. Legacy events remain untouched. Closed recovery is separately authorized. |
| D9, separate evidence buckets in key project/retention ceremony | Retire new infrastructure requirement. Retain attributable release evidence in reviewed existing storage; no claim of immutable/tamper-proof storage without evidence. |
| D10, approved exact deployment/configuration and runtime updates | Preserve scoped plans, observed configuration/target/placement/build agreement and reproducible predeploy. Replace universal strict provider-shape and base-image invariance assumptions with reviewed B observation profile; proposed default accepts recorded provider-managed automatic patching and explicit residual. Unknown security-relevant configuration still blocks acceptance. |
| D11, mandatory dedicated Teacher Units service account | Replace mandatory identity creation with evidence-based effective least privilege. A dedicated account is remediation if justified, not an automatic requirement or proof other writers cannot alter policy. Observe public invoker and ingress and test callable auth. |
| D12, policy-controlled build | Retain closed default, clean expected-SHA build-time selection, stale-output refusal and reproducibility through predeploy; update record/ID schema. No request/runtime switch. |
| D13, enabled Hosting candidate and subsequent A-G cryptographic capture/broker completion | Remove mandatory dependency on signed activation-chain completion. Preserve ordinary two-site build/served-byte/config/navigation certification and pair rollback. Existing useful D13 tooling remains optional with its documented limits. |
| D14, operator CLI, explicit project and dry-run | Retain; replace approvalSystem/registry identity requirements with verified credential subject, owner approval reference, reason and atomic history. CI remains credential-free. |
| D15, separate A3 observer while A1 remains eight-endpoint | Supersede fixed split for active Teacher Units releases. Require one coherent nine-endpoint check including Capabilities; update/version affected A1 teacher-units receipts. General release behavior remains protected. Preserve old helper/replay behavior; B comparator additionally requires G6 exact approved deployed Rules state and focused-equivalence evidence. |
| S1-S3; S6a-S6e crypto-specific launch work and R2 ceremonies | No further key/statement/signing/registration/certification-chain implementation required to launch B. Preserve historical evidence and generic useful helpers; stop requiring recertification of machinery not used. |
| S4/S5/S6f observer and access evidence | Reuse applicable tests/evidence, preserving provenance limits. Review real provider shapes and permission gaps. S6f is PASS per later Operation 1C; Operation 1J completed one live staging run. Neither certifies deployment or activation. |
| A3-7 integrated certification | Replace verifier-chain certification scope with integrated B authorization, availability, compatibility, operator and rollback verification. Independent review remains required. |
| `TEACHER_UNITS_STAGING_UX_TEST_DESIGN.md` marker exception | Historical staging-only path, retired from new runtime. Close old marker policy before replacing staging endpoints; recover to a new schema 2 closed instance with explicit staging authorization. Never silently upgrade marker enablement. |
| `U2_6_RELEASE_READINESS_RUNBOOK.md` canonical closed assertion for every teacher-units client candidate | Preserve general closure. Explicit teacher-units intent becomes policy-capable UI with `server-policy-required` artifact declaration and no runtime authority. Preparation/certification does not enable. |
| `DOMAIN_AND_HOSTING_CONTRACT.md` | Retain clean checkout, exact expected commit, paired sites/served bytes, scoped deploy and paired rollback. Any necessary intent adapter does not waive those gates. |
| `LYFELABZ_FIREBASE_SECURITY_MODEL.md` older Teacher Units direct-read paragraph | Correct later to actual callable-only Rules, without broadening access. Default deny, tenant isolation and audit requirements remain. |
| Release 1 record and prior certified production functionality | Preserve historical facts unchanged. Release 1 did not deploy Teacher Units and is not activation approval. |

No historical decision is erased. Later implementation should add scoped supersession notes and route active canonical documentation to this ADR once adopted, leaving prior approvals/results readable. The currently dirty `CURRENT_PLATFORM_STATE.md` must be reconciled without overwriting unrelated work.

## Approval, release and recovery model

The approved architecture direction is distinct from all subsequent execution gates:

1. Operation 2C finalizes the corrected planning contract only. Owner separately authorizes B1a and each subsequent named local batch (or explicitly named group). No implementation authorization is implied here.
2. Independent review verifies the changed mechanism and high-risk races against exact candidate bytes; unchanged certification is reused where applicable.
3. Separately authorized staging work reconciles all nine builds, actual IAM/routes/configuration, Rules behavior, Hosting bytes, authenticated workflows, cached closure and rollback. Staging does not imply production approval.
4. Separately authorized production preparation deploys exact scoped Functions and Hosting while closed, records actual state and rollback baselines, and verifies closure. New public invoker grants/closed policy writes are explicit parts of that authorization if required.
5. Only a separate final activation decision permits enable CAS for the exact policy instance/generation/build/placement/contract and approved operator. Fresh evidence is required. No prior command enables implicitly.

On failure close server policy first. Retain units/receipts/audits and reconcile uncertainty. Restore a known-good compatible closed backend and both Hosting sites as needed, then verify all actual routes and cached-client refusal. First production launch has no earlier Teacher Units backend; the new verified closed backend is its recovery baseline. Re-enable is a fresh decision, never policy-generation rollback.

## Risks and limits accepted or still open

Accepted at the architecture level: trusted privileged writers/deployers; no independent cryptographic activation approval; history not tamper-proof against Admin principals; no second human approver implied; earlier committed writes and delivered data cannot be recalled.

Still requires concrete evidence/decision before external use: actual IAM scope/holders and inherited impersonation, runtime service-account privileges, routes and old revisions, safe handling of real buildConfig and automatic updates, deploy-time build reproducibility, authenticated teacher/UI/accessibility acceptance, durable existing release-evidence location, and the exact availability operator. Architecture approval does not accept any unknown broad IAM grant automatically.

Missing/invalid/unreadable policy makes compliant B requests fail closed, including a database outage. A valid enabled policy at MAX_SAFE_INTEGER remains enabled until authorized closed recovery commits and is verified; ordinary close cannot truthfully claim closure on generation exhaustion. During an outage a close write itself may be unconfirmable. A defect in enforcement or a compromised privileged operator requires separately authorized deployment/IAM incident response; the policy cannot protect against code that ignores it.

These decisions apply only to My Units organization/availability. They do not relax student, assignment, grading, scoring, answer-key, identity or unrelated LyfeLabz release requirements.

## Historical Operation 2B/2C scope and stop state

Operation 2B added this ADR and its companion blueprint. Operation 2C updates those **two planning documents only, in place**. They remain untracked/uncommitted at this baseline. All other pre-existing working-tree changes and historical records/evidence are preserved. No application source, tests, fixtures, deployment scripts, flags, IAM or cloud state are changed. No builds/suites, cloud calls, deployments, commits or pushes run.

The finalized B1 local manifests are: B1a policy foundation (3 new); B1b versioned protocol/build/offline adapters (9 new); B1c backend/writer cutover (21 modified); B1d audit extension (6 modified); B1e operator tool/CAS (3 new, 2 modified); B1f shared capability lifecycle (2 new, 14 modified); B1g release/Rules/compiler adapters (4 new, 12 modified); B1h canonical adoption/handoff (12 modified). These are expected future scopes, not files changed by Operation 2C. Exact paths, dependencies, invariants, tests and completion criteria are in blueprint J.

**Historical Operation 2C readiness: B1a was ready for separate authorization, with no unresolved architectural blocker.** Its only files are platform/functions/src/teacherUnits/availability-policy.ts, platform/functions/src/teacherUnits/availability-policy.test.ts and fixtures/teacher-units-option-b/v1.json. It is pure and unwired. IAM/credentials, actual deployed Rules approval, runtime-update acceptance, authenticated staging and production deployment/activation decisions are later gates and do not block B1a.

**Historical Operation 2C next operation: separately authorize B1a only.** Do not begin it in Operation 2C. Final activation remains a separate gate. Stop uncommitted.

## Current B1h adoption and next gate

B1a-B1g now implement the corrected policy/protocol/build, nine-endpoint enforcement, canonical operator audit, CAS/readback/recovery, shared client lifecycle and release/Rules/preflight adapters. B1h updates only the twelve authorized documentation paths. Current domain guarantees are in [Teacher Units](TEACHER_UNITS.md); supported commands, credential profiles, initial unprepared policy behavior, closure/recovery and the live-enable interlock are in the [operator runbook](U2_6_RELEASE_READINESS_RUNBOOK.md#current-option-b-operator-and-release-workflow). The [integrated review handoff](MY_UNITS_OPTION_B_IMPLEMENTATION_BLUEPRINT.md#b1h-integrated-review-handoff) records the exact candidate hashes, batch traceability, focused evidence, limitations and substantive questions for Astra.

The original manifests were reconciled under explicit owner authorization: B1c 22 files, B1f 18, B1g 19 including the three B1e operator integration files. B1h remains twelve docs. Historical Ed25519/KMS/signature/revocation/registration machinery is retained for old inspection/replay; it is not an active request or B launch authority. The previous staging marker cannot authorize new B handlers. Existing general/Release 1 pairing, deployment scope, domain authorization, uncertainty and default denial remain required.

Only a current validated advisory display observation enables unit controls; every mutation still gets a fresh one-use permit and every backend operation rechecks authority. Only an actual committed/verified closed transition establishes the policy result; even that does not prove fleet shutdown. Enabled MAX_SAFE_INTEGER remains enabled until separately authorized closed-instance replacement commits and is verified.

Default app/backend artifacts remain closed. Explicit policy-capable compilation, a B receipt, or successful `checkEnable` grants no activation. Real enable is blocked in CLI/controller, including after a valid mocked preflight. A future independently reviewed, separately authorized implementation change must resolve that source interlock before any real enable can become operational. B1h does not make that change or supply an executable enable command.

**Next gate:** separately authorize one independent integrated Astra B2 security review tied to the exact local source/dependencies. This handoff is not the review. Actual effective IAM/impersonation, provider configuration/routes, deployed Rules/report/owner approval, paired served bytes, authenticated/accessibility staging acceptance, production closed deployment, activation and fleet verification remain external gates. Durable private evidence retention and exact operator/release identities still need concrete owner decisions. No cloud resources were accessed, and no commit, push, deployment or activation occurred in B1h.
