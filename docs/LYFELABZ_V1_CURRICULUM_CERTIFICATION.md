# LyfeLabz V1 Curriculum Certification

**Certification date:** 2026-07-14

---

## Purpose

This document is the official record of the published LyfeLabz V1 curriculum immediately
before V1 Stabilization begins.

It describes what the curriculum contains, what it does not contain, and why. It
records the major governance decisions that shaped the published scope. It does not
describe platform engineering, teacher dashboard work, or Firebase infrastructure,
which are governed by the separate platform certification (`LYFELABZ_TECHNICAL_CERTIFICATION_V1.md`)
and the platform sprint documentation.

This document becomes the single source of truth for the published curriculum. Future
curriculum work should reference it to understand what was published, what was deferred,
and why those lines were drawn.

---

## Scope

This certification applies only to the publicly accessible instructional curriculum
served at `lyfelabz.com`. It covers:

- 50 core instructional lessons (`lesson_*.html`)
- Supporting instructional resources: investigations, simulations, extensions, games,
  and engineering challenges
- Supplemental and enrichment content that ships with the published curriculum
- The published Grade 6 and Grade 7 engineering sequences

It does not cover:

- Platform engineering (Firebase, Google Classroom integration, LMS pipeline)
- Teacher workspace or dashboard features
- V2 implementation work
- Unpublished or in-progress lesson drafts

Where a curriculum decision touches a future state, this document names the decision
and defers the work rather than speculating about implementation.

---

## Curriculum Philosophy

### HQIM

LyfeLabz is built to High Quality Instructional Materials standards. A lesson is high
quality when a curious middle school student can learn from it independently, build an
accurate mental model, and return to it to study.

The HQIM framework is documented in `HQIM_LESSON_FRAMEWORK.md`. It defines 17 required
instructional elements for a flagship lesson, including:

- A driving question stated in the hero
- An anchoring phenomenon the question is about
- A prediction gate before the Key Idea reveal
- Productive struggle, always resolved
- Misconception checkpoints where known wrong ideas exist
- A Quick Recall retrieval check
- A student-constructed explanation (Show Your Thinking)
- A wrap-up that answers the driving question
- A 10-question quiz with explanations and balanced answer options
- Mastery-oriented quiz flow (100% advances to More Learning; partial score holds;
  Try Again resets cleanly)
- More Learning and Connections sections

The gold standard implementation is `lesson_earths-layers.html`. Every lesson
converges on this pattern.

### Lesson Architecture

All 50 core lessons implement the complete canonical instructional architecture:

- Beneath-hero Learning Science Focus (`.ls-focus`) -- 50 / 50
- Show Your Thinking (`.think-box`) -- 50 / 50
- Educator Mode (`.edu-note` infrastructure) -- 50 / 50
- Quiz, More Learning, Connections ending -- 50 / 50
- Student-facing sticky navigation -- 50 / 50

The Canonical Architecture Baseline is documented in `CANONICAL_ARCHITECTURE_BASELINE.md`.

### Instructional Archetypes

The curriculum organizes around five instructional archetypes, documented in
`LYFELABZ_INSTRUCTIONAL_ARCHETYPES.md`. The archetypes describe the kind of thinking
a lesson is built to carry rather than its topic:

1. **Phenomenon and Mechanism** -- Why does this happen? Build a cause-and-effect model.
2. **Systems and Cycles** -- How do the parts interact? Trace flows and cascading change.
3. **Evidence and Inference** -- How do we know? Reconstruct the unseen from clues.
4. **Classification and Identity** -- What is it, and how can we tell? Apply criteria.
5. **Design and Decisions** -- What should we build or choose, and at what cost? Weigh
   constraints and tradeoffs.

The five archetypes are confirmed by independent signals: the driving questions, the
interactives each lesson leans on, and the misconceptions each lesson must confront.
The supporting resource library maps to the same five, which is independent confirmation
that the clusters are real.

### Supporting Concept Principle

Standards drive the curriculum. However, supporting concepts needed to understand a
standard are not prohibited simply because they formally appear at another grade level.
Lessons may include supporting concepts beyond the exact wording of a performance
expectation when those concepts are necessary for conceptual understanding.

Badge conservatively. Badge only standards whose performance expectations are
intentionally addressed and assessed. Supporting content taught liberally does not
claim a badge for the grade level it came from.

### Standards Philosophy

