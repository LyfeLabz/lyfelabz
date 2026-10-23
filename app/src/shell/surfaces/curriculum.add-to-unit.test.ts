/**
 * @jest-environment jsdom
 *
 * Milestone 2A: select resources in Curriculum and add them to a unit.
 * Selection checkboxes on lesson and resource-tab cards (only while My Units
 * is available), persistence across tabs, filters and surfaces, the selection
 * toolbar, the Add to Unit dialog (existing unit, new unit, duplicates,
 * conflicts, unconfirmed outcomes), and "View unit" into My Units.
 *
 * The enabled cases run under the test-only availability fixture
 * (scripts/teacher-units-test-setup.js) with in-memory callables that model
 * the server's revision check.
 */
import * as fs from "fs";
import * as path from "path";
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { TeacherUnit, TeacherUnitsCallables } from "../../teacherUnits/types";
import {
  createTeacherUnitsSurfaceSeam,
  type TeacherUnitsSurfaceSeam,
} from "../../teacherUnits/unitsController";
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import { getResourcesByType, getSurfaceableLessons } from "../../curriculum/curriculumManifest";
import { canonicalId } from "../../curriculum/resourceProjection";
import { mountTeacherShell, type ShellDeps } from "../shell";
import { _resetCurriculumSessionStateForTest } from "./curriculum";
import { _resetMyUnitsSurfaceStateForTest } from "./myUnits";

const emptyListClasses: ListClasses = () => Promise.resolve(Object.freeze<ClassSummary[]>([]));
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacherA",
  schoolId: "schoolA",
  displayName: "Ada",
});

// Every Curriculum resource-tab item is Grade 6 today, so the main fixtures
// are Grade 6; LESSON_7 provides the cross-grade case.
const lessons6 = getSurfaceableLessons().filter((l) => l.grade === "6");
const LESSON_A = lessons6[0]!;
const LESSON_B = lessons6[1]!;
const LESSON_7 = getSurfaceableLessons().find((l) => l.grade === "7")!;
const SIM_ENTRY = getResourcesByType("simulation").find((e) => e.unit.grade === "6")!;
const SIM_ID = canonicalId(SIM_ENTRY.unit, SIM_ENTRY.resource);

