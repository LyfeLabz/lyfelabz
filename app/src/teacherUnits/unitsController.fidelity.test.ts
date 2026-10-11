/**
 * U2.3 fifth certification: server-contract fidelity in the controller.
 *
 * An independent harness (manually settled deferreds) that models the real
 * server contract (platform/functions/src/teacherUnits/teacher-unit-mutation.ts):
 * a write commits at `expectedRevision + 1`, and its response is a SEPARATE
 * post-commit read that may already show later writes; reads (get, a create
 * replay, lists) observe the server at some moment between dispatch and
 * receipt, so two reads can see revisions in either order.
 *
 * Covers finding A (revision preservation under absence evidence) and
 * finding D (recovery hints describe the recovery result).
 */
import { createTeacherUnitsController, type TeacherUnitsController } from "./unitsController";
import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { getPlaceableResources } from "./placeableResources";
import type { PersistedCreateAttempt } from "./saveCoordination";
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
  unitId: `Fidel${String(++seq).padStart(15, "0")}`,
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

type Call<T> = { req: Record<string, unknown>; d: Deferred<T> };
function scripted() {
  const calls = {
    list: [] as Array<Call<{ units: TeacherUnit[] }>>,
    get: [] as Array<Call<{ unit: TeacherUnit }>>,
    create: [] as Array<Call<{ unit: TeacherUnit; replayed: boolean }>>,
    setResources: [] as Array<Call<{ unit: TeacherUnit; noop: boolean }>>,
    update: [] as Array<Call<{ unit: TeacherUnit; noop: boolean }>>,
    archive: [] as Array<Call<{ unit: TeacherUnit; noop: boolean }>>,
    restore: [] as Array<Call<{ unit: TeacherUnit; noop: boolean }>>,
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
    update: queue("update"),
    archive: queue("archive"),
    restore: queue("restore"),
    setResources: queue("setResources"),
    reorder: jest.fn(),
  };
  return { c, calls };
}

async function mount(initial: TeacherUnit[], storage: Storage = memoryStorage().storage) {
  const h = scripted();
  const ctl: TeacherUnitsController = createTeacherUnitsController({
    callables: h.c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: () => SCOPE,
    store: createTeacherUnitCreateAttemptStore(SCOPE, () => storage),
    initialGrade: "7",
  });
  h.calls.list[0].d.resolve({ units: initial });
  await tick();
  return { ...h, ctl };
}
type H = Awaited<ReturnType<typeof mount>>;
const lastList = (h: H) => h.calls.list[h.calls.list.length - 1];
const listed = (ctl: TeacherUnitsController, unitId: string) => {
  const s = ctl.getState();
  return s.list.kind === "ready" ? s.list.units.find((u) => u.unitId === unitId) ?? null : null;
};
const CONFLICT = () => ({ details: { code: "teacherUnits.writeConflict" } });
const NETWORK = () => Object.assign(new Error("lost"), { code: "unavailable" });

// A conflicting add leaves a single-unit re-read (get) outstanding.
async function pendingGet(h: H, unitId: string) {
  const add = h.ctl.addResources(unitId, [R1]);
  await tick();
  h.calls.setResources[h.calls.setResources.length - 1].d.reject(CONFLICT());
  await tick();
  return { add, get: h.calls.get[h.calls.get.length - 1] };
}

// ---------- Finding A: revision preservation ----------

describe("A: a higher-revision record survives absence evidence", () => {
  test("full-scope omission, then a delayed higher-revision get, then an older-read refresh: revision 5 is kept", async () => {
    const a = unit({ revision: 3 });
    const h = await mount([a]);
    const { add, get } = await pendingGet(h, a.unitId); // get dispatched first
    const check = h.ctl.checkRecovery(); // full scope, dispatched second
    const checkList = lastList(h);
    checkList.d.resolve({ units: [] }); // omits the unit
    await check;
    const reload = lastList(h); // automatic follow-up load, dispatched third
    get.d.resolve({ unit: { ...a, revision: 5 } }); // older request, newer server read
    await add;
    reload.d.resolve({ units: [{ ...a, revision: 4 }] }); // newer request, older server read
    await tick();
    expect(h.ctl.getKnownUnit(a.unitId)?.revision).toBe(5);
    expect(listed(h.ctl, a.unitId)?.revision).toBe(5);
    // The next mutation carries the highest revision observed.
    void h.ctl.addResources(a.unitId, [R1]);
    await tick();
    expect(h.calls.setResources[h.calls.setResources.length - 1].req.expectedRevision).toBe(5);
  });

  test("the same holds for a delayed higher-revision create replay", async () => {
    const { storage } = memoryStorage();
    const u = unit({ revision: 3 });
    const rec: PersistedCreateAttempt = {
      key: "key_FIDELITY1",
      payload: { grade: "7", title: u.title, description: "" },
      context: SCOPE,
      status: "inFlight",
      reason: null,
      createdAtMs: Date.now(),
    };
    expect(createTeacherUnitCreateAttemptStore(SCOPE, () => storage).save(rec)).toBe("saved");
    const h = await mount([u], storage);
    const replay = h.ctl.reconcileCreate("key_FIDELITY1");
    await tick();
    const check = h.ctl.checkRecovery();
    lastList(h).d.resolve({ units: [] });
    await check;
    const reload = lastList(h);
    h.calls.create[0].d.resolve({ unit: { ...u, revision: 5 }, replayed: true });
    await replay;
    reload.d.resolve({ units: [{ ...u, revision: 4 }] });
    await tick();
    expect(h.ctl.getKnownUnit(u.unitId)?.revision).toBe(5);
  });

  test("reversed: the higher-revision get arrives before the omission", async () => {
    const a = unit({ revision: 3 });
    const h = await mount([a]);
    const { add, get } = await pendingGet(h, a.unitId);
    const check = h.ctl.checkRecovery();
    const checkList = lastList(h);
    get.d.resolve({ unit: { ...a, revision: 5 } });
    await add;
    checkList.d.resolve({ units: [] });
    await check;
    lastList(h).d.resolve({ units: [{ ...a, revision: 4 }] });
    await tick();
    expect(h.ctl.getKnownUnit(a.unitId)?.revision).toBe(5);
  });

  test("absence still hides the unit until a newer read finds it; lower revisions never replace higher", async () => {
    const a = unit({ revision: 3 });
    const h = await mount([a]);
    const { add, get } = await pendingGet(h, a.unitId);
    const check = h.ctl.checkRecovery();
    lastList(h).d.resolve({ units: [] });
    await check;
    lastList(h).d.resolve({ units: [] }); // follow-up load also omits
    await tick();
    get.d.resolve({ unit: { ...a, revision: 5 } });
    await add;
    expect(listed(h.ctl, a.unitId)).toBeNull();
    // The full check said absent; the newer active-only reload says "archived or gone".
    expect(["absent", "notActive"]).toContain(h.ctl.getUnitState(a.unitId).kind);
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [{ ...a, revision: 4 }] });
    await tick();
    expect(listed(h.ctl, a.unitId)?.revision).toBe(5);
  });

  test("active-only omission keeps the higher revision and the archived distinction", async () => {
    const a = unit({ revision: 3 });
    const h = await mount([a]);
    const { add, get } = await pendingGet(h, a.unitId);
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [] }); // active-only: archived or gone
    await tick();
    get.d.resolve({ unit: { ...a, status: "archived", archivedAtMillis: 9, revision: 5 } });
    await add;
    expect(h.ctl.getKnownUnit(a.unitId)?.revision).toBe(5);
    expect(h.ctl.getUnitState(a.unitId).kind).toBe("notActive");
  });

  test("archive and restore confirmations keep revisions monotonic across a full-scope omission", async () => {
    const a = unit({ revision: 3 });
    const h = await mount([a]);
    const archive = h.ctl.archiveUnit(a.unitId);
    await tick();
    const check = h.ctl.checkRecovery();
    h.calls.archive[0].d.resolve({ unit: { ...a, status: "archived", archivedAtMillis: 9, revision: 4 }, noop: false });
    await archive;
    lastList(h).d.resolve({ units: [] }); // overlapped the archive
    await check;
    lastList(h).d.resolve({ units: [] });
    await tick();
    expect(h.ctl.getKnownUnit(a.unitId)).toMatchObject({ status: "archived", revision: 4 });
    const restore = h.ctl.restoreUnit(a.unitId);
    await tick();
    expect(h.calls.restore[0].req.expectedRevision).toBe(4);
    h.calls.restore[0].d.resolve({ unit: { ...a, revision: 5 }, noop: false });
    await restore;
    expect(listed(h.ctl, a.unitId)?.revision).toBe(5);
  });

  test("a lost-response re-read after a full-scope omission keeps the higher revision", async () => {
    const a = unit({ revision: 3 });
    const h = await mount([a]);
    const add = h.ctl.addResources(a.unitId, [R1]);
    await tick();
    h.calls.setResources[0].d.reject(NETWORK());
    await tick();
    const check = h.ctl.checkRecovery();
    lastList(h).d.resolve({ units: [] });
    await check;
    const reload = lastList(h);
    h.calls.get[0].d.resolve({ unit: { ...a, resourceIds: [R1], revision: 5 } });
    expect((await add).kind).toBe("uncertain");
    reload.d.resolve({ units: [{ ...a, revision: 4 }] });
    await tick();
    expect(h.ctl.getKnownUnit(a.unitId)).toMatchObject({ revision: 5, resourceIds: [R1] });
  });
});

