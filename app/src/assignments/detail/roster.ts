import type { AssignmentRecipient } from "./roster-wire";
import {
  compareRosterNames,
  DEFAULT_ROSTER_SORT_ORDER,
  type RosterSortOrder,
} from "../../teacherPreferences/rosterSort";

// Sprint 15 Slice 5: pure roster-grouping helpers for the Assignment
// Detail surface. Every group is derived mechanically from a
// deterministic triple `(recipients, completedAttempts, liveProgress)`,
// matched by studentId. There is no inference and no fourth state.

export type CompletedAttemptForRoster = {
  readonly studentId: string;
  readonly percentage: number;
  readonly attemptNumber: number;
  readonly submittedAt: number;
};

export type SubmittedRow = {
  readonly studentId: string;
  readonly studentDisplayName: string;
  readonly percentage: number;
  // Completed attempts by this student on this assignment (the same
  // attempt set the representative percentage is selected from).
  readonly attemptCount: number;
  // Present when the student has a Live retake session, e.g.
  // "Retake In Progress · 4/10". The score above stays the best attempt.
  readonly retakeStatus?: string;
};

export type NamedRow = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

export type InProgressRow = NamedRow & {
  // "Started · 0/10", "In Progress · 4/10", or "Ready to Submit · 10/10".
  readonly status: string;
};

export type RosterGrouping = {
  readonly submitted: ReadonlyArray<SubmittedRow>;
  readonly inProgress: ReadonlyArray<InProgressRow>;
  readonly notStarted: ReadonlyArray<NamedRow>;
};

// Representative attempt selection per PDR-029a: the highest-percentage
// completed attempt per student wins; ties broken by most recent
// submission, then by highest attemptNumber, then by studentId.
export function selectRepresentativeAttempts(
  completed: ReadonlyArray<CompletedAttemptForRoster>,
): Map<string, CompletedAttemptForRoster> {
  const byStudent = new Map<string, CompletedAttemptForRoster>();
  for (const attempt of completed) {
    const existing = byStudent.get(attempt.studentId);
    if (existing === undefined) {
      byStudent.set(attempt.studentId, attempt);
      continue;
    }
    if (attempt.percentage > existing.percentage) {
      byStudent.set(attempt.studentId, attempt);
      continue;
    }
    if (attempt.percentage === existing.percentage) {
      if (attempt.submittedAt > existing.submittedAt) {
        byStudent.set(attempt.studentId, attempt);
        continue;
      }
      if (
        attempt.submittedAt === existing.submittedAt &&
        attempt.attemptNumber > existing.attemptNumber
      ) {
        byStudent.set(attempt.studentId, attempt);
      }
    }
  }
  return byStudent;
}

// Quiz progress visibility: the unsubmitted progress the server reports for
// one Live session (counts only; see AssignmentStudentProgress).
export type RosterProgress = {
  readonly studentId: string;
  readonly answered: number;
  readonly total: number | null;
  readonly retake: boolean;
};

// Teacher-facing status text for a Live session. `total` comes from the
// assignment's frozen assessment; it is never assumed.
export function formatProgressStatus(progress: {
  readonly answered: number;
  readonly total: number | null;
  readonly retake: boolean;
}): string {
  const { answered, total } = progress;
  const count = total === null ? `${answered} answered` : `${answered}/${total}`;
  if (progress.retake) return `Retake In Progress · ${count}`;
  if (answered === 0) return total === null ? "Started" : `Started · ${count}`;
  if (total !== null && answered >= total) return `Ready to Submit · ${count}`;
  return `In Progress · ${count}`;
}

// Build the three-way grouping from actual per-student state, matched by
// studentId (never by name order or arithmetic):
//   - Submitted: the student has a completed attempt (representative score
//     unchanged). A Live retake session adds `retakeStatus` beside it.
//   - In progress: no completed attempt and a Live session; the row carries
//     its answered/total status.
//   - Not started: neither.
export function groupRoster(input: {
  readonly recipients: ReadonlyArray<AssignmentRecipient>;
  readonly completed: ReadonlyArray<CompletedAttemptForRoster>;
  readonly progress: ReadonlyArray<RosterProgress>;
  // Display order for every group (the teacher's roster sort preference).
  readonly sortOrder?: RosterSortOrder;
}): RosterGrouping {
  const rep = selectRepresentativeAttempts(input.completed);
  const attemptCounts = new Map<string, number>();
  for (const attempt of input.completed) {
    attemptCounts.set(
      attempt.studentId,
      (attemptCounts.get(attempt.studentId) ?? 0) + 1,
    );
  }
  const progressByStudent = new Map<string, RosterProgress>();
  for (const row of input.progress) progressByStudent.set(row.studentId, row);

  const submittedRows: SubmittedRow[] = [];
  const inProgress: InProgressRow[] = [];
  const notStarted: NamedRow[] = [];
  for (const recipient of input.recipients) {
    const attempt = rep.get(recipient.studentId);
    const progress = progressByStudent.get(recipient.studentId);
    if (attempt !== undefined) {
      submittedRows.push({
        studentId: recipient.studentId,
        studentDisplayName: recipient.studentDisplayName,
        percentage: attempt.percentage,
        attemptCount: attemptCounts.get(recipient.studentId) ?? 0,
        ...(progress === undefined
          ? {}
          : { retakeStatus: formatProgressStatus({ ...progress, retake: true }) }),
      });
    } else if (progress !== undefined) {
      inProgress.push({
        studentId: recipient.studentId,
        studentDisplayName: recipient.studentDisplayName,
        status: formatProgressStatus({ ...progress, retake: false }),
      });
    } else {
      notStarted.push({
        studentId: recipient.studentId,
        studentDisplayName: recipient.studentDisplayName,
      });
    }
  }
  const byPreference = compareRosterNames(
    input.sortOrder ?? DEFAULT_ROSTER_SORT_ORDER,
  );
  return {
    submitted: submittedRows.sort(byPreference),
    inProgress: inProgress.sort(byPreference),
    notStarted: notStarted.sort(byPreference),
  };
}
