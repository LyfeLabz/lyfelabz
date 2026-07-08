export {
  writeCustomClaims,
  type CanonicalCustomClaims,
  type WriteCustomClaimsInput,
} from "./auth/claims";
export { PlatformError } from "./errors/platform-error";
export { schoolDocRef, userDocRef } from "./firestore/typed-ref";
export { log, type LogPayload } from "./logging/logger";
export { SCHOOLS_COLLECTION, type SchoolRecord } from "./types/school";
export {
  USERS_COLLECTION,
  type ConsentState,
  type Role,
  type StudentProfile,
  type TeacherProfile,
  type UserProvisioningWrite,
  type UserRecord,
  type UserStatus,
} from "./types/user";
