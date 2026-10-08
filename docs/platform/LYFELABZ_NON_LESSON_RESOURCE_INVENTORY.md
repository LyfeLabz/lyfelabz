# LyfeLabz Non-Lesson Resource Inventory

**Status:** Canonical inventory of existing non-lesson resources, with proposed
future requirements. Documentation only; nothing here is implemented.
**Established:** October 8, 2026, verified against repository HEAD `e20df02`.
**Companion:** `LYFELABZ_NON_LESSON_ASSESSMENT_EVIDENCE_STANDARD.md` (the
standard every future requirement below applies).

Every per-resource row separates three things:

- **CURRENT:** what the repository source does today (verified).
- **REQUIRED (future):** proposed required work and evidence under the
  standard. These are recommendations for owner and content review, not
  current behavior and not authorized work.
- **OPTIONAL (future):** proposed optional enrichment, which never gates the
  quiz.

### Evidence basis

The October 8 reconnaissance report was not available in this session. Every
current-behavior claim below was **independently re-verified** from the
repository: the curriculum registry
(`app/src/curriculum/curriculum.registry.json`), the resource-type policy
(`app/src/curriculum/curriculum.resource-types.json`), both Hosting publish
manifests, and a read of every formal resource page (line-level reads of all
23 formal-type HTML files). Source behavior is not production verification:
no deployed page, Apps Script endpoint, or teacher spreadsheet was observed.

Labels: **[Verified]** = read in source. **[Inference]** = judgment from
source. **[Proposed]** = future requirement.

---

## 1. Executive summary

- **13 registered formal resources** [Verified]: 4 investigations, 3
  simulations, 5 extensions, 1 challenge. Registry type totals match exactly.
- **5 unregistered formal-type resources** [Verified]: Population Patterns,
  Beetle Island, Neuron Explorer, Are Viruses Alive?, and the Ball Run series
  (one resource: a hub page plus five day pages, six files).
- **43 informal and supporting instructional pages** when counted as 18
  formal + 7 games + 8 body-system maps + 8 disease explorations + 2
  body-system hub pages. Counting the Lab Report Assistant tool as well gives
  44. The earlier figure of 43 matches the first count. The original report's
  exact counting rule could not be confirmed (§4).
- **No non-lesson resource produces an authenticated platform assessment
  attempt** [Verified]. None calls Firebase or a platform callable. Every
  formal page except the six Ball Run pages loads
  `/assets/lyfelabz-assessment-runtime.js`, but none invokes it.
- **Legacy Google Apps Script submission is the norm** [Verified]: 15 formal
  pages post to the centralized v1 endpoint, the 5 Ball Run day pages post
  to a separate report endpoint, and 3 pages submit nothing (Medical
  Mysteries, Moon Tonight, Ball Run hub).
- **Quiz lengths vary widely** [Verified]: 0, 3, 5, 8, 10, 15, and a
  random 8 drawn from 10. Five registered resources already have exactly 5
  items (Amplitude Challenge, Cell Energy, Gravity Wells, Eclipse Alignment,
  Floatlandia Fracture), and all 5 still need review before reuse.
- **Every scored page embeds its answer key and scores in the browser**
  [Verified]. Identity is typed by the student.
- **Student work is mostly local or lost** [Verified]: most pages keep
  progress only in memory; a few use `sessionStorage` or `localStorage`.
  Nothing reaches Teacher Workspace.
- **Physical work** [Verified]: Build-a-Boat/Floatia and Ball Run require
  physical building and testing; Moon Tonight requires real sky observation
  over a week. The browser observes none of it.

---

## 2. Registered resource inventory

Registered in `curriculum.registry.json`, `formal: true`, `teacherVisible:
true`, `assignable: false` (resource-type policy). Grade is the registry grade
block; page labels noted where they differ.

