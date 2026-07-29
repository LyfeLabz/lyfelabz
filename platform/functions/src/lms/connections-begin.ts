import { type CallableRequest } from "firebase-functions/v2/https";

import {platformCallable, PlatformError } from "../shared";

import { getLmsOAuthStateStore } from "./oauth-state/state-store";
import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import { getProviderAdapter, isRegisteredProvider } from "./providers/registry";
import {
  assertAuthenticatedTeacherForLms,
  requireNonEmptyString,
} from "./shared/actor";

// lmsConnectionsBegin
//
// Connection lifecycle callable (begin) per PDR-020c. Starts the OAuth
// grant against the requested provider and returns the authorization URL
// and opaque state token. The callable performs no Firestore write; the
// connection document is created on completion by lmsConnectionsComplete
// per PDR-019e (server-only tokens) and PDR-019g (additive schema
// evolution).
//
// The provider is resolved through the registry per PDR-020f (provider
// neutrality is permanent); no Google-specific concern reaches this
// file.

export type LmsConnectionsBeginRequest = {
  readonly providerId: string;
  readonly redirectUri: string;
};

export type LmsConnectionsBeginResponse = {
  readonly authorizationUrl: string;
  readonly state: string;
};

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsConnectionsBeginResponse> {
  // Sprint 23B: idempotent production binding installer. No-op if a
  // test has already installed a fixture transport / config, so unit
  // tests keep working unchanged.
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
  // Discard any outstanding OAuth state records this teacher may have
  // issued for the same provider in a prior, incomplete `begin` call.
  // A restarted-connection flow (teacher closes the tab, hits begin
  // again) leaves at most one live pending record instead of accreting
  // one per attempt. Best-effort: an in-process store failure here
  // does not block issuing a fresh record.
  try {
    await getLmsOAuthStateStore().revokeForTeacher({
      teacherId: actor.uid,
      providerId,
    });
  } catch {
    // Intentional: revocation is a hygiene step, not a lifecycle step.
  }

  const adapter = getProviderAdapter(providerId);
  const { authorizationUrl, state } = await adapter.beginOAuth({
    teacherId: actor.uid,
    redirectUri,
  });
  return { authorizationUrl, state };
}

export const lmsConnectionsBegin = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsConnectionsBeginHandler = handler;
