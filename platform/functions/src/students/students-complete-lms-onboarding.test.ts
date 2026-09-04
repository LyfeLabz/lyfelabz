import type { CallableRequest } from "firebase-functions/v2/https";

const mockUserGet = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserRecordDocRef = jest.fn(() => ({
  get: mockUserGet,
  update: mockUserUpdate,
}));

// Fluent enrollment query: `.where(...).where(...).get()`. `where` returns
// the same query object so any chain length resolves to `mockEnrollmentsGet`.
const mockEnrollmentsGet = jest.fn();
const enrollmentsQuery: { where: jest.Mock; get: jest.Mock } = {
  where: jest.fn(() => enrollmentsQuery),
  get: mockEnrollmentsGet,
};
const mockEnrollmentsCollectionRef = jest.fn(() => enrollmentsQuery);

// Class reads are keyed by classId so a test can register several classes
// with distinct records (LMS vs manual, active vs archived, distinct
// schools).
let classesById: Record<
  string,
  { exists: boolean; data: () => unknown } | undefined
> = {};
const mockClassDocRef = jest.fn((classId: string) => ({
  get: () =>
    Promise.resolve(
      classesById[classId] ?? { exists: false, data: () => undefined },
    ),
}));

const mockSchoolGet = jest.fn();
const mockSchoolDocRef = jest.fn(() => ({ get: mockSchoolGet }));

const mockWriteCustomClaims = jest.fn();
const mockReadCustomClaims = jest.fn();
const mockWriteAuditEvent = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

// Sprint 29G.5K: the activation handler now calls the membership
// materialization step before resolving the school. That step has its own
// dedicated unit coverage (materialize-lms-enrollments.test.ts); here it is
// mocked to a no-op so these tests stay focused on the activation contract.
// Individual tests can override `mockMaterialize` to simulate a match.
const mockMaterialize = jest.fn().mockResolvedValue({
  created: 0,
  matchedClasses: 0,
  schoolId: null,
});
jest.mock("./materialize-lms-enrollments", () => ({
  materializeLmsEnrollmentsFromMembership: (
    ...args: readonly unknown[]
  ) => mockMaterialize(...args),
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
    schoolDocRef: mockSchoolDocRef,
    userRecordDocRef: mockUserRecordDocRef,
    writeCustomClaims: mockWriteCustomClaims,
    readCustomClaims: mockReadCustomClaims,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __studentsCompleteLmsOnboardingHandler } from "./students-complete-lms-onboarding";

function makeRequest(
  overrides: {
    uid?: string | null;
    data?: unknown;
    hasAuth?: boolean;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "uid-abc";
  const data = "data" in overrides ? overrides.data : {};
  return {
    data,
    auth: hasAuth ? ({ uid, token: {} } as never) : undefined,
    rawRequest: {} as never,
  };
}

function provisionedSnapshot(
  overrides: { displayName?: string } = {},
) {
  return {
    exists: true,
    data: () => ({
      authUid: "uid-abc",
      status: "provisioned" as const,
      createdAt: {} as never,
      ...("displayName" in overrides
        ? { displayName: overrides.displayName }
        : { displayName: "Rostered Student" }),
    }),
  };
}

function activeStudentSnapshot(
  overrides: { role?: string; schoolId?: string } = {},
) {
  return {
    exists: true,
    data: () => ({
      authUid: "uid-abc",
      status: "active" as const,
      createdAt: {} as never,
      role: overrides.role ?? "student",
      schoolId: overrides.schoolId ?? "school-beta",
      displayName: "Rostered Student",
    }),
  };
}

function enrollmentDoc(
  id: string,
  data: { classId: string; status?: string; schoolId?: string },
) {
  return {
    id,
    data: () => ({
      studentId: "uid-abc",
      classId: data.classId,
      schoolId: data.schoolId ?? "school-beta",
      status: data.status ?? "active",
    }),
  };
}

function lmsClass(
  overrides: { schoolId?: string; status?: string } = {},
) {
  return {
    exists: true,
    data: () => ({
      teacherId: "teacher-1",
      schoolId: overrides.schoolId ?? "school-beta",
      title: "Science Block A",
      createdAt: {} as never,
      status: overrides.status ?? "active",
      grade: "7",
      block: "A",
      enrollmentSource: "lms",
      lmsProviderRef: "google-classroom",
    }),
  };
}

function manualClass(overrides: { schoolId?: string } = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: "teacher-1",
      schoolId: overrides.schoolId ?? "school-beta",
      title: "Manual Block B",
      createdAt: {} as never,
      status: "active",
      grade: "7",
      block: "B",
      joinCode: "ABCD1234",
    }),
  };
}

function schoolSnapshotExists(overrides: { districtId?: unknown } = {}) {
  return {
    exists: true,
    data: () => ({
      name: "Beta School",
      shortName: "Beta",
      timezone: "America/New_York",
      createdAt: {} as never,
      districtId:
        "districtId" in overrides ? overrides.districtId : "district-beta",
    }),
  };
}

function enrollmentsSnapshot(docs: ReturnType<typeof enrollmentDoc>[]) {
  return { docs };
}

describe("studentsCompleteLmsOnboarding", () => {
  beforeEach(() => {
    mockUserGet.mockReset();
    mockUserUpdate.mockReset();
    mockUserRecordDocRef.mockClear();
    mockEnrollmentsGet.mockReset();
    enrollmentsQuery.where.mockClear();
    mockEnrollmentsCollectionRef.mockClear();
    mockClassDocRef.mockClear();
    classesById = {};
    mockSchoolGet.mockReset();
    mockSchoolDocRef.mockClear();
    mockWriteCustomClaims.mockReset();
    mockReadCustomClaims.mockReset();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  // ---- Success ------------------------------------------------------------

  it("activates a provisioned student who has an active LMS enrollment and derives schoolId/districtId server-side", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("class-lms-1__uid-abc", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-beta",
      districtId: "district-beta",
    });
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __studentsCompleteLmsOnboardingHandler(makeRequest());

    expect(mockUserRecordDocRef).toHaveBeenCalledWith("uid-abc");
    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-beta");
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      role: "student",
      schoolId: "school-beta",
      displayName: "Rostered Student",
      status: "active",
    });
    expect(result).toEqual({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-beta",
      alreadyActive: false,
    });
  });

  it("Sprint 29G.5K: materializes membership enrollments for a provisioned student before resolving school (zero-coordination)", async () => {
    mockMaterialize.mockClear();
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("class-lms-1__uid-abc", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-beta",
      districtId: "district-beta",
    });
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-m", record: {} });

    const result = await __studentsCompleteLmsOnboardingHandler(makeRequest());

    // The materialization step ran exactly once for this caller, before the
    // activation completed (the student's own first Continue both enrolls
    // and activates, with no teacher roster sync).
    expect(mockMaterialize).toHaveBeenCalledTimes(1);
    expect(mockMaterialize).toHaveBeenCalledWith({ uid: "uid-abc" });
    expect(result.status).toBe("active");
    expect(result.role).toBe("student");
  });

  it("writes the canonical claims shape derived from server state", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({});
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __studentsCompleteLmsOnboardingHandler(makeRequest());

    expect(mockWriteCustomClaims).toHaveBeenCalledTimes(1);
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-beta",
      districtId: "district-beta",
    });
  });

  it("emits students.activated with a PII-free lms provenance marker and canonical target fields", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({});
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __studentsCompleteLmsOnboardingHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "uid-abc",
      actorRole: "student",
      action: "students.activated",
      targetType: "user",
      targetId: "uid-abc",
      schoolId: "school-beta",
      districtId: "district-beta",
      payload: { source: "lms" },
    });
  });

  it("orders side effects: user update, then claims, then audit event", async () => {
    const calls: string[] = [];
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteCustomClaims.mockImplementationOnce(() => {
      calls.push("claims");
      return Promise.resolve({});
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __studentsCompleteLmsOnboardingHandler(makeRequest());

    expect(calls).toEqual(["update", "claims", "audit"]);
  });

  it("accepts an optional client displayName and prefers it over the recorded name", async () => {
    mockUserGet.mockResolvedValueOnce(
      provisionedSnapshot({ displayName: "Auto Name" }),
    );
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({});
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __studentsCompleteLmsOnboardingHandler(
      makeRequest({ data: { displayName: "  Chosen Name  " } }),
    );

    expect(mockUserUpdate).toHaveBeenCalledWith({
      role: "student",
      schoolId: "school-beta",
      displayName: "Chosen Name",
      status: "active",
    });
  });

  it("succeeds safely with multiple qualifying LMS enrollments in the same school", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass();
    classesById["class-lms-2"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([
        enrollmentDoc("e1", { classId: "class-lms-1" }),
        enrollmentDoc("e2", { classId: "class-lms-2" }),
      ]),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({});
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __studentsCompleteLmsOnboardingHandler(makeRequest());

    expect(result.alreadyActive).toBe(false);
    expect(result.schoolId).toBe("school-beta");
  });

  // ---- No qualifying enrollment ------------------------------------------

  it("refuses activation when there is no enrollment at all (bridge alone does not qualify)", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockEnrollmentsGet.mockResolvedValueOnce(enrollmentsSnapshot([]));

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "students.noLmsEnrollment",
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses activation for a manual-only enrollment (join-code class does not qualify)", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-manual-1"] = manualClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-manual-1" })]),
    );

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.noLmsEnrollment" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("refuses activation when the LMS class is archived (terminal class does not qualify)", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-arch"] = lmsClass({ status: "archived" });
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-lms-arch" })]),
    );

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.noLmsEnrollment" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("refuses activation when the referenced class no longer exists", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    // classesById intentionally empty: classDocRef.get resolves not-exists.
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-missing" })]),
    );

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.noLmsEnrollment" });
  });

  it("refuses activation when a manual and an LMS class are both present but only the manual one has an active enrollment shape (LMS excluded by source)", async () => {
    // Guards the source discriminator: an active enrollment referencing a
    // non-LMS class never qualifies even alongside other active enrollments.
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-manual-1"] = manualClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-manual-1" })]),
    );

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.noLmsEnrollment" });
  });

  // ---- Conflicting membership --------------------------------------------

  it("fails closed when qualifying LMS enrollments resolve to more than one school", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass({ schoolId: "school-beta" });
    classesById["class-lms-2"] = lmsClass({ schoolId: "school-other" });
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([
        enrollmentDoc("e1", { classId: "class-lms-1" }),
        enrollmentDoc("e2", { classId: "class-lms-2" }),
      ]),
    );

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.conflictingLmsEnrollment" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("fails closed when the derived school is not assigned to a district", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce(
      schoolSnapshotExists({ districtId: undefined }),
    );

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("fails closed when the derived school record does not exist", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.schoolNotFound" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  // ---- Trust boundary -----------------------------------------------------

  it.each([
    ["schoolId"],
    ["districtId"],
    ["classId"],
    ["studentId"],
    ["enrollmentId"],
    ["providerId"],
    ["providerAccountId"],
    ["uid"],
    ["role"],
  ] as const)(
    "refuses a request that carries the authority-bearing field %s",
    async (field) => {
      // The handler must fail closed BEFORE any read when the client tries
      // to smuggle authority. No user, enrollment, class, or school read.
      await expect(
        __studentsCompleteLmsOnboardingHandler(
          makeRequest({ data: { [field]: "attacker-value" } }),
        ),
      ).rejects.toMatchObject({ code: "students.forbiddenField" });
      expect(mockUserRecordDocRef).not.toHaveBeenCalled();
      expect(mockEnrollmentsCollectionRef).not.toHaveBeenCalled();
      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    },
  );

  it("never sends a client value into the claims or school derivation even if a forbidden field slips a spoofed value", async () => {
    // Belt-and-suspenders: a spoofed schoolId is rejected outright, so the
    // school derivation can only ever use the server-resolved value.
    await expect(
      __studentsCompleteLmsOnboardingHandler(
        makeRequest({ data: { schoolId: "school-attacker", displayName: "X" } }),
      ),
    ).rejects.toMatchObject({ code: "students.forbiddenField" });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
  });

  it("rejects a non-object request payload with students.invalidRequest", async () => {
    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest({ data: "nope" })),
    ).rejects.toMatchObject({ code: "students.invalidRequest" });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
  });

  it("rejects an empty-string displayName with students.invalidDisplayName", async () => {
    await expect(
      __studentsCompleteLmsOnboardingHandler(
        makeRequest({ data: { displayName: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "students.invalidDisplayName" });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
  });

  it("refuses activation when neither a client nor a recorded display name is available", async () => {
    mockUserGet.mockResolvedValueOnce(
      // Provisioned user with no recorded displayName.
      {
        exists: true,
        data: () => ({
          authUid: "uid-abc",
          status: "provisioned" as const,
          createdAt: {} as never,
        }),
      },
    );
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "students.invalidDisplayName" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  // ---- Auth / status ------------------------------------------------------

  it("rejects an unauthenticated caller with students.unauthenticated", async () => {
    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "students.unauthenticated" });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
  });

  it("rejects a missing user document with students.userNotFound", async () => {
    mockUserGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.userNotFound" });
    expect(mockEnrollmentsCollectionRef).not.toHaveBeenCalled();
  });

  it.each([
    ["pendingVerification"],
    ["suspended"],
    ["archived"],
  ] as const)(
    "rejects a caller whose status is %s with students.invalidStatus",
    async (status) => {
      mockUserGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          authUid: "uid-abc",
          status,
          createdAt: {} as never,
        }),
      });

      await expect(
        __studentsCompleteLmsOnboardingHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "students.invalidStatus" });
      expect(mockEnrollmentsCollectionRef).not.toHaveBeenCalled();
      expect(mockUserUpdate).not.toHaveBeenCalled();
    },
  );

  // ---- Idempotency --------------------------------------------------------

  it("is idempotent for an already-active student with healthy claims: no repair, no user update, no enrollment/school read, no audit", async () => {
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    // Claims already match the record: role student, same school, a
    // non-empty district. This is the steady-state replay - a pure,
    // bounded no-op beyond reading the caller's own claims.
    mockReadCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-beta",
      districtId: "district-beta",
    });

    const result = await __studentsCompleteLmsOnboardingHandler(makeRequest());

    expect(result).toEqual({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-beta",
      alreadyActive: true,
    });
    expect(mockReadCustomClaims).toHaveBeenCalledTimes(1);
    expect(mockReadCustomClaims).toHaveBeenCalledWith("uid-abc");
    // No re-derivation and no writes when claims are already healthy.
    expect(mockEnrollmentsCollectionRef).not.toHaveBeenCalled();
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("repairs a partial-activation split-brain: active record but missing claims re-asserts the canonical claims on replay", async () => {
    // Prior attempt left users/{uid} = active but the custom-claims write
    // failed, so the token carries no authorization. The replay must repair
    // the claims (deriving districtId from the authoritative school), not
    // return success over an unauthorized token.
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({}); // claims never landed
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockWriteCustomClaims.mockResolvedValueOnce({});

    const result = await __studentsCompleteLmsOnboardingHandler(makeRequest());

    expect(result).toEqual({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-beta",
      alreadyActive: true,
    });
    // District is re-derived from the school the record already names; the
    // canonical claims are re-asserted through the shared helper.
    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-beta");
    expect(mockWriteCustomClaims).toHaveBeenCalledTimes(1);
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-beta",
      districtId: "district-beta",
    });
    // Repair does NOT re-scan enrollment, does NOT re-run the activation
    // update, and does NOT emit a second activation audit event.
    expect(mockEnrollmentsCollectionRef).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("repairs stale claims: active record but claims name a different school re-asserts the record's canonical claims", async () => {
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    // Claims disagree with the record (wrong school). The record wins.
    mockReadCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-stale",
      districtId: "district-stale",
    });
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockWriteCustomClaims.mockResolvedValueOnce({});

    const result = await __studentsCompleteLmsOnboardingHandler(makeRequest());

    expect(result.alreadyActive).toBe(true);
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-beta",
      districtId: "district-beta",
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("treats a claims read failure conservatively (empty view) and re-asserts claims", async () => {
    // readCustomClaims resolves to {} on an unreadable claim set; the branch
    // must fail toward repair rather than trusting unconfirmed state.
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({});
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockWriteCustomClaims.mockResolvedValueOnce({});

    await __studentsCompleteLmsOnboardingHandler(makeRequest());

    expect(mockWriteCustomClaims).toHaveBeenCalledTimes(1);
  });

  it("returns alreadyActive for an already-active student without re-verifying LMS qualification (no enrollment read)", async () => {
    // Q4: an already-active student (including one activated by the manual
    // path with no LMS enrollment) is already active; this callable does not
    // re-derive LMS eligibility on the idempotent path. Their own healthy
    // claims are preserved and no roster scan occurs.
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-beta",
      districtId: "district-beta",
    });

    const result = await __studentsCompleteLmsOnboardingHandler(makeRequest());

    expect(result.alreadyActive).toBe(true);
    expect(mockEnrollmentsCollectionRef).not.toHaveBeenCalled();
  });

  it("rejects an already-active non-student caller with students.invalidStatus", async () => {
    mockUserGet.mockResolvedValueOnce(
      activeStudentSnapshot({ role: "teacher" }),
    );

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.invalidStatus" });
    expect(mockReadCustomClaims).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("fails closed on an active student record missing its schoolId before any claims read or repair", async () => {
    mockUserGet.mockResolvedValueOnce(
      activeStudentSnapshot({ schoolId: "" }),
    );

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.invalidStatus" });
    expect(mockReadCustomClaims).not.toHaveBeenCalled();
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  // ---- Downstream failure propagation ------------------------------------

  it("propagates a downstream claims failure and does not write the audit event", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    const claimsErr = new PlatformError("claims.writeFailed", "boom");
    mockWriteCustomClaims.mockRejectedValueOnce(claimsErr);

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toBe(claimsErr);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates a downstream audit failure after the record and claims are already active (no duplicate writes)", async () => {
    // The audit event is the last side effect and writes AFTER the record
    // update and claims. A failure here fails the callable (audit is not
    // weakened), leaving the student correctly authorized. The user update
    // and claims write each occur exactly once and are not retried here.
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    classesById["class-lms-1"] = lmsClass();
    mockEnrollmentsGet.mockResolvedValueOnce(
      enrollmentsSnapshot([enrollmentDoc("e1", { classId: "class-lms-1" })]),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({});
    const auditErr = new PlatformError("audit.writeFailed", "boom");
    mockWriteAuditEvent.mockRejectedValueOnce(auditErr);

    await expect(
      __studentsCompleteLmsOnboardingHandler(makeRequest()),
    ).rejects.toBe(auditErr);
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockWriteCustomClaims).toHaveBeenCalledTimes(1);
  });
});
