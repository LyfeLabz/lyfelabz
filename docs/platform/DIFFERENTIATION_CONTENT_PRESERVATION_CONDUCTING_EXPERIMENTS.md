# Differentiation Content Preservation - Conducting Experiments (`reading-adapted`)

Human content gate for the Conducting Experiments `reading-adapted`
presentation. Like the Earth's Layers record
(`DIFFERENTIATION_CONTENT_PRESERVATION_EARTHS_LAYERS.md`), it complements the
automated structural gates in `app/scripts/lessonBuilder/variantSource.cjs`
and `variantInvariance.cjs`, which prove that nothing outside the adaptable
prose changed. This record covers what those gates cannot prove: that the
adapted prose still teaches the same science and the same experimental-design
reasoning.

- Canonical source: `lesson-sources/lesson_conducting-experiments.html`
- Variant source: `lesson-sources/variants/conducting-experiments.reading-adapted.html`
- Assessment: `conducting-experiments.r1.json` (unchanged; the variant quiz
  stays the canonical r1 quiz)
- Variant config: `app/scripts/lessonBuilder/lessons/conducting-experiments.cjs` (`variants["reading-adapted"]`)
- Assessment presentation source:
  `lesson-sources/variants/conducting-experiments.reading-adapted.assessment.json`
  and its `.notes.json`; retained record
  `platform/functions/src/scripts/assessment-presentations/ap1acc72282dd0e33764f19ea8a46d23325ebd0721723249758e9a67d6f175712c.json`;
  owner review record `lesson-sources/variants/reviews/<same id>.json`
- Regression test: `app/scripts/lessonBuilder/__tests__/ce-reading-adapted-presentation.test.js`
- Status: contract, lesson prose, and assessment presentation owner-approved
  and certified (2026-09-30); presentation retained (see section 8). No
  presentation coverage is published.
  **Current-state note (2026-10-01):** the Quiz Results Polish rollout minted the
  successor presentation
  `pr7715ff14a5d647f518fffe2f8af8de8cfd843a2739a3a32172a14d5363465e5e`
  (same `ap1acc…` binding to `assessment_conducting-experiments__r1`). It is
  staging-certified and hosted in the production bundle, but production coverage
  remains absent by owner decision, so it is not production-active. The
  `pr4bd0…` revision recorded in section 8 is historical and retained. See
  `RELEASE_2026-10-01_PRODUCTION_APP_CATCHUP.md`.

### Variant configuration

The block the owner reviewed (`PROPOSED_VARIANT` in the regression test) was
declared in the lesson config unchanged at retention, plus the certified
`assessmentPresentationRevisionId`. The test requires the declared block to
stay equal to it.

---

## 1. Adaptable scope

- Sections: `hook`, `hypothesis`, `variables`, `observations`, `inference`,
  `summary`.
- Adaptable selectors: `p`, `span`, `.hook-card-observation`,
  `.question-pause-text`, `.process-body`, `.bridge-callout`,
  `.wrapup-beat-answer`, `.wrapup-beat-body`.
- Locked selectors: `.edu-note`, `.teal-it`, `.predict-hint`,
  `.predict-buttons`, `.hypo-card`, `.sorter-card`, `.summary-table-wrap`,
  `.wrapup-behavior-chips`, `.section-label`, `.hook-card-icon`,
  `.observe-icon`, `.question-pause-icon`, `.process-icon`, `.process-mini`.
  `span` is adaptable only for the unclassed prose spans in the observe
  cards; every classed span in these sections is locked explicitly.
- 39 adaptable prose runs (R1-R39, table below).
- Always invariant (outside the adaptable sections, or locked inside them):
  hero and driving question, Learning Science Focus, learning goals,
  vocabulary cards, Quick Recall, the quiz section (quiz markup, Show Your
  Thinking component, the supplied `ce-data` evidence, the score board and
  its "mystery you came in with" note), More Learning, Connections, the
  Hypothesis Builder (steps, drop-down options, check buttons, own-words
  step), both sorters (items, buttons, completion notes), predict buttons,
  hook card names, questions and prompts, process card labels and names,
  wrap-up beat labels, both summary tables, the behavior chips, KEY IDEA
  labels, the Hypothesis KEY IDEA body, headings, section labels, teacher
  notes, scripts, styles and element ids.
- The quiz, its directions, and Show Your Thinking are adapted only through
  the assessment presentation (section 7), never in the variant source.

## 2. Rules for every run

1. Same science and the same experimental-design reasoning: every MUST
   PRESERVE item survives with its meaning intact.
2. Required vocabulary stays verbatim wherever it is used: hypothesis,
   testable, cause-and-effect, independent variable, dependent variable,
   control variables, fair test, quantitative observation, qualitative
   observation, inference, prediction, evidence, conclusion (also
   observation, variable, factor, scientific inquiry, experiment).
3. KEY IDEA definition sentences that restate the canonical vocabulary
   definitions stay verbatim: the Hypothesis KEY IDEA (locked by `.teal-it`),
   the first sentence of the Inference KEY IDEA (R26), and the five
   definitions in the Prediction to Conclusion KEY IDEA (R33). The process
   card definitions (R14-R16) and the observation definitions (R21, R22)
   also stay verbatim. The selector grammar cannot lock a sentence inside a
   paragraph, so the regression test pins these sentences.
4. Canonical examples and quotes stay verbatim: "Plants given more sunlight
   will grow taller", "Plants are happier in the sun", "The eruption reached
   2.3 meters.", "The foam was white and smelled sweet.", "The grass is
   wet.", "It probably rained or dew formed.", the soda question, and the
   essential question.
5. Numbers and quantities unchanged (2.3 meters; three plants; two weeks;
   about one second).
6. No added facts, no assessment hints, no disclosure of adaptation.
7. Adapted prose must stay coherent with the locked interactive feedback in
   the scripts (Hypothesis Builder, predict gates, sorters, Quick Recall),
   which is canonical in this rollout.
