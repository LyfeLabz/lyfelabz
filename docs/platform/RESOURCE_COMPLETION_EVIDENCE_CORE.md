# Resource Completion and Evidence Core (RA-2)

Pure, typed contracts and functions for non-lesson completion: the
completion definition, the evidence shape, the eligibility evaluator, and
the first server-verifiable outcome validator (Gravity Wells). Owned by
Resource Architecture.

Status: implemented as pure code with tests only. Nothing calls it. No
storage, Rules, callable, delivery, or UI exists for it. Gravity Wells and
every other non-lesson resource remain unassignable
(`ASSIGNABLE_RESOURCE_TYPES` in
`platform/functions/src/shared/activity-identifiers.ts` is unchanged).

It implements part of the conceptual architecture in
`LYFELABZ_NON_LESSON_ASSESSMENT_EVIDENCE_STANDARD.md` (§4, §5.2, §11.4,
§11.6). That standard, including the five-question non-lesson quiz, is
unchanged; this core carries no question count.

## Location

`platform/functions/src/resourceCompletion/`, server side, because
eligibility is a server decision. Not exported from `src/index.ts`, so it is
not a deployed function. It imports only the canonical identifier helpers
(`shared/activity-identifiers.ts`, `shared/assessment-identifiers.ts`).

| File | Contents |
| --- | --- |
| `completion-definition.ts` | Definition types; `validateCompletionDefinition` |
| `resource-evidence.ts` | Evidence types, server-state types; `parseResourceEvidence` |
| `evaluate-completion-eligibility.ts` | `evaluateCompletionEligibility` |
| `outcome-validators.ts` | Closed validator registry; `resolveOutcomeValidator` |
| `gravity-wells-orbit-verifier.ts` | `gravity-wells.orbit@1`; `verifyGravityWellsLaunch` |
| `gravity-wells-completion-definition.ts` | Draft Gravity Wells definition |

## Completion definition (schema version 1)

One definition per resource and assessment revision:

- Identity: `resourceId` (canonical id, `<type>-<stem>`), `resourceType`
  (`simulation`, `investigation`, `extension`, `challenge`),
  `assessmentRevisionId` (`assessment_<resourceId>__r<N>`, checked against
  the resource), `definitionVersion` (positive integer).
- `stages`: stable `stageId`, `required` true or false, one `requirement`.
- `evidence`: declared items. RA-2 implements one kind, `text`
  (purpose `prediction`, `observation`, `explanation`, or `reflection`, plus
  the prompt it answers). Tables, graphs, CER, and design records are added
  later as new kinds.
- `outcomes`: server-verifiable outcomes, each naming a registered
  validator id, version, and one outcome code it reports.
- `attestations`: explicitly authorized self-reports, each with a statement
  and the instructional-exception reason.

Requirements are a closed tree: leaves `evidence`, `outcome`,
`attestation`; combinators `allOf` and `atLeast` (count N). No expressions.

Validation is strict and fails closed. Rejected: unknown schema version,
unknown or extra fields (so no answer key, unit, teacher, class, or
assignment field can ride along), lessons, a resource id that does not match
its type, a revision of another resource, unknown kinds, validators, or
outcome codes, unknown, cross-stage, duplicate, or unreferenced references,
an `atLeast` count outside 1..children, empty combinators, trees deeper than
4, two outcome ids for one validator result, an attestation mixed into a
stage with an outcome, an attestation without a reason, and a definition
with no required stage. Definitions carry no question count and no writing
thresholds.

## Evidence and trust boundaries

`ResourceEvidence` is client-authorable content bound to one definition
(`resourceId`, `assessmentRevisionId`, `definitionVersion`):

1. **Student-authored** (`authored`): checked for structure and presence
   only. "Present" means at least one visible character (whitespace and
   invisible format characters do not count). No length minimum, no
   scoring. Maximum 20,000 characters per item, matching lab reports.
