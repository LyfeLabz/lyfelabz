# LyfeLabz Content-Type Consistency Audit

**Audit date:** 2026-06-01
**Auditor:** Claude Code
**Scope:** All 33 content pages + index.html + ls-badges.css
**Mode:** Read-only — no files were modified

---

## Executive Summary

- **Pages audited:** 33 content pages (11 lessons, 6 extensions, 3 investigations, 5 simulations, 8 games) + index.html
- **Most consistent page type:** Simulations — cont-card colors correct in all lesson files; 3 of 5 sim hero badges use orange correctly
- **Least consistent page type:** Extensions — 4 of 6 extension pages have wrong hero badge color; Extensions are misidentified as teal, green, brown, and orange
- **Biggest color mismatch:** `simulation_gravity-wells.html` hero badge uses purple (should be orange); `game_relay.html` hero badge uses gold/lesson color (should be green); `extension_body-systems.html` hero badge uses teal (should be purple); investigation pages show blue background but orange text color
- **Hero title emojis found:** 13 hero `<h1>` titles contain trailing emojis
- **Recommended next action:** **B — Staged micropasses**, beginning with hero badge normalization

---

## Desired Content-Type Palette

| Type | Color Name | Primary Hex | Canonical Variable | Notes |
|------|-----------|-------------|-------------------|-------|
| Lesson | Gold / Yellow-orange | `#f5c842` | `var(--gold)` | Defined in index.html as `--gold` |
| Simulation | Orange | `#f5a028` | hardcoded (no global var) | Used as `rgba(245,130,50,...)` or `rgba(245,160,40,...)` |
| Investigation | Bright Blue | `#3B82F6` | hardcoded | Used as `rgba(59,130,246,...)` |
| Game | Green | `#3ddc84` | `var(--bio)` in index.html | Used as `rgba(61,220,132,...)` |
| Extension | Purple | `#b47fff` | `var(--astro)` in index.html | Used as `rgba(180,127,255,...)` or `rgba(155,89,182,...)` |

**Note:** There is no global content-type token file. The index.html CSS is the closest canonical source. Each content page defines its own `--accent` variable independently. The two purple shades (`#b47fff` / `#9b59b6`) are used interchangeably across the site without a single canonical value.

---

## Page-Type Consistency Table

### Lessons

| File | Inferred Type | Visible Type | Index Type | Hero Badge Color | Consistent? | Notes |
|------|--------------|-------------|------------|-----------------|-------------|-------|
| `lesson_what-is-life.html` | Lesson | Lesson | `.ulink.live` | `var(--green)` = `#3ddc84` | **No** | Badge uses green (game color) |
| `lesson_organelles.html` | Lesson | Lesson | `.ulink.live` | `var(--blue)` | **No** | Badge uses blue; page defines 5 different `--accent` overrides |
| `lesson_body-systems.html` | Lesson | Lesson | `.ulink.live` | `var(--accent)` = `#3bc8e8` (teal) | **No** | Badge uses teal |
| `lesson_biological-evolution.html` | Lesson | Lesson | `.ulink.live` | `var(--accent)` = `#c48a4e` (copper) | **No** | Badge uses earthy copper/brown |
| `lesson_continental-drift.html` | Lesson | Lesson | `.ulink.live` | `var(--accent2)` = `#9fb8cc` (grey) | **No** | Badge uses grey-blue |
| `lesson_eclipses.html` | Lesson | Lesson | `.ulink.live` | `var(--accent2)` = `#a0b4e4` (blue) | **No** | Badge uses blue |
| `lesson_layers-of-time.html` | Lesson | Lesson | `.ulink.live` | `var(--accent2)` = `#9fb8cc` (grey) | **No** | Badge uses grey-blue |
| `lesson_phases-of-the-moon.html` | Lesson | Lesson | `.ulink.live` | `var(--accent)` = `#7a8fa6` (grey) | **No** | Badge uses grey-blue |
| `lesson_sun-earth-moon.html` | Lesson | Lesson | `.ulink.live` | `var(--accent)` = `#7a8fa6` (grey) | **No** | Badge uses grey-blue |
| `lesson_ragebaiting.html` | Lesson | Lesson | `.ulink.live` | `var(--purple-light)` | **No** | Badge uses purple (extension color) |
| `lesson_nature-of-waves.html` | Lesson | Lesson | `.ulink.live` | `var(--gold)` = `#f5c842` | **Yes** | Only lesson with correct gold badge |

