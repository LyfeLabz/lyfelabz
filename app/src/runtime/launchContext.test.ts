/**
 * @jest-environment jsdom
 */

// Launch-URL hardening (security backlog SECURITY_BACKLOG_LAUNCH_URL_ANALYTICS.md):
// the launcher now hands the assignment context and the launch-grant reference
// to the lesson page in the URL FRAGMENT (`#assignment=...&launchRef=...`)
// instead of the query string. The assessment runtime itself is unchanged: it
// reads the query first and then the fragment. These tests drive the REAL
// runtime bootstrap (the module's own load-time bootstrap) against a jsdom URL
// and fake Firebase callables, and assert exactly what `assessmentSessionsBegin`
// receives. No page, network, or Firebase project is involved.

type Call = { readonly name: string; readonly data: Record<string, unknown> };
const mockCalls: Call[] = [];

jest.mock("firebase/app", () => ({ getApps: () => [], initializeApp: jest.fn(() => ({})) }));
jest.mock("firebase/auth", () => ({
  connectAuthEmulator: jest.fn(),
  getAuth: jest.fn(() => ({})),
  // Asynchronous, like the real SDK (the runtime unsubscribes inside the callback).
  onAuthStateChanged: jest.fn((_auth: unknown, next: (user: unknown) => void) => {
    setTimeout(() => next({ uid: "student-1" }), 0);
    return () => undefined;
  }),
}));
jest.mock("firebase/functions", () => ({
  connectFunctionsEmulator: jest.fn(),
  getFunctions: jest.fn(() => ({})),
  httpsCallable: (_functions: unknown, name: string) => async (data: Record<string, unknown>) => {
    mockCalls.push({ name, data });
    if (name === "assessmentSessionsBegin") {
      return { data: { sessionId: "s1", alreadyLive: false, assessmentRevisionId: "assessment_earths-layers__r1" } };
    }
    return { data: { persisted: true } };
  },
}));

type LessonQuiz = {
  hasAssignmentContext(): boolean;
  autosave(selections: ReadonlyArray<number | null>): Promise<unknown>;
};

const REF = "0123456789abcdef0123456789abcdef";
const OTHER_REF = "fedcba9876543210fedcba9876543210";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Boot the runtime as a lesson page would, at `url` (path, query, and/or
// fragment). A fresh module registry and a cleared namespace emulate a fresh
// page load (including a reload of the same URL).
async function bootAt(url: string): Promise<LessonQuiz> {
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
  window.history.replaceState(null, "", url);
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./entry");
  });
  for (let i = 0; i < 5; i++) await flush();
  return (window as unknown as { lyfelabz: { lessonQuiz: LessonQuiz } }).lyfelabz.lessonQuiz;
}

async function beginPayloadAt(url: string): Promise<Record<string, unknown> | undefined> {
  mockCalls.length = 0;
  const quiz = await bootAt(url);
  expect(quiz.hasAssignmentContext()).toBe(true);
  await quiz.autosave([0]);
  for (let i = 0; i < 5; i++) await flush();
  return mockCalls.find((c) => c.name === "assessmentSessionsBegin")?.data;
}

afterEach(() => {
  mockCalls.length = 0;
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
});

describe("the runtime reads the launch context from the fragment (hardened launcher)", () => {
  test("a canonical launch (#assignment only) begins with exactly that assignment and no launchRef", async () => {
    expect(await beginPayloadAt("/app/lessons/lesson_what-is-life.html#assignment=asg-1")).toEqual({ assignmentId: "asg-1" });
  });

  test("a canonicalFallback or differentiated launch (#assignment&launchRef) transports the ref to begin", async () => {
    expect(await beginPayloadAt(`/app/lessons/assessment-revisions/lesson_earths-layers__r1.html#assignment=asg-1&launchRef=${REF}`)).toEqual({
      assignmentId: "asg-1",
      launchRef: REF,
    });
  });

  test("autosave still sends the displayed response after a fragment launch", async () => {
    await beginPayloadAt(`/app/lessons/lesson_what-is-life.html#assignment=asg-1&launchRef=${REF}`);
    const autosave = mockCalls.find((c) => c.name === "assessmentSessionsAutosave");
    expect(autosave?.data).toEqual({ sessionId: "s1", responses: [{ itemId: "q1", response: "A" }] });
  });

  test("a reload of the same fragment URL keeps the assignment context", async () => {
    const url = `/app/lessons/lesson_what-is-life.html#assignment=asg-1&launchRef=${REF}`;
    expect(await beginPayloadAt(url)).toEqual({ assignmentId: "asg-1", launchRef: REF });
    expect(await beginPayloadAt(url)).toEqual({ assignmentId: "asg-1", launchRef: REF });
  });
});

describe("legacy query-form links keep working", () => {
  test("?assignment only", async () => {
    expect(await beginPayloadAt("/app/lessons/lesson_what-is-life.html?assignment=asg-1")).toEqual({ assignmentId: "asg-1" });
  });

  test("?assignment&launchRef", async () => {
    expect(await beginPayloadAt(`/app/lessons/lesson_what-is-life.html?assignment=asg-1&launchRef=${REF}`)).toEqual({
      assignmentId: "asg-1",
      launchRef: REF,
    });
  });
});

describe("query-vs-fragment precedence (intentionally unchanged: query first, then fragment)", () => {
  test("when both carry a value, the query value is used for each parameter", async () => {
    expect(
      await beginPayloadAt(`/app/lessons/lesson_what-is-life.html?assignment=from-query&launchRef=${REF}#assignment=from-fragment&launchRef=${OTHER_REF}`),
    ).toEqual({ assignmentId: "from-query", launchRef: REF });
  });

  test("each parameter falls back to the fragment independently", async () => {
    expect(await beginPayloadAt(`/app/lessons/lesson_what-is-life.html?assignment=asg-1#launchRef=${REF}`)).toEqual({
      assignmentId: "asg-1",
      launchRef: REF,
    });
  });
});

describe("no assignment context", () => {
  test("a practice or public URL (no assignment anywhere) stays inert: no Firebase call", async () => {
    mockCalls.length = 0;
    const quiz = await bootAt("/app/lessons/lesson_what-is-life.html");
    expect(quiz.hasAssignmentContext()).toBe(false);
    expect(mockCalls).toEqual([]);
  });

  test("a launchRef without an assignment is not assignment context", async () => {
    mockCalls.length = 0;
    const quiz = await bootAt(`/app/lessons/lesson_what-is-life.html#launchRef=${REF}`);
    expect(quiz.hasAssignmentContext()).toBe(false);
    expect(mockCalls).toEqual([]);
  });
});
