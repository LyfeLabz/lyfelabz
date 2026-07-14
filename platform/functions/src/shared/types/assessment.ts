import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// Canonical Firestore collection identifiers for the assessment-content
// surfaces owned exclusively by the deployment pipeline per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §11 and ASSESSMENT_SCORING_CONTRACT.md
// §5, §13. Callable code in this repository never writes to these
// collections; only the scorer inside `assessmentAttemptsFinalize` reads
// `assessmentAnswerKeys/*` at request time (§15, PDR-026d).
export const ASSESSMENTS_COLLECTION = "assessments";
export const ASSESSMENT_REVISIONS_COLLECTION = "assessmentRevisions";
export const ASSESSMENT_ANSWER_KEYS_COLLECTION = "assessmentAnswerKeys";

// v1 discriminant literals per ASSESSMENT_SCORING_CONTRACT.md §3, §4, §14.
// Kept as narrow literal types so a widening drift in a future slice must
// go through a superseding Platform Decision Record and a schemaVersion
// bump rather than through an incremental relaxation.
export const ASSESSMENT_SCHEMA_VERSION_V1 = 1 as const;
export type AssessmentSchemaVersion = typeof ASSESSMENT_SCHEMA_VERSION_V1;
export type AssessmentItemType = "singleChoice";
export type AssessmentItemOrderingRule = "authoredOrder";

// Revision-item option shape per ASSESSMENT_SCORING_CONTRACT.md §4.2.
// `optionId` is a stable string chosen by the deployment pipeline
// (canonical convention "A", "B", "C", "D") and is the value the student's
// autosaved `response` string is compared against inside the scorer.
export type AssessmentRevisionItemOption = {
  readonly optionId: string;
  readonly text: string;
};

// Revision-item shape per ASSESSMENT_SCORING_CONTRACT.md §4.2. `points` is
// the numeric literal `1` in v1; the answer-key item's `points` MUST match
// per §5.3. `itemType` is the v1 literal `"singleChoice"`.
export type AssessmentRevisionItem = {
  readonly itemId: string;
  readonly itemType: AssessmentItemType;
  readonly stem: string;
  readonly options: readonly AssessmentRevisionItemOption[];
  readonly points: 1;
};

// Canonical `assessmentRevisions/{revisionId}` read shape per
// ASSESSMENT_SCORING_CONTRACT.md §4. The document is immutable after
// publication (§6) and carries no correct-answer material; every
// correct-answer field lives in the paired `assessmentAnswerKeys/{revisionId}`
// document (§5). This type is the sole read shape consumed by the scorer
// for the scorable-content side.
export type AssessmentRevisionRecord = {
  readonly assessmentId: string;
  readonly revisionOrdinal: number;
  readonly activityId: string;
  readonly itemOrderingRule: AssessmentItemOrderingRule;
  readonly items: readonly AssessmentRevisionItem[];
  readonly publishedAt: Timestamp;
  readonly publishedBy: string;
  readonly schemaVersion: AssessmentSchemaVersion;
};

// Answer-key-item shape per ASSESSMENT_SCORING_CONTRACT.md §5.2. Present on
// the server-confidential `assessmentAnswerKeys/{revisionId}` document
// (§5.4) and never delivered to any client outside the scorer's feedback
// payload (§10, §12.3). `correctOptionId` MUST match one of the paired
// revision item's `options[*].optionId` (§5.3).
export type AssessmentAnswerKeyItem = {
  readonly itemId: string;
  readonly correctOptionId: string;
  readonly points: 1;
  readonly explanation: string;
};

// Canonical `assessmentAnswerKeys/{revisionId}` read shape per
// ASSESSMENT_SCORING_CONTRACT.md §5. Only the scorer inside
// `assessmentAttemptsFinalize` reads this document at request time
// (PDR-026d; ASSESSMENT_IMPLEMENTATION_CONTRACT.md §15, §21). Firestore
// Security Rules refuse every client read for every role including
// `platformAdministrator`.
export type AssessmentAnswerKeyRecord = {
  readonly assessmentId: string;
  readonly revisionOrdinal: number;
  readonly items: readonly AssessmentAnswerKeyItem[];
  readonly publishedAt: Timestamp;
  readonly publishedBy: string;
  readonly schemaVersion: AssessmentSchemaVersion;
};

// Canonical `assessments/{assessmentId}` read shape per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §5, §11. Written by the deployment
// pipeline only; the scorer in this slice does not read this document
// because the session's frozen `assessmentRevisionId` is the authoritative
// pointer to the revision the attempt is scored against per
// ASSESSMENT_SCORING_CONTRACT.md §12.1. The type is declared here so future
// slices (currentRevisionId advancement, retirement inspection) can
// consume the same read shape.
export type AssessmentRecord = {
  readonly assessmentId: string;
  readonly activityId: string;
  readonly currentRevisionId: string;
  readonly retiredAt?: Timestamp;
};

// Deployment-only write shapes. Declared for completeness so a later
// deployment-pipeline slice imports the same names; no callable in this
// slice writes any of these documents.
export type AssessmentDeploymentWrite = {
  readonly assessmentId: string;
  readonly activityId: string;
  readonly currentRevisionId: string;
};

export type AssessmentRevisionDeploymentWrite = {
  readonly assessmentId: string;
  readonly revisionOrdinal: number;
  readonly activityId: string;
  readonly itemOrderingRule: AssessmentItemOrderingRule;
  readonly items: readonly AssessmentRevisionItem[];
  readonly publishedAt: FieldValue;
  readonly publishedBy: string;
  readonly schemaVersion: AssessmentSchemaVersion;
};

export type AssessmentAnswerKeyDeploymentWrite = {
  readonly assessmentId: string;
  readonly revisionOrdinal: number;
  readonly items: readonly AssessmentAnswerKeyItem[];
  readonly publishedAt: FieldValue;
  readonly publishedBy: string;
  readonly schemaVersion: AssessmentSchemaVersion;
};