let n = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Unit${String(++n).padStart(16, "0")}`,
  grade: "6",
  title: "Earth Systems",
  description: "",
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

// An in-memory server: list by grade, get, create, and setResources with the
// revision check (writeConflict) the real callable enforces.
function server(initial: TeacherUnit[]) {
  const store = new Map(initial.map((u) => [u.unitId, u]));
  const callables = {
    list: jest.fn(async (req: { grade?: string; includeArchived?: boolean }) => ({
      units: Array.from(store.values()).filter(
        (u) => (req.grade === undefined || u.grade === req.grade) && (req.includeArchived === true || u.status === "active"),
      ),
    })),
    get: jest.fn(async (req: { unitId: string }) => {
      const u = store.get(req.unitId);
      if (u === undefined) throw { details: { code: "teacherUnits.notFound" } };
      return { unit: u };
    }),
    create: jest.fn(async (req: { grade: TeacherUnit["grade"]; title: string; description: string }) => {
      const u = unit({ grade: req.grade, title: req.title, description: req.description });
      store.set(u.unitId, u);
      return { unit: u, replayed: false };
    }),
    setResources: jest.fn(async (req: { unitId: string; expectedRevision: number; resourceIds: string[] }) => {
      const u = store.get(req.unitId)!;
      if (u.revision !== req.expectedRevision) {
        throw { details: { code: "teacherUnits.writeConflict", currentRevision: u.revision } };
      }
      const next = { ...u, resourceIds: [...req.resourceIds], revision: u.revision + 1 };
      store.set(u.unitId, next);
      return { unit: next, noop: false };
    }),
    update: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    reorder: jest.fn(),
  };
  const storage = memoryStorage();
  const seam: TeacherUnitsSurfaceSeam = createTeacherUnitsSurfaceSeam({
    callables: callables as unknown as TeacherUnitsCallables,
    readFirebaseUid: () => "teacherA",
    readActiveTeacher: () => ({ uid: "teacherA", schoolId: "schoolA" }),
    createStore: (scope) => createTeacherUnitCreateAttemptStore(scope, () => storage),
  });
  return { store, callables, seam };
}

const mount = (overrides: Partial<ShellDeps> = {}): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  mountTeacherShell(teacher, div, {
    onSignOut: () => undefined,
    listClasses: emptyListClasses,
    onLaunchPresentMode: () => undefined,
    ...overrides,
  });
  return div;
};
const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (root: ParentNode, id: string) => (q(root, id) as HTMLButtonElement).click();
const box = (root: ParentNode, id: string) => q(root, id) as HTMLInputElement;
const toggle = (root: ParentNode, id: string) => {
  const b = box(root, id);
  b.checked = !b.checked;
  b.dispatchEvent(new Event("change", { bubbles: true }));
};
const choose = (id: string) => {
  const r = box(document, id);
  r.checked = true;
  r.dispatchEvent(new Event("change", { bubbles: true }));
};
const activeSurface = (root: HTMLElement) =>
  q(root, "workspace-outlet")?.getAttribute("data-active-surface") ?? null;
const countText = (root: ParentNode) => q(root, "curriculum-selection-count")?.textContent ?? "";
const barHidden = (root: ParentNode) => (q(root, "curriculum-selection-bar") as HTMLElement).hidden;

async function curriculumWith(units: TeacherUnit[]) {
  const s = server(units);
  const root = mount({ teacherUnits: s.seam });
  click(root, "nav-curriculum");
  await flush();
  return { root, ...s };
}

async function openDialog(root: HTMLElement) {
  click(root, "curriculum-selection-add");
  await flush();
  return q(document, "units-add-dialog") as HTMLElement;
}

beforeEach(() => {
  document.body.textContent = "";
  window.history.replaceState(null, "", "/app/teacher");
  _resetCurriculumSessionStateForTest?.();
  _resetMyUnitsSurfaceStateForTest();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
});

describe("closed release", () => {
  test("without a Teacher Units seam, Curriculum has no selection checkboxes or toolbar", () => {
    const root = mount();
    click(root, "nav-curriculum");
    expect(root.querySelector("input[type=checkbox][data-resource-id]")).toBeNull();
    expect(q(root, "curriculum-selection-bar")).toBeNull();
    click(root, "curriculum-tab-simulations");
    expect(root.querySelector("input[type=checkbox][data-resource-id]")).toBeNull();
  });
});

describe("selection", () => {
  test("lesson and resource-tab cards carry a labelled checkbox before their actions; the toolbar appears only with a selection", async () => {
    const { root } = await curriculumWith([]);
    const lessonBox = box(root, `lesson-select-${LESSON_A.slug}`);
    expect(lessonBox.getAttribute("aria-label")).toBe(`Select ${LESSON_A.title} (Lesson)`);
    expect(lessonBox.getAttribute("data-resource-id")).toBe(LESSON_A.slug);
    const card = q(root, `lesson-card-${LESSON_A.slug}`)!;
    const focusables = Array.from(card.querySelectorAll<HTMLElement>("input, button, a"));
    expect(focusables[0]).toBe(lessonBox);
    expect(barHidden(root)).toBe(true);

    toggle(root, `lesson-select-${LESSON_A.slug}`);
    expect(barHidden(root)).toBe(false);
    expect(countText(root)).toBe("1 selected");
    expect(q(root, "curriculum-selection-bar")?.getAttribute("role")).toBe("region");
    expect(q(root, "curriculum-selection-count")?.getAttribute("aria-live")).toBe("polite");

    click(root, "curriculum-tab-simulations");
    const simBox = box(root, `resource-select-${SIM_ENTRY.resource.filename}`);
    expect(simBox.getAttribute("aria-label")).toBe(`Select ${SIM_ENTRY.resource.label} (Simulation)`);
    expect(simBox.getAttribute("data-resource-id")).toBe(SIM_ID);
  });

  test("selections persist across tabs, grade and topic filters, and leaving Curriculum", async () => {
    const { root } = await curriculumWith([]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    click(root, "curriculum-tab-simulations");
    expect(countText(root)).toBe("1 selected (1 not shown)");
    toggle(root, `resource-select-${SIM_ENTRY.resource.filename}`);
    expect(countText(root)).toBe("2 selected (1 not shown)");

    click(root, "curriculum-tab-lessons");
    expect(box(root, `lesson-select-${LESSON_A.slug}`).checked).toBe(true);
    click(root, "filter-grade-7");
    expect(countText(root)).toBe("2 selected (2 not shown)");
    click(root, "filter-grade-all");
    click(root, "curriculum-tab-simulations");
    expect(box(root, `resource-select-${SIM_ENTRY.resource.filename}`).checked).toBe(true);

    click(root, "nav-classes");
    expect(activeSurface(root)).toBe("classes");
    click(root, "nav-curriculum");
    expect(box(root, `lesson-select-${LESSON_A.slug}`).checked).toBe(true);
    // Curriculum reopens on Lessons, so the simulation is on another tab.
    expect(countText(root)).toBe("2 selected (1 not shown)");
  });

  test("Clear Selection unchecks everything, hides the toolbar, and keeps focus on a real control", async () => {
    const { root } = await curriculumWith([]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    toggle(root, `lesson-select-${LESSON_B.slug}`);
    expect(countText(root)).toBe("2 selected");
    click(root, "curriculum-selection-clear");
    expect(barHidden(root)).toBe(true);
    expect(box(root, `lesson-select-${LESSON_A.slug}`).checked).toBe(false);
    expect(box(root, `lesson-select-${LESSON_B.slug}`).checked).toBe(false);
    expect(document.activeElement).toBe(q(root, "curriculum-tab-lessons"));
  });
});

describe("Add to Unit", () => {
  test("adds to an existing unit: one request with the held list, missing ids in canonical order, the held revision; then clears and offers View unit", async () => {
    const existing = unit({ title: "Earth Systems", resourceIds: [LESSON_B.slug], revision: 4 });
    const other = unit({ title: "Weather" });
    const { root, callables } = await curriculumWith([existing, other]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    click(root, "curriculum-tab-simulations");
    toggle(root, `resource-select-${SIM_ENTRY.resource.filename}`);
    click(root, "curriculum-tab-lessons");

    const dialog = await openDialog(root);
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(q(dialog, "units-add-summary")?.textContent).toBe("2 resources selected.");
    // Defaults to the selection's grade.
    expect(q(dialog, "units-add-grade-6")?.getAttribute("aria-pressed")).toBe("true");
    expect(q(dialog, `units-add-choice-meta-${existing.unitId}`)?.textContent).toBe("1 resource");

    choose(`units-add-choice-${existing.unitId}`);
    click(dialog, "units-add-confirm");
    await flush();

    expect(callables.setResources).toHaveBeenCalledTimes(1);
    const req = callables.setResources.mock.calls[0]![0];
    expect(req.unitId).toBe(existing.unitId);
    expect(req.expectedRevision).toBe(4);
    const added = req.resourceIds.slice(1);
    expect(req.resourceIds[0]).toBe(LESSON_B.slug);
    expect(new Set(added)).toEqual(new Set([LESSON_A.slug, SIM_ID]));
    expect(q(document, "units-add-dialog")).toBeNull();
    expect(q(root, "curriculum-unit-notice-text")?.textContent).toBe(
      `Added 2 resources to "Earth Systems" (Grade 6).`,
    );
    expect(barHidden(root)).toBe(true);
    expect(box(root, `lesson-select-${LESSON_A.slug}`).checked).toBe(false);
    expect(document.activeElement).toBe(q(root, "curriculum-unit-notice-view"));
  });

  test("prevents duplicates: the unit's existing resources are named and only the missing ones are sent", async () => {
    const existing = unit({ resourceIds: [LESSON_A.slug] });
    const { root, callables } = await curriculumWith([existing]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    toggle(root, `lesson-select-${LESSON_B.slug}`);
    const dialog = await openDialog(root);
    expect(q(dialog, `units-add-choice-meta-${existing.unitId}`)?.textContent).toBe(
      "1 resource · already has 1 of these",
    );
    choose(`units-add-choice-${existing.unitId}`);
    click(dialog, "units-add-confirm");
    await flush();
    expect(callables.setResources.mock.calls[0]![0].resourceIds).toEqual([LESSON_A.slug, LESSON_B.slug]);
    expect(q(root, "curriculum-unit-notice-text")?.textContent).toBe(
      `Added 1 resource to "Earth Systems" (Grade 6). 1 was already there.`,
    );
  });

  test("a unit that already has everything sends nothing, says so, and clears the selection", async () => {
    const existing = unit({ resourceIds: [LESSON_A.slug, LESSON_B.slug] });
    const { root, callables } = await curriculumWith([existing]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    toggle(root, `lesson-select-${LESSON_B.slug}`);
    const dialog = await openDialog(root);
    choose(`units-add-choice-${existing.unitId}`);
    click(dialog, "units-add-confirm");
    await flush();
    expect(callables.setResources).not.toHaveBeenCalled();
    expect(q(root, "curriculum-unit-notice-text")?.textContent).toBe(
      `"Earth Systems" (Grade 6) already has all 2 of these resources. Nothing was changed.`,
    );
    expect(barHidden(root)).toBe(true);
  });

  test("a unit changed elsewhere: nothing is resent, the selection is kept, and a deliberate retry uses the new revision", async () => {
    const existing = unit({ revision: 2 });
    const { root, store, callables } = await curriculumWith([existing]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    const dialog = await openDialog(root);
    // Another session adds a resource after the dialog loaded the unit.
    store.set(existing.unitId, { ...existing, resourceIds: [LESSON_B.slug], revision: 3 });
    choose(`units-add-choice-${existing.unitId}`);
    click(dialog, "units-add-confirm");
    await flush();
    expect(callables.setResources).toHaveBeenCalledTimes(1);
    expect(q(dialog, "units-add-problem")?.hidden).toBe(false);
    expect(q(dialog, "units-add-problem")?.textContent).toContain("changed since it was loaded here");
    expect(q(document, "units-add-dialog")).not.toBeNull();
    expect(countText(root)).toBe("1 selected");

    click(dialog, "units-add-confirm");
    await flush();
    expect(callables.setResources).toHaveBeenCalledTimes(2);
    const retry = callables.setResources.mock.calls[1]![0];
    expect(retry.expectedRevision).toBe(3);
    expect(retry.resourceIds).toEqual([LESSON_B.slug, LESSON_A.slug]);
    expect(q(document, "units-add-dialog")).toBeNull();
    expect(barHidden(root)).toBe(true);
  });

  test("an unconfirmed outcome is read once, never resent, and keeps the selection", async () => {
    const existing = unit();
    const { root, callables } = await curriculumWith([existing]);
    callables.setResources.mockImplementationOnce(async () => {
      throw Object.assign(new Error("lost"), { code: "unavailable" });
    });
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    const dialog = await openDialog(root);
    choose(`units-add-choice-${existing.unitId}`);
    click(dialog, "units-add-confirm");
    await flush();
    expect(callables.setResources).toHaveBeenCalledTimes(1);
    expect(callables.get).toHaveBeenCalled();
    expect(q(dialog, "units-add-problem")?.textContent).toContain("couldn't confirm whether the resources were added");
    expect(q(dialog, "units-add-open-units")?.hidden).toBe(false);
    expect(countText(root)).toBe("1 selected");
  });

  test("creates a new unit, then adds to it once the create is confirmed", async () => {
    const { root, callables } = await curriculumWith([]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    const dialog = await openDialog(root);
    // No empty-state sentence or lone radio: the new unit's name is the step.
    expect(q(dialog, "units-add-list-state")?.hidden).toBe(true);
    expect(dialog.querySelector("legend")?.textContent).toBe("New Grade 6 unit");
    expect(box(dialog, "units-add-choice-new").checked).toBe(true);
    expect((box(dialog, "units-add-choice-new").closest("label") as HTMLElement).hidden).toBe(true);
    expect(q(dialog, "units-add-confirm")?.textContent).toBe("Create Unit & Add");

    click(dialog, "units-add-confirm");
    const title = box(dialog, "units-add-new-title");
    expect(q(dialog, "units-add-problem")?.textContent).toBe("Enter a unit name.");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(title.getAttribute("aria-describedby")).toBe("units-add-problem");
    expect(callables.create).not.toHaveBeenCalled();

    title.value = "  Plate Tectonics  ";
    click(dialog, "units-add-confirm");
    await flush();
    expect(callables.create).toHaveBeenCalledTimes(1);
    expect(callables.create.mock.calls[0]![0]).toMatchObject({ grade: "6", title: "Plate Tectonics", description: "" });
    expect(callables.setResources).toHaveBeenCalledTimes(1);
    expect(callables.setResources.mock.calls[0]![0].resourceIds).toEqual([LESSON_A.slug]);
    expect(q(root, "curriculum-unit-notice-text")?.textContent).toBe(
      `Created "Plate Tectonics" (Grade 6) and added 1 resource.`,
    );
  });

  test("mixed grades: the dialog notes resources from another grade; units of any grade can be chosen", async () => {
    const g7 = unit({ grade: "7", title: "Cells" });
    const { root, callables } = await curriculumWith([g7]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    toggle(root, `lesson-select-${LESSON_7.slug}`);
    const dialog = await openDialog(root);
    click(dialog, "units-add-grade-7");
    await flush();
    expect(q(dialog, "units-add-grade-note")?.hidden).toBe(false);
    expect(q(dialog, "units-add-grade-note")?.textContent).toBe(
      "1 of these resources are from another grade. A unit can hold resources from any grade.",
    );
    choose(`units-add-choice-${g7.unitId}`);
    click(dialog, "units-add-confirm");
    await flush();
    expect(callables.setResources.mock.calls[0]![0].unitId).toBe(g7.unitId);
  });

  test("Escape closes the dialog without a request, keeps the selection, and returns focus to Add to Unit", async () => {
    const existing = unit();
    const { root, callables } = await curriculumWith([existing]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    await openDialog(root);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(q(document, "units-add-dialog")).toBeNull();
    expect(callables.setResources).not.toHaveBeenCalled();
    expect(countText(root)).toBe("1 selected");
    expect(document.activeElement).toBe(q(root, "curriculum-selection-add"));
  });

  test("Add with no unit chosen asks for one and sends nothing", async () => {
    const existing = unit();
    const { root, callables } = await curriculumWith([existing]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    const dialog = await openDialog(root);
    click(dialog, "units-add-confirm");
    expect(q(dialog, "units-add-problem")?.textContent).toBe("Choose a unit, or create a new one.");
    expect(callables.setResources).not.toHaveBeenCalled();
  });
});

describe("View unit", () => {
  test("opens My Units on the unit's grade with that unit expanded and focused", async () => {
    const weather = unit({ title: "Weather" });
    const target = unit({ title: "Earth Systems" });
    const { root } = await curriculumWith([weather, target]);
    click(root, "filter-grade-7");
    toggle(root, `lesson-select-${LESSON_7.slug}`);
    click(root, "filter-grade-all");
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    const dialog = await openDialog(root);
    click(dialog, "units-add-grade-6");
    await flush();
    choose(`units-add-choice-${target.unitId}`);
    click(dialog, "units-add-confirm");
    await flush();

    click(root, "curriculum-unit-notice-view");
    await flush();
    expect(activeSurface(root)).toBe("units");
    expect(q(root, "units-grade-6")?.getAttribute("aria-pressed")).toBe("true");
    const toggleBtn = q(root, `units-toggle-${target.unitId}`)!;
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(toggleBtn);
    expect(q(root, `units-toggle-${weather.unitId}`)?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("recovery paths", () => {
  test("Open My Units from an unconfirmed outcome opens My Units on that unit", async () => {
    const existing = unit({ title: "Weather" });
    const { root, callables } = await curriculumWith([existing]);
    callables.setResources.mockImplementationOnce(async () => {
      throw Object.assign(new Error("lost"), { code: "unavailable" });
    });
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    const dialog = await openDialog(root);
    choose(`units-add-choice-${existing.unitId}`);
    click(dialog, "units-add-confirm");
    await flush();
    click(dialog, "units-add-open-units");
    await flush();
    expect(q(document, "units-add-dialog")).toBeNull();
    expect(activeSurface(root)).toBe("units");
    expect(q(root, `units-toggle-${existing.unitId}`)?.getAttribute("aria-expanded")).toBe("true");
    // Leaving Curriculum keeps the selection.
    click(root, "nav-curriculum");
    expect(countText(root)).toBe("1 selected");
  });

  test("a create that can't be confirmed adds nothing, keeps the selection, and points to My Units", async () => {
    const { root, callables } = await curriculumWith([]);
    callables.create.mockImplementationOnce(async () => {
      throw Object.assign(new Error("lost"), { code: "unavailable" });
    });
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    const dialog = await openDialog(root);
    box(dialog, "units-add-new-title").value = "Forces";
    click(dialog, "units-add-confirm");
    await flush();
    expect(callables.setResources).not.toHaveBeenCalled();
    expect(q(dialog, "units-add-problem")?.textContent).toBe(
      `LyfeLabz couldn't confirm whether "Forces" was created, so nothing was added. Open My Units to check it. Your selection is kept.`,
    );
    expect(q(dialog, "units-add-open-units")?.hidden).toBe(false);
    expect(countText(root)).toBe("1 selected");
  });
});

