# Tier C HQIM Conversion Blueprint

A repeatable instructional process for upgrading every remaining Tier C lesson
to the Earth's Layers flagship standard.

This document is written for the curriculum, not the code. It ignores HTML, CSS,
and JavaScript except where a structure changes what a student experiences. It
was produced from a side-by-side instructional comparison of the flagship
`lesson_earths-layers.html` against the first conversion candidate,
`lesson_what-is-life.html`. It complements, and does not replace,
`HQIM_LESSON_FRAMEWORK.md`.

---

## Part 1. Gap Analysis: What Is Life vs Earth's Layers

The purpose of this pass is not to rewrite What Is Life. It is to learn what the
flagship does, section by section, so the same reasoning can be applied to every
Tier C lesson.

The headline finding is important and slightly counterintuitive. What Is Life is
**not** a bare Tier C skeleton anymore. It has already received most of the
flagship scaffolding: a driving question, learning goals with standard codes,
click-to-reveal glossary vocabulary, a prediction gate before the reveal, a
misconception-rich Engage sort, dual-coded diagrams, a Quick Recall check, a
return-to-the-question Explain section, a two-mode quiz, hidden Educator Mode
notes, More Learning, and Connections. So the gaps are narrower and more precise
than "add everything." They are about instructional depth, not missing sections.

For each section: the flagship purpose, whether What Is Life meets it, the
opportunity, the reasoning, and a priority.

---

### Driving question

**Flagship purpose.** One question, visible in the hero, that the entire lesson
exists to answer. Earth's Layers asks "How does Earth's internal structure cause
changes on Earth's surface?" It is causal and it is answerable by the end.

**What Is Life.** Meets it, and does it well. The hero asks about viruses: "If a
virus can replicate, respond to its environment, and even evolve, what's missing
that keeps it from being truly alive?" This is a genuine puzzle with a payoff.

**Opportunity.** None structural. Preserve it.

**Priority: none (already strong).**

---

### Anchoring phenomenon

**Flagship purpose.** Open with a real, observable puzzle before any vocabulary,
so curiosity does the work of motivating the content. Earth's Layers opens on
earthquakes and volcanoes.

**What Is Life.** Meets it differently. Instead of one phenomenon it uses a
sorting challenge (fire, virus, robot, seed, bacterium: alive, not alive, or
debated). This is legitimate and arguably richer than the flagship, because it
front-loads non-examples and a genuinely debated case.

**Opportunity.** None. This is a strength worth copying into other Tier C
lessons, not a gap.

**Priority: none (already strong; a model for others).**

---

### Learning goals

**Flagship purpose.** State "I can" outcomes with standard codes before content
begins, as an advance organizer.

**What Is Life.** Meets it. Present, plainly worded, coded.

**Opportunity.** Verify the codes reflect what is actually assessed, not merely
mentioned (see Supporting Concept Principle in CLAUDE.md). No structural gap.

**Priority: low (verification only).**

---

### Vocabulary timing and treatment

**Flagship purpose.** Front-load terms in click-to-reveal cards, one open at a
time, with "See it in the lesson" jump links so a term met here reappears in
context later. Lowers the language barrier before reading.

**What Is Life.** Meets it. Glossary cards, correct intro line, jump links to the
exact spot each term is used.

**Opportunity.** None structural.

**Priority: none (already strong).**

---

### Prediction before explanation

**Flagship purpose.** Force a commitment before the answer is revealed. The
prediction gate hides the reveal until the student chooses, which produces the
generation effect and makes the reveal land harder.

**What Is Life.** Meets it. The Engage prediction gate ("what best decides
whether something counts as alive?") hides a green reveal until answered.

**Opportunity.** None structural.

**Priority: none (already strong).**

---

### Productive struggle / student sensemaking

**Flagship purpose.** Give the student at least one moment where they do
intellectual work the page cannot do for them.

**What Is Life.** Partially meets it, but this is the **single most important
gap**. Every think-move in the lesson is a click or a multiple-choice pick: the
sort reveals on click, the prediction gate is A/B/C, Quick Recall is
multiple-choice, the virus vote is binary, the quiz is multiple-choice. The
student never once has to **construct an explanation in their own words**. This
matches the top priority already named in `HQIM_LESSON_FRAMEWORK.md`: "add one
place per lesson where the student constructs an explanation in their own words."

**Opportunity.** Add one open-response sensemaking prompt, most naturally at the
"Back to Viruses" moment: "In one or two sentences, explain why a virus fails the
definition of life. Use the word *cell*." A self-check reveal (a model answer to
compare against) fits the existing reveal pattern and keeps it ungraded.

**Why it improves learning.** Retrieval that requires production, not
recognition, is far stronger for retention and exposes shallow understanding that
multiple choice hides. A student who can click "not made of cells" may still be
unable to say why that matters.

**Priority: CRITICAL.**

---

### Key Idea reveals (naming concepts in context)

