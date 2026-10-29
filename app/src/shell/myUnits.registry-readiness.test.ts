/**
 * @jest-environment jsdom
 *
 * Performance Operation 1 (audit correction 8): My Units reads the
 * background-hydrated assignment registry for Assign vs Results. While the
 * registry is pending or unavailable, a lesson that looks unassigned is
 * "unknown" (never definitively unassigned), the surface says why, and a
 * failure offers a working Try again. Controls refresh in place when the
 * registry is ready. My Units is release-gated closed in production; the
 * shared Jest setup substitutes availability for these business/UI tests.
 */
import type { TeacherUnitsSurfaceSeam as CapabilitySeam } from "../teacherUnits/unitsController";
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import type { AssignmentDetailMetadata } from "../assignments/detail/types";
import type { LessonResults, LessonResultsCallable } from "../assignments/summary/lessonResults";
import type { TeacherUnit, TeacherUnitsCallables } from "../teacherUnits/types";
import type { CurriculumAssignmentDetailSeam } from "./surfaces/curriculum";
import { createTeacherUnitsSurfaceSeam } from "../teacherUnits/unitsController";
import { createTeacherUnitCreateAttemptStore } from "../teacherUnits/createAttemptStore";
import { getPlaceableResources } from "../teacherUnits/placeableResources";
import { getSurfaceableLessons } from "../curriculum/curriculumManifest";
import { createAssignmentDetailRegistry } from "../assignments/detail/registry";
import { createAssignmentRegistryHydration } from "../assignments/detail/hydration";
import { mountTeacherShell, type ShellDeps } from "./shell";
import { _resetCurriculumSessionStateForTest } from "./surfaces/curriculum";
import { _resetMyUnitsSurfaceStateForTest } from "./surfaces/myUnits";

const enabledCapability = {
  getSnapshot: () => ({ status: "enabled" as const }),
  subscribe: () => () => undefined,
  refresh: async () => undefined,
  enter: async () => undefined,
  revalidate: async () => undefined,
  invalidate: () => undefined,
  dispose: () => undefined,
} as unknown as NonNullable<CapabilitySeam["capability"]>;

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
  uid: "teacherA",
  schoolId: "schoolA",
  displayName: "Ada",
});

const surfaceable = new Set(getSurfaceableLessons().map((l) => l.slug));
const lessons7 = getPlaceableResources().filter(
  (r) => r.type === "lesson" && r.grade === "7" && surfaceable.has(r.id),
);
const L1 = lessons7[0]!;
const L2 = lessons7[1]!;

const classes: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: "c1", title: "7A Science", grade: "7", status: "active" }),
] as ClassSummary[]);

const unit: TeacherUnit = {
  unitId: "Mod00000000000000001",
  grade: "7",
  title: "Earth Systems",
  description: "",
  color: null,
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: 1,
  updatedAtMillis: 1,
  resourceIds: [L1.id, L2.id],
  sortOrder: 0,
  revision: 1,
};

// L1 is assigned to c1 in the server's registry; L2 never was.
const l1Assigned: AssignmentDetailMetadata = Object.freeze({
  assignmentId: "a-l1-c1",
  title: L1.title,
  status: "published" as const,
  className: "7A Science",
  classId: "c1",
  lessonSlug: L1.id,
});

const memoryStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as unknown as Storage;
};

const lessonRow = (slug: string): LessonResults => ({
  lessonSlug: slug,
  classesAssigned: 0,
  students: 0,
  studentsCompleted: 0,
  completionPercentage: 0,
  averageBestPercentage: null,
  assignmentsConsidered: 0,
  classes: [],
});

