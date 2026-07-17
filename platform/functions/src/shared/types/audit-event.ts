import type { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { Role } from "./user";

export const AUDIT_EVENTS_COLLECTION = "auditEvents";

// Canonical Sprint 2 audit-action vocabulary per Sprint 2 §4.5. Every value
// is dotted, past-tense, domain-first per Engineering Standards §7. The
// helper accepts only these values, so a caller cannot introduce a second
// naming convention or a typo'd action without a type error. Future sprints
// extend this union in one place.
export type AuditAction =
  | "auth.userProvisioned"
  | "auth.activationRejected"
  | "students.activated"
  | "teachers.verificationRequested"
  | "teachers.verificationApproved"
  | "teachers.verificationDenied"
  | "schools.created"
  | "classes.created"
  | "classes.metadataUpdated"
  | "classes.archived"
  | "classes.joinCodeRotated"
  | "enrollments.created"
  | "enrollments.statusChanged"
  | "assignments.created"
  | "assignments.updated"
  | "assignments.published"
  | "assignments.closed"
  | "assignments.reopened"
  | "assignments.archived"
  | "assignments.recipientAdded"
  | "submissions.created"
  | "submissions.finalized"
  | "assessment.sessionBegan"
  | "assessment.attemptFinalized"
  | "lms.connectionCreated"
  | "lms.connectionRevoked"
  | "lms.classImported"
  | "lms.classUnlinked"
  | "lms.ownershipDrift"
  | "lms.assignmentPublished"
  | "lms.publishFailed";

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
