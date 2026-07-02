# LYFELABZ HQIM LESSON FRAMEWORK

The instructional blueprint for every flagship lesson revision.

This document is written for the curriculum, not the code. It defines the
instructional elements a flagship LyfeLabz lesson must contain, the reasoning
behind each one, and whether it is required. It does not describe HTML, CSS, or
JavaScript. Implementation lives elsewhere (see the gold-standard lesson
`lesson_earths-layers.html` and `EDUCATOR_MODE_GUIDE.md`).

---

## Purpose

The public-facing build phase is complete. LyfeLabz now moves from "does the
lesson exist and work" to "does the lesson teach well." HQIM means High Quality
Instructional Materials. A lesson is high quality when a curious middle school
student can learn from it on their own, build an accurate mental model, and
revisit it later to study.

The HQIM audit mapped all fifty lessons against the flagship pattern and found
three structural tiers:

* **Tier A** carries the full flagship structure: an anchoring phenomenon, a
  prediction gate before the reveal, and a wrap-up that returns to the driving
  question.
* **Tier B** has the phenomenon but skips prediction and the closing wrap-up.
  This is the astronomy and geology-history cluster, which is the most
  misconception-dense content in the program.
* **Tier C** is the oldest skeleton with none of the three. Several of these
  still carry the old "gold standard" label but are structurally the furthest
  behind.

The gold standard is now **Earth's Layers**, not the older Grade 6 lessons named
in earlier documentation. Every revision converges on the Tier A pattern.

The single largest gap across all tiers is that checks for understanding are
almost entirely multiple choice. The framework's top priority is to add one
place per lesson where the student constructs an explanation in their own words.

---

## How to read this framework

Each element below is defined the same way:

* **Why it exists instructionally.** The instructional job it does.
* **Learning science.** The research idea that supports it.
* **How it improves understanding.** The change in the student.
* **Status.** Mandatory or optional, and when.

The elements are listed in the order a student meets them, which mirrors the
Standard Lesson Order already documented in the project instructions:

Hero, Learning Goals, Vocabulary, Engage, Explore, Quick Recall, Explain,
Evaluate, More Learning, Connections.

A lesson is flagship-complete when every mandatory element is present, accurate,
and in order.

---

## The Elements

### 1. Driving Question

**Why it exists.** A lesson needs one clear question that the whole lesson
exists to answer. It is stated early, lives in the hero, and is the thread the
student pulls from Engage to wrap-up. Without it, a lesson becomes a list of
facts with no destination.

**Learning science.** Problem-based and inquiry learning show that framing
content as a question to resolve creates a knowledge gap the learner wants to
close. Curiosity research (the information-gap effect) shows that a well-formed
question raises attention and retention before any content is delivered.

**How it improves understanding.** The student reads every section as evidence
toward an answer rather than as isolated information. It gives the lesson a
spine and gives the student a reason to keep going.

**Status.** Mandatory. Every flagship lesson states one driving question, in
student-facing language, near the top.

---

### 2. Anchoring Phenomenon

**Why it exists.** Abstract science becomes learnable when it is anchored to a
concrete, observable thing that is genuinely puzzling. The phenomenon is the
real event the driving question is about: the layered rock, the moon that
changes shape, the signal that survives noise. It is the "why does this happen"
that the science explains.

**Learning science.** This is the core move of the Next Generation science
model and of situated cognition: students figure out phenomena rather than learn
about topics. Concrete anchors also lower cognitive load at the entry point,
because the student reasons about something they can picture.

**How it improves understanding.** The phenomenon gives the abstract concept
something to attach to in memory. Later recall has a hook. The student is
explaining a real thing, not memorizing a definition.

**Status.** Mandatory for flagship. This is the defining Tier A feature and the
first thing to add when converting a Tier B or Tier C lesson.

---

### 3. Learning Goals

