import type { CallableRequest } from "firebase-functions/v2/https";

const mockUserGet = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserRecordDocRef = jest.fn(() => ({
  get: mockUserGet,
  update: mockUserUpdate,
}));

const mockSchoolGet = jest.fn();
const mockSchoolDocRef = jest.fn(() => ({ get: mockSchoolGet }));

const mockAssertAllowlisted = jest.fn();
const mockResolvePilotSchoolId = jest.fn();
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
    assertTeacherPilotAllowlisted: mockAssertAllowlisted,
    resolvePilotSchoolId: mockResolvePilotSchoolId,
    readCustomClaims: mockReadCustomClaims,
    writeCustomClaims: mockWriteCustomClaims,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __teachersActivatePilotHandler } from "./teachers-activate-pilot";

const PILOT_SCHOOL_ID = "weston-middle";
const PILOT_DISTRICT_ID = "district-weston";
const PILOT_EMAIL = "brownc@weston.org";

function makeRequest(
  overrides: { uid?: string; data?: unknown; hasAuth?: boolean } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "uid-brown";
  const data = overrides.data === undefined ? { role: "teacher" } : overrides.data;
  return {
    data,
    auth: hasAuth ? ({ uid, token: {} } as never) : undefined,
    rawRequest: {} as never,
  };
}

function provisionedSnapshot(
  overrides: { email?: string | undefined; displayName?: string | undefined } = {},
) {
  const base: Record<string, unknown> = {
    authUid: "uid-brown",
    status: "provisioned",
    createdAt: {},
  };
  if (!("email" in overrides) || overrides.email !== undefined) {
    base.email = "email" in overrides ? overrides.email : PILOT_EMAIL;
  }
  if (!("displayName" in overrides) || overrides.displayName !== undefined) {
    base.displayName =
      "displayName" in overrides ? overrides.displayName : "Chris Brown";
  }
  return { exists: true, data: () => base };
}

function activeTeacherSnapshot(
  overrides: { schoolId?: string; role?: string; displayName?: string } = {},
) {
  return {
    exists: true,
    data: () => ({
      authUid: "uid-brown",
      status: "active",
      role: overrides.role ?? "teacher",
      schoolId: overrides.schoolId ?? PILOT_SCHOOL_ID,
      displayName: overrides.displayName ?? "Chris Brown",
      email: PILOT_EMAIL,
      createdAt: {},
    }),
  };
}

function schoolSnapshot(overrides: { districtId?: unknown } = {}) {
  const hasDistrict = !("districtId" in overrides) || overrides.districtId !== undefined;
  return {
    exists: true,
    data: () => ({
      name: "Weston Middle School",
      shortName: "WMS",
      timezone: "America/New_York",
      ...(hasDistrict
        ? { districtId: "districtId" in overrides ? overrides.districtId : PILOT_DISTRICT_ID }
        : {}),
    }),
  };
}

function healthyClaims() {
  return {
    role: "teacher",
    schoolId: PILOT_SCHOOL_ID,
    districtId: PILOT_DISTRICT_ID,
  };
}

describe("teachersActivatePilot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolvePilotSchoolId.mockResolvedValue(PILOT_SCHOOL_ID);
    mockAssertAllowlisted.mockResolvedValue(undefined);
    mockWriteCustomClaims.mockResolvedValue({});
    mockWriteAuditEvent.mockResolvedValue({ eventId: "evt-1", record: {} });
    mockUserUpdate.mockResolvedValue(undefined);
  });

  it("activates an authenticated allowlisted provisioned teacher", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

    const result = await __teachersActivatePilotHandler(makeRequest());

    expect(result).toEqual({
      uid: "uid-brown",
      status: "active",
      role: "teacher",
      schoolId: PILOT_SCHOOL_ID,
      alreadyActive: false,
    });
    // email is read server-side from the record, never from the client.
    expect(mockAssertAllowlisted).toHaveBeenCalledWith(PILOT_EMAIL);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      role: "teacher",
      schoolId: PILOT_SCHOOL_ID,
      displayName: "Chris Brown",
      status: "active",
    });
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-brown",
      status: "active",
      role: "teacher",
      schoolId: PILOT_SCHOOL_ID,
      districtId: PILOT_DISTRICT_ID,
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "uid-brown",
        actorRole: "teacher",
        action: "teachers.pilotActivated",
        targetType: "user",
        targetId: "uid-brown",
        schoolId: PILOT_SCHOOL_ID,
        districtId: PILOT_DISTRICT_ID,
      }),
    );
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(
      __teachersActivatePilotHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "teachers.unauthenticated" });
    expect(mockUserGet).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("rejects a payload whose role is not teacher", async () => {
    await expect(
      __teachersActivatePilotHandler(makeRequest({ data: { role: "student" } })),
    ).rejects.toMatchObject({ code: "teachers.invalidRole" });
    expect(mockUserGet).not.toHaveBeenCalled();
  });

  it("fails closed and does not activate a non-allowlisted teacher", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockAssertAllowlisted.mockRejectedValueOnce(
      new PlatformError("teachers.pilotNotAllowlisted", "no"),
    );

    await expect(
      __teachersActivatePilotHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.pilotNotAllowlisted" });

    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("uses the server-trusted record email, never a client-supplied email", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

    // Client attempts to smuggle a different email + school; both ignored.
    await __teachersActivatePilotHandler(
      makeRequest({
        data: { role: "teacher", email: "attacker@evil.example", schoolId: "other-school" },
      }),
    );

    expect(mockAssertAllowlisted).toHaveBeenCalledWith(PILOT_EMAIL);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: PILOT_SCHOOL_ID }),
    );
  });

  it("fails closed when the pilot school is not configured", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockResolvePilotSchoolId.mockRejectedValueOnce(
      new PlatformError("teachers.pilotSchoolUnconfigured", "no"),
    );

    await expect(
      __teachersActivatePilotHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.pilotSchoolUnconfigured" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("fails closed when the pilot school record does not exist", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      __teachersActivatePilotHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.schoolNotFound" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("fails closed when the pilot school has no districtId", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshot({ districtId: undefined }));

    await expect(
      __teachersActivatePilotHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("assigns schoolId from config and districtId from the canonical school record", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockResolvePilotSchoolId.mockResolvedValueOnce("weston-middle");
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshot({ districtId: "district-weston" }));

    await __teachersActivatePilotHandler(makeRequest());

    expect(mockSchoolDocRef).toHaveBeenCalledWith("weston-middle");
    expect(mockWriteCustomClaims).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolId: "weston-middle",
        districtId: "district-weston",
      }),
    );
  });

  it("preserves the provisioned Google displayName", async () => {
    mockUserGet.mockResolvedValueOnce(
      provisionedSnapshot({ displayName: "Ms. Weston" }),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

    await __teachersActivatePilotHandler(makeRequest());

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Ms. Weston" }),
    );
  });

  it("falls back to the email local-part when no displayName is present", async () => {
    mockUserGet.mockResolvedValueOnce(
      provisionedSnapshot({ displayName: undefined }),
    );
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

    await __teachersActivatePilotHandler(makeRequest());

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "brownc" }),
    );
  });

  it("is idempotent for an already-active teacher at the pilot school with healthy claims", async () => {
    mockUserGet.mockResolvedValueOnce(activeTeacherSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce(healthyClaims());

    const result = await __teachersActivatePilotHandler(makeRequest());

    expect(result).toEqual({
      uid: "uid-brown",
      status: "active",
      role: "teacher",
      schoolId: PILOT_SCHOOL_ID,
      alreadyActive: true,
    });
    // Revocation semantics: no allowlist re-check for an active teacher.
    expect(mockAssertAllowlisted).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("repairs missing/stale claims for an already-active same-school teacher without re-activating", async () => {
    mockUserGet.mockResolvedValueOnce(activeTeacherSnapshot());
    mockReadCustomClaims.mockResolvedValueOnce({}); // stale/missing
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

    const result = await __teachersActivatePilotHandler(makeRequest());

    expect(result.alreadyActive).toBe(true);
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-brown",
      status: "active",
      role: "teacher",
      schoolId: PILOT_SCHOOL_ID,
      districtId: PILOT_DISTRICT_ID,
    });
    // Repair does not re-emit the activation audit event.
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("refuses to move an active teacher assigned to a different school", async () => {
    mockUserGet.mockResolvedValueOnce(
      activeTeacherSnapshot({ schoolId: "school-beta" }),
    );

    await expect(
      __teachersActivatePilotHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.activeSchoolMismatch" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("refuses an already-active non-teacher (role conflict)", async () => {
    mockUserGet.mockResolvedValueOnce(
      activeTeacherSnapshot({ role: "student" }),
    );

    await expect(
      __teachersActivatePilotHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.roleConflict" });
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    // role conflict is detected before any school/allowlist work.
    expect(mockResolvePilotSchoolId).not.toHaveBeenCalled();
  });

  it("refuses a caller in pendingVerification (retained manual path unaffected)", async () => {
    mockUserGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        authUid: "uid-brown",
        status: "pendingVerification",
        role: "teacher",
        schoolId: "some-school",
        displayName: "Chris Brown",
        email: PILOT_EMAIL,
        createdAt: {},
      }),
    });

    await expect(
      __teachersActivatePilotHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.invalidStatus" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockAssertAllowlisted).not.toHaveBeenCalled();
  });

  it("propagates a claims-write failure and does not emit an audit event", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());
    mockWriteCustomClaims.mockRejectedValueOnce(
      new PlatformError("claims.writeFailed", "boom"),
    );

    await expect(
      __teachersActivatePilotHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claims.writeFailed" });
    // The record update already happened; the audit event must not fire on a
    // failed claims write, leaving a replay to self-heal.
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("fails closed with no verified email (allowlist gate handles undefined)", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot({ email: undefined }));
    mockAssertAllowlisted.mockRejectedValueOnce(
      new PlatformError("teachers.pilotNotAllowlisted", "no"),
    );

    await expect(
      __teachersActivatePilotHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.pilotNotAllowlisted" });
    expect(mockAssertAllowlisted).toHaveBeenCalledWith(undefined);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
