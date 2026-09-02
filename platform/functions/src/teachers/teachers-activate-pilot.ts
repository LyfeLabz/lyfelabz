import { type CallableRequest } from "firebase-functions/v2/https";

import {
  assertTeacherPilotAllowlisted,
  platformCallable,
  PlatformError,
  log,
  readCustomClaims,
  resolvePilotSchoolId,
  schoolDocRef,
  userRecordDocRef,
  writeAuditEvent,
  writeCustomClaims,
  type TeacherPilotActivationWrite,
  type UserRecord,
} from "../shared";

// Client-supplied request payload for teachersActivatePilot. The role is
// carried as an explicit self-declaration (mirroring
// studentsCompleteOnboarding / teachersRequestVerification) so the callable
// never silently activates a caller who intended a different role. It is
// the ONLY field the client may supply: the authorization email, the pilot
// schoolId, the districtId, and the displayName are all resolved
// server-side. The client can never assert its own school, district, or
// allowlist membership.
export type TeachersActivatePilotRequest = {
  readonly role: "teacher";
};

// Return payload of a successful direct pilot activation. `alreadyActive`
// is `true` when the call is an idempotent replay of a previously
// successful activation, and `false` when this call performed the
// `provisioned` -> `active` transition.
export type TeachersActivatePilotResponse = {
  readonly uid: string;
  readonly status: "active";
  readonly role: "teacher";
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
      "teachers.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  return { uid: auth.uid };
}

function validateRequest(data: unknown): TeachersActivatePilotRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "teachers.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  if (payload.role !== "teacher") {
    throw new PlatformError(
      "teachers.invalidRole",
      'role must be "teacher".',
    );
  }
  return { role: "teacher" };
}

async function loadUserRecord(uid: string): Promise<UserRecord> {
  const snapshot = await userRecordDocRef(uid).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "teachers.userNotFound",
      "User record was not found for the authenticated caller.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "teachers.userNotFound",
      "User record was empty for the authenticated caller.",
    );
  }
  return data;
}

// Resolve the pilot school's districtId from the canonical
// `schools/{schoolId}` record, mirroring the shared district-context
// helper and the student/teacher onboarding paths. Fails closed (no
// mutation) when the school is absent or carries no districtId, so an
// unconfigured pilot school can never produce a half-activated teacher.
async function resolveSchoolDistrictId(schoolId: string): Promise<string> {
  const snapshot = await schoolDocRef(schoolId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "teachers.schoolNotFound",
      "The pilot school does not exist.",
    );
  }
  const school = snapshot.data() as
    | (Record<string, unknown> & { districtId?: unknown })
    | undefined;
  if (!school) {
    throw new PlatformError(
      "school-district-mismatch",
      "The pilot school record was unreadable.",
    );
  }
  const districtId = school.districtId;
  if (typeof districtId !== "string" || districtId.trim().length === 0) {
    throw new PlatformError(
      "district-unassigned",
      "The pilot school is not assigned to a district.",
    );
  }
  return districtId;
}

