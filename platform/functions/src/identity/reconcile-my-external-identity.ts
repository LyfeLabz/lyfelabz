import { getAuth } from "firebase-admin/auth";
import type { UserRecord } from "firebase-admin/auth";
import type { CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  log,
  platformCallable,
  reconcileExternalIdentityForUser,
  writeAuditEvent,
  type ExternalIdentityProviderId,
  type ReconcileForUserPerProviderResult,
} from "../shared";

// Sprint 23C-I - `reconcileMyExternalIdentity` callable.
//
// Authenticated caller re-request. The Cloud Function re-reads the
// caller's Firebase Auth user via the Admin SDK and reconciles the
// server-controlled `externalIdentities/{externalIdentityId}` bridge
// against the currently-linked provider entries on the Auth record.
//
// The callable NEVER trusts a client-supplied provider account
// identifier: the request payload is ignored for identity purposes
// entirely. The set of currently-linked providers is derived server-
// side from the Auth record. The response NEVER echoes a provider
// account identifier, a token, an email, or any profile field.
//
// This callable represents server-side reconciliation, not a client
// assertion that a link or unlink happened. It exists because
// provider-link and provider-unlink changes are NOT detected in real
// time by the platform: `authOnUserCreate` fires only on the first
// creation of the Firebase Auth user, and no Auth-lifecycle trigger
// currently wires provider-data changes to the identity bridge. The
// bridge therefore updates only on:
//   - Auth-user-creation (`authOnUserCreate`, source `authOnUserCreate`),
//   - This callable (source `authReconciliation`), or
//   - Administrative migration invoked from the emulator-only service
//     module (source `adminMigration`).
//
// A student who newly links or unlinks Google after account creation
// must invoke this reconciliation path (or an admin must) for the
// bridge to reflect the change.

// -------------------- Request / response contract --------------------

// The request body is intentionally empty from an identity
// perspective. It is typed as `unknown` and ignored: the caller's UID
// is drawn from `request.auth.uid` and the provider data is drawn
// from the Admin-SDK Auth record.
export type ReconcileMyExternalIdentityRequest = Record<string, never>;

// Per-provider outcome shape returned to the client. `providerId` is
// safe (public vocabulary); `externalIdentityId` is a SHA-256 hash
// safe for the client to receive because it is one-way. `link` and
// `revoke` are internal outcome vocabulary; no raw provider account
// identifier, email, or profile field is included.
export type ReconcileMyExternalIdentityPerProviderResponse = {
  readonly providerId: ExternalIdentityProviderId;
  readonly externalIdentityId: string;
  readonly link?: "created" | "confirmedNoop" | "restored";
  readonly revoke?: "revoked" | "alreadyRevoked" | "absent";
};

export type ReconcileMyExternalIdentityResponse = {
  readonly perProvider: readonly ReconcileMyExternalIdentityPerProviderResponse[];
};

// -------------------- Helpers --------------------

const SUPPORTED_PROVIDERS: readonly ExternalIdentityProviderId[] = [
  "google.com",
];

function extractApprovedProviderAccounts(
  authUser: UserRecord,
): readonly {
  readonly providerId: ExternalIdentityProviderId;
  readonly providerAccountId: string;
}[] {
  const out: {
    providerId: ExternalIdentityProviderId;
    providerAccountId: string;
  }[] = [];
  const seenProviders = new Set<ExternalIdentityProviderId>();
  for (const entry of authUser.providerData ?? []) {
    const providerId = entry.providerId;
    if (
      !(SUPPORTED_PROVIDERS as readonly string[]).includes(providerId)
    ) {
      continue;
    }
    if (seenProviders.has(providerId as ExternalIdentityProviderId)) {
      // Firebase Auth exposes exactly one entry per providerId when
      // the account is linked; multiple entries with the same
      // providerId are malformed. Refuse to reconcile rather than
      // guess which entry authoritative.
      throw new PlatformError(
        "identity.invalidRequest",
        "The Firebase Auth record has multiple entries for the same provider.",
      );
    }
    seenProviders.add(providerId as ExternalIdentityProviderId);
    const providerAccountId = entry.uid;
    if (typeof providerAccountId !== "string" || providerAccountId.length === 0) {
      // Malformed provider record on the Auth user. Refuse rather
      // than guess. The failure never logs the raw provider id or
      // account identifier as PII; only the hashed structural fact
      // is emitted upstream via the audit stream on the identity
      // callable path.
      throw new PlatformError(
        "identity.malformedProviderRecord",
        "A provider record on the Firebase Auth user is missing a valid identifier.",
      );
    }
    out.push({
      providerId: providerId as ExternalIdentityProviderId,
      providerAccountId,
    });
  }
  return out;
}

