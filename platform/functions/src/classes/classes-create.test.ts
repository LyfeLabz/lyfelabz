import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassSet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockClassCreationDocRef = jest.fn(() => ({ set: mockClassSet }));

const mockWriteAuditEvent = jest.fn();

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

jest.mock("node:crypto", () => ({
  randomBytes: (n: number) => Buffer.alloc(n, 0xab),
}));

const JOIN_CODE_FROM_MOCK = "ABABABAB";

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    classDocRef: mockClassDocRef,
    classCreationDocRef: mockClassCreationDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __classesCreateHandler } from "./classes-create";

type CreateData = {
  classId?: unknown;
  title?: unknown;
  grade?: unknown;
  block?: unknown;
  academicTerm?: unknown;
};

const VALID_DATA: CreateData = {
  classId: "class-abc",
  title: "Grade 7 Science, Block C",
  grade: "7",
  block: "C",
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

function absentSnapshot() {
  return { exists: false, data: () => undefined };
}

function existingSnapshot(
  overrides: {
    teacherId?: string;
    schoolId?: string;
    title?: string;
    grade?: string;
    block?: string;
    joinCode?: string;
    status?: "active" | "archived";
    academicTerm?: string;
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      teacherId: overrides.teacherId ?? "teacher-uid",
      schoolId: overrides.schoolId ?? "school-a",
      title: overrides.title ?? "Grade 7 Science, Block C",
      grade: overrides.grade ?? "7",
      block: overrides.block ?? "C",
      joinCode: overrides.joinCode ?? "PREEXISTING",
      status: overrides.status ?? "active",
      createdAt: {} as never,
      ...(overrides.academicTerm !== undefined
        ? { academicTerm: overrides.academicTerm }
        : {}),
    }),
  };
}