2. **Server-verified outcomes**: not an input. Students submit run
   parameters (`outcomeRuns`); the registered validator recomputes the
   outcomes. There is no field for a client success, mission, completion,
   or eligibility claim, and such fields are refused.
3. **Attestations**: only ids the definition authorizes, `affirmed: true`.
4. **Server state** (`ResourceEvidenceServerState`): ownership stamps
   (student, assignment, class, school, district), submission state and
   frozen snapshot, and eligibility timestamp. Server controlled. Any of
   these names in client content is refused
   (`SERVER_CONTROLLED_EVIDENCE_FIELDS`).

Evidence has no attempt, session, score, or quiz field and is evaluated
without reading attempts, so quiz retakes cannot change it.

## Eligibility evaluator

`evaluateCompletionEligibility(definition, evidence)` validates both inputs,
then:

- `invalid-definition` or `invalid-evidence` with stable issue ids, or
  `binding-mismatch` when the evidence answers another resource, revision,
  or definition version. All are ineligible.
- Otherwise `evaluated`: per-stage `satisfied` and `missing` leaf ids
  (`evidence:<id>`, `outcome:<id>`, `attestation:<id>`),
  `unmetRequiredStageIds`, `verifiedOutcomeIds` (each counted once), and
  `eligible` when every required stage is satisfied. Optional stages are
  reported and never affect eligibility. `undeterminedRunIndexes` lists runs
  the computation budget could not settle (below); they are not failures
  and do not invalidate the batch.

A valid but unsuccessful run (a crash, an uncredited flight) is ordinary
evidence and never invalidates the batch. A malformed record, an unknown
validator, out-of-range parameters, or any extra field such as a claimed
outcome makes the whole evidence `invalid-evidence` with indexed issues
(`run.malformed:2`, `run.invalidParameters:4:invalid-observed-steps`).
Invalid records are never silently dropped.

Parsing returns a detached snapshot: accepted parameters are frozen copies
made by the validator, so later changes to the caller's objects cannot
change the parsed evidence or its verified outcomes.

It is deterministic and side-effect free. It reads no clock and creates no
timestamps: "submitted" and "eligible" (including sticky eligibility,
standard §5.2) are recorded later by the server against a frozen submitted
snapshot. It does not judge evidence quality, and there is no teacher
approval or review gate.

## Gravity Wells verifier: `gravity-wells.orbit@1`

Derived from the Phase 3 code in `simulation_gravity-wells.html`. Inputs:
`{ massKey, vx, vy, observedInvocations }`: mass `earth`, `jupiter`, `sun`,
or `blackhole`; the initial velocity in logical pixels per frame; and the
number of `runOrbitLoop` calls that executed for the launch (a positive safe
integer; see below).

- Start at (320 + startDist, 220). Masses (mass, crash radius, start
  distance): Earth 1200, 27, 130; Jupiter 2000, 40, 158; Sun 7000, 57, 185;
  Black Hole 9000, 28, 155. G = 1.
- Speed must be finite and within [5/220 x 10, 10] (the page ignores drags
  under 5 px and caps speed at 10), with a 1e-12 relative allowance for
  floating-point rounding only.
- Each step: crash if distance < crash radius; escape if distance > 300
  (flyby when the closest prior distance < 3.5 x crash radius); otherwise a
  leapfrog drift-kick-drift step with a 0.001 kick-radius softening.
- Missions (page ids): Earth orbit `c1` and Jupiter orbit `c3` after 240
  steps; Sun escape `c2`; flyby `c4` (any mass); Black Hole survival `c5`
  after 120 steps. Outcome codes: `earth-orbit`, `sun-escape`,
  `jupiter-orbit`, `flyby`, `black-hole-survival`.

### Observation contract and computation bound

