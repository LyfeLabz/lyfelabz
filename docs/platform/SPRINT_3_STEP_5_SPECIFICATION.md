# LyfeLabz Sprint 3 Step 5 Technical Specification

**Status:** Planning only. No implementation. No commits.
**Sprint:** Sprint 3, Step 5 (Authenticated Teacher Platform Shell).
**Predecessors:** SPRINT_3_STEP_1_SPECIFICATION.md (approved), SPRINT_3_STEP_2_SPECIFICATION.md (implemented), SPRINT_3_STEP_3_SPECIFICATION.md (implemented, Canonical Session Bootstrap and Immutable Session Object are frozen), SPRINT_3_STEP_4_SPECIFICATION.md (implemented, all Session-kind surfaces including the minimal `activeTeacher` surface are live).
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, PLATFORM_STATE_MACHINE.md, SPRINT_3_STEP_4_SPECIFICATION.md.

This document scopes Sprint 3 Step 5 only. It specifies the authenticated Teacher Platform Shell that replaces the intentionally minimal `activeTeacher` surface produced by Step 4. It does not authorize implementation. Implementation begins only after this specification is separately approved.

Step 4 answered **how each Session kind is greeted**. Step 5 answers **what the approved teacher's authenticated home looks like as a permanent product surface**. Step 5 introduces no classroom logic, no roster logic, no assignment logic, no analytics, no administrator tooling, and no new Firestore reads. It establishes the visual and architectural home that every future teacher feature will live inside.

---

## 1. Scope and Non-Goals

### 1.1 In scope

- A permanent shell layout (header, navigation, content area, optional footer) that hosts the `activeTeacher` surface.
- A shell-scoped home surface that greets the teacher, states platform status, summarizes identity, and previews future capabilities via non-actionable placeholder cards.
- Placeholder navigation that clearly distinguishes the one available destination (Home) from the four future destinations (Classes, Students, Assignments, Settings).
- Session-display rules governing what teacher identity information is shown and what is deliberately withheld.
- Accessibility contract (keyboard, screen reader, focus order, contrast, responsive behavior).
- Files expected to change, validation plan, Chris local verification plan, rollback plan.

### 1.2 Explicitly out of scope

- Any classroom, roster, assignment, enrollment, submission, grading, reporting, or analytics UI.
- Any Settings surface behavior beyond the coming-soon placeholder.
- Any administrator surface changes. `activeAdministrator` retains its Step 4 stub.
- Any student surface changes. `activeStudent` retains its Step 4 stub. Students are never routed into the teacher shell.
- Any Signed-out, Provisioned, Pending Verification, Suspended, Archived, Error, or Loading surface changes. Those are fully owned by Step 4 and are re-used as-is.
- Any new Firestore collection, custom claim, lifecycle state, callable, security rule, storage rule, index, or Hosting configuration change.
- Any change to files outside `app/**` and `docs/**`. Root-level lesson HTML and the anonymous instructional experience are untouched.

### 1.3 Architectural constraints preserved

- Sprint 2 identity trust layer is preserved. No new roles, claims, or statuses.
- Sprint 3 Canonical Session Bootstrap is preserved. The shell consumes the immutable Session Object; it never re-derives lifecycle, role, or school from any other source.
- The Session Object remains immutable. The shell reads from it; it does not mutate it.
- Firestore remains authoritative for lifecycle state. The shell does not cache lifecycle in `localStorage`, `sessionStorage`, cookies, the URL, or any in-memory singleton other than the Session Object itself.
- Fail closed. The shell renders only when the router has already resolved the caller as `activeTeacher`. Any drift routes the caller out of the shell via bootstrap re-run.
- No new data reads. The shell reads only fields already present on the `activeTeacher` Session Object as of Step 3.

---

## 2. Entry Conditions

Step 5 begins at the moment the router dispatches to `kind: "activeTeacher"`. Every other Session kind is handled by the Step 4 surfaces and never reaches the shell. The shell mounts inside the same mount node used by Step 3 and Step 4; it does not introduce a new mount point.

The shell receives:

