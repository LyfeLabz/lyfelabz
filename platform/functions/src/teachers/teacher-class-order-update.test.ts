import type { CallableRequest } from "firebase-functions/v2/https";

const mockRefSet = jest.fn();
const mockTeacherPreferencesUpdateDocRef = jest.fn(() => ({ set: mockRefSet }));
const mockPreferencesGet = jest.fn();
const mockTeacherPreferencesDocRef = jest.fn(() => ({ get: mockPreferencesGet }));
const mockClassesGet = jest.fn();
const mockClassesWhere = jest.fn();
const mockClassesCollectionRef = jest.fn(() => {
  const q = { where: mockClassesWhere, get: mockClassesGet };
  mockClassesWhere.mockReturnValue(q);
  return q;
});

const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = { __sentinel: "serverTimestamp" } as const;

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
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    requireDistrictContext: mockRequireDistrictContext,
    teacherPreferencesUpdateDocRef: mockTeacherPreferencesUpdateDocRef,
    teacherPreferencesDocRef: mockTeacherPreferencesDocRef,
    classesCollectionRef: mockClassesCollectionRef,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __teacherClassOrderUpdateHandler } from "./teacher-class-order-update";

const TEACHER_CONTEXT = Object.freeze({
  uid: "teacher-uid",
  role: "teacher" as const,
  schoolId: "school-a",
  districtId: "district-1",
});

function makeRequest(data: unknown): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: "teacher-uid", token: {} } as never,
    rawRequest: {} as never,
  };
}

function ownedClassesSnapshot(ids: string[]) {
  return { docs: ids.map((id) => ({ id })) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireDistrictContext.mockResolvedValue(TEACHER_CONTEXT);
  mockRefSet.mockResolvedValue(undefined);
  mockClassesGet.mockResolvedValue(
    ownedClassesSnapshot(["c1", "c2", "c3", "c4"]),
  );
  mockPreferencesGet.mockResolvedValue({ data: () => undefined });
});

describe("teacherClassOrderUpdate", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __teacherClassOrderUpdateHandler(makeRequest({ classOrder: ["c1"] })),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("rejects non-teacher callers with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValueOnce({
      ...TEACHER_CONTEXT,
      role: "student",
    });
    await expect(
      __teacherClassOrderUpdateHandler(makeRequest({ classOrder: ["c1"] })),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("accepts a full reorder of the teacher's own classes", async () => {
    const res = await __teacherClassOrderUpdateHandler(
      makeRequest({ classOrder: ["c3", "c1", "c4", "c2"] }),
    );
    expect(res).toEqual({ ok: true, classOrder: ["c3", "c1", "c4", "c2"] });
    expect(mockClassesWhere).toHaveBeenCalledWith("teacherId", "==", "teacher-uid");
    expect(mockTeacherPreferencesUpdateDocRef).toHaveBeenCalledWith(
      "teacher-uid",
    );
    expect(mockRefSet).toHaveBeenCalledWith(
      { classOrder: ["c3", "c1", "c4", "c2"], updatedAt: SERVER_TIMESTAMP_SENTINEL },
      { merge: true },
    );
  });

  it("accepts a partial reorder naming only some of the teacher's classes", async () => {
    const res = await __teacherClassOrderUpdateHandler(
      makeRequest({ classOrder: ["c2", "c1"] }),
    );
    expect(res).toEqual({ ok: true, classOrder: ["c2", "c1"] });
    expect(mockRefSet).toHaveBeenCalledWith(
      { classOrder: ["c2", "c1"], updatedAt: SERVER_TIMESTAMP_SENTINEL },
      { merge: true },
    );
  });

  it("preserves a previously-ordered id absent from this request, appended after the submitted ids", async () => {
    mockPreferencesGet.mockResolvedValueOnce({
      data: () => ({ classOrder: ["c4", "c1", "c9-archived"] }),
    });
    const res = await __teacherClassOrderUpdateHandler(
      makeRequest({ classOrder: ["c2", "c1"] }),
    );
    // c2 and c1 are the submitted (most recent, deliberate) order; c4 and
    // the archived c9 survive from the prior stored order, appended after,
    // in their prior relative order. c1 is de-duplicated (it appears in
    // both the submission and the prior order) - it is not repeated.
    expect(res).toEqual({ ok: true, classOrder: ["c2", "c1", "c4", "c9-archived"] });
    expect(mockRefSet).toHaveBeenCalledWith(
      {
        classOrder: ["c2", "c1", "c4", "c9-archived"],
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      },
      { merge: true },
    );
  });

  it("rejects a class id the caller does not own", async () => {
    await expect(
      __teacherClassOrderUpdateHandler(
        makeRequest({ classOrder: ["c1", "someone-elses-class"] }),
      ),
    ).rejects.toMatchObject({ code: "teacherClassOrder.unknownClassId" });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("rejects a duplicate class id within the payload", async () => {
    await expect(
      __teacherClassOrderUpdateHandler(
        makeRequest({ classOrder: ["c1", "c2", "c1"] }),
      ),
    ).rejects.toMatchObject({ code: "teacherClassOrder.duplicateClassId" });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("rejects an empty classOrder array", async () => {
    await expect(
      __teacherClassOrderUpdateHandler(makeRequest({ classOrder: [] })),
    ).rejects.toMatchObject({ code: "teacherClassOrder.invalidClassOrder" });
  });

  it("rejects a non-array classOrder", async () => {
    await expect(
      __teacherClassOrderUpdateHandler(makeRequest({ classOrder: "c1" })),
    ).rejects.toMatchObject({ code: "teacherClassOrder.invalidClassOrder" });
  });

  it("rejects a malformed class id token", async () => {
    await expect(
      __teacherClassOrderUpdateHandler(
        makeRequest({ classOrder: ["c1", "bad id with spaces"] }),
      ),
    ).rejects.toMatchObject({ code: "teacherClassOrder.invalidClassOrder" });
  });

  it("rejects a non-object payload", async () => {
    await expect(
      __teacherClassOrderUpdateHandler(makeRequest("nope")),
    ).rejects.toMatchObject({ code: "teacherClassOrder.invalidRequest" });
  });

  it("is idempotent for a repeated identical order", async () => {
    await __teacherClassOrderUpdateHandler(
      makeRequest({ classOrder: ["c1", "c2"] }),
    );
    await __teacherClassOrderUpdateHandler(
      makeRequest({ classOrder: ["c1", "c2"] }),
    );
    expect(mockRefSet).toHaveBeenCalledTimes(2);
    for (const call of mockRefSet.mock.calls) {
      expect(call[0]).toEqual({
        classOrder: ["c1", "c2"],
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      });
    }
  });

  it("writes only to the caller's own preference document, never another teacher's", async () => {
    mockRequireDistrictContext.mockResolvedValueOnce({
      ...TEACHER_CONTEXT,
      uid: "someone-else",
    });
    mockClassesGet.mockResolvedValueOnce(ownedClassesSnapshot(["c1"]));
    await __teacherClassOrderUpdateHandler(
      makeRequest({ classOrder: ["c1"] }),
    );
    expect(mockTeacherPreferencesUpdateDocRef).toHaveBeenCalledWith(
      "someone-else",
    );
    expect(mockClassesWhere).toHaveBeenCalledWith(
      "teacherId",
      "==",
      "someone-else",
    );
  });
});
