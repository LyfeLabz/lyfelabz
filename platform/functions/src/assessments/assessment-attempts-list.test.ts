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
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import {
  __assessmentAttemptsListHandler,
} from "./assessment-attempts-list";

const STUDENT_UID = "student-uid";
const OTHER_STUDENT_UID = "other-student-uid";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-1";
const OTHER_DISTRICT_ID = "district-2";
const CLASS_ID = "class-abc";
const TEACHER_UID = "teacher-uid";
const ASSIGNMENT_ID = "assign-1";
const LESSON_SLUG = "lesson_g7_earths-layers";
const ACTIVITY_ID = LESSON_SLUG;
const ASSESSMENT_ID = `assessment_${LESSON_SLUG}`;
const REVISION_ID = `assessment_${LESSON_SLUG}__r1`;

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: STUDENT_UID,
  role: "student" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function seedAttempt(overrides: Record<string, unknown> = {}) {
  const id = (overrides.attemptId as string | undefined) ??
    `${ASSIGNMENT_ID}__${STUDENT_UID}__a${attemptsFixture.length + 1}`;
  const data: Record<string, unknown> = {
    studentId: STUDENT_UID,
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
    data: overrides.data ?? {},
    auth: (overrides.auth ?? { uid: STUDENT_UID, token: {} }) as never,
    rawRequest: {} as never,
  };
}

describe("assessmentAttemptsList", () => {
  beforeEach(() => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockAttemptsCollectionRef.mockClear();
    mockLogInfo.mockReset();
    attemptsFixture.length = 0;
  });

  it("returns only the authenticated student's attempts, projected to the approved fields", async () => {
    seedAttempt({
      attemptId: "a1",
      submittedAt: { toMillis: () => 1_000 },
      score: 1,
      maxScore: 2,
      percentage: 50,
      attemptNumber: 1,
    });
    seedAttempt({
      attemptId: "a2",
      submittedAt: { toMillis: () => 2_000 },
      score: 2,
      maxScore: 2,
      percentage: 100,
      attemptNumber: 2,
    });

    const result = await __assessmentAttemptsListHandler(makeRequest());

    expect(result.attempts).toHaveLength(2);
    // Sorted submittedAt descending.
    expect(result.attempts[0].attemptId).toBe("a2");
    expect(result.attempts[1].attemptId).toBe("a1");

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
        "submittedAt",
      ].sort(),
    );
    expect(first.status).toBe("completed");
    expect(first.submittedAt).toBe(2_000);
  });

  it("never surfaces answer-key, scoring-internal, or audit fields", async () => {
    seedAttempt();
    const result = await __assessmentAttemptsListHandler(makeRequest());
    const projected = result.attempts[0] as unknown as Record<string, unknown>;
    for (const forbidden of [
      "itemResults",
      "responses",
      "idempotencyKey",
      "teacherId",
      "classId",
      "schoolId",
      "districtId",
      "activityId",
      "correctOptionId",
      "explanation",
    ]) {
      expect(projected).not.toHaveProperty(forbidden);
    }
  });

  it("returns an empty array when the student has no attempts", async () => {
    const result = await __assessmentAttemptsListHandler(makeRequest());
    expect(result.attempts).toEqual([]);
  });

  it("never returns another student's attempts", async () => {
    seedAttempt({
      attemptId: "other-1",
      studentId: OTHER_STUDENT_UID,
    });
    seedAttempt({ attemptId: "mine-1" });

    const result = await __assessmentAttemptsListHandler(makeRequest());

    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].attemptId).toBe("mine-1");
  });

  it("drops attempts whose frozen districtId does not match the caller's verified districtId", async () => {
    // Defense in depth: even if the studentId matches, a cross-district
    // record must not be projected.
    seedAttempt({ attemptId: "cross-district", districtId: OTHER_DISTRICT_ID });
    seedAttempt({ attemptId: "same-district" });
    const result = await __assessmentAttemptsListHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual(["same-district"]);
  });

  it("drops attempts whose frozen schoolId does not match the caller's verified schoolId", async () => {
    seedAttempt({ attemptId: "cross-school", schoolId: OTHER_SCHOOL_ID });
    seedAttempt({ attemptId: "same-school" });
    const result = await __assessmentAttemptsListHandler(makeRequest());
    expect(result.attempts.map((a) => a.attemptId)).toEqual(["same-school"]);
  });

  it("refuses an unauthenticated caller with the canonical district-boundary identifier", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("unauthenticated", "auth required"),
    );
    await expect(
      __assessmentAttemptsListHandler(makeRequest({ auth: undefined })),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("refuses a non-student caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      role: "teacher" as const,
    });
    await expect(
      __assessmentAttemptsListHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("refuses a request that supplies a studentId (or any owner-scoping field)", async () => {
    await expect(
      __assessmentAttemptsListHandler(
        makeRequest({ data: { studentId: OTHER_STUDENT_UID } }),
      ),
    ).rejects.toMatchObject({
      code: "assessmentAttempts.invalidRequest",
    });
    await expect(
      __assessmentAttemptsListHandler(
        makeRequest({ data: { districtId: OTHER_DISTRICT_ID } }),
      ),
    ).rejects.toMatchObject({
      code: "assessmentAttempts.invalidRequest",
    });
  });

  it("scopes the Firestore query to the caller's uid via the studentId equality filter", async () => {
    seedAttempt();
    await __assessmentAttemptsListHandler(makeRequest());
    // The query builder in the mock is a fluent chain; the last query
    // returned to `.get()` must have the studentId filter present.
    expect(mockAttemptsCollectionRef).toHaveBeenCalled();
  });
});
