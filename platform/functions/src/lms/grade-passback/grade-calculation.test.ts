import { computeGradePassbackEarnedPoints } from "./grade-calculation";

describe("computeGradePassbackEarnedPoints", () => {
  // Sprint 30A.2 required exemplars.
  it("20 max: 70% -> 14", () => {
    expect(computeGradePassbackEarnedPoints(70, 20)).toBe(14);
  });

  it("20 max: 90% -> 18", () => {
    expect(computeGradePassbackEarnedPoints(90, 20)).toBe(18);
  });

  it("20 max: 80% -> 16", () => {
    expect(computeGradePassbackEarnedPoints(80, 20)).toBe(16);
  });

  it("computes a non-integer earned-points value for a fractional percentage", () => {
    // 33.33% of 20 = 6.666 -> half-even to 2dp = 6.67
    expect(computeGradePassbackEarnedPoints(33.33, 20)).toBeCloseTo(6.67, 10);
  });

  it("half-even boundary: resolves an exact .xx5 tie to the nearest even hundredth", () => {
    // 62.5% of 20 = 12.5 -> already exactly 2dp representable, no tie at
    // the hundredths digit; use a genuine hundredths-tie input instead.
    // 61.725% of 20 = 12.345 -> scaled 1234.5 -> floor 1234 (even) -> 12.34
    expect(computeGradePassbackEarnedPoints(61.725, 20)).toBeCloseTo(12.34, 10);
  });

  it("100% of maxPoints returns maxPoints exactly", () => {
    expect(computeGradePassbackEarnedPoints(100, 20)).toBe(20);
    expect(computeGradePassbackEarnedPoints(100, 7)).toBe(7);
  });

  it("0% returns 0", () => {
    expect(computeGradePassbackEarnedPoints(0, 20)).toBe(0);
  });

  it("is revision-safe: only percentage and maxPoints matter, never a raw score/maxScore pair", () => {
    // Two different raw score/maxScore pairs that reduce to the same
    // percentage must produce the identical earned-points value.
    const fromRevisionA = computeGradePassbackEarnedPoints((7 / 10) * 100, 20);
    const fromRevisionB = computeGradePassbackEarnedPoints((14 / 20) * 100, 20);
    expect(fromRevisionA).toBe(fromRevisionB);
    expect(fromRevisionA).toBe(14);
  });

  it("never returns a negative value for a defensive negative percentage input", () => {
    expect(computeGradePassbackEarnedPoints(-5, 20)).toBe(0);
  });

  it("does not clamp above 100% because the scorer contract makes that unreachable", () => {
    // Documents the Phase 3 investigation finding: the scorer awards each
    // item at most its unit point value with no bonus mechanism, so
    // percentage > 100 cannot occur in practice. This function does not
    // add a masking clamp for it.
    expect(computeGradePassbackEarnedPoints(150, 20)).toBe(30);
  });
});
