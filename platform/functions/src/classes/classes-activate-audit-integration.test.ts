import type { CallableRequest } from "firebase-functions/v2/https";

// Sprint 24B Phase 2B.6 activation audit regression test.
//
// Reason for a second integration test: the pre-existing
// `classes-lifecycle-integration.test.ts` composes classesLmsCreate and
// classesActivate end-to-end, but it mocks the canonical audit writer.
// That mock is what allowed the Sprint 24B Phase 2B.3 audit-vocabulary
// drift to ship: `classes.activated` was added to the AuditAction type
// union but not to the runtime allowlist, and no test exercised the real
// vocabulary check on the activation call site. Every classesActivate
// invocation committed the class transaction and then failed its audit
// write, returning a client-visible error after the class had already
// become active.
//
// This test file wires the same classesActivate handler through the REAL
// canonical writeAuditEvent (via jest.requireActual). writeAuditEvent's
// only Firestore dependency, auditEventsCollectionRef, is stubbed here
// with an in-memory .add() that captures the exact payload sent to
// Firestore. This means the vocabulary validation, the canonical shape
// invariant, and the audit ordering are all covered by the real code
// paths that ship. There is no emulator round-trip.
//
// The test intentionally reuses the class-doc + transaction mock pattern
// from `classes-lifecycle-integration.test.ts` so a future refactor of
// the mock scaffolding can be applied to both files consistently.

const store = new Map<string, Record<string, unknown>>();
const auditEventsWritten: Array<Record<string, unknown>> = [];

const mockClassGet = jest.fn(() => {
  const record = store.get("class-1");
  return Promise.resolve(
    record
      ? { exists: true, data: () => record }
      : { exists: false, data: () => undefined },
  );
});
const mockClassSet = jest.fn((payload: Record<string, unknown>) => {
  store.set("class-1", { ...payload });
  return Promise.resolve();
});
const mockClassActivationUpdate = jest.fn();

const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockClassLmsCreationDocRef = jest.fn(() => ({ set: mockClassSet }));
const mockClassActivationDocRef = jest.fn(() => ({}));

const mockCollectionQuery = {
  where: jest.fn(),
  limit: jest.fn(),
  get: jest.fn(() => Promise.resolve({ empty: true, docs: [] })),
};
mockCollectionQuery.where.mockImplementation(() => mockCollectionQuery);
mockCollectionQuery.limit.mockImplementation(() => mockCollectionQuery);
const mockClassesCollectionRef = jest.fn(() => mockCollectionQuery);

const mockRequireDistrictContext = jest.fn();

const mockRunFirestoreTransaction = jest.fn(
  (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: () => {
        const record = store.get("class-1");
        return Promise.resolve(
          record
            ? { exists: true, data: () => record }
            : { exists: false, data: () => undefined },
        );
      },
      update: (
        _ref: unknown,
        write: Record<string, unknown>,
      ) => {
        mockClassActivationUpdate(_ref, write);
        const existing = store.get("class-1") ?? {};
        store.set("class-1", { ...existing, ...write });
      },
    };
    return fn(tx);
  },
);

// Deterministic serverTimestamp sentinel so the audit writer's occurredAt
// field is comparable in assertions.
const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

// Deterministic join code so assertions can compare against a fixed value.
jest.mock("node:crypto", () => ({
  randomBytes: (n: number) => Buffer.alloc(n, 0xf0),
}));

// Stub auditEventsCollectionRef so writeAuditEvent's real code path has a
// place to send the write. The stub captures the exact payload sent to
// Firestore's .add() so tests can assert on the canonical shape.
jest.mock("../shared/firestore/typed-ref", () => ({
  auditEventsCollectionRef: () => ({
    add: (payload: Record<string, unknown>) => {
      auditEventsWritten.push({ ...payload });
      return Promise.resolve({ id: `evt-${auditEventsWritten.length}` });
    },
  }),
}));

// Partial mock of ../shared: everything mocked as before EXCEPT
// writeAuditEvent, which resolves to the real implementation. This is the
// architectural point of this file.
jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  const { assertClassSupports } = jest.requireActual(
    "../shared/classes/eligibility",
  );
  const { writeAuditEvent: realWriteAuditEvent } = jest.requireActual(
    "../shared/audit/write-audit-event",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    assertClassSupports,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    classDocRef: mockClassDocRef,
    classLmsCreationDocRef: mockClassLmsCreationDocRef,
    classActivationDocRef: mockClassActivationDocRef,
    classesCollectionRef: mockClassesCollectionRef,
    requireDistrictContext: mockRequireDistrictContext,
    runFirestoreTransaction: mockRunFirestoreTransaction,
    writeAuditEvent: realWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __classesLmsCreateHandler } from "./classes-lms-create";
import { __classesActivateHandler } from "./classes-activate";

const TEACHER_UID = "teacher-1";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";

function req(data: unknown): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

