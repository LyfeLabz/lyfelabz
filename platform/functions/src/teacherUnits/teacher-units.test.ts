/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await */
//
// U1A/U1B hermetic unit tests for the `teacherUnits*` callables. Runs in the
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

// A3-3 commit faults, modeling the Firestore SDK 7.11 rerun contract: a commit
// error with a retryable gRPC code (DEADLINE_EXCEEDED here) reruns the whole
// callback. "landed" applies the writes before the acknowledgement is lost;
// "lost" applies nothing. `beforeRerun` runs between the fault and the rerun.
type CommitFault = { kind: "landed" | "lost"; remaining: number; beforeRerun?: () => void };
let commitFault: CommitFault | null = null;
let txAttempts = 0;
const DEADLINE_EXCEEDED = 4;

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
  let lastFault: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    txAttempts += 1;
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
    const fault = staged.length > 0 && commitFault && commitFault.remaining > 0 ? commitFault : null;
    if (fault) fault.remaining -= 1;
    if (!fault || fault.kind === "landed") {
      for (const w of staged) {
        if (w.kind === "audit") audits.push(w.data);
        else if (w.kind === "create") store.set(w.path!, { data: materialize(w.data), version: ++version });
        else {
          const row = store.get(w.path!)!;
          store.set(w.path!, { data: { ...row.data, ...materialize(w.data) }, version: ++version });
        }
      }
    }
    if (fault) {
      lastFault = Object.assign(new Error("deadline exceeded"), { code: DEADLINE_EXCEEDED });
      fault.beforeRerun?.();
      continue;
    }
    return result;
  }
  throw lastFault ?? Object.assign(new Retry("aborted"), { code: 10 });
}

const mockRequireDistrictContext = jest.fn();

jest.mock("firebase-admin/firestore", () => {
  class MockTimestamp {
    constructor(readonly seconds: number, readonly nanoseconds: number) {}
    static fromMillis(ms: number): MockTimestamp {
      return new MockTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1_000_000);
    }
    toMillis(): number {
      return this.seconds * 1000 + this.nanoseconds / 1_000_000;
    }
  }
  return { FieldValue: { serverTimestamp: () => SERVER_TS }, Timestamp: MockTimestamp };
});
jest.mock("../shared/firestore/admin", () => ({ getAdminFirestore: () => ({ doc: (path: string) => ref(path) }) }));
// Hermetic: the cloud identity path never reaches a real metadata server.
const mockReadRuntimeMetadata = jest.fn((path: string) => Promise.reject(new Error(`no metadata server for ${path}`)));
jest.mock("./a3-runtime-metadata", () => ({ readRuntimeMetadata: (path: string) => mockReadRuntimeMetadata(path) }));
jest.mock("firebase-functions/v2/https", () => ({ onCall: <T,>(h: T) => h }));
jest.mock("../shared", () => {
  const actual = jest.requireActual("../shared/types/teacher-unit");
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  const { isTransactionContention } = jest.requireActual("../shared/firestore/transaction");
  const { isCanonicalSchoolId } = jest.requireActual("../shared/types/school");
  return {
    ...actual,
    isCanonicalSchoolId,
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

import {
  PRODUCTION_TEACHER_UNITS_ENFORCEMENT,
  RUNTIME_PLACEMENT_FINGERPRINT,
  TEACHER_UNITS_POLICY_PATH,
  type TeacherUnitsEnforcement,
} from "./a3-enforcement";
import { validateCapabilityResponse } from "./a3-protocol";
import { UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER } from "./a3-release-authority";
import { validateEvidenceReference } from "./a3-bindings";
import { contentDigest, evidenceRef } from "./a3-canonical";
import {
  A3_FIXTURE,
  buildEnabledChain,
  closedPolicy,
  emulatorExpectation,
  stubIdentity,
  testEnforcement,
  testVerifier,
} from "./a3-test-support.test";
import { createTeacherUnitsArchiveHandler } from "./teacher-units-archive";
import { createTeacherUnitsCapabilitiesHandler } from "./teacher-units-capabilities";
import {
  createTeacherUnit,
  createTeacherUnitsCreateHandler,
  teacherUnitCreateReceiptId,
  teacherUnitCreateRequestHash,
} from "./teacher-units-create";
import { mutateOwnedTeacherUnit } from "./teacher-unit-mutation";
import { createTeacherUnitsGetHandler } from "./teacher-units-get";
import { createTeacherUnitsListHandler } from "./teacher-units-list";
import { createTeacherUnitsReorderHandler, reorderTeacherUnits } from "./teacher-units-reorder";
import { createTeacherUnitsRestoreHandler } from "./teacher-units-restore";
import { createTeacherUnitsSetResourcesHandler } from "./teacher-units-set-resources";
import { createTeacherUnitsUpdateHandler } from "./teacher-units-update";
import {
  UNIT_PLACEABLE_RESOURCE_ID_LIST,
  isUnitPlaceableResourceId,
} from "./unit-placeable-resources";

const TEACHER = "teacher-a";
const OTHER = "teacher-b";
const SCHOOL = "school-1";

// A3-3: synthetic enabled chain for a demo emulator identity, with injected
// TEST-ONLY provenance and release-authority verdicts (a3-test-support.test.ts).
// Production wiring never uses these; see the A3 describe blocks below.
const EXPECTED = emulatorExpectation("demo-a3-test");
const IDENTITY = stubIdentity(EXPECTED);
const CHAIN = buildEnabledChain(EXPECTED, RUNTIME_PLACEMENT_FINGERPRINT);
const COMPAT = CHAIN.compatibility;

function handlersFor(enforcement: TeacherUnitsEnforcement) {
  return {
    capabilities: createTeacherUnitsCapabilitiesHandler(enforcement),
    create: createTeacherUnitsCreateHandler(enforcement),
    get: createTeacherUnitsGetHandler(enforcement),
    list: createTeacherUnitsListHandler(enforcement),
    update: createTeacherUnitsUpdateHandler(enforcement),
    archive: createTeacherUnitsArchiveHandler(enforcement),
    restore: createTeacherUnitsRestoreHandler(enforcement),
    setResources: createTeacherUnitsSetResourcesHandler(enforcement),
    reorder: createTeacherUnitsReorderHandler(enforcement),
  };
}
const RAW = handlersFor(testEnforcement(IDENTITY, CHAIN));

function seedEnabledPolicy(): void {
  store.set(TEACHER_UNITS_POLICY_PATH, { data: CHAIN.policy, version: ++version });
  for (const [path, data] of Object.entries(CHAIN.documents)) store.set(path, { data, version: ++version });
}

// The pre-A3 U1A/U1B/U2.2 suites below exercise unit semantics under an enabled,
// verified policy. Mutations get the current v2 envelope, and creates the
// caller's original school, unless a test names its own.
function decorate<R>(
  handler: (r: CallableRequest<unknown>) => Promise<R>,
  defaults: (r: CallableRequest<unknown>) => Record<string, unknown>,
): (r: CallableRequest<unknown>) => Promise<R> {
  return (r) => {
    const data = r.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return handler(r);
    return handler({ ...r, data: { ...defaults(r), ...(data as Record<string, unknown>) } });
  };
}
const withCompat = () => ({ compatibility: COMPAT });
const __teacherUnitsCreateHandler = decorate(RAW.create, (r) => ({
  compatibility: COMPAT,
  expectedSchoolId: store.get(`users/${String(r.auth?.uid)}`)?.data.schoolId ?? SCHOOL,
}));
const __teacherUnitsGetHandler = RAW.get;
const __teacherUnitsListHandler = RAW.list;
const __teacherUnitsUpdateHandler = decorate(RAW.update, withCompat);
const __teacherUnitsArchiveHandler = decorate(RAW.archive, withCompat);
const __teacherUnitsRestoreHandler = decorate(RAW.restore, withCompat);
const __teacherUnitsSetResourcesHandler = decorate(RAW.setResources, withCompat);
const __teacherUnitsReorderHandler = decorate(RAW.reorder, withCompat);

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
  commitFault = null;
  txAttempts = 0;
  seedEnabledPolicy();
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

describe("teacherUnitsCreate expectedSchoolId (U2.2, hermetic)", () => {
  const receiptRows = () => [...store.keys()].filter((p) => p.startsWith("teacherUnitCreateReceipts/"));

  it("creates and replays when expectedSchoolId names the verified school", async () => {
    const first = await create(TEACHER, { grade: "7", title: "Earth", idempotencyKey: "bound-key-1", expectedSchoolId: SCHOOL });
    expect(first.replayed).toBe(false);
    expect(unitRows()).toEqual([expect.objectContaining({ teacherId: TEACHER, schoolId: SCHOOL })]);
    const again = await create(TEACHER, { grade: "7", title: "Earth", idempotencyKey: "bound-key-1", expectedSchoolId: SCHOOL });
    expect(again).toEqual({ replayed: true, unit: first.unit });
    // Legacy and bound requests with one key are the same request.
    const legacy = await create(TEACHER, { grade: "7", title: "Earth", idempotencyKey: "bound-key-1" });
    expect(legacy).toEqual({ replayed: true, unit: first.unit });
    expect(unitRows()).toHaveLength(1);
    expect(receiptRows()).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it("refuses a mismatched expectedSchoolId with no unit, receipt, or audit", async () => {
    expect(
      await codeOf(create(TEACHER, { grade: "7", title: "Earth", expectedSchoolId: "school-2" })),
    ).toBe("teacherUnits.schoolContextChanged");
    expect(unitRows()).toEqual([]);
    expect(receiptRows()).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("refuses a same-key replay after a transfer, without writing in the new school", async () => {
    await create(TEACHER, { grade: "7", title: "Earth", idempotencyKey: "transfer-key", expectedSchoolId: SCHOOL });
    store.set("schools/school-2", { data: { districtId: "district-1" }, version: ++version });
    setUser(TEACHER, { status: "active", role: "teacher", schoolId: "school-2" });
    expect(
      await codeOf(create(TEACHER, { grade: "7", title: "Earth", idempotencyKey: "transfer-key", expectedSchoolId: SCHOOL })),
    ).toBe("teacherUnits.schoolContextChanged");
    expect(unitRows()).toEqual([expect.objectContaining({ schoolId: SCHOOL })]);
    expect(receiptRows()).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it.each([[""], ["has/slash"], ["-leading"], ["trailing_"], ["x".repeat(65)], ["__reserved__"], [12], [null], [{}]])(
    "rejects expectedSchoolId %p with no write",
    async (expectedSchoolId) => {
      expect(await codeOf(create(TEACHER, { grade: "7", title: "Earth", expectedSchoolId }))).toBe(
        "teacherUnits.invalidExpectedSchoolId",
      );
      expect(unitRows()).toEqual([]);
      expect(receiptRows()).toEqual([]);
      expect(audits).toEqual([]);
    },
  );

  it("never lets expectedSchoolId stand in for authorization", async () => {
    setUser("student-1", { status: "active", role: "student", schoolId: SCHOOL });
    expect(await codeOf(create("student-1", { grade: "7", title: "x", expectedSchoolId: SCHOOL }))).toBe(
      "role-forbidden",
    );
    setUser(TEACHER, { status: "suspended", role: "teacher", schoolId: SCHOOL });
    expect(await codeOf(create(TEACHER, { grade: "7", title: "x", expectedSchoolId: SCHOOL }))).toBe(
      "account-inactive",
    );
    // `schoolId` itself is still a server-owned field.
    expect(
      await codeOf(create(OTHER, { grade: "7", title: "x", expectedSchoolId: SCHOOL, schoolId: SCHOOL })),
    ).toBe("teacherUnits.invalidRequest");
    expect(unitRows()).toEqual([]);
    expect(audits).toEqual([]);
  });
});

describe("U1B resource membership (hermetic)", () => {
  const setResources = (uid: string, data: unknown) => __teacherUnitsSetResourcesHandler(req(uid, data));
  async function seedUnit(): Promise<string> {
    return (await create(TEACHER, { grade: "7", title: "Earth" })).unit.unitId;
  }

  it("holds the RA-1 placement decisions the server enforces", () => {
    expect(isUnitPlaceableResourceId("earths-layers")).toBe(true);
    // Placeable but unassignable.
    expect(isUnitPlaceableResourceId("simulation-gravity-wells")).toBe(true);
    // Gated lesson and reusable tool.
    expect(isUnitPlaceableResourceId("ragebaiting")).toBe(false);
    expect(isUnitPlaceableResourceId("lab-report-assistant")).toBe(false);
    expect(isUnitPlaceableResourceId(7)).toBe(false);
    expect(new Set(UNIT_PLACEABLE_RESOURCE_ID_LIST).size).toBe(UNIT_PLACEABLE_RESOURCE_ID_LIST.length);
  });

  it("replaces the ordered list with one revision and audit", async () => {
    const unitId = await seedUnit();
    const result = await setResources(TEACHER, {
      unitId,
      expectedRevision: 1,
      resourceIds: ["simulation-gravity-wells", "earths-layers"],
    });
    expect(result).toMatchObject({
      noop: false,
      unit: { resourceIds: ["simulation-gravity-wells", "earths-layers"], revision: 2 },
    });
    expect(audits[1]).toMatchObject({
      action: "teacherUnits.resourcesUpdated",
      payload: { grade: "7", previousRevision: 1, revision: 2, previousResourceCount: 0, resourceCount: 2 },
    });
    const again = await setResources(TEACHER, {
      unitId,
      expectedRevision: 1,
      resourceIds: ["simulation-gravity-wells", "earths-layers"],
    });
    expect(again.noop).toBe(true);
    expect(audits).toHaveLength(2);
  });

  it.each([
    [["earths-layers", "ragebaiting"], "teacherUnits.resourceNotPlaceable"],
    [["lab-report-assistant"], "teacherUnits.resourceNotPlaceable"],
    [["earths-layers", "earths-layers"], "teacherUnits.duplicateResource"],
    [[null], "teacherUnits.invalidResourceIds"],
    [Array.from({ length: 101 }, () => "earths-layers"), "teacherUnits.invalidResourceIds"],
    [undefined, "teacherUnits.invalidResourceIds"],
  ])("rejects %p with no write", async (resourceIds, code) => {
    const unitId = await seedUnit();
    expect(await codeOf(setResources(TEACHER, { unitId, expectedRevision: 1, resourceIds }))).toBe(code);
    expect(unitRows()[0]).toMatchObject({ resourceIds: [], revision: 1 });
    expect(audits).toHaveLength(1);
  });

  it("refuses an archived unit and another teacher's unit", async () => {
    const unitId = await seedUnit();
    expect(
      await codeOf(setResources(OTHER, { unitId, expectedRevision: 1, resourceIds: ["earths-layers"] })),
    ).toBe("teacherUnits.notFound");
    await __teacherUnitsArchiveHandler(req(TEACHER, { unitId, expectedRevision: 1 }));
    expect(
      await codeOf(setResources(TEACHER, { unitId, expectedRevision: 2, resourceIds: ["earths-layers"] })),
    ).toBe("teacherUnits.invalidStatus");
    expect(unitRows()[0]).toMatchObject({ resourceIds: [], status: "archived", revision: 2 });
  });

  it("accepts exactly one of several simultaneous edits at the same revision", async () => {
    const unitId = await seedUnit();
    const settled = await Promise.allSettled(
      [["earths-layers"], ["water-cycle"], ["simulation-gravity-wells"]].map((resourceIds) =>
        setResources(TEACHER, { unitId, expectedRevision: 1, resourceIds }),
      ),
    );
    expect(settled.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    for (const x of settled.filter((y): y is PromiseRejectedResult => y.status === "rejected")) {
      expect((x.reason as { code?: unknown }).code).toBe("teacherUnits.writeConflict");
    }
    expect(unitRows()[0].revision).toBe(2);
  });
});

describe("U1B unit ordering (hermetic)", () => {
  const reorder = (uid: string, data: unknown) => __teacherUnitsReorderHandler(req(uid, data));
  const at = (unitId: string, expectedRevision = 1) => ({ unitId, expectedRevision });
  async function seed(): Promise<string[]> {
    const ids: string[] = [];
    for (const title of ["A", "B", "C"]) ids.push((await create(TEACHER, { grade: "7", title })).unit.unitId);
    return ids;
  }

  it("assigns positions 1..n, writing only moved units", async () => {
    const [a, b, c] = await seed();
    const result = await reorder(TEACHER, { grade: "7", units: [at(c), at(a), at(b)] });
    expect(result.units.map((u) => [u.unitId, u.sortOrder, u.revision])).toEqual([
      [c, 1, 2],
      [a, 2, 2],
      [b, 3, 2],
    ]);
    expect(audits.filter((x) => x.action === "teacherUnits.reordered")).toHaveLength(3);
    const noop = await reorder(TEACHER, { grade: "7", units: [at(c), at(a), at(b)] });
    expect(noop.noop).toBe(true);
    expect(audits.filter((x) => x.action === "teacherUnits.reordered")).toHaveLength(3);
  });

  it("refuses foreign, incomplete, stale, and malformed orders with no write", async () => {
    const [a, b, c] = await seed();
    const foreign = (await create(OTHER, { grade: "7", title: "X" })).unit.unitId;
    expect(await codeOf(reorder(TEACHER, { grade: "7", units: [at(a), at(b), at(c), at(foreign)] }))).toBe(
      "teacherUnits.notFound",
    );
    expect(await codeOf(reorder(TEACHER, { grade: "6", units: [at(a), at(b), at(c)] }))).toBe(
      "teacherUnits.notFound",
    );
    expect(await codeOf(reorder(TEACHER, { grade: "7", units: [at(b), at(a)] }))).toBe(
      "teacherUnits.writeConflict",
    );
    expect(await codeOf(reorder(TEACHER, { grade: "7", units: [at(b, 2), at(a), at(c)] }))).toBe(
      "teacherUnits.writeConflict",
    );
    expect(await codeOf(reorder(TEACHER, { grade: "7", units: [at(a), at(a)] }))).toBe(
      "teacherUnits.invalidUnitOrder",
    );
    expect(await codeOf(reorder(TEACHER, { grade: "7", units: [] }))).toBe("teacherUnits.invalidUnitOrder");
    expect(await codeOf(reorder(TEACHER, { grade: "7", units: [{ ...at(a), sortOrder: 4 }] }))).toBe(
      "teacherUnits.invalidRequest",
    );
    expect(unitRows().map((u) => [u.sortOrder, u.revision])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
  });

  it("accepts exactly one of several simultaneous reorders", async () => {
    const [a, b, c] = await seed();
    const settled = await Promise.allSettled([
      reorder(TEACHER, { grade: "7", units: [at(c), at(b), at(a)] }),
      reorder(TEACHER, { grade: "7", units: [at(b), at(c), at(a)] }),
      reorder(TEACHER, { grade: "7", units: [at(b), at(a), at(c)] }),
    ]);
    expect(settled.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    for (const x of settled.filter((y): y is PromiseRejectedResult => y.status === "rejected")) {
      expect((x.reason as { code?: unknown }).code).toBe("teacherUnits.writeConflict");
    }
    expect(unitRows().every((u) => u.revision === 2)).toBe(true);
  });

  it("maps the U1B validation codes to invalid-argument", () => {
    const { mapPlatformCodeToHttpsCode } = jest.requireActual("../shared/errors/https-callable");
    for (const code of [
      "teacherUnits.invalidResourceIds",
      "teacherUnits.duplicateResource",
      "teacherUnits.resourceNotPlaceable",
      "teacherUnits.invalidUnitOrder",
    ]) {
      expect(mapPlatformCodeToHttpsCode(code)).toBe("invalid-argument");
    }
  });
});

// ---------------------------------------------------------------------------
// A3-3 transactional enforcement (approved decision record,
// docs/platform/U2_6_A3_3_APPROVED_DECISIONS.md).
// ---------------------------------------------------------------------------

const NONCE = "a3_nonce_0123456789abcdef";
const V2_DISCOVERY = { schemaVersion: 2, nonce: NONCE, clientContractVersion: "teacher-units-v2" };
// Client codes treated as confirmed pre-commit rejections
// (app/src/teacherUnits/saveCoordination.ts PRE_COMMIT_REJECTION_CODES).
const CLIENT_PRE_COMMIT_CODES = [
  "teacherUnits.invalidRequest",
  "teacherUnits.invalidIdempotencyKey",
  "teacherUnits.invalidExpectedSchoolId",
  "teacherUnits.invalidGrade",
  "teacherUnits.invalidTitle",
  "teacherUnits.invalidDescription",
];
const PRE_TRANSACTION_A3_CODES = [
  "teacherUnits.compatibilityRequired",
  "teacherUnits.invalidCompatibility",
  "teacherUnits.contractUnsupported",
];
const MANAGEMENT = ["create", "get", "list", "update", "archive", "restore", "setResources", "reorder"] as const;
type Management = typeof MANAGEMENT[number];

async function errorOf(p: Promise<unknown>): Promise<{ code: string; details?: Record<string, unknown>; message: string }> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: unknown; details?: Record<string, unknown>; message?: string };
    return { code: String(e.code), details: e.details, message: String(e.message) };
  }
  throw new Error("expected a refusal");
}

function rowsUnder(prefix: string): Record<string, any>[] {
  return [...store].filter(([p]) => p.startsWith(prefix)).map(([, r]) => r.data);
}

function snapshotWrites(): string {
  return JSON.stringify({ units: rowsUnder("teacherUnits/"), receipts: rowsUnder("teacherUnitCreateReceipts/"), audits });
}

// A valid request for each management endpoint against `unitId` (revision 1).
function managementRequest(op: Management, unitId: string): Record<string, unknown> {
  switch (op) {
    case "create": return { grade: "7", title: "Earth", idempotencyKey: "a3-key-0001", expectedSchoolId: SCHOOL, compatibility: COMPAT };
    case "get": return { unitId };
    case "list": return {};
    case "update": return { unitId, expectedRevision: 1, title: "Renamed", compatibility: COMPAT };
    case "archive": return { unitId, expectedRevision: 1, compatibility: COMPAT };
    case "restore": return { unitId, expectedRevision: 1, compatibility: COMPAT };
    case "setResources": return { unitId, expectedRevision: 1, resourceIds: [UNIT_PLACEABLE_RESOURCE_ID_LIST[0]], compatibility: COMPAT };
    case "reorder": return { grade: "7", units: [{ unitId, expectedRevision: 1 }], compatibility: COMPAT };
  }
}

async function seedUnit(): Promise<string> {
  const { unit } = await create(TEACHER, { grade: "7", title: "Earth" });
  return unit.unitId;
}

function setPolicy(data: Record<string, any>): void {
  store.set(TEACHER_UNITS_POLICY_PATH, { data, version: ++version });
}

describe("A3-3 production wiring (closed-state guarantee)", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.K_SERVICE;
    delete process.env.K_REVISION;
  });
  afterEach(() => {
    process.env = original;
  });

  it("binds the UNCONFIGURED verifier and supplies no emulator profile", () => {
    expect(Object.isFrozen(PRODUCTION_TEACHER_UNITS_ENFORCEMENT)).toBe(true);
    expect(PRODUCTION_TEACHER_UNITS_ENFORCEMENT.verifier).toBe(UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER);
    expect(PRODUCTION_TEACHER_UNITS_ENFORCEMENT.resolveIdentity.length).toBe(0);
  });

  it.each(["emulator mode without a profile", "cloud mode without execution metadata"])(
    "refuses all nine endpoints before any tenant read (%s)",
    async (mode) => {
      if (mode.startsWith("emulator")) {
        process.env.FUNCTIONS_EMULATOR = "true";
        process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
        process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
      } else {
        delete process.env.FUNCTIONS_EMULATOR;
        mockReadRuntimeMetadata.mockClear();
      }
      const unitId = await seedUnit();
      const before = snapshotWrites();
      mockRequireDistrictContext.mockClear();
      const production = handlersFor(PRODUCTION_TEACHER_UNITS_ENFORCEMENT);
      const requests: [keyof typeof production, Record<string, unknown>][] = [
        ["capabilities", { ...V2_DISCOVERY }],
        ...MANAGEMENT.map((op) => [op, managementRequest(op, unitId)] as [keyof typeof production, Record<string, unknown>]),
      ];
      for (const [name, data] of requests) {
        // A caller-supplied profile is never an input to production identity.
        const withProfile = { ...data, emulatorProfile: EXPECTED };
        for (const payload of [data, withProfile]) {
          expect(await codeOf(production[name](req(TEACHER, payload)))).toBe("teacherUnits.runtimeIdentityUnavailable");
        }
      }
      expect(mockRequireDistrictContext).not.toHaveBeenCalled();
      if (!mode.startsWith("emulator")) expect(mockReadRuntimeMetadata).toHaveBeenCalled();
      expect(snapshotWrites()).toBe(before);
    },
  );

  it("keeps every management operation unavailable with the UNCONFIGURED verifier, even for a coherent enabled chain", async () => {
    const unitId = await seedUnit();
    const before = snapshotWrites();
    const unconfigured = handlersFor(testEnforcement(IDENTITY, CHAIN, { verifier: UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER }));
    for (const op of MANAGEMENT) {
      expect(await codeOf(unconfigured[op](req(TEACHER, managementRequest(op, unitId))))).toBe("teacherUnits.deploymentIneligible");
    }
    expect(snapshotWrites()).toBe(before);
    const discovery = await unconfigured.capabilities(req(TEACHER, V2_DISCOVERY));
    expect(discovery.teacherUnits.availability).toEqual({
      state: "unverified", policyInstanceId: COMPAT.policyInstanceId, policyGeneration: COMPAT.policyGeneration,
      backendReleaseId: CHAIN.releaseId, deploymentEligible: false,
    });
    expect(discovery.teacherUnits.acceptedClientContractVersions).toEqual([]);
  });
});

describe("A3-3 runtime identity", () => {
  it("refuses unresolved, unaccepted and stale identities before tenant reads", async () => {
    const unitId = await seedUnit();
    const prodAsEmulator = stubIdentity({ ...emulatorExpectation("lyfelabz-prod") });
    const stagingAsEmulator = stubIdentity({ ...emulatorExpectation("lyfelabz-staging") });
    const cases: TeacherUnitsEnforcement[] = [
      testEnforcement(IDENTITY, CHAIN, { resolveIdentity: () => Promise.resolve(null) }),
      testEnforcement(IDENTITY, CHAIN, { resolveIdentity: () => Promise.reject(new Error("metadata")) }),
      testEnforcement(prodAsEmulator, CHAIN),
      testEnforcement(stagingAsEmulator, CHAIN),
      testEnforcement(IDENTITY, CHAIN, { isIdentityCurrent: () => false }),
      testEnforcement(IDENTITY, CHAIN, { isIdentityCurrent: () => { throw new Error("binding invalid"); } }),
    ];
    for (const enforcement of cases) {
      mockRequireDistrictContext.mockClear();
      const handlers = handlersFor(enforcement);
      expect(await codeOf(handlers.capabilities(req(TEACHER, V2_DISCOVERY)))).toBe("teacherUnits.runtimeIdentityUnavailable");
      for (const op of MANAGEMENT) {
        expect(await codeOf(handlers[op](req(TEACHER, managementRequest(op, unitId))))).toBe("teacherUnits.runtimeIdentityUnavailable");
      }
      expect(mockRequireDistrictContext).not.toHaveBeenCalled();
    }
  });

  it("rechecks identity inside every transaction attempt", async () => {
    const unitId = await seedUnit();
    let current = true;
    const handlers = handlersFor(testEnforcement(IDENTITY, CHAIN, { isIdentityCurrent: () => current }));
    // Identity becomes stale after the pre-read check but before the transaction.
    mockRequireDistrictContext.mockImplementationOnce(async (r: CallableRequest<unknown>) => {
      current = false;
      return { uid: r.auth?.uid, role: "teacher", schoolId: SCHOOL, districtId: "district-1" };
    });
    const before = snapshotWrites();
    expect(await codeOf(handlers.update(req(TEACHER, managementRequest("update", unitId))))).toBe(
      "teacherUnits.runtimeIdentityUnavailable",
    );
    expect(snapshotWrites()).toBe(before);
  });
});

describe("A3-3 schema 2 discovery and legacy rejection", () => {
  it("declares an enabled, verified policy with a contract-valid schema 2 response", async () => {
    const response = await RAW.capabilities(req(TEACHER, V2_DISCOVERY));
    expect(validateCapabilityResponse(response, "demo-a3-test").ok).toBe(true);
    expect(response).toMatchObject({
      schemaVersion: 2, nonce: NONCE,
      backend: { projectId: "demo-a3-test", environment: "emulator", region: "us-central1", enforcementVersion: "teacher-units-a3-v1" },
      teacherUnits: { apiContractVersion: "teacher-units-v2", acceptedClientContractVersions: ["teacher-units-v2"],
        supportedClientContractVersions: ["teacher-units-v2"], placementFingerprint: RUNTIME_PLACEMENT_FINGERPRINT,
        availability: { state: "enabled", deploymentEligible: true, backendReleaseId: CHAIN.releaseId } },
      caller: { uid: TEACHER, role: "teacher", schoolId: SCHOOL, districtId: "district-1" },
    });
    expect(rowsUnder("teacherUnits/")).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("declares closed and missing policies, and refuses invalid ones", async () => {
    setPolicy(closedPolicy(EXPECTED, RUNTIME_PLACEMENT_FINGERPRINT));
    const closed = await RAW.capabilities(req(TEACHER, V2_DISCOVERY));
    expect(closed.teacherUnits.availability).toEqual({ state: "closed", policyInstanceId: COMPAT.policyInstanceId,
      policyGeneration: 1, backendReleaseId: null, deploymentEligible: false });
    expect(closed.teacherUnits.acceptedClientContractVersions).toEqual([]);
    expect(validateCapabilityResponse(closed, "demo-a3-test").ok).toBe(true);
    store.delete(TEACHER_UNITS_POLICY_PATH);
    const missing = await RAW.capabilities(req(TEACHER, V2_DISCOVERY));
    expect(missing.teacherUnits.availability).toEqual({ state: "unverified", policyInstanceId: null,
      policyGeneration: null, backendReleaseId: null, deploymentEligible: false });
    setPolicy({ ...CHAIN.policy, mode: "maybe" });
    expect(await codeOf(RAW.capabilities(req(TEACHER, V2_DISCOVERY)))).toBe("teacherUnits.policyInvalid");
  });

  it.each([
    ["exact A2 v1 request", { schemaVersion: 1, nonce: NONCE, clientContractVersion: "teacher-units-v1" }, "teacherUnits.contractUnsupported"],
    ["schema 2 with v1 contract", { schemaVersion: 2, nonce: NONCE, clientContractVersion: "teacher-units-v1" }, "teacherUnits.contractUnsupported"],
    ["schema 1 with v2 contract", { schemaVersion: 1, nonce: NONCE, clientContractVersion: "teacher-units-v2" }, "teacherUnits.contractUnsupported"],
    ["string schema version", { schemaVersion: "2", nonce: NONCE, clientContractVersion: "teacher-units-v2" }, "teacherUnits.contractUnsupported"],
    ["unknown key", { ...V2_DISCOVERY, projectId: "lyfelabz-prod" }, "teacherUnits.invalidRequest"],
    ["missing nonce", { schemaVersion: 2, clientContractVersion: "teacher-units-v2" }, "teacherUnits.invalidRequest"],
    ["short nonce", { ...V2_DISCOVERY, nonce: "short" }, "teacherUnits.invalidRequest"],
    ["null payload", null, "teacherUnits.invalidRequest"],
    ["array payload", [], "teacherUnits.invalidRequest"],
  ])("refuses %s", async (_label, data, code) => {
    expect(await codeOf(RAW.capabilities(req(TEACHER, data)))).toBe(code);
  });

  it("keeps canonical authentication ahead of request parsing", async () => {
    expect(await codeOf(RAW.capabilities({ data: V2_DISCOVERY } as unknown as CallableRequest<unknown>))).toBe("unauthenticated");
    setUser("student-1", { status: "active", role: "student", schoolId: SCHOOL });
    expect(await codeOf(RAW.capabilities(req("student-1", { schemaVersion: 1 })))).toBe("role-forbidden");
  });
});

// A3-6 S2: validateEvidenceReference now accepts a release certification. A certification
// stored where activation evidence or the activation approval is expected must still refuse.
function emulatorCertification(): { ref: string; doc: Record<string, any> } {
  const doc = JSON.parse(JSON.stringify(A3_FIXTURE.valid.releaseCertification));
  doc.payload.statement = { ...doc.payload.statement, environment: EXPECTED.environment, projectId: EXPECTED.projectId,
    projectNumber: EXPECTED.projectNumber, backendReleaseId: CHAIN.releaseId, placementFingerprint: RUNTIME_PLACEMENT_FINGERPRINT };
  doc.payload.source.statementObject.sha256 = contentDigest(doc.payload.statement);
  // The substitute is valid evidence, so any refusal comes from the kind checks.
  expect(validateEvidenceReference(evidenceRef(doc.payload), doc, EXPECTED).ok).toBe(true);
  return { ref: evidenceRef(doc.payload), doc };
}
function certificationAsActivationEvidence(): void {
  const { ref, doc } = emulatorCertification();
  store.set(ref, { data: doc, version: ++version });
  setPolicy({ ...CHAIN.policy, activationEvidenceRef: ref });
}
function certificationAsActivationApproval(): void {
  const { ref, doc } = emulatorCertification();
  store.set(ref, { data: doc, version: ++version });
  const evidence = JSON.parse(JSON.stringify(CHAIN.documents[CHAIN.activationEvidenceRef]));
  evidence.payload.authorizationEvidenceRef = ref;
  store.set(evidenceRef(evidence.payload), { data: evidence, version: ++version });
  setPolicy({ ...CHAIN.policy, activationEvidenceRef: evidenceRef(evidence.payload) });
}

describe("A3-3 availability states for management operations", () => {
  const states: [string, () => void, string][] = [
    ["release certification in place of activation evidence", certificationAsActivationEvidence, "teacherUnits.deploymentIneligible"],
    ["release certification in place of activation approval", certificationAsActivationApproval, "teacherUnits.deploymentIneligible"],
    ["missing policy", () => store.delete(TEACHER_UNITS_POLICY_PATH), "teacherUnits.policyMissing"],
    ["closed policy", () => setPolicy(closedPolicy(EXPECTED, RUNTIME_PLACEMENT_FINGERPRINT)), "teacherUnits.availabilityClosed"],
    ["malformed policy (unknown field)", () => setPolicy({ ...CHAIN.policy, extra: true }), "teacherUnits.policyInvalid"],
    ["malformed policy (JSON timestamp)", () => setPolicy({ ...CHAIN.policy, updatedAt: { seconds: 1, nanoseconds: 0 } }), "teacherUnits.policyInvalid"],
    ["policy for another environment", () => setPolicy({ ...CHAIN.policy, environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840" }), "teacherUnits.policyInvalid"],
    ["enabled policy without evidence", () => setPolicy({ ...CHAIN.policy, activationEvidenceRef: null }), "teacherUnits.policyInvalid"],
    ["missing release document", () => store.delete(CHAIN.releaseRef), "teacherUnits.deploymentIneligible"],
    ["tampered release document", () => store.set(CHAIN.releaseRef, { data: { ...CHAIN.documents[CHAIN.releaseRef], schemaVersion: 2 }, version: ++version }), "teacherUnits.deploymentIneligible"],
    ["missing deployment approval", () => store.delete(CHAIN.deploymentApprovalRef), "teacherUnits.deploymentIneligible"],
    ["missing activation evidence", () => store.delete(CHAIN.activationEvidenceRef), "teacherUnits.deploymentIneligible"],
    ["missing activation approval", () => store.delete(CHAIN.activationApprovalRef), "teacherUnits.deploymentIneligible"],
    ["policy placement differs from runtime placement", () => setPolicy({ ...CHAIN.policy, placementFingerprint: "e".repeat(64) }), "teacherUnits.deploymentIneligible"],
  ];
  it.each(states)("refuses every management operation for %s with no write", async (_label, mutate, code) => {
    const unitId = await seedUnit();
    mutate();
    const before = snapshotWrites();
    for (const op of MANAGEMENT) expect(await codeOf(RAW[op](req(TEACHER, managementRequest(op, unitId))))).toBe(code);
    expect(snapshotWrites()).toBe(before);
  });

  it("reports an unreadable policy as policyUnavailable", async () => {
    const unitId = await seedUnit();
    const original = store.get(TEACHER_UNITS_POLICY_PATH)!;
    // A non-retryable read failure on the policy document.
    store.set(TEACHER_UNITS_POLICY_PATH, { get data(): Record<string, any> { throw Object.assign(new Error("denied"), { code: 7 }); }, version: original.version });
    for (const op of ["get", "list", "update"] as const) {
      expect(await codeOf(RAW[op](req(TEACHER, managementRequest(op, unitId))))).toBe("teacherUnits.policyUnavailable");
    }
  });

  const ineligible: [string, Partial<TeacherUnitsEnforcement>][] = [
    ["provenance unverified", { provenance: () => ({ runtimeConsistency: "unverified", available: false, approvalVerification: "unverified", deploymentVerification: "unverified", releaseId: null }) }],
    ["provenance for another release", { provenance: () => ({ runtimeConsistency: "matched", available: false, approvalVerification: "unverified", deploymentVerification: "unverified", releaseId: "e".repeat(64) }) }],
    ["provenance throws", { provenance: () => { throw new Error("artifact"); } }],
    ["verifier throws", { verifier: { verify: () => Promise.reject(new Error("verifier")) } }],
    ["verifier unverified", { verifier: { verify: () => Promise.resolve({ verdict: "unverified", reason: "revoked" }) } }],
    ["verdict with an extra field", { verifier: testVerifier(CHAIN, { approved: true }) }],
    ["verdict for another generation", { verifier: testVerifier(CHAIN, { enabledGeneration: 4 }) }],
    ["verdict for another release", { verifier: testVerifier(CHAIN, { releaseId: "e".repeat(64) }) }],
    ["verdict naming another approval", { verifier: testVerifier(CHAIN, { activationApprovalRef: `teacherUnitsReleaseEvidence/${"e".repeat(64)}` }) }],
    ["verified Hosting fingerprint differs from the activation evidence", { verifier: testVerifier(CHAIN, { hostingCandidateFingerprint: "0".repeat(64) }) }],
  ];
  it.each(ineligible)("treats %s as deploymentIneligible", async (_label, override) => {
    const unitId = await seedUnit();
    const handlers = handlersFor(testEnforcement(IDENTITY, CHAIN, override));
    const before = snapshotWrites();
    for (const op of MANAGEMENT) expect(await codeOf(handlers[op](req(TEACHER, managementRequest(op, unitId))))).toBe("teacherUnits.deploymentIneligible");
    expect(snapshotWrites()).toBe(before);
    expect((await handlers.capabilities(req(TEACHER, V2_DISCOVERY))).teacherUnits.availability.state).toBe("unverified");
  });

  it("never caches a positive decision: each request and attempt re-evaluates", async () => {
    const verifier = testVerifier(CHAIN);
    const handlers = handlersFor(testEnforcement(IDENTITY, CHAIN, { verifier }));
    await handlers.list(req(TEACHER, {}));
    await handlers.list(req(TEACHER, {}));
    expect(verifier.calls).toBe(2);
    setPolicy(closedPolicy(EXPECTED, RUNTIME_PLACEMENT_FINGERPRINT));
    expect(await codeOf(handlers.list(req(TEACHER, {})))).toBe("teacherUnits.availabilityClosed");
  });
});

describe("A3-3 mutation compatibility envelope", () => {
  const MUTATIONS = ["create", "update", "archive", "restore", "setResources", "reorder"] as const;

  it.each([
    ["missing", undefined, "teacherUnits.compatibilityRequired"],
    ["null", null, "teacherUnits.invalidCompatibility"],
    ["schema 2", { ...COMPAT, schemaVersion: 2 }, "teacherUnits.invalidCompatibility"],
    ["v1 contract", { ...COMPAT, clientContractVersion: "teacher-units-v1" }, "teacherUnits.invalidCompatibility"],
    ["extra field", { ...COMPAT, extra: 1 }, "teacherUnits.invalidCompatibility"],
    ["noncanonical digest", { ...COMPAT, backendReleaseId: COMPAT.backendReleaseId.toUpperCase() }, "teacherUnits.invalidCompatibility"],
  ])("refuses a %s envelope on every mutation before any transaction", async (_label, envelope, code) => {
    const unitId = await seedUnit();
    const before = snapshotWrites();
    const attempts = txAttempts;
    for (const op of MUTATIONS) {
      const data = { ...managementRequest(op, unitId) };
      if (envelope === undefined) delete data.compatibility; else data.compatibility = envelope;
      expect(await codeOf(RAW[op](req(TEACHER, data)))).toBe(code);
    }
    expect(txAttempts).toBe(attempts);
    expect(snapshotWrites()).toBe(before);
  });

  it.each([
    ["stale generation", { policyGeneration: 2 }, "teacherUnits.policyChanged"],
    ["other policy instance", { policyInstanceId: "223e4567-e89b-42d3-a456-426614174000" }, "teacherUnits.policyChanged"],
    ["other release", { backendReleaseId: "e".repeat(64) }, "teacherUnits.policyChanged"],
    ["other placement", { placementFingerprint: "e".repeat(64) }, "teacherUnits.placementMismatch"],
  ])("refuses a %s envelope inside the transaction with no write", async (_label, change, code) => {
    const unitId = await seedUnit();
    const before = snapshotWrites();
    for (const op of MUTATIONS) {
      expect(await codeOf(RAW[op](req(TEACHER, { ...managementRequest(op, unitId), compatibility: { ...COMPAT, ...change } })))).toBe(code);
    }
    expect(snapshotWrites()).toBe(before);
  });

  it("orders availability ahead of envelope binding", async () => {
    const unitId = await seedUnit();
    setPolicy(closedPolicy(EXPECTED, RUNTIME_PLACEMENT_FINGERPRINT));
    expect(await codeOf(RAW.update(req(TEACHER, { ...managementRequest("update", unitId), compatibility: { ...COMPAT, policyGeneration: 2 } })))).toBe(
      "teacherUnits.availabilityClosed",
    );
  });

  it("does not accept an envelope on management reads", async () => {
    const unitId = await seedUnit();
    expect(await codeOf(RAW.get(req(TEACHER, { unitId, compatibility: COMPAT })))).toBe("teacherUnits.invalidRequest");
    expect(await codeOf(RAW.list(req(TEACHER, { compatibility: COMPAT })))).toBe("teacherUnits.invalidRequest");
  });

  it("requires expectedSchoolId on v2 create, first attempt and replay", async () => {
    const data = { grade: "7", title: "Earth", idempotencyKey: "school-key-01", compatibility: COMPAT };
    expect(await codeOf(RAW.create(req(TEACHER, data)))).toBe("teacherUnits.invalidExpectedSchoolId");
    expect(rowsUnder("teacherUnits/")).toEqual([]);
    await RAW.create(req(TEACHER, { ...data, expectedSchoolId: SCHOOL }));
    const attempts = txAttempts;
    expect(await codeOf(RAW.create(req(TEACHER, data)))).toBe("teacherUnits.invalidExpectedSchoolId");
    expect(txAttempts).toBe(attempts);
    expect(rowsUnder("teacherUnits/")).toHaveLength(1);
  });

  it("keeps the envelope out of create intent hashing and receipt identity", async () => {
    const base = { grade: "7" as const, title: "Earth", description: "" };
    expect(teacherUnitCreateRequestHash(base)).toBe(
      teacherUnitCreateRequestHash({ ...base, compatibility: COMPAT, expectedSchoolId: SCHOOL } as typeof base),
    );
    // A replay under a new enabled generation with a fresh envelope replays the original unit.
    const first = await RAW.create(req(TEACHER, { ...base, idempotencyKey: "gen-key-0001", expectedSchoolId: SCHOOL, compatibility: COMPAT }));
    const next = buildEnabledChain(EXPECTED, RUNTIME_PLACEMENT_FINGERPRINT, { generation: 4 });
    setPolicy(next.policy);
    for (const [path, data] of Object.entries(next.documents)) store.set(path, { data, version: ++version });
    const handlers = handlersFor(testEnforcement(IDENTITY, next));
    expect(await codeOf(handlers.create(req(TEACHER, { ...base, idempotencyKey: "gen-key-0001", expectedSchoolId: SCHOOL, compatibility: COMPAT })))).toBe(
      "teacherUnits.policyChanged",
    );
    const replay = await handlers.create(req(TEACHER, { ...base, idempotencyKey: "gen-key-0001", expectedSchoolId: SCHOOL, compatibility: next.compatibility }));
    expect(replay.replayed).toBe(true);
    expect(replay.unit.unitId).toBe(first.unit.unitId);
    // Receipt identity and stored intent hash depend only on teacher, school, key and intent.
    const receipt = store.get(`teacherUnitCreateReceipts/${teacherUnitCreateReceiptId(TEACHER, SCHOOL, "gen-key-0001")}`);
    expect(receipt?.data).toMatchObject({ unitId: first.unit.unitId, requestHash: teacherUnitCreateRequestHash(base) });
    expect(JSON.stringify(receipt?.data)).not.toContain(COMPAT.backendReleaseId);
    expect(rowsUnder("teacherUnits/")).toHaveLength(1);
    expect(rowsUnder("teacherUnitCreateReceipts/")).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });
});

describe("A3-3 Firestore SDK reruns (approved Option A)", () => {
  it("re-evaluates availability on a rerun caused by a concurrent policy change", async () => {
    const unitId = await seedUnit();
    const next = buildEnabledChain(EXPECTED, RUNTIME_PLACEMENT_FINGERPRINT, { generation: 4 });
    let first = true;
    const verifier = {
      calls: 0,
      verify: async (...args: Parameters<ReturnType<typeof testVerifier>["verify"]>) => {
        verifier.calls += 1;
        if (first) {
          first = false;
          // The policy moves after this attempt read it: the read set changed, so the attempt reruns.
          setPolicy(next.policy);
          for (const [path, data] of Object.entries(next.documents)) store.set(path, { data, version: ++version });
          return testVerifier(CHAIN).verify(...args);
        }
        return testVerifier(next).verify(...args);
      },
    };
    const handlers = handlersFor(testEnforcement(IDENTITY, CHAIN, { verifier }));
    const before = snapshotWrites();
    expect(await codeOf(handlers.update(req(TEACHER, managementRequest("update", unitId))))).toBe("teacherUnits.policyChanged");
    expect(verifier.calls).toBe(2);
    expect(snapshotWrites()).toBe(before);
  });

  const LANDED: [string, (unitId: string) => Promise<any>, (unitId: string) => void][] = [
    ["create", () => RAW.create(req(TEACHER, managementRequest("create", ""))), () => {
      expect(rowsUnder("teacherUnits/")).toHaveLength(2);
      expect(rowsUnder("teacherUnitCreateReceipts/")).toHaveLength(2);
    }],
    ["update", (unitId) => RAW.update(req(TEACHER, managementRequest("update", unitId))), (unitId) => {
      expect(store.get(`teacherUnits/${unitId}`)?.data).toMatchObject({ title: "Renamed", revision: 2 });
    }],
    ["archive", (unitId) => RAW.archive(req(TEACHER, managementRequest("archive", unitId))), (unitId) => {
      expect(store.get(`teacherUnits/${unitId}`)?.data).toMatchObject({ status: "archived", revision: 2 });
    }],
    ["setResources", (unitId) => RAW.setResources(req(TEACHER, managementRequest("setResources", unitId))), (unitId) => {
      expect(store.get(`teacherUnits/${unitId}`)?.data).toMatchObject({ resourceIds: [UNIT_PLACEABLE_RESOURCE_ID_LIST[0]], revision: 2 });
    }],
  ];
  it.each(LANDED)("converges a %s rerun after a commit that landed, with no second write or audit", async (op, run, check) => {
    const unitId = await seedUnit();
    const auditsBefore = audits.length;
    commitFault = { kind: "landed", remaining: 1 };
    const result = await run(unitId);
    if (op === "create") expect(result.replayed).toBe(true);
    else expect(result.noop).toBe(true);
    expect(audits.length - auditsBefore).toBe(1);
    check(unitId);
  });

  it("converges a restore and a reorder rerun after a commit that landed", async () => {
    const unitId = await seedUnit();
    await __teacherUnitsArchiveHandler(req(TEACHER, { unitId, expectedRevision: 1 }));
    let auditsBefore = audits.length;
    commitFault = { kind: "landed", remaining: 1 };
    expect((await RAW.restore(req(TEACHER, { unitId, expectedRevision: 2, compatibility: COMPAT }))).noop).toBe(true);
    expect(audits.length - auditsBefore).toBe(1);
    expect(store.get(`teacherUnits/${unitId}`)?.data).toMatchObject({ status: "active", revision: 3 });
    const second = (await create(TEACHER, { grade: "7", title: "Mars" })).unit.unitId;
    auditsBefore = audits.length;
    commitFault = { kind: "landed", remaining: 1 };
    const reordered = await RAW.reorder(req(TEACHER, { grade: "7", compatibility: COMPAT,
      units: [{ unitId: second, expectedRevision: 1 }, { unitId, expectedRevision: 3 }] }));
    expect(reordered.noop).toBe(true);
    expect(audits.length - auditsBefore).toBe(2);
    expect(reordered.units.map((u) => u.unitId)).toEqual([second, unitId]);
  });

  it("creates exactly once when the failed commit did not land", async () => {
    commitFault = { kind: "lost", remaining: 1 };
    const result = await RAW.create(req(TEACHER, managementRequest("create", "")));
    expect(result.replayed).toBe(false);
    expect(rowsUnder("teacherUnits/")).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it("never reports a refusal after a possibly committed attempt as a pre-commit rejection", async () => {
    const unitId = await seedUnit();
    const auditsBefore = audits.length;
    // The commit lands, the acknowledgement is lost, and the policy closes before the rerun.
    commitFault = { kind: "landed", remaining: 1, beforeRerun: () => setPolicy(closedPolicy(EXPECTED, RUNTIME_PLACEMENT_FINGERPRINT)) };
    const { code } = await errorOf(RAW.update(req(TEACHER, managementRequest("update", unitId))));
    expect(code).toBe("teacherUnits.availabilityClosed");
    expect([...CLIENT_PRE_COMMIT_CODES, ...PRE_TRANSACTION_A3_CODES]).not.toContain(code);
    // The committed write and its audit stand; nothing was rolled back or duplicated.
    expect(store.get(`teacherUnits/${unitId}`)?.data).toMatchObject({ title: "Renamed", revision: 2 });
    expect(audits.length - auditsBefore).toBe(1);
  });

  it("surfaces exhausted ambiguous commits as non-pre-commit failures without resubmission", async () => {
    const attemptsBefore = txAttempts;
    commitFault = { kind: "lost", remaining: 5 };
    const { code } = await errorOf(RAW.create(req(TEACHER, managementRequest("create", ""))));
    expect(code).toBe(String(DEADLINE_EXCEEDED));
    expect([...CLIENT_PRE_COMMIT_CODES, ...PRE_TRANSACTION_A3_CODES]).not.toContain(code);
    // Only the SDK's own reruns: the handler issues no further transaction.
    expect(txAttempts - attemptsBefore).toBe(5);
    expect(rowsUnder("teacherUnits/")).toEqual([]);
    expect(audits).toEqual([]);
  });
});

describe("A3-3 post-commit responseUnavailable", () => {
  // The write transaction verifies; every later transaction (the response read)
  // is unverifiable.
  function failingAfterFirst(): TeacherUnitsEnforcement {
    let calls = 0;
    const verified = testVerifier(CHAIN);
    return testEnforcement(IDENTITY, CHAIN, {
      verifier: { verify: (input) => (++calls === 1 ? verified.verify(input) : Promise.resolve({ verdict: "unverified", reason: "revoked" })) },
    });
  }

  const OPS: [Exclude<Management, "get" | "list">, (unitId: string) => Record<string, unknown>][] = [
    ["create", () => managementRequest("create", "")],
    ["update", (unitId) => managementRequest("update", unitId)],
    ["archive", (unitId) => managementRequest("archive", unitId)],
    ["setResources", (unitId) => managementRequest("setResources", unitId)],
    ["reorder", (unitId) => ({ grade: "7", units: [{ unitId, expectedRevision: 1 }], compatibility: COMPAT })],
  ];
  it.each(OPS)("reports a committed %s as unconfirmed when revalidation fails", async (op, data) => {
    const unitId = await seedUnit();
    if (op === "reorder") {
      // Give the single unit a position change so the reorder writes.
      store.set(`teacherUnits/${unitId}`, { data: { ...store.get(`teacherUnits/${unitId}`)!.data, sortOrder: 5 }, version: ++version });
    }
    const auditsBefore = audits.length;
    const handlers = handlersFor(failingAfterFirst());
    const error = await errorOf(handlers[op](req(TEACHER, data(unitId))));
    expect(error.code).toBe("teacherUnits.responseUnavailable");
    expect(error.details).toEqual({ outcome: "unconfirmed", operation: op });
    expect(error.message).toBe("Your change may have been saved, but it could not be confirmed. Reload your units before trying again.");
    expect(audits.length - auditsBefore).toBe(1);
    if (op === "create") expect(rowsUnder("teacherUnitCreateReceipts/")).toHaveLength(2);
    else expect(store.get(`teacherUnits/${unitId}`)?.data.revision).toBe(2);
  });

  it("reports a committed restore as unconfirmed", async () => {
    const unitId = await seedUnit();
    await __teacherUnitsArchiveHandler(req(TEACHER, { unitId, expectedRevision: 1 }));
    const error = await errorOf(handlersFor(failingAfterFirst()).restore(req(TEACHER, { unitId, expectedRevision: 2, compatibility: COMPAT })));
    expect(error).toMatchObject({ code: "teacherUnits.responseUnavailable", details: { outcome: "unconfirmed", operation: "restore" } });
    expect(store.get(`teacherUnits/${unitId}`)?.data).toMatchObject({ status: "active", revision: 3 });
  });

  const scope = (endpoint: "teacherUnitsCreate" | "teacherUnitsUpdate" | "teacherUnitsReorder") =>
    ({ identity: IDENTITY, enforcement: testEnforcement(IDENTITY, CHAIN), endpoint });
  const actor = { uid: TEACHER, schoolId: SCHOOL, districtId: "district-1" };
  const sources: [string, () => void][] = [
    ["an account suspension", () => setUser(TEACHER, { status: "suspended", role: "teacher", schoolId: SCHOOL })],
    ["a policy closure", () => setPolicy(closedPolicy(EXPECTED, RUNTIME_PLACEMENT_FINGERPRINT))],
    ["a missing policy", () => store.delete(TEACHER_UNITS_POLICY_PATH)],
    ["a transient failure", () => { throw Object.assign(new Error("unavailable"), { code: 14 }); }],
    ["an unknown failure", () => { throw new Error("boom"); }],
  ];
  it.each(sources)("maps %s after commit to responseUnavailable for create, update and reorder", async (_label, after) => {
    const hooks = { afterCommit: async () => { after(); } };
    const created = await errorOf(createTeacherUnit(scope("teacherUnitsCreate"), actor,
      { grade: "7", title: "Earth", description: "", idempotencyKey: "post-key-01", expectedSchoolId: SCHOOL, compatibility: COMPAT }, hooks));
    expect(created).toMatchObject({ code: "teacherUnits.responseUnavailable", details: { outcome: "unconfirmed", operation: "create" } });
    expect(rowsUnder("teacherUnits/")).toHaveLength(1);
    expect(rowsUnder("teacherUnitCreateReceipts/")).toHaveLength(1);
    expect(audits).toHaveLength(1);
    // Restore a usable state for the next mutation.
    seedEnabledPolicy();
    setUser(TEACHER, { status: "active", role: "teacher", schoolId: SCHOOL });
    const unitId = Object.keys(Object.fromEntries(store)).find((p) => p.startsWith("teacherUnits/"))!.split("/")[1];
    const updated = await errorOf(mutateOwnedTeacherUnit(scope("teacherUnitsUpdate"), actor,
      { operation: "update", unitId, expectedRevision: 1, compatibility: COMPAT },
      () => ({ fields: { title: "Renamed" }, action: "teacherUnits.updated", changedFields: ["title"] }), hooks));
    expect(updated).toMatchObject({ code: "teacherUnits.responseUnavailable", details: { outcome: "unconfirmed", operation: "update" } });
    expect(store.get(`teacherUnits/${unitId}`)?.data).toMatchObject({ title: "Renamed", revision: 2 });
    seedEnabledPolicy();
    setUser(TEACHER, { status: "active", role: "teacher", schoolId: SCHOOL });
    store.set(`teacherUnits/${unitId}`, { data: { ...store.get(`teacherUnits/${unitId}`)!.data, sortOrder: 9 }, version: ++version });
    const reordered = await errorOf(reorderTeacherUnits(scope("teacherUnitsReorder"), actor,
      { grade: "7", units: [{ unitId, expectedRevision: 2 }], compatibility: COMPAT }, hooks));
    expect(reordered).toMatchObject({ code: "teacherUnits.responseUnavailable", details: { outcome: "unconfirmed", operation: "reorder" } });
    expect(store.get(`teacherUnits/${unitId}`)?.data).toMatchObject({ sortOrder: 1, revision: 3 });
    expect(audits).toHaveLength(3);
  });

  it("does not use responseUnavailable for refusals before or without a commit", async () => {
    const unitId = await seedUnit();
    // No-op: nothing committed by this request, so ordinary codes apply.
    setPolicy(closedPolicy(EXPECTED, RUNTIME_PLACEMENT_FINGERPRINT));
    expect(await codeOf(RAW.archive(req(TEACHER, managementRequest("archive", unitId))))).toBe("teacherUnits.availabilityClosed");
    seedEnabledPolicy();
    expect(await codeOf(RAW.update(req(TEACHER, { ...managementRequest("update", unitId), expectedRevision: 7 })))).toBe("teacherUnits.writeConflict");
  });
});
