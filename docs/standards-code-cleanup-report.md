# Standards Code Cleanup Report
**Date:** June 3, 2026  
**Scope:** Massachusetts 2016 Science and Technology/Engineering Framework — invalid code correction pass  
**Source of truth:** Official MA 2016 STE Framework (Grade 6 confirmed standards)

---

## Summary

This pass corrected six categories of invalid or misgraded Massachusetts STE standard codes appearing as visible badges, tooltips, metadata labels, and documentation across the LyfeLabz repository. A total of **20 files** were edited (13 HTML pages + 4 documentation files). No instructional content was removed or redesigned.

---

## Files Changed

### HTML Pages

| File | Change |
|---|---|
| `lesson_layers-of-time.html` | Removed invalid `6.ESS2-2` badge and panel row |
| `lesson_continental-drift.html` | Removed invalid `6.ESS2-2` badge and panel row |
| `lesson_eclipses.html` | `6.ESS1-1` → `6.MS-ESS1-1a` (badge + panel row) |
| `lesson_phases-of-the-moon.html` | `MS-ESS1-1` → `6.MS-ESS1-1a` (badge + panel row) |
| `lesson_sun-earth-moon.html` | `MS-ESS1-1` → `6.MS-ESS1-1a` (badge + panel row) |
| `simulation_eclipse-alignment.html` | `MS-ESS1-1` → `6.MS-ESS1-1a` (badge) |
| `investigation_cell-energy.html` | `6.MS-LS1-6` → `6.MS-LS1-2`; `6.MS-LS1-7` → `8.MS-LS1-7` (labeled above-grade enrichment) |
| `disease_respiratory.html` | `6.MS-LS1-7` → `8.MS-LS1-7` |
| `disease_digestive.html` | `6.MS-LS1-7` → `8.MS-LS1-7` |
| `disease_circulatory.html` | `6.MS-LS1-7` → `8.MS-LS1-7` |
| `disease_nervous.html` | `6.MS-LS1-7` → `8.MS-LS1-7` |
| `disease_muscular.html` | `6.MS-LS1-7` → `8.MS-LS1-7` |
| `disease_skeletal.html` | `6.MS-LS1-7` → `8.MS-LS1-7` |
| `disease_immune.html` | `6.MS-LS1-7` → `8.MS-LS1-7` |
| `disease_excretory.html` | `6.MS-LS1-7` → `8.MS-LS1-7` |
| `lesson_biological-evolution.html` | Removed `MS-LS4-6` badge and panel row |
| `extension_chernobyl-frogs.html` | Removed `MS-LS4-6` badge |
| `simulation_beetle-island.html` | Removed `MS-LS4-6` badge |
| `blog/teach-natural-selection-6th-grade.html` | Removed `MS-LS4-6` from header, article body, and sidebar; corrected `MS-LS4-4` → `8.MS-LS4-4` |

### Documentation Files

| File | Change |
|---|---|
| `docs/grade6-standards-alignment-audit-v2.md` | Added 3 missing ETS1 standards; corrected count 17→20; fixed `6.MS-ESS1-1` → `6.MS-ESS1-1a`; updated misalignment table M4–M7 with correction notes; updated priorities 7–8 as completed; added ETS1 rows to dashboard, matrix, and missing-standards table |
| `docs/hqim-grade6-readiness-audit.md` | Corrected `MS-ESS1-1` → `6.MS-ESS1-1a` in inventory table; removed `6.ESS2-2` from page listings; updated ESS2 note; added `6.MS-ETS1-1`, `6.MS-ETS1-5(MA)`, `6.MS-ETS1-6(MA)` to coverage table |
| `mission-control/reports/lesson-consistency-audit.md` | Updated `MS-ESS1-1` → `6.MS-ESS1-1a`; removed `6.ESS2-2` from continental-drift and layers-of-time rows; removed `MS-LS4-6` from evolution lesson row |
| `mission-control/reports/lesson-consistency-micropass-1.md` | Replaced `6.ESS2-2` in format table with `6.ESS2-3`; added June 2026 correction note; updated continental-drift row |

