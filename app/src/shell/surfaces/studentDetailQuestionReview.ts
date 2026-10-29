import type {
  AttemptGetForTeacherCallable,
  CompletedAttemptSummary,
  TeacherVisibleAttempt,
} from "../../assignments/detail/attempts-wire";
import {
  aggregatePerQuestion,
  buildQuestionDetail,
  type AssessmentRevisionContent,
  type AssessmentRevisionContentReader,
} from "../../assignments/detail/question-summary";
import { findRepeatedMisses, renderRepeatedMisses } from "./studentDetailRepeatedMisses";

// Student Detail question review (PDR-032e, STUDENT_SUPPORT_ACCESS.md
// section 8). One shared review for class owners and support educators: a
// "Review answers" disclosure on each Student Detail card that has
// attempts, showing ONE attempt at a time (any attempt, not just the best),
// question by question.
//
// Every fact comes from frozen records: correctness, the student's option,
// the correct option and the explanation from the immutable attempt
// (`assessmentAttemptGetForTeacher`), and question/choice text from the
// immutable assessment revision that attempt was scored against. Text is
// paired through the same `buildQuestionDetail` consistency check the
// Assignment Detail question results use, so text from one revision is never
// shown with responses to another. An attempt delivered with an adapted
// presentation (`canonicalContent: false`) shows results without question or
// choice text, because the canonical wording is not what that student saw.

export type ReviewAnswer = {
  readonly optionId: string;
  readonly text: string | null;
};

export type ReviewQuestion = {
  readonly number: number;
  readonly itemId: string;
  readonly stem: string | null;
  readonly status: "correct" | "incorrect" | "unanswered";
  // Null when the student left it unanswered, or when choice identities are
  // withheld for an adapted delivery.
  readonly studentAnswer: ReviewAnswer | null;
  readonly correctAnswer: ReviewAnswer | null;
  readonly explanation: string | null;
};

export type AttemptQuestionReview = {
  readonly questions: ReadonlyArray<ReviewQuestion>;
  readonly correctCount: number;
  // "full": question and choice text shown. "noText": the revision text was
  // unavailable or inconsistent, so option ids are shown without text.
  // "resultsOnly": adapted delivery, so no wording or choice ids are shown.
  readonly mode: "full" | "noText" | "resultsOnly";
};

export function buildAttemptQuestionReview(
  attempt: TeacherVisibleAttempt,
  content: AssessmentRevisionContent | null,
): AttemptQuestionReview {
  const resultsOnly = attempt.canonicalContent === false;
  const paired =
    !resultsOnly &&
    content !== null &&
    typeof attempt.assessmentRevisionId === "string" &&
    content.revisionId === attempt.assessmentRevisionId
      ? content
      : null;
  // A one-attempt aggregate yields the attempt's own question order and,
  // through `buildQuestionDetail`, the consistency-checked stem and choices.
  const summaries = aggregatePerQuestion([attempt]).questions;
  const byItem = new Map(attempt.itemResults.map((r) => [r.itemId, r]));
  let anyText = false;
  const questions = summaries.map((summary, index): ReviewQuestion => {
    const item = byItem.get(summary.itemId)!;
    const detail = buildQuestionDetail(summary, paired);
    if (detail.stem !== null) anyText = true;
    const textOf = (optionId: string): string | null =>
      detail.choices.find((c) => c.optionId === optionId)?.text ?? null;
    const chosen = item.studentResponse;
    const status = chosen === null || chosen.length === 0 ? "unanswered" : item.isCorrect ? "correct" : "incorrect";
    return {
      number: index + 1,
      itemId: summary.itemId,
      stem: resultsOnly ? null : detail.stem,
      status,
      studentAnswer:
        resultsOnly || status === "unanswered" ? null : { optionId: chosen!, text: textOf(chosen!) },
      correctAnswer:
        resultsOnly || item.correctOptionId.length === 0
          ? null
          : { optionId: item.correctOptionId, text: textOf(item.correctOptionId) },
      explanation:
        typeof item.explanation === "string" && item.explanation.trim().length > 0
          ? item.explanation
          : null,
    };
  });
  return {
    questions,
    correctCount: questions.filter((q) => q.status === "correct").length,
    mode: resultsOnly ? "resultsOnly" : anyText ? "full" : "noText",
  };
}

