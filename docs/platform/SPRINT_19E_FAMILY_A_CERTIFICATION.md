# Sprint 19E - Family A Certification

## Executive Summary

Sprint 19E is a documentation-only sprint. No lesson content, builder,
transformer, marker scanner, or launcher code was modified. Four
lessons - Earth's Layers, Plate Tectonics, Water Cycle, and
Earthquakes - have been migrated to the deterministic build
architecture across Sprints 18, 19B, 19C, and 19D. This sprint
reconciles those four migrations against one another to determine
whether the architecture is stable enough to migrate the remaining
Family A lessons at an accelerated cadence before beta.

The conclusion is that the architecture is stable. Every migration
after the pilot has been a pure addition of a declarative config file
plus a launcher override entry. No engine, transformer, marker, or
equivalence change has been required since Sprint 18. All four
migrations reuse an identical shape - identical marker labels,
identical expected contexts, identical prohibited signatures, and an
identical shared identifier convention (`el-` DOM prefix,
`EL_ENDPOINT` global). The four config files differ only in slug,
canonical-source path, output paths, and a header comment.

Every Sprint 19E validation gate passes:

- `git diff --check` - clean
- `lessons:build` - deterministic, all four artifacts byte-stable
- `lessons:verify` - all four committed artifacts match a fresh build
- `curriculum:verify` - manifest matches canonical index (units=50)
- `typecheck` - clean
- `lint` - clean
- production `build` - clean
- `jest` - 692 tests pass across 35 suites

Family A is certified. Accelerated migration of the remaining 17
Family A candidates is recommended. The 29 lessons that are still on
lesson-specific identifier prefixes are architecturally identical to
Family A but require a canonical-source identifier rename before they
can adopt the current config template.

---

## Architecture Overview

The Sprint 18 build system is built from three collaborating layers.

**Layer 1 - the generic engine.** Five modules:

- `paths.cjs` - repo path resolution + atomic tmp-sibling writes
- `markerScanner.cjs` - context-strict `LYFELABZ:V1-ONLY` /
  `LYFELABZ:V2-ONLY` region parser with rejection of nested,
  overlapping, cross-context, mismatched, or comment-embedded markers
- `transformer.cjs` - deterministic region excision + generated-notice
  injection
- `equivalence.cjs` - normalized instructional-contract comparison
  between v1 and v2 outputs
- `config.cjs` - declarative-config loader, shape validator, scan
  cross-checker, and signature asserter

The engine contains no lesson identity. No `el-`, `pt-`, `wc-`, `eq-`
string appears anywhere in the engine.

**Layer 2 - declarative per-lesson config.**
`app/scripts/lessonBuilder/lessons/<slug>.cjs`. Every configured
lesson declares its paths, expected marker labels, expected marker
contexts, required and prohibited signatures per target, shared
signatures, generated-notice text, equivalence exclusions, and
lesson-specific contract minimums.

**Layer 3 - launcher override.**
`app/src/assignments/studentList/launchOverrides.ts` maps a slug to
its v2 URL. Slugs not listed in this table continue to launch to the
Sprint 17 v1 URL byte-for-byte.

The build pipeline is: canonical source -> scanner -> config
validation -> transformer -> shared signature/prohibition assertions
-> v1/v2 equivalence assertion -> atomic write to committed artifact.
The verify pipeline is identical but writes nothing and compares the
built bytes to the on-disk artifact.

---

## Migration Timeline

| Sprint | Lesson              | Result       |
|--------|---------------------|--------------|
| 18     | Earth's Layers      | Pilot; introduced engine, config format, equivalence contract, launcher override seam. |
| 19B    | Plate Tectonics     | Second migration; validated the pattern replicates. No engine changes. |
| 19C    | Water Cycle         | Third migration; no engine changes. |
| 19D    | Earthquakes         | Fourth migration; no engine changes. |
| 19E    | (none)              | Certification only. No content, no code changes. |

**Signal:** three lessons after the pilot were migrated without a
single engine, transformer, marker-scanner, equivalence, or launcher
code change. Only additions were made:

- one config file per lesson under `lessons/`
- one line per lesson added to `LESSON_LAUNCH_OVERRIDES`

