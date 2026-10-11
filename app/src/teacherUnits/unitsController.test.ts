import { createAttemptStorageKey, createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { CREATE_ATTEMPT_REPLAY_WINDOW_MS } from "./saveCoordination";
import type {
  TeacherUnit,
  TeacherUnitMutationResponse,
  TeacherUnitsCallables,
  TeacherUnitsCreateResponse,
  TeacherUnitsListRequest,
  TeacherUnitsListResponse,
} from "./types";
import {
  createTeacherUnitsController,
  createTeacherUnitsSurfaceSeam,
  validateUnitDescription,
  validateUnitTitle,
} from "./unitsController";

// U2.2 My Units controller: authoritative state, revision conflicts,
// lifetime guards, and durable create recovery wiring.

function fakeStorage() {
  const map = new Map<string, string>();
  const opts = { failGet: false, failSet: false, failRemove: false };
  const storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => {
      if (opts.failGet) throw new Error("SecurityError");
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (opts.failSet) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => {
      if (opts.failRemove) throw new Error("SecurityError");
      map.delete(k);
    },
    clear: () => map.clear(),
  } as unknown as Storage;
  return { storage, map, opts };
}

const A = { teacherId: "teacherA", schoolId: "schoolA" };
const T0 = 1_700_000_000_000;

let seq = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Unit${String(++seq).padStart(16, "0")}`,
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

const httpsError = (fbCode: string, code?: string, details: Record<string, unknown> = {}) =>
  Object.assign(new Error("server text"), { code: fbCode, details: code ? { code, ...details } : undefined });

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

const flush = () => new Promise((r) => setTimeout(r, 0));

function callables(over: Partial<{ [K in keyof TeacherUnitsCallables]: jest.Mock }> = {}) {
  const c = {
    create: jest.fn(),
    list: jest.fn(async (): Promise<TeacherUnitsListResponse> => ({ units: [] })),
    get: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: jest.fn(),
    reorder: jest.fn(),
    ...over,
  };
  return c;
}

function make(opts: {
  c?: ReturnType<typeof callables>;
  fs?: ReturnType<typeof fakeStorage>;
  live?: () => typeof A | null;
  now?: () => number;
  mint?: () => string;
}) {
  const c = opts.c ?? callables();
  const fs = opts.fs ?? fakeStorage();
  const ctl = createTeacherUnitsController({
    callables: c as unknown as TeacherUnitsCallables,
    session: A,
    readCurrentContext: opts.live ?? (() => A),
    store: createTeacherUnitCreateAttemptStore(A, () => fs.storage),
    initialGrade: "7",
    now: opts.now ?? (() => T0),
    mint: opts.mint ?? (() => "key_00000001"),
  });
  return { ctl, c, fs };
}

describe("field validation mirrors the server rules", () => {
  test("title", () => {
    expect(validateUnitTitle("  ")).toMatch(/Enter/);
    expect(validateUnitTitle("x".repeat(121))).toMatch(/120/);
    expect(validateUnitTitle("a\u0007b")).toMatch(/control/);
    expect(validateUnitTitle(" Earth ")).toBeNull();
  });
  test("description", () => {
    expect(validateUnitDescription("")).toBeNull();
    expect(validateUnitDescription("line\nbreak\ttab")).toBeNull();
    expect(validateUnitDescription("x".repeat(1001))).toMatch(/1000/);
    expect(validateUnitDescription("a\u0000b")).toMatch(/control/);
  });
});

describe("listing", () => {
  test("loads the grade's active units in canonical order", async () => {
    const u1 = unit({ sortOrder: 2 });
    const u2 = unit({ sortOrder: 1 });
    const other = unit({ grade: "6" });
    const c = callables({ list: jest.fn(async () => ({ units: [u1, u2, other] })) });
    const { ctl } = make({ c });
    expect(ctl.getState().list.kind).toBe("loading");
    await flush();
    expect(c.list).toHaveBeenCalledWith({ grade: "7", includeArchived: false });
    const s = ctl.getState().list;
    expect(s.kind === "ready" && s.units.map((u) => u.unitId)).toEqual([u2.unitId, u1.unitId]);
  });

  test("error state, then retry", async () => {
    const c = callables({
      list: jest
        .fn()
        .mockRejectedValueOnce(httpsError("unavailable"))
        .mockResolvedValueOnce({ units: [] }),
    });
    const { ctl } = make({ c });
    await flush();
    expect(ctl.getState().list.kind).toBe("error");
    await ctl.refresh();
    expect(ctl.getState().list).toEqual({ kind: "ready", units: [] });
  });

  test("a late response for a previous grade is ignored", async () => {
    const d7 = deferred<TeacherUnitsListResponse>();
    const late7 = unit({ grade: "7" });
    const u6 = unit({ grade: "6" });
    const c = callables({
      list: jest.fn((req: TeacherUnitsListRequest) =>
        req.grade === "7" ? d7.promise : Promise.resolve({ units: [u6] }),
      ),
    });
    const { ctl } = make({ c });
    ctl.setGrade("6");
    await flush();
    d7.resolve({ units: [late7] });
    await flush();
    const s = ctl.getState();
    expect(s.grade).toBe("6");
    expect(s.list.kind === "ready" && s.list.units.map((u) => u.unitId)).toEqual([u6.unitId]);
  });

  test("show archived reloads with includeArchived", async () => {
    const c = callables();
    const { ctl } = make({ c });
    ctl.setShowArchived(true);
    await flush();
    expect(c.list).toHaveBeenLastCalledWith({ grade: "7", includeArchived: true });
  });
});

describe("mutations use authoritative responses and revisions", () => {
  async function ready(u: TeacherUnit, over: Partial<{ [K in keyof TeacherUnitsCallables]: jest.Mock }> = {}) {
    const c = callables({ list: jest.fn(async () => ({ units: [u] })), ...over });
    const m = make({ c });
    await flush();
    return m;
  }

  test("rename sends the held revision and adopts the server unit", async () => {
    const u = unit({ revision: 4 });
    const saved = { ...u, title: "Water Systems", revision: 5 };
    const { ctl, c } = await ready(u, {
      update: jest.fn(async (): Promise<TeacherUnitMutationResponse> => ({ unit: saved, noop: false })),
    });
    const r = await ctl.updateUnit(u.unitId, { title: "  Water Systems ", description: "" });
    expect(c.update).toHaveBeenCalledWith({ unitId: u.unitId, expectedRevision: 4, title: "Water Systems" });
    expect(r).toEqual({ kind: "saved", unit: saved, noop: false });
    const s = ctl.getState().list;
    expect(s.kind === "ready" && s.units[0]).toEqual(saved);
  });

  test("unchanged edits are not sent; invalid edits are not sent", async () => {
    const u = unit({ description: "Rocks" });
    const { ctl, c } = await ready(u);
    expect(await ctl.updateUnit(u.unitId, { title: u.title, description: "Rocks " })).toMatchObject({ kind: "saved", noop: true });
    expect(await ctl.updateUnit(u.unitId, { title: "  " })).toMatchObject({ kind: "invalid", field: "title" });
    expect(await ctl.updateUnit(u.unitId, { description: "x".repeat(1001) })).toMatchObject({ kind: "invalid", field: "description" });
    expect(c.update).not.toHaveBeenCalled();
  });

  test("writeConflict fetches the current unit, never replays, and the next save uses the new revision", async () => {
    const u = unit({ revision: 2 });
    const theirs = { ...u, title: "Their title", revision: 3 };
    const mine = { ...theirs, title: "My title", revision: 4 };
    const update = jest
      .fn()
      .mockRejectedValueOnce(httpsError("already-exists", "teacherUnits.writeConflict", { currentRevision: 3 }))
      .mockResolvedValueOnce({ unit: mine, noop: false });
    const { ctl, c } = await ready(u, { update, get: jest.fn(async () => ({ unit: theirs })) });
    const r = await ctl.updateUnit(u.unitId, { title: "My title" });
    expect(r).toMatchObject({ kind: "conflict", latest: theirs });
    expect(c.get).toHaveBeenCalledWith({ unitId: u.unitId });
    expect(update).toHaveBeenCalledTimes(1);
    const s = ctl.getState().list;
    expect(s.kind === "ready" && s.units[0]).toEqual(theirs);
    // Deliberate save again.
    await ctl.updateUnit(u.unitId, { title: "My title" });
    expect(update).toHaveBeenLastCalledWith({ unitId: u.unitId, expectedRevision: 3, title: "My title" });
  });

  test("archive while hiding archived removes the unit; restore adopts it", async () => {
    const u = unit({ revision: 1 });
    const archived = { ...u, status: "archived" as const, revision: 2, archivedAtMillis: 5 };
    const { ctl, c } = await ready(u, { archive: jest.fn(async () => ({ unit: archived, noop: false })) });
    await ctl.archiveUnit(u.unitId);
    expect(c.archive).toHaveBeenCalledWith({ unitId: u.unitId, expectedRevision: 1 });
    expect(ctl.getState().list).toEqual({ kind: "ready", units: [] });
  });

  test("invalidStatus refreshes the unit from the server", async () => {
    const u = unit();
    const archived = { ...u, status: "archived" as const, revision: 2 };
    const { ctl } = await ready(u, {
      update: jest.fn().mockRejectedValue(httpsError("failed-precondition", "teacherUnits.invalidStatus")),
      get: jest.fn(async () => ({ unit: archived })),
    });
    const r = await ctl.updateUnit(u.unitId, { title: "New" });
    expect(r).toMatchObject({ kind: "archived", latest: archived });
    expect(ctl.getState().list).toEqual({ kind: "ready", units: [] });
    // Still known, so a deliberate restore can be sent with its revision.
    expect(ctl.getKnownUnit(u.unitId)).toEqual(archived);
  });

  test("archive conflict: a writeConflict whose latest state is archived reports archived; restore works while hidden", async () => {
    const u = unit({ revision: 1 });
    const archived = { ...u, status: "archived" as const, revision: 2 };
    const restoredUnit = { ...u, revision: 3 };
    const { ctl, c } = await ready(u, {
      update: jest.fn().mockRejectedValue(httpsError("already-exists", "teacherUnits.writeConflict", { currentRevision: 2 })),
      get: jest.fn(async () => ({ unit: archived })),
      restore: jest.fn(async () => ({ unit: restoredUnit, noop: false })),
    });
    expect(await ctl.updateUnit(u.unitId, { title: "Draft" })).toMatchObject({ kind: "archived", latest: archived });
    expect(await ctl.restoreUnit(u.unitId)).toMatchObject({ kind: "saved", unit: restoredUnit });
    expect(c.restore).toHaveBeenCalledWith({ unitId: u.unitId, expectedRevision: 2 });
    const s = ctl.getState().list;
    expect(s.kind === "ready" && s.units).toEqual([restoredUnit]);
  });

  test("notFound drops the unit", async () => {
    const u = unit();
    const { ctl } = await ready(u, {
      restore: jest.fn().mockRejectedValue(httpsError("not-found", "teacherUnits.notFound")),
    });
    await ctl.restoreUnit(u.unitId);
    expect(ctl.getState().list).toEqual({ kind: "ready", units: [] });
  });

  test("one mutation per unit at a time", async () => {
    const u = unit();
    const d = deferred<TeacherUnitMutationResponse>();
    const { ctl, c } = await ready(u, { update: jest.fn(() => d.promise) });
    const p = ctl.updateUnit(u.unitId, { title: "A" });
    expect(ctl.getState().busyUnitIds.has(u.unitId)).toBe(true);
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "busy" });
    d.resolve({ unit: { ...u, title: "A", revision: 2 }, noop: false });
    await p;
    expect(c.archive).not.toHaveBeenCalled();
    expect(ctl.getState().busyUnitIds.has(u.unitId)).toBe(false);
  });
});

describe("lifetime and account guards (late asynchronous responses)", () => {
  test("a mutation response after an account switch never updates the UI state", async () => {
    const u = unit();
    const d = deferred<TeacherUnitMutationResponse>();
    let live: typeof A | null = A;
    const c = callables({ list: jest.fn(async () => ({ units: [u] })), update: jest.fn(() => d.promise) });
    const { ctl } = make({ c, live: () => live });
    await flush();
    const listener = jest.fn();
    ctl.subscribe(listener);
    const p = ctl.updateUnit(u.unitId, { title: "Changed" });
    listener.mockClear();
    live = { teacherId: "teacherB", schoolId: "schoolA" };
    d.resolve({ unit: { ...u, title: "Changed", revision: 2 }, noop: false });
    expect(await p).toEqual({ kind: "stale" });
    expect(listener).not.toHaveBeenCalled();
    const s = ctl.getState().list;
    expect(s.kind === "ready" && s.units[0].title).toBe("Earth Systems");
  });

  test("a list response after dispose is ignored", async () => {
    const d = deferred<TeacherUnitsListResponse>();
    const { ctl } = make({ c: callables({ list: jest.fn(() => d.promise) }) });
    const listener = jest.fn();
    ctl.subscribe(listener);
    ctl.dispose();
    d.resolve({ units: [unit()] });
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(ctl.getState().list.kind).toBe("loading");
  });

  test("a create response after an account switch settles the originator's record but not the UI", async () => {
    const d = deferred<TeacherUnitsCreateResponse>();
    let live: typeof A | null = A;
    const fs = fakeStorage();
    const c = callables({ create: jest.fn(() => d.promise) });
    const { ctl } = make({ c, fs, live: () => live });
    await flush();
    const p = ctl.submitCreate({ grade: "7", title: "Earth", description: "" });
    expect(fs.map.size).toBe(1);
    live = null;
    d.resolve({ unit: unit({ title: "Earth" }), replayed: false });
    await p;
    expect(fs.map.size).toBe(0);
    const s = ctl.getState();
    expect(s.list.kind === "ready" && s.list.units).toEqual([]);
  });

  test("the surface seam checks the live Firebase uid before dispatch", async () => {
    let firebaseUid: string | null = "teacherA";
    const fs = fakeStorage();
    const c = callables();
    const seam = createTeacherUnitsSurfaceSeam({
      callables: c as unknown as TeacherUnitsCallables,
      readFirebaseUid: () => firebaseUid,
      readActiveTeacher: () => ({ uid: "teacherA", schoolId: "schoolA" }),
      createStore: (scope) => createTeacherUnitCreateAttemptStore(scope, () => fs.storage),
    });
    const ctl = seam.createController({ uid: "teacherA", schoolId: "schoolA", initialGrade: "6" });
    await flush();
    firebaseUid = "teacherB";
    await ctl.submitCreate({ grade: "6", title: "Earth", description: "" });
    expect(c.create).not.toHaveBeenCalled();
    expect(fs.map.size).toBe(0);
  });
});

describe("durable create recovery through the controller", () => {
  test("create adopts the confirmed unit and requires explicit new-unit intent", async () => {
    const created = unit({ title: "Earth" });
    const c = callables({ create: jest.fn(async () => ({ unit: created, replayed: false })) });
    const { ctl, fs } = make({ c });
    await flush();
    await ctl.submitCreate({ grade: "7", title: "Earth", description: "" });
    expect(ctl.getState().create.kind).toBe("created");
    const s = ctl.getState().list;
    expect(s.kind === "ready" && s.units).toEqual([created]);
    expect(fs.map.size).toBe(0);
    await ctl.submitCreate({ grade: "7", title: "Earth", description: "" });
    expect(ctl.getState().createBlocked).toBe("newUnitIntentRequired");
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(ctl.beginNewUnit()).toBe(true);
    expect(ctl.getState().create.kind).toBe("idle");
  });

  test("storage unavailable: reported on mount and create is blocked without dispatch", async () => {
    const fs = fakeStorage();
    fs.opts.failGet = true;
    const c = callables();
    const { ctl } = make({ c, fs });
    await flush();
    expect(ctl.getState().storage).toEqual({ kind: "unavailable" });
    await ctl.submitCreate({ grade: "7", title: "Earth", description: "" });
    expect(ctl.getState().createBlocked).toBe("storageUnavailable");
    expect(c.create).not.toHaveBeenCalled();
  });

  test("a new controller (reload) restores the interrupted attempt; reconcile uses the same key", async () => {
    const fs = fakeStorage();
    const first = make({ fs, c: callables({ create: jest.fn(() => new Promise(() => undefined)) }) });
    await flush();
    void first.ctl.submitCreate({ grade: "7", title: "Earth", description: "" });
    first.ctl.dispose();

    const created = unit({ title: "Earth" });
    const c2 = callables({ create: jest.fn(async () => ({ unit: created, replayed: true })) });
    const second = make({ fs, c: c2, mint: () => "key_SHOULDNOT" });
    await flush();
    expect(second.ctl.getState().recoveries).toMatchObject([
      { key: "key_00000001", own: false, state: { kind: "unresolved", reason: "uncertain" } },
    ]);
    await second.ctl.submitCreate({ grade: "7", title: "Other", description: "" });
    expect(second.ctl.getState().createBlocked).toBe("recoveryPending");
    expect(c2.create).not.toHaveBeenCalled();
    await second.ctl.reconcileCreate("key_00000001");
    expect(c2.create).toHaveBeenCalledWith({ grade: "7", title: "Earth", description: "", idempotencyKey: "key_00000001", expectedSchoolId: "schoolA" });
    const s = second.ctl.getState();
    expect(s.recoveries).toEqual([]);
    expect(s.lastConfirmed).toEqual({ unit: created, replayed: true });
    expect(s.list.kind === "ready" && s.list.units).toEqual([created]);
    expect(fs.map.size).toBe(0);
  });

  test("two tabs' unresolved attempts are both restored and reconciled independently", async () => {
    const fs = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(A, () => fs.storage);
    const base = { context: A, status: "unresolved" as const, reason: "uncertain" as const, createdAtMs: T0 };
    store.save({ ...base, key: "key_TABAAAAA", payload: { grade: "7", title: "From A", description: "" } });
    store.save({ ...base, key: "key_TABBBBBB", payload: { grade: "6", title: "From B", description: "" } });
    const uA = unit({ title: "From A" });
    const create = jest
      .fn()
      .mockImplementation(async (req: { idempotencyKey: string }) =>
        req.idempotencyKey === "key_TABAAAAA" ? { unit: uA, replayed: true } : Promise.reject(httpsError("unavailable")),
      );
    const { ctl } = make({ fs, c: callables({ create }) });
    await flush();
    expect(ctl.getState().recoveries.map((e) => e.key)).toEqual(["key_TABAAAAA", "key_TABBBBBB"]);
    await ctl.reconcileCreate("key_TABBBBBB");
    await ctl.reconcileCreate("key_TABAAAAA");
    expect(create.mock.calls.map((c) => c[0].idempotencyKey)).toEqual(["key_TABBBBBB", "key_TABAAAAA"]);
    // A confirmed and removed; B still unresolved with its own record.
    expect(ctl.getState().recoveries.map((e) => [e.key, e.state.kind])).toEqual([["key_TABBBBBB", "unresolved"]]);
    const listed = store.list();
    expect(listed.kind === "ok" && listed.records.map((r) => r.key)).toEqual(["key_TABBBBBB"]);
  });

  test("an attempt saved by another tab after mount is discovered before a new create", async () => {
    const fs = fakeStorage();
    const c = callables();
    const { ctl } = make({ fs, c });
    await flush();
    createTeacherUnitCreateAttemptStore(A, () => fs.storage).save({
      key: "key_OTHERTAB", payload: { grade: "7", title: "Elsewhere", description: "" }, context: A, status: "inFlight", reason: null, createdAtMs: T0,
    });
    await ctl.submitCreate({ grade: "7", title: "Mine", description: "" });
    expect(c.create).not.toHaveBeenCalled();
    expect(ctl.getState().createBlocked).toBe("recoveryPending");
    expect(ctl.getState().recoveries).toMatchObject([{ key: "key_OTHERTAB", state: { kind: "unresolved", reason: "uncertain" } }]);
  });

  test("expired attempt: set-aside requires an authoritative check first", async () => {
    const fs = fakeStorage();
    createTeacherUnitCreateAttemptStore(A, () => fs.storage).save(
      { key: "key_00000001", payload: { grade: "7", title: "Earth", description: "" }, context: A, status: "unresolved", reason: "uncertain", createdAtMs: T0 },
    );
    const match = unit({ title: "Earth", status: "archived" });
    const c = callables({
      list: jest.fn(async (req?: TeacherUnitsListRequest) => ({ units: req?.grade === undefined ? [match] : [] })),
    });
    const { ctl } = make({ c, fs, now: () => T0 + CREATE_ATTEMPT_REPLAY_WINDOW_MS + 1 });
    await flush();
    expect(ctl.getState().recoveries).toMatchObject([{ state: { kind: "unresolved", reason: "replayExpired" } }]);
    await ctl.reconcileCreate("key_00000001");
    expect(ctl.getState().createBlocked).toBe("replayExpired");
    expect(c.create).not.toHaveBeenCalled();
    expect(ctl.abandonCreate("key_00000001")).toBe(false);
    expect(ctl.getState().createBlocked).toBe("checkRequired");
    await ctl.checkRecovery();
    expect(c.list).toHaveBeenCalledWith({ includeArchived: true });
    expect(ctl.getState().recoveryCheck).toEqual({ kind: "checked", units: [match] });
    expect(ctl.abandonCreate("key_00000001")).toBe(true);
    expect(ctl.getState().recoveries).toMatchObject([{ state: { kind: "abandoned" } }]);
    expect(fs.map.size).toBe(1);
    expect(ctl.dismissAbandoned("key_00000001")).toBe(true);
    expect(ctl.getState().recoveries).toEqual([]);
    expect(fs.map.size).toBe(0);
  });

  test("validation refusal during uncertain reconciliation keeps the attempt and its record", async () => {
    const fs = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(A, () => fs.storage);
    store.save({ key: "key_00000001", payload: { grade: "7", title: "Earth", description: "" }, context: A, status: "inFlight", reason: null, createdAtMs: T0 });
    const c = callables({ create: jest.fn().mockRejectedValue(httpsError("invalid-argument", "teacherUnits.invalidTitle")) });
    const { ctl } = make({ fs, c });
    await flush();
    await ctl.reconcileCreate("key_00000001");
    expect(ctl.getState().recoveries).toMatchObject([{ state: { kind: "unresolved", reason: "replayRefused" } }]);
    await ctl.reconcileCreate("key_00000001");
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(fs.map.size).toBe(1);
    expect(ctl.abandonCreate("key_00000001")).toBe(false);
  });

  test("unreadable record blocks create until checked and explicitly discarded", async () => {
    const fs = fakeStorage();
    const bad = createAttemptStorageKey(A, "key_00000009");
    fs.map.set(bad, "{corrupt");
    const c = callables({ create: jest.fn(async () => ({ unit: unit(), replayed: false })) });
    const { ctl } = make({ c, fs });
    await flush();
    expect(ctl.getState().unreadable).toEqual([bad]);
    await ctl.submitCreate({ grade: "7", title: "Earth", description: "" });
    expect(c.create).not.toHaveBeenCalled();
    expect(ctl.discardUnreadableAttempt(bad)).toBe(false);
    await ctl.checkRecovery();
    expect(ctl.discardUnreadableAttempt(bad)).toBe(true);
    expect(fs.map.size).toBe(0);
    await ctl.submitCreate({ grade: "7", title: "Earth", description: "" });
    expect(c.create).toHaveBeenCalledTimes(1);
  });

  test("discard that cannot be verified keeps create blocked", async () => {
    const fs = fakeStorage();
    const bad = createAttemptStorageKey(A, "key_00000009");
    fs.map.set(bad, "{corrupt");
    const { ctl } = make({ fs });
    await flush();
    await ctl.checkRecovery();
    fs.opts.failRemove = true;
    expect(ctl.discardUnreadableAttempt(bad)).toBe(false);
    expect(ctl.getState().unreadable).toEqual([bad]);
  });
});
