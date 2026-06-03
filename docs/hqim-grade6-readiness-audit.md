# LyfeLabz Grade 6 HQIM Readiness Audit
**Date:** June 2026  
**Scope:** Grade 6 Massachusetts Science and Technology/Engineering standards only  
**Auditor:** Claude Code (AI-assisted audit of repo files; no live site interaction)  
**Lens:** Massachusetts DESE CURATE HQIM framework criteria

---

## 1. Executive Summary

### Current Readiness Rating: **Emerging HQIM-Aligned Resource**

LyfeLabz has built a genuinely impressive set of Grade 6 lesson pages and interactive tools — visually polished, research-informed, and engaging in ways that few free digital resources match. The astronomy, life science, and waves content together cover a substantial portion of the Grade 6 MA STE standards: the Earth-Sun-Moon unit (6.MS-ESS1-1a, 6.MS-ESS1-4), the waves unit (6.MS-PS4-1, 6.MS-PS4-2 in progress), and the life science units (6.MS-LS1-1, 6.MS-LS1-2, 6.MS-LS1-3, 6.MS-LS4-1 — all confirmed Grade 6 by the MA 2016 STE Framework) collectively represent meaningful coverage across three of the four disciplinary areas. However, LyfeLabz currently functions as a well-designed collection of standalone resources rather than a coherent Grade 6 core curriculum. What is missing is not primarily content pages — it is the *system* around those pages: a documented scope and sequence, teacher-facing implementation guides, summative assessments and performance tasks, a complete standards coverage map, a multilingual and accessibility plan, and the pilot evidence that DESE reviewers would expect. The properties of matter/chemistry and engineering/ETS units are not yet built. The MA 2016 standard codes applied across pages are inconsistently formatted, sometimes mixing NGSS national codes with Massachusetts-specific codes in ways that a CURATE reviewer would flag. A genuine alignment concern exists within the evolution content: natural selection mechanisms (8.MS-LS4-4) appear in Grade 6-labeled resources even though that standard is assessed at Grade 8. Before HQIM review is plausible, LyfeLabz needs substantial work in documentation, assessment design, teacher usability, coherence, and remaining coverage — all achievable, but none trivial.

---

## 2. Current Grade 6 Inventory

The table below covers all files in the repo with clear Grade 6 relevance. Files with no visible connection to Grade 6 MA STE standards (e.g., blog posts, mission-control audit reports) are excluded unless they affect sitewide infrastructure.

| File / Page | Unit / Topic | Resource Type | Apparent Standard Alignment | Status | Notes |
|---|---|---|---|---|---|
| `lesson_sun-earth-moon.html` | Sun-Earth-Moon System | Lesson | 6.MS-ESS1-1a, MS-ESS1-2 | Complete | 2,104 lines; has formative reflect section and 10-Q quiz. Code corrected to 6.MS-ESS1-1a (June 2026). |
| `lesson_phases-of-the-moon.html` | Phases of the Moon | Lesson | 6.MS-ESS1-1a, MS-ESS1-2 | Complete | 1,811 lines; has reflect questions. Code corrected to 6.MS-ESS1-1a (June 2026). |
| `lesson_eclipses.html` | Eclipses | Lesson | 6.MS-ESS1-1a, 6.ESS1-2, 6.ESS1-3 | Complete | 1,680 lines; 10-Q quiz. Code corrected to 6.MS-ESS1-1a (June 2026). |
| `lesson_nature-of-waves.html` | Nature of Waves | Lesson | 6.MS-PS4-1 | Partial | 5,349 lines; most extensive lesson in repo; covers PS4-1 well; PS4-2 and PS4-3 mentioned in badge but not full lesson coverage |
| `lesson_layers-of-time.html` | Layers of Time (geology) | Lesson | 6.ESS1-4, 6.ESS2-3 | Complete | 1,879 lines; relevant if geology is in scope for Gr. 6. Invalid `6.ESS2-2` badge removed (June 2026). |
| `lesson_continental-drift.html` | Continental Drift / Plate Tectonics | Lesson | 6.ESS2-3 | Complete | 1,903 lines. Invalid `6.ESS2-2` badge removed (June 2026). |
| `simulation_eclipse-alignment.html` | Eclipses | Simulation | 6.MS-ESS1-1a | Complete | 3,673 lines; interactive orbital tilt / node simulator; aligned to Eclipses lesson. Code corrected (June 2026). |
| `simulation_gravity-wells.html` | Sun-Earth-Moon / Gravity | Simulation | 6.MS-PS2-4, MS-ESS1-2 | Complete | 2,317 lines; gravity as attractive force; classroom/practice mode |
| `simulation_floatlandia-fracture.html` | Continental Drift | Simulation | 6.ESS1-4, 6.ESS2-3 | Complete | Evidence-building Floatlandia scenario. Invalid `6.ESS2-2` reference removed (June 2026). |
| `investigation_amplitude-challenge.html` | Nature of Waves | Investigation | MS-PS4-1, MS-PS4-2 | Complete | 2,981 lines; CER structure; data collection; predict-then-test; strongest investigation in repo |
| `extension_moon-tonight.html` | Phases of the Moon | Extension | 6.MS-ESS1-1a | Complete | 1,242 lines; connects to real moon using live date/phase logic |
| `game_layer-detective.html` | Layers of Time | Game | MS-ESS1-4 | Complete | Geologic sequencing game |
| `index.html` | Sitewide navigation | Index / Navigation | Multiple | Complete | Grade 6 filter present; unit cards link to pages; "Coming Soon" for engineering |
| `lesson_what-is-life.html` | Cells / Characteristics of Life | Lesson | 6.MS-LS1-1 | Complete | Life science IS Grade 6 in MA STE; this lesson provides evidence that all organisms are made of cells (unicellular and multicellular) |
| `lesson_cell-types.html` | Cell Types | Lesson | 6.MS-LS1-1 | Complete | Covers unicellular vs. multicellular and prokaryotic vs. eukaryotic — core 6.MS-LS1-1 content |
| `lesson_organelles.html` | Cell Organelles | Lesson | 6.MS-LS1-2 | Complete | Directly addresses how cell parts (nucleus, mitochondria, chloroplasts, vacuoles, cell membrane, cell wall) contribute to cellular functions |
| `lesson_body-systems.html` | Human Body Systems | Lesson | 6.MS-LS1-3 | Complete | Covers circulatory, digestive, respiratory, excretory, muscular/skeletal, and nervous systems — all explicitly listed in the 6.MS-LS1-3 clarification statement |
| `lesson_biological-evolution.html` | Biological Evolution | Lesson | 6.MS-LS4-1 (fossil record, Grade 6); 8.MS-LS4-4 (natural selection, Grade 8) | Partial — mixed grade | Fossil record evidence is Grade 6 (6.MS-LS4-1); natural selection mechanism content is Grade 8 (8.MS-LS4-4); the lesson spans two grade-level standards and should be labeled accordingly |
| `simulation_beetle-island.html` | Natural Selection | Simulation | 8.MS-LS4-4 | Grade 8 content | Natural selection simulation maps to Grade 8 (8.MS-LS4-4); if deployed as Grade 6 content, this is a misalignment |
| `game_evolution-clicker.html` | Biological Evolution | Game | 8.MS-LS4-4 | Grade 8 content | Evolution clicker game likely addresses natural selection mechanisms (Grade 8), not fossil record evidence (Grade 6) |
| `extension_fossil-hunt.html` | Fossil Record | Extension | 6.MS-LS4-1 | Complete | Fossil evidence extension correctly targets the Grade 6 fossil record standard |
| `lesson_ragebaiting.html` | Behavioral Science | Lesson | No clear MA STE alignment | Complete | Not aligned to Grade 6 MA STE; listed under psych-locked content |
| `Properties of Matter lessons` | Properties of Matter | Lesson | 6.MS-PS1-x | Planned | Not yet built; planned for summer |
| `Chemistry lessons` | Chemistry | Lesson | 6.MS-PS1-x | Planned | Not yet built; planned for summer |
| `Engineering / ETS lessons` | Technology & Engineering Design | Lesson | MS-ETS1-x | Planned | Listed as "Coming Soon" on index |
| `Additional waves content` | Waves (PS4-2, PS4-3) | Lesson/Sim | MS-PS4-2, MS-PS4-3 | Planned | Waves unit incomplete; PS4-2 badge referenced in investigation but not fully taught |

