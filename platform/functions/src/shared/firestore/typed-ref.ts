import type { CollectionReference, DocumentReference } from "firebase-admin/firestore";

import {
  ASSIGNMENTS_COLLECTION,
  type AssignmentArchiveWrite,
  type AssignmentCloseWrite,
  type AssignmentCreationWrite,
  type AssignmentDraftUpdateWrite,
  type AssignmentLmsPublicationWrite,
  type AssignmentPublishWrite,
  type AssignmentRecord,
} from "../types/assignment";
import {
  ASSIGNMENT_RECIPIENTS_SUBCOLLECTION,
  type AssignmentRecipientCreationWrite,
  type AssignmentRecipientRecord,
} from "../types/assignment-recipient";
import { AUDIT_EVENTS_COLLECTION, type AuditEventWrite } from "../types/audit-event";
import {
  CLASSES_COLLECTION,
  type ClassArchiveWrite,
  type ClassCreationWrite,
  type ClassLmsLinkWrite,
  type ClassMetadataUpdateWrite,
  type ClassRecord,
} from "../types/class";
import {
  LMS_ASSIGNMENT_PUBLICATIONS_COLLECTION,
  LMS_CLASS_LINKS_COLLECTION,
  LMS_CONNECTIONS_COLLECTION,
  LMS_PROVIDERS_COLLECTION,
  type LmsAssignmentPublicationCreationWrite,
  type LmsAssignmentPublicationRecord,
  type LmsClassLinkCreationWrite,
  type LmsClassLinkRecord,
  type LmsClassLinkBreakWrite,
  type LmsClassLinkUnlinkWrite,
  type LmsConnectionCreationWrite,
  type LmsConnectionRecord,
  type LmsConnectionRevocationWrite,
  type LmsProviderCreationWrite,
  type LmsProviderRecord,
} from "../types/lms";
import {
  ENROLLMENTS_COLLECTION,
  type EnrollmentCreationWrite,
  type EnrollmentRecord,
  type EnrollmentStatusChangeWrite,
} from "../types/enrollment";
import {
  SCHOOLS_COLLECTION,
  type SchoolCreationWrite,
  type SchoolRecord,
} from "../types/school";
import {
  SUBMISSIONS_COLLECTION,
  type SubmissionCreationWrite,
  type SubmissionFinalizationWrite,
  type SubmissionRecord,
} from "../types/submission";
import {
  ASSESSMENT_SESSIONS_COLLECTION,
  type AssessmentSessionAutosaveWrite,
  type AssessmentSessionCreationWrite,
  type AssessmentSessionRecord,
} from "../types/assessment-session";
import {
  ASSESSMENT_ANSWER_KEYS_COLLECTION,
  ASSESSMENT_REVISIONS_COLLECTION,
  ASSESSMENTS_COLLECTION,
  type AssessmentAnswerKeyDeploymentWrite,
  type AssessmentAnswerKeyRecord,
  type AssessmentDeploymentWrite,
  type AssessmentRecord,
  type AssessmentRevisionDeploymentWrite,
  type AssessmentRevisionRecord,
} from "../types/assessment";
import {
  ATTEMPTS_COLLECTION,
  type AssessmentAttemptCreationWrite,
  type AssessmentAttemptRecord,
} from "../types/attempt";
import {
  USERS_COLLECTION,
  type UserProvisioningWrite,
  type UserRecord,
} from "../types/user";
import { getAdminFirestore } from "./admin";

export function userDocRef(uid: string): DocumentReference<UserProvisioningWrite> {
  return getAdminFirestore()
    .collection(USERS_COLLECTION)
    .doc(uid) as DocumentReference<UserProvisioningWrite>;
}

