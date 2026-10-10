import { createAttemptStorageKey, createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import {
  createUnitCreateCoordinator,
  type PersistedCreateAttempt,
  type TeacherUnitCreateContext,
} from "./saveCoordination";
import type { TeacherUnit, TeacherUnitsCreateRequest, TeacherUnitsCreateResponse } from "./types";

// Regression tests for the U2.2 certification findings P1-A (concurrent
// tabs) and P1-C (malformed restored records). They use only the
// coordinator and persistence APIs, and inspect raw storage, so they
// reproduce the original failures and guard the corrected design.

const A: TeacherUnitCreateContext = { teacherId: "teacherA", schoolId: "schoolA" };
const T0 = 1_700_000_000_000;

// Shared "browser" storage with a hook that runs after each getItem, used
// to interleave a second tab between another tab's read and write.
function sharedStorage() {
  const map = new Map<string, string>();
  let afterGet: (() => void) | null = null;
  const storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => {
      const v = map.get(k) ?? null;
      const hook = afterGet;
      if (hook) {
        afterGet = null;
        hook();
      }
      return v;
    },
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as unknown as Storage;
  return {
    storage,
    map,
    interleaveOnce: (fn: () => void) => {
      afterGet = fn;
    },
  };
}

const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: "AbCdEfGhIjKlMnOpQrSt",
  grade: "7",
  title: "Earth",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: 1,
  updatedAtMillis: 1,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});

const hang = () => new Promise<TeacherUnitsCreateResponse>(() => undefined);

// Every stored attempt key, whatever the storage layout.
const storedAttemptKeys = (map: Map<string, string>): string[] =>
  Array.from(map.values())
    .map((v) => {
      try {
        return (JSON.parse(v) as { key?: unknown }).key;
      } catch {
        return undefined;
      }
    })
    .filter((k): k is string => typeof k === "string")
    .sort();

describe("P1-A: two tabs dispatching distinct create intents", () => {
  test("interleaved check/write in two tabs: both dispatched attempts keep durable records", async () => {
    const s = sharedStorage();
    const sent: TeacherUnitsCreateRequest[] = [];
    const create = jest.fn((req: TeacherUnitsCreateRequest) => {
      sent.push(req);
      return hang();
    });
    const tabA = createUnitCreateCoordinator({
      create,
      readSessionContext: () => A,
      persistence: createTeacherUnitCreateAttemptStore(A, () => s.storage),
      mint: () => "key_TABAAAAA",
      now: () => T0,
    });
    const tabB = createUnitCreateCoordinator({
      create,
      readSessionContext: () => A,
      persistence: createTeacherUnitCreateAttemptStore(A, () => s.storage),
      mint: () => "key_TABBBBBB",
      now: () => T0,
    });
    // Tab B runs its whole submit between tab A's first read and A's write.
    s.interleaveOnce(() => {
      void tabB.submit({ grade: "7", title: "From B", description: "" });
    });
    void tabA.submit({ grade: "7", title: "From A", description: "" });
    await Promise.resolve();

    const dispatched = sent.map((r) => r.idempotencyKey).sort();
    // Every dispatched attempt must have independent durable evidence.
    expect(storedAttemptKeys(s.map)).toEqual(expect.arrayContaining(dispatched));
    expect(dispatched.length).toBeGreaterThan(0);
  });

  test("cleanup by one tab never removes another tab's attempt", async () => {
    const s = sharedStorage();
    const a = createUnitCreateCoordinator({
      create: async () => ({ unit: unit(), replayed: false }),
      readSessionContext: () => A,
      persistence: createTeacherUnitCreateAttemptStore(A, () => s.storage),
      mint: () => "key_TABAAAAA",
      now: () => T0,
    });
    const b = createUnitCreateCoordinator({
      create: () => hang(),
      readSessionContext: () => A,
      persistence: createTeacherUnitCreateAttemptStore(A, () => s.storage),
      mint: () => "key_TABBBBBB",
      now: () => T0,
    });
    void b.submit({ grade: "7", title: "From B", description: "" });
    await a.submit({ grade: "7", title: "From A", description: "" });
    expect(storedAttemptKeys(s.map)).toContain("key_TABBBBBB");
    expect(storedAttemptKeys(s.map)).not.toContain("key_TABAAAAA");
  });
});

