import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  READING_LEVELS,
  log,
  platformCallable,
  runFirestoreTransaction,
  studentAccommodationCreationDocRef,
  studentAccommodationDocRef,
  studentAccommodationHistoryDocRef,
  studentAccommodationUpdateDocRef,
  writeAuditEvent,
  type ReadingAccessibilityConfig,
  type ReadingLevel,
} from "../shared";
import {
  assertActiveTeacherInDistrict,
  assertTeacherAuthorizedForStudent,
} from "./authorize-teacher-for-student";

// accommodationsSet - F5.2 Implementation Specification §4 Op B, §4.2
// (compare-and-set), §3.1/§3.7 (history + audit).
//
// Server-mediated teacher activate/update/deactivate of a student's
// `readingAccessibility` configuration. Single Firestore transaction:
// re-verify the §4 authorization invariant -> compare-and-set against
// `expectedRevision` -> parent record write -> atomic append-only history
// entry. Audit is enqueued after a successful transaction that actually
// wrote (§3.7, §4.2 item 9 / C6: an equal-value write emits NO audit and
// performs NO Firestore mutation).
//
// Dark per F5.2 §10.2: no teacher UI exposes this callable in Slice 1. The
// callable itself is fully functional so later slices can wire an
// activation surface behind the §10.2 enable gate without a second
// backend change.

export type AccommodationsSetRequest = {
  readonly studentId: string;
  readonly classId: string;
  // 0 for first activation; otherwise the `configRevision` the caller last
  // observed (from `accommodationsGet` or a prior `accommodationsSet`
  // response), supplied verbatim as the CAS token (§4.2 item 1).
  readonly expectedRevision: number;
  readonly newValue: ReadingAccessibilityConfig;
  readonly idempotencyKey?: string;
};

export type AccommodationsSetResponse = {
  readonly studentId: string;
  readonly configRevision: number;
  readonly readingAccessibility: ReadingAccessibilityConfig;
  readonly updatedBy: string;
  // True when this call performed NO Firestore mutation: either the
  // requested configuration already equal-value-matched the current one
  // (C6 true no-op), or the request was an idempotent replay of an
  // already-landed write (§4.2 item 8).
  readonly noop: boolean;
};

const STUDENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/;
const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// Closed request-shape allowlist per F5.2 §4.3's forbidden-request-keys
// principle applied to Op B: only these five fields are ever accepted.
// Every server-owned or student-facing-only field named in F5.2 -
// `variantKey`, `presentationRevisionId`, `deliveryOutcome`,
// attribution/timestamp fields, an arbitrary `configRevision` outside the
// `expectedRevision` CAS input, a history revision id, plan/diagnosis
// text - is rejected by this closed list without needing its own check.
const ALLOWED_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "classId",
  "expectedRevision",
  "newValue",
  "idempotencyKey",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateReadingAccessibility(value: unknown): ReadingAccessibilityConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PlatformError(
      "accommodations.invalidNewValue",
      "newValue must be a structured object.",
    );
  }
  const payload = value as Record<string, unknown>;

  if (payload.status !== "active" && payload.status !== "inactive") {
    throw new PlatformError(
      "accommodations.invalidStatus",
      'newValue.status must be "active" or "inactive".',
    );
  }

  if (payload.status === "inactive") {
    const extraKeys = Object.keys(payload).filter((key) => key !== "status");
    if (extraKeys.length > 0) {
      throw new PlatformError(
        "accommodations.forbiddenField",
        `An inactive configuration accepts only "status" (received: ${extraKeys.join(", ")}).`,
      );
    }
    return { status: "inactive" };
  }

  const extraKeys = Object.keys(payload).filter(
    (key) => key !== "status" && key !== "level",
  );
  if (extraKeys.length > 0) {
    throw new PlatformError(
      "accommodations.forbiddenField",
      `An active configuration accepts only "status" and "level" (received: ${extraKeys.join(", ")}).`,
    );
  }
  if (payload.level === undefined) {
    throw new PlatformError(
      "accommodations.missingLevel",
      "newValue.level is required when status is \"active\".",
    );
  }
  if (
    typeof payload.level !== "string" ||
    !(READING_LEVELS as readonly string[]).includes(payload.level)
  ) {
    throw new PlatformError(
      "accommodations.unsupportedLevel",
      `newValue.level must be one of: ${READING_LEVELS.join(", ")}.`,
    );
  }

  return { status: "active", level: payload.level as ReadingLevel };
}

function validateRequest(data: unknown): AccommodationsSetRequest {
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

  if (
    typeof payload.expectedRevision !== "number" ||
    !Number.isInteger(payload.expectedRevision) ||
    payload.expectedRevision < 0
  ) {
    throw new PlatformError(
      "accommodations.invalidExpectedRevision",
      "expectedRevision must be a non-negative integer.",
    );
  }

  const newValue = validateReadingAccessibility(payload.newValue);

  let idempotencyKey: string | undefined;
  if (payload.idempotencyKey !== undefined) {
    if (!isNonEmptyString(payload.idempotencyKey)) {
      throw new PlatformError(
        "accommodations.invalidIdempotencyKey",
        "idempotencyKey, when supplied, must be a non-empty string.",
      );
    }
    idempotencyKey = payload.idempotencyKey.trim();
  }

  return {
    studentId,
    classId,
    expectedRevision: payload.expectedRevision,
    newValue,
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  };
}

function readingAccessibilityEquals(
  a: ReadingAccessibilityConfig,
  b: ReadingAccessibilityConfig,
): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "active" && b.status === "active") {
    return a.level === b.level;
  }
  return true;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

