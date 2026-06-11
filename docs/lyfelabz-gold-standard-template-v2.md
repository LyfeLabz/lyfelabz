# LyfeLabz Gold Standard Template v2

**Date:** 2026-06-10
**Author:** Principal architect review (read-only audit of the full repo)
**Scope:** Defines the ideal structure for the five LyfeLabz page types - lessons, investigations, simulations, extensions, and games - derived from the strongest existing pages.
**Constraint:** Preserve the current LyfeLabz visual identity. Favor patterns that lift dozens of pages with small, repeatable edits. No giant rewrites.

This document is a specification, not a refactor. It names the patterns the best pages already use, fills the gaps those pages reveal, and gives every page type a single skeleton to converge toward.

---

## Part 1 - Rankings

Ranked strongest to weakest within each type. Ranking weighs: depth of the core interactive model, pedagogical loop (predict/test/compare/reflect), formative-assessment artifacts, classroom/practice mode support, standards integrity, and craft.

### Lessons

1. **lesson_nature-of-waves.html** - deepest lesson in the repo (5,322 lines). Full vocabulary system (word bank + inline vocab cards), animated wave model, driving question framing, staged sections.
2. **lesson_sun-earth-moon.html** - strong phenomenon framing, rich vocabulary, 10-question quiz, clean classroom/practice handling.
3. **lesson_body-systems.html** - broad standard coverage (6.MS-LS1-3), the one lesson with a checkpoint, strong submission flow.
4. **lesson_what-is-life.html** - clear phenomenon-to-concept arc, good vocabulary density.
5. **lesson_phases-of-the-moon.html** - heavy phenomenon and vocabulary use, live-logic flavor.
6. **lesson_continental-drift.html** / **lesson_layers-of-time.html** - solid phenomenon + vocabulary, geology pairing.
7. **lesson_wave-behavior.html** / **lesson_organelles.html** / **lesson_eclipses.html** / **lesson_cell-types.html** - complete but lighter on phenomenon or vocabulary.
8. **lesson_biological-evolution.html** - strong page, but spans Grade 6 (6.MS-LS4-1) and Grade 8 (8.MS-LS4-4) standards; needs grade labeling.
9. **lesson_ragebaiting.html** - well-built, but no MA STE alignment and no vocabulary system; weakest as a standards-aligned lesson.

### Investigations

1. **investigation_amplitude-challenge.html** - the model investigation. Phased structure, prediction cards, checkpoint cards with options/feedback/actions, progress steps, dense CER, submission. Every other investigation should look like this.
2. **investigation_cell-energy.html** - largest investigation (4,426 lines), heavy checkpoint and classroom-mode use.
3. **investigation_protein-pathway.html** - phased + checkpoints + submission; slightly thinner CER.
4. **investigation_gray-zone.html** - very high CER density and submission, but no checkpoint scaffolding - reads more like a long argument than a staged investigation.

### Simulations

1. **simulation_gravity-wells.html** - the model simulation. Practice/Classroom toggle with URL param, checkpoints, quiz, submission, mode hints.
2. **simulation_eclipse-alignment.html** - rich orbital model, checkpoints, quiz.
3. **simulation_floatlandia-fracture.html** - strong evidence-building scenario, heavy classroom-mode and submission use, but no checkpoints.
4. **simulation_beetle-island.html** - good natural-selection model and mode support, but no quiz, no checkpoints; also Grade 8 content (8.MS-LS4-4) shelved with Grade 6.

### Extensions

1. **extension_fossil-hunt.html** - the richest extension; quiz, classroom mode, submission - effectively a mini-lesson.
2. **extension_neuron-explorer.html** / **extension_virus.html** - quiz + classroom mode + submission; strong.
3. **extension_chernobyl-frogs.html** - classroom mode + submission, narrative-driven.
4. **extension_biological-evolution.html** - retrieval present, lighter interactivity, no submission.
5. **extension_body-systems.html** - no mode, no submission; thin.
6. **extension_moon-tonight.html** - clever real-moon hook but almost no structure (no quiz, no mode, no submission); weakest extension.

### Games

1. **game_photon-runner.html** - by far the most developed (10,061 lines), with a real predict/test/compare/reflect loop, dense checkpoint logic, Lab Notes export, leaderboard. Already audited at 8/10 classroom-ready.
2. **game_layer-detective.html** - quiz + classroom mode (19 hits) + heavy submission; the most classroom-integrated game.
3. **game_evolution-clicker.html** - polished, leaderboard-backed, but no classroom mode or formative export.
4. **game_cell-explorer.html** - content-rich, minimal assessment integration.
5. **game_exercise.html** / **game_relay.html** / **game_cellular-showdown.html** / **game_is-it-alive.html** - fun, on-topic, but no quiz, no mode toggle, no submission; pure activities.

