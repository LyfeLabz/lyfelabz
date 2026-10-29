/**
 * @jest-environment jsdom
 *
 * Student Detail question review (PDR-032e). The pure review model pairs
 * frozen attempt results with the immutable revision the attempt was scored
 * against, and the disclosure shows any attempt individually.
 */
import type {
  AttemptGetForTeacherCallable,
  CompletedAttemptSummary,
  TeacherVisibleAttempt,
} from "../../assignments/detail/attempts-wire";
import type { AssessmentRevisionContent } from "../../assignments/detail/question-summary";
import {
  appendQuestionReview,
  attemptIncorrectCount,
  attemptOptionLabel,
  buildAttemptQuestionReview,
  MAX_REPEAT_ANALYSIS_ATTEMPTS,
  orderAttemptsChronologically,
  reviewAnswersLabel,
} from "./studentDetailQuestionReview";

const REV = "assessment_earths-layers__r1";
const content: AssessmentRevisionContent = {
  revisionId: REV,
  items: [
    {
      itemId: "q1",
      stem: "Which layer is liquid?",
      options: [
        { optionId: "A", text: "Inner core" },
        { optionId: "B", text: "Outer core" },
        { optionId: "C", text: "Crust" },
        { optionId: "D", text: "Mantle" },
      ],
    },
    {
      itemId: "q2",
      stem: "Which layer is thinnest?",
      options: [
        { optionId: "A", text: "Crust" },
        { optionId: "B", text: "Mantle" },
        { optionId: "C", text: "Outer core" },
        { optionId: "D", text: "Inner core" },
      ],
    },
    {
      itemId: "q3",
      stem: "What drives plate motion?",
      options: [
        { optionId: "A", text: "Convection" },
        { optionId: "B", text: "Tides" },
        { optionId: "C", text: "Wind" },
        { optionId: "D", text: "Magnetism" },
      ],
    },
  ],
};

const detail = (overrides: Partial<TeacherVisibleAttempt> = {}): TeacherVisibleAttempt => ({
  attemptId: "att-1",
  studentId: "s1",
  assignmentId: "a1",
  attemptNumber: 1,
  percentage: 33,
  assessmentRevisionId: REV,
  canonicalContent: true,
  itemResults: [
    { itemId: "q1", isCorrect: false, correctOptionId: "B", studentResponse: "A", explanation: "The outer core is liquid iron." },
    { itemId: "q2", isCorrect: true, correctOptionId: "A", studentResponse: "A", explanation: "" },
    { itemId: "q3", isCorrect: false, correctOptionId: "A", studentResponse: null, explanation: "Heat drives convection." },
  ],
  ...overrides,
});

