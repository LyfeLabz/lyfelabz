import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import {
  asRec,
  parseHistory,
  parseMutation,
  parsePending,
  type GradeImprovementHistory,
  type GradeImprovementPending,
  type GradeImprovementsSeam,
} from "./types";

// Grade Improvements V1: the Firebase wire for the four `gradeImprovements*`
// callables, wired by the entry point only. LyfeLabz never talks to
// PowerSchool; these calls record only that the teacher marked a grade as
// updated by hand.

export function createGradeImprovementsCallables(functions: Functions): GradeImprovementsSeam {
  const listA = httpsCallable(functions, "gradeImprovementsListForAssignment");
  const listS = httpsCallable(functions, "gradeImprovementsListForStudent");
  const ack = httpsCallable(functions, "gradeImprovementsAcknowledge");
  const rev = httpsCallable(functions, "gradeImprovementsReverse");
  return Object.freeze({
    listForAssignment: async ({ assignmentId }) => {
      const res = await listA({ assignmentId });
      const list = asRec(res.data)?.improvements;
      const out: GradeImprovementPending[] = [];
      for (const raw of Array.isArray(list) ? list : []) {
        const p = parsePending(raw);
        if (p !== null) out.push(p);
      }
      return out;
    },
    listForStudent: async ({ classId, studentId }) => {
      const res = await listS({ classId, studentId });
      const list = asRec(res.data)?.records;
      const out: GradeImprovementHistory[] = [];
      for (const raw of Array.isArray(list) ? list : []) {
        const h = parseHistory(raw);
        if (h !== null) out.push(h);
      }
      return out;
    },
    acknowledge: async (input) =>
      parseMutation(
        (
          await ack({
            assignmentId: input.assignmentId,
            studentId: input.studentId,
            attemptId: input.attemptId,
            percentage: input.percentage,
          })
        ).data,
      ),
    reverse: async (input) =>
      parseMutation(
        (await rev({ assignmentId: input.assignmentId, studentId: input.studentId, eventId: input.eventId })).data,
      ),
  });
}
