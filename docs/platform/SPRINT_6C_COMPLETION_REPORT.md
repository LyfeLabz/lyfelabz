# Sprint 6C - Completion Report

**Date:** 2026-07-09
**Status:** Implementation complete; awaiting Technical Lead review and local verification by Chris. No commit produced by Sprint 6C itself.
**Companion documents:** SPRINT_6C_SPECIFICATION.md, PRESENT_MODE_ARCHITECTURE.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, PHASE_2_ARCHITECTURE_PLANNING_REPORT.md, SPRINT_6B_COMPLETION_REPORT.md.

---

## 1. Files created

- `app/src/shell/surfaces/curriculum.ts` - the renamed Sprint 6B Home surface. Exports `renderCurriculumSurface`. Behavior is identical to the prior `renderHomeSurface` except the transitional status paragraph now reads `"The curriculum landing arrives in a future sprint. New capabilities will appear here as they are released."`, per SPRINT_6C_SPECIFICATION.md §6.
- `docs/platform/PRESENT_MODE_ARCHITECTURE.md` - architecture-only document defining Present Mode's purpose, entry, exit, security posture, privacy posture, prohibited data, filter behavior, grade persistence strategy, URL strategy, the rationale for reusing the canonical LyfeLabz surface, and the deferred implementation-sprint decisions.
- `docs/platform/SPRINT_6C_SPECIFICATION.md` - the Sprint 6C implementation specification.
- `docs/platform/SPRINT_6C_COMPLETION_REPORT.md` - this document.

## 2. Files modified

- `app/src/shell/navigation.ts` - `NavigationKey` is now a `NavigationItemKey` alias, backed by the new `WorkspaceSurfaceKey` union (`curriculum | classes | present-mode | settings`) plus the brand key `lyfelabz`. `NavigationItem` gains `targetSurface` and `variant`. `NAVIGATION_ITEMS` is replaced with the Sprint 6C five-item list (LYFELABZ, Curriculum, Classes, Present Mode, Settings). `renderNavigation` accepts `activeKey: WorkspaceSurfaceKey`, applies `aria-current="page"` only to item-variant buttons whose `targetSurface` matches, dispatches through `targetSurface` on click, and adds `data-nav-variant` plus the `shell-nav-brand` class to the brand item. The `<nav>` `aria-label` is now `Teacher workspace sections`.
- `app/src/shell/surfaces/workspace.ts` - `WORKSPACE_SURFACES` is retyped over `WorkspaceSurfaceKey` and registers exactly `curriculum`, `classes`, `present-mode`, and `settings`. The `home`, `students`, and `assignments` entries are removed. `mountWorkspaceOutlet` accepts `activeKey: WorkspaceSurfaceKey`. The `curriculum` entry delegates to `renderCurriculumSurface`; `classes` is unchanged; `present-mode` and `settings` delegate to `renderComingSoonSurface`.
- `app/src/shell/shell.ts` - the default active surface is now `curriculum`. `ShellDeps` and `WorkspaceDeps` are unchanged. The nav-mount and outlet-host containers are unchanged. The onSelect callback receives the `WorkspaceSurfaceKey` produced by the navigation module, so a click on LYFELABZ dispatches to `curriculum` transparently.
- `app/src/shell/shell.test.ts` - the test file is expanded to cover the Sprint 6C navigation shape, the LYFELABZ brand posture, the Curriculum surface rename and transitional copy, the removed `home`/`students`/`assignments`/`reports` items, the disabled coming-soon contract for Present Mode and Settings, the `data-active-surface="curriculum"` default, the four-key `WORKSPACE_SURFACES` registry, and the LYFELABZ re-render behavior from both Curriculum and Classes. The Sprint 6B Classroom Workspace assertion set is preserved.
- `app/index.html` - adds the `.shell-nav-brand` and `.shell-nav-brand.shell-nav-active` CSS rules so the brand item receives its distinct visual weight without disrupting the existing shell layout tokens. No layout token, no shell-body grid, and no responsive breakpoint is otherwise changed.
- `docs/platform/SPRINT_HISTORY.md` - appends the Sprint 6C entry.

The following file was renamed by removing the source and writing the successor at the new path:

- `app/src/shell/surfaces/home.ts` -> `app/src/shell/surfaces/curriculum.ts`. The old file no longer exists; `renderHomeSurface` no longer exists; the exported symbol is `renderCurriculumSurface`.

No other file was created, edited, renamed, or deleted. `platform/functions/**`, `platform/firebase/firestore.rules`, `platform/firebase/firestore.indexes.json`, `platform/firebase/storage.rules`, `platform/firebase/tests/**`, `app/src/session/**`, `app/src/router/router.ts`, `app/src/router/routes.ts`, `app/src/router/surfaces/**` (except the shared session helpers already in place), `app/src/classes/**`, `app/src/firebase.ts`, `app/src/index.ts`, and every instructional lesson file at the repository root are untouched.

## 3. Architecture review confirming no drift

The Sprint 6C implementation preserves every certified guarantee. It is a UX and copy sprint; no backend contract is touched.

