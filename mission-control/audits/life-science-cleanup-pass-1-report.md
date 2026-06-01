# Life Science Cleanup Pass 1 — Verification Report

**Date:** 2026-05-31  
**Pass type:** Technical debt cleanup + content consolidation (read/edit — no redesigns)  
**Source audit:** `life-science-games-extensions-audit.md`

---

## Files Modified

| File | Tasks Applied |
|---|---|
| `game_is-it-alive.html` | T1 (CSS fix), T2 (nav-links removed) |
| `game_cellular-showdown.html` | T1 (CSS fix), T2 (nav-links removed) |
| `game_cell-explorer.html` | T2 (nav-links removed) |
| `extension_neuron-explorer.html` | T1 (CSS fix), T2 (nav-links removed) |
| `extension_body-systems.html` | T2 (nav-links removed) |
| `extension_gray-zone.html` | T2 (nav-links removed), T3 (virus content merged) |
| `extension_organelles.html` | T2 (nav-links removed) |
| `extension_biological-evolution.html` | T2 (nav-links removed) |
| `index.html` | T3 (extension_virus link removed) |

**Files not modified:** `extension_virus.html` (archived in place per instructions), all game_ simulation/lesson pages, all nav/footer structure, all Earth Science pages.

---

## Task 1 — CSS Bugs Fixed

### Problem
Three pages shared an identical malformed CSS block where `.hero-badge {}` was nested as a selector inside the opening brace of `.page-hero {}`. This is invalid CSS — browsers either ignore the inner selector or interpret it as CSS nesting (which is not reliably supported without a preprocessor). In practice, `.page-hero`'s `padding` and `background` properties were being silently dropped in some parsers because they appeared after the nested block, outside valid property position.

```css
/* BEFORE (malformed — browser parses this incorrectly) */
.page-hero {
  .hero-badge { … }          ← nested selector in wrong position
  padding: 3.5rem 2rem 2rem; ← these properties may be dropped
  background: radial-gradient(…);
}
```

```css
/* AFTER (valid — two separate, properly closed rule blocks) */
.hero-badge { … }
.page-hero {
  padding: 3.5rem 2rem 2rem;
  background: radial-gradient(…);
}
```

### Files fixed
- `game_is-it-alive.html` ✓  
- `game_cellular-showdown.html` ✓  
- `extension_neuron-explorer.html` ✓

### Verification
Automated check confirms `.hero-badge` is no longer nested inside `.page-hero {}` in any of the three files. Visual appearance is preserved — only selector structure corrected.

---

## Task 2 — Legacy Navigation Removed

### What was removed
The `.nav-links` pattern — a horizontal unordered list of page-section anchor links displayed between the logo and back button — was a retired navigation pattern. It was replaced site-wide by the current `nav-back` pill alone. Eight pages still contained remnants of this pattern in various states:

| Page | Had CSS | Had HTML `<ul>` | Had media query `display:none` |
|---|---|---|---|
| `game_is-it-alive.html` | ✓ | ✗ | ✓ |
| `game_cellular-showdown.html` | ✓ | ✗ | ✓ |
| `game_cell-explorer.html` | ✓ | ✗ | ✓ |
| `extension_neuron-explorer.html` | ✓ | ✗ | ✓ |
| `extension_body-systems.html` | ✓ | ✗ | ✗ |
| `extension_gray-zone.html` | ✓ | ✓ (4 items) | ✓ |
| `extension_organelles.html` | ✓ | ✓ (4 items) | ✓ |
| `extension_biological-evolution.html` | ✓ | ✓ (4 items) | ✓ |

`.nav-badge` CSS (a dead content-type pill inside the nav) was also removed from pages where it appeared with no corresponding HTML — it had been superseded by the `.hero-badge` in the page hero.

### What was preserved
- All `.nav-logo` (LYFELABZ wordmark)  
- All `.nav-back` (← back pill) with correct parent page links  
- All page functionality and content  
- `extension_body-systems.html` `.nav-center` breadcrumb was **not** removed — that is scoped to a separate future micropass (Micropass 3 in the audit)

### Verification
Zero occurrences of `nav-links` remain across all eight targeted files.

---

## Task 3 — Virus → Gray Zone Consolidation

### What was merged
`extension_virus.html` covered "Are Viruses Alive?" — directly overlapping with `extension_gray-zone.html` which already analyzed living/non-living boundary cases. The two pages taught the same conceptual territory from slightly different angles.

The strongest unique content from `extension_virus.html` — the structured 6-characteristic checklist for viruses with pill-based verdicts and explanatory notes — was ported into `extension_gray-zone.html` as:

1. **A new case card** in the `#cases` grid  
   - Icon: 🦠, Name: "A Virus"  
   - Description summarizes the key viral paradox (has DNA, can multiply, but only inside a host)  

2. **A new `<details class="analysis-block">` entry** in the `#analyze` section  
   - Follows the identical HTML structure of the existing Fire, Crystals, Dormant Seed, Mule, and Robot blocks  
   - Contains all six characteristic check-items with accurate pill verdicts:  
     - Made of Cells → `pill-no`  
     - Obtain and Use Energy → `pill-no`  
     - Grow and Develop → `pill-no`  
     - Reproduce → `pill-sometimes` (Only With a Host)  
     - Respond to Stimuli → `pill-sometimes` (Limited Recognition Only)  
     - Maintain Homeostasis → `pill-no`  
   - Analysis verdict emphasizes the genuine scientific debate  

3. **Section title updated**: "Five Things That Break the Rules" → "Six Things That Break the Rules"

### What was not duplicated
The virus extension's `#what-is-virus` structural detail section (capsid anatomy, size comparison, etc.) and the `#mini-quiz` JavaScript quiz were **not** ported. The gray-zone already has its own CER builder and 8-question quiz. Adding a second quiz would create confusion and redundancy. The structural detail belongs more naturally in a lesson page than an extension.

### Index change
Removed the `extension_virus.html` link from the "What Is Life?" unit card in `index.html`. The `extension_gray-zone.html` link remains. `extension_virus.html` itself was **not deleted** — it is archived in the repo per instructions.

### Verification
- Virus case card: present in gray-zone ✓  
- Virus analysis block: present in gray-zone ✓  
- `extension_virus.html` link: removed from index ✓  
- Gray-zone CER and quiz sections: unchanged ✓

---

## Task 4 — Grade-Level Review Notes

*(No edits made — analysis only.)*

### extension_organelles.html — "The Protein Pathway"

**Concepts taught:**  
DNA transcription → mRNA → ribosome → protein translation → endoplasmic reticulum → Golgi apparatus → vesicle → cell membrane. A complete protein synthesis and secretion pathway.

**Approximate grade band:**  
Grade 8–10. Massachusetts 2016 NGSS Life Science standards place molecular genetics (transcription, translation, protein synthesis) in high school LS1.A and LS3.A, not in Grade 6. The Grade 6 standard MS-LS1-1 requires students to understand that cells are the basic structural and functional unit of life — not the molecular mechanism of how proteins are made.

**Is the content appropriate as an optional extension?**  
Yes, with labeling. The content is scientifically accurate and conceptually coherent. As a student-initiated enrichment page for students who want to go further, it has educational value. It should not be treated as a standard Grade 6 deliverable.

**Should it remain available?**  
Yes. Accessible as an extension for advanced students or as a Grade 8 preview. The page should carry a visible "Advanced Extension" or "Goes Beyond Grade 6" label so teachers can self-select appropriately.

**Recommendation:** Light Improve — add a grade-level scope label to the hero badge or as a callout near the section heading. No content changes needed.

---

### extension_neuron-explorer.html — "Neuron Explorer"

**Concepts taught:**  
Neuron anatomy (dendrites, soma, axon, myelin sheath, nodes of Ranvier, synaptic terminals), action potential propagation, synaptic transmission, neurotransmitter release. Signal Mode animates an action potential traveling along the axon.

**Approximate grade band:**  
Grade 8–10, with some elements reaching high school (AP Biology / Grade 9–10). Massachusetts Grade 6 life science touches on body systems (MS-LS1-3) at a systems level — "how body systems interact." Neuron-level anatomy and action potentials are typically introduced in Grade 8 life science units on the nervous system, and covered in depth at the high school level.

**Is the content appropriate as an optional extension?**  
Yes. It connects to the body systems unit and the human nervous system. Students who have completed the body systems lesson may find it genuinely engaging. As an extension (not a required activity), it is appropriate.

**Should it remain available?**  
Yes. Like the Protein Pathway, it belongs in an "Advanced / Going Further" category rather than a standard Grade 6 task. It also needs the CSS bug fix (completed in Task 1) and the nav-links removal (completed in Task 2).

**Recommendation:** Light Improve — add a grade-level scope label. The CSS bug is already fixed.

---

## Task 5 — Top 5 Future Upgrade Candidates

Ranked by expected student impact × effort efficiency (highest-value, achievable-next).

---

### 1. `extension_gray-zone.html` — Light Improve | Effort: Small | Impact: High

