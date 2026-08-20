# Sprint 28.5D - Teacher Workspace UX Polish

Status: **IMPLEMENTED (local).** Presentation-only polish plus one bounded
mount-seam change. No production Firebase, Google Classroom, OAuth, assessment,
or curriculum-manifest mutation. Nothing staged, committed, or pushed - Chris
reviews and commits manually.

Baseline at start: HEAD `0d8129f9f499a8a013adf272740ae7e9d91d2f7b`, only the
28.5C audit document untracked, no other working-tree changes.

This phase implements the package the 28.5C audit approved
(`SPRINT_28_5_TEACHER_WORKSPACE_UX_AUDIT.md` §27-§29): it closes the "two
design eras" gap where post-Sprint-20 teacher surfaces emitted `shell-*` class
names with no CSS and rendered with browser defaults, and it keeps Assignment
Detail inside the persistent shell.

---

## 1. Approved package (D1-D5 + microcopy)

| Item | Summary |
|------|---------|
| D1 | Define + style the shared management controls `shell-btn` (+ `-primary` / `-danger` modifiers) and `shell-spinner`. |
| D2A | Keep Assignment Detail inside the persistent Teacher Workspace shell via a bounded shell/outlet seam. |
| D2B | Give the `shell-assignment-detail-*` family an intentional visual treatment. |
| D3 | Polish the class workspace (Snapshot/Roster switcher, class identity, roster copy, class-card alignment). |
| D4 | Style the Active Assignments dashboard and humanize its displayed date. |
| D5 | Improve Curriculum density at classroom-device widths. |
| Microcopy | `classroom`->`class`/`Classes`; remove Roster roadmap/sprint copy; trim the Settings intro; hide the Google Classroom topic field on manual classes. |

Everything is presentation-only except D2A (a small mount-seam change) and the
D4 date formatter. No backend, Firestore, OAuth, Google API, assignment-state,
authorization, or domain change.

---

## 2. D2A - shell-preserving Assignment Detail architecture

**Problem (audit §12).** The entry-point opener cleared `#app-root` and
rendered Detail as a shell-less, centered, unstyled page - destroying the
teacher header and navigation on the most-visited management surface.

**Fix (the cleaner shell/outlet seam the 28.5C.1 investigation identified).**
The persistent shell now owns its outlet and exposes a bounded surface-render
seam; the opener renders Detail into that outlet instead of clearing
`#app-root`.

Flow:

1. `mountTeacherShell` builds its `.shell-outlet-host` and registers a bounded
   controller with the entry point through the existing `assignmentDetail`
   seam: `deps.assignmentDetail.setOutletController({ show })`.
2. The controller's `show(render)` clears only the outlet's local content and
   hands the caller the outlet host. It does **not** touch the header,
   navigation, footer, or the active navigation key.
3. The entry-point `openAssignmentDetail` renders Assignment Detail through
   `teacherShellOutletController.show(renderDetailInto)` instead of
   `findMount().textContent = ""`. If no controller is registered (a harness,
   or a non-teacher session) it falls back to the pre-28.5D `#app-root` mount.
4. The controller slot is dropped on every bootstrap transition (mirroring the
   existing `activeAssignmentsInvalidator`) and re-registered when the shell
   re-mounts, so no stale, detached outlet can be reused.

Because Detail is now a child of the outlet host, the shell nav's existing
`onSelect` handles leaving Detail for free: selecting any surface clears the
outlet and mounts that surface. A single bounded `showingDetail` flag in the
shell suspends the same-key early-return so re-selecting the already-active
Curriculum item while Detail is shown still re-mounts Curriculum (no dead
click). This is **not** a router, history stack, breadcrumb, or navigation
state machine.

