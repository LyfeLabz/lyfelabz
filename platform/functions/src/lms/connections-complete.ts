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

import { getProviderAdapter, isRegisteredProvider } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { lmsConnectionIdFor } from "./shared/ids";
import { getLmsTokenStore } from "./tokens/token-store";

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

  const adapter = getProviderAdapter(providerId);
  const grant = await adapter.completeOAuth({ code, state, redirectUri });

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

export const lmsConnectionsComplete = platformCallable(handler);
export const __lmsConnectionsCompleteHandler = handler;
