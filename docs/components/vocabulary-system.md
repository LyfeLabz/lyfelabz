# Component: Vocabulary System

## PURPOSE
A word bank up top plus inline vocab cards with hover definitions, so students meet terms in context and can always recover a definition without leaving the page.

## WHEN TO USE
- Every lesson. Investigations and simulations with 4+ technical terms.
- Extensions that introduce new terms.

## WHEN NOT TO USE
- Pages with fewer than 3 new terms (a single inline definition is enough).
- Games mid-play; define terms in the briefing/intro, not during the action.

## GOLD-STANDARD REFERENCES
- lesson_nature-of-waves.html - the reference implementation: `word-bank` + inline `vocab-*` cards with `data-tip` hover definitions (35 vocab touches).
- lesson_phases-of-the-moon.html, lesson_sun-earth-moon.html - dense, consistent inline vocab use.

## STRUCTURE
1. `word-bank` block in or just under the hero listing the page's terms.
2. First in-body use of each term wrapped in a `vocab-*` element with `data-tip` containing a one-sentence student-friendly definition.
3. Definitions written in plain language, ideally referencing the page's own model or phenomenon.

## COMMON CLASS NAMES
`word-bank`, inline `vocab-*` family, `data-tip` attribute.

## ACCESSIBILITY NOTES
- Hover-only tooltips exclude keyboard and touch users: vocab elements need `tabindex="0"` and the tip shown on focus as well as hover.
- Tooltip text must be available to screen readers (e.g. `aria-describedby` or visible-on-focus pattern).

## MICROPASS IMPLEMENTATION NOTES
- Copy the word-bank and vocab CSS/markup from nature-of-waves.
- One micropass = one lesson: add word bank + tag 5-10 first-use terms. Do not rewrite prose.
- Pick terms from the page's existing quiz; those are the ones that matter.

## AVOID THESE MISTAKES
- Tagging every occurrence of a term (first use only).
- Dictionary-grade definitions; keep them sixth-grade plain.
- Adding terms the page never actually uses or assesses.
