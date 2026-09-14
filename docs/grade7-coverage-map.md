# Grade 7 STE Standards Coverage Map

Audit pass for LyfeLabz toward EdReports / DESE CURATE submission, using
`docs/grade6-coverage-map.md` (2026-09-14) as the baseline. Grade 6 is complete
at 22/22 Primary; this map is the Grade 7 build roadmap.

- **Source of standards:** Massachusetts 2016 Science and Technology/Engineering
  Curriculum Framework, Grade 7 section (printed pages 54-60 of the framework;
  the Grade 6 map's "pages 54-59" citation used PDF pagination - the printed
  Grade 6 section is pages 47-53). Standard list extracted directly from the
  framework's middle school section on 2026-09-14 and cross-checked against the
  framework's own bracketed grade-assignment notes.
- **Grade 7 standard count:** 28, across four disciplines: Earth and Space
  Science (4), Life Science (7), Physical Science (9), Technology/Engineering (8).
- **Generated:** 2026-09-14. Documentation/audit pass only; no lesson or page
  files were modified.

**Coverage categories:**

- **Primary** - a lesson or interactive is built around this standard.
- **Partial** - the standard is addressed but is not the focus (or the content
  exists without a badge).
- **Gap** - no current coverage.

## Grade 7 integration theme (from the framework)

**Systems and Cycles.** Students in Grade 7 focus on systems and cycles, using
their understanding of structures and functions from Grade 6. Central ideas
include the cycling of matter and flow of energy in ecosystems and Earth
systems, energy in physical systems, and the technological systems used by
society. This matches the repository's Grade 7 unit order: Earth Systems, Water
Systems, Human Impacts, Ecosystems, Ecosystem Stability, Energy Systems,
Engineering Systems.

---

## Summary Table

Files listed are repository-root HTML pages (the public v1 delivery pages).
Lessons in the build pipeline also exist in `lesson-sources/` and `app/lessons/`.

### Earth and Space Sciences (7.MS-ESS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 7.MS-ESS2-2 | Construct an explanation for how Earth's surface has changed over scales from local to global | Primary | lesson_earths-layers.html, lesson_plate-tectonics.html, lesson_earthquakes.html, lesson_types-of-volcanoes.html, lesson_hotspot-volcanoes.html, lesson_weathering-and-erosion.html; Partial: simulation_floatlandia-fracture.html | The deepest Grade 7 cluster: six badged lessons spanning global (plates, volcanoes, quakes) to local (weathering/erosion) scales. Earth's Layers is the Grade 7 gold-standard lesson. Floatlandia Fracture (plate/fault simulation) is unbadged. |
| 7.MS-ESS2-4 | Model how the Sun's energy and Earth's gravity drive the water cycle through the hydrosphere | Primary | lesson_water-cycle.html | Single badged lesson; state changes and multiple pathways addressed. |
| 7.MS-ESS3-2 | Analyze data from past geologic events to forecast location and likelihood of future catastrophic events | Partial | lesson_earthquakes.html, lesson_types-of-volcanoes.html, lesson_hotspot-volcanoes.html | No page badges this PE, but all three hazard lessons contain substantial forecasting/prediction content (25+ mentions each). A dedicated forecasting-from-patterns lesson or a badge-plus-assessment pass on the earthquake lesson would formalize it. |
| 7.MS-ESS3-4 | Argue that human activities and technologies can mitigate impacts of population and consumption on the environment | Primary | lesson_renewable-and-nonrenewable-resources.html; Partial: lesson_human-impacts.html, lesson_innovation-and-sustainability.html | Renewable/nonrenewable lesson carries the badge; Human Impacts and the unbadged Innovation and Sustainability lesson reinforce the mitigation argument. |

