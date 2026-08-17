import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  lmsClassLinkDocRef,
  lmsConnectionDocRef,
} from "../shared";

import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import { getProviderAdapter } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { resolveLiveCredential } from "./tokens/credential-resolver";

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
  // Install the Google Classroom production config/transport bindings at
  // handler entry (Sprint 25 B9 certification finding). This callable
  // reaches the upstream provider through `adapter.listClassTopics`, so it
  // must independently bind its own transport rather than depend on a
  // sibling callable having already run in the same worker. The installer
  // is idempotent and respects a test-injected transport.
  ensureGoogleClassroomProductionBindings();
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

  // Resolve a live credential: an expired/near-expiry access token is
  // refreshed in place before the topic read (PDR-030h).
  const bundle = await resolveLiveCredential(connection.tokenRef);
  const adapter = getProviderAdapter(connection.providerId);
  const topics = await adapter.listClassTopics({
    accessToken: bundle.accessToken,
    lmsClassId: link.lmsClassId,
  });

  return {
    topics: topics.map((t) => ({ lmsTopicId: t.lmsTopicId, name: t.name })),
  };
}

export const lmsClassesListTopics = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsClassesListTopicsHandler = handler;
