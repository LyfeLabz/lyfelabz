# Sprint 18 - Completion Report

**Deterministic Lesson Build System (Earth's Layers Pilot)**

Date: 2026-07-19
Status: Complete, awaiting review commit.
Pilot lesson: Earth's Layers only.

## Result

Sprint 18 delivered a certified deterministic lesson build system.
Earth's Layers is the sole configured lesson. All approved corrections
were implemented and validated. No commits were made; the diff is
staged for review.

## Artifacts and integrity

| File | sha256 |
|------|--------|
| `lesson-sources/lesson_earths-layers.html` (canonical source) | `6b499d730b6db8dacb06f25f3d84edd1b3258025db11be91991d88c543211155` |
| `lesson_earths-layers.html` (generated v1) | `b262736f3e9afdd228679b3442134f4cfe18b60396fff01cfe719eea59e8a697` |
| `app/lessons/lesson_earths-layers.html` (generated v2) | `a92921fb47cb8d60022acd201a577fe5ead13b4dbc98c0f68e2e6d0dfe20377f` |

Pre-Sprint-18 baseline `lesson_earths-layers.html` sha256:
`ca0555875b97e9dbbe6396b7f9bde3816fb1e850e194e4a138db51bca8d873bf`.

### v1 preservation proof

The v1 output with the generated notice removed is byte-identical to
the pre-Sprint-18 file. Programmatically verified during Sprint 18
Phase 5 and asserted in `buildLesson.earths-layers.test.js`.

### v2 legacy-absence proof

None of `quiz-mode-toggle`, `mode-btn`, `student-info-box`,
`el-teacher-select`, `el-block-select`, `el-student-name`,
`el-err-name`, `el-err-teacher`, `el-err-block`, `EL_ENDPOINT`,
`script.google.com`, `elSetQuizMode`, `elValidateStudentInfo`,
`elQuizMode`, `mr-kankel`, `mr-rovner`, `Practice Mode`,
`Classroom Mode`, `Practice mode - score not submitted`, `Firebase`,
`httpsCallable`, `assessmentSessionsBegin`,
`assessmentSessionsAutosave`, `assessmentAttemptsFinalize`, or
`assessmentAttemptGet` appear in the v2 artifact. Asserted at build
time in `assertSignatures` and at test time across 21 dedicated
absence tests in `lesson-integration.v2.test.ts`.

### Instructional-equivalence proof

The normalized instructional contract extracted from v1 and v2
matches exactly, excluding only the declared delivery-only
differences (six v1-only DOM ids inside the legacy classroom form
and one v1-only scroll target `student-info-box`).

**Post-audit coverage repair (Sprint 18.1).** The independent audit
identified that the vocabulary, Connections, and scroll-target
extractors matched patterns that did not correspond to the canonical
Earth's Layers markup. All three extractors were rewritten:

- Vocabulary now captures every `<button|div class="glossary-card ...">`
  card: `{order, term, definition, ariaExpanded, ariaLabel, role, id,
  classList}`. Pilot count: **10 v1, 10 v2**.
- Connections and More Learning now capture every `<a|div class="cont-card
  ...">` card: `{order, tag, href, ariaLabel, name, description,
  category, status, classList}`. Pilot counts: **Connections 3 v1 / 3
  v2; More Learning 1 v1 / 1 v2**.
- Scroll destinations resolve inline `getElementById(...)`,
  variable-bound `var X = document.getElementById(...); ... X.scrollIntoView`,
  and the `querySelector(link.getAttribute('href'))` reset pattern.
  Each destination is emitted together with the enclosing named
  function so the contract distinguishes the quiz score-board
  target (`elSubmitQuiz -> el-score`), the perfect-score Continue
  target (`elSubmitQuiz -> continue`), the reset target
  (`elResetQuiz -> #quiz`), and the v1-only student-info
  target (`elSubmitQuiz -> student-info-box`).

Mutation tests in
`app/scripts/lessonBuilder/__tests__/equivalence.mutations.test.js`
prove the contract genuinely fails when any of the following is
mutated in isolation: vocabulary term, vocabulary definition,
vocabulary ordering, Connections href, Connections label,
Connections ordering, the shared quiz-score-board scroll target,
and the perfect-score Continue destination. Each failure names the
mutated field or array index.

Pilot minimums live in
`app/scripts/lessonBuilder/lessons/earths-layers.cjs`
(`pilotContractMinimums`) and are asserted by the Earth's Layers
build test: vocabulary >= 10, Connections >= 3, quiz == 10, learning
goals >= 1, SVG accessibility records >= 1, interactive ids >= 8,
required scroll targets `el-score`, `continue`, `#quiz`, required
scroll destinations for `elSubmitQuiz -> el-score`, `elSubmitQuiz
-> continue`, `elResetQuiz -> #quiz`. None of these values live in
the generic engine.

Enforced automatically inside every `buildLesson` call and by
`lessons:verify`.

## Marker registry

13 regions total: 2 HTML, 2 CSS, 8 JS V1-ONLY, 1 JS V2-ONLY.

**V1-ONLY**: `legacy-mode-toggle-markup`,
`legacy-student-info-markup`, `legacy-classroom-styles`,
`legacy-classroom-touchtarget`, `legacy-endpoint`,
`legacy-mode-state`, `legacy-set-quiz-mode`,
`legacy-mode-init-iife`, `legacy-validate-student-info`,
`legacy-classroom-validation-guard`, `legacy-practice-completion`,
`legacy-apps-script-submit`.

**V2-ONLY**: `platform-standalone-completion`.

## Corrections implemented (mandatory list)

| # | Correction | Landed in |
|---|------------|-----------|
| 1 | V2-only standalone completion branch | source `platform-standalone-completion` region + v2 output line |
| 2 | Do not relocate shared `elAssigned` declaration | markers wrap only the guard block; declaration is shared bytes |
| 3 | Split legacy tail into `legacy-practice-completion` + `legacy-apps-script-submit` | registry + source markers |
| 4 | Reuse an installed JS parser | `markerScanner.cjs` requires `acorn` 8.17 (already installed) |
| 5 | Launcher override uses `path` (not `pathTemplate`) | `launchOverrides.ts` |
| 6 | `lessons:verify` performs no file writes | `verifyLesson` is in-memory; `writeAtomically` is only called with `write=true` from the CLI |
| 7 | PID-suffixed tmp sibling, boundary validation, cleanup in finally | `paths.tmpSibling(final)` → `.<basename>.build-tmp.<pid>`; `writeAtomically` runs `safeUnlink` in `finally` |
| 8 | Only `lesson-sources/**` added to Firebase Hosting ignore; `app/lessons/**` remains deployable | `platform/firebase/firebase.json` |
| 9 | Normalized instructional-equivalence contract with actionable mismatch messages | `equivalence.cjs` `buildContract` + `assertEquivalent` |
| 10 | No empty Sprint 18 completion report | this file, written after full validation |

## Publishing-workflow sweep

- Firebase Hosting is the certified static host; `hosting.ignore` now
  includes `lesson-sources/**`. `app/lessons/**` remains served.
- Only workflow present: `.github/workflows/platform-ci.yml`. Scoped
  to `platform/**` changes; no site deploy.
- No Jekyll config, Gemfile, Netlify, Vercel, Cloudflare Pages,
  `_headers`, or `_redirects` present.
- `robots.txt`: `Allow: /`. `sitemap.xml`: unchanged. `CNAME`:
  unchanged.
- v2 URL `/app/lessons/lesson_earths-layers.html` is intentionally
  not sitemapped. It is served only via authenticated launcher.

## Launcher retarget (Sprint 18 pilot)

`app/src/assignments/studentList/launchOverrides.ts` declares:

```
{ "earths-layers": { path: "/app/lessons/lesson_earths-layers.html" } }
```

`launch.ts` consults the map. Earth's Layers assignments resolve to:

```
/app/lessons/lesson_earths-layers.html?assignment=<id>
```

Every non-piloted lesson continues to resolve to
`/lesson_<slug>.html?assignment=<id>` byte-for-byte identical to
Sprint 17.

## Test summary

| Suite | Tests |
|-------|-------|
| App Jest (all) | 34 suites / 679 tests / 100% pass |
| - `markerScanner.test.js` | 16 pass |
| - `transformer.test.js` | 6 pass |
| - `config.test.js` | 7 pass |
| - `buildLesson.earths-layers.test.js` | 9 pass |
| - `lesson-integration.v2.test.ts` | 26 pass |
| - `launch.test.ts` (Sprint 18 additions) | +2 pass |
| - `launchOverrides.test.ts` | 3 pass |
| Functions Jest | 43 suites / 953 tests / 100% pass |
| curriculum:verify | clean (units=13) |
| lessons:verify | clean (earths-layers v1+v2 match source) |
| typecheck | clean |
| lint | clean |
| esbuild `dist/bundle.js` | 1.1mb clean |
| esbuild `assets/lyfelabz-assessment-runtime-active.js` | 337.2 KB (byte-identical to Sprint 17) |

## Files added

- `lesson-sources/lesson_earths-layers.html` (canonical source)
- `app/lessons/lesson_earths-layers.html` (generated v2)
- `app/scripts/build-lessons.cjs`
- `app/scripts/lessonBuilder/index.cjs`
- `app/scripts/lessonBuilder/markerScanner.cjs`
- `app/scripts/lessonBuilder/transformer.cjs`
- `app/scripts/lessonBuilder/config.cjs`
- `app/scripts/lessonBuilder/equivalence.cjs`
- `app/scripts/lessonBuilder/paths.cjs`
- `app/scripts/lessonBuilder/lessons/earths-layers.cjs`
- `app/scripts/lessonBuilder/lessons/index.cjs`
- `app/scripts/lessonBuilder/__tests__/markerScanner.test.js`
- `app/scripts/lessonBuilder/__tests__/transformer.test.js`
- `app/scripts/lessonBuilder/__tests__/config.test.js`
- `app/scripts/lessonBuilder/__tests__/buildLesson.earths-layers.test.js`
- `app/src/runtime/lesson-integration.v2.test.ts`
- `app/src/assignments/studentList/launchOverrides.ts`
- `app/src/assignments/studentList/launchOverrides.test.ts`
- `docs/platform/SPRINT_18_IMPLEMENTATION_SPECIFICATION.md`
- `docs/platform/SPRINT_18_COMPLETION_REPORT.md` (this file)

## Files modified

- `lesson_earths-layers.html` (regenerated from canonical source; net
  change = generated notice inserted after doctype)
- `platform/firebase/firebase.json` (added `lesson-sources/**` to
  `hosting.ignore`)
- `app/package.json` (added `lessons:build`, `lessons:verify`,
  `verify` scripts)
- `app/jest.config.js` (added `scripts` root and `*.test.js` pattern
  so builder tests run alongside the app suite)
- `app/src/assignments/studentList/launch.ts` (consults
  `launchOverrides`)
- `app/src/assignments/studentList/launch.test.ts` (added two Sprint
  18 launcher cases)
- `CLAUDE.md` (added `# LESSON BUILD ARCHITECTURE` governance section)
- `CANONICAL_ARCHITECTURE_BASELINE.md` (Sprint 18 addendum paragraph)

## Files pre-existing outside Sprint 18 scope

The following files were already modified in the working tree before
Sprint 18 began (see initial `git status` snapshot) and were not
touched by this sprint:

- `extension_fossil-hunt.html`
- `extension_virus.html`
- `game_layer-detective.html`
- `investigation_gray-zone.html`
- `investigation_protein-pathway.html`
- `simulation_floatlandia-fracture.html`
- `simulation_gravity-wells.html`

## Preservation Mode compliance

The v1 public URL, HTML bytes (except the generated notice), CSS,
JavaScript, submission behavior, mode toggle, student-info form,
teacher/block selectors, Apps Script endpoint, and every existing
student-facing surface are preserved. No modernization of v1 was
performed.

## Rollback plan

`git revert <sprint-18-merge>` restores the pre-Sprint-18 v1 file,
removes the canonical source, the v2 artifact, the builder, the
launcher override, the CLAUDE.md governance section, and the
Firebase hosting-ignore addition.

Partial rollback (kill switch): remove the `earths-layers` entry from
`launchOverrides.ts`. New launches revert to the v1 URL while both
artifacts stay on disk.

## Known non-blockers, forward-looking

- The v2 URL is not sitemapped and no incoming links exist yet. That
  is by design; the launcher is the sole entry point.
- The builder is generic and scales to additional lessons via new
  `lessons/<slug>.cjs` config files. No engine change is required.
- If a future sprint activates GitHub Pages or another host, the
  canonical source directory would need to be excluded there as
  well. Firebase Hosting is the certified target today.

## Constraints respected

- Only Earth's Layers was migrated.
- No other lesson was modified.
- Firebase Functions and Firestore rules were not changed.
- No architectural blocker was encountered.
- No commit was made.
