/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, no-useless-catch, @typescript-eslint/no-non-null-assertion */
//
// F5.2 Implementation Specification §4.2 / test contract item 22:
// "concurrent/stale writers cannot produce two accepted successors from
// the same expected revision." This suite proves the CAS invariant under
// concurrent execution using the same transaction-retry-simulation
// technique as `external-identity-store.concurrency.test.ts`: a harness
// that models the SAME retry-on-conflict contract
// `Firestore.runTransaction` implements (reads track document versions;
// commit verifies nothing observed during the transaction moved; observed
// motion forces a retry of the whole callback).

type Row = { id: string; data: Record<string, any>; version: number };

const documents = new Map<string, Row>();
let globalVersion = 0;

function reset(): void {
  documents.clear();
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
  pending: { kind: "create" | "update"; id: string; data: Record<string, any> }[];
};

function newTxState(): TxState {
  return { observedDocs: new Map(), pending: [] };
}

function makeDocRef(id: string): any {
  return { __id: id };
}

function makeTxFor(state: TxState): any {
  return {
    async get(ref: any) {
      const row = documents.get(ref.__id);
      state.observedDocs.set(ref.__id, row ? row.version : null);
      return {
        id: ref.__id,
        exists: row !== undefined,
        data: () => (row ? row.data : undefined),
      };
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

function verifyReads(state: TxState): void {
  for (const [id, seenVersion] of state.observedDocs) {
    const now = documents.get(id);
    const currentVersion = now ? now.version : null;
    if (currentVersion !== seenVersion) throw new TxConflict();
  }
}

function applyWrites(state: TxState): void {
  for (const p of state.pending) {
    if (p.kind === "create") {
      if (documents.has(p.id)) {
        const err: Error & { code?: number } = new Error("ALREADY_EXISTS");
        err.code = 6;
        throw err;
      }
      globalVersion += 1;
      documents.set(p.id, { id: p.id, data: resolveTs(p.data), version: globalVersion });
    } else {
      const existing = documents.get(p.id);
      if (!existing) throw new Error("update on missing doc");
      globalVersion += 1;
      documents.set(p.id, {
        id: p.id,
        data: { ...existing.data, ...resolveTs(p.data) },
        version: globalVersion,
      });
    }
  }
}

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
  const MAX_ATTEMPTS = 8;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const state = newTxState();
    const tx = makeTxFor(state);
    const out = await fn(tx);
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

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

const STUDENT_UID = "student-uid";
const CLASS_ID = "class-abc";
const TEACHER_UID = "teacher-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";

function recordDocId(studentId: string): string {
  return `studentAccommodations/${studentId}`;
}
function historyDocId(studentId: string, revision: number): string {
  return `studentAccommodations/${studentId}/history/r${revision}`;
}

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  return {
    PlatformError,
    READING_LEVELS: ["adapted"],
    platformCallable: (handler: unknown) => handler,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    runFirestoreTransaction: (fn: any) => runTx(fn),
    studentAccommodationDocRef: (studentId: string) => makeDocRef(recordDocId(studentId)),
    studentAccommodationCreationDocRef: (studentId: string) =>
      makeDocRef(recordDocId(studentId)),
    studentAccommodationUpdateDocRef: (studentId: string) =>
      makeDocRef(recordDocId(studentId)),
    studentAccommodationHistoryDocRef: (studentId: string, revision: number) =>
      makeDocRef(historyDocId(studentId, revision)),
    writeAuditEvent: async () => ({ eventId: "evt", record: {} }),
  };
});

jest.mock("./authorize-teacher-for-student", () => ({
  assertActiveTeacherInDistrict: async () => ({
    uid: TEACHER_UID,
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
  }),
  assertTeacherAuthorizedForStudent: async () => undefined,
}));

import { __accommodationsSetHandler } from "./accommodations-set";

function req(data: unknown): any {
  return { data, auth: { uid: TEACHER_UID, token: {} }, rawRequest: {} };
}

beforeEach(() => {
  reset();
});

describe("accommodationsSet - concurrency (F5.2 test #22)", () => {
  it("two concurrent first-activation writers at expectedRevision 0 cannot both become revision 1", async () => {
    const results = await Promise.allSettled([
      __accommodationsSetHandler(
        req({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 0,
          newValue: { status: "active", level: "adapted" },
        }),
      ),
      __accommodationsSetHandler(
        req({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 0,
          newValue: { status: "inactive" },
        }),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      code: "accommodations.writeConflict",
    });

    // Exactly one revision-1 record and one revision-1 history entry
    // persisted; the loser produced no successor at all.
    const record = documents.get(recordDocId(STUDENT_UID));
    expect(record).toBeDefined();
    expect(record!.data.configRevision).toBe(1);
    expect(documents.has(historyDocId(STUDENT_UID, 1))).toBe(true);
    expect(documents.has(historyDocId(STUDENT_UID, 2))).toBe(false);

    const allDocs = Array.from(documents.keys());
    expect(allDocs).toHaveLength(2); // record + exactly one history entry
  });

  it("two concurrent updates at the SAME stale expectedRevision cannot both be accepted", async () => {
    // Seed an existing revision-1 record directly into the harness.
    documents.set(recordDocId(STUDENT_UID), {
      id: recordDocId(STUDENT_UID),
      data: {
        studentId: STUDENT_UID,
        schoolId: SCHOOL_ID,
        readingAccessibility: { status: "active", level: "adapted" },
        configRevision: 1,
        createdAt: { toDate: () => new Date(0) },
        createdBy: TEACHER_UID,
        updatedAt: { toDate: () => new Date(0) },
        updatedBy: TEACHER_UID,
      },
      version: 1,
    });
    documents.set(historyDocId(STUDENT_UID, 1), {
      id: historyDocId(STUDENT_UID, 1),
      data: {
        revision: 1,
        readingAccessibility: { status: "active", level: "adapted" },
        setBy: TEACHER_UID,
        setAt: { toDate: () => new Date(0) },
        classId: CLASS_ID,
      },
      version: 1,
    });
    globalVersion = 1;

    const results = await Promise.allSettled([
      __accommodationsSetHandler(
        req({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 1,
          newValue: { status: "inactive" },
        }),
      ),
      __accommodationsSetHandler(
        req({
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          expectedRevision: 1,
          newValue: { status: "active", level: "adapted" },
        }),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      code: "accommodations.writeConflict",
    });

    const record = documents.get(recordDocId(STUDENT_UID));
    expect(record!.data.configRevision).toBe(2);
    expect(documents.has(historyDocId(STUDENT_UID, 2))).toBe(true);
    expect(documents.has(historyDocId(STUDENT_UID, 3))).toBe(false);
  });
});
