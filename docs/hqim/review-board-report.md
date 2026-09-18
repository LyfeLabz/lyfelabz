# Internal Review Board Report: HQIM Self-Evaluation

LyfeLabz Grade 6-7 Science, evaluated against the EQuIP Rubric for Science
(version 3.0) and the Massachusetts DESE CURATE STE rubric in preparation for
formal HQIM submission through the EdReports gateway and the CURATE process.

Evidence base: `docs/grade6-coverage-map.md` and `docs/grade7-coverage-map.md`
(both generated 2026-09-14 from a full repository badge scan),
`docs/hqim/standards-alignment-narrative.md`, `docs/hqim/scope-and-sequence.md`,
`docs/curriculum/concept-families.md`, `docs/curriculum/gap-unit-build-specs.md`,
`docs/platform/CURRENT_PLATFORM_STATE.md`, and direct inspection of the
repository's 106 root instructional pages (50 lessons, 5 investigations, 4
simulations, 7 challenges, 7 extensions, 7 games, 8 system pages, 8 disease
pages, plus hub and about pages). This report was prepared 2026-09-17. Grade 6
is evaluated as the standalone primary submission unit; Grade 7 is evaluated
separately as the presented extension.

---

## Executive Summary

Grade 6 is submittable now on coverage grounds and close to submittable on
quality grounds. All 22 Grade 6 performance expectations of the Massachusetts
2016 STE Framework carry Primary coverage, verified by machine scan and a June
2026 standards-code correction pass, with a documented scope and sequence, a
ratified concept-family spine, teacher-facing Educator Mode panels in all 50
lessons, and an assessment platform whose server-side finalization and
immutable attempt records exceed what reviewers will have seen from most
digital programs. The three Grade 7 gap units (covering 7.MS-PS3-1, PS3-2,
PS3-3, and LS2-5) do not gate the Grade 6 submission at all, because every
gap standard is a Grade 7 standard and Grade 6 stands alone by design. What
changes after the gap units are built is the strength of the Grade 7 extension
claim: today Grade 7 is honestly a 21-of-28 program with a specified build
roadmap, and after the three units land it becomes a 25-of-28 program with
three near-miss Partials remaining, which converts the extension from a
disclosure into a selling point.

The single most important thing to address before submission is the absence of
explicit three-dimensional documentation. The program enacts the three
dimensions - disciplinary core ideas are badged on every page, science and
engineering practices are built into the predict-then-reveal architecture, and
the crosscutting structure-and-function and systems-and-cycles themes organize
both years - but almost nothing in the repository names a science and
engineering practice or a crosscutting concept as such. A grep across all 50
lessons finds exactly one mention of crosscutting concepts and zero of the
phrase "science and engineering practice." EQuIP Gateway 1 is a screening
gate: reviewers who cannot find the three dimensions identified and
intentionally developed will not score the deeper gateways, however good the
underlying design is. A lesson-by-lesson three-dimensional alignment map
(PE, SEPs engaged, CCCs engaged, and where in the lesson each appears) is a
documentation artifact, not a rebuild, and it is the highest-leverage
pre-submission work item in this report.

---

## EQuIP Gateway 1: Designed for the NGSS/MA STE

### Criterion 1.1: Coherent and appropriate three-dimensional learning

**Rating: Partially Meets**

The disciplinary-core-idea dimension is the program's strongest. Every
instructional page carries explicit grade-prefixed standards badges
(`6.MS-*` / `7.MS-*`), machine-scanned into `docs/grade6-coverage-map.md` and
`docs/grade7-coverage-map.md`, and the June 2026 cleanup documented in
`docs/standards-code-cleanup-report.md` validated every code against the
official framework. Above-grade content is labeled rather than hidden:
`lesson_chemical-reactions.html` frames atomic rearrangement as explicit
8.MS-PS1-5 enrichment, and `investigation_cell-energy.html` and the eight
disease pages label their 8.MS-LS1-7 material the same way. The
practices dimension is genuinely enacted even where it is not named:
`lesson_nature-of-waves.html` contains over two hundred predict-and-reveal
occurrences in which students develop and use models before vocabulary is
introduced, `investigation_amplitude-challenge.html` runs a
claim-evidence-reasoning structure with student data collection,
`investigation_population-patterns.html` is built around the analyze-data verb
of 7.MS-LS2-1, and the Floatia capstone (`challenge_welcome-to-floatia.html`)
has students build, test, and defend a prototype. The crosscutting dimension
is present at the architectural level: the framework's own Structure and
Function (Grade 6) and Systems and Cycles (Grade 7) themes organize the scope
and sequence, and `docs/curriculum/concept-families.md` ratifies a
seven-family spine that is essentially a crosscutting-concept map under
another name.

