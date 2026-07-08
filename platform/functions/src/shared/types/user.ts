import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export const USERS_COLLECTION = "users";

// Canonical role enumeration per Data Model §3.1. Reserved future values
// (parent, schoolAdministrator, districtAdministrator) are named in the
// data model but not yet writable and therefore not present in this union.
export type Role = "teacher" | "student" | "platformAdministrator";

// Canonical account lifecycle field per PLATFORM_STATE_MACHINE.md §1.
// This is the one lifecycle enumeration for the entire platform.
export type UserStatus =
  | "provisioned"
  | "pendingVerification"
  | "active"
  | "suspended"
  | "archived";

// Nested activation-scoped profile shapes are defined in later sprints.
// They are typed as opaque records here so that UserRecord can be the
// single source of truth for reads without pre-committing to fields the
// data model has not yet enumerated.
export type TeacherProfile = Record<string, unknown>;
export type StudentProfile = Record<string, unknown>;
export type ConsentState = Record<string, unknown>;

// Canonical user record shape per Data Model §3.1.
//
// Provisioning-required fields (always present): authUid, status, createdAt.
// Activation-required fields (present when status is active or
// pendingVerification; absent when status is provisioned): role, schoolId,
// displayName.
// Every other field is optional per the data model.
//
// This type is the single source of truth for reads of users/{uid}. Write
// shapes for specific transitions are declared separately so that
// FieldValue sentinels can be used at the write boundary.
export type UserRecord = {
  readonly authUid: string;
  readonly status: UserStatus;
  readonly createdAt: Timestamp;
  readonly role?: Role;
  readonly schoolId?: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly grade?: string;
  readonly teacherProfile?: TeacherProfile;
  readonly studentProfile?: StudentProfile;
  readonly consentState?: ConsentState;
};

// Write shape for the provisioning trigger authOnUserCreate. Conforms to
// Data Model §3.1: authUid, status, and createdAt are required; email and
// displayName may be populated from the Firebase Auth record per §3.1
// ("email ... may also be populated at provisioning from the Firebase Auth
// record").
export type UserProvisioningWrite = {
  readonly authUid: string;
  readonly status: "provisioned";
  readonly createdAt: FieldValue;
  readonly email?: string;
  readonly displayName?: string;
};
