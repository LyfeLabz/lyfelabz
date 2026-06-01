# Micropass 2: Hero Title Emoji Removal Report

**Date:** 2026-06-01
**Scope:** Remove trailing emojis from primary hero `<h1>` titles only, no badges, layouts, cont-cards, or metadata changed
**Files changed:** 13

---

## Files Changed

| # | File |
|---|------|
| 1 | `lesson_biological-evolution.html` |
| 2 | `lesson_layers-of-time.html` |
| 3 | `extension_biological-evolution.html` |
| 4 | `extension_body-systems.html` |
| 5 | `extension_neuron-explorer.html` |
| 6 | `extension_organelles.html` |
| 7 | `extension_virus.html` |
| 8 | `investigation_gray-zone.html` |
| 9 | `game_cell-explorer.html` |
| 10 | `game_cellular-showdown.html` |
| 11 | `game_exercise.html` |
| 12 | `game_is-it-alive.html` |
| 13 | `game_relay.html` |

---

## Hero Titles Updated

Each title had its trailing emoji + `&#xFE0E;` (variation selector-15, text-mode suppressor) removed.

| File | Before | After |
|------|--------|-------|
| `lesson_biological-evolution.html` | `Biological Evolution 🧬&#xFE0E;` | `Biological Evolution` |
| `lesson_layers-of-time.html` | `Layers of Time 🪨&#xFE0E;` | `Layers of Time` |
| `extension_biological-evolution.html` | `Evidence of Evolution 🔭&#xFE0E;` | `Evidence of Evolution` |
| `extension_body-systems.html` | `Solving Medical Mysteries 🩺&#xFE0E;` | `Solving Medical Mysteries` |
| `extension_neuron-explorer.html` | `Neuron Explorer 🧠&#xFE0E;` | `Neuron Explorer` |
| `extension_organelles.html` | `The Protein Pathway 📦&#xFE0E;` | `The Protein Pathway` |
| `extension_virus.html` | `Are Viruses Alive? 🦠&#xFE0E;` | `Are Viruses Alive?` |
| `investigation_gray-zone.html` | `The Gray Zone ⚠&#xFE0E;` | `The Gray Zone` |
| `game_cell-explorer.html` | `Cell Explorer 🔬&#xFE0E;` | `Cell Explorer` |
| `game_cellular-showdown.html` | `Cellular Showdown ⚔&#xFE0E;` | `Cellular Showdown` |
| `game_exercise.html` | `Exercise Simulator 🏃&#xFE0E;` | `Exercise Simulator` |
| `game_is-it-alive.html` | `Is It Alive? 🌿&#xFE0E;` | `Is It Alive?` |
| `game_relay.html` | `System Relay Race 🧬&#xFE0E;` | `System Relay Race` |

---

## Metadata Updated

**None.** All 13 `<title>` tags were already emoji-free. A full scan of `og:title` and `twitter:title` meta tags across all 13 files confirmed no emoji content in metadata.

---

## Decorative Emojis Preserved

The following emoji instances were **not touched**; they appear in decorative, structural, or UI roles elsewhere on their pages:

| Emoji | Pages | Preserved Location |
|-------|-------|--------------------|
| 🧬 | `lesson_biological-evolution.html`, `game_relay.html` | Floating hero decoration, body system relay runner icons |
| 🪨 | `lesson_layers-of-time.html` | Section icons, layer illustrations |
| 🔭 | `extension_biological-evolution.html` | Section header icons, evidence panels |
| 🩺 | `extension_body-systems.html` | Case study badges, instructional icons |
| 🧠 | `extension_neuron-explorer.html` | Phase icons, learning science badge |
| 📦 | `extension_organelles.html` | Step/phase icons, pathway stage markers |
| 🦠 | `extension_virus.html` | Content section icons, virus anatomy panels |
| ⚠ | `investigation_gray-zone.html` | Notebook badges, cont-card labels, index cards |
| 🔬 | `game_cell-explorer.html` | Nav badge icon, game UI elements |
| ⚔ | `game_cellular-showdown.html` | Game UI combat indicators |
| 🏃 | `game_exercise.html` | Section headers, activity labels |
| 🌿 | `game_is-it-alive.html` | Life/non-life classification UI |
| 🧬 | `game_relay.html` | Relay runner icons, body system indicators |

---

## Remaining Hero Title Emojis

**None.** A site-wide scan confirms zero `&#xFE0E;` entities remain inside any `<h1>` tag across the entire repo.

Scan command result:
```
grep -rn '&#xFE0E;' *.html | grep '<h1'
(empty, no matches)
```

---

## Browser Verification

Live DOM queries via preview server confirmed clean h1 content:

| Page | Rendered `<h1>` |
|------|----------------|
| `lesson_biological-evolution.html` | `Biological Evolution` ✅ |
| `extension_body-systems.html` | `Solving Medical Mysteries` ✅ |
| `investigation_gray-zone.html` | `The Gray Zone` ✅ |
| `game_relay.html` | `System Relay Race` ✅ |
| `game_cellular-showdown.html` | `Cellular Showdown` ✅ |

---

## Manual Review Needed

None for this pass. All 13 targeted titles are clean. No edge cases remain.

One note for future reference: the `&#xFE0E;` variation selector was appended to every emoji in these h1 tags to force text-mode (non-pictographic) rendering in browsers that support it. With the emoji removed, the entity is gone too, no orphaned selectors remain.

---

## Next Recommended Pass

**Micropass 3, Continuation Card `lesson` Color Fix**

Two lesson files (`lesson_sun-earth-moon.html`, `lesson_continental-drift.html`) define `.cont-card.lesson` using grey-blue (`rgba(122,143,166,…)`) instead of gold. Update to match the canonical lesson standard (`rgba(245,200,66,…)` background, gold gradient top stripe).
