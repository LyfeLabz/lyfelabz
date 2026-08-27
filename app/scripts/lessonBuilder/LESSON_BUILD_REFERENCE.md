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

## Launcher override contract

The Sprint 17 launcher URL contract is `/lesson_<slug>.html?assignment=<id>`.
`app/src/assignments/studentList/launchOverrides.ts` is a data-driven override
table: slugs present in the table launch to the override path (for example,
Earth's Layers launches to `/app/lessons/lesson_earths-layers.html`). Every
non-listed slug launches to the v1 URL byte-for-byte identical to Sprint 17.

Add a slug to the override table only after that lesson's v2 artifact has passed
the full build, legacy-absence, instructional-equivalence, and
runtime-integration checks.
