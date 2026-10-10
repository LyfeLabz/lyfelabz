/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await */
//
// U1A hermetic unit tests for the `teacherUnits*` callables. Runs in the
// default `npm test` (and CI) with an in-memory Firestore stand-in whose
// transaction models the read-set retry contract of
// `Firestore.runTransaction`. The emulator suite
// (`teacher-units.emulator.test.ts`) proves the same behavior against real
// Firestore transactions.

import type { CallableRequest } from "firebase-functions/v2/https";

type Row = { data: Record<string, any>; version: number };
const store = new Map<string, Row>();
let version = 0;
let autoId = 0;
const audits: Record<string, any>[] = [];
const SERVER_TS = { __serverTimestamp: true };

function materialize(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v === SERVER_TS ? { toMillis: () => 1_700_000_000_000 + version } : v;
  }
  return out;
}

function ref(path: string): any {
  return {
    path,
    id: path.split("/")[1],
    get: async () => {
      const row = store.get(path);
      return { exists: !!row, data: () => (row ? row.data : undefined) };
    },
  };
}

class Retry extends Error {}

type Query = { __query: { field: string; value: unknown }[]; max: number };

function runQuery(q: Query): { id: string; path: string; row: Row }[] {
  return [...store]
    .filter(([p]) => p.startsWith("teacherUnits/"))
    .filter(([, row]) => q.__query.every((f) => row.data[f.field] === f.value))
    .slice(0, q.max)
    .map(([p, row]) => ({ id: p.split("/")[1], path: p, row }));
}

function query(filters: { field: string; value: unknown }[]): any {
  return {
    where: (field: string, _op: string, value: unknown) => query([...filters, { field, value }]),
    limit: (max: number): Query => ({ __query: filters, max }),
  };
}

// Commit applies all staged writes or none: preconditions (create on an
// existing document, update of a missing one) are checked before anything
// is applied, and audit events are staged with the other writes, so an
// audit exists exactly when its transaction committed.
async function runTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const observed = new Map<string, number | null>();
    const staged: { kind: "create" | "update" | "audit"; path?: string; data: Record<string, any> }[] = [];
    const tx = {
      async get(r: any) {
        if (r.__query) {
          const rows = runQuery(r as Query);
          for (const row of rows) observed.set(row.path, row.row.version);
          return { size: rows.length, docs: rows.map((row) => ({ id: row.id, data: () => row.row.data })) };
        }
        const row = store.get(r.path);
        observed.set(r.path, row ? row.version : null);
        return { exists: !!row, data: () => (row ? row.data : undefined) };
      },
      create(r: any, data: Record<string, any>) {
        staged.push({ kind: "create", path: r.path, data });
      },
      update(r: any, data: Record<string, any>) {
        staged.push({ kind: "update", path: r.path, data });
      },
      audit(input: Record<string, any>) {
        staged.push({ kind: "audit", data: input });
      },
    };
    const result = await fn(tx);
    // Yield so simultaneous callbacks interleave before commit.
    await new Promise((resolve) => setImmediate(resolve));
    const moved = [...observed].some(([p, v]) => (store.get(p)?.version ?? null) !== v);
    if (moved) continue;
    for (const w of staged) {
      if (w.kind === "create" && store.has(w.path!)) {
        throw Object.assign(new Error("exists"), { code: 6 });
      }
      if (w.kind === "update" && !store.has(w.path!)) throw new Error("missing");
    }
    for (const w of staged) {
      if (w.kind === "audit") audits.push(w.data);
      else if (w.kind === "create") store.set(w.path!, { data: materialize(w.data), version: ++version });
      else {
        const row = store.get(w.path!)!;
        store.set(w.path!, { data: { ...row.data, ...materialize(w.data) }, version: ++version });
      }
    }
    return result;
  }
  throw Object.assign(new Retry("aborted"), { code: 10 });
}

const mockRequireDistrictContext = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => SERVER_TS },
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}));
jest.mock("firebase-functions/v2/https", () => ({ onCall: <T,>(h: T) => h }));
jest.mock("../shared", () => {
  const actual = jest.requireActual("../shared/types/teacher-unit");
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  const { isTransactionContention } = jest.requireActual("../shared/firestore/transaction");
  return {
    ...actual,
    PlatformError,
    isTransactionContention,
    platformCallable: (h: unknown) => h,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    requireDistrictContext: (...args: unknown[]) => mockRequireDistrictContext(...args),
    runFirestoreTransaction: (fn: (tx: any) => Promise<unknown>) => runTx(fn),
    userRecordDocRef: (uid: string) => ref(`users/${uid}`),
    schoolDocRef: (id: string) => ref(`schools/${id}`),
    teacherUnitDocRef: (id: string) => ref(`teacherUnits/${id}`),
    teacherUnitCreationDocRef: (id: string) => ref(`teacherUnits/${id}`),
    teacherUnitUpdateDocRef: (id: string) => ref(`teacherUnits/${id}`),
    teacherUnitCreateReceiptDocRef: (id: string) => ref(`teacherUnitCreateReceipts/${id}`),
    teacherUnitCreateReceiptCreationDocRef: (id: string) => ref(`teacherUnitCreateReceipts/${id}`),
    teacherUnitsCollectionRef: () => ({
      doc: () => ({ id: `Unit${String(++autoId).padStart(16, "0")}` }),
      where: (field: string, _op: string, value: unknown) => query([{ field, value }]),
    }),
    writeAuditEventInTransaction: (tx: { audit: (i: unknown) => void }, input: Record<string, any>) => {
      tx.audit(input);
      return { eventId: "e", record: input };
    },
  };
});

import { __teacherUnitsArchiveHandler } from "./teacher-units-archive";
import { __teacherUnitsCreateHandler } from "./teacher-units-create";
import { __teacherUnitsGetHandler } from "./teacher-units-get";
import { __teacherUnitsListHandler } from "./teacher-units-list";
import { __teacherUnitsRestoreHandler } from "./teacher-units-restore";
import { __teacherUnitsUpdateHandler } from "./teacher-units-update";

const TEACHER = "teacher-a";
const OTHER = "teacher-b";
const SCHOOL = "school-1";

function setUser(uid: string, data: Record<string, any>): void {
  store.set(`users/${uid}`, { data, version: ++version });
}

function req(uid: string, data: unknown): CallableRequest<unknown> {
  return { data, auth: { uid, token: {} } } as unknown as CallableRequest<unknown>;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return String((err as { code?: unknown }).code);
  }
  return "resolved";
}

function unitRows(): Record<string, any>[] {
  return [...store].filter(([p]) => p.startsWith("teacherUnits/")).map(([, r]) => r.data);
}

beforeEach(() => {
  store.clear();
  audits.length = 0;
  store.set(`schools/${SCHOOL}`, { data: { districtId: "district-1" }, version: ++version });
  setUser(TEACHER, { status: "active", role: "teacher", schoolId: SCHOOL });
  setUser(OTHER, { status: "active", role: "teacher", schoolId: SCHOOL });
  mockRequireDistrictContext.mockImplementation(async (r: CallableRequest<unknown>) => {
    const uid = r.auth?.uid;
    if (!uid) throw Object.assign(new Error("unauth"), { code: "unauthenticated" });
    const user = store.get(`users/${uid}`)?.data;
    if (!user || user.status !== "active") {
      throw Object.assign(new Error("inactive"), { code: "account-inactive" });
    }
    return { uid, role: user.role, schoolId: user.schoolId, districtId: "district-1" };
  });
});

let keySeq = 0;
// Adds a fresh idempotencyKey unless the payload names one.
function withKey(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data) && !("idempotencyKey" in data)) {
    return { ...(data as Record<string, unknown>), idempotencyKey: `key-${String(++keySeq).padStart(8, "0")}` };
  }
  return data;
}
const create = (uid: string, data: unknown) => __teacherUnitsCreateHandler(req(uid, withKey(data)));

describe("teacherUnitsCreate", () => {
  it("stamps authoritative identity and the U1A initial values", async () => {
    const { unit } = await create(TEACHER, { grade: "8", title: " Energy " });
    expect(unit).toMatchObject({
      grade: "8",
      title: "Energy",
      description: "",
      status: "active",
      archivedAtMillis: null,
      resourceIds: [],
      sortOrder: 0,
      revision: 1,
    });
    expect(unitRows()).toEqual([
      expect.objectContaining({ teacherId: TEACHER, schoolId: SCHOOL, grade: "8", revision: 1 }),
    ]);
    expect(audits).toEqual([
      expect.objectContaining({
        action: "teacherUnits.created",
        targetType: "teacherUnit",
        payload: { grade: "8", revision: 1 },
      }),
    ]);
  });

  it.each(["teacherId", "schoolId", "status", "revision", "resourceIds", "sortOrder", "bogus"])(
    "rejects request field %s with no write",
    async (field) => {
      expect(await codeOf(create(TEACHER, { grade: "7", title: "x", [field]: OTHER }))).toBe(
        "teacherUnits.invalidRequest",
      );
      expect(unitRows()).toEqual([]);
    },
  );

  it.each([["5"], ["9"], [7], [undefined]])("rejects grade %p", async (grade) => {
    expect(await codeOf(create(TEACHER, { grade, title: "x" }))).toBe("teacherUnits.invalidGrade");
    expect(unitRows()).toEqual([]);
  });

  it("refuses a non-teacher and an inactive teacher", async () => {
    setUser("student-1", { status: "active", role: "student", schoolId: SCHOOL });
    expect(await codeOf(create("student-1", { grade: "7", title: "x" }))).toBe("role-forbidden");
    setUser(TEACHER, { status: "suspended", role: "teacher", schoolId: SCHOOL });
    expect(await codeOf(create(TEACHER, { grade: "7", title: "x" }))).toBe("account-inactive");
    expect(unitRows()).toEqual([]);
  });
});

