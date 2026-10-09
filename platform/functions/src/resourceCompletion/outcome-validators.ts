import {
  GRAVITY_WELLS_MISSION_OUTCOMES,
  GRAVITY_WELLS_ORBIT_VALIDATOR_ID,
  GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION,
  parseGravityWellsLaunchParameters,
  verifyGravityWellsLaunch,
} from "./gravity-wells-orbit-verifier";

// Closed registry of server-verifiable outcome validators. A completion
// definition names a validator by id and version; only entries here exist.
// There is no plug-in or expression mechanism: adding a validator is a
// reviewed code change, and a new version is a new entry beside the old one.

export type OutcomeValidation =
  | { readonly valid: false; readonly issue: string }
  | {
      readonly valid: true;
      readonly outcomes: readonly string[];
      // Frozen copy of the accepted parameters, detached from the input.
      readonly normalizedParameters: unknown;
      // Computation units spent (never more than the budget given).
      readonly cost: number;
      // True when the budget ran out before the run's outcome was known.
      readonly undetermined: boolean;
    };

export interface OutcomeValidator {
  readonly validatorId: string;
  readonly validatorVersion: number;
  // Every outcome code `verify` can report.
  readonly outcomes: readonly string[];
  // Pure. Recomputes outcomes from submitted parameters, spending at most
  // `budget` computation units; never trusts a claimed result.
  readonly verify: (parameters: unknown, budget: number) => OutcomeValidation;
}

export function outcomeValidatorKey(validatorId: string, validatorVersion: number): string {
  return `${validatorId}@${validatorVersion}`;
}

const gravityWellsOrbitV1: OutcomeValidator = Object.freeze({
  validatorId: GRAVITY_WELLS_ORBIT_VALIDATOR_ID,
  validatorVersion: GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION,
  outcomes: GRAVITY_WELLS_MISSION_OUTCOMES,
  // One computation unit per integration step.
  verify: (parameters: unknown, budget: number): OutcomeValidation => {
    const parsed = parseGravityWellsLaunchParameters(parameters);
    if (!parsed.ok) return { valid: false, issue: parsed.issue };
    const result = verifyGravityWellsLaunch(parsed.value, budget);
    if (!result.valid) return { valid: false, issue: result.issue };
    return {
      valid: true,
      outcomes: result.missions.map((m) => m.outcome),
      normalizedParameters: parsed.value,
      cost: result.steps,
      undetermined: result.undetermined,
    };
  },
});

const OUTCOME_VALIDATORS: ReadonlyMap<string, OutcomeValidator> = new Map(
  [gravityWellsOrbitV1].map((v) => [outcomeValidatorKey(v.validatorId, v.validatorVersion), v]),
);

export function resolveOutcomeValidator(
  validatorId: string,
  validatorVersion: number,
): OutcomeValidator | undefined {
  return OUTCOME_VALIDATORS.get(outcomeValidatorKey(validatorId, validatorVersion));
}
