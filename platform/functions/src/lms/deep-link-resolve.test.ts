// Sprint 27 Phase 4 tests for lmsDeepLinkResolve (PDR-027 §10, §17, §24).
//
// All identifiers are fictional. No real teacher, student, school, OAuth
// credential, or LyfeLabz-affiliated identifier is used.

import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockEnrollmentGet = jest.fn();

const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));

const mockRequireDistrictContext = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockIsCanonicalRecipient = jest.fn();

const mockLogInfo = jest.fn();
const mockLogError = jest.fn();

const FIXED_NOW_MS = 1_700_000_000_000;

jest.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    now: () => ({ toMillis: () => FIXED_NOW_MS }),
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
    log: { info: mockLogInfo, warn: jest.fn(), error: mockLogError },
    assignmentDocRef: mockAssignmentDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("../assignments/assignment-recipients", () => ({
  isCanonicalRecipient: mockIsCanonicalRecipient,
}));

jest.mock("../enrollments/enrollments-join-by-code", () => ({
  enrollmentIdFor: (classId: string, studentId: string) =>
    `${classId}__${studentId}`,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __lmsDeepLinkResolveHandler } from "./deep-link-resolve";

const STUDENT_UID = "student-uid-001";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-abc";
const TEACHER_UID = "teacher-uid";
const ASSIGNMENT_ID = "assign-1";
const LESSON_SLUG = "lesson_g7_earths-layers";

const STUDENT_CONTEXT = Object.freeze({
  uid: STUDENT_UID,
  role: "student" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(data: unknown = { assignmentId: ASSIGNMENT_ID }): CallableRequest<unknown> {
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
      mode: "classroom",
      status: "published",
      ...overrides,
    }),
  };
}

const activeEnrollment = {
  exists: true,
  data: () => ({ status: "active", classId: CLASS_ID, studentId: STUDENT_UID }),
};

function setupHappyPath() {
  mockRequireDistrictContext.mockResolvedValue(STUDENT_CONTEXT);
  mockAssignmentGet.mockResolvedValue(assignmentSnapshot());
  mockEnrollmentGet.mockResolvedValue(activeEnrollment);
  mockIsCanonicalRecipient.mockResolvedValue(true);
  mockWriteAuditEvent.mockResolvedValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("lmsDeepLinkResolve - success", () => {
  it("authorizes an enrolled recipient of a published classroom assignment", async () => {
    setupHappyPath();
    const res = await __lmsDeepLinkResolveHandler(makeRequest());
    expect(res).toEqual({
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      internalTarget: "assignmentLaunch",
      attemptContext: "authorized",
    });
  });

  it("emits exactly one lms.deepLinkResolved audit event on success", async () => {
    setupHappyPath();
    await __lmsDeepLinkResolveHandler(makeRequest());
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    const audit = mockWriteAuditEvent.mock.calls[0][0];
    expect(audit.action).toBe("lms.deepLinkResolved");
    expect(audit.actorUserId).toBe(STUDENT_UID);
    expect(audit.targetType).toBe("assignment");
    expect(audit.targetId).toBe(ASSIGNMENT_ID);
    expect(audit.payload).toEqual({
      attemptContext: "authorized",
      internalTarget: "assignmentLaunch",
    });
  });

  it("returns informational for an enrolled non-recipient", async () => {
    setupHappyPath();
    mockIsCanonicalRecipient.mockResolvedValue(false);
    const res = await __lmsDeepLinkResolveHandler(makeRequest());
    expect(res.internalTarget).toBe("informational");
    expect(res.attemptContext).toBe("informational");
  });

  it("returns informational for a closed assignment (never re-checks recipient)", async () => {
    setupHappyPath();
    mockAssignmentGet.mockResolvedValue(assignmentSnapshot({ status: "closed" }));
    const res = await __lmsDeepLinkResolveHandler(makeRequest());
    expect(res.attemptContext).toBe("informational");
    expect(mockIsCanonicalRecipient).not.toHaveBeenCalled();
  });

  it("routes a practice-mode assignment to lessonPractice", async () => {
    setupHappyPath();
    mockAssignmentGet.mockResolvedValue(assignmentSnapshot({ mode: "practice" }));
    const res = await __lmsDeepLinkResolveHandler(makeRequest());
    expect(res.internalTarget).toBe("lessonPractice");
    expect(res.attemptContext).toBe("informational");
    expect(mockIsCanonicalRecipient).not.toHaveBeenCalled();
  });

  it("returns informational when the availability window is not open", async () => {
    setupHappyPath();
    mockAssignmentGet.mockResolvedValue(
      assignmentSnapshot({
        availableAt: { toMillis: () => FIXED_NOW_MS + 60_000 },
      }),
    );
    const res = await __lmsDeepLinkResolveHandler(makeRequest());
    expect(res.attemptContext).toBe("informational");
    expect(mockIsCanonicalRecipient).not.toHaveBeenCalled();
  });

  it("returns informational when the window has already closed", async () => {
    setupHappyPath();
    mockAssignmentGet.mockResolvedValue(
      assignmentSnapshot({
        windowClosesAt: { toMillis: () => FIXED_NOW_MS - 1 },
      }),
    );
    const res = await __lmsDeepLinkResolveHandler(makeRequest());
    expect(res.attemptContext).toBe("informational");
  });
});

describe("lmsDeepLinkResolve - authentication and role", () => {
  it("refuses an unauthenticated caller (propagates requireDistrictContext)", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(__lmsDeepLinkResolveHandler(makeRequest())).rejects.toMatchObject(
      { code: "unauthenticated" },
    );
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a provisioned/inactive caller with account-inactive", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("account-inactive", "inactive"),
    );
    await expect(__lmsDeepLinkResolveHandler(makeRequest())).rejects.toMatchObject(
      { code: "account-inactive" },
    );
  });

  it("refuses a teacher (non-student) with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...STUDENT_CONTEXT,
      role: "teacher",
    });
    await expect(__lmsDeepLinkResolveHandler(makeRequest())).rejects.toMatchObject(
      { code: "role-forbidden" },
    );
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });
});

