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

// Historical Assignment Resolution, Implementation Slice 5. The read ref is
// mocked even though the current implementation never calls it - several
// tests below assert exactly that (proof that publication never reads,
// validates, or depends on any prior pointer value).
const mockAssignmentsCurrentDocRef = jest.fn(
  (classId: string, lessonSlug: string) => ({
    __kind: "currentPointerReadRef",
    classId,
    lessonSlug,
  }),
);
const mockCurrentSetRefFactory = jest.fn((classId: string, lessonSlug: string) => ({
  __kind: "currentPointerRef",
  classId,
  lessonSlug,
}));
const mockAssignmentsCurrentSetDocRef = jest.fn(mockCurrentSetRefFactory);

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
const mockResolveCurrentAssessmentRevisionId = jest.fn();

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
    assignmentsCurrentDocRef: mockAssignmentsCurrentDocRef,
    assignmentsCurrentSetDocRef: mockAssignmentsCurrentSetDocRef,
    enrollmentsCollectionRef: mockEnrollmentsCollectionRef,
    createFirestoreBatch: mockCreateFirestoreBatch,
    requireDistrictContext: mockRequireDistrictContext,
    resolveCurrentAssessmentRevisionId: mockResolveCurrentAssessmentRevisionId,
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
const LESSON_SLUG = "lesson_g7_earths-layers";
const ASSESSMENT_REVISION_ID = `assessment_${LESSON_SLUG}__r1`;

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
    mockAssignmentsCurrentDocRef.mockClear();
    mockAssignmentsCurrentSetDocRef.mockClear();
    mockAssignmentsCurrentSetDocRef.mockImplementation(mockCurrentSetRefFactory);
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
    mockResolveCurrentAssessmentRevisionId.mockReset();
    mockResolveCurrentAssessmentRevisionId.mockResolvedValue(
      ASSESSMENT_REVISION_ID,
    );
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
        assessmentRevisionId: ASSESSMENT_REVISION_ID,
      });
      // 3 recipients + 1 Current pointer, all through the same batch.
      expect(mockBatchSet).toHaveBeenCalledTimes(4);
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
      // Historical Assignment Resolution, Implementation Slice 5. The
      // Current pointer advances atomically with the publish transition,
      // through the same batch, with exactly the canonical eight-field
      // shape and no extra fields.
      expect(mockAssignmentsCurrentSetDocRef).toHaveBeenCalledWith(CLASS_ID, LESSON_SLUG);
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.objectContaining({ __kind: "currentPointerRef" }),
        {
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: ASSIGNMENT_ID,
          teacherId: TEACHER_UID,
          schoolId: SCHOOL_ID,
          setAt: SERVER_TIMESTAMP_SENTINEL,
          setBy: TEACHER_UID,
          source: "publish",
        },
      );
      // The Current pointer is never read: a malformed, stale, or missing
      // prior value is never a precondition for publication advancement.
      expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
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
          lessonSlug: LESSON_SLUG,
          assessmentRevisionId: ASSESSMENT_REVISION_ID,
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

      // Zero recipients, but the Current pointer still advances - it is
      // not conditioned on there being any recipients to snapshot.
      expect(mockBatchSet).toHaveBeenCalledTimes(1);
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.objectContaining({ __kind: "currentPointerRef" }),
        expect.objectContaining({ assignmentId: ASSIGNMENT_ID, source: "publish" }),
      );
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

      // 2 deduplicated recipients + 1 Current pointer.
      expect(mockBatchSet).toHaveBeenCalledTimes(3);
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

      // 1 eligible recipient + 1 Current pointer.
      expect(mockBatchSet).toHaveBeenCalledTimes(2);
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

      // 1 eligible recipient + 1 Current pointer.
      expect(mockBatchSet).toHaveBeenCalledTimes(2);
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: "student-good" }),
        expect.objectContaining({ studentId: "student-good" }),
      );
    });

    // Permanent regression: an Assignment cannot be published unless a
    // deployed AssessmentRevision exists per ASSESSMENT_SCORING_CONTRACT.md
    // §12.1. The publish path resolves the frozen assessmentRevisionId
    // through the shared identifier helper and refuses when no revision
    // has been deployed for the referenced lesson. No lifecycle write,
    // no recipient snapshot, and no audit event escapes the refusal.
    it("refuses to publish when the referenced assessment has not been deployed", async () => {
      const { PlatformError: ActualPlatformError } = jest.requireActual(
        "../shared/errors/platform-error",
      );
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockResolveCurrentAssessmentRevisionId.mockReset();
      mockResolveCurrentAssessmentRevisionId.mockRejectedValueOnce(
        new ActualPlatformError(
          "assessments.notDeployed",
          "No deployed assessment exists for lessonSlug.",
        ),
      );

      await expect(
        __assignmentsPublishHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assessments.notDeployed" });

      expect(mockCreateFirestoreBatch).not.toHaveBeenCalled();
      expect(mockBatchUpdate).not.toHaveBeenCalled();
      expect(mockBatchSet).not.toHaveBeenCalled();
      expect(mockBatchCommit).not.toHaveBeenCalled();
      expect(mockEnrollmentsGet).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
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

    // Requirement 8 (Slice 5): there is no publication-success/pointer-
    // failure split state, because both writes are enqueued on the SAME
    // batch and Firestore batches commit all-or-nothing. The Current
    // pointer set was already enqueued (proving it was part of what failed
    // to commit, not skipped or deferred), and the caller never observes
    // the assignment as published when the shared commit fails.
    it("a failed batch commit means neither the publish transition nor the Current pointer was applied", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(enrollmentSnapshot([]));
      mockBatchCommit.mockRejectedValueOnce(new Error("firestore unavailable"));

      await expect(
        __assignmentsPublishHandler(makeRequest()),
      ).rejects.toThrow("firestore unavailable");

      // The pointer write was enqueued onto the batch before the commit
      // that failed - it was never a separate, independently-committed
      // operation that could have "succeeded anyway."
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.objectContaining({ __kind: "currentPointerRef" }),
        expect.objectContaining({ source: "publish" }),
      );
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
      // Requirement 7 (Slice 5): an invalid transition never advances Current.
      expect(mockBatchSet).not.toHaveBeenCalled();
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

      // Requirement 7 (Slice 5): unauthorized publication never advances
      // Current - the batch (and therefore the pointer write it would
      // otherwise carry) is never created.
      expect(mockCreateFirestoreBatch).not.toHaveBeenCalled();
      expect(mockBatchSet).not.toHaveBeenCalled();
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

      // Requirement 7 (Slice 5): a missing assignment never advances Current.
      expect(mockCreateFirestoreBatch).not.toHaveBeenCalled();
      expect(mockBatchSet).not.toHaveBeenCalled();
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

  // Historical Assignment Resolution, Implementation Slice 5. Automatic
  // Current advancement on publication. Unlike `assignmentsCurrentSet`
  // (Slice 4), this path carries NO CAS, reads no prior pointer value, and
  // cannot be blocked by any prior pointer state - see the handler-level
  // comment in assignments-publish.ts for the full rationale.
  describe("Current pointer advancement (Slice 5)", () => {
    it("replaces an existing Current selection unconditionally - no CAS, no read of the prior value", async () => {
      // Current was previously X (a different assignment entirely); this
      // call publishes a brand new draft Y for the same class/lesson. The
      // implementation never reads the prior pointer at all, so there is
      // nothing to seed for "Current = X" - that is exactly the point this
      // test documents and asserts.
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(enrollmentSnapshot([]));
      mockBatchCommit.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e", record: {} });

      const result = await __assignmentsPublishHandler(makeRequest());

      expect(result.alreadyPublished).toBe(false);
      expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.objectContaining({ __kind: "currentPointerRef" }),
        expect.objectContaining({ assignmentId: ASSIGNMENT_ID, source: "publish" }),
      );
    });

    // Requirements 3 and 4: a malformed, stale, closed-referencing, or
    // entirely missing prior Current pointer must never block a genuine
    // new publication. Mechanically, all four hypothetical prior states
    // collapse to the identical proof here: this implementation never
    // calls the pointer READ ref at all, for any prior state, so none of
    // them can possibly gate or alter this write. Four separately-mocked
    // "prior pointer" fixtures would exercise no different code path than
    // this single assertion already does; asserting the read ref was never
    // invoked is the strongest and most honest proof available; a
    // separately-mocked "prior state" would only assert the same thing
    // through a longer path.
    it("a malformed, stale, closed-referencing, or missing prior Current pointer cannot block publication, because it is never read", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(enrollmentSnapshot([]));
      mockBatchCommit.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e", record: {} });

      const result = await __assignmentsPublishHandler(makeRequest());

      expect(result.alreadyPublished).toBe(false);
      expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
    });

    it("writes exactly the canonical eight-field pointer shape, source \"publish\", and no extra fields", async () => {
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(enrollmentSnapshot([]));
      mockBatchCommit.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e", record: {} });

      await __assignmentsPublishHandler(makeRequest());

      const [, pointerWrite] = mockBatchSet.mock.calls.find(
        ([ref]) => (ref as { __kind?: string }).__kind === "currentPointerRef",
      ) as [unknown, Record<string, unknown>];
      expect(Object.keys(pointerWrite).sort()).toEqual(
        ["assignmentId", "classId", "lessonSlug", "schoolId", "setAt", "setBy", "source", "teacherId"].sort(),
      );
      expect(pointerWrite).toEqual({
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: ASSIGNMENT_ID,
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        setAt: SERVER_TIMESTAMP_SENTINEL,
        setBy: TEACHER_UID,
        source: "publish",
      });
    });

    // Requirement 6: structural atomicity proof, not merely "two mock calls
    // both happened to succeed." A fresh batch object is created per call
    // (rather than reusing the shared `mockBatch` singleton used elsewhere
    // in this file) so this test can prove the publish-transition update
    // and the Current-pointer set are both method calls on the SAME single
    // object instance returned by the ONE `createFirestoreBatch()` call for
    // this handler invocation - not two independently-created atomic
    // regions that merely both happened to succeed.
    it("issues the publish transition and the Current pointer set on the identical batch instance from one createFirestoreBatch() call", async () => {
      const freshBatch = {
        update: jest.fn(),
        set: jest.fn(),
        commit: jest.fn().mockResolvedValue(undefined),
      };
      mockCreateFirestoreBatch.mockReset();
      mockCreateFirestoreBatch.mockImplementationOnce(() => freshBatch);
      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(enrollmentSnapshot([]));
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e", record: {} });

      await __assignmentsPublishHandler(makeRequest());

      expect(mockCreateFirestoreBatch).toHaveBeenCalledTimes(1);
      expect(freshBatch.update).toHaveBeenCalledTimes(1);
      // Zero recipients + exactly 1 Current pointer set, both via the same
      // `freshBatch.set` method.
      expect(freshBatch.set).toHaveBeenCalledTimes(1);
      expect(freshBatch.set).toHaveBeenCalledWith(
        expect.objectContaining({ __kind: "currentPointerRef" }),
        expect.objectContaining({ source: "publish" }),
      );
      expect(freshBatch.commit).toHaveBeenCalledTimes(1);

      mockCreateFirestoreBatch.mockImplementation(() => mockBatch);
    });

    // Race semantics (locked, not a defect): two distinct, independently
    // legitimate drafts (Y then Z) for the same class/lesson are each
    // published. Each publication unconditionally and atomically writes
    // itself as Current; whichever commit is applied last is the one the
    // pointer ends up naming. No CAS is used to prevent this. Both
    // assignments remain valid, independently published historical
    // records.
    it("two sequential legitimate publications for the same class/lesson: the later one's commit determines Current (last-write-wins, by design)", async () => {
      const Y = "assign-y";
      const Z = "assign-z";

      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(enrollmentSnapshot([]));
      mockBatchCommit.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e1", record: {} });
      const resultY = await __assignmentsPublishHandler(
        makeRequest({ data: { assignmentId: Y } }),
      );

      mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
      mockEnrollmentsGet.mockResolvedValueOnce(enrollmentSnapshot([]));
      mockBatchCommit.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e2", record: {} });
      const resultZ = await __assignmentsPublishHandler(
        makeRequest({ data: { assignmentId: Z } }),
      );

      expect(resultY).toEqual({ assignmentId: Y, status: "published", alreadyPublished: false });
      expect(resultZ).toEqual({ assignmentId: Z, status: "published", alreadyPublished: false });
      // Both publications independently and successfully wrote themselves
      // as Current; the later commit (Z) is what the pointer document ends
      // up naming, which is the intended, locked outcome, not a race bug.
      const pointerWrites = mockBatchSet.mock.calls
        .filter(([ref]) => (ref as { __kind?: string }).__kind === "currentPointerRef")
        .map(([, data]) => (data as { assignmentId: string }).assignmentId);
      expect(pointerWrites).toEqual([Y, Z]);
    });
  });
});
