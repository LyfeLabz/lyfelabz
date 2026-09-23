/* eslint-disable @typescript-eslint/require-await */
import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentsGet = jest.fn();
const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));

const mockEnrollmentsGet = jest.fn();
const mockEnrollmentsCollectionRef = jest.fn(() => ({
  where: jest.fn(() => ({ get: mockEnrollmentsGet })),
}));

const mockRecipientsGet = jest.fn();
const mockAssignmentRecipientsCollectionRef = jest.fn(() => ({
  get: mockRecipientsGet,
}));

const mockRequireDistrictContext = jest.fn();
const mockLogInfo = jest.fn();

// Historical Assignment Resolution, Implementation Slice 8. The real,
// UNMOCKED Slice 3 resolver (`./resolve-current-assignment`) is exercised
// directly by these two fakes, mirroring the same "genuine integration
// coverage over a hand-rolled stand-in" convention already used elsewhere
// in this domain (e.g. `assignments-current-recipients-reconcile.test.ts`
// leaving the resolver unmocked). `mockAssignmentDocRef` deliberately reads
// from the SAME `assignmentsFixture` array the existing collection-query
// mock already uses below, so a test that seeds an assignment via
// `seedAssignment` automatically makes it visible to the resolver's own
// per-id lookup too, with no separate fixture to keep in sync.
const pointerRegistry = new Map<string, { exists: boolean; data: () => unknown }>();
function pointerKey(classId: string, lessonSlug: string): string {
  return `${classId}/${lessonSlug}`;
}
const mockAssignmentsCurrentDocRef = jest.fn((classId: string, lessonSlug: string) => ({
  get: () =>
    Promise.resolve(
      pointerRegistry.get(pointerKey(classId, lessonSlug)) ?? {
        exists: false,
        data: () => undefined,
      },
    ),
}));
const mockAssignmentDocRef = jest.fn((assignmentId: string) => ({
  get: () => {
    const row = assignmentsFixture.find((r) => r.id === assignmentId);
    return Promise.resolve(
      row ? { exists: true, data: () => row.data } : { exists: false, data: () => undefined },
    );
  },
}));

function makeAssignmentsQuery(
  filters: Array<{ field: string; value: unknown }>,
) {
  return {
    where(field: string, _op: string, value: unknown) {
      return makeAssignmentsQuery([...filters, { field, value }]);
    },
    get: () => {
      mockAssignmentsGet(filters);
      const filtered = assignmentsFixture.filter((row) =>
        filters.every((f) => row.data[f.field] === f.value),
      );
      return Promise.resolve({
        docs: filtered.map((row) => ({
          id: row.id,
          data: () => row.data,
        })),
      });
    },
  };
}
const mockAssignmentsCollectionRef = jest.fn(() => makeAssignmentsQuery([]));

const assignmentsFixture: Array<{
  id: string;
  data: Record<string, unknown>;
}> = [];

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
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
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    assignmentsCollectionRef: mockAssignmentsCollectionRef,
    assignmentRecipientsCollectionRef: mockAssignmentRecipientsCollectionRef,
    assignmentsCurrentDocRef: mockAssignmentsCurrentDocRef,
    assignmentDocRef: mockAssignmentDocRef,
    classDocRef: mockClassDocRef,
    enrollmentsCollectionRef: mockEnrollmentsCollectionRef,
    requireDistrictContext: mockRequireDistrictContext,
  };
});

jest.mock("./assignment-recipients", () => ({
  isCanonicalRecipientData: jest.requireActual("./assignment-recipients")
    .isCanonicalRecipientData,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsLifecycleStateHandler } from "./assignments-lifecycle-state";

const TEACHER_UID = "teacher-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-abc";
const LESSON_SLUG = "lesson_g7_earths-layers";

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  overrides: { data?: unknown } = {},
): CallableRequest<unknown> {
  const data =
    overrides.data === undefined
      ? { classId: CLASS_ID, lessonSlug: LESSON_SLUG }
      : overrides.data;
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function classSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      title: "Period 1 Science",
      status: "active",
      ...overrides,
    }),
  };
}

function seedAssignment(
  assignmentId: string,
  overrides: Record<string, unknown> = {},
) {
  assignmentsFixture.push({
    id: assignmentId,
    data: {
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: LESSON_SLUG,
      status: "published",
      createdAt: {},
      publishedAt: { toMillis: () => 1700000000000 },
      ...overrides,
    },
  });
}

