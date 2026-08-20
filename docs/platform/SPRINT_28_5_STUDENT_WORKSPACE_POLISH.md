# Sprint 28.5B - Student Workspace UX Polish

Status: **Phase 28.5B COMPLETE.** Implementation + browser validation of the
approved five-item package. Presentation only; sits entirely on top of the
certified student architecture. No external state mutated. Not staged, not
committed, not pushed (Chris reviews and commits).

Companion: `SPRINT_28_5_STUDENT_WORKSPACE_UX_AUDIT.md` (Phase 28.5A audit +
§17 outcome summary).

- Branch: `main`
- HEAD at start and end: `60f28e9aaaffd3c31f297a5fc49a011c65e9ae08` (unchanged)

---

## 1. Approved package

Five presentational changes around locked architecture, plus the two explicit
constraints Chris set:

- **B1** Style the primary student actions (`Open assignment`, `Improve My Score`).
- **B2** Give the My Assignments / My Results tabs a clear selected state.
- **B3** Replace the bare bulleted list with LyfeLabz card treatment.
- **B4** Rebalance title hierarchy, style status, and quiet completed work.
- **B5** Restore the student error-callout presentation.
- Keep the copy **`Open assignment`** (no `Start`).
- Completed assignments stay **visible and re-launchable** (visual priority only).

Not in scope (and not implemented): F8 deep-link wordmark, F9 supporting
paragraph, due dates, urgency, new states, gamification (points/streaks/badges/
avatars/progress bars/celebration), analytics, social, new navigation,
teacher-shell conversion, new backend data or API fields, and any locked
architecture.

---

## 2. Implementation

Two production files, both presentational.

### `app/src/router/surfaces/index.ts` (one attribute; B4)

`renderAssignmentsList` sets `data-complete="true"` on an assignment `<li>`
when its derived status is `perfect` or `wellDone`. It is set only inside the
existing `statusByAssignment !== null` branch, so a card that degraded to
launch-only (results read failed) is never marked complete. No label, URL,
status vocabulary, glyph, authorization, or lifecycle changed; the card stays
in the list, keeps its status chip and its `Open assignment` control.

### `app/index.html` (scoped CSS; B1-B5)

All CSS is gated by the auth-card scope `body:not(:has(#app-root > .shell-header))`
**and** a student-only hook (the tablist, the assignment/result lists, the cards,
the status chip), so no teacher-workspace control and no sibling auth-card
surface (signed-out / provisioned / pending / error / admin) is affected. It
reuses existing tokens only (`--tw-primary`, `--tw-nav-edge`, `--tw-nav-wash`,
`--tw-callout-success-*`, `--tw-callout-error-*`, `--tw-badge-neutral-bg`,
`--tw-surface`, `--tw-surface-alt`, `--tw-hairline`, `--tw-radius-card/control/pill`,
`--tw-focus-ring`). No `!important`. No second design system.

- **B1** `[data-testid=assignments-launch]` and `[data-testid=results-improve]`
  get the LyfeLabz filled-green primary treatment (44px target, green focus
  ring), sized for a card rather than the full-width page hero. Also added
  `[data-testid=results-retry]` to the existing primary allowlist so the
  results error retry matches the already-styled assignments retry.
- **B2** A new tablist rule: the selected tab (`[role=tab][aria-selected=true]`)
  carries a filled wash, heavier teal ink, and a solid `--tw-nav-edge` underline
  bar (non-color cue); focus-visible shows `--tw-focus-ring`. ARIA is JS-owned
  and untouched.
- **B3** `[data-testid=assignments-list]` / `[data-testid=results-list]` drop
  `list-style` and indent; each `<li>` becomes a discrete left-aligned card
  (surface, hairline border, `--tw-radius-card`, soft shadow). The list stays a
  semantic `<ul>/<li>`.
- **B4** Card `<h2>` titles calmed to 1.08rem (semantics kept). Status chip is a
  restrained pill: text label + glyph preserved, muted tones only (inviting
  teal for Ready, neutral for Improving, one soft-success family for the two
  done states). Completed cards (`[data-complete=true]`) recede to
  `--tw-surface-alt`, drop the shadow, mute the title one ink step, and render
  `Open assignment` as a quiet teal outline button - still present, labeled,
  focusable, and re-launchable.
- **B5** The error-callout selector `[data-testid=error-banner]` was widened to
  also match `[data-testid=assignments-error]` and `[data-testid=results-error]`.
  The render functions overwrite the `error-banner` testid with those student
  variants (for their retry tests), which had dropped the callout styling. `role="alert"`,
  the testids, and retry behavior are unchanged; the fix is CSS-only.
- Mobile (`@media max-width:480px`): tabs `flex:1` split the row evenly (no
  wrap); card actions stretch to full width for a comfortable tap target.

---

## 3. Before / after (audit reconciliation)

| Finding | Result |
|---------|--------|
| F1 Primary action least visual weight | RESOLVED |
| F2 Selected tab indistinguishable | RESOLVED |
| F3 Default bullets / prototype look | RESOLVED |
| F4 No card boundaries | RESOLVED |
| F5 Titles over-dominate | RESOLVED |
| F6 Completed not distinguished | IMPROVED BUT REMAINS (visual quieting done; no reordering/grouping, deliberately out of scope) |
| F7 Error loses red callout | RESOLVED |
| F8 Deep-link arrival branding | DEFERRED |
| F9 Meta-instructional paragraph | DEFERRED |

Rendered hierarchy now reads: page -> selected workspace view -> assignment
card -> title -> status -> primary action.

---

## 4. Browser validation

Harness identical to the audit: the real `makeActiveStudentSurface` bundled with
the project's `esbuild`, driven by in-memory fake callables, rendered into the
byte-for-byte `app/index.html` `<style>` blocks. No production file mutated for
the harness; it lived in the session scratchpad. Console clean.

Viewports (exact): Desktop 1280x900, Tablet 768x1024, Mobile 375x812 (mobile
preset, coarse pointer). No horizontal scroll at any width
(`scrollWidth == clientWidth`: 1280, 768, 375).

States inspected:

- **1 assignment** - not empty-looking, not overbuilt; one clean card.
- **3 assignments** - clean scanning; all actionable = filled green.
- **~8 mixed** (primary stress) - 8 cards, 3 correctly quieted (2 Perfect, 1
  Well Done); actionable-first reads clearly; the audit's tablet status/button
  collision is gone (vertical title -> status -> action stack).
- **My Results** - result cards (title, status, best score, attempt count,
  Improve My Score); Perfect card correctly shows no Improve control.
- **Empty** - preserved; calm centered message, selected-tab cue added.
- **Loading** - unchanged; `role=status` / `aria-live=polite`, no spinner.
- **Assignment error** - red callout restored + green Try again.
- **Results error** - red callout restored + green Try again (now styled).

Mobile measurements: tabs 151px each (even split, no wrap) x 46px tall; card
action 267px wide x 44px tall (full-width).

---

## 5. Accessibility validation

- **Tabs** - `role=tablist` / `role=tab`, `aria-selected` = [true,false], roving
  tabindex [0,-1], `tabpanel` + `aria-labelledby` all intact; selected cue is
  non-color (teal underline bar) at 44px min-height.
- **Keyboard / focus** - Tab order honors roving tabindex (unselected tab
  skipped, reachable by arrows); `Open assignment` matches `:focus-visible` and
  shows the green 3px ring (`rgba(31,107,61,0.28) 0 0 0 3px`); tabs use the same
  `--tw-focus-ring` mechanism.
- **Status** - text label + aria-hidden glyph preserved; not color-only.
  Composited chip text contrast: Ready 6.39:1, Improving 8.68:1, Well Done 7.00:1,
  Perfect 7.00:1 (all >= AA 4.5).
- **Cards / headings** - `<h2>` semantics and `aria-labelledby` preserved;
  accessible names unchanged.
- **Completed treatment** - title 9.15:1 and outline-action text 6.85:1 against
  the quiet surface; readable and operable, no opacity fade, not gray-alone
  (status chip text + glyph also carries completion).
- **Error** - `role="alert"` / `aria-live="assertive"` preserved; retry is a
  real keyboard-operable `<button>`.

---

## 6. Return-from-lesson state

The certified return architecture (`<a href="/app/">` Back to My Assignments)
is unchanged. On a fresh `/app/` load after completion, the now-completed
assignment appears as a quiet card (Perfect Score / Well Done! chip, muted
surface, outline `Open assignment`): visible, correct derived status,
re-launchable, and not disabled. The filled-green actionable cards draw the eye
first. No completion banner was added.

---

## 7. Tests

- New: `app/src/router/surfaces/student-workspace-css.test.ts` (served-CSS pins
  for B1 primary action, B2 selected-tab non-color cue, B5 student error-callout
  coverage). 4 tests.
- New test in `app/src/router/surfaces/surfaces.test.ts`: completion modifier is
  applied to Well Done!/Perfect and not to Improving/Ready, and every card
  (completed included) stays visible with a labeled, URL-bearing
  `Open assignment`. 1 test.
- Targeted run (`surfaces.test.ts` + new CSS test): 67 passed.
- `npm run typecheck`: clean.
- `npm run lint`: clean.
- Full app Jest: **69 suites, 1,893 tests, 1,892 passed, 1 failed** - the single
  failure is the pre-existing, Sprint 29-owned `curriculumManifest.test.ts` drift
  (it compares the **root** `index.html` to the checked-in manifest; neither was
  touched this phase, confirmed by `git diff --stat`). Not regenerated. Baseline
  was 68/1,888/1,887/1; delta is +1 suite and +5 tests, same single manifest
  failure.

No Functions or Rules files changed, so those suites were not rerun.

---

## 8. Files changed

Production:
- `app/index.html` (scoped student-workspace CSS; error-callout selector; retry allowlist)
- `app/src/router/surfaces/index.ts` (one `data-complete` attribute)

Tests:
- `app/src/router/surfaces/surfaces.test.ts` (one added test)
- `app/src/router/surfaces/student-workspace-css.test.ts` (new)

Docs:
- `docs/platform/SPRINT_28_5_STUDENT_WORKSPACE_UX_AUDIT.md` (§17 outcome)
- `docs/platform/SPRINT_28_5_STUDENT_WORKSPACE_POLISH.md` (this file)

No teacher-workspace file and no locked-architecture file changed.

---

## 9. Deferred (retained)

- **F8** deep-link arrival wordmark/branding.
- **F9** supporting paragraph / microcopy. After the card redesign the
  supporting paragraph still reads fine (it is above the tabs, not inside the
  card layout) and created no new visual problem; it is left unchanged.

---

## 10. External state

No production Firebase mutation. No Google mutation. No OAuth mutation. No
assessment-revision deployment. No deployment of any kind. Repository- and
local-browser-only work.
