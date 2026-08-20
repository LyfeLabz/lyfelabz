# Sprint 28 Curriculum Migration Audit (Phase 2C)

Status: Audit and planning amendment only. No production code, lesson
source, generated artifact, curriculum manifest, test, Firebase state,
Google state, or OAuth grant was changed in producing it. Read-only build
diagnostics (`lessons:verify`) were run and left the working tree clean.

This document is the full evidence record behind the Phase 2C scope
amendment. The amendment itself is recorded in `SPRINT_28_DEFINITION.md`
§16; the architecture in `SPRINT_28_ARCHITECTURAL_BLUEPRINT.md` §18; the
ordered work in `SPRINT_28_IMPLEMENTATION_PLAN.md` Phase 5.

Style: no em dashes. Use " - " (spaced hyphen) as the sentence break.

---

## 1. Executive conclusion

Should all appropriate remaining assignable curriculum migrate to the v2
assignment-aware student contract during Sprint 28?

**YES, WITH EXPLICIT EXCEPTIONS.**

The frontend migration of the 45 v1-only surfaceable lessons onto the
existing v2 assignment-aware contract is architecturally bounded and
systematic. It reuses the deterministic lesson build system that already
produces the four current v2 lessons, the V1-ONLY / V2-ONLY marker grammar,
the instructional-equivalence contract, `lessons:verify`, and the
launch-override seam. No new platform architecture is required. Every
surfaceable lesson shares one standard assessment architecture, so there is
no heterogeneous rewrite.

The exceptions:

1. **Answer-key co-requisite.** `assignmentsPublish` refuses publication
   unless the referenced lesson has a deployed assessment (answer key). Each
   migrated lesson also needs an authored, deployed answer key to be
   publishable end to end. Authoring the payloads is mechanical and can be
   done deterministically in Sprint 28. Deploying assessments to production
   is a Firebase mutation and belongs to Sprint 29.
2. **The three Category A lessons without answer keys** (plate-tectonics,
   water-cycle, earthquakes) need answer keys authored to be publishable end
   to end. Only earths-layers currently has both a v2 build and an answer
   key.
3. **The gated `ragebaiting` lesson** (Grade 6 behavioral-science) stays out
   (product-gated, PDR-010 deferred).
4. **Sequencing.** W2 (results and navigation hardening) lands before W4 so
   the hardened pattern is the migration template.

This is a platform-contract migration, not a curriculum redesign.
Instructional content is preserved and enforced by the equivalence contract.

## 2. Complete curriculum inventory

The Teacher Platform assigns exactly one thing: a `lessonSlug`
(`assignmentsCreateDraft`, validated as a URL-safe token). The assignable
surface is the teacher Curriculum surface, which iterates
`getSurfaceableLessons()` = curriculum-manifest units that have a `lesson`
resource and are not gated. That is 49 lessons (23 Grade 6, 26 Grade 7).

Legend: Cat = migration category; Ver = current frontend version; Key =
authored answer-key payload present in the repo.

### Grade 6 surfaceable lessons (23)

| Slug | Topic | Cat | Ver | Key |
|---|---|---|---|---|
| what-is-life | Life Science | B | v1 | key |
| cell-types | Life Science | B | v1 | key |
| organelles | Life Science | B | v1 | - |
| body-systems | Life Science | B | v1 | - |
| biological-evolution | Life Science | B | v1 | key |
| layers-of-time | Earth & Space | B | v1 | - |
| continental-drift | Earth & Space | B | v1 | - |
| gravity | Earth & Space | B | v1 | - |
| sun-earth-moon | Earth & Space | B | v1 | - |
| phases-of-the-moon | Earth & Space | B | v1 | - |
| eclipses | Earth & Space | B | v1 | - |
| earths-place-in-the-universe | Earth & Space | B | v1 | - |
| measuring-matter | Physical Science | B | v1 | - |
| physical-properties | Physical Science | B | v1 | - |
| pure-substances-and-mixtures | Physical Science | B | v1 | - |
| chemical-reactions | Physical Science | B | v1 | - |
| nature-of-waves | Physical Science | B | v1 | - |
| wave-behavior | Physical Science | B | v1 | - |
| digital-signals | Physical Science | B | v1 | - |
| conducting-experiments | Tech & Engineering | B | v1 | - |
| engineering-design | Tech & Engineering | B | v1 | - |
| choosing-materials | Tech & Engineering | B | v1 | - |
| designing-to-scale | Tech & Engineering | B | v1 | - |

