# Component: Reflection Section

## PURPOSE
A short free-response moment near the end of the page where students connect what they did back to the essential question or phenomenon in their own words.

## WHEN TO USE
- End of lessons and investigations, after the last concept/phase and before or alongside the quiz.
- Extensions where a quiz is too heavy (the template allows "short quiz OR reflection").
- The Reflect beat of every prediction cycle.

## WHEN NOT TO USE
- As a replacement for the quiz on assessable pages (it complements, not replaces).
- Multiple reflections per page; one is enough.

## GOLD-STANDARD REFERENCES
- lesson_what-is-life.html - clear phenomenon-to-concept arc ending in reflection.
- lesson_cell-types.html, lesson_wave-behavior.html - heavy reflect language.
- investigation_gray-zone.html - reflection through dense CER argumentation.

## STRUCTURE
1. Section with the standard `section-label` / `section-title` rhythm.
2. The essential question or phenomenon restated.
3. One open prompt ("Explain, using what you saw in the model...").
4. A textarea whose contents flow into the page's submission payload, so reflections reach the teacher.

## COMMON CLASS NAMES
Standard section classes; textarea wired to the existing Apps Script submission fields. No new component.

## ACCESSIBILITY NOTES
- Label the textarea with a real `<label>`.
- Do not time-limit or auto-clear student writing.

## MICROPASS IMPLEMENTATION NOTES
- One micropass = one page: add the section, one prompt, and include the field in the existing submission payload.
- Write the prompt as a direct callback to the page's essential question - never a generic "what did you learn?".

## AVOID THESE MISTAKES
- Generic prompts disconnected from the page's question.
- Reflections that never reach the submission payload (invisible to teachers).
- Requiring long minimum lengths; 2-3 sentences is the target.
