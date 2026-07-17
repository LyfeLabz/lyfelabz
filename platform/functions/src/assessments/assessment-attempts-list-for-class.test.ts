import type { CallableRequest } from "firebase-functions/v2/https";

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

const mockRequireDistrictContext = jest.fn();

type Query = {
  __kind: "attemptsQuery";
  __filters: Array<{ field: string; op: string; value: unknown }>;
  where: (field: string, op: string, value: unknown) => Query;
  get: () => Promise<{ docs: Array<{ id: string; data: () => unknown }> }>;
};

const attemptsFixture: Array<{ id: string; data: Record<string, unknown> }> =
  [];

const classFixture: {
  present: boolean;
  data: Record<string, unknown> | null;
} = { present: false, data: null };

function makeQuery(
  filters: Array<{ field: string; op: string; value: unknown }>,
): Query {
  const q: Query = {
    __kind: "attemptsQuery",
    __filters: filters,
    where(field, op, value) {
      return makeQuery([...filters, { field, op, value }]);
    },
    get: () => {
      const filtered = attemptsFixture.filter((row) =>
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
  return q;
}

const mockAttemptsCollectionRef = jest.fn(() => makeQuery([]));

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
    attemptsCollectionRef: mockAttemptsCollectionRef,
    classDocRef: mockClassDocRef,
  };
});

// Track resolver invocations so integration tests can assert per-request
// memoization: multiple attempts by the same student share a single
// resolver call.
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
    const cache = new Map<string, Promise<{
      studentId: string;
      displayName: string;
      source: "enrollmentOverride" | "userProfile" | "fallback";
    }>>();
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
import {
  __assessmentAttemptsListForClassHandler,
} from "./assessment-attempts-list-for-class";

const TEACHER_UID = "teacher-uid";
const OTHER_TEACHER_UID = "other-teacher-uid";
const STUDENT_A = "student-a";
const STUDENT_B = "student-b";
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

function seedAttempt(overrides: Record<string, unknown> = {}) {
  const id =
    (overrides.attemptId as string | undefined) ??
    `${ASSIGNMENT_ID}__${STUDENT_A}__a${attemptsFixture.length + 1}`;
  const data: Record<string, unknown> = {
    studentId: STUDENT_A,
    assignmentId: ASSIGNMENT_ID,
    classId: CLASS_ID,
    teacherId: TEACHER_UID,
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
    activityId: ACTIVITY_ID,
    assessmentId: ASSESSMENT_ID,
    assessmentRevisionId: REVISION_ID,
    attemptNumber: attemptsFixture.length + 1,
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
    idempotencyKey: `idem-${attemptsFixture.length + 1}`,
    submittedAt: { toMillis: () => 1_700_000_000_000 + attemptsFixture.length },
    ...overrides,
  };
  attemptsFixture.push({ id, data });
  return { id, data };
}

function makeRequest(
  overrides: { data?: unknown; auth?: unknown } = {},
): CallableRequest<unknown> {
  return {
    data: overrides.data ?? { classId: CLASS_ID },
    auth: (overrides.auth ?? { uid: TEACHER_UID, token: {} }) as never,
    rawRequest: {} as never,
  };
}

