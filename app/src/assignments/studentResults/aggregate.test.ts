// Sprint 27 Phase 2 (Decision 1): unit tests for single-student
// self-aggregation. Best-score selection and tie-break mirror PDR-029a and
// PDR-029b; status derivation follows PDR-024l with the documented Well
// Done threshold (blueprint §5.2).

import {
  WELL_DONE_THRESHOLD,
  STUDENT_STATUS_LABELS,
  selectBestAttempt,
  deriveStatus,
  isPerfectAttempt,
  aggregateByAssignment,
} from "./aggregate";
import type { StudentAttemptSummary } from "./types";

const attempt = (over: Partial<StudentAttemptSummary> = {}): StudentAttemptSummary => ({
  attemptId: "a-1",
  assignmentId: "assign-1",
  attemptNumber: 1,
  score: 8,
  maxScore: 10,
  percentage: 80,
  submittedAt: 1_000,
  ...over,
});

describe("WELL_DONE_THRESHOLD", () => {
  test("is the documented 90 percent boundary anchored to the 9/10 example", () => {
    expect(WELL_DONE_THRESHOLD).toBe(90);
  });
});

describe("selectBestAttempt", () => {
  test("returns null when there are no attempts", () => {
    expect(selectBestAttempt([])).toBeNull();
  });

  test("picks the highest percentage", () => {
    const best = selectBestAttempt([
      attempt({ attemptId: "a-1", percentage: 60, score: 6 }),
      attempt({ attemptId: "a-2", percentage: 90, score: 9 }),
      attempt({ attemptId: "a-3", percentage: 70, score: 7 }),
    ]);
    expect(best?.attemptId).toBe("a-2");
  });

  test("a later lower attempt never reduces the best (PDR-029a)", () => {
    const best = selectBestAttempt([
      attempt({ attemptId: "a-1", attemptNumber: 1, percentage: 100, score: 10, submittedAt: 1_000 }),
      attempt({ attemptId: "a-2", attemptNumber: 2, percentage: 40, score: 4, submittedAt: 2_000 }),
    ]);
    expect(best?.attemptId).toBe("a-1");
    expect(best?.percentage).toBe(100);
  });

  test("tie on percentage breaks by higher attemptNumber (PDR-029b rule 1)", () => {
    const best = selectBestAttempt([
      attempt({ attemptId: "a-1", attemptNumber: 1, percentage: 80 }),
      attempt({ attemptId: "a-2", attemptNumber: 3, percentage: 80 }),
      attempt({ attemptId: "a-3", attemptNumber: 2, percentage: 80 }),
    ]);
    expect(best?.attemptId).toBe("a-2");
  });

  test("tie on percentage and attemptNumber breaks by later submittedAt (PDR-029b rule 2)", () => {
    const best = selectBestAttempt([
      attempt({ attemptId: "a-1", attemptNumber: 2, percentage: 80, submittedAt: 1_000 }),
      attempt({ attemptId: "a-2", attemptNumber: 2, percentage: 80, submittedAt: 5_000 }),
    ]);
    expect(best?.attemptId).toBe("a-2");
  });

  test("full tie breaks by ascending attemptId (PDR-029b rule 3)", () => {
    const best = selectBestAttempt([
      attempt({ attemptId: "z", attemptNumber: 2, percentage: 80, submittedAt: 1_000 }),
      attempt({ attemptId: "a", attemptNumber: 2, percentage: 80, submittedAt: 1_000 }),
    ]);
    expect(best?.attemptId).toBe("a");
  });

  test("drops attempts with non-finite numeric fields", () => {
    const best = selectBestAttempt([
      attempt({ attemptId: "bad", percentage: Number.NaN }),
      attempt({ attemptId: "good", percentage: 55, score: 5 }),
    ]);
    expect(best?.attemptId).toBe("good");
  });
});

describe("isPerfectAttempt", () => {
  test("true only when score equals a positive maxScore", () => {
    expect(isPerfectAttempt(attempt({ score: 10, maxScore: 10, percentage: 100 }))).toBe(true);
    expect(isPerfectAttempt(attempt({ score: 9, maxScore: 10, percentage: 90 }))).toBe(false);
    expect(isPerfectAttempt(attempt({ score: 0, maxScore: 0, percentage: 100 }))).toBe(false);
  });

  test("honors a raw perfect pair even if percentage is stale", () => {
    expect(isPerfectAttempt(attempt({ score: 10, maxScore: 10, percentage: 99.99 }))).toBe(true);
  });
});

