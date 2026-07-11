import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import { PlatformError } from "../shared";

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
  const adapter = getProviderAdapter(providerId);
  const { authorizationUrl, state } = await adapter.beginOAuth({
    teacherId: actor.uid,
    redirectUri,
  });
  return { authorizationUrl, state };
}

export const lmsConnectionsBegin = onCall(handler);
export const __lmsConnectionsBeginHandler = handler;