describe("assessmentAttemptsListForClass", () => {
  beforeEach(() => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockAttemptsCollectionRef.mockClear();
    mockClassDocRef.mockClear();
    mockLogInfo.mockReset();
    attemptsFixture.length = 0;
    classFixture.present = false;
    classFixture.data = null;
    resolverCalls.length = 0;
    displayNameFixture.clear();
    seedOwnedActiveClass();
  });

  // Positive cases

  it("owning active teacher can retrieve attempts for their class", async () => {
    seedAttempt({ attemptId: "a1" });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.classId).toBe(CLASS_ID);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].attemptId).toBe("a1");
  });

  it("returns multiple student attempts", async () => {
    seedAttempt({ attemptId: "a1", studentId: STUDENT_A });
    seedAttempt({ attemptId: "b1", studentId: STUDENT_B });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId).sort()).toEqual(
      ["a1", "b1"].sort(),
    );
  });

  it("returns multiple attempts by the same student", async () => {
    seedAttempt({ attemptId: "a1", studentId: STUDENT_A, attemptNumber: 1 });
    seedAttempt({ attemptId: "a2", studentId: STUDENT_A, attemptNumber: 2 });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.map((a) => a.attemptNumber).sort()).toEqual([1, 2]);
  });

  it("orders attempts newest first by submittedAt", async () => {
    seedAttempt({
      attemptId: "old",
      submittedAt: { toMillis: () => 1_000 },
    });
    seedAttempt({
      attemptId: "new",
      submittedAt: { toMillis: () => 5_000 },
    });
    seedAttempt({
      attemptId: "mid",
      submittedAt: { toMillis: () => 3_000 },
    });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("returns an empty array when the authorized class has no attempts", async () => {
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts).toEqual([]);
    expect(result.classId).toBe(CLASS_ID);
  });

  it("returns only attempts matching the requested class", async () => {
    seedAttempt({ attemptId: "in-class" });
    seedAttempt({ attemptId: "other-class", classId: OTHER_CLASS_ID });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual(["in-class"]);
  });

  it("returns exactly the approved projection fields", async () => {
    seedAttempt({ attemptId: "a1" });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    const first = result.attempts[0] as unknown as Record<string, unknown>;
    expect(Object.keys(first).sort()).toEqual(
      [
        "assessmentId",
        "assessmentRevisionId",
        "assignmentId",
        "attemptId",
        "attemptNumber",
        "maxScore",
        "percentage",
        "score",
        "status",
        "studentDisplayName",
        "studentId",
        "submittedAt",
      ].sort(),
    );
    expect(first.status).toBe("completed");
    expect(first.studentId).toBe(STUDENT_A);
  });

  it("never surfaces answer-key, scoring-internal, routing, or audit fields", async () => {
    seedAttempt();
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    const projected = result.attempts[0] as unknown as Record<string, unknown>;
    for (const forbidden of [
      "itemResults",
      "responses",
      "correctOptionId",
      "explanation",
      "idempotencyKey",
      "districtId",
      "schoolId",
      "teacherId",
      "classId",
      "activityId",
    ]) {
      expect(projected).not.toHaveProperty(forbidden);
    }
    const envelope = result as unknown as Record<string, unknown>;
    // The response envelope intentionally echoes classId (the client asked
    // for it); it never carries teacherId, schoolId, or districtId.
    expect(envelope).not.toHaveProperty("teacherId");
    expect(envelope).not.toHaveProperty("schoolId");
    expect(envelope).not.toHaveProperty("districtId");
  });

  // Authentication and role cases

  it("refuses an unauthenticated caller", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("unauthenticated", "auth required"),
    );
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest({ auth: undefined })),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("refuses a student caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      role: "student" as const,
    });
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("refuses a platformAdministrator caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      role: "platformAdministrator" as const,
    });
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("refuses an inactive teacher with account-inactive from the helper", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("account-inactive", "inactive teacher"),
    );
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
  });

  it("refuses a teacher with malformed claims per the district-context helper", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("claim-state-mismatch", "claims out of sync"),
    );
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-state-mismatch" });
  });

  // Class authorization and input cases

  it("refuses a missing classId", async () => {
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
  });

  it("refuses a blank classId", async () => {
    await expect(
      __assessmentAttemptsListForClassHandler(
        makeRequest({ data: { classId: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
  });

  it("refuses a non-string classId", async () => {
    await expect(
      __assessmentAttemptsListForClassHandler(
        makeRequest({ data: { classId: 42 } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
  });

  it("refuses a malformed classId token", async () => {
    await expect(
      __assessmentAttemptsListForClassHandler(
        makeRequest({ data: { classId: "not a token" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
  });

  it("refuses a non-object request payload", async () => {
    await expect(
      __assessmentAttemptsListForClassHandler({
        data: null,
        auth: { uid: TEACHER_UID, token: {} } as never,
        rawRequest: {} as never,
      }),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest({ data: [] })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
  });

  it("refuses a nonexistent class with classes.notFound", async () => {
    classFixture.present = false;
    classFixture.data = null;
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.notFound" });
  });

  it("refuses a same-district teacher who does not own the class", async () => {
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("refuses a cross-school teacher with classes.forbidden", async () => {
    seedOwnedActiveClass({ schoolId: OTHER_SCHOOL_ID });
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("cross-district context is refused because the class school does not match", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      districtId: OTHER_DISTRICT_ID,
      schoolId: OTHER_SCHOOL_ID,
    });
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("matching district alone does not authorize access", async () => {
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("matching school alone does not authorize access", async () => {
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptsListForClassHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("refuses any request that supplies an owner-scoping key", async () => {
    for (const key of [
      "studentId",
      "uid",
      "userId",
      "districtId",
      "schoolId",
      "teacherId",
    ]) {
      await expect(
        __assessmentAttemptsListForClassHandler(
          makeRequest({ data: { classId: CLASS_ID, [key]: "anything" } }),
        ),
      ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
    }
  });

  it("a forged classId cannot expose another teacher's class", async () => {
    seedOwnedActiveClass({ teacherId: OTHER_TEACHER_UID });
    await expect(
      __assessmentAttemptsListForClassHandler(
        makeRequest({ data: { classId: OTHER_CLASS_ID } }),
      ),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  // Data isolation cases

  it("excludes attempts belonging to another class", async () => {
    seedAttempt({ attemptId: "in-class" });
    seedAttempt({ attemptId: "other-class", classId: OTHER_CLASS_ID });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual(["in-class"]);
  });

  it("excludes attempts whose frozen districtId does not match the caller", async () => {
    // Data invariant should never happen; defense in depth still filters
    // the record silently instead of amplifying the invariant violation.
    seedAttempt({ attemptId: "same-district" });
    seedAttempt({
      attemptId: "cross-district",
      districtId: OTHER_DISTRICT_ID,
    });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual(["same-district"]);
  });

  it("excludes attempts whose frozen schoolId does not match the caller", async () => {
    seedAttempt({ attemptId: "same-school" });
    seedAttempt({ attemptId: "cross-school", schoolId: OTHER_SCHOOL_ID });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual(["same-school"]);
  });

  it("excludes attempts whose frozen teacherId does not match the caller", async () => {
    seedAttempt({ attemptId: "mine" });
    seedAttempt({ attemptId: "mismatched", teacherId: OTHER_TEACHER_UID });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual(["mine"]);
  });

  it("includes attempts across unrelated assignments belonging to the same class", async () => {
    seedAttempt({ attemptId: "assignment-1", assignmentId: ASSIGNMENT_ID });
    seedAttempt({
      attemptId: "assignment-2",
      assignmentId: OTHER_ASSIGNMENT_ID,
    });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId).sort()).toEqual(
      ["assignment-1", "assignment-2"].sort(),
    );
  });

  it("never returns another teacher's attempts even when they share a district", async () => {
    seedAttempt({
      attemptId: "mine",
      teacherId: TEACHER_UID,
      classId: CLASS_ID,
    });
    seedAttempt({
      attemptId: "other-teacher-other-class",
      teacherId: OTHER_TEACHER_UID,
      classId: OTHER_CLASS_ID,
    });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual(["mine"]);
  });

  it("scopes the Firestore query to the requested class", async () => {
    seedAttempt();
    await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(mockAttemptsCollectionRef).toHaveBeenCalled();
    expect(mockClassDocRef).toHaveBeenCalledWith(CLASS_ID);
  });

  // Display-name integration

  it("attaches the canonical resolved display name to every returned attempt", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    displayNameFixture.set(STUDENT_B, "Bailey Chen");
    seedAttempt({ attemptId: "a1", studentId: STUDENT_A });
    seedAttempt({ attemptId: "b1", studentId: STUDENT_B });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    const byId = Object.fromEntries(
      result.attempts.map((a) => [a.attemptId, a] as const),
    );
    expect(byId.a1.studentDisplayName).toBe("Alex Rivera");
    expect(byId.b1.studentDisplayName).toBe("Bailey Chen");
  });

  it("returns the canonical fallback when the resolver reports no name", async () => {
    seedAttempt({ attemptId: "a1", studentId: STUDENT_A });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts[0].studentDisplayName).toBe(FALLBACK);
  });

  it("reuses one resolved display name for multiple attempts by the same student", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    seedAttempt({ attemptId: "a1", studentId: STUDENT_A, attemptNumber: 1 });
    seedAttempt({ attemptId: "a2", studentId: STUDENT_A, attemptNumber: 2 });
    seedAttempt({ attemptId: "a3", studentId: STUDENT_A, attemptNumber: 3 });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(
      result.attempts.every((a) => a.studentDisplayName === "Alex Rivera"),
    ).toBe(true);
    const callsForA = resolverCalls.filter((c) => c.studentId === STUDENT_A);
    expect(callsForA).toHaveLength(1);
  });

  it("resolves each unique student independently", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    displayNameFixture.set(STUDENT_B, "Bailey Chen");
    seedAttempt({ attemptId: "a1", studentId: STUDENT_A });
    seedAttempt({ attemptId: "b1", studentId: STUDENT_B });
    await __assessmentAttemptsListForClassHandler(makeRequest());
    const ids = resolverCalls.map((c) => c.studentId).sort();
    expect(ids).toEqual([STUDENT_A, STUDENT_B].sort());
  });

  it("passes the trusted class, school, and district scope to the resolver", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    seedAttempt({ studentId: STUDENT_A });
    await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(resolverCalls[0].scope).toEqual({
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
  });

  it("never resolves a display name for an attempt that failed the ownership filter", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    displayNameFixture.set(STUDENT_B, "Leaked");
    seedAttempt({ attemptId: "mine", studentId: STUDENT_A });
    seedAttempt({
      attemptId: "cross-class",
      studentId: STUDENT_B,
      classId: OTHER_CLASS_ID,
    });
    seedAttempt({
      attemptId: "cross-district",
      studentId: STUDENT_B,
      districtId: OTHER_DISTRICT_ID,
    });
    seedAttempt({
      attemptId: "cross-school",
      studentId: STUDENT_B,
      schoolId: OTHER_SCHOOL_ID,
    });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual(["mine"]);
    expect(resolverCalls.map((c) => c.studentId)).toEqual([STUDENT_A]);
  });

  it("preserves all existing sensitive-field exclusions when the display name is present", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    seedAttempt();
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    const projected = result.attempts[0] as unknown as Record<string, unknown>;
    for (const forbidden of [
      "itemResults",
      "responses",
      "correctOptionId",
      "explanation",
      "idempotencyKey",
      "districtId",
      "schoolId",
      "teacherId",
      "classId",
      "activityId",
    ]) {
      expect(projected).not.toHaveProperty(forbidden);
    }
  });

  it("preserves newest-first ordering when display names are attached", async () => {
    displayNameFixture.set(STUDENT_A, "Alex Rivera");
    seedAttempt({ attemptId: "old", submittedAt: { toMillis: () => 1_000 } });
    seedAttempt({ attemptId: "new", submittedAt: { toMillis: () => 5_000 } });
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual(["new", "old"]);
  });

  it("returns an empty array for an empty class without touching the resolver", async () => {
    const result = await __assessmentAttemptsListForClassHandler(makeRequest());
    expect(result.attempts).toEqual([]);
    expect(resolverCalls).toHaveLength(0);
  });
});
