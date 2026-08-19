import { randomBytes } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentLmsPublicationDocRef,
  lmsAssignmentPublicationCreationDocRef,
  lmsClassLinkDocRef,
  lmsClassLinksCollectionRef,
  lmsConnectionDocRef,
  log,
  writeAuditEvent,
  type AuditAction,
  type LmsAssignmentPublicationCreationWrite,
} from "../shared";

import { buildAssignmentDeepLinkUrl } from "./deep-link-url";
import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import { getProviderAdapter } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { lmsAssignmentPublicationIdFor } from "./shared/ids";
import { resolveLiveCredential } from "./tokens/credential-resolver";

// lmsAssignmentsPublish
//
// Assignment publication callable authorized by the Sprint 8D
// specification as the explicit subsequent-sprint expansion of PDR-020c
// under its "Future Reconsideration" clause. Publishes a previously
// scheduled LyfeLabz assignment as an LMS-side pointer to the LyfeLabz
// surface where the work happens (LMS_INTEGRATION_ARCHITECTURE.md §7.3).
// Preserves every load-bearing invariant of PDR-019 and PDR-020:
//
//   - LyfeLabz owns the assignment; the LMS-side record is a side effect
//     (PDR-019d). The LyfeLabz `assignments/{assignmentId}` record is
//     never rewritten by this path; only the additive
//     `lmsPublicationRef` mirror pointer is set on success.
//   - The publication is one-way (§7.3). This callable never reads an
//     LMS-authored assignment.
//   - The teacher initiates every publication (PDR-019a: opt-in per
//     teacher, per class, per action). The client passes the assignment
//     and topic explicitly; the server never speculatively publishes.
//   - Provider neutrality is preserved (PDR-020f). No Google-specific
//     concern is present in this file; the adapter registry resolves the
//     provider by identifier and the vendor-neutral core knows only
//     `LmsProviderAdapter`.
//   - Server trust boundary (§5.4). OAuth tokens are resolved through
//     the server-only token store and never cross the callable's
//     response boundary.
//   - Failure is a routine event (§8). A failed publication writes a
//     `failed` publication record and a `lms.publishFailed` audit event
//     but never removes the LyfeLabz assignment or disturbs LyfeLabz-side
//     state. The teacher may re-attempt.
//
// Sprint 25 Phase 1 control-flow corrections (§2.4, §2.7, §2.2, §2.3):
//
//   - Completed-attempt guard: if the deterministic publicationId already
//     has a `succeeded` record, the callable returns that success without
//     issuing a second upstream POST (§2.2 server-side guard).
//   - lms.insufficientScope is non-terminal: no failed record and no
//     lms.publishFailed audit event are written; the client routes to
//     incremental consent (§2.7, blueprint §11).
//   - The single try/catch is split into Phase A (upstream call) and
//     Phase B (persistence and audit of a confirmed success), so:
//     (a) a later local failure cannot clobber a written succeeded record,
//     (b) the upstream assignment id is reachable from the orphan log path,
//     (c) audit failure does not invert a real success into a reported
//         failure.
//   - The adapter adds a 30 s AbortController-backed timeout to the
//     coursework POST (§2.3 Correction 3): the abort signal is threaded
//     into the transport so the in-flight request is genuinely cancelled,
//     the timer is always cleared, and a hang surfaces as
//     lms.upstreamCallFailed. This file does not re-add a timeout.

// Sprint 27 Phase 4 (blueprint Decision 4): the client no longer supplies the
// Classroom destination URL. The former `lyfelabzAssignmentUrl` field is
// removed from the request contract; the server constructs the sole
// coursework link material from the authoritative `assignmentId` it already
// loads, via the single authorized `buildAssignmentDeepLinkUrl` producer. A
// client value can no longer influence the Classroom destination (PDR-027
// §8.3).
export type LmsAssignmentsPublishRequest = {
  readonly assignmentId: string;
  readonly linkId: string;
  readonly title?: string;
  readonly instructions?: string;
  readonly lmsTopicId?: string;
  readonly attemptNonce?: string;
};

export type LmsAssignmentsPublishResponse = {
  readonly publicationId: string;
  readonly status: "succeeded" | "failed";
  readonly lmsAssignmentId?: string;
  readonly lmsAssignmentUrl?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
};

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsAssignmentsPublishResponse> {
  // Install the Google Classroom production config/transport bindings at
  // handler entry (Sprint 25 B9 certification finding). This callable
  // reaches the upstream provider through `adapter.publishAssignment`, so
  // it must independently bind its own transport rather than depend on a
  // sibling callable (import/discovery/sync) having already run in the same
  // worker. The installer is idempotent and respects a test-injected
  // transport, so it is safe under both production and fixture seams.
  ensureGoogleClassroomProductionBindings();
  const actor = assertAuthenticatedTeacherForLms(request);
  if (request.data === null || typeof request.data !== "object") {
    throw new PlatformError(
      "lms.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = request.data as Record<string, unknown>;
  const assignmentId = requireNonEmptyString(
    payload.assignmentId,
    "lms.invalidAssignmentId",
    "assignmentId must be a non-empty string.",
  );
  const linkId = requireNonEmptyString(
    payload.linkId,
    "lms.invalidLinkId",
    "linkId must be a non-empty string.",
  );
  // Sprint 27 Phase 4: the coursework destination is constructed
  // server-side from the authoritative assignmentId, never read from the
  // client. Any `lyfelabzAssignmentUrl` a client still sends on the request
  // is ignored (not read) and cannot influence the Classroom destination
  // (PDR-027 §8.3). The single authorized builder emits exactly
  // `https://app.lyfelabz.com/app/a/{assignmentId}`.
  const lyfelabzAssignmentUrl = buildAssignmentDeepLinkUrl(assignmentId);
  const titleOverride = optionalNonEmptyString(payload.title);
  const instructions = optionalNonEmptyString(payload.instructions);
  const lmsTopicId = optionalNonEmptyString(payload.lmsTopicId);
  const attemptNonce =
    optionalNonEmptyString(payload.attemptNonce) ??
    randomBytes(8).toString("hex");

  // Resolve the LyfeLabz assignment. Ownership is authorized on the
  // document itself (assignments are teacher-owned; §3.6 Data Model,
  // immutable ownership per §1.2). The assignment must be in a
  // publishable lifecycle state: `draft` and `published` are both
  // acceptable inputs because the publication is a side effect of
  // scheduling and does not itself drive the LyfeLabz lifecycle field.
  const assignmentSnapshot = await assignmentDocRef(assignmentId).get();
  if (!assignmentSnapshot.exists) {
    throw new PlatformError(
      "lms.assignmentNotFound",
      "No assignment matches this identifier.",
    );
  }
  const assignment = assignmentSnapshot.data();
  if (!assignment) {
    throw new PlatformError(
      "lms.assignmentNotFound",
      "Assignment record was empty.",
    );
  }
  if (assignment.teacherId !== actor.uid) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own this assignment.",
    );
  }
  if (assignment.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller schoolId does not match assignment schoolId.",
    );
  }
  if (assignment.status === "archived" || assignment.status === "closed") {
    throw new PlatformError(
      "lms.assignmentNotPublishable",
      "Assignment is closed or archived; publication is not available.",
    );
  }

  const linkSnapshot = await lmsClassLinkDocRef(linkId).get();
  if (!linkSnapshot.exists) {
    throw new PlatformError(
      "lms.linkNotFound",
      "No link matches this identifier.",
    );
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
      "Link is not active; only linked classes accept publications.",
    );
  }
  if (link.classId !== assignment.classId) {
    // The link must belong to the same class the assignment targets.
    // Publication into an unrelated linked class is prohibited so a
    // teacher cannot silently cross-post a LyfeLabz assignment out of
    // its own classroom.
    throw new PlatformError(
      "lms.linkClassMismatch",
      "Link does not belong to the assignment's class.",
    );
  }
  // Defense in depth against a stale link record: if the class carries
  // its own active link and the requested link does not match, refuse.
  const classActiveLinks = await lmsClassLinksCollectionRef()
    .where("classId", "==", link.classId)
    .where("status", "==", "linked")
    .get();
  const activeIds = classActiveLinks.docs.map((d) => d.id);
  if (activeIds.length > 0 && !activeIds.includes(linkId)) {
    throw new PlatformError(
      "lms.linkSuperseded",
      "Class is linked through a different link record.",
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
    throw new PlatformError(
      "lms.connectionNotFound",
      "Connection record was empty.",
    );
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

  const publicationId = lmsAssignmentPublicationIdFor(
    assignmentId,
    connection.providerId,
    attemptNonce,
  );

  // Completed-attempt guard (§2.2 server-side guard).
  // Read the deterministic publication record before issuing the upstream
  // coursework POST. If a record already exists with status `succeeded`,
  // return that success without a second upstream call and without emitting
  // a second audit event. An absent or failed record may proceed.
  const existingPublicationSnapshot = await lmsAssignmentPublicationCreationDocRef(
    publicationId,
  ).get();
  if (existingPublicationSnapshot.exists) {
    const existing = existingPublicationSnapshot.data();
    if (existing?.status === "succeeded") {
      return {
        publicationId,
        status: "succeeded",
        ...(typeof existing.lmsAssignmentId === "string" &&
        existing.lmsAssignmentId.length > 0
          ? { lmsAssignmentId: existing.lmsAssignmentId }
          : {}),
        ...(typeof existing.lmsAssignmentUrl === "string" &&
        existing.lmsAssignmentUrl.length > 0
          ? { lmsAssignmentUrl: existing.lmsAssignmentUrl }
          : {}),
      };
    }
  }

  const title = titleOverride ?? assignment.title ?? assignment.lessonSlug;
  // Resolve a LIVE credential: an expired or near-expiry access token is
  // refreshed in place before the coursework POST (Sprint 25 credential-
  // refresh lifecycle, PDR-030h). This is the seam that lets an active
  // connection with a stale access token self-heal without the teacher
  // reconnecting. A refresh that cannot recover the credential throws a
  // normalized PlatformError, which the Phase A catch below records as a
  // failed publication rather than a false success.
  const bundle = await resolveLiveCredential(connection.tokenRef);
  const adapter = getProviderAdapter(connection.providerId);

  // Phase A: upstream call.
  // Nothing is durable on the LyfeLabz side yet. On failure here, write
  // the failed record and emit lms.publishFailed, then return the graceful
  // failure response. lms.insufficientScope is non-terminal: it writes no
  // record and emits no audit event (§2.7, blueprint §11).
  let published: { lmsAssignmentId: string; lmsAssignmentUrl?: string } | undefined;
  try {
    published = await adapter.publishAssignment({
      accessToken: bundle.accessToken,
      lmsClassId: link.lmsClassId,
      title,
      ...(instructions !== undefined ? { instructions } : {}),
      lyfelabzAssignmentUrl,
      ...(lmsTopicId !== undefined ? { lmsTopicId } : {}),
    });
  } catch (upstreamErr) {
    // Insufficient scope is non-terminal. No record is written and no
    // lms.publishFailed event is emitted. The client routes to incremental
    // OAuth consent and re-issues the publish call with the same nonce.
    if (
      upstreamErr instanceof PlatformError &&
      upstreamErr.code === "lms.insufficientScope"
    ) {
      return {
        publicationId,
        status: "failed",
        errorCode: "lms.insufficientScope",
        errorMessage: "Publication requires additional OAuth consent.",
      };
    }

    const errorCode =
      upstreamErr instanceof PlatformError
        ? upstreamErr.code
        : "lms.publishFailed";
    const errorMessage = "Publication to the LMS did not succeed.";

    const failureRecord: LmsAssignmentPublicationCreationWrite = {
      assignmentId,
      classId: link.classId,
      ownerUid: actor.uid,
      schoolId: actor.schoolId,
      providerId: connection.providerId,
      connectionId: link.connectionId,
      lmsClassId: link.lmsClassId,
      ...(lmsTopicId !== undefined ? { lmsTopicId } : {}),
      status: "failed",
      errorCode,
      errorMessage,
      publishedAt: FieldValue.serverTimestamp(),
    };

    // Guard each inner write so the graceful response is always returned
    // even when persistence itself fails.
    try {
      await lmsAssignmentPublicationCreationDocRef(publicationId).set(
        failureRecord,
      );
    } catch {
      // Cannot persist failure record; the graceful response still returns.
    }

    const failureAction: AuditAction = "lms.publishFailed";
    try {
      await writeAuditEvent({
        actorUserId: actor.uid,
        actorRole: "teacher",
        action: failureAction,
        targetType: "assignment",
        targetId: assignmentId,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
        payload: {
          providerId: connection.providerId,
          linkId,
          lmsClassId: link.lmsClassId,
          publicationId,
          errorCode,
        },
      });
    } catch {
      // Audit failure is non-blocking.
    }

    safeLog(() =>
      log.warn("lms.publishFailed", {
        actorUserId: actor.uid,
        assignmentId,
        publicationId,
        errorCode,
      }),
    );

    return {
      publicationId,
      status: "failed",
      errorCode,
      errorMessage,
    };
  }

  // Phase B: persistence and audit of a confirmed upstream success.
  // `published` is set; the coursework item exists in the upstream LMS.
  // Do not clobber the succeeded record from here — later local failures
  // are logged and reported, but they cannot downgrade a real publication
  // to a reported failure and they cannot re-write the record to `failed`.

  const record: LmsAssignmentPublicationCreationWrite = {
    assignmentId,
    classId: link.classId,
    ownerUid: actor.uid,
    schoolId: actor.schoolId,
    providerId: connection.providerId,
    connectionId: link.connectionId,
    lmsClassId: link.lmsClassId,
    ...(lmsTopicId !== undefined ? { lmsTopicId } : {}),
    status: "succeeded",
    lmsAssignmentId: published.lmsAssignmentId,
    ...(published.lmsAssignmentUrl !== undefined
      ? { lmsAssignmentUrl: published.lmsAssignmentUrl }
      : {}),
    publishedAt: FieldValue.serverTimestamp(),
  };

  // Phase B1: write the succeeded publication record.
  // If this write fails, the upstream coursework item is an orphan: it
  // exists in Google but has no LyfeLabz record. Log the upstream id at
  // error severity for manual recovery and return "did not succeed". A
  // retry may create a second upstream coursework item (accepted residual;
  // documented in §2.5 and §2.6 of the Sprint 25 implementation plan).
  try {
    await lmsAssignmentPublicationCreationDocRef(publicationId).set(record);
  } catch {
    safeLog(() =>
      log.error("lms.publicationRecordFailed", {
        actorUserId: actor.uid,
        publicationId,
        providerId: connection.providerId,
        linkId,
        lmsClassId: link.lmsClassId,
        lmsAssignmentId: published.lmsAssignmentId,
      }),
    );
    return {
      publicationId,
      status: "failed",
      errorCode: "lms.localPersistenceFailed",
      errorMessage: "Publication to the LMS did not succeed.",
    };
  }

  // Phase B2: set the mirror pointer on the LyfeLabz assignment.
  // The succeeded record is already written. If the mirror update fails,
  // log the desync but keep the succeeded result — the mirror is a
  // denormalized convenience and its absence does not invalidate the
  // publication.
  try {
    await assignmentLmsPublicationDocRef(assignmentId).update({
      lmsPublicationRef: publicationId,
    });
  } catch {
    safeLog(() =>
      log.error("lms.publicationMirrorFailed", {
        actorUserId: actor.uid,
        publicationId,
      }),
    );
  }

  // Phase B3: emit the success audit event.
  // The succeeded record and mirror are already written. If audit emission
  // fails, log the gap but keep the succeeded result and do not invert the
  // publication into a reported failure.
  const successAction: AuditAction = "lms.assignmentPublished";
  try {
    await writeAuditEvent({
      actorUserId: actor.uid,
      actorRole: "teacher",
      action: successAction,
      targetType: "assignment",
      targetId: assignmentId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
      payload: {
        providerId: connection.providerId,
        linkId,
        lmsClassId: link.lmsClassId,
        lmsAssignmentId: published.lmsAssignmentId,
        publicationId,
        ...(lmsTopicId !== undefined ? { lmsTopicId } : {}),
      },
    });
  } catch {
    safeLog(() =>
      log.error("lms.publicationAuditFailed", {
        actorUserId: actor.uid,
        publicationId,
      }),
    );
  }

  safeLog(() =>
    log.info("lms.assignmentPublished", {
      actorUserId: actor.uid,
      assignmentId,
      publicationId,
    }),
  );

  return {
    publicationId,
    status: "succeeded",
    lmsAssignmentId: published.lmsAssignmentId,
    ...(published.lmsAssignmentUrl !== undefined
      ? { lmsAssignmentUrl: published.lmsAssignmentUrl }
      : {}),
  };
}

export const lmsAssignmentsPublish = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsAssignmentsPublishHandler = handler;
