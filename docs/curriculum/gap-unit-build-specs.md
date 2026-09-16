# Grade 7 Gap-Unit Build Specs

Design contracts for the three planned Grade 7 units that close the remaining
four-standard gap in `docs/grade7-coverage-map.md` (7.MS-PS3-1, 7.MS-PS3-2,
7.MS-PS3-3, 7.MS-LS2-5). These are docs-before-code specs: each one describes
what a developer builds and why, at the level of instructional intent, without
prescribing implementation detail. Written 2026-09-16.

Shared design commitments, applied to every unit below. Each unit opens with a
mystery: students encounter a phenomenon before they have language for it.
Every core interaction follows predict-then-reveal: the student commits to a
prediction, sees the result, and only then names what happened. Vocabulary is
earned after observation, never front-loaded; the vocabulary section of each
lesson appears in the standard lesson order but the terms themselves are
introduced in the Explore phase only after the student has seen the thing the
term names. Every file is a single HTML page with internal CSS and JS,
supports touch and mouse, and targets 60fps on a Chromebook. Every file
belongs to exactly one grade; all files in this document are Grade 7 assets
carrying `7.MS-` badges only, with Grade 6 material referenced through
Connections cards, never embedded. All lessons follow the standard lesson
order (Hero, Learning Goals, Vocabulary, Engage, Explore, Quick Recall,
Explain, Evaluate, then Quiz, More Learning, Connections), use the canonical
vocabulary-card and quiz architectures, and end with a ten-question quiz per
QUIZ RULES. Core lessons carry `.ls-focus` only; supporting pages
(investigations, simulations, challenges) may carry `.stem-focus` per the
standards-presentation policy.

---

## Unit 1: Energy in Motion

Family: Energy, Waves, and Fields, with the unit's engineering raw material
drawn from the Engineered Systems ball-run sequence. Standards: 7.MS-PS3-1
(construct and interpret graphs of the relationships among kinetic energy,
mass, and speed) and 7.MS-PS3-2 (model the relationship between the relative
positions of interacting objects and their potential energy). This is the
planned Unit 7 (Energy of Motion) of the Grade 7 scope and sequence.

### Unit entry point

The student's first encounter is a crash they cannot yet explain. The opening
phenomenon, presented in the Engage phase of the first lesson before any
instruction, is a slow-motion collision scene: two carts roll down identical
ramps and strike identical foam barriers, and one barrier crumples far more
than the other. Nothing on screen labels the carts. The student is asked only
one question, phrased in student language: which cart hit harder, and what do
you think was different about it? The student types or selects a guess before
anything is revealed. Only after committing does the scene replay with the
hidden variable exposed: the carts were the same speed but different masses.
A second replay immediately follows with the variables swapped: same mass,
different release heights, therefore different speeds, and the faster cart
does dramatically more damage than the doubled-mass cart did. That asymmetry,
where speed seems to matter more than mass, is the mystery the whole unit
resolves. The student has now seen the KE = 1/2 m v-squared relationship
behave in front of them without ever seeing the equation, and the unit's job
is to give them the graphs and the words for what they watched.

### Lesson sequence

The unit is two lessons with a supporting simulation and investigation each,
sequenced so that PS3-1 supplies the measuring tool that PS3-2 then spends.

The first lesson owns PS3-1. Its arc runs from the collision mystery to
graphs the student constructs. In Explore, the student uses the unit's core
simulation (described below) to run controlled trials: hold mass constant and
vary speed, then hold speed constant and vary mass, reading a "smash meter"
(barrier deformation) as the visible proxy for kinetic energy. Each batch of
trials plots itself onto a live graph as the student runs it, so the graph is
something the student generates, not something shown to them. The two graph
shapes are the payoff: kinetic energy against mass is a straight line, kinetic
energy against speed is a curve that bends upward. The term kinetic energy is
introduced only after the student has built the first graph; the linear versus
nonlinear distinction is named only after the student has predicted (wrongly,
in most cases) that doubling speed doubles the damage. The Explain phase
formalizes proportional versus squared relationships at a Grade 7 level,
deliberately without the algebraic formula: the claim students leave with is
that doubling mass doubles kinetic energy, while doubling speed quadruples it,
and that a graph's shape tells you which kind of relationship you are looking
at. The accompanying investigation ports this to the physical world by
formalizing the data capture the ball-run challenge sequence already performs
informally: students time a real rolling ball over a marked distance, compute
speed, and plot their own class data, which also strengthens the future
ETS1-4 badging case for the ball-run files.

