# Sprint 6 Teacher Workspace Certification

**Status:** Certified as Teacher Workspace Version 1.
**Date:** 2026-07-10.
**Scope:** Certification only. No production code was modified. No tests were modified. No runtime behavior was changed. No commits were made.
**Authority:** This document certifies the completed implementation delivered across Sprints 6A, 6B, 6C, 6D, 6D.0, 6D Certification, 6E, 6F, 6G, and 6H, and the accompanying Present Mode Architecture Amendment and Platform Contracts Documentation Amendment recorded in `SPRINT_HISTORY.md`.
**Companion documents:** `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_PLATFORM_DECISIONS.md`, `PLATFORM_CONTRACTS.md`, `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md`, `TEACHER_JOURNEY.md`, `ASSIGN_EXPERIENCE.md`, `PRESENT_MODE_ARCHITECTURE.md`, `SPRINT_HISTORY.md`, and each per-sprint completion report referenced below.

---

## 1. Certification Statement

The Teacher Workspace, as it exists at the completion of Sprint 6H, is certified as Version 1.

Certification means:

- The workspace shell, workspace outlet, and left-side navigation match the certified architecture.
- The four permanent workspace surfaces (Curriculum, Classes, Present Mode, Settings) are implemented at the scope certified for Version 1.
- The Assign Experience is implemented at the certified UI-only scope inside the Curriculum surface.
- The Present Mode launch-and-return flow is implemented against the certified platform contracts.
- The canonical curriculum manifest is the sole source of curriculum metadata inside the Teacher Workspace.
- Repository validation passes across the App, Functions, and Firestore Rules packages.

Certification does not mean feature completeness. Substantial scope is intentionally deferred, and this document distinguishes explicitly between what is Completed and what is Intentionally Deferred.

---

## 2. Completed vs Intentionally Deferred

### 2.1 Completed in Version 1

- Teacher Workspace shell and workspace outlet.
- Persistent left-side navigation: LYFELABZ, Curriculum, Classes, Present Mode, Settings.
- Curriculum surface backed by the canonical curriculum manifest, with grade filter, topic filter, activation toggle, and welcome copy.
- Assign Experience dialog inside the Curriculum surface: one dialog per lesson card, independent per-class rows, remembered session preferences, default selections, and the `✓ Assigned` card state.
- Classes surface as a canonical read-only foundation.
- Present Mode workspace surface with the single certified `Launch Present Mode` action.
- Present Mode launch context (`lyfelabz.presentMode.returnContext`, `version: 1`, `returnSurface: "curriculum"`) with same-tab launch (`window.location.assign("/")`).
- Present Mode return script on the canonical instructional experience, exposing the certified `Return to Teacher Workspace` control only when a valid marker is present.
- Settings surface as a canonical teacher-only foundation state.
- Repository-wide validation across App, Functions, and Firestore Rules packages.

### 2.2 Intentionally Deferred

- Snapshot surface for Classes.
- Class analytics, spreadsheet-style class workspace, per-student drilldowns.
- Teacher preferences, preference persistence, or any user-editable Settings control.
- Backend persistence of Assign Experience state (no Firestore write, no callable, no custom claim, no lifecycle field).
- Google Classroom integration, Google Drive integration, Google Meet integration.
- Notifications of any kind.
- Presentation tools, speaker notes, timers, broadcasting, and classroom synchronization.
- Accommodations and private student supports (own architecture pass required).
- Any surface not on the permanent left-side navigation.

---

## 3. Architecture Compliance

The Teacher Workspace conforms to the certified platform architecture.

- **Platform identity and boundaries.** The authenticated Teacher Platform lives under `/app/**`; the canonical public instructional experience lives at the repository root. `LYFELABZ_PLATFORM_ARCHITECTURE.md` §16 is respected. No parallel router or duplicate shell was introduced.
- **Locked decisions.** PDR-007 (one canonical curriculum), PDR-010 (assignment schema names), PDR-017 (no parallel workspace shell), and PDR-018 (canonical instructional experience is the sole presentation engine) are preserved.
- **Session model.** No new Session Object field was introduced. No new custom claim was introduced. The shell no-Firebase invariant established in Sprint 3 Step 5 is preserved: the workspace surfaces import only the Session type and no `firebase/*` module.
- **Domain roadmap.** The Curriculum, Classes, Present Mode, and Settings surfaces fit within the Phase 2 UX Direction certified in `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`. Phases 4 through 7 (enrollment, assignment, submission, analytics) remain deferred.