**Why selected:** This is now the site's primary "What Is Life?" deep-dive extension after the virus merge. It has the strongest conceptual content on the site (CER builder, 5+1 case analyses, quiz) but still carries Gen 1 visual debt: the hero has excessive top/bottom padding (`6rem 2rem 5rem`), the CSS uses the old `rgba(52,152,219,0.2)` border token, and there is no LS/STEM badge bar. Bringing it to current visual standards would be low-effort and would immediately improve the most-used extension page.

**Suggested micropass prompt focus:** Update hero padding to current standard (~4.5rem top), replace the old border token, add LS/STEM badge bar with appropriate standards tags (MS-LS1-1, Conceptual Change, CER reasoning).

---

### 2. `game_is-it-alive.html` — Light Improve | Effort: Small | Impact: High

**Why selected:** This game has strong pedagogical bones — scenario-based checkbox mechanic with per-item feedback — but no phased structure, no locked progression, and no LS/STEM badge bar. It is the first game linked under the most prominent Life Science unit ("What Is Life?") and is likely a high-traffic entry point for Grade 6 students. Adding a short checkpoint quiz after 5 rounds, an LS badge bar, and updating the border token would give it a significant quality bump for minimal effort.

**Suggested micropass prompt focus:** Add LS/STEM badge bar, add a 3-question quiz gate that appears after round 5, update the old border token to current.

---

### 3. `game_exercise.html` — Light Improve | Effort: Small | Impact: Medium

**Why selected:** Solid concept and clean interaction, but the student experience is entirely passive (select intensity level → watch meters move → answer 3 questions). Adding a prediction step ("Before you set the intensity, guess which system will respond the most") before the intensity select — with feedback comparing the guess to the result — would transform this from an observation activity into a genuine hypothesis-testing experience. The `.nav-center` breadcrumb is also still present and should be removed.

**Suggested micropass prompt focus:** Remove `.nav-center`, add LS/STEM badge bar, add a prediction card above the intensity selector that collects a student guess and scores it after simulation runs.

---

### 4. `extension_body-systems.html` — Light Improve | Effort: Small | Impact: High

**Why selected:** This is the strongest extension on the site by current quality standards — medical mystery cases with sticky progress tracking and case-based clinical reasoning. It only needs: nav-center removal (`.nav-center` CSS is still present even though no HTML renders it), LS/STEM badge bar, and a minor visual alignment pass. High student value page that is almost at current quality already.

**Suggested micropass prompt focus:** Remove `.nav-center` CSS, add LS/STEM badge bar with body systems standards tags (MS-LS1-3). Optionally add a "Go Further" section linking to the relay race game.

---

### 5. `game_cell-explorer.html` — Light Improve | Effort: Small | Impact: Medium

**Why selected:** The SVG-based organelle click mechanic is the most educationally meaningful game interaction on the site. The current implementation is clean and functional, but the Quiz mode tab doesn't enforce prerequisite completion (a student can click Quiz before exploring any organelle and get an empty panel). Adding exploration-gate enforcement, an LS/STEM badge bar, and updating the old border token would make this a Gold Standard game for the organelles unit.

**Suggested micropass prompt focus:** Lock the Quiz mode tab until at least 6 of 8 organelles have been explored. Add LS/STEM badge bar. Update `--border` to current token.

---

## Any Concerns or Manual Review Needed

**1. `game_cellular-showdown.html` — canonical URL mismatch (not fixed in this pass)**  
The `<link rel="canonical">` tag points to `https://lyfelabz.com/game_cell-type-showdown.html` but the actual filename is `game_cellular-showdown.html`. This is an SEO issue. It was not part of this pass scope but should be addressed in Micropass 3 or a dedicated fix.

**2. `extension_virus.html` — still accessible via direct URL**  
The file remains in the repo and is directly accessible at `lyfelabz.com/extension_virus.html`. It is no longer linked from index.html, so it won't appear in student browsing. No further action needed until a deliberate archive/deletion cleanup pass.

**3. Gray Zone CER builder still references only Fire, Crystal, Mule cases**  
The JavaScript CER builder in `extension_gray-zone.html` was not updated to include Virus as a CER case — that would require writing new claim/evidence/reasoning option sets and adding them to the `cerCases` array. This is a worthwhile future enhancement but is a content-writing task, not a cleanup task, and was out of scope for this pass.

**4. `extension_organelles.html` and `extension_neuron-explorer.html` — grade-level labels not yet added**  
Per Task 4 findings, both pages would benefit from a visible "Advanced Extension" label. This is scoped to a future micropass (Micropass 7 in the audit).
