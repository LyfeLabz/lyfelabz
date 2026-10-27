/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";

// Assigned quiz Try Again (new attempts), driven through every shipped v2 quiz page.
//
// Production defect: after an assigned submission, Try Again only rebuilt the
// page. The runtime stayed `finalized`, so the new attempt's answers were never
// autosaved and the second Submit returned the FIRST attempt's cached result:
// the page said "Submitted to your teacher" while nothing was recorded.
//
// Each page load evaluates the page's REAL quiz script, the REAL shim and the
// REAL runtime entry against a stateful fake server that follows the
// certified contract: begin creates or replays the one Live session, a
// committed finalize writes attempt N+1 and deletes the session, and a
// finalize replays by idempotency key.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SHIM_SOURCE = fs.readFileSync(path.join(REPO_ROOT, "assets/lyfelabz-assessment-runtime.js"), "utf8");
const ASSIGNMENT_ID = "a-try-again-1";
const REF = "0123456789abcdef0123456789abcdef";

type Stored = { itemId: string; response: string };
type Call = { readonly name: string; readonly data: Record<string, unknown> };
type MockAttempt = {
  readonly attemptNumber: number;
  readonly idempotencyKey: string;
  readonly responses: Stored[];
  readonly writtenResponse: string | undefined;
};

function mockRefusal(message: string, httpsCode: string, platformCode: string): Error {
  return Object.assign(new Error(message), { code: `functions/${httpsCode}`, details: { code: platformCode } });
}

const mockServer = {
  revision: "",
  session: null as null | { responses: Stored[]; writtenResponse: string | undefined },
  attempts: [] as MockAttempt[],
  calls: [] as Call[],
  beginFailures: [] as Error[],
  reset(revision: string): void {
    this.revision = revision;
    this.session = null;
    this.attempts = [];
    this.calls = [];
    this.beginFailures = [];
  },
  attemptResult(attempt: MockAttempt, replay: boolean) {
    return {
      attemptId: `${ASSIGNMENT_ID}__student-r__a${attempt.attemptNumber}`,
      attemptNumber: attempt.attemptNumber,
      score: 0,
      maxScore: 10,
      percentage: 0,
      itemResults: [],
      replay,
    };
  },
  handle(name: string, data: Record<string, unknown>): unknown {
    this.calls.push({ name, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown> });
    if (name === "assessmentSessionsBegin") {
      const failure = this.beginFailures.shift();
      if (failure !== undefined) throw failure;
      const alreadyLive = this.session !== null;
      if (this.session === null) this.session = { responses: [], writtenResponse: undefined };
      return {
        sessionId: `${ASSIGNMENT_ID}__student-r__1`,
        alreadyLive,
        assessmentRevisionId: this.revision,
        ...(alreadyLive ? { responses: this.session.responses } : {}),
      };
    }
    if (name === "assessmentSessionsAutosave") {
      if (this.session === null) {
        throw mockRefusal("Referenced session was not found.", "not-found", "assessmentSessions.sessionNotFound");
      }
      this.session.responses = data.responses as Stored[];
      if (typeof data.writtenResponse === "string") this.session.writtenResponse = data.writtenResponse;
      return { persisted: true };
    }
    if (name === "assessmentAttemptsFinalize") {
      const key = data.idempotencyKey as string;
      const prior = this.attempts.find((a) => a.idempotencyKey === key);
      if (prior) return this.attemptResult(prior, true);
      if (this.session === null) {
        throw mockRefusal("Referenced session was not found.", "not-found", "assessmentAttempts.sessionNotFound");
      }
      const attempt: MockAttempt = {
        attemptNumber: this.attempts.length + 1,
        idempotencyKey: key,
        responses: this.session.responses,
        writtenResponse: this.session.writtenResponse,
      };
      this.attempts.push(attempt);
      this.session = null;
      return this.attemptResult(attempt, false);
    }
    throw new Error(`unexpected callable ${name}`);
  },
};

// Lets a test hold the finalize callable open (a slow network).
const mockFinalizeGate: { wait: Promise<void> | null } = { wait: null };