LyfeLabz uses the Massachusetts 2016 Science and Technology/Engineering Framework as
the authoritative source. All standard codes use the Massachusetts grade-prefixed format
(`6.MS-XXX-n`, `7.MS-XXX-n`, `8.MS-XXX-n`). NGSS codes without grade prefixes are not
used as the primary alignment claim.

The canonical standards documentation is:

- `docs/grade6-coverage-map.md` -- Grade 6 standards inventory and coverage matrix
- `docs/grade6-standards-alignment-audit-v2.md` -- Detailed audit with DESE source
  citations for every standard placement
- `docs/evolution-standards-alignment-report.md` -- Evolution standards alignment pass
- `docs/hqim-grade6-readiness-audit.md` -- HQIM readiness evaluation

### Supplemental Content Philosophy

The published curriculum includes instructional content that extends beyond the exact
scope of the Massachusetts 2016 STE performance expectations. This content falls into
two categories:

**Above-grade enrichment** -- content from a higher grade level, clearly labeled, that
deepens understanding of a related on-grade concept. Examples: natural selection
(8.MS-LS4-4) appearing in the Grade 6 evolution resources as a "Future Learning
Connection"; Grade 8 matter content in the Hidden World of Matter extension.

**Unbadged enrichment** -- content that does not correspond to a specific Massachusetts
STE performance expectation but serves clear instructional purposes. Examples: the
engineering enrichment cluster (technology and society, innovation and sustainability),
the Behavioral Science section.

---

## Grade 6 Published Curriculum

### Unit 1 -- Cells: The Structure of Life

**Standards:** 6.MS-LS1-1, 6.MS-LS1-2

**Core lessons:**
- `lesson_what-is-life.html` -- Characteristics of life; virus as a boundary case.
  Classification and Identity archetype.
- `lesson_cell-types.html` -- Unicellular vs multicellular; prokaryotic vs eukaryotic.
  Classification and Identity archetype.
- `lesson_organelles.html` -- How organelles work together to keep a cell alive.
  Systems and Cycles archetype.

**Supporting experiences:**
- `investigation_gray-zone.html` -- CER investigation: is it alive? (viruses, prions,
  fire)
- `investigation_cell-energy.html` -- Cellular energy; photosynthesis at the organelle
  level. Labeled 6.MS-LS1-2 (cell parts contributing to function) with the protein-
  synthesis section noted as above-grade enrichment (8.MS-LS1-7).
- `investigation_protein-pathway.html` -- How proteins are made; organelle functions
  in sequence.
- `extension_virus.html` -- Virus structure and replication.
- `game_is-it-alive.html` -- Living / not alive classification game.
- `game_cell-explorer.html` -- Cell parts identification game.
- `game_cellular-showdown.html` -- Cell comparison game.

### Unit 2 -- Body Systems

**Standard:** 6.MS-LS1-3

**Core lesson:**
- `lesson_body-systems.html` -- How body systems interact to carry out essential life
  functions. Systems and Cycles archetype.

**Supporting experiences:**
- `extension_body-systems.html` -- Body systems extension.
- `extension_neuron-explorer.html` -- Neuron structure; bridges cell functions and
  nervous system.
- `game_exercise.html` -- Body systems in action during exercise.
- `body-system-interactions.html` -- Navigation hub linking to individual system pages.
- `body-system-diseases.html` -- System disorders hub.
- `system_circulatory.html`, `system_digestive.html`, `system_excretory.html`,
  `system_immune.html`, `system_muscular.html`, `system_nervous.html`,
  `system_respiratory.html`, `system_skeletal.html` -- Eight individual organ system
  reference pages.
- `disease_circulatory.html`, `disease_digestive.html`, `disease_excretory.html`,
  `disease_immune.html`, `disease_muscular.html`, `disease_nervous.html`,
  `disease_respiratory.html`, `disease_skeletal.html` -- Eight disease pages, one
  per system.

### Unit 3 -- Evolution and the Fossil Record

**Standards:** 6.MS-LS4-1, 6.MS-LS4-2

**Core lesson:**
- `lesson_biological-evolution.html` -- Fossil record evidence and anatomical
  structures as evidence for evolutionary relationships (6.MS-LS4-1, 6.MS-LS4-2).
  Natural selection mechanism is taught as supporting context and labeled as Grade 8
  content (8.MS-LS4-4). Evidence and Inference archetype (primary); Mechanism secondary.

