import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentUpdate = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentDraftUpdateDocRef = jest.fn(() => ({
  update: mockAssignmentUpdate,
}));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

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
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    assignmentDocRef: mockAssignmentDocRef,
    assignmentDraftUpdateDocRef: mockAssignmentDraftUpdateDocRef,
    requireDistrictContext: mockRequireDistrictContext,
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
      lessonVersion: "1",
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
});
