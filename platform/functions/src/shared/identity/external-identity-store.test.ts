/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-non-null-assertion */
//
// Sprint 23C-I - External identity store unit tests.
//
// These tests use a small in-memory Firestore harness that models
// document reads, `.create()`, `.update()`, and equality-only query
// filters faithfully enough to exercise the store's transactional
// invariants. Emulator-backed concurrency proof lives in the
// companion `.concurrency.test.ts` file.

import { PlatformError } from "../errors/platform-error";

// -------------------- In-memory Firestore harness --------------------

type StoredDoc = { id: string; data: Record<string, any> };

const store = new Map<string, Record<string, any>>();

function reset(): void {
  store.clear();
}

const SERVER_TS_SENTINEL = "___SERVER_TS___";

function resolveTimestamps(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const now = { toDate: () => new Date(1_700_000_000_000) };
  for (const [k, v] of Object.entries(data)) {
    if (v === SERVER_TS_SENTINEL) {
      out[k] = now;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function docSnap(id: string): {
  exists: boolean;
  data: () => Record<string, any> | undefined;
  id: string;
} {
  const raw = store.get(id);
  return {
    exists: raw !== undefined,
    id,
    data: () => (raw ? raw : undefined),
  };
}

function makeDocRef(collection: string, id: string): any {
  return {
    __collection: collection,
    __id: id,
    get: async () => docSnap(id),
  };
}

function collectionQuery(): any {
  const conditions: { field: string; value: any }[] = [];
  const q: any = {
    where(field: string, op: string, value: any) {
      if (op !== "==") throw new Error("harness only supports ==");
      conditions.push({ field, value });
      return q;
    },
    async get() {
      const docs: StoredDoc[] = [];
      for (const [id, data] of store) {
        let match = true;
        for (const c of conditions) {
          if (data[c.field] !== c.value) {
            match = false;
            break;
          }
        }
        if (match) docs.push({ id, data });
      }
      return {
        docs: docs.map((d) => ({
          id: d.id,
          data: () => d.data,
        })),
        empty: docs.length === 0,
        size: docs.length,
      };
    },
  };
  return q;
}

function makeTx(): any {
  const pending: {
    kind: "create" | "update";
    ref: any;
    data: Record<string, any>;
  }[] = [];
  return {
    async get(refOrQuery: any) {
      if (refOrQuery && typeof refOrQuery.get === "function") {
        return refOrQuery.get();
      }
      throw new Error("unknown get target");
    },
    create(ref: any, data: Record<string, any>) {
      pending.push({ kind: "create", ref, data });
    },
    update(ref: any, data: Record<string, any>) {
      pending.push({ kind: "update", ref, data });
    },
    _commit() {
      for (const p of pending) {
        if (p.kind === "create") {
          if (store.has(p.ref.__id)) {
            const err: Error & { code?: number } = new Error("ALREADY_EXISTS");
            err.code = 6;
            throw err;
          }
          store.set(p.ref.__id, resolveTimestamps(p.data));
        } else {
          const existing = store.get(p.ref.__id);
          if (!existing) {
            throw new Error("update on missing doc");
          }
          store.set(p.ref.__id, {
            ...existing,
            ...resolveTimestamps(p.data),
          });
        }
      }
    },
  };
}

async function runTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  // Simple non-retrying transaction; the concurrency test file
  // proves the retry-on-conflict path against a more realistic
  // harness.
  const tx = makeTx();
  const out = await fn(tx);
  tx._commit();
  return out;
}

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "___SERVER_TS___" },
}));

jest.mock("../firestore/transaction", () => ({
  runFirestoreTransaction: (fn: any) => runTx(fn),
}));

jest.mock("../firestore/typed-ref", () => ({
  externalIdentityDocRef: (id: string) => makeDocRef("externalIdentities", id),
  externalIdentitiesCollectionRef: () => collectionQuery(),
}));

import {
  createOrConfirmExternalIdentity,
  listExternalIdentitiesForUser,
  reconcileExternalIdentityForUser,
  resolveActiveExternalIdentity,
  restoreExternalIdentity,
  revokeExternalIdentity,
} from "./external-identity-store";
import { computeExternalIdentityDocId } from "./external-identity-doc-id";

const PROVIDER = "google.com" as const;
const ACCOUNT_A = "1000000000000000001";
const ACCOUNT_B = "1000000000000000002";
const UID_A = "uid-alice";
const UID_B = "uid-bob";

beforeEach(() => {
  reset();
});

