const mockEnrollmentsGet = jest.fn();
const mockEnrollmentsWhere = jest.fn(() => ({ get: mockEnrollmentsGet }));
const mockEnrollmentsCollectionRef = jest.fn(() => ({
  where: mockEnrollmentsWhere,
}));

// Phase B Core, Slice 1: minimal fakes for `ensureAssignmentRecipient`'s two
// Firestore call sites, following this file's existing "mock only what is
// actually exercised" convention. The wrapper forwards its arguments to the
// inner mock so a fixture-backed default implementation (set in
// `beforeEach`, below) can answer per (assignmentId, studentId) - this
// changes nothing about what `mockAssignmentRecipientDocRef` itself is
// called with, so every pre-existing Slice 1 assertion is unaffected;
// `mockResolvedValueOnce` calls already used by those tests continue to
// take priority over the default for exactly one call, regardless of
// arguments.
const mockRecipientGet = jest.fn();
const mockAssignmentRecipientDocRef = jest.fn(
  (assignmentId: string, studentId: string) => ({
    get: () => mockRecipientGet(assignmentId, studentId),
  }),
);
const mockRecipientCreationSet = jest.fn();
const mockAssignmentRecipientCreationDocRef = jest.fn(() => ({
  set: mockRecipientCreationSet,
}));

// Phase B Core, Automatic Enrollment Reconciliation slice: fakes for
// `reconcileRecipientsForNewEnrollment`'s additional Firestore call site
// (`assignmentsCollectionRef().where("classId","==",...)`) and a
// fixture-backed default for the two recipient mocks above so a test can
// exercise multiple `ensureAssignmentRecipient` calls (one per published
// assignment) within a single reconciliation call.
type RecipientFixtureRow = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly status: string;
};
const assignmentsFixture: Array<{ id: string; data: Record<string, unknown> }> = [];
const recipientsFixture: RecipientFixtureRow[] = [];

const mockAssignmentsGet = jest.fn();
function makeAssignmentsQuery(
  filters: Array<{ field: string; value: unknown }>,
) {
  return {
    where(field: string, _op: string, value: unknown) {
      return makeAssignmentsQuery([...filters, { field, value }]);
    },
    get: () => {
      const filtered = assignmentsFixture.filter((row) =>
        filters.every((f) => row.data[f.field] === f.value),
      );
      mockAssignmentsGet(filters);
      return Promise.resolve({
        docs: filtered.map((row) => ({ id: row.id, data: () => row.data })),
      });
    },
  };
}
const mockAssignmentsCollectionRef = jest.fn(() => makeAssignmentsQuery([]));

// Historical Assignment Resolution, Implementation Slice 6. A dedicated
// fixture and fake for `reconcileAssignmentRecipients`'s
// `assignmentRecipientsCollectionRef` call site (a collection scan of
// `assignments/{assignmentId}/recipients`, distinct from the per-document
// `assignmentRecipientDocRef` fakes above, which `ensureAssignmentRecipient`
// itself still uses unchanged). Kept separate from `recipientsFixture`
// (used by the `reconcileRecipientsForNewEnrollment` tests above) so
// neither fixture's shape needs to grow to accommodate the other's fields.
type ExistingRecipientRow = { readonly id: string; readonly data: Record<string, unknown> };
const existingRecipientsFixture: ExistingRecipientRow[] = [];
const mockAssignmentRecipientsCollectionRef = jest.fn((assignmentId: string) => ({
  get: () =>
    Promise.resolve({
      docs: existingRecipientsFixture
        .filter((row) => row.data.assignmentId === assignmentId)
        .map((row) => ({ id: row.id, data: () => row.data })),
    }),
}));

const SERVER_TIMESTAMP_SENTINEL = { __sentinel: "serverTimestamp" } as const;

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    enrollmentsCollectionRef: mockEnrollmentsCollectionRef,
    assignmentRecipientDocRef: mockAssignmentRecipientDocRef,
    assignmentRecipientCreationDocRef: mockAssignmentRecipientCreationDocRef,
    assignmentRecipientsCollectionRef: mockAssignmentRecipientsCollectionRef,
    assignmentsCollectionRef: mockAssignmentsCollectionRef,
  };
});

import {
  buildRecipientCreationWrite,
  ensureAssignmentRecipient,
  isCanonicalRecipientData,
  loadInitialRecipientPopulation,
  reconcileAssignmentRecipients,
  reconcileRecipientsForNewEnrollment,
  type RecipientOwnershipContext,
} from "./assignment-recipients";
import { PlatformError } from "../shared/errors/platform-error";

const CLASS_ID = "class-abc";
const SCHOOL_ID = "school-a";

function activeEnrollmentDoc(
  studentId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `${CLASS_ID}__${studentId}`,
    data: () => ({
      studentId,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      status: "active",
      enrolledAt: {},
      ...overrides,
    }),
  };
}

describe("assignment-recipients helpers", () => {
  beforeEach(() => {
    mockEnrollmentsGet.mockReset();
    mockEnrollmentsWhere.mockClear();
    mockEnrollmentsCollectionRef.mockClear();
    mockRecipientGet.mockReset();
    mockAssignmentRecipientDocRef.mockClear();
    mockRecipientCreationSet.mockReset();
    mockAssignmentRecipientCreationDocRef.mockClear();
    mockAssignmentsGet.mockReset();
    mockAssignmentsCollectionRef.mockClear();
    mockAssignmentRecipientsCollectionRef.mockClear();
    assignmentsFixture.length = 0;
    recipientsFixture.length = 0;
    existingRecipientsFixture.length = 0;

    // Fixture-backed defaults, re-applied every test since `.mockReset()`
    // above clears any previously-set implementation. Pre-existing Slice 1
    // tests are unaffected: their own `mockResolvedValueOnce(...)` calls
    // take priority over these defaults for exactly one call.
    mockRecipientGet.mockImplementation((assignmentId: string, studentId: string) => {
      const match = recipientsFixture.find(
        (r) => r.assignmentId === assignmentId && r.studentId === studentId,
      );
      return Promise.resolve({
        exists: !!match,
        data: () => match ? {
          assignmentId: match.assignmentId,
          studentId: match.studentId,
          schoolId: match.schoolId,
          districtId: match.districtId,
          status: match.status,
        } : undefined,
      });
    });
    mockRecipientCreationSet.mockImplementation(
      (payload: { assignmentId: string; studentId: string; schoolId: string; districtId: string; status: string }) => {
        const idx = recipientsFixture.findIndex(
          (r) =>
            r.assignmentId === payload.assignmentId &&
            r.studentId === payload.studentId,
        );
        if (idx === -1) {
          recipientsFixture.push({
            assignmentId: payload.assignmentId,
            studentId: payload.studentId,
            schoolId: payload.schoolId,
            districtId: payload.districtId,
            status: payload.status,
          });
        }
        return Promise.resolve();
      },
    );
  });

  describe("buildRecipientCreationWrite", () => {
    it("emits a canonical write payload including every ownership field", () => {
      const write = buildRecipientCreationWrite(
        {
          assignmentId: "assign-1",
          classId: CLASS_ID,
          teacherId: "teacher-uid",
          schoolId: SCHOOL_ID,
          districtId: "district-1",
          assignedBy: "teacher-uid",
        },
        "student-1",
        "classPublication",
      );
      expect(write).toEqual({
        assignmentId: "assign-1",
        studentId: "student-1",
        classId: CLASS_ID,
        teacherId: "teacher-uid",
        schoolId: SCHOOL_ID,
        districtId: "district-1",
        assignedAt: SERVER_TIMESTAMP_SENTINEL,
        assignedBy: "teacher-uid",
        source: "classPublication",
        status: "assigned",
      });
    });

    it("stamps manualAddition when requested", () => {
      const write = buildRecipientCreationWrite(
        {
          assignmentId: "assign-1",
          classId: CLASS_ID,
          teacherId: "teacher-uid",
          schoolId: SCHOOL_ID,
          districtId: "district-1",
          assignedBy: "teacher-uid",
        },
        "student-1",
        "manualAddition",
      );
      expect(write.source).toBe("manualAddition");
      expect(write.status).toBe("assigned");
    });
  });

  describe("ensureAssignmentRecipient (Phase B Core, Slice 1)", () => {
    const context: RecipientOwnershipContext = {
      assignmentId: "assign-1",
      classId: CLASS_ID,
      teacherId: "teacher-uid",
      schoolId: SCHOOL_ID,
      districtId: "district-1",
      assignedBy: "teacher-uid",
    };

    it("creates exactly one recipient document and returns added: true when none exists", async () => {
      mockRecipientGet.mockResolvedValueOnce({ exists: false });

      const result = await ensureAssignmentRecipient(
        context,
        "student-1",
        "manualAddition",
      );

      expect(result).toEqual({ added: true });
      expect(mockAssignmentRecipientDocRef).toHaveBeenCalledWith(
        "assign-1",
        "student-1",
      );
      expect(mockAssignmentRecipientCreationDocRef).toHaveBeenCalledWith(
        "assign-1",
        "student-1",
      );
      expect(mockRecipientCreationSet).toHaveBeenCalledTimes(1);
      expect(mockRecipientCreationSet).toHaveBeenCalledWith({
        assignmentId: "assign-1",
        studentId: "student-1",
        classId: CLASS_ID,
        teacherId: "teacher-uid",
        schoolId: SCHOOL_ID,
        districtId: "district-1",
        assignedAt: SERVER_TIMESTAMP_SENTINEL,
        assignedBy: "teacher-uid",
        source: "manualAddition",
        status: "assigned",
      });
    });

    it("returns added: false and never writes when a canonical recipient already exists", async () => {
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assignmentId: "assign-1",
          studentId: "student-1",
          schoolId: SCHOOL_ID,
          districtId: "district-1",
          status: "assigned",
        }),
      });

      const result = await ensureAssignmentRecipient(
        context,
        "student-1",
        "manualAddition",
      );

      expect(result).toEqual({ added: false });
      expect(mockAssignmentRecipientCreationDocRef).not.toHaveBeenCalled();
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("passes the given source through to the write payload unchanged", async () => {
      mockRecipientGet.mockResolvedValueOnce({ exists: false });

      await ensureAssignmentRecipient(context, "student-1", "classPublication");

      expect(mockRecipientCreationSet).toHaveBeenCalledWith(
        expect.objectContaining({ source: "classPublication" }),
      );
    });
  });

  describe("isCanonicalRecipientData (shared validation predicate)", () => {
    const enforcementContext = {
      assignmentId: "assign-1",
      studentId: "student-1",
      schoolId: SCHOOL_ID,
      districtId: "district-1",
    };

    const canonicalData = {
      assignmentId: "assign-1",
      studentId: "student-1",
      schoolId: SCHOOL_ID,
      districtId: "district-1",
      status: "assigned",
    };

    it("returns true for a fully canonical document", () => {
      expect(isCanonicalRecipientData(canonicalData, enforcementContext)).toBe(true);
    });

    it("returns false when data is undefined", () => {
      expect(isCanonicalRecipientData(undefined, enforcementContext)).toBe(false);
    });

    it("returns false when assignmentId mismatches", () => {
      expect(
        isCanonicalRecipientData(
          { ...canonicalData, assignmentId: "wrong-id" },
          enforcementContext,
        ),
      ).toBe(false);
    });

    it("returns false when studentId mismatches", () => {
      expect(
        isCanonicalRecipientData(
          { ...canonicalData, studentId: "wrong-student" },
          enforcementContext,
        ),
      ).toBe(false);
    });

    it("returns false when schoolId mismatches", () => {
      expect(
        isCanonicalRecipientData(
          { ...canonicalData, schoolId: "wrong-school" },
          enforcementContext,
        ),
      ).toBe(false);
    });

    it("returns false when districtId mismatches", () => {
      expect(
        isCanonicalRecipientData(
          { ...canonicalData, districtId: "wrong-district" },
          enforcementContext,
        ),
      ).toBe(false);
    });

    it("returns false when status is not assigned", () => {
      expect(
        isCanonicalRecipientData(
          { ...canonicalData, status: "removed" },
          enforcementContext,
        ),
      ).toBe(false);
    });

    it("returns false when status is missing", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { status: _status, ...noStatus } = canonicalData;
      expect(isCanonicalRecipientData(noStatus, enforcementContext)).toBe(false);
    });

    it("returns true when extra fields are present alongside canonical fields", () => {
      expect(
        isCanonicalRecipientData(
          { ...canonicalData, classId: CLASS_ID, teacherId: "teacher-uid", source: "manualAddition" },
          enforcementContext,
        ),
      ).toBe(true);
    });

    it("returns false for an empty object", () => {
      expect(isCanonicalRecipientData({}, enforcementContext)).toBe(false);
    });
  });

  describe("ensureAssignmentRecipient — noncanonical existing doc (Phase B Core, Security Correction)", () => {
    const context: RecipientOwnershipContext = {
      assignmentId: "assign-1",
      classId: CLASS_ID,
      teacherId: "teacher-uid",
      schoolId: SCHOOL_ID,
      districtId: "district-1",
      assignedBy: "teacher-uid",
    };

    it("throws recipientIntegrityViolation when existing doc has mismatched assignmentId", async () => {
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assignmentId: "wrong-assignment",
          studentId: "student-1",
          schoolId: SCHOOL_ID,
          districtId: "district-1",
          status: "assigned",
        }),
      });

      await expect(
        ensureAssignmentRecipient(context, "student-1", "manualAddition"),
      ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("throws recipientIntegrityViolation when existing doc has mismatched studentId", async () => {
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assignmentId: "assign-1",
          studentId: "wrong-student",
          schoolId: SCHOOL_ID,
          districtId: "district-1",
          status: "assigned",
        }),
      });

      await expect(
        ensureAssignmentRecipient(context, "student-1", "manualAddition"),
      ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("throws recipientIntegrityViolation when existing doc has mismatched schoolId", async () => {
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assignmentId: "assign-1",
          studentId: "student-1",
          schoolId: "wrong-school",
          districtId: "district-1",
          status: "assigned",
        }),
      });

      await expect(
        ensureAssignmentRecipient(context, "student-1", "manualAddition"),
      ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("throws recipientIntegrityViolation when existing doc has mismatched districtId", async () => {
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assignmentId: "assign-1",
          studentId: "student-1",
          schoolId: SCHOOL_ID,
          districtId: "wrong-district",
          status: "assigned",
        }),
      });

      await expect(
        ensureAssignmentRecipient(context, "student-1", "manualAddition"),
      ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("throws recipientIntegrityViolation when existing doc has non-assigned status", async () => {
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assignmentId: "assign-1",
          studentId: "student-1",
          schoolId: SCHOOL_ID,
          districtId: "district-1",
          status: "removed",
        }),
      });

      await expect(
        ensureAssignmentRecipient(context, "student-1", "manualAddition"),
      ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("throws recipientIntegrityViolation when existing doc returns undefined data", async () => {
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => undefined,
      });

      await expect(
        ensureAssignmentRecipient(context, "student-1", "manualAddition"),
      ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("throws a PlatformError instance (not a generic Error)", async () => {
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assignmentId: "assign-1",
          studentId: "student-1",
          schoolId: "wrong-school",
          districtId: "district-1",
          status: "assigned",
        }),
      });

      await expect(
        ensureAssignmentRecipient(context, "student-1", "manualAddition"),
      ).rejects.toBeInstanceOf(PlatformError);
    });

    it("does not overwrite a malformed existing doc with canonical values", async () => {
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assignmentId: "assign-1",
          studentId: "student-1",
          schoolId: "wrong-school",
          districtId: "district-1",
          status: "assigned",
        }),
      });

      await expect(
        ensureAssignmentRecipient(context, "student-1", "manualAddition"),
      ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
      expect(mockAssignmentRecipientCreationDocRef).not.toHaveBeenCalled();
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("accepts a canonical doc even when it has extra fields beyond the validated set", async () => {
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assignmentId: "assign-1",
          studentId: "student-1",
          classId: CLASS_ID,
          teacherId: "teacher-uid",
          schoolId: SCHOOL_ID,
          districtId: "district-1",
          assignedAt: {},
          assignedBy: "teacher-uid",
          source: "classPublication",
          status: "assigned",
        }),
      });

      const result = await ensureAssignmentRecipient(
        context,
        "student-1",
        "manualAddition",
      );
      expect(result).toEqual({ added: false });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });
  });

  describe("reconcileRecipientsForNewEnrollment (Phase B Core, Automatic Enrollment Reconciliation)", () => {
    const DISTRICT_ID = "district-1";

    function seedAssignment(
      assignmentId: string,
      overrides: Record<string, unknown> = {},
    ): void {
      assignmentsFixture.push({
        id: assignmentId,
        data: {
          classId: CLASS_ID,
          teacherId: "teacher-uid",
          schoolId: SCHOOL_ID,
          status: "published",
          lessonSlug: "lesson_engineering-design",
          ...overrides,
        },
      });
    }

    it("finds all published assignments for the class and reconciles each", async () => {
      seedAssignment("assign-a");
      seedAssignment("assign-b");

      const result = await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      expect(result).toEqual({ assignmentsConsidered: 2, recipientsAdded: 2 });
      expect(
        recipientsFixture.some(
          (r) => r.assignmentId === "assign-a" && r.studentId === "student-1",
        ),
      ).toBe(true);
      expect(
        recipientsFixture.some(
          (r) => r.assignmentId === "assign-b" && r.studentId === "student-1",
        ),
      ).toBe(true);
    });

    it("ignores draft assignments", async () => {
      seedAssignment("assign-draft", { status: "draft" });

      const result = await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      expect(result).toEqual({ assignmentsConsidered: 0, recipientsAdded: 0 });
      expect(recipientsFixture).toEqual([]);
    });

    it("ignores closed assignments", async () => {
      seedAssignment("assign-closed", { status: "closed" });

      const result = await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      expect(result).toEqual({ assignmentsConsidered: 0, recipientsAdded: 0 });
      expect(recipientsFixture).toEqual([]);
    });

    it("ignores archived assignments", async () => {
      seedAssignment("assign-archived", { status: "archived" });

      const result = await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      expect(result).toEqual({ assignmentsConsidered: 0, recipientsAdded: 0 });
      expect(recipientsFixture).toEqual([]);
    });

    it("reconciles across multiple simultaneously published assignments for the same lesson without grouping or choosing by lessonSlug", async () => {
      seedAssignment("assign-sept", {
        lessonSlug: "lesson_engineering-design",
      });
      seedAssignment("assign-jan", {
        lessonSlug: "lesson_engineering-design",
      });

      const result = await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      // Both historical-duplicate assignments for the identical lessonSlug
      // are reconciled independently - neither is skipped nor treated as
      // more "correct" than the other.
      expect(result).toEqual({ assignmentsConsidered: 2, recipientsAdded: 2 });
      expect(recipientsFixture.map((r) => r.assignmentId).sort()).toEqual([
        "assign-jan",
        "assign-sept",
      ]);
    });

    it("calls ensureAssignmentRecipient with source exactly lateJoinReconciliation", async () => {
      seedAssignment("assign-a");

      await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      expect(mockRecipientCreationSet).toHaveBeenCalledWith(
        expect.objectContaining({ source: "lateJoinReconciliation" }),
      );
    });

    it("leaves an existing recipient untouched (idempotent)", async () => {
      seedAssignment("assign-a");
      recipientsFixture.push({
        assignmentId: "assign-a",
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        status: "assigned",
      });

      const result = await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      expect(result).toEqual({ assignmentsConsidered: 1, recipientsAdded: 0 });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
      expect(recipientsFixture.length).toBe(1);
    });

    it("repeated execution produces no duplicate canonical recipient documents", async () => {
      seedAssignment("assign-a");
      seedAssignment("assign-b");

      await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });
      const second = await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      expect(second).toEqual({ assignmentsConsidered: 2, recipientsAdded: 0 });
      expect(recipientsFixture.length).toBe(2);
    });

    it("zero published assignments is a successful no-op", async () => {
      const result = await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      expect(result).toEqual({ assignmentsConsidered: 0, recipientsAdded: 0 });
    });

    it("excludes an assignment whose frozen schoolId does not match the trusted schoolId (defense in depth)", async () => {
      seedAssignment("assign-cross-school", { schoolId: "school-other" });

      const result = await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      expect(result).toEqual({ assignmentsConsidered: 0, recipientsAdded: 0 });
    });

    it("stamps assignedBy as the assignment's own owning teacher, not the enrolling student", async () => {
      seedAssignment("assign-a", { teacherId: "teacher-owner" });

      await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      expect(mockRecipientCreationSet).toHaveBeenCalledWith(
        expect.objectContaining({ assignedBy: "teacher-owner" }),
      );
    });

    it("never mutates or creates an assignment record, and never touches unrelated Firestore collections (Part E regression/scope)", async () => {
      seedAssignment("assign-a");
      seedAssignment("assign-closed", { status: "closed" });
      const beforeSnapshot = JSON.stringify(assignmentsFixture);

      await reconcileRecipientsForNewEnrollment({
        classId: CLASS_ID,
        studentId: "student-1",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      // The assignment records themselves (status, count) are byte-for-byte
      // unchanged - this helper only ever writes to the recipients
      // subcollection via `mockAssignmentRecipientCreationDocRef`.
      expect(JSON.stringify(assignmentsFixture)).toBe(beforeSnapshot);
      expect(assignmentsFixture.length).toBe(2);
      // `mockEnrollmentsCollectionRef` backs `loadInitialRecipientPopulation`
      // (a different, unrelated read path) and is never invoked by
      // reconciliation - only `assignmentsCollectionRef` and the two
      // recipient refs are used, matching this file's mocked `../shared`
      // surface which deliberately excludes any Classroom, session, or
      // attempt-related function.
      expect(mockEnrollmentsCollectionRef).not.toHaveBeenCalled();
    });
  });

  // Historical Assignment Resolution, Implementation Slice 6. Focused tests
  // for the extracted engine itself, independent of any callable's own
  // authorization wrapper - the engine trusts `context` completely and
  // performs no authentication/ownership/status validation of its own (see
  // the engine's doc comment). `assignments-recipients-reconcile.test.ts`
  // separately proves the full public-callable contract is unaffected by
  // this extraction (66 pre-existing tests, unmodified, still green).
  describe("reconcileAssignmentRecipients (Historical Assignment Resolution, Slice 6 engine)", () => {
    const ASSIGNMENT_ID = "assign-1";
    const TEACHER_ID = "teacher-uid";
    const DISTRICT_ID = "district-1";
    const context: RecipientOwnershipContext = {
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      teacherId: TEACHER_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      assignedBy: TEACHER_ID,
    };

    function seedExistingRecipient(
      studentId: string,
      overrides: Record<string, unknown> = {},
    ): void {
      existingRecipientsFixture.push({
        id: studentId,
        data: {
          assignmentId: ASSIGNMENT_ID,
          studentId,
          classId: CLASS_ID,
          teacherId: TEACHER_ID,
          schoolId: SCHOOL_ID,
          districtId: DISTRICT_ID,
          status: "assigned",
          ...overrides,
        },
      });
    }

    it("creates a canonical recipient for an active-enrolled student with no existing recipient", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [activeEnrollmentDoc("student-1")],
      });

      const result = await reconcileAssignmentRecipients(context, "teacherReconcile");

      expect(result).toEqual({ added: 1, alreadyCurrent: 0 });
      expect(mockRecipientCreationSet).toHaveBeenCalledWith(
        expect.objectContaining({
          assignmentId: ASSIGNMENT_ID,
          studentId: "student-1",
          source: "teacherReconcile",
        }),
      );
    });

    it("leaves a canonical existing recipient untouched and counts it as alreadyCurrent", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [activeEnrollmentDoc("student-1")],
      });
      seedExistingRecipient("student-1");

      const result = await reconcileAssignmentRecipients(context, "teacherReconcile");

      expect(result).toEqual({ added: 0, alreadyCurrent: 1 });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("throws assignments.recipientIntegrityViolation for a malformed existing recipient and does not repair it", async () => {
      // The recipient collection scan drops the malformed row from the
      // "already canonical" set (cross-scope schoolId, which both the
      // collection-scan filter AND `isCanonicalRecipientData` check), so the
      // student is treated as missing and handed to
      // `ensureAssignmentRecipient` - which re-reads the SAME document at
      // its own doc path, finds it noncanonical by that same check, and
      // fails closed exactly as Phase B established.
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [activeEnrollmentDoc("student-1")],
      });
      seedExistingRecipient("student-1", { schoolId: "wrong-school" });
      mockRecipientGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assignmentId: ASSIGNMENT_ID,
          studentId: "student-1",
          schoolId: "wrong-school",
          districtId: DISTRICT_ID,
          status: "assigned",
        }),
      });

      await expect(
        reconcileAssignmentRecipients(context, "teacherReconcile"),
      ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("computes correct aggregate counts across multiple active enrollments (mixed missing and already-current)", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [
          activeEnrollmentDoc("student-a"),
          activeEnrollmentDoc("student-b"),
          activeEnrollmentDoc("student-c"),
        ],
      });
      seedExistingRecipient("student-a");

      const result = await reconcileAssignmentRecipients(context, "teacherReconcile");

      expect(result).toEqual({ added: 2, alreadyCurrent: 1 });
    });

    it("excludes an inactive enrollment from the eligible population", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [
          activeEnrollmentDoc("student-active"),
          activeEnrollmentDoc("student-inactive", { status: "transferred" }),
        ],
      });

      const result = await reconcileAssignmentRecipients(context, "teacherReconcile");

      expect(result).toEqual({ added: 1, alreadyCurrent: 0 });
      expect(mockRecipientCreationSet).toHaveBeenCalledTimes(1);
      expect(mockRecipientCreationSet).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: "student-active" }),
      );
    });

    it("excludes malformed and cross-class/cross-school enrollment rows, preserving the existing skip behavior exactly", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [
          activeEnrollmentDoc("student-good"),
          activeEnrollmentDoc(""),
          activeEnrollmentDoc("student-cross-class", { classId: "class-other" }),
          activeEnrollmentDoc("student-cross-school", { schoolId: "school-other" }),
        ],
      });

      const result = await reconcileAssignmentRecipients(context, "teacherReconcile");

      expect(result).toEqual({ added: 1, alreadyCurrent: 0 });
      expect(mockRecipientCreationSet).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: "student-good" }),
      );
    });

    it("running reconciliation again when all recipients are already canonical is a zero-write no-op", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [activeEnrollmentDoc("student-1"), activeEnrollmentDoc("student-2")],
      });
      seedExistingRecipient("student-1");
      seedExistingRecipient("student-2");

      const result = await reconcileAssignmentRecipients(context, "teacherReconcile");

      expect(result).toEqual({ added: 0, alreadyCurrent: 2 });
      expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    });

    it("stamps newly created recipients with exactly the source parameter it was called with", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [activeEnrollmentDoc("student-1")],
      });

      await reconcileAssignmentRecipients(context, "manualAddition");

      expect(mockRecipientCreationSet).toHaveBeenCalledWith(
        expect.objectContaining({ source: "manualAddition" }),
      );
    });

    // Preserves the exact pre-extraction partial-success semantics: the
    // ensure-write loop is concurrent (Promise.all), not transactional. One
    // student's integrity violation does not undo another, independent
    // student's already-completed write in the same call.
    it("preserves partial-success semantics: one integrity violation does not undo another student's already-completed write", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [activeEnrollmentDoc("student-good"), activeEnrollmentDoc("student-bad")],
      });
      seedExistingRecipient("student-bad", { schoolId: "wrong-school" });
      mockRecipientGet.mockImplementation((assignmentId: string, studentId: string) => {
        if (studentId === "student-bad") {
          return Promise.resolve({
            exists: true,
            data: () => ({
              assignmentId,
              studentId,
              schoolId: "wrong-school",
              districtId: DISTRICT_ID,
              status: "assigned",
            }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      await expect(
        reconcileAssignmentRecipients(context, "teacherReconcile"),
      ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });

      // student-good's independent write already completed before the
      // Promise.all rejected on student-bad's violation - it is not rolled
      // back, exactly as the pre-extraction inline implementation behaved.
      expect(mockRecipientCreationSet).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: "student-good" }),
      );
    });
  });

  describe("loadInitialRecipientPopulation", () => {
    it("returns unique, sorted student IDs from the active roster", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [
          activeEnrollmentDoc("student-b"),
          activeEnrollmentDoc("student-a"),
          activeEnrollmentDoc("student-b"),
          activeEnrollmentDoc("student-c"),
        ],
      });
      const result = await loadInitialRecipientPopulation(CLASS_ID, SCHOOL_ID);
      expect(result).toEqual(["student-a", "student-b", "student-c"]);
      expect(mockEnrollmentsWhere).toHaveBeenCalledWith(
        "classId",
        "==",
        CLASS_ID,
      );
    });

    it("excludes non-active, cross-class, cross-school, and malformed rows", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({
        docs: [
          activeEnrollmentDoc("student-good"),
          activeEnrollmentDoc("student-inactive", { status: "transferred" }),
          activeEnrollmentDoc("student-cross-class", { classId: "class-x" }),
          activeEnrollmentDoc("student-cross-school", { schoolId: "school-x" }),
          activeEnrollmentDoc(""),
          { id: "empty", data: () => undefined },
          activeEnrollmentDoc("student-withdrawn", { status: "withdrawn" }),
          activeEnrollmentDoc("student-archived", { status: "archived" }),
        ],
      });
      const result = await loadInitialRecipientPopulation(CLASS_ID, SCHOOL_ID);
      expect(result).toEqual(["student-good"]);
    });

    it("returns an empty array when no active enrollments exist", async () => {
      mockEnrollmentsGet.mockResolvedValueOnce({ docs: [] });
      const result = await loadInitialRecipientPopulation(CLASS_ID, SCHOOL_ID);
      expect(result).toEqual([]);
    });
  });
});