---

## Part 2 - Strengths and Weaknesses

### What the strongest pages do right

- **A single driving/phenomenon hook up top.** The best lessons open with a `driving-question` block ("How can waves transfer energy without moving matter?") that frames everything below it. This is the essential-question pattern - it just is not named that yet.
- **A real pedagogical loop, not just content.** amplitude-challenge and photon-runner both run Predict -> Test -> Compare -> Reflect. The prediction is captured *before* the result, then compared. This is the single biggest differentiator between a strong and a weak page.
- **Checkpoint cards.** The investigations and top simulations use a consistent `checkpoint-card` / `checkpoint-options` / `checkpoint-feedback` / `checkpoint-actions` structure. It is reusable and already styled.
- **Practice vs. Classroom mode as a first-class concept.** gravity-wells is the reference implementation: a `mode-btn` toggle, `?mode=classroom` URL param, locked quiz/submission in practice, mode hints. This lets one page serve self-study and graded use.
- **Formative artifacts teachers can collect.** Submission to Google Apps Script and photon-runner's "Copy Lab Notes" export turn play into evidence with zero teacher prep.
- **A consistent vocabulary system in lessons.** nature-of-waves uses a word bank plus inline `vocab-*` cards with `data-tip` hover definitions - reusable across every lesson.
- **Disciplined visual language.** Shared color tokens, `section-label` / `section-title` / `section-desc` rhythm, hero floats. Pages feel like one product.

### Recurring weaknesses

- **No standardized learning goals or essential-question block.** Zero pages use an explicit "learning goal" or "essential question" label. The information often exists (as a driving question) but is not declared, so it cannot be surfaced consistently to teachers or students.
- **No note-card / retrieval layer.** No page uses note cards, and retrieval practice is sparse (most lessons have 1-3 incidental hits). Spaced retrieval is the cheapest high-yield addition available.
- **Checkpoints are concentrated in investigations.** Lessons almost never use the checkpoint pattern (only body-systems has one) even though the component already exists.
- **Practice/Classroom mode is missing from lessons and most games.** It lives in simulations and investigations but not in the 13 lessons or 6 of 8 games - the pages students spend the most time in.
- **Accessibility is the weakest dimension repo-wide.** Across all interactive pages: 0 use `alt=`, only 3 use `prefers-reduced-motion`, 4 use `:focus-visible`, 2 use `tabindex`. Touch support is incomplete (photon-runner is keyboard-only). This is a systemic gap, not a per-page one.
- **Standards integrity drift.** Mixed NGSS/MA codes and Grade 6/Grade 8 content shelved together (evolution lesson, beetle-island, evolution-clicker). A standards block with a single canonical code format would prevent recurrence.
- **Submission/quiz coverage is uneven in games and extensions.** Several games and extensions have no path to evidence at all.

---

## Part 3 - Gold Standard Principles

These hold across all five page types.

1. **One hook, stated once, at the top.** Every page opens with an essential question (lessons/extensions) or a phenomenon/scenario (investigations/simulations/games). Reuse the existing `driving-question` / `hero` styling - just add an explicit label.
2. **Declare the learning goals.** A short, visible "By the end you can..." list near the top, machine-readable via a `data-goal` attribute so the index and teacher tools can aggregate them.
3. **Run the loop.** Predict -> Test -> Compare -> Reflect wherever there is an interactive model. Capture the prediction before the result and show the comparison. This is mandatory for investigations, simulations, and games; encouraged for lessons.
4. **Checkpoint, do not lecture.** Break content with checkpoint cards (the existing component) roughly every major section. Each checkpoint gives immediate feedback.
5. **Retrieve, do not just present.** End each major section with one retrieval-practice prompt that pulls from earlier sections, not just the one just read.
6. **Two modes, one page.** Every assessable page supports Practice (everything unlocked, nothing recorded) and Classroom (`?mode=classroom`, quiz + submission unlocked), using the gravity-wells implementation verbatim.
7. **Produce an artifact.** Every assessable page can submit to the LyfeLabz Apps Script and/or export Lab Notes. No page should be a dead end for a teacher collecting evidence.
8. **Standards are typed, not prose.** One canonical MA code per badge (`data-standard="6.MS-PS4-1"`), grade-labeled, no mixing NGSS national codes inline.
9. **Accessible by default.** Keyboard operable, visible focus rings, `prefers-reduced-motion` honored, alt text on meaningful images, touch input where the page expects pointer input.
10. **Preserve the visual identity.** New structure reuses existing tokens and class names. No new design language.

