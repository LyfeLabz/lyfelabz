import type { LessonSummary } from "./types";

// Class Results + Unit Results: client shapes and the response parser for
// the certified `assessmentLessonSummary` callable, extended with its
// per-class breakdown (`classes`) and its bounded batch form (`lessonSlugs`,
// Unit Results). The firebase wiring lives in `lessonResultsWire.ts`.
//
// The backend is authoritative for every metric; this wire never derives,
// aggregates, or recomputes. The lesson-wide fields are validated exactly as
// `createLessonSummaryCallable` validates them (a malformed payload fails
// loudly). `classes` is OPTIONAL: it is absent when the deployed backend
// predates Class Results, and a malformed breakdown is dropped (never a
// half-parsed one), so the surface can say "class results unavailable"
// instead of rendering wrong rows. The only identifier it carries is the
// teacher's own classId.

export type LessonClassResult = {
  readonly classId: string;
  readonly students: number;
  readonly studentsCompleted: number;
  readonly completionPercentage: number;
  readonly averageBestPercentage: number | null;
  readonly assignmentsConsidered: number;
};

export type LessonResults = LessonSummary & {
  readonly classes?: ReadonlyArray<LessonClassResult>;
};

// Unit Results: one entry per distinct requested slug, in request order.
export type LessonResultsBatch = (input: {
  readonly lessonSlugs: ReadonlyArray<string>;
}) => Promise<ReadonlyArray<LessonResults>>;

// One seam for one callable: the single-lesson call (Curriculum Results) and,
// when wired, its batch form. A plain `LessonSummaryCallable` is assignable
// here (no `classes`, no `batch`), which is exactly the "unavailable" state.
export type LessonResultsCallable = ((input: {
  readonly lessonSlug: string;
}) => Promise<LessonResults>) & {
  readonly batch?: LessonResultsBatch;
};

export type CallableRecord = Record<string, unknown>;

const isString = (v: unknown): v is string => typeof v === "string";
const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isNullableFiniteNumber = (v: unknown): v is number | null =>
  v === null || isFiniteNumber(v);

function parseClasses(raw: unknown): ReadonlyArray<LessonClassResult> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows: LessonClassResult[] = [];
  for (const value of raw as unknown[]) {
    const r = (value ?? {}) as CallableRecord;
    if (
      !isString(r.classId) ||
      r.classId.length === 0 ||
      !isFiniteNumber(r.students) ||
      !isFiniteNumber(r.studentsCompleted) ||
      !isFiniteNumber(r.completionPercentage) ||
      !isNullableFiniteNumber(r.averageBestPercentage) ||
      !isFiniteNumber(r.assignmentsConsidered)
    ) {
      return undefined;
    }
    rows.push(
      Object.freeze({
        classId: r.classId,
        students: r.students,
        studentsCompleted: r.studentsCompleted,
        completionPercentage: r.completionPercentage,
        averageBestPercentage: r.averageBestPercentage,
        assignmentsConsidered: r.assignmentsConsidered,
      }),
    );
  }
  return Object.freeze(rows);
}

export function parseLessonResults(raw: CallableRecord): LessonResults {
  const {
    lessonSlug,
    classesAssigned,
    students,
    studentsCompleted,
    completionPercentage,
    averageBestPercentage,
    assignmentsConsidered,
  } = raw;
  if (
    !isString(lessonSlug) ||
    !isFiniteNumber(classesAssigned) ||
    !isFiniteNumber(students) ||
    !isFiniteNumber(studentsCompleted) ||
    !isFiniteNumber(completionPercentage) ||
    !isNullableFiniteNumber(averageBestPercentage) ||
    !isFiniteNumber(assignmentsConsidered)
  ) {
    throw new Error("assessmentLessonSummary returned an unexpected shape.");
  }
  const classes = parseClasses(raw.classes);
  return Object.freeze({
    lessonSlug,
    classesAssigned,
    students,
    studentsCompleted,
    completionPercentage,
    averageBestPercentage,
    assignmentsConsidered,
    ...(classes === undefined ? {} : { classes }),
  });
}