**Supporting experiences:**
- `extension_chernobyl-frogs.html` -- Rapid color change in radiation zones; labeled
  as a Grade 6 evidence extension (6.MS-LS4-1, 6.MS-LS4-2) with an Above-Grade
  Science Connection notice for the natural selection reasoning.
- `extension_fossil-hunt.html` -- Index fossil and rock-layer sequencing (6.MS-ESS1-4).
- `game_evolution-clicker.html` -- Natural selection game; labeled Grade 8 enrichment
  (8.MS-LS4-4) with a Future Learning Connection notice.
- `simulation_beetle-island.html` -- Natural selection simulation; labeled Grade 8
  enrichment (8.MS-LS4-4) with a Future Learning Connection notice.

### Unit 4 -- Matter and Its Properties

**Standards:** 6.MS-PS1-6, 6.MS-PS1-7(MA), 6.MS-PS1-8(MA)

**Core lessons:**
- `lesson_measuring-matter.html` -- Density; particulate model; proportional
  reasoning. Classification and Identity archetype.
- `lesson_physical-properties.html` -- Physical properties used to classify materials;
  separating mixtures. Classification and Identity archetype.
- `lesson_pure-substances-and-mixtures.html` -- Pure substances and mixtures separable
  by physical means. Classification and Identity archetype.
- `lesson_chemical-reactions.html` -- Exothermic and endothermic reactions; thermal
  energy transfer. The on-grade goal (6.MS-PS1-6) is badged; atomic mechanism content
  is taught as above-grade supporting context and not badged. Classification and
  Identity archetype.

**Supporting experiences:**
- `extension_hidden-world-of-matter.html` -- Repositioned as a Grade 8 "Looking Ahead"
  extension (8.MS-PS1-1). Preserved intact; removed from Grade 6 core coverage.

### Unit 5 -- Waves and Information Transfer

**Standards:** 6.MS-PS4-1, 6.MS-PS4-2, 6.MS-PS4-3

**Core lessons:**
- `lesson_nature-of-waves.html` -- Wave anatomy: amplitude, frequency, wavelength,
  energy relationship. Phenomenon and Mechanism archetype.
- `lesson_wave-behavior.html` -- Reflection, absorption, and transmission through
  materials. Phenomenon and Mechanism archetype.
- `lesson_digital-signals.html` -- Digitized signals, binary encoding, noise immunity.
  Phenomenon and Mechanism archetype.

**Supporting experiences:**
- `investigation_amplitude-challenge.html` -- CER investigation of the amplitude-energy
  relationship (6.MS-PS4-1, 6.MS-PS4-2).
- `game_photon-runner.html` -- Light and wave game.

### Unit 6 -- Earth and Space

**Standards:** 6.MS-ESS1-1a, 6.MS-ESS1-4, 6.MS-ESS1-5(MA), 6.MS-ESS2-3, 6.MS-PS2-4

**Core lessons:**
- `lesson_layers-of-time.html` -- Rock layers, index fossils, relative dating, laws of
  superposition and crosscutting relationships. Evidence and Inference archetype.
- `lesson_continental-drift.html` -- Wegener's evidence; continental drift as the
  inference from fossil and geological maps. Evidence and Inference archetype.
- `lesson_gravity.html` -- Gravitational force is attractive and noticeable only with
  large mass. Phenomenon and Mechanism archetype.
- `lesson_sun-earth-moon.html` -- Earth-Sun-Moon system; orbital motion. Phenomenon
  and Mechanism archetype.
- `lesson_phases-of-the-moon.html` -- Lunar phases; relative positions. Phenomenon
  and Mechanism archetype.
- `lesson_eclipses.html` -- Solar and lunar eclipses; orbital alignment conditions.
  Phenomenon and Mechanism archetype.
- `lesson_earths-place-in-the-universe.html` -- Earth's solar system as one of many
  in the Milky Way; the Milky Way as one of billions of galaxies. Nested scale model.
  Phenomenon and Mechanism archetype. Published in V1 Curriculum Governance.

**Supporting experiences:**
- `simulation_eclipse-alignment.html` -- Interactive orbital tilt and node simulation.
- `simulation_gravity-wells.html` -- Gravity as an attractive force; orbital motion.
- `simulation_floatlandia-fracture.html` -- Evidence-building scenario for continental
  drift.
- `extension_moon-tonight.html` -- Real-world moon phase observation using live date
  and phase logic.
