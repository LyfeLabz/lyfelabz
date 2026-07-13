# LyfeLabz Distribution Plan v1

**Date:** 2026-06-10
**Source of truth:** docs/lyfelabz-gold-standard-template-v2.md
**Component standards:** docs/components/
**Principle:** Distribute strengths that already exist. No invention, no rewrites. Safe, repeatable Claude Code micropasses.

---

## 1. Component Inventory

| Component | Gold-standard reference | Supporting pages | Pattern / class names |
|---|---|---|---|
| Essential Question | lesson_nature-of-waves.html | sun-earth-moon, phases-of-the-moon, all 13 lessons (as "Driving Question") | `driving-question` + `dq-label`; relabel per type |
| Learning Goals | none yet ([new]) | - | `learning-goals` + `data-goal` (defined in docs/components/learning-goals.md) |
| Phenomenon Hook | lesson_sun-earth-moon.html | phases-of-the-moon, continental-drift, layers-of-time, moon-tonight, chernobyl-frogs | hero phenomenon framing; `driving-question` relabeled "Phenomenon" |
| Vocabulary System | lesson_nature-of-waves.html | phases-of-the-moon, sun-earth-moon, eclipses, continental-drift (inline `data-tip` only; word-bank exists only in nature-of-waves) | `word-bank` + `vocab-*` + `data-tip` |
| Checkpoint Cards | investigation_amplitude-challenge.html | cell-energy, protein-pathway, gravity-wells, eclipse-alignment, body-systems (lesson), photon-runner | `checkpoint-card/-options/-feedback/-actions` |
| Prediction Cycle | investigation_amplitude-challenge.html | photon-runner, beetle-island, gray-zone, exercise, chernobyl-frogs | `prediction-card`, capture-before-result |
| Retrieval Practice | (no dedicated canonical example) | incidental 1-3 hits in most lessons | reuse checkpoint-card markup, "Quick Recall" label |
| Reflection | lesson_what-is-life.html | cell-types, wave-behavior, ragebaiting, gray-zone (via CER) | section + textarea into submission |
| Quiz Architecture | lesson_sun-earth-moon.html | all 13 lessons, eclipse-alignment, fossil-hunt, virus, neuron-explorer, layer-detective, all 8 system_ pages | `quiz-section`, `quiz-mode-toggle`, `quiz-progress-sticky`, `quiz-submit-btn` |
| Practice/Classroom Mode | simulation_gravity-wells.html | all lessons (quiz-level), all sims, all investigations, layer-detective, cell-explorer, evolution-clicker, fossil-hunt, virus, neuron-explorer, chernobyl-frogs | `mode-btn`, `?mode=classroom`, `modeHintPractice/Classroom` |
| Submission System | investigation_protein-pathway.html | 30 pages POST to LyfeLabz_GScript.js | Apps Script endpoint + submit card |
| Teacher Artifacts | game_photon-runner.html | layer-detective (submission-heavy) | Lab Notes export (photon-runner), `teacher-panel` [new] |
| Note Cards | none yet ([new]) | - | `note-card` (defined in docs/components/note-card.md) |
| Progress Indicators | investigation_amplitude-challenge.html | all 4 investigations, all 4 simulations, chernobyl-frogs | `progress-steps` / `progress-step active` |
| CER | investigation_amplitude-challenge.html | gray-zone (densest), protein-pathway | claim/evidence/reasoning blocks |
| Interactive Simulations | gravity-wells, photon-runner | every sim/investigation/game | `phase-canvas-wrap` / `phase-controls` |
| Accessibility | investigation_amplitude-challenge.html | protein-pathway, eclipse-alignment, gray-zone (partial) | `:focus-visible`, `prefers-reduced-motion`, `tabindex` |
| Leaderboard | game_photon-runner.html | evolution-clicker; backend Leaderboard_GScript.js | shared GScript |

## 2. Gap Matrix

Legend: Y = present, p = partial/weak, - = missing. Columns: EQ (driving question present, needs relabel), LG (learning goals), Std (standards badge), Voc (vocab system), Phen, Pred, Chk (checkpoints), Ret (retrieval), Refl, Quiz, Sub (submission), Mode (practice/classroom), TA (teacher artifact), A11y.

