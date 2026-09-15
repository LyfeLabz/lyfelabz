import type { AssessmentAttemptRecord } from "../shared";

// Canonical best-attempt selection per PDR-029 section 6. Extracted
// (Sprint 30A.2, mechanical extraction, no behavior change) from
// `assessment-assignment-summary.ts` into its own shared module so the
// Google Classroom grade-passback synchronization engine
// (`lms/grade-passback/engine.ts`) can import the exact same authoritative
// implementation rather than re-deriving a second "best attempt" concept.
// `assessment-assignment-summary.ts` and `assessment-lesson-summary.ts`
// continue to import this implementation unchanged.

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// PDR-029 tie-break policy rule 3 compares the canonical completion
// timestamp on each attempt. The certified attempt record freezes exactly
// one completion instant: `submittedAt`, stamped by the sole authorized
// writer (`assessmentAttemptsFinalize`) via `FieldValue.serverTimestamp()`
// per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` sections 7 and 21. The
// ratified policy names this instant "completedAt"; the on-disk
// representation is `submittedAt`. Nothing else on the attempt or session
// record is a valid substitute: session `startedAt` is not the completion
// instant, and Firestore document creation time is not part of the
// certified schema. We convert the timestamp to a finite millisecond
// number so the comparison remains total and deterministic.
function completedAtMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value !== null) {
    const maybe = value as { toMillis?: () => unknown };
    if (typeof maybe.toMillis === "function") {
      const raw = maybe.toMillis();
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    }
  }
  return null;
}

// Selects the score-metric-bearing attempt for a single completed student
// per PDR-029 section 6. The canonical order is:
//   1. Higher `percentage` wins.
//   2. Higher `attemptNumber` wins.
//   3. Later `completedAt` (on-disk `submittedAt`) wins when both
//      attempts carry comparable timestamps. A valid timestamp outranks a
//      missing or malformed timestamp.
//   4. Ascending `attemptId` wins as the final deterministic fallback so
//      the selection never depends on Firestore document ordering.
// `AssessmentAttemptRecord.percentage`, `attemptNumber`, `score`,
// `maxScore`, and `submittedAt` are all frozen at finalize. Raw `score`
// MUST NOT be used for comparison because `maxScore` may differ across
// assessment revisions (PDR-029 section 5).
export type SelectedCompletedAttempt = {
  readonly attemptId: string;
  readonly percentage: number;
  readonly score: number;
  readonly maxScore: number;
  readonly attemptNumber: number;
  readonly completedAtMillis: number | null;
};

export function selectHighestCompletedAttempt(
  attempts: readonly {
    readonly id: string;
    readonly data: AssessmentAttemptRecord;
  }[],
): SelectedCompletedAttempt | null {
  let best: SelectedCompletedAttempt | null = null;
  for (const { id, data } of attempts) {
    if (!isFiniteNumber(data.percentage)) continue;
    if (!isFiniteNumber(data.score)) continue;
    if (!isFiniteNumber(data.maxScore)) continue;
    if (!isFiniteNumber(data.attemptNumber)) continue;
    const candidate: SelectedCompletedAttempt = {
      attemptId: id,
      percentage: data.percentage,
      score: data.score,
      maxScore: data.maxScore,
      attemptNumber: data.attemptNumber,
      completedAtMillis: completedAtMillis(data.submittedAt),
    };
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
    // Rule 3: later completedAt wins. A valid finite timestamp outranks
    // a missing or malformed timestamp so a well-formed record never
    // loses to a malformed peer.
    const candTs = candidate.completedAtMillis;
    const bestTs = best.completedAtMillis;
    if (candTs !== null && bestTs === null) {
      best = candidate;
      continue;
    }
    if (candTs === null && bestTs !== null) continue;
    if (candTs !== null && bestTs !== null) {
      if (candTs > bestTs) {
        best = candidate;
        continue;
      }
      if (candTs < bestTs) continue;
    }
    // Rule 4: ascending attemptId is the final deterministic fallback.
    if (candidate.attemptId < best.attemptId) {
      best = candidate;
    }
  }
  return best;
}