**Why it exists.** Students learn more when they know what they are aiming for.
Goals name the destination in plain, student-centered language and tie the
lesson to the standard it serves.

**Learning science.** Goal-setting and advance organizers prime the relevant
prior knowledge and give the learner a frame to file new information into.
Clarity of intended learning is one of the most consistent effects in the
teaching research.

**How it improves understanding.** The student can self-monitor. They know when
they have "got it" and what they are still missing, which supports the
metacognition that separates studying from re-reading.

**Status.** Mandatory. Use student-facing language. Avoid teacher terms like
"objectives," "targets," or "recall." Badge only the standards the lesson
actually teaches and assesses; supporting concepts may be taught without
claiming their badge.

---

### 4. Vocabulary

**Why it exists.** Science has a precise language. Students need the terms, but
front-loading definitions kills momentum. Vocabulary is offered as a
student-controlled reference the learner opens when they choose.

**Learning science.** Vocabulary learning is strongest when a term is met in
context and retrieved on demand rather than pre-taught as a list. Learner
control over pacing reduces extraneous load. The single-open, click-to-reveal
card is a deliberate self-explanation prompt: the student predicts the meaning
before revealing it.

**How it improves understanding.** Terms become tools for reasoning rather than
trivia. Because the card is a reference, students return to it while studying,
which is itself a retrieval event.

**Status.** Mandatory. Follow the vocabulary standard exactly: one card open at
a time, click to reveal (never hover), no helper text, chevron affordance,
opening line "Choose a card to see what each word means." Consistency here is
itself an accessibility feature.

---

### 5. Prediction Before Explanation

**Why it exists.** Before the lesson explains the phenomenon, the student
commits to a guess. The reveal is gated behind that commitment. This is the
single highest-leverage instructional move the audit found missing from Tier B
and Tier C.

**Learning science.** This is the pretesting or "guess first" effect. Attempting
an answer before instruction, even a wrong one, produces markedly better
retention of the correct answer than reading the explanation cold. It also
surfaces the student's current model so the correction can land on it.

**How it improves understanding.** A committed prediction turns the explanation
from information into feedback. The student now has a stake in whether they were
right, and the moment of surprise when a prediction fails is when a misconception
becomes visible and correctable.

**Status.** Mandatory for flagship, and the priority upgrade for Tier B, which
is misconception-dense astronomy and geology. The prediction must precede the
Key Idea reveal for the section it belongs to.

---

### 6. Productive Struggle

**Why it exists.** Understanding is built by the learner doing cognitive work,
not by receiving a polished explanation. Lessons should include moments where
the student wrestles with the idea before it resolves: a prediction to defend, a
model to assemble, a pattern to notice.

**Learning science.** Desirable difficulties and "struggle then tell"
sequencing show that effortful engagement before the answer deepens
understanding and transfer, even though it feels slower. The key word is
productive: the struggle must be within reach, scaffolded, and always resolved.

**How it improves understanding.** Effort at the point of learning is what
encodes it. A student who worked to reach an idea owns it in a way a student who
was handed it does not.

**Status.** Mandatory in spirit, flexible in form. Every flagship lesson should
have at least one genuine think-first moment. It must never become unproductive
struggle: no dead ends, no unresolved confusion, always a payoff.

---

### 7. Key Idea Reveal

**Why it exists.** After the student has predicted and wrestled, the lesson
delivers the concept cleanly and unambiguously. The Key Idea is the load-bearing
sentence of a section, marked so the student cannot miss it.

**Learning science.** Signaling and the segmenting principle from multimedia
learning: highlighting the essential idea and separating it from surrounding
detail reduces the load of deciding what matters. The reveal lands hardest right
after a prediction, when attention is highest.

**How it improves understanding.** The student leaves each section knowing the
one thing they were meant to take from it. It also gives the wrap-up and the
quiz a clear referent.

**Status.** Mandatory. Use the label "KEY IDEA: [term]" for explanatory cards
that define or explain. Reserve "NAME IT" only for when the student is literally
identifying, labeling, or classifying something.

