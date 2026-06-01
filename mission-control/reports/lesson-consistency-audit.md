# LyfeLabz Lesson Consistency Audit

**Audit Date:** 2026-05-24
**Files Audited:** 9 lesson HTML files (`lesson_*.html`)
**Auditor:** Claude Code (read-only analysis, no files edited)

---

## Executive Summary

The LyfeLabz lesson library is architecturally coherent overall, but several generations of the lesson template coexist. The most complete current pattern lives in `lesson_phases-of-the-moon.html` and `lesson_sun-earth-moon.html`. Lessons built before or after that pattern show specific, targeted gaps rather than wholesale problems.

The biggest consistency issues are:

1. **Standards expand button**, The `stem-detail` expand panel (allowing educators to read full standard descriptions) is present in 5 files but missing from 3 science lessons (`what-is-life`, `body-systems`, `organelles`). The CSS exists in those files; only the HTML `<div>` is absent.
2. **Learning Science badge emoji treatment**, Some files include emojis in badge labels (`🖼️ Dual Coding`), others do not (`Dual Coding`). The `ls-focus-label` also omits the `🔬` emoji in two files.
3. **MA STE standard code formatting**, Four distinct code formats are used across the library. No single format dominates consistently.
4. **Hero floating emoji class name**, Three different CSS class names are used: `.hero-float` (7 files), `.hero-cells` (2 files), `.hero-floats` (1 file, likely a typo).
5. **`lesson_ragebaiting.html`**, Structurally distinct in intentional and meaningful ways (no STE standards, different quiz, no driving question). Most differences are appropriate to its subject matter. Documented below as informational, not as errors.

---

## Source-of-Truth Patterns Observed

The following files represent the strongest current LyfeLabz lesson pattern and should be used as references for any future micro-passes:

| File | Why It's the Reference |
|---|---|
| `lesson_phases-of-the-moon.html` | Most complete structure: `hero-float` emojis, `🔬` in ls-focus-label, emoji in ls-badge labels, `stem-detail` expand button present, `📋` in stem-focus-label, 3rem section padding, `var(--dark2)` for `#continue`, `reflect-options` MC reflection before quiz |
| `lesson_sun-earth-moon.html` | Identical structure to phases; adds `cont-card.lesson` and `cont-card.sim` types; has `motion-toggle` explorer; collapsible content cards |
| `lesson_continental-drift.html` | Strong structure; slight regression on ls-focus-label emoji and standard code format |
| `lesson_layers-of-time.html` | Strong structure; minor label naming gaps |
| `lesson_biological-evolution.html` | Strong structure; unique emoji section labels; standard code format differs |

---

## Standards Display Audit

### Summary Table