describe("createOrConfirmExternalIdentity", () => {
  it("creates a new mapping and returns outcome 'created'", async () => {
    const result = await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    expect(result.outcome).toBe("created");
    expect(result.userId).toBe(UID_A);
    expect(result.externalIdentityId).toHaveLength(64);

    // Stored payload has canonical fields, no raw identifier in doc id.
    const stored = store.get(result.externalIdentityId);
    expect(stored).toMatchObject({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      status: "active",
      source: "authOnUserCreate",
    });
    expect(result.externalIdentityId.includes(ACCOUNT_A)).toBe(false);
  });

  it("idempotent confirmation of the same (account, uid) returns 'confirmedNoop' with no write", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    const before = JSON.stringify(Array.from(store.entries()));
    const result = await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    expect(result.outcome).toBe("confirmedNoop");
    expect(JSON.stringify(Array.from(store.entries()))).toBe(before);
  });

  it("collision - same provider account, different UID - is refused and existing record preserved", async () => {
    const first = await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    const before = { ...store.get(first.externalIdentityId) };

    await expect(
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: UID_B,
        source: "authOnUserCreate",
      }),
    ).rejects.toMatchObject({ code: "identity.collision" });

    expect(store.get(first.externalIdentityId)).toEqual(before);
    // Public error must not leak the conflicting UID.
    try {
      await createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: UID_B,
        source: "authOnUserCreate",
      });
    } catch (err) {
      expect((err as Error).message).not.toContain(UID_A);
      expect((err as Error).message).not.toContain(ACCOUNT_A);
    }
  });

  it("second active identity for the same UID and same provider is refused", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    await expect(
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_B,
        userId: UID_A,
        source: "authOnUserCreate",
      }),
    ).rejects.toMatchObject({ code: "identity.secondActiveForUser" });
  });

  it("restore path - revoked mapping for the same UID is transitioned back to active, createdAt preserved", async () => {
    const created = await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    const originalCreatedAt = store.get(created.externalIdentityId)!.createdAt;
    const originalSource = store.get(created.externalIdentityId)!.source;

    await revokeExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    expect(store.get(created.externalIdentityId)!.status).toBe("revoked");

    const restored = await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authReconciliation",
    });
    expect(restored.outcome).toBe("restored");
    expect(store.get(created.externalIdentityId)!.status).toBe("active");
    // createdAt and source are preserved (write shape excludes them).
    expect(store.get(created.externalIdentityId)!.createdAt).toBe(
      originalCreatedAt,
    );
    expect(store.get(created.externalIdentityId)!.source).toBe(originalSource);
  });

  it.each(["authOnUserCreate", "authReconciliation", "adminMigration"] as const)(
    "accepts source '%s'",
    async (source) => {
      await expect(
        createOrConfirmExternalIdentity({
          providerId: PROVIDER,
          providerAccountId: ACCOUNT_A + "-" + source,
          userId: UID_A + "-" + source,
          source,
        }),
      ).resolves.toMatchObject({ outcome: "created" });
    },
  );

  it("rejects an unknown source", async () => {
    await expect(
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: UID_A,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        source: "cronJob" as any,
      }),
    ).rejects.toMatchObject({ code: "identity.invalidSource" });
  });

  it("rejects empty userId, provider account id, and provider id", async () => {
    await expect(
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: "",
        source: "authOnUserCreate",
      }),
    ).rejects.toMatchObject({ code: "identity.invalidUserId" });

    await expect(
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: "",
        userId: UID_A,
        source: "authOnUserCreate",
      }),
    ).rejects.toBeInstanceOf(PlatformError);

    await expect(
      createOrConfirmExternalIdentity({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerId: "unknown" as any,
        providerAccountId: ACCOUNT_A,
        userId: UID_A,
        source: "authOnUserCreate",
      }),
    ).rejects.toBeInstanceOf(PlatformError);
  });
});

describe("resolveActiveExternalIdentity", () => {
  it("returns unresolved when no document exists", async () => {
    const r = await resolveActiveExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
    });
    expect(r).toEqual({ resolved: false });
  });

  it("returns the Firebase UID (only) when the mapping is active", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    const r = await resolveActiveExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
    });
    expect(r).toEqual({ resolved: true, userId: UID_A });
  });

  it("returns unresolved when the mapping is revoked", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    await revokeExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    const r = await resolveActiveExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
    });
    expect(r).toEqual({ resolved: false });
  });

  it("returns unresolved for a mismatched providerAccountId (does not guess)", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    const r = await resolveActiveExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_B,
    });
    expect(r).toEqual({ resolved: false });
  });
});

describe("revokeExternalIdentity", () => {
  it("active -> revoked, preserves immutable fields, returns 'revoked'", async () => {
    const created = await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    const before = { ...store.get(created.externalIdentityId)! };
    const result = await revokeExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    expect(result.outcome).toBe("revoked");
    const after = store.get(created.externalIdentityId)!;
    expect(after.status).toBe("revoked");
    expect(after.providerId).toBe(before.providerId);
    expect(after.providerAccountId).toBe(before.providerAccountId);
    expect(after.userId).toBe(before.userId);
    expect(after.source).toBe(before.source);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("repeated revoke yields 'alreadyRevoked' with no additional write", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    await revokeExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    const between = JSON.stringify(Array.from(store.entries()));
    const result = await revokeExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    expect(result.outcome).toBe("alreadyRevoked");
    expect(JSON.stringify(Array.from(store.entries()))).toBe(between);
  });

  it("absent record yields 'absent' with no write", async () => {
    const result = await revokeExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    expect(result.outcome).toBe("absent");
    expect(store.size).toBe(0);
  });

  it("collision - existing record for a different UID - is refused", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    await expect(
      revokeExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: UID_B,
      }),
    ).rejects.toMatchObject({ code: "identity.collision" });
  });
});

describe("restoreExternalIdentity", () => {
  it("restores a revoked mapping for the ORIGINAL UID", async () => {
    const created = await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    await revokeExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    const result = await restoreExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    expect(result.outcome).toBe("restored");
    expect(store.get(created.externalIdentityId)!.status).toBe("active");
  });

  it("refuses restore for a DIFFERENT UID", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    await revokeExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    await expect(
      restoreExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: UID_B,
      }),
    ).rejects.toMatchObject({ code: "identity.collision" });
  });

  it("returns 'alreadyActive' when the record is already active", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    const r = await restoreExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    expect(r.outcome).toBe("alreadyActive");
  });

  it("throws 'identity.notFound' when nothing exists to restore", async () => {
    await expect(
      restoreExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: UID_A,
      }),
    ).rejects.toMatchObject({ code: "identity.notFound" });
  });
});

describe("listExternalIdentitiesForUser", () => {
  it("returns active + revoked mappings for the given UID only", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    // A second unrelated account for a different user.
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_B,
      userId: UID_B,
      source: "authOnUserCreate",
    });
    const list = await listExternalIdentitiesForUser(UID_A);
    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe(UID_A);
    expect(list[0].providerAccountId).toBe(ACCOUNT_A);
  });
});

describe("reconcileExternalIdentityForUser", () => {
  it("creates a mapping when the observed account is new", async () => {
    const result = await reconcileExternalIdentityForUser({
      userId: UID_A,
      source: "authReconciliation",
      observedProviders: [
        { providerId: PROVIDER, providerAccountId: ACCOUNT_A },
      ],
    });
    expect(result.perProvider).toHaveLength(1);
    expect(result.perProvider[0].linkOutcome).toBe("created");
  });

  it("confirms an existing active mapping without write", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    const before = JSON.stringify(Array.from(store.entries()));
    const result = await reconcileExternalIdentityForUser({
      userId: UID_A,
      source: "authReconciliation",
      observedProviders: [
        { providerId: PROVIDER, providerAccountId: ACCOUNT_A },
      ],
    });
    expect(result.perProvider[0].linkOutcome).toBe("confirmedNoop");
    expect(JSON.stringify(Array.from(store.entries()))).toBe(before);
  });

  it("restores a revoked mapping when the same account reappears", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    await revokeExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
    });
    const result = await reconcileExternalIdentityForUser({
      userId: UID_A,
      source: "authReconciliation",
      observedProviders: [
        { providerId: PROVIDER, providerAccountId: ACCOUNT_A },
      ],
    });
    expect(result.perProvider[0].linkOutcome).toBe("restored");
  });

  it("revokes an active mapping when the observed side no longer has that provider", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    const result = await reconcileExternalIdentityForUser({
      userId: UID_A,
      source: "authReconciliation",
      observedProviders: [],
    });
    expect(result.perProvider).toHaveLength(1);
    expect(result.perProvider[0].revokeOutcome).toBe("revoked");
  });

  it("refuses when the observed account is bound to a different UID", async () => {
    await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    await expect(
      reconcileExternalIdentityForUser({
        userId: UID_B,
        source: "authReconciliation",
        observedProviders: [
          { providerId: PROVIDER, providerAccountId: ACCOUNT_A },
        ],
      }),
    ).rejects.toMatchObject({ code: "identity.collision" });
  });

  it("rejects duplicated providers on the observed side", async () => {
    await expect(
      reconcileExternalIdentityForUser({
        userId: UID_A,
        source: "authReconciliation",
        observedProviders: [
          { providerId: PROVIDER, providerAccountId: ACCOUNT_A },
          { providerId: PROVIDER, providerAccountId: ACCOUNT_B },
        ],
      }),
    ).rejects.toMatchObject({ code: "identity.invalidRequest" });
  });
});

describe("hashed doc id sanity", () => {
  it("createOrConfirm and resolveActive agree on the same doc id", async () => {
    const derived = computeExternalIdentityDocId({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
    });
    const created = await createOrConfirmExternalIdentity({
      providerId: PROVIDER,
      providerAccountId: ACCOUNT_A,
      userId: UID_A,
      source: "authOnUserCreate",
    });
    expect(created.externalIdentityId).toBe(derived);
  });
});
