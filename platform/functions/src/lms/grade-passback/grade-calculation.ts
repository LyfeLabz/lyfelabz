import { roundHalfToEven2 } from "../../shared";

// Sprint 30A.2 - the locked grade-passback earned-points calculation:
//
//   earnedPoints = halfEvenRound(bestPercentage / 100 * maxPoints, 2 dp)
//
// `bestPercentage` is the canonical best LyfeLabz performance (from
// `selectHighestCompletedAttempt`), never a raw attempt `score` - see
// `engine.ts`'s module comment for why raw score is never comparable
// across assessment revisions. `maxPoints` is the teacher-selected
// Classroom maximum point value, frozen from the assignment's
// `classroomGrading` snapshot at publication time (never re-derived, never
// editable post-publication in Sprint 30A v1).
//
// Reuses the exact same `roundHalfToEven2` helper
// `assessmentAttemptsFinalize` uses for the percentage itself
// (`shared/math/round-half-to-even.ts`), so there is exactly one
// half-even rounding contract in the codebase rather than two that could
// drift.
//
// `AssessmentAttemptRecord.percentage` is always in the closed range
// [0, 100]: the scorer (`assessment-attempts-finalize.ts`'s
// `scoreAttempt`) awards each item at most its listed unit point value
// with no partial credit and no bonus mechanism, so `score` can never
// exceed `maxScore` and the percentage can never exceed 100. This
// function does not additionally clamp above 100% for that reason: doing
// so would silently mask a genuine scorer defect elsewhere rather than
// surface it. It DOES defensively floor at 0 so a pathological negative
// input (which should never occur) cannot produce a negative Classroom
// grade.
export function computeGradePassbackEarnedPoints(
  bestPercentage: number,
  maxPoints: number,
): number {
  const safePercentage = bestPercentage < 0 ? 0 : bestPercentage;
  return roundHalfToEven2((safePercentage / 100) * maxPoints);
}
