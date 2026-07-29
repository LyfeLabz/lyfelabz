/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Sprint 23C-I - External identity migration service tests.

const mockListUsers = jest.fn();
jest.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ listUsers: mockListUsers }),
}));

const mockUserDocGet = jest.fn();
const mockUserDocRef = jest.fn(() => ({ get: mockUserDocGet }));

const mockCreateOrConfirm = jest.fn();
const mockResolveActive = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockLogInfo = jest.fn();
const mockLogError = jest.fn();
const mockComputeDocId = jest.fn();

jest.mock("../../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../../shared/errors/platform-error",
  );
  return {
    PlatformError,
    log: { info: mockLogInfo, warn: jest.fn(), error: mockLogError },
    userDocRef: mockUserDocRef,
    computeExternalIdentityDocId: (input: {
      providerId: string;
      providerAccountId: string;
    }) => mockComputeDocId(input),
    createOrConfirmExternalIdentity: mockCreateOrConfirm,
    resolveActiveExternalIdentity: mockResolveActive,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../../shared/errors/platform-error";
import {
  assertBackfillSafe,
  runBackfill,
  runInventory,
} from "./external-identity-migration";

function userFixture(overrides: any = {}): any {
  return {
    uid: "uid-1",
    disabled: false,
    providerData: [{ providerId: "google.com", uid: "42" }],
    ...overrides,
  };
}

function seedUserDoc(status: string = "active"): void {
  mockUserDocGet.mockResolvedValue({
    exists: true,
    data: () => ({ status }),
  });
}

beforeEach(() => {
  mockListUsers.mockReset();
  mockUserDocGet.mockReset();
  mockUserDocRef.mockClear();
  mockCreateOrConfirm.mockReset();
  mockResolveActive.mockReset();
  mockWriteAuditEvent.mockReset();
  mockLogInfo.mockReset();
  mockLogError.mockReset();
  mockComputeDocId.mockReset();
  mockWriteAuditEvent.mockResolvedValue({ eventId: "evt", record: {} });
  mockResolveActive.mockResolvedValue({ resolved: false });
  // Deterministic but PII-free surrogate. Real production uses
  // SHA-256; the surrogate returns a stable 64-hex string per input
  // that does NOT echo the raw provider account identifier, so
  // redaction assertions can trust the sample array.
  mockComputeDocId.mockImplementation(
    (input: { providerId: string; providerAccountId: string }) => {
      const seed = `${input.providerId}|${input.providerAccountId}`;
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
      }
      const hex = hash.toString(16).padStart(8, "0");
      return hex.repeat(8);
    },
  );
});

describe("assertBackfillSafe", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("refuses when acknowledgement string is missing or wrong", () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    expect(() =>
      assertBackfillSafe({
        executeWritesAcknowledgement: "WRONG" as any,
      }),
    ).toThrow(PlatformError);
  });

  it("refuses when the Firestore emulator env is missing", () => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    expect(() =>
      assertBackfillSafe({
        executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
      }),
    ).toThrow(/emulator/);
  });

  it("refuses when the Auth emulator env is missing", () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    expect(() =>
      assertBackfillSafe({
        executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
      }),
    ).toThrow(/emulator/);
  });

  it("accepts when both emulator envs are set and acknowledgement is exact", () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    expect(() =>
      assertBackfillSafe({
        executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
      }),
    ).not.toThrow();
  });
});