// Read + activation-update typed reference for users/{uid}. Reads return a
// DocumentSnapshot<UserRecord> aligned with the amended Data Model §3.1
// read shape, and activation writes (studentsCompleteOnboarding and, later,
// teacher activation) update the same reference. `userDocRef` remains the
// provisioning-write reference used by authOnUserCreate.
export function userRecordDocRef(uid: string): DocumentReference<UserRecord> {
  return getAdminFirestore()
    .collection(USERS_COLLECTION)
    .doc(uid) as DocumentReference<UserRecord>;
}

export function schoolDocRef(schoolId: string): DocumentReference<SchoolRecord> {
  return getAdminFirestore()
    .collection(SCHOOLS_COLLECTION)
    .doc(schoolId) as DocumentReference<SchoolRecord>;
}

// Creation-write typed reference for schools/{schoolId}. The schoolsCreate
// callable uses this reference to `.set()` a canonical `SchoolCreationWrite`
// payload so that `FieldValue.serverTimestamp()` can be used at the write
// boundary while the read-side `schoolDocRef` remains typed as
// `SchoolRecord`.
export function schoolCreationDocRef(
  schoolId: string,
): DocumentReference<SchoolCreationWrite> {
  return getAdminFirestore()
    .collection(SCHOOLS_COLLECTION)
    .doc(schoolId) as DocumentReference<SchoolCreationWrite>;
}

// Collection-level typed reference for classes. Used by the
// enrollmentsJoinByCode callable to resolve a class by its (joinCode,
// schoolId) tuple without reaching through to the raw Firestore instance.
export function classesCollectionRef(): CollectionReference<ClassRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION) as CollectionReference<ClassRecord>;
}

// Read typed reference for classes/{classId}. Reads return a
// DocumentSnapshot<ClassRecord> aligned with the canonical Data Model §3.3
// read shape. Callers that need to perform a metadata update or an archive
// transition use `classMetadataUpdateDocRef` or `classArchiveDocRef`
// respectively so that FieldValue-safe write shapes are preserved at the
// write boundary.
export function classDocRef(classId: string): DocumentReference<ClassRecord> {
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION)
    .doc(classId) as DocumentReference<ClassRecord>;
}

// Creation-write typed reference for classes/{classId}. The classesCreate
// callable uses this reference to `.set()` a canonical `ClassCreationWrite`
// payload so that `FieldValue.serverTimestamp()` can be used at the write
// boundary while the read-side `classDocRef` remains typed as
// `ClassRecord`.
export function classCreationDocRef(
  classId: string,
): DocumentReference<ClassCreationWrite> {
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION)
    .doc(classId) as DocumentReference<ClassCreationWrite>;
}

// Metadata-update typed reference for classes/{classId}. The
// classesUpdateMetadata callable uses this reference to `.update()` a
// narrow `ClassMetadataUpdateWrite` payload. Ownership fields, joinCode,
// status, and createdAt are absent from the write shape so no metadata
// update can silently reassign ownership, rotate the join code, or drive
// the lifecycle field.
export function classMetadataUpdateDocRef(
  classId: string,
): DocumentReference<ClassMetadataUpdateWrite> {
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION)
    .doc(classId);
}

// Archive-write typed reference for classes/{classId}. The classesArchive
// callable uses this reference to `.update()` a narrow `ClassArchiveWrite`
// payload that advances the lifecycle field from `active` to `archived`
// and modifies no other field.
export function classArchiveDocRef(
  classId: string,
): DocumentReference<ClassArchiveWrite> {
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION)
    .doc(classId) as DocumentReference<ClassArchiveWrite>;
}

// Audit-event document IDs are opaque and system-generated per Data Model
// §5.1, so the canonical shared reference is at the collection level.
export function auditEventsCollectionRef(): CollectionReference<AuditEventWrite> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(AUDIT_EVENTS_COLLECTION) as CollectionReference<AuditEventWrite>;
}

