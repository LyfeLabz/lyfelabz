# Sprint 6B - Completion Report

**Date:** 2026-07-09
**Status:** Implementation complete; awaiting Technical Lead review and local verification by Chris. No commit produced by Sprint 6B itself.
**Companion documents:** SPRINT_6B_SPECIFICATION.md, SPRINT_6A_COMPLETION_REPORT.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md.

---

## 1. Files created

- `app/src/classes/types.ts` - client `ClassSummary` shape and `ClassStatus` alias, mirroring the read-facing subset of the canonical `ClassRecord` without importing from `platform/functions`.
- `app/src/classes/listClasses.ts` - `ListClasses` seam type and `createFirestoreListClasses(db)` adapter that issues the certified-admissible `where("teacherId", "==", uid)` query.
- `app/src/shell/surfaces/classes.ts` - `renderClassesSurface`, the Classroom Workspace surface. Handles loading, resolved (empty and non-empty), and rejected states; renders read-only classroom cards with keyboard-accessible selection posture.
- `docs/platform/SPRINT_6B_SPECIFICATION.md`.
- `docs/platform/SPRINT_6B_COMPLETION_REPORT.md` (this document).

## 2. Files modified

- `app/src/index.ts` - constructs `listClasses = createFirestoreListClasses(db)` and threads it through `createRouteTable` as `SurfaceDeps.listClasses`.
- `app/src/router/routes.ts` - `createSignOutOnlyRouteTable` now supplies a rejecting `listClasses` stub so the router-only fixture continues to compile and never silently invokes the fetcher.
- `app/src/router/surfaces/index.ts` - `SurfaceDeps` gains a required `listClasses: ListClasses`. `makeActiveTeacherSurface` forwards it into `mountTeacherShell` via `ShellDeps`.
- `app/src/router/surfaces/surfaces.test.ts` - `makeDeps` seeds a jest fake `listClasses` and exposes it as a spy so existing suites keep the same call-site shape.
- `app/src/shell/shell.ts` - `ShellDeps` gains a required `listClasses`. The shell now holds a mutable active-surface key, wraps nav and outlet in `.shell-nav-mount` / `.shell-outlet-host` hosts, and re-mounts the outlet plus re-renders the nav when Classes or Home is activated. The workspace outlet is unchanged in every non-navigational respect (`#app-main`, `aria-labelledby="surface-headline"`, `data-testid="workspace-outlet"`, `data-active-surface`).
- `app/src/shell/navigation.ts` - `renderNavigation` accepts a `{ activeKey, onSelect }` input. Home and Classes are `available: true`; every other item retains the Sprint 6A disabled posture. `aria-current="page"` is applied only to the active enabled item.
- `app/src/shell/surfaces/workspace.ts` - `mountWorkspaceOutlet` accepts a `WorkspaceDeps` object and appends the outlet before invoking the surface renderer so focus behavior is deterministic under re-mount. The `WORKSPACE_SURFACES.classes` entry now delegates to `renderClassesSurface`; the other four entries are unchanged (`home` renders Home; `students`, `assignments`, `settings` still delegate to `renderComingSoonSurface`).
- `app/src/shell/shell.test.ts` - adds the `Classroom Workspace surface (Sprint 6B)` block (eight tests) and updates the Sprint 6A `Navigation composition and disabled posture` and `Workspace outlet (Sprint 6A)` blocks to reflect that Home and Classes are now the enabled items and that the not-yet-implemented outlet-completeness test uses `students` in place of `classes`.
- `docs/platform/SPRINT_HISTORY.md` - appends the Sprint 6B entry.

No other file was created, edited, renamed, or deleted. `platform/functions/**`, `platform/firebase/firestore.rules`, `platform/firebase/firestore.indexes.json`, `platform/firebase/tests/**`, and every instructional lesson file are untouched.

## 3. Architecture review confirming no drift

The Sprint 6B implementation preserves every certified guarantee:

