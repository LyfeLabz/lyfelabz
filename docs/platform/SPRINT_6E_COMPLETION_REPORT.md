# Sprint 6E - Assign Experience (Curriculum Card) - Completion Report

**Date:** 2026-07-10
**Status:** Implementation complete. Awaiting Technical Lead review and local verification by Chris.
**Companion documents:** ASSIGN_EXPERIENCE.md, TEACHER_JOURNEY.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, PRESENT_MODE_ARCHITECTURE.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, SPRINT_HISTORY.md.

---

## 1. Objective

Deliver the first working version of the Assign Experience described in `ASSIGN_EXPERIENCE.md`. Curriculum lesson cards gain an Assign control that opens a single modal dialog exposing one row per class, with per-row date, release time, Google Classroom topic, and points controls. Confirming the dialog updates the card to "✓ Assigned" and returns the teacher to exactly the same location on the Curriculum surface.

Sprint 6E is a UI implementation sprint. No backend scheduling, Firestore write, callable, Cloud Function, Google Classroom API integration, teacher-preference persistence, Session model change, Firestore Rule change, or route change is introduced. Assignment state and remembered preferences live in module-scoped in-memory session state and clear on a full page reload.

## 2. Architecture Review

The following certified architecture documents were reviewed before implementation began:

- `LYFELABZ_PLATFORM_ARCHITECTURE.md`
- `LYFELABZ_PLATFORM_DECISIONS.md`
- `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`
- `TEACHER_EXPERIENCE_PHILOSOPHY.md`
- `TEACHER_JOURNEY.md`
- `ASSIGN_EXPERIENCE.md`
- `PRESENT_MODE_ARCHITECTURE.md`

No conflict with the certified architecture was found. The Sprint 6E surface maps directly onto ASSIGN_EXPERIENCE.md sections 3 through 8 (Opening the Dialog, Preparing an Entire Day, Configuring Individual Classes, Scheduling, Confirmation, Revisiting Existing Assignments). Every load-bearing product decision named in ASSIGN_EXPERIENCE.md section 9 is realized by the shipped UI: one workflow, one dialog, all classes selected by default, per-row configuration, today-first date, remembered preferences, in-place confirmation, and revisit through the same dialog.

The Assignment Foundation phase (Phase 5) retains ownership of teacher-preference persistence, the `assignments/{...}` document, backend scheduling, Google Classroom publication, and any post-release edit bounds. Sprint 6E is careful to hold those concerns at arm's length: no persistence surface, no scheduling record, no external API call is introduced.

## 3. Deliverables

### Runtime

- `app/src/shell/surfaces/curriculum.ts` - rewritten. Added Assign control per lesson card, Assignment Dialog, per-class row rendering, module-scoped session memory, class-list prefetch through the injected `ListClasses` fetcher, ✓ Assigned card state, and a self-dismissing success confirmation banner. Preserved every Sprint 6D behavior (welcome copy, curriculum intro, filter pills, lesson grid, activation toggle, return link).
- `app/src/shell/surfaces/workspace.ts` - updated to pass `deps.listClasses` into `renderCurriculumSurface` so the dialog can populate its class rows.

### Tests

- `app/src/shell/shell.test.ts` - added a new `Assign Experience - Sprint 6E` suite of ten tests:
  1. Every lesson card renders an Assign button in its unassigned state.
  2. Clicking Assign opens the modal dialog with one row per active class, all selected by default.
  3. Assignment date defaults to today, points to the quiz default, release time to the session default.
  4. Assign button is disabled when every class row is deselected.
  5. Confirming closes the dialog and flips the card to "✓ Assigned".
  6. Clicking "✓ Assigned" reopens the same dialog with prior values populated.
  7. Deselecting every row and reconfirming returns the card to Assign.
  8. Release time and Google Classroom topic are remembered across dialog opens within the session.
  9. Cancelling the dialog schedules nothing and leaves the card in its unassigned state.
  10. The dialog surfaces a friendly empty state when the teacher has no active classes.

### Documentation

- `docs/platform/SPRINT_HISTORY.md` - appended Sprint 6E entry.
- `docs/platform/SPRINT_6E_COMPLETION_REPORT.md` - this document.

### Deliberately not modified

- No `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json`, or Cloud Function source was touched.
- No Session, bootstrap, router, header, footer, or navigation module changed.
- No lesson HTML, canonical curriculum manifest, or root `index.html` changed.
- No new callable, custom claim, lifecycle field, Session field, or audit vocabulary term was introduced.

## 4. UX Fidelity to ASSIGN_EXPERIENCE.md

