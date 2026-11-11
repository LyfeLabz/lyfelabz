# Teacher Units Option B - Completion Record

**Status:** COMPLETE. Option B (My Units trusted-operator availability) is deployed, enabled in production, independently security reviewed and operationally ready. No further Option B implementation or deployment is required.

**Completion date:** November 11, 2026 (America/New_York).

**Decision basis:** the B2 independent security review (PASS) and the production operational readiness verification (PASS), both dated November 11, 2026, together with the October 30, 2026 production release record. This record reconciles that evidence. It does not perform or authorize any deployment, policy transition, IAM change or test change.

---

## 1. Completion decision

Option B is complete. Every closure criterion is supported by existing evidence:

| Criterion | Evidence | Result |
|---|---|---|
| Deployed from a clean exact commit and enabled under server policy | Production release 2026-10-30 ([release record](RELEASE_2026-10-30_STUDENT_SUPPORT_V2.md)); B2 section 2 | Met |
| Independent security review of the deployed implementation | B2 report | PASS |
| All 13 ADR guarantees satisfied | B2 section 3 | 13 of 13 PASS |
| No unresolved Critical or High security findings | B2 section 4 | None found above LOW |
| Emergency close can be started by an authorized operator today | Operational readiness report | PASS |
| Retained compatible closed-only recovery reference | Operational readiness section 6 | Verified |
| Residual risks and deferred items recorded | Sections 9 and 10 below | Recorded |

## 2. Original Option B scope

Option B replaced the signed-evidence activation design with a trusted-operator availability policy ([ADR](ADR_MY_UNITS_OPTION_B_TRUSTED_OPERATOR_AVAILABILITY.md), [implementation blueprint](MY_UNITS_OPTION_B_IMPLEMENTATION_BLUEPRINT.md)):

