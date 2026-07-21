# LYFELABZ CLAUDE.md

# LESSON BUILD ARCHITECTURE

Sprint 18 introduced a deterministic lesson build system. One canonical
instructional source produces two generated delivery outputs.

Applies today to: Earth's Layers only. Do not extend to other lessons
without an explicit sprint direction.

## Canonical source

Canonical lesson sources live under `lesson-sources/`. This directory
is excluded from Firebase Hosting via `hosting.ignore` and is never
served. It is not a public URL, has no canonical link, and is not
listed in the sitemap.

Direct edits to canonical sources are the only instructional edits
that propagate to both v1 and v2. Every instructional change goes
through the source.

## Generated artifacts

* v1 public artifact: `lesson_<slug>.html` at the repo root. Preserves
  the current public URL. Retains Practice/Classroom toggle, student
  info form, teacher/block selectors, legacy Apps Script submission
  path, and every existing v1 behavior.
* v2 authenticated artifact: `app/lessons/lesson_<slug>.html`. Contains
  no legacy classroom architecture. Consumes identity and assignment
  context only from the authenticated platform and the certified
  assessment runtime.

Every artifact begins with a `<!-- GENERATED FILE. -->` notice
immediately after the doctype. Direct edits to generated artifacts are
prohibited and are caught by `lessons:verify` in CI.

## Marker grammar (context-strict)

HTML top level:

```
<!-- LYFELABZ:V1-ONLY:BEGIN label -->
<!-- LYFELABZ:V1-ONLY:END label -->
```

Inside `<script>` blocks:

```
/* LYFELABZ:V1-ONLY:BEGIN label */
/* LYFELABZ:V1-ONLY:END label */
```

Inside `<style>` blocks: same as `<script>` (block-comment grammar).

Equivalent `V2-ONLY` markers exist. Markers must occupy standalone
lines with only leading/trailing whitespace. The scanner rejects:

* wrong marker syntax for context
* nested regions
* overlapping regions
* cross-context regions
* duplicate labels
* undeclared labels (unknown labels)
* unbalanced markers
* mismatched labels
* mismatched targets
* markers found inside JS strings, template literals, or regex literals
* HTML-style comments inside `<script>` or `<style>`

## Declarative lesson config

Every configured lesson lives at
`app/scripts/lessonBuilder/lessons/<slug>.cjs` and declares its paths,
required labels, expected contexts, required signatures, prohibited
signatures, shared signatures, generated notice text, and
instructional-equivalence exclusions. The builder engine is generic;
no lesson identity leaks into the engine.

## Build + verify

* `npm --prefix app run lessons:build` builds every configured lesson
  (both targets) into their committed artifact paths, atomically via a
  PID-suffixed tmp sibling.
* `npm --prefix app run lessons:verify` rebuilds every configured
  lesson in memory and compares to the committed artifact. It writes
  nothing. Fails fast on any drift.
* `lessons:verify` is part of the app validation chain
  (`npm --prefix app run verify`).

## Instructional-equivalence contract

Every build compares a normalized instructional contract between v1
and v2 outputs. Compared fields: titles, headings, learning goals,
vocabulary (every glossary-card: order, term, definition,
aria-expanded, aria-label, role, id, sorted classList), image and
SVG accessibility, Show Your Thinking, quiz questions, option
ordering, correct-answer indices, explanations, scoring messages,
More Learning (every cont-card: order, tag, href, aria-label, name,
description, category, status, sorted classList), Connections (same
per-card shape), key interactive IDs, scroll targets and scroll
destinations (each `.scrollIntoView` call as
`{function, target, kind}`, with variable-bound receivers resolved
back to their `getElementById` id or `querySelector` href), runtime
include, and lesson-quiz call sites.

Lesson-specific minimums (e.g. the Earth's Layers pilot's expected
vocabulary, Connections, and scroll-target counts) live in the
lesson's config file under `pilotContractMinimums`, not in the
generic engine.

Only explicitly declared delivery differences (per
`equivalenceExclusions` in the lesson config) are excluded from the
contract.

## Launcher

The Sprint 17 launcher URL contract is `/lesson_<slug>.html?assignment=<id>`.
Sprint 18 introduced a narrow data-driven override at
`app/src/assignments/studentList/launchOverrides.ts`. Slugs present in
the override table launch to the override path (e.g. Earth's Layers
launches to `/app/lessons/lesson_earths-layers.html`). Every non-listed
slug launches to the v1 URL byte-for-byte identical to Sprint 17.