// Read typed reference for enrollments/{enrollmentId}. Reads return a
// DocumentSnapshot<EnrollmentRecord> aligned with the canonical Data Model
// §3.4 read shape. Callers that need to perform a creation write or a
// status transition use `enrollmentCreationDocRef` or
// `enrollmentStatusChangeDocRef` respectively so that FieldValue-safe write
// shapes are preserved at the write boundary.
export function enrollmentDocRef(
  enrollmentId: string,
): DocumentReference<EnrollmentRecord> {
  return getAdminFirestore()
    .collection(ENROLLMENTS_COLLECTION)
    .doc(enrollmentId) as DocumentReference<EnrollmentRecord>;
}

// Creation-write typed reference for enrollments/{enrollmentId}. The
// enrollmentsJoinByCode and enrollmentsTeacherAdd callables use this
// reference to `.set()` a canonical `EnrollmentCreationWrite` payload so
// that `FieldValue.serverTimestamp()` can be used at the write boundary
// while the read-side `enrollmentDocRef` remains typed as
// `EnrollmentRecord`.
export function enrollmentCreationDocRef(
  enrollmentId: string,
): DocumentReference<EnrollmentCreationWrite> {
  return getAdminFirestore()
    .collection(ENROLLMENTS_COLLECTION)
    .doc(enrollmentId) as DocumentReference<EnrollmentCreationWrite>;
}

// Status-change typed reference for enrollments/{enrollmentId}. The
// enrollmentsSetStatus callable uses this reference to `.update()` a narrow
// `EnrollmentStatusChangeWrite` payload. Ownership fields (studentId,
// classId, schoolId) and enrolledAt are absent from the write shape so no
// status transition can silently reassign ownership or overwrite the
// creation timestamp.
export function enrollmentStatusChangeDocRef(
  enrollmentId: string,
): DocumentReference<EnrollmentStatusChangeWrite> {
  return getAdminFirestore()
    .collection(ENROLLMENTS_COLLECTION)
    .doc(enrollmentId) as DocumentReference<EnrollmentStatusChangeWrite>;
}

// Collection-level typed reference for enrollments. Used by the
// join-by-code and teacher-add callables to look up an existing (studentId,
// classId) enrollment by indexed query for idempotency, and by the
// join-by-code callable to look up a class by joinCode.
export function enrollmentsCollectionRef(): CollectionReference<EnrollmentRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(ENROLLMENTS_COLLECTION) as CollectionReference<EnrollmentRecord>;
}

// Collection-level typed reference for assignments. Reserved for future
// Sprint 4D admin scans; not used by the current callable set but exported
// alongside the record-level references for symmetry with the other domains.
export function assignmentsCollectionRef(): CollectionReference<AssignmentRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION) as CollectionReference<AssignmentRecord>;
}

// Read typed reference for assignments/{assignmentId}. Reads return a
// DocumentSnapshot<AssignmentRecord> aligned with the canonical Data Model
// §3.6 read shape. Callers that need to perform a creation write, a draft
// update, or a lifecycle transition use the narrow write references below
// so that FieldValue-safe write shapes are preserved at the write boundary.
export function assignmentDocRef(
  assignmentId: string,
): DocumentReference<AssignmentRecord> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentRecord>;
}

// Creation-write typed reference for assignments/{assignmentId}. The
// assignmentsCreateDraft callable uses this reference to `.set()` a
// canonical `AssignmentCreationWrite` payload so that
// `FieldValue.serverTimestamp()` can be used at the write boundary while
// the read-side `assignmentDocRef` remains typed as `AssignmentRecord`.
export function assignmentCreationDocRef(
  assignmentId: string,
): DocumentReference<AssignmentCreationWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentCreationWrite>;
}

// Draft-update typed reference for assignments/{assignmentId}. The
// assignmentsUpdateDraft callable uses this reference to `.update()` a
// narrow `AssignmentDraftUpdateWrite` payload. Ownership fields
// (classId, teacherId, schoolId), `status`, and `createdAt` are absent
// from the write shape so no draft update can silently reassign ownership
// or drive the lifecycle field.
export function assignmentDraftUpdateDocRef(
  assignmentId: string,
): DocumentReference<AssignmentDraftUpdateWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId);
}

// Publish-write typed reference for assignments/{assignmentId}. The
// assignmentsPublish callable uses this reference to `.update()` a narrow
// `AssignmentPublishWrite` payload that advances the lifecycle field from
// `draft` to `published` and modifies no other field.
export function assignmentPublishDocRef(
  assignmentId: string,
): DocumentReference<AssignmentPublishWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentPublishWrite>;
}

// Close-write typed reference for assignments/{assignmentId}. The
// assignmentsClose callable uses this reference to `.update()` a narrow
// `AssignmentCloseWrite` payload that advances the lifecycle field from
// `published` to `closed` and modifies no other field.
export function assignmentCloseDocRef(
  assignmentId: string,
): DocumentReference<AssignmentCloseWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentCloseWrite>;
}

// Archive-write typed reference for assignments/{assignmentId}. The
// assignmentsArchive callable uses this reference to `.update()` a narrow
// `AssignmentArchiveWrite` payload that advances the lifecycle field to
// the terminal `archived` state and modifies no other field.
export function assignmentArchiveDocRef(
  assignmentId: string,
): DocumentReference<AssignmentArchiveWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentArchiveWrite>;
}

// Collection-level typed reference for the assignment-recipient
// subcollection at `assignments/{assignmentId}/recipients`. Reads return a
// CollectionReference<AssignmentRecipientRecord> aligned with the canonical
// PDR-029h read shape. The subcollection lives inside the assignment
// ownership boundary; the recipient document identifier is the canonical
// `studentId` so exactly one recipient exists per (assignmentId, studentId)
// pair by construction.
export function assignmentRecipientsCollectionRef(
  assignmentId: string,
): CollectionReference<AssignmentRecipientRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId)
    .collection(ASSIGNMENT_RECIPIENTS_SUBCOLLECTION) as CollectionReference<AssignmentRecipientRecord>;
}

// Read typed reference for
// `assignments/{assignmentId}/recipients/{studentId}`. Reads return a
// DocumentSnapshot<AssignmentRecipientRecord> aligned with the canonical
// PDR-029h read shape. Callers that need to perform the creation write use
// the narrow write reference below so that FieldValue-safe write shapes are
// preserved at the write boundary.
export function assignmentRecipientDocRef(
  assignmentId: string,
  studentId: string,
): DocumentReference<AssignmentRecipientRecord> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId)
    .collection(ASSIGNMENT_RECIPIENTS_SUBCOLLECTION)
    .doc(studentId) as DocumentReference<AssignmentRecipientRecord>;
}

// Creation-write typed reference for
// `assignments/{assignmentId}/recipients/{studentId}`. The initial-snapshot
// path inside `assignmentsPublish` and the late-recipient callable
// `assignmentsRecipientAdd` both use this reference to `.set()` (or add to
// a batch) a canonical `AssignmentRecipientCreationWrite` payload so that
// `FieldValue.serverTimestamp()` can be used at the write boundary while
// the read-side reference remains typed as `AssignmentRecipientRecord`.
export function assignmentRecipientCreationDocRef(
  assignmentId: string,
  studentId: string,
): DocumentReference<AssignmentRecipientCreationWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId)
    .collection(ASSIGNMENT_RECIPIENTS_SUBCOLLECTION)
    .doc(studentId) as DocumentReference<AssignmentRecipientCreationWrite>;
}

// LMS-publication-ref write reference for assignments/{assignmentId}. The
// lmsAssignmentsPublish callable uses this reference to `.update()` a
// narrow `AssignmentLmsPublicationWrite` payload that carries only the
// additive `lmsPublicationRef` mirror pointer. Ownership fields,
// lifecycle field, lesson fields, and every other assignment field are
// absent from the write shape so an LMS publication side effect can
// never launder into an ownership reassignment or a content edit
// (PDR-019d).
export function assignmentLmsPublicationDocRef(
  assignmentId: string,
): DocumentReference<AssignmentLmsPublicationWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentLmsPublicationWrite>;
}

