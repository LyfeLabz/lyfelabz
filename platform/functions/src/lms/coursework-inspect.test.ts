// Callable tests for lmsCourseworkInspect (read-only Classroom coursework
// health diagnostic). Firestore refs, the occurrence grouping, the token
// store, and the provider adapter are mocked; the canonical credential
// resolver runs for real so the refresh path is exercised. Every write
// method on every mocked ref and every adapter write operation is a spy
// that must never be called. Every identifier is fictional.

import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssertTeacher = jest.fn();
const mockClassGet = jest.fn();
const mockPublicationGet = jest.fn();
const mockConnectionGet = jest.fn();
const mockResolveGroup = jest.fn();
const mockLoader = jest.fn();
const mockGetLmsTokenStore = jest.fn();
const mockFetchAssignment = jest.fn();
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
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    classDocRef: jest.fn(() => mockReadOnlyRef(mockClassGet)),
    lmsAssignmentPublicationDocRef: jest.fn((id: string) =>
      mockReadOnlyRef(jest.fn(() => mockPublicationGet(id))),
    ),
    lmsConnectionDocRef: jest.fn(() => mockReadOnlyRef(mockConnectionGet)),
  };
});

jest.mock("../assignments/current-occurrence-group", () => ({
  createClassAssignmentsLoader: () => mockLoader,
  resolveCurrentOccurrenceGroup: (...args: unknown[]) => mockResolveGroup(...args),
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
import { __lmsCourseworkInspectHandler } from "./coursework-inspect";

const TEACHER = "fixture-teacher-uid";
const SCHOOL = "fixture-school";
const DISTRICT = "fixture-district";
const CLASS_ID = "fixture-class-a";
const LESSON = "fixture-lesson";
const LMS_CLASS = "fixture-lms-course";
const CONNECTION = "fixture-connection";
const ACCESS_TOKEN = "fixture-access-token-live";
const REFRESH_TOKEN = "fixture-refresh-token-secret";

function ts(iso: string) {
  const date = new Date(iso);
  return { toDate: () => date, toMillis: () => date.getTime() };
}

type Occ = { assignmentId: string; record: Record<string, unknown> };

function occurrence(
  assignmentId: string,
  createdIso: string,
  overrides: Record<string, unknown> = {},
): Occ {
  return {
    assignmentId,
    record: {
      classId: CLASS_ID,
      lessonSlug: LESSON,
      teacherId: TEACHER,
      schoolId: SCHOOL,
      status: "published",
      mode: "classroom",
      createdAt: ts(createdIso),
      publishedAt: ts(createdIso),
      lmsPublicationRef: `${assignmentId}__pub`,
      classroomGrading: { mode: "graded", maxPoints: 10 },
      ...overrides,
    },
  };
}

function publication(
  assignmentId: string,
  overrides: Record<string, unknown> = {},
) {
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
    classroomGrading: { mode: "graded", maxPoints: 10 },
    ...overrides,
  };
}

function liveCoursework(overrides: Record<string, unknown> = {}) {
  return {
    title: "Fictional Lesson",
    state: "published",
    maxPoints: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    dueDate: "2026-01-03",
    dueTime: "04:59",
    lmsAssignmentUrl: "https://classroom.google.com/c/fixture/a/fixture/details",
    ...overrides,
  };
}

let occurrences: Occ[];
let publications: Record<string, Record<string, unknown> | undefined>;
let live: Record<string, unknown>;

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

let tokenStore: { resolve: jest.Mock; persistRefreshedCredential: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  mockAssertTeacher.mockResolvedValue({
    uid: TEACHER,
    schoolId: SCHOOL,
    districtId: DISTRICT,
  });
  mockClassGet.mockResolvedValue({
    exists: true,
    data: () => ({ teacherId: TEACHER, schoolId: SCHOOL, title: "(A) Fixture" }),
  });
  occurrences = [];
  publications = {};
  live = {};
  mockLoader.mockImplementation(() => Promise.resolve(occurrences));
  mockResolveGroup.mockResolvedValue({ resolution: "unresolved" });
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
  tokenStore = {
    resolve: jest.fn().mockResolvedValue(tokenBundle(Date.now() + 60 * 60 * 1000)),
    persistRefreshedCredential: jest.fn(),
  };
  mockGetLmsTokenStore.mockReturnValue(tokenStore);
  mockFetchAssignment.mockImplementation(
    (input: { lmsAssignmentId: string }) => {
      const outcome = live[input.lmsAssignmentId];
      if (outcome instanceof Error) return Promise.reject(outcome);
      if (outcome === undefined) {
        return Promise.reject(
          new PlatformError("lms.upstreamResourceNotFound", "not found"),
        );
      }
      return Promise.resolve({ lmsAssignmentId: input.lmsAssignmentId, ...outcome });
    },
  );
});

afterEach(() => {
  // Observation only: no Firestore mutation through any ref this callable
  // touches (the credential refresh persists through the token store,
  // asserted separately), no Classroom write, no grade-passback call.
  expect(mockFirestoreWrite).not.toHaveBeenCalled();
  expect(mockAdapterWrite).not.toHaveBeenCalled();
  expect(mockSynchronizeGradePassback).not.toHaveBeenCalled();
});

function addPublished(
  id: string,
  createdIso: string,
  opts: {
    record?: Record<string, unknown>;
    publication?: Record<string, unknown>;
    live?: Record<string, unknown> | Error;
  } = {},
) {
  occurrences.push(occurrence(id, createdIso, opts.record));
  publications[`${id}__pub`] = publication(id, opts.publication);
  if (opts.live !== undefined) live[`cw-${id}`] = opts.live;
}

async function rejectionCode(data?: unknown): Promise<string | undefined> {
  try {
    await __lmsCourseworkInspectHandler(request(data));
  } catch (err) {
    return (err as { code?: string }).code;
  }
  throw new Error("handler should have rejected");
}

describe("lmsCourseworkInspect authorization", () => {
  it("declares the Google Classroom production secrets", () => {
    expect(mockCapturedCallableOptions.value).toEqual({
      secrets: ["__gc_secret_sentinel__"],
    });
  });

  it("rejects an unauthenticated caller before reading anything", async () => {
    mockAssertTeacher.mockRejectedValueOnce(
      new PlatformError("lms.unauthenticated", "no auth"),
    );
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
    expect(mockLoader).not.toHaveBeenCalled();
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });

  it("rejects a class outside the caller's authoritative school", async () => {
    mockClassGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ teacherId: TEACHER, schoolId: "other-school" }),
    });
    expect(await rejectionCode()).toBe("lms.forbidden");
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });

  it("rejects a missing class the same way as a foreign one", async () => {
    mockClassGet.mockResolvedValueOnce({ exists: false, data: () => undefined });
    expect(await rejectionCode()).toBe("lms.forbidden");
  });

  it("rejects a malformed request", async () => {
    expect(await rejectionCode(null)).toBe("lms.invalidRequest");
    expect(await rejectionCode({ classId: CLASS_ID })).toBe("lms.invalidLessonSlug");
    expect(await rejectionCode({ classId: "bad/id", lessonSlug: LESSON })).toBe(
      "lms.invalidClassId",
    );
  });

  it("ignores caller-supplied Classroom ids and only reads stored coursework", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", { live: liveCoursework() });
    await __lmsCourseworkInspectHandler(
      request({
        classId: CLASS_ID,
        lessonSlug: LESSON,
        lmsClassId: "foreign-course",
        lmsAssignmentId: "foreign-coursework",
      }),
    );
    expect(mockFetchAssignment).toHaveBeenCalledTimes(1);
    expect(mockFetchAssignment.mock.calls[0][0]).toEqual({
      accessToken: ACCESS_TOKEN,
      lmsClassId: LMS_CLASS,
      lmsAssignmentId: "cw-a1",
    });
  });

  it("never reads coursework from a publication that belongs to another owner", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", {
      publication: { ownerUid: "someone-else" },
      live: liveCoursework(),
    });
    const result = await __lmsCourseworkInspectHandler(request());
    expect(result.assignments[0].status).toBe("notPublishedToClassroom");
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });

  it("never reads coursework through a connection the caller does not own", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: "someone-else",
        status: "active",
        providerId: "googleClassroom",
        tokenRef: "foreign-token-ref",
      }),
    });
    addPublished("a1", "2026-01-01T00:00:00Z", { live: liveCoursework() });
    const result = await __lmsCourseworkInspectHandler(request());
    expect(result.assignments[0].status).toBe("connectionUnavailable");
    expect(tokenStore.resolve).not.toHaveBeenCalled();
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });

  it("excludes other lessons and other teachers' assignments in the same class", async () => {
    addPublished("mine", "2026-01-01T00:00:00Z", { live: liveCoursework() });
    occurrences.push(occurrence("other-lesson", "2026-01-02T00:00:00Z", { lessonSlug: "x" }));
    occurrences.push(
      occurrence("other-teacher", "2026-01-03T00:00:00Z", { teacherId: "someone-else" }),
    );
    const result = await __lmsCourseworkInspectHandler(request());
    expect(result.assignments.map((a) => a.assignmentId)).toEqual(["mine"]);
  });
});