The page has no time limit. A flight ends only on a crash, an escape, or a
reset (Reset, Try Another Orbit, a mass button, the phase unlock). Late
missions are real: a Sun launch (`vx` 3.18496278819097, `vy`
5.516517369362989) escapes after step 11,710 and earns `c2` and `c4`; a
Black Hole launch earns a flyby after step 84,427. No fixed step count is
sufficient in general: a long-lived flight can first cross the escape
radius after any number of steps.

How the page loop runs: `launchProbe` calls `runOrbitLoop` once directly,
and every later call is a requestAnimationFrame callback it scheduled. Each
call first runs the terminal checks (crash, escape) on the current
position. If neither fires, it performs exactly one integration step,
credits step-based missions (`c1`, `c3` at 240; `c5` at 120), and schedules
the next call.

| What happened | Integration steps | Loop calls | Terminal check on the last position |
| --- | --- | --- | --- |
| Natural crash or escape after N steps | N | N + 1 | Ran on call N + 1; `c2`/`c4` awarded there |
| Reset after N steps | N | N | Never ran: `resetOrbit` cancelled the scheduled call |

`orbitFrameCount` is N in both rows, so it cannot tell them apart. The
contract therefore counts executed loop calls:

- `observedInvocations` is the number of `runOrbitLoop` calls that executed
  for the launch, the direct call included. The verifier executes exactly
  that many calls, and credits only what those calls award. A terminal
  mission whose call did not run is never credited, and one whose call did
  run is never missed.
- Results report `steps` (integration steps, also the cost), `invocations`
  (calls simulated), and mission steps in integration steps.
- Endings: `crashed` or `escaped` (an observed call detected it);
  `observation-ended` (every observed call ran and the flight was still
  going: the student reset; not a failure); `computation-limit` (below).
- Server work is capped by a computation budget, not by a claim about
  physics: `RESOURCE_EVIDENCE_LIMITS.maxComputationUnits` is 4,000,000
  integration steps per evaluation, shared by the runs in order (about
  18.5 hours of flight at 60 fps, 4.6 hours at 240 fps, about 65 ms of
  computation as measured). When a call would step past the budget, the
  run ends as `computation-limit` with `undetermined: true`: missions
  reached inside the budget are verified, later ones are neither credited
  nor refuted. A call that only detects the end costs no step, but it ends
  the run, so each run makes at most `steps + 1` calls and runs are capped
  at 50. There is no way to repeat calls without spending budget.
- Determinism: the same evidence always spends the budget the same way and
  produces the same result.

Trust model: `observedInvocations` is untrusted, student-reported evidence.
The verifier establishes only that the declared parameters, run for the
declared number of loop calls, reproducibly produce the credited missions.
It cannot prove that the student watched those frames, or performed the
drag. Overstating the count only reveals what those parameters really do (a
crash after step 54 stays a crash); understating it loses credit. A future
client must report the count from the page; the page sends nothing today,
and RA-2 does not change it. Fabricated outcomes and malformed submissions
are still refused.

It verifies that submitted parameters produce an outcome. It does not prove
the student performed the drag. Any change to the physics or rules is a new
version; version 1 stays fixed for definitions that name it.

### Parity

