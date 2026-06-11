# Component: Submission System

## PURPOSE
The path from student work to teacher evidence: a submit action posting name/class/score/responses to the LyfeLabz Google Apps Script. No page should be a dead end for a teacher collecting evidence.

## WHEN TO USE
- Every assessable page. Required on all extensions per the gold standard template.

## WHEN NOT TO USE
- Do not submit silently or automatically; submission is an explicit student action.
- Do not collect more than needed (name/identifier, class, score, responses).

## GOLD-STANDARD REFERENCES
- investigation_protein-pathway.html - phased work flowing into submission.
- simulation_gravity-wells.html - submission gated by classroom mode.
- extension_fossil-hunt.html - proof extensions can carry full submission.
- Backend: LyfeLabz_GScript.js.

## STRUCTURE
1. Submission card near the page end: name/class fields, submit button.
2. POST to the shared Apps Script endpoint with page id, mode, score, and key responses (CER, reflection).
3. Visible success/failure state; failure leaves student work intact on screen.

## COMMON CLASS NAMES
Existing submit button and field patterns from the pages above; endpoint and payload field names must match LyfeLabz_GScript.js exactly.

## ACCESSIBILITY NOTES
- Real labels on inputs; submit result announced via `aria-live`.
- Keyboard-only users must be able to complete the entire flow.

## MICROPASS IMPLEMENTATION NOTES
- Copy the submission block from fossil-hunt (lightest complete example) for extensions, from protein-pathway for investigations.
- One micropass = one page. Verify a test POST reaches the script (or stub-verify payload shape) before closing.
- Pages with no path to evidence today: extension_moon-tonight, extension_body-systems, game_exercise, game_relay, game_cellular-showdown, game_is-it-alive.

## AVOID THESE MISTAKES
- New payload field names (breaks the shared spreadsheet).
- Losing student work on a failed POST.
- Submitting in practice mode.
