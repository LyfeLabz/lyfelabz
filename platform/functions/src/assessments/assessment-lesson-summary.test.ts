import type { CallableRequest } from "firebase-functions/v2/https";

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

const mockRequireDistrictContext = jest.fn();

type Fixture = {
  id: string;
  data: Record<string, unknown>;
};

// The whole `assignments` collection (all teachers/schools/lessons). The
// production query filters teacherId/schoolId/status and the handler
// filters lessonSlug in memory, so tests can seed cross-owner and
// cross-lesson noise and prove it is excluded.
const assignmentsFixture: Fixture[] = [];
// Flat attempts collection keyed by assignmentId (production queries
// `attempts.where("assignmentId","==",id)`).
const attemptsFixture: Fixture[] = [];
// Recipients keyed by assignmentId -> rows (production reads the
// per-assignment `recipients` subcollection).
const recipientsByAssignment = new Map<string, Fixture[]>();

type Filter = { field: string; op: string; value: unknown };
type Query = {
  where: (field: string, op: string, value: unknown) => Query;
  get: () => Promise<{ docs: Array<{ id: string; data: () => unknown }> }>;
};

function matchesFilter(row: Fixture, f: Filter): boolean {
  if (f.op === "==") return row.data[f.field] === f.value;
  if (f.op === "in") {
    return Array.isArray(f.value) && f.value.includes(row.data[f.field]);
  }
  return true;
}

function makeQuery(source: Fixture[], filters: Filter[]): Query {
  return {
    where(field, op, value) {
      return makeQuery(source, [...filters, { field, op, value }]);
    },
    get: () => {
      const filtered = source.filter((row) =>
        filters.every((f) => matchesFilter(row, f)),
      );
      return Promise.resolve({
        docs: filtered.map((row) => ({ id: row.id, data: () => row.data })),
      });
    },
  };
}

const mockAssignmentsCollectionRef = jest.fn(() =>
  makeQuery(assignmentsFixture, []),
);
const mockAttemptsCollectionRef = jest.fn(() => makeQuery(attemptsFixture, []));
const mockAssignmentRecipientsCollectionRef = jest.fn(
  (assignmentId: string) => ({
    get: () =>
      Promise.resolve({
        docs: (recipientsByAssignment.get(assignmentId) ?? []).map((row) => ({
          id: row.id,
          data: () => row.data,
        })),
      }),
  }),
);

const mockLogInfo = jest.fn();

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    requireDistrictContext: mockRequireDistrictContext,
    assignmentsCollectionRef: mockAssignmentsCollectionRef,
    attemptsCollectionRef: mockAttemptsCollectionRef,
    assignmentRecipientsCollectionRef: mockAssignmentRecipientsCollectionRef,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import {
  __assessmentLessonSummaryHandler,
  aggregateLessonClassSummaries,
  aggregateLessonSummary,
  LESSON_SUMMARY_BATCH_MAX,
  type AssessmentLessonSummaryBatchResponse,
  type AssessmentLessonSummaryResponse,
  type LessonSummaryAssignmentInput,
} from "./assessment-lesson-summary";

// Single-lesson requests resolve to the single response shape.
const summarize = (
  request: CallableRequest<unknown>,
): Promise<AssessmentLessonSummaryResponse> =>
  __assessmentLessonSummaryHandler(request) as Promise<AssessmentLessonSummaryResponse>;
const summarizeBatch = (
  request: CallableRequest<unknown>,
): Promise<AssessmentLessonSummaryBatchResponse> =>
  __assessmentLessonSummaryHandler(request) as Promise<AssessmentLessonSummaryBatchResponse>;

const TEACHER_UID = "teacher-uid";
const OTHER_TEACHER_UID = "other-teacher-uid";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-1";
const LESSON_SLUG = "lesson_g7_earths-layers";
const OTHER_LESSON_SLUG = "lesson_g7_photosynthesis";

const CLASS_A = "class-a";
const CLASS_B = "class-b";

