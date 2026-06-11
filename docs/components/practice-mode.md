# Component: Practice Mode

## PURPOSE
The self-study state of a page: everything unlocked, immediate feedback, nothing recorded. Lets students explore and retry without grade pressure.

## WHEN TO USE
- Default state of every assessable page. A page loads in practice mode unless `?mode=classroom` is present.

## WHEN NOT TO USE
- Do not strip feedback from practice mode; instant feedback is its whole point.
- Pure-play games without assessment do not need a mode concept at all.

## GOLD-STANDARD REFERENCES
- simulation_gravity-wells.html - the reference implementation: `mode-btn` toggle, mode hints (`modeHintPractice`), unlocked exploration.
- All 13 lessons already carry the `mode-btn` quiz toggle - practice behavior at quiz level is widely distributed.

## STRUCTURE
1. `mode-btn` pair (Practice active by default).
2. In practice: quiz gives per-question feedback, retries allowed, submission disabled or clearly marked unrecorded.
3. A `modeHintPractice` line telling students nothing is being recorded.

## COMMON CLASS NAMES
`mode-btn`, `mode-btn.active`, `modeHintPractice`.

## ACCESSIBILITY NOTES
- Mode buttons keyboard operable; current mode conveyed in text, not color alone (use `aria-pressed`).

## MICROPASS IMPLEMENTATION NOTES
- Pair every practice-mode pass with classroom-mode (they ship together; see classroom-mode.md).
- Port from gravity-wells verbatim. One micropass = one page.
- Verify: load page plain = practice; feedback shows; nothing submits.

## AVOID THESE MISTAKES
- Practice mode that secretly records scores.
- Divergent toggle styling per page.
- Hiding content in practice mode; practice shows more, not less.
