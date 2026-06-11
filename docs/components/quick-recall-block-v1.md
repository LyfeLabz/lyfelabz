# Component: Quick Recall Block v1

**Status:** Pilot complete (Micropass B-R1)
**Pilot page:** lesson_nature-of-waves.html, "Describing a Wave" / anatomy section
**Markup source:** investigation_amplitude-challenge.html checkpoint-card family
**Related specs:** docs/components/retrieval-practice.md, docs/lyfelabz-distribution-plan-v1.md (Phase A4)
**Rule:** No em dashes anywhere in this component or its content.

---

## 1. Purpose

Quick Recall is a single low-stakes retrieval-practice checkpoint placed at a section transition. It exists to:

- Trigger **low-stakes retrieval**, asking the student to pull an idea back from memory rather than reread it.
- Act as a **learning checkpoint** that confirms a key idea landed before the lesson moves on.
- Strengthen memory through **spaced recall**, the cheapest high-yield learning move available to the platform.

Quick Recall is explicitly **not**:

- **Not a graded quiz.** It carries no score, feeds no submission, and is labeled "Not graded" on screen.
- **Not a new teaching section.** It introduces no new content, vocabulary, standard, or explanation. It only asks the student to recall something already taught.

The pilot copy reinforces this: the eyebrow reads "Quick Recall" and the sub reads "Just a quick brain check before we move on. Not graded."

---

## 2. Placement Rules

The central lesson from the pilot:

> **The prompt must target content taught before the block appears.** A Quick Recall is retrieval, not a checkpoint on the section just read. If the answer was explained in the paragraph directly above it, it is recognition, not recall, and does not belong.

Concrete rules:

- The **answer must already be assessed somewhere on the page** (quiz, checkpoint, self-check) or be clearly central to the lesson. Do not introduce a fact only to test it.
- Place it at **section transitions**, where the lesson naturally pauses before the next idea. The pilot sits at the end of the wave-anatomy section, just before the bridge callout into wavelength.
- **Do not place it inside explanations.** It is a pause between ideas, not an interruption mid-thought.
- **Do not interrupt simulations, animations, or hands-on interactions.** Never insert a Quick Recall between a control and the model it drives, or in the middle of a multi-step interactive.

---

## 3. Content Rules

- **One question only** per block.
- **Short wording.** The pilot question is a single sentence.
- **Student-friendly language.** Plain phrasing, no jargon beyond what was taught.
- **No new vocabulary.** Every term in the question and options has already appeared on the page.
- **No new standard.** The block aligns to nothing the page does not already cover.
- **No new science content.** Nothing is taught here.
- **Answer must be unambiguous.** Exactly one option is defensibly correct; distractors are clearly wrong to a student who learned the material.
- **Feedback is two short forms:** one sentence if correct, one corrective sentence if incorrect. The corrective sentence names why the wrong choice is wrong and points to the right idea, without scolding.

Pilot example:

- Question: "A wave dips below the resting position. What do scientists call the lowest point of that dip?"
- Correct feedback: "Right! The trough is the lowest point of a wave, the bottom of each dip."
- Corrective feedback: "Not quite. The crest is the top of each peak and the resting position is the calm middle line, so the lowest point of a dip is the trough."

---

## 4. Structure

The pilot uses the following class structure, all under the `qr-` namespace:

| Class | Role |
|---|---|
| `qr-card` | Outer container, max-width 760px, teal-tinted border, matches card tokens |
| `qr-eyebrow` | Uppercase label reading "Quick Recall" |
| `qr-sub` | One-line low-stakes framing ("Just a quick brain check before we move on. Not graded.") |
| `qr-q` | The single question |
| `qr-options` | The answer set, `role="group"` with `aria-labelledby` pointing at the question |
| `qr-feedback` | The feedback region, `aria-live="polite"`, hidden until checked |
| `qr-actions` | Holds the Check Answer and Try Again buttons (`qr-check`, `qr-retry`) |

The `qr-` namespace is **currently reserved for Quick Recall** and has **no known collision** with any existing class in the repo. Each page that adopts the block defines the `qr-*` CSS self-contained inside that page.

---

## 5. Accessibility Requirements

The pilot established these choices, and adopters must keep all of them:

- **Native radio inputs** for the options (or native `<button>` elements). No div-only click targets.
- **`role="group"`** on the options container.
- **`aria-labelledby`** on the options container, pointing at the question's id, so the group is announced with its question.
- **`aria-live="polite"`** on the feedback region so screen readers announce feedback when it reveals.
- **Visible focus state.** Options show a focus ring via `:focus-within`; buttons use `:focus-visible` outlines.
- **Focus returns to the first option after Try Again**, so a keyboard or screen-reader user lands back at the start of the choices.
- **No div-only click targets.** Every interactive element is a real form control or button.

---

## 6. Implementation Rules

- **Self-contained CSS and JS inside each static HTML page.** Copy the `qr-*` styles and the IIFE script into the page; do not extract a shared file.
- **No shared dependencies.** Each page stands alone, which is what makes per-page micropasses safe.
- **No Apps Script changes.** Quick Recall never posts anywhere.
- **No analytics changes.**
- **Do not touch quiz logic.** The block is independent of `quiz-section` and its scoring.
- **Do not touch classroom/practice mode logic.** Mode JS queries quiz and submission elements only; Quick Recall is static markup it never sees.
- **Use existing page tokens and accent colors** (the pilot reuses `--card`, `--teal`, `--green`, `--red`, `--border`, `--dark`, `--text`, `--text-muted`).
- **No em dashes** in markup, copy, or comments. Use a spaced hyphen.

When IDs are duplicated across multiple blocks on one page, suffix them per block (`qr1`, `qr2`, ...) as the pilot does with `qrCard1`, `qr1Q`, `qr1Opts`.

