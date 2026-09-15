/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, no-useless-catch */
//
// Sprint 30A.2 - Google Classroom best-score grade-passback synchronization
// engine tests.
//
// Uses a tightly-simulated, in-memory, multi-collection Firestore
// transaction harness that models the SAME retry-on-conflict contract
// `Firestore.runTransaction` implements: reads track per-document
// versions, commits verify nothing observed during the transaction has
// moved, and observed motion forces the runTransaction wrapper to retry
// the callback. This generalizes the harness proven in
// `shared/identity/external-identity-store.concurrency.test.ts` to the
// five collections this engine touches. Harness functions are declared
// with `function` (not `const`) so they may be referenced inside
// `jest.mock` factories per Jest's hoisting rule (function declarations
// are fully hoisted; the harness code is duplicated into
// `engine.concurrency.test.ts` rather than shared, matching the
// established single-file precedent - Jest test files do not share
// module state across files in any case).

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

function allDocs(collectionName: string): readonly Row[] {
  return Array.from(coll(collectionName).values());
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
  pending: {
    collectionName: string;
    id: string;
    data: Record<string, any>;
    merge: boolean;
  }[];
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

async function runTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
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
const mockLogWarn = jest.fn();

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
    log: { info: jest.fn(), warn: (...args: unknown[]) => mockLogWarn(...args), error: jest.fn() },
    writeAuditEvent: (...args: unknown[]) => mockWriteAuditEvent(...args),
    resolveActiveProviderAccountIdForUser: (...args: unknown[]) =>
      mockResolveActiveProviderAccountIdForUser(...args),
    runFirestoreTransaction: (fn: any) => runTx(fn),
    assignmentDocRef: (id: string) => makeDocRef("assignments", id),
    attemptsCollectionRef: () => makeQueryRef("attempts"),
    lmsAssignmentPublicationDocRef: (id: string) => makeDocRef("lmsAssignmentPublications", id),
    lmsConnectionDocRef: (id: string) => makeDocRef("lmsConnections", id),
    lmsGradePassbackDocRef: (id: string) => makeDocRef("lmsGradePassbacks", id),
  };
});

const mockResolveLiveCredential = jest.fn();
jest.mock("../tokens/credential-resolver", () => ({
  resolveLiveCredential: (...args: unknown[]) => mockResolveLiveCredential(...args),
}));

const mockResolveStudentSubmission = jest.fn();
const mockPatchStudentSubmissionGrade = jest.fn();
jest.mock("../providers/registry", () => ({
  getProviderAdapter: () => ({
    resolveStudentSubmission: (...args: unknown[]) => mockResolveStudentSubmission(...args),
    patchStudentSubmissionGrade: (...args: unknown[]) => mockPatchStudentSubmissionGrade(...args),
  }),
}));

jest.mock("../providers/google-classroom/config-firebase", () => ({
  ensureGoogleClassroomProductionBindings: jest.fn(),
  googleClassroomProductionSecrets: [],
}));

import { synchronizeGradePassback } from "./engine";
import { lmsGradePassbackIdFor } from "../shared/ids";
import { PlatformError as RealPlatformError } from "../../shared/errors/platform-error";

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

function seedGradedAssignment(overrides: Record<string, unknown> = {}): void {
  seedDoc("assignments", ASSIGNMENT_ID, {
    classId: CLASS_ID,
    teacherId: TEACHER_ID,
    schoolId: SCHOOL_ID,
    lessonSlug: "lesson_g7_earths-layers",
    mode: "classroom",
    status: "published",
    classroomGrading: { mode: "graded", maxPoints: 20 },
    lmsPublicationRef: PUBLICATION_ID,
    ...overrides,
  });
}

function seedSucceededPublication(overrides: Record<string, unknown> = {}): void {
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
    ...overrides,
  });
}