// Collection-level typed reference for submissions. Reserved for future
// admin scans and rollup jobs; not used by the current callable set but
// exported alongside the record-level references for symmetry with the
// other domains.
export function submissionsCollectionRef(): CollectionReference<SubmissionRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(SUBMISSIONS_COLLECTION) as CollectionReference<SubmissionRecord>;
}

// Read typed reference for submissions/{submissionId}. Reads return a
// DocumentSnapshot<SubmissionRecord> aligned with the canonical Data Model
// §3.7 read shape. Callers that need to perform a creation write or a
// finalization transition use the narrow write references below so that
// FieldValue-safe write shapes are preserved at the write boundary.
export function submissionDocRef(
  submissionId: string,
): DocumentReference<SubmissionRecord> {
  return getAdminFirestore()
    .collection(SUBMISSIONS_COLLECTION)
    .doc(submissionId) as DocumentReference<SubmissionRecord>;
}

// Creation-write typed reference for submissions/{submissionId}. The
// submissionsCreate callable uses this reference to `.set()` a canonical
// `SubmissionCreationWrite` payload so that `FieldValue.serverTimestamp()`
// can be used at the write boundary while the read-side `submissionDocRef`
// remains typed as `SubmissionRecord`.
export function submissionCreationDocRef(
  submissionId: string,
): DocumentReference<SubmissionCreationWrite> {
  return getAdminFirestore()
    .collection(SUBMISSIONS_COLLECTION)
    .doc(submissionId) as DocumentReference<SubmissionCreationWrite>;
}

// Finalization-write typed reference for submissions/{submissionId}. The
// submissionsFinalize callable uses this reference to `.update()` a narrow
// `SubmissionFinalizationWrite` payload that advances the lifecycle field
// from `submitted` to `finalized` and stamps `submittedAt`. Ownership
// fields, `startedAt`, `assignmentId`, `studentId`, `lessonSlug`, and
// `lessonVersion` are absent from the write shape so no finalization can
// silently reassign ownership, backdate the start moment, or edit the
// frozen lesson version.
export function submissionFinalizationDocRef(
  submissionId: string,
): DocumentReference<SubmissionFinalizationWrite> {
  return getAdminFirestore()
    .collection(SUBMISSIONS_COLLECTION)
    .doc(submissionId) as DocumentReference<SubmissionFinalizationWrite>;
}

// -------------------- Assessment pipeline references --------------------
//
// Typed Firestore references for the assessment pipeline foundation
// introduced in Sprint 11C Slice 1. This slice defines only the
// assessmentSessions/{sessionId} read reference and the paired creation
// write reference used by `assessmentSessionsBegin`. Autosave, sweep,
// recover, purge, and attempt-finalize references are deferred to later
// slices per ASSESSMENT_IMPLEMENTATION_CONTRACT.md §11 and §21.

export function assessmentSessionsCollectionRef(): CollectionReference<AssessmentSessionRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(ASSESSMENT_SESSIONS_COLLECTION) as CollectionReference<AssessmentSessionRecord>;
}

// Read typed reference for assessmentSessions/{sessionId}. Reads return a
// DocumentSnapshot<AssessmentSessionRecord> aligned with the canonical
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6 read shape. Callers that need
// to perform a creation write use `assessmentSessionCreationDocRef` so that
// FieldValue-safe write shapes are preserved at the write boundary.
export function assessmentSessionDocRef(
  sessionId: string,
): DocumentReference<AssessmentSessionRecord> {
  return getAdminFirestore()
    .collection(ASSESSMENT_SESSIONS_COLLECTION)
    .doc(sessionId) as DocumentReference<AssessmentSessionRecord>;
}

