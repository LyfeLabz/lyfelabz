import {
  aggregatePerQuestion,
  MIN_QUESTION_SUMMARY_ATTEMPTS,
} from "./question-summary";
import type { TeacherVisibleAttempt } from "./attempts-wire";

const attempt = (
  overrides: Partial<TeacherVisibleAttempt> = {},
): TeacherVisibleAttempt => ({
  attemptId: "a",
  studentId: "s",
  assignmentId: "asg",
  attemptNumber: 1,
  percentage: 100,
  itemResults: [],
  ...overrides,
});

describe("aggregatePerQuestion", () => {
  test("preserves canonical question order from the first attempt", () => {
    const attempts = [
      attempt({
        itemResults: [
          {
            itemId: "q3",
            isCorrect: true,
            correctOptionId: "c",
            studentResponse: "c",
          },
          {
            itemId: "q1",
            isCorrect: false,
            correctOptionId: "a",
            studentResponse: "b",
          },
        ],
      }),
    ];
    const agg = aggregatePerQuestion(attempts);
    expect(agg.questions.map((q) => q.itemId)).toEqual(["q3", "q1"]);
  });

  test("computes correct percentage per question", () => {
    const attempts = [
      attempt({
        studentId: "s1",
        itemResults: [
          {
            itemId: "q1",
            isCorrect: true,
            correctOptionId: "a",
            studentResponse: "a",
          },
        ],
      }),
      attempt({
        studentId: "s2",
        itemResults: [
          {
            itemId: "q1",
            isCorrect: false,
            correctOptionId: "a",
            studentResponse: "b",
          },
        ],
      }),
    ];
    const agg = aggregatePerQuestion(attempts);
    expect(agg.questions[0]?.correctPercentage).toBe(50);
    expect(agg.questions[0]?.correctCount).toBe(1);
    expect(agg.questions[0]?.totalResponses).toBe(2);
  });

  test("aggregates option distribution", () => {
    const attempts = [
      attempt({
        studentId: "s1",
        itemResults: [
          {
            itemId: "q1",
            isCorrect: true,
            correctOptionId: "a",
            studentResponse: "a",
          },
        ],
      }),
      attempt({
        studentId: "s2",
        itemResults: [
          {
            itemId: "q1",
            isCorrect: false,
            correctOptionId: "a",
            studentResponse: "b",
          },
        ],
      }),
      attempt({
        studentId: "s3",
        itemResults: [
          {
            itemId: "q1",
            isCorrect: false,
            correctOptionId: "a",
            studentResponse: "b",
          },
        ],
      }),
    ];
    const agg = aggregatePerQuestion(attempts);
    const options = agg.questions[0]?.options ?? [];
    const map = new Map(options.map((o) => [o.optionId, o.chosenPercentage]));
    expect(map.get("a")).toBeCloseTo(33.3, 1);
    expect(map.get("b")).toBeCloseTo(66.7, 1);
  });

  test("threshold constant is 3", () => {
    expect(MIN_QUESTION_SUMMARY_ATTEMPTS).toBe(3);
  });
});