| Page | EQ | LG | Std | Voc | Phen | Pred | Chk | Ret | Refl | Quiz | Sub | Mode | TA | A11y |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lesson_nature-of-waves | Y | - | p | Y | p | Y | - | p | p | Y | Y | Y | - | - |
| lesson_sun-earth-moon | Y | - | p | Y | Y | p | - | p | Y | Y | Y | Y | - | - |
| lesson_body-systems | Y | - | p | p | - | p | Y | p | p | Y | Y | Y | - | - |
| lesson_what-is-life | Y | - | p | p | - | - | - | p | Y | Y | Y | Y | - | - |
| lesson_phases-of-the-moon | Y | - | p | Y | Y | - | - | p | Y | Y | Y | Y | - | - |
| lesson_continental-drift | Y | - | p | Y | Y | p | - | p | p | Y | Y | Y | - | - |
| lesson_layers-of-time | Y | - | p | Y | Y | p | - | p | p | Y | Y | Y | - | - |
| lesson_eclipses | Y | - | p | Y | p | - | - | p | p | Y | Y | Y | - | - |
| lesson_wave-behavior | Y | - | p | - | p | - | - | p | Y | Y | Y | Y | - | - |
| lesson_organelles | Y | - | p | - | p | - | - | p | p | Y | Y | Y | - | - |
| lesson_cell-types | Y | - | p | - | - | - | - | p | Y | Y | Y | Y | - | - |
| lesson_biological-evolution | Y | - | p (Gr6/8 drift) | Y | Y | - | - | p | p | Y | Y | Y | - | - |
| lesson_ragebaiting | Y | - | - (no MA STE) | - | - | - | - | - | Y | Y | Y | Y | - | - |
| investigation_amplitude-challenge | p | - | p | - | p | Y | Y | p | Y | Y | Y | Y | - | p |
| investigation_cell-energy | - | - | p | - | p | - | Y | - | p | Y | Y | Y | - | - |
| investigation_protein-pathway | - | - | p | - | - | - | Y | p | p | Y | Y | Y | - | p |
| investigation_gray-zone | - | - | p | - | - | Y | - | - | Y (CER) | Y | Y | Y | - | p |
| simulation_gravity-wells | - | - | p | p | p | - | Y | p | p | Y | Y | Y (reference) | - | - |
| simulation_eclipse-alignment | Y | - | p | - | - | - | Y | - | p | Y | Y | Y | - | p |
| simulation_floatlandia-fracture | - | - | p | - | - | - | - | - | p | Y | Y | Y | - | p |
| simulation_beetle-island | - | - | p (Gr8 shelf) | - | - | Y | - | - | p | - | Y | Y | - | - |
| extension_fossil-hunt | - | - | p | - | - | - | - | - | p | Y | Y | Y | - | - |
| extension_neuron-explorer | - | - | p | - | - | - | - | p | p | Y | Y | Y | - | - |
| extension_virus | - | - | p | - | - | - | - | - | p | Y | Y | Y | - | - |
| extension_chernobyl-frogs | - | - | - | - | - | Y | - | - | Y | - | Y | Y | - | - |
| extension_body-systems | - | - | p | - | - | - | - | - | - | - | - | - | - | - |
| extension_moon-tonight | - | - | - | - | Y (hook) | - | - | - | - | - | - | - | - | - |
| game_photon-runner | - | - | p | - | p | Y | Y | p | Y | p | Y | p | Y (Lab Notes) | - (kbd-only) |
| game_layer-detective | - | - | p | - | - | - | - | - | p | Y | Y | Y | p | - |
| game_evolution-clicker | - | - | p | - | - | p | - | - | p | - | Y | p | - | p |
| game_cell-explorer | - | - | p | - | - | - | - | p | p | p | - | p | - | - |
| game_exercise | - | - | p | - | - | Y | - | - | p | p | - | - | - | - |
| game_relay | - | - | p | - | - | - | - | p | p | - | - | - | - | - |
| game_cellular-showdown | - | - | p | - | - | - | - | p | p | - | - | - | - | - |
| game_is-it-alive | - | - | p | - | - | - | - | - | p | - | - | - | - | - |

**Reading the matrix:**
- Strengths fully distributed: quizzes (lessons), submission (30 pages), mode toggles (28 pages), progress steps (all phased pages).
- Universal gaps (whole columns): Learning Goals (0 pages), Teacher Panels (0), Note Cards (0), systematic retrieval (near 0), accessibility floor (4 partial).
- Concentrated gaps: checkpoints missing from 12 of 13 lessons; prediction cycles missing from most sims; the dead-end set with no evidence path: moon-tonight, body-systems extension, exercise, relay, cellular-showdown, is-it-alive.

## 3. Phase A - Highest Educational Impact

Ranked by educational value x ease.

### A1. Essential Question / Phenomenon relabel (all 36 pages)
- **Goal:** Every page opens with an explicitly labeled EQ (lessons/extensions) or Phenomenon (investigations/sims/games).
- **Why:** The content already exists as `driving-question`; naming it makes it teachable and aggregatable. Near-zero risk.
- **Reference:** nature-of-waves, sun-earth-moon; docs/components/essential-question.md, phenomenon-hook.md.
- **Files:** all lesson/investigation/simulation/extension/game pages.
- **Difficulty:** trivial where the block exists (13 lessons); small where it must be added (most non-lessons).
- **Micropass size:** 3-5 pages per pass (relabel), 1-2 pages per pass (add block).
- **Verify:** label text correct per type; no CSS changes; question is a real question.
- **Stop if:** a page has no hero block to host it, or the question cannot be written without inventing content.

