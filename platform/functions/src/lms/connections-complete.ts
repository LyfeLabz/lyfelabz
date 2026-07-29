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
// Connection lifecycle callable (complete) per PDR-020c. Exchanges the
// authorization code for tokens through the provider adapter, records
// the tokens through the server-only token store (PDR-019e,
// LMS_INTEGRATION_ARCHITECTURE.md §5.3), and creates the canonical
// `lmsConnections/{connectionId}` document. Idempotent under the Sprint 2
// helper contract: a replayed completion with the same (teacherId,
// providerId) pair returns the existing connection without minting a
// second token.

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

  const existingSnapshot = await lmsConnectionDocRef(connectionId).get();
  if (existingSnapshot.exists) {
    const existing = existingSnapshot.data();
    if (
      existing &&
      existing.teacherId === actor.uid &&
      existing.providerId === providerId &&
      existing.status === "active"
    ) {
      safeLog(() =>
        log.info("lms.connectionCompleteIdempotent", {
          actorUserId: actor.uid,
          connectionId,
        }),
      );
      return { connectionId, providerId, alreadyConnected: true };
    }
  }

  // Server-side OAuth state pre-check. The state store atomically
  // consumes the record during `adapter.completeOAuth`; this peek
  // enforces the teacher binding BEFORE the atomic consume so a
  // mismatched teacher does not exchange the authorization code.
  // Every internal validation failure surfaces as the single public
  // `lms.invalidOAuthState` code (Sprint 23B security completion).
  const stateStore = getLmsOAuthStateStore();
  const binding = await stateStore.peek(state);
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

  const adapter = getProviderAdapter(providerId);
  let grant;
  try {
    grant = await adapter.completeOAuth({ code, state, redirectUri });
  } catch (err) {
    throw coerceOAuthStateError(err);
  }

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

  return { connectionId, providerId, alreadyConnected: false };
}

export const lmsConnectionsComplete = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsConnectionsCompleteHandler = handler;
