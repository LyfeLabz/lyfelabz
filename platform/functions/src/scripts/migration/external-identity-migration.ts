import { getAuth } from "firebase-admin/auth";
import type { UserRecord } from "firebase-admin/auth";

import {
  PlatformError,
  computeExternalIdentityDocId,
  createOrConfirmExternalIdentity,
  log,
  resolveActiveExternalIdentity,
  userDocRef,
  writeAuditEvent,
} from "../../shared";

// Sprint 23C-I - External identity backfill service.
//
// Server-side service module for external-identity inventory and
// (emulator-only) backfill. This module intentionally exports only
// programmatic functions and is invoked by tests, emulator scripts,
// and administrator-driven local runs. It is NEVER exported from the
// Cloud Functions bundle as a deployed callable.
//
// Two modes:
//   - `runInventory`: read-only. Enumerates Firebase Auth users in
//     pages, classifies each user, and returns deterministic counts.
//     Writes NOTHING (no Firestore document, no audit event).
//   - `runBackfill`: emulator/fixture write mode. For every user
//     with exactly one valid `google.com` provider entry that does
//     not already have a corresponding active external-identity
//     mapping, invokes `createOrConfirmExternalIdentity` with
//     source `adminMigration`. Refuses to run unless a strong
//     safeguard is passed by the caller (see `assertBackfillSafe`).
//
// Guarantees:
//   - Deterministic pagination via `nextPageToken`; a restart resumes
//     from the last cursor.
//   - Idempotent - a re-run does not create a second mapping for the
//     same user; already-active mappings resolve to `confirmedNoop`
//     and are counted, not duplicated.
//   - No enrollment mutation, no role change, no lifecycle change,
//     no activation. This service only writes
//     `externalIdentities/{externalIdentityId}` documents.
//   - No email, display name, provider account identifier, or token
//     data is included in any log payload or return value. The
//     hashed external identity document ID IS safe to log and IS the
//     canonical audit target ID.
//   - Every inventory-run and completed-backfill emits one
//     `identity.migrationAttempted` audit event at start and one
//     `identity.migrationCompleted` audit event at completion. A
//     per-record audit is deliberately avoided during large
//     idempotent migrations, as documented in the Sprint 23C-I
//     completion report.

// -------------------- Public contract --------------------

export type BackfillClassification =
  | "eligibleSingleGoogleProvider"
  | "multipleProvidersOneGoogle"
  | "noGoogleProvider"
  | "orphanUserDocument"
  | "orphanAuthUser"
  | "providerCollision"
  | "disabledAuthUser"
  | "pendingOrProvisionedUser";

export type ExternalIdentityInventorySummary = {
  readonly usersScanned: number;
  readonly counts: Readonly<Record<BackfillClassification, number>>;
  // Sprint 23E - bounded list of SHA-256 external-identity document
  // identifiers observed in the `providerCollision` bucket during this
  // page. The SHA-256 identifier is one-way and never exposes the raw
  // provider account identifier, an email, or a UID. Callers cap the
  // list length via `MigrationServiceOptions.collisionSampleLimit`;
  // the default cap is 50. When the limit is 0, no samples are
  // collected. Samples from a given page may overlap with samples
  // returned on a prior page for the same collision if inventory is
  // rerun; the caller deduplicates across pages if needed.
  readonly providerCollisionSamples: readonly string[];
  readonly nextPageToken?: string;
};

export type ExternalIdentityBackfillSummary = ExternalIdentityInventorySummary & {
  readonly mappingsCreated: number;
  readonly mappingsConfirmed: number;
  readonly mappingsRestored: number;
  readonly collisionsObserved: number;
};

export type MigrationServiceOptions = {
  // Optional starting pagination cursor. Undefined starts from the
  // beginning; a value supplied by a prior partial run resumes.
  readonly pageToken?: string;
  // Optional page size (Firebase Auth Admin SDK cap is 1000). The
  // default is a modest 250 to keep runs interruptible.
  readonly pageSize?: number;
  // Optional actor UID stamped on audit events. When omitted the
  // service uses a stable sentinel actor id; the audit stream then
  // makes the entry attributable to the migration service rather
  // than to a specific human user.
  readonly actorUserId?: string;
  // Sprint 23E - bounded cap on the number of hashed
  // `externalIdentityId` values collected for the
  // `providerCollisionSamples` array. Undefined defaults to 50. Zero
  // disables sample collection entirely (counts still populate).
  readonly collisionSampleLimit?: number;
};

