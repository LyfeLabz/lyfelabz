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

// jsdom's `history.back()`/`forward()` resolve asynchronously; a bare
// `setTimeout(0)` is not reliably long enough for the resulting
// `popstate` to have fired by the time assertions run (this exact gap
// masked a real production bug in an earlier iteration of this suite -
// see the dispatch-integration regression test). Every test in the
// blocks below uses real `history.back()`/`forward()` with this longer
// wait, never a hand-constructed synthetic `popstate` event, so the full
// push/pop round trip - not just the handler's reaction to an assumed
// state shape - is what's actually exercised.
const realBack = async (): Promise<void> => {
  window.history.back();
  await new Promise((resolve) => setTimeout(resolve, 100));
};
const realForward = async (): Promise<void> => {
  window.history.forward();
  await new Promise((resolve) => setTimeout(resolve, 100));
};

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
  const OTHER_CLASS_ID = "history-class-2";
  const otherSummary: ClassSummary = Object.freeze({
    id: OTHER_CLASS_ID,
    title: "Other Science",
    status: "active" as const,
    grade: "6",
    block: "F",
    isLmsLinked: true,
  });

  const roster = [
    { studentId: "s-alpha", studentDisplayName: "Alpha Student" },
    { studentId: "s-bravo", studentDisplayName: "Bravo Student" },
    { studentId: "s-charlie", studentDisplayName: "Charlie Student" },
  ];

  const mountWithRoster = async (
    mount: HTMLElement,
    extra: Partial<ShellDeps> = {},
  ): Promise<void> => {
    const loadRoster = async (input: { readonly classId: string }) => ({
      classId: input.classId,
      students: roster,
    });
    mountTeacherShell(
      teacherSession(),
      mount,
      makeShellDeps({
        listClasses: async () => [summary, otherSummary],
        loadRoster: () => loadRoster,
        ...extra,
      }),
    );
    await flush();
    await flush();
  };

  const openClassRoster = async (mount: HTMLElement): Promise<void> => {
    mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${CLASS_ID}]`)!.click();
    await flush();
    mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
    await flush();
  };

  const openStudentDetail = async (
    mount: HTMLElement,
    extra: Partial<ShellDeps> = {},
  ): Promise<void> => {
    await mountWithRoster(mount, extra);
    await openClassRoster(mount);
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

  test("opening the Students tab pushed its own shell-classes-workspace entry beneath Detail", async () => {
    const mount = mkMount();
    await mountWithRoster(mount);
    await openClassRoster(mount);

    expect(window.history.state).toEqual({
      kind: "shell-classes-workspace",
      surface: "classes",
      classId: CLASS_ID,
      section: "roster",
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
    expect(window.history.state).toEqual({
      kind: "shell-classes-workspace",
      surface: "classes",
      classId: CLASS_ID,
      section: "roster",
    });
    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  test("real Back restores the Students list, real Forward reopens the same student", async () => {
    const mount = mkMount();
    await openStudentDetail(mount);

    await realBack();
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
    expect(mount.querySelector("[data-testid=roster-list]")).not.toBeNull();

    await realForward();
    const heading = mount.querySelector("[data-testid=student-detail-name]");
    expect(heading?.textContent).toBe("Alpha Student");
  });

  test("popstate restoration never pushes another entry (no loops)", async () => {
    const mount = mkMount();
    await openStudentDetail(mount);
    const pushSpy = jest.spyOn(window.history, "pushState");

    await realBack();
    await realForward();

    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });
});

describe("Browser Back/Forward: cross-surface chain (Classes -> Students -> Student A)", () => {
  const CLASS_ID = "chain-class-1";
  const summary: ClassSummary = Object.freeze({
    id: CLASS_ID,
    title: "Chain Science",
    status: "active" as const,
    grade: "7",
    block: "A",
    isLmsLinked: true,
  });
  const roster = [{ studentId: "s-a", studentDisplayName: "Student A" }];

  const buildChain = async (mount: HTMLElement): Promise<void> => {
    const loadRoster = async (input: { readonly classId: string }) => ({
      classId: input.classId,
      students: roster,
    });
    mountTeacherShell(
      teacherSession(),
      mount,
      makeShellDeps({ listClasses: async () => [summary], loadRoster: () => loadRoster }),
    );
    await flush();
    await flush();
    mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${CLASS_ID}]`)!.click();
    await flush();
    mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
    await flush();
    mount
      .querySelector<HTMLButtonElement>('[data-testid=roster-student][data-student-id="s-a"]')!
      .click();
  };

  // Per-section class history: opening a class now records its landing
  // Assignments section, so Back from Students returns to the class's
  // Assignments (not straight to the Classes list) and one more Back reaches
  // the list. Student Detail semantics are unchanged.
  test("Back three times walks Student A -> Students -> class Assignments -> Classes; Forward three times rebuilds it", async () => {
    const mount = mkMount();
    await buildChain(mount);
    expect(mount.querySelector("[data-testid=student-detail]")).not.toBeNull();

    await realBack(); // -> Students
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
    expect(mount.querySelector("[data-testid=roster-list]")).not.toBeNull();
    expect(window.history.state).toEqual({
      kind: "shell-classes-workspace",
      surface: "classes",
      classId: CLASS_ID,
      section: "roster",
    });

    await realBack(); // -> class Assignments
    expect(mount.querySelector("[data-testid=roster-list]")).toBeNull();
    expect(mount.querySelector('[data-testid=class-nav-assignments][aria-current="page"]')).not.toBeNull();
    expect(window.history.state).toEqual({
      kind: "shell-classes-workspace",
      surface: "classes",
      classId: CLASS_ID,
      section: "assignments",
    });

    await realBack(); // -> Classes (flat list)
    expect(mount.querySelector('[data-testid=class-nav-assignments][aria-current="page"]')).toBeNull();
    expect(mount.querySelector(`[data-testid=class-card-${CLASS_ID}]`)).not.toBeNull();
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });

    await realForward(); // -> class Assignments
    expect(mount.querySelector('[data-testid=class-nav-assignments][aria-current="page"]')).not.toBeNull();

    await realForward(); // -> Students
    expect(mount.querySelector("[data-testid=roster-list]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();

    await realForward(); // -> Student A
    const heading = mount.querySelector("[data-testid=student-detail-name]");
    expect(heading?.textContent).toBe("Student A");
  });
});

describe("Browser Back/Forward: Previous/Next Student traversal", () => {
  const CLASS_ID = "traverse-class-1";
  const summary: ClassSummary = Object.freeze({
    id: CLASS_ID,
    title: "Traverse Science",
    status: "active" as const,
    grade: "8",
    block: "B",
    isLmsLinked: true,
  });
  const roster = [
    { studentId: "s-a", studentDisplayName: "Student A" },
    { studentId: "s-b", studentDisplayName: "Student B" },
    { studentId: "s-c", studentDisplayName: "Student C" },
  ];

  const openStudentA = async (mount: HTMLElement): Promise<void> => {
    const loadRoster = async (input: { readonly classId: string }) => ({
      classId: input.classId,
      students: roster,
    });
    mountTeacherShell(
      teacherSession(),
      mount,
      makeShellDeps({ listClasses: async () => [summary], loadRoster: () => loadRoster }),
    );
    await flush();
    await flush();
    mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${CLASS_ID}]`)!.click();
    await flush();
    mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
    await flush();
    mount
      .querySelector<HTMLButtonElement>('[data-testid=roster-student][data-student-id="s-a"]')!
      .click();
  };

  const detailName = (mount: HTMLElement): string | null | undefined =>
    mount.querySelector("[data-testid=student-detail-name]")?.textContent;

  test("Next creates a new history entry per student; Next/Next then Back/Back/Forward/Forward walks A -> B -> C -> B -> A -> B -> C", async () => {
    const mount = mkMount();
    await openStudentA(mount);
    expect(detailName(mount)).toBe("Student A");

    mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();
    expect(detailName(mount)).toBe("Student B");
    expect(window.history.state).toEqual({
      kind: "shell-student-detail",
      surface: "classes",
      classId: CLASS_ID,
      studentId: "s-b",
    });

    mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();
    expect(detailName(mount)).toBe("Student C");

    await realBack();
    expect(detailName(mount)).toBe("Student B");

    await realBack();
    expect(detailName(mount)).toBe("Student A");

    await realForward();
    expect(detailName(mount)).toBe("Student B");

    await realForward();
    expect(detailName(mount)).toBe("Student C");
  });

  test("Previous also creates a new history entry", async () => {
    const mount = mkMount();
    await openStudentA(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();
    expect(detailName(mount)).toBe("Student B");

    mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-prev]")!.click();
    expect(detailName(mount)).toBe("Student A");
    expect(window.history.state).toEqual({
      kind: "shell-student-detail",
      surface: "classes",
      classId: CLASS_ID,
      studentId: "s-a",
    });

    await realBack();
    expect(detailName(mount)).toBe("Student B");
  });

  test("Previous/Next controls themselves still work with no history interaction (no pushState per click beyond the one expected entry)", async () => {
    const mount = mkMount();
    await openStudentA(mount);
    const pushSpy = jest.spyOn(window.history, "pushState");

    mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();

    expect(pushSpy).toHaveBeenCalledTimes(1);
    pushSpy.mockRestore();
  });
});

describe("Browser Back/Forward: fail-closed and safety", () => {
  const CLASS_ID = "history-class-1";
  const summary: ClassSummary = Object.freeze({
    id: CLASS_ID,
    title: "History Science",
    status: "active" as const,
    grade: "6",
    block: "E",
    isLmsLinked: true,
  });

  test("popstate to an unresolvable student (wrong class) fails closed onto the Classes list", async () => {
    const mount = mkMount();
    mountTeacherShell(
      teacherSession(),
      mount,
      makeShellDeps({ listClasses: async () => [summary] }),
    );
    await flush();
    await flush();

    expect(() => {
      popstate({
        kind: "shell-student-detail",
        surface: "classes",
        classId: "some-other-class",
        studentId: "s-alpha",
      });
    }).not.toThrow();

    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
  });

  test("navigating away to another top-level surface while Detail is open does not throw on a later stale popstate", async () => {
    const mount = mkMount();
    const loadRoster = async (input: { readonly classId: string }) => ({
      classId: input.classId,
      students: [{ studentId: "s-alpha", studentDisplayName: "Alpha Student" }],
    });
    mountTeacherShell(
      teacherSession(),
      mount,
      makeShellDeps({ listClasses: async () => [summary], loadRoster: () => loadRoster }),
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

describe("Browser Back/Forward: no student PII in URL or history state", () => {
  const CLASS_ID = "pii-class-1";
  const summary: ClassSummary = Object.freeze({
    id: CLASS_ID,
    title: "PII Science",
    status: "active" as const,
    grade: "6",
    block: "E",
    isLmsLinked: true,
  });

  test("history.state and the URL carry only opaque ids, never the student's display name", async () => {
    const mount = mkMount();
    const loadRoster = async (input: { readonly classId: string }) => ({
      classId: input.classId,
      students: [
        { studentId: "s-opaque-id-1", studentDisplayName: "Very Identifiable Real Name" },
      ],
    });
    mountTeacherShell(
      teacherSession(),
      mount,
      makeShellDeps({ listClasses: async () => [summary], loadRoster: () => loadRoster }),
    );
    await flush();
    await flush();
    mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${CLASS_ID}]`)!.click();
    await flush();
    mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        '[data-testid=roster-student][data-student-id="s-opaque-id-1"]',
      )!
      .click();

    const serialized = JSON.stringify(window.history.state);
    expect(serialized).not.toContain("Very Identifiable");
    expect(serialized).not.toContain("Real Name");
    expect(window.location.href).not.toContain("Very");
    expect(window.location.href).not.toContain("Identifiable");
  });
});
