import type { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { Role } from "./user";

export const AUDIT_EVENTS_COLLECTION = "auditEvents";

// Canonical Sprint 2 audit-action vocabulary per Sprint 2 §4.5. Every value
// is dotted, past-tense, domain-first per Engineering Standards §7. The
// helper accepts only these values, so a caller cannot introduce a second
// naming convention or a typo'd action without a type error. Future sprints
// extend this tuple in one place.
//
// Single source of truth: this const tuple is the ONE authoritative list of
// canonical audit actions. The `AuditAction` type is derived from it below,
// and the runtime validator in `../audit/write-audit-event.ts` imports this
// tuple directly. There is no second manually maintained list to keep in
// lockstep, so a new action added here is simultaneously accepted by the
// type system and by the runtime validator. Sprint 24B Phase 2B.6 removed
// the previous duplicated allowlist that had drifted from this vocabulary
// (Certification defect: `classes.activated` was in the type union but not
// the runtime allowlist, causing every activation to fail its audit write).
export const AUDIT_ACTIONS = [
  "auth.userProvisioned",
  "auth.activationRejected",
  "students.activated",
  "teachers.verificationRequested",
  "teachers.verificationApproved",
  "teachers.verificationDenied",
  "schools.created",
  "classes.created",
  "classes.metadataUpdated",
  "classes.archived",
  "classes.joinCodeRotated",
  // Sprint 24B Phase 2B.3. Emitted by `classesActivate` on a successful
  // atomic `needsSetup -> active` transition. The audit target is the
  // `class`; the payload carries the previous status, the confirmed
  // grade, and the confirmed block. No new event kind is added for
  // `classesLmsCreate`; that seam reuses `classes.created` with a
  // `payload.source = "lms"` marker per Phase 2B Spec §7.1.
  "classes.activated",
  "enrollments.created",
  "enrollments.statusChanged",
  "assignments.created",
  "assignments.updated",
  "assignments.published",
  "assignments.closed",
  "assignments.reopened",
  "assignments.archived",
  "assignments.recipientAdded",
  "submissions.created",
  "submissions.finalized",
  "assessment.sessionBegan",
  "assessment.attemptFinalized",
  "lms.connectionCreated",
  "lms.connectionRevoked",
  "lms.classImported",
  "lms.classUnlinked",
  "lms.ownershipDrift",
  "lms.assignmentPublished",
  "lms.publishFailed",
  // Sprint 27 Phase 4 - Google Classroom assignment-aware deep link
  // (PDR-027 §23). Emitted by the read-only `lmsDeepLinkResolve` resolver
  // once per successful resolution of a `/app/a/{assignmentId}` arrival into
  // an authorized (or informational) LyfeLabz assignment context. The audit
  // target is the `assignment`; the payload carries only the resolved
  // `attemptContext` and `internalTarget` routing hint. It NEVER carries a
  // classmate identifier, a Classroom coursework identifier, a Google
  // account identifier, a session or attempt id, a score, or any student PII
  // beyond the actor identifiers the audit policy already permits. It is the
  // ONLY document the resolver writes; the resolver is otherwise read-only
  // against LyfeLabz state (PDR-027 §10.3, §17).
  "lms.deepLinkResolved",
  // Sprint 23C - Google Classroom roster synchronization. Emitted once
  // per completed reconciliation of one linked upstream class against
  // one LyfeLabz class's enrollments. The audit target is the LyfeLabz
  // `class` and the payload carries only deterministic reconciliation
  // counts, the provider identifier, and structural roster-shape
  // signals. Never carries provider account identifiers, Firebase UIDs,
  // student names, emails, or profile data.
  "lms.rosterSynchronized",
  // Sprint 26 Phase 1 - minimal consent-flow observability. Two PII-safe
  // durable outcomes on the incremental scope-widening path
  // (connections-complete.ts), which previously had structured logging
  // but no durable audit evidence (Sprint 26 §4.8, §7.G).
  //
  // `lms.connectionScopesWidened` records that an existing active
  // connection's granted-scope set was successfully widened through
  // incremental authorization. Emitted only AFTER the connection
  // document update commits, so the event can never describe a widening
  // that did not actually complete. Target is the `lmsConnection`; the
  // payload carries only the provider id. It NEVER carries the widened
  // scope array, the upstream Google account identifier, tokens, or any
  // PII. Reuses the exact structured-log signal name already emitted at
  // the same lifecycle point so there is one vocabulary for the outcome.
  "lms.connectionScopesWidened",
  // `lms.connectionWideningRejected` records that incremental widening
  // was rejected. Emitted best-effort immediately before the hard
  // `lms.identityMismatch` reject and BEFORE any connection or credential
  // mutation, so audit persistence is never load-bearing for the
  // security outcome. Target is the `lmsConnection`; the payload carries
  // only the provider id and a low-cardinality `reason` category
  // (currently only "identityMismatch"). It NEVER records either the
  // stored or the returned Google identity, tokens, or any PII.
  "lms.connectionWideningRejected",
  // Sprint 26 certification follow-up - Reconnect recovery correction.
  // Two PII-safe durable outcomes on the reconnect/recovery path
  // (connections-complete.ts), which replaces the unusable credential on
  // an existing active connection without disconnecting first. These are
  // distinct product concepts from scope widening and from a brand-new
  // connection, so they reuse neither `lms.connectionScopesWidened` (no
  // scope was widened - only the base credential was restored) nor
  // `lms.connectionCreated` (no new logical connection was created).
  //
  // `lms.connectionRecovered` records that an existing active connection's
  // unusable credential was successfully replaced with a fresh one through
  // an explicit teacher-requested reconnect. Emitted only AFTER the
  // connection document update commits, so the event can never describe a
  // recovery that did not actually complete. Target is the `lmsConnection`;
  // the payload carries only the provider id. It NEVER carries the restored
  // scope array, the upstream Google account identifier, tokens, or PII.
  "lms.connectionRecovered",
  // `lms.connectionRecoveryRejected` records that a reconnect was rejected
  // because the returned Google identity did not match the identity on the
  // existing durable connection. Emitted best-effort immediately before the
  // hard `lms.identityMismatch` reject and BEFORE any connection or
  // credential mutation, so audit persistence is never load-bearing for the
  // security outcome. Symmetric with `lms.connectionWideningRejected`.
  // Target is the `lmsConnection`; the payload carries only the provider id
  // and a low-cardinality `reason` category (currently only
  // "identityMismatch"). It NEVER records either the stored or the returned
  // Google identity, tokens, or any PII.
  "lms.connectionRecoveryRejected",
  // Sprint 23C-I - Student External Identity Bridge. Every event
  // targets an `externalIdentity` target type whose target ID is the
  // hashed document identifier; the raw provider account identifier
  // NEVER appears in an audit target ID or an audit payload.
  "identity.mappingCreated",
  "identity.mappingConfirmed",
  "identity.collisionDetected",
  "identity.mappingRevoked",
  "identity.mappingRestored",
  "identity.migrationAttempted",
  "identity.migrationCompleted",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Audit events are indexed by target type and target id per Data Model §3.8.
// The set is left open as `string` because target types cross domain
// boundaries (users, classes, assignments, ...) and are enumerated by the
// Data Model rather than by this shared type.
export type AuditTargetType = string;

// Canonical actor role for an audit event per Data Model §3.8. Extends the
// domain `Role` enumeration with the `system` sentinel used by triggers,
// scheduled jobs, and other trusted-server contexts where no user actor
// initiated the action. The domain `Role` union is intentionally not
// widened so that user-record shapes, custom claims, and onboarding
// callables continue to see only user-authorable roles.
export type ActorRole = Role | "system";

// The `payload` field is a small structured object per Data Model §3.8. It
// carries operation-specific detail (never PII) and is optional on every
// event.
export type AuditPayload = Readonly<Record<string, unknown>>;

// Canonical audit event record shape per Data Model §3.8.
//
// Required fields: actorUserId, actorRole, action, targetType, targetId,
// occurredAt. Conditionally required: schoolId (required for user-actor
// events and for system-actor events with a resolvable school association;
// absent when no school association exists at write time, as with
// `auth.userProvisioned`). Optional fields: payload, correlationId. No
// other fields exist on this record.
//
// This type is the single source of truth for reads of
// auditEvents/{eventId}. Writers use `AuditEventWrite` so that
// `FieldValue.serverTimestamp()` can be used at the write boundary.
export type AuditEventRecord = {
  readonly actorUserId: string;
  readonly actorRole: ActorRole;
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId: string;
  readonly schoolId?: string;
  readonly districtId?: string;
  readonly occurredAt: Timestamp;
  readonly payload?: AuditPayload;
  readonly correlationId?: string;
};

// Write shape for audit-event creates. Identical to `AuditEventRecord`
// except `occurredAt` is a `FieldValue` so the server timestamp sentinel
// can be used. The canonical helper is the only writer.
export type AuditEventWrite = {
  readonly actorUserId: string;
  readonly actorRole: ActorRole;
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId: string;
  readonly schoolId?: string;
  readonly districtId?: string;
  readonly occurredAt: FieldValue;
  readonly payload?: AuditPayload;
  readonly correlationId?: string;
};
