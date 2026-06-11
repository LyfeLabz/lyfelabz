# Component: Learning Goals

## PURPOSE
A short, visible "By the end you can..." list near the top of the page. Tells students what success looks like and gives teachers a machine-readable summary for planning.

## WHEN TO USE
- Every page type. Lessons and investigations: 3 goals. Simulations, extensions, games: 1-3, condensed.

## WHEN NOT TO USE
- Do not list more than 3-4 goals; if you need more, the page is doing too much.
- Do not restate standards codes as goals; goals are student-facing.

## GOLD-STANDARD REFERENCES
- No page has this yet - it is the one [new] header component. Style it on the hero block of lesson_nature-of-waves.html so it inherits the existing visual identity.

## STRUCTURE
1. Placed in the hero, below the essential question / phenomenon block.
2. Heading text: "By the end you can..."
3. A list of items, each carrying `data-goal="..."` with the goal text, so index/teacher tools can aggregate them later.
4. Each goal starts with an observable verb: explain, predict, model, compare, use evidence to argue.

## COMMON CLASS NAMES
`learning-goals` (container), items carry `data-goal`. New but conventional; defined once here so every micropass uses the same names.

## ACCESSIBILITY NOTES
- Use a real `<ul>`/`<li>` list so screen readers announce the count.

## MICROPASS IMPLEMENTATION NOTES
- Write goals from the page's existing quiz and checkpoint questions - the assessments already reveal what the page teaches.
- One micropass = 3-5 pages. Add the block + CSS once per page; no other changes.
- Keep the CSS minimal and token-based (reuse hero text colors and spacing).

## AVOID THESE MISTAKES
- Goals using "understand" or "learn about" (not observable).
- Goals the page does not actually assess anywhere.
- Per-page CSS variants; define the style once and copy it.
