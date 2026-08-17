import { PlatformError, log } from "../../shared";
import { getProviderAdapter } from "../providers/registry";

import { getLmsTokenStore, type LmsTokenBundle } from "./token-store";

// Central vendor-neutral credential resolver (Sprint 25 credential-refresh
// lifecycle, PDR-030h).
//
// -------------------- Why this module exists --------------------
//
// Every Cloud Function that calls an upstream LMS on a teacher's behalf must
// hand the provider adapter a *live* access token. Google Classroom access
// tokens expire ~1 hour after they are minted; the stored refresh token
// outlives them. Before this module, callables resolved the stored bundle
// verbatim (`getLmsTokenStore().resolve`) and passed a possibly-expired
// access token straight to the provider, which then failed with HTTP 401
// `invalid_token` (Sprint 25 B8 live-certification evidence). The refresh
// transport already existed but no production caller invoked it.
//
// This resolver is the single seam every LMS callable now flows through
// instead of `resolve`. Refreshing here (rather than inside each callable)
// means course discovery, roster read, topic listing, assignment
// publication, and every future Classroom operation self-heal an expired
// credential automatically, without the teacher reconnecting and without
// changing the granted scope set.
//
// -------------------- Refresh policy --------------------
//
// A refresh is attempted only when the stored access token is expired or
// within `ACCESS_TOKEN_REFRESH_SKEW_MS` of expiry. A comfortably-valid token
// is returned untouched, so the common path issues no extra work. A bundle
// with no recorded expiry is treated as non-expiring (legacy shape) and
// returned as-is. A bundle whose expiry is due but which holds no refresh
// material is returned unchanged so the existing explicit
// authorization-failure behavior is preserved: the upstream call fails with
// the normal 401 -> lms.upstreamAuthorizationFailed path rather than being
// masked here.

// Refresh when the token is within this window of expiry (or already past
// it). Google access tokens live ~3600s; a 5-minute skew guarantees a token
// handed to an upstream call retains comfortable validity for the duration
// of that call even under modest clock skew between this host and Google, and
// avoids sending a token that expires mid-request. The window is small enough
// that a token is not refreshed on every request (a fresh token is reused for
// ~55 minutes).
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// Resolve a live token bundle for `tokenRef`, refreshing the access token
// first when it is expired or near expiry. Returns the bundle a caller should
// use for its immediate upstream call. The refreshed bundle is persisted
// (in place, same tokenRef) via a compare-and-swap so concurrent workers
// converge without corrupting or regressing state.
export async function resolveLiveCredential(
  tokenRef: string,
): Promise<LmsTokenBundle> {
  const store = getLmsTokenStore();
  const bundle = await store.resolve(tokenRef);

  // No recorded expiry: legacy/non-expiring shape. Nothing to refresh.
  if (bundle.expiresAtEpochMs === undefined) return bundle;

  const now = Date.now();
  const msUntilExpiry = bundle.expiresAtEpochMs - now;
  if (msUntilExpiry > ACCESS_TOKEN_REFRESH_SKEW_MS) {
    // Comfortably valid; reuse without refreshing.
    return bundle;
  }

  // Due for refresh, but there is nothing to refresh with. Preserve the
  // existing explicit-authorization-failure behavior: hand back the stored
  // token so the upstream call surfaces the normal 401 path.
  if (
    typeof bundle.refreshToken !== "string" ||
    bundle.refreshToken.length === 0
  ) {
    return bundle;
  }

  const reason = msUntilExpiry <= 0 ? "expired" : "near_expiry";
  safeLog(() =>
    log.info("lms.accessTokenRefreshStarted", {
      providerId: bundle.providerId,
      teacherId: bundle.teacherId,
      tokenRef,
      priorExpiryEpochMs: bundle.expiresAtEpochMs,
      reason,
    }),
  );

  const adapter = getProviderAdapter(bundle.providerId);

  let refreshed;
  try {
    refreshed = await adapter.refreshCredential({
      refreshToken: bundle.refreshToken,
    });
  } catch (err) {
    const errorCode =
      err instanceof PlatformError ? err.code : "lms.accessTokenRefreshFailed";
    safeLog(() =>
      log.warn("lms.accessTokenRefreshFailed", {
        providerId: bundle.providerId,
        teacherId: bundle.teacherId,
        tokenRef,
        priorExpiryEpochMs: bundle.expiresAtEpochMs,
        reason,
        errorCode,
      }),
    );
    // An unrecoverable credential (the refresh token itself was revoked or
    // expired -> the adapter maps invalid_grant / 401 to
    // lms.upstreamAuthorizationFailed) cannot self-heal; the teacher must
    // reconnect. Surface a distinct, stable code so the callable reports the
    // correct normalized failure and never falsely marks success. The
    // connection document is intentionally NOT mutated here (see PDR-030h:
    // the status transition is deferred to avoid coupling the resolver to the
    // connection surface; the normalized error already drives the failure
    // path). A transient upstream failure propagates verbatim so the caller
    // does not treat a temporary outage as a reconnect requirement.
    if (
      err instanceof PlatformError &&
      err.code === "lms.upstreamAuthorizationFailed"
    ) {
      throw new PlatformError(
        "lms.reconnectRequired",
        "The stored LMS credential can no longer be refreshed; the teacher must reconnect.",
        err,
      );
    }
    throw err instanceof PlatformError
      ? err
      : new PlatformError(
          "lms.accessTokenRefreshFailed",
          "The stored LMS credential could not be refreshed.",
          err,
        );
  }

  const merged = await store.persistRefreshedCredential({
    tokenRef,
    observedExpiresAtEpochMs: bundle.expiresAtEpochMs,
    refreshed: {
      accessToken: refreshed.accessToken,
      ...(refreshed.expiresInSeconds !== undefined
        ? { expiresAtEpochMs: Date.now() + refreshed.expiresInSeconds * 1000 }
        : {}),
      ...(refreshed.refreshToken !== undefined
        ? { refreshToken: refreshed.refreshToken }
        : {}),
      ...(refreshed.scopes !== undefined ? { scopes: refreshed.scopes } : {}),
    },
  });

  safeLog(() =>
    log.info("lms.accessTokenRefreshed", {
      providerId: bundle.providerId,
      teacherId: bundle.teacherId,
      tokenRef,
      priorExpiryEpochMs: bundle.expiresAtEpochMs,
      refreshedExpiryEpochMs: merged.expiresAtEpochMs,
      reason,
    }),
  );

  return merged;
}