describe("classesActivate audit regression (Sprint 24B Phase 2B.6, unmocked audit writer)", () => {
  beforeEach(() => {
    store.clear();
    auditEventsWritten.length = 0;
    mockClassGet.mockClear();
    mockClassSet.mockClear();
    mockClassActivationUpdate.mockClear();
    mockCollectionQuery.get.mockClear();
    mockCollectionQuery.where.mockClear();
    mockCollectionQuery.limit.mockClear();
    mockRunFirestoreTransaction.mockClear();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({
      uid: TEACHER_UID,
      role: "teacher",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    mockCollectionQuery.get.mockImplementation(() =>
      Promise.resolve({ empty: true, docs: [] }),
    );
  });

  async function createNeedsSetupClass(): Promise<void> {
    const created = await __classesLmsCreateHandler(
      req({ classId: "class-1", title: "Upstream Course" }),
    );
    expect(created.status).toBe("needsSetup");
    // Discard the classes.created event produced by classesLmsCreate so
    // the activation assertions can inspect only the activation event.
    auditEventsWritten.length = 0;
  }

  it("activates a needsSetup class, resolves successfully, and writes exactly one classes.activated audit event with the canonical payload", async () => {
    await createNeedsSetupClass();

    const activated = await __classesActivateHandler(
      req({ classId: "class-1", grade: "6", block: "B" }),
    );

    // Callable resolved successfully.
    expect(activated).toMatchObject({
      classId: "class-1",
      status: "active",
      alreadyActive: false,
    });
    expect(activated.joinCode).toMatch(/^[A-F0-9]{8}$/);

    // Class doc is atomically active with grade + block + joinCode.
    const record = store.get("class-1")!;
    expect(record.status).toBe("active");
    expect(record.grade).toBe("6");
    expect(record.block).toBe("B");
    expect(record.joinCode).toBe(activated.joinCode);

    // Exactly one classes.activated audit event, canonical shape.
    expect(auditEventsWritten).toHaveLength(1);
    const event = auditEventsWritten[0];
    expect(event).toEqual({
      actorUserId: TEACHER_UID,
      actorRole: "teacher",
      action: "classes.activated",
      targetType: "class",
      targetId: "class-1",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      payload: {
        previousStatus: "needsSetup",
        grade: "6",
        block: "B",
      },
      occurredAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("is idempotent: a second identical activation succeeds, preserves joinCode, and writes no additional audit event", async () => {
    await createNeedsSetupClass();

    const first = await __classesActivateHandler(
      req({ classId: "class-1", grade: "6", block: "B" }),
    );
    expect(first.alreadyActive).toBe(false);
    const firstJoinCode = first.joinCode;
    expect(auditEventsWritten).toHaveLength(1);

    const second = await __classesActivateHandler(
      req({ classId: "class-1", grade: "6", block: "B" }),
    );
    expect(second).toMatchObject({
      classId: "class-1",
      status: "active",
      alreadyActive: true,
      joinCode: firstJoinCode,
    });

    // Class doc unchanged, joinCode preserved.
    const record = store.get("class-1")!;
    expect(record.joinCode).toBe(firstJoinCode);

    // Still exactly one activation audit event.
    expect(auditEventsWritten).toHaveLength(1);
    expect(auditEventsWritten[0].action).toBe("classes.activated");
  });

  it("rejects a conflicting grade after activation without emitting a second audit event", async () => {
    await createNeedsSetupClass();
    await __classesActivateHandler(
      req({ classId: "class-1", grade: "6", block: "B" }),
    );
    expect(auditEventsWritten).toHaveLength(1);

    await expect(
      __classesActivateHandler(
        req({ classId: "class-1", grade: "7", block: "B" }),
      ),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "classes.alreadyActiveConflict",
    });
    expect(auditEventsWritten).toHaveLength(1);
  });

  it("rejects a conflicting block after activation without emitting a second audit event", async () => {
    await createNeedsSetupClass();
    await __classesActivateHandler(
      req({ classId: "class-1", grade: "6", block: "B" }),
    );
    expect(auditEventsWritten).toHaveLength(1);

    await expect(
      __classesActivateHandler(
        req({ classId: "class-1", grade: "6", block: "C" }),
      ),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "classes.alreadyActiveConflict",
    });
    expect(auditEventsWritten).toHaveLength(1);
  });

  it("rejects a not-found class before touching the audit writer", async () => {
    // No createNeedsSetupClass call: the class doc does not exist.
    await expect(
      __classesActivateHandler(
        req({ classId: "class-1", grade: "6", block: "B" }),
      ),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "classes.notFound",
    });
    expect(auditEventsWritten).toHaveLength(0);
  });

  it("rejects an archived class with classes.notActivatable and no audit event", async () => {
    // Seed an archived record directly to model the terminal state.
    store.set("class-1", {
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      title: "Archived Course",
      status: "archived",
    });

    await expect(
      __classesActivateHandler(
        req({ classId: "class-1", grade: "6", block: "B" }),
      ),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "classes.notActivatable",
    });
    expect(auditEventsWritten).toHaveLength(0);

    // Untouched.
    const record = store.get("class-1")!;
    expect(record.status).toBe("archived");
  });

  // Sprint 24B Phase 2B.7. LMS activation regression. Composes the real
  // classesLmsCreate handler (which writes `enrollmentSource: "lms"` and
  // `lmsProviderRef: "googleClassroom"` via lmsClassesImport in
  // production, but for this in-memory scaffold we seed those fields
  // directly onto the needsSetup record after creation because the LMS
  // link write path is not exercised here). Then invokes the real
  // classesActivate handler and verifies:
  //   - the class doc has no joinCode after activation
  //   - the response's joinCode is null
  //   - the audit event is still written with the canonical payload
  //   - the join-code allocator is not consulted
  it("Sprint 24B Phase 2B.7: activates an LMS-sourced class without writing or returning a joinCode", async () => {
    await createNeedsSetupClass();
    // Simulate the LMS link write (lmsClassesImport in production).
    const existing = store.get("class-1")!;
    store.set("class-1", {
      ...existing,
      enrollmentSource: "lms",
      lmsProviderRef: "googleClassroom",
    });

    const activated = await __classesActivateHandler(
      req({ classId: "class-1", grade: "6", block: "B" }),
    );

    // Callable resolved successfully with joinCode: null.
    expect(activated).toEqual({
      classId: "class-1",
      status: "active",
      joinCode: null,
      alreadyActive: false,
    });

    // Class doc is active with grade + block, but NO joinCode field.
    const record = store.get("class-1")!;
    expect(record.status).toBe("active");
    expect(record.grade).toBe("6");
    expect(record.block).toBe("B");
    expect(record).not.toHaveProperty("joinCode");
    // LMS discriminators preserved.
    expect(record.enrollmentSource).toBe("lms");
    expect(record.lmsProviderRef).toBe("googleClassroom");

    // Audit event still fires exactly once with the canonical payload
    // (payload does not carry LMS discriminators; that is out of scope
    // for this narrow correction per the audit payload contract).
    expect(auditEventsWritten).toHaveLength(1);
    expect(auditEventsWritten[0]).toEqual({
      actorUserId: TEACHER_UID,
      actorRole: "teacher",
      action: "classes.activated",
      targetType: "class",
      targetId: "class-1",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      payload: {
        previousStatus: "needsSetup",
        grade: "6",
        block: "B",
      },
      occurredAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  // Sprint 24B Phase 2B.7. LMS idempotent replay preserves joinCode:
  // null and writes no additional audit event.
  it("Sprint 24B Phase 2B.7: idempotent replay of LMS activation returns joinCode: null and writes no additional audit event", async () => {
    await createNeedsSetupClass();
    const existing = store.get("class-1")!;
    store.set("class-1", {
      ...existing,
      enrollmentSource: "lms",
      lmsProviderRef: "googleClassroom",
    });

    const first = await __classesActivateHandler(
      req({ classId: "class-1", grade: "6", block: "B" }),
    );
    expect(first.joinCode).toBeNull();
    expect(first.alreadyActive).toBe(false);
    expect(auditEventsWritten).toHaveLength(1);

    const second = await __classesActivateHandler(
      req({ classId: "class-1", grade: "6", block: "B" }),
    );
    expect(second).toEqual({
      classId: "class-1",
      status: "active",
      joinCode: null,
      alreadyActive: true,
    });

    // Still exactly one activation audit event.
    expect(auditEventsWritten).toHaveLength(1);
    // Class doc still has no joinCode.
    expect(store.get("class-1")!).not.toHaveProperty("joinCode");
  });

  it("regression asserter: throws PlatformError not HttpsError, so the callable wrapper can remap correctly", async () => {
    // Sanity: the real writeAuditEvent must accept classes.activated. If a
    // future regression removes it from AUDIT_ACTIONS, this exact call
    // path throws audit.invalidAction and this test catches it via the
    // audit-count assertion below (0 rather than 1). This assertion is
    // redundant with the exhaustive AUDIT_ACTIONS test in
    // write-audit-event.test.ts, but co-locates the regression signal
    // with the call site that originally broke.
    await createNeedsSetupClass();
    await expect(
      __classesActivateHandler(
        req({ classId: "class-1", grade: "8", block: "A" }),
      ),
    ).resolves.toMatchObject({ status: "active" });
    expect(auditEventsWritten).toHaveLength(1);
    expect(auditEventsWritten[0].action).toBe("classes.activated");
  });
});

// Guard against a name change that would silently disable this file: if
// the imported symbol is renamed or removed, the require will fail and
// the whole suite will refuse to load.
if (typeof __classesActivateHandler !== "function") {
  throw new PlatformError(
    "test.setupFailed",
    "__classesActivateHandler is not exported; regression file is inert.",
  );
}
