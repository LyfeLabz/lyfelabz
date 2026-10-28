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
import { appendQuestionReview, buildAttemptQuestionReview } from "./studentDetailQuestionReview";

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

describe("appendQuestionReview", () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  };
  const summary = (attemptId: string, attemptNumber: number, submittedAt: number, percentage: number): CompletedAttemptSummary => ({
    attemptId,
    studentId: "s1",
    studentDisplayName: "Ada",
    assignmentId: "a1",
    attemptNumber,
    score: 0,
    maxScore: 3,
    percentage,
    submittedAt,
  });

  function setup(details: Record<string, TeacherVisibleAttempt | Error>) {
    const card = document.createElement("li");
    card.setAttribute("data-assignment-id", "a1");
    document.body.appendChild(card);
    const calls: string[] = [];
    const revisionCalls: string[] = [];
    const attemptDetail: AttemptGetForTeacherCallable = async ({ attemptId }) => {
      calls.push(attemptId);
      const d = details[attemptId]!;
      if (d instanceof Error) throw d;
      return d;
    };
    const attempts = [summary("att-1", 1, 1000, 33), summary("att-2", 2, 2000, 100)];
    appendQuestionReview(document, card, attempts, attemptDetail, async (id) => {
      revisionCalls.push(id);
      return content;
    }, (ms) => `day-${ms}`);
    return { card, calls, revisionCalls };
  }

  it("is closed and makes no read until opened, then shows the latest attempt", async () => {
    const second = detail({
      attemptId: "att-2",
      attemptNumber: 2,
      itemResults: detail().itemResults.map((r) => ({ ...r, isCorrect: true, studentResponse: r.correctOptionId })),
    });
    const { card, calls, revisionCalls } = setup({ "att-1": detail(), "att-2": second });
    const toggle = card.querySelector<HTMLButtonElement>("[data-testid=student-detail-review-toggle]")!;
    expect(toggle.textContent).toBe("Review questions");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(calls).toEqual([]);

    toggle.click();
    await flush();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const select = card.querySelector<HTMLSelectElement>("[data-testid=student-detail-review-select]")!;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Attempt 1 · 33% · day-1000",
      "Attempt 2 · 100% · day-2000",
    ]);
    expect(select.value).toBe("1");
    expect(calls).toEqual(["att-2"]);
    expect(revisionCalls).toEqual([REV]);
    expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("3 of 3 correct");
    expect(card.querySelector("[data-testid=student-detail-review-missed]")).toBeNull();
  });

  it("switches to an earlier attempt and shows its own answers, explanations and missed list", async () => {
    const { card, calls, revisionCalls } = setup({ "att-1": detail(), "att-2": detail({ attemptId: "att-2" }) });
    card.querySelector<HTMLButtonElement>("[data-testid=student-detail-review-toggle]")!.click();
    await flush();
    const select = card.querySelector<HTMLSelectElement>("[data-testid=student-detail-review-select]")!;
    select.value = "0";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(calls).toEqual(["att-2", "att-1"]);
    expect(revisionCalls).toEqual([REV]);
    expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 3 correct");
    expect(card.querySelector("[data-testid=student-detail-review-missed]")!.textContent).toBe("To review: Q1, Q3");
    const q1 = card.querySelector<HTMLElement>("[data-testid=student-detail-review-item-1]")!;
    expect(q1.getAttribute("data-status")).toBe("incorrect");
    expect(q1.querySelector("[data-testid=student-detail-review-status-1]")!.textContent).toBe("Incorrect");
    expect(q1.querySelector("[data-testid=student-detail-review-stem]")!.textContent).toBe("Which layer is liquid?");
    expect(q1.querySelector("[data-testid=student-detail-review-student-answer]")!.textContent).toBe("A. Inner core");
    expect(q1.querySelector("[data-testid=student-detail-review-correct-answer]")!.textContent).toBe("B. Outer core");
    expect(q1.querySelector("[data-testid=student-detail-review-explanation]")!.textContent).toBe("The outer core is liquid iron.");
    const q2 = card.querySelector<HTMLElement>("[data-testid=student-detail-review-item-2]")!;
    expect(q2.querySelector("[data-testid=student-detail-review-correct-answer]")).toBeNull();
    expect(q2.querySelector("[data-testid=student-detail-review-explanation]")).toBeNull();
    const q3 = card.querySelector<HTMLElement>("[data-testid=student-detail-review-item-3]")!;
    expect(q3.querySelector("[data-testid=student-detail-review-student-answer]")!.textContent).toBe("No answer");
  });

  it("shows results only, with a neutral note, for an adapted attempt and never reads revision text", async () => {
    const { card, revisionCalls } = setup({ "att-1": detail(), "att-2": detail({ attemptId: "att-2", canonicalContent: false }) });
    card.querySelector<HTMLButtonElement>("[data-testid=student-detail-review-toggle]")!.click();
    await flush();
    expect(revisionCalls).toEqual([]);
    expect(card.querySelector("[data-testid=student-detail-review-note]")!.textContent).toBe(
      "Question wording isn't shown for this attempt.",
    );
    expect(card.querySelector("[data-testid=student-detail-review-stem]")).toBeNull();
    expect(card.querySelector("[data-testid=student-detail-review-student-answer]")).toBeNull();
    expect(card.querySelector("[data-testid=student-detail-review-status-1]")!.textContent).toBe("Incorrect");
  });

  it("shows a retryable error when the attempt read fails", async () => {
    const details: Record<string, TeacherVisibleAttempt | Error> = { "att-1": detail(), "att-2": new Error("nope") };
    const { card, calls } = setup(details);
    const toggle = card.querySelector<HTMLButtonElement>("[data-testid=student-detail-review-toggle]")!;
    toggle.click();
    await flush();
    expect(card.querySelector("[data-testid=student-detail-review-error]")).not.toBeNull();
    details["att-2"] = detail({ attemptId: "att-2" });
    toggle.click();
    toggle.click();
    await flush();
    expect(calls).toEqual(["att-2", "att-2"]);
    expect(card.querySelector("[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 3 correct");
  });

  it("renders nothing without attempts or without the attempt reader", () => {
    const card = document.createElement("li");
    appendQuestionReview(document, card, [], async () => detail(), null, String);
    appendQuestionReview(document, card, [summary("att-1", 1, 1, 0)], null, null, String);
    expect(card.childElementCount).toBe(0);
  });
});
