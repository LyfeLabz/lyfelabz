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
    assignmentRecipientsCollectionGroupRef: mockRecipientsCollectionGroupRef,
    assessmentSessionsCollectionRef: mockAssessmentSessionsCollectionRef,
    classDocRef: mockClassDocRef,
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
  classFixture.present = false;
  classFixture.data = null;
  mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
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
