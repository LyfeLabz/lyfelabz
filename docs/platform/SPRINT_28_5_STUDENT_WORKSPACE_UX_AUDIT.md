# Sprint 28.5A - Student Workspace / My Assignments UX Audit

Status: AUDIT ONLY. No production code, markup, CSS, copy, or tests were
changed. This document is the sole repository artifact of Phase 28.5A.

Author pass: inspect -> experience -> analyze -> recommend, then stop for
review. Phase 28.5B (implementation) is NOT started.

---

## 1. Environment

| Item | Value |
|------|-------|
| Branch | `main` |
| HEAD | `60f28e9aaaffd3c31f297a5fc49a011c65e9ae08` |
| HEAD subject | "Complete Sprint 28 teacher UX and v2 curriculum hardening" |
| `git status` at start | clean (no staged, no unstaged, no untracked) |
| Sprint 28 committed | Yes (HEAD) |
| Pre-existing working-tree changes | None |

Sprint 28 is committed and certified with documented limitations. There are
no unrelated pre-existing working-tree changes to preserve.

### Inspection method

The authenticated student workspace has no standalone dev server. It runs only
through the full Firebase Emulator Suite (Auth + Firestore + Functions) with a
seeded, Google-authenticated student session - a heavy, stateful stack whose
setup is disproportionate to a presentation audit and would touch auth state.

The student surface modules are, by certified design, **firebase-free pure DOM
builders that receive their data through injected callables** (the same seam
the unit tests use). This audit therefore browser-inspected the **real
production surface module** (`makeActiveStudentSurface`) and the **real
deep-link arrival module** (`renderDeepLinkArrival`), bundled unmodified with
the project's own `esbuild`, mounted with in-memory fake callables, rendered
into the **byte-for-byte real `app/index.html` `<style>` blocks**. The DOM the
student sees and the CSS that styles it are production-faithful. No production
file was modified; no Firebase, Google, or OAuth state was touched. The harness
lived entirely in the session scratchpad.

States browser-certified this way: A (multi actionable), A/B (mixed status),
My Results (populated), C (empty), D (loading), E (recoverable error), and the
Google Classroom deep-link informational arrival. The deep-link loading and
deep-link retryable-error states were code-reviewed and are structurally
identical unstyled cards to the informational state that was browser-certified.

---

## 2. Inspected routes / states / files

Production files traced (not assumed from Sprint docs):

- `app/src/router/surfaces/index.ts` - `makeActiveStudentSurface` (the student
  landing surface: `My Assignments` + `My Results` tablist), `renderAssignmentsList`,
  `renderStatusChip`, `renderAssignmentsEmpty`, `renderAssignmentsError`,
  `renderResultsList`, `renderResultsEmpty`, `renderResultsError`.
- `app/src/router/surfaces/shared.ts` - shared surface primitives
  (`renderHeader`, `renderHeadline`, `renderParagraph`, `renderPrimaryButton`,
  `renderReturnLink`, `renderSignOut`, `renderErrorBanner`,
  `renderLoadingIndicator`).
- `app/src/assignments/studentList/types.ts` - the `assignmentsListForStudent`
  per-item contract.
- `app/src/assignments/studentList/launch.ts` - launch URL builder / v2 override.
- `app/src/assignments/studentResults/types.ts`,
  `app/src/assignments/studentResults/aggregate.ts` - status model + derivation.
- `app/src/assignments/deepLink/arrival.ts` + `types.ts` - `/app/a/{id}` arrival.
- `app/index.html` - global CSS. The student surface renders in the **auth-card
  layout** (`body:not(:has(#app-root > .shell-header))`, lines ~1742-1948), not
  the teacher `.shell-*` chrome.

### Viewport matrix

| Label | Dimensions | Represents |
|-------|-----------|------------|
| Desktop | 1280 x 800 / 1280 x 1400 | laptop / Chromebook |
| Tablet | 768 x 1024 | classroom touchscreen, split Chromebook |
| Mobile | 375 x 812 (coarse pointer emulated) | narrow phone |

---

## 3. Current architecture summary (as built)

