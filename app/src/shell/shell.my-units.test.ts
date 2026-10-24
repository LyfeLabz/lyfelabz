/**
 * @jest-environment jsdom
 *
 * Teacher Units UX Milestone 1: My Units as a top-level Teacher Workspace
 * destination. Navigation order and gating, history entries and Back/Forward
 * (including the legacy `#curriculum/units` entry), the Settings > Units
 * archived-view entry point, grade selection, and the closed behavior when
 * the shell holds no Teacher Units seam (every closed release).
 *
 * The enabled cases run under the test-only availability fixture
 * (scripts/teacher-units-test-setup.js); releaseAvailability.test.ts covers
 * the real closed module.
 */
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import type { ListClasses } from "../classes/listClasses";
import type { TeacherUnit, TeacherUnitsCallables } from "../teacherUnits/types";
import {
  createTeacherUnitsSurfaceSeam,
  type TeacherUnitsSurfaceSeam,
} from "../teacherUnits/unitsController";
import { createTeacherUnitCreateAttemptStore } from "../teacherUnits/createAttemptStore";
import { mountTeacherShell, type ShellDeps } from "./shell";
import { parseShellHash } from "./navigationHistory";
import { _resetCurriculumSessionStateForTest } from "./surfaces/curriculum";
import { _resetMyUnitsSurfaceStateForTest } from "./surfaces/myUnits";
import { getPlaceableResources } from "../teacherUnits/placeableResources";

const emptyListClasses: ListClasses = () => Promise.resolve(Object.freeze<ClassSummary[]>([]));
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacherA",
  schoolId: "schoolA",
  displayName: "Ada",
});