const STATUS_LABEL: Readonly<Record<ReviewQuestion["status"], string>> = {
  correct: "Correct",
  incorrect: "Incorrect",
  unanswered: "No answer",
};

function answerText(answer: ReviewAnswer): string {
  return answer.text === null ? answer.optionId : `${answer.optionId}. ${answer.text}`;
}

function renderReview(
  doc: Document,
  host: HTMLElement,
  review: AttemptQuestionReview,
): void {
  const summary = doc.createElement("p");
  summary.className = "shell-student-detail-review-summary";
  summary.setAttribute("data-testid", "student-detail-review-summary");
  summary.textContent = `${review.correctCount} of ${review.questions.length} correct`;
  host.appendChild(summary);

  if (review.mode !== "full") {
    const note = doc.createElement("p");
    note.className = "shell-student-detail-thinking-muted";
    note.setAttribute("data-testid", "student-detail-review-note");
    note.textContent =
      review.mode === "resultsOnly"
        ? "Question wording isn't shown for this attempt."
        : "Question text is not available for these results.";
    host.appendChild(note);
  }

  const list = doc.createElement("ol");
  list.className = "shell-student-detail-review-list";
  list.setAttribute("data-testid", "student-detail-review-list");
  for (const q of review.questions) {
    const li = doc.createElement("li");
    li.className = `shell-student-detail-review-item shell-student-detail-review-${q.status}`;
    li.setAttribute("data-testid", `student-detail-review-item-${q.number}`);
    li.setAttribute("data-item-id", q.itemId);
    li.setAttribute("data-status", q.status);

    const head = doc.createElement("p");
    head.className = "shell-student-detail-review-head";
    const number = doc.createElement("span");
    number.className = "shell-student-detail-review-number";
    number.textContent = `Question ${q.number}`;
    head.appendChild(number);
    const status = doc.createElement("span");
    status.className = "shell-student-detail-review-status";
    status.setAttribute("data-testid", `student-detail-review-status-${q.number}`);
    status.textContent = STATUS_LABEL[q.status];
    head.appendChild(status);
    li.appendChild(head);

    if (q.stem !== null) {
      const stem = doc.createElement("p");
      stem.className = "shell-student-detail-review-stem";
      stem.setAttribute("data-testid", "student-detail-review-stem");
      stem.textContent = q.stem;
      li.appendChild(stem);
    }

    const answers = doc.createElement("dl");
    answers.className = "shell-student-detail-review-answers";
    const addAnswer = (label: string, value: string, testid: string): void => {
      const dt = doc.createElement("dt");
      dt.textContent = label;
      const dd = doc.createElement("dd");
      dd.setAttribute("data-testid", testid);
      dd.textContent = value;
      answers.append(dt, dd);
    };
    if (review.mode !== "resultsOnly") {
      addAnswer(
        "Student answer",
        q.studentAnswer === null ? "No answer" : answerText(q.studentAnswer),
        "student-detail-review-student-answer",
      );
      if (q.correctAnswer !== null && q.status !== "correct") {
        addAnswer("Correct answer", answerText(q.correctAnswer), "student-detail-review-correct-answer");
      }
    }
    if (q.explanation !== null) {
      addAnswer("Explanation", q.explanation, "student-detail-review-explanation");
    }
    if (answers.childElementCount > 0) li.appendChild(answers);
    list.appendChild(li);
  }
  host.appendChild(list);
}

// "Show incorrect only": a presentation filter over the review already
// rendered for the selected attempt. It hides correct questions (keeping the
// original numbering, answers and explanations of the rest) and never reads
// or scores anything. "Incorrect" means any question not answered
// correctly, including one left unanswered (the same set the action's
// incorrect count covers).
function applyIncorrectOnly(doc: Document, host: HTMLElement, on: boolean): void {
  host.querySelector("[data-testid=student-detail-review-all-correct]")?.remove();
  const items = Array.from(
    host.querySelectorAll<HTMLElement>(".shell-student-detail-review-item"),
  );
  if (items.length === 0) return;
  let shown = 0;
  for (const li of items) {
    const hide = on && li.getAttribute("data-status") === "correct";
    li.hidden = hide;
    if (!hide) shown += 1;
  }
  if (on && shown === 0) {
    const empty = doc.createElement("p");
    empty.className = "shell-student-detail-thinking-muted";
    empty.setAttribute("data-testid", "student-detail-review-all-correct");
    empty.textContent = "Every question in this attempt was answered correctly.";
    host.querySelector("[data-testid=student-detail-review-list]")?.before(empty);
  }
}

