# Curriculum Scope and Sequence

LyfeLabz Grade 6-7 proposed instructional sequence. Repository factual
correction: 2026-09-19, baseline `4f6f02b01eb988696592265223d2ddff28832eb4`.
Source evidence is the two coverage maps and current instructional files.
Phase 2A deferred external-source questions. Phase 2C (2026-09-19) integrates
Phase 2B findings; see the [verified external-review distinctions](review-board-report.md#official-source-findings-integrated-in-phase-2c).
Grade-span eligibility for Grade 6-only and Grades 6-7 configurations remains
to be confirmed with EdReports and DESE CURATE. This proposed sequence does
not establish program-review admission. EQuIP lesson/unit review is separate;
Grade 8 development is not recommended to satisfy an unverified admission rule.

Standards references use the [Massachusetts 2016 STE Framework](https://www.doe.mass.edu/frameworks/scitech/2016-04.pdf):
Grade 6 printed pages 54-59/PDF 57-62; Grade 7 printed pages 60-65/PDF 63-68.
MA standards integrate DCIs and SEPs; CCCs here are instructional reasoning,
not official per-PE assignments.

The nine-unit sequences below are a recommended teaching arrangement over an
existing catalog, not the live catalog's display order. `index.html` and its
generated `app/src/curriculum/curriculum.manifest.json` group 50 catalog units
by subject. Course-unit numbering here serves a different purpose.

Catalog ownership and supporting evidence are distinct. Plate Tectonics is a
Grade 7 catalog lesson with a Grade 6 bridge badge; ball-run is shared practice
used in the proposed sequences. Cross-grade support does not automatically
establish assessed attainment for either grade. Games are supporting activities;
no formal coverage claim here rests on a game alone. For 49 pipeline lessons,
`lesson-sources/` is canonical and root/v2 pages are generated outputs.

## Overview

LyfeLabz is a two-year middle school science program built directly to the
Massachusetts 2016 Science and Technology/Engineering Framework, following the
framework's own arc from Structure and Function in Grade 6 to Systems and
Cycles in Grade 7. The program is organized as seven conceptual families that
span both years rather than as isolated topic units: Living Systems, Life Over
Time, Dynamic Earth, Sun, Gravity, and Earth's Cycles, Matter and Its
Particles, Energy, Waves, and Fields, and Engineered Systems. (The seven-family spine is defined
in `docs/curriculum/concept-families.md`, the program's concept-family
reference.) Across the families, many lessons use a common
instructional architecture: a mystery-driven entry phenomenon, prediction
before revelation, and contextual vocabulary tied to observations. Vocabulary sections remain
accessible before Engage, and a shared format does not prove that every PE
practice is fully enacted. Lessons are the student's home base; a Connections layer
invites exploration of conceptually related lessons without imposing a required
progression, which lets the seven families function as narratives students
discover rather than tracks they march through.

## Grade 6 Scope and Sequence

Grade 6 maps meaningful instruction to all 22 standards across nine proposed
units. The map retains 22 Primary labels; Phase 1 found 16 strongly supported
instructional classifications, five requiring qualification, and PS1-6 with
substantial instruction but missing investigation performance. These are not
claims of complete PE attainment. The framework's Grade 6 integration theme, Structure and
Function, runs from the microscopic (cells, particles) to the macroscopic
(Earth features, waves, engineered materials), and the sequence below follows
that scale trajectory. One additional lesson,
[lesson_conducting-experiments.html](../../lesson_conducting-experiments.html),
carries no performance expectation by design; it teaches the science-practices
foundation (planning investigations, controlling variables) that the
experimental and data-analysis verbs throughout both grades depend on, and it
is available from the start of the year.

### Unit 1: What Is Life? Cells and Their Structures

- **Family:** Living Systems
- **Standards:** 6.MS-LS1-1, 6.MS-LS1-2
- **Anchor lessons:** [lesson_what-is-life.html](../../lesson_what-is-life.html)
  (gold standard), [lesson_cell-types.html](../../lesson_cell-types.html),
  [lesson_organelles.html](../../lesson_organelles.html)
- **Supporting files:**
  [investigation_gray-zone.html](../../investigation_gray-zone.html),
  [investigation_cell-energy.html](../../investigation_cell-energy.html),
  [investigation_protein-pathway.html](../../investigation_protein-pathway.html),
  [extension_virus.html](../../extension_virus.html),
  [extension_neuron-explorer.html](../../extension_neuron-explorer.html),
  [game_is-it-alive.html](../../game_is-it-alive.html),
  [game_cell-explorer.html](../../game_cell-explorer.html),
  [game_cellular-showdown.html](../../game_cellular-showdown.html)
- **Prerequisites:** none
- **Rationale:** The year opens at the smallest living scale with the deepest
  multi-modal cluster in the catalog, because the question of what counts as
  alive is the program's founding mystery and the cell model built here is the
  structural foundation every later life science idea stands on.

### Unit 2: Body Systems

- **Family:** Living Systems
- **Standards:** 6.MS-LS1-3
- **Anchor lesson:** [lesson_body-systems.html](../../lesson_body-systems.html)
- **Supporting files:** eight body-system pages (`system_circulatory.html`
  through `system_skeletal.html`), eight disease pages
  (`disease_circulatory.html` through `disease_skeletal.html`),
  [extension_body-systems.html](../../extension_body-systems.html),
  [extension_neuron-explorer.html](../../extension_neuron-explorer.html),
  [game_exercise.html](../../game_exercise.html)
- **Prerequisites:** Unit 1
- **Rationale:** With cells established, the argument that body systems
  interact to carry out essential functions scales structure-and-function
  reasoning up one level, and the disease pages give students authentic cases
  where a system failure reveals the interaction the standard asks them to
  argue for.

### Unit 3: Evidence of Change: Fossils and Evolution

- **Family:** Life Over Time
- **Standards:** 6.MS-LS4-1, 6.MS-LS4-2
- **Anchor lesson:**
  [lesson_biological-evolution.html](../../lesson_biological-evolution.html)
- **Supporting files:**
  [extension_chernobyl-frogs.html](../../extension_chernobyl-frogs.html)
- **Prerequisites:** Unit 1
- **Rationale:** Anatomical comparison of fossil and modern organisms extends
  the structure-based reasoning of the first two units into deep time, and it
  deliberately precedes the rock-record unit so that students meet fossils as
  biological evidence before they learn to read the layers that hold them.

### Unit 4: Earth's Story in Rock

- **Family:** Dynamic Earth
- **Standards:** 6.MS-ESS1-4, 6.MS-ESS2-3
- **Anchor lessons:** [lesson_layers-of-time.html](../../lesson_layers-of-time.html),
  [lesson_continental-drift.html](../../lesson_continental-drift.html)
- **Supporting files:** [extension_fossil-hunt.html](../../extension_fossil-hunt.html),
  [game_layer-detective.html](../../game_layer-detective.html)
- **Prerequisites:** Unit 3
- **Rationale:** Reading superposition and index fossils turns the fossil
  evidence of Unit 3 into a dating tool, and Wegener's map-and-fossil argument
  in Continental Drift trains the evidence-before-mechanism discipline that the
  Grade 7 plate tectonics lesson will resolve.

### Unit 5: Earth in Space

- **Family:** Sun, Gravity, and Earth's Cycles
- **Standards:** 6.MS-ESS1-1a, 6.MS-ESS1-5(MA), 6.MS-PS2-4
- **Anchor lessons:** [lesson_sun-earth-moon.html](../../lesson_sun-earth-moon.html),
  [lesson_phases-of-the-moon.html](../../lesson_phases-of-the-moon.html),
  [lesson_eclipses.html](../../lesson_eclipses.html),
  [lesson_gravity.html](../../lesson_gravity.html),
  [lesson_earths-place-in-the-universe.html](../../lesson_earths-place-in-the-universe.html)
- **Supporting files:**
  [simulation_eclipse-alignment.html](../../simulation_eclipse-alignment.html),
  [simulation_gravity-wells.html](../../simulation_gravity-wells.html),
  [extension_moon-tonight.html](../../extension_moon-tonight.html)
- **Prerequisites:** none
- **Rationale:** The Earth-Sun-Moon system is the program's largest-scale
  modeling exercise, and weaving the gravity claim-and-evidence standard into
  the same unit gives the orbital models their causal engine while planting the
  field intuition Grade 7 will formalize. ESS1-5(MA) requires using graphical
  displays; independent construction is not an additional explicit PE demand.

### Unit 6: Matter and Its Particles

- **Family:** Matter and Its Particles
- **Standards:** 6.MS-PS1-7(MA), 6.MS-PS1-8(MA), 6.MS-PS1-6
- **Anchor lessons:**
  [lesson_measuring-matter.html](../../lesson_measuring-matter.html),
  [lesson_physical-properties.html](../../lesson_physical-properties.html),
  [lesson_pure-substances-and-mixtures.html](../../lesson_pure-substances-and-mixtures.html),
  [lesson_chemical-reactions.html](../../lesson_chemical-reactions.html)
- **Supporting files:** none (the four lessons are mutually reinforcing;
  [lesson_conducting-experiments.html](../../lesson_conducting-experiments.html)
  supports experimental practices; it does not itself establish performance
  of the PS1-6 or PS1-8(MA) experiments)
- **Prerequisites:** none
- **Rationale:** Three lessons develop one particulate model from three
  directions (density as packing, properties as particle behavior, mixtures as
  separable pure substances) before Chemical Reactions puts the model to work
  on energy in and energy out, giving students the particle picture that Grade
  7 thermal energy is built on. PS1-8(MA) requires students to conduct an
  experiment showing physical separation, not just select a method. That
  evidence needs review; the missing PS1-6 investigation remains a separate
  performance concern. No experiment is implemented by this sequence document.

### Unit 7: Waves and Signals

- **Family:** Energy, Waves, and Fields
- **Standards:** 6.MS-PS4-1, 6.MS-PS4-2, 6.MS-PS4-3
- **Anchor lessons:**
  [lesson_nature-of-waves.html](../../lesson_nature-of-waves.html) (gold standard),
  [lesson_wave-behavior.html](../../lesson_wave-behavior.html) (gold standard),
  [lesson_digital-signals.html](../../lesson_digital-signals.html) (gold standard)
- **Supporting files:**
  [investigation_amplitude-challenge.html](../../investigation_amplitude-challenge.html),
  [game_photon-runner.html](../../game_photon-runner.html)
- **Prerequisites:** none
- **Rationale:** The waves trio is the program's clearest predict-then-reveal
  exemplar, and closing it with digitized signals turns wave physics into an
  argument about information, which is the exact idea the Grade 7
  communication-systems standard picks up.

### Unit 8: Engineering Design

- **Family:** Engineered Systems
- **Standards:** 6.MS-ETS1-1, 6.MS-ETS1-5(MA), 6.MS-ETS1-6(MA),
  6.MS-ETS2-1(MA), 6.MS-ETS2-2(MA)
- **Anchor lessons:**
  [lesson_engineering-design.html](../../lesson_engineering-design.html),
  [lesson_designing-to-scale.html](../../lesson_designing-to-scale.html),
  [lesson_choosing-materials.html](../../lesson_choosing-materials.html)
- **Supporting files:** none (the three lessons feed directly into the Unit 9
  capstone)
- **Prerequisites:** none, though Unit 6 strengthens the materials-property
  reasoning in Choosing Materials
- **Rationale:** Students learn to define problems, represent solutions at
  scale, and select materials by property in three focused lessons precisely so
  that the capstone can apply those skills without re-teaching them, keeping
  the taught-versus-assessed boundary inspectable.

### Unit 9: Build It: The Floatia Capstone

- **Family:** Engineered Systems
- **Standards:** 6.MS-ETS2-3(MA) (assessed); applies ETS1-1, ETS1-5(MA),
  ETS1-6(MA), ETS2-1(MA), ETS2-2(MA)
- **Anchor file:**
  [challenge_welcome-to-floatia.html](../../challenge_welcome-to-floatia.html)
- **Supporting files:**
  [challenge_ball-run_day1.html](../../challenge_ball-run_day1.html) through
  [challenge_ball-run_day5.html](../../challenge_ball-run_day5.html) and
  [challenge_slow-motion-ball-run.html](../../challenge_slow-motion-ball-run.html)
  (hands-on prototyping practice, currently unbadged)
- **Prerequisites:** Unit 8
- **Rationale:** The year closes with students building, testing, and refining
  a physical prototype and defending their decisions, which converts the
  engineering lessons into assessed performance and gives the Structure and
  Function theme its culminating designed structure.

## Grade 7 Scope and Sequence

The proposed Grade 7 order begins with Earth and water systems, then ecosystem
foundations before ecosystem stability and human impacts, followed by energy
and engineering. This differs from the subject-grouped live catalog. The map
classifies 21 standards Primary, three Partial, and four Gap, without certifying
full performance. The four standards with missing full performance tasks (7.MS-PS3-1, PS3-2, PS3-3, 7.MS-LS2-5) appear below as
planned units with their raw material identified, because the sequence is
designed around where those units will sit, not around their absence.

### Unit 1: Earth's Dynamic Surface

- **Family:** Dynamic Earth
- **Standards:** 7.MS-ESS2-2; 7.MS-ESS3-2 (Partial, evidence review against corrected MA wording pending)
- **Anchor lesson:** [lesson_earths-layers.html](../../lesson_earths-layers.html)
  (Grade 7 gold standard)
- **Supporting files:** [lesson_plate-tectonics.html](../../lesson_plate-tectonics.html),
  [lesson_earthquakes.html](../../lesson_earthquakes.html),
  [lesson_types-of-volcanoes.html](../../lesson_types-of-volcanoes.html),
  [lesson_hotspot-volcanoes.html](../../lesson_hotspot-volcanoes.html),
  [lesson_weathering-and-erosion.html](../../lesson_weathering-and-erosion.html),
  [simulation_floatlandia-fracture.html](../../simulation_floatlandia-fracture.html)
- **Prerequisites:** Grade 6 Unit 4 (evidence of plate movement)
- **Rationale:** The year opens with its deepest cluster, six lessons spanning
  global to local scales of surface change, because resolving the mechanism
  behind the Grade 6 continental-drift evidence is the most motivating payoff
  available for returning students. The three hazard lessons already carry
  forecasting-related content. Phase 2B corrected the earlier requirement for
  an independently produced data-based forecast: ESS3-2 asks students to obtain
  and communicate information about how past-event data support forecasts.
  Review that performance before changing Partial or selecting new work. The
  earlier badge-plus-assessment proposal is not a settled correction.

### Unit 2: Water Systems

- **Family:** Sun, Gravity, and Earth's Cycles
- **Standards:** 7.MS-ESS2-4
- **Anchor lesson:** [lesson_water-cycle.html](../../lesson_water-cycle.html)
- **Supporting files:** none
- **Prerequisites:** Grade 6 Unit 5 (gravity is named in the PE itself)
- **Rationale:** The water cycle is the first full systems-and-cycles model of
  the year, driven by the two engines students already own from Grade 6, the
  Sun's energy and gravity, which makes it the natural pivot from surface
  processes to cycling matter.

### Unit 3: Ecosystems: Structure and Flow

- **Family:** Living Systems
- **Standards:** 7.MS-LS2-1, 7.MS-LS2-2, 7.MS-LS2-3, 7.MS-LS1-4
- **Anchor lessons:**
  [lesson_parts-of-an-ecosystem.html](../../lesson_parts-of-an-ecosystem.html),
  [lesson_energy-flow.html](../../lesson_energy-flow.html),
  [lesson_carbon-cycle.html](../../lesson_carbon-cycle.html)
- **Supporting files:** [lesson_photosynthesis.html](../../lesson_photosynthesis.html),
  [lesson_reproductive-success.html](../../lesson_reproductive-success.html),
  [investigation_population-patterns.html](../../investigation_population-patterns.html)
- **Prerequisites:** Grade 7 Unit 2 (matter cycling), Grade 6 Units 1 and 3
  (cell structures, evolutionary reasoning)
- **Rationale:** This unit scales the Grade 6 cell-level energy story up to
  producers, consumers, and conserved matter and energy at ecosystem scale,
  with the population-patterns investigation carrying the data-analysis verb of
  LS2-1 and reproductive success extending Grade 6 anatomical reasoning to the
  behaviors and structures that sustain populations.

### Unit 4: Ecosystem Stability and Human Impacts

- **Family:** Living Systems
- **Standards:** 7.MS-LS2-4, 7.MS-LS2-6(MA), 7.MS-ESS3-4
- **Anchor lessons:**
  [lesson_ecosystem-stability.html](../../lesson_ecosystem-stability.html),
  [lesson_human-impacts.html](../../lesson_human-impacts.html)
- **Supporting files:**
  [lesson_renewable-and-nonrenewable-resources.html](../../lesson_renewable-and-nonrenewable-resources.html),
  [lesson_innovation-and-sustainability.html](../../lesson_innovation-and-sustainability.html)
  (unbadged support)
- **Prerequisites:** Grade 7 Unit 3
- **Rationale:** Once students can model an intact ecosystem, disrupting it is
  the logical next move, and pairing natural disruptions with human-made ones
  lets the mitigation argument of ESS3-4 land as a consequence of the ecology
  rather than as an appended values lesson.

### Unit 5 (planned): Protecting Ecosystems: A Design Evaluation

- **Family:** Living Systems / Engineered Systems
- **Standards to address:** 7.MS-LS2-5
- **Existing raw material:**
  [lesson_design-tradeoffs.html](../../lesson_design-tradeoffs.html) (the
  decision-matrix method), scenario content from
  [lesson_human-impacts.html](../../lesson_human-impacts.html),
  [lesson_ecosystem-stability.html](../../lesson_ecosystem-stability.html), and
  [lesson_renewable-and-nonrenewable-resources.html](../../lesson_renewable-and-nonrenewable-resources.html)
- **Prerequisite adjustment:** Teach the decision-matrix method from Unit 9
  (Design Tradeoffs) before this planned unit, or move this application later.
  The current numbering does not make that method already taught.
- **Build note:** Apply the decision-matrix method to competing
  ecosystem-protection solutions (water, land, or species scenarios), so the
  unit is a planned application task. Its proposed artifact submission is not
  supported by the current single-choice runtime without a separate design
  decision; it is not implemented curriculum.

### Unit 6: Energy Systems

- **Family:** Energy, Waves, and Fields
- **Standards:** 7.MS-PS3-4, 7.MS-PS3-5, 7.MS-PS3-6(MA), 7.MS-PS3-7(MA),
  7.MS-PS2-3, 7.MS-PS2-5
- **Anchor lessons:** [lesson_forms-of-energy.html](../../lesson_forms-of-energy.html),
  [lesson_energy-transfer.html](../../lesson_energy-transfer.html),
  [lesson_heat-transfer.html](../../lesson_heat-transfer.html),
  [lesson_introduction-to-electricity.html](../../lesson_introduction-to-electricity.html)
- **Performance qualifications:** PS2-3 data analysis and PS3-4 investigation
  remain substantive weaknesses despite Primary map labels.
- **Supporting files:** none currently badged
- **Prerequisites:** Grade 6 Units 5 and 6 (gravity and the particulate model)
- **Rationale:** Thermal energy is taught as the Grade 6 particle model in
  motion and fields are taught with Grade 6 gravity as the first worked case,
  so the unit demonstrates the program's vertical design rather than starting
  energy from zero.

### Unit 7 (planned): Energy of Motion

- **Family:** Energy, Waves, and Fields
- **Standards to address:** 7.MS-PS3-1, 7.MS-PS3-2
- **Existing raw material:**
  [challenge_ball-run_day1.html](../../challenge_ball-run_day1.html) through
  [challenge_ball-run_day5.html](../../challenge_ball-run_day5.html) and
  [challenge_slow-motion-ball-run.html](../../challenge_slow-motion-ball-run.html)
  (the rolling-ball phenomenon and its data), plus
  [simulation_gravity-wells.html](../../simulation_gravity-wells.html) as accessible
  Grade 6 background (a bridge, not a counted Grade 7 asset)
- **Existing conceptual background:** Forms of Energy already addresses
  potential energy; the full PS3-2 relative-position modeling task is missing.
- **Build note:** Build a data-and-graphs lesson from the ball-run phenomenon
  for the kinetic energy, mass, and speed relationships of PS3-1, and a
  dedicated potential-energy modeling lesson (gravity, magnets, and charges per
  the clarification) that formalizes the gravity-well intuition for PS3-2.

### Unit 8 (planned): Thermal Engineering Design

- **Family:** Energy, Waves, and Fields / Engineered Systems
- **Standards to address:** 7.MS-PS3-3
- **Existing raw material:**
  [lesson_heat-transfer.html](../../lesson_heat-transfer.html) (the conduction,
  convection, and radiation model the device must control)
- **Prerequisite adjustment:** If the design uses a decision matrix, introduce
  Design Tradeoffs from Unit 9 first. Review physical construction versus
  simulation requirements and artifact capture before implementation.
- **Build note:** Attach an insulated-box or solar-cooker design-build-test
  task to the heat-transfer lesson, intended to address the PS3-3 gap and generate
  engineering-practice evidence for the ETS1 strand in the same build.

### Unit 9: Engineering Systems

- **Family:** Engineered Systems
- **Standards:** 7.MS-ETS1-2, 7.MS-ETS3-1(MA), 7.MS-ETS3-2(MA),
  7.MS-ETS3-3(MA), 7.MS-ETS3-4(MA), 7.MS-ETS3-5(MA); 7.MS-ETS1-4 and
  7.MS-ETS1-7(MA) (Partial, classification review planned)
- **Anchor lessons:**
  [lesson_design-tradeoffs.html](../../lesson_design-tradeoffs.html),
  [lesson_communication-systems.html](../../lesson_communication-systems.html),
  [lesson_transportation-systems.html](../../lesson_transportation-systems.html),
  [lesson_structural-systems.html](../../lesson_structural-systems.html),
  [lesson_engineering-systems.html](../../lesson_engineering-systems.html) (the ETS3
  capstone)
- **Supporting files:** [lesson_ragebaiting.html](../../lesson_ragebaiting.html) and
  [lesson_technology-and-society.html](../../lesson_technology-and-society.html)
  (adjacent content; Ragebaiting is Grade 6 in the live catalog), and the
  ball-run sequence (existing prototypes, trial tables, controlled revisions,
  and reflections warrant review of the ETS1-4/1-7(MA) Partial classifications)
- **Prerequisites:** Grade 6 Units 7 through 9 (signal physics and the first
  prototype cycle)
- **Rationale:** The year and the two-year arc both close on the
  five-standard ETS3 instructional suite, where students who began with wave pulses in
  Grade 6 now model the inputs, processes, outputs, and feedback of the
  communication, transportation, and structural systems society builds on that
  physics. ETS3-3(MA) includes research and communication, and ETS1-2 requires
  both a decision matrix and a model of each competing solution. Review those
  performance demands without treating the existing descriptions as proof of
  full attainment.

## Vertical Articulation

The ten Grade 6 to Grade 7 bridge points documented in the Grade 7 coverage
map, with the anchor file on each side. Planned Grade 7 assets are marked.

| Grade 6 Standard | Grade 6 Anchor File | Grade 7 Standard | Grade 7 Anchor File | Nature of Connection |
|---|---|---|---|---|
| 6.MS-ESS2-3 | lesson_continental-drift.html | 7.MS-ESS2-2 | lesson_plate-tectonics.html | Drift introduces Wegener's evidence; tectonics explains the mechanism. The plate-tectonics lesson badges both codes by design, making the articulation inspectable in one file. |
| 6.MS-PS2-4 | lesson_gravity.html | 7.MS-ESS2-4 | lesson_water-cycle.html | The Grade 6 gravity claim is a named driver in the Grade 7 PE itself: gravity pulls water along its downhill paths through the hydrosphere. |
| 6.MS-ESS1-4 | lesson_layers-of-time.html | 7.MS-ESS3-2 | lesson_earthquakes.html (corrected-demand evidence review pending) | Reading geologic evidence supports obtaining and communicating information about how patterns inform hazard forecasts; independent forecasting is not the MA PE requirement. |
| 6.MS-LS1-2 | lesson_organelles.html | 7.MS-LS2-3 | lesson_photosynthesis.html | Chloroplasts and mitochondria at cell scale become producers and consumers at ecosystem scale; investigation_cell-energy.html teaches the cell-scale half of the bridge. |
| 6.MS-LS4-1 / 6.MS-LS4-2 | lesson_biological-evolution.html | 7.MS-LS1-4 | lesson_reproductive-success.html | Anatomical-evidence reasoning about relationships extends to the behaviors and specialized structures that increase reproductive success. |
| 6.MS-PS2-4 | simulation_gravity-wells.html | 7.MS-PS2-5 | lesson_introduction-to-electricity.html | The PE explicitly includes fields between masses; the Grade 6 gravity cluster is the first field case students argue from. |
| 6.MS-PS2-4 | simulation_gravity-wells.html | 7.MS-PS3-2 | planned Energy of Motion unit | The gravity-well simulation gives students the position-and-potential-energy intuition the planned Grade 7 lesson will formalize; it is a bridge, not the lesson. |
| 6.MS-PS1-7(MA) | lesson_measuring-matter.html | 7.MS-PS3-4 / 7.MS-PS3-6(MA) | lesson_heat-transfer.html | Temperature as average particle kinetic energy builds directly on the Grade 6 particulate model of matter. |
| 6.MS-ETS1-1 / 6.MS-ETS2-1/2-2/2-3(MA) | challenge_welcome-to-floatia.html | 7.MS-ETS1-2 / 7.MS-ETS1-4 / 7.MS-ETS1-7(MA) | lesson_design-tradeoffs.html | Grade 6 defines problems and builds a first prototype; Grade 7 adds systematic evaluation with a decision matrix and models of competing solutions, plus iterative optimization. |
| 6.MS-PS4-3 | lesson_digital-signals.html | 7.MS-ETS3-1(MA) | lesson_communication-systems.html | Encoder, transmitter, and decoder vocabulary begins in the Grade 6 digitized-signals lesson - the cleanest cross-grade narrative in the catalog. |

## Assessment Architecture Note

Instructional tasks, recorded responses, scoring, and full PE performance are
separate evidence layers. All 50 root lessons contain a textarea; the 49
configured authenticated assessment payloads contain 495 `singleChoice` items
(15 for Body Systems, ten for each of the other 48 configured lessons).

Body Systems requires a written three-system explanation; Biological Evolution
requires a whale-origin CER. Both have model responses and are not automatically
scored. Their inspected authenticated `lessonQuiz.finalize` calls include only
selected answers. Legacy public submission code includes a `thinking` field;
production receipt was not tested. Strengthen evaluation and retention of the
existing tasks rather than commissioning duplicate written arguments.

Authenticated selected-response attempts use server-side finalization and
client write restrictions (`platform/functions/src/assessments/` and
`platform/firebase/firestore.rules`). This does not establish that every written
response or physical artifact is stored, or that privileged infrastructure can
never alter records. A standard badge does not make an attempt proof of mastery.

The planned gap-unit specifications propose graphs, models, design histories,
and written arguments through the certified runtime. The current item type in
`platform/functions/src/shared/types/assessment.ts` is only `singleChoice`.
Those proposals need a separate capture/evaluation architecture decision.

## Deferred Reconciliation

`docs/curriculum/concept-families.md` and `gap-unit-build-specs.md` are outside
this correction pass. Later work should reconcile grade ownership, prerequisite
placement, and planned artifact-capture assumptions with those documents. The
family architecture itself is unchanged. Proposed prerequisites are teaching
recommendations, not enforced platform progression or verified learning gains.