- The immutable `activeTeacher` Session Object, narrowed to include at minimum `uid`, `displayName`, `email`, `schoolId`, `schoolName`, `role: "teacher"`, and `status: "active"`.
- Access to `signOut()` and `refreshSession()` from the Step 4 shared helpers.
- No access to callables. Sprint 2 callables are not invoked from the shell.

The shell must:

- Render deterministically from its input Session; never read `window.location.search`, cookies, or storage for lifecycle input.
- Provide a persistent sign-out control.
- Preserve the anonymous instructional experience by never redirecting a signed-in teacher away from a public URL. The shell is confined to `/app/**`.
- Emit zero Firestore reads and zero callable invocations on mount, on navigation, and on refresh.

---

## 3. Global Layout

The shell is a persistent three-region layout that hosts the Home surface today and will host future feature surfaces without structural change.

### 3.1 Regions

The shell is composed of exactly three regions, in DOM order:

1. **Header** (`<header role="banner">`), fixed height, spanning the viewport width.
2. **Main** (`<main id="app-main">`), a two-column grid on wide viewports and a single column on narrow viewports. On wide viewports the left column is the navigation (`<nav aria-label="Teacher platform sections">`) and the right column is the content area (`<section aria-labelledby="surface-headline">`). On narrow viewports the navigation collapses above the content area.
3. **Footer** (`<footer role="contentinfo">`), a single low-visibility line: "LyfeLabz Teacher Platform". No links. No copyright line. No secondary navigation. Its purpose is only to close the layout visually and give assistive technology a landmark.

### 3.2 Dimensions

- Maximum content width 1120px, centered horizontally.
- Header height 56px on wide viewports, 48px on narrow.
- Navigation column width 224px on wide viewports; navigation is a horizontal scroll strip above the content on narrow viewports.
- Content area is fluid within the remaining width.
- Vertical rhythm follows the existing LyfeLabz spacing scale. Step 5 introduces no new spacing tokens.

### 3.3 Responsive behavior

Step 5 adopts the canonical responsive breakpoints established in Repository Hardening Pass 4 (see CLAUDE.md):

- Below **480px**: single-column layout, header collapses to product mark plus sign-out control only (identity summary moves into the Home surface header), navigation becomes a horizontal scroll strip.
- **480px to 720px**: single-column layout, header shows identity summary compactly.
- **720px to 960px**: two-column layout begins, navigation is a fixed left rail.
- **Above 960px**: two-column layout at full 1120px content width.

Additionally:

- `@media (pointer: coarse)` enforces the 44x44 CSS pixel minimum on every interactive element in the shell.
- `@media (orientation: landscape) and (max-width: 950px)` preserves notch-clearing padding on iPhone landscape, consistent with the canonical mobile stylesheet.

### 3.4 Visual language

The shell uses the existing LyfeLabz visual language: existing typography, color tokens, spacing scale, card styles, and button styles. Step 5 introduces no new design system, no new component library, and no new tokens. This is consistent with CLAUDE.md ("Match existing LyfeLabz spacing, colors, typography, cards, and interactions"; "Do not introduce new design systems").

### 3.5 Motion

Only two motion patterns are permitted in the shell:

- A subtle fade when the content area swaps (reserved for future feature surfaces; the Home surface renders once and does not re-fade).
- Standard hover/focus transitions on interactive controls, matching existing lesson buttons.

`prefers-reduced-motion: reduce` disables all shell motion.

---

## 4. Header

The header is the top-of-shell strip. It carries branding on the left, identity summary in the center or right (depending on width), and the sign-out control on the far right. It is present on every teacher shell view, including future feature surfaces.

### 4.1 Composition

Left region:

- **LyfeLabz product mark**, text-only, reading "LyfeLabz Teacher Platform" on viewports at 720px and above, and "LyfeLabz" on viewports below 720px. Rendered as a plain heading (`<h1 class="brand">`) inside the header. No logo image is required in Step 5; if a canonical mark exists in the repository, it may accompany the text at the implementation reviewer's discretion, provided the mark is either labeled or `aria-hidden="true"`.
- The product mark is not a link. Clicking or activating it does nothing in Step 5. The shell has one surface today; a link to Home would be a link to the current page.

Center or right region (identity summary):