**Correction to initial audit: Life science IS Grade 6 in Massachusetts.** The MA 2016 STE Framework explicitly assigns cells (6.MS-LS1-1), cell organelles and functions (6.MS-LS1-2), body system interactions (6.MS-LS1-3), and fossil record evidence (6.MS-LS4-1) to Grade 6. Massachusetts distributes Life Science, Earth and Space Science, Physical Science, and Technology/Engineering across every grade level rather than assigning entire disciplines to single grades. LyfeLabz's life science content in the Grade 6 filter is correctly placed. A genuine alignment concern does exist within the evolution content: fossil record evidence (6.MS-LS4-1) is Grade 6, but natural selection mechanisms (8.MS-LS4-4) are Grade 8. The blog post `teach-natural-selection-6th-grade.html` and `simulation_beetle-island.html` may present natural selection as Grade 6 content when it is assessed at Grade 8 on the MA MCAS.

---

## 3. Massachusetts Grade 6 Standards Coverage Map

The following uses the **Massachusetts 2016 STE standards** for Grade 6, verified against the MA DESE STE Instructional Guidelines (August 2023). Standard codes prefixed with `6.MS-` are explicitly Grade 6; codes prefixed with `7.MS-` or `8.MS-` are Grade 7 or 8 respectively. Note that Massachusetts distributes all four disciplinary areas (Life Science, Earth and Space Science, Physical Science, Technology/Engineering) across every grade level.

**Two important clarifications from the framework, both of which correct errors in the initial audit:**

1. **Life Science (LS1, LS4) IS Grade 6.** Standards 6.MS-LS1-1 (cells), 6.MS-LS1-2 (organelles/cellular functions), 6.MS-LS1-3 (body system interactions), and 6.MS-LS4-1 (fossil record evidence) are all explicitly Grade 6. LyfeLabz's life science content is correctly placed.

2. **Seasons is Grade 8, not Grade 6.** The MA framework splits what looks like one standard into 6.MS-ESS1-1a (lunar phases and eclipses = Grade 6) and 8.MS-ESS1-1b (seasons = Grade 8). The original audit treated seasons as a missing Grade 6 gap; this was incorrect. Seasons is an eighth-grade expectation and should not be in Grade 6 LyfeLabz content.

3. **Natural selection is Grade 8, not Grade 6.** The fossil record standard (6.MS-LS4-1) is Grade 6. The natural selection model (8.MS-LS4-4) and artificial selection (8.MS-LS4-5) are Grade 8. Any LyfeLabz content teaching natural selection mechanisms as Grade 6 curriculum (e.g., `simulation_beetle-island.html`, `game_evolution-clicker.html`, `teach-natural-selection-6th-grade.html` blog post) is presenting Grade 8 content at Grade 6.

4. **PS4-3 is not confirmed as a Grade 6 standard.** The DESE Instructional Guidelines show only 6.MS-PS4-1 and 6.MS-PS4-2 as Grade 6 PS4 standards. PS4-3 (technologies encoding/transmitting information) does not appear in the Grade 6 section. Do not treat PS4-3 as a required Grade 6 gap until verified against the full MA 2016 STE Framework document.

