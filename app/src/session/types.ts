// Canonical Session Object types for the /app/** client bundle.
//
// The Session union is the sole enumeration of client-side session states
// derived by the Canonical Session Bootstrap. Every route surface consumes
// this union. No other module re-declares these kinds.
//
// The client mirrors, but does not import from, the canonical UserRecord
// shape defined in platform/functions/src/shared/types/user.ts. Cross-
// package imports are out of scope for Sprint 3 per Step 3 spec §2.

export type Role = "teacher" | "student" | "platformAdministrator";

export type UserStatus =
  | "provisioned"
  | "pendingVerification"
  | "active"
  | "suspended"
  | "archived";

// Narrow read-shape of users/{uid} consumed by the bootstrap. Fields the
// bootstrap does not consume (authUid, createdAt, grade, teacherProfile,
// studentProfile, consentState) are omitted. See Step 3 spec §7.
export type UserRecordRead = {
  readonly status: UserStatus;
  readonly role?: Role;
  readonly schoolId?: string;
  readonly displayName?: string;
  readonly email?: string;
};

export type ErrorReason =
  | "authInitFailed"
  | "userRecordUnreadable"
  | "userRecordMissing"
  | "recordShapeInvalid"
  | "networkUnavailable";

export type Session =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "provisioned"; readonly uid: string; readonly email?: string }
  | {
      readonly kind: "pendingVerification";
      readonly uid: string;
      readonly schoolId: string;
      readonly displayName: string;
    }
  | {
      readonly kind: "activeTeacher";
      readonly uid: string;
      readonly schoolId: string;
      readonly displayName: string;
    }
  | {
      readonly kind: "activeStudent";
      readonly uid: string;
      readonly schoolId: string;
      readonly displayName: string;
    }
  | {
      readonly kind: "activeAdministrator";
      readonly uid: string;
      readonly schoolId: string;
      readonly displayName: string;
    }
  | { readonly kind: "suspendedUser"; readonly uid: string }
  | { readonly kind: "archivedUser"; readonly uid: string }
  | { readonly kind: "error"; readonly reason: ErrorReason };

export type SessionKind = Session["kind"];

// Canonical claim shape per Cloud Function Charter §2. The bootstrap
// tolerates unknown extra keys but consumes only these two.
export type CanonicalClaims = {
  readonly role?: Role;
  readonly schoolId?: string;
};

// Narrow interfaces the bootstrap depends on. Real implementations wrap
// the Firebase modular SDK; unit tests inject in-memory fakes. Isolating
// these seams is the mechanism that keeps unit tests SDK-free.
export interface BootstrapAuthUser {
  readonly uid: string;
  readonly email: string | null;
  getIdTokenResult(forceRefresh?: boolean): Promise<{
    readonly claims: Readonly<Record<string, unknown>>;
  }>;
}

export interface BootstrapAuthInput {
  waitForAuthState(): Promise<BootstrapAuthUser | null>;
}

export interface BootstrapUserSnapshot {
  readonly exists: boolean;
  data(): unknown;
}

export interface BootstrapFirestoreInput {
  getUser(uid: string): Promise<BootstrapUserSnapshot>;
}

export interface BootstrapEnv {
  readonly isOnline: () => boolean;
}
