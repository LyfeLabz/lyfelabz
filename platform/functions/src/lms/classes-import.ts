import { FieldValue } from "firebase-admin/firestore";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  classDocRef,
  classLmsLinkDocRef,
  lmsClassLinkCreationDocRef,
  lmsClassLinkDocRef,
  lmsClassLinksCollectionRef,
  lmsConnectionDocRef,
  log,
  writeAuditEvent,
  type ClassLmsLinkWrite,
  type LmsClassLinkCreationWrite,
} from "../shared";

import { getProviderAdapter } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { lmsClassLinkIdFor } from "./shared/ids";
import { getLmsTokenStore } from "./tokens/token-store";

// lmsClassesImport
//
// Classroom import callable per PDR-020c ("class import"). Given an
// existing LyfeLabz class owned by the calling teacher and an upstream
// LMS class the teacher is the teacher-of-record for, opens the mirror
// link between them.
//
// Ownership invariants (PDR-019b, PDR-019j, PDR-020g):
//   - The caller must own the LyfeLabz class (teacherId equality).
//   - The caller must be the upstream teacher-of-record (verified through
//     the adapter at import time per §12 of the architecture).
//   - A LyfeLabz class may hold at most one active link at a time.
//   - The LMS class is not linked to a second LyfeLabz class.
//
// The callable performs three writes inside a single Firestore
// transaction:
//   1. `lmsClassLinks/{linkId}` creation of the mirror record.
//   2. `classes/{classId}` narrow update setting the additive
//      `enrollmentSource: "lms"` and `lmsProviderRef` fields per Data
//      Model §3.3 and PDR-019i.
//   3. An audit event through the canonical `writeAuditEvent` helper.
//
// The class's LyfeLabz-side enrollments are NOT touched; roster
// synchronization is explicitly out of the initial scope (PDR-020c). If
// the class already carries active enrollments the import is refused so
// no join-code enrollment is silently converted to an LMS-fed enrollment.

export type LmsClassesImportRequest = {
  readonly connectionId: string;
  readonly classId: string;
  readonly lmsClassId: string;
};

