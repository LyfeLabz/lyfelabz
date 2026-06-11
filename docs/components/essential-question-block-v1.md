# Component: Essential Question Block v1

**Status:** Pilot specification for Phase A1. Supersedes nothing; refines docs/components/essential-question.md with findings from a structural study of the five strongest lessons.
**Pilot pages:** lesson_nature-of-waves.html, lesson_sun-earth-moon.html, lesson_what-is-life.html, lesson_body-systems.html, lesson_eclipses.html

---

## Purpose

One labeled question at the top of every lesson that frames the whole page. Students get a reason to care before content begins; teachers get a one-line statement of what the page is for. The content already exists on all five pilot pages as the `driving-question` block - this component renames it, it does not redesign it.

## Findings from the five pilot lessons

All five heroes share the same anatomy, in the same order:

1. `hero-float` decorations (emoji spans; body-systems uses `hero-floats`, what-is-life uses `hero-cells` - cosmetic naming drift, leave alone)
2. `<div class="hero-badge">Lesson</div>`
3. `<h1>` title
4. One subtitle `<p>` (nature-of-waves names it `hero-sub`; the others use a bare `<p>` - leave alone)
5. `driving-question` block: `dq-icon` + `dq-label` + `dq-text`

Each page defines its own copy of the `.driving-question` CSS with a per-page accent color (teal on waves, accent2 blue on eclipses, etc.). This is intentional visual identity, not drift. Do not unify it.

**One structural variant:** lesson_eclipses.html wraps the label and text in a bare `<div>` instead of `<div class="dq-body">`. Harmless; do not touch in this pass.

## Placement

Inside the hero, after the title and subtitle, exactly where `driving-question` already sits. It is the last element a student reads before scrolling into the standards/learning-science badge rows and the first content section.

## Visual hierarchy

- The `h1` is the topic name. The Essential Question is the intellectual frame, one visual level below the title, one level above body text.
- The existing block already does this correctly: small uppercase label (`dq-label`), question in display font (`dq-text`, Fredoka One), bordered card with left accent bar.
- Relationship to standards: standards badges (`stem-badge`) answer "what does the state call this"; the EQ answers "what are we figuring out." They must never merge. The EQ stays in the hero; badges stay in their row below it.

## Structure (target markup)

```html
<div class="driving-question">
  <div class="dq-icon">🔍</div>
  <div class="dq-body">
    <div class="dq-label">Essential Question</div>
    <div class="dq-text">How can waves transfer energy without moving matter?</div>
  </div>
</div>
```

The ONLY change from current state on all five pilot pages is the label text: "Driving Question" becomes "Essential Question". One text node per page.

## Wording style

- A real question, answerable by the end of the page, never yes/no, under about 20 words.
- Student voice, concrete anchor where possible ("When you sprint for a bus..." on body-systems is the model).
- All five pilot questions already meet this bar. Keep them verbatim.

## Collapsible?

No. The block is 3 to 4 lines tall, carries the page's framing, and must be visible on first paint. Collapsing it would hide the most important sentence on the page to save almost no space. No JS, no toggle.

## Shared styling with existing cards?

It already has its own established style (`driving-question`) replicated per page with per-page accent colors. Keep it. Do not migrate it to checkpoint-card or note-card styling.

## Suggested class names

Keep the existing names exactly: `driving-question`, `dq-icon`, `dq-body`, `dq-label`, `dq-text`. Renaming classes is a visual-identity risk with zero benefit. Optionally, a future pass may add `data-eq` to the `dq-text` div so index/teacher tooling can aggregate questions; not required for the pilot.

## Accessibility notes

- The block is plain text; no ARIA needed.
- It must not become a heading. `h1` (title) to `h2` (`section-title`) hierarchy stays valid because the EQ uses divs.
- The label is uppercase via CSS `text-transform`, not typed in caps, so screen readers read it normally. Keep it that way.

## Mistakes to avoid

- Touching any CSS. The label fits in the same space ("Essential Question" is 18 chars vs "Driving Question" at 16; the label wraps fine at any width because the card is flex).
- Rewriting the questions. All five are already strong.
- Adding a second question block anywhere on the page.
- Renaming `dq-*` classes or "fixing" the eclipses `dq-body` variant in the same pass as the relabel.
- Em dashes in any text.

## Reference lessons

- lesson_nature-of-waves.html (gold standard block, lines ~592-599; CSS ~537-561)
- lesson_sun-earth-moon.html (strongest phenomenon tie-in)
- lesson_body-systems.html (best concrete-anchor wording)

## Micropass implementation notes

- **Micropass A1 (pilot):** on each of the five pages, edit the single text node `<div class="dq-label">Driving Question</div>` to `Essential Question`. Five one-line edits, one pass.
- Grep verification after edit: `grep -c 'Driving Question' <page>` must return 0; `grep -c 'Essential Question' <page>` must return 1.
- Also grep each page's `<meta name="description">` and any inline references to "driving question" in body copy or quiz feedback; relabel ONLY the dq-label in this pass and log any other occurrences for a follow-up text pass rather than chasing them.
- No CSS, JS, or markup structure changes. If anything beyond the label text needs to change to make the page render correctly, stop and flag.
