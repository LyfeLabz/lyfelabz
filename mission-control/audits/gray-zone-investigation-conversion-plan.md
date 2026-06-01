# Gray Zone: Investigation Conversion Plan

**Date:** 2026-05-31  
**Current file:** `extension_gray-zone.html`  
**Target type:** Full LyfeLabz Investigation  
**Planning pass only, no files modified**

---

## Current State Assessment

### Educational Value: Strong

The Gray Zone is conceptually the most important Life Science content on LyfeLabz. Before students can understand cells, ecosystems, or evolution, they need a working definition of life; and this page forces them to pressure-test that definition against edge cases. The science is sound, the cases are well-chosen, and the pedagogical move (analyze borderline examples to understand the rule) is the same strategy that biologists actually use.

The content has grown well since the original build. It now includes six cases (Fire, Crystals, Dormant Seed, Mule, Robot, Virus), a full 6-characteristic analysis block per case, a guided CER builder with three cases, and an 8-question quiz. As an extension, it is arguably overbuilt; it has enough content and rigor to anchor an entire class period and drive genuine scientific argument. That overbuilding is exactly why it should be promoted to an Investigation.

### Scientific Accuracy: Accurate

All six cases are scientifically accurate and reflect genuine debate among biologists. The virus analysis (host-dependent replication, no ATP production, genetic material present) is correct. The mule case correctly identifies that meeting five of six characteristics still makes something alive. The CER option sets are well-calibrated, the incorrect options represent real student misconceptions, and the correct answers reflect genuine scientific reasoning. No errors identified.

### Student Engagement: High Potential, Currently Passive

The case cards, analysis blocks, and CER builder are engaging in concept. But the experience is currently passive-scroll: students read a case, click to expand the analysis, read the result. They never record their own verdict before seeing the answer. The CER builder is the only place where students make their own choices; and even there, it is selecting from three options, not constructing reasoning. The quiz is the most active element (click to select, instant feedback), but it has no connection to what students analyzed in the previous sections.

The page has high potential for engagement because the content is genuinely surprising (wait, a mule might not be alive?) and the cases are culturally relevant (viruses, AI). The engagement is not being fully unlocked because there's no student agency in the evidence collection phase.

### Classroom Usability: Moderate

As a standalone extension, the page lacks a "before you begin" scaffolding section. A teacher assigning this today gives students a long scroll experience with no sense of how long it will take or what the goal is. There are no progress indicators, no auto-save, and no submission mechanism. The CER builder provides the best learning structure on the page but is buried at the bottom.

The page can be completed in a class period but the time estimate is unclear to teachers. Estimated 30–45 minutes for the full current experience; target for the investigation should be 45–60 minutes with richer activities.

### Accessibility: Below Current Standard

- The collapsible `<details>` / `<summary>` analysis blocks are semantic HTML and keyboard-accessible.
- Color contrast is adequate for most elements.
- No ARIA live regions for feedback messages, screen readers won't announce CER feedback without them.
- The CER builder buttons have no focus-visible styling aligned with the current site standard.
- Floating emoji decorations in the hero have no `aria-hidden="true"`.
- No LS/STEM badge bar (the teacher-facing overlay present on all investigation pages).

### Technical Quality: Functional but Aged

- CSS uses the old variable system (`--dark`, `--dark2`, `--card`, `--text`, `--border: rgba(52,152,219,0.2)`), not the current investigation system (`--bg-primary`, `--bg-secondary`, `--bg-card`, `--text-primary`, `--border`).
- Hero padding is `6rem 2rem 5rem`, significantly taller than the current investigation hero (~4.1rem 2rem 3.35rem). Creates excessive whitespace on load.
- JavaScript is clean and well-organized. The CER builder is modular and well-commented.
- No localStorage state persistence, every page refresh loses all CER and quiz progress.
- No phase reveal animations, no unlock hint system, no restore banner.
- The quiz `progress-fill` gradient uses `var(--yellow), var(--orange)`, should become investigation blue after conversion.

### Visual Quality: Functional, One Generation Behind

The yellow/gold color palette is thematically intentional (yellow = "gray zone" / caution / ambiguity) but it predates the investigation color system (blue = Investigation). After conversion, the blue investigation palette should become the primary accent, with yellow reserved for the gold standard/verdict elements where it already appears. The hero is substantially taller than current pages and the section padding (`padding: 5rem 2rem`) is heavier than the current `2.25rem` bottom-margin section style.

### Alignment to Current LyfeLabz Standards: Partial

| Standard | Current Status |
|---|---|
| Nav with LS/STEM toggle | ✗ Missing |
| LS/STEM badge bar | ✗ Missing |
| Phase-based progress system | ✗ Missing |
| "Before You Begin" section | ✗ Missing |
| Unlock/gate system | Partial (CER builder gates C→E→R within each case, but no inter-section gates) |
| Scientific Notebook / data recording | ✗ Missing |
| Checkpoint questions with unlock | ✗ Missing |
| Classroom submission panel | ✗ Missing |
| LocalStorage state persistence | ✗ Missing |
| Restore banner | ✗ Missing |
| Investigation blue palette | ✗ Using yellow/gold |
| Go Further section | ✗ Missing |
| `--bg-primary` / current CSS variable system | ✗ Using old system |

---

## Investigation Alignment Analysis

### Elements That Already Function Like an Investigation

**Evidence gathering:** The six analysis blocks with 6-characteristic checklists and pill verdicts constitute genuine evidence collection. Students encounter structured evidence about each case.

**Scientific reasoning:** The CER builder is the strongest investigation-quality element on the page. Sequential C→E→R gating, three cases, well-calibrated option sets, and meaningful feedback ("explains WHY the evidence supports the claim") match the scientific argument construction standard.

**Classification challenge:** Each case implicitly asks students to classify, Alive / Not Alive / Gray Zone. This is a core scientific practice (categorization based on criteria).

**Argument from evidence:** The CER builder's best-option mechanic forces students to distinguish between good and weak reasoning, not just correct and incorrect facts.

**Decision making:** The quiz requires applying the characteristics framework to new scenarios, testing transfer of understanding.

### Missing Investigation Components

**Investigation question:** The page has no single driving scientific question stated at the top. Current investigations frame the question explicitly in the hero ("How does amplitude affect energy?" / "Where does a cell get its energy?"). Gray Zone needs: *"Where is the line between living and non-living, and does that line always exist?"*

**Student-generated predictions:** Students never make their own predictions before seeing the analysis. They read the pre-authored checklist items. A real investigation requires the student to form a hypothesis first.

**Student-recorded evidence:** Students don't write or select anything during the analysis phase, they only read. A Scientific Notebook or evidence-recording step is entirely absent.

**Phase-based structure with gating:** The page is a linear scroll. Students can scroll past the analysis to the quiz without engaging with any evidence. There are no gates between the major sections.

**Progress tracking:** No horizontal phase indicator, no visual indication of how far through the investigation students are.

**"Before You Begin" section:** No context-setting intro that explains what the investigation is, what students will do, and how to move through it.

**Checkpoint questions:** No end-of-phase comprehension check that must be answered correctly before the next phase unlocks.

**Persistence:** No localStorage saving. Starting over on page refresh is a classroom disaster.

**Classroom submission:** No submission panel for teachers to collect student verdicts/notebooks.

**Go Further section:** No links to related content at the end.

---

## Proposed Investigation Flow

The Gray Zone investigation is naturally a **classification investigation**, students collect evidence to classify edge cases as alive, not alive, or genuinely ambiguous. The flow should make this explicit and provide a notebook for recording evidence as they go.

### Proposed Five-Phase Structure

---

**BEFORE YOU BEGIN** (always visible, not gated)

A "byb-wrap" section with four Q&A cards:
- *What is this investigation about?*, You're going to test the six characteristics of life against six real cases. Some answers are clear. Some aren't. That's the point.
- *What is the gray zone?*, The gray zone is where the rule doesn't give a clean answer. Scientists call these "edge cases" and they reveal where a definition breaks down.
- *What will I actually do?*, Read the characteristics → Make predictions → Collect evidence → Build arguments → Reach a final verdict.
- *How do I move through it?*, Each phase unlocks after you complete the one before it. Answer the checkpoint question to advance.

---

**Phase 1: Criteria Discovery**: "The Six Rules of Life"

**Goal:** Students understand the 6 characteristics before applying them.

**Activity:** Six criteria cards (one per characteristic), each with:
- The characteristic name
- A one-sentence definition
- A concrete real-world example ("A bacteria divides in two to reproduce → Reproduction ✓")
- An emoji icon

Students click "Mark as read" on each card (or a simpler engagement gate, all six must be viewed before advancing).

**Checkpoint question (blocks Phase 2 unlock):**  
*"A campfire consumes oxygen, releases energy, and spreads to new material. Which characteristic does this seem to meet; and why does 'meeting one characteristic' not make something alive?"*  
Correct answer: Energy / Obtain and Use Energy. Reasoning: To be classified as alive, an organism must meet all six characteristics independently, not just one.

**Unlock hint:** "Review all six characteristics and answer the checkpoint to unlock Case Analysis."

---

**Phase 2: Case Preview, "Meet the Gray Zone"**

**Goal:** Students encounter each case and record an initial prediction before analysis.

**Activity:** The 6 case cards, restructured:
- Each card shows: icon, name, brief description (current content preserved)
- Below each card description: a "First Impression" prompt with three radio-button options:
  - "I think this IS alive"
  - "I think this is NOT alive"
  - "I think this is a Gray Zone case, scientists could argue either way"
- Selection is required for each case before the "Advance to Analysis" button activates.

**Notebook entry:** Each prediction is saved to localStorage and shown in the Scientific Notebook summary at the end.

**Gate:** All 6 predictions recorded → unlocks Phase 3.

**Unlock hint:** "Record your first impression for all six cases to unlock Evidence Collection."

---

**Phase 3: Evidence Collection, "Run the Checklist"**

**Goal:** Students analyze each case against the 6 characteristics and record their own verdict.

**Activity:** The existing 6 collapsible analysis blocks, restructured:
- Each case opens to show the 6 characteristic check-items (existing content preserved).
- Before the authored pill-verdict appears, students see **their own verdict input**: three radio buttons per characteristic: Meets / Does Not Meet / Partially Meets.
- After selecting, the authored verdict reveals with a brief explanation (the existing check-note content).
- A per-case verdict selector at the bottom: "Based on your evidence: Alive / Not Alive / Gray Zone."
- Verdict is saved to notebook.

**Gate:** All 6 cases must be opened and a final verdict selected → unlocks Phase 4.

**Unlock hint:** "Open all six cases, collect the evidence, and record your verdict to unlock Argument Construction."

---

**Phase 4: Argument Construction, "Build Your Case"**

**Goal:** Students construct scientific arguments for the most contested cases.

**Activity:** The existing CER builder, expanded:
- Current three cases (Fire, Mule, Robot), preserved as-is.
- **Add a fourth case: Virus**: "Argue: A virus IS in the gray zone (not clearly alive, not clearly dead)." This is the most intellectually honest position on viruses and the one most aligned with the scientific community.
- Gate within this phase: CER cases are unlocked sequentially (Fire → Mule → Robot → Virus). This matches the existing C→E→R gating within each case.

**Gate:** All four CER arguments completed → unlocks Phase 5.

**Checkpoint question (blocks Phase 5 unlock):**  
*"You argued that Fire is NOT alive. A classmate says: 'But fire grows and uses energy, doesn't that count?' What is the most scientific way to respond?"*  
Correct: Fire needs to meet all six characteristics independently. Meeting two (partially) doesn't qualify as life.

**Unlock hint:** "Complete all four CER arguments and answer the checkpoint to unlock your Final Verdict."

---

**Phase 5: Final Verdict + Quiz, "Your Scientific Position"**

**Goal:** Students synthesize all evidence into a final classification and demonstrate transfer.

**Activity (two parts):**