function seedActiveConnection(overrides: Record<string, unknown> = {}): void {
  seedDoc("lmsConnections", CONNECTION_ID, {
    teacherId: TEACHER_ID,
    schoolId: SCHOOL_ID,
    providerId: "googleClassroom",
    status: "active",
    scopes: [],
    tokenRef: "token-ref-1",
    ...overrides,
  });
}

let attemptCounter = 0;
function seedAttempt(input: {
  percentage: number;
  score?: number;
  maxScore?: number;
  attemptNumber?: number;
  submittedAtMs?: number;
}): string {
  attemptCounter += 1;
  const attemptNumber = input.attemptNumber ?? attemptCounter;
  const attemptId = `${ASSIGNMENT_ID}__${STUDENT_ID}__a${attemptNumber}`;
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
    attemptNumber,
    score: input.score ?? input.percentage / 10,
    maxScore: input.maxScore ?? 10,
    percentage: input.percentage,
    responses: [],
    itemResults: [],
    idempotencyKey: `idem-${attemptNumber}`,
    submittedAt: { toMillis: () => input.submittedAtMs ?? 1_000 + attemptNumber },
  });
  return attemptId;
}

function seedFullHappyPath(): void {
  seedGradedAssignment();
  seedSucceededPublication();
  seedActiveConnection();
}

beforeEach(() => {
  resetHarness();
  attemptCounter = 0;
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
  mockResolveStudentSubmission.mockReset();
  mockResolveStudentSubmission.mockResolvedValue({ submissionId: "submission-1" });
  mockPatchStudentSubmissionGrade.mockReset();
  mockPatchStudentSubmissionGrade.mockResolvedValue(undefined);
});

describe("synchronizeGradePassback - eligibility", () => {
  it("no-ops for an ungraded assignment before ever calling Classroom", async () => {
    seedGradedAssignment({ classroomGrading: { mode: "ungraded" } });
    seedSucceededPublication();
    seedActiveConnection();
    seedAttempt({ percentage: 80 });

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({ outcome: "notApplicable" });
    expect(mockResolveStudentSubmission).not.toHaveBeenCalled();
    expect(mockPatchStudentSubmissionGrade).not.toHaveBeenCalled();
    expect(readDoc("lmsGradePassbacks", GRADE_PASSBACK_ID)).toBeUndefined();
  });

  it("no-ops for a legacy assignment with no classroomGrading field at all", async () => {
    seedGradedAssignment({ classroomGrading: undefined });
    seedSucceededPublication();
    seedActiveConnection();
    seedAttempt({ percentage: 80 });

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({ outcome: "notApplicable" });
    expect(mockPatchStudentSubmissionGrade).not.toHaveBeenCalled();
  });

  it("no-ops safely when the assignment has no successful publication (never published)", async () => {
    seedGradedAssignment({ lmsPublicationRef: undefined });
    seedAttempt({ percentage: 80 });

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({ outcome: "noPublication" });
    expect(mockPatchStudentSubmissionGrade).not.toHaveBeenCalled();
  });

  it("fails safely when the referenced publication is a failed record, not succeeded", async () => {
    seedGradedAssignment();
    seedSucceededPublication({ status: "failed" });
    seedAttempt({ percentage: 80 });

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({ outcome: "noPublication" });
  });

  it("fails safely when the publication's grading snapshot is mismatched/invalid", async () => {
    seedGradedAssignment();
    seedSucceededPublication({ classroomGrading: { mode: "ungraded" } });
    seedAttempt({ percentage: 80 });

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({ outcome: "noPublication" });
  });

  it("no-ops when the assignment does not exist", async () => {
    const result = await synchronizeGradePassback({
      assignmentId: "does-not-exist",
      studentId: STUDENT_ID,
    });
    expect(result).toEqual({ outcome: "notApplicable" });
  });

  it("no-ops when no valid attempt exists yet for this student", async () => {
    seedFullHappyPath();
    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });
    expect(result).toEqual({ outcome: "noAttempts" });
    expect(mockPatchStudentSubmissionGrade).not.toHaveBeenCalled();
  });
});