const S1 = "student-1";
const S2 = "student-2";
const S3 = "student-3";

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(data: unknown): CallableRequest<unknown> {
  return { data } as CallableRequest<unknown>;
}

function seedAssignment(
  assignmentId: string,
  overrides: Record<string, unknown> = {},
): void {
  assignmentsFixture.push({
    id: assignmentId,
    data: {
      classId: CLASS_A,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: LESSON_SLUG,
      mode: "classroom",
      status: "published",
      createdAt: { toMillis: () => 1_600_000_000_000 },
      ...overrides,
    },
  });
}

function seedRecipient(
  assignmentId: string,
  studentId: string,
  overrides: Record<string, unknown> = {},
  docIdOverride?: string,
): void {
  const rows = recipientsByAssignment.get(assignmentId) ?? [];
  rows.push({
    id: docIdOverride ?? studentId,
    data: {
      assignmentId,
      studentId,
      classId: CLASS_A,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      assignedAt: { toMillis: () => 1_600_000_000_000 },
      assignedBy: TEACHER_UID,
      source: "classPublication",
      status: "assigned",
      ...overrides,
    },
  });
  recipientsByAssignment.set(assignmentId, rows);
}

let attemptSeq = 0;
function seedAttempt(
  assignmentId: string,
  studentId: string,
  percentage: number,
  overrides: Record<string, unknown> = {},
  attemptIdOverride?: string,
): void {
  attemptSeq += 1;
  const attemptId = attemptIdOverride ?? `attempt-${attemptSeq}`;
  attemptsFixture.push({
    id: attemptId,
    data: {
      studentId,
      assignmentId,
      classId: CLASS_A,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      activityId: LESSON_SLUG,
      assessmentId: `assessment_${LESSON_SLUG}`,
      assessmentRevisionId: `assessment_${LESSON_SLUG}__r1`,
      attemptNumber: 1,
      score: percentage,
      maxScore: 100,
      percentage,
      responses: [],
      itemResults: [],
      idempotencyKey: attemptId,
      submittedAt: { toMillis: () => 1_600_000_100_000 + attemptSeq },
      ...overrides,
    },
  });
}

