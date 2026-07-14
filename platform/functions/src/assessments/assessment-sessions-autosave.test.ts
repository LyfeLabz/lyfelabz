import type { CallableRequest } from "firebase-functions/v2/https";

const mockSessionGet = jest.fn();
const mockSessionUpdate = jest.fn();

const mockSessionDocRef = jest.fn(() => ({ get: mockSessionGet }));
const mockSessionAutosaveDocRef = jest.fn(() => ({ update: mockSessionUpdate }));

const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
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
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    assessmentSessionDocRef: mockSessionDocRef,
    assessmentSessionAutosaveDocRef: mockSessionAutosaveDocRef,
    requireDistrictContext: mockRequireDistrictContext,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assessmentSessionsAutosaveHandler } from "./assessment-sessions-autosave";

const STUDENT_UID = "student-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-abc";
const TEACHER_UID = "teacher-uid";
const ASSIGNMENT_ID = "assign-1";
const LESSON_SLUG = "lesson_g7_earths-layers";
const LESSON_VERSION = "1";
const ACTIVITY_ID = LESSON_SLUG;
const ASSESSMENT_ID = `assessment_${LESSON_SLUG}`;
const REVISION_ID = `assessment_${LESSON_SLUG}__r${LESSON_VERSION}`;
const SESSION_ID = `${ASSIGNMENT_ID}__${STUDENT_UID}__1`;

