import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  log,
  platformCallable,
} from "../shared";

import {
  runInventory,
  type BackfillClassification,
  type ExternalIdentityInventorySummary,
} from "../scripts/migration/external-identity-migration";

// Sprint 23E - `identityMigrationRunProductionInventory` callable.
//
// Read-only production dry-run surface for the Sprint 23C-I external
// identity backfill. This callable is the ONLY way to invoke
// `runInventory` against production Firebase Auth. It exists so an
// operator can determine whether any pre-Sprint-23C-I production
// Google-signed-in users lack a corresponding
// `externalIdentities/{externalIdentityId}` mapping before a later
// sprint considers building a production apply-mode caller.
//
// Guarantees enforced at this layer:
//
// - The caller MUST hold the `platformAdministrator` custom claim.
//   Every other authenticated caller receives
//   `identity.productionInventory.forbidden`; every unauthenticated
//   caller receives `identity.productionInventory.unauthenticated`.
// - The handler NEVER invokes `runBackfill` and NEVER passes the
//   emulator-only acknowledgement. `runBackfill` remains
//   emulator-locked by `assertBackfillSafe`.
// - The handler forwards ONLY `pageToken`, `pageSize`, and
//   `collisionSampleLimit` to `runInventory`. The caller cannot
//   inject an actor UID, a write acknowledgement, or any other
//   option; the actor UID stamped on the migration bookend audit
//   events is derived server-side from `request.auth.uid`.
// - The response contains only aggregate counts, an optional
//   `nextPageToken`, and a bounded array of SHA-256 hashed
//   `externalIdentityId` values for observed collisions. It never
//   carries an email, a display name, a raw provider account
//   identifier, a Firebase UID, or an OAuth token.
// - `runInventory` writes NOTHING to Firestore beyond the bookend
//   `identity.migrationAttempted` / `identity.migrationCompleted`
//   audit events (server-authored, on the server-only `auditEvents`
//   collection); no `externalIdentities` document is created,
//   updated, or deleted; no enrollment, role, or lifecycle field
//   moves.
// - Deterministic pagination and idempotent re-runs: a repeat call
//   with the same `pageToken` and page size against unchanged
//   Firebase Auth state returns identical counts and (subject to
//   pagination ordering, which is Firebase Auth's contract) an
//   identical sample array.

const CALLER_ROLE_ADMIN = "platformAdministrator";
const MAX_PAGE_SIZE = 1000;
const MIN_PAGE_SIZE = 1;
const MAX_COLLISION_SAMPLE_LIMIT = 500;

export type IdentityMigrationRunProductionInventoryRequest = {
  readonly pageToken?: string;
  readonly pageSize?: number;
  readonly collisionSampleLimit?: number;
};

export type IdentityMigrationRunProductionInventoryResponse = {
  readonly usersScanned: number;
  readonly counts: Readonly<Record<BackfillClassification, number>>;
  readonly providerCollisionSamples: readonly string[];
  readonly nextPageToken?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Observability, not lifecycle.
  }
}

function assertAuthenticatedAdministrator(
  request: CallableRequest<unknown>,
): { readonly uid: string } {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throw new PlatformError(
      "identity.productionInventory.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  const token = auth.token as { readonly role?: unknown } | undefined;
  if (!token || token.role !== CALLER_ROLE_ADMIN) {
    throw new PlatformError(
      "identity.productionInventory.forbidden",
      "Caller must be a Platform Administrator.",
    );
  }
  return { uid: auth.uid };
}

function validateRequest(
  data: unknown,
): {
  readonly pageToken?: string;
  readonly pageSize?: number;
  readonly collisionSampleLimit?: number;
} {
  if (data === null || data === undefined) return {};
  if (typeof data !== "object") {
    throw new PlatformError(
      "identity.productionInventory.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  const out: {
    pageToken?: string;
    pageSize?: number;
    collisionSampleLimit?: number;
  } = {};
  if (payload.pageToken !== undefined) {
    if (!isNonEmptyString(payload.pageToken)) {
      throw new PlatformError(
        "identity.productionInventory.invalidRequest",
        "pageToken must be a non-empty string when supplied.",
      );
    }
    out.pageToken = payload.pageToken;
  }
  if (payload.pageSize !== undefined) {
    const size = payload.pageSize;
    if (
      typeof size !== "number" ||
      !Number.isInteger(size) ||
      size < MIN_PAGE_SIZE ||
      size > MAX_PAGE_SIZE
    ) {
      throw new PlatformError(
        "identity.productionInventory.invalidRequest",
        `pageSize must be an integer between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}.`,
      );
    }
    out.pageSize = size;
  }
  if (payload.collisionSampleLimit !== undefined) {
    const limit = payload.collisionSampleLimit;
    if (
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 0 ||
      limit > MAX_COLLISION_SAMPLE_LIMIT
    ) {
      throw new PlatformError(
        "identity.productionInventory.invalidRequest",
        `collisionSampleLimit must be an integer between 0 and ${MAX_COLLISION_SAMPLE_LIMIT}.`,
      );
    }
    out.collisionSampleLimit = limit;
  }
  return out;
}

function projectResponse(
  summary: ExternalIdentityInventorySummary,
): IdentityMigrationRunProductionInventoryResponse {
  return {
    usersScanned: summary.usersScanned,
    counts: summary.counts,
    providerCollisionSamples: summary.providerCollisionSamples,
    ...(summary.nextPageToken !== undefined
      ? { nextPageToken: summary.nextPageToken }
      : {}),
  };
}

async function identityMigrationRunProductionInventoryHandler(
  request: CallableRequest<unknown>,
): Promise<IdentityMigrationRunProductionInventoryResponse> {
  const actor = assertAuthenticatedAdministrator(request);
  const opts = validateRequest(request.data);

  const summary = await runInventory({
    ...(opts.pageToken !== undefined ? { pageToken: opts.pageToken } : {}),
    ...(opts.pageSize !== undefined ? { pageSize: opts.pageSize } : {}),
    ...(opts.collisionSampleLimit !== undefined
      ? { collisionSampleLimit: opts.collisionSampleLimit }
      : {}),
    actorUserId: actor.uid,
  });

  safeLog(() =>
    log.info("identity.productionInventoryComplete", {
      actorUserId: actor.uid,
      usersScanned: summary.usersScanned,
      hasNextPage: summary.nextPageToken !== undefined,
      providerCollisionSamplesCount: summary.providerCollisionSamples.length,
    }),
  );

  return projectResponse(summary);
}

export { identityMigrationRunProductionInventoryHandler };

export const identityMigrationRunProductionInventory = platformCallable(
  identityMigrationRunProductionInventoryHandler,
);