| File | Standards Present | Standard Codes | Panel Format | Expand Button | stem-focus-label | Issues | Fix | Severity |
|---|---|---|---|---|---|---|---|---|
| `lesson_what-is-life.html` | Yes | `6.MS-LS1-1`, `6.MS-LS1-2` | Badges only (no expand) | **Missing** | `MA STE Standards · Grade 6` (no 📋) | No stem-detail HTML div; no 📋 emoji; badges show when `body.stem-active` but no detail expansion | Add `<div class="stem-detail">` block with expand button and full descriptions; add 📋 to label | **High** |
| `lesson_phases-of-the-moon.html` | Yes | `MS-ESS1-1`, `MS-ESS1-2` | Badges + expand | Present | `📋 MA STE Standards · Grade 6` ✓ | Code format omits grade prefix and `MS-` prefix used in Life Science files | Minor, consistent within ESS cluster | Low |
| `lesson_sun-earth-moon.html` | Yes | `MS-ESS1-1`, `MS-ESS1-2` | Badges + expand | Present | `📋 MA STE Standards · Grade 6` ✓ | Same code format note as phases | Minor | Low |
| `lesson_biological-evolution.html` | Yes | `MS-LS4-4`, `MS-LS4-1`, `MS-LS4-2`, `MS-LS4-6` | Badges + expand | Present | `📋 MA STE Standards · Grade 7–8` ✓ | Code format uses NGSS-style `MS-LS4-X` without grade prefix, differs from Life Science cluster (`6.MS-LS1-X`). Grade label correctly says 7–8 | Standardize to `6.MS-LS4-X` if matching MA STE framework notation, or accept NGSS format consistently | Medium |
| `lesson_body-systems.html` | Yes | `6.MS-LS1-3` | Badges only (no expand) | **Missing** | `📋 MA STE Standards · Grade 6` ✓ | stem-detail CSS present but no HTML div; expand button never renders | Add `<div class="stem-detail">` block with expand button and full descriptions | **High** |
| `lesson_continental-drift.html` | Yes | `6.ESS2-3`, `6.ESS2-2`, `SEP-4` | Badges + expand | Present | `MA STE Standards · Grade 6` (no 📋; uses HTML `&middot;` not Unicode `·`) | No 📋 emoji on stem-focus-label; HTML entity for middot instead of Unicode; `SEP-4` is a practice code, not a content standard code, mixing frameworks; standard codes omit `MS-` unlike ESS lessons | Add 📋; switch `&middot;` to `·`; consider whether SEP-4 belongs alongside MA STE codes | Medium |
| `lesson_layers-of-time.html` | Yes | `6.ESS1-4`, `6.ESS2-2`, `6.ESS2-3` | Badges + expand | Present | `📋 MA STE Standards · Grade 6` ✓ | Code format uses `6.ESS-X` without `MS-` (same cluster inconsistency as continental-drift) | Acceptable within the Earth Science cluster | Low |
| `lesson_organelles.html` | Yes | `6.MS-LS1-1`, `6.MS-LS1-2` | Badges only (no expand) | **Missing** | `📋 MA STE Standards · Grade 6` ✓ | stem-detail CSS present but no HTML div; expand button never renders | Add `<div class="stem-detail">` block with expand button | **High** |
| `lesson_ragebaiting.html` | **No** | N/A | N/A | N/A | N/A | No MA STE standards, this is a psychology/media literacy lesson, not aligned to STE. Intentional. Document this in lesson metadata if not already noted. | No change needed; may want a note in-page if educator mode is ever added | Informational |

### Standard Code Format Inconsistency

Four distinct MA STE code formats are present across the library:

| Format | Example | Files Using It |
|---|---|---|
| `6.MS-LS1-X` | `6.MS-LS1-1` | `what-is-life`, `organelles`, `body-systems` |
| `MS-ESS1-X` | `MS-ESS1-1` | `phases-of-the-moon`, `sun-earth-moon` |
| `MS-LS4-X` | `MS-LS4-4` | `biological-evolution` |
| `6.ESS1-X` / `6.ESS2-X` | `6.ESS1-4` | `continental-drift`, `layers-of-time` |

The MA STE framework itself uses the `6.MS-LS1-1` format for middle school. Recommend establishing one canonical format and applying it across all files. The `6.MS-LS1-1` style is the most complete (grade + level + domain + number) and should be the standard.

---

## Learning Badge / Pill Audit

### Hero Badge

All science lessons display a `<div class="hero-badge">Lesson</div>` in the hero section. This is consistent across 8 files. `lesson_ragebaiting.html` uses `<div class="hero-badge">🎓 For Middle School Students</div>`, a different text and structure that is intentional for that lesson's context.

### Learning Science Badges (ls-focus panel)

