# Component: Learning Goals Block v1

**Status:** Pilot specification for Phase A2. Refines docs/components/learning-goals.md with concrete markup and CSS derived from the five strongest lessons. This is the one [new] header component; no page has it yet.
**Pilot pages:** lesson_nature-of-waves.html, lesson_sun-earth-moon.html, lesson_what-is-life.html, lesson_body-systems.html, lesson_eclipses.html

---

## Purpose

A short, visible "By the end of this lesson, you can..." list in the hero. Students see what success looks like before content begins; teachers get a scannable, machine-readable (`data-goal`) summary of what the page teaches. Goals are extracted from each page's existing quiz - the assessments already reveal what the page teaches, so no invention is required.

## Location relative to the Essential Question

Directly below the `driving-question` block, still inside `<header class="hero">`, before the closing `</header>`. Order on every page becomes:

1. hero-badge
2. h1
3. subtitle p
4. driving-question (Essential Question)
5. **learning-goals (new)**

Rationale: the EQ poses the problem; the goals immediately answer "and here is what you will be able to do about it." Both stay above the standards and learning-science badge rows, which remain untouched below the hero.

## Structure (target markup)

```html
<div class="learning-goals">
  <div class="lg-label">By the end you can</div>
  <ul class="lg-list">
    <li data-goal="Explain how a wave transfers energy without moving matter">Explain how a wave transfers energy without moving matter</li>
    <li data-goal="...">...</li>
    <li data-goal="...">...</li>
  </ul>
</div>
```

- Real `<ul>`/`<li>` list (screen readers announce the count).
- Each `<li>` carries `data-goal` mirroring its visible text so index/teacher tools can aggregate later.
- 3 goals standard, 5 absolute maximum. If a page seems to need more, the goals are too granular.

## Card style and CSS

Mirror the `driving-question` card exactly, using the same per-page accent color the page already uses for its dq block, at slightly lower visual weight (goals support the question, they do not compete with it). Define once per page, adjacent to the existing `.driving-question` rules:

```css
.learning-goals {
  max-width: 760px;
  margin: 0.9rem auto 0;
  padding: 1rem 1.6rem;
  background: rgba(ACCENT, 0.04);
  border: 1px solid rgba(ACCENT, 0.16);
  border-radius: 14px;
  text-align: left;
  box-sizing: border-box;
}
.lg-label {
  font-size: 0.7rem;
  font-weight: 900;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: rgba(ACCENT, 0.8);
  margin-bottom: 0.5rem;
}
.lg-list { margin: 0; padding-left: 1.2rem; list-style: none; }
.lg-list li {
  position: relative;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--text);
  padding: 0.15rem 0;
}
.lg-list li::before { content: '✓'; position: absolute; left: -1.2rem; color: rgba(ACCENT, 0.8); font-weight: 800; }
```

ACCENT is the page's existing dq accent (e.g. `59,200,232` teal on nature-of-waves, `122,143,200` on eclipses). Copy the rgba triplet from the page's own `.driving-question` rules; never introduce a new color.

- No left border bar (that is the EQ's signature; the goals card is the quieter sibling).
- Same `max-width: 760px` and border-radius 14px so the two cards read as a pair.

## Iconography

A single CSS checkmark bullet per goal (above). No emoji per line, no icon font, no images. The hero already carries 4 floating emoji; more iconography becomes noise.

## Spacing

`margin: 0.9rem auto 0` (slightly tighter than the dq's 1.6rem top margin) so EQ + goals read as one framing unit while the title keeps its breathing room. On mobile nothing special is needed: both cards are full-width fluid below 760px, matching the dq's existing behavior. Verify text does not overflow at 360px width.

## Class names

`learning-goals` (container), `lg-label`, `lg-list`, items carry `data-goal`. These match docs/components/learning-goals.md and must be identical on every page so future tooling and CSS extraction work.

## Goal wording rules

- Start with an observable verb: explain, predict, compare, model, identify, use evidence to argue. Never "understand" or "learn about".
- Student-facing second person is implied by the "By the end you can" label; goals themselves start with the verb.
- Every goal must map to at least one existing quiz question or checkpoint on the page. If you cannot point to the assessment item, the goal does not go in.
- Standards stay in the `stem-badge` row; never quote a standard code inside a goal.

## Accessibility

- Semantic `<ul>`; no role attributes needed.
- Label is a div styled uppercase, not a heading, preserving h1 > h2 hierarchy.
- Checkmark is a CSS pseudo-element so screen readers skip it; the list semantics already convey enumeration.
- Color contrast: goal text uses `var(--text)` on the near-transparent card background, same contrast as dq-text. The label inherits the dq-label opacity pattern which is decorative; the meaning is carried by the list itself.

## Examples

From lesson_sun-earth-moon.html quiz content:

```html
<div class="learning-goals">
  <div class="lg-label">By the end you can</div>
  <ul class="lg-list">
    <li data-goal="Explain how gravity and motion keep the Moon in orbit instead of crashing or flying away">Explain how gravity and motion keep the Moon in orbit instead of crashing or flying away</li>
    <li data-goal="Tell the difference between rotation and revolution and give the time each takes for Earth and the Moon">Tell the difference between rotation and revolution and give the time each takes for Earth and the Moon</li>
    <li data-goal="Explain why scientists use models to study the Sun-Earth-Moon system">Explain why scientists use models to study the Sun-Earth-Moon system</li>
  </ul>
</div>
```

Full pilot content for all five pages: docs/pilot-eq-learning-goals.md.

## Micropass notes

- **Micropass A2 (pilot):** one pass, five pages. Per page: (1) copy the CSS block above into the page's style section next to `.driving-question`, substituting that page's accent rgba; (2) insert the markup directly after the closing `</div>` of `driving-question`, before `</header>`; (3) paste the goals from docs/pilot-eq-learning-goals.md verbatim.
- Run AFTER Micropass A1 (relabel) so the pass is purely additive.
- Verify per page: block renders below the EQ, mobile width 360px has no overflow, badge rows below the hero are unmoved, zero console errors, goal count is 3 to 5.
- Body-systems hero has stray blank lines before `</header>`; insert the block before them, do not "clean up" the whitespace in this pass.

## Mistakes to avoid

- Goals that nothing on the page assesses.
- "Understand", "learn about", "know" as goal verbs.
- More than 5 goals, or goals restating standards codes.
- Per-page CSS redesigns: only the accent rgba triplet may differ between pages.
- Adding the block outside the hero, or above the EQ.
- A collapsible/toggle version. Like the EQ, it is small and must be visible on first paint.
- Em dashes in any text.