- `extension_fossil-hunt.html` -- Index fossil and rock-layer game (also listed under
  Unit 3).
- `game_layer-detective.html` -- Geologic sequencing game.

### Unit 7 -- Engineering, Materials, and Design

**Standards:** 6.MS-ETS1-1, 6.MS-ETS1-5(MA), 6.MS-ETS1-6(MA), 6.MS-ETS2-1(MA),
6.MS-ETS2-3(MA)

**Core lessons:**
- `lesson_conducting-experiments.html` -- Scientific practices; how trustworthy evidence
  is produced. Evidence and Inference archetype.
- `lesson_engineering-design.html` -- Defining design criteria and constraints;
  communicating a design solution. Design and Decisions archetype.
- `lesson_choosing-materials.html` -- Comparing material properties (metals, plastics,
  wood, ceramics) and selecting materials for a design task. Design and Decisions
  archetype. Published in V1 Governance.
- `lesson_designing-to-scale.html` -- Scale drawings; proportion; communicating a
  design so anyone can follow it. Design and Decisions archetype. Published in V1
  Governance.

**Engineering Challenge (capstone):**
- `challenge_welcome-to-floatia.html` -- Grade 6 engineering capstone ("Build-a-Boat").
  Synthesizes the three engineering lessons into a seven-stage design challenge.
  Primary assessed standard: 6.MS-ETS2-3(MA).

**Standards coverage note:** 6.MS-ETS2-2(MA) (select materials by required properties)
and 6.MS-ETS2-3(MA) at the lesson level (tools and prototyping) are addressed through
the Floatia capstone rather than standalone lessons. Full dedicated lesson coverage of
these two standards remains a known gap.

---

## Grade 7 Published Curriculum

The Grade 7 gold standard is `lesson_earths-layers.html`. All Grade 7 lessons converge
on its instructional architecture. The canonical classroom mode uses Mr. Kankel and
Mr. Rovner, blocks A-G.

### Unit 1 -- Earth Systems

**Standards cluster:** 7.MS-ESS2-2, 7.MS-ESS3-x

**Core lessons:**
- `lesson_earths-layers.html` -- Earth's internal structure; convection drives surface
  change. Gold standard. Phenomenon and Mechanism archetype.
- `lesson_plate-tectonics.html` -- Why Earth's surface moves; convection currents;
  plate boundaries. Phenomenon and Mechanism archetype.
- `lesson_earthquakes.html` -- Why earthquakes occur at plate boundaries; seismic waves.
  Phenomenon and Mechanism archetype.
- `lesson_types-of-volcanoes.html` -- Volcanic types and their relationship to plate
  boundaries. Phenomenon and Mechanism archetype.
- `lesson_hotspot-volcanoes.html` -- Hotspot volcanism as evidence for plate motion.
  Phenomenon and Mechanism archetype.
- `lesson_weathering-and-erosion.html` -- How rocks break down and move to reshape
  Earth's surface. Phenomenon and Mechanism archetype.

**Supporting experiences:**
- `simulation_floatlandia-fracture.html` -- Evidence-building for continental drift
  and Earth systems (shared with Grade 6 Unit 6).
- `game_layer-detective.html` -- Rock-layer sequencing (shared with Grade 6 Unit 6).

### Unit 2 -- Water Systems

**Standard:** 7.MS-ESS2-4

**Core lesson:**
- `lesson_water-cycle.html` -- Water cycling among ocean, air, land, and living things.
  Systems and Cycles archetype (primary); Phenomenon and Mechanism secondary.

### Unit 3 -- Human Impacts

**Standards:** 7.MS-LS2-4, 7.MS-LS2-6(MA), 7.MS-ESS3-x

**Core lessons:**
- `lesson_human-impacts.html` -- How human activities disrupt ecosystems; runoff,
  algae blooms, cascading system failure. Systems and Cycles archetype.
- `lesson_renewable-and-nonrenewable-resources.html` -- Resource types and
  sustainability tradeoffs. Systems and Cycles archetype.

### Unit 4 -- Ecosystems

**Standards:** 7.MS-LS2-2, 7.MS-LS2-3, 7.MS-LS1-6

**Core lessons:**
- `lesson_parts-of-an-ecosystem.html` -- Biotic and abiotic factors; levels of
  organization; predation, competition, symbiosis. Systems and Cycles archetype.
