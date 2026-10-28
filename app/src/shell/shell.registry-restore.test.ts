/**
 * @jest-environment jsdom
 *
 * Performance Operation 1 (Sol re-audit, deferred history restoration):
 * a Back/Forward restore of a class's Assignment Detail that arrives while
 * the assignment registry is still hydrating, exercised through the REAL
 * shell popstate path (not a directly invoked Classes controller). From any
 * Classes view (landing list, another class, a Students section, the right
 * Assignments section) or another surface, the restore lands on the target
 * class's Assignments section and opens Detail once hydration completes,
 * adding no history entry. Newer navigation, a new bootstrap context, and a
 * genuinely missing assignment all leave Detail closed.
 */
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import type { AssignmentDetailMetadata } from "../assignments/detail/types";
import type { CurriculumAssignmentDetailSeam } from "./surfaces/curriculum";
import { createAssignmentDetailRegistry } from "../assignments/detail/registry";
import { createAssignmentRegistryHydration } from "../assignments/detail/hydration";
import { mountTeacherShell, type ShellDeps } from "./shell";
import { _resetCurriculumSessionStateForTest } from "./surfaces/curriculum";
import { _resetActiveAssignmentsSessionStateForTest } from "./surfaces/shared/activeAssignments";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-1",
  schoolId: "school-1",
  displayName: "Ms. Teacher",
});

const classes: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: "c1", title: "6A Life Science", status: "active" as const, grade: "6", block: "A" }),
  Object.freeze({ id: "c2", title: "7B Systems", status: "active" as const, grade: "7", block: "B" }),
]);

const a1: AssignmentDetailMetadata = Object.freeze({
  assignmentId: "a1",
  title: "Earth's Layers - Check for Understanding",
  status: "published" as const,
  className: "6A Life Science",
  classId: "c1",
  lessonSlug: "earths-layers",
  publishedAt: 3000,
});

type Items = ReadonlyArray<AssignmentDetailMetadata>;

const mountShell = async () => {
  const registry = createAssignmentDetailRegistry();
  const hydration = createAssignmentRegistryHydration(registry);
  const responses: Array<Deferred<Items>> = [];
  const list = jest.fn(() => {
    const d = deferred<Items>();
    responses.push(d);
    return d.promise;
  });
  let runToken = 0;
  const bootstrap = (): void => {
    const token = ++runToken;
    hydration.start(
      { uid: teacher.uid, schoolId: teacher.schoolId, generation: token, isCurrent: () => token === runToken },
      list,
    );
  };
  bootstrap();
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
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  mountTeacherShell(teacher, mount, {
    onSignOut: () => undefined,
    onLaunchPresentMode: () => undefined,
    listClasses: async () => classes,
    assignmentDetail: seam,
  } as unknown as ShellDeps);
  await settle();
  return { mount, hydration, responses, opened, bootstrap };
};

const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (root: ParentNode, id: string) => (q(root, id) as HTMLButtonElement).click();

const popToAssignmentDetail = (classId: string, assignmentId: string): void => {
  window.dispatchEvent(
    new PopStateEvent("popstate", {
      state: { kind: "shell-assignment-detail", surface: "classes", classId, assignmentId },
    }),
  );
};

const workspace = (mount: HTMLElement) => ({
  classId: q(mount, "class-workspace")?.getAttribute("data-class-id") ?? null,
  tab: q(mount, "class-workspace")?.getAttribute("data-class-tab") ?? null,
});

const activeSurface = (mount: HTMLElement): string | null =>
  q(mount, "workspace-outlet")?.getAttribute("data-active-surface") ?? null;

beforeEach(() => {
  document.body.textContent = "";
  window.history.replaceState(null, "", "/app/teacher");
  sessionStorage.clear();
  localStorage.clear();
  _resetCurriculumSessionStateForTest();
  _resetActiveAssignmentsSessionStateForTest();
});

