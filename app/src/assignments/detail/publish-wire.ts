import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type { AssignmentsPublishCallable } from "./types";

// Sprint 13H entry-point wire for the certified `assignmentsPublish`
// callable. Isolated from the pure Assignment Detail surface so the
// surface never imports from firebase/*. Mirrors the seam pattern
// established by Sprint 13D (`close-wire.ts`), Sprint 13E
// (`reopen-wire.ts`), and Sprint 13G (`update-wire.ts`).
//
// The wire returns a Promise that resolves on the canonical
// `{ assignmentId, status: "published", alreadyPublished }` response and
// rejects on any failure. Failure surfacing at the UI layer never
// reveals Firestore, callable names, stack traces, or document paths;
// the detail surface renders a generic teacher-facing error message.

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function createAssignmentsPublishCallable(
  functions: Functions,
): AssignmentsPublishCallable {
  const callable = httpsCallable(functions, "assignmentsPublish");
  return async (input) => {
    const res = await callable({ assignmentId: input.assignmentId });
    const data = (res.data ?? {}) as CallableRecord;
    if (
      !isNonEmptyString(data.assignmentId) ||
      data.status !== "published" ||
      typeof data.alreadyPublished !== "boolean"
    ) {
      throw new Error("assignmentsPublish returned an unexpected shape.");
    }
    return Object.freeze({
      assignmentId: data.assignmentId,
      status: "published" as const,
      alreadyPublished: data.alreadyPublished,
    });
  };
}