---

### 8. Authored Scientific Model

**Why it exists.** Science explains with models: cause-and-effect chains,
diagrams, and mechanisms, not just facts. A flagship lesson gives the student a
clear, authored model of how the phenomenon works, so they leave with a
mechanism rather than a memorized outcome.

**Learning science.** Model-based reasoning and mechanistic explanation are
central to how experts understand science. Presenting causal structure, rather
than isolated facts, supports transfer to new situations because the student can
run the model forward on a new case.

**How it improves understanding.** The student can answer "what would happen
if" questions, not only "what is" questions. That is the difference between
knowing about a phenomenon and understanding it.

**Status.** Mandatory. Every flagship lesson presents at least one explicit
cause-and-effect model of its phenomenon. Favor models and mechanisms over
jargon, per the science standard.

---

### 9. Misconception Checkpoint

**Why it exists.** Students arrive with intuitive but wrong ideas: air is not
matter, the moon phase is Earth's shadow, digital is immune to noise. If a
lesson does not name and confront the specific misconception, the student often
files the correct idea alongside the wrong one and keeps both. This is
especially acute in astronomy, where the audit flagged the highest
misconception density.

**Learning science.** Conceptual change research shows that misconceptions are
resistant and must be directly confronted, not bypassed. The student needs to
see why the intuitive idea fails before they will replace it. This pairs
naturally with the prediction gate, which surfaces the misconception in the
first place.

**How it improves understanding.** The correct model displaces the wrong one
instead of coexisting with it. The student can articulate not just what is true
but why the tempting wrong answer is wrong.

**Status.** Mandatory where a well-known misconception exists (most flagship
lessons). Name the specific wrong idea and address it directly. Also audit
interactives for hidden misconceptions: for example, an upgrade-purchase framing
in an evolution game can imply directed adaptation and must be reframed.

---

### 10. Retrieval Practice (Quick Recall)

**Why it exists.** A short, low-stakes check partway through the lesson makes
the student pull the idea back out of memory before moving on. It is a
learning event, not an assessment. It sits between the last Explore section and
the Explain wrap-up.

**Learning science.** The testing effect is one of the most robust findings in
learning science: retrieving information strengthens memory far more than
re-reading it. Spacing the recall inside the lesson, before the final quiz,
adds a second exposure at a useful interval.

**How it improves understanding.** The student finds out what has actually
stuck while there is still time to reread. Immediate feedback on each item
corrects errors before they harden.

**Status.** Mandatory. Keep it short (a few items), immediate feedback,
correct-and-wrong paths both handled. Rate it at the DOK 1 to 2 recall floor;
it is not the formal assessment.

---

### 11. Student Explanation and Sensemaking

**Why it exists.** At some point the student must put the idea into their own
words: write a claim, assemble the cause-and-effect chain, explain the
phenomenon to someone else. Recognizing the right answer among four choices is
not the same as being able to construct it. This is the largest program-wide
gap the audit identified.

**Learning science.** The generation effect and self-explanation research show
that producing an explanation, rather than selecting one, forces the learner to
integrate the pieces and exposes gaps that multiple choice hides. It is the step
that converts recognition into understanding.

**How it improves understanding.** The student discovers whether they truly
understand the mechanism or only recognize its vocabulary. Constructing the
explanation is the moment the mental model is tested and completed.

**Status.** Mandatory, and the top HQIM priority. Add at least one
student-constructed explanation per lesson. It does not need to be graded; it
needs to require the student to generate, not select. This is the element most
lessons are currently missing.

---

### 12. Wrap-Up That Answers the Driving Question

**Why it exists.** The lesson opened with a question and a phenomenon. It must
close by explicitly returning to them and answering the question with the model
the student just built. An Explain wrap-up is the payoff that makes the lesson
feel like one argument rather than a series of parts.

