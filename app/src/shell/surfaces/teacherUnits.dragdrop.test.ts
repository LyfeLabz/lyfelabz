/**
 * @jest-environment jsdom
 *
 * Milestone 2B: drag-and-drop resource ordering inside one My Units unit.
 * The six-dot handle replaces Move up / Move down. Pointer (mouse, pen,
 * touch) and keyboard moves both end in one `teacherUnitsSetResources`
 * request carrying a permutation of the held list with its revision
 * (`moveResourceTo`); a drop in place sends nothing; nothing moves until the
 * server confirms; conflicts and unconfirmed writes are never resent.
 */
import * as fs from "fs";
import * as path from "path";
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import { createTeacherUnitsController } from "../../teacherUnits/unitsController";
import { getPlaceableResources } from "../../teacherUnits/placeableResources";
import type { TeacherUnit, TeacherUnitsCallables } from "../../teacherUnits/types";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};
const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const [R1, R2, R3, R4] = getPlaceableResources().filter((r) => r.grade === "7");

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

let n = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Unit${String(++n).padStart(16, "0")}`,
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

// An in-memory server with the real revision check.
async function panel(initial: TeacherUnit[]) {
  const units = new Map(initial.map((u) => [u.unitId, u]));
  const c = {
    create: jest.fn(),
    list: jest.fn(async () => ({ units: Array.from(units.values()).filter((u) => u.status === "active") })),
    get: jest.fn(async (req: { unitId: string }) => ({ unit: units.get(req.unitId)! })),
    update: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: jest.fn(async (req: { unitId: string; expectedRevision: number; resourceIds: string[] }) => {
      const u = units.get(req.unitId)!;
      if (u.revision !== req.expectedRevision) {
        throw { details: { code: "teacherUnits.writeConflict", currentRevision: u.revision } };
      }
      const next = { ...u, resourceIds: [...req.resourceIds], revision: u.revision + 1 };
      units.set(u.unitId, next);
      return { unit: next, noop: false };
    }),
    reorder: jest.fn(),
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ctl = createTeacherUnitsController({
    callables: c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: () => SCOPE,
    store: createTeacherUnitCreateAttemptStore(SCOPE, () => memoryStorage()),
    initialGrade: "7",
  });
  renderTeacherUnitsPanel(host, ctl, { unitsInitiallyExpanded: true });
  await flush();
  return { host, ctl, c, units };
}

const order = (host: HTMLElement, unitId: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="units-resource-list-${unitId}"] > li`)).map((r) =>
    r.getAttribute("data-resource-id"),
  );
