# Life Science Games & Extensions Audit

**Date:** 2026-05-31  
**Auditor:** Claude Code (read-only pass, no files edited)  
**Benchmark pages:** `lesson_what-is-life.html`, `investigation_amplitude-challenge.html`, `investigation_cell-energy.html`, `simulation_eclipse-alignment.html`

---

## Executive Summary

**15 pages audited**: 9 games + 6 Life Science extensions (extension_moon-tonight.html is Earth & Space Science and is excluded from Life Science scope).

**Strongest pages:** `game_cell-explorer.html`, `game_relay.html`, `extension_body-systems.html`, `game_fossil-hunt.html`, `game_layer-detective.html`. These come closest to current LyfeLabz quality on interaction depth, visual design, and pedagogical structure.

**Weakest pages:** `extension_virus.html`, `extension_organelles.html`, `extension_gray-zone.html`. These are Gen 1 pages with old nav patterns, the obsolete "Biology Review Lab" title format in two cases, and no LS/STEM toggle support. `extension_virus.html` is also substantially redundant with `extension_gray-zone.html`.

**Improve first:** Fix the malformed CSS bug shared by `game_is-it-alive.html`, `game_cellular-showdown.html`, and `extension_neuron-explorer.html` (a nested selector inside `.page-hero {}` that browsers interpret incorrectly). This is a low-effort, high-impact fix that appears in three visible student-facing pages.

**Merge candidate:** `extension_virus.html` → absorb its best content into `extension_gray-zone.html`, then remove from index.

**Note on scope:** `game_fossil-hunt.html` and `game_layer-detective.html` are Earth & Space Science (geologic time / superposition), not Life Science. They appear under the "Layers of Time" Earth Science unit card. They are audited here for completeness because they share the game_ namespace, but Life Science recommendations below do not apply to them.

---

## Audit Table

| Page / File | Type | In Index? | Concept | Standards Connection | Student Value | UX / Visual Quality | Technical Condition | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|
| `game_is-it-alive.html` | Game | Yes | Characteristics of life | MS-LS1-1 | Medium | Medium, checkbox mechanic is clear but thin | ⚠ Malformed CSS, old nav-links | Light Improve | High |
| `game_cellular-showdown.html` | Game | Yes | Cell types (euk vs prok) | MS-LS1-1 | Medium | Medium, simple 2-choice, good feedback | ⚠ Malformed CSS, old nav-links, canonical URL mismatch | Light Improve | High |
| `game_cell-explorer.html` | Game | Yes | Cell organelles | MS-LS1-1 | High | Good, SVG clickable diagram + per-organelle quiz | Old nav-links, otherwise clean | Light Improve | Medium |
| `game_evolution-clicker.html` | Game | Yes | Natural selection | MS-LS4-4 | Low–Medium | High visual polish, weak science connection | Missing favicon tag; GA comment format differs | Keep | Low |
| `game_exercise.html` | Game | Yes | Body systems / exercise | MS-LS1-3 | Medium | Medium, intensity selector is passive | Old `.nav-center` breadcrumb | Light Improve | Medium |
| `game_relay.html` | Game | Yes | Body systems (molecules) | MS-LS1-3 | Medium-High | Good, journey track is engaging | Old `.nav-center` breadcrumb | Light Improve | Low |
| `game_fossil-hunt.html` | Game | Yes | Fossil correlation (Earth Sci) | MS-ESS1-4 | High | High, complex multi-column matching | Clean | Keep | Low |
| `game_layer-detective.html` | Game | Yes | Geologic time (Earth Sci) | MS-ESS1-4 | High | High, drag-and-drop layer puzzle | Clean | Keep | Low |
| `extension_gray-zone.html` | Extension | Yes | Living/non-living boundary | MS-LS1-1 | High | Medium, Gen 1 CSS, tall hero, old nav | Old nav-links, no LS/STEM toggle | Light Improve | Medium |
| `extension_virus.html` | Extension | Yes | Are viruses alive? | MS-LS1-1 | Medium | Low, Gen 1 CSS, old title format | Old title, old nav-links, **redundant with gray-zone** | Merge → Remove | High |
| `extension_organelles.html` | Extension | Yes | Protein synthesis pathway | MS-LS1-1 (stretch) | Medium | Low, Gen 1 CSS, old title format | Old title, old nav-links, grade-level fit concern | Light Improve | Medium |
| `extension_neuron-explorer.html` | Extension | Yes | Neuron structure / signaling | MS-LS1-3 (stretch) | Medium-High | Medium, SVG clickable, good mechanic | ⚠ Malformed CSS, old nav-links | Light Improve | High |
| `extension_biological-evolution.html` | Extension | Yes | Evidence of evolution | MS-LS4-1, MS-LS4-2 | High | Good, structured multi-part activity | Old nav-links | Light Improve | Low |
| `extension_body-systems.html` | Extension | Yes | Medical mysteries / body systems | MS-LS1-3 | High | Good, case-based, high student agency | Old nav-links + nav-center both present | Light Improve | Low |
| `extension_moon-tonight.html` | Extension | Yes | Moon phases (Earth Sci) | MS-ESS1-1 | High | High, real-time astronomy tool | Clean | Keep | Low |