Add a slug to the override table only after that lesson's v2 artifact
has passed the full build, legacy-absence, instructional-equivalence,
and runtime-integration checks.

---

# PRESERVATION MODE

The repository is in preservation mode.

Allowed changes:

* bugs
* scientific inaccuracies
* broken links
* engagement improvements
* accessibility improvements
* consistency repairs

Do not redesign existing lessons unless explicitly requested.

No opportunistic cleanup.

---

# REPOSITORY HARDENING RULE

During the Repository Hardening phase, consistency takes priority over introducing new features. Prefer repository-wide patterns over one-off fixes, preserve instructional behavior, and defer feature development until hardening is complete.

---

# REPOSITORY HARDENING PASS 5 (REPOSITORY CLEANUP & DEPLOYMENT READINESS)

## Final SVG Accessibility Review

During Repository Hardening Pass 3, any SVG lacking explicit accessibility attributes was conservatively marked as decorative using:

`aria-hidden="true"`

This was the correct repository-wide hardening decision because it avoided inventing instructional descriptions during a mechanical accessibility sweep.

During Repository Hardening Pass 5, perform one final content-level accessibility review of those SVGs.

Determine whether any SVG currently marked as decorative actually conveys meaningful scientific or engineering information.

For each SVG reviewed:

- If it is purely decorative, retain `aria-hidden="true"`.

- If it communicates instructional content, replace the decorative designation with:

  - `role="img"`

  - a concise educational `aria-label`

Descriptions should:

- explain only the instructional purpose of the graphic

- avoid describing artistic style or appearance

- remain concise and objective

This review should be treated as editorial verification rather than a repository-wide mechanical accessibility change.

The final Pass 5 report should include:

- total SVGs reviewed

- decorative SVGs retained

- instructional SVGs upgraded

- files modified

- representative examples

This review should be completed before Repository Hardening is declared complete and before the repository is considered deployment-ready.

---

# CANONICAL LESSON ARCHITECTURE RULE

Every instructional lesson should implement the complete canonical lesson architecture unless there is a documented pedagogical reason for an intentional exception.

Repository Hardening assumes lesson architecture is complete and standardizes implementation rather than adding missing instructional components.

When architectural differences are discovered during Repository Hardening, they should be documented and deferred to a Canonical Lesson Architecture phase unless they are simple implementation inconsistencies.

---

# CANONICAL ARCHITECTURE CLARIFICATION

Canonical lesson architecture is defined by educational function rather than identical implementation.

A lesson does not need to use identical HTML components if it already accomplishes the same instructional purpose through a well-designed, intentional structure.

Repository consistency should preserve effective instructional design whenever possible rather than forcing identical implementations.

During future hardening work, architectural equivalence should be preferred over unnecessary structural rewrites.

---

# MORE LEARNING EDITORIAL STANDARD

The More Learning introduction should briefly preview the scientific ideas students are about to explore rather than serving as generic transition text.

When appropriate, naturally introduce two to three meaningful scientific concepts drawn directly from the linked learning experiences.

Use the existing gold emphasis through the canonical implementation:

```css
.continue-intro strong {
    color: var(--gold);
}
```

Preserve lesson tone.

Avoid emphasizing verbs.

Avoid emphasizing navigation language.

Avoid emphasizing generic boilerplate.

Encourage curiosity and exploration rather than simply announcing additional resources.

---

# REPOSITORY STATUS

The instructional architecture of LyfeLabz is considered complete.

Repository Hardening Passes 0 through 2 established the canonical instructional architecture, canonical visual language, editorial standards, and repository-wide implementation patterns.

Future repository work should assume these standards unless a deliberate repository-wide decision is made to evolve them.

Individual lessons should not introduce new instructional components, visual patterns, or architectural variations without a documented repository-level reason.

Preserve existing canonical implementations whenever possible.

Favor repository-wide consistency over one-off improvements.

---

# STYLE

No em dashes.

Prefer short paragraphs.

Match existing LyfeLabz spacing, colors, typography, cards, and interactions.

Do not introduce new design systems.

When editing, imitate neighboring lessons.

---

# STUDENT LANGUAGE

Throughout LyfeLabz, prefer language that speaks directly to students.

Avoid teacher-facing terminology whenever a student-centered alternative exists.

Good:

* Explore
* More
* Connections

Avoid:

* Goals
* Recall
* 5Ws
* Learning Targets

