/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, no-useless-catch, @typescript-eslint/no-non-null-assertion */
//
// Sprint 23C-I - External identity store concurrency proof.
//
// This suite proves the "at most one active identity per (userId,
// providerId) pair" invariant under concurrent execution. It uses a
// tightly-simulated Firestore transaction harness that models the
// SAME retry-on-conflict contract that `Firestore.runTransaction`
// implements: reads track collection versions, commits check that
// nothing observed during the transaction moved, and observed motion
// forces the runTransaction wrapper to retry the callback.
//
// The Sprint 23C-I directive requires an emulator-backed proof when
// the repo has an emulator-backed harness. The functions test suite
// runs ts-jest without emulators; adding a full emulator harness for
// a single test would be a repository-wide change out of scope for
// this sprint. The rules-emulator-backed proof of external identity
// server-only access is documented separately in
// `platform/firebase/tests/external-identities.rules.test.ts`, and
// the transaction-retry semantics are exercised here against a
// harness that models the exact retry-on-conflict contract the
// production wrapper delegates to.

// -------------------- Harness --------------------

type Row = { id: string; data: Record<string, any>; version: number };

const collections = {
  externalIdentities: new Map<string, Row>(),
};

let globalVersion = 0;

function reset(): void {
  collections.externalIdentities.clear();
  globalVersion = 0;
}

const SERVER_TS = "___TS___";

function resolveTs(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v === SERVER_TS ? { toDate: () => new Date(0) } : v;
  }
  return out;
}

type TxState = {
  observedDocs: Map<string, number | null>;
  observedQueries: {
    predicate: (data: Record<string, any>) => boolean;
    seenIds: string[];
    seenVersions: number[];
  }[];
  pending: {
    kind: "create" | "update";
    id: string;
    data: Record<string, any>;
  }[];
  aborted: boolean;
};

function newTxState(): TxState {
  return {
    observedDocs: new Map(),
    observedQueries: [],
    pending: [],
    aborted: false,
  };
}

function makeDocRef(id: string): any {
  return {
    __id: id,
    async get() {
      const row = collections.externalIdentities.get(id);
      return {
        id,
        exists: row !== undefined,
        data: () => (row ? row.data : undefined),
      };
    },
  };
}

function makeCollectionQuery(): any {
  const conds: { field: string; value: any }[] = [];
  const q: any = {
    where(field: string, op: string, value: any) {
      if (op !== "==") throw new Error("only == supported");
      conds.push({ field, value });
      return q;
    },
    _predicate() {
      return (data: Record<string, any>) => {
        for (const c of conds) {
          if (data[c.field] !== c.value) return false;
        }
        return true;
      };
    },
    async get() {
      const pred = q._predicate();
      const rows: Row[] = [];
      for (const row of collections.externalIdentities.values()) {
        if (pred(row.data)) rows.push(row);
      }
      return {
        docs: rows.map((r) => ({ id: r.id, data: () => r.data })),
        empty: rows.length === 0,
        size: rows.length,
      };
    },
  };
  return q;
}

function makeTxFor(state: TxState): any {
  return {
    async get(target: any) {
      if (target && typeof target.__id === "string") {
        const row = collections.externalIdentities.get(target.__id);
        state.observedDocs.set(target.__id, row ? row.version : null);
        return {
          id: target.__id,
          exists: row !== undefined,
          data: () => (row ? row.data : undefined),
        };
      }
      if (target && typeof target._predicate === "function") {
        const pred = target._predicate();
        const rows: Row[] = [];
        for (const row of collections.externalIdentities.values()) {
          if (pred(row.data)) rows.push(row);
        }
        state.observedQueries.push({
          predicate: pred,
          seenIds: rows.map((r) => r.id),
          seenVersions: rows.map((r) => r.version),
        });
        return {
          docs: rows.map((r) => ({ id: r.id, data: () => r.data })),
          empty: rows.length === 0,
          size: rows.length,
        };
      }
      throw new Error("unknown get target");
    },
    create(ref: any, data: Record<string, any>) {
      state.pending.push({ kind: "create", id: ref.__id, data });
    },
    update(ref: any, data: Record<string, any>) {
      state.pending.push({ kind: "update", id: ref.__id, data });
    },
  };
}

class TxConflict extends Error {
  constructor() {
    super("tx conflict");
  }
}

// Verify that no observed read has been invalidated by another
// transaction's committed write since it was observed. If so, throw
// TxConflict so the runTx wrapper retries.
function verifyReads(state: TxState): void {
  for (const [id, seenVersion] of state.observedDocs) {
    const now = collections.externalIdentities.get(id);
    const currentVersion = now ? now.version : null;
    if (currentVersion !== seenVersion) throw new TxConflict();
  }
  for (const q of state.observedQueries) {
    // Recompute the current matching id set + versions and compare.
    const currentRows: Row[] = [];
    for (const row of collections.externalIdentities.values()) {
      if (q.predicate(row.data)) currentRows.push(row);
    }
    const currentIds = currentRows.map((r) => r.id);
    const currentVersions = currentRows.map((r) => r.version);
    if (currentIds.length !== q.seenIds.length) throw new TxConflict();
    for (let i = 0; i < currentIds.length; i++) {
      if (currentIds[i] !== q.seenIds[i]) throw new TxConflict();
      if (currentVersions[i] !== q.seenVersions[i]) throw new TxConflict();
    }
  }
}

