# Curriculum Scope and Sequence

LyfeLabz Grade 6-7 Science - HQIM submission draft (EdReports gateway / MA DESE
CURATE). Source evidence: `docs/grade6-coverage-map.md` and
`docs/grade7-coverage-map.md` (both generated 2026-09-14 from a full repository
badge scan) and `docs/hqim/standards-alignment-narrative.md`. Grade 6 is the
primary submission unit and stands alone as a complete curriculum; Grade 7 is
presented as its designed continuation.

File notes: every file listed belongs to exactly one grade. Grade 6 students
may access Grade 7 materials as enrichment and Grade 7 students may revisit
Grade 6 materials, but no file is counted toward both grades. Lessons in the
build pipeline exist in three forms (`lesson-sources/` canonical, root v1
public page, `app/lessons/` v2 authenticated page); this document cites the
root v1 public page throughout. Games appear as supporting material but are
outside the formal curriculum; no coverage claim rests on a game alone.

## Overview

LyfeLabz is a two-year middle school science program built directly to the
Massachusetts 2016 Science and Technology/Engineering Framework, following the
framework's own arc from Structure and Function in Grade 6 to Systems and
Cycles in Grade 7. The program is organized as seven conceptual families that
span both years rather than as isolated topic units: Living Systems, Life Over
Time, Dynamic Earth, Sun, Gravity, and Earth's Cycles, Matter and Its
Particles, Energy, Waves, and Fields, and Engineered Systems. (The seven-family spine is defined
in `docs/curriculum/concept-families.md`, the program's concept-family
reference.) Within every family, lessons share one
instructional architecture: a mystery-driven entry phenomenon, prediction
before revelation, and vocabulary that emerges after observation rather than
preceding it, so that students earn each term through the scientific practice
the standard names. Lessons are the student's home base; a Connections layer
invites exploration of conceptually related lessons without imposing a required
progression, which lets the seven families function as narratives students
discover rather than tracks they march through.

## Grade 6 Scope and Sequence

Grade 6 provides Primary coverage of all 22 Grade 6 performance expectations
across nine units. The framework's Grade 6 integration theme, Structure and
Function, runs from the microscopic (cells, particles) to the macroscopic
(Earth features, waves, engineered materials), and the sequence below follows
that scale trajectory. One additional lesson,
[lesson_conducting-experiments.html](lesson_conducting-experiments.html),
carries no performance expectation by design; it teaches the science-practices
foundation (planning investigations, controlling variables) that the
experimental and data-analysis verbs throughout both grades depend on, and it
is available from the start of the year.

### Unit 1: What Is Life? Cells and Their Structures

- **Family:** Living Systems
- **Standards:** 6.MS-LS1-1, 6.MS-LS1-2
- **Anchor lessons:** [lesson_what-is-life.html](lesson_what-is-life.html)
  (gold standard), [lesson_cell-types.html](lesson_cell-types.html),
  [lesson_organelles.html](lesson_organelles.html)
- **Supporting files:**
  [investigation_gray-zone.html](investigation_gray-zone.html),
  [investigation_cell-energy.html](investigation_cell-energy.html),
  [investigation_protein-pathway.html](investigation_protein-pathway.html),
  [extension_virus.html](extension_virus.html),
  [extension_neuron-explorer.html](extension_neuron-explorer.html),
  [game_is-it-alive.html](game_is-it-alive.html),
  [game_cell-explorer.html](game_cell-explorer.html),
  [game_cellular-showdown.html](game_cellular-showdown.html)
- **Prerequisites:** none
- **Rationale:** The year opens at the smallest living scale with the deepest
  multi-modal cluster in the catalog, because the question of what counts as
  alive is the program's founding mystery and the cell model built here is the
  structural foundation every later life science idea stands on.

### Unit 2: Body Systems

- **Family:** Living Systems
- **Standards:** 6.MS-LS1-3
- **Anchor lesson:** [lesson_body-systems.html](lesson_body-systems.html)
- **Supporting files:** eight body-system pages (`system_circulatory.html`
  through `system_skeletal.html`), eight disease pages
  (`disease_circulatory.html` through `disease_skeletal.html`),
  [extension_body-systems.html](extension_body-systems.html),
  [extension_neuron-explorer.html](extension_neuron-explorer.html),
  [game_exercise.html](game_exercise.html)
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
  [lesson_biological-evolution.html](lesson_biological-evolution.html)