### Grade 7 surfaceable lessons (26)

| Slug | Topic | Cat | Ver | Key |
|---|---|---|---|---|
| earths-layers | Earth & Space | A | v2 | key |
| plate-tectonics | Earth & Space | A | v2 | - |
| earthquakes | Earth & Space | A | v2 | - |
| water-cycle | Earth & Space | A | v2 | - |
| types-of-volcanoes | Earth & Space | B | v1 | - |
| hotspot-volcanoes | Earth & Space | B | v1 | - |
| weathering-and-erosion | Earth & Space | B | v1 | - |
| renewable-and-nonrenewable-resources | Earth & Space | B | v1 | - |
| parts-of-an-ecosystem | Life Science | B | v1 | - |
| photosynthesis | Life Science | B | v1 | - |
| energy-flow | Life Science | B | v1 | - |
| carbon-cycle | Life Science | B | v1 | - |
| ecosystem-stability | Life Science | B | v1 | - |
| reproductive-success | Life Science | B | v1 | - |
| human-impacts | Life Science | B | v1 | - |
| forms-of-energy | Physical Science | B | v1 | - |
| energy-transfer | Physical Science | B | v1 | - |
| heat-transfer | Physical Science | B | v1 | - |
| introduction-to-electricity | Physical Science | B | v1 | - |
| design-tradeoffs | Tech & Engineering | B | v1 | - |
| structural-systems | Tech & Engineering | B | v1 | - |
| transportation-systems | Tech & Engineering | B | v1 | - |
| communication-systems | Tech & Engineering | B | v1 | - |
| engineering-systems | Tech & Engineering | B | v1 | - |
| technology-and-society | Tech & Engineering | B | v1 | - |
| innovation-and-sustainability | Tech & Engineering | B | v1 | - |

All 49 use the same interaction model: a per-lesson prefixed
`<prefix>SubmitQuiz`, a `<prefix>-score` results board, a 10-question
single-choice quiz, a Show Your Thinking box, and the assessment-runtime
`<script>` include. The interaction type is therefore "standard single-choice
assessment" for every row. Source, build architecture, and disposition are
identical within a category (see §4 and §5), so they are stated once per
category rather than repeated per row.

### Not in the assignable surface (Category D)

- 1 gated lesson: `ragebaiting` (Grade 6 behavioral-science; not surfaced;
  PDR-010 activation deferred).
- 2 orphan units (present in the manifest's `orphanUnits`, not surfaced by
  `getSurfaceableLessons`).
- All non-lesson resources, none of which is an independent assignment
  target: games (7 files), extensions (7), investigations (5), simulations
  (4), engineering challenges (7), disease pages (8), system pages (8), plus
  the About and interaction pages. These are supporting resources reached
  from within a lesson's More Learning section; the teacher assigns the
  lesson, never the resource.

## 3. Quantitative summary

- Total assignable (surfaceable) lessons: **49**.
- Category A (already v2): **4** - earths-layers, plate-tectonics,
  water-cycle, earthquakes.
- Category B (v1, structurally compatible; migrate): **45**.
- Category C (materially different interaction model): **0**.
- Category D (not assignable / not student-facing-assignable): all
  non-lesson resources, 2 orphan units, 1 gated lesson.
- Category E (migration blocked by architecture): **0**.
- Authored answer-key payloads in the repo: **4** (what-is-life, cell-types,
  biological-evolution, earths-layers); overlap with Category A: **1**
  (earths-layers).
- Answer keys still to author for a full-lifecycle migration: **48** (the 45
  Category B plus the 3 Category A lessons without a key).

## 4. Existing v2 migration pattern (repository-backed)

The four current v2 lessons prove the exact transformation. Evidence:

- Canonical sources for all four exist under `lesson-sources/`.
- Builder configs for all four exist under
  `app/scripts/lessonBuilder/lessons/`; the registry (`lessons/index.cjs`)
  auto-discovers any `<slug>.cjs`.
- Each v2 artifact carries the `<!-- GENERATED FILE. -->` notice.
- `npm --prefix app run lessons:verify` rebuilds all four in memory and
  reports OK (v1 and v2 hashes match the committed artifacts). It writes
  nothing.

A migrated lesson's canonical source differs from its current hand-authored
v1 artifact by exactly the following (earths-layers is the reference,
`app/scripts/lessonBuilder/lessons/earths-layers.cjs` and
`lesson-sources/lesson_earths-layers.html`):

**Three SHARED runtime wiring points** (present in both v1 and v2 output;
use the per-lesson prefix):

1. `window.lyfelabz.lessonQuiz.autosave(<prefix>QuizState.selected)` on
   answer selection.
2. `var <prefix>Assigned = window.lyfelabz.lessonQuiz.hasAssignmentContext();`
   at the top of the submit function.
3. the assignment-context block:
   `if (<prefix>Assigned) { finalize(selected) -> "Submitted to your teacher" / error; return; }`.
   The runtime re-scores from the deployed answer key; local scoring is kept
   for student-facing feedback.

**Twelve V1-ONLY marker regions** wrapping the legacy classroom apparatus so
it survives only in the v1 output: `legacy-mode-toggle-markup`,
`legacy-student-info-markup`, `legacy-classroom-styles`,
`legacy-classroom-touchtarget`, `legacy-endpoint`, `legacy-mode-state`,
`legacy-set-quiz-mode`, `legacy-mode-init-iife`,
`legacy-validate-student-info`, `legacy-classroom-validation-guard`,
`legacy-practice-completion`, `legacy-apps-script-submit`.

**One V2-ONLY marker region**: `platform-standalone-completion` (the
exploration-mode message when a v2 lesson opens without assignment context).

The migrated lesson is confirmed NOT to leave the runtime unwired: a
non-migrated lesson (`lesson_cell-types.html`) has zero
`window.lyfelabz.lessonQuiz.(autosave|finalize|hasAssignmentContext)` calls,
while the earths-layers source has all three.

## 5. Migration checklist (canonical transformation, per lesson)

1. Create `lesson-sources/lesson_<slug>.html` from the committed root v1
   artifact.
2. Add the three SHARED runtime wiring points (autosave, `hasAssignmentContext`,
   finalize block).
3. Wrap the legacy classroom apparatus in V1-ONLY marker regions (context
   grammar: HTML top-level for markup, block-comment inside `<script>` and
   `<style>`).
4. Add the V2-ONLY standalone-completion message and clone the W2 V2-ONLY
   hardening (scroll offset, focus, live region, `Back to My Assignments`).
5. Create `app/scripts/lessonBuilder/lessons/<slug>.cjs` declaring paths,
   generated notices, `requiredLabels`, `expectedContexts`, per-prefix
   `v1RequiredSignatures` / `v2ProhibitedSignatures` / `sharedRequiredSignatures`,
   `equivalenceExclusions`, and `pilotContractMinimums`.
6. `npm --prefix app run lessons:build`; never hand-edit an artifact.
7. Author `platform/functions/src/scripts/assessments/<slug>.r1.json` from
   the lesson's existing quiz (stems, options, correct option, explanation,
   points). Do not deploy in Sprint 28.
8. Add the slug to `LESSON_LAUNCH_OVERRIDES`
   (`app/src/assignments/studentList/launchOverrides.ts`) only after build,
   legacy-absence, equivalence, and runtime checks pass for that lesson.
9. `npm --prefix app run lessons:verify` green; marker scanner clean;
   equivalence contract passes.

## 6. Special cases

- **Answer-key co-requisite (all migrated lessons).**
  `assignmentsPublish` calls `resolveCurrentAssessmentRevisionId(lessonSlug)`
  and refuses a draft -> published transition if no assessment revision is
  deployed (ASSESSMENT_SCORING_CONTRACT.md §12.1). This gates publication for
  both practice and classroom modes and is independent of the frontend v1/v2
  state. A frontend-migrated lesson is unpublishable until its assessment is
  deployed. Sprint 28 authors payloads; Sprint 29 deploys them.
- **plate-tectonics, water-cycle, earthquakes.** Already v2 (build +
  launch override) but no authored answer key. W4 authors their keys too.
- **Prefix collisions.** Some lessons reuse a prefix from the pilot (for
  example photosynthesis uses the `el` prefix). Each lesson builds
  independently, so this is not a blocker, but a migrated lesson's builder
  config signatures must be scoped to that lesson's own file, and a
  prefix-collision lesson is a good browser-certification representative.
- **v1 byte reproduction.** Migration converts a lesson's root v1 artifact
  from hand-authored to generated (it gains the GENERATED FILE notice). The
  public URL is unchanged (same filename, no redirect stub). `lessons:verify`
  gates any normalization difference before commit.