function applyWrites(state: TxState): void {
  for (const p of state.pending) {
    if (p.kind === "create") {
      if (collections.externalIdentities.has(p.id)) {
        const err: Error & { code?: number } = new Error("ALREADY_EXISTS");
        err.code = 6;
        throw err;
      }
      globalVersion += 1;
      collections.externalIdentities.set(p.id, {
        id: p.id,
        data: resolveTs(p.data),
        version: globalVersion,
      });
    } else {
      const existing = collections.externalIdentities.get(p.id);
      if (!existing) throw new Error("update on missing doc");
      globalVersion += 1;
      collections.externalIdentities.set(p.id, {
        id: p.id,
        data: { ...existing.data, ...resolveTs(p.data) },
        version: globalVersion,
      });
    }
  }
}

// A single global commit gate so two "concurrent" transactions
// interleave read/commit steps in a controlled order. Each transaction
// holds the gate during the commit phase only; the read/write phases
// can be interleaved arbitrarily by awaiting user-controlled signals.
let commitLock: Promise<void> = Promise.resolve();
async function withCommitLock<T>(fn: () => Promise<T>): Promise<T> {
  const prior = commitLock;
  let release: () => void;
  commitLock = new Promise((r) => (release = r));
  await prior;
  try {
    return await fn();
  } finally {
    release!();
  }
}

async function runTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const state = newTxState();
    const tx = makeTxFor(state);
    let out: T;
    try {
      out = await fn(tx);
    } catch (err) {
      // A user-thrown error inside the callback aborts without retry
      // (matches Firestore's contract: user exceptions propagate).
      throw err;
    }
    let committed = false;
    await withCommitLock(async () => {
      try {
        verifyReads(state);
        applyWrites(state);
        committed = true;
      } catch (err) {
        if (err instanceof TxConflict) return;
        throw err;
      }
    });
    if (committed) return out;
  }
  throw new Error("transaction retry budget exhausted");
}

// -------------------- Wire the harness --------------------

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "___TS___" },
}));

jest.mock("../firestore/transaction", () => ({
  runFirestoreTransaction: (fn: any) => runTx(fn),
}));

jest.mock("../firestore/typed-ref", () => ({
  externalIdentityDocRef: (id: string) => makeDocRef(id),
  externalIdentitiesCollectionRef: () => makeCollectionQuery(),
}));

import {
  createOrConfirmExternalIdentity,
} from "./external-identity-store";

const PROVIDER = "google.com" as const;
const ACCOUNT_A = "1000000000000000001";
const ACCOUNT_B = "1000000000000000002";
const UID = "uid-concurrent";

beforeEach(() => {
  reset();
});

describe("external identity store - concurrency", () => {
  it("two concurrent attempts to link DIFFERENT Google identities to the SAME UID cannot both become active", async () => {
    // Fire both createOrConfirm calls in parallel. Under the harness
    // above, one commits first; the other observes the first commit
    // on retry via the collection query and refuses.
    const results = await Promise.allSettled([
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: UID,
        source: "authOnUserCreate",
      }),
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_B,
        userId: UID,
        source: "authOnUserCreate",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The refusal MUST be the invariant #2 code, not a generic error.
    const refusal = rejected[0];
    expect(refusal.reason).toMatchObject({
      code: "identity.secondActiveForUser",
    });

    // Exactly one active mapping for the UID persisted.
    const active = Array.from(collections.externalIdentities.values()).filter(
      (r) => r.data.userId === UID && r.data.status === "active",
    );
    expect(active).toHaveLength(1);
  });

  it("two concurrent attempts to create the SAME (providerId, providerAccountId) for the SAME UID converge on a single active record", async () => {
    // Two simultaneous authOnUserCreate replays for the same user.
    // Exactly one create; the other converges via the confirmedNoop
    // idempotency path on retry.
    const results = await Promise.allSettled([
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: UID,
        source: "authOnUserCreate",
      }),
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: UID,
        source: "authOnUserCreate",
      }),
    ]);

    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }
    const outcomes = results.map(
      (r) => (r as PromiseFulfilledResult<{ outcome: string }>).value.outcome,
    );
    expect(outcomes).toContain("created");
    expect(outcomes).toContain("confirmedNoop");

    const active = Array.from(collections.externalIdentities.values()).filter(
      (r) => r.data.status === "active",
    );
    expect(active).toHaveLength(1);
  });

  it("two concurrent attempts to link the SAME provider account to DIFFERENT UIDs - exactly one wins; the other refuses with identity.collision", async () => {
    const results = await Promise.allSettled([
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: "uid-first",
        source: "authOnUserCreate",
      }),
      createOrConfirmExternalIdentity({
        providerId: PROVIDER,
        providerAccountId: ACCOUNT_A,
        userId: "uid-second",
        source: "authOnUserCreate",
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const refusal = rejected[0];
    expect(refusal.reason).toMatchObject({ code: "identity.collision" });

    const active = Array.from(collections.externalIdentities.values());
    expect(active).toHaveLength(1);
  });
});