The honest gap is that none of this is identified as three-dimensional
learning anywhere a reviewer will look. Across all 50 lessons there is one
mention of crosscutting concepts and no use of the phrase "science and
engineering practice"; the Educator Mode panels explain instructional design
rationale (why each section exists, in learning-science terms) but do not name
which SEP or CCC a section develops. EQuIP reviewers are instructed to find
evidence that the three dimensions are intentionally selected and work
together, and intent must be documented to be credited. The mitigation is a
documentation pass, not a rebuild: a three-dimensional alignment map keyed to
the existing badge scan, plus one SEP/CCC line added to each lesson's Educator
Mode instructional-design panel through the `lesson-sources/` build pipeline.

### Criterion 1.2: Lessons connect grade-band endpoints to specific PEs

**Rating: Meets**

This is the program's most defensible criterion. Every lesson badges the
specific PE it targets, the coverage maps distinguish Primary from Partial
from Tangential depth with the judgment basis stated (learning-goal cards and
educator notes, not topic inference), and assessment boundaries are actively
policed: `lesson_continental-drift.html` stays within the ESS2-3 boundary of
evidence rather than mechanism, `lesson_digital-signals.html` stays
qualitative per the PS4-3 boundary, and the Grade 6 map's Notes and Caveats
section flags residual risks by count (roughly 80 atom/molecule references in
the chemical-reactions lesson) rather than asserting cleanliness. The
taught-versus-assessed distinction is documented inside the materials
themselves: the Floatia capstone's educator notes state which standards it
applies without re-teaching and which one (6.MS-ETS2-3(MA)) it assesses.
Vertical articulation to grade-band endpoints is inspectable rather than
asserted, most concretely in `lesson_plate-tectonics.html`, which badges both
6.MS-ESS2-3 and 7.MS-ESS2-2 by design, and in the ten bridge points tabulated
in `docs/hqim/scope-and-sequence.md`.

Two small polish items remain and are disclosed here rather than discovered
later: four files carry un-prefixed legacy codes (`game_layer-detective.html`,
`investigation_amplitude-challenge.html`, `investigation_cell-energy.html`,
`simulation_gravity-wells.html`, the last of which carries an above-grade
MS-ESS1-2 tag that should be removed or relabeled as enrichment), and the
Grade 6 map itself specifies the fix for each. These are hours of work, not a
gap in the design.

### Criterion 1.3: Phenomena drive the learning, not topics or vocabulary

**Rating: Meets**

The phenomenon-first commitment is the program's stated instructional
philosophy and it is verifiable in the artifacts, not just the documentation.
The shared architecture (mystery-driven entry, prediction before revelation,
vocabulary earned after observation) is defined in
`docs/hqim/standards-alignment-narrative.md`, enforced as a design contract in
`docs/curriculum/gap-unit-build-specs.md` for all future builds, and visible
in the gold-standard lessons: `lesson_nature-of-waves.html` opens on
phenomena and carries its prediction-reveal cycle through the entire Explore
phase, and `lesson_digital-signals.html` is structured as an argument
launched by the phenomenon of a degrading analog signal. The gap-unit specs
show the same discipline applied prospectively: the Energy in Motion unit
opens on an unexplained collision asymmetry, the thermal unit on two
identical-looking cups with radically different ice retention, the estuary
unit on a dying bay with no visible polluter, and in each case the target
term (kinetic energy, eutrophication) is introduced only after the reveal.
The engineering strand substitutes authentic design problems for natural
phenomena, which EQuIP explicitly accepts for engineering-oriented PEs.

