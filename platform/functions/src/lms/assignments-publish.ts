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

import { getProviderAdapter } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { lmsAssignmentPublicationIdFor } from "./shared/ids";
import { getLmsTokenStore } from "./tokens/token-store";

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

export type LmsAssignmentsPublishRequest = {
  readonly assignmentId: string;
  readonly linkId: string;
  readonly lyfelabzAssignmentUrl: string;
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
  const lyfelabzAssignmentUrl = requireNonEmptyString(
    payload.lyfelabzAssignmentUrl,
    "lms.invalidAssignmentUrl",
    "lyfelabzAssignmentUrl must be a non-empty string.",
  );
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

  const title = titleOverride ?? assignment.title ?? assignment.lessonSlug;
  const bundle = await getLmsTokenStore().resolve(connection.tokenRef);
  const adapter = getProviderAdapter(connection.providerId);

  try {
    const published = await adapter.publishAssignment({
      accessToken: bundle.accessToken,
      lmsClassId: link.lmsClassId,
      title,
      ...(instructions !== undefined ? { instructions } : {}),
      lyfelabzAssignmentUrl,
      ...(lmsTopicId !== undefined ? { lmsTopicId } : {}),
    });

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

    await lmsAssignmentPublicationCreationDocRef(publicationId).set(record);
    await assignmentLmsPublicationDocRef(assignmentId).update({
      lmsPublicationRef: publicationId,
    });

    const action: AuditAction = "lms.assignmentPublished";
    await writeAuditEvent({
      actorUserId: actor.uid,
      actorRole: "teacher",
      action,
      targetType: "assignment",
      targetId: assignmentId,
      schoolId: actor.schoolId,
      payload: {
        providerId: connection.providerId,
        linkId,
        lmsClassId: link.lmsClassId,
        lmsAssignmentId: published.lmsAssignmentId,
        publicationId,
        ...(lmsTopicId !== undefined ? { lmsTopicId } : {}),
      },
    });

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
  } catch (err) {
    // Failure is a routine event (§8). Record the failure alongside its
    // audit event and return the graceful `lms.publishFailed` shape to
    // the client so the confirmation surface in ASSIGN_EXPERIENCE.md §7
    // can render "Publishing to Google Classroom did not succeed."
    // without asking the teacher to contact an administrator.
    const errorCode =
      err instanceof PlatformError ? err.code : "lms.publishFailed";
    const errorMessage =
      err instanceof Error
        ? err.message
        : "Publication to the LMS did not succeed.";

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
    await lmsAssignmentPublicationCreationDocRef(publicationId).set(
      failureRecord,
    );

    const action: AuditAction = "lms.publishFailed";
    await writeAuditEvent({
      actorUserId: actor.uid,
      actorRole: "teacher",
      action,
      targetType: "assignment",
      targetId: assignmentId,
      schoolId: actor.schoolId,
      payload: {
        providerId: connection.providerId,
        linkId,
        lmsClassId: link.lmsClassId,
        publicationId,
        errorCode,
      },
    });

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
}

export const lmsAssignmentsPublish = platformCallable(handler);
export const __lmsAssignmentsPublishHandler = handler;
