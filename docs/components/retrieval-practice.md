# Component: Retrieval Practice

## PURPOSE
A prompt at the end of each major section that asks students to recall material from earlier sections - not the one they just read. Spaced retrieval is the cheapest high-yield addition available to the platform.

## WHEN TO USE
- Every page type. One cumulative prompt per major section.
- Required in extensions (the minimum bar so no extension is a dead end).

## WHEN NOT TO USE
- The first section of a page (nothing to retrieve yet) - its prompt can pull from a prerequisite page instead, sparingly.
- Back-to-back with a checkpoint covering the same idea.

## GOLD-STANDARD REFERENCES
- (no dedicated canonical example yet; markup source: checkpoint-card from investigation_amplitude-challenge.html)
- No page does this systematically yet; the checkpoint-card structure from investigation_amplitude-challenge.html is the markup to reuse.

## STRUCTURE
1. Reuse the `checkpoint-card` structure with the label text "Quick Recall" (or similar), visually identical to a checkpoint.
2. The question pulls from an earlier section or a prerequisite page, never the section just finished.
3. Immediate feedback with a pointer back to where the idea was taught.

## COMMON CLASS NAMES
`checkpoint-card` family, distinguished only by label text. No new component needed.

## ACCESSIBILITY NOTES
- Same as checkpoint-card: button options, focus rings, `aria-live` feedback.

## MICROPASS IMPLEMENTATION NOTES
- One micropass = one page, adding 1-3 retrieval prompts. Write questions from earlier sections' checkpoint/quiz items, rephrased.
- Highest learning-yield-per-line-of-code change in the roadmap; safe to run early and often.

## AVOID THESE MISTAKES
- Retrieval prompts about the section the student just finished (that is a checkpoint, not retrieval).
- Recognition-only questions where the answer is visible on screen.
- Inventing a new visual style; it should look like the existing checkpoint card.
