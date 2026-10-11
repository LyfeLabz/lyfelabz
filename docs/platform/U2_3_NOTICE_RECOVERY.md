# U2.3 Notice Architecture Recovery

**Implemented and tested. Internally adversarially reviewed. Independently certified: NOT CERTIFIED.**

Date: 2026-10-11. No integration-readiness certification is asserted. The next step is fresh Claude Opus 5.5 certification of this uncommitted worktree.

## Source identity and isolation

| Reference | Verified value |
| --- | --- |
| Remote `main` and normal checkout HEAD | `2319d200bb39d8bf2ebd6b9939f0d85e889abec9` |
| Remote feature and isolated worktree HEAD | `b290a3bf2d408cf82ebcceaf124e2e6adf00fac5` |
| Feature branch | `feature/u2-3-resource-membership-ui` |
| Merge base | `2319d200bb39d8bf2ebd6b9939f0d85e889abec9` |
| Worktree | `/Users/breezy/.codex/worktrees/u23-notice-recovery/lyfelabz` |
| Starting feature inventory | 22 files against main |
| Starting worktree | Clean, isolated at verified feature HEAD |

`git ls-remote origin refs/heads/main refs/heads/feature/u2-3-resource-membership-ui` matched both expected SHAs. `git merge-base --is-ancestor` succeeded. The local feature branch was absent, so the managed isolated checkout was created at the exact SHA and attached to the feature branch. No normal-checkout working files were edited.

## Complete notice inventory

| Path | Classification | Retained data / reconciliation |
| --- | --- | --- |
| Create field validation and blocked/storage messages | Validation / instruction | Local field input and current coordinator state; recomputed each render |
| Create rejection/unresolved status and recovery error | Historical / uncertainty / instruction | Coordinator outcome, immutable payload; error normalizer contains a current authorization overclaim, presentation must override it without changing coordinator |
| Create confirmation and lastConfirmed announcement | Historical | Past creation and response title; no current membership assertion |
| Recovery in-flight / abandoned / expired / unreadable | Historical / instruction | Durable request identity/payload, check-required state; focus preserved by keyed controls |
| Check my units matching hints | Current accepted projection of a check scope | Controller checkedIds, highest accepted records, absent excluded; no independent cache |
| Former-school notices and shared status ownership | Historical / live count | Browser-scoped attempts and controller lifetime; no replay, no cross-school carryover; count changes alone announce |
| List loading/error/empty messages | Display / read error | Display list availability; normalized write-error text is inappropriate for read failures |
| Card editor local validation | Validation | Draft fields; editor survives refresh/filters |
| Pinned editor gone/archive restrictions | Current instruction | Card record/gone projection; early list returns can leave stale display. Refresh card evidence independently when unavailable |
| Picker empty/search/already-in-unit/eligibility | Validation | Current card record and RA-1; options rebuilt; title captured on open can become stale after rename |
| Picker closed by unavailable membership | Historical / live repair instruction | Existing contextual closure follows accepted unit; should split fixed closure cause from current repair |
| Retired repair count and explicit confirmation | Validation / instruction | Current card resource IDs, client registry; confirmation invalidated when count changes |
| Membership pending shared status | Historical action in progress | Per-request owner token; clears only owner, ignores stale results |
| Membership add/remove/repair confirmations and no-ops | Historical fact plus current membership | Current implementation freezes base sentence, updates only location suffix. Both status and durable confirmations affected |
| Edit/archive/restore saved and no-op announcements | Historical | Past operation, no present membership claim |
| Conflict notices (edit/add/remove/archive/restore) | Historical refusal plus latest accepted values / instruction | Base/min revision guard, editor-open state, accepted unit; refresh currently blocked by list readiness |
| Archived refusal notices | Historical refusal plus instruction | Captured editor-presence wording can outlive editor; editor presence must be evaluated when presented |
| Authorization refusal | Historical phase-unknown failure / instruction | Server code does not distinguish transaction refusal from post-commit read refusal; no claim of rejected write or current permission |
| Not-found refusal | Historical failure plus current presence | Positive accepted record permits found-again wording; error could be post-commit read, so do not claim nothing written |
| Placement/duplicate refusal | Historical definitive validation refusal plus current repair | Duplicate means repeated submitted IDs, not prior membership |
| Network/unexpected/invalid-request failure | Historical uncertainty or definitive refusal plus current next step | Raw normalizer includes unconditional refresh/retry; absent/archive context must control next step |
| Card-to-outcome transfer | Notice presentation / identity | One transfer of visible notice; stable durable operation id, independent dismiss/order; no rewriting operation facts |
| Durable entries, dismissal and eviction | Lifecycle / accessibility | Per-entry id, role alert/status, oldest confirmation eviction, focused dismiss moves to sibling or heading |
| School/teacher changes and disposal | Lifetime | Shell tears down panel/controller; asynchronous alive guard prevents prior context result reaching UI |

