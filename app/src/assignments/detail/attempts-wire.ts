import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Sprint 15 Slices 5 and 6: entry-point wires for the certified
// `assessmentAttemptsListForClass` and `assessmentAttemptGetForTeacher`
// callables. Kept in one small module so both wires share the same
// parsing conventions; the Assignment Detail surface consumes both
// through their exported callable types.

export type CompletedAttemptSummary = {
  readonly attemptId: string;
  readonly studentId: string;
  readonly studentDisplayName: string;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly submittedAt: number;
};

export type AttemptsListForClassCallable = (input: {
  readonly classId: string;
}) => Promise<{
  readonly classId: string;
  readonly attempts: ReadonlyArray<CompletedAttemptSummary>;
}>;

export type TeacherVisibleItemResult = {
  readonly itemId: string;
  readonly isCorrect: boolean;
  readonly correctOptionId: string;
  readonly studentResponse: string | null;
};

export type TeacherVisibleAttempt = {
  readonly attemptId: string;
  readonly studentId: string;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly percentage: number;
  readonly itemResults: ReadonlyArray<TeacherVisibleItemResult>;
};

export type AttemptGetForTeacherCallable = (input: {
  readonly attemptId: string;
}) => Promise<TeacherVisibleAttempt>;

type CallableRecord = Readonly<Record<string, unknown>>;
const isString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;
const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function createAttemptsListForClassCallable(
  functions: Functions,
): AttemptsListForClassCallable {
  const callable = httpsCallable(functions, "assessmentAttemptsListForClass");
  return async (input) => {
    const res = await callable({ classId: input.classId });
    const data = (res.data ?? {}) as CallableRecord;
    const rawList = Array.isArray(data.attempts) ? data.attempts : [];
    const parsed: CompletedAttemptSummary[] = [];
    for (const raw of rawList) {
      if (raw === null || typeof raw !== "object") continue;
      const r = raw as CallableRecord;
      if (
        !isString(r.attemptId) ||
        !isString(r.studentId) ||
        !isString(r.studentDisplayName) ||
        !isString(r.assignmentId) ||
        !isNumber(r.attemptNumber) ||
        !isNumber(r.score) ||
        !isNumber(r.maxScore) ||
        !isNumber(r.percentage) ||
        !isNumber(r.submittedAt)
      ) {
        continue;
      }
      parsed.push({
        attemptId: r.attemptId,
        studentId: r.studentId,
        studentDisplayName: r.studentDisplayName,
        assignmentId: r.assignmentId,
        attemptNumber: r.attemptNumber,
        score: r.score,
        maxScore: r.maxScore,
        percentage: r.percentage,
        submittedAt: r.submittedAt,
      });
    }
    return {
      classId: isString(data.classId) ? data.classId : input.classId,
      attempts: parsed,
    };
  };
}

export function createAttemptGetForTeacherCallable(
  functions: Functions,
): AttemptGetForTeacherCallable {
  const callable = httpsCallable(functions, "assessmentAttemptGetForTeacher");
  return async (input) => {
    const res = await callable({ attemptId: input.attemptId });
    const data = (res.data ?? {}) as CallableRecord;
    const attempt = (data.attempt ?? {}) as CallableRecord;
    const rawItems = Array.isArray(attempt.itemResults)
      ? attempt.itemResults
      : [];
    const itemResults: TeacherVisibleItemResult[] = [];
    for (const raw of rawItems) {
      if (raw === null || typeof raw !== "object") continue;
      const r = raw as CallableRecord;
      if (
        !isString(r.itemId) ||
        typeof r.isCorrect !== "boolean" ||
        !isString(r.correctOptionId)
      ) {
        continue;
      }
      itemResults.push({
        itemId: r.itemId,
        isCorrect: r.isCorrect,
        correctOptionId: r.correctOptionId,
        studentResponse:
          typeof r.studentResponse === "string" ? r.studentResponse : null,
      });
    }
    return {
      attemptId: isString(attempt.attemptId) ? attempt.attemptId : input.attemptId,
      studentId: isString(attempt.studentId) ? attempt.studentId : "",
      assignmentId: isString(attempt.assignmentId) ? attempt.assignmentId : "",
      attemptNumber: isNumber(attempt.attemptNumber)
        ? attempt.attemptNumber
        : 0,
      percentage: isNumber(attempt.percentage) ? attempt.percentage : 0,
      itemResults,
    };
  };
}
