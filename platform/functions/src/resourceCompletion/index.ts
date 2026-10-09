// Pure completion and evidence core (RA-2), plus the frozen
// completion-definition record and binding identity (RA-3B). Types and pure
// functions only: no callable, trigger, Firestore access, or side effect.
// Not exported from `src/index.ts`. RA-3B's deployment and publication
// callers live in `assessments/` and `assignments/`.

export {
  COMPLETION_DEFINITION_LIMITS,
  COMPLETION_DEFINITION_SCHEMA_VERSION,
  isStableId,
  validateCompletionDefinition,
  type AttestationAuthorization,
  type CompletionDefinition,
  type CompletionDefinitionValidation,
  type CompletionRequirement,
  type CompletionResourceType,
  type CompletionStage,
  type EvidenceItemDefinition,
  type OutcomeDefinition,
  type TextEvidenceDefinition,
  type TextEvidencePurpose,
} from "./completion-definition";
export {
  RESOURCE_EVIDENCE_LIMITS,
  RESOURCE_EVIDENCE_SCHEMA_VERSION,
  SERVER_CONTROLLED_EVIDENCE_FIELDS,
  parseResourceEvidence,
  type AttestationRecord,
  type AuthoredEvidenceValue,
  type OutcomeRunSubmission,
  type ResourceEvidence,
  type ResourceEvidenceParse,
  type ResourceEvidenceServerState,
  type TextEvidenceValue,
  type VerifiedRunOutcomes,
} from "./resource-evidence";
export {
  evaluateCompletionEligibility,
  type CompletionEligibilityResult,
  type StageEvaluation,
} from "./evaluate-completion-eligibility";
export {
  outcomeValidatorKey,
  resolveOutcomeValidator,
  type OutcomeValidation,
  type OutcomeValidator,
} from "./outcome-validators";
export {
  GRAVITY_WELLS_MAX_LAUNCH_SPEED,
  GRAVITY_WELLS_MIN_LAUNCH_SPEED,
  GRAVITY_WELLS_MISSION_OUTCOMES,
  GRAVITY_WELLS_ORBIT_MASSES,
  GRAVITY_WELLS_ORBIT_VALIDATOR_ID,
  GRAVITY_WELLS_ORBIT_VALIDATOR_VERSION,
  GRAVITY_WELLS_SOURCE_MISSION_IDS,
  gravityWellsLaunchVelocityFromDrag,
  parseGravityWellsLaunchParameters,
  verifyGravityWellsLaunch,
  type GravityWellsLaunchIssue,
  type GravityWellsLaunchParameters,
  type GravityWellsLaunchVerification,
  type GravityWellsMissionEvent,
  type GravityWellsMissionOutcome,
  type GravityWellsOrbitMassKey,
} from "./gravity-wells-orbit-verifier";
export {
  GRAVITY_WELLS_COMPLETION_DEFINITION,
  GRAVITY_WELLS_RESOURCE_ID,
} from "./gravity-wells-completion-definition";
export {
  buildAssignmentCompletionBinding,
  canonicalCompletionDefinitionJson,
  completionDefinitionValidators,
  computeCompletionDefinitionHash,
  parseAssignmentCompletionBinding,
  prepareCompletionDefinitionRecord,
  verifyCompletionDefinitionRecord,
  verifyFrozenCompletionBinding,
  type CompletionBindingIssue,
  type CompletionDefinitionIdentity,
  type CompletionDefinitionRecordIssue,
  type CompletionDefinitionRecordVerification,
  type FrozenCompletionBindingVerification,
  type PreparedCompletionDefinitionRecord,
  type VerifiedCompletionDefinitionRecord,
} from "./completion-definition-record";
