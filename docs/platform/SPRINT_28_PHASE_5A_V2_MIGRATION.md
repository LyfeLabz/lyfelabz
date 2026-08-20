# Sprint 28 Phase 5A - Assignable Curriculum v2 Migration

Status: COMPLETE. All 49 assignable lessons are on the hardened v2 contract.
Phase 5A migrated 44 of the 45 Category B lessons and deferred nature-of-waves;
the follow-up Phase 5A.1 (recorded in §12) safely unblocked and migrated
nature-of-waves, bringing the final total to 45 migrated / 0 deferred / 49 v2.
This is the durable evidence record for the Phase 5A frontend/platform
contract migration. It authors no answer keys (Phase 5B), deploys nothing,
and changes no manifest. HEAD unchanged; nothing staged, committed, or pushed.

Style: no em dashes. Use " - " (spaced hyphen) as the sentence break.

---

## 1. Objective and result

Migrate the 45 Category B assignable lessons (audit
`SPRINT_28_CURRICULUM_MIGRATION_AUDIT.md`) onto the hardened v2
assignment-aware contract already carried by the four Category A lessons
(earths-layers, plate-tectonics, water-cycle, earthquakes), using the
deterministic lesson build system.

Result (Phase 5A): **44 of 45 migrated. 1 deferred (nature-of-waves).**
Final result after Phase 5A.1 (§12): **45 of 45 migrated. 0 deferred. 49 v2.**

The migration is a platform-contract migration, not a curriculum rewrite.
Instructional content is preserved and machine-enforced by the
instructional-equivalence contract (v1 vs v2 of the same canonical source)
and by the v1-preservation check (each root v1 gains only the GENERATED
notice and the shared runtime wiring; no instructional line removed).

## 2. Migration totals

| Quantity | Count |
|---|---|
| Total assignable (surfaceable) lessons | 49 |
| Already v2 before Phase 5A (Category A) | 4 |
| Category B migration target | 45 |
| Migrated in Phase 5A | 44 |
| Migrated in Phase 5A.1 (nature-of-waves, §12) | 1 |
| Deferred (final) | 0 |
| Final v2 total (launch-overridden) | 49 |

The audit projected 45 migrated / 0 blocked. Phase 5A migrated 44 and
produced one evidence-backed deferral, nature-of-waves (§6), which Phase 5A.1
(§12) then resolved without weakening the marker scanner. Every one of the 45
Category B lessons is now migrated; all 49 assignable lessons launch v2.

## 3. The canonical transformation applied

Each migrated lesson received exactly the earths-layers/Phase 3 transformation,
applied deterministically to its own canonical source (extracted from the
committed root v1 artifact). It is parameterised per lesson by the local
prefix, grade (teacher set + grade number + resourceId), and endpoint token.

**Three SHARED runtime wiring points** (present in both v1 and v2 output):

1. `window.lyfelabz.lessonQuiz.autosave(<prefix>QuizState.selected)` on answer
   selection (inside `<prefix>SelectAnswer`).
2. `var <prefix>Assigned = window.lyfelabz.lessonQuiz.hasAssignmentContext();`
   at the top of `<prefix>SubmitQuiz`.
3. the assignment-context block
   `if (<prefix>Assigned) { finalize(selected) -> "Submitted to your teacher" / error; return; }`.
   The runtime re-scores from the deployed answer key; local scoring is kept
   for student-facing feedback.

**V1-ONLY marker regions** wrap the legacy classroom apparatus so it survives
only in the public v1 output: `legacy-mode-toggle-markup`,
`legacy-student-info-markup`, `legacy-classroom-styles`,
`legacy-student-info-styles`, `legacy-classroom-touchtarget`, `legacy-endpoint`,
`legacy-mode-state`, `legacy-set-quiz-mode`, `legacy-mode-init-iife`,
`legacy-validate-student-info`, `legacy-classroom-validation-guard`,
`legacy-practice-completion`, `legacy-apps-script-submit`, `o2-results-region-v1`,
and (on the 3 lessons that have it) `legacy-classroom-localstorage`.

**V2-ONLY marker regions** carry the hardened W2 results standard:
`platform-standalone-completion`, `o2-results-style` (`.score-board`
`scroll-margin-top: 120px` / `104px` phone, `.score-board:focus { outline:
none; }`), `o2-results-region-v2` (`tabindex="-1" role="status"
aria-live="polite"`), `o2-results-focus` (`sb.focus({ preventScroll: true })`
after the existing `scrollIntoView`), `o3-return-style`, `o3-return-markup`
(`<a class="return-assignments" id="back-to-assignments" href="/app/">Back to
My Assignments</a>`), and `o3-return-reveal` (the single assignment-gated
`<prefix>ReturnCtl.classList.add('show')`).

