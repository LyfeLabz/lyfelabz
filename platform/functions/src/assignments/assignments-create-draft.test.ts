import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockAssignmentGet = jest.fn();
const mockAssignmentSet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentCreationDocRef = jest.fn(() => ({ set: mockAssignmentSet }));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

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
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    classDocRef: mockClassDocRef,
    assignmentDocRef: mockAssignmentDocRef,
    assignmentCreationDocRef: mockAssignmentCreationDocRef,
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsCreateDraftHandler } from "./assignments-create-draft";

const TEACHER_UID = "teacher-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";

const VALID_DATA = {
  assignmentId: "assign-1",
  classId: "class-abc",
  lessonSlug: "lesson_g7_earths-layers",
  lessonVersion: "1",
  mode: "classroom",
};

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  overrides: {
    data?: unknown;
  } = {},
): CallableRequest<unknown> {
  const data =
    overrides.data === undefined ? { ...VALID_DATA } : overrides.data;
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
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
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
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

    expect(mockRequireDistrictContext).toHaveBeenCalledTimes(1);
    expect(mockClassDocRef).toHaveBeenCalledWith("class-abc");
    expect(mockAssignmentDocRef).toHaveBeenCalledWith("assign-1");
    expect(mockAssignmentCreationDocRef).toHaveBeenCalledWith("assign-1");
    expect(mockAssignmentSet).toHaveBeenCalledTimes(1);
    expect(mockAssignmentSet).toHaveBeenCalledWith({
      classId: "class-abc",
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: "lesson_g7_earths-layers",
      lessonVersion: "1",
      mode: "classroom",
      status: "draft",
      createdAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: TEACHER_UID,
      actorRole: "teacher",
      action: "assignments.created",
      targetType: "assignment",
      targetId: "assign-1",
      schoolId: SCHOOL_ID,
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

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockClassGet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "not active"),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical claim-stale district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("claim-stale", "stale claim"),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-stale" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical school-district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("school-district-mismatch", "mismatch"),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "school-district-mismatch" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-unassigned district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-unassigned", "no district"),
    );
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects a non-teacher active caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "student-uid",
      role: "student",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects a platformAdministrator active caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "admin-uid",
      role: "platformAdministrator",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    await expect(
      __assignmentsCreateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockClassGet).not.toHaveBeenCalled();
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
