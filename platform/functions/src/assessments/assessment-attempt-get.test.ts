import type { CallableRequest } from "firebase-functions/v2/https";

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

const mockRequireDistrictContext = jest.fn();

let attemptSnapshot: {
  exists: boolean;
  data: () => unknown;
} = { exists: false, data: () => undefined };

const mockAttemptDocRef = jest.fn((id: string) => ({
  __kind: "attempt",
  id,
  get: () => Promise.resolve(attemptSnapshot),
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
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assessmentAttemptGetHandler } from "./assessment-attempt-get";

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
const ATTEMPT_ID = `${ASSIGNMENT_ID}__${STUDENT_UID}__a1`;

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: STUDENT_UID,
  role: "student" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function seedAttempt(overrides: Record<string, unknown> = {}) {
  attemptSnapshot = {
    exists: true,
    data: () => ({
      studentId: STUDENT_UID,
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
    data:
      "data" in overrides ? overrides.data : { attemptId: ATTEMPT_ID },
    auth: (overrides.auth ?? { uid: STUDENT_UID, token: {} }) as never,
    rawRequest: {} as never,
  };
}

describe("assessmentAttemptGet", () => {
  beforeEach(() => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockAttemptDocRef.mockClear();
    mockLogInfo.mockReset();
    attemptSnapshot = { exists: false, data: () => undefined };
  });

  it("returns the caller's own attempt, projected to the approved fields", async () => {
    seedAttempt();
    const result = await __assessmentAttemptGetHandler(makeRequest());
    const projected = result.attempt as unknown as Record<string, unknown>;
    expect(projected.attemptId).toBe(ATTEMPT_ID);
    expect(projected.assignmentId).toBe(ASSIGNMENT_ID);
    expect(projected.assessmentId).toBe(ASSESSMENT_ID);
    expect(projected.assessmentRevisionId).toBe(REVISION_ID);
    expect(projected.score).toBe(2);
    expect(projected.maxScore).toBe(2);
    expect(projected.percentage).toBe(100);
    expect(projected.attemptNumber).toBe(1);
    expect(projected.submittedAt).toBe(1_700_000_000_000);
    expect(projected.status).toBe("completed");
  });

  it("never surfaces answer-key, scoring-internal, or audit fields", async () => {
    seedAttempt();
    const result = await __assessmentAttemptGetHandler(makeRequest());
    const projected = result.attempt as unknown as Record<string, unknown>;
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

  it("refuses an unauthenticated caller with the canonical district-boundary identifier", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("unauthenticated", "auth required"),
    );
    await expect(
      __assessmentAttemptGetHandler(makeRequest({ auth: undefined })),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("refuses a non-student caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_DISTRICT_CONTEXT,
      role: "teacher" as const,
    });
    seedAttempt();
    await expect(
      __assessmentAttemptGetHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("refuses when the attempt does not exist", async () => {
    attemptSnapshot = { exists: false, data: () => undefined };
    await expect(
      __assessmentAttemptGetHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.notFound" });
  });

  it("refuses when the attempt belongs to another student", async () => {
    seedAttempt({ studentId: OTHER_STUDENT_UID });
    await expect(
      __assessmentAttemptGetHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.notOwned" });
  });

  it("refuses cross-district access with the canonical district-mismatch identifier", async () => {
    seedAttempt({ districtId: OTHER_DISTRICT_ID });
    await expect(
      __assessmentAttemptGetHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
  });

  it("refuses cross-school access with the canonical forbidden identifier", async () => {
    seedAttempt({ schoolId: OTHER_SCHOOL_ID });
    await expect(
      __assessmentAttemptGetHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.forbidden" });
  });

  it("refuses a missing or malformed attemptId with invalidAttemptId", async () => {
    await expect(
      __assessmentAttemptGetHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidAttemptId" });
    await expect(
      __assessmentAttemptGetHandler(
        makeRequest({ data: { attemptId: "bad id with spaces" } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidAttemptId" });
  });

  it("refuses a request that supplies any ownership-scoping field", async () => {
    await expect(
      __assessmentAttemptGetHandler(
        makeRequest({
          data: { attemptId: ATTEMPT_ID, studentId: OTHER_STUDENT_UID },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
    await expect(
      __assessmentAttemptGetHandler(
        makeRequest({
          data: { attemptId: ATTEMPT_ID, districtId: OTHER_DISTRICT_ID },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
  });

  it("refuses a non-object payload with invalidRequest", async () => {
    await expect(
      __assessmentAttemptGetHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
    await expect(
      __assessmentAttemptGetHandler(makeRequest({ data: "hi" })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
  });
});
