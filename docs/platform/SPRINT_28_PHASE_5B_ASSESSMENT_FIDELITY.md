# Sprint 28 Phase 5B - Assessment Answer-Key Authoring and Fidelity Validation

Status: COMPLETE. All 49 assignable lessons now have a repository-authored,
schema-valid, fidelity-valid `<slug>.r1.json` assessment revision payload
derived faithfully from the lesson's existing canonical quiz. This phase is
repository-only. No assessment was deployed, no manifest was regenerated, no
Firebase, Google, or OAuth state changed. HEAD unchanged; nothing staged,
committed, or pushed.

Style: no em dashes. Use " - " (spaced hyphen) as the sentence break.

Companion documents:
- `SPRINT_28_PHASE_5A_V2_MIGRATION.md` (the frontend v2 migration this
  completes the publication co-requisite for)
- `SPRINT_28_CURRICULUM_MIGRATION_AUDIT.md` (the answer-key co-requisite,
  §16.2 / §16.4 of the definition)
- `ASSESSMENT_SCORING_CONTRACT.md` (§12.1 publish co-requisite)
- `platform/functions/src/assessments/assessment-deployment.ts`
  (`validateDeploymentInput`, the deployment-time schema authority)

---

## 1. Why Phase 5B exists

`assignmentsPublish` refuses a draft -> published transition unless the
referenced lesson already has a deployed assessment revision (answer key),
via `resolveCurrentAssessmentRevisionId`. Phase 5A made all 49 assignable
lessons frontend-v2-ready, but a v2-ready lesson is not production-publishable
until its answer key exists and is deployed. Phase 5B authors and
deterministically validates the required payloads in the repository so Sprint
29 can deploy a reviewed, complete set rather than authoring answer keys
during release certification.

This is a fidelity / transcription task, not an assessment redesign. The
existing canonical lesson quiz is the single authority for every payload:
question wording, answer choices, correct answer, question order, and scoring
semantics all come from the existing quiz. No science was "improved," no
wording rewritten, no answer changed.

## 2. Initial assessment inventory

The assignable surface is the 49 v2 lessons listed in
`app/src/assignments/studentList/launchOverrides.ts`. Each has a canonical
source at `lesson-sources/lesson_<slug>.html`.

| Quantity | Count |
|---|---|
| Assignable lessons | 49 |
| Existing payloads before Phase 5B | 4 |
| Existing and fidelity-valid | 4 |
| Existing but stale / mismatched | 0 |
| Missing (authored in Phase 5B) | 45 |
| Total payloads after Phase 5B | 49 |

The 4 pre-existing payloads are `earths-layers.r1.json`
(publishedBy `sprint-17-slice-5a`) and `what-is-life.r1.json`,
`cell-types.r1.json`, `biological-evolution.r1.json` (all publishedBy
`sprint-25-certification-seed`). All 4 were run through the same independent
fidelity validator built for this phase and are EXACT matches against their
canonical quiz (0 schema problems, 0 fidelity problems each). They were NOT
overwritten.

## 3. Authoring method

Extraction is STATIC and does not execute lesson JavaScript.

`app/scripts/lessonBuilder/assessmentFidelity.cjs` isolates each lesson's
inline `<script>` bodies and parses them with `acorn` into an AST. It finds
the single `<prefix>QuizQuestions` array declarator (`var` or `const`) and
STATICALLY evaluates its array literal, walking only a fixed set of literal
node types (string / number / boolean / null literals, array and object
literals, no-expression template literals, and a unary minus on a numeric
literal). Any other node type - a function call, an identifier reference, a
string concatenation, an interpolated template literal - throws, so an
ambiguous or non-static quiz literal STOPS that lesson rather than being
guessed. No `eval`, no `Function`, no `vm`, no DOM, no lesson runtime.

The canonical quiz shape is `{ q, options[], correct, explanation, visual? }`
where `correct` is a 0-based option index. The single transform to the
production payload is: `itemId = q{n}`; option ids are positional letters
(index 0 -> "A", 1 -> "B", ...); `correctOptionId` is the letter of the
canonical `correct` index; `stem`, `options[].text`, and `explanation` are
copied verbatim (no normalization). The `visual` diagram field is not part of
the answer-key schema and is intentionally not carried into the payload (see
§8). `publishedBy` is `sprint-28-phase-5b`; `revisionOrdinal` is 1;
`schemaVersion` is 1; `itemOrderingRule` is `authoredOrder`.

`app/scripts/lessonBuilder/authorAssessments.cjs` is the authoring CLI. It
processes the 45 missing lessons in review batches, and for each lesson it
extracts, transforms, schema-validates, and fidelity-checks the payload
BEFORE writing it. It never overwrites an existing payload (the 4 above are
preserved), and it refuses to write any payload that fails schema or fidelity.
Payloads are written as `JSON.stringify(payload, null, 2) + "\n"`, which
reproduces the three `sprint-25-certification-seed` payloads byte-for-byte, so
the new files match the established repository JSON convention and stay easy to
review in GitHub Desktop.

## 4. Fidelity validator (why it is not file-equals-itself)

`assessmentFidelity.checkFidelity(slug, payload, quiz)` compares a committed
payload field-by-field against a FRESH, INDEPENDENT extraction of the
canonical quiz from the lesson source. The expected semantics are re-derived
from `lesson-sources/lesson_<slug>.html` every run; they are never read back
from the payload under test. It verifies, per lesson: activityId equals the
slug; payload item count equals the canonical question count (proven in both
directions); question order (item N maps to canonical question N); exact stem
wording; choice count, order, positional option ids, and exact choice text;
the correct answer (canonical `correct` index -> letter must equal
`correctOptionId`); exact explanation text; and scoring semantics (points 1,
itemType singleChoice). Any difference is reported as a human-readable
mismatch. A negative test confirms it detects a flipped answer, an altered
stem, and a dropped question.

## 5. Payloads authored (45)

publishedBy `sprint-28-phase-5b`, revision `r1`. Grouped by the review batch.

- Batch 0 - Category A already-v2, keys pending (3): plate-tectonics,
  water-cycle, earthquakes.
- Batch 1 - Grade 6 Life Science (2): organelles, body-systems.
- Batch 2 - Grade 6 Earth & Space (7): layers-of-time, continental-drift,
  gravity, sun-earth-moon, phases-of-the-moon, eclipses,
  earths-place-in-the-universe.
- Batch 3 - Grade 6 Physical Science (7): measuring-matter,
  physical-properties, pure-substances-and-mixtures, chemical-reactions,
  nature-of-waves, wave-behavior, digital-signals.
- Batch 4 - Grade 6 Tech & Engineering (4): conducting-experiments,
  engineering-design, choosing-materials, designing-to-scale.
- Batch 5 - Grade 7 Earth & Space (4): types-of-volcanoes, hotspot-volcanoes,
  weathering-and-erosion, renewable-and-nonrenewable-resources.
- Batch 6 - Grade 7 Life Science (7): parts-of-an-ecosystem, photosynthesis,
  energy-flow, carbon-cycle, ecosystem-stability, reproductive-success,
  human-impacts.
- Batch 7 - Grade 7 Physical Science (4): forms-of-energy, energy-transfer,
  heat-transfer, introduction-to-electricity.
- Batch 8 - Grade 7 Tech & Engineering (7): design-tradeoffs,
  structural-systems, transportation-systems, communication-systems,
  engineering-systems, technology-and-society, innovation-and-sustainability.

## 6. Existing payload findings

All 4 pre-existing payloads (earths-layers, what-is-life, cell-types,
biological-evolution) are exact fidelity matches against their canonical
quiz - 0 schema problems, 0 fidelity mismatches each. None was stale, none was
mismatched, and none was modified. Their exact match also serves as a
correctness proof of the extractor: these payloads were authored and (for the
three cert lessons) deployed independently through the real deployment
pipeline in earlier sprints, and the extractor reproduces them field-for-field.

## 7. Fidelity results

- Lessons checked: 49 (49/49 assignable).
- Questions checked: 495 (48 lessons at 10 questions + body-systems at 15).
- Choices checked: 1,980 option strings (495 questions x 4) plus the
  body-systems delta already included in the 495-question total.
- Schema failures: 0.
- Fidelity mismatches: 0.

Two INDEPENDENT extraction methods were used for defense in depth and agree:
(1) the acorn AST static extractor (the authoring path and the durable test),
and (2) a separate `new Function` evaluation of the isolated array literal
(the repository's own `equivalence.cjs` pattern), run as a standalone
cross-check across all 49 lessons - 495 questions, 0 mismatches. Two different
parsers deriving the same expected semantics from the canonical source and
both matching the committed payloads.

## 8. Special cases

- **body-systems** genuinely has a 15-question graded quiz. Its canonical
  source uses all 15 entries of `bsQuizQuestions` for rendering and scoring
  (`total = bsQuizQuestions.length`). Fidelity means following the source, so
  its payload has 15 items. This is recorded, not "corrected." It is
  schema-valid (the schema requires a non-empty item set, not exactly 10) and
  publishable.
- **nature-of-waves** contains two diagram questions (Q5 crest/trough, Q9
  amplitude comparison) whose canonical `visual` field is an SVG string. The
  answer-key schema stores only `stem`, `options`, `correctOptionId`,
  `explanation`, and scoring; it has no visual field, so the SVG is
  intentionally NOT duplicated into the payload. The payload still correctly
  associates each diagram question's answer with the intended canonical
  question: Q5 canonical `correct: 2` -> `correctOptionId "C"`, and the
  question stem (including its `<strong>` markup) is preserved verbatim. The
  payload contains no `<svg` and no `visual` field. nature-of-waves was
  validated explicitly and passes both independent methods.
- **Prefix variance**: the quiz array variable name varies per lesson
  (`elQuizQuestions`, `nwQuizQuestions`, `bsQuizQuestions`, `gravQuizQuestions`,
  and so on) and is declared with `var` or `const`. The extractor matches any
  `<prefix>QuizQuestions` declarator, so no per-lesson variable name is
  hard-coded.
- **HTML markup in stems / options** (for example `<strong>...</strong>`) is
  preserved verbatim, not stripped. The answer key must match the lesson's
  quiz text exactly.

## 9. Manual spot checks

In addition to the deterministic validation, a representative sample was
inspected directly (canonical source vs generated payload):

| Sample | Slug | Result |
|---|---|---|
| Grade 6 Life Science | organelles | exact match |
| Grade 6 Life Science (15Q) | body-systems | exact match, 15 items |
| Grade 6 Earth & Space | phases-of-the-moon | exact match |
| Grade 6 Physical Science | chemical-reactions | exact match |
| Diagram lesson | nature-of-waves | exact match, no visual leaked, Q5 -> C |
| Grade 7 Life Science | photosynthesis | exact match |
| Grade 7 Earth & Space | types-of-volcanoes | exact match |
| Grade 7 Physical Science | heat-transfer | exact match |
| Grade 7 Tech & Engineering | structural-systems | exact match |
| Category A (original v2) | plate-tectonics | exact match |

## 10. Publication repository readiness

All 49 assignable lessons now have a repository-authored, schema-valid,
fidelity-valid `r1` assessment revision payload in the canonical payload
directory, discoverable by the existing deployment tooling via file path.
Every payload's `activityId` equals its lesson slug, so
`assessmentIdForLessonSlug` / `resolveCurrentAssessmentRevisionId` will resolve
correctly once deployed. Assuming Sprint 29 deployment succeeds for all 49,
each lesson will satisfy the `assignmentsPublish` answer-key co-requisite. This
is a repository-readiness conclusion, not production certification.

## 11. Sprint 29 deployment handoff

- **Payload location**: `platform/functions/src/scripts/assessments/`.
- **Count to deploy**: 49 `<slug>.r1.json` payloads (4 pre-existing + 45 new).
- **Revision convention**: `revisionOrdinal: 1`; deployed revision id is
  `assessment_<slug>__r1` (via `revisionIdForOrdinal`); assessment id is
  `assessment_<slug>`. All payloads are r1 (initial revision). None is a
  re-revision.
- **Deployment tool (DO NOT run in Phase 5B)**:
  `platform/functions/src/scripts/deploy-assessment.ts`, invoked per payload as
  `node lib/scripts/deploy-assessment.js --file=<path> --target=production
  --i-know=production` (emulator is the default target; production requires
  both the explicit target and the `--i-know=production` flag, and refuses to
  run while `FIRESTORE_EMULATOR_HOST` is set). The CLI hands the payload to the
  certified `deployAssessmentRevision` transaction, which runs the authoritative
  `validateDeploymentInput` schema validation and writes the assessment,
  revision, and answer-key documents atomically.
- **Idempotency / ordering**: `deployAssessmentRevision` refuses a duplicate
  revision (`assessmentDeployment.duplicateRevision`), so re-running a
  successful r1 deploy is safe-fail, not a double write. The 4 cert lessons
  (what-is-life, cell-types, biological-evolution) may already be deployed in
  some environments via the Sprint 25 cert seed (`cert-lessons.ts`); Sprint 29
  should treat an existing r1 as already-deployed rather than redeploying.
  Deploy order does not matter (each lesson is independent).
- **Deploy-set wiring**: `cert-lessons.ts` remains the bounded Sprint 25
  certification set (3 lessons) and was intentionally NOT expanded to 49;
  wiring the full 49-lesson production deploy set is Sprint 29 work and is a
  Functions-tooling change out of Phase 5B scope.
- **Validation command (repository-side, no mutation)**:
  `npx jest scripts/lessonBuilder/__tests__/assessment-fidelity.test.js`
  inside `app/`.

## 12. Validation results

- **Fidelity contract test** (`app/scripts/lessonBuilder/__tests__/
  assessment-fidelity.test.js`): 248 tests pass (coverage assertions + 49
  lessons x 5 checks). 0 failures.
- **Independent cross-check** (`new Function` method, standalone): 49 lessons,
  495 questions, 0 mismatches.
- **Existing Functions assessment tests**
  (`assessment-deployment`, `cert-lessons*`): 4 suites, 51 tests, 0 failures.
- **Functions typecheck**: clean (the 45 new JSON files are not imported and do
  not affect the build).
- **`lessons:verify`**: OK for all 49 configured lessons - no lesson source or
  generated artifact changed (the extractor only reads sources).
- **App typecheck**: clean. **App lint**: clean.
- **Full app suite**: 68 suites, 1888 tests, 1887 passed, 1 failed. The single
  failure is the pre-existing `curriculumManifest.test.ts` `#how` SHA drift
  (index.html and the manifest untouched; Sprint 29-owned). The new fidelity
  suite (+248 tests, +1 suite) accounts for the count delta from Phase 5A.1.

## 13. Boundaries held (no deployment, no content change)

- No assessment revision deployed. No production Firebase write. No Google /
  Classroom call. No OAuth change. No manifest regeneration.
- No canonical quiz content changed. No question, choice, correct answer,
  scoring, wording, or ordering changed in any lesson source.
- No lesson source and no generated lesson artifact changed. No launch override
  changed. No W2 results contract changed. No Assignment Detail, onboarding,
  deep-link, recipient, OAuth, Google, Functions production logic, or Rules
  change.
- The 4 pre-existing payloads were preserved unmodified.

## 14. Files changed

- 45 new `platform/functions/src/scripts/assessments/<slug>.r1.json` answer-key
  payloads.
- `app/scripts/lessonBuilder/assessmentFidelity.cjs` (static extractor,
  transform, schema mirror, fidelity comparator).
- `app/scripts/lessonBuilder/authorAssessments.cjs` (batched authoring CLI).
- `app/scripts/lessonBuilder/__tests__/assessment-fidelity.test.js` (durable
  systematic fidelity contract).
- `docs/platform/SPRINT_28_PHASE_5B_ASSESSMENT_FIDELITY.md` (this record) and a
  Phase 5B completion record appended to
  `docs/platform/SPRINT_28_IMPLEMENTATION_PLAN.md`.

No lesson source or generated lesson artifact was created or modified in
Phase 5B.

## 15. Phase 6 readiness

Sprint 28 Phase 5B is complete. The repository now carries 49/49
fidelity-valid assessment revision payloads ready for Sprint 29 deployment.
There is no Phase 5B blocker. Sprint 28 remains incomplete overall: Phase 6
(Full Deterministic Validation and Documentation Reconciliation) has not been
started, and the known `curriculumManifest.test.ts` baseline remains
Sprint 29-owned. Phase 6 is not begun here.

*End of Sprint 28 Phase 5B record.*
