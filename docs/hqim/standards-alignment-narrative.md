# Standards Alignment Narrative

LyfeLabz Grade 6-7 Science - repository-evidence draft. Factually corrected
2026-09-19 against commit `4f6f02b01eb988696592265223d2ddff28832eb4` and the
Phase 1 audit. Sources are the current canonical lessons, activity files,
assessment implementation, and the two coverage maps. This is not an official
HQIM determination. EdReports, EQuIP, DESE, and CURATE eligibility, rubric
structure, and submission procedures require later official-source verification.
No external research was performed in this correction pass.

## Instructional Coverage: Grade 6

All 22 Grade 6 standards in the repository's Massachusetts 2016 STE map have
meaningful mapped instruction. The map retains its 22 Primary classifications:
a lesson or assessed experience is built around each standard. Primary does not
mean complete performance-expectation attainment, and badges or learning goals
alone do not establish student performance or mastery.

Phase 1 found 16 strongly supported instructional classifications and five
requiring review or qualification: ESS1-5(MA), LS4-1, LS4-2, ETS1-6(MA), and
ETS2-3(MA). PS1-6 has substantial reaction/thermal-energy instruction but lacks
the required student-planned and conducted investigation. These are internal
repository judgments, not an official rating system. The coverage map records
the standard-specific qualifications.

Physical Science has seven mapped standards. Nature of Waves, Wave Behavior,
and Digital Signals support PS4-1/2/3 through wave models, energy accounting,
encoding/decoding, and written explanations; Amplitude Challenge adds student
trial data and analysis. Measuring Matter, Physical Properties, and Pure
Substances and Mixtures support the particulate/density/separation standards.
Chemical Reactions supports PS1-6 concepts, while Gravity supplies attraction
and mass-dependent-force evidence. Instructional breadth does not close the
missing PS1-6 investigation performance.

Life Science has five mapped standards. What Is Life?, Cell Types, and
Organelles are reinforced by investigations, extensions, and games. Body
Systems has interaction scenarios and a required written explanation tracing
at least three systems. Biological Evolution has fossil/anatomical comparisons
and an explicit whale-origin claim-evidence-reasoning task. Its substantial
natural-selection mechanism content and quiz emphasis still need grade-boundary
review; a corrected badge does not establish that above-grade content is absent.

Earth and Space Science has four mapped standards. The Sun-Earth-Moon cluster
includes phase/alignment model use, with written explanations and an eclipse
simulation. Layers of Time addresses relative dating and cross-cutting evidence;
Continental Drift combines geographic and fossil evidence. Earth's Place in the
Universe supplies nested graphical displays and a written explanation. Students
navigate that supplied model; independent visual-model construction is not
established by the navigation interaction.

Technology/Engineering has six mapped standards. Engineering Design, Designing
to Scale, and Choosing Materials prepare students for Floatia's physical
prototype, scaled drawing, tests, revision, and decision defense. Intended-user
communication and full tool-performance evaluation need clearer evidence.
Across all Grade 6 strands, the map contains eight codes with the `(MA)` suffix,
five of them in engineering; exact official wording and boundaries remain for
the later framework verification pass.

## Instructional Depth and Coherence

The strongest examples involve observable student actions, not counts of words
such as "predict" or "reveal" in HTML. Nature of Waves lets students manipulate
wave representations; Amplitude Challenge requires trials across distinct
amplitudes and interpretation of the resulting data. These substantiate model
use, investigation, and quantitative reasoning. No numerical claim about
prediction/reveal dosage is made without an enumerated interaction inventory.

The engineering sequence has an explicit learn-then-apply structure. Floatia's
Teacher Playbook names prerequisite lessons, materials, five-period pacing,
safety, checkpoints, and an extension for early-finishing teams. Its students
produce criteria notes, a materials table, a scaled drawing, test observations,
and a defense. A successful build does not by itself establish every tool-use
component or the quality of an individual's explanation.

The matter cluster connects particle representations, density ratios, physical
properties, and separation decisions. The signal cluster connects qualitative
noise resistance to encoding and decoding. These are defensible program-level
connections. They do not establish uniform depth in every lesson or independently
verified classroom outcomes.

Many lessons use phenomenon entries, prediction with feedback, contextual
vocabulary, and written synthesis. Vocabulary sections are accessible before
Engage, and density of interaction varies. Selecting an explanation, reading
feedback, using a supplied model, and independently constructing an explanation
or model must be described as different forms of evidence.

