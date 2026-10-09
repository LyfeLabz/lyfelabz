// Authenticated resource-evidence persistence foundation (RA-3A).
//
// Internal module. NOT exported from `src/index.ts`, so no handler here is a
// deployed Cloud Function. The handlers are plain functions (not wrapped in
// `platformCallable`). The only production deps (`PRODUCTION_RESOURCE_EVIDENCE_DEPS`)
// fail closed until assignment publication freezes a completion-definition
// version and an immutable published definition store exists (see
// `docs/platform/RESOURCE_EVIDENCE_PERSISTENCE.md`).

export {
  NO_PUBLISHED_COMPLETION_DEFINITIONS,
  PRODUCTION_RESOURCE_EVIDENCE_DEPS,
  UNAVAILABLE_FROZEN_COMPLETION_BINDING,
  assertWritable,
  resolveEvidenceContext,
  type CompletionDefinitionStore,
  type EvidenceActor,
  type FrozenCompletionBindingSource,
  type ResolvedEvidenceContext,
  type ResourceEvidenceDeps,
} from "./evidence-assignment-context";
export {
  EVIDENCE_REQUEST_LIMITS,
  canonicalJson,
  payloadHash,
} from "./evidence-request";
export {
  RESOURCE_EVIDENCE_COLLECTION,
  RESOURCE_EVIDENCE_RECORD_SCHEMA_VERSION,
  RESOURCE_EVIDENCE_SUBMISSIONS_SUBCOLLECTION,
  RESOURCE_EVIDENCE_SUBMISSION_ID,
  resourceEvidenceRecordId,
  type ResourceEvidenceBinding,
  type ResourceEvidenceOwnership,
  type ResourceEvidenceRecord,
  type ResourceEvidenceSubmissionRecord,
  type StoredOutcomeRun,
} from "./resource-evidence-record";
export {
  getOwnResourceEvidence,
  readSubmittedSnapshot,
  recordResourceOutcomeRun,
  saveWorkingResourceEvidence,
  submitResourceEvidence,
  type RecordOutcomeRunResult,
  type ResourceEvidenceView,
  type SaveWorkingEvidenceResult,
  type SubmitEvidenceResult,
} from "./resource-evidence-service";
export {
  RUN_VERIFICATION_LIMITS,
  appendKeepsInvariant,
  nextRunAllowance,
  resolveRunVerificationPolicy,
} from "./run-observation-policy";
