import type { AssessmentAttemptRecord } from "../../shared";

import {
  WRITE_ACTIONS,
  cumulativeTargetFor,
  decideGradeAction,
  readExistingClassroomGrade,
  toHundredths,
} from "./reconciliation-plan";

function attempt(
  id: string,
  assignmentId: string,
  percentage: number,
  attemptNumber: number,
  submittedAtMs: number,
): { id: string; data: AssessmentAttemptRecord } {
  return {
    id,
    data: {
      assignmentId,
      percentage,
      score: percentage / 10,
      maxScore: 10,
      attemptNumber,
      submittedAt: { toMillis: () => submittedAtMs },
    } as unknown as AssessmentAttemptRecord,
  };
}

describe("readExistingClassroomGrade", () => {
  it("treats both fields unset as blank", () => {
    expect(readExistingClassroomGrade(null, null)).toEqual({ kind: "blank" });
  });
  it("uses assignedGrade when only it is set", () => {
    expect(readExistingClassroomGrade(16, null)).toEqual({ kind: "set", points: 16 });
  });
  it("uses draftGrade when only it is set", () => {
    expect(readExistingClassroomGrade(null, 14)).toEqual({ kind: "set", points: 14 });
  });
  it("treats equal assigned and draft grades as one value", () => {
    expect(readExistingClassroomGrade(18, 18)).toEqual({ kind: "set", points: 18 });
  });
  it("reports differing assigned and draft grades as divergent", () => {
    expect(readExistingClassroomGrade(16, 19)).toEqual({
      kind: "divergent",
      assigned: 16,
      draft: 19,
    });
  });
  it("compares in hundredths, so float noise is not divergence", () => {
    expect(readExistingClassroomGrade(18.8, 18.800000001).kind).toBe("set");
  });
});

describe("decideGradeAction (never lower)", () => {
  it("existing equals target: alreadyEqual, nothing proposed", () => {
    expect(decideGradeAction(18, { kind: "set", points: 18 })).toEqual({
      action: "alreadyEqual",
      proposedPoints: null,
    });
  });
  it("existing lower than target: wouldRaise to the target", () => {
    expect(decideGradeAction(18, { kind: "set", points: 16 })).toEqual({
      action: "wouldRaise",
      proposedPoints: 18,
    });
  });
  it("existing higher than target: preserved, nothing proposed", () => {
    expect(decideGradeAction(18, { kind: "set", points: 20 })).toEqual({
      action: "preservedClassroomHigher",
      proposedPoints: null,
    });
  });
  it("synthetic safety case: a higher decimal Classroom grade is preserved", () => {
    expect(decideGradeAction(18, { kind: "set", points: 18.25 }).action).toBe(
      "preservedClassroomHigher",
    );
  });
  it("a lower decimal Classroom grade is raised", () => {
    expect(decideGradeAction(18, { kind: "set", points: 17.99 }).action).toBe("wouldRaise");
  });
  it("blank: wouldFillBlank with the target", () => {
    expect(decideGradeAction(18, { kind: "blank" })).toEqual({
      action: "wouldFillBlank",
      proposedPoints: 18,
    });
  });
  it("existing zero below a positive target goes to teacher review, never auto-fill", () => {
    expect(decideGradeAction(14, { kind: "set", points: 0 })).toEqual({
      action: "reviewExistingZero",
      proposedPoints: 14,
    });
  });
  it("existing zero equal to a zero target is already equal", () => {
    expect(decideGradeAction(0, { kind: "set", points: 0 }).action).toBe("alreadyEqual");
  });
  it("divergent grades go to review, proposing only a value above both", () => {
    expect(decideGradeAction(18, { kind: "divergent", assigned: 16, draft: 17 })).toEqual({
      action: "reviewGradesDiffer",
      proposedPoints: 18,
    });
    expect(decideGradeAction(18, { kind: "divergent", assigned: 16, draft: 19 })).toEqual({
      action: "reviewGradesDiffer",
      proposedPoints: null,
    });
  });
  it("only fill and raise are write actions", () => {
    expect([...WRITE_ACTIONS].sort()).toEqual(["wouldFillBlank", "wouldRaise"]);
  });
});

describe("cumulativeTargetFor (canonical best across the family)", () => {
  it("returns null with no valid completed attempt", () => {
    expect(cumulativeTargetFor([], 20)).toBeNull();
    const malformed = attempt("x", "a1", Number.NaN, 1, 1);
    expect(cumulativeTargetFor([malformed], 20)).toBeNull();
  });

  it("takes the best percentage across historical occurrences, scaled to Current", () => {
    // 90% on an older /10 occurrence, 80% on Current /20: best is 90% -> 18/20.
    const target = cumulativeTargetFor(
      [attempt("old", "a2", 90, 1, 1000), attempt("cur", "a4", 80, 1, 2000)],
      20,
    );
    expect(target).toEqual({ bestPercentage: 90, bestAttemptId: "old", targetPoints: 18 });
  });

  it("counts an attempt on an older ungraded occurrence", () => {
    const target = cumulativeTargetFor([attempt("ungraded", "a3", 100, 1, 1000)], 20);
    expect(target?.targetPoints).toBe(20);
  });

  it("a lower later attempt never lowers the target", () => {
    const target = cumulativeTargetFor(
      [attempt("first", "a4", 90, 1, 1000), attempt("later", "a4", 40, 2, 2000)],
      20,
    );
    expect(target?.targetPoints).toBe(18);
    expect(target?.bestAttemptId).toBe("first");
  });

  it("perfect score maps to maxPoints", () => {
    expect(cumulativeTargetFor([attempt("p", "a4", 100, 1, 1)], 20)?.targetPoints).toBe(20);
  });

  it("uses the canonical half-even 2 dp rounding", () => {
    // 33.33% of 20 = 6.666 -> 6.67; 12.5% of 10 = 1.25 (exact).
    expect(cumulativeTargetFor([attempt("t", "a4", 33.33, 1, 1)], 20)?.targetPoints).toBe(6.67);
    expect(cumulativeTargetFor([attempt("t", "a4", 12.5, 1, 1)], 10)?.targetPoints).toBe(1.25);
    // 70% of 20 = 14 (no float residue after rounding).
    expect(toHundredths(cumulativeTargetFor([attempt("t", "a4", 70, 1, 1)], 20)?.targetPoints ?? -1)).toBe(1400);
  });
});