**Learning science.** Elaboration and closure help the learner consolidate
scattered pieces into a single, connected structure. Returning to the opening
phenomenon creates a narrative loop, which is more memorable than a flat
sequence and gives the student a rehearsable summary.

**How it improves understanding.** The student leaves with a complete answer
they can state, and they see how each section contributed to it. Loose ends from
the Engage hook are tied off.

**Status.** Mandatory for flagship, and the second priority upgrade for Tier B,
which currently ends without it. The wrap-up must name the driving question and
answer it, not merely summarize.

---

### 13. Evaluate (Formal Quiz)

**Why it exists.** A final ten-question check lets the student and the teacher
confirm the learning. It is distinct in purpose from Quick Recall: this is
assessment, that was practice. Practice mode must also work independently of the
classroom submission flow.

**Learning science.** A cumulative retrieval event at the end of a lesson both
measures and further strengthens learning. Well-constructed distractors turn each
wrong option into diagnostic information about which model the student is holding.

**How it improves understanding.** Answer explanations turn the quiz itself into
a last round of feedback and teaching, not just scoring.

**Status.** Mandatory. Follow the quiz standard: ten questions by default (some
lessons intentionally have more, for example Body Systems has fifteen; Assessment
v2 posts one `qN` field per question and adjusts automatically), a mix of DOK 1
and DOK 2, plausible distractors, answer explanations, answer positions and
lengths balanced so the longest or most detailed option is not reliably correct.
Favor conceptual understanding over trivia. Use the existing classroom-mode
architecture; do not invent new submission systems.

---

### 14. Mastery-Oriented Quiz Flow

**Why it exists.** How the quiz behaves after submission carries an instructional
message. Full mastery flows the student forward to deeper learning; a partial
score keeps them in place to try again. Practice stays put; mastery moves on.

**Learning science.** Mastery-based progression and immediate, actionable
feedback support a growth stance: the goal is understanding, not a one-shot
grade. Letting a student retry without penalty encourages the second attempt
that actually cements the learning.

**How it improves understanding.** The student experiences the assessment as a
gate they can clear through effort, which sustains motivation, rather than a
verdict.

**Status.** Mandatory behavior, already standardized. On full mastery, surface
the result and then advance to More Learning; below full mastery, hold position;
Try Again resets cleanly and returns to the quiz. Reuse each lesson's own
destinations.

---

### 15. More Learning

**Why it exists.** A single lesson cannot hold every student's curiosity or
need. More Learning offers ways to go deeper into the same concept:
investigations, simulations, extensions, and games.

**Learning science.** Extension and enrichment support differentiation and
learner autonomy: the student who wants more can get it without holding back the
lesson, and self-directed depth increases engagement.

**How it improves understanding.** Optional depth lets motivated students build
richer models and lets struggling students stop at a complete, sufficient
understanding without penalty.

**Status.** Mandatory section, optional contents. It contains only
investigations, simulations, extensions, and games. It never contains
lesson-to-lesson navigation.

---

### 16. Connections

**Why it exists.** Science is one interconnected story, not a list of isolated
topics. Connections reveal how this lesson relates to others: what caused it,
what it explains, or where the idea leads. They are relationships to understand,
not a checklist or a required next step.

**Learning science.** Meaningful learning depends on integrating new knowledge
into an existing schema. Making cross-lesson relationships explicit helps the
student build the connected mental network that distinguishes deep understanding
from a pile of facts. Curiosity is renewed when a relationship is framed as
something worth understanding.

**How it improves understanding.** The student sees the curriculum as a web of
causes and explanations, which strengthens transfer and makes each lesson a home
base rather than a dead end.

**Status.** Mandatory section, even when relationships are not yet designed, in
which case use the standard "Related lessons coming soon" placeholder. Cards
contain only lessons, never investigations or games. Every real card must reveal
a genuine scientific relationship a curious student would want to click. Do not
invent relationships to fill space, and never phrase them as "next lesson" or
"you might also like."

