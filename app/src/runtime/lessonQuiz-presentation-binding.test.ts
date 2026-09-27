/**
 * @jest-environment jsdom
 */

// F5.3 Slice 4. Exercises the REAL lesson adapter (`window.lyfelabz.lessonQuiz`
// installed by entry.ts) over the real orchestrator and fake callables:
// on a page rendered from a certified assessment presentation, the response is
// the canonical optionId of the DISPLAYED choice (from the page's binding
// block), never a positional letter; canonical pages keep the legacy mapping;
// and a malformed binding fails closed with nothing sent.

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

type LessonQuiz = {
  mapIndexSelectionsToResponses: (sel: ReadonlyArray<number | null>) => readonly SessionResponse[];
  autosave: (sel: ReadonlyArray<number | null>) => Promise<unknown>;
  finalize: (sel: ReadonlyArray<number | null>, options?: unknown) => Promise<unknown>;
};

function install(): { quiz: LessonQuiz; sent: Array<readonly SessionResponse[]>; finalizes: () => number } {
  const sent: Array<readonly SessionResponse[]> = [];
  let finalizes = 0;
  const callables: RuntimeCallables = {
    begin: async () => ({ sessionId: "sess-1", alreadyLive: false }),
    autosave: async (_sessionId, responses) => {
      sent.push(responses);
      return { persisted: true };
    },
    finalize: async () => {
      finalizes += 1;
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
  const quiz = (window as unknown as { lyfelabz: { lessonQuiz: LessonQuiz } }).lyfelabz.lessonQuiz;
  return { quiz, sent, finalizes: () => finalizes };
}

function setBinding(content: string, attrs = 'type="application/json"'): void {
  document.body.innerHTML =
    `<script ${attrs} id="${__internal.PRESENTATION_BINDING_ELEMENT_ID}">${content}</script>` +
    '<div id="xx-quiz-questions"></div>';
}

function binding(items: Array<{ itemId: string; optionIds: string[] }>): string {
  return JSON.stringify({
    schemaVersion: 1,
    lessonSlug: "synthetic-lesson",
    assessmentRevisionId: "assessment_synthetic-lesson__r1",
    assessmentPresentationRevisionId: `ap${"a".repeat(64)}`,
    items,
  });
}

afterEach(() => {
  delete (window as unknown as { lyfelabz?: unknown }).lyfelabz;
  document.body.innerHTML = "";
});

describe("presentation-bound pages submit canonical option identity", () => {
  it("maps a reordered four-choice display to canonical optionIds, not letters", async () => {
    setBinding(binding([
      { itemId: "q1", optionIds: ["C", "A", "D", "B"] },
      { itemId: "q2", optionIds: ["B", "D", "A", "C"] },
    ]));
    const { quiz, sent } = install();
    // Display position 0 of q1 is canonical C; position 3 of q2 is canonical C.
    await quiz.autosave([0, 3]);
    expect(sent[sent.length - 1]).toEqual([
      { itemId: "q1", response: "C" },
      { itemId: "q2", response: "C" },
    ]);
  });

  it("maps a three-choice display (one canonical distractor omitted) to canonical optionIds", async () => {
    setBinding(binding([
      { itemId: "q1", optionIds: ["D", "A", "C"] }, // canonical B omitted
      { itemId: "q2", optionIds: ["A", "B", "D"] }, // canonical C omitted
    ]));
    const { quiz, sent } = install();
    await quiz.autosave([2, 1]);
    expect(sent[sent.length - 1]).toEqual([
      { itemId: "q1", response: "C" },
      { itemId: "q2", response: "B" },
    ]);
  });

  it("uses the binding's canonical itemIds, not q<N> by position", () => {
    setBinding(binding([
      { itemId: "item-alpha", optionIds: ["B", "A"] },
      { itemId: "item-beta", optionIds: ["A", "B"] },
    ]));
    const { quiz } = install();
    expect(quiz.mapIndexSelectionsToResponses([1, null])).toEqual([{ itemId: "item-alpha", response: "A" }]);
  });

  it("submits the canonical optionIds on finalize", async () => {
    setBinding(binding([
      { itemId: "q1", optionIds: ["D", "A", "C"] },
      { itemId: "q2", optionIds: ["A", "B", "D"] },
    ]));
    const { quiz, sent, finalizes } = install();
    const result = await quiz.finalize([0, 2], { writtenResponse: "Because convection." });
    expect(result).toEqual({ ok: true, result: FINALIZE_RESULT });
    expect(finalizes()).toBe(1);
    expect(sent[sent.length - 1]).toEqual([
      { itemId: "q1", response: "D" },
      { itemId: "q2", response: "D" },
    ]);
  });
});

describe("canonical pages keep the legacy mapping", () => {
  it("a page without a binding block maps display index to the canonical positional letter", async () => {
    const { quiz, sent } = install();
    await quiz.autosave([0, 3, null, 2]);
    expect(sent[sent.length - 1]).toEqual([
      { itemId: "q1", response: "A" },
      { itemId: "q2", response: "D" },
      { itemId: "q4", response: "C" },
    ]);
  });
});

describe("malformed presentation binding fails closed (no positional fallback)", () => {
  const good = [
    { itemId: "q1", optionIds: ["D", "A", "C"] },
    { itemId: "q2", optionIds: ["A", "B", "D"] },
  ];

  it.each([
    ["invalid JSON", () => setBinding("{not json")],
    ["wrong element type", () => setBinding(binding(good), 'type="text/plain"')],
    ["unsupported schemaVersion", () => setBinding(JSON.stringify({ schemaVersion: 2, items: good }))],
    ["no items", () => setBinding(binding([]))],
    ["missing option mapping", () => setBinding(binding([{ itemId: "q1", optionIds: [] }, good[1]!]))],
    ["duplicate canonical optionId", () => setBinding(binding([{ itemId: "q1", optionIds: ["A", "A", "C"] }, good[1]!]))],
    ["duplicate itemId", () => setBinding(binding([good[0]!, { ...good[1]!, itemId: "q1" }]))],
    ["correctness smuggled into an item", () =>
      setBinding(JSON.stringify({ schemaVersion: 1, items: [{ ...good[0]!, correct: "C" }, good[1]!] }))],
  ])("%s: autosave sends nothing and finalize refuses", async (_label, arrange) => {
    arrange();
    const { quiz, sent, finalizes } = install();
    expect(await quiz.autosave([0, 1])).toBeNull();
    const result = await quiz.finalize([0, 1]);
    expect(result).toEqual({
      ok: false,
      message: __internal.PRESENTATION_UNAVAILABLE_MESSAGE,
      recoverable: false,
    });
    expect(sent).toHaveLength(0);
    expect(finalizes()).toBe(0);
  });

  it.each([
    ["a selection beyond the displayed choices", [3, 0]],
    ["a non-integer selection", [0.5, 0]],
    ["a question count that does not match the presentation", [0, 1, 2]],
  ])("%s is refused rather than mapped", async (_label, selections) => {
    setBinding(binding(good));
    const { quiz, sent, finalizes } = install();
    expect(await quiz.autosave(selections as number[])).toBeNull();
    expect(await quiz.finalize(selections as number[])).toMatchObject({ ok: false, recoverable: false });
    expect(sent).toHaveLength(0);
    expect(finalizes()).toBe(0);
  });

  it("readPresentationBinding reports none, bound, and malformed precisely", () => {
    expect(__internal.readPresentationBinding(document)).toEqual({ kind: "none" });
    setBinding(binding(good));
    expect(__internal.readPresentationBinding(document)).toEqual({ kind: "bound", items: good });
    setBinding("[]");
    expect(__internal.readPresentationBinding(document)).toMatchObject({ kind: "malformed" });
  });
});