describe("classesCreate", () => {
  beforeEach(() => {
    mockClassGet.mockReset();
    mockClassSet.mockReset();
    mockClassDocRef.mockClear();
    mockClassCreationDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("creates a canonical classes/{classId} document and returns the canonical response", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    mockClassSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __classesCreateHandler(makeRequest());

    expect(mockClassDocRef).toHaveBeenCalledWith("class-abc");
    expect(mockClassCreationDocRef).toHaveBeenCalledWith("class-abc");
    expect(mockClassSet).toHaveBeenCalledTimes(1);
    expect(mockClassSet).toHaveBeenCalledWith({
      teacherId: "teacher-uid",
      schoolId: "school-a",
      title: "Grade 7 Science, Block C",
      grade: "7",
      block: "C",
      joinCode: JOIN_CODE_FROM_MOCK,
      status: "active",
      createdAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(result).toEqual({
      classId: "class-abc",
      joinCode: JOIN_CODE_FROM_MOCK,
      alreadyCreated: false,
    });
  });

  it("preserves the optional academicTerm field in the canonical write payload", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    mockClassSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __classesCreateHandler(
      makeRequest({
        data: { ...VALID_DATA, academicTerm: "Fall 2026" },
      }),
    );

    expect(mockClassSet).toHaveBeenCalledWith({
      teacherId: "teacher-uid",
      schoolId: "school-a",
      title: "Grade 7 Science, Block C",
      grade: "7",
      block: "C",
      joinCode: JOIN_CODE_FROM_MOCK,
      status: "active",
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      academicTerm: "Fall 2026",
    });
  });

  it("rejects an unauthenticated caller with classes.unauthenticated", async () => {
    await expect(
      __classesCreateHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "classes.unauthenticated",
    });
    expect(mockClassDocRef).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects non-teacher callers with classes.unauthorized", async () => {
    await expect(
      __classesCreateHandler(
        makeRequest({ token: { role: "student", schoolId: "school-a" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.unauthorized" });
    await expect(
      __classesCreateHandler(
        makeRequest({
          token: { role: "platformAdministrator", schoolId: "school-a" },
        }),
      ),
    ).rejects.toMatchObject({ code: "classes.unauthorized" });
    await expect(
      __classesCreateHandler(makeRequest({ token: {} })),
    ).rejects.toMatchObject({ code: "classes.unauthorized" });
    await expect(
      __classesCreateHandler(makeRequest({ token: null })),
    ).rejects.toMatchObject({ code: "classes.unauthorized" });
    expect(mockClassDocRef).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a teacher missing the schoolId claim with classes.unauthorized", async () => {
    await expect(
      __classesCreateHandler(makeRequest({ token: { role: "teacher" } })),
    ).rejects.toMatchObject({ code: "classes.unauthorized" });
    await expect(
      __classesCreateHandler(
        makeRequest({ token: { role: "teacher", schoolId: "" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.unauthorized" });
    expect(mockClassDocRef).not.toHaveBeenCalled();
  });

  it("rejects a non-object request payload with classes.invalidRequest", async () => {
    await expect(
      __classesCreateHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "classes.invalidRequest" });
    await expect(
      __classesCreateHandler(makeRequest({ data: "not-an-object" })),
    ).rejects.toMatchObject({ code: "classes.invalidRequest" });
    expect(mockClassDocRef).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-URL-safe classId", async () => {
    await expect(
      __classesCreateHandler(
        makeRequest({ data: { ...VALID_DATA, classId: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
    await expect(
      __classesCreateHandler(
        makeRequest({ data: { ...VALID_DATA, classId: "bad/id" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
    await expect(
      __classesCreateHandler(
        makeRequest({ data: { ...VALID_DATA, classId: "" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
    expect(mockClassDocRef).not.toHaveBeenCalled();
  });

  it("rejects invalid title/grade/block payloads", async () => {
    await expect(
      __classesCreateHandler(
        makeRequest({ data: { ...VALID_DATA, title: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidTitle" });
    await expect(
      __classesCreateHandler(
        makeRequest({ data: { ...VALID_DATA, grade: "" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidGrade" });
    await expect(
      __classesCreateHandler(
        makeRequest({ data: { ...VALID_DATA, grade: "not-a-grade!" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidGrade" });
    await expect(
      __classesCreateHandler(
        makeRequest({ data: { ...VALID_DATA, block: "" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidBlock" });
    await expect(
      __classesCreateHandler(
        makeRequest({ data: { ...VALID_DATA, block: "H" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidBlock" });
    expect(mockClassSet).not.toHaveBeenCalled();
  });

  it("rejects an invalid academicTerm with classes.invalidAcademicTerm", async () => {
    await expect(
      __classesCreateHandler(
        makeRequest({ data: { ...VALID_DATA, academicTerm: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidAcademicTerm" });
    await expect(
      __classesCreateHandler(
        makeRequest({ data: { ...VALID_DATA, academicTerm: 42 } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidAcademicTerm" });
    expect(mockClassSet).not.toHaveBeenCalled();
  });

  it("is idempotent: matching canonical fields return alreadyCreated with the previously stored joinCode", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ joinCode: "PREEXISTING" }),
    );

    const result = await __classesCreateHandler(makeRequest());

    expect(result).toEqual({
      classId: "class-abc",
      joinCode: "PREEXISTING",
      alreadyCreated: true,
    });
    expect(mockClassCreationDocRef).not.toHaveBeenCalled();
    expect(mockClassSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("idempotent match compares the optional academicTerm exactly", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ academicTerm: "Fall 2026" }),
    );

    const result = await __classesCreateHandler(
      makeRequest({ data: { ...VALID_DATA, academicTerm: "Fall 2026" } }),
    );

    expect(result.alreadyCreated).toBe(true);
    expect(mockClassSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a conflict when the existing document is owned by another teacher", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ teacherId: "someone-else" }),
    );

    await expect(
      __classesCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.conflict" });
    expect(mockClassSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a conflict when the existing document is in another school", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ schoolId: "school-b" }),
    );

    await expect(
      __classesCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.conflict" });
    expect(mockClassSet).not.toHaveBeenCalled();
  });

  it("rejects a conflict when a canonical metadata field differs", async () => {
    mockClassGet.mockResolvedValueOnce(existingSnapshot({ title: "Different" }));

    await expect(
      __classesCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.conflict" });
    expect(mockClassSet).not.toHaveBeenCalled();
  });

  it("invokes the canonical audit helper with classes.created and the canonical target fields", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    mockClassSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __classesCreateHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "classes.created",
      targetType: "class",
      targetId: "class-abc",
      schoolId: "school-a",
    });
  });

  it("orders side effects: creation write, then audit event", async () => {
    const calls: string[] = [];
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    mockClassSet.mockImplementationOnce(() => {
      calls.push("set");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __classesCreateHandler(makeRequest());

    expect(calls).toEqual(["set", "audit"]);
  });

  it("propagates a downstream creation-write failure and does not write audit", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    const setErr = new Error("firestore down");
    mockClassSet.mockRejectedValueOnce(setErr);

    await expect(__classesCreateHandler(makeRequest())).rejects.toBe(setErr);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates a downstream audit helper failure", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    mockClassSet.mockResolvedValueOnce(undefined);
    const auditErr = new PlatformError(
      "audit.writeFailed",
      "boom",
      new Error("network"),
    );
    mockWriteAuditEvent.mockRejectedValueOnce(auditErr);

    await expect(__classesCreateHandler(makeRequest())).rejects.toBe(auditErr);
  });

  it("trims whitespace on every scalar field before writing", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    mockClassSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __classesCreateHandler(
      makeRequest({
        data: {
          classId: "  class-abc  ",
          title: "  Grade 7 Science, Block C  ",
          grade: "  7  ",
          block: "  c  ",
          academicTerm: "  Fall 2026  ",
        },
      }),
    );

    expect(mockClassDocRef).toHaveBeenCalledWith("class-abc");
    expect(mockClassCreationDocRef).toHaveBeenCalledWith("class-abc");
    expect(mockClassSet).toHaveBeenCalledWith({
      teacherId: "teacher-uid",
      schoolId: "school-a",
      title: "Grade 7 Science, Block C",
      grade: "7",
      block: "C",
      joinCode: JOIN_CODE_FROM_MOCK,
      status: "active",
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      academicTerm: "Fall 2026",
    });
  });
});