jest.mock("firebase/app", () => ({ getApps: () => [], initializeApp: jest.fn(() => ({})) }));
jest.mock("firebase/auth", () => ({
  connectAuthEmulator: jest.fn(),
  getAuth: jest.fn(() => ({})),
  onAuthStateChanged: jest.fn((_auth: unknown, next: (user: unknown) => void) => {
    setTimeout(() => next({ uid: "student-r" }), 0);
    return () => undefined;
  }),
}));
jest.mock("firebase/functions", () => ({
  connectFunctionsEmulator: jest.fn(),
  getFunctions: jest.fn(() => ({})),
  httpsCallable: (_functions: unknown, name: string) => async (data: Record<string, unknown>) => {
    if (name === "assessmentAttemptsFinalize" && mockFinalizeGate.wait !== null) await mockFinalizeGate.wait;
    return { data: mockServer.handle(name, data) };
  },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await flush();
}

Element.prototype.scrollIntoView = function () {
  /* jsdom: noop */
};

// ---- Every shipped page that carries an assigned quiz.

type QuizPage = { readonly file: string; readonly prefix: string };

function listQuizPages(): QuizPage[] {
  const dirs = ["app/lessons", "app/lessons/assessment-revisions", "app/lessons/variants"];
  const pages: QuizPage[] = [];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(path.join(REPO_ROOT, dir)).sort()) {
      if (!/^lesson_.*\.html$/.test(name)) continue;
      const html = fs.readFileSync(path.join(REPO_ROOT, dir, name), "utf8");
      const prefix = /function (\w+)SubmitQuiz\(/.exec(html)?.[1];
      if (prefix !== undefined && html.includes("lessonQuiz.finalize(")) {
        pages.push({ file: `${dir}/${name}`, prefix });
      }
    }
  }
  return pages;
}

const ALL_PAGES = listQuizPages();
// Renewable and Nonrenewable Resources (canonical and its revision renditions)
// already hides and blocks Try Again in assignment context; it keeps that
// certified behavior and is covered separately below.
const isRenewable = (p: QuizPage) => p.file.includes("lesson_renewable-and-nonrenewable-resources");
const TRY_AGAIN_PAGES = ALL_PAGES.filter((p) => !isRenewable(p));
const RENEWABLE_PAGES = ALL_PAGES.filter(isRenewable);

function pageRevision(html: string, file: string): string {
  const declared = /"assessmentRevisionId"\s*:\s*"(assessment_[a-z0-9-]+__r\d+)"/.exec(html)?.[1];
  if (declared !== undefined) return declared;
  const slug = /lesson_([a-z0-9-]+?)(?:__|\.html)/.exec(path.basename(file))![1];
  return `assessment_${slug}__r1`;
}

type Page = {
  readonly select: (qi: number, oi: number) => void;
  readonly submit: () => void;
  readonly reset: () => void;
  readonly questions: ReadonlyArray<{ readonly options: readonly unknown[]; readonly correct: number }>;
  readonly status: () => string;
  readonly think: (text: string) => void;
};

// One page load: the real document, the page's own quiz script, then the
// deferred shim, then the runtime bundle (the order a browser runs them in).
async function loadPage(page: QuizPage, url: string): Promise<Page> {
  const html = fs.readFileSync(path.join(REPO_ROOT, page.file), "utf8");
  mockServer.reset(pageRevision(html, page.file));
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
  window.history.replaceState(null, "", url);
  // Scripts inserted through innerHTML never run; the JSON declarations stay.
  // Styles are dropped: jsdom cannot parse some of them and they carry no
  // quiz behavior.
  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<html[^>]*>/i, "")
    .replace(/<\/html>\s*$/i, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const p = page.prefix;
  const marker = html.indexOf(`function ${p}SubmitQuiz(`);
  const open = html.lastIndexOf("<script>", marker);
  const close = html.indexOf("</script>", marker);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    html.slice(open + "<script>".length, close) +
      `\nwindow.__quiz={select:${p}SelectAnswer,submit:${p}SubmitQuiz,reset:${p}ResetQuiz,questions:${p}QuizQuestions};` +
      `window.${p}SelectAnswer=${p}SelectAnswer;window.${p}ResetQuiz=${p}ResetQuiz;`,
  )();
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(SHIM_SOURCE)();
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./entry");
  });
  await settle();
  const api = (window as unknown as { __quiz: Omit<Page, "status" | "think"> }).__quiz;
  return {
    ...api,
    status: () => document.getElementById(`${p}-submit-status`)?.textContent ?? "",
    think: (text: string) => {
      const box = document.getElementById(`${p}-thinking`) as HTMLTextAreaElement | null;
      if (box) {
        box.value = text;
        box.dispatchEvent(new Event("input"));
      }
    },
  };
}

const assignedUrl = (page: QuizPage) => `/${page.file}#assignment=${ASSIGNMENT_ID}`;
const named = (name: string) => mockServer.calls.filter((c) => c.name === name);
const begins = () => named("assessmentSessionsBegin");
const finalizes = () => named("assessmentAttemptsFinalize");

