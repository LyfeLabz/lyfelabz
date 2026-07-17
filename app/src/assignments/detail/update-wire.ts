import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type { AssignmentsUpdateDraftCallable } from "./types";

// Sprint 13G entry-point wire for the certified `assignmentsUpdateDraft`
// callable. Isolated from the pure Assignment Detail surface so the
// surface never imports from firebase/*. Mirrors the seam pattern
// established by Sprint 13D (`close-wire.ts`) and Sprint 13E
// (`reopen-wire.ts`).
//
// The wire returns a Promise that resolves on the canonical
// `{ assignmentId, alreadyUpdated }` response and rejects on any
// failure. Failure surfacing at the UI layer never reveals Firestore,
// callable names, stack traces, or document paths; the detail surface
// renders a generic teacher-facing error message.

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function createAssignmentsUpdateDraftCallable(
  functions: Functions,
): AssignmentsUpdateDraftCallable {
  const callable = httpsCallable(functions, "assignmentsUpdateDraft");
  return async (input) => {
    const payload: Record<string, unknown> = {
      assignmentId: input.assignmentId,
    };
    if (input.title !== undefined) payload.title = input.title;
    if (input.instructions !== undefined) payload.instructions = input.instructions;
    const res = await callable(payload);
    const data = (res.data ?? {}) as CallableRecord;
    if (
      !isNonEmptyString(data.assignmentId) ||
      typeof data.alreadyUpdated !== "boolean"
    ) {
      throw new Error("assignmentsUpdateDraft returned an unexpected shape.");
    }
    return Object.freeze({
      assignmentId: data.assignmentId,
      alreadyUpdated: data.alreadyUpdated,
    });
  };
}
