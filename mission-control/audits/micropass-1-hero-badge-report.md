# Micropass 1 — Hero Badge Standardization Report

**Date:** 2026-06-01
**Scope:** Hero badge color standardization only — no layouts, titles, emojis, cont-cards, or index.html changed
**Files changed:** 27

---

## Canonical Palette Applied

| Type | Color | Hex | Background | Border |
|------|-------|-----|------------|--------|
| Lesson | Gold | `#f5c842` | `rgba(245,200,66,0.12)` | `rgba(245,200,66,0.45)` |
| Simulation | Orange | `#f5a028` | `rgba(245,160,40,0.10)` | `rgba(245,160,40,0.42)` |
| Investigation | Blue | `#3B82F6` | `rgba(59,130,246,0.12)` | `rgba(59,130,246,0.45)` |
| Game | Green | `#3ddc84` | `rgba(61,220,132,0.12)` | `rgba(61,220,132,0.42)` |
| Extension | Purple | `#b47fff` | `rgba(180,127,255,0.12)` | `rgba(180,127,255,0.45)` |

---

## Files Changed

### Lessons Fixed (10 of 11)

| File | Was | Now |
|------|-----|-----|
| `lesson_what-is-life.html` | green `rgba(46,204,113,…)` | gold `rgba(245,200,66,…) / #f5c842` |
| `lesson_organelles.html` | blue `rgba(52,152,219,…)` | gold `rgba(245,200,66,…) / #f5c842` |
| `lesson_body-systems.html` | teal `rgba(59,200,232,…)` | gold `rgba(245,200,66,…) / #f5c842` |
| `lesson_biological-evolution.html` | copper `var(--accent-dim)` / `rgba(196,138,78,…)` | gold `rgba(245,200,66,…) / #f5c842` |
| `lesson_continental-drift.html` | grey `var(--accent-dim)` / `rgba(122,143,166,…)` | gold `rgba(245,200,66,…) / #f5c842` |
| `lesson_eclipses.html` | blue-grey `var(--accent-dim)` / `rgba(122,143,200,…)` | gold `rgba(245,200,66,…) / #f5c842` |
| `lesson_layers-of-time.html` | grey `var(--accent-dim)` / `rgba(122,143,166,…)` | gold `rgba(245,200,66,…) / #f5c842` |
| `lesson_phases-of-the-moon.html` | grey `var(--accent-dim)` / `rgba(122,143,166,…)` | gold `rgba(245,200,66,…) / #f5c842` |
| `lesson_sun-earth-moon.html` | grey `var(--accent-dim)` / `rgba(122,143,166,…)` | gold `rgba(245,200,66,…) / #f5c842` |
| `lesson_ragebaiting.html` | purple `rgba(168,85,247,…)` | gold `rgba(245,200,66,…) / #f5c842` |

**Not changed:** `lesson_nature-of-waves.html` — was already using `var(--gold)` = `#f5c842`. Correct and unchanged.

---

### Extensions Fixed (6 of 6)

| File | Was | Now |
|------|-----|-----|
| `extension_biological-evolution.html` | copper `var(--accent)` = `#c48a4e` | purple `rgba(180,127,255,…) / #b47fff` |
| `extension_body-systems.html` | teal `var(--accent)` = `#3bc8e8` | purple `rgba(180,127,255,…) / #b47fff` |
| `extension_moon-tonight.html` | off-purple `rgba(155,89,182,…) / var(--accent2)` | canonical purple `rgba(180,127,255,…) / #b47fff` |
| `extension_neuron-explorer.html` | green `rgba(61,220,132,…)` | purple `rgba(180,127,255,…) / #b47fff` |
| `extension_organelles.html` | orange `rgba(230,126,34,…)` | purple `rgba(180,127,255,…) / #b47fff` |
| `extension_virus.html` | green `rgba(46,204,113,…)` | purple `rgba(180,127,255,…) / #b47fff` |

---

### Investigations Fixed (3 of 3)

| File | Issue | Fix Applied |
|------|-------|-------------|
| `investigation_cell-energy.html` | Blue background but `color: var(--orange)` | Text changed to `#3B82F6`; background tightened to `rgba(59,130,246,0.12)` |
| `investigation_amplitude-challenge.html` | Blue background but `color: var(--orange)` | Text changed to `#3B82F6` only (background already correct) |
| `investigation_gray-zone.html` | Blue background but `color: #fff` | Text changed to `#3B82F6`; background tightened to `rgba(59,130,246,0.12)` |

---

### Simulations Fixed (3 of 5)

| File | Issue | Fix Applied |
|------|-------|-------------|
| `simulation_chernobyl-frogs.html` | CSS cascade conflict: base rule orange, lower rule overrode to teal | Override rule corrected from teal to orange `rgba(245,160,40,…) / #f5a028` |
| `simulation_floatlandia-fracture.html` | Badge using teal `rgba(59,200,232,…) / var(--teal)` | Changed to orange `rgba(245,160,40,…) / #f5a028` |
| `simulation_gravity-wells.html` | Badge using purple `rgba(180,127,255,…) / var(--purple)` | Changed to orange `rgba(245,160,40,…) / #f5a028` |

**Not changed:**
- `simulation_beetle-island.html` — already correct orange (`var(--orange)` = `#f5a028`)
- `simulation_eclipse-alignment.html` — already correct orange (`var(--orange)` = `#f5a028`)

---

### Games Fixed (5 of 8)

