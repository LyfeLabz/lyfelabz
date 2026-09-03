import type { CallableRequest } from "firebase-functions/v2/https";

// accommodationsSet unit tests. This module never imports any
// assignment/session/attempt reference (see accommodations-set.ts's import
// list), so it is structurally incapable of creating student runtime
// records; F5.2 Slice 1 test #23 is satisfied by that absence rather than
// by a mock assertion here.

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

type Ref = { readonly __kind: string; readonly studentId: string; readonly revision?: number };

const mockStudentAccommodationDocRef = jest.fn(
  (studentId: string): Ref => ({ __kind: "record", studentId }),
);
const mockStudentAccommodationCreationDocRef = jest.fn(
  (studentId: string): Ref => ({ __kind: "record-creation", studentId }),
);
const mockStudentAccommodationUpdateDocRef = jest.fn(
  (studentId: string): Ref => ({ __kind: "record-update", studentId }),
);
const mockStudentAccommodationHistoryDocRef = jest.fn(
  (studentId: string, revision: number): Ref => ({
    __kind: "history",
    studentId,
    revision,
  }),
);

let recordSnapshotValue: { exists: boolean; data: () => unknown } = {
  exists: false,
  data: () => undefined,
};
let historySnapshotValue: { exists: boolean; data: () => unknown } = {
  exists: false,
  data: () => undefined,
};

const mockTxGet = jest.fn((ref: Ref) => {
  if (ref.__kind === "record") return Promise.resolve(recordSnapshotValue);
  if (ref.__kind === "history") return Promise.resolve(historySnapshotValue);
  return Promise.reject(new Error(`unexpected tx.get target: ${ref.__kind}`));
});
const mockTxCreate = jest.fn();
const mockTxUpdate = jest.fn();
const fakeTx = { get: mockTxGet, create: mockTxCreate, update: mockTxUpdate };

const mockRunFirestoreTransaction = jest.fn(
  (fn: (tx: typeof fakeTx) => unknown) => Promise.resolve(fn(fakeTx)),
);

const mockWriteAuditEvent = jest.fn();
const mockLogInfo = jest.fn();

