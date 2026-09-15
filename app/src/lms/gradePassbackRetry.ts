import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Sprint 30A.2 - client wire for the certified `lmsGradePassbacksRetry`
// callable. See platform/functions/src/lms/lms-grade-passbacks-retry.ts
// for the canonical server contract: teacher-ownership check on the
// assignment, graded-only gate, and delegation to the exact same
// monotonic synchronization engine attempt finalization uses. This wire
// never accepts or sends a grade value - only the identifiers needed to
// target one (assignment, student) pair.
export type GradePassbackRetryStatus = "synced" | "pending" | "failed" | "notApplicable";

export type GradePassbackRetry = (input: {
  readonly assignmentId: string;
  readonly studentId: string;
}) => Promise<GradePassbackRetryStatus>;

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "synced",
  "pending",
  "failed",
  "notApplicable",
]);

export function createFirebaseGradePassbackRetry(
  functions: Functions,
): GradePassbackRetry {
  const callable = httpsCallable<
    { assignmentId: string; studentId: string },
    { ok?: unknown; status?: unknown }
  >(functions, "lmsGradePassbacksRetry");
  return async (input) => {
    const res = await callable(input);
    const status = res.data?.status;
    if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
      throw new Error("lmsGradePassbacksRetry returned an unexpected shape.");
    }
    return status as GradePassbackRetryStatus;
  };
}
