import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  lmsClassLinkBreakDocRef,
  lmsClassLinkDocRef,
  lmsConnectionDocRef,
  lmsConnectionRevocationDocRef,
  log,
  writeAuditEvent,
  type LmsClassLinkBreakWrite,
  type LmsConnectionRevocationWrite,
} from "../shared";

import { getProviderAdapter } from "./providers/registry";
import {
  assertAuthenticatedTeacherForLms,
  requireNonEmptyString,
} from "./shared/actor";
import { getLmsTokenStore } from "./tokens/token-store";

// lmsClassesRefresh
//
// Sprint 8E ("LMS Refresh and Reconciliation") authorized manual
// reconciliation callable. Given an existing lmsClassLinks mirror
// record the calling teacher owns, verifies the upstream state,
// reconciles the mirror when the state has drifted, and returns a
// plain-language health verdict the Settings > Integrations surface
// renders to the teacher.
//
// Provider neutrality (PDR-020f) is preserved: this file speaks only
// to the vendor-neutral LmsProviderAdapter interface and the canonical
// mirror records. Every provider-specific concern (Google Classroom
// 404/401/5xx mapping, retry posture, transport telemetry) lives
// inside the adapter and reaches the core only through PlatformError
// codes on the shared vocabulary below.
//
// Server-authoritative reconciliation per LMS_INTEGRATION_ARCHITECTURE.md
// §5 / Amendment §6:
//   - the caller never touches upstream directly
//   - the callable is the single canonical writer for
//     lmsClassLinks and lmsConnections state transitions during
//     reconciliation
//   - immutable ownership fields (classId, ownerUid, providerId,
//     lmsClassId, connectionId, schoolId) are never rewritten by
//     reconciliation
//   - every state transition emits an existing-vocabulary audit event;
//     no new audit action is introduced by this sprint
//
// Sprint 8E is a REFRESH sprint. It intentionally does NOT synchronize
// rosters, assignments, grades, or submissions. It writes no scheduled
// job and opens no background listener; the teacher initiates every
// refresh from the Integrations surface.

// Canonical health vocabulary consumed by the Settings > Integrations
// surface. The vocabulary is closed and provider-neutral: the copy that
// accompanies each status lives on the client so the callable does not
// mint teacher-facing prose.
export type LmsClassLinkHealthStatus =
  | "healthy"
  | "disconnected"
  | "revoked"
  | "ownershipDrift"
  | "missingUpstream"
  | "reconnectRequired"
  | "providerUnavailable";

// Canonical adapter error codes. Provider adapters throw PlatformError
// with one of these codes so the reconciler can classify failure
// without inspecting vendor-specific transports. Adapters that report
// an unrecognized code are treated as `providerUnavailable` per the
// conservative default named in §6 of Amendment §6.
const UPSTREAM_CLASS_MISSING_CODE = "lms.upstream.classMissing";
const UPSTREAM_ACCESS_REVOKED_CODE = "lms.upstream.accessRevoked";
const UPSTREAM_UNAVAILABLE_CODE = "lms.upstream.unavailable";
const PROVIDER_NOT_YET_OPERATIONAL_CODE = "lms.providerNotYetOperational";
const TOKEN_NOT_FOUND_CODE = "lms.tokenNotFound";

export type LmsClassesRefreshRequest = {
  readonly linkId: string;
};

export type LmsClassesRefreshResponse = {
  readonly linkId: string;
  readonly classId: string;
  readonly lmsClassId: string;
  readonly providerId: string;
  readonly status: LmsClassLinkHealthStatus;
  readonly changed: boolean;
};

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

function extractErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const raw = (err as { code?: unknown }).code;
    return typeof raw === "string" ? raw : "";
  }
  return "";
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsClassesRefreshResponse> {
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
    throw new PlatformError(
      "lms.linkNotFound",
      "No class link matches this identifier.",
    );
  }
  const link = linkSnapshot.data();
  if (!link) {
    throw new PlatformError(
      "lms.linkNotFound",
      "Class link record was empty.",
    );
  }
  if (link.ownerUid !== actor.uid) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own this class link.",
    );
  }
  if (link.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller schoolId does not match class link schoolId.",
    );
  }

  const baseResponse = {
    linkId,
    classId: link.classId,
    lmsClassId: link.lmsClassId,
    providerId: link.providerId,
  };

  // A link that is no longer active exposes the terminal state
  // directly. The reconciler does not resurrect a `broken` or
  // `unlinked` mirror; the teacher must re-import from the Integrations
  // surface.
  if (link.status === "broken") {
    return { ...baseResponse, status: "missingUpstream", changed: false };
  }
  if (link.status === "unlinked") {
    return { ...baseResponse, status: "missingUpstream", changed: false };
  }

  const connectionSnapshot = await lmsConnectionDocRef(link.connectionId).get();
  if (!connectionSnapshot.exists) {
    // The connection was hard-deleted from Firestore. This is an
    // operational anomaly the teacher recovers from by reconnecting.
    return { ...baseResponse, status: "reconnectRequired", changed: false };
  }
  const connection = connectionSnapshot.data();
  if (!connection) {
    return { ...baseResponse, status: "reconnectRequired", changed: false };
  }
  if (connection.teacherId !== actor.uid) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own the connection backing this class link.",
    );
  }
  if (connection.status === "revoked") {
    return { ...baseResponse, status: "disconnected", changed: false };
  }
  if (connection.status === "stale") {
    return { ...baseResponse, status: "reconnectRequired", changed: false };
  }

  // Resolve the token bundle server-side (PDR-019e). The bundle never
  // leaves the trust boundary of this callable.
  let bundle;
  try {
    bundle = await getLmsTokenStore().resolve(connection.tokenRef);
  } catch (err) {
    const code = extractErrorCode(err);
    if (code === TOKEN_NOT_FOUND_CODE) {
      return { ...baseResponse, status: "reconnectRequired", changed: false };
    }
    throw new PlatformError(
      "lms.tokenResolutionFailed",
      "Failed to resolve the LMS token bundle.",
      err,
    );
  }

  const adapter = getProviderAdapter(connection.providerId);
  let discovered;
  try {
    discovered = await adapter.fetchClass({
      accessToken: bundle.accessToken,
      lmsClassId: link.lmsClassId,
    });
  } catch (err) {
    const code = extractErrorCode(err);
    if (code === UPSTREAM_CLASS_MISSING_CODE) {
      return await handleMissingUpstream({
        actorUid: actor.uid,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
        linkId,
        classId: link.classId,
        providerId: link.providerId,
        lmsClassId: link.lmsClassId,
        connectionId: link.connectionId,
      });
    }
    if (code === UPSTREAM_ACCESS_REVOKED_CODE) {
      return await handleAccessRevoked({
        actorUid: actor.uid,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
        linkId,
        classId: link.classId,
        providerId: link.providerId,
        lmsClassId: link.lmsClassId,
        connectionId: link.connectionId,
      });
    }
    if (
      code === UPSTREAM_UNAVAILABLE_CODE ||
      code === PROVIDER_NOT_YET_OPERATIONAL_CODE
    ) {
      return { ...baseResponse, status: "providerUnavailable", changed: false };
    }
    safeLog(() =>
      log.warn("lms.refreshUnexpectedAdapterError", {
        actorUserId: actor.uid,
        linkId,
        code,
      }),
    );
    return { ...baseResponse, status: "providerUnavailable", changed: false };
  }

  if (
    discovered.ownerUpstreamAccountIdentifier !==
    bundle.upstreamAccountIdentifier
  ) {
    return await handleOwnershipDrift({
      actorUid: actor.uid,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
      linkId,
      classId: link.classId,
      providerId: link.providerId,
      lmsClassId: link.lmsClassId,
      connectionId: link.connectionId,
    });
  }

  safeLog(() =>
    log.info("lms.classLinkHealthy", {
      actorUserId: actor.uid,
      linkId,
    }),
  );
  return { ...baseResponse, status: "healthy", changed: false };
}

// -----------------------------------------------------------------------------
// State-transition helpers
// -----------------------------------------------------------------------------

type ReconciliationContext = {
  readonly actorUid: string;
  readonly schoolId: string;
  // Sprint 11D I-5. Optional districtId carried through to audit events
  // so `lms.*` reconciliation events satisfy the audit district-context
  // requirement when the caller's token includes the claim.
  readonly districtId?: string;
  readonly linkId: string;
  readonly classId: string;
  readonly providerId: string;
  readonly lmsClassId: string;
  readonly connectionId: string;
};

