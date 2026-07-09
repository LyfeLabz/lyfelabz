import { FieldValue } from "firebase-admin/firestore";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  log,
  schoolCreationDocRef,
  schoolDocRef,
  writeAuditEvent,
  type SchoolCreationWrite,
  type SchoolRecord,
} from "../shared";

// Client-supplied request payload for schoolsCreate. The administrator
// supplies the target schoolId explicitly so the callable is idempotent
// against replays and never silently mints a second document for the same
// institutional tenant. The remaining fields mirror the canonical
// Data Model §3.2 required and optional sets.
export type SchoolsCreateRequest = {
  readonly schoolId: string;
  readonly name: string;
  readonly shortName: string;
  readonly timezone: string;
  readonly district?: string;
  readonly gradeLevels?: readonly string[];
  readonly brandingRef?: string;
};

// Return payload of a successful school-creation call. `alreadyCreated` is
// `true` when the call is a no-op idempotent replay of a previously
// successful creation, and `false` when this call wrote the canonical
// schools/{schoolId} document.
export type SchoolsCreateResponse = {
  readonly schoolId: string;
  readonly alreadyCreated: boolean;
};

// URL-safe token per Data Model §3.2 shortName: lowercase alphanumerics
// and hyphens only, one to forty characters. Deliberately strict so that
// dashboards and any future per-school routing can rely on the value
// without escaping.
const SHORT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// Firestore document IDs cannot contain "/", cannot be "." or "..", and
// cannot match the reserved __.*__ pattern. Keeping the accepted set to
// URL-safe characters is stricter than the raw Firestore constraint and
// matches the shortName policy.
const SCHOOL_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isNonEmptyString(entry))
  );
}

function assertAuthenticatedAdministrator(
  request: CallableRequest<unknown>,
): { readonly uid: string } {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throw new PlatformError(
      "schools.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  const token = auth.token as { readonly role?: unknown } | undefined;
  if (!token || token.role !== "platformAdministrator") {
    throw new PlatformError(
      "schools.unauthorized",
      "Caller must be a Platform Administrator.",
    );
  }
  return { uid: auth.uid };
}

function validateRequest(data: unknown): SchoolsCreateRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "schools.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  if (!isNonEmptyString(payload.schoolId)) {
    throw new PlatformError(
      "schools.invalidSchoolId",
      "schoolId must be a non-empty string.",
    );
  }
  const schoolId = payload.schoolId.trim();
  if (!SCHOOL_ID_PATTERN.test(schoolId)) {
    throw new PlatformError(
      "schools.invalidSchoolId",
      "schoolId must be a URL-safe token (letters, digits, hyphens, underscores).",
    );
  }

  if (!isNonEmptyString(payload.name)) {
    throw new PlatformError(
      "schools.invalidName",
      "name must be a non-empty string.",
    );
  }
  const name = payload.name.trim();

  if (!isNonEmptyString(payload.shortName)) {
    throw new PlatformError(
      "schools.invalidShortName",
      "shortName must be a non-empty string.",
    );
  }
  const shortName = payload.shortName.trim();
  if (!SHORT_NAME_PATTERN.test(shortName)) {
    throw new PlatformError(
      "schools.invalidShortName",
      "shortName must be a URL-safe token (lowercase letters, digits, hyphens).",
    );
  }

  if (!isNonEmptyString(payload.timezone)) {
    throw new PlatformError(
      "schools.invalidTimezone",
      "timezone must be a non-empty string.",
    );
  }
  const timezone = payload.timezone.trim();

  const request: {
    schoolId: string;
    name: string;
    shortName: string;
    timezone: string;
    district?: string;
    gradeLevels?: readonly string[];
    brandingRef?: string;
  } = { schoolId, name, shortName, timezone };

  if (payload.district !== undefined) {
    if (!isNonEmptyString(payload.district)) {
      throw new PlatformError(
        "schools.invalidDistrict",
        "district, when supplied, must be a non-empty string.",
      );
    }
    request.district = payload.district.trim();
  }

  if (payload.gradeLevels !== undefined) {
    if (!isNonEmptyStringArray(payload.gradeLevels)) {
      throw new PlatformError(
        "schools.invalidGradeLevels",
        "gradeLevels, when supplied, must be a non-empty array of non-empty strings.",
      );
    }
    request.gradeLevels = payload.gradeLevels.map((entry) => entry.trim());
  }

  if (payload.brandingRef !== undefined) {
    if (!isNonEmptyString(payload.brandingRef)) {
      throw new PlatformError(
        "schools.invalidBrandingRef",
        "brandingRef, when supplied, must be a non-empty string.",
      );
    }
    request.brandingRef = payload.brandingRef.trim();
  }

  return request;
}

