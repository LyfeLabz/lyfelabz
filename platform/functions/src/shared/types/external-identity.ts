import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// Sprint 23C-I - Student External Identity Bridge.
//
// The `externalIdentities/{externalIdentityId}` collection is a
// server-controlled, server-only reverse-lookup bridge that associates
// an upstream provider identity (currently the Google Classroom
// `Student.userId`, delivered as the Firebase Auth `google.com`
// provider account identifier) with an existing LyfeLabz Firebase Auth
// UID.
//
// Firebase UID remains the canonical LyfeLabz user identity: it is the
// `users/{uid}` document ID, the enrollment student identifier, and
// the assessment / attempts owner. This bridge NEVER replaces Firebase
// UID and NEVER surfaces provider account identifiers through client
// callables or client-visible documents.
//
// The document identifier is a deterministic SHA-256 hash of
// `"v1\x00" + providerId + "\x00" + providerAccountId` produced by the
// dedicated helper `computeExternalIdentityDocId`. The raw provider
// account identifier NEVER appears in the document path, in an audit
// target ID, or in any structured log payload. The record body MAY
// store the raw provider account identifier for downstream server-side
// resolution; the record is treated as sensitive and is denied to every
// client role at the Rules layer.
//
// Uniqueness invariants enforced by the store transactionally per the
// Sprint 23C-I directive:
//   1. One provider account maps to only one Firebase UID.
//   2. One Firebase UID has at most one active identity per provider.
//   3. A provider account may not be reassigned automatically to a
//      different UID.
//   4. A revoked record may be restored only for its original UID.
//   5. Existing providerId, providerAccountId, and userId are
//      immutable while active.

export const EXTERNAL_IDENTITIES_COLLECTION = "externalIdentities";

// The single provider currently modeled. Kept as a union so future
// providers extend the vocabulary in one place with a type error at
// every writer / reader if they are not updated in lockstep.
export type ExternalIdentityProviderId = "google.com";

// Lifecycle field. `active` = the mapping resolves during roster
// matching. `revoked` = preserved for audit continuity but does NOT
// resolve.
export type ExternalIdentityStatus = "active" | "revoked";

// Records the origin of the CREATION of a mapping. Not rewritten on
// subsequent status transitions; per-transition provenance flows
// through the audit stream.
export type ExternalIdentitySource =
  | "authOnUserCreate"
  | "authReconciliation"
  | "adminMigration";

// Canonical read shape. Every field is required on a persisted
// document; there is no optional metadata on this record. Additional
// profile fields, Classroom fields, or downstream projection fields
// are intentionally excluded to keep the record narrow and to prevent
// this collection from silently becoming an alternate user index.
export type ExternalIdentityRecord = {
  readonly providerId: ExternalIdentityProviderId;
  readonly providerAccountId: string;
  readonly userId: string;
  readonly status: ExternalIdentityStatus;
  readonly source: ExternalIdentitySource;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
};

// Creation-write shape. Identical to the record shape except the
// timestamps are `FieldValue` so the server-timestamp sentinel can be
// used at the write boundary.
export type ExternalIdentityCreationWrite = {
  readonly providerId: ExternalIdentityProviderId;
  readonly providerAccountId: string;
  readonly userId: string;
  readonly status: "active";
  readonly source: ExternalIdentitySource;
  readonly createdAt: FieldValue;
  readonly updatedAt: FieldValue;
};

// Revocation-write shape. Only `status` and `updatedAt` mutate; the
// immutable ownership fields (providerId, providerAccountId, userId)
// and the creation-origin fields (source, createdAt) are absent from
// the write shape so a revocation cannot silently reassign a mapping,
// rewrite its origin, or backdate its creation.
export type ExternalIdentityRevocationWrite = {
  readonly status: "revoked";
  readonly updatedAt: FieldValue;
};

// Restoration-write shape. Symmetric to the revocation write shape.
// The store enforces that a restoration targets the ORIGINAL UID and
// the ORIGINAL (providerId, providerAccountId) pair; the write shape
// itself excludes those fields so this write cannot launder a change
// to any of them.
export type ExternalIdentityRestorationWrite = {
  readonly status: "active";
  readonly updatedAt: FieldValue;
};