describe("lmsCourseworkInspect health classification", () => {
  it("reports a matching published coursework as healthy", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", { live: liveCoursework() });
    const [row] = (await __lmsCourseworkInspectHandler(request())).assignments;
    expect(row).toMatchObject({
      assignmentId: "a1",
      assignmentStatus: "published",
      createdAt: "2026-01-01T00:00:00.000Z",
      stored: {
        gradingMode: "graded",
        maxPoints: 10,
        publicationStatus: "succeeded",
        lmsAssignmentId: "cw-a1",
      },
      live: {
        existence: "exists",
        errorCode: null,
        title: "Fictional Lesson",
        state: "published",
        maxPoints: 10,
        dueDate: "2026-01-03",
        dueTime: "04:59",
      },
      gradingModeAgrees: true,
      maxPointsAgree: true,
      status: "healthy",
    });
  });

  it("reports differing maxPoints as maxPointsMismatch", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", { live: liveCoursework({ maxPoints: 20 }) });
    const [row] = (await __lmsCourseworkInspectHandler(request())).assignments;
    expect(row.stored.maxPoints).toBe(10);
    expect(row.live.maxPoints).toBe(20);
    expect(row.maxPointsAgree).toBe(false);
    expect(row.status).toBe("maxPointsMismatch");
  });

  it("reports stored-ungraded coursework that is now graded as gradingMismatch", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", {
      record: { classroomGrading: { mode: "ungraded" } },
      publication: { classroomGrading: { mode: "ungraded" } },
      live: liveCoursework({ maxPoints: 20 }),
    });
    const [row] = (await __lmsCourseworkInspectHandler(request())).assignments;
    expect(row.stored.gradingMode).toBe("ungraded");
    expect(row.gradingModeAgrees).toBe(false);
    expect(row.maxPointsAgree).toBeNull();
    expect(row.status).toBe("gradingMismatch");
  });

  it("reports a matching ungraded coursework as healthy", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", {
      publication: { classroomGrading: { mode: "ungraded" } },
      live: liveCoursework({ maxPoints: undefined }),
    });
    const [row] = (await __lmsCourseworkInspectHandler(request())).assignments;
    expect(row.live.maxPoints).toBeNull();
    expect(row.gradingModeAgrees).toBe(true);
    expect(row.status).toBe("healthy");
  });

  it("reports a non-published live state as courseworkNotPublished", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", { live: liveCoursework({ state: "draft" }) });
    const [row] = (await __lmsCourseworkInspectHandler(request())).assignments;
    expect(row.live.state).toBe("draft");
    expect(row.status).toBe("courseworkNotPublished");
  });

  it("reports deleted/missing coursework as courseworkNotFound", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z");
    const [row] = (await __lmsCourseworkInspectHandler(request())).assignments;
    expect(row.live).toMatchObject({
      existence: "notFound",
      errorCode: "lms.upstreamResourceNotFound",
      maxPoints: null,
    });
    expect(row.gradingModeAgrees).toBeNull();
    expect(row.status).toBe("courseworkNotFound");
  });

  it.each([
    ["lms.upstreamAuthorizationFailed", "inaccessible", "inaccessible"],
    ["lms.insufficientScope", "inaccessible", "inaccessible"],
    ["lms.upstreamCallFailed", "error", "error"],
    ["lms.upstreamTemporarilyUnavailable", "error", "error"],
  ])("classifies %s as existence %s", async (code, existence, status) => {
    addPublished("a1", "2026-01-01T00:00:00Z", {
      live: new PlatformError(code, "fixture upstream failure"),
    });
    const [row] = (await __lmsCourseworkInspectHandler(request())).assignments;
    expect(row.live.existence).toBe(existence);
    expect(row.live.errorCode).toBe(code);
    expect(row.status).toBe(status);
  });

  it("does not call Classroom for an assignment with no publication", async () => {
    occurrences.push(occurrence("a1", "2026-01-01T00:00:00Z", { lmsPublicationRef: undefined }));
    const [row] = (await __lmsCourseworkInspectHandler(request())).assignments;
    expect(row.status).toBe("notPublishedToClassroom");
    expect(row.stored.publicationStatus).toBeNull();
    expect(row.live.existence).toBe("notChecked");
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });

  it("does not call Classroom for a publication that did not succeed", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", {
      publication: { status: "failed", lmsAssignmentId: undefined },
    });
    const [row] = (await __lmsCourseworkInspectHandler(request())).assignments;
    expect(row.status).toBe("publicationNotSucceeded");
    expect(row.stored.publicationStatus).toBe("failed");
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });

  it("reports connectionUnavailable for an inactive connection", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER,
        status: "revoked",
        providerId: "googleClassroom",
        tokenRef: "fixture-token-ref",
      }),
    });
    addPublished("a1", "2026-01-01T00:00:00Z", { live: liveCoursework() });
    const [row] = (await __lmsCourseworkInspectHandler(request())).assignments;
    expect(row.status).toBe("connectionUnavailable");
    expect(mockFetchAssignment).not.toHaveBeenCalled();
  });
});

