# Grade 7 STE Standards Coverage Map

Repository evidence map and build roadmap, factually corrected 2026-09-19
against commit `4f6f02b01eb988696592265223d2ddff28832eb4` and the Phase 1 audit.
The current map retains **21 Primary / 3 Partial / 4 Gap** across 28 standards.
These are instructional mapping classifications, not independently established
full-performance attainment. Grade 6 has meaningful instruction mapped to all
22 standards, with performance qualifications in its coverage map. External
review eligibility, framework details, and procedures await official-source
verification; no external research was performed for this correction.

- **Source of standards:** Massachusetts 2016 Science and Technology/Engineering
  Curriculum Framework, Grade 7 section (printed pages 54-60 of the framework;
  the Grade 6 map's "pages 54-59" citation used PDF pagination - the printed
  Grade 6 section is pages 47-53). The original 2026-09-14 map reported direct extraction and cross-checking
  against the framework. Those external details are historical attribution,
  not newly verified official-source findings.
- **Grade 7 standard count:** 28, across four disciplines: Earth and Space
  Science (4), Life Science (7), Physical Science (9), Technology/Engineering (8).
- **Generated:** 2026-09-14. Documentation/audit pass only; no lesson or page
  files were modified.

**Coverage categories:**

- **Primary** - a lesson or interactive is built around this standard.
- **Partial** - the original map judged the standard addressed but not the
  focus, sometimes because it lacked a badge. Absence of a badge alone does
  not justify this judgment; the ball-run classifications require review.
- **Gap** - the mapped full performance task is absent; related concepts or
  background instruction may exist. Planned specifications are not implemented
  curriculum and are not counted as coverage.

## Grade 7 integration theme (from the framework)

**Systems and Cycles.** Students in Grade 7 focus on systems and cycles, using
their understanding of structures and functions from Grade 6. Central ideas
include the cycling of matter and flow of energy in ecosystems and Earth
systems, energy in physical systems, and the technological systems used by
society. The HQIM scope-and-sequence proposes a teachable course order; it is not the
live catalog order. Its foundations precede ecosystem impacts, while the live
catalog is grouped by subject.

---

## Summary Table

Files listed are repository-root HTML pages (the public v1 delivery pages).
Lessons in the build pipeline also exist in `lesson-sources/` and `app/lessons/`.

### Earth and Space Sciences (7.MS-ESS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 7.MS-ESS2-2 | Construct an explanation for how Earth's surface has changed over scales from local to global | Primary | lesson_earths-layers.html, lesson_plate-tectonics.html, lesson_earthquakes.html, lesson_types-of-volcanoes.html, lesson_hotspot-volcanoes.html, lesson_weathering-and-erosion.html; Partial: simulation_floatlandia-fracture.html | The deepest Grade 7 cluster: six badged lessons spanning global (plates, volcanoes, quakes) to local (weathering/erosion) scales. Earth's Layers is the Grade 7 gold-standard lesson. Floatlandia Fracture has legacy `ESS1-4` and `ESS2-2` badges/tooltips requiring curriculum review. |
| 7.MS-ESS2-4 | Model how the Sun's energy and Earth's gravity drive the water cycle through the hydrosphere | Primary | lesson_water-cycle.html | Single badged lesson; state changes and multiple pathways addressed. |
| 7.MS-ESS3-2 | Analyze data from past geologic events to forecast location and likelihood of future catastrophic events | Partial | lesson_earthquakes.html, lesson_types-of-volcanoes.html, lesson_hotspot-volcanoes.html | The hazard lessons contain prediction and location-pattern content, but that does not establish analysis of historical-event data to forecast likelihood. Review the actual historical-data and likelihood task before changing the classification. |
| 7.MS-ESS3-4 | Argue that human activities and technologies can mitigate impacts of population and consumption on the environment | Primary | lesson_renewable-and-nonrenewable-resources.html; Partial: lesson_human-impacts.html, lesson_innovation-and-sustainability.html | Renewable/nonrenewable lesson carries the badge; Human Impacts and the unbadged Innovation and Sustainability lesson reinforce the mitigation argument. |

