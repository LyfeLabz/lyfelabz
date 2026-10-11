/**
 * U2.3 sixth certification: authoritative absence and mutation eligibility.
 *
 * An independent harness (manually settled deferreds). Invariants:
 * 1. a retained record does not imply presence;
 * 2. visibility does not imply that a unit may be changed;
 * 3. an active-only omission does not establish that a unit exists;
 * 4. a full-scope absence is never weakened into an actionable state by a
 *    less informative (active-only) omission;
 * 5. a later positive authoritative read restores presence;
 * 6. the server's ownership, school, revision, and status checks stay
 *    authoritative (nothing here grants anything).
 * The observable contract: no mutation callable is dispatched without
 * valid evidence that the unit can be changed.
 */
import { createTeacherUnitsController, type TeacherUnitsController } from "./unitsController";
import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { getPlaceableResources } from "./placeableResources";
import type { TeacherUnitCreateContext } from "./saveCoordination";
import type { TeacherUnit, TeacherUnitsCallables } from "./types";

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
  unitId: `Absent${String(++seq).padStart(14, "0")}`,
  grade: "7",
  title: "Earth Systems",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: seq,
  updatedAtMillis: seq,
  resourceIds: [R1],
  sortOrder: 0,
  revision: 3,
  ...over,
});

type Call<T> = { req: Record<string, unknown>; d: Deferred<T> };
function scripted() {
  const calls = {
    list: [] as Array<Call<{ units: TeacherUnit[] }>>,
    get: [] as Array<Call<{ unit: TeacherUnit }>>,
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
    create: jest.fn(),
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

async function mount(initial: TeacherUnit[], ctx: () => TeacherUnitCreateContext | null = () => SCOPE) {
  const h = scripted();
  const ctl: TeacherUnitsController = createTeacherUnitsController({
    callables: h.c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: ctx,
    store: createTeacherUnitCreateAttemptStore(SCOPE, ((st) => () => st)(memoryStorage())),
    initialGrade: "7",
  });
  h.calls.list[0].d.resolve({ units: initial });
  await tick();
  return { ...h, ctl };
}
type H = Awaited<ReturnType<typeof mount>>;
const lastList = (h: H) => h.calls.list[h.calls.list.length - 1];
const mutationCalls = (h: H) =>
  h.c.setResources.mock.calls.length + h.c.update.mock.calls.length + h.c.archive.mock.calls.length + h.c.restore.mock.calls.length;

// Every mutation the controller offers, attempted once. Replies are never
// awaited (a dispatched call would wait for a server answer the test does
// not give); the assertion is how many mutation callables were dispatched.
async function attemptAll(h: H, unitId: string) {
  const other = getPlaceableResources().filter((r) => r.grade === "7")[1].id;
  const attempts: Array<() => Promise<unknown>> = [
    () => h.ctl.addResources(unitId, [other]),
    () => h.ctl.removeResource(unitId, R1),
    () => h.ctl.removeRetiredResources(unitId),
    () => h.ctl.updateUnit(unitId, { title: "Renamed" }),
    () => h.ctl.archiveUnit(unitId),
    () => h.ctl.restoreUnit(unitId),
  ];
  for (const run of attempts) {
    void run();
    await tick();
  }
}

// Full-scope absence (Check my units omits the unit), then the automatic
// active-only reload also omits it.
async function absentThenActiveOnly(h: H) {
  const check = h.ctl.checkRecovery();
  lastList(h).d.resolve({ units: [] });
  await check;
  lastList(h).d.resolve({ units: [] });
  await tick();
}

describe("A: a full-scope absence is not weakened by an active-only omission", () => {
  test("absent, then an active-only omission: no mutation is dispatched", async () => {
    const a = unit();
    const h = await mount([a]);
    await absentThenActiveOnly(h);
    await attemptAll(h, a.unitId);
    expect(mutationCalls(h)).toBe(0);
    expect(h.ctl.getUnitState(a.unitId).kind).toBe("absent");
  });

  test("reversed: an active-only refresh dispatched before the check but answered after it", async () => {
    const a = unit();
    const h = await mount([a]);
    void h.ctl.refresh(); // superseded by the check's follow-up load
    const early = lastList(h);
    const check = h.ctl.checkRecovery();
    lastList(h).d.resolve({ units: [] });
    await check;
    early.d.resolve({ units: [] });
    lastList(h).d.resolve({ units: [] });
    await tick();
    await attemptAll(h, a.unitId);
    expect(mutationCalls(h)).toBe(0);
  });

  test("reversed: an active-only omission answered before the full-scope absence", async () => {
    const a = unit();
    const h = await mount([a]);
    const check = h.ctl.checkRecovery();
    const checkList = lastList(h);
    void h.ctl.refresh(); // dispatched after the check
    lastList(h).d.resolve({ units: [] });
    await tick();
    checkList.d.resolve({ units: [] });
    await check;
    lastList(h).d.resolve({ units: [] });
    await tick();
    await attemptAll(h, a.unitId);
    expect(mutationCalls(h)).toBe(0);
  });

  test("a cached higher-revision record is kept but is not actionable", async () => {
    const a = unit();
    const h = await mount([a]);
    const add = h.ctl.addResources(a.unitId, [getPlaceableResources().filter((r) => r.grade === "7")[1].id]);
    await tick();
    h.calls.setResources[0].d.reject({ details: { code: "teacherUnits.writeConflict" } });
    await tick();
    const check = h.ctl.checkRecovery();
    lastList(h).d.resolve({ units: [] });
    await check;
    lastList(h).d.resolve({ units: [] });
    await tick();
    h.calls.get[0].d.resolve({ unit: { ...a, revision: 5 } }); // older request, higher revision
    await add;
    expect(h.c.setResources).toHaveBeenCalledTimes(1);
    await attemptAll(h, a.unitId);
    expect(mutationCalls(h)).toBe(1);
    // A later positive authoritative list restores it, at the highest revision.
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [{ ...a, revision: 4 }] });
    await tick();
    void h.ctl.removeResource(a.unitId, R1);
    await tick();
    expect(h.calls.setResources[1].req).toMatchObject({ expectedRevision: 5 });
  });

  test("a later positive get restores actionability", async () => {
    const a = unit();
    const h = await mount([a]);
    await absentThenActiveOnly(h);
    // A conflict re-read is the get path; reach it from a fresh positive list first.
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [{ ...a, revision: 6 }] });
    await tick();
    const rm = h.ctl.removeResource(a.unitId, R1);
    await tick();
    expect(h.calls.setResources[0].req).toMatchObject({ expectedRevision: 6 });
    h.calls.setResources[0].d.reject({ details: { code: "teacherUnits.writeConflict" } });
    await tick();
    h.calls.get[0].d.resolve({ unit: { ...a, revision: 7 } });
    expect((await rm).kind).toBe("conflict");
    void h.ctl.removeResource(a.unitId, R1);
    await tick();
    expect(h.calls.setResources[1].req).toMatchObject({ expectedRevision: 7 });
  });

  test("a later positive full-scope list restores actionability", async () => {
    const a = unit();
    const h = await mount([a]);
    await absentThenActiveOnly(h);
    const check = h.ctl.checkRecovery();
    lastList(h).d.resolve({ units: [{ ...a, revision: 4 }] });
    await check;
    lastList(h).d.resolve({ units: [{ ...a, revision: 4 }] });
    await tick();
    void h.ctl.removeResource(a.unitId, R1);
    await tick();
    expect(h.calls.setResources[0].req).toMatchObject({ expectedRevision: 4 });
  });

  test("a not-found re-read after an uncertain write, then an active-only omission: no mutation", async () => {
    const a = unit();
    const h = await mount([a]);
    const add = h.ctl.addResources(a.unitId, [getPlaceableResources().filter((r) => r.grade === "7")[1].id]);
    await tick();
    h.calls.setResources[0].d.reject(Object.assign(new Error("lost"), { code: "unavailable" }));
    await tick();
    h.calls.get[0].d.reject({ details: { code: "teacherUnits.notFound" } });
    await add;
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [] });
    await tick();
    await attemptAll(h, a.unitId);
    expect(mutationCalls(h)).toBe(1);
  });

  test("an active-only omission alone: a held active record is not actionable, a held archived one may be restored", async () => {
    const a = unit();
    const h = await mount([a]);
    void h.ctl.refresh();
    lastList(h).d.resolve({ units: [] }); // archived or gone; the held record says active
    await tick();
    await attemptAll(h, a.unitId);
    expect(mutationCalls(h)).toBe(0);
    // Learn it is archived (consistent with the omission): restore is allowed.
    h.ctl.setShowArchived(true);
    lastList(h).d.resolve({ units: [{ ...a, status: "archived", archivedAtMillis: 9, revision: 4 }] });
    await tick();
    h.ctl.setShowArchived(false);
    lastList(h).d.resolve({ units: [] });
    await tick();
    void h.ctl.restoreUnit(a.unitId);
    await tick();
    expect(h.calls.restore[0].req).toMatchObject({ expectedRevision: 4 });
  });

  test("a teacher or school change: nothing is dispatched", async () => {
    const a = unit();
    let ctx: TeacherUnitCreateContext | null = SCOPE;
    const h = await mount([a], () => ctx);
    ctx = { teacherId: "teacherA", schoolId: "schoolB" };
    await attemptAll(h, a.unitId);
    expect(mutationCalls(h)).toBe(0);
  });
});

