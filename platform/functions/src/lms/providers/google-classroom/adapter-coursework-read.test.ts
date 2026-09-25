// Coursework health read: googleClassroomAdapter.fetchAssignment and the
// HTTPS transport's getCourseWork. Read-only by contract. Every identifier
// is fictional.

import { logger } from "firebase-functions";

import { PlatformError } from "../../../shared";
import { googleClassroomAdapter } from "./adapter";
import {
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
} from "./config";
import {
  FIXTURE_ACCESS_TOKEN,
  createFixtureGoogleClassroomTransport,
  type GoogleClassroomFixtureOptions,
} from "./__fixtures__/fixture-transport";
import {
  createHttpsGoogleClassroomTransport,
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
  type HttpsFetch,
} from "./transport";

const FIXTURE_CONFIG = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
} as const;

const COURSE_ID = "fixture-course-coursework-health";
const COURSE_WORK_ID = "fixture-coursework-001";

const GRADED_COURSE_WORK = {
  id: COURSE_WORK_ID,
  courseId: COURSE_ID,
  title: "Fictional Lesson",
  state: "PUBLISHED",
  workType: "ASSIGNMENT",
  maxPoints: 20,
  creationTime: "2026-01-05T14:16:58.535Z",
  updateTime: "2026-01-06T09:00:00.000Z",
  dueDate: { year: 2026, month: 1, day: 7 },
  dueTime: { hours: 4, minutes: 59 },
  alternateLink: "https://classroom.google.com/c/fixture/a/fixture/details",
};

function setupFixture(options: GoogleClassroomFixtureOptions = {}) {
  const transport = createFixtureGoogleClassroomTransport(options);
  setGoogleClassroomTransport(transport);
  setGoogleClassroomConfig(FIXTURE_CONFIG);
  return transport;
}

async function fetchError(): Promise<PlatformError> {
  try {
    await googleClassroomAdapter.fetchAssignment({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_ID,
      lmsAssignmentId: COURSE_WORK_ID,
    });
  } catch (err) {
    if (err instanceof PlatformError) return err;
    throw err;
  }
  throw new Error("fetchAssignment should have rejected");
}

afterEach(() => {
  resetGoogleClassroomTransportForTests();
  resetGoogleClassroomConfigForTests();
});

describe("googleClassroomAdapter.fetchAssignment", () => {
  it("normalizes a graded, published coursework item", async () => {
    setupFixture({
      courseWork: [{ courseId: COURSE_ID, courseWork: GRADED_COURSE_WORK }],
    });
    const snapshot = await googleClassroomAdapter.fetchAssignment({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_ID,
      lmsAssignmentId: COURSE_WORK_ID,
    });
    expect(snapshot).toEqual({
      lmsAssignmentId: COURSE_WORK_ID,
      title: "Fictional Lesson",
      state: "published",
      maxPoints: 20,
      createdAt: "2026-01-05T14:16:58.535Z",
      updatedAt: "2026-01-06T09:00:00.000Z",
      dueDate: "2026-01-07",
      dueTime: "04:59",
      lmsAssignmentUrl: "https://classroom.google.com/c/fixture/a/fixture/details",
    });
  });

  it("omits maxPoints for ungraded coursework (absent or zero)", async () => {
    setupFixture({
      courseWork: [
        {
          courseId: COURSE_ID,
          courseWork: { id: COURSE_WORK_ID, state: "PUBLISHED", maxPoints: 0 },
        },
      ],
    });
    const snapshot = await googleClassroomAdapter.fetchAssignment({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_ID,
      lmsAssignmentId: COURSE_WORK_ID,
    });
    expect(snapshot).toEqual({ lmsAssignmentId: COURSE_WORK_ID, state: "published" });
  });

  it.each([
    ["DRAFT", "draft"],
    ["DELETED", "deleted"],
    ["COURSE_WORK_STATE_UNSPECIFIED", "other"],
  ])("maps Classroom state %s to %s", async (upstream, expected) => {
    setupFixture({
      courseWork: [
        { courseId: COURSE_ID, courseWork: { id: COURSE_WORK_ID, state: upstream } },
      ],
    });
    const snapshot = await googleClassroomAdapter.fetchAssignment({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_ID,
      lmsAssignmentId: COURSE_WORK_ID,
    });
    expect(snapshot.state).toBe(expected);
  });

  it("reports missing/deleted coursework as lms.upstreamResourceNotFound", async () => {
    setupFixture();
    expect((await fetchError()).code).toBe("lms.upstreamResourceNotFound");
  });

  it.each([
    ["permission-denied", "lms.upstreamAuthorizationFailed"],
    ["insufficient-scope", "lms.insufficientScope"],
    ["authorization-failure", "lms.upstreamAuthorizationFailed"],
    ["failed-precondition", "lms.upstreamCallFailed"],
    ["internal-error", "lms.upstreamCallFailed"],
    ["temporary-unavailable", "lms.upstreamTemporarilyUnavailable"],
  ] as const)("translates %s to %s", async (mode, code) => {
    setupFixture({ courseWorkReadFailureMode: mode });
    expect((await fetchError()).code).toBe(code);
  });

  it("rejects a response whose id does not match the requested coursework", async () => {
    const transport = createFixtureGoogleClassroomTransport();
    setGoogleClassroomTransport({
      ...transport,
      getCourseWork: () => Promise.resolve({ id: "some-other-coursework" }),
    });
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    expect((await fetchError()).code).toBe("lms.upstreamMalformedResponse");
  });

  it("performs only the read: no coursework creation and no grade calls", async () => {
    const transport = setupFixture({
      courseWork: [{ courseId: COURSE_ID, courseWork: GRADED_COURSE_WORK }],
    });
    await googleClassroomAdapter.fetchAssignment({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_ID,
      lmsAssignmentId: COURSE_WORK_ID,
    });
    const log = transport.log();
    expect(log.getCourseWorkCalls).toBe(1);
    expect(log.courseWorkCreateCalls).toBe(0);
    expect(log.listStudentSubmissionsCalls).toBe(0);
    expect(log.patchStudentSubmissionGradeCalls).toBe(0);
  });
});

describe("HTTPS transport getCourseWork", () => {
  type Recorded = { url: string; method: string; body?: string };

  // The transport's upstream diagnostic is a structured warning; keep test
  // output quiet.
  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function httpsAdapterWith(status: number, body: unknown): Recorded[] {
    const recorded: Recorded[] = [];
    const fetchImpl: HttpsFetch = (input, init) => {
      recorded.push({
        url: input,
        method: init.method,
        ...(init.body !== undefined ? { body: init.body } : {}),
      });
      return Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        text: () => Promise.resolve(JSON.stringify(body)),
      });
    };
    setGoogleClassroomTransport(
      createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CONFIG.clientId,
          clientSecret: FIXTURE_CONFIG.clientSecret,
        }),
        fetchImpl,
      }),
    );
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    return recorded;
  }

  it("issues a single GET on the coursework resource with a fields mask and no body", async () => {
    const recorded = httpsAdapterWith(200, GRADED_COURSE_WORK);
    const snapshot = await googleClassroomAdapter.fetchAssignment({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_ID,
      lmsAssignmentId: COURSE_WORK_ID,
    });
    expect(snapshot.maxPoints).toBe(20);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].method).toBe("GET");
    expect(recorded[0].body).toBeUndefined();
    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe(`/v1/courses/${COURSE_ID}/courseWork/${COURSE_WORK_ID}`);
    expect(url.searchParams.get("fields")).toBe(
      "id,courseId,title,state,workType,maxPoints,creationTime,updateTime,dueDate,dueTime,alternateLink",
    );
  });

  it.each([
    [404, "NOT_FOUND", "lms.upstreamResourceNotFound"],
    [403, "PERMISSION_DENIED", "lms.upstreamAuthorizationFailed"],
    [400, "FAILED_PRECONDITION", "lms.upstreamCallFailed"],
    [500, "INTERNAL", "lms.upstreamCallFailed"],
  ])("maps HTTP %i %s to %s", async (status, upstreamStatus, code) => {
    httpsAdapterWith(status, {
      error: { code: status, status: upstreamStatus, message: "fixture" },
    });
    expect((await fetchError()).code).toBe(code);
  });
});