**Flagship purpose.** At the moment a term is needed, Earth's Layers drops a
discrete "Key idea: [TERM]" card (Density, Differentiation, Lithosphere,
Asthenosphere, Convection Current) that formally names and defines the concept in
place. This is the canonical `KEY IDEA: [TERM]` copy standard for explanatory
cards.

**What Is Life.** Partially meets it. Terms are defined, but mostly as **bold
words inside prose, characteristic cards, and comparison tables**. There is only
one formal reveal card, and it is the prediction reveal, not a concept reveal.
The lesson lacks the discrete, scannable "Key Idea" beats that let a term stand
out and be found again.

**Opportunity.** Promote the two or three load-bearing terms (cell, unicellular
vs multicellular, prokaryotic vs eukaryotic) into explicit `KEY IDEA:` cards at
the point of first real use, rather than leaving them as inline bold.

**Why it improves learning.** A named, boxed idea is easier to encode, easier to
locate when studying, and signals "this is the thing to remember." Inline bold
does not carry that weight.

**Priority: MEDIUM.**

---

### Scientific models and diagrams (dual coding)

**Flagship purpose.** Pair each major idea with a visual: the interactive
cross-section, the differentiation stages, the convection figure.

**What Is Life.** Meets it. The "all made of cells" convergence diagram and the
comparison tables are strong dual-coded models.

**Opportunity.** None structural. Confirm every diagram has an accurate
`aria-label`.

**Priority: low (accessibility check only).**

---

### Misconception checkpoints

**Flagship purpose.** Directly confront the wrong idea a student is likely to
hold.

**What Is Life.** Exceeds the flagship. The fire / robot / seed non-examples and
the openly "Debated" virus card are textbook misconception work. Earth's Layers
is actually weaker here.

**Opportunity.** None. Copy this strength into other Tier C lessons.

**Priority: none (already a model for others).**

---

### Retrieval practice (Quick Recall)

**Flagship purpose.** Low-stakes, ungraded recall between explore and explain,
with immediate feedback.

**What Is Life.** Meets it, but lighter: one question versus the flagship's
three. Functional and correctly placed.

**Opportunity.** Optionally expand to two or three questions so the check spans
more than one idea. Not required.

**Priority: low (optional).**

---

### Wrap-up that answers the driving question

**Flagship purpose.** Consolidate the whole lesson into one coherent narrative
and answer the opening question head-on. Earth's Layers uses three causal beats
(heat, motion, surface) plus a chain-of-chips that shows the full arc.

**What Is Life.** Meets the "return to the question" half well with the "Back to
Viruses" section and the vote. It is weaker on the "consolidate the whole
lesson" half. It resolves the virus question but does not pull the full arc
(characteristics, cell theory, cell types) back into one synthesis before
closing.

**Opportunity.** Add a short synthesis beat before or alongside the virus
verdict: a two or three step recap of the arc (life is defined by six
characteristics, all life is cellular, cells come in two types, a virus has no
cell, therefore it fails). This is where the open-response prompt above should
live.

**Why it improves learning.** The wrap-up is where isolated facts become a
schema. Answering the narrow virus question without restating the framework
leaves the big picture implicit.

**Note on shape.** Earth's Layers is a causal chain, so its wrap-up is a chain.
What Is Life is a definitional / classification lesson, so its wrap-up should be
a criteria synthesis, not a forced cause-effect chain. Match the wrap-up shape
to the lesson's logic. Do not copy the chips literally.

**Priority: HIGH.**

---

### Quiz flow

**Flagship purpose.** Ten questions mixing DOK 1 and 2, practice and classroom
modes, answer explanations, and a score board that **restates the driving
question** (the "mystery loop") so the assessment closes the same loop the hero
opened.

**What Is Life.** Mostly meets it: ten questions, both modes, correct teachers
(Mr. Brown, Ms. Gay), explanations. The one clear gap is the **missing mystery
loop**: the score board shows a number and a message but never restates the
driving question or tells the student how to know they answered it. Earth's
Layers does exactly this in its score board.

**Opportunity.** Add a mystery-loop panel to the score board that restates the
virus driving question and names the evidence of having answered it.

**Why it improves learning.** Closing on the original question turns a score into
a sense of resolution and reinforces that the quiz measured the lesson's actual
purpose, not trivia.

**Priority: MEDIUM.**

---

### Connections

**Flagship purpose.** Reveal how related lessons fit together conceptually, never
as a progression tracker. Answer "what caused this," "what does this explain," or
"where does this lead."

**What Is Life.** Meets it. Cell Types, Body Systems, Biological Evolution, with
relationship-revealing copy.

**Opportunity.** None structural. Audit wording against the Connections
philosophy in CLAUDE.md.

**Priority: low (wording check only).**

---

### Educator Mode rationale

**Flagship purpose.** Hidden teacher-facing notes on every section explaining why
it exists, the learning science, the Bloom's/DOK level, and accessibility
choices. Invisible to students.

**What Is Life.** Meets it. Educator notes are present on every section and are
well written.

**Opportunity.** When new elements are added (open response, mystery loop, key
idea cards), add matching Educator notes so the rationale stays complete.

**Priority: low (keep in sync with new additions).**

---

### Gap summary table

| Element | Status in What Is Life | Priority to change |
|---|---|---|
| Student constructs an explanation | Missing entirely | **Critical** |
| Wrap-up consolidates full arc | Returns to question, no synthesis | **High** |
| Key Idea concept reveals | Inline bold only | Medium |
| Quiz mystery loop | Missing from score board | Medium |
| Quick Recall depth | One question | Low (optional) |
| Learning goal / connection / aria audits | Present, verify | Low |
| Driving question, phenomenon, prediction, vocab, misconceptions, dual coding, educator mode | Strong | Preserve |

---

## Part 2. The Repeatable Blueprint

### Elements that must ALWAYS be added or verified

Every Tier C conversion must end with all of these present, accurate, and in the
Standard Lesson Order:

1. **One student-constructed explanation.** At least one ungraded open-response
   prompt with a self-check model answer. This is the non-negotiable core of the
   whole HQIM phase. If a conversion adds nothing else, it adds this.
2. **A wrap-up that both answers the driving question and synthesizes the arc.**
   Not just a return to the question. A short recap of how the pieces fit.
3. **A quiz score board that restates the driving question** (the mystery loop).
4. **Prediction before the first major reveal**, gating the reveal.
5. **Key Idea cards for the two or three load-bearing terms**, at first real use,
   using the `KEY IDEA: [TERM]` label.
6. **Educator Mode notes on every section**, including any newly added ones.

### Existing strengths that must ALWAYS be preserved

Conversion is additive. Do not strip these when they are already present:

* The driving question and its exact wording.
* The anchoring phenomenon or sorting challenge, especially non-examples and
  debated cases. These are among the strongest features and should be imitated,
  not removed.
* Click-to-reveal glossary vocabulary, one card open at a time, with jump links.
* Dual-coded diagrams and comparison tables.
* Practice and Classroom quiz modes with the correct grade's teachers.
* The lesson's own voice, spacing, color, and card style. Match neighbors.

### Mistakes to avoid during conversion

* **Do not copy the flagship literally.** Earth's Layers is a causal chain; many
  Tier C lessons are definitional or comparative. Match the wrap-up and Key Idea
  shape to the lesson's own logic. Forcing a cause-effect chain onto a
  classification lesson makes it worse.
* **Do not mistake "already has sections" for "already HQIM."** What Is Life had
  every section and still lacked the critical open-response move. Audit for
  instructional depth, not section presence.
* **Do not let every check be multiple choice.** If clicking is the only verb the
  student uses, the lesson has not reached the standard.
* **Do not add teacher-facing language to student-visible navigation or labels.**
  Keep Educator rationale inside Educator Mode only.
* **Do not redesign, re-theme, or opportunistically clean up.** Preservation mode
  is in force. Add instruction; leave the design system alone.
* **Do not invent Connections relationships** to fill the section. Use the
  placeholder if the relationship is not yet designed.
* **Watch for em dashes** introduced in any new copy. Use a spaced hyphen.

### Required vs optional elements

**Required for a Tier C lesson to be flagship-complete:**

* Driving question, learning goals, vocabulary, prediction gate, anchoring
  Engage, at least one Key Idea reveal, Quick Recall, a synthesizing wrap-up that
  answers the driving question, one open-response sensemaking prompt, a ten
  question two-mode quiz with explanations and a mystery-loop score board, More
  Learning, Connections, and Educator notes throughout.

**Optional, add when the content earns it:**

* Additional Quick Recall questions beyond one.
* Multiple Key Idea cards beyond the two or three load-bearing terms.
* Interactive diagrams beyond a static labeled model.
* Extensions, investigations, simulations, and games (these belong to later
  build phases per Core Before Extensions).

### Recommended order of conversion

Work in this sequence per lesson so each step builds on a stable base:

1. **Read and map.** Identify the lesson's logic type (causal chain, definition,
   comparison, process) and its true driving question. The wrap-up and Key Idea
   shape follow from this.
2. **Confirm the preserved core.** Verify the driving question, phenomenon,
   vocabulary, and prediction gate are present and correct before adding anything.
3. **Add the Key Idea reveals** for the load-bearing terms in the Explore
   sections.
4. **Strengthen the wrap-up** into a synthesis that answers the driving question.
5. **Add the one open-response sensemaking prompt** with a self-check reveal.
   This is the priority step; do not skip it.
6. **Add the quiz mystery loop** to the score board.
7. **Backfill Educator Mode notes** for every element added in steps 3 to 6.
8. **Final audit.** Standard Lesson Order intact, sticky nav student-facing, no
   em dashes, aria labels present, teachers correct for the grade, Connections
   wording honest, verified in browser with no console errors.

A lesson is Tier C complete when every required element is present and accurate,
every preserved strength is intact, and the student is asked at least once to
explain an idea in their own words.
