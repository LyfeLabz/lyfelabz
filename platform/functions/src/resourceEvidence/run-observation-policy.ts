import {
  GRAVITY_WELLS_ORBIT_VALIDATOR_ID,
  GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION,
  RESOURCE_EVIDENCE_LIMITS,
  outcomeValidatorKey,
  parseGravityWellsLaunchParameters,
  resolveOutcomeValidator,
} from "../resourceCompletion";

// Verification allocation for stored outcome runs (RA-3A).
//
// RA-2's evaluator spends one shared budget (`maxComputationUnits`,
// 4,000,000) across a snapshot's runs in order. A record accumulates runs
// over a whole assignment, so the persistence layer decides, per run, how
// much of that budget the run may use. Two failure modes must be avoided:
//
//   - Starvation: one extreme run (a probe left orbiting in an open tab)
//     consuming the whole budget, so every later run is undetermined and
//     the student can never earn the remaining missions.
//   - Lost late outcomes: legitimate missions that occur late. Known ones
//     include the Black Hole flyby at call 84,428 (RA-2's parity case) and
//     Black Hole flybys at calls 130,712 and 147,455 found by a launch-grid
//     sweep. An equal 80,000-call share per run (the earlier policy) lost
//     all three, and reported them as an ended observation.
//
// Policy (all units are RA-2 computation units; for Gravity Wells one unit
// is one integration step):
//
//   - Every one of the 50 run slots is guaranteed `guaranteedUnitsPerRun`
//     (20,000). In a 6,000-launch sweep (4 masses, 25 speeds, 60 angles,
//     observed for 400,000 calls) every mission except the two late
//     flybys above occurred within 1,000 calls; RA-2's late Sun escape
//     occurs at call 11,711. All of these fit the floor.
//   - The rest of the budget (3,000,000) is a shared pool, granted in
//     record order, with no run allowed more than `maxUnitsPerRun`
//     (1,000,000: about 6.8 times the latest known outcome, and at most a
//     quarter of the budget, so no single run can exhaust it).
//   - A run's allowance is
//       min(maxUnitsPerRun,
//           totalUnits - storedCost - guaranteedUnitsPerRun * slotsAfterThis)
//     and it is charged its ACTUAL cost (what the validator spent), so a
//     run that crashes early leaves the pool untouched.
//
// Invariant (checked inside the append transaction): after n stored runs,
//   storedCost <= totalUnits - guaranteedUnitsPerRun * (runSlots - n).
// So every later run always gets at least the guaranteed floor, and the
// whole stored snapshot can never exceed the RA-2 budget: the evaluator
// never reaches `computation-limit` for a stored snapshot, and each run's
// result is independent of every other run and of order.
//
// A run observed longer than its allowance is verified over its allowance
// only (its declared observation is truncated; the physics is not touched).
// Missions inside the window are verified. If the flight was still going
// when the window ended, the run is stored `undetermined`: later missions
// are neither credited nor refuted, exactly RA-2's undetermined meaning.
// This never over-credits: under the RA-2 trust model a shorter
// observation can only lose credit. The reported parameters are kept.
//
// These numbers are provisional engineering limits derived from the RA-2
// budget and the observed mission timing, not production load
// certification.
//
// The policy table is closed, like the validator registry: a validator
// without an entry here cannot be persisted.

export const RUN_VERIFICATION_LIMITS = Object.freeze({
  totalUnits: RESOURCE_EVIDENCE_LIMITS.maxComputationUnits,
  runSlots: RESOURCE_EVIDENCE_LIMITS.maxOutcomeRuns,
  guaranteedUnitsPerRun: 20_000,
  maxUnitsPerRun: 1_000_000,
});

// Units the next run may use, given the stored runs' actual costs. Always
// at least the guaranteed floor while the invariant holds.
export function nextRunAllowance(storedCost: number, storedRuns: number): number {
  const L = RUN_VERIFICATION_LIMITS;
  const slotsAfterThis = Math.max(L.runSlots - storedRuns - 1, 0);
  const available = L.totalUnits - storedCost - L.guaranteedUnitsPerRun * slotsAfterThis;
  return Math.max(0, Math.min(L.maxUnitsPerRun, available));
}

// True when appending a run of `cost` to the stored runs keeps the
// invariant (so every remaining slot keeps its guaranteed floor).
export function appendKeepsInvariant(storedCost: number, storedRuns: number, cost: number): boolean {
  const L = RUN_VERIFICATION_LIMITS;
  if (storedRuns + 1 > L.runSlots) return false;
  return storedCost + cost <= L.totalUnits - L.guaranteedUnitsPerRun * (L.runSlots - storedRuns - 1);
}

export type ReportedRun =
  | { readonly ok: true; readonly reported: unknown }
  | { readonly ok: false; readonly issue: string };

export type WindowedVerification =
  | { readonly ok: false; readonly issue: string }
  | {
      readonly ok: true;
      readonly reported: unknown;
      // Parameters actually verified (reported, or truncated to the window).
      readonly verified: unknown;
      readonly truncated: boolean;
      // Units the validator spent: the run's charge against the budget.
      readonly cost: number;
      readonly outcomes: readonly string[];
      // The flight was still going when the verification window ended.
      readonly undetermined: boolean;
    };

type RunVerificationPolicy = {
  // Structural parse only (no computation): used for idempotency hashing
  // and for duplicate detection before any physics runs.
  readonly parse: (parameters: unknown) => ReportedRun;
  readonly verify: (parameters: unknown, allowance: number) => WindowedVerification;
};

// Gravity Wells: a run makes at most `observedInvocations` steps, so a
// window of W calls costs at most W units. Each call either ends the flight
// (no step) or performs one step, so a verification whose cost equals its
// window stepped on every observed call: the flight was still going.
const gravityWellsOrbitV1: RunVerificationPolicy = {
  parse: (parameters) => {
    const parsed = parseGravityWellsLaunchParameters(parameters);
    return parsed.ok ? { ok: true, reported: parsed.value } : { ok: false, issue: parsed.issue };
  },
  verify: (parameters, allowance) => {
    const parsed = parseGravityWellsLaunchParameters(parameters);
    if (!parsed.ok) return { ok: false, issue: parsed.issue };
    const reported = parsed.value;
    const window = Math.floor(allowance);
    if (window < 1) return { ok: false, issue: "verification-capacity-exhausted" };
    const truncated = reported.observedInvocations > window;
    const verified = truncated ? Object.freeze({ ...reported, observedInvocations: window }) : reported;
    const validator = resolveOutcomeValidator(GRAVITY_WELLS_ORBIT_VALIDATOR_ID, GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION);
    const result = validator?.verify(verified, window);
    if (!result || !result.valid) return { ok: false, issue: result ? result.issue : "unknownValidator" };
    return {
      ok: true,
      reported,
      verified,
      truncated,
      cost: result.cost,
      outcomes: result.outcomes,
      undetermined: result.undetermined || (truncated && result.cost >= window),
    };
  },
};

const RUN_VERIFICATION_POLICIES: ReadonlyMap<string, RunVerificationPolicy> = new Map([
  [outcomeValidatorKey(GRAVITY_WELLS_ORBIT_VALIDATOR_ID, GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION), gravityWellsOrbitV1],
]);

export function resolveRunVerificationPolicy(
  validatorId: string,
  validatorVersion: number,
): RunVerificationPolicy | undefined {
  return RUN_VERIFICATION_POLICIES.get(outcomeValidatorKey(validatorId, validatorVersion));
}