**Summary: 1 of 11 lessons uses the correct gold hero badge.**

---

### Extensions

| File | Inferred Type | Visible Type | Index Type | Hero Badge Color | Consistent? | Notes |
|------|--------------|-------------|------------|-----------------|-------------|-------|
| `extension_biological-evolution.html` | Extension | Extension | `.ulink.ext` | `var(--accent)` = `#c48a4e` (copper) | **No** | Uses earth/lesson brown, not purple |
| `extension_body-systems.html` | Extension | Extension | `.ulink.ext` | `var(--accent)` = `#3bc8e8` (teal) | **No** | Uses teal (not a content-type color) |
| `extension_moon-tonight.html` | Extension | Extension | `.ulink.ext` | `var(--accent2)` ≈ purple (`#9b59b6`) | **Partial** | Uses a purple variant; correct family but off-shade |
| `extension_neuron-explorer.html` | Extension | Extension | `.ulink.ext` | `#3ddc84` (green) | **No** | Uses green (game color) |
| `extension_organelles.html` | Extension | Extension | `.ulink.ext` | `var(--orange)` = `#e67e22` | **No** | Uses orange (simulation color) |
| `extension_virus.html` | Extension | Extension | `.ulink.ext` | `var(--green)` = `#2ecc71` | **No** | Uses green (game color) |

**Summary: 0–1 of 6 extensions uses the correct purple hero badge (moon-tonight is close but wrong shade).**

---

### Investigations

| File | Inferred Type | Visible Type | Index Type | Hero Badge Color | Consistent? | Notes |
|------|--------------|-------------|------------|-----------------|-------------|-------|
| `investigation_cell-energy.html` | Investigation | Investigation | `.ulink.inv` | Background: blue `rgba(59,130,246,...)`, text: `var(--orange)` | **No** | Blue background but orange text — split personality |
| `investigation_amplitude-challenge.html` | Investigation | Investigation | `.ulink.inv` | Background: blue `rgba(59,130,246,...)`, text: `var(--orange)` | **No** | Same issue: blue shell, orange text |
| `investigation_gray-zone.html` | Investigation | Investigation | `.ulink.inv` | Background: blue `rgba(59,130,246,...)`, text: `#fff` | **Partial** | Blue background correct, but white text instead of blue |

**Summary: 0 of 3 investigations have fully correct blue hero badge (all have blue background but wrong text color).**

---

### Simulations

| File | Inferred Type | Visible Type | Index Type | Hero Badge Color | Consistent? | Notes |
|------|--------------|-------------|------------|-----------------|-------------|-------|
| `simulation_beetle-island.html` | Simulation | Simulation | `.ulink.sim` | `var(--orange)` + orange border | **Yes** | Correct orange |
| `simulation_chernobyl-frogs.html` | Simulation | Simulation | `.ulink.sim` | First def: orange; overridden to teal (`var(--teal)`) | **No** | Two `.hero-badge` rules — teal wins |
| `simulation_eclipse-alignment.html` | Simulation | Simulation | `.ulink.sim` | `var(--orange)` | **Yes** | Correct orange (despite accent being blue) |
| `simulation_floatlandia-fracture.html` | Simulation | Simulation | `.ulink.sim` | `var(--teal)` | **No** | Uses teal (not a content-type color) |
| `simulation_gravity-wells.html` | Simulation | Simulation | `.ulink.sim` | `var(--purple)` | **No** | Uses purple (extension color) |

