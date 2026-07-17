import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import {
  parseAssignmentsTeacherListItem,
  type AssignmentsTeacherListCallable,
} from "./hydrate";
import type { AssignmentDetailMetadata } from "./types";

// Sprint 13C entry-point wire for the certified `assignmentsTeacherList`
// callable. Isolated from `hydrate.ts` so the hydrator can be unit-tested
// without loading firebase/functions.

type CallableRecord = Readonly<Record<string, unknown>>;

export function createAssignmentsTeacherListCallable(
  functions: Functions,
): AssignmentsTeacherListCallable {
  const callable = httpsCallable(functions, "assignmentsTeacherList");
  return async () => {
    const res = await callable({});
    const data = (res.data ?? {}) as CallableRecord;
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const parsed: AssignmentDetailMetadata[] = [];
    for (const raw of rawItems) {
      const item = parseAssignmentsTeacherListItem(raw);
      if (item !== null) parsed.push(item);
    }
    return parsed;
  };
}
