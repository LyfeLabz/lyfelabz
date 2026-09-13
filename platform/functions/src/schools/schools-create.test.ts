import type { CallableRequest } from "firebase-functions/v2/https";

// Phase 8G.12A - schoolsCreate is now transactional: administrator authority
// is re-validated INSIDE the same Firestore transaction that reads the
// existing school, writes the creation, and writes the audit. These tests
// drive a fake transaction so the in-transaction admin check, the demotion
// race, idempotency, and conflict handling are all exercised.

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

// Preliminary (cheap) admin guard.
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

// In-transaction authoritative admin check. Default: passes (the caller is an
// active canonical admin). Overridden to reject to model a demotion race.
let adminInTxActive = true;
const mockAssertAdminInTx = jest.fn((_tx: unknown, uid: string, opts?: { unauthorizedCode?: string }) => {
  if (!adminInTxActive) {
    const { PlatformError: PE } = jest.requireActual(
      "../shared/errors/platform-error",
    );
    throw new PE(opts?.unauthorizedCode ?? "admin.unauthorized", "canonical admin required");
  }
  return Promise.resolve({ uid, schoolId: "school-admin-ctx", districtId: "district-admin-ctx" });
});

// In-memory school store observed inside the transaction.
const txSchools = new Map<string, Record<string, unknown> | undefined>();
const txSet = jest.fn();
const mockWriteAuditInTx = jest.fn();

function snapshot(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

const mockRunTransaction = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL },
}));

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
    requireActivePlatformAdministrator: mockRequireAdmin,
    assertActivePlatformAdministratorInTransaction: (
      tx: unknown,
      uid: string,
      opts: unknown,
    ) => mockAssertAdminInTx(tx, uid, opts as never),
    runFirestoreTransaction: (fn: unknown) => mockRunTransaction(fn),
    schoolDocRef: (schoolId: string) => ({ __schoolId: schoolId }),
    schoolCreationDocRef: (schoolId: string) => ({ __schoolCreation: schoolId }),
    writeAuditEventInTransaction: (tx: unknown, input: unknown) =>
      mockWriteAuditInTx(tx, input),
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __schoolsCreateHandler } from "./schools-create";

type CreateData = {
  schoolId?: unknown;
  name?: unknown;
  shortName?: unknown;
  timezone?: unknown;
  districtId?: unknown;
  district?: unknown;
  gradeLevels?: unknown;
  brandingRef?: unknown;
};

const VALID_DATA: CreateData = {
  schoolId: "school-abc",
  name: "Alpha Academy",
  shortName: "alpha",
  timezone: "America/New_York",
};

function makeRequest(
  overrides: {
    uid?: string;
    data?: unknown;
    hasAuth?: boolean;
    token?: Record<string, unknown> | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "uid-admin";
  const data = overrides.data === undefined ? { ...VALID_DATA } : overrides.data;
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

function existingSchool(
  overrides: {
    name?: string;
    shortName?: string;
    timezone?: string;
    districtId?: string;
    gradeLevels?: readonly string[];
    brandingRef?: string;
  } = {},
): Record<string, unknown> {
  return {
    name: overrides.name ?? "Alpha Academy",
    shortName: overrides.shortName ?? "alpha",
    timezone: overrides.timezone ?? "America/New_York",
    createdAt: {},
    ...(overrides.districtId !== undefined ? { districtId: overrides.districtId } : {}),
    ...(overrides.gradeLevels !== undefined ? { gradeLevels: overrides.gradeLevels } : {}),
    ...(overrides.brandingRef !== undefined ? { brandingRef: overrides.brandingRef } : {}),
  };
}

function installDefaultTransaction() {
  mockRunTransaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: (ref: { __schoolId?: string }) => snapshot(txSchools.get(ref.__schoolId as string)),
        set: txSet,
        update: jest.fn(),
      };
      return fn(tx);
    },
  );
}