The authenticated student lands on one surface rendered into `#app-root`. It is
a **WAI-ARIA tablist with two tabs** - `My Assignments` and `My Results` - over
a single shared panel (PDR-024i two-surface menu). It renders in the **auth-card
layout**: a centered ~32rem white card with the gold `LYFELABZ` Orbitron
wordmark, on the same page-shell used for sign-in / provisioned / error
surfaces. It is deliberately **not** the teacher sidebar shell.

**My Assignments** consumes the certified `assignmentsListForStudent` callable.
Each item exposes only `{ assignmentId, lessonSlug, title, status:"published",
publishedAt }`. There is **no class name, no teacher name, and no due date** in
the contract, and the only assignment status the student ever sees here is
`published`. A status chip (Ready to Begin / Improving / Well Done! / Perfect
Score, PDR-024l) is decorated onto each card from the caller-scoped results
read when that read succeeds; when it fails the card degrades to launch-only.
Each card is title + status chip + an **Open assignment** button that navigates
to the lesson launcher URL.

**My Results** consumes the caller-scoped `assessmentAttemptsList` read,
self-aggregates by assignment client-side, and shows title, status chip, best
score, attempt count, and **Improve My Score** on every less-than-perfect best.

Every view supports loading, populated, empty, and recoverable-error states,
plus a calm sign-out and a "Return to public lessons" link. The Google
Classroom deep link `/app/a/{assignmentId}` resolves through a read-only server
resolver and either hands off silently to the runtime or renders one calm,
non-leaking arrival card.

The return path from a completed v2 assessment is a native
`<a href="/app/">` **Back to My Assignments** (Sprint 28 O3, certified). It
lands the student on a fresh load of this surface, defaulting to My Assignments.

**Root architectural finding:** Sprint 27/28 built the student side by "narrow
wiring and integration rather than a student-platform rebuild." The behavior,
authorization, accessibility semantics, and data flow are certified. The
**visual presentation was never designed.** The surface renders bare semantic
HTML (`<ul>`, `<h2>`, `<button>`) that inherits only the auth-card typography
plus browser defaults. Almost none of the student-specific structure - the
tablist, the assignment list, the cards, the status chips, the primary action
button - has any dedicated CSS. This is the central subject of this audit.

---

## 4. Strengths worth preserving

These are genuine and should not be lost in any 28.5B work:

1. **The auth-card shell is calm and on-brand.** Gold Orbitron `LYFELABZ`
   wordmark, soft shadow, rounded card, restrained slate palette, generous
   whitespace. It reads as LyfeLabz, not a generic LMS.
2. **The empty state is excellent** - the best-looking state in the whole
   surface precisely because it has no list to mangle. Calm, reassuring,
   correctly worded ("No assignments are open for you right now. Check back
   after your teacher publishes one."). It does not read as broken.
3. **Loading is calm and shift-free.** Plain "Loading your assignments" text in
   a `role="status"`/`aria-live="polite"` region; header, tabs, and footer stay
   put. No spinner, no skeleton, no flashing. Consistent with the no-gamification,
   low-stimulation intent.
4. **Accessibility semantics are strong.** Real tablist with roving tabindex and
   arrow keys; `aria-selected`; headline focus-on-render with `preventScroll`;
   status conveyed by **text label plus glyph, never color alone** (○ ◐ ● ★);
   per-card `aria-label`s that pair the visible verb with the title; error
   regions with `role="alert"`; titles routed through `textContent`.
5. **The status glyph system** (○ Ready, ◐ Improving, ● Well Done, ★ Perfect) is
   a thoughtful, non-color, non-gamified differentiator. Keep it; it just needs
   visual treatment.
6. **Copy is mostly student-appropriate and non-technical** across empty, error,
   and deep-link states. "Ask your teacher for help" is the right register.
7. **Restraint.** No points, streaks, badges, avatars, leaderboards, or
   decorative motion. The product already respects the brief; it is under-styled,
   not over-styled.

---

## 5. Primary UX question - "can a 6th grader know what to do in ~3s?"

| State | Verdict | Note |
|-------|---------|------|
| Empty | Yes | Clear, calm, one message. |
| Loading | Mostly | Small text; no motion, but no confusion. |
| A - multi actionable | Weakly | Titles shout; the *action* (Open assignment) is the quietest thing on the card; bullets distract. |
| A/B - mixed status | No, not efficiently | Completed and not-started work look identical in weight; nothing says "do this next"; long undifferentiated scroll. |
| My Results | Mostly | Reads as a list of scores, but same title-shouting / bare-button pattern. |
| Error | Yes for recovery | The green "Try again" is the one clearly-styled action; ironic given it is a recovery path (see F1). |
| Deep-link arrival | Mostly | Calm message, but **no LyfeLabz branding/orientation** on the card. |

The student can generally tell **where they are** (branding, "Welcome, Maya.")
and **what they have** (a list). They cannot efficiently tell **which one to do
next** or **which are already done**, and the element that should be most
obvious - the button that opens the work - is the least prominent thing on
screen.

---

## 6. UX findings (detailed)

### F1 (P1) - Primary action has the least visual weight; recovery has the most
The **Open assignment** button (the single most important control in the whole
student experience) and the **Improve My Score** button render as raw OS default
buttons: computed `background rgb(239,239,239)`, `border 2px outset`,
`border-radius 0`, weight 400. Meanwhile the **error-recovery** "Try again"
button is the only fully-styled control - a green rounded pill
(`background rgb(31,107,61)`, 44px min, shadow) - because the CSS primary-button
rule (`app/index.html` ~1798-1804) allowlists `assignments-retry` but **not**
`assignments-launch` or `results-improve`. Hierarchy is inverted: the everyday
action looks like a nothing button; the rare recovery action looks like the
hero. Student impact: the eye is not drawn to the thing to click.

### F2 (P1) - Selected tab is visually indistinguishable from the unselected tab
`My Assignments` and `My Results` render as identical raw OS buttons. Measured:
the selected and unselected tab computed styles are **byte-identical**; only
`aria-selected` differs (true/false). There is no CSS for `[role=tab]` or
`[aria-selected=true]`. A screen-reader user is told which tab is active; a
**sighted student gets no visual cue at all** except a transient focus ring
while the tab is focused. This is a real orientation defect for exactly the
attention/processing profile in the brief.

### F3 (P1) - Leftover default list bullets + centered text = unintentional, prototype look
The assignment/results list is a bare `<ul class="shell-list">` with no CSS, so
it inherits `list-style disc` and `padding-left 40px`. Inside the
`text-align:center` card, each big centered title has a **disc bullet floating
alone at the far-left margin**, disconnected from its own content. It reads as
an unfinished wireframe, not a product. (Confirmed at desktop, tablet, mobile.)

### F4 (P1) - No card boundaries; assignments do not read as discrete units
Items flow as centered text separated only by whitespace. There is no surface,
border, divider, or grouping per assignment. With 3 items it is tolerable; with
8 (browser-tested) it is a long, undifferentiated scroll of near-identical big
titles. A student cannot chunk "this block is one assignment" at a glance.

### F5 (P1) - Assignment titles over-dominate; every card is a competing headline
Titles render as default `<h2>` (24px, bold) - as loud as a page headline - and
every card has one, so nothing wins. Meanwhile status and action are tiny. The
one thing that should be quiet-but-scannable (the title) is the loudest thing,
and the two things that should be scannable (status, action) are the quietest.

### F6 (P2) - In My Assignments, completed work is not visually distinguished from to-do work
Because the contract only exposes `published`, every assignment - including one
already scored **Perfect** - renders with an identical **Open assignment**
button and equal visual weight; only a tiny status chip differs. Completed and
not-started work compete equally, and a student can reasonably think a perfect
assignment still needs doing. (Re-launching is intentional; the issue is purely
that "done" is not *quiet*.) There is no grouping or sort that puts actionable
work first.

### F7 (P2) - Assignment/results error message loses its intended red-callout styling
`renderAssignmentsError` / `renderResultsError` call `renderErrorBanner` (which
sets `data-testid="error-banner"`, the selector the red callout CSS targets) and
then **overwrite** the testid with `assignments-error` / `results-error`. The
CSS `[data-testid=error-banner]` therefore no longer matches, so the error text
renders as plain muted gray, centered, no border - measured
`background transparent`, `color rgb(77,92,110)`, `border none` - instead of the
intended `--tw-callout-error` red callout. Semantics survive (`role="alert"`,
`aria-live="assertive"`), and the Try again button is prominent, so this is
low-severity, but the message does not *read* as an error.

### F8 (P2) - Deep-link arrival card has no LyfeLabz branding or orientation
`renderDeepLinkArrival` does not call `renderHeader`, so a student arriving from
Google Classroom lands on a card with **no gold wordmark and no "you are in
LyfeLabz" orientation** - just a bare message and a bare button. For a student
who tapped a Classroom link and may not know where they are, the missing brand
anchor is a small but real orientation gap. (The `.deep-link-arrival*` classes
have no CSS at all; the card is held together only by the generic auth-card
`h1`/`p`/`button` rules.)

### F9 (P3) - Meta-instructional supporting paragraph
The supporting line ("You are signed in to LyfeLabz. Choose My Assignments to
see published work, or My Results to review your scores.") explains the **tab
mechanic** rather than orienting the student toward their work. It is prose a
6th grader will skip. See microcopy (§14).

---

## 7. Accessibility findings

Practical review (semantics strong; presentation is where the gaps are):

- **Keyboard:** Strong. Tablist has roving tabindex + Arrow/Home/End; panel is
  focusable; buttons are real `<button>`s; links are real `<a>`s. No traps found.
- **Focus visibility:** The auth-card provides `h1:focus-visible` and green
  focus rings for the allowlisted controls, but the **tabs and the Open
  assignment / Improve buttons are not in that allowlist**, so their only focus
  affordance is the browser default outline on a bevel button. Weak and
  inconsistent. (Ties to F1/F2.)
- **Status not by color:** Correct - text label + glyph, `aria-hidden` on the
  glyph. Preserve.
- **Names:** Good - per-card `aria-label`s, `aria-labelledby` wiring, alert/
  status regions.
- **Contrast:** Card ink on near-white passes. The muted gray error text (F7)
  and muted return-link are lower-emphasis but still legible; the **failure is
  that the error does not signal error-ness**, not raw contrast.
- **Target size:** Measured on mobile - tabs 44px, Open assignment 44px, sign
  out 42px. Acceptable (the natural button sizing lands ~44px even though the
  coarse-pointer min-target rule does not explicitly target these).
- **Cognitive accessibility (the brief's priority):** This is the weakest axis.
  No active-tab cue (F2), inverted action hierarchy (F1), no card chunking (F4),
  no "what's next" (F6), and title-shout (F5) all raise load for students with
  attentional / language-processing / executive-function needs. The fixes are
  presentational, not structural, and do **not** require making the UI childish.

---

## 8. Responsive findings (viewport by viewport)

- **Desktop (1280):** Card centered ~32rem. Bullets float far left of centered
  titles (F3). Titles dominate (F5). Open assignment is a small bare button
  (F1). No card separation (F4). Functional, not finished.
- **Tablet (768), 8 mixed items (worst case):** Status chip and Open assignment
  land on **one centered line**, and the status label collides against the
  button edge ("Well Done!" abutting the button). Long undifferentiated scroll;
  completed and to-do work interleaved with equal weight (F6). This viewport
  most exposes the scanning problem.
- **Mobile (375, coarse pointer):** Best of the three - stacking gives the
  buttons near-full width and ~44px height, and there is **no horizontal
  scroll** (`scrollWidth == clientWidth == 375`). But titles are enormous,
  bullets still hang left, tabs still show no active state, and there is still
  no card chunking. The bare buttons look *less* broken here only because they
  are bigger.

No layout breakage, clipping, or horizontal overflow at any tested width. The
responsive problems are the same presentation gaps amplified, not distinct
breakpoint bugs.

---

## 9. Cognitive-load classification

| Class | Elements |
|-------|----------|
| **Essential** | The assignment title; the Open assignment action; a clear "which tab am I in"; a clear "which of these still need doing". |
| **Useful** | Status chip (Ready / Improving / Well Done / Perfect); best score + attempt count on My Results; sign out; return to public lessons. |
| **Optional** | `publishedAt` date (not currently shown on the student card; fine to keep absent). |
| **Distracting** | Default list bullets (F3); the meta-instructional supporting paragraph (F9); the equal loudness of every title (F5); the equal weight of completed vs to-do work (F6). |

The list is short on purpose. The problem is **not** missing information - it is
that essential elements are under-weighted and two distracting elements are
present. This is a subtraction-and-emphasis problem, not an addition problem.

---

## 10. Microcopy review (current -> proposed; NOT implemented)

Recommendations only. Copy is not changed in this phase.

| Location | Current | Proposed | Why |
|----------|---------|----------|-----|
| Supporting line (F9) | "You are signed in to LyfeLabz. Choose My Assignments to see published work, or My Results to review your scores." | "Here's your science work." (or drop it entirely; the tabs are self-labeling) | Orients toward work, not the tab mechanic; shorter; lower reading load. |
| Open assignment button | "Open assignment" | "Start" for Ready to Begin; "Open again" (or leave "Open assignment") for already-completed | Shorter, action-first; distinguishes fresh vs revisit without gamifying. Low confidence - test with the teacher; "Open assignment" is acceptable as-is. |
| Empty | "No assignments are open for you right now. Check back after your teacher publishes one." | Keep as-is | Already good. |
| Results empty | "You have not completed any assignments yet." | Keep, or "You haven't finished any assignments yet." | Minor; contraction is friendlier. Optional. |

Microcopy is a minor lever here. The dominant issues are visual, not verbal.

---

## 11. Product-design assessment (holistic)

Does it feel finished? **The shell does; the content does not.** The card,
wordmark, palette, and empty/loading states feel intentional and trustworthy.
The moment a list of assignments appears, the surface drops to bare-HTML
prototype fidelity: OS-default buttons, disc bullets, headline-sized titles,
no cards. It does not currently feel "substantially better than a generic LMS
assignment list" - in the populated state it feels like *less* than one, because
a generic LMS at least styles its rows and its primary button.

The encouraging part: this is entirely a **presentation** gap sitting on top of
a correct, certified, well-structured foundation. A small, well-scoped styling
pass on the tablist, the list, the cards, the status chips, and the primary
button would move the populated state from "unfinished" to "purpose-built
science workspace" without touching a single locked architectural boundary,
without adding features, and without any gamification. This is exactly the kind
of high-impact, low-risk work Sprint 28.5 exists for.

---

## 12. Prioritized recommendations

P0 = release-blocking; P1 = high-value, do before v1; P2 = worthwhile, can wait;
P3 = optional/future. Costs: LOW / MEDIUM / HIGH by complexity + regression risk.

| Priority | Finding | Student impact | Cost |
|----------|---------|----------------|------|
| P1 | F1 Primary action (Open assignment / Improve) has least visual weight | Eye not drawn to the thing to click; work is harder to start | LOW |
| P1 | F2 Active tab visually indistinguishable | Student cannot tell which view they are in | LOW |
| P1 | F3 Default list bullets + centered flow look like a prototype | Reads as broken/unfinished; distracting bullet noise | LOW |
| P1 | F4 No card boundaries between assignments | Cannot chunk/scan "one assignment" | LOW-MEDIUM |
| P1 | F5 Titles over-dominate as competing headlines | Weak hierarchy; nothing wins the eye | LOW |
| P2 | F6 Completed work not quieted / not grouped in My Assignments | May redo done work; no "what's next" | MEDIUM |
| P2 | F7 Error message loses red-callout styling (testid overwrite) | Error does not read as an error (semantics OK) | LOW |
| P2 | F8 Deep-link arrival card has no LyfeLabz branding | Weaker orientation for Classroom arrivals | LOW |
| P3 | F9 Meta-instructional supporting paragraph | Skipped prose; minor extra load | LOW |

No P0 was found. The surface is not broken or inaccessible in a
release-blocking way; it is under-designed. Nothing here is release-*blocking*,
but the populated-state finish is below the bar for a shipped product, which is
why F1-F5 are grouped as P1 "do before v1."

---

## 13. Proposed Phase 28.5B implementation package

A single bounded, styling-only package. It changes presentation around the
certified architecture: it adds student-scoped CSS in `app/index.html` and, at
most, small class-name / grouping-order adjustments in the student surface
render functions. It introduces **no** new domain data, API, schema, route,
lifecycle, gamification, or feature. All five core items are LOW/LOW-MEDIUM cost.

Recommended package (5 changes):

### B1 - Style the primary action button (fixes F1)
- **Problem:** Open assignment / Improve My Score are raw OS buttons; the
  recovery button is the only styled primary.
- **Solution:** Add `assignments-launch` and `results-improve` to the existing
  auth-card primary-button rule (or a shared student-primary class) so they get
  the same green rounded pill, min-height, and focus ring already defined.
- **Student benefit:** The action to start work becomes the obvious thing to
  click; focus states become consistent.
- **Footprint:** CSS-only in `app/index.html`; optionally one shared class name.
- **Regression risk:** Very low. Reuses tokens already in the file. No behavior,
  URL, or data change. Existing `data-testid`s unchanged, so tests unaffected.
- **Validation:** Visual check across all three viewports; confirm launch still
  fires the same URL; run `app` test suite.

### B2 - Give the tablist a visible active state (fixes F2)
- **Problem:** Selected tab is byte-identical to unselected.
- **Solution:** Add CSS for the two student tabs and `[aria-selected=true]` (an
  underline/filled state + a clear focus ring). Semantics already exist.
- **Student benefit:** Always-obvious "which view am I in," for sighted and
  screen-reader users alike.
- **Footprint:** CSS-only; possibly one wrapper class on the existing tablist.
- **Regression risk:** Very low; no markup/behavior change.
- **Validation:** Toggle tabs across viewports; keyboard arrow-nav still works;
  test suite.

### B3 - Turn each assignment into a real card and kill the default bullets (fixes F3, F4)
- **Problem:** Bare `<ul>` bullets + centered flow; no card boundaries.
- **Solution:** Student-scoped CSS: `list-style:none`, remove the 40px indent,
  and give each `<li>` a card surface (subtle border/background,
  `--tw-radius-card`, left-aligned content, consistent internal spacing) matching
  the existing card language.
- **Student benefit:** Each assignment reads as one discrete, scannable unit;
  the prototype look disappears.
- **Footprint:** CSS-only in `app/index.html`.
- **Regression risk:** Low. No structural DOM change required.
- **Validation:** 1 / 3 / 8-item lists across viewports; confirm no horizontal
  scroll on mobile; test suite.

### B4 - Rebalance card hierarchy and style the status chip (fixes F5, and F6's "quiet done")
- **Problem:** Titles shout at headline size; status is unstyled text; completed
  work is not visually quieter.
- **Solution:** Within the card, set the title to a calm scannable size (not
  `<h2>` default), and give the status glyph+label a real chip treatment
  (pill, restrained tone per status - still text+glyph, never color-only). Use a
  quieter chip/treatment for `Perfect`/`Well Done` so completed work recedes
  without hiding.
- **Student benefit:** Clear title -> status -> action rhythm; done work stops
  competing with to-do work.
- **Footprint:** CSS-only, plus possibly demoting the title element/size class.
- **Regression risk:** Low-Medium (title element choice must keep heading
  semantics / `aria-labelledby`).
- **Validation:** Mixed-status list at all viewports; verify accessible names
  and status-not-by-color hold; test suite.

### B5 - Restore the error callout styling (fixes F7)
- **Problem:** The testid overwrite drops the red-callout CSS.
- **Solution:** Either keep `data-testid="error-banner"` and add a second hook
  for the student variants, or extend the callout selector to include
  `assignments-error` / `results-error`. Smallest possible change.
- **Student benefit:** An error looks like an error.
- **Footprint:** One CSS selector (or one line in the two render functions).
- **Regression risk:** Very low. `role="alert"` semantics already correct.
- **Validation:** Force both error states in the harness; confirm callout; test
  suite (the error `data-testid`s the tests assert on are preserved).

Package size: 5 changes, all presentational, all around locked architecture,
all confidently certifiable before Sprint 29. B1/B2/B3/B5 are LOW; B4 is
LOW-MEDIUM. If the package must shrink, B1+B2+B3 are the irreducible core.

**Optional add-on (only if the teacher wants it), not in the core 5:**
add the LyfeLabz wordmark to the deep-link arrival card (F8) - LOW, CSS/markup
in `arrival.ts`, but it is the one item that touches a module rather than pure
CSS, so it is proposed as optional rather than core.

---

## 14. Deferred ideas - explicitly NOT in pre-v1 polish scope

These are recorded so they are not smuggled into 28.5B:

- **"Up next" prioritization / sorting / grouping by data the contract lacks.**
  The student contract has no due date and no richer status than `published`.
  Do not design around due dates or invent urgency. F6's fix is limited to
  *quieting completed work* and optionally ordering actionable-first from data
  already present (derived status) - nothing that needs new domain data.
- **Any new assignment domain state** (closed/unavailable in My Assignments).
  The student My Assignments contract only exposes `published`; do not invent
  student-visible closed/unavailable card states here.
- **Gamification of any kind** - points, streaks, badges, avatars, leaderboards,
  progress bars, celebratory animation. Out of scope permanently for this
  surface. The status glyphs stay as calm indicators, not achievements.
- **Decorative illustration / empty-state art.** The empty state is good as
  plain text; do not add decoration for decoration.
- **Dashboard analytics / cross-assignment summaries / social features.** Not a
  dashboard; not in scope.
- **Any change to locked architecture:** the assignment authorization/lifecycle
  model, the `/app/` return destination, the deep-link resolver, the v2 lesson
  contract, assessment submission, Google Classroom architecture, onboarding
  authority, curriculum migration, or assessment-revision architecture.
- **Return-from-lesson "you just completed this" acknowledgment.** Tempting, but
  it edges toward changing the certified return/reload behavior; leave for a
  later, deliberate decision. Do not alter the `/app/` destination.
- **Converting the student surface to the teacher `.shell-*` chrome.** The
  student surface should stay its own calm card identity, not become the
  administrative teacher dashboard.

---

## 15. Deep-link arrival states - certification note

- Browser-certified: deep-link **informational** arrival card.
- Code-reviewed (structurally identical unstyled cards, not separately
  browser-certified): deep-link **loading** ("Opening your assignment...") and
  deep-link **retryable error** ("We couldn't open this assignment" + bare
  "Try again"). The retryable "Try again" here is a bare button (same class of
  finding as F1); noted, not separately prioritized.

---

## 16. Audit disposition

**RELEASE-READY WITH RECOMMENDED POLISH.**

The student workspace is behaviorally complete, authorized, accessible in
semantics, and certified. It is **not** release-blocking-broken. But its
populated state is visually unfinished to a degree that is below the bar for a
shipped product, and the specific gaps (inverted action hierarchy, no active-tab
cue, prototype bullets, no card chunking, title-shout) disproportionately affect
the middle-school, attention/language-processing audience the brief centers.
Every fix is presentational, low-risk, and sits on top of locked architecture.
The recommendation is a small, confidently-certifiable 28.5B styling package
before Teacher Platform v1, not a redesign.

---

## 17. Phase 28.5B implementation outcome (2026-08-20)

Phase 28.5B implemented the approved five-item package (B1-B5). It is a
presentation-only change over the certified surface: one small JS attribute
addition and a single scoped student-workspace CSS section, plus tests. No
authorization, lifecycle, API contract, label, launch URL, deep-link resolver,
`/app/` return destination, onboarding, teacher workspace, Functions, Rules, or
curriculum was touched. Full detail lives in
`SPRINT_28_5_STUDENT_WORKSPACE_POLISH.md`.

Finding disposition after browser validation (harness identical to §1: the real
`makeActiveStudentSurface` bundled with esbuild, driven by in-memory fakes,
rendered into the real `app/index.html` style blocks):

| Finding | Result |
|---------|--------|
| F1 Primary action least weight | RESOLVED - Open assignment / Improve My Score are the filled-green primary; recovery is no longer the only styled control. |
| F2 Selected tab indistinguishable | RESOLVED - selected tab carries wash + heavier ink + a solid teal underline bar (non-color). |
| F3 Default bullets / prototype look | RESOLVED - list bullets and indent removed; content left-aligned in cards. |
| F4 No card boundaries | RESOLVED - each assignment/result is a discrete bordered card. |
| F5 Titles over-dominate | RESOLVED - card titles calmed to 1.08rem; heading semantics kept. |
| F6 Completed not distinguished | IMPROVED BUT REMAINS - completed work (Well Done!/Perfect) now visually recedes (quiet card + outline action), so the eye finds unfinished work first; no reordering/grouping was added (deliberately out of scope). |
| F7 Error loses red callout | RESOLVED - callout selector widened to the student error testids; both error surfaces show the red callout. |
| F8 Deep-link arrival branding | DEFERRED (not approved for 28.5B). |
| F9 Meta-instructional paragraph | DEFERRED (not approved for 28.5B). |

Disposition: **Phase 28.5B COMPLETE.** The wider Sprint 28.5 is not complete;
28.5C (Teacher Workspace Final UX Audit) has not begun.
