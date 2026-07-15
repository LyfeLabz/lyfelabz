import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockEnrollmentGet = jest.fn();
const mockSessionGet = jest.fn();
const mockSessionSet = jest.fn();

const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));
const mockSessionDocRef = jest.fn(() => ({ get: mockSessionGet }));
const mockSessionCreationDocRef = jest.fn(() => ({ set: mockSessionSet }));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

const FIXED_NOW_MS = 1_700_000_000_000;

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
  Timestamp: {
    now: () => ({ toMillis: () => FIXED_NOW_MS }),
    fromMillis: (ms: number) => ({ toMillis: () => ms }),
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
    assignmentDocRef: mockAssignmentDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    assessmentSessionDocRef: mockSessionDocRef,
    assessmentSessionCreationDocRef: mockSessionCreationDocRef,
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import {
  __assessmentSessionsBeginHandler,
  sessionIdFor,
} from "./assessment-sessions-begin";

const STUDENT_UID = "student-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-abc";
const TEACHER_UID = "teacher-uid";
const ASSIGNMENT_ID = "assign-1";
const LESSON_SLUG = "lesson_g7_earths-layers";
const LESSON_VERSION = "1";
const ACTIVITY_ID = LESSON_SLUG;
const ASSESSMENT_ID = `assessment_${LESSON_SLUG}`;
const REVISION_ID = `assessment_${LESSON_SLUG}__r${LESSON_VERSION}`;
const SESSION_ID = `${ASSIGNMENT_ID}__${STUDENT_UID}__1`;

const VALID_DATA = {
  assignmentId: ASSIGNMENT_ID,
};

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: STUDENT_UID,
  role: "student" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(overrides: { data?: unknown } = {}): CallableRequest<unknown> {
  const data = overrides.data === undefined ? { ...VALID_DATA } : overrides.data;
  return {
    data,
    auth: { uid: STUDENT_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function assignmentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: LESSON_SLUG,
      lessonVersion: LESSON_VERSION,
      mode: "classroom",
      status: "published",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

function enrollmentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      studentId: STUDENT_UID,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      status: "active",
      enrolledAt: {} as never,
      ...overrides,
    }),
  };
}

function absentSessionSnapshot() {
  return { exists: false, data: () => undefined };
}

function existingLiveSessionSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      studentId: STUDENT_UID,
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      activityId: ACTIVITY_ID,
      assessmentId: ASSESSMENT_ID,
      assessmentRevisionId: REVISION_ID,
      sessionOrdinal: 1,
      status: "live",
      startedAt: {} as never,
      ...overrides,
    }),
  };
}

