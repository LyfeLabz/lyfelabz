import type { CallableRequest } from "firebase-functions/v2/https";
import type { Transaction } from "firebase-admin/firestore";

import { PlatformError } from "../errors/platform-error";
import { schoolDocRef, userRecordDocRef } from "../firestore/typed-ref";

// The verified administrator context returned to callables that require the
// caller to be an ACTIVE Platform Administrator. Every field is derived from
// the canonical Firestore records, never from the caller's signed token, so
// a stale token whose claims survived a canonical demotion/suspension can
// never confer authority.
//
// Phase 8G.12: `platformAdministrator` currently carries canonical
// `schoolId`/`districtId` tenant context (see PDR-025 §6 and the claims
// helper). The context is resolved here from `users/{uid}.schoolId` and
// `schools/{schoolId}.districtId` so callables that need tenant context use
// canonical data rather than trusting token `schoolId`/`districtId` claims.
export type ActivePlatformAdministratorContext = {
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Cheap request-boundary gate: establishes the CLAIMED caller identity and
// administrator role from the signed token. This is intentionally NOT the
// authoritative check - the token claim can be stale. It runs first only to
// reject anonymous/non-administrator callers before a Firestore read, and to
// preserve the existing unauthenticated/unauthorized error taxonomy each
// callable already surfaces. `errorPrefix` lets a callable keep its own
// domain-scoped error id namespace (e.g. `schools.` / `teachers.` /
// `identity.productionInventory.`).
function assertClaimedAdministrator(
  request: CallableRequest<unknown>,
  unauthenticatedCode: string,
  unauthorizedCode: string,
): { readonly uid: string } {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throw new PlatformError(
      unauthenticatedCode,
      "An authenticated caller is required.",
    );
  }
  const token = auth.token as { readonly role?: unknown } | undefined;
  if (!token || token.role !== "platformAdministrator") {
    throw new PlatformError(
      unauthorizedCode,
      "Caller must be a Platform Administrator.",
    );
  }
  return { uid: auth.uid };
}

export type RequireActivePlatformAdministratorOptions = {
  // Domain-scoped error id used when the caller is unauthenticated. Defaults
  // to `admin.unauthenticated`.
  readonly unauthenticatedCode?: string;
  // Domain-scoped error id used when the caller lacks the administrator
  // claim OR fails the authoritative canonical check. A single code is used
  // for both so the callable does not leak whether the claim was present but
  // canonically invalid. Defaults to `admin.unauthorized`.
  readonly unauthorizedCode?: string;
};

// Authoritative Platform Administrator guard (Phase 8G.12, Part 2).
//
// Verifies administrative authority against BOTH the authenticated caller's
// signed claims AND canonical Firestore state, closing the stale-admin-token
// window that a claim-only check leaves open. An administrator whose token
// still carries `role: "platformAdministrator"` after a canonical demotion,
// suspension, archival, or `authUid` divergence is refused here because the
// canonical record no longer satisfies the required properties:
//
//   - `users/{uid}` exists and is readable;
//   - `authUid` equals the caller UID (structural identity invariant);
//   - `status === "active"`;
//   - `role === "platformAdministrator"`;
//   - `schoolId` is a non-empty string;
//   - `schools/{schoolId}` exists and resolves a non-empty `districtId`.
//
// The returned tenant context is derived entirely from canonical records.
// The helper performs no writes, issues no claims, and emits no audit
// events. It is the shared read-side counterpart to the stronger
// in-transaction administrator validation `teachersSuspend` performs; a
// callable that mutates state on the strength of administrator authority
// should prefer the in-transaction check when the mutation is itself
// transactional, and this helper otherwise.
export async function requireActivePlatformAdministrator(
  request: CallableRequest<unknown>,
  options: RequireActivePlatformAdministratorOptions = {},
): Promise<ActivePlatformAdministratorContext> {
  const unauthenticatedCode =
    options.unauthenticatedCode ?? "admin.unauthenticated";
  const unauthorizedCode = options.unauthorizedCode ?? "admin.unauthorized";

  const { uid } = assertClaimedAdministrator(
    request,
    unauthenticatedCode,
    unauthorizedCode,
  );

  const userSnapshot = await userRecordDocRef(uid).get();
  const user = userSnapshot.exists ? userSnapshot.data() : undefined;
  if (
    !user ||
    user.authUid !== uid ||
    user.status !== "active" ||
    user.role !== "platformAdministrator"
  ) {
    throw new PlatformError(
      unauthorizedCode,
      "Caller is not an active Platform Administrator.",
    );
  }
  if (!isNonEmptyString(user.schoolId)) {
    throw new PlatformError(
      unauthorizedCode,
      "Caller's administrator record has no schoolId recorded.",
    );
  }
  const schoolId = user.schoolId;

  const schoolSnapshot = await schoolDocRef(schoolId).get();
  const school = schoolSnapshot.exists
    ? (schoolSnapshot.data() as
        | (Record<string, unknown> & { districtId?: unknown })
        | undefined)
    : undefined;
  if (!school) {
    throw new PlatformError(
      unauthorizedCode,
      "Caller's administrator school could not be resolved.",
    );
  }
  const districtId = school.districtId;
  if (!isNonEmptyString(districtId)) {
    throw new PlatformError(
      unauthorizedCode,
      "Caller's administrator school is not assigned to a district.",
    );
  }

  return { uid, schoolId, districtId };
}

