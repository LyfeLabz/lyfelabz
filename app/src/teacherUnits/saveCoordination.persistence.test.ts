import {
  CREATE_ATTEMPT_REPLAY_WINDOW_MS,
  createUnitCreateCoordinator,
  isCreateReplayEligible,
  type PersistedCreateAttempt,
  type TeacherUnitCreateContext,
  type TeacherUnitCreatePayload,
} from "./saveCoordination";
import { createAttemptStorageKey, createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import type { TeacherUnit, TeacherUnitsCreateRequest, TeacherUnitsCreateResponse } from "./types";

// U2.2: the additive `persistence` / `restore` hooks on the certified U2.1
// create coordinator. The original state machine is covered, unchanged, by
// saveCoordination.test.ts; this file covers durability.

function fakeStorage() {
  const map = new Map<string, string>();
  const opts = { failGet: false, failSet: false, failRemove: false, ignoreRemove: false };
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
      if (opts.failSet) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
      map.set(k, v);
    },
    removeItem: (k: string) => {
      if (opts.failRemove) throw new Error("SecurityError");
      if (!opts.ignoreRemove) map.delete(k);
    },
    clear: () => map.clear(),
  } as unknown as Storage;
  return { storage, map, opts };
}

const A: TeacherUnitCreateContext = { teacherId: "teacherA", schoolId: "schoolA" };
const B: TeacherUnitCreateContext = { teacherId: "teacherB", schoolId: "schoolA" };
const PAYLOAD: TeacherUnitCreatePayload = { grade: "7", title: "Earth Systems", description: "Rocks" };
const T0 = 1_700_000_000_000;

const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: "AbCdEfGhIjKlMnOpQrSt",
  grade: "7",
  title: "Earth Systems",
  description: "Rocks",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: 1,
  updatedAtMillis: 1,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});

const httpsError = (fbCode: string, code?: string) =>
  Object.assign(new Error("server text"), { code: fbCode, details: code ? { code } : undefined });

type Step = TeacherUnitsCreateResponse | Error | "hang";

function scripted(steps: Step[]) {
  const calls: TeacherUnitsCreateRequest[] = [];
  const create = jest.fn((req: TeacherUnitsCreateRequest) => {
    calls.push(req);
    const next = steps.shift();
    if (next === undefined) return Promise.reject(new Error("unscripted call"));
    if (next === "hang") return new Promise<TeacherUnitsCreateResponse>(() => undefined);
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
  return { create, calls };
}

function keys(...ks: string[]) {
  const list = ks.length ? ks : ["key_00000001", "key_00000002", "key_00000003"];
  const mint = jest.fn(() => {
    const k = list.shift();
    if (!k) throw new Error("no more keys");
    return k;
  });
  return mint;
}

function setup(opts: {
  steps: Step[];
  session?: () => TeacherUnitCreateContext | null;
  scope?: TeacherUnitCreateContext;
  storage?: ReturnType<typeof fakeStorage>;
  now?: () => number;
  restore?: boolean;
  mint?: ReturnType<typeof keys>;
}) {
  const fs = opts.storage ?? fakeStorage();
  const scope = opts.scope ?? A;
  const store = createTeacherUnitCreateAttemptStore(scope, () => fs.storage);
  const { create, calls } = scripted(opts.steps);
  const mint = opts.mint ?? keys();
  const listed = store.list();
  const first = listed.kind === "ok" ? listed.records[0] ?? null : null;
  const c = createUnitCreateCoordinator({
    create,
    readSessionContext: opts.session ?? (() => scope),
    mint,
    persistence: store,
    restore: opts.restore === false ? null : first,
    now: opts.now ?? (() => T0),
  });
  return { c, create, calls, store, fs, mint };
}

// The single stored attempt for `scope` (these tests use one at a time), or
// the attempt for `key` when given.
const stored = (fs: ReturnType<typeof fakeStorage>, scope = A, key?: string): PersistedCreateAttempt | null => {
  const prefix = createAttemptStorageKey(scope, "");
  const entries = Array.from(fs.map.entries()).filter(([k]) => k.startsWith(prefix) && (key === undefined || k === prefix + key));
  if (entries.length === 0) return null;
  if (entries.length > 1) throw new Error("more than one stored attempt");
  const raw = entries[0][1];
  const v = JSON.parse(raw);
  return { key: v.key, payload: v.payload, context: v.context, status: v.status, reason: v.reason, createdAtMs: v.createdAtMs };
};

describe("persist before dispatch", () => {
  test("the in-flight record (key, exact payload, context, status, time) exists before the callable is invoked", async () => {
    const fs = fakeStorage();
    let seen: PersistedCreateAttempt | null = null;
    const { c, create } = setup({ steps: [], storage: fs });
    create.mockImplementation(async (req: TeacherUnitsCreateRequest) => {
      seen = stored(fs);
      expect(req.idempotencyKey).toBe("key_00000001");
      return { unit: unit(), replayed: false };
    });
    await c.submit(PAYLOAD);
    expect(seen).toEqual({
      key: "key_00000001",
      payload: PAYLOAD,
      context: A,
      status: "inFlight",
      reason: null,
      createdAtMs: T0,
    });
    expect(c.state().kind).toBe("created");
    expect(stored(fs)).toBeNull();
  });

  test("quota error before dispatch blocks the create: nothing sent, state unchanged", async () => {
    const fs = fakeStorage();
    fs.opts.failSet = true;
    const { c, create } = setup({ steps: [{ unit: unit(), replayed: false }], storage: fs });
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "storageUnavailable" });
    expect(create).not.toHaveBeenCalled();
    expect(c.state()).toEqual({ kind: "idle" });
  });

  test("blocked storage (reads throw) blocks the create", async () => {
    const fs = fakeStorage();
    fs.opts.failGet = true;
    const { c, create } = setup({ steps: [], storage: fs });
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "storageUnavailable" });
    expect(create).not.toHaveBeenCalled();
  });

  test("a save hook that throws is treated as unavailable", async () => {
    const { create } = scripted([]);
    const c = createUnitCreateCoordinator({
      create,
      readSessionContext: () => A,
      persistence: {
        save: () => {
          throw new Error("boom");
        },
        clear: () => true,
      },
    });
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "storageUnavailable" });
    expect(create).not.toHaveBeenCalled();
  });

  test("another tab's attempt is never overwritten: both attempts keep independent records", async () => {
    const fs = fakeStorage();
    const other = setup({ steps: ["hang"], storage: fs, mint: keys("key_OTHERTAB") });
    void other.c.submit(PAYLOAD);
    // This coordinator was created before the other tab saved.
    const store = createTeacherUnitCreateAttemptStore(A, () => fs.storage);
    const { create } = scripted(["hang"]);
    const c = createUnitCreateCoordinator({ create, readSessionContext: () => A, persistence: store, mint: keys("key_THISTAB") });
    void c.submit({ ...PAYLOAD, title: "Water" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(stored(fs, A, "key_OTHERTAB")).toMatchObject({ status: "inFlight", payload: PAYLOAD });
    expect(stored(fs, A, "key_THISTAB")).toMatchObject({ status: "inFlight", payload: { title: "Water" } });
  });

  test("a mismatched entry under the attempt's own key blocks dispatch (never replaced)", async () => {
    const fs = fakeStorage();
    fs.map.set(createAttemptStorageKey(A, "key_00000001"), "{garbage");
    const { c, create } = setup({ steps: [], storage: fs });
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "pendingAttemptExists" });
    expect(create).not.toHaveBeenCalled();
    expect(fs.map.get(createAttemptStorageKey(A, "key_00000001"))).toBe("{garbage");
  });

  test("no session at dispatch: nothing saved, nothing sent", async () => {
    const fs = fakeStorage();
    const { c, create } = setup({ steps: [], storage: fs, session: () => null });
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "noSession" });
    expect(create).not.toHaveBeenCalled();
    expect(fs.map.size).toBe(0);
  });
});

describe("interrupted create recovery", () => {
  test("an in-flight attempt interrupted by reload restores as unresolved and reconciles with the same key and payload", async () => {
    const fs = fakeStorage();
    const first = setup({ steps: ["hang"], storage: fs });
    void first.c.submit(PAYLOAD);
    expect(first.c.state().kind).toBe("inFlight");

    // Reload / controller replacement: a brand-new coordinator from storage.
    const second = setup({ steps: [{ unit: unit(), replayed: true }], storage: fs, mint: keys("key_NEVERUSED") });
    const s = second.c.state();
    expect(s.kind).toBe("unresolved");
    if (s.kind !== "unresolved") throw new Error();
    expect(s.reason).toBe("uncertain");
    expect(s.key).toBe("key_00000001");
    expect(s.payload).toEqual(PAYLOAD);
    expect(s.error.recovery).toBe("reconcileCreate");

    // Never silently minted: submit is refused while unresolved.
    expect(await second.c.submit({ ...PAYLOAD, title: "Different" })).toEqual({ kind: "blocked", reason: "unresolved" });
    expect(second.mint).not.toHaveBeenCalled();

    const r = await second.c.reconcile();
    expect(r.kind).toBe("settled");
    expect(second.calls).toEqual([{ ...PAYLOAD, idempotencyKey: "key_00000001", expectedSchoolId: "schoolA" }]);
    expect(second.c.state()).toEqual({ kind: "created", unit: unit(), replayed: true });
    expect(stored(fs)).toBeNull();
    expect(second.mint).not.toHaveBeenCalled();
  });

  test("a network failure is persisted as unresolved and survives a reload", async () => {
    const fs = fakeStorage();
    const first = setup({ steps: [httpsError("unavailable")], storage: fs });
    await first.c.submit(PAYLOAD);
    expect(stored(fs)).toMatchObject({ status: "unresolved", reason: "uncertain", key: "key_00000001", createdAtMs: T0 });
    const second = setup({ steps: [], storage: fs });
    expect(second.c.state()).toMatchObject({ kind: "unresolved", reason: "uncertain", key: "key_00000001" });
  });

  test("an unauthorized result restores as unauthorized and still requires reauthorization", async () => {
    const fs = fakeStorage();
    await setup({ steps: [httpsError("permission-denied", "account-inactive")], storage: fs }).c.submit(PAYLOAD);
    const second = setup({ steps: [], storage: fs });
    expect(second.c.state()).toMatchObject({ kind: "unresolved", reason: "unauthorized" });
    expect(await second.c.reconcile()).toEqual({ kind: "blocked", reason: "awaitingReauthorization" });
    expect(second.create).not.toHaveBeenCalled();
  });

  test("reconcile keeps the original createdAtMs (the receipt clock does not restart)", async () => {
    const fs = fakeStorage();
    await setup({ steps: [httpsError("unavailable")], storage: fs, now: () => T0 }).c.submit(PAYLOAD);
    const second = setup({ steps: ["hang"], storage: fs, now: () => T0 + 60_000 });
    void second.c.reconcile();
    expect(stored(fs)).toMatchObject({ status: "inFlight", createdAtMs: T0 });
  });
});

describe("cross-account isolation", () => {
  test("another teacher's restored attempt is never replayed (context mismatch)", async () => {
    const fs = fakeStorage();
    await setup({ steps: [httpsError("unavailable")], storage: fs }).c.submit(PAYLOAD);
    // Same browser, teacher B signed in, but a (buggy) caller handed A's
    // record to a coordinator whose live session is B.
    const listed = createTeacherUnitCreateAttemptStore(A, () => fs.storage).list();
    if (listed.kind !== "ok" || listed.records.length !== 1) throw new Error();
    const read = { record: listed.records[0] };
    const { create } = scripted([]);
    const c = createUnitCreateCoordinator({
      create,
      readSessionContext: () => B,
      persistence: createTeacherUnitCreateAttemptStore(B, () => fs.storage),
      restore: read.record,
    });
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "contextMismatch" });
    expect(create).not.toHaveBeenCalled();
  });

  test("teacher B's scoped store never sees teacher A's attempt", async () => {
    const fs = fakeStorage();
    await setup({ steps: [httpsError("unavailable")], storage: fs }).c.submit(PAYLOAD);
    const b = setup({ steps: [{ unit: unit({ unitId: "BbBbBbBbBbBbBbBbBbBb" }), replayed: false }], storage: fs, scope: B, mint: keys("key_BBBBBBBB") });
    expect(b.c.state()).toEqual({ kind: "idle" });
    await b.c.submit(PAYLOAD);
    expect(b.calls[0].idempotencyKey).toBe("key_BBBBBBBB");
    // A's unresolved record is untouched.
    expect(stored(fs, A)).toMatchObject({ key: "key_00000001", status: "unresolved" });
  });

  test("an account switch between persist and reconcile blocks dispatch", async () => {
    const fs = fakeStorage();
    let live: TeacherUnitCreateContext | null = A;
    const { c, create } = setup({ steps: [httpsError("unavailable")], storage: fs, session: () => live });
    await c.submit(PAYLOAD);
    live = B;
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "contextMismatch" });
    live = null;
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "noSession" });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("persistence failure after dispatch", () => {
  test("storage failing during the response keeps the key in memory and the in-flight record on disk", async () => {
    const fs = fakeStorage();
    const { c, create } = setup({ steps: [], storage: fs });
    create.mockImplementationOnce(async () => {
      fs.opts.failSet = true;
      throw httpsError("deadline-exceeded");
    });
    await c.submit(PAYLOAD);
    expect(c.state()).toMatchObject({ kind: "unresolved", key: "key_00000001", reason: "uncertain" });
    // The failed "unresolved" save left the verified in-flight record, which
    // restores conservatively as unresolved.
    expect(stored(fs)).toMatchObject({ key: "key_00000001", status: "inFlight" });
    fs.opts.failSet = false;
    const reloaded = setup({ steps: [], storage: fs });
    expect(reloaded.c.state()).toMatchObject({ kind: "unresolved", key: "key_00000001" });
  });

  test("reconcile still resends the same key when storage is unavailable (same-key replay cannot duplicate)", async () => {
    const fs = fakeStorage();
    const { c, calls } = setup({ steps: [httpsError("unavailable"), { unit: unit(), replayed: true }], storage: fs });
    await c.submit(PAYLOAD);
    fs.opts.failSet = true;
    fs.opts.failGet = true;
    await c.reconcile();
    expect(calls.map((r) => r.idempotencyKey)).toEqual(["key_00000001", "key_00000001"]);
    expect(c.state().kind).toBe("created");
    // Cleanup could not be confirmed and is not assumed.
    expect(c.hasUnclearedRecord()).toBe(true);
  });

  test("failed cleanup after a confirmed create leaves a record that can only replay, never duplicate", async () => {
    const fs = fakeStorage();
    fs.opts.ignoreRemove = true;
    const first = setup({ steps: [{ unit: unit(), replayed: false }], storage: fs });
    await first.c.submit(PAYLOAD);
    expect(first.c.state().kind).toBe("created");
    expect(first.c.hasUnclearedRecord()).toBe(true);
    expect(stored(fs)).toMatchObject({ key: "key_00000001", status: "inFlight" });

    // Reload: the stale record restores as unresolved; reconciling replays.
    fs.opts.ignoreRemove = false;
    const second = setup({ steps: [{ unit: unit(), replayed: true }], storage: fs, mint: keys("key_NEVERUSED") });
    expect(second.c.state()).toMatchObject({ kind: "unresolved", key: "key_00000001" });
    await second.c.reconcile();
    expect(second.calls[0].idempotencyKey).toBe("key_00000001");
    expect(second.c.state()).toMatchObject({ kind: "created", replayed: true });
    expect(second.mint).not.toHaveBeenCalled();
  });

  test("after an uncleared confirmed create, a new intent may replace that settled record", async () => {
    const fs = fakeStorage();
    fs.opts.ignoreRemove = true;
    const { c, calls } = setup({
      steps: [{ unit: unit(), replayed: false }, { unit: unit({ unitId: "ZzZzZzZzZzZzZzZzZzZz" }), replayed: false }],
      storage: fs,
    });
    await c.submit(PAYLOAD);
    expect(c.beginNewUnit()).toBe(true);
    fs.opts.ignoreRemove = false;
    await c.submit({ ...PAYLOAD, title: "Water Systems" });
    expect(calls.map((r) => r.idempotencyKey)).toEqual(["key_00000001", "key_00000002"]);
    expect(c.hasUnclearedRecord()).toBe(false);
  });

  test("a confirmed pre-commit rejection clears the record and allows a corrected resubmit", async () => {
    const fs = fakeStorage();
    const { c, calls } = setup({
      steps: [httpsError("invalid-argument", "teacherUnits.invalidTitle"), { unit: unit(), replayed: false }],
      storage: fs,
    });
    await c.submit(PAYLOAD);
    expect(c.state().kind).toBe("rejected");
    expect(stored(fs)).toBeNull();
    await c.submit(PAYLOAD);
    expect(calls.map((r) => r.idempotencyKey)).toEqual(["key_00000001", "key_00000002"]);
  });
});

