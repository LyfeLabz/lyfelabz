import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Sprint 27 Phase 5: entry-point wires for the two certified callables the
// teacher-facing late-recipient affordance consumes:
//
//   - `assignmentsRecipientCandidatesList` enumerates the active-enrolled
//     students in a published assignment's frozen class who are NOT yet
//     recipients (the addable late-recipient candidates).
//   - `assignmentsRecipientAdd` adds one such student to the frozen
//     recipient population through the certified `manualAddition` path
//     (PDR-029h); it is idempotent server-side.
//
// Both are isolated from the pure Assignment Detail surface so tests can
// inject in-memory fakes and the surface stays firebase-free.
// Confidentiality: neither wire projects attempt, session, score, answer,
// provider identity, or OAuth data. The candidate projection carries only
// the minimum studentId + display name already approved for teacher roster
// views. The client never constructs recipient provenance; `source` is owned
// entirely by the server.

export type AssignmentRecipientCandidate = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

export type AssignmentRecipientCandidatesListCallable = (input: {
  readonly assignmentId: string;
}) => Promise<{
  readonly assignmentId: string;
  readonly candidates: ReadonlyArray<AssignmentRecipientCandidate>;
}>;

export type AssignmentsRecipientAddCallable = (input: {
  readonly assignmentId: string;
  readonly studentId: string;
}) => Promise<{
  readonly assignmentId: string;
  readonly studentId: string;
  readonly added: boolean;
}>;

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function createAssignmentRecipientCandidatesListCallable(
  functions: Functions,
): AssignmentRecipientCandidatesListCallable {
  const callable = httpsCallable(functions, "assignmentsRecipientCandidatesList");
  return async (input) => {
    const res = await callable({ assignmentId: input.assignmentId });
    const data = (res.data ?? {}) as CallableRecord;
    const rawId = data.assignmentId;
    const rawCandidates = Array.isArray(data.candidates) ? data.candidates : [];
    const parsed: AssignmentRecipientCandidate[] = [];
    for (const raw of rawCandidates) {
      if (raw === null || typeof raw !== "object") continue;
      const c = raw as CallableRecord;
      if (
        isNonEmptyString(c.studentId) &&
        isNonEmptyString(c.studentDisplayName)
      ) {
        parsed.push({
          studentId: c.studentId,
          studentDisplayName: c.studentDisplayName,
        });
      }
    }
    return {
      assignmentId: isNonEmptyString(rawId) ? rawId : input.assignmentId,
      candidates: parsed,
    };
  };
}

export function createAssignmentsRecipientAddCallable(
  functions: Functions,
): AssignmentsRecipientAddCallable {
  const callable = httpsCallable(functions, "assignmentsRecipientAdd");
  return async (input) => {
    // The client sends only the (assignmentId, studentId) pair. Every
    // ownership field, the recipient `source`, the status, and the
    // timestamp are derived and owned server-side.
    const res = await callable({
      assignmentId: input.assignmentId,
      studentId: input.studentId,
    });
    const data = (res.data ?? {}) as CallableRecord;
    return {
      assignmentId: isNonEmptyString(data.assignmentId)
        ? data.assignmentId
        : input.assignmentId,
      studentId: isNonEmptyString(data.studentId)
        ? data.studentId
        : input.studentId,
      added: data.added === true,
    };
  };
}
