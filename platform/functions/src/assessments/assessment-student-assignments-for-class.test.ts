import type { CallableRequest } from "firebase-functions/v2/https";

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

const mockRequireDistrictContext = jest.fn();
const mockLogInfo = jest.fn();

type Row = { id: string; data: Record<string, unknown> };

type Query = {
  where: (field: string, op: string, value: unknown) => Query;
  get: () => Promise<{ docs: Array<{ id: string; data: () => unknown }> }>;
};

function makeQuery(
  rows: Row[],
  filters: Array<{ field: string; op: string; value: unknown }> = [],
): Query {
  return {
    where(field, op, value) {
      return makeQuery(rows, [...filters, { field, op, value }]);
    },
    get: () => {
      const filtered = rows.filter((row) =>
        filters.every((f) => {
          if (f.op !== "==") return true;
          return row.data[f.field] === f.value;
        }),
      );
      return Promise.resolve({
        docs: filtered.map((row) => ({ id: row.id, data: () => row.data })),
      });
    },
  };
}

const recipientsFixture: Row[] = [];
const sessionsFixture: Row[] = [];

const mockRecipientsCollectionGroupRef = jest.fn(() =>
  makeQuery(recipientsFixture),
);
const mockAssessmentSessionsCollectionRef = jest.fn(() =>
  makeQuery(sessionsFixture),
);

const classFixture: { present: boolean; data: Record<string, unknown> | null } =
  { present: false, data: null };
const mockClassDocRef = jest.fn(() => ({
  get: () =>
    Promise.resolve({
      exists: classFixture.present,
      data: () => classFixture.data,
    }),
}));

const assignmentRegistry = new Map<
  string,
  { exists: boolean; data: () => unknown }
>();
const mockAssignmentDocRef = jest.fn((id: string) => ({
  get: () =>
    Promise.resolve(
      assignmentRegistry.get(id) ?? { exists: false, data: () => undefined },
    ),
}));

// Current pointers keyed `${classId}/${lessonSlug}`, read by the REAL
// canonical grouping primitive (`resolveCurrentOccurrenceGroup`), which this
// callable delegates to.
const pointerRegistry = new Map<string, Record<string, unknown>>();
const mockAssignmentsCurrentDocRef = jest.fn((classId: string, lessonSlug: string) => ({
  get: () => {
    const data = pointerRegistry.get(`${classId}/${lessonSlug}`);
    return Promise.resolve({ exists: data !== undefined, data: () => data });
  },
}));
// The primitive's single-field `classId` enumeration over the same
// assignment fixture the per-id reads use.
const mockAssignmentsCollectionRef = jest.fn(() =>
  makeQuery(
    Array.from(assignmentRegistry.entries())
      .filter(([, v]) => v.exists)
      .map(([id, v]) => ({ id, data: v.data() as Record<string, unknown> })),
  ),
);

// Teacher Units Expansion P1: unit projection seams. Default policy is
// "closed", so every pre-existing test sees `units: []`. Grant, enrollment
// and owner-user records back the REAL `authorizeStudentScopedRead` grant
// path for the support-teacher projection tests.
const mockReadUnitPolicy: jest.Mock = jest.fn(() => Promise.resolve("closed"));
jest.mock("../assignments/teacher-unit-projection-policy", () => ({
  readTeacherUnitProjectionPolicy: () => mockReadUnitPolicy(),
}));
const unitRows: Row[] = [];
const mockUnitQueryGet: jest.Mock = jest.fn();
const mockTeacherUnitsCollectionRef = jest.fn(() => {
  const filters: Array<[string, unknown]> = [];
  const query = {
    where: (field: string, _op: string, value: unknown) => {
      filters.push([field, value]);
      return query;
    },
    limit: () => query,
    get: () => mockUnitQueryGet(filters),
  };
  return query;
});
const docStore = new Map<string, Record<string, unknown>>();
const storeDocRef = (collection: string) => (id: string) => ({
  get: () => {
    const data = docStore.get(`${collection}/${id}`);
    return Promise.resolve({ exists: data !== undefined, data: () => data });
  },
});

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    requireDistrictContext: mockRequireDistrictContext,
    assignmentDocRef: mockAssignmentDocRef,
    assignmentsCurrentDocRef: mockAssignmentsCurrentDocRef,
    assignmentsCollectionRef: mockAssignmentsCollectionRef,
    assignmentRecipientsCollectionGroupRef: mockRecipientsCollectionGroupRef,
    assessmentSessionsCollectionRef: mockAssessmentSessionsCollectionRef,
    classDocRef: mockClassDocRef,
    teacherUnitsCollectionRef: mockTeacherUnitsCollectionRef,
    isTeacherUnitColor: jest.requireActual("../shared/types/teacher-unit").isTeacherUnitColor,
    studentSupportGrantIdFor: (c: string, s: string, g: string) => `${c}__${s}__${g}`,
    studentSupportGrantDocRef: storeDocRef("studentSupportGrants"),
    enrollmentDocRef: storeDocRef("enrollments"),
    userRecordDocRef: storeDocRef("users"),
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assessmentStudentAssignmentsForClassHandler } from "./assessment-student-assignments-for-class";

