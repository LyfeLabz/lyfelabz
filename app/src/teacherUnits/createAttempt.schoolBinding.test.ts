import {
  classifyCreateFailure,
  createUnitCreateCoordinator,
  type PersistedCreateAttempt,
  type TeacherUnitCreateContext,
  type TeacherUnitCreatePayload,
} from "./saveCoordination";
import {
  createAttemptStorageKey,
  createTeacherUnitCreateAttemptStore,
  parseCreateAttemptRecord,
} from "./createAttemptStore";
import { normalizeTeacherUnitError } from "./errors";
import type {
  TeacherUnit,
  TeacherUnitsCallables,
  TeacherUnitsCreateRequest,
  TeacherUnitsCreateResponse,
  TeacherUnitsListResponse,
} from "./types";
import { createTeacherUnitsController } from "./unitsController";

// U2.2 P1-B: every create dispatch is bound to the school its intent began
// in (`expectedSchoolId`), a server `schoolContextChanged` refusal is kept as
// unresolved uncertainty, and an old server's `invalidRequest` is handled
// conservatively. Server behavior is proven separately against the real
// handler and the Firestore emulator (teacher-units.emulator.test.ts,
// "school binding: expectedSchoolId").

function fakeStorage() {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  } as unknown as Storage;
  return { storage, map };
}

const A: TeacherUnitCreateContext = { teacherId: "teacherA", schoolId: "schoolA" };
const A_IN_B: TeacherUnitCreateContext = { teacherId: "teacherA", schoolId: "schoolB" };
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

const SCHOOL_CHANGED = () => httpsError("failed-precondition", "teacherUnits.schoolContextChanged");
// What a server without `expectedSchoolId` support returns for the field.
const OLD_SERVER = () => httpsError("invalid-argument", "teacherUnits.invalidRequest");

type Step = TeacherUnitsCreateResponse | Error | "hang";

function scripted(steps: Step[]) {
  const calls: TeacherUnitsCreateRequest[] = [];
  const create = jest.fn((req: TeacherUnitsCreateRequest) => {
    calls.push({ ...req });
    const next = steps.shift();
    if (next === undefined) return Promise.reject(new Error("unscripted call"));
    if (next === "hang") return new Promise<TeacherUnitsCreateResponse>(() => undefined);
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
  return { create, calls };
}

function setup(opts: {
  steps: Step[];
  session?: () => TeacherUnitCreateContext | null;
  storage?: ReturnType<typeof fakeStorage>;
  restore?: boolean;
}) {
  const fs = opts.storage ?? fakeStorage();
  const store = createTeacherUnitCreateAttemptStore(A, () => fs.storage);
  const { create, calls } = scripted(opts.steps);
  const listed = store.list();
  const first = listed.kind === "ok" ? listed.records[0] ?? null : null;
  const c = createUnitCreateCoordinator({
    create,
    readSessionContext: opts.session ?? (() => A),
    mint: () => "key_00000001",
    persistence: store,
    restore: opts.restore === false ? null : first,
    now: () => T0,
  });
  return { c, create, calls, store, fs };
}

const stored = (fs: ReturnType<typeof fakeStorage>): PersistedCreateAttempt | null => {
  const raw = fs.map.get(createAttemptStorageKey(A, "key_00000001"));
  return raw === undefined ? null : parseCreateAttemptRecord(raw, A, "key_00000001");
};

describe("expectedSchoolId on every dispatch", () => {
  test("the first dispatch carries the school captured when the intent began", async () => {
    const { c, calls } = setup({ steps: [{ unit: unit(), replayed: false }] });
    await c.submit(PAYLOAD);
    expect(calls).toEqual([{ ...PAYLOAD, idempotencyKey: "key_00000001", expectedSchoolId: "schoolA" }]);
  });

  test("every reconcile resends the ORIGINAL school, key, and payload", async () => {
    const { c, calls } = setup({
      steps: [httpsError("unavailable"), httpsError("unavailable"), { unit: unit(), replayed: true }],
    });
    await c.submit(PAYLOAD);
    await c.reconcile();
    await c.reconcile();
    const expected = { ...PAYLOAD, idempotencyKey: "key_00000001", expectedSchoolId: "schoolA" };
    expect(calls).toEqual([expected, expected, expected]);
    expect(c.state().kind).toBe("created");
  });

  test("a restored attempt reconciles with the school from its durable record", async () => {
    const fs = fakeStorage();
    const first = setup({ steps: ["hang"], storage: fs });
    void first.c.submit(PAYLOAD);
    await Promise.resolve();
    expect(stored(fs)).toMatchObject({ status: "inFlight", context: A });

    // Reload: a new coordinator restores the interrupted attempt.
    const second = setup({ steps: [{ unit: unit(), replayed: true }], storage: fs });
    expect(second.c.state()).toMatchObject({ kind: "unresolved", reason: "uncertain", context: A });
    await second.c.reconcile();
    expect(second.calls).toEqual([{ ...PAYLOAD, idempotencyKey: "key_00000001", expectedSchoolId: "schoolA" }]);
  });

  test("never substitutes a newly authorized school: a live context in school B cannot resend", async () => {
    let live: TeacherUnitCreateContext = A;
    const { c, calls } = setup({ steps: [httpsError("unavailable")], session: () => live });
    await c.submit(PAYLOAD);
    live = A_IN_B;
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "contextMismatch" });
    expect(calls).toHaveLength(1);
    expect(calls.every((r) => r.expectedSchoolId === "schoolA")).toBe(true);
  });
});

describe("schoolContextChanged is unresolved uncertainty", () => {
  test("classification and feedback never claim the unit was not created", () => {
    const error = normalizeTeacherUnitError(SCHOOL_CHANGED());
    expect(error).toMatchObject({ category: "schoolContextChanged", code: "teacherUnits.schoolContextChanged" });
    expect(classifyCreateFailure(error)).toEqual({ kind: "unresolved", reason: "schoolContextChanged" });
  });

  test("on reconcile: keeps key, payload, school, and its record; never resends", async () => {
    const { c, calls, fs } = setup({ steps: [httpsError("unavailable"), SCHOOL_CHANGED()] });
    await c.submit(PAYLOAD);
    const settled = await c.reconcile();
    expect(settled.kind).toBe("settled");
    const s = c.state();
    expect(s).toMatchObject({
      kind: "unresolved",
      key: "key_00000001",
      payload: PAYLOAD,
      context: A,
      reason: "schoolContextChanged",
    });
    if (s.kind !== "unresolved") throw new Error("expected unresolved");
    expect(s.error.recovery).toBe("refresh");
    expect(s.error.message).toMatch(/couldn't confirm whether this unit was created/);
    expect(s.error.message).toMatch(/previous school/);
    expect(s.error.message).not.toMatch(/\u2014/);
    // Durable evidence is preserved with the reason.
    expect(stored(fs)).toMatchObject({
      key: "key_00000001",
      payload: PAYLOAD,
      context: A,
      status: "unresolved",
      reason: "schoolContextChanged",
    });
    // No automatic or manual resend against any school.
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "schoolContextChanged" });
    expect(await c.reconcile({ reauthorized: true })).toEqual({ kind: "blocked", reason: "schoolContextChanged" });
    expect(calls).toHaveLength(2);
    // A new unit still needs an explicit decision.
    expect(c.beginNewUnit()).toBe(false);
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "unresolved" });
  });

  test("on the first dispatch: also unresolved, never a confirmed rejection", async () => {
    const { c, fs } = setup({ steps: [SCHOOL_CHANGED()] });
    await c.submit(PAYLOAD);
    expect(c.state()).toMatchObject({ kind: "unresolved", reason: "schoolContextChanged", key: "key_00000001" });
    expect(stored(fs)).toMatchObject({ status: "unresolved", reason: "schoolContextChanged" });
  });

  test("restores after reload with reconciliation still disabled", async () => {
    const fs = fakeStorage();
    const first = setup({ steps: [SCHOOL_CHANGED()], storage: fs });
    await first.c.submit(PAYLOAD);
    const second = setup({ steps: [], storage: fs });
    expect(second.c.state()).toMatchObject({ kind: "unresolved", reason: "schoolContextChanged", context: A });
    expect(await second.c.reconcile()).toEqual({ kind: "blocked", reason: "schoolContextChanged" });
    expect(second.calls).toEqual([]);
  });
});

describe("a server that predates expectedSchoolId", () => {
  test("a reconcile refused with invalidRequest stays unresolved (replayRefused) and keeps its record", async () => {
    const { c, calls, fs } = setup({ steps: [httpsError("unavailable"), OLD_SERVER()] });
    await c.submit(PAYLOAD);
    await c.reconcile();
    expect(c.state()).toMatchObject({ kind: "unresolved", reason: "replayRefused", key: "key_00000001" });
    expect(stored(fs)).toMatchObject({ status: "unresolved", reason: "replayRefused", context: A });
    // Never retried without the school binding.
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "replayRefused" });
    expect(calls).toHaveLength(2);
    expect(calls.every((r) => r.expectedSchoolId === "schoolA")).toBe(true);
  });

  test("a restored in-flight attempt refused with invalidRequest stays unresolved", async () => {
    const fs = fakeStorage();
    const first = setup({ steps: ["hang"], storage: fs });
    void first.c.submit(PAYLOAD);
    await Promise.resolve();
    const second = setup({ steps: [OLD_SERVER()], storage: fs });
    await second.c.reconcile();
    expect(second.c.state()).toMatchObject({ kind: "unresolved", reason: "replayRefused" });
    expect(stored(fs)).toMatchObject({ status: "unresolved", reason: "replayRefused" });
  });

  test("a first dispatch refused with invalidRequest is a confirmed pre-commit rejection", async () => {
    // The old server rejects the unknown field during validation, before
    // any transaction, so nothing was written for this key.
    const { c, calls, fs } = setup({ steps: [OLD_SERVER()] });
    await c.submit(PAYLOAD);
    expect(c.state()).toMatchObject({ kind: "rejected" });
    expect(stored(fs)).toBeNull();
    expect(calls).toEqual([{ ...PAYLOAD, idempotencyKey: "key_00000001", expectedSchoolId: "schoolA" }]);
  });

  test("invalidExpectedSchoolId follows the same rules (rejection first, replayRefused on resend)", async () => {
    const bad = () => httpsError("invalid-argument", "teacherUnits.invalidExpectedSchoolId");
    const first = setup({ steps: [bad()] });
    await first.c.submit(PAYLOAD);
    expect(first.c.state().kind).toBe("rejected");

    const second = setup({ steps: [httpsError("unavailable"), bad()] });
    await second.c.submit(PAYLOAD);
    await second.c.reconcile();
    expect(second.c.state()).toMatchObject({ kind: "unresolved", reason: "replayRefused" });
  });
});

describe("store and controller", () => {
  test("the store accepts and round-trips schoolContextChanged records", () => {
    const fs = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(A, () => fs.storage);
    const record: PersistedCreateAttempt = {
      key: "key_00000001",
      payload: PAYLOAD,
      context: A,
      status: "unresolved",
      reason: "schoolContextChanged",
      createdAtMs: T0,
    };
    expect(store.save(record)).toBe("saved");
    const listed = store.list();
    expect(listed).toEqual({ kind: "ok", records: [record], unreadable: [] });
  });

  test("a schoolContextChanged attempt is set aside only after an authoritative check", async () => {
    const fs = fakeStorage();
    const c = {
      create: jest.fn().mockRejectedValueOnce(SCHOOL_CHANGED()),
      list: jest.fn(async (): Promise<TeacherUnitsListResponse> => ({ units: [] })),
      get: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      restore: jest.fn(),
      setResources: jest.fn(),
      reorder: jest.fn(),
    };
    const ctl = createTeacherUnitsController({
      callables: c as unknown as TeacherUnitsCallables,
      session: A,
      readCurrentContext: () => A,
      store: createTeacherUnitCreateAttemptStore(A, () => fs.storage),
      initialGrade: "7",
      now: () => T0,
      mint: () => "key_00000001",
    });
    await ctl.submitCreate(PAYLOAD);
    expect(c.create).toHaveBeenCalledWith({ ...PAYLOAD, idempotencyKey: "key_00000001", expectedSchoolId: "schoolA" });
    expect(ctl.getState().recoveries).toEqual([
      expect.objectContaining({ key: "key_00000001", own: true, state: expect.objectContaining({ reason: "schoolContextChanged" }) }),
    ]);
    await ctl.reconcileCreate("key_00000001");
    expect(ctl.getState().createBlocked).toBe("schoolContextChanged");
    expect(ctl.abandonCreate("key_00000001")).toBe(false);
    expect(ctl.getState().createBlocked).toBe("checkRequired");
    await ctl.checkRecovery();
    expect(ctl.abandonCreate("key_00000001")).toBe(true);
    expect(c.create).toHaveBeenCalledTimes(1);
    // The abandoned warning keeps its durable record until dismissed.
    expect(fs.map.has(createAttemptStorageKey(A, "key_00000001"))).toBe(true);
    ctl.dispose();
  });
});