**Part A, Classification Table:**  
A 6-case summary table appears. For each case, students see:
- Their Phase 2 prediction
- Their Phase 3 verdict
- Key evidence they marked
- A final classification dropdown: Alive / Not Alive / Gray Zone

This is the Scientific Notebook made visible. Students can revise their Phase 2 prediction if the analysis changed their thinking.

**Part B, The Quiz (existing 8 questions, moved here):**  
The existing quiz becomes the final comprehension check, now contextually connected ("Now apply what you learned to these new scenarios").

**Classroom Submission:**  
After completing the quiz, the classroom submission panel becomes available. Students can optionally enter their name and class code and submit their notebook to their teacher.

**Completion:**  
Score board + congratulations message + Go Further links.

---

## Gating Opportunities

### Gate 1: After Phase 1 Criteria Discovery Checkpoint
**Placement:** Between Phase 1 (characteristics overview) and Phase 2 (case preview).  
**Mechanism:** Single multiple-choice question, must be answered correctly to proceed.  
**Why it improves learning:** If students analyze cases before understanding the criteria, they're applying a rule they don't know. The gate ensures they have the framework before encountering the edge cases. Without this, students tend to use intuition ("fire doesn't feel alive") rather than evidence ("fire does not meet Made of Cells").

### Gate 2: After Phase 2 Case Preview (Prediction Collection)
**Placement:** Between Phase 2 and Phase 3.  
**Mechanism:** All 6 prediction inputs must be completed. No quiz, just engagement.  
**Why it improves learning:** Making a prediction before seeing evidence is the core scientific habit of mind. The gate is intentionally low-stakes (no wrong answer for a prediction), but it forces students to commit to a position before the evidence phase. This creates cognitive engagement, the student is invested in whether their prediction was right.

### Gate 3: After Phase 3 Evidence Collection
**Placement:** Between Phase 3 and Phase 4 (CER builder).  
**Mechanism:** All 6 analysis blocks must be opened and a final verdict selected for each case.  
**Why it improves learning:** The CER builder produces stronger arguments when students have already processed the evidence. Without this gate, a student can scroll directly to the CER section and guess at options without grounding in the analysis. The gate ensures the argument they build is informed by evidence they actually collected.

### Gate 4: After Phase 4 CER Completion + Checkpoint
**Placement:** Between Phase 4 and Phase 5 (final verdict + quiz).  
**Mechanism:** All four CER arguments completed + checkpoint question answered correctly.  
**Why it improves learning:** The final classification and quiz are synthesis activities. They should only be attempted after students have practiced constructing evidence-based arguments. The checkpoint specifically tests whether students can distinguish between meeting one characteristic and meeting all six, the most common misconception throughout the investigation.

---

## Scientific Notebook Design

The Notebook is a localStorage-backed data structure that persists throughout the investigation and becomes visible in Phase 5.

### What students record:

**Phase 2, First Impressions (per case):**
- Initial classification: Alive / Not Alive / Gray Zone
- Timestamp (optional, for teacher visibility)

**Phase 3, Evidence Collection (per case, per characteristic):**
- Student verdict per characteristic: Meets / Does Not Meet / Partially Meets
- Final case verdict: Alive / Not Alive / Gray Zone

**Phase 4, Argument Record (per CER case):**
- Selected Claim (letter)
- Selected Evidence (letter)
- Selected Reasoning (letter)
- Whether each was correct on first try

**Phase 5, Final Classification (per case):**
- Revised verdict (if changed from Phase 3)
- Whether prediction changed from Phase 2 ("My thinking changed because...")

### What should appear in the Phase 5 summary:

A table with six rows (one per case):

| Case | First Impression | Evidence Verdict | CER Completed | Final Verdict | Changed Mind? |
|---|---|---|---|---|---|
| 🔥 Fire | Not Alive | Not Alive | ✓ | Not Alive |, |
| 🔮 Crystals | Not Alive | Not Alive |, | Not Alive |, |
| 🌱 Dormant Seed | Gray Zone | Alive |, | Alive | ✓ |
| 🐴 Mule | Alive | Alive | ✓ | Alive |, |
| 🤖 Robot | Not Alive | Not Alive | ✓ | Not Alive |, |
| 🦠 Virus | Gray Zone | Gray Zone | ✓ | Gray Zone |, |