describe("receipt-expired uncertainty", () => {
  test("replay window sits inside the seven-day receipt retention", () => {
    expect(CREATE_ATTEMPT_REPLAY_WINDOW_MS).toBeLessThan(7 * 24 * 60 * 60 * 1000);
    expect(isCreateReplayEligible(T0, T0 + CREATE_ATTEMPT_REPLAY_WINDOW_MS)).toBe(true);
    expect(isCreateReplayEligible(T0, T0 + CREATE_ATTEMPT_REPLAY_WINDOW_MS + 1)).toBe(false);
    expect(isCreateReplayEligible(T0 + 60 * 60 * 1000, T0)).toBe(false);
    expect(isCreateReplayEligible(Number.NaN, T0)).toBe(false);
  });

  test("an old restored attempt cannot be reconciled and is never deleted automatically", async () => {
    const fs = fakeStorage();
    await setup({ steps: [httpsError("unavailable")], storage: fs, now: () => T0 }).c.submit(PAYLOAD);
    const later = T0 + 7 * 24 * 60 * 60 * 1000;
    const second = setup({ steps: [], storage: fs, now: () => later });
    const s = second.c.state();
    expect(s).toMatchObject({ kind: "unresolved", reason: "replayExpired", key: "key_00000001" });
    if (s.kind !== "unresolved") throw new Error();
    expect(s.error.recovery).toBe("refresh");
    expect(s.error.message).toMatch(/too old/);
    expect(await second.c.reconcile()).toEqual({ kind: "blocked", reason: "replayExpired" });
    expect(second.create).not.toHaveBeenCalled();
    expect(stored(fs)).toMatchObject({ key: "key_00000001" });
    // New intent only through explicit abandon + beginNewUnit.
    expect(await second.c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "unresolved" });
    expect(second.c.abandon()).toBe(true);
    expect(stored(fs)).toMatchObject({ status: "abandoned", reason: "replayExpired" });
    expect(second.c.beginNewUnit()).toBe(true);
    expect(stored(fs)).toBeNull();
  });

  test("an attempt that ages out while the page stays open is caught at reconcile time", async () => {
    const fs = fakeStorage();
    let clock = T0;
    const { c, create } = setup({ steps: [httpsError("unavailable")], storage: fs, now: () => clock });
    await c.submit(PAYLOAD);
    clock = T0 + CREATE_ATTEMPT_REPLAY_WINDOW_MS + 1;
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "replayExpired" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(c.state()).toMatchObject({ kind: "unresolved", reason: "replayExpired" });
    expect(stored(fs)).toMatchObject({ status: "unresolved", reason: "replayExpired" });
  });

  test("a future-dated record (clock moved) is not trusted for replay", () => {
    const fs = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(A, () => fs.storage);
    store.save({ key: "key_00000001", payload: PAYLOAD, context: A, status: "inFlight", reason: null, createdAtMs: T0 + 24 * 60 * 60 * 1000 });
    expect(setup({ steps: [], storage: fs, now: () => T0 }).c.state()).toMatchObject({ reason: "replayExpired" });
  });
});

describe("abandoned attempts and explicit new-unit intent", () => {
  test("abandoned survives a reload and still warns until beginNewUnit", async () => {
    const fs = fakeStorage();
    const first = setup({ steps: [httpsError("unavailable")], storage: fs });
    await first.c.submit(PAYLOAD);
    first.c.abandon();
    const second = setup({ steps: [], storage: fs });
    expect(second.c.state()).toMatchObject({ kind: "abandoned", key: "key_00000001", payload: PAYLOAD });
    expect(await second.c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "newUnitIntentRequired" });
    expect(second.c.beginNewUnit()).toBe(true);
    expect(second.c.state()).toEqual({ kind: "idle" });
  });

  test("beginNewUnit refuses to drop an abandoned warning whose record could not be removed", async () => {
    const fs = fakeStorage();
    const { c } = setup({ steps: [httpsError("unavailable")], storage: fs });
    await c.submit(PAYLOAD);
    c.abandon();
    fs.opts.failRemove = true;
    expect(c.beginNewUnit()).toBe(false);
    expect(c.state().kind).toBe("abandoned");
  });

  test("a failed abandoned save leaves the more conservative unresolved record", async () => {
    const fs = fakeStorage();
    const { c } = setup({ steps: [httpsError("unavailable")], storage: fs });
    await c.submit(PAYLOAD);
    fs.opts.failSet = true;
    expect(c.abandon()).toBe(true);
    expect(stored(fs)).toMatchObject({ status: "unresolved" });
  });
});

describe("duplicate-create prevention", () => {
  test("double submit while in flight and resubmit after creation never dispatch twice", async () => {
    const fs = fakeStorage();
    const { c, create } = setup({ steps: [{ unit: unit(), replayed: false }], storage: fs });
    const p1 = c.submit(PAYLOAD);
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "inFlight" });
    await p1;
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "newUnitIntentRequired" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("restore is ignored without persistence (certified U2.1 behavior)", () => {
    const { create } = scripted([]);
    const c = createUnitCreateCoordinator({
      create,
      readSessionContext: () => A,
      restore: { key: "key_00000001", payload: PAYLOAD, context: A, status: "inFlight", reason: null, createdAtMs: T0 },
    });
    expect(c.state()).toEqual({ kind: "idle" });
    expect(c.hasUnclearedRecord()).toBe(false);
  });
});
