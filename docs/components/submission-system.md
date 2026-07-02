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
- Backend (Assessment v2, all future HQIM lessons): LyfeLabz_GScript_v2.js.
- Backend (legacy, older lessons on the old sheet): LyfeLabz_GScript.js.

## ASSESSMENT v2 CONTRACT (all future HQIM lessons)
Assessment v2 is a clean break. Every future lesson submits to LyfeLabz_GScript_v2.js
on the new Assessment v2 Google Sheet. The backend gives every lesson tab one shared,
teacher-friendly schema. The tab name identifies the lesson, so there is no Lesson column.

Each response row is:

Timestamp, Student Name, Block, Q1, Q2, ... QN, Score, 🧠 Show Your Thinking

where N is the number of quiz questions in that lesson. Most lessons have ten
(Q1-Q10), but a lesson may have more; Body Systems, for example, has fifteen
(Q1-Q15). Only the number of Q columns varies. The leading columns and the
trailing Score / 🧠 Show Your Thinking columns are the same for every lesson,
and the backend grows the row to fit however many answers the lesson posts.

Timestamp is added by the server. Every future lesson posts these fields, named exactly:

- `tab` - the lesson's tab name, which must be registered in TAB_CONFIG in LyfeLabz_GScript_v2.js.
- `studentName`, `block`
- `q1` through `qN` - one field per quiz question, named sequentially, where N equals the number of quiz questions in that lesson (for example `q1`-`q10` for a ten-question lesson, `q1`-`q15` for Body Systems).
- `score` - the score string, for example `9/10` or `14/15`.
- `thinking` - the 🧠 Show Your Thinking response, written into the final column.

The teacher workflow is unchanged: registering a lesson is still one line in
TAB_CONFIG, the sheet stays simple, and the digest reads the same columns by
name regardless of how many questions a lesson has.

No Teacher, Percent, Lesson, or Missed Questions columns. Do not add metadata columns.
Registering a new lesson is one line in TAB_CONFIG (tab name, optional header color); the
schema is always the same, so there is nothing else to configure.

## STRUCTURE
1. The 🧠 Show Your Thinking prompt and its textarea sit immediately before Submit (see the framework's Show Your Thinking section). Show Your Thinking is a required submission field.
2. Submission card near the page end: name/block fields, submit button.
3. Front-end validation blocks submission until every quiz question is answered and the Show Your Thinking response contains non-whitespace text. Submit stays disabled until both conditions are met.
4. On submit, send the Assessment v2 payload above, including the `thinking` field, to the lesson's script URL. The `thinking` field is submitted only when the student presses Submit; the model answer is revealed only after Submit.
5. Practice Mode follows the identical student workflow but performs no network submission. Classroom Mode submits `tab`, `studentName`, `block`, `q1`-`qN`, `score`, and `thinking`.
6. Visible success/failure state; failure leaves student work intact on screen.

## COMMON CLASS NAMES
Existing submit button and field patterns from the pages above; endpoint and payload field names must match the Assessment v2 contract in LyfeLabz_GScript_v2.js exactly.

## ACCESSIBILITY NOTES
- Real labels on inputs; submit result announced via `aria-live`.
- Keyboard-only users must be able to complete the entire flow.

## MICROPASS IMPLEMENTATION NOTES
- Copy the submission block from fossil-hunt (lightest complete example) for extensions, from protein-pathway for investigations.
- One micropass = one page. Verify a test POST reaches the script (or stub-verify payload shape) before closing.
- Pages with no path to evidence today: extension_moon-tonight, extension_body-systems, game_exercise, game_relay, game_cellular-showdown, game_is-it-alive.

## AVOID THESE MISTAKES
- New payload field names, or field names that do not match the Assessment v2 contract (breaks the shared spreadsheet).
- Omitting the `thinking` field, so 🧠 Show Your Thinking never reaches the teacher.
- Losing student work on a failed POST.
- Submitting in practice mode.
