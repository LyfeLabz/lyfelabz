// U2.1 - normalization of `teacherUnits*` callable failures into safe,
// typed categories for future U2 surfaces. Firebase-free.
//
// The server stores the canonical platform code on `HttpsError.details.code`
// and spreads extra details beside it (platform/functions/src/shared/errors/
// https-callable.ts), e.g. `{ code: "teacherUnits.writeConflict",
// currentRevision }`. The coarse Firebase `code` is the fallback, matching
// `extractPlatformErrorCode` in router/surfaces/index.ts. Teacher-facing
// messages never include server text or internal identifiers.
//
// Normalization never turns a failure into a success: every input yields a
// failure category.

export type TeacherUnitErrorCategory =
  // Stale revision or exhausted contention. Refresh; never auto-replay.
  | "conflict"
  // The unit is archived (or was just archived). Refresh to show it.
  | "invalidStatus"
  // Missing, not yours, or another school's. Return to the list.
  | "notFound"
  // A requested resource is not placeable or is repeated. Refresh the unit.
  | "resourceRejected"
  // The create key was already used for a different request. New key.
  | "idempotencyKeyConflict"
  // A form field (title, description, grade) failed validation.
  | "invalidField"
  // A malformed request the client should never send. Not retryable.
  | "invalidRequest"
  // Over a server ceiling (list above 1000 units).
  | "limitExceeded"
  // Signed out, inactive, wrong role, or school/district context changed.
  | "unauthorized"
  // Create only (U2.2): the caller's verified school is no longer the
  // school the create intent was made in (`expectedSchoolId`).
  | "schoolContextChanged"
  // Could not reach the server, or the result is unknown. Retry is safe
  // only where the operation is idempotent (see `retry`).
  | "network"
  // Anything else.
  | "unexpected";

export type TeacherUnitErrorField = "title" | "description" | "grade";

// What a future UI should do next.
export type TeacherUnitRecovery =
  | "refresh" // reload authoritative state, keep nothing stale
  | "returnToList"
  | "editField" // keep the form open with its contents
  | "retry" // offer Try again, keeping unsaved form contents
  // Unresolved create only: deliberately resend the SAME key and payload
  // through the create coordinator's `reconcile`. Never a new key.
  | "reconcileCreate"
  | "signIn"
  | "none";

export type TeacherUnitError = {
  readonly category: TeacherUnitErrorCategory;
  readonly recovery: TeacherUnitRecovery;
  // Canonical platform code or coarse Firebase code; "" when unknown.
  // For logging and tests, never for display.
  readonly code: string;
  readonly message: string;
  readonly field: TeacherUnitErrorField | null;
  // writeConflict only, when the server reported it.
  readonly currentRevision: number | null;
  // writeConflict from teacherUnitsReorder: the first unit whose revision
  // did not match. Diagnostic only, never displayed.
  readonly conflictUnitId: string | null;
  // resourceNotPlaceable / duplicateResource only.
  readonly rejectedResourceIds: ReadonlyArray<string>;
};

function readDetails(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") return {};
  const details = (err as { details?: unknown }).details;
  return details && typeof details === "object" ? (details as Record<string, unknown>) : {};
}

export function extractTeacherUnitErrorCode(err: unknown): string {
  const code = readDetails(err).code;
  if (typeof code === "string" && code.length > 0) return code;
  if (!err || typeof err !== "object") return "";
  const fb = (err as { code?: unknown }).code;
  return typeof fb === "string" ? fb : "";
}

// A Map, not an object literal: an arbitrary server or client code such as
// "toString", "constructor", or "__proto__" must never resolve to an
// inherited Object.prototype member.
const FIELD_CODES: ReadonlyMap<string, TeacherUnitErrorField> = new Map([
  ["teacherUnits.invalidTitle", "title"],
  ["teacherUnits.invalidDescription", "description"],
  ["teacherUnits.invalidGrade", "grade"],
]);

const FIELD_MESSAGES: Readonly<Record<TeacherUnitErrorField, string>> = Object.freeze({
  title: "Enter a unit name of 1 to 120 characters.",
  description: "Keep the description under 1,000 characters.",
  grade: "Choose Grade 6, 7, or 8.",
});

const INVALID_REQUEST_CODES: ReadonlySet<string> = new Set([
  "teacherUnits.invalidRequest",
  "teacherUnits.invalidIdempotencyKey",
  "teacherUnits.invalidExpectedSchoolId",
  "teacherUnits.invalidUnitId",
  "teacherUnits.invalidExpectedRevision",
  "teacherUnits.invalidResourceIds",
  "teacherUnits.invalidUnitOrder",
]);

// Account and context refusals shared with requireDistrictContext.
const UNAUTHORIZED_CODES: ReadonlySet<string> = new Set([
  "unauthenticated",
  "role-forbidden",
  "account-inactive",
  "school-district-mismatch",
  "permission-denied",
]);

function isUnauthorized(code: string): boolean {
  return (
    UNAUTHORIZED_CODES.has(code) ||
    code.startsWith("claim-") ||
    code.startsWith("district-") ||
    code === "functions/unauthenticated" ||
    code === "functions/permission-denied"
  );
}

