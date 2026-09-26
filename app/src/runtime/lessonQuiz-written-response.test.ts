/**
 * @jest-environment jsdom
 */

// Sprint 30 Show Your Thinking. Exercises the REAL lesson adapter
// (`window.lyfelabz.lessonQuiz`, installed by entry.ts) and the REAL
// Firebase-backed autosave payload builder, driven by the real
// orchestrator over fake callables. Proves the written response a lesson
// hands to `finalize` reaches the certified autosave request that
// finalize freezes from, and that the scored responses are unchanged.

const mockCallablePayloads: Array<{ name: string; payload: unknown }> = [];

jest.mock("firebase/app", () => ({
  getApps: () => [],
  initializeApp: jest.fn(),
}));
jest.mock("firebase/auth", () => ({
  connectAuthEmulator: jest.fn(),
  getAuth: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));
jest.mock("firebase/functions", () => ({
  connectFunctionsEmulator: jest.fn(),
  getFunctions: jest.fn(),
  httpsCallable: (_functions: unknown, name: string) => async (payload: unknown) => {
    mockCallablePayloads.push({ name, payload });
    return { data: { sessionId: "s", persisted: true } };
  },
}));

import * as fs from "fs";
import * as path from "path";

import { __internal } from "./entry";
import { createAssessmentRuntime } from "./orchestrator";
import type { FinalizeResult, RuntimeCallables, SessionResponse } from "./types";

const FINALIZE_RESULT: FinalizeResult = {
  attemptId: "asg-1__student-1__a1",
  attemptNumber: 1,
  score: 1,
  maxScore: 2,
  percentage: 50,
  itemResults: [],
  replay: false,
};

type Recorded = {
  autosaves: Array<{ responses: readonly SessionResponse[]; writtenResponse?: string; arity: number }>;
  finalizes: number;
};

type LessonQuiz = {
  finalize: (sel: ReadonlyArray<number | null>, options?: unknown) => Promise<unknown>;
  autosave: (sel: ReadonlyArray<number | null>) => Promise<unknown>;
};

function install(): { quiz: LessonQuiz; rec: Recorded } {
  const rec: Recorded = { autosaves: [], finalizes: 0 };
  const callables: RuntimeCallables = {
    begin: async () => ({ sessionId: "sess-1", alreadyLive: false }),
    autosave: async (...args: Parameters<RuntimeCallables["autosave"]>) => {
      rec.autosaves.push({ responses: args[1], writtenResponse: args[2], arity: args.length });
      return { persisted: true };
    },
    finalize: async () => {
      rec.finalizes += 1;
      return FINALIZE_RESULT;
    },
    getAttempt: async () => {
      throw new Error("unused");
    },
  };
  const runtime = createAssessmentRuntime({
    version: "test",
    assignmentId: "asg-1",
    callables,
    env: { randomId: () => "idk" },
  });
  const win = window as unknown as Parameters<typeof __internal.installLessonQuiz>[0];
  __internal.installLessonQuiz(win, runtime, true);
  const quiz = (window as unknown as { lyfelabz: { lessonQuiz: LessonQuiz } }).lyfelabz
    .lessonQuiz;
  return { quiz, rec };
}

afterEach(() => {
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
  mockCallablePayloads.length = 0;
});

describe("lessonQuiz.finalize written response", () => {
  it("forwards the trimmed Show Your Thinking text with the final autosave before finalize", async () => {
    const { quiz, rec } = install();
    const result = await quiz.finalize([0, 2], { writtenResponse: "  Convection moves plates.  " });
    expect(result).toEqual({ ok: true, result: FINALIZE_RESULT });
    expect(rec.finalizes).toBe(1);
    const last = rec.autosaves[rec.autosaves.length - 1]!;
    expect(last.writtenResponse).toBe("Convection moves plates.");
    // Scored responses are exactly the quiz selections; the text is not an item.
    expect(last.responses).toEqual([
      { itemId: "q1", response: "A" },
      { itemId: "q2", response: "C" },
    ]);
  });

  it("does not coalesce away the written response after an identical selection autosave", async () => {
    const { quiz, rec } = install();
    await quiz.autosave([0, 2]);
    await quiz.finalize([0, 2], { writtenResponse: "Because of convection." });
    expect(rec.autosaves).toHaveLength(2);
    expect(rec.autosaves[0]!.arity).toBe(2);
    expect(rec.autosaves[1]!.writtenResponse).toBe("Because of convection.");
  });

  it("keeps the pre-feature request shape when a lesson passes no written response", async () => {
    const { quiz, rec } = install();
    await quiz.finalize([1]);
    expect(rec.autosaves).toHaveLength(1);
    expect(rec.autosaves[0]!.arity).toBe(2);
    expect(rec.finalizes).toBe(1);
  });

  it.each([
    ["a number", { writtenResponse: 5 }],
    ["an object", { writtenResponse: { text: "x" } }],
    ["null options", null],
    ["a string options", "text"],
  ])("sends no written response for %s and still submits the quiz", async (_label, options) => {
    const { quiz, rec } = install();
    const result = await quiz.finalize([0], options);
    expect(result).toEqual({ ok: true, result: FINALIZE_RESULT });
    expect(rec.autosaves[0]!.arity).toBe(2);
  });

  it("truncates over-cap text instead of failing the scored submission", () => {
    const max = __internal.WRITTEN_RESPONSE_MAX_LENGTH;
    expect(max).toBe(10000);
    const out = __internal.normalizeWrittenResponse({ writtenResponse: "y".repeat(max + 50) });
    expect(out).toHaveLength(max);
  });

  it("normalizes blank text to an empty string (clears, never fabricates)", () => {
    expect(__internal.normalizeWrittenResponse({ writtenResponse: "   " })).toBe("");
  });
});

describe("certified autosave callable payload", () => {
  const callables = __internal.createBackedCallables({} as never);

  it("adds writtenResponse beside responses only when supplied", async () => {
    await callables.autosave("sess-1", [{ itemId: "q1", response: "A" }], "My thinking.");
    await callables.autosave("sess-1", [{ itemId: "q1", response: "A" }]);
    expect(mockCallablePayloads).toEqual([
      {
        name: "assessmentSessionsAutosave",
        payload: {
          sessionId: "sess-1",
          responses: [{ itemId: "q1", response: "A" }],
          writtenResponse: "My thinking.",
        },
      },
      {
        name: "assessmentSessionsAutosave",
        payload: { sessionId: "sess-1", responses: [{ itemId: "q1", response: "A" }] },
      },
    ]);
  });

  it("never puts the written response on the finalize request", async () => {
    mockCallablePayloads.length = 0;
    await callables.finalize("sess-1", "idk").catch(() => undefined);
    expect(mockCallablePayloads).toEqual([
      { name: "assessmentAttemptsFinalize", payload: { sessionId: "sess-1", idempotencyKey: "idk" } },
    ]);
  });
});

// End-to-end join of the two real halves: the REAL generated v2 lesson quiz
// script (Earth's Layers) driving the REAL lessonQuiz adapter and the REAL
// orchestrator. No stand-in adapter sits between the lesson and the runtime.
describe("real v2 lesson script through the real adapter", () => {
  it("delivers the student's textarea text, not the model answer, on the final autosave", async () => {
    const html = fs.readFileSync(
      path.resolve(__dirname, "../../../app/lessons/lesson_earths-layers.html"),
      "utf8",
    );
    const start = html.indexOf("var elQuizState");
    const script = html.slice(start, html.indexOf("</script>", start));
    document.body.innerHTML = `
      <div id="el-progress"></div><div id="el-progress-text"></div>
      <div id="el-quiz-questions"></div>
      <textarea id="el-thinking"></textarea>
      <div id="el-think-model">MODEL ANSWER TEXT</div>
      <button id="el-submit-btn"></button>
      <div id="el-score"><div id="el-score-num"></div><div id="el-score-msg"></div></div>
      <div id="el-submit-status"></div>
      <div id="quiz"></div><div id="continue"></div>`;
    Element.prototype.scrollIntoView = function () {};
    const { rec } = install();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(`${script}\nwindow.elSelectAnswer=elSelectAnswer;window.elSubmitQuiz=elSubmitQuiz;`)();
    const w = window as unknown as {
      elSelectAnswer: (qi: number, i: number) => void;
      elSubmitQuiz: () => void;
    };
    [2, 1, 1, 1, 1, 0, 1, 0, 1, 1].forEach((c, qi) => w.elSelectAnswer(qi, c));
    (document.getElementById("el-thinking") as HTMLTextAreaElement).value =
      "  My own words: heat, convection, plates.  ";
    w.elSubmitQuiz();
    for (let i = 0; i < 200; i++) await Promise.resolve();

    expect(rec.finalizes).toBe(1);
    const withText = rec.autosaves.filter((a) => a.writtenResponse !== undefined);
    expect(withText).toHaveLength(1);
    expect(withText[0]!.writtenResponse).toBe("My own words: heat, convection, plates.");
    expect(withText[0]!.responses).toHaveLength(10);
    expect(document.getElementById("el-submit-status")!.textContent).toContain(
      "Submitted to your teacher",
    );
  });
});
