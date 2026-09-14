import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  classDocRef,
  isClassColorToken,
  log,
  platformCallable,
  PlatformError,
  requireDistrictContext,
  teacherPreferencesUpdateDocRef,
  type ClassColorToken,
} from "../shared";

// teacherClassColorUpdate
//
// Sprint 30A.1 Class Settings V1. Owns the canonical write path for the
// teacher's own per-class color accent, persisted additively on the
// existing `users/{uid}/preferences/teacher` subdoc (`classColors`)
// alongside the independent `defaultGrade` and `classOrder` preferences.
// Kept as a dedicated callable rather than folded into
// `teacherPreferencesUpdate` for the same reason `teacherClassOrderUpdate`
// is separate: this write requires server-side class-ownership
// validation the narrow grade-enum validator has no reason to carry.
//
// Contract summary:
//   - The caller must be an active teacher (via requireDistrictContext).
//   - `classId` must resolve to a class this teacher owns
//     (`classes/{classId}.teacherId === caller.uid`); an unknown,
//     deleted, or cross-teacher id is rejected with
//     `teacherClassColor.forbidden` rather than silently ignored.
//   - `color` must be one of the closed `ClassColorToken` values, or the
//     literal string `"none"` to clear a previously-saved color. No
//     other string is ever accepted - this is a curated palette, never
//     an arbitrary client-supplied CSS value.
//   - The write is a NON-DESTRUCTIVE MERGE at the map level, but unlike
//     `teacherClassOrderUpdate` it never reads the existing map first:
//     the write always names exactly one class id key inside the nested
//     `classColors` object, and Firestore's documented `{merge: true}`
//     behavior for nested objects adds/overwrites just that one key (or
//     removes it, via a `FieldValue.delete()` sentinel for `color:
//     "none"`) while leaving every other class id's stored color
//     untouched. This also means two concurrent color updates for two
//     different classes can never clobber each other.
//   - This callable never reaches Google Classroom or any other LMS
//     provider. Color is LyfeLabz-side presentation state only.

export type TeacherClassColorUpdateRequest = {
  readonly classId: string;
  readonly color: ClassColorToken | "none";
};

export type TeacherClassColorUpdateResponse = {
  readonly ok: true;
  readonly classId: string;
  readonly color: ClassColorToken | "none";
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

function validateRequest(
  data: unknown,
): { readonly classId: string; readonly color: ClassColorToken | "none" } {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "teacherClassColor.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  const classId = payload.classId;
  if (typeof classId !== "string" || !CLASS_ID_PATTERN.test(classId)) {
    throw new PlatformError(
      "teacherClassColor.invalidClassId",
      "classId must be a URL-safe class id token.",
    );
  }

  const color = payload.color;
  if (color !== "none" && !isClassColorToken(color)) {
    throw new PlatformError(
      "teacherClassColor.invalidColor",
      "color must be one of the curated color tokens, or \"none\" to clear.",
    );
  }

  return { classId, color };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function teacherClassColorUpdateHandler(
  request: CallableRequest<unknown>,
): Promise<TeacherClassColorUpdateResponse> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active teacher.",
    );
  }

  const { classId, color } = validateRequest(request.data);

  // Server-side ownership verification: never trust the client's claim
  // that a class id belongs to it.
  const classSnapshot = await classDocRef(classId).get();
  if (!classSnapshot.exists) {
    throw new PlatformError(
      "teacherClassColor.forbidden",
      "Caller does not own this class.",
    );
  }
  const classRecord = classSnapshot.data();
  if (!classRecord || classRecord.teacherId !== context.uid) {
    throw new PlatformError(
      "teacherClassColor.forbidden",
      "Caller does not own this class.",
    );
  }

  // Exactly one nested key is named in this write. Firestore's `{merge:
  // true}` behavior for nested objects merges at the leaf: a
  // `ClassColorToken` value adds/overwrites just this class id's color;
  // `FieldValue.delete()` removes just this class id's key. Every other
  // class id already present under `classColors` is left untouched -
  // there is no read of the existing map, and therefore no
  // read-modify-write race with a concurrent update for a different
  // class.
  await teacherPreferencesUpdateDocRef(context.uid).set(
    {
      classColors: {
        [classId]: color === "none" ? FieldValue.delete() : color,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  safeLog(() =>
    log.info("teacherClassColor.updated", {
      uid: context.uid,
      classId,
      color,
    }),
  );

  return { ok: true, classId, color };
}

export const teacherClassColorUpdate = platformCallable(
  teacherClassColorUpdateHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __teacherClassColorUpdateHandler = teacherClassColorUpdateHandler;