- **Firestore authoritative.** No client read change. The Sprint 6B `where("teacherId", "==", uid)` query on the Classes surface is unchanged.
- **Server-mediated writes.** The navigation change issues no writes and invokes no callables.
- **Default-deny Rules.** `platform/firebase/firestore.rules` was not touched.
- **`status` as the sole lifecycle field.** No new lifecycle field, no shadow lifecycle field.
- **Audit events append-only via `writeAuditEvent`.** No audit vocabulary was added; the navigation change does not write audit events.
- **Immutable Session Object.** The Curriculum surface reads only `session.displayName` from the already-frozen `activeTeacher` Session; the Classes surface reads `session.uid` unchanged from Sprint 6B. The Session type union is unchanged.
- **Session Bootstrap unchanged.** No `session/*.ts` file was modified.
- **Custom claims unchanged.** Still `{ role, schoolId }`; `districtId` remains reserved.
- **Protected router unchanged.** No new dispatch branch, no new route.
- **No new backend behavior.** `platform/functions/**`, `platform/firebase/firestore.rules`, `platform/firebase/firestore.indexes.json`, `platform/firebase/storage.rules`, and `platform/firebase/tests/**` were not modified.
- **No instructional lesson file was modified.** Preservation mode remains intact.
- **Shell no-Firebase-import invariant preserved.** The static-source assertion in `shell.test.ts` continues to prove no `app/src/shell/**` module imports `firebase/firestore`, `firebase/functions`, `firebase/auth`, `onSnapshot`, `httpsCallable`, `localStorage`, `sessionStorage`, or `document.cookie`.
- **Disabled-nav contract preserved.** Present Mode and Settings render with the same posture Sprint 6A used for unavailable items: `disabled`, `aria-disabled="true"`, `tabindex="-1"`, `"Label - Coming soon"` copy, no dispatch on click.

The rename of Home to Curriculum is a copy-only change under §11 of the Phase 2 Architecture Planning Report. The surface's transitional status paragraph names it as transitional until Sprint 6D delivers the curriculum landing bridge, mitigating the architectural risk called out in that section.

## 4. Repository validation summary

Cloud Functions (`platform/functions`):

- typecheck: **clean**.
- lint: **clean**.
- build (`tsc -p tsconfig.build.json`): **clean**.
- unit tests: **295 pass across 22 suites** (unchanged from Sprint 6B baseline).

Firebase Rules (`platform/firebase`):

- rules tests (`firebase emulators:exec --only firestore "jest"`): **94 pass across 8 suites** (unchanged from Sprint 6B baseline).

App (`app`):

- typecheck: **clean**.
- lint: **clean**.
- build (esbuild): **clean**, `dist/bundle.js` produced.
- unit tests: **125 pass across 5 suites** (Sprint 6B baseline: 120 / 5; +5 tests, no suite added).

Cumulative test totals at close of Sprint 6C:

| Suite | Sprint 6B | Sprint 6C |
|---|---|---|
| App unit tests | 120 / 5 | **125 / 5** |
| Cloud Functions unit tests | 295 / 22 | **295 / 22** |
| Firestore Rules tests | 94 / 8 | **94 / 8** |
| **Total** | **509 / 35** | **514 / 35** |

## 5. Chris local verification instructions

Step 1: Navigate to the LyfeLabz repository.

```
cd ~/Documents/GitHub/lyfelabz
```

Expected output: no output; shell prompt is now inside `~/Documents/GitHub/lyfelabz`.

Step 2: Confirm you are on `main` with the Sprint 6C files present.

```
git status
```

Expected output: `On branch main` and either `nothing to commit, working tree clean` (if you have not touched the tree since the last sprint) or Sprint 6C files listed as modified, renamed, or untracked (specifically, `app/src/shell/surfaces/home.ts` deleted and `app/src/shell/surfaces/curriculum.ts` added, `app/src/shell/navigation.ts`, `app/src/shell/shell.ts`, `app/src/shell/surfaces/workspace.ts`, `app/src/shell/shell.test.ts`, `app/index.html`, `docs/platform/PRESENT_MODE_ARCHITECTURE.md`, `docs/platform/SPRINT_6C_SPECIFICATION.md`, `docs/platform/SPRINT_6C_COMPLETION_REPORT.md`, and `docs/platform/SPRINT_HISTORY.md`). Do not commit yet.

Step 3: Enter the app package.

```
cd app
```

Expected output: no output; shell prompt is now inside `app`.

Step 4: Typecheck the app bundle.

```
npm run typecheck
```

Expected output: `> tsc --noEmit` header followed by no errors and a zero exit code.

Step 5: Lint the app bundle.

```
npm run lint
```

Expected output: `> eslint --ext .ts src` header followed by no errors and a zero exit code.

Step 6: Run the app unit tests.

```
npm test
```

Expected output: Jest summary reporting `Test Suites: 5 passed, 5 total` and `Tests: 125 passed, 125 total`.

Step 7: Build the app bundle.

```
npm run build
```

Expected output: `dist/bundle.js` produced with a final `⚡ Done in …ms` line.

Step 8: Enter the functions package.

```
cd ../platform/functions
```

Expected output: no output; shell prompt is now inside `platform/functions`.

Step 9: Typecheck Cloud Functions.

```
npm run typecheck
```

Expected output: `> tsc --noEmit` header followed by no errors and a zero exit code.

Step 10: Lint Cloud Functions.

```
npm run lint
```

Expected output: `> eslint --ext .ts src` header followed by no errors and a zero exit code.

Step 11: Build Cloud Functions.

```
npm run build
```

Expected output: `> tsc -p tsconfig.build.json` header followed by no errors and a zero exit code.

Step 12: Run Cloud Function unit tests.

```
npm test
```

Expected output: Jest summary reporting `Test Suites: 22 passed, 22 total` and `Tests: 295 passed, 295 total`.

Step 13: Enter the Firebase config package.

```
cd ../firebase
```

Expected output: no output; shell prompt is now inside `platform/firebase`.

Step 14: Run the Firestore Rules tests against the emulator.

```
npm run test:rules
```

Expected output: `Test Suites: 8 passed, 8 total` and `Tests: 94 passed, 94 total`, followed by clean emulator shutdown lines.

Await Technical Lead review and Chris local verification. Do not commit until both are complete.