### A2. Learning Goals block (all 36 pages)
- **Goal:** `learning-goals` list with `data-goal` items in every hero.
- **Why:** Zero pages declare goals; teachers cannot see what a page teaches without reading it all.
- **Reference:** docs/components/learning-goals.md; derive goals from each page's existing quiz/checkpoints.
- **Difficulty:** low. **Micropass:** 3-5 pages. 
- **Verify:** 1-3 goals, observable verbs, matches what the page assesses.
- **Stop if:** goals cannot be grounded in existing assessments (flag the page instead).

### A3. Standards normalization
- **Goal:** One canonical MA code per badge, `data-standard="6.MS-XXX-n"`, grade-labeled; fix evolution Gr6/8 drift and beetle-island/evolution-clicker shelving; flag ragebaiting as unaligned.
- **Why:** Trust and curriculum integrity; mechanical.
- **Reference:** gold standard Part 3 #8; docs/grade6-standards-alignment-audit-v2.md.
- **Micropass:** 3-5 pages. **Verify:** codes match the MA STE audit doc. **Stop if:** correct code is ambiguous - flag, do not guess.

### A4. Retrieval practice (lessons + extensions first)
- **Goal:** One cumulative "Quick Recall" prompt per major section, reusing checkpoint-card markup.
- **Why:** Highest learning-yield-per-line-of-code change available; component already exists.
- **Reference:** docs/components/retrieval-practice.md; amplitude-challenge markup.
- **Micropass:** 1 page (1-3 prompts). **Verify:** question pulls from an EARLIER section; feedback works; visual identity unchanged. **Stop if:** the page has only one section.

### A5. Accessibility floor, pass-by-pass
- **Goal:** `:focus-visible` rings, `prefers-reduced-motion` guards, `aria-live` feedback, alt/aria on diagrams - copied from amplitude-challenge.
- **Why:** Weakest dimension repo-wide; each fix is mechanical and benefits every student.
- **Micropass:** one pass TYPE on one page (focus pass, motion pass, alt pass, touch pass).
- **Verify:** keyboard walk-through; reduced-motion emulation; no visual change for default users.
- **Stop if:** a fix requires restructuring an interactive (defer to Phase B/C, log it).

## 4. Phase B - Medium Impact

1. **Checkpoints into lessons** - port `checkpoint-card` after each concept section of the 12 lessons lacking one (body-systems proves it works). Micropass: one lesson.
2. **Prediction cycles into simulations** - explicit predict step for beetle-island-class sims and floatlandia; compare step everywhere a model runs.
3. **Mode + submission for the dead-end set** - moon-tonight, body-systems extension, exercise, relay, cellular-showdown, is-it-alive: add gravity-wells mode JS + fossil-hunt submission card. One page per pass.
4. **Reflection sections** - one EQ-callback reflection per lesson/investigation, wired into submission.
5. **Lab Notes export for games** - generalize photon-runner's export to layer-detective, evolution-clicker, cell-explorer, then the activity games.
6. **Quiz parity** - short quizzes for beetle-island, chernobyl-frogs, evolution-clicker (or reflection where lighter weight fits).

## 5. Phase C - Low Impact (nice-to-have)

1. **Note cards in lessons** - printable `note-card` takeaways (new component, defined and ready).
2. **Teacher panels everywhere** - collapsible `teacher-panel` (answer key, look-fors, time estimate); start lessons, then all types.
3. **Word banks beyond nature-of-waves** - lessons already rich in inline vocab gain the word-bank header.
4. **Progress steps in multi-stage extensions** - small polish.
5. **Touch parity beyond photon-runner** - remaining pointer-assuming interactions.

## 6. Component Reference Table

| Component | Gold Standard Page | Why |
|---|---|---|
| Essential Question | lesson_nature-of-waves.html | The original `driving-question` block; question frames the whole 5,322-line lesson |
| Learning Goals | none - build per docs/components/learning-goals.md, styled on nature-of-waves hero | No page has the component yet |
| Phenomenon Hook | lesson_sun-earth-moon.html | Strongest phenomenon framing; the lesson keeps returning to it |
| Vocabulary System | lesson_nature-of-waves.html | Only page with word-bank + inline `vocab-*` + `data-tip`, 35 vocab touches |
| Checkpoint Cards | investigation_amplitude-challenge.html | Full four-class structure (options/feedback/actions) with reveal logic |
| Prediction Cycle | investigation_amplitude-challenge.html | Prediction captured before result, compared after, per phase |
| Retrieval Practice | (no dedicated canonical example); markup source: amplitude-challenge | Retrieval is the thinnest existing pattern |
| Reflection | lesson_what-is-life.html | Cleanest phenomenon-to-concept arc ending in student explanation |
| Quiz Architecture | lesson_sun-earth-moon.html | 10 questions, clean practice/classroom handling, full class-name set |
| Practice/Classroom Mode | simulation_gravity-wells.html | Reference implementation: URL param, mode hints, gated submission |
| Submission System | investigation_protein-pathway.html | Phased work flowing into the shared Apps Script cleanly |
| Teacher Artifact | game_photon-runner.html | Lab Notes export + densest classroom-readiness work (8/10 audit) |
| Note Cards | none - build per docs/components/note-card.md | Component does not exist yet |
| Progress Indicators | investigation_amplitude-challenge.html | `progress-steps` pattern all other phased pages copied |
| Accessibility | investigation_amplitude-challenge.html | Only page combining focus-visible, reduced-motion, and tabindex |

## 7. Future Systems (identify only - do not build now)

Ranked by long-term value:

1. **Accessibility framework** - one shared CSS/JS include (focus rings, reduced-motion, aria-live helpers). Highest value: every page, every student.
2. **Shared CSS variables** - the visual tokens already behave like a system; extracting them prevents drift as 36 pages get edited.
3. **Answer keys / teacher panel generator** - once `data-standard`, `data-goal`, and quizzes are typed, panels can be generated rather than hand-written.
4. **Shared JavaScript utilities** - mode handling, submission POST, checkpoint reveal: three small functions currently copy-pasted ~30 times.
5. **Teacher dashboard** - reads the existing Apps Script sheet; becomes valuable once submission parity (Phase B3) lands.
6. **Classroom analytics** - aggregate checkpoint/quiz data; only after dashboard.
7. **Leaderboards standardization** - Leaderboard_GScript.js already serves two games; generalize only when a third game wants it.
8. **Shared visual language doc** - codify rather than change; lowest urgency because the identity is already consistent in practice.

## 8. Six-Month Roadmap (Distribution Phase)

**Month 1 - High-leverage distribution.** Phase A1-A3 across all 36 pages: EQ/Phenomenon labels, learning goals, standards normalization. ~10-12 micropasses of 3-5 pages. End state: every page declares what it teaches.

**Month 2 - Accessibility and standards.** Phase A5 pass types across the top-traffic pages first (13 lessons, 4 sims, photon-runner touch input). Adopt the rule: every later micropass leaves touched markup at the accessibility floor. Finish any standards stragglers.

**Month 3 - Assessment and teacher support.** Phase A4 retrieval prompts (lessons + extensions), Phase B1 checkpoints into lessons, Phase B4 reflections wired to submission. Start teacher panels on the 5 strongest lessons.

**Month 4 - Games and extensions.** Phase B3 dead-end set gets mode + submission; Phase B5 Lab Notes export generalized; photon-runner touch parity completed; short quizzes where missing (B6).

**Month 5 - Cross-unit consistency.** Phase B2 prediction cycles into sims; vocabulary word-banks distributed to remaining lessons; progress steps polish; sweep the matrix and close stragglers so every column is Y or an intentional -.

**Month 6 - Platform maturity.** Phase C: note cards, teacher panels everywhere, extract the shared accessibility include and the three shared JS utilities (the only "system" work, and it is extraction, not invention). Re-run the gap matrix and publish v2.

**Rules for every micropass:** one component x one page (or one mechanical edit x 3-5 pages); copy the gold-standard markup verbatim; no CSS redesign; verify in browser before closing; stop and flag rather than invent.

---

## Recommended next Fable prompt

> You are executing the LyfeLabz Distribution Phase. Read docs/lyfelabz-gold-standard-template-v2.md, docs/lyfelabz-distribution-plan-v1.md, and docs/components/essential-question.md + learning-goals.md + phenomenon-hook.md. Execute Phase A1+A2 as one micropass on exactly these five pages: lesson_nature-of-waves.html, lesson_sun-earth-moon.html, lesson_phases-of-the-moon.html, lesson_what-is-life.html, lesson_eclipses.html. For each: (1) change the dq-label text to "Essential Question"; (2) add a learning-goals block with 3 data-goal items derived from that page's existing quiz questions, styled with existing hero tokens (define the small CSS once and copy it verbatim). Do not change any other markup, CSS, or JS. No em dashes anywhere. Verify each page renders unchanged except the new block, then stop and report a checklist.