describe("schoolsCreate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAdminImpl = defaultRequireAdmin;
    adminInTxActive = true;
    txSchools.clear();
    installDefaultTransaction();
    mockWriteAuditInTx.mockReturnValue({ eventId: "evt", record: {} });
  });

  it("creates a canonical schools/{schoolId} document and returns the canonical response", async () => {
    const result = await __schoolsCreateHandler(makeRequest());

    expect(mockAssertAdminInTx).toHaveBeenCalledTimes(1);
    expect(txSet).toHaveBeenCalledTimes(1);
    expect(txSet).toHaveBeenCalledWith(
      { __schoolCreation: "school-abc" },
      {
        name: "Alpha Academy",
        shortName: "alpha",
        timezone: "America/New_York",
        createdAt: SERVER_TIMESTAMP_SENTINEL,
      },
    );
    expect(mockWriteAuditInTx).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "schools.created",
        actorRole: "platformAdministrator",
        targetType: "school",
        targetId: "school-abc",
        schoolId: "school-abc",
      }),
    );
    expect(result).toEqual({ schoolId: "school-abc", alreadyCreated: false });
  });

  it("maps the legacy district alias to districtId and preserves optional fields", async () => {
    await __schoolsCreateHandler(
      makeRequest({
        data: { ...VALID_DATA, district: "District 5", gradeLevels: ["6", "7", "8"], brandingRef: "branding/alpha" },
      }),
    );
    expect(txSet).toHaveBeenCalledWith(
      { __schoolCreation: "school-abc" },
      {
        name: "Alpha Academy",
        shortName: "alpha",
        timezone: "America/New_York",
        createdAt: SERVER_TIMESTAMP_SENTINEL,
        districtId: "District 5",
        gradeLevels: ["6", "7", "8"],
        brandingRef: "branding/alpha",
      },
    );
  });

  it("is idempotent when an existing school matches (no second write or audit)", async () => {
    txSchools.set("school-abc", existingSchool());
    const result = await __schoolsCreateHandler(makeRequest());
    expect(result).toEqual({ schoolId: "school-abc", alreadyCreated: true });
    expect(txSet).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
  });

  it("rejects an existing school with different canonical fields (schools.conflict)", async () => {
    txSchools.set("school-abc", existingSchool({ name: "Different" }));
    await expect(__schoolsCreateHandler(makeRequest())).rejects.toMatchObject({
      code: "schools.conflict",
    });
    expect(txSet).not.toHaveBeenCalled();
    expect(mockWriteAuditInTx).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with schools.unauthenticated (preliminary guard)", async () => {
    await expect(
      __schoolsCreateHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "schools.unauthenticated" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("rejects a non-administrator caller with schools.unauthorized (preliminary guard)", async () => {
    await expect(
      __schoolsCreateHandler(makeRequest({ token: { role: "teacher" } })),
    ).rejects.toMatchObject({ code: "schools.unauthorized" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("rejects invalid input before opening a transaction", async () => {
    await expect(
      __schoolsCreateHandler(makeRequest({ data: { ...VALID_DATA, schoolId: "" } })),
    ).rejects.toMatchObject({ code: "schools.invalidSchoolId" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  describe("transactional admin hardening / demotion race", () => {
    it("refuses when the caller is canonically demoted at the transaction boundary; no write, no audit", async () => {
      // Preliminary guard passes (token still carries the admin claim)...
      // ...but the in-transaction canonical re-check observes the demotion.
      adminInTxActive = false;
      await expect(__schoolsCreateHandler(makeRequest())).rejects.toMatchObject({
        code: "schools.unauthorized",
      });
      expect(mockAssertAdminInTx).toHaveBeenCalledTimes(1);
      expect(txSet).not.toHaveBeenCalled();
      expect(mockWriteAuditInTx).not.toHaveBeenCalled();
    });

    it("invokes the in-transaction admin check with the schools error namespace", async () => {
      await __schoolsCreateHandler(makeRequest());
      expect(mockAssertAdminInTx).toHaveBeenCalledWith(expect.anything(), "uid-admin", {
        unauthorizedCode: "schools.unauthorized",
      });
    });

    it("thrown errors are PlatformError instances", async () => {
      adminInTxActive = false;
      await expect(__schoolsCreateHandler(makeRequest())).rejects.toBeInstanceOf(
        PlatformError,
      );
    });
  });
});
