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
  repeatedMissesCount,
  reviewAnswersCount,
  type StudentThinkingPanel,
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
    expect(reviewAnswersCount(summary("a", 1, 1, 33, 1, 3))).toBe("2 incorrect");
    expect(reviewAnswersCount(summary("a", 1, 1, 100, 3, 3))).toBe("All correct");
    expect([0, 1, 4].map(repeatedMissesCount)).toEqual(["None", "1 question", "4 questions"]);
  });

  it("shows no count when the summary cannot support one", () => {
    for (const [score, maxScore] of [[1.5, 3], [4, 3], [-1, 3], [0, 0]] as const) {
      expect(attemptIncorrectCount(summary("a", 1, 1, 50, score, maxScore))).toBeNull();
      expect(reviewAnswersCount(summary("a", 1, 1, 50, score, maxScore))).toBeNull();
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
    thinking: StudentThinkingPanel | null = null,
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
    }, (ms) => `day-${ms}`, thinking);
    return { card, calls, revisionCalls, maxInFlight: () => maxInFlight };
  }
  const toggleOf = (card: HTMLElement) =>
    card.querySelector<HTMLButtonElement>("[data-testid=student-detail-review-toggle]")!;
  const repeatOf = (card: HTMLElement) =>
    card.querySelector<HTMLButtonElement>("[data-testid=student-detail-repeat-toggle]")!;
  const thinkingOf = (card: HTMLElement) =>
    card.querySelector<HTMLButtonElement>("[data-testid=student-detail-thinking-toggle]");
  // A tool's secondary count text, or null while it shows none.
  const countOf = (card: HTMLElement, testid: string): string | null => {
    const el = card.querySelector<HTMLElement>(`[data-testid=${testid}]`)!;
    return el.hidden ? null : el.textContent;
  };
  const expanded = (card: HTMLElement): string[] =>
    Array.from(card.querySelectorAll<HTMLButtonElement>("[data-tool]"))
      .filter((b) => b.getAttribute("aria-expanded") === "true")
      .map((b) => b.getAttribute("data-tool")!);
  // The panel a tool controls, within that tool's own card.
  const panelOf = (button: HTMLElement) =>
    button.closest("li")!.querySelector<HTMLElement>(`#${button.getAttribute("aria-controls")!}`)!;
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

  describe("assessment toolbar", () => {
    it("renders three tools in one group, all collapsed, with no reads until one opens", () => {
      const thinking = jest.fn();
      const { card, calls, revisionCalls } = setup({ "att-1": detail(), "att-2": allCorrect() }, undefined, thinking);
      const toolbar = card.querySelector<HTMLElement>("[data-testid=student-detail-tools]")!;
      expect(toolbar.getAttribute("role")).toBe("group");
      expect(toolbar.getAttribute("aria-label")).toBe("Assessment review tools");
      const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
      expect(buttons.map((b) => b.getAttribute("data-tool"))).toEqual(["review", "repeat", "thinking"]);
      expect(buttons.map((b) => b.querySelector(".shell-student-detail-tool-label")!.textContent)).toEqual([
        "Review answers",
        "Repeated misses",
        "Student thinking",
      ]);
      for (const b of buttons) {
        expect(b.type).toBe("button");
        expect(b.classList.contains("ll-chevron")).toBe(true);
        expect(b.getAttribute("aria-expanded")).toBe("false");
        expect(panelOf(b).hidden).toBe(true);
        // Each panel sits below the toolbar, never inside it.
        expect(toolbar.contains(panelOf(b))).toBe(false);
      }
      expect(buttons.map((b) => b.getAttribute("aria-controls"))).toEqual([
        "student-detail-review-a1",
        "student-detail-repeat-a1",
        "student-detail-thinking-a1",
      ]);
      expect(countOf(card, "student-detail-review-count")).toBe("All correct");
      // No repeated-miss count is invented before the analysis runs.
      expect(countOf(card, "student-detail-repeat-total")).toBeNull();
      expect(calls).toEqual([]);
      expect(revisionCalls).toEqual([]);
      expect(thinking).not.toHaveBeenCalled();
    });

    it("opens one panel at a time and collapses the active tool when chosen again", async () => {
      const thinking = jest.fn();
      const { card } = setup({ "att-1": detail(), "att-2": detail({ attemptId: "att-2" }) }, undefined, thinking);
      toggleOf(card).click();
      await flush();
      expect(expanded(card)).toEqual(["review"]);
      expect(panelOf(toggleOf(card)).hidden).toBe(false);
      repeatOf(card).click();
      await flush();
      expect(expanded(card)).toEqual(["repeat"]);
      expect(panelOf(toggleOf(card)).hidden).toBe(true);
      expect(panelOf(repeatOf(card)).hidden).toBe(false);
      thinkingOf(card)!.click();
      expect(expanded(card)).toEqual(["thinking"]);
      expect(panelOf(repeatOf(card)).hidden).toBe(true);
      expect(thinking).toHaveBeenCalledTimes(1);
      expect(thinking).toHaveBeenCalledWith(panelOf(thinkingOf(card)!));
      thinkingOf(card)!.click();
      expect(expanded(card)).toEqual([]);
      expect(Array.from(card.querySelectorAll<HTMLElement>(".shell-student-detail-tool-panel")).every((p) => p.hidden)).toBe(true);
      // Reopening a tool keeps what it loaded (no rebuild).
      toggleOf(card).click();
      expect(card.querySelectorAll("[data-testid=student-detail-review-select]")).toHaveLength(1);
    });

    it("keeps keyboard focus on the chosen tool as panels switch", async () => {
      const { card } = setup({ "att-1": detail(), "att-2": detail({ attemptId: "att-2" }) }, undefined, () => {});
      toggleOf(card).focus();
      toggleOf(card).click();
      await flush();
      expect(document.activeElement).toBe(toggleOf(card));
      repeatOf(card).focus();
      repeatOf(card).click();
      await flush();
      expect(document.activeElement).toBe(repeatOf(card));
      repeatOf(card).click();
      expect(document.activeElement).toBe(repeatOf(card));
    });

    it("omits Student thinking when no thinking panel is supplied", () => {
      const { card } = setup({ "att-1": detail() });
      expect(thinkingOf(card)).toBeNull();
      expect(Array.from(card.querySelectorAll("[data-tool]")).map((b) => b.getAttribute("data-tool"))).toEqual([
        "review",
        "repeat",
      ]);
    });

    it("starts collapsed and unread on a card rendered for another student, ignoring the old card's late results", async () => {
      const first = setup({ "att-1": detail(), "att-2": detail({ attemptId: "att-2" }) });
      repeatOf(first.card).click();
      first.card.remove();
      await flush();
      expect(countOf(first.card, "student-detail-repeat-total")).toBeNull();
      const second = setup({ "att-1": detail(), "att-2": allCorrect() });
      expect(expanded(second.card)).toEqual([]);
      expect(second.calls).toEqual([]);
      expect(countOf(second.card, "student-detail-review-count")).toBe("All correct");
      expect(countOf(second.card, "student-detail-repeat-total")).toBeNull();
    });
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
    // Only the selected attempt is read; the repeated-miss check waits for its own tool.
    expect(calls).toEqual(["att-2"]);
    expect(revisionCalls).toEqual([REV]);
    expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("3 of 3 correct");
  });

  it("updates the count to the selected attempt and shows that attempt's own answers", async () => {
    const { card, calls } = setup({ "att-1": detail(), "att-2": allCorrect() });
    toggleOf(card).click();
    await flush();
    await choose(card, "0");
    expect(countOf(card, "student-detail-review-count")).toBe("2 incorrect");
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
    expect(countOf(card, "student-detail-review-count")).toBe("All correct");
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
    // The failed read is forgotten, so the repeated-miss check retries it.
    repeatOf(card).click();
    await flush();
    expect(card.querySelector("[data-testid=student-detail-repeat-error]")!.textContent).toBe(
      "We couldn't check for repeated misses. Close and reopen to try again.",
    );
    expect(countOf(card, "student-detail-repeat-total")).toBeNull();
    details["att-2"] = detail({ attemptId: "att-2" });
    repeatOf(card).click();
    repeatOf(card).click();
    await flush();
    expect(card.querySelectorAll("[data-testid=student-detail-repeat-item]")).toHaveLength(2);
    expect(countOf(card, "student-detail-repeat-total")).toBe("2 questions");
    // The review shares the now-cached read: reopening it retries without another read.
    toggle.click();
    await flush();
    expect(calls.filter((id) => id === "att-2")).toHaveLength(3);
    expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 3 correct");
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
    it("lists questions missed on two attempts in its own panel, with the count on the tool", async () => {
      const { card, calls } = setup(
        { "att-1": detail(), "att-2": detail({ attemptId: "att-2" }) },
        [summary("att-1", 1, 1000, 33), summary("att-2", 2, 2000, 33)],
      );
      repeatOf(card).click();
      await flush();
      const repeat = card.querySelector<HTMLElement>("[data-testid=student-detail-repeat]")!;
      expect(repeat).toBe(panelOf(repeatOf(card)));
      expect(repeat.hidden).toBe(false);
      expect(countOf(card, "student-detail-repeat-total")).toBe("2 questions");
      // Newest first; the review was never opened.
      expect(calls).toEqual(["att-2", "att-1"]);
      expect(card.querySelector("[data-testid=student-detail-review-select]")).toBeNull();
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

    it("is one quiet line, and stays available, when nothing was missed twice", async () => {
      const { card } = setup({ "att-1": detail(), "att-2": allCorrect() });
      repeatOf(card).click();
      await flush();
      const repeat = card.querySelector<HTMLElement>("[data-testid=student-detail-repeat]")!;
      expect(repeat.childElementCount).toBe(1);
      expect(repeat.textContent).toBe("No question was missed more than once.");
      expect(countOf(card, "student-detail-repeat-total")).toBe("None");
    });

    it("explains a single attempt without reading anything; the review gets a Latest attempt label", async () => {
      const { card, calls } = setup({ "att-1": detail() }, [summary("att-1", 1, 1000, 33)]);
      expect(countOf(card, "student-detail-review-count")).toBe("2 incorrect");
      repeatOf(card).click();
      await flush();
      expect(card.querySelector("[data-testid=student-detail-repeat-single]")!.textContent).toBe(
        "Repeated misses appear after the student has two or more attempts.",
      );
      expect(calls).toEqual([]);
      repeatOf(card).click();
      repeatOf(card).click();
      expect(card.querySelectorAll("[data-testid=student-detail-repeat-single]")).toHaveLength(1);
      toggleOf(card).click();
      await flush();
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
      repeatOf(card).click();
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
      const { card, calls } = deferredSetup(4);
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
      expect(calls).toEqual(["att-4"]);
    });

    it("shows the selected attempt as soon as its own read lands, while analysis is still pending", async () => {
      const { card, calls, settle } = deferredSetup(3);
      repeatOf(card).click();
      await flush();
      // Analysis reads newest first, two at a time; the review then reuses the latest read.
      expect(calls).toEqual(["att-3", "att-2"]);
      toggleOf(card).click();
      await flush();
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
      // Analysis finished while its panel was closed; the tool's count is ready.
      expect(countOf(card, "student-detail-repeat-total")).toBe("2 questions");
      expect(expanded(card)).toEqual(["review"]);
    });

    it("switches attempts during analysis without duplicate reads", async () => {
      const { card, calls, settle } = deferredSetup(3);
      repeatOf(card).click();
      toggleOf(card).click();
      await flush();
      // Switch to the oldest attempt before the analysis has reached it.
      await choose(card, "0");
      expect(countOf(card, "student-detail-review-count")).toBe("2 incorrect");
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
      repeatOf(card).click();
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