// Each origin is a different Classes view the teacher is on when Back/Forward
// restores the Assignment Detail entry.
const origins: ReadonlyArray<{
  readonly name: string;
  readonly arrange: (mount: HTMLElement) => Promise<void>;
}> = [
  { name: "the Classes landing list", arrange: async () => undefined },
  {
    name: "another class",
    arrange: async (mount) => {
      click(mount, "class-card-c2");
      await settle();
    },
  },
  {
    name: "a Students section",
    arrange: async (mount) => {
      click(mount, "class-card-c1");
      await settle();
      click(mount, "class-nav-roster");
      await settle();
    },
  },
  {
    name: "the correct Assignments section",
    arrange: async (mount) => {
      click(mount, "class-card-c1");
      await settle();
    },
  },
  {
    name: "another surface (Curriculum)",
    arrange: async (mount) => {
      click(mount, "nav-curriculum");
      await settle();
    },
  },
];

describe("deferred Assignment Detail restore through the shell popstate path", () => {
  for (const origin of origins) {
    test(`from ${origin.name}: lands on the target class's Assignments, then opens Detail after hydration`, async () => {
      const h = await mountShell();
      await origin.arrange(h.mount);
      const historyLength = window.history.length;

      popToAssignmentDetail("c1", "a1");
      await settle();
      // While pending: the screen matches the destination's class context.
      expect(activeSurface(h.mount)).toBe("classes");
      expect(workspace(h.mount)).toEqual({ classId: "c1", tab: "assignments" });
      expect(q(h.mount, "class-assignments-loading")).not.toBeNull();
      expect(h.opened).toEqual([]);

      h.responses[0]!.resolve([a1]);
      await settle();
      expect(h.opened).toEqual(["a1"]);
      // A restore re-lands on an existing entry: nothing was pushed.
      expect(window.history.length).toBe(historyLength);
    });
  }

  test("canceled by newer navigation inside Classes (Back to Classes)", async () => {
    const h = await mountShell();
    popToAssignmentDetail("c1", "a1");
    await settle();
    click(h.mount, "class-workspace-back");
    await settle();
    h.responses[0]!.resolve([a1]);
    await settle();
    expect(h.opened).toEqual([]);
    expect(q(h.mount, "class-workspace")).toBeNull();
  });

  test("canceled by navigating to another surface", async () => {
    const h = await mountShell();
    popToAssignmentDetail("c1", "a1");
    await settle();
    click(h.mount, "nav-settings");
    await settle();
    h.responses[0]!.resolve([a1]);
    await settle();
    expect(h.opened).toEqual([]);
    expect(activeSurface(h.mount)).toBe("settings");
  });

  test("canceled by a newer Back/Forward restore", async () => {
    const h = await mountShell();
    popToAssignmentDetail("c1", "a1");
    await settle();
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: { kind: "shell-surface", surface: "classes" } }),
    );
    await settle();
    h.responses[0]!.resolve([a1]);
    await settle();
    expect(h.opened).toEqual([]);
  });

  test("context invalidation: a new bootstrap generation never completes the old intent", async () => {
    const h = await mountShell();
    popToAssignmentDetail("c1", "a1");
    await settle();
    h.bootstrap();
    h.responses[1]!.resolve([a1]);
    h.responses[0]!.resolve([a1]);
    await settle();
    expect(h.opened).toEqual([]);
  });

  test("a genuinely missing assignment stays on the class's Assignments section", async () => {
    const h = await mountShell();
    popToAssignmentDetail("c1", "a-missing");
    await settle();
    h.responses[0]!.resolve([a1]);
    await settle();
    expect(h.opened).toEqual([]);
    expect(workspace(h.mount)).toEqual({ classId: "c1", tab: "assignments" });
    expect(q(h.mount, "active-assignment-card-a1")).not.toBeNull();
  });

  test("an assignment of a different class is never opened under the requested class", async () => {
    const h = await mountShell();
    popToAssignmentDetail("c2", "a1");
    await settle();
    h.responses[0]!.resolve([a1]);
    await settle();
    expect(h.opened).toEqual([]);
  });

  test("hydration already ready: restores synchronously, unchanged", async () => {
    const h = await mountShell();
    h.responses[0]!.resolve([a1]);
    await settle();
    click(h.mount, "class-card-c1");
    await settle();
    const historyLength = window.history.length;
    popToAssignmentDetail("c1", "a1");
    await settle();
    expect(h.opened).toEqual(["a1"]);
    expect(window.history.length).toBe(historyLength);
  });
});