| File | Structure | Issue | Fix Applied |
|------|-----------|-------|-------------|
| `game_relay.html` | `.hero-badge` | Gold `var(--accent)` = `#f5c842` (lesson color) | Changed to green `rgba(61,220,132,…) / #3ddc84` |
| `game_exercise.html` | `.hero-badge` | Light green `var(--accent)` = `#69d97a` (off-shade) | Changed to canonical green `rgba(61,220,132,…) / #3ddc84` |
| `game_evolution-clicker.html` | `.page-eyebrow` | Off-shade green `rgba(67,240,125,…)` / `var(--green)` = `#43f07d` | Changed to canonical green `rgba(61,220,132,…) / #3ddc84` |
| `game_fossil-hunt.html` | `.page-eyebrow` | Off-shade green `rgba(67,240,125,…)` / `var(--green)` = `#43f07d` | Changed to canonical green `rgba(61,220,132,…) / #3ddc84` |
| `game_layer-detective.html` | `.page-eyebrow` | Off-shade green `rgba(67,240,125,…)` / `var(--green)` = `#43f07d` | Changed to canonical green `rgba(61,220,132,…) / #3ddc84` |

**Not changed:**
- `game_is-it-alive.html` — `.hero-badge` already correct (`var(--bio)` = `#3ddc84`)
- `game_cellular-showdown.html` — `.hero-badge` already correct (`#3ddc84`). Note: this page also has a `.page-eyebrow` element using `var(--phys)` (blue), but that element is a **topic/HUD label inside the game UI**, not the page-type indicator. The type indicator is the `.hero-badge`. Left untouched.
- `game_cell-explorer.html` — `.page-eyebrow` already correct (`var(--bio)` = `#3ddc84`)

---

## Remaining Badge Inconsistencies

None that affect the visible content-type signal. Two minor stylistic notes:

1. **Variable vs. hardcoded values:** Several pages that were already correct (`lesson_nature-of-waves`, `simulation_beetle-island`, `simulation_eclipse-alignment`, `game_is-it-alive`, `game_cell-explorer`) still use local CSS variables (`var(--gold)`, `var(--orange)`, `var(--bio)`) that resolve to the canonical hex values. The rendered color is correct. Future Pass 5 (token consolidation) can standardize these to a shared custom property if desired — out of scope for this pass.

2. **`simulation_chernobyl-frogs.html` double rule:** This file has two `.hero-badge` declarations (base + override from a dark-theme section). Both now specify orange values, so the cascade is consistent. No visual issue. A future structural pass could collapse them into one rule.

---

## Visual Verification

Confirmed rendered CSS outcomes (not just intended variables):

| Type | Expected Color | Rendered Outcome | Verified |
|------|---------------|-----------------|---------|
| **Lesson** | Gold `#f5c842` | All 11 lesson hero badges: `rgba(245,200,66,0.12)` bg / `#f5c842` or `var(--gold)` text | ✅ |
| **Simulation** | Orange `#f5a028` | All 5 simulation hero badges: `rgba(245,160,40,0.10)` bg / `#f5a028` or `var(--orange)` text | ✅ |
| **Investigation** | Blue `#3B82F6` | All 3 investigation hero badges: `rgba(59,130,246,0.12)` bg / `#3B82F6` text | ✅ |
| **Game** | Green `#3ddc84` | All 8 game type indicators: `rgba(61,220,132,…)` bg / `#3ddc84` or `var(--bio)` text | ✅ |
| **Extension** | Purple `#b47fff` | All 6 extension hero badges: `rgba(180,127,255,0.12)` bg / `#b47fff` text | ✅ |

---

## Manual Review Needed

The following pages have structural differences from the standard `.hero-badge` pattern. The type color is now correct, but a future structural pass could normalize the badge element itself:

| File | Current Structure | Standard Structure | Priority |
|------|------------------|--------------------|----------|
| `game_evolution-clicker.html` | `.page-eyebrow` div | `.hero-badge` div | Low |
| `game_fossil-hunt.html` | `.page-eyebrow` div | `.hero-badge` div | Low |
| `game_layer-detective.html` | `.page-eyebrow` div | `.hero-badge` div | Low |
| `game_cell-explorer.html` | `.page-eyebrow` div | `.hero-badge` div | Low |
| `lesson_nature-of-waves.html` | Uses `var(--gold)` variable | Hardcoded `#f5c842` | None — no visual issue |
| `simulation_chernobyl-frogs.html` | Two `.hero-badge` rules | Single rule | Low — no visual conflict |

The four game files using `.page-eyebrow` may benefit from a future structural alignment pass (Micropass 5 or later) that replaces the eyebrow element with the standard `.hero-badge` class. The type color is already correct so this is cosmetic HTML structure normalization only.

---

## What Was NOT Changed

Per scope constraints, the following were untouched in this pass:

- Hero `<h1>` titles and emojis
- Hero spacing, padding, backgrounds, and gradient overlays
- Continuation cards (`cont-card.*`)
- `index.html` pill legend and unit cards
- LS/STEM educator badges
- Buttons, section headers, footer
- Content sections

---

## Next Recommended Pass

**Micropass 2 — Hero Title Emoji Removal**

Remove trailing emojis from 13 hero `<h1>` tags (see emoji table in the audit). Each emoji also appears elsewhere on its page in a decorative role — only the `<h1>` appended instance should be removed.

Files: `lesson_biological-evolution`, `lesson_layers-of-time`, `extension_biological-evolution`, `extension_body-systems`, `extension_neuron-explorer`, `extension_organelles`, `extension_virus`, `investigation_gray-zone`, `game_cell-explorer`, `game_cellular-showdown`, `game_exercise`, `game_is-it-alive`, `game_relay`.