describe("buildAttemptQuestionReview", () => {
  it("pairs frozen results with revision text and readable answers", () => {
    const review = buildAttemptQuestionReview(detail(), content);
    expect(review.mode).toBe("full");
    expect(review.correctCount).toBe(1);
    expect(review.questions).toEqual([
      {
        number: 1,
        itemId: "q1",
        stem: "Which layer is liquid?",
        status: "incorrect",
        studentAnswer: { optionId: "A", text: "Inner core" },
        correctAnswer: { optionId: "B", text: "Outer core" },
        explanation: "The outer core is liquid iron.",
      },
      {
        number: 2,
        itemId: "q2",
        stem: "Which layer is thinnest?",
        status: "correct",
        studentAnswer: { optionId: "A", text: "Crust" },
        correctAnswer: { optionId: "A", text: "Crust" },
        explanation: null,
      },
      {
        number: 3,
        itemId: "q3",
        stem: "What drives plate motion?",
        status: "unanswered",
        studentAnswer: null,
        correctAnswer: { optionId: "A", text: "Convection" },
        explanation: "Heat drives convection.",
      },
    ]);
  });

  it("never pairs text from a different revision", () => {
    const review = buildAttemptQuestionReview(detail({ assessmentRevisionId: "assessment_earths-layers__r2" }), content);
    expect(review.mode).toBe("noText");
    expect(review.questions.every((q) => q.stem === null)).toBe(true);
    expect(review.questions[0]!.studentAnswer).toEqual({ optionId: "A", text: null });
    expect(review.questions[0]!.correctAnswer).toEqual({ optionId: "B", text: null });
  });

  it("keeps results without text when the revision is unavailable or inconsistent", () => {
    expect(buildAttemptQuestionReview(detail(), null).mode).toBe("noText");
    const inconsistent: AssessmentRevisionContent = {
      revisionId: REV,
      items: content.items.map((i) => ({ ...i, options: i.options.filter((o) => o.optionId !== "B") })),
    };
    const review = buildAttemptQuestionReview(detail(), inconsistent);
    // q1's correct option B is missing from the revision, so q1 shows no text.
    expect(review.questions[0]!.stem).toBeNull();
    expect(review.questions[0]!.correctAnswer).toEqual({ optionId: "B", text: null });
  });

  it("shows results only for an adapted delivery: no wording and no choice identities", () => {
    const review = buildAttemptQuestionReview(detail({ canonicalContent: false }), content);
    expect(review.mode).toBe("resultsOnly");
    for (const q of review.questions) {
      expect(q.stem).toBeNull();
      expect(q.studentAnswer).toBeNull();
      expect(q.correctAnswer).toBeNull();
    }
    expect(review.questions.map((q) => q.status)).toEqual(["incorrect", "correct", "unanswered"]);
    expect(review.questions[0]!.explanation).toBe("The outer core is liquid iron.");
  });
});

const summary = (
  attemptId: string,
  attemptNumber: number,
  submittedAt: number,
  percentage: number,
  score = Math.round((percentage / 100) * 3),
  maxScore = 3,
): CompletedAttemptSummary => ({
  attemptId,
  studentId: "s1",
  studentDisplayName: "Ada",
  assignmentId: "a1",
  attemptNumber,
  score,
  maxScore,
  percentage,
  submittedAt,
});

describe("attempt labels and ordering", () => {
  it("counts incorrect answers from the selected attempt's unit-point score", () => {
    expect(attemptIncorrectCount(summary("a", 1, 1, 33, 1, 3))).toBe(2);
    expect(reviewAnswersLabel(summary("a", 1, 1, 33, 1, 3))).toBe("Review answers · 2 incorrect");
    expect(reviewAnswersLabel(summary("a", 1, 1, 100, 3, 3))).toBe("Review answers · all correct");
  });

  it("shows no count when the summary cannot support one", () => {
    for (const [score, maxScore] of [[1.5, 3], [4, 3], [-1, 3], [0, 0]] as const) {
      expect(attemptIncorrectCount(summary("a", 1, 1, 50, score, maxScore))).toBeNull();
      expect(reviewAnswersLabel(summary("a", 1, 1, 50, score, maxScore))).toBe("Review answers");
    }
  });

  it("labels the newest attempt Latest and earlier ones Previous attempt N with score and date", () => {
    const ordered = orderAttemptsChronologically([
      summary("att-3", 3, 3000, 90),
      summary("att-1", 1, 1000, 30),
      summary("att-2", 2, 2000, 60),
    ]);
    expect(ordered.map((a) => a.attemptId)).toEqual(["att-1", "att-2", "att-3"]);
    const fmt = (ms: number): string => `day-${ms}`;
    expect(ordered.map((_a, i) => attemptOptionLabel(ordered, i, fmt))).toEqual([
      "Previous attempt 2 · 30% · day-1000",
      "Previous attempt 1 · 60% · day-2000",
      "Latest attempt · 90% · day-3000",
    ]);
  });

  it("orders attempts without a usable timestamp first, deterministically, and never invents a date", () => {
    const ordered = orderAttemptsChronologically([
      summary("att-b", 2, 0, 40),
      summary("att-c", 3, 5000, 70),
      summary("att-a", 2, Number.NaN, 20),
      summary("att-c", 3, 5000, 70),
    ]);
    expect(ordered.map((a) => a.attemptId)).toEqual(["att-a", "att-b", "att-c"]);
    const fmt = (ms: number): string => `day-${ms}`;
    expect(attemptOptionLabel(ordered, 0, fmt)).toBe("Previous attempt 2 · 20%");
    expect(attemptOptionLabel(ordered, 1, fmt)).toBe("Previous attempt 1 · 40%");
    expect(attemptOptionLabel(ordered, 2, fmt)).toBe("Latest attempt · 70% · day-5000");
  });
});

