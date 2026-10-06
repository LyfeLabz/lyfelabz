/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";

// Quiz session continuity - full page reload, as a student actually does it.
//
// Staging regression (Carbon Cycle): a student opened the assignment, answered
// 4 of 10, and reloaded. The quiz came back empty while the teacher still saw
// 4/10. The reloaded page never called `assessmentSessionsBegin`: on the way
// to the quiz the student followed an ordinary in-page link (the sticky nav
// "Quiz", `href="#quiz"`), which REPLACED the launch fragment
// `#assignment=<id>` with `#quiz`. A reload of `...#quiz` carries no
// assignment context, so the page booted as a standalone lesson.
//
// Each "page load" here evaluates the REAL shim and the REAL runtime bundle
// entry against the REAL generated Carbon Cycle v2 quiz script, at the URL the
// previous load left behind, with a stateful fake server.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SHIM_SOURCE = fs.readFileSync(path.join(REPO_ROOT, "assets/lyfelabz-assessment-runtime.js"), "utf8");
const LESSON_HTML = fs.readFileSync(path.join(REPO_ROOT, "app/lessons/lesson_carbon-cycle.html"), "utf8");
const LESSON_PATH = "/app/lessons/lesson_carbon-cycle.html";
const ASSIGNMENT_ID = "a-carbon-cycle-staging-1";
const REF = "0123456789abcdef0123456789abcdef";

type Stored = { itemId: string; response: string };
type Call = { readonly name: string; readonly data: Record<string, unknown> };

// ---- Stateful fake server (one student, one assignment).
const mockServer: { session: { responses: Stored[] } | null; calls: Call[] } = {
  session: null,
  calls: [],
};

jest.mock("firebase/app", () => ({ getApps: () => [], initializeApp: jest.fn(() => ({})) }));
jest.mock("firebase/auth", () => ({
  connectAuthEmulator: jest.fn(),
  getAuth: jest.fn(() => ({})),
  onAuthStateChanged: jest.fn((_auth: unknown, next: (user: unknown) => void) => {
    setTimeout(() => next({ uid: "student-b" }), 0);
    return () => undefined;
  }),
}));
jest.mock("firebase/functions", () => ({
  connectFunctionsEmulator: jest.fn(),
  getFunctions: jest.fn(() => ({})),
  httpsCallable: (_functions: unknown, name: string) => async (data: Record<string, unknown>) => {
    mockServer.calls.push({ name, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown> });
    const revision = { assessmentRevisionId: "assessment_carbon-cycle__r1" };
    if (name === "assessmentSessionsBegin") {
      if (mockServer.session === null) {
        mockServer.session = { responses: [] };
        return { data: { sessionId: "sess-cc", alreadyLive: false, ...revision } };
      }
      return {
        data: { sessionId: "sess-cc", alreadyLive: true, ...revision, responses: mockServer.session.responses },
      };
    }
    if (name === "assessmentSessionsAutosave") {
      mockServer.session!.responses = data.responses as Stored[];
      return { data: { persisted: true } };
    }
    return { data: {} };
  },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await flush();
}

// A real reload discards the previous document's listeners; the shared jsdom
// window does not, so each simulated load removes the previous page's
// hashchange listeners.
const pageListeners: EventListenerOrEventListenerObject[] = [];
const realAddEventListener = window.addEventListener.bind(window);
window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
  if (type === "hashchange") pageListeners.push(listener);
  realAddEventListener(type, listener, options as AddEventListenerOptions);
}) as typeof window.addEventListener;

// One page load at `url`: fresh DOM, the page's own quiz script, then the
// deferred shim, then the runtime bundle (the order a browser runs them in).
async function loadPage(url: string): Promise<void> {
  for (const listener of pageListeners.splice(0)) window.removeEventListener("hashchange", listener);
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
  window.history.replaceState(null, "", url);
  document.body.innerHTML = `
    <script type="application/json" id="lyfelabz-assessment-revision">{"schemaVersion":1,"lessonSlug":"carbon-cycle","assessmentRevisionId":"assessment_carbon-cycle__r1"}</script>
    <nav><a id="nav-quiz" href="#quiz">Quiz</a><a id="nav-vocab" href="#vocab">Vocab</a></nav>
    <div id="vocab"></div>
    <div id="quiz"></div>
    <div id="el-progress"></div><div id="el-progress-text"></div>
    <div id="el-quiz-questions"></div>
    <textarea id="el-thinking"></textarea>
    <div id="el-think-model"></div>
    <button id="el-submit-btn"></button>
    <div id="el-score"><div id="el-score-num"></div><div id="el-score-msg"></div></div>
    <div id="el-submit-status"></div>
    <div id="continue"></div>
  `;
  Element.prototype.scrollIntoView = function () {
    /* jsdom: noop */
  };
  const start = LESSON_HTML.indexOf("var elQuizState");
  const end = LESSON_HTML.indexOf("</script>", start);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    LESSON_HTML.slice(start, end) +
      "\nwindow.elSelectAnswer=elSelectAnswer;window.elQuizState=elQuizState;",
  )();
  // The deferred shim.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(SHIM_SOURCE)();
  // The runtime bundle.
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./entry");
  });
  await settle();
}

const selected = () =>
  (window as unknown as { elQuizState: { selected: Array<number | null> } }).elQuizState.selected;
const select = (qi: number, oi: number) =>
  (document.getElementById(`el-q-${qi}-${oi}`) as HTMLButtonElement).click();
const begins = () => mockServer.calls.filter((c) => c.name === "assessmentSessionsBegin");
const autosaves = () => mockServer.calls.filter((c) => c.name === "assessmentSessionsAutosave");
const stored = () => mockServer.session?.responses ?? [];

// Follow an ordinary in-page link the way a browser does (jsdom performs the
// fragment navigation and fires hashchange).
async function followLink(id: string): Promise<void> {
  (document.getElementById(id) as HTMLAnchorElement).click();
  await settle();
}

const FOUR = [
  { itemId: "q1", response: "B" },
  { itemId: "q2", response: "C" },
  { itemId: "q3", response: "A" },
  { itemId: "q4", response: "D" },
];

beforeEach(() => {
  mockServer.session = null;
  mockServer.calls = [];
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
});

async function answerFourThenNavigateToQuiz(launchUrl: string): Promise<void> {
  await loadPage(launchUrl);
  expect(begins()).toHaveLength(1); // the session begins when the page opens
  await followLink("nav-quiz"); // the student uses the sticky nav to reach the quiz
  select(0, 1);
  select(1, 2);
  select(2, 0);
  select(3, 3);
  await settle();
  expect(stored()).toEqual(FOUR); // the teacher sees 4/10
}

describe("a full reload after in-page navigation restores the student's answers", () => {
  it("keeps the assignment context on the URL when an in-page link replaces the fragment", async () => {
    await loadPage(`${LESSON_PATH}#assignment=${ASSIGNMENT_ID}`);
    await followLink("nav-quiz");
    const params = new URLSearchParams(window.location.hash.slice(1));
    expect(params.get("assignment")).toBe(ASSIGNMENT_ID);
    expect(params.has("quiz")).toBe(true);
    await followLink("nav-vocab");
    expect(new URLSearchParams(window.location.hash.slice(1)).get("assignment")).toBe(ASSIGNMENT_ID);
  });

  it("restores all four persisted answers visibly after reload, without autosaving", async () => {
    await answerFourThenNavigateToQuiz(`${LESSON_PATH}#assignment=${ASSIGNMENT_ID}`);
    const autosavesBeforeReload = autosaves().length;

    await loadPage(window.location.pathname + window.location.search + window.location.hash);

    expect(begins()).toHaveLength(2); // the reload re-entered the assignment
    expect(begins()[1]!.data).toEqual({ assignmentId: ASSIGNMENT_ID });
    expect(selected()).toEqual([1, 2, 0, 3, null, null, null, null, null, null]);
    for (const [qi, oi] of [[0, 1], [1, 2], [2, 0], [3, 3]] as const) {
      expect(document.getElementById(`el-q-${qi}-${oi}`)!.classList.contains("selected")).toBe(true);
    }
    expect(document.getElementById("el-progress-text")!.textContent).toBe("4 / 10 selected");
    expect(autosaves()).toHaveLength(autosavesBeforeReload); // restoring sends nothing
    expect(stored()).toEqual(FOUR); // the teacher still sees 4/10
  });

  it("a fifth answer after the reload keeps the original four (teacher 4/10 -> 5/10)", async () => {
    await answerFourThenNavigateToQuiz(`${LESSON_PATH}#assignment=${ASSIGNMENT_ID}`);
    await loadPage(window.location.pathname + window.location.search + window.location.hash);
    expect(stored()).toHaveLength(4);

    select(4, 1);
    await settle();

    expect(stored()).toEqual([...FOUR, { itemId: "q5", response: "B" }]);
    expect(selected()).toEqual([1, 2, 0, 3, 1, null, null, null, null, null]);
  });

  it("repeated reloads never erase the persisted answers", async () => {
    await answerFourThenNavigateToQuiz(`${LESSON_PATH}#assignment=${ASSIGNMENT_ID}`);
    for (let i = 0; i < 3; i++) {
      await loadPage(window.location.pathname + window.location.search + window.location.hash);
      expect(selected().slice(0, 4)).toEqual([1, 2, 0, 3]);
    }
    expect(stored()).toEqual(FOUR);
  });

  it("a differentiated launch keeps its launchRef across in-page navigation", async () => {
    await loadPage(`${LESSON_PATH}#assignment=${ASSIGNMENT_ID}&launchRef=${REF}`);
    expect(begins()[0]!.data).toEqual({ assignmentId: ASSIGNMENT_ID, launchRef: REF });
    await followLink("nav-quiz");
    const params = new URLSearchParams(window.location.hash.slice(1));
    expect(params.get("assignment")).toBe(ASSIGNMENT_ID);
    expect(params.get("launchRef")).toBe(REF);
  });

  it("a legacy query-form launch is unaffected (the query already survives anchors)", async () => {
    await loadPage(`${LESSON_PATH}?assignment=${ASSIGNMENT_ID}`);
    await followLink("nav-quiz");
    expect(window.location.search).toBe(`?assignment=${ASSIGNMENT_ID}`);
    expect(window.location.hash).toBe("#quiz");
  });

  it("a standalone or practice page stays inert and its links are left alone", async () => {
    await loadPage(LESSON_PATH);
    await followLink("nav-quiz");
    expect(window.location.hash).toBe("#quiz");
    await loadPage(window.location.pathname + window.location.hash);
    select(0, 0);
    await settle();
    expect(mockServer.calls).toEqual([]);
  });
});
