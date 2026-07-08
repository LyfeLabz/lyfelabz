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

// Write shape for the teacher verification-request callable
// (teachersRequestVerification). Conforms to Data Model §3.1: the
// activation-required fields (role, schoolId, displayName) become required
// on the transition out of `provisioned`, and `status` moves to
// `pendingVerification` per the transition table in
// PLATFORM_STATE_MACHINE.md §3. Custom claims are intentionally not
// issued at this step; the teacher only becomes claim-bearing after
// administrative approval in a later step.
export type TeacherVerificationRequestWrite = {
  readonly role: "teacher";
  readonly schoolId: string;
  readonly displayName: string;
  readonly status: "pendingVerification";
};

// Write shape for the teacher-approval callable
// (teachersApproveVerification). Conforms to Data Model §3.1: the
// activation-required fields are already present on the record (they were
// written by teachersRequestVerification), so approval only advances
// `status` from `pendingVerification` to `active` per the transition
// table in PLATFORM_STATE_MACHINE.md §3. Custom claims are issued
// alongside this write via the canonical claims helper.
export type TeacherApprovalWrite = {
  readonly status: "active";
};

// Write shape for the teacher-denial callable
// (teachersDenyVerification). Conforms to Data Model §3.1: the target
// returns to `provisioned` per the transition table in
// PLATFORM_STATE_MACHINE.md §3, and the activation-required fields
// (role, schoolId, displayName) that were recorded on the transition into
// `pendingVerification` are cleared with the `FieldValue.delete()`
// sentinel so the record matches the canonical `provisioned` shape.
export type TeacherDenialWrite = {
  readonly status: "provisioned";
  readonly role: FieldValue;
  readonly schoolId: FieldValue;
  readonly displayName: FieldValue;
};

// Write shape for the student onboarding callable
// (studentsCompleteOnboarding). Conforms to Data Model §3.1: the
// activation-required fields (role, schoolId, displayName) become required
// on the transition out of `provisioned`, and `status` moves to `active`
// per the transition table in PLATFORM_STATE_MACHINE.md §3. Every field is
// a plain scalar because activation writes carry no FieldValue sentinels.
export type StudentActivationWrite = {
  readonly role: "student";
  readonly schoolId: string;
  readonly displayName: string;
  readonly status: "active";
};
