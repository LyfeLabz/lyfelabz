// Callable tests for lmsGradePassbacksPreview (read-only grade sync
// preview). Firestore refs, occurrence grouping, roster readers, identity
// resolution, the token store, and the provider adapter are mocked; the
// canonical credential resolver, cumulative-best selection, and grade
// calculation run for real. Every write method on every mocked ref, every
// adapter write operation, and the grade-passback engine are spies that
// must never be called. Every identifier is fictional.

import type { CallableRequest } from "firebase-functions/v2/https";

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
const mockFirestoreWrite = jest.fn();
const mockAdapterWrite = jest.fn();
const mockCapturedCallableOptions: { value?: unknown } = {};

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
    platformCallable: (optionsOrHandler: unknown, maybeHandler: unknown) => {
      if (typeof optionsOrHandler === "function") return optionsOrHandler;
      mockCapturedCallableOptions.value = optionsOrHandler;
      return maybeHandler;
    },
    PlatformError,
    // The canonical rounding helper runs for real.
    roundHalfToEven2: jest.requireActual("../shared/math/round-half-to-even").roundHalfToEven2,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    classDocRef: jest.fn(() => mockReadOnlyRef(mockClassGet)),
    lmsAssignmentPublicationDocRef: jest.fn((id: string) =>
      mockReadOnlyRef(jest.fn(() => mockPublicationGet(id))),
    ),
    lmsConnectionDocRef: jest.fn(() => mockReadOnlyRef(mockConnectionGet)),
    userRecordDocRef: jest.fn((uid: string) =>
      mockReadOnlyRef(jest.fn(() => mockUserGet(uid))),
    ),
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
  googleClassroomProductionSecrets: ["__gc_secret_sentinel__"] as const,
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
    refreshCredential: jest.fn().mockResolvedValue({
      accessToken: "fixture-access-token-refreshed",
      expiresInSeconds: 3600,
    }),
    publishAssignment: mockAdapterWrite,
    patchStudentSubmissionGrade: mockAdapterWrite,
    resolveStudentSubmission: mockAdapterWrite,
    revokeGrant: mockAdapterWrite,
  }),
}));

jest.mock("./grade-passback/engine", () => ({
  synchronizeGradePassback: mockSynchronizeGradePassback,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __lmsGradePassbacksPreviewHandler } from "./lms-grade-passbacks-preview";

const TEACHER = "fixture-teacher-uid";
const SCHOOL = "fixture-school";
const DISTRICT = "fixture-district";
const CLASS_ID = "fixture-class-a";
const LESSON = "fixture-lesson";
const LMS_CLASS = "fixture-lms-course";
const CONNECTION = "fixture-connection";
const ACCESS_TOKEN = "fixture-access-token-live";
const REFRESH_TOKEN = "fixture-refresh-token-secret";

function ts(ms: number) {
  return { toDate: () => new Date(ms), toMillis: () => ms };
}

function occurrence(
  assignmentId: string,
  grading: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
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
      ...overrides,
    },
  };
}

const A2 = occurrence("a2", { mode: "graded", maxPoints: 10 });
const A3 = occurrence("a3", { mode: "ungraded" });
const A4 = occurrence("a4", { mode: "graded", maxPoints: 20 });

let publications: Record<string, Record<string, unknown> | undefined>;
let attemptsByAssignment: Record<string, { id: string; data: Record<string, unknown> }[]>;
let roster: string[];
let enrolled: string[];
let accounts: Record<string, string | null | Error>;
let displayNames: Record<string, string>;
let tokenStore: { resolve: jest.Mock; persistRefreshedCredential: jest.Mock };

function publication(assignmentId: string, grading: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    assignmentId,
    classId: CLASS_ID,
    ownerUid: TEACHER,
    schoolId: SCHOOL,
    providerId: "googleClassroom",
    connectionId: CONNECTION,
    lmsClassId: LMS_CLASS,
    status: "succeeded",
    lmsAssignmentId: `cw-${assignmentId}`,
    classroomGrading: grading,
    ...overrides,
  };
}

function attemptOn(
  assignmentId: string,
  studentId: string,
  percentage: number,
  attemptNumber = 1,
  overrides: Record<string, unknown> = {},
) {
  const list = (attemptsByAssignment[assignmentId] ??= []);
  list.push({
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
      ...overrides,
    },
  });
}

function submission(
  account: string,
  assignedGrade: number | null,
  draftGrade: number | null,
  state = "turnedIn",
  late = false,
) {
  return {
    submissionId: `sub-${account}`,
    studentProviderAccountId: account,
    state,
    late,
    assignedGrade,
    draftGrade,
  };
}

function useValidCurrent() {
  mockResolveGroup.mockResolvedValue({
    resolution: "valid",
    currentAssignmentId: "a4",
    current: A4,
    occurrences: [A2, A3, A4],
  });
}

function request(data: unknown = { classId: CLASS_ID, lessonSlug: LESSON }) {
  return {
    auth: { uid: TEACHER, token: { role: "teacher" } },
    data,
    rawRequest: {},
  } as unknown as CallableRequest<unknown>;
}

function tokenBundle(expiresAtEpochMs: number) {
  return {
    providerId: "googleClassroom",
    teacherId: TEACHER,
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    scopes: ["scope.a"],
    expiresAtEpochMs,
    upstreamAccountIdentifier: "fixture-upstream",
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAssertTeacher.mockResolvedValue({ uid: TEACHER, schoolId: SCHOOL, districtId: DISTRICT });
  mockClassGet.mockResolvedValue({
    exists: true,
    data: () => ({ teacherId: TEACHER, schoolId: SCHOOL }),
  });
  publications = {
    a2__pub: publication("a2", { mode: "graded", maxPoints: 10 }),
    a3__pub: publication("a3", { mode: "ungraded" }),
    a4__pub: publication("a4", { mode: "graded", maxPoints: 20 }),
  };
  attemptsByAssignment = {};
  roster = [];
  enrolled = [];
  accounts = {};
  displayNames = {};
  useValidCurrent();
  mockPublicationGet.mockImplementation((id: string) => {
    const data = publications[id];
    return Promise.resolve({ exists: data !== undefined, data: () => data });
  });
  mockConnectionGet.mockResolvedValue({
    exists: true,
    data: () => ({
      teacherId: TEACHER,
      status: "active",
      providerId: "googleClassroom",
      tokenRef: "fixture-token-ref",
    }),
  });
  mockUserGet.mockImplementation((uid: string) =>
    Promise.resolve({ exists: true, data: () => ({ displayName: displayNames[uid] ?? uid }) }),
  );
  mockAttemptsQuery.mockImplementation((field: string, _op: string, value: string) => {
    expect(field).toBe("assignmentId");
    const docs = (attemptsByAssignment[value] ?? []).map((a) => ({ id: a.id, data: () => a.data }));
    return Promise.resolve({ docs });
  });
  mockRecipients.mockImplementation(() => Promise.resolve(new Set(roster)));
  mockEnrolled.mockImplementation(() => Promise.resolve(new Set(enrolled)));
  mockResolveAccount.mockImplementation((studentId: string) => {
    const account = accounts[studentId];
    if (account instanceof Error) return Promise.reject(account);
    return Promise.resolve(account ?? null);
  });
  tokenStore = {
    resolve: jest.fn().mockResolvedValue(tokenBundle(Date.now() + 60 * 60 * 1000)),
    persistRefreshedCredential: jest.fn(),
  };
  mockGetLmsTokenStore.mockReturnValue(tokenStore);
  mockFetchAssignment.mockResolvedValue({
    lmsAssignmentId: "cw-a4",
    title: "Fictional Lesson",
    state: "published",
    maxPoints: 20,
  });
  mockListSubmissionGrades.mockResolvedValue([]);
});

afterEach(() => {
  // Observation only: no Firestore business write, no Classroom write, no
  // grade-passback engine call. (The credential refresh persists through the
  // token store and is asserted separately.)
  expect(mockFirestoreWrite).not.toHaveBeenCalled();
  expect(mockAdapterWrite).not.toHaveBeenCalled();
  expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
});

// A student in the Current roster with a resolved Classroom identity.
function student(id: string, account = `acct-${id}`) {
  roster.push(id);
  enrolled.push(id);
  accounts[id] = account;
  return account;
}

async function preview(data?: unknown) {
  return __lmsGradePassbacksPreviewHandler(request(data));
}

function row(result: Awaited<ReturnType<typeof preview>>, studentId: string) {
  const found = result.students.find((s) => s.studentId === studentId);
  if (!found) throw new Error(`no row for ${studentId}`);
  return found;
}