beforeEach(() => {
  assignmentsFixture.length = 0;
  attemptsFixture.length = 0;
  recipientsByAssignment.clear();
  attemptSeq = 0;
  mockRequireDistrictContext.mockReset();
  mockRequireDistrictContext.mockResolvedValue(VALID_DISTRICT_CONTEXT);
  mockLogInfo.mockReset();
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("assessmentLessonSummary - authorization", () => {
  it("refuses a non-teacher caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      role: "student",
    });
    await expect(
      __assessmentLessonSummaryHandler(makeRequest({ lessonSlug: LESSON_SLUG })),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("propagates the district-context gate failure", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("unauthenticated", "no"),
    );
    await expect(
      __assessmentLessonSummaryHandler(makeRequest({ lessonSlug: LESSON_SLUG })),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

describe("assessmentLessonSummary - request validation", () => {
  it("rejects a non-object payload", async () => {
    await expect(
      __assessmentLessonSummaryHandler(makeRequest(null)),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });

  it("rejects a missing lessonSlug", async () => {
    await expect(
      __assessmentLessonSummaryHandler(makeRequest({})),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });

  it("rejects an empty lessonSlug", async () => {
    await expect(
      __assessmentLessonSummaryHandler(makeRequest({ lessonSlug: "  " })),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });

  it("rejects a malformed lessonSlug", async () => {
    await expect(
      __assessmentLessonSummaryHandler(
        makeRequest({ lessonSlug: "not a/valid slug" }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });

  it.each([
    "teacherId",
    "schoolId",
    "districtId",
    "classId",
    "studentId",
    "assignmentId",
    "status",
    "includeDrafts",
    "groupBy",
    "aggregate",
    "filter",
  ])("rejects a forbidden owner-scoping key %s", async (key) => {
    await expect(
      __assessmentLessonSummaryHandler(
        makeRequest({ lessonSlug: LESSON_SLUG, [key]: "x" }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });
});

// ---------------------------------------------------------------------------
// Empty / zero-data
// ---------------------------------------------------------------------------

describe("assessmentLessonSummary - zero data", () => {
  it("returns an all-zero summary for a valid, never-assigned slug", async () => {
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res).toEqual({
      lessonSlug: LESSON_SLUG,
      classesAssigned: 0,
      students: 0,
      studentsCompleted: 0,
      completionPercentage: 0,
      averageBestPercentage: null,
      assignmentsConsidered: 0,
      classes: [],
    });
  });

  it("returns 0% completion and null average when assigned with no completions", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedRecipient("a1", S2);
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res).toMatchObject({
      classesAssigned: 1,
      students: 2,
      studentsCompleted: 0,
      completionPercentage: 0,
      averageBestPercentage: null,
      assignmentsConsidered: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Core semantics
// ---------------------------------------------------------------------------

describe("assessmentLessonSummary - core semantics", () => {
  it("aggregates a single published assignment", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedRecipient("a1", S2);
    seedAttempt("a1", S1, 80);
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res).toMatchObject({
      classesAssigned: 1,
      students: 2,
      studentsCompleted: 1,
      completionPercentage: 50,
      averageBestPercentage: 80,
      assignmentsConsidered: 1,
    });
  });

  it("counts a class assigned the same lesson twice only once", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedAssignment("a2", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedRecipient("a2", S1);
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res.classesAssigned).toBe(1);
    expect(res.assignmentsConsidered).toBe(2);
    expect(res.students).toBe(1);
  });

  // The load-bearing repeated-assignment scenario from the sprint brief.
  it("proves unique-student semantics across repeated assignments", async () => {
    // Class A / assignment #1
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1, { classId: CLASS_A });
    seedRecipient("a1", S2, { classId: CLASS_A });
    seedAttempt("a1", S1, 60, { classId: CLASS_A });
    // Class A / assignment #2
    seedAssignment("a2", { classId: CLASS_A });
    seedRecipient("a2", S1, { classId: CLASS_A });
    seedRecipient("a2", S2, { classId: CLASS_A });
    seedAttempt("a2", S1, 90, { classId: CLASS_A });
    seedAttempt("a2", S2, 70, { classId: CLASS_A });
    // Class B / assignment #3
    seedAssignment("a3", { classId: CLASS_B });
    seedRecipient("a3", S1, { classId: CLASS_B });
    seedRecipient("a3", S3, { classId: CLASS_B });
    seedAttempt("a3", S3, 80, { classId: CLASS_B });

    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res).toMatchObject({
      classesAssigned: 2,
      students: 3,
      studentsCompleted: 3,
      completionPercentage: 100,
      // S1 best 90, S2 best 70, S3 best 80 -> (90+70+80)/3 = 80
      averageBestPercentage: 80,
      assignmentsConsidered: 3,
    });
  });

  it("selects a student's best percentage across assignments", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedAssignment("a2", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedRecipient("a2", S1);
    seedAttempt("a1", S1, 55);
    seedAttempt("a2", S1, 95);
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res.studentsCompleted).toBe(1);
    expect(res.averageBestPercentage).toBe(95);
  });

  it("uses half-up rounding on completion and average", async () => {
    // 1 of 3 completed -> 33.33% -> 33; single completed score 66.4 -> 66
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedRecipient("a1", S2);
    seedRecipient("a1", S3);
    seedAttempt("a1", S1, 66.4);
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res.completionPercentage).toBe(33);
    expect(res.averageBestPercentage).toBe(66);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle scope
// ---------------------------------------------------------------------------

describe("assessmentLessonSummary - lifecycle scope", () => {
  it("includes a closed assignment as historical lesson performance", async () => {
    seedAssignment("a1", { classId: CLASS_A, status: "closed" });
    seedRecipient("a1", S1);
    seedAttempt("a1", S1, 70);
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res).toMatchObject({
      classesAssigned: 1,
      students: 1,
      studentsCompleted: 1,
      averageBestPercentage: 70,
      assignmentsConsidered: 1,
    });
  });

  it("excludes a draft assignment", async () => {
    seedAssignment("a1", { classId: CLASS_A, status: "draft" });
    seedRecipient("a1", S1);
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res.assignmentsConsidered).toBe(0);
    expect(res.students).toBe(0);
  });

  it("excludes an archived assignment", async () => {
    seedAssignment("a1", { classId: CLASS_A, status: "archived" });
    seedRecipient("a1", S1);
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res.assignmentsConsidered).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Isolation / authorization boundaries
// ---------------------------------------------------------------------------

describe("assessmentLessonSummary - isolation", () => {
  it("excludes another lesson's owned assignment", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedAttempt("a1", S1, 90);
    // Another lesson, same teacher/school - must not affect this summary.
    seedAssignment("other", {
      classId: CLASS_B,
      lessonSlug: OTHER_LESSON_SLUG,
    });
    seedRecipient("other", S2);
    seedAttempt("other", S2, 10, { activityId: OTHER_LESSON_SLUG });
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res).toMatchObject({
      classesAssigned: 1,
      students: 1,
      studentsCompleted: 1,
      averageBestPercentage: 90,
      assignmentsConsidered: 1,
    });
  });

  it("excludes another teacher's assignment of the same lesson", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedAttempt("a1", S1, 90);
    // Another teacher's assignment of the SAME lesson.
    seedAssignment("foreign", {
      classId: CLASS_B,
      teacherId: OTHER_TEACHER_UID,
    });
    seedRecipient("foreign", S2, { teacherId: OTHER_TEACHER_UID });
    seedAttempt("foreign", S2, 10, { teacherId: OTHER_TEACHER_UID });
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res).toMatchObject({
      classesAssigned: 1,
      students: 1,
      studentsCompleted: 1,
      averageBestPercentage: 90,
      assignmentsConsidered: 1,
    });
  });

  it("excludes an assignment from another school", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedAttempt("a1", S1, 90);
    seedAssignment("cross-school", {
      classId: CLASS_B,
      schoolId: OTHER_SCHOOL_ID,
    });
    seedRecipient("cross-school", S2, { schoolId: OTHER_SCHOOL_ID });
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res.assignmentsConsidered).toBe(1);
    expect(res.students).toBe(1);
  });

  it("drops a recipient row whose ownership fields do not match the caller", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    // Malformed recipient rows on the owned assignment.
    seedRecipient("a1", S2, { districtId: "other-district" });
    seedRecipient("a1", S3, { status: "revoked" });
    seedRecipient("a1", "mismatch", {}, "different-doc-id");
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res.students).toBe(1);
  });

  it("excludes an attempt by a student not in the frozen population", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedAttempt("a1", S1, 80);
    // Attempt by a non-recipient - must not count.
    seedAttempt("a1", S2, 100);
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res.students).toBe(1);
    expect(res.studentsCompleted).toBe(1);
    expect(res.averageBestPercentage).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Late recipients
// ---------------------------------------------------------------------------

describe("assessmentLessonSummary - late recipients", () => {
  it("includes a manually added recipient once in the population", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    // A late recipient added via the certified add flow (source differs).
    seedRecipient("a1", S2, { source: "manualAddition" });
    seedAttempt("a1", S2, 75);
    const res = await summarize(
      makeRequest({ lessonSlug: LESSON_SLUG }),
    );
    expect(res.students).toBe(2);
    expect(res.studentsCompleted).toBe(1);
    expect(res.averageBestPercentage).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Projection / no PII
// ---------------------------------------------------------------------------

describe("assessmentLessonSummary - projection", () => {
  it("returns numeric aggregates plus the caller's own classIds only (no student/attempt/teacher identifiers)", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedAttempt("a1", S1, 88);
    const res = await summarize(makeRequest({ lessonSlug: LESSON_SLUG }));
    expect(Object.keys(res).sort()).toEqual(
      [
        "assignmentsConsidered",
        "averageBestPercentage",
        "classes",
        "classesAssigned",
        "completionPercentage",
        "lessonSlug",
        "students",
        "studentsCompleted",
      ].sort(),
    );
    expect(res.classes).toHaveLength(1);
    expect(Object.keys(res.classes[0] ?? {}).sort()).toEqual(
      [
        "assignmentsConsidered",
        "averageBestPercentage",
        "classId",
        "completionPercentage",
        "students",
        "studentsCompleted",
      ].sort(),
    );
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(S1);
    expect(serialized).not.toContain('"a1"');
    expect(serialized).not.toContain("attempt-");
    expect(serialized).not.toContain(TEACHER_UID);
  });
});

// ---------------------------------------------------------------------------
// Class Results (per-class breakdown)
// ---------------------------------------------------------------------------

describe("assessmentLessonSummary - class results", () => {
  it("returns one row for a single assigned class matching the totals", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedRecipient("a1", S2);
    seedAttempt("a1", S1, 80);
    const res = await summarize(makeRequest({ lessonSlug: LESSON_SLUG }));
    expect(res.classes).toEqual([
      {
        classId: CLASS_A,
        students: 2,
        studentsCompleted: 1,
        completionPercentage: 50,
        averageBestPercentage: 80,
        assignmentsConsidered: 1,
      },
    ]);
  });

  it("breaks multiple classes out with each class's own reassignment history and best scores", async () => {
    // Class A: two occurrences; S1 improves 60 -> 90 on the reassignment
    // and then retakes lower (70); the best stays 90.
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1, { classId: CLASS_A });
    seedRecipient("a1", S2, { classId: CLASS_A });
    seedAttempt("a1", S1, 60, { classId: CLASS_A });
    seedAssignment("a2", { classId: CLASS_A });
    seedRecipient("a2", S1, { classId: CLASS_A });
    seedRecipient("a2", S2, { classId: CLASS_A });
    seedAttempt("a2", S1, 90, { classId: CLASS_A });
    seedAttempt("a2", S1, 70, { classId: CLASS_A, attemptNumber: 2 });
    // Class B: assigned, nobody submitted.
    seedAssignment("a3", { classId: CLASS_B });
    seedRecipient("a3", S3, { classId: CLASS_B });

    const res = await summarize(makeRequest({ lessonSlug: LESSON_SLUG }));
    expect(res.classes).toEqual([
      {
        classId: CLASS_A,
        students: 2,
        studentsCompleted: 1,
        completionPercentage: 50,
        averageBestPercentage: 90,
        assignmentsConsidered: 2,
      },
      {
        classId: CLASS_B,
        students: 1,
        studentsCompleted: 0,
        completionPercentage: 0,
        averageBestPercentage: null,
        assignmentsConsidered: 1,
      },
    ]);
    expect(res.classesAssigned).toBe(2);
  });

  it("never lists another teacher's or another school's class", async () => {
    seedAssignment("mine", { classId: CLASS_A });
    seedRecipient("mine", S1);
    seedAssignment("theirs", { classId: "class-x", teacherId: OTHER_TEACHER_UID });
    seedAssignment("elsewhere", { classId: "class-y", schoolId: OTHER_SCHOOL_ID });
    const res = await summarize(makeRequest({ lessonSlug: LESSON_SLUG }));
    expect(res.classes.map((c) => c.classId)).toEqual([CLASS_A]);
  });

  it("orders rows by ascending classId", () => {
    const rows = aggregateLessonClassSummaries([
      { assignmentId: "x", classId: "class-z", recipientStudentIds: [], attempts: [] },
      { assignmentId: "y", classId: "class-a", recipientStudentIds: [], attempts: [] },
    ]);
    expect(rows.map((r) => r.classId)).toEqual(["class-a", "class-z"]);
  });
});

// ---------------------------------------------------------------------------
// Batch (Unit Results)
// ---------------------------------------------------------------------------

describe("assessmentLessonSummary - batch", () => {
  it("answers every requested lesson from one owned-assignment query, in request order", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedAttempt("a1", S1, 75);
    seedAssignment("p1", { classId: CLASS_B, lessonSlug: OTHER_LESSON_SLUG });
    seedRecipient("p1", S2, { classId: CLASS_B });
    mockAssignmentsCollectionRef.mockClear();

    const res = await summarizeBatch(
      makeRequest({ lessonSlugs: [OTHER_LESSON_SLUG, LESSON_SLUG, "lesson_unassigned"] }),
    );
    expect(mockAssignmentsCollectionRef).toHaveBeenCalledTimes(1);
    expect(res.lessons.map((l) => l.lessonSlug)).toEqual([
      OTHER_LESSON_SLUG,
      LESSON_SLUG,
      "lesson_unassigned",
    ]);
    expect(res.lessons[0]?.classes).toEqual([
      expect.objectContaining({ classId: CLASS_B, students: 1, studentsCompleted: 0 }),
    ]);
    expect(res.lessons[1]).toMatchObject({
      studentsCompleted: 1,
      averageBestPercentage: 75,
      classes: [expect.objectContaining({ classId: CLASS_A, averageBestPercentage: 75 })],
    });
    expect(res.lessons[2]).toMatchObject({ classesAssigned: 0, classes: [] });
  });

  it("accepts exactly the cap and returns one entry per slug", async () => {
    const lessonSlugs = Array.from({ length: LESSON_SUMMARY_BATCH_MAX }, (_, i) => `lesson_${String(i)}`);
    const res = await summarizeBatch(makeRequest({ lessonSlugs }));
    expect(res.lessons).toHaveLength(LESSON_SUMMARY_BATCH_MAX);
  });

  it("counts duplicates against the cap before deduplicating (no oversized payload slips through)", async () => {
    await expect(
      __assessmentLessonSummaryHandler(
        makeRequest({ lessonSlugs: Array.from({ length: LESSON_SUMMARY_BATCH_MAX + 1 }, () => LESSON_SLUG) }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });

  it("returns, for each lesson, exactly the single-lesson response (calculations unchanged)", async () => {
    seedAssignment("a1", { classId: CLASS_A });
    seedRecipient("a1", S1);
    seedRecipient("a1", S2);
    seedAttempt("a1", S1, 60);
    seedAttempt("a1", S1, 90, { attemptNumber: 2 });
    seedAssignment("a2", { classId: CLASS_B });
    seedRecipient("a2", S3, { classId: CLASS_B });
    seedAttempt("a2", S3, 70, { classId: CLASS_B });
    seedAssignment("p1", { classId: CLASS_A, lessonSlug: OTHER_LESSON_SLUG });
    seedRecipient("p1", S2);
    seedAttempt("p1", S2, 40);
    const single = await summarize(makeRequest({ lessonSlug: LESSON_SLUG }));
    const other = await summarize(makeRequest({ lessonSlug: OTHER_LESSON_SLUG }));
    const batch = await summarizeBatch(makeRequest({ lessonSlugs: [LESSON_SLUG, OTHER_LESSON_SLUG] }));
    expect(batch.lessons).toEqual([single, other]);
    expect(single).toMatchObject({ students: 3, studentsCompleted: 2, completionPercentage: 67, averageBestPercentage: 80 });
  });

  it("deduplicates repeated slugs", async () => {
    const res = await summarizeBatch(makeRequest({ lessonSlugs: [LESSON_SLUG, LESSON_SLUG] }));
    expect(res.lessons).toHaveLength(1);
  });

  it.each([
    ["an empty list", { lessonSlugs: [] }],
    ["a non-array", { lessonSlugs: LESSON_SLUG }],
    ["a malformed slug", { lessonSlugs: ["../etc"] }],
    ["both shapes", { lessonSlug: LESSON_SLUG, lessonSlugs: [LESSON_SLUG] }],
    [
      "more than the batch maximum",
      {
        lessonSlugs: Array.from(
          { length: LESSON_SUMMARY_BATCH_MAX + 1 },
          (_, i) => `lesson_${String(i)}`,
        ),
      },
    ],
  ])("rejects %s", async (_label, data) => {
    await expect(__assessmentLessonSummaryHandler(makeRequest(data))).rejects.toMatchObject({
      code: "assignments.invalidRequest",
    });
  });

  it("still refuses forbidden scoping keys on a batch", async () => {
    await expect(
      __assessmentLessonSummaryHandler(
        makeRequest({ lessonSlugs: [LESSON_SLUG], classId: CLASS_A }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });
});

// ---------------------------------------------------------------------------
// Pure aggregator (deterministic, Firestore-free)
// ---------------------------------------------------------------------------

function attempt(
  id: string,
  studentId: string,
  percentage: number,
  extra: Partial<{
    attemptNumber: number;
    submittedMs: number;
    score: number;
    maxScore: number;
  }> = {},
): { id: string; data: never } {
  return {
    id,
    data: {
      studentId,
      percentage,
      score: extra.score ?? percentage,
      maxScore: extra.maxScore ?? 100,
      attemptNumber: extra.attemptNumber ?? 1,
      submittedAt: { toMillis: () => extra.submittedMs ?? 1_000 },
    } as never,
  };
}

describe("aggregateLessonSummary - pure semantics", () => {
  it("returns the empty aggregate for no assignments", () => {
    expect(aggregateLessonSummary([])).toEqual({
      classesAssigned: 0,
      students: 0,
      studentsCompleted: 0,
      completionPercentage: 0,
      averageBestPercentage: null,
      assignmentsConsidered: 0,
    });
  });

  it("dedups students and classes across repeated assignments", () => {
    const inputs: LessonSummaryAssignmentInput[] = [
      {
        assignmentId: "a1",
        classId: CLASS_A,
        recipientStudentIds: [S1, S2],
        attempts: [attempt("t1", S1, 60)],
      },
      {
        assignmentId: "a2",
        classId: CLASS_A,
        recipientStudentIds: [S1, S2],
        attempts: [attempt("t2", S1, 90), attempt("t3", S2, 70)],
      },
      {
        assignmentId: "a3",
        classId: CLASS_B,
        recipientStudentIds: [S1, S3],
        attempts: [attempt("t4", S3, 80)],
      },
    ];
    expect(aggregateLessonSummary(inputs)).toEqual({
      classesAssigned: 2,
      students: 3,
      studentsCompleted: 3,
      completionPercentage: 100,
      averageBestPercentage: 80,
      assignmentsConsidered: 3,
    });
  });

  it("excludes non-completed students from the average denominator", () => {
    const inputs: LessonSummaryAssignmentInput[] = [
      {
        assignmentId: "a1",
        classId: CLASS_A,
        recipientStudentIds: [S1, S2, S3],
        attempts: [attempt("t1", S1, 100)],
      },
    ];
    // Only S1 completed -> average is 100 (S2, S3 do NOT contribute a zero).
    expect(aggregateLessonSummary(inputs)).toMatchObject({
      students: 3,
      studentsCompleted: 1,
      completionPercentage: 33,
      averageBestPercentage: 100,
    });
  });

  it("is deterministic under an assignmentId tie-break for equal attempts", () => {
    // Identical percentage/attemptNumber/timestamp/attemptId across two
    // assignments -> the smaller assignmentId wins deterministically. The
    // selected percentage is identical either way, so the assertion is on
    // stability across input orderings.
    const base = (assignmentId: string): LessonSummaryAssignmentInput => ({
      assignmentId,
      classId: CLASS_A,
      recipientStudentIds: [S1],
      attempts: [attempt("same-id", S1, 80, { submittedMs: 500 })],
    });
    const forward = aggregateLessonSummary([base("a1"), base("a2")]);
    const reverse = aggregateLessonSummary([base("a2"), base("a1")]);
    expect(forward).toEqual(reverse);
    expect(forward.averageBestPercentage).toBe(80);
  });
});