- **Supporting files:**
  [extension_chernobyl-frogs.html](extension_chernobyl-frogs.html)
- **Prerequisites:** Unit 1
- **Rationale:** Anatomical comparison of fossil and modern organisms extends
  the structure-based reasoning of the first two units into deep time, and it
  deliberately precedes the rock-record unit so that students meet fossils as
  biological evidence before they learn to read the layers that hold them.

### Unit 4: Earth's Story in Rock

- **Family:** Dynamic Earth
- **Standards:** 6.MS-ESS1-4, 6.MS-ESS2-3
- **Anchor lessons:** [lesson_layers-of-time.html](lesson_layers-of-time.html),
  [lesson_continental-drift.html](lesson_continental-drift.html)
- **Supporting files:** [extension_fossil-hunt.html](extension_fossil-hunt.html),
  [game_layer-detective.html](game_layer-detective.html)
- **Prerequisites:** Unit 3
- **Rationale:** Reading superposition and index fossils turns the fossil
  evidence of Unit 3 into a dating tool, and Wegener's map-and-fossil argument
  in Continental Drift trains the evidence-before-mechanism discipline that the
  Grade 7 plate tectonics lesson will resolve.

### Unit 5: Earth in Space

- **Family:** Sun, Gravity, and Earth's Cycles
- **Standards:** 6.MS-ESS1-1a, 6.MS-ESS1-5(MA), 6.MS-PS2-4
- **Anchor lessons:** [lesson_sun-earth-moon.html](lesson_sun-earth-moon.html),
  [lesson_phases-of-the-moon.html](lesson_phases-of-the-moon.html),
  [lesson_eclipses.html](lesson_eclipses.html),
  [lesson_gravity.html](lesson_gravity.html),
  [lesson_earths-place-in-the-universe.html](lesson_earths-place-in-the-universe.html)
- **Supporting files:**
  [simulation_eclipse-alignment.html](simulation_eclipse-alignment.html),
  [simulation_gravity-wells.html](simulation_gravity-wells.html),
  [extension_moon-tonight.html](extension_moon-tonight.html)
- **Prerequisites:** none
- **Rationale:** The Earth-Sun-Moon system is the program's largest-scale
  modeling exercise, and weaving the gravity claim-and-evidence standard into
  the same unit gives the orbital models their causal engine while planting the
  field intuition Grade 7 will formalize.

### Unit 6: Matter and Its Particles

- **Family:** Matter and Its Particles
- **Standards:** 6.MS-PS1-7(MA), 6.MS-PS1-8(MA), 6.MS-PS1-6
- **Anchor lessons:**
  [lesson_measuring-matter.html](lesson_measuring-matter.html),
  [lesson_physical-properties.html](lesson_physical-properties.html),
  [lesson_pure-substances-and-mixtures.html](lesson_pure-substances-and-mixtures.html),
  [lesson_chemical-reactions.html](lesson_chemical-reactions.html)
- **Supporting files:** none (the four lessons are mutually reinforcing;
  [lesson_conducting-experiments.html](lesson_conducting-experiments.html)
  supports the PS1-6 experimental verb)
- **Prerequisites:** none
- **Rationale:** Three lessons develop one particulate model from three
  directions (density as packing, properties as particle behavior, mixtures as
  separable pure substances) before Chemical Reactions puts the model to work
  on energy in and energy out, giving students the particle picture that Grade
  7 thermal energy is built on.

### Unit 7: Waves and Signals

- **Family:** Energy, Waves, and Fields
- **Standards:** 6.MS-PS4-1, 6.MS-PS4-2, 6.MS-PS4-3
- **Anchor lessons:**
  [lesson_nature-of-waves.html](lesson_nature-of-waves.html) (gold standard),
  [lesson_wave-behavior.html](lesson_wave-behavior.html) (gold standard),
  [lesson_digital-signals.html](lesson_digital-signals.html) (gold standard)