---

## Family A Architecture Matrix

Direct diff of the four config files (see
`diff earths-layers.cjs earthquakes.cjs`, etc.) shows the following.

**Identical across all four lessons (invariant fields):**

| Field                         | Value / Shape |
|-------------------------------|---------------|
| `requiredLabels.v1Only`       | Same 12 labels, same order |
| `requiredLabels.v2Only`       | `["platform-standalone-completion"]` |
| `expectedContexts`            | Same 13 entries, same context assignments |
| `v2ProhibitedSignatures`      | Same 19 legacy signatures |
| `v1RequiredSignatures`        | Same 8 legacy signatures |
| `equivalenceExclusions.interactiveIds` | Same 6 `el-*` form-field ids |
| `equivalenceExclusions.scrollTargets`  | `["student-info-box"]` |
| `pilotContractMinimums`       | Same object, identical values |
| `sharedRequiredSignatures`    | Same 12 runtime + DOM identifiers |

**Varies across the four lessons (legitimate per-lesson fields):**

| Field                         | Reason for variation |
|-------------------------------|----------------------|
| `slug`                        | Identity |
| `canonicalSource`             | Points to the lesson-specific source under `lesson-sources/` |
| `outputs.v1`                  | Root-level public artifact filename |
| `outputs.v2`                  | `app/lessons/` v2 artifact filename |
| `generatedNotice.v1` / `.v2`  | Filename appears inside the notice body |
| Header comment                | Sprint number + lesson name |

**Nothing else varies.**

The `pilotContractMinimums` field, originally introduced to house
Earth's Layers-specific expected counts, has been copy-forwarded
identically to every subsequent lesson. Every migrated lesson has:
`vocabularyMin: 10`, `connectionsMin: 3`, `quizExactCount: 10`,
`learningGoalsMin: 1`, `svgAccessibilityMin: 1`,
`interactiveIdsMin: 8`, the same three required scroll targets, and
the same three required scroll destinations.

This is the strongest architectural signal available: after three
independent migrations, the shape of a Family A config is a fixed
template.

---

## Invariant Architecture vs Lesson-Specific Variation

### True invariants (architecture)

The following are properties of the *architecture*, not of a lesson.
They should never be edited on a per-lesson basis:

- The 12 v1-only region labels and their contexts
- The single v2-only region label (`platform-standalone-completion`)
- The v2 prohibited signature set (legacy classroom-mode markers)
- The v1 required signature set (legacy classroom-mode markers)
- The `equivalenceExclusions` shape (legacy student-info DOM ids +
  the `student-info-box` scroll target)
- The shared runtime-integration signatures (the assessment runtime
  `<script>` tag and the four `window.lyfelabz.lessonQuiz.*` entry
  points)
