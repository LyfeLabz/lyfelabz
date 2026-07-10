# Sprint 6D.0 Completion Report - Canonical Curriculum Manifest Extraction

**Date:** 2026-07-10
**Status:** Implementation complete; awaiting Technical Lead review and local verification by Chris.
**Companion documents:** SPRINT_6D_0_SPECIFICATION.md, TEACHER_EXPERIENCE_PHILOSOPHY.md (§3.9, §4.2), PRESENT_MODE_ARCHITECTURE.md (§12), TEACHER_PLATFORM_DOMAIN_ROADMAP.md (Phase 2 amendment), LYFELABZ_PLATFORM_DECISIONS.md (PDR-007, PDR-010, PDR-018), SPRINT_HISTORY.md.

---

## 1. Files Created

- `app/scripts/curriculumParser.cjs` - deterministic Node CommonJS parser. Extracts topic groups, subject blocks, unit cards, and resources from the canonical `index.html`. No external dependencies. Enforces strict-failure guarantees (see §6).
- `app/scripts/build-curriculum-manifest.cjs` - CLI entry point. Writes `curriculum.manifest.json` on default invocation; runs a byte-for-byte drift check under `--check` and exits non-zero on drift.
- `app/src/curriculum/curriculum.manifest.json` - the generated manifest artifact. Marked `"generated": true` with `canonicalSource: "index.html"` and a SHA-256 fingerprint of the parsed source (`dc46aa78b32838a59d972fc6d6c4bf786028514d995d7efd2b2dc68864101b69`).
- `app/src/curriculum/curriculumManifest.ts` - typed selector. Sole authoritative curriculum accessor for the teacher application.
- `app/src/curriculum/curriculumManifest.test.ts` - drift test plus parser strict-failure guarantees. Adds 20 new tests (+1 suite).
- `docs/platform/SPRINT_6D_0_SPECIFICATION.md`.
- `docs/platform/SPRINT_6D_0_COMPLETION_REPORT.md` (this file).

## 2. Files Modified

- `app/src/shell/surfaces/curriculum.ts` - imports `getSurfaceableLessons`, `TOPIC_LABEL`, `LessonGrade`, `LessonTopic`, and `SurfaceableLesson` from the typed selector instead of the hand-authored `lessonCatalog`. Rendering, filter logic, and activation semantics are otherwise unchanged.
- `app/package.json` - adds `curriculum:build` and `curriculum:verify` scripts.
- `docs/platform/TEACHER_PLATFORM_DOMAIN_ROADMAP.md` - records Sprint 6D.0 as a prerequisite for Sprint 6D certification.
- `docs/platform/SPRINT_HISTORY.md` - Sprint 6D entry updated with the manifest prerequisite; Sprint 6D.0 entry appended.

## 3. Files Deleted

- `app/src/shell/surfaces/shared/lessonCatalog.ts` - the manually maintained shadow registry. Removed entirely (not reduced to a thin wrapper). All curriculum reads now flow through `curriculumManifest.ts`.

## 4. Architecture Review

The certified documents reviewed were TEACHER_EXPERIENCE_PHILOSOPHY.md, PRESENT_MODE_ARCHITECTURE.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, the root `index.html` curriculum organization, and the uncommitted Sprint 6D implementation.

No conflict with the certified architecture. The sprint is the structural expression of PDR-007 and TEACHER_EXPERIENCE_PHILOSOPHY.md §3.9 (one canonical curriculum). It introduces no Firestore read, no callable, no rule change, no lifecycle field, no custom claim, no Session field, no audit vocabulary. The Session Object and protected router state machine are unchanged. The shell no-Firebase-import invariant is preserved (JSON import only; no `firebase/*` reach, no `localStorage`, no `sessionStorage`, no `document.cookie`). Preservation mode is preserved: root `index.html` is unmodified.

No architecture amendment is required.

## 5. Canonical Source and Generated-Artifact Relationship

```
root index.html                                 authoritative curriculum inventory
    |
    v
app/scripts/curriculumParser.cjs                deterministic parser
app/scripts/build-curriculum-manifest.cjs       CLI + drift-check
    |
    v
app/src/curriculum/curriculum.manifest.json     generated manifest (checked in)
    |
    v
app/src/curriculum/curriculumManifest.ts        typed selector
    |
    v
authenticated teacher application (curriculum.ts)
```

The manifest is a derived artifact. The teacher application reads only through the typed selector. Editing the manifest by hand is prohibited and detected by drift (see §7). Adding, renaming, or reorganising a lesson is a canonical-index change (edit `index.html`, then `npm run curriculum:build` inside `app/`).

