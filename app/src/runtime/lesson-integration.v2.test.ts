/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";

import { createAssessmentRuntime } from "./orchestrator";
import type { AttemptSummary, FinalizeResult, RuntimeCallables } from "./types";

// Sprint 18 pilot v2 lesson-integration test. Mirrors the v1 pilot test
// (lesson-integration.test.ts) but points at the generated v2 artifact
// under app/lessons/. Verifies:
//
//   - the v2 artifact contains no legacy classroom submission markup,
//     no legacy classroom functions, no Apps Script endpoint;
//   - the v2 quiz still forwards autosave and finalize through the
//     shared window.lyfelabz.lessonQuiz helper;
//   - the v2 standalone (no ?assignment=) completion path renders the
//     platform "Exploration mode. Your work is not saved..." message;
//   - the shared local scoring UI (score board, Show Your Thinking
//     reveal) is identical to v1.

const V2_LESSON_PATH = path.resolve(
  __dirname,
  "../../../app/lessons/lesson_earths-layers.html",
);

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

type Env = {
  runtime: ReturnType<typeof createAssessmentRuntime>;
  autosaveCalls: Array<{ sessionId: string; responses: unknown }>;
  finalizeCalls: Array<{ sessionId: string; idempotencyKey: string }>;
};

function buildEnv(assignmentId: string | null): Env {
  const autosaveCalls: Env["autosaveCalls"] = [];
  const finalizeCalls: Env["finalizeCalls"] = [];
  const finalResult: FinalizeResult = {
    attemptId: "a__v2__1",
    attemptNumber: 1,
    score: 10,
    maxScore: 10,
    percentage: 100,
    itemResults: [],
    replay: false,
  };
  const attemptSummary: AttemptSummary = {
    attemptId: finalResult.attemptId,
    attemptNumber: 1,
    score: 10,
    maxScore: 10,
    percentage: 100,
    itemResults: [],
  };
  const callables: RuntimeCallables = {
    begin: async () => ({ sessionId: "sess-v2", alreadyLive: false }),
    autosave: async (sessionId, responses) => {
      autosaveCalls.push({ sessionId, responses });
      return { persisted: true };
    },
    finalize: async (sessionId, idempotencyKey) => {
      finalizeCalls.push({ sessionId, idempotencyKey });
      return finalResult;
    },
    getAttempt: async () => attemptSummary,
  };
  const runtime = createAssessmentRuntime({
    version: "18.0.0-test",
    assignmentId,
    callables,
    env: { randomId: () => "idk-v2" },
  });
  return { runtime, autosaveCalls, finalizeCalls };
}

function mapIndexes(
  indexSelections: ReadonlyArray<number | null | undefined>,
) {
  if (!indexSelections || typeof indexSelections.length !== "number") return [];
  const out: Array<{ itemId: string; response: string }> = [];
  for (let qi = 0; qi < indexSelections.length; qi++) {
    const idx = indexSelections[qi];
    if (idx === null || idx === undefined) continue;
    if (typeof idx !== "number" || idx < 0 || idx >= OPTION_LETTERS.length) continue;
    out.push({ itemId: `q${qi + 1}`, response: OPTION_LETTERS[idx]! });
  }
  return out;
}

function installRuntimeGlobal(env: Env): void {
  const rt = env.runtime;
  const assessmentRuntime = {
    version: rt.version,
    get mode() {
      return rt.getStatus().mode;
    },
    hasAssignmentContext: rt.hasAssignmentContext,
    begin: () => rt.begin(),
    autosave: (r: Parameters<typeof rt.autosave>[0]) => rt.autosave(r),
    finalize: (r: Parameters<typeof rt.finalize>[0]) => rt.finalize(r),
    getAttempt: (attemptId?: string) => rt.getAttempt(attemptId),
  };
  const lessonQuiz = {
    version: rt.version,
    optionLetters: [...OPTION_LETTERS],
    hasAssignmentContext: () => rt.hasAssignmentContext,
    mapIndexSelectionsToResponses: mapIndexes,
    autosave: async (
      indexSelections: ReadonlyArray<number | null | undefined>,
    ) => {
      if (!rt.hasAssignmentContext) return null;
      const responses = mapIndexes(indexSelections);
      if (responses.length === 0) return null;
      try {
        return await rt.autosave(responses);
      } catch {
        return null;
      }
    },
    finalize: async (
      indexSelections: ReadonlyArray<number | null | undefined>,
    ) => {
      if (!rt.hasAssignmentContext) return null;
      const responses = mapIndexes(indexSelections);
      try {
        const result = await rt.finalize(responses);
        return { ok: true, result } as const;
      } catch (err) {
        return {
          ok: false,
          message: (err as { message?: string }).message ?? "submission failed",
          recoverable: false,
        } as const;
      }
    },
  };
  (window as unknown as {
    lyfelabz: { assessmentRuntime: unknown; lessonQuiz: unknown };
  }).lyfelabz = { assessmentRuntime, lessonQuiz };
}

// Extract the shared quiz script block from the v2 artifact. The v2
// artifact has no CENTRALIZED ENDPOINT marker; anchor on `var elQuizState`.
function loadV2QuizScript(): string {
  const html = fs.readFileSync(V2_LESSON_PATH, "utf8");
  const quizStart = html.indexOf("var elQuizState");
  if (quizStart < 0) throw new Error("could not locate v2 quiz script start");
  const closing = html.indexOf("</script>", quizStart);
  if (closing < 0) throw new Error("could not locate v2 quiz script end");
  return html.slice(quizStart, closing);
}