The honest caveat is coverage breadth of the pattern. The claim is airtight
for the gold-standard lessons and the documented anchors; it has not been
audited lesson by lesson across all 50, and some of the Grade 7 ETS3 systems
lessons and the body-system reference pages are likely closer to structured
exposition than to phenomenon-driven inquiry. A pre-submission spot audit of
the eight to ten lessons most likely to be sampled by reviewers, against the
entry-phenomenon standard the gap-unit specs codify, would convert this from
a well-supported claim into a verified one.

---

## EQuIP Gateway 2: Designed for Deep Learning

### Criterion 2.1: Sense-making and explaining phenomena is central

**Rating: Meets**

The predict-then-reveal interaction pattern is a sense-making engine: the
student commits to a prediction, observes the outcome, and reconciles the
difference, which is precisely the making-sense-of-phenomena cycle Gateway 2
looks for. The evidence is dense in the flagship materials.
`lesson_nature-of-waves.html` runs the cycle continuously; the matter cluster
(`lesson_measuring-matter.html`, `lesson_physical-properties.html`,
`lesson_pure-substances-and-mixtures.html`) has students meet one particulate
model three times with increasing demand, which is sense-making distributed
across lessons rather than within one; and the gap-unit specs demonstrate that
the pattern is a governing contract, specifying committed predictions (the
mass-versus-speed wager, the graph-shape sketch plotted against real data, the
silver-bullet wager in the estuary simulation) whose reveals are designed to
break specific misconceptions. Vocabulary-after-observation, enforced
repository-wide by the CLAUDE.md vocabulary rules and the standard lesson
order, keeps terminology subordinate to understanding rather than the object
of instruction.

