import type { CallableRequest } from "firebase-functions/v2/https";

// Phase 8G.1 / 8G.3 - teachersSuspend callable test matrix.
//
// Every authoritative read (admin record, target record, school document)
// happens INSIDE the durable transaction, so the fake transaction is the one
// place that resolves them. `txUsers` and `txSchools` model the canonical
// state observed transactionally.

const mockUserRecordDocRef = jest.fn();
const mockSchoolDocRef = jest.fn();
const mockRunTransaction = jest.fn();
const mockWriteAuditInTx = jest.fn();
const mockClearCustomClaims = jest.fn();
const mockRevokeRefreshTokens = jest.fn();
const mockLogInfo = jest.fn();

// Canonical user records (admin + target) observed inside the transaction.
const txUsers = new Map<string, Record<string, unknown> | undefined>();
// Canonical school documents observed inside the transaction.
const txSchools = new Map<string, Record<string, unknown> | undefined>();

const txUpdate = jest.fn();
const txSet = jest.fn();

function snapshot(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

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
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    userRecordDocRef: (uid: string) => mockUserRecordDocRef(uid),
    schoolDocRef: (schoolId: string) => mockSchoolDocRef(schoolId),
    runFirestoreTransaction: (fn: unknown) => mockRunTransaction(fn),
    writeAuditEventInTransaction: (tx: unknown, input: unknown) =>
      mockWriteAuditInTx(tx, input),
    clearCustomClaims: (uid: string) => mockClearCustomClaims(uid),
    revokeUserRefreshTokens: (uid: string) => mockRevokeRefreshTokens(uid),
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __teachersSuspendHandler } from "./teachers-suspend";

const ADMIN_UID = "uid-admin";
const TEACHER_UID = "uid-teacher";
const SCHOOL_ID = "school-123";
const DISTRICT_ID = "district-abc";

function makeRequest(
  overrides: {
    uid?: string;
    data?: unknown;
    hasAuth?: boolean;
    token?: Record<string, unknown> | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? ADMIN_UID;
  const data =
    overrides.data === undefined ? { targetUid: TEACHER_UID } : overrides.data;
  const token =
    overrides.token === undefined
      ? { role: "platformAdministrator" }
      : overrides.token;
  return {
    data,
    auth: hasAuth ? ({ uid, token: token ?? undefined } as never) : undefined,
    rawRequest: {} as never,
  };
}

function seedActiveAdmin(uid = ADMIN_UID) {
  txUsers.set(uid, {
    authUid: uid,
    status: "active",
    role: "platformAdministrator",
    createdAt: {},
  });
}

function seedTarget(
  status: string,
  overrides: {
    role?: string;
    schoolId?: string | undefined;
    authUid?: string;
  } = {},
) {
  const record: Record<string, unknown> = {
    authUid: "authUid" in overrides ? overrides.authUid : TEACHER_UID,
    status,
    role: overrides.role ?? "teacher",
    displayName: "Test Teacher",
    email: "teacher@example.org",
    createdAt: {},
  };
  if (!("schoolId" in overrides)) record.schoolId = SCHOOL_ID;
  else if (overrides.schoolId !== undefined) record.schoolId = overrides.schoolId;
  txUsers.set(TEACHER_UID, record);
}

function seedSchool(schoolId: string, districtId?: string) {
  txSchools.set(schoolId, {
    name: "Test School",
    timezone: "America/New_York",
    createdAt: {},
    ...(districtId !== undefined ? { districtId } : {}),
  });
}

function installDefaultTransaction() {
  mockRunTransaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: (ref: { __uid?: string; __schoolId?: string }) => {
          if (ref.__schoolId !== undefined) {
            return snapshot(txSchools.get(ref.__schoolId));
          }
          return snapshot(txUsers.get(ref.__uid as string));
        },
        update: txUpdate,
        set: txSet,
      };
      return fn(tx);
    },
  );
}

