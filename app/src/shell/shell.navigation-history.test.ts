/**
 * @jest-environment jsdom
 *
 * Browser Back/Forward support. Covers the two history-producing seams
 * added to the teacher shell: top-level surface switches in shell.ts
 * (`navigateTo`) and the Students -> Student Detail nested transition in
 * classes.ts (`StudentDetailHistorySeam`). Deliberately does not assert
 * on internal implementation details beyond the documented
 * `history.state` shape (see navigationHistory.ts) - these tests exercise
 * the same public click/popstate surface a real browser session would.
 */
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import type { ListClasses } from "../classes/listClasses";
import { mountTeacherShell, type ShellDeps } from "./shell";

const emptyListClasses: ListClasses = () =>
  Promise.resolve(Object.freeze<ClassSummary[]>([]));

const makeShellDeps = (overrides: Partial<ShellDeps> = {}): ShellDeps => ({
  onSignOut: () => undefined,
  listClasses: emptyListClasses,
  onLaunchPresentMode: () => undefined,
  ...overrides,
});

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const teacherSession = (): Extract<Session, { kind: "activeTeacher" }> =>
  freeze({
    kind: "activeTeacher",
    uid: "u1",
    schoolId: "school-abc",
    displayName: "Ada Lovelace",
  });

const activeSurface = (mount: HTMLElement): string | null =>
  mount
    .querySelector("[data-testid=workspace-outlet]")
    ?.getAttribute("data-active-surface") ?? null;

const popstate = (state: unknown): void => {
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
};

beforeEach(() => {
  // Every jsdom test in this file shares one global `window`; reset the
  // history stack/state before each test so no prior test's navigation
  // leaks in. `shell.ts` never reads this on mount (see shell.ts's
  // documented reason), so this is purely test isolation.
  window.history.replaceState(null, "", "/app/teacher");
});

describe("Browser Back/Forward: top-level surface navigation", () => {
  test("meaningful internal navigation creates one appropriate history entry", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    expect(activeSurface(mount)).toBe("classes");

    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();

    expect(activeSurface(mount)).toBe("curriculum");
    expect(window.history.state).toEqual({
      kind: "shell-surface",
      surface: "curriculum",
    });
  });

  test("navigating to the already-active surface does not push a duplicate entry", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const pushSpy = jest.spyOn(window.history, "pushState");

    mount.querySelector<HTMLButtonElement>("[data-testid=nav-classes]")!.click();

    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  test("simulated Back (popstate) restores the previous surface without pushing again", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    expect(activeSurface(mount)).toBe("curriculum");

    const pushSpy = jest.spyOn(window.history, "pushState");
    popstate({ kind: "shell-surface", surface: "classes" });

    expect(activeSurface(mount)).toBe("classes");
    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  test("simulated Forward (popstate) restores the subsequent surface", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    popstate({ kind: "shell-surface", surface: "classes" });
    expect(activeSurface(mount)).toBe("classes");

    popstate({ kind: "shell-surface", surface: "curriculum" });

    expect(activeSurface(mount)).toBe("curriculum");
  });

  test("malformed/unknown popstate state fails safely: current UI is left unchanged", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    expect(activeSurface(mount)).toBe("curriculum");

    popstate({ kind: "not-a-real-state" });
    expect(activeSurface(mount)).toBe("curriculum");

    popstate("just a string");
    expect(activeSurface(mount)).toBe("curriculum");

    popstate(null);
    expect(activeSurface(mount)).toBe("curriculum");

    popstate({ kind: "shell-surface", surface: "not-a-surface" });
    expect(activeSurface(mount)).toBe("curriculum");
  });

  test("ephemeral in-surface interaction (Settings tab has no sub-navigation here; nav re-click on same key) does not push history", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-settings]")!.click();
    const pushSpy = jest.spyOn(window.history, "pushState");

    // Re-clicking the already-active nav item is the closest ephemeral,
    // non-navigating interaction exposed at this seam.
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-settings]")!.click();

    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });
});

describe("Browser Back/Forward: Students -> Student Detail", () => {
  const CLASS_ID = "history-class-1";
  const summary: ClassSummary = Object.freeze({
    id: CLASS_ID,
    title: "History Science",
    status: "active" as const,
    grade: "6",
    block: "E",
    isLmsLinked: true,
  });

  const openStudentDetail = async (
    mount: HTMLElement,
    extra: Partial<ShellDeps> = {},
  ): Promise<void> => {
    const loadRoster = async (input: { readonly classId: string }) => ({
      classId: input.classId,
      students: [
        { studentId: "s-alpha", studentDisplayName: "Alpha Student" },
        { studentId: "s-bravo", studentDisplayName: "Bravo Student" },
      ],
    });
    mountTeacherShell(
      teacherSession(),
      mount,
      makeShellDeps({
        listClasses: async () => [summary],
        loadRoster: () => loadRoster,
        ...extra,
      }),
    );
    await flush();
    await flush();
    mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${CLASS_ID}]`)!.click();
    await flush();
    mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
    await flush();
    mount
      .querySelector<HTMLButtonElement>('[data-testid=roster-student][data-student-id="s-alpha"]')!
      .click();
  };

  test("selecting a student creates a shell-student-detail history entry", async () => {
    const mount = mkMount();
    await openStudentDetail(mount);

    expect(mount.querySelector("[data-testid=student-detail]")).not.toBeNull();
    expect(window.history.state).toEqual({
      kind: "shell-student-detail",
      surface: "classes",
      classId: CLASS_ID,
      studentId: "s-alpha",
    });
  });

  test("Back to Students button replaces (not pushes) and closes Detail", async () => {
    const mount = mkMount();
    await openStudentDetail(mount);
    const pushSpy = jest.spyOn(window.history, "pushState");

    mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-back]")!.click();
    await flush();

    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
    expect(mount.querySelector("[data-testid=roster-list]")).not.toBeNull();
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });
    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  test("simulated Back (popstate) restores the Students list", async () => {
    const mount = mkMount();
    await openStudentDetail(mount);

    popstate({ kind: "shell-surface", surface: "classes" });
    await flush();

    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
    expect(mount.querySelector("[data-testid=roster-list]")).not.toBeNull();
  });

  test("simulated Forward (popstate) restores Student Detail through the existing rendering path", async () => {
    const mount = mkMount();
    await openStudentDetail(mount);
    popstate({ kind: "shell-surface", surface: "classes" });
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();

    popstate({
      kind: "shell-student-detail",
      surface: "classes",
      classId: CLASS_ID,
      studentId: "s-alpha",
    });

    const heading = mount.querySelector("[data-testid=student-detail-name]");
    expect(heading?.textContent).toBe("Alpha Student");
  });

  test("Forward for an unresolvable student (wrong class) fails closed onto the Classes surface", async () => {
    const mount = mkMount();
    await openStudentDetail(mount);
    popstate({ kind: "shell-surface", surface: "classes" });
    await flush();

    popstate({
      kind: "shell-student-detail",
      surface: "classes",
      classId: "some-other-class",
      studentId: "s-alpha",
    });
    await flush();

    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
    expect(mount.querySelector("[data-testid=roster-list]")).not.toBeNull();
  });

  test("navigating away to another top-level surface while Detail is open does not throw on a later stale popstate", async () => {
    const mount = mkMount();
    await openStudentDetail(mount);

    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    expect(activeSurface(mount)).toBe("curriculum");

    expect(() => {
      popstate({
        kind: "shell-student-detail",
        surface: "classes",
        classId: CLASS_ID,
        studentId: "s-alpha",
      });
    }).not.toThrow();
    // Fails closed onto Classes; the stale controller reference was
    // already cleared by navigateTo when Curriculum was mounted, so the
    // nested student cannot be (and is not) restored.
    expect(activeSurface(mount)).toBe("classes");
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
  });
});
