# Sprint 6A - Teacher Workspace Foundation

**Status:** Implementation complete; awaiting Technical Lead review and local verification by Chris.
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, SPRINT_3_STEP_5_SPECIFICATION.md, PLATFORM_STATE_MACHINE.md.

---

## 1. Purpose

Sprint 6A introduces the client-side Teacher Workspace foundation: a typed `WorkspaceSurface` contract and a single workspace outlet region inside the Teacher Platform Shell. It reuses the Home surface delivered in Sprint 3 Step 5 as the sole active workspace surface and reserves the four remaining navigation keys for future sprints without changing their disabled posture.

Sprint 6A is a client-only foundation. It ships no new backend behavior.

## 2. Scope

Included:

1. `WorkspaceSurface` contract type in `app/src/shell/surfaces/workspace.ts`.
2. A `WORKSPACE_SURFACES` registry keyed by `NavigationKey` covering `home`, `classes`, `students`, `assignments`, `settings`.
3. `mountWorkspaceOutlet(mount, session, activeKey)`: mounts exactly one `<section id="app-main" data-testid="workspace-outlet">` region and renders the registered surface for `activeKey` into it.
4. Refactor of `mountTeacherShell` to render the workspace outlet instead of calling `renderHomeSurface` directly. The outlet remains labelled by `#surface-headline`.
5. Extraction of the exported type `NavigationKey` from `navigation.ts` so the contract and the navigation list share one canonical set of keys.
6. A minimal shared "coming soon" surface renderer at `app/src/shell/surfaces/shared/emptyState.ts` used by every registered non-home surface. Unreachable through the Sprint 6A shell (all non-home navigation items remain disabled) and exists only for contract completeness.
7. Tests for outlet mounting, home rendering through the outlet, active-key behavior, disabled-navigation no-op, focus behavior, and registry shape.
8. This specification, a completion report, and a `SPRINT_HISTORY.md` append.

Explicitly out of scope:

- Live classes, students, assignments, submissions review, settings, analytics, grading, feedback, student UI, administrator UI.
- Any Cloud Function, Firestore Rule, Firestore index, Storage Rule, custom claim, teacher preferences document, URL routing, deep linking, or navigation persistence.
- Any change to the Immutable Session Object, Session Bootstrap, or protected router state machine.
- Any instructional lesson file.

## 3. Architecture review

The Sprint 6A implementation was checked against every certified guarantee. No drift was found.

- Firestore remains authoritative. The workspace outlet performs zero reads and opens zero listeners.
- All writes remain server mediated. The workspace outlet issues no writes and invokes no callables.
- Firestore Rules remain default-deny. `firestore.rules` was not touched.
- `status` remains the sole lifecycle field. No lifecycle-adjacent state was introduced on any collection.
- Audit events remain append-only and pass through `writeAuditEvent`. No audit vocabulary was added.
- Immutable Session Object is unchanged. The outlet accepts an already-frozen `activeTeacher` Session and reads only `displayName`.
- Session Bootstrap is unchanged.
- Custom claims remain `{ role, schoolId }`. `districtId` remains reserved.
- Protected router state machine is unchanged. The outlet lives inside the shell that the router already dispatches to for `activeTeacher`; no new route branch was added.
- No new backend behavior.

## 4. Contract

```ts
export type WorkspaceSurface = {
  readonly key: NavigationKey;
  readonly render: (mount: HTMLElement, session: ActiveTeacher) => void;
};
```

Invariants:

- Every registered surface's `render` reads only fields present on the `activeTeacher` Session Object. It performs no Firestore reads, no callable invocations, and opens no listeners.
- `WORKSPACE_SURFACES` is total across `NavigationKey`. The outlet renderer never dispatches to an undefined key.
- Only `home` is navigable in Sprint 6A. The registered renderers for the other four keys emit a minimal "coming soon" surface and are unreachable through the shell.

## 5. Navigation posture

`NAVIGATION_ITEMS` retains its Sprint 3 shape. `home.available` remains `true` and is the only enabled item. Every other item remains disabled, `aria-disabled="true"`, `tabindex="-1"`, with a `"Label - Coming soon"` textContent. Their click handlers remain no-ops.

The shell does not observe a mutable active-key state today. The outlet is mounted once, with `activeKey = "home"`, on shell mount.

## 6. Test additions

`app/src/shell/shell.test.ts` gains six new assertions under `Workspace outlet (Sprint 6A)`:

1. Exactly one `[data-testid=workspace-outlet]` region is mounted and its `id` is `app-main`.
2. The outlet advertises `data-active-surface="home"`.
3. The Home surface headline renders inside the outlet, not as a shell sibling.
4. `WORKSPACE_SURFACES` registers exactly the five canonical navigation keys.
5. `mountWorkspaceOutlet` returns a labelled outlet for any registered key (contract totality).
6. Dispatching click events on every disabled navigation button leaves `data-active-surface` unchanged at `"home"`.
7. Focus lands on the workspace surface headline after shell mount.

The pre-existing Home surface, header, navigation, footer, and integration assertions remain unchanged and continue to pass.

## 7. Deferred to future sprints

- A mutable active-key state, its DOM re-mount semantics, and its focus contract.
- The first live non-home surface (Classes) and its data plumbing.
- URL, deep-link, and browser-history integration.
- Teacher preferences documents and any persistence of navigation state.
