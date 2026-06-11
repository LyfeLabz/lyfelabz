# Component: Progress Indicator

## PURPOSE
Shows students where they are in a multi-phase experience (progress steps) or a quiz (sticky progress). Reduces abandonment and signals structure.

## WHEN TO USE
- Investigations and phased simulations: `progress-steps` across phases.
- Quizzes: `quiz-progress-sticky`.
- Multi-stage extensions (chernobyl-frogs already does this).

## WHEN NOT TO USE
- Single-screen lessons or short extensions (the section rhythm is enough).
- Games with their own level/HUD progress (do not double up).

## GOLD-STANDARD REFERENCES
- investigation_amplitude-challenge.html - `progress-steps` / `progress-step active` across phases.
- All four investigations and all four simulations already use it - this component is nearly fully distributed.
- extension_chernobyl-frogs.html - proof it works in extensions.

## STRUCTURE
1. `progress-steps` bar near the top of the phased area.
2. One `progress-step` per phase; `active` class tracks the current phase; completed phases visually distinct.
3. Steps update from the same state that drives phase visibility.

## COMMON CLASS NAMES
`progress-steps`, `progress-step`, `progress-step active`, `quiz-progress-sticky`.

## ACCESSIBILITY NOTES
- Convey progress in text too (e.g. "Phase 2 of 4"), not color/position alone.
- If steps are clickable, they are buttons with focus states; if not, they are not focusable.

## MICROPASS IMPLEMENTATION NOTES
- Copy from amplitude-challenge. One micropass = one page.
- Remaining gaps are few: multi-stage extensions and any future phased lesson.

## AVOID THESE MISTAKES
- Progress bars disconnected from actual phase state.
- Making every page phased just to earn a progress bar.