| ASSIGN_EXPERIENCE.md Rule | Sprint 6E Implementation |
| --- | --- |
| Every assignable card carries an Assign control | Every lesson card renders an `Assign` button (§3). |
| Dialog is one dialog, not a wizard | Single modal with rows, no step navigation. |
| Dialog opens quickly with prefilled values | Class list is prefetched on curriculum mount and cached in module state. |
| Every class appears as a row | One `assign-row-{classId}` per active class. |
| Every class selected by default | Row checkbox is checked at initial open. |
| Deselection is a single click | Row checkbox flips row and greys out the fields. |
| Default date is Today | Prefilled from local `new Date()`. |
| Release time is a per-day teacher decision, prefilled from remembered value | Session-scoped `sessionPreferences.releaseTime` prefills every row. |
| Google Classroom topic is prefilled from last-used, absent when integration is off | Prefilled per row from `sessionPreferences.topic`. Field remains visible so teachers can enter a topic; a follow-up sprint will hide it when integration is disabled. |
| Points default to total possible quiz score | Prefilled to `10`, the canonical LyfeLabz quiz total. A follow-up sprint will surface per-lesson quiz totals when the manifest exposes them. |
| Per-row edits do not propagate to other rows | Each row owns its own `RowConfig` reference. |
| Confirm is a single action | One confirm button at the bottom of the dialog. |
| Confirm is disabled when nothing is selected | Confirm reflects "at least one row enabled" and updates on every checkbox change. |
| Teacher returns to exactly the same Curriculum location | Dialog closes; the mount is not re-rendered. Scroll position, filters, and grid remain intact. |
| Card updates in place to "✓ Assigned" | The Assign button on the card is updated in place; no re-render of the surface. |
| Confirmation is quiet, dismissible, self-dismissing | Live-region banner shows for four seconds and clears itself. |
| Clicking "✓ Assigned" reopens the same dialog with current values | Dialog opens with rows seeded from `sessionAssignments.get(slug)`. |
| Unassign is a deselection inside the dialog | Deselecting every row and reconfirming removes the assignment. |

## 5. Session Memory Model

Sprint 6E is UI-only, so all state that ASSIGN_EXPERIENCE.md describes as "remembered" lives in module-scoped variables inside `curriculum.ts`:

- `sessionAssignments: Map<string, Assignment>` - lesson-slug -> per-class row configuration for every assignment created during this browser session.
- `sessionPreferences: { releaseTime, topic }` - last-used release time and Google Classroom topic, both updated on every successful confirmation whose enabled rows carry those values.
- `cachedClasses: { uid, rows } | null` - the teacher's class list, fetched once via the injected `listClasses(uid)` fetcher. Keyed by uid so a teacher-swap in the same tab does not surface a stale list.

All three reset on a full page reload. When the Assignment Foundation phase certifies teacher-preference persistence, this surface will read from a real preference source without changing its rendered shape.

## 6. Data and Callable Posture

- No Firestore read, listener, or write is opened from `curriculum.ts`. Class fetching flows through the injected `ListClasses` fetcher already wired at the client entry point; no new callable is introduced.
- No `firebase/*` module is imported anywhere under `app/src/shell/**`. The shell "no firebase imports" invariant (Sprint 3 Step 5) is preserved.
- No `localStorage`, `sessionStorage`, or `document.cookie` access is added. The existing shell-file assertion in `shell.test.ts` continues to pass.

## 7. Verification

### App (`app/`)

- Typecheck: `npx tsc --noEmit` - clean.
- Lint: `npx eslint 'src/**/*.ts'` - clean.
- Build: `npm run build` - `dist/bundle.js` produced.
- Tests: `npx jest` - 6 suites, 159 tests, all passing (10 new tests in the Assign Experience suite).

### Functions (`platform/functions/`)

- Typecheck: `npx tsc --noEmit` - clean.
- Lint: `npx eslint 'src/**/*.ts'` - clean.
- Build: `npm run build` - clean.
- Tests: `npx jest` - 22 suites, 295 tests, all passing.

### Firestore Rules (`platform/firebase/`)

- Tests: `npm run test:rules` - 8 suites, 94 tests, all passing under the Firestore emulator.

Repository-wide totals unchanged from Sprint 6D outside of the ten new Sprint 6E app tests.

## 8. Recommendation

No commit is recommended until Technical Lead review of this report and local verification by Chris are complete. On approval, this sprint may be committed as a single change touching `app/src/shell/surfaces/curriculum.ts`, `app/src/shell/surfaces/workspace.ts`, `app/src/shell/shell.test.ts`, `docs/platform/SPRINT_HISTORY.md`, and `docs/platform/SPRINT_6E_COMPLETION_REPORT.md`. No architecture amendment is required. No follow-up sprint is required to close Sprint 6E; the Assignment Foundation phase (Phase 5) remains the canonical owner of persistence, scheduling, Google Classroom publication, and post-release edit bounds.