The "Changed Mind?" column is pedagogically valuable; it shows students where new evidence changed their thinking, which is the core learning outcome.

---

## Teacher Experience

### Estimated completion time
- **Independent work:** 45–60 minutes for a full run through all five phases.
- **Whole-class facilitated:** 30–35 minutes if the teacher leads Phases 1–2 as a class discussion and assigns Phases 3–5 independently.
- **Split session:** Phases 1–3 (25–30 min, Day 1) + Phases 4–5 (20–25 min, Day 2) works well for 45-minute periods.

### Whole-class vs. independent
**Best as: Independent investigation with whole-class debrief.**  
The Phase 2 predictions and Phase 3 evidence collection are most valuable when students commit to positions individually. A whole-class vote on Phase 5 final verdicts, projected on screen, makes an excellent debrief activity. Teacher projects the classification table; class discusses cases where students disagreed.

**Classroom protocol:** Assign after the "What Is Life?" lesson. Students complete independently with laptops/tablets. Reserve 10 minutes at the end for the debrief vote.

### Placement within the Life Science unit
**Optimal placement:** After `lesson_what-is-life.html`, before moving to `game_is-it-alive.html`.

Current unit sequence suggestion:
1. Lesson: What Is Life? (introduces the 6 characteristics)
2. **Investigation: The Gray Zone** (applies and stress-tests the characteristics)
3. Game: Is It Alive? (rapid-fire reinforcement)
4. Game: Cellular Showdown (bridges to cell types)

The Gray Zone investigation currently sits after the Is It Alive? game as an optional extension. Moving it before the game, as the investigation that deepens the lesson, would be a stronger learning sequence.

### Relevant Massachusetts Grade 6 Standards
- **MS-LS1-1:** Conduct an investigation to provide evidence that living things are made of cells; either one cell or many different numbers and types of cells. *The Gray Zone directly addresses the boundary conditions of this standard, what counts as a "living thing."*
- **Science and Engineering Practice 6:** Constructing Explanations and Designing Solutions. *The CER builder is a direct implementation of this practice.*
- **Science and Engineering Practice 7:** Engaging in Argument from Evidence. *The entire investigation is structured around argument from evidence.*
- **Crosscutting Concept: Patterns.** *Students identify patterns in which characteristics edge cases do and don't meet.*

---

## Visual Modernization

### Hero redesign
- **Reduce padding** from `6rem 2rem 5rem` to current investigation standard (`4.1rem 2rem 3.35rem`).
- **Replace background** from `linear-gradient(135deg, #0d1f2d, #1a3a4a, #0f2535)` with the investigation hero pattern: multiple radial gradients using investigation blue (`rgba(59,130,246,...)`) + a neutral dark base.
- **Replace hero badge** from gold/yellow to investigation blue (`#3B82F6`), styled as an Investigation badge (not Extension).
- **Replace h1 gradient** endpoint from `var(--yellow)` to `#BFDBFE` (light blue).
- **Hero kicker line** should read: "Life Science Investigation · 45 min · 5 Phases"
- **Remove `.hero-btns`** (the "Start Investigating" / "Learn More" buttons are not in the investigation pattern; the phase system handles navigation).

### Investigation color usage
- **Primary accent:** `#3B82F6` (investigation blue) replaces yellow/gold as the page accent.
- **Gold/yellow:** Preserved for the `analysis-verdict` highlight color and the `verdict-label` eyebrow (where it currently works well as a "caution/complexity" signal).
- **CSS variables:** Migrate from old token set to current investigation system: `--bg-primary`, `--bg-secondary`, `--bg-card`, `--bg-card-hover`, `--border`, `--border-light`, `--text-primary`, `--text-secondary`, `--text-muted`.
- **Border token:** Replace `rgba(52,152,219,0.2)` with the current investigation border value.