---

### 17. Educator Mode Rationale

**Why it exists.** A high quality lesson can explain not only the science to the
student but also its own instructional design to the teacher. Educator Mode adds
hidden, teacher-facing notes at the end of each section explaining why the
section is built the way it is: its purpose, the cognitive science behind it, its
Bloom and DOK level, and its accessibility considerations. It is hidden from
students by default.

**Learning science.** Making instructional design visible supports teacher
enactment and fidelity. Teachers who understand the intent of a move deliver it
better and adapt it well; naming the DOK and cognitive-science basis keeps the
design honest and auditable.

**How it improves understanding.** Indirectly but powerfully: it protects the
instructional intent of every other element on this list from drifting over
time, and it makes the framework self-documenting inside each lesson.

**Status.** Mandatory for flagship, one note per section. Rate Bloom and DOK
conservatively; avoid DOK inflation and copy-paste notes. The reusable pattern
lives in `EDUCATOR_MODE_GUIDE.md`; the model lesson is `lesson_earths-layers.html`.

---

# 🧠 Show Your Thinking

Show Your Thinking is a required flagship instructional element. It is the final
instructional step of every flagship LyfeLabz lesson, and it sits inside the
close of the lesson in this exact order:

Quick Recall

↓

10 Question Quiz

↓

🧠 Show Your Thinking

↓

Submit

It is **not** "Question 11." It is not one more item on the quiz. It is the
culmination of the lesson: the moment where the student steps back from
recognizing answers and instead synthesizes and communicates the lesson's
central scientific idea in their own words before submitting their work.

---

### Instructional Purpose

Students should construct an explanation rather than only recognize correct
answers. A ten-question quiz can confirm that a student can pick the right option
among four. It cannot confirm that the student can organize the pieces into a
coherent scientific explanation on their own.

The lesson should end with the student organizing ideas into a single, coherent
scientific explanation. That act of assembling the idea, rather than selecting
it, provides evidence of conceptual understanding rather than simple recognition.

---

### Learning Science

Show Your Thinking draws on several well-supported ideas about how understanding
is built and retained:

* **Retrieval plus generation.** The student both pulls the idea back out of
  memory and produces new language for it, which is stronger than retrieval or
  reading alone.
* **Elaboration.** Explaining an idea in the student's own words connects it to
  what they already know and deepens the trace in memory.
* **Organization of knowledge.** Constructing an explanation forces the student
  to structure scattered facts into a connected whole rather than a list.
* **Explanation improves long-term retention.** Producing an explanation, not
  just recognizing one, is associated with more durable learning.
* **Transfer of learning.** A student who can articulate the mechanism is better
  positioned to apply it to a new situation.

No formal citations are necessary unless appropriate.

---

### Student Experience

Every lesson should conclude with the same recognizable routine, so students
learn to expect and rely on it:

> 🧠 Show Your Thinking
>
> Scientists don't just know the answer.
> They explain their thinking.
>
> Use what you learned in this lesson to explain the main scientific idea.

This routine should become part of the LyfeLabz instructional identity. Students
should come to recognize it across every flagship lesson as the signal that they
are being asked to think, not just to answer.

---

### Approved Formats

Show Your Thinking is standardized into three approved formats. Choose the one
that best fits the lesson.

**1. Explain in One Sentence**

The student writes a single clear sentence stating the lesson's central idea.
Best for conceptual lessons where the goal is a crisp, well-formed statement of
the main idea.

**2. Build the Explanation**

The student arranges statements, evidence, or cause-and-effect relationships into
the correct explanation. This should become the preferred format whenever
appropriate, because it measures scientific reasoning while remaining accessible
for middle school students. It asks the student to construct the logic of the
explanation without requiring extended writing.

**3. Mini CER**

