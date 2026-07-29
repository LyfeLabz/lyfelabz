/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, no-useless-catch, @typescript-eslint/only-throw-error */
//
// Sprint 23D. In-memory Firestore fake used only by the durable
// OAuth-state and token-store test suites. The fake implements the
// narrow subset of the admin-SDK Firestore surface those stores
// actually call:
//
//   * db.collection(name).doc(id).create(data)
//   * db.collection(name).doc(id).get()
//   * db.collection(name).doc(id).delete()
//   * db.collection(name).where(...).get()
//   * db.batch(); batch.delete(ref); batch.commit()
//   * db.runTransaction(async tx => { tx.get(ref); tx.update(ref, patch); ... })
//
// Semantics that matter for the store contracts:
//
//   * `.create()` throws with `.code === 6` on collision (matches
//     admin-SDK behaviour for ALREADY_EXISTS).
//   * `runTransaction` retries the callback on write conflict up to
//     five times (matches the admin-SDK default). Conflict is
//     detected by tracking the row version each transaction observed
//     during its `tx.get(ref)` calls and comparing on commit; a
//     concurrent commit that advanced the row version triggers
//     retry. This is the exact contract the FirestoreLmsOAuthStateStore
//     relies on for concurrent-consume convergence.
//   * `FieldValue.serverTimestamp()` resolves to a fixed epoch-0 date
//     inside the fake; the store test suites do not depend on the
//     wall-clock value.

import { FieldValue, Timestamp } from "firebase-admin/firestore";

type Row = { data: Record<string, any>; version: number };

class FakeCollection {
  readonly rows = new Map<string, Row>();
}

class FakeDocRef {
  constructor(
    private readonly firestore: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  private col(): FakeCollection {
    return this.firestore._collection(this.collectionName);
  }

  async get(): Promise<{
    id: string;
    exists: boolean;
    data: () => Record<string, any> | undefined;
  }> {
    const row = this.col().rows.get(this.id);
    return {
      id: this.id,
      exists: row !== undefined,
      data: () => (row ? { ...row.data } : undefined),
    };
  }

  async create(data: Record<string, any>): Promise<void> {
    const col = this.col();
    if (col.rows.has(this.id)) {
      const err: any = new Error("ALREADY_EXISTS");
      err.code = 6;
      throw err;
    }
    col.rows.set(this.id, {
      data: resolveSentinels(data),
      version: this.firestore._nextVersion(),
    });
  }

  async set(data: Record<string, any>): Promise<void> {
    const col = this.col();
    col.rows.set(this.id, {
      data: resolveSentinels(data),
      version: this.firestore._nextVersion(),
    });
  }

  async delete(): Promise<void> {
    this.col().rows.delete(this.id);
  }
}

class FakeQuery {
  constructor(
    private readonly firestore: FakeFirestore,
    private readonly collectionName: string,
    private readonly filters: { field: string; value: unknown }[],
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    if (op !== "==") throw new Error(`fake: only == is supported (got ${op})`);
    return new FakeQuery(this.firestore, this.collectionName, [
      ...this.filters,
      { field, value },
    ]);
  }

  async get(): Promise<{
    empty: boolean;
    size: number;
    docs: { id: string; ref: FakeDocRef; data: () => Record<string, any> }[];
  }> {
    const col = this.firestore._collection(this.collectionName);
    const docs: {
      id: string;
      ref: FakeDocRef;
      data: () => Record<string, any>;
    }[] = [];
    for (const [id, row] of col.rows) {
      let match = true;
      for (const f of this.filters) {
        if (row.data[f.field] !== f.value) {
          match = false;
          break;
        }
      }
      if (match) {
        docs.push({
          id,
          ref: new FakeDocRef(this.firestore, this.collectionName, id),
          data: () => ({ ...row.data }),
        });
      }
    }
    return { empty: docs.length === 0, size: docs.length, docs };
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(firestore: FakeFirestore, name: string) {
    super(firestore, name, []);
    this._firestore = firestore;
    this._name = name;
  }
  private readonly _firestore: FakeFirestore;
  private readonly _name: string;

  doc(id: string): FakeDocRef {
    return new FakeDocRef(this._firestore, this._name, id);
  }
}

class FakeBatch {
  private readonly ops: (() => void)[] = [];
  constructor(private readonly firestore: FakeFirestore) {}
  delete(ref: FakeDocRef): void {
    this.ops.push(() => {
      this.firestore._collection(ref.collectionName).rows.delete(ref.id);
    });
  }
  async commit(): Promise<void> {
    for (const op of this.ops) op();
  }
}

type ObservedRow = { collection: string; id: string; version: number | null };

class FakeTransaction {
  readonly observed: ObservedRow[] = [];
  readonly pending: {
    kind: "update" | "set" | "delete" | "create";
    ref: FakeDocRef;
    data?: Record<string, any>;
  }[] = [];
  constructor(private readonly firestore: FakeFirestore) {}

