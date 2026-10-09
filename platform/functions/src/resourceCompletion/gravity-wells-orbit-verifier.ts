// Gravity Wells orbit verifier, version 1 (`gravity-wells.orbit@1`).
//
// Pure, deterministic re-implementation of the Phase 3 launch physics in
// `simulation_gravity-wells.html` (`ORBIT_MASSES`, `resetOrbit`, `endDrag`,
// `runOrbitLoop`, `achieveOrbit`, `achieveEscape`). Given submitted launch
// parameters it recomputes which missions that launch earns. It never reads
// or trusts a client success claim. It verifies that the parameters produce
// the outcome; it cannot prove a student performed the drag gesture.
//
// Physics (one step per animation frame, G = 1, logical canvas pixels):
//   start    = (ORBIT_CX + startDist, ORBIT_CY), velocity from the drag
//   each frame, before integrating:
//     dist < crashR            -> crashed (terminal)
//     dist > ESCAPE_R          -> escaped (terminal); flyby when the
//                                 closest prior distance < crashR * 3.5
//   leapfrog (drift-kick-drift) with a 0.001 softening on the kick radius:
//     p += v / 2;  d2 = |c - p| + 0.001;  v += (G M / d2^2) (c - p) / d2;
//     p += v / 2
//   after step N (N counted from 1):
//     N >= 240 (4 s at 60 fps), once  -> orbit (Earth: c1, Jupiter: c3)
//     Black Hole and N >= 120 (2 s)   -> black hole survival (c5)
//   on escape: Sun -> c2; flyby (any mass) -> c4
//
// Observation. The page has no time limit: a flight ends only on a crash,
// an escape, or a reset (Reset, Try Another Orbit, a mass button, or the
// phase unlock). An orbit can therefore be followed, much later, by an
// escape and a flyby (a Sun launch that escapes after step 11,710).
//
// The page loop is `runOrbitLoop`. `launchProbe` calls it once directly;
// every later call is a requestAnimationFrame callback it scheduled. Each
// call first runs the terminal checks (crash, escape) on the current
// position; if neither fires it performs exactly one integration step,
// updates the step-based missions, and schedules the next call. So:
//   - natural end after N steps = N + 1 calls (the last call only detects
//     the crash or escape and awards c2/c4);
//   - reset after N steps       = N calls (resetOrbit cancels the pending
//     callback, so the terminal check on step N's position never runs).
// `orbitFrameCount` is N in both cases and cannot tell them apart. The
// submitted parameters therefore carry `observedInvocations`: the number of
// `runOrbitLoop` calls that executed for the launch, the direct call
// included. The verifier executes exactly that many calls and credits only
// what those calls award. Mission steps and computation cost stay in
// integration steps.
//
// The count is student-reported and untrusted. It is a duration, not a
// success claim: overstating it only reveals what these parameters really do;
// understating it loses credit. It cannot prove the student watched.
//
// Computation is bounded by the caller's `stepBudget`, never by a claim that
// some step count is enough. A flight that needs more steps than the budget
// allows ends as `computation-limit`: undetermined, not failed. Missions
// reached within the budget are still verified.
//
// Any change to these rules, constants, or the integrator is a new validator
// version. Version 1 must keep producing identical results for frozen
// completion definitions that name it.

export const GRAVITY_WELLS_ORBIT_VALIDATOR_ID = "gravity-wells.orbit";
export const GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION = 1;

export type GravityWellsOrbitMassKey = "earth" | "jupiter" | "sun" | "blackhole";

export type GravityWellsMissionOutcome =
  | "earth-orbit"
  | "sun-escape"
  | "jupiter-orbit"
  | "flyby"
  | "black-hole-survival";

// Outcome codes this validator can report, in mission-card order.
export const GRAVITY_WELLS_MISSION_OUTCOMES: readonly GravityWellsMissionOutcome[] =
  Object.freeze([
    "earth-orbit",
    "sun-escape",
    "jupiter-orbit",
    "flyby",
    "black-hole-survival",
  ]);

// The page's own mission identifiers (`challengesDone`, `chal1`-`chal5`).
export const GRAVITY_WELLS_SOURCE_MISSION_IDS: Readonly<
  Record<GravityWellsMissionOutcome, "c1" | "c2" | "c3" | "c4" | "c5">
> = Object.freeze({
  "earth-orbit": "c1",
  "sun-escape": "c2",
  "jupiter-orbit": "c3",
  flyby: "c4",
  "black-hole-survival": "c5",
});

interface OrbitMassPhysics {
  readonly mass: number;
  readonly crashR: number;
  readonly startDist: number;
}

// Physics fields of the page's `ORBIT_MASSES` (display fields omitted).
export const GRAVITY_WELLS_ORBIT_MASSES: Readonly<
  Record<GravityWellsOrbitMassKey, OrbitMassPhysics>
> = Object.freeze({
  earth: Object.freeze({ mass: 1200, crashR: 27, startDist: 130 }),
  jupiter: Object.freeze({ mass: 2000, crashR: 40, startDist: 158 }),
  sun: Object.freeze({ mass: 7000, crashR: 57, startDist: 185 }),
  blackhole: Object.freeze({ mass: 9000, crashR: 28, startDist: 155 }),
});