**Summary: 2 of 5 simulations use the correct orange hero badge.**

---

### Games

| File | Inferred Type | Visible Type | Index Type | Hero Badge | Consistent? | Notes |
|------|--------------|-------------|------------|-----------|-------------|-------|
| `game_is-it-alive.html` | Game | Game | `.ulink.game` | `#3ddc84` (green) | **Yes** | Correct |
| `game_cellular-showdown.html` | Game | Game | `.ulink.game` | `#3ddc84` (green) | **Yes** | Correct |
| `game_exercise.html` | Game | Game | `.ulink.game` | `var(--accent)` = `#69d97a` (light green) | **Partial** | Green but lighter/different shade than standard |
| `game_relay.html` | Game | Game | `.ulink.game` | `var(--accent)` = `#f5c842` (gold) | **No** | Uses gold (lesson color) |
| `game_cell-explorer.html` | Game | Game | `.ulink.game` | **Missing** — no `.hero-badge` div | **No** | Uses `.nav-badge` (green) + `.page-eyebrow` instead |
| `game_evolution-clicker.html` | Game | Game | `.ulink.game` | **Missing** — no `.hero-badge` div | **No** | Uses `.page-eyebrow` "Game" — non-standard structure |
| `game_fossil-hunt.html` | Game | Game | `.ulink.game` | **Missing** — no `.hero-badge` div | **No** | Uses `.page-eyebrow` "Game" — non-standard structure |
| `game_layer-detective.html` | Game | Game | `.ulink.game` | **Missing** — no `.hero-badge` div | **No** | Uses `.page-eyebrow` "Game" — non-standard structure |

**Summary: 2–3 of 8 games have the correct green hero badge. 4 games lack the standard `.hero-badge` component entirely and use a different page structure.**

---

## Hero Title Emoji Table

| File | Current Hero Title | Suggested Clean Title | Keep Emoji Elsewhere? | Notes |
|------|-------------------|----------------------|----------------------|-------|
| `lesson_biological-evolution.html` | Biological Evolution 🧬 | Biological Evolution | Yes | 🧬 appears in cont-card and game relay title — keep as decorative icon |
| `lesson_layers-of-time.html` | Layers of Time 🪨 | Layers of Time | Yes | 🪨 may appear in section icons |
| `extension_biological-evolution.html` | Evidence of Evolution 🔭 | Evidence of Evolution | Yes | 🔭 may appear in section headers |
| `extension_body-systems.html` | Solving Medical Mysteries 🩺 | Solving Medical Mysteries | Yes | 🩺 used as thematic icon throughout page |
| `extension_neuron-explorer.html` | Neuron Explorer 🧠 | Neuron Explorer | Yes | 🧠 is used decoratively in phase icons |
| `extension_organelles.html` | The Protein Pathway 📦 | The Protein Pathway | Yes | 📦 used in step/phase icons |
| `extension_virus.html` | Are Viruses Alive? 🦠 | Are Viruses Alive? | Yes | 🦠 likely used in content sections |
| `investigation_gray-zone.html` | The Gray Zone ⚠ | The Gray Zone | Yes | ⚠️ is the thematic symbol for the page — appears in cont-card labels and index |
| `game_cell-explorer.html` | Cell Explorer 🔬 | Cell Explorer | Yes | 🔬 is a strong visual identity icon for this game |
| `game_cellular-showdown.html` | Cellular Showdown ⚔ | Cellular Showdown | Yes | ⚔ appears as decorative in game UI |
| `game_exercise.html` | Exercise Simulator 🏃 | Exercise Simulator | Yes | 🏃 thematic — likely in section headers |
| `game_is-it-alive.html` | Is It Alive? 🌿 | Is It Alive? | Yes | 🌿 appears as decorative life-vs-nonlife icon |
| `game_relay.html` | System Relay Race 🧬 | System Relay Race | Yes | 🧬 used in relay runner icons and body system UI |

