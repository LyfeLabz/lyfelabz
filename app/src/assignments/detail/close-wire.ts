import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type { AssignmentsCloseCallable } from "./types";

// Sprint 13D entry-point wire for the certified `assignmentsClose`
// callable. Isolated from the pure Assignment Detail surface so the
// surface never imports from firebase/*. Mirrors the seam pattern
// established by Sprint 13A (`summary/wire.ts`) and Sprint 13C
// (`hydrate-wire.ts`).
//
// The wire returns a Promise that resolves on the canonical
// `{ assignmentId, status: "closed", alreadyClosed }` response and
// rejects on any failure. Failure surfacing at the UI layer never
// reveals Firestore, callable names, stack traces, or document paths;
// the detail surface renders a generic teacher-facing error message.

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function createAssignmentsCloseCallable(
  functions: Functions,
): AssignmentsCloseCallable {
  const callable = httpsCallable(functions, "assignmentsClose");
  return async (input) => {
    const res = await callable({ assignmentId: input.assignmentId });
    const data = (res.data ?? {}) as CallableRecord;
    if (
      !isNonEmptyString(data.assignmentId) ||
      data.status !== "closed" ||
      typeof data.alreadyClosed !== "boolean"
    ) {
      throw new Error("assignmentsClose returned an unexpected shape.");
    }
    return Object.freeze({
      assignmentId: data.assignmentId,
      status: "closed" as const,
      alreadyClosed: data.alreadyClosed,
    });
  };
}
