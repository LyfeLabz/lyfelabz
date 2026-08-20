# Sprint 28 Phase 6 - Full Deterministic Validation and Documentation Reconciliation

Status: COMPLETE, READY FOR PHASE 7 (with the single, fully explained,
Sprint 29-owned curriculum-manifest exception). Phase 6 is a validation
and evidence-reconciliation phase. No browser certification was run, no
deployment was made, no feature was introduced. This phase is
repository-only. HEAD unchanged; nothing staged, committed, or pushed;
no Firebase, Google, or OAuth state changed.

Style: no em dashes. Use " - " (spaced hyphen) as the sentence break,
per repository standard.

Companion documents:
- `SPRINT_28_DEFINITION.md` (Phase 0 scope, amended Phase 2C)
- `SPRINT_28_ARCHITECTURAL_BLUEPRINT.md`
- `SPRINT_28_IMPLEMENTATION_PLAN.md` (Phase 6 objective, Phase 7 matrix)
- `SPRINT_28_CURRICULUM_MIGRATION_AUDIT.md`
- `SPRINT_28_PHASE_5A_V2_MIGRATION.md`
- `SPRINT_28_PHASE_5B_ASSESSMENT_FIDELITY.md`
- `SPRINT_27_COMPLETION_REPORT.md` (deterministic baseline of record)

---

## 1. Baseline

- Branch: `main`.
- HEAD: `425f667` ("Complete Sprint 27 student classroom lifecycle").
  Unchanged by Sprint 28; all Sprint 28 work is intentionally
  uncommitted for Chris to review and commit manually.
- Staged: nothing. Committed in Phase 6: nothing. Pushed: nothing.
- Working tree: 257 changed paths (66 modified tracked, 191 untracked,
  0 deleted). This is the expected large uncommitted Sprint 28 surface,
  not dirty-state corruption. Every path maps to a known Sprint 28
  workstream (see §2). No path falls outside the mapped workstream
  directories.

## 2. Working-tree reconciliation (change inventory by workstream)

All 257 paths classify cleanly:

| Group | Count | Paths |
|---|---|---|
| W1 Assignment Detail | 4 | `app/src/assignments/detail/detail.ts` (M), `detail.o1-lifecycle.test.ts` (new), `late-recipient.test.ts` (M), `app/src/assignments/deepLink/arrival.test.ts` (M) |
| W4 launch/routing seams | 4 | `app/src/assignments/studentList/launchOverrides.ts` (M), `launchOverrides.test.ts` (M), `launch.test.ts` (M), `app/src/router/surfaces/surfaces.test.ts` (M) |
| W3 onboarding self-heal | 2 | `platform/functions/src/students/students-complete-onboarding.ts` (M), `students-complete-onboarding.test.ts` (M) |
| W4 canonical sources | 49 | `lesson-sources/lesson_<slug>.html` (4 M + 45 new) |
| W4 v2 artifacts | 49 | `app/lessons/lesson_<slug>.html` (4 M + 45 new) |
| W4 builder configs | 49 | `app/scripts/lessonBuilder/lessons/<slug>.cjs` (4 M + 45 new) |
| W4 v1 artifacts (regenerated) | 45 | root `lesson_<slug>.html` (M; the 45 Category B migrations) |
| Assessment fidelity (Phase 5B) | 45 | `platform/functions/src/scripts/assessments/<slug>.r1.json` (new) |
| Assessment fidelity tooling | 4 | `app/scripts/lessonBuilder/assessmentFidelity.cjs`, `authorAssessments.cjs`, `__tests__/assessment-fidelity.test.js`, `__tests__/w2-results-contract.test.js` |
| Documentation | 6 | `docs/platform/SPRINT_28_*.md` |

Sum: 4 + 4 + 2 + 49 + 49 + 49 + 45 + 45 + 4 + 6 = 257. Verified.

The 4 pre-existing assessment payloads (`earths-layers`, `what-is-life`,
`cell-types`, `biological-evolution`) are tracked, committed, and
unmodified (0 modified tracked JSON), consistent with Phase 5B.

Unexplained files: none.

## 3. Sprint 28 implementation status (reconciled to current repository evidence)