async function rejectionCode(data?: unknown): Promise<string | undefined> {
  try {
    await preview(data);
  } catch (err) {
    return (err as { code?: string }).code;
  }
  throw new Error("handler should have rejected");
}

describe("lmsGradePassbacksPreview authorization", () => {
  it("declares the Google Classroom production secrets", () => {
    expect(mockCapturedCallableOptions.value).toEqual({ secrets: ["__gc_secret_sentinel__"] });
  });

  it("rejects an unauthenticated caller before reading anything", async () => {
    mockAssertTeacher.mockRejectedValueOnce(new PlatformError("lms.unauthenticated", "no auth"));
    expect(await rejectionCode()).toBe("lms.unauthenticated");
    expect(mockClassGet).not.toHaveBeenCalled();
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });

  it("rejects a teacher who does not own the class", async () => {
    mockClassGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ teacherId: "someone-else", schoolId: SCHOOL }),
    });
    expect(await rejectionCode()).toBe("lms.forbidden");
    expect(mockResolveGroup).not.toHaveBeenCalled();
  });

  it("rejects a class outside the caller's authoritative school", async () => {
    mockClassGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ teacherId: TEACHER, schoolId: "other-school" }),
    });
    expect(await rejectionCode()).toBe("lms.forbidden");
  });

  it("derives the destination server-side and ignores caller-supplied Classroom ids", async () => {
    await preview({
      classId: CLASS_ID,
      lessonSlug: LESSON,
      lmsClassId: "foreign-course",
      lmsAssignmentId: "foreign-coursework",
      maxPoints: 100,
    });
    expect(mockFetchAssignment).toHaveBeenCalledWith({
      accessToken: ACCESS_TOKEN,
      lmsClassId: LMS_CLASS,
      lmsAssignmentId: "cw-a4",
    });
    expect(mockListSubmissionGrades).toHaveBeenCalledWith({
      accessToken: ACCESS_TOKEN,
      lmsClassId: LMS_CLASS,
      lmsAssignmentId: "cw-a4",
    });
    expect(mockResolveGroup).toHaveBeenCalledWith(
      { classId: CLASS_ID, lessonSlug: LESSON, teacherId: TEACHER, schoolId: SCHOOL },
      DISTRICT,
      expect.any(Function),
    );
  });

  it("never selects historical coursework as the destination", async () => {
    await preview();
    const courseworkIds = [
      ...mockFetchAssignment.mock.calls,
      ...mockListSubmissionGrades.mock.calls,
    ].map((c) => (c[0] as { lmsAssignmentId: string }).lmsAssignmentId);
    expect(new Set(courseworkIds)).toEqual(new Set(["cw-a4"]));
  });
});