- `lesson_energy-flow.html` -- Energy transfer through food webs; 10% rule.
  Systems and Cycles archetype.
- `lesson_carbon-cycle.html` -- Carbon cycling among living and nonliving parts.
  Systems and Cycles archetype.
- `lesson_photosynthesis.html` -- How plants build themselves from air, water, and
  sunlight. Phenomenon and Mechanism archetype.
- `lesson_reproductive-success.html` -- Reproductive success as the mechanism that
  allows natural selection to operate. Phenomenon and Mechanism archetype.

**Supporting experiences:**
- `investigation_population-patterns.html` -- Population dynamics investigation.
  Remains an Investigation (see Curriculum Governance Decisions).

### Unit 5 -- Ecosystem Stability

**Standard:** 7.MS-LS2-x

**Core lesson:**
- `lesson_ecosystem-stability.html` -- How ecosystems resist and recover from
  disturbance; feedback and balance. Systems and Cycles archetype.

### Unit 6 -- Energy Systems

**Standards:** 7.MS-PS3-4, 7.MS-PS3-5, 7.MS-PS3-6(MA), 7.MS-PS3-7(MA), 7.MS-PS2-3,
7.MS-PS2-5

**Core lessons:**
- `lesson_forms-of-energy.html` -- Energy forms and transformation; conservation.
  Phenomenon and Mechanism archetype.
- `lesson_energy-transfer.html` -- Kinetic energy transfers between objects; collisions.
  Phenomenon and Mechanism archetype.
- `lesson_heat-transfer.html` -- Thermal energy flows from warmer to cooler through
  conduction, convection, and radiation. Phenomenon and Mechanism archetype.
- `lesson_introduction-to-electricity.html` -- Static electricity; only electrons move;
  the spark as miniature lightning. Phenomenon and Mechanism archetype.

### Unit 7 -- Engineering Systems

**Standards:** 7.MS-ETS3-x, 7.MS-ETS1-2

**Core lessons:**
- `lesson_engineering-systems.html` -- Systems engineering; inputs, processes, outputs,
  feedback. Systems and Cycles archetype.
- `lesson_structural-systems.html` -- How structural systems manage loads and forces.
  Systems and Cycles archetype.
- `lesson_transportation-systems.html` -- Transportation networks as engineered systems.
  Systems and Cycles archetype.
- `lesson_communication-systems.html` -- Communication systems; signal transmission.
  Systems and Cycles archetype.
- `lesson_design-tradeoffs.html` -- Decision matrices; competing design priorities.
  Design and Decisions archetype. Standard: 7.MS-ETS1-2.

**Enrichment (unbadged):**
- `lesson_technology-and-society.html` -- How one technology spreads through connected
  parts of society; benefits and costs. No MA STE badge (enrichment).
- `lesson_innovation-and-sustainability.html` -- Iterative improvement toward more
  sustainable solutions; tradeoffs. No MA STE badge (enrichment).

---

## Supplemental Curriculum

### Behavioral Science

LyfeLabz includes a Behavioral Science section accessible through a hidden interaction
on the homepage (the `psych-locked` reveal). This section is intentionally supplemental
to the Massachusetts STE curriculum. It is not aligned to MA STE performance
expectations and carries no standards badges.

Published Behavioral Science content:
- `lesson_ragebaiting.html` -- How outrage is engineered online; why the brain falls
  for it; becoming a smarter media consumer. Phenomenon and Mechanism archetype
  (amygdala hijack and engagement cycle). Grade 6 classroom mode (Mr. Brown / Ms. Gay).

Planned but not yet built:
- Cognitive Biases unit (placeholder in the index)
- Emotional Regulation and Social Influence unit (placeholder in the index)

The Behavioral Science section is preserved in V1 because it serves a genuine
instructional purpose not addressed by the STE curriculum, and student engagement
with it has been strong. It is clearly distinguished from the STE curriculum through
its own section identity and the hidden reveal mechanism.

### Hidden and Enrichment Supplemental Content

The repository contains instructional resources accessible as extensions or enrichment
that extend beyond the published catalog:

- `wonderbox/` -- A collection of deep-dive topics for curious students. Not formally
  cataloged in the main index.

---

## Published Engineering Sequence

### Grade 6 Engineering Progression

The Grade 6 engineering sequence builds from the design process through materials
selection to scale drawing, culminating in a design challenge.