## Shared causes

Presentation strings combine operation history, snapshots, accepted state and next steps. Closure type permits unmarked fixed/current strings. Membership Outcome stores a preformatted base with present tense. refreshNotices uses display readiness as authority. Some raw normalized messages are write-specific or phase ambiguous. Filter location logic describes only the filtered list despite a pinned editor.

## Contract selected before implementation

A small typed notice descriptor stores an immutable historical sentence and an optional current-context presenter. One wordNotice function combines them. All retained card/status/outcome notices use it. Membership descriptors retain request-derived commit metadata and response/noop identity, then derive current membership on every render. No-op history says only that nothing changed; current contents are separately qualified. No second controller/cache/store. Context prioritizes accepted absence, distinguishes editor versus filtered list, and reports loading/error as display availability rather than authority. Rendering accepted card evidence while the display is unavailable prevents visible live validation contradicting notices. Semantic-equality guards prevent unchanged notice writes. Authorization failures preserve phase uncertainty; read-only failures and duplicate refusals get operation-specific presentation.

## Adversarial matrix selected before implementation

For each persistent category (confirmed write/noop add/remove/repair; edit/member conflict; archived refusal; authorization; notFound; placement/duplicate; uncertain; picker closed), exercise membership add/remove/re-add, partial/complete/new unavailable, title/description, archive/restore, absence, positive get/list/full check, unavailable display, later success, grade/context, reversed completion, multi-notice identity/dismissal/eviction. Existing fidelity/notices/lifecycle/outcomes/consistency suites supply the category matrix; new noticeContract tests target missing sequential transitions and unavailable-display evidence. Controller matrix and post-commit matrix preserve server/ordering behavior. Chromium combined sequence covers semantic text, AX, roles, stable nodes, keyboard focus, console and overflow at both required sizes.

Initial pre-implementation noticeContract results: 17 genuine assertion failures, 3 passing, 20 total. Initial unused-helper compilation failure was corrected and is excluded from behavioral evidence. Full failure details: /private/tmp/u23-recovery-before.log.


## Implementation

Production changes are confined to `app/src/shell/surfaces/teacherUnitsPanel.ts`:

- Replace bare strings/arbitrary notice formatters and the frozen `Located` outcome with a typed immutable historical sentence plus current contextual presenter. The common `wordNotice` renders card, status and durable notices.
- Consolidate add/remove/repair confirmation presentation. Capture request-derived counts/targets and established revision once; recompute current membership and superseding-state explanation each time. No-op facts no longer freeze present membership. Confirmed historical effects stay confirmed even if loaded contents cannot establish their current effect.
- Decouple notice reconciliation from display readiness. Reconcile at render and operation settlement; keep visible card validation/actions synchronized with accepted record/presence while loading or failed. Unknown/absent cards suppress stale controls; pinned editors retain drafts.
- Prioritize authoritative absence; qualify unknown state; distinguish pinned editors from grade-filtered lists; preserve historical titles and separately name accepted renames. An unchanged visible accepted card avoids loading/ready notice churn.
- Split fixed conflict/archive/placement/picker history from live values, editor presence and next steps. Update an open picker's accessible heading after a rename.
- Use phase-neutral authorization, read-specific list/check wording and accurate repeated-ID refusal. Create recovery remains coordinator-owned and receives creation-specific presentation.
- Avoid identical status/create-error/list-error DOM writes; retain durable notice ids, ordering, roles, per-entry dismissal, pending ownership and eviction focus policy.

