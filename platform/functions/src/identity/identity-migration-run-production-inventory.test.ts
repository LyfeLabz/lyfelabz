/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Sprint 23E - identityMigrationRunProductionInventory callable tests.
//
// Covers:
//   - authorization (unauthenticated, non-admin, admin)
//   - read-only behavior (never invokes runBackfill, never passes
//     the emulator acknowledgement)
//   - request validation (pageToken, pageSize, collisionSampleLimit)
//   - response projection (counts, samples, nextPageToken)
//   - redaction (no email, UID, provider account id, token in
//     response or in log payloads produced by the handler itself)
//   - determinism (repeat calls with identical input return
//     identical output)

import type { CallableRequest } from "firebase-functions/v2/https";

const mockRunInventory = jest.fn();
const mockRunBackfill = jest.fn();
const mockLogInfo = jest.fn();

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    platformCallable: (handler: unknown) => handler,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
  };
});

jest.mock("../scripts/migration/external-identity-migration", () => ({
  runInventory: (opts: unknown) => mockRunInventory(opts),
  runBackfill: (opts: unknown) => mockRunBackfill(opts),
}));

import { identityMigrationRunProductionInventoryHandler } from "./identity-migration-run-production-inventory";

function makeRequest(
  auth: { uid: string; role?: string } | null,
  data: unknown = {},
): CallableRequest<unknown> {
  const authObj = auth
    ? ({
        uid: auth.uid,
        token: auth.role === undefined ? {} : { role: auth.role },
      } as any)
    : (undefined as any);
  return {
    data,
    auth: authObj,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as unknown as CallableRequest<unknown>;
}

function inventorySummaryFixture(overrides: Record<string, unknown> = {}): any {
  return {
    usersScanned: 3,
    counts: {
      eligibleSingleGoogleProvider: 2,
      multipleProvidersOneGoogle: 0,
      noGoogleProvider: 1,
      orphanUserDocument: 0,
      orphanAuthUser: 0,
      providerCollision: 0,
      disabledAuthUser: 0,
      pendingOrProvisionedUser: 0,
    },
    providerCollisionSamples: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockRunInventory.mockReset();
  mockRunBackfill.mockReset();
  mockLogInfo.mockReset();
  mockRunInventory.mockResolvedValue(inventorySummaryFixture());
});

describe("identityMigrationRunProductionInventory - authorization", () => {
  it("refuses an unauthenticated caller", async () => {
    await expect(
      identityMigrationRunProductionInventoryHandler(makeRequest(null)),
    ).rejects.toMatchObject({
      code: "identity.productionInventory.unauthenticated",
    });
    expect(mockRunInventory).not.toHaveBeenCalled();
  });

  it("refuses a caller with no role claim", async () => {
    await expect(
      identityMigrationRunProductionInventoryHandler(
        makeRequest({ uid: "u-1" }),
      ),
    ).rejects.toMatchObject({
      code: "identity.productionInventory.forbidden",
    });
    expect(mockRunInventory).not.toHaveBeenCalled();
  });

  it.each(["teacher", "student", "not-a-role", ""])(
    "refuses a caller whose role is %p (not platformAdministrator)",
    async (role) => {
      await expect(
        identityMigrationRunProductionInventoryHandler(
          makeRequest({ uid: "u-1", role }),
        ),
      ).rejects.toMatchObject({
        code: "identity.productionInventory.forbidden",
      });
      expect(mockRunInventory).not.toHaveBeenCalled();
    },
  );

  it("accepts a caller whose role is platformAdministrator", async () => {
    await identityMigrationRunProductionInventoryHandler(
      makeRequest({ uid: "u-admin", role: "platformAdministrator" }),
    );
    expect(mockRunInventory).toHaveBeenCalledTimes(1);
  });
});

describe("identityMigrationRunProductionInventory - read-only", () => {
  it("NEVER invokes runBackfill", async () => {
    await identityMigrationRunProductionInventoryHandler(
      makeRequest({ uid: "u-admin", role: "platformAdministrator" }),
    );
    expect(mockRunBackfill).not.toHaveBeenCalled();
  });

  it("NEVER forwards the emulator-only write acknowledgement to any downstream", async () => {
    await identityMigrationRunProductionInventoryHandler(
      makeRequest(
        { uid: "u-admin", role: "platformAdministrator" },
        {
          executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
        },
      ),
    );
    const callArg = mockRunInventory.mock.calls[0][0];
    expect(callArg).not.toHaveProperty("executeWritesAcknowledgement");
    expect(mockRunBackfill).not.toHaveBeenCalled();
  });

  it("passes the server-derived actorUserId (not any client-supplied value)", async () => {
    await identityMigrationRunProductionInventoryHandler(
      makeRequest(
        { uid: "u-admin-real", role: "platformAdministrator" },
        { actorUserId: "u-attacker" },
      ),
    );
    expect(mockRunInventory.mock.calls[0][0].actorUserId).toBe("u-admin-real");
  });
});

describe("identityMigrationRunProductionInventory - request validation", () => {
  it("accepts an omitted payload", async () => {
    await identityMigrationRunProductionInventoryHandler(
      makeRequest({ uid: "u-admin", role: "platformAdministrator" }, undefined),
    );
    expect(mockRunInventory.mock.calls[0][0]).toEqual({
      actorUserId: "u-admin",
    });
  });

  it("rejects a non-object payload", async () => {
    await expect(
      identityMigrationRunProductionInventoryHandler(
        makeRequest({ uid: "u-admin", role: "platformAdministrator" }, "nope"),
      ),
    ).rejects.toMatchObject({
      code: "identity.productionInventory.invalidRequest",
    });
  });

  it.each([
    ["pageToken empty", { pageToken: "" }],
    ["pageToken non-string", { pageToken: 5 }],
    ["pageSize non-integer", { pageSize: 1.5 }],
    ["pageSize < 1", { pageSize: 0 }],
    ["pageSize > 1000", { pageSize: 1001 }],
    ["collisionSampleLimit negative", { collisionSampleLimit: -1 }],
    ["collisionSampleLimit non-integer", { collisionSampleLimit: 2.5 }],
    ["collisionSampleLimit > 500", { collisionSampleLimit: 501 }],
  ])("rejects invalid request: %s", async (_label, data) => {
    await expect(
      identityMigrationRunProductionInventoryHandler(
        makeRequest({ uid: "u-admin", role: "platformAdministrator" }, data),
      ),
    ).rejects.toMatchObject({
      code: "identity.productionInventory.invalidRequest",
    });
  });

  it("forwards valid pageToken, pageSize, and collisionSampleLimit", async () => {
    await identityMigrationRunProductionInventoryHandler(
      makeRequest(
        { uid: "u-admin", role: "platformAdministrator" },
        { pageToken: "PAGE_2", pageSize: 100, collisionSampleLimit: 25 },
      ),
    );
    expect(mockRunInventory.mock.calls[0][0]).toEqual({
      pageToken: "PAGE_2",
      pageSize: 100,
      collisionSampleLimit: 25,
      actorUserId: "u-admin",
    });
  });
});

describe("identityMigrationRunProductionInventory - response projection", () => {
  it("projects usersScanned, counts, and providerCollisionSamples", async () => {
    mockRunInventory.mockResolvedValueOnce(
      inventorySummaryFixture({
        usersScanned: 5,
        counts: {
          eligibleSingleGoogleProvider: 1,
          multipleProvidersOneGoogle: 1,
          noGoogleProvider: 1,
          orphanUserDocument: 0,
          orphanAuthUser: 0,
          providerCollision: 2,
          disabledAuthUser: 0,
          pendingOrProvisionedUser: 0,
        },
        providerCollisionSamples: ["hash-a", "hash-b"],
      }),
    );
    const r = await identityMigrationRunProductionInventoryHandler(
      makeRequest({ uid: "u-admin", role: "platformAdministrator" }),
    );
    expect(r.usersScanned).toBe(5);
    expect(r.counts.providerCollision).toBe(2);
    expect(r.providerCollisionSamples).toEqual(["hash-a", "hash-b"]);
    expect(r).not.toHaveProperty("nextPageToken");
  });

  it("includes nextPageToken when the underlying service returned one", async () => {
    mockRunInventory.mockResolvedValueOnce(
      inventorySummaryFixture({ nextPageToken: "PAGE_2" }),
    );
    const r = await identityMigrationRunProductionInventoryHandler(
      makeRequest({ uid: "u-admin", role: "platformAdministrator" }),
    );
    expect(r.nextPageToken).toBe("PAGE_2");
  });

  it("never adds an email, displayName, providerAccountId, or token field", async () => {
    mockRunInventory.mockResolvedValueOnce(
      inventorySummaryFixture({
        providerCollisionSamples: [
          "1a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef1234567890",
        ],
      }),
    );
    const r = await identityMigrationRunProductionInventoryHandler(
      makeRequest({ uid: "u-admin", role: "platformAdministrator" }),
    );
    const serialized = JSON.stringify(r);
    expect(serialized).not.toMatch(/email/i);
    expect(serialized).not.toMatch(/displayName/i);
    expect(serialized).not.toMatch(/providerAccountId/i);
    expect(serialized).not.toMatch(/accessToken|refreshToken|idToken/i);
  });
});

describe("identityMigrationRunProductionInventory - determinism", () => {
  it("returns identical output across repeated calls with identical input and unchanged state", async () => {
    const summary = inventorySummaryFixture({
      usersScanned: 7,
      counts: {
        eligibleSingleGoogleProvider: 3,
        multipleProvidersOneGoogle: 1,
        noGoogleProvider: 1,
        orphanUserDocument: 0,
        orphanAuthUser: 1,
        providerCollision: 1,
        disabledAuthUser: 0,
        pendingOrProvisionedUser: 1,
      },
      providerCollisionSamples: ["hash-x"],
      nextPageToken: "PAGE_2",
    });
    mockRunInventory.mockResolvedValue(summary);
    const req = makeRequest(
      { uid: "u-admin", role: "platformAdministrator" },
      { pageSize: 250 },
    );
    const r1 = await identityMigrationRunProductionInventoryHandler(req);
    const r2 = await identityMigrationRunProductionInventoryHandler(req);
    expect(r2).toEqual(r1);
  });
});

describe("identityMigrationRunProductionInventory - handler log payload", () => {
  it("only logs actorUserId, usersScanned, hasNextPage, and providerCollisionSamplesCount (no PII, no samples)", async () => {
    mockRunInventory.mockResolvedValueOnce(
      inventorySummaryFixture({
        usersScanned: 2,
        providerCollisionSamples: ["hash-a"],
        nextPageToken: "PAGE_2",
      }),
    );
    await identityMigrationRunProductionInventoryHandler(
      makeRequest({ uid: "u-admin", role: "platformAdministrator" }),
    );
    expect(mockLogInfo).toHaveBeenCalledWith(
      "identity.productionInventoryComplete",
      {
        actorUserId: "u-admin",
        usersScanned: 2,
        hasNextPage: true,
        providerCollisionSamplesCount: 1,
      },
    );
    const logged = JSON.stringify(mockLogInfo.mock.calls);
    expect(logged).not.toContain("hash-a");
    expect(logged).not.toMatch(/email/i);
    expect(logged).not.toMatch(/providerAccountId/i);
  });
});
