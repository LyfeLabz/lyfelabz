# Photon Runner — Classroom Readiness Audit

**Subject:** `game_energy-escape.html` (Energy Escape: Photon Runner, post-MP9)
**Audit lens:** Grade 6 classroom deployment, MS-PS4-2 alignment
**Posture:** Read-only audit. No code changes were made.

---

## Executive Summary

**Overall readiness rating: 8 / 10**

Energy Escape is a tight, single-file learning game that, after nine micropasses, sits very close to classroom-ready. The Predict → Test → Compare → Reflect loop introduced in Micropass 9 turns Level 2 into an authentic mini-investigation, and the Lab Notes export gives teachers a real formative-assessment artifact. The core science model (reflection / absorption / transmission and the mixed-ratio idea) is sound, consistently reinforced, and visually legible.

The remaining gaps are not science gaps. They are classroom-context gaps: clarity of the Level 1 win condition, pause behavior that assumes a keyboard, touch-device unplayability, a handful of friction points in the end-of-run flow, and a side panel that asks a Grade 6 student to track too much UI in parallel. None of these require new mechanics to fix.

---

## Strengths

**Pedagogical**

- **The Energy Result panel does its job.** Reflection / Absorption / Transmission bars are visible at all times, color-coded consistently with the lesson page, and respond instantly to every interaction. Students see, not just hear, the conservation idea.
- **Mixed materials are credited honestly.** Every mixed-bubble hit credits the full R / A / T ratio amounts to the energy bars regardless of the visible per-shot outcome. This preserves the science while keeping gameplay dynamic — a rare and good design choice.
- **The Last Interaction card (MP7) was the right call.** It survives longer than the toast, so a teacher walking the room can see what the student just did and ask a follow-up question without having to re-engineer the moment.
- **Level 2 is a real investigation.** Four named real-world materials with plausible ratios (Clear Water, Brick Wall, Polished Metal, Smoked Glass) + a structured prediction step + a tracker that records prediction vs. result is genuine science-practice scaffolding, not just gamified content.
- **Lab Notes export is teacher-grade.** Per-material ratios, prediction, result, accuracy, and cumulative interaction counts. This is usable as exit-ticket evidence with no additional teacher prep.

**Craft**

- Clean LyfeLabz visual language carried throughout. Color tokens for reflect / absorb / transmit are used uniformly across HUD, bubbles, panel, banners.
- Game feel is genuinely good: muzzle flash, screen shake on overload, distinct sound envelopes per material, mute persistence across sessions.
- Single-file architecture remains readable at 2937 lines because sections are clearly bannered.

---

## Risks

### High

1. **Level 1 mission text understates the win condition.** The Mission Goal banner on the final tutorial stage says "score 220 and overload both opaque bubbles," but the HUD card directly above says only "Bubbles Cleared 0 / 2." A student watching the HUD may believe they only need to overload the opaques, then be confused when the win doesn't fire at 2 / 2. The HUD card does not surface the score requirement at the same visual altitude.
2. **Pause is keyboard-only.** The pause overlay says "Press P to resume." On a Chromebook this is fine; on an iPad or a touch-only device the student is soft-locked. There is no visible click target to resume.
3. **Touch devices are effectively unplayable.** Movement and fire are bound to WASD / Arrows / Space. On an iPad without a keyboard, the student cannot move or fire at all. The Mute and Replay buttons work; the game itself does not.
4. **Reflective ricochet can soft-fail a focused student.** Shields-Down is a real fail state and is triggered exclusively by the student's own reflected beams. A careful, methodical Grade 6 student standing still to read a bubble label can be killed by a returning shot. The lose screen is informative but does not name "reflective bubble" as the cause.
5. **Lab Notes only exports at end-of-run.** A student who runs out of time at the bell, or who never reaches the win condition, cannot hand the teacher their evidence. The "Copy Lab Notes" button is gated to the end overlay.

### Medium