This is the canonical voice standard. Navigation, section labels, and homepage cards all defer to it.

---

# COPY STANDARD: CONCEPT CARD LABELS

For explanatory concept cards, use `KEY IDEA: [TERM]` instead of `NAME IT: [TERM]`.

Explanatory cards define or explain a concept; they do not ask students to do anything.

Use `NAME IT` only when students are literally identifying, labeling, classifying, or naming something.

---

# GOLD STANDARDS

Grade 6 lesson structure:

* What Is Life
* Nature of Waves
* Wave Behavior
* Digital Signals

Grade 7 lesson structure:

* Earth's Layers

Future Grade 7 lessons should imitate Earth's Layers.

---

# CORE BEFORE EXTENSIONS

Build in this order:

1. Core lesson
2. Refinement
3. Investigations
4. Simulations
5. Games
6. Extensions

Do not add games, investigations, simulations, or extensions during initial lesson construction.

---

# STANDARD LESSON ORDER

1. Hero
2. Learning Goals
3. Vocabulary
4. Engage
5. Explore
6. Quick Recall
7. Explain
8. Evaluate
9. Go Further

Keep this order unless explicitly instructed otherwise.

---

# STANDARDS PRESENTATION

Standards are never displayed as standalone banners.

All instructional page types use the canonical beneath-hero implementation. The required block is:

* Learning Science Focus (`.ls-focus`)

This applies to every instructional page type, including:

* Lessons
* Investigations
* Extensions
* Simulations
* Engineering Challenges
* Hidden World pages
* Games
* Any future instructional page type

## MA STE Standards (`.stem-focus`)

`.stem-focus` is an additional, optional beneath-hero block. It currently appears on supporting page types (investigations, simulations, games, systems, diseases, extensions) and may remain there.

`.stem-focus` is intentionally NOT present on the 50 core lessons, which remain `.ls-focus`-only. Do not migrate `.stem-focus` into lessons during Repository Hardening. It would only become universal if we later make a deliberate decision to standardize it across every lesson.

Do not introduce new standards presentation styles.

The canonical beneath-hero implementation is now the permanent LyfeLabz standard.

---

# STICKY NAVIGATION

The sticky navigation is a student quick-return menu, not a table of contents.

Its purpose is to help students quickly return to the parts of a lesson they are most likely to revisit while learning or studying.

Use student-facing language only. See STUDENT LANGUAGE.

Do not expose teacher-facing instructional terminology.

Never include navigation items such as:

* Goals
* Recall
* Review Previous Learning
* 5Ws
* Learning Targets
* Individual Explore subsections

The standard sticky navigation order is:

* Vocab
* Explore
* Quiz
* More
* Connections

The Explore link always points to the lesson's first true Explore-phase section.

---

# LESSON ENDING STANDARD

Every lesson ends with:

1. Quiz
2. More Learning
3. Connections

Maintain this order consistently.

This formalizes the closing of a lesson. The earlier "Go Further" stage is now expressed as More Learning followed by Connections.

---

# MORE LEARNING

Purpose:

Help students go deeper into the current lesson.

Contains only:

* Investigations
* Simulations
* Extensions
* Games

Never place lesson-to-lesson navigation inside More Learning.

---

# CONNECTIONS

Purpose:

Help students discover conceptually related lessons.

Connections are not:

* a checklist
* a progression tracker
* "Next Lesson"
* "Previous Lesson"

They simply reveal how scientific ideas relate.

Connections contain only lesson cards.

Never include investigations, simulations, extensions, or games.

## Placeholder Connections

Every lesson should include a Connections section.

If curriculum relationships have not yet been designed, include the standard placeholder.

Placeholder title:

**Related lessons coming soon.**

Do not invent curriculum relationships simply to populate the section.

The architecture should exist before the relationships are defined.

## Connections Philosophy

Connections exist to reveal relationships, not provide navigation.

A Connections card should help students understand how scientific ideas fit together.

The purpose is not to say:

* Learn more about...
* Continue with...
* Next lesson...
* You might also like...

Instead, every Connections card should answer one of these questions:

### 1. What caused this?

Show how an earlier scientific idea leads naturally to the current lesson.

Example:

> Continental Drift introduced the evidence.
> Plate Tectonics explains the mechanism.

### 2. What does this explain?

Show how another lesson helps explain something students just learned.

Example:

> Plate Tectonics explains why Wegener's observations were correct.

