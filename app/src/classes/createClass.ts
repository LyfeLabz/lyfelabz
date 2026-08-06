import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Sprint 20: internal-beta wire for the certified `classesCreate`
// callable. This module lives outside `src/shell/**` so the shell
// invariant (no firebase/functions imports, no httpsCallable) is
// preserved. See platform/functions/src/classes/classes-create.ts for
// the canonical server contract, including the classId, title, grade,
// and block validators, ownership derivation, idempotency, and
// server-generated join code.

export type CreateClassInput = {
  readonly title: string;
  readonly grade: string;
  readonly block: string;
};

export type CreateClassResult = {
  readonly classId: string;
  readonly joinCode: string;
  readonly alreadyCreated: boolean;
};

export type CreateClass = (input: CreateClassInput) => Promise<CreateClassResult>;

// Phase 2B.4: the URL-safe classId generator lives in ./classId so
// both Manual Create and the LMS import orchestrator can share one
// implementation without dragging firebase/functions into
// shell-adjacent modules.
import { generateClassId } from "./classId";
export { generateClassId } from "./classId";

type ClassesCreateResponse = {
  readonly classId?: unknown;
  readonly joinCode?: unknown;
  readonly alreadyCreated?: unknown;
};

export function createFirebaseCreateClass(functions: Functions): CreateClass {
  const callable = httpsCallable<
    {
      classId: string;
      title: string;
      grade: string;
      block: string;
    },
    ClassesCreateResponse
  >(functions, "classesCreate");
  return async (input) => {
    const classId = generateClassId();
    const { data } = await callable({
      classId,
      title: input.title,
      grade: input.grade,
      block: input.block,
    });
    const returnedId =
      typeof data?.classId === "string" && data.classId.length > 0
        ? data.classId
        : classId;
    const joinCode =
      typeof data?.joinCode === "string" ? data.joinCode : "";
    const alreadyCreated = data?.alreadyCreated === true;
    return Object.freeze({
      classId: returnedId,
      joinCode,
      alreadyCreated,
    });
  };
}
