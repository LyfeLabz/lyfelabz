# Sprint 28.5C - Teacher Workspace Final UX Audit

Status: AUDIT ONLY. No production code, markup, CSS, copy, or tests were
changed. This document is the sole repository artifact of Phase 28.5C.
Phase 28.5D (implementation) is NOT started. This is the final design review
of the finished Teacher Workspace immediately before Teacher Platform v1 is
frozen. Sprint 29 (release certification) work was not performed.

Disposition: **RELEASE-READY WITH RECOMMENDED POLISH.**

---

## 1. Environment

| Item | Value |
|------|-------|
| Branch | `main` |
| HEAD | `0d8129f9f499a8a013adf272740ae7e9d91d2f7b` |
| HEAD subject | "Polish student workspace UX for v1" |
| `git status` at start | clean (no staged, unstaged, or untracked) |
| Phase 28.5B (student polish) committed | Yes (HEAD `0d8129f`) |
| Pre-existing working-tree changes | None |

### Inspection method (browser inspection performed)

The finished Teacher Workspace was run **live** against the repository's
canonical local environment, not audited from source alone:

- Full Firebase Emulator Suite started from `platform/firebase/`
  (`firebase emulators:start --project lyfelabz-prod`): Auth 9099, Firestore
  8080, Functions 5001, Hosting 5000, Storage 9199.
- Realistic teacher data seeded via the repository's own
  `platform/functions/seed-emulator.js` (`cert-teacher-001`: teacher custom
  claims, `school-beta` / `district-beta`, a `google.com` provider link, and
  the `lmsProviders` doc). This is the certification seed used by Sprint 24B/25.
- The real authenticated bundle (`/app/dist/bundle.js`, rebuilt 2026-08-20) was
  served by the Hosting emulator at `http://127.0.0.1:5000/app/`; `localhost`
  host detection routes the client to the emulator config.
- Teacher session established by minting an emulator ID/refresh token through
  the Auth-emulator Identity Toolkit endpoint and writing the Firebase JS SDK
  persistence record, because `signInWithPopup` cannot complete inside an
  automated browser (the emulator relay returns "No matching frame"). This is a
  test-harness sign-in only; no Google/OAuth state was touched.
- Populated states were built **through the live UI**: a manual class
  (`Period 3 Science`, Grade 7 - Block C) was created, a lesson (`What Is Life?`)
  was assigned to it, and the resulting real assignment was opened in Assignment
  Detail. No real Google Classroom mutation occurred.

States that require a live Google Classroom connection or LMS roster sync
(LMS-linked class card, `needsSetup` import flow, populated roster with
percentages, actionable late-recipient rows, publication success/failure/retry)
are out of local scope; they were assessed from **production source**
(`detail.ts`, `classes.ts`, `lmsPublication.ts`) and share the same unstyled
class family proven live on the manual-class surfaces. This is stated wherever
it applies.

The viewport matrix at 1280 / 1024 / 768 / 720 px was measured directly from
computed styles in the running app. The Browser pane clamps its layout viewport
at ~720 px minimum, so 375 px was characterized from the explicit `@media`
rules rather than rendered.

---

## 2. Inspected surfaces / states / files

Live (real bundle, emulator, seeded teacher):

- Global shell: header, left navigation, active state, footer (every surface).
- Curriculum: populated (49 cards), grade/topic filters, Assign dialog, assigned
  state (`✓ Assigned` + `View summary`), Active Assignments accordion (populated
  + expanded).
- Classes: empty state, create-class form, join-code panel, populated class card.
- Class workspace: Snapshot view, Roster view, class-section switcher.
- Assign workflow: Curriculum -> Assign -> dialog -> confirm -> success toast.
- Assignment Detail: header, meta, lifecycle control, summary, roster empty,
  late-recipient empty, question-results empty.
- Settings: intro, category list, Default grade control.
- Connected Services (Integrations): Google Classroom card, `Not connected`
  state, Connect control.
- Present Mode.

Production source traced (authority):

- `app/src/shell/{shell,header,navigation,footer}.ts`,
  `app/src/shell/surfaces/{curriculum,classes,snapshot,settings,workspace}.ts`,
  `app/src/shell/surfaces/shared/{activeAssignments,lmsPublication,...}.ts`.
- `app/src/assignments/detail/detail.ts`, `app/src/assignments/summary/card.ts`,
  `app/src/settings/integrations/integrations.ts`, `app/src/classes/*`.
- `app/index.html` (`<style id="shell-canonical">`, `<style id="auth-canonical">`).

### Viewport matrix

| Label | Dimensions | Represents | Method |
|-------|-----------|------------|--------|
| Desktop | 1280 x 720/900 | teacher laptop / desktop | measured live |
| Laptop | 1024 x 768 | classroom Chromebook / small laptop | measured live |
| Tablet | 768 x 1024 | tablet portrait / split Chromebook | measured live |
| Narrow | ~720 (pane floor) | phone-class / collapsed layout | measured live |
| Mobile | 375 | narrow phone | characterized from CSS |

---

## 3. Current architecture summary (as built)

The authenticated teacher lands on a **persistent-shell** application rendered
into `#app-root` by `mountTeacherShell`:

- **Header** (`.shell-header`): the canonical gold `LYFELABZ` Orbitron wordmark
  on a deep slate chrome (`#2b3a4f`), the teacher's display name, a low-visibility
  `○` "Notifications, coming soon" placeholder, and a quiet `Sign out`.
- **Left navigation** (`.shell-nav`): a `WORKSPACE` micro-label divider, then
  `Curriculum`, `Classes`, `Present Mode`, `Settings`, each with a Lucide-style
  outline icon. The active item gets a calm teal wash plus a 3px leading edge and
  `aria-current="page"`.
- **Outlet** that swaps one surface at a time; **footer** "LyfeLabz Teacher
  Platform".

Every shell module is a firebase-free pure DOM builder; all IO arrives through
injected callable seams wired at the entry point.

Surfaces:

- **Curriculum** (default landing): welcome headline, an `Active Assignments (n)`
  accordion, grade + topic filter chips, and a `minmax(250px, 1fr)` grid of 49
  equal-min-height lesson cards. Each card: grade + topic pills, a two-line-clamped
  title, and one primary action. Unassigned -> green `Assign` (opens a modal
  dialog). Assigned -> quiet `✓ Assigned` status + a right-aligned `View summary`.
- **Classes**: empty state offers `Import Class from Google Classroom` (secondary)
  and `Create LyfeLabz Class` (primary). Creating one yields a join-code panel and
  a class card that opens a **class workspace** (Snapshot / Roster switcher).
- **Assign dialog**: a real `role="dialog"` modal, one row per class with Date,
  Release time, Google Classroom topic, and Points; LMS-linked classes additionally
  expose a publish toggle and topic select (`ASSIGN_EXPERIENCE.md`, one dialog).
- **Assignment Detail**: opened from `View summary` / Active Assignments. Header,
  class + status meta, a lifecycle control (`Close` / `Reopen` / `Publish`), the
  Assignment Summary card, Roster, a late-recipient panel (`Students not yet
  assigned`), Question results, and - for LMS-linked assignments - a `Google
  Classroom` publication panel with status line and `Try again` / `Reconnect in
  Settings`.
- **Settings**: a private teacher-preferences surface. Today it carries one live
  control (Default grade for new classes), a link into Connected Services, and a
  descriptive list of preference categories most of which are future-facing.
- **Connected Services (Integrations)**: account-level Google Classroom
  connection management (`Not connected` / connected / action-needed).
- **Present Mode**: the future global presentation surface; runtime deferred, so
  it is an explanatory placeholder with a `Launch Present Mode` control.

**Root finding (mirrors the 28.5A student audit).** The behavior, authorization,
accessibility semantics, and data flow of every surface are certified. But the
teacher workspace was built in two eras. The **Sprint 20 Visual Identity
Refinement** designed the shell, Curriculum, the Assign dialog, the Classes
create/join-code panels, and Settings/Integrations - and these are genuinely
polished. Every surface built **after** Sprint 20 (Assignment Detail, the
Assignment Summary card, the Active Assignments dashboard, the class workspace /
Snapshot / Roster, the LMS import and `needsSetup` flows) emits its own
`shell-*` class names that **have no corresponding CSS**, so they render with
browser defaults: default buttons, list bullets, run-together text, raw ISO
dates, and (for Assignment Detail) a shell-less, centered, unstyled page. This
is the same class of gap 28.5A found on the student side, and it is the central
subject of this audit.

---

## 4. Strengths worth preserving

1. **The Sprint 20 identity is real and on-brand.** Gold Orbitron wordmark on
   slate chrome, warm-gray canvas, white cards with a soft hairline + micro
   elevation, LyfeLabz-green primaries, muted-teal navigation and focus. It reads
   as a calmer sibling of the student experience, not a generic LMS.
2. **Curriculum is the strong surface.** Equal-height cards, color-coded topic
   pills, two-line title clamp, a quiet assigned state, and no redundant `Preview`
   action. The `Assign` -> `✓ Assigned` control keeps a stable footprint.
3. **The Assign dialog is well-built and accessible.** `role="dialog"`,
   `aria-modal="true"`, `aria-labelledby`, focus moved into the dialog on open,
   inputs wrapped in real `<label>` elements, class pre-checked, sensible defaults
   pre-filled. Assigning a lesson is ~2 clicks.
4. **Connected Services is clear and calm.** A single Google Classroom card, a
   gray (non-alarm) `Not connected` pill, honest reassurance ("Your rosters,
   streams, and comments in Google Classroom are never modified"), and one Connect
   action. Import correctly lives on Classes, not here.
5. **The semantics behind the unstyled surfaces are excellent.** Assignment
   Detail and the late-recipient / publication panels use `role="status"`,
   `role="alert"`, and `aria-live` correctly; the LMS copy is calm and
   provider-neutral ("Publishing to Google Classroom did not succeed", "needs the
   same Google account you first connected"). None of the internal machinery
   (nonces, scopes, OAuth, error codes) leaks to the teacher.
6. **Empty and informational states answer the right questions.** "You do not
   have any classrooms yet", "No students are assigned to this activity yet. The
   summary will appear once students are added", "This assignment is a draft.
   Publish it before you can add students" - each says what happened, whether it
   is normal, and what to do next.
7. **Restraint.** No dashboards-of-dials, no analytics wall, no chip
   proliferation, no gamification. The workspace is focused; it is under-styled in
   places, not over-built.
8. **A success toast** confirms `Assigned What Is Life? to 1 class.` as a fixed,
   readable, scroll-independent banner.

---

## 5. Primary question - "does this feel like one coherent, polished, efficient product?"

Partly. Entering the workspace and using Curriculum, the Assign dialog, Classes
creation, and Connected Services, it feels finished and purpose-built. But the
moment a teacher opens **Assignment Detail** - the surface they visit every time
they check on assigned work - the entire shell disappears and the page becomes
centered, unstyled, default-button text. The class workspace (Snapshot / Roster)
and the Active Assignments dashboard have the same under-designed feel. So the
product is coherent and polished on its Sprint 20 surfaces and reads as a
prototype on its post-Sprint-20 surfaces. The inconsistency is the problem, and
it is bounded and fixable.

---

## 6. Highest-priority findings

| Priority | Finding | Teacher impact | Cost |
|----------|---------|----------------|------|
| P1 | Assignment Detail unmounts the shell and renders unstyled + centered (100 undefined `shell-assignment-detail-*` classes) | The most-visited management surface loses navigation and looks broken/prototype | MED |
| P1 | `shell-btn` and `shell-spinner` are undefined everywhere they are used (Detail, Summary card, Active Assignments) | Every action on those surfaces is a raw OS button; loading has no spinner | LOW |
| P1 | Curriculum density collapses at classroom widths: 3 cols @1280, **2 @1024, 1 @768**, sparse tall cards | On the exact devices teachers use, they scan far fewer lessons per screen through a 49-lesson list | LOW |
| P2 | Class workspace unstyled: `Grade 7Active` run-together; Snapshot/Roster switcher renders as a bulleted vertical list | The class "home" reads as an unfinished wireframe | LOW-MED |
| P2 | Active Assignments dashboard cards unstyled; raw ISO date (`2026-08-20`) | A genuinely useful dashboard looks unfinished and shows a developer-format date | LOW-MED |
| P2 | Assign dialog shows a `Google Classroom topic` field for a manual (non-LMS) class | A teacher with a non-Google class sees an inert Google field | LOW |
| P2 | Settings is mostly aspirational prose (4 of 5 categories describe features that do not exist) | Reads as unfinished for v1 | LOW-MED |
| P3 | Microcopy drift: `classrooms` vs `Classes`; `later sprints extend the Teacher Platform` on the Roster; `GradeGrade 7` spacing; Import listed-first but styled secondary | Small coherence and register issues | LOW |

---

## 7. Global shell / navigation - assessment

Strong and the most finished part of the product. The gold wordmark anchors
identity; it is immediately clear this is the teacher workspace and how it relates
to the student side (shared wordmark, shared greens). The active nav item is
obvious (teal wash + leading edge + `aria-current`). Header height mirrors the
public site nav; secondary controls (notifications placeholder, sign out) are
appropriately quiet. Navigation is consistent across every surface **except
Assignment Detail, which removes it entirely** (see §10). The `WORKSPACE`
micro-label reads as a section heading, not a second brand mark - correct.

Minor: the `○` notifications placeholder is inert ("coming soon"). It is quiet
enough to be harmless, but it is a non-functional control in the primary chrome;
consider removing it until notifications exist (P3).

---

## 8. Curriculum - assessment

The best surface, with one real efficiency problem: **density at classroom
viewports.** Measured live:

| Viewport | Curriculum columns | Card width |
|----------|-------------------|-----------|
| 1280 | 3 | ~315 px |
| 1024 | 2 | ~359 px |
| 768 | 1 | ~476 px |

The historical goal of a ~4-column, ~8-cards-per-viewport library is not met at
common widths: the 224px sidebar plus generous gaps plus the `minmax(250px,1fr)`
track yield only 3 columns at 1280 and **one giant card per row at 768**. Cards
carry only two pills + a short title + one action, so at 1024/768 each card is
mostly empty space and the equal `min-height: 8.75rem` makes them look sparse.
A teacher scanning 49 lessons on a Chromebook sees ~4 at a time.

Equal-height cards: yes. No redundant Preview: yes. Unified assignment-summary:
yes. Assigned-state clarity: yes (`✓ Assigned` quiet, `View summary` on the
right). The fix is to tighten the grid (smaller `min` and a smaller card
`min-height`) so 1024 shows 3 and 768 shows 2.

---

## 9. Classes - assessment

The list surface is clean and the create flow is efficient. Import vs Create is
correctly located on Classes (not Settings). Two issues:

- **Hierarchy/copy tension.** The explanatory line and reading order lead with
  `Import Class from Google Classroom`, but Import is styled as the quiet
  secondary (outline) button while `Create LyfeLabz Class` carries the green
  primary weight. The visual weight contradicts the recommended-first action.
  Decide which is primary and make copy and weight agree (P2).
- **Class card is center-aligned** (measured `text-align: center`, ~191px wide),
  unlike every other card in the product, which is left-aligned. It also reads as
  a slightly orphaned narrow tile. Left-align for consistency (P2).

Wording: the header and empty state say `classroom(s)` ("1 classroom", "You do
not have any classrooms yet") while the surface, nav, and everything else say
`Classes` / `class`. Pick one term (P3).

The LMS-linked class card and the import panel could not be rendered live
(no Google connection); from `classes.ts` they use the same unstyled
`shell-classes-import-*` / `shell-class-*` family and will share the class
workspace's under-designed presentation.

---

## 10. Needs-setup workflow - assessment

Not reproducible live without a real Google Classroom import, so assessed from
`classes.ts`. The `needsSetup` state is a distinct, well-modeled affordance
(`shell-class-setup-affordance`, `-headline`, `-intro`, `-form`, `-cta`,
`-unavailable`) with its own grade/block setup form and an explicit "not fully
active yet" intent. The architecture is sound and must not change. The concern is
purely presentational: every `shell-class-setup-*` class is unstyled, so the
setup affordance will render with the same default-form, bulleted, un-carded look
as the rest of the class workspace. Its clarity depends on styling it did not
receive. Style it as part of the class-workspace pass; validate the live
appearance during the Sprint 29 Google boundary test.

---

## 11. Assign workflow - assessment

The strongest workflow. Entry point is obvious (green `Assign` on every card).
The dialog is a proper modal, the class is pre-checked, Date/Time/Points are
pre-filled with sensible defaults, and the primary action (`Assign`) is obvious
and pre-focused. Confirmation is a calm toast plus an immediate `✓ Assigned`
state on the card and a new Active Assignments entry. Cognitive load is low; the
teacher does not need to understand OAuth or publication semantics to assign to a
manual class. Two-click assign.

One clarity issue: for a **manual (non-LMS) class**, the dialog still renders a
free-text `Google Classroom topic` input (placeholder `None`, enabled). There is
no Google Classroom to publish to, so the field is inert and mildly confusing.
Hide or omit the Google Classroom topic field when the row's class is not
LMS-linked (P2). (For LMS-linked classes the publish toggle + topic select are
correct and belong.)

---

## 12. Assignment Detail - assessment

This is the headline problem. Opening `View summary` produces, measured live:

- `hasShellHeader: false`, `hasShellNav: false` - **the entire teacher shell is
  unmounted.** The teacher loses the header, wordmark, and all global navigation;
  only a `Back to Curriculum` button returns them.
- `#app-root` `text-align: center` - because the shell-header is gone, the
  `#app-root:has(> .shell-header)` left-align override no longer matches and the
  base centered layout takes over. The whole surface is centered.
- The meta renders as stacked centered label/value lines
  (`Class | Period 3 Science · Grade 7 | Status | Published`).
- The lifecycle control (`Close assignment`) is `class="shell-btn ..."` and
  `shell-btn` is undefined -> a raw OS button.
- Of the surface's ~100 `shell-assignment-detail-*` classes, only the shared
  Assignment Summary card (`shell-card`) and the close/reopen/publish **dialogs**
  (which reuse the styled `shell-assign-*` classes) have any CSS. Roster, late
  recipients, question results, and the LMS publication panel are unstyled.

Structural note: because Assignment Detail removes the shell-header, it also
falls **out** of the teacher `.shell-*` styling scope and **into** the student
auth-card scope (`body:not(:has(#app-root > .shell-header))`), which is what
centers it - yet it uses teacher `shell-assignment-detail-*` classes that neither
scope targets. So it is styled by nobody.

To the three questions the surface must answer at a glance:
- *What is this assignment?* Legible (title present) but unstyled.
- *What state is it in?* `Published` is present as a plain centered word, not a
  status treatment.
- *What can I do here?* The lifecycle action is a default button with no visual
  priority; on a populated assignment the roster, late-recipient, and publication
  controls would all compete at equal (zero) weight.

The copy and semantics are certified and good; the surface reads as accumulated
rather than composed purely because it was never given a visual design. This is
the single highest-value 28.5D target.

---

## 13. Late-recipient UX - assessment

Behavior certified in Sprint 28; presentation assessed from `detail.ts` plus the
live empty state. The section is correctly scoped and calmly worded: heading
`Students not yet assigned`; empty state `Every enrolled student is already
assigned`; each eligible student offers `Add to assignment`; success announces
`Added to assignment.` via a single `role="status"`/`aria-live="polite"` region;
in-flight announces `Adding...`; failures use a separate `role="alert"` line; the
closed/draft informational notes ("This assignment is closed. Reopen it to add
students." / "This assignment is a draft. Publish it before you can add
students.") read as normal lifecycle information, not errors. This is well
designed at the semantic level.

The only gap is visual: every `shell-assignment-detail-late-recipients-*` class
is unstyled, so student rows have no card/row treatment, the per-student `Add`
button is a default button, and success/failure/note lines are plain text. With a
real roster this becomes an undifferentiated list where it is not visually obvious
which `Add` belongs to which student. The section does not deserve *more*
prominence; it needs a modest row treatment and a real button so scanning and
"Add this student" association are clear.

---

## 14. Google Classroom UX - assessment

Presentation layer only. Two distinct concepts are correctly separated:
**connection** (Connected Services / Integrations - polished, clear `Not
connected` state, honest non-modification reassurance) and **publication** (the
per-assignment `Google Classroom` panel inside Assignment Detail). The publication
status lines are calm and provider-neutral, retry/reconnect language is sensible
(`Try again`, `Reconnect in Settings`, "your assignment was scheduled"), and the
teacher is never asked to understand OAuth. It is clear when the teacher is acting
in LyfeLabz vs Google Classroom.

The gaps are presentational and inherit §12: the publication panel uses the
unstyled `shell-assignment-detail-lms-*` family and `shell-btn`, so on a real
LMS-linked assignment the status line and retry/reconnect buttons render as plain
text and default buttons. Integration is visible without dominating - if anything
it currently under-presents on the Detail surface. No architectural change is
warranted; style the panel with the rest of Detail.

---

## 15. Action hierarchy - findings

- **Primary green** (`Assign`, `Create LyfeLabz Class`, Assign-dialog `Assign`)
  is consistent and correctly the loudest control. Good.
- **`shell-btn` buttons** (Assignment Detail `Close/Reopen/Publish`, Active
  Assignments `Open assignment`, Summary `Try again`, late-recipient `Add`) are
  **undefined -> raw OS buttons**, so lifecycle and management actions have *less*
  weight than a Curriculum `Assign`. The hierarchy inverts on exactly the surfaces
  where lifecycle decisions happen.
- **The Connect Google Classroom button** is an uppercase, letter-spaced outline
  pill - a different button language from the green title-case primaries and the
  outline `Import` button. Three visual button idioms now coexist.
- Destructive/lifecycle framing: `Close assignment` is a neutral default button
  (not alarming) - acceptable, but it should read as a deliberate secondary/danger
  action once styled, not a nothing-button.

Net: the Sprint 20 surfaces have a coherent primary/secondary system; the
post-Sprint-20 surfaces have no button system at all. Defining `shell-btn` (with
primary/secondary/danger variants) is the single highest-leverage consistency fix.

---

## 16. Cards / containers - assessment

Two design languages coexist. Sprint 20 cards (`shell-card`, lesson cards, assign
rows, integrations candidate, create-class form) share one grammar: `~10px`
radius, soft hairline (`--tw-hairline`), micro elevation, warm-white surface,
consistent padding. Post-Sprint-20 "cards" (Assignment Detail sections, Active
Assignment cards, class-section switcher, roster rows, snapshot groups) are not
cards at all - they are unstyled `div`s and `ul`s. The class card is the one
outlier that *is* a `shell-card` but is center-aligned. The remedy is not to make
everything identical; it is to bring the newer containers into the existing
shared grammar (hairline + radius + elevation + padding tokens already exist as
CSS variables).

---

## 17. Status system - assessment

Language is consistent and calm across the workspace: `Draft`, `Published`,
`Assignment closed`, `Not connected`, `action needed`, `✓ Assigned`, `Active`.
There is **no chip proliferation** - the interface is not a wall of colored pills,
which is good and should be preserved. The verified defects are presentational:

- On the class workspace, grade and status render with no separator
  (`Grade 7Active`); the accessible name is correct (`Class status: Active`) but
  the visible text is not (missing the separator/label). Fix the visible
  separator (P2).
- On Assignment Detail, `Published` / `Assignment closed` / `Draft assignment`
  are plain centered words with no status treatment; they should read as states,
  not body text. This falls out of the §12 styling pass.

Recommendation: keep the restraint; give the few real statuses a single quiet
consistent treatment (one pill style, reused) rather than adding more.

---

## 18. Empty / loading / error states - findings

- **Empty states are a genuine strength** (Classes, Assignment Summary, Roster,
  late recipients, Connected Services) - each answers what/normal/next, no
  marketing copy, no illustration.
- **Loading**: the surfaces use `Loading assignment` / `Loading students...` in
  `role="status"` regions, but the accompanying `shell-spinner` class is
  **undefined**, so there is no spinner - just text. Acceptable (calm, shift-free)
  but the intended spinner never renders.
- **Error/callout parity check (the 28.5A F7 analog).** On the *student* side,
  28.5B fixed the `error-banner` testid mismatch (the teacher CSS now targets
  `assignments-error` / `results-error` directly, confirmed at
  `index.html:1886-1888`). The **teacher** analog is different but real:
  Assignment Detail's error lines (`shell-assignment-detail-*-error`,
  `-close-error`, `-publish-error`, `-late-recipients-error`) are styled by
  **class**, and those classes are **undefined**, so a real teacher-side error
  would render as plain text with no red callout - the same net effect as the
  student F7 (correct `role="alert"` semantics, absent error appearance). Verified
  by source: no teacher CSS rule targets these classes, and the teacher testid CSS
  is entirely scoped to the student auth-card layout. Fold error-callout styling
  into the Detail pass.

---

## 19. Accessibility - findings

Practical review across representative workflows. Semantics are strong; the gaps
are presentational and minor.

Strengths (verified live / in source):
- Landmarks: `banner`, `navigation` ("Teacher workspace sections", with
  `aria-current` on the active item), `contentinfo`.
- The Assign dialog is a correct modal: `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby="assign-dialog-title"`, focus moved to the confirm control on
  open, and inputs wrapped in real `<label>` elements (accessible names present).
- Status/error semantics: `role="status"` + `aria-live="polite"` for progress and
  publication lines; `role="alert"` for failures (Sprint 28).
- Status is not conveyed by color alone (text labels throughout; the class status
  carries `Class status: Active` as its accessible name).
- Keyboard: nav, filters, Assign, dialog, and class switcher are all real buttons
  and operable; no keyboard traps observed; Escape/overlay handling on the dialog.

Gaps:
- The unstyled buttons (`shell-btn`, class-section switcher, Active Assignment
  `Open`) are **not** in the Sprint 20 focus-ring allowlist, so they fall back to
  the browser default focus outline. Focus is visible (acceptable) but
  inconsistent with the teal focus ring used everywhere else. When `shell-btn` is
  defined, add it to the focus-ring rule.
- The class-section switcher (`Snapshot` / `Roster`) marks no visible active state
  and no `aria-current`; the active view is only inferable from the default button
  border. Give it a real selected treatment (and `aria-current`) when styled.
- Assignment Detail, being shell-less and centered, has no `main`-scoped left
  reading order and no visible status treatment; heading order should be verified
  when it is styled (the title should be the surface `h1`/`h2` and meta subordinate).
- Contrast on the styled surfaces is fine (Sprint 20 states WCAG AA on white); the
  unstyled default-gray text on Detail/Snapshot is legible but not designed.

No release-blocking accessibility defect was found.

---

## 20. Responsive behavior - by viewport

- **1280 (desktop):** Shell 224px + content; Curriculum 3 columns; no horizontal
  scroll. Good, though Curriculum is not 4-up.
- **1024 (classroom laptop):** Sidebar persists; Curriculum drops to **2 columns**
  of sparse 359px cards (~4 lessons visible). No horizontal scroll. This is the
  most important density regression because it is the most common classroom device.
- **768 (tablet / split Chromebook):** The single-column shell breakpoint is 720,
  so the 224px sidebar remains beside a 476px content column and Curriculum becomes
  **1 column** - one oversized card per row. No horizontal scroll, but a poor use
  of space at a real classroom width.
- **~720 (collapsed):** Shell body goes single-column; the left nav becomes a
  horizontal-scroll row led by the `WORKSPACE` label. Functional; no horizontal
  page overflow.
- **375 (phone, from CSS):** `@media (max-width:480px)` hides the header identity,
  compacts header padding, wraps Curriculum card actions, and the Assign dialog
  goes full-width with single-column fields. Coarse-pointer rules lift touch
  targets to 44px. Structurally sound; not rendered here (pane floor).
- **Assignment Detail** at narrow widths: because it is shell-less it does not
  benefit from the shell's responsive rules; it stayed centered with no horizontal
  overflow at the widths tested, but its narrow-width behavior should be
  re-verified once it is styled.

No accidental horizontal scrolling, clipping, or dialog-exceeds-viewport was
observed at any tested width. The priority responsive issue is **density at
768-1024**, not breakage.

---

## 21. Cognitive load - classification

| Surface | Essential | Useful | Optional | Distracting |
|---------|-----------|--------|----------|-------------|
| Curriculum | Title, grade/topic, Assign/Assigned, filters | Active Assignments accordion, View summary | Welcome headline | Excess card whitespace at 1024/768 |
| Classes | Class name, grade/block, Import/Create | Join code, status | - | `classroom` vs `class` wording |
| Class workspace | Class name, Roster/Snapshot | Status | "will grow into this space as later sprints..." | `Grade 7Active`; bulleted switcher |
| Assign dialog | Class, Date, Points, Assign | Release time, LMS topic (LMS classes) | - | GC topic field on manual classes |
| Assignment Detail | Title, status, lifecycle action, roster/results | Late recipients, publication panel | Draft-summary note | Center layout + default buttons (noise from lack of hierarchy) |
| Settings | Default grade, Connected Services link | - | 2-paragraph philosophical intro | 4 of 5 categories describe nonexistent features |
| Present Mode | (nothing live yet) | - | - | Two paragraphs + numbered list explaining a deferred feature |

The workspace is not overloaded with controls; the cognitive-load issues are
**verbose future-facing prose** (Settings, Present Mode) and **missing hierarchy**
(Assignment Detail) rather than too many features. A teacher can move between
classes quickly on the Sprint 20 surfaces; Assignment Detail is where they must
work to parse the page.

---

## 22. Workflow efficiency - the five major jobs

| Job | Meaningful steps | Friction |
|-----|------------------|----------|
| Assign a lesson | Curriculum -> `Assign` -> confirm (2 clicks; class pre-checked, defaults filled) | None. Exemplary. |
| Create a manual class | Classes -> `Create LyfeLabz Class` -> name/grade/block -> `Create` | None; join code shown immediately. |
| Import a Google Classroom class | Classes -> `Import` -> Google consent -> pick course -> grade/block setup -> active | Not locally testable; multi-step but each step is bounded. Setup affordance is unstyled. |
| Review an assignment | Curriculum `View summary` (or Active Assignments -> `Open`) -> Detail | Detail drops the shell -> feels like a dead-end pod; only `Back to Curriculum` returns; unstyled. |
| Add a late student | Detail -> late-recipient row -> `Add to assignment` | Reachable and announced; unstyled rows make student-to-Add association weak on a real roster. |

No redundant confirmations, no repeated data entry, no true dead-ends. The one
efficiency dent is that Assignment Detail leaves the shell, so returning to
Classes/Settings requires going back to Curriculum first.

---

## 23. Microcopy - worthwhile changes only

| Where | Current | Proposed |
|-------|---------|----------|
| Classes header / empty | "1 classroom" / "You do not have any classrooms yet." | "1 class" / "You do not have any classes yet." (match `Classes`) |
| Class Roster (manual) | "The full class-level workspace will grow into this space as later sprints extend the Teacher Platform." | "Students who join with the class code will appear here." (remove internal roadmap language) |
| Settings intro | 2 paragraphs ("...not a dashboard, an account console... a calm place to make LyfeLabz feel like your own.") | One sentence: "Manage your LyfeLabz preferences." |
| Assign dialog (manual class) | `Google Classroom topic` field present | Omit the field when the class is not LMS-linked |
| Active Assignment date | `2026-08-20` (raw ISO) | "Aug 20, 2026" |
| Class workspace | `Grade 7Active` | `Grade 7 · Active` |

Do not reword the LMS publication / late-recipient copy - it is already calm and
correct.

---

## 24. Cross-surface consistency - accumulated inconsistencies

1. **Two design eras.** Sprint 20 surfaces are styled; post-Sprint-20 surfaces are
   not. This is the dominant inconsistency and the source of most findings.
2. **Shell membership.** Every surface renders inside the shell **except
   Assignment Detail**, which unmounts it. Inconsistent chrome and reading
   alignment (left everywhere, centered on Detail).
3. **Button idioms.** Green solid primary (Curriculum/Classes) vs undefined
   `shell-btn` defaults (Detail/Active Assignments) vs uppercase outline pill
   (Connect Google Classroom).
4. **Card alignment.** Left-aligned lesson/assign/integration cards vs the
   center-aligned class card.
5. **Container language.** Real `shell-card` grammar vs unstyled divs/uls on the
   newer surfaces.
6. **Terminology.** `class` vs `classroom`.

This is the highest-value lens: none of these are architectural; all are the
visible residue of building features across sprints without a closing visual pass.

---

## 25. Student / teacher product-family consistency - assessment

The two workspaces share the right family traits after 28.5B: the gold Orbitron
`LYFELABZ` wordmark, the slate/warm-gray palette, LyfeLabz-green primaries, calm
error presentation, and restrained (non-gamified) tone. They are correctly *not*
identical - the teacher surface is a denser sidebar shell; the student surface is
a simpler centered auth-card. The relationship is appropriate. One irony worth
noting: 28.5B just gave the *student* surface its missing visual layer (tablist,
list cards, primary-button, error callout); the teacher surface now has the
*same* class of unstyled-newer-surfaces gap that 28.5A described, one layer up.
28.5D is the teacher-side equivalent of the 28.5B pass.

---

## 26. Product-design assessment - does it feel finished?

- Finished and trustworthy on: the shell, Curriculum, the Assign dialog, Classes
  creation, Connected Services.
- Fast: yes - core workflows are 2 clicks and the app is responsive.
- Purpose-built for teachers: yes in intent and information architecture.
- Google Classroom feels integrated (connection) but under-presented on Assignment
  Detail (publication panel unstyled).
- Still looks like a prototype on: Assignment Detail, the class workspace
  (Snapshot/Roster), the Active Assignments dashboard, and any populated
  roster/late-recipient/publication view.

Verdict: a well-architected product with one uneven coat of paint. The unfinished
surfaces are exactly the ones a teacher uses to *manage* (not assign) work, so the
gap is felt. It is bounded, low-risk, and squarely a presentation problem.

---

## 27. Proposed Phase 28.5D implementation package (5 changes)

Bounded, presentation-only, high-value + low-risk. No backend, Firestore, OAuth,
Google API, routing, assignment-state, or domain change.

### D1 - Define `shell-btn` (and `shell-spinner`) globally
- **Problem:** `shell-btn` / `shell-spinner` are undefined; every action on
  Detail, the Summary card, and Active Assignments is a raw OS button and loading
  shows no spinner.
- **Solution:** Add a `shell-btn` control (with `--primary` / `--secondary` /
  `--danger` modifiers reusing existing `--tw-*` tokens) and a `shell-spinner`,
  in `<style id="shell-canonical">`. Add `shell-btn` to the Sprint 20 focus-ring
  rule.
- **Benefit:** Instantly gives every post-Sprint-20 action a coherent, on-brand
  button and restores the intended loading affordance.
- **Footprint:** `app/index.html` (CSS only).
- **Regression risk:** Very low (adds rules for currently-unstyled classes;
  cannot alter already-styled controls).
- **Validation:** Re-render Detail / Active Assignments live; confirm button
  states, hover, focus ring, disabled; jest CSS-presence tests in the style of
  `curriculum.assign-toast-css.test.ts`.

### D2 - Style Assignment Detail and keep it inside the shell
- **Problem:** Detail unmounts the shell (loses nav), centers, and is unstyled
  (100 undefined classes).
- **Solution:** (a) Add a `shell-assignment-detail-*` stylesheet block:
  left-aligned page, section cards reusing the `shell-card` grammar, a meta
  label/value row, a real status treatment, and styled roster / late-recipient /
  question / LMS panels. (b) Preferred: mount Detail **inside the shell outlet**
  so the header + nav persist and the `#app-root` left-align applies; if the mount
  target is entangled with the certified router, the CSS-only fallback is to give
  the shell-less Detail its own left-aligned page frame. The mount decision is the
  one item that needs Chris's call (see §29).
- **Benefit:** Turns the most-visited management surface from a prototype pod into
  a composed, navigable page; answers what/state/actions at a glance.
- **Footprint:** `app/index.html` (CSS) and, for the shell-mount option,
  `app/src/assignments/detail/registry.ts` / the Curriculum detail seam
  (`shell/surfaces/curriculum.ts`) mount target - no router, no callable, no state.
- **Regression risk:** CSS-only = low. Shell-mount = medium (touches mount wiring;
  covered by existing `detail.test.ts` posture tests).
- **Validation:** Live emulator walkthrough of published + closed + draft states
  and a populated roster; existing Detail jest suite; Sprint 29 Google boundary
  test for the LMS publication panel.

### D3 - Style the class workspace (Snapshot / Roster) + fix the status separator
- **Problem:** `Grade 7Active` run-together; Snapshot/Roster switcher renders as a
  bulleted vertical list with no active state; snapshot/roster bodies unstyled.
- **Solution:** Style `shell-class-nav` as a horizontal segmented/tab control with
  a selected state + `aria-current`; add a visible separator between grade and
  status; give the snapshot/roster foundation the shared card/spacing grammar.
- **Benefit:** The class "home" reads as a finished surface.
- **Footprint:** `app/index.html` (CSS). Optional 1-line separator markup in
  `classes.ts` if a CSS `::before` is not preferred.
- **Regression risk:** Low.
- **Validation:** Live manual-class workspace at desktop/tablet; jest CSS-presence.

### D4 - Style the Active Assignments dashboard + humanize the date
- **Problem:** Expanded cards are unstyled (no border/padding), the `Open
  assignment` action is a default button, and the date is raw ISO.
- **Solution:** Give `shell-active-assignment-card` the shared card grammar and a
  clear progress/state line; format the date as "Aug 20, 2026"-style short date
  in `activeAssignments.ts`.
- **Benefit:** A genuinely useful "what's live right now" dashboard looks finished.
- **Footprint:** `app/index.html` (CSS) + one date-format helper in
  `activeAssignments.ts`.
- **Regression risk:** Low.
- **Validation:** Live expanded dashboard; existing `activeAssignments.test.ts`.

### D5 - Curriculum density at classroom viewports
- **Problem:** 3 cols @1280, 2 @1024, 1 @768; sparse tall cards; 49-lesson single
  scroll.
- **Solution:** Reduce the grid `minmax` min (e.g. ~200px) and the card
  `min-height`, and/or tighten gaps, so 1024 shows 3 and 768 shows 2 without
  breaking the equal-height contract or the two-line title clamp.
- **Benefit:** Teachers scan more lessons per screen on the exact devices they use.
- **Footprint:** `app/index.html` (a handful of Curriculum grid/card values).
- **Regression risk:** Low-medium (recheck the two-line clamp and equal-height at
  all four widths; covered by `curriculum.layout.test.ts`).
- **Validation:** Live measurement at 1280/1024/768; existing layout jest suite.

Optional companion (fold into whichever pass touches the file), low cost:
the §23 microcopy fixes and hiding the Assign-dialog Google Classroom topic field
for non-LMS classes.

---

## 28. Deferred ideas - explicitly NOT in v1 polish

- **Present Mode redesign.** Its runtime is deferred by the roadmap; the
  explanatory placeholder is intentional. Do not restructure it for v1 (at most,
  quiet its prose). Deferred.
- **Settings information architecture.** The aspirational category list describes
  future preferences by design. Trim the intro (§23) but do not build or restructure
  the categories. Deferred.
- **LMS import / `needsSetup` full visual certification.** Style them in D3's
  family, but final live validation needs a real Google Classroom import - that
  belongs with the Sprint 29 Google boundary test, not a local pass.
- **Any architectural change** to assignment authorization/lifecycle, Google
  Classroom OAuth, incremental consent, class linkage, roster sync, recipient
  semantics, assessment revisions, v2 lesson architecture, the deep-link resolver,
  onboarding authority, or the `/app/` return path. Out of scope by rule.
- **Notifications.** The `○` placeholder should either be removed or left alone;
  building notifications is post-v1.
- **New dashboards, analytics, charts, chips, or banners.** Explicitly avoid; the
  workspace should stay focused.
- **Assessment deployment, curriculum-manifest regeneration, production
  deployment, OAuth release disposition.** Sprint 29.

---

## 29. Recommendation

**Approve the 28.5D package as scoped, with one decision to confirm first.**

Four of the five changes (D1, D3, D4, D5) plus the microcopy companion are
CSS-and-token, low-risk, and can proceed as-is; together they close the
"two-eras" inconsistency and are the teacher-side equivalent of the 28.5B student
pass.

The one item needing Chris's decision is **D2's mount question**: whether
Assignment Detail should be re-mounted inside the shell (preserving header + nav,
the correct fix, but it touches mount wiring and carries medium regression risk)
or receive a CSS-only left-aligned page frame while remaining shell-less (lower
risk, but the teacher still loses global navigation on that surface). Recommend
the shell-mount if the mount target is decoupled from the certified router (it
appears to be a seam, not a route); otherwise ship the CSS-only frame for v1 and
log the re-mount as a fast-follow.

If the goal is the lowest-risk v1 freeze, D1 + D3 + D4 + D5 + microcopy is a clean,
high-value, presentation-only package. D2 (styling) should be included; only D2's
*mounting* decision needs sign-off.

Nothing here is release-blocking. The Teacher Workspace is release-ready with this
recommended polish, and the polish is bounded to roughly one focused
implementation phase.

---

## Phase 28.5D implementation outcome

The 28.5D package (§27) was implemented; details in
`SPRINT_28_5_TEACHER_WORKSPACE_POLISH.md`. Summary:

- **D1** - `shell-btn` (calm secondary default, `-primary`/`-danger` modifiers)
  and `shell-spinner` defined in the shell canonical stylesheet and added to the
  teal focus-ring allowlist.
- **D2A** - Assignment Detail now renders inside the persistent shell via a
  bounded shell/outlet seam (`setOutletController` on the existing
  `assignmentDetail` wiring; `mountTeacherShell` registers the outlet; the
  opener renders through `controller.show`). Header/nav/footer persist,
  Curriculum stays active, Detail is left-aligned (no shell destruction),
  `Back to Curriculum` and scroll-restoration unchanged. Global nav leaves
  Detail cleanly. No router/history/breadcrumb architecture added.
- **D2B** - the `shell-assignment-detail-*` family styled: page frame, header
  card with label/value meta and a status pill, section cards, roster/late-
  recipient/question/LMS treatments, red error callouts, calm Close.
- **D3** - class workspace: segmented Snapshot/Roster switcher with a non-color
  active underline, `Grade 7 · Active` separated, left-aligned class cards,
  roadmap copy removed.
- **D4** - Active Assignments card grammar + humanized `Aug 20, 2026` date.
- **D5** - Curriculum density measured **4 @1280 / 3 @1024 / 2 @768** (was
  3/2/1), no horizontal overflow, cards not cramped.
- **Microcopy** - `class(es)` wording, trimmed Settings intro, manual-class
  Google Classroom topic field hidden (LMS-linked preserved).

Disposition: **COMPLETE.** Full app Jest 1922 passed / 1 known Sprint 29-owned
manifest SHA drift (untouched here); tsc + lint clean. Nothing staged,
committed, or pushed; no external mutation.

---

## Repository state at audit close

- HEAD: `0d8129f9f499a8a013adf272740ae7e9d91d2f7b` (unchanged).
- Only this file added: `docs/platform/SPRINT_28_5_TEACHER_WORKSPACE_UX_AUDIT.md`.
- No production code, markup, CSS, copy, or test changed.
- Nothing staged, committed, or pushed.
- No deploy; no production Firebase, Google Classroom, OAuth, assessment, or
  curriculum-manifest mutation. All inspection ran against the local emulator
  suite with seeded data.