Note on marker grammar vs the earths-layers pilot: the pilot wrapped the
classroom CSS as one contiguous `legacy-classroom-styles` block. Several
Category B lessons order the mode-toggle CSS and the student-info CSS
non-contiguously, so Phase 5A wraps them as two regions,
`legacy-classroom-styles` (mode-toggle) and `legacy-student-info-styles`
(student-info). Three lessons (gravity, sun-earth-moon,
earths-place-in-the-universe) carry an extra legacy localStorage `<script>`
that persists the student-info fields; that whole block is wrapped as
`legacy-classroom-localstorage`. No instructional content is wrapped.

Return navigation: assignment-context v2 completion reveals `Back to My
Assignments` pointing at the fixed in-product path `/app/`. It exposes no
assignmentId and does not re-enter the deep-link resolver. In v2 practice /
standalone the control stays hidden; in v1 it never exists.

Practice behaviour: non-assignment v2 use keeps the exploration-mode message
and never submits. v1 preservation: the legacy Practice/Classroom apparatus
survives only in the v1 output via the V1-ONLY regions.

## 4. Batch execution

All migrated lessons pass the same deterministic gates: `lessons:build` +
`lessons:verify` (deterministic rebuild), the marker scanner, the config
signature checks (v1-required present, v2-prohibited absent, shared present in
both), the instructional-equivalence contract, the W2 results contract test,
an inline-script JS syntax check, and the v1-preservation diff check. The
migration is grouped below by curriculum narrative for review; the gates ran
across all lessons.

- Batch 1 - Grade 6 Life Science (5): what-is-life, cell-types, organelles,
  body-systems, biological-evolution.
- Batch 2 - Grade 6 Earth & Space (7): layers-of-time, continental-drift,
  gravity, sun-earth-moon, phases-of-the-moon, eclipses,
  earths-place-in-the-universe.
- Batch 3 - Grade 6 Physical Science (6): measuring-matter,
  physical-properties, pure-substances-and-mixtures, chemical-reactions,
  wave-behavior, digital-signals. (nature-of-waves deferred, see §6.)
- Batch 4 - Grade 6 Tech & Engineering (4): conducting-experiments,
  engineering-design, choosing-materials, designing-to-scale.
- Batch 5 - Grade 7 Earth & Space (4): types-of-volcanoes, hotspot-volcanoes,
  weathering-and-erosion, renewable-and-nonrenewable-resources.
- Batch 6 - Grade 7 Life Science (7): parts-of-an-ecosystem, photosynthesis,
  energy-flow, carbon-cycle, ecosystem-stability, reproductive-success,
  human-impacts.
- Batch 7 - Grade 7 Physical Science (4): forms-of-energy, energy-transfer,
  heat-transfer, introduction-to-electricity.
- Batch 8 - Grade 7 Tech & Engineering (7): design-tradeoffs,
  structural-systems, transportation-systems, communication-systems,
  engineering-systems, technology-and-society, innovation-and-sustainability.

Every gate is green for all 44. `lessons:verify` reports OK for all 48
configured lessons (the 44 plus the 4 Category A). The W2 contract test covers
all 48 (528 assertions) and passes.

## 5. Per-lesson record (44 migrated)

Prefix = the lesson's local JS prefix. LS = carries the legacy localStorage
block. All 44 use the standard single-choice assessment architecture and
passed build, marker, signature, equivalence, W2-contract, syntax, and
v1-preservation checks.