describe("lmsGradePassbacksPreview live destination preflight (fails closed)", () => {
  async function expectFailClosed(status: string) {
    student("s1");
    attemptOn("a4", "s1", 90);
    const result = await preview();
    expect(result.preflight.status).toBe(status);
    expect(result.students).toEqual([]);
    expect(result.summary).toEqual({ byAction: {}, wouldWrite: 0 });
    return result;
  }

  it("requires a valid Current (unresolved legacy family)", async () => {
    mockResolveGroup.mockResolvedValue({ resolution: "unresolved" });
    await expectFailClosed("currentUnresolved");
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });

  it("requires a valid Current (managed but inactive)", async () => {
    mockResolveGroup.mockResolvedValue({
      resolution: "inactive",
      currentAssignmentId: "a4",
      occurrences: [A2, A3, A4],
    });
    const result = await expectFailClosed("currentInactive");
    expect(result.preflight.currentAssignmentId).toBe("a4");
  });

  it("fails closed for an ungraded Current", async () => {
    mockResolveGroup.mockResolvedValue({
      resolution: "valid",
      currentAssignmentId: "a3",
      current: A3,
      occurrences: [A2, A3, A4],
    });
    await expectFailClosed("currentUngraded");
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });

  it("fails closed when Current has no succeeded Classroom publication", async () => {
    publications.a4__pub = publication("a4", { mode: "graded", maxPoints: 20 }, {
      status: "failed",
      lmsAssignmentId: undefined,
    });
    await expectFailClosed("currentNotPublishedToClassroom");
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });

  it("fails closed when the connection is not the caller's", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({ teacherId: "someone-else", status: "active", providerId: "googleClassroom", tokenRef: "x" }),
    });
    await expectFailClosed("connectionUnavailable");
    expect(tokenStore.resolve).not.toHaveBeenCalled();
  });

  it("fails closed when Current coursework no longer exists (404)", async () => {
    mockFetchAssignment.mockRejectedValue(new PlatformError("lms.upstreamResourceNotFound", "gone"));
    const result = await expectFailClosed("courseworkNotFound");
    expect(result.preflight.errorCode).toBe("lms.upstreamResourceNotFound");
    expect(mockListSubmissionGrades).not.toHaveBeenCalled();
  });

  it("fails closed when Current coursework is DELETED", async () => {
    mockFetchAssignment.mockResolvedValue({ lmsAssignmentId: "cw-a4", state: "deleted", maxPoints: 20 });
    await expectFailClosed("courseworkDeleted");
    expect(mockListSubmissionGrades).not.toHaveBeenCalled();
  });

  it("fails closed when Current coursework is not PUBLISHED", async () => {
    mockFetchAssignment.mockResolvedValue({ lmsAssignmentId: "cw-a4", state: "draft", maxPoints: 20 });
    await expectFailClosed("courseworkNotPublished");
  });

  it("fails closed when live coursework is ungraded", async () => {
    mockFetchAssignment.mockResolvedValue({ lmsAssignmentId: "cw-a4", state: "published" });
    await expectFailClosed("courseworkUngraded");
  });

  it("fails closed on live maxPoints drift", async () => {
    mockFetchAssignment.mockResolvedValue({ lmsAssignmentId: "cw-a4", state: "published", maxPoints: 25 });
    const result = await expectFailClosed("maxPointsMismatch");
    expect(result.preflight.storedMaxPoints).toBe(20);
    expect(result.preflight.liveMaxPoints).toBe(25);
    expect(mockListSubmissionGrades).not.toHaveBeenCalled();
  });

  it.each([
    ["lms.upstreamAuthorizationFailed", "courseworkInaccessible"],
    ["lms.insufficientScope", "courseworkInaccessible"],
    ["lms.upstreamCallFailed", "courseworkError"],
    ["lms.upstreamTemporarilyUnavailable", "courseworkError"],
  ])("maps a coursework read failure %s to %s", async (code, status) => {
    mockFetchAssignment.mockRejectedValue(new PlatformError(code, "fixture"));
    const result = await expectFailClosed(status);
    expect(result.preflight.errorCode).toBe(code);
  });

  it("fails closed when the submission list cannot be read", async () => {
    mockListSubmissionGrades.mockRejectedValue(new PlatformError("lms.upstreamCallFailed", "400"));
    const result = await expectFailClosed("submissionsUnavailable");
    expect(result.preflight.errorCode).toBe("lms.upstreamCallFailed");
  });

  it("reports the verified destination when ready", async () => {
    const result = await preview();
    expect(result.preflight).toEqual({
      status: "ready",
      currentAssignmentId: "a4",
      lmsAssignmentId: "cw-a4",
      storedMaxPoints: 20,
      liveMaxPoints: 20,
      liveState: "published",
      liveTitle: "Fictional Lesson",
      errorCode: null,
    });
    expect(result.maxPoints).toBe(20);
  });
});