---

## Page-by-Page Notes

### game_is-it-alive.html

**What it does:** Students are shown a scenario (e.g., a flame, a crystal, a robot) and check which of 8 characteristics of life apply. A "Give Verdict" button reveals which selections were correct or incorrect with feedback.

**What works:** The scenario-based format is pedagogically sound. The checkbox grid with immediate per-item feedback is clear. Side panel with a characteristics reference list is genuinely helpful scaffolding.

**What feels outdated or weak:**
- The `.page-hero {}` CSS block contains a nested `.hero-badge {}` selector inside its opening brace, this is malformed CSS and will cause the hero-badge styling to be misapplied or silently fail depending on browser parser behavior.
- The `nav-links` horizontal menu is present and styled but no items appear to be rendered in the HTML, it's dead CSS weight from an earlier pattern.
- No phased structure; interaction is one-shot per scenario with no locked progression or checkpoint quiz.
- No LS/STEM badge toggle support.

**Technical concerns:** Malformed CSS starting at approximately line 82, `.page-hero {` opens, then `.hero-badge {}` is nested inside the block. The `:root` border variable is `rgba(52,152,219,0.2)` (old blue-tinted border, not the current site border token).

**Recommendation:** Light Improve  
**Improvement path:** Fix the malformed CSS block (un-nest `.hero-badge`), remove the dead `.nav-links` CSS and HTML, add LS/STEM badge bar support, optionally add a short quiz gate after 5 rounds to reinforce patterns.

---

### game_cellular-showdown.html

**What it does:** Students see a clue card describing a cellular feature and must choose between two options (Eukaryotic or Prokaryotic). Feedback explains why the answer is correct.

**What works:** The 2-choice format is quick and repeatable. Feedback quality is good. Progress dots at the bottom give a sense of completion.

**What feels outdated or weak:**
- Same malformed `.page-hero {}` CSS block as `game_is-it-alive.html`.
- The `<link rel="canonical">` points to `game_cell-type-showdown.html` but the actual filename is `game_cellular-showdown.html`, a canonical URL mismatch that may affect search indexing.
- Dead `.nav-links` CSS and HTML (same pattern as Is It Alive?).
- No LS/STEM badge bar.

**Technical concerns:** Canonical URL mismatch is a concrete SEO/crawl issue. Malformed CSS same as above.

**Recommendation:** Light Improve  
**Improvement path:** Fix malformed CSS, fix canonical URL, remove nav-links dead code, add LS/STEM badge support.

---

### game_cell-explorer.html

**What it does:** An SVG diagram of a cell with clickable organelles. Clicking an organelle populates an info panel with description, nickname, and a "did you know" fact. After identifying an organelle, a quiz question appears. Progress chips track which organelles have been explored.

**What works:** This is the strongest of the Gen 2 games. The SVG click mechanic is meaningful rather than decorative. The info panel + quiz pairing is a solid application of the organelle content. Progress chips give clear completion tracking. The tooltip on hover is polished.

**What feels outdated or weak:**
- Dead `.nav-links` code (CSS + HTML list, no items rendered).
- No LS/STEM badge bar.
- The mode-bar tabs (Explore vs Quiz) look good but the quiz mode may not enforce prerequisite completion before access.
- Visual style is close to current but the `:root` border is the old blue-tinted token.

**Technical concerns:** Otherwise clean. No malformed CSS.

**Recommendation:** Light Improve  
**Improvement path:** Remove nav-links dead code, add LS/STEM badge bar, align border token to current site variable, consider locking the Quiz tab until Explore is complete.

---

### game_evolution-clicker.html

**What it does:** A clicker game where students click a circular target to accumulate "mutations." Combos build, upgrades can be purchased, and evolution gates require answering questions before unlocking the next evolutionary stage.

