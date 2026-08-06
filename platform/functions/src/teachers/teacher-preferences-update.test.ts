import type { CallableRequest } from "firebase-functions/v2/https";

const mockRefSet = jest.fn();
const mockTeacherPreferencesUpdateDocRef = jest.fn(() => ({ set: mockRefSet }));

const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const DELETE_SENTINEL = { __sentinel: "delete" } as const;
const SERVER_TIMESTAMP_SENTINEL = { __sentinel: "serverTimestamp" } as const;

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    delete: () => DELETE_SENTINEL,
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
  const { isTeacherDefaultGrade } = jest.requireActual(
    "../shared/types/teacher-preferences",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    isTeacherDefaultGrade,
    requireDistrictContext: mockRequireDistrictContext,
    teacherPreferencesUpdateDocRef: mockTeacherPreferencesUpdateDocRef,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __teacherPreferencesUpdateHandler } from "./teacher-preferences-update";

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

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireDistrictContext.mockResolvedValue(TEACHER_CONTEXT);
  mockRefSet.mockResolvedValue(undefined);
});

describe("teacherPreferencesUpdate", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __teacherPreferencesUpdateHandler(makeRequest({ defaultGrade: "7" })),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("rejects non-teacher callers with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValueOnce({
      ...TEACHER_CONTEXT,
      role: "student",
    });
    await expect(
      __teacherPreferencesUpdateHandler(makeRequest({ defaultGrade: "7" })),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("accepts Grade 6", async () => {
    const res = await __teacherPreferencesUpdateHandler(
      makeRequest({ defaultGrade: "6" }),
    );
    expect(res).toEqual({ ok: true, defaultGrade: "6" });
    expect(mockTeacherPreferencesUpdateDocRef).toHaveBeenCalledWith(
      "teacher-uid",
    );
    expect(mockRefSet).toHaveBeenCalledWith(
      { defaultGrade: "6", updatedAt: SERVER_TIMESTAMP_SENTINEL },
      { merge: true },
    );
  });

  it("accepts Grade 7", async () => {
    const res = await __teacherPreferencesUpdateHandler(
      makeRequest({ defaultGrade: "7" }),
    );
    expect(res).toEqual({ ok: true, defaultGrade: "7" });
    expect(mockRefSet).toHaveBeenCalledWith(
      { defaultGrade: "7", updatedAt: SERVER_TIMESTAMP_SENTINEL },
      { merge: true },
    );
  });

  it("accepts Grade 8", async () => {
    const res = await __teacherPreferencesUpdateHandler(
      makeRequest({ defaultGrade: "8" }),
    );
    expect(res).toEqual({ ok: true, defaultGrade: "8" });
    expect(mockRefSet).toHaveBeenCalledWith(
      { defaultGrade: "8", updatedAt: SERVER_TIMESTAMP_SENTINEL },
      { merge: true },
    );
  });

  it("rejects an unsupported grade", async () => {
    await expect(
      __teacherPreferencesUpdateHandler(makeRequest({ defaultGrade: "9" })),
    ).rejects.toMatchObject({ code: "teacherPreferences.invalidDefaultGrade" });
    expect(mockRefSet).not.toHaveBeenCalled();
  });

  it("rejects an unsupported grade type", async () => {
    await expect(
      __teacherPreferencesUpdateHandler(makeRequest({ defaultGrade: 7 })),
    ).rejects.toMatchObject({ code: "teacherPreferences.invalidDefaultGrade" });
  });

  it("rejects a non-object payload", async () => {
    await expect(
      __teacherPreferencesUpdateHandler(makeRequest("nope")),
    ).rejects.toMatchObject({ code: "teacherPreferences.invalidRequest" });
  });

  it("clears the preference when defaultGrade is null", async () => {
    const res = await __teacherPreferencesUpdateHandler(
      makeRequest({ defaultGrade: null }),
    );
    expect(res).toEqual({ ok: true, defaultGrade: null });
    expect(mockRefSet).toHaveBeenCalledWith(
      { defaultGrade: DELETE_SENTINEL, updatedAt: SERVER_TIMESTAMP_SENTINEL },
      { merge: true },
    );
  });

  it("ignores arbitrary extra keys and only writes defaultGrade/updatedAt", async () => {
    await __teacherPreferencesUpdateHandler(
      makeRequest({ defaultGrade: "7", defaultBlock: "A", theme: "dark" }),
    );
    expect(mockRefSet).toHaveBeenCalledWith(
      { defaultGrade: "7", updatedAt: SERVER_TIMESTAMP_SENTINEL },
      { merge: true },
    );
  });

  it("is safe for repeated identical requests", async () => {
    await __teacherPreferencesUpdateHandler(
      makeRequest({ defaultGrade: "7" }),
    );
    await __teacherPreferencesUpdateHandler(
      makeRequest({ defaultGrade: "7" }),
    );
    expect(mockRefSet).toHaveBeenCalledTimes(2);
    // Both writes are structurally identical (each stamps a new
    // serverTimestamp sentinel; the FieldValue.delete/serverTimestamp
    // mocks return the same sentinel objects so the assertion holds).
    for (const call of mockRefSet.mock.calls) {
      expect(call[0]).toEqual({
        defaultGrade: "7",
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      });
      expect(call[1]).toEqual({ merge: true });
    }
  });

  it("writes only to the caller's own preference document", async () => {
    mockRequireDistrictContext.mockResolvedValueOnce({
      ...TEACHER_CONTEXT,
      uid: "someone-else",
    });
    await __teacherPreferencesUpdateHandler(
      makeRequest({ defaultGrade: "7" }),
    );
    expect(mockTeacherPreferencesUpdateDocRef).toHaveBeenCalledWith(
      "someone-else",
    );
  });

  it("stamps updatedAt on every write", async () => {
    await __teacherPreferencesUpdateHandler(
      makeRequest({ defaultGrade: "8" }),
    );
    const written = mockRefSet.mock.calls[0]![0] as {
      updatedAt: unknown;
    };
    expect(written.updatedAt).toBe(SERVER_TIMESTAMP_SENTINEL);
  });
});
