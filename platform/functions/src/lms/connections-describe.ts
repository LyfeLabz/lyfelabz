import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  lmsConnectionsCollectionRef,
  type LmsConnectionStatus,
  type LmsProviderId,
} from "../shared";

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
};

export type LmsConnectionsDescribeResponse = {
  readonly connections: readonly LmsConnectionSummary[];
};

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsConnectionsDescribeResponse> {
  const actor = assertAuthenticatedTeacherForLms(request);
  try {
    const snapshot = await lmsConnectionsCollectionRef()
      .where("teacherId", "==", actor.uid)
      .get();
    const connections = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        connectionId: doc.id,
        providerId: data.providerId,
        status: data.status,
        scopes: data.scopes,
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
