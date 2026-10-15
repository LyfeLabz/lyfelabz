/**
 * @jest-environment jsdom
 *
 * U2.4 My Units resource ordering UI (TEACHER_UNITS.md §9.6): Move up /
 * Move down per resource row, saved immediately through
 * teacherUnitsSetResources; the row moves only on the server's response;
 * aria-disabled boundary and pending controls; focus retention; move notices
 * (historical position vs present position); conflicts, uncertainty,
 * archived and retired units.
 */
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import { createTeacherUnitsController } from "../../teacherUnits/unitsController";
import { getPlaceableResources } from "../../teacherUnits/placeableResources";
import type { TeacherUnit, TeacherUnitGrade, TeacherUnitsCallables } from "../../teacherUnits/types";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const flush = () => new Promise((r) => setTimeout(r, 0));
const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const placeable = getPlaceableResources();
const g7 = placeable.filter((r) => r.grade === "7");
const [R1, R2, R3] = g7;

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
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: n,
  updatedAtMillis: n,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});

function server(initial: TeacherUnit[]) {
  const units = new Map(initial.map((u) => [u.unitId, u]));
  const c = {
    create: jest.fn(),
    list: jest.fn(async () => ({ units: Array.from(units.values()) })),
    get: jest.fn(async ({ unitId }: { unitId: string }) => ({ unit: units.get(unitId) as TeacherUnit })),
    update: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: jest.fn(
      async (req: {
        unitId: string;
        expectedRevision: number;
        resourceIds: ReadonlyArray<string>;
      }): Promise<{ unit: TeacherUnit; noop: boolean }> => {
        const u = units.get(req.unitId) as TeacherUnit;
        if (u.revision !== req.expectedRevision) {
          throw { details: { code: "teacherUnits.writeConflict", currentRevision: u.revision } };
        }
        const next = { ...u, resourceIds: req.resourceIds.slice(), revision: u.revision + 1 };
        units.set(u.unitId, next);
        return { unit: next, noop: false };
      },
    ),
    reorder: jest.fn(),
  };
  return { units, c };
}

async function panel(initial: TeacherUnit[], grade: TeacherUnitGrade = "7") {
  const { units, c } = server(initial);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ctl = createTeacherUnitsController({
    callables: c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: () => SCOPE,
    store: createTeacherUnitCreateAttemptStore(SCOPE, () => memoryStorage()),
    initialGrade: grade,
  });
  renderTeacherUnitsPanel(host, ctl);
  await flush();
  return { host, ctl, c, units };
}

