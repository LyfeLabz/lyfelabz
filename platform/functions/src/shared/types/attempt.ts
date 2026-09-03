import type { FieldValue, Timestamp } from "firebase-admin/firestore";

import type {
  AssessmentSessionResponse,
  DeliveryOutcome,
} from "./assessment-session";

// Canonical Firestore collection identifier for the immutable authoritative
// attempt record per ASSESSMENT_IMPLEMENTATION_CONTRACT.md §7, §11
// (PDR-026a, PDR-026c). `assessmentAttemptsFinalize` is the sole writer;
// no callable ever updates or deletes a written document.
export const ATTEMPTS_COLLECTION = "attempts";

// Per-item scoring artifact recorded on the attempt per
// ASSESSMENT_SCORING_CONTRACT.md §10.3. `correctOptionId` and `explanation`
// are the permitted subset of the answer-key payload delivered to the
// student post-submit (§10.4); no other answer-key field crosses the
// scorer boundary. `studentResponse` is `null` when the student left the
// item unanswered per §8.4.
export type AssessmentAttemptItemResult = {
  readonly itemId: string;
  readonly isCorrect: boolean;
  readonly pointsEarned: number;
  readonly correctOptionId: string;
  readonly explanation: string;
  readonly studentResponse: string | null;
};

// Canonical `attempts/{attemptId}` read shape per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §7, §13, §14 and
// ASSESSMENT_SCORING_CONTRACT.md §10.3.
//
// Every ownership and lifecycle field is frozen at attempt creation
// (§7 post-creation invariants). The record is immutable after the write
// that produced it; no callable in the assessment pipeline updates or
// deletes an attempt. `assessmentRevisionId` is the revision the student
// was scored against (the session's frozen revision, not the assessment's
// current revision at read time) per §7 and ASSESSMENT_SCORING_CONTRACT.md
// §6, §12.1.
//
// `idempotencyKey` is the client-supplied stable string that the scorer
// deduplicates on per §8 idempotency semantics. A retry with the same key
// after a successful commit returns the existing attempt payload without
// a second write and without a second audit event.
export type AssessmentAttemptRecord = {
  readonly studentId: string;
  readonly assignmentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly activityId: string;
  readonly assessmentId: string;
  readonly assessmentRevisionId: string;
  readonly attemptNumber: number;
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly responses: readonly AssessmentSessionResponse[];
  readonly itemResults: readonly AssessmentAttemptItemResult[];
  readonly idempotencyKey: string;
  readonly submittedAt: Timestamp;
  // F5.2 §3.4 - Persistent Student Differentiation Slice 6 additive fields,
  // copied verbatim from the session's frozen delivery state inside the
  // finalize transaction (absent on session => absent here). Immutable, like
  // every other attempt field. `deliveryOutcome` is delivery-status metadata,
  // not plan/diagnosis data (§11); the pair is present iff
  // `deliveryOutcome:"differentiated"` (§3.3 invariant). Pre-feature attempts
  // predate this contract and carry none of the three; that absence is NOT
  // evidence that no accommodation existed and is NEVER backfilled (§3.4).
  // Aggregate score reporting ignores all three (T-L1).
  readonly deliveryOutcome?: DeliveryOutcome;
  readonly variantKey?: string;
  readonly presentationRevisionId?: string;
};

// Write shape for the sole authorized attempt writer
// (`assessmentAttemptsFinalize`). Every field enumerated in the read shape
// is set at creation; `submittedAt` is stamped by the server via
// `FieldValue.serverTimestamp()`. No other write path exists.
export type AssessmentAttemptCreationWrite = {
  readonly studentId: string;
  readonly assignmentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly activityId: string;
  readonly assessmentId: string;
  readonly assessmentRevisionId: string;
  readonly attemptNumber: number;
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly responses: readonly AssessmentSessionResponse[];
  readonly itemResults: readonly AssessmentAttemptItemResult[];
  readonly idempotencyKey: string;
  readonly submittedAt: FieldValue;
  // Slice 6 delivery propagation (§3.4). Optional and additive: the finalize
  // transaction copies these from the session when present (differentiated =>
  // both pair fields; canonical/canonicalFallback => `deliveryOutcome` only;
  // pre-Slice-6 session => none). Never re-resolved from the current index or
  // the student's current accommodation - the session freeze is authoritative.
  readonly deliveryOutcome?: DeliveryOutcome;
  readonly variantKey?: string;
  readonly presentationRevisionId?: string;
};