### 3. Where does this idea lead?

Show how today's lesson becomes the foundation for a larger scientific concept.

Example:

> Reproductive success provides the mechanism that allows natural selection to occur.

## Writing Principles

Connections should create curiosity.

Students should finish reading a Connections card thinking:

> "I want to understand that."

Avoid generic wording such as:

* Learn more about...
* Continue with...
* Next, study...
* Explore this topic...

Instead, reveal the scientific relationship between the two lessons.

Connections should strengthen the student's mental model of science as one interconnected story rather than a sequence of isolated lessons.

A lesson is the student's home base.

Connections invite exploration and always provide an easy path back to that home base.

They should never function as a checklist or imply a required progression.

When writing a new Connections card, ask:

* Does this reveal a meaningful scientific relationship?
* Would a curious middle school student naturally want to click it?
* Does this strengthen the overall narrative of the curriculum?

If the answer is no, rewrite the card until it does.

---

# VOCABULARY RULES

Use collapsible vocabulary cards.

Only one card open at a time.

Use right-aligned:

▾ closed

▴ open

No "Click or tap" text.

No "In this lesson" text.

## Vocabulary Standards

Vocabulary sections should be visually and behaviorally identical across LyfeLabz unless there is a clear instructional reason to differ.

This is the canonical standard for all current and future lessons.

### Section Introduction

Every vocabulary section should begin with exactly:

> Choose a card to see what each word means.

Do not create alternate phrasings.

### Vocabulary Cards

Vocabulary cards should not include instructional helper text such as:

* Click to reveal
* Click or tap to reveal
* Tap to reveal
* Click for definition
* or similar wording.

The interaction should be communicated entirely through the component itself:

* button styling
* hover/focus states
* chevron indicator
* reveal animation

Avoid redundant instructional text.

### Interaction

Vocabulary cards should:

* open and close on click/tap
* support keyboard navigation
* update `aria-expanded`
* allow only one card to be open at a time
* use the standard LyfeLabz chevron affordance

Do not create alternate vocabulary card implementations unless there is a compelling instructional need.

---

# QUIZ RULES

Use 10 questions.

Mix DOK 1 and DOK 2.

Provide answer explanations.

Use existing classroom mode architecture.

Do not invent new submission systems.

Practice mode must work independently.

Avoid longest-answer bias.

Correct answers should vary in length.

Avoid making the most detailed answer the correct answer repeatedly.

Distribute answer positions (A, B, C, D) evenly.

Use plausible distractors.

Avoid "all of the above" and "none of the above" unless necessary.

Favor conceptual understanding over trivia.

---

# GRADE 6 CLASSROOM MODE

Teachers:

* Mr. Brown
* Ms. Gay

Blocks:

A-G

Require:

* student name
* teacher
* block

before submission.

---

# GRADE 7 CLASSROOM MODE

Teachers:

* Mr. Kankel
* Mr. Rovner

Blocks:

A-G

Require:

* student name
* teacher
* block

before submission.

---

# FILE NAMING

Use:

lesson_
game_
extension_
investigation_
simulation_

Do not mass rename existing files.

If a true cross-grade collision occurs:

{type}_g{grade}_{topic}.html

Examples:

lesson_g7_earths-layers.html

lesson_g8_earths-layers.html

Avoid unnecessary renaming.

Use `g{grade}` (for example `g7`), never a bare number, so it is not read as a lesson number.

## Safe-rename checklist

A rename only happens as a deliberate, redirect-backed change. This is a flat static
site on GitHub Pages (custom domain via CNAME) with no server-side redirects, so a
renamed file 404s its old public URL unless a stub is left behind. When a rename is
warranted, update all of:

1. The file's own `<link rel="canonical">`.
2. Its entry in `sitemap.xml`.
3. Every inbound link (index.html catalog, sibling Go Further / continue cards, nav).
4. A meta-refresh stub left at the old filename to redirect the old URL.

---

# INDEX RULES

Do not edit index.html during lesson construction.

Add cards only after a complete unit is built.

Update index in batches.

Lessons should be built so they can later be surfaced through:

* All
* Grade 6
* Grade 7
* Grade 8

without structural changes.

---

# HOMEPAGE LESSON CARDS

Lesson cards should communicate the lesson's central scientific question or purpose, not simply list vocabulary.

Ask:

> What scientific question will this lesson help students answer?

Avoid vocabulary lists whenever possible.