const order = (host: HTMLElement, unitId: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="units-resource-list-${unitId}"] > li`)).map((r) =>
    r.getAttribute("data-resource-id"),
  );
const mv = (host: HTMLElement, unitId: string, dir: "up" | "down", id: string) =>
  q(host, `units-resource-move-${dir}-${unitId}-${id}`) as HTMLButtonElement | null;
const status = (host: HTMLElement) => q(host, "units-status")?.textContent ?? "";
const noticeOf = (host: HTMLElement, unitId: string) =>
  q(host, `units-card-${unitId}`)?.querySelector<HTMLElement>(":scope > .shell-units-notice") ?? null;
const NETWORK = () => Object.assign(new Error("lost"), { code: "unavailable" });

beforeEach(() => {
  document.body.textContent = "";
});

describe("controls", () => {
  test("each row gets named native Move up / Move down buttons; boundaries are aria-disabled, not disabled", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id] });
    const { host } = await panel([a]);
    const up1 = mv(host, a.unitId, "up", R1.id)!;
    const down3 = mv(host, a.unitId, "down", R3.id)!;
    expect(up1.tagName).toBe("BUTTON");
    expect(up1.type).toBe("button");
    expect(up1.getAttribute("aria-label")).toBe(`Move ${R1.title} up in ${a.title}`);
    expect(mv(host, a.unitId, "down", R2.id)!.getAttribute("aria-label")).toBe(`Move ${R2.title} down in ${a.title}`);
    expect(up1.getAttribute("aria-disabled")).toBe("true");
    expect(up1.disabled).toBe(false);
    expect(down3.getAttribute("aria-disabled")).toBe("true");
    expect(mv(host, a.unitId, "up", R2.id)!.hasAttribute("aria-disabled")).toBe(false);
    // Ordered-list semantics are kept.
    expect(q(host, `units-resource-list-${a.unitId}`)!.tagName).toBe("OL");
  });

  test("activating an aria-disabled boundary control sends nothing", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const { host, c } = await panel([a]);
    mv(host, a.unitId, "up", R1.id)!.click();
    mv(host, a.unitId, "down", R2.id)!.click();
    await flush();
    expect(c.setResources).not.toHaveBeenCalled();
    expect(order(host, a.unitId)).toEqual([R1.id, R2.id]);
  });

  test("zero or one resource: no move controls", async () => {
    const a = unit({ resourceIds: [] });
    const b = unit({ resourceIds: [R1.id] });
    const { host } = await panel([a, b]);
    expect(host.querySelectorAll("[data-action=move-resource]").length).toBe(0);
  });

  test("archived unit: read-only, no move controls", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id], status: "archived", archivedAtMillis: 1 });
    const { host, ctl } = await panel([a]);
    ctl.setShowArchived(true);
    await flush();
    expect(order(host, a.unitId)).toEqual([R1.id, R2.id]);
    expect(host.querySelectorAll("[data-action=move-resource]").length).toBe(0);
  });

  test("retired resources: no move controls, the reason is stated, the repair is kept", async () => {
    const a = unit({ resourceIds: [R1.id, "retired-x", R2.id] });
    const { host, c } = await panel([a]);
    expect(host.querySelectorAll("[data-action=move-resource]").length).toBe(0);
    expect(q(host, `units-retired-${a.unitId}`)!.textContent).toContain("before adding, removing, or reordering other resources");
    expect(q(host, `units-retired-remove-${a.unitId}`)).not.toBeNull();
    expect(c.setResources).not.toHaveBeenCalled();
  });
});

describe("moving", () => {
  test("move down saves at once with the held revision; the row moves only on the response", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id], revision: 5 });
    const { host, c } = await panel([a]);
    let release: () => void = () => {};
    const real = c.setResources.getMockImplementation()!;
    c.setResources.mockImplementationOnce((req) => new Promise((res) => { release = () => res(real(req)); }));
    const btn = mv(host, a.unitId, "down", R1.id)!;
    btn.focus();
    btn.click();
    await flush();
    expect(c.setResources).toHaveBeenCalledWith({ unitId: a.unitId, expectedRevision: 5, resourceIds: [R2.id, R1.id, R3.id] });
    // Pending: order unchanged, every move control blocked but focusable, focus kept.
    expect(order(host, a.unitId)).toEqual([R1.id, R2.id, R3.id]);
    expect(status(host)).toContain(`Moving "${R1.title}" down`);
    for (const b of Array.from(host.querySelectorAll<HTMLButtonElement>("[data-action=move-resource]"))) {
      expect(b.getAttribute("aria-disabled")).toBe("true");
    }
    expect(document.activeElement).toBe(mv(host, a.unitId, "down", R1.id));
    // A click while pending sends nothing more.
    mv(host, a.unitId, "down", R1.id)!.click();
    mv(host, a.unitId, "up", R3.id)!.click();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    release();
    await flush();
    await flush();
    expect(order(host, a.unitId)).toEqual([R2.id, R1.id, R3.id]);
    expect(status(host)).toBe(`Moved "${R1.title}" to position 2 of 3.`);
    expect(document.activeElement).toBe(mv(host, a.unitId, "down", R1.id));
    expect(mv(host, a.unitId, "down", R1.id)!.hasAttribute("aria-disabled")).toBe(false);
  });

  test("sequential moves carry the updated revision", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id], revision: 2 });
    const { host, c } = await panel([a]);
    mv(host, a.unitId, "up", R3.id)!.click();
    await flush();
    await flush();
    mv(host, a.unitId, "up", R3.id)!.click();
    await flush();
    await flush();
    expect(c.setResources.mock.calls.map((x) => x[0].expectedRevision)).toEqual([2, 3]);
    expect(order(host, a.unitId)).toEqual([R3.id, R1.id, R2.id]);
    expect(status(host)).toBe(`Moved "${R3.title}" to position 1 of 3.`);
  });

  test("reaching a boundary moves focus to the opposite control of the same resource", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const { host } = await panel([a]);
    const btn = mv(host, a.unitId, "up", R2.id)!;
    btn.focus();
    btn.click();
    await flush();
    await flush();
    expect(order(host, a.unitId)).toEqual([R2.id, R1.id]);
    expect(mv(host, a.unitId, "up", R2.id)!.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(mv(host, a.unitId, "down", R2.id));
    expect(document.activeElement).not.toBe(document.body);
  });

  test("move after an add keeps the added resource", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id], revision: 1 });
    const { host, c, ctl } = await panel([a]);
    await ctl.addResources(a.unitId, [R3.id]);
    await flush();
    mv(host, a.unitId, "up", R3.id)!.click();
    await flush();
    await flush();
    expect(c.setResources).toHaveBeenLastCalledWith({ unitId: a.unitId, expectedRevision: 2, resourceIds: [R1.id, R3.id, R2.id] });
    expect(order(host, a.unitId)).toEqual([R1.id, R3.id, R2.id]);
  });
});

describe("conflicts and uncertainty", () => {
  test("a resource added elsewhere: nothing is moved, the newer list is shown, focus stays on the resource", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id], revision: 3 });
    const { host, units, c } = await panel([a]);
    units.set(a.unitId, { ...a, resourceIds: [R1.id, R2.id, R3.id], revision: 4 });
    const btn = mv(host, a.unitId, "up", R2.id)!;
    btn.focus();
    btn.click();
    await flush();
    await flush();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(order(host, a.unitId)).toEqual([R1.id, R2.id, R3.id]);
    const notice = noticeOf(host, a.unitId)?.textContent ?? "";
    expect(notice).toContain("This unit changed since it was loaded here, so LyfeLabz couldn't confirm whether it was moved.");
    expect(notice).toContain("Its current resources are shown. Review them, then try again.");
    expect(document.activeElement).toBe(mv(host, a.unitId, "up", R2.id));
  });

  test("uncertain write: re-read, not resent, reported as unconfirmed", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id], revision: 3 });
    const { host, c } = await panel([a]);
    c.setResources.mockImplementationOnce(async () => {
      throw NETWORK();
    });
    mv(host, a.unitId, "up", R2.id)!.click();
    await flush();
    await flush();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(c.get).toHaveBeenCalled();
    expect(noticeOf(host, a.unitId)?.textContent).toContain("LyfeLabz couldn't confirm whether your change was saved.");
  });

  test("authorization refusal is worded without claiming the outcome", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const { host, c } = await panel([a]);
    c.setResources.mockImplementationOnce(async () => {
      throw { code: "functions/permission-denied", details: { code: "role-forbidden" } };
    });
    mv(host, a.unitId, "up", R2.id)!.click();
    await flush();
    await flush();
    expect(noticeOf(host, a.unitId)?.textContent).toContain("couldn't confirm whether your change was saved");
  });
});

describe("historical versus present wording", () => {
  test("a later change elsewhere: the move stays historical, the present position is derived anew", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id], revision: 1 });
    const { host, units, ctl } = await panel([a]);
    mv(host, a.unitId, "down", R1.id)!.click();
    await flush();
    await flush();
    expect(status(host)).toBe(`Moved "${R1.title}" to position 2 of 3.`);
    units.set(a.unitId, { ...units.get(a.unitId)!, resourceIds: [R1.id, R3.id], revision: 3 });
    await ctl.refresh();
    await flush();
    expect(status(host)).toBe(
      `Moved "${R1.title}" to position 2 of 3. Your change was saved. "${R1.title}" is at position 1 of 2 in "${a.title}" now, after this unit changed. Its current resources are shown.`,
    );
    units.set(a.unitId, { ...units.get(a.unitId)!, resourceIds: [R3.id], revision: 4 });
    await ctl.refresh();
    await flush();
    expect(status(host)).toContain(`"${R1.title}" isn't in "${a.title}" now.`);
    expect(status(host)).toMatch(/^Moved /);
  });

  test("an unchanged re-render does not rewrite the status text", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const { host, ctl } = await panel([a]);
    mv(host, a.unitId, "down", R1.id)!.click();
    await flush();
    await flush();
    const node = q(host, "units-status")!;
    let writes = 0;
    new MutationObserver((m) => { writes += m.length; }).observe(node, { childList: true, characterData: true, subtree: true });
    await ctl.refresh();
    await flush();
    expect(writes).toBe(0);
  });
});

describe("grade transitions", () => {
  test("changing the grade filter while a move is pending neither breaks nor misplaces the result", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id], revision: 1 });
    const { host, ctl, units } = await panel([a]);
    mv(host, a.unitId, "up", R2.id)!.click();
    ctl.setGrade("6");
    await flush();
    await flush();
    expect(units.get(a.unitId)!.resourceIds).toEqual([R2.id, R1.id]);
    expect(ctl.getKnownUnit(a.unitId)?.resourceIds).toEqual([R2.id, R1.id]);
    expect(document.activeElement).not.toBe(null);
  });
});