- **Display name**, from `session.displayName`. Truncated with ellipsis after 24 characters on narrow viewports.
- **School name**, from `session.schoolName`, rendered on a second line at small type below the display name on narrow viewports and inline as ", {schoolName}" on wide viewports.
- No email address in the header. Email surfaces only within the Home surface identity summary card (§6.3).
- No role label ("Teacher") in the header. The whole shell is teacher-scoped by construction; a "Teacher" label would be redundant.
- No UID, no `schoolId`, no custom-claim payload, no lifecycle status string. See §7 for the full session-display rules.

Far right region:

- **Notifications placeholder icon**, a bell glyph carrying `role="img"` and `aria-label="Notifications, coming soon"`. The icon is visually low-contrast so that it does not read as available. It is not a button and does not respond to clicks. A future sprint will replace it with a real control.
- **Sign-out control**, a text button labeled "Sign out". It calls `signOut()` and then `refreshSession()`, matching Step 4 §3.7. On narrow viewports the control collapses into a compact "Sign out" text link retaining the 44x44 touch target.

### 4.2 Recommendations

Recommendations documented for the implementation reviewer:

- **Branding.** Prefer text-only branding in Step 5 to avoid introducing a raster asset that is not already canonical. If a canonical LyfeLabz mark exists in the repository, adopt it; do not commission a new mark for Step 5.
- **Signed-in teacher display.** Prefer display name + school name in the header. Do not surface email, UID, `schoolId`, or role in the header.
- **School identifier.** Show `schoolName` (human-readable). Never show `schoolId` (opaque). See §7.
- **Sign out.** Keep sign out as a persistent, always-visible text control. Do not hide it behind a menu in Step 5.
- **Future notifications placeholder.** Render a labeled but disabled bell glyph. This is the smallest possible reservation of visual space for a future feature and does not commit to a delivery date.

---

## 5. Navigation

The shell exposes a persistent navigation region so that the future information architecture is legible today. Only one navigation item is functional in Step 5 (Home). Every other item is a coming-soon placeholder.

### 5.1 Items and order

Navigation items appear in this order:

1. **Home** - functional. Current surface.
2. **Classes** - coming soon.
3. **Students** - coming soon.
4. **Assignments** - coming soon.
5. **Settings** - coming soon.

### 5.2 Semantics

- The navigation is a single `<nav>` landmark with `aria-label="Teacher platform sections"`.
- The list is a `<ul>` with one `<li>` per item.
- The **Home** item is a `<button>` (not a link, because the shell does not navigate by URL; see §5.4) with `aria-current="page"` while Home is the active surface.
- Every coming-soon item is a `<button disabled>` carrying `aria-disabled="true"` and a visible "Coming soon" label rendered inline beside the item name (for example: "Classes - Coming soon"). Disabled buttons are non-focusable in the tab order but remain reachable to screen readers.

### 5.3 Distinguishing available from future

Coming-soon items are distinguished from Home by three simultaneous signals so that no single signal is a load-bearing indicator:

1. **Text.** Each coming-soon item's label includes " - Coming soon".
2. **Style.** Coming-soon items are visually muted (reduced text contrast against the shell background, still meeting the 4.5:1 contrast ratio required by §8).
3. **Interaction.** Coming-soon items do not respond to hover, focus, click, or keyboard activation. The cursor style is `not-allowed` on pointer devices.

Coming-soon items must not look identical to Home. Coming-soon items must not read as clickable-but-broken. A caller who tabs through the navigation should immediately understand that only Home is available today.

### 5.4 Router integration

- The shell does not navigate by URL. Consistent with Step 4 §13, route surface selection remains a pure function of `Session.kind`. The Home surface is the only content the shell renders in Step 5, and Home is not addressed by a distinct URL.
- Activating the Home button while Home is the active surface is a no-op.
- Activating a coming-soon button is impossible by construction (the button is disabled). If a caller somehow activates one via assistive technology automation, the shell logs a `console.debug` message and takes no other action.

### 5.5 Future readiness

The navigation is scaffolded so that a future sprint can promote a coming-soon item to a functional item by:

1. Removing the disabled attribute.
2. Wiring the button to trigger a within-shell surface swap.
3. Adding the corresponding surface module under `app/src/shell/surfaces/`.

Step 5 defines the container. Future sprints define the destinations. Step 5 does not build the destinations, does not lay routing rails toward the destinations, and does not commit to their order beyond the sequence in §5.1.

---

## 6. Home Surface

The Home surface is the authenticated landing page inside the shell. It replaces the minimal `activeTeacher` surface produced by Step 4. It is intentionally lightweight.

### 6.1 Purpose

Confirm arrival. State platform status. Summarize the caller's identity. State teacher verification status (as a badge, not as an actionable). Preview future capabilities via non-actionable placeholder cards.

### 6.2 Composition

In DOM order:

1. **Welcome message** (`<h2 id="surface-headline">`). Reads "Welcome, {displayName}." When `displayName` is empty (a shape drift condition the bootstrap should prevent), the shell reads "Welcome to LyfeLabz." and takes no other action; it does not attempt to recover a display name from any other source.
2. **Platform status line**, one sentence: "The teacher platform is being built. New capabilities will appear here as they are released."
3. **Identity summary card**. See §6.3.
4. **Placeholder cards grid**. See §6.4.
5. **Return-to-public-lessons link**, small type, at the foot of the Home surface: "Return to public lessons." Links to `/`. This preserves the Step 4 §7.5 guarantee that a signed-in teacher can still browse the anonymous curriculum.

Home has no primary action button. The shell's persistent sign-out control lives in the header, not in the surface.

### 6.3 Identity summary card

A single card, canonical LyfeLabz card styling, containing:

- **Display name** (label: "Signed in as").
- **Email** (label: "Email").
- **School** (label: "School"), the human-readable `schoolName`.
- **Role** (label: "Role"), the literal string "Teacher".
- **Verification status** (label: "Verification"), a small pill reading "Verified" in the LyfeLabz gold accent. Because the shell only renders for `kind: "activeTeacher"`, verification is always "Verified" on this surface. The pill is informational and non-actionable.

No other fields are displayed. See §7 for the full list of fields that must never appear.

### 6.4 Placeholder cards

A grid of five cards, in this order:

1. **Classes**
2. **Students**
3. **Assignments**
4. **Reports**
5. **Settings**

Each card contains, in DOM order:

- A short title (the card name).
- A one-sentence purpose statement ("Organize your classes and blocks.", "See your students and their progress.", "Create and manage assignments.", "See how your students are doing.", "Manage your account and preferences.").
- A single italicized status line: **"Coming in a future sprint."**