| # | Resource | File | Activity identifier | Unit | Grade | Page grade/standards notes [Verified] |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The Gray Zone | `investigation_gray-zone.html` | `investigation-gray-zone` | what-is-life | 6 | Grade 6; 6.MS-LS1-1 |
| 2 | Cell Energy | `investigation_cell-energy.html` | `investigation-cell-energy` | cell-types | 6 | Labelled "Grade 6-8"; also lists 8.MS-LS1-7 and 7.MS-LS2-3; canonical link points to `simulation_cell-energy.html` |
| 3 | The Protein Pathway | `investigation_protein-pathway.html` | `investigation-protein-pathway` | organelles | 6 | Grade 6; 6.MS-LS1-2 |
| 4 | Amplitude Challenge | `investigation_amplitude-challenge.html` | `investigation-amplitude-challenge` | nature-of-waves | 6 | 6.MS-PS4-1, 6.MS-PS4-2 |
| 5 | Floatlandia Fracture | `simulation_floatlandia-fracture.html` | `simulation-floatlandia-fracture` | continental-drift | 6 | No grade on `.stem-focus`; ESS1-4, ESS2-2 |
| 6 | Gravity Wells | `simulation_gravity-wells.html` | `simulation-gravity-wells` | gravity | 6 | Grade 6; 6.MS-PS2-4, MS-ESS1-2 |
| 7 | Eclipse Alignment | `simulation_eclipse-alignment.html` | `simulation-eclipse-alignment` | eclipses | 6 | Grade 6; 6.MS-ESS1-1a |
| 8 | Medical Mysteries | `extension_body-systems.html` | `extension-body-systems` | body-systems | 6 | Grade 6; 6.MS-LS1-3 |
| 9 | Chernobyl Frogs | `extension_chernobyl-frogs.html` | `extension-chernobyl-frogs` | biological-evolution | 6 | Grade 6 badges; page notes the topic is above grade level |
| 10 | Fossil Hunt | `extension_fossil-hunt.html` | `extension-fossil-hunt` | layers-of-time | 6 | Labelled "Grade 6-8"; 6.MS-ESS1-4 |
| 11 | Moon Tonight | `extension_moon-tonight.html` | `extension-moon-tonight` | phases-of-the-moon | 6 | No grade or standards shown |
| 12 | Hidden World of Matter | `extension_hidden-world-of-matter.html` | `extension-hidden-world-of-matter` | chemical-reactions | 6 | No `.stem-focus`; text names 8.MS-PS1-1 as previewed |
| 13 | Build-a-Boat (Welcome to Floatia) | `challenge_welcome-to-floatia.html` | `challenge-welcome-to-floatia` | engineering-design | 6 | 6.MS-ETS2-3(MA) |

Curriculum status (owner-ratified HQIM-4A,
`docs/hqim/hqim-4a-human-decision-reconciliation.md`): Gray Zone, Cell
Energy, Amplitude, Floatlandia, Gravity Wells, Eclipse Alignment, Fossil Hunt,
and Build-a-Boat are **required** baseline. Protein Pathway and Moon Tonight
are **extensions** in curriculum role. Protein Pathway's resource **type**
remains investigation (standard §1.4).

---

## 3. Unregistered resource inventory

Formal-type filenames that are not in the registry. They are not in the
Teacher Workspace catalog and cannot receive a valid assignment through the
registry path today.

| Resource | Files | Would-be identifier | Grade evidence [Verified] | Published by |
| --- | --- | --- | --- | --- |
| Population Patterns | `investigation_population-patterns.html` | `investigation-population-patterns` | Grade 7 (7.MS-LS2-1); Grade 7 teachers (Kankel, Rovner); endpoint marked placeholder by a TODO | Marketing and app manifests |
| Beetle Island | `simulation_beetle-island.html` | `simulation-beetle-island` | Labelled Grade 8 enrichment (8.MS-LS4-4); payload sends `grade: '6'` | Marketing and app manifests |
| Neuron Explorer | `extension_neuron-explorer.html` | `extension-neuron-explorer` | Grade 6 (6.MS-LS1-2, LS1-3); some content beyond Grade 6 [Inference] | Marketing and app manifests |
| Are Viruses Alive? | `extension_virus.html` | `extension-virus` | Grade 6 (6.MS-LS1-1) | Marketing and app manifests |
| Ball Run (series) | `challenge_slow-motion-ball-run.html` (hub), `challenge_ball-run_day1.html` to `_day5.html`; redirect stubs `ball/`, `ball1/` to `ball5/` | `challenge-slow-motion-ball-run` (hub); each day would yield `challenge-ball-run-day<N>` | No grade or standards on any page; HQIM-4A: required Grade 6 challenge, counted once | Marketing manifest only (not the app manifest) |

Registration is a curriculum decision. Each needs an owner decision before
any assignability work (grade fit for Population Patterns and Beetle Island;
single-resource consolidation for Ball Run, standard §16 Q7).

---

## 4. Informal and supporting resources

Not formal types under the Phase 1 grammar; not assignable. Listed for
completeness.

