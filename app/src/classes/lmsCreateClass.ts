import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Sprint 24B Phase 2B.4: client wrapper for the certified
// `classesLmsCreate` callable. This module lives outside `src/shell/**`
// so the shell "no firebase imports" invariant is preserved. See
// platform/functions/src/classes/classes-lms-create.ts for the
// canonical server contract: narrow `{classId, title}` request,
// `NeedsSetupClassRecord` write shape, no grade/block/joinCode written.
//
// The wrapper is intentionally thin. It accepts a caller-generated
// classId (the same generator Manual Create uses) plus the LMS course
// title, invokes the callable, and returns the narrow shape the import
// orchestrator consumes. Errors are rethrown unchanged so the caller
// may distinguish creation failure from link failure.

export type LmsCreateClassInput = {
  readonly classId: string;
  readonly title: string;
};

export type LmsCreateClassResult = {
  readonly classId: string;
  readonly alreadyCreated: boolean;
};

export type LmsCreateClass = (
  input: LmsCreateClassInput,
) => Promise<LmsCreateClassResult>;

type ClassesLmsCreateResponse = {
  readonly classId?: unknown;
  readonly status?: unknown;
  readonly alreadyCreated?: unknown;
};

export function createFirebaseLmsCreateClass(
  functions: Functions,
): LmsCreateClass {
  const callable = httpsCallable<
    { classId: string; title: string },
    ClassesLmsCreateResponse
  >(functions, "classesLmsCreate");
  return async (input) => {
    const { data } = await callable({
      classId: input.classId,
      title: input.title,
    });
    const returnedId =
      typeof data?.classId === "string" && data.classId.length > 0
        ? data.classId
        : input.classId;
    const alreadyCreated = data?.alreadyCreated === true;
    return Object.freeze({
      classId: returnedId,
      alreadyCreated,
    });
  };
}
