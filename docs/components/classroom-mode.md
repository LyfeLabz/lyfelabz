# Component: Classroom Mode

## PURPOSE
The graded state of a page, activated by `?mode=classroom` (teacher-distributed link) or the toggle: quiz answers withheld until submit, submission unlocked, evidence flows to the teacher.

## WHEN TO USE
- Every assessable page: lessons, investigations, simulations, richer extensions, classroom-integrated games.

## WHEN NOT TO USE
- Pages with no quiz or submission (add those first; a mode toggle with nothing to gate is noise).

## GOLD-STANDARD REFERENCES
- simulation_gravity-wells.html - reference implementation: URL param, locked quiz behavior, `modeHintClassroom`, submission unlocked.
- game_layer-detective.html - the most classroom-integrated game.
- investigation_cell-energy.html, simulation_floatlandia-fracture.html - heavy classroom-mode use.

## STRUCTURE
1. `?mode=classroom` URL param read on load; sets the `mode-btn` state.
2. Quiz: no per-question reveal; score and answers held until submit.
3. Submission button enabled; payload includes mode so teachers can trust the score.
4. `modeHintClassroom` line stating work will be recorded.

## COMMON CLASS NAMES
`mode-btn`, `modeHintClassroom`, `?mode=classroom` param convention.

## ACCESSIBILITY NOTES
- Same as practice mode; additionally, make the recorded/not-recorded state explicit in text for screen reader users.

## MICROPASS IMPLEMENTATION NOTES
- Copy the gravity-wells mode JS wholesale; it is small and self-contained.
- One micropass = one page, both modes, verified with and without the URL param.
- Gaps to close first: extensions (moon-tonight, body-systems, biological-evolution) and the four activity games.

## AVOID THESE MISTAKES
- Implementing the param check differently per page (one convention, everywhere).
- Classroom mode that still leaks answers via practice-mode leftovers.
- Forgetting the mode field in the submission payload.