describe("googleClassroomAdapter.listSubmissionGrades", () => {
  const submissions = [
    { id: "s1", userId: "u1", courseWorkId: COURSE_WORK_ID, state: "TURNED_IN", assignedGrade: 18, draftGrade: 18 },
    { id: "s2", userId: "u2", courseWorkId: COURSE_WORK_ID, state: "CREATED", late: true, draftGrade: 0 },
    { id: "s3", userId: "u3", courseWorkId: COURSE_WORK_ID, state: "RETURNED", assignedGrade: 16.5 },
    { id: "s4", userId: "u4", courseWorkId: COURSE_WORK_ID, state: "RECLAIMED_BY_STUDENT" },
    { id: "s5", userId: "u5", courseWorkId: COURSE_WORK_ID, state: "NEW", assignedGrade: -1 },
  ];

  it("normalizes every submission across pages", async () => {
    const transport = setupFixture({
      courseWorkSubmissions: [{ courseId: COURSE_ID, courseWorkId: COURSE_WORK_ID, submissions }],
    });
    const grades = await googleClassroomAdapter.listSubmissionGrades({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_ID,
      lmsAssignmentId: COURSE_WORK_ID,
    });
    expect(grades).toEqual([
      { submissionId: "s1", studentProviderAccountId: "u1", state: "turnedIn", late: false, assignedGrade: 18, draftGrade: 18 },
      { submissionId: "s2", studentProviderAccountId: "u2", state: "created", late: true, assignedGrade: null, draftGrade: 0 },
      { submissionId: "s3", studentProviderAccountId: "u3", state: "returned", late: false, assignedGrade: 16.5, draftGrade: null },
      { submissionId: "s4", studentProviderAccountId: "u4", state: "reclaimed", late: false, assignedGrade: null, draftGrade: null },
      // A negative grade is not a valid Classroom grade; treated as unset.
      { submissionId: "s5", studentProviderAccountId: "u5", state: "new", late: false, assignedGrade: null, draftGrade: null },
    ]);
    const log = transport.log();
    // Fixture page size is 2: five submissions take three pages.
    expect(log.listCourseWorkSubmissionsCalls).toBe(3);
    expect(log.listStudentSubmissionsCalls).toBe(0);
    expect(log.patchStudentSubmissionGradeCalls).toBe(0);
    expect(log.courseWorkCreateCalls).toBe(0);
  });

  it("rejects a malformed submission rather than returning a partial list", async () => {
    setupFixture({
      courseWorkSubmissions: [
        { courseId: COURSE_ID, courseWorkId: COURSE_WORK_ID, submissions: [{ id: "s1" }] },
      ],
    });
    await expect(
      googleClassroomAdapter.listSubmissionGrades({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: COURSE_ID,
        lmsAssignmentId: COURSE_WORK_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamMalformedResponse" });
  });

  it.each([
    ["permission-denied", "lms.upstreamAuthorizationFailed"],
    ["failed-precondition", "lms.upstreamCallFailed"],
    ["internal-error", "lms.upstreamCallFailed"],
  ] as const)("translates %s to %s", async (mode, code) => {
    setupFixture({
      courseWorkSubmissions: [{ courseId: COURSE_ID, courseWorkId: COURSE_WORK_ID, submissions }],
      courseWorkSubmissionsFailureMode: mode,
    });
    await expect(
      googleClassroomAdapter.listSubmissionGrades({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: COURSE_ID,
        lmsAssignmentId: COURSE_WORK_ID,
      }),
    ).rejects.toMatchObject({ code });
  });
});

describe("HTTPS transport listCourseWorkSubmissions", () => {
  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("issues a GET for every student (no userId filter) with a grade-only fields mask", async () => {
    const recorded: { url: string; method: string; body?: string }[] = [];
    const fetchImpl: HttpsFetch = (input, init) => {
      recorded.push({ url: input, method: init.method, ...(init.body !== undefined ? { body: init.body } : {}) });
      return Promise.resolve({
        status: 200,
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              studentSubmissions: [
                { id: "s1", userId: "u1", courseWorkId: COURSE_WORK_ID, state: "TURNED_IN", assignedGrade: 20, draftGrade: 20 },
              ],
            }),
          ),
      });
    };
    setGoogleClassroomTransport(
      createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({ clientId: FIXTURE_CONFIG.clientId, clientSecret: FIXTURE_CONFIG.clientSecret }),
        fetchImpl,
      }),
    );
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    const grades = await googleClassroomAdapter.listSubmissionGrades({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_ID,
      lmsAssignmentId: COURSE_WORK_ID,
    });
    expect(grades[0].assignedGrade).toBe(20);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].method).toBe("GET");
    expect(recorded[0].body).toBeUndefined();
    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe(
      `/v1/courses/${COURSE_ID}/courseWork/${COURSE_WORK_ID}/studentSubmissions`,
    );
    expect(url.searchParams.get("userId")).toBeNull();
    expect(url.searchParams.get("pageSize")).toBe("100");
    expect(url.searchParams.get("fields")).toBe(
      "studentSubmissions(id,userId,courseWorkId,state,late,assignedGrade,draftGrade),nextPageToken",
    );
  });
});
