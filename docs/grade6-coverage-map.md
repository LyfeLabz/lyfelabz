# Grade 6 STE Standards Coverage Map

Repository evidence map for LyfeLabz Grade 6. External review eligibility,
rubric requirements, and submission procedures require later official-source
verification; this document does not establish them.

**Repository factual correction: 2026-09-19**, checked against commit
`4f6f02b01eb988696592265223d2ddff28832eb4`. The original map classifications
are retained; the performance qualifications below govern their interpretation.

- **Source of standards:** Massachusetts 2016 Science and Technology/Engineering
  Curriculum Framework, Grade 6 section (pages 54-59 of the framework PDF).
  Historically cross-checked in the repository's correction pass
  (`docs/standards-code-cleanup-report.md`, June 2026), which validated every
  Grade 6 code against the official framework. Exact wording, boundaries, and
  external review requirements were not independently reverified in this pass.
- **Grade 6 standard count:** 22, across four disciplines: Earth and Space
  Science (4), Life Science (5), Physical Science (7), Technology/Engineering (6).
- **Generated:** 2026-09-14 (regenerated from a full repository badge scan;
  supersedes the 2026-06-30 / 2026-07-14 version of this file).
- This is a documentation/audit pass only. No lesson or page files were modified.

**Coverage depth definitions:**

- **Primary** - a lesson or assessed experience is built around this standard.
  This is an instructional mapping label, not proof of complete PE performance
  or student mastery. A badge or goal alone is not assessment evidence.
- **Partial** - the standard is touched or applied but is not the focus of a
  dedicated lesson.
- **Tangential** - incidental mention only.

## Grade 6 integration theme (from the framework)

**Structure and Function.** The integration of Earth and space, life, and
physical sciences with technology/engineering gives Grade 6 students
opportunities with natural phenomena and design problems that highlight the
relationship of structure and function, from the microscopic (cells, particles)
to the macroscopic (Earth features, waves, engineered materials).

---

## Summary Table

Files listed are repository-root HTML pages unless noted. Lessons built through
the lesson-build pipeline also exist as `lesson-sources/` canonical sources and
`app/lessons/` v2 outputs; the root file is cited as the public delivery page.

### Earth and Space Sciences (6.MS-ESS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 6.MS-ESS1-1a | Develop and use a model of the Earth-Sun-Moon system to explain lunar phases and solar/lunar eclipses | Primary | lesson_sun-earth-moon.html, lesson_phases-of-the-moon.html, lesson_eclipses.html, simulation_eclipse-alignment.html, extension_moon-tonight.html | Strong three-lesson cluster plus simulation. All badges corrected to `6.MS-ESS1-1a` in the June 2026 cleanup. extension_moon-tonight carries no badge (observation extension). |
| 6.MS-ESS1-4 | Analyze rock layers and index fossils to determine relative ages of rock formations | Primary | lesson_layers-of-time.html, extension_fossil-hunt.html, game_layer-detective.html | Superposition and relative dating addressed; game and extension reinforce. game_layer-detective now uses `6.MS-ESS1-4`; the original badge defect is resolved. |
| 6.MS-ESS1-5(MA) | Use graphical displays to show Earth and its solar system are one of many in the Milky Way, one of billions of galaxies | Primary | lesson_earths-place-in-the-universe.html | Nested-scale model lesson (Earth to solar system to galaxy to universe). Published 2026-07-14. |
| 6.MS-ESS2-3 | Analyze maps of fossils, rocks, continental shapes, and seafloor structures as evidence of plate movement | Primary | lesson_continental-drift.html; Partial: lesson_plate-tectonics.html | Continental Drift carries the PE (Wegener evidence). Plate Tectonics (a Grade 7 lesson, 7.MS-ESS2-2) also badges 6.MS-ESS2-3 as its foundation; the Grade 6 assessed treatment stays within the boundary (evidence, not mechanism). |