| MA 2016 STE Standard | Description | Current LyfeLabz Coverage | Evidence from Files | Assessment Evidence | Gap Level | Recommended Action |
|---|---|---|---|---|---|---|
| **6.MS-LS1-1** | Provide evidence that all organisms (unicellular and multicellular) are made of cells | Strong | `lesson_what-is-life.html`, `lesson_cell-types.html` | Lesson quizzes present | Minor | Verify quiz questions directly assess cell theory evidence, not just vocabulary; standardize standard code labeling on pages |
| **6.MS-LS1-2** | Develop and use a model to describe how cell parts contribute to cellular functions (nucleus, mitochondria, chloroplasts, vacuoles, cell membrane, cell wall) | Strong | `lesson_organelles.html`, `lesson_cell-types.html` | Lesson quizzes present | Minor | Confirm models (diagrams) require students to explain function, not just label; add classroom-submittable quiz |
| **6.MS-LS1-3** | Construct an argument that body systems interact to carry out essential life functions (circulatory, digestive, respiratory, excretory, muscular/skeletal, nervous) | Moderate | `lesson_body-systems.html`, `body-system-interactions.html`, `system_*.html` pages | Quizzes and system-level pages present | Moderate | The 6.MS-LS1-3 clarification statement emphasizes *interactions between systems*, not isolated system descriptions. Verify the body systems lesson explicitly argues that systems work together (e.g., respiratory → circulatory → cellular respiration), not just describes each system separately. The `body-system-interactions.html` page is promising; confirm its depth. |
| **6.MS-LS4-1** | Analyze and interpret fossil record evidence to describe organisms, environments, extinctions, and changes to life throughout Earth's history | Moderate | `lesson_biological-evolution.html`, `extension_fossil-hunt.html`, `lesson_layers-of-time.html` | Partial; no dedicated fossil record assessment found | Moderate | Verify that fossil evidence (not natural selection) is the primary focus of Grade 6 evolution content; add explicit 6.MS-LS4-1 standard labeling to relevant pages; add assessment for this standard |
| **Natural selection content (8.MS-LS4-4)** | *Grade 8 standard* — Use a model to describe natural selection in which genetic variations increase likelihood of surviving and reproducing | Misaligned | `simulation_beetle-island.html`, `game_evolution-clicker.html`, blog post `teach-natural-selection-6th-grade.html` likely address this | n/a | **Alignment concern** | Natural selection is a Grade 8 MCAS expectation. Content teaching natural selection mechanisms should be labeled as Grade 8 extension or enrichment, not core Grade 6 curriculum. |
| **6.MS-ESS1-1a** | Develop and use a model of the Earth-Sun-Moon system to explain lunar phases and eclipses | Strong | `lesson_eclipses.html`, `lesson_phases-of-the-moon.html`, `lesson_sun-earth-moon.html`, `simulation_eclipse-alignment.html`, `extension_moon-tonight.html` | 10-Q quizzes; reflect questions; classroom mode submission | Minor | Standardize all pages to `6.MS-ESS1-1a` code format. Note: *seasons* is standard 8.MS-ESS1-1b (Grade 8) — do not include seasons in Grade 6 coverage claims |
| **6.MS-ESS1-4** | Analyze and interpret rock layers and index fossils to determine relative ages of rock formations | Moderate | `lesson_layers-of-time.html`, `simulation_floatlandia-fracture.html`, `game_layer-detective.html` | Game engages with evidence sequencing; no formal summative | Moderate | The DESE guidelines explicitly state students should use laws of superposition and crosscutting relationships; confirm these are named and applied in the lesson. Add summative scientific argument task. |
| **6.MS-PS1-6** | Plan and conduct an experiment involving exothermic and endothermic chemical reactions to measure and describe thermal energy release or absorption | Missing | No page exists | None | Missing | Explicitly Grade 6 per DESE Instructional Guidelines (page 19); planned for summer chemistry build |
| **6.MS-PS1-7-MA** | Develop a hypothesis about floating/sinking using density; apply density to materials selection | Missing | No page exists | None | Missing | MA-specific Grade 6 standard; planned for summer properties of matter build |
| **Additional 6.MS-PS1-x standards** | Properties of matter: pure substances, mixtures, conservation (full list requires consulting the full MA 2016 STE Framework document) | Missing | No pages exist | None | Missing | Planned for summer; verify the complete set of Grade 6 PS1 standards against the full framework before building |
| **6.MS-PS2-4** | Use evidence to support the claim that gravitational forces between objects are attractive and only noticeable when one or both objects have very large mass | Partial | `simulation_gravity-wells.html` (correct MA code used) | Simulation questions | Moderate | Standard code is correct in the simulation; needs a connecting lesson page and explicit assessment targeting this standard |
| **6.MS-PS4-1** | Use diagrams of a simple wave to explain repeating pattern (amplitude, frequency, wavelength) and that amplitude is related to energy | Strong | `lesson_nature-of-waves.html`, `investigation_amplitude-challenge.html` | CER investigation; 10-Q quiz | Minor | DESE note: electromagnetic waves are *not* expected at Grade 6 state assessment — verify the waves lesson scopes appropriately |
| **6.MS-PS4-2** | Use diagrams and models to show that both light rays and mechanical waves are reflected, absorbed, or transmitted through various materials | Weak | Badge reference in `investigation_amplitude-challenge.html` only; no dedicated lesson page | No assessment | Major | Needs dedicated lesson or simulation page; DESE guidelines specifically include light refraction and evidence from light/material investigations |
| **6.MS-ETS1-1** | Define the criteria and constraints of a design problem with sufficient precision to ensure a successful solution | Missing | "Coming Soon" on index | None | Missing | Grade 6 ETS1 standard; ETS unit planned |
| **6.MS-ETS1-5(MA)** | Create and manipulate a 2D scale drawing to communicate a design solution | Missing | "Coming Soon" on index | None | Missing | MA-specific Grade 6 engineering standard; ETS unit planned |
| **6.MS-ETS1-6(MA)** | Communicate a design by producing a labeled construction drawing | Missing | "Coming Soon" on index | None | Missing | MA-specific Grade 6 engineering standard; ETS unit planned |
| **6.MS-ETS2-1(MA)** | Analyze and compare properties of metals, plastics, wood, and ceramics | Missing | "Coming Soon" on index | None | Missing | Grade 6 MA engineering standard; ETS unit planned |
| **6.MS-ETS2-2(MA)** | Select appropriate materials based on specific properties needed for a design solution | Missing | "Coming Soon" on index | None | Missing | Grade 6 MA engineering standard; ETS unit planned |
| **6.MS-ETS2-3(MA)** | Choose and safely use appropriate measuring tools, hand tools, and power tools to construct a prototype | Missing | "Coming Soon" on index | None | Missing | Grade 6 MA engineering standard; ETS unit planned |

**Note on ESS2 (plate tectonics/geology) — corrected June 2026:** The invalid code `6.ESS2-2` (`6.MS-ESS2-2`) has been removed from all pages. No `6.MS-ESS2-2` appears in the MA 2016 STE Framework; the valid Grade 6 standard is `6.MS-ESS2-3` (fossil/rock distribution, continental shapes, seafloor structures as evidence of plate motion). The code `7.MS-ESS2-2` is the Grade 7 standard for Earth's surface changes over varying scales and is not appropriate for Grade 6 labeling. All geology pages now display only `6.ESS2-3` (`6.MS-ESS2-3`).

**Corrected standards coverage summary:**
- 5–6 standards: **Strong coverage with assessment** (LS1-1, LS1-2, ESS1-1a, PS4-1 confirmed; LS1-3 strong with a caveat)
- 4–5 standards: **Moderate coverage, assessment gaps** (LS1-3 interaction emphasis, LS4-1, ESS1-4, PS2-4)
- 1–2 standards: **Weak/partial coverage** (PS4-2)
- 6+ standards: **Missing — planned** (PS1 family, ETS family)
- 1 alignment concern: **Natural selection content labeled Grade 6 but assessed at Grade 8** (8.MS-LS4-4)

---

## 4. HQIM Criteria Scorecard

**Scale:** 0 = Not present | 1 = Emerging | 2 = Partially developed | 3 = Strong | 4 = Review-ready

---

### A. Standards Alignment — Score: **2**

**Evidence:** All complete lessons display MA STE standard badges that expand to show descriptions. The eclipses lesson correctly uses MA 2016 codes (6.ESS1-1, etc.). The amplitude investigation uses both standard codes and SEP/CCC labels. Standards are visible but must be activated via educator mode toggle — they are hidden by default.

**Concern:** Standard code formatting is inconsistent across pages. `lesson_sun-earth-moon.html` and `lesson_phases-of-the-moon.html` use NGSS national codes (`MS-ESS1-1`) rather than MA 2016 codes (`6.ESS1-1`). `investigation_amplitude-challenge.html` uses `MS-PS4-1` (NGSS) while `lesson_nature-of-waves.html` uses `6.MS-PS4-1` (hybrid). A CURATE reviewer would flag this immediately. Additionally, ~55% of Grade 6 MA STE standards have no current page coverage at all (planned or missing), and no standards coverage map or matrix exists in documentation.

**Next action:** Standardize all Grade 6 pages to use MA 2016 STE codes consistently. Build a one-page standards coverage matrix and post it in docs/. Document which standards are taught, practiced, and assessed (not just displayed).

---

### B. Coherence and Scope/Sequence — Score: **1**

