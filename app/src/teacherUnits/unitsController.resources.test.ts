/**
 * U2.3 resource membership in the My Units controller
 * (TEACHER_UNITS.md §9.1, §9.5): add and remove through
 * teacherUnitsSetResources with the held revision, duplicate and
 * placement guards, archived refusal, and conflict / lost-response /
 * authorization / context-change handling without blind retries.
 */
import * as fs from "fs";
import * as path from "path";
import {
  createTeacherUnitsController,
  createTeacherUnitsSurfaceSeam,
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
    store: createTeacherUnitCreateAttemptStore(SCOPE, ((st) => () => st)(memoryStorage())),
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

  test("a server placement refusal (deployed list differs) re-reads the unit and reports the refusal", async () => {
    const u = unit();
    const { c } = server([u]);
    c.setResources.mockRejectedValueOnce({
      details: { code: "teacherUnits.resourceNotPlaceable", resourceIds: [R1] },
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

// ---------- Certification remediation (U2.3 P1/P2) ----------

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const NETWORK = () => Object.assign(new Error("lost"), { code: "unavailable" });
const held = (ctl: TeacherUnitsController, unitId: string) => ctl.getKnownUnit(unitId);

describe("retired-resource repair (P1)", () => {
  test("several retired ids: one confirmed request removes all of them, keeping active order", async () => {
    const u = unit({ resourceIds: ["retired-a", R2, "retired-b", R1, "retired-c"], revision: 7 });
    const b = unit({ resourceIds: ["retired-a", R3] });
    const { c } = server([u, b]);
    const ctl = mount(c);
    await flush();
    const r = await ctl.removeRetiredResources(u.unitId);
    expect(r.kind).toBe("saved");
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(c.setResources).toHaveBeenCalledWith({ unitId: u.unitId, expectedRevision: 7, resourceIds: [R2, R1] });
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual([R2, R1]);
    // Other units are untouched.
    expect(listed(ctl, b.unitId)?.resourceIds).toEqual(["retired-a", R3]);
  });

  test("only retired ids: the unit becomes empty; no retired ids is a no-op without a call", async () => {
    const u = unit({ resourceIds: ["retired-a", "retired-b"] });
    const clean = unit({ resourceIds: [R1] });
    const { c } = server([u, clean]);
    const ctl = mount(c);
    await flush();
    await ctl.removeRetiredResources(u.unitId);
    expect(c.setResources).toHaveBeenLastCalledWith(expect.objectContaining({ resourceIds: [] }));
    expect(await ctl.removeRetiredResources(clean.unitId)).toMatchObject({ kind: "saved", noop: true });
    expect(c.setResources).toHaveBeenCalledTimes(1);
  });

  test("while retired ids remain, add and other removals are refused before sending", async () => {
    const u = unit({ resourceIds: ["retired-a", "retired-b", R1] });
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    expect((await ctl.addResources(u.unitId, [R2])).kind).toBe("error");
    expect((await ctl.removeResource(u.unitId, R1)).kind).toBe("error");
    expect((await ctl.removeResource(u.unitId, "retired-a")).kind).toBe("error");
    expect(c.setResources).not.toHaveBeenCalled();
  });

  test("a single retired id can still be removed on its own", async () => {
    const u = unit({ resourceIds: [R1, "retired-a"] });
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    await ctl.removeResource(u.unitId, "retired-a");
    expect(c.setResources).toHaveBeenCalledWith(expect.objectContaining({ resourceIds: [R1] }));
  });

  test("stale revision: conflict, re-read, never resent", async () => {
    const u = unit({ resourceIds: ["retired-a", R1, "retired-b"] });
    const { c, units } = server([u]);
    const ctl = mount(c);
    await flush();
    units.set(u.unitId, { ...u, resourceIds: ["retired-a", R1, "retired-b", R2], revision: 2 });
    const r = await ctl.removeRetiredResources(u.unitId);
    expect(r.kind).toBe("conflict");
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual(["retired-a", R1, "retired-b", R2]);
    await ctl.removeRetiredResources(u.unitId);
    expect(c.setResources).toHaveBeenLastCalledWith({ unitId: u.unitId, expectedRevision: 2, resourceIds: [R1, R2] });
  });

  test("uncertain outcome: one call, re-read, reported uncertain", async () => {
    const u = unit({ resourceIds: ["retired-a", "retired-b", R1] });
    const { c, units } = server([u]);
    c.setResources.mockImplementationOnce(async () => {
      units.set(u.unitId, { ...u, resourceIds: [R1], revision: 2 });
      throw NETWORK();
    });
    const ctl = mount(c);
    await flush();
    expect(await ctl.removeRetiredResources(u.unitId)).toMatchObject({ kind: "uncertain" });
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual([R1]);
  });

  test("archived units are refused without a call", async () => {
    const u = unit({ status: "archived", archivedAtMillis: 1, resourceIds: ["retired-a", "retired-b"] });
    const { c } = server([u]);
    const ctl = mount(c);
    ctl.setShowArchived(true);
    await flush();
    expect((await ctl.removeRetiredResources(u.unitId)).kind).toBe("archived");
    expect(c.setResources).not.toHaveBeenCalled();
  });
});

describe("out-of-order responses (P1)", () => {
  test("1. an old list response arriving after a newer one is ignored", async () => {
    const u = unit();
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    const older = deferred<{ units: TeacherUnit[] }>();
    const newer = deferred<{ units: TeacherUnit[] }>();
    c.list.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    void ctl.refresh();
    void ctl.refresh();
    newer.resolve({ units: [{ ...u, resourceIds: [R2], revision: 3 }] });
    await flush();
    older.resolve({ units: [{ ...u, resourceIds: [], revision: 1 }] });
    await flush();
    expect(listed(ctl, u.unitId)?.revision).toBe(3);
    expect(held(ctl, u.unitId)?.resourceIds).toEqual([R2]);
  });

  test("1b. a list requested before a confirmed mutation cannot roll it back", async () => {
    const u = unit();
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    const slow = deferred<{ units: TeacherUnit[] }>();
    c.list.mockReturnValueOnce(slow.promise);
    void ctl.refresh();
    expect((await ctl.addResources(u.unitId, [R1])).kind).toBe("saved");
    slow.resolve({ units: [u] }); // revision 1, before the add
    await flush();
    expect(listed(ctl, u.unitId)).toMatchObject({ revision: 2, resourceIds: [R1] });
  });

  test("1c. a list requested before a create still shows the created unit", async () => {
    const u = unit();
    const created = unit({ title: "New" });
    const { c } = server([u]);
    c.create.mockResolvedValueOnce({ unit: created, replayed: false });
    const ctl = mount(c);
    await flush();
    const slow = deferred<{ units: TeacherUnit[] }>();
    c.list.mockReturnValueOnce(slow.promise);
    void ctl.refresh();
    await ctl.submitCreate({ grade: "7", title: "New", description: "" });
    expect(c.create).toHaveBeenCalledTimes(1);
    slow.resolve({ units: [u] });
    await flush();
    expect(listed(ctl, created.unitId)).not.toBeNull();
  });

  test("2. a lost-response re-read arriving after a later successful mutation is ignored", async () => {
    const u = unit();
    const { c } = server([u]);
    const reread = deferred<{ unit: TeacherUnit }>();
    c.setResources
      .mockRejectedValueOnce(NETWORK())
      .mockResolvedValueOnce({ unit: { ...u, resourceIds: [R2], revision: 3 }, noop: false });
    c.get.mockReturnValueOnce(reread.promise);
    const ctl = mount(c);
    await flush();
    const first = ctl.addResources(u.unitId, [R1]);
    await flush();
    // The gate is free while the re-read is outstanding.
    expect((await ctl.addResources(u.unitId, [R2])).kind).toBe("saved");
    reread.resolve({ unit: { ...u, resourceIds: [R1], revision: 2 } });
    const r = await first;
    expect(r.kind).toBe("uncertain");
    expect(r.kind === "uncertain" && r.latest?.revision).toBe(3);
    expect(listed(ctl, u.unitId)).toMatchObject({ revision: 3, resourceIds: [R2] });
  });

  test("3. a conflict re-read arriving after newer state is established is ignored", async () => {
    const u = unit();
    const { c } = server([u]);
    const reread = deferred<{ unit: TeacherUnit }>();
    c.setResources.mockRejectedValueOnce({ details: { code: "teacherUnits.writeConflict", currentRevision: 4 } });
    c.get.mockReturnValueOnce(reread.promise);
    const ctl = mount(c);
    await flush();
    const pending = ctl.addResources(u.unitId, [R1]);
    await flush();
    c.list.mockResolvedValueOnce({ units: [{ ...u, resourceIds: [R3], revision: 5 }] });
    await ctl.refresh();
    reread.resolve({ unit: { ...u, resourceIds: [R2], revision: 4 } });
    const r = await pending;
    expect(r.kind).toBe("conflict");
    expect(r.kind === "conflict" && r.latest?.revision).toBe(5);
    expect(listed(ctl, u.unitId)).toMatchObject({ revision: 5, resourceIds: [R3] });
  });

  test("3b. a stale notFound re-read does not drop a unit adopted since", async () => {
    const u = unit();
    const { c } = server([u]);
    const reread = deferred<{ unit: TeacherUnit }>();
    c.setResources.mockRejectedValueOnce({ details: { code: "teacherUnits.writeConflict" } });
    c.get.mockReturnValueOnce(reread.promise);
    const ctl = mount(c);
    await flush();
    const pending = ctl.addResources(u.unitId, [R1]);
    await flush();
    c.list.mockResolvedValueOnce({ units: [{ ...u, revision: 2 }] });
    await ctl.refresh();
    reread.reject({ details: { code: "teacherUnits.notFound" } });
    await pending;
    expect(listed(ctl, u.unitId)?.revision).toBe(2);
  });

  test("4. teacher identity change during a pending add: response ignored, no further requests", async () => {
    const u = unit();
    const { c } = server([u]);
    let context: TeacherUnitCreateContext | null = SCOPE;
    const slow = deferred<{ unit: TeacherUnit; noop: boolean }>();
    c.setResources.mockReturnValueOnce(slow.promise);
    const ctl = mount(c, () => context);
    await flush();
    const pending = ctl.addResources(u.unitId, [R1]);
    context = { teacherId: "teacherB", schoolId: "schoolA" };
    slow.resolve({ unit: { ...u, resourceIds: [R1], revision: 2 }, noop: false });
    expect(await pending).toEqual({ kind: "stale" });
    expect(held(ctl, u.unitId)?.revision).toBe(1);
    await ctl.refresh();
    expect(c.list).toHaveBeenCalledTimes(1);
  });

  test("5. school change during a pending refresh: the list is not applied", async () => {
    const u = unit({ resourceIds: [R1] });
    const { c } = server([u]);
    let context: TeacherUnitCreateContext | null = SCOPE;
    const ctl = mount(c, () => context);
    await flush();
    const slow = deferred<{ units: TeacherUnit[] }>();
    c.list.mockReturnValueOnce(slow.promise);
    void ctl.refresh();
    context = { teacherId: "teacherA", schoolId: "schoolB" };
    slow.resolve({ units: [{ ...u, resourceIds: [], revision: 9 }] });
    await flush();
    expect(held(ctl, u.unitId)?.revision).toBe(1);
    expect(ctl.getState().list.kind).toBe("loading");
  });

  test("5b. school change during a conflict or lost-response re-read: nothing is adopted", async () => {
    const u = unit();
    const { c } = server([u]);
    let context: TeacherUnitCreateContext | null = SCOPE;
    const reread = deferred<{ unit: TeacherUnit }>();
    c.setResources.mockRejectedValueOnce(NETWORK());
    c.get.mockReturnValueOnce(reread.promise);
    const ctl = mount(c, () => context);
    await flush();
    const pending = ctl.addResources(u.unitId, [R1]);
    await flush();
    context = { teacherId: "teacherA", schoolId: "schoolB" };
    reread.resolve({ unit: { ...u, resourceIds: [R1], revision: 2 } });
    expect(await pending).toEqual({ kind: "stale" });
    expect(held(ctl, u.unitId)?.revision).toBe(1);
  });

  test("5c. school change during a pending remove: response ignored", async () => {
    const u = unit({ resourceIds: [R1] });
    const { c } = server([u]);
    let context: TeacherUnitCreateContext | null = SCOPE;
    const slow = deferred<{ unit: TeacherUnit; noop: boolean }>();
    c.setResources.mockReturnValueOnce(slow.promise);
    const ctl = mount(c, () => context);
    await flush();
    const pending = ctl.removeResource(u.unitId, R1);
    context = { teacherId: "teacherA", schoolId: "schoolB" };
    slow.resolve({ unit: { ...u, resourceIds: [], revision: 2 }, noop: false });
    expect(await pending).toEqual({ kind: "stale" });
    expect(held(ctl, u.unitId)?.resourceIds).toEqual([R1]);
  });

  test("6. rapid refreshes resolving out of order: only the last request applies", async () => {
    const u = unit();
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    const d = [deferred<{ units: TeacherUnit[] }>(), deferred<{ units: TeacherUnit[] }>(), deferred<{ units: TeacherUnit[] }>()];
    for (const x of d) c.list.mockReturnValueOnce(x.promise);
    void ctl.refresh();
    void ctl.refresh();
    void ctl.refresh();
    d[2].resolve({ units: [{ ...u, title: "Third", revision: 3 }] });
    await flush();
    d[0].resolve({ units: [{ ...u, title: "First", revision: 1 }] });
    d[1].resolve({ units: [{ ...u, title: "Second", revision: 2 }] });
    await flush();
    expect(listed(ctl, u.unitId)?.title).toBe("Third");
    expect(c.list).toHaveBeenCalledTimes(4);
  });

  test("7. a unit archived during an outstanding add stays archived when the add response arrives", async () => {
    const u = unit();
    const { c } = server([u]);
    const slow = deferred<{ unit: TeacherUnit; noop: boolean }>();
    c.setResources.mockReturnValueOnce(slow.promise);
    const ctl = mount(c);
    await flush();
    const pending = ctl.addResources(u.unitId, [R1]);
    c.list.mockResolvedValueOnce({
      units: [{ ...u, resourceIds: [R1], status: "archived", archivedAtMillis: 5, revision: 3 }],
    });
    ctl.setShowArchived(true);
    await flush();
    slow.resolve({ unit: { ...u, resourceIds: [R1], revision: 2 }, noop: false });
    await pending;
    expect(held(ctl, u.unitId)).toMatchObject({ status: "archived", revision: 3 });
    expect(listed(ctl, u.unitId)?.status).toBe("archived");
  });

  test("Check my units (all grades) cannot roll back a newer unit", async () => {
    const u = unit();
    const { c } = server([u]);
    const ctl = mount(c);
    await flush();
    const slow = deferred<{ units: TeacherUnit[] }>();
    c.list.mockReturnValueOnce(slow.promise);
    const check = ctl.checkRecovery();
    await ctl.addResources(u.unitId, [R1]);
    slow.resolve({ units: [u] });
    await check;
    await flush();
    expect(held(ctl, u.unitId)?.revision).toBe(2);
    expect(listed(ctl, u.unitId)?.resourceIds).toEqual([R1]);
  });
});

describe("production seam context guard (P2)", () => {
  function seam(c: ReturnType<typeof server>["c"]) {
    const live = { uid: "teacherA" as string | null, active: { uid: "teacherA", schoolId: "schoolA" } as { uid: string; schoolId: string } | null };
    const s = createTeacherUnitsSurfaceSeam({
      callables: c as unknown as TeacherUnitsCallables,
      readFirebaseUid: () => live.uid,
      readActiveTeacher: () => live.active,
      createStore: (scope) => createTeacherUnitCreateAttemptStore(scope, () => memoryStorage()),
    });
    return { live, ctl: s.createController({ uid: "teacherA", schoolId: "schoolA", initialGrade: "7" }) };
  }

  test("a school change in the canonical session stops add, remove, and refresh, and ignores late responses", async () => {
    const u = unit({ resourceIds: [R1] });
    const { c } = server([u]);
    const { live, ctl } = seam(c);
    await flush();
    const slow = deferred<{ unit: TeacherUnit; noop: boolean }>();
    c.setResources.mockReturnValueOnce(slow.promise);
    const pending = ctl.addResources(u.unitId, [R2]);
    live.active = { uid: "teacherA", schoolId: "schoolB" }; // same Firebase uid
    slow.resolve({ unit: { ...u, resourceIds: [R1, R2], revision: 2 }, noop: false });
    expect(await pending).toEqual({ kind: "stale" });
    expect(await ctl.removeResource(u.unitId, R1)).toEqual({ kind: "stale" });
    expect(await ctl.removeRetiredResources(u.unitId)).toEqual({ kind: "stale" });
    await ctl.refresh();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(c.list).toHaveBeenCalledTimes(1);
    expect(ctl.getKnownUnit(u.unitId)?.revision).toBe(1);
  });

  test("a replaced or missing canonical session (re-bootstrap, sign-out) is stale too", async () => {
    const u = unit();
    const { c } = server([u]);
    const { live, ctl } = seam(c);
    await flush();
    live.active = null;
    expect(await ctl.addResources(u.unitId, [R1])).toEqual({ kind: "stale" });
    live.active = { uid: "teacherB", schoolId: "schoolA" };
    expect(await ctl.addResources(u.unitId, [R1])).toEqual({ kind: "stale" });
    live.active = { uid: "teacherA", schoolId: "schoolA" };
    live.uid = "teacherB";
    expect(await ctl.addResources(u.unitId, [R1])).toEqual({ kind: "stale" });
    expect(c.setResources).not.toHaveBeenCalled();
  });

  test("the entry point binds the seam to the current bootstrap run's canonical teacher and school", () => {
    const src = fs.readFileSync(path.join(__dirname, "../index.ts"), "utf8");
    // Bound to the run's own session (see unitsController.recert.test.ts).
    expect(src).toMatch(/readActiveTeacher: bootstrapActiveTeacherReader\(\{\s*runToken,\s*session,/);
  });
});
