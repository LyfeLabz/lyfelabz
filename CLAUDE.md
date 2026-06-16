# LYFELABZ CLAUDE.md

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

# STYLE

No em dashes.

Prefer short paragraphs.

Match existing LyfeLabz spacing, colors, typography, cards, and interactions.

Do not introduce new design systems.

When editing, imitate neighboring lessons.

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

# VOCABULARY RULES

Use collapsible vocabulary cards.

Only one card open at a time.

Use right-aligned:

▾ closed

▴ open

No "Click or tap" text.

No "In this lesson" text.

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

# ACCESSIBILITY

Responsive design required.

Large click targets.

Short paragraphs.

High contrast.

Mobile friendly.

Avoid information overload.

One vocabulary card open at a time.

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

# PHILOSOPHY

Standards drive curriculum.

Slide decks are source material, not the curriculum.

Preserve creativity.

Favor consistency over novelty.

Build slowly.

Avoid unnecessary complexity.

The best lesson is not the one with the most features.

The best lesson is the one students can successfully learn from.