function existingMatchesRequest(
  existing: SchoolRecord,
  input: SchoolsCreateRequest,
): boolean {
  if (
    existing.name !== input.name ||
    existing.shortName !== input.shortName ||
    existing.timezone !== input.timezone
  ) {
    return false;
  }
  if ((existing.district ?? undefined) !== (input.district ?? undefined)) {
    return false;
  }
  if ((existing.brandingRef ?? undefined) !== (input.brandingRef ?? undefined)) {
    return false;
  }
  const existingLevels = existing.gradeLevels;
  const inputLevels = input.gradeLevels;
  if (existingLevels === undefined && inputLevels === undefined) {
    return true;
  }
  if (existingLevels === undefined || inputLevels === undefined) {
    return false;
  }
  if (existingLevels.length !== inputLevels.length) {
    return false;
  }
  for (let i = 0; i < existingLevels.length; i += 1) {
    if (existingLevels[i] !== inputLevels[i]) {
      return false;
    }
  }
  return true;
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

// schoolsCreate
//
// Canonical creation of a schools/{schoolId} document per Data Model §3.2.
// Callable only by a Platform Administrator (Cloud Function Charter §2,
// Data Model §7.2).
//
// Every side effect flows through the canonical shared helpers:
//   - existing-record read via `schoolDocRef(schoolId).get()`    (typed ref)
//   - creation write via `schoolCreationDocRef(schoolId).set(...)` (typed ref)
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// The callable never touches Firestore through `getAdminFirestore()`
// without going through a typed-ref builder, never issues custom claims,
// and never adds an `auditEvents` document directly.
//
// Idempotency: an existing schools/{schoolId} whose canonical fields match
// the request returns a success response with `alreadyCreated: true`. No
// second write is performed and no second `schools.created` audit event
// is emitted. An existing document whose canonical fields differ is
// rejected with `schools.conflict` so a rename or repurposing cannot be
// laundered through the creation callable.
async function schoolsCreateHandler(
  request: CallableRequest<unknown>,
): Promise<SchoolsCreateResponse> {
  const { uid: actorUserId } = assertAuthenticatedAdministrator(request);
  const input = validateRequest(request.data);

  const existingSnapshot = await schoolDocRef(input.schoolId).get();
  if (existingSnapshot.exists) {
    const existing = existingSnapshot.data();
    if (existing && existingMatchesRequest(existing, input)) {
      safeLog(() =>
        log.info("schools.createIdempotent", {
          actorUserId,
          schoolId: input.schoolId,
        }),
      );
      return { schoolId: input.schoolId, alreadyCreated: true };
    }
    throw new PlatformError(
      "schools.conflict",
      "A school with this id already exists with different canonical fields.",
    );
  }

  const creation: SchoolCreationWrite = {
    name: input.name,
    shortName: input.shortName,
    timezone: input.timezone,
    createdAt: FieldValue.serverTimestamp(),
    ...(input.district !== undefined ? { district: input.district } : {}),
    ...(input.gradeLevels !== undefined
      ? { gradeLevels: input.gradeLevels }
      : {}),
    ...(input.brandingRef !== undefined
      ? { brandingRef: input.brandingRef }
      : {}),
  };

  await schoolCreationDocRef(input.schoolId).set(creation);

  await writeAuditEvent({
    actorUserId,
    actorRole: "platformAdministrator",
    action: "schools.created",
    targetType: "school",
    targetId: input.schoolId,
    schoolId: input.schoolId,
  });

  safeLog(() =>
    log.info("schools.created", {
      actorUserId,
      schoolId: input.schoolId,
    }),
  );

  return { schoolId: input.schoolId, alreadyCreated: false };
}

export const schoolsCreate = onCall(schoolsCreateHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __schoolsCreateHandler = schoolsCreateHandler;