describe("lmsGradePassbacksPreview per-student classification", () => {
  it("classifies each student independently against the live Classroom grade", async () => {
    const subs = [];
    // Equal: 90% -> 18, Classroom 18.
    subs.push(submission(student("equal"), 18, 18));
    attemptOn("a4", "equal", 90);
    // Raise, cumulative across occurrences: 90% on older /10 A2, 80% on A4 -> 18.
    subs.push(submission(student("raise"), 16, 16));
    attemptOn("a2", "raise", 90);
    attemptOn("a4", "raise", 80);
    // Classroom higher -> preserved.
    subs.push(submission(student("higher"), 20, 20, "returned"));
    attemptOn("a4", "higher", 90);
    // Synthetic safety case: higher decimal Classroom grade preserved.
    subs.push(submission(student("decimal"), 18.5, 18.5));
    attemptOn("a4", "decimal", 90);
    // Blank, target from an older UNGRADED occurrence: 70% -> 14.
    subs.push(submission(student("blank"), null, null, "created"));
    attemptOn("a3", "blank", 70);
    // Assigned and draft differ -> protected.
    subs.push(submission(student("diverge"), 16, 17));
    attemptOn("a4", "diverge", 90);
    // Approved narrow missing-work placeholder (draft 0, assigned blank,
    // late, never turned in, positive target) -> replaceable.
    subs.push(submission(student("zero"), null, 0, "created", true));
    attemptOn("a4", "zero", 70);
    // Assigned zero -> protected.
    subs.push(submission(student("zero2"), 0, 0, "returned"));
    attemptOn("a4", "zero2", 50);
    // Draft zero on turned-in work -> protected.
    subs.push(submission(student("zeroTurnedIn"), null, 0, "turnedIn", true));
    attemptOn("a4", "zeroTurnedIn", 70);
    // Draft zero on work that is not late -> protected.
    subs.push(submission(student("zeroOnTime"), null, 0, "created", false));
    attemptOn("a4", "zeroOnTime", 70);
    // No LyfeLabz attempt.
    subs.push(submission(student("none"), null, null, "new"));
    // Lower later attempt does not lower the target: 100 then 40 -> 20.
    subs.push(submission(student("lower"), null, null));
    attemptOn("a4", "lower", 100, 1);
    attemptOn("a4", "lower", 40, 2);
    // Perfect score equals maxPoints.
    subs.push(submission(student("perfect"), 20, 20));
    attemptOn("a4", "perfect", 100);
    mockListSubmissionGrades.mockResolvedValue(subs);

    const result = await preview();
    const view = (id: string) => {
      const r = row(result, id);
      return [r.action, r.targetPoints, r.proposedPoints];
    };
    expect(view("equal")).toEqual(["alreadyEqual", 18, null]);
    expect(view("raise")).toEqual(["wouldRaise", 18, 18]);
    expect(row(result, "raise")).toMatchObject({ bestPercentage: 90, bestAssignmentId: "a2" });
    expect(view("higher")).toEqual(["preservedClassroomHigher", 18, null]);
    expect(view("decimal")).toEqual(["preservedClassroomHigher", 18, null]);
    expect(view("blank")).toEqual(["wouldFillBlank", 14, 14]);
    expect(row(result, "blank").bestAssignmentId).toBe("a3");
    expect(view("diverge")).toEqual(["protectedGradesDiffer", 18, null]);
    expect(view("zero")).toEqual(["wouldReplaceMissingDraftZero", 14, 14]);
    expect(row(result, "zero").classroom).toEqual({
      state: "created",
      late: true,
      assignedGrade: null,
      draftGrade: 0,
    });
    expect(view("zero2")).toEqual(["protectedAssignedZero", 10, null]);
    expect(view("zeroTurnedIn")).toEqual(["protectedDraftZero", 14, null]);
    expect(view("zeroOnTime")).toEqual(["protectedDraftZero", 14, null]);
    expect(view("none")).toEqual(["noLyfeLabzAttempt", null, null]);
    expect(row(result, "none").classroom?.state).toBe("new");
    expect(view("lower")).toEqual(["wouldFillBlank", 20, 20]);
    expect(view("perfect")).toEqual(["alreadyEqual", 20, null]);

    expect(result.summary.wouldWrite).toBe(4);
    expect(result.summary.byAction).toEqual({
      alreadyEqual: 2,
      wouldRaise: 1,
      preservedClassroomHigher: 2,
      wouldFillBlank: 2,
      protectedGradesDiffer: 1,
      wouldReplaceMissingDraftZero: 1,
      protectedAssignedZero: 1,
      protectedDraftZero: 2,
      noLyfeLabzAttempt: 1,
    });
  });

  it("reports students outside the roster boundary without a proposal or Classroom lookup", async () => {
    // Attempted, but not a canonical recipient of Current.
    attemptOn("a4", "outsider", 90);
    accounts.outsider = "acct-outsider";
    // A recipient who is no longer actively enrolled is also outside.
    roster.push("withdrawn");
    accounts.withdrawn = "acct-withdrawn";
    attemptOn("a4", "withdrawn", 90);
    mockListSubmissionGrades.mockResolvedValue([
      submission("acct-outsider", null, null),
      submission("acct-withdrawn", null, null),
    ]);
    const result = await preview();
    for (const id of ["outsider", "withdrawn"]) {
      expect(row(result, id)).toMatchObject({
        inRoster: false,
        action: "outsideRoster",
        proposedPoints: null,
        classroom: null,
        targetPoints: 18,
      });
    }
    expect(mockResolveAccount).not.toHaveBeenCalled();
    expect(result.summary.wouldWrite).toBe(0);
  });

  it("ignores attempts whose own ownership does not match the family", async () => {
    student("s1");
    attemptOn("a4", "s1", 60);
    attemptOn("a4", "s1", 100, 2, { classId: "some-other-class" });
    mockListSubmissionGrades.mockResolvedValue([submission("acct-s1", null, null)]);
    const result = await preview();
    expect(row(result, "s1").targetPoints).toBe(12);
  });

  it("handles unavailable, ambiguous, unresolved, and conflicting identities per student", async () => {
    student("nosub");
    attemptOn("a4", "nosub", 90);
    student("ambiguous");
    attemptOn("a4", "ambiguous", 90);
    roster.push("noid");
    enrolled.push("noid");
    attemptOn("a4", "noid", 90);
    student("dupA", "acct-shared");
    student("dupB", "acct-shared");
    attemptOn("a4", "dupA", 90);
    attemptOn("a4", "dupB", 90);
    student("ok");
    attemptOn("a4", "ok", 90);
    mockListSubmissionGrades.mockResolvedValue([
      submission("acct-ambiguous", null, null),
      { ...submission("acct-ambiguous", 5, 5), submissionId: "second" },
      submission("acct-shared", null, null),
      submission("acct-ok", null, null),
    ]);
    const result = await preview();
    expect(row(result, "nosub").action).toBe("submissionUnavailable");
    expect(row(result, "ambiguous").action).toBe("submissionAmbiguous");
    expect(row(result, "noid").action).toBe("identityUnresolved");
    expect(row(result, "dupA").action).toBe("identityConflict");
    expect(row(result, "dupB").action).toBe("identityConflict");
    expect(row(result, "ok")).toMatchObject({ action: "wouldFillBlank", proposedPoints: 18 });
    for (const id of ["nosub", "ambiguous", "noid", "dupA", "dupB"]) {
      expect(row(result, id).proposedPoints).toBeNull();
    }
  });

  it("one student's identity error does not corrupt another student's preview", async () => {
    student("broken");
    accounts.broken = new Error("identity store unavailable");
    attemptOn("a4", "broken", 90);
    student("fine");
    attemptOn("a4", "fine", 80);
    mockListSubmissionGrades.mockResolvedValue([submission("acct-fine", 10, 10)]);
    const result = await preview();
    expect(row(result, "broken")).toMatchObject({ action: "error", proposedPoints: null });
    expect(row(result, "fine")).toMatchObject({ action: "wouldRaise", proposedPoints: 16 });
  });

  it("sorts rows by display name", async () => {
    student("s-b");
    student("s-a");
    displayNames["s-b"] = "Beta";
    displayNames["s-a"] = "Alpha";
    const result = await preview();
    expect(result.students.map((s) => s.displayName)).toEqual(["Alpha", "Beta"]);
  });
});