- One server-only schema-2 policy at `platformConfig/teacherUnitsAvailability`, read uncached inside every Teacher Units management transaction.
- Nine callable endpoints (`teacherUnitsArchive`, `teacherUnitsCapabilities`, `teacherUnitsCreate`, `teacherUnitsGet`, `teacherUnitsList`, `teacherUnitsReorder`, `teacherUnitsRestore`, `teacherUnitsSetResources`, `teacherUnitsUpdate`) enforcing canonical teacher authorization, tenant isolation and actual build/placement agreement.
- A shared client capability lifecycle (v3 protocol) for My Units and Curriculum.
- An audited operator CLI with exact compare-and-set, atomic policy/history/audit writes, emergency close and closed-instance recovery.
- Batches B1a-B1g (implementation) and B1h (documentation), followed by the E2 simplified release workflow, which superseded the B1h real-enable interlock ([E2 workflow](U2_6_RELEASE_READINESS_RUNBOOK.md#e2-simplified-release-and-operator-workflow)).

Domain contract: [Teacher Units](TEACHER_UNITS.md).

## 3. Deployed backend and policy identity

Observed read-only on November 11, 2026 (B2 and operational readiness).

| Item | Value |
|---|---|
| Project | `lyfelabz-prod` |
| Backend source | `3cbfdcf621bb1912c9f3188cbef8696e1b644593` (534 of 534 deployed source files byte-identical) |
| Backend build | `5700f199e1c42a06...` (`policy-controlled`, clean) |
| Policy | `enabled`, schema 2, `teacher-units-option-b-v1`, generation 6, contract `[teacher-units-v3]` |
| Policy instance | `19592fb6-...` (enabled 2026-10-30T18:17:24Z) |
| Placement fingerprint | `ad477c4c0213...` |
| Production Functions | 92, all active; 9 Teacher Units endpoints at revision `-00002-*`, 100% traffic |
| Firestore Rules | byte-identical to `3cbfdcf` |
| Hosting at review time | release `39d4722` (ledger CURRENT) |
| `origin/main` at review time | `d695db0` |

Production policy history has six contiguous transitions: initialize (1), prepare (2, build `b4b04435`), enable (3), close (4), prepare (5, build `5700f199`), enable (6). Each links an atomic canonical audit event.

## 4. The 13 guarantees

From the ADR section "Essential requirements retained". All 13 PASS in B2 section 3.

1. Authentication and canonical active-teacher authorization; no teacher privilege inherited from an admin role.
2. Teacher/school/district isolation; server-derived immutable ownership; uniform not-found.
3. Transactional authorization revalidation on every SDK retry, replay and no-op.
4. Callable-only units and receipts; default-deny policy, history and audit from all clients.
5. Closed bounded schemas, canonical resource validation, placement parity.
6. Revision concurrency; atomic reorder and membership; same-record archive/restore.
7. School-bound create idempotency with the original `expectedSchoolId` and unchanged receipt/hash identity.
8. Atomic domain audits; no duplicate mutation or audit from replay or no-op.
9. Honest uncertain outcomes; no automatic resend; authoritative reconciliation.
10. Server availability check on every management read, write and post-commit response read; cached clients cannot bypass closure.
11. Agreement of actual backend build, client contract, policy instance/generation and placement.
12. Separation from assignment authority, student access, scoring, grades, answer keys and completion definitions.
13. Clean exact-commit deployment, provider observations, scoped surfaces and a known-good closed rollback.

## 5. B2 independent security review: PASS

- Evidence (private, outside the repository): `/Users/breezy/Documents/LyfeLabz-Certification/teacher-units-option-b-b2-review-3cbfdcf/B2_INDEPENDENT_SECURITY_REVIEW.md`
- All 13 guarantees PASS. No confirmed vulnerabilities. No Critical, High or Medium findings.
- 1,609 focused tests passed, run locally and sequentially: Functions unit 615, Functions emulator 198, Rules emulator 270, operator unit/CLI 102, operator emulator 24, app client 400.
- Production checks were read-only. No teacher credential was used and no live callable was invoked, so real teacher sessions were not exercised during B2.

**Findings count correction.** The B2 executive summary says "2 LOW and 4 INFORMATIONAL". The findings list itself contains **3 LOW** (F-01, F-02, F-04) and **4 INFORMATIONAL** (F-03, F-05, F-06, F-07), seven findings in total. The accurate count is 3 LOW and 4 INFORMATIONAL. The private report is left unchanged as historical evidence; this record is the reconciled count.

| ID | Severity | Summary | Disposition |
|---|---|---|---|
| F-01 | LOW | Functions run as the default compute service account, which holds project `roles/editor` | Accepted residual risk (section 9) |
| F-02 | LOW | No `platformAdministrator` refusal test | Deferred, nonblocking (section 10) |
| F-03 | INFO | Per-attempt artifact inventory cost contributes to cold starts | Deferred to existing backlog item |
| F-04 | LOW | Stale canonical status text | Resolved by this documentation update |
| F-05 | INFO | E2 removed the B1h interlock without a separate review | Covered by B2's review of the active enable path; no defect |
| F-06 | INFO | Old `-00001-*` revisions retained at 0% traffic | No action; they would be refused by policy |
| F-07 | INFO | Local operator tooling said to differ from `origin/main` | **Corrected** (below) |

**F-07 correction.** B2 reported that local operator tooling differed from `origin/main` (gcloud impersonation additions). The operational readiness verification found `availability-control.cjs` and `availability-cas.cjs` byte-identical between the local checkout and `origin/main`, with the impersonation commit already present locally; it also ran the `operator-impersonation` tests B2 had not run. The F-07 observation is therefore superseded as inaccurate. Its recommendation (run the operator CLI from an up-to-date `origin/main` checkout) remains good practice. The original finding stays in the B2 report as historical evidence.

## 6. Operational readiness verification: PASS

- Evidence (private, outside the repository): `/Users/breezy/Documents/LyfeLabz-Certification/teacher-units-option-b-ops-readiness-3cbfdcf/OPERATIONAL_READINESS_REPORT.md`
- 142 operator tests passed (118 unit/CLI including `operator-impersonation`, 24 emulator).
- Live production policy verified: enabled, generation 6, build `5700f199...`, placement `ad477c4c...`.
- All six history/audit transitions reconciled with `availability verify` against their original plans, with equal history/audit storage update times (atomic commit). No unexpected transition since the October 30 enable.
- Closed-only rollback archive verified by SHA-256, source identity and canonical closed-only inspection.

## 7. Emergency-close readiness

- An emergency close dry run against production passed every gate, including the write-permission check, with `persistence: not-performed`. Production was unchanged afterward.
- **The close was not executed.** No production close occurred during the readiness review. Real end-to-end close evidence comes from the October 30 production close (generation 4), the October 30 staging shutdown rehearsal and emulator tests.
- Executing a close requires the owner's explicit emergency authorization, a fresh dry-run plan and its exact confirmation digest within 10 minutes ([E2 operator commands](U2_6_RELEASE_READINESS_RUNBOOK.md#e2-simplified-release-and-operator-workflow)).
- Emergency close depends on the owner's gcloud login (`--gcloud-impersonation`), network access, Python 3.11 for gcloud and an up-to-date checkout with Functions dependencies.
- Post-close route verification is manual; no CLI command performs it.

## 8. Rollback and recovery limitations

**Closed-only rollback archive.** `closed-only-rollback-3cbfdcf.zip` (build `4b45e591...`, SHA-256 `e4558b59...`, named in the October 30 release record) is a verified **reference artifact, not a deploy input**. It cannot be deployed directly with `firebase deploy`, because Functions predeploy rebuilds from source. The documented recovery is: a clean checkout of `3cbfdcf`, `npm ci`, default build profile (`A3_BUILD_PROFILE` unset), a `firebase deploy --only` scoped to the nine `functions:teacherUnits*` entries with `--project lyfelabz-prod`, then confirm the rebuilt build ID is `4b45e591...` and compare against the archive. This rebuild route **has not been rehearsed** against production; it requires separate explicit recovery authorization.

**Hosting rollback.** The October 30 release record names the Hosting pair `d9b48607ebb7505d` / `29bc0af1a32171dd` as its rollback. That pair is stale: several Hosting-only releases have followed. Do not use it. The [production release ledger](PRODUCTION_RELEASE_LEDGER.md) is the authority for the applicable `SAFE` pair. At the time of this record the verified SAFE rollback pair (for current release `39d4722`) is app `d4bba4e4dea405b7`, marketing `20a9e1c22c0ab5e2`. Always re-check the ledger before any rollback. Backend closure does not require a Hosting rollback, and a Hosting rollback alone cannot disable server access.

**Re-enable after a close.** Closing is cheap; re-opening is deliberate. A production `enable` after any close requires fresh current-release evidence (certified receipt, preparation and review within 24 hours, Hosting observation within 5 minutes, matching staging acceptance, compatible rollback block), a new dry-run plan and confirmation, and an explicit named owner decision. The October 30 release evidence has expired and cannot be reused. These are the existing E2 requirements, not new gates.

## 9. Accepted residual risks

1. **Broad runtime service account (B2 F-01).** All Functions, including the nine Teacher Units endpoints, run as the default compute service account with project `roles/editor`. A code-execution or token flaw in any Function could rewrite policy, units, history or audits. Accepted under the ADR trust boundary and the release record's `iamScopeAccepted: true`. **IAM is not changed by Option B closure.** Least-privilege runtime identities would be a separately authorized IAM operation.
2. **Broad pinned operator identity.** The App Engine default service account used by the operator also holds `roles/editor`; accepted in the operator access review.
3. **Trusted writers.** Admin database writers, deployers and privileged runtime identities can bypass enforcement. History and audit are not tamper-proof against them. No second human approver.
4. **Closure limits.** Closure cannot recall data already returned or writes already committed. A close may be unconfirmable during a Firestore outage; recovery is the closed-only rebuild in section 8.
5. **Enabled generation at `MAX_SAFE_INTEGER`** requires separately authorized `recoverClosed`.
6. **Create receipts expire after 7 days**; reusing a key after that creates a new unit.
7. **Owner gcloud login dependency** for emergency close (section 7).

## 10. Explicitly deferred improvements (nonblocking)

- [ ] **F-02:** add `platformAdministrator` refusal regression tests for the Teacher Units entry points. Static evidence already satisfies guarantee 1. Separately authorized test-only change.
- [ ] **F-01:** decide whether to scope least-privilege runtime identities for Functions, or continue explicit acceptance. Separate IAM operation.
- [ ] **F-03:** artifact inventory latency stays in the existing [backlog](ENGINEERING_BACKLOG.md) item "P1 - My Units cold-start reliability". Any caching must preserve the no-positive-availability-cache rule and be separately reviewed.
- [ ] Optional: rehearse the closed-only rebuild route in staging.
- [ ] Optional: periodically run the read-only operator `show` to confirm emergency-close readiness.

## 11. No further Option B work required

No further Option B implementation, certification, deployment or activation is required. The items in section 10 are independent improvements, not completion gates. Any future change to Teacher Units runtime, policy or endpoints is a new, separately authorized release under the E2 workflow.

## 12. Scope boundary

This record closes Option B only. It does not certify or close unrelated LyfeLabz work, including Hosting-only releases, curriculum and assessment revisions (for example Physical Properties), Student Support, classroom performance work, navigation and other platform projects. Their status lives in [CURRENT_PLATFORM_STATE.md](CURRENT_PLATFORM_STATE.md) and the [production release ledger](PRODUCTION_RELEASE_LEDGER.md).