---

## Part 4 - Complete Template Documents

Each template lists the required and optional sections in order, the existing class/attribute conventions to reuse, and where each required feature lives. Sections marked **[new]** are patterns not yet standard in the repo but buildable from existing components.

### Shared header block (all page types)

```
<nav>                          reuse nav-logo / nav-links / nav-back
<section class="hero">         reuse hero / hero-float / hero-badge / hero-sub
  <!-- Essential Question / Phenomenon -->
  class="driving-question"     existing; relabel dq-label per type:
                                 lessons/extensions -> "Essential Question"
                                 investigations/sims/games -> "Phenomenon"
  <!-- Learning goals [new] -->
  class="learning-goals"       list of data-goal="..." items, "By the end you can..."
  <!-- Standards [new, formalize] -->
  class="standards-row"        one badge per standard, data-standard="6.MS-XXX-n"
  <!-- Vocabulary -->
  class="word-bank" + vocab-*  reuse nature-of-waves pattern, data-tip definitions
```

### Lesson template

| Order | Section | Reuse / status |
|---|---|---|
| 1 | Header block (EQ + goals + standards + vocab) | shared, above |
| 2 | Phenomenon anchor | reuse phenomenon framing from sun-earth-moon |
| 3 | Concept sections (3-6) with `section-label/title/desc` | existing rhythm |
| 4 | Inline note cards **[new]** | small `note-card` callouts summarizing each section's takeaway, printable |
| 5 | Checkpoint after each concept section | reuse `checkpoint-card` from investigations |
| 6 | Retrieval prompt per section **[new]** | one cumulative question, pulls from earlier sections |
| 7 | Practice/Classroom toggle | reuse gravity-wells `mode-btn` + `?mode=classroom` |
| 8 | 10-question quiz | existing `quiz-section` pattern (eclipses) |
| 9 | Submission | existing Apps Script submit |
| 10 | Teacher support panel **[new]** | collapsible: standards, EQ, answer key, time estimate, mode instructions |

### Investigation template

| Order | Section | Reuse / status |
|---|---|---|
| 1 | Header block with **Phenomenon** label | shared |
| 2 | Progress steps | existing `progress-steps` / `progress-step active` |
| 3 | Phased sections `id="phase1..n"` | existing amplitude-challenge structure |
| 4 | Prediction card per phase | existing `prediction-card` (capture before result) |
| 5 | Interactive model | existing `phase-canvas-wrap` / `phase-controls` |
| 6 | Checkpoint card per phase | existing `checkpoint-card` + options/feedback/actions |
| 7 | CER block | existing claim/evidence/reasoning; keep amplitude-challenge density |
| 8 | Practice/Classroom toggle | reuse gravity-wells |
| 9 | Submission | existing |
| 10 | Teacher support panel **[new]** | per-phase look-fors, sample CER, common misconceptions |

### Simulation template

| Order | Section | Reuse / status |
|---|---|---|
| 1 | Header block with **Phenomenon** label | shared |
| 2 | Practice/Classroom toggle + mode hints | gravity-wells reference implementation |
| 3 | Interactive model with controls | existing |
| 4 | Predict -> Test -> Compare loop **[promote]** | make beetle-island-class sims add an explicit prediction step |
| 5 | Checkpoints during exploration | existing `checkpoint-card` (eclipse-alignment, gravity-wells) |
| 6 | Quiz (Classroom mode) | existing `quiz-section` |
| 7 | Submission | existing |
| 8 | Teacher support panel **[new]** | what to vary, expected outcomes, discussion prompts |

### Extension template

Extensions are lightweight enrichment, not full lessons. Minimum bar is raised so none is a dead end (moon-tonight is the cautionary case).

| Order | Section | Reuse / status |
|---|---|---|
| 1 | Header block with **Essential Question** | shared |
| 2 | Real-world hook | existing (moon-tonight live logic, chernobyl narrative) |
| 3 | 1-3 interactive or exploratory elements | existing |
| 4 | Retrieval prompt **[new, required]** | at least one |
| 5 | Short quiz OR reflection | reuse fossil-hunt/neuron-explorer pattern |
| 6 | Practice/Classroom toggle | reuse |
| 7 | Submission **[required]** | every extension must offer an artifact path |

