import type { CompletionRequirement } from "./completion-definition";
import { validateCompletionDefinition } from "./completion-definition";
import { outcomeValidatorKey } from "./outcome-validators";
import { parseResourceEvidence } from "./resource-evidence";

// Pure completion-eligibility evaluator (RA-2).
//
// Decides whether an evidence snapshot satisfies every required stage of a
// completion definition. It validates both inputs from scratch (callers
// pass untrusted data), checks that the evidence answers this exact
// definition, and fails closed on anything malformed, unknown, or
// contradictory. It has no side effects, reads no clock, and creates no
// timestamps: recording "submitted" or "eligible" is a later server
// responsibility. A satisfied text requirement means a visible response is
// present, not that it is good.

export interface StageEvaluation {
  readonly stageId: string;
  readonly required: boolean;
  readonly satisfied: boolean;
  // Leaf references ("evidence:<id>", "outcome:<id>", "attestation:<id>")
  // that are unmet inside an unsatisfied part of the stage.
  readonly missing: readonly string[];
}

export type CompletionEligibilityResult =
  | {
      readonly eligible: false;
      readonly status: "invalid-definition" | "invalid-evidence" | "binding-mismatch";
      readonly issues: readonly string[];
    }
  | {
      readonly eligible: boolean;
      readonly status: "evaluated";
      readonly resourceId: string;
      readonly assessmentRevisionId: string;
      readonly definitionVersion: number;
      readonly stages: readonly StageEvaluation[];
      // Required stages not yet satisfied, in definition order.
      readonly unmetRequiredStageIds: readonly string[];
      // Declared outcome ids the submitted runs achieved (each once).
      readonly verifiedOutcomeIds: readonly string[];
      // Indexes of runs whose outcome the computation budget could not
      // settle. Undetermined is not failed: such a run earns only what was
      // verified within the budget.
      readonly undeterminedRunIndexes: readonly number[];
    };

const VISIBLE_CHARACTER = /[^\s\p{Cf}]/u;

export function evaluateCompletionEligibility(
  rawDefinition: unknown,
  rawEvidence: unknown,
): CompletionEligibilityResult {
  const def = validateCompletionDefinition(rawDefinition);
  if (!def.ok) return { eligible: false, status: "invalid-definition", issues: def.issues };
  const definition = def.definition;

  const parsed = parseResourceEvidence(rawEvidence, definition);
  if (!parsed.ok) return { eligible: false, status: "invalid-evidence", issues: parsed.issues };
  const evidence = parsed.evidence;

  const mismatches: string[] = [];
  if (evidence.resourceId !== definition.resourceId) mismatches.push("binding.resourceId");
  if (evidence.assessmentRevisionId !== definition.assessmentRevisionId) {
    mismatches.push("binding.assessmentRevisionId");
  }
  if (evidence.definitionVersion !== definition.definitionVersion) {
    mismatches.push("binding.definitionVersion");
  }
  if (mismatches.length > 0) {
    return { eligible: false, status: "binding-mismatch", issues: Object.freeze(mismatches) };
  }

  const presentEvidence = new Set(
    evidence.authored.filter((a) => VISIBLE_CHARACTER.test(a.text)).map((a) => a.evidenceId),
  );
  const achieved = new Set<string>();
  for (const run of parsed.verifiedRuns) {
    const key = outcomeValidatorKey(run.validatorId, run.validatorVersion);
    for (const outcome of run.outcomes) achieved.add(`${key}#${outcome}`);
  }
  const verifiedOutcomeIds = definition.outcomes
    .filter((o) =>
      achieved.has(`${outcomeValidatorKey(o.validatorId, o.validatorVersion)}#${o.validatorOutcome}`),
    )
    .map((o) => o.outcomeId);
  const verifiedOutcomes = new Set(verifiedOutcomeIds);
  const attested = new Set(evidence.attestations.map((a) => a.attestationId));

  const evaluate = (r: CompletionRequirement, missing: string[]): boolean => {
    switch (r.kind) {
      case "evidence":
        return presentEvidence.has(r.evidenceId) || (missing.push(`evidence:${r.evidenceId}`), false);
      case "outcome":
        return verifiedOutcomes.has(r.outcomeId) || (missing.push(`outcome:${r.outcomeId}`), false);
      case "attestation":
        return attested.has(r.attestationId) || (missing.push(`attestation:${r.attestationId}`), false);
      case "allOf":
      case "atLeast": {
        const childMissing: string[] = [];
        const met = r.requirements.filter((c) => evaluate(c, childMissing)).length;
        const satisfied = r.kind === "allOf" ? met === r.requirements.length : met >= r.count;
        if (!satisfied) missing.push(...childMissing);
        return satisfied;
      }
    }
  };

  const stages = definition.stages.map((s): StageEvaluation => {
    const missing: string[] = [];
    const satisfied = evaluate(s.requirement, missing);
    return Object.freeze({
      stageId: s.stageId,
      required: s.required,
      satisfied,
      missing: Object.freeze(satisfied ? [] : missing),
    });
  });
  const unmetRequiredStageIds = stages.filter((s) => s.required && !s.satisfied).map((s) => s.stageId);

  return {
    eligible: unmetRequiredStageIds.length === 0,
    status: "evaluated",
    resourceId: definition.resourceId,
    assessmentRevisionId: definition.assessmentRevisionId,
    definitionVersion: definition.definitionVersion,
    stages: Object.freeze(stages),
    unmetRequiredStageIds: Object.freeze(unmetRequiredStageIds),
    verifiedOutcomeIds: Object.freeze(verifiedOutcomeIds),
    undeterminedRunIndexes: Object.freeze(
      parsed.verifiedRuns.flatMap((run, index) => (run.undetermined ? [index] : [])),
    ),
  };
}
