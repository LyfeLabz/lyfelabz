import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";
import type { TeacherDefaultGrade } from "../teacherPreferences/types";

// Sprint 24B Phase 2B.4: client wrapper for the certified
// `classesActivate` callable. This module lives outside `src/shell/**`
// so the shell "no firebase imports" invariant is preserved. See
// platform/functions/src/classes/classes-activate.ts for the canonical
// server contract: narrow `{classId, grade, block}` request; atomic
// `needsSetup -> active` transition writing `{status, grade, block,
// joinCode}` in a single transaction; join code allocated only inside
// activation (Spec §5 Option B); idempotent on already-active records.
//
// The wrapper is intentionally thin. It preserves the server error
// shape so callers may map platform error codes to teacher-facing UX
// copy (see classes.ts describeActivationError).

export type ActivateClassInput = {
  readonly classId: string;
  readonly grade: TeacherDefaultGrade;
  readonly block: "A" | "B" | "C" | "D" | "E" | "F" | "G";
};

// Sprint 24B Phase 2B.7 joinCode invariant. `joinCode` is a non-empty
// string for manual classes and `null` for LMS-sourced classes. The
// caller decides whether to render the student join-code affordance
// after activation by narrowing on this field.
export type ActivateClassResult = {
  readonly classId: string;
  readonly status: "active";
  readonly joinCode: string | null;
  readonly alreadyActive: boolean;
};

export type ActivateClass = (
  input: ActivateClassInput,
) => Promise<ActivateClassResult>;

type ClassesActivateResponse = {
  readonly classId?: unknown;
  readonly status?: unknown;
  readonly joinCode?: unknown;
  readonly alreadyActive?: unknown;
};

export function createFirebaseActivateClass(
  functions: Functions,
): ActivateClass {
  const callable = httpsCallable<
    { classId: string; grade: string; block: string },
    ClassesActivateResponse
  >(functions, "classesActivate");
  return async (input) => {
    const { data } = await callable({
      classId: input.classId,
      grade: input.grade,
      block: input.block,
    });
    const returnedId =
      typeof data?.classId === "string" && data.classId.length > 0
        ? data.classId
        : input.classId;
    // Server sends `string | null`. Preserve the null explicitly so the
    // UI can distinguish "LMS class, no join code" from "manual class,
    // join code failed to parse". A malformed response (unexpected
    // shape) is treated as null too.
    const joinCode: string | null =
      typeof data?.joinCode === "string" && data.joinCode.length > 0
        ? data.joinCode
        : null;
    const alreadyActive = data?.alreadyActive === true;
    return Object.freeze({
      classId: returnedId,
      status: "active" as const,
      joinCode,
      alreadyActive,
    });
  };
}