A very brief Claim, Evidence, Reasoning response. Use this only when a lesson
naturally lends itself to scientific argumentation, where the student can make a
claim, cite evidence from the lesson, and reason from one to the other.

---

### Design Principles

Show Your Thinking follows these rules in every flagship lesson:

* It is **not graded separately** from the lesson.
* It is **collected as part of the normal lesson submission**. The response is
  sent in the `thinking` field of the Assessment v2 payload and lands in the
  final "🧠 Show Your Thinking" column of the lesson's tab. See
  `docs/components/submission-system.md` and `LyfeLabz_GScript_v2.js`.
* It **appears immediately before Submit**.
* It **focuses on the lesson's central idea or driving question**.
* It **never asks for isolated vocabulary definitions or trivial recall**.
* It **synthesizes the lesson** rather than introducing new content.

---

### Implementation Philosophy

The ten-question quiz and Show Your Thinking measure different things, and the
lesson needs both.

The ten-question quiz primarily measures recognition and application of the key
concepts. It confirms the student can identify and apply what the lesson taught.

Show Your Thinking measures the student's ability to organize and communicate
their scientific understanding. It confirms the student can build the explanation,
not just recognize it.

Together they provide a more complete picture of student learning than either can
provide alone.

---

## The Flagship Checklist

A lesson is flagship-complete when all of the following are present, accurate,
and in order:

1. Driving question stated in the hero.
2. Anchoring phenomenon the question is about.
3. Learning goals in student language, honestly badged.
4. Vocabulary as a single-open, click-to-reveal reference.
5. A prediction gate before the Key Idea reveal.
6. At least one productive-struggle moment, always resolved.
7. A clearly signaled Key Idea in each teaching section.
8. An authored cause-and-effect model of the phenomenon.
9. A misconception checkpoint where a known misconception exists.
10. A Quick Recall retrieval check before the wrap-up.
11. At least one student-constructed explanation.
12. An Explain wrap-up that answers the driving question.
13. A ten-question Evaluate quiz with explanations and balanced options.
14. The standardized mastery-oriented quiz flow.
15. A 🧠 Show Your Thinking synthesis step, immediately before Submit, using one
    of the three approved formats.
16. A More Learning section (extensions optional).
17. A Connections section (placeholder acceptable).
18. Educator Mode notes, one per section, conservatively rated.

---

## Priority Order for Revisions

The audit sets the sequence for bringing lessons to flagship standard:

1. **The universal gap first.** Add one student-constructed explanation to every
   lesson. This is the highest-value single change across the whole program.
2. **Tier C conversions.** The oldest skeletons need the phenomenon, prediction
   gate, and wrap-up added. Recommended first target: `what-is-life`.
3. **Tier B upgrades.** The astronomy and geology cluster has the phenomenon but
   needs prediction-before-reveal and an Explain wrap-up. Prioritize because it
   is the most misconception-dense content in the program.
4. **Tier A refinement.** Verify misconception checkpoints and audit interactives
   for hidden misconceptions (for example, directed-adaptation framing in
   evolution games).

---

## Governing Principles

These constrain every revision and override novelty:

* The gold standard is `lesson_earths-layers.html`. When in doubt, imitate it.
* Preservation mode. Fix and strengthen; do not redesign a working lesson
  without an explicit instruction.
* Standards drive the curriculum. Teach supporting concepts liberally; badge
  conservatively.
* Student-facing voice everywhere. Explore, More, Connections, Key Idea. Never
  Goals, Recall, or Learning Targets in student-visible surfaces.
* Consistency over cleverness. The best lesson is not the one with the most
  features; it is the one students can successfully learn from.
* Verify every change and report exactly what changed. Do not claim verification
  that was not performed.

---

## What This Framework Is Not

It is not a redesign mandate. Most lessons already contain most of these
elements. The framework names them so revisions are deliberate and so no lesson
quietly drifts below the flagship bar. It is a standard to converge on, one
lesson at a time, verified individually, in the priority order above.
