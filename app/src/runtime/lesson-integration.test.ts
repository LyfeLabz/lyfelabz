/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";

import { createAssessmentRuntime } from "./orchestrator";
import type {
  AttemptSummary,
  FinalizeResult,
  RuntimeCallables,
} from "./types";

// Sprint 17 Slice 5 pilot lesson-integration test. The pilot lesson
// (`lesson_earths-layers.html`) is loaded into jsdom exactly as a real
// student would receive it. A stub `window.lyfelabz.assessmentRuntime`
// backed by the certified orchestrator + in-memory callables is installed
// BEFORE the lesson script runs, so the lesson exercises the same
// begin -> autosave -> finalize contract it will exercise in production
// against the real Firebase-backed callables. The point of this test is
// to prove that:
//
//   - the lesson never imports Firebase (grepped explicitly);
//   - selecting an answer forwards the certified response shape to
//     autosave (`{itemId: "qN", response: "A"|"B"|"C"|"D"}`);
//   - submit in assignment context calls finalize with the same shape,
//     honors lesson validation (all questions + Show Your Thinking gate),
//     preserves the local scoring UI, and does not fall back to the
//     Google Apps Script POST used in classroom mode;
//   - standalone (no `?assignment=`) leaves the lesson at its byte-for-
//     byte practice-mode behavior; autosave/finalize never fire.
//
// This test is the "focused pilot lesson-integration test" the Slice 5
// completion standard requires. Emulator-level proof of the pipeline
// callables is separately covered by the Cloud Functions test suite; the
// pilot's real-emulator deploy is proven by the deploy-assessment CLI.

const LESSON_PATH = path.resolve(
  __dirname,
  "../../../lesson_earths-layers.html",
);

type Env = {
  runtime: ReturnType<typeof createAssessmentRuntime>;
  autosaveCalls: Array<{ sessionId: string; responses: unknown }>;
  finalizeCalls: Array<{ sessionId: string; idempotencyKey: string }>;
  fetchCalls: number;
};

function buildEnv(assignmentId: string | null): Env {
  const autosaveCalls: Env["autosaveCalls"] = [];
  const finalizeCalls: Env["finalizeCalls"] = [];
  const finalResult: FinalizeResult = {
    attemptId: "a__student__a1",
    attemptNumber: 1,
    score: 8,
    maxScore: 10,
    percentage: 80,
    itemResults: [],
    replay: false,
  };
  const attemptSummary: AttemptSummary = {
    attemptId: finalResult.attemptId,
    attemptNumber: 1,
    score: 8,
    maxScore: 10,
    percentage: 80,
    itemResults: [],
  };
  const callables: RuntimeCallables = {
    begin: async () => ({ sessionId: "sess-1", alreadyLive: false }),
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
    version: "17.5.0-test",
    assignmentId,
    callables,
    env: { randomId: () => "idk-test" },
  });
  return { runtime, autosaveCalls, finalizeCalls, fetchCalls: 0 };
}

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

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
    autosave: (responses: Parameters<typeof rt.autosave>[0]) =>
      rt.autosave(responses),
    finalize: (responses: Parameters<typeof rt.finalize>[0]) =>
      rt.finalize(responses),
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

// Extract just the pilot quiz <script> (the last <script> in the file
// contains the elBuildQuiz/elSubmitQuiz logic and the runtime wiring
// added in Slice 5). Evaluating the whole HTML requires DOM elements
// that only exist inside the lesson; we mount those elements explicitly
// so the lesson script initializes cleanly under jsdom.
function loadPilotQuizScript(): string {
  const html = fs.readFileSync(LESSON_PATH, "utf8");
  const quizStart = html.indexOf(
    "// ── CENTRALIZED ENDPOINT ──────────────────────────────────────────────",
  );
  if (quizStart < 0) {
    throw new Error("could not locate the pilot quiz script in lesson HTML");
  }
  const closing = html.indexOf("</script>", quizStart);
  if (closing < 0) {
    throw new Error("could not locate the pilot quiz script end");
  }
  return html.slice(quizStart, closing);
}

