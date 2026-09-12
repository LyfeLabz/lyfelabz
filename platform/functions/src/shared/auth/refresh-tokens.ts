import { PlatformError } from "../errors/platform-error";
import { getAdminAuth } from "./admin";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// The single canonical path for revoking a user's Firebase refresh tokens.
//
// Clearing custom claims alone does not immediately strip authorization: an
// already-issued ID token keeps its stale claims until it expires (up to an
// hour). Revoking refresh tokens invalidates every outstanding token as soon
// as the relying party re-verifies (`verifyIdToken(idToken, true)` / Rules on
// the server), so the two operations together are what withdraw active
// access. Authoritative status enforcement on the affected authorization
// boundaries is what makes suspension fail closed in the intervening window
// (see teachersSuspend and the LMS actor gate); refresh-token revocation is
// the durable Auth-side cleanup that removes the stale credential itself.
//
// Idempotent by construction: revocation records a "tokens valid after"
// timestamp on the Auth user, so re-revoking simply advances that timestamp.
// This is relied on by the idempotent suspension replay, which re-runs the
// Auth cleanup to repair a partially completed prior suspension. The Firebase
// Auth identity itself is never deleted.
export async function revokeUserRefreshTokens(uid: string): Promise<void> {
  if (!isNonEmptyString(uid)) {
    throw new PlatformError(
      "auth.invalidUid",
      "uid must be a non-empty string.",
    );
  }
  try {
    await getAdminAuth().revokeRefreshTokens(uid);
  } catch (err) {
    throw new PlatformError(
      "auth.revokeRefreshTokensFailed",
      "Failed to revoke refresh tokens.",
      err,
    );
  }
}
