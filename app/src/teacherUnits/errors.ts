import { TeacherUnitsCompatibilityError } from "./compatibilityError";
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
  | "compatibilityBlocked"
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
  // A3-3: the server reported `teacherUnits.responseUnavailable` (outcome
  // "unconfirmed") or an availability refusal decided inside a transaction.
  // Neither proves the change was or was not saved. Never resent
  // automatically; reconcile with an authoritative read.
  | "unconfirmed"
  // Could not reach the server, or the result is unknown. After a mutation
  // was dispatched this never means "not saved": reconcile by reading.
  | "network"
  // Anything else.
  | "unexpected";

export type TeacherUnitErrorField = "title" | "description" | "grade";

// What a future UI should do next.
export type TeacherUnitRecovery =
  | "refresh" // reload authoritative state, keep nothing stale
  | "returnToList"
  | "editField" // keep the form open with its contents
  // Offer Try again, keeping unsaved form contents. Only for a request that
  // was never sent (`compatibilityBlocked`); never after a dispatch.
  | "retry"
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
  // A3-3 mutation envelope checks, decided before any transaction.
  "teacherUnits.compatibilityRequired",
  "teacherUnits.invalidCompatibility",
]);

// A3-3 availability refusals (a3-errors.ts). Each can be raised inside an
// authoritative transaction, including an SDK rerun after an earlier attempt
// committed, so none is proof that nothing was written
// (U2_6_A3_3_APPROVED_DECISIONS.md section 5.1).
const A3_UNCONFIRMED_CODES: ReadonlySet<string> = new Set([
  "teacherUnits.runtimeIdentityUnavailable",
  "teacherUnits.policyUnavailable",
  "teacherUnits.policyMissing",
  "teacherUnits.policyInvalid",
  "teacherUnits.availabilityClosed",
  "teacherUnits.deploymentIneligible",
  "teacherUnits.policyChanged",
  "teacherUnits.placementMismatch",
  "teacherUnits.contractUnsupported",
]);

// True for codes that report Teacher Units availability rather than the
// request itself (read surfaces use this to word refusals).
export function isTeacherUnitsAvailabilityCode(code: string): boolean {
  return A3_UNCONFIRMED_CODES.has(code);
}

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
  if (err instanceof TeacherUnitsCompatibilityError) {
    return make("compatibilityBlocked", "retry", code, "We couldn't verify Teacher Units compatibility. This request was not sent. Try again after refreshing.");
  }
  const details = readDetails(err);

  switch (code) {
    // writeConflict and invalidStatus are decided inside a transaction. Under
    // A3-3 Option A (U2_6_A3_3_APPROVED_DECISIONS.md section 5.1) an earlier
    // SDK attempt of the same request may already have committed, so neither
    // proves the change was not saved. Reconcile by reading; never resend.
    case "teacherUnits.writeConflict":
      return make(
        "conflict",
        "refresh",
        code,
        "This unit was changed somewhere else, so we couldn't confirm whether your change was saved. Refresh to load the latest version before making your change again.",
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
        "This unit is archived, so we couldn't confirm whether your change was saved. Refresh to check, then restore the unit to make changes.",
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
    case "teacherUnits.responseUnavailable":
      // Decision 2: after a confirmed commit the response could not be
      // produced. The write may have landed; it is never a rejection.
      return make(
        "unconfirmed",
        "refresh",
        code,
        "Your change may have been saved, but it could not be confirmed. Reload your units before trying again.",
      );
    case "teacherUnits.listLimitExceeded":
      return make(
        "limitExceeded",
        "none",
        code,
        "You have too many units to show at once. Contact LyfeLabz support.",
      );
  }

  if (A3_UNCONFIRMED_CODES.has(code)) {
    return make(
      "unconfirmed",
      "refresh",
      code,
      "Teacher Units isn't available right now, so we couldn't confirm whether your change was saved. Reload your units before trying again.",
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
      "refresh",
      code,
      "We couldn't confirm whether your change was saved. Check your connection, then refresh to check before trying again.",
    );
  }
  return make(
    "unexpected",
    "refresh",
    code,
    "Something went wrong and we couldn't confirm whether your change was saved. Refresh to check before trying again.",
  );
}

// A3-4 S2: there is no resend signal. After any failure of a dispatched
// revision-guarded mutation (update, archive, restore, setResources,
// reorder), including network and unexpected failures, the same request is
// never sent again: the first attempt may have committed. Outcomes are
// reconciled by an authoritative read (mutationReconciliation.ts), and any
// further change is a new, deliberate teacher action built from freshly read
// state. Create keys are owned by the create coordinator (saveCoordination.ts).