describe("A: adversarial ordering of full-scope and active-only omissions", () => {
  const perms = <T,>(xs: T[]): T[][] =>
    xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
  type Req = "check" | "refreshA" | "refreshB";

  test("every dispatch order x every arrival order: never actionable without positive evidence", async () => {
    let runs = 0;
    for (const dispatch of perms<Req>(["check", "refreshA", "refreshB"])) {
      for (const arrival of perms<Req>(["check", "refreshA", "refreshB"])) {
        const a = unit();
        const h = await mount([a]);
        const pending = new Map<Req, Call<{ units: TeacherUnit[] }>>();
        let checkDone: Promise<void> | null = null;
        for (const r of dispatch) {
          if (r === "check") checkDone = h.ctl.checkRecovery();
          else void h.ctl.refresh();
          pending.set(r, lastList(h));
        }
        for (const r of arrival) {
          (pending.get(r) as Call<{ units: TeacherUnit[] }>).d.resolve({ units: [] });
          await tick();
        }
        await checkDone;
        lastList(h).d.resolve({ units: [] }); // the check's follow-up load
        await tick();
        const label = `${dispatch.join(",")} / ${arrival.join(",")}`;
        await attemptAll(h, a.unitId);
        expect([label, mutationCalls(h)]).toEqual([label, 0]);
        expect([label, h.ctl.getUnitState(a.unitId).kind]).toEqual([label, "absent"]);
        // Positive authoritative evidence restores actionability.
        const check = h.ctl.checkRecovery();
        lastList(h).d.resolve({ units: [{ ...a, revision: 4 }] });
        await check;
        lastList(h).d.resolve({ units: [{ ...a, revision: 4 }] });
        await tick();
        void h.ctl.removeResource(a.unitId, R1);
        await tick();
        expect([label, h.c.setResources.mock.calls.length]).toEqual([label, 1]);
        runs++;
      }
    }
    expect(runs).toBe(36);
  });
});
