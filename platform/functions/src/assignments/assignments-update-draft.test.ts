import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentUpdate = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentDraftUpdateDocRef = jest.fn(() => ({
  update: mockAssignmentUpdate,
}));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

// RA-3B: the read, checks, and narrow update run in one Firestore
// transaction. The fake transaction routes reads and updates through the
// existing ref mocks so every assertion below keeps its meaning.
const mockTx = {
  get: (ref: { get: () => unknown }) => ref.get(),
  update: (ref: { update: (w: unknown) => unknown }, write: unknown) => {
    ref.update(write);
  },
};
const mockRunFirestoreTransaction = jest.fn(
  async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
);

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

class FakeTimestamp {
  constructor(readonly millis: number) {}
  toMillis(): number {
    return this.millis;
  }
}

jest.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    fromMillis: (millis: number) => new FakeTimestamp(millis),
  },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    ...jest.requireActual("../shared/activity-identifiers"),
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    assignmentDocRef: mockAssignmentDocRef,
    assignmentDraftUpdateDocRef: mockAssignmentDraftUpdateDocRef,
    isTransactionContention: jest.requireActual("../shared/firestore/transaction")
      .isTransactionContention,
    requireDistrictContext: mockRequireDistrictContext,
    runFirestoreTransaction: mockRunFirestoreTransaction,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsUpdateDraftHandler } from "./assignments-update-draft";

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
      ? { assignmentId: ASSIGNMENT_ID, title: "New Title" }
      : overrides.data;
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function existingAssignmentSnapshot(
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
      title: "Original Title",
      ...overrides,
    }),
  };
}

describe("assignmentsUpdateDraft", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockAssignmentUpdate.mockReset();
    mockRunFirestoreTransaction.mockClear();
    mockAssignmentDocRef.mockClear();
    mockAssignmentDraftUpdateDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("updates only the changed fields and emits a single audit event", async () => {
    mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
    mockAssignmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __assignmentsUpdateDraftHandler(
      makeRequest({
        data: {
          assignmentId: ASSIGNMENT_ID,
          title: "New Title",
          instructions: "Read carefully.",
        },
      }),
    );

    expect(mockAssignmentUpdate).toHaveBeenCalledWith({
      title: "New Title",
      instructions: "Read carefully.",
    });
    expect(mockRequireDistrictContext).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: TEACHER_UID,
      actorRole: "teacher",
      action: "assignments.updated",
      targetType: "assignment",
      targetId: ASSIGNMENT_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      payload: { changedFields: ["title", "instructions"] },
    });
    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      alreadyUpdated: false,
    });
  });

  it("is idempotent when nothing changes", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ title: "New Title" }),
    );

    const result = await __assignmentsUpdateDraftHandler(makeRequest());

    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      alreadyUpdated: true,
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
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "not active"),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical claim-stale district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("claim-stale", "stale claim"),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-stale" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
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
      __assignmentsUpdateDraftHandler(makeRequest()),
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
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("rejects a payload with no metadata fields", async () => {
    await expect(
      __assignmentsUpdateDraftHandler(
        makeRequest({ data: { assignmentId: ASSIGNMENT_ID } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("rejects a cross-teacher update with assignments.forbidden", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ teacherId: "someone-else" }),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
  });

  it("rejects a cross-school update with assignments.forbidden", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("rejects an update against a non-draft assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ status: "published" }),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidStatus" });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
  });

  it("rejects a not-found assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.notFound" });
  });

  it("rejects invalid timestamps", async () => {
    await expect(
      __assignmentsUpdateDraftHandler(
        makeRequest({
          data: {
            assignmentId: ASSIGNMENT_ID,
            windowClosesAt: "not-a-date",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidWindowClosesAt" });
  });

  it("rejects an update against a closed assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ status: "closed" }),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidStatus" });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  describe("Sprint 30A.1: classroomGrading validation and freeze", () => {
    it("accepts graded with a positive integer maxPoints and writes it verbatim", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
      mockAssignmentUpdate.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

      await __assignmentsUpdateDraftHandler(
        makeRequest({
          data: {
            assignmentId: ASSIGNMENT_ID,
            classroomGrading: { mode: "graded", maxPoints: 20 },
          },
        }),
      );

      expect(mockAssignmentUpdate).toHaveBeenCalledWith({
        classroomGrading: { mode: "graded", maxPoints: 20 },
      });
    });

    it("accepts ungraded without maxPoints and writes it verbatim", async () => {
      mockAssignmentGet.mockResolvedValueOnce(
        existingAssignmentSnapshot({
          classroomGrading: { mode: "graded", maxPoints: 20 },
        }),
      );
      mockAssignmentUpdate.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

      await __assignmentsUpdateDraftHandler(
        makeRequest({
          data: {
            assignmentId: ASSIGNMENT_ID,
            classroomGrading: { mode: "ungraded" },
          },
        }),
      );

      expect(mockAssignmentUpdate).toHaveBeenCalledWith({
        classroomGrading: { mode: "ungraded" },
      });
    });

    it("is idempotent when the submitted classroomGrading already matches", async () => {
      mockAssignmentGet.mockResolvedValueOnce(
        existingAssignmentSnapshot({
          classroomGrading: { mode: "graded", maxPoints: 20 },
        }),
      );

      const result = await __assignmentsUpdateDraftHandler(
        makeRequest({
          data: {
            assignmentId: ASSIGNMENT_ID,
            classroomGrading: { mode: "graded", maxPoints: 20 },
          },
        }),
      );

      expect(result.alreadyUpdated).toBe(true);
      expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    });

    it("rejects graded with maxPoints 0", async () => {
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({
            data: {
              assignmentId: ASSIGNMENT_ID,
              classroomGrading: { mode: "graded", maxPoints: 0 },
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidClassroomGrading" });
    });

    it("rejects graded with a negative maxPoints", async () => {
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({
            data: {
              assignmentId: ASSIGNMENT_ID,
              classroomGrading: { mode: "graded", maxPoints: -5 },
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidClassroomGrading" });
    });

    it("rejects graded with a fractional maxPoints", async () => {
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({
            data: {
              assignmentId: ASSIGNMENT_ID,
              classroomGrading: { mode: "graded", maxPoints: 2.5 },
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidClassroomGrading" });
    });

    it("rejects graded with a missing maxPoints", async () => {
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({
            data: {
              assignmentId: ASSIGNMENT_ID,
              classroomGrading: { mode: "graded" },
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidClassroomGrading" });
    });

    it("rejects ungraded carrying a maxPoints", async () => {
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({
            data: {
              assignmentId: ASSIGNMENT_ID,
              classroomGrading: { mode: "ungraded", maxPoints: 10 },
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidClassroomGrading" });
    });

    it("rejects an unrecognized classroomGrading key", async () => {
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({
            data: {
              assignmentId: ASSIGNMENT_ID,
              classroomGrading: { mode: "graded", maxPoints: 10, extra: true },
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidClassroomGrading" });
    });

    // Phase 6 freeze invariant: classroomGrading is writable only through
    // this callable, and only while the record is still `draft`. Once
    // status has advanced past `draft` (which always happens before any
    // Classroom coursework can exist for the assignment - see
    // lms/assignments-publish.ts), the existing status gate below already
    // refuses every field on this write shape, classroomGrading included.
    // No new mechanism was added for this: the pre-existing
    // `assignments.invalidStatus` gate is the freeze enforcement.
    it("refuses to change classroomGrading once the assignment is no longer draft (freeze after publication)", async () => {
      mockAssignmentGet.mockResolvedValueOnce(
        existingAssignmentSnapshot({
          status: "published",
          classroomGrading: { mode: "graded", maxPoints: 20 },
        }),
      );
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({
            data: {
              assignmentId: ASSIGNMENT_ID,
              classroomGrading: { mode: "graded", maxPoints: 999 },
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidStatus" });
      expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    });
  });

  it("rejects an update against an archived assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ status: "archived" }),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidStatus" });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("ignores immutable fields injected on the payload and only writes the whitelisted metadata", async () => {
    mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
    mockAssignmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __assignmentsUpdateDraftHandler(
      makeRequest({
        data: {
          assignmentId: ASSIGNMENT_ID,
          title: "New Title",
          teacherId: "someone-else",
          schoolId: "school-b",
          districtId: "district-2",
          classId: "class-xyz",
          status: "published",
          createdAt: "2026-07-17T00:00:00.000Z",
          recipients: ["student-1"],
          attempts: 99,
        },
      }),
    );

    expect(mockAssignmentUpdate).toHaveBeenCalledTimes(1);
    expect(mockAssignmentUpdate).toHaveBeenCalledWith({ title: "New Title" });
    const writePayload = mockAssignmentUpdate.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    for (const field of [
      "teacherId",
      "schoolId",
      "districtId",
      "classId",
      "status",
      "createdAt",
      "recipients",
      "attempts",
    ]) {
      expect(writePayload).not.toHaveProperty(field);
    }
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { changedFields: ["title"] },
      }),
    );
  });

  it("orders side effects: update, then audit", async () => {
    const calls: string[] = [];
    mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
    mockAssignmentUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __assignmentsUpdateDraftHandler(makeRequest());

    expect(calls).toEqual(["update", "audit"]);
  });

  describe("resourceType (Resource Expansion Phase 1)", () => {
    it("a lesson slug edit on a lesson record (no resourceType) is unchanged", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
      mockAssignmentUpdate.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

      await __assignmentsUpdateDraftHandler(
        makeRequest({ data: { assignmentId: ASSIGNMENT_ID, lessonSlug: "gravity", resourceType: "lesson" } }),
      );

      expect(mockAssignmentUpdate).toHaveBeenCalledWith({ lessonSlug: "gravity" });
    });

    it("refuses a lesson record's slug moving to a resource identifier", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({ data: { assignmentId: ASSIGNMENT_ID, lessonSlug: "simulation-gravity-wells" } }),
        ),
      ).rejects.toMatchObject({ code: "assignments.resourceTypeMismatch" });
      expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    });

    it("refuses a resourceType that differs from the record's (fixed at creation)", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({ data: { assignmentId: ASSIGNMENT_ID, title: "T", resourceType: "simulation" } }),
        ),
      ).rejects.toMatchObject({ code: "assignments.resourceTypeMismatch" });
      expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    });

    it("rejects an unsupported resourceType before any read", async () => {
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({ data: { assignmentId: ASSIGNMENT_ID, title: "T", resourceType: "game" } }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidResourceType" });
      expect(mockAssignmentGet).not.toHaveBeenCalled();
    });

    it("resourceType alone is not an update field", async () => {
      await expect(
        __assignmentsUpdateDraftHandler(
          makeRequest({ data: { assignmentId: ASSIGNMENT_ID, resourceType: "lesson" } }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
    });

    it("never writes resourceType through the draft-update path", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
      mockAssignmentUpdate.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });
      await __assignmentsUpdateDraftHandler(
        makeRequest({ data: { assignmentId: ASSIGNMENT_ID, title: "T", resourceType: "lesson" } }),
      );
      expect(mockAssignmentUpdate).toHaveBeenCalledWith({ title: "T" });
    });
  });
  // RA-3B publication concurrency: an update can never land on a record
  // that publication moved out of `draft` after the update first read it.
  describe("publication concurrency (RA-3B)", () => {
    it("a retried attempt that observes a concurrent publication refuses and writes nothing", async () => {
      mockAssignmentGet
        .mockResolvedValueOnce(existingAssignmentSnapshot())
        .mockResolvedValueOnce(existingAssignmentSnapshot({ status: "published" }));
      mockRunFirestoreTransaction.mockImplementationOnce(async (fn) => {
        await fn(mockTx); // attempt 1 loses its commit to the publication
        mockAssignmentUpdate.mockClear();
        return fn(mockTx); // attempt 2 re-reads the published record
      });

      await expect(__assignmentsUpdateDraftHandler(makeRequest())).rejects.toMatchObject({
        code: "assignments.invalidStatus",
      });
      expect(mockAssignmentUpdate).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    });

    it("refuses with the stable updateConflict when contention outlasts retries", async () => {
      mockRunFirestoreTransaction.mockRejectedValueOnce(
        Object.assign(new Error("10 ABORTED: contention"), { code: 10 }),
      );
      await expect(__assignmentsUpdateDraftHandler(makeRequest())).rejects.toMatchObject({
        code: "assignments.updateConflict",
      });
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    });

    it("reads and writes inside one transaction", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });
      await __assignmentsUpdateDraftHandler(makeRequest());
      expect(mockRunFirestoreTransaction).toHaveBeenCalledTimes(1);
      expect(mockAssignmentUpdate).toHaveBeenCalledWith({ title: "New Title" });
    });
  });
});