describe("lmsCourseworkInspect family reporting", () => {
  it("reports every occurrence independently, oldest first, and marks Current", async () => {
    // Shape of a class whose Current names coursework that no longer exists
    // while a later occurrence's coursework survives.
    occurrences.push(occurrence("a1", "2026-01-01T09:09:00Z", { lmsPublicationRef: undefined }));
    addPublished("a4", "2026-01-02T10:16:00Z", {
      record: { classroomGrading: { mode: "graded", maxPoints: 20 } },
      publication: { classroomGrading: { mode: "graded", maxPoints: 20 } },
      live: liveCoursework({ maxPoints: 20 }),
    });
    addPublished("a2", "2026-01-01T09:10:00Z");
    addPublished("a3", "2026-01-02T09:56:00Z", {
      record: { classroomGrading: { mode: "ungraded" } },
      publication: { classroomGrading: { mode: "ungraded" } },
    });
    mockResolveGroup.mockResolvedValue({
      resolution: "valid",
      currentAssignmentId: "a2",
      current: occurrences[2],
      occurrences,
    });

    const result = await __lmsCourseworkInspectHandler(request());
    expect(result.currentResolution).toBe("valid");
    expect(result.currentAssignmentId).toBe("a2");
    expect(
      result.assignments.map((a) => [a.assignmentId, a.isCurrent, a.status]),
    ).toEqual([
      ["a1", false, "notPublishedToClassroom"],
      ["a2", true, "courseworkNotFound"],
      ["a3", false, "courseworkNotFound"],
      ["a4", false, "healthy"],
    ]);
    // One credential resolution for the shared connection.
    expect(tokenStore.resolve).toHaveBeenCalledTimes(1);
    expect(mockFetchAssignment).toHaveBeenCalledTimes(3);
    expect(mockResolveGroup).toHaveBeenCalledWith(
      { classId: CLASS_ID, lessonSlug: LESSON, teacherId: TEACHER, schoolId: SCHOOL },
      DISTRICT,
      mockLoader,
    );
  });

  it("reports an inactive managed Current without choosing a replacement", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", {
      record: { status: "closed" },
      live: liveCoursework(),
    });
    mockResolveGroup.mockResolvedValue({
      resolution: "inactive",
      currentAssignmentId: "a1",
      occurrences,
    });
    const result = await __lmsCourseworkInspectHandler(request());
    expect(result.currentResolution).toBe("inactive");
    expect(result.currentAssignmentId).toBe("a1");
    expect(result.assignments[0]).toMatchObject({
      isCurrent: true,
      assignmentStatus: "closed",
    });
  });

  it("reports no Current for an unresolved legacy family", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", { live: liveCoursework() });
    const result = await __lmsCourseworkInspectHandler(request());
    expect(result.currentResolution).toBe("unresolved");
    expect(result.currentAssignmentId).toBeNull();
    expect(result.assignments[0].isCurrent).toBe(false);
  });
});