### Game template

Games keep their play loop but gain a thin assessment layer so they are classroom-usable.

| Order | Section | Reuse / status |
|---|---|---|
| 1 | Header block with **Phenomenon** + learning goal | shared, condensed |
| 2 | Core game loop | existing |
| 3 | Embedded checkpoints / discovery moments | photon-runner reference |
| 4 | Predict/Compare beat where the mechanic teaches a model | photon-runner reference |
| 5 | Lab Notes export **[promote]** | photon-runner "Copy Lab Notes" pattern, generalize to all games |
| 6 | Practice/Classroom toggle | reuse (layer-detective already does this) |
| 7 | Leaderboard (optional) | existing Leaderboard_GScript.js |
| 8 | Submission | existing |
| 9 | Touch + keyboard input **[required]** | no keyboard-only games |

### Component conventions to standardize (already exist, just name them)

- `checkpoint-card` + `checkpoint-options` + `checkpoint-feedback` + `checkpoint-actions`
- `mode-btn` + `?mode=classroom` URL param + `modeHintPractice` / `modeHintClassroom`
- `quiz-section` + `quiz-mode-toggle` + `quiz-progress-sticky` + `quiz-submit-btn`
- `driving-question` (relabeled per type) + `word-bank` + inline `vocab-*` with `data-tip`
- New: `learning-goals` (`data-goal`), `note-card`, `standards-row` (`data-standard`), `teacher-panel`

---

## Part 5 - Future Roadmap

Ordered by leverage: each item lifts many pages with a small, repeatable edit. No giant rewrites.

### Phase 1 - Sitewide leverage (touch every page, tiny edits)

1. **Standards block normalization.** One canonical MA code per badge, grade-labeled, `data-standard`. Fixes the evolution Grade 6/8 drift and the NGSS/MA mixing across pages. Mechanical, high trust impact.
2. **Essential Question / Phenomenon label.** Relabel the existing `driving-question` block per page type. No new component.
3. **Learning goals block.** Add a 3-item `data-goal` list to every page header. Reuses hero styling.

### Phase 2 - Pedagogical loop parity

4. **Practice/Classroom mode into lessons and games.** Port the gravity-wells implementation to the 13 lessons and the 6 games that lack it. This is copy-adapt, not invent.
5. **Checkpoints into lessons.** Drop the existing `checkpoint-card` after each concept section in lessons (currently only body-systems has one).
6. **Retrieval prompts.** One cumulative retrieval question per major section, every page type. Highest learning-yield-per-line-of-code change available.

### Phase 3 - Evidence and teacher support

7. **Submission/Lab Notes parity.** Generalize photon-runner's Lab Notes export to all games; add submission to the extensions and games that have none (moon-tonight, body-systems extension, the four activity games).
8. **Teacher support panel.** Add a collapsible `teacher-panel` (standards, EQ, answer key, look-fors, time estimate, mode instructions) to every page. Single reusable component.
9. **Note cards.** Add printable `note-card` takeaways to lessons first, then extensions.

### Phase 4 - Accessibility hardening (systemic, currently weakest)

10. **Focus + keyboard.** Visible `:focus-visible` rings and full keyboard operability on every interactive control.
11. **Reduced motion.** `prefers-reduced-motion` guards on all animations (currently 3 pages).
12. **Touch parity.** Pointer/touch input for every game and simulation that assumes keyboard (photon-runner first).
13. **Alt text + roles.** Meaningful `alt` and `role` on diagrams and canvases (currently 0 pages use `alt`).

### Phase 5 - Coverage and coherence (from existing HQIM audit)

14. Build the missing MA Grade 6 units (Properties of Matter / Chemistry, Engineering/ETS, remaining waves PS4-2/PS4-3).
15. Publish a scope-and-sequence and standards coverage map so the collection reads as a curriculum, not standalone pages.

---

### One-line summary

The repo already contains every component the gold standard needs - checkpoints, mode toggles, quizzes, submission, vocabulary, the predict/test/compare/reflect loop. The work is not invention; it is **distribution**: take the patterns proven in amplitude-challenge, gravity-wells, nature-of-waves, and photon-runner, name them, and spread them across the pages that lack them - starting with standards normalization, mode parity, retrieval, and accessibility.