async function handleMissingUpstream(
  ctx: ReconciliationContext,
): Promise<LmsClassesRefreshResponse> {
  // Narrow break write per Data Model §3.4. The class's enrollmentSource
  // is intentionally left as-is; Sprint 8E scope is reconciliation only,
  // and the join-code path is not opened by a broken link (Sprint 8F
  // will design the class-level recovery workflow).
  const write: LmsClassLinkBreakWrite = {
    status: "broken",
    unlinkedAt: FieldValue.serverTimestamp(),
  };
  await lmsClassLinkBreakDocRef(ctx.linkId).update(write);

  await writeAuditEvent({
    actorUserId: ctx.actorUid,
    actorRole: "teacher",
    action: "lms.classUnlinked",
    targetType: "class",
    targetId: ctx.classId,
    schoolId: ctx.schoolId,
    districtId: ctx.districtId,
    payload: {
      providerId: ctx.providerId,
      lmsClassId: ctx.lmsClassId,
      linkId: ctx.linkId,
      reason: "missingUpstream",
    },
  });

  safeLog(() =>
    log.info("lms.classLinkBrokenMissingUpstream", {
      actorUserId: ctx.actorUid,
      linkId: ctx.linkId,
    }),
  );

  return {
    linkId: ctx.linkId,
    classId: ctx.classId,
    lmsClassId: ctx.lmsClassId,
    providerId: ctx.providerId,
    status: "missingUpstream",
    changed: true,
  };
}

async function handleAccessRevoked(
  ctx: ReconciliationContext,
): Promise<LmsClassesRefreshResponse> {
  const revocation: LmsConnectionRevocationWrite = {
    status: "revoked",
    revokedAt: FieldValue.serverTimestamp(),
  };
  await lmsConnectionRevocationDocRef(ctx.connectionId).update(revocation);

  await writeAuditEvent({
    actorUserId: ctx.actorUid,
    actorRole: "teacher",
    action: "lms.connectionRevoked",
    targetType: "lmsConnection",
    targetId: ctx.connectionId,
    schoolId: ctx.schoolId,
    districtId: ctx.districtId,
    payload: {
      providerId: ctx.providerId,
      reason: "upstreamAccessRevoked",
      linkId: ctx.linkId,
    },
  });

  safeLog(() =>
    log.info("lms.connectionRevokedOnRefresh", {
      actorUserId: ctx.actorUid,
      linkId: ctx.linkId,
      connectionId: ctx.connectionId,
    }),
  );

  return {
    linkId: ctx.linkId,
    classId: ctx.classId,
    lmsClassId: ctx.lmsClassId,
    providerId: ctx.providerId,
    status: "revoked",
    changed: true,
  };
}

async function handleOwnershipDrift(
  ctx: ReconciliationContext,
): Promise<LmsClassesRefreshResponse> {
  const write: LmsClassLinkBreakWrite = {
    status: "broken",
    unlinkedAt: FieldValue.serverTimestamp(),
  };
  await lmsClassLinkBreakDocRef(ctx.linkId).update(write);

  await writeAuditEvent({
    actorUserId: ctx.actorUid,
    actorRole: "teacher",
    action: "lms.ownershipDrift",
    targetType: "class",
    targetId: ctx.classId,
    schoolId: ctx.schoolId,
    districtId: ctx.districtId,
    payload: {
      providerId: ctx.providerId,
      lmsClassId: ctx.lmsClassId,
      linkId: ctx.linkId,
    },
  });

  safeLog(() =>
    log.info("lms.ownershipDriftOnRefresh", {
      actorUserId: ctx.actorUid,
      linkId: ctx.linkId,
    }),
  );

  return {
    linkId: ctx.linkId,
    classId: ctx.classId,
    lmsClassId: ctx.lmsClassId,
    providerId: ctx.providerId,
    status: "ownershipDrift",
    changed: true,
  };
}

export const lmsClassesRefresh = platformCallable(handler);
export const __lmsClassesRefreshHandler = handler;
