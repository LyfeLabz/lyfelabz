import type { TeacherVisibleAttempt } from "../../assignments/detail/attempts-wire";
import {
  aggregatePerQuestion,
  buildQuestionDetail,
  type AssessmentRevisionContent,
} from "../../assignments/detail/question-summary";

// Student Detail repeatedly missed questions (Student Support Workspace V2
// P4). For one Student Detail card, the questions the student missed on at
// least two of the card's attempts, computed only from frozen attempt
// records already read for the card's answer review.
//
// Question identity is (assessmentRevisionId, itemId). An itemId such as
// "q1" means nothing outside its revision, so every count is kept per
// revision and never merged across revisions. Attempts without a revision
// id are left out entirely; revision identity is never guessed from dates,
// titles, positions or assignment ids.
//
// Correctness is the frozen `isCorrect` on each item result. Finalize
// scores an unanswered item as incorrect, so it counts as a miss here too.
// An item absent from an attempt (or without a boolean correctness) is not
// counted for that attempt at all: neither as a miss nor in the
// denominator.
//
// Adapted deliveries are scored against the same canonical revision and
// answer key, so they share item identity with standard attempts and are
// counted with them. Question wording is shown only from the revision text
// as consistency-checked against a STANDARD attempt of the same revision;
// with no standard attempt, only "Question N" is shown, so adapted wording
// is never presented as the canonical question and canonical wording is
// never presented as what an adapted-only student saw.

export const REPEATED_MISS_THRESHOLD = 2;

export type RepeatedMissQuestion = {
  readonly itemId: string;
  // 1-based position in the revision's frozen item order (the same
  // "Question N" the answer review shows), or null when the attempts
  // disagree about it.
  readonly number: number | null;
  readonly stem: string | null;
  readonly missed: number;
  // Eligible attempts of this revision where the item was present with a
  // determinable result.
  readonly of: number;
};

export type RepeatedMissGroup = {
  readonly revisionId: string;
  // 1 = the revision first used by the card's earliest analyzed attempt.
  readonly version: number;
  readonly attempts: number;
  readonly questions: ReadonlyArray<RepeatedMissQuestion>;
};

export type RepeatedMissAnalysis = {
  // Only revisions with at least one repeatedly missed question.
  readonly groups: ReadonlyArray<RepeatedMissGroup>;
  // Distinct revisions among eligible attempts.
  readonly revisionCount: number;
  // True when at least one revision has two or more eligible attempts, so
  // a repeated miss could have been found.
  readonly comparable: boolean;
  // Attempts left out because they carry no usable revision id.
  readonly excludedAttempts: number;
};

// `attempts` must be in chronological order (oldest first); duplicates of
// an attemptId are counted once.
export function findRepeatedMisses(
  attempts: ReadonlyArray<TeacherVisibleAttempt>,
  contents: ReadonlyMap<string, AssessmentRevisionContent | null>,
): RepeatedMissAnalysis {
  const seen = new Set<string>();
  const byRevision = new Map<string, TeacherVisibleAttempt[]>();
  let excludedAttempts = 0;
  for (const attempt of attempts) {
    if (seen.has(attempt.attemptId)) continue;
    seen.add(attempt.attemptId);
    const revisionId = attempt.assessmentRevisionId;
    if (typeof revisionId !== "string" || revisionId.length === 0) {
      excludedAttempts += 1;
      continue;
    }
    const bucket = byRevision.get(revisionId);
    if (bucket !== undefined) bucket.push(attempt);
    else byRevision.set(revisionId, [attempt]);
  }

  const groups: RepeatedMissGroup[] = [];
  let comparable = false;
  let version = 0;
  for (const [revisionId, revisionAttempts] of byRevision) {
    version += 1;
    if (revisionAttempts.length >= REPEATED_MISS_THRESHOLD) comparable = true;
    const questions = repeatedMissesInRevision(revisionAttempts, contents.get(revisionId) ?? null, revisionId);
    if (questions.length > 0) {
      groups.push({ revisionId, version, attempts: revisionAttempts.length, questions });
    }
  }
  return { groups, revisionCount: byRevision.size, comparable, excludedAttempts };
}