async function expectRejectedCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(PlatformError);
  await promise.catch((err: unknown) => {
    expect((err as PlatformError).code).toBe(code);
  });
}

const TEACHER_UID = "teacher-1";
const OTHER_TEACHER_UID = "teacher-2";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-a";
const STUDENT_ID = "student-1";

const VALID_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  data: Record<string, unknown> | undefined | null = {},
): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function seedClass(overrides: Partial<Record<string, unknown>> = {}): void {
  classFixture.present = true;
  classFixture.data = {
    teacherId: TEACHER_UID,
    schoolId: SCHOOL_ID,
    title: "6A Life Science",
    status: "active",
    createdAt: {},
    ...overrides,
  };
}

function seedRecipient(
  assignmentId: string,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  recipientsFixture.push({
    id: STUDENT_ID,
    data: {
      assignmentId,
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      assignedAt: {},
      assignedBy: TEACHER_UID,
      source: "classPublication",
      status: "assigned",
      ...overrides,
    },
  });
}

function seedAssignment(
  assignmentId: string,
  overrides: Partial<Record<string, unknown>> = {},
  exists = true,
): void {
  assignmentRegistry.set(assignmentId, {
    exists,
    data: () => ({
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: "lesson_engineering-design",
      status: "published",
      ...overrides,
    }),
  });
}

