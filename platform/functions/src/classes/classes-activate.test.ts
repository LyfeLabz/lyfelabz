import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockClassActivationDocRef = jest.fn((id: string) => ({ __ref: id }));

const mockCollectionGet = jest.fn();
const mockCollectionQuery = {
  where: jest.fn(),
  limit: jest.fn(),
  get: mockCollectionGet,
};
mockCollectionQuery.where.mockImplementation(() => mockCollectionQuery);
mockCollectionQuery.limit.mockImplementation(() => mockCollectionQuery);
const mockClassesCollectionRef = jest.fn(() => mockCollectionQuery);

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();
const mockRunFirestoreTransaction = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

// Deterministic randomBytes: cycles through a fixed buffer sequence so
// join-code collision retries produce predictable candidate codes.
const randomBytesCalls: Buffer[] = [];
let randomBytesSequence: Buffer[] = [];

jest.mock("node:crypto", () => ({
  randomBytes: (n: number) => {
    const next = randomBytesSequence.shift();
    const buf = next ?? Buffer.alloc(n, 0xab);
    randomBytesCalls.push(buf);
    return buf;
  },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  const { assertClassSupports } = jest.requireActual(
    "../shared/classes/eligibility",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    assertClassSupports,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    classDocRef: mockClassDocRef,
    classActivationDocRef: mockClassActivationDocRef,
    classesCollectionRef: mockClassesCollectionRef,
    requireDistrictContext: mockRequireDistrictContext,
    runFirestoreTransaction: mockRunFirestoreTransaction,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __classesActivateHandler } from "./classes-activate";

const CLASS_ID = "class-abc";

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: "teacher-uid",
  role: "teacher" as const,
  schoolId: "school-a",
  districtId: "district-1",
});

const VALID_DATA = { classId: CLASS_ID, grade: "7", block: "C" } as const;

function makeRequest(
  overrides: { data?: unknown } = {},
): CallableRequest<unknown> {
  const data = overrides.data === undefined ? { ...VALID_DATA } : overrides.data;
  return {
    data,
    auth: { uid: "teacher-uid", token: {} } as never,
    rawRequest: {} as never,
  };
}

function absentSnapshot() {
  return { exists: false, data: () => undefined };
}

function needsSetupSnapshot(
  overrides: { teacherId?: string; schoolId?: string } = {},
) {
  return {
    exists: true,
    data: () => ({
      teacherId: overrides.teacherId ?? "teacher-uid",
      schoolId: overrides.schoolId ?? "school-a",
      title: "Some Course",
      status: "needsSetup",
      createdAt: {} as never,
    }),
  };
}

// Sprint 24B Phase 2B.7. LMS-sourced needsSetup snapshot. Distinguished
// from the manual variant by `enrollmentSource: "lms"` and
// `lmsProviderRef: "googleClassroom"`. Activation of this shape must
// write no joinCode and return joinCode: null.
function needsSetupLmsSnapshot(
  overrides: { teacherId?: string; schoolId?: string } = {},
) {
  return {
    exists: true,
    data: () => ({
      teacherId: overrides.teacherId ?? "teacher-uid",
      schoolId: overrides.schoolId ?? "school-a",
      title: "Some Course",
      status: "needsSetup",
      createdAt: {} as never,
      enrollmentSource: "lms",
      lmsProviderRef: "googleClassroom",
    }),
  };
}

// Sprint 24B Phase 2B.7. Already-active LMS-sourced snapshot with no
// joinCode. The idempotent branch must return joinCode: null against
// this shape and must not touch the transaction.
function activeLmsSnapshot(
  overrides: {
    teacherId?: string;
    schoolId?: string;
    grade?: string;
    block?: string;
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      teacherId: overrides.teacherId ?? "teacher-uid",
      schoolId: overrides.schoolId ?? "school-a",
      title: "Some Course",
      grade: overrides.grade ?? "7",
      block: overrides.block ?? "C",
      status: "active",
      createdAt: {} as never,
      enrollmentSource: "lms",
      lmsProviderRef: "googleClassroom",
    }),
  };
}

function activeSnapshot(
  overrides: {
    teacherId?: string;
    schoolId?: string;
    grade?: string;
    block?: string;
    joinCode?: string;
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      teacherId: overrides.teacherId ?? "teacher-uid",
      schoolId: overrides.schoolId ?? "school-a",
      title: "Some Course",
      grade: overrides.grade ?? "7",
      block: overrides.block ?? "C",
      joinCode: overrides.joinCode ?? "EXISTING1",
      status: "active",
      createdAt: {} as never,
    }),
  };
}

function archivedSnapshot() {
  return {
    exists: true,
    data: () => ({
      teacherId: "teacher-uid",
      schoolId: "school-a",
      title: "Some Course",
      grade: "7",
      block: "C",
      joinCode: "OLDCODE1",
      status: "archived",
      createdAt: {} as never,
    }),
  };
}

type FakeTx = {
  get: jest.Mock;
  update: jest.Mock;
};

function makeTx(readSnapshots: Array<() => unknown>): FakeTx {
  const get = jest.fn();
  for (const snapshot of readSnapshots) {
    get.mockImplementationOnce(() => Promise.resolve(snapshot()));
  }
  return { get, update: jest.fn() };
}

// Runs a transaction body with a synthetic Transaction that returns the
// pre-scripted snapshot sequence to tx.get and records tx.update calls.
function primeTransaction(tx: FakeTx): void {
  mockRunFirestoreTransaction.mockImplementationOnce((fn: (t: FakeTx) => Promise<unknown>) =>
    fn(tx),
  );
}

function primeUniqueJoinCode(): void {
  // Empty query snapshot -> unique candidate.
  mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });
}

function primeCollidingJoinCode(): void {
  mockCollectionGet.mockResolvedValueOnce({
    empty: false,
    docs: [{ id: "other-class" }],
  });
}

