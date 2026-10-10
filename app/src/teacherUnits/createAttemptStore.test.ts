import {
  CREATE_ATTEMPT_STORAGE_PREFIX,
  createAttemptScopePrefix,
  createAttemptStorageKey,
  createTeacherUnitCreateAttemptStore,
  legacyCreateAttemptStorageKey,
} from "./createAttemptStore";
import type { PersistedCreateAttempt } from "./saveCoordination";

// U2.2 attempt-keyed create-attempt store: scoping, per-attempt entries,
// strict validation, and storage failures.

type FakeStorageOptions = {
  failGet?: boolean;
  failSet?: boolean;
  failRemove?: boolean;
  failKey?: boolean;
  // setItem "succeeds" but stores something else (silent corruption).
  corruptSet?: boolean;
  // removeItem "succeeds" but the value stays.
  ignoreRemove?: boolean;
};

function fakeStorage(opts: FakeStorageOptions = {}) {
  const map = new Map<string, string>();
  const s = {
    get length() {
      return map.size;
    },
    key: (i: number) => {
      if (opts.failKey) throw new Error("SecurityError");
      return Array.from(map.keys())[i] ?? null;
    },
    getItem: (k: string) => {
      if (opts.failGet) throw new Error("SecurityError");
      return map.has(k) ? (map.get(k) as string) : null;
    },
    setItem: (k: string, v: string) => {
      if (opts.failSet) {
        const e = new Error("QuotaExceededError");
        e.name = "QuotaExceededError";
        throw e;
      }
      map.set(k, opts.corruptSet ? v.slice(0, 10) : v);
    },
    removeItem: (k: string) => {
      if (opts.failRemove) throw new Error("SecurityError");
      if (!opts.ignoreRemove) map.delete(k);
    },
    clear: () => map.clear(),
  };
  return Object.assign(s as unknown as Storage, { map, opts });
}

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const record = (over: Partial<PersistedCreateAttempt> = {}): PersistedCreateAttempt => ({
  key: "key_00000001",
  payload: { grade: "7", title: "Earth Systems", description: "Rocks" },
  context: SCOPE,
  status: "inFlight",
  reason: null,
  createdAtMs: 1_000,
  ...over,
});
const keysOf = (r: ReturnType<ReturnType<typeof createTeacherUnitCreateAttemptStore>["list"]>) =>
  r.kind === "ok" ? r.records.map((x) => x.key) : null;

