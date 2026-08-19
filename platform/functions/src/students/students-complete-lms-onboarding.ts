import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  log,
  classDocRef,
  enrollmentsCollectionRef,
  readCustomClaims,
  schoolDocRef,
  userRecordDocRef,
  writeAuditEvent,
  writeCustomClaims,
  type StudentActivationWrite,
  type UserRecord,
} from "../shared";

// studentsCompleteLmsOnboarding
//
// Sprint 27 Phase 3 (blueprint Decision 2). The narrow, LMS-specific
// activation callable that moves a Google-Classroom-rostered student from
// `provisioned` to `active` WITHOUT a manual join code and WITHOUT any
// client-asserted school, district, class, or provider identity.
//
// This callable is deliberately NOT a variant of
// `studentsCompleteOnboarding`. The two paths use different trust models:
//
//   - The manual path accepts a client-supplied `schoolId` (the beta
//     school constant) and gates enrollment on a join code the student
//     types. `studentsCompleteOnboarding` is certified and unchanged.
//   - The LMS path trusts NO client-supplied identity. It derives the
//     school and district entirely from the authoritative server state
//     that the certified roster sync established: an `active`
//     enrollment for the caller in a class whose `enrollmentSource ===
//     "lms"`. The class record is the sole authority for `schoolId`; the
//     school record is the sole authority for `districtId`.
//
// The load-bearing ordering fact (blueprint §6.1, §6.6): the external
// identity bridge is created by `authOnUserCreate` on first sign-in, so a
// later `lmsClassesSyncRoster` run resolves the (already-provisioned)
// student through the bridge and creates the `active` enrollment. That
// enrollment is created while the student is still `provisioned` and holds
// no custom claims; the roster engine never reads user status and never
// writes claims. This callable is the step that reads the resulting
// enrollment and performs the activation transition.
//
// Trust boundary. The client may send only an optional `displayName`. Any
// authority-bearing field (schoolId, districtId, classId, studentId,
// enrollmentId, providerId, providerAccountId, uid, role) is refused
// rather than silently ignored, so a probing client cannot smuggle a
// caller-controlled authority through an unvalidated key.

// Client-supplied request payload. The activation-required fields
// (role/schoolId) are NEVER accepted from the client on this path; they
// are derived server-side. Only an optional display name may be supplied,
// and even that falls back to the display name already recorded on the
// provisioned user (populated from the Firebase Auth record by
// `authOnUserCreate`). Prefer an empty payload where the recorded name is
// sufficient.
export type StudentsCompleteLmsOnboardingRequest = {
  readonly displayName?: string;
};

// Return payload of a successful LMS onboarding call. `alreadyActive` is
// `true` when the call is a no-op idempotent replay of a prior successful
// activation, and `false` when this call performed the `provisioned` ->
// `active` transition. The shape mirrors the manual onboarding response so
// the client can treat both activation paths uniformly.
export type StudentsCompleteLmsOnboardingResponse = {
  readonly uid: string;
  readonly status: "active";
  readonly role: "student";
  readonly schoolId: string;
  readonly alreadyActive: boolean;
};

// Authority-bearing keys the client must never assert on this path. Their
// presence is a hard refusal (fail closed) rather than a silent drop, so
// the trust boundary is observable in tests and a caller cannot probe for
// a key that is honored.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "role",
  "schoolId",
  "districtId",
  "classId",
  "studentId",
  "enrollmentId",
  "providerId",
  "providerAccountId",
  "providerAccount",
  "uid",
  "userId",
];

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
): StudentsCompleteLmsOnboardingRequest {
  // A missing or empty payload is valid: the display name falls back to the
  // provisioned record. Only a structured object (or nullish) is accepted.
  if (data === undefined || data === null) {
    return {};
  }
  if (typeof data !== "object") {
    throw new PlatformError(
      "students.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new PlatformError(
        "students.forbiddenField",
        "LMS onboarding derives school, district, class, and identity from server state; the client must not assert them.",
      );
    }
  }

  if (payload.displayName === undefined) {
    return {};
  }
  if (!isNonEmptyString(payload.displayName)) {
    throw new PlatformError(
      "students.invalidDisplayName",
      "displayName, when supplied, must be a non-empty string.",
    );
  }
  return { displayName: payload.displayName.trim() };
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

// Resolve the single authoritative school for the caller from the LMS
// enrollments the certified roster sync created. Returns the derived
// `schoolId`, refusing when there is no qualifying enrollment
// (`students.noLmsEnrollment`) and when qualifying enrollments resolve to
// more than one school (`students.conflictingLmsEnrollment`), which fails
// closed rather than guessing which membership is authoritative.
//
// Qualifying means: an `active` enrollment for this UID whose referenced
// class exists, is itself `active` (not `needsSetup` and not `archived`),
// and carries `enrollmentSource === "lms"`. A manual class (join-code
// sourced) never qualifies, so a student who is only manually enrolled
// cannot be activated through this path. The class record - never the
// client, and never the denormalized enrollment field - is the authority
// for `schoolId`.
async function resolveLmsSchoolId(uid: string): Promise<string> {
  const snapshot = await enrollmentsCollectionRef()
    .where("studentId", "==", uid)
    .where("status", "==", "active")
    .get();

  const schoolIds = new Set<string>();
  for (const doc of snapshot.docs) {
    const enrollment = doc.data();
    const classId = enrollment.classId;
    if (typeof classId !== "string" || classId.length === 0) continue;

    const classSnap = await classDocRef(classId).get();
    if (!classSnap.exists) continue;
    const classRecord = classSnap.data();
    if (!classRecord) continue;

    // The enrollment must be backed by an LMS-sourced, active class. A
    // stale/terminal enrollment cannot appear here (the query is scoped to
    // status === "active"); an archived or needsSetup class is excluded so
    // a partially-set-up or closed class cannot activate a student.
    if (classRecord.enrollmentSource !== "lms") continue;
    if (classRecord.status !== "active") continue;
    if (!isNonEmptyString(classRecord.schoolId)) continue;

    schoolIds.add(classRecord.schoolId);
  }

  if (schoolIds.size === 0) {
    throw new PlatformError(
      "students.noLmsEnrollment",
      "No active Google Classroom enrollment was found for this account.",
    );
  }
  if (schoolIds.size > 1) {
    // Multiple qualifying enrollments in the SAME school are acceptable for
    // the single-school pilot (blueprint §6.2); enrollments that resolve to
    // DIFFERENT schools are a conflicting identity and fail closed.
    throw new PlatformError(
      "students.conflictingLmsEnrollment",
      "This account is enrolled in classes across more than one school; activation cannot proceed.",
    );
  }
  return [...schoolIds][0];
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

// Canonical LMS activation transition `provisioned` -> `active`.
//
// Every side effect flows through the canonical shared helpers, exactly as
// `studentsCompleteOnboarding` does:
//   - user record read via `userRecordDocRef(uid).get()`         (typed ref)
//   - enrollment read via `enrollmentsCollectionRef().where(...)` (typed ref)
//   - class read via `classDocRef(classId).get()`                (typed ref)
//   - school read via `schoolDocRef(schoolId).get()`             (typed ref)
//   - activation update via `userRecordDocRef(uid).update(...)`  (typed ref)
//   - custom claims via `writeCustomClaims({...})`               (§4 helper)
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// The callable never touches `setCustomUserClaims` directly, never adds an
// `auditEvents` document directly, and never creates or mutates an
// enrollment. Enrollment creation remains the exclusive responsibility of
// the certified server-mediated roster sync.
//
// Idempotency mirrors the manual callable's contract - a caller who is
// already `active` with `role === "student"` receives a success response
// with `alreadyActive: true`, and no second user-record update or
// `students.activated` audit event is performed - and hardens it against the
// activation sequence's one non-atomic seam. Because the custom-claims write
// cannot share a transaction with the Firestore user-record update, a prior
// attempt can leave the record `active` while claims never landed. On the
// replay this branch reads the caller's own claims and, only when they are
// missing or stale, re-derives the district and re-asserts the canonical
// student claims. Healthy claims stay a bounded no-op; a split-brain is
// repaired rather than papered over with a success response.
async function studentsCompleteLmsOnboardingHandler(
  request: CallableRequest<unknown>,
): Promise<StudentsCompleteLmsOnboardingResponse> {
  const { uid } = assertAuthenticated(request);
  const input = validateRequest(request.data);

  const user = await loadUserRecord(uid);

  if (user.status === "active" && user.role === "student") {
    const schoolId = user.schoolId;
    if (!isNonEmptyString(schoolId)) {
      // An active student with no recorded school is a corrupt record, not
      // an idempotent replay. Fail closed rather than emit a claim with an
      // empty schoolId.
      throw new PlatformError(
        "students.invalidStatus",
        "The active student record is missing its school assignment.",
      );
    }

    // Self-heal a partial-activation split-brain. Activation is a three-step
    // sequence - the user-record update, then a Firebase Auth custom-claims
    // write, then the audit event - that CANNOT be one atomic unit: a
    // Firestore transaction cannot enclose a custom-claims write. So a prior
    // attempt can leave the record `active` while the claims write failed,
    // and the client cannot recover on its own: the bootstrap's force-refresh
    // only re-reads server claims that were never written, so the student is
    // degraded to the pending surface with no path back to onboarding, and a
    // plain idempotent replay that returned success here would leave them
    // stuck. When (and only when) the caller's canonical student claims are
    // missing or stale, re-assert them so this retry restores authorization.
    // This is bounded: it reads the caller's own claims and, on a detected
    // drift, the single authoritative school record; it never re-scans
    // enrollment (no roster scan) and never re-derives LMS qualification.
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
      safeLog(() =>
        log.warn("students.lmsOnboardingClaimsRepaired", { uid, schoolId }),
      );
    } else {
      safeLog(() => log.info("students.lmsOnboardingIdempotent", { uid }));
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
      `LMS onboarding requires status "provisioned" (current: "${user.status}").`,
    );
  }

  // Server-authoritative eligibility and school derivation. No client value
  // participates in either.
  const schoolId = await resolveLmsSchoolId(uid);
  const districtId = await resolveSchoolDistrictId(schoolId);

  // The display name falls back to the value recorded at provisioning
  // (populated from the Firebase Auth record by authOnUserCreate) when the
  // client did not supply one. A student who has neither is refused rather
  // than activated with an empty name.
  const displayName = input.displayName ?? user.displayName;
  if (!isNonEmptyString(displayName)) {
    throw new PlatformError(
      "students.invalidDisplayName",
      "A display name is required to activate this account.",
    );
  }

  const activation: StudentActivationWrite = {
    role: "student",
    schoolId,
    displayName: displayName.trim(),
    status: "active",
  };

  await userRecordDocRef(uid).update(activation);

  await writeCustomClaims({
    uid,
    status: "active",
    role: "student",
    schoolId,
    districtId,
  });

  // Reuse the canonical `students.activated` vocabulary. The event is
  // truthful about what happened - a student was activated - and the
  // payload carries only a PII-free provenance marker distinguishing the
  // LMS activation path from the manual one. It never claims this callable
  // created the enrollment (the roster sync did), and it never carries a
  // Google identity, a provider account id, a class id, a token, or any
  // student PII beyond the identifiers the audit policy already permits.
  await writeAuditEvent({
    actorUserId: uid,
    actorRole: "student",
    action: "students.activated",
    targetType: "user",
    targetId: uid,
    schoolId,
    districtId,
    payload: { source: "lms" },
  });

  safeLog(() =>
    log.info("students.activated", { uid, schoolId, source: "lms" }),
  );

  return {
    uid,
    status: "active",
    role: "student",
    schoolId,
    alreadyActive: false,
  };
}

export const studentsCompleteLmsOnboarding = platformCallable(
  studentsCompleteLmsOnboardingHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __studentsCompleteLmsOnboardingHandler =
  studentsCompleteLmsOnboardingHandler;