### Progress system
- A horizontal `progress-steps` bar below the `byb-wrap`, styled identically to the existing investigation pages.
- Five labeled steps: `① Criteria` / `② Cases` / `③ Evidence` / `④ Arguments` / `⑤ Verdict`.
- Active step: blue highlight. Completed step: green with shimmer animation. Future steps: muted.
- JavaScript toggles steps as phases unlock.

### Badge system
- LS/STEM badge bar below nav (standard investigation pattern).
- **STEM badges:** MS-LS1-1, SEP 6 (Constructing Explanations), SEP 7 (Argument from Evidence)
- **LS badges:** Conceptual Change (Posner et al.), Productive Struggle, Formative Assessment

### Completion system
- Phase unlock revealed with `phaseReveal` animation (translateY + opacity, 0.65s).
- Step indicator flashes green on completion (`stepDoneFlash` keyframe, matching existing investigation pages).
- Final Phase 5 score board: keeps the existing `score-board` with animated `big-score`, updated to investigation styling.
- After quiz completion: classroom submission panel becomes available.

---

## Recommended Conversion Scope

**Classification: Large**

This is not a light style refresh. It requires rebuilding the investigation architecture (phase system, gating, notebook, persistence), adding student agency to the analysis phase, and migrating the CSS system. The educational content itself (cases, analysis blocks, CER arguments) is strong and mostly preserved; but the structural scaffolding around it needs to be rebuilt from the ground up to match the investigation standard.

| Dimension | Rating | Notes |
|---|---|---|
| Educational impact | High | Moves from a passive scroll experience to a complete structured inquiry |
| Student engagement impact | High | Student predictions + evidence recording + gating creates genuine investment |
| Development effort | Significant | ~10 discrete micropasses; no single pass is trivial |

The risk is low (content is proven, the audience knows what an investigation is) but the effort is real. This is best treated as a flagship build, not a quick upgrade.

---

## Suggested Micropasses

Each pass is a bounded Claude Code task that can be implemented independently.

---