The second lesson owns PS3-2 and answers the question the first lesson
plants: the fast cart's energy had to come from somewhere, because at the top
of the ramp it was not moving at all. Where was the energy hiding? The lesson
develops potential energy as energy stored in the relative position of
interacting objects. Its Explore phase runs on the unit's second simulation,
an energy-terrain model in which a ball on a hilly track continuously
exchanges potential and kinetic energy, with two synchronized bars showing the
tradeoff and their sum held visibly constant. Per the framework's
clarification for PS3-2, the lesson does not stop at gravity: after the
gravitational case is solid, the same relative-position logic is extended to
two magnets being pushed together and to a stretched pair of charged objects,
each presented as a short interactive vignette inside the lesson where
distance between objects is the input and stored energy is the output. The
Explain phase names the general principle: when objects that attract are
moved apart, or objects that repel are pushed together, energy is stored in
their positions, and changing the positions releases it as motion. The
sequence therefore reads as one causal story: lesson one teaches students to
measure motion energy from graphs, lesson two explains where that energy is
banked when nothing is moving, and the conserved exchange between the two is
the unit's closing image.

### Predict-then-reveal moments

For PS3-1, the first committed prediction is the mass-versus-speed wager in
the Engage collision scene described above: the student picks which change,
doubling mass or doubling speed, will do more damage, then watches the trials
and sees speed win by a wide margin. The second is a graph-shape prediction
inside the simulation: before running the speed sweep, the student is shown
their own completed mass graph (a straight line) and asked to sketch or
select the shape they expect the speed graph to take from four candidate
curves (flat, straight, bending up, bending down). The simulation then plots
the real points over their chosen curve so the student sees exactly where
their prediction and reality diverge, and only then is the squared
relationship named. A third, smaller moment sits in the investigation: before
timing the real ball from the doubled-height release, students write a
predicted time, then measure, then reconcile.

For PS3-2, the first committed prediction is a height wager on the energy
terrain: the ball is released from a marked hill and the student must mark on
the far slope the highest point they think the ball can reach, then release
and watch. The reveal, that the ball climbs back to almost exactly its
starting height regardless of the valley shape between, is the conservation
insight, and the term potential energy is introduced immediately after this
reveal, as the name for what the height was storing. The second is the magnet
vignette: two ring magnets face each other in repulsion, and the student
predicts what happens to the top magnet when the gap is squeezed to half and
released. Seeing the magnet leap higher after the squeeze, and being asked
where that extra motion came from when nobody added speed, forces the
position-as-storage explanation onto a non-gravity case, which is exactly the
generalization the standard requires.

### Core interactives

The heart of PS3-1 is a collision-lab simulation. The student controls two
inputs, cart mass and release speed, each with a small discrete set of values
so trials are repeatable and graphable. The output is a foam barrier whose
crumple depth is measured on screen, serving as the visible, intuitive proxy
for kinetic energy, alongside a live scatter plot that accumulates one point
per trial with the student's chosen independent variable on the x-axis. The
simulation's essential behavior is that it turns experiment design into the
interaction itself: the student decides what to hold constant, runs the sweep,
and watches the graph shape emerge from their own trials. A replay-in-slow-
motion control supports the observation-before-vocabulary commitment, and the
smash meter deliberately reports deformation rather than a number labeled
"energy" until after the term has been earned.

The heart of PS3-2 is an energy-terrain simulation. The student draws or
selects a hill profile, places a ball at any point on it, and releases it.
Two linked bars, one for stored energy and one for motion energy, rise and
fall in exact complement as the ball rolls, with their sum drawn as a fixed
line. The student can pause at any instant and read both bars, drag the ball
to a new start point, or reshape the terrain, and the model responds
continuously. Small friction is optional and off by default so the
conservation picture stays clean; a friction toggle exists for extension and
visibly bleeds the sum line down, previewing the energy-transfer ideas already
badged on lesson_energy-transfer.html. The magnet and charge vignettes are
compact companion interactions inside the PS3-2 lesson itself, each a
one-slider model (gap distance in, stored energy and release motion out)
rather than a full second simulation.

### Assessment moments

For PS3-1, mastery is demonstrated by graph construction and interpretation,
matching the PE's verbs exactly. Inside the lesson's Evaluate phase, the
student is handed a fresh data table from trials they did not run (a
skateboarder at several masses and speeds) and must plot the points, identify
which relationship is proportional and which is squared, and answer the
transfer question: a rider doubles their speed and doubles their mass at
once, so by what factor does their kinetic energy change, and how do the
graphs show it? The response is captured through the certified assessment
runtime and the lesson's ten-question quiz mixes DOK 1 identification of
graph features with DOK 2 interpretation of unfamiliar graphs.

For PS3-2, mastery is demonstrated by model construction. The Evaluate task
gives the student a described system they have not seen in the unit (a
drawn-back bow and arrow, or a dropped-and-caught yo-yo) and asks them to
model it: identify the interacting objects, mark on a supplied diagram where
potential energy is greatest and least, draw the two energy bars at three
labeled moments, and write two sentences explaining what changed positions
and where the energy went. The scoring emphasis is on the relative-position
reasoning, not the vocabulary, and the quiz reinforces with position-and-
energy items spanning gravity, magnets, and charges so the non-gravity cases
are assessed, not merely mentioned.

### Connection to Grade 6

simulation_gravity-wells.html gave Grade 6 students the intuition that mass
curves a well and that objects speed up falling into it. This unit formalizes
that intuition without duplicating the asset: the gravity-wells page remains a
Grade 6 file, is never linked from More Learning here, and appears only as a
Connections card on the PS3-2 lesson answering "what caused this," with copy
in the spirit of the canonical bridge example: Gravity Wells let you feel how
position near a mass changes what happens next; Energy of Position gives that
feeling a measurement. The instructional differences are deliberate and keep
the two assets non-overlapping. Gravity-wells is spatial and qualitative
(orbits, wells, capture); the energy terrain is quantitative and conserved
(paired bars, a fixed sum, predictions checked against measurement). Nothing
in the Grade 7 unit re-teaches orbital motion or field visualization, and
nothing in gravity-wells shows an energy bar. The unit also connects forward
within Grade 7: its conservation image sets up lesson_energy-transfer.html
(PS3-5, already badged), and Connections cards on both new lessons point
there.

### File naming proposal

Four new Grade 7 files. lesson_kinetic-energy.html carries the 7.MS-PS3-1
badge and embeds or launches the collision lab. simulation_collision-lab.html
is the standalone home of the collision simulation, linked from the lesson's
More Learning, unbadged as a simulation per repository practice unless the
badging pass decides otherwise. lesson_energy-of-position.html carries the
7.MS-PS3-2 badge with the terrain model and the magnet and charge vignettes.
simulation_energy-terrain.html is the standalone terrain simulation for More
Learning. One supporting file, investigation_ball-run-data.html, holds the
physical timing-and-graphing task and is written so the future ETS1-4 badging
pass on the challenge_ball-run files can cite it as the formalized data
capture the coverage map calls for. No cross-grade name collision exists for
any of these, so no g7 infix is needed.

---

## Unit 2: Thermal Engineering Design

Family: Energy, Waves, and Fields shared with Engineered Systems, per the
dual-family note in concept-families.md. Standard: 7.MS-PS3-3 (apply
scientific principles of energy and heat transfer to design, construct, and
test a device to minimize or maximize thermal energy transfer). This is the
planned Unit 8 of the Grade 7 scope and sequence, and it is deliberately an
application unit: the science it applies is already taught and badged in
lesson_heat-transfer.html (PS3-4 and PS3-6(MA)), so this unit teaches no new
thermal physics and instead converts that physics into engineering
performance.

### Unit entry point

The student's first encounter is a fairness puzzle with a hidden mechanism.
Two identical-looking cups of ice water sit side by side in a time-lapse. One
holds its ice for hours; the other's ice is gone in minutes. The cups look
the same from the outside, and the student is told only that the room, the
water, and the ice were identical. Before any instruction, the student is
asked to commit: what could possibly be different, and where is the heat
getting in? The reveal is a cutaway showing the two walls: one cup is a thin
single wall, the other is double-walled with a sealed gap. The mystery that
launches the unit is not why heat moves (Grade 7 students already own
conduction, convection, and radiation from lesson_heat-transfer.html) but how
a designed structure can fight all three at once, and the unit's framing
question, stated in the hero, is the engineering inversion of the physics
they know: you cannot stop heat, so how do you slow it down on purpose?

