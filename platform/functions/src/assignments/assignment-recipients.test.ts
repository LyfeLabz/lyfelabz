const mockEnrollmentsGet = jest.fn();
const mockEnrollmentsWhere = jest.fn(() => ({ get: mockEnrollmentsGet }));
const mockEnrollmentsCollectionRef = jest.fn(() => ({
  where: mockEnrollmentsWhere,
}));

const SERVER_TIMESTAMP_SENTINEL = { __sentinel: "serverTimestamp" } as const;

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

jest.mock("../shared", () => ({
  enrollmentsCollectionRef: mockEnrollmentsCollectionRef,
}));

import {
  buildRecipientCreationWrite,
  loadInitialRecipientPopulation,
} from "./assignment-recipients";

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