### Life Science (7.MS-LS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 7.MS-LS1-4 | Explain how animal behaviors and specialized plant structures increase the probability of successful reproduction | Primary | lesson_reproductive-success.html | Single badged lesson. |
| 7.MS-LS2-1 | Analyze data on effects of resource abundance and scarcity on organisms and population size | Primary | investigation_population-patterns.html | An interactive investigation built around the PE's data-analysis verb - a good verb match. No standalone lesson; consider whether a reviewer expects lesson-level instruction behind the investigation. |
| 7.MS-LS2-2 | Describe competitive, predatory, parasitic, and mutually beneficial relationships across ecosystems | Primary | lesson_parts-of-an-ecosystem.html | Single badged lesson. |
| 7.MS-LS2-3 | Model matter and energy transfer among living and nonliving parts of an ecosystem; both are conserved | Primary | lesson_carbon-cycle.html, lesson_energy-flow.html, lesson_photosynthesis.html | Three badged lessons: matter cycling (carbon cycle), energy flow, and photosynthesis as the entry point of matter/energy transfer (rebadged from the invalid 7.MS-LS1-6 to 7.MS-LS2-3 on 2026-09-14). investigation_cell-energy.html is confirmed Grade 6 content and is not counted toward this PE (see Notes & Caveats). |
| 7.MS-LS2-4 | Analyze data showing that disruptions to any ecosystem component shift all its populations | Primary | lesson_ecosystem-stability.html, lesson_human-impacts.html | Two badged lessons: natural disruptions (stability) and human-made (impacts). |
| 7.MS-LS2-5 | Evaluate competing design solutions for protecting an ecosystem; discuss benefits and limitations | Gap | - | Full performance task not implemented. Note this is an engineering-practice PE inside LS; the Grade 7 decision-matrix lesson (7.MS-ETS1-2, lesson_design-tradeoffs.html) is the natural method to apply to an ecosystem-protection scenario. |
| 7.MS-LS2-6(MA) | Explain how changes to an ecosystem's biodiversity may limit the availability of resources humans use | Primary | lesson_human-impacts.html | Badged alongside LS2-4; biodiversity-to-human-resources link addressed. |

### Physical Science (7.MS-PS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 7.MS-PS2-3 | Analyze data on the effect of distance and charge magnitude on electric force strength | Primary | lesson_introduction-to-electricity.html | Badged; teaches attractive/repulsive forces and charge/distance rules. Phase 1 found a substantive data-analysis weakness: the inspected lesson/quiz does not enact the PE's full data-analysis demand. Classification requires curriculum review. |
| 7.MS-PS2-5 | Argue from evidence that fields exist between masses, magnets, and charges without contact | Primary | lesson_introduction-to-electricity.html | Badged on the same lesson as PS2-3. The Grade 6 gravity-wells simulation visualizes mass fields and can serve as accessible background, but it is not a Grade 7 asset. |
| 7.MS-PS3-1 | Construct and interpret graphs of relationships among kinetic energy, mass, and speed | Gap | - | Full performance task not implemented. The unbadged ball-run challenge sequence (rolling-ball energy) is raw material for the data/graphing work this PE requires. |
| 7.MS-PS3-2 | Model the relationship between relative positions of interacting objects and their potential energy | Gap | - | Forms of Energy provides potential-energy background, and Grade 6 gravity-wells is accessible background. The full relative-position modeling performance remains absent; the proposed Grade 7 unit is not implemented. |
| 7.MS-PS3-3 | Design, construct, and test a device to minimize or maximize thermal energy transfer | Gap | - | Full performance task not implemented. A natural engineering companion to lesson_heat-transfer.html (insulated box / solar cooker design task). |
| 7.MS-PS3-4 | Investigate relationships among energy transferred, type of matter, mass, and temperature change | Primary | lesson_heat-transfer.html | Badged and instructionally relevant, but Phase 1 found a substantive investigation weakness: students do not conduct the matter-type/mass/temperature-change investigation. Classification requires curriculum review. |
| 7.MS-PS3-5 | Present evidence that when an object's kinetic energy changes, energy is transferred to or from it | Primary | lesson_energy-transfer.html | Badged. |
| 7.MS-PS3-6(MA) | Model how thermal energy transfers from hotter to colder regions by convection, conduction, and radiation | Primary | lesson_heat-transfer.html | Badged alongside PS3-4. |
| 7.MS-PS3-7(MA) | Use informational text to describe kinetic-potential energy relationships and conversions | Primary | lesson_forms-of-energy.html | Badged. |

