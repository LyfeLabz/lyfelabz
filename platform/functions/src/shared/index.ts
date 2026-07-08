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
  schoolDocRef,
  userDocRef,
  userRecordDocRef,
} from "./firestore/typed-ref";
export { log, type LogPayload } from "./logging/logger";
export {
  AUDIT_EVENTS_COLLECTION,
  type AuditAction,
  type AuditEventRecord,
  type AuditEventWrite,
  type AuditPayload,
  type AuditTargetType,
} from "./types/audit-event";
export { SCHOOLS_COLLECTION, type SchoolRecord } from "./types/school";
export {
  USERS_COLLECTION,
  type ConsentState,
  type Role,
  type StudentActivationWrite,
  type StudentProfile,
  type TeacherProfile,
  type UserProvisioningWrite,
  type UserRecord,
  type UserStatus,
} from "./types/user";