**Micropass 1, CSS System Migration**  
*Effort: Medium | Risk: Low*  
Migrate all CSS variables from the old token set (`--dark`, `--dark2`, `--card`, `--text`, `--text-muted`, `--border: rgba(52,152,219,0.2)`) to the current investigation system (`--bg-primary`, `--bg-secondary`, `--bg-card`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`). Copy the full `:root` block from `investigation_cell-energy.html` as the source of truth. Replace every CSS property reference to old variables. Verify no visual regressions in the existing sections.

---

**Micropass 2, Hero + Nav Modernization**  
*Effort: Small | Risk: Low*  
- Reduce hero padding to investigation standard.
- Replace hero background with investigation blue radial gradient pattern.
- Replace hero badge from yellow/gold to blue Investigation badge.
- Update h1 gradient endpoint to light blue.
- Remove `.hero-btns` section and the two hero CTA buttons.
- Add nav toggles (LS/STEM) to the `<nav>`.
- Add `<div class="badge-bar stem-bar">` and `<div class="badge-bar ls-bar">` with relevant STEM/LS tags.
- Add `#stars` canvas and sessionStorage toggle script.
- Update page `<title>` and `<meta name="description">`.

---

**Micropass 3, Before You Begin + Progress System**  
*Effort: Medium | Risk: Low*  
- Insert `<div class="byb-wrap">` section with four Q&A cards (what the investigation is, what the gray zone is, what students will do, how to advance).
- Insert `<div class="progress-steps">` with five labeled step indicators: ① Criteria / ② Cases / ③ Evidence / ④ Arguments / ⑤ Verdict.
- Wire up a basic JS state manager (`gzState`) that tracks which phase is active and updates step indicator classes.
- Add `phaseReveal` and `stepDoneFlash` keyframe animations.
- Add `restore-banner` element and localStorage check.

---

**Micropass 4, Phase 1: Criteria Discovery + Checkpoint Gate**  
*Effort: Medium | Risk: Low*  
- Replace the existing cases section intro with a Phase 1 section.
- Implement six criteria cards (one per characteristic) with icon, name, definition, and example. Use the `evidence-card` click-to-select pattern from `investigation_cell-energy.html`.
- Add a "Mark as read" toggle on each card.
- Wire: all six cards marked → checkpoint question appears.
- Implement checkpoint card with one question. Correct answer → Phase 2 unlocks (animated reveal).
- Save Phase 1 complete status to `gzState` and localStorage.

---

**Micropass 5, Phase 2: Case Preview with Student Predictions**  
*Effort: Medium | Risk: Low*  
- Convert the existing case-card grid into Phase 2.
- Add a "First Impression" radio group (Alive / Not Alive / Gray Zone) below each case description.
- Track which cases have received a prediction in `gzState`.
- Enable "Advance to Evidence" button only when all 6 predictions are recorded.
- Advance button → Phase 3 unlocks (animated reveal).
- Save predictions to localStorage under `gzState.predictions`.

---

**Micropass 6, Phase 3: Evidence Collection with Student Verdict Recording**  
*Effort: Large | Risk: Medium*  
- Convert the existing six `<details>` analysis blocks into Phase 3.
- For each characteristic within each case, add a three-option student verdict input (Meets / Does Not Meet / Partially Meets) that appears *before* the authored verdict pill reveals.
- After selection, reveal the authored verdict and check-note.
- Add a per-case verdict selector at the bottom: Alive / Not Alive / Gray Zone.
- Track all 6 case verdicts in `gzState.verdicts`.
- Enable "Advance to Arguments" button when all 6 cases have a final verdict.
- Save verdicts to localStorage.

---

**Micropass 7, Phase 4: CER Builder Expansion + Checkpoint Gate**  
*Effort: Medium | Risk: Low*  
- Keep existing three CER cases (Fire, Mule, Robot) unchanged.
- Add a fourth CER case: Virus, "Argue: A virus occupies the gray zone, it is neither clearly alive nor clearly dead." Write three option sets (Claim / Evidence / Reasoning) with the correct options and feedback.
- Wire sequential case unlocking (Fire complete → Mule unlocks → Robot unlocks → Virus unlocks).
- After all four CER cases are complete, the Phase 4 checkpoint question appears.
- Checkpoint correct → Phase 5 unlocks.
- Save CER completion state to `gzState.cerDone` and localStorage.

---

**Micropass 8, Scientific Notebook + Phase 5 Classification Table**  
*Effort: Large | Risk: Medium*  
- Implement Phase 5 as two-part section.
- Part A: Render a 6-row Notebook summary table pulling from `gzState.predictions`, `gzState.verdicts`, and `gzState.cerDone`. Each row shows: case icon + name, Phase 2 prediction, Phase 3 verdict, CER completed (✓ or -), final classification dropdown (editable), "Changed mind?" indicator.
- Part B: Move the existing 8-question quiz into Phase 5 below the notebook table. Relabel as "Apply Your Understanding."
- Show existing `score-board` after quiz completion.

---

**Micropass 9, Classroom Submission Panel**  
*Effort: Medium | Risk: Low*  
- Add the classroom submission panel (matching `investigation_amplitude-challenge.html` pattern) below the quiz.
- Panel includes: student name, class period, class code, submit button.
- Submit button is locked until quiz is completed.
- On submit: POST to the existing Amplitude/Cell Energy form endpoint (or configure a new endpoint for Gray Zone data).
- Show `submit-success` or `submit-error` banner based on response.

---

**Micropass 10, File Rename + Index Update + Go Further Section**  
*Effort: Small | Risk: Low*  
- Rename `extension_gray-zone.html` → `investigation_gray-zone.html`.
- Update `index.html`: change the link `href`, change the class from `ulink ext` to `ulink inv`, update the link text if needed.
- Update `<link rel="canonical">` in the file header.
- Add a "Go Further" section at the bottom of the investigation (before the classroom panel) with cards linking to: `game_is-it-alive.html`, `lesson_what-is-life.html`, and potentially a future prions/edge-cases deep dive.
- Update the investigation's `lesson_characteristics.html` nav-back link to point back to the correct unit page.
