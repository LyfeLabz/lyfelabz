/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";

// Quiz session continuity. An assignment page begins its session when it
// opens; on a reload that begin replays the student's existing Live session,
// the persisted answers are restored into the lesson's own quiz UI by stable
// item/option identity, and every later autosave keeps them, so a reload can
// never replace persisted progress with a smaller set.
// Drives the REAL generated v2 Earth's Layers quiz script, the REAL lesson
// adapter (entry.ts), and the REAL orchestrator over fake callables.

jest.mock("firebase/app", () => ({ getApps: () => [], initializeApp: jest.fn() }));
jest.mock("firebase/auth", () => ({
  connectAuthEmulator: jest.fn(),
  getAuth: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));
jest.mock("firebase/functions", () => ({
  connectFunctionsEmulator: jest.fn(),
  getFunctions: jest.fn(),
  httpsCallable: () => async () => ({ data: {} }),
}));

import { __internal } from "./entry";
import { createAssessmentRuntime } from "./orchestrator";
import type {
  BeginCallable,
  FinalizeResult,
  RuntimeCallables,
  SessionResponse,
} from "./types";

const V2_LESSON_PATH = path.resolve(__dirname, "../../../app/lessons/lesson_earths-layers.html");

const FINALIZE_RESULT: FinalizeResult = {
  attemptId: "asg-1__student-1__a1",
  attemptNumber: 1,
  score: 10,
  maxScore: 10,
  percentage: 100,
  itemResults: [],
  replay: false,
};

type Harness = {
  readonly runtime: ReturnType<typeof createAssessmentRuntime>;
  readonly autosaves: Array<readonly SessionResponse[]>;
  readonly begins: () => number;
};

function harness(opts: {
  readonly begin?: BeginCallable;
  readonly withPageAdoption?: boolean;
}): Harness {
  const autosaves: Array<readonly SessionResponse[]> = [];
  let begins = 0;
  const begin: BeginCallable = opts.begin ?? (async () => ({ sessionId: "sess-1", alreadyLive: false }));
  const callables: RuntimeCallables = {
    begin: async (assignmentId, launchRef) => {
      begins += 1;
      return begin(assignmentId, launchRef);
    },
    autosave: async (_sessionId, responses) => {
      autosaves.push(responses);
      return { persisted: true };
    },
    finalize: async () => FINALIZE_RESULT,
    getAttempt: async () => {
      throw new Error("unused");
    },
  };
  const guard = { restoring: false };
  const runtime = createAssessmentRuntime({
    version: "test",
    assignmentId: "asg-1",
    callables,
    env: { randomId: () => "idk" },
    ...(opts.withPageAdoption === false
      ? {}
      : { adoptPersisted: (state) => __internal.adoptPersistedForPage(window, state, guard) }),
  });
  const win = window as unknown as Parameters<typeof __internal.installLessonQuiz>[0];
  __internal.installLessonQuiz(win, runtime, true, guard);
  return { runtime, autosaves, begins: () => begins };
}

// ---- The real generated lesson quiz (v2 Earth's Layers, canonical page).

function mountLesson(): void {
  document.body.innerHTML = `
    <div id="el-progress"></div><div id="el-progress-text"></div>
    <div id="el-quiz-questions"></div>
    <textarea id="el-thinking"></textarea>
    <div id="el-think-model"></div>
    <button id="el-submit-btn"></button>
    <div id="el-score"><div id="el-score-num"></div><div id="el-score-msg"></div></div>
    <div id="el-submit-status"></div>
    <div id="quiz"></div><div id="continue"></div>
  `;
  Element.prototype.scrollIntoView = function () {
    /* jsdom: noop */
  };
  const html = fs.readFileSync(V2_LESSON_PATH, "utf8");
  const start = html.indexOf("var elQuizState");
  const end = html.indexOf("</script>", start);
  // The option buttons call `elSelectAnswer(qi,oi)` from their inline onclick,
  // which jsdom evaluates in the window scope.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    html.slice(start, end) +
      "\nwindow.elSelectAnswer=elSelectAnswer;window.elQuizState=elQuizState;",
  )();
}

const lessonState = () =>
  (window as unknown as { elQuizState: { selected: Array<number | null> } }).elQuizState;
const select = (qi: number, oi: number) =>
  (window as unknown as { elSelectAnswer: (q: number, o: number) => void }).elSelectAnswer(qi, oi);
const quiz = () =>
  (window as unknown as {
    lyfelabz: { lessonQuiz: { autosave: (s: ReadonlyArray<number | null>) => Promise<unknown> } };
  }).lyfelabz.lessonQuiz;

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

const PERSISTED: readonly SessionResponse[] = [
  { itemId: "q1", response: "B" },
  { itemId: "q2", response: "D" },
  { itemId: "q5", response: "A" },
];