describe("classesActivate", () => {
  beforeEach(() => {
    mockClassGet.mockReset();
    mockClassDocRef.mockClear();
    mockClassActivationDocRef.mockClear();
    mockCollectionGet.mockReset();
    mockClassesCollectionRef.mockClear();
    mockCollectionQuery.where.mockClear();
    mockCollectionQuery.limit.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockRunFirestoreTransaction.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
    randomBytesCalls.length = 0;
    randomBytesSequence = [];
  });

  it("activates a needsSetup class atomically and emits an audit event", async () => {
    randomBytesSequence.push(Buffer.from([0xab, 0xcd, 0xef, 0x12]));
    mockClassGet.mockResolvedValueOnce(needsSetupSnapshot());
    primeUniqueJoinCode();
    const tx = makeTx([() => needsSetupSnapshot()]);
    primeTransaction(tx);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __classesActivateHandler(makeRequest());

    expect(mockClassActivationDocRef).toHaveBeenCalledWith(CLASS_ID);
    expect(tx.update).toHaveBeenCalledTimes(1);
    const [, write] = tx.update.mock.calls[0]!;
    expect(write).toEqual({
      status: "active",
      grade: "7",
      block: "C",
      joinCode: "ABCDEF12",
    });

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "classes.activated",
      targetType: "class",
      targetId: CLASS_ID,
      schoolId: "school-a",
      districtId: "district-1",
      payload: {
        previousStatus: "needsSetup",
        grade: "7",
        block: "C",
      },
    });

    expect(result).toEqual({
      classId: CLASS_ID,
      status: "active",
      joinCode: "ABCDEF12",
      alreadyActive: false,
    });
  });

  it("is idempotent on an already-active class with matching grade and block", async () => {
    mockClassGet.mockResolvedValueOnce(activeSnapshot());

    const result = await __classesActivateHandler(makeRequest());

    expect(result).toEqual({
      classId: CLASS_ID,
      status: "active",
      joinCode: "EXISTING1",
      alreadyActive: true,
    });
    expect(mockRunFirestoreTransaction).not.toHaveBeenCalled();
    expect(mockCollectionGet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an already-active class with a differing grade", async () => {
    mockClassGet.mockResolvedValueOnce(activeSnapshot({ grade: "6" }));

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.alreadyActiveConflict" });
    expect(mockRunFirestoreTransaction).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an already-active class with a differing block", async () => {
    mockClassGet.mockResolvedValueOnce(activeSnapshot({ block: "D" }));

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.alreadyActiveConflict" });
  });

  it("rejects an archived class with classes.notActivatable", async () => {
    mockClassGet.mockResolvedValueOnce(archivedSnapshot());

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.notActivatable" });
    expect(mockRunFirestoreTransaction).not.toHaveBeenCalled();
  });

  it("rejects a class not found", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.notFound" });
  });

  it("rejects a cross-teacher activation with classes.forbidden", async () => {
    mockClassGet.mockResolvedValueOnce(
      needsSetupSnapshot({ teacherId: "someone-else" }),
    );

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
    expect(mockRunFirestoreTransaction).not.toHaveBeenCalled();
  });

  it("rejects a cross-school activation with classes.forbidden", async () => {
    mockClassGet.mockResolvedValueOnce(
      needsSetupSnapshot({ schoolId: "school-b" }),
    );

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("rejects an invalid grade", async () => {
    await expect(
      __classesActivateHandler(
        makeRequest({ data: { classId: CLASS_ID, grade: "9", block: "C" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidGrade" });
    await expect(
      __classesActivateHandler(
        makeRequest({ data: { classId: CLASS_ID, grade: 7, block: "C" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidGrade" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects an invalid block", async () => {
    await expect(
      __classesActivateHandler(
        makeRequest({ data: { classId: CLASS_ID, grade: "7", block: "H" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidBlock" });
    await expect(
      __classesActivateHandler(
        makeRequest({ data: { classId: CLASS_ID, grade: "7", block: "" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidBlock" });
  });

  it("rejects an invalid classId", async () => {
    await expect(
      __classesActivateHandler(
        makeRequest({ data: { classId: "bad/id", grade: "7", block: "C" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
  });

  it("rejects a non-object payload", async () => {
    await expect(
      __classesActivateHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "classes.invalidRequest" });
  });

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects a non-teacher active caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "student-uid",
      role: "student",
      schoolId: "school-a",
      districtId: "district-1",
    });

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("retries join-code generation on collision and succeeds within the cap", async () => {
    randomBytesSequence.push(
      Buffer.from([0x11, 0x11, 0x11, 0x11]),
      Buffer.from([0x22, 0x22, 0x22, 0x22]),
      Buffer.from([0x33, 0x33, 0x33, 0x33]),
    );
    mockClassGet.mockResolvedValueOnce(needsSetupSnapshot());
    primeCollidingJoinCode();
    primeCollidingJoinCode();
    primeUniqueJoinCode();
    const tx = makeTx([() => needsSetupSnapshot()]);
    primeTransaction(tx);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-r", record: {} });

    const result = await __classesActivateHandler(makeRequest());

    expect(mockCollectionGet).toHaveBeenCalledTimes(3);
    expect(result.joinCode).toBe("33333333");
    expect(tx.update).toHaveBeenCalledTimes(1);
    const write = tx.update.mock.calls[0]![1];
    expect(write.joinCode).toBe("33333333");
  });

  it("fails with joinCodeGenerationFailed if all candidates collide (no class mutation)", async () => {
    mockClassGet.mockResolvedValueOnce(needsSetupSnapshot());
    // Prime 5 collisions -> exhausted.
    for (let i = 0; i < 5; i += 1) primeCollidingJoinCode();

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.joinCodeGenerationFailed" });
    expect(mockRunFirestoreTransaction).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("returns idempotent success when a concurrent write already activated the class matching the request", async () => {
    randomBytesSequence.push(Buffer.from([0xab, 0xcd, 0xef, 0x12]));
    mockClassGet.mockResolvedValueOnce(needsSetupSnapshot());
    primeUniqueJoinCode();
    // Transaction re-read: class is now active with same grade+block.
    const tx = makeTx([() => activeSnapshot({ joinCode: "OTHER123" })]);
    primeTransaction(tx);

    const result = await __classesActivateHandler(makeRequest());

    expect(tx.update).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      classId: CLASS_ID,
      status: "active",
      joinCode: "OTHER123",
      alreadyActive: true,
    });
  });

  it("propagates classes.alreadyActiveConflict from inside the transaction", async () => {
    randomBytesSequence.push(Buffer.from([0xab, 0xcd, 0xef, 0x12]));
    mockClassGet.mockResolvedValueOnce(needsSetupSnapshot());
    primeUniqueJoinCode();
    const tx = makeTx([() => activeSnapshot({ grade: "6" })]);
    primeTransaction(tx);

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.alreadyActiveConflict" });
    expect(tx.update).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects if the class was archived between pre-check and transaction", async () => {
    randomBytesSequence.push(Buffer.from([0xab, 0xcd, 0xef, 0x12]));
    mockClassGet.mockResolvedValueOnce(needsSetupSnapshot());
    primeUniqueJoinCode();
    const tx = makeTx([() => archivedSnapshot()]);
    primeTransaction(tx);

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.notActivatable" });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("rejects a malformed needsSetup record (missing owner) safely inside the transaction", async () => {
    randomBytesSequence.push(Buffer.from([0xab, 0xcd, 0xef, 0x12]));
    mockClassGet.mockResolvedValueOnce(needsSetupSnapshot());
    primeUniqueJoinCode();
    const tx = makeTx([
      () => ({
        exists: true,
        data: () => ({
          teacherId: "someone-else",
          schoolId: "school-a",
          title: "Some Course",
          status: "needsSetup",
          createdAt: {} as never,
        }),
      }),
    ]);
    primeTransaction(tx);

    await expect(
      __classesActivateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("orders side effects: transaction commit, then audit event", async () => {
    const calls: string[] = [];
    randomBytesSequence.push(Buffer.from([0xab, 0xcd, 0xef, 0x12]));
    mockClassGet.mockResolvedValueOnce(needsSetupSnapshot());
    primeUniqueJoinCode();
    const tx = makeTx([() => needsSetupSnapshot()]);
    mockRunFirestoreTransaction.mockImplementationOnce(async (fn: (t: FakeTx) => Promise<unknown>) => {
      const r = await fn(tx);
      calls.push("commit");
      return r;
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __classesActivateHandler(makeRequest());
    expect(calls).toEqual(["commit", "audit"]);
  });

  // Sprint 24B Phase 2B.7. LMS-sourced classes must never receive a
  // joinCode from the activation transaction. The activation write
  // omits the field entirely; the response returns joinCode: null; the
  // shared join-code allocator is not invoked (proven by the absence of
  // any mockCollectionGet call, which is what allocateJoinCode uses).
  it("activates an LMS-sourced needsSetup class without a joinCode and without invoking the allocator", async () => {
    mockClassGet.mockResolvedValueOnce(needsSetupLmsSnapshot());
    const tx = makeTx([() => needsSetupLmsSnapshot()]);
    primeTransaction(tx);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-lms", record: {} });

    const result = await __classesActivateHandler(makeRequest());

    expect(mockClassActivationDocRef).toHaveBeenCalledWith(CLASS_ID);
    expect(tx.update).toHaveBeenCalledTimes(1);
    const [, write] = tx.update.mock.calls[0]!;
    expect(write).toEqual({
      status: "active",
      grade: "7",
      block: "C",
    });
    expect(write).not.toHaveProperty("joinCode");

    // Allocator did not run: no query against the classes collection.
    expect(mockCollectionGet).not.toHaveBeenCalled();
    // randomBytes was never called either (allocateJoinCode's only source).
    expect(randomBytesCalls).toHaveLength(0);

    // Audit event still fires exactly once with the canonical payload.
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "classes.activated",
      targetType: "class",
      targetId: CLASS_ID,
      schoolId: "school-a",
      districtId: "district-1",
      payload: {
        previousStatus: "needsSetup",
        grade: "7",
        block: "C",
      },
    });

    expect(result).toEqual({
      classId: CLASS_ID,
      status: "active",
      joinCode: null,
      alreadyActive: false,
    });
  });

  // Sprint 24B Phase 2B.7. LMS-sourced idempotent replay returns
  // joinCode: null and touches no transaction and no audit writer.
  it("is idempotent on an already-active LMS class with matching grade and block and returns joinCode: null", async () => {
    mockClassGet.mockResolvedValueOnce(activeLmsSnapshot());

    const result = await __classesActivateHandler(makeRequest());

    expect(result).toEqual({
      classId: CLASS_ID,
      status: "active",
      joinCode: null,
      alreadyActive: true,
    });
    expect(mockRunFirestoreTransaction).not.toHaveBeenCalled();
    expect(mockCollectionGet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("does not touch the teacher preferences document", async () => {
    // The shared-module jest.mock in this file does NOT expose
    // teacherPreferencesUpdateDocRef. If the handler reached for it, the
    // module import would fail. The successful test setup below implicitly
    // confirms the preference update is never invoked.
    randomBytesSequence.push(Buffer.from([0xab, 0xcd, 0xef, 0x12]));
    mockClassGet.mockResolvedValueOnce(needsSetupSnapshot());
    primeUniqueJoinCode();
    const tx = makeTx([() => needsSetupSnapshot()]);
    primeTransaction(tx);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-x", record: {} });

    await expect(__classesActivateHandler(makeRequest())).resolves.toBeDefined();
  });
});
