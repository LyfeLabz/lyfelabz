import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));

const mockEnrollmentGet = jest.fn();
const mockEnrollmentUpdate = jest.fn();
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));
const mockEnrollmentStatusChangeDocRef = jest.fn(() => ({
  update: mockEnrollmentUpdate,
}));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
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
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    classDocRef: mockClassDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    enrollmentStatusChangeDocRef: mockEnrollmentStatusChangeDocRef,
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __enrollmentsSetStatusHandler } from "./enrollments-set-status";

const TEACHER_UID = "teacher-uid";
const CLASS_ID = "class-abc";
const STUDENT_UID = "student-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const ENROLLMENT_ID = `${CLASS_ID}__${STUDENT_UID}`;

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
      ? { enrollmentId: ENROLLMENT_ID, status: "withdrawn" }
      : overrides.data;
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function enrollmentSnapshot(
  overrides: {
    exists?: boolean;
    status?: "active" | "transferred" | "withdrawn" | "archived";
    classId?: string;
    schoolId?: string;
  } = {},
) {
  const exists = overrides.exists ?? true;
  return {
    exists,
    data: () =>
      exists
        ? {
            studentId: STUDENT_UID,
            classId: overrides.classId ?? CLASS_ID,
            schoolId: overrides.schoolId ?? SCHOOL_ID,
            status: overrides.status ?? "active",
            enrolledAt: {} as never,
          }
        : undefined,
  };
}

function classSnapshot(
  overrides: {
    exists?: boolean;
    teacherId?: string;
    schoolId?: string;
    status?: "active" | "archived";
  } = {},
) {
  const exists = overrides.exists ?? true;
  return {
    exists,
    data: () =>
      exists
        ? {
            teacherId: overrides.teacherId ?? TEACHER_UID,
            schoolId: overrides.schoolId ?? SCHOOL_ID,
            title: "T",
            grade: "7",
            block: "C",
            joinCode: "ABCD1234",
            status: overrides.status ?? "active",
            createdAt: {} as never,
          }
        : undefined,
  };
}

describe("enrollmentsSetStatus", () => {
  beforeEach(() => {
    mockClassGet.mockReset();
    mockClassDocRef.mockClear();
    mockEnrollmentGet.mockReset();
    mockEnrollmentUpdate.mockReset();
    mockEnrollmentDocRef.mockClear();
    mockEnrollmentStatusChangeDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("advances active -> withdrawn and stamps exitedAt", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockEnrollmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __enrollmentsSetStatusHandler(makeRequest());

    expect(mockRequireDistrictContext).toHaveBeenCalledTimes(1);
    expect(mockEnrollmentStatusChangeDocRef).toHaveBeenCalledWith(ENROLLMENT_ID);
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({
      status: "withdrawn",
      exitedAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(result).toEqual({
      enrollmentId: ENROLLMENT_ID,
      status: "withdrawn",
      alreadyInStatus: false,
    });
  });

  it("advances active -> transferred and stamps exitedAt", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockEnrollmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __enrollmentsSetStatusHandler(
      makeRequest({
        data: { enrollmentId: ENROLLMENT_ID, status: "transferred" },
      }),
    );

    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({
      status: "transferred",
      exitedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("advances active -> archived and stamps exitedAt", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockEnrollmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __enrollmentsSetStatusHandler(
      makeRequest({
        data: { enrollmentId: ENROLLMENT_ID, status: "archived" },
      }),
    );

    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({
      status: "archived",
      exitedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("advances withdrawn -> archived without stamping a new exitedAt", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ status: "withdrawn" }),
    );
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockEnrollmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __enrollmentsSetStatusHandler(
      makeRequest({
        data: { enrollmentId: ENROLLMENT_ID, status: "archived" },
      }),
    );

    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({ status: "archived" });
  });

  it("rejects an invalid transition (archived is terminal)", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ status: "archived" }),
    );
    mockClassGet.mockResolvedValueOnce(classSnapshot());

    await expect(
      __enrollmentsSetStatusHandler(
        makeRequest({
          data: { enrollmentId: ENROLLMENT_ID, status: "active" },
        }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.invalidTransition" });
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects transferred -> withdrawn as invalid", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ status: "transferred" }),
    );
    mockClassGet.mockResolvedValueOnce(classSnapshot());

    await expect(
      __enrollmentsSetStatusHandler(
        makeRequest({
          data: { enrollmentId: ENROLLMENT_ID, status: "withdrawn" },
        }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.invalidTransition" });
  });

  it("is idempotent when status already matches", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ status: "withdrawn" }),
    );
    mockClassGet.mockResolvedValueOnce(classSnapshot());

    const result = await __enrollmentsSetStatusHandler(makeRequest());

    expect(result).toEqual({
      enrollmentId: ENROLLMENT_ID,
      status: "withdrawn",
      alreadyInStatus: true,
    });
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );

    await expect(
      __enrollmentsSetStatusHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockEnrollmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "not active"),
    );

    await expect(
      __enrollmentsSetStatusHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockEnrollmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical claim-stale district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("claim-stale", "stale claim"),
    );

    await expect(
      __enrollmentsSetStatusHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-stale" });
    expect(mockEnrollmentDocRef).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );

    await expect(
      __enrollmentsSetStatusHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
    expect(mockEnrollmentDocRef).not.toHaveBeenCalled();
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
      __enrollmentsSetStatusHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockEnrollmentDocRef).not.toHaveBeenCalled();
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
      __enrollmentsSetStatusHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockEnrollmentDocRef).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads", async () => {
    await expect(
      __enrollmentsSetStatusHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "enrollments.invalidRequest" });
    await expect(
      __enrollmentsSetStatusHandler(
        makeRequest({ data: { enrollmentId: "", status: "withdrawn" } }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.invalidEnrollmentId" });
    await expect(
      __enrollmentsSetStatusHandler(
        makeRequest({ data: { enrollmentId: ENROLLMENT_ID, status: "nope" } }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.invalidStatus" });
  });

  it("rejects when the enrollment is not found", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot({ exists: false }));

    await expect(
      __enrollmentsSetStatusHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.notFound" });
  });

  it("rejects when the referenced class is not found", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockClassGet.mockResolvedValueOnce(classSnapshot({ exists: false }));

    await expect(
      __enrollmentsSetStatusHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.classNotFound" });
  });

  it("rejects a cross-teacher status change", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ teacherId: "someone-else" }),
    );

    await expect(
      __enrollmentsSetStatusHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.forbidden" });
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
  });

  it("rejects a cross-school status change", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ schoolId: "school-b" }),
    );
    mockClassGet.mockResolvedValueOnce(classSnapshot({ schoolId: "school-b" }));

    await expect(
      __enrollmentsSetStatusHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.forbidden" });
  });

  it("invokes the canonical audit helper with enrollments.statusChanged and canonical payload", async () => {
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockEnrollmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __enrollmentsSetStatusHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: TEACHER_UID,
      actorRole: "teacher",
      action: "enrollments.statusChanged",
      targetType: "enrollment",
      targetId: ENROLLMENT_ID,
      schoolId: SCHOOL_ID,
      payload: {
        classId: CLASS_ID,
        studentId: STUDENT_UID,
        previousStatus: "active",
        status: "withdrawn",
      },
    });
  });
});