function mountV2Dom(): void {
  document.body.innerHTML = `
    <div id="el-progress"></div><div id="el-progress-text"></div>
    <div id="el-quiz-questions"></div>
    <textarea id="el-thinking"></textarea>
    <div id="el-think-model"></div>
    <button id="el-submit-btn"></button>
    <div id="el-score"><div id="el-score-num"></div><div id="el-score-msg"></div></div>
    <div id="el-submit-status"></div>
    <nav><a class="nav-links" href="#quiz"></a></nav>
    <div id="quiz"></div><div id="continue"></div>
  `;
}

function evalV2Script(): void {
  Element.prototype.scrollIntoView = function () {
    /* jsdom: noop */
  };
  const script = loadV2QuizScript();
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    script +
      "\nwindow.elSelectAnswer=elSelectAnswer;window.elSubmitQuiz=elSubmitQuiz;window.elQuizState=elQuizState;",
  )();
}

function answerAll(correct: boolean): void {
  const w = window as unknown as {
    elSelectAnswer: (qi: number, chosenIndex: number) => void;
  };
  const correctIdx = [2, 1, 1, 1, 1, 0, 1, 0, 1, 1];
  for (let qi = 0; qi < 10; qi++) {
    w.elSelectAnswer(qi, correct ? correctIdx[qi]! : (correctIdx[qi]! + 1) % 4);
  }
}

function fillThinking(): void {
  const el = document.getElementById("el-thinking") as HTMLTextAreaElement;
  el.value = "Heat drives convection, moves plates, produces surface change.";
}

async function flush(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
  delete (window as unknown as { elSelectAnswer?: unknown }).elSelectAnswer;
  delete (window as unknown as { elSubmitQuiz?: unknown }).elSubmitQuiz;
  delete (window as unknown as { elQuizState?: unknown }).elQuizState;
});

describe("v2 lesson artifact - legacy absence", () => {
  const html = fs.readFileSync(V2_LESSON_PATH, "utf8");
  const PROHIBITED = [
    "quiz-mode-toggle",
    "student-info-box",
    "el-teacher-select",
    "el-block-select",
    "el-student-name",
    "EL_ENDPOINT",
    "script.google.com",
    "elSetQuizMode",
    "elValidateStudentInfo",
    "elQuizMode",
    "mr-kankel",
    "mr-rovner",
    "Practice Mode",
    "Classroom Mode",
    "Practice mode - score not submitted",
    "Firebase",
    "httpsCallable",
    "assessmentSessionsBegin",
    "assessmentSessionsAutosave",
    "assessmentAttemptsFinalize",
    "assessmentAttemptGet",
  ];
  for (const sig of PROHIBITED) {
    it(`does not contain "${sig}"`, () => {
      expect(html).not.toContain(sig);
    });
  }
  it("contains the shared runtime include and lessonQuiz call sites", () => {
    expect(html).toContain(
      '<script defer src="/assets/lyfelabz-assessment-runtime.js"></script>',
    );
    expect(html).toContain("window.lyfelabz.lessonQuiz.autosave");
    expect(html).toContain("window.lyfelabz.lessonQuiz.finalize");
    expect(html).toContain("window.lyfelabz.lessonQuiz.hasAssignmentContext");
  });
  it("begins with the v2 generated notice", () => {
    expect(html.startsWith("<!DOCTYPE html>\n<!--\nGENERATED FILE.")).toBe(true);
    expect(html).toContain("Build target: v2");
  });
});

describe("v2 lesson artifact - runtime behavior (assignment context)", () => {
  it("forwards a complete finalize payload through the shared helper", async () => {
    const env = buildEnv("asg-v2");
    installRuntimeGlobal(env);
    mountV2Dom();
    evalV2Script();
    answerAll(true);
    fillThinking();
    (window as unknown as { elSubmitQuiz: () => void }).elSubmitQuiz();
    await flush();
    expect(env.finalizeCalls).toHaveLength(1);
    expect(env.finalizeCalls[0]!.sessionId).toBe("sess-v2");
    expect(document.getElementById("el-submit-status")!.innerHTML).toContain(
      "Submitted to your teacher",
    );
    // Shared local scoring UI still renders (perfect score).
    expect(document.getElementById("el-score-num")!.textContent).toBe("10/10");
    expect(document.getElementById("el-think-model")!.className).toContain("show");
  });

  it("dispatches autosave on each answer selection", async () => {
    const env = buildEnv("asg-v2");
    installRuntimeGlobal(env);
    mountV2Dom();
    evalV2Script();
    const w = window as unknown as {
      elSelectAnswer: (qi: number, chosenIndex: number) => void;
    };
    w.elSelectAnswer(0, 2);
    w.elSelectAnswer(1, 1);
    await flush();
    expect(env.autosaveCalls.length).toBeGreaterThanOrEqual(1);
    expect(env.autosaveCalls[env.autosaveCalls.length - 1]!.responses).toEqual([
      { itemId: "q1", response: "C" },
      { itemId: "q2", response: "B" },
    ]);
  });
});

describe("v2 lesson artifact - standalone (no assignment context)", () => {
  it("renders the platform-standalone-completion message and does not submit", async () => {
    const env = buildEnv(null);
    installRuntimeGlobal(env);
    mountV2Dom();
    evalV2Script();
    answerAll(true);
    fillThinking();
    (window as unknown as { elSubmitQuiz: () => void }).elSubmitQuiz();
    await flush();
    expect(env.autosaveCalls).toEqual([]);
    expect(env.finalizeCalls).toEqual([]);
    const status = document.getElementById("el-submit-status")!.innerHTML;
    expect(status).toContain("Exploration mode");
    expect(status).toContain("Your work is not saved");
    expect(status).toContain("Launch this lesson from an assignment");
  });
});