### Technology/Engineering (7.MS-ETS)

| Standard Code | Standard Description | Coverage | File(s) | Notes |
|---|---|---|---|---|
| 7.MS-ETS1-2 | Evaluate competing solutions with a decision matrix against criteria and constraints; use models to evaluate design variations | Primary | lesson_design-tradeoffs.html | Badged decision-matrix lesson. |
| 7.MS-ETS1-4 | Generate and analyze data from iterative testing and modification to optimize an object, tool, or process | Partial | challenge_ball-run_day1.html through day5.html, challenge_slow-motion-ball-run.html | Ball-run already requires trial tables, controlled revisions, before/after comparisons, and conclusions. Partial may understate this evidence; review grade ownership and evaluation criteria. A badge is not the missing performance. |
| 7.MS-ETS1-7(MA) | Construct a prototype of a solution to a given design problem | Partial | challenge_ball-run_day1.html through day5.html | Physical prototype construction already occurs in ball-run. Partial may be conservative; review grade ownership and assessment criteria before commissioning another task. Grade 6 Floatia is supporting context, not automatically Grade 7 assessed evidence. |
| 7.MS-ETS3-1(MA) | Explain the function of a communication system and its components (source, encoder, transmitter, receiver, decoder, storage) | Primary | lesson_communication-systems.html | Badged. |
| 7.MS-ETS3-2(MA) | Compare benefits and drawbacks of different communication systems | Primary | lesson_communication-systems.html; Partial: lesson_ragebaiting.html | Badged. The media-literacy lesson is Grade 6 in the current catalog, usable as cross-grade adjacent content rather than a Grade 7-owned lesson. |
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

The **75%** is the proportion of standards labeled Primary in this map, not
percent curriculum completion or demonstrated PE attainment. PS2-3 and PS3-4
have substantive performance weaknesses despite their retained Primary labels.
ETS1-4 and ETS1-7(MA) may warrant stronger classifications based on existing
ball-run work. Those decisions are deferred to curriculum review.

---

## Gap List (the Grade 7 build roadmap)

### Physical Science - planned performance additions

1. **7.MS-PS3-1 - kinetic energy, mass, speed graphs.** Full performance task not implemented. Roadmap:
   a data-and-graphs lesson; the ball-run sequence supplies the phenomenon.
2. **7.MS-PS3-2 - relative position and potential energy.** Relevant
   background exists in Forms of Energy; the full modeling task is missing.
   Requires dedicated Grade 7 energy-of-motion content; the Grade 6
   gravity-wells simulation is accessible to Grade 7 students as background
   but is not a Grade 7 lesson. The new lesson needs its own model, plus
   magnets/charges examples per the clarification.
3. **7.MS-PS3-3 - design a thermal-transfer device.** Full performance task not implemented. Roadmap: an
   engineering task attached to lesson_heat-transfer.html (insulated box or
   solar cooker); also generates ETS-practice evidence.

### Life Science

4. **7.MS-LS2-5 - evaluate ecosystem-protection design solutions.** Full performance task not implemented. Roadmap: a design-evaluation task (water/land/species protection
   scenarios) reusing the decision-matrix method from
   lesson_design-tradeoffs.html.

### Near-gaps (Partial - formalize rather than build)

