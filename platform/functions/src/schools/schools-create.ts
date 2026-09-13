import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  assertActivePlatformAdministratorInTransaction,
  platformCallable,
  PlatformError,
  log,
  requireActivePlatformAdministrator,
  runFirestoreTransaction,
  schoolCreationDocRef,
  schoolDocRef,
  writeAuditEventInTransaction,
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
  // Sprint 29G.5C fix-forward: the canonical persisted district field is
  // `districtId` (read by the shared district-context helper and the
  // onboarding/approval paths). The callable accepts `districtId`
  // (preferred) or the legacy `district` alias on the payload and
  // normalizes either into this single canonical field.
  readonly districtId?: string;
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

// Sprint 29G.5C-R1: shortName is a HUMAN-FACING short display label, not a
// machine slug. No code reads it for routing, URLs, dashboards, or paths
// (the sole readers write/compare it), and the canonical Beta school stores
// the mixed-case label "Beta" - which the earlier lowercase-only pattern
// would have rejected. The pattern therefore accepts a bounded human label
// (letters in any case, digits, spaces, and the common label punctuation
// . ' & -), must begin with an alphanumeric, and is trimmed and length-
// bounded before the test. Existing lowercase values remain valid. Emptiness
// and unbounded length are still rejected. Values like "WMS", "Beta", and
// "Weston MS" are valid.
const SHORT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .'&-]*$/;
const SHORT_NAME_MAX_LENGTH = 48;

// The schoolId is the machine identifier: it is the Firestore document ID
// and the value a teacher's record and claims carry, so it stays a strict
// URL-safe token. Firestore document IDs cannot contain "/", cannot be "."
// or "..", and cannot match the reserved __.*__ pattern; this accepted set
// is stricter than the raw Firestore constraint. (This is distinct from
// shortName, which is a human-facing display label - see above.)
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
  if (shortName.length > SHORT_NAME_MAX_LENGTH || !SHORT_NAME_PATTERN.test(shortName)) {
    throw new PlatformError(
      "schools.invalidShortName",
      "shortName must be a short label (letters, digits, spaces, and . ' & -) starting with a letter or digit.",
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
    districtId?: string;
    gradeLevels?: readonly string[];
    brandingRef?: string;
  } = { schoolId, name, shortName, timezone };

  // Accept the canonical `districtId` (preferred) or the legacy `district`
  // alias. Either is validated as a non-empty string and normalized into
  // the canonical `districtId`. Supplying both is permitted only when they
  // are identical after trimming, so a caller can never smuggle two
  // conflicting district values through the two field names.
  let districtIdRaw: unknown;
  if (payload.districtId !== undefined && payload.district !== undefined) {
    if (!isNonEmptyString(payload.districtId) || !isNonEmptyString(payload.district)) {
      throw new PlatformError(
        "schools.invalidDistrict",
        "districtId/district, when supplied, must be a non-empty string.",
      );
    }
    if (payload.districtId.trim() !== payload.district.trim()) {
      throw new PlatformError(
        "schools.invalidDistrict",
        "districtId and legacy district must match when both are supplied.",
      );
    }
    districtIdRaw = payload.districtId;
  } else if (payload.districtId !== undefined) {
    districtIdRaw = payload.districtId;
  } else if (payload.district !== undefined) {
    districtIdRaw = payload.district;
  }
  if (districtIdRaw !== undefined) {
    if (!isNonEmptyString(districtIdRaw)) {
      throw new PlatformError(
        "schools.invalidDistrict",
        "districtId, when supplied, must be a non-empty string.",
      );
    }
    request.districtId = districtIdRaw.trim();
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
  if ((existing.districtId ?? undefined) !== (input.districtId ?? undefined)) {
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
//   - administrator revalidation via `assertActivePlatformAdministratorInTransaction`
//   - existing-record read via `tx.get(schoolDocRef(schoolId))`  (typed ref)
//   - creation write via `tx.set(schoolCreationDocRef(schoolId), ...)` (typed ref)
//   - audit event via `writeAuditEventInTransaction(tx, {...})`  (§5 helper)
//
// The callable never touches Firestore through `getAdminFirestore()`
// without going through a typed-ref builder, never issues custom claims,
// and never adds an `auditEvents` document directly.
//
// Phase 8G.12A - transactional administrator authority. The cheap
// pre-transaction guard (`requireActivePlatformAdministrator`) provides early
// rejection but is NOT the authoritative mutation-time check. The
// administrator is re-validated against canonical Firestore INSIDE the same
// transaction that creates the school and writes the audit, so an
// administrator who is demoted/suspended after the cheap guard passes but
// before the transaction commits cannot create a school: the transaction
// observes the demotion and writes nothing.
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
  // Phase 8G.12 admin-claim hardening (cheap pre-transaction gate): reject a
  // caller who is not an authoritatively active `platformAdministrator` before
  // opening a transaction. The authoritative check is re-run in the
  // transaction below.
  const { uid: actorUserId } = await requireActivePlatformAdministrator(
    request,
    {
      unauthenticatedCode: "schools.unauthenticated",
      unauthorizedCode: "schools.unauthorized",
    },
  );
  const input = validateRequest(request.data);

  const outcome = await runFirestoreTransaction<{ alreadyCreated: boolean }>(
    async (tx) => {
      // -- Reads (all before any write, per Firestore transaction rules) --

      // Authoritative, mutation-time administrator revalidation. Closes the
      // demotion race: a caller demoted/suspended after the cheap guard is
      // refused here and no school or audit is written.
      await assertActivePlatformAdministratorInTransaction(tx, actorUserId, {
        unauthorizedCode: "schools.unauthorized",
      });

      const existingSnapshot = await tx.get(schoolDocRef(input.schoolId));
      if (existingSnapshot.exists) {
        const existing = existingSnapshot.data();
        if (existing && existingMatchesRequest(existing, input)) {
          return { alreadyCreated: true };
        }
        throw new PlatformError(
          "schools.conflict",
          "A school with this id already exists with different canonical fields.",
        );
      }

      // -- Writes --

      const creation: SchoolCreationWrite = {
        name: input.name,
        shortName: input.shortName,
        timezone: input.timezone,
        createdAt: FieldValue.serverTimestamp(),
        ...(input.districtId !== undefined
          ? { districtId: input.districtId }
          : {}),
        ...(input.gradeLevels !== undefined
          ? { gradeLevels: input.gradeLevels }
          : {}),
        ...(input.brandingRef !== undefined
          ? { brandingRef: input.brandingRef }
          : {}),
      };

      tx.set(schoolCreationDocRef(input.schoolId), creation);

      writeAuditEventInTransaction(tx, {
        actorUserId,
        actorRole: "platformAdministrator",
        action: "schools.created",
        targetType: "school",
        targetId: input.schoolId,
        schoolId: input.schoolId,
      });

      return { alreadyCreated: false };
    },
  );

  safeLog(() =>
    log.info(outcome.alreadyCreated ? "schools.createIdempotent" : "schools.created", {
      actorUserId,
      schoolId: input.schoolId,
    }),
  );

  return { schoolId: input.schoolId, alreadyCreated: outcome.alreadyCreated };
}

export const schoolsCreate = platformCallable(schoolsCreateHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __schoolsCreateHandler = schoolsCreateHandler;