describe("lmsDeepLinkResolve - assignment authorization", () => {
  it("refuses a nonexistent assignment", async () => {
    setupHappyPath();
    mockAssignmentGet.mockResolvedValue({ exists: false });
    await expect(__lmsDeepLinkResolveHandler(makeRequest())).rejects.toMatchObject(
      { code: "assignment-not-found" },
    );
  });

  it("refuses a cross-school (cross-district) assignment with district-mismatch", async () => {
    setupHappyPath();
    mockAssignmentGet.mockResolvedValue(
      assignmentSnapshot({ schoolId: "school-other" }),
    );
    await expect(__lmsDeepLinkResolveHandler(makeRequest())).rejects.toMatchObject(
      { code: "district-mismatch" },
    );
    // No enrollment or recipient read happens once the boundary fails.
    expect(mockEnrollmentGet).not.toHaveBeenCalled();
  });

  it("refuses a draft assignment with assignment-not-published", async () => {
    setupHappyPath();
    mockAssignmentGet.mockResolvedValue(assignmentSnapshot({ status: "draft" }));
    await expect(__lmsDeepLinkResolveHandler(makeRequest())).rejects.toMatchObject(
      { code: "assignment-not-published" },
    );
  });

  it("refuses an archived assignment with assignment-archived", async () => {
    setupHappyPath();
    mockAssignmentGet.mockResolvedValue(
      assignmentSnapshot({ status: "archived" }),
    );
    await expect(__lmsDeepLinkResolveHandler(makeRequest())).rejects.toMatchObject(
      { code: "assignment-archived" },
    );
  });

  it("refuses when the caller has no enrollment", async () => {
    setupHappyPath();
    mockEnrollmentGet.mockResolvedValue({ exists: false });
    await expect(__lmsDeepLinkResolveHandler(makeRequest())).rejects.toMatchObject(
      { code: "enrollment-inactive" },
    );
    expect(mockIsCanonicalRecipient).not.toHaveBeenCalled();
  });

  it("refuses when the caller's enrollment is inactive", async () => {
    setupHappyPath();
    mockEnrollmentGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: "removed", classId: CLASS_ID }),
    });
    await expect(__lmsDeepLinkResolveHandler(makeRequest())).rejects.toMatchObject(
      { code: "enrollment-inactive" },
    );
  });
});

describe("lmsDeepLinkResolve - request shape", () => {
  it("refuses a malformed assignmentId with deep-link-shape-invalid", async () => {
    mockRequireDistrictContext.mockResolvedValue(STUDENT_CONTEXT);
    await expect(
      __lmsDeepLinkResolveHandler(makeRequest({ assignmentId: "bad/id" })),
    ).rejects.toMatchObject({ code: "deep-link-shape-invalid" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("refuses an empty payload", async () => {
    mockRequireDistrictContext.mockResolvedValue(STUDENT_CONTEXT);
    await expect(
      __lmsDeepLinkResolveHandler(makeRequest({})),
    ).rejects.toMatchObject({ code: "deep-link-shape-invalid" });
  });

  it("refuses a payload that asserts an authority field", async () => {
    mockRequireDistrictContext.mockResolvedValue(STUDENT_CONTEXT);
    for (const key of ["studentId", "schoolId", "districtId", "classId"]) {
      await expect(
        __lmsDeepLinkResolveHandler(
          makeRequest({ assignmentId: ASSIGNMENT_ID, [key]: "x" }),
        ),
      ).rejects.toMatchObject({ code: "deep-link-shape-invalid" });
    }
  });
});

describe("lmsDeepLinkResolve - frozen recipients (PDR-029l)", () => {
  it("URL possession + enrollment alone never authorizes a non-recipient", async () => {
    setupHappyPath();
    mockIsCanonicalRecipient.mockResolvedValue(false);
    const res = await __lmsDeepLinkResolveHandler(makeRequest());
    expect(res.attemptContext).toBe("informational");
    expect(res.internalTarget).toBe("informational");
  });

  it("passes the caller-scoped enforcement context to the recipient check", async () => {
    setupHappyPath();
    await __lmsDeepLinkResolveHandler(makeRequest());
    const ctx = mockIsCanonicalRecipient.mock.calls[0][0];
    expect(ctx).toEqual({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
  });
});

describe("lmsDeepLinkResolve - privacy and read-only", () => {
  it("returns only the five minimal fields (no recipient, roster, or provider data)", async () => {
    setupHappyPath();
    const res = await __lmsDeepLinkResolveHandler(makeRequest());
    expect(Object.keys(res).sort()).toEqual(
      [
        "assignmentId",
        "attemptContext",
        "classId",
        "internalTarget",
        "lessonSlug",
      ].sort(),
    );
    expect("teacherId" in res).toBe(false);
    expect(JSON.stringify(res)).not.toContain(TEACHER_UID);
  });

  it("does not emit an audit event on any refusal", async () => {
    setupHappyPath();
    mockAssignmentGet.mockResolvedValue(assignmentSnapshot({ status: "draft" }));
    await expect(
      __lmsDeepLinkResolveHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("still resolves when the best-effort audit write fails", async () => {
    setupHappyPath();
    mockWriteAuditEvent.mockRejectedValue(new Error("audit sink down"));
    const res = await __lmsDeepLinkResolveHandler(makeRequest());
    expect(res.attemptContext).toBe("authorized");
    expect(mockLogError).toHaveBeenCalled();
  });
});
