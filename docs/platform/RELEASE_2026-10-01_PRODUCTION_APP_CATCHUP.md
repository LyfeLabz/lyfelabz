# Release Record: October 1, 2026 Production App Catch-up

**Status:** Complete and certified. Release record (evidence), with the open human acceptance items listed in section 7.
**Current-state routing:** `CURRENT_PLATFORM_STATE.md` carries the summary; this record carries the release facts.

---

## 1. Release facts

| Surface | State |
| --- | --- |
| Source HEAD | `d2e3278a115973b01e0dd1138fc61b0656ea965c` ("Update Hosting build test for Water Cycle assessment renditions") |
| Production app Hosting (`app.lyfelabz.com`) | `2331d5a45fa23f9f` (previously `1fdb7d3ff3ead2aa`) |
| Staging Hosting | `b2b8ae72cccc5c8e` |
| Production marketing Hosting (`lyfelabz.com`) | `fa5173a7c8c6457f` - **intentionally NOT updated** |
| Functions | Unchanged. 70 deployed; latest relevant update remains 2026-09-29. |
| Firestore Rules | Unchanged (ruleset `626deb5b…`) |
| Storage Rules | Unchanged |

No Functions or Rules deployment occurred in this catch-up.

## 2. Release ordering (actual)

1. Production app Hosting first.
2. Wait beyond the cache-aging requirement.
3. Publish Water Cycle r2.
4. Verify Hosting and Firestore fidelity.

Hosting precedes the r2 data. Any earlier note that Water Cycle r2 data had to precede Hosting does not describe this release.

## 3. Water Cycle r2 (production, live through Firestore assessment publication)

Production Water Cycle is `assessment_water-cycle__r2`. Publication completed **2026-10-01T11:47:41Z**.

- Parent `currentRevisionId` = `assessment_water-cycle__r2`; ordinal 2.
- 10 assessment items and 10 answer-key entries; the r2 revision and answer key match the certified committed payload.
- r1 revision and answer key remain intact and unchanged.
- Served canonical, r1 and r2 pages are faithful to their respective assessment revisions.
- The revision table and the production bundle resolve r2 correctly.
- Water Cycle had 0 assignments at publication and is now safe to assign.
- Outstanding: the first real Water Cycle assignment must be observed to freeze r2 and score correctly (section 7).

## 4. Differentiated variant state

Staging successor coverage was rehearsed and certified:

| Variant | Presentation revision |
| --- | --- |
| Earth's Layers r1 | `pr7718b6fb29e40df7a338ea6896071229f232b884e9301f01c223181051071667` |
| Earth's Layers r2 | `pr8996a455b762c209c8a74c20954521cd93313df920923292aa334161560f6e11` |
| Conducting Experiments r1 | `pr7715ff14a5d647f518fffe2f8af8de8cfd843a2739a3a32172a14d5363465e5e` |

Staging differentiated-launch certification passed, with controlled student Reading Accessibility enabled:

- Earth's Layers r1, Earth's Layers r2 and Conducting Experiments r1 each resolved through `launchRef` to `pr7718…`, `pr8996…` and `pr7715…` respectively, with correct assessment and AP bindings.
- Each adapted assessment displayed 3 choices on all 10 items.
- Disabling Reading Accessibility restored canonical delivery.
- No student answers were submitted and no assignment revision changed.

Production:

- **Earth's Layers r1 coverage:** `pr7718…` with the existing r1 AP binding (`ap1fed…`).
- **Earth's Layers r2 coverage:** `pr8996…` with the existing r2 AP binding (`ap515838…`).
- Both repoints used the established explicit rollback/repoint mechanism and were verified by the shared evaluator. The prior presentations (`pr90f…`, `pr6b7c…`) and all historical variants remain retained and immutable.
- **Conducting Experiments production coverage is intentionally NOT published** (owner decision). `pr7715…` is hosted and retained and staging-certified, but CE differentiated delivery is **not** production-active.

## 5. Other changes released through app Hosting

Per git history (`deab657..d2e3278`). All are live through production app Hosting unless noted.

- Conducting Experiments written-response capture (`95dbc29`).
- Show Your Thinking presentation/rendering generalization (`8ad98cf`).
- Assign dialog Due date full-year display (`2fd886d`).
- Photosynthesis reference Quiz Results Polish (`3a74f28`) and rollout to the 45 ordinary lessons (`2c5634c`), together with the Water Cycle, Earth's Layers and Conducting Experiments special cases (`e3ee59c`): 49 configured quiz lessons in all.
- Water Cycle science corrections, diagrams and r2 assessment/renditions (`05a4b33`, `d5b1370`, `d2e3278`). Hosting carries the r2 renditions; the r2 assessment itself went live through Firestore publication (section 3).
- Earth's Layers r1/r2 successor reading-adapted presentations (`e3ee59c`): hosted, and active as differentiated coverage (section 4).
- Conducting Experiments successor presentation: hosted but production-inactive (section 4).
- Fossil Hunt corrections (`3048672`).
- Hosting build-test reconciliation (`d2e3278`) and `.DS_Store` untracking (`6bdb81b`); no runtime effect.

## 6. Marketing status

- `app.lyfelabz.com` is current through `d2e3278`.
- `lyfelabz.com` marketing/public Hosting was intentionally excluded and remains on `fa5173a7c8c6457f`.
- Marketing catch-up is a separate future certified release. Public V1 pages must not be described as current merely because their app-hosted copies are.

## 7. Human acceptance (open; post-release observations, not technical blockers)

1. A production teacher verifies the Assign dialog Due date field displays the complete four-digit year.
2. Real student devices verify Quiz Results Polish post-submit landing/scroll behavior.
3. The next real Conducting Experiments submission confirms Show Your Thinking appears in Teacher Workspace.
4. The first real Water Cycle assignment confirms it freezes r2 and scores correctly.

None is recorded as complete here; update this list only with evidence.
