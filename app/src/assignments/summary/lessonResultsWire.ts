import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import {
  parseLessonResults,
  type CallableRecord,
  type LessonResults,
  type LessonResultsBatch,
  type LessonResultsCallable,
} from "./lessonResults";

// Entry-point wiring for `assessmentLessonSummary` with Class Results and the
// Unit Results batch form. Replaces `createLessonSummaryCallable` at the entry
// point; the response is validated by `parseLessonResults`.
export function createLessonResultsCallable(functions: Functions): LessonResultsCallable {
  const callable = httpsCallable(functions, "assessmentLessonSummary");
  const single = async (input: { readonly lessonSlug: string }): Promise<LessonResults> => {
    const res = await callable({ lessonSlug: input.lessonSlug });
    return parseLessonResults((res.data ?? {}) as CallableRecord);
  };
  const batch: LessonResultsBatch = async (input) => {
    const res = await callable({ lessonSlugs: [...input.lessonSlugs] });
    const lessons = ((res.data ?? {}) as CallableRecord).lessons;
    if (!Array.isArray(lessons)) {
      throw new Error("assessmentLessonSummary returned an unexpected shape.");
    }
    return Object.freeze(
      (lessons as unknown[]).map((l) => parseLessonResults((l ?? {}) as CallableRecord)),
    );
  };
  return Object.assign(single, { batch });
}
