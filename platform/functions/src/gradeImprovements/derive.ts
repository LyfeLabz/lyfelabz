import type { AssessmentAttemptRecord } from "../shared";
import { selectHighestCompletedAttempt } from "../assessments/best-attempt";

import type { GradeImprovementEffectiveAck, GradeImprovementEventType } from "./types";

// Pure Grade Improvements derivation. No Firestore, no clock.
//
// Detection is per student, per assignment occurrence (`assignmentId`). The
// caller passes ONLY that student's attempts on that one assignment, so a
// reassigned lesson (a different assignmentId) is never merged in. This is
// deliberately separate from the Current occurrence grouping used by Student
// Detail cards and Classroom passback.
//
// Best score is the canonical `selectHighestCompletedAttempt` (percentage
// first; raw score never compared). Nothing here changes how a best score is
// chosen.

type AttemptInput = { readonly id: string; readonly data: AssessmentAttemptRecord };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function submittedMillis(data: AssessmentAttemptRecord): number | null {
  const ts = data.submittedAt as unknown as { toMillis?: () => unknown } | null | undefined;
  if (ts && typeof ts.toMillis === "function") {
    const ms = ts.toMillis();
    if (isFiniteNumber(ms)) return ms;
  }
  return null;
}

function isScorable(data: AssessmentAttemptRecord): boolean {
  return (
    isFiniteNumber(data.percentage) &&
    isFiniteNumber(data.score) &&
    isFiniteNumber(data.maxScore) &&
    isFiniteNumber(data.attemptNumber)
  );
}

// The first completed attempt: lowest attemptNumber (assigned in submission
// order by finalize), then earliest submittedAt, then ascending id.
export function selectFirstCompletedAttempt(
  attempts: readonly AttemptInput[],
): { readonly attemptId: string; readonly percentage: number } | null {
  let first: AttemptInput | null = null;
  for (const entry of attempts) {
    if (!isScorable(entry.data)) continue;
    if (first === null) {
      first = entry;
      continue;
    }
    const a = entry.data;
    const b = first.data;
    if (a.attemptNumber !== b.attemptNumber) {
      if (a.attemptNumber < b.attemptNumber) first = entry;
      continue;
    }
    const am = submittedMillis(a);
    const bm = submittedMillis(b);
    if (am !== null && bm !== null && am !== bm) {
      if (am < bm) first = entry;
      continue;
    }
    if (entry.id < first.id) first = entry;
  }
  return first === null ? null : { attemptId: first.id, percentage: first.data.percentage };
}

export type DerivationEvent = {
  readonly eventId: string;
  readonly sequence: number;
  readonly type: GradeImprovementEventType;
  readonly percentage: number;
  readonly attemptId: string;
  readonly targetEventId: string | null;
};

// Effective acknowledgment from the append-only event log:
//   the highest-sequence `acknowledged` event that no `reversed` event
//   targets.
// A reversal undoes exactly the one acknowledgment it names. It never
// affects any other acknowledgment, earlier or later. Reversing the newest
// acknowledgment therefore falls back to the previous unreversed one (if
// any), and its percentage becomes the comparison baseline again.
export function deriveEffectiveAcknowledgment(
  events: readonly DerivationEvent[],
): GradeImprovementEffectiveAck | null {
  const reversed = new Set<string>();
  for (const e of events) {
    if (e.type === "reversed" && e.targetEventId !== null) reversed.add(e.targetEventId);
  }
  let effective: DerivationEvent | null = null;
  for (const e of events) {
    if (e.type !== "acknowledged" || reversed.has(e.eventId)) continue;
    if (effective === null || e.sequence > effective.sequence) effective = e;
  }
  return effective === null
    ? null
    : { eventId: effective.eventId, percentage: effective.percentage, attemptId: effective.attemptId };
}

export type GradeImprovementState = {
  readonly attemptCount: number;
  readonly best: { readonly attemptId: string; readonly percentage: number } | null;
  readonly effective: GradeImprovementEffectiveAck | null;
  // Present only when an improvement is waiting for the teacher.
  readonly pending: {
    readonly baselinePercentage: number;
    readonly baselineSource: "firstAttempt" | "acknowledged";
    readonly bestPercentage: number;
    readonly bestAttemptId: string;
  } | null;
};

// Pending iff the current best percentage is strictly higher than the
// baseline. Baseline = the effective acknowledged percentage when one is in
// effect, otherwise the first completed attempt. Consequences:
//   - a first attempt alone is never pending (best === first);
//   - a lower or equal retake is never pending;
//   - several improvements before an acknowledgment collapse into one pending
//     state at the current best, still measured from the original baseline.
export function deriveGradeImprovementState(
  attempts: readonly AttemptInput[],
  effective: GradeImprovementEffectiveAck | null,
): GradeImprovementState {
  const scorable = attempts.filter((a) => isScorable(a.data));
  const selected = selectHighestCompletedAttempt(scorable);
  const best = selected === null ? null : { attemptId: selected.attemptId, percentage: selected.percentage };
  const first = selectFirstCompletedAttempt(scorable);
  let pending: GradeImprovementState["pending"] = null;
  if (best !== null && first !== null) {
    const baselinePercentage = effective !== null ? effective.percentage : first.percentage;
    if (best.percentage > baselinePercentage) {
      pending = {
        baselinePercentage,
        baselineSource: effective !== null ? "acknowledged" : "firstAttempt",
        bestPercentage: best.percentage,
        bestAttemptId: best.attemptId,
      };
    }
  }
  return { attemptCount: scorable.length, best, effective, pending };
}