| # | Slug | Prefix | Grade | LS | Disposition |
|---|---|---|---|---|---|
| 1 | biological-evolution | be | 6 | - | migrated |
| 2 | body-systems | bs | 6 | - | migrated |
| 3 | cell-types | ct | 6 | - | migrated |
| 4 | chemical-reactions | cr | 6 | - | migrated |
| 5 | choosing-materials | cm | 6 | - | migrated |
| 6 | conducting-experiments | ce | 6 | - | migrated |
| 7 | continental-drift | cd | 6 | - | migrated |
| 8 | designing-to-scale | cm | 6 | - | migrated |
| 9 | digital-signals | ds | 6 | - | migrated |
| 10 | earths-place-in-the-universe | epu | 6 | yes | migrated |
| 11 | eclipses | ec | 6 | - | migrated |
| 12 | engineering-design | ed | 6 | - | migrated |
| 13 | gravity | grav | 6 | yes | migrated |
| 14 | layers-of-time | lt | 6 | - | migrated |
| 15 | measuring-matter | mm | 6 | - | migrated |
| 16 | organelles | og | 6 | - | migrated |
| 17 | phases-of-the-moon | pm | 6 | - | migrated |
| 18 | physical-properties | pp | 6 | - | migrated |
| 19 | pure-substances-and-mixtures | psm | 6 | - | migrated |
| 20 | sun-earth-moon | sem | 6 | yes | migrated |
| 21 | wave-behavior | wb | 6 | - | migrated |
| 22 | what-is-life | wl | 6 | - | migrated |
| 23 | carbon-cycle | el | 7 | - | migrated |
| 24 | communication-systems | el | 7 | - | migrated |
| 25 | design-tradeoffs | el | 7 | - | migrated |
| 26 | ecosystem-stability | el | 7 | - | migrated |
| 27 | energy-flow | el | 7 | - | migrated |
| 28 | energy-transfer | et | 7 | - | migrated |
| 29 | engineering-systems | el | 7 | - | migrated |
| 30 | forms-of-energy | fe | 7 | - | migrated |
| 31 | heat-transfer | ht | 7 | - | migrated |
| 32 | hotspot-volcanoes | el | 7 | - | migrated |
| 33 | human-impacts | el | 7 | - | migrated |
| 34 | innovation-and-sustainability | el | 7 | - | migrated |
| 35 | introduction-to-electricity | el | 7 | - | migrated |
| 36 | parts-of-an-ecosystem | el | 7 | - | migrated |
| 37 | photosynthesis | el | 7 | - | migrated |
| 38 | renewable-and-nonrenewable-resources | el | 7 | - | migrated |
| 39 | reproductive-success | rs | 7 | - | migrated |
| 40 | structural-systems | el | 7 | - | migrated |
| 41 | technology-and-society | el | 7 | - | migrated |
| 42 | transportation-systems | el | 7 | - | migrated |
| 43 | types-of-volcanoes | vc | 7 | - | migrated |
| 44 | weathering-and-erosion | el | 7 | - | migrated |

## 6. Deferred lesson in Phase 5A (nature-of-waves) - RESOLVED in Phase 5A.1

This section preserves the original Phase 5A deferral record. The lesson was
subsequently unblocked and migrated in Phase 5A.1; see §12 for the resolution.

**nature-of-waves** (Grade 6 Physical Science, prefix `nw`). Deferred in
Phase 5A, not migrated at that time.

Reason: the lesson's quiz includes diagram questions whose `visual:` field is
a template-literal string containing SVG authoring comments
(`<!-- A: crest -->`, `<!-- B: resting line -->`, and similar) inside the quiz
`<script>` block. The lesson-build marker scanner categorically rejects any
HTML-style comment inside a `<script>` (or `<style>`), so the canonical source
cannot pass `lessons:build`. This is a pre-existing property of the lesson's
diagram markup, unrelated to the migration mechanism.

The scanner is intentionally not weakened (that guarantee protects every
lesson). Unblocking nature-of-waves requires editing the diagram source (for
example converting those inline SVG comments), which is a content edit outside
the Phase 5A platform-contract scope. It is recorded here for a follow-up.
nature-of-waves remains fully functional on v1: its root artifact and public
URL are untouched, and the launcher continues to serve it from `/lesson_
nature-of-waves.html`.

## 7. Answer keys are not Phase 5A

No `<slug>.r1.json` answer-key payload was authored, no assessment revision was
deployed, and no publication guard was changed. A migrated lesson is v2-ready
in code but is not production-publishable until Phase 5B authors its answer key
and Sprint 29 deploys it. This is expected and planned.

## 8. Launch overrides

`app/src/assignments/studentList/launchOverrides.ts` now lists all 49 v2
lessons (4 Category A + 44 Phase 5A + nature-of-waves from Phase 5A.1). Each
entry routes `/app/lessons/lesson_<slug>.html`. `launchOverrides.test.ts`
asserts the exact 49-slug set and that every path is an absolute in-site
`/lesson_<slug>.html`. (Historical note: through Phase 5A this table held 48
slugs, with nature-of-waves intentionally absent; Phase 5A.1 added the 49th.)

Note: adding a slug here makes it the assignment launch target. The lesson is
v2-ready and assignment-aware, but end-to-end classroom submission still
requires its answer key (Phase 5B) and its deployed assessment (Sprint 29).

## 9. Test coverage (Phase 5A snapshot; §12 carries the post-5A.1 counts)

