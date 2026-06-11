# Component: Note Card

## PURPOSE
A small printable callout at the end of each concept section summarizing its one takeaway. Gives students a built-in study sheet and teachers a printable summary.

## WHEN TO USE
- Lessons first (one per concept section), then extensions.

## WHEN NOT TO USE
- Investigations/simulations/games, where checkpoints and lab notes already capture takeaways.
- More than one per section; a note card holds exactly one idea.

## GOLD-STANDARD REFERENCES
- None yet - `note-card` appears nowhere in the repo. It is a [new] component, styled from the existing card/callout tokens in lesson_nature-of-waves.html so it inherits the visual identity.

## STRUCTURE
1. `note-card` element at the end of a concept section, before its checkpoint.
2. A short label ("Key Idea") plus 1-2 sentences in student language.
3. Print-friendly: dark-on-light in print CSS, cards collectively forming a one-page summary.

## COMMON CLASS NAMES
`note-card` (new, defined here - use this name everywhere).

## ACCESSIBILITY NOTES
- Plain text content; ensure sufficient contrast in both screen and print styles.

## MICROPASS IMPLEMENTATION NOTES
- Define the CSS once (first pass on nature-of-waves), then copy verbatim.
- One micropass = one lesson, 3-6 note cards. Write each card from the section's existing `section-desc` and checkpoint answer.
- Lower priority than checkpoints and retrieval; schedule in Phase B.

## AVOID THESE MISTAKES
- Cards that introduce new information (summaries only).
- Paragraph-length cards.
- Per-page styling variants.
