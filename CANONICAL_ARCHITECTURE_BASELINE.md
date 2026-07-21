# CANONICAL LESSON ARCHITECTURE BASELINE

Definitive architectural state of LyfeLabz after Repository Hardening Pass 1B.

This document is the permanent architectural baseline. It records what "canonical"
means in practice, which lessons are fully canonical, and which lessons satisfy the
canon through intentional architectural equivalence rather than identical markup.

Governing rule: **Canonical Architecture Clarification** (CLAUDE.md). Canonical
architecture is defined by educational function, not identical implementation.

Baseline date: 2026-07-07

Sprint 18 addendum (2026-07-19): Earth's Layers is now a generated
lesson. Its canonical instructional source lives at
`lesson-sources/lesson_earths-layers.html`; the public v1 artifact at
`lesson_earths-layers.html` and the authenticated v2 artifact at
`app/lessons/lesson_earths-layers.html` are byte-generated from that
source and are prohibited from direct edit. Canonical instructional
architecture guarantees continue to hold because canonical architecture
is defined by educational function, not identical implementation. All
50 core lessons remain canonical.

---

## 1. Total lessons

**50** core instructional lessons (`lesson_*.html`).

Supporting instructional pages (investigations, simulations, games, extensions,
challenges, systems, diseases) are governed by the same beneath-hero and Educator
Mode standards but are not counted in the 50-lesson core.

---

## 2. Fully canonical lessons

All 50 lessons implement the complete canonical instructional architecture:

- Beneath-hero **Learning Science Focus** (`.ls-focus`) — 50 / 50
- **Show Your Thinking** (`.think-box`) — 50 / 50 (two think-box regions each)
- **Educator Mode** (`.edu-note` infrastructure) — 50 / 50
- **Quiz → More Learning → Connections** ending — 50 / 50
- Student-facing **sticky navigation** — 50 / 50

By the function-first definition, **all 50 lessons are canonical.**

---

## 3. Intentional architectural equivalencies

These lessons meet a canonical instructional function through a different but
well-designed structure. Under the Canonical Architecture Clarification they are
canonical and must **not** be rewritten to force identical markup.

### Concept-card explanation (KEY IDEA)

- **Component form** (`.name-it` / KEY IDEA card): 43 lessons.
- **Equivalent form** (`.section-label`-driven explanatory structure, no `.name-it`
  card): 7 lessons —
  - `lesson_gravity.html`
  - `lesson_eclipses.html`
  - `lesson_phases-of-the-moon.html`
  - `lesson_sun-earth-moon.html`
  - `lesson_earths-place-in-the-universe.html`
  - `lesson_continental-drift.html`
  - `lesson_layers-of-time.html`

  These deliver the same "define and explain the concept" function through
  section-label structure. Accepted as equivalent. Do not retrofit `.name-it`.

### Standards presentation

- `.ls-focus` is present on all 50 lessons.
- `.stem-focus` (MA STE block) is intentionally **absent** from all 50 core lessons
  and present only on supporting page types. This is a documented intentional
  exception, not drift. Do not migrate `.stem-focus` into lessons.

---

## 4. Repository-wide canonical instructional components

| Function | Canonical implementation | Coverage |
|---|---|---|
| Beneath-hero standards | `.ls-focus` (Learning Science Focus) | 50 / 50 |
| Concept explanation | `.name-it` KEY IDEA card, or `.section-label` equivalent | 50 / 50 |
| Student reasoning | `.think-box` (Show Your Thinking) | 50 / 50 |
| Vocabulary | Collapsible glossary card, one open at a time, `.gc-term` heading | 50 / 50 |
| Teacher notes | `.edu-note` / `.edu-note-grid` (Educator Mode) | 50 / 50 |
| Related lessons | `.connections-grid` of lesson-only `.cont-card lesson` | 50 / 50 |

Inline vocabulary token: `.vocab` (dotted-underline help term), styled `--accent2`.

---

## 5. Canonical assessment implementation

- 10-question quiz per lesson, DOK 1 + DOK 2 mix, answer explanations.
- Shared classroom-mode architecture: `.mode-btn` practice/classroom toggle
  (present 50 / 50), `.quiz-submit-btn` (50 / 50), `.reset-btn` / Try Again (50 / 50).
- Practice mode works independently of classroom submission.
- Grade 6 classroom mode: Mr. Brown, Ms. Gay, blocks A–G.
- Grade 7 classroom mode: Mr. Kankel, Mr. Rovner, blocks A–G.
- Quiz-flow standard: results reveal, auto-scroll to More on 100%, Try Again — rolled
  out across all standard-quiz lessons.

No alternate submission systems exist. Canonical.

---

## 6. Canonical navigation implementation

Student quick-return sticky navigation, student-facing language only.

Standard order: **Vocab · Explore · Quiz · More · Connections**

The Explore link points to each lesson's first true Explore-phase section. No
teacher-facing items (Goals, Recall, Learning Targets, 5Ws) appear in navigation.
Present on all 50 lessons. Canonical.

---

## 7. Canonical Educator Mode implementation

Hidden teacher notes rendered through the `.edu-note` component family
(`.edu-note-label`, `.edu-note-grid`, `.edu-note-item`, `.edu-note-head`,
`.edu-note-text`). Model implementation: Earth's Layers.

Rollout complete across all 50 lessons (verified 2026-07-05). Section-level notes
appear throughout each lesson, including a closing Instructional Design note in the
More Learning section. Canonical.

---

## 8. Canonical lesson-ending implementation

Every lesson ends with the three-part close, in order:

1. **Quiz**
2. **More Learning** — investigations, simulations, extensions, games only.
   Populated resource cards where they exist; otherwise the standard "Coming Soon"
   `.cont-card soon` placeholder. Never contains lesson-to-lesson navigation.
3. **Connections** — lesson cards only (`.cont-card lesson`), revealing scientific
   relationships. Placeholder-friendly where curriculum relationships are undefined.

Present and correctly ordered on all 50 lessons. Canonical.

---

## 9. Documented intentional exceptions

| Exception | Scope | Status |
|---|---|---|
| `.stem-focus` absent from core lessons | All 50 lessons | Intentional; do not migrate |
| `.name-it` replaced by section-label explanation | 7 astronomy/geology lessons | Intentional equivalency |
| `biological-evolution` warm palette (`#100f0a` / amber) | 1 lesson | One-off theme, preserved |
| Per-topic accent theming vs. slate `#7a8fa6` | ~17 older-family lessons | Deferred to Pass 2 review |
| Dual page-background palette (`#0d1117` vs `#1a2535`) | 28 vs 18 lessons | Deferred to Pass 2 review |

Palette items are visual, not architectural. They are recorded here for traceability
and evaluated in Repository Hardening Pass 2 (Visual Consistency). They do not affect
the architectural canon: all 50 lessons remain fully canonical by function.

---

## Baseline conclusion

50 / 50 lessons are architecturally canonical. Instructional architecture is
**complete**. Remaining differences are visual/palette-level and are addressed in
Pass 2 under Preservation Mode. No lesson requires an architectural rewrite.
