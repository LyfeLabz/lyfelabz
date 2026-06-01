# Micropass 4 — Orphaned `.page-eyebrow` CSS Cleanup Report

**Date:** 2026-06-01
**Scope:** Remove dead `.page-eyebrow` CSS rules that have no corresponding HTML elements
**Files changed:** 3
**Lines removed:** 5 (1 three-line rule + 2 single-line rules)

---

## Files Searched

Full repo scan performed across all `.html` files.

| File | `.page-eyebrow` CSS | HTML `class="page-eyebrow"` | Status |
|------|--------------------|-----------------------------|--------|
| `extension_neuron-explorer.html` | 1 rule (3 lines) | 0 elements | Orphaned — **removed** |
| `game_cellular-showdown.html` | 1 rule (1 line) | 0 elements | Orphaned — **removed** |
| `game_is-it-alive.html` | 1 rule (1 line) | 0 elements | Orphaned — **removed** |

Note: `extension_neuron-explorer.html` was not flagged in the Micropass 3 report (which only scanned game files), but was discovered in this pass's repo-wide scan. It was orphaned for the same reason — the element had already been superseded by `.hero-badge`.

---

## Files Changed

| File | What was removed |
|------|-----------------|
| `extension_neuron-explorer.html` | 3-line `.page-eyebrow` rule: `display:inline-flex … background:rgba(180,127,255,0.12) … color:var(--neuro)` |
| `game_cellular-showdown.html` | 1-line `.page-eyebrow` rule: `display:inline-flex … background:rgba(41,212,245,0.1) … color:var(--phys)` |
| `game_is-it-alive.html` | 1-line `.page-eyebrow` rule: `display:inline-flex … background:rgba(61,220,132,0.1) … color:var(--bio)` |

---

## Orphaned CSS Removed

### `extension_neuron-explorer.html` (lines 88–90, removed)

```css
/* REMOVED */
.page-eyebrow{display:inline-flex; align-items:center; gap:0.5rem; background:rgba(180,127,255,0.12);
  border:1px solid rgba(180,127,255,0.32); color:var(--neuro); padding:0.4rem 1.2rem; border-radius:99px;
  font-size:0.75rem; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; margin-bottom:1.2rem; animation:fadeUp 0.5s ease both;}
```

### `game_cellular-showdown.html` (line 89, removed)

```css
/* REMOVED */
.page-eyebrow{display:inline-flex;align-items:center;gap:0.5rem;background:rgba(41,212,245,0.1);border:1px solid rgba(41,212,245,0.3);color:var(--phys);padding:0.4rem 1.2rem;border-radius:99px;font-size:0.75rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:1.2rem;animation:fadeUp 0.5s ease both;}
```

### `game_is-it-alive.html` (line 89, removed)

```css
/* REMOVED */
.page-eyebrow{display:inline-flex;align-items:center;gap:0.5rem;background:rgba(61,220,132,0.1);border:1px solid rgba(61,220,132,0.3);color:var(--bio);padding:0.4rem 1.2rem;border-radius:99px;font-size:0.75rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:1.2rem;animation:fadeUp 0.5s ease both;}
```

---

## Remaining `.page-eyebrow` References

**Zero.** Full repo scan after edits confirms no `.page-eyebrow` references remain anywhere in the codebase.

```
grep -rn 'page-eyebrow' --include="*.html" .
(no output)
```

---

## Confirmation

### All game pages still have `.hero-badge`

| File | Indicator Class | Color |
|------|----------------|-------|
| `game_cell-explorer.html` | `.hero-badge` | `var(--bio)` = `#3ddc84` ✅ |
| `game_cellular-showdown.html` | `.hero-badge` | `#3ddc84` ✅ |
| `game_evolution-clicker.html` | `.hero-badge` | `#3ddc84` ✅ |
| `game_exercise.html` | `.hero-badge` | `#3ddc84` ✅ |
| `game_fossil-hunt.html` | `.hero-badge` | `#3ddc84` ✅ |
| `game_is-it-alive.html` | `.hero-badge` | `#3ddc84` ✅ |
| `game_layer-detective.html` | `.hero-badge` | `#3ddc84` ✅ |
| `game_relay.html` | `.hero-badge` | `#3ddc84` ✅ |

### `.hero-badge` CSS rule intact in all three edited files

| File | `.hero-badge` rules present |
|------|-----------------------------|
| `extension_neuron-explorer.html` | 1 ✅ |
| `game_cellular-showdown.html` | 1 ✅ |
| `game_is-it-alive.html` | 1 ✅ |

### No visible hero indicator removed

Only dead CSS was deleted. No HTML elements were modified. No rendered output changed in any browser. The `.hero-badge` elements on all three pages remain styled and visible exactly as before.

### No gameplay, layout, or script changes

Edits were limited to CSS rule deletion inside `<style>` blocks. No HTML structure, JavaScript, game logic, hero layout, or any other content was altered.

---

## Next Recommended Pass

**Micropass 5 — Continuation Card `lesson` Color Fix**

Two lesson files (`lesson_sun-earth-moon.html`, `lesson_continental-drift.html`) define `.cont-card.lesson` using grey-blue (`rgba(122,143,166,…)`) instead of the canonical lesson gold. Update background, border, top-stripe gradient, and hover state to match.
