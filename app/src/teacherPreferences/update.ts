import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type {
  TeacherDefaultGrade,
  UpdateTeacherDefaultGrade,
} from "./types";

// Sprint 24B Phase 2B.2 - Client wrapper for the certified
// `teacherPreferencesUpdate` callable. Lives outside `src/shell/**` so
// the shell "no firebase imports" invariant is preserved.
//
// The wrapper is intentionally thin: it passes `defaultGrade` through
// (with `null` meaning "clear the preference") and rethrows the
// callable's error unchanged so callers may distinguish failure modes.

type Request = { readonly defaultGrade: TeacherDefaultGrade | null };
type Response = { readonly ok?: unknown; readonly defaultGrade?: unknown };

export function createFirebaseUpdateTeacherDefaultGrade(
  functions: Functions,
): UpdateTeacherDefaultGrade {
  const callable = httpsCallable<Request, Response>(
    functions,
    "teacherPreferencesUpdate",
  );
  return async (next) => {
    await callable({ defaultGrade: next });
  };
}
