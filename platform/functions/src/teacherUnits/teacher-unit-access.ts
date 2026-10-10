import type { Transaction } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  TEACHER_UNIT_DESCRIPTION_MAX_LENGTH,
  TEACHER_UNIT_GRADES,
  TEACHER_UNIT_TITLE_MAX_LENGTH,
  isTeacherUnitGrade,
  requireDistrictContext,
  runFirestoreTransaction,
  schoolDocRef,
  teacherUnitDocRef,
  userRecordDocRef,
  type TeacherUnitGrade,
  type TeacherUnitRecord,
  type TeacherUnitStatus,
} from "../shared";

// U1A - shared authorization, validation, and projection for the
// `teacherUnits*` callables. See docs/platform/TEACHER_UNITS.md.

export type TeacherUnitActor = {
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
};

// Authenticated, active, canonical teacher. `requireDistrictContext` reads
// `users/{uid}` (status must be `active`, the record wins over claims),
// resolves the school's district, and cross-checks the signed claims. The
// uid and schoolId come only from that verified context, never from the
// request payload.
export async function assertActiveTeacher(
  request: CallableRequest<unknown>,
): Promise<TeacherUnitActor> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError("role-forbidden", "Caller must be an active teacher.");
  }
  return { uid: context.uid, schoolId: context.schoolId, districtId: context.districtId };
}

// In-transaction re-verification of the caller's canonical authorization.
//
// `assertActiveTeacher` runs before any transaction, so its reads can be
// stale by the time unit data is read or written. Every callable therefore
// repeats the canonical checks INSIDE the transaction that reads or writes
// unit data, against the same snapshot:
//   - `users/{uid}`: exists, `status == "active"`, `role == "teacher"`, and
//     `schoolId` is still the school the request was authorized for;
//   - `schools/{schoolId}`: exists and its `districtId` is non-empty and
//     equal to the district verified against the caller's signed claim.
// The refusal codes are the ones `requireDistrictContext` uses for the same
// conditions. Both documents join the transaction's read set, so a
// concurrent change to either retries the transaction, and the retry
// observes the change. The returned actor (from these reads) is the one
// used for ownership checks, writes, and audit attribution.
//
// Consistency boundary: authorization and returned data come from one
// snapshot. A change committed BEFORE that snapshot is always honored. A
// change committed AFTER the transaction completes cannot recall data
// already returned.
export async function reassertTeacherContextInTransaction(
  tx: Transaction,
  actor: TeacherUnitActor,
): Promise<TeacherUnitActor> {
  const userSnapshot = await tx.get(userRecordDocRef(actor.uid));
  const schoolSnapshot = await tx.get(schoolDocRef(actor.schoolId));
  const user = userSnapshot.exists ? userSnapshot.data() : undefined;
  if (!user || user.status !== "active") {
    throw new PlatformError(
      "account-inactive",
      "The authenticated caller is not in the active status required for this operation.",
    );
  }
  if (user.role !== "teacher") {
    throw new PlatformError("role-forbidden", "Caller must be an active teacher.");
  }
  if (user.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "claim-state-mismatch",
      "The caller's school changed during the request.",
    );
  }
  const school = schoolSnapshot.exists ? schoolSnapshot.data() : undefined;
  if (!school) {
    throw new PlatformError(
      "school-district-mismatch",
      "The caller's active school could not be resolved.",
    );
  }
  const districtId: unknown = school.districtId;
  if (typeof districtId !== "string" || districtId.trim().length === 0) {
    throw new PlatformError(
      "district-unassigned",
      "The caller's active school is not assigned to a district.",
    );
  }
  if (districtId !== actor.districtId) {
    throw new PlatformError(
      "district-mismatch",
      "The caller's school district changed during the request.",
    );
  }
  return { uid: actor.uid, schoolId: actor.schoolId, districtId };
}

// Ownership: the record's `teacherId` must be the caller and its `schoolId`
// the caller's canonical school. A missing record, another teacher's
// record, and a record from another school all produce the SAME refusal,
// so a caller can never learn whether someone else's unit exists.
export function assertOwnedUnit(
  record: TeacherUnitRecord | undefined,
  actor: TeacherUnitActor,
): asserts record is TeacherUnitRecord {
  if (!record || record.teacherId !== actor.uid || record.schoolId !== actor.schoolId) {
    throw new PlatformError("teacherUnits.notFound", "Unit was not found.");
  }
}

// Authorized consistent read of one owned unit: the canonical
// authorization and the unit are read in one transaction snapshot. Used by
// `teacherUnitsGet` and for every post-commit response read, so no response
// carries unit data under authorization that was revoked before the read.
// Read-only: the transaction writes nothing.
export async function readOwnedTeacherUnit(
  actor: TeacherUnitActor,
  unitId: string,
): Promise<TeacherUnitView> {
  return runFirestoreTransaction(async (tx) => {
    const verified = await reassertTeacherContextInTransaction(tx, actor);
    const snapshot = await tx.get(teacherUnitDocRef(unitId));
    const record = snapshot.exists ? snapshot.data() : undefined;
    assertOwnedUnit(record, verified);
    return toTeacherUnitView(unitId, record);
  });
}

// ---------- Request validation ----------

export function requestObject(data: unknown): Record<string, unknown> {
  if (data === null || data === undefined) return {};
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "teacherUnits.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  return data as Record<string, unknown>;
}

// Closed request-shape allowlist. Every server-owned field (`teacherId`,
// `schoolId`, `status`, `revision`, `resourceIds`, `sortOrder`,
// `archivedAt`, `createdAt`, `updatedAt`) and every unknown field is
// rejected before any read or write.
export function assertOnlyAllowedKeys(
  payload: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const extra = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new PlatformError(
      "teacherUnits.invalidRequest",
      `Unsupported request field(s): ${extra.join(", ")}.`,
    );
  }
}

// Firestore auto-ids: 20 characters from [A-Za-z0-9]. Units are only ever
// created with a server-generated id, so any other shape cannot name one.
const UNIT_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

export function readUnitId(payload: Record<string, unknown>): string {
  const unitId = payload.unitId;
  if (typeof unitId !== "string" || !UNIT_ID_PATTERN.test(unitId)) {
    throw new PlatformError("teacherUnits.invalidUnitId", "unitId is not a valid unit identifier.");
  }
  return unitId;
}

// Create retry key. Same token grammar as `labReportsSave.saveId` and the
// RA-3A `operationId` (a UUID fits). Required on every create.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function readIdempotencyKey(payload: Record<string, unknown>): string {
  const key = payload.idempotencyKey;
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new PlatformError(
      "teacherUnits.invalidIdempotencyKey",
      "idempotencyKey must be a URL-safe token of 8 to 64 characters.",
    );
  }
  return key;
}

export function readExpectedRevision(payload: Record<string, unknown>): number {
  const value = payload.expectedRevision;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new PlatformError(
      "teacherUnits.invalidExpectedRevision",
      "expectedRevision must be a positive integer.",
    );
  }
  return value;
}

export function readGrade(value: unknown): TeacherUnitGrade {
  if (!isTeacherUnitGrade(value)) {
    throw new PlatformError(
      "teacherUnits.invalidGrade",
      `grade must be one of: ${TEACHER_UNIT_GRADES.join(", ")}.`,
    );
  }
  return value;
}

// C0 controls and DEL. Titles admit none; descriptions admit line breaks
// and tabs only.
// eslint-disable-next-line no-control-regex
const TITLE_FORBIDDEN = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const DESCRIPTION_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function codePointLength(value: string): number {
  return [...value].length;
}

export function readTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new PlatformError("teacherUnits.invalidTitle", "title must be a string.");
  }
  const title = value.trim();
  if (title.length === 0) {
    throw new PlatformError("teacherUnits.invalidTitle", "title must not be empty.");
  }
  if (codePointLength(title) > TEACHER_UNIT_TITLE_MAX_LENGTH) {
    throw new PlatformError(
      "teacherUnits.invalidTitle",
      `title must be at most ${String(TEACHER_UNIT_TITLE_MAX_LENGTH)} characters.`,
    );
  }
  if (TITLE_FORBIDDEN.test(title)) {
    throw new PlatformError("teacherUnits.invalidTitle", "title must not contain control characters.");
  }
  return title;
}

// An empty description is valid (the field is optional on create and can
// be cleared).
export function readDescription(value: unknown): string {
  if (typeof value !== "string") {
    throw new PlatformError("teacherUnits.invalidDescription", "description must be a string.");
  }
  const description = value.trim();
  if (codePointLength(description) > TEACHER_UNIT_DESCRIPTION_MAX_LENGTH) {
    throw new PlatformError(
      "teacherUnits.invalidDescription",
      `description must be at most ${String(TEACHER_UNIT_DESCRIPTION_MAX_LENGTH)} characters.`,
    );
  }
  if (DESCRIPTION_FORBIDDEN.test(description)) {
    throw new PlatformError(
      "teacherUnits.invalidDescription",
      "description must not contain control characters other than line breaks and tabs.",
    );
  }
  return description;
}

// ---------- Response projection ----------

// What callables return for one unit. Ownership fields are omitted (they
// are always the caller's own); timestamps are epoch milliseconds.
export type TeacherUnitView = {
  readonly unitId: string;
  readonly grade: TeacherUnitGrade;
  readonly title: string;
  readonly description: string;
  readonly status: TeacherUnitStatus;
  readonly archivedAtMillis: number | null;
  readonly createdAtMillis: number | null;
  readonly updatedAtMillis: number | null;
  readonly resourceIds: readonly string[];
  readonly sortOrder: number;
  readonly revision: number;
};

function timestampMillis(value: unknown): number | null {
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

export function toTeacherUnitView(unitId: string, record: TeacherUnitRecord): TeacherUnitView {
  return {
    unitId,
    grade: record.grade,
    title: record.title,
    description: record.description,
    status: record.status,
    archivedAtMillis: timestampMillis(record.archivedAt),
    createdAtMillis: timestampMillis(record.createdAt),
    updatedAtMillis: timestampMillis(record.updatedAt),
    resourceIds: [...record.resourceIds],
    sortOrder: record.sortOrder,
    revision: record.revision,
  };
}

// Canonical reader order: sortOrder, then creation time, then id.
export function compareTeacherUnitViews(a: TeacherUnitView, b: TeacherUnitView): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const ac = a.createdAtMillis ?? 0;
  const bc = b.createdAtMillis ?? 0;
  if (ac !== bc) return ac - bc;
  return a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0;
}

export function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}
