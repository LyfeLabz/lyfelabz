import {
  aggregatePerQuestion,
  MIN_QUESTION_SUMMARY_ATTEMPTS,
  summarizeRetakeParticipation,
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

describe("summarizeRetakeParticipation (Assignment Overview attempt tiles)", () => {
  const member = (studentId: string, attemptNumber: number, attemptId?: string) => ({
    attemptId: attemptId ?? `${studentId}-${attemptNumber}`,
    studentId,
    attemptNumber,
  });

  test("no retakes: no entries (Attempt 1 is never reported)", () => {
    expect(
      summarizeRetakeParticipation([member("s1", 1), member("s2", 1)]),
    ).toEqual([]);
  });

  test("counts unique students per canonical attemptNumber, from Attempt 2, ascending", () => {
    const attempts = [
      member("s3", 3),
      member("s1", 1),
      member("s1", 2),
      member("s2", 1),
      member("s2", 2),
      member("s3", 1),
      member("s3", 2),
    ];
    expect(summarizeRetakeParticipation(attempts)).toEqual([
      { attemptNumber: 2, students: 3 },
      { attemptNumber: 3, students: 1 },
    ]);
  });

  test("a duplicate record for the same student and attempt number counts once", () => {
    expect(
      summarizeRetakeParticipation([
        member("s1", 2, "dup-a"),
        member("s1", 2, "dup-b"),
        member("s2", 2),
      ]),
    ).toEqual([{ attemptNumber: 2, students: 2 }]);
  });

  test("sparse attempt numbers are reported as they occur, never synthesized", () => {
    expect(
      summarizeRetakeParticipation([member("s1", 2), member("s1", 4)]),
    ).toEqual([
      { attemptNumber: 2, students: 1 },
      { attemptNumber: 4, students: 1 },
    ]);
  });

  test("ignores invalid attempt numbers rather than inferring them", () => {
    expect(
      summarizeRetakeParticipation([
        member("s1", 0),
        member("s2", 2.5),
        member("s3", Number.NaN),
        member("s4", 2),
      ]),
    ).toEqual([{ attemptNumber: 2, students: 1 }]);
  });
});
