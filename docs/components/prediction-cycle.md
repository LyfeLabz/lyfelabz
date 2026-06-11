# Component: Prediction Cycle (Predict -> Test -> Compare -> Reflect)

## PURPOSE
Capture a student's prediction before an interactive result, then show the comparison. The gap between prediction and outcome is where the learning happens. This is the single biggest differentiator between strong and weak LyfeLabz pages.

## WHEN TO USE
- Mandatory wherever there is an interactive model: investigations, simulations, games.
- Encouraged in lessons that embed an animated model (e.g. the wave model).

## WHEN NOT TO USE
- Pure reference content with nothing to manipulate.
- Outcomes students cannot reasonably reason about yet (a blind guess is not a prediction).

## GOLD-STANDARD REFERENCES
- investigation_amplitude-challenge.html - prediction cards per phase, captured before the result, compared after.
- game_photon-runner.html - predict/test/compare/reflect woven into a game loop.
- simulation_beetle-island.html - has prediction language; the model for promoting an explicit prediction step in sims.

## STRUCTURE
1. `prediction-card` before the interactive: a focused question plus 2-4 selectable predictions (or a short free response).
2. The interactive runs only after a prediction is recorded (soft gate: nudge, do not hard-block).
3. Compare step: restate the student's prediction next to the observed result.
4. Reflect prompt: one sentence on why the result matched or differed.

## COMMON CLASS NAMES
`prediction-card` (existing in amplitude-challenge and several other pages).

## ACCESSIBILITY NOTES
- Prediction options are buttons, keyboard reachable, with visible focus.
- The compare/reflect reveal should be announced (`aria-live="polite"`).

## MICROPASS IMPLEMENTATION NOTES
- Port the amplitude-challenge prediction-card markup as-is; wire its state to the existing interactive's run button.
- One micropass = one prediction cycle on one page. Do not refactor the interactive itself.
- For sims that already track state (beetle-island), store the prediction in the same place the result lives so compare is trivial.

## AVOID THESE MISTAKES
- Asking for the prediction after the result is visible.
- Predictions with an obviously correct option.
- Skipping the compare step - prediction without comparison is just a quiz question.
- Hard-locking the interactive behind a prediction (frustrates replay/exploration).
