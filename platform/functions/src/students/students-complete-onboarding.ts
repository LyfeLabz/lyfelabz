import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  log,
  schoolDocRef,
  userRecordDocRef,
  writeAuditEvent,
  writeCustomClaims,
  type StudentActivationWrite,
  type UserRecord,
} from "../shared";

// Client-supplied request payload for studentsCompleteOnboarding. The role
// is carried on the payload as an explicit self-declaration so this
// callable never silently activates a caller who intended a different role.
// The activation-required fields (role, schoolId, displayName) mirror the
// amended Data Model §3.1 activation-required set.
export type StudentsCompleteOnboardingRequest = {
  readonly role: "student";
  readonly schoolId: string;
  readonly displayName: string;
};

// Return payload of a successful onboarding call. `alreadyActive` is `true`
// when the call is a no-op idempotent replay of a previously successful
// activation, and `false` when this call performed the `provisioned` ->
// `active` transition.
export type StudentsCompleteOnboardingResponse = {
  readonly uid: string;
  readonly status: "active";
  readonly role: "student";
  readonly schoolId: string;
  readonly alreadyActive: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertAuthenticated(
  request: CallableRequest<unknown>,
): { readonly uid: string } {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throw new PlatformError(
      "students.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  return { uid: auth.uid };
}

function validateRequest(
  data: unknown,
): StudentsCompleteOnboardingRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "students.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  if (payload.role !== "student") {
    throw new PlatformError(
      "students.invalidRole",
      'role must be "student".',
    );
  }
  if (!isNonEmptyString(payload.schoolId)) {
    throw new PlatformError(
      "students.invalidSchoolId",
      "schoolId must be a non-empty string.",
    );
  }
  if (!isNonEmptyString(payload.displayName)) {
    throw new PlatformError(
      "students.invalidDisplayName",
      "displayName must be a non-empty string.",
    );
  }
  return {
    role: "student",
    schoolId: payload.schoolId.trim(),
    displayName: payload.displayName.trim(),
  };
}

async function loadUserRecord(uid: string): Promise<UserRecord> {
  const snapshot = await userRecordDocRef(uid).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "students.userNotFound",
      "User record was not found for the authenticated caller.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "students.userNotFound",
      "User record was empty for the authenticated caller.",
    );
  }
  return data;
}

async function resolveSchoolDistrictId(schoolId: string): Promise<string> {
  const snapshot = await schoolDocRef(schoolId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "students.schoolNotFound",
      "Referenced school does not exist.",
    );
  }
  const school = snapshot.data() as
    | (Record<string, unknown> & { districtId?: unknown })
    | undefined;
  if (!school) {
    throw new PlatformError(
      "school-district-mismatch",
      "The referenced school record was unreadable.",
    );
  }
  const districtId = school.districtId;
  if (typeof districtId !== "string" || districtId.trim().length === 0) {
    throw new PlatformError(
      "district-unassigned",
      "The referenced school is not assigned to a district.",
    );
  }
  return districtId;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle. A logger failure after the
    // Firestore write has succeeded (or after a failure is already being
    // rethrown) must never itself become the outcome of the callable.
  }
}

// studentsCompleteOnboarding
//
// Canonical transition `provisioned` -> `active` for students, per the
// transition table in PLATFORM_STATE_MACHINE.md §3.
//
// Every side effect flows through the canonical shared helpers:
//   - user record read via `userRecordDocRef(uid).get()`         (typed ref)
//   - school record read via `schoolDocRef(schoolId).get()`      (typed ref)
//   - activation update via `userRecordDocRef(uid).update(...)`  (typed ref)
//   - custom claims via `writeCustomClaims({...})`               (§4 helper)
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// The callable never touches `setCustomUserClaims` directly, never adds an
// `auditEvents` document directly, and never reaches Firestore through
// `getAdminFirestore()` without going through a typed-ref builder.
//
// Idempotency: a caller who is already `active` with the same role and
// schoolId receives a success response with `alreadyActive: true`. No
// second update is performed, no second claims write is performed, and no
// second `students.activated` audit event is emitted. The state on the
// user document, the identity token claims, and the audit stream are all
// unchanged.
async function studentsCompleteOnboardingHandler(
  request: CallableRequest<unknown>,
): Promise<StudentsCompleteOnboardingResponse> {
  const { uid } = assertAuthenticated(request);
  const input = validateRequest(request.data);

  const user = await loadUserRecord(uid);

  if (
    user.status === "active" &&
    user.role === "student" &&
    user.schoolId === input.schoolId
  ) {
    safeLog(() =>
      log.info("students.onboardingIdempotent", {
        uid,
        schoolId: input.schoolId,
      }),
    );
    return {
      uid,
      status: "active",
      role: "student",
      schoolId: input.schoolId,
      alreadyActive: true,
    };
  }

  if (user.status !== "provisioned") {
    throw new PlatformError(
      "students.invalidStatus",
      `Onboarding requires status "provisioned" (current: "${user.status}").`,
    );
  }

  const districtId = await resolveSchoolDistrictId(input.schoolId);

  const activation: StudentActivationWrite = {
    role: "student",
    schoolId: input.schoolId,
    displayName: input.displayName,
    status: "active",
  };

  await userRecordDocRef(uid).update(activation);

  await writeCustomClaims({
    uid,
    status: "active",
    role: "student",
    schoolId: input.schoolId,
    districtId,
  });

  await writeAuditEvent({
    actorUserId: uid,
    actorRole: "student",
    action: "students.activated",
    targetType: "user",
    targetId: uid,
    schoolId: input.schoolId,
    districtId,
  });

  safeLog(() =>
    log.info("students.activated", {
      uid,
      schoolId: input.schoolId,
    }),
  );

  return {
    uid,
    status: "active",
    role: "student",
    schoolId: input.schoolId,
    alreadyActive: false,
  };
}

export const studentsCompleteOnboarding = platformCallable(
  studentsCompleteOnboardingHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __studentsCompleteOnboardingHandler =
  studentsCompleteOnboardingHandler;
