// Grade Improvements V1: client shapes and response parsing for the four
// `gradeImprovements*` callables. No firebase/* import here: surfaces consume
// these types only (the Firebase wire is `./wire`); tests inject fakes.
//
// LyfeLabz never talks to PowerSchool. These calls record only that the
// teacher marked a grade as updated by hand.

export type GradeImprovementPending = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly baselinePercentage: number;
  readonly baselineSource: "firstAttempt" | "acknowledged";
  readonly bestPercentage: number;
  readonly bestAttemptId: string;
};

export type GradeImprovementEvent = {
  readonly eventId: string;
  readonly type: "acknowledged" | "reversed";
  readonly percentage: number;
  readonly attemptId: string;
  readonly baselinePercentage: number | null;
  readonly targetEventId: string | null;
  readonly createdAt: number | null;
  readonly byCaller: boolean;
};

export type GradeImprovementHistory = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly effective: {
    readonly eventId: string;
    readonly percentage: number;
    readonly attemptId: string;
  } | null;
  // Newest first.
  readonly events: ReadonlyArray<GradeImprovementEvent>;
};

export type GradeImprovementMutationResult = {
  readonly status: "acknowledged" | "alreadyAcknowledged" | "reversed" | "alreadyReversed";
  readonly pending: GradeImprovementPending | null;
  readonly history: GradeImprovementHistory;
};

export type GradeImprovementsSeam = {
  readonly listForAssignment: (input: {
    readonly assignmentId: string;
  }) => Promise<ReadonlyArray<GradeImprovementPending>>;
  readonly listForStudent: (input: {
    readonly classId: string;
    readonly studentId: string;
  }) => Promise<ReadonlyArray<GradeImprovementHistory>>;
  readonly acknowledge: (input: {
    readonly assignmentId: string;
    readonly studentId: string;
    readonly attemptId: string;
    readonly percentage: number;
  }) => Promise<GradeImprovementMutationResult>;
  readonly reverse: (input: {
    readonly assignmentId: string;
    readonly studentId: string;
    readonly eventId: string;
  }) => Promise<GradeImprovementMutationResult>;
};

// True when the server refused because the score or history changed since
// the teacher opened the confirmation (`gradeImprovements.stale`).
export function isStaleGradeImprovementError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const details = (err as { details?: unknown }).details;
  if (details === null || typeof details !== "object") return false;
  return (details as { code?: unknown }).code === "gradeImprovements.stale";
}

type Rec = Readonly<Record<string, unknown>>;
const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const asRec = (v: unknown): Rec | null => (v !== null && typeof v === "object" ? (v as Rec) : null);

export function parsePending(raw: unknown): GradeImprovementPending | null {
  const r = asRec(raw);
  if (
    r === null ||
    !isString(r.assignmentId) ||
    !isString(r.studentId) ||
    !isNumber(r.baselinePercentage) ||
    (r.baselineSource !== "firstAttempt" && r.baselineSource !== "acknowledged") ||
    !isNumber(r.bestPercentage) ||
    !isString(r.bestAttemptId)
  ) {
    return null;
  }
  return {
    assignmentId: r.assignmentId,
    studentId: r.studentId,
    baselinePercentage: r.baselinePercentage,
    baselineSource: r.baselineSource,
    bestPercentage: r.bestPercentage,
    bestAttemptId: r.bestAttemptId,
  };
}

function parseEvent(raw: unknown): GradeImprovementEvent | null {
  const r = asRec(raw);
  if (
    r === null ||
    !isString(r.eventId) ||
    (r.type !== "acknowledged" && r.type !== "reversed") ||
    !isNumber(r.percentage) ||
    !isString(r.attemptId)
  ) {
    return null;
  }
  return {
    eventId: r.eventId,
    type: r.type,
    percentage: r.percentage,
    attemptId: r.attemptId,
    baselinePercentage: isNumber(r.baselinePercentage) ? r.baselinePercentage : null,
    targetEventId: isString(r.targetEventId) ? r.targetEventId : null,
    createdAt: isNumber(r.createdAt) ? r.createdAt : null,
    byCaller: r.byCaller === true,
  };
}

export function parseHistory(raw: unknown): GradeImprovementHistory | null {
  const r = asRec(raw);
  if (r === null || !isString(r.assignmentId) || !isString(r.studentId)) return null;
  const eff = asRec(r.effective);
  const effective =
    eff !== null && isString(eff.eventId) && isNumber(eff.percentage) && isString(eff.attemptId)
      ? { eventId: eff.eventId, percentage: eff.percentage, attemptId: eff.attemptId }
      : null;
  const events: GradeImprovementEvent[] = [];
  for (const e of Array.isArray(r.events) ? r.events : []) {
    const parsed = parseEvent(e);
    if (parsed !== null) events.push(parsed);
  }
  return { assignmentId: r.assignmentId, studentId: r.studentId, effective, events };
}

export function parseMutation(raw: unknown): GradeImprovementMutationResult {
  const r = asRec(raw) ?? {};
  const history = parseHistory(r.history);
  const status = r.status;
  if (
    history === null ||
    (status !== "acknowledged" &&
      status !== "alreadyAcknowledged" &&
      status !== "reversed" &&
      status !== "alreadyReversed")
  ) {
    throw new Error("Unexpected response.");
  }
  return { status, pending: parsePending(r.pending), history };
}
