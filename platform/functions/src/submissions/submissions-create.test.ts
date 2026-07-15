import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockEnrollmentGet = jest.fn();
const mockSubmissionGet = jest.fn();
const mockSubmissionSet = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));
const mockSubmissionDocRef = jest.fn(() => ({ get: mockSubmissionGet }));
const mockSubmissionCreationDocRef = jest.fn(() => ({
  set: mockSubmissionSet,
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
    assignmentDocRef: mockAssignmentDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    submissionDocRef: mockSubmissionDocRef,
    submissionCreationDocRef: mockSubmissionCreationDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { __submissionsCreateHandler } from "./submissions-create";

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
    overrides.data === undefined ? { assignmentId: ASSIGNMENT_ID } : overrides.data;
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

function assignmentSnapshot(
  overrides: {
    exists?: boolean;
    teacherId?: string;
    schoolId?: string;
    classId?: string;
    mode?: "practice" | "classroom";
    status?: "draft" | "published" | "closed" | "archived";
    lessonSlug?: string;
    lessonVersion?: string;
  } = {},
) {
  const exists = overrides.exists ?? true;
  if (!exists) return { exists: false, data: () => undefined };
  return {
    exists: true,
    data: () => ({
      classId: overrides.classId ?? CLASS_ID,
      teacherId: overrides.teacherId ?? TEACHER_UID,
      schoolId: overrides.schoolId ?? SCHOOL_ID,
      lessonSlug: overrides.lessonSlug ?? "lesson_g7_earths-layers",
      lessonVersion: overrides.lessonVersion ?? "1",
      mode: overrides.mode ?? "classroom",
      status: overrides.status ?? "published",
      createdAt: {} as never,
    }),
  };
}

function enrollmentSnapshot(
  overrides: {
    exists?: boolean;
    status?: "active" | "transferred" | "withdrawn" | "archived";
    classId?: string;
    studentId?: string;
    schoolId?: string;
  } = {},
) {
  const exists = overrides.exists ?? true;
  if (!exists) return { exists: false, data: () => undefined };
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

function absentSubmissionSnapshot() {
  return { exists: false, data: () => undefined };
}

function existingSubmissionSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_UID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: "lesson_g7_earths-layers",
      lessonVersion: "1",
      mode: "classroom",
      status: "submitted",
      startedAt: {} as never,
      responses: [],
      ...overrides,
    }),
  };
}

