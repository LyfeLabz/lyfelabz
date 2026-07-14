import type { CallableRequest } from "firebase-functions/v2/https";

// Firestore admin mocks. Each typed reference used by the finalize handler
// is mocked separately so the transaction can be replayed deterministically
// per test. The transaction helper synthesizes a Transaction object with
// stubbed get/set/delete methods that read from these mocks.

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

const mockRequireDistrictContext = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockRunTransaction = jest.fn();

const mockSessionDocRef = jest.fn((id: string) => ({ __kind: "session", id }));
const mockRevisionDocRef = jest.fn((id: string) => ({
  __kind: "revision",
  id,
}));
const mockAnswerKeyDocRef = jest.fn((id: string) => ({
  __kind: "answerKey",
  id,
}));
const mockAttemptDocRef = jest.fn((id: string) => ({ __kind: "attempt", id }));
const mockAttemptCreationDocRef = jest.fn((id: string) => ({
  __kind: "attemptCreation",
  id,
}));

// Query builder returned by attemptsCollectionRef(). Chainable .where().
function makeQuery(hasLimit = false) {
  const self: Record<string, unknown> = {
    __kind: "attemptsQuery",
    __hasLimit: hasLimit,
    where: () => self,
    limit: () => {
      const limited = makeQuery(true);
      return limited;
    },
  };
  return self;
}

const mockAttemptsCollectionRef = jest.fn(() => makeQuery(false));

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    ASSESSMENT_SCHEMA_VERSION_V1: 1,
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
    runFirestoreTransaction: (fn: (tx: unknown) => Promise<unknown>) =>
      mockRunTransaction(fn),
    assessmentSessionDocRef: mockSessionDocRef,
    assessmentRevisionDocRef: mockRevisionDocRef,
    assessmentAnswerKeyDocRef: mockAnswerKeyDocRef,
    attemptDocRef: mockAttemptDocRef,
    attemptCreationDocRef: mockAttemptCreationDocRef,
    attemptsCollectionRef: mockAttemptsCollectionRef,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import {
  __assessmentAttemptsFinalizeHandler,
  attemptIdFor,
} from "./assessment-attempts-finalize";

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
const IDEMPOTENCY_KEY = "idem-1";
const ATTEMPT_NUMBER = 1;
const ATTEMPT_ID = `${ASSIGNMENT_ID}__${STUDENT_UID}__a${ATTEMPT_NUMBER}`;

const DEFAULT_RESPONSES = [
  { itemId: "q1", response: "A" },
  { itemId: "q2", response: "C" },
];

const DEFAULT_REVISION = {
  assessmentId: ASSESSMENT_ID,
  revisionOrdinal: 1,
  activityId: ACTIVITY_ID,
  itemOrderingRule: "authoredOrder",
  schemaVersion: 1,
  publishedAt: {},
  publishedBy: "deployment",
  items: [
    {
      itemId: "q1",
      itemType: "singleChoice",
      stem: "?",
      points: 1,
      options: [
        { optionId: "A", text: "A" },
        { optionId: "B", text: "B" },
      ],
    },
    {
      itemId: "q2",
      itemType: "singleChoice",
      stem: "?",
      points: 1,
      options: [
        { optionId: "A", text: "A" },
        { optionId: "B", text: "B" },
        { optionId: "C", text: "C" },
      ],
    },
  ],
};

const DEFAULT_ANSWER_KEY = {
  assessmentId: ASSESSMENT_ID,
  revisionOrdinal: 1,
  schemaVersion: 1,
  publishedAt: {},
  publishedBy: "deployment",
  items: [
    {
      itemId: "q1",
      correctOptionId: "A",
      points: 1,
      explanation: "Because A.",
    },
    {
      itemId: "q2",
      correctOptionId: "C",
      points: 1,
      explanation: "Because C.",
    },
  ],
};

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: STUDENT_UID,
  role: "student" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

type DocSnapshotInput = {
  exists: boolean;
  data?: () => unknown;
};

function makeSnap(input: DocSnapshotInput) {
  return {
    exists: input.exists,
    data: input.data ?? (() => undefined),
  };
}

// Fixtures for the transaction. Populated per-test.
type Fixture = {
  session?: unknown;
  revision?: unknown;
  answerKey?: unknown;
  existingAttempt?: unknown;
};

const fixture: Fixture = {};

const txSets: Array<{ ref: unknown; data: unknown }> = [];
const txDeletes: unknown[] = [];

