/**
 * @jest-environment jsdom
 *
 * My Units modernization: the compact unit header (Unit Results pill,
 * chevron, management menu), lesson rows that mirror Curriculum (Assign vs
 * Results from the shared Curriculum assignment state, then Preview), the
 * quiet row menu with Remove from Unit, Unit Results (per-lesson figures from
 * the lesson-summary batch, class filter, explicit states), and the
 * teacher-selected unit color in My Units and on Curriculum unit pills.
 *
 * Drives the REAL shell, My Units, Curriculum, and units controller with
 * in-memory callables (the test-only Teacher Units availability fixture is
 * open; see scripts/teacher-units-test-setup.js).
 */
import type { TeacherUnitsSurfaceSeam as CapabilitySeam } from "../teacherUnits/unitsController";
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import type { AssignmentDetailMetadata } from "../assignments/detail/types";
import type { LessonResults, LessonResultsCallable } from "../assignments/summary/lessonResults";
import type { TeacherUnit, TeacherUnitsCallables } from "../teacherUnits/types";
import { createTeacherUnitsSurfaceSeam } from "../teacherUnits/unitsController";
import { createTeacherUnitCreateAttemptStore } from "../teacherUnits/createAttemptStore";
import { getPlaceableResources } from "../teacherUnits/placeableResources";
import { getSurfaceableLessons } from "../curriculum/curriculumManifest";
import { mountTeacherShell, type ShellDeps } from "./shell";
import { _resetCurriculumSessionStateForTest } from "./surfaces/curriculum";
import { _resetMyUnitsSurfaceStateForTest } from "./surfaces/myUnits";
import { _resetUnitExpansionSessionForTest } from "../teacherPreferences/unitExpansionStorage";

// Explicit test substitution; compiler production availability stays closed.
const enabledCapability = {
  getSnapshot: () => ({ status: "enabled" as const }),
  subscribe: () => () => undefined,
  refresh: async () => undefined,
  enter: async () => undefined,
  revalidate: async () => undefined,
  invalidate: () => undefined,
  dispose: () => undefined,
} as unknown as NonNullable<CapabilitySeam["capability"]>;

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
const placeable = getPlaceableResources();
const lessons7 = placeable.filter((r) => r.type === "lesson" && r.grade === "7" && surfaceable.has(r.id));
const L1 = lessons7[0]!;
const L2 = lessons7[1]!;
const L3 = lessons7[2]!;
const OTHER = placeable.find((r) => r.type !== "lesson" && r.openHref !== null)!;

const classes: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: "c1", title: "7A Science", grade: "7", status: "active" }),
  Object.freeze({ id: "c2", title: "7B Science", grade: "7", status: "active" }),
] as ClassSummary[]);

let n = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Mod${String(++n).padStart(17, "0")}`,
  grade: "7",
  title: "Earth Systems",
  description: "",
  color: null,
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: n,
  updatedAtMillis: n,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});

function memoryStorage(): Storage {
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
}

// L1 is assigned (published) to c1 with ZERO submissions; L3 is assigned to
// both classes; L2 is never assigned.
const registry: ReadonlyArray<AssignmentDetailMetadata> = Object.freeze([
  Object.freeze({ assignmentId: "a-l1-c1", title: L1.title, status: "published" as const, className: "7A Science", classId: "c1", lessonSlug: L1.id }),
  Object.freeze({ assignmentId: "a-l3-c1", title: L3.title, status: "published" as const, className: "7A Science", classId: "c1", lessonSlug: L3.id }),
  Object.freeze({ assignmentId: "a-l3-c2", title: L3.title, status: "closed" as const, className: "7B Science", classId: "c2", lessonSlug: L3.id }),
]);

const lessonRow = (slug: string): LessonResults => {
  if (slug === L1.id) {
    return {
      lessonSlug: slug, classesAssigned: 1, students: 20, studentsCompleted: 0, completionPercentage: 0,
      averageBestPercentage: null, assignmentsConsidered: 1,
      classes: [{ classId: "c1", students: 20, studentsCompleted: 0, completionPercentage: 0, averageBestPercentage: null, assignmentsConsidered: 1 }],
    };
  }
  if (slug === L3.id) {
    return {
      lessonSlug: slug, classesAssigned: 2, students: 40, studentsCompleted: 25, completionPercentage: 63,
      averageBestPercentage: 84, assignmentsConsidered: 2,
      classes: [
        { classId: "c1", students: 20, studentsCompleted: 20, completionPercentage: 100, averageBestPercentage: 88, assignmentsConsidered: 1 },
        { classId: "c2", students: 20, studentsCompleted: 5, completionPercentage: 25, averageBestPercentage: 68, assignmentsConsidered: 1 },
      ],
    };
  }
  return {
    lessonSlug: slug, classesAssigned: 0, students: 0, studentsCompleted: 0, completionPercentage: 0,
    averageBestPercentage: null, assignmentsConsidered: 0, classes: [],
  };
};

function setup(units: TeacherUnit[], opts: { batchFails?: boolean } = {}) {
  const store = new Map(units.map((u) => [u.unitId, u]));
  const callables = {
    create: jest.fn(async (req: { title: string; grade: TeacherUnit["grade"]; color?: TeacherUnit["color"] }) => {
      const created = unit({ title: req.title, grade: req.grade, color: req.color ?? null });
      store.set(created.unitId, created);
      return { unit: created, replayed: false };
    }),
    list: jest.fn(async () => ({ units: Array.from(store.values()).filter((u) => u.status === "active") })),
    get: jest.fn(async (req: { unitId: string }) => ({ unit: store.get(req.unitId)! })),
    update: jest.fn(async (req: { unitId: string; expectedRevision: number; title?: string; description?: string; color?: TeacherUnit["color"] }) => {
      const cur = store.get(req.unitId)!;
      const next = {
        ...cur,
        ...(req.title !== undefined ? { title: req.title } : {}),
        ...(req.color !== undefined ? { color: req.color } : {}),
        revision: cur.revision + 1,
      };
      store.set(req.unitId, next);
      return { unit: next, noop: false };
    }),
    archive: jest.fn(async (req: { unitId: string }) => {
      const cur = store.get(req.unitId)!;
      const next = { ...cur, status: "archived" as const, archivedAtMillis: 5, revision: cur.revision + 1 };
      store.set(req.unitId, next);
      return { unit: next, noop: false };
    }),
    restore: jest.fn(),
    setResources: jest.fn(async (req: { unitId: string; resourceIds: string[] }) => {
      const cur = store.get(req.unitId)!;
      const next = { ...cur, resourceIds: [...req.resourceIds], revision: cur.revision + 1 };
      store.set(req.unitId, next);
      return { unit: next, noop: false };
    }),
    reorder: jest.fn(),
  };
  const storage = memoryStorage();
  const seam = createTeacherUnitsSurfaceSeam({
      capability: enabledCapability,
    callables: callables as unknown as TeacherUnitsCallables,
    readFirebaseUid: () => "teacherA",
    readActiveTeacher: () => ({ uid: "teacherA", schoolId: "schoolA" }),
    createStore: (scope) => createTeacherUnitCreateAttemptStore(scope, () => storage),
  });
  const batchCalls: string[][] = [];
  const single = jest.fn(async (input: { lessonSlug: string }) => lessonRow(input.lessonSlug));
  const lessonSummary: LessonResultsCallable = Object.assign(single, {
    batch: async (input: { lessonSlugs: ReadonlyArray<string> }) => {
      batchCalls.push([...input.lessonSlugs]);
      if (opts.batchFails === true) throw new Error("unavailable");
      return input.lessonSlugs.map(lessonRow);
    },
  });
  const opened: string[] = [];
  const div = document.createElement("div");
  document.body.appendChild(div);
  mountTeacherShell(teacher, div, {
    onSignOut: () => undefined,
    onLaunchPresentMode: () => undefined,
    listClasses: async () => classes,
    teacherUnits: seam,
    lessonSummary,
    assignmentDetail: {
      register: () => undefined,
      list: () => registry,
      open: (id: string) => {
        opened.push(id);
      },
    },
  } as unknown as ShellDeps);
  return { mount: div, callables, batchCalls, single, opened, store };
}

const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (root: ParentNode, id: string) => (q(root, id) as HTMLButtonElement).click();
const key = (el: HTMLElement, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

async function openMyUnits(units: TeacherUnit[], opts?: { batchFails?: boolean }) {
  const h = setup(units, opts);
  await settle();
  click(h.mount, "nav-units");
  await settle();
  // The fixtures are Grade 7 units.
  click(h.mount, "units-grade-7");
  await settle();
  return h;
}

beforeEach(() => {
  document.body.textContent = "";
  window.history.replaceState(null, "", "/app/teacher");
  localStorage.clear();
  sessionStorage.clear();
  _resetCurriculumSessionStateForTest();
  _resetMyUnitsSurfaceStateForTest();
});

describe("unit header row", () => {
  test("one compact row: title left; Unit Results, chevron, and menu right, as separate controls; no counts", async () => {
    const u = unit({ resourceIds: [L1.id, L2.id, OTHER.id] });
    const { mount } = await openMyUnits([u]);
    const row = q(mount, `units-toggle-${u.unitId}`)!.closest(".shell-units-card-title-row") as HTMLElement;
    const controls = Array.from(row.querySelectorAll<HTMLElement>(".shell-units-card-controls > *"));
    expect(controls.map((c) => c.getAttribute("data-testid") ?? c.className)).toEqual([
      `units-results-${u.unitId}`,
      `units-toggle-${u.unitId}`,
      "shell-units-menu shell-units-menu--unit",
    ]);
    expect(row.querySelector("h3")?.textContent).toBe("Earth Systems");
    expect(row.textContent).not.toMatch(/\d+ resources?/);
    expect(q(mount, `units-results-${u.unitId}`)?.getAttribute("aria-label")).toBe("Unit Results for Earth Systems");
    // No bottom management row.
    expect(q(mount, `units-details-${u.unitId}`)?.querySelector(".shell-units-actions")).toBeNull();
  });

  test("the management menu opens, moves with arrow keys, closes on Escape (focus back), and on an outside click", async () => {
    const u = unit();
    const { mount } = await openMyUnits([u]);
    const trigger = q(mount, `units-menu-${u.unitId}`) as HTMLButtonElement;
    const list = q(mount, `units-menu-${u.unitId}-list`)!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-label")).toBe("Manage Earth Systems");
    expect(list.hidden).toBe(true);
    trigger.focus();
    key(trigger, "ArrowDown");
    expect(list.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(Array.from(list.querySelectorAll("[role=menuitem]")).map((b) => b.textContent)).toEqual([
      "Edit Unit",
      "Add Resources",
      "Archive Unit",
    ]);
    expect(document.activeElement).toBe(q(mount, `units-edit-${u.unitId}`));
    key(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(q(mount, `units-resources-add-${u.unitId}`));
    key(document.activeElement as HTMLElement, "End");
    expect(document.activeElement).toBe(q(mount, `units-archive-${u.unitId}`));
    key(document.activeElement as HTMLElement, "Escape");
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    expect(list.hidden).toBe(false);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(list.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("Edit Unit opens the existing inline editor; Add Resources opens the picker (expanding the unit)", async () => {
    const u = unit();
    const { mount } = await openMyUnits([u]);
    click(mount, `units-menu-${u.unitId}`);
    click(mount, `units-edit-${u.unitId}`);
    expect(q(mount, `units-edit-title-${u.unitId}`)).not.toBeNull();
    click(mount, `units-edit-cancel-${u.unitId}`);
    expect(q(mount, `units-details-${u.unitId}`)?.hidden).toBe(false);
    click(mount, `units-toggle-${u.unitId}`);
    expect(q(mount, `units-details-${u.unitId}`)?.hidden).toBe(true);
    click(mount, `units-menu-${u.unitId}`);
    click(mount, `units-resources-add-${u.unitId}`);
    expect(q(mount, `units-details-${u.unitId}`)?.hidden).toBe(false);
    expect(q(mount, `units-picker-${u.unitId}`)).not.toBeNull();
  });

  test("Archive Unit keeps archive semantics: the archive callable, never a delete; the unit leaves the active list", async () => {
    const u = unit({ resourceIds: [L1.id] });
    const { mount, callables } = await openMyUnits([u]);
    click(mount, `units-menu-${u.unitId}`);
    click(mount, `units-archive-${u.unitId}`);
    await settle();
    expect(callables.archive).toHaveBeenCalledWith(expect.objectContaining({ unitId: u.unitId, expectedRevision: 1 }));
    expect(callables.setResources).not.toHaveBeenCalled();
    expect(q(mount, `units-card-${u.unitId}`)).toBeNull();
  });
});

describe("lesson rows mirror Curriculum", () => {
  test("assigned (even with zero submissions) shows Results; unassigned shows Assign; both then Preview; other resources keep Open", async () => {
    const u = unit({ resourceIds: [L1.id, L2.id, OTHER.id] });
    const { mount } = await openMyUnits([u]);
    const results = q(mount, `units-resource-assign-${u.unitId}-${L1.id}`) as HTMLButtonElement;
    expect(results.textContent).toBe("Results");
    expect(results.classList.contains("shell-lesson-results-action")).toBe(true);
    expect(results.getAttribute("aria-label")).toBe(`Results for ${L1.title}`);
    const assign = q(mount, `units-resource-assign-${u.unitId}-${L2.id}`) as HTMLButtonElement;
    expect(assign.textContent).toBe("Assign");
    expect(assign.classList.contains("shell-lesson-assign")).toBe(true);
    expect(assign.classList.contains("shell-lesson-results-action")).toBe(false);
    for (const slug of [L1.id, L2.id]) {
      const actions = q(mount, `units-resource-assign-${u.unitId}-${slug}`)!.parentElement!;
      const labels = Array.from(actions.children).map((c) => c.textContent?.trim());
      expect(labels[0]).toMatch(/^(Assign|Results)$/);
      expect(labels[1]).toBe("Preview");
      expect(actions.lastElementChild?.classList.contains("shell-units-menu--row")).toBe(true);
    }
    expect(q(mount, `units-resource-assign-${u.unitId}-${OTHER.id}`)).toBeNull();
    expect(q(mount, `units-resource-open-${u.unitId}-${OTHER.id}`)).not.toBeNull();
    // No prominent Remove pill.
    expect(mount.querySelector(".shell-units-resource .shell-btn")).toBeNull();
  });

  test("Results opens the lesson's existing Results page (with Class Results); Back returns to the same unit", async () => {
    const u = unit({ resourceIds: [L1.id] });
    const { mount } = await openMyUnits([u]);
    click(mount, `units-resource-assign-${u.unitId}-${L1.id}`);
    await settle();
    expect(q(mount, "workspace-outlet")?.getAttribute("data-active-surface")).toBe("curriculum");
    expect(q(mount, "lesson-summary-title")?.textContent).toBe(L1.title);
    expect(q(mount, "lesson-class-result-c1")).not.toBeNull();
    expect(window.history.state).toEqual({
      kind: "shell-lesson-summary",
      surface: "curriculum",
      lessonSlug: L1.id,
      from: { unitId: u.unitId, grade: "7" },
    });
    const back = q(mount, "lesson-summary-back") as HTMLButtonElement;
    expect(back.textContent).toBe("Back to My Units");
    back.click();
    await settle();
    expect(q(mount, "workspace-outlet")?.getAttribute("data-active-surface")).toBe("units");
    expect(q(mount, `units-details-${u.unitId}`)?.hidden).toBe(false);
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "units" });
  });

  test("Assign opens the existing Curriculum assignment dialog over My Units", async () => {
    const u = unit({ resourceIds: [L2.id] });
    const { mount } = await openMyUnits([u]);
    click(mount, `units-resource-assign-${u.unitId}-${L2.id}`);
    await settle();
    expect(document.querySelector("[data-testid=assign-dialog]")).not.toBeNull();
    expect(q(mount, "workspace-outlet")?.getAttribute("data-active-surface")).toBe("units");
    document.querySelectorAll("[data-testid=assign-overlay]").forEach((el) => el.remove());
  });

  test("Remove from Unit sits in a row menu and removes only this unit's membership", async () => {
    const u = unit({ resourceIds: [L1.id, L2.id] });
    const { mount, callables } = await openMyUnits([u]);
    const trigger = q(mount, `units-resource-menu-${u.unitId}-${L1.id}`) as HTMLButtonElement;
    expect(trigger.getAttribute("aria-label")).toBe(`More actions for ${L1.title}`);
    trigger.click();
    const remove = q(mount, `units-resource-remove-${u.unitId}-${L1.id}`) as HTMLButtonElement;
    expect(remove.getAttribute("role")).toBe("menuitem");
    expect(remove.textContent).toBe("Remove from Unit");
    remove.click();
    await settle();
    expect(callables.setResources).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: u.unitId, resourceIds: [L2.id] }),
    );
    expect(callables.archive).not.toHaveBeenCalled();
    expect(q(mount, `units-resource-assign-${u.unitId}-${L2.id}`)).not.toBeNull();
  });

  test("keyboard reorder still works with the new row controls", async () => {
    const u = unit({ resourceIds: [L1.id, L2.id] });
    const { mount, callables } = await openMyUnits([u]);
    const handle = q(mount, `units-resource-handle-${u.unitId}-${L1.id}`) as HTMLButtonElement;
    handle.focus();
    for (const k of [" ", "ArrowDown", " "]) key(handle, k);
    await settle();
    expect(callables.setResources).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: u.unitId, resourceIds: [L2.id, L1.id] }),
    );
  });
});

describe("Unit Results", () => {
  const openResults = async (u: TeacherUnit, opts?: { batchFails?: boolean }) => {
    const h = await openMyUnits([u], opts);
    click(h.mount, `units-results-${u.unitId}`);
    await settle();
    return h;
  };

  test("one batch read for the unit's lessons in unit order; per-lesson states; no combined unit score", async () => {
    const u = unit({ resourceIds: [L3.id, OTHER.id, L1.id, L2.id] });
    const { mount, batchCalls } = await openResults(u);
    expect(batchCalls).toEqual([[L3.id, L1.id, L2.id]]);
    expect(q(mount, "units-panel")?.hidden).toBe(true);
    expect(q(mount, "unit-results-title")?.textContent).toBe("Earth Systems");
    const order = Array.from(q(mount, "unit-results-list")!.children).map((li) => li.getAttribute("data-testid"));
    expect(order).toEqual([`unit-results-lesson-${L3.id}`, `unit-results-lesson-${L1.id}`, `unit-results-lesson-${L2.id}`]);
    // The Completed stat carries the progress, so no subtitle repeats it.
    expect(q(mount, `unit-results-status-${L3.id}`)?.textContent).toBe("");
    expect(q(mount, `unit-results-status-${L3.id}`)?.hidden).toBe(true);
    expect(q(mount, `unit-results-completion-${L3.id}`)?.textContent).toBe("25 / 40 (63%)");
    expect(q(mount, `unit-results-average-${L3.id}`)?.textContent).toBe("84%");
    expect(q(mount, `unit-results-status-${L1.id}`)?.textContent).toBe("No submissions yet");
    expect(q(mount, `unit-results-average-${L1.id}`)?.textContent).toBe("No completed scores yet");
    expect(q(mount, `unit-results-status-${L2.id}`)?.textContent).toBe("Not assigned");
    expect(q(mount, `unit-results-open-${L2.id}`)).toBeNull();
    expect(q(mount, "unit-results-other")?.textContent).toBe("1 other resource in this unit has no lesson results.");
    expect(q(mount, "unit-results-note")).toBeNull();
    expect(mount.textContent).not.toContain("not combined into a unit score");
  });

  test("the class filter lists only the classes holding assignments and shows each lesson's row for that class", async () => {
    const u = unit({ resourceIds: [L3.id, L1.id, L2.id] });
    const { mount } = await openResults(u);
    const select = q(mount, "unit-results-class") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["All classes", "7A Science", "7B Science"]);
    select.value = "c2";
    select.dispatchEvent(new Event("change"));
    expect(q(mount, `unit-results-status-${L3.id}`)?.textContent).toBe("");
    expect(q(mount, `unit-results-completion-${L3.id}`)?.textContent).toBe("5 / 20 (25%)");
    expect(q(mount, `unit-results-average-${L3.id}`)?.textContent).toBe("68%");
    expect(q(mount, `unit-results-status-${L1.id}`)?.textContent).toBe("Not assigned to 7B Science");
    select.value = "c1";
    select.dispatchEvent(new Event("change"));
    expect(q(mount, `unit-results-status-${L3.id}`)?.textContent).toBe("");
    expect(mount.textContent).not.toContain("All students completed");
    expect(q(mount, `unit-results-status-${L1.id}`)?.textContent).toBe("No submissions yet");
  });

  test("a failed load shows the error and retries; Back restores the unit list and focuses the pill", async () => {
    const u = unit({ resourceIds: [L1.id] });
    const { mount, batchCalls } = await openResults(u, { batchFails: true });
    expect(q(mount, "unit-results-error")).not.toBeNull();
    click(mount, "unit-results-retry");
    await settle();
    expect(batchCalls).toHaveLength(2);
    click(mount, "unit-results-back");
    expect(q(mount, "unit-results-surface")).toBeNull();
    expect(q(mount, "units-panel")?.hidden).toBe(false);
    expect(document.activeElement).toBe(q(mount, `units-results-${u.unitId}`));
  });

  test("a unit with no lessons says so without a request", async () => {
    const u = unit({ resourceIds: [OTHER.id] });
    const { mount, batchCalls } = await openResults(u);
    expect(batchCalls).toEqual([]);
    expect(q(mount, "unit-results-empty")).not.toBeNull();
  });

  test("a lesson's Results opened from Unit Results returns to that Unit Results", async () => {
    const u = unit({ resourceIds: [L3.id] });
    const { mount } = await openResults(u);
    click(mount, `unit-results-open-${L3.id}`);
    await settle();
    expect(q(mount, "lesson-summary-title")?.textContent).toBe(L3.title);
    click(mount, "lesson-summary-back");
    await settle();
    expect(q(mount, "workspace-outlet")?.getAttribute("data-active-surface")).toBe("units");
    expect(q(mount, "unit-results-surface")?.getAttribute("data-unit-id")).toBe(u.unitId);
  });

  test("reflects current membership: a lesson that belongs to two units appears in each", async () => {
    const a = unit({ title: "Unit A", resourceIds: [L3.id, L1.id] });
    const b = unit({ title: "Unit B", resourceIds: [L3.id] });
    const { mount, batchCalls } = await openMyUnits([a, b]);
    click(mount, `units-results-${b.unitId}`);
    await settle();
    expect(batchCalls).toEqual([[L3.id]]);
  });
});

describe("unit colors", () => {
  test("a unit without a color is neutral; a colored unit carries its color", async () => {
    const plain = unit({ title: "Plain" });
    const teal = unit({ title: "Tealish", color: "teal" });
    const { mount } = await openMyUnits([plain, teal]);
    expect(q(mount, `units-card-${plain.unitId}`)?.getAttribute("data-unit-color")).toBe("none");
    expect(q(mount, `units-card-${teal.unitId}`)?.getAttribute("data-unit-color")).toBe("teal");
  });

  test("Create Unit offers the curated palette (no free-form picker) and sends the chosen color", async () => {
    const { mount, callables } = await openMyUnits([]);
    click(mount, "units-create-open");
    const options = Array.from(mount.querySelectorAll<HTMLInputElement>("[data-testid=units-create-color] input[type=radio]"));
    expect(options.map((o) => o.value)).toEqual(["none", "teal", "blue", "purple", "green", "gold", "coral", "slate"]);
    expect(mount.querySelector("input[type=color]")).toBeNull();
    expect((q(mount, "units-create-color-none") as HTMLInputElement).checked).toBe(true);
    (q(mount, "units-create-title") as HTMLInputElement).value = "Weather";
    (q(mount, "units-create-color-coral") as HTMLInputElement).click();
    (q(mount, "units-create-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(callables.create).toHaveBeenCalledWith(expect.objectContaining({ title: "Weather", color: "coral" }));
  });

  test("Edit Unit changes only the color; it shows after the confirmed save and persists across navigation", async () => {
    const u = unit({ resourceIds: [L1.id] });
    const { mount, callables } = await openMyUnits([u]);
    click(mount, `units-menu-${u.unitId}`);
    click(mount, `units-edit-${u.unitId}`);
    expect((q(mount, `units-edit-color-${u.unitId}-none`) as HTMLInputElement).checked).toBe(true);
    (q(mount, `units-edit-color-${u.unitId}-gold`) as HTMLInputElement).click();
    (q(mount, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await settle();
    expect(callables.update).toHaveBeenCalledWith({ unitId: u.unitId, expectedRevision: 1, color: "gold" });
    expect(q(mount, `units-card-${u.unitId}`)?.getAttribute("data-unit-color")).toBe("gold");
    click(mount, "nav-curriculum");
    await settle();
    click(mount, "nav-units");
    await settle();
    expect(q(mount, `units-card-${u.unitId}`)?.getAttribute("data-unit-color")).toBe("gold");
  });

  test("a failed color save is never shown as confirmed", async () => {
    const u = unit();
    const { mount, callables } = await openMyUnits([u]);
    callables.update.mockRejectedValueOnce(Object.assign(new Error("lost"), { code: "unavailable" }));
    callables.get.mockRejectedValueOnce(Object.assign(new Error("lost"), { code: "unavailable" }));
    click(mount, `units-menu-${u.unitId}`);
    click(mount, `units-edit-${u.unitId}`);
    (q(mount, `units-edit-color-${u.unitId}-purple`) as HTMLInputElement).click();
    (q(mount, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await settle();
    expect(q(mount, `units-card-${u.unitId}`)?.getAttribute("data-unit-color")).toBe("none");
    expect(q(mount, `units-edit-title-${u.unitId}`)).not.toBeNull();
  });

  test("Curriculum unit pills keep each unit's own color", async () => {
    const a = unit({ title: "Teal unit", color: "teal", resourceIds: [L1.id] });
    const b = unit({ title: "Plain unit", resourceIds: [L1.id] });
    const c = unit({ title: "Coral unit", color: "coral", resourceIds: [L1.id] });
    const h = setup([a, b, c]);
    await settle();
    click(h.mount, "nav-curriculum");
    await settle();
    const card = h.mount.querySelector<HTMLElement>(`[data-resource-id="${L1.id}"]`)!;
    const color = (id: string) =>
      card.querySelector(`[data-testid="resource-unit-pill-${id}"]`)?.getAttribute("data-unit-color");
    expect(color(a.unitId)).toBe("teal");
    expect(color(b.unitId)).toBe("none");
    expect(color(c.unitId)).toBe("coral");
    expect(card.querySelector(`[data-testid="resource-unit-pill-${a.unitId}"]`)?.textContent).toBe("Teal unit");
  });
});

describe("Unit Results browser history", () => {
  const realBack = async (): Promise<void> => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 100));
    await settle();
  };
  const realForward = async (): Promise<void> => {
    window.history.forward();
    await new Promise((r) => setTimeout(r, 100));
    await settle();
  };
  const surface = (m: HTMLElement) => q(m, "workspace-outlet")?.getAttribute("data-active-surface");

  test("My Units -> Unit Results -> Lesson Results -> Class Results: Back and Forward restore each, keeping grade, filter, and Back labels", async () => {
    const u = unit({ resourceIds: [L3.id, L1.id] });
    const { mount, opened } = await openMyUnits([u]);
    click(mount, `units-results-${u.unitId}`);
    await settle();
    expect(window.history.state).toEqual({ kind: "shell-unit-results", surface: "units", unitId: u.unitId, grade: "7" });
    expect(window.location.hash).toBe(`#units/results/7/${u.unitId}`);
    const select = q(mount, "unit-results-class") as HTMLSelectElement;
    select.value = "c2";
    select.dispatchEvent(new Event("change"));
    click(mount, `unit-results-open-${L3.id}`);
    await settle();
    expect(window.history.state).toEqual({
      kind: "shell-lesson-summary",
      surface: "curriculum",
      lessonSlug: L3.id,
      from: { unitId: u.unitId, grade: "7", view: "results" },
    });
    click(mount, "lesson-class-result-view-c1");
    await settle();
    expect(opened).toEqual(["a-l3-c1"]);
    expect(window.history.state).toMatchObject({ kind: "shell-assignment-detail", classId: "c1", assignmentId: "a-l3-c1" });

    // Back: Class Results -> Lesson Results (origin kept).
    await realBack();
    expect(surface(mount)).toBe("curriculum");
    expect(q(mount, "lesson-summary-title")?.textContent).toBe(L3.title);
    expect(q(mount, "lesson-summary-back")?.textContent).toBe("Back to My Units");
    // Back: Lesson Results -> Unit Results (grade and class filter kept).
    await realBack();
    expect(surface(mount)).toBe("units");
    expect(q(mount, "unit-results-surface")?.getAttribute("data-unit-id")).toBe(u.unitId);
    expect((q(mount, "unit-results-class") as HTMLSelectElement).value).toBe("c2");
    expect(q(mount, `unit-results-status-${L1.id}`)?.textContent).toBe("Not assigned to 7B Science");
    // Back: Unit Results -> My Units.
    await realBack();
    expect(q(mount, "unit-results-surface")).toBeNull();
    expect(q(mount, "units-panel")?.hidden).toBe(false);
    expect(q(mount, "units-grade-7")?.getAttribute("aria-pressed")).toBe("true");
    // Forward: My Units -> Unit Results -> Lesson Results.
    await realForward();
    expect(q(mount, "unit-results-surface")?.getAttribute("data-unit-id")).toBe(u.unitId);
    await realForward();
    expect(q(mount, "lesson-summary-title")?.textContent).toBe(L3.title);
    // In-app Back to My Units from these Results returns to Unit Results.
    click(mount, "lesson-summary-back");
    await settle();
    expect(q(mount, "unit-results-surface")?.getAttribute("data-unit-id")).toBe(u.unitId);
    expect(window.history.state).toMatchObject({ kind: "shell-unit-results", unitId: u.unitId });
  });

  test("in-app Back from Unit Results replaces its entry (no push) and keeps the unit's expansion", async () => {
    const u = unit({ resourceIds: [L1.id] });
    const { mount } = await openMyUnits([u]);
    click(mount, `units-toggle-${u.unitId}`);
    click(mount, `units-results-${u.unitId}`);
    await settle();
    const pushSpy = jest.spyOn(window.history, "pushState");
    try {
      click(mount, "unit-results-back");
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
    }
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "units" });
    // The teacher collapsed it before opening Unit Results; it stays collapsed.
    expect(q(mount, `units-details-${u.unitId}`)?.hidden).toBe(true);
  });

  test("a Unit Results entry for a unit no longer listed fails closed onto the units", async () => {
    const u = unit({ resourceIds: [L1.id] });
    const { mount } = await openMyUnits([u]);
    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: { kind: "shell-unit-results", surface: "units", unitId: "Gone0000000000000000", grade: "7" },
      }),
    );
    await settle();
    expect(q(mount, "unit-results-surface")).toBeNull();
    expect(q(mount, "units-panel")?.hidden).toBe(false);
  });

  test("filtered to a class without the lesson, the action names the all-class destination", async () => {
    const u = unit({ resourceIds: [L3.id, L1.id] });
    const { mount } = await openMyUnits([u]);
    click(mount, `units-results-${u.unitId}`);
    await settle();
    expect(q(mount, `unit-results-open-${L1.id}`)?.textContent).toBe("Results");
    const select = q(mount, "unit-results-class") as HTMLSelectElement;
    select.value = "c2";
    select.dispatchEvent(new Event("change"));
    const allClass = q(mount, `unit-results-open-${L1.id}`) as HTMLButtonElement;
    expect(allClass.textContent).toBe("View All-Class Results");
    expect(allClass.getAttribute("aria-label")).toBe(`View all-class Results for ${L1.title}`);
    expect(q(mount, `unit-results-open-${L3.id}`)?.textContent).toBe("Results");
    allClass.click();
    await settle();
    expect(q(mount, "lesson-summary-title")?.textContent).toBe(L1.title);
  });
});