// Creation-write typed reference for assessmentSessions/{sessionId}. The
// assessmentSessionsBegin callable uses this reference to `.set()` a
// canonical `AssessmentSessionCreationWrite` payload so that
// `FieldValue.serverTimestamp()` can be used at the write boundary while
// the read-side `assessmentSessionDocRef` remains typed as
// `AssessmentSessionRecord`.
export function assessmentSessionCreationDocRef(
  sessionId: string,
): DocumentReference<AssessmentSessionCreationWrite> {
  return getAdminFirestore()
    .collection(ASSESSMENT_SESSIONS_COLLECTION)
    .doc(sessionId) as DocumentReference<AssessmentSessionCreationWrite>;
}

// Autosave-write typed reference for assessmentSessions/{sessionId}. The
// assessmentSessionsAutosave callable uses this reference to `.update()` a
// narrow `AssessmentSessionAutosaveWrite` payload that carries only the
// mutable `responses` and `lastActivityAt` fields per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6 and §14. Ownership fields,
// `sessionOrdinal`, `status`, and `startedAt` are absent from the write
// shape so no autosave can silently reassign ownership, advance the
// lifecycle, or backdate the start moment. Scoring artifacts are
// structurally excluded from the write shape.
export function assessmentSessionAutosaveDocRef(
  sessionId: string,
): DocumentReference<AssessmentSessionAutosaveWrite> {
  return getAdminFirestore()
    .collection(ASSESSMENT_SESSIONS_COLLECTION)
    .doc(sessionId) as DocumentReference<AssessmentSessionAutosaveWrite>;
}

// -------------------- Assessment content references --------------------
//
// Typed Firestore references for the deployment-pipeline-owned assessment
// content surfaces per ASSESSMENT_IMPLEMENTATION_CONTRACT.md §11 and
// ASSESSMENT_SCORING_CONTRACT.md §4, §5, §13. Only the scorer inside
// `assessmentAttemptsFinalize` reads `assessmentAnswerKeys/*` at request
// time (PDR-026d). No callable in this slice writes to any of these
// collections; the read references exist so the scorer can resolve the
// paired revision and answer-key documents from the session's frozen
// `assessmentRevisionId`.

export function assessmentDocRef(
  assessmentId: string,
): DocumentReference<AssessmentRecord> {
  return getAdminFirestore()
    .collection(ASSESSMENTS_COLLECTION)
    .doc(assessmentId) as DocumentReference<AssessmentRecord>;
}

export function assessmentRevisionDocRef(
  revisionId: string,
): DocumentReference<AssessmentRevisionRecord> {
  return getAdminFirestore()
    .collection(ASSESSMENT_REVISIONS_COLLECTION)
    .doc(revisionId) as DocumentReference<AssessmentRevisionRecord>;
}

export function assessmentAnswerKeyDocRef(
  revisionId: string,
): DocumentReference<AssessmentAnswerKeyRecord> {
  return getAdminFirestore()
    .collection(ASSESSMENT_ANSWER_KEYS_COLLECTION)
    .doc(revisionId) as DocumentReference<AssessmentAnswerKeyRecord>;
}

// Deployment-write typed references for the deployment-pipeline-owned
// assessment content surfaces per ASSESSMENT_IMPLEMENTATION_CONTRACT.md §11
// and ASSESSMENT_SCORING_CONTRACT.md §13. Sole writer is the deployment
// pipeline entry point; no callable in the pipeline mutates these
// collections outside deployment. The narrow-write shapes keep
// FieldValue-safe sentinels at the write boundary while the read-side
// references remain typed as the immutable record shapes.

export function assessmentDeploymentDocRef(
  assessmentId: string,
): DocumentReference<AssessmentDeploymentWrite> {
  return getAdminFirestore()
    .collection(ASSESSMENTS_COLLECTION)
    .doc(assessmentId) as DocumentReference<AssessmentDeploymentWrite>;
}