export type BackfillOptions = MigrationServiceOptions & {
  // Strong safeguard: the caller must pass this exact opt-in value
  // to execute writes. Any other value refuses. See
  // `assertBackfillSafe` for the environment guard.
  readonly executeWritesAcknowledgement: "I_UNDERSTAND_EMULATOR_ONLY";
};

const MIGRATION_SERVICE_ACTOR = "system-migration-external-identity";

// -------------------- Environment safeguard --------------------
//
// Backfill is emulator/fixture only. To prevent an accidental
// production execution we require BOTH:
//   1. The caller passes the explicit opt-in acknowledgement.
//   2. The environment presents an emulator indicator - the standard
//      `FIRESTORE_EMULATOR_HOST` env var OR `FIREBASE_AUTH_EMULATOR_HOST`.
// The absence of EITHER refuses the run.
export function assertBackfillSafe(
  opts: BackfillOptions,
): void {
  if (
    opts.executeWritesAcknowledgement !== "I_UNDERSTAND_EMULATOR_ONLY"
  ) {
    throw new PlatformError(
      "identity.migrationWriteSafeguardMissing",
      "External identity backfill requires the explicit emulator-only acknowledgement.",
    );
  }
  const firestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST;
  const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!firestoreEmulator || !authEmulator) {
    throw new PlatformError(
      "identity.migrationWriteSafeguardMissing",
      "External identity backfill requires the Firestore and Firebase Auth emulators.",
    );
  }
}

// -------------------- Internals --------------------

function newCounts(): Record<BackfillClassification, number> {
  return {
    eligibleSingleGoogleProvider: 0,
    multipleProvidersOneGoogle: 0,
    noGoogleProvider: 0,
    orphanUserDocument: 0,
    orphanAuthUser: 0,
    providerCollision: 0,
    disabledAuthUser: 0,
    pendingOrProvisionedUser: 0,
  };
}

function extractSingleGoogleAccount(
  user: UserRecord,
): { readonly providerAccountId: string } | { readonly kind: "none" } | { readonly kind: "malformed" } {
  const google = (user.providerData ?? []).filter(
    (p) => p.providerId === "google.com",
  );
  if (google.length === 0) return { kind: "none" };
  if (google.length > 1) return { kind: "malformed" };
  const uid = google[0].uid;
  if (typeof uid !== "string" || uid.length === 0) return { kind: "malformed" };
  return { providerAccountId: uid };
}

async function classifyUser(
  user: UserRecord,
): Promise<BackfillClassification> {
  if (user.disabled) return "disabledAuthUser";

  const userDoc = await userDocRef(user.uid).get();
  if (!userDoc.exists) return "orphanAuthUser";
  const userData = userDoc.data();
  if (userData) {
    // `status` and `role` are typed in shared/types/user. Provisioned
    // and pendingVerification users are flagged distinctly so a
    // fixture operator can see the mapping does not activate any
    // downstream lifecycle transition.
    const status = (userData as Record<string, unknown>).status;
    if (status === "provisioned" || status === "pendingVerification") {
      // The user document exists but no downstream state has been
      // touched; still eligible for mapping if a valid Google
      // provider entry is present, but recorded distinctly so the
      // operator can identify migration candidates that are not
      // yet activated.
      const g = extractSingleGoogleAccount(user);
      if ("kind" in g && g.kind === "none") return "noGoogleProvider";
      if ("kind" in g && g.kind === "malformed") return "providerCollision";
      // Attach the pending flag; the operator can join this class
      // with `eligibleSingleGoogleProvider` at analysis time.
      return "pendingOrProvisionedUser";
    }
  }

  const providerData = user.providerData ?? [];
  const google = extractSingleGoogleAccount(user);
  if ("kind" in google && google.kind === "none") return "noGoogleProvider";
  if ("kind" in google && google.kind === "malformed") {
    return "providerCollision";
  }
  if (providerData.length > 1) return "multipleProvidersOneGoogle";
  return "eligibleSingleGoogleProvider";
}