const RESPONSES = [
  { itemId: "q1", response: "A" },
  { itemId: "q2", response: { choice: 3 } },
];

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: STUDENT_UID,
  role: "student" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  overrides: { data?: unknown } = {},
): CallableRequest<unknown> {
  const data =
    overrides.data === undefined
      ? { sessionId: SESSION_ID, responses: RESPONSES }
      : overrides.data;
  return {
    data,
    auth: { uid: STUDENT_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function liveSessionSnapshot(overrides: Record<string, unknown> = {}) {
  return {
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
      sessionOrdinal: 1,
      status: "live",
      startedAt: {} as never,
      ...overrides,
    }),
  };
}

describe("assessmentSessionsAutosave", () => {
  beforeEach(() => {
    mockSessionGet.mockReset();
    mockSessionUpdate.mockReset();
    mockSessionDocRef.mockClear();
    mockSessionAutosaveDocRef.mockClear();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("persists a canonical autosave write and stamps lastActivityAt", async () => {
    mockSessionGet.mockResolvedValueOnce(liveSessionSnapshot());
    mockSessionUpdate.mockResolvedValueOnce(undefined);

    const result = await __assessmentSessionsAutosaveHandler(makeRequest());

    expect(mockSessionDocRef).toHaveBeenCalledWith(SESSION_ID);
    expect(mockSessionAutosaveDocRef).toHaveBeenCalledWith(SESSION_ID);
    expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      responses: [
        { itemId: "q1", response: "A" },
        { itemId: "q2", response: { choice: 3 } },
      ],
      lastActivityAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(result).toEqual({ sessionId: SESSION_ID, persisted: true });
  });

  it("coalesces an identical replay without a second write", async () => {
    mockSessionGet.mockResolvedValueOnce(
      liveSessionSnapshot({ responses: RESPONSES }),
    );

    const result = await __assessmentSessionsAutosaveHandler(makeRequest());

    expect(result).toEqual({ sessionId: SESSION_ID, persisted: false });
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it("writes when responses differ from the stored snapshot", async () => {
    mockSessionGet.mockResolvedValueOnce(
      liveSessionSnapshot({
        responses: [{ itemId: "q1", response: "A" }],
      }),
    );
    mockSessionUpdate.mockResolvedValueOnce(undefined);

    const result = await __assessmentSessionsAutosaveHandler(makeRequest());

    expect(result).toEqual({ sessionId: SESSION_ID, persisted: true });
    expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
  });

  it("coalesces an empty payload against a session with no stored responses", async () => {
    mockSessionGet.mockResolvedValueOnce(liveSessionSnapshot());

    const result = await __assessmentSessionsAutosaveHandler(
      makeRequest({ data: { sessionId: SESSION_ID, responses: [] } }),
    );

    expect(result).toEqual({ sessionId: SESSION_ID, persisted: false });
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-owner caller with notOwned", async () => {
    mockSessionGet.mockResolvedValueOnce(
      liveSessionSnapshot({ studentId: "other-student" }),
    );
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.notOwned" });
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a cross-district session with district-mismatch", async () => {
    mockSessionGet.mockResolvedValueOnce(
      liveSessionSnapshot({ districtId: "other-district" }),
    );
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a cross-school session with forbidden", async () => {
    mockSessionGet.mockResolvedValueOnce(
      liveSessionSnapshot({ schoolId: "other-school" }),
    );
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.forbidden" });
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it("rejects an archived session with sessionNotLive", async () => {
    mockSessionGet.mockResolvedValueOnce(
      liveSessionSnapshot({ status: "archived" }),
    );
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.sessionNotLive" });
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a missing session with sessionNotFound", async () => {
    mockSessionGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.sessionNotFound" });
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockSessionGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "inactive"),
    );
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockSessionGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
    expect(mockSessionGet).not.toHaveBeenCalled();
  });

  it("rejects a non-student active caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "teacher-uid",
      role: "teacher",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockSessionGet).not.toHaveBeenCalled();
  });

  it("rejects a non-object request payload", async () => {
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidRequest" });
    await expect(
      __assessmentSessionsAutosaveHandler(makeRequest({ data: "nope" })),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidRequest" });
    expect(mockSessionGet).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed sessionId", async () => {
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({ data: { responses: [] } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidSessionId" });
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({ data: { sessionId: "", responses: [] } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidSessionId" });
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({
          data: { sessionId: "not a token!", responses: [] },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidSessionId" });
    expect(mockSessionGet).not.toHaveBeenCalled();
  });

  it("rejects a responses payload that is not an array", async () => {
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({ data: { sessionId: SESSION_ID, responses: "nope" } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
    expect(mockSessionGet).not.toHaveBeenCalled();
  });

  it("rejects an element with a missing or malformed itemId", async () => {
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({
          data: { sessionId: SESSION_ID, responses: [{ response: "A" }] },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({
          data: {
            sessionId: SESSION_ID,
            responses: [{ itemId: "bad token!", response: "A" }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
  });

  it("rejects an element missing the response field", async () => {
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({
          data: { sessionId: SESSION_ID, responses: [{ itemId: "q1" }] },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
  });

  it("rejects an element that carries an unexpected key", async () => {
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({
          data: {
            sessionId: SESSION_ID,
            responses: [{ itemId: "q1", response: "A", extra: 1 }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
  });

  it("rejects duplicate itemIds within a single autosave", async () => {
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({
          data: {
            sessionId: SESSION_ID,
            responses: [
              { itemId: "q1", response: "A" },
              { itemId: "q1", response: "B" },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
  });

  it("rejects a scoring artifact smuggled into a response value", async () => {
    for (const forbidden of [
      "score",
      "correctness",
      "isCorrect",
      "correctAnswer",
      "pointsEarned",
      "explanation",
    ]) {
      await expect(
        __assessmentSessionsAutosaveHandler(
          makeRequest({
            data: {
              sessionId: SESSION_ID,
              responses: [
                { itemId: "q1", response: { choice: "A", [forbidden]: 1 } },
              ],
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
    }
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-serializable response value", async () => {
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({
          data: {
            sessionId: SESSION_ID,
            responses: [{ itemId: "q1", response: () => 1 }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({
          data: {
            sessionId: SESSION_ID,
            responses: [{ itemId: "q1", response: Number.POSITIVE_INFINITY }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
  });

  it("rejects an autosave that exceeds the response-count cap", async () => {
    const responses = [];
    for (let i = 0; i < 201; i += 1) {
      responses.push({ itemId: `q${i}`, response: i });
    }
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({ data: { sessionId: SESSION_ID, responses } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
  });

  it("rejects an autosave that exceeds the serialized-size cap", async () => {
    const large = "x".repeat(70 * 1024);
    await expect(
      __assessmentSessionsAutosaveHandler(
        makeRequest({
          data: {
            sessionId: SESSION_ID,
            responses: [{ itemId: "q1", response: large }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidResponses" });
  });
});
