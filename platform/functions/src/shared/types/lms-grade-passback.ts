import type { Timestamp } from "firebase-admin/firestore";

import type { LmsProviderId } from "./lms";

export const LMS_GRADE_PASSBACKS_COLLECTION = "lmsGradePassbacks";

// Sprint 30A.2 - Google Classroom best-score grade passback.
//
// Canonical synchronization state for ONE (assignmentId, studentId) pair.
// LyfeLabz preserves every valid quiz attempt internally (`attempts/*`,
// append-only, never rewritten); Classroom receives only the BEST valid
// LyfeLabz normalized performance for a graded assignment, scaled to the
// teacher-selected Classroom max points. LyfeLabz is the source of truth
// for "what is the best performance" - Classroom's own stored grade is
// never read back and never treated as authoritative.
//
// One document per (assignmentId, studentId) pair, keyed by the
// deterministic id `${assignmentId}__${studentId}` (`lmsGradePassbackIdFor`
// in `lms/shared/ids.ts`). The record is server-authoritative; every write
// path is the grade-passback synchronization engine
// (`lms/grade-passback/engine.ts`), invoked either as a post-commit side
// effect of `assessmentAttemptsFinalize` or by the narrow teacher-facing
// manual retry callable (`lmsGradePassbacksRetry`). No client ever writes
// this collection directly.
//
// Monotonicity invariant: `desiredBestPercentage` (and the derived
// `desiredEarnedPoints`) is recomputed on every evaluation as the maximum
// over the FULL current valid-attempt set (via the canonical
// `selectHighestCompletedAttempt`), so it can only stay the same or
// increase as more attempts are recorded - it is never decremented and
// never computed incrementally from a single new attempt in isolation. A
// later lower-scoring attempt therefore can never lower the desired value.
//
// Concurrency invariant: `syncGeneration` is a monotonic fencing counter
// bumped only when `desiredBestPercentage` strictly increases.
// `lastSyncedGeneration` records the generation last CONFIRMED to have
// been successfully written to Classroom. `syncGeneration >
// lastSyncedGeneration` means there is unsynced work. At most one worker
// may actively call the upstream Classroom API at a time for a given
// pair; mutual exclusion is enforced by acquiring `leaseOwnerToken`
// transactionally (Firestore's own optimistic-concurrency on the
// transaction write is the actual mutual-exclusion primitive - the lease
// fields are the data that transaction protects). See
// `lms/grade-passback/engine.ts` for the full protocol and its proof.
// `protected` (additive): the last fresh evaluation found a protected
// Classroom grade (assigned zero, non-placeholder draft zero, or divergent
// assigned/draft grades), so nothing was written. Records written before
// this status existed are unaffected.
export type LmsGradePassbackStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | "protected";

export type LmsGradePassbackRecord = {
  readonly assignmentId: string;
  readonly studentId: string;
  // Denormalized for Firestore Rules ownership authorization (mirrors the
  // `lmsAssignmentPublications.ownerUid` convention) and for scoped
  // queries. Immutable once set: this document is keyed 1:1 to
  // (assignmentId, studentId), and both the owning class/teacher and the
  // assignment's grading target are frozen well before any passback state
  // can exist (Sprint 30A.1 freezes `classroomGrading` at draft time; a
  // publication is immutable once succeeded).
  readonly classId: string;
  readonly ownerUid: string;
  readonly schoolId: string;
  readonly districtId: string;
  // Everything needed to perform the upstream call without re-deriving it
  // from the assignment/publication record mid-flight, and to detect a
  // stale target if the assignment's publication pointer ever changed
  // (defensive; Sprint 30A.1 freezes publication once succeeded).
  readonly providerId: LmsProviderId;
  readonly connectionId: string;
  readonly lmsClassId: string;
  readonly lmsAssignmentId: string;
  readonly lmsPublicationRef: string;
  // The teacher-selected Classroom maximum point value, frozen from the
  // publication's `classroomGrading` snapshot the first time this document
  // is created. Never re-derived afterward (Sprint 30A v1 freezes maxPoints
  // once published; no `courseWork.patch` support exists).
  readonly maxPoints: number;
  // The canonical current-best LyfeLabz performance, recomputed in full on
  // every evaluation. Monotonic non-decreasing (see module comment).
  readonly desiredBestPercentage: number;
  readonly desiredEarnedPoints: number;
  // The attempt that currently produces the desired value, for audit/debug
  // only - never used as a comparison key itself.
  readonly bestAttemptId: string;
  // Fencing/version counter. Bumped only when `desiredBestPercentage`
  // strictly increases.
  readonly syncGeneration: number;
  // The generation last CONFIRMED synced to Classroom. 0 before any
  // successful sync.
  readonly lastSyncedGeneration: number;
  readonly lastSyncedEarnedPoints?: number;
  readonly status: LmsGradePassbackStatus;
  // Mutual-exclusion lease over "who may currently call Classroom for this
  // pair." Absent when no worker currently holds it.
  readonly leaseOwnerToken?: string;
  // The generation the current lease owner was authorized to pursue at
  // acquisition time. The owner re-reads the live desired state on every
  // reconciliation, so this is provenance/debug, not itself re-checked as
  // an upper bound.
  readonly leaseGeneration?: number;
  readonly leaseExpiresAt?: Timestamp;
  // Legacy: opaque cached Classroom StudentSubmission id written by the
  // pre-canonical-decision engine. No longer written or read (every write
  // now re-reads the live submission first); retained for existing records.
  readonly submissionId?: string;
  // The canonical decision (`reconciliation-plan.ts` action) of the last
  // fresh evaluation that reached Classroom, and when. Additive.
  readonly lastDecision?: string;
  readonly lastDecisionAt?: Timestamp;
  readonly lastAttemptedAt?: Timestamp;
  readonly lastSyncedAt?: Timestamp;
  // Bounded, non-PII error code (a `PlatformError`-style dotted code, e.g.
  // `lms.upstreamTemporarilyUnavailable`). Never a raw Google error message.
  readonly lastErrorCode?: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
};

