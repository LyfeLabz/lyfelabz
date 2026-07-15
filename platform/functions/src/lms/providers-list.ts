import { type CallableRequest } from "firebase-functions/v2/https";

import { platformCallable, type LmsProviderId } from "../shared";

import { listRegisteredProviders } from "./providers/registry";
import { assertAuthenticatedTeacherForLms } from "./shared/actor";

// lmsProvidersList
//
// Provider-discovery callable per PDR-020c ("provider discovery"). Returns
// the closed set of registered LMS providers so the Teacher Workspace can
// render the Settings > Integrations surface without hardcoding provider
// identifiers on the client. The result contains no PII and no token
// material; it is a read of the registry only.
//
// The callable is intentionally boring per the Cloud Function Charter's
// boring-function philosophy: no upstream network calls, no Firestore
// writes, no audit event.

export type LmsProvidersListResponse = {
  readonly providers: readonly {
    readonly providerId: LmsProviderId;
    readonly displayName: string;
  }[];
};

function handler(
  request: CallableRequest<unknown>,
): Promise<LmsProvidersListResponse> {
  assertAuthenticatedTeacherForLms(request);
  return Promise.resolve({
    providers: listRegisteredProviders().map((p) => ({
      providerId: p.providerId,
      displayName: p.displayName,
    })),
  });
}

export const lmsProvidersList = platformCallable(handler);
export const __lmsProvidersListHandler = handler;
