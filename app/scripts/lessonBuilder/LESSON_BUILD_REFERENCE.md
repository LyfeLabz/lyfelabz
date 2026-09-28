# Lesson Build Reference (on-demand)

Detailed reference for the deterministic lesson build system. Read this when
editing `lesson-sources/`, a lesson-builder config, the marker/equivalence
logic, or the generation pipeline. The governing summary and non-negotiable
invariants live in `CLAUDE.md` (LESSON BUILD ARCHITECTURE); this file holds the
syntax, schema, and field-level detail that would otherwise sit in permanent
context.

The code in this directory is authoritative: `markerScanner.cjs`, `config.cjs`,
`equivalence.cjs`, `transformer.cjs`, `paths.cjs`, `index.cjs`. This document
describes their contract; if it drifts from the code, the code wins and this
file is reconciled.

Scope today: Earth's Layers pilot and the lessons with a config under
`lessons/`. Do not extend the system to a new lesson without explicit sprint
direction.

---

## Canonical source and generated artifacts

- Canonical sources live under `lesson-sources/`, excluded from Firebase
  Hosting via `hosting.ignore`. Never served, no public URL, no canonical link,
  not in the sitemap. Direct edits to a canonical source are the only
  instructional edits that propagate to both v1 and v2.
- **v1 public artifact:** `lesson_<slug>.html` at the repo root. Preserves the
  public URL, the Practice/Classroom toggle, student info form, teacher/block
  selectors, the legacy Apps Script submission path, and every existing v1
  behavior.
- **v2 authenticated artifact:** `app/lessons/lesson_<slug>.html`. No legacy
  classroom architecture. Consumes identity and assignment context only from the
  authenticated platform and the certified assessment runtime.
- Every generated artifact begins with `<!-- GENERATED FILE. -->` immediately
  after the doctype. Direct edits to generated artifacts are prohibited and are
  caught by `lessons:verify` in CI.

## Marker grammar (context-strict)

Markers gate `V1-ONLY` / `V2-ONLY` regions inside a single canonical source.

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

Inside `<style>` blocks: same block-comment grammar as `<script>`.

`V2-ONLY` markers are the exact equivalents. Markers must occupy standalone
lines with only leading/trailing whitespace.

The scanner rejects:

- wrong marker syntax for context
- nested regions
- overlapping regions
- cross-context regions
- duplicate labels
- undeclared labels (unknown labels)
- unbalanced markers
- mismatched labels
- mismatched targets
- markers found inside JS strings, template literals, or regex literals
- HTML-style comments inside `<script>` or `<style>`

## Declarative lesson config

Every configured lesson lives at `lessons/<slug>.cjs` and declares its paths,
required labels, expected contexts, required signatures, prohibited signatures,
shared signatures, generated-notice text, and instructional-equivalence
exclusions. The builder engine is generic; no lesson identity leaks into the
engine.

Lesson-specific minimums (for example the Earth's Layers pilot's expected
vocabulary, Connections, and scroll-target counts) live in the lesson's config
under `pilotContractMinimums`, not in the generic engine.

Only explicitly declared delivery differences (per `equivalenceExclusions` in
the lesson config) are excluded from the equivalence contract.

## Build + verify

- `npm --prefix app run lessons:build` builds every configured lesson (both
  targets) into their committed artifact paths, atomically via a PID-suffixed
  tmp sibling.
- `npm --prefix app run lessons:verify` rebuilds every configured lesson in
  memory and compares to the committed artifact. It writes nothing. Fails fast
  on any drift.
- `lessons:verify` is part of the app validation chain
  (`npm --prefix app run verify`).

## Instructional-equivalence contract

Every build compares a normalized instructional contract between the v1 and v2
outputs. Compared fields:

- titles, headings, learning goals
- vocabulary (every glossary-card: order, term, definition, aria-expanded,
  aria-label, role, id, sorted classList)
- image and SVG accessibility
- Show Your Thinking
- quiz questions, option ordering, correct-answer indices, explanations,
  scoring messages
- More Learning (every cont-card: order, tag, href, aria-label, name,
  description, category, status, sorted classList)
- Connections (same per-card shape)
- key interactive IDs
- scroll targets and scroll destinations (each `.scrollIntoView` call as
  `{function, target, kind}`, with variable-bound receivers resolved back to
  their `getElementById` id or `querySelector` href)
- runtime include
- lesson-quiz call sites

## Authored presentation variants

A configured lesson may declare authored differentiated presentations
(F5.2 §5.2) in an optional `variants` block of its existing config. The V1
vocabulary is closed: `reading-adapted` only.

```js
variants: {
  "reading-adapted": {
    source: "lesson-sources/variants/<slug>.reading-adapted.html", // fixed form
    adaptableSections: ["explore", ...],      // section ids whose prose may adapt
    adaptableSelectors: ["p", ".callout-body"], // tag | .class | tag.class
    lockedSelectors: [".edu-note", ".qr-card"], // whole subtree locked; wins
  },
},
```

The variant source is a full copy of the canonical source (same V1/V2
markers). It lives in `lesson-sources/variants/`, never at the top level, so
no curriculum or assessment scan treats it as a lesson. It is built by the
same scanner, config validation and transformer, for the **v2 target only**,
and then (`variantSource.cjs`):

- gets a neutral generated notice naming neither the variantKey nor the
  source file;
- has relative same-origin references rewritten to the absolute
  `/app/lessons/...` path they resolve to from the canonical lesson
  (`variantLinks.cjs`). In-page anchors are kept. `<base>`, relative
  `srcset`/`@import`, and relative URLs inside scripts are refused;
- must pass the invariance gate against the canonical v2 build
  (`variantInvariance.cjs`), after the same relocation:
  - markup outside adaptable sections is byte-identical;
  - every script and style block is byte-identical;
  - the locked skeleton inside adaptable sections is identical;
  - adaptable prose uses only bare inline prose tags or tag forms the
    canonical prose already uses, and no prose run is emptied;
  - element ids are identical;
  - no disclosure term (adapted, simplified, accommodation, IEP,
    differentiation, variant, the variantKey or source filename) increases.
    A lesson's own glossary term is exempt;
- must match the full instructional-equivalence contract with zero
  exclusions;
- must have an identical quiz, faithful to every committed
  `<slug>.r<N>.json` payload the canonical quiz is faithful to (at least
  one);
- must build byte-identically twice.

Only an adaptable container (matched by `adaptableSelectors`, not inside
a `lockedSelectors` subtree, and with no `lockedSelectors` descendant) may
change. A container holding a locked descendant (for example the Earth's
Layers wrap-up chain chips inside a `.bridge-callout`) stays in the locked
skeleton, including its own text. Adjacent adaptable containers form
one run, so paragraphs may be split, merged or re-worded, but locked
elements may not move. Removing content within a run is not structurally
detectable; the concept-checklist review covers it.

CLI (repository-only; never commits, deploys, or writes the presentation
index):

- `node app/scripts/build-variants.cjs --check`: gate every declared
  variant and require its current build to be a retained manifest revision.
  Also runs inside `variants:verify`, so it is part of
  `npm --prefix app run verify`.
- `node app/scripts/build-variants.cjs --dry-run --lesson=<slug> --variant=<key>`:
  gate one variant in memory and print its revision id and prose statistics.
- `node app/scripts/build-variants.cjs --generate --lesson=<slug> --variant=<key> --published-at=<ISO-8601>`:
  retain the gated bytes through `generateVariantArtifact()` (add-only
  artifact plus append-only manifest entry).

## Assessment revisions (current state, and F5.3 Slice 9 plan)

Normative basis: PDR-031 (`docs/platform/LYFELABZ_PLATFORM_DECISIONS.md`).
Full specification: `docs/platform/DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md` §21.

Current state:

- Every assignable lesson has exactly one committed revision payload,
  `platform/functions/src/scripts/assessments/<slug>.r1.json`.
- The lesson's `<prefix>QuizQuestions` literal is the authority. The
  payload must be faithful to it (`assessmentFidelity.cjs`,
  `assessment-fidelity.test.js`).
- Canonical artifacts declare no assessment revision.
- An assignment freezes its `assessmentRevisionId` at publication. The
  display is correct today only because one revision exists per lesson.
- No lesson may receive a second deployed revision until Slice 9 is
  certified (PDR-031h).

Planned (Slices 9A and 9B; not implemented):

- Each committed `<slug>.r<N>.json` becomes the authority for its own
  revision. The lesson config declares which revision the unversioned page
  renders, and the source literal must be faithful to that payload.
- Every canonical v1 and v2 artifact embeds an inert, machine-readable
  revision declaration. It is inserted in the canonical build path only,
  never in the variant path, so retained variant bytes (`pr90f…`,
  `prff01…`) do not change.
- A lesson with more than one committed revision gets one generated v2
  rendition per revision: the current instruction with only the quiz
  literal regenerated from that revision's payload. Each rendition is
  verified faithful to its payload, deterministic, and drift-checked by
  `lessons:verify`.
- Renditions assume compatible quiz chrome across revisions: the same item
  count, and the same quiz section text, progress text and wiring (S9-D6).
  A revision that needs different chrome is refused, not rendered.
- Renditions temporarily carry the same `correct` and `explanation` data as
  the canonical literal and nothing more. That is the open D7 condition
  (`docs/platform/SECURITY_BACKLOG_LESSON_PAGE_ANSWER_DATA.md`); the D7 fix
  must cover renditions.
- Variants are gated against the canonical rendition of their own declared
  assessment revision.
- Canonical Show Your Thinking prompts remain unversioned; that is a
  separate follow-up (addendum §9.4).
- Editing a lesson's quiz literal still requires a new committed revision.
  Fidelity is exact, and deployed revisions are immutable.

## Launcher override contract

The Sprint 17 launcher URL contract is `/lesson_<slug>.html?assignment=<id>`.
`app/src/assignments/studentList/launchOverrides.ts` is a data-driven override
table: slugs present in the table launch to the override path (for example,
Earth's Layers launches to `/app/lessons/lesson_earths-layers.html`). Every
non-listed slug launches to the v1 URL byte-for-byte identical to Sprint 17.

Add a slug to the override table only after that lesson's v2 artifact has passed
the full build, legacy-absence, instructional-equivalence, and
runtime-integration checks.

F5.3 Slice 9D (planned) replaces slug-only routing for assignment
launches with a build-generated table keyed by lesson slug and the
assignment's frozen `assessmentRevisionId`. The server supplies the
revision; the client never selects it. Launches not tied to an assignment
(anonymous or public practice, teacher preview, Present Mode) keep the
unversioned page.