---

## 4. Product Compliance

The Teacher Workspace matches the certified product documents.

- **`TEACHER_EXPERIENCE_PHILOSOPHY.md`.** The permanent workspace navigation shape from §3.3 is now realized. Curriculum is the primary landing surface per §3.2 and §4.2. Present Mode is treated as a separate surface per §3.4. Settings owns future teacher preferences per §3.6.
- **`TEACHER_JOURNEY.md`.** The Prepare → Assign → Present Mode → Teach → Return sequence is realized structurally: the teacher prepares in Curriculum, assigns per class through the single Assign dialog, launches Present Mode without changing tabs, teaches on the canonical instructional experience, and returns to the Teacher Workspace through the certified return affordance.
- **`ASSIGN_EXPERIENCE.md`.** One dialog, per-class independent rows, remembered session preferences, default selections, the assigned card state, and the reopen workflow are all implemented as certified.
- **`PRESENT_MODE_ARCHITECTURE.md`.** The preparation surface, the single semantic launch action, the same-tab navigation, the certified return context, projector safety, and the absence of a second presentation engine are all satisfied. Section 14 was amended before Sprint 6G implementation began.

---

## 5. Platform Contracts Compliance

Compliance with `PLATFORM_CONTRACTS.md`:

- **§4 Namespace rules.** The Present Mode return marker uses the certified `lyfelabz.<feature>.<purpose>` pattern via `lyfelabz.presentMode.returnContext`. No other client-side key was introduced.
- **§5 Browser storage rules.** `sessionStorage` is used only for the tab-scoped return-context marker. No `localStorage`, `document.cookie`, URL query parameter, or URL fragment was introduced to carry teacher, class, student, assignment, or authentication state.
- **§6 Versioned client-side schema.** The return-context schema is `{ version: 1, returnSurface: "curriculum" }`. Unsupported versions, unsupported surfaces, missing fields, and malformed JSON all fail safely.
- **§7 Routing boundaries.** No new route was created. Product-surface identifiers (`curriculum`, `classes`, `present-mode`, `settings`) name workspace destinations, not URLs. No parallel router or workspace shell was introduced.
- **§8 Public/authenticated separation.** The canonical instructional experience remains SDK-free. The Present Mode return script imports no Firebase SDK, reads no authenticated state, and no-ops without a valid marker.
- **§9 Projector safety.** No teacher, class, or student identifier is stored, read, or rendered by the launch button, the marker, or the return control. All four workspace surfaces render no data that could leak on projection.
- **§10 Accessibility.** Semantic elements, keyboard operability, accessible names, focus behavior on surface mount, and no color-only meaning are honored across the four workspace surfaces.
- **§11 Safe failure.** Every ingest of client-side context (return marker read, storage failure, dialog session preferences) fails safely and preserves the primary experience.

---

## 6. Accessibility Compliance

Verified accessibility guarantees preserved by Sprint 6H:

- Each surface headline is a semantic `<h2>` with `id="surface-headline"`, `tabindex="-1"`, and receives focus on activation.
- The left-side navigation exposes `aria-current="page"` on the active item.
- Every interactive control (nav item, activation toggle, filter pill, Assign control, dialog control, Launch Present Mode, Return to Teacher Workspace) is a semantic button or link, keyboard operable, and carries a clear accessible name.
- No control conveys meaning through color alone.
- No control is icon-only without an accessible text equivalent.
- The Present Mode return control is announced by the certified accessible name `Return to Teacher Workspace` and only renders when a valid marker is present.

Accessibility remains a minimum contract, not a detailed accessibility specification.

---

## 7. Repository Validation

