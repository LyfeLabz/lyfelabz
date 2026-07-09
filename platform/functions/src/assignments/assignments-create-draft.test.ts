import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockAssignmentGet = jest.fn();
const mockAssignmentSet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentCreationDocRef = jest.fn(() => ({ set: mockAssignmentSet }));

const mockWriteAuditEvent = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

class FakeTimestamp {
  constructor(readonly millis: number) {}
  toMillis(): number {
    return this.millis;
  }
}

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
  Timestamp: {
    fromMillis: (millis: number) => new FakeTimestamp(millis),
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
    classDocRef: mockClassDocRef,
    assignmentDocRef: mockAssignmentDocRef,
    assignmentCreationDocRef: mockAssignmentCreationDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { __assignmentsCreateDraftHandler } from "./assignments-create-draft";

const VALID_DATA = {
  assignmentId: "assign-1",
  classId: "class-abc",
  lessonSlug: "lesson_g7_earths-layers",
  lessonVersion: "1",
  mode: "classroom",
};

function makeRequest(
  overrides: {
    uid?: string;
    data?: unknown;
    hasAuth?: boolean;
    token?: Record<string, unknown> | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "teacher-uid";
  const data =
    overrides.data === undefined ? { ...VALID_DATA } : overrides.data;
  const token =
    overrides.token === undefined
      ? { role: "teacher", schoolId: "school-a" }
      : overrides.token;
  return {
    data,
    auth: hasAuth
      ? ({ uid, token: token ?? undefined } as never)
      : undefined,
    rawRequest: {} as never,
  };
}

function classSnapshot(
  overrides: {
    teacherId?: string;
    schoolId?: string;
    status?: "active" | "archived";
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      teacherId: overrides.teacherId ?? "teacher-uid",
      schoolId: overrides.schoolId ?? "school-a",
      title: "Grade 7 Science",
      grade: "7",
      block: "C",
      joinCode: "ABCD1234",
      status: overrides.status ?? "active",
      createdAt: {} as never,
    }),
  };
}

function absentAssignmentSnapshot() {
  return { exists: false, data: () => undefined };
}

