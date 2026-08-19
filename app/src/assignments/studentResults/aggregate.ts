import type {
  StudentAttemptSummary,
  StudentResultAggregate,
  StudentStatusKey,
} from "./types";

// Sprint 27 Phase 2 (Decision 1): single-student self-aggregation over the
// caller's own completed attempts. Every function here is pure and operates
// only on the caller-scoped attempt list. No cross-student data is read or
// computed, so the "aggregation is server-mediated" rule (which exists to
// prevent cross-student client aggregation) is not engaged (blueprint §5.2).
//
// Best-score and tie-break semantics mirror the certified teacher
// representative-attempt policy so a student's own best matches the
// teacher's representative attempt:
//   - PDR-029a: the representative attempt is the highest valid completed
//     attempt.
//   - PDR-029b: ties in `percentage` are broken by (1) higher
//     `attemptNumber`, (2) later completion time, (3) ascending
//     `attemptId` as the final deterministic fallback.
// The caller-scoped projection exposes `submittedAt` as the completion
// timestamp (there is no separate `completedAt` on the student summary), so
// it stands in for PDR-029b rule (2), matching blueprint §5.4.

// Status threshold interpretation (blueprint §5.2). The canonical spec
// (PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md §6.4, PDR-024l)
// fixes only the endpoints: a perfect best is Perfect Score, and a 9/10
// (90 percent) best is Well Done!. It does not state the lower boundary of
// Well Done. This surface derives the boundary from the single worked
// example: a completed best of 90 percent or higher (but not perfect) is
// Well Done!, and any lower completed best is Improving. This is a UI
// presentation threshold, not a backend contract, and is recorded so it is
// never mistaken for a silent redefinition of the canonical status model.
export const WELL_DONE_THRESHOLD = 90;

// Accessible status labels rendered as visible text so status is never
// conveyed by color alone (PDR-024l).
export const STUDENT_STATUS_LABELS: Readonly<
  Record<StudentStatusKey, string>
> = Object.freeze({
  ready: "Ready to Begin",
  improving: "Improving",
  wellDone: "Well Done!",
  perfect: "Perfect Score",
});

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

// A completed attempt is "valid" for representation when its numeric
// fields are finite (PDR-029a). The caller-scoped callable already fixes
// `status: "completed"`, so completeness is guaranteed; this guard defends
// against a malformed record that slipped a numeric field.
function isValidAttempt(attempt: StudentAttemptSummary): boolean {
  return (
    isFiniteNumber(attempt.percentage) &&
    isFiniteNumber(attempt.score) &&
    isFiniteNumber(attempt.maxScore) &&
    isFiniteNumber(attempt.attemptNumber) &&
    isFiniteNumber(attempt.submittedAt)
  );
}

// Select the highest valid completed attempt, applying the PDR-029b
// tie-break order. Returns null when no valid attempt exists.
export function selectBestAttempt(
  attempts: ReadonlyArray<StudentAttemptSummary>,
): StudentAttemptSummary | null {
  let best: StudentAttemptSummary | null = null;
  for (const candidate of attempts) {
    if (!isValidAttempt(candidate)) continue;
    if (best === null) {
      best = candidate;
      continue;
    }
    // Rule 1: higher percentage wins.
    if (candidate.percentage > best.percentage) {
      best = candidate;
      continue;
    }
    if (candidate.percentage < best.percentage) continue;
    // Rule 2: higher attemptNumber wins.
    if (candidate.attemptNumber > best.attemptNumber) {
      best = candidate;
      continue;
    }
    if (candidate.attemptNumber < best.attemptNumber) continue;
    // Rule 3: later completion time wins.
    if (candidate.submittedAt > best.submittedAt) {
      best = candidate;
      continue;
    }
    if (candidate.submittedAt < best.submittedAt) continue;
    // Rule 4: ascending attemptId is the final deterministic fallback.
    if (candidate.attemptId < best.attemptId) {
      best = candidate;
    }
  }
  return best;
}

// A best attempt is perfect when it earned full marks. The raw
// `score === maxScore` pair is authoritative (mirroring the teacher
// representative-perfect check) so a rounded 100 percent from
// floating-point drift cannot masquerade as perfect and a legitimate
// perfect score is honored even if the persisted `percentage` is stale.
export function isPerfectAttempt(attempt: StudentAttemptSummary): boolean {
  return attempt.maxScore > 0 && attempt.score === attempt.maxScore;
}

// Derive the PDR-024l status from the caller's best completed attempt.
// `null` best (no completed attempt) is Ready to Begin.
export function deriveStatus(
  best: StudentAttemptSummary | null,
): StudentStatusKey {
  if (best === null) return "ready";
  if (isPerfectAttempt(best)) return "perfect";
  if (best.percentage >= WELL_DONE_THRESHOLD) return "wellDone";
  return "improving";
}

// Group the caller's own attempts by `assignmentId` and derive the
// per-assignment aggregate. Only assignments with at least one valid
// completed attempt appear in the map (My Results displays attempted
// assessments,
// PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md §6.3).
export function aggregateByAssignment(
  attempts: ReadonlyArray<StudentAttemptSummary>,
): ReadonlyMap<string, StudentResultAggregate> {
  const byAssignment = new Map<string, StudentAttemptSummary[]>();
  for (const attempt of attempts) {
    if (!isFiniteNumber(attempt.submittedAt)) continue;
    const group = byAssignment.get(attempt.assignmentId);
    if (group) group.push(attempt);
    else byAssignment.set(attempt.assignmentId, [attempt]);
  }

  const result = new Map<string, StudentResultAggregate>();
  for (const [assignmentId, group] of byAssignment) {
    const best = selectBestAttempt(group);
    if (best === null) continue;
    // Count only valid completed attempts. The callable returns completed
    // attempts exclusively, so this counts the caller's completed attempts
    // for the assignment (never an in-progress or non-finalized session,
    // which the backend contract does not return).
    let attemptCount = 0;
    for (const attempt of group) {
      if (isValidAttempt(attempt)) attemptCount += 1;
    }
    const perfect = isPerfectAttempt(best);
    result.set(
      assignmentId,
      Object.freeze({
        assignmentId,
        bestScore: best.score,
        bestMaxScore: best.maxScore,
        bestPercentage: best.percentage,
        attemptCount,
        status: deriveStatus(best),
        canImprove: !perfect,
      }),
    );
  }
  return result;
}