### Life Science (7.MS-LS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 7.MS-LS1-4 | Explain how animal behaviors and specialized plant structures increase the probability of successful reproduction | Primary | lesson_reproductive-success.html | Single badged lesson. |
| 7.MS-LS2-1 | Analyze data on effects of resource abundance and scarcity on organisms and population size | Primary | investigation_population-patterns.html | An interactive investigation built around the PE's data-analysis verb - a good verb match. No standalone lesson; consider whether a reviewer expects lesson-level instruction behind the investigation. |
| 7.MS-LS2-2 | Describe competitive, predatory, parasitic, and mutually beneficial relationships across ecosystems | Primary | lesson_parts-of-an-ecosystem.html | Single badged lesson. |
| 7.MS-LS2-3 | Model matter and energy transfer among living and nonliving parts of an ecosystem; both are conserved | Primary | lesson_carbon-cycle.html, lesson_energy-flow.html; Partial: investigation_cell-energy.html, lesson_photosynthesis.html | Two badged lessons split the PE (matter cycling / energy flow). investigation_cell-energy carries an un-prefixed MS-LS2-3 badge - a Grade 6 cells investigation that reaches into this Grade 7 PE; treat as a candidate Grade 7 crossover pending curriculum confirmation. Photosynthesis is Partial here via its content (see Notes & Caveats for its invalid badge). |
| 7.MS-LS2-4 | Analyze data showing that disruptions to any ecosystem component shift all its populations | Primary | lesson_ecosystem-stability.html, lesson_human-impacts.html | Two badged lessons: natural disruptions (stability) and human-made (impacts). |
| 7.MS-LS2-5 | Evaluate competing design solutions for protecting an ecosystem; discuss benefits and limitations | Gap | - | No coverage. Note this is an engineering-practice PE inside LS; the Grade 7 decision-matrix lesson (7.MS-ETS1-2, lesson_design-tradeoffs.html) is the natural method to apply to an ecosystem-protection scenario. |
| 7.MS-LS2-6(MA) | Explain how changes to an ecosystem's biodiversity may limit the availability of resources humans use | Primary | lesson_human-impacts.html | Badged alongside LS2-4; biodiversity-to-human-resources link addressed. |

### Physical Science (7.MS-PS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 7.MS-PS2-3 | Analyze data on the effect of distance and charge magnitude on electric force strength | Primary | lesson_introduction-to-electricity.html | Badged; includes attractive and repulsive forces. |
| 7.MS-PS2-5 | Argue from evidence that fields exist between masses, magnets, and charges without contact | Primary | lesson_introduction-to-electricity.html | Badged on the same lesson as PS2-3. simulation_gravity-wells.html (Grade 6, 6.MS-PS2-4) visualizes mass fields and is a ready-made Partial support if cross-listed. |
| 7.MS-PS3-1 | Construct and interpret graphs of relationships among kinetic energy, mass, and speed | Gap | - | No coverage. The unbadged ball-run challenge sequence (rolling-ball energy) is raw material for the data/graphing work this PE requires. |
| 7.MS-PS3-2 | Model the relationship between relative positions of interacting objects and their potential energy | Gap | - | No coverage. simulation_gravity-wells.html is nearly this PE's model (position in a gravity well vs. potential energy) but is badged only to Grade 6 PS2-4. |
| 7.MS-PS3-3 | Design, construct, and test a device to minimize or maximize thermal energy transfer | Gap | - | No coverage. A natural engineering companion to lesson_heat-transfer.html (insulated box / solar cooker design task). |
| 7.MS-PS3-4 | Investigate relationships among energy transferred, type of matter, mass, and temperature change | Primary | lesson_heat-transfer.html | Badged. PE verb is "conduct an investigation"; a hands-on lab task would strengthen verb alignment. |
| 7.MS-PS3-5 | Present evidence that when an object's kinetic energy changes, energy is transferred to or from it | Primary | lesson_energy-transfer.html | Badged. |
| 7.MS-PS3-6(MA) | Model how thermal energy transfers from hotter to colder regions by convection, conduction, and radiation | Primary | lesson_heat-transfer.html | Badged alongside PS3-4. |
| 7.MS-PS3-7(MA) | Use informational text to describe kinetic-potential energy relationships and conversions | Primary | lesson_forms-of-energy.html | Badged. |

