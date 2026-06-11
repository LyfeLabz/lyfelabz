# Component: Teacher Artifact (Lab Notes export + Teacher Panel)

## PURPOSE
Two related deliverables that turn student activity into teacher-usable evidence and support with zero prep: (1) a copyable "Lab Notes" style export of what the student did, and (2) a collapsible teacher panel with standards, essential question, answer key, look-fors, and time estimate.

## WHEN TO USE
- Lab Notes export: every game, and any page whose evidence is play/exploration rather than a quiz score.
- Teacher panel: every page, eventually; start with lessons and investigations.

## WHEN NOT TO USE
- Do not put the answer key in a panel students can trivially open during classroom mode without the teacher knowing - keep it collapsed and labeled, not hidden behind fake security (it is fine for it to be openable; just make it obvious).

## GOLD-STANDARD REFERENCES
- game_photon-runner.html - the artifact-rich game reference (mission summary/notes export, per the gold standard audit; already rated 8/10 classroom-ready).
- docs/photon-runner-classroom-readiness-audit.md - what "classroom-ready" means for a game.

## STRUCTURE
Lab Notes export:
1. A "Copy Lab Notes" button compiling a plain-text summary: page, student name, predictions made, results observed, checkpoint outcomes, score/level.
2. Copies to clipboard with visible confirmation; pasteable into any LMS.

Teacher panel:
1. Collapsible `teacher-panel` near the page footer.
2. Contents: standards codes, essential question, learning goals, answer key, per-section look-fors, time estimate, classroom-mode link (`?mode=classroom`).

## COMMON CLASS NAMES
`teacher-panel` (new, defined here). Lab Notes export reuses each game's existing summary state.

## ACCESSIBILITY NOTES
- The collapsible uses a real `<button>`/`<details>` with proper expanded state.
- Clipboard copy confirmed in text, announced politely.

## MICROPASS IMPLEMENTATION NOTES
- Lab Notes: generalize photon-runner's pattern; the artifact text is just string-building from state the game already tracks. One micropass = one game.
- Teacher panel: write the content from the page itself (its quiz IS the answer key source). One micropass = one page.

## AVOID THESE MISTAKES
- Exports requiring a backend; clipboard text is the contract.
- Teacher panels with content that drifts from the actual page (generate from the page's real questions and standards).
- Styling that breaks the visual identity; the panel is quiet, collapsed by default.