// Authoritative Platform Administrator guard, evaluated INSIDE a caller
// provided Firestore transaction (Phase 8G.12A, Part 2). This is the
// mutation-time authority check: a mutating administrative callable performs
// it as its first transactional read so that the administrative mutation and
// its audit cannot commit if the caller was canonically demoted, suspended,
// archived, or otherwise invalidated after the cheap pre-transaction guard
// passed but before the transaction commits (closing the demotion race).
//
// Firestore requires all transactional reads to precede all writes, so this
// MUST be called before any `tx` write. It reads the caller's canonical
// `users/{uid}` record and the caller's `schools/{schoolId}` record, and
// enforces the same properties as the request-boundary guard:
//
//   - `authUid === callerUid`;
//   - `status === "active"`;
//   - `role === "platformAdministrator"`;
//   - a non-empty canonical `schoolId`;
//   - a resolvable non-empty `districtId` on the canonical school.
//
// It performs no writes, issues no claims, and emits no audit events. The
// returned tenant context is derived entirely from canonical records.
export async function assertActivePlatformAdministratorInTransaction(
  tx: Transaction,
  callerUid: string,
  options: { readonly unauthorizedCode?: string } = {},
): Promise<ActivePlatformAdministratorContext> {
  const unauthorizedCode = options.unauthorizedCode ?? "admin.unauthorized";

  if (!isNonEmptyString(callerUid)) {
    throw new PlatformError(
      unauthorizedCode,
      "An authenticated caller is required.",
    );
  }

  const userSnapshot = await tx.get(userRecordDocRef(callerUid));
  const user = userSnapshot.exists ? userSnapshot.data() : undefined;
  if (
    !user ||
    user.authUid !== callerUid ||
    user.status !== "active" ||
    user.role !== "platformAdministrator"
  ) {
    throw new PlatformError(
      unauthorizedCode,
      "Caller is not an active Platform Administrator.",
    );
  }
  if (!isNonEmptyString(user.schoolId)) {
    throw new PlatformError(
      unauthorizedCode,
      "Caller's administrator record has no schoolId recorded.",
    );
  }
  const schoolId = user.schoolId;

  const schoolSnapshot = await tx.get(schoolDocRef(schoolId));
  const school = schoolSnapshot.exists
    ? (schoolSnapshot.data() as
        | (Record<string, unknown> & { districtId?: unknown })
        | undefined)
    : undefined;
  if (!school) {
    throw new PlatformError(
      unauthorizedCode,
      "Caller's administrator school could not be resolved.",
    );
  }
  const districtId = school.districtId;
  if (!isNonEmptyString(districtId)) {
    throw new PlatformError(
      unauthorizedCode,
      "Caller's administrator school is not assigned to a district.",
    );
  }

  return { uid: callerUid, schoolId, districtId };
}