// A Student Detail card's attempts in chronological order (oldest first),
// each attemptId once. Order is the frozen submission time; an attempt
// without a usable timestamp sorts before every dated one (it is never
// presented as the latest) and attemptNumber then attemptId break ties, so
// the order is deterministic and no date is ever invented.
const hasUsableTime = (ms: number): boolean => Number.isFinite(ms) && ms > 0;

export function orderAttemptsChronologically(
  attempts: ReadonlyArray<CompletedAttemptSummary>,
): CompletedAttemptSummary[] {
  const seen = new Set<string>();
  const unique = attempts.filter((a) => (seen.has(a.attemptId) ? false : (seen.add(a.attemptId), true)));
  return unique.sort((a, b) => {
    const aTime = hasUsableTime(a.submittedAt);
    const bTime = hasUsableTime(b.submittedAt);
    if (aTime !== bTime) return aTime ? 1 : -1;
    return (
      (aTime ? a.submittedAt - b.submittedAt : 0) ||
      a.attemptNumber - b.attemptNumber ||
      a.attemptId.localeCompare(b.attemptId)
    );
  });
}

// Questions not answered correctly on one attempt, from its frozen summary.
// Every scored item is worth exactly one point (finalize rejects any other
// answer-key value, ASSESSMENT_SCORING_CONTRACT.md section 4.2), so
// maxScore is the item count and maxScore - score counts incorrect plus
// unanswered items: the same set the review marks for review. Null when the
// summary is not a consistent unit-point score, so no count is ever shown
// that the attempt's data does not support.
export function attemptIncorrectCount(attempt: CompletedAttemptSummary): number | null {
  const { score, maxScore } = attempt;
  if (!Number.isInteger(score) || !Number.isInteger(maxScore)) return null;
  if (maxScore <= 0 || score < 0 || score > maxScore) return null;
  return maxScore - score;
}

export function reviewAnswersLabel(attempt: CompletedAttemptSummary): string {
  const incorrect = attemptIncorrectCount(attempt);
  if (incorrect === null) return "Review answers";
  return incorrect === 0 ? "Review answers · all correct" : `Review answers · ${incorrect} incorrect`;
}

// Selector label for the attempt at `index` of a card's chronological list.
// "Latest" and "Previous attempt N" describe this card's attempts only; N
// counts back from the latest (Previous attempt 1 is the attempt just
// before it). Show Your Thinking keeps its own oldest-first "Attempt N".
export function attemptOptionLabel(
  ordered: ReadonlyArray<CompletedAttemptSummary>,
  index: number,
  formatDate: (ms: number) => string,
): string {
  const attempt = ordered[index]!;
  const parts = [
    index === ordered.length - 1 ? "Latest attempt" : `Previous attempt ${ordered.length - 1 - index}`,
    `${Math.round(attempt.percentage)}%`,
  ];
  if (hasUsableTime(attempt.submittedAt)) parts.push(formatDate(attempt.submittedAt));
  return parts.join(" · ");
}

// One read per attempt per Student Detail render, shared by a card's
// disclosures. A failed read is forgotten so the next open retries it.
export function cacheAttemptDetail(read: AttemptGetForTeacherCallable): AttemptGetForTeacherCallable {
  const cache = new Map<string, Promise<TeacherVisibleAttempt>>();
  return (input) => {
    let pending = cache.get(input.attemptId);
    if (pending === undefined) {
      pending = read(input);
      cache.set(input.attemptId, pending);
      pending.catch(() => cache.delete(input.attemptId));
    }
    return pending;
  };
}

// Repeated-miss analysis reads at most this many of a card's most recent
// attempts, at most two at a time, so a student with many retakes never
// causes an unbounded burst of reads.
export const MAX_REPEAT_ANALYSIS_ATTEMPTS = 20;
const REPEAT_ANALYSIS_CONCURRENCY = 2;

