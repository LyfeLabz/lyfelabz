import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type {
  StudentAttemptSummary,
  StudentResultsListCallable,
  StudentResultsListResponse,
} from "./types";

// Sprint 27 Phase 2 (Decision 1) entry-point wiring for the caller-scoped
// `assessmentAttemptsList` callable. This module is the seam that keeps
// the active-student surface free of firebase/* imports. It is imported
// only by src/index.ts and follows the pattern established by
// src/assignments/studentList/wire.ts and
// src/assignments/detail/attempts-wire.ts.
//
// The callable contract lives at
// `platform/functions/src/assessments/assessment-attempts-list.ts`. The
// backend is authoritative for authorization, caller scoping, and the
// answer-key-free projection; this wire never derives, aggregates, or
// filters authoritatively. It only rejects malformed items so a broken
// server contract cannot silently propagate into a rendered surface.
//
// Load-bearing security distinction (blueprint §5.4, §5.5): this wire
// targets ONLY the caller-scoped `assessmentAttemptsList`. It must never
// target the teacher, class-scoped `assessmentAttemptsListForClass`, which
// returns every student's attempts and their display names. The callable
// name is asserted in the deterministic tests precisely because that
// distinction is load-bearing.

const CALLABLE_NAME = "assessmentAttemptsList";

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

// A single attempt is normalized to the client-side summary or dropped.
// Returning null (rather than throwing) lets the caller skip a malformed
// item without discarding the whole response. The projection mirrors only
// the approved student-visible fields; any field the callable does not
// return (itemResults, responses, teacherId, districtId, schoolId) is
// absent by construction and is never read here.
export function parseStudentAttemptSummary(
  raw: unknown,
): StudentAttemptSummary | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as CallableRecord;
  const attemptId = record.attemptId;
  const assignmentId = record.assignmentId;
  const attemptNumber = record.attemptNumber;
  const score = record.score;
  const maxScore = record.maxScore;
  const percentage = record.percentage;
  const submittedAt = record.submittedAt;
  if (!isNonEmptyString(attemptId)) return null;
  if (!isNonEmptyString(assignmentId)) return null;
  if (!isFiniteNumber(attemptNumber)) return null;
  if (!isFiniteNumber(score)) return null;
  if (!isFiniteNumber(maxScore)) return null;
  if (!isFiniteNumber(percentage)) return null;
  if (!isFiniteNumber(submittedAt)) return null;
  return Object.freeze({
    attemptId,
    assignmentId,
    attemptNumber,
    score,
    maxScore,
    percentage,
    submittedAt,
  });
}

function parseResponse(raw: unknown): StudentResultsListResponse {
  const record = (raw ?? {}) as CallableRecord;
  const attempts = record.attempts;
  if (!Array.isArray(attempts)) {
    return Object.freeze({ attempts: Object.freeze([]) });
  }
  const parsed: StudentAttemptSummary[] = [];
  for (const entry of attempts) {
    const item = parseStudentAttemptSummary(entry);
    if (item !== null) parsed.push(item);
  }
  return Object.freeze({ attempts: Object.freeze(parsed) });
}

export function createAttemptsListForStudentCallable(
  functions: Functions,
): StudentResultsListCallable {
  const callable = httpsCallable(functions, CALLABLE_NAME);
  return async () => {
    // The request payload is the empty object per the certified contract.
    // Caller identity is the sole authorization source; no identifiers
    // (studentId, uid, districtId, schoolId, classId, teacherId) are ever
    // sent from the browser. The backend rejects those keys on shape.
    const res = await callable({});
    return parseResponse(res.data);
  };
}