| Category | Count | Files | Notes [Verified] |
| --- | --- | --- | --- |
| Games | 7 | `game_cell-explorer`, `game_cellular-showdown`, `game_evolution-clicker`, `game_exercise`, `game_is-it-alive`, `game_layer-detective`, `game_photon-runner` | Excluded from the formal curriculum. Three post to Apps Script. |
| Body-system maps | 8 | `system_circulatory`, `_digestive`, `_excretory`, `_immune`, `_muscular`, `_nervous`, `_respiratory`, `_skeletal` | **Required** baseline under HQIM-4A, yet outside the Phase 1 grammar (prefix `system_`). See standard §16 Q8. |
| Disease explorations | 8 | `disease_*` (same eight systems) | Extensions under HQIM-4A. |
| Body-system hub pages | 2 | `body-system-diseases.html`, `body-system-interactions.html` | Navigation/overview pages. |
| Tool | 1 | `tool_lab-report-assistant.html` | Shared registry resource. Has its own authenticated autosave (`LAB_REPORT_CLOUD_AUTOSAVE.md`). |

**Count reconciliation.** 18 formal + 7 + 8 + 8 + 2 = **43** instructional
pages; adding the tool gives **44**. HQIM-4A uses a different, curriculum
convention (17 existing required non-lesson experiences). Out of scope:
`wonderbox/` (marketing content), `blog/`, `mission-control/`, and the `ball*/`
redirect stubs.

---

## 5. Existing instructional structures

[Verified] Main stages in page order. "Gate" means a later stage stays locked
until an earlier one is done.

| Resource | Structure |
| --- | --- |
| Gray Zone | 6 characteristic cards (review each) -> 6 predictions -> 36 evidence judgments -> notebook -> guided CER for 4 cases (12 MCQ steps) -> quiz -> optional reflection. Strict chain of gates. |
| Cell Energy | Explore cell (4 organelles) -> photosynthesis sliders -> respiration sliders -> energy cycle -> mode gate -> quiz. Gates use slider-move counts. |
| Protein Pathway | 6-step pathway walkthrough -> checkpoint -> real-world challenge -> "When Things Break" -> checkpoint -> quiz. No gates. |
| Amplitude Challenge | Wave explorer + prediction -> amplitude lab trials -> energy targets -> wave model (scatter, model choice, CER) -> mode gate -> quiz. 4 checkpoints gate phases. |
| Floatlandia Fracture | 3 evidence cards -> drag 5 plates into a reconstruction -> 11-second animation -> mode gate -> quiz. |
| Gravity Wells | 3 concept cards -> test 5 masses + checkpoint -> orbit missions (Earth orbit + 2 more of 4) + checkpoint -> mode gate -> quiz. |
| Eclipse Alignment | 3 observation cards -> model lab -> 3 sequential challenges -> discovery -> ~10-second Deep Time animation -> quiz. |
| Medical Mysteries | 5 case files, 3 MCQs each -> PDF report card. |
| Chernobyl Frogs | 4 evidence cards + prediction -> random simulation -> student-plotted graph -> 4 reflections. |
| Fossil Hunt | Difficulty choice -> match fossil layers across sites -> order oldest to youngest -> thinking check -> quiz (Classroom panel). |
| Moon Tonight | Tonight's moon (device clock) -> why 29.5 days -> moon names -> outdoor observation mission. |
| Hidden World of Matter | Lesson-like: goals, vocabulary, hook, content sections, Matter Builder (3 targets), 7-item sort, Brain Check, synthesis, quiz, More Learning, Connections. |
| Build-a-Boat (Floatia) | Problem cards -> criteria/constraints sort -> 3 material choices -> paper scaled drawing checklist -> build and test (3 result selects) -> claim builder -> predict and redesign -> Quick Check -> quiz. Planned for five class periods. |
| Population Patterns | 3 data sets (graph + table + checkpoint each) -> CER -> transfer task -> quiz. |
| Beetle Island | 4 cards + prediction -> random simulation -> student-plotted graph -> 4 reflections. |
| Neuron Explorer | Explore 11 neuron parts -> signal mode (myelin toggle) -> Quiz Me rounds. |
| Are Viruses Alive? | 6 info cards -> characteristics checklist (fixed verdicts, no controls) -> quiz. |
| Ball Run | Hub -> Day 1 (criteria, prediction, 3 checks) -> Day 2 (first build, 3-8 trials) -> Day 3 (one change, revised trials) -> Day 4 (best design, 5-10 trials, constraint checks) -> Day 5 (story, summary, quiz). Days are independent pages. |

---

## 6. Existing assessment methods and question counts

[Verified] "Final quiz" is the end-of-resource scored check. Formative items
are listed separately.

