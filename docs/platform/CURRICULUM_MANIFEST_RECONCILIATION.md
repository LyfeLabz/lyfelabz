# Curriculum Manifest Reconciliation

## Background

Sprint 17 was certified with one documented accepted baseline failure:
`app/src/curriculumManifest.test.ts` reported drift between the checked-in
canonical curriculum manifest and the freshly parsed root `index.html`. This
document records the post-Sprint 17 repository-health cleanup that resolves
that baseline.

## Original Failing Assertion

`Canonical curriculum manifest (Sprint 6D.0) > checked-in manifest matches a
freshly parsed canonical index.html`, which threw:

```
Curriculum manifest drift detected between root index.html and
app/src/curriculum/curriculum.manifest.json. Regenerate with
`npm run curriculum:build` inside app/.
```

Regenerating produced a `unitCount` of 50 (was 48) and a Grade 6
`tech-engineering` count of 4 (was 2). Two lesson entries were absent from the
checked-in manifest:

- `lesson_choosing-materials.html` (Choosing Materials, Grade 6, tech-engineering)
- `lesson_designing-to-scale.html` (Designing to Scale, Grade 6, tech-engineering)

After regenerating the manifest, a second stale count assertion surfaced:

- `getSurfaceableLessons ... includes one entry per non-gated lesson unit`
  expected 47 but received 49.

A third stale count in `app/src/shell/shell.test.ts` (`renders a lesson card
for every lesson in the catalog`) expected 47 but received 49.

## Root Cause

The two Grade 6 tech-engineering lessons were added to the canonical
`index.html` (they exist as fully authored lesson HTML files in the repository
root and appear under the Tech and Engineering topic block in `index.html`),
but `npm run curriculum:build` was not re-run at the time. Two Jest count
assertions were also frozen against the pre-addition inventory of 47
surfaceable lessons.

Last manifest regeneration on record: `5528f0e` (Sprint 6G). The two new
Grade 6 tech-engineering lessons entered the repo before Sprint 17 Slice 1
(`5fdfa30`).

## Authoritative Sources Reviewed

- `index.html` (root canonical curriculum source)
- `app/src/curriculum/curriculum.manifest.json` (generated)
- `app/src/curriculum/curriculumManifest.ts` (loader and typed API)
- `app/src/curriculum/curriculumManifest.test.ts` (contract)
- `app/scripts/build-curriculum-manifest.cjs` (generator)
- `lesson_choosing-materials.html` and `lesson_designing-to-scale.html`
  (confirmed present at repo root, referenced by the tech-engineering
  subject-block in `index.html`)
- `app/src/shell/shell.test.ts` (stale count consumer)
- Git history for the manifest and the two new lesson files

## Authoritative-Source Decision

Per the generator's own header (`doNotEditByHand`), the checked-in manifest
is a derived artifact of the root `index.html`. The two new lessons are
present as real, authored files and are correctly declared in the canonical
`index.html` tech-engineering block. The manifest is stale; the canonical
index and the on-disk lesson files are correct.

Reconciliation direction: bring the manifest and dependent test counts up to
match the canonical `index.html`. Do not delete, hide, or reclassify the two
new lessons, and do not weaken any assertion.

## Files Changed

- `app/src/curriculum/curriculum.manifest.json` - regenerated via
  `npm run curriculum:build`. Adds `choosing-materials` and `designing-to-scale`
  units under `tech-engineering/6`, updates counts and downstream display
  ordering, refreshes `canonicalSourceSha256`.
- `app/src/curriculum/curriculumManifest.test.ts` - updates the exact
  surfaceable-lesson count from `47` to `49`. The structural assertion above
  it (surfaceable count equals the count of non-gated units with a lesson
  resource) is retained as the primary contract.
- `app/src/shell/shell.test.ts` - updates the rendered lesson-card count from
  `47` to `49` to match the current non-gated lesson inventory.

## Files Created

- `docs/platform/CURRICULUM_MANIFEST_RECONCILIATION.md` (this document).

## Exact Correction

1. Ran `npm run curriculum:build` inside `app/` to regenerate the manifest
   from the canonical `index.html`.
2. Updated the two frozen count assertions (`curriculumManifest.test.ts:109`
   and `shell.test.ts:315`) from `47` to `49`.

No manifest fields were hand-edited. No lesson HTML content was changed. No
generator, loader, or shell rendering logic was modified.

## Why This Is Product-Correct, Not Test-Only

The manifest is a generated projection of the canonical `index.html`. The
canonical index already declares the two Grade 6 tech-engineering lessons,
the lesson files exist, and the surface renders 49 lesson cards. Updating
the checked-in manifest to match the canonical source, and updating the two
stale exact-count assertions to match the intended current inventory of 49
non-gated lessons, is the accurate reconciliation. The structural
assertion - surfaceable count equals the number of non-gated units with a
lesson resource - is retained.

## Validation Results

- Focused: `npx jest curriculumManifest` - 20/20 passing.
- App Jest: `npx jest` - 610/610 passing across 28 suites.
- Lint: `npm run lint` - clean.
- Typecheck: `npm run typecheck` - clean.
- App build: `npm run build` - succeeded (`dist/bundle.js` 1.1mb).
- `npm run curriculum:verify` - no drift reported.

Functions suite and Rules suite were not re-run: no Functions or Rules
files changed as part of this reconciliation.

## Confirmation

The Sprint 17 accepted baseline for `curriculumManifest.test.ts` is
resolved. The app test suite is fully green with no remaining accepted
baseline failures.

## Remaining Curriculum Inventory Risks

None identified as part of this reconciliation. The generator continues to
be the single source of truth for the manifest, and `npm run
curriculum:verify` remains available as a pre-commit check to catch future
drift the moment it appears.
