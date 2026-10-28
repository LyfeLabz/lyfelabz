/**
 * @jest-environment jsdom
 */

// Sprint 30 Show Your Thinking: the teacher attempt-detail wire carries the
// attempt's frozen written response through to Student Detail, and degrades
// to null for attempts that predate the field or carry a malformed value.

let callableResponse: unknown = null;
const callableInvocations: Array<{ readonly name: string; readonly payload: unknown }> = [];

jest.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (payload: unknown) => {
    callableInvocations.push({ name, payload });
    return Promise.resolve({ data: callableResponse });
  },
}));

import {
  createAttemptGetForTeacherCallable,
  createAttemptsListForStudentCallable,
} from "./attempts-wire";

const baseAttempt = {
  attemptId: "asg-1__s-1__a2",
  studentId: "s-1",
  assignmentId: "asg-1",
  attemptNumber: 2,
  percentage: 80,
  itemResults: [
    { itemId: "q1", isCorrect: true, correctOptionId: "A", studentResponse: "A" },
  ],
};

beforeEach(() => {
  callableInvocations.length = 0;
  callableResponse = null;
});

describe("createAttemptGetForTeacherCallable", () => {
  test("parses the attempt's written response", async () => {
    callableResponse = { attempt: { ...baseAttempt, writtenResponse: "Convection moves plates." } };
    const get = createAttemptGetForTeacherCallable({} as never);
    const out = await get({ attemptId: baseAttempt.attemptId });
    expect(callableInvocations).toEqual([
      { name: "assessmentAttemptGetForTeacher", payload: { attemptId: baseAttempt.attemptId } },
    ]);
    expect(out.writtenResponse).toBe("Convection moves plates.");
    expect(out.attemptNumber).toBe(2);
    expect(out.itemResults).toHaveLength(1);
  });

  test.each([
    ["absent (pre-feature attempt)", undefined],
    ["null", null],
    ["empty", ""],
    ["non-string", { text: "x" }],
  ])("yields null when the written response is %s", async (_label, value) => {
    callableResponse = {
      attempt: value === undefined ? baseAttempt : { ...baseAttempt, writtenResponse: value },
    };
    const out = await createAttemptGetForTeacherCallable({} as never)({
      attemptId: baseAttempt.attemptId,
    });
    expect(out.writtenResponse).toBeNull();
  });
});

// Student Detail question review (PDR-032e): the frozen explanation and the
// adapted-delivery flag reach the review; absent values degrade safely.
describe("createAttemptGetForTeacherCallable question review fields", () => {
  test("parses explanations and the canonical-content flag", async () => {
    callableResponse = {
      attempt: {
        ...baseAttempt,
        canonicalContent: false,
        itemResults: [
          { itemId: "q1", isCorrect: true, correctOptionId: "A", studentResponse: "A", explanation: "Because A." },
          { itemId: "q2", isCorrect: false, correctOptionId: "B", studentResponse: null, explanation: "" },
        ],
      },
    };
    const out = await createAttemptGetForTeacherCallable({} as never)({ attemptId: baseAttempt.attemptId });
    expect(out.canonicalContent).toBe(false);
    expect(out.itemResults.map((r) => r.explanation)).toEqual(["Because A.", null]);
  });

  test("treats an absent flag (older server) as canonical content", async () => {
    callableResponse = { attempt: baseAttempt };
    const out = await createAttemptGetForTeacherCallable({} as never)({ attemptId: baseAttempt.attemptId });
    expect(out.canonicalContent).toBe(true);
    expect(out.itemResults[0]!.explanation).toBeNull();
  });
});

// Student Support Access (PDR-032): the student-scoped list keeps only the
// requested student's well-formed summaries.
describe("createAttemptsListForStudentCallable", () => {
  test("calls the student-scoped callable and drops any other student's rows", async () => {
    const row = (attemptId: string, studentId: string) => ({
      attemptId, studentId, studentDisplayName: "Ada", assignmentId: "asg-1",
      attemptNumber: 1, score: 8, maxScore: 10, percentage: 80, submittedAt: 1000,
    });
    callableResponse = {
      classId: "class-1",
      studentId: "s-1",
      attempts: [row("a1", "s-1"), row("a2", "s-2"), { attemptId: "broken" }],
    };
    const out = await createAttemptsListForStudentCallable({} as never)({ classId: "class-1", studentId: "s-1" });
    expect(callableInvocations).toEqual([
      { name: "assessmentAttemptsListForStudent", payload: { classId: "class-1", studentId: "s-1" } },
    ]);
    expect(out.attempts.map((a) => a.attemptId)).toEqual(["a1"]);
  });
});
