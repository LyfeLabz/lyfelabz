import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// Grade Improvements V1 - persistent teacher acknowledgment history.
//
// LyfeLabz never reads or writes PowerSchool. A teacher who sees an "Update
// Grade" alert updates PowerSchool by hand and then marks the improvement as
// updated here. These records hold only that teacher-made mark, never a
// claim that any external gradebook was verified.
//
// One record per (assignment occurrence, student):
//   gradeImprovementAcks/{assignmentId}__{studentId}
// with an append-only event log:
//   gradeImprovementAcks/{recordId}/events/{e000001, e000002, ...}
//
// Server-owned. No client may read or write either path directly; the
// terminal default-deny Firestore Rule covers both (no Rules change). The
// four `gradeImprovements*` callables are the only readers and writers.

export const GRADE_IMPROVEMENT_ACKS_COLLECTION = "gradeImprovementAcks";
export const GRADE_IMPROVEMENT_EVENTS_SUBCOLLECTION = "events";

export type GradeImprovementEventType = "acknowledged" | "reversed";

// The acknowledgment currently in effect, derived from the event log and
// cached on the parent record inside the same transaction that appends the
// event. `null` when no acknowledgment is in effect.
export type GradeImprovementEffectiveAck = {
  readonly eventId: string;
  readonly percentage: number;
  readonly attemptId: string;
};

export type GradeImprovementAckRecord = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly eventCount: number;
  readonly effective: GradeImprovementEffectiveAck | null;
  readonly updatedAt: Timestamp;
};

export type GradeImprovementAckRecordWrite = Omit<GradeImprovementAckRecord, "updatedAt"> & {
  readonly updatedAt: FieldValue;
};

// One immutable event. `acknowledged` carries the exact best attempt and
// percentage the teacher confirmed, plus the baseline it was shown against.
// `reversed` names the acknowledgment it undoes (`targetEventId`) and copies
// that acknowledgment's percentage and attempt for display.
export type GradeImprovementEventRecord = {
  readonly eventId: string;
  readonly sequence: number;
  readonly type: GradeImprovementEventType;
  readonly assignmentId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly actorTeacherId: string;
  readonly percentage: number;
  readonly attemptId: string;
  readonly baselinePercentage: number | null;
  readonly targetEventId: string | null;
  readonly createdAt: Timestamp;
};

export type GradeImprovementEventWrite = Omit<GradeImprovementEventRecord, "createdAt"> & {
  readonly createdAt: FieldValue;
};

export function gradeImprovementRecordId(assignmentId: string, studentId: string): string {
  return `${assignmentId}__${studentId}`;
}

export function gradeImprovementEventId(sequence: number): string {
  return `e${String(sequence).padStart(6, "0")}`;
}