No controller, wire, coordinator, RA-1 eligibility, server, Functions, Rules, assignment publisher, RA-3D, U2.4 or U3 source changes were made in this recovery. Tests compare the complete implementation diff against the starting feature HEAD, not against main's older controller.

Existing assertions in consistency, fidelity, lifecycle, notices, outcomes and recert suites were updated to the explicit historical/current wording. The post-commit oracle still checks actual committed operations and accepted membership; it distinguishes the historical addition sentence from the live missing-membership suffix instead of treating every historical "Added" as a present-state claim. No tests were removed or skipped.

## Behavioral reproductions and tests

A scratch source snapshot was extracted directly from `b290a3b` into `/private/tmp/u23-recovery-baseline`; only the new test file was added. Against that exact original application code, the final 31-test suite has **27 assertion failures and 4 passes**. All failures are behavioral assertions, not compiler failures, exceptions, timeouts or harness setup failures. The initial 20-test pre-implementation run had 17 failures and 3 passes. One unused-helper compilation error and one missing scratch `scripts` directory were corrected before obtaining behavioral evidence and are excluded.

The 31 tests cover sequential write/no-op add/remove/repair changes, re-add/removal, partial/complete repair and new unavailable memberships, post-commit supersession, title changes, archived/absent/restored durable entries, positive accepted evidence during loading/error, acceptance at settled notFound/conflict after list failure, stable identity and independent dismissal in both asynchronous orders, list/status semantic equality, duplicate and authorization language, three read-only error categories, pinned editors, picker renames, historical commits with inconsistent loaded contents, and retained no-ops followed by successful add/remove writes from the same panel.

Existing suites cover positive get/list/check, description changes, active-only omissions, archived restrictions, unknown reads, context transfer, multiple refusals, same-unit independent outcomes, eviction focus, former-school recovery and server authority. The seven controller scenarios enumerate four sets of 1,680 three-client interleavings and three sets of 140 two-client-plus-external interleavings: **7,140**. The post-commit suite asserts and executes all **280** permitted commit/read/external/refresh interleavings.

## Internal adversarial review

The second review inspected all panel notice construction, controller accepted-record/presence/list/re-read/mutation paths, normalized errors, coordinator recovery messages and shell lifetime handling. It attempted to falsify every invariant:

| Invariant | Evidence / correction |
| --- | --- |
| Immutable operation history | Fixed descriptor history; three new confirmed-effect regressions; removed obsolete known-commit-to-uncertain branch |
| Accepted current claims | Fresh context/presenters for all retained membership, conflict, refusal and validation notices |
| Qualified snapshots | Conflict min-revision guard and latest-loaded wording; historical titles separated from accepted renames |
| Context-valid instructions | Active/archive/absence/unknown/filter/loading/error and later-success tests; editor-presence evaluated live |
| Display is not authority | No readiness return in refreshNotices; accepted card synchronization and explicit settled-operation reconciliation |
| Stable operation identity | Existing id/order/dismissal/eviction policy unchanged; concurrent and combined-sequence tests |
| Server authority | No recovery changes in controller/server/Rules/eligibility; server and interleaving suites pass |
| No unnecessary announcements | Unchanged card/durable/status/list/create notice guards; MutationObserver regressions and Chromium zero-rewrite check |
| Accessibility | Existing alert/status semantics; accessible rename wording; native keyboard dismissal/focus; eviction regression suite |
| Bounded architecture | One panel-local typed descriptor/presenter; no independent state cache, store, event framework or mutation controller |