**What works:** The visual design is the most polished of all the games, deep dark background, dot-grid ambient pattern, vibrant cyan/green/purple palette, animated click zone with glow effects. The evolution gate questions are a genuine educational checkpoint. The combo system rewards sustained play.

**What feels outdated or weak:**
- The core loop (click to generate mutations) is not a scientifically grounded model of natural selection. Students may walk away thinking evolution is about individual effort or that organisms "level up." The clicker metaphor is engaging but mechanistically misleading.
- No connection back to lesson content, it could exist as a standalone entertainment product.
- Missing `<link rel="icon">` favicon tag.
- Google Analytics script comment format differs from other pages (uses `<!-- Google Analytics -->` instead of `<!-- Google tag (gtag.js) -->`).

**Technical concerns:** Missing favicon; otherwise clean technically.

**Recommendation:** Keep  
**Improvement path:** Consider adding a brief framing intro card that explicitly states the metaphor ("In this game, each click represents one random mutation entering the population, only some will spread"). This would make the science connection explicit without changing the mechanic.

---

### game_exercise.html

**What it does:** Students select one of 5 exercise intensity levels (rest → max effort). Animated meter bars show how each body system responds (heart rate, O₂ saturation, muscle output, respiratory rate, etc.). A 3-question quiz follows.

**What works:** The multi-system visualization is pedagogically strong, seeing all systems respond simultaneously reinforces the integrated-systems concept. The meter bar animation is smooth. Floating emoji in the hero add character.

**What feels outdated or weak:**
- The primary interaction is a single intensity level selection, students choose one level and observe. There's no iterative data collection or student hypothesis-testing built in.
- Old `.nav-center` breadcrumb element is present and styled (shows "LyfeLabz › Exercise Simulator"), this pattern has been retired from newer pages.
- No LS/STEM badge bar.
- `--border` token is `rgba(255,255,255,0.07)` which matches newer pages, so visually this is closer to current than Gen 1.

**Technical concerns:** Clean aside from nav-center. Footer links to correct About/Privacy/Why pages.

**Recommendation:** Light Improve  
**Improvement path:** Remove `.nav-center` breadcrumb. Add an LS/STEM badge bar. Optionally add a "What if?" mechanic where students predict system values before selecting intensity.

---

### game_relay.html

**What it does:** Students choose a body system journey (digestive, circulatory, nervous, muscular, respiratory). A journey track shows molecule/signal waypoints. At each stop, a question about the molecule's role must be answered correctly. Three wrong answers end the game.

**What works:** The journey metaphor is the right pedagogical frame for body systems, tracing a molecule's path gives procedural understanding. The node-based track with live/dead visual states is clean. Feedback explanations are meaningful.

**What feels outdated or weak:**
- Same `.nav-center` breadcrumb as game_exercise.html.
- The gold/orange accent color for this page makes it visually similar to a Lesson page rather than a Game.
- No LS/STEM badge bar.

**Technical concerns:** Clean. Footer links correct.

**Recommendation:** Light Improve  
**Improvement path:** Remove `.nav-center` breadcrumb. Add LS/STEM badge bar. Minor: the `--accent` in this page is gold (#f5c842), consider whether to keep or differentiate from lesson-page aesthetic.

---

### game_fossil-hunt.html

**What it does:** (Earth & Space Science) Students correlate fossil layers across three geological locations using a color-coded matching system. SVG lines connect matching layers across columns. A secondary age-ordering puzzle follows.

**What works:** The highest-complexity game mechanic on the site. The multi-column layer correlation is genuinely intellectually demanding and mirrors how geologists actually work. SVG line drawing between matched layers is technically impressive. The learn-toggle collapsible intro is a nice pattern for scaffolding.

**Technical concerns:** Clean. No malformed CSS, no old nav patterns.

**Recommendation:** Keep (Earth Sci scope, not a Life Science priority)

---

### game_layer-detective.html

**What it does:** (Earth & Space Science) Students drag-and-drop rock layers to build a geologic cross-section. Events like dikes, faults, and lava flows must be ordered correctly. Review mode shows correct placement.

**What works:** Strong geologic reasoning mechanic. The sky/earth gradient background contextualizes the activity. Review mode is excellent for self-assessment.

**Technical concerns:** Clean. No malformed CSS, no old nav patterns.

**Recommendation:** Keep (Earth Sci scope, not a Life Science priority)

---

### extension_gray-zone.html

**What it does:** Students analyze "gray zone" cases, entities that challenge the living/non-living boundary (viruses, prions, fire, crystals). Collapsible analysis blocks let students evaluate each characteristic. A guided CER (Claim-Evidence-Reasoning) builder steps through three cases. A mini quiz follows.

**What works:** This is conceptually the strongest Life Science extension. The CER builder format matches the scientific-reasoning emphasis of Massachusetts STEM standards. The case card grid is a compelling hook. Content is accurate and grade-appropriate.

**What feels outdated or weak:**
- Gen 1 CSS, `--border: rgba(52,152,219,0.2)`, older color variable set.
- Old `.nav-links` horizontal menu (CSS defined, items likely rendered in HTML).
- Hero section has very large padding (`6rem 2rem 5rem`) making it significantly taller than current pages.
- Hero accent is yellow/orange (the "gray zone" color palette), which is fine conceptually but visually disconnected from the green Life Science palette used in other What Is Life? pages.
- No LS/STEM badge bar.

**Technical concerns:** `.nav-links` CSS and HTML are present. No malformed CSS. Footer links are correct.

**Recommendation:** Light Improve  
**Improvement path:** Remove nav-links, reduce hero padding to match current pages (~4rem top), add LS/STEM badge bar, update border token. Absorb the best content from `extension_virus.html` before removing it.

---

### extension_virus.html

**What it does:** Students work through a checklist of life characteristics and evaluate whether viruses meet each one. Evidence-analysis cards show virus examples (COVID-19, influenza, bacteriophage). Verdict pills summarize the analysis. A short quiz follows.

**What works:** The evidence-card format for different virus types is well-structured. Quiz questions are appropriate.

**What feels outdated or weak:**
- **Substantively redundant with `extension_gray-zone.html`.** Both pages address viruses and the living/non-living boundary. A student completing both would largely repeat the same analysis.
- Title is `"LyfeLabz Biology Review Lab | Extension: Are Viruses Alive?"`, "Biology Review Lab" is old branding.
- Gen 1 CSS, same old border token, color variables.
- Old `.nav-links` horizontal menu.
- No LS/STEM badge bar.

**Technical concerns:** Old title format is student-visible in browser tab. Nav-links present. Footer links are correct.

**Recommendation:** Merge → Remove Candidate  
**Improvement path:** Extract the virus-specific evidence cards (COVID-19, flu, bacteriophage examples) and integrate them into `extension_gray-zone.html` as a new "Viruses in Focus" subsection. Once integrated, remove `extension_virus.html` from index.html.

---

### extension_organelles.html

**What it does:** A step-by-step pathway stepper takes students through protein synthesis: DNA → Nucleus → Ribosome → Endoplasmic Reticulum → Golgi Apparatus → Vesicle → Cell Membrane. Each step has descriptive text, context chips, and an interactive element. Steps must be completed in sequence.

**What works:** The sequential stepper mechanic is appropriate for a pathway concept. Content chips ("Where / Job / Why") are a nice scaffold. The locked-step progression enforces reading and engagement.

**What feels outdated or weak:**
- Title is `"LyfeLabz Biology Review Lab | Extension: The Protein Pathway"`, old branding.
- Gen 1 CSS, old border token and color variables.
- Old `.nav-links` horizontal menu.
- **Grade-level fit concern:** Protein synthesis (transcription, translation) is typically a Grade 8–9 topic in Massachusetts frameworks (LS1.A at the high school level). The Massachusetts 2016 Grade 6 standards for cells focus on cell structure and function (MS-LS1-1, MS-LS1-2), not molecular genetics. This page may be more appropriate as a Grade 8 extension.
- No LS/STEM badge bar.

**Technical concerns:** Old title format. Nav-links present. Footer links correct.

**Recommendation:** Light Improve (and review grade placement, may need a grade-level caveat)  
**Improvement path:** Fix title format, remove nav-links, add LS/STEM badge bar, update CSS to current token set, add a clear "Advanced Extension" or "Grade 8 Preview" label to frame the content for teachers and students.

---

### extension_neuron-explorer.html

**What it does:** A clickable SVG diagram of a neuron. Clicking labeled parts (dendrite, axon, myelin sheath, synaptic terminal, etc.) updates a detail panel with description, function, and a science connection. A quiz mode activates after all parts are identified. A signal animation button shows an action potential propagating along the neuron.

**What works:** The SVG interaction pattern mirrors `game_cell-explorer.html` and works well for anatomy content. The signal animation is a genuinely engaging demonstration of action potential propagation. Quiz gating behind exploration is good practice.

**What feels outdated or weak:**
- **Same malformed CSS bug** as `game_is-it-alive.html` and `game_cellular-showdown.html`: `.page-hero {}` contains `.hero-badge {}` as a nested selector inside its opening brace.
- Old `.nav-links` horizontal menu (CSS + HTML).
- Nav badge shows purple neuron color, which is correct but adds visual inconsistency with the Extension content-type color system.
- **Grade-level fit concern:** Action potential and synaptic signaling are typically Grade 8–10 content. Massachusetts Grade 6 life science does not specifically require neuron-level detail.
- No LS/STEM badge bar.

**Technical concerns:** Malformed CSS (same bug as games). Nav-links present.

**Recommendation:** Light Improve  
**Improvement path:** Fix malformed CSS block (same fix as game_is-it-alive.html), remove nav-links, add LS/STEM badge bar, add "Advanced Extension" label.

---

### extension_biological-evolution.html

**What it does:** A multi-part structured activity with student info input fields. Part 1 covers fossil evidence (table analysis). Part 2 covers comparative anatomy (multiple choice). Part 3 covers molecular/DNA evidence (short answer). A synthesis CER prompt ties the three evidence types together. A sticky progress bar tracks completion percentage. Responses can be submitted.

**What works:** This is the most complete "worksheet replacement" extension on the site. The three-part structure mirrors how scientists build the case for evolution, the progression from physical to molecular evidence mirrors the historical development of evolutionary theory. The sticky progress bar is excellent UX. The CER synthesis prompt is well-framed.

**What feels outdated or weak:**
- Old `.nav-links` horizontal menu (CSS + HTML).
- The CSS `--accent` is `#c48a4e` (earthy brown/gold), appropriate for evolution/fossil content but not the current site's color system for Extensions (purple).
- No LS/STEM badge bar.
- The form submission endpoint is not visible in the HTML, unclear if submit actually works or if there's a backend endpoint configured elsewhere.

**Technical concerns:** Nav-links present. Submit endpoint unknown. Footer links correct.

**Recommendation:** Light Improve  
**Improvement path:** Remove nav-links, add LS/STEM badge bar, verify or document the submit endpoint.

---

### extension_body-systems.html

**What it does:** Students read medical mystery cases, each presents patient vitals, symptom tags, and background information. They answer diagnostic questions (multiple choice with letter indicators), reveal the diagnosis, and accumulate a score. A sticky score bar tracks progress across cases.

**What works:** The medical mystery framing is the most student-engaging of all the extensions. Case format gives real-world context. Sticky score bar is excellent. The vitals grid with abnormal values highlighted in red is strong clinical scaffolding. This page comes closest to current LyfeLabz quality among extensions.

**What feels outdated or weak:**
- Both `.nav-links` and `.nav-center` are present simultaneously, this is the only page with both old nav patterns at once.
- No LS/STEM badge bar.
- `--border` token is `rgba(255,255,255,0.07)`, same as newer pages, so visually compatible.

**Technical concerns:** Two redundant nav patterns. Footer links correct.

**Recommendation:** Light Improve  
**Improvement path:** Remove both `.nav-links` and `.nav-center` (keep only logo + nav-back). Add LS/STEM badge bar.

---

## Removal Candidates

### extension_virus.html: Merge Candidate (High Priority)

**Why:** Substantively covers the same concept as `extension_gray-zone.html` (viruses and the living/non-living boundary). A student completing both would largely repeat the same analysis with slightly different framing. Having two Extension links under the "What Is Life?" unit card for nearly identical content creates decision fatigue and dilutes the extension experience.

**Suggested action:** Extract the best content (the COVID-19/flu/bacteriophage evidence cards and quiz questions) and absorb them into `extension_gray-zone.html`. Then remove the `extension_virus.html` link from index.html. The file can remain on disk until the merge is complete.

---

## Best Upgrade Opportunities

**1. Fix the shared malformed CSS bug (3 files)**  
**Files:** `game_is-it-alive.html`, `game_cellular-showdown.html`, `extension_neuron-explorer.html`  
**Value:** High impact for low effort. A single well-defined CSS structure fix, applied identically to all three files, resolves a technical correctness issue in three student-facing pages. The `.page-hero {}` block in all three files has `.hero-badge {}` nested inside its opening brace, this should be two separate rule blocks.

**2. Strip dead nav-links code from 9 pages**  
**Files:** All Gen 1 and Gen 2 pages.  
**Value:** Removes dead HTML and CSS across 9 pages, reducing file size and nav confusion. Standardizes the header pattern across the full site. All 9 pages have the `.nav-back` button already, removing nav-links just cleans up the surplus.

**3. Modernize extension_gray-zone.html + absorb extension_virus.html**  
**File:** `extension_gray-zone.html`  
**Value:** Gray Zone is the strongest Gen 1 extension conceptually. Bringing it to Gen 2.5 quality (nav fix, hero padding, LS/STEM badge bar, current CSS tokens) plus absorbing the virus-specific content from `extension_virus.html` would create one excellent, comprehensive "What Is Life? Deep Dive" extension instead of two mediocre overlapping ones.

**4. Add LS/STEM badge bars to all game and extension pages**  
**Files:** All 14 Life Science games and extensions.  
**Value:** This is the primary teacher-facing feature of LyfeLabz. None of the older pages expose this UI. Adding the badge bar (the `.badge-bar.stem-bar` / `.badge-bar.ls-bar` pattern + sessionStorage toggle check) to all pages closes a significant gap for teachers who rely on the Learning Science and STEM standards overlays.

**5. Fix canonical URL and add grade-level labels to extension_organelles.html and extension_neuron-explorer.html**  
**Files:** `extension_organelles.html`, `extension_neuron-explorer.html`, `game_cellular-showdown.html` (canonical mismatch)  
**Value:** The two advanced extensions (protein synthesis, neuron signaling) currently have no framing that tells a Grade 6 teacher these are stretch content. Adding a clear "Advanced, Grade 7–8 Preview" badge would help teachers self-select the right content for their class. The canonical mismatch in Cellular Showdown is a concrete SEO error.

---

## Suggested Next Micropasses

Each prompt below is a discrete, bounded Claude Code task.

**Micropass 1, Fix malformed CSS in 3 files**  
*Files: `game_is-it-alive.html`, `game_cellular-showdown.html`, `extension_neuron-explorer.html`*  
Fix the `.page-hero {}` CSS block in all three files. The `.hero-badge {}` nested selector needs to be extracted into its own separate rule block. Do not change any other CSS, layout, or content.

**Micropass 2, Remove nav-links from all 9 affected pages**  
*Files: All Gen 1 and Gen 2 pages with `.nav-links` present*  
Remove the `.nav-links` CSS rule and the corresponding `<ul class="nav-links">` HTML element from each page. Do not touch nav-logo, nav-back, or nav-badge. Do not change any other layout.

**Micropass 3, Remove nav-center from 3 pages and fix canonical in 1**  
*Files: `game_exercise.html`, `game_relay.html`, `extension_body-systems.html`, `game_cellular-showdown.html`*  
Remove `.nav-center` CSS and HTML from the first three files. Fix `game_cellular-showdown.html` canonical URL from `game_cell-type-showdown.html` to `game_cellular-showdown.html`.

**Micropass 4, Add LS/STEM badge bars to all Life Science games and extensions**  
*All 14 Life Science games/extensions*  
Add the `<div class="badge-bar stem-bar">` and `<div class="badge-bar ls-bar">` sections below the nav in each page, using the same STEM standards and Learning Science tags already present on the newer investigation/lesson pages. Add the sessionStorage toggle check `<script>` block at the bottom of each page. Add the badge-bar CSS.

**Micropass 5, Merge extension_virus.html into extension_gray-zone.html**  
*Files: `extension_gray-zone.html`, `extension_virus.html`, `index.html`*  
Extract the virus evidence cards and the 8-question quiz from `extension_virus.html`. Add them as a new collapsible section ("Viruses Under the Microscope") at the end of `extension_gray-zone.html`. Remove the `extension_virus.html` link from index.html. Do not delete the file.

**Micropass 6, Modernize extension_gray-zone.html hero and CSS tokens**  
*File: `extension_gray-zone.html`*  
Update the hero padding from `6rem 2rem 5rem` to match current pages (~`4.5rem 2rem 3.5rem`). Replace old CSS variable token set (`--border: rgba(52,152,219,0.2)`, etc.) with current site equivalents. Do not change content, layout, or interaction logic.

**Micropass 7, Add "Advanced Extension" labels to organelles and neuron pages**  
*Files: `extension_organelles.html`, `extension_neuron-explorer.html`*  
Add a visible "Advanced, Grade 7–8 Content" badge or callout near the hero eyebrow of each page. Update page titles to remove "Biology Review Lab" branding from extension_organelles.html. No structural changes.
