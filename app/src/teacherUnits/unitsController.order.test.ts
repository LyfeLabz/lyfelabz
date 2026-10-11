/**
 * U2.4 resource ordering in the My Units controller (TEACHER_UNITS.md
 * §9.6): moveResource sends a permutation of the held resourceIds with the
 * held revision through teacherUnitsSetResources. Boundaries, unknown ids
 * and short lists are no-ops without a call; archived and retired units are
 * refused before sending; conflicts adopt the authoritative record; lost
 * responses are re-read, never resent; late responses never roll back.
 */
import {
  createTeacherUnitsController,
  type TeacherUnitsController,
} from "./unitsController";
import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { getPlaceableResources } from "./placeableResources";
import type { TeacherUnit, TeacherUnitsCallables } from "./types";
import type { TeacherUnitCreateContext } from "./saveCoordination";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const flush = () => new Promise((r) => setTimeout(r, 0));

const g7 = getPlaceableResources().filter((r) => r.grade === "7");
const g6 = getPlaceableResources().filter((r) => r.grade === "6");
const [R1, R2, R3, R4] = g7.map((r) => r.id);
void g6;

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

// A minimal authoritative server for setResources / get / list.
function server(initial: TeacherUnit[]) {
  const units = new Map(initial.map((u) => [u.unitId, u]));
  const c = {
    create: jest.fn(),
    list: jest.fn(async () => ({ units: Array.from(units.values()) })),
    get: jest.fn(async ({ unitId }: { unitId: string }) => {
      const u = units.get(unitId);
      if (!u) throw { details: { code: "teacherUnits.notFound" } };
      return { unit: u };
    }),
    update: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: jest.fn(
      async (req: { unitId: string; expectedRevision: number; resourceIds: ReadonlyArray<string> }) => {
        const u = units.get(req.unitId);
        if (!u) throw { details: { code: "teacherUnits.notFound" } };
        if (u.status !== "active") throw { details: { code: "teacherUnits.invalidStatus" } };
        if (new Set(req.resourceIds).size !== req.resourceIds.length) {
          throw { details: { code: "teacherUnits.duplicateResource" } };
        }
        if (u.resourceIds.join() === req.resourceIds.join()) return { unit: u, noop: true };
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

function mount(
  c: ReturnType<typeof server>["c"],
  readCurrentContext: () => TeacherUnitCreateContext | null = () => SCOPE,
): TeacherUnitsController {
  return createTeacherUnitsController({
    callables: c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext,
    store: createTeacherUnitCreateAttemptStore(SCOPE, ((st) => () => st)(memoryStorage())),
    initialGrade: "7",
  });
}

const held = (ctl: TeacherUnitsController, unitId: string) => ctl.getKnownUnit(unitId)?.resourceIds ?? null;
const NETWORK = () => Object.assign(new Error("lost"), { code: "unavailable" });

async function ready(initial: TeacherUnit[]) {
  const s = server(initial);
  const ctl = mount(s.c);
  await flush();
  return { ...s, ctl };
}

describe("moveResource: permutation and no-ops", () => {
  test("initial order is the server order, unchanged", async () => {
    const u = unit({ resourceIds: [R3, R1, R2] });
    const { ctl } = await ready([u]);
    expect(held(ctl, u.unitId)).toEqual([R3, R1, R2]);
  });

  test("move up and move down send the full permutation with the held revision", async () => {
    const u = unit({ resourceIds: [R1, R2, R3], revision: 4 });
    const { c, ctl } = await ready([u]);
    const up = await ctl.moveResource(u.unitId, R2, "up");
    expect(c.setResources).toHaveBeenLastCalledWith({ unitId: u.unitId, expectedRevision: 4, resourceIds: [R2, R1, R3] });
    expect(up).toMatchObject({ kind: "saved", noop: false, committed: { revision: 5, previous: [R1, R2, R3], resourceIds: [R2, R1, R3] } });
    const down = await ctl.moveResource(u.unitId, R2, "down");
    expect(c.setResources).toHaveBeenLastCalledWith({ unitId: u.unitId, expectedRevision: 5, resourceIds: [R1, R2, R3] });
    expect(down).toMatchObject({ kind: "saved", committed: { revision: 6 } });
    expect(held(ctl, u.unitId)).toEqual([R1, R2, R3]);
  });

  test("membership is preserved exactly (same ids, same count)", async () => {
    const u = unit({ resourceIds: [R1, R2, R3, R4] });
    const { c, ctl } = await ready([u]);
    await ctl.moveResource(u.unitId, R4, "up");
    const sent = c.setResources.mock.calls[0][0].resourceIds;
    expect([...sent].sort()).toEqual([R1, R2, R3, R4].sort());
    expect(sent).toEqual([R1, R2, R4, R3]);
  });

  test.each([
    ["first item up", [R1, R2, R3], R1, "up"],
    ["last item down", [R1, R2, R3], R3, "down"],
    ["unknown id", [R1, R2], "not-in-unit", "up"],
    ["single resource", [R1], R1, "down"],
    ["empty unit", [], R1, "up"],
  ] as const)("%s is a no-op without a call", async (_l, ids, id, dir) => {
    const u = unit({ resourceIds: [...ids] });
    const { c, ctl } = await ready([u]);
    const r = await ctl.moveResource(u.unitId, id, dir);
    expect(r).toMatchObject({ kind: "saved", noop: true });
    expect(c.setResources).not.toHaveBeenCalled();
  });
});

describe("moveResource: refusals before sending", () => {
  test("archived unit is refused without a call", async () => {
    const u = unit({ resourceIds: [R1, R2], status: "archived", archivedAtMillis: 1 });
    const s = server([u]);
    s.c.list.mockImplementation(async () => ({ units: [u] }));
    const ctl = mount(s.c);
    ctl.setShowArchived(true);
    await flush();
    const r = await ctl.moveResource(u.unitId, R2, "up");
    expect(r.kind).toBe("archived");
    expect(s.c.setResources).not.toHaveBeenCalled();
  });

  test("a unit holding retired ids is refused without a call", async () => {
    const u = unit({ resourceIds: [R1, "retired-x", R2] });
    const { c, ctl } = await ready([u]);
    const r = await ctl.moveResource(u.unitId, R2, "up");
    expect(r).toMatchObject({ kind: "error", error: { code: "teacherUnits.resourceNotPlaceable" } });
    expect(c.setResources).not.toHaveBeenCalled();
    expect(held(ctl, u.unitId)).toEqual([R1, "retired-x", R2]);
  });

  test("never-seen unit is refused without a call", async () => {
    const { c, ctl } = await ready([]);
    const r = await ctl.moveResource("Unit9999999999999999", R1, "up");
    expect(r.kind).toBe("error");
    expect(c.setResources).not.toHaveBeenCalled();
  });
});

describe("moveResource: concurrency", () => {
  test("rapid repeated clicks: the second is busy and nothing stale is stacked", async () => {
    const u = unit({ resourceIds: [R1, R2, R3], revision: 2 });
    const { c, ctl } = await ready([u]);
    const first = ctl.moveResource(u.unitId, R3, "up");
    const second = ctl.moveResource(u.unitId, R3, "up");
    expect(ctl.getState().busyUnitIds.has(u.unitId)).toBe(true);
    expect(await second).toEqual({ kind: "busy" });
    expect(await first).toMatchObject({ kind: "saved" });
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(ctl.getState().busyUnitIds.has(u.unitId)).toBe(false);
    // The next deliberate move carries the new revision.
    await ctl.moveResource(u.unitId, R3, "up");
    expect(c.setResources).toHaveBeenLastCalledWith({ unitId: u.unitId, expectedRevision: 3, resourceIds: [R3, R1, R2] });
  });

  test("a resource added elsewhere is never dropped: the stale move conflicts and the newer record is adopted", async () => {
    const u = unit({ resourceIds: [R1, R2], revision: 3 });
    const { c, units, ctl } = await ready([u]);
    units.set(u.unitId, { ...u, resourceIds: [R1, R2, R3], revision: 4 });
    const r = await ctl.moveResource(u.unitId, R2, "up");
    expect(r).toMatchObject({ kind: "conflict", latest: { revision: 4 } });
    expect(units.get(u.unitId)?.resourceIds).toEqual([R1, R2, R3]);
    expect(held(ctl, u.unitId)).toEqual([R1, R2, R3]);
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(c.get).toHaveBeenCalledTimes(1);
  });

  test("a resource removed elsewhere: conflict, adopt, no resend", async () => {
    const u = unit({ resourceIds: [R1, R2, R3], revision: 3 });
    const { c, units, ctl } = await ready([u]);
    units.set(u.unitId, { ...u, resourceIds: [R1, R3], revision: 4 });
    const r = await ctl.moveResource(u.unitId, R3, "up");
    expect(r.kind).toBe("conflict");
    expect(held(ctl, u.unitId)).toEqual([R1, R3]);
    expect(c.setResources).toHaveBeenCalledTimes(1);
  });

  test("concurrent reorder elsewhere: conflict, the other order is adopted", async () => {
    const u = unit({ resourceIds: [R1, R2, R3], revision: 3 });
    const { units, ctl } = await ready([u]);
    units.set(u.unitId, { ...u, resourceIds: [R3, R2, R1], revision: 4 });
    const r = await ctl.moveResource(u.unitId, R1, "down");
    expect(r.kind).toBe("conflict");
    expect(held(ctl, u.unitId)).toEqual([R3, R2, R1]);
  });

  test("uncertain write: re-read once, never resent", async () => {
    const u = unit({ resourceIds: [R1, R2], revision: 3 });
    const { c, units, ctl } = await ready([u]);
    c.setResources.mockImplementationOnce(async (req) => {
      const cur = units.get(req.unitId)!;
      units.set(req.unitId, { ...cur, resourceIds: req.resourceIds.slice(), revision: cur.revision + 1 });
      throw NETWORK();
    });
    const r = await ctl.moveResource(u.unitId, R2, "up");
    expect(r).toMatchObject({ kind: "uncertain", latest: { revision: 4 } });
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(c.get).toHaveBeenCalledTimes(1);
    expect(held(ctl, u.unitId)).toEqual([R2, R1]);
  });

  test("an older list read that completes after the confirmed move does not roll it back", async () => {
    const u = unit({ resourceIds: [R1, R2], revision: 3 });
    const { c, ctl } = await ready([u]);
    let release: (v: { units: TeacherUnit[] }) => void = () => {};
    c.list.mockImplementationOnce(() => new Promise((res) => { release = res; }));
    void ctl.refresh();
    await ctl.moveResource(u.unitId, R2, "up");
    release({ units: [u] });
    await flush();
    expect(held(ctl, u.unitId)).toEqual([R2, R1]);
    expect(ctl.getKnownUnit(u.unitId)?.revision).toBe(4);
  });

  test("context change during the request: the late response is ignored", async () => {
    const u = unit({ resourceIds: [R1, R2], revision: 3 });
    const s = server([u]);
    let context: TeacherUnitCreateContext | null = SCOPE;
    const ctl = mount(s.c, () => context);
    await flush();
    const p = ctl.moveResource(u.unitId, R2, "up");
    context = { teacherId: "teacherA", schoolId: "schoolB" };
    expect(await p).toEqual({ kind: "stale" });
    expect(held(ctl, u.unitId)).toEqual([R1, R2]);
  });
});