// Resolve a non-empty displayName for the activation write. The manual
// "Your name" onboarding field is removed for pilot teachers, so the name
// comes from the value `authOnUserCreate` recorded from the Google profile
// at provisioning. When Google supplied no name, fall back to the email
// local-part, and finally to a safe constant so the activation write never
// fails on a missing activation-required field. No client-supplied name is
// ever used.
function resolveDisplayName(user: UserRecord): string {
  if (isNonEmptyString(user.displayName)) return user.displayName.trim();
  if (isNonEmptyString(user.email)) {
    const localPart = user.email.split("@")[0]?.trim();
    if (isNonEmptyString(localPart)) return localPart;
  }
  return "Teacher";
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

// teachersActivatePilot
//
// Sprint 29G.5C direct allowlisted pilot-teacher activation. Canonical
// transition `provisioned` -> `active` for a curated pilot teacher, without
// the manual `pendingVerification` / platformAdministrator approval step
// (which is retained for possible future non-pilot onboarding). Chris
// placing an authenticated email on the protected, client-denied
// `platformConfig/teacherPilotAllowlist` IS the approval decision.
//
// Authorization model (29G.5B):
//   - the caller's email is read server-side from the canonical
//     `users/{uid}` record (populated by `authOnUserCreate` from the
//     Google identity), never from the client payload, so allowlist
//     membership cannot be spoofed.
//   - the pilot schoolId is resolved from the protected pilot
//     configuration (`resolvePilotSchoolId`), never from the client.
//   - the districtId is resolved from the canonical `schools/{schoolId}`
//     record, never from the client.
//
// Every side effect flows through the canonical shared helpers:
//   - user record read via `userRecordDocRef(uid).get()`         (typed ref)
//   - allowlist gate via `assertTeacherPilotAllowlisted(email)`  (§29C)
//   - school read via `schoolDocRef(schoolId).get()`             (typed ref)
//   - activation update via `userRecordDocRef(uid).update(...)`  (typed ref)
//   - custom claims via `writeCustomClaims({...})`               (§4 helper)
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// Revocation semantics (locked, 29G.5C): the allowlist grants permission to
// ACTIVATE. Removing an email does NOT deactivate an already-active
// teacher, so the idempotent active branch deliberately does not re-check
// the allowlist. Explicit deactivation is a separate future concern.
//
// Idempotency: mirrors studentsCompleteOnboarding. An already-active
// teacher assigned to the pilot school returns `alreadyActive: true`,
// re-asserting claims only when they are missing or stale (the one
// non-atomic Firestore + Auth seam). An already-active teacher assigned to
// a DIFFERENT school is refused rather than silently moved.
async function teachersActivatePilotHandler(
  request: CallableRequest<unknown>,
): Promise<TeachersActivatePilotResponse> {
  const { uid } = assertAuthenticated(request);
  validateRequest(request.data);

  const user = await loadUserRecord(uid);

  // Idempotent / already-active handling. This branch never re-checks the
  // allowlist (revocation does not deactivate) and never re-runs the
  // activation transition.
  if (user.status === "active") {
    if (user.role !== "teacher") {
      // An active non-teacher (e.g. student) must never be silently
      // converted into a teacher.
      throw new PlatformError(
        "teachers.roleConflict",
        "The authenticated account is already active in a non-teacher role.",
      );
    }

    const pilotSchoolId = await resolvePilotSchoolId();
    if (user.schoolId !== pilotSchoolId) {
      // An active teacher at another school is not silently moved to the
      // pilot school.
      throw new PlatformError(
        "teachers.activeSchoolMismatch",
        "The authenticated teacher is already active at a different school.",
      );
    }

    const schoolId = user.schoolId;
    if (!isNonEmptyString(schoolId)) {
      throw new PlatformError(
        "teachers.invalidStatus",
        "The active teacher record is missing its school assignment.",
      );
    }

    // Self-heal a partial-activation split-brain (record active, prior
    // claims write failed). Re-assert canonical teacher claims only when
    // missing or stale; derive districtId server-side from the school the
    // record already names. Mirrors the certified student self-heal.
    const claims = await readCustomClaims(uid);
    const claimsHealthy =
      claims.role === "teacher" &&
      claims.schoolId === schoolId &&
      isNonEmptyString(claims.districtId);

    if (!claimsHealthy) {
      const districtId = await resolveSchoolDistrictId(schoolId);
      await writeCustomClaims({
        uid,
        status: "active",
        role: "teacher",
        schoolId,
        districtId,
      });
      safeLog(() =>
        log.warn("teachers.pilotActivationClaimsRepaired", { uid, schoolId }),
      );
    } else {
      safeLog(() =>
        log.info("teachers.pilotActivationIdempotent", { uid, schoolId }),
      );
    }

    return {
      uid,
      status: "active",
      role: "teacher",
      schoolId,
      alreadyActive: true,
    };
  }

  // Direct activation is only valid from `provisioned`. A
  // `pendingVerification` caller (from the retained manual path) or any
  // terminal state is refused rather than corrupted.
  if (user.status !== "provisioned") {
    throw new PlatformError(
      "teachers.invalidStatus",
      `Pilot activation requires status "provisioned" (current: "${user.status}").`,
    );
  }

  // Authorization gate: the server-trusted email must be on the protected
  // pilot allowlist. Fails closed (teachers.pilotNotAllowlisted) when the
  // email is absent, the allowlist is missing/malformed, or the email is
  // not listed. Runs BEFORE any write so a refusal leaves no partial
  // activation.
  await assertTeacherPilotAllowlisted(user.email);

  // Resolve the canonical pilot school and district entirely server-side.
  // Both fail closed before any write.
  const schoolId = await resolvePilotSchoolId();
  const districtId = await resolveSchoolDistrictId(schoolId);

  const displayName = resolveDisplayName(user);

  const activation: TeacherPilotActivationWrite = {
    role: "teacher",
    schoolId,
    displayName,
    status: "active",
  };

  await userRecordDocRef(uid).update(activation);

  await writeCustomClaims({
    uid,
    status: "active",
    role: "teacher",
    schoolId,
    districtId,
  });

  await writeAuditEvent({
    actorUserId: uid,
    actorRole: "teacher",
    action: "teachers.pilotActivated",
    targetType: "user",
    targetId: uid,
    schoolId,
    districtId,
  });

  safeLog(() =>
    log.info("teachers.pilotActivated", {
      uid,
      schoolId,
    }),
  );

  return {
    uid,
    status: "active",
    role: "teacher",
    schoolId,
    alreadyActive: false,
  };
}

export const teachersActivatePilot = platformCallable(
  teachersActivatePilotHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __teachersActivatePilotHandler = teachersActivatePilotHandler;