function existingAssignmentSnapshot(
  overrides: Record<string, unknown> = {},
) {
  return {
    exists: true,
    data: () => ({
      classId: "class-abc",
      teacherId: "teacher-uid",
      schoolId: "school-a",
      lessonSlug: "lesson_g7_earths-layers",
      lessonVersion: "1",
      mode: "classroom",
      status: "draft",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

describe("assignmentsCreateDraft", () => {
  beforeEach(() => {
    mockClassGet.mockReset();
    mockAssignmentGet.mockReset();
    mockAssignmentSet.mockReset();
    mockClassDocRef.mockClear();
    mockAssignmentDocRef.mockClear();
    mockAssignmentCreationDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("creates a canonical draft assignment and emits a single audit event", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockAssignmentGet.mockResolvedValueOnce(absentAssignmentSnapshot());
    mockAssignmentSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __assignmentsCreateDraftHandler(makeRequest());

    expect(mockClassDocRef).toHaveBeenCalledWith("class-abc");
    expect(mockAssignmentDocRef).toHaveBeenCalledWith("assign-1");
    expect(mockAssignmentCreationDocRef).toHaveBeenCalledWith("assign-1");
    expect(mockAssignmentSet).toHaveBeenCalledTimes(1);
    expect(mockAssignmentSet).toHaveBeenCalledWith({
      classId: "class-abc",
      teacherId: "teacher-uid",
      schoolId: "school-a",
      lessonSlug: "lesson_g7_earths-layers",
      lessonVersion: "1",
      mode: "classroom",
      status: "draft",
      createdAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "assignments.created",
      targetType: "assignment",
      targetId: "assign-1",
      schoolId: "school-a",
      payload: {
        classId: "class-abc",
        lessonSlug: "lesson_g7_earths-layers",
        lessonVersion: "1",
        mode: "classroom",
      },
    });
    expect(result).toEqual({
      assignmentId: "assign-1",
      status: "draft",
      alreadyCreated: false,
    });
  });

  it("preserves optional metadata fields in the write payload", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockAssignmentGet.mockResolvedValueOnce(absentAssignmentSnapshot());
    mockAssignmentSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __assignmentsCreateDraftHandler(
      makeRequest({
        data: {
          ...VALID_DATA,
          title: "Layers Warm-up",
          instructions: "Read the intro and answer the questions.",
          windowClosesAt: "2026-09-01T23:59:00Z",
          availableAt: "2026-08-25T08:00:00Z",
        },
      }),
    );

    const written = mockAssignmentSet.mock.calls[0][0];
    expect(written.title).toBe("Layers Warm-up");
    expect(written.instructions).toBe("Read the intro and answer the questions.");
    expect(written.windowClosesAt.toMillis()).toBe(
      Date.parse("2026-09-01T23:59:00Z"),
    );
    expect(written.availableAt.toMillis()).toBe(
      Date.parse("2026-08-25T08:00:00Z"),
    );
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(
      __assignmentsCreateDraftHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "assignments.unauthenticated" });
    expect(mockClassGet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects non-teacher callers", async () => {
    await expect(
      __assignmentsCreateDraftHandler(
        makeRequest({ token: { role: "student", schoolId: "school-a" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.unauthorized" });
    await expect(
      __assignmentsCreateDraftHandler(makeRequest({ token: {} })),
    ).rejects.toMatchObject({ code: "assignments.unauthorized" });
    await expect(
      __assignmentsCreateDraftHandler(makeRequest({ token: null })),
    ).rejects.toMatchObject({ code: "assignments.unauthorized" });
  });

  it("rejects a teacher missing the schoolId claim", async () => {
    await expect(
      __assignmentsCreateDraftHandler(
        makeRequest({ token: { role: "teacher" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.unauthorized" });
    await expect(
      __assignmentsCreateDraftHandler(
        makeRequest({ token: { role: "teacher", schoolId: "" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.unauthorized" });
  });

  it("rejects non-object request payloads", async () => {
    await expect(
      __assignmentsCreateDraftHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
    await expect(
      __assignmentsCreateDraftHandler(makeRequest({ data: "nope" })),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
  });

  it("rejects invalid ids, slugs, versions, and modes", async () => {
    await expect(
      __assignmentsCreateDraftHandler(
        makeRequest({ data: { ...VALID_DATA, assignmentId: "bad/id" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
    await expect(
      __assignmentsCreateDraftHandler(
        makeRequest({ data: { ...VALID_DATA, classId: "" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidClassId" });
    await expect(
      __assignmentsCreateDraftHandler(
        makeRequest({ data: { ...VALID_DATA, lessonSlug: "" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidLessonSlug" });
    await expect(
      __assignmentsCreateDraftHandler(
        makeRequest({ data: { ...VALID_DATA, lessonVersion: "bad version!" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidLessonVersion" });
    await expect(
      __assignmentsCreateDraftHandler(
        makeRequest({ data: { ...VALID_DATA, mode: "graded" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidMode" });
  });

  it("rejects a malformed windowClosesAt or availableAt", async () => {
    await expect(
      __assignmentsCreateDraftHandler(
        makeRequest({
          data: { ...VALID_DATA, windowClosesAt: "not-a-date" },
        }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidWindowClosesAt" });
    await expect(
      __assignmentsCreateDraftHandler(
        makeRequest({
          data: { ...VALID_DATA, availableAt: "" },
        }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAvailableAt" });
  });

  it("rejects a class-not-found target", async () => {
    mockClassGet.mockResolvedValueOnce({ exists: false, data: () => undefined });
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.classNotFound" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("rejects a cross-teacher class ownership mismatch", async () => {
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ teacherId: "someone-else" }),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
    expect(mockAssignmentSet).not.toHaveBeenCalled();
  });

  it("rejects a cross-school class ownership mismatch", async () => {
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("rejects a non-active class with assignments.invalidClassStatus", async () => {
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ status: "archived" }),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidClassStatus" });
  });

  it("is idempotent when the same draft already exists", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());

    const result = await __assignmentsCreateDraftHandler(makeRequest());

    expect(result).toEqual({
      assignmentId: "assign-1",
      status: "draft",
      alreadyCreated: true,
    });
    expect(mockAssignmentSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a conflict when an existing document has different canonical fields", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ lessonSlug: "lesson_g7_water-cycle" }),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.conflict" });
    expect(mockAssignmentSet).not.toHaveBeenCalled();
  });

  it("rejects a conflict when the existing draft is already past draft", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ status: "published" }),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.conflict" });
  });

  it("orders side effects: create write, then audit event", async () => {
    const calls: string[] = [];
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockAssignmentGet.mockResolvedValueOnce(absentAssignmentSnapshot());
    mockAssignmentSet.mockImplementationOnce(() => {
      calls.push("set");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __assignmentsCreateDraftHandler(makeRequest());

    expect(calls).toEqual(["set", "audit"]);
  });

  it("propagates a downstream write failure and does not write audit", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockAssignmentGet.mockResolvedValueOnce(absentAssignmentSnapshot());
    const err = new Error("firestore down");
    mockAssignmentSet.mockRejectedValueOnce(err);

    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toBe(err);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });
});