**Required behavior verified.** Header + wordmark remain; Curriculum / Classes
/ Present Mode / Settings remain available; Curriculum stays visually active
(`aria-current="page"`); footer remains; Detail renders in the normal content
region and inherits the shell's left-aligned reading order (the
`#app-root:has(> .shell-header)` override still matches, so Detail is no longer
centered); `Back to Curriculum` and its scroll-restoration are unchanged (the
opener's `onBack` still runs the Sprint 16 `remountCurriculum` path). All
lifecycle/authorization/publication semantics are untouched.

**New evidence enabled by the fix:** selecting Classes (or any surface) from
Detail removes Detail cleanly, mounts the surface normally, and leaves no stale
Detail listener/state on the shell (covered by
`shell.detail-outlet.test.ts`).

---

## 3. Implementation footprint

### Production code

| File | Change |
|------|--------|
| `app/src/shell/surfaces/curriculum.ts` | Extend `CurriculumAssignmentDetailSeam` with optional `setOutletController`; add the `TeacherShellOutletController` type. Remove the inert Google Classroom topic text field for manual (non-LMS) classes. |
| `app/src/shell/shell.ts` | Register the outlet controller through the seam at mount; add the bounded `showingDetail` flag so nav leaves Detail cleanly. |
| `app/src/index.ts` | Hold the `teacherShellOutletController` slot; render Detail via `controller.show(...)` (fallback to `#app-root`); drop the slot on every bootstrap transition; add `setOutletController` to the seam. |
| `app/src/shell/surfaces/shared/activeAssignments.ts` | Humanize the published date (`2026-08-20` -> `Aug 20, 2026`) with a deterministic month table; export `formatLocalDate` for coverage. |
| `app/src/shell/surfaces/classes.ts` | `classroom(s)`->`class`/`classes`; replace the Roster roadmap/sprint copy with present-tense copy. |
| `app/src/shell/surfaces/settings.ts` | Trim the two-paragraph intro to one sentence; drop the separate "purpose" paragraph. |
| `app/index.html` | The Sprint 28.5D CSS block in `<style id="shell-canonical">`: D1 controls, D2B detail, D3 class workspace, D4 dashboard, D5 density, reduced-motion + coarse-pointer + narrow-width rules. |

### Tests

| File | Protects |
|------|----------|
| `app/src/shell/shell.detail-outlet.test.ts` (new) | D2 shell/outlet seam: shell stays mounted when Detail opens; Detail renders into the outlet; header/nav/footer survive; Curriculum stays active; global nav leaves Detail cleanly. |
| `app/src/shell/teacher-workspace-polish-css.test.ts` (new) | D1/D2B/D3/D4/D5 CSS presence in the served document. |
| `app/src/shell/surfaces/curriculum.manual-topic.test.ts` (new) | Manual class shows no GC topic field; LMS-linked class still shows the GC topic select. |
| `app/src/shell/surfaces/shared/activeAssignments.test.ts` | D4 humanized date (unit + rendered). |
| `app/src/shell/shell.test.ts` | Updated copy assertions (settings intro/purpose, classes wording) and the remembered-release-time test (topic field removed). |

---

## 4. Before/after (audit findings)

| Finding | Before | After |
|---------|--------|-------|
| Assignment Detail dropped the shell (unmounted, centered, unstyled) | shell-less centered prototype pod | shell preserved, left-aligned, composed management surface |
| `shell-btn` / `shell-spinner` undefined | raw OS buttons, no spinner | calm secondary button system (+primary/danger), restrained spinner |
| Curriculum density | 3 @1280, 2 @1024, 1 @768 | 4 @1280, 3 @1024, 2 @768 (measured) |
| Class workspace unstyled (`Grade 7Active`; bulleted switcher) | wireframe | segmented Snapshot/Roster tabs, separated `Grade 7  Active`, styled snapshot |
| Active Assignments unstyled; raw ISO date | unfinished cards, `2026-08-20` | card grammar, `Aug 20, 2026` |
| Manual-class Google Classroom topic field | inert text field shown | hidden for manual classes; preserved for LMS-linked |
| Settings future-facing prose | 2 philosophical paragraphs | one concise sentence |

---

## 5. Responsive validation

Measured in the Browser pane against a deterministic CSS harness built from the
exact served `app/index.html` stylesheets and representative teacher DOM (real
`shell-*` class names). The pane floors at ~720px, so 375 was characterized
from the `@media` rules.

| Viewport | Curriculum columns (before -> after) | Horizontal overflow |
|----------|--------------------------------------|---------------------|
| 1280 | 3 -> 4 (233px cards, 8 fully visible) | none |
| 1024 | 2 -> 3 (235px cards) | none |
| 768 | 1 -> 2 (231px cards; sidebar 224px + 476px) | none |
| 375 (from CSS) | 1 (shell-body single-column at 720; `@media max-width:480px` collapses dashboard/classes/snapshot grids; curriculum minmax(200px) -> 1 col at ~343px) | none expected |

At 768, Assignment Detail sections stack cleanly as cards, meta stays a flex
label/value row, the summary metric grid is 3 columns, and the status renders
as a teal pill - no horizontal overflow.

---

## 6. Accessibility validation

- **Shell-preserved Detail:** header (`banner`), navigation, and footer
  (`contentinfo`) remain; Curriculum keeps `aria-current="page"`; Detail is a
  self-labeled `<section aria-labelledby="assignment-detail-headline">` in the
  outlet - no duplicate `main` landmarks, no broken `aria-labelledby`, no
  duplicate ids. `Back to Curriculum` is a real keyboard-operable button.
- **Buttons:** `shell-btn`, class-nav, dashboard toggle, detail back, and the
  late-recipient Add control are added to the canonical teal focus-ring
  allowlist; disabled state styled; accessible names and testids unchanged;
  native keyboard operation preserved.
- **Class subnav:** the active Snapshot/Roster tab carries an underline (a
  shape cue, not color alone) in addition to color and weight; `aria-current`
  is already set in markup.
- **Assignment Detail:** `role="alert"` lines now render as red callouts;
  `role="status"` lines stay calm; the late-recipient live region is preserved;
  status is a labeled pill (not color-only).
- **Responsive:** no control is hidden at narrow widths; rows wrap rather than
  clip.

---

## 7. Browser matrix (deterministic harness)

Live emulator + minted-token walkthrough (as used for the 28.5C audit) is the
Sprint 29 boundary test; the LMS-linked, `needsSetup`, and populated-roster
states also need a real Google connection. For this presentation phase the
surfaces were validated against the served stylesheet + representative DOM:

- **Published Detail:** shell present, Curriculum active, `Close assignment`
  visible and calm (not a destructive red), header/summary/roster/late-recipient
  /LMS sections styled, left-aligned. Confirmed.
- **Late recipient:** name and `Add to assignment` clearly associated per row;
  `Added to assignment.` status calm. Confirmed.
- **LMS publication panel:** integrated card, calm provider-neutral status,
  `Reconnect in Settings` + `Try again` as secondary controls. Confirmed
  (no Google mutation).
- **Global nav from Detail / Curriculum re-click:** covered by
  `shell.detail-outlet.test.ts`.
- Closed/draft lifecycle presentation is covered by the shared status/lifecycle
  CSS and the existing Detail jest suite.

---

## 8. Tests run

- Targeted suites (activeAssignments, shell, detail, summary, manual-topic,
  polish-css, detail-outlet): green.
- `tsc -p app --noEmit`: clean.
- `eslint --ext .ts src`: clean.
- Full app Jest suite: **1922 passed, 1 failed** - the failure is the known,
  pre-existing, Sprint 29-owned `curriculumManifest.test.ts` SHA drift. That
  test reads only the repo-root `index.html` and the checked-in manifest JSON,
  **neither of which this phase touched** (all changes are under `app/`), so the
  red is unchanged from baseline and is not regenerated here.

---

## 9. Deferred (unchanged from audit §28)

- Present Mode redesign (roadmap-deferred runtime).
- Settings information architecture (trimmed intro only; categories unchanged).
- LMS import / `needsSetup` full live visual certification (needs a real Google
  import - Sprint 29 boundary test).
- Notifications, new dashboards/analytics/charts/chips, due dates, new
  assignment states.
- Assessment deployment, curriculum-manifest regeneration, production deploy,
  OAuth release disposition (Sprint 29).

---

## 10. External-state confirmation

No production Firebase mutation, no Google Classroom mutation, no OAuth
mutation, no assessment deployment, no production deployment, no curriculum
manifest regeneration. All inspection ran against a local, self-contained CSS
harness and jsdom tests.