- `app/scripts/lessonBuilder/__tests__/w2-results-contract.test.js` -
  rewritten data-driven over `W2_V2_LESSONS` (48 entries at Phase 5A, each
  `{slug, prefix}`); 528 assertions; all pass. (Phase 5A.1 appended
  nature-of-waves: 49 entries, 539 assertions.)
- `app/src/assignments/studentList/launchOverrides.test.ts` - updated to the
  48-slug set; passes.
- `app/src/assignments/studentList/launch.test.ts` and
  `app/src/router/surfaces/surfaces.test.ts` - repointed the v1-path example
  slugs (previously what-is-life / cell-types, now migrated) to nature-of-waves
  and to the v2 paths as appropriate; pass.

## 10. Validation summary (Phase 5A snapshot; §12 carries the post-5A.1 run)

- `lessons:build`: all 48 rebuilt.
- `lessons:verify`: OK for all 48 (committed artifacts equal a fresh build).
- Marker scanner, config signature checks, instructional-equivalence contract:
  pass for all 48. No new `equivalenceExclusions` beyond the standard per-lesson
  student-info interactiveIds and the `student-info-box` scroll target.
- W2 results contract: 528/528 pass.
- Inline-script JS syntax check (both targets, every lesson): clean.
- v1 preservation: for each of the 44, the git diff of the root artifact vs
  pre-migration HEAD contains only the GENERATED notice and the three shared
  wiring points; no instructional line removed; no v2-only control leaked into
  v1. The four Category A root v1 artifacts are byte-unchanged.
- App typecheck: clean. App lint: clean.
- Full app suite: 67 suites, 1629 tests, 1628 passed, 1 failed. The single
  failure is the pre-existing `curriculumManifest.test.ts` SHA drift (the
  cosmetic `#how` line on index.html), unchanged and Sprint 29-owned. index.html
  was not touched by Phase 5A.

## 11. External state

No production Firebase mutation, no Google/Classroom call, no OAuth change, no
deployment, no assessment revision deployed, no manifest regeneration. Nothing
staged, committed, or pushed.

## 12. Phase 5A.1 - nature-of-waves migration unblock

Objective: resolve the single bounded source incompatibility that deferred
nature-of-waves in Phase 5A, without weakening the deterministic builder
safety contract, then migrate the lesson onto the same hardened v2 contract as
the other 48. Result: **COMPLETE. 49 assignable lessons, 49 v2, 0 blockers.**

### The incompatibility and the fix

nature-of-waves had two quiz diagram questions (Q5 crest/trough, Q9
amplitude comparison) whose `visual:` field is an SVG string inside a
`<script>` template literal. Those SVG strings contained six authoring-only
HTML comments:

| # | Comment | Question | Location |
|---|---|---|---|
| 1 | `<!-- A: crest -->` | Q5 | Q5 `visual` template literal |
| 2 | `<!-- B: resting line -->` | Q5 | Q5 `visual` template literal |
| 3 | `<!-- C: trough -->` | Q5 | Q5 `visual` template literal |
| 4 | `<!-- D: midway -->` | Q5 | Q5 `visual` template literal |
| 5 | `<!-- Wave X (small amplitude) -->` | Q9 | Q9 `visual` template literal |
| 6 | `<!-- Wave Y (large amplitude, same wavelength) -->` | Q9 | Q9 `visual` template literal |

A deterministic scan of every `<script>`/`<style>` block in the lesson found
exactly these six HTML comments and no others inside any script or style
context. All six are classified **safe authoring-only**: they annotate which
SVG `<circle>`/`<g>` each block draws; each labeled point already has a visible
`<text>` label (A/B/C/D) and the `<svg>` carries a full `aria-label`. No JS
reads comment nodes (there is no `nodeType`/`childNodes`/`COMMENT_NODE` use),
no CSS references them, no DOM logic depends on them, they carry no
instructional/scientific content beyond what the visible labels and aria-label
already convey, and because SVG/HTML comment nodes never render, removing them
does not change rendered output or assessment semantics.

The fix removed only those six comments from the canonical source. The marker
scanner was NOT modified, no scanner exception or exclusion was added, no
marker validation was bypassed, and no comment was escaped or disguised. The
source became structurally compatible on its own.

### Fidelity evidence