  async get(ref: FakeDocRef): Promise<{
    id: string;
    exists: boolean;
    data: () => Record<string, any> | undefined;
  }> {
    const row = this.firestore._collection(ref.collectionName).rows.get(ref.id);
    this.observed.push({
      collection: ref.collectionName,
      id: ref.id,
      version: row ? row.version : null,
    });
    return {
      id: ref.id,
      exists: row !== undefined,
      data: () => (row ? { ...row.data } : undefined),
    };
  }

  update(ref: FakeDocRef, patch: Record<string, any>): void {
    this.pending.push({ kind: "update", ref, data: patch });
  }
  set(ref: FakeDocRef, data: Record<string, any>): void {
    this.pending.push({ kind: "set", ref, data });
  }
  create(ref: FakeDocRef, data: Record<string, any>): void {
    this.pending.push({ kind: "create", ref, data });
  }
  delete(ref: FakeDocRef): void {
    this.pending.push({ kind: "delete", ref });
  }
}

function isServerTimestampSentinel(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as any) === (FieldValue.serverTimestamp() as unknown as object)
      ? true
      : (v as any)?._methodName === "serverTimestamp" ||
          (v as any)?.constructor?.name === "ServerTimestampTransform"
  );
}

function resolveSentinels(input: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (isServerTimestampSentinel(v)) {
      out[k] = Timestamp.fromMillis(0);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Hook for tests that want to synchronize concurrent transactions.
// The fake calls this after each `tx.get()` (so tests can advance
// other work) and before each commit attempt.
export type FakeTransactionHook = () => Promise<void>;

export class FakeFirestore {
  private readonly collections = new Map<string, FakeCollection>();
  private versionCounter = 0;
  public transactionHook?: FakeTransactionHook;

  _collection(name: string): FakeCollection {
    let c = this.collections.get(name);
    if (!c) {
      c = new FakeCollection();
      this.collections.set(name, c);
    }
    return c;
  }

  _nextVersion(): number {
    this.versionCounter += 1;
    return this.versionCounter;
  }

  collection(name: string): FakeCollectionRef {
    return new FakeCollectionRef(this, name);
  }

  batch(): FakeBatch {
    return new FakeBatch(this);
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const MAX_ATTEMPTS = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const tx = new FakeTransaction(this);
      let result: T;
      try {
        result = await fn(tx);
      } catch (err) {
        // Reads may have observed rows; the callback itself decided
        // to throw. Do not commit pending writes.
        throw err;
      }
      if (this.transactionHook) await this.transactionHook();
      // Conflict check: every observed row's version must still match.
      let conflicted = false;
      for (const obs of tx.observed) {
        const row = this._collection(obs.collection).rows.get(obs.id);
        const nowVersion = row ? row.version : null;
        if (nowVersion !== obs.version) {
          conflicted = true;
          break;
        }
      }
      if (conflicted) {
        lastError = new Error("aborted");
        continue;
      }
      // Apply pending writes.
      for (const p of tx.pending) {
        const col = this._collection(p.ref.collectionName);
        if (p.kind === "delete") {
          col.rows.delete(p.ref.id);
        } else if (p.kind === "create") {
          if (col.rows.has(p.ref.id)) {
            const err: any = new Error("ALREADY_EXISTS");
            err.code = 6;
            throw err;
          }
          col.rows.set(p.ref.id, {
            data: resolveSentinels(p.data!),
            version: this._nextVersion(),
          });
        } else if (p.kind === "set") {
          col.rows.set(p.ref.id, {
            data: resolveSentinels(p.data!),
            version: this._nextVersion(),
          });
        } else {
          const existing = col.rows.get(p.ref.id);
          if (!existing) continue;
          col.rows.set(p.ref.id, {
            data: { ...existing.data, ...resolveSentinels(p.data!) },
            version: this._nextVersion(),
          });
        }
      }
      return result;
    }
    throw lastError ?? new Error("transaction retries exhausted");
  }
}
