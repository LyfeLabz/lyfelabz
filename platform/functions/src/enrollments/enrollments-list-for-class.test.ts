import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockEnrollmentsGet = jest.fn();
const mockEnrollmentsWhere = jest.fn(() => ({ get: mockEnrollmentsGet }));
const mockEnrollmentsCollectionRef = jest.fn(() => ({
  where: mockEnrollmentsWhere,
}));
const mockRequireDistrictContext = jest.fn();
const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
const mockResolveDisplayName = jest.fn();

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
    enrollmentsCollectionRef: mockEnrollmentsCollectionRef,
    requireDistrictContext: mockRequireDistrictContext,
  };
});

jest.mock("./resolve-roster-display-name", () => ({
  createRosterDisplayNameResolver: () => mockResolveDisplayName,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __enrollmentsListForClassHandler } from "./enrollments-list-for-class";

const TEACHER_UID = "teacher-uid";
const OTHER_UID = "other-teacher-uid";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL = "school-b";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-abc";

const VALID_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  data: Record<string, unknown> = { classId: CLASS_ID },
): CallableRequest<unknown> {
  return { data } as CallableRequest<unknown>;
}

function classSnap(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      title: "(E) Science",
      status: "active",
      ...overrides,
    }),
  };
}

function enrollmentDocs(
  rows: ReadonlyArray<Record<string, unknown>>,
): { docs: ReadonlyArray<{ data: () => Record<string, unknown> }> } {
  return { docs: rows.map((r) => ({ data: () => r })) };
}

function activeRow(studentId: string, overrides: Record<string, unknown> = {}) {
  return {
    studentId,
    classId: CLASS_ID,
    schoolId: SCHOOL_ID,
    status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
  mockClassGet.mockResolvedValue(classSnap());
  mockResolveDisplayName.mockImplementation((studentId: string) =>
    Promise.resolve({
      studentId,
      displayName: `Name ${studentId}`,
      source: "userProfile",
    }),
  );
});

describe("enrollmentsListForClass", () => {
  test("returns active enrolled students with resolved display names", async () => {
    mockEnrollmentsGet.mockResolvedValue(
      enrollmentDocs([activeRow("s2"), activeRow("s1")]),
    );
    const res = await __enrollmentsListForClassHandler(makeRequest());
    expect(res.classId).toBe(CLASS_ID);
    expect(res.students).toEqual([
      { studentId: "s1", studentDisplayName: "Name s1" },
      { studentId: "s2", studentDisplayName: "Name s2" },
    ]);
    // Only classId is queried; active-only filtering is applied in-handler.
    expect(mockEnrollmentsWhere).toHaveBeenCalledWith("classId", "==", CLASS_ID);
  });

  test("zero active enrollments yields a genuine empty roster (no throw)", async () => {
    mockEnrollmentsGet.mockResolvedValue(enrollmentDocs([]));
    const res = await __enrollmentsListForClassHandler(makeRequest());
    expect(res).toEqual({ classId: CLASS_ID, students: [] });
  });

  test("excludes non-active, cross-class, and cross-school enrollments", async () => {
    mockEnrollmentsGet.mockResolvedValue(
      enrollmentDocs([
        activeRow("s1"),
        activeRow("s2", { status: "withdrawn" }),
        activeRow("s3", { classId: "other-class" }),
        activeRow("s4", { schoolId: OTHER_SCHOOL }),
        activeRow("", {}), // empty studentId dropped
      ]),
    );
    const res = await __enrollmentsListForClassHandler(makeRequest());
    expect(res.students.map((s) => s.studentId)).toEqual(["s1"]);
  });

  test("deduplicates duplicate enrollment rows for the same student", async () => {
    mockEnrollmentsGet.mockResolvedValue(
      enrollmentDocs([activeRow("s1"), activeRow("s1")]),
    );
    const res = await __enrollmentsListForClassHandler(makeRequest());
    expect(res.students).toEqual([
      { studentId: "s1", studentDisplayName: "Name s1" },
    ]);
  });

  test("rejects a non-teacher caller", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      role: "student",
    });
    await expect(
      __enrollmentsListForClassHandler(makeRequest()),
    ).rejects.toThrow(PlatformError);
    expect(mockEnrollmentsCollectionRef).not.toHaveBeenCalled();
  });

  test("rejects a caller who does not own the class (teacher mismatch)", async () => {
    mockClassGet.mockResolvedValue(classSnap({ teacherId: OTHER_UID }));
    await expect(
      __enrollmentsListForClassHandler(makeRequest()),
    ).rejects.toThrow("Caller does not own this class.");
    expect(mockEnrollmentsCollectionRef).not.toHaveBeenCalled();
  });

  test("rejects a class in another school", async () => {
    mockClassGet.mockResolvedValue(classSnap({ schoolId: OTHER_SCHOOL }));
    await expect(
      __enrollmentsListForClassHandler(makeRequest()),
    ).rejects.toThrow(PlatformError);
    expect(mockEnrollmentsCollectionRef).not.toHaveBeenCalled();
  });

  test("rejects a missing class without leaking existence", async () => {
    mockClassGet.mockResolvedValue({ exists: false, data: () => undefined });
    await expect(
      __enrollmentsListForClassHandler(makeRequest()),
    ).rejects.toThrow("Class was not found.");
  });

  test("rejects forbidden request keys", async () => {
    await expect(
      __enrollmentsListForClassHandler(
        makeRequest({ classId: CLASS_ID, schoolId: OTHER_SCHOOL }),
      ),
    ).rejects.toThrow("must not include schoolId");
  });

  test("rejects a missing/invalid classId", async () => {
    await expect(
      __enrollmentsListForClassHandler(makeRequest({})),
    ).rejects.toThrow("classId must be a non-empty string.");
    await expect(
      __enrollmentsListForClassHandler(makeRequest({ classId: "bad id!" })),
    ).rejects.toThrow("classId must be a URL-safe token.");
  });

  test("response projects only studentId + display name (no PII fields)", async () => {
    mockEnrollmentsGet.mockResolvedValue(
      enrollmentDocs([
        activeRow("s1", {
          // adversarial extra fields that must never be projected
          email: "leak@example.com",
          providerAccountId: "raw-google-id",
          identityHash: "a".repeat(64),
        }),
      ]),
    );
    const res = await __enrollmentsListForClassHandler(makeRequest());
    expect(Object.keys(res.students[0]).sort()).toEqual([
      "studentDisplayName",
      "studentId",
    ]);
  });

  test("propagates a load failure (does not silently return empty)", async () => {
    mockEnrollmentsGet.mockRejectedValue(new Error("firestore unavailable"));
    await expect(
      __enrollmentsListForClassHandler(makeRequest()),
    ).rejects.toThrow("firestore unavailable");
  });
});
