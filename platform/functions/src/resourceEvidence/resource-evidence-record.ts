import type { DocumentReference, FieldValue, Timestamp } from "firebase-admin/firestore";

import { getAdminFirestore } from "../shared/firestore/admin";
import type { CompletionResourceType } from "../resourceCompletion";

// Authenticated resource-evidence persistence (RA-3A). One record per
// (assignment occurrence, student), stored at
// `resourceEvidence/{assignmentId}__{studentId}`, with the frozen submitted
// snapshot in a create-only child document
// `resourceEvidence/{recordId}/submissions/submitted`.
//
// The record family is server-owned: no Firestore Rules block opens it, so
// the terminal default-deny refuses every client role (owning student,
// other students, teachers, administrators, unauthenticated). The services
// in this module are the only readers and writers, through the Admin SDK.
//
// Trust classes are kept in separate fields:
//   1. Working evidence (`workingJson`): mutable, student-authored text and
//      attestations, written under `workingRevision` compare-and-swap.
//   2. Accepted outcome runs (`runs`): run parameters the server verified
//      with the registered validator, plus the outcomes it recomputed.
//      Append-only while working, under `runsRevision`.
//   3. Submitted snapshot (child document): written once with `create`
//      when the student submits and the server evaluates the snapshot as
//      eligible. Never updated by any code path.
//   4. Server metadata: ownership stamp and frozen binding (written once at
//      creation), `status`, timestamps, and `evidenceEligibleAt`.
//
// The record is keyed by assignment occurrence, never by teacher unit
// membership, and carries no unit, attempt, session, score, or quiz field.

export const RESOURCE_EVIDENCE_COLLECTION = "resourceEvidence";
export const RESOURCE_EVIDENCE_SUBMISSIONS_SUBCOLLECTION = "submissions";
// Pilot rule (standard §16 Q5): evidence is frozen at its one submission.
export const RESOURCE_EVIDENCE_SUBMISSION_ID = "submitted";

export const RESOURCE_EVIDENCE_RECORD_SCHEMA_VERSION = 1;

export type ResourceEvidenceStatus = "working" | "submitted";

export function resourceEvidenceRecordId(assignmentId: string, studentId: string): string {
  return `${assignmentId}__${studentId}`;
}

// Written once at creation; equal to the resolved assignment context on
// every later call or the call is refused.
export type ResourceEvidenceOwnership = {
  readonly studentId: string;
  readonly assignmentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
};

// Frozen completion binding, taken from the server-held assignment and its
// frozen completion-definition version, never from the client.
export type ResourceEvidenceBinding = {
  readonly resourceId: string;
  readonly resourceType: CompletionResourceType;
  readonly assessmentRevisionId: string;
  readonly definitionVersion: number;
};

export type StoredOutcomeRun = {
  // Client idempotency key and the hash of the request that produced it.
  readonly operationId: string;
  readonly payloadHash: string;
  // Browser-supplied correlation hint for one reset-origin flight. Used
  // only to collapse repeated reports; it proves nothing.
  readonly flightId: string;
  // Chosen by the server from the frozen definition.
  readonly validatorId: string;
  readonly validatorVersion: number;
  // Parameters as the validator normalized them from the request.
  readonly reportedParametersJson: string;
  // Parameters actually verified: the reported ones, or truncated to the
  // run's verification window (run-observation-policy.ts).
  readonly parametersJson: string;
  readonly truncated: boolean;
  // Computation units the validator spent: the run's charge against the
  // shared RA-2 budget.
  readonly cost: number;
  // Validator outcome codes recomputed by the server inside the window.
  readonly outcomes: readonly string[];
  // The flight was still going when the window ended: later missions are
  // neither credited nor refuted.
  readonly undetermined: boolean;
};

export type ResourceEvidenceRecord = ResourceEvidenceOwnership &
  ResourceEvidenceBinding & {
    readonly schemaVersion: number;
    readonly recordId: string;
    readonly status: ResourceEvidenceStatus;
    // Canonical JSON of `{ authored, attestations }`. One string, like lab
    // reports, so student text is not fanned out into index entries.
    readonly workingJson: string;
    readonly workingBytes: number;
    readonly workingRevision: number;
    readonly lastWorkingOperationId: string | null;
    readonly lastWorkingPayloadHash: string | null;
    readonly runs: readonly StoredOutcomeRun[];
    readonly runsRevision: number;
    readonly submitOperationId: string | null;
    readonly submittedAt: Timestamp | null;
    // Server-derived: the submitted snapshot satisfied every required stage
    // of the frozen definition. Sticky. This is NOT the quiz authorization
    // gate: `assessmentSessionsBegin` / `assessmentAttemptsFinalize` do not
    // read it today (RA-4).
    readonly evidenceEligibleAt: Timestamp | null;
    readonly createdAt: Timestamp;
    readonly updatedAt: Timestamp;
  };

export type ResourceEvidenceCreationWrite = ResourceEvidenceOwnership &
  ResourceEvidenceBinding & {
    readonly schemaVersion: number;
    readonly recordId: string;
    readonly status: "working";
    readonly workingJson: string;
    readonly workingBytes: number;
    readonly workingRevision: number;
    readonly lastWorkingOperationId: string | null;
    readonly lastWorkingPayloadHash: string | null;
    readonly runs: readonly StoredOutcomeRun[];
    readonly runsRevision: number;
    readonly submitOperationId: null;
    readonly submittedAt: null;
    readonly evidenceEligibleAt: null;
    readonly createdAt: FieldValue;
    readonly updatedAt: FieldValue;
  };

// Update shapes structurally exclude the ownership stamp, the binding, and
// `createdAt`, so no write can rebind or reassign a record.
export type ResourceEvidenceWorkingUpdate = {
  readonly workingJson: string;
  readonly workingBytes: number;
  readonly workingRevision: number;
  readonly lastWorkingOperationId: string;
  readonly lastWorkingPayloadHash: string;
  readonly updatedAt: FieldValue;
};

export type ResourceEvidenceRunsUpdate = {
  readonly runs: readonly StoredOutcomeRun[];
  readonly runsRevision: number;
  readonly updatedAt: FieldValue;
};

export type ResourceEvidenceSubmitUpdate = {
  readonly status: "submitted";
  readonly submitOperationId: string;
  readonly submittedAt: FieldValue;
  readonly evidenceEligibleAt: FieldValue;
  readonly updatedAt: FieldValue;
};

export type ResourceEvidenceSubmissionRecord = ResourceEvidenceOwnership &
  ResourceEvidenceBinding & {
    readonly schemaVersion: number;
    readonly recordId: string;
    readonly operationId: string;
    // Canonical JSON of the RA-2 `ResourceEvidence` the server evaluated.
    readonly snapshotJson: string;
    readonly snapshotBytes: number;
    readonly workingRevision: number;
    readonly runsRevision: number;
    readonly eligible: true;
    readonly verifiedOutcomeIds: readonly string[];
    // Indexes (into the snapshot's runs) of runs whose verification window
    // ended while the flight was still going.
    readonly undeterminedRunIndexes: readonly number[];
    readonly submittedAt: Timestamp;
  };

export type ResourceEvidenceSubmissionCreationWrite = Omit<
  ResourceEvidenceSubmissionRecord,
  "submittedAt"
> & { readonly submittedAt: FieldValue };

// Local typed refs. This module is deliberately isolated and unexported
// (RA-3A); moving these into `shared/firestore/typed-ref.ts` belongs to the
// integration phase that deploys it.
function recordPath(recordId: string) {
  return getAdminFirestore().collection(RESOURCE_EVIDENCE_COLLECTION).doc(recordId);
}

export function resourceEvidenceDocRef(recordId: string): DocumentReference<ResourceEvidenceRecord> {
  return recordPath(recordId) as DocumentReference<ResourceEvidenceRecord>;
}

export function resourceEvidenceCreationDocRef(
  recordId: string,
): DocumentReference<ResourceEvidenceCreationWrite> {
  return recordPath(recordId) as DocumentReference<ResourceEvidenceCreationWrite>;
}

export function resourceEvidenceWorkingUpdateDocRef(
  recordId: string,
): DocumentReference<ResourceEvidenceWorkingUpdate> {
  return recordPath(recordId) as DocumentReference<ResourceEvidenceWorkingUpdate>;
}

export function resourceEvidenceRunsUpdateDocRef(
  recordId: string,
): DocumentReference<ResourceEvidenceRunsUpdate> {
  return recordPath(recordId) as DocumentReference<ResourceEvidenceRunsUpdate>;
}

export function resourceEvidenceSubmitUpdateDocRef(
  recordId: string,
): DocumentReference<ResourceEvidenceSubmitUpdate> {
  return recordPath(recordId) as DocumentReference<ResourceEvidenceSubmitUpdate>;
}

function submissionPath(recordId: string) {
  return recordPath(recordId)
    .collection(RESOURCE_EVIDENCE_SUBMISSIONS_SUBCOLLECTION)
    .doc(RESOURCE_EVIDENCE_SUBMISSION_ID);
}

export function resourceEvidenceSubmissionDocRef(
  recordId: string,
): DocumentReference<ResourceEvidenceSubmissionRecord> {
  return submissionPath(recordId) as DocumentReference<ResourceEvidenceSubmissionRecord>;
}

export function resourceEvidenceSubmissionCreationDocRef(
  recordId: string,
): DocumentReference<ResourceEvidenceSubmissionCreationWrite> {
  return submissionPath(recordId) as DocumentReference<ResourceEvidenceSubmissionCreationWrite>;
}