| File | ls-focus-label Emoji | Badge Labels Emoji | Badge Count | Issues | Recommended Fix | Severity |
|---|---|---|---|---|---|---|
| `lesson_what-is-life.html` | **None**, `"Learning Science Focus"` | **None**, plain text labels | 5 | Older style; no emojis in label or badge text | Add `🔬` to label; add emojis to badge labels to match current pattern | Medium |
| `lesson_phases-of-the-moon.html` | `🔬` ✓ | Yes, `🔍 🧠 🖼️ ✅ 🔀` | 5 | None |, |, |
| `lesson_sun-earth-moon.html` | `🔬` ✓ | Yes, `🔍 🧠 🔗 ✅` | 4 | One fewer badge than phases/bio | Acceptable, badge count reflects lesson content |, |
| `lesson_biological-evolution.html` | `🔬` ✓ | Yes, `🔍 🧠 🖼️ ✅ 🔀` | 5 | None |, |, |
| `lesson_body-systems.html` | `🔬` ✓ | Yes, `🗂️ 🖼️ 💬 🧠 ⚖️` | 5 | None |, |, |
| `lesson_continental-drift.html` | **None**, `"Learning Science Focus"` | **None**, plain text labels | 5 | Missing emoji in label and badge text; matches older `what-is-life` style | Add `🔬` to label; add emojis to badge labels | Medium |
| `lesson_layers-of-time.html` | `🔬` ✓ | Yes | 5 (assumed from CSS pattern) | None visible |, |, |
| `lesson_organelles.html` | `🔬` ✓ | Yes | 5 (assumed from CSS pattern) | None visible |, |, |
| `lesson_ragebaiting.html` | `🔬` ✓ | Yes, `🔄 🎯 🔍 ⚙️ ✨` | 5 | None |, |, |

### Badge Visual Consistency

- **Shape and spacing**: Consistent across all files, `border-radius: 99px`, `padding: 0.35rem 0.9rem`, pill style.
- **Color**: Consistent, white/translucent (`rgba(255,255,255,0.06–0.07)`) badges on all files.
- **Hover behavior**: Consistent, subtle brightness lift on all files.
- **Tooltips**: Consistent `data-tip` CSS tooltip pattern across all files.
- **Visibility gate**: Consistent, `display: none` until `body.ls-active` across all files.

---

## UX Consistency Audit

| File | Hero/Header | Hero Floats Class | Driving Question | Nav-Back Label | Mode Toggle | Stem Detail Expand | Section Label Naming | Quiz Label | Footer | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| `lesson_what-is-life.html` | Green gradient hero | `.hero-cells` | Yes | `← Life Science` | Yes | **Missing** | Standard (no emoji) | `Check Your Understanding` | ✓ | Older pattern throughout; 5rem section padding; `#continue` uses `var(--dark)` |
| `lesson_phases-of-the-moon.html` | Slate gradient hero | `.hero-float` ✓ | Yes | `← Home` | Yes | Yes ✓ | Standard (no emoji) | `Check Your Understanding` | ✓ | Cleanest current pattern; includes "Think About It" reflection section |
| `lesson_sun-earth-moon.html` | Slate gradient hero | `.hero-float` ✓ | Yes | `← Home` | Yes | Yes ✓ | Standard (no emoji) | `Check Your Understanding` | ✓ | Strong current pattern; collapsible content cards; "Think About It" section |
| `lesson_biological-evolution.html` | Amber gradient hero | `.hero-float` ✓ | Yes | `← Life Science` → `#unit-biological-evolution` | Yes | Yes ✓ | **Emojis in all section labels** (📖 🔬 📐 🏷️ ✅ 🚀) | `Check Your Understanding` | ✓ | Unique emoji section labels; `🚀 Go Further` label; `cont-card.activity` only in this file |
| `lesson_body-systems.html` | Teal gradient hero | **`.hero-floats`** (typo, plural) | Yes | `← Life Science` → `#unit-body-systems` | Yes | **Missing** | Standard (no emoji) | **`Mastery Check`** instead of `Check Your Understanding` | ✓ | No Investigation/hook section; quiz submit button uses dark text on teal (intentional per teal theme) |
| `lesson_continental-drift.html` | Slate gradient hero | `.hero-float` ✓ | Yes + **second DQ mid-lesson** (line 1235) | `← Earth & Space` → `#geo` | Yes | Yes ✓ | Narrative section labels | `Check Your Understanding` | ✓ | Second `driving-question` in body may be intentional design for this lesson |
| `lesson_layers-of-time.html` | Slate gradient hero | `.hero-float` ✓ | Yes | `← Earth & Space` → `#geo` | Yes | Yes ✓ | Fewer sections; **`Quiz`** instead of `Check Your Understanding`; **no Key Vocabulary section** | `Quiz` | ✓ | Condensed structure; `Go Further` has only `game` type cards |
| `lesson_organelles.html` | Green gradient hero | `.hero-cells` | Yes | `← Life Science` → `#unit-organelles` | Yes | **Missing** | `Opening Phenomenon` (not `Investigation`) | `Check Your Understanding` | ✓ | `.hero-cells` matches `what-is-life` green theme; `Opening Phenomenon` likely intentional |
| `lesson_ragebaiting.html` | Purple/dark hero | **None** (no floating emojis) | **No** | `← Psychology` → `#psych` | **No** (different quiz system) | N/A (no standards) | Narrative section labels; `Keep Learning` instead of `Go Further` | N/A (no standard quiz) | ✓ | Different quiz: 5 Qs, no student-info-box, no mode toggle, `resource-card` in continue. All intentional for psychology lesson type. |