### Life Science (6.MS-LS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 6.MS-LS1-1 | Provide evidence that all organisms (unicellular and multicellular) are made of cells | Primary | lesson_what-is-life.html, lesson_cell-types.html, investigation_gray-zone.html, extension_virus.html, game_is-it-alive.html, game_cell-explorer.html, game_cellular-showdown.html | Deepest coverage in the catalog: two lessons, an investigation, an extension, three games. |
| 6.MS-LS1-2 | Develop and use a model of how cell parts contribute to cellular functions | Primary | lesson_organelles.html, lesson_cell-types.html, investigation_cell-energy.html, investigation_protein-pathway.html, extension_neuron-explorer.html, game_cell-explorer.html, game_cellular-showdown.html | Organelles is the anchor lesson. Review ATP and biochemical-step depth in supporting tasks against the assessment boundary; Cell Energy labels 8.MS-LS1-7 enrichment, but labels alone do not establish boundary compliance. |
| 6.MS-LS1-3 | Argue from evidence that body systems interact to carry out essential functions | Primary | lesson_body-systems.html, lesson_cell-types.html, extension_body-systems.html, extension_neuron-explorer.html, game_exercise.html, system_*.html (8 files), disease_*.html (8 files) | Very rich strand: core lesson plus 8 body-system pages and 8 disease pages. Emphasis on interactions matches the standard. Disease pages also carry a labeled 8.MS-LS1-7 enrichment badge. |
| 6.MS-LS4-1 | Analyze fossil-record evidence of organisms, extinctions, and changes to life forms | Primary | lesson_biological-evolution.html, extension_chernobyl-frogs.html | Fossil interpretation exists; systematic fossil-record analysis and the prominence of natural-selection mechanisms require review. Badge cleanup does not establish that mechanism content is excluded. |
| 6.MS-LS4-2 | Use anatomical structures to argue evolutionary relationships among fossil and modern organisms | Primary | lesson_biological-evolution.html, extension_chernobyl-frogs.html | Anatomical comparison and a written whale-origin CER exist. Review the lesson's substantial natural-selection mechanism content and assessment emphasis against grade boundaries. |

### Physical Science (6.MS-PS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 6.MS-PS1-6 | Plan and conduct an experiment on exothermic and endothermic reactions and thermal energy transfer | Primary | lesson_chemical-reactions.html | Substantial instruction, but the PE's plan-and-conduct investigation performance is missing. The lesson also carries a clearly labeled 8.MS-PS1-5 enrichment strand (atoms rearranged); Grade 6 assessed content is reactants/products and energy in/out. A student-planned and conducted exo/endo investigation is needed to address that missing performance. |
| 6.MS-PS1-7(MA) | Particulate model of density; proportional reasoning to compare relative densities | Primary | lesson_measuring-matter.html, lesson_physical-properties.html | On-grade particulate ("particles") framing. |
| 6.MS-PS1-8(MA) | Show many materials are mixtures of pure substances separable by physical means | Primary | lesson_pure-substances-and-mixtures.html, lesson_physical-properties.html | Keep "pure substance" at the particle level in assessed content (see Notes & Caveats). |
| 6.MS-PS2-4 | Evidence that gravitational forces are attractive and noticeable only with very large mass | Primary | lesson_gravity.html, lesson_sun-earth-moon.html, simulation_gravity-wells.html | Gravity lesson carries the claim-and-evidence core; Sun-Earth-Moon reinforces; gravity-wells simulation extends (its un-prefixed MS-ESS1-2 tag remains an unresolved curriculum-review item - see Notes & Caveats). |
| 6.MS-PS4-1 | Diagram a simple wave: amplitude, frequency, wavelength; amplitude relates to energy | Primary | lesson_nature-of-waves.html, lesson_wave-behavior.html, lesson_digital-signals.html, investigation_amplitude-challenge.html | Gold-standard cluster (Nature of Waves is a Grade 6 gold-standard lesson). |
| 6.MS-PS4-2 | Show light rays and mechanical waves are reflected, absorbed, or transmitted | Primary | lesson_wave-behavior.html, investigation_amplitude-challenge.html; Tangential: game_photon-runner.html | Qualitative, on grade. Photon Runner reinforces light behavior but carries no badge. |
| 6.MS-PS4-3 | Support the claim that digitized signals (wave pulses as 0s and 1s) encode and transmit information | Primary | lesson_digital-signals.html | Stays qualitative per the assessment boundary. Digital Signals is a Grade 6 gold-standard lesson. |

### Technology/Engineering (6.MS-ETS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 6.MS-ETS1-1 | Define criteria and constraints of a design problem, including impacts on people and environment | Primary | lesson_engineering-design.html; Partial: challenge_welcome-to-floatia.html | Core lesson carries the PE; Floatia applies it (applied, not re-taught, per its educator notes). |
| 6.MS-ETS1-5(MA) | Create visual representations of solutions; interpret and apply scale and proportion | Primary | lesson_designing-to-scale.html; Partial: challenge_welcome-to-floatia.html | Dedicated lesson published 2026-07-13; applied in the capstone. |
| 6.MS-ETS1-6(MA) | Communicate a design solution to an intended user, including features and limitations | Primary | lesson_engineering-design.html | Badged on the engineering-design lesson; Floatia's "explain and defend your decisions" stage generates additional communication evidence. |
| 6.MS-ETS2-1(MA) | Analyze and compare properties of metals, plastics, wood, and ceramics | Primary | lesson_choosing-materials.html; Partial: challenge_welcome-to-floatia.html | Dedicated lesson published 2026-07-13. |
| 6.MS-ETS2-2(MA) | Select appropriate materials based on properties needed in a solution | Primary | lesson_choosing-materials.html; Partial: challenge_welcome-to-floatia.html | Now taught AND assessed in Choosing Materials (signature interactive assesses property-first material selection; closing constructed-response prompt generates ETS2-2 evidence). Applied as a supporting skill in Floatia. Instructional mapping expanded since the 2026-07-14 map; full performance evaluation remains distinct. |
| 6.MS-ETS2-3(MA) | Use measuring tools, hand tools, fasteners, and power tools to construct a prototype | Primary | challenge_welcome-to-floatia.html | Floatia targets prototype building, testing, refinement, and defense. Complete tool-use performance and individual evaluation remain under review. Capstone-only coverage - no standalone tools-and-fabrication lesson (see Notes & Caveats). Instructional mapping expanded since the 2026-07-14 map; full performance evaluation remains distinct. |

