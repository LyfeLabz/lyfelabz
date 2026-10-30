# LyfeLabz Chevron Convention (teacher workspace)

Status: adopted 2026-10-29 with Student Support Workspace V2 final UX polish.
Scope: the authenticated app (`app/index.html` + `app/src/shell`). Lesson
pages keep their own canonical vocabulary-card chevron (`▾` / `▴`, see
CLAUDE.md VOCABULARY); this document does not change lessons.

## The primitive

Add the class `ll-chevron` to the control (normally a `<button>`). The CSS in
`app/index.html` draws the chevron as generated content on `::after`:

- one stroke chevron (2px right + bottom border on a 0.5em square, rotated),
  in `currentColor`, scaled to the control's font size;
- generated content with no text, so the control's accessible name stays its
  own text;
- a 0.15s rotation, disabled under `prefers-reduced-motion: reduce`.

| Use | Markup | Direction |
| --- | --- | --- |
| Disclosure, collapsed | `button.ll-chevron[aria-expanded="false"]` | down |
| Disclosure, expanded | `button.ll-chevron[aria-expanded="true"]` | up |
| Navigation (goes somewhere) | `.ll-chevron.ll-chevron--nav` (no `aria-expanded`) | right |

State is carried by direction plus `aria-expanded`, never by color.

## What the host control owns

The primitive only draws the icon. The control that carries it must provide:

- a real `<button type="button">` for disclosures, with `aria-expanded` and
  `aria-controls` pointing at the region it shows or hides;
- a usable hit target: the whole header text is the button (min-height
  28-40px by context, 44px under `@media (pointer: coarse)`);
- a visible `:focus-visible` ring (`var(--tw-focus-ring)`);
- optionally a muted chevron color via `.your-toggle::after { color: ... }`
  (color only; never its own `content` or `transform`).

Do not give a `.ll-chevron` host its own glyph or rotation. Do not replace
native `<select>` indicators or unrelated icons with it.

Guarded by `app/src/shell/chevron-convention-css.test.ts`.

## Where it is applied

- Settings > Student Services section headers (`.shell-ss-disclosure-toggle`,
  `settings.ts`).
- Share Student Progress > "Teachers with access (N)"
  (`classSupportAccess.ts`). Teacher groups inside it are not disclosures.
- Student Detail assessment toolbar (`.shell-student-detail-tool`,
  `studentDetailQuestionReview.ts`): Review answers, Repeated misses and
  Student thinking, all collapsed at first, one open at a time. The open
  tool adds a green edge and wash; its chevron points up.

## Remaining inconsistencies (audit, not yet migrated)

These predate the convention. They were left alone deliberately so this
change does not collide with the separate navigation/performance work.
Migrate each in its own bounded operation by adding `ll-chevron` and deleting
the local `::after` glyph and rotation.

| Control | Location | Current treatment |
| --- | --- | --- |
| Lesson card Resources | `.shell-lesson-resources-toggle` | `›` glyph, rotates right to down |
| Assign row history | `.shell-assign-row-history-toggle` | `›` glyph, no rotation |
| Assignment detail class switcher | `.shell-assignment-detail-class-toggle` | `›` glyph |
| Student Detail grade update | `.shell-student-detail-grade-update-toggle` | `›` glyph, rotates right to down |
| Student My Science attempts | `.my-science-attempts-toggle` | `›` glyph, rotates right to down |
| My Units card | `.shell-units-card-chevron` (inline SVG) | stroke chevron, down/up (matches direction; different drawing, stroke 2.5) |