### Technology/Engineering (7.MS-ETS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 7.MS-ETS1-2 | Evaluate competing solutions with a decision matrix against criteria and constraints; use models to evaluate design variations | Primary | lesson_design-tradeoffs.html | Badged decision-matrix lesson. |
| 7.MS-ETS1-4 | Generate and analyze data from iterative testing and modification to optimize an object, tool, or process | Partial | challenge_ball-run_day1.html through day5.html, challenge_slow-motion-ball-run.html | The five-day ball-run challenge is exactly iterative test-and-modify engineering but carries no standards badges. Badging it (and formalizing its data capture) would likely convert this to Primary without new builds. |
| 7.MS-ETS1-7(MA) | Construct a prototype of a solution to a given design problem | Partial | challenge_ball-run_day1.html through day5.html | Same situation as ETS1-4: prototype construction happens in the ball-run sequence, unbadged. The Grade 6 Floatia capstone assesses the Grade 6 counterpart (6.MS-ETS2-3(MA)); Grade 7 needs its own badged prototype task. |
| 7.MS-ETS3-1(MA) | Explain the function of a communication system and its components (source, encoder, transmitter, receiver, decoder, storage) | Primary | lesson_communication-systems.html | Badged. |
| 7.MS-ETS3-2(MA) | Compare benefits and drawbacks of different communication systems | Primary | lesson_communication-systems.html; Partial: lesson_ragebaiting.html | Badged. The media-literacy lesson (Don't Take the Bait) is unbadged adjacent content on drawbacks of internet communication. |
| 7.MS-ETS3-3(MA) | Describe how transportation systems move people and goods; identify vehicle subsystems | Primary | lesson_transportation-systems.html | Badged; subsystems (structural, propulsion, guidance, suspension, control) addressed. |
| 7.MS-ETS3-4(MA) | Show how components of a structural system work together; relate structure design to intended use | Primary | lesson_structural-systems.html | Badged. |
| 7.MS-ETS3-5(MA) | Use systems engineering to model inputs, processes, outputs, and feedback in a transportation, structural, or communication system | Primary | lesson_engineering-systems.html | Badged; the capstone of the ETS3 systems suite. |

---

## Coverage by Strand

| Strand | Standards | Primary | Partial | Gap | Primary % |
|---|---|---|---|---|---|
| Earth and Space Science (ESS) | 4 | 3 | 1 | 0 | **75%** |
| Life Science (LS) | 7 | 6 | 0 | 1 | **86%** |
| Physical Science (PS) | 9 | 6 | 0 | 3 | **67%** |
| Technology/Engineering (ETS) | 8 | 6 | 2 | 0 | **75%** |
| **Total** | **28** | **21** | **3** | **4** | **75%** |

Grade 7 is roughly three quarters built at Primary depth - much further along
than a cold start, and several of the remaining seven standards are near-misses
(existing content that needs badging or a focused companion task) rather than
true builds.

---

## Gap List (the Grade 7 build roadmap)

### Physical Science - the largest gap cluster (energy of motion)

1. **7.MS-PS3-1 - kinetic energy, mass, speed graphs.** No coverage. Roadmap:
   a data-and-graphs lesson; the ball-run sequence supplies the phenomenon.
2. **7.MS-PS3-2 - relative position and potential energy.** No coverage.
   Roadmap: a lesson that could lean on simulation_gravity-wells.html as its
   interactive (position in a well vs. stored energy), plus magnets/charges
   examples per the clarification.
3. **7.MS-PS3-3 - design a thermal-transfer device.** No coverage. Roadmap: an
   engineering task attached to lesson_heat-transfer.html (insulated box or
   solar cooker); also generates ETS-practice evidence.

### Life Science

4. **7.MS-LS2-5 - evaluate ecosystem-protection design solutions.** No
   coverage. Roadmap: a design-evaluation task (water/land/species protection
   scenarios) reusing the decision-matrix method from
   lesson_design-tradeoffs.html.

### Near-gaps (Partial - formalize rather than build)

- **7.MS-ESS3-2 - forecasting geologic hazards.** Content exists across the
  earthquake and volcano lessons; needs a badge and an assessed
  patterns-to-forecast task, or a small dedicated lesson.
- **7.MS-ETS1-4 and 7.MS-ETS1-7(MA) - iterative testing and prototype
  construction.** The ball-run challenge sequence does both; badge it and
  formalize its data capture to convert both to Primary.

---

## Grade 6 Bridge Points

Grade 7 PEs where existing Grade 6 content in the repo provides an explicit
on-ramp - expansion points, not cold starts:

| Grade 7 standard | Grade 6 foundation in repo | Bridge |
|---|---|---|
| 7.MS-ESS2-2 (surface change, plate processes) | 6.MS-ESS2-3 (lesson_continental-drift.html) | Already realized: lesson_plate-tectonics.html badges both codes - drift introduces the evidence, tectonics explains the mechanism. The model bridge for all others. |
| 7.MS-ESS2-4 (Sun + gravity drive water cycle) | 6.MS-PS2-4 (lesson_gravity.html) | Gravity as the driver of water's downhill paths; the Grade 6 gravity claim is a named prerequisite in the PE itself. |
| 7.MS-ESS3-2 (forecast from geologic patterns) | 6.MS-ESS1-4 (lesson_layers-of-time.html) | Reading geologic evidence for patterns is the Grade 6 skill this PE scales up to prediction. |
| 7.MS-LS2-3 (ecosystem matter/energy transfer) | 6.MS-LS1-2 (lesson_organelles.html, investigation_cell-energy.html) | Chloroplasts/mitochondria at cell scale become producers/consumers at ecosystem scale. investigation_cell-energy already physically spans both grades' codes. |
| 7.MS-LS1-4 (reproductive success) | 6.MS-LS4-1/4-2 (lesson_biological-evolution.html) | Anatomical-evidence reasoning extends to behaviors/structures that boost reproduction. |
| 7.MS-PS2-5 (fields without contact) | 6.MS-PS2-4 (lesson_gravity.html, simulation_gravity-wells.html) | The PE explicitly includes fields between masses; the Grade 6 gravity cluster is its first case. |
| 7.MS-PS3-2 (position and potential energy) | 6.MS-PS2-4 (simulation_gravity-wells.html) | The existing simulation is nearly this PE's required model. |
| 7.MS-PS3-4/3-6(MA) (thermal energy) | 6.MS-PS1-7(MA) particulate model (lesson_measuring-matter.html) | Temperature as average particle kinetic energy builds directly on the Grade 6 particle model. |
| 7.MS-ETS1-2/1-4/1-7(MA) (evaluate, iterate, prototype) | 6.MS-ETS1-1, 6.MS-ETS2-1/2-2/2-3(MA) (engineering arc + Floatia capstone) | Grade 6 defines problems and builds a first prototype; Grade 7 adds systematic evaluation and iterative optimization. |
| 7.MS-ETS3-1(MA) (communication system components) | 6.MS-PS4-3 (lesson_digital-signals.html) | Encoder/transmitter/decoder vocabulary begins in the Grade 6 digitized-signals lesson - the cleanest cross-grade narrative in the catalog. |

---

## Anchor Candidates

Strongest existing Grade 7 content for the eventual submission narrative:

- **Earth-surface cluster (7.MS-ESS2-2)** - six badged lessons anchored by
  lesson_earths-layers.html, the Grade 7 gold-standard lesson, plus the
  Floatlandia Fracture simulation. The flagship strand.
- **ETS3 systems suite (7.MS-ETS3-1 through 3-5(MA))** - five badged lessons
  covering all five MA-specific technology-systems standards, capped by
  lesson_engineering-systems.html. Complete coverage of a strand many programs
  skip; a differentiator for a Massachusetts-specific submission.
- **Ecosystems cluster (7.MS-LS2-1/2-2/2-3/2-4/2-6(MA))** - five of the six LS2
  standards at Primary across four lessons and an investigation, matching the
  repo's Systems and Cycles theme.
- **Human-impacts pairing (7.MS-LS2-4 + LS2-6(MA) + ESS3-4)** -
  lesson_human-impacts.html and lesson_renewable-and-nonrenewable-resources.html
  form a coherent cross-strand mini-narrative.
- **Thermal-energy pairing (7.MS-PS3-4 + PS3-6(MA))** - lesson_heat-transfer.html
  carries two PEs cleanly; adding the PS3-3 design task would make this a
  three-PE anchor.

---

## Notes & Caveats

1. **Framework version and pagination.** Standards list is the Massachusetts
   2016 STE Framework, Grade 7 (printed pages 54-60), extracted from the
   framework's middle school section. The framework's bracketed notes confirm
   grade assignments (e.g., "MS-ETS1-2, MS-ETS1-4, and MS-ETS1-7(MA) are found
   in grade 7") and exclusions: **MS-LS1-6, MS-LS1-8, and MS-ETS1-3 from NGSS
   are not included in the MA framework at any grade.**
2. **Invalid badge on lesson_photosynthesis.html.** The lesson badges
   `7.MS-LS1-6` (lines 797, 802), a code the framework explicitly does not
   include - the same class of error the June 2026 cleanup removed from
   investigation_cell-energy.html (`6.MS-LS1-6`). The lesson's content is
   legitimate Grade 7 material; the correct home for its PE claim is
   7.MS-LS2-3 (photosynthesis as the entry point of matter/energy transfer in
   ecosystems). Flagged only - no page was modified in this pass.
3. **investigation_cell-energy.html** carries an un-prefixed `MS-LS2-3` badge
   alongside its Grade 6 codes (6.MS-LS1-2, 8.MS-LS1-7). Per current direction
   it is treated as a candidate Grade 7 crossover file pending curriculum
   confirmation; it is listed as Partial for 7.MS-LS2-3 and its badge remains
   un-prefixed.
4. **simulation_gravity-wells.html** retains an un-prefixed `MS-ESS1-2` badge
   (a Grade 8 code, kept un-prefixed by explicit decision on 2026-09-14). It is
   cited here only as raw material for 7.MS-PS3-2, which would be a new badge,
   not a reinterpretation of the existing one.
5. **Unbadged pages with inferred alignment.** challenge_ball-run_day1-5.html
   and challenge_slow-motion-ball-run.html (ETS1-4/1-7, possibly PS3-1/3-5),
   simulation_floatlandia-fracture.html (ESS2-2), lesson_ragebaiting.html
   (ETS3-2 adjacent), lesson_technology-and-society.html and
   lesson_innovation-and-sustainability.html (Grade 7 tagged, no PE codes;
   nearest homes are the ETS3 suite and ESS3-4 respectively). All alignments in
   this paragraph are inferred from content, not badges.
6. **Verb alignment watch-list.** Several Grade 7 PEs carry lab/design verbs
   ("conduct an investigation" PS3-4, "evaluate competing design solutions"
   LS2-5/ETS1-2, "generate and analyze data from iterative testing" ETS1-4).
   Where coverage is a reading lesson, an assessed hands-on task will be needed
   for submission-grade verb alignment, mirroring the Grade 6 map's PS1-6 note.
7. **Counting notes.** lesson_introduction-to-electricity.html and
   lesson_heat-transfer.html each carry two PEs; lesson_human-impacts.html
   carries LS2-4 and LS2-6(MA) plus Partial ESS3-4. Percentages count
   standards, not lessons. Off-grade codes on Grade 7 pages
   (7.MS-ESS2-2 pages carry no Grade 6 codes except lesson_plate-tectonics's
   deliberate 6.MS-ESS2-3 bridge badge) were verified against the framework's
   grade assignments.