describe("runInventory", () => {
  it("writes no Firestore document and no per-record audit; classifies each user", async () => {
    mockListUsers.mockResolvedValueOnce({
      users: [
        userFixture({ uid: "u1" }),
        userFixture({ uid: "u2", providerData: [] }),
        userFixture({ uid: "u3", disabled: true }),
      ],
      pageToken: undefined,
    });
    seedUserDoc("active");

    const result = await runInventory();
    expect(mockCreateOrConfirm).not.toHaveBeenCalled();
    expect(result.usersScanned).toBe(3);
    expect(result.counts.eligibleSingleGoogleProvider).toBe(1);
    expect(result.counts.noGoogleProvider).toBe(1);
    expect(result.counts.disabledAuthUser).toBe(1);
    // Exactly the attempted + completed pair, no per-record audit.
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(2);
    expect(mockWriteAuditEvent.mock.calls[0][0].action).toBe(
      "identity.migrationAttempted",
    );
    expect(mockWriteAuditEvent.mock.calls[1][0].action).toBe(
      "identity.migrationCompleted",
    );
  });

  it("propagates the nextPageToken so a partial run is restartable", async () => {
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture()],
      pageToken: "PAGE_2",
    });
    seedUserDoc("active");
    const r = await runInventory();
    expect(r.nextPageToken).toBe("PAGE_2");
  });

  it("classifies an orphan Auth user (no matching users/{uid} doc)", async () => {
    mockUserDocGet.mockResolvedValue({ exists: false });
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture()],
      pageToken: undefined,
    });
    const r = await runInventory();
    expect(r.counts.orphanAuthUser).toBe(1);
  });

  it("classifies a pending / provisioned user distinctly", async () => {
    seedUserDoc("provisioned");
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture()],
      pageToken: undefined,
    });
    const r = await runInventory();
    expect(r.counts.pendingOrProvisionedUser).toBe(1);
  });

  it("classifies a multiple-providers-one-google user distinctly", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [
        userFixture({
          providerData: [
            { providerId: "google.com", uid: "42" },
            { providerId: "password" },
          ],
        }),
      ],
      pageToken: undefined,
    });
    const r = await runInventory();
    expect(r.counts.multipleProvidersOneGoogle).toBe(1);
  });

  it("promotes a user to providerCollision when the store already binds the same account to a different UID", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture({ uid: "u-new" })],
      pageToken: undefined,
    });
    mockResolveActive.mockResolvedValue({ resolved: true, userId: "u-other" });
    const r = await runInventory();
    expect(r.counts.providerCollision).toBe(1);
    expect(r.counts.eligibleSingleGoogleProvider).toBe(0);
  });

  it("returns hashed providerCollisionSamples up to the default cap (50)", async () => {
    seedUserDoc("active");
    const users = Array.from({ length: 60 }, (_, i) =>
      userFixture({
        uid: `u-${i}`,
        providerData: [{ providerId: "google.com", uid: `pa-${i}` }],
      }),
    );
    mockListUsers.mockResolvedValueOnce({ users, pageToken: undefined });
    mockResolveActive.mockImplementation(() =>
      Promise.resolve({ resolved: true, userId: "u-other" }),
    );
    const r = await runInventory();
    expect(r.counts.providerCollision).toBe(60);
    expect(r.providerCollisionSamples).toHaveLength(50);
    // Every sample is a 64-hex-character identifier; the raw
    // provider account ids never leak into the sample array.
    for (const sample of r.providerCollisionSamples) {
      expect(sample).toMatch(/^[0-9a-f]{64}$/);
    }
    const serialized = JSON.stringify(r.providerCollisionSamples);
    for (let i = 0; i < 60; i++) {
      expect(serialized).not.toContain(`pa-${i}`);
    }
  });

  it("respects an explicit collisionSampleLimit of 0 (counts still populate)", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture({ uid: "u-1" })],
      pageToken: undefined,
    });
    mockResolveActive.mockResolvedValue({ resolved: true, userId: "u-other" });
    const r = await runInventory({ collisionSampleLimit: 0 });
    expect(r.counts.providerCollision).toBe(1);
    expect(r.providerCollisionSamples).toEqual([]);
  });

  it("rejects a negative or non-integer collisionSampleLimit", async () => {
    await expect(
      runInventory({ collisionSampleLimit: -1 }),
    ).rejects.toBeInstanceOf(PlatformError);
    await expect(
      runInventory({ collisionSampleLimit: 1.5 }),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it("is deterministic - two runs against identical input produce identical output", async () => {
    seedUserDoc("active");
    const users = [
      userFixture({ uid: "u-a", providerData: [{ providerId: "google.com", uid: "pa-a" }] }),
      userFixture({ uid: "u-b", providerData: [{ providerId: "google.com", uid: "pa-b" }] }),
      userFixture({ uid: "u-c", providerData: [] }),
    ];
    mockListUsers.mockResolvedValue({ users, pageToken: undefined });
    mockResolveActive.mockImplementation(({ providerAccountId }) =>
      Promise.resolve(
        providerAccountId === "pa-a"
          ? { resolved: true, userId: "u-other" }
          : { resolved: false },
      ),
    );
    const r1 = await runInventory();
    const r2 = await runInventory();
    expect(r2).toEqual(r1);
  });

  it("returns an empty providerCollisionSamples array when there are no collisions", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture()],
      pageToken: undefined,
    });
    const r = await runInventory();
    expect(r.providerCollisionSamples).toEqual([]);
  });
});

