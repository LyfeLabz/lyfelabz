import type { AssessmentAttemptRecord } from "../../shared";
import { selectHighestCompletedAttempt } from "../../assessments/best-attempt";

import { computeGradePassbackEarnedPoints } from "./grade-calculation";

// Grade reconciliation plan: the pure, side-effect-free decision of what a
// teacher-approved Classroom grade sync WOULD do for one student. Shared
// vocabulary for the read-only preview (`lmsGradePassbacksPreview`) and any
// later write step, so both classify identically.
//
// Target: the canonical cumulative best, computed exactly as automatic
// passback does - `selectHighestCompletedAttempt` over the student's
// attempts on every occurrence of the class + lesson family, converted with
// `computeGradePassbackEarnedPoints` (half-even, 2 dp) against Current's
// maxPoints. No second scoring rule exists.
//
// Existing Classroom grade: LyfeLabz does not assume it owns any value in
// Classroom. A grade may be teacher-entered, from another workflow, or
// LyfeLabz-written; LyfeLabz itself always writes the SAME value to both
// `assignedGrade` and `draftGrade`.
//   - Both unset                      -> blank.
//   - Both set and equal, or one set  -> that value.
//   - Both set and different          -> divergent: a teacher has a pending
//     draft that differs from the recorded grade. Never overwritten
//     automatically.
// Never lower: an existing grade at or above the target is preserved.
// Zero: Classroom's missing-work handling and a deliberate teacher zero are
// indistinguishable through the API, so an existing 0 below a positive
// target is surfaced for teacher review, never filled automatically.
//
// Comparison is in hundredths: Classroom stores grades rounded to two
// decimal places and the target is already 2-dp half-even, so comparing
// integer hundredths avoids floating-point noise (e.g. 18.8 vs 18.800001).

export type GradeReconciliationAction =
  // Would write (safe, no teacher judgement needed beyond confirming the sync).
  | "wouldFillBlank"
  | "wouldRaise"
  // No write.
  | "alreadyEqual"
  | "preservedClassroomHigher"
  | "noLyfeLabzAttempt"
  | "outsideRoster"
  // Needs teacher review before any write.
  | "reviewExistingZero"
  | "reviewGradesDiffer"
  // Cannot be evaluated.
  | "identityUnresolved"
  | "identityConflict"
  | "submissionUnavailable"
  | "submissionAmbiguous"
  | "error";

export const WRITE_ACTIONS: ReadonlySet<GradeReconciliationAction> = new Set([
  "wouldFillBlank",
  "wouldRaise",
]);

export type ExistingClassroomGrade =
  | { readonly kind: "blank" }
  | { readonly kind: "set"; readonly points: number }
  | { readonly kind: "divergent"; readonly assigned: number; readonly draft: number };

export function toHundredths(points: number): number {
  return Math.round(points * 100);
}

export function readExistingClassroomGrade(
  assignedGrade: number | null,
  draftGrade: number | null,
): ExistingClassroomGrade {
  if (assignedGrade === null && draftGrade === null) return { kind: "blank" };
  if (assignedGrade !== null && draftGrade !== null) {
    return toHundredths(assignedGrade) === toHundredths(draftGrade)
      ? { kind: "set", points: assignedGrade }
      : { kind: "divergent", assigned: assignedGrade, draft: draftGrade };
  }
  return { kind: "set", points: (assignedGrade ?? draftGrade) as number };
}

export type CumulativeTarget = {
  readonly bestPercentage: number;
  readonly bestAttemptId: string;
  readonly targetPoints: number;
};

// Canonical cumulative best across the family, or null when the student has
// no valid completed attempt.
export function cumulativeTargetFor(
  attempts: readonly { readonly id: string; readonly data: AssessmentAttemptRecord }[],
  maxPoints: number,
): CumulativeTarget | null {
  const best = selectHighestCompletedAttempt(attempts);
  if (best === null) return null;
  return {
    bestPercentage: best.percentage,
    bestAttemptId: best.attemptId,
    targetPoints: computeGradePassbackEarnedPoints(best.percentage, maxPoints),
  };
}

export type GradeDecision = {
  readonly action: GradeReconciliationAction;
  // The value a write would set, when there is one to consider. Never lower
  // than an existing Classroom grade.
  readonly proposedPoints: number | null;
};

export function decideGradeAction(
  targetPoints: number,
  existing: ExistingClassroomGrade,
): GradeDecision {
  const target = toHundredths(targetPoints);
  switch (existing.kind) {
    case "blank":
      return { action: "wouldFillBlank", proposedPoints: targetPoints };
    case "divergent": {
      const highest = Math.max(
        toHundredths(existing.assigned),
        toHundredths(existing.draft),
      );
      return {
        action: "reviewGradesDiffer",
        proposedPoints: target > highest ? targetPoints : null,
      };
    }
    case "set": {
      const current = toHundredths(existing.points);
      if (current === target) return { action: "alreadyEqual", proposedPoints: null };
      if (current > target) {
        return { action: "preservedClassroomHigher", proposedPoints: null };
      }
      if (current === 0) {
        return { action: "reviewExistingZero", proposedPoints: targetPoints };
      }
      return { action: "wouldRaise", proposedPoints: targetPoints };
    }
  }
}
