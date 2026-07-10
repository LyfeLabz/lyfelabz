# Sprint 6C - Teacher Workspace Navigation Foundation

Status: Implementation specification.
Companion documents: TEACHER_EXPERIENCE_PHILOSOPHY.md (§3.3, §4.1), PHASE_2_ARCHITECTURE_PLANNING_REPORT.md (§11), PRESENT_MODE_ARCHITECTURE.md, SPRINT_6A_SPECIFICATION.md, SPRINT_6B_COMPLETION_REPORT.md, LYFELABZ_PLATFORM_ARCHITECTURE.md.

---

## 1. Objective

Replace the Sprint 6A/6B top-nav shape with the persistent left-side navigation panel defined in §3.3 of `TEACHER_EXPERIENCE_PHILOSOPHY.md`. The panel is the permanent teacher-workspace navigation. It is the load-bearing UX pattern for every workspace surface that follows.

Sprint 6C is a navigation restructuring sprint. It changes the shape and copy of the navigation and the identity of the default workspace surface. It does not change the certified architecture, add a Firestore read, add a callable, or add a claim.

---

## 2. Scope

**In scope.**

- Left-side navigation panel with the following items in order:
  - `LYFELABZ` - brand mark that returns to the Curriculum surface.
  - `Curriculum` - the teacher curriculum landing surface (active).
  - `Classes` - the Sprint 6B classroom workspace (active, unchanged in behavior).
  - `Present Mode` - disabled coming-soon item.
  - `Settings` - disabled coming-soon item.
- Selecting `LYFELABZ` or `Curriculum` activates the curriculum surface.
- Selecting `Classes` activates the Sprint 6B classroom workspace surface.
- `Present Mode` and `Settings` render as disabled coming-soon buttons under the exact contract used for unavailable navigation items in Sprint 6B: `shell-nav-disabled`, `"Label - Coming soon"` label, `disabled`, `aria-disabled="true"`, `tabindex="-1"`, no-op click handler.
- The Sprint 6B Home surface is renamed to Curriculum. The rename is copy-only: the surface behavior is identical except that its transitional status text now indicates that the curriculum landing arrives in a future sprint (Sprint 6D).
- Keyboard accessibility of the navigation is preserved.
- Existing responsive breakpoints for the shell body remain in effect.
- Unit tests are updated and expanded to cover the new navigation shape and the coming-soon contract for Present Mode and Settings.
- `PRESENT_MODE_ARCHITECTURE.md` is created as an architecture-only document.
- `SPRINT_HISTORY.md` records the Sprint 6C entry.

**Out of scope.**

- Present Mode runtime behavior.
- Settings runtime behavior.
- Curriculum integration or lesson activation.
- Assignment workflow, submission workflow, Google Classroom integration.
- Classroom detail workspace, student roster, student accommodations UI.
- Analytics, teacher preferences.
- New Cloud Functions, Firestore Rules changes, Firestore indexes changes, Storage Rules changes.
- Session Bootstrap, Immutable Session Object, router state-machine changes.
- Any instructional lesson change.

---

## 3. Certified Architecture Preservation

Sprint 6C preserves every certified guarantee:

- Firestore remains authoritative.
- All writes remain server-mediated.
- Firestore Rules remain default-deny.
- `status` remains the only lifecycle field.
- Audit events remain append-only.
- Immutable Session Object contract remains unchanged.
- Custom claims remain `{ role, schoolId }`; `districtId` remains reserved.
- The shell no-Firebase-import invariant established by Sprint 3 Step 5 remains in force.
- No file at the repository root is modified. Preservation mode remains intact.

---

## 4. Navigation Contract

The persistent teacher-workspace navigation is a left-side panel rendered inside `.shell-body`. It contains, in order:

1. `LYFELABZ` - brand mark. `data-testid="nav-lyfelabz"`. Active. On select, activates the Curriculum surface. Rendered with the `shell-nav-brand` variant class in addition to the standard `shell-nav-button` class.
2. `Curriculum` - primary workspace item. `data-testid="nav-curriculum"`. Active. On select, activates the Curriculum surface.
3. `Classes` - primary workspace item. `data-testid="nav-classes"`. Active. On select, activates the Classes surface.
4. `Present Mode` - primary workspace item. `data-testid="nav-present-mode"`. Disabled. Renders as `"Present Mode - Coming soon"` with the disabled contract.
5. `Settings` - primary workspace item. `data-testid="nav-settings"`. Disabled. Renders as `"Settings - Coming soon"` with the disabled contract.

`aria-current="page"` is applied to the primary workspace item whose target surface matches the current active surface. The brand item never carries `aria-current`; it is a navigational shortcut, not a page identity. When the Curriculum surface is active, `Curriculum` carries `aria-current="page"`.

The navigation preserves the existing keyboard behavior: enabled items are focusable and activate on Enter or Space; disabled items are removed from the tab order via `tabindex="-1"`. The `<nav>` element carries `aria-label="Teacher workspace sections"`.

---

## 5. Workspace Surface Registry

`WORKSPACE_SURFACES` is updated to the four surfaces reachable from the navigation:

