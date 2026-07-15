import { type CallableRequest } from "firebase-functions/v2/https";

import {platformCallable, PlatformError, lmsConnectionDocRef } from "../shared";

import { getProviderAdapter } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { getLmsTokenStore } from "./tokens/token-store";

// lmsClassesDiscover
//
// Classroom discovery callable per PDR-020c ("class discovery"). Lists
// the classes the calling teacher is the teacher-of-record for at the
// upstream provider, using the token bundle resolved by the server-only
// token store. Discovery reads no roster, no assignment, and no PII
// beyond the minimum required for the teacher to select a class to
// import (PDR-019k).

export type LmsClassesDiscoverRequest = {
  readonly connectionId: string;
};

export type LmsClassesDiscoverResponse = {
  readonly candidates: readonly {
    readonly lmsClassId: string;
    readonly name: string;
    readonly section?: string;
  }[];
};

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsClassesDiscoverResponse> {
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
  if (existing.status !== "active") {
    throw new PlatformError(
      "lms.connectionNotActive",
      "Connection is not active.",
    );
  }

  const bundle = await getLmsTokenStore().resolve(existing.tokenRef);
  const adapter = getProviderAdapter(existing.providerId);
  const discovered = await adapter.listTeacherClasses({
    accessToken: bundle.accessToken,
  });

  return {
    candidates: discovered.map((c) => ({
      lmsClassId: c.lmsClassId,
      name: c.name,
      ...(c.section !== undefined ? { section: c.section } : {}),
    })),
  };
}

export const lmsClassesDiscover = platformCallable(handler);
export const __lmsClassesDiscoverHandler = handler;