### Instructional sequence

The unit follows the learn-then-apply arc the Floatia capstone established,
compressed into one challenge because the learning half already exists. It
opens with a short activation, not a lesson: the challenge page's early
sections replay the three transfer mechanisms as review framed in engineering
language, where each mechanism becomes an attack route (conduction through
walls, convection through air gaps and openings, radiation through exposed
surfaces) and each material or structure becomes a defense. This section
explicitly links back to lesson_heat-transfer.html as the place the science
lives, keeping the taught-versus-assessed boundary inspectable exactly as the
Grade 6 Unit 8 to Unit 9 handoff does.

The design problem is then given with criteria and constraints in the
ball-run and Floatia style: a mission brief (proposed scenario: a cold-chain
delivery problem, keeping a temperature-sensitive medicine cold across a
delivery window, chosen because it gives minimizing transfer an authentic
stake and a measurable pass line) with explicit success criteria (interior
temperature stays below a stated threshold for a stated duration in the test
chamber) and constraints (a budget, a size envelope, a fixed materials
catalog). Students work through the decision-matrix method they already own
from lesson_design-tradeoffs.html to compare candidate materials before
building: the matrix rows are the catalog materials, the columns are criteria
including insulating performance, cost, and bulk, and the matrix is completed
in the page, echoing ETS1-2 practice without re-teaching it.

The core of the unit is an iterative design-build-test loop in the thermal
testbed interactive described below: design a container wall by layering
materials, predict its performance, test it against a simulated hot day, read
the resulting temperature-over-time graph, diagnose which attack route beat
the design, and revise. The loop is run at least three times, with the page
capturing each iteration's design, prediction, and result so the student's
optimization history is visible data, in the spirit of the ETS1-4 verb. A
maximizing variant (a solar-cooker mode where the goal flips to capturing the
most thermal energy) is included as the final design round, because the PE
names both minimizing and maximizing and the flip is the cleanest test of
whether the student understands the mechanisms rather than a recipe: every
choice that made the cooler good makes the cooker bad.

### Predict-then-reveal moments

The first committed prediction is the materials wager, placed before the
first build: the student ranks four catalog materials (for example aluminum,
foam, cardboard, and a vacuum gap) from best to worst insulator, commits the
ranking, and then watches a side-by-side testbed run of four identical
containers differing only in wall material. The reveal typically breaks two
strong intuitions at once: metal, which feels significant and protective, is
the worst performer, and the "nothing" of an air or vacuum gap outperforms
most solids. The mechanism vocabulary for why (conduction needs a medium) is
re-earned at the moment the ranking fails rather than restated up front.

The second is the temperature-curve prediction inside every test run: before
pressing test, the student drags a curve onto the blank temperature-time
graph representing how they think their container's interior will behave.
The test then draws the real curve over their sketch. This repeats each
iteration, so prediction accuracy visibly improves as the student's model of
their own design improves, and the page can show the shrinking gap between
sketch and result across iterations as its own quiet reveal about what
engineering iteration is for. A third moment gates the solar-cooker flip: the
student predicts which of their three cooler designs will make the worst
cooker, commits, and tests, with the reveal cementing that the same physics
runs both directions.

### Core interactive

The heart of the unit is a thermal testbed simulation embedded in the
challenge page. The student assembles a container cross-section by choosing
up to three wall layers from the materials catalog, each layer with a
thickness choice, plus discrete design options that control the non-wall
attack routes: lid or no lid, reflective outer wrap or none, ventilation gap
or sealed. The testbed then runs an accelerated simulated test (a represented
hot day compressed to seconds) and renders two things: an animated cutaway in
which heat flow along each route is visualized at an intensity matching the
design's actual weaknesses, and the interior temperature-time graph drawn
against the pass-line threshold. Cost and size totals update live as the
student builds, so constraint violations are felt at design time, not at
grading time. Every run is logged to an on-page iteration history showing
design summary, predicted curve, actual curve, and pass or fail, which is the
raw material for the assessment artifact. In cooker mode the same testbed
inverts its goal readout. The simulation is deterministic for a given design
so students can reason about changes, and it needs nothing beyond internal
JS: the thermal model can be a simple lumped-resistance approximation, since
its instructional job is correct ordering and shape, not laboratory accuracy.