const G = 1.0;
const ORBIT_CX = 320;
const ORBIT_CY = 220;
const ESCAPE_R = 300;
const MAX_SPEED = 10;
const MAX_DRAG = 220;
// `endDrag` ignores a drag shorter than this many logical pixels.
const MIN_DRAG = 5;
const ORBIT_STEPS = 240;
const BLACK_HOLE_SURVIVAL_STEPS = 120;
const FLYBY_CRASH_RADIUS_MULTIPLE = 3.5;

export const GRAVITY_WELLS_MAX_LAUNCH_SPEED = MAX_SPEED;
export const GRAVITY_WELLS_MIN_LAUNCH_SPEED = (MIN_DRAG / MAX_DRAG) * MAX_SPEED;

// Relative allowance for IEEE-754 rounding only. A browser launch at the
// speed cap is `unit vector * 10`, whose magnitude can differ from 10 in the
// last bit. This does not widen any physics threshold.
const SPEED_BOUND_RELATIVE_TOLERANCE = 1e-12;

export interface GravityWellsLaunchParameters {
  readonly massKey: GravityWellsOrbitMassKey;
  // Initial velocity in logical pixels per frame (the page's probe.vx/vy).
  readonly vx: number;
  readonly vy: number;
  // `runOrbitLoop` calls that executed for this launch (the direct call
  // from launchProbe and every callback until the flight ended or was reset).
  readonly observedInvocations: number;
}

export type GravityWellsLaunchIssue =
  | "malformed-parameters"
  | "unknown-mass"
  | "non-finite-velocity"
  | "speed-below-minimum"
  | "speed-above-maximum"
  | "invalid-observed-invocations";

export interface GravityWellsMissionEvent {
  readonly outcome: GravityWellsMissionOutcome;
  readonly sourceMissionId: "c1" | "c2" | "c3" | "c4" | "c5";
  // Step after which the page would credit the mission.
  readonly step: number;
}

export type GravityWellsLaunchVerification =
  | { readonly valid: false; readonly issue: GravityWellsLaunchIssue }
  | {
      readonly valid: true;
      readonly validatorId: typeof GRAVITY_WELLS_ORBIT_VALIDATOR_ID;
      readonly validatorVersion: typeof GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION;
      readonly massKey: GravityWellsOrbitMassKey;
      // crashed / escaped: an observed call detected the end.
      // observation-ended: every observed call ran and the flight was still
      // going (the student reset; not a failure). computation-limit: the
      // step budget ran out first (undetermined; later missions are neither
      // credited nor refuted).
      readonly terminal: "crashed" | "escaped" | "observation-ended" | "computation-limit";
      readonly undetermined: boolean;
      // Integration steps simulated (also the computation cost).
      readonly steps: number;
      // Loop calls simulated. At most steps + 1: a call that does not step
      // ends the run.
      readonly invocations: number;
      // Closest pre-step distance to the mass during flight.
      readonly minDistance: number;
      readonly flyby: boolean;
      readonly missions: readonly GravityWellsMissionEvent[];
      // Probe state when the run stopped (for parity checks and display).
      readonly final: { readonly x: number; readonly y: number; readonly vx: number; readonly vy: number };
    };

function isMassKey(value: unknown): value is GravityWellsOrbitMassKey {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(GRAVITY_WELLS_ORBIT_MASSES, value)
  );
}

// Strict structural parse: exactly { massKey, vx, vy, observedInvocations }. Extra keys (for
// example a client "success" or "missions" claim) are refused, not ignored.
export function parseGravityWellsLaunchParameters(
  raw: unknown,
): { ok: true; value: GravityWellsLaunchParameters } | { ok: false; issue: GravityWellsLaunchIssue } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, issue: "malformed-parameters" };
  }
  const keys = Object.keys(raw);
  if (
    keys.length !== 4 ||
    !keys.every((k) => k === "massKey" || k === "vx" || k === "vy" || k === "observedInvocations")
  ) {
    return { ok: false, issue: "malformed-parameters" };
  }
  const { massKey, vx, vy, observedInvocations } = raw as Record<string, unknown>;
  if (!isMassKey(massKey)) return { ok: false, issue: "unknown-mass" };
  if (typeof vx !== "number" || typeof vy !== "number") {
    return { ok: false, issue: "malformed-parameters" };
  }
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
    return { ok: false, issue: "non-finite-velocity" };
  }
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed < GRAVITY_WELLS_MIN_LAUNCH_SPEED * (1 - SPEED_BOUND_RELATIVE_TOLERANCE)) {
    return { ok: false, issue: "speed-below-minimum" };
  }
  if (speed > GRAVITY_WELLS_MAX_LAUNCH_SPEED * (1 + SPEED_BOUND_RELATIVE_TOLERANCE)) {
    return { ok: false, issue: "speed-above-maximum" };
  }
  if (
    typeof observedInvocations !== "number" ||
    !Number.isSafeInteger(observedInvocations) ||
    observedInvocations < 1
  ) {
    return { ok: false, issue: "invalid-observed-invocations" };
  }
  // A fresh, frozen copy: later changes to the caller's object cannot
  // change what was verified.
  return { ok: true, value: Object.freeze({ massKey, vx, vy, observedInvocations }) };
}

