# Differentiation Content Preservation - Earth's Layers (`reading-adapted`)

Human content gate for the Earth's Layers `reading-adapted` presentation.
It complements the automated structural gates in
`app/scripts/lessonBuilder/variantSource.cjs` and `variantInvariance.cjs`,
which prove that nothing outside the adaptable prose changed. This record
covers what the automated gates cannot prove: that the adapted prose still
teaches the same science.

One record per lesson variant. Future variants get their own
`DIFFERENTIATION_CONTENT_PRESERVATION_<LESSON>.md`.

- Canonical source: `lesson-sources/lesson_earths-layers.html`
- Variant source: `lesson-sources/variants/earths-layers.reading-adapted.html`
- Variant config: `app/scripts/lessonBuilder/lessons/earths-layers.cjs` (`variants["reading-adapted"]`)
- Assessment: `earths-layers.r1.json` (unchanged; the variant quiz must stay faithful to it)
- Status: contract finalized and owner-approved (2026-09-26). The first
  authored revision was reviewed against it (see "Review of the authored
  revision" below).
  **Current-state note (2026-10-01):** the Quiz Results Polish rollout minted
  successor presentations that are now the production coverage: r1
  `pr7718b6fb29e40df7a338ea6896071229f232b884e9301f01c223181051071667` and r2
  `pr8996a455b762c209c8a74c20954521cd93313df920923292aa334161560f6e11` (existing
  AP bindings). Earlier presentations (`pr90f…`, `pr6b7c…`) are retained,
  immutable, and superseded as current coverage. See
  `RELEASE_2026-10-01_PRODUCTION_APP_CATCHUP.md`.

---

## 1. Adaptable scope

- Sections: `engage`, `explore`, `layers`, `crust`, `mantle-zone`, `core`,
  `explain`.
- Adaptable selectors: `p`, `.callout-body`, `.bridge-callout`.
- Locked selectors: `.edu-note`, `.qr-card`, `.crust-grid`, `.wrapup-chips`.
- 26 adaptable prose runs (R1-R26). The Explain `.bridge-callout` (formerly
  R27) contains the locked `.wrapup-chips` and is therefore locked in full,
  including its closing sentence.
- Always invariant: quiz, Brain Check, Show Your Thinking, vocabulary cards,
  learning goals, standards, diagrams and captions, the layer explorer (its
  text lives in a script), wrap-up beats, card titles, KEY IDEA labels,
  teacher notes, scripts, styles and ids.

## 2. Rules for every run

1. Same science: every MUST PRESERVE item survives with its meaning intact.
2. Required vocabulary stays verbatim: Density, Differentiation, Crust,
   Mantle, Core, Lithosphere, Asthenosphere, Convection Current, Oceanic
   Crust, Continental Crust, plus the run-level terms below. A brief nearby
   plain-language clarification is allowed (owner decision).
3. Numbers and units unchanged. Layer thicknesses stay in miles; R2 and R26
   stay in kilometers (owner decision).
4. Analogies anchored by locked text stay: apple skin (R13, card title "Thin
   as an Apple's Skin"), toothpaste (R18, card title "Rock That Flows Like
   Toothpaste"), steel marble (R7).
5. No added facts, no assessment hints, no disclosure of adaptation.
6. Readability targets are guidelines (owner decision): about 12 words per
   sentence on average and generally no sentence over 20 words. Accuracy,
   natural language and coherence take priority.

## 3. Run-by-run contract

| Run | Locator | MUST PRESERVE | Warnings / DO NOT ADD | Vocabulary |
|---|---|---|---|---|
| R1 | Engage intro "Earthquakes and volcanoes happen at the surface" | Earthquakes and volcanoes occur at the surface; their causes begin deep inside; those layers have never been reached by people. | | earthquakes, volcanoes, layers |
| R2 | Phenomenon card "The ground feels solid and still" | Ground seems solid yet some places have earthquakes and others erupt molten rock through volcanoes; deepest drilled hole reaches only a tiny fraction of the way down; the driving question with "thousands of kilometers". | No drill-hole names or depths; do not answer the question. | molten rock |
| R3 | Prediction reveal "The best answer is B" | Answer is B (locked option letters); Earth is layered, not one solid ball; deepest layers extremely hot; heat keeps rock slowly moving; flowing deep rock drags the surface, builds pressure, feeds volcanoes; we must look inside. | C9: rock "moving" must not become melted or liquid. | layers |
| R4 | "Where we're headed" | Roadmap order: how layers formed, surface to center, connect back to the shaking ground. | | |
| R5 | Explore intro "Earth did not start out with neat layers" | Layers were not original; formed billions of years ago; young planet was molten rock and metal. | | molten |
| R6 | "Early in its history" (2 paragraphs) | Formed from dust and rock left over after the Sun formed; collisions released heat that melted much (not all) of the planet; molten materials could move; heavy sink, light rise; this set up sorting into layers. | No radioactive decay, Moon impact, ages or temperatures. | molten |
| R7 | KEY IDEA Density | Definition: mass packed into a given space; condition "when materials can move freely"; denser sinks below less dense; steel marble in water example. | No formula, units or second example. Feeds quiz Q3. | Density |
| R8 | KEY IDEA Differentiation | Density caused the molten Earth to separate into layers; process named differentiation; iron and nickel sank to the center and formed the core; lighter materials rose and formed the mantle and crust; as Earth cooled the layers **settled into** today's structure. | Do not reintroduce "solidified" (C2 resolved). Feeds quiz Q2. | differentiation, iron, nickel, core, mantle, crust, molten |
| R9 | "The key pattern" | Density decides the order; densest ended up deepest; one rule explains the arrangement, heavy metal core to light brittle crust. | | density, core, crust, brittle |
| R10 | Layers intro | Four main layers (quiz Q1); from the surface down, each is deeper, hotter and more dense than the one above; direction to choose a layer in the interactive. | | |
| R11 | "A clear trend" | Density, temperature and pressure all increase from crust to inner core; deeper means heavier, hotter, more squeezed. | Keep all three properties; R24 depends on pressure. | density, temperature, pressure, crust, inner core |
| R12 | Crust intro | Most studied and best understood layer; because we can reach it; earthquakes and volcanoes break through there. | | crust |
| R13 | "The crust is like the skin of an apple" (2 paragraphs) | Apple-skin analogy; very thin compared with the other three layers, about 4 to 25 miles; least dense; made mostly of **solid rock** that is brittle (breaks easily); not one solid shell; **together with the very top of the mantle** it is broken into large pieces called plates; plates **ride on a softer part of the mantle below** and slowly move. | C3 and C4 resolved: no soil claim; plates are not "crust resting on the soft mantle". No plate names, counts or boundary types. Quiz Q4. | crust, least dense, brittle, plates, mantle |
| R14 | "How earthquakes start" | Sequence: plates usually slide smoothly; sometimes stuck; pressure builds; release travels out as energy; energy shakes the crust; shaking is an earthquake. | C5 preserved: keep "pressure" (quiz Q9 wording). No faults, stress/strain, wave types, magnitude. | plates, pressure, energy, earthquake |
| R15 | "Not all crust is the same" | Oceanic crust differs from continental crust. | Facts live in the locked crust-grid. | |
| R16 | "Remember the density rule?" | Density rule still applies; oceanic crust more dense than continental; where they meet, heavier oceanic crust **tends to** sink beneath lighter continental crust. | Keep the hedge. Do not add "subduction", trenches or mountain building. | oceanic crust, continental crust, dense |
| R17 | Mantle intro | Largest layer; key to the mystery; **solid rock that slowly flows**; that flow moves the surface. | Highest misconception risk: never liquid, melted or magma. | mantle |
| R18 | "The mantle is made of hot, dense rock" (2 paragraphs) | Hot, dense rock about 1,800 miles thick; temperature differences make it flow slowly; toothpaste analogy; heat and pressure make rock move and bend; the movement of the mantle creates the movement of Earth's plates (quiz Q6). | | mantle, dense, temperature, pressure, plates |
| R19 | KEY IDEA Lithosphere | Solid outer section; includes crust **and upper mantle**; rigid; it is what is broken into plates. | Never reduce to "the lithosphere is the crust". | lithosphere, crust, upper mantle, plates |
| R20 | KEY IDEA Asthenosphere | Just below the lithosphere; the upper-mantle region that flows; that flowing, bendable quality is plastic behavior; responsible for convection currents (quiz Q7, Brain Check 2). | C6 preserved as the approved middle-school framing. Keep "plastic behavior". | asthenosphere, lithosphere, upper mantle, plastic behavior, convection currents |
| R21 | KEY IDEA Convection current | Looping flow caused by heat; hot rock near the bottom is less dense and rises; near the top it cools, becomes more dense, sinks; the loop repeats and drags the plates; continents and seafloor slowly move. | Keep density as the reason for rising and sinking. Quiz Q8, Q10. | convection current, density, plates |
| R22 | Core intro | Core is the densest and hottest region; two parts: liquid outer core, solid inner core. | | core, outer core, inner core |
| R23 | "The outer core is the only liquid layer" (2 paragraphs) | Only liquid layer; about 1,400 miles; liquid iron and nickel; known to be liquid from earthquakes and seismic waves; flowing liquid metal creates the magnetic field, **an invisible field around our planet** that makes a compass needle point north. | C7 resolved: not a "force". No shadow zones or dynamo detail. | outer core, iron, nickel, seismic waves, magnetic field |
| R24 | "The inner core is the center layer" (2 paragraphs) | Center layer; about 780 miles; **a dense, solid ball of iron and nickel metal**; hotter than the liquid outer core yet solid; the reason is pressure from the weight of every layer above. | C8 resolved. Keep the question-then-answer (pressure vs temperature misconception). | inner core, iron, nickel, pressure |
| R25 | "The pattern holds all the way down" | Density, temperature and pressure increase from crust to inner core; center is heaviest, hottest, most squeezed. | Consistent with R11. | |
| R26 | Explain intro | Callback to the opening question with "thousands of kilometers"; students can now trace the chain step by step. | | |

## 4. Cross-section coherence

1. Density thread (R6, R7, R8, R9, R10, R11, R16, R21, R25): every mention
   stays consistent with the R7 definition.
2. Causal chain (R3, R14, R17, R18, R20, R21, locked wrap-up): heat, density
   differences, convection, plate motion, earthquakes and volcanoes. No link
   skipped or added.
3. Crust, plates, lithosphere (R13, R19, R20): plates are the crust plus the
   very top of the mantle, riding on a softer layer below.
4. The four-way trend (R10, R11, R22, R25) is consistent; pressure explains
   the solid inner core (R24).
5. States: crust brittle solid; mantle solid that flows; outer core the only
   liquid; inner core solid under pressure.
6. The locked layer-explorer text agrees with the prose (4 to 25, 1,800,
   1,400 and 780 miles).

## 5. Canonical issue register

| ID | Issue | Resolution |
|---|---|---|
| C2 | Layers "solidified" | Resolved in canonical: "settled into". |
| C3 | Crust "rock and soil" | Resolved in canonical: "solid rock" (prose and layer explorer). |
| C4 | Plates "rest on the soft mantle" | Resolved in canonical: crust with the very top of the mantle forms plates that ride on a softer part of the mantle (prose and layer explorer). |
| C5 | Earthquake "pressure builds" | Preserved: approved middle-school framing, bound to quiz Q9 and `r1`. |
| C6 | Asthenosphere "responsible for convection currents" | Preserved: approved middle-school framing, bound to quiz Q7 and `r1`. |
| C7 | Magnetic field "invisible force" | Resolved in canonical: "an invisible field around our planet". |
| C8 | "iron crystals made of iron and nickel" | Resolved in canonical: "a dense, solid ball of iron and nickel metal" (prose and layer explorer). |
| C9 | R3 "rock slowly moving" | Adaptation warning only. |

## 6. Review of the authored revision

Reviewed 2026-09-26 against sections 2-4 for the first authored revision
(retained in `app/lessons/variants/manifest.json`).

- All 26 runs: every MUST PRESERVE item is present with unchanged meaning;
  all required vocabulary is verbatim; numbers and units unchanged; the three
  anchored analogies are present; no facts added; no disclosure language.
- R15 is unchanged (already two short sentences).
- Plain-language clarifications added beside required terms: "molten rock,
  which means rock that has melted" (R2), "rigid, meaning it is stiff" (R19),
  "Plastic behavior means the solid rock can bend and slowly flow" (R20),
  "Seismic waves are waves of energy from earthquakes" (R23). Each restates
  meaning the canonical lesson already teaches; the scientific term stays
  primary.
- R7 keeps the single steel-marble example, stated as "For example, a dense
  steel marble sinks in water."
- Owner side-by-side review completed; final refinements to R2, R7 and R23
  applied before the revision was retained.
- Automated gates: structural invariance, zero-exclusion equivalence
  contract, quiz identity and `r1` fidelity, disclosure scan, deterministic
  double build, relocation post-condition.
- Adaptable prose, canonical vs adapted: 1,084 vs 1,165 words; 13.4 vs 9.9
  words per sentence on average; 6 vs 1 sentences over 20 words (the
  remaining one is R25, long only because it includes the callout's bold
  label).
- Retained revision:
  `prff01d9d2cf71210c491afc60cf98cd3d69b91d5c64cae51aff2463b50892375c`.
