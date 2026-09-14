import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Sprint 30A.1 Class Settings V1 - client wire for the certified
// `classesUpdateMetadata` callable. Lives outside `src/shell/**` so the
// shell invariant (no firebase/functions imports, no httpsCallable) is
// preserved - mirrors createClass.ts. See
// platform/functions/src/classes/classes-update-metadata.ts for the
// canonical server contract: teacher-ownership check, title/grade/block
// validators (the exact same vocabulary as class creation), and
// idempotent no-op when nothing actually changed. This callable only
// ever touches the LyfeLabz `classes/{classId}` record - it never calls
// Google Classroom or any other LMS provider, and it cannot rename a
// linked Classroom course.

export type UpdateClassMetadataInput = {
  readonly classId: string;
  readonly title?: string;
  readonly grade?: string;
  readonly block?: string;
};

export type UpdateClassMetadataResult = {
  readonly classId: string;
  readonly alreadyUpdated: boolean;
};

export type UpdateClassMetadata = (
  input: UpdateClassMetadataInput,
) => Promise<UpdateClassMetadataResult>;

type ClassesUpdateMetadataResponse = {
  readonly classId?: unknown;
  readonly alreadyUpdated?: unknown;
};

export function createFirebaseUpdateClassMetadata(
  functions: Functions,
): UpdateClassMetadata {
  const callable = httpsCallable<
    {
      classId: string;
      title?: string;
      grade?: string;
      block?: string;
    },
    ClassesUpdateMetadataResponse
  >(functions, "classesUpdateMetadata");
  return async (input) => {
    const { data } = await callable({
      classId: input.classId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.grade !== undefined ? { grade: input.grade } : {}),
      ...(input.block !== undefined ? { block: input.block } : {}),
    });
    return Object.freeze({
      classId:
        typeof data?.classId === "string" && data.classId.length > 0
          ? data.classId
          : input.classId,
      alreadyUpdated: data?.alreadyUpdated === true,
    });
  };
}
