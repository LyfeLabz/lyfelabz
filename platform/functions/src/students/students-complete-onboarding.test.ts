import type { CallableRequest } from "firebase-functions/v2/https";

const mockUserGet = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserRecordDocRef = jest.fn(() => ({
  get: mockUserGet,
  update: mockUserUpdate,
}));

const mockSchoolGet = jest.fn();
const mockSchoolDocRef = jest.fn(() => ({ get: mockSchoolGet }));

const mockReadCustomClaims = jest.fn();
const mockWriteCustomClaims = jest.fn();
const mockWriteAuditEvent = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

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
    schoolDocRef: mockSchoolDocRef,
    userRecordDocRef: mockUserRecordDocRef,
    readCustomClaims: mockReadCustomClaims,
    writeCustomClaims: mockWriteCustomClaims,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __studentsCompleteOnboardingHandler } from "./students-complete-onboarding";

function makeRequest(
  overrides: {
    uid?: string | null;
    data?: unknown;
    hasAuth?: boolean;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "uid-abc";
  const data =
    overrides.data === undefined
      ? {
          role: "student",
          schoolId: "school-123",
          displayName: "Test Student",
        }
      : overrides.data;
  return {
    data,
    auth: hasAuth ? ({ uid, token: {} } as never) : undefined,
    rawRequest: {} as never,
  };
}

function provisionedSnapshot() {
  return {
    exists: true,
    data: () => ({
      authUid: "uid-abc",
      status: "provisioned" as const,
      createdAt: {} as never,
    }),
  };
}

function activeStudentSnapshot(
  overrides: {
    role?: string;
    schoolId?: string;
    displayName?: string;
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      authUid: "uid-abc",
      status: "active" as const,
      createdAt: {} as never,
      role: overrides.role ?? "student",
      schoolId: overrides.schoolId ?? "school-123",
      displayName: overrides.displayName ?? "Test Student",
    }),
  };
}

function schoolSnapshotExists(
  overrides: { districtId?: unknown } = {},
) {
  return {
    exists: true,
    data: () => ({
      name: "Test School",
      shortName: "Test",
      timezone: "America/New_York",
      createdAt: {} as never,
      districtId:
        "districtId" in overrides ? overrides.districtId : "district-abc",
    }),
  };
}

