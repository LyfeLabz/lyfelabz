# Sprint 6B - Classroom Workspace (Read-Only)

**Status:** Implementation complete; awaiting Technical Lead review and local verification by Chris.
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, SPRINT_6A_SPECIFICATION.md.

---

## 1. Purpose

Sprint 6B activates the first live non-home workspace surface: a read-only Classroom Workspace inside the Teacher Platform Shell. Verified teachers can navigate from Home to Classes and see the classrooms they own, rendered from the certified `classes/{classId}` backend using the read rule established by Sprint 4B (Classroom Foundation).

Sprint 6B is a client-only surface. It ships no new backend behavior.

## 2. Scope

Included:

1. Activation of the Classes item in the persistent teacher navigation. Home and Classes are enabled; Students, Assignments, and Settings remain disabled with their existing coming-soon posture.
2. A mutable active-surface state inside the shell that swaps the workspace outlet content when the teacher selects Home or Classes.
3. A `renderClassesSurface` workspace surface that fetches the authenticated teacher's classrooms through an injected fetcher and renders them as read-only cards. Empty, loading, and error states are all handled.
4. A single `ListClasses` data seam (`app/src/classes/listClasses.ts`) whose Firestore adapter (`createFirestoreListClasses`) is wired at the client entry point. The seam issues a scoped `where("teacherId", "==", uid)` query so the certified Rules admit it.
5. A `ClassSummary` client shape (`app/src/classes/types.ts`) that mirrors the read-facing subset of the canonical `ClassRecord` (`title`, `grade`, `status`). No other classroom field is consumed by the client.
6. New tests under `Classroom Workspace surface (Sprint 6B)` covering nav activation, outlet swap, fetcher-argument correctness, card rendering, empty state, loading state, error state, selection posture, and focus behavior.
7. Documentation: this specification, a completion report, and a `SPRINT_HISTORY.md` append.

Explicitly out of scope:

- Classroom creation, editing, archival, join-code regeneration, or any lifecycle transition on `classes/{classId}`. Server callables (`classesCreate`, `classesUpdateMetadata`, `classesArchive`) already exist from Sprint 4B and are not invoked by the client in Sprint 6B.
- Enrollment management, roster views, assignment authoring, submission review, grading, feedback, or analytics.
- A dedicated classroom detail view. Cards support a selected posture (`aria-pressed`) as a keyboard-accessible read-only marker; no navigation, callable, or write is triggered.
- Any change to Cloud Functions, Firestore Rules, Firestore indexes, Storage Rules, custom claims, teacher preferences, URL routing, deep linking, or navigation persistence.
- Any change to the Immutable Session Object, Session Bootstrap, or protected router state machine.
- Any instructional lesson file.

## 3. Architecture review

Sprint 6B was checked against every certified guarantee. No drift.

- **Firestore authoritative.** The client reads `classes/{classId}` through the same rule the Sprint 4B Classroom Foundation opened. On any disagreement between claims and record, the record wins because the read query is gated by `resource.data.teacherId == request.auth.uid`.
- **Writes remain server-mediated.** The Classroom Workspace issues no writes and invokes no callables.
- **Default-deny Rules.** `platform/firebase/firestore.rules` was not modified.
- **`status` is the sole lifecycle field.** No lifecycle-adjacent state was introduced. `ClassSummary.status` is a read-side mirror of the canonical `ClassRecord.status`.
- **Audit events remain append-only.** No new audit vocabulary. The workspace does not write audit events.
- **Immutable Session Object.** The Classes surface reads only `session.uid` from the already-frozen `activeTeacher` Session. The Session union is unchanged.
- **Session Bootstrap unchanged.** No `session/*.ts` file was modified.
- **Custom claims unchanged.** Still `{ role, schoolId }`. `districtId` remains reserved.
- **Protected router unchanged.** No new dispatch branch. The Classroom Workspace lives inside the shell that the router already dispatches to for `activeTeacher`.
- **No new backend behavior.** `platform/functions/**`, `platform/firebase/firestore.rules`, `platform/firebase/firestore.indexes.json`, and `platform/firebase/tests/**` were not modified.
- **No instructional lesson file was modified.**
- **Shell no-Firebase-import invariant preserved.** The static-text assertion in `shell.test.ts` continues to prove no `app/src/shell/**` module imports `firebase/firestore`, `firebase/functions`, `firebase/auth`, `onSnapshot`, `httpsCallable`, `localStorage`, `sessionStorage`, or `document.cookie`. Firestore access lives in `app/src/classes/listClasses.ts`, outside the shell tree, and is injected as a fetcher.

## 4. Client contract

```ts
// app/src/classes/types.ts
export type ClassStatus = "active" | "archived";
export type ClassSummary = {
  readonly id: string;
  readonly title: string;
  readonly grade: string;
  readonly status: ClassStatus;
};

// app/src/classes/listClasses.ts
export type ListClasses = (uid: string) => Promise<ReadonlyArray<ClassSummary>>;
export function createFirestoreListClasses(db: Firestore): ListClasses;
```

Invariants:

- `ListClasses` accepts a `uid` and issues the certified-admissible Firestore query `where("teacherId", "==", uid)` against the `classes` collection.
- The Firestore adapter reads only `title`, `grade`, and `status` from each document. Every other field on the canonical `ClassRecord` is ignored. Documents that fail a narrow shape check are silently filtered so a malformed record cannot crash the workspace.
- The returned array is frozen; each `ClassSummary` is frozen.

## 5. Data path

- Rules (unchanged, Sprint 4B):

  ```
  allow list: if isSignedIn()
    && resource.data.teacherId == request.auth.uid;
  ```

  The client query must include the matching `teacherId` filter for the rule to admit it, guaranteeing that no cross-teacher or cross-school enumeration is possible.

- Client:

  1. `index.ts` constructs `listClasses = createFirestoreListClasses(db)` and passes it into `createRouteTable` via `SurfaceDeps`.
  2. `makeActiveTeacherSurface` forwards it into `mountTeacherShell` via `ShellDeps`.
  3. `mountTeacherShell` forwards it into `mountWorkspaceOutlet` via `WorkspaceDeps`.
  4. On Classes activation, `renderClassesSurface` calls `deps.listClasses(session.uid)` and renders the result.

## 6. Classroom Workspace surface

- Headline: `<h2 id="surface-headline" data-testid="surface-headline">Classes</h2>` with `tabindex="-1"` and focus applied at mount.
- Status row: `<p data-testid="classes-status" role="status" aria-live="polite">` used for `Loading classes`, `N classroom(s)`, empty-state text, or the error headline.
- On resolve:
  - Empty (`length === 0`): status reads `You do not have any classrooms yet.`; an inline paragraph (`data-testid="classes-empty"`) previews the future creation flow without exposing any interactive control.
  - Non-empty: a `<ul data-testid="classes-list">` grid of read-only cards. Each card exposes a keyboard-accessible `<button>` with `data-testid="class-card-{id}"`, `data-class-id`, `aria-pressed`, a title (`class-title-{id}`), an optional grade line (`class-grade-{id}`), and a status pill (`class-status-{id}`).
- On reject: status reads `We could not load your classrooms.`; an inline paragraph (`data-testid="classes-error"`) explains the recovery path (reload).
- Card selection is visual only: clicking a card toggles `aria-pressed` and applies `shell-class-card-selected`. No navigation, callable, or write is triggered. Read-only per Sprint 6B scope.

## 7. Navigation posture

`NAVIGATION_ITEMS` becomes:

| Key | Available | Notes |
|---|---|---|
| home | true | Default active surface |
| classes | true | New in Sprint 6B |
| students | false | Coming soon |
| assignments | false | Coming soon |
| settings | false | Coming soon |

Enabled non-active items no longer carry `aria-current`. When the teacher clicks Classes, the outlet is replaced with the Classes surface, `aria-current="page"` moves onto the Classes button, and focus lands on the Classes headline. Clicking Home restores the Home surface.

Disabled items retain the Sprint 6A posture: `disabled`, `aria-disabled="true"`, `tabindex="-1"`, `"Label - Coming soon"` label, and a no-op click handler.

## 8. Test additions

`app/src/shell/shell.test.ts` gains a `Classroom Workspace surface (Sprint 6B)` block:

1. Clicking Classes flips `data-active-surface` from `home` to `classes` and calls `listClasses` exactly once with the teacher's `uid`.
2. Navigating Classes → Home does not double-mount the outlet.
3. Non-empty resolve renders one card per classroom with correct title, grade line, and status pill.
4. Empty resolve renders the empty-state paragraph and status message; the list is absent.
5. Before the fetcher resolves, the loading status is present.
6. Rejected fetcher renders the error paragraph; the list is absent.
7. Clicking a card toggles `aria-pressed="true"` on that card, resets others, and does not leave the Classes surface.
8. Focus lands on the Classes headline after activation.

The Sprint 6A `Navigation composition and disabled posture` block is updated to reflect that both Home and Classes are now enabled; the "disabled" assertions still apply to Students, Assignments, and Settings only.

## 9. Deferred to future sprints

- Classroom detail view, roster surface, and assignment surfaces.
- Client callable invocations for `classesCreate`, `classesUpdateMetadata`, `classesArchive`, and future join-code rotation.
- URL, deep-link, and browser-history integration for workspace surfaces.
- Teacher preferences documents and persistence of the last-selected classroom.
- Real-time updates (`onSnapshot`) on the classroom list. Sprint 6B uses one-shot `getDocs` per activation.
