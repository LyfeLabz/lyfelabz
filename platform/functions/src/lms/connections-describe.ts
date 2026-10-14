import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  lmsConnectionsCollectionRef,
  type LmsConnectionStatus,
  type LmsProviderId,
} from "../shared";

import { getProviderAdapter, isRegisteredProvider } from "./providers/registry";
import { assertAuthenticatedTeacherForLms } from "./shared/actor";

// lmsConnectionsDescribe
//
// Connection lifecycle callable (describe) per PDR-020c. Returns the
// caller's own connection state for every registered provider. The
// callable does NOT return the token reference field to the client;
// tokens are server-only per PDR-019e.
//
// A teacher who has never connected any provider receives an empty
// array. This is the canonical read the Settings > Integrations surface
// uses to render the "Connect" affordance without leaking any other
// teacher's connection state.

export type LmsConnectionSummary = {
  readonly connectionId: string;
  readonly providerId: LmsProviderId;
  readonly status: LmsConnectionStatus;
  readonly scopes: readonly string[];
  // Unified onboarding authorization: whether the recorded grant already
  // covers topics, publication, scheduling, and grade passback. Derived by
  // the owning adapter from the recorded scopes, so the client never
  // interprets provider scope strings. A connection missing it needs one
  // teacher-initiated authorization upgrade before Classroom publishing.
  readonly publicationAuthorized: boolean;
};

export type LmsConnectionsDescribeResponse = {
  readonly connections: readonly LmsConnectionSummary[];
};

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsConnectionsDescribeResponse> {
  const actor = await assertAuthenticatedTeacherForLms(request);
  try {
    const snapshot = await lmsConnectionsCollectionRef()
      .where("teacherId", "==", actor.uid)
      .get();
    const connections = snapshot.docs.map((doc) => {
      const data = doc.data();
      const scopes: readonly string[] = Array.isArray(data.scopes)
        ? data.scopes
        : [];
      return {
        connectionId: doc.id,
        providerId: data.providerId,
        status: data.status,
        scopes: data.scopes,
        publicationAuthorized: isRegisteredProvider(data.providerId)
          ? getProviderAdapter(data.providerId).describeGrantedCapabilities(
              scopes,
            ).publication
          : false,
      };
    });
    return { connections };
  } catch (err) {
    throw new PlatformError(
      "lms.describeFailed",
      "Failed to describe connections.",
      err,
    );
  }
}

export const lmsConnectionsDescribe = platformCallable(handler);
export const __lmsConnectionsDescribeHandler = handler;
