# Component: Quiz Section

## PURPOSE
The page's summative check: a fixed question set with progress tracking, practice/classroom behavior, and a path into the submission system.

## WHEN TO USE
- Every lesson (target: 10 questions), simulation, and richer extension.
- Investigations may substitute CER + checkpoints for a quiz.

## WHEN NOT TO USE
- Pure-play games (a Lab Notes export or short checkpoint set fits better).
- Extensions where a reflection is the right weight.

## GOLD-STANDARD REFERENCES
- lesson_sun-earth-moon.html - 10-question quiz, clean practice/classroom handling.
- lesson_eclipses.html - the `quiz-section` pattern named in the gold standard template.
- lesson_nature-of-waves.html - quiz integrated with the deepest lesson structure.

## STRUCTURE
1. `quiz-section` container after the last content section.
2. `quiz-mode-toggle` (`mode-btn` Practice / Classroom buttons).
3. Question cards with option buttons and per-question feedback in practice mode.
4. `quiz-progress-sticky` progress indicator.
5. `quiz-submit-btn` that feeds the submission system in classroom mode.

## COMMON CLASS NAMES
`quiz-section`, `quiz-mode-toggle`, `mode-btn`, `quiz-progress-sticky`, `quiz-submit-btn`.

## ACCESSIBILITY NOTES
- All options keyboard operable with visible focus.
- Score/progress changes announced via `aria-live`.
- Color-independent correct/incorrect signaling.

## MICROPASS IMPLEMENTATION NOTES
- Copy the full quiz block (markup + CSS + JS) from sun-earth-moon; replace only questions and answers.
- Question count: 10 for lessons, 5-6 for simulations/extensions.
- One micropass = one page's quiz. Verify scoring and submission fire before closing the pass.

## AVOID THESE MISTAKES
- Quizzes that test trivia rather than the learning goals.
- Diverging from the shared class names (breaks future shared tooling).
- Classroom mode that still reveals answers immediately.
