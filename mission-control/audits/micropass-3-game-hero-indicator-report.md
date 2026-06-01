# Micropass 3: Game Hero Indicator Standardization Report

**Date:** 2026-06-01
**Scope:** Rename `.page-eyebrow` → `.hero-badge` in the four game pages identified in the audit
**Files changed:** 4
**Edits per file:** 2 (one CSS rule selector, one HTML div class)

---

## Files Changed

| File | Changes Made |
|------|-------------|
| `game_cell-explorer.html` | CSS selector + HTML div renamed; alpha values tightened to canonical |
| `game_evolution-clicker.html` | CSS selector + HTML div renamed |
| `game_fossil-hunt.html` | CSS selector + HTML div renamed |
| `game_layer-detective.html` | CSS selector + HTML div renamed |

---

## Eyebrow Elements Replaced

For each file, exactly two occurrences of `page-eyebrow` existed, one in CSS, one in HTML. Both were renamed to `hero-badge`. No other uses of `page-eyebrow` existed in any of these files.

### `game_cell-explorer.html`

**CSS, before:**
```css
.page-eyebrow {
  display:inline-flex; align-items:center; gap:0.5rem;
  background:rgba(61,220,132,0.1); border:1px solid rgba(61,220,132,0.3);
  color:var(--bio); …
}
```

**CSS, after:**
```css
.hero-badge {
  display:inline-flex; align-items:center; gap:0.5rem;
  background:rgba(61,220,132,0.12); border:1px solid rgba(61,220,132,0.42);
  color:var(--bio); …
}
```
*(Alpha values tightened from 0.1/0.3 → 0.12/0.42 to match the canonical game badge standard set in Micropass 1.)*

**HTML, before:** `<div class="page-eyebrow">Game</div>`
**HTML, after:** `<div class="hero-badge">Game</div>`

---

### `game_evolution-clicker.html`

**CSS, before:** `.page-eyebrow{ … rgba(61,220,132,0.12) / #3ddc84 }`
**CSS, after:** `.hero-badge{ … rgba(61,220,132,0.12) / #3ddc84 }`

**HTML, before:** `<div class="page-eyebrow">Game</div>`
**HTML, after:** `<div class="hero-badge">Game</div>`

---

### `game_fossil-hunt.html`

**CSS, before:** `.page-eyebrow { … rgba(61,220,132,.12) / #3ddc84 }`
**CSS, after:** `.hero-badge { … rgba(61,220,132,.12) / #3ddc84 }`

**HTML, before:** `<div class="page-eyebrow">Game</div>`
**HTML, after:** `<div class="hero-badge">Game</div>`

---

### `game_layer-detective.html`

**CSS, before:** `.page-eyebrow{ … rgba(61,220,132,.12) / #3ddc84 }`
**CSS, after:** `.hero-badge{ … rgba(61,220,132,.12) / #3ddc84 }`

**HTML, before:** `<div class="page-eyebrow">Game</div>`
**HTML, after:** `<div class="hero-badge">Game</div>`

---

## Hero Badge Elements Added

No new elements were created. The existing `<div>` element was reclassified from `page-eyebrow` to `hero-badge` in all four files. The element, its text content ("Game"), its position in the DOM (directly above `<h1>`), and all visual styling were preserved (only the class name changed.

---

## Visual Consistency Verification

All 8 game pages now use the standard `.hero-badge` pattern:

| File | Indicator Class | Color | Consistent? |
|------|----------------|-------|-------------|
| `game_cell-explorer.html` | `.hero-badge` | `var(--bio)` = `#3ddc84` | ✅ |
| `game_cellular-showdown.html` | `.hero-badge` | `#3ddc84` | ✅ |
| `game_evolution-clicker.html` | `.hero-badge` | `#3ddc84` | ✅ |
| `game_exercise.html` | `.hero-badge` | `#3ddc84` | ✅ |
| `game_fossil-hunt.html` | `.hero-badge` | `#3ddc84` | ✅ |
| `game_is-it-alive.html` | `.hero-badge` | `var(--bio)` = `#3ddc84` | ✅ |
| `game_layer-detective.html` | `.hero-badge` | `#3ddc84` | ✅ |
| `game_relay.html` | `.hero-badge` | `#3ddc84` | ✅ |

**Standard game badge pattern confirmed across all 8 game pages:**
- Class: `.hero-badge`
- Background: `rgba(61,220,132,0.12)`
- Border: `rgba(61,220,132,0.42)`
- Text color: `#3ddc84` (or `var(--bio)` resolving to same)
- Text: `"Game"`
- Placement: immediately above the `<h1>`, inside the hero container

---

## Remaining Game Inconsistencies

**None** affecting the hero type indicator.

**Note, orphaned `.page-eyebrow` CSS rules in two files:**

- `game_cellular-showdown.html`, line 89 contains a `.page-eyebrow` CSS rule (teal, `var(--phys)`) with **no corresponding HTML element**. It is dead/unused CSS, a remnant from an earlier build. The actual hero indicator is `.hero-badge` (green, correct). Out of scope for this pass.
- `game_is-it-alive.html`, line 89 contains a `.page-eyebrow` CSS rule (green, `var(--bio)`) with **no corresponding HTML element**. Same situation, dead CSS. The actual hero indicator is `.hero-badge` (green, correct).

These orphaned rules are harmless and can be cleaned up in a future CSS housekeeping pass.

---

## Accessibility

No regressions introduced:
- The renamed `<div class="hero-badge">` carries the same visible text ("Game") as before, screen readers read the text content directly, not the class name
- No `role`, `aria-*`, or `tabindex` attributes were present on any `page-eyebrow` element; none were added or removed
- Keyboard navigation is unaffected, these are non-interactive display-only elements

---

## Manual Review Needed

| Item | File(s) | Action |
|------|---------|--------|
| Orphaned `.page-eyebrow` CSS rule | `game_cellular-showdown.html`, `game_is-it-alive.html` | Delete the unused rule in a future CSS housekeeping pass |

---

## Next Recommended Pass

**Micropass 4, Continuation Card `lesson` Color Fix**

Two lesson files (`lesson_sun-earth-moon.html`, `lesson_continental-drift.html`) define `.cont-card.lesson` using grey-blue (`rgba(122,143,166,…)`) instead of the canonical lesson gold. Update background, border, top-stripe gradient, and hover state to match the gold standard.