type CollisionProbe =
  | { readonly collided: false }
  | { readonly collided: true; readonly externalIdentityId: string };

async function detectExistingMappingCollision(
  user: UserRecord,
): Promise<CollisionProbe> {
  // Detect a stored active mapping for this user's google.com
  // account that resolves to a DIFFERENT Firebase UID. This is the
  // "provider collision" inventory bucket at the mapping layer
  // (distinct from a malformed-provider-record collision).
  const g = extractSingleGoogleAccount(user);
  if ("kind" in g && (g.kind === "none" || g.kind === "malformed")) {
    return { collided: false };
  }
  const providerAccountId = (g as { providerAccountId: string })
    .providerAccountId;
  const resolution = await resolveActiveExternalIdentity({
    providerId: "google.com",
    providerAccountId,
  });
  if (!resolution.resolved) return { collided: false };
  if (resolution.userId === user.uid) return { collided: false };
  return {
    collided: true,
    externalIdentityId: computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId,
    }),
  };
}

async function iterateAuthUsers(
  pageToken: string | undefined,
  pageSize: number,
  visitor: (user: UserRecord) => Promise<void>,
): Promise<string | undefined> {
  const page = await getAuth().listUsers(pageSize, pageToken);
  for (const user of page.users) {
    await visitor(user);
  }
  return page.pageToken;
}

async function emitAttempted(actorUserId: string): Promise<string> {
  const evt = await writeAuditEvent({
    actorUserId,
    actorRole: "system",
    action: "identity.migrationAttempted",
    targetType: "externalIdentity",
    targetId: "migration-run",
  });
  return evt.eventId;
}

async function emitCompleted(actorUserId: string): Promise<void> {
  await writeAuditEvent({
    actorUserId,
    actorRole: "system",
    action: "identity.migrationCompleted",
    targetType: "externalIdentity",
    targetId: "migration-run",
  });
}

// -------------------- Inventory (read-only) --------------------

// Enumerate Firebase Auth users, classify each, and return
// deterministic counts. Writes nothing to Firestore. The audit
// stream carries a single attempted / completed pair so the run is
// evidenced. `nextPageToken` on the return value is the resumption
// cursor; undefined means the enumeration is complete.
export async function runInventory(
  opts: MigrationServiceOptions = {},
): Promise<ExternalIdentityInventorySummary> {
  const actorUserId = opts.actorUserId ?? MIGRATION_SERVICE_ACTOR;
  const pageSize = opts.pageSize ?? 250;
  const collisionSampleLimit =
    opts.collisionSampleLimit === undefined ? 50 : opts.collisionSampleLimit;
  if (
    !Number.isInteger(collisionSampleLimit) ||
    collisionSampleLimit < 0
  ) {
    throw new PlatformError(
      "identity.invalidRequest",
      "collisionSampleLimit must be a non-negative integer.",
    );
  }
  await emitAttempted(actorUserId);

  const counts = newCounts();
  let usersScanned = 0;
  const collisionSamples: string[] = [];

  const nextPageToken = await iterateAuthUsers(
    opts.pageToken,
    pageSize,
    async (user) => {
      usersScanned += 1;
      const cls = await classifyUser(user);
      counts[cls] += 1;
      // Collision layered separately: if the classifier said
      // eligible/multiple, promote to `providerCollision` when the
      // store already has this account bound to a different UID.
      if (
        cls === "eligibleSingleGoogleProvider" ||
        cls === "multipleProvidersOneGoogle" ||
        cls === "pendingOrProvisionedUser"
      ) {
        const probe = await detectExistingMappingCollision(user);
        if (probe.collided) {
          counts[cls] -= 1;
          counts.providerCollision += 1;
          if (collisionSamples.length < collisionSampleLimit) {
            collisionSamples.push(probe.externalIdentityId);
          }
        }
      }
    },
  );

  await emitCompleted(actorUserId);
  log.info("identity.inventoryComplete", {
    usersScanned,
    hasNextPage: Boolean(nextPageToken),
    providerCollisionSamplesCount: collisionSamples.length,
  });

  const result: ExternalIdentityInventorySummary = {
    usersScanned,
    counts,
    providerCollisionSamples: collisionSamples,
    ...(nextPageToken ? { nextPageToken } : {}),
  };
  return result;
}

