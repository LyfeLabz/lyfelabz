import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  lmsClassLinkDocRef,
  lmsConnectionDocRef,
} from "../shared";

import { getProviderAdapter } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { getLmsTokenStore } from "./tokens/token-store";

// lmsClassesListTopics
//
// Topic-list callable authorized by the Sprint 8D specification as the
// on-demand read the Assignment Dialog performs when a teacher opens the
// Google Classroom topic selector for an LMS-linked class row per
// ASSIGN_EXPERIENCE.md §5 ("LMS-linked class row shape"). Topics are
// LMS-owned per PDR-020g and are not mirrored into Firestore; the
// callable resolves them through the vendor-neutral provider adapter and
// returns them to the client in a single response.
//
// Ownership invariants:
//   - The caller must own the LyfeLabz class the link belongs to.
//   - The caller must own the connection the class is linked through.
//   - The link must be `linked`; a `broken` or `unlinked` link refuses.

export type LmsClassesListTopicsRequest = {
  readonly linkId: string;
};

export type LmsClassesListTopicsResponse = {
  readonly topics: readonly {
    readonly lmsTopicId: string;
    readonly name: string;
  }[];
};

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsClassesListTopicsResponse> {
  const actor = assertAuthenticatedTeacherForLms(request);
  if (request.data === null || typeof request.data !== "object") {
    throw new PlatformError(
      "lms.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = request.data as Record<string, unknown>;
  const linkId = requireNonEmptyString(
    payload.linkId,
    "lms.invalidLinkId",
    "linkId must be a non-empty string.",
  );

  const linkSnapshot = await lmsClassLinkDocRef(linkId).get();
  if (!linkSnapshot.exists) {
    throw new PlatformError("lms.linkNotFound", "No link matches this identifier.");
  }
  const link = linkSnapshot.data();
  if (!link) {
    throw new PlatformError("lms.linkNotFound", "Link record was empty.");
  }
  if (link.ownerUid !== actor.uid) {
    throw new PlatformError("lms.forbidden", "Caller does not own this link.");
  }
  if (link.status !== "linked") {
    throw new PlatformError(
      "lms.linkNotActive",
      "Link is not active; topics can only be listed for linked classes.",
    );
  }

  const connectionSnapshot = await lmsConnectionDocRef(link.connectionId).get();
  if (!connectionSnapshot.exists) {
    throw new PlatformError(
      "lms.connectionNotFound",
      "No connection matches this link.",
    );
  }
  const connection = connectionSnapshot.data();
  if (!connection) {
    throw new PlatformError("lms.connectionNotFound", "Connection record was empty.");
  }
  if (connection.teacherId !== actor.uid) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own the connection.",
    );
  }
  if (connection.status !== "active") {
    throw new PlatformError(
      "lms.connectionNotActive",
      "Connection is not active.",
    );
  }

  const bundle = await getLmsTokenStore().resolve(connection.tokenRef);
  const adapter = getProviderAdapter(connection.providerId);
  const topics = await adapter.listClassTopics({
    accessToken: bundle.accessToken,
    lmsClassId: link.lmsClassId,
  });

  return {
    topics: topics.map((t) => ({ lmsTopicId: t.lmsTopicId, name: t.name })),
  };
}

export const lmsClassesListTopics = onCall(handler);
export const __lmsClassesListTopicsHandler = handler;
