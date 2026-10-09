import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentUpdate = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentArchiveDocRef = jest.fn(() => ({
  update: mockAssignmentUpdate,
}));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

// RA-3B certification: archive runs in one Firestore transaction. The fake
// transaction routes the read and update through the existing ref mocks,
// records the in-transaction audit event on `mockWriteAuditEvent`, and
// commits (`mockCommit`) only after the transaction function returns.
const mockCommit = jest.fn();
const mockTx = {
  get: (ref: { get: () => unknown }) => ref.get(),
  update: (ref: { update: (w: unknown) => unknown }, write: unknown) => {
    ref.update(write);
  },
};
const mockRunFirestoreTransaction = jest.fn(
  async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
    const result = await fn(mockTx);
    await mockCommit();
    return result;
  },
);
const mockWriteAuditEventInTransaction = jest.fn((_tx: unknown, input: unknown) => {
  void mockWriteAuditEvent(input);
  return { eventId: "evt-tx", record: {} };
});

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

jest.mock("firebase-admin/firestore", () => ({}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    assignmentDocRef: mockAssignmentDocRef,
    assignmentArchiveDocRef: mockAssignmentArchiveDocRef,
    isTransactionContention: jest.requireActual("../shared/firestore/transaction")
      .isTransactionContention,
    requireDistrictContext: mockRequireDistrictContext,
    runFirestoreTransaction: mockRunFirestoreTransaction,
    writeAuditEvent: mockWriteAuditEvent,
    writeAuditEventInTransaction: mockWriteAuditEventInTransaction,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsArchiveHandler } from "./assignments-archive";

const TEACHER_UID = "teacher-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const ASSIGNMENT_ID = "assign-1";

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  overrides: {
    data?: unknown;
  } = {},
): CallableRequest<unknown> {
  const data =
    overrides.data === undefined
      ? { assignmentId: ASSIGNMENT_ID }
      : overrides.data;
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function existingSnapshot(
  overrides: Record<string, unknown> = {},
) {
  return {
    exists: true,
    data: () => ({
      classId: "class-abc",
      teacherId: "teacher-uid",
      schoolId: "school-a",
      lessonSlug: "lesson_g7_earths-layers",
      mode: "classroom",
      status: "draft",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

describe("assignmentsArchive", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockAssignmentUpdate.mockReset();
    mockCommit.mockReset();
    mockRunFirestoreTransaction.mockClear();
    mockWriteAuditEventInTransaction.mockClear();
    mockAssignmentDocRef.mockClear();
    mockAssignmentArchiveDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it.each(["draft", "published", "closed"] as const)(
    "archives an assignment currently in %s and emits a single audit event",
    async (fromStatus) => {
      mockAssignmentGet.mockResolvedValueOnce(
        existingSnapshot({ status: fromStatus }),
      );
      mockAssignmentUpdate.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({
        eventId: "evt-1",
        record: {},
      });

      const result = await __assignmentsArchiveHandler(makeRequest());

      expect(mockAssignmentUpdate).toHaveBeenCalledWith({ status: "archived" });
      expect(mockWriteAuditEvent).toHaveBeenCalledWith({
        actorUserId: TEACHER_UID,
        actorRole: "teacher",
        action: "assignments.archived",
        targetType: "assignment",
        targetId: ASSIGNMENT_ID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        payload: { classId: "class-abc", previousStatus: fromStatus },
      });
      expect(result).toEqual({
        assignmentId: ASSIGNMENT_ID,
        status: "archived",
        alreadyArchived: false,
      });
    },
  );

  it("is idempotent when already archived", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "archived" }),
    );

    const result = await __assignmentsArchiveHandler(makeRequest());

    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      status: "archived",
      alreadyArchived: true,
    });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "not active"),
    );
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical claim-stale district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("claim-stale", "stale claim"),
    );
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-stale" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("rejects a non-teacher active caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "student-uid",
      role: "student",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("rejects a platformAdministrator active caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "admin-uid",
      role: "platformAdministrator",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("rejects cross-teacher and cross-school owners with forbidden", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ teacherId: "someone-else" }),
    );
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
  });

  it("rejects a not-found assignment and an invalid assignmentId", async () => {
    mockAssignmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.notFound" });

    await expect(
      __assignmentsArchiveHandler(
        makeRequest({ data: { assignmentId: "bad/id" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
  });

  it("orders side effects: archive write, then audit event, both before the one commit", async () => {
    const calls: string[] = [];
    mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
    mockAssignmentUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });
    mockCommit.mockImplementationOnce(() => {
      calls.push("commit");
      return Promise.resolve();
    });

    await __assignmentsArchiveHandler(makeRequest());

    expect(calls).toEqual(["update", "audit", "commit"]);
    expect(mockRunFirestoreTransaction).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEventInTransaction).toHaveBeenCalledWith(mockTx, expect.anything());
  });

  // RA-3B certification correction: lifecycle read, transition, and audit
  // are one transaction.
  describe("transactional archive (RA-3B certification)", () => {
    it("takes previousStatus from the snapshot of the attempt that commits", async () => {
      // Attempt 1 reads draft and loses its commit to a publication; the
      // retried attempt reads published.
      mockAssignmentGet
        .mockResolvedValueOnce(existingSnapshot({ status: "draft" }))
        .mockResolvedValueOnce(existingSnapshot({ status: "published" }));
      mockRunFirestoreTransaction.mockImplementationOnce(async (fn) => {
        await fn(mockTx); // attempt 1: commit lost
        mockAssignmentUpdate.mockClear();
        mockWriteAuditEvent.mockClear();
        const result = await fn(mockTx); // attempt 2
        await mockCommit();
        return result;
      });

      await expect(__assignmentsArchiveHandler(makeRequest())).resolves.toEqual({
        assignmentId: ASSIGNMENT_ID,
        status: "archived",
        alreadyArchived: false,
      });
      expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
      expect(mockWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { classId: "class-abc", previousStatus: "published" } }),
      );
    });

    it("a retried attempt that observes a concurrent archive is idempotent and writes nothing", async () => {
      mockAssignmentGet
        .mockResolvedValueOnce(existingSnapshot({ status: "published" }))
        .mockResolvedValueOnce(existingSnapshot({ status: "archived" }));
      mockRunFirestoreTransaction.mockImplementationOnce(async (fn) => {
        await fn(mockTx);
        mockAssignmentUpdate.mockClear();
        mockWriteAuditEvent.mockClear();
        return fn(mockTx);
      });

      await expect(__assignmentsArchiveHandler(makeRequest())).resolves.toMatchObject({ alreadyArchived: true });
      expect(mockAssignmentUpdate).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    });

    it("refuses with the stable archiveConflict when contention outlasts retries", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockCommit.mockRejectedValueOnce(Object.assign(new Error("10 ABORTED: contention"), { code: 10 }));
      await expect(__assignmentsArchiveHandler(makeRequest())).rejects.toMatchObject({
        code: "assignments.archiveConflict",
      });
    });

    it("an audit write failure aborts the transaction before commit", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockWriteAuditEventInTransaction.mockImplementationOnce(() => {
        throw new PlatformError("audit.invalidActorUserId", "bad audit");
      });
      await expect(__assignmentsArchiveHandler(makeRequest())).rejects.toMatchObject({
        code: "audit.invalidActorUserId",
      });
      // The staged update belonged to the transaction that never committed.
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("a refused caller never writes inside the transaction", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot({ teacherId: "other" }));
      await expect(__assignmentsArchiveHandler(makeRequest())).rejects.toMatchObject({ code: "assignments.forbidden" });
      expect(mockAssignmentUpdate).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    });
  });
});