### Assessment moment

The assessed artifact is a design defense, mirroring the Floatia capstone's
"Defend Your Engineering Decisions" structure at Grade 7 depth. After the
final iteration, the student submits, through the certified assessment
runtime, a package the page assembles from their own logged work: their final
wall design, its tested temperature curve, and their completed decision
matrix, accompanied by short constructed responses in which the student must
name each transfer mechanism their design addresses and identify the specific
design feature that addresses it, explain one tradeoff they accepted and why
the matrix supports it, and use their iteration history to describe one
change they made and the evidence that motivated it. Mastery of PS3-3 is
demonstrated when the student can bind mechanism to feature: not "foam is a
good insulator" but "the foam layer slows conduction, the sealed lid stops
convection, and the foil wrap reflects radiation." A short quiz in the
standard architecture backstops with DOK 1 and DOK 2 items on mechanism
identification in unfamiliar designs (a thermos, a beach cooler, an emergency
blanket).

### Connection to Floatia

The unit echoes the capstone's structure at every joint while repeating none
of its content. Like Floatia, it opens by declaring what the student will
prove they can do, reviews words they already know rather than teaching new
ones, states success criteria before any building, runs a build-test-redesign
loop, and closes with a defense of decisions. The differences are the point
of the Grade 7 progression documented in the vertical articulation table:
Floatia assesses a first prototype cycle (Grade 6 ETS2-3(MA)), while this
unit adds the two moves Grade 7 engineering introduces, systematic evaluation
with a decision matrix before building and iterative optimization with
logged data across builds. Floatia's medium is physical and structural
(materials bearing loads); this unit's medium is energetic (materials
resisting heat flow), so the science being applied is this year's, not last
year's. The challenge page uses the established engineering-challenge page
type and visual language (the crimson challenge pill, the Floatia section
rhythm) so students recognize the genre instantly, which is itself the echo:
same arc, harder discipline, new physics.

### File naming proposal

Two new Grade 7 files. challenge_cold-chain.html is the unit's anchor,
carrying the 7.MS-PS3-3 badge, built on the engineering-challenge page type
with challenge_welcome-to-floatia.html as the structural template; it embeds
the thermal testbed and the assessed design defense.
simulation_thermal-testbed.html is the standalone testbed for More Learning
and free exploration, including cooker mode, so students can keep designing
after the assessed run without touching their submitted work. The unit adds
Connections cards on lesson_heat-transfer.html and lesson_design-tradeoffs.html
pointing to the challenge in a later index and Connections pass; no existing
file is renamed and no cross-grade collision exists.

---

## Unit 3: Protecting Ecosystems

Family: Living Systems shared with Engineered Systems, per
concept-families.md. Standard: 7.MS-LS2-5 (evaluate competing design
solutions for protecting an ecosystem, discussing benefits and limitations of
each design). This is the planned Unit 5 of the Grade 7 scope and sequence,
and per its build note it is an application unit: the ecology is already
taught across the Unit 3 and Unit 4 lessons and the evaluation method is
already taught in lesson_design-tradeoffs.html, so this unit's new work is
the scenario, the evaluation interactive, and the assessed argument.

### Unit entry point