**Evidence:** The index.html organizes content into topic groups (Earth & Space, Physical Science, Tech & Engineering) with a Grade 6 filter, which provides minimal navigation coherence. Individual pages link to related simulations, investigations, and extensions via "cont-card" links. There is a loose instructional arc within each unit (lesson → simulation/investigation → extension).

**Concern:** There is no documented Grade 6 scope and sequence. There is no recommended unit order. There is no year-long curriculum map. Units are not explicitly designed to build on one another. A teacher cannot look anywhere in the repo and find the intended progression from September to June. The index presents content as a browsable catalog, not a curriculum. Planned units (PS1, ETS1) are listed as "Coming Soon" with no timeline or connection to existing units. The natural selection content (`simulation_beetle-island.html`, `game_evolution-clicker.html`) is presented within Grade 6 but maps to Grade 8 standards (8.MS-LS4-4); labeling these as Grade 8 extension would strengthen coherence claims rather than undermine them.

**Next action:** Draft a Grade 6 scope and sequence document as the first curriculum documentation deliverable. Identify which units are intended for which time of year. Clarify which specific evolution content is Grade 6 (fossil record, 6.MS-LS4-1) vs. Grade 8 (natural selection, 8.MS-LS4-4) and label it accordingly in the index and on lesson pages.

---

### C. Grade-Level Rigor — Score: **2**

**Evidence:** Tasks go well beyond recall in several places. The amplitude investigation uses predict-then-test data collection, requires students to choose between linear and squared models based on their data, and frames the final answer as a claim-evidence-reasoning task. The eclipse simulation requires students to manipulate orbital tilt and node alignment to discover conditions for eclipses rather than simply being told. The gravity wells simulation structures sequential investigations with embedded evidence-gathering. Quiz questions in the eclipses and waves lessons include multi-step reasoning items (e.g., evaluating a student's flawed claim, predicting what would have to be true for eclipses to occur monthly).

**Concern:** Rigor is inconsistent across the unit collection. The hook/formative check questions in `lesson_sun-earth-moon.html` and `lesson_phases-of-the-moon.html` are multiple-choice format only, with no written explanation required anywhere student-facing. There are no open-ended constructed response questions. There are no performance tasks. Model revision (a key NGSS/HQIM expectation) is not explicitly structured — students use models but are not asked to revise or critique them. The geology lessons have less investigative depth than the astronomy and waves content.

**Next action:** Add at least one written-response item per unit. Design one performance task per completed unit. Structure model revision explicitly in simulations (e.g., students predict, run simulation, then revise their model in writing).

---

### D. Instructional Design and Research-Supported Practice — Score: **3**

**Evidence:** This is LyfeLabz's clearest strength. Every complete lesson displays Learning Science badges that cite peer-reviewed research (Sweller et al. 2019, Roediger & Karpicke 2006, Noetel et al. 2022, Brod et al. 2018, Kornell & Bjork 2008). Consistently applied design patterns include: phenomenon-first hooks with driving questions; chunked expandable content cards; dual coding with accessible SVG diagrams (aria-labels present); retrieval practice quizzes; predict-then-reveal sequences; interleaved comparison of contrasting cases. The amplitude investigation is the strongest example — it structures productive struggle, data collection, model building, and CER reasoning across four phases. The eclipse simulation models inquiry progression through observable phenomena rather than direct instruction.

**Concern:** Despite strong individual design, the broader instructional routine is missing. There are no structured discussion prompts, no think-pair-share scaffolds, no class-facing sensemaking moments. There is no science notebook or writing routine. Misconceptions are not explicitly anticipated or addressed in teacher-facing documentation (because there is no teacher-facing documentation). The learning is largely individual and digital; there is no explicit design for classroom discourse or collaborative sensemaking.

**Next action:** Add one teacher-facing "Classroom Discussion Prompt" and one "Common Misconception" note per unit. Create a science notebook template or writing scaffold that teachers can print and pair with digital lessons.

---

### E. Support for Diverse Learners — Score: **1**

**Evidence:** HTML `lang="en"` is set on all pages. Font sizes use `rem` units, which respect browser accessibility settings. The waves lesson has extensive SVG `aria-label` attributes that describe diagram content. Content is chunked into short sections that reduce cognitive load. The Educator Mode toggle reveals standards and learning science rationale.

**Concern:** There are no multilingual learner (MLL) supports of any kind — no glossary translations, no bilingual vocabulary, no Spanish-language summaries. There are no read-aloud accommodations or text-to-speech optimization. There is no skip navigation link on any page. No `prefers-reduced-motion` CSS media query is present despite heavy use of animations (floating emojis, canvas animations, pulse effects) — this is a real issue for students with vestibular disorders. Interactive elements (quiz buttons, toggle cards, simulation controls) lack visible focus outlines in the CSS examined, which affects keyboard-only users. No documented differentiation or accommodation guide exists. No UDL planning is visible. Extensions exist (`extension_moon-tonight.html`) but are not clearly labeled as enrichment vs. core.

**Next action:** Add `prefers-reduced-motion` media query to all pages (immediately actionable). Create a one-page MLL and UDL support guide for each completed unit. Add skip-navigation links to all pages.

---

### F. Assessment System — Score: **1**

**Evidence:** Formative quizzes exist in all four astronomy/ESS lessons and in the nature-of-waves lesson, using a consistent Classroom Mode / Practice Mode toggle. In Classroom Mode, quiz scores are submitted via Google Apps Script to a teacher-configured spreadsheet. The score display includes a brief performance message. The amplitude investigation has a CER structure that functions as an embedded performance task. Reflect-style questions appear in `lesson_sun-earth-moon.html` and `lesson_phases-of-the-moon.html`. Simulations have embedded observation/evidence questions.

**Concern:** There is no summative unit assessment for any unit. There are no end-of-unit tests. There are no performance tasks with rubrics. There are no answer keys documented anywhere in the repo. There is no mastery tracking system by standard. The classroom submission Google Apps Script endpoint is hardcoded in lesson files but with no documentation of how a new teacher would configure their own form. Quiz questions across units were not audited against the explicit standard they claim to assess — some questions test recall of surface-level facts rather than the reasoning called for by the standard. The system cannot currently tell a teacher which specific MA STE standard a student is struggling with.

**Next action:** Write answer keys for all existing quizzes and post them in `docs/assessments/`. Design one summative assessment per completed unit. Add standard-tagging to individual quiz questions (in documentation if not in the HTML). Document the Google Apps Script setup process for new teachers.

---

### G. Teacher Usability — Score: **0**

**Evidence:** An Educator Mode toggle exists on the index page and lesson pages that reveals learning science badges and MA STE standard badges. The `about_lyfelabz.html` page describes the site as built by a 6th grade science teacher and mentions Weston Middle School context. The README describes the site as "easy to deploy in classrooms."

**Concern:** There are zero teacher guides, zero pacing guides, zero prep lists, zero discussion prompts, zero misconception notes, zero differentiation notes, and zero implementation tips in any file in the repo. The only teacher-facing affordance is the standards toggle. A teacher who had never spoken with the developer could not confidently run a LyfeLabz-based unit without significant guessing. There is no documentation of how the Google Apps Script submission system works or how to set it up. There is no lesson objective stated in teacher-readable form (learning goals are implied by content but not explicitly articulated). HQIM reviewers consistently flag this category as critical — teacher usability is often weighted equally with student-facing content.

**Next action:** This is the highest-priority documentation gap. Create a one-page teacher implementation guide for each complete unit that includes: learning objectives, suggested pacing, prep notes, discussion prompts, answer keys, common misconceptions, and differentiation ideas.

---

### H. Student UX Consistency — Score: **3**

**Evidence:** The site has strong visual and structural consistency. All pages use the same dark theme, Nunito/Orbitron/Fredoka One font stack, gold nav logo, sticky nav with back button, and topic-color accent system. The learning science and STE badge bars follow identical structure across pages. Quiz UI (classroom/practice mode toggle, score display, submit button, per-question feedback) is replicated consistently. Continue cards ("cont-card") at lesson bottoms use a consistent visual language. The simulation pages share similar progress-bar, evidence-panel, and observation-card patterns (Floatlandia/Gravity Wells/Eclipse Alignment share design DNA).

**Concern:** Standard code formatting is inconsistent (see Standards Alignment). Some pages have reflect sections (sun-earth-moon, phases), others do not (eclipses, waves) — the pattern is not predictable from a student perspective. The waves lesson is dramatically longer (~5,349 lines) than other lessons (1,680–2,104 lines), suggesting an inconsistent scope of what constitutes a "lesson." The index page's "How It Works" section describes a 4-step flow (Read → Activities → Quiz → Ace Your Test) that is not fully implemented — there is no "Ace Your Test" summative for any unit. The evolution-related pages (`simulation_beetle-island.html`, `game_evolution-clicker.html`) that address natural selection are correctly shown in Grade 6 on the index but should carry a note clarifying that natural selection is a Grade 8 MCAS expectation if LyfeLabz is positioning itself as aligned to Grade 6 standards.

**Next action:** Standardize the presence of reflect sections across all lesson pages. Clarify the intended scope of a "lesson" so new pages match existing depth. Add grade-level labels to the natural selection resources to distinguish Grade 6 fossil-record content from Grade 8 natural selection content.

---

### I. Accessibility and Technical Quality — Score: **1**

**Evidence:** `html lang="en"` is set. Font sizing uses `rem`. Waves lesson SVGs have descriptive `aria-labels`. `aria-label` is used on some interactive elements (cont-cards). Contrast is generally strong (light text on dark background). Pages are mobile-responsive. All checked pages have a viewport meta tag.

**Concern (technical debt list):**
- **No `prefers-reduced-motion`:** Heavy animations (starfield canvas, floating hero elements, coronaPulse, orbit animations) run for all users regardless of accessibility preferences. This fails WCAG 2.2 guideline 2.3.3.
- **No skip navigation:** All pages lack a skip-to-main-content link, requiring keyboard users to tab through the entire nav on every page.
- **Keyboard accessibility unclear:** Interactive card toggles (`onclick="toggleCard(this)"`), quiz options, and simulation controls are implemented as `button` elements in some places and `div onclick` in others. Full keyboard accessibility was not verified but the pattern is inconsistent.
- **No focus-visible styles:** The CSS does not include `:focus-visible` overrides in the pages reviewed, meaning keyboard focus may not be visible after button activation.
- **No alt text on non-SVG images:** The `mission-icon.png` in the repo has no documented alt text context.
- **CSS monolith architecture:** Every page embeds all of its CSS and JS inline. There are no shared stylesheets or JS files. This creates significant technical debt — a single global design change requires editing every file individually. The CSS custom property variable names differ between pages (e.g., `--dark` vs. `--bg-primary`), meaning the site does not have a true shared design system despite appearing visually consistent.
- **Google Analytics on all pages:** GA tracking (G-9QHB5G2B5B) is embedded on every page with no consent mechanism. This may create COPPA/FERPA concerns in a school deployment context.
- **Hardcoded Google Apps Script URLs:** Quiz submission endpoints are hardcoded in lesson files, making teacher configuration impossible without editing source code.
- **No offline capability:** No service worker or offline mode; students without stable internet cannot access content.

**Next action:** Immediately add `prefers-reduced-motion` and skip-nav links (low effort, high accessibility value). Evaluate COPPA/GA compliance for school use. Document keyboard interaction expectations per page.

---

### J. Evidence and Review Readiness — Score: **0**

**Evidence:** The mission-control folder contains internal audit reports (`content-type-consistency-audit.md`, `lesson-consistency-audit.md`, etc.) showing active self-review by the developer. The `about_learning-science.html` page references research behind design decisions. The blog has two posts (`teach-natural-selection-6th-grade.html`, `teach-what-is-life-6th-grade.html`) showing public-facing pedagogical rationale.

**Concern:** None of this constitutes DESE-review-ready evidence. There is no pilot data, no student learning evidence, no teacher feedback forms, no usage data presented, no equity analysis, no independent review documentation, no revision history tied to evidence of impact, no accessibility audit report, and no alignment documentation that would satisfy a CURATE rubric. The existing internal audits are valuable self-assessment tools but are not formatted as external-review evidence.

**Next action:** Before seeking any HQIM review, collect and document: (a) pilot classroom data from at least 1–2 classrooms, (b) student pre/post assessment results, (c) teacher usability feedback, (d) an independent accessibility audit. Begin keeping a design rationale document that connects pedagogical choices to evidence.

---

## 5. What LyfeLabz Already Does Well

**These are genuine strengths, with specific file evidence:**

1. **Phenomenon-first instructional hooks.** Every complete lesson opens with a driving question anchored to a surprising real-world phenomenon. `lesson_eclipses.html` opens with the 400× coincidence. `lesson_sun-earth-moon.html` hooks students with the puzzle of why the Moon orbits instead of falling. `lesson_nature-of-waves.html` opens with four mystery scenarios. This is consistent with NGSS/HQIM design expectations.

2. **Dual coding throughout.** The waves lesson (`lesson_nature-of-waves.html`) contains more than 25 SVG diagrams with descriptive `aria-label` attributes. Each diagram pairs visual representation with explanatory text. This is research-aligned practice (Noetel et al., 2022) and rare in free digital resources.

3. **Retrieval practice quizzes with classroom submission.** All four astronomy lessons and the waves lesson have 10-question quizzes with Classroom Mode / Practice Mode toggle, immediate per-question feedback, and score submission via Google Apps Script. This is a functional assessment infrastructure that most supplemental resources lack entirely.

4. **The Amplitude Challenge investigation (`investigation_amplitude-challenge.html`) is the strongest single artifact in the repo.** It structures predict-then-test data collection, requires students to choose between two mathematical models based on their own data, and uses a Claim-Evidence-Reasoning framework. It explicitly labels its use of SEP (Analyzing Data, Using Mathematics) and CCC (Energy and Matter, Scale and Proportion). This investigation would hold up to HQIM scrutiny.

5. **Eclipse Alignment simulation (`simulation_eclipse-alignment.html`) is a strong inquiry-based model.** Students manipulate orbital tilt and Moon phase to discover the conditions for eclipses themselves rather than being told. The page is 3,673 lines of interactive content with embedded observation cards.

6. **Learning science transparency.** The learning science badge system (citing Sweller, Roediger, Brod, Kornell, Noetel) is unusual and credibility-building. Few K-12 resources explain *why* they are designed the way they are, with citations.

7. **Visual and structural consistency.** The dark-theme design system, typography, badge bars, card patterns, and continue-card navigation are executed with high consistency. The site looks and feels like a coherent product, which matters for review credibility.

8. **Educator Mode toggle.** The global toggle system (activated from the index footer) that reveals MA STE standards and learning science badges across all pages is a practical teacher tool.

9. **Life science coverage is an underrecognized strength.** The MA 2016 STE Framework places cells (6.MS-LS1-1), organelles (6.MS-LS1-2), body systems (6.MS-LS1-3), and fossil record evidence (6.MS-LS4-1) at Grade 6. LyfeLabz has dedicated lesson pages for all of these: `lesson_what-is-life.html`, `lesson_cell-types.html`, `lesson_organelles.html`, `lesson_body-systems.html`, and `lesson_biological-evolution.html`. Multiple supporting resources also exist (`body-system-interactions.html`, `system_*.html` pages, `extension_fossil-hunt.html`). This represents substantial Grade 6 LS standards coverage that was incorrectly dismissed in the original audit. The depth of the body systems content in particular, with individual system pages and an interactions page, goes beyond what most middle school digital curricula provide.

---

## 6. What LyfeLabz Is Missing for HQIM Readiness

### Critical Gaps

These gaps would prevent a CURATE or HQIM review from proceeding:

- **No teacher guides of any kind.** Zero. Not one unit has a teacher implementation guide, pacing note, discussion prompt, prep list, or differentiation note. This is the single most important gap.
- **No summative assessments.** No unit has an end-of-unit test, performance task, or culminating project with a rubric.
- **No Grade 6 scope and sequence document.** There is no year-long curriculum map, no recommended unit order, no documentation of how units connect.
- **~55% of Grade 6 MA STE standards have no current lesson page.** PS1 (Properties of Matter/Chemistry), ETS1 (Engineering Design), PS4-2, PS4-3, and ESS2-1 are missing entirely.
- **No documented answer keys.** No teacher anywhere in the repo can find the correct answers to any quiz.
- **Inconsistent standard code formats.** The site cannot be cleanly aligned to MA 2016 STE because it mixes NGSS national codes, MA codes, and hybrid codes across files.

### Important Gaps

These gaps significantly weaken the HQIM case but are more fixable:

- **No performance tasks.** Even the best investigation (Amplitude Challenge) does not have a formal rubric or summative submission mechanism.
- **No written/open-ended response anywhere student-facing.** All assessment is multiple-choice.
- **No sensemaking or discussion structure.** No explicit whole-class or partner discussion routines are built into lessons.
- **No model revision practice.** Students use models but are never asked to revise or critique them in writing.
- **Natural selection content is presented as Grade 6 but is assessed at Grade 8.** The MA 2016 STE Framework places the fossil record standard (6.MS-LS4-1) at Grade 6 and the natural selection model (8.MS-LS4-4) at Grade 8. Resources like `simulation_beetle-island.html`, `game_evolution-clicker.html`, and the blog post `teach-natural-selection-6th-grade.html` appear to teach natural selection mechanisms at Grade 6. These should be labeled as Grade 8 extension enrichment rather than core Grade 6 curriculum if LyfeLabz is seeking HQIM alignment to Grade 6 standards.
- **Google Apps Script submission is non-configurable.** Teachers cannot set up their own score collection without editing source code.
- **No science notebook or writing scaffold.** Students have nowhere to record observations, claims, or reflections in an integrated way.

### Polish and Credibility Gaps

These matter for review confidence:

- **No `prefers-reduced-motion` CSS.** Accessibility failure that a formal review would catch.
- **No skip-navigation links.** Standard accessibility requirement.
- **No consent mechanism for Google Analytics.** COPPA/FERPA concern for school deployment.
- **No pilot evidence or student learning data.** HQIM reviews require evidence of effectiveness, not just design quality.
- **No revision history tied to evidence.** There is no changelog showing how the curriculum was improved based on classroom use.
- **Seasons is correctly absent from Grade 6 content.** The MA framework splits ESS1-1 into 6.MS-ESS1-1a (lunar phases and eclipses = Grade 6) and 8.MS-ESS1-1b (seasons = Grade 8). The original audit incorrectly flagged seasons as a Grade 6 gap. It is not. LyfeLabz correctly does not include a seasons lesson in its Grade 6 scope. No action needed on this point.
- **ESS2-1 (cycling of Earth's materials, energy driver) is barely present.** The rock cycle is implied in geology lessons but the energy-driven cycling model is not clearly developed.

---

## 7. Grade 6 Completion Roadmap

---

### Phase 1: Immediate Audit and Organization Fixes
**Goal:** Repair existing pages without adding content; establish documentation scaffolding.

| Task | Files Affected | Why It Matters for HQIM | Priority | Difficulty |
|---|---|---|---|---|
| Standardize all Grade 6 MA STE standard codes to 2016 MA format (e.g., `6.ESS1-1`, not `MS-ESS1-1`) | `lesson_sun-earth-moon.html`, `lesson_phases-of-the-moon.html`, `simulation_gravity-wells.html`, `simulation_eclipse-alignment.html` | Reviewers will flag inconsistent codes as a sign the alignment is superficial | Critical | Low |
| Add `prefers-reduced-motion` media query to all lesson/sim pages | All lesson, simulation, investigation files | WCAG 2.2 compliance; accessibility floor | Critical | Low |
| Add skip-navigation link to all pages | All pages | Basic WCAG keyboard accessibility | High | Low |
| Create `docs/` folder structure (standards-map, assessments, teacher-guides, evidence) | New folder | Establishes documentation home before content is written | High | Low |
| Clarify natural selection vs. fossil record grade levels on index and evolution pages | `index.html`, `simulation_beetle-island.html`, `game_evolution-clicker.html`, `lesson_biological-evolution.html` | Life science IS Grade 6; but natural selection (8.MS-LS4-4) is Grade 8 — label accordingly so reviewers see accurate alignment rather than misalignment | High | Low |
| Write answer keys for all existing quizzes | `docs/assessments/` | Teacher usability; assessment credibility | Critical | Medium |

---

### Phase 2: Finish the Waves Unit
**Goal:** Complete PS4 coverage so the first Physical Science unit is fully standards-aligned.

| Task | Files Affected | Why It Matters for HQIM | Priority | Difficulty |
|---|---|---|---|---|
| Build a lesson or simulation for PS4-2 (reflection, absorption, transmission through materials) | New file: `lesson_wave-interactions.html` or `simulation_wave-materials.html` | Currently a badge-only reference; no actual teaching | Critical | High |
| Verify whether PS4-3 (technologies that encode/transmit/decode information) is a Grade 6 MA STE standard | Full MA 2016 STE Framework document | The DESE Instructional Guidelines show only PS4-1 and PS4-2 as Grade 6 standards; PS4-3 does not appear in the Grade 6 section. Confirm before building a page for it. If it is Grade 6, build it; if it is Grade 7 or 8, do not include it in the Grade 6 scope. | Medium | Low (research only) |
| Add Classroom Mode quiz to waves lesson and ensure PS4-1 quiz is submittable | `lesson_nature-of-waves.html` | Assessment completeness | High | Medium |
| Write teacher implementation guide for Waves unit | `docs/teacher-guides/waves-unit-guide.md` | Teacher usability | Critical | Medium |
| Write summative assessment for Waves unit | `docs/assessments/waves-summative.md` | No summative exists | High | Medium |

---

### Phase 3: Build Properties of Matter, Chemistry, and Engineering Pages
**Goal:** Cover the PS1 and ETS1 standards that are currently entirely missing.

| Task | Files Affected | Why It Matters for HQIM | Priority | Difficulty |
|---|---|---|---|---|
| Build PS1 lesson pages for 6.MS-PS1-1 through PS1-6 (properties of matter, mixtures, pure substances, phase change, conservation) | Multiple new files | 6 missing performance expectations | Critical | High |
| Build ETS1 pages for engineering design cycle (MS-ETS1-1 through ETS1-4) | Multiple new files | ETS is required Grade 6 content; "Coming Soon" is not acceptable for HQIM | Critical | High |
| Ensure PS1 chemistry includes an investigation with CER structure | New investigation file | Rigor and science practices requirement | High | High |
| Ensure ETS1 includes an actual iterative design challenge with testing data | New files | Engineering design must be practiced, not just described | High | High |

---

### Phase 4: Create Teacher-Facing Curriculum Documentation
**Goal:** Build the documentation layer that transforms a resource collection into a curriculum.

| Task | Files Affected | Why It Matters for HQIM | Priority | Difficulty |
|---|---|---|---|---|
| Write Grade 6 scope and sequence (year-long map with units, time estimates, standard alignment) | `docs/grade6-scope-sequence.md` | Core HQIM requirement; does not exist at all | Critical | Medium |
| Write unit-level teacher guide for each complete unit (objectives, pacing, prep, discussion prompts, misconceptions, differentiation, answer keys) | One .md per unit in `docs/teacher-guides/` | Most important teacher usability gap | Critical | High |
| Document Google Apps Script setup process for new teachers | `docs/teacher-guides/quiz-setup.md` | Teachers cannot configure the submission system without this | High | Low |
| Write lesson-level learning objectives for every page (not just implied by content) | `docs/` or embedded in pages | Reviewers expect explicit objectives | High | Medium |

---

### Phase 5: Build Assessment and Mastery System
**Goal:** Create a complete formative and summative assessment system with rubrics and mastery tracking.

| Task | Files Affected | Why It Matters for HQIM | Priority | Difficulty |
|---|---|---|---|---|
| Design one summative unit assessment per completed unit | `docs/assessments/` | No summative assessments exist anywhere | Critical | Medium |
| Design one performance task per unit with a rubric | `docs/assessments/` | HQIM expects evidence of higher-order thinking | High | High |
| Add one open-ended/constructed response item per lesson | Individual lesson files or linked resources | All current assessment is multiple-choice | High | Medium |
| Create a standard-by-standard mastery tracking template for teachers | `docs/assessments/mastery-tracker-template.md` | Standard mastery tracking | Medium | Medium |
| Tag individual quiz questions to specific MA STE standards in documentation | `docs/assessments/` | Links assessment to standards explicitly | High | Low |

---

### Phase 6: Accessibility and Technical Quality Pass
**Goal:** Meet WCAG 2.2 AA standards and reduce technical debt.

| Task | Files Affected | Why It Matters for HQIM | Priority | Difficulty |
|---|---|---|---|---|
| Add `prefers-reduced-motion` queries (if not done in Phase 1) | All files | Accessibility compliance | Critical | Low |
| Add skip-nav links to all pages | All files | WCAG 2.2 2.4.1 | High | Low |
| Audit and fix keyboard accessibility of all interactive elements | All lesson and simulation files | WCAG 2.2 2.1.1 | High | High |
| Add `:focus-visible` styles across all pages | All files | WCAG 2.2 2.4.11 | High | Medium |
| Evaluate Google Analytics COPPA/FERPA compliance | All files | Legal risk in school deployment | Critical | Medium |
| Publish an accessibility statement | `docs/accessibility-statement.md` | HQIM credibility; required for school district adoption | High | Low |
| Investigate shared CSS/JS strategy to reduce file-by-file maintenance burden | All files | Long-term technical sustainability | Medium | High |

---

### Phase 7: Pilot Evidence and Review Packet
**Goal:** Collect real-world evidence and assemble DESE-style review documentation.

| Task | Files Affected | Why It Matters for HQIM | Priority | Difficulty |
|---|---|---|---|---|
| Run at least one Grade 6 classroom pilot per completed unit; collect pre/post assessment data | N/A (in-school work) | HQIM reviews require evidence of student learning | Critical | High |
| Collect teacher usability feedback using a structured survey | N/A | Evidence of teacher confidence and usefulness | High | Medium |
| Write a curriculum rationale document connecting design decisions to evidence | `docs/design-rationale.md` | Reviewers want to understand the curriculum theory of action | High | Medium |
| Compile a DESE review packet (see Section 8) | `docs/review-packet/` | Final milestone before seeking HQIM review | High | High |
| Conduct an independent accessibility audit | External review | Self-certification is not sufficient for formal review | High | Medium |

---

## 8. DESE/CURATE Readiness Packet Checklist

The following documents would eventually need to exist before a DESE-style HQIM/CURATE review could proceed. Items marked ✅ partially exist; items marked ❌ do not exist yet.

| Document | Status | Notes |
|---|---|---|
| Full Grade 6 scope and sequence | ❌ Missing | Must be created |
| Unit overview documents (one per unit) | ❌ Missing | Must be created |
| Standards alignment map (all Grade 6 MA STE standards × lesson coverage × assessment evidence) | ❌ Missing | Exists partially in this audit; must be formalized |
| Lesson-level learning objectives | ❌ Missing | Implied by content; not formally documented |
| Teacher implementation guides (one per unit) | ❌ Missing | Highest-priority gap |
| Student-facing materials (lesson pages, investigations, simulations) | ✅ Partially complete | 3–4 units complete; PS1, ETS1 missing |
| Formative assessments (in-lesson quizzes with answer keys) | ✅ Partially | Quizzes exist; answer keys do not |
| Summative unit assessments | ❌ Missing | None exist |
| Performance tasks with rubrics | ❌ Missing | Amplitude Challenge is closest; no formal rubric |
| Answer keys for all assessments | ❌ Missing | None exist in repo |
| Differentiation and accommodation guide | ❌ Missing | Does not exist |
| Multilingual learner support resources | ❌ Missing | Nothing in any language other than English |
| Accessibility statement | ❌ Missing | Does not exist |
| Research and design rationale document | ✅ Partially | Learning science badges cite research; not formalized |
| Evidence of student learning (pre/post data, pilot results) | ❌ Missing | No pilot has been documented |
| Teacher feedback and implementation notes | ❌ Missing | Not collected or documented |
| Revision history linked to evidence of improvement | ❌ Missing | Git commits exist but no structured rationale log |
| Google Apps Script configuration guide for teachers | ❌ Missing | Required for classroom use |
| Equity and representation review | ❌ Missing | Not addressed |
| Pilot school/classroom documentation | ❌ Missing | Not collected |

---

## 9. Recommended File and Documentation Architecture

The following repo structure is practical for the current stage of LyfeLabz and would support HQIM review preparation:

```
lyfelabz/
├── docs/
│   ├── OVERVIEW.md                          # One-page introduction for reviewers
│   ├── grade6-scope-sequence.md             # Year-long scope and sequence
│   ├── standards-map-grade6.md              # MA 2016 STE standards × coverage × assessment
│   ├── design-rationale.md                  # Theory of action; research connections
│   ├── accessibility-statement.md           # WCAG compliance claims and gaps
│   ├── revision-history.md                  # Evidence-linked changelog
│   │
│   ├── teacher-guides/
│   │   ├── astronomy-unit-guide.md          # ESS1 unit: Sun-Earth-Moon, Phases, Eclipses
│   │   ├── geology-unit-guide.md            # ESS2 unit: Layers of Time, Continental Drift
│   │   ├── waves-unit-guide.md              # PS4 unit: Nature of Waves, Amplitude Challenge
│   │   ├── matter-chemistry-unit-guide.md   # PS1 unit (planned)
│   │   ├── engineering-unit-guide.md        # ETS1 unit (planned)
│   │   └── quiz-setup-guide.md              # Google Apps Script configuration
│   │
│   ├── assessments/
│   │   ├── answer-keys/
│   │   │   ├── eclipses-quiz-answer-key.md
│   │   │   ├── sun-earth-moon-quiz-answer-key.md
│   │   │   ├── phases-quiz-answer-key.md
│   │   │   └── waves-quiz-answer-key.md
│   │   ├── summative/
│   │   │   ├── astronomy-unit-summative.md
│   │   │   ├── geology-unit-summative.md
│   │   │   └── waves-unit-summative.md
│   │   ├── performance-tasks/
│   │   │   └── eclipse-model-performance-task.md
│   │   └── mastery-tracker-template.md
│   │
│   ├── evidence/
│   │   ├── pilot-data/                      # Student pre/post results (when collected)
│   │   ├── teacher-feedback/                # Survey results, implementation notes
│   │   └── accessibility-audit/             # External audit report
│   │
│   └── review-packet/
│       ├── hqim-readiness-summary.md        # Executive summary for reviewers
│       └── curate-alignment-checklist.md    # Self-assessment against CURATE criteria
│
├── lesson_*.html                            # Existing lesson pages (unchanged)
├── simulation_*.html                        # Existing simulation pages (unchanged)
├── investigation_*.html                     # Existing investigation pages (unchanged)
├── extension_*.html                         # Existing extension pages (unchanged)
├── game_*.html                              # Existing game pages (unchanged)
└── index.html                               # Main navigation
```

**Notes on this structure:**
- All documentation goes in `docs/` to keep lesson files clean and the repo navigable
- Teacher guides and assessments are separated so teachers can find them independently
- The `evidence/` folder is empty now but creates the home for pilot data before a review is sought
- The `review-packet/` folder accumulates the final submission artifacts

---

## 10. Final Verdict

### Does LyfeLabz currently meet HQIM criteria?

**No.** LyfeLabz does not currently meet HQIM criteria for a core Grade 6 curriculum. It meets HQIM criteria for a *supplemental resource* with strong instructional design and emerging standards alignment. The student-facing content quality in the astronomy and waves units is genuinely high — well above what free digital resources typically offer. But core curriculum status requires documentation, assessment, coherence, teacher usability, and evidence that simply do not exist yet.

### Could it plausibly become HQIM-aligned for Grade 6?

**Yes, plausibly — in 18–24 months of focused work.** The instructional design foundation is strong enough that the path to HQIM readiness is real, not aspirational. What needs to be built is primarily:
1. The missing units (PS1 and ETS1)
2. The documentation system (teacher guides, assessments, scope/sequence)
3. The pilot evidence
4. The accessibility fixes

None of these require rebuilding what exists — they require layering documentation and new content onto a solid base.

---

### Top 10 Moves to Get Closest to DESE Review Readiness

1. **Write teacher implementation guides for every complete unit.** This is the single highest-leverage move. Even a 3-page guide per unit transforms usability for any teacher who is not the developer.

2. **Standardize all MA STE standard codes to the MA 2016 format.** This takes 30 minutes per file and immediately strengthens alignment credibility. Use `6.ESS1-1`, not `MS-ESS1-1`.

3. **Write answer keys for all existing quizzes and post them in `docs/assessments/`.** Answer keys are the first thing any reviewer or teacher asks for.

4. **Draft the Grade 6 scope and sequence.** Even a one-page table showing units, standards, and approximate time is enough to demonstrate this is a curriculum, not a collection.

5. **Add `prefers-reduced-motion` CSS to all pages.** This takes minutes per file and resolves the most serious accessibility gap.

6. **Finish the waves unit (build PS4-2 and PS4-3 pages).** The only physical science content currently present is incomplete at the standards level. A complete PS4 unit would be the strongest complete unit in the repo.

7. **Design one summative assessment per complete unit with a rubric.** A multiple-choice quiz is formative; a unit test or performance task is summative. Both are required for HQIM review.

8. **Distinguish fossil-record Grade 6 content from natural selection Grade 8 content across the evolution unit.** Life science IS correctly Grade 6 in Massachusetts — this is a strength, not a problem. The specific issue is that natural selection mechanisms (8.MS-LS4-4) appear in Grade 6-labeled resources (`simulation_beetle-island.html`, `game_evolution-clicker.html`). Labeling those as Grade 8 enrichment, and making the Grade 6 fossil record standard (6.MS-LS4-1) the clearly identified focus of the evolution unit, strengthens alignment credibility without removing any existing content.

9. **Run a real classroom pilot and document pre/post results.** HQIM reviews require evidence of student learning. No amount of design quality substitutes for data. Even one classroom, one unit, with pre/post quiz scores would establish an evidence baseline.

10. **Create a one-page DESE readiness self-assessment document using the CURATE rubric.** Mapping LyfeLabz's current state against the public CURATE criteria helps identify which criteria are closest to passing and prioritizes the remaining work.

---

*Audit prepared June 2026. This document reflects the state of the LyfeLabz repository as inspected. It is not a formal DESE/CURATE review and should be treated as an internal planning tool. All file references are to files found in the lyfelabz GitHub repository as of the audit date.*
