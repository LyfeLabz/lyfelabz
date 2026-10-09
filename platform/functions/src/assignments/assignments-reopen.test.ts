import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentUpdate = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentReopenDocRef = jest.fn(() => ({
  update: mockAssignmentUpdate,
}));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

// RA-3C: reopen runs in one Firestore transaction. The fake transaction
// routes the read and update through the existing ref mocks, records the
// in-transaction audit event on `mockWriteAuditEvent`, and commits
// (`mockCommit`) only after the transaction function returns.
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
    assignmentReopenDocRef: mockAssignmentReopenDocRef,
    isTransactionContention: jest.requireActual("../shared/firestore/transaction")
      .isTransactionContention,
    requireDistrictContext: mockRequireDistrictContext,
    runFirestoreTransaction: mockRunFirestoreTransaction,
    writeAuditEvent: mockWriteAuditEvent,
    writeAuditEventInTransaction: mockWriteAuditEventInTransaction,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsReopenHandler } from "./assignments-reopen";

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
      status: "closed",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

describe("assignmentsReopen", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockAssignmentUpdate.mockReset();
    mockCommit.mockReset();
    mockRunFirestoreTransaction.mockClear();
    mockWriteAuditEventInTransaction.mockClear();
    mockAssignmentDocRef.mockClear();
    mockAssignmentReopenDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("advances closed to published and emits a single audit event", async () => {
    mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
    mockAssignmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __assignmentsReopenHandler(makeRequest());

    expect(mockRequireDistrictContext).toHaveBeenCalledTimes(1);
    expect(mockAssignmentUpdate).toHaveBeenCalledWith({ status: "published" });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: TEACHER_UID,
      actorRole: "teacher",
      action: "assignments.reopened",
      targetType: "assignment",
      targetId: ASSIGNMENT_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      payload: { classId: "class-abc", previousStatus: "closed" },
    });
    expect(mockRunFirestoreTransaction).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEventInTransaction).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: "assignments.reopened" }),
    );
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      status: "published",
      alreadyPublished: false,
    });
  });

  it("reads the record inside the transaction, not before it", async () => {
    mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
    await __assignmentsReopenHandler(makeRequest());
    expect(mockAssignmentGet).toHaveBeenCalledTimes(1);
    expect(mockRunFirestoreTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockAssignmentGet.mock.invocationCallOrder[0],
    );
  });

  it("refuses an archived record with no write and no audit (archive is terminal)", async () => {
    mockAssignmentGet.mockResolvedValueOnce(existingSnapshot({ status: "archived" }));
    await expect(__assignmentsReopenHandler(makeRequest())).rejects.toMatchObject({
      code: "assignments.invalidTransition",
    });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("re-validates on a transaction retry: a retry that reads archived refuses", async () => {
    mockAssignmentGet
      .mockResolvedValueOnce(existingSnapshot({ status: "closed" }))
      .mockResolvedValueOnce(existingSnapshot({ status: "archived" }));
    // Simulate the SDK re-running the function after losing a commit race.
    mockRunFirestoreTransaction.mockImplementationOnce(async (fn) => {
      await fn(mockTx);
      return fn(mockTx);
    });
    await expect(__assignmentsReopenHandler(makeRequest())).rejects.toMatchObject({
      code: "assignments.invalidTransition",
    });
  });

  it("translates retry exhaustion into assignments.reopenConflict", async () => {
    mockRunFirestoreTransaction.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error("aborted"), { code: 10 })),
    );
    await expect(__assignmentsReopenHandler(makeRequest())).rejects.toMatchObject({
      code: "assignments.reopenConflict",
    });
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it("propagates an audit construction failure without committing", async () => {
    mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
    mockWriteAuditEventInTransaction.mockImplementationOnce(() => {
      throw new PlatformError("audit.invalidSchoolId", "bad");
    });
    await expect(__assignmentsReopenHandler(makeRequest())).rejects.toMatchObject({
      code: "audit.invalidSchoolId",
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("does not translate a non-contention failure into reopenConflict", async () => {
    mockRunFirestoreTransaction.mockImplementationOnce(() =>
      Promise.reject(new Error("deadline exceeded")),
    );
    await expect(__assignmentsReopenHandler(makeRequest())).rejects.toThrow("deadline exceeded");
  });

  it("is idempotent when already published", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "published" }),
    );

    const result = await __assignmentsReopenHandler(makeRequest());

    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      status: "published",
      alreadyPublished: true,
    });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a reopen from draft or archived with invalidTransition", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "draft" }),
    );
    await expect(
      __assignmentsReopenHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidTransition" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "archived" }),
    );
    await expect(
      __assignmentsReopenHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidTransition" });
  });

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __assignmentsReopenHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "not active"),
    );
    await expect(
      __assignmentsReopenHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical claim-stale district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("claim-stale", "stale claim"),
    );
    await expect(
      __assignmentsReopenHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-stale" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );
    await expect(
      __assignmentsReopenHandler(makeRequest()),
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
      __assignmentsReopenHandler(makeRequest()),
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
      __assignmentsReopenHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("rejects cross-teacher and cross-school ownership", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ teacherId: "someone-else" }),
    );
    await expect(
      __assignmentsReopenHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __assignmentsReopenHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("rejects a not-found assignment and an invalid assignmentId", async () => {
    mockAssignmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assignmentsReopenHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.notFound" });

    await expect(
      __assignmentsReopenHandler(
        makeRequest({ data: { assignmentId: "bad/id" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
  });
});