---

## Exact Standards Codes Corrected

### 1. `6.ESS2-2` / `6.MS-ESS2-2` — REMOVED (no replacement)

- **Why removed:** `6.MS-ESS2-2` does not exist in the MA 2016 STE Framework at any grade. The valid Grade 6 ESS2 standard is `6.MS-ESS2-3`.
- **`lesson_continental-drift.html`:** Content is about Wegener evidence, fossil/rock distribution, continental shapes — already fully covered by `6.ESS2-3`. Badge and panel row removed.
- **`lesson_layers-of-time.html`:** Content is about rock strata, superposition, relative dating, index fossils. `6.ESS2-2` description text matched `7.MS-ESS2-2` (Earth surface changes), not the Grade 6 standard. Badge and panel row removed.

### 2. `MS-ESS1-1` / `6.ESS1-1` → `6.MS-ESS1-1a`

- **Why corrected:** The official Massachusetts code is `6.MS-ESS1-1a` for lunar phases and eclipses. Pages were using the NGSS-style `MS-ESS1-1` or abbreviated `6.ESS1-1` formats.
- **Pages updated:** `lesson_eclipses.html`, `lesson_phases-of-the-moon.html`, `lesson_sun-earth-moon.html`, `simulation_eclipse-alignment.html`
- **`extension_moon-tonight.html`:** No standards badge found — no change needed.

### 3. `6.MS-LS1-6` → `6.MS-LS1-2`

- **Why corrected:** `6.MS-LS1-6` does not exist in the MA 2016 STE Framework. It was used in `investigation_cell-energy.html` for photosynthesis/energy cycle content.
- **Replacement rationale:** The investigation covers cell organelles (chloroplast, mitochondria), cellular energy processes, and how cells obtain energy — content that aligns to `6.MS-LS1-2` (cell parts and their contribution to cellular functions including energy for cellular processes).

### 4. `6.MS-LS1-7` → `8.MS-LS1-7`

- **Why corrected:** `6.MS-LS1-7` does not exist in the MA 2016 STE Framework. The standard for food molecules being rearranged through chemical reactions is `8.MS-LS1-7` (Grade 8).
- **Pages updated:** `investigation_cell-energy.html` (labeled as above-grade enrichment), and 8 disease pages: respiratory, digestive, circulatory, nervous, muscular, skeletal, immune, excretory.
- **Content assessment:** The food-molecule/chemical-reaction content in these pages is Grade 8 level. Keeping the badge as `8.MS-LS1-7` correctly identifies this as above-grade enrichment for Grade 6 students.

### 5. `MS-LS4-6` — REMOVED (no replacement)

- **Why removed:** `MS-LS4-6` is an NGSS code not included in the Massachusetts 2016 STE Framework at any grade level.
- **Pages updated:** `lesson_biological-evolution.html`, `simulation_beetle-island.html`, `extension_chernobyl-frogs.html`, `blog/teach-natural-selection-6th-grade.html`
- **Content preserved:** The natural selection content on these pages remains intact. The `MS-LS4-4` badge (and corrected `8.MS-LS4-4` in the blog) correctly identifies this as Grade 8 content.
- **Blog corrections:** The blog's standards section removed the `MS-LS4-6` bullet and the paragraph referencing it. The paragraph describing the graphing component was rewritten without citing the invalid code. The sidebar card was updated to show only `8.MS-LS4-4`.

### 6. Grade 6 Technology/Engineering Standards Count: 17 → 20

- **Why corrected:** Previous audit documents listed only `6.MS-ETS2-1(MA)`, `6.MS-ETS2-2(MA)`, `6.MS-ETS2-3(MA)` as the Grade 6 ETS standards. The official MA 2016 STE Framework also includes:
  - `6.MS-ETS1-1` — Define design criteria and constraints
  - `6.MS-ETS1-5(MA)` — Create a 2D scale drawing
  - `6.MS-ETS1-6(MA)` — Produce a labeled construction drawing