describe("teachersSuspend", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    txUsers.clear();
    txSchools.clear();

    mockUserRecordDocRef.mockImplementation((uid: string) => ({ __uid: uid }));
    mockSchoolDocRef.mockImplementation((schoolId: string) => ({
      __schoolId: schoolId,
    }));
    installDefaultTransaction();

    mockWriteAuditInTx.mockReturnValue({ eventId: "evt-1", record: {} });
    mockClearCustomClaims.mockResolvedValue(undefined);
    mockRevokeRefreshTokens.mockResolvedValue(undefined);

    seedActiveAdmin();
    seedSchool(SCHOOL_ID, DISTRICT_ID);
  });

  // ---------------- CALLABLE / LIFECYCLE ----------------

  test("suspends an active teacher: status transition, one audit, auth cleanup", async () => {
    seedTarget("active");
    const result = await __teachersSuspendHandler(makeRequest());

    expect(result).toEqual({
      targetUid: TEACHER_UID,
      status: "suspended",
      role: "teacher",
      alreadySuspended: false,
    });

    // Only status changes in the canonical record.
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(txUpdate.mock.calls[0][1]).toEqual({ status: "suspended" });

    // Exactly one audit event with authoritative, transactionally observed
    // school/district context and PII-free payload.
    expect(mockWriteAuditInTx).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditInTx.mock.calls[0][1]).toEqual({
      actorUserId: ADMIN_UID,
      actorRole: "platformAdministrator",
      action: "users.suspended",
      targetType: "user",
      targetId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      payload: { previousStatus: "active", role: "teacher" },
    });

    // Claims cleared then refresh tokens revoked, both for the target.
    expect(mockClearCustomClaims).toHaveBeenCalledWith(TEACHER_UID);
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith(TEACHER_UID);
    const clearOrder = mockClearCustomClaims.mock.invocationCallOrder[0];
    const revokeOrder = mockRevokeRefreshTokens.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(revokeOrder);
  });

  test("does not include any field other than status in the transition write", async () => {
    seedTarget("active");
    await __teachersSuspendHandler(makeRequest());
    expect(Object.keys(txUpdate.mock.calls[0][1])).toEqual(["status"]);
  });

  test("audit payload carries no email, token, or identity material", async () => {
    seedTarget("active");
    await __teachersSuspendHandler(makeRequest());
    const input = mockWriteAuditInTx.mock.calls[0][1] as Record<string, unknown>;
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("teacher@example.org");
    expect(serialized).not.toContain("token");
    expect(input.payload).toEqual({ previousStatus: "active", role: "teacher" });
  });

  // ---------------- IDEMPOTENCY ----------------

  test("already-suspended replay: no transition, no audit, repairs auth state", async () => {
    seedTarget("suspended");
    const result = await __teachersSuspendHandler(makeRequest());

    expect(result.alreadySuspended).toBe(true);
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
    // Auth repair is re-run.
    expect(mockClearCustomClaims).toHaveBeenCalledWith(TEACHER_UID);
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith(TEACHER_UID);
  });

  // ---------------- CONCURRENCY ----------------

  test("concurrent loser observes suspended inside tx: one transition, no second audit", async () => {
    // A competing suspension already committed; the retried transaction reads
    // the target as suspended.
    seedTarget("suspended");
    const result = await __teachersSuspendHandler(makeRequest());
    expect(result.alreadySuspended).toBe(true);
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    expect(mockClearCustomClaims).toHaveBeenCalledWith(TEACHER_UID);
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith(TEACHER_UID);
  });

  // ---------------- AUTHORIZATION (request boundary) ----------------

  test("unauthenticated caller is denied before the transaction", async () => {
    await expect(
      __teachersSuspendHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "teachers.unauthenticated" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  test("teacher caller is denied", async () => {
    await expect(
      __teachersSuspendHandler(
        makeRequest({ token: { role: "teacher", schoolId: SCHOOL_ID } }),
      ),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
  });

  test("student caller is denied", async () => {
    await expect(
      __teachersSuspendHandler(makeRequest({ token: { role: "student" } })),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
  });

  test("self-target is denied before the transaction", async () => {
    await expect(
      __teachersSuspendHandler(makeRequest({ data: { targetUid: ADMIN_UID } })),
    ).rejects.toMatchObject({ code: "teachers.selfTargetForbidden" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  test("malformed targetUid is denied before the transaction", async () => {
    await expect(
      __teachersSuspendHandler(makeRequest({ data: { targetUid: "  " } })),
    ).rejects.toMatchObject({ code: "teachers.invalidTargetUid" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  // ---------------- ADMIN TOCTOU (authoritative, in-transaction) ----------------

  test("admin active at request start but SUSPENDED at transactional validation is denied", async () => {
    seedTarget("active");
    txUsers.set(ADMIN_UID, {
      authUid: ADMIN_UID,
      status: "suspended",
      role: "platformAdministrator",
      createdAt: {},
    });
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
    // No target mutation, no audit, no auth cleanup.
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    expect(mockClearCustomClaims).not.toHaveBeenCalled();
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });

  test("admin active at request start but ROLE-CHANGED at transactional validation is denied", async () => {
    seedTarget("active");
    txUsers.set(ADMIN_UID, {
      authUid: ADMIN_UID,
      status: "active",
      role: "teacher",
      createdAt: {},
    });
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    expect(mockClearCustomClaims).not.toHaveBeenCalled();
  });

  test("admin record missing at transactional validation is denied", async () => {
    seedTarget("active");
    txUsers.delete(ADMIN_UID);
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
  });

  test("admin record with mismatched authUid is denied (fail closed)", async () => {
    seedTarget("active");
    txUsers.set(ADMIN_UID, {
      authUid: "someone-else",
      status: "active",
      role: "platformAdministrator",
      createdAt: {},
    });
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  // ---------------- TARGET INVARIANTS (authoritative, in-transaction) ----------------

  test("missing target is denied", async () => {
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.userNotFound" });
  });

  test("malformed target: plausible role/status/school but mismatched authUid fails closed", async () => {
    seedTarget("active", { authUid: "not-the-target" });
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.invalidTargetRecord" });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    expect(mockClearCustomClaims).not.toHaveBeenCalled();
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });

  test("malformed target: missing authUid fails closed", async () => {
    // authUid explicitly undefined but role/status/school plausible.
    txUsers.set(TEACHER_UID, {
      status: "active",
      role: "teacher",
      schoolId: SCHOOL_ID,
      createdAt: {},
    });
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.invalidTargetRecord" });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  test("non-teacher target (student) is denied", async () => {
    seedTarget("active", { role: "student" });
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.invalidTargetRole" });
  });

  test("active target without a schoolId is denied", async () => {
    seedTarget("active", { schoolId: undefined });
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.invalidTargetSchoolId" });
  });

  test("provisioned target is an invalid transition", async () => {
    seedTarget("provisioned");
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.invalidStatus" });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  test("pendingVerification target is an invalid transition", async () => {
    seedTarget("pendingVerification");
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.invalidStatus" });
  });

  test("archived target is an invalid transition", async () => {
    seedTarget("archived");
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.invalidStatus" });
  });

  test("school missing at transactional resolution refuses before writes", async () => {
    seedTarget("active");
    txSchools.delete(SCHOOL_ID);
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "school-district-mismatch" });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
  });

  test("school without a district refuses before writes", async () => {
    seedTarget("active");
    seedSchool(SCHOOL_ID, undefined);
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  // ---------------- FAILURE MODES ----------------

  test("audit failure aborts the transition and skips auth cleanup", async () => {
    seedTarget("active");
    mockWriteAuditInTx.mockImplementation(() => {
      throw new PlatformError("audit.invalidAction", "boom");
    });
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "audit.invalidAction" });
    expect(mockClearCustomClaims).not.toHaveBeenCalled();
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });

  test("transaction failure propagates and skips auth cleanup", async () => {
    seedTarget("active");
    mockRunTransaction.mockRejectedValue(new Error("contention"));
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toThrow();
    expect(mockClearCustomClaims).not.toHaveBeenCalled();
  });

  test("claim-clear failure after durable suspension propagates; revoke not attempted", async () => {
    seedTarget("active");
    mockClearCustomClaims.mockRejectedValue(
      new PlatformError("claims.clearFailed", "clear failed"),
    );
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claims.clearFailed" });
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditInTx).toHaveBeenCalledTimes(1);
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });

  test("refresh-token revocation failure after durable suspension propagates", async () => {
    seedTarget("active");
    mockRevokeRefreshTokens.mockRejectedValue(
      new PlatformError("auth.revokeRefreshTokensFailed", "revoke failed"),
    );
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "auth.revokeRefreshTokensFailed" });
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(mockClearCustomClaims).toHaveBeenCalledTimes(1);
  });

  // ---------------- REFRESH-REVOCATION REPAIR REPLAY (Phase 8G.3 Part 8) ----------------

  test("replay after refresh-token revocation failure repairs auth state without a second audit", async () => {
    // 1-4. First call: transition + audit succeed, claims clear succeeds,
    // refresh-token revocation fails; the callable reports the failure.
    seedTarget("active");
    mockRevokeRefreshTokens.mockRejectedValueOnce(
      new PlatformError("auth.revokeRefreshTokensFailed", "revoke failed"),
    );
    await expect(
      __teachersSuspendHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "auth.revokeRefreshTokensFailed" });
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditInTx).toHaveBeenCalledTimes(1);
    expect(mockClearCustomClaims).toHaveBeenCalledTimes(1);

    // 5. Canonical status remains suspended after the durable transition.
    seedTarget("suspended");

    // 7. Replay against the suspended target repairs Auth state and succeeds
    // when revocation now succeeds, with NO second audit or transition.
    jest.clearAllMocks();
    mockUserRecordDocRef.mockImplementation((uid: string) => ({ __uid: uid }));
    mockSchoolDocRef.mockImplementation((schoolId: string) => ({
      __schoolId: schoolId,
    }));
    installDefaultTransaction();
    mockWriteAuditInTx.mockReturnValue({ eventId: "evt-2", record: {} });
    mockClearCustomClaims.mockResolvedValue(undefined);
    mockRevokeRefreshTokens.mockResolvedValue(undefined);

    const result = await __teachersSuspendHandler(makeRequest());
    expect(result.alreadySuspended).toBe(true);
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockClearCustomClaims).toHaveBeenCalledWith(TEACHER_UID);
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith(TEACHER_UID);
  });
});
