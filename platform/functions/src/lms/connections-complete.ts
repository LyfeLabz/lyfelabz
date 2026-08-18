import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  lmsConnectionCreationDocRef,
  lmsConnectionDocRef,
  log,
  writeAuditEvent,
  type LmsConnectionCreationWrite,
  type WriteAuditEventInput,
} from "../shared";

import {
  getLmsOAuthStateStore,
  LMS_OAUTH_STATE_ERROR_CODES,
} from "./oauth-state/state-store";
import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import { getProviderAdapter, isRegisteredProvider } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { lmsConnectionIdFor } from "./shared/ids";
import { getLmsTokenStore } from "./tokens/token-store";

// Single public error code for every server-side OAuth state failure.
// The store throws granular internal codes (unknown, expired, replayed,
// mismatched provider, mismatched redirect, teacher mismatch); the
// callable coerces every one of them into this single code so a caller
// cannot use error granularity to enumerate server state (Sprint 23B
// security completion §CONSUME REQUIREMENTS item 10).
const OAUTH_STATE_PUBLIC_ERROR_CODE = "lms.invalidOAuthState";
const OAUTH_STATE_PUBLIC_ERROR_MESSAGE =
  "The OAuth authorization request could not be validated.";

// Internal store error codes that the callable maps onto the single
// public code. Any other thrown error is re-thrown unchanged so an
// unrelated failure (e.g. adapter transport unbound) is not silently
// masked.
const OAUTH_STATE_INTERNAL_CODES: ReadonlySet<string> = new Set([
  LMS_OAUTH_STATE_ERROR_CODES.invalidInput,
  LMS_OAUTH_STATE_ERROR_CODES.notFound,
  LMS_OAUTH_STATE_ERROR_CODES.expired,
  LMS_OAUTH_STATE_ERROR_CODES.consumed,
  LMS_OAUTH_STATE_ERROR_CODES.providerMismatch,
  LMS_OAUTH_STATE_ERROR_CODES.redirectMismatch,
  LMS_OAUTH_STATE_ERROR_CODES.intentMismatch,
]);

function coerceOAuthStateError(err: unknown): unknown {
  if (
    err instanceof PlatformError &&
    OAUTH_STATE_INTERNAL_CODES.has(err.code)
  ) {
    return new PlatformError(
      OAUTH_STATE_PUBLIC_ERROR_CODE,
      OAUTH_STATE_PUBLIC_ERROR_MESSAGE,
    );
  }
  return err;
}

// lmsConnectionsComplete
//
// Connection lifecycle callable (complete) per PDR-020c and PDR-030d.
// Exchanges the authorization code for tokens through the provider
// adapter, records the tokens through the server-only token store
// (PDR-019e, LMS_INTEGRATION_ARCHITECTURE.md §5.3), and either:
//   - creates the canonical `lmsConnections/{connectionId}` document
//     (new connection, consentOutcome "created"), or
//   - widens the scope set of an existing active connection when the
//     state binding carries the "publication" intent (PDR-030c, PDR-030d,
//     consentOutcome "widened" / "alreadyAuthorized"), or
//   - replaces the unusable credential of an existing active connection
//     when the state binding carries the "reconnect" intent (Sprint 26
//     certification follow-up, consentOutcome "recovered"), restoring the
//     base scope set on the same logical connection.
//
// Idempotent under the Sprint 2 helper contract: a replayed completion
// with the same (teacherId, providerId) pair and an "initialConnect"
// intent returns the existing connection without minting a second token.
// The "publication" and "reconnect" intents deliberately opt out of that
// early return because each must act on the existing active connection.

export type LmsConnectionsCompleteRequest = {
  readonly providerId: string;
  readonly code: string;
  readonly state: string;
  readonly redirectUri: string;
};

export type LmsConnectionsCompleteResponse = {
  readonly connectionId: string;
  readonly providerId: string;
  readonly alreadyConnected: boolean;
  // Discriminator added by PDR-030d, extended by the Sprint 26
  // certification follow-up with "recovered". Absent on the idempotent
  // duplicate-initial-connect early-return path (alreadyConnected: true, no
  // intent).
  readonly consentOutcome?:
    | "created"
    | "widened"
    | "alreadyAuthorized"
    | "recovered";
};

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// Best-effort durable audit write (Sprint 26 Phase 1 observability).
// Audit evidence is observability, never lifecycle or security: a failed
// audit write is swallowed exactly like a failed structured-log line.
// On the identity-mismatch path this guarantees the hard reject still
// throws even if the audit collection is unavailable; on the successful
// widening path it guarantees the already-committed widening is never
// retroactively failed by a diagnostic write. This helper is used ONLY
// for the two Sprint 26 widening-outcome events; the new-connection
// `lms.connectionCreated` write remains awaited on its own lifecycle
// path unchanged.
async function safeAudit(input: WriteAuditEventInput): Promise<void> {
  try {
    await writeAuditEvent(input);
  } catch {
    // Audit is observability, not lifecycle.
  }
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsConnectionsCompleteResponse> {
  ensureGoogleClassroomProductionBindings();
  const actor = assertAuthenticatedTeacherForLms(request);
  if (request.data === null || typeof request.data !== "object") {
    throw new PlatformError(
      "lms.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = request.data as Record<string, unknown>;
  const providerId = requireNonEmptyString(
    payload.providerId,
    "lms.invalidProviderId",
    "providerId must be a non-empty string.",
  );
  const code = requireNonEmptyString(
    payload.code,
    "lms.invalidAuthorizationCode",
    "code must be a non-empty string.",
  );
  const state = requireNonEmptyString(
    payload.state,
    "lms.invalidState",
    "state must be a non-empty string.",
  );
  const redirectUri = requireNonEmptyString(
    payload.redirectUri,
    "lms.invalidRedirectUri",
    "redirectUri must be a non-empty string.",
  );
  if (!isRegisteredProvider(providerId)) {
    throw new PlatformError(
      "lms.unknownProvider",
      `Provider "${providerId}" is not registered.`,
    );
  }
  const connectionId = lmsConnectionIdFor(actor.uid, providerId);

  // Peek the OAuth state binding BEFORE the connection early-return
  // decision so we can determine the intent. The state is NOT consumed
  // here; consume runs inside adapter.completeOAuth.
  const stateStore = getLmsOAuthStateStore();
  const binding = await stateStore.peek(state);

  // Check for an existing active connection.
  const existingSnapshot = await lmsConnectionDocRef(connectionId).get();
  const existingData = existingSnapshot.exists ? existingSnapshot.data() : null;
  const hasActiveConnection =
    existingData !== null &&
    existingData !== undefined &&
    existingData.teacherId === actor.uid &&
    existingData.providerId === providerId &&
    existingData.status === "active";

  // Intent-aware idempotent early return. An active connection reached by a
  // duplicate/replayed initial-connect (intent "initialConnect", or an
  // absent binding) is already complete; return without consuming the OAuth
  // state or minting a second token. A "publication" intent falls through to
  // the scope-widening path, and a "reconnect" intent falls through to the
  // credential-recovery path, because each must act on the existing active
  // connection rather than treat it as a no-op (Sprint 26 certification
  // follow-up: the earlier version early-returned for reconnect too, which
  // is exactly why the Settings Reconnect action did not replace an unusable
  // credential on an active connection).
  if (
    hasActiveConnection &&
    binding?.intent !== "publication" &&
    binding?.intent !== "reconnect"
  ) {
    safeLog(() =>
      log.info("lms.connectionCompleteIdempotent", {
        actorUserId: actor.uid,
        connectionId,
      }),
    );
    return { connectionId, providerId, alreadyConnected: true };
  }

  // Server-side OAuth state validation. The binding was peeked above;
  // validate teacher, provider, redirect, TTL, and non-consumed state
  // before consuming through the adapter. Every internal validation
  // failure surfaces as the single public `lms.invalidOAuthState` code
  // (Sprint 23B security completion §CONSUME REQUIREMENTS item 10).
  if (
    !binding ||
    binding.consumed ||
    Date.now() >= binding.expiresAtEpochMs ||
    binding.teacherId !== actor.uid ||
    binding.providerId !== providerId ||
    binding.redirectUri !== redirectUri
  ) {
    throw new PlatformError(
      OAUTH_STATE_PUBLIC_ERROR_CODE,
      OAUTH_STATE_PUBLIC_ERROR_MESSAGE,
    );
  }

  // Exchange the authorization code. This atomically consumes the state
  // record inside the adapter; a second attempt with the same state will
  // fail the consume step.
  const adapter = getProviderAdapter(providerId);
  let grant;
  try {
    grant = await adapter.completeOAuth({ code, state, redirectUri });
  } catch (err) {
    throw coerceOAuthStateError(err);
  }

  // Scope-widening path (PDR-030d): active connection + publication intent.
  //
  // The existing connection remains authoritative until widening succeeds.
  // The old token bundle is removed only after the connection document
  // update commits. The existing connection remains usable if widening
  // fails at any step before the document update.
  //
  // INVARIANT: the upstream Google OAuth grant is NEVER revoked during
  // widening. Only the local token store entry for the old tokenRef is
  // cleaned up after the new tokenRef is committed.
  if (hasActiveConnection && binding.intent === "publication" && existingData) {
    const oldTokenRef = existingData.tokenRef;

    // Resolve the existing token bundle for identity revalidation and
    // refresh-token carry-forward.
    let oldBundle;
    try {
      oldBundle = await getLmsTokenStore().resolve(oldTokenRef);
    } catch {
      throw new PlatformError(
        "lms.connectionTokenResolutionFailed",
        "Could not resolve the existing connection token bundle for scope widening.",
      );
    }

    // Identity revalidation: the upstream account on the new grant must
    // match the account on the existing connection (PDR-030d). A mismatch
    // refuses the scope widening.
    if (
      oldBundle.upstreamAccountIdentifier !== grant.upstreamAccountIdentifier
    ) {
      // Sprint 26 Phase 1: record the widening rejection as durable,
      // PII-safe audit evidence BEFORE throwing, and BEFORE any
      // connection or credential mutation. Best-effort by construction
      // (safeAudit swallows its own failures), so the hard reject below
      // is never gated on audit persistence. The payload records only
      // the provider and a low-cardinality reason category; NEITHER the
      // stored identity (`oldBundle.upstreamAccountIdentifier`) nor the
      // returned identity (`grant.upstreamAccountIdentifier`) is written.
      await safeAudit({
        actorUserId: actor.uid,
        actorRole: "teacher",
        action: "lms.connectionWideningRejected",
        targetType: "lmsConnection",
        targetId: connectionId,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
        payload: { providerId, reason: "identityMismatch" },
      });
      throw new PlatformError(
        "lms.identityMismatch",
        "The account used for scope widening does not match the account on the existing connection.",
      );
    }

    // Compute the merged scope set as a stable sorted union. Granted
    // scopes are persisted exactly as approved by the teacher.
    const mergedScopes = Array.from(
      new Set([...oldBundle.scopes, ...grant.scopes]),
    ).sort();

    // Already-authorized path: the new grant adds no scopes the connection
    // does not already hold. Idempotent return without writing anything.
    const oldScopesSorted = Array.from(new Set([...oldBundle.scopes])).sort();
    if (mergedScopes.join(" ") === oldScopesSorted.join(" ")) {
      return {
        connectionId,
        providerId,
        alreadyConnected: true,
        consentOutcome: "alreadyAuthorized",
      };
    }

    // Compose the new token bundle. Google often omits refresh_token on
    // incremental re-consent; preserve the old one when absent so the
    // connection retains offline access.
    const newBundle = {
      providerId,
      teacherId: actor.uid,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken ?? oldBundle.refreshToken,
      scopes: mergedScopes,
      expiresAtEpochMs:
        grant.expiresInSeconds !== undefined
          ? Date.now() + grant.expiresInSeconds * 1000
          : undefined,
      upstreamAccountIdentifier: grant.upstreamAccountIdentifier,
    };

    // Store the new bundle before updating the connection document so
    // the document update is atomic with a valid new tokenRef.
    const newTokenRef = await getLmsTokenStore().store(newBundle);

    // Commit the scope widening to the connection document. The existing
    // connection is authoritative until this write succeeds.
    await lmsConnectionDocRef(connectionId).update({
      scopes: mergedScopes,
      tokenRef: newTokenRef,
      scopesUpdatedAt: FieldValue.serverTimestamp(),
    });

    // Best-effort cleanup of the old local token bundle. This is a hygiene
    // step, not a lifecycle step. The old upstream Google grant is NOT
    // revoked here - only the local token store entry is removed.
    try {
      await getLmsTokenStore().revoke(oldTokenRef);
    } catch {
      // Intentional: cleanup failure does not fail the widening.
    }

    safeLog(() =>
      log.info("lms.connectionScopesWidened", {
        actorUserId: actor.uid,
        connectionId,
        providerId,
      }),
    );

    // Sprint 26 Phase 1: durable, PII-safe audit evidence for a widening
    // that ACTUALLY completed. Emitted only here, after the connection
    // document update above has committed, so the event can never
    // describe a widening that failed or aborted (a store/update failure
    // throws earlier and never reaches this point; the alreadyAuthorized
    // path returns before the commit and emits nothing). Best-effort so a
    // diagnostic failure cannot retroactively fail the committed widening.
    // The payload carries only the provider id: no widened scope array,
    // no upstream Google account identifier, no tokens.
    await safeAudit({
      actorUserId: actor.uid,
      actorRole: "teacher",
      action: "lms.connectionScopesWidened",
      targetType: "lmsConnection",
      targetId: connectionId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
      payload: { providerId },
    });

    return {
      connectionId,
      providerId,
      alreadyConnected: true,
      consentOutcome: "widened",
    };
  }

  // Reconnect / credential-recovery path (Sprint 26 certification
  // follow-up): active connection + "reconnect" intent.
  //
  // The teacher explicitly requested recovery for a connection LyfeLabz
  // observed to be unusable (for example a dead refresh token Google rejects
  // with invalid_grant, surfaced to the teacher as reconnectRequired). Unlike
  // the idempotent duplicate-initial-connect early return above, reconnect
  // MUST exchange the fresh authorization code and replace the unusable
  // credential on the SAME logical connection. It restores the base (initial)
  // scope set; publication scope, if needed, is re-widened later through the
  // normal incremental-consent path (least privilege preserved).
  //
  // Credential replacement reuses the same safe shape as the widening path:
  // the existing connection remains authoritative until the connection
  // document update commits; the old local token bundle is cleaned up only
  // afterward; and the upstream Google grant is NEVER revoked here.
  if (hasActiveConnection && binding.intent === "reconnect" && existingData) {
    const oldTokenRef = existingData.tokenRef;

    // Resolve the existing token bundle for identity revalidation and
    // refresh-token carry-forward. `resolve` is a pure read: the stored
    // refresh token may be dead at Google, but the bundle document itself
    // still resolves, so the upstream identity remains available to compare.
    let oldBundle;
    try {
      oldBundle = await getLmsTokenStore().resolve(oldTokenRef);
    } catch {
      throw new PlatformError(
        "lms.connectionTokenResolutionFailed",
        "Could not resolve the existing connection token bundle for reconnect.",
      );
    }

    // Identity revalidation: the SAME hard invariant the widening path
    // enforces (definition §6, §7.B). A reconnect that returns a different
    // upstream account is hard-rejected before any mutation; the existing
    // connection and its (unusable) credential are left exactly as they were,
    // no duplicate connection is created, and the invariant is not weakened.
    if (
      oldBundle.upstreamAccountIdentifier !== grant.upstreamAccountIdentifier
    ) {
      // PII-safe, best-effort durable evidence of the reconnect rejection,
      // symmetric with `lms.connectionWideningRejected`. Emitted BEFORE the
      // throw and BEFORE any mutation; safeAudit swallows its own failures so
      // the hard reject below is never gated on audit persistence. Neither
      // the stored nor the returned identity is written.
      await safeAudit({
        actorUserId: actor.uid,
        actorRole: "teacher",
        action: "lms.connectionRecoveryRejected",
        targetType: "lmsConnection",
        targetId: connectionId,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
        payload: { providerId, reason: "identityMismatch" },
      });
      throw new PlatformError(
        "lms.identityMismatch",
        "The account used for reconnect does not match the account on the existing connection.",
      );
    }

    // Restore the base connection: record exactly the scope set Google
    // returned for this initial-scope authorization (sorted for stability).
    // Reconnect never requests publication scope, so a connection that had
    // been widened returns to base scope until publication re-widens it.
    const restoredScopes = Array.from(new Set([...grant.scopes])).sort();

    // Compose the fresh credential bundle. Google returns a new refresh
    // token on this full-consent authorization; carry the old one forward
    // only if it is somehow absent, mirroring the widening path.
    const newBundle = {
      providerId,
      teacherId: actor.uid,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken ?? oldBundle.refreshToken,
      scopes: restoredScopes,
      expiresAtEpochMs:
        grant.expiresInSeconds !== undefined
          ? Date.now() + grant.expiresInSeconds * 1000
          : undefined,
      upstreamAccountIdentifier: grant.upstreamAccountIdentifier,
    };

    // Store the new bundle before updating the connection document so the
    // document update is atomic with a valid new tokenRef. The existing
    // connection remains authoritative until this write succeeds; a store
    // or update failure throws and leaves the connection on its old tokenRef.
    const newTokenRef = await getLmsTokenStore().store(newBundle);
    await lmsConnectionDocRef(connectionId).update({
      scopes: restoredScopes,
      tokenRef: newTokenRef,
      scopesUpdatedAt: FieldValue.serverTimestamp(),
    });

    // Best-effort cleanup of the old local token bundle. Hygiene, not
    // lifecycle. The upstream Google grant is NOT revoked here.
    try {
      await getLmsTokenStore().revoke(oldTokenRef);
    } catch {
      // Intentional: cleanup failure does not fail the reconnect.
    }

    safeLog(() =>
      log.info("lms.connectionRecovered", {
        actorUserId: actor.uid,
        connectionId,
        providerId,
      }),
    );

    // Durable, PII-safe evidence for a recovery that ACTUALLY completed,
    // emitted only after the connection document update above committed.
    // Best-effort so a diagnostic failure cannot retroactively fail the
    // committed recovery. Payload carries only the provider id.
    await safeAudit({
      actorUserId: actor.uid,
      actorRole: "teacher",
      action: "lms.connectionRecovered",
      targetType: "lmsConnection",
      targetId: connectionId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
      payload: { providerId },
    });

    return {
      connectionId,
      providerId,
      alreadyConnected: true,
      consentOutcome: "recovered",
    };
  }

  // New connection path: store tokens, create connection document, audit.
  const tokenRef = await getLmsTokenStore().store({
    providerId,
    teacherId: actor.uid,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    scopes: grant.scopes,
    expiresAtEpochMs:
      grant.expiresInSeconds !== undefined
        ? Date.now() + grant.expiresInSeconds * 1000
        : undefined,
    upstreamAccountIdentifier: grant.upstreamAccountIdentifier,
  });

  const write: LmsConnectionCreationWrite = {
    teacherId: actor.uid,
    schoolId: actor.schoolId,
    providerId,
    status: "active",
    scopes: grant.scopes,
    tokenRef,
    connectedAt: FieldValue.serverTimestamp(),
  };
  await lmsConnectionCreationDocRef(connectionId).set(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "lms.connectionCreated",
    targetType: "lmsConnection",
    targetId: connectionId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: { providerId },
  });

  safeLog(() =>
    log.info("lms.connectionCreated", {
      actorUserId: actor.uid,
      connectionId,
      providerId,
    }),
  );

  return { connectionId, providerId, alreadyConnected: false, consentOutcome: "created" };
}

export const lmsConnectionsComplete = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsConnectionsCompleteHandler = handler;
