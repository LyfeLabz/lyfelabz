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

// Student Detail question review (PDR-032e, STUDENT_SUPPORT_ACCESS.md
// section 8). One shared review for class owners and support educators: a
// "Review questions" disclosure on each Student Detail card that has
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

  const missed = review.questions.filter((q) => q.status !== "correct");
  if (missed.length > 0) {
    const missedEl = doc.createElement("p");
    missedEl.className = "shell-student-detail-review-missed";
    missedEl.setAttribute("data-testid", "student-detail-review-missed");
    missedEl.textContent = `To review: ${missed.map((q) => `Q${q.number}`).join(", ")}`;
    host.appendChild(missedEl);
  }

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

// Appends the "Review questions" disclosure to a Student Detail card. Attempts
// are listed oldest first with the same "Attempt N" numbering Show Your
// Thinking uses (position in the card's chronological order); the latest
// attempt is shown first. Each attempt's detail and revision text are read
// only when that attempt is opened, and cached for this render.
export function appendQuestionReview(
  doc: Document,
  card: HTMLElement,
  attempts: ReadonlyArray<CompletedAttemptSummary>,
  attemptDetail: AttemptGetForTeacherCallable | null,
  revisionContent: AssessmentRevisionContentReader | null,
  formatDate: (ms: number) => string,
): void {
  if (attemptDetail === null || attempts.length === 0) return;
  const ordered = [...attempts].sort(
    (a, b) =>
      a.submittedAt - b.submittedAt ||
      a.attemptNumber - b.attemptNumber ||
      a.attemptId.localeCompare(b.attemptId),
  );
  const cardKey = card.getAttribute("data-assignment-id") ?? "";
  const panelId = `student-detail-review-${cardKey}`;

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "shell-student-detail-review-toggle";
  toggle.setAttribute("data-testid", "student-detail-review-toggle");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  toggle.textContent = "Review questions";
  card.appendChild(toggle);

  const panel = doc.createElement("div");
  panel.className = "shell-student-detail-review";
  panel.id = panelId;
  panel.setAttribute("data-testid", "student-detail-review");
  panel.hidden = true;
  card.appendChild(panel);

  const label = (index: number): string => {
    const a = ordered[index]!;
    return `Attempt ${index + 1} · ${Math.round(a.percentage)}% · ${formatDate(a.submittedAt)}`;
  };

  const body = doc.createElement("div");
  body.className = "shell-student-detail-review-body";
  body.setAttribute("aria-live", "polite");

  const details = new Map<string, Promise<TeacherVisibleAttempt>>();
  const contents = new Map<string, Promise<AssessmentRevisionContent | null>>();
  let token = 0;

  const show = (index: number): void => {
    const mine = ++token;
    const attempt = ordered[index]!;
    body.replaceChildren();
    const loading = doc.createElement("p");
    loading.className = "shell-student-detail-thinking-muted";
    loading.setAttribute("data-testid", "student-detail-review-loading");
    loading.setAttribute("role", "status");
    loading.textContent = "Loading question results…";
    body.appendChild(loading);

    let detailPromise = details.get(attempt.attemptId);
    if (detailPromise === undefined) {
      detailPromise = attemptDetail({ attemptId: attempt.attemptId });
      details.set(attempt.attemptId, detailPromise);
      // A failed read is retried on the next open of this attempt.
      detailPromise.catch(() => details.delete(attempt.attemptId));
    }
    void detailPromise
      .then(async (detail) => {
        const revisionId = detail.assessmentRevisionId ?? null;
        let content: AssessmentRevisionContent | null = null;
        if (revisionContent !== null && revisionId !== null && detail.canonicalContent !== false) {
          let contentPromise = contents.get(revisionId);
          if (contentPromise === undefined) {
            contentPromise = revisionContent(revisionId).catch(() => null);
            contents.set(revisionId, contentPromise);
          }
          content = await contentPromise;
        }
        return buildAttemptQuestionReview(detail, content);
      })
      .then(
        (review) => {
          if (mine !== token || !panel.isConnected) return;
          body.replaceChildren();
          renderReview(doc, body, review);
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

  let built = false;
  const build = (): void => {
    built = true;
    const latest = ordered.length - 1;
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
      ordered.forEach((_a, index) => {
        const option = doc.createElement("option");
        option.value = String(index);
        option.textContent = label(index);
        select.appendChild(option);
      });
      select.value = String(latest);
      select.addEventListener("change", () => show(Number(select.value)));
      controls.append(selectLabel, select);
      panel.appendChild(controls);
    } else {
      const only = doc.createElement("p");
      only.className = "shell-student-detail-thinking-label";
      only.setAttribute("data-testid", "student-detail-review-attempt-label");
      only.textContent = label(0);
      panel.appendChild(only);
    }
    panel.appendChild(body);
    show(latest);
  };

  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    if (open && !built) build();
    else if (open && body.querySelector("[data-testid=student-detail-review-error]") !== null) {
      const select = panel.querySelector<HTMLSelectElement>("select");
      show(select === null ? ordered.length - 1 : Number(select.value));
    }
  });
}