describe("lmsGradePassbacksPreview credentials and output", () => {
  it("refreshes an expired credential through the canonical resolver (the only incidental write)", async () => {
    tokenStore.resolve.mockResolvedValue(tokenBundle(Date.now() - 1000));
    tokenStore.persistRefreshedCredential.mockImplementation(
      (input: { refreshed: { accessToken: string } }) =>
        Promise.resolve({ ...tokenBundle(Date.now() + 3600 * 1000), accessToken: input.refreshed.accessToken }),
    );
    await preview();
    expect(tokenStore.persistRefreshedCredential).toHaveBeenCalledTimes(1);
    expect(mockFetchAssignment.mock.calls[0][0].accessToken).toBe("fixture-access-token-refreshed");
    expect(mockListSubmissionGrades.mock.calls[0][0].accessToken).toBe("fixture-access-token-refreshed");
  });

  it("does not persist anything when the stored credential is valid", async () => {
    await preview();
    expect(tokenStore.persistRefreshedCredential).not.toHaveBeenCalled();
  });

  it("never returns credential material or Classroom student account ids", async () => {
    student("s1");
    attemptOn("a4", "s1", 90);
    mockListSubmissionGrades.mockResolvedValue([submission("acct-s1", 16, 16)]);
    const serialized = JSON.stringify(await preview());
    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, "fixture-token-ref", CONNECTION, "acct-s1", "sub-acct-s1"]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