Additional gaps found and corrected during internal review: acceptance while display errors do not emit a list projection; repeated unchanged list-error alerts; picker title capture; the obsolete branch obscuring known commits, and unsupported attribution of later membership changes to "somewhere else". A newer revision establishes a change, not its author or location; live membership explanations now say only that the unit changed since the request. No known P0/P1/P2 notice-fidelity defects remain after this internal review. This finding is not independent certification.

The previously tracked card-level focus loss after external archive/restore remains the separate U2.5 prerequisite, as instructed. Authenticated staging behavior and deployed placement/version coordination are unverified. No remaining known P3 issue among the four notice-language findings is retained; broader U2.5 work was not undertaken.

## Chromium and accessibility evidence

The actual controller, attempt store, RA-1 adapter and panel were bundled with synthetic deferred callables, using the feature's real CSS in local headless Chromium. Both **1280x900** and **390x844** passed **19 checkpoints each**. Native keyboard activation was used for the grade filter and notice dismissal; actual clicks/fills were used for editor/picker controls. Initial harness notice-counting, disposed-DOM snapshot and stale-pending expectations were corrected; those harness failures and a mobile pointer-action timeout are excluded from behavioral evidence.

The combined sequence starts two simultaneous removals, accepts archived records, resolves no-ops in reverse order, repeatedly removes/re-adds memberships, restores and archives the units, fails the display refresh, accepts full-scope absence while the display is loading, fails its follow-up display, completes another unit's successful write, then dismisses all three independent notices by keyboard. Identity/order persist through rewording. Focus moves to the next Dismiss and finally the My Units heading. AX-tree static text reflects live membership and absence, confirmed entries have status semantics, refusal notices have alert semantics, console errors are zero, and horizontal overflow is absent at every checkpoint. Two unchanged refreshes cause zero mutations in operation notices/shared status. Additional browser cases cover authorization uncertainty, unavailable-display conflict values, pinned grade-filter editors, partial/complete repair, repeated-ID refusal and school-context disposal.

This is **synthetic-harness evidence**, not authenticated deployed-app verification. No staging or production requests were made.

## Verification results

| Check | Actual result |
| --- | --- |
| App esbuild | Pass |
| Complete app verify, `TZ=America/New_York` | 191 suites / 7,101 tests pass |
| Focused teacher-unit U2.2/U2.3 suites | 27 suites / 594 tests pass |
| New notice contract suite | 31 tests pass; original HEAD: 27 fail / 4 pass |
| Notice/fidelity/lifecycle/outcomes/consistency/recert/refusal suites | Included in focused and full passes |
| Controller interleavings | 7,140 pass |
| Post-commit interleavings | 280 pass |
| Functions hermetic teacher-unit suite | 1 suite / 51 tests pass |
| Functions local Firestore emulator suite | 1 suite / 190 tests pass; zero skipped |
| Rules local Firestore emulator suite | 1 suite / 27 tests pass; zero skipped |
| App typecheck and lint | Pass as part of complete verify |
| Functions typecheck and lint | Pass |
| Placement parity | Pass, plus 18 parity gate/wiring tests |
| Diff whitespace | Pass |
| Chromium | Both sizes; 38 total checkpoints; zero console errors/overflow/unchanged notice rewrites |

App verify also passed curriculum, lessons, variants and assessment quality checks. Firestore tests used isolated ports 8191/9191/4491/4591 and demo-only project `demo-bootstrap`; the emulator was shut down afterward. No production/staging or deployed Functions/Rules baseline was modified.

## Complete feature inventory against main

The starting 22-file feature inventory is preserved. With the two new files below, the final working feature inventory is **24 files**. Status is relative to main, including untracked intended files:

| Status | File |
| --- | --- |
| M | app/index.html |
| M | app/src/index.ts |
| M | app/src/shell/surfaces/curriculum.teacher-units.test.ts |
| A | app/src/shell/surfaces/teacherUnits.consistency.test.ts |
| A | app/src/shell/surfaces/teacherUnits.fidelity.test.ts |
| M | app/src/shell/surfaces/teacherUnits.formerSchool.test.ts |
| A | app/src/shell/surfaces/teacherUnits.lifecycle.test.ts |
| A | app/src/shell/surfaces/teacherUnits.noticeContract.test.ts |
| A | app/src/shell/surfaces/teacherUnits.notices.test.ts |
| A | app/src/shell/surfaces/teacherUnits.outcomes.test.ts |
| A | app/src/shell/surfaces/teacherUnits.recert.test.ts |
| A | app/src/shell/surfaces/teacherUnits.refusal.test.ts |
| A | app/src/shell/surfaces/teacherUnits.resources.test.ts |
| M | app/src/shell/surfaces/teacherUnitsPanel.ts |
| A | app/src/teacherUnits/unitsController.absence.test.ts |
| A | app/src/teacherUnits/unitsController.consistency.test.ts |
| A | app/src/teacherUnits/unitsController.fidelity.test.ts |
| A | app/src/teacherUnits/unitsController.matrix.test.ts |
| A | app/src/teacherUnits/unitsController.recert.test.ts |
| A | app/src/teacherUnits/unitsController.resources.test.ts |
| M | app/src/teacherUnits/unitsController.test.ts |
| M | app/src/teacherUnits/unitsController.ts |
| M | docs/platform/TEACHER_UNITS.md |
| A | docs/platform/U2_3_NOTICE_RECOVERY.md |

## Uncommitted recovery inventory and restrictions

Exactly **10 changed files**, all unstaged and uncommitted: panel; new noticeContract suite; six updated suites (consistency, fidelity, lifecycle, notices, outcomes, recert); canonical TEACHER_UNITS documentation; and this report. HEAD remains `b290a3b`. No stage, commit, push, merge, transfer to the normal checkout, integration, activation or deployment occurred. The managed worktree remains attached and available for subsequent diff review.

Main and the normal checkout remain clean at `2319d2`. `TEACHER_UNITS_GATE_OPEN = false` remains unchanged. The excluded `docs/platform/MULTILINGUAL_DELIVERY_ARCHITECTURE.md` and its `.git/info/exclude` entry were not modified. No staging, production, shared publisher, Functions or Rules changes occurred in this operation.

The separate activation prerequisites remain exact-release Functions/Rules certification, deployed placement-fingerprint coordination, cached-client mismatch handling, fail-closed mismatch behavior, U2.5 accessibility prerequisites, authenticated staging verification and explicit human authorization. Closed-gate integration is not activation. Neither is authorized by this report.

## Local evidence files

All evidence is retained locally, not published:

- `/private/tmp/u23-recovery-before.log`: initial pre-implementation behavioral failures.
- `/private/tmp/u23-recovery-before-final.log` and `.json`: exact-HEAD scratch run, 27/31 assertion failures.
- `/private/tmp/u23-recovery-focused.log` and `.json`: final 27-suite / 594-test teacher-unit run.
- `/private/tmp/u23-recovery-build.log`, `u23-recovery-verify-final.log`: final app build and complete verification.
- `/private/tmp/u23-recovery-functions.log` and `.json`, `u23-recovery-functions-type.log`, `u23-recovery-functions-lint.log`.
- `/private/tmp/u23-recovery-emulator.log`, `u23-recovery-functions-emulator.log` and `.json`, `u23-recovery-rules.log` and `.json`.
- `/private/tmp/u23-recovery-parity.log`, `u23-recovery-parity-tests.log`.
- `/private/tmp/u23-recovery-browser.cjs`, `u23-recovery-exports.ts`, `u23-recovery-bundle.js`, `u23-recovery-browser-final.log`: runnable synthetic browser harness and full checkpoint/AX evidence.

**STOP. Independent Claude Opus 5.5 certification is next. Independently certified: NOT CERTIFIED.**