async function readBounded<T, R>(
  items: ReadonlyArray<T>,
  read: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      out[index] = await read(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(REPEAT_ANALYSIS_CONCURRENCY, items.length) }, worker),
  );
  return out;
}

// Appends the "Review answers" disclosure to a Student Detail card: a
// primary action carrying the selected attempt's incorrect count, the
// card's repeatedly missed questions (cards with two or more attempts), an
// attempt selector defaulting to the latest attempt, and the per-question
// review filtered to incorrect answers by default. Attempt detail and
// revision text are read only after the teacher opens it, and cached for
// this render.
export function appendQuestionReview(
  doc: Document,
  card: HTMLElement,
  attempts: ReadonlyArray<CompletedAttemptSummary>,
  attemptDetail: AttemptGetForTeacherCallable | null,
  revisionContent: AssessmentRevisionContentReader | null,
  formatDate: (ms: number) => string,
): void {
  if (attemptDetail === null || attempts.length === 0) return;
  const readDetail = cacheAttemptDetail(attemptDetail);
  const ordered = orderAttemptsChronologically(attempts);
  const latest = ordered.length - 1;
  const cardKey = card.getAttribute("data-assignment-id") ?? "";
  const panelId = `student-detail-review-${cardKey}`;

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "shell-btn shell-btn-primary shell-student-detail-review-toggle";
  toggle.setAttribute("data-testid", "student-detail-review-toggle");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  toggle.textContent = reviewAnswersLabel(ordered[latest]!);
  card.appendChild(toggle);

  const panel = doc.createElement("div");
  panel.className = "shell-student-detail-review";
  panel.id = panelId;
  panel.setAttribute("data-testid", "student-detail-review");
  panel.hidden = true;
  card.appendChild(panel);

  const body = doc.createElement("div");
  body.className = "shell-student-detail-review-body";
  body.setAttribute("aria-live", "polite");

  // One filter per card, default ON (incorrect answers first). It stays as
  // the teacher set it when they switch attempts and is re-applied to each
  // newly rendered attempt, so the checkbox always describes what is shown.
  const filterId = `${panelId}-incorrect-only`;
  const filterLabel = doc.createElement("label");
  filterLabel.className = "shell-student-detail-review-filter";
  filterLabel.htmlFor = filterId;
  const filter = doc.createElement("input");
  filter.type = "checkbox";
  filter.id = filterId;
  filter.checked = true;
  filter.setAttribute("data-testid", "student-detail-review-incorrect-only");
  filterLabel.append(filter, doc.createTextNode(" Show incorrect only"));
  filter.addEventListener("change", () => applyIncorrectOnly(doc, body, filter.checked));

  const contents = new Map<string, Promise<AssessmentRevisionContent | null>>();
  const contentFor = (revisionId: string): Promise<AssessmentRevisionContent | null> => {
    if (revisionContent === null) return Promise.resolve(null);
    let pending = contents.get(revisionId);
    if (pending === undefined) {
      pending = revisionContent(revisionId).catch(() => null);
      contents.set(revisionId, pending);
    }
    return pending;
  };
  let token = 0;

  const show = (index: number): void => {
    const mine = ++token;
    const attempt = ordered[index]!;
    toggle.textContent = reviewAnswersLabel(attempt);
    body.replaceChildren();
    const loading = doc.createElement("p");
    loading.className = "shell-student-detail-thinking-muted";
    loading.setAttribute("data-testid", "student-detail-review-loading");
    loading.setAttribute("role", "status");
    loading.textContent = "Loading question results…";
    body.appendChild(loading);

    void readDetail({ attemptId: attempt.attemptId })
      .then(async (detail) => {
        const revisionId = detail.assessmentRevisionId ?? null;
        const content =
          revisionId !== null && detail.canonicalContent !== false ? await contentFor(revisionId) : null;
        return buildAttemptQuestionReview(detail, content);
      })
      .then(
        (review) => {
          if (mine !== token || !panel.isConnected) return;
          body.replaceChildren();
          renderReview(doc, body, review);
          applyIncorrectOnly(doc, body, filter.checked);
        },
        () => {
          if (mine !== token || !panel.isConnected) return;
          body.replaceChildren();
          const err = doc.createElement("p");
          err.className = "shell-student-detail-thinking-muted";
          err.setAttribute("data-testid", "student-detail-review-error");
          err.textContent = "We couldn't load question results. Close and reopen to try again.";
          body.appendChild(err);
        },
      );
  };

  // Repeatedly missed questions over this card's attempts. Reads the most
  // recent attempts newest first (the selected latest attempt is already
  // cached), then revision text only for revisions that have a repeat.
  const repeat = ordered.length >= 2 ? doc.createElement("div") : null;
  const analyze = (): void => {
    if (repeat === null) return;
    repeat.setAttribute("data-state", "loading");
    repeat.replaceChildren();
    const loading = doc.createElement("p");
    loading.className = "shell-student-detail-thinking-muted";
    loading.setAttribute("role", "status");
    loading.textContent = "Checking for repeated misses…";
    repeat.appendChild(loading);
    const recent = ordered.slice(-MAX_REPEAT_ANALYSIS_ATTEMPTS);
    void readBounded([...recent].reverse(), (a) => readDetail({ attemptId: a.attemptId }))
      .then(async (newestFirst) => {
        const details = newestFirst.reverse();
        const revisions = new Set(findRepeatedMisses(details, new Map()).groups.map((g) => g.revisionId));
        const texts = new Map<string, AssessmentRevisionContent | null>();
        for (const revisionId of revisions) texts.set(revisionId, await contentFor(revisionId));
        return findRepeatedMisses(details, texts);
      })
      .then(
        (analysis) => {
          if (!panel.isConnected) return;
          renderRepeatedMisses(doc, repeat, analysis, { analyzed: recent.length, total: ordered.length });
        },
        () => {
          if (!panel.isConnected) return;
          repeat.setAttribute("data-state", "error");
          repeat.replaceChildren();
          const err = doc.createElement("p");
          err.className = "shell-student-detail-thinking-muted";
          err.setAttribute("data-testid", "student-detail-repeat-error");
          err.textContent = "We couldn't check for repeated misses. Close and reopen to try again.";
          repeat.appendChild(err);
        },
      );
  };

  let built = false;
  const build = (): void => {
    built = true;
    if (repeat !== null) {
      repeat.className = "shell-student-detail-repeat";
      repeat.setAttribute("data-testid", "student-detail-repeat");
      repeat.setAttribute("aria-live", "polite");
      panel.appendChild(repeat);
    }
    if (ordered.length > 1) {
      const controls = doc.createElement("div");
      controls.className = "shell-student-detail-review-attempt";
      const selectId = `${panelId}-attempt`;
      const selectLabel = doc.createElement("label");
      selectLabel.htmlFor = selectId;
      selectLabel.textContent = "Attempt";
      const select = doc.createElement("select");
      select.id = selectId;
      select.className = "shell-student-detail-review-select";
      select.setAttribute("data-testid", "student-detail-review-select");
      // Latest first; each option's value is its chronological index.
      for (let index = latest; index >= 0; index -= 1) {
        const option = doc.createElement("option");
        option.value = String(index);
        option.textContent = attemptOptionLabel(ordered, index, formatDate);
        select.appendChild(option);
      }
      select.value = String(latest);
      select.addEventListener("change", () => show(Number(select.value)));
      controls.append(selectLabel, select);
      panel.appendChild(controls);
    } else {
      const only = doc.createElement("p");
      only.className = "shell-student-detail-thinking-label";
      only.setAttribute("data-testid", "student-detail-review-attempt-label");
      only.textContent = attemptOptionLabel(ordered, 0, formatDate);
      panel.appendChild(only);
    }
    panel.appendChild(filterLabel);
    panel.appendChild(body);
    show(latest);
    analyze();
  };

  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    if (open && !built) build();
    else if (open) {
      if (body.querySelector("[data-testid=student-detail-review-error]") !== null) {
        const select = panel.querySelector<HTMLSelectElement>("select");
        show(select === null ? latest : Number(select.value));
      }
      if (repeat?.getAttribute("data-state") === "error") analyze();
    }
  });
}
