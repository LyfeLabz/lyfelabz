/**
 * U2.3 fourth certification: controller state consistency.
 *
 * An independent harness. Every callable is a manually settled deferred, so
 * each test fixes the exact dispatch and arrival order of list, get,
 * create/replay, restore, archive, and membership requests. Uses only the
 * controller's public API.
 *
 * Covers: create/replay reconciliation against list omission (P1), a
 * confirmed restore against an overlapping list (P2), and the rules the
 * state model guarantees (TEACHER_UNITS.md "State consistency model").
 */
import {
  createTeacherUnitsController,
  type TeacherUnitsController,
} from "./unitsController";
import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { getPlaceableResources } from "./placeableResources";
import type { PersistedCreateAttempt, TeacherUnitCreateContext } from "./saveCoordination";
import type { TeacherUnit, TeacherUnitsCallables } from "./types";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const FORMER = { teacherId: "teacherA", schoolId: "schoolB" };
const tick = () => new Promise((r) => setTimeout(r, 0));
const [R1] = getPlaceableResources()
  .filter((r) => r.grade === "7")
  .map((r) => r.id);

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

function memoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as unknown as Storage;
  return { map, storage };
}

let seq = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Consist${String(++seq).padStart(13, "0")}`,
  grade: "7",
  title: "Earth Systems",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: seq,
  updatedAtMillis: seq,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});
const archivedOf = (u: TeacherUnit, revision: number): TeacherUnit => ({
  ...u,
  status: "archived",
  archivedAtMillis: 99,
  revision,
});

type Call<T> = { req: Record<string, unknown>; d: Deferred<T> };
function scripted() {
  const calls = {
    list: [] as Array<Call<{ units: TeacherUnit[] }>>,
    get: [] as Array<Call<{ unit: TeacherUnit }>>,
    create: [] as Array<Call<{ unit: TeacherUnit; replayed: boolean }>>,
    restore: [] as Array<Call<{ unit: TeacherUnit; noop: boolean }>>,
    archive: [] as Array<Call<{ unit: TeacherUnit; noop: boolean }>>,
    setResources: [] as Array<Call<{ unit: TeacherUnit; noop: boolean }>>,
  };
  const queue = (k: keyof typeof calls) =>
    jest.fn((req: Record<string, unknown>) => {
      const d = deferred<unknown>();
      (calls[k] as unknown as Array<Call<unknown>>).push({ req, d });
      return d.promise;
    });
  const c = {
    create: queue("create"),
    list: queue("list"),
    get: queue("get"),
    update: jest.fn(),
    archive: queue("archive"),
    restore: queue("restore"),
    setResources: queue("setResources"),
    reorder: jest.fn(),
  };
  return { c, calls };
}

async function mount(
  initial: TeacherUnit[],
  opts: { ctx?: () => TeacherUnitCreateContext | null; storage?: Storage } = {},
) {
  const h = scripted();
  const storage = opts.storage ?? memoryStorage().storage;
  const ctl: TeacherUnitsController = createTeacherUnitsController({
    callables: h.c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: opts.ctx ?? (() => SCOPE),
    store: createTeacherUnitCreateAttemptStore(SCOPE, () => storage),
    initialGrade: "7",
  });
  h.calls.list[0].d.resolve({ units: initial });
  await tick();
  return { ...h, ctl };
}

const listedIds = (ctl: TeacherUnitsController): string[] => {
  const s = ctl.getState();
  return s.list.kind === "ready" ? s.list.units.map((u) => u.unitId) : [];
};
const listed = (ctl: TeacherUnitsController, unitId: string) => {
  const s = ctl.getState();
  return s.list.kind === "ready" ? s.list.units.find((u) => u.unitId === unitId) ?? null : null;
};
const lastList = (h: { calls: ReturnType<typeof scripted>["calls"] }) => h.calls.list[h.calls.list.length - 1];
const NETWORK = () => Object.assign(new Error("lost"), { code: "unavailable" });

const record = (scope: typeof SCOPE, key: string, title = "Earth Systems"): PersistedCreateAttempt => ({
  key,
  payload: { grade: "7", title, description: "" },
  context: scope,
  status: "inFlight",
  reason: null,
  createdAtMs: Date.now(),
});

// ---------- P1: create / replay reconciliation ----------

describe("P1: create and replay reconciliation use their dispatch identity", () => {
  // The form's own create is lost, leaving an unresolved attempt.
  async function lostCreate(h: Awaited<ReturnType<typeof mount>>) {
    void h.ctl.submitCreate({ grade: "7", title: "Earth Systems", description: "" });
    await tick();
    h.calls.create[0].d.reject(NETWORK());
    await tick();
    const own = h.ctl.getState().recoveries.find((e) => e.own);
    expect(own?.state.kind).toBe("unresolved");
    return own!.key;
  }

  test("an older replay of the form's attempt cannot resurrect a unit a newer list omitted", async () => {
    const h = await mount([]);
    const key = await lostCreate(h);
    const u = unit();
    const replay = h.ctl.reconcileCreate(key); // dispatched first
    await tick();
    void h.ctl.refresh(); // dispatched after: the unit has been archived since
    lastList(h).d.resolve({ units: [] });
    await tick();
    h.calls.create[1].d.resolve({ unit: u, replayed: true }); // older read arrives last
    await replay;
    expect(listedIds(h.ctl)).toEqual([]);
    // The attempt itself is settled truthfully.
    expect(h.ctl.getState().lastConfirmed?.unit.unitId).toBe(u.unitId);
  });

  test("an older replay of a restored (other tab / reload) attempt cannot resurrect it either", async () => {
    const { storage } = memoryStorage();
    expect(createTeacherUnitCreateAttemptStore(SCOPE, () => storage).save(record(SCOPE, "key_RESTORED1"))).toBe("saved");
    const h = await mount([], { storage });
    const u = unit();
    const replay = h.ctl.reconcileCreate("key_RESTORED1");
    await tick();
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [] });
    await tick();
    h.calls.create[0].d.resolve({ unit: u, replayed: true });
    await replay;
    expect(listedIds(h.ctl)).toEqual([]);
    expect(h.ctl.getState().recoveries).toEqual([]);
  });

  test("a replay dispatched after the omitting list is newer and is shown", async () => {
    const h = await mount([]);
    const key = await lostCreate(h);
    const u = unit();
    void h.ctl.refresh();
    const list = lastList(h);
    const replay = h.ctl.reconcileCreate(key);
    await tick();
    list.d.resolve({ units: [] });
    await tick();
    h.calls.create[1].d.resolve({ unit: u, replayed: true });
    await replay;
    expect(listedIds(h.ctl)).toEqual([u.unitId]);
  });

  test("a first create (not a replay) overlapping a list that read before it committed stays shown", async () => {
    const h = await mount([]);
    const u = unit();
    const create = h.ctl.submitCreate({ grade: "7", title: "Earth Systems", description: "" });
    await tick();
    void h.ctl.refresh(); // dispatched while the create is in flight
    const list = lastList(h);
    h.calls.create[0].d.resolve({ unit: u, replayed: false });
    await create;
    list.d.resolve({ units: [] }); // read before the create committed
    await tick();
    expect(listedIds(h.ctl)).toEqual([u.unitId]);
  });

  test("a unit hidden by a newer list reappears when a later list includes it", async () => {
    const h = await mount([]);
    const key = await lostCreate(h);
    const u = unit();
    const replay = h.ctl.reconcileCreate(key);
    await tick();
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [] });
    await tick();
    h.calls.create[1].d.resolve({ unit: u, replayed: true });
    await replay;
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [{ ...u, revision: 3 }] });
    await tick();
    expect(listed(h.ctl, u.unitId)?.revision).toBe(3);
  });

  test("no replay is sent after a school change; durable and former-school records stay intact", async () => {
    const { storage, map } = memoryStorage();
    expect(createTeacherUnitCreateAttemptStore(SCOPE, () => storage).save(record(SCOPE, "key_RESTORED2"))).toBe("saved");
    expect(createTeacherUnitCreateAttemptStore(FORMER, () => storage).save(record(FORMER, "key_FORMER01", "Plants"))).toBe("saved");
    let ctx: TeacherUnitCreateContext | null = SCOPE;
    const h = await mount([], { storage, ctx: () => ctx });
    const before = new Map(map);
    expect(h.ctl.getState().formerSchool).toMatchObject({ kind: "ok", attempts: [{ title: "Plants" }] });
    ctx = FORMER;
    await h.ctl.reconcileCreate("key_RESTORED2");
    expect(h.c.create).not.toHaveBeenCalled();
    expect(new Map(map)).toEqual(before);
  });
});

// ---------- P2: restore versus an overlapping list ----------

describe("P2: a confirmed restore against lists that overlap it", () => {
  async function archivedUnit() {
    const a = archivedOf(unit(), 2);
    const h = await mount([]);
    h.ctl.setShowArchived(true);
    lastList(h).d.resolve({ units: [a] });
    await tick();
    h.ctl.setShowArchived(false);
    lastList(h).d.resolve({ units: [] });
    await tick();
    expect(h.ctl.getKnownUnit(a.unitId)?.status).toBe("archived");
    return { h, a, restored: { ...a, status: "active" as const, archivedAtMillis: null, revision: 3 } };
  }

  test("a list dispatched during Restore, read before it committed, arriving after confirmation does not hide it", async () => {
    const { h, a, restored } = await archivedUnit();
    const restore = h.ctl.restoreUnit(a.unitId);
    await tick();
    void h.ctl.refresh(); // dispatched after Restore began
    const list = lastList(h);
    h.calls.restore[0].d.resolve({ unit: restored, noop: false });
    expect((await restore).kind).toBe("saved");
    expect(h.ctl.getKnownUnit(a.unitId)?.status).toBe("active");
    list.d.resolve({ units: [] }); // snapshot from before the commit
    await tick();
    expect(listed(h.ctl, a.unitId)).toMatchObject({ status: "active", revision: 3 });
  });

  test("a list dispatched before Restore and arriving after confirmation does not hide it", async () => {
    const { h, a, restored } = await archivedUnit();
    void h.ctl.refresh();
    const list = lastList(h);
    const restore = h.ctl.restoreUnit(a.unitId);
    await tick();
    h.calls.restore[0].d.resolve({ unit: restored, noop: false });
    await restore;
    list.d.resolve({ units: [] });
    await tick();
    expect(listed(h.ctl, a.unitId)?.status).toBe("active");
  });

  test("an overlapping list arriving before the confirmation does not hide it either", async () => {
    const { h, a, restored } = await archivedUnit();
    const restore = h.ctl.restoreUnit(a.unitId);
    await tick();
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [] });
    await tick();
    h.calls.restore[0].d.resolve({ unit: restored, noop: false });
    await restore;
    expect(listed(h.ctl, a.unitId)?.status).toBe("active");
  });

  test("a list dispatched after the confirmed Restore is fresh evidence: its omission hides the unit", async () => {
    const { h, a, restored } = await archivedUnit();
    const restore = h.ctl.restoreUnit(a.unitId);
    await tick();
    h.calls.restore[0].d.resolve({ unit: restored, noop: false });
    await restore;
    void h.ctl.refresh(); // archived again elsewhere since
    lastList(h).d.resolve({ units: [] });
    await tick();
    expect(listedIds(h.ctl)).toEqual([]);
  });

  test("multiple concurrent lists around a Restore: only the latest list applies, and it overlapped", async () => {
    const { h, a, restored } = await archivedUnit();
    void h.ctl.refresh();
    const first = lastList(h);
    const restore = h.ctl.restoreUnit(a.unitId);
    await tick();
    void h.ctl.refresh();
    const second = lastList(h);
    h.calls.restore[0].d.resolve({ unit: restored, noop: false });
    await restore;
    second.d.resolve({ units: [] });
    first.d.resolve({ units: [] });
    await tick();
    expect(listed(h.ctl, a.unitId)?.status).toBe("active");
  });

  test("Restore conflict: nothing resent, the re-read is shown", async () => {
    const { h, a } = await archivedUnit();
    const restore = h.ctl.restoreUnit(a.unitId);
    await tick();
    h.calls.restore[0].d.reject({ details: { code: "teacherUnits.writeConflict" } });
    await tick();
    h.calls.get[0].d.resolve({ unit: { ...a, status: "active", archivedAtMillis: null, revision: 4 } });
    const r = await restore;
    expect(r.kind).toBe("conflict");
    expect(h.c.restore).toHaveBeenCalledTimes(1);
    expect(listed(h.ctl, a.unitId)?.revision).toBe(4);
  });

  test("Restore with an unknown outcome: an error, no retry, nothing shown as restored", async () => {
    const { h, a } = await archivedUnit();
    const restore = h.ctl.restoreUnit(a.unitId);
    await tick();
    h.calls.restore[0].d.reject(NETWORK());
    expect((await restore).kind).toBe("error");
    expect(h.c.restore).toHaveBeenCalledTimes(1);
    expect(listedIds(h.ctl)).toEqual([]);
    expect(h.ctl.getKnownUnit(a.unitId)?.status).toBe("archived");
  });

  test("Restore then Archive: the later confirmed archive wins over the restore and the overlapping list", async () => {
    const { h, a, restored } = await archivedUnit();
    const restore = h.ctl.restoreUnit(a.unitId);
    await tick();
    void h.ctl.refresh();
    const list = lastList(h);
    h.calls.restore[0].d.resolve({ unit: restored, noop: false });
    await restore;
    const archive = h.ctl.archiveUnit(a.unitId);
    await tick();
    h.calls.archive[0].d.resolve({ unit: archivedOf(restored, 4), noop: false });
    await archive;
    list.d.resolve({ units: [restored] }); // older snapshot, lower revision
    await tick();
    expect(listedIds(h.ctl)).toEqual([]);
    expect(h.ctl.getKnownUnit(a.unitId)).toMatchObject({ status: "archived", revision: 4 });
  });
});

// ---------- Guarantees kept from earlier certifications ----------

describe("state model guarantees", () => {
  test("an older single-unit re-read still cannot resurrect a unit a newer list omitted", async () => {
    const a = unit();
    const h = await mount([a]);
    const add = h.ctl.addResources(a.unitId, [R1]);
    await tick();
    h.calls.setResources[0].d.reject({ details: { code: "teacherUnits.writeConflict" } });
    await tick();
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [] });
    await tick();
    h.calls.get[0].d.resolve({ unit: { ...a, revision: 2 } });
    await add;
    expect(listedIds(h.ctl)).toEqual([]);
  });

  test("a no-op response is a read, not a write: it does not outrank a list dispatched after it", async () => {
    const a = archivedOf(unit(), 2);
    const h = await mount([]);
    h.ctl.setShowArchived(true);
    lastList(h).d.resolve({ units: [a] });
    await tick();
    h.ctl.setShowArchived(false);
    lastList(h).d.resolve({ units: [] });
    await tick();
    const restore = h.ctl.restoreUnit(a.unitId);
    await tick();
    void h.ctl.refresh();
    const list = lastList(h);
    // Already active on the server: nothing was written.
    h.calls.restore[0].d.resolve({ unit: { ...a, status: "active", archivedAtMillis: null, revision: 3 }, noop: true });
    await restore;
    list.d.resolve({ units: [] }); // dispatched after the no-op read: newer
    await tick();
    expect(listedIds(h.ctl)).toEqual([]);
  });

  test("a membership write confirmed after an overlapping list keeps the unit shown", async () => {
    const a = unit();
    const h = await mount([a]);
    const add = h.ctl.addResources(a.unitId, [R1]);
    await tick();
    void h.ctl.refresh();
    const list = lastList(h);
    h.calls.setResources[0].d.resolve({ unit: { ...a, resourceIds: [R1], revision: 2 }, noop: false });
    await add;
    list.d.resolve({ units: [a] });
    await tick();
    expect(listed(h.ctl, a.unitId)).toMatchObject({ revision: 2, resourceIds: [R1] });
  });
});
