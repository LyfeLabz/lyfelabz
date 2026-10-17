import type { AssessmentAttemptRecord } from "../shared";

import {
  deriveEffectiveAcknowledgment,
  deriveGradeImprovementState,
  selectFirstCompletedAttempt,
  type DerivationEvent,
} from "./derive";

function attempt(
  id: string,
  attemptNumber: number,
  percentage: number,
  opts: { score?: number; maxScore?: number; submittedAt?: number } = {},
): { id: string; data: AssessmentAttemptRecord } {
  const submittedAt = opts.submittedAt ?? attemptNumber * 1000;
  return {
    id,
    data: {
      studentId: "s1",
      assignmentId: "a1",
      attemptNumber,
      percentage,
      score: opts.score ?? percentage / 10,
      maxScore: opts.maxScore ?? 10,
      submittedAt: { toMillis: () => submittedAt },
    } as unknown as AssessmentAttemptRecord,
  };
}

const ack = (seq: number, attemptId: string, percentage: number): DerivationEvent => ({
  eventId: `e${seq}`,
  sequence: seq,
  type: "acknowledged",
  percentage,
  attemptId,
  targetEventId: null,
});
const rev = (seq: number, target: DerivationEvent): DerivationEvent => ({
  eventId: `e${seq}`,
  sequence: seq,
  type: "reversed",
  percentage: target.percentage,
  attemptId: target.attemptId,
  targetEventId: target.eventId,
});

describe("grade improvement detection", () => {
  it("first attempt alone produces no improvement", () => {
    const s = deriveGradeImprovementState([attempt("t1", 1, 60)], null);
    expect(s.pending).toBeNull();
    expect(s.best).toEqual({ attemptId: "t1", percentage: 60 });
  });

  it("no attempts produces no improvement", () => {
    expect(deriveGradeImprovementState([], null).pending).toBeNull();
  });

  it("a higher second attempt produces a pending improvement from the first-attempt baseline", () => {
    const s = deriveGradeImprovementState([attempt("t1", 1, 60), attempt("t2", 2, 70)], null);
    expect(s.pending).toEqual({
      baselinePercentage: 60,
      baselineSource: "firstAttempt",
      bestPercentage: 70,
      bestAttemptId: "t2",
    });
  });

  it("a lower retake produces none", () => {
    expect(deriveGradeImprovementState([attempt("t1", 1, 80), attempt("t2", 2, 70)], null).pending).toBeNull();
  });

  it("an equal retake produces none", () => {
    expect(deriveGradeImprovementState([attempt("t1", 1, 80), attempt("t2", 2, 80)], null).pending).toBeNull();
  });

  it("multiple improvements consolidate into one pending state at the current best", () => {
    const s = deriveGradeImprovementState(
      [attempt("t1", 1, 60), attempt("t2", 2, 70), attempt("t3", 3, 90)],
      null,
    );
    expect(s.pending).toEqual({
      baselinePercentage: 60,
      baselineSource: "firstAttempt",
      bestPercentage: 90,
      bestAttemptId: "t3",
    });
  });

  it("an improvement after a dip is still measured against the first attempt", () => {
    const s = deriveGradeImprovementState(
      [attempt("t1", 1, 60), attempt("t2", 2, 40), attempt("t3", 3, 65)],
      null,
    );
    expect(s.pending?.baselinePercentage).toBe(60);
    expect(s.pending?.bestPercentage).toBe(65);
  });

  it("compares percentage, never raw score (maxScore differs across revisions)", () => {
    // t2 has the higher raw score but the lower percentage.
    const s = deriveGradeImprovementState(
      [attempt("t1", 1, 80, { score: 8, maxScore: 10 }), attempt("t2", 2, 75, { score: 15, maxScore: 20 })],
      null,
    );
    expect(s.pending).toBeNull();
    expect(s.best?.attemptId).toBe("t1");
  });

  it("first attempt is chosen by attemptNumber regardless of input order", () => {
    expect(selectFirstCompletedAttempt([attempt("t3", 3, 90), attempt("t1", 1, 60), attempt("t2", 2, 70)])).toEqual({
      attemptId: "t1",
      percentage: 60,
    });
  });

  it("ignores malformed attempts", () => {
    const bad = attempt("bad", 1, Number.NaN);
    const s = deriveGradeImprovementState([bad, attempt("t2", 2, 70)], null);
    expect(s.attemptCount).toBe(1);
    expect(s.pending).toBeNull();
  });
});

describe("acknowledgment baseline", () => {
  it("an acknowledgment at the best clears the pending state", () => {
    const s = deriveGradeImprovementState(
      [attempt("t1", 1, 60), attempt("t3", 3, 90)],
      { eventId: "e1", attemptId: "t3", percentage: 90 },
    );
    expect(s.pending).toBeNull();
  });

  it("a new improvement after acknowledgment is pending from the acknowledged percentage", () => {
    const s = deriveGradeImprovementState(
      [attempt("t1", 1, 60), attempt("t3", 3, 90), attempt("t4", 4, 100)],
      { eventId: "e1", attemptId: "t3", percentage: 90 },
    );
    expect(s.pending).toEqual({
      baselinePercentage: 90,
      baselineSource: "acknowledged",
      bestPercentage: 100,
      bestAttemptId: "t4",
    });
  });

  it("an equal retake after acknowledgment is not pending", () => {
    const s = deriveGradeImprovementState(
      [attempt("t1", 1, 60), attempt("t3", 3, 90), attempt("t4", 4, 90)],
      { eventId: "e1", attemptId: "t3", percentage: 90 },
    );
    expect(s.pending).toBeNull();
  });
});

describe("effective acknowledgment from event history", () => {
  it("is null with no events", () => {
    expect(deriveEffectiveAcknowledgment([])).toBeNull();
  });

  it("is the newest unreversed acknowledgment", () => {
    const e1 = ack(1, "t3", 90);
    const e2 = ack(2, "t4", 100);
    expect(deriveEffectiveAcknowledgment([e1, e2])).toEqual({ eventId: "e2", attemptId: "t4", percentage: 100 });
  });

  it("reversing the only acknowledgment restores no acknowledgment", () => {
    const e1 = ack(1, "t3", 90);
    expect(deriveEffectiveAcknowledgment([e1, rev(2, e1)])).toBeNull();
  });

  it("reversing the newest falls back to the previous acknowledgment", () => {
    const e1 = ack(1, "t3", 90);
    const e2 = ack(2, "t4", 100);
    expect(deriveEffectiveAcknowledgment([e1, e2, rev(3, e2)])).toEqual({
      eventId: "e1",
      attemptId: "t3",
      percentage: 90,
    });
  });

  it("a reversal never cancels a later independent acknowledgment", () => {
    const e1 = ack(1, "t3", 90);
    const e3 = ack(3, "t3", 90);
    expect(deriveEffectiveAcknowledgment([e1, rev(2, e1), e3])).toEqual({
      eventId: "e3",
      attemptId: "t3",
      percentage: 90,
    });
  });

  it("is independent of input order", () => {
    const e1 = ack(1, "t3", 90);
    const e2 = ack(2, "t4", 100);
    expect(deriveEffectiveAcknowledgment([rev(3, e2), e2, e1])?.eventId).toBe("e1");
  });
});