// ---------- Finding D: recovery hints ----------

describe("D: recovery hints describe the recovery result", () => {
  const checkedTitles = (ctl: TeacherUnitsController) => {
    const s = ctl.getState().recoveryCheck;
    return s.kind === "checked" ? s.units.map((u) => u.unitId) : null;
  };

  test("a cached unit the full check omitted is not counted after the automatic active-only reload", async () => {
    const x = unit({ title: "Plants" });
    const h = await mount([x]);
    void h.ctl.refresh(); // dispatched before the check
    const early = lastList(h);
    const check = h.ctl.checkRecovery();
    const checkList = lastList(h);
    checkList.d.resolve({ units: [] });
    await check;
    early.d.resolve({ units: [x] }); // superseded by the follow-up load
    lastList(h).d.resolve({ units: [x] }); // the follow-up active-only load
    await tick();
    expect(checkedTitles(h.ctl)).toEqual([]);
  });

  test("delayed: a refresh dispatched after the check but answered first does not add to the result", async () => {
    const x = unit({ title: "Plants" });
    const h = await mount([x]);
    const check = h.ctl.checkRecovery();
    const checkList = lastList(h);
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [x] });
    await tick();
    checkList.d.resolve({ units: [] });
    await check;
    lastList(h).d.resolve({ units: [x] });
    await tick();
    expect(checkedTitles(h.ctl)).toEqual([]);
  });

  test("units the check returned stay counted with their current title; a later check can find more", async () => {
    const x = unit({ title: "Plants" });
    const y = unit({ title: "Animals" });
    const h = await mount([x, y]);
    let check = h.ctl.checkRecovery();
    lastList(h).d.resolve({ units: [x] });
    await check;
    lastList(h).d.resolve({ units: [{ ...x, title: "Cells", revision: 2 }, y] });
    await tick();
    let s = h.ctl.getState().recoveryCheck;
    expect(s.kind === "checked" && s.units.map((u) => [u.unitId, u.title])).toEqual([[x.unitId, "Cells"]]);
    check = h.ctl.checkRecovery();
    lastList(h).d.resolve({ units: [{ ...x, title: "Cells", revision: 2 }, y] });
    await check;
    s = h.ctl.getState().recoveryCheck;
    expect(s.kind === "checked" && s.units.map((u) => u.unitId).sort()).toEqual([x.unitId, y.unitId].sort());
  });

  test("former-school notices and durable records are untouched by checks", async () => {
    const { storage, map } = memoryStorage();
    const rec: PersistedCreateAttempt = {
      key: "key_FORMERFID",
      payload: { grade: "7", title: "Plants", description: "" },
      context: FORMER,
      status: "unresolved",
      reason: "uncertain",
      createdAtMs: Date.now(),
    };
    expect(createTeacherUnitCreateAttemptStore(FORMER, () => storage).save(rec)).toBe("saved");
    const before = new Map(map);
    const h = await mount([], storage);
    const check = h.ctl.checkRecovery();
    lastList(h).d.resolve({ units: [] });
    await check;
    expect(h.ctl.getState().formerSchool).toMatchObject({ kind: "ok", attempts: [{ title: "Plants" }] });
    expect(new Map(map)).toEqual(before);
    expect(h.c.create).not.toHaveBeenCalled();
  });
});