Within a conceptual narrative, neighboring lesson cards should communicate clearly different purposes.

---

# SCIENCE

Use only:

* Massachusetts 2016 STE Framework
* source slide decks

Slide decks are source material, not the curriculum.

Remove:

* Grade 6 leftovers
* Grade 8 content
* high school details
* COVID filler

Prioritize conceptual understanding.

Avoid unnecessary jargon.

Prefer models and cause-and-effect explanations.

---

# SUPPORTING CONCEPT PRINCIPLE

Standards drive the curriculum.

However, supporting concepts needed to understand a standard are not prohibited simply because they formally appear in another grade.

Students often require ideas that lie outside the exact wording of the performance expectation in order to understand the phenomenon being studied.

Examples:

* Moon phases require understanding rotation, revolution, and orbital motion.
* Eclipses require understanding relative positions and gravity.
* Chemical reactions may require qualitative discussion of atoms rearranging.
* Electricity may reference magnetic and gravitational fields.
* Earth systems may require concepts that extend beyond the exact wording of the standard.

## Teach liberally.

Lessons may include supporting concepts beyond the exact wording of the performance expectation when those concepts are necessary for conceptual understanding.

## Badge conservatively.

Badges should represent only the standards whose performance expectations are intentionally addressed and assessed.

Mentioning a concept does not mean a lesson claims mastery of that standard.

Supporting content is not curriculum contamination.

Curriculum contamination occurs only when:

* a lesson intentionally teaches and assesses another grade's performance expectation, or
* a lesson claims another grade's badge.

Judge lessons by what students are expected to demonstrate, not by every idea mentioned.

Avoid removing useful scaffolding simply because it appears elsewhere in the framework.

---

# ACCESSIBILITY

Responsive design required.

Large click targets.

Short paragraphs.

High contrast.

Mobile friendly.

Avoid information overload.

One vocabulary card open at a time.

---

# CANONICAL RESPONSIVE BREAKPOINTS

Repository Hardening Pass 4 established a shared vocabulary for future mobile work.

Three canonical breakpoints:

* 480px, single-column phone
* 720px, tablet portrait and split-screen Chromebook
* 960px, tablet landscape and small laptop

Two supporting queries:

* `@media (pointer: coarse)`, touch-target minimums
* `@media (orientation: landscape) and (max-width: 950px)`, notch-clearing padding on iPhone landscape

Existing per-lesson breakpoints (380, 540, 600, 640, 700, 720, 760, 860) are preserved.

Do not rewrite the repository to converge on the canonical breakpoints.

New responsive rules should adopt the canonical values. Existing rules migrate gradually during unrelated future edits.

---

# CANONICAL MOBILE STYLESHEET

Every page in the repository loads a shared `<style id="mobile-canonical">` block immediately after `<style id="a11y-canonical">`.

This block owns:

* safe-area padding for notched devices
* touch-target minimums on coarse-pointer devices
* tap-highlight normalization
* the `.table-scroll` utility for wide tables
* sticky quiz progress offset behavior

Do not add page-specific mobile rules that duplicate canonical behavior.

If new mobile behavior needs to apply repository-wide, extend the canonical block rather than adding one-off implementations.

---

# GRADE 7 ARCHITECTURE

Theme:

Systems and Cycles

Unit order:

1. Earth Systems
2. Water Systems
3. Human Impacts
4. Ecosystems
5. Ecosystem Stability
6. Energy Systems
7. Engineering Systems

Build lessons before extensions.

---

# QUALITY CONTROL

After every change:

Verify in browser.

Check console errors.

Test interactions.

Confirm responsive behavior.

Search for em dashes.

Report exactly what changed.

Do not claim verification that was not performed.

---

# NARRATIVE PHILOSOPHY

LyfeLabz is organized around conceptual narratives, not traditional units.

Lessons are the home base.

Narratives connect related scientific ideas.

Connections should encourage students to:

* revisit ideas
* connect concepts
* explore related lessons

without creating a sense of required progression.

Bridge connections are encouraged when they naturally connect two conceptual narratives.

Bridge connections should never receive separate headings or visual treatment.

Students should experience a connected curriculum without being aware of any special distinction.

---

# PHILOSOPHY

Standards drive curriculum.

Slide decks are source material, not the curriculum.

Preserve creativity.

Favor consistency over novelty.

Build slowly.

Avoid unnecessary complexity.

The best lesson is not the one with the most features.

The best lesson is the one students can successfully learn from.