describe("lmsCourseworkInspect credentials", () => {
  it("refreshes an expired credential through the canonical resolver and uses the fresh token", async () => {
    tokenStore.resolve.mockResolvedValue(tokenBundle(Date.now() - 1000));
    tokenStore.persistRefreshedCredential.mockImplementation(
      (input: { refreshed: { accessToken: string } }) =>
        Promise.resolve({
          ...tokenBundle(Date.now() + 3600 * 1000),
          accessToken: input.refreshed.accessToken,
        }),
    );
    addPublished("a1", "2026-01-01T00:00:00Z", { live: liveCoursework() });
    await __lmsCourseworkInspectHandler(request());
    expect(tokenStore.persistRefreshedCredential).toHaveBeenCalledTimes(1);
    expect(mockFetchAssignment.mock.calls[0][0].accessToken).toBe(
      "fixture-access-token-refreshed",
    );
  });

  it("never returns credential material", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", { live: liveCoursework() });
    addPublished("a2", "2026-01-02T00:00:00Z");
    const serialized = JSON.stringify(await __lmsCourseworkInspectHandler(request()));
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain(REFRESH_TOKEN);
    expect(serialized).not.toContain("fixture-token-ref");
    expect(serialized).not.toContain(CONNECTION);
  });

  it("does not persist anything when the stored credential is still valid", async () => {
    addPublished("a1", "2026-01-01T00:00:00Z", { live: liveCoursework() });
    await __lmsCourseworkInspectHandler(request());
    expect(tokenStore.persistRefreshedCredential).not.toHaveBeenCalled();
  });
});
