import { FieldValue } from "firebase-admin/firestore";

import { PlatformError } from "../errors/platform-error";
import {
  externalIdentitiesCollectionRef,
  externalIdentityDocRef,
} from "../firestore/typed-ref";
import { runFirestoreTransaction } from "../firestore/transaction";
import type {
  ExternalIdentityProviderId,
  ExternalIdentityRecord,
  ExternalIdentitySource,
} from "../types/external-identity";

import {
  assertValidProviderAccountId,
  assertValidProviderId,
  computeExternalIdentityDocId,
} from "./external-identity-doc-id";

// Sprint 23C-I - External identity store.
//
// The store is the SINGLE canonical path by which Cloud Function code
// creates, confirms, resolves, revokes, or restores a mapping between
// an upstream provider identity and a LyfeLabz Firebase Auth UID. No
// other module writes `externalIdentities/{externalIdentityId}` and no
// callable reads the collection outside this store.
//
// Uniqueness invariants (enforced transactionally):
//
//   1. One provider account maps to only one Firebase UID. A create
//      that targets an (providerId, providerAccountId) pair whose
//      document already exists with a different UID is a collision
//      and is REFUSED. The existing record is preserved.
//
//   2. One Firebase UID has at most one active identity per provider.
//      A create that would introduce a SECOND active mapping for the
//      same (userId, providerId) is REFUSED. The uniqueness scan runs
//      inside the same transaction that would perform the write, so
//      two concurrent create attempts cannot both become active - the
//      Firestore transaction retry semantics force one to observe the
//      other's write on retry and refuse.
//
//   3. A provider account may not be reassigned automatically to a
//      different UID. An operator who needs to reassign a mapping
//      must revoke and manually reissue; the store never performs
//      that transition on its own.
//
//   4. A revoked record may be restored only for its ORIGINAL UID.
//
//   5. Existing (providerId, providerAccountId, userId) are IMMUTABLE
//      while active. The write shapes structurally exclude these
//      fields on non-creation transitions so this invariant cannot be
//      violated even by a bug in the store itself.
//
// Errors are stable, safe `PlatformError` instances with dotted
// `identity.*` codes. The collision path NEVER exposes the
// conflicting UID in the public error message; the caller receives
// only the identity-level refusal.
//
// Logging is minimal and structured; no field in this module logs the
// raw provider account identifier, the raw provider id, an email, a
// display name, a token, or a conflicting UID. The hashed document
// identifier is safe to log and IS the canonical audit target ID.

export type ExternalIdentityResolution =
  | { readonly resolved: true; readonly userId: string }
  | { readonly resolved: false };

export type CreateOrConfirmInput = {
  readonly providerId: ExternalIdentityProviderId;
  readonly providerAccountId: string;
  readonly userId: string;
  readonly source: ExternalIdentitySource;
};

// The outcome of a `createOrConfirm` call, projected for callers that
// need to decide whether to emit an audit event or not. `noopConfirm`
// is emitted for idempotent replays where the existing active mapping
// already matches the request byte-for-byte; the migration path uses
// it to avoid emitting an audit-per-record during large idempotent
// re-runs.
export type CreateOrConfirmOutcome =
  | "created"
  | "confirmedNoop"
  | "restored";

export type CreateOrConfirmResult = {
  readonly externalIdentityId: string;
  readonly userId: string;
  readonly outcome: CreateOrConfirmOutcome;
};

export type RevokeInput = {
  readonly providerId: ExternalIdentityProviderId;
  readonly providerAccountId: string;
  readonly userId: string;
};

export type RevokeOutcome =
  // The record existed as `active` and was transitioned to `revoked`.
  | "revoked"
  // The record existed as `revoked`; no write was performed.
  | "alreadyRevoked"
  // No record existed; no write was performed.
  | "absent";

export type RevokeResult = {
  readonly externalIdentityId: string;
  readonly outcome: RevokeOutcome;
};

export type RestoreInput = {
  readonly providerId: ExternalIdentityProviderId;
  readonly providerAccountId: string;
  readonly userId: string;
};

export type RestoreOutcome =
  // The record existed as `revoked` and was transitioned to `active`.
  | "restored"
  // The record existed as `active` and already matched the request.
  | "alreadyActive";

export type RestoreResult = {
  readonly externalIdentityId: string;
  readonly outcome: RestoreOutcome;
};

// Reconciliation-for-user input. The caller passes an authoritative
// list of currently-linked provider accounts (typically derived by
// re-reading the Firebase Auth user record with the Admin SDK). The
// store then, per (providerId), aligns the persisted mapping with the
// observed state: create/confirm/restore when the observed account
// matches; revoke when the persisted account no longer appears on the
// Auth user.
export type ReconcileForUserInput = {
  readonly userId: string;
  readonly source: ExternalIdentitySource;
  readonly observedProviders: readonly {
    readonly providerId: ExternalIdentityProviderId;
    readonly providerAccountId: string;
  }[];
};

export type ReconcileForUserPerProviderResult = {
  readonly providerId: ExternalIdentityProviderId;
  readonly externalIdentityId: string;
  // The observed-side outcome. Absent when the observed side had no
  // account for this provider (revocation path). Present when the
  // caller supplied an observed account.
  readonly linkOutcome?: CreateOrConfirmOutcome;
  // The revocation-side outcome. Absent when nothing was persisted
  // for the (userId, providerId) pair on the Firestore side (nothing
  // to revoke).
  readonly revokeOutcome?: RevokeOutcome;
};

export type ReconcileForUserResult = {
  readonly perProvider: readonly ReconcileForUserPerProviderResult[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertValidUserId(value: unknown): string {
  if (!isNonEmptyString(value)) {
    throw new PlatformError(
      "identity.invalidUserId",
      "userId must be a non-empty string.",
    );
  }
  return value;
}

const APPROVED_SOURCES: readonly ExternalIdentitySource[] = [
  "authOnUserCreate",
  "authReconciliation",
  "adminMigration",
];

function assertValidSource(value: unknown): ExternalIdentitySource {
  if (
    typeof value !== "string" ||
    !(APPROVED_SOURCES as readonly string[]).includes(value)
  ) {
    throw new PlatformError(
      "identity.invalidSource",
      "source is not an approved external-identity origin.",
    );
  }
  return value as ExternalIdentitySource;
}

// Look up the canonical mapping for (providerId, providerAccountId).
// Returns the Firebase UID iff a persisted document exists whose
// stored providerId matches, stored providerAccountId matches BYTE-
// EXACT, and status is `active`. Any other state (missing document,
// revoked mapping, mismatched providerAccountId, mismatched
// providerId) yields `{ resolved: false }`. The raw provider account
// identifier is never exposed on the return value.
export async function resolveActiveExternalIdentity(input: {
  readonly providerId: ExternalIdentityProviderId;
  readonly providerAccountId: string;
}): Promise<ExternalIdentityResolution> {
  const providerId = assertValidProviderId(input.providerId);
  const providerAccountId = assertValidProviderAccountId(
    input.providerAccountId,
  );
  const docId = computeExternalIdentityDocId({ providerId, providerAccountId });
  const snap = await externalIdentityDocRef(docId).get();
  if (!snap.exists) return { resolved: false };
  const data = snap.data();
  if (!data) return { resolved: false };
  if (data.providerId !== providerId) return { resolved: false };
  if (data.providerAccountId !== providerAccountId) return { resolved: false };
  if (data.status !== "active") return { resolved: false };
  if (!isNonEmptyString(data.userId)) return { resolved: false };
  return { resolved: true, userId: data.userId };
}

// Idempotent create-or-confirm. Enforces every uniqueness invariant
// transactionally. See the module header for the invariant list.
//
// Return values:
//   - outcome === "created": a new document was written.
//   - outcome === "restored": an existing `revoked` document for the
//     SAME UID was transitioned back to `active`.
//   - outcome === "confirmedNoop": an existing `active` document for
//     the SAME UID already matched; no write was performed.
//
// Refusal cases:
//   - identity.collision: the requested (providerId, providerAccountId)
//     resolves to a DIFFERENT UID's document. The stored document is
//     preserved and no field on it is mutated. The public error
//     message does NOT contain the conflicting UID.
//   - identity.secondActiveForUser: a DIFFERENT active mapping already
//     exists for (userId, providerId). The existing record is
//     preserved.
export async function createOrConfirmExternalIdentity(
  input: CreateOrConfirmInput,
): Promise<CreateOrConfirmResult> {
  const providerId = assertValidProviderId(input.providerId);
  const providerAccountId = assertValidProviderAccountId(
    input.providerAccountId,
  );
  const userId = assertValidUserId(input.userId);
  const source = assertValidSource(input.source);

  const docId = computeExternalIdentityDocId({ providerId, providerAccountId });

  return runFirestoreTransaction<CreateOrConfirmResult>(async (tx) => {
    const docRef = externalIdentityDocRef(docId);
    const snap = await tx.get(docRef);

    if (snap.exists) {
      const data = snap.data();
      if (!data) {
        throw new PlatformError(
          "identity.malformedRecord",
          "External identity document is present but has no data.",
        );
      }
      // Invariant #1: one provider account maps to only one UID.
      if (data.userId !== userId) {
        throw new PlatformError(
          "identity.collision",
          "This provider account is already linked to a different LyfeLabz user.",
        );
      }
      // Defense-in-depth: the document identifier is the SHA-256 of
      // (providerId, providerAccountId), so a mismatch here would
      // indicate a stored record whose fields drifted from the doc
      // ID. Refuse rather than silently repair.
      if (data.providerId !== providerId) {
        throw new PlatformError(
          "identity.malformedRecord",
          "Stored providerId does not match the derived identifier.",
        );
      }
      if (data.providerAccountId !== providerAccountId) {
        throw new PlatformError(
          "identity.malformedRecord",
          "Stored providerAccountId does not match the derived identifier.",
        );
      }
      if (data.status === "active") {
        // Idempotent confirmation. No write, no audit noise.
        return {
          externalIdentityId: docId,
          userId,
          outcome: "confirmedNoop",
        };
      }
      // Restore path. Invariant #4: restore only for the ORIGINAL
      // UID. UID match was checked above. Preserve `createdAt` and
      // `source` by structurally excluding them from the write shape;
      // update `updatedAt` and flip `status` to `active`.
      //
      // Before restoring, verify the sibling invariant #2: no OTHER
      // active mapping exists for (userId, providerId).
      await assertNoOtherActiveMappingForUser(tx, {
        userId,
        providerId,
        excludingDocId: docId,
      });
      tx.update(docRef, {
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        externalIdentityId: docId,
        userId,
        outcome: "restored",
      };
    }

    // Create path. Enforce invariant #2 before writing.
    await assertNoOtherActiveMappingForUser(tx, {
      userId,
      providerId,
      excludingDocId: docId,
    });
    tx.create(docRef, {
      providerId,
      providerAccountId,
      userId,
      status: "active",
      source,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      externalIdentityId: docId,
      userId,
      outcome: "created",
    };
  });
}

// Enforce invariant #2 - "one Firebase UID has at most one active
// identity for the same provider." The scan runs INSIDE the caller's
// transaction so the read is retried on conflict; two concurrent
// creates that both target the same (userId, providerId) will
// therefore observe each other on retry and exactly one becomes
// active.
//
// The query filters on `userId`, `providerId`, and `status` and
// requires a single-field auto-index (standard Firestore behavior;
// no composite index required for equality-only filters on distinct
// fields when combined via `.where()` chains). If a future field
// combination requires an index, the emulator will report it.
async function assertNoOtherActiveMappingForUser(
  tx: FirebaseFirestore.Transaction,
  input: {
    readonly userId: string;
    readonly providerId: ExternalIdentityProviderId;
    readonly excludingDocId: string;
  },
): Promise<void> {
  const query = externalIdentitiesCollectionRef()
    .where("userId", "==", input.userId)
    .where("providerId", "==", input.providerId)
    .where("status", "==", "active");
  const snap = await tx.get(query);
  for (const doc of snap.docs) {
    if (doc.id !== input.excludingDocId) {
      throw new PlatformError(
        "identity.secondActiveForUser",
        "This user already has an active identity for this provider.",
      );
    }
  }
}

// Revoke an existing mapping. Transitions active -> revoked. Preserves
// providerId, providerAccountId, userId, source, createdAt. Updates
// `updatedAt`. Idempotent: repeated revoke of the same (providerId,
// providerAccountId, userId) triple yields `alreadyRevoked` without a
// second write. Absent records yield `absent` and NO write.
//
// Refusal case:
//   - identity.collision: the persisted document exists but is bound
//     to a DIFFERENT UID. Refuse; do not touch.
export async function revokeExternalIdentity(
  input: RevokeInput,
): Promise<RevokeResult> {
  const providerId = assertValidProviderId(input.providerId);
  const providerAccountId = assertValidProviderAccountId(
    input.providerAccountId,
  );
  const userId = assertValidUserId(input.userId);
  const docId = computeExternalIdentityDocId({ providerId, providerAccountId });

  return runFirestoreTransaction<RevokeResult>(async (tx) => {
    const docRef = externalIdentityDocRef(docId);
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      return { externalIdentityId: docId, outcome: "absent" };
    }
    const data = snap.data();
    if (!data) {
      throw new PlatformError(
        "identity.malformedRecord",
        "External identity document is present but has no data.",
      );
    }
    if (data.userId !== userId) {
      throw new PlatformError(
        "identity.collision",
        "This provider account is linked to a different LyfeLabz user.",
      );
    }
    if (data.status === "revoked") {
      return { externalIdentityId: docId, outcome: "alreadyRevoked" };
    }
    tx.update(docRef, {
      status: "revoked",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { externalIdentityId: docId, outcome: "revoked" };
  });
}

// Restore a revoked mapping. See invariant #4: restore is permitted
// only for the ORIGINAL UID. Restoring a mapping that is already
// active for the same UID yields `alreadyActive` without a write.
//
// Refusal cases:
//   - identity.notFound: no document exists for (providerId,
//     providerAccountId).
//   - identity.collision: the document is bound to a different UID.
//   - identity.secondActiveForUser: restoring would create a second
//     active mapping for (userId, providerId).
export async function restoreExternalIdentity(
  input: RestoreInput,
): Promise<RestoreResult> {
  const providerId = assertValidProviderId(input.providerId);
  const providerAccountId = assertValidProviderAccountId(
    input.providerAccountId,
  );
  const userId = assertValidUserId(input.userId);
  const docId = computeExternalIdentityDocId({ providerId, providerAccountId });

  return runFirestoreTransaction<RestoreResult>(async (tx) => {
    const docRef = externalIdentityDocRef(docId);
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      throw new PlatformError(
        "identity.notFound",
        "No external identity exists for the requested provider account.",
      );
    }
    const data = snap.data();
    if (!data) {
      throw new PlatformError(
        "identity.malformedRecord",
        "External identity document is present but has no data.",
      );
    }
    if (data.userId !== userId) {
      throw new PlatformError(
        "identity.collision",
        "This provider account is linked to a different LyfeLabz user.",
      );
    }
    if (data.status === "active") {
      return { externalIdentityId: docId, outcome: "alreadyActive" };
    }
    await assertNoOtherActiveMappingForUser(tx, {
      userId,
      providerId,
      excludingDocId: docId,
    });
    tx.update(docRef, {
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { externalIdentityId: docId, outcome: "restored" };
  });
}

// Server-side list of every mapping for a given Firebase UID
// (active + revoked). Used only by internal reconciliation. NEVER
// exposed through a client callable.
export async function listExternalIdentitiesForUser(
  userId: string,
): Promise<readonly ExternalIdentityRecord[]> {
  const validated = assertValidUserId(userId);
  const snap = await externalIdentitiesCollectionRef()
    .where("userId", "==", validated)
    .get();
  const out: ExternalIdentityRecord[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data) out.push(data);
  }
  return out;
}

// Full reconciliation for a single user: align the persisted mapping
// state for `userId` with the observed provider link state. For each
// approved provider:
//   - If the caller observed an account for the provider:
//       * If the persisted mapping matches (providerId,
//         providerAccountId, userId) and is active - `confirmedNoop`.
//       * If the persisted mapping matches and is revoked - `restored`.
//       * If no persisted mapping matches - `created`.
//   - If the caller did NOT observe an account for the provider AND a
//     persisted ACTIVE mapping exists for (userId, providerId) - it
//     is transitioned to `revoked`.
//
// Refusal cases propagate from `createOrConfirmExternalIdentity` and
// `revokeExternalIdentity` (collision, secondActiveForUser).
export async function reconcileExternalIdentityForUser(
  input: ReconcileForUserInput,
): Promise<ReconcileForUserResult> {
  const userId = assertValidUserId(input.userId);
  const source = assertValidSource(input.source);
  if (!Array.isArray(input.observedProviders)) {
    throw new PlatformError(
      "identity.invalidRequest",
      "observedProviders must be an array.",
    );
  }
  const observedInput: ReconcileForUserInput["observedProviders"] =
    input.observedProviders as ReconcileForUserInput["observedProviders"];

  const perProvider: ReconcileForUserPerProviderResult[] = [];
  const observedByProvider = new Map<ExternalIdentityProviderId, string>();
  for (const observed of observedInput) {
    const p = assertValidProviderId(observed.providerId);
    const a = assertValidProviderAccountId(observed.providerAccountId);
    if (observedByProvider.has(p)) {
      // Firebase Auth exposes exactly one `google.com` entry when the
      // account is linked; multiple entries for the same providerId
      // are a malformed input. Refuse safely.
      throw new PlatformError(
        "identity.invalidRequest",
        "Duplicate providerId observed on the Auth user record.",
      );
    }
    observedByProvider.set(p, a);
  }

  // Load the persisted state ONCE and reason over it in memory. Each
  // per-provider mutation still runs inside its own transaction for
  // the uniqueness enforcement above.
  const persisted = await listExternalIdentitiesForUser(userId);
  const persistedActiveByProvider = new Map<
    ExternalIdentityProviderId,
    ExternalIdentityRecord
  >();
  for (const rec of persisted) {
    if (rec.status !== "active") continue;
    persistedActiveByProvider.set(
      rec.providerId,
      rec,
    );
  }

  // Link/confirm every observed provider account.
  for (const [providerId, providerAccountId] of observedByProvider) {
    const linkResult = await createOrConfirmExternalIdentity({
      providerId,
      providerAccountId,
      userId,
      source,
    });
    perProvider.push({
      providerId,
      externalIdentityId: linkResult.externalIdentityId,
      linkOutcome: linkResult.outcome,
    });
  }

  // Revoke any persisted-active mapping for a provider the caller did
  // NOT observe on the Auth user record.
  for (const [providerId, rec] of persistedActiveByProvider) {
    if (observedByProvider.has(providerId)) continue;
    const revokeResult = await revokeExternalIdentity({
      providerId,
      providerAccountId: rec.providerAccountId,
      userId,
    });
    perProvider.push({
      providerId,
      externalIdentityId: revokeResult.externalIdentityId,
      revokeOutcome: revokeResult.outcome,
    });
  }

  return { perProvider };
}
