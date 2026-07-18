import type { AssignmentRecipient } from "./roster-wire";

// Sprint 15 Slice 5: pure roster-grouping helpers for the Assignment
// Detail surface. Every group is derived mechanically from a
// deterministic pair `(recipients, completedAttempts)` per Sprint 14
// §4.4. There is no inference and no fourth state.

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
};

export type NamedRow = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

export type RosterGrouping = {
  readonly submitted: ReadonlyArray<SubmittedRow>;
  readonly inProgress: ReadonlyArray<NamedRow>;
  readonly notStarted: ReadonlyArray<NamedRow>;
};

const compareByName = (
  a: { studentDisplayName: string; studentId: string },
  b: { studentDisplayName: string; studentId: string },
): number => {
  const byName = a.studentDisplayName.localeCompare(
    b.studentDisplayName,
    undefined,
    { sensitivity: "base" },
  );
  if (byName !== 0) return byName;
  return a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0;
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

// Build the three-way grouping. `inProgressStudentCount` is the summary
// value; the exact studentIds of in-progress students are not enumerated
// server-side (session presence is a summary derivation), so the
// remaining recipients are split into `inProgress` (arithmetic) and
// `notStarted`. When the arithmetic yields a negative or ambiguous
// value the group is treated as `notStarted` to avoid silently naming a
// student the summary did not authorize.
export function groupRoster(input: {
  readonly recipients: ReadonlyArray<AssignmentRecipient>;
  readonly completed: ReadonlyArray<CompletedAttemptForRoster>;
  readonly inProgressStudentCount: number;
}): RosterGrouping {
  const rep = selectRepresentativeAttempts(input.completed);
  const submittedRows: SubmittedRow[] = [];
  const remaining: AssignmentRecipient[] = [];
  for (const recipient of input.recipients) {
    const attempt = rep.get(recipient.studentId);
    if (attempt !== undefined) {
      submittedRows.push({
        studentId: recipient.studentId,
        studentDisplayName: recipient.studentDisplayName,
        percentage: attempt.percentage,
      });
    } else {
      remaining.push(recipient);
    }
  }
  submittedRows.sort(compareByName);
  remaining.sort(compareByName);
  const inProgressCount = Math.max(
    0,
    Math.min(input.inProgressStudentCount, remaining.length),
  );
  const inProgress = remaining.slice(0, inProgressCount);
  const notStarted = remaining.slice(inProgressCount);
  return {
    submitted: submittedRows,
    inProgress,
    notStarted,
  };
}
