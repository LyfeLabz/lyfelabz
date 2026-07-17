import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));

const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));

const mockEnrollmentGet = jest.fn();
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));

const mockRecipientGet = jest.fn();
const mockRecipientDocRef = jest.fn(() => ({ get: mockRecipientGet }));

const mockRecipientSet = jest.fn();
const mockRecipientCreationDocRef = jest.fn(() => ({ set: mockRecipientSet }));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = { __sentinel: "serverTimestamp" } as const;

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
    assignmentDocRef: mockAssignmentDocRef,
    classDocRef: mockClassDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    assignmentRecipientDocRef: mockRecipientDocRef,
    assignmentRecipientCreationDocRef: mockRecipientCreationDocRef,
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsRecipientAddHandler } from "./assignments-recipient-add";

const TEACHER_UID = "teacher-uid";
const OTHER_TEACHER_UID = "other-teacher-uid";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-1";
const OTHER_DISTRICT_ID = "district-2";
const ASSIGNMENT_ID = "assign-1";
const CLASS_ID = "class-abc";
const STUDENT_ID = "student-1";

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
      ? { assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID }
      : overrides.data;
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
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
      lessonSlug: "lesson_g7_earths-layers",
      lessonVersion: "1",
      mode: "classroom",
      status: "published",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

function classSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      title: "G7 Core Science",
      grade: "7",
      block: "A",
      joinCode: "XYZ123",
      status: "active",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

function enrollmentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      status: "active",
      enrolledAt: {} as never,
      ...overrides,
    }),
  };
}

function recipientNotFound() {
  return { exists: false, data: () => undefined };
}

function recipientExists(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      assignedBy: TEACHER_UID,
      source: "classPublication",
      status: "assigned",
      assignedAt: {} as never,
      ...overrides,
    }),
  };
}

describe("assignmentsRecipientAdd", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockAssignmentDocRef.mockClear();
    mockClassGet.mockReset();
    mockClassDocRef.mockClear();
    mockEnrollmentGet.mockReset();
    mockEnrollmentDocRef.mockClear();
    mockRecipientGet.mockReset();
    mockRecipientDocRef.mockClear();
    mockRecipientSet.mockReset();
    mockRecipientCreationDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  describe("positive path", () => {
    it("adds a manual recipient for an active-enrolled student and emits one audit event", async () => {
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
      mockClassGet.mockResolvedValueOnce(classSnapshot());
      mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
      mockRecipientGet.mockResolvedValueOnce(recipientNotFound());
      mockRecipientSet.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e1", record: {} });

      const result = await __assignmentsRecipientAddHandler(makeRequest());

      expect(mockRecipientCreationDocRef).toHaveBeenCalledWith(
        ASSIGNMENT_ID,
        STUDENT_ID,
      );
      expect(mockRecipientSet).toHaveBeenCalledWith({
        assignmentId: ASSIGNMENT_ID,
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        assignedAt: SERVER_TIMESTAMP_SENTINEL,
        assignedBy: TEACHER_UID,
        source: "manualAddition",
        status: "assigned",
      });
      expect(mockWriteAuditEvent).toHaveBeenCalledWith({
        actorUserId: TEACHER_UID,
        actorRole: "teacher",
        action: "assignments.recipientAdded",
        targetType: "assignmentRecipient",
        targetId: `${ASSIGNMENT_ID}/${STUDENT_ID}`,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        payload: {
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_ID,
          classId: CLASS_ID,
          source: "manualAddition",
        },
      });
      expect(result).toEqual({
        assignmentId: ASSIGNMENT_ID,
        studentId: STUDENT_ID,
        added: true,
      });
    });

    it("is idempotent when the recipient already exists and does not overwrite it or re-audit", async () => {
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
      mockClassGet.mockResolvedValueOnce(classSnapshot());
      mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
      mockRecipientGet.mockResolvedValueOnce(recipientExists());

      const result = await __assignmentsRecipientAddHandler(makeRequest());

      expect(result).toEqual({
        assignmentId: ASSIGNMENT_ID,
        studentId: STUDENT_ID,
        added: false,
      });
      expect(mockRecipientSet).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe("authentication and role", () => {
    it("propagates unauthenticated", async () => {
      mockRequireDistrictContext.mockReset();
      mockRequireDistrictContext.mockRejectedValueOnce(
        new PlatformError("unauthenticated", "no auth"),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "unauthenticated" });
      expect(mockAssignmentDocRef).not.toHaveBeenCalled();
    });

    it("rejects a student caller with role-forbidden", async () => {
      mockRequireDistrictContext.mockReset();
      mockRequireDistrictContext.mockResolvedValueOnce({
        uid: "student-uid",
        role: "student",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "role-forbidden" });
    });

    it("rejects a platformAdministrator caller with role-forbidden", async () => {
      mockRequireDistrictContext.mockReset();
      mockRequireDistrictContext.mockResolvedValueOnce({
        uid: "admin-uid",
        role: "platformAdministrator",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "role-forbidden" });
    });

    it("propagates account-inactive", async () => {
      mockRequireDistrictContext.mockReset();
      mockRequireDistrictContext.mockRejectedValueOnce(
        new PlatformError("account-inactive", "not active"),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "account-inactive" });
    });
  });

  describe("input validation", () => {
    it("rejects a null or non-object body", async () => {
      await expect(
        __assignmentsRecipientAddHandler(makeRequest({ data: null })),
      ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
      await expect(
        __assignmentsRecipientAddHandler(makeRequest({ data: "nope" })),
      ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
      await expect(
        __assignmentsRecipientAddHandler(makeRequest({ data: [] })),
      ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
    });

    it("rejects missing, blank, or non-string assignmentId", async () => {
      await expect(
        __assignmentsRecipientAddHandler(
          makeRequest({ data: { studentId: STUDENT_ID } }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
      await expect(
        __assignmentsRecipientAddHandler(
          makeRequest({ data: { assignmentId: "   ", studentId: STUDENT_ID } }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
      await expect(
        __assignmentsRecipientAddHandler(
          makeRequest({ data: { assignmentId: 42, studentId: STUDENT_ID } }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
      await expect(
        __assignmentsRecipientAddHandler(
          makeRequest({
            data: { assignmentId: "bad/id", studentId: STUDENT_ID },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
    });

    it("rejects missing, blank, or non-string studentId", async () => {
      await expect(
        __assignmentsRecipientAddHandler(
          makeRequest({ data: { assignmentId: ASSIGNMENT_ID } }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidStudentId" });
      await expect(
        __assignmentsRecipientAddHandler(
          makeRequest({
            data: { assignmentId: ASSIGNMENT_ID, studentId: "  " },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidStudentId" });
      await expect(
        __assignmentsRecipientAddHandler(
          makeRequest({
            data: { assignmentId: ASSIGNMENT_ID, studentId: 42 },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidStudentId" });
      await expect(
        __assignmentsRecipientAddHandler(
          makeRequest({
            data: { assignmentId: ASSIGNMENT_ID, studentId: "bad/id" },
          }),
        ),
      ).rejects.toMatchObject({ code: "assignments.invalidStudentId" });
    });

    const forbiddenFields = [
      "classId",
      "teacherId",
      "schoolId",
      "districtId",
      "source",
      "status",
      "assignedAt",
      "assignedBy",
      "lmsCourseId",
      "lmsCourseworkId",
      "lmsPublicationRef",
      "windowClosesAt",
      "availableAt",
      "mode",
    ];
    it.each(forbiddenFields)(
      "rejects request with forbidden field %s",
      async (field) => {
        await expect(
          __assignmentsRecipientAddHandler(
            makeRequest({
              data: {
                assignmentId: ASSIGNMENT_ID,
                studentId: STUDENT_ID,
                [field]: "anything",
              },
            }),
          ),
        ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
      },
    );
  });

  describe("assignment authorization and lifecycle", () => {
    it("rejects a missing assignment", async () => {
      mockAssignmentGet.mockResolvedValueOnce(recipientNotFound());
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.notFound" });
    });

    it("rejects a non-owning teacher", async () => {
      mockAssignmentGet.mockResolvedValueOnce(
        assignmentSnapshot({ teacherId: OTHER_TEACHER_UID }),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.forbidden" });
    });

    it("rejects a cross-school assignment", async () => {
      mockAssignmentGet.mockResolvedValueOnce(
        assignmentSnapshot({ schoolId: OTHER_SCHOOL_ID }),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.forbidden" });
    });

    it("rejects a cross-district caller via non-matching district context", async () => {
      mockRequireDistrictContext.mockReset();
      mockRequireDistrictContext.mockResolvedValueOnce({
        uid: TEACHER_UID,
        role: "teacher",
        schoolId: OTHER_SCHOOL_ID,
        districtId: OTHER_DISTRICT_ID,
      });
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.forbidden" });
    });

    it("rejects a draft assignment with invalidTransition", async () => {
      mockAssignmentGet.mockResolvedValueOnce(
        assignmentSnapshot({ status: "draft" }),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.invalidTransition" });
      expect(mockClassDocRef).not.toHaveBeenCalled();
    });

    it("rejects a closed assignment with invalidTransition", async () => {
      mockAssignmentGet.mockResolvedValueOnce(
        assignmentSnapshot({ status: "closed" }),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.invalidTransition" });
    });

    it("rejects an archived assignment with invalidTransition", async () => {
      mockAssignmentGet.mockResolvedValueOnce(
        assignmentSnapshot({ status: "archived" }),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.invalidTransition" });
    });

    it("rejects a missing class", async () => {
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
      mockClassGet.mockResolvedValueOnce(recipientNotFound());
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "classes.notFound" });
    });

    it("rejects a class owned by a different teacher", async () => {
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
      mockClassGet.mockResolvedValueOnce(
        classSnapshot({ teacherId: OTHER_TEACHER_UID }),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "classes.forbidden" });
    });

    it("rejects a class in a different school", async () => {
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
      mockClassGet.mockResolvedValueOnce(
        classSnapshot({ schoolId: OTHER_SCHOOL_ID }),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "classes.forbidden" });
    });
  });

  describe("enrollment requirement", () => {
    it("rejects a student with no enrollment record", async () => {
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
      mockClassGet.mockResolvedValueOnce(classSnapshot());
      mockEnrollmentGet.mockResolvedValueOnce(recipientNotFound());
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.recipientEnrollmentMissing" });
    });

    it("rejects an enrollment record whose classId disagrees", async () => {
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
      mockClassGet.mockResolvedValueOnce(classSnapshot());
      mockEnrollmentGet.mockResolvedValueOnce(
        enrollmentSnapshot({ classId: "class-other" }),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.recipientEnrollmentMissing" });
    });

    it("rejects an enrollment record whose schoolId disagrees", async () => {
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
      mockClassGet.mockResolvedValueOnce(classSnapshot());
      mockEnrollmentGet.mockResolvedValueOnce(
        enrollmentSnapshot({ schoolId: OTHER_SCHOOL_ID }),
      );
      await expect(
        __assignmentsRecipientAddHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.recipientEnrollmentMissing" });
    });

    it.each(["transferred", "withdrawn", "archived"] as const)(
      "rejects a non-active enrollment status %s",
      async (status) => {
        mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
        mockClassGet.mockResolvedValueOnce(classSnapshot());
        mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot({ status }));
        await expect(
          __assignmentsRecipientAddHandler(makeRequest()),
        ).rejects.toMatchObject({
          code: "assignments.recipientEnrollmentInactive",
        });
      },
    );
  });
});
