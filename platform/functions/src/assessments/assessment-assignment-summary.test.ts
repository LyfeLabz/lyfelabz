import type { CallableRequest } from "firebase-functions/v2/https";

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

const mockRequireDistrictContext = jest.fn();

type Fixture = {
  id: string;
  data: Record<string, unknown>;
};

const attemptsFixture: Fixture[] = [];
const sessionsFixture: Fixture[] = [];
const recipientsFixture: Fixture[] = [];
// Historical enrollment fixture is preserved so tests can prove that
// current-active-roster state does NOT affect the summary population under
// the Sprint 12E Slice 2C migration. Nothing in the production code reads
// enrollments any more; the mock is only used to construct realistic
// roster-change scenarios inside a single test.
const enrollmentsFixture: Fixture[] = [];

const assignmentFixture: {
  present: boolean;
  data: Record<string, unknown> | null;
} = { present: false, data: null };

const classFixture: {
  present: boolean;
  data: Record<string, unknown> | null;
} = { present: false, data: null };

type Filter = { field: string; op: string; value: unknown };
type Query = {
  where: (field: string, op: string, value: unknown) => Query;
  get: () => Promise<{ docs: Array<{ id: string; data: () => unknown }> }>;
};

function makeQuery(source: Fixture[], filters: Filter[]): Query {
  return {
    where(field, op, value) {
      return makeQuery(source, [...filters, { field, op, value }]);
    },
    get: () => {
      const filtered = source.filter((row) =>
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

const mockAttemptsCollectionRef = jest.fn(() =>
  makeQuery(attemptsFixture, []),
);
const mockAssessmentSessionsCollectionRef = jest.fn(() =>
  makeQuery(sessionsFixture, []),
);
const mockAssignmentRecipientsCollectionRef = jest.fn(() =>
  makeQuery(recipientsFixture, []),
);

const mockAssignmentDocRef = jest.fn((): {
  get: () => Promise<{ exists: boolean; data: () => unknown }>;
} => ({
  get: () =>
    Promise.resolve({
      exists: assignmentFixture.present,
      data: () => assignmentFixture.data,
    }),
}));

const mockClassDocRef = jest.fn((): {
  get: () => Promise<{ exists: boolean; data: () => unknown }>;
} => ({
  get: () =>
    Promise.resolve({
      exists: classFixture.present,
      data: () => classFixture.data,
    }),
}));

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
    attemptsCollectionRef: mockAttemptsCollectionRef,
    assessmentSessionsCollectionRef: mockAssessmentSessionsCollectionRef,
    assignmentRecipientsCollectionRef: mockAssignmentRecipientsCollectionRef,
    assignmentDocRef: mockAssignmentDocRef,
    classDocRef: mockClassDocRef,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import {
  __assessmentAssignmentSummaryHandler,
  selectHighestCompletedAttempt,
} from "./assessment-assignment-summary";

const TEACHER_UID = "teacher-uid";
const OTHER_TEACHER_UID = "other-teacher-uid";
const STUDENT_A = "student-a";
const STUDENT_B = "student-b";
const STUDENT_C = "student-c";
const STUDENT_D = "student-d";
const OUTSIDE_STUDENT = "student-outside";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-1";
const OTHER_DISTRICT_ID = "district-2";
const CLASS_ID = "class-abc";
const OTHER_CLASS_ID = "class-xyz";
const ASSIGNMENT_ID = "assign-1";
const OTHER_ASSIGNMENT_ID = "assign-2";
const LESSON_SLUG = "lesson_g7_earths-layers";
const ACTIVITY_ID = LESSON_SLUG;
const ASSESSMENT_ID = `assessment_${LESSON_SLUG}`;
const REVISION_ID = `assessment_${LESSON_SLUG}__r1`;

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function seedOwnedActiveClass(overrides: Record<string, unknown> = {}) {
  classFixture.present = true;
  classFixture.data = {
    teacherId: TEACHER_UID,
    schoolId: SCHOOL_ID,
    title: "Grade 7 Block A",
    grade: "7",
    block: "A",
    joinCode: "ABCDEF",
    status: "active",
    createdAt: { toMillis: () => 1_600_000_000_000 },
    ...overrides,
  };
}

function seedOwnedAssignment(overrides: Record<string, unknown> = {}) {
  assignmentFixture.present = true;
  assignmentFixture.data = {
    classId: CLASS_ID,
    teacherId: TEACHER_UID,
    schoolId: SCHOOL_ID,
    lessonSlug: LESSON_SLUG,
    lessonVersion: "1.0.0",
    mode: "classroom",
    status: "published",
    createdAt: { toMillis: () => 1_600_000_000_000 },
    ...overrides,
  };
}

// Canonical seeder for the frozen recipient population authorized under
// Sprint 12E Slice 2A. The document id equals studentId by construction
// (`assignmentRecipientDocRef(assignmentId, studentId)`); tests that need
// to exercise malformed rows pass an explicit `docId` override.
function seedRecipient(
  studentId: string,
  overrides: Record<string, unknown> = {},
  docIdOverride?: string,
) {
  recipientsFixture.push({
    id: docIdOverride ?? studentId,
    data: {
      assignmentId: ASSIGNMENT_ID,
      studentId,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      assignedAt: { toMillis: () => 1_650_000_000_000 },
      assignedBy: TEACHER_UID,
      source: "classPublication",
      status: "assigned",
      ...overrides,
    },
  });
}

function seedEnrollment(studentId: string, overrides: Record<string, unknown> = {}) {
  const id = `${(overrides.classId as string | undefined) ?? CLASS_ID}__${studentId}`;
  enrollmentsFixture.push({
    id,
    data: {
      studentId,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      status: "active",
      enrolledAt: { toMillis: () => 1_600_000_000_000 },
      ...overrides,
    },
  });
}

function seedAttempt(overrides: Record<string, unknown> = {}) {
  const idx = attemptsFixture.length + 1;
  const studentId = (overrides.studentId as string | undefined) ?? STUDENT_A;
  const id = (overrides.attemptId as string | undefined) ?? `${ASSIGNMENT_ID}__${studentId}__a${idx}`;
  attemptsFixture.push({
    id,
    data: {
      studentId,
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      activityId: ACTIVITY_ID,
      assessmentId: ASSESSMENT_ID,
      assessmentRevisionId: REVISION_ID,
      attemptNumber: idx,
      score: 2,
      maxScore: 2,
      percentage: 100,
      responses: [{ itemId: "q1", response: "A" }],
      itemResults: [
        {
          itemId: "q1",
          isCorrect: true,
          pointsEarned: 1,
          correctOptionId: "A",
          explanation: "Because A.",
          studentResponse: "A",
        },
      ],
      idempotencyKey: `idem-${idx}`,
      submittedAt: { toMillis: () => 1_700_000_000_000 + idx },
      ...overrides,
    },
  });
}

function seedSession(overrides: Record<string, unknown> = {}) {
  const idx = sessionsFixture.length + 1;
  const studentId = (overrides.studentId as string | undefined) ?? STUDENT_A;
  const id = (overrides.sessionId as string | undefined) ?? `${ASSIGNMENT_ID}__${studentId}__s${idx}`;
  sessionsFixture.push({
    id,
    data: {
      studentId,
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      activityId: ACTIVITY_ID,
      assessmentId: ASSESSMENT_ID,
      assessmentRevisionId: REVISION_ID,
      sessionOrdinal: idx,
      status: "live",
      startedAt: { toMillis: () => 1_650_000_000_000 + idx },
      ...overrides,
    },
  });
}

function makeRequest(
  overrides: { data?: unknown; auth?: unknown } = {},
): CallableRequest<unknown> {
  return {
    data: overrides.data ?? { assignmentId: ASSIGNMENT_ID },
    auth: (overrides.auth ?? { uid: TEACHER_UID, token: {} }) as never,
    rawRequest: {} as never,
  };
}

describe("assessmentAssignmentSummary", () => {
  beforeEach(() => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
    });
    mockAttemptsCollectionRef.mockClear();
    mockAssessmentSessionsCollectionRef.mockClear();
    mockAssignmentRecipientsCollectionRef.mockClear();
    mockAssignmentDocRef.mockClear();
    mockClassDocRef.mockClear();
    mockLogInfo.mockReset();
    attemptsFixture.length = 0;
    sessionsFixture.length = 0;
    recipientsFixture.length = 0;
    enrollmentsFixture.length = 0;
    assignmentFixture.present = false;
    assignmentFixture.data = null;
    classFixture.present = false;
    classFixture.data = null;
    seedOwnedAssignment();
    seedOwnedActiveClass();
  });

  // ---- Positive summary cases

  it("returns zero counts for an empty recipient population", async () => {
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      totalStudents: 0,
      completedStudents: 0,
      inProgressStudents: 0,
      notStartedStudents: 0,
      completionPercentage: 0,
      averagePercentage: null,
      highestPercentage: null,
      lowestPercentage: null,
      perfectScoreStudents: 0,
    });
  });

  it("empty recipient population yields zero students even when class currently has active enrollments", async () => {
    seedEnrollment(STUDENT_A);
    seedEnrollment(STUDENT_B);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(0);
  });

  it("all students not started", async () => {
    seedRecipient(STUDENT_A);
    seedRecipient(STUDENT_B);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(2);
    expect(result.notStartedStudents).toBe(2);
    expect(result.completedStudents).toBe(0);
    expect(result.inProgressStudents).toBe(0);
    expect(result.completionPercentage).toBe(0);
    expect(result.averagePercentage).toBeNull();
  });

  it("one student in progress", async () => {
    seedRecipient(STUDENT_A);
    seedRecipient(STUDENT_B);
    seedSession({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.inProgressStudents).toBe(1);
    expect(result.notStartedStudents).toBe(1);
    expect(result.completedStudents).toBe(0);
  });

  it("one student completed", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A, score: 2, maxScore: 2, percentage: 100 });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
    expect(result.completedStudents).toBe(1);
    expect(result.completionPercentage).toBe(100);
    expect(result.averagePercentage).toBe(100);
    expect(result.perfectScoreStudents).toBe(1);
  });

  it("mixed completed, in-progress, not-started", async () => {
    seedRecipient(STUDENT_A);
    seedRecipient(STUDENT_B);
    seedRecipient(STUDENT_C);
    seedRecipient(STUDENT_D);
    seedAttempt({ studentId: STUDENT_A, percentage: 80, score: 4, maxScore: 5 });
    seedSession({ studentId: STUDENT_B });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(4);
    expect(result.completedStudents).toBe(1);
    expect(result.inProgressStudents).toBe(1);
    expect(result.notStartedStudents).toBe(2);
    expect(result.completionPercentage).toBe(25);
  });

  it("multiple attempts by one student count as one completed student", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A, percentage: 60, score: 3, maxScore: 5, attemptId: "a1" });
    seedAttempt({ studentId: STUDENT_A, percentage: 100, score: 5, maxScore: 5, attemptId: "a2" });
    seedAttempt({ studentId: STUDENT_A, percentage: 80, score: 4, maxScore: 5, attemptId: "a3" });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.completedStudents).toBe(1);
    expect(result.averagePercentage).toBe(100);
    expect(result.highestPercentage).toBe(100);
    expect(result.lowestPercentage).toBe(100);
    expect(result.perfectScoreStudents).toBe(1);
  });

  it("completed student with active session remains completed", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    seedSession({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.completedStudents).toBe(1);
    expect(result.inProgressStudents).toBe(0);
  });

  it("count invariant holds", async () => {
    seedRecipient(STUDENT_A);
    seedRecipient(STUDENT_B);
    seedRecipient(STUDENT_C);
    seedAttempt({ studentId: STUDENT_A });
    seedSession({ studentId: STUDENT_B });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(
      result.completedStudents +
        result.inProgressStudents +
        result.notStartedStudents,
    ).toBe(result.totalStudents);
  });

  it("completion percentage is correct", async () => {
    for (const s of [STUDENT_A, STUDENT_B, STUDENT_C, STUDENT_D]) {
      seedRecipient(s);
    }
    seedAttempt({ studentId: STUDENT_A });
    seedAttempt({ studentId: STUDENT_B });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.completionPercentage).toBe(50);
  });

  it("zero-student completion percentage is 0", async () => {
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.completionPercentage).toBe(0);
  });

  it("no-completion score metrics return null", async () => {
    seedRecipient(STUDENT_A);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.averagePercentage).toBeNull();
    expect(result.highestPercentage).toBeNull();
    expect(result.lowestPercentage).toBeNull();
    expect(result.perfectScoreStudents).toBe(0);
  });

  it("average, highest, lowest reflect selected attempts", async () => {
    seedRecipient(STUDENT_A);
    seedRecipient(STUDENT_B);
    seedRecipient(STUDENT_C);
    seedAttempt({ studentId: STUDENT_A, percentage: 60, score: 3, maxScore: 5 });
    seedAttempt({ studentId: STUDENT_B, percentage: 100, score: 5, maxScore: 5 });
    seedAttempt({ studentId: STUDENT_C, percentage: 80, score: 4, maxScore: 5 });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.averagePercentage).toBe(80);
    expect(result.highestPercentage).toBe(100);
    expect(result.lowestPercentage).toBe(60);
    expect(result.perfectScoreStudents).toBe(1);
  });

  it("perfect score uses raw score and max score", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A, percentage: 99, score: 5, maxScore: 5 });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.perfectScoreStudents).toBe(1);
  });

  it("percentage 100 without matching raw score is not perfect", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A, percentage: 100, score: 4, maxScore: 5 });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.perfectScoreStudents).toBe(0);
  });

  it("invalid maxScore does not produce false perfect score", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({
      studentId: STUDENT_A,
      score: 0,
      maxScore: 0,
      percentage: 100,
    });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.perfectScoreStudents).toBe(0);
  });

  it("multiple perfect-score students are counted correctly", async () => {
    seedRecipient(STUDENT_A);
    seedRecipient(STUDENT_B);
    seedAttempt({ studentId: STUDENT_A, percentage: 100, score: 5, maxScore: 5 });
    seedAttempt({ studentId: STUDENT_B, percentage: 100, score: 5, maxScore: 5 });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.perfectScoreStudents).toBe(2);
  });

  it("highest-attempt selection policy is applied consistently", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A, percentage: 40, score: 2, maxScore: 5, attemptId: "a1" });
    seedAttempt({ studentId: STUDENT_A, percentage: 80, score: 4, maxScore: 5, attemptId: "a2" });
    seedAttempt({ studentId: STUDENT_A, percentage: 60, score: 3, maxScore: 5, attemptId: "a3" });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.averagePercentage).toBe(80);
    expect(result.highestPercentage).toBe(80);
    expect(result.lowestPercentage).toBe(80);
  });

  it("summary works for closed assignment", async () => {
    seedOwnedAssignment({ status: "closed" });
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.completedStudents).toBe(1);
  });

  it("summary works for archived assignment", async () => {
    seedOwnedAssignment({ status: "archived" });
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.completedStudents).toBe(1);
  });

  it("summary works for draft assignment (empty by construction)", async () => {
    seedOwnedAssignment({ status: "draft" });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(0);
    expect(result.completedStudents).toBe(0);
  });

  // ---- PDR-029l historical roster stability

  it("student active at publication remains after enrollment becomes inactive", async () => {
    seedRecipient(STUDENT_A);
    seedEnrollment(STUDENT_A, { status: "withdrawn" });
    seedAttempt({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
    expect(result.completedStudents).toBe(1);
  });

  it("student remains in summary after enrollment is removed entirely", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
    expect(result.completedStudents).toBe(1);
  });

  it("student remains in summary after transfer to another class", async () => {
    seedRecipient(STUDENT_A);
    seedEnrollment(STUDENT_A, { classId: OTHER_CLASS_ID });
    seedAttempt({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("student remains in summary after transfer to another school (recipient still owned by assignment)", async () => {
    seedRecipient(STUDENT_A);
    seedEnrollment(STUDENT_A, { schoolId: OTHER_SCHOOL_ID });
    seedAttempt({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
    expect(result.completedStudents).toBe(1);
  });

  it("newly enrolled student without a recipient record is excluded", async () => {
    seedRecipient(STUDENT_A);
    seedEnrollment(STUDENT_A);
    seedEnrollment(STUDENT_B);
    seedAttempt({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("late recipient added via manualAddition is included", async () => {
    seedRecipient(STUDENT_A);
    seedRecipient(STUDENT_B, { source: "manualAddition" });
    seedAttempt({ studentId: STUDENT_B });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(2);
    expect(result.completedStudents).toBe(1);
  });

  it("current active roster changes do not change totalStudents", async () => {
    seedRecipient(STUDENT_A);
    seedRecipient(STUDENT_B);
    seedRecipient(STUDENT_C);
    seedEnrollment(STUDENT_A, { status: "withdrawn" });
    seedEnrollment(STUDENT_D);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(3);
  });

  it("attempts from non-recipients do not affect completion counts", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    seedAttempt({ studentId: OUTSIDE_STUDENT, attemptId: "outside", percentage: 20 });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.completedStudents).toBe(1);
  });

  it("sessions from non-recipients do not affect in-progress counts", async () => {
    seedRecipient(STUDENT_A);
    seedSession({ studentId: OUTSIDE_STUDENT });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.inProgressStudents).toBe(0);
  });

  it("removed recipient history remains visible in aggregate metrics", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A, percentage: 80, score: 4, maxScore: 5 });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.averagePercentage).toBe(80);
    expect(result.completedStudents).toBe(1);
  });

  it("recipient population is independent of user-profile existence", async () => {
    seedRecipient(STUDENT_A);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("missing display name does not affect membership", async () => {
    seedRecipient(STUDENT_A);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("duplicate recipient document ids cannot inflate counts", async () => {
    seedRecipient(STUDENT_A);
    seedRecipient(STUDENT_A);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  // ---- Malformed recipient policy (documented silent-drop, count invariant preserved)

  it("recipient with document id not equal to studentId is silently dropped", async () => {
    seedRecipient(STUDENT_A, {}, "wrong-doc-id");
    seedRecipient(STUDENT_B);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("recipient with wrong assignmentId is silently dropped", async () => {
    seedRecipient(STUDENT_A, { assignmentId: OTHER_ASSIGNMENT_ID });
    seedRecipient(STUDENT_B);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("recipient with wrong classId is silently dropped", async () => {
    seedRecipient(STUDENT_A, { classId: OTHER_CLASS_ID });
    seedRecipient(STUDENT_B);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("recipient with wrong teacherId is silently dropped", async () => {
    seedRecipient(STUDENT_A, { teacherId: OTHER_TEACHER_UID });
    seedRecipient(STUDENT_B);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("recipient with wrong schoolId is silently dropped", async () => {
    seedRecipient(STUDENT_A, { schoolId: OTHER_SCHOOL_ID });
    seedRecipient(STUDENT_B);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("recipient with wrong districtId is silently dropped", async () => {
    seedRecipient(STUDENT_A, { districtId: OTHER_DISTRICT_ID });
    seedRecipient(STUDENT_B);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("recipient with non-assigned status is silently dropped", async () => {
    seedRecipient(STUDENT_A, { status: "revoked" });
    seedRecipient(STUDENT_B);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  it("recipient with blank studentId is silently dropped", async () => {
    seedRecipient(STUDENT_A, { studentId: "   " });
    seedRecipient(STUDENT_B);
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.totalStudents).toBe(1);
  });

  // ---- Authentication and role

  it("refuses unauthenticated caller", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("unauthenticated", "auth required"),
    );
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest({ auth: undefined })),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("refuses student caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      role: "student" as const,
    });
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("refuses platformAdministrator caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      role: "platformAdministrator" as const,
    });
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("refuses inactive teacher", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("account-inactive", "inactive"),
    );
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
  });

  it("refuses malformed claims", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("claim-state-mismatch", "stale"),
    );
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-state-mismatch" });
  });

  // ---- Input validation

  it("refuses missing body", async () => {
    await expect(
      __assessmentAssignmentSummaryHandler({
        data: null,
        auth: { uid: TEACHER_UID, token: {} } as never,
        rawRequest: {} as never,
      }),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });

  it("refuses array body", async () => {
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest({ data: [] })),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });

  it("refuses missing assignmentId", async () => {
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
  });

  it("refuses blank assignmentId", async () => {
    await expect(
      __assessmentAssignmentSummaryHandler(
        makeRequest({ data: { assignmentId: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
  });

  it("refuses non-string assignmentId", async () => {
    await expect(
      __assessmentAssignmentSummaryHandler(
        makeRequest({ data: { assignmentId: 42 } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
  });

  it("refuses malformed assignmentId token", async () => {
    await expect(
      __assessmentAssignmentSummaryHandler(
        makeRequest({ data: { assignmentId: "not a token" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
  });

  it.each([
    "classId",
    "teacherId",
    "studentId",
    "districtId",
    "schoolId",
    "assessmentId",
    "assessmentRevisionId",
    "activityId",
    "attemptId",
    "sessionId",
    "startAt",
    "endAt",
    "from",
    "to",
    "groupBy",
    "aggregate",
    "filter",
  ])("refuses forbidden request key %s", async (key) => {
    await expect(
      __assessmentAssignmentSummaryHandler(
        makeRequest({
          data: { assignmentId: ASSIGNMENT_ID, [key]: "anything" },
        }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });

  // ---- Assignment and class authorization

  it("refuses nonexistent assignment", async () => {
    assignmentFixture.present = false;
    assignmentFixture.data = null;
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.notFound" });
  });

  it("refuses assignment missing class reference", async () => {
    seedOwnedAssignment({ classId: "" });
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.notFound" });
  });

  it("refuses missing referenced class", async () => {
    classFixture.present = false;
    classFixture.data = null;
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.notFound" });
  });

  it("refuses same-district non-owner teacher (assignment ownership)", async () => {
    seedOwnedAssignment({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("refuses cross-school teacher at the assignment boundary", async () => {
    seedOwnedAssignment({ schoolId: OTHER_SCHOOL_ID });
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("refuses cross-district teacher context", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      districtId: OTHER_DISTRICT_ID,
      schoolId: OTHER_SCHOOL_ID,
    });
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("matching district alone does not authorize", async () => {
    seedOwnedAssignment({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("matching school alone does not authorize", async () => {
    seedOwnedAssignment({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("refuses when class ownership does not match the caller", async () => {
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("refuses assignment whose frozen ownership disagrees with class record", async () => {
    seedOwnedActiveClass({ teacherId: TEACHER_UID, schoolId: OTHER_SCHOOL_ID });
    await expect(
      __assessmentAssignmentSummaryHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("forged assignmentId cannot expose another teacher's assignment", async () => {
    seedOwnedAssignment({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAssignmentSummaryHandler(
        makeRequest({ data: { assignmentId: OTHER_ASSIGNMENT_ID } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  // ---- Attempt scope isolation (defense in depth)

  it("excludes attempts from another assignment", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    seedAttempt({
      studentId: STUDENT_A,
      assignmentId: OTHER_ASSIGNMENT_ID,
      attemptId: "x1",
      percentage: 50,
      score: 1,
      maxScore: 2,
    });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.completedStudents).toBe(1);
    expect(result.averagePercentage).toBe(100);
  });

  it("excludes attempts from another class", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    seedAttempt({
      studentId: STUDENT_A,
      classId: OTHER_CLASS_ID,
      attemptId: "x1",
      percentage: 50,
      score: 1,
      maxScore: 2,
    });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.averagePercentage).toBe(100);
  });

  it("excludes attempts from another district", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    seedAttempt({
      studentId: STUDENT_A,
      districtId: OTHER_DISTRICT_ID,
      attemptId: "x1",
      percentage: 50,
      score: 1,
      maxScore: 2,
    });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.averagePercentage).toBe(100);
  });

  it("excludes attempts from another school", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    seedAttempt({
      studentId: STUDENT_A,
      schoolId: OTHER_SCHOOL_ID,
      attemptId: "x1",
      percentage: 50,
      score: 1,
      maxScore: 2,
    });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.averagePercentage).toBe(100);
  });

  it("excludes sessions from another assignment", async () => {
    seedRecipient(STUDENT_A);
    seedSession({ studentId: STUDENT_A, assignmentId: OTHER_ASSIGNMENT_ID });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.inProgressStudents).toBe(0);
  });

  it("excludes sessions from another class", async () => {
    seedRecipient(STUDENT_A);
    seedSession({ studentId: STUDENT_A, classId: OTHER_CLASS_ID });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.inProgressStudents).toBe(0);
  });

  it("excludes sessions from another district", async () => {
    seedRecipient(STUDENT_A);
    seedSession({ studentId: STUDENT_A, districtId: OTHER_DISTRICT_ID });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.inProgressStudents).toBe(0);
  });

  it("excludes sessions from another school", async () => {
    seedRecipient(STUDENT_A);
    seedSession({ studentId: STUDENT_A, schoolId: OTHER_SCHOOL_ID });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.inProgressStudents).toBe(0);
  });

  it("excludes non-live sessions from in-progress count", async () => {
    seedRecipient(STUDENT_A);
    seedSession({ studentId: STUDENT_A, status: "archived" });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.inProgressStudents).toBe(0);
    expect(result.notStartedStudents).toBe(1);
  });

  it("multiple live sessions count one student once", async () => {
    seedRecipient(STUDENT_A);
    seedSession({ studentId: STUDENT_A, sessionId: "s1" });
    seedSession({ studentId: STUDENT_A, sessionId: "s2" });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.inProgressStudents).toBe(1);
  });

  it("malformed attempt records do not corrupt metrics", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({
      studentId: STUDENT_A,
      attemptId: "malformed",
      percentage: Number.NaN,
      score: Number.NaN,
      maxScore: Number.NaN,
      attemptNumber: Number.NaN,
    });
    seedAttempt({
      studentId: STUDENT_A,
      attemptId: "good",
      percentage: 80,
      score: 4,
      maxScore: 5,
    });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.completedStudents).toBe(1);
    expect(result.averagePercentage).toBe(80);
  });

  it("malformed session records do not affect classification", async () => {
    seedRecipient(STUDENT_A);
    seedSession({ studentId: STUDENT_A, status: "unknown-status" });
    seedSession({ studentId: STUDENT_A, sessionId: "live", status: "live" });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.inProgressStudents).toBe(1);
  });

  // ---- Numeric integrity

  it("zero max score does not cause division errors or count as perfect", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({
      studentId: STUDENT_A,
      score: 0,
      maxScore: 0,
      percentage: 0,
    });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.perfectScoreStudents).toBe(0);
    expect(result.averagePercentage).toBe(0);
  });

  it("never returns NaN or Infinity", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    for (const value of [
      result.completionPercentage,
      result.averagePercentage ?? 0,
      result.highestPercentage ?? 0,
      result.lowestPercentage ?? 0,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("rounds percentages deterministically (half-up)", async () => {
    seedRecipient(STUDENT_A);
    seedRecipient(STUDENT_B);
    seedRecipient(STUDENT_C);
    seedAttempt({ studentId: STUDENT_A, percentage: 66.6, score: 2, maxScore: 3 });
    seedAttempt({ studentId: STUDENT_B, percentage: 66.6, score: 2, maxScore: 3 });
    seedAttempt({ studentId: STUDENT_C, percentage: 66.7, score: 2, maxScore: 3 });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(result.averagePercentage).toBe(67);
    expect(result.highestPercentage).toBe(67);
    expect(result.lowestPercentage).toBe(67);
  });

  // ---- Confidentiality

  it("returns exactly the approved projection fields", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(Object.keys(result).sort()).toEqual(
      [
        "assignmentId",
        "classId",
        "totalStudents",
        "completedStudents",
        "inProgressStudents",
        "notStartedStudents",
        "completionPercentage",
        "averagePercentage",
        "highestPercentage",
        "lowestPercentage",
        "perfectScoreStudents",
      ].sort(),
    );
  });

  it("never surfaces student-level, attempt-level, recipient-level, or scoring-internal fields", async () => {
    seedRecipient(STUDENT_A);
    seedAttempt({ studentId: STUDENT_A });
    seedSession({ studentId: STUDENT_A });
    const result = await __assessmentAssignmentSummaryHandler(makeRequest());
    const envelope = result as unknown as Record<string, unknown>;
    for (const forbidden of [
      "studentId",
      "studentIds",
      "students",
      "studentDisplayName",
      "recipients",
      "recipientIds",
      "attemptId",
      "attemptIds",
      "attempts",
      "responses",
      "itemResults",
      "correctOptionId",
      "explanation",
      "idempotencyKey",
      "sessionId",
      "sessions",
      "enrollments",
      "score",
      "maxScore",
      "percentage",
      "districtId",
      "schoolId",
      "teacherId",
      "assessmentId",
      "assessmentRevisionId",
      "activityId",
    ]) {
      expect(envelope).not.toHaveProperty(forbidden);
    }
  });

  it("scopes queries to the requested assignment and class", async () => {
    seedRecipient(STUDENT_A);
    await __assessmentAssignmentSummaryHandler(makeRequest());
    expect(mockAssignmentDocRef).toHaveBeenCalledWith(ASSIGNMENT_ID);
    expect(mockClassDocRef).toHaveBeenCalledWith(CLASS_ID);
    expect(mockAssignmentRecipientsCollectionRef).toHaveBeenCalledWith(
      ASSIGNMENT_ID,
    );
    expect(mockAttemptsCollectionRef).toHaveBeenCalled();
    expect(mockAssessmentSessionsCollectionRef).toHaveBeenCalled();
  });
});

describe("selectHighestCompletedAttempt (PDR-029 tie-break policy)", () => {
  const base = {
    studentId: STUDENT_A,
    assignmentId: ASSIGNMENT_ID,
    classId: CLASS_ID,
    teacherId: TEACHER_UID,
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
    activityId: ACTIVITY_ID,
    assessmentId: ASSESSMENT_ID,
    assessmentRevisionId: REVISION_ID,
    responses: [],
    itemResults: [],
    idempotencyKey: "idem",
    submittedAt: { toMillis: () => 0 } as unknown as never,
  };

  function ts(ms: number) {
    return { toMillis: () => ms } as unknown as never;
  }

  it("returns null on empty input", () => {
    expect(selectHighestCompletedAttempt([])).toBeNull();
  });

  it("higher percentage wins", () => {
    const selected = selectHighestCompletedAttempt([
      { id: "a1", data: { ...base, percentage: 50, score: 1, maxScore: 2, attemptNumber: 1 } },
      { id: "a2", data: { ...base, percentage: 100, score: 2, maxScore: 2, attemptNumber: 2 } },
      { id: "a3", data: { ...base, percentage: 75, score: 3, maxScore: 4, attemptNumber: 3 } },
    ]);
    expect(selected?.attemptId).toBe("a2");
  });

  it("higher attemptNumber breaks equal-percentage ties", () => {
    const selected = selectHighestCompletedAttempt([
      { id: "a1", data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1 } },
      { id: "a2", data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 2 } },
    ]);
    expect(selected?.attemptId).toBe("a2");
  });

  it("later completedAt breaks equal-percentage-and-attemptNumber ties", () => {
    const selected = selectHighestCompletedAttempt([
      {
        id: "b1",
        data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1, submittedAt: ts(1_000) },
      },
      {
        id: "b2",
        data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1, submittedAt: ts(2_000) },
      },
    ]);
    expect(selected?.attemptId).toBe("b2");
  });

  it("ascending attemptId is the final deterministic fallback", () => {
    const selected = selectHighestCompletedAttempt([
      {
        id: "z-later-lex",
        data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1, submittedAt: ts(1_000) },
      },
      {
        id: "a-earlier-lex",
        data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1, submittedAt: ts(1_000) },
      },
    ]);
    expect(selected?.attemptId).toBe("a-earlier-lex");
  });

  it("raw score does not outrank percentage", () => {
    const selected = selectHighestCompletedAttempt([
      { id: "high-raw", data: { ...base, percentage: 50, score: 50, maxScore: 100, attemptNumber: 1 } },
      { id: "high-pct", data: { ...base, percentage: 100, score: 2, maxScore: 2, attemptNumber: 1 } },
    ]);
    expect(selected?.attemptId).toBe("high-pct");
  });

  it("higher raw score with lower percentage loses", () => {
    const selected = selectHighestCompletedAttempt([
      { id: "raw", data: { ...base, percentage: 60, score: 60, maxScore: 100, attemptNumber: 1 } },
      { id: "pct", data: { ...base, percentage: 90, score: 9, maxScore: 10, attemptNumber: 1 } },
    ]);
    expect(selected?.attemptId).toBe("pct");
  });

  it("lower later attempt does not replace higher earlier attempt", () => {
    const selected = selectHighestCompletedAttempt([
      { id: "early", data: { ...base, percentage: 100, score: 5, maxScore: 5, attemptNumber: 1, submittedAt: ts(1_000) } },
      { id: "later", data: { ...base, percentage: 60, score: 3, maxScore: 5, attemptNumber: 2, submittedAt: ts(2_000) } },
    ]);
    expect(selected?.attemptId).toBe("early");
  });

  it("invalid percentage is excluded", () => {
    const selected = selectHighestCompletedAttempt([
      { id: "bad", data: { ...base, percentage: Number.NaN, score: 5, maxScore: 5, attemptNumber: 1 } },
      { id: "good", data: { ...base, percentage: 50, score: 1, maxScore: 2, attemptNumber: 1 } },
    ]);
    expect(selected?.attemptId).toBe("good");
  });

  it("non-finite percentage is excluded", () => {
    const selected = selectHighestCompletedAttempt([
      { id: "inf", data: { ...base, percentage: Number.POSITIVE_INFINITY, score: 5, maxScore: 5, attemptNumber: 1 } },
      { id: "good", data: { ...base, percentage: 50, score: 1, maxScore: 2, attemptNumber: 1 } },
    ]);
    expect(selected?.attemptId).toBe("good");
  });

  it("valid completedAt outranks missing completedAt when prior keys tie", () => {
    const selected = selectHighestCompletedAttempt([
      {
        id: "missing",
        data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1, submittedAt: undefined as never },
      },
      {
        id: "valid",
        data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1, submittedAt: ts(1_000) },
      },
    ]);
    expect(selected?.attemptId).toBe("valid");
  });

  it("two missing completedAt values fall through to ascending attemptId", () => {
    const selected = selectHighestCompletedAttempt([
      {
        id: "b-missing",
        data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1, submittedAt: undefined as never },
      },
      {
        id: "a-missing",
        data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1, submittedAt: undefined as never },
      },
    ]);
    expect(selected?.attemptId).toBe("a-missing");
  });

  it("malformed completedAt (no toMillis) is treated as missing", () => {
    const selected = selectHighestCompletedAttempt([
      {
        id: "malformed",
        data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1, submittedAt: "not-a-timestamp" as never },
      },
      {
        id: "valid",
        data: { ...base, percentage: 80, score: 4, maxScore: 5, attemptNumber: 1, submittedAt: ts(1_000) },
      },
    ]);
    expect(selected?.attemptId).toBe("valid");
  });

  it("cross-revision comparability: highest percentage wins across different maxScore", () => {
    const selected = selectHighestCompletedAttempt([
      { id: "r1", data: { ...base, percentage: 90, score: 9, maxScore: 10, attemptNumber: 1 } },
      { id: "r2", data: { ...base, percentage: 100, score: 5, maxScore: 5, attemptNumber: 2 } },
    ]);
    expect(selected?.attemptId).toBe("r2");
  });

  it("ignores malformed numeric fields", () => {
    const selected = selectHighestCompletedAttempt([
      {
        id: "bad",
        data: {
          ...base,
          percentage: Number.NaN,
          score: Number.NaN,
          maxScore: Number.NaN,
          attemptNumber: Number.NaN,
        },
      },
      {
        id: "good",
        data: { ...base, percentage: 50, score: 1, maxScore: 2, attemptNumber: 1 },
      },
    ]);
    expect(selected?.attemptId).toBe("good");
  });
});
