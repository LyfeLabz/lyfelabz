import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  lmsConnectionCreationDocRef,
  lmsConnectionDocRef,
  log,
  writeAuditEvent,
  type LmsConnectionCreationWrite,
} from "../shared";

import {
  getLmsOAuthStateStore,
  LMS_OAUTH_STATE_ERROR_CODES,
} from "./oauth-state/state-store";
import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import { getProviderAdapter, isRegisteredProvider } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { lmsConnectionIdFor } from "./shared/ids";
import { getLmsTokenStore } from "./tokens/token-store";

// Single public error code for every server-side OAuth state failure.
// The store throws granular internal codes (unknown, expired, replayed,
// mismatched provider, mismatched redirect, teacher mismatch); the
// callable coerces every one of them into this single code so a caller
// cannot use error granularity to enumerate server state (Sprint 23B
// security completion §CONSUME REQUIREMENTS item 10).
const OAUTH_STATE_PUBLIC_ERROR_CODE = "lms.invalidOAuthState";
const OAUTH_STATE_PUBLIC_ERROR_MESSAGE =
  "The OAuth authorization request could not be validated.";

// Internal store error codes that the callable maps onto the single
// public code. Any other thrown error is re-thrown unchanged so an
// unrelated failure (e.g. adapter transport unbound) is not silently
// masked.
const OAUTH_STATE_INTERNAL_CODES: ReadonlySet<string> = new Set([
  LMS_OAUTH_STATE_ERROR_CODES.invalidInput,
  LMS_OAUTH_STATE_ERROR_CODES.notFound,
  LMS_OAUTH_STATE_ERROR_CODES.expired,
  LMS_OAUTH_STATE_ERROR_CODES.consumed,
  LMS_OAUTH_STATE_ERROR_CODES.providerMismatch,
  LMS_OAUTH_STATE_ERROR_CODES.redirectMismatch,
  LMS_OAUTH_STATE_ERROR_CODES.intentMismatch,
]);

function coerceOAuthStateError(err: unknown): unknown {
  if (
    err instanceof PlatformError &&
    OAUTH_STATE_INTERNAL_CODES.has(err.code)
  ) {
    return new PlatformError(
      OAUTH_STATE_PUBLIC_ERROR_CODE,
      OAUTH_STATE_PUBLIC_ERROR_MESSAGE,
    );
  }
  return err;
}

// lmsConnectionsComplete
//
// Connection lifecycle callable (complete) per PDR-020c and PDR-030d.
// Exchanges the authorization code for tokens through the provider
// adapter, records the tokens through the server-only token store
// (PDR-019e, LMS_INTEGRATION_ARCHITECTURE.md §5.3), and either:
//   - creates the canonical `lmsConnections/{connectionId}` document
//     (new connection, consentOutcome "created"), or
//   - widens the scope set of an existing active connection when the
//     state binding carries the "publication" intent (PDR-030c, PDR-030d,
//     consentOutcome "widened" / "alreadyAuthorized").
//
// Idempotent under the Sprint 2 helper contract: a replayed completion
// with the same (teacherId, providerId) pair and a non-publication
// intent returns the existing connection without minting a second token.

export type LmsConnectionsCompleteRequest = {
  readonly providerId: string;
  readonly code: string;
  readonly state: string;
  readonly redirectUri: string;
};

export type LmsConnectionsCompleteResponse = {
  readonly connectionId: string;
  readonly providerId: string;
  readonly alreadyConnected: boolean;
  // Discriminator added by PDR-030d. Absent on the non-publication
  // idempotent early-return path (alreadyConnected: true, no intent).
  readonly consentOutcome?: "created" | "widened" | "alreadyAuthorized";
};

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsConnectionsCompleteResponse> {
  ensureGoogleClassroomProductionBindings();
  const actor = assertAuthenticatedTeacherForLms(request);
  if (request.data === null || typeof request.data !== "object") {
    throw new PlatformError(
      "lms.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = request.data as Record<string, unknown>;
  const providerId = requireNonEmptyString(
    payload.providerId,
    "lms.invalidProviderId",
    "providerId must be a non-empty string.",
  );
  const code = requireNonEmptyString(
    payload.code,
    "lms.invalidAuthorizationCode",
    "code must be a non-empty string.",
  );
  const state = requireNonEmptyString(
    payload.state,
    "lms.invalidState",
    "state must be a non-empty string.",
  );
  const redirectUri = requireNonEmptyString(
    payload.redirectUri,
    "lms.invalidRedirectUri",
    "redirectUri must be a non-empty string.",
  );
  if (!isRegisteredProvider(providerId)) {
    throw new PlatformError(
      "lms.unknownProvider",
      `Provider "${providerId}" is not registered.`,
    );
  }
  const connectionId = lmsConnectionIdFor(actor.uid, providerId);

  // Peek the OAuth state binding BEFORE the connection early-return
  // decision so we can determine the intent. The state is NOT consumed
  // here; consume runs inside adapter.completeOAuth.
  const stateStore = getLmsOAuthStateStore();
  const binding = await stateStore.peek(state);

  // Check for an existing active connection.
  const existingSnapshot = await lmsConnectionDocRef(connectionId).get();
  const existingData = existingSnapshot.exists ? existingSnapshot.data() : null;
  const hasActiveConnection =
    existingData !== null &&
    existingData !== undefined &&
    existingData.teacherId === actor.uid &&
    existingData.providerId === providerId &&
    existingData.status === "active";

  // Intent-aware idempotent early return. An active connection with a
  // non-publication intent is already complete; return without consuming
  // the OAuth state. A publication intent with an active connection falls
  // through to the scope-widening path below.
  if (hasActiveConnection && binding?.intent !== "publication") {
    safeLog(() =>
      log.info("lms.connectionCompleteIdempotent", {
        actorUserId: actor.uid,
        connectionId,
      }),
    );
    return { connectionId, providerId, alreadyConnected: true };
  }

  // Server-side OAuth state validation. The binding was peeked above;
  // validate teacher, provider, redirect, TTL, and non-consumed state
  // before consuming through the adapter. Every internal validation
  // failure surfaces as the single public `lms.invalidOAuthState` code
  // (Sprint 23B security completion §CONSUME REQUIREMENTS item 10).
  if (
    !binding ||
    binding.consumed ||
    Date.now() >= binding.expiresAtEpochMs ||
    binding.teacherId !== actor.uid ||
    binding.providerId !== providerId ||
    binding.redirectUri !== redirectUri
  ) {
    throw new PlatformError(
      OAUTH_STATE_PUBLIC_ERROR_CODE,
      OAUTH_STATE_PUBLIC_ERROR_MESSAGE,
    );
  }

  // Exchange the authorization code. This atomically consumes the state
  // record inside the adapter; a second attempt with the same state will
  // fail the consume step.
  const adapter = getProviderAdapter(providerId);
  let grant;
  try {
    grant = await adapter.completeOAuth({ code, state, redirectUri });
  } catch (err) {
    throw coerceOAuthStateError(err);
  }

  // Scope-widening path (PDR-030d): active connection + publication intent.
  //
  // The existing connection remains authoritative until widening succeeds.
  // The old token bundle is removed only after the connection document
  // update commits. The existing connection remains usable if widening
  // fails at any step before the document update.
  //
  // INVARIANT: the upstream Google OAuth grant is NEVER revoked during
  // widening. Only the local token store entry for the old tokenRef is
  // cleaned up after the new tokenRef is committed.
  if (hasActiveConnection && binding.intent === "publication" && existingData) {
    const oldTokenRef = existingData.tokenRef;

    // Resolve the existing token bundle for identity revalidation and
    // refresh-token carry-forward.
    let oldBundle;
    try {
      oldBundle = await getLmsTokenStore().resolve(oldTokenRef);
    } catch {
      throw new PlatformError(
        "lms.connectionTokenResolutionFailed",
        "Could not resolve the existing connection token bundle for scope widening.",
      );
    }

    // Identity revalidation: the upstream account on the new grant must
    // match the account on the existing connection (PDR-030d). A mismatch
    // refuses the scope widening.
    if (
      oldBundle.upstreamAccountIdentifier !== grant.upstreamAccountIdentifier
    ) {
      throw new PlatformError(
        "lms.identityMismatch",
        "The account used for scope widening does not match the account on the existing connection.",
      );
    }

    // Compute the merged scope set as a stable sorted union. Granted
    // scopes are persisted exactly as approved by the teacher.
    const mergedScopes = Array.from(
      new Set([...oldBundle.scopes, ...grant.scopes]),
    ).sort();

    // Already-authorized path: the new grant adds no scopes the connection
    // does not already hold. Idempotent return without writing anything.
    const oldScopesSorted = Array.from(new Set([...oldBundle.scopes])).sort();
    if (mergedScopes.join(" ") === oldScopesSorted.join(" ")) {
      return {
        connectionId,
        providerId,
        alreadyConnected: true,
        consentOutcome: "alreadyAuthorized",
      };
    }

    // Compose the new token bundle. Google often omits refresh_token on
    // incremental re-consent; preserve the old one when absent so the
    // connection retains offline access.
    const newBundle = {
      providerId,
      teacherId: actor.uid,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken ?? oldBundle.refreshToken,
      scopes: mergedScopes,
      expiresAtEpochMs:
        grant.expiresInSeconds !== undefined
          ? Date.now() + grant.expiresInSeconds * 1000
          : undefined,
      upstreamAccountIdentifier: grant.upstreamAccountIdentifier,
    };

    // Store the new bundle before updating the connection document so
    // the document update is atomic with a valid new tokenRef.
    const newTokenRef = await getLmsTokenStore().store(newBundle);

    // Commit the scope widening to the connection document. The existing
    // connection is authoritative until this write succeeds.
    await lmsConnectionDocRef(connectionId).update({
      scopes: mergedScopes,
      tokenRef: newTokenRef,
      scopesUpdatedAt: FieldValue.serverTimestamp(),
    });

    // Best-effort cleanup of the old local token bundle. This is a hygiene
    // step, not a lifecycle step. The old upstream Google grant is NOT
    // revoked here - only the local token store entry is removed.
    try {
      await getLmsTokenStore().revoke(oldTokenRef);
    } catch {
      // Intentional: cleanup failure does not fail the widening.
    }

    safeLog(() =>
      log.info("lms.connectionScopesWidened", {
        actorUserId: actor.uid,
        connectionId,
        providerId,
      }),
    );

    return {
      connectionId,
      providerId,
      alreadyConnected: true,
      consentOutcome: "widened",
    };
  }

  // New connection path: store tokens, create connection document, audit.
  const tokenRef = await getLmsTokenStore().store({
    providerId,
    teacherId: actor.uid,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    scopes: grant.scopes,
    expiresAtEpochMs:
      grant.expiresInSeconds !== undefined
        ? Date.now() + grant.expiresInSeconds * 1000
        : undefined,
    upstreamAccountIdentifier: grant.upstreamAccountIdentifier,
  });

  const write: LmsConnectionCreationWrite = {
    teacherId: actor.uid,
    schoolId: actor.schoolId,
    providerId,
    status: "active",
    scopes: grant.scopes,
    tokenRef,
    connectedAt: FieldValue.serverTimestamp(),
  };
  await lmsConnectionCreationDocRef(connectionId).set(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "lms.connectionCreated",
    targetType: "lmsConnection",
    targetId: connectionId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: { providerId },
  });

  safeLog(() =>
    log.info("lms.connectionCreated", {
      actorUserId: actor.uid,
      connectionId,
      providerId,
    }),
  );

  return { connectionId, providerId, alreadyConnected: false, consentOutcome: "created" };
}

export const lmsConnectionsComplete = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsConnectionsCompleteHandler = handler;
