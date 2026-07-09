import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassesQuery = {
  where: jest.fn(),
  limit: jest.fn(),
  get: jest.fn(),
};
mockClassesQuery.where.mockReturnValue(mockClassesQuery);
mockClassesQuery.limit.mockReturnValue(mockClassesQuery);

const mockClassesCollectionRef = jest.fn(() => mockClassesQuery);

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
    classesCollectionRef: mockClassesCollectionRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    enrollmentCreationDocRef: mockEnrollmentCreationDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __enrollmentsJoinByCodeHandler } from "./enrollments-join-by-code";

const JOIN_CODE = "ABCD1234";
const CLASS_ID = "class-abc";
const STUDENT_UID = "student-uid";
const SCHOOL_ID = "school-a";
const EXPECTED_ID = `${CLASS_ID}__${STUDENT_UID}`;

function makeRequest(
  overrides: {
    uid?: string;
    data?: unknown;
    hasAuth?: boolean;
    token?: Record<string, unknown> | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? STUDENT_UID;
  const data =
    overrides.data === undefined ? { joinCode: JOIN_CODE } : overrides.data;
  const token =
    overrides.token === undefined
      ? { role: "student", schoolId: SCHOOL_ID }
      : overrides.token;
  return {
    data,
    auth: hasAuth
      ? ({ uid, token: token ?? undefined } as never)
      : undefined,
    rawRequest: {} as never,
  };
}

function classQuerySnapshot(
  overrides: {
    empty?: boolean;
    classId?: string;
    teacherId?: string;
    schoolId?: string;
    status?: "active" | "archived";
  } = {},
) {
  const empty = overrides.empty ?? false;
  const docs = empty
    ? []
    : [
        {
          id: overrides.classId ?? CLASS_ID,
          data: () => ({
            teacherId: overrides.teacherId ?? "teacher-uid",
            schoolId: overrides.schoolId ?? SCHOOL_ID,
            title: "T",
            grade: "7",
            block: "C",
            joinCode: JOIN_CODE,
            status: overrides.status ?? "active",
            createdAt: {} as never,
          }),
        },
      ];
  return { empty, docs };
}

function absentSnapshot() {
  return { exists: false, data: () => undefined };
}

function existingEnrollmentSnapshot(
  overrides: {
    studentId?: string;
    classId?: string;
    schoolId?: string;
    status?: "active" | "transferred" | "withdrawn" | "archived";
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      studentId: overrides.studentId ?? STUDENT_UID,
      classId: overrides.classId ?? CLASS_ID,
      schoolId: overrides.schoolId ?? SCHOOL_ID,
      status: overrides.status ?? "active",
      enrolledAt: {} as never,
    }),
  };
}

describe("enrollmentsJoinByCode", () => {
  beforeEach(() => {
    mockClassesQuery.where.mockClear();
    mockClassesQuery.limit.mockClear();
    mockClassesQuery.get.mockReset();
    mockClassesQuery.where.mockReturnValue(mockClassesQuery);
    mockClassesQuery.limit.mockReturnValue(mockClassesQuery);
    mockClassesCollectionRef.mockClear();
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
    mockClassesQuery.get.mockResolvedValueOnce(classQuerySnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(absentSnapshot());
    mockEnrollmentSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __enrollmentsJoinByCodeHandler(makeRequest());

    expect(mockClassesCollectionRef).toHaveBeenCalledTimes(1);
    expect(mockClassesQuery.where).toHaveBeenCalledWith(
      "joinCode",
      "==",
      JOIN_CODE,
    );
    expect(mockClassesQuery.where).toHaveBeenCalledWith(
      "schoolId",
      "==",
      SCHOOL_ID,
    );
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
      alreadyEnrolled: false,
    });
  });

  it("preserves displayNameOverride in the canonical write payload", async () => {
    mockClassesQuery.get.mockResolvedValueOnce(classQuerySnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(absentSnapshot());
    mockEnrollmentSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __enrollmentsJoinByCodeHandler(
      makeRequest({
        data: { joinCode: JOIN_CODE, displayNameOverride: "Sam" },
      }),
    );

    expect(mockEnrollmentSet).toHaveBeenCalledWith(
      expect.objectContaining({ displayNameOverride: "Sam" }),
    );
  });

  it("rejects unauthenticated callers with enrollments.unauthenticated", async () => {
    await expect(
      __enrollmentsJoinByCodeHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "enrollments.unauthenticated",
    });
    expect(mockClassesCollectionRef).not.toHaveBeenCalled();
  });

  it("rejects non-student callers with enrollments.unauthorized", async () => {
    await expect(
      __enrollmentsJoinByCodeHandler(
        makeRequest({ token: { role: "teacher", schoolId: SCHOOL_ID } }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.unauthorized" });
    await expect(
      __enrollmentsJoinByCodeHandler(
        makeRequest({ token: { role: "student" } }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.unauthorized" });
    expect(mockClassesCollectionRef).not.toHaveBeenCalled();
  });

  it("rejects an invalid join code with enrollments.invalidJoinCode", async () => {
    await expect(
      __enrollmentsJoinByCodeHandler(makeRequest({ data: { joinCode: "" } })),
    ).rejects.toMatchObject({ code: "enrollments.invalidJoinCode" });
    await expect(
      __enrollmentsJoinByCodeHandler(
        makeRequest({ data: { joinCode: "not-hex!" } }),
      ),
    ).rejects.toMatchObject({ code: "enrollments.invalidJoinCode" });
    expect(mockClassesCollectionRef).not.toHaveBeenCalled();
  });

  it("rejects a non-object request payload with enrollments.invalidRequest", async () => {
    await expect(
      __enrollmentsJoinByCodeHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "enrollments.invalidRequest" });
  });

  it("rejects an unknown join code with enrollments.joinCodeNotFound", async () => {
    mockClassesQuery.get.mockResolvedValueOnce(
      classQuerySnapshot({ empty: true }),
    );

    await expect(
      __enrollmentsJoinByCodeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.joinCodeNotFound" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an archived-class join code with enrollments.joinCodeNotFound", async () => {
    mockClassesQuery.get.mockResolvedValueOnce(
      classQuerySnapshot({ status: "archived" }),
    );

    await expect(
      __enrollmentsJoinByCodeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.joinCodeNotFound" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
  });

  it("is idempotent: an existing active enrollment returns alreadyEnrolled without a second write", async () => {
    mockClassesQuery.get.mockResolvedValueOnce(classQuerySnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(existingEnrollmentSnapshot());

    const result = await __enrollmentsJoinByCodeHandler(makeRequest());

    expect(result).toEqual({
      enrollmentId: EXPECTED_ID,
      classId: CLASS_ID,
      alreadyEnrolled: true,
    });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a duplicate enrollment in a terminal status with enrollments.conflict", async () => {
    mockClassesQuery.get.mockResolvedValueOnce(classQuerySnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(
      existingEnrollmentSnapshot({ status: "withdrawn" }),
    );

    await expect(
      __enrollmentsJoinByCodeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollments.conflict" });
    expect(mockEnrollmentSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("invokes the canonical audit helper with enrollments.created and the canonical target fields", async () => {
    mockClassesQuery.get.mockResolvedValueOnce(classQuerySnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(absentSnapshot());
    mockEnrollmentSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __enrollmentsJoinByCodeHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: STUDENT_UID,
      actorRole: "student",
      action: "enrollments.created",
      targetType: "enrollment",
      targetId: EXPECTED_ID,
      schoolId: SCHOOL_ID,
      payload: { classId: CLASS_ID, source: "joinByCode" },
    });
  });

  it("orders side effects: creation write, then audit event", async () => {
    const calls: string[] = [];
    mockClassesQuery.get.mockResolvedValueOnce(classQuerySnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(absentSnapshot());
    mockEnrollmentSet.mockImplementationOnce(() => {
      calls.push("set");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __enrollmentsJoinByCodeHandler(makeRequest());

    expect(calls).toEqual(["set", "audit"]);
  });

  it("propagates a downstream creation-write failure and does not write audit", async () => {
    mockClassesQuery.get.mockResolvedValueOnce(classQuerySnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(absentSnapshot());
    const setErr = new Error("firestore down");
    mockEnrollmentSet.mockRejectedValueOnce(setErr);

    await expect(
      __enrollmentsJoinByCodeHandler(makeRequest()),
    ).rejects.toBe(setErr);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates a downstream audit helper failure", async () => {
    mockClassesQuery.get.mockResolvedValueOnce(classQuerySnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(absentSnapshot());
    mockEnrollmentSet.mockResolvedValueOnce(undefined);
    const auditErr = new PlatformError(
      "audit.writeFailed",
      "boom",
      new Error("network"),
    );
    mockWriteAuditEvent.mockRejectedValueOnce(auditErr);

    await expect(
      __enrollmentsJoinByCodeHandler(makeRequest()),
    ).rejects.toBe(auditErr);
  });
});