Each card is styled identically to a canonical LyfeLabz content card. Each card is visually muted (matching §5.3's coming-soon posture). No card responds to hover, focus, click, or keyboard activation. The cursor is `not-allowed` on pointer devices. Each card carries `aria-disabled="true"` and no `role="button"`.

Reports appears in the placeholder card grid but does not appear in the navigation. This is deliberate: Reports is a Home-surface preview of a capability whose eventual navigation home is expected to live under Students, Assignments, or a new top-level item. Step 5 does not commit to that placement; it only reserves the concept on the Home page.

### 6.5 Responsive grid

- Above 960px: three-column grid.
- 720px to 960px: two-column grid.
- Below 720px: single-column stack.

Grid gaps and card padding follow the existing LyfeLabz spacing scale.

### 6.6 Data and callable posture

The Home surface performs zero Firestore reads, zero callable invocations, and opens zero listeners. It renders entirely from fields already present on the `activeTeacher` Session Object.

---

## 7. Session Display Rules

The shell displays the minimum teacher identity necessary for a teacher to confirm they are signed in as themselves at their school. It withholds every internal identifier that a teacher does not need to see.

### 7.1 Fields displayed

- `displayName` - header identity summary, Home welcome message, Home identity card.
- `email` - Home identity card only. Never in the header.
- `schoolName` - header identity summary, Home identity card.
- Role label "Teacher" - Home identity card only. Never in the header (redundant by construction).
- Verification pill "Verified" - Home identity card only.

### 7.2 Fields never displayed

The shell must never render:

- `uid` (Firebase Auth user ID).
- `schoolId` (opaque school identifier).
- Custom-claim payload of any kind.
- Lifecycle status string (`"active"`), because the shell renders only for active teachers by construction.
- Provisioning timestamps.
- Firestore document paths.
- Firebase project identifiers, config values, or API keys.
- Any other user's identity information.

### 7.3 Truncation and formatting

- `displayName` is truncated with ellipsis after 24 characters in header contexts. Full value renders in the Home identity card.
- `email` is rendered as-is with no truncation in the Home identity card and never in the header.
- `schoolName` is rendered as-is with no truncation in either context; if a school name would overflow, standard CSS truncation applies to the visual line but the full value remains in the DOM for assistive technology.

### 7.4 Localization posture

Step 5 renders all labels in English. No localization framework is introduced. If a future sprint adopts localization, the shell's static labels are the natural first candidates; Step 5 does not pre-emptively wrap them.

---

## 8. Accessibility

Step 5 adopts the accessibility contract from Step 4 §15 and extends it for the shell.

### 8.1 Landmarks and headings

- The shell exposes `role="banner"` (header), `role="navigation"` (nav, labeled by `aria-label`), `role="main"` (main), and `role="contentinfo"` (footer) landmarks.
- The product mark is `<h1>`. The Home welcome message is `<h2>`. Placeholder card titles are `<h3>`.
- Focus lands on the Home welcome message when the shell mounts, matching the Step 4 §15 rule that focus lands on the headline at surface dispatch.

### 8.2 Keyboard navigation

- Tab order is: Home button, coming-soon items (each skipped by tab order because disabled), notifications placeholder (skipped, not focusable), sign-out control, Home surface interactive controls, return-to-public-lessons link.
- Placeholder cards are not focusable, matching their non-interactive posture.
- Enter and Space activate the Home button and the sign-out control.
- `Escape` has no shell-level handler in Step 5. Escape does not sign the teacher out.

### 8.3 Screen reader support

- The navigation is announced as "Teacher platform sections, navigation".
- Home is announced as "Home, current page" when active (via `aria-current="page"`).
- Coming-soon items are announced as "Classes - Coming soon, dimmed" (browser-dependent phrasing) via `aria-disabled="true"`.
- The notifications placeholder is announced as "Notifications, coming soon" via `aria-label`.
- The verification pill on the identity card is announced as "Verification: Verified".
- Placeholder cards on the Home surface are announced with their title, purpose sentence, and status line in reading order.

### 8.4 Focus order

Focus order follows visual order. Focus rings are visible and match the existing LyfeLabz focus style. No focus trap is introduced. There is no modal in Step 5.

### 8.5 Contrast

All text meets 4.5:1 contrast against its background. Icons and pills meet 3:1. Muted coming-soon text is muted only within the range that preserves 4.5:1; the coming-soon posture is communicated by text ("Coming soon"), position, and interaction disabling in addition to color.

### 8.6 Responsive layout

The shell renders correctly at all canonical breakpoints. Content does not clip, overflow horizontally, or require horizontal scrolling on any viewport at or above 320px width. Wide tables and other overflow content, if introduced by a future sprint, will use the canonical `.table-scroll` utility already documented in the canonical mobile stylesheet.

### 8.7 Reduced motion

`prefers-reduced-motion: reduce` disables the content-swap fade. All state changes still occur; only their animation is suppressed.

---

## 9. Non-Goals

Step 5 explicitly excludes:

- **Classroom creation.** No form, no callable, no Firestore write.
- **Enrollment.** No student roster read, no enrollment write.
- **Rosters.** No student list, no student card, no student search.
- **Assignments.** No assignment list, no assignment form, no assignment metadata.
- **Submissions.** No submission list, no submission viewer, no grading UI.
- **Analytics.** No charts, no counts, no aggregate reads.
- **Grading.** No score entry, no rubric UI, no gradebook.
- **Administrator tools.** No admin-only surface, no admin-only navigation item, no admin-only callable invocation. The administrator surface remains the Step 4 stub.

If a future sprint introduces any of the above, it does so as a promotion of a Step 5 navigation placeholder or as an extension of the Home surface, not as a re-architecture of the shell. The shell is a container; future features are its contents.

---

## 10. Expected Implementation Files

Step 5 is expected to modify or create exactly the following files. If implementation discovers that a file outside this list must change, work pauses and this specification is amended before proceeding.

**Modified:**

- `app/index.html` - retains its Step 3 and Step 4 mount node. Adds only whatever `<link>` or `<style>` inclusions the shell layout requires. No shell markup is inlined.
- `app/src/router/routes/activeTeacher.ts` - the minimal Step 4 body is replaced with a mount call into the new shell module. Nothing else in the file changes; the router entry point remains the same.
- `app/src/router/routes.ts` (or equivalent) - no signature changes; only the internal call target for `activeTeacher` is updated to the shell mount.

**Created (client bundle):**

- `app/src/shell/shell.ts` - top-level shell mount. Owns the header, navigation, main, and footer regions. Consumes the `activeTeacher` Session and delegates the content area to a surface renderer.
- `app/src/shell/header.ts` - header region (product mark, identity summary, notifications placeholder, sign-out control).
- `app/src/shell/navigation.ts` - persistent navigation region (Home + four coming-soon items).
- `app/src/shell/footer.ts` - footer region (product name line).
- `app/src/shell/surfaces/home.ts` - Home surface (welcome message, platform status, identity summary card, placeholder cards grid, return-to-public-lessons link).
- `app/src/shell/surfaces/shared/identityCard.ts` - reusable identity summary card renderer.
- `app/src/shell/surfaces/shared/placeholderCard.ts` - reusable placeholder card renderer.
- `app/src/shell/surfaces/shared/verificationPill.ts` - reusable verification pill renderer.
- `app/src/styles/shell.css` (or an equivalent `<style>` block in `app/index.html`, at the implementation reviewer's discretion) - shell-scoped layout tokens. No new design system. Reuses existing LyfeLabz tokens by CSS custom property reference.
- `app/test/shell/shell.test.ts` - shell mount and layout region tests.
- `app/test/shell/header.test.ts` - header composition and identity-display rules.
- `app/test/shell/navigation.test.ts` - navigation composition, ordering, disabled posture, `aria-current` on Home.
- `app/test/shell/surfaces/home.test.ts` - Home surface composition, session-display rules, zero Firestore reads assertion.

**Not modified in Step 5:**

- `platform/firebase/firebase.json`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`.
- `platform/functions/**`. No new callable, no signature change to any existing callable.
- `app/src/firebase.ts`, `app/src/session/bootstrap.ts`, `app/src/session/consistency.ts`, `app/src/session/types.ts`, `app/src/session/user-record.ts`. Bootstrap architecture remains frozen.
- Any Step 4 route surface other than `activeTeacher.ts`.
- Any file outside `app/**` and `docs/**`.
- The root `index.html`, all lesson HTML, `CNAME`, `sitemap.xml`.

---

## 11. Validation Plan

### 11.1 Type-level validation

- `tsc --noEmit` from the `app/` package passes with zero errors.
- The shell mount accepts a narrowed `activeTeacher` Session type. Attempting to pass a Session of another kind is a compile-time error.

### 11.2 Unit test validation

- The shell renders exactly one `<header>`, one `<nav>`, one `<main>`, and one `<footer>` landmark.
- The header renders `displayName` and `schoolName` and does not render `uid`, `schoolId`, `email`, or any claim payload.
- The navigation renders Home as an enabled button with `aria-current="page"` and renders Classes, Students, Assignments, Settings as disabled buttons with `aria-disabled="true"` and " - Coming soon" in their label.
- The Home surface renders the welcome message, platform status sentence, identity summary card, five placeholder cards in the specified order, and the return-to-public-lessons link.
- The Home surface identity card renders `displayName`, `email`, `schoolName`, "Teacher", and a "Verified" pill; it does not render `uid`, `schoolId`, or any claim payload.
- The Home surface performs zero Firestore reads (asserted via a mock `getFirestore` that throws on any read).
- The Home surface invokes zero callables (asserted via a mock callable client that throws on any invocation).
- Focus lands on the welcome message on shell mount.
- The sign-out control invokes `signOut()` then `refreshSession()`.
- `prefers-reduced-motion: reduce` disables the content-swap fade.

### 11.3 Rules and callable validation

Step 5 introduces no rules change and no callable change. No emulator rules test is added or modified. Sprint 2 emulator tests continue to pass unchanged.

### 11.4 Cross-cutting checks

- Grep the changed files for em dashes (`—`); zero hits required.
- Grep the shell modules for `session.uid` and `session.schoolId`; expected hits only in the header identity-passing plumbing, never in a rendered DOM node's text content or accessible name.
- Confirm no shell module imports from `platform/functions/**`.
- Confirm no shell module reads `localStorage`, `sessionStorage`, `document.cookie`, or `window.location.search`.
- Confirm no shell module calls `initializeApp`. Firebase initialization remains centralized in `app/src/firebase.ts`.
- Confirm no shell module opens a Firestore listener (`onSnapshot`, `onSnapshotsInSync`).

---

## 12. Chris Local Verification Plan

The verification plan mirrors the Step 4 rhythm.

### 12.1 Environment

1. `cd app && npm ci` if the lockfile has changed. Otherwise skip.
2. `npm run build` inside `app/`. Expect zero TypeScript errors.
3. `npm test` inside `app/`. Expect the Step 5 unit tests to pass alongside the existing Step 3 and Step 4 suites.
4. Start the Firebase emulator suite per `LYFELABZ_EMULATOR_SUITE_GUIDE.md`.
5. Serve the `app/` build through `firebase emulators:start --only hosting,auth,firestore,functions`.

### 12.2 Manual walkthrough

Chris performs these walks in order. Each is expected to take under two minutes.

1. **Active teacher arrival.** Sign in as an approved test teacher. Confirm the shell renders. Confirm header shows "LyfeLabz Teacher Platform", display name, and school name. Confirm the sign-out control is visible. Confirm the notifications placeholder is present and labeled.
2. **Home surface content.** Confirm the welcome message reads "Welcome, {displayName}." Confirm the platform status sentence renders. Confirm the identity card shows display name, email, school, "Teacher", and a "Verified" gold pill. Confirm the identity card does not show `uid` or `schoolId`.
3. **Placeholder cards.** Confirm five cards render in the order Classes, Students, Assignments, Reports, Settings. Confirm each reads "Coming in a future sprint." Confirm none respond to hover, focus, click, or keyboard activation.
4. **Navigation.** Confirm five navigation items in the order Home, Classes, Students, Assignments, Settings. Confirm Home is the only interactive item and carries `aria-current="page"`. Confirm each coming-soon item shows " - Coming soon". Confirm none respond to activation.
5. **Sign out.** Click the header sign-out control. Confirm dispatch to the Step 4 signed-out surface. Confirm no console errors.
6. **Return to public lessons.** From the Home surface, click "Return to public lessons". Confirm arrival at `/`. Confirm the anonymous instructional experience is unchanged.
7. **Responsive behavior.** Resize the viewport through 320px, 480px, 720px, 960px, and 1120px. Confirm navigation collapses to a horizontal strip below 720px. Confirm no horizontal scrolling at any width above 320px. Confirm the identity card and placeholder cards restack correctly.
8. **Accessibility spot check.** Tab through the shell using only the keyboard. Confirm focus visits Home, then the sign-out control, then the Home surface's return-to-public-lessons link. Confirm coming-soon navigation items are skipped by tab. Run an axe or Lighthouse accessibility pass; confirm zero critical findings.
9. **Screen reader spot check.** With VoiceOver (macOS) or NVDA (Windows), confirm the four landmarks are announced. Confirm Home is announced as "Home, current page". Confirm coming-soon items are announced as disabled.
10. **Session display audit.** Open the shell DOM in DevTools. Confirm `uid`, `schoolId`, and claim payload values do not appear anywhere in the rendered DOM. Confirm the Firebase project identifier does not appear.
11. **Zero-reads audit.** In the emulator Firestore log, confirm shell mount produces zero additional reads beyond those already emitted by the bootstrap. Confirm sign-out and re-sign-in produce only the bootstrap reads.
12. **Reduced motion.** Set `prefers-reduced-motion: reduce`. Confirm no motion beyond static state changes.
13. **Em dash sweep.** `grep -R "—" app/src/shell app/src/router/routes/activeTeacher.ts` returns zero hits.
14. **Anonymous experience preserved.** Visit `/` and browse a lesson. Confirm no shell code interferes with the anonymous experience. Confirm the browser does not attempt any additional Firebase Auth call on the anonymous route.

### 12.3 Non-teacher regression check

- Sign in as a provisioned, pending, suspended, and archived test user in turn. Confirm each is routed to its Step 4 surface and never to the shell.
- Sign in as a student and administrator test user. Confirm each is routed to its Step 4 stub and never to the shell.

---

## 13. Rollback Plan

Step 5 is client-only. Rollback is a Hosting-only operation and does not touch Firestore data, Auth users, custom claims, Cloud Functions, security rules, or indexes.

### 13.1 Trigger conditions

Roll back Step 5 if any of the following are observed after deployment:

- The shell renders for a Session kind other than `activeTeacher`.
- A coming-soon navigation item or placeholder card responds to activation.
- The header, Home identity card, or any shell region renders `uid`, `schoolId`, or a claim payload.
- The shell emits any Firestore read or callable invocation on mount, on navigation, or on refresh.
- Sign-out from the shell fails to clear the Session and re-run the bootstrap.
- Any Step 4 surface (signed-out, provisioned, pending, suspended, archived, error, loading) breaks as a side effect of the shell landing.

### 13.2 Rollback procedure

1. `firebase hosting:clone` the previous production release into the current channel, or `firebase hosting:releases:rollback` to the last Step 4 release identifier.
2. Confirm `/app/` returns the Step 4 `activeTeacher` minimal surface.
3. Confirm every other Step 4 surface is unchanged.
4. Confirm the anonymous instructional experience at `/` is unchanged.
5. Announce the rollback in the internal channel with the release identifier.

### 13.3 Post-rollback state

Because Step 5 modifies no server-side artifact, the platform's authoritative state (Firestore records, custom claims, Cloud Functions, security rules) is identical before and after rollback. No data reconciliation is required.

### 13.4 Re-attempt

A re-attempt requires an amendment to this specification identifying the cause of the rollback and the specific change that addresses it. Re-attempts do not proceed on the assumption that "the fix is small enough to skip the amendment."

---

## 14. Open Questions and Deferred Decisions

The following are intentionally left open and are called out here so the implementation review does not treat them as accidental omissions.

1. **Product mark asset.** Whether the header product mark includes a raster or SVG logo alongside the text is deferred. Step 5's default is text-only. A canonical LyfeLabz mark, if it already exists in the repository, may accompany the text at the implementation reviewer's discretion.
2. **Shell styles location.** Whether the shell layout tokens live in a new `app/src/styles/shell.css` file or in an inline `<style>` block in `app/index.html` is left to the implementation reviewer. Both satisfy §10.
3. **Reports vs. navigation.** The Reports placeholder card appears on the Home surface but not in the navigation. A future sprint decides whether Reports is a top-level navigation item, a Students sub-surface, an Assignments sub-surface, or a Home-only widget. Step 5 does not decide.
4. **Notifications placeholder styling.** Whether the notifications bell is a monochrome outline glyph or a small labeled chip is left to the implementation reviewer, provided the result reads as unavailable and carries the required `aria-label`.
5. **Header school-name affordance.** Whether the header school-name should ever be a link (for a future school-picker capability, if the platform later supports multi-school teachers) is deferred. Step 5 renders `schoolName` as static text.

None of these open questions blocks approval of the Step 5 specification.

---

## 15. Approval Gate

Implementation of Step 5 begins only after this document is separately approved. Approval implies:

- The shell layout (header, navigation, main, footer) is specified.
- The header composition, including branding, identity summary, notifications placeholder, and sign-out, is specified.
- The persistent navigation is specified with one functional item (Home) and four clearly-marked coming-soon items.
- The Home surface is specified, including welcome message, platform status, identity summary card, five placeholder cards, and return-to-public-lessons link.
- Session-display rules explicitly enumerate what is shown and what is withheld.
- Accessibility, responsive behavior, and non-goals are specified.
- No new lifecycle state, no new claim, no new collection, no new callable, no rules change, no indexes change, no hosting change, and no new Firestore reads.
- Files expected to change are enumerated and bounded to `app/**` and `docs/**`.
- Validation, local verification, and rollback plans are defined and executable.

Any deviation from the above in the implementation phase pauses work and amends this specification.