export function assessmentRevisionDeploymentDocRef(
  revisionId: string,
): DocumentReference<AssessmentRevisionDeploymentWrite> {
  return getAdminFirestore()
    .collection(ASSESSMENT_REVISIONS_COLLECTION)
    .doc(revisionId) as DocumentReference<AssessmentRevisionDeploymentWrite>;
}

export function assessmentAnswerKeyDeploymentDocRef(
  revisionId: string,
): DocumentReference<AssessmentAnswerKeyDeploymentWrite> {
  return getAdminFirestore()
    .collection(ASSESSMENT_ANSWER_KEYS_COLLECTION)
    .doc(revisionId) as DocumentReference<AssessmentAnswerKeyDeploymentWrite>;
}

// -------------------- Assessment attempt references --------------------
//
// Typed Firestore references for the immutable authoritative attempt
// record per ASSESSMENT_IMPLEMENTATION_CONTRACT.md §7, §11, §21.
// `assessmentAttemptsFinalize` is the sole writer of `attempts/*`. The
// creation reference is separate from the read reference so the write
// shape (`AssessmentAttemptCreationWrite`, which types `submittedAt` as
// `FieldValue`) is enforced at the write boundary while the read shape
// (`AssessmentAttemptRecord`) remains authoritative for downstream
// consumers.

export function attemptsCollectionRef(): CollectionReference<AssessmentAttemptRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(ATTEMPTS_COLLECTION) as CollectionReference<AssessmentAttemptRecord>;
}

export function attemptDocRef(
  attemptId: string,
): DocumentReference<AssessmentAttemptRecord> {
  return getAdminFirestore()
    .collection(ATTEMPTS_COLLECTION)
    .doc(attemptId) as DocumentReference<AssessmentAttemptRecord>;
}

export function attemptCreationDocRef(
  attemptId: string,
): DocumentReference<AssessmentAttemptCreationWrite> {
  return getAdminFirestore()
    .collection(ATTEMPTS_COLLECTION)
    .doc(attemptId) as DocumentReference<AssessmentAttemptCreationWrite>;
}

// -------------------- LMS integration references --------------------
//
// Typed Firestore references for the LMS Integration Foundation. Reads
// and writes follow the same narrow-write pattern as the certified
// domains: reads return record-typed snapshots, writes are performed
// through narrower FieldValue-safe references that never widen the field
// set beyond what the callable is authorized to write.

export function lmsProvidersCollectionRef(): CollectionReference<LmsProviderRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(LMS_PROVIDERS_COLLECTION) as CollectionReference<LmsProviderRecord>;
}

export function lmsProviderDocRef(
  providerId: string,
): DocumentReference<LmsProviderRecord> {
  return getAdminFirestore()
    .collection(LMS_PROVIDERS_COLLECTION)
    .doc(providerId) as DocumentReference<LmsProviderRecord>;
}

export function lmsProviderCreationDocRef(
  providerId: string,
): DocumentReference<LmsProviderCreationWrite> {
  return getAdminFirestore()
    .collection(LMS_PROVIDERS_COLLECTION)
    .doc(providerId) as DocumentReference<LmsProviderCreationWrite>;
}

export function lmsConnectionsCollectionRef(): CollectionReference<LmsConnectionRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(LMS_CONNECTIONS_COLLECTION) as CollectionReference<LmsConnectionRecord>;
}

export function lmsConnectionDocRef(
  connectionId: string,
): DocumentReference<LmsConnectionRecord> {
  return getAdminFirestore()
    .collection(LMS_CONNECTIONS_COLLECTION)
    .doc(connectionId) as DocumentReference<LmsConnectionRecord>;
}

export function lmsConnectionCreationDocRef(
  connectionId: string,
): DocumentReference<LmsConnectionCreationWrite> {
  return getAdminFirestore()
    .collection(LMS_CONNECTIONS_COLLECTION)
    .doc(connectionId) as DocumentReference<LmsConnectionCreationWrite>;
}