function seedDefaultFixture(overrides: Partial<Fixture> = {}) {
  fixture.session = {
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
    startedAt: {},
    responses: DEFAULT_RESPONSES,
  };
  fixture.revision = DEFAULT_REVISION;
  fixture.answerKey = DEFAULT_ANSWER_KEY;
  fixture.existingAttempt = undefined;
  Object.assign(fixture, overrides);
}

function installTransactionRunner() {
  mockRunTransaction.mockImplementation((fn: (tx: unknown) => unknown) => {
    const tx = {
      get: (refOrQuery: {
        __kind?: string;
        __hasLimit?: boolean;
        id?: string;
      }) => {
        if (refOrQuery.__kind === "session") {
          return makeSnap({
            exists: fixture.session !== undefined,
            data: () => fixture.session,
          });
        }
        if (refOrQuery.__kind === "revision") {
          return makeSnap({
            exists: fixture.revision !== undefined,
            data: () => fixture.revision,
          });
        }
        if (refOrQuery.__kind === "answerKey") {
          return makeSnap({
            exists: fixture.answerKey !== undefined,
            data: () => fixture.answerKey,
          });
        }
        if (refOrQuery.__kind === "attempt") {
          // Attempt-collision precheck. Always empty in these tests.
          return makeSnap({ exists: false });
        }
        if (refOrQuery.__kind === "attemptsQuery") {
          if (refOrQuery.__hasLimit) {
            // Idempotency lookup.
            if (fixture.existingAttempt) {
              return {
                empty: false,
                size: 1,
                docs: [
                  {
                    id: ATTEMPT_ID,
                    data: () => fixture.existingAttempt,
                  },
                ],
              };
            }
            return { empty: true, size: 0, docs: [] };
          }
          // Attempt count.
          return { empty: true, size: 0, docs: [] };
        }
        throw new Error(`Unexpected ref kind: ${JSON.stringify(refOrQuery)}`);
      },
      set: (ref: unknown, data: unknown) => {
        txSets.push({ ref, data });
      },
      delete: (ref: unknown) => {
        txDeletes.push(ref);
      },
    };
    return fn(tx);
  });
}

