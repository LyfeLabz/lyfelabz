/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, no-useless-catch */
//
// Sprint 30A.2 - Google Classroom best-score grade-passback: MANDATORY
// concurrency proof.
//
// This is the load-bearing suite. It proves the monotonic synchronization
// invariant enumerated in the Sprint 30A.2 specification's "Critical
// Concurrency Requirement" section: no execution schedule this engine can
// produce ever sends a lower value to Classroom after a higher one, and at
// most one worker is ever actively calling Classroom for a given
// (assignmentId, studentId) pair at a time.
//
// The harness below is the same tightly-simulated, retry-on-conflict
// Firestore transaction model used by `engine.test.ts` and by
// `shared/identity/external-identity-store.concurrency.test.ts`, extended
// with a `pauseBeforeRunTxCall` gate keyed by the ordinal index of the Nth
// `runFirestoreTransaction` invocation across the whole test. This lets a
// test deterministically freeze one "worker" at an exact point in its
// sequence of Firestore transactions (e.g. "about to run its
// reconcile-after-success transaction, i.e. after its upstream PATCH
// already resolved but before that success is durably persisted") while a
// second, fully-concurrent `synchronizeGradePassback` call for the same
// pair runs to completion, then resumes the first and inspects the
// resulting upstream call ORDER - not merely the final Firestore state -
// per the specification's explicit testing requirement.
//
// Harness functions are declared with `function` (not `const`) so they
// may be referenced inside `jest.mock` factories per Jest's hoisting
// rule. Duplicated from `engine.test.ts` rather than shared via an
// imported fixture module: Jest test files do not share module state
// across files in any case, and a previous attempt at a shared
// `__fixtures__` harness module tripped this repo's strict (non-test-file)
// ESLint type-safety rules for its necessarily-`any`-typed generic
// document/query/transaction shims - `**/*.test.ts` gets a relaxed
// override for exactly this reason (see `.eslintrc.js`).

type Row = { id: string; data: Record<string, any>; version: number };

const FIELD_DELETE = Symbol("FieldValue.delete()");
const SERVER_TS = Symbol("FieldValue.serverTimestamp()");

const harnessStore = new Map<string, Map<string, Row>>();
let harnessVersion = 0;
let mockNowMs = 1_700_000_000_000;

function coll(name: string): Map<string, Row> {
  let c = harnessStore.get(name);
  if (!c) {
    c = new Map();
    harnessStore.set(name, c);
  }
  return c;
}

function resetHarness(): void {
  harnessStore.clear();
  harnessVersion = 0;
  mockNowMs = 1_700_000_000_000;
  runTxCallCounter = 0;
  runTxPauseGates.clear();
  runTxReachedSignals.clear();
}

function resolveWrite(
  existing: Record<string, any>,
  incoming: Record<string, any>,
  merge = false,
): Record<string, any> {
  const base = merge ? { ...existing } : {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v === FIELD_DELETE) {
      delete base[k];
    } else if (v === SERVER_TS) {
      base[k] = { toMillis: () => mockNowMs, toDate: () => new Date(mockNowMs) };
    } else {
      base[k] = v;
    }
  }
  return base;
}

function seedDoc(collectionName: string, id: string, data: Record<string, any>): void {
  harnessVersion += 1;
  coll(collectionName).set(id, { id, data: resolveWrite({}, data), version: harnessVersion });
}

function readDoc(collectionName: string, id: string): Record<string, any> | undefined {
  return coll(collectionName).get(id)?.data;
}

function makeDocRef(collectionName: string, id: string): any {
  return {
    __collection: collectionName,
    __id: id,
    async get() {
      const row = coll(collectionName).get(id);
      return { id, exists: row !== undefined, data: () => row?.data };
    },
    async set(data: Record<string, any>, options?: { merge?: boolean }) {
      const existing = coll(collectionName).get(id);
      harnessVersion += 1;
      coll(collectionName).set(id, {
        id,
        data: resolveWrite(existing?.data ?? {}, data, options?.merge ?? false),
        version: harnessVersion,
      });
    },
  };
}