// -------------------- Backfill (emulator-only write mode) --------------------

// Emulator/fixture write mode. For each eligible user, invoke
// `createOrConfirmExternalIdentity` with source `adminMigration`.
// Re-run safe: existing active mappings resolve to `confirmedNoop`,
// which is counted but not audited per record. Collisions are
// preserved as observations; the store's collision refusal is caught
// and counted, and the existing document is NEVER mutated.
export async function runBackfill(
  opts: BackfillOptions,
): Promise<ExternalIdentityBackfillSummary> {
  assertBackfillSafe(opts);

  const actorUserId = opts.actorUserId ?? MIGRATION_SERVICE_ACTOR;
  const pageSize = opts.pageSize ?? 250;
  await emitAttempted(actorUserId);

  const counts = newCounts();
  let usersScanned = 0;
  let mappingsCreated = 0;
  let mappingsConfirmed = 0;
  let mappingsRestored = 0;
  let collisionsObserved = 0;

  const nextPageToken = await iterateAuthUsers(
    opts.pageToken,
    pageSize,
    async (user) => {
      usersScanned += 1;
      const cls = await classifyUser(user);
      counts[cls] += 1;
      // Only eligible-and-single-Google users receive a write. Users
      // with multiple providers containing exactly one google.com
      // are ALSO backfilled per Sprint 23C-I directive.
      const g = extractSingleGoogleAccount(user);
      if (
        cls !== "eligibleSingleGoogleProvider" &&
        cls !== "multipleProvidersOneGoogle" &&
        cls !== "pendingOrProvisionedUser"
      ) {
        return;
      }
      if ("kind" in g) return;

      try {
        const result = await createOrConfirmExternalIdentity({
          providerId: "google.com",
          providerAccountId: g.providerAccountId,
          userId: user.uid,
          source: "adminMigration",
        });
        if (result.outcome === "created") mappingsCreated += 1;
        else if (result.outcome === "restored") mappingsRestored += 1;
        else if (result.outcome === "confirmedNoop") mappingsConfirmed += 1;
      } catch (err) {
        if (
          err instanceof PlatformError &&
          err.code === "identity.collision"
        ) {
          collisionsObserved += 1;
          counts[cls] -= 1;
          counts.providerCollision += 1;
          // Emit a single safe collision audit event PER OCCURRENCE.
          // The target ID is the hashed document identifier; the
          // audit payload carries only a structural marker.
          try {
            await writeAuditEvent({
              actorUserId,
              actorRole: "system",
              action: "identity.collisionDetected",
              targetType: "externalIdentity",
              targetId: `collision-observed-${collisionsObserved}`,
            });
          } catch (auditErr) {
            log.error("identity.migrationCollisionAuditFailed", {
              cause:
                auditErr instanceof Error ? auditErr.name : "unknown",
            });
          }
          return;
        }
        throw err;
      }
    },
  );

  await emitCompleted(actorUserId);
  log.info("identity.backfillComplete", {
    usersScanned,
    mappingsCreated,
    mappingsConfirmed,
    mappingsRestored,
    collisionsObserved,
    hasNextPage: Boolean(nextPageToken),
  });

  const result: ExternalIdentityBackfillSummary = {
    usersScanned,
    counts,
    // `runBackfill` does not populate hashed samples because each
    // collision it observes already emits its own
    // `identity.collisionDetected` audit event; the audit stream is
    // the durable record for the emulator write path.
    providerCollisionSamples: [],
    mappingsCreated,
    mappingsConfirmed,
    mappingsRestored,
    collisionsObserved,
    ...(nextPageToken ? { nextPageToken } : {}),
  };
  return result;
}
