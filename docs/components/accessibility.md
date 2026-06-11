# Component: Accessibility Standard

## PURPOSE
The platform-wide floor every page must meet: keyboard operable, visible focus, motion-safe, alt text, touch parity. Accessibility is currently the weakest dimension repo-wide (0 pages use `alt=`, 3 use `prefers-reduced-motion`, 4 use `:focus-visible`).

## WHEN TO USE
- Every page, every micropass. Any pass that touches interactive markup leaves it at or above this floor.

## WHEN NOT TO USE
- Not applicable - there is no page exempt from this standard.

## GOLD-STANDARD REFERENCES
- investigation_amplitude-challenge.html - best current example: `:focus-visible`, `prefers-reduced-motion`, `tabindex` (10 hits across accessibility markers).
- investigation_protein-pathway.html, simulation_eclipse-alignment.html - the other reduced-motion adopters.

## STRUCTURE (the floor)
1. Keyboard: every interactive control reachable and operable by keyboard; no keyboard traps; games accept keyboard AND touch (no keyboard-only games - photon-runner is the first fix).
2. Focus: `:focus-visible` rings on all controls, using the existing accent tokens.
3. Motion: all CSS/JS animation wrapped in or gated by `prefers-reduced-motion`.
4. Images/canvases: meaningful `alt` on images, `role="img"` + `aria-label` on canvases/SVG diagrams.
5. Live feedback: checkpoint/quiz/submission results in `aria-live="polite"` regions.
6. Color: never the sole carrier of correct/incorrect or state.

## COMMON CLASS NAMES / PATTERNS
`:focus-visible` ring rule (define once, copy verbatim), `@media (prefers-reduced-motion: reduce)` block, `aria-live` feedback regions.

## ACCESSIBILITY NOTES
This document is the accessibility note for all other components; each component doc cross-references it.

## MICROPASS IMPLEMENTATION NOTES
- These are ideal micropasses: each item is mechanical and verifiable.
- Pass types: (a) focus-ring pass, (b) reduced-motion pass, (c) alt/aria pass, (d) touch-input pass. One pass type x one page at a time.
- Copy the exact rules from amplitude-challenge so focus styling stays on-brand.

## AVOID THESE MISTAKES
- Decorative `alt` text on meaningful diagrams (describe what it shows, not "diagram").
- `outline: none` anywhere.
- Reduced-motion handling that hides content instead of stilling it.
- Treating accessibility as a final phase; it rides along with every pass.