describe("runBackfill", () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("safeguards - refuses without the emulator env AND acknowledgement", async () => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    await expect(
      runBackfill({ executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY" }),
    ).rejects.toBeInstanceOf(PlatformError);

    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    await expect(
      runBackfill({ executeWritesAcknowledgement: "no" as any }),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it("creates a mapping for an eligible single-Google user (source adminMigration)", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture()],
      pageToken: undefined,
    });
    mockCreateOrConfirm.mockResolvedValue({
      externalIdentityId: "hash-1",
      userId: "uid-1",
      outcome: "created",
    });
    const r = await runBackfill({
      executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
    });
    expect(mockCreateOrConfirm).toHaveBeenCalledWith({
      providerId: "google.com",
      providerAccountId: "42",
      userId: "uid-1",
      source: "adminMigration",
    });
    expect(r.mappingsCreated).toBe(1);
  });

  it("is idempotent - re-runs count confirmed noops without emitting per-record audits", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture()],
      pageToken: undefined,
    });
    mockCreateOrConfirm.mockResolvedValue({
      externalIdentityId: "hash-1",
      userId: "uid-1",
      outcome: "confirmedNoop",
    });
    const r = await runBackfill({
      executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
    });
    expect(r.mappingsConfirmed).toBe(1);
    // Only the attempted + completed pair, no per-record audit.
    const perRecordAudits = mockWriteAuditEvent.mock.calls.filter(
      (call) =>
        call[0].action !== "identity.migrationAttempted" &&
        call[0].action !== "identity.migrationCompleted",
    );
    expect(perRecordAudits).toHaveLength(0);
  });

  it("does not write for users with no Google provider or a disabled account", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [
        userFixture({ providerData: [] }),
        userFixture({ disabled: true }),
      ],
      pageToken: undefined,
    });
    await runBackfill({
      executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
    });
    expect(mockCreateOrConfirm).not.toHaveBeenCalled();
  });

  it("catches identity.collision refusals, does not mutate, counts them, and emits a safe collision audit event", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture()],
      pageToken: undefined,
    });
    mockCreateOrConfirm.mockRejectedValue(
      new PlatformError("identity.collision", "conflict"),
    );
    const r = await runBackfill({
      executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
    });
    expect(r.collisionsObserved).toBe(1);
    expect(
      mockWriteAuditEvent.mock.calls.some(
        (c) => c[0].action === "identity.collisionDetected",
      ),
    ).toBe(true);
    // Collision audit payload has no email, provider id, or raw
    // account id.
    const call = mockWriteAuditEvent.mock.calls.find(
      (c) => c[0].action === "identity.collisionDetected",
    );
    expect(JSON.stringify(call![0])).not.toContain("42");
    expect(JSON.stringify(call![0])).not.toContain("google.com");
  });

  it("neither role, status, nor enrollment is ever mutated - only createOrConfirm is called", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture()],
      pageToken: undefined,
    });
    mockCreateOrConfirm.mockResolvedValue({
      externalIdentityId: "hash-1",
      userId: "uid-1",
      outcome: "created",
    });
    await runBackfill({
      executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
    });
    // The service module only imports createOrConfirm as its write
    // path; no other write helper is invoked.
    expect(mockCreateOrConfirm).toHaveBeenCalledTimes(1);
  });

  it("supplies a pageToken cursor so a partial run is restartable", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [],
      pageToken: "CURSOR_X",
    });
    const r = await runBackfill({
      executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
    });
    expect(r.nextPageToken).toBe("CURSOR_X");
  });

  it("summary shape is deterministic - counts + mappings + collisions + nextPageToken", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [userFixture()],
      pageToken: undefined,
    });
    mockCreateOrConfirm.mockResolvedValue({
      externalIdentityId: "hash-1",
      userId: "uid-1",
      outcome: "created",
    });
    const r = await runBackfill({
      executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
    });
    expect(Object.keys(r).sort()).toEqual(
      [
        "collisionsObserved",
        "counts",
        "mappingsConfirmed",
        "mappingsCreated",
        "mappingsRestored",
        "providerCollisionSamples",
        "usersScanned",
      ].sort(),
    );
  });

  it("logs and returns without leaking emails or provider identifiers", async () => {
    seedUserDoc("active");
    mockListUsers.mockResolvedValueOnce({
      users: [
        userFixture({
          email: "secret@example.invalid",
          providerData: [{ providerId: "google.com", uid: "SECRET_ID" }],
        }),
      ],
      pageToken: undefined,
    });
    mockCreateOrConfirm.mockResolvedValue({
      externalIdentityId: "hash-x",
      userId: "uid-1",
      outcome: "created",
    });
    const r = await runBackfill({
      executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY",
    });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("secret@example.invalid");
    expect(serialized).not.toContain("SECRET_ID");
    for (const call of mockLogInfo.mock.calls) {
      const payload = JSON.stringify(call[1]);
      expect(payload).not.toContain("secret@example.invalid");
      expect(payload).not.toContain("SECRET_ID");
    }
  });
});