---

## 7. Verification Checklist

Run this on every page that adopts Quick Recall:

- [ ] Placement correct (prompt targets earlier content, at a section transition, not inside an explanation or interactive).
- [ ] One-page-only change.
- [ ] Interaction works (select, check, feedback reveals).
- [ ] Wrong answer flow works (marks wrong, shows corrective sentence, offers Try Again).
- [ ] Correct answer flow works (marks correct, shows confirming sentence, locks inputs).
- [ ] Feedback reveals (region becomes visible and is populated).
- [ ] Keyboard usable (tab to options, select, check, Try Again, all reachable).
- [ ] Screen reader feedback region exists (`aria-live="polite"`).
- [ ] Mobile layout correct at 360px and 768px.
- [ ] Desktop layout correct.
- [ ] No console errors.
- [ ] Existing quiz still works.
- [ ] Existing classroom/practice mode still works.
- [ ] Zero em dashes.

---

## 8. Distribution Readiness

Quick Recall is ready for **careful, page-by-page distribution**. It is **not ready for automated bulk rollout**, because each question requires a content audit: an editor must confirm the prompt targets content taught earlier on that page, the answer is already assessed there, the distractors are unambiguous, and no new vocabulary or content sneaks in. That judgment cannot be scripted. One page per micropass, verified before closing.

---

## 9. Next Candidate Pages

The five strongest next candidates, drawn from the gap matrix (lessons with multiple sections, a quiz to source unambiguous items from, and a clean section transition):

### 1. lesson_sun-earth-moon.html
- **Why a good fit:** Strong multi-section lesson with a 10-question quiz to source items, and clearly separated concepts (rotation vs revolution, orbit balance, system).
- **Likely section for insertion:** transition out of the rotation-vs-revolution section, before the orbit/gravity section.
- **Likely retrieval target:** the difference between rotation and revolution, or the time each takes (quiz Q4, Q6, Q7).
- **Check before implementation:** confirm the target term was defined in an earlier section, not the one just before the block; confirm a clean transition exists that is not mid-interactive.

### 2. lesson_eclipses.html
- **Why a good fit:** Distinct sections (two kinds of eclipse, anatomy of a shadow, tilted orbit) and a quiz; retrieval reinforces easily confused terms.
- **Likely section for insertion:** after "Anatomy of a Shadow," before "The Tilted Orbit."
- **Likely retrieval target:** umbra vs penumbra, or solar vs lunar eclipse and the phase each requires (quiz Q1, Q2, Q3, Q8).
- **Check before implementation:** eclipses has a noted missing dq-body; do not touch it. Confirm the umbra/penumbra terms were taught before the insertion point.

### 3. lesson_what-is-life.html
- **Why a good fit:** Clean phenomenon-to-concept arc with discrete sections (six characteristics, discovery of cells, cell types) and a 9-question quiz.
- **Likely section for insertion:** after "The Discovery of Cells," before the prokaryotic/eukaryotic comparison.
- **Likely retrieval target:** a characteristic of life such as homeostasis, or "all living things are made of at least one cell" (quiz Q3, Q4).
- **Check before implementation:** ensure the recalled idea is from an earlier section, not the reflection-heavy closing; confirm no new term is introduced.

### 4. lesson_body-systems.html
- **Why a good fit:** Already has a checkpoint, proving the markup family works on the page; levels-of-organization content is highly recall-friendly.
- **Likely section for insertion:** after the levels-of-organization section, before the systems-interaction section.
- **Likely retrieval target:** ordering cells to tissues to organs to systems (quiz Q1, Q2).
- **Check before implementation:** confirm the new Quick Recall is not back-to-back with the existing checkpoint covering the same idea; place it at a different transition.

### 5. lesson_continental-drift.html
- **Why a good fit:** Phenomenon-framed lesson with multiple evidence sections and a quiz, good material for recalling evidence types.
- **Likely section for insertion:** after the first evidence section (fossils or matching coastlines), before the mechanism section.
- **Likely retrieval target:** a named line of evidence for drift taught earlier in the lesson.
- **Check before implementation:** verify the evidence term is assessed in the quiz or central to the lesson; confirm the section boundary is a true transition and not mid-diagram.

---

## 10. Recommended Next Prompt

> You are executing the LyfeLabz Distribution Phase, Phase A4 (retrieval practice). Read docs/components/quick-recall-block-v1.md, docs/components/retrieval-practice.md, and docs/lyfelabz-distribution-plan-v1.md. Implement exactly one Quick Recall block on each of these three lesson pages, and no others: lesson_sun-earth-moon.html, lesson_eclipses.html, lesson_what-is-life.html.
>
> For each page: (1) copy the `qr-*` CSS and the Quick Recall IIFE script verbatim from lesson_nature-of-waves.html, adjusting only the block id suffix, the question, the options, the correct index, and the two feedback sentences; (2) place the block at a section transition where the prompt targets content taught in an EARLIER section and the answer is already assessed by that page's quiz; (3) write one question, short and student-friendly, no new vocabulary, no new content, one unambiguous correct answer, one confirming sentence and one corrective sentence.
>
> Do not touch quiz logic, classroom/practice mode logic, Apps Script, or analytics. Do not edit any other page, CSS, or JS. No em dashes anywhere; use a spaced hyphen. After each page, run the Section 7 verification checklist (placement, both answer flows, keyboard, aria-live region, 360px and 768px and desktop, no console errors, existing quiz and mode still work, zero em dashes). Then stop and report a per-page checklist. Do not continue to further pages.

---

## Pilot Reference Implementation

The canonical markup, CSS, and JS live in lesson_nature-of-waves.html (Section 5, "Describing a Wave"). Copy from there, not from this doc, so adopters inherit the exact tested behavior.