describe("synchronizeGradePassback - basic progression and the required exemplar", () => {
  it("syncs the first attempt", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 70 });

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({ outcome: "synced", earnedPoints: 14 });
    expect(mockPatchStudentSubmissionGrade).toHaveBeenCalledTimes(1);
    expect(mockPatchStudentSubmissionGrade).toHaveBeenCalledWith(
      expect.objectContaining({ earnedPoints: 14, submissionId: "submission-1" }),
    );
  });

  it("a higher later attempt updates upward", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 70 });
    await synchronizeGradePassback({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID });

    seedAttempt({ percentage: 90 });
    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({ outcome: "synced", earnedPoints: 18 });
    expect(mockPatchStudentSubmissionGrade).toHaveBeenCalledTimes(2);
  });

  it("required exemplar: 7/10 -> 14/20, then 9/10 -> 18/20, then 8/10 -> Classroom remains 18/20, all attempts preserved", async () => {
    seedFullHappyPath();

    seedAttempt({ percentage: 70, score: 7, maxScore: 10 });
    const r1 = await synchronizeGradePassback({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID });
    expect(r1).toEqual({ outcome: "synced", earnedPoints: 14 });

    seedAttempt({ percentage: 90, score: 9, maxScore: 10 });
    const r2 = await synchronizeGradePassback({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID });
    expect(r2).toEqual({ outcome: "synced", earnedPoints: 18 });

    seedAttempt({ percentage: 80, score: 8, maxScore: 10 });
    const r3 = await synchronizeGradePassback({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID });
    // A lower later attempt must never lower the Classroom grade, and must
    // not even cause a redundant PATCH call since the desired value did not
    // advance.
    expect(r3).toEqual({ outcome: "alreadySynced" });

    expect(mockPatchStudentSubmissionGrade).toHaveBeenCalledTimes(2);
    expect(mockPatchStudentSubmissionGrade.mock.calls.map((c) => c[0].earnedPoints)).toEqual([
      14, 18,
    ]);

    // All three LyfeLabz attempts remain preserved (append-only).
    expect(allDocs("attempts")).toHaveLength(3);

    const finalState = readDoc("lmsGradePassbacks", GRADE_PASSBACK_ID);
    expect(finalState?.status).toBe("synced");
    expect(finalState?.desiredEarnedPoints).toBe(18);
    expect(finalState?.lastSyncedEarnedPoints).toBe(18);
  });

  it("equal later performance causes no additional PATCH call", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 80 });
    await synchronizeGradePassback({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID });
    seedAttempt({ percentage: 80 });
    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });
    expect(result).toEqual({ outcome: "alreadySynced" });
    expect(mockPatchStudentSubmissionGrade).toHaveBeenCalledTimes(1);
  });

  it("re-invoking after a synced state with no new attempt is a safe no-op", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 80 });
    await synchronizeGradePassback({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID });
    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });
    expect(result).toEqual({ outcome: "alreadySynced" });
    expect(mockPatchStudentSubmissionGrade).toHaveBeenCalledTimes(1);
  });
});

