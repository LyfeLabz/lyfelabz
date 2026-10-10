/**
 * @jest-environment jsdom
 *
 * U2.2 My Units inside Curriculum (TEACHER_UNITS.md "U2.2"): the gated
 * Browse | My Units switch, lazy controller creation, history, and the
 * panel's create, edit, conflict, archive, and recovery behavior.
 */
import * as fs from "fs";
import * as path from "path";
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import {
  renderCurriculumSurface,
  initialTeacherUnitsGrade,
  _resetCurriculumSessionStateForTest,
} from "./curriculum";
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
import {
  hashForState,
  parseShellHistoryState,
  type CurriculumHistoryController,
  type ShellHistoryState,
} from "../navigationHistory";
import { createTeacherUnitCreateAttemptStore, createAttemptStorageKey } from "../../teacherUnits/createAttemptStore";
import {
  createTeacherUnitsController,
  createTeacherUnitsSurfaceSeam,
  type TeacherUnitsController,
  type TeacherUnitsSurfaceSeam,
} from "../../teacherUnits/unitsController";
import type { TeacherUnit, TeacherUnitsCallables } from "../../teacherUnits/types";
import { CREATE_ATTEMPT_REPLAY_WINDOW_MS } from "../../teacherUnits/saveCoordination";

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacherA",
  schoolId: "schoolA",
  displayName: "Ada",
});
const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const listClasses: ListClasses = () => Promise.resolve(Object.freeze<ClassSummary[]>([]));
const flush = () => new Promise((r) => setTimeout(r, 0));
const T0 = 1_700_000_000_000;

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      get length() {
        return map.size;
      },
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
    } as unknown as Storage,
  };
}