type TransactionOutcome =
  | {
      readonly wrote: true;
      readonly configRevision: number;
      readonly readingAccessibility: ReadingAccessibilityConfig;
      readonly updatedBy: string;
      readonly previousConfigRevision: number;
      readonly previousReadingAccessibility: ReadingAccessibilityConfig | null;
    }
  | {
      readonly wrote: false;
      readonly configRevision: number;
      readonly readingAccessibility: ReadingAccessibilityConfig;
      readonly updatedBy: string;
    };

async function accommodationsSetHandler(
  request: CallableRequest<unknown>,
): Promise<AccommodationsSetResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  // Cheap early refusal before opening a transaction. Re-verified inside
  // the transaction below (see authorize-teacher-for-student.ts).
  await assertTeacherAuthorizedForStudent(actor, input.classId, input.studentId);

  const outcome = await runFirestoreTransaction<TransactionOutcome>(async (tx) => {
    await assertTeacherAuthorizedForStudent(
      actor,
      input.classId,
      input.studentId,
      tx,
    );

    const recordRef = studentAccommodationDocRef(input.studentId);
    const snapshot = await tx.get(recordRef);
    const current = snapshot.exists ? snapshot.data() : undefined;
    const currentRevision = current?.configRevision ?? 0;

    if (input.expectedRevision !== currentRevision) {
      // §4.2 item 8 idempotency: a retry carrying the idempotencyKey of an
      // already-landed write is not a stale write - it is the SAME write
      // observed twice. Recognized only when the current revision is
      // EXACTLY one past the caller's expectedRevision and that revision's
      // history entry carries a matching idempotencyKey.
      if (
        input.idempotencyKey !== undefined &&
        current &&
        currentRevision === input.expectedRevision + 1
      ) {
        const historyRef = studentAccommodationHistoryDocRef(
          input.studentId,
          currentRevision,
        );
        const historySnapshot = await tx.get(historyRef);
        const historyRecord = historySnapshot.exists
          ? historySnapshot.data()
          : undefined;
        if (historyRecord?.idempotencyKey === input.idempotencyKey) {
          return {
            wrote: false,
            configRevision: current.configRevision,
            readingAccessibility: current.readingAccessibility,
            updatedBy: current.updatedBy,
          };
        }
      }

      throw new PlatformError(
        "accommodations.writeConflict",
        "expectedRevision does not match the current configuration revision.",
        undefined,
        current
          ? {
              configRevision: current.configRevision,
              readingAccessibility: current.readingAccessibility,
              updatedBy: current.updatedBy,
            }
          : { configRevision: 0 },
      );
    }

    // C6 true no-op: the requested configuration already equal-value
    // matches the current one. No revision increment, no history entry,
    // no audit event, no Firestore mutation of any kind (§3.7, §4.2 item
    // 9). Only applies when a current record exists - the FIRST write from
    // revision 0 is always an accepted state-changing write per §3.1, even
    // when it requests "inactive" (there is no "current" value to compare
    // against; absence and an explicit inactive record are behaviorally
    // equivalent but not the same stored state).
    if (current && readingAccessibilityEquals(current.readingAccessibility, input.newValue)) {
      return {
        wrote: false,
        configRevision: current.configRevision,
        readingAccessibility: current.readingAccessibility,
        updatedBy: current.updatedBy,
      };
    }

    const nextRevision = currentRevision + 1;
    const now = FieldValue.serverTimestamp();

    if (!current) {
      tx.create(studentAccommodationCreationDocRef(input.studentId), {
        studentId: input.studentId,
        schoolId: actor.schoolId,
        readingAccessibility: input.newValue,
        configRevision: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
      });
    } else {
      tx.update(studentAccommodationUpdateDocRef(input.studentId), {
        readingAccessibility: input.newValue,
        configRevision: nextRevision,
        updatedAt: now,
        updatedBy: actor.uid,
      });
    }

    tx.create(studentAccommodationHistoryDocRef(input.studentId, nextRevision), {
      revision: nextRevision,
      readingAccessibility: input.newValue,
      setBy: actor.uid,
      setAt: now,
      classId: input.classId,
      ...(input.idempotencyKey !== undefined
        ? { idempotencyKey: input.idempotencyKey }
        : {}),
    });

    return {
      wrote: true,
      configRevision: nextRevision,
      readingAccessibility: input.newValue,
      updatedBy: actor.uid,
      previousConfigRevision: currentRevision,
      previousReadingAccessibility: current?.readingAccessibility ?? null,
    };
  });

  if (outcome.wrote) {
    await writeAuditEvent({
      actorUserId: actor.uid,
      actorRole: "teacher",
      action: "accommodations.configurationChanged",
      targetType: "studentAccommodation",
      targetId: input.studentId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
      payload: {
        classId: input.classId,
        previousConfigRevision: outcome.previousConfigRevision,
        configRevision: outcome.configRevision,
        previousReadingAccessibility: outcome.previousReadingAccessibility,
        readingAccessibility: outcome.readingAccessibility,
      },
    });

    safeLog(() =>
      log.info("accommodations.configurationChanged", {
        actorUserId: actor.uid,
        studentId: input.studentId,
        classId: input.classId,
        configRevision: outcome.configRevision,
      }),
    );
  } else {
    safeLog(() =>
      log.info("accommodations.setNoop", {
        actorUserId: actor.uid,
        studentId: input.studentId,
        classId: input.classId,
        configRevision: outcome.configRevision,
      }),
    );
  }

  return {
    studentId: input.studentId,
    configRevision: outcome.configRevision,
    readingAccessibility: outcome.readingAccessibility,
    updatedBy: outcome.updatedBy,
    noop: !outcome.wrote,
  };
}

export const accommodationsSet = platformCallable(accommodationsSetHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __accommodationsSetHandler = accommodationsSetHandler;