describe("synchronizeGradePassback - failure handling", () => {
  it("reports a bounded failure when listing/resolving the submission fails, and never damages the attempt record", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 80 });
    mockResolveStudentSubmission.mockRejectedValue(
      new RealPlatformError("lms.upstreamTemporarilyUnavailable", "boom"),
    );

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({
      outcome: "failed",
      errorCode: "lms.upstreamTemporarilyUnavailable",
    });
    expect(allDocs("attempts")).toHaveLength(1);
    const state = readDoc("lmsGradePassbacks", GRADE_PASSBACK_ID);
    expect(state?.status).toBe("failed");
    expect(state?.leaseOwnerToken).toBeUndefined();
  });

  it("reports a bounded failure when the grade PATCH itself fails", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 80 });
    mockPatchStudentSubmissionGrade.mockRejectedValue(
      new RealPlatformError("lms.upstreamCallFailed", "boom"),
    );

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({ outcome: "failed", errorCode: "lms.upstreamCallFailed" });
  });

  it("reports a bounded failure on a token/OAuth error", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 80 });
    mockResolveLiveCredential.mockRejectedValue(
      new RealPlatformError("lms.reconnectRequired", "boom"),
    );

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({ outcome: "failed", errorCode: "lms.reconnectRequired" });
  });

  it("handles zero submission results safely (student never opened Classroom)", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 80 });
    mockResolveStudentSubmission.mockResolvedValue(null);

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({
      outcome: "failed",
      errorCode: "gradePassback.submissionNotFound",
    });
    expect(mockPatchStudentSubmissionGrade).not.toHaveBeenCalled();
  });

  it("retry after a failure resends the current best value, never a stale lower one", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 70 });
    mockPatchStudentSubmissionGrade.mockRejectedValueOnce(
      new RealPlatformError("lms.upstreamTemporarilyUnavailable", "boom"),
    );
    const first = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });
    expect(first).toEqual({ outcome: "failed", errorCode: "lms.upstreamTemporarilyUnavailable" });

    // A higher attempt lands before the retry.
    seedAttempt({ percentage: 90 });
    const retry = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });
    expect(retry).toEqual({ outcome: "synced", earnedPoints: 18 });
    expect(mockPatchStudentSubmissionGrade).toHaveBeenLastCalledWith(
      expect.objectContaining({ earnedPoints: 18 }),
    );
  });

  it("a stuck lease is reclaimable after it expires, and the reclaiming worker still syncs the current best value", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 80 });

    // Simulate a crashed prior worker that acquired the lease and never
    // released it (e.g. the process was killed mid-flight).
    seedDoc("lmsGradePassbacks", GRADE_PASSBACK_ID, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      ownerUid: TEACHER_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      providerId: "googleClassroom",
      connectionId: CONNECTION_ID,
      lmsClassId: LMS_CLASS_ID,
      lmsAssignmentId: LMS_ASSIGNMENT_ID,
      lmsPublicationRef: PUBLICATION_ID,
      maxPoints: 20,
      desiredBestPercentage: 80,
      desiredEarnedPoints: 16,
      bestAttemptId: "stale-attempt",
      syncGeneration: 1,
      lastSyncedGeneration: 0,
      status: "syncing",
      leaseOwnerToken: "stale-crashed-worker-token",
      leaseGeneration: 1,
      leaseExpiresAt: mockTimestampClassImpl.fromMillis(mockNowMs - 1),
    });

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({ outcome: "synced", earnedPoints: 16 });
    const finalState = readDoc("lmsGradePassbacks", GRADE_PASSBACK_ID);
    expect(finalState?.leaseOwnerToken).toBeUndefined();
    expect(finalState?.status).toBe("synced");
  });
});

describe("synchronizeGradePassback - identity and privacy", () => {
  it("never writes the raw provider account id into the passback state", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 80 });
    mockResolveActiveProviderAccountIdForUser.mockResolvedValue(
      "raw-google-sub-should-never-be-stored-000111222",
    );

    await synchronizeGradePassback({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID });

    const state = readDoc("lmsGradePassbacks", GRADE_PASSBACK_ID);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("raw-google-sub-should-never-be-stored");
  });

  it("fails safely when the student's identity cannot be resolved", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 80 });
    mockResolveActiveProviderAccountIdForUser.mockResolvedValue(null);

    const result = await synchronizeGradePassback({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
    });

    expect(result).toEqual({
      outcome: "failed",
      errorCode: "gradePassback.studentIdentityUnresolved",
    });
    expect(mockPatchStudentSubmissionGrade).not.toHaveBeenCalled();
  });

  it("audit events never carry a raw provider account id or answer-key content", async () => {
    seedFullHappyPath();
    seedAttempt({ percentage: 80 });
    await synchronizeGradePassback({ assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID });

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    const payload = mockWriteAuditEvent.mock.calls[0][0].payload;
    expect(JSON.stringify(payload)).not.toMatch(/google-acct|submission-1/);
  });
});
