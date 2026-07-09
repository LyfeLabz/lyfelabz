export {
  writeAuditEvent,
  type WriteAuditEventInput,
  type WriteAuditEventResult,
} from "./audit/write-audit-event";
export {
  writeCustomClaims,
  type CanonicalCustomClaims,
  type WriteCustomClaimsInput,
} from "./auth/claims";
export { PlatformError } from "./errors/platform-error";
export {
  auditEventsCollectionRef,
  classArchiveDocRef,
  classCreationDocRef,
  classDocRef,
  classMetadataUpdateDocRef,
  classesCollectionRef,
  enrollmentCreationDocRef,
  enrollmentDocRef,
  enrollmentStatusChangeDocRef,
  enrollmentsCollectionRef,
  schoolCreationDocRef,
  schoolDocRef,
  userDocRef,
  userRecordDocRef,
} from "./firestore/typed-ref";
export { log, type LogPayload } from "./logging/logger";
export {
  AUDIT_EVENTS_COLLECTION,
  type ActorRole,
  type AuditAction,
  type AuditEventRecord,
  type AuditEventWrite,
  type AuditPayload,
  type AuditTargetType,
} from "./types/audit-event";
export {
  CLASSES_COLLECTION,
  type ClassArchiveWrite,
  type ClassCreationWrite,
  type ClassMetadataUpdateWrite,
  type ClassRecord,
  type ClassStatus,
} from "./types/class";
export {
  ENROLLMENTS_COLLECTION,
  type EnrollmentCreationWrite,
  type EnrollmentRecord,
  type EnrollmentStatus,
  type EnrollmentStatusChangeWrite,
} from "./types/enrollment";
export {
  SCHOOLS_COLLECTION,
  type SchoolCreationWrite,
  type SchoolRecord,
} from "./types/school";
export {
  USERS_COLLECTION,
  type ConsentState,
  type Role,
  type StudentActivationWrite,
  type StudentProfile,
  type TeacherApprovalWrite,
  type TeacherDenialWrite,
  type TeacherProfile,
  type TeacherVerificationRequestWrite,
  type UserProvisioningWrite,
  type UserRecord,
  type UserStatus,
} from "./types/user";