| Resource | Final quiz items | Explanations in page | Formative scored items | Scoring | Retake before submit |
| --- | --- | --- | --- | --- | --- |
| Gray Zone | 8 | Yes | 12 guided-CER MCQ steps | Client | Yes (Try Again) |
| Cell Energy | 5 | No | 4 checkpoints | Client; quiz only in Classroom mode | No |
| Protein Pathway | 8 | Yes | 3 MCQs (ungated) | Client | Yes |
| Amplitude Challenge | 5 | No | 4 checkpoints | Client | Yes |
| Floatlandia Fracture | 5 | No | None | Client; auto-grades on 5th answer; quiz only in Classroom mode | No |
| Gravity Wells | 5 | No | 2 checkpoints; 5 missions | Client; auto-grades on 5th answer; quiz only in Classroom mode | No |
| Eclipse Alignment | 5 | Yes | 3 challenges | Client | Yes (resubmits) |
| Medical Mysteries | 15 case MCQs (no separate quiz) | Yes (never displayed) | None | Client; PDF | Answers editable |
| Chernobyl Frogs | 0 (payload sends fixed `4/4`) | n/a | Prediction feedback; graph accuracy | None real | n/a |
| Fossil Hunt | 10 (two banks of 10, by difficulty) | Yes | Thinking check; error/hint counts | Client; quiz only in Classroom panel [Inference] | No |
| Moon Tonight | 0 | n/a | None | None | n/a |
| Hidden World of Matter | 10 | Yes | 2 Brain Check; 7-item sort; prediction gate | Client | Yes |
| Build-a-Boat (Floatia) | 10 | Yes | 2 Quick Check (ungraded) | Client | Yes |
| Population Patterns | 10 | Yes | 3 checkpoints; transfer select | Client | No |
| Beetle Island | 0 (payload sends fixed `4/4`) | n/a | Graph accuracy | None real | n/a |
| Neuron Explorer | 8 drawn at random from 10 | Feedback per answer | Exploration points | Client; sends only C/W per slot | Yes (rounds) |
| Are Viruses Alive? | 8 | Yes | None | Client | Yes |
| Ball Run | Day 1: 3 (retry until correct); Day 5: 10 | Yes | None | Client | Day 5 locked after scoring until full reset |

---

## 7. Existing student evidence

[Verified] What students produce, and what is actually sent anywhere.

| Resource | Student-produced evidence | Sent with submission |
| --- | --- | --- |
| Gray Zone | Reviews, 6 predictions, 36 evidence judgments, CER selections, optional reflection | Quiz letters and score only |
| Cell Energy | Slider interactions, checkpoint choices | Quiz letters and score only |
| Protein Pathway | Checkpoint choices | Quiz letters and score only |
| Amplitude Challenge | Prediction, trial table, target sends, model choice, CER (minimum 25/30/30 characters) | CER text, quiz letters, score; not prediction, trials, or model choice |
| Floatlandia Fracture | Plate placement | Quiz letters and score only |
| Gravity Wells | Mass tests, launch vectors, mission outcomes | Quiz letters and score only |
| Eclipse Alignment | Configurations, solved challenges | Quiz letters and score only |
| Medical Mysteries | Case answers | Nothing sent; local PDF only |
| Chernobyl Frogs | Prediction, plotted graph, 4 reflections | Reflections, graph accuracy, fixed score |
| Fossil Hunt | Layer matches, ordering, thinking check | Difficulty, matched count, errors, hints, quiz letters, score |
| Moon Tonight | Paper sketch and prediction (off-page) | Nothing |
| Hidden World of Matter | Builder targets, sort, Brain Check | Quiz letters and score only |
| Build-a-Boat (Floatia) | Drawing checklist, test-result selects, claim selects, redesign text ("Nothing here is saved or sent") | Quiz letters and score only |
| Population Patterns | Prediction, checkpoints, CER (minimum 40/70/70), transfer choice and text | Prediction, CER, transfer, quiz letters, score |
| Beetle Island | Prediction, plotted graph, 4 reflections | Environment, event, accuracy, prediction, reflections, fixed score |
| Neuron Explorer | Exploration, round answers | C/W per slot and score |
| Are Viruses Alive? | Quiz choices | Quiz letters and score |
| Ball Run | Predictions, trial tables, change declaration, comparisons, constraint checks, explanations, final story | Day data as JSON plus a PDF to the report endpoint |

---

## 8. Existing persistence and submission methods

[Verified]

