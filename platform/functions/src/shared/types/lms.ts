import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// Canonical top-level collection identifiers for the LMS Integration
// Foundation. Each collection is subordinate to the certified records it
// mirrors per Data Model §2.9.a and Amendment §3.4. None is authoritative
// for upstream LMS state (PDR-019b, PDR-020g).
export const LMS_PROVIDERS_COLLECTION = "lmsProviders";
export const LMS_CONNECTIONS_COLLECTION = "lmsConnections";
export const LMS_CLASS_LINKS_COLLECTION = "lmsClassLinks";
export const LMS_ASSIGNMENT_PUBLICATIONS_COLLECTION =
  "lmsAssignmentPublications";

// Canonical provider identifier vocabulary. The set is closed per Data
// Model §2.9.a and PDR-019h. Additional providers require an amendment
// to LMS_INTEGRATION_ARCHITECTURE.md; the union is intentionally not
// widened by implementation. PDR-020a authorizes Google Classroom as the
// initial provider without permitting Google-specific concerns to escape
// the adapter boundary (PDR-020f).
export type LmsProviderId = "googleClassroom";

// Canonical enrollment source vocabulary added additively to
// classes/{classId} per Amendment §3.4 and PDR-019i. The default remains
// `joinCode`; a class linked to an LMS carries `lms` and refuses join-code
// redemption per PDR-019i. Absence of the field is treated as `joinCode`
// by every consumer of the record shape.
export type ClassEnrollmentSource = "joinCode" | "lms";

// Canonical connection lifecycle per LMS_INTEGRATION_ARCHITECTURE.md §5.3.
// `active` is the ordinary state after a completed OAuth grant. `revoked`
// is the terminal state when the grant is withdrawn (either by the teacher
// through the disconnect callable or by an upstream 401/403 response
// observed by the server). `stale` is reserved for future refresh-related
// posture; the initial scope does not write it. The union is intentionally
// small to keep the mirror state easy to reason about (PDR-019c).
export type LmsConnectionStatus = "active" | "revoked" | "stale";

// Canonical class-link lifecycle per Amendment §3.4. `linked` is the
// ordinary state after a successful class import. `unlinked` is the
// terminal state after an explicit unlink. `broken` is reserved for
// server-observed upstream deletion; the initial scope does not write it.
export type LmsClassLinkStatus = "linked" | "unlinked" | "broken";

// -------------------- lmsProviders/{providerId} --------------------
//
// Read-only reference data per Data Model §2.9.a. Contains no PII and no
// OAuth token material. The document identifier is the LmsProviderId; the
// record carries a display name and a `createdAt` timestamp so its
// admission to the closed set is auditable.
export type LmsProviderRecord = {
  readonly providerId: LmsProviderId;
  readonly displayName: string;
  readonly status: "available";
  readonly createdAt: Timestamp;
};

export type LmsProviderCreationWrite = {
  readonly providerId: LmsProviderId;
  readonly displayName: string;
  readonly status: "available";
  readonly createdAt: FieldValue;
};

// -------------------- lmsConnections/{connectionId} --------------------
//
// One document per (teacher, provider) pair per Data Model §2.9.a. The
// document is server-authoritative and never carries an OAuth access token
// or refresh token in a client-readable field. `tokenRef` is an opaque
// server-only reference that resolves inside the Cloud Function trust
// boundary; the token itself lives in the operational secret manager per
// PDR-019e and LMS_INTEGRATION_ARCHITECTURE.md §10.3.3.
//
// `scopes` records the OAuth scopes granted at connection time so that
// downstream callables can respect the incremental authorization posture
// in §5.2 without re-reading the upstream consent state.
//
// `ownerUid` and `schoolId` are denormalized for security-rule performance
// per Amendment §3.4 and PLATFORM_CONTRACTS.md §12.
export type LmsConnectionRecord = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly providerId: LmsProviderId;
  readonly status: LmsConnectionStatus;
  readonly scopes: readonly string[];
  readonly tokenRef: string;
  readonly connectedAt: Timestamp;
  readonly revokedAt?: Timestamp;
};