describe("deriveStatus", () => {
  test("Ready to Begin when there is no completed attempt", () => {
    expect(deriveStatus(null)).toBe("ready");
    expect(STUDENT_STATUS_LABELS.ready).toBe("Ready to Begin");
  });

  test("Perfect Score for a full-marks best", () => {
    expect(deriveStatus(attempt({ score: 10, maxScore: 10, percentage: 100 }))).toBe("perfect");
    expect(STUDENT_STATUS_LABELS.perfect).toBe("Perfect Score");
  });

  test("Well Done! at 90 percent (the 9/10 example) but not perfect", () => {
    expect(deriveStatus(attempt({ score: 9, maxScore: 10, percentage: 90 }))).toBe("wellDone");
    expect(STUDENT_STATUS_LABELS.wellDone).toBe("Well Done!");
  });

  test("Improving below the Well Done threshold", () => {
    expect(deriveStatus(attempt({ score: 8, maxScore: 10, percentage: 80 }))).toBe("improving");
    expect(deriveStatus(attempt({ score: 0, maxScore: 10, percentage: 0 }))).toBe("improving");
    expect(STUDENT_STATUS_LABELS.improving).toBe("Improving");
  });
});

describe("aggregateByAssignment", () => {
  test("empty input yields an empty map", () => {
    expect(aggregateByAssignment([]).size).toBe(0);
  });

  test("single completed attempt: best, count, status, canImprove", () => {
    const map = aggregateByAssignment([
      attempt({ assignmentId: "x", score: 8, maxScore: 10, percentage: 80 }),
    ]);
    const agg = map.get("x");
    expect(agg).toBeDefined();
    expect(agg?.bestScore).toBe(8);
    expect(agg?.bestMaxScore).toBe(10);
    expect(agg?.bestPercentage).toBe(80);
    expect(agg?.attemptCount).toBe(1);
    expect(agg?.status).toBe("improving");
    expect(agg?.canImprove).toBe(true);
  });

  test("multiple attempts for one assignment: best score and full count", () => {
    const map = aggregateByAssignment([
      attempt({ attemptId: "a-1", assignmentId: "x", attemptNumber: 1, score: 6, maxScore: 10, percentage: 60 }),
      attempt({ attemptId: "a-2", assignmentId: "x", attemptNumber: 2, score: 10, maxScore: 10, percentage: 100 }),
      attempt({ attemptId: "a-3", assignmentId: "x", attemptNumber: 3, score: 7, maxScore: 10, percentage: 70 }),
    ]);
    const agg = map.get("x");
    expect(agg?.bestScore).toBe(10);
    expect(agg?.bestPercentage).toBe(100);
    expect(agg?.attemptCount).toBe(3);
    expect(agg?.status).toBe("perfect");
    expect(agg?.canImprove).toBe(false);
  });

  test("groups by assignment with no cross-assignment contamination", () => {
    const map = aggregateByAssignment([
      attempt({ attemptId: "x-1", assignmentId: "x", score: 5, maxScore: 10, percentage: 50 }),
      attempt({ attemptId: "y-1", assignmentId: "y", score: 9, maxScore: 10, percentage: 90 }),
      attempt({ attemptId: "x-2", assignmentId: "x", attemptNumber: 2, score: 6, maxScore: 10, percentage: 60 }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("x")?.attemptCount).toBe(2);
    expect(map.get("x")?.bestPercentage).toBe(60);
    expect(map.get("y")?.attemptCount).toBe(1);
    expect(map.get("y")?.status).toBe("wellDone");
  });

  test("canImprove is true for a strong-but-imperfect best (9/10)", () => {
    const map = aggregateByAssignment([
      attempt({ assignmentId: "x", score: 9, maxScore: 10, percentage: 90 }),
    ]);
    expect(map.get("x")?.status).toBe("wellDone");
    expect(map.get("x")?.canImprove).toBe(true);
  });
});
