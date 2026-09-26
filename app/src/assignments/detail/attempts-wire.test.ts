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

import { createAttemptGetForTeacherCallable } from "./attempts-wire";

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