describe("assessmentSessionsBegin", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockEnrollmentGet.mockReset();
    mockSessionGet.mockReset();
    mockSessionSet.mockReset();
    mockAssignmentDocRef.mockClear();
    mockEnrollmentDocRef.mockClear();
    mockSessionDocRef.mockClear();
    mockSessionCreationDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("returns the deterministic first-session identifier", () => {
    expect(sessionIdFor(ASSIGNMENT_ID, STUDENT_UID)).toBe(SESSION_ID);
    expect(sessionIdFor(ASSIGNMENT_ID, STUDENT_UID, 3)).toBe(
      `${ASSIGNMENT_ID}__${STUDENT_UID}__3`,
    );
  });

  it("creates a canonical Live session and emits a single audit event", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockSessionSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __assessmentSessionsBeginHandler(makeRequest());

    expect(mockRequireDistrictContext).toHaveBeenCalledTimes(1);
    expect(mockAssignmentDocRef).toHaveBeenCalledWith(ASSIGNMENT_ID);
    expect(mockEnrollmentDocRef).toHaveBeenCalledWith(`${CLASS_ID}__${STUDENT_UID}`);
    expect(mockSessionDocRef).toHaveBeenCalledWith(SESSION_ID);
    expect(mockSessionCreationDocRef).toHaveBeenCalledWith(SESSION_ID);
    expect(mockSessionSet).toHaveBeenCalledTimes(1);
    expect(mockSessionSet).toHaveBeenCalledWith({
      studentId: STUDENT_UID,
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      activityId: ACTIVITY_ID,
      assessmentId: ASSESSMENT_ID,
      assessmentRevisionId: REVISION_ID,
      sessionOrdinal: 1,
      status: "live",
      startedAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: STUDENT_UID,
      actorRole: "student",
      action: "assessment.sessionBegan",
      targetType: "assessmentSession",
      targetId: SESSION_ID,
      schoolId: SCHOOL_ID,
      payload: {
        assignmentId: ASSIGNMENT_ID,
        classId: CLASS_ID,
        activityId: ACTIVITY_ID,
        assessmentId: ASSESSMENT_ID,
        assessmentRevisionId: REVISION_ID,
        sessionOrdinal: 1,
        districtId: DISTRICT_ID,
      },
    });
    expect(result).toEqual({ sessionId: SESSION_ID, alreadyLive: false });
  });

  it("returns the existing Live session idempotently without a second write", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(existingLiveSessionSnapshot());

    const result = await __assessmentSessionsBeginHandler(makeRequest());

    expect(result).toEqual({ sessionId: SESSION_ID, alreadyLive: true });
    expect(mockSessionSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a second Live session with mismatched canonical fields", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(
      existingLiveSessionSnapshot({ classId: "other-class" }),
    );

    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.conflict" });
    expect(mockSessionSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses when an archived session already occupies the ordinal", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(
      existingLiveSessionSnapshot({ status: "archived" }),
    );

    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.conflict" });
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "inactive"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical claim-stale district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("claim-stale", "stale"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-stale" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical school-district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("school-district-mismatch", "mismatch"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "school-district-mismatch" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-unassigned district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-unassigned", "no district"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("rejects a non-student active caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "teacher-uid",
      role: "teacher",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it("rejects a request whose payload is not a structured object", async () => {
    await expect(
      __assessmentSessionsBeginHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidRequest" });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest({ data: "not-an-object" })),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidRequest" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed assignmentId", async () => {
    await expect(
      __assessmentSessionsBeginHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidAssignmentId" });
    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({ data: { assignmentId: "" } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidAssignmentId" });
    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({ data: { assignmentId: "not a url safe token!" } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidAssignmentId" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("rejects a missing assignment record", async () => {
    mockAssignmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignment-not-found" });
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it("rejects a cross-school assignment target", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ schoolId: "other-school" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.forbidden" });
    expect(mockEnrollmentGet).not.toHaveBeenCalled();
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it("rejects a practice-mode assignment target", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ mode: "practice" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({
      code: "assignment-mode-invalid",
    });
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it("rejects a non-published assignment target with certified refusals", async () => {
    // Sprint 11C Remediation Slice 1 (C-2). `closed` maps to the
    // canonical `assignment-window-closed`; `draft` and `archived` map
    // to the canonical `assignment-not-published` per
    // ASSESSMENT_IMPLEMENTATION_CONTRACT.md §25.
    const cases: ReadonlyArray<{
      status: "draft" | "closed" | "archived";
      code: string;
    }> = [
      { status: "draft", code: "assignment-not-published" },
      { status: "closed", code: "assignment-window-closed" },
      { status: "archived", code: "assignment-not-published" },
    ];
    for (const { status, code } of cases) {
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot({ status }));
      await expect(
        __assessmentSessionsBeginHandler(makeRequest()),
      ).rejects.toMatchObject({ code });
    }
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it("rejects a caller without an active enrollment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it("rejects a caller whose enrollment is not active", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ status: "removed" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it("does not emit an audit event when the session write fails", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockSessionSet.mockRejectedValueOnce(new Error("write failed"));
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toThrow("write failed");
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  // -------- Sprint 11C Remediation Slice 1 - Critical Finding C-2 --------

  it("C-2: refuses when the assignment window has not yet opened", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({
        availableAt: { toMillis: () => FIXED_NOW_MS + 60_000 },
      }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignment-window-closed" });
    expect(mockEnrollmentGet).not.toHaveBeenCalled();
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it("C-2: refuses when the assignment window has already closed", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({
        windowClosesAt: { toMillis: () => FIXED_NOW_MS - 60_000 },
      }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignment-window-closed" });
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it("C-2: refuses when the caller is not enrolled at all with enrollment-inactive", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
  });
});