describe("styles", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  test("the toolbar stays in view, hidden states win over display rules, and touch targets are 44px", () => {
    expect(html).toMatch(/\.shell-curriculum-selection-dock\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/);
    expect(html).toMatch(/\.shell-curriculum-selection\[hidden\],\s*\.shell-curriculum-unit-notice\[hidden\],\s*\.shell-resource-units-extra\[hidden\],\s*\.shell-units-add-dialog \[hidden\]\s*\{\s*display:\s*none !important;/);
    expect(html).toMatch(/@media \(pointer: coarse\)\s*\{[^@]*\.shell-resource-select\s*\{\s*min-width:\s*44px;\s*min-height:\s*44px;/);
  });
});

describe("Milestone 2B card refinements", () => {
  test("the checkbox has its own leading column; the metadata pills and title share the next one", async () => {
    const { root } = await curriculumWith([]);
    const card = q(root, `lesson-card-${LESSON_A.slug}`)!;
    expect(card.classList.contains("shell-resource-row-selectable")).toBe(true);
    const first = card.firstElementChild as HTMLElement;
    expect(first.classList.contains("shell-resource-select")).toBe(true);
    expect(first.querySelector("input")).toBe(box(root, `lesson-select-${LESSON_A.slug}`));
    const main = card.querySelector(".shell-resource-row-main")!;
    expect(main.querySelector(".shell-lesson-header")).not.toBeNull();
    expect(main.querySelector(".shell-lesson-title-row")).not.toBeNull();
    expect(main.querySelector(".shell-resource-select")).toBeNull();
  });

  test("an existing unit choice reads Add to Unit; a new unit reads Create Unit & Add", async () => {
    const existing = unit();
    const { root } = await curriculumWith([existing]);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    const dialog = await openDialog(root);
    expect(q(dialog, "units-add-confirm")?.textContent).toBe("Add to Unit");
    choose(`units-add-choice-${existing.unitId}`);
    expect(q(dialog, "units-add-confirm")?.textContent).toBe("Add to Unit");
    choose("units-add-choice-new");
    expect(q(dialog, "units-add-confirm")?.textContent).toBe("Create Unit & Add");
    expect(dialog.querySelector(".shell-units-add-head")?.contains(q(dialog, "units-add-summary"))).toBe(true);
  });
});

describe("unit-name membership pills", () => {
  const pillsOf = (root: ParentNode, slug: string) =>
    Array.from(q(root, `lesson-card-${slug}`)!.querySelectorAll<HTMLElement>(".shell-resource-unit-pill"));

  test("show the saved names of the active units a resource is in: one, two, or two and +N more; archived units are not memberships", async () => {
    const u1 = unit({ title: "Unit 1: Properties of Matter", resourceIds: [LESSON_A.slug, LESSON_B.slug] });
    const u2 = unit({ title: "Matter Review", resourceIds: [LESSON_B.slug] });
    const u3 = unit({ grade: "7", title: "Cross-grade", resourceIds: [LESSON_B.slug] });
    const u4 = unit({ title: "Bonus", resourceIds: [LESSON_B.slug] });
    const gone = unit({ title: "Old unit", status: "archived", resourceIds: [LESSON_A.slug] });
    const { root } = await curriculumWith([u1, u2, u3, u4, gone]);

    expect(pillsOf(root, LESSON_A.slug).map((p) => p.textContent)).toEqual(["Unit 1: Properties of Matter"]);
    const onlyA = pillsOf(root, LESSON_A.slug)[0]!;
    expect(onlyA.tagName).toBe("BUTTON");
    expect(onlyA.getAttribute("aria-label")).toBe("Open unit Unit 1: Properties of Matter in My Units");
    // The pill is in the metadata row, after the grade and topic pills.
    expect(onlyA.closest(".shell-lesson-header")).toBe(q(root, `lesson-card-${LESSON_A.slug}`)!.querySelector(".shell-lesson-header"));

    const cardB = q(root, `lesson-card-${LESSON_B.slug}`)!;
    const more = cardB.querySelector<HTMLButtonElement>("[data-testid=resource-units-more]")!;
    expect(more.textContent).toBe("+2 more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    const extra = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(extra.hidden).toBe(true);
    expect(pillsOf(root, LESSON_B.slug)).toHaveLength(4);
    more.click();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(extra.hidden).toBe(false);
    expect(more.textContent).toBe("Show fewer");

    // No membership, no pill; nothing comes from the checkbox selection.
    const other = getSurfaceableLessons().find((l) => l.grade === "6" && l.slug !== LESSON_A.slug && l.slug !== LESSON_B.slug)!;
    toggle(root, `lesson-select-${other.slug}`);
    expect(pillsOf(root, other.slug)).toHaveLength(0);
  });

  test("one all-grades read per Curriculum visit, not one per card", async () => {
    const { callables } = await curriculumWith([unit({ resourceIds: [LESSON_A.slug] })]);
    const allGrades = callables.list.mock.calls.filter((c) => c[0]?.grade === undefined);
    expect(allGrades).toHaveLength(1);
    expect(allGrades[0]![0]).toEqual({ includeArchived: false });
    expect(callables.list.mock.calls.length).toBeLessThanOrEqual(2);
    expect(callables.get).not.toHaveBeenCalled();
  });

  test("a pill opens My Units on that unit's grade with the unit expanded and focused", async () => {
    const target = unit({ grade: "7", title: "Earth Systems", resourceIds: [LESSON_7.slug] });
    const { root } = await curriculumWith([target]);
    (pillsOf(root, LESSON_7.slug)[0] as HTMLButtonElement).click();
    await flush();
    expect(activeSurface(root)).toBe("units");
    expect(q(root, "units-grade-7")?.getAttribute("aria-pressed")).toBe("true");
    const toggleBtn = q(root, `units-toggle-${target.unitId}`)!;
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(toggleBtn);
  });

  test("updates after a confirmed addition, and after a removal or archive once Curriculum is shown again", async () => {
    const existing = unit({ title: "Weather" });
    const { root, store } = await curriculumWith([existing]);
    expect(pillsOf(root, LESSON_A.slug)).toHaveLength(0);
    toggle(root, `lesson-select-${LESSON_A.slug}`);
    const dialog = await openDialog(root);
    choose(`units-add-choice-${existing.unitId}`);
    click(dialog, "units-add-confirm");
    await flush();
    expect(pillsOf(root, LESSON_A.slug).map((p) => p.textContent)).toEqual(["Weather"]);

    // Changed elsewhere (My Units, another session): the next visit reads it.
    const now = store.get(existing.unitId)!;
    store.set(existing.unitId, { ...now, status: "archived", revision: now.revision + 1 });
    click(root, "nav-classes");
    click(root, "nav-curriculum");
    await flush();
    expect(pillsOf(root, LESSON_A.slug)).toHaveLength(0);
  });

  test("pill styles: compact, truncating, distinct from the topic pill, with a visible focus outline", () => {
    const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(html).toMatch(/\.shell-resource-unit-pill\s*\{[^}]*max-width:\s*14rem;[^}]*text-overflow:\s*ellipsis;/);
    expect(html).toMatch(/\.shell-resource-unit-pill:focus-visible,\s*\.shell-resource-units-more:focus-visible\s*\{\s*outline:/);
    expect(html).toMatch(/\.shell-curriculum-grid \.shell-lesson-view-summary\s*\{[^}]*border-radius:\s*var\(--tw-radius-pill/);
    expect(html).toMatch(/\.shell-curriculum-selection-actions button,\s*\.shell-curriculum-unit-notice-actions button,\s*\.shell-units-add-dialog \.shell-assign-footer button,[^{]*\{[^}]*border-radius:\s*var\(--tw-radius-pill/);
    expect(html).toMatch(/\.shell-card\.shell-resource-row\.shell-resource-row-selectable\s*\{[^}]*"select main actions"/);
  });
});