- **W1 Assignment Detail (O1, O5): IMPLEMENTED.** `detail.ts` renders the
  provenance-agnostic Close/Reopen lifecycle controls (O1 confirmed as a
  no-suppression path, not a backend gap) and now renders the O5 calm
  informational note for `closed` and `draft` lifecycle states
  (`renderLateRecipientLifecycleNote`, "This assignment is closed.
  Reopen it to add students." / publish-first for draft), an add-success
  confirmation, and `aria-live="polite"` announcements for the status
  region and in-flight state. Frozen-recipient semantics unchanged; no
  automatic or bulk addition; no speculative Close/Reopen production
  change. Covered by `detail.o1-lifecycle.test.ts` (permanent LMS-shaped
  lifecycle regression) and `late-recipient.test.ts` (visibility, states,
  add flow, "Sprint 28 O5 confirmation and accessibility"). Both green.
- **W2 results/navigation (O2, O3): IMPLEMENTED across all 49 assignable
  v2 lessons.** The hardened results pattern (`scroll-margin-top` offset
  for the sticky chrome, focus move to the results heading,
  `role="status"`/`aria-live` announcement, assignment-context-gated
  `Back to My Assignments` to `/app/`, v1 preservation) is generated from
  canonical sources and enforced by the W2 contract suite (49 lessons,
  539 tests, green). v1/practice/standalone behavior is unchanged.
- **W3 manual onboarding claims self-heal (O4): IMPLEMENTED.**
  `students-complete-onboarding.ts` reads the caller's own claims
  (`readCustomClaims`) in the idempotent branch and re-asserts
  `role: "student"`, `schoolId`, `districtId` only when missing or stale,
  deriving `districtId` server-side from the RECORD `schoolId`
  (`resolveSchoolDistrictId`), failing closed on an empty schoolId, with
  no second `students.activated` audit event and a bounded no-op when
  healthy. It mirrors the certified LMS self-heal. No new client
  authority field. Covered by `students-complete-onboarding.test.ts`
  (green, inside the 1708 Functions total).
- **W4 curriculum v2 migration: COMPLETE at 49/49.** 49 canonical
  sources, 49 builder configs, 49 v2 artifacts, 49 launch overrides,
  and the 45 regenerated root v1 artifacts. `nature-of-waves` (Phase
  5A.1) resolution holds: it is configured, built, overridden, and
  fidelity-valid, producing a clean 49/49 hardened curriculum. The
  marker scanner is unchanged and passes (see §4).
- **Assessment fidelity (Phase 5B): COMPLETE.** 49 payloads (4
  pre-existing unmodified + 45 authored), 49 unique `activityId`s (each
  equal to its slug), 495 items, 1,980 options, 0 schema failures, 0
  fidelity mismatches, no malformed JSON, no deployment. `publishedBy`
  distribution: 45 `sprint-28-phase-5b`, 3 `sprint-25-certification-seed`,
  1 `sprint-17-slice-5a` (= 49). All `revisionOrdinal: 1`,
  `schemaVersion: 1`.

No prior report conflicts with the current repository state. Every
count in the Phase 5A, Phase 5A.1, and Phase 5B records reproduces
exactly against the tree.

## 4. Lesson-system results

- Configured v2 lessons: 49.
- `lessons:build` (full): exit 0; 98 artifacts written; a byte-for-byte
  before/after `git status --porcelain` comparison shows ZERO drift (257
  paths before, 257 identical paths after). The build is deterministic;
  the committed artifacts equal a fresh build.
- `lessons:verify` (full, non-mutating): exit 0; "OK verify" for all 49
  lessons; 0 failures. This is the instructional-equivalence + marker +
  config + signature contract for both targets, and it passes for every
  lesson.
- Marker scanner / config / transformer / equivalence-mutation suites:
  green (`markerScanner.test.js`, `config.test.js`, `transformer.test.js`,
  `equivalence.mutations.test.js`, `buildLesson.earths-layers.test.js` all
  PASS inside the app suite).
- W2 hardened-results contract: `w2-results-contract.test.js`, 49 lessons
  enumerated, 539 tests, 0 failures.

## 5. Assessment results

- Payload count: 49 (`platform/functions/src/scripts/assessments/<slug>.r1.json`).
- Unique `activityId`s: 49 (each equals its lesson slug; no extras beyond
  the 49 surfaceable slugs).
- Questions (items): 495 (48 lessons at 10 questions + `body-systems` at
  15). Verified directly from JSON.
- Choices (options): 1,980. Verified directly from JSON.
- Correct-answer integrity: all 495 items carry a `correctOptionId` that
  matches one of that item's option ids (0 invalid). Position spread A/B/
  C/D = 96/158/161/80 (a faithful transcription of the existing quizzes,
  not a re-authoring).
- Schema result: single consistent top-level shape across all 49
  (`activityId`, `revisionOrdinal`, `itemOrderingRule`, `schemaVersion`,
  `publishedBy`, `items`); 0 malformed JSON.
- Fidelity result: `assessment-fidelity.test.js`, 49 lessons, 248 tests,
  0 failures (asserts `SLUGS.length === 49`, re-derives expected
  semantics from `lesson-sources/`, compares field-by-field).
- Repository publication readiness: 49/49. Every surfaceable slug has all
  six prerequisites present (launch override + v2 artifact + builder
  config + canonical source + v1 artifact + `<slug>.r1.json` payload),
  with no extra override and no extra payload. This is repository
  publication readiness, not production publication certification;
  deployment is Sprint 29.

## 6. App validation

- Typecheck: `tsc --noEmit`, exit 0 (clean).
- Lint: `eslint --ext .ts src`, exit 0 (clean).
- Jest (full): 68 suites (67 passed, 1 failed), 1,888 tests (1,887
  passed, 1 failed).
- The single failure is `src/curriculum/curriculumManifest.test.ts` ->
  "checked-in manifest matches a freshly parsed canonical index.html".
  This is the known, pre-existing O6 manifest SHA drift. See §9 for the
  precise, verified explanation. Every other test, including all
  structural manifest sub-tests (surfaceable-lesson count 49, unique
  slugs/hrefs, topic-group order, orphan units, resource totals), passes.
- The suite count grew from the Sprint 27 baseline (65 suites / 1092
  tests) through legitimate Sprint 28 additions (W1 O1 lifecycle + O5
  polish tests, launch-override and surface tests, the W2 contract suite,
  and the assessment-fidelity suite). No new deterministic failure
  appeared; the failing set is exactly the one known manifest red.

## 7. Functions validation

- Typecheck: `tsc --noEmit`, exit 0 (clean).
- Lint: `eslint --ext .ts src`, exit 0 (clean).
- Jest (full): 91 suites passed / 91 total; 1,708 tests passed / 1,708
  total; 0 failures.
- This equals the Phase 4 baseline exactly (91 / 1,708 / 0). The 45 new
  assessment JSON payloads are data files, not imported by the build and
  not test files, so they add zero suites and zero tests, and the count
  is unchanged. The deployment-schema authority `validateDeploymentInput`
  (`assessment-deployment.ts`) and the `cert-lessons*` deploy/resolve
  paths are covered within this green total.

## 8. Rules validation

- Command: `npm run test:rules` in `platform/firebase`
  (`firebase emulators:exec --only firestore "jest"`, local ephemeral
  emulator, no production state).
- 18 suites passed / 18 total; 228 tests passed / 228 total; 0 failures.
- Matches the baseline exactly. Sprint 28 changed zero Firestore rules
  (`firestore.rules` is unmodified in the working tree).

## 9. Manifest status (the single known exception, precisely explained)

- **Original drift.** The manifest JSON
  (`app/src/curriculum/curriculum.manifest.json`) was last regenerated in
  commit `c8fe03e` (Sprint 21), recording
  `canonicalSourceSha256 = eca04df9...`. The root `index.html` was last
  changed in commit `4fd2bab` ("Fix How It's Built anchor offset"), which
  added exactly one cosmetic CSS line (`scroll-margin-top: 80px` on the
  marketing `#how` rule), confirmed by `git log -S`. That change post-dates
  the manifest regeneration and moved the live index.html hash to
  `20a1ad33...` without a manifest rebuild.
- **Verified scope of the failure.** A field-by-field diff of a fresh
  `buildManifest()` against the checked-in manifest shows the ONLY
  differing field is `canonicalSourceSha256` (fresh `20a1ad33...` vs
  stored `eca04df9...`). Every curriculum data field (topic groups,
  units, resources, the 49 surfaceable lessons, totals) is byte-identical.
  The test throws on the whole-object JSON comparison purely because the
  fresh manifest embeds the new SHA.
- **Sprint 28 adds no additional manifest staleness.** `index.html` is
  UNCHANGED in the Sprint 28 working tree (`git status` clean for it), and
  the HEAD index.html hash equals the working-tree hash equals the live
  fresh hash (`20a1ad33...`). W4 changed generated lesson artifacts (root
  v1, `app/lessons/` v2) and the launch-override table, none of which is
  the manifest's canonical source. Per definition §16.8 the migration does
  not touch `index.html` or the manifest SHA, and the evidence confirms it:
  the manifest data the migration could have affected (surfaceable-lesson
  set, hrefs, totals) is identical between fresh and checked-in. The red is
  entirely the pre-existing cosmetic `#how` line and nothing else.
- **Why regeneration remains Sprint 29-owned.** Regenerating the manifest
  (`npm run curriculum:build` inside `app/`) would update only the SHA and
  re-green the test, blessing a known benign change. The Sprint 27
  completion report and the roadmap assign the intentional final manifest
  regeneration and complete deterministic baseline to Sprint 29 release
  certification, after all release content is frozen. Sprint 28 does not
  regenerate it. This report changed no manifest artifact, SHA, source, or
  test.

## 10. Scope-drift audit

- No unauthorized feature expansion: all 257 paths are within the mapped
  W1/W2/W3/W4 + Phase 5B fidelity + docs directories; none outside.
- No config accidents: `firestore.rules`, `firebase.json`, `.firebaserc`,
  hosting config, and any deploy config are UNCHANGED. `index.html`,
  `sitemap.xml`, and the curriculum manifest are UNCHANGED.
- No OAuth, Google Classroom, recipient-domain, or deep-link-resolver
  changes.
- No secrets, keys, tokens, `.env`, `.log`, `.tmp`, scratchpad artifacts,
  debug logs, `.DS_Store`, or editor backups in the tree.
- V1 preservation: across the 45 regenerated root v1 files, no quiz
  question literal, option array, or `correct` index was changed (targeted
  diff grep found zero instructional/answer-key edits); the only additions
  are the GENERATED FILE notice and the shared assignment-aware runtime
  wiring. No instructional prose was removed. 0 em dashes across all 143
  changed lesson HTML files. The instructional-equivalence contract
  (`lessons:verify`) and the fidelity suite jointly prove v1/v2 and
  payload/source equivalence.
- Marker scanner not weakened: `markerScanner.test.js` green; the scanner
  source is unchanged.

Anomalies discovered: none.

## 11. External-state boundary

No deployment or external mutation of any kind. No Functions deploy, no
Hosting deploy, no Rules deploy, no assessment revision deploy, no
production Firestore write, no Google Classroom call, no OAuth grant
change, no secret rotation. The assessment deploy CLI
(`deploy-assessment.ts`) has no pure validate/dry-run mode (every non-help
invocation performs a write, emulator or production), so it was NOT run;
the deployment schema is instead validated deterministically by the
fidelity suite and the `assessment-deployment` / `cert-lessons` Functions
tests. The only emulator used was the local ephemeral Firestore emulator
for the standard Rules suite.

## 12. Phase 7 readiness disposition

Sprint 28 satisfies every deterministic pre-browser gate:

- Lesson system deterministically green (`lessons:build` no drift;
  `lessons:verify` 49/49).
- 49/49 W2 contract green; 49/49 assessment fidelity green.
- App has no new failures beyond the fully explained, Sprint 29-owned
  manifest exception.
- Functions green (91 / 1,708 / 0). Rules green (18 / 228 / 0).
- No unexplained working-tree files; no scope drift; docs reconciled.
- No remaining deterministic blocker.

Disposition: COMPLETE, READY FOR PHASE 7. The one documented limitation
carried forward is the curriculum-manifest SHA regeneration, owned by
Sprint 29. Assessment deployment and production certification are also
Sprint 29. Phase 7 (browser certification) is not begun here.

*End of Sprint 28 Phase 6 record.*
