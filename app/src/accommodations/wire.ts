import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Slice 7: client-side wires for the three accommodation callables consumed
// by the Student Services panel in Settings. Isolated from the surface so
// tests inject fakes and the surface stays firebase-free.

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export type ReadingAccessibilityConfig =
  | { readonly status: "inactive" }
  | { readonly status: "active"; readonly level: "adapted" };

// Student identity entry returned by accommodationsListStudents. Accommodation
// state for a selected student is loaded separately via accommodationsGet.
export type StudentAccommodationSummary = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

// accommodationsListStudents

export type AccommodationsListStudentsCallable = (input: {
  readonly classId: string;
}) => Promise<{
  readonly classId: string;
  readonly students: ReadonlyArray<StudentAccommodationSummary>;
}>;

function parseReadingAccessibility(raw: unknown): ReadingAccessibilityConfig {
  if (raw !== null && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (r.status === "active" && r.level === "adapted") {
      return { status: "active", level: "adapted" };
    }
  }
  return { status: "inactive" };
}

export function createAccommodationsListStudentsCallable(
  functions: Functions,
): AccommodationsListStudentsCallable {
  const callable = httpsCallable(functions, "accommodationsListStudents");
  return async (input) => {
    const res = await callable({ classId: input.classId });
    const data = (res.data ?? {}) as CallableRecord;
    const rawClassId = data.classId;
    const rawStudents = Array.isArray(data.students) ? data.students : [];
    const students: StudentAccommodationSummary[] = [];
    for (const raw of rawStudents) {
      if (raw === null || typeof raw !== "object") continue;
      const r = raw as CallableRecord;
      if (!isNonEmptyString(r.studentId)) continue;
      students.push({
        studentId: r.studentId,
        studentDisplayName: isNonEmptyString(r.studentDisplayName)
          ? r.studentDisplayName
          : "Name unavailable",
      });
    }
    return {
      classId: isNonEmptyString(rawClassId) ? rawClassId : input.classId,
      students,
    };
  };
}

// accommodationsGet

export type AccommodationsGetCallable = (input: {
  readonly studentId: string;
  readonly classId: string;
}) => Promise<
  | { readonly configRevision: 0 }
  | {
      readonly configRevision: number;
      readonly readingAccessibility: ReadingAccessibilityConfig;
      readonly updatedBy: string;
    }
>;

export function createAccommodationsGetCallable(
  functions: Functions,
): AccommodationsGetCallable {
  const callable = httpsCallable(functions, "accommodationsGet");
  return async (input) => {
    const res = await callable({
      studentId: input.studentId,
      classId: input.classId,
    });
    const data = (res.data ?? {}) as CallableRecord;
    const rev = data.configRevision;
    if (typeof rev !== "number" || rev === 0) {
      return { configRevision: 0 };
    }
    return {
      configRevision: rev,
      readingAccessibility: parseReadingAccessibility(data.readingAccessibility),
      updatedBy: isNonEmptyString(data.updatedBy) ? data.updatedBy : "",
    };
  };
}

// accommodationsSet

export type AccommodationsSetCallable = (input: {
  readonly studentId: string;
  readonly classId: string;
  readonly expectedRevision: number;
  readonly newValue: ReadingAccessibilityConfig;
  readonly idempotencyKey?: string;
}) => Promise<{
  readonly studentId: string;
  readonly configRevision: number;
  readonly readingAccessibility: ReadingAccessibilityConfig;
  readonly noop: boolean;
}>;

export function createAccommodationsSetCallable(
  functions: Functions,
): AccommodationsSetCallable {
  const callable = httpsCallable(functions, "accommodationsSet");
  return async (input) => {
    const res = await callable({
      studentId: input.studentId,
      classId: input.classId,
      expectedRevision: input.expectedRevision,
      newValue: input.newValue,
      ...(input.idempotencyKey !== undefined
        ? { idempotencyKey: input.idempotencyKey }
        : {}),
    });
    const data = (res.data ?? {}) as CallableRecord;
    return {
      studentId: isNonEmptyString(data.studentId)
        ? data.studentId
        : input.studentId,
      configRevision:
        typeof data.configRevision === "number" ? data.configRevision : 0,
      readingAccessibility: parseReadingAccessibility(data.readingAccessibility),
      noop: data.noop === true,
    };
  };
}
