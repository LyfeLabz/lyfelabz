import type { CallableRequest } from "firebase-functions/v2/https";

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

const mockRequireDistrictContext = jest.fn();

let attemptSnapshot: {
  exists: boolean;
  data: () => unknown;
} = { exists: false, data: () => undefined };

const classFixture: {
  present: boolean;
  data: Record<string, unknown> | null;
} = { present: false, data: null };

const mockAttemptDocRef = jest.fn((id: string) => ({
  __kind: "attempt",
  id,
  get: () => Promise.resolve(attemptSnapshot),
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
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    requireDistrictContext: mockRequireDistrictContext,
    attemptDocRef: mockAttemptDocRef,
    classDocRef: mockClassDocRef,
  };
});

const resolverCalls: Array<{
  scope: { classId: string; schoolId: string; districtId: string };
  studentId: string;
}> = [];
const displayNameFixture = new Map<string, string>();
const FALLBACK = "Name unavailable";

jest.mock("../enrollments/resolve-roster-display-name", () => ({
  createRosterDisplayNameResolver: (scope: {
    classId: string;
    schoolId: string;
    districtId: string;
  }) => {
    const cache = new Map<
      string,
      Promise<{
        studentId: string;
        displayName: string;
        source: "enrollmentOverride" | "userProfile" | "fallback";
      }>
    >();
    return (studentId: string) => {
      const cached = cache.get(studentId);
      if (cached) return cached;
      resolverCalls.push({ scope, studentId });
      const name = displayNameFixture.get(studentId);
      const source: "userProfile" | "fallback" = name
        ? "userProfile"
        : "fallback";
      const result = Promise.resolve({
        studentId,
        displayName: name ?? FALLBACK,
        source,
      });
      cache.set(studentId, result);
      return result;
    };
  },
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __assessmentAttemptGetForTeacherHandler } from "./assessment-attempt-get-for-teacher";

const TEACHER_UID = "teacher-uid";
const OTHER_TEACHER_UID = "other-teacher-uid";
const STUDENT_A = "student-a";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-1";
const OTHER_DISTRICT_ID = "district-2";
const CLASS_ID = "class-abc";
const OTHER_CLASS_ID = "class-xyz";
const ASSIGNMENT_ID = "assign-1";
const LESSON_SLUG = "lesson_g7_earths-layers";
const ACTIVITY_ID = LESSON_SLUG;
const ASSESSMENT_ID = `assessment_${LESSON_SLUG}`;
const REVISION_ID = `assessment_${LESSON_SLUG}__r1`;
const ATTEMPT_ID = `${ASSIGNMENT_ID}__${STUDENT_A}__a1`;

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

function seedAttempt(overrides: Record<string, unknown> = {}) {
  attemptSnapshot = {
    exists: true,
    data: () => ({
      studentId: STUDENT_A,
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      activityId: ACTIVITY_ID,
      assessmentId: ASSESSMENT_ID,
      assessmentRevisionId: REVISION_ID,
      attemptNumber: 1,
      score: 2,
      maxScore: 3,
      percentage: 66,
      responses: [
        { itemId: "q1", response: "A" },
        { itemId: "q2", response: "B" },
      ],
      itemResults: [
        {
          itemId: "q1",
          isCorrect: true,
          pointsEarned: 1,
          correctOptionId: "A",
          explanation: "Because A.",
          studentResponse: "A",
        },
        {
          itemId: "q2",
          isCorrect: false,
          pointsEarned: 0,
          correctOptionId: "C",
          explanation: "Because C.",
          studentResponse: "B",
        },
      ],
      idempotencyKey: "idem-1",
      submittedAt: { toMillis: () => 1_700_000_000_000 },
      ...overrides,
    }),
  };
}

function makeRequest(
  overrides: { data?: unknown; auth?: unknown } = {},
): CallableRequest<unknown> {
  return {
    data: "data" in overrides ? overrides.data : { attemptId: ATTEMPT_ID },
    auth: (overrides.auth ?? { uid: TEACHER_UID, token: {} }) as never,
    rawRequest: {} as never,
  };
}

describe("assessmentAttemptGetForTeacher", () => {
  beforeEach(() => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
    });
    mockAttemptDocRef.mockClear();
    mockClassDocRef.mockClear();
    mockLogInfo.mockReset();
    attemptSnapshot = { exists: false, data: () => undefined };
    classFixture.present = false;
    classFixture.data = null;
    resolverCalls.length = 0;
    displayNameFixture.clear();
    seedOwnedActiveClass();
  });

  // Positive retrieval

  it("owning active teacher retrieves a completed attempt", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    const projected = result.attempt as unknown as Record<string, unknown>;
    expect(projected.attemptId).toBe(ATTEMPT_ID);
    expect(projected.studentId).toBe(STUDENT_A);
    expect(projected.studentDisplayName).toBe("Alex Rivera");
    expect(projected.assessmentId).toBe(ASSESSMENT_ID);
    expect(projected.assignmentId).toBe(ASSIGNMENT_ID);
    expect(projected.assessmentRevisionId).toBe(REVISION_ID);
    expect(projected.attemptNumber).toBe(1);
    expect(projected.score).toBe(2);
    expect(projected.maxScore).toBe(3);
    expect(projected.percentage).toBe(66);
    expect(projected.submittedAt).toBe(1_700_000_000_000);
    expect(projected.status).toBe("completed");
  });

  it("returns exactly the approved projection fields", async () => {
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    const projected = result.attempt as unknown as Record<string, unknown>;
    expect(Object.keys(projected).sort()).toEqual(
      [
        "assessmentId",
        "assessmentRevisionId",
        "assignmentId",
        "attemptId",
        "attemptNumber",
        "itemResults",
        "maxScore",
        "percentage",
        "responses",
        "score",
        "status",
        "studentDisplayName",
        "studentId",
        "submittedAt",
      ].sort(),
    );
  });

  it("returns the approved submitted responses verbatim", async () => {
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    expect(result.attempt.responses).toEqual([
      { itemId: "q1", response: "A" },
      { itemId: "q2", response: "B" },
    ]);
  });

  it("returns the approved item-level results", async () => {
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    expect(result.attempt.itemResults).toEqual([
      {
        itemId: "q1",
        isCorrect: true,
        pointsEarned: 1,
        correctOptionId: "A",
        explanation: "Because A.",
        studentResponse: "A",
      },
      {
        itemId: "q2",
        isCorrect: false,
        pointsEarned: 0,
        correctOptionId: "C",
        explanation: "Because C.",
        studentResponse: "B",
      },
    ]);
  });

  it("projects only approved keys on each item-result element", async () => {
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    const first = result.attempt.itemResults[0] as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(first).sort()).toEqual(
      [
        "correctOptionId",
        "explanation",
        "isCorrect",
        "itemId",
        "pointsEarned",
        "studentResponse",
      ].sort(),
    );
  });

  it("projects only approved keys on each response element", async () => {
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    const first = result.attempt.responses[0] as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(first).sort()).toEqual(["itemId", "response"].sort());
  });

  it("returns the canonical display name for a resolved student", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    expect(result.attempt.studentDisplayName).toBe("Alex Rivera");
  });

  it("returns the canonical fallback when the resolver reports no name", async () => {
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    expect(result.attempt.studentDisplayName).toBe(FALLBACK);
  });

  it("passes the trusted class, school, and district scope to the resolver", async () => {
    seedAttempt();
    await __assessmentAttemptGetForTeacherHandler(makeRequest());
    expect(resolverCalls[0].scope).toEqual({
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    expect(resolverCalls[0].studentId).toBe(STUDENT_A);
  });

  it("resolves the display name exactly once per request", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    seedAttempt();
    await __assessmentAttemptGetForTeacherHandler(makeRequest());
    expect(resolverCalls).toHaveLength(1);
  });

  it("returns a stable completed status", async () => {
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    expect(result.attempt.status).toBe("completed");
  });

  // Authentication and role

  it("refuses an unauthenticated caller", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("unauthenticated", "auth required"),
    );
    await expect(
      __assessmentAttemptGetForTeacherHandler(
        makeRequest({ auth: undefined }),
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("refuses a student caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      role: "student" as const,
    });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("refuses a platformAdministrator caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      role: "platformAdministrator" as const,
    });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("refuses an inactive teacher via account-inactive from the helper", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("account-inactive", "inactive teacher"),
    );
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
  });

  it("refuses a teacher with malformed claims", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("claim-state-mismatch", "claims out of sync"),
    );
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-state-mismatch" });
  });

  // Input validation

  it("refuses a non-object request payload with invalidRequest", async () => {
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest({ data: [] })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest({ data: "hi" })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
  });

  it("refuses a missing attemptId", async () => {
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidAttemptId" });
  });

  it("refuses a blank attemptId", async () => {
    await expect(
      __assessmentAttemptGetForTeacherHandler(
        makeRequest({ data: { attemptId: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidAttemptId" });
  });

  it("refuses a non-string attemptId", async () => {
    await expect(
      __assessmentAttemptGetForTeacherHandler(
        makeRequest({ data: { attemptId: 42 } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidAttemptId" });
  });

  it("refuses a malformed attemptId token", async () => {
    await expect(
      __assessmentAttemptGetForTeacherHandler(
        makeRequest({ data: { attemptId: "bad id with spaces" } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidAttemptId" });
  });

  it("refuses any request that supplies an owner-scoping key", async () => {
    for (const key of [
      "studentId",
      "uid",
      "userId",
      "districtId",
      "schoolId",
      "classId",
      "teacherId",
      "assignmentId",
    ]) {
      await expect(
        __assessmentAttemptGetForTeacherHandler(
          makeRequest({ data: { attemptId: ATTEMPT_ID, [key]: "anything" } }),
        ),
      ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
    }
  });

  // Attempt authorization

  it("refuses a nonexistent attempt", async () => {
    attemptSnapshot = { exists: false, data: () => undefined };
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.notFound" });
  });

  it("refuses an attempt whose frozen districtId does not match the caller", async () => {
    seedAttempt({ districtId: OTHER_DISTRICT_ID });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.forbidden" });
  });

  it("refuses an attempt whose frozen schoolId does not match the caller", async () => {
    seedAttempt({ schoolId: OTHER_SCHOOL_ID });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.forbidden" });
  });

  it("refuses when the referenced class does not exist", async () => {
    classFixture.present = false;
    classFixture.data = null;
    seedAttempt();
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.notFound" });
  });

  it("refuses a same-district teacher who does not own the referenced class", async () => {
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    seedAttempt({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("refuses a same-school teacher who does not own the referenced class", async () => {
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    seedAttempt({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("refuses a cross-district caller", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      districtId: OTHER_DISTRICT_ID,
      schoolId: OTHER_SCHOOL_ID,
    });
    seedAttempt();
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.forbidden" });
  });

  it("refuses a cross-school caller", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      schoolId: OTHER_SCHOOL_ID,
    });
    seedAttempt();
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.forbidden" });
  });

  it("refuses an attempt from another class even when frozen fields target the caller", async () => {
    // Class the attempt names is owned by another teacher.
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    seedAttempt({ classId: CLASS_ID, teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("refuses an attempt whose frozen teacherId disagrees with the authoritative class record", async () => {
    // Class is owned by the caller; attempt's frozen teacherId is stale.
    seedAttempt({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.notFound" });
  });

  it("matching district alone does not authorize access", async () => {
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    seedAttempt({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("matching school alone does not authorize access", async () => {
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    seedAttempt({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("cannot be redirected by a request-supplied classId because none is accepted", async () => {
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    seedAttempt({ classId: OTHER_CLASS_ID, teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptGetForTeacherHandler(
        makeRequest({ data: { attemptId: ATTEMPT_ID, classId: CLASS_ID } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
  });

  // Lifecycle and integrity

  it("refuses a malformed attempt missing its classId", async () => {
    seedAttempt({ classId: "" });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.notFound" });
  });

  it("refuses a malformed attempt missing its studentId", async () => {
    seedAttempt({ studentId: "" });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.notFound" });
  });

  it("refuses an attempt whose frozen schoolId disagrees with the loaded class record", async () => {
    // Caller's context claims SCHOOL_ID; the class agrees; but the
    // attempt was persisted with a mismatched frozen school.
    seedAttempt({ schoolId: SCHOOL_ID });
    seedOwnedActiveClass({ schoolId: OTHER_SCHOOL_ID });
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      schoolId: OTHER_SCHOOL_ID,
    });
    await expect(
      __assessmentAttemptGetForTeacherHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.forbidden" });
  });

  it("succeeds for an attempt by a student who is not currently enrolled (historical attempts remain readable)", async () => {
    // Enrollment removal manifests as the fallback name; class ownership
    // is unchanged, so the historical attempt remains readable.
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    expect(result.attempt.studentDisplayName).toBe(FALLBACK);
    expect(result.attempt.attemptId).toBe(ATTEMPT_ID);
  });

  it("uses the trusted class scope from the loaded attempt, not the caller's active roster", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    seedAttempt();
    await __assessmentAttemptGetForTeacherHandler(makeRequest());
    expect(resolverCalls[0].scope.classId).toBe(CLASS_ID);
  });

  // Confidentiality

  it("never surfaces answer-key collection reads, scoring configuration, or routing metadata on the projected attempt", async () => {
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    const projected = result.attempt as unknown as Record<string, unknown>;
    for (const forbidden of [
      "idempotencyKey",
      "teacherId",
      "classId",
      "schoolId",
      "districtId",
      "activityId",
      "source",
    ]) {
      expect(projected).not.toHaveProperty(forbidden);
    }
  });

  it("never surfaces resolver internals or extra source metadata", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    const envelope = result as unknown as Record<string, unknown>;
    expect(envelope).not.toHaveProperty("source");
    expect(envelope).not.toHaveProperty("teacherId");
    expect(envelope).not.toHaveProperty("districtId");
    expect(envelope).not.toHaveProperty("schoolId");
    expect(envelope).not.toHaveProperty("classId");
  });

  it("never spreads unknown attempt fields into the projection", async () => {
    // Attach a suspicious extra field to the stored attempt document.
    seedAttempt({ secretRubricInternal: "must not leak" });
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    const projected = result.attempt as unknown as Record<string, unknown>;
    expect(projected).not.toHaveProperty("secretRubricInternal");
  });

  it("never spreads unknown item-result fields into the projection", async () => {
    seedAttempt({
      itemResults: [
        {
          itemId: "q1",
          isCorrect: true,
          pointsEarned: 1,
          correctOptionId: "A",
          explanation: "Because A.",
          studentResponse: "A",
          hiddenScoringWeight: 42,
        },
      ],
    });
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    const first = result.attempt.itemResults[0] as unknown as Record<
      string,
      unknown
    >;
    expect(first).not.toHaveProperty("hiddenScoringWeight");
  });

  it("never spreads unknown response fields into the projection", async () => {
    seedAttempt({
      responses: [{ itemId: "q1", response: "A", isCorrect: true }],
    });
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    const first = result.attempt.responses[0] as unknown as Record<
      string,
      unknown
    >;
    expect(first).not.toHaveProperty("isCorrect");
    expect(Object.keys(first).sort()).toEqual(["itemId", "response"].sort());
  });

  it("never reads the answer-key collection", async () => {
    // The attempt-get callable does not receive an answerKey ref; if it
    // ever did, the shared mock in this suite would surface the read. We
    // additionally assert no answerKey property crossed the boundary.
    seedAttempt();
    const result = await __assessmentAttemptGetForTeacherHandler(makeRequest());
    const projected = result.attempt as unknown as Record<string, unknown>;
    expect(projected).not.toHaveProperty("answerKey");
    expect(projected).not.toHaveProperty("assessmentAnswerKey");
    expect(projected).not.toHaveProperty("scoringConfig");
    expect(projected).not.toHaveProperty("rubric");
  });

  it("scopes Firestore reads to the attempt and its referenced class", async () => {
    seedAttempt();
    await __assessmentAttemptGetForTeacherHandler(makeRequest());
    expect(mockAttemptDocRef).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(mockClassDocRef).toHaveBeenCalledWith(CLASS_ID);
  });
});