Commands executed for this certification. Working directories are the exact directories run.

### 7.1 App package

Working directory: `app`.

```bash
cd app
npm run typecheck    # passed
npm run lint         # passed
npm run build        # dist/bundle.js  959.6kb
npm test -- --runInBand   # 227 tests / 8 suites passed
```

### 7.2 Functions package

Working directory: `platform/functions`.

```bash
cd platform/functions
npm run typecheck    # passed
npm run lint         # passed
npm run build        # passed
npm test -- --runInBand   # 295 tests / 22 suites passed
```

### 7.3 Firestore Rules package

Working directory: `platform/firebase`.

```bash
cd platform/firebase
npm run test:rules   # 94 tests / 8 suites passed
```

All commands passed with no failures.

---

## 8. Navigation Certification

- **Order.** LYFELABZ, Curriculum, Classes, Present Mode, Settings, as certified by `TEACHER_EXPERIENCE_PHILOSOPHY.md` §3.3.
- **Availability.** Every canonical workspace-surface key (`curriculum`, `classes`, `present-mode`, `settings`) is now `available: true`. No permanent navigation item is disabled.
- **Active state.** The active item exposes `aria-current="page"`. The workspace outlet advertises `data-active-surface` matching the active surface key.
- **Accessibility.** Each nav item is a semantic control, keyboard operable, with an accessible name.
- **Duplicate routing.** No parallel router was introduced. Selection state is managed inside the certified workspace outlet.
- **Duplicate shell.** No parallel Teacher Workspace shell exists. The Sprint 6A shell is the only shell.

---

## 9. Workspace Surface Certification

### 9.1 Curriculum

- Canonical landing experience backed by the generated `curriculum.manifest.json` via the typed selector at `app/src/curriculum/curriculumManifest.ts`.
- Welcome copy, grade filter, topic filter, activation toggle, and return-to-public-lessons link preserved from Sprint 6D as certified.
- Assign Experience integrated per lesson card. Session-memory behavior for remembered defaults is retained across dialog opens within the same session.
- No backend persistence: no Firestore write, no callable invocation, no `firebase/*` import in `src/shell/**`.

### 9.2 Classes

- Canonical foundation surface renders per certified Version 1 scope.
- No Snapshot implementation. No class analytics. No per-student drilldown. No spreadsheet-style workspace.
- No backend persistence.

### 9.3 Present Mode

- Preparation surface answers "What can I prepare to present?" with a title, intro, ordered preparation steps, and future-controls notice.
- Single semantic `Launch Present Mode` button.
- Certified same-tab launch via `window.location.assign("/")` after writing the certified return-context marker.
- Return context under `lyfelabz.presentMode.returnContext` with `{ version: 1, returnSurface: "curriculum" }`.
- The canonical instructional experience loads `assets/present-mode-return.js`. It renders the certified `Return to Teacher Workspace` control only when a valid marker is present, imports no Firebase SDK, and cleans up the marker before returning to `/app/teacher`.
- Projector safety: no teacher, class, or student identifier is stored, read, or rendered.
- No presentation engine is introduced. The canonical instructional experience remains the presentation experience.

### 9.4 Settings

- Teacher-only foundation state. Title, intro, purpose, future preference categories list (Classroom Preferences, Present Mode Preferences, Notification Preferences, Connected Services, Account Preferences), growth notice.
- No controls, no persistence, no fake settings, no sample data.
- Future preference organization is informational only and does not commit implementation to any category.

---

## 10. Assign Experience Certification

The Assign Experience implementation from Sprint 6E is preserved by Sprint 6G and Sprint 6H:

- Exactly one dialog per lesson card.
- Independent per-class rows.
- Default selections aligned with the certified specification.
- Session-scoped remembered preferences.
- `✓ Assigned` card state after confirmation.
- Reopen workflow returns the teacher to the same dialog for adjustments.
- Cancellation preserves prior state.
- Empty-class state handled.
- No Firestore write, no callable, no custom claim, no lifecycle field, no Google Classroom publication.

Sprint 6G did not alter Assign behavior.

---

## 11. Platform Contracts Certification

The Version 1 implementation conforms to every contract certified in `PLATFORM_CONTRACTS.md` §12 as of this document:

- Teacher Platform route boundary: `/app/**`.
- Canonical public instructional route: `/` (repository root).
- Browser storage namespace pattern: `lyfelabz.<feature>.<purpose>`.
- Present Mode return-context storage key: `lyfelabz.presentMode.returnContext`.
- Present Mode return-context schema version: `version: 1`.
- Present Mode initial return surface: `returnSurface: "curriculum"`.
- Present Mode launch navigation: same-tab (`window.location.assign("/")`).
- Present Mode public-surface return behavior: return script no-ops without a valid marker; imports no Firebase SDK.

No implementation-driven contract additions were made. Any future contract addition follows the Section 13 amendment process.

---

## 12. Teacher Journey Certification

The Teacher Workspace now supports the Prepare → Assign → Present Mode → Teach → Return sequence described in `TEACHER_JOURNEY.md`:

- **Prepare.** The teacher lands on Curriculum. Grade and topic filters, activation, and preview links are available.
- **Assign.** One dialog per lesson card. Independent per-class rows. Remembered defaults. Assigned state.
- **Present Mode.** Preparation surface. Single semantic launch action.
- **Teach.** Canonical instructional experience is projected. No teacher-scoped data is loaded.
- **Return.** Certified return control returns to the Teacher Workspace entry URL; the shell resolves Curriculum as the default landing surface.

No moment in `TEACHER_JOURNEY.md` was violated. Moments that remain deferred (Snapshot, spreadsheet, planning-period analytics, after-school confirmation) are recorded here as Intentionally Deferred.

---

## 13. Risks

Recorded so a future sprint can address them explicitly:

- **Test bundle size.** The App bundle is 959.6 kB. Not a functional risk today, but worth tracking as more surfaces mount.
- **Session-scoped preference memory.** Assign Experience preferences are session-scoped only. Teachers who rely on cross-session memory of default release times will not receive that behavior until preference persistence is designed.
- **Return script coupling.** The canonical instructional experience now loads `assets/present-mode-return.js`. It is the only exception to the SDK-free public surface and must be revisited whenever the canonical `index.html` script tag block changes.
- **Snapshot expectation gap.** `TEACHER_JOURNEY.md` describes a Snapshot as a critical between-classes affordance. Its absence is intentional but should be scheduled before the class workspace deepens.
- **Curriculum manifest regeneration.** The manifest is a derived artifact. Any change to root `index.html` requires regeneration; a stale manifest would misrepresent the curriculum.

---

## 14. Deferred Roadmap

The following remain intentionally deferred and are not part of Version 1:

- Snapshot for Classes.
- Classroom analytics and spreadsheet-style workspace.
- Teacher preferences (persistent).
- Backend persistence of Assign Experience state.
- Google Classroom integration.
- Google Drive integration.
- Google Meet integration.
- Notifications.
- Presentation tools, speaker notes, timers.
- Broadcasting and classroom synchronization.
- Accommodations and private student supports (own architecture pass required).

Deferral does not imply intent to build. Each item is a candidate for a future architecture pass and, if certified, a future implementation sprint.

---

## 15. Certification Conclusion

The Teacher Workspace as it exists at the completion of Sprint 6H is certified as Version 1.

- Architecture compliance: satisfied.
- Product compliance: satisfied.
- Platform contract compliance: satisfied.
- Accessibility compliance: satisfied at the minimum contract.
- Repository validation: satisfied across App, Functions, and Firestore Rules.

Version 1 completeness is bounded by Section 2.2. Nothing in this certification claims implementation of any deferred capability. Nothing in this certification authorizes a subsequent sprint to weaken a certified contract.

---

*End of Sprint 6 Teacher Workspace Certification. Feature architecture remains authoritative for feature behavior. `PLATFORM_CONTRACTS.md` remains authoritative for cross-cutting contracts. `LYFELABZ_PLATFORM_DECISIONS.md` remains authoritative for locked platform decisions.*
