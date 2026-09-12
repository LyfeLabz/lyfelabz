import type { CallableRequest } from "firebase-functions/v2/https";

// Phase 8G.1 / 8G.3 - focused coverage for the LMS actor gate.
//
// The gate resolves active-teacher status and TENANT context (schoolId,
// districtId) from canonical Firestore records - the caller's users/{uid}
// record and its schools/{schoolId} document - never from the ID-token
// claims. A suspended teacher with a stale teacher claim is denied; a teacher
// with stale tenant claims is normalized to the authoritative context.

const mockUserGet = jest.fn();
const mockSchoolGet = jest.fn();
const mockUserRecordDocRef = jest.fn(() => ({ get: mockUserGet }));
const mockSchoolDocRef = jest.fn(() => ({ get: mockSchoolGet }));

jest.mock("../../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../../shared/errors/platform-error",
  );
  return {
    PlatformError,
    userRecordDocRef: mockUserRecordDocRef,
    schoolDocRef: mockSchoolDocRef,
  };
});

import { assertAuthenticatedTeacherForLms } from "./actor";

function makeRequest(
  overrides: {
    uid?: string;
    hasAuth?: boolean;
    token?: Record<string, unknown> | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "teacher-uid";
  const token =
    overrides.token === undefined
      ? { role: "teacher", schoolId: "school-a", districtId: "district-a" }
      : overrides.token;
  return {
    data: {},
    auth: hasAuth ? ({ uid, token: token ?? undefined } as never) : undefined,
    rawRequest: {} as never,
  };
}

function snap(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

const ACTIVE_TEACHER = {
  authUid: "teacher-uid",
  status: "active",
  role: "teacher",
  schoolId: "school-a",
  createdAt: {},
};

describe("assertAuthenticatedTeacherForLms - authoritative status + tenant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserRecordDocRef.mockImplementation(() => ({ get: mockUserGet }));
    mockSchoolDocRef.mockImplementation(() => ({ get: mockSchoolGet }));
    mockUserGet.mockResolvedValue(snap(ACTIVE_TEACHER));
    mockSchoolGet.mockResolvedValue(snap({ districtId: "district-a", createdAt: {} }));
  });

  test("admits an active teacher and returns authoritative tenant context", async () => {
    const actor = await assertAuthenticatedTeacherForLms(makeRequest());
    expect(actor).toEqual({
      uid: "teacher-uid",
      schoolId: "school-a",
      districtId: "district-a",
    });
    expect(mockUserRecordDocRef).toHaveBeenCalledWith("teacher-uid");
    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-a");
  });

  test("normalizes a STALE schoolId claim to the authoritative record school", async () => {
    // Token claims an obsolete school; the record is authoritative.
    const actor = await assertAuthenticatedTeacherForLms(
      makeRequest({
        token: { role: "teacher", schoolId: "stale-school", districtId: "district-a" },
      }),
    );
    expect(actor.schoolId).toBe("school-a");
    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-a");
  });

  test("normalizes a STALE districtId claim to the authoritative school district", async () => {
    const actor = await assertAuthenticatedTeacherForLms(
      makeRequest({
        token: { role: "teacher", schoolId: "school-a", districtId: "stale-district" },
      }),
    );
    expect(actor.districtId).toBe("district-a");
  });

  test("denies a suspended teacher carrying a stale teacher claim", async () => {
    mockUserGet.mockResolvedValue(snap({ ...ACTIVE_TEACHER, status: "suspended" }));
    await expect(
      assertAuthenticatedTeacherForLms(makeRequest()),
    ).rejects.toMatchObject({ code: "lms.unauthorized" });
  });

  test("denies when the authoritative role is no longer teacher", async () => {
    mockUserGet.mockResolvedValue(snap({ ...ACTIVE_TEACHER, role: "student" }));
    await expect(
      assertAuthenticatedTeacherForLms(makeRequest()),
    ).rejects.toMatchObject({ code: "lms.unauthorized" });
  });

  test("fails closed on a malformed record (authUid mismatch)", async () => {
    mockUserGet.mockResolvedValue(snap({ ...ACTIVE_TEACHER, authUid: "someone-else" }));
    await expect(
      assertAuthenticatedTeacherForLms(makeRequest()),
    ).rejects.toMatchObject({ code: "lms.unauthorized" });
  });

  test("fails closed when the canonical user record is missing", async () => {
    mockUserGet.mockResolvedValue(snap(undefined));
    await expect(
      assertAuthenticatedTeacherForLms(makeRequest()),
    ).rejects.toMatchObject({ code: "lms.unauthorized" });
  });

  test("fails closed when the canonical school context is missing", async () => {
    mockSchoolGet.mockResolvedValue(snap(undefined));
    await expect(
      assertAuthenticatedTeacherForLms(makeRequest()),
    ).rejects.toMatchObject({ code: "lms.unauthorized" });
  });

  test("fails closed when the school has no district", async () => {
    mockSchoolGet.mockResolvedValue(snap({ name: "S", createdAt: {} }));
    await expect(
      assertAuthenticatedTeacherForLms(makeRequest()),
    ).rejects.toMatchObject({ code: "lms.unauthorized" });
  });

  test("fails closed when the record read throws", async () => {
    mockUserGet.mockRejectedValue(new Error("firestore unavailable"));
    await expect(
      assertAuthenticatedTeacherForLms(makeRequest()),
    ).rejects.toThrow();
  });

  test("denies a non-teacher token before any record read", async () => {
    await expect(
      assertAuthenticatedTeacherForLms(
        makeRequest({ token: { role: "student", schoolId: "school-a" } }),
      ),
    ).rejects.toMatchObject({ code: "lms.unauthorized" });
    expect(mockUserGet).not.toHaveBeenCalled();
    expect(mockSchoolGet).not.toHaveBeenCalled();
  });

  test("denies an unauthenticated caller before any record read", async () => {
    await expect(
      assertAuthenticatedTeacherForLms(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "lms.unauthenticated" });
    expect(mockUserGet).not.toHaveBeenCalled();
  });
});
