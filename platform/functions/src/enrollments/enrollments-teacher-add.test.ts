import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));

const mockUserGet = jest.fn();
const mockUserRecordDocRef = jest.fn(() => ({ get: mockUserGet }));

const mockEnrollmentGet = jest.fn();
const mockEnrollmentSet = jest.fn();
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));
const mockEnrollmentCreationDocRef = jest.fn(() => ({
  set: mockEnrollmentSet,
}));

const mockWriteAuditEvent = jest.fn();

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
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    classDocRef: mockClassDocRef,
    userRecordDocRef: mockUserRecordDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    enrollmentCreationDocRef: mockEnrollmentCreationDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { __enrollmentsTeacherAddHandler } from "./enrollments-teacher-add";

const TEACHER_UID = "teacher-uid";
const CLASS_ID = "class-abc";
const STUDENT_UID = "student-uid";
const SCHOOL_ID = "school-a";
const EXPECTED_ID = `${CLASS_ID}__${STUDENT_UID}`;

const VALID_DATA = { classId: CLASS_ID, studentId: STUDENT_UID };

function makeRequest(
  overrides: {
    uid?: string;
    data?: unknown;
    hasAuth?: boolean;
    token?: Record<string, unknown> | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? TEACHER_UID;
  const data =
    overrides.data === undefined ? { ...VALID_DATA } : overrides.data;
  const token =
    overrides.token === undefined
      ? { role: "teacher", schoolId: SCHOOL_ID }
      : overrides.token;
  return {
    data,
    auth: hasAuth
      ? ({ uid, token: token ?? undefined } as never)
      : undefined,
    rawRequest: {} as never,
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

function studentSnapshot(
  overrides: {
    exists?: boolean;
    role?: string;
    status?: string;
    schoolId?: string;
  } = {},
) {
  const exists = overrides.exists ?? true;
  return {
    exists,
    data: () =>
      exists
        ? {
            authUid: STUDENT_UID,
            role: overrides.role ?? "student",
            schoolId: overrides.schoolId ?? SCHOOL_ID,
            status: overrides.status ?? "active",
            displayName: "S",
            createdAt: {} as never,
          }
        : undefined,
  };
}

function absentEnrollmentSnapshot() {
  return { exists: false, data: () => undefined };
}

function existingEnrollmentSnapshot(
  overrides: {
    status?: "active" | "transferred" | "withdrawn" | "archived";
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      studentId: STUDENT_UID,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      status: overrides.status ?? "active",
      enrolledAt: {} as never,
    }),
  };
}

describe("enrollmentsTeacherAdd", () => {
  beforeEach(() => {
    mockClassGet.mockReset();
    mockClassDocRef.mockClear();
    mockUserGet.mockReset();
    mockUserRecordDocRef.mockClear();
    mockEnrollmentGet.mockReset();
    mockEnrollmentSet.mockReset();
    mockEnrollmentDocRef.mockClear();
    mockEnrollmentCreationDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("creates the canonical enrollment document and returns the canonical response", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockUserGet.mockResolvedValueOnce(studentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(absentEnrollmentSnapshot());
    mockEnrollmentSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __enrollmentsTeacherAddHandler(makeRequest());

    expect(mockClassDocRef).toHaveBeenCalledWith(CLASS_ID);
    expect(mockUserRecordDocRef).toHaveBeenCalledWith(STUDENT_UID);
    expect(mockEnrollmentDocRef).toHaveBeenCalledWith(EXPECTED_ID);
    expect(mockEnrollmentCreationDocRef).toHaveBeenCalledWith(EXPECTED_ID);
    expect(mockEnrollmentSet).toHaveBeenCalledWith({
      studentId: STUDENT_UID,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      status: "active",
      enrolledAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(result).toEqual({
      enrollmentId: EXPECTED_ID,
      classId: CLASS_ID,
      studentId: STUDENT_UID,
      alreadyEnrolled: false,
    });
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      __enrollmentsTeacherAddHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "enrollments.unauthenticated" });
    expect(mockClassDocRef).not.toHaveBeenCalled();
  });

  it("rejects non-teacher callers with enrollments.unauthorized", async () => {
    await expect(
      __enrollmentsTeacherAddHandler(
        makeRequest({ token: { role: "student", schoolId: SCHOOL_ID } }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.unauthorized" });
    await expect(
      __enrollmentsTeacherAddHandler(
        makeRequest({ token: { role: "teacher" } }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.unauthorized" });
  });

  it("rejects invalid payloads", async () => {
    await expect(
      __enrollmentsTeacherAddHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "enrollments.invalidRequest" });
    await expect(
      __enrollmentsTeacherAddHandler(
        makeRequest({ data: { classId: "", studentId: STUDENT_UID } }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.invalidClassId" });
    await expect(
      __enrollmentsTeacherAddHandler(
        makeRequest({ data: { classId: CLASS_ID, studentId: "" } }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.invalidStudentId" });
    expect(mockClassDocRef).not.toHaveBeenCalled();
  });

  it("rejects when the class is not found", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot({ exists: false }));

    await expect(
      __enrollmentsTeacherAddHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.classNotFound" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
  });

  it("rejects when the caller is not the owning teacher (cross-teacher)", async () => {
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ teacherId: "other-teacher" }),
    );

    await expect(
      __enrollmentsTeacherAddHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.forbidden" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a cross-school teacher-add attempt", async () => {
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ schoolId: "school-b" }),
    );

    await expect(
      __enrollmentsTeacherAddHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.forbidden" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
  });

  it("rejects an add against an archived class with enrollments.invalidClassStatus", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot({ status: "archived" }));

    await expect(
      __enrollmentsTeacherAddHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.invalidClassStatus" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
  });

  it("rejects when the target student user is not found", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockUserGet.mockResolvedValueOnce(studentSnapshot({ exists: false }));

    await expect(
      __enrollmentsTeacherAddHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.studentNotFound" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
  });

  it("rejects when the target user is not a student role", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockUserGet.mockResolvedValueOnce(studentSnapshot({ role: "teacher" }));

    await expect(
      __enrollmentsTeacherAddHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.invalidTargetRole" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
  });

  it("rejects when the target student belongs to a different school", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockUserGet.mockResolvedValueOnce(studentSnapshot({ schoolId: "school-b" }));

    await expect(
      __enrollmentsTeacherAddHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.forbidden" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
  });

  it("rejects when the target student is not active", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockUserGet.mockResolvedValueOnce(studentSnapshot({ status: "provisioned" }));

    await expect(
      __enrollmentsTeacherAddHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.invalidTargetStatus" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
  });

  it("is idempotent when an active enrollment already exists", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockUserGet.mockResolvedValueOnce(studentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(existingEnrollmentSnapshot());

    const result = await __enrollmentsTeacherAddHandler(makeRequest());

    expect(result).toEqual({
      enrollmentId: EXPECTED_ID,
      classId: CLASS_ID,
      studentId: STUDENT_UID,
      alreadyEnrolled: true,
    });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a duplicate enrollment in a terminal status with enrollments.conflict", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockUserGet.mockResolvedValueOnce(studentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(
      existingEnrollmentSnapshot({ status: "withdrawn" }),
    );

    await expect(
      __enrollmentsTeacherAddHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.conflict" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
  });

  it("invokes the canonical audit helper with enrollments.created and teacherAdd source", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockUserGet.mockResolvedValueOnce(studentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(absentEnrollmentSnapshot());
    mockEnrollmentSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __enrollmentsTeacherAddHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: TEACHER_UID,
      actorRole: "teacher",
      action: "enrollments.created",
      targetType: "enrollment",
      targetId: EXPECTED_ID,
      schoolId: SCHOOL_ID,
      payload: {
        classId: CLASS_ID,
        studentId: STUDENT_UID,
        source: "teacherAdd",
      },
    });
  });
});
