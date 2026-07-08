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
  | "teachers.verificationDenied";

// Audit events are indexed by target type and target id per Data Model §3.8.
// The set is left open as `string` because target types cross domain
// boundaries (users, classes, assignments, ...) and are enumerated by the
// Data Model rather than by this shared type.
export type AuditTargetType = string;

// The `payload` field is a small structured object per Data Model §3.8. It
// carries operation-specific detail (never PII) and is optional on every
// event.
export type AuditPayload = Readonly<Record<string, unknown>>;

// Canonical audit event record shape per Data Model §3.8.
//
// Required fields: actorUserId, actorRole, action, targetType, targetId,
// schoolId, occurredAt. Optional fields: payload, correlationId. No other
// fields exist on this record.
//
// This type is the single source of truth for reads of
// auditEvents/{eventId}. Writers use `AuditEventWrite` so that
// `FieldValue.serverTimestamp()` can be used at the write boundary.
export type AuditEventRecord = {
  readonly actorUserId: string;
  readonly actorRole: Role;
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId: string;
  readonly schoolId: string;
  readonly occurredAt: Timestamp;
  readonly payload?: AuditPayload;
  readonly correlationId?: string;
};

// Write shape for audit-event creates. Identical to `AuditEventRecord`
// except `occurredAt` is a `FieldValue` so the server timestamp sentinel
// can be used. The canonical helper is the only writer.
export type AuditEventWrite = {
  readonly actorUserId: string;
  readonly actorRole: Role;
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId: string;
  readonly schoolId: string;
  readonly occurredAt: FieldValue;
  readonly payload?: AuditPayload;
  readonly correlationId?: string;
};