describe("unit expansion and chevron", () => {
  const expanded = (root: ParentNode, u: TeacherUnit) => q(root, `units-toggle-${u.unitId}`)?.getAttribute("aria-expanded");
  // A browser reload: a fresh shell, the in-memory copy dropped, storage kept.
  const reload = async (units: TeacherUnit[]) => {
    document.body.textContent = "";
    _resetUnitExpansionSessionForTest();
    _resetCurriculumSessionStateForTest();
    return openMyUnits(units);
  };

  test("units with no saved preference start expanded", async () => {
    const a = unit({ resourceIds: [L1.id] });
    const b = unit({ title: "Weather", resourceIds: [L2.id] });
    const { mount } = await openMyUnits([a, b]);
    expect(expanded(mount, a)).toBe("true");
    expect(expanded(mount, b)).toBe("true");
    expect(q(mount, `units-details-${a.unitId}`)?.hidden).toBe(false);
  });

  test("each unit's state is remembered independently and restored after a reload", async () => {
    const a = unit({ resourceIds: [L1.id] });
    const b = unit({ title: "Weather" });
    const c = unit({ title: "Plants" });
    const { mount } = await openMyUnits([a, b, c]);
    click(mount, `units-toggle-${b.unitId}`);
    expect(expanded(mount, b)).toBe("false");
    const after = await reload([a, b, c]);
    expect(expanded(after.mount, a)).toBe("true");
    expect(expanded(after.mount, b)).toBe("false");
    expect(q(after.mount, `units-details-${b.unitId}`)?.hidden).toBe(true);
    expect(expanded(after.mount, c)).toBe("true");
    click(after.mount, `units-toggle-${b.unitId}`);
    const again = await reload([a, b, c]);
    expect(expanded(again.mount, b)).toBe("true");
  });

  test("the preference is the teacher's own and never writes unit records", async () => {
    const a = unit();
    const { mount, callables } = await openMyUnits([a]);
    click(mount, `units-toggle-${a.unitId}`);
    expect(JSON.parse(localStorage.getItem("lyfelabz.units.collapsed.teacherA")!)).toEqual([a.unitId]);
    expect(localStorage.getItem("lyfelabz.units.collapsed.teacherB")).toBeNull();
    for (const fn of [callables.update, callables.setResources, callables.reorder, callables.archive]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  test("a new unit starts expanded", async () => {
    const a = unit();
    const { mount } = await openMyUnits([a]);
    click(mount, "units-create-open");
    const title = mount.querySelector<HTMLInputElement>("[data-testid=units-create-title]")!;
    title.value = "Volcanoes";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    click(mount, "units-create-submit");
    await settle();
    const created = Array.from(mount.querySelectorAll<HTMLElement>("[data-testid^=units-title-]")).find(
      (t) => t.textContent === "Volcanoes",
    );
    expect(created).toBeDefined();
    const id = created!.getAttribute("data-testid")!.slice("units-title-".length);
    expect(q(mount, `units-toggle-${id}`)?.getAttribute("aria-expanded")).toBe("true");
  });

  test("archiving one unit leaves the other units' saved states unchanged", async () => {
    const a = unit();
    const b = unit({ title: "Weather" });
    const { mount } = await openMyUnits([a, b]);
    click(mount, `units-toggle-${a.unitId}`);
    click(mount, `units-menu-${b.unitId}`);
    click(mount, `units-archive-${b.unitId}`);
    await settle();
    expect(q(mount, `units-card-${b.unitId}`)).toBeNull();
    expect(expanded(mount, a)).toBe("false");
    const after = await reload([a]);
    expect(expanded(after.mount, a)).toBe("false");
  });

  test("the chevron is an SVG in a labelled button that turns with aria-expanded; the title toggles too", async () => {
    const a = unit();
    const { mount } = await openMyUnits([a]);
    const toggle = q(mount, `units-toggle-${a.unitId}`) as HTMLButtonElement;
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.type).toBe("button");
    expect(toggle.getAttribute("aria-label")).toBe("Show resources in Earth Systems");
    expect(toggle.getAttribute("aria-controls")).toBe(q(mount, `units-details-${a.unitId}`)!.id);
    const svg = toggle.querySelector("svg.shell-units-card-chevron");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(toggle.textContent).not.toMatch(/[\u25B4\u25BE]/);
    toggle.focus();
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    click(mount, `units-title-${a.unitId}`);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Unit Results and the menu stay separate controls that do not toggle.
    click(mount, `units-menu-${a.unitId}`);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("shared grade selection with Curriculum", () => {
  const FILTER_KEY = "lyfelabz.curriculum.filters.teacherA";
  const pressed = (root: ParentNode, id: string) => q(root, id)?.getAttribute("aria-pressed");
  // A browser reload: module memory dropped, localStorage (filters and unit
  // expansion) kept.
  const reloadShell = async (units: TeacherUnit[]) => {
    const saved = Object.entries(localStorage);
    document.body.textContent = "";
    _resetUnitExpansionSessionForTest();
    _resetCurriculumSessionStateForTest();
    for (const [k, v] of saved) localStorage.setItem(k, v);
    const h = setup(units);
    await settle();
    return h;
  };

  test("a grade chosen in Curriculum is the grade My Units opens on", async () => {
    const h = setup([unit()]);
    await settle();
    click(h.mount, "nav-curriculum");
    await settle();
    click(h.mount, "filter-grade-7");
    click(h.mount, "nav-units");
    await settle();
    expect(pressed(h.mount, "units-grade-7")).toBe("true");
    click(h.mount, "nav-curriculum");
    await settle();
    click(h.mount, "filter-grade-6");
    click(h.mount, "nav-units");
    await settle();
    expect(pressed(h.mount, "units-grade-6")).toBe("true");
  });

  test("a grade chosen in My Units is the grade Curriculum opens on, topic kept", async () => {
    const h = setup([unit()]);
    await settle();
    click(h.mount, "nav-curriculum");
    await settle();
    click(h.mount, "filter-topic-earth-space");
    click(h.mount, "nav-units");
    await settle();
    click(h.mount, "units-grade-7");
    await settle();
    expect(JSON.parse(localStorage.getItem(FILTER_KEY)!)).toEqual({ grade: "7", topic: "earth-space" });
    click(h.mount, "nav-curriculum");
    await settle();
    expect(pressed(h.mount, "filter-grade-7")).toBe("true");
    expect(pressed(h.mount, "filter-topic-earth-space")).toBe("true");
  });

  test("the My Units grade survives a reload, in both surfaces", async () => {
    const units = [unit()];
    await openMyUnits(units);
    const after = await reloadShell(units);
    click(after.mount, "nav-units");
    await settle();
    expect(pressed(after.mount, "units-grade-7")).toBe("true");
    const again = await reloadShell(units);
    click(again.mount, "nav-curriculum");
    await settle();
    expect(pressed(again.mount, "filter-grade-7")).toBe("true");
  });

  test("opening My Units on All Grades shows Grade 6 without overwriting All Grades", async () => {
    const h = setup([unit()]);
    await settle();
    click(h.mount, "nav-units");
    await settle();
    expect(pressed(h.mount, "units-grade-6")).toBe("true");
    expect(localStorage.getItem(FILTER_KEY) ?? "").not.toContain('"grade":"6"');
    click(h.mount, "nav-curriculum");
    await settle();
    expect(pressed(h.mount, "filter-grade-all")).toBe("true");
  });

  test("Grade 8 round-trips through the shared selection; Curriculum falls back to All Grades", async () => {
    const units = [unit()];
    const h = await openMyUnits(units);
    click(h.mount, "units-grade-8");
    await settle();
    expect(JSON.parse(localStorage.getItem(FILTER_KEY)!).grade).toBe("8");
    const after = await reloadShell(units);
    click(after.mount, "nav-units");
    await settle();
    expect(pressed(after.mount, "units-grade-8")).toBe("true");
    click(after.mount, "nav-curriculum");
    await settle();
    expect(pressed(after.mount, "filter-grade-all")).toBe("true");
  });

  test("a stored grade neither surface offers falls back as before", async () => {
    localStorage.setItem(FILTER_KEY, JSON.stringify({ grade: "99", topic: "all" }));
    const h = setup([unit()]);
    await settle();
    click(h.mount, "nav-curriculum");
    await settle();
    expect(pressed(h.mount, "filter-grade-all")).toBe("true");
    click(h.mount, "nav-units");
    await settle();
    expect(pressed(h.mount, "units-grade-6")).toBe("true");
  });

  test("grade changes keep each unit's own expansion preference", async () => {
    const a = unit({ resourceIds: [L1.id] });
    const b = unit({ title: "Weather" });
    const { mount } = await openMyUnits([a, b]);
    click(mount, `units-toggle-${b.unitId}`);
    click(mount, "units-grade-6");
    await settle();
    click(mount, "units-grade-7");
    await settle();
    const after = await reloadShell([a, b]);
    click(after.mount, "nav-units");
    await settle();
    expect(pressed(after.mount, "units-grade-7")).toBe("true");
    expect(q(after.mount, `units-toggle-${a.unitId}`)?.getAttribute("aria-expanded")).toBe("true");
    expect(q(after.mount, `units-toggle-${b.unitId}`)?.getAttribute("aria-expanded")).toBe("false");
  });
});