function seedSession(
  assignmentId: string,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  sessionsFixture.push({
    id: `session-${assignmentId}-${sessionsFixture.length}`,
    data: {
      studentId: STUDENT_ID,
      assignmentId,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      status: "live",
      startedAt: {},
      ...overrides,
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  recipientsFixture.length = 0;
  sessionsFixture.length = 0;
  assignmentRegistry.clear();
  pointerRegistry.clear();
  classFixture.present = false;
  classFixture.data = null;
  mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
  mockReadUnitPolicy.mockResolvedValue("closed");
  unitRows.length = 0;
  docStore.clear();
  mockUnitQueryGet.mockImplementation((filters: Array<[string, unknown]>) =>
    Promise.resolve({
      docs: unitRows
        .filter((row) => filters.every(([field, value]) => row.data[field] === value))
        .map((row) => ({ id: row.id, data: () => row.data })),
    }),
  );
});

describe("assessmentStudentAssignmentsForClass", () => {
  test("returns the expected assignment set for a student with mixed status", async () => {
    seedClass();
    seedRecipient("a1");
    seedRecipient("a2");
    seedAssignment("a1");
    seedAssignment("a2");
    seedSession("a2");

    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );

    expect(res.classId).toBe(CLASS_ID);
    expect(res.studentId).toBe(STUDENT_ID);
    expect(res.assignments).toEqual([
      { assignmentId: "a1", hasLiveSession: false },
      { assignmentId: "a2", hasLiveSession: true },
    ]);
  });

  test("returns an empty list for a student with no recipient rows", async () => {
    seedClass();
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
    expect(res.assignments).toEqual([]);
  });

  test("never returns score, percentage, or any field beyond assignmentId/hasLiveSession", async () => {
    seedClass();
    seedRecipient("a1");
    seedAssignment("a1");
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
    expect(Object.keys(res.assignments[0]).sort()).toEqual([
      "assignmentId",
      "hasLiveSession",
    ]);
  });

  test("excludes a recipient row belonging to a different class", async () => {
    seedClass();
    seedRecipient("a1", { classId: "other-class" });
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
    expect(res.assignments).toEqual([]);
  });

  test("excludes an assignment whose live document no longer matches class ownership", async () => {
    seedClass();
    seedRecipient("a1");
    seedAssignment("a1", { classId: "other-class" });
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
    expect(res.assignments).toEqual([]);
  });

  test("excludes an assignment document that no longer exists", async () => {
    seedClass();
    seedRecipient("a1");
    seedAssignment("a1", {}, false);
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
    expect(res.assignments).toEqual([]);
  });

  test("ignores a live session for an unverified/unmatched assignment", async () => {
    seedClass();
    // A session exists for an assignment the student is NOT a verified
    // recipient of (e.g. a stale/foreign session row); it must never
    // surface as a result row.
    seedSession("phantom-assignment");
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
    expect(res.assignments).toEqual([]);
  });

  test("a completed-looking session (status != live) never marks hasLiveSession true", async () => {
    seedClass();
    seedRecipient("a1");
    seedAssignment("a1");
    seedSession("a1", { status: "archived" });
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
    expect(res.assignments).toEqual([{ assignmentId: "a1", hasLiveSession: false }]);
  });

  test("refuses a non-teacher caller", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      role: "student",
    });
    await expectRejectedCode(
      __assessmentStudentAssignmentsForClassHandler(
        makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
      ),
      "role-forbidden",
    );
  });

  test("refuses a class owned by a different teacher", async () => {
    seedClass({ teacherId: OTHER_TEACHER_UID });
    await expectRejectedCode(
      __assessmentStudentAssignmentsForClassHandler(
        makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
      ),
      "classes.forbidden",
    );
  });

  test("refuses a class in a different school", async () => {
    seedClass({ schoolId: OTHER_SCHOOL_ID });
    await expectRejectedCode(
      __assessmentStudentAssignmentsForClassHandler(
        makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
      ),
      "classes.forbidden",
    );
  });

  test("refuses a missing class", async () => {
    await expectRejectedCode(
      __assessmentStudentAssignmentsForClassHandler(
        makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
      ),
      "classes.forbidden",
    );
  });

  test("refuses a request naming a studentId outside this teacher's class as if it were a normal empty result", async () => {
    // A studentId that belongs to some other class/teacher entirely simply
    // yields zero rows once the recipient filter is applied - never an
    // error, so the callable cannot be used to probe cross-owner existence.
    seedClass();
    seedRecipient("a1", { teacherId: OTHER_TEACHER_UID, schoolId: OTHER_SCHOOL_ID, districtId: "other-district" });
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
    expect(res.assignments).toEqual([]);
  });

  test("rejects a malformed classId", async () => {
    await expectRejectedCode(
      __assessmentStudentAssignmentsForClassHandler(
        makeRequest({ classId: "bad id!", studentId: STUDENT_ID }),
      ),
      "classes.invalidClassId",
    );
  });

  test("rejects a missing studentId", async () => {
    await expectRejectedCode(
      __assessmentStudentAssignmentsForClassHandler(
        makeRequest({ classId: CLASS_ID }),
      ),
      "assessmentStudentAssignments.invalidStudentId",
    );
  });

  test("rejects a forbidden owner-scoping key on the request", async () => {
    await expectRejectedCode(
      __assessmentStudentAssignmentsForClassHandler(
        makeRequest({
          classId: CLASS_ID,
          studentId: STUDENT_ID,
          teacherId: "spoofed",
        }),
      ),
      "assessmentStudentAssignments.invalidRequest",
    );
  });

  test("deduplicates a student who somehow has two recipient rows for the same assignment", async () => {
    seedClass();
    seedRecipient("a1");
    seedRecipient("a1");
    seedAssignment("a1");
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
    expect(res.assignments).toEqual([{ assignmentId: "a1", hasLiveSession: false }]);
  });

  test("assignments are sorted deterministically by assignmentId", async () => {
    seedClass();
    seedRecipient("z-assignment");
    seedRecipient("a-assignment");
    seedAssignment("z-assignment");
    seedAssignment("a-assignment");
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
    expect(res.assignments.map((a) => a.assignmentId)).toEqual([
      "a-assignment",
      "z-assignment",
    ]);
  });
});