- **7.MS-ESS3-2 - forecasting geologic hazards.** Content exists across the
  earthquake and volcano lessons; needs a badge and an assessed
  patterns-to-forecast task, or a small dedicated lesson.
- **7.MS-ETS1-4 and 7.MS-ETS1-7(MA) - iterative testing and prototype
  construction.** Ball-run already does both and captures trial data and
  reflection. Review the current Partial classifications, grade attribution,
  and evaluation criteria; do not assume another task or new data capture is
  necessary.

---

## Grade 6 Bridge Points

Grade 7 PEs where existing Grade 6 content in the repo provides an explicit
on-ramp - expansion points, not cold starts:

| Grade 7 standard | Grade 6 foundation in repo | Bridge |
|---|---|---|
| 7.MS-ESS2-2 (surface change, plate processes) | 6.MS-ESS2-3 (lesson_continental-drift.html) | Already realized: lesson_plate-tectonics.html badges both codes - drift introduces the evidence, tectonics explains the mechanism. The model bridge for all others. |
| 7.MS-ESS2-4 (Sun + gravity drive water cycle) | 6.MS-PS2-4 (lesson_gravity.html) | Gravity as the driver of water's downhill paths; the Grade 6 gravity claim is a named prerequisite in the PE itself. |
| 7.MS-ESS3-2 (forecast from geologic patterns) | 6.MS-ESS1-4 (lesson_layers-of-time.html) | Reading geologic evidence for patterns is the Grade 6 skill this PE scales up to prediction. |
| 7.MS-LS2-3 (ecosystem matter/energy transfer) | 6.MS-LS1-2 (lesson_organelles.html, investigation_cell-energy.html) | Chloroplasts/mitochondria at cell scale become producers/consumers at ecosystem scale. investigation_cell-energy (confirmed Grade 6) teaches the cell-scale half of this bridge. |
| 7.MS-LS1-4 (reproductive success) | 6.MS-LS4-1/4-2 (lesson_biological-evolution.html) | Anatomical-evidence reasoning extends to behaviors/structures that boost reproduction. |
| 7.MS-PS2-5 (fields without contact) | 6.MS-PS2-4 (lesson_gravity.html, simulation_gravity-wells.html) | The PE explicitly includes fields between masses; the Grade 6 gravity cluster is its first case. |
| 7.MS-PS3-2 (position and potential energy) | 6.MS-PS2-4 (simulation_gravity-wells.html) | The Grade 6 simulation gives students the gravity-well intuition the new Grade 7 lesson will formalize; it is a bridge, not the lesson. |
| 7.MS-PS3-4/3-6(MA) (thermal energy) | 6.MS-PS1-7(MA) particulate model (lesson_measuring-matter.html) | Temperature as average particle kinetic energy builds directly on the Grade 6 particle model. |
| 7.MS-ETS1-2/1-4/1-7(MA) (evaluate, iterate, prototype) | 6.MS-ETS1-1, 6.MS-ETS2-1/2-2/2-3(MA) (engineering arc + Floatia capstone) | Grade 6 defines problems and builds a first prototype; Grade 7 adds systematic evaluation and iterative optimization. |
| 7.MS-ETS3-1(MA) (communication system components) | 6.MS-PS4-3 (lesson_digital-signals.html) | Encoder/transmitter/decoder vocabulary begins in the Grade 6 digitized-signals lesson - the cleanest cross-grade narrative in the catalog. |

---

## Anchor Candidates

Strongest existing Grade 7 content for the eventual submission narrative:

- **Earth-surface cluster (7.MS-ESS2-2)** - six badged lessons anchored by
  lesson_earths-layers.html, the Grade 7 gold-standard lesson, plus the
  Floatlandia Fracture simulation. The flagship strand.
- **ETS3 systems suite (7.MS-ETS3-1 through 3-5(MA))** - four badged lessons
  covering the five mapped technology-systems standards, capped by
  lesson_engineering-systems.html. Dedicated instruction is established; full
  performance and comparative publisher claims are not.