export function lmsConnectionRevocationDocRef(
  connectionId: string,
): DocumentReference<LmsConnectionRevocationWrite> {
  return getAdminFirestore()
    .collection(LMS_CONNECTIONS_COLLECTION)
    .doc(connectionId) as DocumentReference<LmsConnectionRevocationWrite>;
}

export function lmsClassLinksCollectionRef(): CollectionReference<LmsClassLinkRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(LMS_CLASS_LINKS_COLLECTION) as CollectionReference<LmsClassLinkRecord>;
}

export function lmsClassLinkDocRef(
  linkId: string,
): DocumentReference<LmsClassLinkRecord> {
  return getAdminFirestore()
    .collection(LMS_CLASS_LINKS_COLLECTION)
    .doc(linkId) as DocumentReference<LmsClassLinkRecord>;
}

export function lmsClassLinkCreationDocRef(
  linkId: string,
): DocumentReference<LmsClassLinkCreationWrite> {
  return getAdminFirestore()
    .collection(LMS_CLASS_LINKS_COLLECTION)
    .doc(linkId) as DocumentReference<LmsClassLinkCreationWrite>;
}

export function lmsClassLinkUnlinkDocRef(
  linkId: string,
): DocumentReference<LmsClassLinkUnlinkWrite> {
  return getAdminFirestore()
    .collection(LMS_CLASS_LINKS_COLLECTION)
    .doc(linkId) as DocumentReference<LmsClassLinkUnlinkWrite>;
}

// Narrow reconciliation-only write reference for lmsClassLinks/{linkId}.
// The Sprint 8E reconciliation callable is the only writer of this
// reference. See LmsClassLinkBreakWrite for the write shape.
export function lmsClassLinkBreakDocRef(
  linkId: string,
): DocumentReference<LmsClassLinkBreakWrite> {
  return getAdminFirestore()
    .collection(LMS_CLASS_LINKS_COLLECTION)
    .doc(linkId) as DocumentReference<LmsClassLinkBreakWrite>;
}

export function lmsAssignmentPublicationsCollectionRef(): CollectionReference<LmsAssignmentPublicationRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS requires the CollectionReference<T> cast even though eslint sees the receiver as compatible; the Admin SDK's .collection() returns CollectionReference<DocumentData>.
  return getAdminFirestore()
    .collection(
      LMS_ASSIGNMENT_PUBLICATIONS_COLLECTION,
    ) as CollectionReference<LmsAssignmentPublicationRecord>;
}

export function lmsAssignmentPublicationDocRef(
  publicationId: string,
): DocumentReference<LmsAssignmentPublicationRecord> {
  return getAdminFirestore()
    .collection(LMS_ASSIGNMENT_PUBLICATIONS_COLLECTION)
    .doc(publicationId) as DocumentReference<LmsAssignmentPublicationRecord>;
}

export function lmsAssignmentPublicationCreationDocRef(
  publicationId: string,
): DocumentReference<LmsAssignmentPublicationCreationWrite> {
  return getAdminFirestore()
    .collection(LMS_ASSIGNMENT_PUBLICATIONS_COLLECTION)
    .doc(
      publicationId,
    ) as DocumentReference<LmsAssignmentPublicationCreationWrite>;
}

// Narrow LMS-link write reference for classes/{classId}. The class-import
// callable uses this reference to `.update()` a `ClassLmsLinkWrite`
// payload that carries only the additive enrollment-source fields.
// Ownership, lifecycle, joinCode, and metadata fields are absent from the
// write shape so an LMS import can never launder into an ownership
// reassignment or a metadata edit (PDR-019i, PDR-019j).
export function classLmsLinkDocRef(
  classId: string,
): DocumentReference<ClassLmsLinkWrite> {
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION)
    .doc(classId) as DocumentReference<ClassLmsLinkWrite>;
}
