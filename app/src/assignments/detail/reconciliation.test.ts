import {
  DISCREPANCY_NOTE_COPY,
  reconcileCounts,
  shouldDisplayDiscrepancyNote,
} from "./reconciliation";
import type { AssignmentSummary } from "../summary/types";

const freezeSummary = (
  overrides: Partial<AssignmentSummary> = {},
): AssignmentSummary =>
  Object.freeze({
    assignmentId: "assign-1",
    classId: "class-1",
    totalStudents: 3,
    completedStudents: 1,
    inProgressStudents: 1,
    notStartedStudents: 1,
    completionPercentage: 33,
    averagePercentage: 80,
    highestPercentage: 90,
    lowestPercentage: 70,
    perfectScoreStudents: 0,
    ...overrides,
  });

describe("reconcileCounts", () => {
  test("aligned when recipient total, submitted, and started all match summary", () => {
    const result = reconcileCounts({
      summary: freezeSummary(),
      recipientsCount: 3,
      submittedCount: 1,
      inProgressCount: 1,
    });
    expect(result.kind).toBe("aligned");
    expect(shouldDisplayDiscrepancyNote(result)).toBe(false);
  });

  test("empty when the summary has zero recipients and no recipients enumerated", () => {
    const result = reconcileCounts({
      summary: freezeSummary({
        totalStudents: 0,
        completedStudents: 0,
        inProgressStudents: 0,
        notStartedStudents: 0,
      }),
      recipientsCount: 0,
      submittedCount: 0,
      inProgressCount: 0,
    });
    expect(result.kind).toBe("empty");
    expect(shouldDisplayDiscrepancyNote(result)).toBe(false);
  });

  test("recipientTotalMismatch when enumerated recipients differ from summary total", () => {
    const result = reconcileCounts({
      summary: freezeSummary({ totalStudents: 4 }),
      recipientsCount: 3,
      submittedCount: 1,
      inProgressCount: 1,
    });
    expect(result.kind).toBe("recipientTotalMismatch");
    expect(shouldDisplayDiscrepancyNote(result)).toBe(true);
  });

  test("submittedMismatch when representative-submitted count differs from summary", () => {
    const result = reconcileCounts({
      summary: freezeSummary({
        totalStudents: 3,
        completedStudents: 2,
        inProgressStudents: 1,
        notStartedStudents: 0,
      }),
      recipientsCount: 3,
      submittedCount: 1,
      inProgressCount: 1,
    });
    expect(result.kind).toBe("submittedMismatch");
    expect(shouldDisplayDiscrepancyNote(result)).toBe(true);
  });

  test("startedMismatch when roster-derived started total differs from summary started total", () => {
    const result = reconcileCounts({
      summary: freezeSummary({
        totalStudents: 3,
        completedStudents: 1,
        inProgressStudents: 2,
        notStartedStudents: 0,
      }),
      recipientsCount: 3,
      submittedCount: 1,
      inProgressCount: 1,
    });
    expect(result.kind).toBe("startedMismatch");
    expect(shouldDisplayDiscrepancyNote(result)).toBe(true);
  });

  test("unavailable when the caller cannot supply comparison inputs", () => {
    const result = reconcileCounts(null);
    expect(result.kind).toBe("unavailable");
    expect(shouldDisplayDiscrepancyNote(result)).toBe(false);
  });

  test("recipient mismatch is reported ahead of submitted or started mismatches", () => {
    // A single ordering rule makes the note deterministic: recipient
    // total is the outermost invariant, so it is reported first even
    // when downstream counts also disagree.
    const result = reconcileCounts({
      summary: freezeSummary({
        totalStudents: 5,
        completedStudents: 3,
        inProgressStudents: 1,
        notStartedStudents: 1,
      }),
      recipientsCount: 3,
      submittedCount: 1,
      inProgressCount: 1,
    });
    expect(result.kind).toBe("recipientTotalMismatch");
  });

  test("submitted mismatch is reported before started mismatch when recipient totals align", () => {
    const result = reconcileCounts({
      summary: freezeSummary({
        totalStudents: 3,
        completedStudents: 2,
        inProgressStudents: 1,
        notStartedStudents: 0,
      }),
      recipientsCount: 3,
      submittedCount: 1,
      inProgressCount: 0,
    });
    expect(result.kind).toBe("submittedMismatch");
  });

  test("discrepancy note copy is stable and factual", () => {
    expect(DISCREPANCY_NOTE_COPY).toBe(
      "Roster and summary are temporarily out of sync. The latest details will appear after refresh.",
    );
    expect(DISCREPANCY_NOTE_COPY).not.toMatch(/at risk|attention|urgent|error/i);
    expect(DISCREPANCY_NOTE_COPY).not.toContain("—");
  });
});