**All 13 emojis appear to serve additional decorative/branding roles elsewhere on their respective pages. Removal should be scoped to the `<h1>` only.**

**Note on `lesson_ragebaiting.html`:** The `<h1>` is "Don't Take the Bait" — no emoji. The title visible on the index is "Rage Baiting & Media Manipulation." This title mismatch between index and page h1 should be reviewed separately.

---

## Index and Card Consistency

### index.html `.ulink` Classes

The index.html uses the following link-pill classes to represent content types:

| Class | Color | Correct? | Notes |
|-------|-------|---------|-------|
| `.ulink.live` | Gold (`#f5c842`) | **Yes** | "Lesson" pill — gold matches lesson standard |
| `.ulink.sim` | Orange (`#f5a028`) | **Yes** | "Simulation" pill — orange correct |
| `.ulink.inv` | Blue (`#3B82F6`) | **Yes** | "Investigation" pill — blue correct |
| `.ulink.game` | Green (`#3ddc84`) | **Yes** | "Game" pill — green correct |
| `.ulink.ext` | Purple (`#b47fff`) | **Yes** | "Extension" pill — purple correct |
| `.ulink.activity` | Gold (same as lesson) | **Ambiguous** | "activity" is a legacy/alias label; conflated with lesson |
| `.ulink.dis` | Purple (same as ext) | **Confusing** | Disease pages use purple — may be unintentional conflict with extension color |
| `.ulink.map` | Teal (`#3bc8e8`) | **Separate** | Body system maps use teal — not a primary content type |

**Issue:** The index.html uses `.ulink.live` for lessons (not `.ulink.lesson`). No `.ulink.lesson` class exists. This diverges from the cont-card naming convention where `.cont-card.lesson` is used.

### Pill Legend (index.html hero section)

The pill legend at the top of the subjects section correctly shows: Lesson (gold), Simulation (orange), Investigation (blue), Game (green), Extension (purple). This is the canonical palette reference.

### Continuation Cards in Lesson Files

| Type | Color Used | Consistent Across Files? | Notes |
|------|-----------|--------------------------|-------|
| `.cont-card.ext` | Purple (`rgba(155,89,182,...)`) | **Yes** — 10/10 lesson files consistent | Correct |
| `.cont-card.game` | Green (`rgba(61,220,132,...)`) | **Yes** — 10/10 lesson files consistent | Correct |
| `.cont-card.sim` | Orange (`rgba(245,160,40,...)`) | **Yes** — 8/8 files that include it | Correct |
| `.cont-card.inv` | Blue (`rgba(59,130,246,...)`) | **Yes** — 3/3 files that include it | Correct |
| `.cont-card.lesson` | Grey-blue (`rgba(122,143,166,...)`) | **Partial** — only in 2 files, uses grey not gold | Should use gold, not grey |
| `.cont-card.map` | Brown (`rgba(196,138,78,...)`) | **Consistent where used** — 3 files | Map pages use a separate brown; not a content-type color |
| `.cont-card.activity` | Gold (`rgba(245,200,66,...)`) | **1 file only** — bio-evolution | Legacy label; aligns with lesson gold |

**Key finding:** Continuation cards are the **most internally consistent** part of the system. The ext/game/sim/inv card colors are correct and well-applied. The `lesson` cont-card color is the only mismatch — it uses grey, not gold.

### extension_moon-tonight.html — special case

This extension page also has continuation cards styled with purple gradient. It is consistent with the ext standard.

---

## CSS / Token Findings

### Existing Content-Type Color Classes

**Defined in `index.html` (inline `<style>`):**
- `.ulink.live` — lesson/gold
- `.ulink.sim` — simulation/orange
- `.ulink.inv` — investigation/blue
- `.ulink.game` — game/green
- `.ulink.ext` — extension/purple
- No `--lesson-color`, `--sim-color`, etc. CSS custom properties exist globally