- **Ecosystems cluster (7.MS-LS2-1/2-2/2-3/2-4/2-6(MA))** - five of the six LS2
  standards labeled Primary across six lessons and an investigation, matching the
  repo's Systems and Cycles theme.
- **Human-impacts pairing (7.MS-LS2-4 + LS2-6(MA) + ESS3-4)** -
  lesson_human-impacts.html and lesson_renewable-and-nonrenewable-resources.html
  form a coherent cross-strand mini-narrative.
- **Thermal-energy pairing (7.MS-PS3-4 + PS3-6(MA))** - lesson_heat-transfer.html
  supports two mapped standards, but PS3-4 investigation performance is missing.
  A PS3-3 design task is planned, not implemented evidence.

---

## Notes & Caveats

1. **Historical framework attribution.** The original map cites the Massachusetts
   2016 STE Framework, Grade 7 (printed pages 54-60), extracted from the
   framework's middle school section. It reports bracketed notes confirming
   grade assignments (e.g., "MS-ETS1-2, MS-ETS1-4, and MS-ETS1-7(MA) are found
   in grade 7") and exclusions: **MS-LS1-6, MS-LS1-8, and MS-ETS1-3 from NGSS
   are not included in the MA framework at any grade.**
2. **lesson_photosynthesis.html badge corrected.** The lesson previously
   badged `7.MS-LS1-6`, a code the framework explicitly does not include. On
   2026-09-14 all four badges were replaced with `7.MS-LS2-3` through the
   lesson-build pipeline; the lesson now counts as badged Primary support for
   that PE.
3. **investigation_cell-energy.html** is treated as Grade 6 supporting content
   here and is not counted toward Grade 7 attainment. Its original unprefixed
   badge defect is resolved: it now carries `7.MS-LS2-3`. The framing of
   cross-grade/enrichment content remains a curriculum-review question.
4. **Remaining legacy badges:** simulation_gravity-wells.html retains
   `MS-ESS1-2`; simulation_floatlandia-fracture.html retains `ESS1-4` and
   `ESS2-2`, including tooltip descriptions. This pass does not select their
   replacements. Layer Detective and Amplitude Challenge's original defects
   are also resolved. Gravity-wells remains background, not a counted Grade 7
   performance task.
5. **Supporting pages with inferred alignment.** challenge_ball-run_day1-5.html
   and challenge_slow-motion-ball-run.html (ETS1-4/1-7, possibly PS3-1/3-5),
   simulation_floatlandia-fracture.html (ESS2-2), lesson_ragebaiting.html
   (ETS3-2 adjacent), lesson_technology-and-society.html and
   lesson_innovation-and-sustainability.html (Grade 7 tagged, no PE codes;
   nearest homes are the ETS3 suite and ESS3-4 respectively). All alignments in
   this paragraph are inferred from content, not badges.
6. **Verb alignment watch-list.** PS2-3 data analysis and PS3-4 investigation
   are substantive weaknesses in currently Primary rows. Several Grade 7 PEs carry lab/design verbs
   ("conduct an investigation" PS3-4, "evaluate competing design solutions"
   LS2-5/ETS1-2, "generate and analyze data from iterative testing" ETS1-4).
   Where coverage is a reading lesson, an assessed hands-on task will be needed
   to establish the missing performance, mirroring the Grade 6 PS1-6 note.
   Existing ball-run data capture should be evaluated before new work is planned.
7. **Counting notes.** lesson_introduction-to-electricity.html and
   lesson_heat-transfer.html each carry two PEs; lesson_human-impacts.html
   carries LS2-4 and LS2-6(MA) plus Partial ESS3-4. Percentages count
   standards, not lessons. Off-grade codes on Grade 7 pages
   (7.MS-ESS2-2 pages carry no Grade 6 codes except lesson_plate-tectonics's
   deliberate 6.MS-ESS2-3 bridge badge) were verified against the framework's
   grade assignments in the historical correction work; not reverified here.