function makeQueryRef(collectionName: string): any {
  const conds: { field: string; value: any }[] = [];
  const q: any = {
    __collection: collectionName,
    where(field: string, op: string, value: any) {
      if (op !== "==") throw new Error("harness only supports == queries");
      conds.push({ field, value });
      return q;
    },
    _predicate() {
      return (data: Record<string, any>) => conds.every((c) => data[c.field] === c.value);
    },
    async get() {
      const pred = q._predicate();
      const rows: Row[] = [];
      for (const row of coll(collectionName).values()) {
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

type TxState = {
  observedDocs: Map<string, number | null>;
  observedQueries: {
    collectionName: string;
    predicate: (data: Record<string, any>) => boolean;
    seenIds: string[];
    seenVersions: number[];
  }[];
  pending: { collectionName: string; id: string; data: Record<string, any>; merge: boolean }[];
};

function makeTxFor(state: TxState): any {
  return {
    async get(target: any) {
      if (target && typeof target.__id === "string") {
        const row = coll(target.__collection).get(target.__id);
        state.observedDocs.set(`${target.__collection}/${target.__id}`, row ? row.version : null);
        return { id: target.__id, exists: row !== undefined, data: () => row?.data };
      }
      if (target && typeof target._predicate === "function") {
        const pred = target._predicate();
        const rows: Row[] = [];
        for (const row of coll(target.__collection).values()) {
          if (pred(row.data)) rows.push(row);
        }
        state.observedQueries.push({
          collectionName: target.__collection,
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
      throw new Error("harness: unknown get target");
    },
    set(ref: any, data: Record<string, any>, options?: { merge?: boolean }) {
      state.pending.push({
        collectionName: ref.__collection,
        id: ref.__id,
        data,
        merge: options?.merge ?? false,
      });
    },
  };
}

class TxConflict extends Error {}

function verifyReads(state: TxState): void {
  for (const [key, seenVersion] of state.observedDocs) {
    const [collectionName, id] = key.split("/");
    const now = coll(collectionName).get(id);
    if ((now ? now.version : null) !== seenVersion) throw new TxConflict();
  }
  for (const q of state.observedQueries) {
    const currentRows: Row[] = [];
    for (const row of coll(q.collectionName).values()) {
      if (q.predicate(row.data)) currentRows.push(row);
    }
    if (currentRows.length !== q.seenIds.length) throw new TxConflict();
    for (let i = 0; i < currentRows.length; i++) {
      if (currentRows[i].id !== q.seenIds[i]) throw new TxConflict();
      if (currentRows[i].version !== q.seenVersions[i]) throw new TxConflict();
    }
  }
}

function applyWrites(state: TxState): void {
  for (const p of state.pending) {
    const existing = coll(p.collectionName).get(p.id);
    harnessVersion += 1;
    coll(p.collectionName).set(p.id, {
      id: p.id,
      data: resolveWrite(existing?.data ?? {}, p.data, p.merge),
      version: harnessVersion,
    });
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

// -------------------- Deterministic pause-point control --------------------
//
// Keyed by the ordinal index (1-based, across the whole test) of the Nth
// `runFirestoreTransaction` call. A test registers a deferred gate for a
// specific index BEFORE triggering the call sequence that will produce
// it, then resolves the gate to let that exact transaction proceed. The
// pause happens BEFORE that transaction's callback runs any reads, which
// faithfully models "this transaction has not yet executed/committed" -
// exactly the window the specification's race scenarios describe.
let runTxCallCounter = 0;
const runTxPauseGates = new Map<number, Promise<void>>();

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const runTxReachedSignals = new Map<number, { resolve: () => void }>();

// Returns a gate for the Nth `runFirestoreTransaction` call, PLUS a
// `waitUntilReached` promise that resolves the instant that call actually
// arrives at the gate (before any of its reads run) - so a test can await
// a deterministic signal instead of guessing a microtask-tick count.
function pauseRunTxCall(callIndex: number): {
  resolve: () => void;
  waitUntilReached: Promise<void>;
} {
  const deferred = createDeferred();
  runTxPauseGates.set(callIndex, deferred.promise);
  const reached = createDeferred();
  runTxReachedSignals.set(callIndex, { resolve: reached.resolve });
  return { resolve: deferred.resolve, waitUntilReached: reached.promise };
}

async function runTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  runTxCallCounter += 1;
  const myIndex = runTxCallCounter;
  const gate = runTxPauseGates.get(myIndex);
  if (gate) {
    runTxReachedSignals.get(myIndex)?.resolve();
    await gate;
  }

  const MAX_ATTEMPTS = 10;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const state: TxState = { observedDocs: new Map(), observedQueries: [], pending: [] };
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
  throw new Error("harness: transaction retry budget exhausted");
}

const mockFieldValueImpl = { serverTimestamp: () => SERVER_TS, delete: () => FIELD_DELETE };
const mockTimestampClassImpl = {
  now: () => ({ toMillis: () => mockNowMs, toDate: () => new Date(mockNowMs) }),
  fromMillis: (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }),
};

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: mockFieldValueImpl,
  Timestamp: mockTimestampClassImpl,
}));

const mockWriteAuditEvent = jest.fn();
const mockResolveActiveProviderAccountIdForUser = jest.fn();

jest.mock("../../shared", () => {
  const { PlatformError: ActualPlatformError } = jest.requireActual(
    "../../shared/errors/platform-error",
  );
  const { roundHalfToEven2: actualRoundHalfToEven2 } = jest.requireActual(
    "../../shared/math/round-half-to-even",
  );
  return {
    PlatformError: ActualPlatformError,
    roundHalfToEven2: actualRoundHalfToEven2,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    writeAuditEvent: (...args: unknown[]) => mockWriteAuditEvent(...args),
    resolveActiveProviderAccountIdForUser: (...args: unknown[]) =>
      mockResolveActiveProviderAccountIdForUser(...args),
    runFirestoreTransaction: (fn: any) => runTx(fn),
    assignmentDocRef: (id: string) => makeDocRef("assignments", id),
    attemptsCollectionRef: () => makeQueryRef("attempts"),
    lmsAssignmentPublicationDocRef: (id: string) => makeDocRef("lmsAssignmentPublications", id),
    lmsConnectionDocRef: (id: string) => makeDocRef("lmsConnections", id),
    lmsGradePassbackDocRef: (id: string) => makeDocRef("lmsGradePassbacks", id),
    // Reassignment model: canonical Current-pointer and class-enumeration
    // seams used by the shared occurrence grouping. With no pointer seeded
    // (every pre-existing test), the scope is unresolved and the engine
    // keeps its exact per-assignment behavior.
    assignmentsCurrentDocRef: (classId: string, lessonSlug: string) =>
      makeDocRef("assignmentsCurrent", `${classId}__${lessonSlug}`),
    assignmentsCollectionRef: () => makeQueryRef("assignments"),
  };
});

const mockResolveLiveCredential = jest.fn();
jest.mock("../tokens/credential-resolver", () => ({
  resolveLiveCredential: (...args: unknown[]) => mockResolveLiveCredential(...args),
}));

// -------------------- Upstream call-order recorder --------------------
//
// Records every `patchStudentSubmissionGrade` invocation in call order,
// and asserts (by throwing, which would fail the test loudly) that at
// most one call is ever concurrently in flight - the actual "at most one
// active outbound worker" invariant, proven at the network-call boundary
// rather than only inferred from the final Firestore state.
let activePatchCalls = 0;
let maxObservedConcurrentPatchCalls = 0;
const patchCallOrder: number[] = [];
const resolveStudentSubmissionQueue: (() => Promise<{ submissionId: string } | null>)[] = [];
const patchStudentSubmissionGradeQueue: (() => Promise<void>)[] = [];

// Queue a controlled pause on the NEXT `resolveStudentSubmission` call.
// `waitUntilReached` resolves the instant that call is entered (before it
// starts waiting on the gate), so a test can synchronize deterministically
// instead of guessing a microtask-tick count.
function queueControlledResolveStudentSubmission(): {
  resolve: () => void;
  waitUntilReached: Promise<void>;
} {
  const gate = createDeferred();
  const reached = createDeferred();
  resolveStudentSubmissionQueue.push(async () => {
    reached.resolve();
    await gate.promise;
    return { submissionId: "submission-1" };
  });
  return { resolve: gate.resolve, waitUntilReached: reached.promise };
}

function queueControlledPatch(): { resolve: () => void; waitUntilReached: Promise<void> } {
  const gate = createDeferred();
  const reached = createDeferred();
  patchStudentSubmissionGradeQueue.push(async () => {
    reached.resolve();
    await gate.promise;
  });
  return { resolve: gate.resolve, waitUntilReached: reached.promise };
}

const mockResolveStudentSubmission = jest.fn(async () => {
  const next = resolveStudentSubmissionQueue.shift();
  if (next) return next();
  return { submissionId: "submission-1" };
});
const mockPatchStudentSubmissionGrade = jest.fn(async (input: { earnedPoints: number }) => {
  activePatchCalls += 1;
  maxObservedConcurrentPatchCalls = Math.max(maxObservedConcurrentPatchCalls, activePatchCalls);
  try {
    const next = patchStudentSubmissionGradeQueue.shift();
    if (next) {
      await next();
    }
    patchCallOrder.push(input.earnedPoints);
  } finally {
    activePatchCalls -= 1;
  }
});

jest.mock("../providers/registry", () => ({
  getProviderAdapter: () => ({
    resolveStudentSubmission: () => mockResolveStudentSubmission(),
    patchStudentSubmissionGrade: (input: { earnedPoints: number }) =>
      mockPatchStudentSubmissionGrade(input),
  }),
}));

jest.mock("../providers/google-classroom/config-firebase", () => ({
  ensureGoogleClassroomProductionBindings: jest.fn(),
  googleClassroomProductionSecrets: [],
}));

import { synchronizeGradePassback } from "./engine";
import { lmsGradePassbackIdFor } from "../shared/ids";

const ASSIGNMENT_ID = "assign-1";
const STUDENT_ID = "student-1";
const CLASS_ID = "class-1";
const TEACHER_ID = "teacher-1";
const SCHOOL_ID = "school-1";
const DISTRICT_ID = "district-1";
const PUBLICATION_ID = "pub-1";
const CONNECTION_ID = "conn-1";
const LMS_CLASS_ID = "lms-class-1";
const LMS_ASSIGNMENT_ID = "lms-coursework-1";
const GRADE_PASSBACK_ID = lmsGradePassbackIdFor(ASSIGNMENT_ID, STUDENT_ID);
const LEASE_TTL_MS = 5 * 60 * 1000;

function seedFullHappyPath(): void {
  seedDoc("assignments", ASSIGNMENT_ID, {
    classId: CLASS_ID,
    teacherId: TEACHER_ID,
    schoolId: SCHOOL_ID,
    lessonSlug: "lesson_g7_earths-layers",
    mode: "classroom",
    status: "published",
    classroomGrading: { mode: "graded", maxPoints: 20 },
    lmsPublicationRef: PUBLICATION_ID,
  });
  seedDoc("lmsAssignmentPublications", PUBLICATION_ID, {
    assignmentId: ASSIGNMENT_ID,
    classId: CLASS_ID,
    ownerUid: TEACHER_ID,
    schoolId: SCHOOL_ID,
    providerId: "googleClassroom",
    connectionId: CONNECTION_ID,
    lmsClassId: LMS_CLASS_ID,
    status: "succeeded",
    lmsAssignmentId: LMS_ASSIGNMENT_ID,
    classroomGrading: { mode: "graded", maxPoints: 20 },
  });
  seedDoc("lmsConnections", CONNECTION_ID, {
    teacherId: TEACHER_ID,
    schoolId: SCHOOL_ID,
    providerId: "googleClassroom",
    status: "active",
    scopes: [],
    tokenRef: "token-ref-1",
  });
}

let attemptCounter = 0;
function seedAttempt(percentage: number): string {
  attemptCounter += 1;
  const attemptId = `${ASSIGNMENT_ID}__${STUDENT_ID}__a${attemptCounter}`;
  seedDoc("attempts", attemptId, {
    studentId: STUDENT_ID,
    assignmentId: ASSIGNMENT_ID,
    classId: CLASS_ID,
    teacherId: TEACHER_ID,
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
    activityId: "activity-1",
    assessmentId: "assessment-1",
    assessmentRevisionId: "revision-1",
    attemptNumber: attemptCounter,
    score: percentage / 10,
    maxScore: 10,
    percentage,
    responses: [],
    itemResults: [],
    idempotencyKey: `idem-${attemptCounter}`,
    submittedAt: { toMillis: () => 1_000 + attemptCounter },
  });
  return attemptId;
}

function sync(): ReturnType<typeof synchronizeGradePassback> {
  return synchronizeGradePassback({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, districtId: DISTRICT_ID });
}

function expectNonDecreasing(values: readonly number[]): void {
  for (let i = 1; i < values.length; i++) {
    expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  }
}

beforeEach(() => {
  resetHarness();
  attemptCounter = 0;
  activePatchCalls = 0;
  maxObservedConcurrentPatchCalls = 0;
  patchCallOrder.length = 0;
  resolveStudentSubmissionQueue.length = 0;
  patchStudentSubmissionGradeQueue.length = 0;
  mockWriteAuditEvent.mockReset();
  mockWriteAuditEvent.mockResolvedValue({ eventId: "evt-1" });
  mockResolveActiveProviderAccountIdForUser.mockReset();
  mockResolveActiveProviderAccountIdForUser.mockResolvedValue("google-acct-1");
  mockResolveLiveCredential.mockReset();
  mockResolveLiveCredential.mockResolvedValue({
    accessToken: "access-token-1",
    providerId: "googleClassroom",
    teacherId: TEACHER_ID,
  });
  mockResolveStudentSubmission.mockClear();
  mockPatchStudentSubmissionGrade.mockClear();
});

describe("synchronizeGradePassback - concurrency (mandatory proof)", () => {
  it("B arrives while A owns the lease, before A calls resolveStudentSubmission/PATCH at all: B never calls upstream, and A converges to the highest value", async () => {
    seedFullHappyPath();
    seedAttempt(70);

    const paused = queueControlledResolveStudentSubmission();

    const aPromise = sync();
    await paused.waitUntilReached;

    seedAttempt(90);
    const bResult = await sync();
    expect(bResult).toEqual({ outcome: "deferred" });
    expect(mockPatchStudentSubmissionGrade).not.toHaveBeenCalled();

    paused.resolve();
    const aResult = await aPromise;

    expect(aResult).toEqual({ outcome: "synced", earnedPoints: 18 });
    expect(patchCallOrder).toEqual([14, 18]);
    expectNonDecreasing(patchCallOrder);
    expect(maxObservedConcurrentPatchCalls).toBe(1);

    const finalState = readDoc("lmsGradePassbacks", GRADE_PASSBACK_ID);
    expect(finalState?.status).toBe("synced");
    expect(finalState?.lastSyncedEarnedPoints).toBe(18);
  });

  it("B arrives while A's PATCH call is physically in flight: B never calls upstream, and Classroom never observes 90 followed by 14", async () => {
    seedFullHappyPath();
    seedAttempt(70);

    const paused = queueControlledPatch();

    const aPromise = sync();
    await paused.waitUntilReached;

    seedAttempt(90);
    const bResult = await sync();
    expect(bResult).toEqual({ outcome: "deferred" });
    // At this instant A's first PATCH call is in flight (value 14) and is
    // the ONLY call in flight - proving mutual exclusion at the moment B
    // observed the held lease.
    expect(activePatchCalls).toBe(1);

    paused.resolve();
    const aResult = await aPromise;

    expect(aResult).toEqual({ outcome: "synced", earnedPoints: 18 });
    expect(patchCallOrder).toEqual([14, 18]);
    expect(maxObservedConcurrentPatchCalls).toBe(1);
  });

  it("B arrives after A's upstream PATCH already succeeded but before A's local success persistence commits: B still cannot call upstream, and A itself sends the newer value before releasing authority", async () => {
    seedFullHappyPath();
    seedAttempt(70);

    // Call #1 = A's phase1 (advance+acquire). Call #2 = A's
    // reconcile-after-success transaction, for the first PATCH (value 14).
    // Freeze call #2 BEFORE it runs - i.e. after A's upstream PATCH(14) has
    // already resolved, but before that success is durably persisted.
    const reconcileGate = pauseRunTxCall(2);

    const aPromise = sync();
    // Deterministically wait until A has run through phase1,
    // resolveStudentSubmission, and the first PATCH(14) call, and has
    // reached (but not yet executed) the paused reconcile transaction.
    await reconcileGate.waitUntilReached;

    expect(patchCallOrder).toEqual([14]);

    seedAttempt(90);
    const bResult = await sync();
    expect(bResult).toEqual({ outcome: "deferred" });
    // B could not have called Classroom: the lease, from Firestore's own
    // point of view, is still held (A's release has not committed).
    expect(patchCallOrder).toEqual([14]);

    reconcileGate.resolve();
    const aResult = await aPromise;

    expect(aResult).toEqual({ outcome: "synced", earnedPoints: 18 });
    expect(patchCallOrder).toEqual([14, 18]);
    expectNonDecreasing(patchCallOrder);

    const finalState = readDoc("lmsGradePassbacks", GRADE_PASSBACK_ID);
    expect(finalState?.status).toBe("synced");
    expect(finalState?.lastSyncedEarnedPoints).toBe(18);
  });

  it("an expired lease from a genuinely stuck worker is reclaimed by a second worker; the stale worker's late completion is silently ignored and never regains authority", async () => {
    seedFullHappyPath();
    seedAttempt(80);

    // A acquires the lease, then hangs forever inside resolveStudentSubmission
    // (simulating a crashed/killed worker instance).
    const stuck = queueControlledResolveStudentSubmission();

    const aPromise = sync();
    await stuck.waitUntilReached;

    // A holds the lease but has made no upstream call yet.
    expect(patchCallOrder).toEqual([]);

    // Time passes well beyond the lease TTL.
    mockNowMs += LEASE_TTL_MS + 1000;

    const bResult = await sync();
    expect(bResult).toEqual({ outcome: "synced", earnedPoints: 16 });
    expect(patchCallOrder).toEqual([16]);

    // The stale worker A finally "wakes up" long after losing authority.
    stuck.resolve();
    const aResult = await aPromise;
    expect(aResult).toEqual({
      outcome: "failed",
      errorCode: "gradePassback.lostLeaseAuthority",
    });

    // A's late arrival never overwrote B's success, and never re-issued a
    // second (redundant or stale) PATCH of its own.
    expect(patchCallOrder).toEqual([16]);
    const finalState = readDoc("lmsGradePassbacks", GRADE_PASSBACK_ID);
    expect(finalState?.status).toBe("synced");
    expect(finalState?.lastSyncedEarnedPoints).toBe(16);
    expect(finalState?.leaseOwnerToken).toBeUndefined();
  });

  it("two simultaneous manual retries for the same unchanged state converge without double-PATCHing", async () => {
    seedFullHappyPath();
    seedAttempt(80);

    const [r1, r2] = await Promise.all([sync(), sync()]);
    const outcomes = [r1.outcome, r2.outcome].sort();
    // Exactly one of the two concurrent calls actually reaches "synced" by
    // performing the PATCH; the other either defers to it or (if it runs
    // strictly after) finds the state already synced. Both are safe,
    // product-correct outcomes; what must never happen is two upstream
    // PATCH calls for the same unchanged desired value.
    expect(outcomes.every((o) => o === "synced" || o === "deferred" || o === "alreadySynced")).toBe(
      true,
    );
    expect(mockPatchStudentSubmissionGrade).toHaveBeenCalledTimes(1);
    expect(maxObservedConcurrentPatchCalls).toBe(1);

    const finalState = readDoc("lmsGradePassbacks", GRADE_PASSBACK_ID);
    expect(finalState?.status).toBe("synced");
    expect(finalState?.lastSyncedEarnedPoints).toBe(16);
  });

  it("a finalize-triggered sync and a manual retry racing concurrently for a newly-higher attempt converge on the higher value with a well-ordered PATCH sequence", async () => {
    seedFullHappyPath();
    seedAttempt(70);
    // Establish an initial synced baseline first (simulating the teacher's
    // retry racing against a SECOND, later finalize rather than the very
    // first one).
    await sync();
    expect(patchCallOrder).toEqual([14]);

    seedAttempt(95);
    // "Finalize" and "manual retry" are, at the engine level, indistinguishable
    // concurrent calls to the exact same synchronizer.
    const [finalizeResult, retryResult] = await Promise.all([sync(), sync()]);
    const outcomes = [finalizeResult.outcome, retryResult.outcome].sort();
    expect(outcomes.every((o) => o === "synced" || o === "deferred" || o === "alreadySynced")).toBe(
      true,
    );

    expectNonDecreasing(patchCallOrder);
    expect(patchCallOrder[patchCallOrder.length - 1]).toBe(19);
    expect(maxObservedConcurrentPatchCalls).toBe(1);

    const finalState = readDoc("lmsGradePassbacks", GRADE_PASSBACK_ID);
    expect(finalState?.status).toBe("synced");
    expect(finalState?.lastSyncedEarnedPoints).toBe(19);
  });

  it("out-of-order evaluator invocation still converges upward: a slower worker that started before a newer attempt existed still recomputes fresh and never regresses the grade", async () => {
    seedFullHappyPath();
    seedAttempt(70);
    seedAttempt(90);

    // Freeze A's phase1 transaction (call #1) before it runs any reads at
    // all, so A is logically "initiated first" but physically executes
    // last.
    const gate = pauseRunTxCall(1);
    const aPromise = sync();

    // B is unaffected by A's pause (different call index) and runs to
    // completion first, syncing the current best (90 -> 18).
    const bResult = await sync();
    expect(bResult).toEqual({ outcome: "synced", earnedPoints: 18 });
    expect(patchCallOrder).toEqual([18]);

    // Now let the "earlier-initiated" A finally execute. Because it always
    // recomputes fully fresh rather than trusting any stale in-memory
    // view, it correctly finds nothing left to do.
    gate.resolve();
    const aResult = await aPromise;
    expect(aResult).toEqual({ outcome: "alreadySynced" });

    // A never called Classroom at all, and certainly never with a lower
    // value than what B already confirmed.
    expect(patchCallOrder).toEqual([18]);
  });
});
