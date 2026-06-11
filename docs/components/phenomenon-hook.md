# Component: Phenomenon Hook

## PURPOSE
An observable, puzzling real-world event at the top of the page that the rest of the page explains. Anchors abstract content in something students can see and wonder about.

## WHEN TO USE
- Investigations, simulations, and games: the header `driving-question` block is relabeled "Phenomenon".
- Lessons: a phenomenon anchor section right after the header (the sun-earth-moon pattern).
- Extensions: a real-world hook (live moon data, Chernobyl frogs narrative).

## WHEN NOT TO USE
- Do not bolt a phenomenon onto pages about media literacy or process skills (ragebaiting) where a scenario hook fits better.
- Do not use a phenomenon the page never returns to.

## GOLD-STANDARD REFERENCES
- lesson_sun-earth-moon.html - strongest phenomenon framing in a lesson.
- lesson_phases-of-the-moon.html - heavy phenomenon use with live-logic flavor.
- extension_moon-tonight.html - clever live hook (the hook is good; the page around it is thin).
- extension_chernobyl-frogs.html - narrative-driven hook.

## STRUCTURE
1. In the hero: the `driving-question` block with `dq-label` text "Phenomenon".
2. One or two sentences describing the observable event in concrete terms.
3. The body of the page must return to it - the final reflection or quiz should let students explain the phenomenon.

## COMMON CLASS NAMES
`driving-question`, `dq-label` (relabeled). Lessons may also use their existing phenomenon section markup from sun-earth-moon.

## ACCESSIBILITY NOTES
- If the hook uses an image or animation, it needs `alt` text and a `prefers-reduced-motion` guard.

## MICROPASS IMPLEMENTATION NOTES
- For investigations/sims/games with an existing `driving-question`: relabel only. One-line edit.
- For pages lacking a hook: write 2-3 sentences describing something observable, reuse the existing block markup. Do not build new media.

## AVOID THESE MISTAKES
- "Phenomena" that are definitions in disguise.
- Hooks that require prior knowledge the page has not taught.
- Forgetting the callback - a phenomenon stated once and never revisited is decoration.
