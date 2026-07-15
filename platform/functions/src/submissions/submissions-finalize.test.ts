import type { CallableRequest } from "firebase-functions/v2/https";

const mockSubmissionGet = jest.fn();
const mockSubmissionUpdate = jest.fn();
const mockEnrollmentGet = jest.fn();
const mockSubmissionDocRef = jest.fn(() => ({ get: mockSubmissionGet }));
const mockSubmissionFinalizationDocRef = jest.fn(() => ({
  update: mockSubmissionUpdate,
}));
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));

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

const mockAssertLegacyEnabled = jest.fn();

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    assertLegacySubmissionsWritesEnabled: mockAssertLegacyEnabled,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    submissionDocRef: mockSubmissionDocRef,
    submissionFinalizationDocRef: mockSubmissionFinalizationDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { __submissionsFinalizeHandler } from "./submissions-finalize";

const ASSIGNMENT_ID = "assign-1";
const STUDENT_UID = "student-uid";
const SCHOOL_ID = "school-a";
const CLASS_ID = "class-abc";
const TEACHER_UID = "teacher-uid";
const SUBMISSION_ID = `${ASSIGNMENT_ID}__${STUDENT_UID}`;

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
    overrides.data === undefined
      ? { submissionId: SUBMISSION_ID }
      : overrides.data;
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

function submissionSnapshot(
  overrides: {
    exists?: boolean;
    studentId?: string;
    schoolId?: string;
    classId?: string;
    status?: "submitted" | "finalized";
  } = {},
) {
  const exists = overrides.exists ?? true;
  if (!exists) return { exists: false, data: () => undefined };
  return {
    exists: true,
    data: () => ({
      assignmentId: ASSIGNMENT_ID,
      studentId: overrides.studentId ?? STUDENT_UID,
      classId: overrides.classId ?? CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: overrides.schoolId ?? SCHOOL_ID,
      lessonSlug: "lesson_g7_earths-layers",
      lessonVersion: "1",
      mode: "classroom",
      status: overrides.status ?? "submitted",
      startedAt: {} as never,
      responses: [],
    }),
  };
}

function enrollmentSnapshot(
  overrides: {
    exists?: boolean;
    status?: "active" | "transferred" | "withdrawn" | "archived";
  } = {},
) {
  const exists = overrides.exists ?? true;
  if (!exists) return { exists: false, data: () => undefined };
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

describe("submissionsFinalize", () => {
  beforeEach(() => {
    mockSubmissionGet.mockReset();
    mockSubmissionUpdate.mockReset();
    mockEnrollmentGet.mockReset();
    mockSubmissionDocRef.mockClear();
    mockSubmissionFinalizationDocRef.mockClear();
    mockEnrollmentDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("finalizes a submitted submission and emits a single audit event", async () => {
    mockSubmissionGet.mockResolvedValueOnce(submissionSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSubmissionUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __submissionsFinalizeHandler(
      makeRequest({
        data: {
          submissionId: SUBMISSION_ID,
          responses: [{ questionId: "q1", response: "A" }],
          score: 8,
          durationMs: 42000,
          attemptCount: 1,
        },
      }),
    );

    expect(mockSubmissionDocRef).toHaveBeenCalledWith(SUBMISSION_ID);
    expect(mockSubmissionFinalizationDocRef).toHaveBeenCalledWith(
      SUBMISSION_ID,
    );
    expect(mockSubmissionUpdate).toHaveBeenCalledTimes(1);
    expect(mockSubmissionUpdate).toHaveBeenCalledWith({
      status: "finalized",
      submittedAt: SERVER_TIMESTAMP_SENTINEL,
      responses: [{ questionId: "q1", response: "A" }],
      score: 8,
      durationMs: 42000,
      attemptCount: 1,
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: STUDENT_UID,
      actorRole: "student",
      action: "submissions.finalized",
      targetType: "submission",
      targetId: SUBMISSION_ID,
      schoolId: SCHOOL_ID,
      payload: {
        assignmentId: ASSIGNMENT_ID,
        classId: CLASS_ID,
        lessonSlug: "lesson_g7_earths-layers",
        lessonVersion: "1",
      },
    });
    expect(result).toEqual({
      submissionId: SUBMISSION_ID,
      status: "finalized",
      alreadyFinalized: false,
    });
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(
      __submissionsFinalizeHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "submissions.unauthenticated" });
    expect(mockSubmissionGet).not.toHaveBeenCalled();
  });

  it("rejects non-student callers and missing schoolId claim", async () => {
    await expect(
      __submissionsFinalizeHandler(
        makeRequest({ token: { role: "teacher", schoolId: SCHOOL_ID } }),
      ),
    ).rejects.toMatchObject({ code: "submissions.unauthorized" });
    await expect(
      __submissionsFinalizeHandler(
        makeRequest({ token: { role: "student" } }),
      ),
    ).rejects.toMatchObject({ code: "submissions.unauthorized" });
  });

  it("rejects invalid payloads", async () => {
    await expect(
      __submissionsFinalizeHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "submissions.invalidRequest" });
    await expect(
      __submissionsFinalizeHandler(
        makeRequest({ data: { submissionId: "" } }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidSubmissionId" });
    await expect(
      __submissionsFinalizeHandler(
        makeRequest({
          data: { submissionId: SUBMISSION_ID, score: -1 },
        }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidScore" });
    await expect(
      __submissionsFinalizeHandler(
        makeRequest({
          data: { submissionId: SUBMISSION_ID, durationMs: "nope" },
        }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidDurationMs" });
    await expect(
      __submissionsFinalizeHandler(
        makeRequest({
          data: { submissionId: SUBMISSION_ID, attemptCount: 1.5 },
        }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidAttemptCount" });
    await expect(
      __submissionsFinalizeHandler(
        makeRequest({
          data: {
            submissionId: SUBMISSION_ID,
            responses: [{ questionId: "q1" }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidResponses" });
  });

  it("rejects a missing submission", async () => {
    mockSubmissionGet.mockResolvedValueOnce(
      submissionSnapshot({ exists: false }),
    );
    await expect(
      __submissionsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.notFound" });
    expect(mockEnrollmentGet).not.toHaveBeenCalled();
  });

  it("rejects a cross-student ownership mismatch", async () => {
    mockSubmissionGet.mockResolvedValueOnce(
      submissionSnapshot({ studentId: "someone-else" }),
    );
    await expect(
      __submissionsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.forbidden" });
    expect(mockSubmissionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a cross-school ownership mismatch", async () => {
    mockSubmissionGet.mockResolvedValueOnce(
      submissionSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __submissionsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.forbidden" });
  });

  it("is idempotent when the submission is already finalized", async () => {
    mockSubmissionGet.mockResolvedValueOnce(
      submissionSnapshot({ status: "finalized" }),
    );
    const result = await __submissionsFinalizeHandler(makeRequest());
    expect(result).toEqual({
      submissionId: SUBMISSION_ID,
      status: "finalized",
      alreadyFinalized: true,
    });
    expect(mockSubmissionUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects when the student is no longer actively enrolled", async () => {
    mockSubmissionGet.mockResolvedValueOnce(submissionSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ status: "withdrawn" }),
    );
    await expect(
      __submissionsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.notEnrolled" });
    expect(mockSubmissionUpdate).not.toHaveBeenCalled();
  });

  it("orders side effects: finalize write, then audit event", async () => {
    const calls: string[] = [];
    mockSubmissionGet.mockResolvedValueOnce(submissionSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSubmissionUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __submissionsFinalizeHandler(makeRequest());

    expect(calls).toEqual(["update", "audit"]);
  });

  it("propagates a downstream write failure without writing audit", async () => {
    mockSubmissionGet.mockResolvedValueOnce(submissionSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    const err = new Error("firestore down");
    mockSubmissionUpdate.mockRejectedValueOnce(err);

    await expect(
      __submissionsFinalizeHandler(makeRequest()),
    ).rejects.toBe(err);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });
});
