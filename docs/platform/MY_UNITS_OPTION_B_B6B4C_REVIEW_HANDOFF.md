# B6b-4C independent-review handoff

**DRAFT. Independent review pending. A0 remains unqualified; no deployment or activation authorized.**

Review [the checkpoint-contract proposal](MY_UNITS_OPTION_B_DEPLOYMENT_CHECKPOINT_CONTRACT.md), especially A's exact field/rejection table, E's two proven registry mapping errors, D/H's unresolved provider proof, and J's experiment prerequisites. Its A–J sections cover current requirement, security property, observations, missing evidence, proposal, fail-closed behavior, coverage, questions, scope and staging conditions.

The key decision is whether an additional supported evidence chain can establish exact source-generation consumption and Build output identity at the original assurance level. The existing successful Build, source labels/logs and Run buildInfo do not settle that decision. Do not accept qualification flags as evidence or combine the registry fix with an unreviewed provenance relaxation.

## Exact review surface — 10 new files

Select **only these 10 files** in GitHub Desktop for B6b-4C. All are new/untracked. No existing file was edited by this operation; the large preexisting dirty/untracked work belongs to earlier operations.

1. `docs/platform/MY_UNITS_OPTION_B_DEPLOYMENT_CHECKPOINT_CONTRACT.md`
2. `docs/platform/MY_UNITS_OPTION_B_B6B4C_REVIEW_HANDOFF.md`
3. `scripts/teacher-units-release/checkpoint-contract/run-tests.cjs`
4. `scripts/teacher-units-release/checkpoint-contract/test.cjs`
5. `scripts/teacher-units-release/checkpoint-contract/fixtures/manifest.json`
6. `scripts/teacher-units-release/checkpoint-contract/fixtures/function.json`
7. `scripts/teacher-units-release/checkpoint-contract/fixtures/service.json`
8. `scripts/teacher-units-release/checkpoint-contract/fixtures/revision.json`
9. `scripts/teacher-units-release/checkpoint-contract/fixtures/build.json`
10. `scripts/teacher-units-release/checkpoint-contract/fixtures/image.json`

The manifest pins original raw fixture bytes and the canonical read dependencies, including the unchanged packet validator/profile/boundary tests. Raw provider JSON is historical negative evidence, not invented acceptance metadata. Synthetic accepting controls in test.cjs are labeled and limited to individual local subchecks. The runner's local `/private/tmp` packet prerequisite is intentional; it refuses missing/changed dependencies and does not install/rebuild them.

Read-only references: production `scripts/teacher-units-release/option-b-observation.cjs` and its existing tests; canonical packet `/private/tmp/lyfelabz-b6b2-probe-20261026/`; blueprint I13/I15, trust model and B2/B3 boundaries; B6b-4/B6b-3R2 reports.

## Security invariants for the reviewer

- Explicit GEN2 on both Run representations; exact immutable desired/serving images and execution settings.
- Fixed reviewed source generation and exact Build/principal/output/image association; missing proof stays unresolved.
- Exact Function/service/revision/latest pointers, reconciled readiness and one untagged 100% serving target.
- Separate build destination and execution-image evidence; retain current buildConfig equality check until reviewed evidence warrants any change.
- Unchanged full nine-endpoint application/archive/Rules/configuration approval gates, target/build identity, policy authority and closed recovery.
- Reject ambiguous/inaccessible/partial/drifting evidence; retain raw bytes, original clocks, response status and source hashes.

## Focused verification

Run the pinned Node command in proposal G. The launcher first executes the unchanged canonical 13-case OS boundary suite, then only the new focused suite, sequentially with concurrency 1. No credential environment or cloud clients; Seatbelt denies external effects. Evidence is written by the trusted parent after child termination to a new private `/private/tmp/lyfelabz-b6b4c-tests-*` directory. No unsandboxed fallback.

Final verification: **13/13 boundary tests and 57/57 executed focused tests passed; 4 TODO declarations remain proposals**, not passing coverage. Concurrency was 1, with zero failures. [Raw TAP and integrity result](/private/tmp/lyfelabz-b6b4c-tests-OXHZ9R/result.json) and [complete TAP](/private/tmp/lyfelabz-b6b4c-tests-OXHZ9R/tests.tap) are retained outside the repository. The operation's external `REPORT.md` and `operation-files.json` record the complete dirty-worktree inventory. Existing production observer/canonical packet bytes match the operation baseline.

The first run found the observed-URI repeated-separator mismatch before the old resource-name assertion, and one over-specific test error pattern. The suite was corrected to isolate the two registry defects independently and match the actual existing rejection. Production/canonical code was not changed to satisfy either test.

## Required independent decision

Record reviewer identity, evidence hashes, decision reference, accepted invariants/residuals and every unresolved edge. Review the smallest package@digest plus observed-package grammar correction separately from any alternative Build provenance contract. Decide whether a replacement proves source consumption/output identity or requires more provider evidence. A report of green negatives alone is not approval.

Controlled staging questions remain explicit GEN2/digest pin acceptance, buildConfig persistence, Firebase overwrite/restore and automatic-update image relationships. A separate scoped authorization and fresh qualifying evidence are required before any experiment. Do not self-certify this handoff, enable an API, grant IAM, deploy, PATCH or activate My Units to resolve these questions.

**Leave uncommitted. Stop after reporting.**