describe("createAttemptStore (attempt-keyed)", () => {
  test("save writes under the attempt's own key, verifies, and lists it back exactly", () => {
    const storage = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    expect(store.list()).toEqual({ kind: "ok", records: [], unreadable: [] });
    expect(store.save(record())).toBe("saved");
    expect(storage.map.has(createAttemptStorageKey(SCOPE, "key_00000001"))).toBe(true);
    expect(createAttemptStorageKey(SCOPE, "k").startsWith(CREATE_ATTEMPT_STORAGE_PREFIX)).toBe(true);
    expect(store.list()).toEqual({ kind: "ok", records: [record()], unreadable: [] });
  });

  test("independent attempts never overwrite each other and list oldest first", () => {
    const storage = fakeStorage();
    const tab1 = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    const tab2 = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    expect(tab1.save(record({ key: "key_BBBBBBBB", createdAtMs: 2_000 }))).toBe("saved");
    expect(tab2.save(record({ key: "key_AAAAAAAA", createdAtMs: 3_000 }))).toBe("saved");
    expect(tab1.save(record({ key: "key_CCCCCCCC", createdAtMs: 1_000 }))).toBe("saved");
    expect(keysOf(tab2.list())).toEqual(["key_CCCCCCCC", "key_BBBBBBBB", "key_AAAAAAAA"]);
  });

  test("clear removes exactly one attempt and verifies removal", () => {
    const storage = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    store.save(record({ key: "key_AAAAAAAA" }));
    store.save(record({ key: "key_BBBBBBBB" }));
    expect(store.clear("key_AAAAAAAA")).toBe(true);
    expect(keysOf(store.list())).toEqual(["key_BBBBBBBB"]);
    expect(store.clear("key_AAAAAAAA")).toBe(true);
    expect(store.clear("bad key!")).toBe(false);
  });

  test("an attempt may update only its own entry with the same pinned payload", () => {
    const storage = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    store.save(record());
    expect(store.save(record({ status: "unresolved", reason: "uncertain" }))).toBe("saved");
    expect(store.save(record({ payload: { grade: "7", title: "Other", description: "" } }))).toBe("occupied");
    expect(store.list()).toMatchObject({ records: [{ status: "unresolved", payload: { title: "Earth Systems" } }] });
  });

  test("scope is teacher AND school: another account or school never sees the attempt", () => {
    const storage = fakeStorage();
    const a = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    a.save(record());
    const otherTeacher = createTeacherUnitCreateAttemptStore({ teacherId: "teacherB", schoolId: "schoolA" }, () => storage);
    const otherSchool = createTeacherUnitCreateAttemptStore({ teacherId: "teacherA", schoolId: "schoolB" }, () => storage);
    expect(otherTeacher.list()).toEqual({ kind: "ok", records: [], unreadable: [] });
    expect(otherSchool.list()).toEqual({ kind: "ok", records: [], unreadable: [] });
    expect(otherTeacher.clear("key_00000001")).toBe(true);
    expect(keysOf(a.list())).toEqual(["key_00000001"]);
  });

  test("refuses to save a record whose context is not the store's scope", () => {
    const storage = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    expect(store.save(record({ context: { teacherId: "teacherB", schoolId: "schoolA" } }))).toBe("unavailable");
    expect(storage.map.size).toBe(0);
  });

  test("a record copied into another account's scope is unreadable, never replayed", () => {
    const storage = fakeStorage();
    createTeacherUnitCreateAttemptStore(SCOPE, () => storage).save(record());
    const raw = storage.map.get(createAttemptStorageKey(SCOPE, "key_00000001")) as string;
    const bScope = { teacherId: "teacherB", schoolId: "schoolA" };
    storage.map.set(createAttemptStorageKey(bScope, "key_00000001"), raw);
    expect(createTeacherUnitCreateAttemptStore(bScope, () => storage).list()).toEqual({
      kind: "ok",
      records: [],
      unreadable: [createAttemptStorageKey(bScope, "key_00000001")],
    });
  });

  test("a record stored under a different key than it names is unreadable", () => {
    const storage = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    store.save(record());
    const raw = storage.map.get(createAttemptStorageKey(SCOPE, "key_00000001")) as string;
    storage.map.set(createAttemptStorageKey(SCOPE, "key_00000002"), raw);
    expect(store.list()).toMatchObject({ unreadable: [createAttemptStorageKey(SCOPE, "key_00000002")] });
  });

  test("scope ids are encoded so ids cannot alias another scope", () => {
    expect(createAttemptScopePrefix({ teacherId: "a/b", schoolId: "c" })).not.toBe(
      createAttemptScopePrefix({ teacherId: "a", schoolId: "b/c" }),
    );
    expect(createAttemptScopePrefix({ teacherId: "a.b", schoolId: "c" })).not.toBe(
      createAttemptScopePrefix({ teacherId: "a", schoolId: "b.c" }),
    );
  });

  const valid = { v: 2, key: "key_00000001", status: "inFlight", reason: null, createdAtMs: 1, context: SCOPE, payload: { grade: "7", title: "t", description: "" } };
  test.each([
    ["not JSON", "{oops"],
    ["wrong version", JSON.stringify({ ...valid, v: 1 })],
    ["bad key grammar", JSON.stringify({ ...valid, key: "short" })],
    ["bad status", JSON.stringify({ ...valid, status: "done" })],
    ["inFlight with a reason", JSON.stringify({ ...valid, reason: "uncertain" })],
    ["unresolved without a reason", JSON.stringify({ ...valid, status: "unresolved", reason: null })],
    ["bad reason", JSON.stringify({ ...valid, status: "unresolved", reason: "nope" })],
    ["bad grade", JSON.stringify({ ...valid, payload: { ...valid.payload, grade: "9" } })],
    ["empty title", JSON.stringify({ ...valid, payload: { ...valid.payload, title: "   " } })],
    ["title over 120 code points", JSON.stringify({ ...valid, payload: { ...valid.payload, title: "x".repeat(121) } })],
    ["title with a control character", JSON.stringify({ ...valid, payload: { ...valid.payload, title: "a\u0000b" } })],
    ["description over 1000 code points", JSON.stringify({ ...valid, payload: { ...valid.payload, description: "d".repeat(1001) } })],
    ["description with a forbidden control", JSON.stringify({ ...valid, payload: { ...valid.payload, description: "a\u000bb" } })],
    ["non-finite time", JSON.stringify({ ...valid, createdAtMs: "x" })],
    ["zero time", JSON.stringify({ ...valid, createdAtMs: 0 })],
    ["array", "[]"],
  ])("malformed record (%s) is unreadable and never deleted automatically", (_label, raw) => {
    const storage = fakeStorage();
    const k = createAttemptStorageKey(SCOPE, "key_00000001");
    storage.map.set(k, raw);
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    expect(store.list()).toEqual({ kind: "ok", records: [], unreadable: [k] });
    expect(storage.map.get(k)).toBe(raw);
    // And it is never overwritten by a save for that key.
    expect(store.save(record())).toBe("occupied");
    expect(storage.map.get(k)).toBe(raw);
  });

  test("boundary values the server accepts are readable", () => {
    const storage = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    const r = record({ payload: { grade: "8", title: "😀".repeat(120), description: "line\nbreak\ttab\r".padEnd(1000, "x") } });
    expect(store.save(r)).toBe("saved");
    expect(keysOf(store.list())).toEqual(["key_00000001"]);
  });

  test("the pre-certification single-slot record is surfaced as unreadable, not ignored", () => {
    const storage = fakeStorage();
    storage.map.set(legacyCreateAttemptStorageKey(SCOPE), JSON.stringify({ v: 1, key: "key_00000001" }));
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    expect(store.list()).toEqual({ kind: "ok", records: [], unreadable: [legacyCreateAttemptStorageKey(SCOPE)] });
    expect(store.discardUnreadable(legacyCreateAttemptStorageKey(SCOPE))).toBe(true);
    expect(store.list()).toEqual({ kind: "ok", records: [], unreadable: [] });
  });

  test("blocked storage (reads, enumeration, or storage missing) is unavailable", () => {
    for (const opts of [{ failGet: true }, { failKey: true }]) {
      const storage = fakeStorage(opts);
      storage.map.set(createAttemptStorageKey(SCOPE, "key_00000001"), "x");
      const blocked = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
      expect(blocked.list()).toEqual({ kind: "unavailable" });
    }
    const failGet = createTeacherUnitCreateAttemptStore(SCOPE, () => fakeStorage({ failGet: true }));
    expect(failGet.save(record())).toBe("unavailable");
    expect(failGet.clear("key_00000001")).toBe(false);
    const missing = createTeacherUnitCreateAttemptStore(SCOPE, () => null);
    expect(missing.list()).toEqual({ kind: "unavailable" });
    expect(missing.save(record())).toBe("unavailable");
    const throwing = createTeacherUnitCreateAttemptStore(SCOPE, () => {
      throw new Error("denied");
    });
    expect(throwing.list()).toEqual({ kind: "unavailable" });
  });

  test("quota error on write is unavailable and leaves nothing", () => {
    const storage = fakeStorage({ failSet: true });
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    expect(store.save(record())).toBe("unavailable");
    expect(storage.map.size).toBe(0);
  });

  test("a write that does not read back identically is not treated as saved", () => {
    const storage = fakeStorage({ corruptSet: true });
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    expect(store.save(record())).toBe("unavailable");
  });

  test("a record that fails strict validation is refused before writing", () => {
    const storage = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    expect(store.save(record({ payload: { grade: "7", title: "x".repeat(121), description: "" } }))).toBe("unavailable");
    expect(storage.map.size).toBe(0);
  });

  test("failed cleanup (remove throws or is ignored) is reported, never assumed", () => {
    const storage = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    store.save(record());
    storage.opts.failRemove = true;
    expect(store.clear("key_00000001")).toBe(false);
    storage.opts.failRemove = false;
    storage.opts.ignoreRemove = true;
    expect(store.clear("key_00000001")).toBe(false);
    expect(keysOf(store.list())).toEqual(["key_00000001"]);
  });

  test("discardUnreadable removes only an unreadable entry of this scope", () => {
    const storage = fakeStorage();
    const store = createTeacherUnitCreateAttemptStore(SCOPE, () => storage);
    store.save(record());
    const good = createAttemptStorageKey(SCOPE, "key_00000001");
    expect(store.discardUnreadable(good)).toBe(false);
    const bad = createAttemptStorageKey(SCOPE, "key_00000002");
    storage.map.set(bad, "{oops");
    const other = createAttemptStorageKey({ teacherId: "teacherB", schoolId: "schoolA" }, "key_00000003");
    storage.map.set(other, "{oops");
    expect(store.discardUnreadable(other)).toBe(false);
    expect(storage.map.has(other)).toBe(true);
    expect(store.discardUnreadable(bad)).toBe(true);
    expect(store.list()).toEqual({ kind: "ok", records: [record()], unreadable: [] });
  });

  test("invalid scope is unavailable", () => {
    const store = createTeacherUnitCreateAttemptStore({ teacherId: "", schoolId: "s" }, () => fakeStorage());
    expect(store.list()).toEqual({ kind: "unavailable" });
    expect(store.save(record({ context: { teacherId: "", schoolId: "s" } }))).toBe("unavailable");
  });
});