**Defined per-page in `<style>` blocks:**
- Each content page defines its own `--accent` variable with no shared source
- The `ls-badges.css` file covers only the learning science educator badge system — it has no content-type colors

### Repeated Hardcoded Color Values

The following color values appear hardcoded across many individual page `<style>` blocks without a shared variable:

| Color | Hex/Value | Used For | Appears in |
|-------|-----------|---------|-----------|
| Lesson gold | `#f5c842` | Lesson badge, gold accents | nature-of-waves, index, relay (wrong), ls-badges |
| Sim orange | `#f5a028` / `rgba(245,160,40,...)` | Sim hero badge, cont-card | beetle-island, chernobyl (first), eclipse, layers, eclipses, continental |
| Inv blue | `#3B82F6` / `rgba(59,130,246,...)` | Investigation hero/cont-card | cell-energy, amplitude, gray-zone, what-is-life, nature-of-waves |
| Game green | `#3ddc84` / `rgba(61,220,132,...)` | Game badge, cont-card | cellular-showdown, is-it-alive, all lesson cont-cards |
| Ext purple | `#b47fff` / `rgba(180,127,255,...)` | Extension badge, cont-card | moon-tonight, gravity-wells (wrong), all lesson cont-cards |
| Ext purple alt | `rgba(155,89,182,...)` | Extension cont-card | 10 lesson files — slightly different shade than hero usage |

**Two purple shades in use:**
- `#b47fff` / `rgba(180,127,255,...)` — used in index.html, gravity-wells, cont-card link colors
- `#9b59b6` / `rgba(155,89,182,...)` — used in moon-tonight hero badge, most cont-card backgrounds

These are the same conceptual color (extension purple) but different hex values. The index.html `--astro: #b47fff` should be considered canonical.

### Pages Using Older Color Systems

Several pages use a **legacy earth/space color system** (`--accent: #7a8fa6`, grey-blue) that predates the current content-type palette:

- `lesson_continental-drift.html`
- `lesson_eclipses.html`
- `lesson_layers-of-time.html`
- `lesson_phases-of-the-moon.html`
- `lesson_sun-earth-moon.html`
- `extension_biological-evolution.html` (uses copper `#c48a4e`, the geo/earth accent)

These pages were likely built with a topic-based color system (earth/space = grey-blue, life science = green, etc.) rather than a content-type color system. The newer approach correctly decouples content type from topic area.

### Pages That Should Be Standardized First

Priority order (most wrong color, most visible impact):

1. `extension_body-systems.html` — teal extension badge is the starkest mismatch
2. `extension_neuron-explorer.html` — green (game color) badge on an extension
3. `extension_virus.html` — green badge on extension
4. `simulation_gravity-wells.html` — purple badge on a simulation
5. `game_relay.html` — gold/lesson badge on a game
6. `simulation_chernobyl-frogs.html` — CSS rule conflict (teal overrides correct orange)
7. `simulation_floatlandia-fracture.html` — teal badge on simulation
8. `investigation_cell-energy.html` + `investigation_amplitude-challenge.html` — orange text in blue badge

---

## Recommended Fix Passes

### Pass 1 — Establish Canonical Palette (No page edits yet)

Create a shared `content-type-colors.css` that defines:
```css
:root {
  --ct-lesson:     #f5c842;       /* gold */
  --ct-lesson-dim: rgba(245,200,66,0.12);
  --ct-sim:        #f5a028;       /* orange */
  --ct-sim-dim:    rgba(245,160,40,0.12);
  --ct-inv:        #3B82F6;       /* blue */
  --ct-inv-dim:    rgba(59,130,246,0.12);
  --ct-game:       #3ddc84;       /* green */
  --ct-game-dim:   rgba(61,220,132,0.12);
  --ct-ext:        #b47fff;       /* purple */
  --ct-ext-dim:    rgba(180,127,255,0.12);
}
```
Normalize the two ext purple shades to `#b47fff`. Update index.html `.ulink.*` classes to reference these variables.

---

### Pass 2 — Normalize Hero Badges and Visible Type Labels

For each page, update the `.hero-badge` CSS to use the correct content-type color.

**Lesson pages needing fix (10 files):**
All lessons except `lesson_nature-of-waves.html`.
Target: `background: rgba(245,200,66,0.12); border: ... rgba(245,200,66,...); color: #f5c842;`

**Extension pages needing fix (5 files):**
All except possibly `extension_moon-tonight.html` (already purple-family).
Target: `background: rgba(180,127,255,0.12); border: ...; color: #b47fff;`

**Investigation pages needing fix (3 files):**
All three — background is correct blue, but text color should be `#3B82F6` not `var(--orange)` or `#fff`.

**Simulation pages needing fix (3 files):**
`chernobyl-frogs`, `floatlandia-fracture`, `gravity-wells`.
Target: `background: rgba(245,160,40,0.10); border: ...; color: #f5a028;`

**Game pages needing fix (1 badge fix + 4 structural):**
`game_relay.html` badge fix to green.
`game_cell-explorer`, `game_evolution-clicker`, `game_fossil-hunt`, `game_layer-detective` — these use `.page-eyebrow` instead of `.hero-badge`. Decision needed: add a standard `.hero-badge` div or reclassify `.page-eyebrow` styling.

---

### Pass 3 — Remove Trailing Hero-Title Emojis

13 `<h1>` tags have trailing emojis (see Hero Title Emoji Table above). Each needs a targeted edit removing only the trailing emoji from the `<h1>`. Confirm the emoji still appears in other contexts before removal.

---

### Pass 4 — Normalize Continuation-Card Classes

**`.cont-card.lesson`** appears in 2 files (`sun-earth-moon`, `continental-drift`) using grey (`rgba(122,143,166,...)`) instead of gold. Update to match lesson standard: `rgba(245,200,66,0.09)` with gold gradient.

All other `cont-card` variants (ext, game, sim, inv) are already well-standardized — no fix needed there.

---

### Pass 5 — Patch Legacy Color-System Pages

The earth/space and topic-themed lesson pages (`continental-drift`, `eclipses`, `layers-of-time`, `phases-of-the-moon`, `sun-earth-moon`, `extension_biological-evolution`) should have their per-page `--accent` variables audited. The fix is to remove the per-page `--accent` and instead use the canonical `--ct-lesson` token in a shared template, not a per-topic color.

This is a larger pass and should be done after Pass 2 validates the hero-badge normalization approach.

---

### Pass 6 — Final Verification Audit

Re-run this audit after Passes 1–5 with a focus on:
- Do all hero badges show the correct content-type color?
- Do all index `.ulink` pills match cont-card colors?
- Are there any remaining emoji in `<h1>` tags?
- Is there any remaining use of grey-blue (`#7a8fa6`) in hero badge positions?

---

## Final Recommendation

**B — Needs staged micropasses**

The index.html link-pill system is already correct and serves as the canonical reference. The cont-card system in lessons is largely correct for sim/game/ext/inv. The primary gap is at the **individual page hero badge level**, where most pages still use topic-based or legacy accent colors rather than the content-type palette.

The recommended sequence:
1. Create shared token file (unblocks everything else)
2. Fix hero badges page-by-page, starting with the most visually jarring mismatches (Pass 2 above)
3. Remove `<h1>` emojis (Pass 3 — mechanical and low-risk)
4. Normalize the two `cont-card.lesson` instances (Pass 4 — small)
5. Tackle legacy color-system pages last (Pass 5 — highest complexity)

A direct site-wide consistency pass is not recommended due to the diversity of per-page CSS architectures. Staged micropasses reduce regression risk and allow incremental verification.
