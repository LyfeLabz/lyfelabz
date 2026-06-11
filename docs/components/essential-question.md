# Component: Essential Question

## PURPOSE
One question at the top of the page that frames everything below it. Gives students a reason to care and teachers a one-line statement of what the page is for.

## WHEN TO USE
- Every lesson and extension (label: "Essential Question").
- Investigations, simulations, and games use the same block relabeled "Phenomenon" (see phenomenon-hook.md).

## WHEN NOT TO USE
- Never duplicate it mid-page; state it once, refer back to it in the reflection/quiz.
- Do not add a second competing question block.

## GOLD-STANDARD REFERENCES
- lesson_nature-of-waves.html - existing `driving-question` block ("How can waves transfer energy without moving matter?").
- lesson_sun-earth-moon.html - strong framing tied to the phenomenon.

## STRUCTURE
1. Inside the hero, after the title/badge.
2. Label line (`dq-label`) reading "Essential Question".
3. The question itself - student-facing language, answerable by the end of the page, not yes/no.

## COMMON CLASS NAMES
`driving-question`, `dq-label`. Keep these names; only the label text changes from "Driving Question" to "Essential Question".

## ACCESSIBILITY NOTES
- Plain text, no special requirements; ensure heading hierarchy stays valid (the question is not an `<h1>`).

## MICROPASS IMPLEMENTATION NOTES
- Pages with an existing `driving-question`: change only the `dq-label` text. One-line edit.
- Pages without one: copy the block and CSS from nature-of-waves, write one question. Keep the question under 15 words.
- One micropass can safely cover 3-5 pages since the edit is mechanical.

## AVOID THESE MISTAKES
- Questions that are really topic titles ("Waves" is not a question).
- Yes/no or single-fact questions.
- Renaming the CSS classes; the visual identity must not change.