// An idempotent begin replaying the student's existing Live session.
const liveBegin = (
  responses: readonly SessionResponse[],
  assessmentPresentationRevisionId?: string,
): BeginCallable =>
  async () => ({
    sessionId: "sess-1",
    alreadyLive: true,
    responses,
    ...(assessmentPresentationRevisionId === undefined ? {} : { assessmentPresentationRevisionId }),
  });

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
  delete (window as unknown as { elSelectAnswer?: unknown }).elSelectAnswer;
  delete (window as unknown as { elQuizState?: unknown }).elQuizState;
});

describe("reload restores persisted answers into the real lesson quiz", () => {
  it("shows the previously selected answers after a reload", async () => {
    mountLesson();
    const { runtime, autosaves } = harness({ begin: liveBegin(PERSISTED) });

    await runtime.begin();

    expect(lessonState().selected).toEqual([1, 3, null, null, 0, null, null, null, null, null]);
    expect(document.getElementById("el-q-0-1")!.classList.contains("selected")).toBe(true);
    expect(document.getElementById("el-q-1-3")!.classList.contains("selected")).toBe(true);
    expect(document.getElementById("el-q-4-0")!.classList.contains("selected")).toBe(true);
    expect(document.getElementById("el-progress-text")!.textContent).toBe("3 / 10 selected");
    // Restoring sends nothing: the server already holds these answers.
    await flush();
    expect(autosaves).toEqual([]);
    expect(runtime.getStatus().mode).toBe("active");
  });

  it("a post-reload answer keeps every persisted answer", async () => {
    mountLesson();
    const { runtime, autosaves } = harness({ begin: liveBegin(PERSISTED) });
    await runtime.begin();

    select(6, 2);
    await flush();

    expect(autosaves[autosaves.length - 1]).toEqual([
      { itemId: "q1", response: "B" },
      { itemId: "q2", response: "D" },
      { itemId: "q5", response: "A" },
      { itemId: "q7", response: "C" },
    ]);
  });

  it("an answer made before the open-time begin returns still cannot shrink persisted progress", async () => {
    mountLesson();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { runtime, autosaves, begins } = harness({
      begin: async () => {
        await gate;
        return { sessionId: "sess-1", alreadyLive: true, responses: PERSISTED };
      },
    });
    const opening = runtime.begin();
    select(1, 0); // the student changes q2 while the open-time begin is in flight
    release();
    await opening;
    await flush();

    expect(begins()).toBe(1);
    const last = autosaves[autosaves.length - 1]!;
    expect(last).toEqual(
      expect.arrayContaining([
        { itemId: "q1", response: "B" },
        { itemId: "q2", response: "A" },
        { itemId: "q5", response: "A" },
      ]),
    );
    expect(last).toHaveLength(3);
    // The student's own choice for q2 was kept on screen, not overwritten.
    expect(lessonState().selected[1]).toBe(0);
  });

  it("opening a fresh assignment begins the session with zero answers and sends nothing", async () => {
    mountLesson();
    const { runtime, autosaves, begins } = harness({});
    await runtime.begin();
    await flush();
    expect(runtime.getStatus().mode).toBe("active");
    expect(begins()).toBe(1);
    expect(autosaves).toEqual([]);
    expect(lessonState().selected.every((s) => s === null)).toBe(true);

    // The first answer uses the open-time session; it never begins again.
    select(0, 2);
    await flush();
    expect(begins()).toBe(1);
    expect(autosaves).toEqual([[{ itemId: "q1", response: "C" }]]);
  });

  it("reloading a zero-answer session replays it and restores nothing", async () => {
    mountLesson();
    const { runtime, autosaves, begins } = harness({ begin: liveBegin([]) });
    await runtime.begin();
    await flush();
    expect(runtime.getStatus().mode).toBe("active");
    expect(begins()).toBe(1);
    expect(autosaves).toEqual([]);
    expect(lessonState().selected.every((s) => s === null)).toBe(true);
  });

  it("a recoverable open-time begin failure is retried by the first answer", async () => {
    mountLesson();
    let calls = 0;
    const { runtime, autosaves, begins } = harness({
      begin: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("offline"), { code: "unavailable" });
        return { sessionId: "sess-1", alreadyLive: false };
      },
    });
    await expect(runtime.begin()).rejects.toThrow("offline");
    expect(runtime.getStatus().mode).toBe("pending");
    select(0, 0);
    await flush();
    expect(begins()).toBe(2);
    expect(autosaves).toEqual([[{ itemId: "q1", response: "A" }]]);
  });

  it("persisted answers returned by a begin made at the first answer are also kept and restored", async () => {
    mountLesson();
    const { autosaves } = harness({ begin: liveBegin(PERSISTED) });
    select(3, 1);
    await flush();
    expect(autosaves[0]).toEqual([
      { itemId: "q4", response: "B" },
      { itemId: "q1", response: "B" },
      { itemId: "q2", response: "D" },
      { itemId: "q5", response: "A" },
    ]);
    // ...and they are restored into the page for the items still blank.
    expect(lessonState().selected).toEqual([1, 3, null, 1, 0, null, null, null, null, null]);
  });

  it("a canonical page restores nothing for a session frozen to a differentiated presentation", async () => {
    mountLesson();
    const { runtime, autosaves } = harness({
      begin: liveBegin(PERSISTED, `ap${"b".repeat(64)}`),
    });
    await runtime.begin();
    expect(lessonState().selected.every((s) => s === null)).toBe(true);
    select(0, 0);
    await flush();
    // No merge either: the page never claims answers it cannot display.
    expect(autosaves[autosaves.length - 1]).toEqual([{ itemId: "q1", response: "A" }]);
  });
});

