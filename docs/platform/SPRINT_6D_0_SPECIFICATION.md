# Sprint 6D.0 - Canonical Curriculum Manifest Extraction

Status: Specification.
Companion documents: TEACHER_EXPERIENCE_PHILOSOPHY.md (§3.9, §4.2), PRESENT_MODE_ARCHITECTURE.md (§12), TEACHER_PLATFORM_DOMAIN_ROADMAP.md (Phase 2 amendment), LYFELABZ_PLATFORM_DECISIONS.md (PDR-007, PDR-010, PDR-018), SPRINT_HISTORY.md.

---

## 1. Rationale

Sprint 6D introduced `app/src/shell/surfaces/shared/lessonCatalog.ts`, a manually maintained TypeScript registry of lesson slug, title, grade, and topic. That registry duplicated curriculum metadata already authored in the root `index.html`. Any future curriculum change would have required undocumented manual synchronisation between two sources, violating the one-canonical-curriculum principle (PDR-007 and TEACHER_EXPERIENCE_PHILOSOPHY.md §3.9).

Sprint 6D.0 replaces that hand-authored registry with a deterministic build-time extraction from the canonical `index.html`. The teacher application consumes only the generated manifest. The root `index.html` remains the authoritative curriculum inventory.

Sprint 6D.0 is a prerequisite for Sprint 6D certification. The general Sprint 6D scope (activation surface, filter behaviour, tests) is otherwise unchanged.

---

## 2. Canonical Relationship

```
root index.html                                 (authoritative)
    |
    v
app/scripts/curriculumParser.cjs                (deterministic parser)
app/scripts/build-curriculum-manifest.cjs       (CLI + drift-check)
    |
    v
app/src/curriculum/curriculum.manifest.json     (generated artifact)
    |
    v
app/src/curriculum/curriculumManifest.ts        (typed selector)
    |
    v
app/src/shell/surfaces/curriculum.ts            (teacher surface)
```

The manifest is a derived artifact. It carries `"generated": true`, `"canonicalSource": "index.html"`, and the SHA-256 fingerprint of the source file that produced it. Manual editing is prohibited; the drift test guards it.

---

## 3. Scope

Included:

1. `app/scripts/curriculumParser.cjs` - deterministic parser module. Pure Node CommonJS with no external dependencies so it can be shared by the CLI and by the Jest drift test.
2. `app/scripts/build-curriculum-manifest.cjs` - CLI entry point. Runs the parser, writes `curriculum.manifest.json` in stable pretty-printed JSON. `--check` mode compares the freshly parsed manifest against the checked-in JSON and exits non-zero with a clear regeneration hint on drift.
3. `app/src/curriculum/curriculum.manifest.json` - the generated artifact. Contains `schemaVersion`, `generated`, `canonicalSource`, `canonicalSourceSha256`, `doNotEditByHand`, `totals`, `topicGroups`, and `orphanUnits`.
4. `app/src/curriculum/curriculumManifest.ts` - the typed selector. Sole authoritative accessor for teacher-application code. Exposes `CURRICULUM_MANIFEST`, `TOPIC_LABEL`, `getAllUnits`, `getSurfaceableLessons`, `getTopicGroups`, `getOrphanUnits`, and the resource / unit / topic / grade types.
5. `app/src/curriculum/curriculumManifest.test.ts` - drift test plus parser strict-failure guarantees. Requires the CJS parser directly so the same code path runs at build time and at test time.
6. Rewired `app/src/shell/surfaces/curriculum.ts` to consume `getSurfaceableLessons()`. Removed `app/src/shell/surfaces/shared/lessonCatalog.ts` entirely.
7. `npm run curriculum:build` and `npm run curriculum:verify` scripts on the `app` package.

Explicitly out of scope: Present Mode, backend curriculum activation, lesson assignment, Google Classroom integration, student access controls, teacher preferences, classroom detail, student accommodations, analytics, Cloud Functions, Firestore Rules, Firestore indexes, Storage Rules, Session changes, custom claim changes, lesson content changes, public index behaviour changes.

---

## 4. Manifest Shape

```
{
  "schemaVersion": 1,
  "generated": true,
  "generatedBy": "app/scripts/build-curriculum-manifest.cjs",
  "canonicalSource": "index.html",
  "canonicalSourceRelativeToApp": "../index.html",
  "canonicalSourceSha256": "<hex>",
  "doNotEditByHand": "...",
  "totals": {
    "unitCount": <int>,
    "gatedUnitCount": <int>,
    "resourceCountsByType": { "lesson": <int>, "simulation": <int>, ... },
    "unitsByGrade": { "6": <int>, "7": <int> },
    "unitsByTopic": { "life-science": <int>, ... },
    "unitsByTopicAndGrade": { "life-science/6": <int>, ... }
  },
  "topicGroups": [
    {
      "topic": "life-science",
      "label": "Life Science",
      "gated": false,
      "displayOrder": 0,
      "units": [
        {
          "slug": "what-is-life",
          "title": "What Is Life?",
          "description": "...",
          "grade": "6",
          "topic": "life-science",
          "gated": false,
          "displayOrder": 0,
          "inGroupOrder": 0,
          "resources": [
            { "type": "lesson", "href": "/lesson_what-is-life.html", "filename": "lesson_what-is-life.html", "label": "Lesson", "displayOrder": 0 },
            { "type": "investigation", "href": "/investigation_gray-zone.html", "filename": "investigation_gray-zone.html", "label": "The Gray Zone", "displayOrder": 1 }
          ]
        }
      ]
    }
  ],
  "orphanUnits": [
    { "topic": "behavioral-science", "grade": "6", "gated": true }
  ]
}
```

Notes.

- Timestamps are intentionally omitted. Determinism is anchored by `canonicalSourceSha256` alone so that regeneration on an unchanged `index.html` produces a byte-identical file (the drift test relies on this).
- `resources[].type` is one of: `lesson`, `simulation`, `investigation`, `extension`, `challenge`, `activity`, `game`, `map`, `disease`. The manifest structurally supports every canonical LyfeLabz resource type surfaced through the ulink vocabulary.
- `orphanUnits` records unit-cards that appear inside the canonical index but currently have no id and no lesson (placeholders inside gated topic groups). The parser refuses to admit an orphan from a non-gated topic group.

---

## 5. Strict-Failure Guarantees

The extractor is deliberately loud rather than silently permissive. It fails with a `[curriculum-parser]` prefix and a human-readable message when any of the following holds:

- an unrecognized `topic-group` `data-group` value is encountered;
- a `subject-block` `data-topic` disagrees with its enclosing `topic-group` `data-group`;
- a `subject-block` `data-grades` is empty, non-numeric, or lists multiple grades (the current canonical index has no multi-grade blocks; multi-grade support requires a deliberate architecture decision, not a silent extractor upgrade);
- a `unit-card` is missing its `unit-name` or `unit-desc`;
- a `unit-card`'s `unit-links` block contains an anchor whose ulink class is not in the canonical vocabulary;
- a resource `href` does not match its declared type prefix (`lesson_*.html`, `extension_*.html`, ...);
- a resource `href` is a full URL, absolute path, or otherwise not a bare canonical filename;
- a slug collides across the manifest, or a resource href collides across the manifest;
- a non-gated topic group contains a placeholder card with no id and no lesson resource; slug derivation would be ambiguous.

Every failure short-circuits the build and prints the specific offending value. There is no soft-warning path.

---

## 6. Drift Guarantee

The drift check is enforced by two independent mechanisms:

- `npm run curriculum:verify` in the `app` package. Re-runs the extractor and diffs its output against the checked-in JSON. Exits non-zero with a clear regeneration hint. Suitable for CI.
- `app/src/curriculum/curriculumManifest.test.ts` - `checked-in manifest matches a freshly parsed canonical index.html`. Runs in the standard `npm test` suite. Also independently confirms that the SHA-256 recorded in the manifest matches the bytes of the current canonical `index.html`.

Either mechanism reports the same regeneration hint: `npm run curriculum:build` inside `app/`.

---

## 7. File Locations

The following locations were chosen after inspecting existing repository conventions.

- `app/scripts/build-curriculum-manifest.cjs` and `app/scripts/curriculumParser.cjs`. The `app/scripts/` directory is introduced by this sprint. CJS was chosen so the same module can be `require()`d by both the Node CLI and the Jest test runner without ESM interop friction. The `app` package uses ts-jest with the default CJS module output; ESM in scripts would have required either `--experimental-vm-modules` or a duplicated JS/TS parser.
- `app/src/curriculum/curriculum.manifest.json` and `app/src/curriculum/curriculumManifest.ts`. The `app/src/curriculum/` directory is introduced by this sprint. It groups curriculum-domain concerns separately from `shell/`, `session/`, `classes/`, `router/`, and `firebase.ts`, and does not pollute the shell folder tree.
- `app/src/curriculum/curriculumManifest.test.ts`. Lives with its module per repository convention.

---

## 8. Preservation Mode

The root `index.html` is not modified by this sprint. The extractor reads it as an opaque UTF-8 string. Root instructional files, root stylesheets, lesson content, canonical navigation, and the public curriculum index behaviour are unchanged.

If a future extractor upgrade would require modifying `index.html` (for example to introduce a new `data-*` attribute), that change is a repository-level curriculum decision, not a manifest-tool decision. The extractor stops and reports before making any such change.

---

## 9. Test Baseline

Sprint 6C baseline: 125 app tests / 5 suites.
Sprint 6D pre-6D.0 baseline: 129 app tests / 5 suites (delta +4).
Sprint 6D.0 baseline: 149 app tests / 6 suites (delta +20 tests, +1 suite).

Functions and Rules test totals are unchanged: functions 295 / 22, rules 94 / 8.

---

## 10. Exit Criteria

- `app/src/shell/surfaces/shared/lessonCatalog.ts` no longer exists.
- The teacher curriculum surface passes its Sprint 6D test suite unchanged (47 non-gated lesson cards).
- `npm run curriculum:build` regenerates the manifest byte-for-byte on an unchanged canonical `index.html`.
- `npm run curriculum:verify` exits zero on the checked-in manifest.
- Drift test passes as part of `npm test`.
- Parser strict-failure guarantees are exercised by unit tests.
- Root `index.html` is unchanged.
- Functions and Rules validation pass with unchanged totals.

---

*End of specification. This document defines the manifest prerequisite for Sprint 6D certification. Implementation and completion evidence are recorded in `SPRINT_6D_0_COMPLETION_REPORT.md`.*