---

## Coverage by Strand

Percentages below count retained Primary instructional-map labels, not
complete PE performance or measured student mastery.

| Strand | Standards | Primary coverage | Estimate |
|---|---|---|---|
| Physical Science (PS) | 7 | 7 of 7 | **100%** |
| Life Science (LS) | 5 | 5 of 5 | **100%** |
| Earth and Space Science (ESS) | 4 | 4 of 4 | **100%** |
| Technology/Engineering (ETS) | 6 | 6 of 6 | **100%** (ETS2-3 is capstone-only; see Gap List) |

**Current map: 22 of 22 standards are classified Primary for instructional
coverage.** All have meaningful mapped instruction. This is not a claim that
all 22 complete performance expectations have been demonstrated. The earlier
map classified 20 as Primary; Choosing Materials and Floatia supplied additional
instructional/performance opportunities for ETS2-2(MA) and ETS2-3(MA).

The Phase 1 repository audit found **16 strongly supported instructional
classifications**, **five requiring review or qualification**, and **PS1-6
with substantial instruction but missing required investigation performance**.
These are internal audit judgments, not a new official classification system.

| Standards requiring qualification | Repository evidence and remaining question |
|---|---|
| 6.MS-ESS1-5(MA) | Students use supplied nested graphical displays and explain the nesting; independent graphical representation is less evident. |
| 6.MS-LS4-1 | Transitional-fossil interpretation exists; systematic fossil-record analysis and grade-boundary balance need review. |
| 6.MS-LS4-2 | Written anatomical-evidence CER exists; surrounding mechanism content and assessment emphasis require grade-boundary review. |
| 6.MS-ETS1-6(MA) | Floatia requires design defense; intended-user communication, limitations, and evaluation criteria need clearer tracing. |
| 6.MS-ETS2-3(MA) | Physical prototypes, tests, and redesign exist; complete tool-performance evidence and individual evaluation need review. |
| 6.MS-PS1-6 | Classification and energy-transfer explanation are taught; planning and conducting the reaction investigation are not implemented. |

---

## Gap List

**No Grade 6 standard lacks meaningful mapped instruction.** Remaining work
includes performance and assessment gaps, not merely documentation polish:

### Technology/Engineering

1. **6.MS-ETS2-3(MA) - capstone-only.** The map's primary anchor is the Floatia
   challenge; ball-run provides additional unbadged prototyping practice. There is no standalone tools, measurement, and safe-fabrication
   lesson. If reviewers ask where tool skills are *taught* (not just assessed),
   this is the thinnest point in the map. The ball-run challenge sequence
   (challenge_ball-run_day1-5.html, challenge_slow-motion-ball-run.html) is
   hands-on prototyping with trial records and revisions but carries no
   standards badges. Review the actual tool-use and assessment evidence; adding
   a badge alone does not close a performance gap.

### Physical Science

2. **6.MS-PS1-6 - "plan and conduct an experiment" evidence.** The PE verb is
   experimental; the lesson provides relevant instruction and selected-response
   assessment, but no student-planned and conducted reaction investigation.
   This is a substantive missing performance, not absence of instruction.

### Cross-strand

3. **Strengthen existing writing and its evaluation, do not duplicate it.**
   `lesson-sources/lesson_body-systems.html` (`bs-thinking`) requires a written
   explanation tracing at least three systems during a sprint. Strengthen its
   explicit claim/evidence reasoning and teacher evaluation guidance.
   `lesson-sources/lesson_biological-evolution.html` (`be-thinking`) already
   requires a whale-origin claim, anatomical/fossil evidence, and reasoning.
   Add evaluation/retention guidance rather than a second written argument.
   Both tasks have model answers and are not automatically scored. Their
   inspected authenticated `lessonQuiz.finalize` calls send selected answers,
   not the written responses; legacy public submission code includes a
   `thinking` field. Production receipt was not tested.

---

## Anchor Lesson Candidates

Standards with multiple Primary/supporting files, or lessons that are the clear
flagship of their strand - strongest candidates for the HQIM submission
narrative:

- **Cells cluster (6.MS-LS1-1, LS1-2)** - lesson_what-is-life.html (gold
  standard), lesson_cell-types.html, lesson_organelles.html, plus 3
  investigations, 2 extensions, 3 games. The deepest multi-modal coverage in
  the catalog.
- **Body systems cluster (6.MS-LS1-3)** - lesson_body-systems.html plus 8
  system pages, 8 disease pages, 2 extensions, 1 game. Demonstrates
  breadth-with-coherence.
- **Waves cluster (6.MS-PS4-1, PS4-2, PS4-3)** - lesson_nature-of-waves.html,
  lesson_wave-behavior.html, lesson_digital-signals.html (three of the four
  Grade 6 gold-standard lessons) plus investigation_amplitude-challenge.html.
  The strongest lesson-architecture exemplars.
- **Earth-Sun-Moon cluster (6.MS-ESS1-1a, PS2-4)** - three lessons, a
  simulation, and an observation extension around one modeling standard, with
  gravity woven in.
- **Engineering arc (6.MS-ETS1-1 through ETS2-3)** - lesson_engineering-design,
  lesson_designing-to-scale, lesson_choosing-materials feeding the Welcome to
  Floatia capstone, which applies (without re-teaching) the earlier standards
  and assesses ETS2-3. A clean learn-then-apply progression for the narrative.
- **Matter cluster (6.MS-PS1-7(MA), PS1-8(MA))** - lesson_measuring-matter,
  lesson_physical-properties, lesson_pure-substances-and-mixtures, three
  mutually reinforcing lessons on the particulate model.

---

## Notes & Caveats

1. **Framework version.** Standards list, wording, clarifications, and
   assessment boundaries are the Massachusetts 2016 STE Framework (Grade 6,
   pp. 54-59), as validated by the repo's June 2026 standards-code cleanup.
   Standards NGSS places in middle school but Massachusetts assigns to Grade 7
   or 8 (ESS2-1/2/4/5/6, ESS3-*, LS1-4/5/6/7, LS2-*, PS1-1/2/4/5, PS2-3/5,
   PS3-*, ETS1-2, ETS3-*) are intentionally excluded; repo pages carrying those
   codes are Grade 7/8 lessons, not Grade 6 gaps.
2. **Original mapping method.** The earlier map used explicit
   `6.MS-*` badge/goal-card codes in each page (machine-scanned across all root
   HTML). Depth (Primary vs Partial) was judged from each page's learning-goal
   cards and educator notes, not inferred from topic alone. The Phase 1
   qualifications above additionally inspect student tasks and assessment code;
   the earlier badge/goal method cannot establish complete PE performance.
3. **Badge status.** Original defects in game_layer-detective.html,
   investigation_amplitude-challenge.html, and investigation_cell-energy.html
   are resolved (`6.MS-ESS1-4`, `6.MS-PS4-1/2`, and `7.MS-LS2-3`). Remaining
   curriculum-review items are simulation_gravity-wells.html (`MS-ESS1-2`)
   and simulation_floatlandia-fracture.html (`ESS1-4`, `ESS2-2`), including
   tooltip descriptions. Replacement codes are not decided by this pass.
4. **Some enrichment is explicitly labeled; grade boundaries still need review.** lesson_chemical-reactions
   frames atomic rearrangement as explicit 8.MS-PS1-5 enrichment;
   investigation_cell-energy and the disease pages label 8.MS-LS1-7; the former
   off-grade extension_hidden-world-of-matter was re-leveled to Grade 8
   (8.MS-PS1-1). Review actual assessed wording in the matter lessons and the
   natural-selection content in Biological Evolution. Lexical counts are not
   evidence of instructional depth or grade-boundary compliance.
5. **Alignment inferred rather than badged.** extension_moon-tonight.html,
   game_evolution-clicker.html, game_photon-runner.html, and the ball-run
   challenge pages carry no standards codes; their mapping above (where listed)
   is inferred from content. game_evolution-clicker is tagged Grade 8 and is
   excluded from Grade 6 coverage. Games support More Learning but are outside
   the formal curriculum, so no coverage claim rests on a game alone.
6. **Pages with no standards mapping.** lesson_conducting-experiments.html
   (Grade 6) is a science-practices lesson with no PE badge - it supports the
   framework's practices strand rather than a specific Grade 6 PE.
   lesson_ragebaiting.html, body-system-interactions.html, and
   body-system-diseases.html are hub/media pages, not standards-bearing
   lessons. Grade 7 systems lessons (technology-and-society,
   innovation-and-sustainability, etc.) are out of scope here.
7. **File duality.** Lessons in the build pipeline exist three times
   (lesson-sources/ canonical, root v1, app/lessons/ v2). Standards content is
   identical by build invariant; this map cites the root v1 public page.