const rows = (host: HTMLElement, unitId: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="units-resource-list-${unitId}"] > li`));
const handle = (host: HTMLElement, unitId: string, id: string) =>
  q(host, `units-resource-handle-${unitId}-${id}`) as HTMLButtonElement;
const status = (host: HTMLElement) => q(host, "units-status")?.textContent ?? "";
const key = (el: HTMLElement, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

// Rows are 40px tall with 10px gaps: row i spans [i*50, i*50+40].
function layOut(host: HTMLElement, unitId: string) {
  rows(host, unitId).forEach((li, i) => {
    li.getBoundingClientRect = () =>
      ({ top: i * 50, bottom: i * 50 + 40, height: 40, left: 0, right: 600, width: 600, x: 0, y: i * 50, toJSON: () => ({}) }) as DOMRect;
  });
}
function pointer(el: HTMLElement, type: string, clientY: number, extra: Record<string, unknown> = {}) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientY, clientX: 10, pointerId: 7, button: 0, isPrimary: true, pointerType: "touch", ...extra });
  el.dispatchEvent(ev);
  return ev;
}
function drag(host: HTMLElement, unitId: string, id: string, fromY: number, toY: number) {
  layOut(host, unitId);
  const h = handle(host, unitId, id);
  const down = pointer(h, "pointerdown", fromY);
  pointer(h, "pointermove", (fromY + toY) / 2);
  pointer(h, "pointermove", toY);
  return { h, down };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("pointer drag (mouse, pen, touch)", () => {
  test("dragging a handle shows the dragged row and the insertion line; release saves one permutation with the held revision", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id, R4.id], revision: 6 });
    const { host, c } = await panel([a]);
    const { h, down } = drag(host, a.unitId, R1.id, 20, 180);
    // The press never scrolls, selects text, or clicks through.
    expect(down.defaultPrevented).toBe(true);
    const lis = rows(host, a.unitId);
    expect(lis[0]!.classList.contains("shell-units-resource-dragging")).toBe(true);
    // Below every other row: the line sits after the last one.
    expect(lis[3]!.classList.contains("shell-units-drop-after")).toBe(true);
    expect(c.setResources).not.toHaveBeenCalled();
    pointer(h, "pointerup", 180);
    await flush();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    const req = c.setResources.mock.calls[0]![0];
    expect(req).toEqual({ unitId: a.unitId, expectedRevision: 6, resourceIds: [R2.id, R3.id, R4.id, R1.id] });
    // A permutation: every resource exactly once.
    expect([...req.resourceIds].sort()).toEqual([R1.id, R2.id, R3.id, R4.id].sort());
    expect(order(host, a.unitId)).toEqual([R2.id, R3.id, R4.id, R1.id]);
    expect(status(host)).toBe(`Moved "${R1.title}" to position 4 of 4.`);
    expect(host.querySelector(".shell-units-drop-after, .shell-units-drop-before, .shell-units-resource-dragging")).toBeNull();
  });

  test("dragging up to the first position puts the line before the first row", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id] });
    const { host, c } = await panel([a]);
    const { h } = drag(host, a.unitId, R3.id, 120, 5);
    expect(rows(host, a.unitId)[0]!.classList.contains("shell-units-drop-before")).toBe(true);
    pointer(h, "pointerup", 5);
    await flush();
    expect(c.setResources.mock.calls[0]![0].resourceIds).toEqual([R3.id, R1.id, R2.id]);
  });

  test("a tap, a jitter under the threshold, a drop in place, or a cancelled pointer sends nothing", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id] });
    const { host, c } = await panel([a]);
    layOut(host, a.unitId);
    const h = handle(host, a.unitId, R2.id);
    pointer(h, "pointerdown", 70);
    pointer(h, "pointerup", 70);
    pointer(h, "pointerdown", 70);
    pointer(h, "pointermove", 72);
    pointer(h, "pointerup", 72);
    const inPlace = drag(host, a.unitId, R2.id, 70, 80);
    pointer(inPlace.h, "pointerup", 80);
    expect(status(host)).toBe(`"${R2.title}" was dropped in its original position. Nothing was changed.`);
    const cancelled = drag(host, a.unitId, R2.id, 70, 170);
    pointer(cancelled.h, "pointercancel", 170);
    await flush();
    expect(c.setResources).not.toHaveBeenCalled();
    expect(order(host, a.unitId)).toEqual([R1.id, R2.id, R3.id]);
    expect(host.querySelector(".shell-units-drop-after, .shell-units-resource-dragging")).toBeNull();
  });

  test("a second drag cannot start while a save is pending", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id] });
    const { host, c } = await panel([a]);
    let release: () => void = () => {};
    const real = c.setResources.getMockImplementation()!;
    c.setResources.mockImplementationOnce((req) => new Promise((res) => { release = () => res(real(req)); }));
    const first = drag(host, a.unitId, R1.id, 20, 170);
    pointer(first.h, "pointerup", 170);
    await flush();
    expect(handle(host, a.unitId, R3.id).getAttribute("aria-disabled")).toBe("true");
    const second = drag(host, a.unitId, R3.id, 120, 5);
    pointer(second.h, "pointerup", 5);
    expect(c.setResources).toHaveBeenCalledTimes(1);
    // Nothing moves before the server confirms.
    expect(order(host, a.unitId)).toEqual([R1.id, R2.id, R3.id]);
    release();
    await flush();
    expect(order(host, a.unitId)).toEqual([R2.id, R3.id, R1.id]);
  });

  test("a slow save is shown as in progress, never as an unconfirmed change, and is confirmed only by the server", async () => {
    const a = unit({ title: "Test Unit", resourceIds: [R1.id, R2.id, R3.id] });
    const { host, c, ctl, units } = await panel([a]);
    let release: () => void = () => {};
    const real = c.setResources.getMockImplementation()!;
    c.setResources.mockImplementationOnce((req) => new Promise((res) => { release = () => res(real(req)); }));
    const pendingRegion = q(host, "units-pending")!;
    const { h } = drag(host, a.unitId, R3.id, 120, 45);
    pointer(h, "pointerup", 45);
    await flush();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    // Waiting for the response: busy handles and the in-progress status only.
    expect(status(host)).toBe(`Moving "${R3.title}" to position 2 of 3 in "Test Unit"...`);
    expect(handle(host, a.unitId, R1.id).getAttribute("aria-disabled")).toBe("true");
    expect(pendingRegion.hidden).toBe(true);
    expect(host.textContent).not.toMatch(/Unconfirmed changes|couldn't confirm|still waiting for a response/);
    expect(order(host, a.unitId)).toEqual([R1.id, R2.id, R3.id]);
    release();
    await flush();
    expect(order(host, a.unitId)).toEqual([R1.id, R3.id, R2.id]);
    expect(status(host)).toBe(`Moved "${R3.title}" to position 2 of 3.`);
    expect(pendingRegion.hidden).toBe(true);
    expect(host.textContent).not.toMatch(/Unconfirmed changes|couldn't confirm/);
    expect(handle(host, a.unitId, R1.id).getAttribute("aria-disabled")).not.toBe("true");
    // What a reload would read is the server's order.
    expect(units.get(a.unitId)!.resourceIds).toEqual([R1.id, R3.id, R2.id]);
    await ctl.refresh();
    await flush();
    expect(order(host, a.unitId)).toEqual([R1.id, R3.id, R2.id]);
  });

  test("a non-primary button does not start a drag", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const { host, c } = await panel([a]);
    layOut(host, a.unitId);
    const h = handle(host, a.unitId, R1.id);
    pointer(h, "pointerdown", 20, { button: 2 });
    pointer(h, "pointermove", 90);
    pointer(h, "pointerup", 90);
    await flush();
    expect(c.setResources).not.toHaveBeenCalled();
  });
});

describe("keyboard reordering", () => {
  test("pick up, move several positions with a live preview, drop: one request, announced at each step", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id, R4.id], revision: 2 });
    const { host, c } = await panel([a]);
    const h = handle(host, a.unitId, R1.id);
    h.focus();
    key(h, "Enter");
    expect(h.getAttribute("aria-pressed")).toBe("true");
    expect(status(host)).toBe(
      `Picked up "${R1.title}", position 1 of 4. Use the up and down arrow keys to move it, Space to drop it, or Escape to cancel.`,
    );
    key(h, "ArrowDown");
    expect(status(host)).toBe(`"${R1.title}", position 2 of 4.`);
    key(h, "End");
    expect(status(host)).toBe(`"${R1.title}", position 4 of 4.`);
    // Preview through CSS order: the focused handle never leaves the DOM.
    const preview = rows(host, a.unitId).map((li) => li.style.order);
    expect(preview).toEqual(["3", "0", "1", "2"]);
    expect(document.activeElement).toBe(h);
    expect(c.setResources).not.toHaveBeenCalled();
    key(h, "ArrowUp");
    key(h, "Enter");
    await flush();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(c.setResources.mock.calls[0]![0]).toEqual({
      unitId: a.unitId,
      expectedRevision: 2,
      resourceIds: [R2.id, R3.id, R1.id, R4.id],
    });
    expect(order(host, a.unitId)).toEqual([R2.id, R3.id, R1.id, R4.id]);
    expect(document.activeElement).toBe(handle(host, a.unitId, R1.id));
    expect(rows(host, a.unitId).every((li) => li.style.order === "")).toBe(true);
  });

  test("Escape and leaving the handle cancel without a request and restore the order", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id] });
    const { host, c } = await panel([a]);
    const h = handle(host, a.unitId, R2.id);
    h.focus();
    key(h, " ");
    key(h, "ArrowDown");
    key(h, "Escape");
    expect(status(host)).toBe(`Move cancelled. "${R2.title}" is back at position 2 of 3.`);
    expect(h.hasAttribute("aria-pressed")).toBe(false);
    expect(rows(host, a.unitId).every((li) => li.style.order === "")).toBe(true);
    key(h, " ");
    key(h, "ArrowUp");
    h.blur();
    expect(status(host)).toBe(`Move cancelled. "${R2.title}" is back at position 2 of 3.`);
    await flush();
    expect(c.setResources).not.toHaveBeenCalled();
    expect(order(host, a.unitId)).toEqual([R1.id, R2.id, R3.id]);
  });

  test("a plain click on the handle does nothing", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const { host, c } = await panel([a]);
    handle(host, a.unitId, R1.id).click();
    await flush();
    expect(c.setResources).not.toHaveBeenCalled();
    expect(status(host)).toBe("");
  });
});

describe("persistence, conflicts and failures", () => {
  test("the saved order is what the server holds, so a later read (a page refresh) shows the same order", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id] });
    const { host, ctl, units } = await panel([a]);
    const { h } = drag(host, a.unitId, R3.id, 120, 5);
    pointer(h, "pointerup", 5);
    await flush();
    expect(units.get(a.unitId)!.resourceIds).toEqual([R3.id, R1.id, R2.id]);
    await ctl.refresh();
    await flush();
    expect(order(host, a.unitId)).toEqual([R3.id, R1.id, R2.id]);
  });

  test("a unit changed elsewhere is never overwritten: the move is refused, the newer list is shown", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id], revision: 3 });
    const { host, c, units } = await panel([a]);
    units.set(a.unitId, { ...a, resourceIds: [R1.id, R2.id, R3.id], revision: 4 });
    const { h } = drag(host, a.unitId, R1.id, 20, 80);
    pointer(h, "pointerup", 80);
    await flush();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(units.get(a.unitId)!.resourceIds).toEqual([R1.id, R2.id, R3.id]);
    expect(order(host, a.unitId)).toEqual([R1.id, R2.id, R3.id]);
    expect(host.textContent).toContain("couldn't confirm whether it was moved");
    expect(status(host)).not.toMatch(/^Moved /);
  });

  test("an unconfirmed save is read once, never resent, and never shown as moved", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const { host, c } = await panel([a]);
    c.setResources.mockImplementationOnce(async () => {
      throw Object.assign(new Error("lost"), { code: "unavailable" });
    });
    const h = handle(host, a.unitId, R2.id);
    h.focus();
    key(h, " ");
    key(h, "ArrowUp");
    key(h, " ");
    await flush();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(c.get).toHaveBeenCalled();
    expect(host.textContent).toContain("LyfeLabz couldn't confirm whether your change was saved.");
    expect(status(host)).not.toMatch(/^Moved /);
  });

  test("controller: moveResourceTo is a no-op without a call for its own position, unknown ids, and out-of-range targets", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id] });
    const { ctl, c } = await panel([a]);
    for (const [id, to] of [[R2.id, 1], ["unknown", 0], [R1.id, 3], [R1.id, -1]] as const) {
      const result = await ctl.moveResourceTo(a.unitId, id, to);
      expect(result.kind).toBe("saved");
    }
    expect(c.setResources).not.toHaveBeenCalled();
  });
});

describe("styles", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  test("the handle never scrolls the page, shows a grab cursor and focus outline, and meets 44px on touch", () => {
    expect(html).toMatch(/\.shell-units-drag-handle\s*\{[^}]*cursor:\s*grab;[^}]*touch-action:\s*none;/);
    expect(html).toMatch(/\.shell-units-drag-handle:focus-visible\s*\{\s*outline:/);
    expect(html).toMatch(/\.shell-units-drag-handle\s*\{\s*width:\s*44px;\s*min-height:\s*44px;\s*\}/);
    expect(html).toMatch(/\.shell-units-drop-before::before,\s*\.shell-units-drop-after::after\s*\{[^}]*background:\s*#356b52;/);
    expect(html).not.toMatch(/\.shell-units-resource-moves/);
  });
});