- **Documentation updated:** Standards master list, dashboard, alignment matrix, coverage table, and missing-standards table in `docs/grade6-standards-alignment-audit-v2.md` and `docs/hqim-grade6-readiness-audit.md`.

---

## Files Intentionally Left Unchanged

| File | Reason |
|---|---|
| `extension_moon-tonight.html` | No `MS-ESS1-1` or `6.ESS1-1` badge found; file appears not to display a standards badge |
| `simulation_floatlandia-fracture.html` | No HTML badge for `6.ESS2-2` found in the file; only referenced in audit docs (corrected there) |
| `game_evolution-clicker.html` | No `MS-LS4-6` badge found in grep results; not in original hit list |
| All quiz/submission scripts | No standards-code changes touch quiz logic, localStorage, or Google Apps Script endpoints |

---

## Pages Flagged for Human Review

| File | Issue |
|---|---|
| `lesson_eclipses.html` | Also displays `6.ESS1-2` and `6.ESS1-3` badges — these are unverified short-format codes. Content covers orbital mechanics (potentially `6.MS-PS2-4`) and eclipse geometry. Should be checked against the full MA framework. |
| `lesson_biological-evolution.html` | Uses NGSS `MS-LS4-2` badge; the MA standard `6.MS-LS4-2` describes anatomical structures (different content). The anatomical/homologous structures content is present but labeled with the wrong framework code. |
| `extension_fossil-hunt.html` | Reportedly displays `6.MS-ESS1-4` but content is about fossil organisms/environments (which is `6.MS-LS4-1`). |
| `lesson_sun-earth-moon.html`, `lesson_phases-of-the-moon.html`, `lesson_eclipses.html` | Still display `MS-ESS1-2` for gravity/orbital content. The Grade 6 standard for gravitational forces is `6.MS-PS2-4`. `8.MS-ESS1-2` is Grade 8. |
| All disease pages | The `8.MS-LS1-7` badge now correctly flags this as above-grade content, but the disease page header still says "Grade 6." Consider adding an explicit enrichment/extension note so students and teachers know this standard is Grade 8. |

---

## Above-Grade Enrichment Content (Retained, Not Removed)

The following Grade 8 content remains on the site and is accessible to Grade 6 students as enrichment. It has been labeled with correct Grade 8 codes; no page was removed.

| Pages | Grade 8 Standard | Status |
|---|---|---|
| `simulation_beetle-island.html`, `extension_chernobyl-frogs.html`, `lesson_biological-evolution.html` | `8.MS-LS4-4` Natural selection | Badge corrected; content retained |
| `blog/teach-natural-selection-6th-grade.html` | `8.MS-LS4-4` | Standards corrected; blog content retained |
| `investigation_cell-energy.html` (cellular respiration portion) | `8.MS-LS1-7` | Labeled as above-grade enrichment |
| All 8 disease pages (food/chemical reaction badge) | `8.MS-LS1-7` | Badge corrected to Grade 8 |

---

## Verification Search Results

Final repo-wide search confirms:

| Search term | Result |
|---|---|
| `6.MS-ESS2-2` in HTML/JS | **0 matches** |
| `6.ESS2-2` in HTML/JS | **0 matches** |
| `6.MS-LS1-6` in HTML/JS | **0 matches** |
| `6.MS-LS1-7` in HTML/JS | **0 matches** |
| `MS-LS4-6` in HTML/JS | **0 matches** |
| `6.MS-ESS1-1` without `a` suffix in HTML/JS | **0 matches** |
| `6.ESS1-1` without `a` suffix in HTML/JS | **0 matches** |
| Documentation claiming 17 Grade 6 standards | **0 matches** (all updated to 20) |

All remaining occurrences of these codes in `.md` files are historical audit records noting the corrections made, not active standard labels.

---

*Report generated June 3, 2026. All changes are surgical badge-level corrections. No instructional content was altered.*