- **ragebaiting (gated).** Not surfaced or assignable; excluded. If a future
  sprint un-gates it, it would become a Category B migration at that time.

## 7. Preservation strategy

- The instructional-equivalence contract compares titles, headings, learning
  goals, vocabulary, quiz questions and correct indices, explanations, More
  Learning, Connections, scroll targets, and runtime wiring between the v1
  and v2 outputs of the same source. A migration that changed instructional
  content fails this contract.
- v1 public content and URL are preserved: the root `lesson_<slug>.html`
  keeps its filename and its instructional content, and the legacy
  Practice/Classroom path stays in the v1 output via V1-ONLY markers.
- Scoring semantics are not invented: the answer key is authored from the
  quiz that already exists in the lesson.
- The build system produces both v1 and v2 from one canonical source, so the
  v1 output is not casually altered when v2 is added; it is regenerated and
  verified byte-for-byte by `lessons:verify`.

## 8. Test strategy (design only)

Deterministic contract validation asserted systematically across generated
outputs (not per lesson by hand): build determinism (`lessons:verify`),
marker correctness (scanner), instructional equivalence (contract), a shared
v2-contract test (assignment hook wired, finalize path present, legacy
chooser absent from v2, results region carries `role="status"`/`aria-live`/
`tabindex` and the scroll offset, `Back to My Assignments` present pointing
at `/app/`), a shared v1-non-regression test (`v1RequiredSignatures` present,
v2 additions absent from v1), and an answer-key-fidelity test (each
`<slug>.r1.json` matches the lesson's quiz).

Browser certification samples, it does not exhaustively re-test 45 lessons.
Representatives chosen by structural variation (one Grade 6, one Grade 7, one
prefix-collision lesson, one whose legacy code diverged most) plus the four
Category A lessons carrying the W2 hardening. No live Google mutation is
required.

## 9. Manifest interaction

W4 changes generated lesson artifacts (the root v1 file and the
`app/lessons/` v2 file) and the launch-override table. It does NOT change
`index.html`, the curriculum manifest's canonical source, so W4 does not
touch the manifest or its SHA. The pre-existing O6 manifest SHA drift (the
cosmetic `#how` line) is neither hidden nor conflated by W4 and remains
Sprint 29's mechanical regeneration.

## 10. Diagnostics performed (read-only)

- `ls lesson-sources/`, `ls app/lessons/`, `ls app/scripts/lessonBuilder/lessons/`
  - confirmed 4 canonical sources, 4 v2 artifacts, 4 builder configs.
- `ls lesson_*.html | wc -l` = 50 root lesson artifacts; resource-type counts
  (game 7, extension 7, investigation 5, simulation 4, challenge 7).
- `grep -l lyfelabz-assessment-runtime.js lesson_*.html` = 50 (all include
  the runtime script); `grep -l window.lyfelabz.lessonQuiz` = 4 (only the
  built lessons wire it); `grep -l "GENERATED FILE"` = 4.
- Read `assignments-create-draft.ts` - assignment keyed on `lessonSlug` +
  `mode` (practice|classroom), slug validated as a URL-safe token only.
- Read `curriculumManifest.ts` `getSurfaceableLessons()` and the manifest -
  49 surfaceable lessons, 1 gated (ragebaiting), 2 orphan units.
- Read `assessment-sessions-begin.ts` and `assignments-publish.ts` -
  publication refused unless `resolveCurrentAssessmentRevisionId(lessonSlug)`
  resolves a deployed assessment.
- `find ... *.r1.json` = 4 authored answer keys (what-is-life, cell-types,
  biological-evolution, earths-layers); read `cert-lessons.ts` (bounded cert
  set) and the earths-layers payload shape.
- Homogeneity sweep across all 50 lesson files: 0 lacking a `SubmitQuiz`
  function, 0 lacking a `<prefix>-score` board.
- `npm --prefix app run lessons:verify` - OK for all four (v1 and v2 hashes
  match committed artifacts); wrote nothing; `git status --porcelain`
  unchanged before and after.

## 11. Git and external state

No production code, lesson source, generated artifact, curriculum manifest,
test, or configuration was changed by this audit. The only working-tree
changes are the four Sprint 28 planning documents (this file plus the
definition, blueprint, and plan amendments). Nothing staged, committed,
pushed, or deployed. No Firebase mutation, no Google call, no OAuth change.

*End of Sprint 28 curriculum migration audit.*
