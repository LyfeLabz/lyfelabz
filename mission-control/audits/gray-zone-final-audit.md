# Gray Zone: Final Audit (Micropass 9)

**File:** `extension_gray-zone.html`  
**Audit date:** 2026-06-01  
**Auditor:** Claude (Micropass 9, audit only, no edits)  
**Status at entry:** Micropasses 1–8 complete. All six phases implemented with full gate logic.

---

## 1. Student Experience

### Strengths
- Six-phase scaffold is pedagogically well-ordered: criteria review → prediction → evidence → notebook synthesis → argument construction → transfer quiz.
- Progress bars with text counters at every phase give clear spatial feedback.
- Phase labels (`Phase 1 · Criteria Discovery`, etc.) are consistent and visually distinct.
- Hero framing ("Use evidence, not instinct") sets the right epistemic tone from the first screen.
- The CER builder locks steps sequentially (Claim → Evidence → Reasoning), preventing students from jumping ahead.
- Completion panel with phased summary grid gives a satisfying capstone before the reflection prompt.
- The Phase 2→4 prediction-to-evidence comparison is a strong metacognitive loop, students see their initial guess vs. their collected evidence side by side in the notebook.

### Issues
- **The bridge section between Phase 2 and Phase 3 has no phase number.** After predictions unlock the investigation content, a section titled "Six Things That Break the Rules" appears with the label `The Gray Zone` (no phase number). Every other section is labeled `Phase N · Name`. This section reads as unanchored and breaks the phase-numbering rhythm the student has come to rely on. Minor but noticeable.
- **Phase 4 notebook review button is ungated.** When Phase 4 appears, the "Review Complete, Continue to Arguments" button is immediately clickable. Nothing prevents a student from clicking it without reading the table. The notebook is intended as a review pause, the button should either be delayed by a timer or require scrolling past the table before activating. Low severity but reduces the scaffolding value of Phase 4.
- **Phase 3 requires 36 individual radio selections** (6 cases × 6 characteristics) before any analysis reveals. With no interim feedback during selection, a student can click through all 36 options randomly in under 30 seconds to unlock the analysis panels without engaging. This is a structural design limit, not a defect.

---

## 2. Gate Chain

The gate chain is sound and fully implemented. The sequence:

| Gate | Trigger | Unlocks |
|------|---------|---------|
| P1 → P2 | All 6 criteria reviewed | Phase 2 section |
| P2 → P3 | All 6 predictions made | `#investigation-content` (cases overview + Phase 3) |
| P3 → P4 | All 6 evidence panels complete | Phase 4 notebook |
| P4 → P5+6 | `notebookReview()` called | `#cer-quiz-content` |
| P5 → P6 | All 4 CER arguments complete | Quiz section |
| P6 → Complete | All 8 quiz questions answered | `#inv-complete` panel |

All lock banners hide correctly. All hidden sections use `display:none` initially and reveal via JavaScript with `fadeIn` animation.

**One note:** `cerState` is declared inside a `<script>` block and referenced from a separate `<script>` block via the global scope. This works in all browsers but is a mild coupling fragility, if script order ever changes, `showInvComplete()` could read `cerState` before it is defined.

---

## 3. Mobile UX

### Strengths
- All grids use `repeat(auto-fill, minmax(300px, 1fr))`, collapsing to a single column below ~640px.
- Evidence characteristic rows switch to column layout on ≤640px.
- Reflection options go column-direction on ≤640px.
- Quiz options go full-width on ≤600px.
- `font-size: clamp(...)` on h1 and completion title prevents overflow.

### Issues
- **The notebook table hides Column 3 ("Evidence Collected") on mobile (≤640px).** The CSS rule `.nb-table th:nth-child(3), .nb-table td:nth-child(3) { display: none; }` removes the most recently gathered data column. At mobile sizes, students see Case, First Impression, and Current Status, but not whether evidence was collected. This undercuts the comparison the notebook is designed to surface. Consider hiding Column 4 ("Current Status") instead, since it is derived from Column 3.
- **CER option buttons have `padding-left: 2.75rem` (for the step indent) with no mobile override.** On screens narrower than ~380px, the option text may wrap very tightly. Not a hard break but should be verified on real devices.
- **The nav bar has four items at small widths** (logo, back link, STEM toggle, LS toggle). At ~360px, the back link text "← Characteristics of Life" may wrap or overflow. A `font-size` clamp or `white-space: nowrap` with `overflow: hidden` on `.nav-back` would protect this.

---

## 4. Accessibility

### Strengths
- All radio inputs are present in the DOM (not removed), only visually hidden. Screen readers can access them.
- Phase 1 buttons have `focus-visible` outlines explicitly declared.
- Phase 2 and 3 radio groups correctly use `<label>` wrapping `<input>`.
- Phase 2 uses `<fieldset>/<legend>` for each prediction group, correct pattern.
- The notebook table has `aria-label="Investigation Summary"` and `scope="col"` on header cells.
- Collapsible analysis cards use native `<details>/<summary>`, natively keyboard-navigable.
- CER and quiz options use `<button>` elements, not `<div>`, correct.

### Issues
- **Star canvas (`#stars`) is missing `aria-hidden="true"`.** The canvas is purely decorative but will be exposed to screen readers as a focusable/interactive element. Add `aria-hidden="true"` to the canvas element.
- **Floating hero-cell emoji spans have no `aria-hidden`.** The four `<span class="hero-cells">` elements (🔥🤖🌱🔮) are decorative. Screen readers will announce them. Add `aria-hidden="true"` to each.
- **Phase 3 evidence groups are not wrapped in `<fieldset>/<legend>`.** Each characteristic row is a set of three radios (Present / Absent / Partial) with no programmatic group association. Keyboard users relying on screen readers may not know which question they are answering. A `<fieldset>` per row (or at minimum a `role="group"` + `aria-labelledby`) would improve this.
- **The `⚠️` symbol in the hero h1** (`⚠&#xFE0E;`) prevents emoji rendering but does not suppress screen reader announcement. Screen readers may say "warning sign" mid-title. Wrapping it in `<span aria-hidden="true">` would fix this.
- The `inv-lock-banner` elements are rendered in the DOM as visible text between phases. When a student is in Phase 3, the lock banners for Phases 4 and 5 are visible and readable. This is acceptable but could be distracting on screen readers, they will encounter "Complete Evidence Collection to unlock the Scientific Notebook" before the Evidence Collection section has even appeared in the visual flow.

---

## 5. Scientific Accuracy

All six case analyses are scientifically accurate and grade-appropriate.

| Case | Verdict | Accuracy |
|------|---------|----------|
| Fire | Not alive | ✓ Correct. No cells, no genetic material, no biological reproduction. The "partial" pills for energy/growth/response are defensible and accurately nuanced. |
| Crystals | Not alive | ✓ Correct. Fails 5 of 6 entirely. Growth-without-metabolism distinction is precisely stated. |
| Dormant Seed | Alive | ✓ Correct. "Life is a capacity, not just a behavior" is an excellent framing for middle school. Dormancy vs. death distinction is accurate. |
| Mule | Alive | ✓ Correct. Chromosome count cited accurately (horse 64, donkey 62). The analysis correctly frames the six characteristics as describing "life as a system, not a checklist every individual must fully satisfy." |
| Robot | Not alive | ✓ Correct. The distinction between engineered behavior and biological response is clearly drawn. |
| Virus | Gray zone | ✓ Accurate. The scientific debate is genuine and the analysis correctly presents it as contested. Capsid/protein coat described correctly. |

**One factual inconsistency found:**

> **Quiz Q6 (line 1839):** "Which of the **five** Gray Zone cases is MOST clearly nonliving, because it fails nearly all six characteristics?"

The investigation has **six** cases, not five. The explanation at line 1847 also reads: "They're the clearest non-living case of the **five**." The answer options (Seed, Mule, Crystal, Robot) omit Fire and Virus; which is a reasonable editorial choice for the question; but the phrasing "five" is a factual error that directly contradicts the section header "Six Things That Break the Rules" and the evidence phase header "0 of 6 cases investigated." A student will notice this inconsistency.

**One cosmetic scientific-icon inconsistency:**

> **Virus analysis, "Made of Cells" row (line 1300):** Uses the 🧫 (petri dish) icon as the `check-left` element. Every other case's "Made of Cells" row uses 🦠. This is a visual inconsistency (not a factual error, but worth correcting for polish.

---

## 6. Investigation Quality

### Strengths
- The case selection covers a clear spectrum: two clear non-living (Fire, Crystals), one clear living with a wrinkle (Mule), one paused living (Seed), one engineered mimicry (Robot), one genuinely contested (Virus). This range is pedagogically excellent for middle school.
- CER cases (Fire, Mule, Robot, Virus) cover the full range of argumentative positions: clear non-living, clear living, near-living, genuinely gray. Students practice both sides and nuance.
- The quiz reinforces transfer, not just recall, Q4 (Mule reveals limits of the framework), Q8 (counterargument construction) require higher-order thinking.
- Immediate feedback on every CER and quiz selection, with explanations that teach rather than just correct.
- The "gray zone" claim structure for Virus (Q3 in CER) is pedagogically sophisticated, it asks students to argue a genuinely contested position rather than forcing a binary verdict.

### Issues
- The bridge section ("Six Things That Break the Rules") functions as a visual preview of all six cases before students have done any evidence collection. This is fine for orientation, but the `section-label` reads "The Gray Zone" without a phase number, making it feel orphaned from the phase scaffold. Consider labeling it "Phase 3 Preview · The Cases" or integrating its content into the Phase 3 header.
- The investigation completion summary always shows "6 Cases Investigated" even if `evDone.size` returned fewer. Looking at the code: `showInvComplete()` reads `window.gzGetCasesComplete()` which returns the live `casesComplete` Set, at the point `showInvComplete()` is called (after quiz completion), all 6 cases will have been investigated (it's a gate). So in practice this is fine, but the summary item text is hardcoded as a label rather than actually validating completeness. Minor.

---

## 7. Code Quality

### Strengths
- Phase 1, 2, and 3 logic is correctly wrapped in IIFEs, preventing variable leakage.
- `window.gzGetPredictions` and `window.gzGetCasesComplete` are cleanly exposed for cross-script reads in `buildNotebook()` and `showInvComplete()`.
- All gate transitions use consistent pattern: hide lock banner (`.hidden` class), set `display:''`, add `fadeIn` animation.
- `evidenceSelect` correctly uses `wasNew` to prevent double-counting, changing a selection after it's been made doesn't re-trigger the gate check.
- `predSelect` similarly uses `wasNew`, allows prediction revision without re-triggering the count.
- `unlockStep` correctly swaps out the locked placeholder and inserts live buttons for the next CER step.
- The notebook `buildNotebook()` is called at the right moment (when Phase 3 completes and Phase 4 reveals).

### Issues
- **`showInvComplete()` uses `var` throughout while the surrounding codebase uses `const`/`let`.** This is a stylistic inconsistency introduced in Micropass 8. Not a bug, but worth normalizing.
- **`cerState` is declared in one `<script>` block and referenced from a later `<script>` block.** Both blocks share the global scope so this works, but script ordering is load-order dependent. If `showInvComplete()` (defined in the third script block) were ever called before the first script block executed, it would throw. Low risk given page structure, but fragile.
- **The star canvas does not resize dynamically as phases reveal.** `canvas.height = document.body.scrollHeight` is set once on load. As hidden sections (`display:none`) reveal during the investigation, the document body grows significantly taller. The canvas will not cover the new area until a window resize event fires. Stars will be absent below the initial fold on narrow screens during most of the investigation. Adding a canvas resize call inside each gate unlock would fix this.
- **`#cases` and `#analyze` are in `<section id="...">` but the `scroll-margin-top` rule on line 140 (`#cases, #analyze, #cer, #quiz { scroll-margin-top: 10px; }`) applies to all four IDs.** These sections are inside `#investigation-content` which starts `display:none`, there are no internal anchor nav links, so `scroll-margin-top` is not actively used. Harmless but dead CSS.

---

## 8. Rename Readiness

### Items requiring update before rename

| Item | Location | Current value | Required value |
|------|----------|--------------|----------------|
| Canonical URL | `<head>`, line 15 | `https://lyfelabz.com/extension_gray-zone.html` | `https://lyfelabz.com/investigation_gray-zone.html` |
| Inbound links | `index.html` and any other pages linking to this file | `extension_gray-zone.html` | `investigation_gray-zone.html` |
| Nav back link | Line 719 | Links to `lesson_characteristics.html` | No change needed, this is an outbound link |

### Items already correct for rename
- `<title>` already reads "The Gray Zone Investigation | LyfeLabz" ✓
- Hero badge already reads "Investigation" ✓
- Completion panel subtitle reads "The Gray Zone · Life Science Investigation" ✓
- Meta description uses "Investigate" ✓
- No JavaScript references to the filename ✓
- No self-referencing anchor links ✓

The file is nearly rename-ready (only the canonical URL and any inbound links require updating.

---

## Bug Summary

| # | Severity | Category | Description |
|---|----------|----------|-------------|
| 1 | **Medium** | Scientific accuracy | Quiz Q6 says "five Gray Zone cases", there are six. Explanation also says "five." |
| 2 | **Low** | Mobile UX | Notebook table hides "Evidence Collected" column on mobile, should hide lower-value column instead |
| 3 | **Low** | Accessibility | `#stars` canvas missing `aria-hidden="true"` |
| 4 | **Low** | Accessibility | Four `.hero-cells` emoji spans missing `aria-hidden="true"` |
| 5 | **Low** | Accessibility | Phase 3 evidence radio groups not wrapped in `<fieldset>/<legend>` |
| 6 | **Low** | Scientific icon | Virus "Made of Cells" row uses 🧫 instead of 🦠 (line 1300) |
| 7 | **Low** | Student experience | Bridge section "Six Things That Break the Rules" has no phase number label |
| 8 | **Low** | Rename | Canonical URL still points to `extension_gray-zone.html` |
| 9 | **Cosmetic** | Code quality | `showInvComplete()` uses `var` while rest of codebase uses `const`/`let` |
| 10 | **Cosmetic** | Code quality | Star canvas doesn't grow as content reveals during investigation |

---

## Verdict

**B. Minor Fixes Before Rename**

The investigation is structurally complete, pedagogically sound, and all gate logic is correctly implemented. The CER and quiz content is scientifically accurate and educationally strong.

Two fixes should be made before rename:

1. **Q6 wording: "five" → "six"** (or rewrite the question to make the subset explicit). This is a factual error visible to students.
2. **Canonical URL update** (required for rename regardless).

All remaining items (accessibility gaps, mobile table column, emoji inconsistency, phase-label missing in bridge section) are low-severity polish items that can be addressed in a post-rename pass. None block the investigation from functioning correctly.

The file is **two targeted fixes away** from rename readiness.