let n = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Unit${String(++n).padStart(16, "0")}`,
  grade: "6",
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

// `shared`: one seam for every mount, as the shell holds in production, so
// the seam-owned unconfirmed-change registry survives a remount.
function seamWith(units: TeacherUnit[], shared = false) {
  const list = jest.fn(async (req: { grade?: string; includeArchived?: boolean }) => ({
    units: units.filter(
      (u) => (req.grade === undefined || u.grade === req.grade) && (req.includeArchived === true || u.status === "active"),
    ),
  }));
  const callables = {
    create: jest.fn(),
    list,
    get: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: jest.fn(),
    reorder: jest.fn(),
  };
  const storage = memoryStorage();
  const created: Array<{ initialGrade: string }> = [];
  const make = () =>
    createTeacherUnitsSurfaceSeam({
      callables: callables as unknown as TeacherUnitsCallables,
      readFirebaseUid: () => "teacherA",
      readActiveTeacher: () => ({ uid: "teacherA", schoolId: "schoolA" }),
      createStore: (scope) => createTeacherUnitCreateAttemptStore(scope, () => storage),
    });
  const one = shared ? make() : null;
  const seam: TeacherUnitsSurfaceSeam = {
    createController: (input) => {
      created.push(input);
      return (one ?? make()).createController(input);
    },
  };
  return { seam, list, created, callables };
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
const activeSurface = (root: HTMLElement) =>
  q(root, "workspace-outlet")?.getAttribute("data-active-surface") ?? null;
const popstate = (state: unknown) => window.dispatchEvent(new PopStateEvent("popstate", { state }));
const navLabels = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>("button.shell-nav-button[data-nav-variant=item]")).map(
    (b) => b.textContent,
  );

beforeEach(() => {
  document.body.textContent = "";
  window.history.replaceState(null, "", "/app/teacher");
  _resetCurriculumSessionStateForTest?.();
  _resetMyUnitsSurfaceStateForTest();
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

describe("primary navigation", () => {
  test("enabled: Classes, Curriculum, My Units, Settings; My Units opens directly on the unit workspace", async () => {
    const { seam, list } = seamWith([unit({ title: "Weather" })]);
    const root = mount({ teacherUnits: seam });
    expect(navLabels(root)).toEqual(["Classes", "Curriculum", "My Units", "Settings"]);
    expect(list).not.toHaveBeenCalled();
    click(root, "nav-units");
    await flush();
    expect(activeSurface(root)).toBe("units");
    expect(q(root, "nav-units")?.getAttribute("aria-current")).toBe("page");
    expect(q(root, "units-panel")).not.toBeNull();
    expect(q(root, "workspace-outlet")?.getAttribute("aria-labelledby")).toBe("units-heading");
    expect(document.activeElement?.id).toBe("units-heading");
    expect(q(root, "units-heading")?.tagName ?? root.querySelector("#units-heading")?.tagName).toBe("H2");
    expect(list).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain("Weather");
    expect(window.location.hash).toBe("#units");
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "units" });
  });

  test("Curriculum opens directly on the catalog with no Browse | My Units switch", () => {
    const { seam } = seamWith([]);
    const root = mount({ teacherUnits: seam });
    click(root, "nav-curriculum");
    expect(activeSurface(root)).toBe("curriculum");
    expect(q(root, "curriculum-view-switch")).toBeNull();
    expect(q(root, "curriculum-grid")).not.toBeNull();
    expect(q(root, "units-panel")).toBeNull();
    expect(root.textContent).not.toContain("Browse");
  });

  test("closed (no seam): no My Units item, and every My Units history entry is refused or falls back", () => {
    const root = mount();
    expect(navLabels(root)).toEqual(["Classes", "Curriculum", "Settings"]);
    expect(q(root, "nav-units")).toBeNull();
    popstate({ kind: "shell-surface", surface: "units" });
    popstate({ kind: "shell-units-archived", surface: "units" });
    expect(activeSurface(root)).toBe("classes");
    // The legacy Curriculum-tab entry keeps its old fail-closed meaning.
    popstate({ kind: "shell-curriculum-units", surface: "curriculum" });
    expect(activeSurface(root)).toBe("curriculum");
    expect(q(root, "units-panel")).toBeNull();
  });
});

describe("history and deep links", () => {
  test("Back and Forward move between Curriculum and My Units without pushing", async () => {
    const { seam } = seamWith([]);
    const root = mount({ teacherUnits: seam });
    click(root, "nav-curriculum");
    click(root, "nav-units");
    await flush();
    const push = jest.spyOn(window.history, "pushState");
    popstate({ kind: "shell-surface", surface: "curriculum" });
    expect(activeSurface(root)).toBe("curriculum");
    popstate({ kind: "shell-surface", surface: "units" });
    expect(activeSurface(root)).toBe("units");
    expect(q(root, "units-panel")).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  test("a legacy #curriculum/units entry restores My Units", () => {
    const { seam } = seamWith([]);
    const root = mount({ teacherUnits: seam });
    popstate({ kind: "shell-curriculum-units", surface: "curriculum" });
    expect(activeSurface(root)).toBe("units");
    expect(q(root, "units-panel")).not.toBeNull();
  });

  test("selecting My Units again does not grow history", async () => {
    const { seam } = seamWith([]);
    const root = mount({ teacherUnits: seam });
    click(root, "nav-units");
    await flush();
    const push = jest.spyOn(window.history, "pushState");
    click(root, "nav-units");
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });
});

describe("Settings > Units: archived units", () => {
  const archived = () => unit({ title: "Old Unit", status: "archived", archivedAtMillis: 5, revision: 2 });

  test("the Units tab exists only when My Units is enabled", () => {
    const closed = mount();
    click(closed, "nav-settings");
    expect(q(closed, "settings-tab-units")).toBeNull();
    const { seam } = seamWith([]);
    const open = mount({ teacherUnits: seam });
    click(open, "nav-settings");
    expect(q(open, "settings-tab-units")?.textContent).toBe("Units");
  });

  test("View archived units opens My Units on its archived view with one history entry; Back and Forward restore it", async () => {
    const old = archived();
    const { seam, list } = seamWith([unit({ title: "Live" }), old]);
    const root = mount({ teacherUnits: seam });
    click(root, "nav-settings");
    click(root, "settings-tab-units");
    expect(q(root, "settings-panel-units")?.textContent).toContain("Archived units");
    const push = jest.spyOn(window.history, "pushState");
    click(root, "settings-units-view-archived");
    await flush();
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
    expect(activeSurface(root)).toBe("units");
    expect(window.location.hash).toBe("#units/archived");
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ includeArchived: true }));
    expect((q(root, "units-archived-view") as HTMLElement).hidden).toBe(false);
    expect(q(root, `units-card-${old.unitId}`)?.textContent).toContain("Archived");
    // Restoration stays where it was: the archived card's own Restore.
    expect(q(root, `units-restore-${old.unitId}`)).not.toBeNull();

    popstate({ kind: "shell-surface", surface: "settings" });
    expect(activeSurface(root)).toBe("settings");
    popstate({ kind: "shell-units-archived", surface: "units" });
    await flush();
    expect(activeSurface(root)).toBe("units");
    expect((q(root, "units-archived-view") as HTMLElement).hidden).toBe(false);
  });

  test("leaving the archived view pushes My Units; Back returns to the archived view in place", async () => {
    const { seam } = seamWith([archived()]);
    const root = mount({ teacherUnits: seam });
    click(root, "nav-settings");
    click(root, "settings-tab-units");
    click(root, "settings-units-view-archived");
    await flush();
    click(root, "units-archived-exit");
    await flush();
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "units" });
    expect((q(root, "units-archived-view") as HTMLElement).hidden).toBe(true);
    const panel = q(root, "units-panel");
    popstate({ kind: "shell-units-archived", surface: "units" });
    await flush();
    expect(q(root, "units-panel")).toBe(panel);
    expect((q(root, "units-archived-view") as HTMLElement).hidden).toBe(false);
    popstate({ kind: "shell-surface", surface: "units" });
    await flush();
    expect((q(root, "units-archived-view") as HTMLElement).hidden).toBe(true);
  });

  test("selecting My Units from its archived view returns to the active units", async () => {
    const { seam } = seamWith([archived()]);
    const root = mount({ teacherUnits: seam });
    click(root, "nav-settings");
    click(root, "settings-tab-units");
    click(root, "settings-units-view-archived");
    await flush();
    click(root, "nav-units");
    await flush();
    expect((q(root, "units-archived-view") as HTMLElement).hidden).toBe(true);
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "units" });
  });
});

describe("grade selection", () => {
  test("My Units opens on the Curriculum grade filter, and keeps its own grade after leaving", async () => {
    const { seam, created } = seamWith([]);
    const root = mount({ teacherUnits: seam });
    click(root, "nav-curriculum");
    click(root, "filter-grade-7");
    click(root, "nav-units");
    await flush();
    // Milestone 2B: Curriculum creates its own controller (unit-name pills)
    // first, so the My Units controller is the latest one.
    expect(created[created.length - 1].initialGrade).toBe("7");
    expect(q(root, "units-grade-7")?.getAttribute("aria-pressed")).toBe("true");
    click(root, "units-grade-8");
    await flush();
    click(root, "nav-classes");
    click(root, "nav-units");
    await flush();
    expect(created[created.length - 1].initialGrade).toBe("8");
    expect(q(root, "units-grade-8")?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("fresh-load deep links (Milestone 1A)", () => {
  // Every surface the outlet ever showed during the mount, so a refused
  // destination is proven never to have painted.
  const mountFresh = (hash: string, overrides: Partial<ShellDeps> = {}) => {
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      const s = document.querySelector("[data-testid=workspace-outlet]")?.getAttribute("data-active-surface");
      if (s && seen[seen.length - 1] !== s) seen.push(s);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    const root = mount({ initialState: parseShellHash(hash), ...overrides });
    observer.takeRecords();
    observer.disconnect();
    const first = activeSurface(root);
    if (first && seen[seen.length - 1] !== first) seen.push(first);
    return { root, seen };
  };

  test("#units opens My Units directly, keeps the hash, and Back/Forward still work", async () => {
    const { seam } = seamWith([unit({ title: "Weather" })]);
    const { root, seen } = mountFresh("#units", { teacherUnits: seam });
    await flush();
    expect(seen).toEqual(["units"]);
    expect(q(root, "units-panel")).not.toBeNull();
    expect(q(root, "nav-units")?.getAttribute("aria-current")).toBe("page");
    expect(window.location.hash).toBe("#units");
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "units" });
    click(root, "nav-curriculum");
    popstate({ kind: "shell-surface", surface: "units" });
    expect(activeSurface(root)).toBe("units");
    popstate({ kind: "shell-surface", surface: "curriculum" });
    expect(activeSurface(root)).toBe("curriculum");
  });

  test("#units/archived opens the archived view", async () => {
    const old = unit({ title: "Old", status: "archived", archivedAtMillis: 3, revision: 2 });
    const { seam, list } = seamWith([old]);
    const { root } = mountFresh("#units/archived", { teacherUnits: seam });
    await flush();
    expect(activeSurface(root)).toBe("units");
    expect((q(root, "units-archived-view") as HTMLElement).hidden).toBe(false);
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ includeArchived: true }));
    expect(q(root, `units-restore-${old.unitId}`)).not.toBeNull();
    expect(window.location.hash).toBe("#units/archived");
    // Back to the active view from history, in place.
    popstate({ kind: "shell-surface", surface: "units" });
    await flush();
    expect((q(root, "units-archived-view") as HTMLElement).hidden).toBe(true);
  });

  test("legacy #curriculum/units opens My Units when available, Curriculum otherwise", () => {
    const { seam } = seamWith([]);
    expect(activeSurface(mountFresh("#curriculum/units", { teacherUnits: seam }).root)).toBe("units");
    expect(window.location.hash).toBe("#units");
    document.body.textContent = "";
    const closed = mountFresh("#curriculum/units");
    expect(closed.seen).toEqual(["curriculum"]);
    expect(q(closed.root, "units-panel")).toBeNull();
  });

  test("unavailable (closed, no seam): #units and #units/archived land on Classes and never paint My Units", () => {
    for (const hash of ["#units", "#units/archived"]) {
      document.body.textContent = "";
      const { root, seen } = mountFresh(hash);
      expect(seen).toEqual(["classes"]);
      expect(q(root, "units-panel")).toBeNull();
      expect(q(root, "nav-units")).toBeNull();
      expect(window.location.hash).toBe("#classes");
    }
  });

  test("Curriculum and Settings deep links; unknown or class-scoped hashes fall back safely", () => {
    const { seam } = seamWith([]);
    expect(activeSurface(mountFresh("#curriculum", { teacherUnits: seam }).root)).toBe("curriculum");
    document.body.textContent = "";
    const settings = mountFresh("#settings", { teacherUnits: seam }).root;
    expect(activeSurface(settings)).toBe("settings");
    document.body.textContent = "";
    // No integrations dependency here: Manage connection cannot open, so Settings.
    mountFresh("#settings/integrations");
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "settings" });
    document.body.textContent = "";
    expect(activeSurface(mountFresh("#classes/roster/c1").root)).toBe("classes");
    document.body.textContent = "";
    expect(activeSurface(mountFresh("#nonsense").root)).toBe("classes");
  });

  test("a normal launch without a hash keeps the Classes default", () => {
    const { seam, created } = seamWith([]);
    const { root, seen } = mountFresh("", { teacherUnits: seam });
    expect(seen).toEqual(["classes"]);
    expect(window.location.hash).toBe("#classes");
    expect(created).toHaveLength(0);
    expect(q(root, "units-panel")).toBeNull();
  });

  test("parseShellHash is strict", () => {
    expect(parseShellHash("#units")).toEqual({ kind: "shell-surface", surface: "units" });
    expect(parseShellHash("#units/archived")).toEqual({ kind: "shell-units-archived", surface: "units" });
    expect(parseShellHash("#curriculum/investigations")).toEqual({ kind: "shell-curriculum-tab", surface: "curriculum", tab: "investigations" });
    expect(parseShellHash("#curriculum/summary/what-is-life")).toEqual({ kind: "shell-lesson-summary", surface: "curriculum", lessonSlug: "what-is-life" });
    for (const bad of ["", "#", "#units/x", "#curriculum/bogus", "#curriculum/summary/", "#curriculum/summary/%E0%A4%A", "#admin"]) {
      expect(parseShellHash(bad)).toBeNull();
    }
  });
});

describe("automatic synchronization (no Refresh units control)", () => {
  // Reads My Units makes: the grade-scoped list reads started since `from`.
  const gradeReadsSince = (list: jest.Mock, from: number) =>
    list.mock.calls.slice(from).filter((c) => c[0]?.grade !== undefined).length;
  const R = getPlaceableResources().filter((r) => r.grade === "6")[0]!;

  test("entering reads once; rerenders and reselecting never read; returning from Curriculum reads again", async () => {
    const units = [unit({ title: "Weather" })];
    const { seam, list } = seamWith(units);
    const root = mount({ teacherUnits: seam });
    let from = list.mock.calls.length;
    click(root, "nav-units");
    await flush();
    expect(gradeReadsSince(list, from)).toBe(1);
    expect(list.mock.calls[from]![0]).toEqual({ grade: "6", includeArchived: false });

    // Same mounted view: the current grade, My Units again, expand and collapse.
    from = list.mock.calls.length;
    click(root, "units-grade-6");
    click(root, "nav-units");
    click(root, `units-toggle-${units[0]!.unitId}`);
    click(root, `units-toggle-${units[0]!.unitId}`);
    await flush();
    expect(list.mock.calls.length).toBe(from);

    // Changed elsewhere while the teacher is in Curriculum.
    units[0] = { ...units[0]!, title: "Weather (renamed)", revision: 2 };
    click(root, "nav-curriculum");
    await flush();
    from = list.mock.calls.length;
    click(root, "nav-units");
    await flush();
    expect(gradeReadsSince(list, from)).toBe(1);
    expect(root.textContent).toContain("Weather (renamed)");
  });

  test("the toolbar keeps the grade filters and Create Unit, with no Refresh units pill", async () => {
    const { seam } = seamWith([unit()]);
    const root = mount({ teacherUnits: seam });
    click(root, "nav-units");
    await flush();
    expect(q(root, "units-check-changes")).toBeNull();
    const toolbar = root.querySelector(".shell-units-toolbar") as HTMLElement;
    expect(toolbar.textContent).not.toMatch(/Refresh/);
    for (const g of ["6", "7", "8"]) expect(q(toolbar, `units-grade-${g}`)).not.toBeNull();
    expect(q(toolbar, "units-create-open")).not.toBeNull();
  });

  test("an expanded unit stays expanded after leaving and returning; entry focus is the heading", async () => {
    const a = unit({ title: "Weather" });
    const b = unit({ title: "Plants" });
    const { seam } = seamWith([a, b]);
    const root = mount({ teacherUnits: seam });
    click(root, "nav-units");
    await flush();
    click(root, `units-toggle-${a.unitId}`);
    expect(q(root, `units-toggle-${a.unitId}`)?.getAttribute("aria-expanded")).toBe("true");
    click(root, "nav-classes");
    click(root, "nav-units");
    await flush();
    expect(q(root, `units-toggle-${a.unitId}`)?.getAttribute("aria-expanded")).toBe("true");
    expect(q(root, `units-details-${a.unitId}`)?.hidden).toBe(false);
    expect(q(root, `units-toggle-${b.unitId}`)?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement?.id).toBe("units-heading");
    // Collapsing is remembered too.
    click(root, `units-toggle-${a.unitId}`);
    click(root, "nav-classes");
    click(root, "nav-units");
    await flush();
    expect(q(root, `units-toggle-${a.unitId}`)?.getAttribute("aria-expanded")).toBe("false");
  });

  test("a change still being saved when the teacher leaves is never resent or overwritten by the return read", async () => {
    const units = [unit({ title: "Weather", resourceIds: [R.id] })];
    const { seam, list, callables } = seamWith(units, true);
    let settle!: (v: unknown) => void;
    callables.setResources.mockImplementation(() => new Promise((res) => (settle = res)));
    const root = mount({ teacherUnits: seam });
    click(root, "nav-units");
    await flush();
    click(root, `units-resource-remove-${units[0]!.unitId}-${R.id}`);
    expect(callables.setResources).toHaveBeenCalledTimes(1);

    // Leave while the write is in flight, and come back before it settles.
    click(root, "nav-classes");
    const from = list.mock.calls.length;
    click(root, "nav-units");
    await flush();
    // The return read runs; it holds the older record and sends nothing.
    expect(gradeReadsSince(list, from)).toBe(1);
    expect(callables.setResources).toHaveBeenCalledTimes(1);

    // The write commits; the older read never replaces the newer record.
    const saved = { ...units[0]!, resourceIds: [], revision: 2 };
    units[0] = saved;
    settle({ unit: saved, noop: false });
    await flush();
    await flush();
    expect(q(root, `units-resource-remove-${saved.unitId}-${R.id}`)).toBeNull();
    expect(callables.setResources).toHaveBeenCalledTimes(1);
    expect(callables.update).not.toHaveBeenCalled();
  });
});