## Grade 7 and Vertical Articulation

The current Grade 7 map classifies 28 standards as 21 Primary, three Partial,
and four Gap. The 75% Primary figure is classification arithmetic, not a measure
of curriculum completion or demonstrated full-performance attainment.

PS2-3 has a substantive data-analysis weakness in Introduction to Electricity;
PS3-4 has a substantive investigation weakness in Heat Transfer. Conversely,
ball-run already contains physical prototypes, trial tables, controlled
revisions, before/after comparisons, and reflections. ETS1-4 and ETS1-7(MA)
may be stronger than their Partial labels suggest. Curriculum review should
precede reclassification or commissioning new work.

The four Gap labels concern missing full performance tasks: PS3-1 graphing,
PS3-2 relative-position modeling, PS3-3 thermal-device design/build/test, and
LS2-5 ecosystem-protection design evaluation. Forms of Energy already supplies
potential-energy background; "no related instruction" would be inaccurate.
The three planned units and their nine proposed files are specifications, not
implemented curriculum, and contribute no implemented coverage to these counts.

The ten documented bridge points are plausible teaching connections. Digital
Signals to Communication Systems and Continental Drift to Plate Tectonics are
particularly concrete. Other bridges require prerequisite planning and boundary
review. Catalog ownership differs from cross-grade supporting evidence: Plate
Tectonics and ball-run support connections without automatically proving
attainment in both grades. The nine-unit HQIM teaching sequences are proposals
over the subject-grouped live catalog, not its display order.

Five Grade 7 ETS3(MA) standards have dedicated lesson instruction. This is a
repository-verifiable feature; claims that competing publishers omit them, or
that this guarantees a favorable external review, require separate evidence.

## Assessment Evidence and Its Limits

All 50 root lessons contain a textarea. The 49 configured authenticated
assessment payloads contain 495 `singleChoice` items: 15 for Body Systems and
ten for each of the other 48. A writing prompt is evidence of an instructional
task; its existence does not establish automatic scoring, storage, or mastery.

For LS1-3, `lesson-sources/lesson_body-systems.html` requires a written
three-system explanation (`bs-thinking`). For LS4-2,
`lesson-sources/lesson_biological-evolution.html` requires a whale-origin CER
(`be-thinking`). Both have model responses, are required by the inspected
lesson submit flow, and are not automatically scored. Strengthen evaluation
and retention rather than create duplicate tasks.

The inspected authenticated `lessonQuiz.finalize` calls send selected answers
without those written responses. The legacy public submission branches include
a `thinking` field. Production receipt was not tested, so neither branch's
source proves a broader production-retention claim.

Authenticated selected-response attempts are finalized server-side, with client
create/update/delete denied by `platform/firebase/firestore.rules`. This
supports a narrow application-integrity claim, not an absolute assertion about
all privileged infrastructure or every student artifact. No comparative
superiority over other curricula is established here.

## Teacher Support, Access, and Deferred Claims

Educator Mode/educator-note markup exists in all 50 root lessons. Forty-nine
lessons use canonical `lesson-sources/` files with generated public and
authenticated outputs; Ragebaiting remains root-only. Existing teacher support
is distributed and uneven. Floatia's playbook is a useful concrete example,
but no consolidated curriculum teacher guide was located. The root
`EDUCATOR_MODE_GUIDE.md` is implementation guidance, not that consolidated guide.
A future guide should be derived from canonical content to avoid a second
editable source of truth.

Baseline accessibility/scaffolding features are present, including canonical
styles, skip links, reduced-motion handling, and vocabulary ARIA state. These
source markers are not accessibility certification. Some extension guidance
exists; consistent multilingual and differentiated instructional guidance is
not established across the program.

Differentiation remains active development. The checked-out application has
`G19_GATE_OPEN = false`, and the checked-in variant manifest is empty. These
facts do not establish live production configuration. Final capability and
accessibility conclusions await the owning workstream and separate verification.

Known badge corrections are partly complete: Layer Detective, Amplitude
Challenge, and Cell Energy's original unprefixed defects are resolved. Gravity
Wells (`MS-ESS1-2`) and Floatlandia Fracture (`ESS1-4`, `ESS2-2`) remain
curriculum-review items, including their tooltip descriptions. No replacement
codes or submission eligibility are decided by this narrative.