function isNetwork(code: string, err: unknown): boolean {
  if (
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "functions/unavailable" ||
    code === "functions/deadline-exceeded" ||
    code.includes("network")
  ) {
    return true;
  }
  return err instanceof TypeError && /fetch|network/i.test(err.message);
}

function make(
  category: TeacherUnitErrorCategory,
  recovery: TeacherUnitRecovery,
  code: string,
  message: string,
  extra: Partial<
    Pick<TeacherUnitError, "field" | "currentRevision" | "conflictUnitId" | "rejectedResourceIds">
  > = {},
): TeacherUnitError {
  return Object.freeze({
    category,
    recovery,
    code,
    message,
    field: extra.field ?? null,
    currentRevision: extra.currentRevision ?? null,
    conflictUnitId: extra.conflictUnitId ?? null,
    rejectedResourceIds: Object.freeze((extra.rejectedResourceIds ?? []).slice()),
  });
}

export function normalizeTeacherUnitError(err: unknown): TeacherUnitError {
  const code = extractTeacherUnitErrorCode(err);
  const details = readDetails(err);

  switch (code) {
    case "teacherUnits.writeConflict":
      return make(
        "conflict",
        "refresh",
        code,
        "This unit was changed somewhere else, so your change was not saved. Refresh to load the latest version, then make your change again if you still need it.",
        {
          currentRevision:
            typeof details.currentRevision === "number" &&
            Number.isSafeInteger(details.currentRevision)
              ? details.currentRevision
              : null,
          conflictUnitId: typeof details.unitId === "string" ? details.unitId : null,
        },
      );
    case "teacherUnits.invalidStatus":
      return make(
        "invalidStatus",
        "refresh",
        code,
        "This unit is archived, so your change was not saved. Refresh, then restore the unit to make changes.",
      );
    case "teacherUnits.notFound":
      return make(
        "notFound",
        "returnToList",
        code,
        "We could not find this unit. It may no longer be available to you.",
      );
    case "teacherUnits.resourceNotPlaceable": {
      const ids = Array.isArray(details.resourceIds)
        ? details.resourceIds.filter((v): v is string => typeof v === "string")
        : [];
      return make(
        "resourceRejected",
        "refresh",
        code,
        "One or more resources can no longer be added to units. Remove them and try again.",
        { rejectedResourceIds: ids },
      );
    }
    case "teacherUnits.duplicateResource":
      return make(
        "resourceRejected",
        "refresh",
        code,
        "That resource is already in this unit.",
        {
          rejectedResourceIds:
            typeof details.resourceId === "string" ? [details.resourceId] : [],
        },
      );
    case "teacherUnits.idempotencyKeyConflict":
      return make(
        "idempotencyKeyConflict",
        // Never "use a new key": the earlier attempt may have committed. The
        // create coordinator (saveCoordination.ts) keeps the attempt
        // unresolved; only an explicit teacher choice abandons it.
        "refresh",
        code,
        "We couldn't confirm whether this unit was created. Refresh your units to check before creating it again.",
      );
    case "teacherUnits.schoolContextChanged":
      // Create only (U2.2): the request named the school its intent was made
      // in, and the server's verified school is now different. The server
      // refused before writing, but an EARLIER dispatch of the same attempt
      // may have committed in the original school, so this never claims the
      // unit was not created. The create coordinator keeps it unresolved.
      return make(
        "schoolContextChanged",
        "refresh",
        code,
        "Your school changed, so we couldn't confirm whether this unit was created. Reload the page to continue at your current school.",
      );
    case "teacherUnits.listLimitExceeded":
      return make(
        "limitExceeded",
        "none",
        code,
        "You have too many units to show at once. Contact LyfeLabz support.",
      );
  }

  const field = FIELD_CODES.get(code);
  if (field !== undefined) {
    return make("invalidField", "editField", code, FIELD_MESSAGES[field], { field });
  }
  if (INVALID_REQUEST_CODES.has(code)) {
    return make(
      "invalidRequest",
      "refresh",
      code,
      "This change could not be saved. Refresh and try again.",
    );
  }
  if (isUnauthorized(code)) {
    return make(
      "unauthorized",
      "signIn",
      code,
      "Your account can't make changes right now, and we couldn't confirm whether your change was saved. Sign in again, then refresh to check.",
    );
  }
  if (isNetwork(code, err)) {
    return make(
      "network",
      "retry",
      code,
      "We couldn't confirm whether your change was saved. Check your connection, then refresh to check before trying again.",
    );
  }
  return make(
    "unexpected",
    "retry",
    code,
    "Something went wrong and we couldn't confirm whether your change was saved. Refresh to check before trying again.",
  );
}

// After a failure of a REVISION-GUARDED mutation (update, archive, restore,
// setResources, reorder), may the SAME request be sent again unchanged?
// Not used for create: a create's idempotency key lifecycle is decided by
// `createUnitCreateCoordinator` (saveCoordination.ts), never by this flag.
// - yes for network/unexpected, because
//   the request carries its expectedRevision; if the first attempt actually
//   committed, the retry is either an authorized no-op or a writeConflict.
// - conflict and every other category: never. Conflicts require a refresh
//   and a new teacher action; stale writes are never replayed.
export function isSafeToResend(error: TeacherUnitError): boolean {
  return error.category === "network" || error.category === "unexpected";
}
