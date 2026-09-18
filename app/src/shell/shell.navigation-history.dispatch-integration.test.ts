/**
 * @jest-environment jsdom
 *
 * Human-acceptance regression: Chris's production test found that after
 * Student Detail -> browser Back -> browser Forward, the same student's
 * Detail did not reopen. Root cause (see router.ts): `dispatch()` always
 * ran `history.replaceState(null, "", path)` immediately AFTER
 * `mountTeacherShell` had already written its own richer
 * `ShellHistoryState` via replaceState - discarding it back to `null` on
 * every session dispatch, including the ONE dispatch that always runs
 * once at session boot. That corrupted the very first history entry a
 * teacher's clicks build on top of. Top-level Classes/Curriculum/Settings
 * navigation never visibly broke because each push lands on top of that
 * entry and a couple of Back/Forward presses never reach it; Student
 * Detail is only ONE push above it, so Back popped straight onto the
 * corrupted `null`-state entry, which `parseShellHistoryState` correctly
 * (and safely) treats as unrecognized - so nothing restored, and Forward
 * then had no valid entry to return to.
 *
 * The suite that shipped alongside this feature never caught this because
 * it called `mountTeacherShell` directly, in isolation, and never
 * exercised `dispatch()` at all - so its own initial `replaceState` was
 * never subsequently overwritten. This file drives the ACTUAL `dispatch`
 * export the same way index.ts does at boot, then real `history.back()` /
 * `history.forward()` (not a hand-constructed synthetic `popstate` event),
 * to prove the full, real integration.
 */
import type { Session, SessionKind } from "../session/types";
import type { ClassSummary } from "../classes/types";
import { mountTeacherShell, type ShellDeps } from "./shell";
import { dispatch, type RouteTable } from "../router/router";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const flushLonger = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));
const freeze = <T>(v: T): T => Object.freeze(v) as T;

const teacherSession = (): Extract<Session, { kind: "activeTeacher" }> =>
  freeze({ kind: "activeTeacher", uid: "u1", schoolId: "school-abc", displayName: "Ada Lovelace" });

const CLASS_ID = "dispatch-integration-class-1";
const summary: ClassSummary = Object.freeze({
  id: CLASS_ID,
  title: "Dispatch Integration Science",
  status: "active" as const,
  grade: "6",
  block: "E",
  isLmsLinked: true,
});

// A minimal complete RouteTable so `dispatch` can be called exactly as
// index.ts calls it, without pulling in the full router/surfaces wiring.
// Only "activeTeacher" ever renders anything in these tests.
const makeRouteTable = (shellDeps: ShellDeps): RouteTable => {
  const noop = (): void => undefined;
  const kinds: readonly SessionKind[] = [
    "unauthenticated",
    "provisioned",
    "pendingVerification",
    "activeTeacher",
    "activeStudent",
    "activeAdministrator",
    "suspendedUser",
    "archivedUser",
    "error",
  ];
  const table = {} as Record<SessionKind, (session: Session, mount: HTMLElement) => void>;
  for (const kind of kinds) table[kind] = noop;
  table.activeTeacher = (session, mount) => {
    if (session.kind !== "activeTeacher") return;
    mountTeacherShell(session, mount, shellDeps);
  };
  return Object.freeze(table) as RouteTable;
};

beforeEach(() => {
  window.history.replaceState(null, "", "/app/teacher");
});

test("Student Detail survives the real dispatch() boot sequence: Back closes it, Forward reopens the same student", async () => {
  const mount = document.createElement("div");
  document.body.appendChild(mount);

  const loadRoster = async (input: { readonly classId: string }) => ({
    classId: input.classId,
    students: [{ studentId: "s-alpha", studentDisplayName: "Alpha Student" }],
  });

  const shellDeps: ShellDeps = {
    onSignOut: () => undefined,
    listClasses: async () => [summary],
    onLaunchPresentMode: () => undefined,
    loadRoster: () => loadRoster,
  };
  const table = makeRouteTable(shellDeps);

  // Exactly what index.ts's rerun() does at boot: mount the surface, then
  // let dispatch perform its own trailing replaceState.
  dispatch(teacherSession(), table, mount, window.history);

  await flush();
  await flush();
  mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${CLASS_ID}]`)!.click();
  await flush();
  mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
  await flush();
  mount
    .querySelector<HTMLButtonElement>('[data-testid=roster-student][data-student-id="s-alpha"]')!
    .click();

  expect(mount.querySelector("[data-testid=student-detail]")).not.toBeNull();
  expect(window.history.state).toEqual({
    kind: "shell-student-detail",
    surface: "classes",
    classId: CLASS_ID,
    studentId: "s-alpha",
  });

  window.history.back();
  await flushLonger();

  expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
  expect(mount.querySelector("[data-testid=roster-list]")).not.toBeNull();

  window.history.forward();
  await flushLonger();

  const heading = mount.querySelector("[data-testid=student-detail-name]");
  expect(heading?.textContent).toBe("Alpha Student");
});
