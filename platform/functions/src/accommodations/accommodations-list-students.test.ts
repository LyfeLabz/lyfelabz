import type { CallableRequest } from "firebase-functions/v2/https";

const mockRequireDistrictContext = jest.fn();
const mockClassDocRefGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassDocRefGet }));
const mockEnrollmentsWhere = jest.fn();
const mockEnrollmentsCollectionRef = jest.fn(() => ({ where: mockEnrollmentsWhere }));
const mockLogInfo = jest.fn();

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
    classDocRef: mockClassDocRef,
    enrollmentsCollectionRef: mockEnrollmentsCollectionRef,
    log: { info: mockLogInfo },
    requireDistrictContext: mockRequireDistrictContext,
  };
});

const mockCreateRosterDisplayNameResolver = jest.fn();

jest.mock("../enrollments/resolve-roster-display-name", () => ({
  createRosterDisplayNameResolver: mockCreateRosterDisplayNameResolver,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __accommodationsListStudentsHandler } from "./accommodations-list-students";

const TEACHER_UID = "teacher-uid";
const CLASS_ID = "class-abc";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const STUDENT_A = "student-aaa";
const STUDENT_B = "student-bbb";

const CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
  role: "teacher" as const,
});

function makeRequest(data: unknown = { classId: CLASS_ID }): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function classSnapshot(overrides: { exists?: boolean; teacherId?: string; schoolId?: string } = {}) {
  const exists = overrides.exists ?? true;
  return {
    exists,
    data: () =>
      exists
        ? {
            teacherId: overrides.teacherId ?? TEACHER_UID,
            schoolId: overrides.schoolId ?? SCHOOL_ID,
            districtId: DISTRICT_ID,
          }
        : undefined,
  };
}

function enrollmentDoc(studentId: string, overrides: { classId?: string; schoolId?: string; status?: string } = {}) {
  return {
    data: () => ({
      studentId,
      classId: overrides.classId ?? CLASS_ID,
      schoolId: overrides.schoolId ?? SCHOOL_ID,
      status: overrides.status ?? "active",
    }),
  };
}

function setupEnrollmentChain(docs: ReturnType<typeof enrollmentDoc>[]) {
  const whereStatus = jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ docs }) });
  mockEnrollmentsWhere.mockReturnValue({ where: whereStatus });
}

describe("accommodationsListStudents", () => {
  let mockNameResolver: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequireDistrictContext.mockResolvedValue({ ...CONTEXT });
    mockClassDocRefGet.mockResolvedValue(classSnapshot());

    mockNameResolver = jest.fn().mockImplementation((studentId: string) =>
      Promise.resolve({ displayName: `Name-${studentId}` }),
    );
    mockCreateRosterDisplayNameResolver.mockReturnValue(mockNameResolver);

    setupEnrollmentChain([
      enrollmentDoc(STUDENT_A),
      enrollmentDoc(STUDENT_B),
    ]);
  });

  it("returns students sorted by display name with only studentId and studentDisplayName", async () => {
    mockNameResolver
      .mockResolvedValueOnce({ displayName: "Zelda" })
      .mockResolvedValueOnce({ displayName: "Alice" });

    const result = await __accommodationsListStudentsHandler(makeRequest());

    expect(result.classId).toBe(CLASS_ID);
    expect(result.students).toHaveLength(2);
    // Sorted by displayName: Alice (STUDENT_B) < Zelda (STUDENT_A).
    expect(result.students[0]).toEqual({ studentId: STUDENT_B, studentDisplayName: "Alice" });
    expect(result.students[1]).toEqual({ studentId: STUDENT_A, studentDisplayName: "Zelda" });
    // Accommodation state must NOT appear in the response.
    for (const s of result.students) {
      expect(Object.keys(s)).toEqual(["studentId", "studentDisplayName"]);
    }
  });

  it("does not read studentAccommodations documents", async () => {
    // The shared mock has no studentAccommodationDocRef - if the callable
    // tried to read it, it would throw. A clean result proves no such read.
    await __accommodationsListStudentsHandler(makeRequest());
    // No assertion needed beyond not throwing.
  });

  it("returns an empty student list for a class with no active enrollments", async () => {
    setupEnrollmentChain([]);

    const result = await __accommodationsListStudentsHandler(makeRequest());

    expect(result.classId).toBe(CLASS_ID);
    expect(result.students).toHaveLength(0);
  });

  it("rejects a non-teacher caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockResolvedValue({ ...CONTEXT, role: "student" });

    await expect(
      __accommodationsListStudentsHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("rejects an unauthenticated caller", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("unauthenticated", "no auth"),
    );

    await expect(
      __accommodationsListStudentsHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects a missing classId", async () => {
    await expect(
      __accommodationsListStudentsHandler(makeRequest({})),
    ).rejects.toMatchObject({ code: "accommodations.invalidClassId" });
  });

  it("rejects a null payload", async () => {
    await expect(
      __accommodationsListStudentsHandler(makeRequest(null)),
    ).rejects.toMatchObject({ code: "accommodations.invalidRequest" });
  });

  it("rejects a forbidden request field (studentId)", async () => {
    await expect(
      __accommodationsListStudentsHandler(
        makeRequest({ classId: CLASS_ID, studentId: STUDENT_A }),
      ),
    ).rejects.toMatchObject({ code: "accommodations.invalidRequest" });
  });

  it("rejects when the class does not exist", async () => {
    mockClassDocRefGet.mockResolvedValue(classSnapshot({ exists: false }));

    await expect(
      __accommodationsListStudentsHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.notFound" });
  });

  it("rejects when the teacher does not own the class", async () => {
    mockClassDocRefGet.mockResolvedValue(
      classSnapshot({ teacherId: "other-teacher" }),
    );

    await expect(
      __accommodationsListStudentsHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
  });

  it("silently drops enrollment docs that fail defense-in-depth school check", async () => {
    setupEnrollmentChain([
      enrollmentDoc(STUDENT_A),
      enrollmentDoc(STUDENT_B, { schoolId: "wrong-school" }),
    ]);

    const result = await __accommodationsListStudentsHandler(makeRequest());

    expect(result.students).toHaveLength(1);
    expect(result.students[0].studentId).toBe(STUDENT_A);
  });
});
