# Component: Checkpoint Card

## PURPOSE
A short formative check embedded mid-page. Students answer one question about what they just explored and get immediate feedback before moving on. Converts reading/playing into active processing.

## WHEN TO USE
- After each phase of an investigation.
- After each major concept section of a lesson.
- At natural pause points in simulations and games (a "discovery moment").

## WHEN NOT TO USE
- As a graded assessment (that is the quiz's job).
- More than once per section - one good checkpoint beats three shallow ones.
- In short extensions where a single retrieval prompt is enough.

## GOLD-STANDARD REFERENCES
- investigation_amplitude-challenge.html - the canonical full structure (options, feedback, actions).
- investigation_cell-energy.html - heaviest use across phases.
- simulation_gravity-wells.html, simulation_eclipse-alignment.html - checkpoints during exploration.
- lesson_body-systems.html - the only lesson with one (proof it ports to lessons).
- game_photon-runner.html - checkpoint logic woven into a game loop.

## STRUCTURE
1. Card container with a label ("Checkpoint") and one focused question.
2. 3-4 answer options (buttons, not radio inputs).
3. Feedback region revealed on selection: confirms or corrects, with one sentence of reasoning.
4. Actions row: continue / try again.

## COMMON CLASS NAMES
`checkpoint-card`, `checkpoint-options`, `checkpoint-feedback`, `checkpoint-actions`, reveal handler `checkpointReveal`.

## ACCESSIBILITY NOTES
- Options must be real `<button>` elements, keyboard reachable, with `:focus-visible` rings.
- Feedback region should use `aria-live="polite"` so screen readers announce it.
- Do not rely on color alone to signal correct/incorrect; include text ("Correct" / "Not quite").

## MICROPASS IMPLEMENTATION NOTES
- Copy the markup and CSS from amplitude-challenge verbatim; only the question text, options, and feedback change.
- One micropass = one page, 1-3 checkpoints. Do not restructure surrounding sections.
- Place after the section's content, before the next `section-label`.

## AVOID THESE MISTAKES
- Inventing a new class scheme; reuse the existing four-class structure.
- Questions answerable without having engaged with the section.
- Feedback that just says right/wrong with no reasoning.
- Blocking page progress on a correct answer (feedback, not a gate).