The student's first encounter is a dying estuary with no villain in sight.
The Engage phenomenon is a four-frame time series of the same coastal river
mouth (a Massachusetts-flavored scenario without naming a real place, so the
setting reads local to the program's students): eelgrass beds thick with
life, then thinning, then gone, with the fish and shellfish counts falling
frame by frame. The water in every frame looks clean. Before any instruction
the student commits to a hypothesis: what is killing the bay, given that
nothing visible is polluting it? The reveal traces the cause upstream and
inland: lawn and farm fertilizer washing off the watershed, feeding algae
that cloud the water and starve the eelgrass of light. The mystery's shape
is the unit's thesis: the ecosystem's problem starts far from the ecosystem,
which is precisely why protecting it requires designed solutions with
tradeoffs, because every fix lands on someone's land, budget, or livelihood
rather than on the bay itself.

### Instructional sequence

The unit moves in three phases from understanding the problem to evaluating
competing solutions, all within one investigation-anchored arc. The first
phase secures the causal model. Using the disruption logic students already
own from lesson_ecosystem-stability.html and lesson_human-impacts.html, the
page has students trace the nutrient cascade through the estuary food web:
fertilizer to algae to lost light to lost eelgrass to lost habitat to
collapsed fish and shellfish populations. This phase is review shaped as
diagnosis, and it ends with the student writing the problem as an engineer
would receive it, separating the criterion (restore eelgrass and the
populations it shelters) from the human constraints the reveal exposed
(cost, land use, who bears the burden).

The second phase introduces the competing solutions, presented as four real
proposal types a town might actually weigh: a fertilizer restriction
ordinance, engineered wetland buffer strips along the feeder streams, a
shellfish restoration program (oysters and mussels as living filters), and a
storm-water infrastructure upgrade. Each proposal is introduced through the
watershed interactive described below, where the student can apply it and
watch the estuary respond over simulated years. Critically, no proposal is
presented as correct: each one measurably helps, each one falls short of the
criterion alone, and each one carries a distinct cost profile and a distinct
constituency that pays for it. The student's growing familiarity with the
solution space comes from running it, not reading about it.

The third phase is the evaluation itself. The decision-matrix method from
lesson_design-tradeoffs.html is applied with the proposals as rows and
criteria drawn from both the science and the constraints as columns:
eelgrass recovery, speed of recovery, cost, burden distribution, and
durability. The matrix is populated from evidence the student generated in
phase two (the interactive's outputs feed the matrix cells, so scores are
grounded in observed model behavior rather than vibes). The phase closes on
the move the PE's clarification actually demands: the discussion of benefits
and limitations, including the recognition that a combined portfolio of
partial solutions can outperform any single one, and that recommending a
portfolio still requires defending its costs. The student leaves the unit
having run the full LS2-5 practice: understand the ecosystem, test the
designs, score them honestly, and argue for a defensible choice.

### Predict-then-reveal moments

The first committed prediction is the diagnosis wager in the entry
phenomenon: the student commits to a cause for the eelgrass collapse before
the upstream trace is revealed. Most students will blame direct pollution or
overfishing; the reveal that the cause is nutrient enrichment, which sounds
like feeding rather than poisoning, is the counterintuitive hook, and the
term eutrophication is introduced only at this moment, as the name for what
they just watched, honoring the vocabulary-after-observation commitment.

The second is the silver-bullet wager in the watershed interactive: before
testing any proposal, the student picks the one they believe will fix the bay
by itself and commits a predicted eelgrass-recovery level. They then run
their chosen proposal for the full simulated period and watch it help but
fall short of the criterion. The reveal is structural, not factual: the
student discovers that the problem is bigger than any single fix, which is
the motivating insight for portfolio thinking and for the matrix. A third
moment lands inside the evaluation phase: before the matrix totals are
computed, the student predicts which proposal will score highest overall,
commits, and then sees the totals, where the winner on the science criteria
is frequently not the winner once cost and burden columns are included. That
dissonance between "best for the bay" and "best overall" is the tradeoff
insight LS2-5 exists to teach, revealed by the student's own scoring.

### Core interactive

The heart of the unit is a watershed-and-estuary simulation. The screen shows
a stylized cross-section from inland farms and neighborhoods, down the feeder
streams, to the estuary and its eelgrass beds, with a compact dashboard
tracking nutrient load, water clarity, eelgrass coverage, and two indicator
populations across simulated years. The student applies any combination of
the four proposals, each with an adjustable intensity where it makes sense
(buffer width, ordinance strictness, reef size, infrastructure coverage), and
runs time forward, watching the cascade respond with realistic lag: nutrient
load falls quickly under some proposals, but eelgrass recovers slowly, and
the populations follow later still. Cost accumulates visibly per proposal,
and a simple burden readout shows who is paying (homeowners, farmers, the
town budget). The simulation supports saving named runs so students can
compare a single-proposal run against a portfolio run side by side, and its
outputs export directly into the decision-matrix phase as the evidence basis
for scoring. Like the other units' interactives, it is deterministic per
configuration, single-file, touch-friendly, and modeled with simple coupled
rates; its instructional job is honest ordering, lag, and tradeoff shape, not
limnological precision.

### Assessment moment

The assessed artifact is an evaluation argument, submitted through the
certified assessment runtime and matching the PE's verb exactly. The student
submits their completed decision matrix and a structured written
recommendation to the town: which proposal or portfolio they endorse, the
evidence from their simulation runs that supports it, and, mandatorily, a
benefits-and-limitations paragraph for at least two competing options they
did not choose, stating what each would do well and where it falls short.
The scoring emphasis is on the quality of the evaluation rather than the
choice itself: a student who recommends any option while accurately
characterizing the tradeoffs of the alternatives demonstrates LS2-5, and one
who picks the "right" answer without engaging the limitations does not. A
standard ten-question quiz backstops with DOK 2 items presenting novel
protection scenarios (a wetland, a forest edge, a vernal pool) and asking the
student to identify criteria, constraints, and the strongest limitation of a
described solution.

### Connection to existing LS content

The unit is built to sit immediately after the existing Unit 4 and to spend
knowledge from every Living Systems lesson Grade 7 already has, teaching no
new ecology. The food-web tracing runs on relationships from
lesson_parts-of-an-ecosystem.html (LS2-2) and energy-and-matter structure
from lesson_energy-flow.html and lesson_carbon-cycle.html (LS2-3). The
disruption cascade is the LS2-4 model from lesson_ecosystem-stability.html
applied to a human-caused case from lesson_human-impacts.html, and the
biodiversity-to-human-resources stake (the shellfishery the town is losing)
is the LS2-6(MA) link from the same lesson. The mitigation framing continues
the ESS3-4 argument from lesson_renewable-and-nonrenewable-resources.html,
now sharpened from "humans can mitigate impacts" to "choose among specific
mitigations under constraints." Connections cards on the new page point back
to lesson_ecosystem-stability.html and lesson_design-tradeoffs.html with
relationship-revealing copy (the stability lesson shows what disruption does
to a system; this investigation asks what a town should build about it), and
a card on lesson_design-tradeoffs.html can point forward as the "where does
this idea lead" case. The unit thereby completes the LS2 strand: with LS2-5
covered, all seven Grade 7 Life Science standards reach Primary.

### File naming proposal

Two new Grade 7 files. investigation_protect-the-estuary.html is the unit's
anchor and carries the 7.MS-LS2-5 badge. The investigation prefix is chosen
over lesson because the page's spine is an evidence-generating task built
around the PE's evaluate verb, matching the precedent of
investigation_population-patterns.html carrying LS2-1's analyze verb; the
coverage map's note about reviewers expecting lesson-level instruction is
answered here by the fact that the instruction behind this task lives in
five already-badged lessons. simulation_watershed-rescue.html is the
standalone watershed simulation for More Learning and open-ended exploration.
No renames are required and no cross-grade collision exists for either name.

---

## Cross-unit coordination notes

Build order within this package should be Unit 1, then Unit 2, then Unit 3,
matching the scope-and-sequence positions (Units 7, 8, and 5 respectively)
in dependency order rather than calendar order: Unit 2's testbed reuses the
iteration-history and predicted-versus-actual-curve patterns that Unit 1's
collision lab establishes, and Unit 3's evidence-into-matrix flow reuses
Unit 2's matrix-from-observed-data pattern. Per repository policy, none of
these builds touches index.html; homepage cards for all three units land in
one batch after the package is complete. Connections cards on existing
lessons (heat-transfer, design-tradeoffs, ecosystem-stability, energy-transfer)
are likewise deferred to a single Connections pass so each edit is one
deliberate batch. All three units ship with the standard Connections
placeholder until that pass runs. Whether these pages enter the lesson-build
pipeline (lesson-sources with v1 and v2 outputs) is a per-file decision at
build time under the existing rule that the pipeline applies only to lessons
with a config under app/scripts/lessonBuilder/lessons/; the two new lessons
in Unit 1 are the natural candidates, while challenges, investigations, and
simulations follow the current single-file convention of their types.