function repeatedMissesInRevision(
  attempts: ReadonlyArray<TeacherVisibleAttempt>,
  content: AssessmentRevisionContent | null,
  revisionId: string,
): RepeatedMissQuestion[] {
  const order: string[] = [];
  const tally = new Map<string, { missed: number; of: number; positions: Set<number> }>();
  for (const attempt of attempts) {
    const counted = new Set<string>();
    attempt.itemResults.forEach((item, index) => {
      if (typeof item.isCorrect !== "boolean" || counted.has(item.itemId)) return;
      counted.add(item.itemId);
      let entry = tally.get(item.itemId);
      if (entry === undefined) {
        entry = { missed: 0, of: 0, positions: new Set<number>() };
        tally.set(item.itemId, entry);
        order.push(item.itemId);
      }
      entry.of += 1;
      if (!item.isCorrect) entry.missed += 1;
      entry.positions.add(index + 1);
    });
  }

  const pairedContent = content !== null && content.revisionId === revisionId ? content : null;
  const standard = attempts.filter((a) => a.canonicalContent !== false);
  const out: RepeatedMissQuestion[] = [];
  for (const itemId of order) {
    const entry = tally.get(itemId)!;
    if (entry.missed < REPEATED_MISS_THRESHOLD) continue;
    out.push({
      itemId,
      number: entry.positions.size === 1 ? Array.from(entry.positions)[0]! : null,
      stem: standardStem(itemId, standard, pairedContent),
      missed: entry.missed,
      of: entry.of,
    });
  }
  return out.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity));
}

// Revision wording for one item, only when a standard attempt of the same
// revision answered it and the revision text is consistent with every
// standard response (the same check the answer review uses).
function standardStem(
  itemId: string,
  standard: ReadonlyArray<TeacherVisibleAttempt>,
  content: AssessmentRevisionContent | null,
): string | null {
  if (content === null) return null;
  const withItem = standard
    .map((a) => ({ ...a, itemResults: a.itemResults.filter((r) => r.itemId === itemId) }))
    .filter((a) => a.itemResults.length > 0);
  if (withItem.length === 0) return null;
  const summary = aggregatePerQuestion(withItem).questions[0];
  return summary === undefined ? null : buildQuestionDetail(summary, content).stem;
}

// The compact section shown at the top of a card's answer review.
export function renderRepeatedMisses(
  doc: Document,
  host: HTMLElement,
  analysis: RepeatedMissAnalysis,
  partial: { readonly analyzed: number; readonly total: number },
): void {
  host.replaceChildren();
  host.setAttribute("data-state", "ready");
  const muted = (text: string, testid: string): void => {
    const p = doc.createElement("p");
    p.className = "shell-student-detail-thinking-muted";
    p.setAttribute("data-testid", testid);
    p.textContent = text;
    host.appendChild(p);
  };
  const appendScope = (): void => {
    if (partial.analyzed < partial.total) {
      muted(`Based on the ${partial.analyzed} most recent attempts.`, "student-detail-repeat-scope");
    }
  };

  if (analysis.groups.length === 0) {
    // One quiet line, never a large empty section. "Not comparable" never
    // reads as mastery.
    if (analysis.comparable) muted("No question was missed more than once.", "student-detail-repeat-none");
    else muted("These attempts can't be compared question by question.", "student-detail-repeat-unavailable");
    appendScope();
    return;
  }

  const label = doc.createElement("p");
  label.className = "shell-student-detail-thinking-label";
  label.textContent = "Missed more than once";
  host.appendChild(label);

  const multi = analysis.revisionCount > 1;
  if (multi) {
    muted("This quiz changed between attempts, so each version is counted separately.", "student-detail-repeat-versions");
  }
  for (const group of analysis.groups) {
    if (multi) {
      const version = doc.createElement("p");
      version.className = "shell-student-detail-repeat-version";
      version.setAttribute("data-testid", "student-detail-repeat-version");
      version.textContent = `Version ${group.version}`;
      host.appendChild(version);
    }
    const list = doc.createElement("ul");
    list.className = "shell-student-detail-repeat-list";
    list.setAttribute("data-testid", "student-detail-repeat-list");
    for (const q of group.questions) {
      const li = doc.createElement("li");
      li.className = "shell-student-detail-repeat-item";
      li.setAttribute("data-testid", "student-detail-repeat-item");
      li.setAttribute("data-item-id", q.itemId);
      const head = doc.createElement("p");
      head.className = "shell-student-detail-review-head";
      const number = doc.createElement("span");
      number.className = "shell-student-detail-review-number";
      number.setAttribute("data-testid", "student-detail-repeat-number");
      number.textContent = q.number === null ? "Question" : `Question ${q.number}`;
      const count = doc.createElement("span");
      count.className = "shell-student-detail-review-status";
      count.setAttribute("data-testid", "student-detail-repeat-count");
      count.textContent = `Missed ${q.missed} of ${q.of} attempts`;
      head.append(number, count);
      li.appendChild(head);
      if (q.stem !== null) {
        const stem = doc.createElement("p");
        stem.className = "shell-student-detail-review-stem";
        stem.setAttribute("data-testid", "student-detail-repeat-stem");
        stem.textContent = q.stem;
        li.appendChild(stem);
      }
      list.appendChild(li);
    }
    host.appendChild(list);
  }
  appendScope();
}
