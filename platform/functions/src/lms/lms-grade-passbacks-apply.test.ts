// Callable tests for lmsGradePassbacksApply (teacher-confirmed Classroom
// grade reconciliation). Firestore refs, occurrence grouping, roster
// readers, identity resolution, the token store, and the provider adapter
// are mocked; the canonical cumulative-best selection, grade calculation,
// and write decision run for real. The grade-passback engine (proven in
// engine.test.ts / engine.concurrency.test.ts) is replaced by a faithful
// stand-in that re-reads the simulated Classroom gradebook and applies the
// REAL canonical decision before "writing", so preview -> apply -> re-apply
// behaves end to end. Every identifier is fictional.

import type { CallableRequest } from "firebase-functions/v2/https";

import type { AssessmentAttemptRecord } from "../shared";
import {
  WRITE_ACTIONS,
  cumulativeTargetFor,
  decideGradeAction,
} from "./grade-passback/reconciliation-plan";

const mockAssertTeacher = jest.fn();
const mockClassGet = jest.fn();
const mockPublicationGet = jest.fn();
const mockConnectionGet = jest.fn();
const mockUserGet = jest.fn();
const mockAttemptsQuery = jest.fn();
const mockResolveAccount = jest.fn();
const mockResolveGroup = jest.fn();
const mockRecipients = jest.fn();
const mockEnrolled = jest.fn();
const mockGetLmsTokenStore = jest.fn();
const mockFetchAssignment = jest.fn();
const mockListSubmissionGrades = jest.fn();
const mockSynchronizeGradePassback = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockFirestoreWrite = jest.fn();
const mockAdapterWrite = jest.fn();

function mockReadOnlyRef(get: jest.Mock) {
  return {
    get,
    set: mockFirestoreWrite,
    update: mockFirestoreWrite,
    create: mockFirestoreWrite,
    delete: mockFirestoreWrite,
  };
}

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(_options: unknown, handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  return {
    platformCallable: (optionsOrHandler: unknown, maybeHandler: unknown) =>
      typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler,
    PlatformError,
    roundHalfToEven2: jest.requireActual("../shared/math/round-half-to-even").roundHalfToEven2,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    writeAuditEvent: (...args: unknown[]) => mockWriteAuditEvent(...args),
    classDocRef: jest.fn(() => mockReadOnlyRef(mockClassGet)),
    lmsAssignmentPublicationDocRef: jest.fn((id: string) =>
      mockReadOnlyRef(jest.fn(() => mockPublicationGet(id))),
    ),
    lmsConnectionDocRef: jest.fn(() => mockReadOnlyRef(mockConnectionGet)),
    userRecordDocRef: jest.fn((uid: string) => mockReadOnlyRef(jest.fn(() => mockUserGet(uid)))),
    attemptsCollectionRef: jest.fn(() => ({
      add: mockFirestoreWrite,
      doc: mockFirestoreWrite,
      where: (field: string, op: string, value: string) => ({
        get: () => mockAttemptsQuery(field, op, value),
      }),
    })),
    resolveActiveProviderAccountIdForUser: (...args: unknown[]) => mockResolveAccount(...args),
  };
});

jest.mock("../assignments/current-occurrence-group", () => ({
  createClassAssignmentsLoader: () => jest.fn(),
  resolveCurrentOccurrenceGroup: (...args: unknown[]) => mockResolveGroup(...args),
}));

jest.mock("../assignments/assignment-recipients", () => ({
  loadExistingRecipientStudentIds: (...args: unknown[]) => mockRecipients(...args),
  loadActiveEnrolledStudentIds: (...args: unknown[]) => mockEnrolled(...args),
}));

jest.mock("./providers/google-classroom/config-firebase", () => ({
  ensureGoogleClassroomProductionBindings: jest.fn(),
  googleClassroomProductionSecrets: [],
}));

jest.mock("./shared/actor", () => {
  const actual = jest.requireActual("./shared/actor");
  return {
    assertAuthenticatedTeacherForLms: mockAssertTeacher,
    requireNonEmptyString: actual.requireNonEmptyString,
  };
});

