import type { CallableRequest } from "firebase-functions/v2/https";

const mockStudentAccommodationGet = jest.fn();
const mockStudentAccommodationDocRef = jest.fn(() => ({
  get: mockStudentAccommodationGet,
}));

const mockAssertActiveTeacherInDistrict = jest.fn();
const mockAssertTeacherAuthorizedForStudent = jest.fn();

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    platformCallable: (handler: unknown) => handler,
    studentAccommodationDocRef: mockStudentAccommodationDocRef,
  };
});

jest.mock("./authorize-teacher-for-student", () => ({
  assertActiveTeacherInDistrict: mockAssertActiveTeacherInDistrict,
  assertTeacherAuthorizedForStudent: mockAssertTeacherAuthorizedForStudent,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __accommodationsGetHandler } from "./accommodations-get";

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

function makeRequest(data: unknown = { studentId: STUDENT_UID, classId: CLASS_ID }): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function recordSnapshot(
  overrides: {
    exists?: boolean;
    configRevision?: number;
    readingAccessibility?: unknown;
    updatedBy?: string;
    updatedAt?: unknown;
  } = {},
) {
  const exists = overrides.exists ?? true;
  return {
    exists,
    data: () =>
      exists
        ? {
            configRevision: overrides.configRevision ?? 3,
            readingAccessibility:
              overrides.readingAccessibility ?? { status: "active", level: "adapted" },
            updatedBy: overrides.updatedBy ?? TEACHER_UID,
            updatedAt: overrides.updatedAt ?? { __ts: true },
          }
        : undefined,
  };
}

describe("accommodationsGet", () => {
  beforeEach(() => {
    mockStudentAccommodationGet.mockReset();
    mockStudentAccommodationDocRef.mockClear();
    mockAssertActiveTeacherInDistrict.mockReset();
    mockAssertActiveTeacherInDistrict.mockResolvedValue({ ...ACTOR });
    mockAssertTeacherAuthorizedForStudent.mockReset();
    mockAssertTeacherAuthorizedForStudent.mockResolvedValue(undefined);
  });

  it("returns the current configuration for an authorized read", async () => {
    mockStudentAccommodationGet.mockResolvedValueOnce(recordSnapshot());

    const result = await __accommodationsGetHandler(makeRequest());

    expect(mockStudentAccommodationDocRef).toHaveBeenCalledWith(STUDENT_UID);
    expect(mockAssertTeacherAuthorizedForStudent).toHaveBeenCalledWith(
      ACTOR,
      CLASS_ID,
      STUDENT_UID,
    );
    expect(result).toEqual({
      configRevision: 3,
      readingAccessibility: { status: "active", level: "adapted" },
      updatedBy: TEACHER_UID,
      updatedAt: { __ts: true },
    });
  });

  it("returns configRevision 0 when no record exists", async () => {
    mockStudentAccommodationGet.mockResolvedValueOnce(
      recordSnapshot({ exists: false }),
    );

    const result = await __accommodationsGetHandler(makeRequest());

    expect(result).toEqual({ configRevision: 0 });
  });

  it("propagates an unrelated-teacher authorization refusal", async () => {
    mockAssertTeacherAuthorizedForStudent.mockRejectedValueOnce(
      new PlatformError("accommodations.forbidden", "not authorized"),
    );

    await expect(__accommodationsGetHandler(makeRequest())).rejects.toMatchObject({
      code: "accommodations.forbidden",
    });
    expect(mockStudentAccommodationDocRef).not.toHaveBeenCalled();
  });

  it("rejects a student caller with role-forbidden", async () => {
    mockAssertActiveTeacherInDistrict.mockReset();
    mockAssertActiveTeacherInDistrict.mockRejectedValueOnce(
      new PlatformError("role-forbidden", "Caller must be an active teacher."),
    );

    await expect(__accommodationsGetHandler(makeRequest())).rejects.toMatchObject({
      code: "role-forbidden",
    });
    expect(mockAssertTeacherAuthorizedForStudent).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    mockAssertActiveTeacherInDistrict.mockReset();
    mockAssertActiveTeacherInDistrict.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );

    await expect(__accommodationsGetHandler(makeRequest())).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("rejects a malformed request payload", async () => {
    await expect(
      __accommodationsGetHandler(makeRequest(null)),
    ).rejects.toMatchObject({ code: "accommodations.invalidRequest" });
    await expect(
      __accommodationsGetHandler(makeRequest({ studentId: "", classId: CLASS_ID })),
    ).rejects.toMatchObject({ code: "accommodations.invalidStudentId" });
    await expect(
      __accommodationsGetHandler(makeRequest({ studentId: STUDENT_UID, classId: "" })),
    ).rejects.toMatchObject({ code: "accommodations.invalidClassId" });
  });

  it("rejects a forbidden extra request field", async () => {
    await expect(
      __accommodationsGetHandler(
        makeRequest({ studentId: STUDENT_UID, classId: CLASS_ID, level: "adapted" }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.forbiddenField" });
  });
});
