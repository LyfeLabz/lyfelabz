import { isStaleGradeImprovementError, parseHistory, parseMutation, parsePending } from "./types";

describe("grade improvements response parsing", () => {
  test("parsePending accepts a well-formed row and rejects malformed ones", () => {
    const row = {
      assignmentId: "a1",
      studentId: "s1",
      baselinePercentage: 60,
      baselineSource: "firstAttempt",
      bestPercentage: 90,
      bestAttemptId: "t3",
    };
    expect(parsePending(row)).toEqual(row);
    expect(parsePending({ ...row, baselineSource: "other" })).toBeNull();
    expect(parsePending({ ...row, bestPercentage: "90" })).toBeNull();
    expect(parsePending(null)).toBeNull();
  });

  test("parseHistory drops malformed events and keeps order", () => {
    const h = parseHistory({
      assignmentId: "a1",
      studentId: "s1",
      effective: null,
      events: [
        { eventId: "e000002", type: "reversed", percentage: 90, attemptId: "t3", targetEventId: "e000001", createdAt: 2 },
        { eventId: "bad", type: "deleted", percentage: 90, attemptId: "t3" },
        { eventId: "e000001", type: "acknowledged", percentage: 90, attemptId: "t3", baselinePercentage: 60, createdAt: 1, byCaller: true },
      ],
    });
    expect(h?.events.map((e) => e.eventId)).toEqual(["e000002", "e000001"]);
    expect(h?.events[1]?.byCaller).toBe(true);
    expect(h?.events[0]?.byCaller).toBe(false);
  });

  test("parseMutation rejects an unknown status", () => {
    expect(() => parseMutation({ status: "deleted", history: { assignmentId: "a", studentId: "s", events: [] } })).toThrow();
  });

  test("stale detection reads the canonical platform code from details", () => {
    expect(isStaleGradeImprovementError({ details: { code: "gradeImprovements.stale" } })).toBe(true);
    expect(isStaleGradeImprovementError({ details: { code: "gradeImprovements.writeConflict" } })).toBe(false);
    expect(isStaleGradeImprovementError(new Error("x"))).toBe(false);
  });
});
