/**
 * U2.3 resource membership in the My Units controller
 * (TEACHER_UNITS.md §9.1, §9.5): add and remove through
 * teacherUnitsSetResources with the held revision, duplicate and
 * placement guards, archived refusal, and conflict / lost-response /
 * authorization / context-change handling without blind retries.
 */
import { createTeacherUnitsController, type TeacherUnitsController } from "./unitsController";
import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { getPlaceableResources } from "./placeableResources";
import type { TeacherUnit, TeacherUnitsCallables } from "./types";
import type { TeacherUnitCreateContext } from "./saveCoordination";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const flush = () => new Promise((r) => setTimeout(r, 0));

const g7 = getPlaceableResources().filter((r) => r.grade === "7");
const g6 = getPlaceableResources().filter((r) => r.grade === "6");
const [R1, R2, R3] = g7.map((r) => r.id);

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
    store: createTeacherUnitCreateAttemptStore(SCOPE, () => memoryStorage()),
    initialGrade: "7",
  });
}

const listed = (ctl: TeacherUnitsController, unitId: string) => {
  const s = ctl.getState();
  return s.list.kind === "ready" ? s.list.units.find((u) => u.unitId === unitId) ?? null : null;
};

describe("adding resources", () => {
  test("adds one resource with the held revision and adopts the server unit", async () => {
    const u = unit({ revision: 4 });
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    const r = await ctl.addResources(u.unitId, [R1]);
    expect(c.setResources).toHaveBeenCalledWith({ unitId: u.unitId, expectedRevision: 4, resourceIds: [R1] });
    expect(r.kind).toBe("saved");
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual([R1]);
    expect(listed(ctl, u.unitId)?.revision).toBe(5);
  });

  test("adds several, appended after the existing server order", async () => {
    const u = unit({ resourceIds: [R3] });
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    await ctl.addResources(u.unitId, [R1, R2]);
    expect(c.setResources).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceIds: [R3, R1, R2] }),
    );
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual([R3, R1, R2]);
  });

  test("never sends a duplicate: present ids are skipped, all-present is a no-op without a call", async () => {
    const u = unit({ resourceIds: [R1] });
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    const r = await ctl.addResources(u.unitId, [R1, R1]);
    expect(r).toMatchObject({ kind: "saved", noop: true });
    expect(c.setResources).not.toHaveBeenCalled();
    await ctl.addResources(u.unitId, [R1, R2, R2]);
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(c.setResources).toHaveBeenLastCalledWith(expect.objectContaining({ resourceIds: [R1, R2] }));
  });

  test("the same resource can be added to two units independently", async () => {
    const a = unit();
    const b = unit();
    const { c } = server([a, b]);
    const ctl = mount(c);
    await flush();
    expect((await ctl.addResources(a.unitId, [R1])).kind).toBe("saved");
    expect((await ctl.addResources(b.unitId, [R1])).kind).toBe("saved");
    expect(listed(ctl, a.unitId)?.resourceIds).toEqual([R1]);
    expect(listed(ctl, b.unitId)?.resourceIds).toEqual([R1]);
  });

  test("ids without RA-1 unitPlaceable are refused before sending", async () => {
    const u = unit();
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    for (const bad of ["lab-report-assistant", "ragebaiting", "not-a-resource"]) {
      const r = await ctl.addResources(u.unitId, [R1, bad]);
      expect(r.kind).toBe("error");
    }
    expect(c.setResources).not.toHaveBeenCalled();
  });

  test("a unit of another grade may hold a placeable resource (placement is not grade-restricted)", async () => {
    const u = unit({ grade: "7" });
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    expect((await ctl.addResources(u.unitId, [g6[0].id])).kind).toBe("saved");
  });

  test("more than the server maximum is refused before sending", async () => {
    const filler = Array.from({ length: 100 }, (_, i) => `stored-${i}`);
    const u = unit({ resourceIds: filler });
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    const r = await ctl.addResources(u.unitId, [R1]);
    expect(r.kind).toBe("error");
    expect(c.setResources).not.toHaveBeenCalled();
  });
});

describe("removing resources", () => {
  test("removes from the selected unit only, keeping the remaining server order", async () => {
    const a = unit({ resourceIds: [R1, R2, R3] });
    const b = unit({ resourceIds: [R2] });
    const { c } = server([a, b]);
    const ctl = mount(c);
    await flush();
    const r = await ctl.removeResource(a.unitId, R2);
    expect(r.kind).toBe("saved");
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(c.setResources).toHaveBeenCalledWith({ unitId: a.unitId, expectedRevision: 1, resourceIds: [R1, R3] });
    expect(listed(ctl, a.unitId)?.resourceIds).toEqual([R1, R3]);
    expect(listed(ctl, b.unitId)?.resourceIds).toEqual([R2]);
    // No other callable that could touch assignments or units ran.
    expect(c.update).not.toHaveBeenCalled();
    expect(c.archive).not.toHaveBeenCalled();
    expect(c.reorder).not.toHaveBeenCalled();
  });

  test("removing an id the held unit no longer has is a no-op without a call", async () => {
    const u = unit({ resourceIds: [R1] });
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    expect(await ctl.removeResource(u.unitId, R2)).toMatchObject({ kind: "saved", noop: true });
    expect(c.setResources).not.toHaveBeenCalled();
  });

  test("a stored id that is no longer placeable can still be removed", async () => {
    const u = unit({ resourceIds: ["retired-resource", R1] });
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    await ctl.removeResource(u.unitId, "retired-resource");
    expect(c.setResources).toHaveBeenCalledWith(expect.objectContaining({ resourceIds: [R1] }));
  });
});

describe("persistence and archived units", () => {
  test("membership persists across a controller reload (server state)", async () => {
    const u = unit();
    const { c } = server([u]);
    const first = mount(c);
    await flush();
    await first.addResources(u.unitId, [R2, R1]);
    first.dispose();
    const second = mount(c);
    await flush();
    expect(listed(second, u.unitId)?.resourceIds).toEqual([R2, R1]);
  });

  test("archived units are refused without a call and keep their membership", async () => {
    const u = unit({ status: "archived", archivedAtMillis: 5, resourceIds: [R1] });
    const { c } = server([u]);
    const ctl = mount(c);
    ctl.setShowArchived(true);
    await flush();
    expect((await ctl.addResources(u.unitId, [R2])).kind).toBe("archived");
    expect((await ctl.removeResource(u.unitId, R1)).kind).toBe("archived");
    expect(c.setResources).not.toHaveBeenCalled();
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual([R1]);
  });

  test("a unit archived elsewhere is reported as archived after the server refuses", async () => {
    const u = unit();
    const { c, units } = server([u]);
    const ctl = mount(c);
    await flush();
    units.set(u.unitId, { ...u, status: "archived", archivedAtMillis: 9, revision: 2 });
    const r = await ctl.addResources(u.unitId, [R1]);
    expect(r.kind).toBe("archived");
    expect(c.setResources).toHaveBeenCalledTimes(1);
  });
});

describe("concurrency and failures", () => {
  test("stale revision: conflict, authoritative unit adopted, never resent", async () => {
    const u = unit();
    const { c, units } = server([u]);
    const ctl = mount(c);
    await flush();
    // Another tab added R3.
    units.set(u.unitId, { ...u, resourceIds: [R3], revision: 2 });
    const r = await ctl.addResources(u.unitId, [R1]);
    expect(r.kind).toBe("conflict");
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual([R3]);
    // The next deliberate attempt carries the fresh revision and keeps R3.
    await ctl.addResources(u.unitId, [R1]);
    expect(c.setResources).toHaveBeenLastCalledWith({ unitId: u.unitId, expectedRevision: 2, resourceIds: [R3, R1] });
  });

  test("rapid repeated actions on one unit: the second is refused as busy", async () => {
    const u = unit();
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    const first = ctl.addResources(u.unitId, [R1]);
    const second = ctl.removeResource(u.unitId, R1);
    const third = ctl.addResources(u.unitId, [R2]);
    await expect(second).resolves.toMatchObject({ kind: "saved", noop: true });
    await expect(third).resolves.toEqual({ kind: "busy" });
    await first;
    expect(c.setResources).toHaveBeenCalledTimes(1);
  });

  test("lost response: one call, then a read; uncertain with the authoritative unit", async () => {
    const u = unit();
    const { c, units } = server([u]);
    c.setResources.mockImplementationOnce(async () => {
      // Committed on the server, response lost.
      units.set(u.unitId, { ...u, resourceIds: [R1], revision: 2 });
      throw Object.assign(new Error("network"), { code: "unavailable" });
    });
    const ctl = mount(c);
    await flush();
    const r = await ctl.addResources(u.unitId, [R1]);
    expect(r).toMatchObject({ kind: "uncertain" });
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(c.get).toHaveBeenCalledWith({ unitId: u.unitId });
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual([R1]);
  });

  test("malformed response is uncertain; an unreadable unit afterwards gives latest null", async () => {
    const u = unit();
    const { c } = server([u]);
    c.setResources.mockRejectedValueOnce(new Error("teacherUnitsSetResources: malformed response"));
    c.get.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "unavailable" }));
    const ctl = mount(c);
    await flush();
    expect(await ctl.addResources(u.unitId, [R1])).toMatchObject({ kind: "uncertain", latest: null });
    expect(c.setResources).toHaveBeenCalledTimes(1);
  });

  test("a placement refusal re-reads the unit and reports the refusal", async () => {
    const u = unit({ resourceIds: ["retired-resource"] });
    const { c } = server([u]);
    c.setResources.mockRejectedValueOnce({
      details: { code: "teacherUnits.resourceNotPlaceable", resourceIds: ["retired-resource"] },
    });
    const ctl = mount(c);
    await flush();
    const r = await ctl.addResources(u.unitId, [R1]);
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.error.category).toBe("resourceRejected");
    expect(c.get).toHaveBeenCalledTimes(1);
  });

  test("authorization failure is an error, not a success, and is not retried", async () => {
    const u = unit();
    const { c } = server([u]);
    c.setResources.mockRejectedValueOnce({ details: { code: "role-forbidden" } });
    const ctl = mount(c);
    await flush();
    const r = await ctl.addResources(u.unitId, [R1]);
    expect(r.kind === "error" && r.error.category).toBe("unauthorized");
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual([]);
  });

  test("teacher or school context change during the request: the late response is ignored", async () => {
    const u = unit();
    const { c } = server([u]);
    let context: TeacherUnitCreateContext | null = SCOPE;
    let release: () => void = () => undefined;
    c.setResources.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ unit: { ...u, resourceIds: [R1], revision: 2 }, noop: false });
        }),
    );
    const ctl = mount(c, () => context);
    await flush();
    const pending = ctl.addResources(u.unitId, [R1]);
    context = { teacherId: "teacherA", schoolId: "schoolB" };
    release();
    expect(await pending).toEqual({ kind: "stale" });
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual([]);
    // A request after the change is not sent at all.
    expect(await ctl.removeResource(u.unitId, R1)).toEqual({ kind: "stale" });
    expect(c.setResources).toHaveBeenCalledTimes(1);
  });
});
