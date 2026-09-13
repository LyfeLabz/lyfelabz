import type { CallableRequest } from "firebase-functions/v2/https";

// Phase 8G.12A - teachersApproveVerification is now transactional. The
// administrator revalidation, target read, pilot-allowlist check, district
// resolution, status transition, and audit all happen in ONE Firestore
// transaction; custom claims are issued only AFTER it commits. These tests
// drive a fake transaction.

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const defaultRequireAdmin = (
  request: { auth?: { uid?: unknown; token?: { role?: unknown } } },
  opts?: { unauthenticatedCode?: string; unauthorizedCode?: string },
) => {
  const { PlatformError: PE } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  const auth = request?.auth;
  if (!auth || typeof auth.uid !== "string" || auth.uid.trim().length === 0) {
    throw new PE(opts?.unauthenticatedCode ?? "admin.unauthenticated", "auth required");
  }
  if (!auth.token || auth.token.role !== "platformAdministrator") {
    throw new PE(opts?.unauthorizedCode ?? "admin.unauthorized", "admin required");
  }
  return { uid: auth.uid, schoolId: "school-admin-ctx", districtId: "district-admin-ctx" };
};
let requireAdminImpl: typeof defaultRequireAdmin = defaultRequireAdmin;
const mockRequireAdmin = jest.fn((request: unknown, opts: unknown) =>
  requireAdminImpl(request as never, opts as never),
);

let adminInTxActive = true;
const mockAssertAdminInTx = jest.fn((_tx: unknown, uid: string, opts?: { unauthorizedCode?: string }) => {
  if (!adminInTxActive) {
    const { PlatformError: PE } = jest.requireActual("../shared/errors/platform-error");
    throw new PE(opts?.unauthorizedCode ?? "admin.unauthorized", "canonical admin required");
  }
  return Promise.resolve({ uid, schoolId: "school-admin-ctx", districtId: "district-admin-ctx" });
});

let allowlisted = true;
const mockAllowlistInTx = jest.fn(() => {
  if (!allowlisted) {
    const { PlatformError: PE } = jest.requireActual("../shared/errors/platform-error");
    throw new PE("teachers.pilotNotAllowlisted", "not allowlisted");
  }
  return Promise.resolve();
});

const txUsers = new Map<string, Record<string, unknown> | undefined>();
const txSchools = new Map<string, Record<string, unknown> | undefined>();
const txUpdate = jest.fn();
const mockWriteAuditInTx = jest.fn();
const mockWriteCustomClaims = jest.fn();
const order: string[] = [];

function snapshot(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

const mockRunTransaction = jest.fn();

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    requireActivePlatformAdministrator: mockRequireAdmin,
    assertActivePlatformAdministratorInTransaction: (tx: unknown, uid: string, opts: unknown) =>
      mockAssertAdminInTx(tx, uid, opts as never),
    assertTeacherPilotAllowlistedInTransaction: () => mockAllowlistInTx(),
    runFirestoreTransaction: (fn: unknown) => mockRunTransaction(fn),
    userRecordDocRef: (uid: string) => ({ __uid: uid }),
    schoolDocRef: (schoolId: string) => ({ __schoolId: schoolId }),
    writeAuditEventInTransaction: (tx: unknown, input: unknown) => {
      order.push("audit");
      return mockWriteAuditInTx(tx, input);
    },
    writeCustomClaims: (input: unknown) => {
      order.push("claims");
      return mockWriteCustomClaims(input);
    },
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __teachersApproveVerificationHandler } from "./teachers-approve-verification";

function makeRequest(
  overrides: {
    uid?: string;
    data?: unknown;
    hasAuth?: boolean;
    token?: Record<string, unknown>;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "uid-admin";
  const data = overrides.data === undefined ? { targetUid: "uid-teacher" } : overrides.data;
  const token = overrides.token ?? { role: "platformAdministrator" };
  return {
    data,
    auth: hasAuth ? ({ uid, token } as never) : undefined,
    rawRequest: {} as never,
  };
}

function seedTarget(
  status: string,
  overrides: { role?: string; schoolId?: string | undefined; email?: string } = {},
) {
  const record: Record<string, unknown> = {
    authUid: "uid-teacher",
    status,
    role: overrides.role ?? "teacher",
    displayName: "Test Teacher",
    email: overrides.email ?? "pilot.teacher@example.org",
    createdAt: {},
  };
  if (!("schoolId" in overrides)) record.schoolId = "school-123";
  else if (overrides.schoolId !== undefined) record.schoolId = overrides.schoolId;
  txUsers.set("uid-teacher", record);
}

function seedSchool(schoolId = "school-123", districtId: string | undefined = "district-abc") {
  txSchools.set(schoolId, {
    name: "Test School",
    timezone: "America/New_York",
    createdAt: {},
    ...(districtId !== undefined ? { districtId } : {}),
  });
}

function installDefaultTransaction() {
  mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: (ref: { __uid?: string; __schoolId?: string }) => {
        if (ref.__schoolId !== undefined) return snapshot(txSchools.get(ref.__schoolId));
        return snapshot(txUsers.get(ref.__uid as string));
      },
      update: txUpdate,
    };
    return fn(tx);
  });
}

describe("teachersApproveVerification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAdminImpl = defaultRequireAdmin;
    adminInTxActive = true;
    allowlisted = true;
    txUsers.clear();
    txSchools.clear();
    order.length = 0;
    installDefaultTransaction();
    mockWriteAuditInTx.mockReturnValue({ eventId: "evt", record: {} });
    mockWriteCustomClaims.mockResolvedValue(undefined);
    seedSchool();
  });

  it("transitions a pendingVerification teacher to active, audits in-tx, then issues claims", async () => {
    seedTarget("pendingVerification");
    await __teachersApproveVerificationHandler(makeRequest());

    expect(mockAssertAdminInTx).toHaveBeenCalledTimes(1);
    expect(mockAllowlistInTx).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledWith({ __uid: "uid-teacher" }, { status: "active" });
    expect(mockWriteAuditInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "teachers.verificationApproved", targetId: "uid-teacher" }),
    );
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-teacher",
      status: "active",
      role: "teacher",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    // Canonical-first ordering: audit (in-tx) precedes claims (post-tx).
    expect(order).toEqual(["audit", "claims"]);
  });

  it("returns the canonical response for a fresh activation", async () => {
    seedTarget("pendingVerification");
    const result = await __teachersApproveVerificationHandler(makeRequest());
    expect(result).toEqual({
      targetUid: "uid-teacher",
      status: "active",
      role: "teacher",
      schoolId: "school-123",
      alreadyActive: false,
    });
  });

  it("is idempotent for an already-active teacher (no update, audit, or claims)", async () => {
    seedTarget("active");
    const result = await __teachersApproveVerificationHandler(makeRequest());
    expect(result).toEqual({
      targetUid: "uid-teacher",
      status: "active",
      role: "teacher",
      schoolId: "school-123",
      alreadyActive: true,
    });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("rejects a missing target with teachers.userNotFound", async () => {
    await expect(__teachersApproveVerificationHandler(makeRequest())).rejects.toMatchObject({
      code: "teachers.userNotFound",
    });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it.each([["provisioned"], ["suspended"], ["archived"]] as const)(
    "rejects an invalid source status %s",
    async (status) => {
      seedTarget(status);
      await expect(__teachersApproveVerificationHandler(makeRequest())).rejects.toMatchObject({
        code: "teachers.invalidStatus",
      });
      expect(txUpdate).not.toHaveBeenCalled();
      expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    },
  );

  it("refuses a non-allowlisted teacher (no update, audit, or claims)", async () => {
    seedTarget("pendingVerification");
    allowlisted = false;
    await expect(__teachersApproveVerificationHandler(makeRequest())).rejects.toMatchObject({
      code: "teachers.pilotNotAllowlisted",
    });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("refuses when the target's school has no district", async () => {
    seedTarget("pendingVerification");
    txSchools.set("school-123", { name: "Test School", createdAt: {} });
    await expect(__teachersApproveVerificationHandler(makeRequest())).rejects.toMatchObject({
      code: "district-unassigned",
    });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller (preliminary guard)", async () => {
    await expect(
      __teachersApproveVerificationHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "teachers.unauthenticated" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("rejects a non-administrator caller (preliminary guard)", async () => {
    await expect(
      __teachersApproveVerificationHandler(makeRequest({ token: { role: "teacher" } })),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  describe("transactional admin hardening / demotion race", () => {
    it("refuses a caller demoted at the transaction boundary; no update, audit, or claims", async () => {
      seedTarget("pendingVerification");
      adminInTxActive = false;
      await expect(__teachersApproveVerificationHandler(makeRequest())).rejects.toMatchObject({
        code: "teachers.unauthorized",
      });
      expect(txUpdate).not.toHaveBeenCalled();
      expect(mockWriteAuditInTx).not.toHaveBeenCalled();
      expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    });

    it("thrown errors are PlatformError instances", async () => {
      seedTarget("pendingVerification");
      adminInTxActive = false;
      await expect(__teachersApproveVerificationHandler(makeRequest())).rejects.toBeInstanceOf(
        PlatformError,
      );
    });
  });
});