1. `lesson_conducting-experiments.html` -- Science practices; evidence-based reasoning.
2. `lesson_engineering-design.html` -- Design criteria, constraints, and communication
   (6.MS-ETS1-1, 6.MS-ETS1-6(MA)).
3. `lesson_choosing-materials.html` -- Material property comparison and selection
   (6.MS-ETS2-1(MA)). Published in V1 Governance.
4. `lesson_designing-to-scale.html` -- Scale drawings and proportion
   (6.MS-ETS1-5(MA)). Published in V1 Governance.
5. `challenge_welcome-to-floatia.html` -- "Build-a-Boat" capstone engineering challenge.
   Seven-stage challenge: Understand, Criteria/Constraints, Materials, Scale,
   Build/Test, Defend, Improve. Assessed standard: 6.MS-ETS2-3(MA).

The Floatia challenge is the first resource of the Engineering Challenge resource type.
Its file naming (`challenge_*.html`), pill color (crimson `#ff5470`), and CSS class
(`.ulink.chal`, `.cont-card.chal`) establish the template for future challenges.

### Grade 7 Engineering Progression

The Grade 7 engineering sequence focuses on systems-level engineering thinking.

1. `lesson_design-tradeoffs.html` -- Decision matrices and competing priorities
   (7.MS-ETS1-2).
2. `lesson_structural-systems.html` -- Structural system design and load management
   (7.MS-ETS3-4(MA)).
3. `lesson_transportation-systems.html` -- Transportation system design
   (7.MS-ETS3-3(MA)).
4. `lesson_communication-systems.html` -- Communication system design
   (7.MS-ETS3-1/2(MA)).
5. `lesson_engineering-systems.html` -- Systems engineering capstone
   (7.MS-ETS3-5(MA)).

---

## Standards Coverage Summary

Full standards tables are maintained in the canonical standards documentation rather
than reproduced here. This section summarizes coverage at the grade level.

### Grade 6 Standards Coverage