describe("orchestrator merge and lifecycle", () => {
  it("finalize submits the merged set and then forgets the persisted baseline", async () => {
    const { runtime, autosaves } = harness({
      begin: liveBegin(PERSISTED),
      withPageAdoption: false,
    });
    await runtime.begin();
    await runtime.finalize([{ itemId: "q3", response: "C" }]);
    expect(autosaves[autosaves.length - 1]).toEqual([
      { itemId: "q3", response: "C" },
      ...PERSISTED,
    ]);
    expect(runtime.getStatus().mode).toBe("finalized");
  });

  it("a revision mismatch at the open-time begin fails closed and sends nothing", async () => {
    const autosaves: Array<readonly SessionResponse[]> = [];
    const runtime = createAssessmentRuntime({
      version: "test",
      assignmentId: "asg-1",
      callables: {
        begin: async () => ({
          sessionId: "sess-1",
          alreadyLive: true,
          assessmentRevisionId: "x__r2",
          responses: PERSISTED,
        }),
        autosave: async (_s, r) => {
          autosaves.push(r);
          return { persisted: true };
        },
        finalize: async () => FINALIZE_RESULT,
        getAttempt: async () => {
          throw new Error("unused");
        },
      },
      env: { randomId: () => "idk" },
      verifyAssessmentRevision: () => ({ ok: false, reason: "other revision" }),
    });
    await expect(runtime.begin()).rejects.toThrow();
    expect(runtime.getStatus().mode).toBe("error");
    await expect(runtime.autosave([{ itemId: "q1", response: "A" }])).rejects.toThrow();
    expect(autosaves).toEqual([]);
  });
});

describe("presentation-bound pages restore by option identity", () => {
  const AP = `ap${"a".repeat(64)}`;
  function mountBound(): void {
    const items = [
      { itemId: "q1", optionIds: ["C", "A", "D"] },
      { itemId: "q2", optionIds: ["B", "D", "A"] },
    ];
    document.body.innerHTML =
      `<script type="application/json" id="${__internal.PRESENTATION_BINDING_ELEMENT_ID}">` +
      JSON.stringify({
        schemaVersion: 1,
        lessonSlug: "synthetic-lesson",
        assessmentRevisionId: "assessment_synthetic-lesson__r1",
        assessmentPresentationRevisionId: AP,
        items,
      }) +
      "</script>" +
      items
        .map((item, qi) =>
          item.optionIds
            .map((_id, oi) => `<button class="quiz-option" id="b-${qi}-${oi}" onclick="xxSelectAnswer(${qi},${oi})"></button>`)
            .join(""),
        )
        .join("");
    const selected: Array<number | null> = [null, null];
    (window as unknown as Record<string, unknown>).xxSelectAnswer = (qi: number, oi: number) => {
      selected[qi] = oi;
      document.getElementById(`b-${qi}-${oi}`)!.classList.add("selected");
      void quiz().autosave(selected);
    };
    (window as unknown as Record<string, unknown>).xxSelected = selected;
  }
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).xxSelectAnswer;
    delete (window as unknown as Record<string, unknown>).xxSelected;
  });

  it("maps canonical optionIds back to the displayed choice, never a letter position", async () => {
    mountBound();
    const { runtime, autosaves } = harness({
      begin: liveBegin([{ itemId: "q1", response: "A" }, { itemId: "q2", response: "B" }], AP),
    });
    await runtime.begin();
    expect((window as unknown as { xxSelected: unknown }).xxSelected).toEqual([1, 0]);
    await flush();
    expect(autosaves).toEqual([]);
  });

  it("skips a persisted option the page does not display", async () => {
    mountBound();
    const { runtime } = harness({
      begin: liveBegin([{ itemId: "q1", response: "B" }, { itemId: "q2", response: "A" }], AP),
    });
    await runtime.begin();
    expect((window as unknown as { xxSelected: unknown }).xxSelected).toEqual([null, 2]);
  });

  it("restores nothing into a different presentation than the session's", async () => {
    mountBound();
    const { runtime } = harness({
      begin: liveBegin([{ itemId: "q1", response: "A" }], `ap${"c".repeat(64)}`),
    });
    await runtime.begin();
    expect((window as unknown as { xxSelected: unknown }).xxSelected).toEqual([null, null]);
  });
});