jest.mock("./tokens/token-store", () => ({
  getLmsTokenStore: mockGetLmsTokenStore,
}));

jest.mock("./providers/registry", () => ({
  getProviderAdapter: () => ({
    fetchAssignment: mockFetchAssignment,
    listSubmissionGrades: mockListSubmissionGrades,
    refreshCredential: mockAdapterWrite,
    publishAssignment: mockAdapterWrite,
    patchStudentSubmissionGrade: mockAdapterWrite,
    resolveStudentSubmission: mockAdapterWrite,
    revokeGrant: mockAdapterWrite,
  }),
}));

jest.mock("./grade-passback/engine", () => ({
  synchronizeGradePassback: (...args: unknown[]) => mockSynchronizeGradePassback(...args),
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __lmsGradePassbacksApplyHandler } from "./lms-grade-passbacks-apply";
import { __lmsGradePassbacksPreviewHandler } from "./lms-grade-passbacks-preview";

const TEACHER = "fixture-teacher-uid";
const SCHOOL = "fixture-school";
const DISTRICT = "fixture-district";
const CLASS_ID = "fixture-class-a";
const LESSON = "fixture-lesson";
const LMS_CLASS = "fixture-lms-course";
const CONNECTION = "fixture-connection";
const ACCESS_TOKEN = "fixture-access-token-live";
const CW_CURRENT = "cw-a4";
const EXPECTED = { currentAssignmentId: "a4", lmsAssignmentId: CW_CURRENT, maxPoints: 20 };

function ts(ms: number) {
  return { toDate: () => new Date(ms), toMillis: () => ms };
}

function occurrence(assignmentId: string, grading: Record<string, unknown>) {
  return {
    assignmentId,
    record: {
      classId: CLASS_ID,
      lessonSlug: LESSON,
      teacherId: TEACHER,
      schoolId: SCHOOL,
      status: "published",
      mode: "classroom",
      createdAt: ts(1),
      lmsPublicationRef: `${assignmentId}__pub`,
      classroomGrading: grading,
    },
  };
}
const A2 = occurrence("a2", { mode: "graded", maxPoints: 10 });
const A3 = occurrence("a3", { mode: "ungraded" });
const A4 = occurrence("a4", { mode: "graded", maxPoints: 20 });

type Grade = {
  assignedGrade: number | null;
  draftGrade: number | null;
  state: "new" | "created" | "turnedIn" | "returned" | "reclaimed" | "other";
  late: boolean;
};

let attemptsByAssignment: Record<string, { id: string; data: Record<string, unknown> }[]>;
let roster: string[];
let accounts: Record<string, string | null>;
// Simulated live Classroom gradebook for the Current coursework, by account.
let gradebook: Map<string, Grade>;
let liveCoursework: Record<string, unknown>;
// Per-student override of the stand-in engine (e.g. a write failure).
let engineOverrides: Map<string, () => unknown>;
// Hook to mutate Classroom between the apply's candidate evaluation and the
// engine's own fresh re-read (a change "during" apply).
let beforeEngine: ((studentId: string) => void) | undefined;

function attemptOn(assignmentId: string, studentId: string, percentage: number, attemptNumber = 1) {
  (attemptsByAssignment[assignmentId] ??= []).push({
    id: `${assignmentId}__${studentId}__a${attemptNumber}`,
    data: {
      assignmentId,
      studentId,
      classId: CLASS_ID,
      schoolId: SCHOOL,
      teacherId: TEACHER,
      districtId: DISTRICT,
      percentage,
      score: percentage / 10,
      maxScore: 10,
      attemptNumber,
      submittedAt: ts(attemptNumber * 1000),
    },
  });
}

function student(id: string, grade: Partial<Grade> = {}): void {
  roster.push(id);
  accounts[id] = `acct-${id}`;
  gradebook.set(`acct-${id}`, {
    assignedGrade: null,
    draftGrade: null,
    state: "created",
    late: false,
    ...grade,
  });
}

function allAttemptsFor(studentId: string) {
  return Object.values(attemptsByAssignment)
    .flat()
    .filter((a) => a.data.studentId === studentId)
    .map((a) => ({ id: a.id, data: a.data as unknown as AssessmentAttemptRecord }));
}

// Stand-in for the grade-passback engine under a teacher trigger: fresh
// re-read, REAL canonical decision, write only when permitted.
function standInEngine(input: {
  assignmentId: string;
  studentId: string;
  trigger?: string;
  expectedDestination?: { assignmentId: string; lmsAssignmentId: string; maxPoints: number };
}) {
  beforeEngine?.(input.studentId);
  const override = engineOverrides.get(input.studentId);
  if (override) return Promise.resolve(override());
  const account = accounts[input.studentId];
  const sub = account ? gradebook.get(account) : undefined;
  const target = cumulativeTargetFor(allAttemptsFor(input.studentId), 20);
  if (!sub || !target) return Promise.resolve({ outcome: "failed", errorCode: "gradePassback.submissionNotFound" });
  const decision = decideGradeAction(target.targetPoints, sub);
  if (WRITE_ACTIONS.has(decision.action)) {
    gradebook.set(account as string, {
      ...sub,
      assignedGrade: target.targetPoints,
      draftGrade: target.targetPoints,
    });
    return Promise.resolve({ outcome: "synced", earnedPoints: target.targetPoints, action: decision.action });
  }
  return Promise.resolve(
    decision.action === "alreadyEqual" || decision.action === "preservedClassroomHigher"
      ? { outcome: "noChange", action: decision.action }
      : { outcome: "protected", action: decision.action },
  );
}

function request(data: unknown) {
  return {
    auth: { uid: TEACHER, token: { role: "teacher" } },
    data,
    rawRequest: {},
  } as unknown as CallableRequest<unknown>;
}
const apply = (extra: Record<string, unknown> = {}) =>
  __lmsGradePassbacksApplyHandler(
    request({ classId: CLASS_ID, lessonSlug: LESSON, expected: EXPECTED, ...extra }),
  );
const preview = () =>
  __lmsGradePassbacksPreviewHandler(request({ classId: CLASS_ID, lessonSlug: LESSON }));

beforeEach(() => {
  jest.clearAllMocks();
  attemptsByAssignment = {};
  roster = [];
  accounts = {};
  gradebook = new Map();
  engineOverrides = new Map();
  beforeEngine = undefined;
  liveCoursework = { lmsAssignmentId: CW_CURRENT, title: "Fictional Lesson", state: "published", maxPoints: 20 };
  mockAssertTeacher.mockResolvedValue({ uid: TEACHER, schoolId: SCHOOL, districtId: DISTRICT });
  mockClassGet.mockResolvedValue({ exists: true, data: () => ({ teacherId: TEACHER, schoolId: SCHOOL }) });
  mockResolveGroup.mockResolvedValue({
    resolution: "valid",
    currentAssignmentId: "a4",
    current: A4,
    occurrences: [A2, A3, A4],
  });
  const publications: Record<string, Record<string, unknown>> = {};
  for (const [id, grading] of [
    ["a2", { mode: "graded", maxPoints: 10 }],
    ["a3", { mode: "ungraded" }],
    ["a4", { mode: "graded", maxPoints: 20 }],
  ] as const) {
    publications[`${id}__pub`] = {
      assignmentId: id,
      classId: CLASS_ID,
      ownerUid: TEACHER,
      schoolId: SCHOOL,
      providerId: "googleClassroom",
      connectionId: CONNECTION,
      lmsClassId: LMS_CLASS,
      status: "succeeded",
      lmsAssignmentId: `cw-${id}`,
      classroomGrading: grading,
    };
  }
  mockPublicationGet.mockImplementation((id: string) =>
    Promise.resolve({ exists: publications[id] !== undefined, data: () => publications[id] }),
  );
  mockConnectionGet.mockResolvedValue({
    exists: true,
    data: () => ({ teacherId: TEACHER, status: "active", providerId: "googleClassroom", tokenRef: "fixture-token-ref" }),
  });
  mockUserGet.mockImplementation((uid: string) =>
    Promise.resolve({ exists: true, data: () => ({ displayName: `Student ${uid}` }) }),
  );
  mockAttemptsQuery.mockImplementation((_f: string, _o: string, value: string) =>
    Promise.resolve({ docs: (attemptsByAssignment[value] ?? []).map((a) => ({ id: a.id, data: () => a.data })) }),
  );
  mockRecipients.mockImplementation(() => Promise.resolve(new Set(roster)));
  mockEnrolled.mockImplementation(() => Promise.resolve(new Set(roster)));
  mockResolveAccount.mockImplementation((id: string) => Promise.resolve(accounts[id] ?? null));
  mockGetLmsTokenStore.mockReturnValue({
    resolve: jest.fn().mockResolvedValue({
      providerId: "googleClassroom",
      teacherId: TEACHER,
      accessToken: ACCESS_TOKEN,
      refreshToken: "fixture-refresh",
      scopes: [],
      expiresAtEpochMs: Date.now() + 3600 * 1000,
      upstreamAccountIdentifier: "x",
    }),
    persistRefreshedCredential: jest.fn(),
  });
  mockFetchAssignment.mockImplementation(() => Promise.resolve(liveCoursework));
  mockListSubmissionGrades.mockImplementation(() =>
    Promise.resolve(
      [...gradebook.entries()].map(([account, g]) => ({
        submissionId: `sub-${account}`,
        studentProviderAccountId: account,
        ...g,
      })),
    ),
  );
  mockSynchronizeGradePassback.mockImplementation(standInEngine);
  mockWriteAuditEvent.mockResolvedValue({ eventId: "evt" });
});

afterEach(() => {
  // Apply never writes Firestore business records or calls the Classroom
  // write API itself; every write goes through the engine.
  expect(mockFirestoreWrite).not.toHaveBeenCalled();
  expect(mockAdapterWrite).not.toHaveBeenCalled();
});

// The production (A) Science pattern, with fictional identities.
function seedProductionPattern(): void {
  // 4 already equal on Current (/20).
  for (const [id, pct] of [["eq1", 100], ["eq2", 100], ["eq3", 100], ["eq4", 90]] as const) {
    student(id, { assignedGrade: pct / 5, draftGrade: pct / 5, late: true });
    attemptOn("a4", id, pct);
  }
  // 1 blank with a valid attempt (on an older occurrence), turned in late.
  student("blank", { state: "turnedIn", late: true });
  attemptOn("a2", "blank", 40);
  // 1 lower than the cumulative best: 80% on Current, 90% on older /10.
  student("lower", { assignedGrade: 16, draftGrade: 16, late: true });
  attemptOn("a4", "lower", 80);
  attemptOn("a2", "lower", 90);
  // 9 missing-work draft zeros with positive completed attempts.
  const zeroPcts = [80, 100, 90, 70, 90, 100, 100, 80, 100];
  zeroPcts.forEach((pct, i) => {
    student(`zero${i}`, { draftGrade: 0, state: "created", late: true });
    attemptOn("a2", `zero${i}`, pct);
  });
  // 5 with no completed attempt (3 missing-work zeros, 2 turned in blank).
  for (const id of ["none0", "none1", "none2"]) student(id, { draftGrade: 0, late: true });
  for (const id of ["none3", "none4"]) student(id, { state: "turnedIn" });
}

describe("lmsGradePassbacksApply authorization and request shape", () => {
  it("rejects an unauthenticated caller", async () => {
    mockAssertTeacher.mockRejectedValueOnce(new PlatformError("lms.unauthenticated", "no"));
    await expect(apply()).rejects.toMatchObject({ code: "lms.unauthenticated" });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("rejects a teacher who does not own the class, and a class in another school", async () => {
    mockClassGet.mockResolvedValueOnce({ exists: true, data: () => ({ teacherId: "other", schoolId: SCHOOL }) });
    await expect(apply()).rejects.toMatchObject({ code: "lms.forbidden" });
    mockClassGet.mockResolvedValueOnce({ exists: true, data: () => ({ teacherId: TEACHER, schoolId: "other" }) });
    await expect(apply()).rejects.toMatchObject({ code: "lms.forbidden" });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it.each([
    [{ lmsAssignmentId: "foreign-coursework" }],
    [{ lmsClassId: "foreign-course" }],
    [{ grades: { s1: 20 } }],
    [{ proposedPoints: 20 }],
    [{ maxPoints: 100 }],
    [{ expected: { ...EXPECTED, earnedPoints: 20 } }],
    [{ expected: undefined }],
    [{ expected: { ...EXPECTED, maxPoints: "20" } }],
    [{ studentIds: "s1" }],
    [{ studentIds: ["ok", "bad/id"] }],
  ])("refuses a payload outside the allowlist or malformed: %j", async (extra) => {
    await expect(apply(extra)).rejects.toMatchObject({ code: "lms.invalidRequest" });
    expect(mockFetchAssignment).not.toHaveBeenCalled();
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });
});

describe("lmsGradePassbacksApply destination fences (fail closed, zero writes)", () => {
  beforeEach(() => {
    student("s1");
    attemptOn("a4", "s1", 90);
  });

  it.each([
    [{ ...EXPECTED, currentAssignmentId: "a2" }],
    [{ ...EXPECTED, lmsAssignmentId: "cw-a2" }],
    [{ ...EXPECTED, maxPoints: 10 }],
  ])("a destination different from the preview is stalePreview: %j", async (expected) => {
    const result = await apply({ expected });
    expect(result.status).toBe("stalePreview");
    expect(result.students).toEqual([]);
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("Current changed after the preview: stalePreview", async () => {
    mockResolveGroup.mockResolvedValue({
      resolution: "valid",
      currentAssignmentId: "a2",
      current: A2,
      occurrences: [A2, A3, A4],
    });
    liveCoursework = { lmsAssignmentId: "cw-a2", state: "published", maxPoints: 10 };
    expect((await apply()).status).toBe("stalePreview");
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it.each([
    [{ state: "deleted", maxPoints: 20 }, "courseworkDeleted"],
    [{ state: "draft", maxPoints: 20 }, "courseworkNotPublished"],
    [{ state: "published", maxPoints: 25 }, "maxPointsMismatch"],
    [{ state: "published" }, "courseworkUngraded"],
  ])("live coursework %j after the preview: %s, nothing written", async (live, status) => {
    liveCoursework = { lmsAssignmentId: CW_CURRENT, ...live };
    const result = await apply();
    expect(result.status).toBe(status);
    expect(mockListSubmissionGrades).not.toHaveBeenCalled();
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("an unresolved or inactive Current writes nothing", async () => {
    mockResolveGroup.mockResolvedValue({ resolution: "unresolved" });
    expect((await apply()).status).toBe("currentUnresolved");
    mockResolveGroup.mockResolvedValue({ resolution: "inactive", currentAssignmentId: "a4", occurrences: [A4] });
    expect((await apply()).status).toBe("currentInactive");
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });
});

describe("lmsGradePassbacksApply production-pattern fixture", () => {
  it("preview classifies 4 / 1 / 1 / 9 / 5; apply writes exactly the 11; a second apply writes nothing", async () => {
    seedProductionPattern();

    const before = await preview();
    expect(before.preflight.status).toBe("ready");
    expect(before.summary).toEqual({
      byAction: {
        alreadyEqual: 4,
        wouldFillBlank: 1,
        wouldRaise: 1,
        wouldReplaceMissingDraftZero: 9,
        noLyfeLabzAttempt: 5,
      },
      wouldWrite: 11,
    });

    const first = await apply();
    expect(first.status).toBe("applied");
    expect(first.summary).toEqual({ written: 11, byOutcome: { written: 11, noWrite: 9 } });
    expect(mockSynchronizeGradePassback).toHaveBeenCalledTimes(11);
    for (const call of mockSynchronizeGradePassback.mock.calls) {
      expect(call[0]).toEqual({
        assignmentId: "a4",
        studentId: expect.any(String),
        districtId: DISTRICT,
        trigger: "teacher",
        expectedDestination: { assignmentId: "a4", lmsAssignmentId: CW_CURRENT, maxPoints: 20 },
      });
    }
    const byStudent = new Map(first.students.map((s) => [s.studentId, s]));
    expect(byStudent.get("blank")).toMatchObject({ outcome: "written", action: "wouldFillBlank", writtenPoints: 8 });
    expect(byStudent.get("lower")).toMatchObject({ outcome: "written", action: "wouldRaise", writtenPoints: 18 });
    expect(byStudent.get("zero0")).toMatchObject({
      outcome: "written",
      action: "wouldReplaceMissingDraftZero",
      writtenPoints: 16,
    });
    expect(byStudent.get("eq1")).toMatchObject({ outcome: "noWrite", action: "alreadyEqual" });
    expect(byStudent.get("none0")).toMatchObject({ outcome: "noWrite", action: "noLyfeLabzAttempt" });
    // Students without an attempt keep their Classroom state untouched.
    expect(gradebook.get("acct-none0")?.draftGrade).toBe(0);

    mockSynchronizeGradePassback.mockClear();
    const second = await apply();
    expect(second.summary).toEqual({ written: 0, byOutcome: { noWrite: 20 } });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
    const after = await preview();
    expect(after.summary).toEqual({
      byAction: { alreadyEqual: 15, noLyfeLabzAttempt: 5 },
      wouldWrite: 0,
    });
  });

  it("writes one apply-level audit event with counts only", async () => {
    seedProductionPattern();
    await apply();
    const audit = mockWriteAuditEvent.mock.calls.find(
      (c) => (c[0] as { action: string }).action === "lms.gradeReconciliationApplied",
    )?.[0] as { targetId: string; payload: Record<string, unknown> };
    expect(audit.targetId).toBe("a4");
    expect(audit.payload).toEqual({
      classId: CLASS_ID,
      lessonSlug: LESSON,
      written: 11,
      byOutcome: { written: 11, noWrite: 9 },
      destinationChanged: false,
    });
  });

  it("never returns credential material or Classroom ids", async () => {
    seedProductionPattern();
    const serialized = JSON.stringify(await apply());
    for (const secret of [ACCESS_TOKEN, "fixture-token-ref", CONNECTION, "acct-", "sub-acct"]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("lmsGradePassbacksApply fresh per-student state", () => {
  it("blank changed to a higher teacher grade before apply: preserved, not written", async () => {
    student("s1");
    attemptOn("a4", "s1", 90);
    expect((await preview()).students[0].action).toBe("wouldFillBlank");
    gradebook.set("acct-s1", { assignedGrade: 20, draftGrade: 20, state: "created", late: false });
    const result = await apply();
    expect(result.students[0]).toMatchObject({ outcome: "noWrite", action: "preservedClassroomHigher" });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
    expect(gradebook.get("acct-s1")?.assignedGrade).toBe(20);
  });

  it("missing draft zero changed to an explicit assigned zero before apply: protected", async () => {
    student("s1", { draftGrade: 0, late: true });
    attemptOn("a4", "s1", 90);
    expect((await preview()).students[0].action).toBe("wouldReplaceMissingDraftZero");
    gradebook.set("acct-s1", { assignedGrade: 0, draftGrade: 0, state: "created", late: true });
    const result = await apply();
    expect(result.students[0]).toMatchObject({ outcome: "noWrite", action: "protectedAssignedZero" });
    expect(gradebook.get("acct-s1")?.assignedGrade).toBe(0);
  });

  it.each([
    [18, "alreadyEqual"],
    [19, "preservedClassroomHigher"],
  ])("lower grade changed to %i before apply: %s, not written", async (points, action) => {
    student("s1", { assignedGrade: 10, draftGrade: 10 });
    attemptOn("a4", "s1", 90);
    gradebook.set("acct-s1", { assignedGrade: points, draftGrade: points, state: "created", late: false });
    const result = await apply();
    expect(result.students[0]).toMatchObject({ outcome: "noWrite", action });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("a grade that changes DURING apply is re-read by the engine and preserved (stateChanged)", async () => {
    student("s1");
    attemptOn("a4", "s1", 90);
    beforeEngine = () =>
      gradebook.set("acct-s1", { assignedGrade: 20, draftGrade: 20, state: "created", late: false });
    const result = await apply();
    expect(result.students[0]).toMatchObject({ outcome: "stateChanged", action: "preservedClassroomHigher" });
    expect(gradebook.get("acct-s1")?.assignedGrade).toBe(20);
  });

  it("one student's write failure is isolated and reported; others still written", async () => {
    student("s1");
    student("s2");
    attemptOn("a4", "s1", 90);
    attemptOn("a4", "s2", 80);
    engineOverrides.set("s1", () => ({ outcome: "failed", errorCode: "lms.upstreamCallFailed" }));
    const result = await apply();
    const byStudent = new Map(result.students.map((s) => [s.studentId, s]));
    expect(byStudent.get("s1")).toMatchObject({ outcome: "writeFailed", reason: "lms.upstreamCallFailed" });
    expect(byStudent.get("s2")).toMatchObject({ outcome: "written", writtenPoints: 16 });
    expect(result.status).toBe("applied");
  });

  it("an overlapping sync holding the student's lease is reported inProgress, not written twice", async () => {
    student("s1");
    attemptOn("a4", "s1", 90);
    engineOverrides.set("s1", () => ({ outcome: "deferred" }));
    expect((await apply()).students[0]).toMatchObject({ outcome: "inProgress" });
  });

  it("a destination change mid-batch stops the batch: remaining candidates notAttempted", async () => {
    for (const id of ["s1", "s2", "s3"]) {
      student(id);
      attemptOn("a4", id, 90);
    }
    let calls = 0;
    mockSynchronizeGradePassback.mockImplementation((input: { studentId: string }) => {
      calls += 1;
      if (calls === 2) return Promise.resolve({ outcome: "destinationChanged" });
      return standInEngine(input as never);
    });
    const result = await apply();
    expect(result.status).toBe("destinationChangedDuringApply");
    expect(result.summary.byOutcome).toEqual({ written: 1, notAttempted: 2 });
    expect(calls).toBe(2);
  });

  it("a deleted destination discovered mid-batch also stops the batch", async () => {
    for (const id of ["s1", "s2"]) {
      student(id);
      attemptOn("a4", id, 90);
    }
    engineOverrides.set("s1", () => ({ outcome: "destinationUnavailable", status: "courseworkDeleted" }));
    const result = await apply();
    expect(result.status).toBe("destinationChangedDuringApply");
    expect(result.students.every((s) => s.outcome === "notAttempted")).toBe(true);
    expect(result.students[0].reason).toBe("courseworkDeleted");
  });
});

describe("lmsGradePassbacksApply selection and scope", () => {
  it("writes only the selected students", async () => {
    for (const id of ["s1", "s2"]) {
      student(id);
      attemptOn("a4", id, 90);
    }
    const result = await apply({ studentIds: ["s2"] });
    expect(result.students.map((s) => s.studentId)).toEqual(["s2"]);
    expect(mockSynchronizeGradePassback).toHaveBeenCalledTimes(1);
    expect(gradebook.get("acct-s1")?.assignedGrade).toBeNull();
  });

  it("an arbitrary or out-of-scope student id is never written and is reported outsideRoster", async () => {
    student("s1");
    attemptOn("a4", "s1", 90);
    // Has an attempt but is not in the Current roster.
    attemptOn("a4", "outsider", 90);
    accounts.outsider = "acct-outsider";
    const result = await apply({ studentIds: ["outsider", "not-a-student"] });
    const byStudent = new Map(result.students.map((s) => [s.studentId, s]));
    expect(byStudent.get("outsider")).toMatchObject({ outcome: "noWrite", action: "outsideRoster" });
    expect(byStudent.get("not-a-student")).toMatchObject({ outcome: "noWrite", action: "outsideRoster" });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });

  it("protected and no-op rows never reach the write engine", async () => {
    student("assigned0", { assignedGrade: 0, late: true });
    student("turnedIn0", { draftGrade: 0, state: "turnedIn", late: true });
    student("diverge", { assignedGrade: 10, draftGrade: 12 });
    student("equal", { assignedGrade: 18, draftGrade: 18 });
    for (const id of ["assigned0", "turnedIn0", "diverge", "equal"]) attemptOn("a4", id, 90);
    const result = await apply();
    expect(result.summary).toEqual({ written: 0, byOutcome: { noWrite: 4 } });
    expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
  });
});
