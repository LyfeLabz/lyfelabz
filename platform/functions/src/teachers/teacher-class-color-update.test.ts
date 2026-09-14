import type { CallableRequest } from "firebase-functions/v2/https";

const mockRefSet = jest.fn();
const mockTeacherPreferencesUpdateDocRef = jest.fn(() => ({ set: mockRefSet }));
const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));

const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = { __sentinel: "serverTimestamp" } as const;
const DELETE_SENTINEL = { __sentinel: "delete" } as const;

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
    delete: () => DELETE_SENTINEL,
  },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  const {
    CLASS_COLOR_TOKENS,
    isClassColorToken,
  } = jest.requireActual("../shared/types/teacher-preferences");
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    requireDistrictContext: mockRequireDistrictContext,
    teacherPreferencesUpdateDocRef: mockTeacherPreferencesUpdateDocRef,
    classDocRef: mockClassDocRef,
    CLASS_COLOR_TOKENS,
    isClassColorToken,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __teacherClassColorUpdateHandler } from "./teacher-class-color-update";

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

function ownedClassSnapshot(teacherId: string) {
  return { exists: true, data: () => ({ teacherId }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireDistrictContext.mockResolvedValue(TEACHER_CONTEXT);
  mockRefSet.mockResolvedValue(undefined);
  mockClassGet.mockResolvedValue(ownedClassSnapshot("teacher-uid"));
});

describe("teacherClassColorUpdate", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __teacherClassColorUpdateHandler(
        makeRequest({ classId: "c1", color: "blue" }),
      ),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("rejects non-teacher callers with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValueOnce({
      ...TEACHER_CONTEXT,
      role: "student",
    });
    await expect(
      __teacherClassColorUpdateHandler(
        makeRequest({ classId: "c1", color: "blue" }),
      ),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("accepts a curated color token and writes only that class id's nested key", async () => {
    const res = await __teacherClassColorUpdateHandler(
      makeRequest({ classId: "c1", color: "teal" }),
    );
    expect(res).toEqual({ ok: true, classId: "c1", color: "teal" });
    expect(mockClassDocRef).toHaveBeenCalledWith("c1");
    expect(mockTeacherPreferencesUpdateDocRef).toHaveBeenCalledWith(
      "teacher-uid",
    );
    expect(mockRefSet).toHaveBeenCalledWith(
      { classColors: { c1: "teal" }, updatedAt: SERVER_TIMESTAMP_SENTINEL },
      { merge: true },
    );
  });

  it("accepts every curated token", async () => {
    for (const color of [
      "blue",
      "teal",
      "green",
      "purple",
      "orange",
      "rose",
      "slate",
    ]) {
      mockRefSet.mockClear();
      await __teacherClassColorUpdateHandler(
        makeRequest({ classId: "c1", color }),
      );
      expect(mockRefSet).toHaveBeenCalledWith(
        { classColors: { c1: color }, updatedAt: SERVER_TIMESTAMP_SENTINEL },
        { merge: true },
      );
    }
  });

  it("clears a color with color: \"none\" using a FieldValue.delete() sentinel, not an omission", async () => {
    const res = await __teacherClassColorUpdateHandler(
      makeRequest({ classId: "c1", color: "none" }),
    );
    expect(res).toEqual({ ok: true, classId: "c1", color: "none" });
    expect(mockRefSet).toHaveBeenCalledWith(
      { classColors: { c1: DELETE_SENTINEL }, updatedAt: SERVER_TIMESTAMP_SENTINEL },
      { merge: true },
    );
  });

  it("rejects an arbitrary, non-curated color string", async () => {
    await expect(
      __teacherClassColorUpdateHandler(
        makeRequest({ classId: "c1", color: "#ff00ff" }),
      ),
    ).rejects.toMatchObject({ code: "teacherClassColor.invalidColor" });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("rejects a missing color field", async () => {
    await expect(
      __teacherClassColorUpdateHandler(makeRequest({ classId: "c1" })),
    ).rejects.toMatchObject({ code: "teacherClassColor.invalidColor" });
  });

  it("rejects a malformed class id", async () => {
    await expect(
      __teacherClassColorUpdateHandler(
        makeRequest({ classId: "bad id with spaces", color: "blue" }),
      ),
    ).rejects.toMatchObject({ code: "teacherClassColor.invalidClassId" });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("rejects a non-object payload", async () => {
    await expect(
      __teacherClassColorUpdateHandler(makeRequest("nope")),
    ).rejects.toMatchObject({ code: "teacherClassColor.invalidRequest" });
  });

  it("rejects a class id that does not exist", async () => {
    mockClassGet.mockResolvedValueOnce({ exists: false, data: () => undefined });
    await expect(
      __teacherClassColorUpdateHandler(
        makeRequest({ classId: "c1", color: "blue" }),
      ),
    ).rejects.toMatchObject({ code: "teacherClassColor.forbidden" });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("rejects a class id the caller does not own", async () => {
    mockClassGet.mockResolvedValueOnce(ownedClassSnapshot("someone-else"));
    await expect(
      __teacherClassColorUpdateHandler(
        makeRequest({ classId: "c1", color: "blue" }),
      ),
    ).rejects.toMatchObject({ code: "teacherClassColor.forbidden" });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("writes only to the caller's own preference document, never another teacher's", async () => {
    mockRequireDistrictContext.mockResolvedValueOnce({
      ...TEACHER_CONTEXT,
      uid: "someone-else",
    });
    mockClassGet.mockResolvedValueOnce(ownedClassSnapshot("someone-else"));
    await __teacherClassColorUpdateHandler(
      makeRequest({ classId: "c1", color: "blue" }),
    );
    expect(mockTeacherPreferencesUpdateDocRef).toHaveBeenCalledWith(
      "someone-else",
    );
  });
});
