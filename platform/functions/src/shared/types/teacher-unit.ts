import type { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  TEACHER_DEFAULT_GRADE_VALUES,
  isTeacherDefaultGrade,
  type TeacherDefaultGrade,
} from "./teacher-preferences";

// U1A - Teacher Unit data and security foundation.
//
// A TeacherUnit is a teacher-defined instructional unit: one teacher's own
// named grouping for one grade, stored at `teacherUnits/{unitId}`. It is
// NOT the client `CurriculumUnit` type (app/src/curriculum/
// curriculumManifest.ts), which describes one curriculum lesson card. The
// two types share nothing and must not be merged.
//
// Server-owned: every write goes through the `teacherUnits*` callables
// (Admin SDK). The owning active teacher may read their own records
// directly (see the paired `teacherUnits/{unitId}` Rules block); every
// direct client write is denied. See docs/platform/TEACHER_UNITS.md.
//
// U1A scope: create, list, get, rename, edit description, archive, restore.
// Resource membership (`resourceIds`) and ordering (`sortOrder`) are stored
// with fixed initial values and are not mutable by any U1A operation; they
// belong to U1B.

export const TEACHER_UNITS_COLLECTION = "teacherUnits";

// Supported grades. The same closed "6" | "7" | "8" set `classesActivate`
// and the teacher default-grade preference accept, reused rather than
// redefined. A Grade 8 unit is valid even though the curriculum carries no
// Grade 8 resources today; which resources a unit may hold is a U1B
// placement question, not a grade-validity question.
export type TeacherUnitGrade = TeacherDefaultGrade;
export const TEACHER_UNIT_GRADES: readonly TeacherUnitGrade[] = TEACHER_DEFAULT_GRADE_VALUES;
export const isTeacherUnitGrade = isTeacherDefaultGrade;

export type TeacherUnitStatus = "active" | "archived";
export const TEACHER_UNIT_STATUSES: readonly TeacherUnitStatus[] = Object.freeze([
  "active",
  "archived",
]);

// Field limits, enforced on every write path. Lengths are counted in
// Unicode code points after trimming.
export const TEACHER_UNIT_TITLE_MAX_LENGTH = 120;
export const TEACHER_UNIT_DESCRIPTION_MAX_LENGTH = 1000;

// Revision contract: a new unit starts at revision 1. Every ACCEPTED
// state-changing mutation (rename, description edit, archive, restore)
// increments it by exactly 1 in the same transaction that changes the
// record. A request whose result already holds (same title, same
// description, archive of an archived unit, restore of an active unit)
// writes nothing and leaves the revision unchanged.
export const TEACHER_UNIT_INITIAL_REVISION = 1;

// U1A ordering placeholder. Every unit is created with `sortOrder: 0`; no
// U1A operation changes it. Readers order units by (sortOrder asc,
// createdAt asc, unitId asc), so with the placeholder the effective order
// is creation order. U1B defines the real ordering operation.
export const TEACHER_UNIT_DEFAULT_SORT_ORDER = 0;

export type TeacherUnitRecord = {
  // Ownership and identity. Stamped at creation from the caller's verified
  // canonical identity and never written again.
  readonly teacherId: string;
  readonly schoolId: string;
  readonly grade: TeacherUnitGrade;
  readonly title: string;
  readonly description: string;
  readonly status: TeacherUnitStatus;
  // Null while active; the archive transition's server time while archived.
  readonly archivedAt: Timestamp | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  // U1B. Always [] in U1A.
  readonly resourceIds: readonly string[];
  // U1B. Always TEACHER_UNIT_DEFAULT_SORT_ORDER in U1A.
  readonly sortOrder: number;
  readonly revision: number;
};

export type TeacherUnitCreationWrite = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly grade: TeacherUnitGrade;
  readonly title: string;
  readonly description: string;
  readonly status: "active";
  readonly archivedAt: null;
  readonly createdAt: FieldValue;
  readonly updatedAt: FieldValue;
  readonly resourceIds: readonly string[];
  readonly sortOrder: number;
  readonly revision: number;
};

// Narrow update shape: identity fields (`teacherId`, `schoolId`, `grade`,
// `createdAt`), `resourceIds`, and `sortOrder` are deliberately absent, so
// no U1A update can name them.
export type TeacherUnitUpdateWrite = {
  readonly title?: string;
  readonly description?: string;
  readonly status?: TeacherUnitStatus;
  readonly archivedAt?: FieldValue | null;
  readonly updatedAt: FieldValue;
  readonly revision: number;
};

// ---------- Create retry receipts ----------
//
// `teacherUnitsCreate` requires a client `idempotencyKey` so a retry after
// a lost response cannot create a second unit. One receipt per accepted
// create is stored at `teacherUnitCreateReceipts/{receiptId}`, where
// `receiptId` is the SHA-256 hex of (teacherId, schoolId, idempotencyKey):
// the key is scoped to the authoritative teacher AND school, and two
// requests with the same scope map to the same document, so the receipt's
// `Transaction.create()` admits exactly one unit per key. The receipt, the
// unit, and the audit event commit atomically. Server-only: Rules deny every
// client read and write.
//
// Retention: one receipt per created unit (bounded by the unit count; no
// receipt is written for a refused or replayed request). Each receipt
// carries `expiresAt` (`createdAt` + TEACHER_UNIT_CREATE_RECEIPT_RETENTION_MS)
// so a Firestore TTL policy can delete it without a data migration. No TTL
// policy is configured in U1A (that is an index-surface change requiring
// separate authorization); until one is, receipts persist. A receipt is
// honored for as long as it exists; after deletion the same key creates a
// new unit. See docs/platform/TEACHER_UNITS.md.

export const TEACHER_UNIT_CREATE_RECEIPTS_COLLECTION = "teacherUnitCreateReceipts";

export const TEACHER_UNIT_CREATE_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type TeacherUnitCreateReceiptRecord = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly unitId: string;
  // SHA-256 hex of the normalized request (grade, title, description).
  readonly requestHash: string;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
};

export type TeacherUnitCreateReceiptWrite = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly unitId: string;
  readonly requestHash: string;
  readonly createdAt: FieldValue;
  readonly expiresAt: Timestamp;
};
