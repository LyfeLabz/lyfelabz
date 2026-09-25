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

type Sub = {
  assignedGrade: number | null;
  draftGrade: number | null;
  state: "new" | "created" | "turnedIn" | "returned" | "reclaimed" | "other";
  late: boolean;
};
function sub(assignedGrade: number | null, draftGrade: number | null, overrides: Partial<Sub> = {}): Sub {
  return { assignedGrade, draftGrade, state: "created", late: false, ...overrides };
}
// The approved missing-work placeholder shape: draft 0, assigned blank,
// late, never turned in.
const missingDraftZero = sub(null, 0, { state: "created", late: true });

describe("decideGradeAction (canonical write decision)", () => {
  it("blank -> fill with the target", () => {
    expect(decideGradeAction(18, sub(null, null))).toEqual({
      action: "wouldFillBlank",
      proposedPoints: 18,
    });
  });
  it("lower -> raise to the target", () => {
    expect(decideGradeAction(18, sub(16, 16))).toEqual({
      action: "wouldRaise",
      proposedPoints: 18,
    });
    // A lower draft-only teacher value is raised too.
    expect(decideGradeAction(18, sub(null, 12)).action).toBe("wouldRaise");
  });
  it("equal -> no-op", () => {
    expect(decideGradeAction(18, sub(18, 18))).toEqual({
      action: "alreadyEqual",
      proposedPoints: null,
    });
  });
  it("higher -> preserve the Classroom grade, never lower", () => {
    expect(decideGradeAction(18, sub(20, 20))).toEqual({
      action: "preservedClassroomHigher",
      proposedPoints: null,
    });
  });
  it("synthetic safety case: a higher decimal Classroom grade is preserved", () => {
    expect(decideGradeAction(18, sub(18.25, 18.25)).action).toBe("preservedClassroomHigher");
  });
  it("a lower decimal Classroom grade is raised; decimals compare in hundredths", () => {
    expect(decideGradeAction(18, sub(17.99, 17.99)).action).toBe("wouldRaise");
    expect(decideGradeAction(18.8, sub(18.800000001, 18.800000001)).action).toBe("alreadyEqual");
  });

  describe("approved narrow missing-work draft-zero rule", () => {
    it("draft 0 + assigned blank + late + never turned in + positive target -> replace", () => {
      expect(decideGradeAction(14, missingDraftZero)).toEqual({
        action: "wouldReplaceMissingDraftZero",
        proposedPoints: 14,
      });
      expect(decideGradeAction(14, { ...missingDraftZero, state: "new" }).action).toBe(
        "wouldReplaceMissingDraftZero",
      );
    });
    it("assigned 0 is protected (with or without a draft 0)", () => {
      expect(decideGradeAction(14, sub(0, null, { late: true })).action).toBe("protectedAssignedZero");
      expect(decideGradeAction(14, sub(0, 0, { late: true })).action).toBe("protectedAssignedZero");
    });
    it("draft 0 on turned-in, returned, reclaimed, or unknown-state work is protected", () => {
      for (const state of ["turnedIn", "returned", "reclaimed", "other"] as const) {
        expect(decideGradeAction(14, { ...missingDraftZero, state }).action).toBe("protectedDraftZero");
      }
    });
    it("draft 0 on work that is not late is protected", () => {
      expect(decideGradeAction(14, { ...missingDraftZero, late: false }).action).toBe(
        "protectedDraftZero",
      );
    });
    it("a zero target never replaces a zero: it is already equal", () => {
      expect(decideGradeAction(0, missingDraftZero)).toEqual({
        action: "alreadyEqual",
        proposedPoints: null,
      });
      expect(decideGradeAction(0, sub(0, 0)).action).toBe("alreadyEqual");
    });
    it("assigned and draft that differ are protected, even if a write would raise both", () => {
      expect(decideGradeAction(18, sub(16, 17))).toEqual({
        action: "protectedGradesDiffer",
        proposedPoints: null,
      });
      expect(decideGradeAction(18, sub(0, 10, { late: true })).action).toBe("protectedGradesDiffer");
    });
  });

  it("write actions are exactly fill, raise, and the narrow draft-zero replacement", () => {
    expect([...WRITE_ACTIONS].sort()).toEqual([
      "wouldFillBlank",
      "wouldRaise",
      "wouldReplaceMissingDraftZero",
    ]);
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
