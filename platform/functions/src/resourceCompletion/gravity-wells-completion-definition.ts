import { assessmentIdForLessonSlug, revisionIdForOrdinal } from "../shared/assessment-identifiers";
import type { CompletionDefinition } from "./completion-definition";
import {
  GRAVITY_WELLS_ORBIT_VALIDATOR_ID,
  GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION,
  type GravityWellsMissionOutcome,
} from "./gravity-wells-orbit-verifier";

// Pilot completion definition for Gravity Wells (RA-2 draft).
//
// Not live. Gravity Wells is unassignable, and no assessment revision
// `assessment_simulation-gravity-wells__r1` is deployed. The binding below
// is the identifier that revision will carry; it must be re-confirmed when
// that revision is authored and deployed.
//
// Required (approved pilot scope):
//   - orbit-missions: Earth orbit plus at least two of the other four
//     missions, each recomputed by `gravity-wells.orbit@1` (the page's own
//     rule in `checkP3Progress`).
//   - orbit-explanation: one written explanation, presence check only.
// The inventory's other proposed items (a mass prediction and a mass
// comparison record) are not included; they await owner and content review.

export const GRAVITY_WELLS_RESOURCE_ID = "simulation-gravity-wells";

const mission = (outcome: GravityWellsMissionOutcome) =>
  Object.freeze({
    outcomeId: outcome,
    stageId: "orbit-missions",
    validatorId: GRAVITY_WELLS_ORBIT_VALIDATOR_ID,
    validatorVersion: GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION,
    validatorOutcome: outcome,
  });

export const GRAVITY_WELLS_COMPLETION_DEFINITION: CompletionDefinition = Object.freeze({
  schemaVersion: 1,
  resourceId: GRAVITY_WELLS_RESOURCE_ID,
  resourceType: "simulation",
  assessmentRevisionId: revisionIdForOrdinal(assessmentIdForLessonSlug(GRAVITY_WELLS_RESOURCE_ID), 1),
  definitionVersion: 1,
  stages: Object.freeze([
    Object.freeze({
      stageId: "orbit-missions",
      required: true,
      requirement: Object.freeze({
        kind: "allOf",
        requirements: Object.freeze([
          Object.freeze({ kind: "outcome", outcomeId: "earth-orbit" }),
          Object.freeze({
            kind: "atLeast",
            count: 2,
            requirements: Object.freeze([
              Object.freeze({ kind: "outcome", outcomeId: "sun-escape" }),
              Object.freeze({ kind: "outcome", outcomeId: "jupiter-orbit" }),
              Object.freeze({ kind: "outcome", outcomeId: "flyby" }),
              Object.freeze({ kind: "outcome", outcomeId: "black-hole-survival" }),
            ]),
          }),
        ]),
      }),
    }),
    Object.freeze({
      stageId: "orbit-explanation",
      required: true,
      requirement: Object.freeze({ kind: "evidence", evidenceId: "orbit-speed-explanation" }),
    }),
  ]),
  evidence: Object.freeze([
    Object.freeze({
      evidenceId: "orbit-speed-explanation",
      stageId: "orbit-explanation",
      kind: "text",
      purpose: "explanation",
      prompt:
        "Explain why a probe needs the right sideways speed to stay in orbit. Use what happened in your missions.",
    }),
  ]),
  outcomes: Object.freeze([
    mission("earth-orbit"),
    mission("sun-escape"),
    mission("jupiter-orbit"),
    mission("flyby"),
    mission("black-hole-survival"),
  ]),
  attestations: Object.freeze([]),
});