describe("ownership, revision, and lifecycle", () => {
  async function seedUnit(): Promise<string> {
    return (await create(TEACHER, { grade: "7", title: "Earth" })).unit.unitId;
  }

  it("hides another teacher's unit behind a uniform notFound", async () => {
    const unitId = await seedUnit();
    expect(await codeOf(__teacherUnitsGetHandler(req(OTHER, { unitId })))).toBe("teacherUnits.notFound");
    expect(
      await codeOf(__teacherUnitsUpdateHandler(req(OTHER, { unitId, expectedRevision: 1, title: "x" }))),
    ).toBe("teacherUnits.notFound");
    expect((await __teacherUnitsListHandler(req(OTHER, {}))).units).toEqual([]);
    expect(unitRows()[0]).toMatchObject({ title: "Earth", revision: 1 });
  });

  it("increments the revision per accepted write and rejects a stale one", async () => {
    const unitId = await seedUnit();
    const renamed = await __teacherUnitsUpdateHandler(req(TEACHER, { unitId, expectedRevision: 1, title: "E2" }));
    expect(renamed.unit.revision).toBe(2);
    expect(
      await codeOf(__teacherUnitsUpdateHandler(req(TEACHER, { unitId, expectedRevision: 1, title: "E3" }))),
    ).toBe("teacherUnits.writeConflict");
    expect(unitRows()[0]).toMatchObject({ title: "E2", revision: 2 });
  });

  it("is a no-op when the requested values already hold", async () => {
    const unitId = await seedUnit();
    const result = await __teacherUnitsUpdateHandler(req(TEACHER, { unitId, expectedRevision: 1, title: "Earth" }));
    expect(result.noop).toBe(true);
    expect(unitRows()[0].revision).toBe(1);
    expect(audits).toHaveLength(1);
  });

  it("archives and restores reversibly and idempotently", async () => {
    const unitId = await seedUnit();
    const archived = await __teacherUnitsArchiveHandler(req(TEACHER, { unitId, expectedRevision: 1 }));
    expect(archived.unit).toMatchObject({ status: "archived", revision: 2 });
    expect(archived.unit.archivedAtMillis).not.toBeNull();
    const again = await __teacherUnitsArchiveHandler(req(TEACHER, { unitId, expectedRevision: 1 }));
    expect(again).toMatchObject({ noop: true, unit: { revision: 2 } });
    expect(
      await codeOf(__teacherUnitsUpdateHandler(req(TEACHER, { unitId, expectedRevision: 2, title: "x" }))),
    ).toBe("teacherUnits.invalidStatus");
    const restored = await __teacherUnitsRestoreHandler(req(TEACHER, { unitId, expectedRevision: 2 }));
    expect(restored.unit).toMatchObject({ unitId, status: "active", archivedAtMillis: null, revision: 3 });
    expect(unitRows()).toHaveLength(1);
    expect(audits.map((a) => a.action)).toEqual([
      "teacherUnits.created",
      "teacherUnits.archived",
      "teacherUnits.restored",
    ]);
  });

  it("accepts exactly one of several simultaneous writers at the same revision", async () => {
    const unitId = await seedUnit();
    const settled = await Promise.allSettled(
      [1, 2, 3, 4].map((i) =>
        __teacherUnitsUpdateHandler(req(TEACHER, { unitId, expectedRevision: 1, title: `W${String(i)}` })),
      ),
    );
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    for (const s of settled.filter((x): x is PromiseRejectedResult => x.status === "rejected")) {
      expect((s.reason as { code?: unknown }).code).toBe("teacherUnits.writeConflict");
    }
    expect(unitRows()[0].revision).toBe(2);
  });

  it("re-verifies the teacher inside the transaction", async () => {
    const unitId = await seedUnit();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: TEACHER,
      role: "teacher",
      schoolId: SCHOOL,
      districtId: "district-1",
    });
    setUser(TEACHER, { status: "suspended", role: "teacher", schoolId: SCHOOL });
    expect(
      await codeOf(__teacherUnitsArchiveHandler(req(TEACHER, { unitId, expectedRevision: 1 }))),
    ).toBe("account-inactive");
    expect(unitRows()[0]).toMatchObject({ status: "active", revision: 1 });
  });
});

