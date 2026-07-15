import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentUpdate = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentPublishDocRef = jest.fn(() => ({
  update: mockAssignmentUpdate,
}));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

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
    assignmentPublishDocRef: mockAssignmentPublishDocRef,
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsPublishHandler } from "./assignments-publish";

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
      lessonVersion: "1",
      mode: "classroom",
      status: "draft",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

describe("assignmentsPublish", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockAssignmentUpdate.mockReset();
    mockAssignmentDocRef.mockClear();
    mockAssignmentPublishDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("advances draft to published and emits a single audit event", async () => {
    mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
    mockAssignmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __assignmentsPublishHandler(makeRequest());

    expect(mockRequireDistrictContext).toHaveBeenCalledTimes(1);
    expect(mockAssignmentUpdate).toHaveBeenCalledWith({ status: "published" });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: TEACHER_UID,
      actorRole: "teacher",
      action: "assignments.published",
      targetType: "assignment",
      targetId: ASSIGNMENT_ID,
      schoolId: SCHOOL_ID,
      payload: {
        classId: "class-abc",
        lessonSlug: "lesson_g7_earths-layers",
        lessonVersion: "1",
      },
    });
    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      status: "published",
      alreadyPublished: false,
    });
  });

  it("is idempotent for an already-published assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "published" }),
    );

    const result = await __assignmentsPublishHandler(makeRequest());

    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      status: "published",
      alreadyPublished: true,
    });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a publish from closed or archived with invalidTransition", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "closed" }),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidTransition" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "archived" }),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidTransition" });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
  });

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "not active"),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical claim-stale district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("claim-stale", "stale claim"),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-stale" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical school-district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("school-district-mismatch", "mismatch"),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "school-district-mismatch" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-unassigned district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-unassigned", "no district"),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });
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
      __assignmentsPublishHandler(makeRequest()),
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
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  it("rejects cross-teacher and cross-school owners", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ teacherId: "someone-else" }),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("rejects an invalid assignmentId payload", async () => {
    await expect(
      __assignmentsPublishHandler(
        makeRequest({ data: { assignmentId: "bad/id" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
    await expect(
      __assignmentsPublishHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
  });

  it("rejects a not-found assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.notFound" });
  });

  it("orders side effects: publish write, then audit", async () => {
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

    await __assignmentsPublishHandler(makeRequest());

    expect(calls).toEqual(["update", "audit"]);
  });
});
