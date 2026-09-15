import { roundHalfToEven2 } from "./round-half-to-even";

describe("roundHalfToEven2", () => {
  it("rounds a clear non-tie value down", () => {
    expect(roundHalfToEven2(33.33333333)).toBeCloseTo(33.33, 10);
  });

  it("rounds a clear non-tie value up", () => {
    expect(roundHalfToEven2(66.66666667)).toBeCloseTo(66.67, 10);
  });

  it("resolves an exact .005 tie to the nearest even hundredth (down)", () => {
    // 12.345 -> scaled 1234.5 -> floor 1234 is even -> stays 1234 -> 12.34
    expect(roundHalfToEven2(12.345)).toBeCloseTo(12.34, 10);
  });

  it("resolves an exact .005 tie to the nearest even hundredth (up)", () => {
    // 12.335 -> scaled 1233.5 -> floor 1233 is odd -> rounds up to 1234 -> 12.34
    expect(roundHalfToEven2(12.335)).toBeCloseTo(12.34, 10);
  });

  it("is insensitive to floating-point representation drift at a tie", () => {
    // 1.005 * 100 evaluates to 100.49999999999999 in IEEE-754 double
    // arithmetic, not exactly 100.5. Plain `Math.round` would treat this
    // as "clearly below the tie" and round down; the epsilon-guarded
    // comparison here still correctly classifies it as a tie (the
    // intended mathematical value IS exactly .5) and resolves it to the
    // nearest even hundredth: floor 100 is already even, so it stays 100.
    expect(1.005 * 100).not.toBe(100.5); // documents the fp quirk this guards against
    expect(roundHalfToEven2(1.005)).toBe(1);
  });

  it("handles zero", () => {
    expect(roundHalfToEven2(0)).toBe(0);
  });

  it("handles an already-exact two-decimal value unchanged", () => {
    expect(roundHalfToEven2(50)).toBe(50);
    expect(roundHalfToEven2(18)).toBe(18);
  });

  it("handles a value very close to 100", () => {
    expect(roundHalfToEven2(99.995)).toBeCloseTo(100, 10);
  });
});