The Grade 6 curriculum fully covers 20 of the 22 Massachusetts 2016 STE standards. As of
V1 certification (incorporating the V1 Governance publishing of Choosing Materials,
Designing to Scale, and Earth's Place in the Universe):

- **Fully covered (20):** ESS1-1a, ESS1-4, ESS1-5(MA), ESS2-3, LS1-1, LS1-2, LS1-3,
  LS4-1, LS4-2, PS1-6, PS1-7(MA), PS1-8(MA), PS2-4, PS4-1, PS4-2, PS4-3, ETS1-1,
  ETS1-5(MA), ETS1-6(MA), ETS2-1(MA)
- **Not covered (2):** ETS2-2(MA) (material selection design task as a standalone
  lesson), ETS2-3(MA) (tools and prototyping as a standalone lesson; addressed through
  the Floatia capstone)

The strongest units are Earth-Sun-Moon (ESS1-1a, multiple resources at high depth) and
Waves (PS4-1, PS4-2, PS4-3, complete unit with investigation and game).

For the authoritative coverage table and DESE source citations, see
`docs/grade6-coverage-map.md` and `docs/grade6-standards-alignment-audit-v2.md`.

### Grade 7 Standards Coverage

The Grade 7 curriculum addresses the Massachusetts 2016 STE Grade 7 performance
expectations across all seven units (Earth Systems, Water Systems, Human Impacts,
Ecosystems, Ecosystem Stability, Energy Systems, Engineering Systems). All major
Grade 7 instructional clusters have published lessons.

Confirmed known gap: Grade 7 classroom submission (Mr. Kankel, Mr. Rovner) is
non-functional because the Google Apps Script deployment IDs remain as
`REPLACE_WITH_...` placeholders across 27 files. This is a platform infrastructure
gap, not a curriculum gap. The lesson content, quizzes, and instructional architecture
are complete.

---

## Resource Types

LyfeLabz uses six resource types for instructional content beyond core lessons, plus
the Engineering Challenge type added in V1.

### Lessons (`lesson_*.html`)

Core instructional experiences. Every lesson implements the full canonical HQIM
architecture: driving question, anchoring phenomenon, vocabulary, prediction gate,
Key Idea reveals, Quick Recall, Show Your Thinking, 10-question quiz, More Learning,
Connections, and Educator Mode notes. The quiz connects to classroom submission via
Google Apps Script.

The gold standard is `lesson_earths-layers.html`.

### Investigations (`investigation_*.html`)

Structured inquiry experiences. Investigations ask students to collect or interpret
data, build a claim from evidence, and reason to a conclusion. They typically implement
a CER (Claim, Evidence, Reasoning) structure. Practice and classroom modes are present.

Published investigations: amplitude-challenge, cell-energy, gray-zone, population-
patterns, protein-pathway.

### Simulations (`simulation_*.html`)

Interactive models that let students manipulate a variable and observe a system
respond. Simulations serve the Phenomenon and Mechanism and Systems and Cycles
archetypes. Practice and classroom modes are present.

Published simulations: beetle-island (Grade 8 enrichment), eclipse-alignment,
floatlandia-fracture, gravity-wells.

### Extensions (`extension_*.html`)

Extended learning experiences that deepen one aspect of a lesson. Extensions typically
go further into the content, apply it to a real-world case, or offer an above-grade
connection. They do not replace lesson content.

Published extensions: body-systems, chernobyl-frogs, fossil-hunt, hidden-world-of-
matter (Grade 8 enrichment), moon-tonight, neuron-explorer, virus.

### Games (`game_*.html`)

Instructional games that reinforce content through play. Games are optional enrichment
and are never the primary instructional delivery for a standard. Practice and classroom
modes are present where submission is appropriate.

Published games: cell-explorer, cellular-showdown, evolution-clicker (Grade 8
enrichment), exercise, is-it-alive, layer-detective, photon-runner.

### Engineering Challenges (`challenge_*.html`)

Hands-on design challenges that apply engineering standards through a structured
multi-stage process. The engineering challenge type was introduced in V1. Challenges
are capstone experiences that synthesize prior lessons rather than introducing new
concepts.

Published challenges: welcome-to-floatia.

---

## Curriculum Governance Decisions

The following decisions were made during the V1 curriculum build and governance phase.
They are recorded here as the authoritative explanation for why the published curriculum
takes its current shape.

### Publication of Earth's Place in the Universe

`lesson_earths-place-in-the-universe.html` was published to the catalog (Grade 6
Earth and Space block in `index.html`) as part of V1 Curriculum Governance
(2026-07-14). This decision closed the coverage gap for 6.MS-ESS1-5(MA) (graphical
displays of Earth's solar system in the Milky Way galaxy, which is one of billions of
galaxies in the universe). The lesson was built and HQIM-revised before the governance
decision formalized its publication status. Publishing this lesson brings fully covered
Grade 6 standards from 19 to 20 and reduces the not-covered count from 3 to 2.
Connections to this lesson were added to `lesson_sun-earth-moon.html` and
`lesson_gravity.html`.

### Publication of Choosing Materials

`lesson_choosing-materials.html` was published to the catalog (Grade 6 engineering
block in `index.html`) as part of V1 Curriculum Governance (commit `f6207ba`,
2026-07-13). This decision closed the coverage gap for 6.MS-ETS2-1(MA) and rounded
out the Grade 6 engineering sequence that leads to the Floatia capstone. The lesson
was built and technically complete before the governance decision formalized its
publication status.

### Publication of Designing to Scale

`lesson_designing-to-scale.html` was published to the catalog alongside Choosing
Materials in the same V1 Curriculum Governance commit. This closed the coverage gap
for 6.MS-ETS1-5(MA) and completed the materials-to-scale-to-build engineering
progression.

### Population Patterns Remaining an Investigation

`investigation_population-patterns.html` was considered for elevation to a core lesson
but remains an Investigation. The decision reflects that the population dynamics content
serves as a supporting experience for ecosystem lessons rather than anchoring its own
performance expectation as a primary instructional target. It lives in the More Learning
sections of `lesson_ecosystem-stability.html` and `lesson_parts-of-an-ecosystem.html`.

### Retirement of Biological Evolution Worksheet Resources

Two worksheet-style resources -- `activity_biological-evolution.html` (1,271 lines)
and `extension_biological-evolution.html` (1,189 lines) -- were retired and deleted
in the V1 Curriculum Governance commit. These resources were removed from the sitemap
and all coverage references. The decision was made because:

- The content they contained was better served by the revised core lesson
  (`lesson_biological-evolution.html`), the Chernobyl Frogs extension, and the
  evolution game.
- Retaining worksheet-style resources alongside HQIM-aligned experiences created an
  inconsistent instructional signal.
- The coverage they provided (6.MS-LS4-1, 6.MS-LS4-2) is fully maintained through
  the remaining resources.

### Preservation of Supplemental Behavioral Science

The Behavioral Science section (`lesson_ragebaiting.html` and the planned cognitive
biases and emotional regulation units) was preserved as supplemental curriculum outside
the MA STE scope. The decision is grounded in three observations: the content serves a
genuine instructional purpose not addressed by the STE standards; engagement with it
has been strong; and it is clearly distinguished from the standards-aligned curriculum
through its section identity and the hidden reveal mechanism. Future Behavioral Science
lessons follow the same instructional architecture as STE lessons but carry no
standards badges.

### Preservation of Enrichment Engineering Lessons

Three lessons -- `lesson_technology-and-society.html`, `lesson_innovation-and-
sustainability.html`, and `lesson_ragebaiting.html` -- carry no Massachusetts STE
performance expectation badges. They are preserved as enrichment content because they
serve the Design and Decisions archetype's instructional purpose (reasoning about
tradeoffs and human impact) and because students benefit from seeing engineering
thinking applied to technology and media literacy contexts. The decision to preserve
them unbadged rather than force artificial MA STE alignment reflects the badge-
conservatively principle: claiming alignment that is not genuinely present would
undermine trust in the curriculum's standards claims.

