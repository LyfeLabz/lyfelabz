import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));

const mockPublishRefSentinel = { __kind: "publishRef" };
const mockAssignmentPublishDocRef = jest.fn(() => mockPublishRefSentinel);

const mockRecipientRefFactory = jest.fn(
  (assignmentId: string, studentId: string) => ({
    __kind: "recipientRef",
    assignmentId,
    studentId,
  }),
);
const mockAssignmentRecipientCreationDocRef = jest.fn(mockRecipientRefFactory);

const mockEnrollmentsGet = jest.fn();
const mockEnrollmentsWhere = jest.fn(() => ({ get: mockEnrollmentsGet }));
const mockEnrollmentsCollectionRef = jest.fn(() => ({
  where: mockEnrollmentsWhere,
}));

const mockBatchUpdate = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn();
const mockBatch = {
  update: mockBatchUpdate,
  set: mockBatchSet,
  commit: mockBatchCommit,
};
const mockCreateFirestoreBatch = jest.fn(() => mockBatch);

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
    assignmentPublishDocRef: mockAssignmentPublishDocRef,
    assignmentRecipientCreationDocRef: mockAssignmentRecipientCreationDocRef,
    enrollmentsCollectionRef: mockEnrollmentsCollectionRef,
    createFirestoreBatch: mockCreateFirestoreBatch,
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
const CLASS_ID = "class-abc";

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
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: "lesson_g7_earths-layers",
      lessonVersion: "1",
      mode: "classroom",
      status: "draft",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

function enrollmentSnapshot(
  docs: ReadonlyArray<{
    id?: string;
    data: Record<string, unknown>;
  }>,
) {
  return {
    docs: docs.map((d, i) => ({
      id: d.id ?? `enroll-${String(i)}`,
      data: () => d.data,
    })),
  };
}

function activeEnrollment(
  studentId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `${CLASS_ID}__${studentId}`,
    data: {
      studentId,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      status: "active",
      enrolledAt: {},
      ...overrides,
    },
  };
}

describe("assignmentsPublish", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockAssignmentDocRef.mockClear();
    mockAssignmentPublishDocRef.mockClear();
    mockAssignmentRecipientCreationDocRef.mockClear();
    mockAssignmentRecipientCreationDocRef.mockImplementation(mockRecipientRefFactory);
    mockEnrollmentsGet.mockReset();
    mockEnrollmentsWhere.mockClear();
    mockEnrollmentsCollectionRef.mockClear();
    mockBatchUpdate.mockReset();
    mockBatchSet.mockReset();
    mockBatchCommit.mockReset();
    mockCreateFirestoreBatch.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  describe("first publication snapshot", () => {
    it("advances draft to published, writes recipients atomically, and emits one audit event", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(
        enrollmentSnapshot([
          activeEnrollment("student-1"),
          activeEnrollment("student-2"),
          activeEnrollment("student-3"),
        ]),
      );
      mockBatchCommit.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

      const result = await __assignmentsPublishHandler(makeRequest());

      expect(mockCreateFirestoreBatch).toHaveBeenCalledTimes(1);
      expect(mockBatchUpdate).toHaveBeenCalledWith(mockPublishRefSentinel, {
        status: "published",
        publishedAt: SERVER_TIMESTAMP_SENTINEL,
      });
      expect(mockBatchSet).toHaveBeenCalledTimes(3);
      for (const studentId of ["student-1", "student-2", "student-3"]) {
        expect(mockBatchSet).toHaveBeenCalledWith(
          expect.objectContaining({
            __kind: "recipientRef",
            assignmentId: ASSIGNMENT_ID,
            studentId,
          }),
          {
            assignmentId: ASSIGNMENT_ID,
            studentId,
            classId: CLASS_ID,
            teacherId: TEACHER_UID,
            schoolId: SCHOOL_ID,
            districtId: DISTRICT_ID,
            assignedAt: SERVER_TIMESTAMP_SENTINEL,
            assignedBy: TEACHER_UID,
            source: "classPublication",
            status: "assigned",
          },
        );
      }
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
      expect(mockWriteAuditEvent).toHaveBeenCalledWith({
        actorUserId: TEACHER_UID,
        actorRole: "teacher",
        action: "assignments.published",
        targetType: "assignment",
        targetId: ASSIGNMENT_ID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        payload: {
          classId: CLASS_ID,
          lessonSlug: "lesson_g7_earths-layers",
          lessonVersion: "1",
          recipientCount: 3,
        },
      });
      expect(result).toEqual({
        assignmentId: ASSIGNMENT_ID,
        status: "published",
        alreadyPublished: false,
      });
    });

    it("publishes an empty class with zero recipients", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(enrollmentSnapshot([]));
      mockBatchCommit.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

      const result = await __assignmentsPublishHandler(makeRequest());

      expect(mockBatchSet).not.toHaveBeenCalled();
      expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
      expect(mockWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ recipientCount: 0 }),
        }),
      );
      expect(result.alreadyPublished).toBe(false);
    });

    it("deduplicates enrollment rows sharing a studentId", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(
        enrollmentSnapshot([
          activeEnrollment("student-1"),
          activeEnrollment("student-1"),
          activeEnrollment("student-2"),
        ]),
      );
      mockBatchCommit.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e", record: {} });

      await __assignmentsPublishHandler(makeRequest());

      expect(mockBatchSet).toHaveBeenCalledTimes(2);
    });

    it("excludes inactive, transferred, withdrawn, and archived enrollments", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(
        enrollmentSnapshot([
          activeEnrollment("student-active"),
          activeEnrollment("student-transferred", { status: "transferred" }),
          activeEnrollment("student-withdrawn", { status: "withdrawn" }),
          activeEnrollment("student-archived", { status: "archived" }),
        ]),
      );
      mockBatchCommit.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e", record: {} });

      await __assignmentsPublishHandler(makeRequest());

      expect(mockBatchSet).toHaveBeenCalledTimes(1);
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: "student-active" }),
        expect.objectContaining({ studentId: "student-active" }),
      );
    });

    it("excludes malformed and cross-class enrollments", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(
        enrollmentSnapshot([
          activeEnrollment("student-good"),
          activeEnrollment("", {}),
          activeEnrollment("student-cross-class", { classId: "class-other" }),
          activeEnrollment("student-cross-school", { schoolId: "school-b" }),
        ]),
      );
      mockBatchCommit.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e", record: {} });

      await __assignmentsPublishHandler(makeRequest());

      expect(mockBatchSet).toHaveBeenCalledTimes(1);
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: "student-good" }),
        expect.objectContaining({ studentId: "student-good" }),
      );
    });

    it("propagates a batch commit failure without emitting the audit event", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(
        enrollmentSnapshot([activeEnrollment("student-1")]),
      );
      mockBatchCommit.mockRejectedValueOnce(new Error("firestore unavailable"));

      await expect(
        __assignmentsPublishHandler(makeRequest()),
      ).rejects.toThrow("firestore unavailable");
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe("idempotency and lifecycle", () => {
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
      expect(mockCreateFirestoreBatch).not.toHaveBeenCalled();
      expect(mockBatchUpdate).not.toHaveBeenCalled();
      expect(mockBatchSet).not.toHaveBeenCalled();
      expect(mockEnrollmentsGet).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    });

    it("rejects publish from closed or archived with invalidTransition", async () => {
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
      expect(mockCreateFirestoreBatch).not.toHaveBeenCalled();
      expect(mockEnrollmentsGet).not.toHaveBeenCalled();
    });
  });

  describe("authorization regression", () => {
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
    });

    it("propagates the canonical district-mismatch district error", async () => {
      mockRequireDistrictContext.mockReset();
      mockRequireDistrictContext.mockRejectedValueOnce(
        new PlatformError("district-mismatch", "mismatch"),
      );
      await expect(
        __assignmentsPublishHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "district-mismatch" });
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

    it("orders side effects: batch commit, then audit", async () => {
      const calls: string[] = [];
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(
        enrollmentSnapshot([activeEnrollment("student-1")]),
      );
      mockBatchCommit.mockImplementationOnce(() => {
        calls.push("commit");
        return Promise.resolve();
      });
      mockWriteAuditEvent.mockImplementationOnce(() => {
        calls.push("audit");
        return Promise.resolve({ eventId: "evt-1", record: {} });
      });

      await __assignmentsPublishHandler(makeRequest());

      expect(calls).toEqual(["commit", "audit"]);
    });
  });
});