### Mode Toggle (Practice / Classroom)
All 8 science lessons have `quiz-mode-toggle` and `student-info-box` (name / teacher / block). `lesson_ragebaiting.html` omits these, which is appropriate.

### Quiz Structure
- **Science lessons**: 4 questions, 4 options each, standard `quiz-card` + `quiz-option` + `quiz-submit-btn` pattern. Consistent across all 8.
- **`lesson_ragebaiting.html`**: 5 questions, different card structure (`quiz-box` + `quiz-feedback`), no progress bar, no student info. Intentionally different.

### Reflection Section ("Think About It")
- `phases-of-the-moon` and `sun-earth-moon` include a "Think About It" section with `reflect-options` (MC reflection questions) before the quiz.
- No other science lesson includes this section.
- This is either an enhancement that hasn't been backported, or an intentional design difference for astronomy lessons where the orbit SVG warrants it.

### "More Learning" / Go Further Section

| File | Section Label | `cont-card` Types Present |
|---|---|---|
| `lesson_what-is-life.html` | `🚀 Go Further` (emoji) | `ext`, `game` |
| `lesson_phases-of-the-moon.html` | `Go Further` | `ext` only |
| `lesson_sun-earth-moon.html` | `Go Further` | `sim`, `lesson`, `ext`, `game` |
| `lesson_biological-evolution.html` | `🚀 Go Further` (emoji) | `sim`, `activity` |
| `lesson_body-systems.html` | `Go Further` | `ext`, `game`, `map` |
| `lesson_continental-drift.html` | `Go Further` | `sim`, `game`, `ext`, `lesson` |
| `lesson_layers-of-time.html` | `Go Further` | `game` only |
| `lesson_organelles.html` | `Go Further` | `ext`, `game`, `map` |
| `lesson_ragebaiting.html` | `Keep Learning` | `resource-card` (external links, not `cont-card`) |

**Issues:**
- `lesson_what-is-life.html` and `lesson_biological-evolution.html` use `🚀 Go Further` while others use plain `Go Further`. Inconsistent.
- `lesson_layers-of-time.html` has only `game` cards in the continue section, sparse but may reflect limited available resources.
- `cont-card.activity` appears only in `biological-evolution`. `cont-card.map` appears in `body-systems` and `organelles`. These are extensions of the card system, not problems, but the CSS for these types may not be defined in all files.

### Footer
Fully consistent across all 9 files: `footer-logo` (Fredoka One, gold), `footer-tagline`, `footer-links` pill buttons (gold + teal "Why It Works?" link), copyright line.

