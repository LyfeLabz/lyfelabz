import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  isTeacherDefaultGrade,
  log,
  platformCallable,
  PlatformError,
  requireDistrictContext,
  teacherPreferencesUpdateDocRef,
  type TeacherDefaultGrade,
  type TeacherPreferencesClearWrite,
  type TeacherPreferencesSetWrite,
} from "../shared";

// Sprint 24B Phase 2B.2 - Teacher Preferences Update callable.
//
// Owns the canonical write path for `users/{uid}/preferences/teacher`
// per docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md §9.
//
// Contract summary:
//   - The caller must be an active teacher (via requireDistrictContext).
//   - `defaultGrade` is either "6", "7", "8", `null` (clear), or absent
//     (no-op). Any other value is rejected with
//     `teacherPreferences.invalidDefaultGrade`.
//   - When a concrete grade is supplied, the callable sets `defaultGrade`
//     and stamps `updatedAt` with a server timestamp.
//   - When `null` is supplied, the callable removes `defaultGrade` using
//     `FieldValue.delete()` (no null value is ever persisted) and stamps
//     `updatedAt`.
//   - When `defaultGrade` is absent from the request, the callable stamps
//     only `updatedAt`. Repeated identical requests remain safe.
//   - The callable only writes to the caller's own preference document.
//     Cross-user writes are impossible by construction (uid comes from the
//     verified auth context).
//   - No provider metadata is accepted and no arbitrary preference keys
//     are accepted. The type system, the validator, and the narrow write
//     shape all enforce this together.

export type TeacherPreferencesUpdateRequest = {
  readonly defaultGrade?: TeacherDefaultGrade | null;
};

export type TeacherPreferencesUpdateResponse = {
  readonly ok: true;
  readonly defaultGrade: TeacherDefaultGrade | null;
};

type ValidatedRequest =
  | { readonly kind: "set"; readonly defaultGrade: TeacherDefaultGrade }
  | { readonly kind: "clear" };

function validateRequest(data: unknown): ValidatedRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "teacherPreferences.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  const raw = payload.defaultGrade;
  if (raw === null) {
    return { kind: "clear" };
  }
  if (isTeacherDefaultGrade(raw)) {
    return { kind: "set", defaultGrade: raw };
  }
  throw new PlatformError(
    "teacherPreferences.invalidDefaultGrade",
    "defaultGrade must be one of 6, 7, 8, or null.",
  );
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function teacherPreferencesUpdateHandler(
  request: CallableRequest<unknown>,
): Promise<TeacherPreferencesUpdateResponse> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active teacher.",
    );
  }

  const parsed = validateRequest(request.data);
  const ref = teacherPreferencesUpdateDocRef(context.uid);

  if (parsed.kind === "set") {
    const payload: TeacherPreferencesSetWrite = {
      defaultGrade: parsed.defaultGrade,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(payload, { merge: true });
    safeLog(() =>
      log.info("teacherPreferences.updated", {
        uid: context.uid,
        defaultGrade: parsed.defaultGrade,
      }),
    );
    return { ok: true, defaultGrade: parsed.defaultGrade };
  }

  const clearPayload: TeacherPreferencesClearWrite = {
    defaultGrade: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(clearPayload, { merge: true });
  safeLog(() =>
    log.info("teacherPreferences.cleared", { uid: context.uid }),
  );
  return { ok: true, defaultGrade: null };
}

export const teacherPreferencesUpdate = platformCallable(
  teacherPreferencesUpdateHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __teacherPreferencesUpdateHandler =
  teacherPreferencesUpdateHandler;