function makeRequest(
  overrides: { data?: unknown } = {},
): CallableRequest<unknown> {
  const data =
    overrides.data === undefined
      ? { sessionId: SESSION_ID, idempotencyKey: IDEMPOTENCY_KEY }
      : overrides.data;
  return {
    data,
    auth: { uid: STUDENT_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

describe("assessmentAttemptsFinalize", () => {
  beforeEach(() => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockWriteAuditEvent.mockReset();
    mockWriteAuditEvent.mockResolvedValue({ eventId: "evt-1" });
    mockRunTransaction.mockReset();
    mockSessionDocRef.mockClear();
    mockRevisionDocRef.mockClear();
    mockAnswerKeyDocRef.mockClear();
    mockAttemptDocRef.mockClear();
    mockAttemptCreationDocRef.mockClear();
    mockAttemptsCollectionRef.mockClear();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
    txSets.length = 0;
    txDeletes.length = 0;
    fixture.session = undefined;
    fixture.revision = undefined;
    fixture.answerKey = undefined;
    fixture.existingAttempt = undefined;
    seedDefaultFixture();
    installTransactionRunner();
  });

  it("derives the canonical attempt identifier per §12", () => {
    expect(attemptIdFor(ASSIGNMENT_ID, STUDENT_UID, 1)).toBe(ATTEMPT_ID);
    expect(attemptIdFor("A", "B", 7)).toBe("A__B__a7");
  });

  it("scores a fully-correct submission and writes an immutable attempt", async () => {
    const result = await __assessmentAttemptsFinalizeHandler(makeRequest());

    expect(result.attemptId).toBe(ATTEMPT_ID);
    expect(result.attemptNumber).toBe(1);
    expect(result.score).toBe(2);
    expect(result.maxScore).toBe(2);
    expect(result.percentage).toBe(100);
    expect(result.replay).toBe(false);
    expect(result.itemResults).toEqual([
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
        isCorrect: true,
        pointsEarned: 1,
        correctOptionId: "C",
        explanation: "Because C.",
        studentResponse: "C",
      },
    ]);
    expect(txSets).toHaveLength(1);
    expect(txDeletes).toHaveLength(1);
    const write = txSets[0].data as Record<string, unknown>;
    expect(write.studentId).toBe(STUDENT_UID);
    expect(write.assignmentId).toBe(ASSIGNMENT_ID);
    expect(write.classId).toBe(CLASS_ID);
    expect(write.teacherId).toBe(TEACHER_UID);
    expect(write.schoolId).toBe(SCHOOL_ID);
    expect(write.districtId).toBe(DISTRICT_ID);
    expect(write.assessmentRevisionId).toBe(REVISION_ID);
    expect(write.attemptNumber).toBe(1);
    expect(write.score).toBe(2);
    expect(write.maxScore).toBe(2);
    expect(write.percentage).toBe(100);
    expect(write.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(write.submittedAt).toBe(SERVER_TIMESTAMP_SENTINEL);
    expect(write.responses).toEqual(DEFAULT_RESPONSES);
  });

  it("emits exactly one canonical audit event on success", async () => {
    await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    const audit = mockWriteAuditEvent.mock.calls[0][0];
    expect(audit.action).toBe("assessment.attemptFinalized");
    expect(audit.actorUserId).toBe(STUDENT_UID);
    expect(audit.actorRole).toBe("student");
    expect(audit.targetType).toBe("attempt");
    expect(audit.targetId).toBe(ATTEMPT_ID);
    expect(audit.schoolId).toBe(SCHOOL_ID);
    expect(audit.payload).toMatchObject({
      assignmentId: ASSIGNMENT_ID,
      assessmentRevisionId: REVISION_ID,
      attemptNumber: 1,
      score: 2,
      maxScore: 2,
      percentage: 100,
      districtId: DISTRICT_ID,
    });
  });

  it("scores a mixed submission with correct percentage", async () => {
    seedDefaultFixture({
      session: {
        ...(fixture.session as object),
        responses: [
          { itemId: "q1", response: "A" },
          { itemId: "q2", response: "B" },
        ],
      },
    });
    const result = await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(result.score).toBe(1);
    expect(result.maxScore).toBe(2);
    expect(result.percentage).toBe(50);
    expect(result.itemResults[0].isCorrect).toBe(true);
    expect(result.itemResults[1].isCorrect).toBe(false);
    expect(result.itemResults[1].studentResponse).toBe("B");
  });

  it("scores unanswered items as incorrect and null studentResponse", async () => {
    seedDefaultFixture({
      session: {
        ...(fixture.session as object),
        responses: [{ itemId: "q1", response: "A" }],
      },
    });
    const result = await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(result.score).toBe(1);
    expect(result.itemResults[1].isCorrect).toBe(false);
    expect(result.itemResults[1].studentResponse).toBeNull();
    expect(result.itemResults[1].pointsEarned).toBe(0);
  });

  it("scores an entirely unanswered submission as 0 percent", async () => {
    seedDefaultFixture({
      session: { ...(fixture.session as object), responses: [] },
    });
    const result = await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(2);
    expect(result.percentage).toBe(0);
    expect(result.itemResults.every((r) => !r.isCorrect)).toBe(true);
    expect(result.itemResults.every((r) => r.studentResponse === null)).toBe(
      true,
    );
  });

  it("scores an incorrect response whose value matches no option as incorrect", async () => {
    seedDefaultFixture({
      session: {
        ...(fixture.session as object),
        responses: [
          { itemId: "q1", response: "Z" },
          { itemId: "q2", response: "C" },
        ],
      },
    });
    const result = await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(result.itemResults[0].isCorrect).toBe(false);
    expect(result.itemResults[0].studentResponse).toBe("Z");
    expect(result.score).toBe(1);
  });

  it("ignores a response element whose itemId is not in the revision", async () => {
    seedDefaultFixture({
      session: {
        ...(fixture.session as object),
        responses: [
          { itemId: "q1", response: "A" },
          { itemId: "q2", response: "C" },
          { itemId: "ghost", response: "X" },
        ],
      },
    });
    const result = await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(result.score).toBe(2);
    expect(result.itemResults).toHaveLength(2);
    const write = txSets[0].data as Record<string, unknown>;
    // Persisted responses are the verbatim session responses.
    expect((write.responses as unknown[]).length).toBe(3);
  });

  it("returns an existing attempt on idempotent replay without writing again", async () => {
    seedDefaultFixture({
      existingAttempt: {
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
        responses: DEFAULT_RESPONSES,
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
        idempotencyKey: IDEMPOTENCY_KEY,
        submittedAt: {},
      },
    });
    const result = await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(result.replay).toBe(true);
    expect(result.attemptId).toBe(ATTEMPT_ID);
    expect(result.score).toBe(2);
    expect(txSets).toHaveLength(0);
    expect(txDeletes).toHaveLength(0);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a non-student caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "teacher-uid",
      role: "teacher",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("propagates canonical district-context failures", async () => {
    for (const code of [
      "unauthenticated",
      "account-inactive",
      "district-mismatch",
    ]) {
      mockRequireDistrictContext.mockReset();
      mockRequireDistrictContext.mockRejectedValueOnce(
        new PlatformError(code, code),
      );
      await expect(
        __assessmentAttemptsFinalizeHandler(makeRequest()),
      ).rejects.toMatchObject({ code });
    }
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("refuses a request payload that is not a structured object", async () => {
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest({ data: "nope" })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest({ data: [1, 2] })),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
  });

  it("refuses a request that carries a client-supplied score", async () => {
    for (const key of [
      "score",
      "maxScore",
      "percentage",
      "itemResults",
      "correctness",
      "isCorrect",
      "correctAnswer",
      "pointsEarned",
      "responses",
      "attemptNumber",
      "assessmentRevisionId",
    ]) {
      await expect(
        __assessmentAttemptsFinalizeHandler(
          makeRequest({
            data: {
              sessionId: SESSION_ID,
              idempotencyKey: IDEMPOTENCY_KEY,
              [key]: 999,
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "assessmentAttempts.invalidRequest" });
    }
  });

  it("refuses a missing or malformed sessionId", async () => {
    await expect(
      __assessmentAttemptsFinalizeHandler(
        makeRequest({ data: { idempotencyKey: IDEMPOTENCY_KEY } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidSessionId" });
    await expect(
      __assessmentAttemptsFinalizeHandler(
        makeRequest({
          data: { sessionId: "", idempotencyKey: IDEMPOTENCY_KEY },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidSessionId" });
    await expect(
      __assessmentAttemptsFinalizeHandler(
        makeRequest({
          data: { sessionId: "bad token!", idempotencyKey: IDEMPOTENCY_KEY },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentAttempts.invalidSessionId" });
  });

  it("refuses a missing or malformed idempotencyKey", async () => {
    await expect(
      __assessmentAttemptsFinalizeHandler(
        makeRequest({ data: { sessionId: SESSION_ID } }),
      ),
    ).rejects.toMatchObject({
      code: "assessmentAttempts.invalidIdempotencyKey",
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(
        makeRequest({ data: { sessionId: SESSION_ID, idempotencyKey: "" } }),
      ),
    ).rejects.toMatchObject({
      code: "assessmentAttempts.invalidIdempotencyKey",
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(
        makeRequest({
          data: { sessionId: SESSION_ID, idempotencyKey: "space here" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "assessmentAttempts.invalidIdempotencyKey",
    });
  });

  it("refuses when the session is missing", async () => {
    seedDefaultFixture({ session: undefined });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.sessionNotFound" });
    expect(txSets).toHaveLength(0);
    expect(txDeletes).toHaveLength(0);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a non-owner caller", async () => {
    seedDefaultFixture({
      session: { ...(fixture.session as object), studentId: "other" },
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.notOwned" });
    expect(txSets).toHaveLength(0);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a cross-district session", async () => {
    seedDefaultFixture({
      session: { ...(fixture.session as object), districtId: "other-district" },
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
  });

  it("refuses a cross-school session", async () => {
    seedDefaultFixture({
      session: { ...(fixture.session as object), schoolId: "other-school" },
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.forbidden" });
  });

  it("refuses an archived session as not live", async () => {
    seedDefaultFixture({
      session: { ...(fixture.session as object), status: "archived" },
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.sessionNotLive" });
    expect(txSets).toHaveLength(0);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses when the revision document is missing", async () => {
    seedDefaultFixture({ revision: undefined });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.revisionMissing" });
    expect(txSets).toHaveLength(0);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses when the answer-key document is missing", async () => {
    seedDefaultFixture({ answerKey: undefined });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.answerKeyMissing" });
    expect(txSets).toHaveLength(0);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a revision with a non-v1 schemaVersion", async () => {
    seedDefaultFixture({
      revision: { ...DEFAULT_REVISION, schemaVersion: 2 },
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.answerKeyIntegrity" });
  });

  it("refuses an answer key with a non-v1 schemaVersion", async () => {
    seedDefaultFixture({
      answerKey: { ...DEFAULT_ANSWER_KEY, schemaVersion: 2 },
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.answerKeyIntegrity" });
  });

  it("refuses when the revision item set does not equal the answer-key item set", async () => {
    seedDefaultFixture({
      answerKey: {
        ...DEFAULT_ANSWER_KEY,
        items: [
          {
            itemId: "q1",
            correctOptionId: "A",
            points: 1,
            explanation: "?",
          },
        ],
      },
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.answerKeyIntegrity" });
  });

  it("refuses when an answer-key correctOptionId is not among the revision options", async () => {
    seedDefaultFixture({
      answerKey: {
        ...DEFAULT_ANSWER_KEY,
        items: [
          {
            itemId: "q1",
            correctOptionId: "Z",
            points: 1,
            explanation: "?",
          },
          {
            itemId: "q2",
            correctOptionId: "C",
            points: 1,
            explanation: "?",
          },
        ],
      },
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.answerKeyIntegrity" });
  });

  it("refuses when a revision item has an unsupported itemType", async () => {
    seedDefaultFixture({
      revision: {
        ...DEFAULT_REVISION,
        items: [
          {
            ...DEFAULT_REVISION.items[0],
            itemType: "multipleSelect",
          },
          DEFAULT_REVISION.items[1],
        ],
      },
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.answerKeyIntegrity" });
  });

  it("refuses when a session response value is not a string in v1", async () => {
    seedDefaultFixture({
      session: {
        ...(fixture.session as object),
        responses: [{ itemId: "q1", response: 42 }],
      },
    });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentAttempts.malformedSession" });
  });

  it("resolves revision from the session's frozen assessmentRevisionId", async () => {
    // Simulate a scenario where the assessment's current revision is newer
    // than the session's frozen revision; the session's revision must be
    // used per §12.1. We assert by observing the ref id passed.
    await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(mockRevisionDocRef).toHaveBeenCalledWith(REVISION_ID);
    expect(mockAnswerKeyDocRef).toHaveBeenCalledWith(REVISION_ID);
  });

  it("computes deterministic scores across two invocations", async () => {
    const first = await __assessmentAttemptsFinalizeHandler(makeRequest());
    seedDefaultFixture();
    installTransactionRunner();
    txSets.length = 0;
    txDeletes.length = 0;
    mockWriteAuditEvent.mockClear();
    const second = await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(second.score).toBe(first.score);
    expect(second.maxScore).toBe(first.maxScore);
    expect(second.percentage).toBe(first.percentage);
    expect(second.itemResults).toEqual(first.itemResults);
  });

  it("rounds percentage to two decimals using banker's rounding", async () => {
    // 1 of 3 correct = 33.333...% -> 33.33
    seedDefaultFixture({
      revision: {
        ...DEFAULT_REVISION,
        items: [
          DEFAULT_REVISION.items[0],
          DEFAULT_REVISION.items[1],
          {
            itemId: "q3",
            itemType: "singleChoice",
            stem: "?",
            points: 1,
            options: [
              { optionId: "A", text: "A" },
              { optionId: "B", text: "B" },
            ],
          },
        ],
      },
      answerKey: {
        ...DEFAULT_ANSWER_KEY,
        items: [
          ...DEFAULT_ANSWER_KEY.items,
          {
            itemId: "q3",
            correctOptionId: "B",
            points: 1,
            explanation: "?",
          },
        ],
      },
      session: {
        ...(fixture.session as object),
        responses: [
          { itemId: "q1", response: "A" },
          { itemId: "q2", response: "B" },
          { itemId: "q3", response: "A" },
        ],
      },
    });
    const result = await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(result.score).toBe(1);
    expect(result.maxScore).toBe(3);
    expect(result.percentage).toBe(33.33);
  });

  it("performs the session delete inside the same transaction as the attempt write", async () => {
    await __assessmentAttemptsFinalizeHandler(makeRequest());
    expect(txSets).toHaveLength(1);
    expect(txDeletes).toHaveLength(1);
    // Both writes were recorded within the single transaction invocation.
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });

  it("never writes an attempt or emits an audit on integrity failure", async () => {
    seedDefaultFixture({ answerKey: undefined });
    await expect(
      __assessmentAttemptsFinalizeHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(txSets).toHaveLength(0);
    expect(txDeletes).toHaveLength(0);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("callable response omits raw answer-key material outside itemResults", async () => {
    const result = await __assessmentAttemptsFinalizeHandler(makeRequest());
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(
      [
        "attemptId",
        "attemptNumber",
        "itemResults",
        "maxScore",
        "percentage",
        "replay",
        "score",
      ].sort(),
    );
  });
});