### Background Colors
- `#continue` section: `var(--dark)` in `what-is-life`; `var(--dark2)` in all other science lessons. Minor inconsistency.
- Section alternating backgrounds are handled per-lesson by individual section IDs, consistent within each file.

---

## Highest Priority Fixes

Ranked by student/teacher impact, ease of repair, and importance to LyfeLabz consistency:

| Rank | Fix | File(s) | Impact | Ease |
|---|---|---|---|---|
| 1 | Add `stem-detail` expand button HTML block | `lesson_what-is-life.html`, `lesson_body-systems.html`, `lesson_organelles.html` | **Teacher**, educators using these 3 lessons cannot expand to read full standard descriptions; feature is silently broken despite CSS being present | Easy, copy block from `lesson_phases-of-the-moon.html` lines 729–741, adjust standard codes and descriptions |
| 2 | Add `🔬` emoji to `ls-focus-label` in two files | `lesson_what-is-life.html`, `lesson_continental-drift.html` | Medium, visible UI inconsistency for anyone who enables Learning Science mode | Trivial, one character change per file |
| 3 | Add emojis to ls-badge labels in two files | `lesson_what-is-life.html`, `lesson_continental-drift.html` | Medium, same Learning Science mode inconsistency | Easy, add one emoji per badge label |
| 4 | Add `📋` emoji to `stem-focus-label` in two files | `lesson_what-is-life.html`, `lesson_continental-drift.html` | Medium, visible to educators in standards mode | Trivial, one character change per file |
| 5 | Fix `.hero-floats` typo in body-systems | `lesson_body-systems.html` | Low-Medium, floating emojis may render incorrectly if the CSS class name doesn't match | Trivial, rename `.hero-floats` to `.hero-float` in CSS and HTML |
| 6 | Standardize MA STE standard code format | All science files | **Teacher**, inconsistent codes make it harder for educators to cross-reference the MA STE framework | Medium, requires verifying correct MA STE codes for each lesson before editing |
| 7 | Rename `Mastery Check` → `Check Your Understanding` | `lesson_body-systems.html` | Low-Medium, inconsistent label for the same quiz section | Trivial, one string change |
| 8 | Rename section label `Quiz` → `Check Your Understanding` | `lesson_layers-of-time.html` | Low, minor label inconsistency | Trivial |
| 9 | Add Key Vocabulary section to layers-of-time | `lesson_layers-of-time.html` | Medium-Student, learners in this lesson lack the vocabulary section available in other lessons | Moderate, requires writing vocab content, not just a label change |
| 10 | Remove emoji from `🚀 Go Further` section label | `lesson_what-is-life.html`, `lesson_biological-evolution.html` | Low, emoji is inconsistent with other files | Trivial |

---

## Recommended Micro-Passes

Small, safe, one-file-at-a-time edits:

1. **`lesson_what-is-life.html`**, Add `🔬` to `ls-focus-label`; add emojis to 5 ls-badge labels; add `📋` to `stem-focus-label`; change `#continue` background to `var(--dark2)`; remove `🚀` from `Go Further` section label.
2. **`lesson_what-is-life.html`** (separate pass), Add the `stem-detail` HTML block (copy from phases-of-the-moon) with correct `6.MS-LS1-1` and `6.MS-LS1-2` descriptions.
3. **`lesson_body-systems.html`**, Fix `.hero-floats` → `.hero-float` in both CSS and HTML; add `stem-detail` HTML block for `6.MS-LS1-3`; rename `Mastery Check` → `Check Your Understanding`.
4. **`lesson_organelles.html`**, Add `stem-detail` HTML block for `6.MS-LS1-1` and `6.MS-LS1-2`.
5. **`lesson_continental-drift.html`**, Add `🔬` to ls-focus-label; add emojis to ls-badge labels; add `📋` to stem-focus-label; change `&middot;` to `·` in stem-focus-label; evaluate whether `SEP-4` should be listed alongside MA STE codes.
6. **`lesson_biological-evolution.html`**, Remove emojis from section labels; remove `🚀` from `Go Further` label; evaluate standard code format (`MS-LS4-X` vs `6.MS-LS4-X`).
7. **`lesson_layers-of-time.html`**, Rename `Quiz` section label → `Check Your Understanding`.

---

## Recommended Larger Rebuilds

These files need more than label changes to fully match the current best pattern:

| File | What It Needs | Scope |
|---|---|---|
| `lesson_what-is-life.html` | Section padding update (5rem → 3rem); `#continue` background fix; hero CSS rename (`hero-cells` → `hero-float` or keep intentionally as biology-themed class); evaluate adding "Think About It" reflection section before quiz | Medium, touches CSS and section structure |
| `lesson_body-systems.html` | No Investigation/hook opening section; may benefit from a phenomenon-first hook consistent with newer lessons; missing "Think About It" reflection | Medium-Large |
| `lesson_layers-of-time.html` | Missing Key Vocabulary section; sparse "More Learning" section (only one `game` card type); section count is lower than other lessons in the same Earth Science cluster | Medium |
| `lesson_ragebaiting.html` | Different architecture is largely intentional; however if educator mode or standards mode is ever extended to cover psychology/social emotional learning, this file would need significant additions | Large, defer until curriculum scope decision is made |

---

## Do Not Change Notes

The following design elements should be **preserved** even if they look inconsistent at first glance:

- **`.hero-cells` CSS class name** on `lesson_what-is-life.html` and `lesson_organelles.html`, The class name matches the biological/cellular emoji theme of those lessons (🦠 🔬). It is not a bug; it is thematic naming. However, it could be renamed to `.hero-float` for structural consistency without any visible change, since the CSS behavior is identical.

- **`lesson_ragebaiting.html` quiz structure**: The 5-question `quiz-box` pattern without a mode toggle is intentional. This lesson has no classroom submission flow, no Educator Mode, and no standards panel because it covers media psychology, not MA STE content. The `Keep Learning` label with `resource-card` external links is appropriate for this lesson's outcome.

- **Theme accent colors**: Each lesson uses a distinct accent color appropriate to its subject:
  - Green (`#2ecc71`), Life Science: `what-is-life`, `organelles`
  - Teal (`#3bc8e8`), Body Systems
  - Slate (`#7a8fa6`), Earth and Space Science: `phases`, `sun-earth-moon`, `continental-drift`, `layers-of-time`
  - Amber (`#c48a4e`), Biological Evolution
  - Purple, Ragebaiting
  
  These are intentional and should not be changed.

- **`lesson_continental-drift.html` second driving question**: There is a second `driving-question` block appearing mid-lesson (line 1235) in addition to the hero DQ. This appears intentional, it serves as a mid-lesson focus question. Do not remove without confirming intent with the author.

- **Collapsible content cards in `lesson_sun-earth-moon.html`**: The `.content-card { cursor: pointer; }` toggle pattern is unique to this lesson. It is a deliberate UX decision for a lesson with many vocabulary-heavy cards.

- **`cont-card.lesson` type**: appears in `sun-earth-moon` and `continental-drift`. The lesson card type links to related LyfeLabz lessons and is intentional. It is not present in all files because not all lessons have a related LyfeLabz lesson to link to.

- **`lesson_biological-evolution.html` emoji section labels**: While visually inconsistent with other lessons, they may be intentional for this lesson. Consult with the author before removing them.

- **Floating emoji characters**: The specific emojis in each hero section are lesson-specific and should be preserved:
  - `what-is-life`: 🦠 🔬 🌱 🧬
  - `phases-of-the-moon`: 🌑 🌕 🌍 🔭
  - `sun-earth-moon`: ☀️ 🌍 🌙 ✨
  - `biological-evolution`: lesson-specific set
  - `ragebaiting`: none (intentional)

---

*End of audit. No files were modified during this analysis.*
