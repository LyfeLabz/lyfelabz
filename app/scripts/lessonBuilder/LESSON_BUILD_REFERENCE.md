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
- must have an identical quiz, faithful to the variant's own committed
  assessment revision (Slice 9B: the gates run against the canonical
  rendition of that revision);
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

F5.3 Slice 9C-2: every new manifest entry records the assessment revision it
covers (`assessmentRevisionId`, alone for an unbound variant, together with
`assessmentPresentationRevisionId` when bound). Only the pinned historical
`LEGACY_R1_UNBOUND_REVISIONS` (`variantManifest.cjs`) may lack it.
Publication proves the revision from the retained bytes
(`variantPublicationProvenance.cjs`) and writes only the revision-scoped
coverage document.

## Assessment revisions (current state, and F5.3 Slice 9 plan)

Normative basis: PDR-031 (`docs/platform/LYFELABZ_PLATFORM_DECISIONS.md`).
Full specification: `docs/platform/DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md` §21.

Current state:

- Every assignable lesson commits
  `platform/functions/src/scripts/assessments/<slug>.r1.json`. Earth's
  Layers also commits `earths-layers.r2.json` (not deployed), so it has r1
  and r2 renditions and must declare `canonicalAssessmentRevisionId`. In
  release Stage A that is r1 (its unversioned pages still display r1); Stage
  B switches the declaration and the source quiz literal to r2 (addendum
  §21.12).
- Every canonical artifact declares its revision (Slice 9B, below).
- An assignment freezes its `assessmentRevisionId` at publication, and
  assignment launches route to that revision's page (Slice 9D).
- Slice 9 is staging-certified (C8). A second deployed revision follows
  the Earth's Layers r2 sequence (addendum §21.12).
- A variant's quiz literal must be a verbatim copy of the canonical
  literal of its revision; a regenerated literal fails the script-block
  invariance gate.

Implemented (Slice 9A, repository tooling only):

- Each committed `<slug>.r<N>.json` is the authority for its own
  revision. `assessmentRevisions.cjs` is the one place that discovers and
  identity-checks them: every `.json` in the payload directory must be a
  strict `<slug>.r<N>.json` (N of 1 or more, no leading zero), and its
  `activityId` and `revisionOrdinal` must match the name. Revision ids and
  declared ordinals are unique, and ordinals are contiguous from r1.
  Discovery is sorted by slug and numeric ordinal. Any disagreement fails
  closed.
- The optional lesson-config field `canonicalAssessmentRevisionId`
  (`assessment_<slug>__r<N>`) names the committed revision the unversioned
  canonical source represents. When it is absent, the lesson resolves to r1
  only while r1 is its single committed revision (every lesson today). With
  more than one committed revision, the field is required and must name a
  committed revision. Deployed Firestore state is never consulted.
- The source literal must be faithful to that configured revision
  (`checkCanonicalRevisionFidelity`, `assessment-fidelity.test.js`). Other
  committed revisions are schema- and identity-checked on their own and
  never compared with the mutable source.
- `assessments:verify` audits every committed revision under its own file
  name. Recorded r1 debt never covers r2, and the allowlist stays
  shrink-only and r1-only.
- `authorAssessments.cjs` never rewrites a committed revision (`--force` is
  refused). A later revision needs `--lesson=<slug> --revision=<next N>
  --published-by=<label>`, must change the quiz content, and must meet the
  answer-position standard. The operator then declares it in the lesson
  config.

Implemented (Slice 9B, build side only; nothing routes to it until 9D):

- Every canonical v1 and v2 artifact carries one inert declaration,
  `<script type="application/json" id="lyfelabz-assessment-revision">`
  holding exactly `{ schemaVersion: 1, lessonSlug, assessmentRevisionId }`.
  It is inserted immediately before the runtime script tag, only by the
  canonical build (`index.cjs`, `assessmentRenditions.cjs`). The variant
  path never inserts it, so retained variant bytes (`pr90f…`, `prff01…`) do
  not change. The canonical build also fails unless the quiz is faithful to
  the configured revision.
- A lesson with more than one committed revision gets one generated v2
  rendition per revision at
  `app/lessons/assessment-revisions/lesson_<slug>__r<N>.html`. A rendition
  is the current instruction, relocated for its directory, with only the
  quiz literal regenerated from that revision's payload. It carries exactly
  `q`, `options`, `correct` and `explanation`, the same D7 condition as the
  canonical literal
  (`docs/platform/SECURITY_BACKLOG_LESSON_PAGE_ANSWER_DATA.md`). Each one is
  re-extracted and must be faithful to its payload. Renditions are
  deterministic and drift-checked by `lessons:verify`. Single-revision
  lessons (every lesson today) produce none.
- Renditions assume compatible quiz chrome (S9-D6). A different item
  count, or a literal with extra fields (for example Nature of Waves
  `visual`), is refused, not rendered.
- `app/lessons/assessment-revisions/revision-paths.json` maps each
  (lesson, revision) to the page that displays exactly it: the unversioned
  v2 page for a single-revision lesson, else the rendition. It has no
  fallback entry. `lessons:build` writes it; `lessons:verify` fails if it
  drifts or if the directory holds any file it does not name. The curated
  app Hosting build ships the table and exactly the renditions it names.
- A variant is gated against the canonical rendition of its own revision
  (owner ruling S9-D7): its bound AP record's revision, else the variant
  config's explicit `assessmentRevisionId`, else the legacy-r1 rule, and
  only when the build reproduces a pinned historical artifact
  (`LEGACY_R1_UNBOUND_REVISIONS`, exactly `prff01…`). A newly authored
  unbound variant must declare `assessmentRevisionId`; missing provenance
  is refused, never read as r1. Variant bytes never gain the canonical
  declaration.
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

F5.3 Slice 9D (implemented) replaces slug-only routing for assignment
launches with the build-generated table keyed by lesson slug and the
assignment's frozen `assessmentRevisionId`. The client bundles the table's
byte-identical copy at
`app/src/assignments/studentList/assessment-revision-paths.json`, which
`lessons:build` writes and `lessons:verify` drift-checks. The override
table still serves launches that are not tied to an assignment. The server supplies the
revision; the client never selects it. Launches not tied to an assignment
(anonymous or public practice, teacher preview, Present Mode) keep the
unversioned page.
