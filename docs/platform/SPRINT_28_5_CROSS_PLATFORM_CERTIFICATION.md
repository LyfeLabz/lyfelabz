# Sprint 28.5E - Cross-Platform Visual & Interaction Certification

Status: **COMPLETE AND CERTIFIED.** Final UX freeze gate before Sprint 29
(Teacher Platform v1 Release Certification). This is a certification pass, not
a design sprint. Default posture was CERTIFY, DO NOT REDESIGN, and it held:
**no production code, markup, CSS, copy, or test was changed.** Nothing staged,
committed, or pushed. No external state mutated. No Sprint 29 work performed.

Companion records:
`SPRINT_28_5_STUDENT_WORKSPACE_UX_AUDIT.md`,
`SPRINT_28_5_STUDENT_WORKSPACE_POLISH.md`,
`SPRINT_28_5_TEACHER_WORKSPACE_UX_AUDIT.md`,
`SPRINT_28_5_TEACHER_WORKSPACE_POLISH.md`,
`SPRINT_28_PHASE_7_BROWSER_CERTIFICATION.md`,
`TEACHER_PLATFORM_DOMAIN_ROADMAP.md`.

---

## 1. Environment

| Item | Value |
|------|-------|
| Branch | `main` |
| HEAD (start and end) | `69ec47880506a7e03d9a098e40634a2f0fec6a5e` ("Polish teacher workspace UX for v1") |
| Sprint 28.5B (student polish) committed | Yes (`0d8129f`) |
| Sprint 28.5D (teacher polish) committed | Yes (`69ec478`, HEAD) |
| Working tree at start | clean |
| Working tree at end | only this phase's two doc edits (record + roadmap); no production/code/test change |

### Method (production-faithful browser harness)

The finished student and teacher experiences were inspected together in one
browser session, not from source alone. The harness is the same class of
production-faithful harness used by 28.5B/28.5D: the **real** student surface
module (`makeActiveStudentSurface`) and the **real** teacher shell
(`mountTeacherShell`, plus `renderAssignmentDetail`) were bundled unmodified with
the project's own `esbuild` and mounted with in-memory fakes into the
**byte-for-byte real `app/index.html` `<style>` blocks** (the three canonical
stylesheets extracted verbatim, Orbitron font link included). The DOM each user
sees and the CSS that styles it are production-faithful. The harness lived only
in the session scratchpad and in a git-ignored `app/dist/` path; no production
file was modified and no Firebase, Google, or OAuth state was touched. It was
served over the repository's existing `lyfelabz-static` launch config
(`http://localhost:8765`) and driven through the Browser pane at each viewport.

Scenarios were selected by URL hash: student `s-1 / s-3 / s-8 / s-results /
s-empty / s-error / s-results-error`; teacher `t-curriculum / t-classes /
t-workspace / t-settings / t-connected / t-present / t-detail-published /
t-detail-closed / assign-dialog`.

Where the Browser pane could not render a state (the teacher shell cannot lay
out below its ~725px nav-row floor; a live Google Classroom connection is
required for LMS-linked/`needsSetup`/populated-roster states), the behavior was
characterized from the served CSS plus `matchMedia` evaluation and the certified
28.5D/Phase 7 evidence, and the limitation is stated where it applies.

---

## 2. Student surfaces inspected

| Surface / state | Result |
|-----------------|--------|
| My Assignments - 1 assignment | Clean single card; not empty-looking, not overbuilt. |
| My Assignments - 3 assignments | Selected-tab cue present; actionable cards filled-green; completed card receded. |
| My Assignments - ~8 mixed status | 8 cards, 1 correctly quieted (Perfect); status chip above action (no tablet collision); no horizontal overflow at 1280/768/375. |
| My Results (populated) | Result cards: title, restrained status chip, best score, attempt count, `Improve My Score` filled-green primary; Perfect card correctly shows no Improve control. |
| Empty | Preserved calm message ("No assignments are open for you right now...") + selected-tab cue; no overflow. |
| Recoverable error (assignments + results) | Red callout restored (B5): `--tw-callout-error-*` tokens, `role="alert"`, `aria-live="assertive"`, calm non-technical copy, green `Try again`. |
| Return from completed v2 lesson to `/app/` | Certified `<a href="/app/">` return architecture unchanged; a completed assignment renders as a quiet re-launchable card. |
| Narrow / mobile 375 | True 375 rendered: no horizontal overflow (`scrollWidth == clientWidth == 375`), tabs even 151px each, `Open assignment` 267px x 44px full-width tap target. |

**Result: student surface certified.** Every required state renders as part of a
finished, calm, on-brand science workspace. No defect, no regression from 28.5B.

---

## 3. Teacher surfaces inspected

| Surface / state | Result |
|-----------------|--------|
| Curriculum | 49 real cards; grade/topic filter chips; `Curriculum` nav active (`aria-current="page"`); green `Assign` primaries; density 4 @1280 / 3 @1024 / 2 @768 (D5). |
| Active Assignments | Card grammar + humanized date (D4); covered live via Curriculum accordion and Phase 7. |
| Classes | "2 classes" microcopy (not "classrooms"); left-aligned class cards (D3); `Active` status pill; green `Create LyfeLabz Class` primary; `Import` secondary. |
| Class workspace - Snapshot | Segmented Snapshot/Roster switcher; active tab carries `aria-current="page"` + non-color underline; `Grade 7 · Active` separator (D3); calm snapshot copy. |
| Class workspace - Roster | Present-tense copy ("Students who join with the class code appear here..."); roadmap/sprint language removed. |
| Assignment Detail - published | Renders **inside the persistent shell** (header + wordmark + nav preserved, Curriculum active) (D2A); left-aligned; header card with label/value meta + `Published` status pill; calm white `Close assignment`; Google Classroom publication panel with secondary `Try again`; styled Assignment Summary metric grid; grouped Roster (Submitted/In progress/Not started); late-recipient rows each with an associated `Add to assignment` control (D2B). No horizontal overflow at 1280/768. |
| Assignment Detail - closed / late-recipient / LMS panel | Styled via the shared D2B lifecycle/status/callout CSS; live LMS-linked publication states remain the Sprint 29 Google boundary test. |
| Settings | Trimmed intro; category list retained (IA deferred); Default grade control; `Open Integrations` link. |
| Connected Services (Integrations) | Google Classroom card; neutral (non-alarm) `Not connected` pill; honest non-modification reassurance; `Connect Google Classroom` control. |
| Assign dialog | `role="dialog"`, `aria-modal="true"`, `aria-labelledby`; per-class Date / Release time / Points; **no Google Classroom topic field on the manual class** (microcopy fix). |

**Result: teacher surface certified.** The "two design eras" gap is closed; the
post-Sprint-20 surfaces now share the Sprint 20 visual grammar. No defect, no
regression from 28.5D.

---

## 4. Viewport matrix

| Width | Student | Teacher |
|-------|---------|---------|
| **1280** | No horizontal overflow; centered auth-card; cards + selected tab + primary actions styled. | No horizontal overflow; Curriculum 4 columns; shell + nav + Detail-in-shell all correct. |
| **1024** | No horizontal overflow; layout unchanged (simple stacked card list). | No horizontal overflow; Curriculum 3 columns (D5, was 2); sidebar persists. |
| **768** | No horizontal overflow; full-width stacked cards; status chip above action (collision resolved). | No horizontal overflow; Curriculum 2 columns (D5, was 1); shell-body 224px + 476px; Assignment Detail sections stack cleanly, no child exceeds viewport. |
| **375 (narrow/mobile)** | **Rendered true 375:** no horizontal overflow; tabs even 151px; launch 267x44. | **Browser-pane limitation:** the pane cannot lay the teacher shell below its ~725px nav-row min-content floor. Characterized from CSS + `matchMedia`: at `max-width:720` the shell-body collapses to a single `1fr` column and `.shell-nav-list` becomes a `flex-direction:row; overflow-x:auto` row (its `overflow-x:auto` zeroes its min-content contribution, so it scrolls internally rather than widening the page); the `max-width:480` rules fire (header identity hidden, grids collapse). No real page overflow expected at true 375, matching the 28.5D characterization. |

No accidental horizontal scrolling, clipped control, status/action collision, or
dialog-exceeds-viewport was observed at any rendered width.

---

## 5. Brand-family consistency

**Yes - the teacher and student experiences clearly belong to one LyfeLabz
product family.** Shared traits, verified at the token and rendered level:

- Gold Orbitron `LYFELABZ` wordmark on both (student auth-card `p.auth-brand`;
  teacher `.shell-brand` header), from the single `--gold` / `--gold-glow`
  definition.
- `--tw-primary` (#1f6b3d) green for primary actions on both.
- `--tw-nav-edge` (deep muted teal) for selection cues and focus rings on both.
- Identical `--tw-callout-error-*` red error language on both.
- Shared `--tw-radius-card` / `--tw-radius-control` / `--tw-shadow-card` /
  `--tw-hairline` card and surface grammar.
- Restrained, text-plus-glyph/pill status treatment; no chip proliferation, no
  gamification, no enterprise-heavy density.

They are correctly **not identical**: the teacher side is a denser, administrative
sidebar shell; the student side is a calmer, task-focused centered auth-card.
Screenshots of both, shown without context, read unmistakably as LyfeLabz.

---

## 6. Action hierarchy

Coherent across both products. Filled-green primary = the loudest, everyday
action (student `Open assignment` / `Improve My Score`; teacher `Assign` /
`Create LyfeLabz Class`). Quieter secondary controls (`shell-btn`, class-nav,
detail `Close assignment`, late-recipient `Add to assignment`, student completed-
card outline action) are legitimately calmer - teacher management controls are
allowed to be quieter, and are. No raw/default OS buttons remain on either side
(the 28.5A F1 and 28.5C `shell-btn`-undefined findings are resolved). One
pre-existing idiom variance persists and is retained deferred: the uppercase,
letter-spaced outline `Connect Google Classroom` pill on Connected Services (a
Sprint 20-era control, within the same teal-outline family, not a 28.5D
regression).

---

## 7. Navigation / selected states

- Student tablist: `role=tab` / `aria-selected`, roving tabindex, and a **non-color**
  selected cue (teal underline bar + wash + heavier ink) at 44px min-height.
- Teacher left nav: active item carries teal wash + leading edge + `aria-current="page"`.
- Teacher class workspace Snapshot/Roster: active tab carries `aria-current="page"`
  + a non-color underline.
- Assignment Detail keeps Curriculum visually active while shown, and selecting
  any global nav item leaves Detail cleanly.

Selected state is obvious, keyboard-accessible, and not color-only on both sides.
The two nav idioms (student tabs, teacher sidebar) are intentionally distinct,
which is correct.

---

## 8. Cards / surfaces

One shared container grammar now spans both products: hairline border, ~10px
radius, soft card shadow, warm-white surface, consistent padding. Student
assignment/result cards, teacher lesson cards, class cards (now left-aligned),
Assignment Detail section cards, the Assignment Summary metric grid, and the
Connected Services card all read as the same family. Completed student work
recedes to `--tw-surface-alt` without disappearing. No accidental outlier
remained (the 28.5C center-aligned class card is fixed).

---

## 9. Status system

Restrained and legible; text is primary and color is supplemental on both sides.
Student statuses (Ready to Begin / Improving / Well Done! / Perfect Score) carry
a text label plus glyph and a muted pill. Teacher lifecycle/connection statuses
(Published / Closed / Draft / Active / Not connected) carry a single quiet pill
treatment. The two vocabularies are correctly **not** unified (student
achievement status vs. teacher lifecycle status are different domain concepts).
No chip proliferation; status never dominates a card.

---

## 10. Error / info / success presentation

Same product language on both sides:
- **Error** uses the shared `--tw-callout-error-*` red callout with `role="alert"`
  (student assignments/results errors; teacher Detail close/reopen/publish/late-
  recipient errors), verified to use identical tokens and `--tw-radius-control`.
- **Info** stays calm/neutral (student loading `role="status"`; teacher lifecycle
  notes, `Adding...`, calm publication status lines).
- **Success** is restrained (`Added to assignment.` via a single
  `role="status"`/`aria-live="polite"` region; the assign toast).
- **Retry** is a real keyboard-operable control on both sides; no technical
  language, callable names, OAuth terms, or stack traces surface.

---

## 11. Focus / keyboard

Visible focus belongs to the same design family on both sides (the teal
`--tw-focus-ring` on teacher `shell-btn`/nav/detail/late-recipient controls and
on the student tabs and primary buttons; the green primary ring on the student
launch/improve actions). Keyboard operation is intact: student tablist roving
tabindex + arrow keys; teacher nav, Assign dialog (focus moved into the modal),
class switcher, and Detail controls are all real, operable `<button>`/`<a>`
elements. No keyboard trap observed.

---

## 12. Product transitions

- **Student assignment return:** My Assignments -> lesson -> results ->
  `Back to My Assignments` (`<a href="/app/">`) lands on a fresh, intentional
  surface with the completed assignment as a quiet re-launchable card. Certified
  return architecture unchanged.
- **Teacher Assignment Detail transition:** Curriculum -> `Assign` /
  `View summary` -> Detail now renders **inside** the persistent shell (D2A), no
  longer a shell-less centered pod; `Back to Curriculum` and scroll restoration
  unchanged.
- **Teacher global-nav-from-Detail:** verified live - clicking `Classes` while
  Detail is shown removes Detail cleanly, mounts the Classes surface, moves nav
  active to Classes, and leaves no stale Detail state; the shell header/nav
  persist throughout. Assignment Detail shell preservation is intact.

No transition visually "drops out" of the product.

---

## 13. Accessibility

Certified at the semantic and visible level (no screen-reader speech was directly
exercised, so none is claimed):
- Keyboard navigation functional across both products; no traps.
- Focus visible and consistent (shared teal/green ring families).
- Landmarks/headings coherent (teacher `banner`/`navigation`/`contentinfo`;
  Assignment Detail is a self-labeled `<section>` in the shell outlet with no
  duplicate `main`; student tablist + `tabpanel` + `aria-labelledby`).
- Selected states understandable and not color-only on both sides (`aria-current`
  / `aria-selected` + non-color underlines).
- Status not color-only (text label + glyph/pill).
- Errors retain `role="alert"` / `aria-live="assertive"`.
- Touch targets reasonable (student launch 44px; teacher coarse-pointer rules lift
  targets; the late-recipient `Add` is 32px at desktop, lifted on coarse pointer).
- Completed student work readable (28.5B measured contrast >= AA on the quiet
  surface); teacher management controls readable.
- Reduced-motion spinner behavior appropriate (`shell-spinner` respects the
  28.5D reduced-motion rule).

No release-blocking accessibility defect found.

---

## 14. Restraint

Neither side became over-designed. No excess cards, pill proliferation, excess
green or gold, excess borders, or heavy shadows was introduced. The student side
is not gamified (no points/streaks/badges/avatars/progress bars/celebration); the
teacher side is not enterprise-heavy (no dashboards-of-dials, analytics wall, or
chip wall). The combined polish is additive-where-missing and subtractive-where-
noisy, consistent with the audits' intent.

---

## 15. Defects found / fixed

**None.** No visible inconsistency, confusion, accessibility gap, responsive
breakage, unfinished surface, or regression introduced by 28.5B or 28.5D was
found. No production change was made (CERTIFY, DO NOT REDESIGN held).

---

## 16. Deferred UX findings (retained, not reopened)

- Student **F8** deep-link arrival wordmark/branding.
- Student **F9** meta-instructional supporting paragraph.
- Teacher **Present Mode** redesign (roadmap-deferred runtime; placeholder now
  uses a styled `shell-btn`).
- Teacher **Settings information architecture** expansion (intro trimmed only;
  categories intentionally unchanged).
- Teacher **LMS `needsSetup` / import** full live visual certification (Sprint 29
  Google boundary test).
- Teacher **`Connect Google Classroom`** uppercase-outline button idiom (pre-
  existing Sprint 20-era control).

None of these creates a concrete cross-platform inconsistency in the finished
product, so all remain deferred to post-v1.

---

## 17. Deterministic validation

No production source changed this phase, so the targeted cross-platform surface
tests plus the app typecheck, lint, and full Jest suite were run:

- **App typecheck** (`tsc --noEmit`): clean.
- **App lint** (`eslint --ext .ts src`): clean.
- **Full app Jest:** **72 suites, 1,923 tests, 1,922 passed, 1 failed.** The
  single failure is the known, pre-existing, Sprint 29-owned
  `curriculumManifest.test.ts` SHA drift, which reads only the repo-root
  `index.html` and the checked-in manifest JSON - **neither touched this phase**
  (`git diff --stat HEAD` on both is empty; the working tree carries no
  production change). This matches the 28.5D baseline (1,922 passed / 1 failed)
  exactly. The manifest was **not** regenerated (Sprint 29 owns it).

Functions and Rules suites were not rerun (no Functions or Rules file changed).

---

## 18. External-state confirmation

No production Firebase mutation. No Google Classroom mutation. No OAuth mutation.
No assessment-revision deployment. No production deployment. No curriculum-
manifest regeneration. All inspection ran against a local, self-contained esbuild
harness over the repository's static launch config and jsdom-backed tests.

---

## 19. Final disposition

**COMPLETE AND CERTIFIED.** No material cross-platform UX inconsistency remains.
The finished teacher and student experiences read as one coherent, release-ready
LyfeLabz product family. **Teacher Platform v1 UX is now FROZEN.** The project is
ready to proceed to Sprint 29 (Teacher Platform v1 Release Certification), which
retains sole ownership of manifest regeneration, assessment deployment, Google
OAuth/Data Access disposition, Secret Manager/release hygiene, production
deployment, and final production certification. Sprint 29 is not begun here.