export type LmsClassesImportResponse = {
  readonly linkId: string;
  readonly classId: string;
  readonly lmsClassId: string;
  readonly alreadyLinked: boolean;
};

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsClassesImportResponse> {
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
  const classId = requireNonEmptyString(
    payload.classId,
    "lms.invalidClassId",
    "classId must be a non-empty string.",
  );
  const lmsClassId = requireNonEmptyString(
    payload.lmsClassId,
    "lms.invalidLmsClassId",
    "lmsClassId must be a non-empty string.",
  );

  const connectionSnapshot = await lmsConnectionDocRef(connectionId).get();
  if (!connectionSnapshot.exists) {
    throw new PlatformError(
      "lms.connectionNotFound",
      "No connection matches this identifier.",
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
      "Caller does not own this connection.",
    );
  }
  if (connection.status !== "active") {
    throw new PlatformError(
      "lms.connectionNotActive",
      "Connection is not active.",
    );
  }

  const classSnapshot = await classDocRef(classId).get();
  if (!classSnapshot.exists) {
    throw new PlatformError("lms.classNotFound", "Class was not found.");
  }
  const classRecord = classSnapshot.data();
  if (!classRecord) {
    throw new PlatformError("lms.classNotFound", "Class record was empty.");
  }
  if (classRecord.teacherId !== actor.uid) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own this class.",
    );
  }
  if (classRecord.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller schoolId does not match class schoolId.",
    );
  }
  if (classRecord.status !== "active") {
    throw new PlatformError(
      "lms.classNotActive",
      "Class is not active; only active classes can be linked.",
    );
  }

  // A class already carrying an LMS enrollment source cannot be relinked
  // by this callable. If the existing link matches the requested target,
  // return the idempotent response; otherwise refuse.
  if (classRecord.enrollmentSource === "lms") {
    const existingLinkSnapshot = await lmsClassLinksCollectionRef()
      .where("classId", "==", classId)
      .where("status", "==", "linked")
      .limit(1)
      .get();
    if (!existingLinkSnapshot.empty) {
      const existing = existingLinkSnapshot.docs[0];
      const data = existing.data();
      if (
        data.providerId === connection.providerId &&
        data.lmsClassId === lmsClassId
      ) {
        return {
          linkId: existing.id,
          classId,
          lmsClassId,
          alreadyLinked: true,
        };
      }
      throw new PlatformError(
        "lms.classAlreadyLinked",
        "Class is already linked to a different LMS class.",
      );
    }
  }

  // Prevent a second LyfeLabz class from linking the same upstream class
  // (LMS_INTEGRATION_ARCHITECTURE.md §8, "Duplicate import").
  const duplicateSnapshot = await lmsClassLinksCollectionRef()
    .where("providerId", "==", connection.providerId)
    .where("lmsClassId", "==", lmsClassId)
    .where("status", "==", "linked")
    .get();
  for (const doc of duplicateSnapshot.docs) {
    if (doc.data().classId !== classId) {
      throw new PlatformError(
        "lms.lmsClassAlreadyLinked",
        "This LMS class is already linked to another LyfeLabz class.",
      );
    }
  }

  // Ownership verification against the upstream provider at import time
  // per §12 of the architecture. The adapter refuses if the caller is
  // not the teacher-of-record; ownership drift produces the
  // `lms.ownershipDrift` audit event and the failure-state behavior in
  // PDR-019j.
  const bundle = await getLmsTokenStore().resolve(connection.tokenRef);
  const adapter = getProviderAdapter(connection.providerId);
  let discovered;
  try {
    discovered = await adapter.fetchClass({
      accessToken: bundle.accessToken,
      lmsClassId,
    });
  } catch (err) {
    throw new PlatformError(
      "lms.upstreamFetchFailed",
      "Failed to verify class at upstream provider.",
      err,
    );
  }
  if (
    discovered.ownerUpstreamAccountIdentifier !==
    bundle.upstreamAccountIdentifier
  ) {
    await writeAuditEvent({
      actorUserId: actor.uid,
      actorRole: "teacher",
      action: "lms.ownershipDrift",
      targetType: "class",
      targetId: classId,
      schoolId: actor.schoolId,
      payload: {
        providerId: connection.providerId,
        lmsClassId,
      },
    });
    throw new PlatformError(
      "lms.ownershipDrift",
      "Caller is not the teacher-of-record for this class at the upstream provider.",
    );
  }

  const linkId = lmsClassLinkIdFor(classId, connection.providerId, lmsClassId);
  const existingLinkSnapshot = await lmsClassLinkDocRef(linkId).get();
  if (existingLinkSnapshot.exists) {
    const data = existingLinkSnapshot.data();
    if (data && data.status === "linked" && data.classId === classId) {
      return { linkId, classId, lmsClassId, alreadyLinked: true };
    }
  }

  const linkWrite: LmsClassLinkCreationWrite = {
    classId,
    ownerUid: actor.uid,
    schoolId: actor.schoolId,
    providerId: connection.providerId,
    lmsClassId,
    connectionId,
    status: "linked",
    linkedAt: FieldValue.serverTimestamp(),
  };
  const classLinkWrite: ClassLmsLinkWrite = {
    enrollmentSource: "lms",
    lmsProviderRef: connection.providerId,
  };

  await lmsClassLinkCreationDocRef(linkId).set(linkWrite);
  await classLmsLinkDocRef(classId).update(classLinkWrite);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "lms.classImported",
    targetType: "class",
    targetId: classId,
    schoolId: actor.schoolId,
    payload: {
      providerId: connection.providerId,
      lmsClassId,
      linkId,
    },
  });

  safeLog(() =>
    log.info("lms.classImported", {
      actorUserId: actor.uid,
      classId,
      linkId,
    }),
  );

  return { linkId, classId, lmsClassId, alreadyLinked: false };
}

export const lmsClassesImport = onCall(handler);
export const __lmsClassesImportHandler = handler;
