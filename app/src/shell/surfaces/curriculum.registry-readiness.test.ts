/**
 * @jest-environment jsdom
 *
 * Performance Operation 1: Curriculum's assignment-dependent card state
 * (Assigned badge, Results action, assigned-class count) reads the
 * background-hydrated registry. While it is pending the grid is busy with a
 * polite loading line; when it settles each card's control refreshes in
 * place, without remounting the surface, moving focus, or losing filters.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { AssignmentDetailMetadata } from "../../assignments/detail/types";
import type { LessonSummaryCallable } from "../../assignments/summary/types";
import { createAssignmentDetailRegistry } from "../../assignments/detail/registry";
import { createAssignmentRegistryHydration } from "../../assignments/detail/hydration";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
  type CurriculumAssignmentDetailSeam,
} from "./curriculum";
import { getSurfaceableLessons } from "../../curriculum/curriculumManifest";
import { mountTeacherShell, type ShellDeps } from "../shell";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (err: unknown) => void;
};
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "u-teacher",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const listOne: ListClasses = () =>
  Promise.resolve([
    Object.freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
  ] as ClassSummary[]);

const LESSON = getSurfaceableLessons()[0]!;

const published = (assignmentId: string, classId = "c1"): AssignmentDetailMetadata =>
  Object.freeze({
    assignmentId,
    title: "Check for Understanding",
    className: "6A",
    classId,
    status: "published" as const,
    lessonSlug: LESSON.slug,
  });

type Items = ReadonlyArray<AssignmentDetailMetadata>;

const makeEntryPointSeam = () => {
  const registry = createAssignmentDetailRegistry();
  const hydration = createAssignmentRegistryHydration(registry);
  const responses: Array<Deferred<Items>> = [];
  const list = jest.fn(() => {
    const d = deferred<Items>();
    responses.push(d);
    return d.promise;
  });
  hydration.start(
    { uid: teacher.uid, schoolId: teacher.schoolId, generation: 1, isCurrent: () => true },
    list,
  );
  const opened: string[] = [];
  const seam: CurriculumAssignmentDetailSeam = {
    register: (m) => {
      hydration.writer()(m);
    },
    open: (id) => {
      opened.push(id);
    },
    list: () => registry.list(),
    registryStatus: hydration.readiness,
  };
  return { seam, hydration, list, responses, opened };
};

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const q = (root: ParentNode, testid: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-testid=${testid}]`);

beforeEach(() => {
  _resetCurriculumSessionStateForTest();
  document.body.textContent = "";
});

describe("Curriculum assignment status while the registry hydrates", () => {
  test("pending: grid is busy with a loading line; Assign still works", () => {
    const h = makeEntryPointSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne, assignmentDetail: h.seam });
    const grid = q(mount, "curriculum-grid")!;
    expect(grid.getAttribute("aria-busy")).toBe("true");
    expect(grid.getAttribute("data-assignment-status")).toBe("pending");
    const line = q(mount, "curriculum-assignment-status")!;
    expect(line.hidden).toBe(false);
    expect(line.getAttribute("role")).toBe("status");
    expect(line.textContent).toBe("Loading assignment status…");
    const btn = q(mount, `lesson-assign-${LESSON.slug}`) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  test("ready: cards refresh in place (Assigned + class count) without remounting or moving focus", async () => {
    const h = makeEntryPointSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne, assignmentDetail: h.seam });
    const card = q(mount, `lesson-card-${LESSON.slug}`)!;
    const headline = q(mount, "surface-headline");
    expect(card.getAttribute("data-lesson-assigned")).toBe("false");
    const btn = q(mount, `lesson-assign-${LESSON.slug}`) as HTMLButtonElement;
    btn.focus();

    h.responses[0]!.resolve([published("a1", "c1"), published("a2", "c2")]);
    await flush();

    expect(q(mount, `lesson-card-${LESSON.slug}`)).toBe(card);
    expect(q(mount, "surface-headline")).toBe(headline);
    expect(card.getAttribute("data-lesson-assigned")).toBe("true");
    expect(card.getAttribute("data-assigned-class-count")).toBe("2");
    expect(document.activeElement).toBe(btn);
    const grid = q(mount, "curriculum-grid")!;
    expect(grid.getAttribute("aria-busy")).toBe("false");
    expect(q(mount, "curriculum-assignment-status")!.hidden).toBe(true);
  });

  test("ready with an empty list: cards stay unassigned and the loading line clears", async () => {
    const h = makeEntryPointSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne, assignmentDetail: h.seam });
    h.responses[0]!.resolve([]);
    await flush();
    expect(q(mount, `lesson-card-${LESSON.slug}`)!.getAttribute("data-lesson-assigned")).toBe("false");
    expect(q(mount, "curriculum-assignment-status")!.hidden).toBe(true);
    expect(q(mount, "curriculum-grid")!.getAttribute("data-assignment-status")).toBe("ready");
  });

  test("unavailable: says so with Try again; retry recovers the badges", async () => {
    const h = makeEntryPointSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne, assignmentDetail: h.seam });
    h.responses[0]!.reject(new Error("outage"));
    await flush();
    const line = q(mount, "curriculum-assignment-status")!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toContain("We could not load which lessons are assigned.");
    q(mount, "curriculum-assignment-retry")!.click();
    expect(h.list).toHaveBeenCalledTimes(2);
    expect(line.textContent).toBe("Loading assignment status…");
    h.responses[1]!.resolve([published("a1")]);
    await flush();
    expect(q(mount, `lesson-card-${LESSON.slug}`)!.getAttribute("data-lesson-assigned")).toBe("true");
    expect(line.hidden).toBe(true);
  });

  test("a ready registry at mount renders no loading line at all", async () => {
    const h = makeEntryPointSeam();
    h.responses[0]!.resolve([published("a1")]);
    await flush();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne, assignmentDetail: h.seam });
    expect(q(mount, "curriculum-assignment-status")).toBeNull();
    expect(q(mount, `lesson-card-${LESSON.slug}`)!.getAttribute("data-lesson-assigned")).toBe("true");
  });

  test("a detached Curriculum is not updated after navigation", async () => {
    const h = makeEntryPointSeam();
    const first = mkMount();
    renderCurriculumSurface(first, teacher, { listClasses: listOne, assignmentDetail: h.seam });
    const staleCard = q(first, `lesson-card-${LESSON.slug}`)!;
    first.remove();
    h.responses[0]!.resolve([published("a1")]);
    await flush();
    expect(staleCard.getAttribute("data-lesson-assigned")).toBe("false");
    expect(h.list).toHaveBeenCalledTimes(1);
  });
});

describe("current assignment resolution waits for the registry", () => {
  test("a class row in lesson Results opened while pending resolves its occurrence after hydration", async () => {
    const h = makeEntryPointSeam();
    const lessonSummary: LessonSummaryCallable = () =>
      Promise.resolve({
        lessonSlug: LESSON.slug,
        classesAssigned: 1,
        students: 1,
        studentsCompleted: 0,
        completionPercentage: 0,
        averageBestPercentage: null,
        assignmentsConsidered: 1,
        classes: [
          {
            classId: "c1",
            students: 1,
            studentsCompleted: 0,
            completionPercentage: 0,
            averageBestPercentage: null,
            assignmentsConsidered: 1,
          },
        ],
      } as never);
    // In-session publish so the card offers Results before hydration lands.
    h.seam.register(published("a1"));
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: h.seam,
      lessonSummary,
    });
    (q(mount, `lesson-assign-${LESSON.slug}`) as HTMLButtonElement).click();
    for (let i = 0; i < 6; i += 1) await flush();
    const view = q(mount, "lesson-class-result-view-c1") as HTMLButtonElement;
    expect(view).not.toBeNull();
    view.click();
    await flush();
    expect(h.opened).toEqual([]);
    h.responses[0]!.resolve([published("a1")]);
    await flush();
    expect(h.opened).toEqual(["a1"]);
  });
});

// ---------------------------------------------------------------------------
// Audit correction 3: a Results class-row action that waits for hydration is
// bound to its originating Results view; it never navigates after the
// teacher went elsewhere. Driven through the real shell so the active
// surface and browser history are observable.
// ---------------------------------------------------------------------------

const resultsSummary: LessonSummaryCallable = () =>
  Promise.resolve({
    lessonSlug: LESSON.slug,
    classesAssigned: 1,
    students: 1,
    studentsCompleted: 0,
    completionPercentage: 0,
    averageBestPercentage: null,
    assignmentsConsidered: 1,
    classes: [
      {
        classId: "c1",
        students: 1,
        studentsCompleted: 0,
        completionPercentage: 0,
        averageBestPercentage: null,
        assignmentsConsidered: 1,
      },
    ],
  } as never);

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
};

// Opens Curriculum -> lesson Results -> clicks the class row's Results while
// the registry is still pending. Returns the shell and the history length at
// the moment the waiting action began.
const startWaitingResultsAction = async () => {
  const h = makeEntryPointSeam();
  // In-session publish so the card offers Results before hydration lands.
  h.seam.register(published("a1"));
  window.history.replaceState(null, "", "/app/teacher");
  const mount = mkMount();
  mountTeacherShell(teacher, mount, {
    onSignOut: () => undefined,
    onLaunchPresentMode: () => undefined,
    listClasses: listOne,
    lessonSummary: resultsSummary,
    assignmentDetail: h.seam,
  } as unknown as ShellDeps);
  await settle();
  (q(mount, "nav-curriculum") as HTMLButtonElement).click();
  await settle();
  (q(mount, `lesson-assign-${LESSON.slug}`) as HTMLButtonElement).click();
  await settle();
  const view = q(mount, "lesson-class-result-view-c1") as HTMLButtonElement;
  expect(view).not.toBeNull();
  view.click();
  await flush();
  expect(h.opened).toEqual([]);
  return { h, mount, historyLength: window.history.length };
};

const activeSurface = (mount: HTMLElement): string | null =>
  q(mount, "workspace-outlet")?.getAttribute("data-active-surface") ?? null;

describe("stale Results navigation is canceled", () => {
  test("leaving for Classes before hydration lands: stays on Classes, no Detail, no history entry", async () => {
    const { h, mount, historyLength } = await startWaitingResultsAction();
    (q(mount, "nav-classes") as HTMLButtonElement).click();
    await settle();
    const lengthAfterNav = window.history.length;
    expect(lengthAfterNav).toBeGreaterThan(historyLength);
    h.responses[0]!.resolve([published("a1")]);
    await settle();
    expect(h.opened).toEqual([]);
    expect(activeSurface(mount)).toBe("classes");
    expect(window.history.length).toBe(lengthAfterNav);
  });

  test("leaving for Settings: stays on Settings", async () => {
    const { h, mount } = await startWaitingResultsAction();
    (q(mount, "nav-settings") as HTMLButtonElement).click();
    await settle();
    const lengthAfterNav = window.history.length;
    h.responses[0]!.resolve([published("a1")]);
    await settle();
    expect(h.opened).toEqual([]);
    expect(activeSurface(mount)).toBe("settings");
    expect(window.history.length).toBe(lengthAfterNav);
  });

  test("closing the Results view (Back) cancels it", async () => {
    const { h, mount } = await startWaitingResultsAction();
    (q(mount, "lesson-summary-back") as HTMLButtonElement).click();
    await settle();
    h.responses[0]!.resolve([published("a1")]);
    await settle();
    expect(h.opened).toEqual([]);
  });

  test("a valid wait still navigates when the originating Results view remains open", async () => {
    const { h, mount, historyLength } = await startWaitingResultsAction();
    h.responses[0]!.resolve([published("a1")]);
    await settle();
    expect(h.opened).toEqual(["a1"]);
    // Detail is a real drill-down from Results: exactly one entry.
    expect(window.history.length).toBe(historyLength + 1);
    expect(activeSurface(mount)).toBe("curriculum");
  });

  test("hydration failure shows an accurate message instead of navigating", async () => {
    const { h, mount } = await startWaitingResultsAction();
    h.responses[0]!.reject(new Error("outage"));
    await settle();
    expect(h.opened).toEqual([]);
    expect(mount.textContent).toContain("We could not load this class's assignments.");
  });
});

describe("detached Curriculum disposes its subscription", () => {
  test("removing the surface disposes the watch while hydration is still pending", async () => {
    const h = makeEntryPointSeam();
    let active = 0;
    const counting: CurriculumAssignmentDetailSeam = {
      ...h.seam,
      registryStatus: {
        ...h.hydration.readiness,
        subscribe: (listener) => {
          active += 1;
          const off = h.hydration.readiness.subscribe(listener);
          let done = false;
          return () => {
            if (done) return;
            done = true;
            active -= 1;
            off();
          };
        },
      },
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne, assignmentDetail: counting });
    expect(active).toBe(1);
    mount.remove();
    await flush();
    expect(active).toBe(0);
    expect(h.hydration.status()).toBe("pending");
  });
});
