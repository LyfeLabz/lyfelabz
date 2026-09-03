import type { Timestamp } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  platformCallable,
  studentAccommodationDocRef,
  type ReadingAccessibilityConfig,
} from "../shared";
import {
  assertActiveTeacherInDistrict,
  assertTeacherAuthorizedForStudent,
} from "./authorize-teacher-for-student";

// accommodationsGet - F5.2 Implementation Specification §4 Op A.
//
// Server-mediated teacher read of a student's current
// `studentAccommodations/{studentId}` configuration. No direct client
// Firestore access exists for this record family (§11); this callable is
// the sole read path. Read-only: no writes, no audit event, no history
// returned in V1 (§4 Op A).
//
// Dark per F5.2 §10.2: no teacher UI exposes this callable in Slice 1.

export type AccommodationsGetRequest = {
  readonly studentId: string;
  readonly classId: string;
};

// `{ configRevision: 0 }` when no record exists for the student -
// indistinguishable in tone from an `inactive` record per F5.2 §10.3, and
// never distinguishable from an authorization refusal (both are opaque to
// the caller; only an AUTHORIZED caller ever reaches this branch at all).
export type AccommodationsGetResponse =
  | { readonly configRevision: 0 }
  | {
      readonly configRevision: number;
      readonly readingAccessibility: ReadingAccessibilityConfig;
      readonly updatedBy: string;
      readonly updatedAt: Timestamp;
    };

const STUDENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/;
const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const ALLOWED_REQUEST_KEYS: readonly string[] = ["studentId", "classId"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRequest(data: unknown): AccommodationsGetRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "accommodations.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  const extraKeys = Object.keys(payload).filter(
    (key) => !ALLOWED_REQUEST_KEYS.includes(key),
  );
  if (extraKeys.length > 0) {
    throw new PlatformError(
      "accommodations.forbiddenField",
      `Unsupported request field(s): ${extraKeys.join(", ")}.`,
    );
  }

  if (!isNonEmptyString(payload.studentId)) {
    throw new PlatformError(
      "accommodations.invalidStudentId",
      "studentId must be a non-empty string.",
    );
  }
  const studentId = payload.studentId.trim();
  if (!STUDENT_ID_PATTERN.test(studentId)) {
    throw new PlatformError(
      "accommodations.invalidStudentId",
      "studentId must be a URL-safe token.",
    );
  }

  if (!isNonEmptyString(payload.classId)) {
    throw new PlatformError(
      "accommodations.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
  const classId = payload.classId.trim();
  if (!CLASS_ID_PATTERN.test(classId)) {
    throw new PlatformError(
      "accommodations.invalidClassId",
      "classId must be a URL-safe token.",
    );
  }

  return { studentId, classId };
}

async function accommodationsGetHandler(
  request: CallableRequest<unknown>,
): Promise<AccommodationsGetResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  await assertTeacherAuthorizedForStudent(actor, input.classId, input.studentId);

  const snapshot = await studentAccommodationDocRef(input.studentId).get();
  if (!snapshot.exists) {
    return { configRevision: 0 };
  }
  const record = snapshot.data();
  if (!record) {
    return { configRevision: 0 };
  }

  return {
    configRevision: record.configRevision,
    readingAccessibility: record.readingAccessibility,
    updatedBy: record.updatedBy,
    updatedAt: record.updatedAt,
  };
}

export const accommodationsGet = platformCallable(accommodationsGetHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __accommodationsGetHandler = accommodationsGetHandler;