describe("certification remediation (hermetic)", () => {
  it("maps U1A validation codes to invalid-argument without changing other domains", () => {
    const { mapPlatformCodeToHttpsCode } = jest.requireActual("../shared/errors/https-callable");
    for (const code of [
      "teacherUnits.invalidUnitId",
      "teacherUnits.invalidExpectedRevision",
      "teacherUnits.invalidGrade",
      "teacherUnits.invalidTitle",
      "teacherUnits.invalidDescription",
      "teacherUnits.invalidIdempotencyKey",
      "teacherUnits.invalidRequest",
    ]) {
      expect(mapPlatformCodeToHttpsCode(code)).toBe("invalid-argument");
    }
    expect(mapPlatformCodeToHttpsCode("teacherUnits.notFound")).toBe("not-found");
    expect(mapPlatformCodeToHttpsCode("teacherUnits.writeConflict")).toBe("already-exists");
    expect(mapPlatformCodeToHttpsCode("teacherUnits.invalidStatus")).toBe("failed-precondition");
    expect(mapPlatformCodeToHttpsCode("teacherUnits.idempotencyKeyConflict")).toBe("failed-precondition");
    expect(mapPlatformCodeToHttpsCode("teacherUnits.listLimitExceeded")).toBe("failed-precondition");
    // Unchanged neighbors sharing the same suffixes.
    expect(mapPlatformCodeToHttpsCode("classes.invalidTitle")).toBe("failed-precondition");
    expect(mapPlatformCodeToHttpsCode("classes.invalidGrade")).toBe("failed-precondition");
    expect(mapPlatformCodeToHttpsCode("accommodations.invalidExpectedRevision")).toBe("failed-precondition");
  });

  it("records no audit for a commit that fails, and retries a lost create race once", async () => {
    // Occupy the id the next create attempt will draw, so its commit fails
    // on the unit's create precondition after the audit was staged.
    const collidingId = `Unit${String(autoId + 1).padStart(16, "0")}`;
    store.set(`teacherUnits/${collidingId}`, {
      data: { teacherId: OTHER, schoolId: SCHOOL, title: "Occupant" },
      version: ++version,
    });
    const { unit, replayed } = await create(TEACHER, { grade: "7", title: "Earth" });
    expect(replayed).toBe(false);
    expect(unit.unitId).not.toBe(collidingId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "teacherUnits.created", targetId: unit.unitId });
    expect(store.get(`teacherUnits/${collidingId}`)?.data.title).toBe("Occupant");
    expect([...store.keys()].filter((p) => p.startsWith("teacherUnitCreateReceipts/"))).toHaveLength(1);
  });

  it("replays a matching key, refuses a changed payload, and requires a key", async () => {
    const first = await create(TEACHER, { grade: "7", title: "Earth", idempotencyKey: "retry-key-1" });
    const again = await create(TEACHER, { grade: "7", title: " Earth ", idempotencyKey: "retry-key-1" });
    expect(again).toEqual({ replayed: true, unit: first.unit });
    expect(
      await codeOf(create(TEACHER, { grade: "7", title: "Other", idempotencyKey: "retry-key-1" })),
    ).toBe("teacherUnits.idempotencyKeyConflict");
    expect(
      await codeOf(__teacherUnitsCreateHandler(req(TEACHER, { grade: "7", title: "Earth" }))),
    ).toBe("teacherUnits.invalidIdempotencyKey");
    expect(unitRows()).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it.each([
    ["school deleted", () => store.delete(`schools/${SCHOOL}`), "school-district-mismatch"],
    [
      "district changed",
      () => store.set(`schools/${SCHOOL}`, { data: { districtId: "district-2" }, version: ++version }),
      "district-mismatch",
    ],
  ])("refuses get, list, and mutation after %s", async (_label, revoke, code) => {
    const { unit } = await create(TEACHER, { grade: "7", title: "Earth" });
    revoke();
    expect(await codeOf(__teacherUnitsGetHandler(req(TEACHER, { unitId: unit.unitId })))).toBe(code);
    expect(await codeOf(__teacherUnitsListHandler(req(TEACHER, {})))).toBe(code);
    expect(
      await codeOf(__teacherUnitsArchiveHandler(req(TEACHER, { unitId: unit.unitId, expectedRevision: 1 }))),
    ).toBe(code);
    expect(unitRows()[0]).toMatchObject({ status: "active", revision: 1 });
    expect(audits).toHaveLength(1);
  });
});
