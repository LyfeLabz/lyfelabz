import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// Lab Report Assistant cloud autosave (October 2026). One private working
// draft per student, stored at
// `studentLabReports/{studentId}/reports/{reportId}`. The record family is
// server-owned: zero direct client access for any role (see the paired
// Rules deny-all block). `labReportsGet` and `labReportsSave` are the only
// readers and writers; both run through the Admin SDK.
//
// Privacy: the report is the student's own working draft. No teacher,
// administrator, or class surface reads it. There is no history
// subcollection; the record holds only the current draft.

export const STUDENT_LAB_REPORTS_COLLECTION = "studentLabReports";
export const STUDENT_LAB_REPORT_ITEMS_SUBCOLLECTION = "reports";

// The single report id in use today ("one active report per student",
// matching the browser tool's one-report model). A future assignment-linked
// report would use a distinct, deterministic id in the same subcollection
// (for example `assignment_{assignmentId}`) with `scope: "assignment"`.
export const ACTIVE_LAB_REPORT_ID = "active";

// Storage envelope version for this record shape.
export const STUDENT_LAB_REPORT_SCHEMA_VERSION = 1;

// Report payload format version: the browser tool's saved report `version`.
export const LAB_REPORT_FORMAT_VERSION = 1;

export type StudentLabReportScope = "personal";

export type StudentLabReportRecord = {
  readonly schemaVersion: number;
  readonly reportId: string;
  readonly scope: StudentLabReportScope;
  // Ownership stamp, frozen at creation. `studentId` always equals the
  // path segment and the caller's uid.
  readonly studentId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly reportFormatVersion: number;
  // The validated report, serialized with a canonical key order. Stored as
  // one string so the nested table survives Firestore (no arrays of
  // arrays), equality is a string comparison, and student text is not
  // fanned out into per-field index entries.
  readonly reportJson: string;
  readonly reportBytes: number;
  // Optimistic-concurrency revision. 1 on creation, +1 per accepted write.
  readonly revision: number;
  // Client idempotency key of the write that produced `revision`.
  readonly lastSaveId: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
};

export type StudentLabReportCreationWrite = {
  readonly schemaVersion: number;
  readonly reportId: string;
  readonly scope: StudentLabReportScope;
  readonly studentId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly reportFormatVersion: number;
  readonly reportJson: string;
  readonly reportBytes: number;
  readonly revision: 1;
  readonly lastSaveId: string;
  readonly createdAt: FieldValue;
  readonly updatedAt: FieldValue;
};

// Update-write shape. Structurally excludes the ownership stamp, scope,
// and `createdAt` so a save can never rewrite who owns the report.
export type StudentLabReportUpdateWrite = {
  readonly reportFormatVersion: number;
  readonly reportJson: string;
  readonly reportBytes: number;
  readonly revision: number;
  readonly lastSaveId: string;
  readonly updatedAt: FieldValue;
};