No significant gap. The same breadth caveat from Criterion 1.3 applies (the
pattern's density varies across the 50 lessons), but sense-making as the
central activity is well evidenced.

### Criterion 2.2: Students use evidence to construct explanations

**Rating: Partially Meets**

Strong instances exist. `investigation_amplitude-challenge.html` uses an
explicit claim-evidence-reasoning structure with student-collected data.
`lesson_gravity.html` carries the claim-and-evidence core of 6.MS-PS2-4, and
`lesson_digital-signals.html` has students assemble evidence for the PS4-3
claim. The Floatia capstone's defend-your-decisions stage and the Choosing
Materials closing constructed-response prompt generate written explanation
evidence for the engineering strand. The planned gap units deepen this
further: the PS3-2 Evaluate task requires students to model an unseen system
and write an explanation, and the LS2-5 assessed artifact is a structured
written recommendation with a mandatory benefits-and-limitations analysis of
options the student did not choose.

The honest gap is documented in the program's own audit: the Grade 6 coverage
map's Gap List states that 6.MS-LS1-3 and 6.MS-LS4-2, both explicit
argumentation standards, have deep content coverage but no culminating
written-argument task per standard, so the assessed-verb alignment is implicit
rather than demonstrable. Similarly, 6.MS-PS1-6 carries a plan-and-conduct
verb served by a reading lesson, and the Grade 7 map's verb-alignment
watch-list names PS3-4, LS2-5, and ETS1-4 as PEs whose lab and design verbs
currently lack assessed hands-on evidence. Most student-constructed
explanation is currently captured through selected-response quizzes rather
than constructed response. The remediation path is narrow and specified: one
written-argument task each for LS1-3 and LS4-2, and a hands-on
exothermic/endothermic investigation for PS1-6.

### Criterion 2.3: Assessment is integrated and three-dimensional

**Rating: Partially Meets**

Integration is genuine. Every lesson ends with a ten-question quiz mixing
DOK 1 and DOK 2 with answer explanations (the repository quiz rules mandate
this, and all 50 lessons carry a quiz), Quick Recall provides a mid-lesson
formative checkpoint in the standard lesson order, and the platform's
assessment behavior is formative by design: unlimited formative attempts,
submit-equals-completion, and an Improve My Score offer on any less-than-
perfect best score (`docs/platform/CURRENT_PLATFORM_STATE.md`, Section 9).
Because every assessed page carries standards badges, each attempt record is
evidence against a named PE. Assessment integrity is a category strength
covered under CURATE Dimension 3 below.

The gap is dimensionality. The quiz architecture assesses primarily the DCI
dimension through selected response; performance assessment of practices
exists mainly at the two engineering capstones (Floatia's prototype defense,
Choosing Materials' constructed response) and in the specified-but-unbuilt
gap-unit tasks (graph construction from novel data for PS3-1, model
construction for PS3-2, design defense for PS3-3, evaluation argument for
LS2-5). A reviewer applying Gateway 2's three-dimensional-assessment lens
will find the DCI dimension consistently assessed, the practices dimension
assessed at the capstones and thin elsewhere, and the CCC dimension
essentially unassessed as such. The gap-unit builds materially improve this
for Grade 7; for Grade 6 the same two additions named in Criterion 2.2 (the
written-argument tasks and the PS1-6 investigation) are the remediation.

### Criterion 2.4: Scaffolding supports diverse learners

**Rating: Partially Meets**

The universal baseline is strong and uniform. All 50 lessons carry the
canonical `a11y-canonical` and `mobile-canonical` style blocks (verified by
grep), giving every page safe-area padding, coarse-pointer touch-target
minimums, and consistent responsive behavior at the three canonical
breakpoints; all 50 respect `prefers-reduced-motion`, provide skip links, and
manage `aria-expanded` on vocabulary cards; the repository accessibility
rules mandate short paragraphs, high contrast, one vocabulary card open at a
time, and educational `aria-label`s on informational SVGs. Multi-modal entry
points (lessons, investigations, simulations, games, extensions) give
students multiple routes into the same DCI, with the cells cluster offering
seven distinct experiences of LS1-1/LS1-2.

The honest gaps are three. First, there are no language supports for
multilingual learners anywhere in the lesson catalog: no translation,
read-aloud, or text-to-speech capability exists (a text search for these
across all lessons matches only CSS transform functions). Second, the
platform's persistent student differentiation feature (reading accessibility
and presentation variants with teacher-granted launch accommodations) is
implemented through Slice 6 and staging-certified, but its teacher activation
UI is held dark in production (`G19_GATE_OPEN = false` in `app/src/index.ts`)
and differentiated delivery is disabled in production. It must be represented
to reviewers as planned capability, not current capability. Third, scaffolding
is uniform rather than tiered: there are no leveled reading alternatives or
documented supports for students below grade-level reading. The remediation
path for the second gap is the already-written production certification
runbook (`DIFFERENTIATION_PRODUCTION_CERTIFICATION_RUNBOOK.md`); the first
and third require new work.

---

## EQuIP Gateway 3: Designed for Classroom Use

### Criterion 3.1: Teacher support materials

**Rating: Partially Meets**

The program's teacher support is unusual in form but real in substance. Every
one of the 50 lessons ships with Educator Mode, a teacher-facing overlay
(hidden from students, toggled per session) that reveals per-section
Instructional Design panels explaining why each section exists and what it is
doing pedagogically, plus the Learning Science Focus block beneath every hero
citing the research basis for the lesson's design moves (dual coding per
Noetel et al. 2022, scaffolding per Kirschner et al. 2006, and similar).
Educator notes document the taught-versus-assessed boundary at the Floatia
capstone. At the curriculum level, `docs/hqim/scope-and-sequence.md` gives
teachers unit ordering, prerequisites, and per-unit rationale, and the
platform provides teacher workspace tooling (class creation, Google Classroom
import and roster sync, assignment publication, per-assignment monitoring)
that most print-plus-PDF programs cannot match.

The honest gap is that this support lives inside the product rather than in
the standalone teacher-guide format reviewers expect to sample. There is no
pacing guide with day-level or week-level time estimates, no printable
unit-level teacher guide, no anticipated-student-thinking or common-
misconception notes beyond what individual Educator Mode panels contain, no
materials list for the hands-on challenges, and no guidance on facilitating
the discussions the argumentation standards imply. The June 2026 readiness
audit scored teacher usability at zero; Educator Mode and the scope and
sequence have moved this substantially, but a reviewer-facing teacher-guide
artifact (even one generated by consolidating the existing Educator Mode
content per unit) is needed to fully meet the criterion.

### Criterion 3.2: Differentiation guidance

**Rating: Does Not Meet**

This is the report's most clear-cut negative finding, and it should be
disclosed rather than argued. The materials contain no guidance to teachers
on differentiating instruction: no extension pathways labeled for advanced
students beyond the general More Learning layer, no modification guidance for
students with IEPs or 504 plans, no strategies for multilingual learners, and
no guidance on using the formative signal from quizzes to regroup or reteach.
The platform's differentiation feature is the designed answer, and its
engineering is far along (Slices 1 through 6 implemented and
staging-certified, per `docs/platform/CURRENT_PLATFORM_STATE.md`), but it is
dark in production and, critically, it is a delivery mechanism rather than
teacher guidance; even fully activated, it would not by itself supply the
instructional guidance this criterion asks for. The remediation path has two
legs: satisfy the G19 production gate and activate the differentiation
feature per its certification runbook, and author a differentiation-guidance
layer (plausibly as an Educator Mode extension, reusing the existing
teacher-facing panel architecture) covering supports, extensions, and
language access per unit. Neither leg blocks a Grade 6 submission whose
disclosures are honest, but this criterion will not score above Does Not Meet
until the guidance exists.

### Criterion 3.3: Coherent instructional sequence across the unit

**Rating: Meets**

Coherence is documented at three levels and enforced at one.
`docs/hqim/scope-and-sequence.md` sequences Grade 6 as nine units following
the framework's Structure and Function scale trajectory from cells to
engineered systems, with explicit prerequisites and a stated rationale for
every unit's position (fossils-as-biology deliberately precede
fossils-as-dating-tool; the engineering lessons exist so the capstone can
apply without re-teaching). `docs/curriculum/concept-families.md` ratifies
the seven-family spine that makes the two-year arc one design, with
deliberate dual-family assignments documented as pedagogy rather than
ambiguity. The Connections layer gives students conceptually-related lesson
cards governed by repository rules that prohibit generic navigation language,
so the coherence is visible to students, not only to reviewers. At the
enforcement level, the standard lesson order (Hero through Evaluate, then
Quiz, More Learning, Connections) is a repository-wide invariant, and the
deterministic lesson build (`lesson-sources/` canonical source, verified
generated outputs, CI drift detection) guarantees that the public and
authenticated deliveries of every pipeline lesson are instructionally
equivalent. One honest note: the scope and sequence was authored in September
2026 as a documentation pass over an existing catalog, and the concept
families' provenance note says plainly that they were inferred from the
built curriculum and then ratified. The sequence is real and teachable; a
reviewer who asks whether the curriculum was built to the sequence or the
sequence written to the curriculum should receive the honest answer that the
program converged on it, with the framework's own integration themes as the
common cause.

---

## CURATE STE Evaluation

### Dimension 1: Alignment to MA STE Standards

**Rating: Strong (Grade 6); Developing (Grade 7 extension)**

Grade 6 coverage is complete and audited: 22 of 22 performance expectations
at Primary depth across all four disciplines, up from 20 of 22 in July 2026
after the Choosing Materials assessment and Floatia capstone closed
ETS2-2(MA) and ETS2-3(MA). All five MA-specific Grade 6 codes (ESS1-5(MA),
PS1-7(MA), PS1-8(MA), and four of the six ETS codes) have dedicated Primary
coverage, which matters for CURATE specifically because MA-only standards are
where nationally-developed programs fail this dimension. Grade-band
appropriateness is actively managed rather than assumed: the June 2026
cleanup removed invalid codes, the 2026-09-14 pass corrected the
photosynthesis lesson from the nonexistent 7.MS-LS1-6 to 7.MS-LS2-3, seasons
and natural-selection content are correctly held out of Grade 6 per the
framework's grade assignments, and above-grade material is labeled as
enrichment. The remaining Grade 6 weaknesses are quality items already
disclosed in this report: ETS2-3(MA) is assessed only at the capstone with no
standalone tools-and-fabrication lesson, PS1-6 lacks lab-based evidence for
its experimental verb, and four files carry un-prefixed legacy codes.

