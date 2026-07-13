# LyfeLabz Grade 6 — Massachusetts STE Standards Alignment Audit v2
**Date:** June 2026  
**Scope:** Massachusetts 2016 STE Standards — Grade 6 only  
**Purpose:** Standards alignment verification — not curriculum quality or HQIM review  
**Question answered:** What Massachusetts Grade 6 STE standards are currently covered by LyfeLabz?

**Framework sources used (all official DESE documents):**
- MA DESE STE Instructional Guidelines 6th–8th Grade (August 2023)
- OpenSciEd MA Guidance: 6th Grade Cells & Systems (April 2022)
- OpenSciEd MA Guidance: 6th Grade Earth in Space (February 2025)
- OpenSciEd MA Guidance: 6th Grade Forces at a Distance (February 2025)
- OpenSciEd MA Guidance: 6th Grade Plate Tectonics & Rock Cycling (September 2021)
- OpenSciEd MA Guidance: 8th Grade Natural Selection & Common Ancestry (May 2022)

---

## 1. Executive Summary

LyfeLabz has meaningful coverage of **10 out of 20 confirmed Grade 6 MA STE standards** at a Full, Mostly, or Partial level. The strongest coverage is in Life Science (LS1 cell and body systems standards) and Earth and Space Science (ESS1 astronomy). The weakest areas are Physical Science waves applications (PS4-2, PS4-3 uncovered), the Milky Way/galaxies standard (ESS1-5 uncovered), and all Technology/Engineering standards (ETS2-x uncovered, planned).

The most significant alignment issue found is that LyfeLabz's evolution content — across `lesson_biological-evolution.html`, `simulation_beetle-island.html`, `game_evolution-clicker.html`, `extension_chernobyl-frogs.html`, and `blog/teach-natural-selection-6th-grade.html` — is **primarily built around 8.MS-LS4-4 (natural selection), a Grade 8 standard**, while presenting that content as Grade 6 curriculum. The Grade 6 evolution standards (6.MS-LS4-1 fossil record, 6.MS-LS4-2 anatomical structures) are present in those pages but are secondary to the natural selection content.

A secondary alignment issue is that several astronomy pages use the code `MS-ESS1-2` (or `6.ESS1-2`) to label gravity/orbital content. Based on the DESE documents reviewed, the correct Grade 6 standard for gravitational force is **6.MS-PS2-4** (already correctly used in `simulation_gravity-wells.html`), while `8.MS-ESS1-2` is the Grade 8 standard for gravity in orbital motions. The `MS-ESS1-2` label in lesson pages is incorrect.

**Corrected overall coverage: 59% of Grade 6 standards have some form of coverage (full, mostly, or partial). 41% have minimal or no coverage.**

---

## 2. Grade 6 Standards Coverage Dashboard

| Domain | Standard | Coverage | Notes |
|---|---|---|---|
| **Life Science** | 6.MS-LS1-1 | ✅ Fully Covered | Multiple pages, correct code |
| **Life Science** | 6.MS-LS1-2 | ✅ Fully Covered | Multiple pages, correct code |
| **Life Science** | 6.MS-LS1-3 | 🟡 Mostly Covered | Body systems content present; interaction emphasis needs review |
| **Life Science** | 6.MS-LS4-1 | 🟠 Partially Covered | Fossil content present but submerged under Grade 8 natural selection content |
| **Life Science** | 6.MS-LS4-2 | 🟠 Partially Covered | Anatomical/homologous content present; not labeled with correct MA code |
| **Earth & Space** | 6.MS-ESS1-1a | ✅ Fully Covered | Strongest unit in repo; multiple pages, quizzes |
| **Earth & Space** | 6.MS-ESS1-4 | 🟡 Mostly Covered | Rock layers, index fossils well covered |
| **Earth & Space** | 6.MS-ESS1-5 | ❌ No Coverage | No galaxy/Milky Way content in Grade 6 scope |
| **Earth & Space** | 6.MS-ESS2-3 | 🟡 Mostly Covered | Continental drift, fossil maps well covered |
| **Physical Science** | 6.MS-PS2-4 | 🟡 Mostly Covered | Correct code in gravity sim; mislabeled in lesson pages |
| **Physical Science** | 6.MS-PS4-1 | ✅ Fully Covered | Best-supported PS standard in repo |
| **Physical Science** | 6.MS-PS4-2 | 🔴 Minimal Coverage | Badge only; no dedicated page or investigation |
| **Physical Science** | 6.MS-PS4-3 | ❌ No Coverage | Digitized signals — no page exists |
| **Physical Science** | 6.MS-PS1-6 | ❌ No Coverage | Exothermic/endothermic — planned for summer |
| **Tech/Engineering** | 6.MS-ETS1-1 | ❌ No Coverage | Design criteria and constraints — planned |
| **Tech/Engineering** | 6.MS-ETS1-5(MA) | ❌ No Coverage | 2D scale drawing — planned |
| **Tech/Engineering** | 6.MS-ETS1-6(MA) | ❌ No Coverage | Labeled construction drawing — planned |
| **Tech/Engineering** | 6.MS-ETS2-1(MA) | ❌ No Coverage | Material properties — planned |
| **Tech/Engineering** | 6.MS-ETS2-2(MA) | ❌ No Coverage | Materials selection for design — planned |
| **Tech/Engineering** | 6.MS-ETS2-3(MA) | ❌ No Coverage | Measuring/hand tools — planned |

---

## 3. Complete Standards Matrix

### Phase 1: Grade 6 MA STE Standards Master List

All standards below are confirmed Grade 6 from official DESE unit guidance documents. Standard codes use the full MA format (grade.MS-domain#-standard#).

---

#### LIFE SCIENCE

**6.MS-LS1-1**  
*Provide evidence that all organisms (unicellular and multicellular) are made of cells.*  
Clarification: Evidence can be drawn from multiple types of organisms, such as plants, animals, and bacteria.  
Source: Cells & Systems guidance, p. 1

**6.MS-LS1-2**  
*Develop and use a model to describe how parts of cells contribute to the cellular functions of obtaining food, water, and other nutrients from its environment, disposing of wastes, and providing energy for cellular processes.*  
Clarification: Parts include nucleus, chloroplasts, mitochondria, vacuoles, cell membrane, cell wall.  
Assessment Boundary: Specific biochemical steps, ATP, active transport, identifying or comparing different cell types not expected in state assessment.  
Source: Cells & Systems guidance, p. 1

**6.MS-LS1-3**  
*Construct an argument supported by evidence that the body systems interact to carry out essential functions of life.*  
Clarification (from DESE Instructional Guidelines): Circulatory, digestive, respiratory, excretory, muscular/skeletal, and nervous systems. Emphasis on functions and interactions, not specific body parts or organs. Example: respiratory system takes in oxygen → circulatory system delivers it to cells.  
Assessment Boundary: Mechanism of one body system independent of others, or biochemical processes involved, not expected.  
Source: Cells & Systems guidance, p. 1; DESE Instructional Guidelines, p. 14

**6.MS-LS4-1**  
*Analyze and interpret evidence from the fossil record to describe organisms and their environment, extinctions, and changes to life forms throughout the history of Earth.*  
Clarification: Evidence includes fossils indicating specific type of environment, anatomical structures indicating function, fossilized tracks indicating behavior.  
Assessment Boundary: Names of individual species, geological eras, or mechanisms for speciation not expected.  
Source: Plate Tectonics guidance, p. 1; Natural Selection guidance, p. 1 (listed as "Additional Standard" completed at Grade 8)

**6.MS-LS4-2**  
*Construct an argument using anatomical structures to support evolutionary relationships among and between fossil organisms and modern organisms.*  
Source: Natural Selection guidance, p. 1 (listed as "Additional Standard" completed at Grade 8)  
Note: This standard is introduced at Grade 6 and completed in the Grade 8 Natural Selection & Common Ancestry unit.

---

#### EARTH AND SPACE SCIENCE

**6.MS-ESS1-1a**  
*Develop and use a model of the Earth-Sun-Moon system to explain the causes of lunar phases and eclipses of the Sun and Moon.*  
Clarification: Examples of models can be physical, graphical, or conceptual; should emphasize relative positions and distances.  
Source: Earth in Space guidance, p. 1  
Note: Seasons (8.MS-ESS1-1b) is a separate Grade 8 standard — not part of 6.MS-ESS1-1a.

**6.MS-ESS1-4**  
*Analyze and interpret rock layers and index fossils to determine the relative ages of rock formations that result from processes occurring over long periods of time.*  
Clarification: Laws of superposition and crosscutting relationships limited to minor displacement faults. Processes include weathering, erosion, heat, pressure.  
Assessment Boundary: Reordered strata, names of specific periods/epochs, identification and naming of minerals/rock types not expected.  
Source: Plate Tectonics guidance, p. 1; DESE Instructional Guidelines, p. 9

**6.MS-ESS1-5**  
*Use graphical displays to illustrate that Earth and its solar system are one of many in the Milky Way galaxy, which is one of billions of galaxies in the universe.*  
Source: Earth in Space guidance, p. 1

**6.MS-ESS2-3**  
*Analyze and interpret maps showing the distribution of fossils and rocks, continental shapes, and seafloor structures to provide evidence that Earth's plates have moved great distances, collided, and spread apart.*  
Clarification: Maps may show rock/fossil type similarities on different continents, continental shapes including shelves, ocean structures such as ridges, fracture zones, trenches.  
Source: Plate Tectonics guidance, p. 1

---

#### PHYSICAL SCIENCE

**6.MS-PS2-4**  
*Use evidence to support the claim that gravitational forces between objects are attractive and are only noticeable when one or both of the objects have a very large mass.*  
Source: Earth in Space guidance, p. 1

**6.MS-PS4-1**  
*Use diagrams of a simple wave to explain that (a) a wave has a repeating pattern with a specific amplitude, frequency, and wavelength, and (b) the amplitude of a wave is related to the energy of the wave.*  
Assessment Boundary: Electromagnetic waves not expected in state assessment; limited to standard repeating waves.  
Source: DESE Instructional Guidelines, p. 23

**6.MS-PS4-2**  
*Use diagrams and other models to show that both light rays and mechanical waves are reflected, absorbed, or transmitted through various materials.*  
Clarification: Materials may include solids, liquids, gases. Mechanical waves (including sound) need a medium.  
Assessment Boundary: Limited to qualitative applications.  
Source: Earth in Space guidance, p. 1; DESE Instructional Guidelines, p. 23

**6.MS-PS4-3**  
*Present qualitative scientific and technical information to support the claim that digitized signals (sent as wave pulses representing 0s and 1s) can be used to encode and transmit information.*  
Assessment Boundary: Binary counting or specific device mechanisms not expected.  
Source: Forces at a Distance guidance, p. 1

**6.MS-PS1-6**  
*Plan and conduct an experiment involving exothermic and endothermic chemical reactions to measure and describe the release or absorption of thermal energy.*  
Clarification: Emphasis on describing transfer of energy to/from the environment. Examples: dissolving ammonium chloride or calcium chloride.  
Source: DESE Instructional Guidelines, p. 19

---

#### TECHNOLOGY/ENGINEERING

**6.MS-ETS1-1**  
*Define the criteria and constraints of a design problem with sufficient precision to ensure a successful solution.*  
Source: MA 2016 STE Framework, Grade 6 ETS1

**6.MS-ETS1-5(MA)**  
*Create and manipulate a 2-D scale drawing to communicate a design solution.*  
Source: MA 2016 STE Framework, Grade 6 ETS1 (MA-specific addition)

**6.MS-ETS1-6(MA)**  
*Communicate a design by producing a drawing that includes the measurements and labels needed to construct the design.*  
Source: MA 2016 STE Framework, Grade 6 ETS1 (MA-specific addition)

**6.MS-ETS2-1(MA)**  
*Analyze and compare properties of metals, plastics, wood, and ceramics, including flexibility, ductility, hardness, thermal conductivity, electrical conductivity, and melting point.*  
Source: Forces at a Distance guidance, p. 2

**6.MS-ETS2-2(MA)**  
*Given a design task, select appropriate materials based on specific properties needed in the construction of a solution.*  
Source: Forces at a Distance guidance, p. 2

**6.MS-ETS2-3(MA)**  
*Choose and safely use appropriate measuring tools, hand tools, fasteners, and common hand held power tools used to construct a prototype.*  
Source: Forces at a Distance guidance, p. 2

---

### Phase 2 & 3: Inventory and Master Alignment Matrix

| Standard | Coverage Status | Evidence (Files + Components) | Confidence |
|---|---|---|---|
| **6.MS-LS1-1** | **Fully Covered** | `lesson_what-is-life.html`: lesson + quiz + reflect questions; `lesson_cell-types.html`: lesson + quiz; `lesson_organelles.html`: lesson + quiz; `game_is-it-alive.html`: game; `game_cell-explorer.html`: game; `investigation_gray-zone.html`: CER investigation. All files display correct `6.MS-LS1-1` badge. Content directly addresses unicellular/multicellular evidence. | High |
| **6.MS-LS1-2** | **Fully Covered** | `lesson_organelles.html`: primary lesson; `lesson_cell-types.html`: supporting; `lesson_what-is-life.html`: partial; `game_cellular-showdown.html`: game; `game_cell-explorer.html`: game; `investigation_protein-pathway.html`: investigation; `extension_neuron-explorer.html`: extension (LS1-2 + LS1-3). All display `6.MS-LS1-2`. Content covers nucleus, chloroplasts, mitochondria, vacuoles, cell membrane, cell wall with functional descriptions. Assessment boundary (no ATP/active transport) appears to be observed. | High |
| **6.MS-LS1-3** | **Mostly Covered** | `lesson_body-systems.html`: primary lesson with quiz and `6.MS-LS1-3` badge; `body-system-interactions.html`: navigation hub linking to individual `system_*.html` pages; `body-system-diseases.html`: diseases extension; `game_relay.html`: game; `game_exercise.html`: game; `extension_neuron-explorer.html`: LS1-2 + LS1-3. Standard code `6.MS-LS1-3` displayed correctly. **Concern:** LS1-3 requires emphasis on *interactions between systems* (e.g., respiratory → circulatory → cellular respiration), not just individual system descriptions. `body-system-interactions.html` is a navigation hub to individual system maps (`system_circulatory.html`, etc.) rather than a page explicitly modeling cross-system interactions. The lesson_body-systems.html and body-system-interactions.html need to be read more deeply to confirm interaction emphasis is sufficient. | Medium |
| **6.MS-LS4-1** | **Partially Covered** | `extension_fossil-hunt.html`: game directly targeting fossil record as evidence for rock strata ages (displays `6.MS-ESS1-4`, slightly wrong code — content is about fossils as record of organisms, which is LS4-1, not ESS1-4); `lesson_biological-evolution.html`: fossil section present (whale timeline, transitional fossils) but is secondary to natural selection content; `lesson_layers-of-time.html`: touches on index fossils in geological context (ESS1-4 overlap). No dedicated Grade 6 lesson page for LS4-1. The fossil record content about *organisms, environments, extinctions, and changes to life forms* is distributed across pages but is never the primary focus of any single page. | Medium |
| **6.MS-LS4-2** | **Partially Covered** | `lesson_biological-evolution.html`: homologous/analogous/vestigial structures are explicitly taught as evidence for evolutionary relationships (card titled with homologous content, analogous structures section in quiz); `game_evolution-clicker.html`: Q&A includes "Similar anatomical structures can be evidence of evolutionary relationships" and questions about homologous vs. analogous structures. Content matching LS4-2 is present. **Critical gap:** Neither page displays `6.MS-LS4-2` as the standard code. The lesson uses NGSS `MS-LS4-2` which describes different content (statistics/probability of advantageous traits) — not the MA standard about anatomical structures. The correct MA standard is not labeled anywhere in the repo. | Medium |
| **6.MS-ESS1-1a** | **Fully Covered** | `lesson_eclipses.html`: full lesson + 10-Q quiz + Classroom Mode submission; `lesson_phases-of-the-moon.html`: full lesson + quiz + reflect questions; `lesson_sun-earth-moon.html`: full lesson + quiz + reflect questions; `simulation_eclipse-alignment.html`: full interactive simulation of orbital tilt/node conditions; `extension_moon-tonight.html`: real-world phase application. This is the deepest-covered standard in the entire repo. **Code corrected (June 2026):** All pages now display `6.MS-ESS1-1a` consistently. | High |
| **6.MS-ESS1-4** | **Mostly Covered** | `lesson_layers-of-time.html`: lesson on rock strata, superposition, relative dating; `game_layer-detective.html`: geologic sequencing game (uses superposition and crosscutting relationships); `simulation_floatlandia-fracture.html`: evidence-building scenario. Standard displayed as `6.ESS1-4` (dropping "MS"). Content covers superposition, crosscutting relationships, index fossils, relative dating. **Concern:** Assessment boundary specifies laws of superposition and crosscutting relationships limited to minor displacement faults; the lesson's treatment of this should be verified. Quiz questions are present but answer keys are undocumented. | High |
| **6.MS-ESS1-5** | **No Coverage** | No LyfeLabz page addresses graphical displays of Earth's solar system within the Milky Way galaxy, or compares the Milky Way to other galaxies. `wonderbox/dark-universe.html` discusses galaxies and dark matter at a level far beyond Grade 6 scope and is not a standards-aligned lesson. `lesson_sun-earth-moon.html` mentions the Sun but does not address the galactic context this standard requires. `lesson_eclipses.html` badge tooltip references "Earth and its solar system as part of the Milky Way" but the lesson content does not teach this. | High |
| **6.MS-ESS2-3** | **Mostly Covered** | `lesson_continental-drift.html`: lesson on plate tectonics, Wegener's evidence, continental shapes, fossil distribution; `simulation_floatlandia-fracture.html`: evidence-building simulation using fossil/rock/seafloor maps. Standard displayed as `6.ESS2-3` (dropping "MS"). Content covers the distribution of fossils and rocks, continental shapes, and seafloor structures as evidence for plate motion. **Code corrected (June 2026):** The invalid `6.ESS2-2` badge has been removed from `lesson_continental-drift.html` and `lesson_layers-of-time.html`. | High |
| **6.MS-PS2-4** | **Mostly Covered** | `simulation_gravity-wells.html`: full simulation with evidence-gathering questions about gravitational forces; displays correct `6.MS-PS2-4` badge with accurate description. **Code mislabeling in lesson pages:** `lesson_sun-earth-moon.html`, `lesson_phases-of-the-moon.html`, and `lesson_eclipses.html` all display `MS-ESS1-2` or `6.ESS1-2` for gravity/orbital content. Based on DESE documents, `8.MS-ESS1-2` is the Grade 8 standard for orbital motions. The Grade 6 standard for gravitational forces is `6.MS-PS2-4`, which is correctly applied only in the gravity wells simulation. The mislabeled pages teach relevant content about gravity but are claiming alignment to a Grade 8 standard. | High |
| **6.MS-PS4-1** | **Fully Covered** | `lesson_nature-of-waves.html`: full lesson covering amplitude, frequency, wavelength, wave diagrams, energy relationship; displays `6.MS-PS4-1`; 10-Q quiz + Classroom Mode submission. `investigation_amplitude-challenge.html`: structured CER investigation of amplitude-energy relationship with data collection, model-building, and student reasoning; displays `MS-PS4-1`. Assessment boundary (no electromagnetic waves) appears observed: the lesson notes that electromagnetic waves do not need a medium but does not go beyond this conceptual level. This is the most thoroughly developed Physical Science unit in the repo. | High |
| **6.MS-PS4-2** | **Minimal Coverage** | `investigation_amplitude-challenge.html`: displays `MS-PS4-2` badge with description but does not substantively teach reflection/absorption/transmission. The standard requires students to use diagrams and models to show that both light rays AND mechanical waves are reflected, absorbed, or transmitted through various materials, including a materials-based investigation. No such content exists. The `lesson_nature-of-waves.html` briefly distinguishes mechanical from electromagnetic waves but does not address material transmission/reflection/absorption behavior. | High |
| **6.MS-PS4-3** | **No Coverage** | No LyfeLabz page addresses digitized signals, 0s and 1s, encoding, or transmission of digital information. This standard is the sole Grade 6 standard in the Forces at a Distance unit. No page, simulation, game, or extension addresses it. | High |
| **6.MS-PS1-6** | **No Coverage** | No LyfeLabz page covers exothermic or endothermic chemical reactions. This is planned for the summer chemistry build. | High |
| **6.MS-ETS1-1** | **No Coverage** | No LyfeLabz page addresses engineering design criteria and constraints. Planned. | High |
| **6.MS-ETS1-5(MA)** | **No Coverage** | No LyfeLabz page addresses 2D scale drawing. Planned. | High |
| **6.MS-ETS1-6(MA)** | **No Coverage** | No LyfeLabz page addresses labeled construction drawings. Planned. | High |
| **6.MS-ETS2-1(MA)** | **No Coverage** | No LyfeLabz page addresses properties of metals, plastics, wood, or ceramics. Planned. | High |
| **6.MS-ETS2-2(MA)** | **No Coverage** | No LyfeLabz page addresses material selection for design tasks. Planned. | High |
| **6.MS-ETS2-3(MA)** | **No Coverage** | No LyfeLabz page addresses use of measuring tools, hand tools, or power tools for prototyping. Planned. | High |

---

## 4. Life Science Reassessment

**Question:** Do existing LyfeLabz pages covering cells, organelles, cell energy, body systems, fossils, and evolutionary relationships correctly align to Grade 6?

**Previous claim to reassess:** An earlier audit claimed these topics belong in Grade 7.

**Finding: That claim was WRONG. The Massachusetts 2016 STE Framework explicitly places all of the following in Grade 6:**

| Topic | MA Standard | Grade | DESE Source |
|---|---|---|---|
| Cells (unicellular/multicellular) | 6.MS-LS1-1 | **Grade 6** | Cells & Systems guidance |
| Cell organelles and functions | 6.MS-LS1-2 | **Grade 6** | Cells & Systems guidance |
| Body systems interaction | 6.MS-LS1-3 | **Grade 6** | Cells & Systems guidance |
| Fossil record evidence | 6.MS-LS4-1 | **Grade 6** (completed at Gr. 8) | Plate Tectonics guidance; Natural Selection guidance |
| Anatomical structures, evolutionary relationships | 6.MS-LS4-2 | **Grade 6** (completed at Gr. 8) | Natural Selection guidance |

**LyfeLabz life science content is correctly placed in Grade 6.** The lesson pages for `lesson_what-is-life.html`, `lesson_cell-types.html`, `lesson_organelles.html`, and `lesson_body-systems.html` align to the correct Grade 6 MA STE standards and use the correct standard codes.

**Open question: `6.MS-LS1-6` and `6.MS-LS1-7`**

`investigation_cell-energy.html` displays:
- `6.MS-LS1-6`: "Role of photosynthesis in cycling of matter and flow of energy"
- `6.MS-LS1-7`: "How food molecules are rearranged through chemical reactions to form new molecules"

These codes are not confirmed as Grade 6 in any of the six DESE documents reviewed for this audit. The Cells & Systems guidance (the authoritative Grade 6 life science document) lists only 6.MS-LS1-1, 6.MS-LS1-2, and 6.MS-LS1-3 as Grade 6 standards. The DESE Instructional Guidelines explicitly lists `8.MS-LS1-7` as a Grade 8 standard with description matching what LyfeLabz labels as `6.MS-LS1-7`.

**Assessment:** The standard labels `6.MS-LS1-6` and `6.MS-LS1-7` as used in `investigation_cell-energy.html` are **uncertain — possible misalignment.** The content may be better aligned to Grade 7 or Grade 8 standards. Verification against the full MA 2016 STE Framework PDF is needed before this investigation is labeled as Grade 6 coverage.

---

## 5. Evolution and Natural Selection Reassessment

**Question:** Which evolution-related LyfeLabz content is Grade 6 and which is Grade 8?

### Framework Determination (from official DESE documents)

| Content Type | MA Standard | Grade | Source |
|---|---|---|---|
| Fossil record evidence — organisms, environments, extinctions, changes to life | 6.MS-LS4-1 | **Grade 6** | Plate Tectonics guidance p. 1 |
| Anatomical structures supporting evolutionary relationships | 6.MS-LS4-2 | **Grade 6** | Natural Selection guidance p. 1 |
| Natural selection model — genetic variations, differential survival, reproduction over generations | 8.MS-LS4-4 | **Grade 8** | Natural Selection guidance p. 1 |

The Natural Selection & Common Ancestry guidance (Grade 8 document) states explicitly:
> "The standard [6.MS-LS4-1] is addressed to completion in the Natural Selection & Ancestry unit in 8th grade."

This means 6.MS-LS4-1 and 6.MS-LS4-2 are INTRODUCED in Grade 6 and COMPLETED in the Grade 8 unit. They are Grade 6 standards with an 8th grade completion context.

Natural selection itself (the mechanism by which genetic variations increase survival/reproduction over generations) = 8.MS-LS4-4 = **Grade 8 standard**.

### File-by-File Determination

| File | Primary Content | MA Alignment | Grade | Assessment |
|---|---|---|---|---|
| `lesson_biological-evolution.html` | Natural selection cycle, variation, heritability, adaptation, heritable traits, THEN fossil evidence and homologous structures | Primary content: 8.MS-LS4-4; Secondary: 6.MS-LS4-1 and 6.MS-LS4-2 | **Mixed (primarily Grade 8)** | The lesson leads with natural selection as the "engine of evolution" and teaches the full natural selection cycle. Fossil and anatomical evidence appear later as supporting content. Standard badges display NGSS `MS-LS4-4`, `MS-LS4-2`, and `MS-LS4-6` without grade prefixes. The NGSS `MS-LS4-2` in the badge ≠ MA `6.MS-LS4-2` — the NGSS code describes statistical/probability reasoning, not anatomical structures. Recommendation: relabel as Grade 8-anchored with Grade 6 entry points clearly identified. |
| `simulation_beetle-island.html` | Natural selection simulation — trait frequency changing over generations under selective pressure | 8.MS-LS4-4 | **Grade 8** | Displays `MS-LS4-4` and `MS-LS4-6`. Teaches population-level selection over generations. No fossil evidence or anatomical structures. Entirely Grade 8 content. |
| `game_evolution-clicker.html` | Natural selection clicker game with embedded quiz about natural selection, heritable traits, analogous structures, DNA evidence | Primary: 8.MS-LS4-4; includes 6.MS-LS4-2 content (anatomical structures Q&A) | **Mixed (primarily Grade 8)** | No standard badges found. Game mechanics model natural selection (Grade 8). Quiz includes Q on homologous structures (Grade 6 LS4-2) and DNA evidence. Mixed grade content without labeling. |
| `extension_chernobyl-frogs.html` | Natural selection in action — dark skin evolving in radiation zones | 8.MS-LS4-4 | **Grade 8** | Displays `MS-LS4-4` and `MS-LS4-6`. Content is about natural selection occurring over decades. Grade 8 standard. |
| `extension_fossil-hunt.html` | Fossil index game — matching fossils to rock strata to determine relative ages | 6.MS-ESS1-4 (labeled); fossil-as-organisms content also touches 6.MS-LS4-1 | **Grade 6** | Primarily about rock layer relative dating (ESS1-4). Uses index fossils as evidence. Correctly Grade 6. The badge displays `6.MS-ESS1-4` rather than `6.MS-LS4-1` — the content spans both but the primary instruction is about relative dating, so ESS1-4 is the better label. |
| `blog/teach-natural-selection-6th-grade.html` | Blog post presenting natural selection pedagogy for "6th grade" | References `MS-LS4-4` and `MS-LS4-6` as the standards being addressed | **Grade 8 content labeled Grade 6** | The blog post is written by the developer describing how they teach natural selection to 6th graders. However, per the MA framework, 8.MS-LS4-4 (natural selection) is assessed at Grade 8. The blog describes Grade 8 content. This creates a public-facing misalignment claim. |

### Summary Conclusion on Evolution Content

**Grade 6 content (correctly placed):**
- Fossil record as evidence for organisms, environments, extinctions (6.MS-LS4-1): present in `extension_fossil-hunt.html`, partially in `lesson_biological-evolution.html`
- Anatomical structures supporting evolutionary relationships (6.MS-LS4-2): present but unlabeled in `lesson_biological-evolution.html` and `game_evolution-clicker.html`

**Grade 8 content currently labeled as or presented as Grade 6:**
- Natural selection mechanism (8.MS-LS4-4): primary focus of `simulation_beetle-island.html`, `extension_chernobyl-frogs.html`, `blog/teach-natural-selection-6th-grade.html`; primary topic of `lesson_biological-evolution.html`

**NGSS codes not in the MA 2016 framework at any grade:**
- `MS-LS4-6` (mathematical representations of natural selection): was present in `simulation_beetle-island.html`, `extension_chernobyl-frogs.html`, `lesson_biological-evolution.html`, and the blog. **Removed June 2026** — not a confirmed Massachusetts STE standard at any grade level.

---

## 6. Confirmed Misalignments

The following are findings where LyfeLabz content uses wrong standard codes or labels non-Grade-6 content as Grade 6. Only findings traceable to both a specific file and specific DESE document are included.

| # | File(s) | Displayed Code | Correct MA Code | Issue | Evidence |
|---|---|---|---|---|---|
| M1 | `lesson_sun-earth-moon.html`, `lesson_phases-of-the-moon.html`, `lesson_eclipses.html` | `MS-ESS1-2` or `6.ESS1-2` | 8.MS-ESS1-2 (Grade 8) | Gravity/orbital motions content labeled as a Grade 6 ESS1 standard. The correct Grade 6 standard for gravitational forces is `6.MS-PS2-4`. The gravity/orbital standard `8.MS-ESS1-2` is Grade 8. | Earth in Space guidance (p.1): 6.MS-PS2-4 is the Grade 6 gravity standard. DESE Instructional Guidelines (p.10): 8.MS-ESS1-2 is Grade 8. |
| M2 | `lesson_biological-evolution.html`, `simulation_beetle-island.html`, `extension_chernobyl-frogs.html` | `MS-LS4-4` | 8.MS-LS4-4 (Grade 8) | Natural selection mechanism content displayed without grade prefix, presented as Grade 6 curriculum. | Natural Selection guidance (p.1): "8th Grade Standards in Natural Selection & Common Ancestry: 8.MS-LS4-4." |
| M3 | `lesson_biological-evolution.html` | `MS-LS4-2` (NGSS code) | `6.MS-LS4-2` (MA code, different content) | The NGSS `MS-LS4-2` describes "apply concepts of statistics and probability to support explanations that organisms with an advantageous heritable trait tend to increase in proportion." The MA `6.MS-LS4-2` describes "construct an argument using anatomical structures to support evolutionary relationships." These are different standards with different content. The badge description in LyfeLabz matches the NGSS interpretation, not the MA standard. | Natural Selection guidance (p.1): MA 6.MS-LS4-2 = anatomical structures for evolutionary relationships. |
| M4 | `simulation_beetle-island.html`, `extension_chernobyl-frogs.html`, `lesson_biological-evolution.html`, blog | `MS-LS4-6` | No MA standard | `MS-LS4-6` is an NGSS code not in the MA 2016 STE Framework at any grade level. **Corrected June 2026:** Badge removed from all four locations. | Not found in any reviewed DESE document. |
| M5 | `investigation_cell-energy.html` | `6.MS-LS1-6`, `6.MS-LS1-7` | `6.MS-LS1-2` (photosynthesis/cell energy); `8.MS-LS1-7` (food molecules, chemical reactions) | The Cells & Systems guidance lists only LS1-1, LS1-2, and LS1-3 as Grade 6 standards. `8.MS-LS1-7` (food molecules, chemical reactions, energy) is confirmed Grade 8. **Corrected June 2026:** `6.MS-LS1-6` replaced with `6.MS-LS1-2`; `6.MS-LS1-7` replaced with `8.MS-LS1-7` (labeled as above-grade enrichment). | Cells & Systems guidance (p.1): only LS1-1, LS1-2, LS1-3 as Grade 6. DESE Instructional Guidelines (p.14): 8.MS-LS1-7 is Grade 8. |
| M6 | `blog/teach-natural-selection-6th-grade.html` | `MS-LS4-4`, `MS-LS4-6` (labeled Grade 6) | 8.MS-LS4-4 (Grade 8) | Public-facing blog post presents natural selection as Grade 6 Massachusetts content. The MA framework places natural selection (8.MS-LS4-4) at Grade 8. **Corrected June 2026:** Blog now references `8.MS-LS4-4`; `MS-LS4-6` removed from header, body, and sidebar. | Natural Selection guidance (p.1): 8.MS-LS4-4 = Grade 8 standard. |
| M7 | `lesson_layers-of-time.html`, `lesson_continental-drift.html` | `6.ESS2-2` | No valid Grade 6 replacement — code removed | These pages displayed `6.ESS2-2` for content described as "Earth Materials and Systems, rock types and the processes that form them." No `6.MS-ESS2-2` appears in any reviewed DESE document. For `lesson_continental-drift.html`, `6.ESS2-3` already covers the Wegener/fossil/continental-shapes content. **Corrected June 2026:** `6.ESS2-2` badge and panel row removed from both pages. | Plate Tectonics guidance (p.1): 6.MS-ESS2-3 is the confirmed Grade 6 ESS2 standard. `6.MS-ESS2-2` not found. |

---

## 7. Missing Standards

Standards with **No Coverage** in the current repo:

| Standard | Description | Status | Note |
|---|---|---|---|
| **6.MS-ESS1-5** | Graphical displays: Earth in Milky Way, one of billions of galaxies | No Coverage | No lesson, simulation, or investigation exists. `wonderbox/dark-universe.html` is far too advanced and not a Grade 6 lesson. |
| **6.MS-PS4-3** | Digitized signals (0s and 1s) encode and transmit information | No Coverage | No page exists. This is the primary standard in the Forces at a Distance unit. |
| **6.MS-PS1-6** | Exothermic/endothermic chemical reaction experiment | No Coverage | Planned for summer chemistry build. |
| **6.MS-ETS1-1** | Define design criteria and constraints | No Coverage | Planned. |
| **6.MS-ETS1-5(MA)** | Create a 2D scale drawing | No Coverage | Planned. |
| **6.MS-ETS1-6(MA)** | Labeled construction drawing | No Coverage | Planned. |
| **6.MS-ETS2-1(MA)** | Properties of metals, plastics, wood, ceramics | No Coverage | Planned. |
| **6.MS-ETS2-2(MA)** | Select materials based on design criteria | No Coverage | Planned. |
| **6.MS-ETS2-3(MA)** | Use measuring/hand tools to construct prototype | No Coverage | Planned. |

---

## 8. Partially Covered Standards

Standards where content exists but is incomplete relative to the standard's full scope:

**6.MS-LS1-3** — Body systems INTERACTION  
Content about individual body systems is abundant. The standard's specific emphasis is on systems *interacting* (e.g., respiratory delivers oxygen → circulatory transports it → cells use it for respiration). `body-system-interactions.html` functions as a navigation hub to individual system maps rather than a dedicated interactions lesson. The cross-system interaction modeling required by the standard (and specified in the DESE clarification statement examples) needs verification that it is explicitly taught, not just implied.

**6.MS-LS4-1** — Fossil record evidence  
Fossil content is present across multiple pages but is always secondary to another primary topic: natural selection in `lesson_biological-evolution.html`, rock dating in `lesson_layers-of-time.html` and `extension_fossil-hunt.html`. No page has fossil record organisms/environments/extinctions/changes as its primary focus. The standard's scope includes describing how organisms and their environments have changed throughout Earth's history — this is not covered in a dedicated, organized way.

**6.MS-LS4-2** — Anatomical structures for evolutionary relationships  
Homologous and analogous structures are explicitly taught in `lesson_biological-evolution.html` (expandable card) and tested in `game_evolution-clicker.html`. The content is present and accurate. However, it is never labeled with the correct MA standard code `6.MS-LS4-2`. All related pages use NGSS codes or no codes at all for this content.

**6.MS-PS4-2** — Waves reflected, absorbed, transmitted  
A badge appears on `investigation_amplitude-challenge.html` but the investigation does not address this standard. The waves lesson covers mechanical vs. electromagnetic wave transmission conceptually but does not use diagrams or models to demonstrate reflection, absorption, or transmission through specific materials as the standard requires.

**6.MS-PS2-4** — Gravitational forces  
The content is taught well in `simulation_gravity-wells.html` with the correct standard code. However, the lesson pages that also teach gravitational content (`lesson_sun-earth-moon.html`, `lesson_phases-of-the-moon.html`, `lesson_eclipses.html`) label it as `MS-ESS1-2` (Grade 8) rather than `6.MS-PS2-4` (Grade 6). The content itself is appropriate; the labeling is wrong.

---

## 9. Strongest Standards Coverage Areas

These represent areas where LyfeLabz's coverage is traceable, substantive, and uses appropriate instructional resources:

**1. 6.MS-ESS1-1a (Earth-Sun-Moon: lunar phases and eclipses)**  
Five distinct resources: three lesson pages, one full simulation, one real-world extension. Interactive SVG models, 10-question quizzes with Classroom Mode submission, driving question hooks, and vocabulary scaffolding. This is the deepest-covered standard in the repo by both quantity and apparent quality of instruction.  
Evidence: `lesson_eclipses.html`, `lesson_phases-of-the-moon.html`, `lesson_sun-earth-moon.html`, `simulation_eclipse-alignment.html`, `extension_moon-tonight.html`

**2. 6.MS-PS4-1 (Wave patterns, amplitude, frequency, wavelength)**  
One very large lesson page (5,349 lines) and one full CER investigation. The investigation (`investigation_amplitude-challenge.html`) structures predict-test-analyze cycles and requires students to choose between linear and squared mathematical models based on their own data. Assessment boundary (no electromagnetic waves) appears to be observed.  
Evidence: `lesson_nature-of-waves.html`, `investigation_amplitude-challenge.html`

**3. 6.MS-LS1-1 (All organisms are made of cells)**  
Six resources across multiple resource types: two lessons, two games, one investigation, with a dedicated CER activity (`investigation_gray-zone.html`) that asks students to argue whether edge cases (viruses, prions, fire) qualify as living. Correct standard code `6.MS-LS1-1` used consistently.  
Evidence: `lesson_what-is-life.html`, `lesson_cell-types.html`, `lesson_organelles.html`, `game_is-it-alive.html`, `game_cell-explorer.html`, `investigation_gray-zone.html`

**4. 6.MS-LS1-2 (Cell organelles and cellular functions)**  
Multiple resources including lesson pages that cover all organelles specified in the clarification statement (nucleus, chloroplasts, mitochondria, vacuoles, cell membrane, cell wall) with function descriptions. Correct standard code used.  
Evidence: `lesson_organelles.html`, `lesson_cell-types.html`, `game_cellular-showdown.html`, `investigation_protein-pathway.html`

**5. 6.MS-ESS1-4 (Rock layers and index fossils)**  
Lesson page, game directly targeting superposition and crosscutting relationships, and evidence-building simulation. Standard is applied to relative dating tasks.  
Evidence: `lesson_layers-of-time.html`, `game_layer-detective.html`, `simulation_floatlandia-fracture.html`

---

## 10. Top 10 Standards Priorities

Ranked by combination of: how many students are affected, how close to correct the content already is, and how achievable the fix is.

1. **Fix the `MS-ESS1-2` label on astronomy lesson pages** (M1).  
`lesson_sun-earth-moon.html`, `lesson_phases-of-the-moon.html`, `lesson_eclipses.html` all display gravity/orbital content under `MS-ESS1-2` (Grade 8). Change to `6.MS-PS2-4` and adjust descriptions. The content is appropriate; only the label is wrong. Low effort, high accuracy gain. Affects 3 lesson pages and 1 simulation.

2. **Label 6.MS-LS4-2 correctly on evolution and game pages**.  
Homologous/anatomical structures content already exists in `lesson_biological-evolution.html` and `game_evolution-clicker.html`. Add the correct MA code `6.MS-LS4-2` badge with the correct description ("Construct an argument using anatomical structures to support evolutionary relationships among and between fossil organisms and modern organisms"). Low effort, removes a genuine gap.

3. **Build a dedicated 6.MS-PS4-2 lesson or simulation**.  
Reflection, absorption, and transmission of both light rays and mechanical waves through materials. Currently only a badge with no instruction. A single focused investigation (comparing light through different materials, sound through different media) would bring this from Minimal to Mostly Covered. Medium effort.

4. **Build a 6.MS-PS4-3 page** (digitized signals, 0s and 1s).  
This is the sole standard in the Forces at a Distance unit and is entirely unaddressed. No existing content can be repurposed. This is a new content build. Medium effort.

5. **Build a 6.MS-ESS1-5 page** (Earth in the Milky Way galaxy).  
Use graphical displays to show Earth's solar system is one of many. This is a focused, visually-driven standard well-suited to the LyfeLabz interactive SVG approach. Medium effort.

6. **Clarify grade-level labeling on all evolution content**.  
Add clear labeling: fossil record content (6.MS-LS4-1, LS4-2) = Grade 6; natural selection mechanism (8.MS-LS4-4) = Grade 8. This does not require removing any content — only labeling it accurately. Update `lesson_biological-evolution.html`, `simulation_beetle-island.html`, `extension_chernobyl-frogs.html`, and the blog post.

7. ~~**Remove or correct `MS-LS4-6` badges**.~~ **COMPLETED June 2026.**  
`MS-LS4-6` removed from `simulation_beetle-island.html`, `extension_chernobyl-frogs.html`, `lesson_biological-evolution.html`, and `blog/teach-natural-selection-6th-grade.html`.

8. ~~**Verify and relabel `6.MS-LS1-6` and `6.MS-LS1-7` in `investigation_cell-energy.html`**.~~ **COMPLETED June 2026.**  
`6.MS-LS1-6` → `6.MS-LS1-2`; `6.MS-LS1-7` → `8.MS-LS1-7` (labeled as above-grade enrichment). Disease pages updated in parallel.

9. **Build 6.MS-PS1-6 chemistry content** (exothermic/endothermic reactions).  
Planned for summer. This is an investigation-first standard well-suited to LyfeLabz's investigation format. Medium-to-high effort.

10. **Build 6.MS-ETS1-1, ETS1-5(MA), ETS1-6(MA), and ETS2-1/2/3 technology/engineering content**.  
All six engineering standards are unaddressed. The MA 2016 framework requires ETS1 (design process, scale drawing) and ETS2 (materials, tools). The Forces at a Distance guidance suggests these can be integrated with a speaker-design extension activity. Medium-to-high effort.

---

## 11. Corrected Overall Coverage Percentage

**Grade 6 MA STE confirmed standards: 20**

| Coverage Level | Count | Standards |
|---|---|---|
| Fully Covered | 4 | 6.MS-LS1-1, 6.MS-LS1-2, 6.MS-ESS1-1a, 6.MS-PS4-1 |
| Mostly Covered | 4 | 6.MS-LS1-3, 6.MS-ESS1-4, 6.MS-ESS2-3, 6.MS-PS2-4 |
| Partially Covered | 3 | 6.MS-LS4-1, 6.MS-LS4-2, 6.MS-PS4-2 |
| No Coverage | 9 | 6.MS-ESS1-5, 6.MS-PS4-3, 6.MS-PS1-6, 6.MS-ETS1-1, 6.MS-ETS1-5(MA), 6.MS-ETS1-6(MA), 6.MS-ETS2-1(MA), 6.MS-ETS2-2(MA), 6.MS-ETS2-3(MA) |

**Some coverage (full + mostly + partial): 11 of 20 = 55%**  
**No coverage: 9 of 20 = 45%**  
**Full or mostly covered: 8 of 20 = 40%**

Note: The corrected count is higher than earlier estimates because the Life Science standards (LS1-1, LS1-2, LS1-3) were previously misidentified as non-Grade-6 content.

---

*Audit prepared June 2026. All standards determinations are traceable to official DESE unit guidance documents listed at the top of this report. When a standard or grade placement could not be confirmed from those documents, it is explicitly labeled "uncertain." No conclusions were inferred from NGSS alone or from prior audit documents.*

**Sources:**
- [MA DESE STE Instructional Guidelines 6–8 (Aug 2023)](https://www.doe.mass.edu/stem/ste/g6-g8.pdf)
- [OpenSciEd MA: Cells & Systems](https://www.doe.mass.edu/stem/ste/g6-cells-systems.pdf)
- [OpenSciEd MA: Earth in Space](https://www.doe.mass.edu/stem/ste/g6-earth-in-space.pdf)
- [OpenSciEd MA: Forces at a Distance](https://www.doe.mass.edu/stem/ste/g6-forces-at-a-distance.pdf)
- [OpenSciEd MA: Plate Tectonics & Rock Cycling](https://www.doe.mass.edu/stem/ste/g6-plate-tectonics.pdf)
- [OpenSciEd MA: Natural Selection & Common Ancestry](https://www.doe.mass.edu/stem/ste/g8-natural-selection-common-ancestry.pdf)
