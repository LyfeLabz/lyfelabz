import type { Role, UserRecordRead, UserStatus } from "./types";

const STATUS_VALUES: readonly UserStatus[] = [
  "provisioned",
  "pendingVerification",
  "active",
  "suspended",
  "archived",
];

const ROLE_VALUES: readonly Role[] = [
  "teacher",
  "student",
  "platformAdministrator",
];

const isString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Validates a users/{uid} document against the narrow read-shape the
// bootstrap depends on. Returns the validated record on success or null
// on shape violation. Callers translate null into
// { kind: "error", reason: "recordShapeInvalid" }.
export function validateUserRecord(raw: unknown): UserRecordRead | null {
  if (!isRecord(raw)) return null;

  const status = raw.status;
  if (typeof status !== "string") return null;
  if (!STATUS_VALUES.includes(status as UserStatus)) return null;

  const record: {
    -readonly [K in keyof UserRecordRead]: UserRecordRead[K];
  } = { status: status as UserStatus };

  if (raw.role !== undefined) {
    if (typeof raw.role !== "string") return null;
    if (!ROLE_VALUES.includes(raw.role as Role)) return null;
    record.role = raw.role as Role;
  }

  if (raw.schoolId !== undefined) {
    if (!isString(raw.schoolId)) return null;
    record.schoolId = raw.schoolId;
  }

  if (raw.displayName !== undefined) {
    if (!isString(raw.displayName)) return null;
    record.displayName = raw.displayName;
  }

  if (raw.email !== undefined) {
    if (typeof raw.email !== "string") return null;
    if (raw.email.length > 0) record.email = raw.email;
  }

  // Activation-required fields must be present when status is active or
  // pendingVerification. Absence is a shape violation.
  if (status === "active" || status === "pendingVerification") {
    if (!record.role || !record.schoolId || !record.displayName) return null;
  }

  return record;
}
