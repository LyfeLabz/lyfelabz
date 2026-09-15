// Deterministic round-half-to-even ("banker's rounding") to 2 decimal
// places. Extracted from `assessments/assessment-attempts-finalize.ts`
// (Sprint 30A.2) so the identical, already-tested rounding contract can be
// reused by the Google Classroom grade-passback earned-points calculation
// without a second, potentially-drifting implementation. No behavior
// change from the original: this is a mechanical extraction.
//
// Ordinary `Math.round` always rounds a .5 tie up, which is NOT the locked
// contract here (half-even ties resolve to the nearest EVEN integer at the
// scaled decimal position) and is also subject to floating-point
// representation drift at exact .5 boundaries. Scaling by 100, taking the
// floor, and inspecting the fractional remainder against a small epsilon
// keeps the tie decision deterministic across Node runtimes and independent
// of any `toFixed` rounding drift.
export function roundHalfToEven2(value: number): number {
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const EPS = 1e-9;
  let rounded: number;
  if (diff > 0.5 + EPS) {
    rounded = floor + 1;
  } else if (diff < 0.5 - EPS) {
    rounded = floor;
  } else {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  }
  return rounded / 100;
}
