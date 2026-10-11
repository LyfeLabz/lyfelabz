/**
 * U2.3 second-certification regressions (controller and bootstrap seam).
 *
 * An independent harness: every callable is a manually settled deferred, so
 * each test fixes the exact send and arrival order of list, get, and
 * mutation responses. Covers the stale-reconciliation resurrection (P1),
 * the same-uid school-transfer bootstrap reader (P2), and the recovery
 * check's titles (P2).
 */
import * as fs from "fs";
import * as path from "path";
import {
  bootstrapActiveTeacherReader,
  createTeacherUnitsController,
  createTeacherUnitsSurfaceSeam,
  type TeacherUnitsController,
} from "./unitsController";
import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { getPlaceableResources } from "./placeableResources";
import type { TeacherUnit, TeacherUnitsCallables } from "./types";
import type { TeacherUnitCreateContext } from "./saveCoordination";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
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

let seq = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Recert${String(++seq).padStart(14, "0")}`,
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

// Every call is queued; the test settles each one explicitly.
function scripted() {
  const calls = {
    list: [] as Array<{ req: unknown; d: Deferred<{ units: TeacherUnit[] }> }>,
    get: [] as Array<{ req: { unitId: string }; d: Deferred<{ unit: TeacherUnit }> }>,
    setResources: [] as Array<{ req: unknown; d: Deferred<{ unit: TeacherUnit; noop: boolean }> }>,
    update: [] as Array<{ req: unknown; d: Deferred<{ unit: TeacherUnit; noop: boolean }> }>,
  };
  const queue =
    <K extends keyof typeof calls>(k: K) =>
    (req: never) => {
      const d = deferred<unknown>();
      (calls[k] as unknown as Array<{ req: unknown; d: Deferred<unknown> }>).push({ req, d });
      return d.promise;
    };
  const c = {
    create: jest.fn(),
    list: jest.fn(queue("list")),
    get: jest.fn(queue("get")),
    update: jest.fn(queue("update")),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: jest.fn(queue("setResources")),
    reorder: jest.fn(),
  };
  return { c, calls };
}

function mount(
  c: ReturnType<typeof scripted>["c"],
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

const listedIds = (ctl: TeacherUnitsController): string[] => {
  const s = ctl.getState();
  return s.list.kind === "ready" ? s.list.units.map((u) => u.unitId) : [];
};
const listed = (ctl: TeacherUnitsController, unitId: string) => {
  const s = ctl.getState();
  return s.list.kind === "ready" ? s.list.units.find((u) => u.unitId === unitId) ?? null : null;
};
const CONFLICT = () => ({ details: { code: "teacherUnits.writeConflict" } });
const NETWORK = () => Object.assign(new Error("lost"), { code: "unavailable" });

// Mount with the initial list [units] settled.
async function ready(units: TeacherUnit[], ctx?: () => TeacherUnitCreateContext | null) {
  const h = scripted();
  const ctl = mount(h.c, ctx);
  h.calls.list[0].d.resolve({ units });
  await tick();
  return { ...h, ctl };
}

// Starts an add whose conflict leaves a single-unit re-read outstanding.
async function pendingReread(h: Awaited<ReturnType<typeof ready>>, unitId: string) {
  const result = h.ctl.addResources(unitId, [R1]);
  await tick();
  h.calls.setResources[h.calls.setResources.length - 1].d.reject(CONFLICT());
  await tick();
  return { result, get: h.calls.get[h.calls.get.length - 1] };
}

describe("P1: list and single-unit reconciliation ordering", () => {
  test("an older re-read resolving after a newer list omitted the unit does not resurrect it", async () => {
    const a = unit();
    const b = unit({ title: "Water" });
    const h = await ready([a, b]);
    const { result, get } = await pendingReread(h, a.unitId);
    void h.ctl.refresh(); // sent after the re-read
    h.calls.list[1].d.resolve({ units: [b] }); // newer: a is gone
    await tick();
    expect(listedIds(h.ctl)).toEqual([b.unitId]);
    get.d.resolve({ unit: { ...a, revision: 2 } }); // older single-unit response
    await result;
    expect(listedIds(h.ctl)).toEqual([b.unitId]);
  });

  test("the same holds for a lost-response (uncertain) re-read", async () => {
    const a = unit();
    const h = await ready([a]);
    const add = h.ctl.addResources(a.unitId, [R1]);
    await tick();
    h.calls.setResources[0].d.reject(NETWORK());
    await tick();
    void h.ctl.refresh();
    h.calls.list[1].d.resolve({ units: [] });
    await tick();
    h.calls.get[0].d.resolve({ unit: { ...a, resourceIds: [R1], revision: 2 } });
    const r = await add;
    expect(r.kind).toBe("uncertain");
    expect(listedIds(h.ctl)).toEqual([]);
  });

  test("an older re-read resolving after a newer list included the unit keeps the newer list's unit", async () => {
    const a = unit();
    const h = await ready([a]);
    const { result, get } = await pendingReread(h, a.unitId);
    void h.ctl.refresh();
    h.calls.list[1].d.resolve({ units: [{ ...a, title: "Renamed", revision: 3 }] });
    await tick();
    get.d.resolve({ unit: { ...a, revision: 2 } });
    const r = await result;
    expect(r.kind === "conflict" && r.latest?.revision).toBe(3);
    expect(listed(h.ctl, a.unitId)).toMatchObject({ title: "Renamed", revision: 3 });
  });

  test("a newer re-read resolving after an older list keeps the unit listed", async () => {
    const a = unit();
    const h = await ready([a]);
    void h.ctl.refresh(); // older list, sent first
    const { result, get } = await pendingReread(h, a.unitId);
    get.d.resolve({ unit: { ...a, revision: 2 } });
    await result;
    h.calls.list[1].d.resolve({ units: [] }); // older list omits a
    await tick();
    expect(listed(h.ctl, a.unitId)?.revision).toBe(2);
  });

  test("concurrent list, re-read, list: the most recently sent request decides", async () => {
    const a = unit();
    const h = await ready([a]);
    void h.ctl.refresh(); // list #1 (discarded: superseded)
    const { result, get } = await pendingReread(h, a.unitId);
    void h.ctl.refresh(); // list #2, newest
    h.calls.list[2].d.resolve({ units: [] });
    await tick();
    get.d.resolve({ unit: { ...a, revision: 2 } });
    await result;
    h.calls.list[1].d.resolve({ units: [a] });
    await tick();
    expect(listedIds(h.ctl)).toEqual([]);
  });

  test("a unit omitted by one list is listed again when a later list includes it (no tombstone)", async () => {
    const a = unit();
    const h = await ready([a]);
    const { result, get } = await pendingReread(h, a.unitId);
    void h.ctl.refresh();
    h.calls.list[1].d.resolve({ units: [] });
    await tick();
    get.d.resolve({ unit: { ...a, revision: 2 } });
    await result;
    expect(listedIds(h.ctl)).toEqual([]);
    void h.ctl.refresh();
    h.calls.list[2].d.resolve({ units: [{ ...a, status: "active", revision: 4 }] });
    await tick();
    expect(listed(h.ctl, a.unitId)?.revision).toBe(4);
    // And a later single-unit read is applied normally again.
    const again = await pendingReread(h, a.unitId);
    again.get.d.resolve({ unit: { ...a, title: "Back", revision: 5 } });
    await again.result;
    expect(listed(h.ctl, a.unitId)).toMatchObject({ title: "Back", revision: 5 });
  });

  test("an older notFound does not drop a unit a newer list included", async () => {
    const a = unit();
    const h = await ready([a]);
    const { result, get } = await pendingReread(h, a.unitId);
    void h.ctl.refresh();
    h.calls.list[1].d.resolve({ units: [{ ...a, revision: 2 }] });
    await tick();
    get.d.reject({ details: { code: "teacherUnits.notFound" } });
    await result;
    expect(listed(h.ctl, a.unitId)?.revision).toBe(2);
  });

  test("Check my units (all grades) omitting a unit hides it from an older re-read too", async () => {
    const a = unit();
    const h = await ready([a]);
    const { result, get } = await pendingReread(h, a.unitId);
    const check = h.ctl.checkRecovery();
    h.calls.list[1].d.resolve({ units: [] });
    await check;
    get.d.resolve({ unit: { ...a, revision: 2 } });
    await result;
    expect(listedIds(h.ctl)).not.toContain(a.unitId);
  });

  test("a list for another grade or the active-only list never hides units outside its scope", async () => {
    const a = unit();
    const archived = unit({ status: "archived", archivedAtMillis: 1 });
    const h = await ready([a]);
    h.ctl.setShowArchived(true);
    h.calls.list[1].d.resolve({ units: [a, archived] });
    await tick();
    expect(listedIds(h.ctl)).toContain(archived.unitId);
    h.ctl.setGrade("6");
    h.calls.list[2].d.resolve({ units: [] });
    await tick();
    h.ctl.setGrade("7");
    h.calls.list[3].d.resolve({ units: [a, archived] });
    await tick();
    expect(listedIds(h.ctl).sort()).toEqual([a.unitId, archived.unitId].sort());
  });

  test.each([
    ["teacher", { teacherId: "teacherB", schoolId: "schoolA" }],
    ["school", { teacherId: "teacherA", schoolId: "schoolB" }],
  ])("a %s change while list and re-read are pending applies neither", async (_k, next) => {
    const a = unit();
    let ctx: TeacherUnitCreateContext | null = SCOPE;
    const h = await ready([a], () => ctx);
    const { result, get } = await pendingReread(h, a.unitId);
    void h.ctl.refresh();
    ctx = next;
    h.calls.list[1].d.resolve({ units: [] });
    get.d.resolve({ unit: { ...a, revision: 7 } });
    expect(await result).toEqual({ kind: "stale" });
    await tick();
    expect(h.ctl.getKnownUnit(a.unitId)?.revision).toBe(1);
  });
});

describe("P2: recovery check titles follow the latest accepted state", () => {
  test("a rename confirmed while the check was pending is what the check reports", async () => {
    const a = unit({ title: "Plants" });
    const h = await ready([a]);
    const check = h.ctl.checkRecovery();
    const rename = h.ctl.updateUnit(a.unitId, { title: "Animals" });
    await tick();
    h.calls.update[0].d.resolve({ unit: { ...a, title: "Animals", revision: 2 }, noop: false });
    expect((await rename).kind).toBe("saved");
    h.calls.list[1].d.resolve({ units: [a] }); // sent before the rename
    await check;
    const s = h.ctl.getState().recoveryCheck;
    expect(s.kind === "checked" && s.units.map((u) => u.title)).toEqual(["Animals"]);
  });

  test("later refreshes with different titles keep the check current", async () => {
    const a = unit({ title: "Plants" });
    const h = await ready([a]);
    const check = h.ctl.checkRecovery();
    h.calls.list[1].d.resolve({ units: [a] });
    await check;
    h.calls.list[2].d.resolve({ units: [{ ...a, title: "Cells", revision: 2 }] }); // follow-up load
    await tick();
    let s = h.ctl.getState().recoveryCheck;
    expect(s.kind === "checked" && s.units.map((u) => u.title)).toEqual(["Cells"]);
    void h.ctl.refresh();
    h.calls.list[3].d.resolve({ units: [{ ...a, title: "Plants", revision: 3 }] });
    await tick();
    s = h.ctl.getState().recoveryCheck;
    expect(s.kind === "checked" && s.units.map((u) => u.title)).toEqual(["Plants"]);
  });

  test("a stale re-read after the current title is updated does not change the reported title", async () => {
    const a = unit({ title: "Old" });
    const h = await ready([a]);
    const check = h.ctl.checkRecovery();
    h.calls.list[1].d.resolve({ units: [a] });
    await check;
    h.calls.list[2].d.resolve({ units: [a] });
    await tick();
    const { result, get } = await pendingReread(h, a.unitId);
    void h.ctl.refresh();
    h.calls.list[3].d.resolve({ units: [{ ...a, title: "Current", revision: 3 }] });
    await tick();
    get.d.resolve({ unit: { ...a, title: "Middle", revision: 2 } });
    await result;
    const s = h.ctl.getState().recoveryCheck;
    expect(s.kind === "checked" && s.units.map((u) => u.title)).toEqual(["Current"]);
    expect(listed(h.ctl, a.unitId)?.title).toBe("Current");
  });
});

// ---------- Same-uid school transfer (bootstrap seam) ----------
//
// A model of the entry point's bootstrap sequence (app/src/index.ts
// `rerun`): each run takes the next token, resolves a session, binds a new
// seam BEFORE an awaited hydration step, and only then records the session
// as the active teacher. The reader under test is the production export.
type ActiveTeacher = { readonly kind: "activeTeacher"; readonly uid: string; readonly schoolId: string };

function bootstrapModel() {
  const app = { currentRunToken: 0, lastActiveTeacher: null as ActiveTeacher | null, firebaseUid: null as string | null };
  const runs: Array<{ seam: ReturnType<typeof createTeacherUnitsSurfaceSeam> | null; finish: () => void }> = [];
  const { c, calls } = scripted();
  const start = (session: ActiveTeacher | null) => {
    const runToken = ++app.currentRunToken;
    app.firebaseUid = session?.uid ?? null;
    if (session === null) {
      app.lastActiveTeacher = null;
      runs.push({ seam: null, finish: () => undefined });
      return runs[runs.length - 1];
    }
    const seam = createTeacherUnitsSurfaceSeam({
      callables: c as unknown as TeacherUnitsCallables,
      readFirebaseUid: () => app.firebaseUid,
      readActiveTeacher: bootstrapActiveTeacherReader({
        runToken,
        session,
        readCurrentRunToken: () => app.currentRunToken,
        readActiveSession: () => app.lastActiveTeacher,
      }),
      createStore: (scope) => createTeacherUnitCreateAttemptStore(scope, () => memoryStorage()),
    });
    // Hydration is awaited here; the session is installed afterwards.
    runs.push({
      seam,
      finish: () => {
        if (runToken === app.currentRunToken) app.lastActiveTeacher = session;
      },
    });
    return runs[runs.length - 1];
  };
  return { app, start, c, calls };
}

const teacher = (uid: string, schoolId: string): ActiveTeacher => ({ kind: "activeTeacher", uid, schoolId });

describe("P2: same-uid school transfer invalidates controllers", () => {
  test("while the school-B run is finishing, a controller bound to the cached school-A teacher is stale", async () => {
    const m = bootstrapModel();
    const runA = m.start(teacher("t1", "schoolA"));
    runA.finish();
    const runB = m.start(teacher("t1", "schoolB")); // same uid, new school, hydration pending
    // Anything mounted now from the cached teacher (school A) through the
    // current seam must not be live.
    const cached = m.app.lastActiveTeacher as ActiveTeacher;
    expect(cached.schoolId).toBe("schoolA");
    const ctl = runB.seam!.createController({ uid: cached.uid, schoolId: cached.schoolId, initialGrade: "7" });
    expect(await ctl.addResources("anything", [R1])).toEqual({ kind: "stale" });
    expect(m.c.list).not.toHaveBeenCalled();
    runB.finish();
    expect(await ctl.addResources("anything", [R1])).toEqual({ kind: "stale" });
    expect(m.c.setResources).not.toHaveBeenCalled();
  });

  test("late old-school mutation and reconciliation responses are ignored; the new-school controller works", async () => {
    const m = bootstrapModel();
    const a = unit();
    const runA = m.start(teacher("t1", "schoolA"));
    runA.finish();
    const oldCtl = runA.seam!.createController({ uid: "t1", schoolId: "schoolA", initialGrade: "7" });
    m.calls.list[0].d.resolve({ units: [a] });
    await tick();
    const add = oldCtl.addResources(a.unitId, [R1]);
    await tick();
    const runB = m.start(teacher("t1", "schoolB"));
    m.calls.setResources[0].d.resolve({ unit: { ...a, resourceIds: [R1], revision: 2 }, noop: false });
    expect(await add).toEqual({ kind: "stale" });
    expect(oldCtl.getKnownUnit(a.unitId)?.revision).toBe(1);
    runB.finish();
    const newCtl = runB.seam!.createController({ uid: "t1", schoolId: "schoolB", initialGrade: "7" });
    expect(m.calls.list).toHaveLength(2);
    m.calls.list[1].d.resolve({ units: [] });
    await tick();
    expect(newCtl.getState().list.kind).toBe("ready");
    // The old controller's late reconciliation is ignored too.
    await oldCtl.refresh();
    expect(m.calls.list).toHaveLength(2);
  });

  test("repeated bootstrap for the same uid and school: earlier controllers go stale, the new one is live", async () => {
    const m = bootstrapModel();
    const r1 = m.start(teacher("t1", "schoolA"));
    r1.finish();
    const c1 = r1.seam!.createController({ uid: "t1", schoolId: "schoolA", initialGrade: "7" });
    const r2 = m.start(teacher("t1", "schoolA"));
    r2.finish();
    const c2 = r2.seam!.createController({ uid: "t1", schoolId: "schoolA", initialGrade: "7" });
    await c1.refresh();
    expect(m.c.list).toHaveBeenCalledTimes(2); // one initial load each, c1's refresh refused
    expect(c2.getState().list.kind).toBe("loading");
  });

  test("sign-out then sign-in, and an account switch, make earlier controllers stale", async () => {
    const m = bootstrapModel();
    const r1 = m.start(teacher("t1", "schoolA"));
    r1.finish();
    const c1 = r1.seam!.createController({ uid: "t1", schoolId: "schoolA", initialGrade: "7" });
    m.start(null); // signed out
    expect(await c1.addResources("u", [R1])).toEqual({ kind: "stale" });
    const r3 = m.start(teacher("t1", "schoolA"));
    r3.finish();
    expect(await c1.addResources("u", [R1])).toEqual({ kind: "stale" });
    const c3 = r3.seam!.createController({ uid: "t1", schoolId: "schoolA", initialGrade: "7" });
    const r4 = m.start(teacher("t2", "schoolA"));
    r4.finish();
    expect(await c3.addResources("u", [R1])).toEqual({ kind: "stale" });
    expect(m.c.setResources).not.toHaveBeenCalled();
  });

  test("the entry point binds the seam with this run's own session", () => {
    const src = fs.readFileSync(path.join(__dirname, "../index.ts"), "utf8");
    expect(src).toMatch(
      /readActiveTeacher: bootstrapActiveTeacherReader\(\{\s*runToken,\s*session,\s*readCurrentRunToken: \(\) => currentRunToken,\s*readActiveSession: \(\) => lastActiveTeacher,\s*\}\)/,
    );
    expect(src).not.toMatch(/schoolId: lastActiveTeacher\.schoolId/);
  });
});
