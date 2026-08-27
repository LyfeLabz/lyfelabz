# LYFELABZ CLAUDE.md

Governing rules for LyfeLabz development. These instructions override default
behavior. Content standards live here; current platform architecture is routed
(see START HERE).

---

# START HERE (context routing)

For current platform architecture, begin with
`docs/platform/CURRENT_PLATFORM_STATE.md`. It defines the currently certified
state and routes to the canonical subsystem docs (identity, security rules,
LMS/Classroom, deep links, assessment, data model). Do not reconstruct current
architecture by reading `SPRINT_*` history.

Read historical `SPRINT_*` / certification docs only for: rationale,
certification evidence, regression investigation, conflict resolution, or
previously tested behavior.

Working policy (efficiency never overrides correctness):

1. Start with files named in the task.
2. Search (`rg`) before opening more files; read targeted line ranges of large
   files rather than whole 2k–4k-line files.
3. Expand context only when evidence or architecture requires it.
4. Do not reread unchanged files without a concrete reason.
5. Prefer compact command output: `git status --short`; `git --no-pager diff
   --stat` before a targeted `git --no-pager diff -- <path>`; `git --no-pager
   log --oneline -n 20`.
6. Report passing tests as compact counts/suites; retain complete failure
   output (names, diffs, stack, exit codes). Do not dump green output.
7. For architecture/security work (auth, rules, OAuth, deep links, publication,
   scoring), read the full relevant contract; correctness beats token savings.

---

# REPOSITORY GOVERNANCE

**Commits.** Do not auto-commit. The user performs all Git commits. Do not push
or deploy unless explicitly asked.

**Preservation mode.** The instructional architecture is considered complete.
Allowed changes: bug fixes, scientific-accuracy fixes, broken links, engagement
improvements, accessibility improvements, consistency repairs. Do not redesign
existing lessons unless explicitly requested. No opportunistic or unrelated
cleanup.

**Consistency over novelty.** Prefer repository-wide patterns over one-off
fixes. During hardening, consistency takes priority over new features; defer
feature development until hardening is complete. Individual lessons do not
introduce new instructional components, visual patterns, or architectural
variations without a documented repository-level reason. Preserve existing
canonical implementations; do not introduce new design systems.

**Canonical lesson architecture.** Every instructional lesson should implement
the complete canonical lesson architecture unless there is a documented
pedagogical reason for an intentional exception. Architecture is defined by
educational function, not identical HTML. A well-designed intentional structure
that accomplishes the same instructional purpose is acceptable; prefer
architectural equivalence over unnecessary structural rewrites. Document
discovered architectural differences and defer them rather than forcing
rewrites.

**Operating discipline.** Investigate before changing architecture. Do not
silently weaken tests. Do not casually replace repository conventions. Treat
security-sensitive behavior carefully and use current canonical docs for
architecture. Standards drive curriculum; slide decks are source material, not
the curriculum. Build slowly; favor maintainability. The best lesson is the one
students can successfully learn from, not the one with the most features.

---

# STYLE

- **No em dashes** anywhere. Use a spaced hyphen (` - `). This is the single
  authoritative statement of the rule; other sections reference it.
- Short paragraphs.
- Match existing LyfeLabz spacing, colors, typography, cards, and interactions.
- When editing, imitate neighboring lessons. Do not introduce new design
  systems.

---

# LESSON BUILD ARCHITECTURE

A deterministic build turns one canonical instructional source into two
generated delivery outputs. Applies today only to lessons with a config under
`app/scripts/lessonBuilder/lessons/`; do not extend it without explicit sprint
direction.

Non-negotiable invariants:

- **Edit the canonical source in `lesson-sources/`, never the generated
  artifacts.** Every instructional change goes through the source so both
  outputs regenerate. `lesson-sources/` is never served (excluded from Hosting,
  not in the sitemap).
- Two generated outputs: **v1 public** `lesson_<slug>.html` at the repo root
  (preserves the public URL and all legacy v1/classroom behavior); **v2
  authenticated** `app/lessons/lesson_<slug>.html` (no legacy classroom;
  consumes platform identity + the certified assessment runtime).
- Generated artifacts begin with `<!-- GENERATED FILE. -->`. Direct edits to
  them are prohibited and caught by `lessons:verify` in CI.
- Markers gate `V1-ONLY` / `V2-ONLY` regions inside the source and are
  context-strict (HTML vs `<script>`/`<style>`).
- Build: `npm --prefix app run lessons:build`. Verify:
  `npm --prefix app run lessons:verify` (rebuilds in memory, fails on drift;
  part of `npm --prefix app run verify`). A build compares a normalized
  instructional-equivalence contract between v1 and v2.

Detailed marker syntax, the scanner rejection list, the config schema, the full
equivalence field list, and the launcher-override contract are in
`app/scripts/lessonBuilder/LESSON_BUILD_REFERENCE.md`. Read it before editing
markers, a lesson config, the equivalence logic, or the launcher table.

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

**Lesson ending.** Every lesson ends with: Quiz, then More Learning, then
Connections. The earlier "Go Further" stage is expressed as More Learning
followed by Connections.

**Build order.** Core lesson, then refinement, investigations, simulations,
games, extensions. Do not add games, investigations, simulations, or extensions
during initial lesson construction.

---

# STUDENT LANGUAGE

Speak directly to students. Avoid teacher-facing terminology when a
student-centered alternative exists. This is the canonical voice standard;
navigation, section labels, and homepage cards defer to it.

- Prefer: Explore, More, Connections.
- Avoid: Goals, Recall, 5Ws, Learning Targets.

---

# VOCABULARY

Vocabulary sections are visually and behaviorally identical across LyfeLabz
unless there is a clear instructional reason to differ.

- Use collapsible vocabulary cards. Only one card open at a time.
- Right-aligned chevron: `▾` closed, `▴` open.
- Section introduction is exactly: `Choose a card to see what each word means.`
  Do not create alternate phrasings.
- No helper text ("Click or tap to reveal", "In this lesson", or similar). The
  interaction is communicated through button styling, hover/focus states, the
  chevron, and the reveal animation only.
- Cards open/close on click/tap, support keyboard navigation, and update
  `aria-expanded`.
- Do not create alternate vocabulary-card implementations without a compelling
  instructional need.

---

# CONCEPT CARD LABELS

- Explanatory cards that define or explain a concept use `KEY IDEA: [TERM]`.
- Use `NAME IT: [TERM]` only when students literally identify, label, classify,
  or name something.

---

# QUIZ RULES

- 10 questions, mixing DOK 1 and DOK 2.
- Provide answer explanations.
- Use the existing classroom-mode architecture; do not invent new submission
  systems. Practice mode must work independently.
- Favor conceptual understanding over trivia; use plausible distractors.
- Avoid longest-answer bias: correct answers vary in length; the most detailed
  answer is not repeatedly correct.
- Distribute correct answer positions (A, B, C, D) evenly.
- Avoid "all of the above" / "none of the above" unless necessary.

---

# CONNECTIONS

**Purpose:** reveal how scientific ideas relate and help students discover
conceptually related lessons. Connections contain only lesson cards (never
investigations, simulations, extensions, or games).

