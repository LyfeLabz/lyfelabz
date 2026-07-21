# Sprint 18 - Implementation Specification

**Deterministic Lesson Build System (Earth's Layers Pilot)**

Date: 2026-07-19
Status: Complete
Sprint: 18
Pilot lesson: Earth's Layers only. No Family A rollout.

## Purpose

Certify a deterministic lesson build system that produces separate v1
and v2 lesson artifacts from one canonical instructional source. The
system must:

- retain the public v1 experience byte-for-byte (Preservation Mode)
- deliver a v2 artifact free of legacy classroom architecture
- fail closed on marker, integrity, and equivalence violations
- integrate cleanly into the app validation chain
- allow future rollout with lesson-specific data-driven configuration

## Non-negotiable principles (recorded here for future sprints)

1. One instructional source of truth per generated lesson.
2. Generated artifacts are prohibited from direct edit; enforced by
   `lessons:verify`.
3. v1 remains in Preservation Mode. No modernization, no dependency on
   Firebase auth, no removal of legacy submission surfaces.
4. v2 contains no legacy classroom markup, state, selectors, endpoints,
   or event handlers.
5. Build transformations may change delivery only. Instructional
   content is invariant.
6. Deterministic generation. Byte-identical outputs from identical
   source.
7. Fail closed on marker violations, missing labels, missing required
   signatures, prohibited signatures, and equivalence contract
   violations.
8. No runtime environment guessing. Build target is explicit.
9. Preserve history and deployment safety. No renames of existing
   public artifacts.

## Architecture

Canonical source: `lesson-sources/lesson_<slug>.html`. Excluded from
Firebase Hosting.

v1 artifact: `lesson_<slug>.html` at the repo root. Public URL
`https://lyfelabz.com/lesson_<slug>.html` is preserved.

v2 artifact: `app/lessons/lesson_<slug>.html`. Public URL
`https://lyfelabz.com/app/lessons/lesson_<slug>.html`. Firebase
Hosting serves real files before applying the `/app/**` rewrite, so
this URL renders the v2 artifact directly.

### Builder engine

Generic, lesson-agnostic modules at
`app/scripts/lessonBuilder/`:

- `markerScanner.cjs`. Context-aware scanner. Uses `acorn` (already
  installed) to extract genuine JS comments from `<script>` blocks;
  bounded CSS block-comment scanner for `<style>`; bounded HTML
  comment scanner for HTML top level.
- `transformer.cjs`. Pure byte transform. Strips regions for the
  opposite target, strips marker lines for the current target, injects
  the generated notice immediately after the doctype. Never rewrites
  marker-free content.
- `config.cjs`. Loads per-lesson declarative configuration; validates
  scan results against the declared registry; enforces required
  signatures.
- `equivalence.cjs`. Extracts a normalized instructional contract from
  HTML bytes; compares v1 and v2 contracts; produces actionable
  mismatch messages.
- `paths.cjs`. Path boundary validation. Sources must live under
  `lesson-sources/`. v1 outputs must live at repo root; v2 outputs
  under `app/lessons/`. Overwriting the canonical source is refused.
  Temporary files use a `.<basename>.build-tmp.<pid>` sibling.
- `index.cjs`. Public `buildLesson({slug, target, write})` and
  `verifyLesson({slug})` API. `write=false` is the default. Verify is
  in-memory only.

### Marker grammar

Context-strict comment lines that must occupy their own line with only
optional leading/trailing whitespace.

- HTML top level: `<!-- LYFELABZ:<TARGET>:<BEGIN|END> <label> -->`
- `<script>` block: `/* LYFELABZ:<TARGET>:<BEGIN|END> <label> */`
- `<style>` block: same as `<script>`.

Target is `V1-ONLY` or `V2-ONLY`. Labels match
`[A-Za-z0-9_-]+`.

Fail-closed conditions (all covered by scanner tests):

- wrong marker syntax for context
- nested regions
- overlapping regions
- cross-context regions (BEGIN in one context, END in another)
- duplicate labels
- undeclared labels
- unbalanced markers
- mismatched labels between BEGIN and END
- mismatched targets between BEGIN and END
- marker text inside JS strings, template literals, or regex literals
- HTML-style comments inside `<script>` or `<style>`

### Generated notice

Injected immediately after the doctype:

```
<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.
Canonical source: lesson-sources/lesson_<slug>.html
Build target: <v1|v2>
Regenerate: npm --prefix app run lessons:build -- --only=<slug> --target=<v1|v2>
-->
```

### Instructional equivalence contract

For each build, a normalized instructional contract is extracted from
both v1 and v2 outputs and compared field-by-field. Compared fields:

- document title and html lang
- h1, h2, h3 headings
- section labels (canonical `.section-label` text)
- learning goals (all `<li>` under `#goals`)
- vocabulary (every `button|div.glossary-card`: order, term,
  definition, aria-expanded, aria-label, role, id, sorted classList)
- image accessibility (src + alt)
- SVG accessibility (role, aria-label, aria-hidden)
- Show Your Thinking (prompt + model answer)
- quiz questions (question text, option ordering, correct index,
  explanation, extracted from the `elQuizQuestions` JS literal)
- scoring messages (perfect/high/mid/low)
- More Learning (intro + every `a|div.cont-card`: order, tag, href,
  aria-label, name, description, category, status, sorted classList)
- Connections (intro + every `a|div.cont-card`: order, tag, href,
  aria-label, name, description, category, status, sorted classList)
- key interactive DOM ids (namespaced set)
- scroll targets (unique target ids resolved from inline and
  variable-bound `.scrollIntoView` calls)
- scroll destinations (each `.scrollIntoView` call as
  `{function, target, kind}`, resolving inline `getElementById(...)`,
  variable-bound `var X = document.getElementById('...'); X.scrollIntoView`,
  and the reset-link `querySelector(link.getAttribute('href'))`
  pattern)
- runtime include tag
- lesson-quiz call sites (autosave / finalize / hasAssignmentContext /
  mapIndexSelectionsToResponses)

Exclusions are declared per lesson under `equivalenceExclusions`. Any
mismatch outside declared exclusions fails the build with an
actionable mismatch message.

## Earth's Layers pilot registry

13 total regions: 2 HTML, 2 CSS, 8 JS V1-ONLY, 1 JS V2-ONLY.

**V1-ONLY**:

1. `legacy-mode-toggle-markup` (HTML)
2. `legacy-student-info-markup` (HTML)
3. `legacy-classroom-styles` (CSS)
4. `legacy-classroom-touchtarget` (CSS)
5. `legacy-endpoint` (JS)
6. `legacy-mode-state` (JS)
7. `legacy-set-quiz-mode` (JS)
8. `legacy-mode-init-iife` (JS)
9. `legacy-validate-student-info` (JS)
10. `legacy-classroom-validation-guard` (JS)
11. `legacy-practice-completion` (JS)
12. `legacy-apps-script-submit` (JS)

**V2-ONLY**:

13. `platform-standalone-completion` (JS) - renders "Exploration mode.
    Your work is not saved. Launch this lesson from an assignment to
    record your score with your teacher." when v2 is opened without
    an `?assignment=` parameter.

The shared `var elAssigned = window.lyfelabz.lessonQuiz.hasAssignmentContext();`
declaration is preserved outside any marker (Sprint 18 correction 2).
Only the guard block that follows it is wrapped in
`legacy-classroom-validation-guard`.

### v1 preservation proof

`v1(source) minus notice == pre-Sprint-18 file bytes`.

Pre-Sprint-18 sha256:
`ca0555875b97e9dbbe6396b7f9bde3816fb1e850e194e4a138db51bca8d873bf`.

The v1 output differs from the pre-Sprint-18 file only by insertion of
the generated notice immediately after the doctype. Every other byte
is preserved.

### v2 legacy-absence proof

The v2 artifact contains none of: `quiz-mode-toggle`, `mode-btn`,
`student-info-box`, `el-teacher-select`, `el-block-select`,
`el-student-name`, `el-err-name`, `el-err-teacher`, `el-err-block`,
`EL_ENDPOINT`, `script.google.com`, `elSetQuizMode`,
`elValidateStudentInfo`, `elQuizMode`, `mr-kankel`, `mr-rovner`,
`Practice Mode`, `Classroom Mode`, `Practice mode - score not
submitted`, `Firebase`, `httpsCallable`, `assessmentSessionsBegin`,
`assessmentSessionsAutosave`, `assessmentAttemptsFinalize`,
`assessmentAttemptGet`.

Asserted at build time in `config.assertSignatures` and at test time
in `lesson-integration.v2.test.ts` (26 tests).

## Launcher retarget

`app/src/assignments/studentList/launchOverrides.ts` declares a
slug-keyed override map:

```
{ "earths-layers": { path: "/app/lessons/lesson_earths-layers.html" } }
```

`launch.ts` consults the map. Slugs present in the map take the
override path; every other slug takes the current v1 path
byte-for-byte identical to Sprint 17. Tested in `launch.test.ts` and
`launchOverrides.test.ts`.

## Hosting

Firebase Hosting `hosting.ignore` extended by exactly one entry:
`lesson-sources/**`. `app/lessons/**` remains deployable. No rewrite
change, no sitemap change, no CNAME change.

Publishing surface sweep:

- `.github/workflows/platform-ci.yml`: only runs on `platform/**`
  changes, no site deploy.
- No Jekyll config, Gemfile, Netlify config, Vercel config,
  Cloudflare Pages config, `_headers`, or `_redirects`.
- `robots.txt`: no `Disallow` rules; not blocking any path.
- `sitemap.xml`: unchanged; the v2 URL is intentionally not
  sitemapped (authenticated launch surface only).

## Validation chain

Added to `app/package.json`:

```
"lessons:build":  "node scripts/build-lessons.cjs",
"lessons:verify": "node scripts/build-lessons.cjs --check",
"verify":         "npm run curriculum:verify && npm run lessons:verify && npm run typecheck && npm run lint && npm run test"
```

`lessons:verify` writes nothing. It rebuilds every configured lesson
in memory and compares to the committed artifact. Direct edits (even
single-byte changes) are detected.

## Rollback

`git revert <sprint-18-merge>` restores:

- `lesson_earths-layers.html` to its Sprint 17 bytes.
- Removes `app/lessons/`, `lesson-sources/`, `launchOverrides*.ts`.
- Restores `platform/firebase/firebase.json`, `CLAUDE.md`, and
  baseline doc.

For partial rollback (kill switch): remove the `earths-layers` entry
from `launchOverrides.ts`. New launches revert to the v1 URL while
both artifacts remain on disk.

## Constraints observed

- No Family A rollout. Only Earth's Layers is generated.
- No modification to any other lesson.
- No changes to Firebase Functions or Firestore rules.
- No commits. Sprint hand-off is prior to commit review.
