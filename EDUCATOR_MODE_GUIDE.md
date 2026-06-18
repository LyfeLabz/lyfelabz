# EDUCATOR MODE: IMPLEMENTATION GUIDE

Reference pattern extracted from `lesson_earths-layers.html` (the audited model).

Use this when adding Educator Mode notes to other lessons. Do not roll out without
an explicit instruction to do so. This guide does not change any student-facing content.

---

## WHAT EDUCATOR MODE IS

A teacher-facing instructional design note placed at the end of each major section.
Hidden from students by default. Revealed only when Educator Mode is on, so admins,
curriculum leaders, and DESE reviewers can see the pedagogy behind each section.

One note per section. Earth's Layers has 12, one for each section.

---

## ARCHITECTURE (copy verbatim)

CSS (in the lesson's `<style>`):

```css
.edu-note { display: none; }
body.ls-active .edu-note {
  display: block; max-width: 760px; margin: 2.5rem auto 0;
  padding: 1.4rem 1.7rem 1.5rem; box-sizing: border-box;
  background: rgba(122,143,166,0.05); border: 1px solid rgba(122,143,166,0.2);
  border-left: 4px solid var(--accent2); border-radius: 14px;
  animation: lsFadeIn 0.35s ease both;
}
.edu-note-label { font-size: 0.72rem; font-weight: 900; letter-spacing: 0.13em; text-transform: uppercase; color: rgba(122,143,166,0.8); margin-bottom: 1rem; }
.edu-note-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem 1.6rem; }
@media (max-width: 640px) { .edu-note-grid { grid-template-columns: 1fr; } }
.edu-note-head { font-size: 0.7rem; font-weight: 900; letter-spacing: 0.07em; text-transform: uppercase; color: rgba(159,184,204,0.75); margin-bottom: 0.35rem; }
.edu-note-text { font-size: 0.9rem; color: rgba(232,237,242,0.55); line-height: 1.6; font-style: italic; }
ul.edu-note-text { margin: 0; padding-left: 1.1rem; }
ul.edu-note-text li { margin-bottom: 0.2rem; }
ul.edu-note-text li:last-child { margin-bottom: 0; }
```

Toggle: there is no visible button. State is held in `sessionStorage['lyfelabz-ls']`
(`'on'` / unset) and applied as `body.ls-active`. Two scripts make it work:

1. Init (near the footer): adds `ls-active` on load if the session flag is on.
2. Global hotkey (end of `<body>`): Ctrl+Cmd+I (Mac) / Ctrl+Alt+I (Windows) toggles
   the flag and the class. It ignores keystrokes while an input/textarea is focused.

Reuse both scripts as-is. Do not invent a new toggle or storage key.

---

## NOTE STRUCTURE (markup template)

Place one note as the last child inside each section's `.container`, after the section
content. Always four cells, always in this order:

```html
<!-- ── Instructional Design note · Educator Mode ── -->
<div class="edu-note">
  <div class="edu-note-label">&#128218; Instructional Design</div>
  <div class="edu-note-grid">
    <div class="edu-note-item">
      <div class="edu-note-head">Why this section exists</div>
      <ul class="edu-note-text"><li>...</li><li>...</li></ul>
    </div>
    <div class="edu-note-item">
      <div class="edu-note-head">Cognitive science</div>
      <ul class="edu-note-text"><li>...</li></ul>
    </div>
    <div class="edu-note-item">
      <div class="edu-note-head">Bloom's / DOK</div>
      <ul class="edu-note-text"><li>... to ...</li><li>DOK ...</li></ul>
    </div>
    <div class="edu-note-item">
      <div class="edu-note-head">Accessibility considerations</div>
      <ul class="edu-note-text"><li>...</li></ul>
    </div>
  </div>
</div>
```

The four heads are fixed: **Why this section exists**, **Cognitive science**,
**Bloom's / DOK**, **Accessibility considerations**.

---

## WORDING STYLE

- Short bullet fragments, not sentences with periods stacked into paragraphs.
- 2 bullets for "Why", 2 to 3 for "Cognitive science", 2 lines for "Bloom's / DOK"
  (one Bloom range, one DOK), 3 bullets for "Accessibility".
- "Why this section exists" uses verb-led fragments ending in a period
  (e.g. "Anchor the unit in a real phenomenon.").
- "Cognitive science", "Bloom's / DOK", and "Accessibility" use bare tags, no period.
- Plain language. No jargon a teacher would have to look up without it earning its place.
- No em dashes anywhere. Use a spaced hyphen.
- No filler. Every bullet must say something specific to that section.
- Vary phrasing across sections. Shared features (a diagram, an analogy) may repeat a
  tag, but do not copy/paste a whole cell. If two sections read identically, rewrite one.

---

## BLOOM'S / DOK RANGES BY SECTION TYPE

Keep ratings conservative. They describe the cognitive demand on the student in that
section, not the aspiration. No DOK 4. (DOK 4 implies extended multi-day investigation
and is almost never present in a single lesson section.)

| Section type        | Bloom's              | DOK        |
|---------------------|----------------------|------------|
| Learning Goals      | Understand to Analyze| 1 to 3 *   |
| Vocabulary          | Remember to Understand| 1         |
| Engage              | Understand           | 2          |
| Explore (overview)  | Remember to Understand| 1 to 2    |
| Explore (concept)   | Understand to Analyze| 2          |
| Explore (mechanism) | Understand to Analyze| 2 to 3 **  |
| Quick Recall        | Understand to Apply  | 1 to 2     |
| Explain (synthesis) | Understand to Analyze| 3          |
| Evaluate (quiz)     | Understand to Apply  | 1 to 2     |
| Go Further          | Apply to Analyze     | 2 to 3     |

\* Learning Goals may span 1 to 3 only when the goals themselves reach a "explain how
X causes Y" target. If the goals are all describe/identify, cap at DOK 2.

\** Reserve DOK 3 for sections that require tracing a cause-and-effect chain or
reasoning from evidence (e.g. convection driving surface change). A single concept
explanation with a diagram is DOK 2.

Internal-consistency rule: a low-stakes recall check should not be rated higher than
the formal quiz. If Quick Recall includes a plain recall item, its floor is DOK 1.

---

## COGNITIVE SCIENCE TAGS BY SECTION TYPE

Pull from this vocabulary. Match the tag to what the section actually does.

- Learning Goals: Goal setting, Advance organizers
- Vocabulary: Pre-teaching vocabulary, Reduced extraneous load
- Engage: Curiosity gap, Phenomenon-based learning
- Explore (overview): Advance organizer, Dual coding, Pattern recognition
- Explore (origin/cause): Prior knowledge activation, Cause-and-effect modeling, Dual coding
- Explore (compare): Concrete to abstract, Comparison and contrast, Elaboration
- Explore (mechanism): Cause-and-effect modeling, Dual coding, Elaboration
- Explore (misconception): Misconception checking, Evidence-based reasoning
- Quick Recall: Retrieval practice, Generation effect, Productive struggle
- Explain: Schema building, Elaboration, Coherent narrative
- Evaluate: Retrieval practice, Feedback loops
- Go Further: Interest-driven extension, Transfer

Only tag "Dual coding" when the section pairs text with a real diagram or interactive.
Only tag "Misconception checking" when the section explicitly resolves a misconception.

---

## ACCESSIBILITY LANGUAGE PATTERNS

Describe concrete features present in the section, not generic claims.

- Vocabulary: "One card open at a time", "Click to reveal, no hover", "Plain, short definitions"
- Interactive/diagram sections: "Click to reveal, no hover", "Labeled diagram paired with text"
- Analogy sections: "Everyday analogy (name it)", "Key terms defined in place"
- Compare sections: "Side-by-side comparison cards", "Short, parallel bullet lists"
- Recall/quiz: "Ungraded and low stakes" / "Answer explanations provided", "Immediate feedback", "Plausible, evenly placed options"
- Go Further: "Optional and self-paced", "No penalty for skipping"

Keep to the project's standing accessibility rules: one vocab card open at a time,
click not hover, short paragraphs, high contrast, large targets.

---

## ROLLOUT RISKS TO WATCH FOR

1. **DOK inflation.** The most common error. Default to the conservative end. Justify
   any DOK 3 in the note's "Why"; never use DOK 4.
2. **Copy/paste cells.** Notes that read identically across sections look automated and
   lose credibility with reviewers. Tie every cell to that section's specific content.
3. **Em dashes.** Grep each edited file for the em dash character and replace with a
   spaced hyphen before finishing.
4. **Section count mismatch.** One note per section, placed last inside `.container`.
   Missing or duplicated notes break the "12 sections, 12 notes" expectation.
5. **Toggle drift.** Reuse the exact `sessionStorage['lyfelabz-ls']` key, `body.ls-active`
   class, and hotkey. A divergent key means the global hotkey stops working on that page.
6. **Student-view leakage.** Confirm `.edu-note { display: none; }` is present so notes
   never show with Educator Mode off.
7. **Tag accuracy.** Do not tag "Dual coding" or "Misconception checking" unless the
   feature is actually there.

---

## VERIFICATION CHECKLIST (run on every lesson after adding notes)

- [ ] Student view unchanged (notes hidden with Educator Mode off).
- [ ] All notes `display: none` when off, `display: block` when on.
- [ ] Note count equals section count.
- [ ] Global hotkey toggles the class.
- [ ] No console errors.
- [ ] No placeholder text.
- [ ] No em dashes.