- **Firestore authoritative.** The client reads `classes/{classId}` through the same rule Sprint 4B established. The query is scoped by `where("teacherId", "==", uid)`, matching the admissible list rule and preventing cross-teacher or cross-school enumeration.
- **Server-mediated writes.** The Classroom Workspace issues no writes and invokes no callables. The Sprint 4B classroom-lifecycle callables (`classesCreate`, `classesUpdateMetadata`, `classesArchive`) are not invoked by the client in Sprint 6B.
- **Default-deny Rules.** `platform/firebase/firestore.rules` was not touched.
- **`status` as the sole lifecycle field.** No new lifecycle field, no shadow lifecycle field. `ClassSummary.status` is a read-side mirror of `ClassRecord.status`.
- **Audit events append-only via `writeAuditEvent`.** No audit vocabulary was added; the workspace does not write audit events.
- **Immutable Session Object.** The Classes surface reads only `session.uid` from the already-frozen `activeTeacher` Session. The Session type union is unchanged.
- **Session Bootstrap unchanged.** No `session/*.ts` file was modified.
- **Custom claims unchanged.** Still `{ role, schoolId }`; `districtId` remains reserved.
- **Protected router unchanged.** No new dispatch branch. The classes surface lives inside the shell that the router already dispatches to for `activeTeacher`.
- **No new backend behavior.** `platform/functions/**`, `platform/firebase/firestore.rules`, `platform/firebase/firestore.indexes.json`, and `platform/firebase/tests/**` were not modified.
- **No instructional lesson file was modified.**
- **Shell no-Firebase-import invariant preserved.** The static-text assertion in `shell.test.ts` continues to prove no `app/src/shell/**` module imports `firebase/firestore`, `firebase/functions`, `firebase/auth`, `onSnapshot`, `httpsCallable`, `localStorage`, `sessionStorage`, or `document.cookie`. The Firestore-touching module lives at `app/src/classes/listClasses.ts`, outside the shell tree, and is injected as a fetcher.
- **Navigation posture preserved for deferred items.** Students, Assignments, and Settings remain `disabled`, `aria-disabled="true"`, `tabindex="-1"`, with a `"Label - Coming soon"` label and a no-op click handler.

## 4. Repository validation summary

Cloud Functions (`platform/functions`):

- typecheck: **clean**.
- lint: **clean**.
- build (`tsc -p tsconfig.build.json`): **clean**.
- unit tests: **295 pass across 22 suites** (unchanged from Sprint 6A baseline).

Firebase Rules (`platform/firebase`):

- rules tests (`firebase emulators:exec --only firestore "jest"`): **94 pass across 8 suites** (unchanged from Sprint 6A baseline).

App (`app`):

- typecheck: **clean**.
- lint: **clean**.
- build (esbuild): **clean**, `dist/bundle.js` produced.
- unit tests: **120 pass across 5 suites** (Sprint 6A baseline: 111 / 5; +9 tests, no suite added). One pre-existing Sprint 6A navigation assertion was retitled to reflect the new Home-plus-Classes enabled posture; a compensating assertion was added for the `activeKey="classes"` case, keeping net additions positive.

Cumulative test totals at close of Sprint 6B:

| Suite | Sprint 6A | Sprint 6B |
|---|---|---|
| App unit tests | 111 / 5 | **120 / 5** |
| Cloud Functions unit tests | 295 / 22 | **295 / 22** |
| Firestore Rules tests | 94 / 8 | **94 / 8** |
| **Total** | **500 / 35** | **509 / 35** |

## 5. Chris local verification instructions

Step 1: Navigate to the LyfeLabz repository.

```
cd ~/Documents/GitHub/lyfelabz
```

Expected output: no output; shell prompt is now inside `~/Documents/GitHub/lyfelabz`.

Step 2: Confirm you are on `main` with the Sprint 6B files present.

```
git status
```

Expected output: `On branch main` and either `nothing to commit, working tree clean` (if you have not touched the tree since the last sprint) or Sprint 6B files listed as modified or untracked. Do not commit yet.

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

Expected output: Jest summary reporting `Test Suites: 5 passed, 5 total` and `Tests: 120 passed, 120 total`.

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
