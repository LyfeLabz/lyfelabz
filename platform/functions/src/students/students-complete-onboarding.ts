import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  log,
  readCustomClaims,
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
// second user-record update is performed and no second `students.activated`
// audit event is emitted.
//
// The idempotent branch also hardens the activation sequence's one
// non-atomic seam. Because the custom-claims write cannot share a
// transaction with the Firestore user-record update, a prior attempt can
// leave the record `active` while the claims write failed, stranding the
// student on the pending surface with a token that carries no
// authorization. On the replay this branch reads the caller's own claims
// and, only when they are missing or stale, re-derives the district from
// the school the record already names and re-asserts the canonical student
// claims. Healthy claims stay a bounded no-op (no claims write); a
// split-brain is repaired rather than papered over with a success
// response. This mirrors the certified LMS onboarding self-heal.
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
    // Canonical authority for the repair is the RECORD schoolId, not the
    // client-supplied value, matching the LMS self-heal. In this branch they
    // are equal (the gate above requires user.schoolId === input.schoolId)
    // and non-empty (the validator rejects an empty input.schoolId), so the
    // empty-schoolId guard below is defense-in-depth: it fails closed rather
    // than emit a claim with an empty schoolId if a corrupt active record
    // ever reaches here.
    const schoolId = user.schoolId;
    if (!isNonEmptyString(schoolId)) {
      throw new PlatformError(
        "students.invalidStatus",
        "The active student record is missing its school assignment.",
      );
    }

    // Self-heal a partial-activation split-brain. Read the caller's own
    // claims and re-assert the canonical student claims only when they are
    // missing or stale. This never re-runs activation, never accepts a
    // client authority field, and derives districtId server-side from the
    // school the record already names.
    const claims = await readCustomClaims(uid);
    const claimsHealthy =
      claims.role === "student" &&
      claims.schoolId === schoolId &&
      isNonEmptyString(claims.districtId);

    if (!claimsHealthy) {
      const districtId = await resolveSchoolDistrictId(schoolId);
      await writeCustomClaims({
        uid,
        status: "active",
        role: "student",
        schoolId,
        districtId,
      });
      // Log the repair; do NOT emit a second students.activated audit event.
      // The activation already happened; this restores the authorization the
      // activation intended.
      safeLog(() =>
        log.warn("students.onboardingClaimsRepaired", { uid, schoolId }),
      );
    } else {
      safeLog(() =>
        log.info("students.onboardingIdempotent", { uid, schoolId }),
      );
    }

    return {
      uid,
      status: "active",
      role: "student",
      schoolId,
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