// The page's `endDrag` conversion from a drag vector (logical pixels from
// the probe) to a launch velocity. Returns null for a drag the page ignores.
export function gravityWellsLaunchVelocityFromDrag(
  dragVx: number,
  dragVy: number,
): { vx: number; vy: number } | null {
  if (!Number.isFinite(dragVx) || !Number.isFinite(dragVy)) return null;
  const dragDist = Math.sqrt(dragVx * dragVx + dragVy * dragVy);
  if (dragDist < MIN_DRAG) return null;
  const speed = Math.min((dragDist / MAX_DRAG) * MAX_SPEED, MAX_SPEED);
  const nx = dragVx / dragDist;
  const ny = dragVy / dragDist;
  return { vx: nx * speed, vy: ny * speed };
}

// Simulates one launch from the page's reset state (fresh start position,
// zeroed counters) for exactly its observed loop calls, spending at most
// `stepBudget` integration steps, and reports every mission those calls
// award.
export function verifyGravityWellsLaunch(
  raw: unknown,
  stepBudget: number,
): GravityWellsLaunchVerification {
  const parsed = parseGravityWellsLaunchParameters(raw);
  if (!parsed.ok) return { valid: false, issue: parsed.issue };
  const { massKey, observedInvocations } = parsed.value;
  const budget = Number.isSafeInteger(stepBudget) && stepBudget > 0 ? stepBudget : 0;
  const m = GRAVITY_WELLS_ORBIT_MASSES[massKey];

  // Expression forms below mirror `runOrbitLoop` so floating-point results
  // are bit-identical to the browser.
  let x = ORBIT_CX + m.startDist;
  let y = ORBIT_CY;
  let vx = parsed.value.vx;
  let vy = parsed.value.vy;
  let minDistSoFar = Infinity;
  let steps = 0;
  let invocations = 0;
  let orbiting = false;
  let blackHoleSurvived = false;
  const missions: GravityWellsMissionEvent[] = [];
  const credit = (outcome: GravityWellsMissionOutcome): void => {
    if (missions.some((e) => e.outcome === outcome)) return;
    missions.push({ outcome, sourceMissionId: GRAVITY_WELLS_SOURCE_MISSION_IDS[outcome], step: steps });
  };

  // One iteration is one `runOrbitLoop` call. Every iteration either ends
  // the run or performs one integration step, so iterations never exceed
  // min(observedInvocations, budget + 1): there are no free repeated calls.
  for (;;) {
    // The student reset before the next call: it never ran.
    if (invocations >= observedInvocations) return finish("observation-ended", false);
    invocations++;

    const dx = ORBIT_CX - x;
    const dy = ORBIT_CY - y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);

    if (dist < m.crashR) {
      return finish("crashed", false);
    }
    if (dist > ESCAPE_R) {
      const flyby = minDistSoFar < m.crashR * FLYBY_CRASH_RADIUS_MULTIPLE;
      if (massKey === "sun") credit("sun-escape");
      if (flyby) credit("flyby");
      return finish("escaped", flyby);
    }
    // This call would step, but the server budget is spent.
    if (steps >= budget) return finish("computation-limit", false);

    x += vx * 0.5;
    y += vy * 0.5;
    const dx2 = ORBIT_CX - x;
    const dy2 = ORBIT_CY - y;
    const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) + 0.001;
    const acc2 = G * m.mass / (dist2 * dist2);
    vx += acc2 * dx2 / dist2;
    vy += acc2 * dy2 / dist2;
    x += vx * 0.5;
    y += vy * 0.5;

    minDistSoFar = Math.min(minDistSoFar, dist);
    steps++;

    if (steps >= ORBIT_STEPS && !orbiting) {
      orbiting = true;
      if (massKey === "earth") credit("earth-orbit");
      else if (massKey === "jupiter") credit("jupiter-orbit");
    }
    if (massKey === "blackhole" && steps >= BLACK_HOLE_SURVIVAL_STEPS && !blackHoleSurvived) {
      blackHoleSurvived = true;
      credit("black-hole-survival");
    }
  }

  function finish(
    terminal: "crashed" | "escaped" | "observation-ended" | "computation-limit",
    flyby: boolean,
  ): GravityWellsLaunchVerification {
    return {
      valid: true,
      validatorId: GRAVITY_WELLS_ORBIT_VALIDATOR_ID,
      validatorVersion: GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION,
      massKey,
      terminal,
      undetermined: terminal === "computation-limit",
      steps,
      invocations,
      minDistance: minDistSoFar,
      flyby,
      missions: Object.freeze(missions.slice()),
      final: Object.freeze({ x, y, vx, vy }),
    };
  }
}
