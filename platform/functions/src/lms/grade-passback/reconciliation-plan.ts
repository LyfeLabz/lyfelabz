import type { AssessmentAttemptRecord } from "../../shared";
import { selectHighestCompletedAttempt } from "../../assessments/best-attempt";

import type { LmsSubmissionState } from "../providers/provider";

import { computeGradePassbackEarnedPoints } from "./grade-calculation";

// Grade reconciliation plan: the ONE canonical, side-effect-free decision of
// whether a Classroom grade write is allowed for one student, given FRESH
// live Classroom submission state. Every grade-writing route uses it:
// teacher reconciliation (preview + apply), automatic post-attempt passback,
// and Retry (the latter two through the grade-passback engine, which calls
// `decideGradeAction` under its lease immediately before any PATCH).
//
// Target: the canonical cumulative best, computed exactly as automatic
// passback always has - `selectHighestCompletedAttempt` over the student's
// attempts on every occurrence of the class + lesson family, converted with
// `computeGradePassbackEarnedPoints` (half-even, 2 dp) against the
// destination's live-verified maxPoints. No second scoring rule exists.
//
// Existing Classroom grade: LyfeLabz does not assume it owns any value in
// Classroom. LyfeLabz itself always writes the SAME value to both
// `assignedGrade` and `draftGrade`.
//   - Both unset                      -> blank: fill.
//   - Both set and equal, or one set  -> that value.
//   - Both set and different          -> protected (a teacher has a pending
//     draft that differs from the recorded grade).
// Never lower: an existing grade above the target is preserved; an equal
// grade is a no-op.
//
// Zero (approved narrow rule). An existing Classroom 0 below a positive
// target is replaceable ONLY as a missing-work placeholder, which requires
// ALL of: `draftGrade === 0`, `assignedGrade` unset, the submission is late,
// the submission is not turned in (`new`/`created`), and a positive
// LyfeLabz target (which implies a valid completed attempt). Any other zero
// is protected: an assigned 0, a draft 0 on turned-in/returned/reclaimed or
// on-time work. A zero target never replaces a zero (that is `alreadyEqual`).
//
// Comparison is in hundredths: Classroom stores grades rounded to two
// decimal places and the target is already 2-dp half-even, so comparing
// integer hundredths avoids floating-point noise (e.g. 18.8 vs 18.800001).

export type GradeReconciliationAction =
  // Write allowed.
  | "wouldFillBlank"
  | "wouldRaise"
  | "wouldReplaceMissingDraftZero"
  // No write: Classroom already satisfies LyfeLabz.
  | "alreadyEqual"
  | "preservedClassroomHigher"
  // No write: protected existing Classroom grade.
  | "protectedAssignedZero"
  | "protectedDraftZero"
  | "protectedGradesDiffer"
  // No write: nothing to send / not in scope.
  | "noLyfeLabzAttempt"
  | "outsideRoster"
  // Cannot be evaluated.
  | "identityUnresolved"
  | "identityConflict"
  | "submissionUnavailable"
  | "submissionAmbiguous"
  | "error";

export const WRITE_ACTIONS: ReadonlySet<GradeReconciliationAction> = new Set([
  "wouldFillBlank",
  "wouldRaise",
  "wouldReplaceMissingDraftZero",
]);

export const PROTECTED_ACTIONS: ReadonlySet<GradeReconciliationAction> = new Set([
  "protectedAssignedZero",
  "protectedDraftZero",
  "protectedGradesDiffer",
]);

export type ExistingClassroomGrade =
  | { readonly kind: "blank" }
  | { readonly kind: "set"; readonly points: number }
  | { readonly kind: "divergent"; readonly assigned: number; readonly draft: number };

// The fresh live state of one Classroom submission, in vendor-neutral terms.
export type LiveSubmissionGradeState = {
  readonly assignedGrade: number | null;
  readonly draftGrade: number | null;
  readonly state: LmsSubmissionState;
  readonly late: boolean;
};

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

// Not turned in: the student has never submitted. `reclaimed` (turned in,
// then unsubmitted) and `returned` involve prior teacher/student action and
// are deliberately NOT treated as placeholders.
export function isNeverTurnedIn(state: LmsSubmissionState): boolean {
  return state === "new" || state === "created";
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
  // The value a write would set; present only for write actions.
  readonly proposedPoints: number | null;
};

// Canonical decision for a student WITH a valid completed attempt (target
// computed by `cumulativeTargetFor`) against fresh live submission state.
export function decideGradeAction(
  targetPoints: number,
  submission: LiveSubmissionGradeState,
): GradeDecision {
  const target = toHundredths(targetPoints);
  const existing = readExistingClassroomGrade(
    submission.assignedGrade,
    submission.draftGrade,
  );
  switch (existing.kind) {
    case "blank":
      return { action: "wouldFillBlank", proposedPoints: targetPoints };
    case "divergent":
      return { action: "protectedGradesDiffer", proposedPoints: null };
    case "set": {
      const current = toHundredths(existing.points);
      if (current === target) return { action: "alreadyEqual", proposedPoints: null };
      if (current > target) {
        return { action: "preservedClassroomHigher", proposedPoints: null };
      }
      if (current === 0) {
        if (submission.assignedGrade !== null) {
          return { action: "protectedAssignedZero", proposedPoints: null };
        }
        if (target > 0 && submission.late && isNeverTurnedIn(submission.state)) {
          return { action: "wouldReplaceMissingDraftZero", proposedPoints: targetPoints };
        }
        return { action: "protectedDraftZero", proposedPoints: null };
      }
      return { action: "wouldRaise", proposedPoints: targetPoints };
    }
  }
}