// Answers attempt `n` with a distinct pattern: 0 = every first option,
// 1 = every correct option, 2 = every second option.
function answerAll(page: Page, n: number): number[] {
  return page.questions.map((q, qi) => {
    const oi = n === 1 ? q.correct : Math.min(n === 0 ? 0 : 1, q.options.length - 1);
    page.select(qi, oi);
    return oi;
  });
}

async function takeAttempt(page: Page, n: number): Promise<void> {
  answerAll(page, n);
  page.think(`Explanation for attempt ${n + 1}.`);
  await settle();
  page.submit();
  // Never reported as recorded before the server answered.
  expect(page.status()).not.toContain("Submitted to your teacher");
  await settle();
}

afterEach(() => {
  mockFinalizeGate.wait = null;
});

describe("assigned quiz Try Again on every shipped v2 quiz page", () => {
  test("the sweep covers the canonical, revision-rendition and variant pages", () => {
    expect(TRY_AGAIN_PAGES.filter((p) => p.file.startsWith("app/lessons/lesson_")).length).toBe(48);
    expect(TRY_AGAIN_PAGES.some((p) => p.file.includes("/assessment-revisions/"))).toBe(true);
    expect(TRY_AGAIN_PAGES.some((p) => p.file.includes("/variants/"))).toBe(true);
    expect(RENEWABLE_PAGES.length).toBeGreaterThan(0);
  });

  test.each(TRY_AGAIN_PAGES.map((p) => [p.file, p] as const))(
    "%s: first, second and third attempts are each recorded as a new attempt",
    async (_file, quizPage) => {
      const page = await loadPage(quizPage, assignedUrl(quizPage));
      for (let n = 0; n < 3; n++) {
        if (n > 0) {
          page.reset();
          expect(page.status()).not.toContain("Submitted to your teacher");
        }
        await takeAttempt(page, n);
        expect(mockServer.attempts).toHaveLength(n + 1);
        expect(page.status()).toContain("Submitted to your teacher");
      }
      expect(begins()).toHaveLength(3);
      expect(new Set(finalizes().map((c) => c.data.idempotencyKey)).size).toBe(3);
      expect(mockServer.attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
      const answerSets = mockServer.attempts.map((a) => JSON.stringify(a.responses));
      expect(new Set(answerSets).size).toBe(3);
      expect(mockServer.attempts.map((a) => a.writtenResponse)).toEqual([
        "Explanation for attempt 1.",
        "Explanation for attempt 2.",
        "Explanation for attempt 3.",
      ]);
      // Every begin targets the same assignment; no attempt is replayed.
      expect(begins().every((c) => c.data.assignmentId === ASSIGNMENT_ID)).toBe(true);
    },
  );
});

describe("assigned quiz Try Again - submission edge cases (Earth's Layers)", () => {
  const EARTHS_LAYERS = ALL_PAGES.find((p) => p.file === "app/lessons/lesson_earths-layers.html")!;

  test("duplicate Submit clicks record one attempt", async () => {
    const page = await loadPage(EARTHS_LAYERS, assignedUrl(EARTHS_LAYERS));
    answerAll(page, 0);
    page.think("Because.");
    await settle();
    page.submit();
    page.submit();
    page.submit();
    await settle();
    expect(finalizes()).toHaveLength(1);
    expect(mockServer.attempts).toHaveLength(1);
    expect(page.status()).toContain("Submitted to your teacher");
  });

  test("Try Again without answering creates no session; answering starts one", async () => {
    const page = await loadPage(EARTHS_LAYERS, assignedUrl(EARTHS_LAYERS));
    await takeAttempt(page, 0);
    page.reset();
    await settle();
    expect(begins()).toHaveLength(1);
    page.select(0, 1);
    await settle();
    expect(begins()).toHaveLength(2);
    expect(mockServer.session?.responses).toHaveLength(1);
  });

  test("Try Again while the first submission is in flight never shows its outcome over the new attempt", async () => {
    const page = await loadPage(EARTHS_LAYERS, assignedUrl(EARTHS_LAYERS));
    let release: () => void = () => undefined;
    mockFinalizeGate.wait = new Promise<void>((resolve) => (release = resolve));
    answerAll(page, 0);
    page.think("First.");
    await settle();
    page.submit();
    await settle();
    expect(page.status()).toContain("Submitting");
    page.reset();
    page.select(0, 1);
    release();
    await settle();
    expect(mockServer.attempts).toHaveLength(1);
    expect(page.status()).not.toContain("Submitted to your teacher");
    expect(page.status()).not.toContain("Could not submit");
    // The new attempt still completes as its own attempt.
    mockFinalizeGate.wait = null;
    await takeAttempt(page, 1);
    expect(mockServer.attempts).toHaveLength(2);
    expect(page.status()).toContain("Submitted to your teacher");
  });

  test("a new attempt that cannot begin (window closed) reports why and claims nothing", async () => {
    const page = await loadPage(EARTHS_LAYERS, assignedUrl(EARTHS_LAYERS));
    await takeAttempt(page, 0);
    mockServer.beginFailures.push(
      mockRefusal("Assignment window has closed.", "failed-precondition", "assignment-window-closed"),
    );
    page.reset();
    await takeAttempt(page, 1);
    expect(mockServer.attempts).toHaveLength(1);
    expect(page.status()).toContain("Could not submit: Assignment window has closed.");
    expect(page.status()).not.toContain("Submitted to your teacher");
  });

  test("a transient begin failure on a new attempt is retried and the attempt is recorded", async () => {
    const page = await loadPage(EARTHS_LAYERS, assignedUrl(EARTHS_LAYERS));
    await takeAttempt(page, 0);
    mockServer.beginFailures.push(mockRefusal("Service unavailable.", "unavailable", "unavailable"));
    page.reset();
    await takeAttempt(page, 1);
    expect(mockServer.attempts).toHaveLength(2);
    expect(page.status()).toContain("Submitted to your teacher");
  });

  test("a session submitted from another tab gets an actionable message, not a false success", async () => {
    const page = await loadPage(EARTHS_LAYERS, assignedUrl(EARTHS_LAYERS));
    answerAll(page, 0);
    page.think("Mine.");
    await settle();
    // Another tab on the same assignment submits the shared Live session.
    mockServer.attempts.push({ attemptNumber: 1, idempotencyKey: "other-tab", responses: [], writtenResponse: undefined });
    mockServer.session = null;
    page.submit();
    await settle();
    expect(mockServer.attempts).toHaveLength(1);
    expect(page.status()).toContain("already submitted in another tab or window");
    expect(page.status()).toContain("go back to My Science and open the assignment again");
    expect(page.status()).not.toContain("Submitted to your teacher");
  });
});

describe("assigned quiz Try Again - accommodation (differentiated variant launch)", () => {
  const VARIANT = ALL_PAGES.find((p) => p.file.startsWith("app/lessons/variants/lesson_earths-layers__"))!;

  test("every attempt begins with the same assignment and launch grant", async () => {
    const page = await loadPage(VARIANT, `/${VARIANT.file}#assignment=${ASSIGNMENT_ID}&launchRef=${REF}`);
    await takeAttempt(page, 0);
    page.reset();
    await takeAttempt(page, 1);
    expect(mockServer.attempts).toHaveLength(2);
    expect(begins().map((c) => c.data)).toEqual([
      { assignmentId: ASSIGNMENT_ID, launchRef: REF },
      { assignmentId: ASSIGNMENT_ID, launchRef: REF },
    ]);
    expect(page.status()).toContain("Submitted to your teacher");
  });
});

describe("Renewable and Nonrenewable Resources keeps its certified assigned behavior", () => {
  test.each(RENEWABLE_PAGES.map((p) => [p.file, p] as const))(
    "%s: after an assigned submission Try Again stays blocked and never restarts",
    async (_file, quizPage) => {
      const page = await loadPage(quizPage, assignedUrl(quizPage));
      await takeAttempt(page, 0);
      expect(mockServer.attempts).toHaveLength(1);
      expect(page.status()).toContain("Submitted to your teacher");
      expect((document.getElementById("el-reset-btn") as HTMLButtonElement).hidden).toBe(true);
      page.reset();
      page.select(0, 1);
      page.submit();
      await settle();
      expect(begins()).toHaveLength(1);
      expect(finalizes()).toHaveLength(1);
      expect(page.status()).toContain("Submitted to your teacher");
    },
  );
});

describe("exploration (no assignment) is untouched", () => {
  test("Try Again and Submit make no backend call", async () => {
    const quizPage = ALL_PAGES.find((p) => p.file === "app/lessons/lesson_earths-layers.html")!;
    const page = await loadPage(quizPage, `/${quizPage.file}`);
    await takeAttempt(page, 0);
    page.reset();
    await takeAttempt(page, 1);
    expect(mockServer.calls).toHaveLength(0);
    expect(page.status()).toContain("Exploration mode");
  });
});