- `curriculum` - the renamed Home surface. Renders welcome, transitional status, identity card, placeholder card grid, and the return-to-lessons link. Behavior is identical to the Sprint 6B `home` surface with the transitional status copy update described in §6.
- `classes` - the Sprint 6B classroom workspace surface. Unchanged.
- `present-mode` - renders through `renderComingSoonSurface({ title: "Present Mode" })`. Unreachable through the shell today because the navigation item is disabled. The entry exists so the contract is complete for future sprints.
- `settings` - renders through `renderComingSoonSurface({ title: "Settings" })`. Unreachable through the shell today because the navigation item is disabled.

The `home`, `students`, and `assignments` surface keys are removed. `Reports` was never a navigation item and remains only as a placeholder card inside the Curriculum surface for continuity with Sprint 6A copy.

The default active surface on shell mount is `curriculum`.

---

## 6. Curriculum Surface (Renamed Home Surface)

The Sprint 6B `renderHomeSurface` moves to `app/src/shell/surfaces/curriculum.ts` and is exported as `renderCurriculumSurface`. Behavior is identical except:

- The transitional status paragraph reads:
  `The curriculum landing arrives in a future sprint. New capabilities will appear here as they are released.`

Every other element is preserved:

- The welcome headline still reads `Welcome, ${displayName}.` (falling back to `Welcome to LyfeLabz.` when the display name is empty).
- The identity card renders with the same fields as Sprint 6B.
- The placeholder card grid renders exactly the same five cards in the same order: Classes, Students, Assignments, Reports, Settings. Renaming the surface does not change the placeholder-card set; those cards are Sprint 6A copy and are removed only by a later sprint that replaces this transitional surface with the Sprint 6D curriculum landing.
- The return-to-lessons anchor is preserved.
- Focus lands on the welcome headline on mount.

This mitigates the risk called out in §11 of the Phase 2 Architecture Planning Report: the surface's own copy names it as transitional so that renaming Home to Curriculum does not imply that curriculum content is already delivered.

---

## 7. Shell Layout

`mountTeacherShell` continues to render header, body (nav mount + outlet host), and footer in that order. The body remains a two-column CSS Grid with the navigation on the left and the workspace outlet on the right, at breakpoints wider than 720 pixels. Below 720 pixels the navigation collapses to a horizontally scrolling row at the top of the body, preserving Sprint 6A/6B responsive behavior.

`ShellDeps` is unchanged. `WorkspaceDeps` is unchanged. The nav-mount and outlet-host containers are unchanged. The active-surface state variable defaults to `curriculum` instead of `home`.

No shell module imports a `firebase/*` module. The static-source assertion in `shell.test.ts` continues to guard this invariant.

---

## 8. Test Updates

The Sprint 6B test file `app/src/shell/shell.test.ts` is updated in place:

- The `Navigation composition and disabled posture` block is rewritten around the new item order (LYFELABZ, Curriculum, Classes, Present Mode, Settings), the brand-item posture, the enabled-item posture, and the disabled coming-soon contract.
- The `Home surface composition` block is renamed to `Curriculum surface composition`. It targets `renderCurriculumSurface` and updates the platform-status assertion to the new transitional copy.
- The `Workspace outlet` block updates `data-active-surface` expectations to `curriculum` (instead of `home`) and updates the `WORKSPACE_SURFACES` key set to `["classes", "curriculum", "present-mode", "settings"]`.
- The `Classroom Workspace surface (Sprint 6B)` block is preserved. `clickClasses` continues to click `data-testid="nav-classes"`.
- New assertions cover the LYFELABZ brand item: activating it from the Curriculum surface is a no-op re-render; activating it from the Classes surface returns the outlet to `curriculum`.
- New assertions cover the Present Mode and Settings coming-soon contract: `"Present Mode - Coming soon"` / `"Settings - Coming soon"` labels, `disabled`, `aria-disabled="true"`, `tabindex="-1"`, no dispatch on click.

The `app/src/router/surfaces/surfaces.test.ts` `active teacher surface (Step 5 shell)` assertion continues to pass because the Curriculum surface preserves the `Welcome, Ada.` headline.

---

## 9. Repository Validation

Sprint 6C is complete when:

- `app` typecheck is clean.
- `app` lint is clean.
- `app` build (`esbuild`) is clean and `dist/bundle.js` is produced.
- `app` unit tests pass with a total no less than the Sprint 6B baseline (120 / 5) and preferably higher.
- `platform/functions` typecheck, lint, and build are clean.
- `platform/functions` unit tests pass at 295 / 22 (unchanged).
- `platform/firebase` Rules tests pass at 94 / 8 (unchanged).

---

## 10. Exit Criteria

- Certified router, session, functions, and Rules tests remain green.
- Navigation renders exactly LYFELABZ, Curriculum, Classes, Present Mode, Settings in order.
- Curriculum and Classes are the active surfaces. Present Mode and Settings are disabled coming-soon items.
- The default landing surface is Curriculum.
- No file outside `app/src/shell/**`, `app/src/router/routes.ts`, `app/src/router/surfaces/**`, `app/src/router/surfaces/surfaces.test.ts` (only if a headline assertion needs to change - it does not in this sprint), `app/index.html` (CSS-only), `docs/platform/**`, and this specification is modified.
- No file at the repository root is modified.
- No Firestore Rule, Cloud Function, index, or Storage Rule is modified.
- `PRESENT_MODE_ARCHITECTURE.md` exists and is architecture-only.

---

*End of Sprint 6C specification.*