| Mechanism | Resources |
| --- | --- |
| Centralized v1 Apps Script endpoint (form-encoded POST; `docs/V1_CENTRALIZED_ASSESSMENT_SUBMISSION_ARCHITECTURE.md`) | 15 pages: all formal pages except Medical Mysteries, Moon Tonight, and Ball Run |
| Separate Ball Run report endpoint (JSON + PDF; email delivery) | Ball Run Days 1-5 |
| No submission | Medical Mysteries (local PDF), Moon Tonight, Ball Run hub |
| `sessionStorage` progress | Amplitude Challenge, Population Patterns |
| `localStorage` progress | Eclipse Alignment (lab state, phase, Deep Time flag, observations); Ball Run (one key per day, nothing shared between days) |
| In-memory only (lost on reload) | All other formal pages |
| Firebase / platform callables | None |
| Identity | Typed name. Teacher select (Brown/Gay for Grade 6 pages; Kankel/Rovner for Population Patterns). Block A-G (free text on some). Ball Run: name, team, grade dropdown; teacher fixed as `mr-brown`. |
| Practice / Classroom mode | Most scored pages; `?mode=classroom` switches. Gravity Wells, Floatlandia, Cell Energy, and Fossil Hunt hide the quiz in Practice mode. |

Hosting [Verified]: 17 of the 18 formal resources are byte-copied by
`scripts/app-hosting/public-files.json` to `app/lessons/<filename>`. These are
copies of the public page, not authenticated artifacts. Ball Run is published
only by the marketing manifest.

---

## 9. Existing completion behavior

[Verified] No resource has a platform completion state. Page-level
behavior only:

- "Done" is local: a score banner, a PDF, or a confirmed Apps Script response.
- Sequential gates exist in Gray Zone, Cell Energy, Amplitude, Floatlandia,
  Gravity Wells, Eclipse, Fossil Hunt, Chernobyl Frogs, Beetle Island,
  Population Patterns, and Ball Run (per day). All are client-side and can be
  bypassed (for example by editing Eclipse's `localStorage`).
- Several gates are dwell or click-count gates that the standard disallows as
  completion criteria: Eclipse's ~10-second animation, Floatlandia's
  11-second animation, Cell Energy's slider-move counts, and "open every card"
  steps.
- Resubmission is possible on pages with Try Again, so the endpoint may
  receive several submissions per student.

---

## 10. Known technical limitations

[Verified unless marked]

1. **Answer keys in the client** on every scored page; scores computed in the
   browser and sent as strings.
2. **Typed identity**; no tie to an authenticated student.
3. **No authenticated delivery.** The app-host copies are the public page.
4. **Evidence not persisted** for most resources; lost on reload.
5. **No explanations** in Gravity Wells, Floatlandia, Amplitude, and Cell
   Energy quizzes (the standard requires them).
6. **Hidden auto-solve hotkeys:** Floatlandia (Ctrl+Cmd+1 solves the
   reconstruction) and Medical Mysteries (Cmd+Shift+1 fills random answers).
   Both must be absent from authenticated delivery.
7. **Gray Zone dead end:** in `cerSelect`, a wrong guided-CER choice disables
   every option in that step and only a correct choice unlocks the next step,
   so one wrong pick blocks the quiz until reload, and reload loses progress.
8. **Fixed `grade: '6'`** in payloads even where the page says Grade 8
   (Beetle Island) or previews Grade 8 (Hidden World).
9. **Cell Energy canonical link** points to `simulation_cell-energy.html`.
10. **Population Patterns endpoint** is flagged as a placeholder by a TODO.
11. **Medical Mysteries** records feedback and diagnosis reveals that are never
    displayed; case ids skip 3.
12. **Neuron Explorer** draws 8 of 10 at random and submits only
    correct/wrong, so items cannot be matched to fixed ids.
13. **Random simulations** (Chernobyl Frogs, Beetle Island) cannot be replayed
    by a server without a seed or run record.
14. **Ball Run** days share no state; editing a confirmed day does not
    invalidate its confirmed status; PDF generation does not prove delivery
    (`docs/hqim/ball-run-evidence-chain-audit.md`).
15. **Physical work is unobservable** (Floatia, Ball Run, Moon Tonight).
16. **Revision path table is lesson-only.** `revisionPaths` / the Hosting
    revision copier accept only `lesson_<slug>` renditions, so non-lesson
    revision-bound delivery needs a designed extension.
17. **Style:** Fossil Hunt teacher notes contain an em dash.
18. **Fossil Hunt scientific accuracy** carries open qualifications
    (`docs/hqim/fossil-hunt-scientific-accuracy-audit.md`).

Items 6, 7, 9, 10, 11, and 17 are existing defects. They are recorded here, not
fixed.

---

## 11. Proposed five-question assessment migration requirements

[Proposed] All 18 resources need a new canonical 5-item revision. Reuse means
"review and re-author into a revision payload", never truncation.

| Resource | Current | Migration path |
| --- | --- | --- |
| Amplitude Challenge | 5, no explanations | Review alignment; author explanations; check answer positions |
| Cell Energy | 5, no explanations | Same; confirm Grade 6 alignment given Grade 7/8 standard claims |
| Gravity Wells | 5, no explanations | Same |
| Eclipse Alignment | 5, explanations | Review alignment and quality; likely closest to ready |
| Floatlandia Fracture | 5, no explanations | Review; author explanations; confirm grade fit (HQIM qualifications) |
| Gray Zone | 8 | Select or author 5 covering essential objectives |
| Protein Pathway | 8 | Select or author 5 |
| Are Viruses Alive? | 8 | Select or author 5 |
| Neuron Explorer | 8 of 10 random | Author a fixed 5; review grade fit |
| Hidden World of Matter | 10 | Select or author 5; resolve Grade 8 preview vs badge |
| Build-a-Boat (Floatia) | 10 | Select or author 5 aligned to the authentic classroom design |
| Population Patterns | 10 | Select or author 5 (Grade 7) |
| Fossil Hunt | 2 x 10 | One 5-item revision for both difficulty levels; resolve accuracy audit first |
| Ball Run | 3 (Day 1) + 10 (Day 5) | One 5-item quiz at the end of the challenge |
| Medical Mysteries | 15 case MCQs | Cases stay as formative work; author 5 final items |
| Chernobyl Frogs | 0 | Author 5 |
| Beetle Island | 0 | Author 5 after grade decision |
| Moon Tonight | 0 | Author 5 |

---

## 12. Proposed required evidence by resource

[Proposed] Minimum meaningful completion. Stage rules use the standard's
§11.6 vocabulary: **E** = evidence-derived, **D** = deterministic outcome
check possible, **R** = recorded completion (avoid). Every row also ends with
the five-question quiz.

### 12.1 Registered resources

**The Gray Zone (investigation)**
- CURRENT: strict chain of reviews, predictions, 36 judgments, guided CER;
  only quiz sent.
- REQUIRED: 6 alive/not-alive predictions (E); evidence-judgment notebook as a
  structured table (E); one authored CER for a chosen case (E). Guided CER MCQ
  steps stay formative with a retry path.
- OPTIONAL: per-characteristic card review; remaining guided CER cases;
  reflection.

**Cell Energy (investigation)**
- CURRENT: slider-count gates; no written evidence.
- REQUIRED: one short observation each from photosynthesis and respiration
  (E); one explanation of how matter and energy cycle between the processes
  (E). Slider counts removed as gates.
- OPTIONAL: organelle discovery; energy-cycle discovery log; plant/animal
  comparison.

**The Protein Pathway (investigation; HQIM extension role)**
- CURRENT: reading walkthrough; no gates; only quiz sent.
- REQUIRED: pathway sequence ordering (E, D possible); one explanation of what
  happens when one structure fails (E). Instructional exception: no data
  table or graph (model-reading investigation).
- OPTIONAL: "When Things Break" table; checkpoints.

**Amplitude Challenge (investigation)**
- CURRENT: prediction, trials, targets, model choice, CER; CER sent.
- REQUIRED: prediction (E); trial table, at least 6 trials across the
  amplitude range (E, structured); amplitude-energy graph as structured points
  derived from the trials (E); model choice (E); CER (E).
- OPTIONAL: wave-part identification; energy targets; ratio view.

**Floatlandia Fracture (simulation)**
- CURRENT: drag reconstruction plus animation; only quiz sent.
- REQUIRED: completed reconstruction (D: final plate positions within
  tolerance); one explanation naming the evidence that matched the plates (E).
- OPTIONAL: evidence cards; drift animation (no dwell gate).

**Gravity Wells (simulation)**
- CURRENT: mass tests and missions gate a 5-item quiz; only quiz sent.
- REQUIRED: one prediction about how mass changes the gravity well (E); mass
  comparison stage (E: comparison table captured from the 5 tests); Earth
  orbit mission plus two more missions (D: launch vector and mass replayable
  by the deterministic integrator; E: structured mission log); one Show Your
  Thinking explanation of why an orbit needs the right speed (E).
- OPTIONAL: remaining missions; free launching; concept cards (no
  open-every-card gate).

**Eclipse Alignment (simulation)**
- CURRENT: 3 sequential challenges, animation gate, quiz.
- REQUIRED: 3 challenges (D: each is a discrete configuration tuple); one
  explanation of why eclipses do not happen every month (E).
- OPTIONAL: observation cards; Deep Time animation (no dwell gate); discovery
  summary.

**Medical Mysteries (extension)**
- CURRENT: 15 case MCQs, local PDF.
- REQUIRED: all 5 cases worked (E: structured case selections); one Show Your
  Thinking explanation tracing how two systems interact in one case (E).
- OPTIONAL: report card PDF.

**Chernobyl Frogs (extension)**
- CURRENT: prediction, random simulation, plotted graph, 4 reflections.
- REQUIRED: prediction (E); simulation run record with environment and
  outcome (E; random runs are recorded, not replayed); plotted graph as
  structured points (E); reflections, reduced to the essential prompts on
  content review (E).
- OPTIONAL: extra runs; graph accuracy check.

**Fossil Hunt (extension; required baseline)**
- CURRENT: matching, ordering, thinking check, quiz in Classroom panel.
- REQUIRED: completed correlation (D possible); final oldest-to-youngest
  order (E, structured); one explanation of how index fossils set the order
  (E).
- OPTIONAL: Challenge difficulty; hints.

**Moon Tonight (extension; HQIM extension role; physical)**
- CURRENT: no capture, no quiz.
- REQUIRED: observation record (date, time, phase seen, short description,
  optional sketch image) (E); 7-day prediction (E); follow-up observation and
  comparison a week later (E). The quiz unlocks after the follow-up.
- OPTIONAL: moon-names cards; horizon-illusion reading.
- Physical limitation applies (standard §10).

**Hidden World of Matter (extension)**
- CURRENT: lesson-like page with builder, sort, Brain Check, quiz.
- REQUIRED: Matter Builder targets (D possible); element/compound sort (E,
  structured); one explanation distinguishing an element from a compound (E).
- OPTIONAL: Brain Check; content-section reveals; synthesis reading.

**Build-a-Boat / Floatia (challenge; physical)**
- CURRENT: drawing checklist, result selects, claim selects, redesign text;
  nothing saved.
- REQUIRED, following the authentic classroom protocol
  (`docs/hqim/engineering-challenge-principles.md`): problem statement and
  criteria/constraints sort (E); design plan with material choices and budget
  (E); scaled drawing confirmation, with an optional photo (E); test results
  per build round, including failed builds (E, structured: penny count,
  outcome); failure analysis and redesign reasoning per round (E); final
  design justification (E).
- OPTIONAL: Quick Check; drawing photo.
- Physical limitation applies.

### 12.2 Unregistered resources (only if registered)

| Resource | REQUIRED (proposed) | OPTIONAL (proposed) |
| --- | --- | --- |
| Population Patterns | Prediction; CER; transfer choice and defense (all E) | Checkpoints |
| Beetle Island | Prediction; run record; plotted graph; essential reflections (all E) | Extra runs |
| Neuron Explorer | Myelin on/off comparison observation; explanation of signal travel (E) | Part exploration (no click-count gate) |
| Are Viruses Alive? | Student judgment per life characteristic (E, structured); claim and reasoning, alive or not (E) | Info cards |
| Ball Run | Stage per day: D1 prediction; D2 trial table (at least 3 trials, failures kept, duration for successful runs); D3 one declared change plus revised trials plus comparison; D4 at least 5 reliability trials, constraint checks, trade-off reasoning; D5 engineering story and final summary (all E) | Video; hub overview |

---

## 13. Proposed optional enrichment by resource

The OPTIONAL lines in §12 are the proposal. Common rules [Proposed]:

- Concept or evidence cards are always optional unless the resource
  explicitly needs a decision recorded on them.
- Animations and timed sequences are never gates.
- Extra missions, extra runs, harder difficulties, and replay are optional.
- Formative checkpoints remain available and are never graded or required.

---

## 14. Integration complexity

[Inference] Relative effort to reach the standard, beyond the shared platform
infrastructure.

| Resource | Quiz work | Evidence work | Other | Complexity |
| --- | --- | --- | --- | --- |
| Gravity Wells | Review + explanations | Small (prediction, mission log, 1 explanation) | Deterministic missions | Low |
| Eclipse Alignment | Review | Small (1 explanation) | Remove dwell gate | Low |
| Floatlandia Fracture | Review + explanations | Small | Remove hotkey and dwell gate; grade check | Low-Medium |
| Amplitude Challenge | Review + explanations | Medium (trials, graph, CER: already present locally) | Structured graph capture | Medium |
| Cell Energy | Review + explanations | Small-Medium (new prompts) | Replace slider gates; fix canonical; standards check | Medium |
| Protein Pathway | 8 to 5 | Small (new ordering + explanation) | | Medium |
| Hidden World of Matter | 10 to 5 | Small | Grade/badge decision | Medium |
| Medical Mysteries | Author 5 | Small | Remove hotkey; fix hidden feedback | Medium |
| Gray Zone | 8 to 5 | Medium (structured notebook, authored CER) | Fix CER dead end | Medium |
| Fossil Hunt | 2 x 10 to 5 | Small | Accuracy audit first | Medium-High |
| Chernobyl Frogs | Author 5 | Medium (graph, reflections) | Random run record; grade note | Medium-High |
| Moon Tonight | Author 5 | Medium (multi-day observation) | Date-dependent content; physical | High |
| Build-a-Boat (Floatia) | 10 to 5 | High (multi-round design record) | Align to authentic protocol; physical | High |
| Ball Run (unregistered) | 13 to 5 | High (five days) | Consolidate five pages; register; physical | High |
| Population Patterns (unregistered) | 10 to 5 | Small (already captured) | Registration (Grade 7) | Medium |
| Beetle Island (unregistered) | Author 5 | Medium | Grade decision | Medium-High |
| Neuron Explorer (unregistered) | Author fixed 5 | Small | Grade fit; registration | Medium |
| Are Viruses Alive? (unregistered) | 8 to 5 | Small (new controls) | Registration | Medium |

---

## 15. Recommended implementation groups

No bulk conversion is authorized. Each group is a separate, owner-authorized
operation after the platform infrastructure (standard §15) exists.

| Group | Resources | Rationale |
| --- | --- | --- |
| Pilot | Gravity Wells | Smallest content change; 5-item quiz already present; deterministic missions; no physical work |
| Group A (digital, 5 items present) | Eclipse Alignment, Amplitude Challenge, Floatlandia Fracture, Cell Energy | Quiz review rather than authoring; Amplitude exercises structured trials, graph, and CER |
| Group B (digital, quiz re-authoring) | Gray Zone, Protein Pathway, Hidden World of Matter, Medical Mysteries, Fossil Hunt | Content decisions per resource; fix listed defects first |
| Group C (no objective quiz today) | Chernobyl Frogs | New 5-item authoring; reflection-heavy evidence |
| Group D (physical, multi-session) | Build-a-Boat (Floatia), Moon Tonight, Ball Run | Multi-stage evidence; physical limitation statement; Ball Run consolidation |
| Registration decisions first | Population Patterns, Beetle Island, Neuron Explorer, Are Viruses Alive?, Ball Run | Owner decides registration and grade before any assignability work |

### 15.1 Is Gravity Wells still the best first pilot?

**For the first infrastructure pilot: yes.** [Inference]

- Its 5-item quiz is self-contained (`QUIZ_DATA`, `initQuiz`, `submitQuiz`)
  and joined to the simulation only by one completion flag.
- Its required missions are deterministic: a fixed start position, velocity
  from the drag alone, and a fixed leapfrog step. That allows a deterministic
  outcome check later, though the pilot does not need one.
- No physical work, no randomness, a single page, and a required-baseline
  resource (HQIM-4A).
- It exercises every piece of minimum infrastructure: delivery, gating,
  evidence save/submit, eligibility, server quiz, teacher view, and retake
  without evidence loss.

**As a reference implementation of the evidence standard: no.** [Inference]

- Today it produces no student-authored evidence. Every evidence field is new
  content, and HQIM notes analogy and depth concerns.
- It does not exercise structured data tables, graphs, or CER.
- **Amplitude Challenge** is the stronger reference for evidence (prediction,
  trial table, graph, model choice, CER, and HQIM-identified exemplar status).

**Recommendation:** pilot with Gravity Wells to prove the infrastructure with
the smallest content change, then use Amplitude Challenge as the second
resource and the reference exemplar for structured evidence. If the owner
prefers a single resource that proves both, choose Amplitude Challenge and
accept a larger first scope.

---

## Change log

- 2026-10-08: Initial issuance. Re-verified from the repository at `e20df02`;
  the earlier reconnaissance report was not available. Documentation only.