Connections are **not** navigation: not a checklist, not a progression tracker,
not "Next Lesson" / "Previous Lesson" / "You might also like". Avoid generic
wording ("Learn more about", "Continue with", "Next, study", "Explore this
topic"). Every card should reveal a scientific relationship and make a curious
student want to click it.

Each card answers one of:

1. **What caused this?** (an earlier idea leads to this lesson)
2. **What does this explain?** (another lesson explains what students just
   learned)
3. **Where does this idea lead?** (this lesson is the foundation for a larger
   concept)

Example (cause): "Continental Drift introduced the evidence. Plate Tectonics
explains the mechanism."

**Placeholder.** Every lesson includes a Connections section. If relationships
are not yet designed, use the standard placeholder titled **Related lessons
coming soon.** Do not invent curriculum relationships to populate the section;
the architecture exists before the relationships are defined.

Bridge connections (linking two conceptual narratives) are encouraged but never
receive separate headings or visual treatment. A lesson is the student's home
base; Connections invite exploration without implying a required progression.

---

# MORE LEARNING

**Purpose:** help students go deeper into the current lesson. Contains only
investigations, simulations, extensions, and games. Never place
lesson-to-lesson navigation here (that is Connections).

Games appear in More Learning but are excluded from the formal LyfeLabz
curriculum. Do not invent decisions about extensions/simulations that are not
finalized.

**Editorial standard.** The More Learning introduction previews the scientific
ideas students are about to explore rather than serving as generic transition
text. Where appropriate, naturally introduce two to three meaningful scientific
concepts drawn from the linked experiences, using the canonical gold emphasis
(`.continue-intro strong { color: var(--gold); }`). Emphasize concepts, not
verbs, navigation language, or boilerplate. Encourage curiosity, not a mere
announcement of resources.

---

# STICKY NAVIGATION

The sticky navigation is a student quick-return menu, not a table of contents.
Use student-facing language only (see STUDENT LANGUAGE). Never expose
teacher-facing terms (Goals, Recall, Review Previous Learning, 5Ws, Learning
Targets, or individual Explore subsections).

Standard order: Vocab, Explore, Quiz, More, Connections. The Explore link always
points to the lesson's first true Explore-phase section.

---

# HOMEPAGE LESSON CARDS

Lesson cards communicate the lesson's central scientific question or purpose,
not a vocabulary list. Ask: what scientific question will this lesson help
students answer? Neighboring cards within a narrative communicate clearly
different purposes.

Do not edit `index.html` during lesson construction; add cards in batches only
after a complete unit is built. Lessons are built so they can later be surfaced
through All / Grade 6 / Grade 7 / Grade 8 without structural changes.

---

# STANDARDS PRESENTATION

Standards are never displayed as standalone banners. Every instructional page
type (lessons, investigations, extensions, simulations, engineering challenges,
Hidden World pages, games, and future types) uses the canonical beneath-hero
block **Learning Science Focus** (`.ls-focus`).

**MA STE Standards (`.stem-focus`)** is an additional, optional beneath-hero
block. It currently appears on supporting page types (investigations,
simulations, games, systems, diseases, extensions) and may remain there. It is
intentionally NOT on the 50 core lessons, which remain `.ls-focus`-only. Do not
migrate `.stem-focus` into lessons. Do not introduce new standards-presentation
styles.

---

# SCIENCE

- Use only the Massachusetts 2016 STE Framework and the source slide decks.
  Slide decks are source material, not the curriculum.
- Remove Grade 6 leftovers, Grade 8 content, high-school details, and COVID
  filler.
- Prioritize conceptual understanding; avoid unnecessary jargon; prefer models
  and cause-and-effect explanations.

**Supporting concepts.** Teach liberally: a lesson may include supporting
concepts beyond the exact wording of the performance expectation when they are
necessary for conceptual understanding (e.g., moon phases needing rotation and
orbital motion). Badge conservatively: badges represent only the standards whose
performance expectations are intentionally addressed and assessed. Mentioning a
concept does not claim mastery. Curriculum contamination occurs only when a
lesson intentionally teaches and assesses another grade's performance
expectation, or claims another grade's badge. Judge lessons by what students are
expected to demonstrate; do not remove useful scaffolding just because it
appears elsewhere in the framework.

---

# ACCESSIBILITY

Responsive design required. Large click targets. Short paragraphs. High
contrast. Mobile friendly. Avoid information overload. One vocabulary card open
at a time.

**SVG accessibility.** Decorative SVGs use `aria-hidden="true"`. An SVG that
communicates scientific or engineering information uses `role="img"` with a
concise educational `aria-label` that explains only the instructional purpose
of the graphic (not its artistic style or appearance).

**Canonical responsive breakpoints.** Three: 480px (single-column phone), 720px
(tablet portrait / split-screen Chromebook), 960px (tablet landscape / small
laptop). Two supporting queries: `@media (pointer: coarse)` (touch-target
minimums) and `@media (orientation: landscape) and (max-width: 950px)`
(notch-clearing padding). Existing per-lesson breakpoints are preserved; do not
rewrite the repository to converge. New responsive rules adopt the canonical
values.

**Canonical mobile stylesheet.** Every page loads a shared
`<style id="mobile-canonical">` block immediately after
`<style id="a11y-canonical">`. It owns safe-area padding, coarse-pointer
touch-target minimums, tap-highlight normalization, the `.table-scroll` utility,
and sticky quiz-progress offset behavior. Do not duplicate this behavior with
page-specific rules; extend the canonical block for repository-wide changes.

---

# FILE NAMING

Use prefixes: `lesson_`, `game_`, `extension_`, `investigation_`, `simulation_`.
Do not mass rename existing files. Avoid unnecessary renaming.

If a true cross-grade collision occurs, use `{type}_g{grade}_{topic}.html` (for
example `lesson_g7_earths-layers.html`). Use `g{grade}` (e.g. `g7`), never a
bare number, so it is not read as a lesson number.

**Safe-rename checklist.** This is a flat static site on GitHub Pages / Firebase
Hosting (custom domain via CNAME) with no server-side redirects, so a renamed
file 404s its old URL unless a stub is left behind. A rename is a deliberate,
redirect-backed change that updates all of:

1. The file's own `<link rel="canonical">`.
2. Its entry in `sitemap.xml`.
3. Every inbound link (index.html catalog, sibling Go Further / continue cards,
   nav).
4. A meta-refresh stub left at the old filename to redirect the old URL.

Lesson identifiers derived from filenames are referenced by assignments and
submissions; treat the safe-rename checklist as authoritative.

---

# CLASSROOM MODE (legacy v1)

v1 lessons require student name, teacher, and block before submission, using the
existing classroom-mode architecture.

- **Grade 6:** teachers Mr. Brown, Ms. Gay. Blocks A-G.
- **Grade 7:** teachers Mr. Kankel, Mr. Rovner. Blocks A-G.

---

# GOLD STANDARDS AND GRADE 7 ARCHITECTURE

Grade 6 gold-standard lesson structure: What Is Life, Nature of Waves, Wave
Behavior, Digital Signals. Grade 7 gold standard: Earth's Layers. Future Grade 7
lessons imitate Earth's Layers.

Grade 7 theme: Systems and Cycles. Unit order: Earth Systems, Water Systems,
Human Impacts, Ecosystems, Ecosystem Stability, Energy Systems, Engineering
Systems. Build lessons before extensions.

---

# NARRATIVE PHILOSOPHY

LyfeLabz is organized around conceptual narratives, not traditional units.
Lessons are the home base; narratives connect related scientific ideas.
Connections encourage students to revisit and explore related lessons without a
sense of required progression. Bridge connections that naturally join two
narratives are encouraged but never receive separate headings or visual
treatment; students should experience a connected curriculum without noticing
any special distinction.

---

# QUALITY CONTROL

After every change:

- Verify in the browser; check console errors; test interactions; confirm
  responsive behavior.
- Sweep for em dashes (see STYLE) and replace any with a spaced hyphen.
- Report exactly what changed. Do not claim verification that was not performed.