## 6. Parser Behaviour and Strict-Failure Guarantees

The extractor is deliberately loud rather than silently permissive. It fails with a `[curriculum-parser]` prefix and a concrete offending value when any of the following holds:

- unrecognized `topic-group` `data-group`;
- `subject-block` `data-topic` disagrees with enclosing `topic-group` `data-group`;
- `subject-block` `data-grades` is empty, non-numeric, or lists multiple grades (the current canonical index has no multi-grade blocks; multi-grade support is a deliberate architecture decision, not a silent extractor upgrade);
- `unit-card` missing `unit-name` or `unit-desc`;
- anchor inside `.unit-links` whose ulink class is not in the canonical vocabulary;
- resource `href` that does not match its declared type's filename prefix;
- resource `href` that is a URL, an absolute path, or otherwise not a bare canonical filename;
- duplicate unit slug across the manifest;
- duplicate resource `href` across the manifest;
- non-gated `unit-card` that has neither an id nor a lesson resource (slug derivation would be ambiguous).

`legend-pill` spans inside the canonical filter box are recognized and ignored (they carry `ulink live legend-pill` classes but are not resources).

## 7. Extracted Resource Totals

From the current canonical `index.html` (SHA-256 `dc46aa78…101b69`):

**Unit totals**

- Total units (topic-group unit-cards with an id or a lesson resource): **48**
- Gated units (behavioral-science, hidden by default under `psych-locked`): **1**
- Non-gated units: **47** (matches the Sprint 6D lesson-card count expectation)

**Units by grade**

- Grade 6: 22
- Grade 7: 26

**Units by topic**

- Life Science: 12 (6/7)
- Earth & Space: 15 (7/8)
- Physical Science: 11 (7/4)
- Tech & Engineering: 9 (2/7)
- Behavioral Science: 1 (6/-) - gated

**Units by topic and grade**

- life-science/6: 5, life-science/7: 7
- earth-space/6: 7, earth-space/7: 8
- physical-science/6: 7, physical-science/7: 4
- tech-engineering/6: 2, tech-engineering/7: 7
- behavioral-science/6: 1 (gated)

**Resource counts by type**

- lesson: 48
- extension: 5
- investigation: 4
- simulation: 3
- challenge: 1
- activity: 0
- game: 0
- map: 0
- disease: 0

Total canonical curriculum resources surfaced: **61**.

## 8. Orphan and Unsurfaced Resources

The parser records placeholder unit-cards that appear inside the canonical index but currently have no id and no lesson resource. Two orphans were discovered, both inside the gated `behavioral-science` topic group:

- Behavioral Science, Grade 6, gated: 2 orphan placeholder cards (canonical titles "Cognitive Biases" and "Emotional Regulation & Social Influence"; both currently have empty `unit-links` blocks).

The parser refuses to admit an orphan from a non-gated topic group. This makes silent omission impossible in the surfaced curriculum.

No `lesson_*.html`, `extension_*.html`, `investigation_*.html`, `simulation_*.html`, `challenge_*.html`, or other resource file that exists on disk is auto-admitted into the manifest merely because it exists. The authoritative inventory remains whatever the canonical index surfaces. Files not linked from `index.html` are outside the manifest by construction. A future decision to widen the inventory is a separate certified change.

## 9. Manual Duplication Confirmation

No curriculum entry is manually authored in TypeScript or in the manifest JSON. The manifest is produced solely by `app/scripts/curriculumParser.cjs` reading the root `index.html`. Editing the JSON by hand is detected by the drift test (`checked-in manifest matches a freshly parsed canonical index.html`) and by `npm run curriculum:verify`. The typed selector (`curriculumManifest.ts`) contains type definitions and derived accessors only; it authors no curriculum entries.

## 10. Root index.html and Instructional Behaviour

`index.html` is unmodified in this sprint. Preservation mode is intact. Root lesson files, instructional copy, instructional navigation, canonical filtering behaviour, lesson rendering, and root styles are unchanged. The extractor reads `index.html` as an opaque UTF-8 string.

## 11. Repository Validation Results

`app`:

- `npm run typecheck` clean.
- `npm run lint` clean.
- `npm run build` clean (esbuild).
- `npm test`: **149 pass across 6 suites** (Sprint 6D baseline: 129 / 5; delta +20 tests, +1 suite - the new `Canonical curriculum manifest (Sprint 6D.0)` + `Canonical curriculum parser strict-failure guarantees` suites).
- `npm run curriculum:verify` clean (`manifest matches canonical index.html (units=48)`).
- `npm run curriculum:build` regenerates the manifest byte-for-byte on an unchanged canonical `index.html`.

