import type { TeacherVisibleAttempt } from "./attempts-wire";

// Sprint 15 Slice 6: pure per-question factual aggregator. Consumes a
// list of representative completed attempts and returns the per-question
// correct-response rate and per-option response distribution. There is
// no ordering by "most missed", no inference, and no student names. The
// output preserves the canonical question order as the questions appear
// in the first attempt (attempts of the same assessment share this
// canonical order by construction).

export type QuestionOptionDistribution = {
  readonly optionId: string;
  readonly chosenCount: number;
  readonly chosenPercentage: number;
};

export type QuestionSummary = {
  readonly itemId: string;
  readonly correctCount: number;
  readonly totalResponses: number;
  readonly correctPercentage: number;
  readonly correctOptionId: string;
  readonly options: ReadonlyArray<QuestionOptionDistribution>;
};

export type PerQuestionAggregate = {
  readonly attemptsCounted: number;
  readonly questions: ReadonlyArray<QuestionSummary>;
};

export const MIN_QUESTION_SUMMARY_ATTEMPTS = 3;

export function aggregatePerQuestion(
  attempts: ReadonlyArray<TeacherVisibleAttempt>,
): PerQuestionAggregate {
  const order: string[] = [];
  const seen = new Set<string>();
  const perItem = new Map<
    string,
    {
      correctCount: number;
      totalResponses: number;
      correctOptionId: string;
      optionCounts: Map<string, number>;
    }
  >();

  for (const attempt of attempts) {
    for (const item of attempt.itemResults) {
      if (!seen.has(item.itemId)) {
        seen.add(item.itemId);
        order.push(item.itemId);
      }
      let bucket = perItem.get(item.itemId);
      if (bucket === undefined) {
        bucket = {
          correctCount: 0,
          totalResponses: 0,
          correctOptionId: item.correctOptionId,
          optionCounts: new Map<string, number>(),
        };
        perItem.set(item.itemId, bucket);
      }
      bucket.totalResponses += 1;
      if (item.isCorrect) bucket.correctCount += 1;
      const chosen = item.studentResponse;
      if (typeof chosen === "string" && chosen.length > 0) {
        bucket.optionCounts.set(
          chosen,
          (bucket.optionCounts.get(chosen) ?? 0) + 1,
        );
      }
    }
  }

  const questions: QuestionSummary[] = order.map((itemId) => {
    const bucket = perItem.get(itemId)!;
    const correctPercentage =
      bucket.totalResponses === 0
        ? 0
        : Math.round((bucket.correctCount / bucket.totalResponses) * 1000) / 10;
    const options: QuestionOptionDistribution[] = [];
    for (const [optionId, chosenCount] of bucket.optionCounts) {
      const chosenPercentage =
        bucket.totalResponses === 0
          ? 0
          : Math.round((chosenCount / bucket.totalResponses) * 1000) / 10;
      options.push({ optionId, chosenCount, chosenPercentage });
    }
    options.sort((a, b) =>
      a.optionId < b.optionId ? -1 : a.optionId > b.optionId ? 1 : 0,
    );
    return {
      itemId,
      correctCount: bucket.correctCount,
      totalResponses: bucket.totalResponses,
      correctPercentage,
      correctOptionId: bucket.correctOptionId,
      options,
    };
  });

  return { attemptsCounted: attempts.length, questions };
}

// Question results analytics: restrained instructional-performance bands
// for the overview tiles. Classified on the same one-decimal percentage the
// tile displays, so the band always agrees with the visible number.
export type QuestionPerformanceBand = "strong" | "review" | "reteach";

export const QUESTION_REVIEW_THRESHOLD = 60;
export const QUESTION_STRONG_THRESHOLD = 80;

export function classifyQuestionPerformance(
  correctPercentage: number,
): QuestionPerformanceBand {
  if (correctPercentage >= QUESTION_STRONG_THRESHOLD) return "strong";
  if (correctPercentage >= QUESTION_REVIEW_THRESHOLD) return "review";
  return "reteach";
}

// Question content from the immutable `assessmentRevisions/{revisionId}`
// document (item stems and option text; no correct-answer material). The
// revision is the one the attempts were scored against, so the text shown
// is exactly the text the students answered.
export type AssessmentRevisionContentOption = {
  readonly optionId: string;
  readonly text: string;
};

export type AssessmentRevisionContentItem = {
  readonly itemId: string;
  readonly stem: string;
  readonly options: ReadonlyArray<AssessmentRevisionContentOption>;
};

export type AssessmentRevisionContent = {
  readonly revisionId: string;
  readonly items: ReadonlyArray<AssessmentRevisionContentItem>;
};

// Injected read seam. Resolves null when the revision cannot be read; the
// panel then shows results without question text.
export type AssessmentRevisionContentReader = (
  revisionId: string,
) => Promise<AssessmentRevisionContent | null>;

const nonEmpty = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

// Defensive parse of a raw revision document. Malformed items or options
// are dropped; an item without a usable stem or options is omitted so the
// panel falls back to results-only for that question.
export function parseAssessmentRevisionContent(
  revisionId: string,
  data: unknown,
): AssessmentRevisionContent | null {
  if (data === null || typeof data !== "object") return null;
  const rawItems = (data as Record<string, unknown>).items;
  if (!Array.isArray(rawItems)) return null;
  const items: AssessmentRevisionContentItem[] = [];
  for (const raw of rawItems) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (!nonEmpty(r.itemId) || !nonEmpty(r.stem) || !Array.isArray(r.options)) {
      continue;
    }
    const options: AssessmentRevisionContentOption[] = [];
    for (const rawOpt of r.options) {
      if (rawOpt === null || typeof rawOpt !== "object") continue;
      const o = rawOpt as Record<string, unknown>;
      if (!nonEmpty(o.optionId) || !nonEmpty(o.text)) continue;
      options.push({ optionId: o.optionId, text: o.text });
    }
    if (options.length === 0) continue;
    items.push({ itemId: r.itemId, stem: r.stem, options });
  }
  return { revisionId, items };
}

