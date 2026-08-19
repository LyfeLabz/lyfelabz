/**
 * @jest-environment jsdom
 */

// Sprint 27 Phase 2 (Decision 1): unit tests for the `assessmentAttemptsList`
// student wire. The wire is the seam that keeps the pure activeStudent
// surface free of firebase/*. Tests inject a fake `httpsCallable` factory
// through a jest.mock; no real firebase/functions bindings are exercised.
//
// Load-bearing security distinction (blueprint §5.4, §5.5): the wire must
// invoke ONLY the caller-scoped `assessmentAttemptsList`, never the
// class-scoped teacher read `assessmentAttemptsListForClass`. The callable
// name is asserted directly, and a dedicated regression test fails if the
// wire were ever repointed at the teacher callable.

const callableInvocations: Array<{
  readonly name: string;
  readonly payload: unknown;
}> = [];

let callableResponse: unknown = null;
let callableRejection: Error | null = null;

jest.mock("firebase/functions", () => ({
  httpsCallable:
    (_functions: unknown, name: string) => (payload: unknown) => {
      callableInvocations.push({ name, payload });
      if (callableRejection !== null) {
        return Promise.reject(callableRejection);
      }
      return Promise.resolve({ data: callableResponse });
    },
}));

import type { Functions } from "firebase/functions";
import {
  createAttemptsListForStudentCallable,
  parseStudentAttemptSummary,
} from "./wire";

const resetInvocations = () => {
  callableInvocations.length = 0;
  callableResponse = null;
  callableRejection = null;
};

const okAttempt = (over: Record<string, unknown> = {}) => ({
  attemptId: "attempt-1",
  assignmentId: "assign-1",
  attemptNumber: 1,
  score: 8,
  maxScore: 10,
  percentage: 80,
  submittedAt: 1_700_000_000_000,
  ...over,
});

describe("parseStudentAttemptSummary", () => {
  const base = okAttempt();

  test("accepts a well-formed attempt and returns a frozen shape", () => {
    const item = parseStudentAttemptSummary(base);
    expect(item).not.toBeNull();
    expect(item).toEqual(base);
    expect(Object.isFrozen(item)).toBe(true);
  });

  test.each([
    ["missing attemptId", { ...base, attemptId: "" }],
    ["non-string attemptId", { ...base, attemptId: 1 }],
    ["missing assignmentId", { ...base, assignmentId: "" }],
    ["non-finite attemptNumber", { ...base, attemptNumber: Number.NaN }],
    ["string score", { ...base, score: "8" }],
    ["non-finite maxScore", { ...base, maxScore: Number.POSITIVE_INFINITY }],
    ["missing percentage", { ...base, percentage: null }],
    ["string submittedAt", { ...base, submittedAt: "later" }],
    ["null root", null],
    ["string root", "attempt-1"],
  ])("rejects malformed attempt: %s", (_label, raw) => {
    expect(parseStudentAttemptSummary(raw)).toBeNull();
  });

  test("does not surface answer-key or teacher-only fields even if present", () => {
    const item = parseStudentAttemptSummary({
      ...base,
      itemResults: [{ correctOptionId: "b", explanation: "because" }],
      responses: { q1: "a" },
      teacherId: "t-1",
      studentId: "other-student",
      districtId: "d-1",
      schoolId: "s-1",
    });
    expect(item).not.toBeNull();
    expect(item).toEqual(base);
    // The projection names only the allowlisted fields; nothing else is
    // copied onto the client shape.
    expect(Object.keys(item as object).sort()).toEqual(
      [
        "assignmentId",
        "attemptId",
        "attemptNumber",
        "maxScore",
        "percentage",
        "score",
        "submittedAt",
      ].sort(),
    );
  });
});

describe("createAttemptsListForStudentCallable", () => {
  const fakeFunctions = {} as unknown as Functions;

  beforeEach(() => {
    resetInvocations();
  });

  test("registers the callable under the caller-scoped name and sends the empty payload", async () => {
    callableResponse = { attempts: [] };
    const callable = createAttemptsListForStudentCallable(fakeFunctions);
    await callable();
    expect(callableInvocations).toHaveLength(1);
    expect(callableInvocations[0].name).toBe("assessmentAttemptsList");
    expect(callableInvocations[0].payload).toEqual({});
  });

  test("never sends a studentId or any caller-scoping identifier", async () => {
    callableResponse = { attempts: [okAttempt()] };
    const callable = createAttemptsListForStudentCallable(fakeFunctions);
    await callable();
    const payload = callableInvocations[0].payload as Record<string, unknown>;
    for (const forbidden of [
      "studentId",
      "uid",
      "userId",
      "districtId",
      "schoolId",
      "classId",
      "teacherId",
    ]) {
      expect(forbidden in payload).toBe(false);
    }
  });

  test("SECURITY REGRESSION: never targets the class-scoped teacher callable", async () => {
    callableResponse = { attempts: [] };
    const callable = createAttemptsListForStudentCallable(fakeFunctions);
    await callable();
    const names = callableInvocations.map((c) => c.name);
    expect(names).toContain("assessmentAttemptsList");
    expect(names).not.toContain("assessmentAttemptsListForClass");
    expect(names).not.toContain("assessmentAttemptGetForTeacher");
  });

  test("normalizes a well-formed response and freezes the attempt list", async () => {
    callableResponse = {
      attempts: [
        okAttempt(),
        okAttempt({ attemptId: "attempt-2", attemptNumber: 2, score: 10, percentage: 100 }),
      ],
    };
    const callable = createAttemptsListForStudentCallable(fakeFunctions);
    const res = await callable();
    expect(res.attempts).toHaveLength(2);
    expect(res.attempts[0]).toEqual(okAttempt());
    expect(Object.isFrozen(res.attempts)).toBe(true);
    expect(Object.isFrozen(res.attempts[0])).toBe(true);
  });

  test("silently drops malformed attempts but keeps the good ones", async () => {
    callableResponse = {
      attempts: [
        okAttempt(),
        { ...okAttempt({ attemptId: "attempt-2" }), percentage: "high" },
        { ...okAttempt({ attemptId: "attempt-3" }), assignmentId: "" },
        null,
        "attempt-4",
      ],
    };
    const callable = createAttemptsListForStudentCallable(fakeFunctions);
    const res = await callable();
    expect(res.attempts).toHaveLength(1);
    expect(res.attempts[0].attemptId).toBe("attempt-1");
  });

  test("returns an empty list when the response is empty or malformed at the root", async () => {
    for (const raw of [
      null,
      undefined,
      {},
      { attempts: null },
      { attempts: "not-an-array" },
    ]) {
      resetInvocations();
      callableResponse = raw;
      const callable = createAttemptsListForStudentCallable(fakeFunctions);
      const res = await callable();
      expect(res.attempts).toEqual([]);
    }
  });

  test("propagates callable failures so the surface can render a recoverable error", async () => {
    callableRejection = new Error("network");
    const callable = createAttemptsListForStudentCallable(fakeFunctions);
    await expect(callable()).rejects.toThrow("network");
  });
});