// Historical Assignment Resolution, Implementation Slice 8. Seeds a Current
// pointer document for (CLASS_ID, LESSON_SLUG) by default; every field can
// be overridden to model a malformed or cross-scope pointer.
function seedPointer(overrides: Record<string, unknown> = {}): void {
  pointerRegistry.set(pointerKey(CLASS_ID, LESSON_SLUG), {
    exists: true,
    data: () => ({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: "assign-1",
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      setAt: {},
      setBy: TEACHER_UID,
      source: "publish",
      ...overrides,
    }),
  });
}

function wireEnrollments(
  enrollments: Array<{
    studentId: string;
    classId?: string;
    schoolId?: string;
    status?: string;
  }>,
) {
  mockEnrollmentsGet.mockReset().mockResolvedValue({
    docs: enrollments.map((e) => ({
      id: `${e.classId ?? CLASS_ID}__${e.studentId}`,
      data: () => ({
        studentId: e.studentId,
        classId: e.classId ?? CLASS_ID,
        schoolId: e.schoolId ?? SCHOOL_ID,
        status: e.status ?? "active",
        enrolledAt: {},
      }),
    })),
  });
  mockEnrollmentsCollectionRef.mockReset().mockImplementation(() => ({
    where: jest.fn(() => ({ get: mockEnrollmentsGet })),
  }));
}

function wireRecipients(
  assignmentId: string,
  recipients: Array<{
    studentId: string;
    assignmentId?: string;
    classId?: string;
    teacherId?: string;
    schoolId?: string;
    districtId?: string;
    status?: string;
  }>,
) {
  (mockAssignmentRecipientsCollectionRef as jest.Mock).mockImplementation(
    (reqAssignmentId: string) => ({
      get: () =>
        Promise.resolve({
          docs:
            reqAssignmentId === assignmentId
              ? recipients.map((r) => ({
                  id: r.studentId,
                  data: () => ({
                    assignmentId: r.assignmentId ?? assignmentId,
                    studentId: r.studentId,
                    classId: r.classId ?? CLASS_ID,
                    teacherId: r.teacherId ?? TEACHER_UID,
                    schoolId: r.schoolId ?? SCHOOL_ID,
                    districtId: r.districtId ?? DISTRICT_ID,
                    assignedAt: {},
                    assignedBy: r.teacherId ?? TEACHER_UID,
                    source: "classPublication",
                    status: r.status ?? "assigned",
                  }),
                }))
              : [],
        }),
    }),
  );
}

function wireMultiAssignmentRecipients(
  recipientsByAssignment: Record<
    string,
    Array<{
      studentId: string;
      assignmentId?: string;
      classId?: string;
      teacherId?: string;
      schoolId?: string;
      districtId?: string;
      status?: string;
    }>
  >,
) {
  (mockAssignmentRecipientsCollectionRef as jest.Mock).mockImplementation(
    (reqAssignmentId: string) => ({
      get: () =>
        Promise.resolve({
          docs: (recipientsByAssignment[reqAssignmentId] ?? []).map((r) => ({
            id: r.studentId,
            data: () => ({
              assignmentId: r.assignmentId ?? reqAssignmentId,
              studentId: r.studentId,
              classId: r.classId ?? CLASS_ID,
              teacherId: r.teacherId ?? TEACHER_UID,
              schoolId: r.schoolId ?? SCHOOL_ID,
              districtId: r.districtId ?? DISTRICT_ID,
              assignedAt: {},
              assignedBy: r.teacherId ?? TEACHER_UID,
              source: "classPublication",
              status: r.status ?? "assigned",
            }),
          })),
        }),
    }),
  );
}

describe("assignmentsLifecycleState", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assignmentsFixture.length = 0;
    pointerRegistry.clear();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockClassGet.mockResolvedValue(classSnapshot());
    mockRecipientsGet.mockResolvedValue({ docs: [] });
    wireEnrollments([]);
  });

  // -------- Test 1: never assigned --------
  it("returns neverAssigned when no assignments exist for classId + lessonSlug", async () => {
    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("neverAssigned");
    expect(result.candidates).toEqual([]);
  });

  // -------- Test 2: one published, fully current --------
  it("returns onePublishedFullyCurrent when one published assignment has full coverage", async () => {
    seedAssignment("assign-1");
    wireEnrollments([
      { studentId: "student-1" },
      { studentId: "student-2" },
    ]);
    wireRecipients("assign-1", [
      { studentId: "student-1" },
      { studentId: "student-2" },
    ]);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("onePublishedFullyCurrent");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      assignmentId: "assign-1",
      status: "published",
      recipientCount: 2,
      activeEnrollmentCount: 2,
      missingRecipientCount: 0,
    });
  });

  // -------- Test 3: one published, missing one active recipient --------
  it("returns onePublishedMissingRecipients when one enrollment has no recipient", async () => {
    seedAssignment("assign-1");
    wireEnrollments([
      { studentId: "student-1" },
      { studentId: "student-2" },
      { studentId: "student-3" },
    ]);
    wireRecipients("assign-1", [
      { studentId: "student-1" },
      { studentId: "student-2" },
    ]);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("onePublishedMissingRecipients");
    expect(result.candidates[0].missingRecipientCount).toBe(1);
    expect(result.candidates[0].activeEnrollmentCount).toBe(3);
    expect(result.candidates[0].recipientCount).toBe(2);
  });

  // -------- Test 4: one published, missing multiple active recipients --------
  it("returns onePublishedMissingRecipients when multiple enrollments have no recipient", async () => {
    seedAssignment("assign-1");
    wireEnrollments([
      { studentId: "student-1" },
      { studentId: "student-2" },
      { studentId: "student-3" },
    ]);
    wireRecipients("assign-1", [{ studentId: "student-1" }]);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("onePublishedMissingRecipients");
    expect(result.candidates[0].missingRecipientCount).toBe(2);
  });

  // -------- Test 5: multiple published assignments --------
  it("returns multiplePublished and all candidates when two published assignments exist", async () => {
    seedAssignment("assign-1");
    seedAssignment("assign-2", {
      publishedAt: { toMillis: () => 1700000001000 },
    });
    wireEnrollments([{ studentId: "student-1" }]);
    wireMultiAssignmentRecipients({
      "assign-1": [{ studentId: "student-1" }],
      "assign-2": [{ studentId: "student-1" }],
    });

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("multiplePublished");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.assignmentId)).toEqual([
      "assign-1",
      "assign-2",
    ]);
  });

  // -------- Test 5b: no canonical selection when duplicates exist --------
  it("does not select a canonical candidate among multiple published assignments", async () => {
    seedAssignment("assign-1", {
      publishedAt: { toMillis: () => 1700000000000 },
    });
    seedAssignment("assign-2", {
      publishedAt: { toMillis: () => 1700000001000 },
    });
    wireEnrollments([{ studentId: "student-1" }]);
    wireMultiAssignmentRecipients({
      "assign-1": [{ studentId: "student-1" }],
      "assign-2": [],
    });

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("multiplePublished");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].missingRecipientCount).toBe(0);
    expect(result.candidates[1].missingRecipientCount).toBe(1);
  });

  // -------- Test 6: historical only --------
  it("returns historicalOnly when only closed assignments exist", async () => {
    seedAssignment("assign-1", { status: "closed" });

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("historicalOnly");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].status).toBe("closed");
  });

  // -------- Test 7: historical + one published --------
  it("determines state from the published assignment when both historical and published exist", async () => {
    seedAssignment("assign-old", { status: "closed" });
    seedAssignment("assign-new");
    wireEnrollments([{ studentId: "student-1" }]);
    wireRecipients("assign-new", [{ studentId: "student-1" }]);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("onePublishedFullyCurrent");
    expect(result.candidates).toHaveLength(2);
    const published = result.candidates.filter(
      (c) => c.status === "published",
    );
    expect(published).toHaveLength(1);
  });

  // -------- Test 8: malformed/noncanonical recipient does NOT count --------
  it("does not count a malformed recipient with mismatched schoolId as valid coverage", async () => {
    seedAssignment("assign-1");
    wireEnrollments([{ studentId: "student-1" }]);
    wireRecipients("assign-1", [
      { studentId: "student-1", schoolId: "wrong-school" },
    ]);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("onePublishedMissingRecipients");
    expect(result.candidates[0].recipientCount).toBe(0);
    expect(result.candidates[0].missingRecipientCount).toBe(1);
  });

  // -------- Test 9: inactive enrollment does NOT count as missing --------
  it("does not count an inactive enrollment toward missing recipients", async () => {
    seedAssignment("assign-1");
    wireEnrollments([
      { studentId: "student-1" },
      { studentId: "student-2", status: "withdrawn" },
    ]);
    wireRecipients("assign-1", [{ studentId: "student-1" }]);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("onePublishedFullyCurrent");
    expect(result.candidates[0].activeEnrollmentCount).toBe(1);
    expect(result.candidates[0].missingRecipientCount).toBe(0);
  });

  // -------- Test 10: enrollment in another class --------
  it("does not count a student enrolled in another class toward this class's coverage", async () => {
    seedAssignment("assign-1");
    wireEnrollments([
      { studentId: "student-1" },
      { studentId: "student-2", classId: "other-class" },
    ]);
    wireRecipients("assign-1", [{ studentId: "student-1" }]);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("onePublishedFullyCurrent");
    expect(result.candidates[0].activeEnrollmentCount).toBe(1);
  });

  // -------- Test 11: teacher cannot inspect another teacher's class --------
  it("rejects when the class belongs to another teacher", async () => {
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ teacherId: "other-teacher" }),
    );
    await expect(
      __assignmentsLifecycleStateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  // -------- Test 12: cross-school/cross-district access fails closed --------
  it("rejects when the class belongs to another school", async () => {
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ schoolId: "other-school" }),
    );
    await expect(
      __assignmentsLifecycleStateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("rejects when caller is a student (not a teacher)", async () => {
    mockRequireDistrictContext.mockResolvedValueOnce({
      ...VALID_DISTRICT_CONTEXT,
      role: "student",
    });
    await expect(
      __assignmentsLifecycleStateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  // -------- Test 13: no read operation writes recipients --------
  it("never calls recipient creation writes", async () => {
    seedAssignment("assign-1");
    wireEnrollments([{ studentId: "student-1" }]);
    wireRecipients("assign-1", []);

    await __assignmentsLifecycleStateHandler(makeRequest());
    // No creation mocks are even registered - if the callable tried to
    // write, it would throw an undefined function error.
  });

  // -------- Test 14: no Classroom API operation occurs --------
  // Implicit: no Classroom mocks exist. Any call would throw.

  // -------- Test 15: no assignment document is created or mutated --------
  it("does not mutate any assignment document", async () => {
    seedAssignment("assign-1");
    wireEnrollments([{ studentId: "student-1" }]);
    wireRecipients("assign-1", [{ studentId: "student-1" }]);

    const before = JSON.stringify(assignmentsFixture);
    await __assignmentsLifecycleStateHandler(makeRequest());
    expect(JSON.stringify(assignmentsFixture)).toBe(before);
  });

  // -------- Test 16: no heuristic selection when duplicates exist --------
  it("returns all candidates without selecting a canonical one even when coverage differs", async () => {
    seedAssignment("assign-1", {
      publishedAt: { toMillis: () => 1700000000000 },
    });
    seedAssignment("assign-2", {
      publishedAt: { toMillis: () => 1700000002000 },
    });
    seedAssignment("assign-3", {
      publishedAt: { toMillis: () => 1700000003000 },
    });
    wireEnrollments([{ studentId: "student-1" }]);
    wireMultiAssignmentRecipients({
      "assign-1": [{ studentId: "student-1" }],
      "assign-2": [{ studentId: "student-1" }],
      "assign-3": [],
    });

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("multiplePublished");
    expect(result.candidates).toHaveLength(3);
    expect(
      result.candidates.every((c) => c.status === "published"),
    ).toBe(true);
  });

  // -------- Additional edge cases --------

  it("excludes archived assignments from results", async () => {
    seedAssignment("assign-1", { status: "archived" });

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("neverAssigned");
    expect(result.candidates).toEqual([]);
  });

  it("excludes assignments owned by another teacher from results", async () => {
    seedAssignment("assign-1", { teacherId: "other-teacher" });

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("neverAssigned");
    expect(result.candidates).toEqual([]);
  });

  it("rejects missing classId in request", async () => {
    await expect(
      __assignmentsLifecycleStateHandler(
        makeRequest({ data: { lessonSlug: LESSON_SLUG } }),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("rejects missing lessonSlug in request", async () => {
    await expect(
      __assignmentsLifecycleStateHandler(
        makeRequest({ data: { classId: CLASS_ID } }),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("rejects when class does not exist", async () => {
    mockClassGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assignmentsLifecycleStateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.classNotFound" });
  });

  it("returns onePublishedFullyCurrent when no enrollments exist (zero coverage is fully current)", async () => {
    seedAssignment("assign-1");
    wireEnrollments([]);
    wireRecipients("assign-1", []);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("onePublishedFullyCurrent");
    expect(result.candidates[0].activeEnrollmentCount).toBe(0);
    expect(result.candidates[0].recipientCount).toBe(0);
    expect(result.candidates[0].missingRecipientCount).toBe(0);
  });

  it("includes draft assignments in candidates as historical-like", async () => {
    seedAssignment("assign-1", { status: "draft", publishedAt: undefined });

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("historicalOnly");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].status).toBe("draft");
    expect(result.candidates[0].publishedAt).toBeNull();
  });

  it("does not count a recipient with non-assigned status as valid coverage", async () => {
    seedAssignment("assign-1");
    wireEnrollments([{ studentId: "student-1" }]);
    wireRecipients("assign-1", [
      { studentId: "student-1", status: "removed" },
    ]);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("onePublishedMissingRecipients");
    expect(result.candidates[0].recipientCount).toBe(0);
    expect(result.candidates[0].missingRecipientCount).toBe(1);
  });

  it("does not count a recipient with mismatched districtId as valid coverage", async () => {
    seedAssignment("assign-1");
    wireEnrollments([{ studentId: "student-1" }]);
    wireRecipients("assign-1", [
      { studentId: "student-1", districtId: "wrong-district" },
    ]);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.state).toBe("onePublishedMissingRecipients");
    expect(result.candidates[0].recipientCount).toBe(0);
  });

  it("sorts candidates: published first, then closed, then draft, each by assignmentId", async () => {
    seedAssignment("assign-c", { status: "draft", publishedAt: undefined });
    seedAssignment("assign-b", { status: "closed" });
    seedAssignment("assign-a");
    wireEnrollments([]);
    wireRecipients("assign-a", []);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.candidates.map((c) => c.assignmentId)).toEqual([
      "assign-a",
      "assign-b",
      "assign-c",
    ]);
  });

  it("projects publishedAt as epoch-ms number for published assignments", async () => {
    seedAssignment("assign-1", {
      publishedAt: { toMillis: () => 1700000000000 },
    });
    wireEnrollments([]);
    wireRecipients("assign-1", []);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.candidates[0].publishedAt).toBe(1700000000000);
  });

  it("projects publishedAt as null when missing on published assignment", async () => {
    seedAssignment("assign-1", { publishedAt: undefined });
    wireEnrollments([]);
    wireRecipients("assign-1", []);

    const result = await __assignmentsLifecycleStateHandler(makeRequest());
    expect(result.candidates[0].publishedAt).toBeNull();
  });

  it("errors thrown are PlatformError instances", async () => {
    mockClassGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assignmentsLifecycleStateHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  // Historical Assignment Resolution, Implementation Slice 8. Current
  // resolution is an additive, independent dimension: it never changes
  // `state` or `candidates`, and neither of those ever changes it.
  describe("Current resolution (Slice 8)", () => {
    // 1. never assigned + no pointer
    it("never assigned + no pointer: state unchanged, Current unresolved/null", async () => {
      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.state).toBe("neverAssigned");
      expect(result.candidates).toEqual([]);
      expect(result.currentAssignmentId).toBeNull();
      expect(result.currentAssignmentResolution).toBe("unresolved");
    });

    // 2. one published + no pointer - critically, no heuristic inference
    it("one published + no pointer: lifecycle state unchanged, Current unresolved/null (no heuristic inference)", async () => {
      seedAssignment("assign-1");
      wireEnrollments([{ studentId: "student-1" }]);
      wireRecipients("assign-1", [{ studentId: "student-1" }]);

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.state).toBe("onePublishedFullyCurrent");
      expect(result.currentAssignmentId).toBeNull();
      expect(result.currentAssignmentResolution).toBe("unresolved");
    });

    // 3. multiple published + no pointer
    it("multiple published + no pointer: state multiplePublished, Current unresolved/null", async () => {
      seedAssignment("assign-1");
      seedAssignment("assign-2");
      wireEnrollments([]);

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.state).toBe("multiplePublished");
      expect(result.currentAssignmentId).toBeNull();
      expect(result.currentAssignmentResolution).toBe("unresolved");
    });

    // 4. multiple published + valid Current
    it("multiple published + valid Current: state remains multiplePublished, Current valid with exact pointer assignmentId", async () => {
      seedAssignment("assign-1");
      seedAssignment("assign-2");
      seedPointer({ assignmentId: "assign-2" });
      wireEnrollments([]);

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.state).toBe("multiplePublished");
      expect(result.currentAssignmentId).toBe("assign-2");
      expect(result.currentAssignmentResolution).toBe("valid");
    });

    // 5. one published + valid Current
    it("one published + valid Current: existing onePublished state unchanged, Current valid with assignmentId", async () => {
      seedAssignment("assign-1");
      seedPointer({ assignmentId: "assign-1" });
      wireEnrollments([{ studentId: "student-1" }]);
      wireRecipients("assign-1", [{ studentId: "student-1" }]);

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.state).toBe("onePublishedFullyCurrent");
      expect(result.currentAssignmentId).toBe("assign-1");
      expect(result.currentAssignmentResolution).toBe("valid");
    });

    // 6. pointer malformed
    it("pointer malformed: lifecycle state still computed normally, Current invalid/null", async () => {
      seedAssignment("assign-1");
      seedPointer({ source: "notARealSource" });
      wireEnrollments([{ studentId: "student-1" }]);
      wireRecipients("assign-1", [{ studentId: "student-1" }]);

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.state).toBe("onePublishedFullyCurrent");
      expect(result.currentAssignmentId).toBeNull();
      expect(result.currentAssignmentResolution).toBe("invalid");
    });

    // 7. pointer scope mismatch (class, lesson, teacher, school)
    it.each([
      ["class mismatch", { classId: "class-other" }],
      ["lesson mismatch", { lessonSlug: "lesson_other" }],
      ["teacher mismatch", { teacherId: "teacher-other" }],
      ["school mismatch", { schoolId: "school-other" }],
    ])("pointer scope mismatch (%s): Current invalid/null", async (_label, overrides) => {
      seedAssignment("assign-1");
      seedPointer(overrides);
      wireEnrollments([]);

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.currentAssignmentId).toBeNull();
      expect(result.currentAssignmentResolution).toBe("invalid");
    });

    // 8. pointer references missing assignment
    it("pointer references a missing assignment: Current invalid/null", async () => {
      seedPointer({ assignmentId: "assign-nonexistent" });
      wireEnrollments([]);

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.currentAssignmentId).toBeNull();
      expect(result.currentAssignmentResolution).toBe("invalid");
    });

    // 9. pointer references a non-published assignment: MANAGED BUT NO
    // LONGER OPERATIONAL (reassignment model) - reported as `inactive`, never
    // collapsed into `invalid` (fail-closed) or `unresolved` (legacy).
    it.each(["draft", "closed", "archived"] as const)(
      "pointer references a non-published (%s) assignment: Current inactive/null",
      async (status) => {
        seedAssignment("assign-1", { status });
        seedPointer({ assignmentId: "assign-1" });
        wireEnrollments([]);

        const result = await __assignmentsLifecycleStateHandler(makeRequest());
        expect(result.currentAssignmentId).toBeNull();
        expect(result.currentAssignmentResolution).toBe("inactive");
      },
    );

    // 10. historicalOnly + no pointer
    it("historicalOnly + no pointer: state historicalOnly, Current unresolved/null", async () => {
      seedAssignment("assign-1", { status: "closed" });

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.state).toBe("historicalOnly");
      expect(result.currentAssignmentId).toBeNull();
      expect(result.currentAssignmentResolution).toBe("unresolved");
    });

    // 11. historicalOnly + a closed Current (the "teacher closed Current"
    // lifecycle): managed-inactive, not a contradictory pointer.
    it("historicalOnly + pointer to the closed Current: state historicalOnly, Current inactive/null", async () => {
      seedAssignment("assign-1", { status: "closed" });
      seedPointer({ assignmentId: "assign-1" });

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.state).toBe("historicalOnly");
      expect(result.currentAssignmentId).toBeNull();
      expect(result.currentAssignmentResolution).toBe("inactive");
    });

    // 11b. Full managed lifecycle as the teacher experiences it: A is
    // published and Current; the teacher closes (or archives) A; the class
    // is managed-inactive (never unresolved legacy, never fail-closed, and
    // an older published occurrence is never resurrected as Current); the
    // teacher assigns B as new, whose publish advances the pointer to B; B is
    // Current and A stays historical, untouched.
    it.each(["closed", "archived"] as const)(
      "lifecycle: A Current -> A %s -> inactive (no resurrection) -> B assigned as new -> B Current, A historical",
      async (inactiveStatus) => {
        // An older published occurrence that must never be resurrected.
        seedAssignment("assign-older", { publishedAt: { toMillis: () => 1600000000000 } });
        seedAssignment("assign-A");
        seedPointer({ assignmentId: "assign-A" });
        wireEnrollments([]);

        const published = await __assignmentsLifecycleStateHandler(makeRequest());
        expect(published.currentAssignmentResolution).toBe("valid");
        expect(published.currentAssignmentId).toBe("assign-A");

        // Teacher closes/archives A: the pointer is preserved as-is.
        const a = assignmentsFixture.find((d) => d.id === "assign-A")!;
        a.data = { ...a.data, status: inactiveStatus };
        const inactive = await __assignmentsLifecycleStateHandler(makeRequest());
        expect(inactive.currentAssignmentResolution).toBe("inactive");
        expect(inactive.currentAssignmentId).toBeNull();
        expect(inactive.currentAssignmentId).not.toBe("assign-older");
        const pointerData = pointerRegistry.get(pointerKey(CLASS_ID, LESSON_SLUG))!.data() as {
          assignmentId: string;
        };
        expect(pointerData.assignmentId).toBe("assign-A");

        // "Assign as new": B is created and published through the normal
        // path, whose publish advances the pointer to B.
        seedAssignment("assign-B");
        seedPointer({ assignmentId: "assign-B" });
        const afterB = await __assignmentsLifecycleStateHandler(makeRequest());
        expect(afterB.currentAssignmentResolution).toBe("valid");
        expect(afterB.currentAssignmentId).toBe("assign-B");
        expect(a.data.status).toBe(inactiveStatus);
        const aCandidate = afterB.candidates.find((c) => c.assignmentId === "assign-A");
        if (inactiveStatus === "closed") {
          expect(aCandidate?.status).toBe("closed");
        } else {
          // Archived occurrences are excluded from candidates (existing contract).
          expect(aCandidate).toBeUndefined();
        }
      },
    );

    // 12. no heuristic selection, explicit
    it("one published candidate and no pointer never yields a non-null currentAssignmentId", async () => {
      seedAssignment("assign-only");
      wireEnrollments([]);

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(result.currentAssignmentId).toBeNull();
    });

    // 13. Current does not change lifecycle state - same fixture, with and
    // without a valid pointer, must produce identical state/candidates.
    it("identical fixture with vs. without a valid pointer produces identical state and candidates", async () => {
      seedAssignment("assign-1");
      seedAssignment("assign-2");
      wireEnrollments([]);

      const withoutPointer = await __assignmentsLifecycleStateHandler(makeRequest());

      seedPointer({ assignmentId: "assign-1" });
      const withPointer = await __assignmentsLifecycleStateHandler(makeRequest());

      expect(withPointer.state).toBe(withoutPointer.state);
      expect(withPointer.candidates).toEqual(withoutPointer.candidates);
      // Only the additive Current fields differ.
      expect(withoutPointer.currentAssignmentResolution).toBe("unresolved");
      expect(withPointer.currentAssignmentResolution).toBe("valid");
    });

    // 14. authorization before Current read
    it("wrong-owner class fails before Current is ever resolved", async () => {
      mockClassGet.mockResolvedValueOnce(classSnapshot({ teacherId: "someone-else" }));

      await expect(
        __assignmentsLifecycleStateHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.forbidden" });
      expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
    });

    it("cross-school class fails before Current is ever resolved", async () => {
      mockClassGet.mockResolvedValueOnce(classSnapshot({ schoolId: "school-other" }));

      await expect(
        __assignmentsLifecycleStateHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "assignments.forbidden" });
      expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
    });

    // 15. existing candidate contract preserved - no per-candidate Current flag
    it("candidate shape is unchanged: no per-candidate isCurrent field, even when Current is valid", async () => {
      seedAssignment("assign-1");
      seedPointer({ assignmentId: "assign-1" });
      wireEnrollments([{ studentId: "student-1" }]);
      wireRecipients("assign-1", [{ studentId: "student-1" }]);

      const result = await __assignmentsLifecycleStateHandler(makeRequest());
      expect(Object.keys(result.candidates[0]).sort()).toEqual(
        [
          "assignmentId",
          "title",
          "status",
          "publishedAt",
          "recipientCount",
          "activeEnrollmentCount",
          "missingRecipientCount",
        ].sort(),
      );
    });
  });
});