async function openMyUnits(capability: NonNullable<CapabilitySeam["capability"]> = enabledCapability) {
  const registry = createAssignmentDetailRegistry();
  const hydration = createAssignmentRegistryHydration(registry);
  const responses: Array<Deferred<ReadonlyArray<AssignmentDetailMetadata>>> = [];
  const list = jest.fn(() => {
    const d = deferred<ReadonlyArray<AssignmentDetailMetadata>>();
    responses.push(d);
    return d.promise;
  });
  hydration.start({ uid: teacher.uid, schoolId: teacher.schoolId, generation: 1, isCurrent: () => true }, list);
  // Counts live subscriptions so detach-time disposal is observable.
  let active = 0;
  const readiness = {
    ...hydration.readiness,
    subscribe: (listener: () => void) => {
      active += 1;
      const off = hydration.readiness.subscribe(listener);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        active -= 1;
        off();
      };
    },
  };
  const assignmentDetail: CurriculumAssignmentDetailSeam = {
    register: (m) => {
      hydration.writer()(m);
    },
    open: () => undefined,
    list: () => registry.list(),
    registryStatus: readiness,
  };
  const store = new Map([[unit.unitId, unit]]);
  const storage = memoryStorage();
  const seam = createTeacherUnitsSurfaceSeam({
    capability,
    callables: {
      list: jest.fn(async () => ({ units: Array.from(store.values()) })),
      get: jest.fn(async (req: { unitId: string }) => ({ unit: store.get(req.unitId)! })),
    } as unknown as TeacherUnitsCallables,
    readFirebaseUid: () => teacher.uid,
    readActiveTeacher: () => ({ uid: teacher.uid, schoolId: teacher.schoolId }),
    createStore: (scope) => createTeacherUnitCreateAttemptStore(scope, () => storage),
  });
  const single = jest.fn(async (input: { lessonSlug: string }) => lessonRow(input.lessonSlug));
  const lessonSummary: LessonResultsCallable = Object.assign(single, {
    batch: async (input: { lessonSlugs: ReadonlyArray<string> }) => input.lessonSlugs.map(lessonRow),
  });
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  mountTeacherShell(teacher, mount, {
    onSignOut: () => undefined,
    onLaunchPresentMode: () => undefined,
    listClasses: async () => classes,
    teacherUnits: seam,
    lessonSummary,
    assignmentDetail,
  } as unknown as ShellDeps);
  await settle();
  (mount.querySelector('[data-testid="nav-units"]') as HTMLButtonElement).click();
  await settle();
  (mount.querySelector('[data-testid="units-grade-7"]') as HTMLButtonElement).click();
  await settle();
  return { mount, hydration, list, responses, activeSubscriptions: () => active };
}

const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const control = (root: ParentNode, slug: string) =>
  q(root, `units-resource-assign-${unit.unitId}-${slug}`) as HTMLButtonElement;

beforeEach(() => {
  document.body.textContent = "";
  window.history.replaceState(null, "", "/app/teacher");
  localStorage.clear();
  sessionStorage.clear();
  _resetCurriculumSessionStateForTest();
  _resetMyUnitsSurfaceStateForTest();
});