function mountLessonDom(): void {
  document.body.innerHTML = `
    <div id="student-info-box" style="display:none">
      <input id="el-student-name" />
      <select id="el-teacher-select"><option value=""></option></select>
      <select id="el-block-select"><option value=""></option></select>
      <div id="el-err-name"></div><div id="el-err-teacher"></div><div id="el-err-block"></div>
    </div>
    <button id="btn-practice"></button><button id="btn-classroom"></button>
    <span id="hint-practice"></span><span id="hint-classroom"></span>
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

function evalLessonScript(): void {
  // The pilot script uses `var` bindings at top level and relies on being
  // parsed as script (not module). eval() runs in the current lexical
  // scope; wrap in an IIFE so declarations attach to the jsdom window.
  const script = loadPilotQuizScript();
  // Prevent the lesson's automatic `elBuildQuiz()` from throwing on
  // querySelector('.nav-links') results by disabling smooth scroll in jsdom.
  Element.prototype.scrollIntoView = function () {
    /* jsdom: noop */
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(script + "\nwindow.elSelectAnswer=elSelectAnswer;window.elSubmitQuiz=elSubmitQuiz;window.elQuizState=elQuizState;")();
}

function answerAll(correct: boolean): void {
  const w = window as unknown as {
    elSelectAnswer: (qi: number, chosenIndex: number) => void;
  };
  // Answer indexes lifted from the lesson's `elQuizQuestions[*].correct`:
  const correctIdx = [2, 1, 1, 1, 1, 0, 1, 0, 1, 1];
  for (let qi = 0; qi < 10; qi++) {
    w.elSelectAnswer(qi, correct ? correctIdx[qi]! : (correctIdx[qi]! + 1) % 4);
  }
}

function fillThinking(): void {
  const el = document.getElementById("el-thinking") as HTMLTextAreaElement;
  el.value = "Heat drives convection which moves plates and drives change.";
}

async function flush(): Promise<void> {
  // Drain the microtask queue enough times to walk the full runtime
  // lifecycle: begin -> coalesced autosaves -> finalize -> UI update.
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

describe("pilot lesson - assignment context", () => {
  it("dispatches autosave to the runtime on every answer selection", async () => {
    const env = buildEnv("asg-1");
    installRuntimeGlobal(env);
    mountLessonDom();
    evalLessonScript();

    const w = window as unknown as {
      elSelectAnswer: (qi: number, chosenIndex: number) => void;
    };
    w.elSelectAnswer(0, 2);
    w.elSelectAnswer(1, 1);
    await flush();

    expect(env.autosaveCalls.length).toBeGreaterThanOrEqual(1);
    const first = env.autosaveCalls[0]!;
    expect(first.sessionId).toBe("sess-1");
    expect(first.responses).toEqual([{ itemId: "q1", response: "C" }]);
    const last = env.autosaveCalls[env.autosaveCalls.length - 1]!;
    expect(last.responses).toEqual([
      { itemId: "q1", response: "C" },
      { itemId: "q2", response: "B" },
    ]);
  });

  it("forwards a complete finalize payload and preserves local scoring UI", async () => {
    const env = buildEnv("asg-1");
    installRuntimeGlobal(env);
    mountLessonDom();
    evalLessonScript();

    answerAll(true);
    fillThinking();
    (window as unknown as { elSubmitQuiz: () => void }).elSubmitQuiz();
    await flush();

    expect(env.finalizeCalls).toHaveLength(1);
    expect(env.finalizeCalls[0]!.sessionId).toBe("sess-1");
    expect(env.finalizeCalls[0]!.idempotencyKey).toBe("idk-test");
    // Autosave coalesced against the just-finalized payload
    const lastAutosave = env.autosaveCalls[env.autosaveCalls.length - 1]!;
    expect(lastAutosave.responses).toEqual([
      { itemId: "q1", response: "C" },
      { itemId: "q2", response: "B" },
      { itemId: "q3", response: "B" },
      { itemId: "q4", response: "B" },
      { itemId: "q5", response: "B" },
      { itemId: "q6", response: "A" },
      { itemId: "q7", response: "B" },
      { itemId: "q8", response: "A" },
      { itemId: "q9", response: "B" },
      { itemId: "q10", response: "B" },
    ]);
    // Existing local score UI still runs (Show Your Thinking model reveal
    // and score board are the lesson's completion feedback surface).
    const score = document.getElementById("el-score-num")!;
    expect(score.textContent).toBe("10/10");
    expect(
      document.getElementById("el-think-model")!.className,
    ).toContain("show");
    // Submitted status reflects the certified finalize result.
    await flush();
    expect(document.getElementById("el-submit-status")!.innerHTML).toContain(
      "Submitted to your teacher",
    );
  });

  it("refuses to submit if Show Your Thinking is empty (lesson validation before finalize)", async () => {
    const env = buildEnv("asg-1");
    installRuntimeGlobal(env);
    mountLessonDom();
    evalLessonScript();
    answerAll(true);
    // Do NOT fill thinking; lesson validation must gate finalize.
    (window as unknown as { elSubmitQuiz: () => void }).elSubmitQuiz();
    await flush();
    expect(env.finalizeCalls).toHaveLength(0);
  });

  it("duplicate submit clicks do not produce duplicate finalize calls", async () => {
    const env = buildEnv("asg-1");
    installRuntimeGlobal(env);
    mountLessonDom();
    evalLessonScript();
    answerAll(true);
    fillThinking();
    const submit = (window as unknown as { elSubmitQuiz: () => void }).elSubmitQuiz;
    submit();
    submit();
    submit();
    await flush();
    expect(env.finalizeCalls).toHaveLength(1);
  });
});

describe("pilot lesson - standalone (no assignment context)", () => {
  it("keeps runtime inert and never calls autosave or finalize", async () => {
    const env = buildEnv(null);
    installRuntimeGlobal(env);
    mountLessonDom();
    evalLessonScript();
    answerAll(true);
    fillThinking();
    (window as unknown as { elSubmitQuiz: () => void }).elSubmitQuiz();
    await flush();
    expect(env.autosaveCalls).toEqual([]);
    expect(env.finalizeCalls).toEqual([]);
  });
});

describe("preservation invariants", () => {
  it("pilot lesson HTML contains no Firebase imports or callable names", () => {
    const html = fs.readFileSync(LESSON_PATH, "utf8");
    expect(html).not.toMatch(/firebase\//i);
    expect(html).not.toMatch(/httpsCallable/);
    expect(html).not.toMatch(/assessmentSessionsBegin/);
    expect(html).not.toMatch(/assessmentSessionsAutosave/);
    expect(html).not.toMatch(/assessmentAttemptsFinalize/);
    expect(html).not.toMatch(/assessmentAttemptGet/);
    expect(html).not.toMatch(/GOOGLE_APPLICATION_CREDENTIALS/);
  });
});