describe("studentsCompleteOnboarding", () => {
  beforeEach(() => {
    mockUserGet.mockReset();
    mockUserUpdate.mockReset();
    mockUserRecordDocRef.mockClear();
    mockSchoolGet.mockReset();
    mockSchoolDocRef.mockClear();
    mockReadCustomClaims.mockReset();
    mockWriteCustomClaims.mockReset();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("transitions a provisioned user to active and returns the canonical response", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    const result = await __studentsCompleteOnboardingHandler(makeRequest());

    expect(mockUserRecordDocRef).toHaveBeenCalledWith("uid-abc");
    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-123");
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      role: "student",
      schoolId: "school-123",
      displayName: "Test Student",
      status: "active",
    });
    expect(result).toEqual({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-123",
      alreadyActive: false,
    });
  });

  it("rejects an unauthenticated caller with students.unauthenticated", async () => {
    await expect(
      __studentsCompleteOnboardingHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "students.unauthenticated",
    });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a non-student role in the request payload with students.invalidRole", async () => {
    await expect(
      __studentsCompleteOnboardingHandler(
        makeRequest({
          data: {
            role: "teacher",
            schoolId: "school-123",
            displayName: "Test",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "students.invalidRole" });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an empty schoolId with students.invalidSchoolId", async () => {
    await expect(
      __studentsCompleteOnboardingHandler(
        makeRequest({
          data: { role: "student", schoolId: "   ", displayName: "Test" },
        }),
      ),
    ).rejects.toMatchObject({ code: "students.invalidSchoolId" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an empty displayName with students.invalidDisplayName", async () => {
    await expect(
      __studentsCompleteOnboardingHandler(
        makeRequest({
          data: {
            role: "student",
            schoolId: "school-123",
            displayName: "",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "students.invalidDisplayName" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-object request payload with students.invalidRequest", async () => {
    await expect(
      __studentsCompleteOnboardingHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "students.invalidRequest" });
    await expect(
      __studentsCompleteOnboardingHandler(makeRequest({ data: "not-an-object" })),
    ).rejects.toMatchObject({ code: "students.invalidRequest" });
  });

  it("rejects a missing user document with students.userNotFound", async () => {
    mockUserGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.userNotFound" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing school document with students.schoolNotFound and does not mutate state", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.schoolNotFound" });

    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("is idempotent with healthy claims: an already-active student returns alreadyActive without re-writing and without a district re-derivation", async () => {
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    // Claims already match the record: role student, same school, a non-empty
    // district. This is the steady-state replay - a bounded no-op beyond
    // reading the caller's own claims.
    mockReadCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });

    const result = await __studentsCompleteOnboardingHandler(makeRequest());

    expect(result).toEqual({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-123",
      alreadyActive: true,
    });
    expect(mockReadCustomClaims).toHaveBeenCalledTimes(1);
    expect(mockReadCustomClaims).toHaveBeenCalledWith("uid-abc");
    // No re-derivation and no writes when claims are already healthy.
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    // No warn (repair) log on a healthy replay.
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  it("repairs a partial-activation split-brain: active record but missing claims re-asserts the canonical claims on replay", async () => {
    // Prior attempt left users/{uid} = active but the custom-claims write
    // failed, so the token carries no authorization. The replay must repair
    // the claims (deriving districtId from the authoritative school record),
    // not return success over an unauthorized token.
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({}); // claims never landed
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });

    const result = await __studentsCompleteOnboardingHandler(makeRequest());

    expect(result).toEqual({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-123",
      alreadyActive: true,
    });
    // District is re-derived from the school the record already names; the
    // canonical claims are re-asserted through the shared helper.
    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-123");
    expect(mockWriteCustomClaims).toHaveBeenCalledTimes(1);
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    // Repair does NOT re-run the activation update and does NOT emit a second
    // activation audit event.
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    // The repair is logged as a warning, not a second activation.
    expect(mockLogWarn).toHaveBeenCalledWith(
      "students.onboardingClaimsRepaired",
      { uid: "uid-abc", schoolId: "school-123" },
    );
  });

  it("repairs a stale role claim: a non-student role claim on an active student record is repaired to student without escalation", async () => {
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    // The token names a broader role than the record; the record wins and the
    // repair restores role student. The client cannot broaden the role.
    mockReadCustomClaims.mockResolvedValueOnce({
      role: "teacher",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockWriteCustomClaims.mockResolvedValueOnce({});

    const result = await __studentsCompleteOnboardingHandler(makeRequest());

    expect(result.alreadyActive).toBe(true);
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("repairs a stale school claim: a claim naming a different school is re-asserted from the canonical record, and the client cannot select an alternate school", async () => {
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    // Claims disagree with the record (wrong school). The record schoolId is
    // canonical; the district is re-derived from the canonical school.
    mockReadCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-stale",
      districtId: "district-stale",
    });
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockWriteCustomClaims.mockResolvedValueOnce({});

    const result = await __studentsCompleteOnboardingHandler(makeRequest());

    expect(result.alreadyActive).toBe(true);
    // Repair uses the RECORD schoolId, not the stale claim value, and
    // re-derives the district from that canonical school.
    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-123");
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("repairs a stale district claim: a missing districtId re-derives the district server-side from the canonical school", async () => {
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    // Role and school agree, but the district claim is absent (a partial
    // write). The server re-derives it from the canonical school record.
    mockReadCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-123",
    });
    mockSchoolGet.mockResolvedValueOnce(
      schoolSnapshotExists({ districtId: "district-canonical" }),
    );
    mockWriteCustomClaims.mockResolvedValueOnce({});

    const result = await __studentsCompleteOnboardingHandler(makeRequest());

    expect(result.alreadyActive).toBe(true);
    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-123");
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-123",
      districtId: "district-canonical",
    });
  });

  it("treats a claims read failure conservatively (empty view) and re-asserts claims", async () => {
    // readCustomClaims resolves to {} on an unreadable claim set; the branch
    // must fail toward repair rather than trusting unconfirmed state.
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({});
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockWriteCustomClaims.mockResolvedValueOnce({});

    await __studentsCompleteOnboardingHandler(makeRequest());

    expect(mockWriteCustomClaims).toHaveBeenCalledTimes(1);
  });

  it("fails closed during repair when the canonical school is missing, writing no claims and leaving retry possible", async () => {
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({}); // needs repair
    mockSchoolGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.schoolNotFound" });

    // No partial claim written; canonical active record untouched, so the
    // caller re-enters this idempotent branch and can self-heal on retry.
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("fails closed during repair when the canonical school has no district, writing no claims", async () => {
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({}); // needs repair
    mockSchoolGet.mockResolvedValueOnce(
      schoolSnapshotExists({ districtId: undefined }),
    );

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });

    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates a claim-write failure during repair without falsely reporting success and without a second activation audit", async () => {
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({}); // needs repair
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    const claimsErr = new PlatformError(
      "claims.writeFailed",
      "boom",
      new Error("network"),
    );
    mockWriteCustomClaims.mockRejectedValueOnce(claimsErr);

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toBe(claimsErr);
    // Canonical active state is not mutated again; no second activation audit.
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("self-heal repair is idempotent: once claims are healthy a subsequent replay writes nothing", async () => {
    // First call repairs the split-brain.
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({});
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockWriteCustomClaims.mockResolvedValueOnce({});
    await __studentsCompleteOnboardingHandler(makeRequest());
    expect(mockWriteCustomClaims).toHaveBeenCalledTimes(1);

    // Second call now sees healthy claims and performs no further write.
    mockUserGet.mockResolvedValueOnce(activeStudentSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    const result = await __studentsCompleteOnboardingHandler(makeRequest());

    expect(result.alreadyActive).toBe(true);
    expect(mockWriteCustomClaims).toHaveBeenCalledTimes(1); // unchanged
    expect(mockSchoolDocRef).toHaveBeenCalledTimes(1); // only the repair call
  });

  it("rejects an already-active user whose role or schoolId conflicts with the request with students.invalidStatus", async () => {
    mockUserGet.mockResolvedValueOnce(
      activeStudentSnapshot({ schoolId: "school-different" }),
    );

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "students.invalidStatus" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
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
        __studentsCompleteOnboardingHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "students.invalidStatus" });
      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockWriteCustomClaims).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    },
  );

  it("invokes the canonical claims helper with the exact canonical shape", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    await __studentsCompleteOnboardingHandler(makeRequest());

    expect(mockWriteCustomClaims).toHaveBeenCalledTimes(1);
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    const claimsCall = mockWriteCustomClaims.mock.calls[0][0];
    expect(Object.keys(claimsCall).sort()).toEqual([
      "districtId",
      "role",
      "schoolId",
      "status",
      "uid",
    ]);
  });

  it("resolves districtId from the canonical school record, ignoring any client-supplied district value", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(
      schoolSnapshotExists({ districtId: "district-canonical" }),
    );
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-123",
      districtId: "district-canonical",
    });
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    await __studentsCompleteOnboardingHandler(
      makeRequest({
        data: {
          role: "student",
          schoolId: "school-123",
          displayName: "Test Student",
          districtId: "district-client-spoofed",
        },
      }),
    );

    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-abc",
      status: "active",
      role: "student",
      schoolId: "school-123",
      districtId: "district-canonical",
    });
  });

  it("throws district-unassigned when the school has no districtId", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(
      schoolSnapshotExists({ districtId: undefined }),
    );

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "district-unassigned",
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("throws district-unassigned when the school districtId is empty or whitespace", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(
      schoolSnapshotExists({ districtId: "" }),
    );
    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });

    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(
      schoolSnapshotExists({ districtId: "   " }),
    );
    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });

    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("throws district-unassigned when the school districtId is not a string", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(
      schoolSnapshotExists({ districtId: 42 }),
    );

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("invokes the canonical audit helper with action students.activated and the canonical target fields", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    await __studentsCompleteOnboardingHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "uid-abc",
      actorRole: "student",
      action: "students.activated",
      targetType: "user",
      targetId: "uid-abc",
      schoolId: "school-123",
      districtId: "district-abc",
    });
  });

  it("orders side effects: user update, then claims, then audit event", async () => {
    const calls: string[] = [];
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteCustomClaims.mockImplementationOnce(() => {
      calls.push("claims");
      return Promise.resolve({
        role: "student",
        schoolId: "school-123",
        districtId: "district-abc",
      });
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __studentsCompleteOnboardingHandler(makeRequest());

    expect(calls).toEqual(["update", "claims", "audit"]);
  });

  it("propagates a downstream claims helper failure and does not write the audit event", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    const claimsErr = new PlatformError(
      "claims.writeFailed",
      "boom",
      new Error("network"),
    );
    mockWriteCustomClaims.mockRejectedValueOnce(claimsErr);

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toBe(claimsErr);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates a downstream audit helper failure", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    const auditErr = new PlatformError(
      "audit.writeFailed",
      "boom",
      new Error("network"),
    );
    mockWriteAuditEvent.mockRejectedValueOnce(auditErr);

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toBe(auditErr);
  });

  it("propagates a downstream user update failure and does not write claims or audit", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    const updateErr = new Error("firestore down");
    mockUserUpdate.mockRejectedValueOnce(updateErr);

    await expect(
      __studentsCompleteOnboardingHandler(makeRequest()),
    ).rejects.toBe(updateErr);
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });
});
