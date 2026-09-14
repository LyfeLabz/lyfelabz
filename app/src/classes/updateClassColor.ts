import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type { ClassColorToken } from "./classColor";

// Sprint 30A.1 Class Settings V1 - client wire for the certified
// `teacherClassColorUpdate` callable. Lives outside `src/shell/**` for
// the same reason as updateClassMetadata.ts and createClass.ts. See
// platform/functions/src/teachers/teacher-class-color-update.ts for the
// canonical server contract: teacher-ownership check on the class,
// closed-token validation, and a per-class-id nested merge that never
// disturbs another class's saved color. This callable writes only to
// the caller's OWN teacher-preferences document - color is LyfeLabz-side
// presentation state, never Google Classroom metadata.

export type UpdateClassColor = (
  classId: string,
  color: ClassColorToken | "none",
) => Promise<void>;

export function createFirebaseUpdateClassColor(
  functions: Functions,
): UpdateClassColor {
  const callable = httpsCallable<
    { classId: string; color: ClassColorToken | "none" },
    { ok?: unknown }
  >(functions, "teacherClassColorUpdate");
  return async (classId, color) => {
    await callable({ classId, color });
  };
}