describe("My Units assignment state while the registry hydrates", () => {
  test("loading: unassigned-looking lessons are unknown and busy, with a loading line; Assign stays usable", async () => {
    const { mount } = await openMyUnits();
    const line = q(mount, "units-assignment-status")!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe("Loading assignment status…");
    const l1 = control(mount, L1.id);
    expect(l1.getAttribute("data-assignment-state")).toBe("loading");
    expect(l1.getAttribute("aria-busy")).toBe("true");
    expect(l1.getAttribute("aria-describedby")).toBe("units-assignment-status");
    expect(l1.disabled).toBe(false);
  });

  test("ready: controls refresh in place (assigned shows Results, genuinely unassigned shows Assign as known)", async () => {
    const { mount, responses } = await openMyUnits();
    const l1 = control(mount, L1.id);
    const l2 = control(mount, L2.id);
    responses[0]!.resolve([l1Assigned]);
    await settle();
    expect(control(mount, L1.id)).toBe(l1);
    expect(l1.textContent).toBe("Results");
    expect(l1.getAttribute("data-assignment-state")).toBe("known");
    expect(l1.hasAttribute("aria-busy")).toBe(false);
    expect(l2.textContent).toBe("Assign");
    expect(l2.getAttribute("data-assignment-state")).toBe("known");
    expect(l2.hasAttribute("aria-describedby")).toBe(false);
    expect(q(mount, "units-assignment-status")!.hidden).toBe(true);
  });

  test("unavailable: never presented as definitively unassigned; Try again recovers in place", async () => {
    const { mount, responses, list } = await openMyUnits();
    responses[0]!.reject(new Error("outage"));
    await settle();
    const line = q(mount, "units-assignment-status")!;
    expect(line.textContent).toContain("We could not load which lessons are assigned.");
    const l1 = control(mount, L1.id);
    expect(l1.getAttribute("data-assignment-state")).toBe("unavailable");
    expect(l1.getAttribute("aria-describedby")).toBe("units-assignment-status");
    expect(l1.hasAttribute("aria-busy")).toBe(false);

    (q(mount, "units-assignment-retry") as HTMLButtonElement).click();
    expect(list).toHaveBeenCalledTimes(2);
    expect(line.textContent).toBe("Loading assignment status…");
    responses[1]!.resolve([l1Assigned]);
    await settle();
    expect(l1.textContent).toBe("Results");
    expect(l1.getAttribute("data-assignment-state")).toBe("known");
    expect(line.hidden).toBe(true);
  });

  test("leaving My Units disposes its registry subscription without waiting for hydration", async () => {
    const { mount, responses, activeSubscriptions } = await openMyUnits();
    const l1 = control(mount, L1.id);
    expect(activeSubscriptions()).toBeGreaterThan(0);
    (mount.querySelector('[data-testid="nav-settings"]') as HTMLButtonElement).click();
    await settle();
    // Settings reads no assignment state: every subscription is gone while
    // hydration is STILL pending (no later event was needed to clean up).
    expect(activeSubscriptions()).toBe(0);
    responses[0]!.resolve([l1Assigned]);
    await settle();
    // The detached control was never updated.
    expect(l1.getAttribute("data-assignment-state")).toBe("loading");
  });

  // Staging correction: with Teacher Units unavailable the panel disables its
  // actions, but the registry's Try again is not one of them.
  test("Teacher Units unavailable: registry Try again stays enabled and recovers; unit actions stay disabled", async () => {
    const unavailableCapability = {
      ...enabledCapability,
      getSnapshot: () => ({ status: "unavailable" as const }),
    } as unknown as NonNullable<CapabilitySeam["capability"]>;
    const { mount, responses, list, hydration } = await openMyUnits(unavailableCapability);
    expect(q(mount, "units-panel")!.getAttribute("data-capability-status")).toBe("unavailable");
    responses[0]!.reject(new Error("outage"));
    await settle();
    const line = q(mount, "units-assignment-status")!;
    expect(line.textContent).toContain("We could not load which lessons are assigned.");
    const retry = q(mount, "units-assignment-retry") as HTMLButtonElement;
    expect(retry.hidden).toBe(false);
    expect(retry.disabled).toBe(false);
    expect((q(mount, "units-create-open") as HTMLButtonElement).disabled).toBe(true);

    retry.click();
    expect(list).toHaveBeenCalledTimes(2);
    expect(line.textContent).toBe("Loading assignment status…");
    responses[1]!.resolve([l1Assigned]);
    await settle();
    // No units list without the capability, so the status line is the
    // whole assignment-status display: it clears once hydration succeeds.
    expect(hydration.readiness.status()).toBe("ready");
    expect(line.hidden).toBe(true);
    expect((q(mount, "units-create-open") as HTMLButtonElement).disabled).toBe(true);
  });

  test("Teacher Units enabled: create stays enabled and registry Try again still works", async () => {
    const { mount, responses, list } = await openMyUnits();
    responses[0]!.reject(new Error("outage"));
    await settle();
    expect((q(mount, "units-create-open") as HTMLButtonElement).disabled).toBe(false);
    const retry = q(mount, "units-assignment-retry") as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    retry.click();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