6. **The Skip Tutorial button is available immediately, with no friction.** A student in a hurry can click Skip on the start screen before reading a single material caption. Skip is positioned in the same row as the goal banner and uses a soft styling that doesn't quite read as "for teachers / advanced students."
7. **Replay restarts at Level 1, never at Level 2.** The button on the Level 2 end screen reads "Replay Level," but it resets to the Level 1 Training Corridor. A student who wants to retry Level 2 (e.g., to improve prediction accuracy) must replay the entire tutorial first. There is no way to re-enter Level 2 directly.
8. **Side-panel cognitive load is at the ceiling.** Energy Result + Last Interaction + Mission Progress (or Materials Tested) + Interaction Data + Mixed Materials card + Material Legend = 5 to 6 simultaneous panes. A Grade 6 student in a busy room cannot triage which one to look at. Energy Result and Last Interaction are the protagonists; the rest are reference.
9. **Discovery and prediction banners share one DOM element and can stomp each other under rare timing.** When the 4th mixed material is tested, a Prediction-Result banner shows for ~2.4 s, then `setTimeout(1.8 s)` fires `winLevel2()` which shows the end overlay. The banner can briefly visually collide with the overlay edge. Minor cosmetic risk.
10. **Lab Notes always include a Material Lab Results section, even if the student never reached Level 2.** On a Level 1 loss the export shows `[ ] Clear Water`, `[ ] Brick Wall`, etc. and `0 / 4`. This is accurate but may look like the student "failed" four extra things they were never shown.
11. **Translucent visual distinction is improved (MP7) but the science narration is thin.** The Last Interaction line for translucent is "Light passed through but spread out." A Grade 6 student may not connect "spread out" with the word "scattering," which is the actual vocabulary in MS-PS4-2 supporting materials.

### Low

12. **No Escape-to-close on overlays.** Start, end, transition, and prediction overlays cannot be dismissed with Esc. Not strictly necessary; just a keyboard polish gap.
13. **No focus rings on buttons.** Tab-navigation users (and any accessibility-needs students) cannot see what is focused.
14. **Prediction buttons have no number-key shortcuts.** A student who has internalized the loop would benefit from 1/2/3 for Reflect/Absorb/Transmit. Not required.
15. **Mute state is persisted via localStorage with no UI hint.** A student who muted in a previous session will boot silent today and may not realize the icon shows that.
16. **The backwards-compat `winGame()` shim is dead code.** Harmless but worth flagging in the next housekeeping pass.
17. **No visible per-run timestamp in Lab Notes.** A teacher collecting 28 students' notes has no built-in way to disambiguate identical text blobs.

---

## Recommended Fixes

### High Priority

- **Surface the score requirement in the HUD on Level 1.** Either rename the "Bubbles Cleared" card to include a score sub-line, or add a second progress bar to the existing Mission Progress card to give score parity with opaque-overload progress. Same data, more visible.
- **Make the pause overlay click-/tap-dismissible.** Treat the entire overlay as a resume target, or add a Resume button.
- **Disclose touch-device support explicitly on the start overlay.** A line like "Requires a keyboard." Until on-screen controls exist, students attempting this on an iPad need to know up front rather than fail silently.
- **Mid-run Lab Notes export.** Add a Copy Lab Notes button to the always-visible HUD area (not the end overlay), so a teacher walking the room or a student running out of time can capture evidence at any moment. No new logic — same `buildLabNotes()` already exists.
- **On the lose screen, name the cause.** A one-line addition like "Your reflected beams damaged your shields. Try angling away from reflective bubbles." converts a soft-fail into a teachable moment.

### Medium Priority

- **Soften the Skip Tutorial affordance.** Move it to the start overlay (not the always-visible Mission Goal banner) or require a long-press / confirm. Reserve Skip for repeat players.
- **Replay Level 2 directly.** Either rename the end-screen button to "Replay Investigation" and route it to `enterLevel2()` (preserving Level 1 win as a one-time event), or add a second button: "Replay Level 1" / "Replay Material Lab."
- **Collapse the Interaction Data + Mixed Materials reference cards by default.** Surface them behind a "Show data" disclosure. They are useful for the Lab Notes export but they compete with the Energy Result and Last Interaction cards, which are the actual protagonists.
- **Update the translucent science line to use the word "scattered" or "scattering."** A single vocabulary swap brings the in-game narration in line with NGSS-aligned classroom vocabulary.
- **Gate the Material Lab section in Lab Notes on actually having reached Level 2.** If `state.level === 1` and student lost, omit the section. If they reached Level 2 but didn't complete, include it with the partial count.

### Low Priority

- **Add a brief timestamp to Lab Notes** (date/time at top). One line; no new feature surface.
- **Add focus styles** to all `.btn`, `.skip-tut`, `.mute-pill` selectors for keyboard navigation.
- **Esc closes the pause overlay** (mirror of P).
- **1 / 2 / 3 keyboard shortcuts** on the prediction overlay buttons.
- **Remove the `winGame()` shim** during the next housekeeping pass.
- **Cap the prediction-result banner duration** to be shorter than the win delay (e.g., 1.4 s banner vs. 1.8 s setTimeout) to avoid the visual collision on the 4th test.

---

## Detailed Findings by Lens

### 1. UX & Flow

- **Path is mostly linear and recoverable.** Start → Tutorial (4 stages) → Mission (Level 1) → Transition → Level 2 (4 predictions) → Investigation Complete. There are no dead ends; Replay always returns to a known state.
- **Friction at Level 1 win condition** (see High #1). The score gate is real but invisible.
- **Discovery moment for mixed materials is clean in Level 1** — first mixed hit triggers "NEW DISCOVERY" banner. Well-timed.
- **Prediction moments feel natural** for Clear Water and Brick Wall (ship proximity triggers them organically when the player approaches). For Polished Metal and Smoked Glass, the trigger fires on shot-proximity instead, which can feel a tiny bit abrupt — the prediction overlay snaps up just as the shot is closing. This is necessary because the player-zone wall prevents the ship from reaching those bubbles, but it does create a small UX asymmetry the player may notice.
- **End-of-run is satisfying** for a win; the Investigation Summary plus the Mixed Materials Takeaway lands the central science idea. For a loss, the screen is less rewarding — the student exits without the takeaway.
- **No unnecessary clicks.** Launch → Skip (optional) → Enter Material Lab → 4 predictions → done. Five intentional clicks plus four predictions.

### 2. Teacher Readiness

- **Under-2-minute intro is achievable.** A teacher can demo Level 1 in 60-90 seconds. The Mission Goal banner does most of the explanation.
- **Independent play is achievable** with one caveat: students will need help interpreting the difference between "Reflected %" on the Energy Result bar and the per-material "Mostly Reflected" outcome label. These are two distinct concepts (cumulative vs. categorical) using the same vocabulary.
- **Evidence collection is real and usable.** Lab Notes export is rich, structured, and copy-pasteable. With the timestamp recommendation above it becomes durable across a class set.
- **Connection to MS-PS4-2 is clean and direct** (see Standards section).
- **Gap:** there is no teacher-facing material (one-pager, Lessons-style intro) inside the game. A separate doc, possibly already in `docs/`, would close this — but that is out of scope for this audit and respects the "no new features" constraint.

### 3. Standards Alignment — MS-PS4-2

> "Develop and use a model to describe that waves are reflected, absorbed, or transmitted through various materials."

| Practice | Coverage |
|---|---|
| Observe reflection | Strong — reflective bubbles, mixed-material reflect outcome, beam color change, audio cue. |
| Observe absorption | Strong — opaque bubbles charge visibly, overload, with "Stored energy released - mostly as heat" caption (MP7). |
| Observe transmission | Strong — transparent and translucent, plus mixed-material transmit. |
| Compare materials | Strong — Level 2 Material Lab is purpose-built for this. |
| Use evidence | Strong — Energy Result, Interaction Data, Lab Notes. |
| Make predictions | Strong — Level 2 prediction overlay (MP9). |
| Evaluate predictions using data | Strong — Result banner, tracker ✓/✗ marks, Prediction Accuracy in Investigation Summary. |

**Weak area:** the game does not explicitly use the word *wave* in gameplay copy. It uses "light energy" and "beam" and "pulse." This is age-appropriate, but a Grade 6 student preparing for an MS-PS4 assessment should at least encounter the word once. The lesson page presumably bridges this; verify before deployment.

**Weak area:** scattering is shown but not named. (See translucent vocabulary fix above.)

### 4. Accessibility

- **Color contrast:** mostly passes WCAG AA against the dark background. The muted text color (`--text-muted: #8aafca`) on `--dark` is right at the borderline; check before deployment with one of the WCAG tools.
- **Font sizes:** the root is 18 px, but several panel elements use 0.7-0.78 rem (12.6-14 px). Tracker sublines (Prediction / Result) are at 0.7 rem — borderline for students with low vision.
- **Button sizes:** prediction buttons are ~36-40 px tall. Above the 24 px WCAG minimum, below the 44 px iOS recommended touch target. Will frustrate trackpad / touch users.
- **Keyboard support:** movement and fire and pause work. No focus rings, no Esc, no Tab navigation hints.
- **Cognitive load:** see Risk #8.
- **Audio:** all sound effects are short, low-volume (master at 0.35), envelope-shaped to avoid harshness. Mute toggle persists. Good.
- **Color-only signaling:** the reflected-shot particle trail uses pink while the unreflected trail uses yellow. The shot itself also changes color (teal vs. yellow). The color shift is paired with a small visual change (teal glow halo) but not with a shape or label change. A red-green color-blind student will likely still read the difference; a student with monochromacy may not.
- **Screen reader:** the canvas is not described. This is expected for a visual game but means the experience is not equivalent for blind students.

### 5. Classroom Management

- **Typical completion:** 6-12 minutes for a focused first run (including tutorial). Fast players finish closer to 5 minutes. Slow / struggling players can take 12-15 minutes if they die once.
- **Confusion points:**
  - Level 1 mission text vs. HUD (High #1).
  - The difference between cumulative Energy Result and per-material "Mostly X" labels.
  - Why opaque bubbles overload at 3 hits (the magic number is unexplained — students may try to overload reflective or transparent too).
- **Rush risk:** in Level 2 specifically, a student who clicks Skip on tutorial and predicts "Mostly Transmit" four times in a row will finish in 90 seconds with no real engagement. Their tracker will say 2/4 or 1/4 correct; their Lab Notes will look reasonable on paper. This is the highest classroom-management concern: prediction without thinking still produces clean-looking data.
- **Stuck risk:** a student who keeps dying on reflective bubbles in Level 1 with no spatial intuition will loop the lose screen. No adaptive difficulty exists; that is fine for this design, but the lose-screen guidance (Risk #4) needs the cause-naming fix.

### 6. Technical Audit

- **State management:** clean. `freshState()` is the single source of truth; Replay always calls it; `enterLevel2()` does targeted mutation rather than a full reset (correct - shields and accumulated counters should carry over).
- **Overlay cleanup:** `startGame()` hides start, end, Level 2 intro, and predict overlays explicitly. Solid.
- **Event listeners:** added once on script load. No removal needed; no SPA navigation.
- **Memory:** no leaks observed. Particles, shots, rings are all garbage-collectable; no growing arrays.
- **Duplicate logic:** `setLastInteraction` is correctly the single entry point. Energy crediting in mixed branch is the only place where ratios → bars math lives. Good.
- **Fragile patterns:**
  - The particle `color` field is stored as a partial RGBA string (`'rgba(255,180,90,'`) waiting to have alpha and `')'` appended at draw time. Works, but a maintenance reader will be confused. Worth a comment.
  - The shadow inner `const id` shadowing (fixed in MP7) was the kind of thing that bites; the rest of the file has been audited for similar patterns and looks clean.
  - The `setTimeout(1.8s)` to fire `winLevel2()` after the 4th prediction result is the only non-loop-driven timer in the simulation. If the player navigates away during that window the timer still fires harmlessly (state is checked before showing the end overlay).
- **Unused / dead:** the `winGame()` shim (see Low #16).
- **CSS:** large and well-organized. Some unused `--gold-glow` references could be pruned but it is not urgent.

### 7. Mobile & Chromebook Readiness

- **Chromebooks:** fully supported. Keyboard, click-to-pause-button shim once added (see Medium #2), screen size is sufficient at 1366×768.
- **Tablets (iPad / Android):** unsupported by gameplay (see High #3). The UI itself reflows correctly at 980 px to a single-column stack, but the canvas controls are unreachable.
- **Phones:** same as tablets, plus side-panel content gets very long in vertical stack. Not recommended.
- **Resolution scaling:** canvas is 1280×720 internal with `aspect-ratio: 16 / 9` and `width: 100%`. Bubble labels rendered at 11 px in canvas units will be readable down to about 700 px arena width (≈8 px on screen). Below that the labels become decorative.
- **Overflow:** no horizontal overflow observed. Vertical overflow is intentional — the page is meant to scroll on smaller screens.
- **Tracker readability on small screens:** the Materials Tested tracker uses 0.82 rem text and 0.7 rem sublines. At 980 px viewport this still reads cleanly. At 600 px (phone landscape) the sublines become borderline.

---

## Classroom Pilot Recommendation

**Yes, with minor fixes.**

The game is genuinely ready for a Grade 6 classroom pilot with two preconditions:

1. **The classroom uses Chromebooks or laptops, not tablets or phones.** The unplayability on touch devices is a hard block, not a soft block.
2. **The High-priority items above are addressed first** — specifically: a clearer Level 1 win-condition surface, click-to-resume on pause, mid-run Lab Notes export, and cause-naming on the lose screen. These are not new features; they are clarity fixes on existing systems.

With those in place, the underlying learning loop (observe → compare → predict → evaluate) is well-designed, the science is honest, the artifact (Lab Notes) is teacher-grade, and the build is technically stable. The Medium and Low items can be deferred to a polish pass after the first pilot generates real classroom evidence.

If forced to deploy tomorrow as-is, the lesson would still work — but the teacher would need to verbally compensate for the Level 1 win-condition ambiguity and would have to manage the touch-device exclusion. Both are avoidable with under a day's clarity work.
