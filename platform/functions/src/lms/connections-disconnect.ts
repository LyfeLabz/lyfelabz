import { FieldValue } from "firebase-admin/firestore";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  lmsConnectionDocRef,
  lmsConnectionRevocationDocRef,
  log,
  writeAuditEvent,
  type LmsConnectionRevocationWrite,
} from "../shared";

import { getProviderAdapter } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { getLmsTokenStore } from "./tokens/token-store";

// lmsConnectionsDisconnect
//
// Connection lifecycle callable (revoke) per PDR-020c. Marks the caller's
// connection `revoked`, revokes the upstream grant through the adapter,
// and discards the stored token bundle. Every LMS interaction is
// reversible from the teacher's side per PDR-019c; disconnect is the
// canonical reversal.

export type LmsConnectionsDisconnectRequest = {
  readonly connectionId: string;
};

export type LmsConnectionsDisconnectResponse = {
  readonly connectionId: string;
  readonly alreadyRevoked: boolean;
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
): Promise<LmsConnectionsDisconnectResponse> {
  const actor = assertAuthenticatedTeacherForLms(request);
  if (request.data === null || typeof request.data !== "object") {
    throw new PlatformError(
      "lms.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = request.data as Record<string, unknown>;
  const connectionId = requireNonEmptyString(
    payload.connectionId,
    "lms.invalidConnectionId",
    "connectionId must be a non-empty string.",
  );

  const snapshot = await lmsConnectionDocRef(connectionId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "lms.connectionNotFound",
      "No connection matches this identifier.",
    );
  }
  const existing = snapshot.data();
  if (!existing) {
    throw new PlatformError(
      "lms.connectionNotFound",
      "Connection record was empty.",
    );
  }
  if (existing.teacherId !== actor.uid) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own this connection.",
    );
  }
  if (existing.status === "revoked") {
    return { connectionId, alreadyRevoked: true };
  }

  // Best-effort upstream revocation. The mirror is still marked `revoked`
  // if the upstream call fails; a residual upstream grant is followed up
  // by the operational runbook (LMS_INTEGRATION_ARCHITECTURE.md §10.3.3).
  try {
    const store = getLmsTokenStore();
    const bundle = await store.resolve(existing.tokenRef);
    const adapter = getProviderAdapter(existing.providerId);
    await adapter.revokeGrant({
      accessToken: bundle.accessToken,
      refreshToken: bundle.refreshToken,
    });
    await store.revoke(existing.tokenRef);
  } catch (err) {
    safeLog(() =>
      log.warn("lms.upstreamRevocationFailed", {
        actorUserId: actor.uid,
        connectionId,
        error: (err as Error)?.message,
      }),
    );
  }

  const write: LmsConnectionRevocationWrite = {
    status: "revoked",
    revokedAt: FieldValue.serverTimestamp(),
  };
  await lmsConnectionRevocationDocRef(connectionId).update(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "lms.connectionRevoked",
    targetType: "lmsConnection",
    targetId: connectionId,
    schoolId: actor.schoolId,
    payload: { providerId: existing.providerId },
  });

  return { connectionId, alreadyRevoked: false };
}

export const lmsConnectionsDisconnect = onCall(handler);
export const __lmsConnectionsDisconnectHandler = handler;