Grade 7, evaluated honestly as the extension, stands at 21 of 28 standards at
Primary (75 percent), with three Partials and four true gaps: 7.MS-PS3-1,
PS3-2, and PS3-3 forming one energy-of-motion cluster, and 7.MS-LS2-5. The
gaps are specified to build-contract level in
`docs/curriculum/gap-unit-build-specs.md`, and two of the three Partials
(ETS1-4 and ETS1-7(MA)) need badging and formalized data capture on the
existing ball-run sequence rather than new construction. The extension's
differentiator is the complete five-lesson ETS3(MA) technology-systems suite,
a strand that exists only in the Massachusetts framework and that
nationally-developed programs routinely omit; for a CURATE review this is
direct evidence of authorship to the Massachusetts standards. Grade 7 should
be presented with its coverage arithmetic stated plainly, exactly as the
coverage map states it.

### Dimension 2: Instructional Design Quality

**Rating: Strong**

The design quality case rests on a documented architecture applied
consistently, not on isolated good lessons. Phenomena-driven entry,
predict-then-reveal interaction, and vocabulary-after-observation are stated
philosophy (`standards-alignment-narrative.md`), enforced contract
(`gap-unit-build-specs.md` binds every future build to them), and verifiable
artifact (the gold-standard lessons implement them at high density, with
`lesson_nature-of-waves.html` as the strongest single exemplar). Student
sense-making is the central activity per the Gateway 2 analysis above.
Sequence coherence is documented at unit, family, and two-year-arc levels
with an inspectable vertical articulation table of ten bridge points, the
best of which (`lesson_plate-tectonics.html` badging both grades' codes;
digital signals feeding communication systems) are visible in the files
themselves. The learn-then-apply engineering arc, with its documented
taught-versus-assessed boundary, is a structure CURATE reviewers rarely see
made this explicit. The residual weaknesses are the ones already rated above:
the three-dimensional design is enacted but not labeled (Criterion 1.1), and
the phenomenon-first pattern's density across all 50 lessons is asserted from
the anchors rather than audited file by file (Criterion 1.3). Neither
weakness is a design-quality defect so much as a documentation and
verification debt, which is why this dimension rates Strong while Gateway 1
Criterion 1.1 rates Partially Meets.

### Dimension 3: Assessment Quality

**Rating: Developing, with one component of national-exemplar quality**

Formative assessment integration is real and uniform: Quick Recall
checkpoints and a ten-question DOK-mixed quiz with answer explanations in
every lesson, unlimited formative attempts with submit-as-completion, and an
Improve My Score pathway that makes retrying a designed behavior rather than
a loophole. Summative evidence of learning is the developing part: it
currently consists of the quizzes plus a small set of performance artifacts
(the Floatia prototype defense, the Choosing Materials constructed response),
and the program's own coverage maps concede that the argumentation and
experimental verbs of LS1-3, LS4-2, and PS1-6 lack matching assessed tasks.
The gap-unit specs show the intended summative direction (graph construction
from unseen data, model construction on novel systems, design defenses,
evaluation arguments), but for Grade 6 those improvements are not yet built.

Assessment integrity is where the platform is genuinely exceptional, and the
review board should present it as such. Per
`docs/platform/CURRENT_PLATFORM_STATE.md` Sections 9 and 11: student attempts
are finalized server-side by a dedicated Cloud Function that is the sole
writer of attempt records; attempts are immutable and ownership-stamped with
student, class-at-submission, lesson slug, and assessment revision; scoring
is server-authoritative against confidential answer keys that Firestore
Security Rules refuse to every client role including platform administrators;
no client-authoritative score ever enters an attempt; assessment revisions
are immutable with prior revisions kept readable so historical attempts stay
interpretable; and the audit log is append-only for every role. The backend
carries a certified test baseline of 91 suites and 1708 passing Functions
tests plus emulator-run security-rules suites. The practical claim for
reviewers: the student work a district examines is exactly the work as
submitted, at the moment it was submitted, and no party can alter it after
the fact. Most static or LMS-embedded curricula cannot make this guarantee.
The dimension nevertheless rates Developing overall because CURATE weighs
evidence of learning, and integrity of thin evidence is still thin evidence;
the written-argument tasks and the PS1-6 investigation are what move this
rating.

### Dimension 4: Equity and Access

**Rating: Developing**

The access baseline is broad and verifiable. The entire instructional layer
is public, free, and readable anonymously with no runtime dependency on
authentication, which is an equity property in itself: a student with any
browser, including a shared or family device, can use every lesson.
Universal design is enforced repository-wide rather than per-lesson: the
canonical accessibility and mobile style blocks in all 50 lessons, three
canonical responsive breakpoints with coarse-pointer touch-target minimums,
reduced-motion support, skip links, keyboard-navigable vocabulary cards with
correct ARIA state, high-contrast short-paragraph content rules, and
educational aria-labels on informational SVGs. Multiple means of engagement
are structural: each concept cluster offers lessons, investigations,
simulations, games, and extensions as distinct entry points, and Present Mode
provides a separate whole-class instructional surface.

The honest gaps keep this at Developing. There are no multilingual supports
of any kind in the catalog: no translated materials, no glossary supports for
multilingual learners, no read-aloud or text-to-speech capability. There are
no leveled reading alternatives. And the persistent differentiation feature,
the platform's designed answer to individualized access, must be disclosed as
implemented-but-dark: Slices 1 through 6 are staging-certified, the teacher
activation UI exists behind a closed gate (`G19_GATE_OPEN = false`), the
production certification gate is not yet satisfied, and differentiated
delivery is disabled in production. Representing this feature as anything
other than planned capability would be the kind of overclaim that costs a
submission its credibility; representing it accurately, with the staging
certification and production runbook as evidence of engineering maturity, is
a defensible good-faith position. Remediation order: activate
differentiation per its runbook, then author the multilingual-learner support
plan, which is the largest genuinely new build in this dimension.

---

## Submission Readiness Matrix

| Criterion | Rating | Blocking? | Remediation Path |
|---|---|---|---|
| EQuIP 1.1 Three-dimensional learning | Partially Meets | Yes (Gateway 1 is a screening gate) | Author a lesson-by-lesson SEP/CCC alignment map; add one SEP/CCC line to each lesson's Educator Mode panel via the lesson-sources pipeline. Documentation pass, no rebuild. |
| EQuIP 1.2 Grade-band endpoints to specific PEs | Meets | No | Normalize un-prefixed legacy codes in the four flagged files; remove or relabel the above-grade tag in simulation_gravity-wells.html. |
| EQuIP 1.3 Phenomena drive the learning | Meets | No | Spot-audit the eight to ten most-likely-sampled lessons against the entry-phenomenon standard codified in the gap-unit specs. |
| EQuIP 2.1 Sense-making is central | Meets | No | None required; carry the predict-then-reveal evidence (density counts in gold-standard lessons) into the submission narrative. |
| EQuIP 2.2 Evidence-based explanations | Partially Meets | Yes (for a competitive submission) | Build one culminating written-argument task each for 6.MS-LS1-3 and 6.MS-LS4-2; build the hands-on exo/endothermic investigation for 6.MS-PS1-6. |
| EQuIP 2.3 Integrated, three-dimensional assessment | Partially Meets | No (formative layer and integrity carry entry) | Same three Grade 6 tasks as 2.2; gap units carry the Grade 7 half. Add performance-task rubrics to the two existing capstone artifacts. |
| EQuIP 2.4 Scaffolding for diverse learners | Partially Meets | No | Activate differentiation per production runbook; author multilingual-learner supports; document the existing UDL baseline as a submission artifact. |
| EQuIP 3.1 Teacher support materials | Partially Meets | No | Consolidate Educator Mode content into per-unit teacher guides; add pacing estimates and materials lists for hands-on challenges. |
| EQuIP 3.2 Differentiation guidance | Does Not Meet | Yes (for CURATE competitiveness; entry possible with disclosure) | Author per-unit differentiation guidance (supports, extensions, language access); satisfy G19 gate and activate the platform differentiation feature. |
| EQuIP 3.3 Coherent instructional sequence | Meets | No | None required; scope-and-sequence and concept-family docs are submission-ready. |
| CURATE 1 Alignment to MA STE | Strong (G6) / Developing (G7) | No for Grade 6; Grade 7 gaps block only the extension claim | Grade 6: badge normalization only. Grade 7: build the three gap units per gap-unit-build-specs.md; badge the ball-run sequence for ETS1-4/1-7(MA). |
| CURATE 2 Instructional design quality | Strong | No | Inherits the 1.1 documentation pass and 1.3 spot audit. |
| CURATE 3 Assessment quality | Developing | Yes (for a competitive submission) | Same as EQuIP 2.2/2.3; present the immutable-attempt integrity architecture as a named differentiator with the platform-state doc as evidence. |
| CURATE 4 Equity and access | Developing | No (with honest disclosure) | Differentiation activation; multilingual support plan; leveled-reading strategy. Disclose the dark feature accurately. |