8. Readability targets are guidelines (Earth's Layers owner decision): about
   12 words per sentence on average and generally no sentence over 20 words.
   Accuracy, natural language and coherence take priority.

## 3. Run-by-run contract

| Run | Locator | MUST PRESERVE | Warnings / DO NOT ADD | Adapted |
|---|---|---|---|---|
| R1 | Hook intro "Science doesn't start in a lab" | Science starts with noticing something and asking why; click each card; think about the questions it raises. | | Contractions and "pop into your head" removed. |
| R2 | Hook card The Eruption | Mentos dropped into soda; foam erupts in about a second; some sodas erupt much higher than others. | No cause of the eruption. | "blast out like a geyser" becomes "a tall column of foam can rise out of the bottle" (the supplied data's own "column of foam"). |
| R3 | Hook card The Thirsty Plant | Three identical plants; a little, medium and a lot of water; after two weeks they look different. | | Unchanged. |
| R4 | Hook card The Wet Grass | Morning; grass wet; no rain heard overnight; sidewalk dry. | R30 depends on the dry sidewalk. | "soaked" becomes "very wet"; split into three sentences. |
| R5 | Observe card "Notice something?" | Each mystery began with noticing and a question; "Scientific inquiry always starts with a question" (verbatim); curiosity or a desire to solve a problem. | | Split into four sentences. |
| R6 | Observe card "But a question alone" | A question is not an answer; an answer you can trust needs a plan; that plan is an experiment. | Keep "trust" (driving question). | Split; contraction removed. |
| R7 | Mission callout | Tools that turn a why-question into a fair test; students will soon use them in a real investigation of their own; they will use them to decide what a set of Mentos results shows; step one is an educated guess. | No claim that students run or measure anything here. | "Then" becomes "Later in this lesson"; split. |
| R8 | Hypothesis intro | A prediction is what you think will happen; adding why makes it a hypothesis. | | Prediction defined in its own sentence. |
| R9 | Observe card Testable | Quote verbatim; it can be run and measured. | | Dash clause becomes a sentence. |
| R10 | Observe card Not testable | Quote verbatim; happiness cannot be measured. | | Rhetorical question becomes a statement. |
| R11 | Predict gate qp-hypo | Which soda causes the biggest foaming eruption; predicting unlocks the Hypothesis Builder; remember the prediction; it is checked against supplied results at the end. | Must match the locked Builder feedback ("you will look at a set of supplied results at the end of the lesson") and the predict buttons. | Inverted question reordered; "Hold on to it" becomes "Remember your prediction". |
| R12 | Hypothesis callout | A hypothesis points at a cause and an effect; scientists name the thing you change and the thing that responds; next come the variables. | Do not define the variables here. | Ellipsis fragments become one sentence. |
| R13 | Variables intro | Three kinds of factors; one color per kind; teal changes, orange responds, green stays the same. | Locked color spans reuse the canonical forms. | "Follow the color coding" reworded. The color list is the one sentence over 20 words (a parallel list). |
| R14 | Process card Independent Variable | Definition verbatim; plant example: amount of water. | Must match the locked sorter. | Colon fragment becomes a sentence. |
| R15 | Process card Dependent Variable | Definition verbatim; plant example: how tall each plant grows. | | Same. |
| R16 | Process card Control Variables | Definition verbatim; plant example: same pot, soil, sunlight. | | Same. |
| R17 | Predict gate qp-vars | Why keep sunlight the same for all three plants; predicting unlocks the sorting challenge. | Must match the locked predict buttons. | "why bother" removed. |
| R18 | "Here's why it matters" | More sunlight and more water together means you cannot tell which caused the growth; keeping everything else constant makes the independent variable the only possible cause; that makes a test fair. | Keep "only possible cause". | Conditional split; the referent "which one" made explicit (sunlight or water). |
| R19 | Variables callout | Question, hypothesis, fair test chain; what a scientist writes down during a fair test leads to observations. | Avoid "experiment is running" (pinned by `ce-supplied-evidence.test.js`). | "Time to talk about" removed. |
| R20 | Observations intro | Evidence is collected two ways: instruments and numbers, or senses and descriptions; both useful; not the same. | | "two flavors" becomes "two ways". |
| R21 | Observe card Quantitative | Definition verbatim; objective measures (length, height, temperature, time); example quote verbatim. | Keep "objective". | Fragment "Objective measures:" becomes a sentence. |
| R22 | Observe card Qualitative | Definition verbatim; descriptions from the senses (colors, textures, smells, tastes); example quote verbatim. | | Fragment becomes a sentence. |
| R23 | Memory trick | Quantitative / quantity is a number you count or measure; qualitative / quality is a description from your senses. | | Dash clauses become sentences. |
| R24 | Observations callout | Observations are what you see, measure, hear or smell; scientists also work out what evidence means; that step has a name. | Do not name inference yet. | Colon clause becomes a sentence. |
| R25 | Inference intro | Detective analogy: a detective does not see the crime, uses clues to work out what happened; scientists do the same with observations. | Keep the analogy (teacher note). | Dash clause split; contractions removed. |
| R26 | KEY IDEA Inference | First sentence verbatim (definition); you did not see it happen; you worked out the most likely explanation from what you observed. | | "your brain filled in" becomes "You used what you observed to work out the most likely explanation." |
| R27 | Predict gate qp-inf1 | Raincoat and umbrella; what can you infer. | | Unchanged. |
| R28 | Reasonable inference 1 | They think it will rain; rain was never observed; raincoat and umbrella were; clues connected to the most likely explanation; an inference is an explanation built from observations. | Must match the locked predict buttons. | Split; "your brain connected" becomes "you connected". |
| R29 | Predict gate qp-inf2 | Callback to the wet-grass mystery; morning; grass wet; what can you infer. | | Names the wet grass mystery explicitly; split. |
| R30 | Reasonable inference 2 | Rain overnight or dew; the dry sidewalk is also an observation; it points toward dew; better observations lead to better inferences. | Consistent with R4. | Split; "rather than" becomes "instead of". |
| R31 | Observe card Observation | Information collected directly with senses or instruments; example quote verbatim. | | "Example:" label added. |
| R32 | Observe card Inference | The explanation you build from observations; example quote verbatim. | | "your brain builds" becomes "you build". |
| R33 | KEY IDEA Prediction to Conclusion | All five definitions verbatim; a conclusion can only be as strong as its evidence. | | Only the closing dash clause becomes its own sentence. |
| R34 | Summary intro | Started with a foam mystery; now students know the scientist's tools; at the end of the quiz they use them to analyze Mentos-and-soda results. | | "foamy", "toolkit" become "about foam", "tools". |
| R35 | Beat 1 answer + body | Inquiry begins with curiosity (verbatim); the soda question; turn it into a hypothesis: a testable, educated guess that names a cause and an effect. | | The question is introduced ("Ask a question, like"); hypothesis restated as its own sentence. |
| R36 | Beat 2 answer + body | Change one thing, measure one thing, keep everything else the same; every fair experiment uses three roles. | The chips that follow are locked. | "lock everything else" becomes "keep everything else the same", matching the locked chip "Controls - keep them the same". |
| R37 | Beat 3 answer + body | Let the evidence decide (verbatim); record quantitative (numbers) and qualitative (senses) observations; the ones that answer the question are evidence; inferences about what they mean; a conclusion no stronger than the evidence. | | One long sentence becomes three. |
| R38 | Summary tables intro | Words to know and goals, in one place. | | "Here are" added. |
| R39 | Essential question callout | Essential question verbatim; answering it with the eight listed terms means students are ready for a real investigation. | Keep all eight terms. | Conditional split into an instruction and a result. |

## 4. Cross-section coherence

1. Plant experiment thread (R3, R14-R18, locked sorter and sorter feedback):
   water is the independent variable, height the dependent variable, and
   sunlight, pot and soil the control variables, everywhere.
2. Mentos prediction thread (R2, R11, locked Hypothesis Builder and its
   feedback, R34, Show Your Thinking): the prediction is made before
   evidence, held, and checked against the supplied results at the end. No
   run states which soda erupts highest (`ce-supplied-evidence.test.js`).
3. Wet-grass thread (R4, R29, R30, locked predict buttons): the dry sidewalk
   is an observation that points toward dew.
4. Observation versus inference (R24-R33, locked Quick Recall 2): an
   observation is collected directly; an inference is an explanation built
   from observations.
5. Color coding (R13, locked process cards, sorter buttons and chips): teal
   changes, orange responds, green stays the same.
6. Fair-test wording (R18, R36, locked chips): "keep ... the same" and
   "constant" replace "lock", so the adapted wording now agrees with the
   locked chip text.

## 5. Idiom and rhetoric register

| Phrase | Where | Disposition |
|---|---|---|
| "two flavors" | R20 | Replaced: "two ways". |
| "blast out like a geyser" | R2 | Replaced: "a tall column of foam can rise out of the bottle". |
| "a foamy geyser erupts" | Hero subtitle | Unchanged: the hero is outside the adaptable scope. |
| "your brain filled in" | R26 | Replaced: "You used what you observed to work out the most likely explanation." |
| "your brain connected", "your brain builds" | R28, R32 | Replaced: "you connected", "you build". |
| "lock everything else" | R36 | Replaced: "keep everything else the same". |
| "pop into your head", "why bother", "Hold on to it", "Time to meet / talk about" | R1, R17, R11, R12, R19 | Replaced with literal wording. |
| "toolkit" | R34 | Replaced: "tools". |
| "you've earned the toolkit" | Quiz score board (`.mystery-loop`) | **Unchanged: locked.** It sits inside the quiz section, which this contract keeps canonical, and the assessment presentation schema has no field for it. Owner decision item. |
| "the scientist's toolkit" | Hero subtitle; Connections intro | Unchanged: outside the adaptable scope. |

## 6. Locked interactive feedback

The student-facing feedback strings embedded in the lesson scripts
(Hypothesis Builder checks, own-words checklist, sorter messages, Quick
Recall feedback, quiz scoring messages) stay canonical, because every script
block must stay byte-identical. The adapted prose was written to agree with
them: R11 and the Builder's closing message both say the prediction is
checked against supplied results at the end; R14-R16 use the sorter
messages' own examples; R36 matches the locked chips.

## 7. Assessment presentation

- Traits: adapted language, 3 choices, bound to
  `assessment_conducting-experiments__r1`. No canonical r2.
- Directions, stems, options, and feedback adapted; one distractor omitted
  per item with an auditable rationale (draft `.assessment.json`) and
  misconception notes (`.notes.json`).
- Supplied evidence (`ce-data`): **canonical and locked** (owner decision).
  The presentation does not adapt, move, duplicate, or restate it.
- Show Your Thinking: adapted prompt and a structured `{ paragraphs }` model
  (Claim, Evidence, Reasoning, closing paragraph);
  `requiredTerms: ["claim", "evidence", "reasoning"]`. Every measurement the
  adapted model cites is a supplied trial height of the soda it names
  (regression test).

## 8. Review of the authored revision

Authored and owner-reviewed 2026-09-30. Owner review items resolved before
approval: q1 displays the wild-guess (A) and proven-fact (C) distractors and
omits the starting-question lure (D); the q5 full observation/inference
reversal is approved; `requiredTerms` stay semantic (claim, evidence,
reasoning) and the prompt's term-only emphasis (colon outside the bold) is
accepted; structured model leads `Claim:`, `Evidence:`, `Reasoning:` render as
the canonical labels do; loss of italics on "which" and "why" is accepted.

- Automated gates (in memory, `PROPOSED_VARIANT`): structural invariance,
  zero-exclusion equivalence contract, quiz identity and r1 fidelity,
  disclosure scan, deterministic double build, relocation post-condition,
  byte-identical scripts.
- Adaptable prose, canonical vs adapted: 1,078 vs 1,170 words; 12.1 vs 10.2
  words per sentence on average; 9 vs 1 sentences over 20 words (R13, a
  parallel color list).
- Instruction-only build (gated, not itself retained):
  `praff2896f58d621b82569d21f97b56fe43955f82e34867a4ae15c2afc3a681e69`.
- Certified assessment presentation:
  `ap1acc72282dd0e33764f19ea8a46d23325ebd0721723249758e9a67d6f175712c`
  (bound to `assessment_conducting-experiments__r1`).
- Retained revision (bound to that presentation):
  `pr4bd0e1dbe22e7b6db874dd16f4ff7313b19ed1b470acfae3dabbfdc96b350001`,
  byte-identical to the approved local preview without its review marking.
