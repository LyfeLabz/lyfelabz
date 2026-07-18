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
