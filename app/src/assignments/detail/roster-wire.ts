import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Sprint 15 Slice 5: entry-point wire for the certified
// `assignmentsRecipientList` callable. Isolated from the pure Assignment
// Detail surface so tests can inject an in-memory fake and the surface
// stays firebase-free. Confidentiality: the callable is authorized to
// return only the frozen recipient population owned by the caller; no
// attempt, session, score, or answer data is projected here.

export type AssignmentRecipient = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

export type AssignmentRecipientListCallable = (input: {
  readonly assignmentId: string;
}) => Promise<{
  readonly assignmentId: string;
  readonly recipients: ReadonlyArray<AssignmentRecipient>;
}>;

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function createAssignmentRecipientListCallable(
  functions: Functions,
): AssignmentRecipientListCallable {
  const callable = httpsCallable(functions, "assignmentsRecipientList");
  return async (input) => {
    const res = await callable({ assignmentId: input.assignmentId });
    const data = (res.data ?? {}) as CallableRecord;
    const rawId = data.assignmentId;
    const rawRecipients = Array.isArray(data.recipients) ? data.recipients : [];
    const parsed: AssignmentRecipient[] = [];
    for (const raw of rawRecipients) {
      if (raw === null || typeof raw !== "object") continue;
      const r = raw as CallableRecord;
      if (
        isNonEmptyString(r.studentId) &&
        isNonEmptyString(r.studentDisplayName)
      ) {
        parsed.push({
          studentId: r.studentId,
          studentDisplayName: r.studentDisplayName,
        });
      }
    }
    return {
      assignmentId: isNonEmptyString(rawId) ? rawId : input.assignmentId,
      recipients: parsed,
    };
  };
}