describe("appendQuestionReview", () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
  };
  const allCorrect = (): TeacherVisibleAttempt =>
    detail({
      attemptId: "att-2",
      attemptNumber: 2,
      percentage: 100,
      itemResults: detail().itemResults.map((r) => ({ ...r, isCorrect: true, studentResponse: r.correctOptionId })),
    });

  function setup(
    details: Record<string, TeacherVisibleAttempt | Error>,
    attempts: ReadonlyArray<CompletedAttemptSummary> = [summary("att-1", 1, 1000, 33), summary("att-2", 2, 2000, 100)],
  ) {
    const card = document.createElement("li");
    card.setAttribute("data-assignment-id", "a1");
    document.body.appendChild(card);
    const calls: string[] = [];
    const revisionCalls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const attemptDetail: AttemptGetForTeacherCallable = async ({ attemptId }) => {
      calls.push(attemptId);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight -= 1;
      const d = details[attemptId]!;
      if (d instanceof Error) throw d;
      return d;
    };
    appendQuestionReview(document, card, attempts, attemptDetail, async (id) => {
      revisionCalls.push(id);
      return content;
    }, (ms) => `day-${ms}`);
    return { card, calls, revisionCalls, maxInFlight: () => maxInFlight };
  }
  const toggleOf = (card: HTMLElement) =>
    card.querySelector<HTMLButtonElement>("[data-testid=student-detail-review-toggle]")!;
  const selectOf = (card: HTMLElement) =>
    card.querySelector<HTMLSelectElement>("[data-testid=student-detail-review-select]")!;
  const choose = async (card: HTMLElement, value: string): Promise<void> => {
    const select = selectOf(card);
    select.value = value;
    select.dispatchEvent(new Event("change"));
    await flush();
  };
  const visible = (card: HTMLElement): string[] =>
    Array.from(card.querySelectorAll<HTMLElement>(".shell-student-detail-review-item"))
      .filter((li) => !li.hidden)
      .map((li) => li.getAttribute("data-testid")!);
  const filterOf = (card: HTMLElement) =>
    card.querySelector<HTMLInputElement>("[data-testid=student-detail-review-incorrect-only]")!;
  const setFilter = (card: HTMLElement, on: boolean): void => {
    const box = filterOf(card);
    box.checked = on;
    box.dispatchEvent(new Event("change"));
  };

  it("is a primary 'Review answers' action with the latest attempt's count, closed and unread until opened", async () => {
    const { card, calls } = setup({ "att-1": detail(), "att-2": allCorrect() });
    const toggle = toggleOf(card);
    expect(toggle.textContent).toBe("Review answers · all correct");
    expect(toggle.classList.contains("shell-btn")).toBe(true);
    expect(toggle.classList.contains("shell-btn-primary")).toBe(true);
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("student-detail-review-a1");
    expect(calls).toEqual([]);
  });

  it("opens on the latest attempt, listed first, with Previous attempt labels", async () => {
    const { card, calls, revisionCalls } = setup({ "att-1": detail(), "att-2": allCorrect() });
    toggleOf(card).click();
    await flush();
    expect(toggleOf(card).getAttribute("aria-expanded")).toBe("true");
    const select = selectOf(card);
    expect(card.querySelector(`label[for="${select.id}"]`)!.textContent).toBe("Attempt");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Latest attempt · 100% · day-2000",
      "Previous attempt 1 · 33% · day-1000",
    ]);
    expect(select.value).toBe("1");
    expect(select.selectedOptions[0]!.textContent).toBe("Latest attempt · 100% · day-2000");
    // The latest attempt is read first; the repeated-miss check then reads the rest.
    expect(calls).toEqual(["att-2", "att-1"]);
    expect(revisionCalls).toEqual([REV]);
    expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("3 of 3 correct");
  });

  it("updates the count to the selected attempt and shows that attempt's own answers", async () => {
    const { card, calls } = setup({ "att-1": detail(), "att-2": allCorrect() });
    toggleOf(card).click();
    await flush();
    await choose(card, "0");
    expect(toggleOf(card).textContent).toBe("Review answers · 2 incorrect");
    expect(calls).toEqual(["att-2", "att-1"]);
    expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 3 correct");
    // The redundant "To review" list is gone; the filter already shows exactly those questions.
    expect(card.querySelector("[data-testid=student-detail-review-missed]")).toBeNull();
    const q1 = card.querySelector<HTMLElement>("[data-testid=student-detail-review-item-1]")!;
    expect(q1.getAttribute("data-status")).toBe("incorrect");
    expect(q1.querySelector("[data-testid=student-detail-review-status-1]")!.textContent).toBe("Incorrect");
    expect(q1.querySelector("[data-testid=student-detail-review-stem]")!.textContent).toBe("Which layer is liquid?");
    expect(q1.querySelector("[data-testid=student-detail-review-student-answer]")!.textContent).toBe("A. Inner core");
    expect(q1.querySelector("[data-testid=student-detail-review-correct-answer]")!.textContent).toBe("B. Outer core");
    expect(q1.querySelector("[data-testid=student-detail-review-explanation]")!.textContent).toBe("The outer core is liquid iron.");
    const q3 = card.querySelector<HTMLElement>("[data-testid=student-detail-review-item-3]")!;
    expect(q3.querySelector("[data-testid=student-detail-review-student-answer]")!.textContent).toBe("No answer");
    await choose(card, "1");
    expect(toggleOf(card).textContent).toBe("Review answers · all correct");
  });

  it("shows results only, with a neutral note, for an adapted attempt", async () => {
    const { card } = setup(
      { "att-1": detail(), "att-2": detail({ attemptId: "att-2", canonicalContent: false }) },
      [summary("att-1", 1, 1000, 33), summary("att-2", 2, 2000, 33)],
    );
    toggleOf(card).click();
    await flush();
    const body = card.querySelector<HTMLElement>(".shell-student-detail-review-body")!;
    expect(body.querySelector("[data-testid=student-detail-review-note]")!.textContent).toBe(
      "Question wording isn't shown for this attempt.",
    );
    expect(body.querySelector("[data-testid=student-detail-review-stem]")).toBeNull();
    expect(body.querySelector("[data-testid=student-detail-review-student-answer]")).toBeNull();
    expect(body.querySelector("[data-testid=student-detail-review-status-1]")!.textContent).toBe("Incorrect");
  });

  it("shows a retryable error when the attempt read fails", async () => {
    const details: Record<string, TeacherVisibleAttempt | Error> = { "att-1": detail(), "att-2": new Error("nope") };
    const { card, calls } = setup(details, [summary("att-1", 1, 1000, 33), summary("att-2", 2, 2000, 33)]);
    const toggle = toggleOf(card);
    toggle.click();
    await flush();
    expect(card.querySelector("[data-testid=student-detail-review-error]")).not.toBeNull();
    expect(card.querySelector("[data-testid=student-detail-repeat-error]")!.textContent).toBe(
      "We couldn't check for repeated misses. Close and reopen to try again.",
    );
    details["att-2"] = detail({ attemptId: "att-2" });
    toggle.click();
    toggle.click();
    await flush();
    // The failed read is shared by the review and the repeated-miss check,
    // and retried once for both.
    expect(calls.filter((id) => id === "att-2")).toHaveLength(2);
    expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 3 correct");
    expect(card.querySelectorAll("[data-testid=student-detail-repeat-item]")).toHaveLength(2);
  });

  describe("Show incorrect only", () => {
    it("is a labelled checkbox, on by default, showing only the incorrect answers", async () => {
      const { card } = setup({ "att-1": detail(), "att-2": detail({ attemptId: "att-2" }) });
      toggleOf(card).click();
      await flush();
      const box = filterOf(card);
      expect(box.type).toBe("checkbox");
      expect(box.checked).toBe(true);
      expect(card.querySelector(`label[for="${box.id}"]`)!.textContent).toBe(" Show incorrect only");
      expect(visible(card)).toEqual(["student-detail-review-item-1", "student-detail-review-item-3"]);
    });

    it("switches to all questions, keeping correct responses inspectable, without new reads", async () => {
      const { card, calls } = setup({ "att-1": detail(), "att-2": detail({ attemptId: "att-2" }) });
      toggleOf(card).click();
      await flush();
      const before = calls.length;
      setFilter(card, false);
      expect(visible(card)).toEqual([
        "student-detail-review-item-1",
        "student-detail-review-item-2",
        "student-detail-review-item-3",
      ]);
      const q2 = card.querySelector<HTMLElement>("[data-testid=student-detail-review-item-2]")!;
      expect(q2.querySelector("[data-testid=student-detail-review-status-2]")!.textContent).toBe("Correct");
      expect(q2.querySelector("[data-testid=student-detail-review-student-answer]")!.textContent).toBe("A. Crust");
      setFilter(card, true);
      expect(visible(card)).toEqual(["student-detail-review-item-1", "student-detail-review-item-3"]);
      expect(calls).toHaveLength(before);
    });

    it("stays as set across attempt switches and never shows the previous attempt's questions", async () => {
      const { card } = setup({ "att-1": detail(), "att-2": allCorrect() });
      toggleOf(card).click();
      await flush();
      // Latest attempt is all correct: a positive empty state, no items shown.
      expect(visible(card)).toEqual([]);
      expect(card.querySelector("[data-testid=student-detail-review-all-correct]")!.textContent).toBe(
        "Every question in this attempt was answered correctly.",
      );
      await choose(card, "0");
      expect(filterOf(card).checked).toBe(true);
      expect(card.querySelector("[data-testid=student-detail-review-all-correct]")).toBeNull();
      expect(visible(card)).toEqual(["student-detail-review-item-1", "student-detail-review-item-3"]);
      await choose(card, "1");
      expect(visible(card)).toEqual([]);
      expect(card.querySelectorAll("[data-testid=student-detail-review-all-correct]")).toHaveLength(1);
      setFilter(card, false);
      expect(card.querySelector("[data-testid=student-detail-review-all-correct]")).toBeNull();
      expect(visible(card)).toHaveLength(3);
    });
  });

  describe("repeatedly missed questions", () => {
    it("lists questions missed on two attempts above the attempt selector", async () => {
      const { card } = setup(
        { "att-1": detail(), "att-2": detail({ attemptId: "att-2" }) },
        [summary("att-1", 1, 1000, 33), summary("att-2", 2, 2000, 33)],
      );
      toggleOf(card).click();
      await flush();
      const repeat = card.querySelector<HTMLElement>("[data-testid=student-detail-repeat]")!;
      expect(repeat.nextElementSibling!.className).toBe("shell-student-detail-review-attempt");
      const items = Array.from(repeat.querySelectorAll<HTMLElement>("[data-testid=student-detail-repeat-item]"));
      expect(items.map((li) => li.querySelector("[data-testid=student-detail-repeat-number]")!.textContent)).toEqual([
        "Question 1",
        "Question 3",
      ]);
      expect(items.map((li) => li.querySelector("[data-testid=student-detail-repeat-count]")!.textContent)).toEqual([
        "Missed 2 of 2 attempts",
        "Missed 2 of 2 attempts",
      ]);
      expect(items[0]!.querySelector("[data-testid=student-detail-repeat-stem]")!.textContent).toBe("Which layer is liquid?");
      expect(repeat.querySelector("[data-testid=student-detail-repeat-versions]")).toBeNull();
    });

    it("is one quiet line when nothing was missed twice", async () => {
      const { card } = setup({ "att-1": detail(), "att-2": allCorrect() });
      toggleOf(card).click();
      await flush();
      const repeat = card.querySelector<HTMLElement>("[data-testid=student-detail-repeat]")!;
      expect(repeat.childElementCount).toBe(1);
      expect(repeat.textContent).toBe("No question was missed more than once.");
    });

    it("is absent for a single attempt, which gets a Latest attempt label", async () => {
      const { card, calls } = setup({ "att-1": detail() }, [summary("att-1", 1, 1000, 33)]);
      expect(toggleOf(card).textContent).toBe("Review answers · 2 incorrect");
      toggleOf(card).click();
      await flush();
      expect(card.querySelector("[data-testid=student-detail-repeat]")).toBeNull();
      expect(card.querySelector("[data-testid=student-detail-review-attempt-label]")!.textContent).toBe(
        "Latest attempt · 33% · day-1000",
      );
      expect(calls).toEqual(["att-1"]);
    });

    it("reads at most the most recent attempts, two at a time, and says so", async () => {
      const total = MAX_REPEAT_ANALYSIS_ATTEMPTS + 5;
      const attempts: CompletedAttemptSummary[] = [];
      const details: Record<string, TeacherVisibleAttempt> = {};
      for (let n = 1; n <= total; n += 1) {
        attempts.push(summary(`att-${n}`, n, n * 1000, 33));
        details[`att-${n}`] = detail({ attemptId: `att-${n}`, attemptNumber: n });
      }
      const { card, calls, maxInFlight } = setup(details, attempts);
      toggleOf(card).click();
      await flush();
      for (let i = 0; i < 20; i += 1) await flush();
      expect(new Set(calls).size).toBe(MAX_REPEAT_ANALYSIS_ATTEMPTS);
      expect(calls).not.toContain("att-1");
      expect(maxInFlight()).toBeLessThanOrEqual(2);
      expect(card.querySelector("[data-testid=student-detail-repeat-scope]")!.textContent).toBe(
        `Based on the ${MAX_REPEAT_ANALYSIS_ATTEMPTS} most recent attempts.`,
      );
      expect(card.querySelector("[data-testid=student-detail-repeat-count]")!.textContent).toBe(
        `Missed ${MAX_REPEAT_ANALYSIS_ATTEMPTS} of ${MAX_REPEAT_ANALYSIS_ATTEMPTS} attempts`,
      );
    });
  });

  describe("three or more attempts and independent loading", () => {
    type Deferred = { resolve: (d: TeacherVisibleAttempt) => void; reject: (e: Error) => void };
    function deferredSetup(n: number) {
      const card = document.createElement("li");
      card.setAttribute("data-assignment-id", "a1");
      document.body.appendChild(card);
      const calls: string[] = [];
      const pending = new Map<string, Deferred>();
      const attemptDetail: AttemptGetForTeacherCallable = ({ attemptId }) => {
        calls.push(attemptId);
        return new Promise((resolve, reject) => pending.set(attemptId, { resolve, reject }));
      };
      const attempts = Array.from({ length: n }, (_v, i) => summary(`att-${i + 1}`, i + 1, (i + 1) * 1000, 10 * (i + 1), 1));
      appendQuestionReview(document, card, attempts, attemptDetail, async () => content, (ms) => `day-${ms}`);
      const settle = async (id: string, d: TeacherVisibleAttempt | Error): Promise<void> => {
        const p = pending.get(id)!;
        if (d instanceof Error) p.reject(d);
        else p.resolve(d);
        await flush();
      };
      return { card, calls, settle };
    }
    const repeatState = (card: HTMLElement) =>
      card.querySelector<HTMLElement>("[data-testid=student-detail-repeat]")!;

    it("lists Latest, then Previous attempt 1 as the immediately preceding attempt, counting back", async () => {
      const { card } = deferredSetup(4);
      toggleOf(card).click();
      await flush();
      const select = selectOf(card);
      expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
        ["3", "Latest attempt · 40% · day-4000"],
        ["2", "Previous attempt 1 · 30% · day-3000"],
        ["1", "Previous attempt 2 · 20% · day-2000"],
        ["0", "Previous attempt 3 · 10% · day-1000"],
      ]);
      expect(select.value).toBe("3");
    });

    it("shows the selected attempt as soon as its own read lands, while analysis is still pending", async () => {
      const { card, calls, settle } = deferredSetup(3);
      toggleOf(card).click();
      await flush();
      // Latest is read first; analysis has started on the next attempt (two at a time).
      expect(calls).toEqual(["att-3", "att-2"]);
      expect(repeatState(card).getAttribute("data-state")).toBe("loading");
      expect(repeatState(card).textContent).toBe("Checking for repeated misses…");
      await settle("att-3", detail({ attemptId: "att-3" }));
      expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 3 correct");
      expect(repeatState(card).getAttribute("data-state")).toBe("loading");
      await settle("att-2", detail({ attemptId: "att-2" }));
      expect(calls).toEqual(["att-3", "att-2", "att-1"]);
      expect(repeatState(card).getAttribute("data-state")).toBe("loading");
      await settle("att-1", detail({ attemptId: "att-1" }));
      expect(repeatState(card).getAttribute("data-state")).toBe("ready");
      expect(card.querySelector("[data-testid=student-detail-repeat-count]")!.textContent).toBe("Missed 3 of 3 attempts");
    });

    it("switches attempts during analysis without duplicate reads", async () => {
      const { card, calls, settle } = deferredSetup(3);
      toggleOf(card).click();
      await flush();
      // Switch to the oldest attempt before the analysis has reached it.
      await choose(card, "0");
      expect(toggleOf(card).textContent).toBe("Review answers · 2 incorrect");
      expect(calls).toEqual(["att-3", "att-2", "att-1"]);
      await settle("att-1", detail({ attemptId: "att-1" }));
      expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 3 correct");
      expect(repeatState(card).getAttribute("data-state")).toBe("loading");
      await settle("att-3", allCorrect());
      await settle("att-2", detail({ attemptId: "att-2" }));
      // A late read of the latest attempt never replaces the selected one.
      expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 3 correct");
      expect(repeatState(card).getAttribute("data-state")).toBe("ready");
      expect(calls).toEqual(["att-3", "att-2", "att-1"]);
    });

    it("reports a failed analysis as an error, never as no repeated misses, while the review still works", async () => {
      const { card, settle } = deferredSetup(3);
      toggleOf(card).click();
      await flush();
      await settle("att-3", detail({ attemptId: "att-3" }));
      await settle("att-2", new Error("denied"));
      await settle("att-1", detail({ attemptId: "att-1" }));
      expect(repeatState(card).getAttribute("data-state")).toBe("error");
      expect(card.querySelector("[data-testid=student-detail-repeat-none]")).toBeNull();
      expect(card.querySelector("[data-testid=student-detail-repeat-item]")).toBeNull();
      expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 3 correct");
    });
  });

  it("renders nothing without attempts or without the attempt reader", () => {
    const card = document.createElement("li");
    appendQuestionReview(document, card, [], async () => detail(), null, String);
    appendQuestionReview(document, card, [summary("att-1", 1, 1, 0)], null, null, String);
    expect(card.childElementCount).toBe(0);
  });
});