- **Supporting files:**
  [investigation_amplitude-challenge.html](investigation_amplitude-challenge.html),
  [game_photon-runner.html](game_photon-runner.html)
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
  [lesson_engineering-design.html](lesson_engineering-design.html),
  [lesson_designing-to-scale.html](lesson_designing-to-scale.html),
  [lesson_choosing-materials.html](lesson_choosing-materials.html)
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
  [challenge_welcome-to-floatia.html](challenge_welcome-to-floatia.html)
- **Supporting files:**
  [challenge_ball-run_day1.html](challenge_ball-run_day1.html) through
  [challenge_ball-run_day5.html](challenge_ball-run_day5.html) and
  [challenge_slow-motion-ball-run.html](challenge_slow-motion-ball-run.html)
  (hands-on prototyping practice, currently unbadged)
- **Prerequisites:** Unit 8
- **Rationale:** The year closes with students building, testing, and refining
  a physical prototype and defending their decisions, which converts the
  engineering lessons into assessed performance and gives the Structure and
  Function theme its culminating designed structure.

## Grade 7 Scope and Sequence

Grade 7 follows the framework's Systems and Cycles theme through the
repository's established unit order: Earth Systems, Water Systems, Human
Impacts, Ecosystems, Ecosystem Stability, Energy Systems, Engineering Systems.
It stands at 21 of 28 standards at Primary depth. The four standards with no
current coverage (7.MS-PS3-1, PS3-2, PS3-3, 7.MS-LS2-5) appear below as
planned units with their raw material identified, because the sequence is
designed around where those units will sit, not around their absence.

### Unit 1: Earth's Dynamic Surface

- **Family:** Dynamic Earth
- **Standards:** 7.MS-ESS2-2; 7.MS-ESS3-2 (Partial, formalization planned)
- **Anchor lesson:** [lesson_earths-layers.html](lesson_earths-layers.html)
  (Grade 7 gold standard)
- **Supporting files:** [lesson_plate-tectonics.html](lesson_plate-tectonics.html),
  [lesson_earthquakes.html](lesson_earthquakes.html),
  [lesson_types-of-volcanoes.html](lesson_types-of-volcanoes.html),
  [lesson_hotspot-volcanoes.html](lesson_hotspot-volcanoes.html),
  [lesson_weathering-and-erosion.html](lesson_weathering-and-erosion.html),
  [simulation_floatlandia-fracture.html](simulation_floatlandia-fracture.html)
- **Prerequisites:** Grade 6 Unit 4 (evidence of plate movement)
- **Rationale:** The year opens with its deepest cluster, six lessons spanning
  global to local scales of surface change, because resolving the mechanism
  behind the Grade 6 continental-drift evidence is the most motivating payoff
  available for returning students. The three hazard lessons already carry
  substantial forecasting content; a badge-plus-assessment pass on the
  earthquake lesson is the planned route to formalizing ESS3-2 within this
  unit.

### Unit 2: Water Systems

- **Family:** Sun, Gravity, and Earth's Cycles
- **Standards:** 7.MS-ESS2-4
- **Anchor lesson:** [lesson_water-cycle.html](lesson_water-cycle.html)
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
  [lesson_parts-of-an-ecosystem.html](lesson_parts-of-an-ecosystem.html),
  [lesson_energy-flow.html](lesson_energy-flow.html),
  [lesson_carbon-cycle.html](lesson_carbon-cycle.html)
- **Supporting files:** [lesson_photosynthesis.html](lesson_photosynthesis.html),
  [lesson_reproductive-success.html](lesson_reproductive-success.html),
  [investigation_population-patterns.html](investigation_population-patterns.html)
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
  [lesson_ecosystem-stability.html](lesson_ecosystem-stability.html),
  [lesson_human-impacts.html](lesson_human-impacts.html)
- **Supporting files:**
  [lesson_renewable-and-nonrenewable-resources.html](lesson_renewable-and-nonrenewable-resources.html),
  [lesson_innovation-and-sustainability.html](lesson_innovation-and-sustainability.html)
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
  [lesson_design-tradeoffs.html](lesson_design-tradeoffs.html) (the
  decision-matrix method), scenario content from
  [lesson_human-impacts.html](lesson_human-impacts.html),
  [lesson_ecosystem-stability.html](lesson_ecosystem-stability.html), and
  [lesson_renewable-and-nonrenewable-resources.html](lesson_renewable-and-nonrenewable-resources.html)