describe("submissionsCreate", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockEnrollmentGet.mockReset();
    mockSubmissionGet.mockReset();
    mockSubmissionSet.mockReset();
    mockAssignmentDocRef.mockClear();
    mockEnrollmentDocRef.mockClear();
    mockSubmissionDocRef.mockClear();
    mockSubmissionCreationDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("creates a submitted submission and emits a single audit event", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSubmissionGet.mockResolvedValueOnce(absentSubmissionSnapshot());
    mockSubmissionSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __submissionsCreateHandler(makeRequest());

    expect(mockAssignmentDocRef).toHaveBeenCalledWith(ASSIGNMENT_ID);
    expect(mockEnrollmentDocRef).toHaveBeenCalledWith(
      `${CLASS_ID}__${STUDENT_UID}`,
    );
    expect(mockSubmissionDocRef).toHaveBeenCalledWith(SUBMISSION_ID);
    expect(mockSubmissionCreationDocRef).toHaveBeenCalledWith(SUBMISSION_ID);
    expect(mockSubmissionSet).toHaveBeenCalledTimes(1);
    expect(mockSubmissionSet).toHaveBeenCalledWith({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_UID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: "lesson_g7_earths-layers",
      lessonVersion: "1",
      mode: "classroom",
      status: "submitted",
      startedAt: SERVER_TIMESTAMP_SENTINEL,
      responses: [],
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: STUDENT_UID,
      actorRole: "student",
      action: "submissions.created",
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
      alreadyCreated: false,
    });
  });

  it("preserves supplied responses in the write payload", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSubmissionGet.mockResolvedValueOnce(absentSubmissionSnapshot());
    mockSubmissionSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __submissionsCreateHandler(
      makeRequest({
        data: {
          assignmentId: ASSIGNMENT_ID,
          responses: [
            { questionId: "q1", response: "A" },
            { questionId: "q2", response: 3 },
          ],
        },
      }),
    );

    const written = mockSubmissionSet.mock.calls[0][0];
    expect(written.responses).toEqual([
      { questionId: "q1", response: "A" },
      { questionId: "q2", response: 3 },
    ]);
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(
      __submissionsCreateHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "submissions.unauthenticated" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects non-student callers and missing schoolId claim", async () => {
    await expect(
      __submissionsCreateHandler(
        makeRequest({ token: { role: "teacher", schoolId: SCHOOL_ID } }),
      ),
    ).rejects.toMatchObject({ code: "submissions.unauthorized" });
    await expect(
      __submissionsCreateHandler(makeRequest({ token: null })),
    ).rejects.toMatchObject({ code: "submissions.unauthorized" });
    await expect(
      __submissionsCreateHandler(
        makeRequest({ token: { role: "student" } }),
      ),
    ).rejects.toMatchObject({ code: "submissions.unauthorized" });
  });

  it("rejects non-object payloads and invalid assignmentId", async () => {
    await expect(
      __submissionsCreateHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "submissions.invalidRequest" });
    await expect(
      __submissionsCreateHandler(
        makeRequest({ data: { assignmentId: "" } }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidAssignmentId" });
    await expect(
      __submissionsCreateHandler(
        makeRequest({ data: { assignmentId: "bad/id" } }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidAssignmentId" });
  });

  it("rejects malformed responses", async () => {
    await expect(
      __submissionsCreateHandler(
        makeRequest({
          data: { assignmentId: ASSIGNMENT_ID, responses: "nope" },
        }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidResponses" });
    await expect(
      __submissionsCreateHandler(
        makeRequest({
          data: {
            assignmentId: ASSIGNMENT_ID,
            responses: [{ questionId: "", response: "A" }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidResponses" });
    await expect(
      __submissionsCreateHandler(
        makeRequest({
          data: {
            assignmentId: ASSIGNMENT_ID,
            responses: [
              { questionId: "q1", response: "A" },
              { questionId: "q1", response: "B" },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidResponses" });
    await expect(
      __submissionsCreateHandler(
        makeRequest({
          data: {
            assignmentId: ASSIGNMENT_ID,
            responses: [{ questionId: "q1" }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "submissions.invalidResponses" });
  });

  it("rejects a missing assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ exists: false }),
    );
    await expect(
      __submissionsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.assignmentNotFound" });
    expect(mockEnrollmentGet).not.toHaveBeenCalled();
  });

  it("rejects a cross-school assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __submissionsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.forbidden" });
    expect(mockEnrollmentGet).not.toHaveBeenCalled();
  });

  it("rejects a practice-mode assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ mode: "practice" }),
    );
    await expect(
      __submissionsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.invalidAssignmentMode" });
  });

  it("rejects a non-published assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ status: "draft" }),
    );
    await expect(
      __submissionsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.invalidAssignmentStatus" });
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ status: "closed" }),
    );
    await expect(
      __submissionsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.invalidAssignmentStatus" });
  });

  it("rejects a student who is not enrolled in the assignment's class", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ exists: false }),
    );
    await expect(
      __submissionsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.notEnrolled" });
    expect(mockSubmissionGet).not.toHaveBeenCalled();
  });

  it("rejects a student whose enrollment is not active", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ status: "withdrawn" }),
    );
    await expect(
      __submissionsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.notEnrolled" });
  });

  it("is idempotent when the same submitted submission already exists", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSubmissionGet.mockResolvedValueOnce(existingSubmissionSnapshot());

    const result = await __submissionsCreateHandler(makeRequest());

    expect(result).toEqual({
      submissionId: SUBMISSION_ID,
      alreadyCreated: true,
    });
    expect(mockSubmissionSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a duplicate submission that is already finalized", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSubmissionGet.mockResolvedValueOnce(
      existingSubmissionSnapshot({ status: "finalized" }),
    );
    await expect(
      __submissionsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.conflict" });
    expect(mockSubmissionSet).not.toHaveBeenCalled();
  });

  it("rejects a conflict with mismatched canonical fields", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSubmissionGet.mockResolvedValueOnce(
      existingSubmissionSnapshot({ lessonVersion: "2" }),
    );
    await expect(
      __submissionsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "submissions.conflict" });
  });

  it("orders side effects: create write, then audit event", async () => {
    const calls: string[] = [];
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSubmissionGet.mockResolvedValueOnce(absentSubmissionSnapshot());
    mockSubmissionSet.mockImplementationOnce(() => {
      calls.push("set");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __submissionsCreateHandler(makeRequest());

    expect(calls).toEqual(["set", "audit"]);
  });

  it("propagates a downstream write failure without writing audit", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSubmissionGet.mockResolvedValueOnce(absentSubmissionSnapshot());
    const err = new Error("firestore down");
    mockSubmissionSet.mockRejectedValueOnce(err);

    await expect(
      __submissionsCreateHandler(makeRequest()),
    ).rejects.toBe(err);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });
});