`platform/functions`:

- `npm run typecheck` clean.
- `npm run lint` clean.
- `npm run build` clean.
- `npm test`: **295 pass across 22 suites** (unchanged).

`platform/firebase`:

- `npm run test:rules`: **94 pass across 8 suites** (unchanged).

## 12. Sprint 6D Certification Status

The original Sprint 6D implementation is now safe to resume certification. The 47 non-gated lesson-card assertion in `shell.test.ts` continues to pass unchanged, and the Sprint 6D activation-toggle, filter, and welcome-copy tests continue to pass unchanged. The prerequisite (the manually maintained shadow curriculum registry) has been replaced. Future curriculum changes flow through the canonical `index.html` and the `npm run curriculum:build` step; the drift test enforces that no future sprint can silently reintroduce a hand-authored curriculum copy.

---

## 13. Chris Local Verification Instructions

**Step 1: Navigate to the LyfeLabz repository**

```
cd ~/Documents/GitHub/lyfelabz
```

Expected: shell prompt now inside the `lyfelabz` working tree.

**Step 2: Confirm you are on the working branch with the uncommitted Sprint 6D and Sprint 6D.0 changes**

```
git status
```

Expected: working-tree changes include `app/index.html` (Sprint 6D CSS from the earlier sprint), `app/src/shell/shell.test.ts` (Sprint 6D tests from the earlier sprint), `app/src/shell/surfaces/curriculum.ts` (Sprint 6D + Sprint 6D.0), `app/package.json` (new curriculum:* scripts), plus the following Sprint 6D.0 additions: `app/scripts/curriculumParser.cjs`, `app/scripts/build-curriculum-manifest.cjs`, `app/src/curriculum/curriculum.manifest.json`, `app/src/curriculum/curriculumManifest.ts`, `app/src/curriculum/curriculumManifest.test.ts`, `docs/platform/SPRINT_6D_0_SPECIFICATION.md`, `docs/platform/SPRINT_6D_0_COMPLETION_REPORT.md`. `app/src/shell/surfaces/shared/lessonCatalog.ts` appears as deleted. `docs/platform/TEACHER_PLATFORM_DOMAIN_ROADMAP.md` and `docs/platform/SPRINT_HISTORY.md` appear as modified.

**Step 3: Enter the app package**

```
cd app
```

Expected: prompt now inside `app/`.

**Step 4: Type-check the teacher application**

```
npm run typecheck
```

Expected: exits zero with no TypeScript diagnostics.

**Step 5: Lint the teacher application**

```
npm run lint
```

Expected: exits zero with no ESLint findings.

**Step 6: Build the teacher application**

```
npm run build
```

Expected: `esbuild` writes `dist/bundle.js`. No errors.

**Step 7: Regenerate the curriculum manifest and confirm it is byte-stable**

```
npm run curriculum:build
```

Expected: prints `[curriculum-manifest] wrote src/curriculum/curriculum.manifest.json (units=48, resources=61)`.

**Step 8: Verify no drift**

```
npm run curriculum:verify
```

Expected: prints `[curriculum-manifest] OK: manifest matches canonical index.html (units=48)` and exits zero.

**Step 9: Confirm the manifest is deterministic**

```
git diff --stat src/curriculum/curriculum.manifest.json
```

Expected: no changes reported (Step 7 regenerated the exact same bytes that were checked in).

**Step 10: Run the full app test suite**

```
npm test
```

Expected: `Test Suites: 6 passed, 6 total` and `Tests: 149 passed, 149 total`. The new `Canonical curriculum manifest (Sprint 6D.0)` and `Canonical curriculum parser strict-failure guarantees` sections both report all green.

**Step 11: Validate Cloud Functions**

```
cd ../platform/functions
npm run typecheck && npm run lint && npm run build && npm test
```

Expected: all four commands exit zero. `npm test` reports `Test Suites: 22 passed, 22 total` and `Tests: 295 passed, 295 total`.

**Step 12: Validate Firestore Rules**

```
cd ../firebase
npm run test:rules
```

Expected: the Firestore emulator starts, the tests execute, and the report is `Test Suites: 8 passed, 8 total` and `Tests: 94 passed, 94 total`. The emulator shuts down cleanly.

**Step 13: Confirm preservation mode**

```
cd ../..
git diff --stat index.html
```

Expected: no changes reported. The root canonical instructional index is untouched by Sprint 6D.0.

---

*End of completion report. Do not commit. Await Technical Lead review and Chris local verification.*