describe("P1-C: a malformed restored record is never deleted by a replay refusal", () => {
  test.each([
    ["title over the server limit", { title: "x".repeat(200), description: "" }, "teacherUnits.invalidTitle"],
    ["title with a control character", { title: "Earth\u0007", description: "" }, "teacherUnits.invalidTitle"],
    ["description over the server limit", { title: "Earth", description: "d".repeat(1500) }, "teacherUnits.invalidDescription"],
  ])("%s", async (_label, fields, code) => {
    const s = sharedStorage();
    const store = createTeacherUnitCreateAttemptStore(A, () => s.storage);
    const record: PersistedCreateAttempt = {
      key: "key_ORIGINAL",
      payload: { grade: "7", ...fields },
      context: A,
      status: "inFlight",
      reason: null,
      createdAtMs: T0,
    };
    // Seed the entry directly in the stored format, as a corrupted or
    // older record would appear.
    const storageKey = createAttemptStorageKey(A, record.key);
    const raw = JSON.stringify({ v: 2, ...record });
    s.map.set(storageKey, raw);

    // Store layer: strict server-rule validation reports it as unreadable,
    // so it is never restored for replay, and saving it is refused.
    const listed = store.list();
    expect(listed).toEqual({ kind: "ok", records: [], unreadable: [storageKey] });
    expect(store.save(record)).toBe("occupied");

    // Coordinator layer (defense in depth): even if such a record were
    // restored and resent, the refusal never settles it as rejected and
    // never deletes the evidence.
    const create = jest.fn(async () => {
      throw Object.assign(new Error("x"), { code: "invalid-argument", details: { code } });
    });
    const c = createUnitCreateCoordinator({
      create,
      readSessionContext: () => A,
      persistence: store,
      restore: record,
      now: () => T0,
    });
    await c.reconcile();
    expect(create).toHaveBeenCalledTimes(1);
    expect(c.state()).toMatchObject({ kind: "unresolved", reason: "replayRefused", key: "key_ORIGINAL" });
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "replayRefused" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(s.map.get(storageKey)).toBe(raw);
  });

  test("a valid restored attempt whose resend is refused stays unresolved with its record", async () => {
    const s = sharedStorage();
    const store = createTeacherUnitCreateAttemptStore(A, () => s.storage);
    const record: PersistedCreateAttempt = {
      key: "key_ORIGINAL",
      payload: { grade: "7", title: "Earth", description: "" },
      context: A,
      status: "unresolved",
      reason: "uncertain",
      createdAtMs: T0,
    };
    expect(store.save(record)).toBe("saved");
    const c = createUnitCreateCoordinator({
      create: async () => {
        throw Object.assign(new Error("x"), { code: "invalid-argument", details: { code: "teacherUnits.invalidRequest" } });
      },
      readSessionContext: () => A,
      persistence: store,
      restore: record,
      now: () => T0,
    });
    await c.reconcile();
    expect(c.state()).toMatchObject({ kind: "unresolved", reason: "replayRefused" });
    const listed = store.list();
    expect(listed.kind === "ok" && listed.records.map((r) => [r.key, r.status, r.reason])).toEqual([
      ["key_ORIGINAL", "unresolved", "replayRefused"],
    ]);
  });
});

describe("P1-B: school transfer between create and reconciliation (client side)", () => {
  // The strict guarantee needs a server change (TEACHER_UNITS.md §9.4,
  // "Open blocker"): the client only sees a school change once its live
  // context reflects it. These tests cover what the client can enforce.
  test("a visible school change blocks the same-key resend: no dispatch", async () => {
    const s = sharedStorage();
    let live: TeacherUnitCreateContext = A;
    const create = jest.fn(async () => {
      throw Object.assign(new Error("x"), { code: "unavailable" });
    });
    const c = createUnitCreateCoordinator({
      create,
      readSessionContext: () => live,
      persistence: createTeacherUnitCreateAttemptStore(A, () => s.storage),
      mint: () => "key_ORIGINAL",
      now: () => T0,
    });
    await c.submit({ grade: "7", title: "Earth", description: "" });
    live = { teacherId: "teacherA", schoolId: "schoolB" };
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "contextMismatch" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(storedAttemptKeys(s.map)).toEqual(["key_ORIGINAL"]);
  });

  test("school B's scope never lists school A's attempt", async () => {
    const s = sharedStorage();
    createTeacherUnitCreateAttemptStore(A, () => s.storage).save({
      key: "key_ORIGINAL", payload: { grade: "7", title: "Earth", description: "" }, context: A, status: "inFlight", reason: null, createdAtMs: T0,
    });
    const b = createTeacherUnitCreateAttemptStore({ teacherId: "teacherA", schoolId: "schoolB" }, () => s.storage);
    expect(b.list()).toEqual({ kind: "ok", records: [], unreadable: [] });
  });
});