The git diff of the regenerated root v1 artifact vs pre-migration HEAD contains
only: the GENERATED notice, the six removed comment lines, and the three shared
runtime wiring points (autosave, the `nwAssigned` hasAssignmentContext var, and
the assignment-context finalize block). The two `visual` SVG bodies are
otherwise byte-identical: no change to geometry, coordinates, paths, `<circle>`
positions, the A/B/C/D `<text>` labels, the `<svg>` aria-label, question text,
options, correct indices, explanations, or scoring. Both generated artifacts
(v1 and v2) contain zero HTML comments inside any `<script>`/`<style>` block.
The instructional-equivalence contract (v1 vs v2) passes with no new exclusion
types; because the comment removal is applied to the single canonical source it
affects v1 and v2 identically and creates no v1-vs-v2 asymmetry.

### The v2 contract applied

The exact Phase 3 / Phase 5A transformation, parameterised for prefix `nw`,
Grade 6 (`mr-brown` / `ms-gay`), and `resourceId: lesson_nature-of-waves`:
the three SHARED runtime wiring points; the V1-ONLY legacy classroom regions
(`legacy-mode-toggle-markup`, `legacy-student-info-markup`,
`legacy-classroom-styles`, `legacy-student-info-styles`,
`legacy-classroom-touchtarget`, `legacy-endpoint`, `legacy-mode-state`,
`legacy-set-quiz-mode`, `legacy-mode-init-iife`, `legacy-validate-student-info`,
`legacy-classroom-validation-guard`, `legacy-practice-completion`,
`legacy-apps-script-submit`, `o2-results-region-v1`); and the V2-ONLY W2
hardening (`o2-results-style`, `o2-results-region-v2`, `o2-results-focus`,
`o3-return-style`, `o3-return-markup`, `o3-return-reveal`,
`platform-standalone-completion`). nature-of-waves has no legacy localStorage
block, so `legacy-classroom-localstorage` is not used.

### Final migration totals (after Phase 5A.1)

| Quantity | Count |
|---|---|
| Total assignable (surfaceable) lessons | 49 |
| Pre-existing v2 (Category A) | 4 |
| Migrated (Phase 5A: 44 + Phase 5A.1: 1) | 45 |
| Deferred | 0 |
| Final v2 total (launch-overridden) | 49 |

### Validation (Phase 5A.1 run)

- `lessons:build --only=nature-of-waves`: both targets built.
- `lessons:verify`: OK for all 49 configured lessons (committed artifacts equal
  a fresh build).
- Marker scanner, config signature checks, instructional-equivalence contract:
  pass for nature-of-waves with no new exclusion types (its exclusions are the
  standard v1-only student-info interactiveIds and the `student-info-box`
  scroll target).
- W2 results contract: `W2_V2_LESSONS` is now 49 entries; 539 assertions pass
  (49 x 11).
- `launchOverrides.ts` lists 49 slugs; `launchOverrides.test.ts` asserts the
  49-slug set. `launch.test.ts` and `deepLink/arrival.test.ts` repoint their
  v1-fallback example off nature-of-waves (now v2) onto the gated, non-surfaced
  `ragebaiting` slug, which stays on the v1 path.
- App typecheck: clean. App lint: clean.
- Full app suite: 67 suites, 1640 tests, 1639 passed, 1 failed. The single
  failure is the same pre-existing `curriculumManifest.test.ts` `#how` SHA
  drift, Sprint 29-owned; index.html and the manifest were not touched.
  Functions and Rules suites were not re-run (no Functions/Rules code changed).

### Files changed in Phase 5A.1

- `lesson-sources/lesson_nature-of-waves.html` (new canonical source).
- `app/scripts/lessonBuilder/lessons/nature-of-waves.cjs` (new builder config).
- `app/lessons/lesson_nature-of-waves.html` (new v2 artifact) and
  `lesson_nature-of-waves.html` (regenerated root v1), both from
  `lessons:build`.
- `app/scripts/lessonBuilder/__tests__/w2-results-contract.test.js`,
  `app/src/assignments/studentList/launchOverrides.ts` and its test,
  `app/src/assignments/studentList/launch.test.ts`,
  `app/src/assignments/deepLink/arrival.test.ts` (nature-of-waves added to the
  v2 sets; v1-fallback examples repointed).
- `docs/platform/SPRINT_28_PHASE_5A_V2_MIGRATION.md` (this section) and
  `docs/platform/SPRINT_28_IMPLEMENTATION_PLAN.md` (Phase 5A.1 record).

No answer key authored, no assessment deployed, no manifest regenerated, no
Assignment Detail / onboarding / OAuth / Google / Functions / Rules change, no
production Firebase mutation, no deployment. Nothing staged, committed, or
pushed. HEAD unchanged.