const mockAssertActiveTeacherInDistrict = jest.fn();
const mockAssertTeacherAuthorizedForStudent = jest.fn();

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    READING_LEVELS: ["adapted"],
    platformCallable: (handler: unknown) => handler,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    runFirestoreTransaction: mockRunFirestoreTransaction,
    studentAccommodationDocRef: mockStudentAccommodationDocRef,
    studentAccommodationCreationDocRef: mockStudentAccommodationCreationDocRef,
    studentAccommodationUpdateDocRef: mockStudentAccommodationUpdateDocRef,
    studentAccommodationHistoryDocRef: mockStudentAccommodationHistoryDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("./authorize-teacher-for-student", () => ({
  assertActiveTeacherInDistrict: mockAssertActiveTeacherInDistrict,
  assertTeacherAuthorizedForStudent: mockAssertTeacherAuthorizedForStudent,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __accommodationsSetHandler } from "./accommodations-set";

const TEACHER_UID = "teacher-uid";
const CLASS_ID = "class-abc";
const STUDENT_UID = "student-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";

const ACTOR = Object.freeze({
  uid: TEACHER_UID,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(data: unknown): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function setRecordSnapshot(overrides: {
  exists?: boolean;
  configRevision?: number;
  readingAccessibility?: unknown;
  updatedBy?: string;
} = {}): void {
  const exists = overrides.exists ?? true;
  recordSnapshotValue = {
    exists,
    data: () =>
      exists
        ? {
            configRevision: overrides.configRevision ?? 1,
            readingAccessibility:
              overrides.readingAccessibility ?? { status: "active", level: "adapted" },
            updatedBy: overrides.updatedBy ?? TEACHER_UID,
          }
        : undefined,
  };
}

function setHistorySnapshot(overrides: {
  exists?: boolean;
  idempotencyKey?: string;
} = {}): void {
  const exists = overrides.exists ?? false;
  historySnapshotValue = {
    exists,
    data: () => (exists ? { idempotencyKey: overrides.idempotencyKey } : undefined),
  };
}

describe("accommodationsSet", () => {
  beforeEach(() => {
    mockStudentAccommodationDocRef.mockClear();
    mockStudentAccommodationCreationDocRef.mockClear();
    mockStudentAccommodationUpdateDocRef.mockClear();
    mockStudentAccommodationHistoryDocRef.mockClear();
    mockTxGet.mockClear();
    mockTxCreate.mockReset();
    mockTxUpdate.mockReset();
    mockRunFirestoreTransaction.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();

    mockAssertActiveTeacherInDistrict.mockReset();
    mockAssertActiveTeacherInDistrict.mockResolvedValue({ ...ACTOR });
    mockAssertTeacherAuthorizedForStudent.mockReset();
    mockAssertTeacherAuthorizedForStudent.mockResolvedValue(undefined);

    setRecordSnapshot({ exists: false });
    setHistorySnapshot({ exists: false });
  });

  it("accepts the first activation from logical revision 0 and creates revision 1 atomically with history", async () => {
    setRecordSnapshot({ exists: false });

    const result = await __accommodationsSetHandler(
      makeRequest({
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        expectedRevision: 0,
        newValue: { status: "active", level: "adapted" },
      }),
    );

    expect(mockAssertTeacherAuthorizedForStudent).toHaveBeenCalledWith(
      ACTOR,
      CLASS_ID,
      STUDENT_UID,
    );
    // Re-verified inside the transaction too.
    expect(mockAssertTeacherAuthorizedForStudent).toHaveBeenCalledWith(
      ACTOR,
      CLASS_ID,
      STUDENT_UID,
      fakeTx,
    );

    expect(mockTxCreate).toHaveBeenCalledWith(
      { __kind: "record-creation", studentId: STUDENT_UID },
      expect.objectContaining({
        studentId: STUDENT_UID,
        schoolId: SCHOOL_ID,
        readingAccessibility: { status: "active", level: "adapted" },
        configRevision: 1,
        createdBy: TEACHER_UID,
        updatedBy: TEACHER_UID,
        createdAt: SERVER_TIMESTAMP_SENTINEL,
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      }),
    );
    expect(mockTxCreate).toHaveBeenCalledWith(
      { __kind: "history", studentId: STUDENT_UID, revision: 1 },
      expect.objectContaining({
        revision: 1,
        readingAccessibility: { status: "active", level: "adapted" },
        setBy: TEACHER_UID,
        classId: CLASS_ID,
      }),
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();

    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: TEACHER_UID,
        actorRole: "teacher",
        action: "accommodations.configurationChanged",
        targetType: "studentAccommodation",
        targetId: STUDENT_UID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        payload: expect.objectContaining({
          classId: CLASS_ID,
          previousConfigRevision: 0,
          configRevision: 1,
        }),
      }),
    );

    expect(result).toEqual({
      studentId: STUDENT_UID,
      configRevision: 1,
      readingAccessibility: { status: "active", level: "adapted" },
      updatedBy: TEACHER_UID,
      noop: false,
    });
  });

  it("accepts a second valid update at the correct expectedRevision and increments once", async () => {
    setRecordSnapshot({ configRevision: 1, readingAccessibility: { status: "active", level: "adapted" } });

    const result = await __accommodationsSetHandler(
      makeRequest({
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        expectedRevision: 1,
        newValue: { status: "inactive" },
      }),
    );

    expect(mockTxUpdate).toHaveBeenCalledWith(
      { __kind: "record-update", studentId: STUDENT_UID },
      expect.objectContaining({
        readingAccessibility: { status: "inactive" },
        configRevision: 2,
        updatedBy: TEACHER_UID,
      }),
    );
    expect(mockTxCreate).toHaveBeenCalledWith(
      { __kind: "history", studentId: STUDENT_UID, revision: 2 },
      expect.objectContaining({ revision: 2, readingAccessibility: { status: "inactive" } }),
    );
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      studentId: STUDENT_UID,
      configRevision: 2,
      readingAccessibility: { status: "inactive" },
      updatedBy: TEACHER_UID,
      noop: false,
    });
  });

  it("rejects a stale expectedRevision and writes nothing", async () => {
    setRecordSnapshot({ configRevision: 2, readingAccessibility: { status: "inactive" } });

    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 1,
          newValue: { status: "active", level: "adapted" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "accommodations.writeConflict",
      details: expect.objectContaining({ configRevision: 2 }),
    });

    expect(mockTxCreate).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("is a true no-op for an equal-value write: no revision bump, no history, no audit", async () => {
    setRecordSnapshot({
      configRevision: 4,
      readingAccessibility: { status: "active", level: "adapted" },
    });

    const result = await __accommodationsSetHandler(
      makeRequest({
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        expectedRevision: 4,
        newValue: { status: "active", level: "adapted" },
      }),
    );

    expect(mockTxCreate).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      studentId: STUDENT_UID,
      configRevision: 4,
      readingAccessibility: { status: "active", level: "adapted" },
      updatedBy: TEACHER_UID,
      noop: true,
    });
  });

  it("is a true no-op for equal-value inactive -> inactive", async () => {
    setRecordSnapshot({ configRevision: 2, readingAccessibility: { status: "inactive" } });

    const result = await __accommodationsSetHandler(
      makeRequest({
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        expectedRevision: 2,
        newValue: { status: "inactive" },
      }),
    );

    expect(mockTxCreate).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    expect(result.noop).toBe(true);
  });

  it("treats a matching-idempotencyKey retry as a successful no-op replay, not a stale write", async () => {
    setRecordSnapshot({
      configRevision: 2,
      readingAccessibility: { status: "active", level: "adapted" },
    });
    setHistorySnapshot({ exists: true, idempotencyKey: "retry-key-1" });

    const result = await __accommodationsSetHandler(
      makeRequest({
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        expectedRevision: 1,
        newValue: { status: "active", level: "adapted" },
        idempotencyKey: "retry-key-1",
      }),
    );

    expect(mockStudentAccommodationHistoryDocRef).toHaveBeenCalledWith(STUDENT_UID, 2);
    expect(mockTxCreate).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      studentId: STUDENT_UID,
      configRevision: 2,
      readingAccessibility: { status: "active", level: "adapted" },
      updatedBy: TEACHER_UID,
      noop: true,
    });
  });

  it("rejects a stale retry whose idempotencyKey does not match the landed write", async () => {
    setRecordSnapshot({ configRevision: 2, readingAccessibility: { status: "inactive" } });
    setHistorySnapshot({ exists: true, idempotencyKey: "some-other-key" });

    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 1,
          newValue: { status: "active", level: "adapted" },
          idempotencyKey: "retry-key-1",
        }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.writeConflict" });
    expect(mockTxCreate).not.toHaveBeenCalled();
  });

  it("rejects a stale retry without an idempotencyKey", async () => {
    setRecordSnapshot({ configRevision: 2, readingAccessibility: { status: "inactive" } });

    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 1,
          newValue: { status: "active", level: "adapted" },
        }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.writeConflict" });
  });

  it("rejects an invalid status", async () => {
    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 0,
          newValue: { status: "enabled" },
        }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.invalidStatus" });
  });

  it("rejects an active configuration missing the required V1 level", async () => {
    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 0,
          newValue: { status: "active" },
        }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.missingLevel" });
  });

  it("rejects an unsupported level", async () => {
    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 0,
          newValue: { status: "active", level: "lexile-800" },
        }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.unsupportedLevel" });
  });

  it("rejects an inactive configuration that carries a forbidden level field", async () => {
    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 0,
          newValue: { status: "inactive", level: "adapted" },
        }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.forbiddenField" });
  });

  it("rejects forbidden/server-owned top-level request fields", async () => {
    for (const forbidden of [
      { variantKey: "reading-adapted" },
      { presentationRevisionId: "pr" + "0".repeat(64) },
      { deliveryOutcome: "differentiated" },
      { createdBy: "someone-else" },
      { updatedAt: new Date().toISOString() },
    ]) {
      await expect(
        __accommodationsSetHandler(
          makeRequest({
            studentId: STUDENT_UID,
            classId: CLASS_ID,
            expectedRevision: 0,
            newValue: { status: "active", level: "adapted" },
            ...forbidden,
          }),
        ),
      ).rejects.toMatchObject({ code: "accommodations.forbiddenField" });
    }
    expect(mockRunFirestoreTransaction).not.toHaveBeenCalled();
  });

  it("rejects a non-integer or negative expectedRevision", async () => {
    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 1.5,
          newValue: { status: "inactive" },
        }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.invalidExpectedRevision" });
    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: -1,
          newValue: { status: "inactive" },
        }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.invalidExpectedRevision" });
  });

  it("propagates an unrelated-teacher authorization refusal and never opens a transaction", async () => {
    mockAssertTeacherAuthorizedForStudent.mockRejectedValueOnce(
      new PlatformError("accommodations.forbidden", "not authorized"),
    );

    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 0,
          newValue: { status: "active", level: "adapted" },
        }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.forbidden" });
    expect(mockRunFirestoreTransaction).not.toHaveBeenCalled();
  });

  it("rejects a student caller with role-forbidden", async () => {
    mockAssertActiveTeacherInDistrict.mockReset();
    mockAssertActiveTeacherInDistrict.mockRejectedValueOnce(
      new PlatformError("role-forbidden", "Caller must be an active teacher."),
    );

    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 0,
          newValue: { status: "active", level: "adapted" },
        }),
      ),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockRunFirestoreTransaction).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    mockAssertActiveTeacherInDistrict.mockReset();
    mockAssertActiveTeacherInDistrict.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );

    await expect(
      __accommodationsSetHandler(
        makeRequest({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 0,
          newValue: { status: "active", level: "adapted" },
        }),
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("derives attribution from the authenticated server identity, never the request", async () => {
    setRecordSnapshot({ exists: false });

    await __accommodationsSetHandler(
      makeRequest({
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        expectedRevision: 0,
        newValue: { status: "active", level: "adapted" },
      }),
    );

    const [, creationPayload] = mockTxCreate.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(creationPayload.createdBy).toBe(TEACHER_UID);
    expect(creationPayload.updatedBy).toBe(TEACHER_UID);
    const [, historyPayload] = mockTxCreate.mock.calls[1] as [unknown, Record<string, unknown>];
    expect(historyPayload.setBy).toBe(TEACHER_UID);
  });
});