- **Build note:** Apply the already-taught decision-matrix method to competing
  ecosystem-protection solutions (water, land, or species scenarios), so the
  unit is an application task reusing certified components rather than a new
  instructional architecture.

### Unit 6: Energy Systems

- **Family:** Energy, Waves, and Fields
- **Standards:** 7.MS-PS3-4, 7.MS-PS3-5, 7.MS-PS3-6(MA), 7.MS-PS3-7(MA),
  7.MS-PS2-3, 7.MS-PS2-5
- **Anchor lessons:** [lesson_forms-of-energy.html](lesson_forms-of-energy.html),
  [lesson_energy-transfer.html](lesson_energy-transfer.html),
  [lesson_heat-transfer.html](lesson_heat-transfer.html),
  [lesson_introduction-to-electricity.html](lesson_introduction-to-electricity.html)
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
  [challenge_ball-run_day1.html](challenge_ball-run_day1.html) through
  [challenge_ball-run_day5.html](challenge_ball-run_day5.html) and
  [challenge_slow-motion-ball-run.html](challenge_slow-motion-ball-run.html)
  (the rolling-ball phenomenon and its data), plus
  [simulation_gravity-wells.html](simulation_gravity-wells.html) as accessible
  Grade 6 background (a bridge, not a counted Grade 7 asset)
- **Build note:** Build a data-and-graphs lesson from the ball-run phenomenon
  for the kinetic energy, mass, and speed relationships of PS3-1, and a
  dedicated potential-energy modeling lesson (gravity, magnets, and charges per
  the clarification) that formalizes the gravity-well intuition for PS3-2.

### Unit 8 (planned): Thermal Engineering Design

- **Family:** Energy, Waves, and Fields / Engineered Systems
- **Standards to address:** 7.MS-PS3-3
- **Existing raw material:**
  [lesson_heat-transfer.html](lesson_heat-transfer.html) (the conduction,
  convection, and radiation model the device must control)
- **Build note:** Attach an insulated-box or solar-cooker design-build-test
  task to the heat-transfer lesson, which closes the PS3-3 gap and generates
  engineering-practice evidence for the ETS1 strand in the same build.

### Unit 9: Engineering Systems

- **Family:** Engineered Systems
- **Standards:** 7.MS-ETS1-2, 7.MS-ETS3-1(MA), 7.MS-ETS3-2(MA),
  7.MS-ETS3-3(MA), 7.MS-ETS3-4(MA), 7.MS-ETS3-5(MA); 7.MS-ETS1-4 and
  7.MS-ETS1-7(MA) (Partial, badging planned)
- **Anchor lessons:**
  [lesson_design-tradeoffs.html](lesson_design-tradeoffs.html),
  [lesson_communication-systems.html](lesson_communication-systems.html),
  [lesson_transportation-systems.html](lesson_transportation-systems.html),
  [lesson_structural-systems.html](lesson_structural-systems.html),
  [lesson_engineering-systems.html](lesson_engineering-systems.html) (the ETS3
  capstone)
- **Supporting files:** [lesson_ragebaiting.html](lesson_ragebaiting.html) and
  [lesson_technology-and-society.html](lesson_technology-and-society.html)
  (unbadged adjacent content), the ball-run challenge sequence (the designated
  vehicle for converting ETS1-4 and ETS1-7(MA) to Primary through badging and
  formalized data capture)
- **Prerequisites:** Grade 6 Units 7 through 9 (signal physics and the first
  prototype cycle)
- **Rationale:** The year and the two-year arc both close on the complete
  MA-specific ETS3 systems suite, where students who began with wave pulses in
  Grade 6 now model the inputs, processes, outputs, and feedback of the
  communication, transportation, and structural systems society builds on that
  physics.

## Vertical Articulation

The ten Grade 6 to Grade 7 bridge points documented in the Grade 7 coverage
map, with the anchor file on each side. Planned Grade 7 assets are marked.