- The `pilotContractMinimums` values (they are Family A minimums,
  not Earth's Layers minimums)

### Legitimate lesson-specific configuration

- `slug`, paths, and generated-notice text

That is the entire surface of legitimate per-lesson variation for
Family A. Every other field in the current config template is either
an invariant that happens to be repeated for readability or a
convention Family A adopted at the pilot.

### Should any of this be abstracted away?

**No.** The user's directive is explicit: do not invent abstractions
because repetition exists. The current shape has three properties
that justify keeping duplication over a factory or a base config:

1. **Readability at the point of authorship.** A lesson author
   opening `earthquakes.cjs` can see the full contract that lesson is
   bound to, without cross-file lookups.
2. **Explicit diff surface for reviewers.** When a new lesson is
   added, the reviewer's diff shows the entire config, and any
   accidental deviation is visible.
3. **Cheap to correct later.** If a real second family of lessons
   appears with a different shape, we will only know which fields
   are truly invariant by watching multiple families evolve. Freezing
   defaults into the engine now would trade a certainty (the current
   readable shape) for a guess (about what Family B will need).

The one qualified exception is `pilotContractMinimums`. The name is
now misleading - these are Family A minimums, applied to every
Family A migration - but the fix is a rename (not now, not this
sprint) rather than a hoist. Renaming without a triggering need is
also out of scope for a documentation sprint.

---

## Configuration Contract

For each field in the current config, this is the classification the
sprint charter requested.

| Field                                | Classification    | Notes |
|--------------------------------------|-------------------|-------|
| `slug`                               | Required          | Identity; validated against filename. |
| `canonicalSource`                    | Required          | Path to `lesson-sources/lesson_<slug>.html`. |
| `outputs.v1`                         | Required          | v1 artifact at repo root. |
| `outputs.v2`                         | Required          | v2 artifact under `app/lessons/`. |
| `generatedNotice.v1` / `.v2`         | Required          | Emitted immediately after doctype. |
| `requiredLabels.v1Only`              | Required (Family A: candidate default) | Same 12 labels for every Family A lesson so far. |
| `requiredLabels.v2Only`              | Required (Family A: candidate default) | Always `["platform-standalone-completion"]`. |
| `expectedContexts`                   | Required (Family A: candidate default) | Deterministic from the label set. |
| `v2ProhibitedSignatures`             | Usually required  | Legacy classroom-mode signatures; same across Family A. |
| `v1RequiredSignatures`               | Usually required  | Legacy classroom-mode signatures; same across Family A. |
| `sharedRequiredSignatures`           | Usually required  | Runtime + DOM identifiers; identical across Family A because Family A shares the `el-` prefix convention. |
| `equivalenceExclusions.interactiveIds` | Usually required | The six legacy student-info form ids. |
| `equivalenceExclusions.scrollTargets` | Usually required | `["student-info-box"]`. |
| `pilotContractMinimums`              | Candidate default (Family A) | Same values every time; rename earned but not urgent. |

**Never a default:** `slug`, `canonicalSource`, `outputs`,
`generatedNotice`. These *are* the identity of a lesson.

**Why not hoist the "candidate default" fields into the engine
today?** Because we still only have one lesson family. Making a
default now decides Family B's contract before we have met Family B.
Wait until at least one other family has migrated. Then a hoist has a
grounded shape rather than a projected one.

---

## Builder Stability Assessment

Question: does a fifth Family A migration require any change beyond
adding a config file and a launcher override entry?

Prediction, based on the four completed migrations:

| Change type                | Required for future Family A lesson? |
|----------------------------|--------------------------------------|
| builder engine edits       | No                                   |
| transformer edits          | No                                   |
| marker scanner edits       | No                                   |
| equivalence contract edits | No                                   |
| launcher edits             | Only the one-line slug entry.        |
| new config file            | Yes - one file, ~148 lines, template. |

Certification: **the Family A builder architecture is stable.** All
four migrations after the pilot were pure additions. No refactor,
migration-driven engine tweak, or one-off patch was needed for any of
the three follow-on lessons.

---

## Equivalence Stability Assessment

The equivalence module normalizes and compares 15 categories between
v1 and v2: titles, headings, learning goals, vocabulary cards, image
and SVG accessibility, Show Your Thinking, quiz questions, option
ordering, correct-answer indices, explanations, scoring messages,
More Learning cards, Connections cards, interactive ids, scroll
targets, scroll destinations, runtime include, and lesson-quiz call
sites.

The four Family A lessons all pass this contract with the same shape
of `equivalenceExclusions` - six legacy form-field ids plus the
`student-info-box` scroll target. No lesson has needed a new
exclusion category since Sprint 18.

Certification: **the equivalence contract is stable for Family A.**

---

## Marker Stability Assessment

The context-strict marker grammar has been exercised by four
different canonical sources across HTML, CSS, and JS contexts, with
the same 12 v1-only labels and single v2-only label. The scanner
rejects the full list of shape violations documented in `CLAUDE.md`
(wrong syntax for context, nesting, overlap, cross-context, duplicate
label, undeclared label, unbalanced, mismatched label, mismatched
target, markers inside JS strings or template literals or regex
literals, HTML-style comments inside `<script>` or `<style>`).

No new marker label has been added since Sprint 18. No context
reassignment has been needed. No lesson has required an ad-hoc
exception.

Certification: **the marker grammar is stable for Family A.**

---

## Runtime Stability Assessment

Every Family A lesson successfully integrates with the certified
assessment runtime through the same shared surface:

- `<script defer src="/assets/lyfelabz-assessment-runtime.js"></script>`
- `window.lyfelabz.lessonQuiz.autosave`
- `window.lyfelabz.lessonQuiz.finalize`
- `window.lyfelabz.lessonQuiz.hasAssignmentContext`

No lesson required a runtime patch to complete migration.

Certification: **runtime integration is stable for Family A.**

---

## Launcher Stability Assessment

`launchOverrides.ts` grew from 1 entry (Sprint 18) to 4 entries
(Sprint 19D) as a pure append. No structural change to `launch.ts`,
no new type on `LessonLaunchOverride`, no new field. The narrow
data-driven seam is the correct shape.

Certification: **launcher integration is stable for Family A.**

---

## Beta Readiness Assessment

### Technical risk: low.

Four independent migrations across four different Grade 7 Earth
Systems topics used exactly the same architectural template. The
engine has not required a change since the pilot. There is no
outstanding architectural question about how a fifth Family A
migration would land.

### Maintenance burden: low.

Each new lesson adds ~148 lines of declarative config plus one line
of launcher override. Nothing in the engine grows. The verify path
prevents drift automatically.

### Regression risk: bounded.

The equivalence contract enforces instructional identity between v1
and v2 on every build. The launcher continues to route non-listed
slugs to v1 byte-for-byte. Any slug not added to the override table
sees no behavior change.

### Validation burden: low.

The full validation gate (`lessons:build`, `lessons:verify`,
`curriculum:verify`, `typecheck`, `lint`, production build, `jest`)
already runs and passes on every commit. Adding a lesson does not
extend the gate; it adds one more slug to the same gate.

### Expected migration cadence.

With no engine work required, a Family A migration reduces to:

1. Re-template the lesson's canonical source into `lesson-sources/`
   with the standard marker regions and the shared identifier
   convention.
2. Copy `earthquakes.cjs` to `<slug>.cjs`, swap the four identity
   fields.
3. Run `lessons:build` and `lessons:verify`.
4. Add one line to `launchOverrides.ts`.

Realistic cadence, per lesson, once the canonical source is in place:
minutes. The canonical-source preparation is the dominant cost.

### Remaining unknowns.

- Whether Family B (lessons that use lesson-specific DOM prefixes
  like `cd-`, `pt-`, `nw-`) will migrate as a straight config change
  or will need a small addition to the shared-signature contract.
- Whether Grade 6 lessons (`what-is-life`, `nature-of-waves`, ...)
  have any pedagogical section that the current equivalence
  categories do not already cover.

Neither unknown blocks accelerated migration of the 17 remaining
Family A candidates.

**Recommendation: the deterministic lesson system is beta-ready for
Family A expansion.** Migrate the remaining Family A lessons before
opening any other lesson family.

---

## Remaining Migration Strategy

Repository inspection of all 50 lesson artifacts identifies three
groups.

### Migrated (4)

`earths-layers`, `plate-tectonics`, `water-cycle`, `earthquakes`.

### Family A candidates (17)

Lessons whose current v1 artifact already uses the `el-` DOM prefix
convention and the `EL_ENDPOINT` legacy classroom-mode endpoint.
These lessons match the signature shape encoded in every current
config, one-for-one:

`carbon-cycle`, `communication-systems`, `design-tradeoffs`,
`ecosystem-stability`, `energy-flow`, `engineering-systems`,
`hotspot-volcanoes`, `human-impacts`, `innovation-and-sustainability`,
`introduction-to-electricity`, `parts-of-an-ecosystem`,
`photosynthesis`, `renewable-and-nonrenewable-resources`,
`structural-systems`, `technology-and-society`,
`transportation-systems`, `weathering-and-erosion`.

**Classification: high confidence. Expected work: configuration
only.** No architectural work expected. Each of these should reduce
to a canonical-source copy into `lesson-sources/` with markers added,
plus a config-file clone.

### Family A-adjacent (29)

Lessons whose current v1 artifact uses a lesson-specific DOM prefix
and endpoint (e.g. `CD_ENDPOINT`, `NW_ENDPOINT`, `WL_ENDPOINT`). The
architecture is identical - same legacy classroom-mode shape, same
runtime include, same instructional structure - but the identifier
strings differ.

Grouped by prefix family:

- **Grade 7 Earth Systems (still to migrate):** `continental-drift`,
  `layers-of-time`, `types-of-volcanoes`.
- **Grade 7 Energy Systems:** `forms-of-energy`, `energy-transfer`,
  `heat-transfer`.
- **Grade 7 Ecosystems:** `biological-evolution`,
  `reproductive-success`.
- **Grade 7 Engineering:** `engineering-design`, `choosing-materials`,
  `designing-to-scale`, `conducting-experiments`.
- **Grade 7 Ragebaiting unit:** `ragebaiting`.
- **Grade 6:** `what-is-life`, `nature-of-waves`, `wave-behavior`,
  `digital-signals`, `cell-types`, `organelles`, `body-systems`.
- **Grade 8:** `gravity`, `earths-place-in-the-universe`, `eclipses`,
  `phases-of-the-moon`, `sun-earth-moon`, `chemical-reactions`,
  `measuring-matter`, `physical-properties`,
  `pure-substances-and-mixtures`.

**Classification: moderate confidence. Expected work: either (a) a
canonical-source rename to the `el-` convention followed by a
Family A config, or (b) a small change to the config template to
carry the lesson prefix as a parameter across the shared,
prohibited, and required signature sets.** Option (a) requires no
engine change and preserves the current template. Option (b)
requires a small parametric extension of the signature declarations
and pushes the prefix decision back to the lesson.

Recommendation: default to (a) for the 17 Family A candidates first,
then choose (a) or (b) for the Family A-adjacent group only after
completing the high-confidence 17. A larger sample size makes the
(a)-vs-(b) decision better-informed.

### Migration order recommendation

1. Complete the 17 high-confidence Family A candidates.
2. Re-evaluate whether the config template should carry a prefix
   parameter.
3. Migrate the 29 Family A-adjacent lessons under whichever shape
   Step 2 chooses.

---

## Validation Results

Executed on 2026-07-21 against `main` at `263109c`.

| Gate                  | Result |
|-----------------------|--------|
| `git diff --check`    | Clean. |
| `lessons:build`       | 4 lessons built; 8 artifacts written; hashes stable. |
| `lessons:verify`      | 4 lessons verified; all v1 + v2 artifacts match canonical build. |
| `curriculum:verify`   | Manifest matches canonical index; units=50. |
| `typecheck` (`tsc --noEmit`) | Clean. |
| `lint` (`eslint`)     | Clean. |
| production `build`    | `dist/bundle.js` produced. |
| `jest`                | 692 tests, 35 suites, all pass. |

Pre-existing working-tree modifications on `extension_*`, `game_*`,
`investigation_*`, and `simulation_*` HTML files are unrelated to the
Sprint 19E scope and were left untouched.

---

## Certification Statement

The deterministic lesson build architecture introduced in Sprint 18
and exercised through Sprints 19B, 19C, and 19D is certified as a
production-ready migration architecture for Family A lessons.

- No engine, transformer, marker scanner, equivalence, or launcher
  code change has been required since the pilot.
- All three follow-on migrations were pure additions of a
  declarative config plus a one-line launcher override.
- All four migrated lessons pass every validation gate on `main`.
- All four config files converge on an identical shape apart from
  four identity fields.

Accelerated migration of the remaining 17 high-confidence Family A
lessons before beta is recommended. Migration of the 29
Family A-adjacent lessons is deferred until at least a subset of the
17 has completed and the template's prefix decision (rename vs
parameterize) is grounded in evidence.

---

## Commit Recommendation

This is a documentation-only sprint. The recommended commit contains
this single file:

```
docs/platform/SPRINT_19E_FAMILY_A_CERTIFICATION.md
```

Suggested commit message:

```
Sprint 19E: Certify Family A deterministic lesson architecture
```

Nothing else is intended to be committed by this sprint. The
pre-existing working-tree modifications on unrelated
`extension_*.html`, `game_*.html`, `investigation_*.html`, and
`simulation_*.html` files predate this sprint and are outside its
scope.
