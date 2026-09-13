import type { CallableRequest } from "firebase-functions/v2/https";

// Phase 8G.12A - teachersDenyVerification is now transactional. Administrator
// revalidation, target read, the pendingVerification -> provisioned update,
// and the audit all commit in ONE Firestore transaction. These tests drive a
// fake transaction.

const mockFieldValueDelete = jest.fn(() => "__DELETE__");
const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const defaultRequireAdmin = (
  request: { auth?: { uid?: unknown; token?: { role?: unknown } } },
  opts?: { unauthenticatedCode?: string; unauthorizedCode?: string },
) => {
  const { PlatformError: PE } = jest.requireActual("../shared/errors/platform-error");
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

const txUsers = new Map<string, Record<string, unknown> | undefined>();
const txUpdate = jest.fn();
const mockWriteAuditInTx = jest.fn();

function snapshot(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

const mockRunTransaction = jest.fn();

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { delete: (...args: unknown[]) => mockFieldValueDelete(...(args as [])) },
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
    runFirestoreTransaction: (fn: unknown) => mockRunTransaction(fn),
    userRecordDocRef: (uid: string) => ({ __uid: uid }),
    writeAuditEventInTransaction: (tx: unknown, input: unknown) => mockWriteAuditInTx(tx, input),
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __teachersDenyVerificationHandler } from "./teachers-deny-verification";

function makeRequest(
  overrides: { uid?: string; data?: unknown; hasAuth?: boolean; token?: Record<string, unknown> } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "uid-admin";
  const data = overrides.data === undefined ? { targetUid: "uid-teacher" } : overrides.data;
  const token = overrides.token ?? { role: "platformAdministrator" };
  return { data, auth: hasAuth ? ({ uid, token } as never) : undefined, rawRequest: {} as never };
}

function seedTarget(status: string, overrides: { role?: string; schoolId?: string } = {}) {
  txUsers.set("uid-teacher", {
    authUid: "uid-teacher",
    status,
    role: overrides.role ?? "teacher",
    schoolId: overrides.schoolId ?? "school-123",
    displayName: "Test Teacher",
    createdAt: {},
  });
}

function installDefaultTransaction() {
  mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: (ref: { __uid?: string }) => snapshot(txUsers.get(ref.__uid as string)),
      update: txUpdate,
    };
    return fn(tx);
  });
}

describe("teachersDenyVerification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAdminImpl = defaultRequireAdmin;
    adminInTxActive = true;
    txUsers.clear();
    installDefaultTransaction();
    mockWriteAuditInTx.mockReturnValue({ eventId: "evt", record: {} });
  });

  it("transitions a pendingVerification teacher to provisioned and clears activation fields", async () => {
    seedTarget("pendingVerification");
    const result = await __teachersDenyVerificationHandler(makeRequest());

    expect(mockAssertAdminInTx).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledWith(
      { __uid: "uid-teacher" },
      { status: "provisioned", role: "__DELETE__", schoolId: "__DELETE__", displayName: "__DELETE__" },
    );
    expect(mockWriteAuditInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "teachers.verificationDenied", targetId: "uid-teacher", schoolId: "school-123" }),
    );
    expect(result).toEqual({
      targetUid: "uid-teacher",
      status: "provisioned",
      schoolId: "school-123",
      alreadyProvisioned: false,
    });
  });

  it("is idempotent for an already-provisioned target (no update or audit)", async () => {
    seedTarget("provisioned");
    const result = await __teachersDenyVerificationHandler(makeRequest());
    expect(result).toEqual({
      targetUid: "uid-teacher",
      status: "provisioned",
      schoolId: null,
      alreadyProvisioned: true,
    });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
  });

  it("rejects a missing target with teachers.userNotFound", async () => {
    await expect(__teachersDenyVerificationHandler(makeRequest())).rejects.toMatchObject({
      code: "teachers.userNotFound",
    });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it.each([["active"], ["suspended"], ["archived"]] as const)(
    "rejects an invalid source status %s",
    async (status) => {
      seedTarget(status);
      await expect(__teachersDenyVerificationHandler(makeRequest())).rejects.toMatchObject({
        code: "teachers.invalidStatus",
      });
      expect(txUpdate).not.toHaveBeenCalled();
      expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    },
  );

  it("rejects an unauthenticated caller (preliminary guard)", async () => {
    await expect(
      __teachersDenyVerificationHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "teachers.unauthenticated" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("rejects a non-administrator caller (preliminary guard)", async () => {
    await expect(
      __teachersDenyVerificationHandler(makeRequest({ token: { role: "teacher" } })),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  describe("transactional admin hardening / demotion race", () => {
    it("refuses a caller demoted at the transaction boundary; no update or audit", async () => {
      seedTarget("pendingVerification");
      adminInTxActive = false;
      await expect(__teachersDenyVerificationHandler(makeRequest())).rejects.toMatchObject({
        code: "teachers.unauthorized",
      });
      expect(txUpdate).not.toHaveBeenCalled();
      expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    });

    it("thrown errors are PlatformError instances", async () => {
      seedTarget("pendingVerification");
      adminInTxActive = false;
      await expect(__teachersDenyVerificationHandler(makeRequest())).rejects.toBeInstanceOf(
        PlatformError,
      );
    });
  });
});