| Grade 6 Standard | Grade 6 Anchor File | Grade 7 Standard | Grade 7 Anchor File | Nature of Connection |
|---|---|---|---|---|
| 6.MS-ESS2-3 | lesson_continental-drift.html | 7.MS-ESS2-2 | lesson_plate-tectonics.html | Drift introduces Wegener's evidence; tectonics explains the mechanism. The plate-tectonics lesson badges both codes by design, making the articulation inspectable in one file. |
| 6.MS-PS2-4 | lesson_gravity.html | 7.MS-ESS2-4 | lesson_water-cycle.html | The Grade 6 gravity claim is a named driver in the Grade 7 PE itself: gravity pulls water along its downhill paths through the hydrosphere. |
| 6.MS-ESS1-4 | lesson_layers-of-time.html | 7.MS-ESS3-2 | lesson_earthquakes.html (badge and assessed task planned) | Reading geologic evidence for patterns at Grade 6 scales up to forecasting future catastrophic events from those patterns. |
| 6.MS-LS1-2 | lesson_organelles.html | 7.MS-LS2-3 | lesson_photosynthesis.html | Chloroplasts and mitochondria at cell scale become producers and consumers at ecosystem scale; investigation_cell-energy.html teaches the cell-scale half of the bridge. |
| 6.MS-LS4-1 / 6.MS-LS4-2 | lesson_biological-evolution.html | 7.MS-LS1-4 | lesson_reproductive-success.html | Anatomical-evidence reasoning about relationships extends to the behaviors and specialized structures that increase reproductive success. |
| 6.MS-PS2-4 | simulation_gravity-wells.html | 7.MS-PS2-5 | lesson_introduction-to-electricity.html | The PE explicitly includes fields between masses; the Grade 6 gravity cluster is the first field case students argue from. |
| 6.MS-PS2-4 | simulation_gravity-wells.html | 7.MS-PS3-2 | planned Energy of Motion unit | The gravity-well simulation gives students the position-and-potential-energy intuition the planned Grade 7 lesson will formalize; it is a bridge, not the lesson. |
| 6.MS-PS1-7(MA) | lesson_measuring-matter.html | 7.MS-PS3-4 / 7.MS-PS3-6(MA) | lesson_heat-transfer.html | Temperature as average particle kinetic energy builds directly on the Grade 6 particulate model of matter. |
| 6.MS-ETS1-1 / 6.MS-ETS2-1/2-2/2-3(MA) | challenge_welcome-to-floatia.html | 7.MS-ETS1-2 / 7.MS-ETS1-4 / 7.MS-ETS1-7(MA) | lesson_design-tradeoffs.html | Grade 6 defines problems and builds a first prototype; Grade 7 adds systematic evaluation with a decision matrix and iterative optimization. |
| 6.MS-PS4-3 | lesson_digital-signals.html | 7.MS-ETS3-1(MA) | lesson_communication-systems.html | Encoder, transmitter, and decoder vocabulary begins in the Grade 6 digitized-signals lesson - the cleanest cross-grade narrative in the catalog. |

## Assessment Architecture Note

Every assessed experience in this scope and sequence finalizes on submit:
student attempts are finalized server-side by a dedicated Cloud Function and
stored as immutable, ownership-stamped attempt records that no student,
teacher, administrator, or client operation can modify after the fact. Because
each assessed page carries explicit standards badges, an attempt record is
simultaneously a fixed piece of evidence against a named performance
expectation, so the standards-aligned evidence a reviewer or district examines
is exactly the work as the student submitted it, at the moment they submitted
it.

The no-crossover grade assignment supports the same integrity at the reporting
level. Every file in the catalog belongs to exactly one grade, every badge
carries its grade prefix, and no file is counted toward both grades even where
students cross grade lines for enrichment or review, so evidence rolled up for
a Grade 7 standard can never silently include Grade 6 work or vice versa. The
result is that vertical articulation is a designed relationship between two
cleanly separated evidence sets rather than a blur between them: a district can
report Grade 6 mastery and Grade 7 mastery independently while still seeing the
ten documented bridge points that connect the two years.
