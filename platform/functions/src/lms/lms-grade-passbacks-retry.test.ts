import type { CallableRequest } from "firebase-functions/v2/https";

const mockRequireDistrictContext = jest.fn();
const mockAssignmentGet = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockWriteAuditEvent = jest.fn();
const mockSynchronizeGradePassback = jest.fn();

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  return {
    platformCallable: (optionsOrHandler: unknown, maybeHandler?: unknown) =>
      typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler,
    PlatformError,
    requireDistrictContext: mockRequireDistrictContext,
    assignmentDocRef: mockAssignmentDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("./grade-passback/engine", () => ({
  synchronizeGradePassback: (...args: unknown[]) => mockSynchronizeGradePassback(...args),
}));

jest.mock("./providers/google-classroom/config-firebase", () => ({
  googleClassroomProductionSecrets: [],
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __lmsGradePassbacksRetryHandler } from "./lms-grade-passbacks-retry";

const TEACHER_CONTEXT = Object.freeze({
  uid: "teacher-uid",
  role: "teacher" as const,
  schoolId: "school-a",
  districtId: "district-1",
});

const ASSIGNMENT_ID = "assign-1";
const STUDENT_ID = "student-1";

function makeRequest(data: unknown): CallableRequest<unknown> {
  return { data, auth: { uid: "teacher-uid", token: {} } as never, rawRequest: {} as never };
}

function gradedAssignmentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: "teacher-uid",
      schoolId: "school-a",
      classroomGrading: { mode: "graded", maxPoints: 20 },
      ...overrides,
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireDistrictContext.mockResolvedValue(TEACHER_CONTEXT);
  mockAssignmentGet.mockResolvedValue(gradedAssignmentSnapshot());
  mockWriteAuditEvent.mockResolvedValue({ eventId: "evt-1" });
  mockSynchronizeGradePassback.mockResolvedValue({ outcome: "synced", earnedPoints: 18 });
});

describe("lmsGradePassbacksRetry", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireDistrictContext.mockRejectedValueOnce(new PlatformError("unauthenticated", "no auth"));
    await expect(
      __lmsGradePassbacksRetryHandler(makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID })),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("rejects a student caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValueOnce({ ...TEACHER_CONTEXT, role: "student" });
    await expect(
      __lmsGradePassbacksRetryHandler(makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID })),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("rejects a non-existent assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce({ exists: false, data: () => undefined });
    await expect(
      __lmsGradePassbacksRetryHandler(makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID })),
    ).rejects.toMatchObject({ code: "gradePassback.forbidden" });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("rejects a teacher who does not own the assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(gradedAssignmentSnapshot({ teacherId: "someone-else" }));
    await expect(
      __lmsGradePassbacksRetryHandler(makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID })),
    ).rejects.toMatchObject({ code: "gradePassback.forbidden" });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("rejects a cross-school assignment even if the caller's uid happens to match", async () => {
    mockAssignmentGet.mockResolvedValueOnce(gradedAssignmentSnapshot({ schoolId: "other-school" }));
    await expect(
      __lmsGradePassbacksRetryHandler(makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID })),
    ).rejects.toMatchObject({ code: "gradePassback.forbidden" });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("rejects an ungraded assignment before ever invoking the synchronizer", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      gradedAssignmentSnapshot({ classroomGrading: { mode: "ungraded" } }),
    );
    await expect(
      __lmsGradePassbacksRetryHandler(makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID })),
    ).rejects.toMatchObject({ code: "gradePassback.notGraded" });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("rejects a legacy assignment with no classroomGrading at all", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      gradedAssignmentSnapshot({ classroomGrading: undefined }),
    );
    await expect(
      __lmsGradePassbacksRetryHandler(makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID })),
    ).rejects.toMatchObject({ code: "gradePassback.notGraded" });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("rejects a malformed studentId", async () => {
    await expect(
      __lmsGradePassbacksRetryHandler(makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: "" })),
    ).rejects.toMatchObject({ code: "gradePassback.invalidStudentId" });
  });

  it("rejects a non-object payload", async () => {
    await expect(__lmsGradePassbacksRetryHandler(makeRequest("nope"))).rejects.toMatchObject({
      code: "gradePassback.invalidRequest",
    });
  });

  it("never accepts or forwards a client-supplied grade value: only assignmentId and studentId reach the synchronizer", async () => {
    await __lmsGradePassbacksRetryHandler(
      makeRequest({
        assignmentId: ASSIGNMENT_ID,
        studentId: STUDENT_ID,
        earnedPoints: 999,
        forceGrade: 100,
      }),
    );
    expect(mockSynchronizeGradePassback).toHaveBeenCalledTimes(1);
    expect(mockSynchronizeGradePassback).toHaveBeenCalledWith({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      // The teacher's verified district context is passed through to
      // canonical Current resolution (reassignment model).
      districtId: "district-1",
      // Retry is an explicit teacher re-evaluation of fresh Classroom state.
      trigger: "teacher",
    });
  });

  it("recomputes the current best via the exact same synchronizer used by attempt finalization, and maps a successful sync to status synced", async () => {
    mockSynchronizeGradePassback.mockResolvedValueOnce({ outcome: "synced", earnedPoints: 18 });
    const res = await __lmsGradePassbacksRetryHandler(
      makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID }),
    );
    expect(res).toMatchObject({ ok: true, status: "synced" });
  });

  it("maps a recovered failed sync to status synced (retry recovers a failed pending sync)", async () => {
    mockSynchronizeGradePassback.mockResolvedValueOnce({ outcome: "synced", earnedPoints: 20 });
    const res = await __lmsGradePassbacksRetryHandler(
      makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID }),
    );
    expect(res).toMatchObject({ ok: true, status: "synced" });
  });

  it("maps a failed outcome to status failed without throwing", async () => {
    mockSynchronizeGradePassback.mockResolvedValueOnce({
      outcome: "failed",
      errorCode: "lms.upstreamTemporarilyUnavailable",
    });
    const res = await __lmsGradePassbacksRetryHandler(
      makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID }),
    );
    expect(res).toMatchObject({ ok: true, status: "failed" });
  });

  it("maps noAttempts and deferred to status pending (not a failure)", async () => {
    mockSynchronizeGradePassback.mockResolvedValueOnce({ outcome: "noAttempts" });
    const r1 = await __lmsGradePassbacksRetryHandler(
      makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID }),
    );
    expect(r1).toMatchObject({ ok: true, status: "pending" });

    mockSynchronizeGradePassback.mockResolvedValueOnce({ outcome: "deferred" });
    const r2 = await __lmsGradePassbacksRetryHandler(
      makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID }),
    );
    expect(r2).toMatchObject({ ok: true, status: "pending" });
  });

  it("maps alreadySynced to status synced", async () => {
    mockSynchronizeGradePassback.mockResolvedValueOnce({ outcome: "alreadySynced" });
    const res = await __lmsGradePassbacksRetryHandler(
      makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID }),
    );
    expect(res).toMatchObject({ ok: true, status: "synced" });
  });

  it.each([
    [{ outcome: "synced", earnedPoints: 18, action: "wouldReplaceMissingDraftZero" }, "synced", { outcome: "synced", action: "wouldReplaceMissingDraftZero" }],
    [{ outcome: "noChange", action: "alreadyEqual" }, "synced", { outcome: "noChange", action: "alreadyEqual" }],
    [{ outcome: "noChange", action: "preservedClassroomHigher" }, "synced", { outcome: "noChange", action: "preservedClassroomHigher" }],
    [{ outcome: "protected", action: "protectedAssignedZero" }, "notApplicable", { outcome: "protected", action: "protectedAssignedZero" }],
    [{ outcome: "outsideRoster" }, "notApplicable", { outcome: "outsideRoster" }],
    [{ outcome: "destinationUnavailable", status: "courseworkDeleted" }, "failed", { outcome: "destinationUnavailable", reason: "courseworkDeleted" }],
    [{ outcome: "destinationChanged" }, "failed", { outcome: "destinationChanged" }],
    [{ outcome: "failed", errorCode: "lms.upstreamCallFailed" }, "failed", { outcome: "failed", reason: "lms.upstreamCallFailed" }],
  ])("maps engine %j to status %s with an accurate detail", async (engineResult, status, detail) => {
    mockSynchronizeGradePassback.mockResolvedValueOnce(engineResult);
    const res = await __lmsGradePassbacksRetryHandler(
      makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID }),
    );
    expect(res).toEqual({ ok: true, status, detail });
    // The response never carries a grade value.
    expect(JSON.stringify(res)).not.toMatch(/earnedPoints|18/);
  });

  it("writes exactly one lms.gradePassbackRetryRequested audit event, scoped to the caller's own school/district", async () => {
    await __lmsGradePassbacksRetryHandler(
      makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID }),
    );
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "lms.gradePassbackRetryRequested",
      targetType: "assignment",
      targetId: ASSIGNMENT_ID,
      schoolId: "school-a",
      districtId: "district-1",
      payload: { studentId: STUDENT_ID },
    });
  });

  it("still returns a bounded result even when the audit write fails", async () => {
    mockWriteAuditEvent.mockRejectedValueOnce(new Error("audit down"));
    const res = await __lmsGradePassbacksRetryHandler(
      makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID }),
    );
    expect(res).toMatchObject({ ok: true, status: "synced" });
  });
});
