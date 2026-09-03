import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));

const mockEnrollmentGet = jest.fn();
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));

const mockRequireDistrictContext = jest.fn();

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

// `authorize-teacher-for-student.ts` reuses `enrollmentIdFor` from
// `../enrollments/enrollments-join-by-code`, a real (unmocked) module. That
// module's own `"../shared"` import resolves to the SAME absolute module
// this mock intercepts, so `platformCallable` must be a safe passthrough
// here too: that file calls it at module-evaluation time to construct its
// own exported callable, which would otherwise throw on import.
jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    platformCallable: (handler: unknown) => handler,
    classDocRef: mockClassDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    requireDistrictContext: mockRequireDistrictContext,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import {
  assertActiveTeacherInDistrict,
  assertTeacherAuthorizedForStudent,
} from "./authorize-teacher-for-student";

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

function classSnapshot(
  overrides: {
    exists?: boolean;
    teacherId?: string;
    schoolId?: string;
    status?: "active" | "archived" | "needsSetup";
  } = {},
) {
  const exists = overrides.exists ?? true;
  return {
    exists,
    data: () =>
      exists
        ? {
            teacherId: overrides.teacherId ?? TEACHER_UID,
            schoolId: overrides.schoolId ?? SCHOOL_ID,
            status: overrides.status ?? "active",
          }
        : undefined,
  };
}

function enrollmentSnapshot(
  overrides: {
    exists?: boolean;
    studentId?: string;
    classId?: string;
    schoolId?: string;
    status?: "active" | "transferred" | "withdrawn" | "archived";
  } = {},
) {
  const exists = overrides.exists ?? true;
  return {
    exists,
    data: () =>
      exists
        ? {
            studentId: overrides.studentId ?? STUDENT_UID,
            classId: overrides.classId ?? CLASS_ID,
            schoolId: overrides.schoolId ?? SCHOOL_ID,
            status: overrides.status ?? "active",
          }
        : undefined,
  };
}

describe("assertActiveTeacherInDistrict", () => {
  beforeEach(() => {
    mockRequireDistrictContext.mockReset();
  });

  it("returns the composed actor for an active teacher", async () => {
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: TEACHER_UID,
      role: "teacher",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });

    await expect(
      assertActiveTeacherInDistrict({} as CallableRequest<unknown>),
    ).resolves.toEqual(ACTOR);
  });

  it("rejects a student caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: STUDENT_UID,
      role: "student",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });

    await expect(
      assertActiveTeacherInDistrict({} as CallableRequest<unknown>),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("propagates the underlying district-context refusal", async () => {
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );

    await expect(
      assertActiveTeacherInDistrict({} as CallableRequest<unknown>),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("assertTeacherAuthorizedForStudent", () => {
  beforeEach(() => {
    mockClassGet.mockReset();
    mockClassDocRef.mockClear();
    mockEnrollmentGet.mockReset();
    mockEnrollmentDocRef.mockClear();
  });

  it("passes when the class is owned+active and the enrollment is active", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());

    await expect(
      assertTeacherAuthorizedForStudent(ACTOR, CLASS_ID, STUDENT_UID),
    ).resolves.toBeUndefined();
    expect(mockEnrollmentDocRef).toHaveBeenCalledWith(
      `${CLASS_ID}__${STUDENT_UID}`,
    );
  });

  it("rejects when the class does not exist", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot({ exists: false }));
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());

    await expect(
      assertTeacherAuthorizedForStudent(ACTOR, CLASS_ID, STUDENT_UID),
    ).rejects.toMatchObject({ code: "accommodations.forbidden" });
  });

  it("rejects when the class is owned by a different teacher", async () => {
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ teacherId: "someone-else" }),
    );
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());

    await expect(
      assertTeacherAuthorizedForStudent(ACTOR, CLASS_ID, STUDENT_UID),
    ).rejects.toMatchObject({ code: "accommodations.forbidden" });
  });

  it("rejects when the class is in a different school (cross-school)", async () => {
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ schoolId: "school-b" }),
    );
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ schoolId: "school-b" }),
    );

    await expect(
      assertTeacherAuthorizedForStudent(ACTOR, CLASS_ID, STUDENT_UID),
    ).rejects.toMatchObject({ code: "accommodations.forbidden" });
  });

  it("rejects when the class is not active (needsSetup)", async () => {
    mockClassGet.mockResolvedValueOnce(
      classSnapshot({ status: "needsSetup" }),
    );
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());

    await expect(
      assertTeacherAuthorizedForStudent(ACTOR, CLASS_ID, STUDENT_UID),
    ).rejects.toMatchObject({ code: "accommodations.forbidden" });
  });

  it("rejects when the class is archived", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot({ status: "archived" }));
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());

    await expect(
      assertTeacherAuthorizedForStudent(ACTOR, CLASS_ID, STUDENT_UID),
    ).rejects.toMatchObject({ code: "accommodations.forbidden" });
  });

  it("rejects when no enrollment exists for the student in the class", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ exists: false }),
    );

    await expect(
      assertTeacherAuthorizedForStudent(ACTOR, CLASS_ID, STUDENT_UID),
    ).rejects.toMatchObject({ code: "accommodations.forbidden" });
  });

  it("rejects when the enrollment is not active (withdrawn)", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ status: "withdrawn" }),
    );

    await expect(
      assertTeacherAuthorizedForStudent(ACTOR, CLASS_ID, STUDENT_UID),
    ).rejects.toMatchObject({ code: "accommodations.forbidden" });
  });

  it("rejects a different student's enrollment (student not enrolled in this class)", async () => {
    mockClassGet.mockResolvedValueOnce(classSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ studentId: "some-other-student" }),
    );

    await expect(
      assertTeacherAuthorizedForStudent(ACTOR, CLASS_ID, STUDENT_UID),
    ).rejects.toMatchObject({ code: "accommodations.forbidden" });
  });

  it("uses tx.get when a transaction is supplied instead of the plain doc read", async () => {
    const txGet = jest
      .fn()
      .mockResolvedValueOnce(classSnapshot())
      .mockResolvedValueOnce(enrollmentSnapshot());
    const tx = { get: txGet } as unknown as FirebaseFirestore.Transaction;

    await expect(
      assertTeacherAuthorizedForStudent(ACTOR, CLASS_ID, STUDENT_UID, tx),
    ).resolves.toBeUndefined();
    expect(txGet).toHaveBeenCalledTimes(2);
    expect(mockClassGet).not.toHaveBeenCalled();
    expect(mockEnrollmentGet).not.toHaveBeenCalled();
  });
});