---

## Recommended Submission Sequence

Grade 6 should be submitted without waiting for the three gap units, because
the gap units are Grade 7 builds and Grade 6 is standalone-complete by
design: all four gap standards (7.MS-PS3-1, PS3-2, PS3-3, 7.MS-LS2-5) are
Grade 7 performance expectations, and no Grade 6 coverage claim depends on
them. Delaying the Grade 6 submission for Grade 7 construction would spend
months buying nothing the Grade 6 reviewers will score. What the timing
decision actually turns on is the pre-submission work identified in this
report, which is measured in weeks: the three-dimensional alignment map is
the one genuinely gating item, because EQuIP Gateway 1 screens before
anything else is read, and it is a documentation pass over an already-scanned
badge inventory. The Grade 7 extension should be included in the submission
as exactly what the coverage map says it is, a 75-percent-built continuation
with a specified build contract for the remainder, and the honest arithmetic
should be volunteered rather than discovered.

The minimum viable submission package is: the Grade 6 curriculum as it
stands; the two coverage maps; the scope and sequence; the standards
alignment narrative; the concept-families reference; the new
three-dimensional alignment map; the badge-normalization fix for the four
legacy-code files; and an equity-and-access disclosure statement that
presents the UDL baseline as current capability and the differentiation
feature as staging-certified, production-dark, planned capability. That
package can honestly claim complete Primary coverage of all 22 Grade 6
standards, a documented and enforced instructional architecture, integrated
formative assessment, and an assessment-integrity guarantee most competitors
cannot make, while disclosing the differentiation-guidance and
multilingual-support gaps it has not closed.

A competitive submission, the kind that scores well rather than merely
clearing gateways, requires four additions beyond the minimum, in descending
order of leverage. First, the three Grade 6 assessment tasks the program's
own gap list names: written-argument tasks for LS1-3 and LS4-2 and the
hands-on PS1-6 investigation, which together convert the weakest Gateway 2
criteria from Partially Meets toward Meets. Second, per-unit teacher guides
consolidated from the Educator Mode content that already exists, with pacing
and materials lists, which addresses the thinnest Gateway 3 criterion at
mostly-editorial cost. Third, differentiation: the authored guidance layer
plus production activation of the platform feature, which moves both EQuIP
3.2 and CURATE Dimension 4. Fourth, the three Grade 7 gap units built to
their existing specs, which upgrade the extension from disclosure to
evidence of a program that closes its own gaps on a published roadmap. If
pilot-classroom evidence can be gathered while that work proceeds, it
strengthens every dimension at once, and the platform's immutable attempt
records mean the pilot evidence will be of an integrity no reviewer can
question.