function projectPerProvider(
  per: ReconcileForUserPerProviderResult,
): ReconcileMyExternalIdentityPerProviderResponse {
  const base = {
    providerId: per.providerId,
    externalIdentityId: per.externalIdentityId,
  };
  const out: ReconcileMyExternalIdentityPerProviderResponse = {
    ...base,
    ...(per.linkOutcome ? { link: per.linkOutcome } : {}),
    ...(per.revokeOutcome ? { revoke: per.revokeOutcome } : {}),
  };
  return out;
}

async function emitAuditEventsForOutcomes(
  actorUserId: string,
  results: readonly ReconcileForUserPerProviderResult[],
): Promise<void> {
  for (const r of results) {
    if (r.linkOutcome === "created") {
      await writeAuditEvent({
        actorUserId,
        actorRole: "system",
        action: "identity.mappingCreated",
        targetType: "externalIdentity",
        targetId: r.externalIdentityId,
      });
    } else if (r.linkOutcome === "restored") {
      await writeAuditEvent({
        actorUserId,
        actorRole: "system",
        action: "identity.mappingRestored",
        targetType: "externalIdentity",
        targetId: r.externalIdentityId,
      });
    } else if (r.linkOutcome === "confirmedNoop") {
      await writeAuditEvent({
        actorUserId,
        actorRole: "system",
        action: "identity.mappingConfirmed",
        targetType: "externalIdentity",
        targetId: r.externalIdentityId,
      });
    }
    if (r.revokeOutcome === "revoked") {
      await writeAuditEvent({
        actorUserId,
        actorRole: "system",
        action: "identity.mappingRevoked",
        targetType: "externalIdentity",
        targetId: r.externalIdentityId,
      });
    }
    // `absent` and `alreadyRevoked` revoke outcomes are no-ops with
    // no audit noise, matching the sprint directive's guidance for
    // idempotent transitions.
  }
}

// -------------------- Handler --------------------

async function reconcileMyExternalIdentityHandler(
  request: CallableRequest<unknown>,
): Promise<ReconcileMyExternalIdentityResponse> {
  const auth = request.auth;
  if (!auth || typeof auth.uid !== "string" || auth.uid.length === 0) {
    throw new PlatformError(
      "identity.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  const uid = auth.uid;

  // Re-read the Firebase Auth user through the Admin SDK. Never
  // trust the request payload for provider information.
  let authUser: UserRecord;
  try {
    authUser = await getAuth().getUser(uid);
  } catch (err) {
    // Log the structural failure with the caller's UID (safe: it is
    // the platform-canonical identifier) and NEVER the request
    // payload.
    log.error("identity.reconcileAuthReadFailed", {
      uid,
      cause: err instanceof Error ? err.name : "unknown",
    });
    throw new PlatformError(
      "identity.authReadFailed",
      "Failed to re-read the Firebase Auth record.",
      err,
    );
  }

  const observedProviders = extractApprovedProviderAccounts(authUser);

  const result = await reconcileExternalIdentityForUser({
    userId: uid,
    source: "authReconciliation",
    observedProviders,
  });

  // Emit one audit event per meaningful transition. Idempotent
  // `alreadyActive` / `alreadyRevoked` / `absent` paths emit
  // nothing. `confirmedNoop` emits `identity.mappingConfirmed` on
  // the reconciliation surface because the callable represents a
  // security-relevant observation that the state was verified.
  await emitAuditEventsForOutcomes(uid, result.perProvider);

  return {
    perProvider: result.perProvider.map(projectPerProvider),
  };
}

// Named export used by the wrapper below and by the test harness.
export { reconcileMyExternalIdentityHandler };

// Exported callable. The Sprint 23C-I directive names this
// `reconcileMyExternalIdentity`; the export name is what the Firebase
// runtime deploys.
export const reconcileMyExternalIdentity = platformCallable(
  reconcileMyExternalIdentityHandler,
);
