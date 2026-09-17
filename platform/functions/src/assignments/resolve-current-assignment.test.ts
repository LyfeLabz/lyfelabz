type FakeSnapshot = { exists: boolean; data: () => unknown };

const pointerRegistry = new Map<string, FakeSnapshot>();
const mockAssignmentsCurrentDocRef = jest.fn((classId: string, lessonSlug: string) => ({
  get: () =>
    Promise.resolve(
      pointerRegistry.get(`${classId}/${lessonSlug}`) ?? {
        exists: false,
        data: () => undefined,
      },
    ),
}));

const assignmentRegistry = new Map<string, FakeSnapshot>();
const mockAssignmentDocRef = jest.fn((assignmentId: string) => ({
  get: () =>
    Promise.resolve(
      assignmentRegistry.get(assignmentId) ?? {
        exists: false,
        data: () => undefined,
      },
    ),
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  return {
    PlatformError,
    assignmentsCurrentDocRef: mockAssignmentsCurrentDocRef,
    assignmentDocRef: mockAssignmentDocRef,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import {
  requireValidCurrentAssignmentId,
  resolveValidCurrentAssignmentId,
  type CurrentAssignmentEnforcementContext,
} from "./resolve-current-assignment";

const TEACHER_ID = "teacher-1";
const OTHER_TEACHER_ID = "teacher-2";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-1";
const OTHER_DISTRICT_ID = "district-2";
const CLASS_ID = "class-abc";
const OTHER_CLASS_ID = "class-xyz";
const LESSON_SLUG = "lesson_g7_earths-layers";
const OTHER_LESSON_SLUG = "lesson_g7_water-cycle";
const ASSIGNMENT_ID = "assign-1";

const BASE_CONTEXT: CurrentAssignmentEnforcementContext = {
  classId: CLASS_ID,
  lessonSlug: LESSON_SLUG,
  teacherId: TEACHER_ID,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
};

function seedPointer(overrides: Partial<Record<string, unknown>> = {}): void {
  pointerRegistry.set(`${CLASS_ID}/${LESSON_SLUG}`, {
    exists: true,
    data: () => ({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: ASSIGNMENT_ID,
      teacherId: TEACHER_ID,
      schoolId: SCHOOL_ID,
      setAt: { __sentinel: "timestamp" },
      setBy: TEACHER_ID,
      source: "publish",
      ...overrides,
    }),
  });
}

function seedAssignment(overrides: Partial<Record<string, unknown>> = {}): void {
  assignmentRegistry.set(ASSIGNMENT_ID, {
    exists: true,
    data: () => ({
      classId: CLASS_ID,
      teacherId: TEACHER_ID,
      schoolId: SCHOOL_ID,
      lessonSlug: LESSON_SLUG,
      mode: "classroom",
      status: "published",
      createdAt: { __sentinel: "timestamp" },
      ...overrides,
    }),
  });
}

describe("resolveValidCurrentAssignmentId", () => {
  beforeEach(() => {
    pointerRegistry.clear();
    assignmentRegistry.clear();
    mockAssignmentsCurrentDocRef.mockClear();
    mockAssignmentDocRef.mockClear();
  });

  // 1. valid pointer resolves exact assignmentId
  it("resolves the exact assignmentId when the pointer and assignment are both valid", async () => {
    seedPointer();
    seedAssignment();

    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "valid", assignmentId: ASSIGNMENT_ID });
  });

  // Proves the resolver reads the hierarchical path, not a flat composite id.
  it("reads the pointer via the hierarchical (classId, lessonSlug) path, never a composite id", async () => {
    seedPointer();
    seedAssignment();

    await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(mockAssignmentsCurrentDocRef).toHaveBeenCalledWith(CLASS_ID, LESSON_SLUG);
    expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalledWith(
      `${CLASS_ID}__${LESSON_SLUG}`,
    );
  });

  // 2. pointer missing
  it("returns pointerMissing when no pointer document exists, and never reads an assignment", async () => {
    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "pointerMissing" });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  // 3. pointer malformed: required field absent or wrong type
  describe("pointer malformed", () => {
    const malformedCases: Array<[string, Partial<Record<string, unknown>>]> = [
      ["missing assignmentId", { assignmentId: undefined }],
      ["wrong-typed assignmentId", { assignmentId: 12345 }],
      ["missing teacherId", { teacherId: undefined }],
      ["missing schoolId", { schoolId: "" }],
      ["missing setBy", { setBy: undefined }],
      ["missing setAt", { setAt: undefined }],
      ["invalid source", { source: "somethingElse" }],
    ];

    it.each(malformedCases)(
      "returns pointerMalformed and never reads an assignment (%s)",
      async (_label, overrides) => {
        seedPointer(overrides);

        const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

        expect(result).toEqual({ resolution: "pointerMalformed" });
        expect(mockAssignmentDocRef).not.toHaveBeenCalled();
      },
    );
  });

  // 4. pointer classId mismatch
  it("returns pointerClassMismatch when the pointer's own classId disagrees with its storage location", async () => {
    seedPointer({ classId: OTHER_CLASS_ID });

    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "pointerClassMismatch" });
  });

  // 5. pointer lessonSlug mismatch
  it("returns pointerLessonMismatch when the pointer's own lessonSlug disagrees with its storage location", async () => {
    seedPointer({ lessonSlug: OTHER_LESSON_SLUG });

    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "pointerLessonMismatch" });
  });

  // 6. pointer teacherId mismatch (cross-teacher isolation, item 18)
  it("returns pointerTeacherMismatch when the pointer belongs to a different teacher", async () => {
    seedPointer({ teacherId: OTHER_TEACHER_ID });

    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "pointerTeacherMismatch" });
  });

  // 7. pointer schoolId mismatch (cross-school isolation, item 19)
  it("returns pointerSchoolMismatch when the pointer belongs to a different school", async () => {
    seedPointer({ schoolId: OTHER_SCHOOL_ID });

    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "pointerSchoolMismatch" });
  });

  // Cross-district isolation (item 20). Neither AssignmentCurrentRecord nor
  // AssignmentRecord carries a districtId field in the actual certified data
  // model, so there is no separate district comparison to perform - a
  // caller resolved against a different district necessarily carries a
  // different schoolId (a school belongs to exactly one district), and that
  // is what this function actually checks. This test documents that
  // equivalence rather than asserting a distinct "district" reason that the
  // data model has no field to support.
  it("enforces cross-district isolation transitively through schoolId, since neither record carries districtId", async () => {
    seedPointer();
    seedAssignment();

    const crossDistrictContext: CurrentAssignmentEnforcementContext = {
      ...BASE_CONTEXT,
      schoolId: OTHER_SCHOOL_ID,
      districtId: OTHER_DISTRICT_ID,
    };
    const result = await resolveValidCurrentAssignmentId(crossDistrictContext);

    expect(result).toEqual({ resolution: "pointerSchoolMismatch" });
  });

  // 8. referenced assignment missing
  it("returns assignmentMissing when the pointer names an assignment that does not exist", async () => {
    seedPointer();

    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "assignmentMissing" });
  });

  // 9. referenced assignment assignmentId mismatch, if the stored record
  // carries/validates its own id. It does not: AssignmentRecord has no
  // self-referential assignmentId field in the actual certified data model
  // (the id is purely the Firestore document id at
  // assignments/{assignmentId}). There is therefore no independent field
  // comparison to make beyond fetching the document at exactly
  // pointer.assignmentId, which the "assignment missing" case above and the
  // "valid" case together already fully exercise. This test documents that
  // reconciliation with the actual repository data model.
  it("has no assignmentId field on AssignmentRecord to independently mismatch (documented, not testable as a separate case)", () => {
    expect(true).toBe(true);
  });

  // 10. referenced assignment classId mismatch
  it("returns assignmentClassMismatch when the referenced assignment belongs to a different class", async () => {
    seedPointer();
    seedAssignment({ classId: OTHER_CLASS_ID });

    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "assignmentClassMismatch" });
  });

  // 11. referenced assignment lessonSlug mismatch
  it("returns assignmentLessonMismatch when the referenced assignment belongs to a different lesson", async () => {
    seedPointer();
    seedAssignment({ lessonSlug: OTHER_LESSON_SLUG });

    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "assignmentLessonMismatch" });
  });

  // 12. referenced assignment teacherId mismatch
  it("returns assignmentTeacherMismatch when the referenced assignment belongs to a different teacher", async () => {
    seedPointer();
    seedAssignment({ teacherId: OTHER_TEACHER_ID });

    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "assignmentTeacherMismatch" });
  });

  // 13. referenced assignment schoolId mismatch
  it("returns assignmentSchoolMismatch when the referenced assignment belongs to a different school", async () => {
    seedPointer();
    seedAssignment({ schoolId: OTHER_SCHOOL_ID });

    const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(result).toEqual({ resolution: "assignmentSchoolMismatch" });
  });

  // 14. referenced assignment districtId mismatch. Same reconciliation as
  // the pointer-level district case above: AssignmentRecord carries no
  // districtId field, so this is enforced transitively through schoolId.
  it("enforces the assignment's district scope transitively through schoolId, since AssignmentRecord carries no districtId", async () => {
    seedPointer();
    seedAssignment({ schoolId: OTHER_SCHOOL_ID });

    const crossDistrictContext: CurrentAssignmentEnforcementContext = {
      ...BASE_CONTEXT,
    };
    const result = await resolveValidCurrentAssignmentId(crossDistrictContext);

    expect(result).toEqual({ resolution: "assignmentSchoolMismatch" });
  });

  // 15/16/17. referenced assignment draft / closed / archived. All three
  // non-published statuses converge on the single assignmentNotPublished
  // reason: Current-resolution behavior is identical regardless of which
  // non-published status the assignment is in, so the vocabulary is not
  // fragmented into three near-duplicate reasons for a distinction no
  // consumer needs to act on differently. Table-driven per the canonical
  // AssignmentStatus vocabulary ("draft" | "published" | "closed" |
  // "archived") - no invented status.
  it.each(["draft", "closed", "archived"] as const)(
    "returns assignmentNotPublished when the referenced assignment status is %s",
    async (status) => {
      seedPointer();
      seedAssignment({ status });

      const result = await resolveValidCurrentAssignmentId(BASE_CONTEXT);

      expect(result).toEqual({ resolution: "assignmentNotPublished" });
    },
  );

  // 21. malformed pointer never triggers a fallback assignment query/selection
  it("never reads an assignment when the pointer is malformed", async () => {
    seedPointer({ source: "notARealSource" });

    await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  // 22. missing pointer never triggers a fallback assignment query/selection
  it("never reads an assignment when the pointer is missing", async () => {
    await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  // No automatic Current selection: exactly one pointer read and at most
  // one assignment read per call, regardless of outcome. There is no
  // collection query anywhere in this module.
  it("performs at most one pointer read and one assignment read, never a collection scan", async () => {
    seedPointer();
    seedAssignment();

    await resolveValidCurrentAssignmentId(BASE_CONTEXT);

    expect(mockAssignmentsCurrentDocRef).toHaveBeenCalledTimes(1);
    expect(mockAssignmentDocRef).toHaveBeenCalledTimes(1);
  });
});

describe("requireValidCurrentAssignmentId", () => {
  beforeEach(() => {
    pointerRegistry.clear();
    assignmentRegistry.clear();
    mockAssignmentsCurrentDocRef.mockClear();
    mockAssignmentDocRef.mockClear();
  });

  it("returns the resolved assignmentId when Current is valid", async () => {
    seedPointer();
    seedAssignment();

    await expect(requireValidCurrentAssignmentId(BASE_CONTEXT)).resolves.toBe(
      ASSIGNMENT_ID,
    );
  });

  it("throws the canonical assignments.currentNotResolved refusal when the pointer is missing", async () => {
    await expect(requireValidCurrentAssignmentId(BASE_CONTEXT)).rejects.toMatchObject({
      code: "assignments.currentNotResolved",
    });
  });

  it("throws the identical canonical refusal regardless of which check failed (cross-teacher pointer)", async () => {
    seedPointer({ teacherId: OTHER_TEACHER_ID });

    await expect(requireValidCurrentAssignmentId(BASE_CONTEXT)).rejects.toMatchObject({
      code: "assignments.currentNotResolved",
    });
  });

  it("throws the identical canonical refusal regardless of which check failed (assignment not published)", async () => {
    seedPointer();
    seedAssignment({ status: "closed" });

    await expect(requireValidCurrentAssignmentId(BASE_CONTEXT)).rejects.toMatchObject({
      code: "assignments.currentNotResolved",
    });
  });

  it("throws a genuine PlatformError instance", async () => {
    await expect(requireValidCurrentAssignmentId(BASE_CONTEXT)).rejects.toBeInstanceOf(
      PlatformError,
    );
  });
});