---

## Deferred Work

The following curriculum work is intentionally deferred from V1 and is not addressed
in this certification.

**Standards gaps:**
- 6.MS-ETS2-2(MA) -- A dedicated materials selection design task at the lesson level.
  Partially addressed through the Floatia capstone.

**Standards alignment cleanup (non-blocking):**
- `lesson_chemical-reactions.html` still presents atomic mechanism as primary
  explanatory content alongside the on-grade energy-transfer goal (6.MS-PS1-6).
  A future on-grade rewrite would emphasize energy in and out without atomic structure.
  This is documented as an Off-Grade Risk in `docs/grade6-coverage-map.md`.
- The astronomy lesson pages (`lesson_sun-earth-moon.html`, `lesson_phases-of-the-
  moon.html`, `lesson_eclipses.html`) carry historical standard code mismatches
  documented in the alignment audit. These are content-accuracy deferred items, not
  architecture gaps.

**Curriculum expansion:**
- Grade 8 curriculum is not part of V1. Resources like `simulation_beetle-island.html`
  and `extension_chernobyl-frogs.html` serve as early Grade 8 touchpoints with clear
  "Future Learning Connection" labeling.
- Remaining Behavioral Science units (Cognitive Biases; Emotional Regulation and Social
  Influence) are placeholder entries in the catalog with no published content.

---

## Certification Statement

The repository represents the certified published LyfeLabz V1 curriculum as of
2026-07-14.

The instructional architecture is complete. All 50 core lessons implement the full
canonical HQIM architecture. The curriculum is internally consistent, technically
hardened, accessible, mobile-responsive, and deployment-ready, as documented in
`LYFELABZ_TECHNICAL_CERTIFICATION_V1.md`.

The V1 curriculum is not a complete Massachusetts Grade 6 and Grade 7 STE program.
It covers the majority of Grade 6 standards and all major Grade 7 instructional
clusters, with documented gaps and a clear record of what remains. The published
curriculum is appropriate for classroom use as a supplemental digital resource and
as the foundation for continued curriculum development.

---

## Relationship to V1 Stabilization

The next major phase following this certification is V1 Stabilization. The primary
work of V1 Stabilization is replacing the `REPLACE_WITH_...` placeholder Google Apps
Script deployment IDs in 27 Grade 7 lesson files with real deployed endpoints for
Mr. Kankel and Mr. Rovner. Until those real IDs are supplied, Grade 7 classroom
submission is non-functional.

V1 Stabilization also includes:
- Deploying and wiring the centralized Google Apps Script routing work
  (`LyfeLabz_GScript_v2.js`) for all lessons that have completed the Assessment v2
  payload migration
- Any optional Assessment v1 to v2 infrastructure migration for remaining v1 lessons

V1 Stabilization is a platform and infrastructure phase, not a curriculum content
phase. No new lessons, investigations, or instructional resources are planned for V1
Stabilization. Curriculum expansion begins after stabilization is complete.

---

*This document was created as part of the V1 Curriculum Certification on 2026-07-14.
It should be updated if governance decisions revise the scope of the published V1
curriculum. It is not a living audit document; routine curriculum additions belong in
the canonical standards documentation.*
