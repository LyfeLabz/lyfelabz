import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type { AssignmentsReopenCallable } from "./types";

// Sprint 13E entry-point wire for the certified `assignmentsReopen`
// callable. Isolated from the pure Assignment Detail surface so the
// surface never imports from firebase/*. Mirrors the Sprint 13D
// `close-wire.ts` seam pattern.
//
// The wire returns a Promise that resolves on the canonical
// `{ assignmentId, status: "published", alreadyPublished }` response
// and rejects on any failure. Failure surfacing at the UI layer never
// reveals Firestore, callable names, stack traces, or document paths;
// the detail surface renders a generic teacher-facing error message.

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function createAssignmentsReopenCallable(
  functions: Functions,
): AssignmentsReopenCallable {
  const callable = httpsCallable(functions, "assignmentsReopen");
  return async (input) => {
    const res = await callable({ assignmentId: input.assignmentId });
    const data = (res.data ?? {}) as CallableRecord;
    if (
      !isNonEmptyString(data.assignmentId) ||
      data.status !== "published" ||
      typeof data.alreadyPublished !== "boolean"
    ) {
      throw new Error("assignmentsReopen returned an unexpected shape.");
    }
    return Object.freeze({
      assignmentId: data.assignmentId,
      status: "published" as const,
      alreadyPublished: data.alreadyPublished,
    });
  };
}