`gravity-wells-orbit-parity.test.ts` runs the page's own inline script
unmodified in a Node `vm` context (DOM stubbed, drawing and toasts no-op'd)
and compares launches step for step: a 21-speed by 48-angle grid for each
mass (3,600 observed steps), 600 seeded random launches, near-boundary
cases (Earth crash after 239 and 240 steps, Black Hole crash after 119 and
120 steps, speed extremes), Earth orbit at 239 versus 240 calls, Black Hole
survival at 119 versus 120 calls, and 120 seeded flights observed for about
30,000 calls each. The late cases (Sun escape after step 11,710, Black Hole
flyby after 84,427, Black Hole crash after 10,222) each run twice: reset
right after step N (N calls, then the page's `resetOrbit`, which must
cancel the scheduled callback) and with the terminal call N + 1 executed.
A budget test compares a budget-limited run with the page after the same
steps. The harness counts calls with a wrapper around the page's own
`runOrbitLoop`, so it never runs a call the verifier was not told about. Terminal state, step count, mission steps, closest distance, and
final position and velocity are bit-identical. The drag-to-velocity
conversion is compared against the page's `startDrag`/`endDrag`.

Limits: parity is Node (V8) against the same script. The physics uses only
`+ - * /`, `Math.sqrt`, and `Math.min`, which are IEEE-754 exact or
correctly rounded on mainstream engines, so other browsers are expected to
match, but they were not tested. The page's relaunch-without-reset path
(stale counters after a finished flight) is not modeled; it can only
repeat a crash or escape the first launch already produced.

## Revision immutability

Once a resource and assessment revision binding is published, the
completion definition content for that `resourceId`, `assessmentRevisionId`,
and `definitionVersion`, and every validator version it names, are
immutable. The same binding must never resolve to different requirements.
Any change to stages, evidence prompts, outcomes, attestations, or a
validator's behavior is a new `definitionVersion` (and, for physics or
rules, a new validator version beside the old one), and existing
assignments keep the binding they were published with. RA-2 does not build
a publication or versioning system; this is a rule for the phase that
stores definitions.

RA-3B (`FROZEN_COMPLETION_DEFINITIONS.md`) implemented it with one
refinement: a definition is frozen with exactly one assessment revision,
so a requirement change is a new assessment revision, and
`definitionVersion` must equal that revision's ordinal (no separate
numeric progression). Stored definitions are identified by revision and a
SHA-256 content hash. `gravity-wells.orbit@1` is pre-release: its contract
changed in RA-2 (`observedInvocations` added) because nothing has been
published against it yet.

## Gravity Wells pilot definition (DRAFT)

`GRAVITY_WELLS_COMPLETION_DEFINITION`, bound to `simulation-gravity-wells`
and `assessment_simulation-gravity-wells__r1` (not deployed; re-confirm
when that revision is authored), definition version 1:

- `orbit-missions` (required): Earth orbit, plus at least two of Sun
  escape, Jupiter orbit, flyby, and Black Hole survival. This is the page's
  own `checkP3Progress` rule.
- `orbit-explanation` (required): one `explanation`, presence check only.
  The prompt text is draft content for owner review.

This definition is DRAFT. It is not live, and the student-facing page and
its instructional progression are unchanged. Before authenticated delivery
is enabled, instructional review must decide the mass prediction and the
mass comparison record (proposed in the inventory, not included here) and
approve the explanation prompt. No attestation is authorized: every Gravity
Wells mission is verifiable.

## Future persistence responsibilities (not RA-2)

A later phase must, server side: stamp ownership from the verified token
and assignment, never from the client; bind evidence to the assignment's
frozen definition; store drafts and an explicit submitted snapshot with
server timestamps; reject an invalid submission as a whole without
overwriting previously accepted evidence; evaluate eligibility against the
stored snapshot and record it sticky; gate `assessmentSessionsBegin` and
`assessmentAttemptsFinalize` for non-lesson assignments; and keep
assessment attempts separate. A new assignment is a separate learning
occurrence: eligibility is not carried over between assignments.

## Excluded from RA-2

Firestore collections, Rules, indexes, callables, assessment content or
deployment, autosave, authenticated delivery, page or runtime changes,
teacher views, assignment UI or allowlist changes, reassignment carry-over,
and all Curriculum and Units Modernization concerns.

## Compatibility

- RA-1 (`FLAT_RESOURCE_PROJECTION.md`) is unchanged. Definitions are keyed
  by the same canonical `id`. `platformEvidence` and
  `authenticatedAssignment` stay false until those capabilities ship.
- Teacher-defined Units: definitions and evidence carry no unit, teacher,
  grade organization, class, or navigation data, so two teachers can
  organize the same resource differently without affecting completion.