// Reassignment model: additive `groups`, resolved through the REAL canonical
// occurrence-grouping primitive (pointer + class enumeration fixtures above).
describe("assessmentStudentAssignmentsForClass groups (Current occurrence grouping)", () => {
  const LESSON = "lesson_engineering-design";
  const ts = (ms: number) => ({ toMillis: () => ms });
  const seedPointer = (assignmentId: string, overrides: Record<string, unknown> = {}) =>
    pointerRegistry.set(`${CLASS_ID}/${LESSON}`, {
      classId: CLASS_ID,
      lessonSlug: LESSON,
      assignmentId,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      setBy: TEACHER_UID,
      source: "publish",
      setAt: {},
      ...overrides,
    });
  // Four occurrences of one lesson (the production shape): a1 closed, a2/a3
  // older published, a4 the Current.
  const seedFourOccurrences = () => {
    seedAssignment("a1", { status: "closed", title: "Engineering Design (1)", publishedAt: ts(1000) });
    seedAssignment("a2", { title: "Engineering Design (2)", publishedAt: ts(2000) });
    seedAssignment("a3", { title: "Engineering Design (3)", publishedAt: ts(3000) });
    seedAssignment("a4", { title: "Engineering Design", publishedAt: ts(4000) });
    for (const id of ["a1", "a2", "a3", "a4"]) seedRecipient(id);
  };
  const run = async () => {
    mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
    seedClass();
    return __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
  };

  test("valid Current: four occurrences form ONE group; Current supplies title/metadata; every occurrence id rides along", async () => {
    seedFourOccurrences();
    seedPointer("a4");
    const res = await run();
    expect(res.groups).toEqual([
      {
        resolution: "valid",
        lessonSlug: LESSON,
        operationalAssignmentId: "a4",
        assignmentIds: ["a1", "a2", "a3", "a4"],
        title: "Engineering Design",
        status: "published",
        publishedAt: 4000,
        hasLiveSession: false,
        isOperationalRecipient: true,
      },
    ]);
    // Backward compatible: the pre-existing per-assignment list is unchanged.
    expect(res.assignments.map((a) => a.assignmentId)).toEqual(["a1", "a2", "a3", "a4"]);
  });

  test("valid Current: hasLiveSession reflects ONLY the Current assignment", async () => {
    seedFourOccurrences();
    seedPointer("a4");
    seedSession("a2"); // live session on a superseded occurrence
    let res = await run();
    expect(res.groups[0]).toMatchObject({ resolution: "valid", hasLiveSession: false });
    seedSession("a4");
    res = await run();
    expect(res.groups[0]).toMatchObject({ resolution: "valid", hasLiveSession: true });
  });

  test("valid Current the student is not a recipient of: still one group, operational recipient false", async () => {
    seedAssignment("a1", { status: "closed", title: "Old" });
    seedAssignment("a4", { title: "Engineering Design" });
    seedRecipient("a1");
    seedPointer("a4");
    const res = await run();
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]).toMatchObject({
      resolution: "valid",
      operationalAssignmentId: "a4",
      assignmentIds: ["a1", "a4"],
      title: "Engineering Design",
      isOperationalRecipient: false,
    });
  });

  test("inactive (managed Current closed): one history group, no operational assignment, never live, no resurrection", async () => {
    seedAssignment("a1", { title: "Engineering Design (old)", publishedAt: ts(1000) }); // still published
    seedAssignment("a2", { status: "closed", title: "Engineering Design", publishedAt: ts(2000) });
    seedRecipient("a1");
    seedRecipient("a2");
    seedSession("a1");
    seedPointer("a2");
    const res = await run();
    expect(res.groups).toEqual([
      {
        resolution: "inactive",
        lessonSlug: LESSON,
        operationalAssignmentId: null,
        assignmentIds: ["a1", "a2"],
        title: "Engineering Design",
        status: "closed",
        publishedAt: 2000,
        hasLiveSession: false,
        isOperationalRecipient: false,
      },
    ]);
  });

  test("unresolved legacy (no pointer): no grouping, one entry per assignment with its own server title", async () => {
    seedAssignment("a1", { title: "Engineering Design", publishedAt: ts(1000) });
    seedAssignment("a2", { title: "Engineering Design", publishedAt: ts(2000) });
    seedRecipient("a1");
    seedRecipient("a2");
    seedSession("a2");
    const res = await run();
    expect(res.groups).toEqual([
      expect.objectContaining({ resolution: "unresolved", operationalAssignmentId: "a1", assignmentIds: ["a1"], title: "Engineering Design", publishedAt: 1000, hasLiveSession: false }),
      expect.objectContaining({ resolution: "unresolved", operationalAssignmentId: "a2", assignmentIds: ["a2"], title: "Engineering Design", publishedAt: 2000, hasLiveSession: true }),
    ]);
  });

  test.each([
    ["malformed pointer", { source: "bogus" }, "a2"],
    ["cross-school pointer", { schoolId: OTHER_SCHOOL_ID }, "a2"],
    ["cross-teacher pointer", { teacherId: OTHER_TEACHER_UID }, "a2"],
    ["pointer to a missing assignment", {}, "a-missing"],
  ])("invalid Current (%s) fails safe to unresolved per-assignment entries; nothing is chosen", async (_label, overrides, target) => {
    seedAssignment("a1", { title: "Engineering Design" });
    seedAssignment("a2", { title: "Engineering Design" });
    seedRecipient("a1");
    seedRecipient("a2");
    seedPointer(target, overrides);
    const res = await run();
    expect(res.groups.map((g) => [g.resolution, g.assignmentIds])).toEqual([
      ["unresolved", ["a1"]],
      ["unresolved", ["a2"]],
    ]);
  });

  test("group membership never includes another class's or another school's assignments of the same lesson", async () => {
    seedFourOccurrences();
    seedPointer("a4");
    seedAssignment("x-class", { classId: "class-other", title: "Engineering Design" });
    seedAssignment("x-school", { schoolId: OTHER_SCHOOL_ID, title: "Engineering Design" });
    seedAssignment("x-teacher", { teacherId: OTHER_TEACHER_UID, title: "Engineering Design" });
    const res = await run();
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]?.assignmentIds).toEqual(["a1", "a2", "a3", "a4"]);
  });

  test("separate lessons resolve independently (valid + unresolved together)", async () => {
    seedFourOccurrences();
    seedPointer("a4");
    seedAssignment("b1", { lessonSlug: "lesson_water-cycle", title: "Water Cycle" });
    seedRecipient("b1");
    const res = await run();
    expect(res.groups.map((g) => [g.resolution, g.lessonSlug, g.operationalAssignmentId])).toEqual([
      ["valid", LESSON, "a4"],
      ["unresolved", "lesson_water-cycle", "b1"],
    ]);
  });

  test("a student with no visible recipient rows gets no groups", async () => {
    seedFourOccurrences();
    recipientsFixture.length = 0;
    seedPointer("a4");
    const res = await run();
    expect(res.groups).toEqual([]);
    expect(res.assignments).toEqual([]);
  });
});