let n = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Unit${String(++n).padStart(16, "0")}`,
  grade: "7",
  title: "Earth Systems",
  description: "Rocks and plates",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: n,
  updatedAtMillis: n,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});

function callables(over: Partial<Record<keyof TeacherUnitsCallables, jest.Mock>> = {}) {
  return {
    create: jest.fn(),
    list: jest.fn(async () => ({ units: [] as TeacherUnit[] })),
    get: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: jest.fn(),
    reorder: jest.fn(),
    ...over,
  };
}

function mountEl(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

function historySeam() {
  const pushes: ShellHistoryState[] = [];
  let controller: CurriculumHistoryController | null = null;
  return {
    pushes,
    get controller() {
      return controller as CurriculumHistoryController;
    },
    seam: {
      push: (s: ShellHistoryState) => void pushes.push(s),
      replace: () => undefined,
      registerController: (c: CurriculumHistoryController) => {
        controller = c;
      },
    },
  };
}

const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  document.body.textContent = "";
  _resetCurriculumSessionStateForTest?.();
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

describe("feature gate", () => {
  test("the entry point keeps TEACHER_UNITS_GATE_OPEN false", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../index.ts"), "utf8");
    expect(src).toMatch(/const TEACHER_UNITS_GATE_OPEN = false;/);
    expect(src).not.toMatch(/TEACHER_UNITS_GATE_OPEN = true/);
    // Every seam assignment goes through the gate.
    expect(src).toMatch(/teacherUnits = TEACHER_UNITS_GATE_OPEN\s*\?/);
  });

  test("without the seam Curriculum is unchanged: no switch, no My Units, no teacher-unit storage", () => {
    const setSpy = jest.spyOn(Storage.prototype, "setItem");
    const getSpy = jest.spyOn(Storage.prototype, "getItem");
    const mount = mountEl();
    const h = historySeam();
    renderCurriculumSurface(mount, teacher, { listClasses, curriculumHistory: h.seam });
    expect(q(mount, "curriculum-view-switch")).toBeNull();
    expect(q(mount, "curriculum-units")).toBeNull();
    expect(q(mount, "units-panel")).toBeNull();
    // Original structure: the view and summary host are direct children.
    expect(Array.from(mount.children).map((c) => c.getAttribute("data-testid"))).toEqual([
      "curriculum-view",
      "curriculum-summary-host",
    ]);
    expect(h.controller.restoreUnits()).toBe(false);
    const touched = [...setSpy.mock.calls.map((c) => c[0]), ...getSpy.mock.calls.map((c) => c[0])];
    expect(touched.some((k) => String(k).includes("teacherUnits"))).toBe(false);
    setSpy.mockRestore();
    getSpy.mockRestore();
  });
});

describe("Browse | My Units switch", () => {
  function setup(filterGrade?: "6" | "7") {
    const created: Array<{ uid: string; schoolId: string; initialGrade: string }> = [];
    const c = callables();
    const mem = memoryStorage();
    const seam: TeacherUnitsSurfaceSeam = {
      createController: (input) => {
        created.push(input);
        return createTeacherUnitsSurfaceSeam({
          callables: c as unknown as TeacherUnitsCallables,
          readFirebaseUid: () => "teacherA",
          createStore: (scope) => createTeacherUnitCreateAttemptStore(scope, () => mem.storage),
        }).createController(input);
      },
    };
    const mount = mountEl();
    const h = historySeam();
    renderCurriculumSurface(mount, teacher, { listClasses, curriculumHistory: h.seam, teacherUnits: seam });
    if (filterGrade) (q(mount, `filter-grade-${filterGrade}`) as HTMLButtonElement).click();
    return { mount, h, created, c };
  }

  test("Browse is selected and the controller is created lazily on first open", async () => {
    const { mount, created, c } = setup();
    const browse = q(mount, "curriculum-view-browse") as HTMLButtonElement;
    const units = q(mount, "curriculum-view-units") as HTMLButtonElement;
    expect(q(mount, "curriculum-view-switch")?.getAttribute("role")).toBe("tablist");
    expect(browse.getAttribute("aria-selected")).toBe("true");
    expect(units.getAttribute("aria-selected")).toBe("false");
    expect(q(mount, "curriculum-browse")?.hidden).toBe(false);
    expect(q(mount, "curriculum-units")?.hidden).toBe(true);
    expect(created).toHaveLength(0);
    expect(c.list).not.toHaveBeenCalled();
    units.click();
    await flush();
    expect(created).toHaveLength(1);
    expect(q(mount, "curriculum-browse")?.hidden).toBe(true);
    expect(q(mount, "units-panel")).not.toBeNull();
    expect(c.list).toHaveBeenCalledTimes(1);
    // Re-opening reuses the same panel.
    browse.click();
    units.click();
    expect(created).toHaveLength(1);
  });

  test("history: My Units pushes its own entry; restoreTop and restoreTab return to Browse", () => {
    const { mount, h } = setup();
    (q(mount, "curriculum-view-units") as HTMLButtonElement).click();
    expect(h.pushes).toEqual([{ kind: "shell-curriculum-units", surface: "curriculum" }]);
    expect(h.controller.restoreTop()).toBe(true);
    expect(q(mount, "curriculum-units")?.hidden).toBe(true);
    expect(h.controller.restoreUnits()).toBe(true);
    expect(q(mount, "curriculum-units")?.hidden).toBe(false);
    h.controller.restoreTab("investigations");
    expect(q(mount, "curriculum-units")?.hidden).toBe(true);
  });

  test("arrow keys move between the two view tabs", () => {
    const { mount } = setup();
    const tablist = q(mount, "curriculum-view-switch") as HTMLElement;
    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(q(mount, "curriculum-view-units")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(q(mount, "curriculum-view-units"));
    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(q(mount, "curriculum-view-browse")?.getAttribute("aria-selected")).toBe("true");
  });

  test("My Units defaults to the active Curriculum grade filter", () => {
    const { mount, created } = setup("7");
    (q(mount, "curriculum-view-units") as HTMLButtonElement).click();
    expect(created[0]).toEqual({ uid: "teacherA", schoolId: "schoolA", initialGrade: "7" });
  });

  test("grade fallback when the filter is All", () => {
    expect(initialTeacherUnitsGrade("all")).toBe("6");
    expect(initialTeacherUnitsGrade("7")).toBe("7");
    expect(initialTeacherUnitsGrade("8")).toBe("8");
  });

  test("history state shape round-trips through the strict parser", () => {
    const s: ShellHistoryState = { kind: "shell-curriculum-units", surface: "curriculum" };
    expect(parseShellHistoryState(s)).toEqual(s);
    expect(hashForState(s)).toBe("#curriculum/units");
    expect(parseShellHistoryState({ kind: "shell-curriculum-units", surface: "classes" })).toBeNull();
  });
});

describe("My Units panel", () => {
  function panel(opts: {
    c?: ReturnType<typeof callables>;
    mem?: ReturnType<typeof memoryStorage>;
    now?: () => number;
    mint?: () => string;
  } = {}) {
    const c = opts.c ?? callables();
    const mem = opts.mem ?? memoryStorage();
    const host = mountEl();
    const ctl: TeacherUnitsController = createTeacherUnitsController({
      callables: c as unknown as TeacherUnitsCallables,
      session: SCOPE,
      readCurrentContext: () => SCOPE,
      store: createTeacherUnitCreateAttemptStore(SCOPE, () => mem.storage),
      initialGrade: "7",
      now: opts.now ?? (() => T0),
      mint: opts.mint ?? (() => "key_00000001"),
    });
    const view = renderTeacherUnitsPanel(host, ctl);
    return { host, ctl, c, mem, view };
  }

  const type = (el: HTMLElement | null, value: string) => {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const submit = (form: HTMLElement | null) =>
    (form as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  test("loading, then empty state with grade controls", async () => {
    const { host } = panel();
    expect(host.textContent).toContain("Loading units...");
    await flush();
    expect(q(host, "units-list-state")?.textContent).toContain("You don't have any active Grade 7 units");
    expect(q(host, "units-grade-7")?.getAttribute("aria-pressed")).toBe("true");
    expect(q(host, "units-grade-8")).not.toBeNull();
  });

  test("list error offers Try again", async () => {
    const c = callables({ list: jest.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce({ units: [] }) });
    const { host } = panel({ c });
    await flush();
    expect(q(host, "units-list-state")?.getAttribute("role")).toBeNull();
    (q(host, "units-retry") as HTMLButtonElement).click();
    await flush();
    expect(c.list).toHaveBeenCalledTimes(2);
    expect(q(host, "units-retry")).toBeNull();
  });

  test("create: client validation, then server create, then explicit Create another", async () => {
    const created = unit({ title: "Water Cycle", description: "" });
    const c = callables({ create: jest.fn(async () => ({ unit: created, replayed: false })) });
    const { host, mem } = panel({ c });
    await flush();
    submit(q(host, "units-create-form"));
    expect(q(host, "units-create-error")?.textContent).toMatch(/Enter a unit name/);
    expect(c.create).not.toHaveBeenCalled();
    type(q(host, "units-create-title"), "  Water Cycle ");
    submit(q(host, "units-create-form"));
    await flush();
    expect(c.create).toHaveBeenCalledWith({ grade: "7", title: "Water Cycle", description: "", idempotencyKey: "key_00000001" });
    expect(q(host, "units-created")?.textContent).toContain('Created "Water Cycle"');
    expect(q(host, `units-card-${created.unitId}`)).not.toBeNull();
    expect(mem.map.size).toBe(0);
    expect((q(host, "units-create-form") as HTMLFormElement).hidden).toBe(true);
    (q(host, "units-create-another") as HTMLButtonElement).click();
    expect((q(host, "units-create-form") as HTMLFormElement).hidden).toBe(false);
    expect((q(host, "units-create-title") as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(q(host, "units-create-title"));
  });

  test("an interrupted create shows recovery with Check again (same key) and keeps the form locked", async () => {
    const mem = memoryStorage();
    createTeacherUnitCreateAttemptStore(SCOPE, () => mem.storage).save(
      { key: "key_ORIGINAL", payload: { grade: "7", title: "Earth", description: "" }, context: SCOPE, status: "inFlight", reason: null, createdAtMs: T0 },
    );
    const created = unit({ title: "Earth" });
    const c = callables({ create: jest.fn(async () => ({ unit: created, replayed: true })) });
    const { host } = panel({ c, mem, mint: () => "key_NEVER" });
    await flush();
    const rec = q(host, "units-recovery") as HTMLElement;
    expect(rec.hidden).toBe(false);
    expect(rec.textContent).toContain("couldn't confirm whether this unit was created");
    expect((q(host, "units-create-submit") as HTMLButtonElement).disabled).toBe(true);
    (q(host, "units-recovery-reconcile-key_ORIGINAL") as HTMLButtonElement).click();
    await flush();
    expect(c.create).toHaveBeenCalledWith({ grade: "7", title: "Earth", description: "", idempotencyKey: "key_ORIGINAL" });
    expect(rec.hidden).toBe(true);
    expect(mem.map.has(createAttemptStorageKey(SCOPE, "key_ORIGINAL"))).toBe(false);
    expect(q(host, "units-status")?.textContent).toBe('Confirmed: "Earth" was created.');
  });

  test("an expired attempt hides Check again and enables Set aside only after Check my units", async () => {
    const mem = memoryStorage();
    createTeacherUnitCreateAttemptStore(SCOPE, () => mem.storage).save(
      { key: "key_ORIGINAL", payload: { grade: "7", title: "Earth", description: "" }, context: SCOPE, status: "unresolved", reason: "uncertain", createdAtMs: T0 },
    );
    const c = callables();
    const { host } = panel({ c, mem, now: () => T0 + CREATE_ATTEMPT_REPLAY_WINDOW_MS + 1 });
    await flush();
    expect(q(host, "units-recovery-reconcile-key_ORIGINAL")).toBeNull();
    expect(q(host, "units-recovery")?.textContent).toContain("too old to check again safely");
    expect((q(host, "units-recovery-abandon-key_ORIGINAL") as HTMLButtonElement).disabled).toBe(true);
    (q(host, "units-recovery-check") as HTMLButtonElement).click();
    await flush();
    expect(q(host, "units-recovery")?.textContent).toContain('No Grade 7 unit named "Earth" was found');
    (q(host, "units-recovery-abandon-key_ORIGINAL") as HTMLButtonElement).click();
    expect(q(host, "units-recovery")?.textContent).toContain("may already have been created");
    (q(host, "units-recovery-dismiss-key_ORIGINAL") as HTMLButtonElement).click();
    expect(q(host, "units-recovery")?.hidden).toBe(true);
    expect((q(host, "units-create-submit") as HTMLButtonElement).disabled).toBe(false);
    expect(c.create).not.toHaveBeenCalled();
  });

  test("edit conflict keeps the teacher's draft, shows the current version, and saves again deliberately", async () => {
    const u = unit({ revision: 2 });
    const theirs = { ...u, title: "Their Title", revision: 3 };
    const update = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("x"), { code: "already-exists", details: { code: "teacherUnits.writeConflict", currentRevision: 3 } }))
      .mockResolvedValueOnce({ unit: { ...theirs, title: "My Title", revision: 4 }, noop: false });
    const c = callables({ list: jest.fn(async () => ({ units: [u] })), update, get: jest.fn(async () => ({ unit: theirs })) });
    const { host } = panel({ c });
    await flush();
    (q(host, `units-edit-${u.unitId}`) as HTMLButtonElement).click();
    const title = q(host, `units-edit-title-${u.unitId}`) as HTMLInputElement;
    expect(document.activeElement).toBe(title);
    type(title, "My Title");
    submit(title.form);
    await flush();
    await flush();
    const card = q(host, `units-card-${u.unitId}`) as HTMLElement;
    expect(card.textContent).toContain('current name is "Their Title"');
    // The very same input element, still holding the draft.
    expect(q(host, `units-edit-title-${u.unitId}`)).toBe(title);
    expect(title.value).toBe("My Title");
    expect(update).toHaveBeenCalledTimes(1);
    submit(title.form);
    await flush();
    expect(update).toHaveBeenLastCalledWith({ unitId: u.unitId, expectedRevision: 3, title: "My Title" });
    expect(q(host, "units-status")?.textContent).toContain('Saved: "My Title"');
    expect(q(host, `units-edit-title-${u.unitId}`)).toBeNull();
  });

  test("archive and restore with the archived toggle", async () => {
    const u = unit();
    const archived = { ...u, status: "archived" as const, revision: 2, archivedAtMillis: 9 };
    const restored = { ...u, revision: 3 };
    const c = callables({
      list: jest.fn(async (req: { includeArchived?: boolean }) => ({ units: req.includeArchived ? [archived] : [u] })),
      archive: jest.fn(async () => ({ unit: archived, noop: false })),
      restore: jest.fn(async () => ({ unit: restored, noop: false })),
    });
    const { host } = panel({ c });
    await flush();
    (q(host, `units-archive-${u.unitId}`) as HTMLButtonElement).click();
    await flush();
    expect(q(host, `units-card-${u.unitId}`)).toBeNull();
    expect(q(host, "units-status")?.textContent).toContain("Archived");
    const toggle = q(host, "units-show-archived") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await flush();
    expect(q(host, `units-card-${u.unitId}`)?.textContent).toContain("Archived");
    expect(q(host, `units-edit-${u.unitId}`)).toBeNull();
    (q(host, `units-restore-${u.unitId}`) as HTMLButtonElement).click();
    await flush();
    expect(c.restore).toHaveBeenCalledWith({ unitId: u.unitId, expectedRevision: 2 });
    expect(q(host, `units-edit-${u.unitId}`)).not.toBeNull();
  });

  test("a detached panel disposes its controller on the next late update", async () => {
    let resolve!: (v: { units: TeacherUnit[] }) => void;
    const c = callables({ list: jest.fn(() => new Promise((r) => (resolve = r))) });
    const mem = memoryStorage();
    const host = mountEl();
    const inner = createTeacherUnitsController({
      callables: c as unknown as TeacherUnitsCallables,
      session: SCOPE,
      readCurrentContext: () => SCOPE,
      store: createTeacherUnitCreateAttemptStore(SCOPE, () => mem.storage),
      initialGrade: "7",
    });
    const dispose = jest.fn(() => inner.dispose());
    const ctl: TeacherUnitsController = { ...inner, dispose };
    renderTeacherUnitsPanel(host, ctl);
    host.remove();
    ctl.setShowArchived(true);
    resolve({ units: [unit()] });
    await flush();
    expect(dispose).toHaveBeenCalled();
  });

  test("create success is announced and focus moves to Create another unit", async () => {
    const created = unit({ title: "Water Cycle" });
    const c = callables({ create: jest.fn(async () => ({ unit: created, replayed: false })) });
    const { host } = panel({ c });
    await flush();
    const title = q(host, "units-create-title") as HTMLInputElement;
    title.focus();
    type(title, "Water Cycle");
    submit(q(host, "units-create-form"));
    await flush();
    expect(q(host, "units-status")?.textContent).toBe('Created "Water Cycle" in Grade 7.');
    expect(q(host, "units-status")?.getAttribute("aria-live")).toBe("polite");
    expect(document.activeElement).toBe(q(host, "units-create-another"));
    // The confirmation element is long-lived: rerenders keep focus on it.
    await (q(host, "units-show-archived") as HTMLInputElement, flush());
    expect(document.activeElement).toBe(q(host, "units-create-another"));
  });

  test("an uncertain create moves focus to Check again and announces it", async () => {
    const c = callables({ create: jest.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "unavailable" })) });
    const { host } = panel({ c });
    await flush();
    type(q(host, "units-create-title"), "Water");
    submit(q(host, "units-create-form"));
    await flush();
    expect(document.activeElement).toBe(q(host, "units-recovery-reconcile-key_00000001"));
    expect(q(host, "units-status")?.textContent).toContain("couldn't confirm");
  });

  test("two unconfirmed attempts are listed and resolved independently", async () => {
    const mem = memoryStorage();
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => mem.storage);
    const base = { context: SCOPE, status: "unresolved" as const, reason: "uncertain" as const, createdAtMs: T0 };
    store.save({ ...base, key: "key_TABAAAAA", payload: { grade: "7", title: "From A", description: "" } });
    store.save({ ...base, key: "key_TABBBBBB", payload: { grade: "7", title: "From B", description: "" } });
    const uA = unit({ title: "From A" });
    const c = callables({ create: jest.fn(async () => ({ unit: uA, replayed: true })) });
    const { host } = panel({ c, mem });
    await flush();
    expect(q(host, "units-recovery")?.textContent).toContain("2 unit requests weren't confirmed.");
    expect(q(host, "units-recovery-item-key_TABAAAAA")).not.toBeNull();
    expect(q(host, "units-recovery-item-key_TABBBBBB")).not.toBeNull();
    const again = q(host, "units-recovery-reconcile-key_TABAAAAA") as HTMLButtonElement;
    again.focus();
    again.click();
    await flush();
    expect(c.create).toHaveBeenCalledWith({ grade: "7", title: "From A", description: "", idempotencyKey: "key_TABAAAAA" });
    expect(q(host, "units-recovery-item-key_TABAAAAA")).toBeNull();
    expect(q(host, "units-recovery-item-key_TABBBBBB")).not.toBeNull();
    // Focus does not fall to the body when the clicked control disappears.
    expect(document.activeElement).toBe(q(host, "units-recovery-check"));
    expect((q(host, "units-create-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  test("archive conflict keeps the unsaved draft, even when archived units are hidden, and restore re-enables Save", async () => {
    const u = unit({ revision: 1 });
    const archived = { ...u, status: "archived" as const, revision: 2, archivedAtMillis: 9 };
    const restoredUnit = { ...u, revision: 3 };
    const update = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("x"), { code: "already-exists", details: { code: "teacherUnits.writeConflict", currentRevision: 2 } }))
      .mockResolvedValueOnce({ unit: { ...restoredUnit, title: "My Draft", revision: 4 }, noop: false });
    const c = callables({
      list: jest.fn(async () => ({ units: [u] })),
      update,
      get: jest.fn(async () => ({ unit: archived })),
      restore: jest.fn(async () => ({ unit: restoredUnit, noop: false })),
    });
    const { host } = panel({ c });
    await flush();
    (q(host, `units-edit-${u.unitId}`) as HTMLButtonElement).click();
    const title = q(host, `units-edit-title-${u.unitId}`) as HTMLInputElement;
    const desc = q(host, `units-edit-description-${u.unitId}`) as HTMLTextAreaElement;
    type(title, "My Draft");
    type(desc, "My notes");
    submit(title.form);
    await flush();
    await flush();
    // The archived unit left the active list, but its editor and draft remain.
    const card = q(host, `units-card-${u.unitId}`) as HTMLElement;
    expect(card).not.toBeNull();
    expect(q(host, `units-edit-title-${u.unitId}`)).toBe(title);
    expect(title.value).toBe("My Draft");
    expect(desc.value).toBe("My notes");
    expect(card.textContent).toContain("archived somewhere else, so your changes weren't saved");
    expect((q(host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).disabled).toBe(true);
    (q(host, `units-editor-restore-${u.unitId}`) as HTMLButtonElement).click();
    await flush();
    expect(c.restore).toHaveBeenCalledWith({ unitId: u.unitId, expectedRevision: 2 });
    expect((q(host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).disabled).toBe(false);
    expect(title.value).toBe("My Draft");
    expect(document.activeElement).toBe(title);
    submit(title.form);
    await flush();
    expect(update).toHaveBeenLastCalledWith({ unitId: u.unitId, expectedRevision: 3, title: "My Draft", description: "My notes" });
  });

  test("hidden panel elements are not displayed even though their classes set display", async () => {
    const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
    const css = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
      .map((m) => m[1])
      .join("\n");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    try {
      const created = unit({ title: "Water Cycle" });
      const c = callables({ create: jest.fn(async () => ({ unit: created, replayed: false })) });
      const { host } = panel({ c });
      await flush();
      const form = q(host, "units-create-form") as HTMLElement;
      const recovery = q(host, "units-recovery") as HTMLElement;
      expect(getComputedStyle(form).display).toBe("flex");
      expect(recovery.hidden).toBe(true);
      expect(getComputedStyle(recovery).display).toBe("none");
      type(q(host, "units-create-title"), "Water Cycle");
      submit(form);
      await flush();
      expect(form.hidden).toBe(true);
      expect(getComputedStyle(form).display).toBe("none");
      expect(getComputedStyle(q(host, "units-created") as HTMLElement).display).not.toBe("none");
    } finally {
      style.remove();
    }
  });

  test("panel copy contains no em dashes", () => {
    const src = fs.readFileSync(path.join(__dirname, "teacherUnitsPanel.ts"), "utf8");
    expect(src.includes("\u2014")).toBe(false);
  });
});
