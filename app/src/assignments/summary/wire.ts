import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
} from "./types";

// Sprint 13A entry-point wiring for the certified
// `assessmentAssignmentSummary` callable. This module is the seam that
// keeps the reusable summary card free of firebase/* imports. It is
// imported only by src/index.ts and follows the pattern established by
// src/settings/integrations/wire.ts.
//
// The callable contract is defined by Sprint 12E Slice 1 and preserved
// by Slice 2C (see docs/platform/SPRINT_12E_SLICE_1_COMPLETION_REPORT.md
// and docs/platform/SPRINT_12E_SLICE_2C_COMPLETION_REPORT.md). The
// backend remains authoritative for every metric; this wire never
// derives, aggregates, or recomputes.

type CallableRecord = Readonly<Record<string, unknown>>;

const isString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isNullableFiniteNumber = (v: unknown): v is number | null =>
  v === null || isFiniteNumber(v);

function parseSummary(raw: CallableRecord): AssignmentSummary {
  const assignmentId = raw.assignmentId;
  const classId = raw.classId;
  const totalStudents = raw.totalStudents;
  const completedStudents = raw.completedStudents;
  const inProgressStudents = raw.inProgressStudents;
  const notStartedStudents = raw.notStartedStudents;
  const completionPercentage = raw.completionPercentage;
  const averagePercentage = raw.averagePercentage;
  const highestPercentage = raw.highestPercentage;
  const lowestPercentage = raw.lowestPercentage;
  const perfectScoreStudents = raw.perfectScoreStudents;

  if (
    !isString(assignmentId) ||
    !isString(classId) ||
    !isFiniteNumber(totalStudents) ||
    !isFiniteNumber(completedStudents) ||
    !isFiniteNumber(inProgressStudents) ||
    !isFiniteNumber(notStartedStudents) ||
    !isFiniteNumber(completionPercentage) ||
    !isNullableFiniteNumber(averagePercentage) ||
    !isNullableFiniteNumber(highestPercentage) ||
    !isNullableFiniteNumber(lowestPercentage) ||
    !isFiniteNumber(perfectScoreStudents)
  ) {
    throw new Error(
      "assessmentAssignmentSummary returned an unexpected shape.",
    );
  }

  return Object.freeze({
    assignmentId,
    classId,
    totalStudents,
    completedStudents,
    inProgressStudents,
    notStartedStudents,
    completionPercentage,
    averagePercentage,
    highestPercentage,
    lowestPercentage,
    perfectScoreStudents,
  });
}

export function createAssignmentSummaryCallable(
  functions: Functions,
): AssignmentSummaryCallable {
  const callable = httpsCallable(functions, "assessmentAssignmentSummary");
  return async (input) => {
    const res = await callable({ assignmentId: input.assignmentId });
    const data = (res.data ?? {}) as CallableRecord;
    return parseSummary(data);
  };
}