// Teacher Units Expansion P1: the class OWNER's current active units,
// projected onto this one student's verified groups, for the owner and for a
// support-grant holder, only after `authorizeStudentScopedRead` admits them.
describe("assessmentStudentAssignmentsForClass units (Teacher Units P1)", () => {
  const GRANTEE_UID = "teacher-support";
  const L1 = "lesson_alpha";
  const L2 = "lesson_beta";

  function seedUnit(id: string, overrides: Record<string, unknown> = {}): void {
    unitRows.push({
      id,
      data: {
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        grade: "7",
        title: `Title ${id}`,
        description: "SECRET DESCRIPTION",
        color: "teal",
        status: "active",
        archivedAt: null,
        createdAt: { toMillis: () => 1 },
        updatedAt: { toMillis: () => 1 },
        resourceIds: [],
        sortOrder: 1,
        revision: 1,
        ...overrides,
      },
    });
  }

  function seedWork(): void {
    seedClass({ grade: "7", block: "A" });
    seedRecipient("a1");
    seedRecipient("a2");
    seedAssignment("a1", { lessonSlug: L1 });
    seedAssignment("a2", { lessonSlug: L2 });
    seedUnit("u1", { resourceIds: ["lesson_unassigned", L2, L1] });
    seedUnit("u-other-teacher", { teacherId: OTHER_TEACHER_UID, sortOrder: 0, resourceIds: [L1, L2] });
    seedUnit("u-g6", { grade: "6", sortOrder: 0, resourceIds: [L1, L2] });
    seedUnit("u-arch", { status: "archived", sortOrder: 0, resourceIds: [L1, L2] });
    seedUnit("u-school-b", { schoolId: OTHER_SCHOOL_ID, sortOrder: 0, resourceIds: [L1, L2] });
  }

  function seedGrant(overrides: Record<string, unknown> = {}): void {
    docStore.set(`studentSupportGrants/${CLASS_ID}__${STUDENT_ID}__${GRANTEE_UID}`, {
      classId: CLASS_ID, studentId: STUDENT_ID, ownerTeacherId: TEACHER_UID, granteeUid: GRANTEE_UID,
      schoolId: SCHOOL_ID, districtId: DISTRICT_ID, status: "active", grantedAt: {}, grantedBy: TEACHER_UID,
      ...overrides,
    });
    docStore.set(`enrollments/${CLASS_ID}__${STUDENT_ID}`, {
      classId: CLASS_ID, studentId: STUDENT_ID, schoolId: SCHOOL_ID, status: "active",
    });
    docStore.set(`users/${TEACHER_UID}`, {
      authUid: TEACHER_UID, status: "active", role: "teacher", schoolId: SCHOOL_ID,
    });
  }

  const asGrantee = () =>
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_CONTEXT, uid: GRANTEE_UID });
  const call = () =>
    __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: STUDENT_ID }),
    );
  const EXPECTED_UNITS = [
    { unitId: "u1", title: "Title u1", color: "teal", assignmentIds: ["a2", "a1"] },
  ];

  beforeEach(() => {
    mockReadUnitPolicy.mockResolvedValue("enabled");
  });

  test("owner: only own, same-school, same-grade, active units; resource order; no unassigned data", async () => {
    seedWork();
    const res = await call();
    expect(res.units).toEqual(EXPECTED_UNITS);
    const json = JSON.stringify(res.units);
    expect(json).not.toContain("lesson_unassigned");
    expect(json).not.toContain("SECRET DESCRIPTION");
    const [filters] = mockUnitQueryGet.mock.calls[0] as [Array<[string, unknown]>];
    expect(filters).toEqual([["teacherId", TEACHER_UID], ["schoolId", SCHOOL_ID]]);
  });

  test("authorized support teacher sees exactly the owner's projection for this student", async () => {
    seedWork();
    seedGrant();
    asGrantee();
    const res = await call();
    expect(res.units).toEqual(EXPECTED_UNITS);
    expect(res.groups.map((g) => g.operationalAssignmentId)).toEqual(["a1", "a2"]);
  });

  test("revoked support grant -> classes.forbidden before any unit read", async () => {
    seedWork();
    seedGrant({ status: "revoked" });
    asGrantee();
    await expectRejectedCode(call(), "classes.forbidden");
    expect(mockReadUnitPolicy).not.toHaveBeenCalled();
    expect(mockUnitQueryGet).not.toHaveBeenCalled();
  });

  test("grant for a different student does not admit this student", async () => {
    seedWork();
    seedGrant({ studentId: "student-2" });
    asGrantee();
    await expectRejectedCode(call(), "classes.forbidden");
    expect(mockUnitQueryGet).not.toHaveBeenCalled();
  });

  test("unrelated teacher with no grant -> classes.forbidden, no unit read", async () => {
    seedWork();
    asGrantee();
    await expectRejectedCode(call(), "classes.forbidden");
    expect(mockUnitQueryGet).not.toHaveBeenCalled();
  });

  test("cross-school caller -> classes.forbidden, no unit read", async () => {
    seedWork();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_CONTEXT, schoolId: OTHER_SCHOOL_ID });
    await expectRejectedCode(call(), "classes.forbidden");
    expect(mockUnitQueryGet).not.toHaveBeenCalled();
  });

  test("a student outside the class yields no groups and no units", async () => {
    seedWork();
    const res = await __assessmentStudentAssignmentsForClassHandler(
      makeRequest({ classId: CLASS_ID, studentId: "student-elsewhere" }),
    );
    expect(res.groups).toEqual([]);
    expect(res.units).toEqual([]);
  });

  test("policy closed -> empty units, no unit read, groups unchanged", async () => {
    seedWork();
    const open = await call();
    mockReadUnitPolicy.mockResolvedValue("closed");
    mockUnitQueryGet.mockClear();
    const closed = await call();
    expect(closed.units).toEqual([]);
    expect(mockUnitQueryGet).not.toHaveBeenCalled();
    expect(closed.groups).toEqual(open.groups);
    expect(closed.assignments).toEqual(open.assignments);
  });

  test("class without a grade (pre-existing fixtures) -> empty units, no unit read", async () => {
    seedClass();
    seedRecipient("a1");
    seedAssignment("a1", { lessonSlug: L1 });
    seedUnit("u1", { resourceIds: [L1] });
    const res = await call();
    expect(res.units).toEqual([]);
    expect(mockUnitQueryGet).not.toHaveBeenCalled();
  });

  test("policy and unit reads overlap the recipient work (started right after authorization)", async () => {
    seedWork();
    let unitQueryStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      unitQueryStarted = resolve;
    });
    const base = mockUnitQueryGet.getMockImplementation() as (f: unknown) => unknown;
    mockUnitQueryGet.mockImplementation((filters: unknown) => {
      unitQueryStarted();
      return base(filters);
    });
    // The recipient query resolves only once the unit query was issued.
    mockRecipientsCollectionGroupRef.mockImplementationOnce(() => {
      const query = makeQuery(recipientsFixture);
      return {
        where: (field: string, op: string, value: unknown) => {
          const inner = query.where(field, op, value);
          return {
            where: inner.where,
            get: () =>
              Promise.race([
                started.then(() => inner.get()),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error("projection not concurrent")), 2000),
                ),
              ]),
          };
        },
        get: query.get,
      };
    });
    const res = await call();
    expect(res.units).toEqual(EXPECTED_UNITS);
  });

  test("a failure after authorization still surfaces its own error", async () => {
    seedWork();
    const boom = new Error("sessions unavailable");
    mockAssessmentSessionsCollectionRef.mockImplementationOnce(() => ({
      where: () => ({ where: () => { throw boom; }, get: () => Promise.reject(boom) }),
      get: () => Promise.reject(boom),
    }));
    await expect(call()).rejects.toBe(boom);
  });

  test("unit read failure degrades to empty units without failing the request", async () => {
    seedWork();
    mockUnitQueryGet.mockRejectedValueOnce(new Error("unavailable"));
    const res = await call();
    expect(res.units).toEqual([]);
    expect(res.groups).toHaveLength(2);
  });

  test("an inactive (history-only) group is placed whole", async () => {
    seedClass({ grade: "7", block: "A" });
    seedRecipient("old");
    seedRecipient("cur");
    seedAssignment("old", { lessonSlug: L1 });
    seedAssignment("cur", { lessonSlug: L1, status: "closed" });
    pointerRegistry.set(`${CLASS_ID}/${L1}`, {
      classId: CLASS_ID, lessonSlug: L1, assignmentId: "cur", teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID, setAt: {}, setBy: TEACHER_UID, source: "teacherResolution",
    });
    seedUnit("u1", { resourceIds: [L1] });
    const res = await call();
    expect(res.groups).toEqual([expect.objectContaining({ resolution: "inactive", assignmentIds: ["cur", "old"] })]);
    expect(res.units).toEqual([expect.objectContaining({ unitId: "u1", assignmentIds: ["cur", "old"] })]);
  });
});