export type LmsConnectionCreationWrite = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly providerId: LmsProviderId;
  readonly status: "active";
  readonly scopes: readonly string[];
  readonly tokenRef: string;
  readonly connectedAt: FieldValue;
};

export type LmsConnectionRevocationWrite = {
  readonly status: "revoked";
  readonly revokedAt: FieldValue;
};

// -------------------- lmsClassLinks/{linkId} --------------------
//
// One document per (LyfeLabz class, LMS class) pair per Data Model §2.9.a.
// Establishes the mirror between a certified `classes/{classId}` record
// and its upstream LMS class identifier. The document carries an
// `ownerUid` denormalization scoped to the class's teacher so class-scoped
// reads can be authorized without a second read (Amendment §3.4).
//
// The link is not authoritative for the upstream state (PDR-019b). It
// records the mirror moment and the outcome; upstream identity remains
// resolved by an LMS call on demand.
export type LmsClassLinkRecord = {
  readonly classId: string;
  readonly ownerUid: string;
  readonly schoolId: string;
  readonly providerId: LmsProviderId;
  readonly lmsClassId: string;
  readonly connectionId: string;
  readonly status: LmsClassLinkStatus;
  readonly linkedAt: Timestamp;
  readonly unlinkedAt?: Timestamp;
};

export type LmsClassLinkCreationWrite = {
  readonly classId: string;
  readonly ownerUid: string;
  readonly schoolId: string;
  readonly providerId: LmsProviderId;
  readonly lmsClassId: string;
  readonly connectionId: string;
  readonly status: "linked";
  readonly linkedAt: FieldValue;
};

export type LmsClassLinkUnlinkWrite = {
  readonly status: "unlinked";
  readonly unlinkedAt: FieldValue;
};

// Write shape for the Sprint 8E reconciliation callable when server-side
// reconciliation observes upstream drift (missing upstream class,
// ownership drift). Narrow by design: only the lifecycle field and the
// termination timestamp are writable, so a reconciliation write can
// never launder into an ownership change or a metadata edit per
// PDR-019i / PDR-019j.
export type LmsClassLinkBreakWrite = {
  readonly status: "broken";
  readonly unlinkedAt: FieldValue;
};

// -------------------- lmsAssignmentPublications/{publicationId} --------------------
//
// One document per publication attempt from a LyfeLabz assignment to an
// LMS class, per LMS_INTEGRATION_ARCHITECTURE.md §3.3 and Amendment §3.4.
// The record is server-authoritative and never carries LMS-owned content
// beyond the upstream identifier and (optionally) the upstream URL a
// teacher can click through. The LyfeLabz assignment is authoritative per
// PDR-019d; this record is a mirror of the publication side effect only.
//
// `status` is the terminal outcome of a single publication attempt.
// Re-attempts write a new document; publications are append-only from
// the mirror's perspective so an audit trail of retries is preserved.
export type LmsAssignmentPublicationStatus = "succeeded" | "failed";

export type LmsAssignmentPublicationRecord = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly ownerUid: string;
  readonly schoolId: string;
  readonly providerId: LmsProviderId;
  readonly connectionId: string;
  readonly lmsClassId: string;
  readonly lmsTopicId?: string;
  readonly status: LmsAssignmentPublicationStatus;
  readonly lmsAssignmentId?: string;
  readonly lmsAssignmentUrl?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly publishedAt: Timestamp;
};

export type LmsAssignmentPublicationCreationWrite = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly ownerUid: string;
  readonly schoolId: string;
  readonly providerId: LmsProviderId;
  readonly connectionId: string;
  readonly lmsClassId: string;
  readonly lmsTopicId?: string;
  readonly status: LmsAssignmentPublicationStatus;
  readonly lmsAssignmentId?: string;
  readonly lmsAssignmentUrl?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly publishedAt: FieldValue;
};