// The single assessment revision shared by every counted attempt, or null
// when any attempt lacks one or the attempts span more than one revision.
// Question text is shown only when this is non-null, so text from one
// revision is never paired with responses to another.
export function sharedAssessmentRevisionId(
  attempts: ReadonlyArray<TeacherVisibleAttempt>,
): string | null {
  let shared: string | null = null;
  for (const attempt of attempts) {
    const id = attempt.assessmentRevisionId;
    if (typeof id !== "string" || id.length === 0) return null;
    if (shared === null) shared = id;
    else if (shared !== id) return null;
  }
  return shared;
}

export type QuestionChoiceDetail = {
  readonly optionId: string;
  // Option text from the paired revision, or null when unavailable.
  readonly text: string | null;
  readonly chosenCount: number;
  readonly chosenPercentage: number;
  readonly isCorrect: boolean;
};

export type QuestionDetail = {
  // Question stem from the paired revision, or null when unavailable.
  readonly stem: string | null;
  readonly choices: ReadonlyArray<QuestionChoiceDetail>;
  // Counted attempts that recorded no answer for this question.
  readonly noAnswerCount: number;
  readonly noAnswerPercentage: number;
};

const percentOf = (count: number, total: number): number =>
  total === 0 ? 0 : Math.round((count / total) * 1000) / 10;

// Combine one question's aggregate with its revision item. The revision
// item is used only when it is consistent with the recorded results (it
// offers the correct option and every chosen option); otherwise the detail
// keeps option ids and statistics only. Choices follow authored option
// order when text is available, else option-id order.
export function buildQuestionDetail(
  question: QuestionSummary,
  content: AssessmentRevisionContent | null,
): QuestionDetail {
  const counts = new Map<string, number>();
  for (const opt of question.options) counts.set(opt.optionId, opt.chosenCount);
  let answered = 0;
  for (const opt of question.options) answered += opt.chosenCount;
  const noAnswerCount = Math.max(0, question.totalResponses - answered);

  const item =
    content === null
      ? undefined
      : content.items.find((i) => i.itemId === question.itemId);
  const itemIds = new Set(item?.options.map((o) => o.optionId) ?? []);
  const consistent =
    item !== undefined &&
    itemIds.has(question.correctOptionId) &&
    question.options.every((o) => itemIds.has(o.optionId));

  const ids: string[] = [];
  if (consistent) {
    for (const o of item!.options) ids.push(o.optionId);
  } else {
    const set = new Set<string>(counts.keys());
    if (question.correctOptionId.length > 0) set.add(question.correctOptionId);
    ids.push(...Array.from(set).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  const textById = new Map<string, string>(
    consistent ? item!.options.map((o) => [o.optionId, o.text]) : [],
  );
  const choices: QuestionChoiceDetail[] = ids.map((optionId) => {
    const chosenCount = counts.get(optionId) ?? 0;
    return {
      optionId,
      text: textById.get(optionId) ?? null,
      chosenCount,
      chosenPercentage: percentOf(chosenCount, question.totalResponses),
      isCorrect: optionId === question.correctOptionId,
    };
  });
  return {
    stem: consistent ? item!.stem : null,
    choices,
    noAnswerCount,
    noAnswerPercentage: percentOf(noAnswerCount, question.totalResponses),
  };
}

// Question results analytics: numbered attempt cohorts. Attempt N is the
// set of completed attempts whose canonical, server-assigned
// `attemptNumber` equals N (one per student by construction: the attempt
// id encodes student and number). Its denominator is the students who
// completed attempt N; cohorts are never combined and no best or latest
// attempt is chosen. Ordinals are positive integers sorted ascending; only
// ordinals that actually occur are returned.
export type AttemptCohortMember = {
  readonly attemptId: string;
  readonly studentId: string;
  readonly attemptNumber: number;
};

export function groupAttemptCohorts<T extends AttemptCohortMember>(
  attempts: ReadonlyArray<T>,
): ReadonlyMap<number, ReadonlyArray<T>> {
  const byOrdinal = new Map<number, Map<string, T>>();
  for (const attempt of attempts) {
    const n = attempt.attemptNumber;
    if (!Number.isInteger(n) || n < 1) continue;
    let cohort = byOrdinal.get(n);
    if (cohort === undefined) {
      cohort = new Map<string, T>();
      byOrdinal.set(n, cohort);
    }
    // Defensive: a second record for the same student and number cannot
    // exist by construction; if one ever did, the lower attemptId is kept
    // deterministically so a student is still counted once.
    const existing = cohort.get(attempt.studentId);
    if (existing === undefined || attempt.attemptId < existing.attemptId) {
      cohort.set(attempt.studentId, attempt);
    }
  }
  const ordinals = Array.from(byOrdinal.keys()).sort((a, b) => a - b);
  const out = new Map<number, ReadonlyArray<T>>();
  for (const n of ordinals) out.set(n, Array.from(byOrdinal.get(n)!.values()));
  return out;
}
