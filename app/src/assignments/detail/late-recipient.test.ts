/**
 * @jest-environment jsdom
 */

// Sprint 27 Phase 5: surface tests for the Assignment Detail late-recipient
// affordance ("Students not yet assigned"). The surface is a pure DOM builder
// wired with in-memory fakes; no firebase binding is exercised. These tests
// cover candidate rendering, the add flow, loading/disabled behavior, the
// double-click guard, error recovery, refresh-on-success, and that the
// pre-Sprint-27 detail surface is unchanged when the seams are absent.

import { renderAssignmentDetail, type AssignmentDetailDeps } from "./detail";
import type { AssignmentDetailMetadata } from "./types";
import type { AssignmentSummary, AssignmentSummaryCallable } from "../summary/types";
import type {
  AssignmentRecipientCandidate,
  AssignmentRecipientCandidatesListCallable,
  AssignmentsRecipientAddCallable,
} from "./late-recipient-wire";

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const freezeMetadata = (
  overrides: Partial<AssignmentDetailMetadata> = {},
): AssignmentDetailMetadata =>
  Object.freeze({
    assignmentId: "assign-1",
    title: "Waves and Signals Check",
    status: "published",
    className: "Period 3 - Grade 7 Physical Science",
    classId: "class-1",
    ...overrides,
  }) as AssignmentDetailMetadata;

const freezeSummary = (): AssignmentSummary =>
  Object.freeze({
    assignmentId: "assign-1",
    classId: "class-1",
    totalStudents: 24,
    completedStudents: 12,
    inProgressStudents: 6,
    notStartedStudents: 6,
    completionPercentage: 50,
    averagePercentage: 82,
    highestPercentage: 100,
    lowestPercentage: 45,
    perfectScoreStudents: 3,
  }) as AssignmentSummary;

const summaryCallable: AssignmentSummaryCallable = () =>
  Promise.resolve(freezeSummary());

type CandidatesFake = {
  readonly callable: AssignmentRecipientCandidatesListCallable;
  readonly calls: number[];
  set: (next: ReadonlyArray<AssignmentRecipientCandidate>) => void;
};

const candidatesFake = (
  initial: ReadonlyArray<AssignmentRecipientCandidate>,
): CandidatesFake => {
  let current = initial;
  let count = 0;
  const calls: number[] = [];
  const callable: AssignmentRecipientCandidatesListCallable = (input) => {
    calls.push(++count);
    void input;
    return Promise.resolve({
      assignmentId: "assign-1",
      candidates: current,
    });
  };
  return {
    callable,
    calls,
    set: (next) => {
      current = next;
    },
  };
};

const rejectingCandidates = (): AssignmentRecipientCandidatesListCallable =>
  () => Promise.reject(new Error("candidates read failed"));

type AddFake = {
  readonly callable: AssignmentsRecipientAddCallable;
  readonly invocations: Array<{ assignmentId: string; studentId: string }>;
};

const addFake = (
  behavior: "resolve" | "reject" = "resolve",
): AddFake => {
  const invocations: Array<{ assignmentId: string; studentId: string }> = [];
  const callable: AssignmentsRecipientAddCallable = (input) => {
    invocations.push({ ...input });
    if (behavior === "reject") {
      return Promise.reject(new Error("add failed"));
    }
    return Promise.resolve({
      assignmentId: input.assignmentId,
      studentId: input.studentId,
      added: true,
    });
  };
  return { callable, invocations };
};

const baseDeps = (
  overrides: Partial<AssignmentDetailDeps>,
): AssignmentDetailDeps => ({
  assignmentId: "assign-1",
  loadMetadata: () => Promise.resolve(freezeMetadata()),
  summaryCallable,
  ...overrides,
});

const host = (mount: HTMLElement): HTMLElement | null =>
  mount.querySelector("[data-testid=assignment-detail-late-recipients-host]");

describe("late-recipient section - visibility", () => {
  test("is absent when the seams are not wired (pre-Sprint-27 surface unchanged)", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, baseDeps({}));
    await flush();
    expect(host(mount)).toBeNull();
  });

  test("is absent for a closed assignment even when the seams are wired", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        loadMetadata: () =>
          Promise.resolve(freezeMetadata({ status: "closed" })),
        recipientCandidatesListCallable: candidatesFake([]).callable,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    expect(host(mount)).toBeNull();
  });

  test("renders for a published assignment when both seams are wired", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesFake([]).callable,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    expect(host(mount)).not.toBeNull();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-late-recipients-heading]",
      )?.textContent,
    ).toBe("Students not yet assigned");
  });
});

describe("late-recipient section - states", () => {
  test("shows the empty state when there are no candidates", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesFake([]).callable,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    const empty = mount.querySelector(
      "[data-testid=assignment-detail-late-recipients-empty]",
    );
    expect(empty?.textContent).toBe("Every enrolled student is already assigned.");
    expect(
      mount.querySelector("[data-testid=assignment-detail-late-recipients-list]"),
    ).toBeNull();
  });

  test("shows a single candidate with an Add control", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesFake([
          { studentId: "s-a", studentDisplayName: "Ada Lovelace" },
        ]).callable,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    const rows = mount.querySelectorAll(
      "[data-testid=assignment-detail-late-recipients-row]",
    );
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector(
      "[data-testid=assignment-detail-late-recipients-add]",
    )).not.toBeNull();
  });

  test("shows multiple candidates", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesFake([
          { studentId: "s-a", studentDisplayName: "Ada" },
          { studentId: "s-b", studentDisplayName: "Ben" },
          { studentId: "s-c", studentDisplayName: "Cara" },
        ]).callable,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    const rows = mount.querySelectorAll(
      "[data-testid=assignment-detail-late-recipients-row]",
    );
    expect(rows.length).toBe(3);
  });

  test("renders a calm error state and never leaks internal detail on read failure", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: rejectingCandidates(),
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    const err = mount.querySelector(
      "[data-testid=assignment-detail-late-recipients-error]",
    );
    expect(err?.getAttribute("role")).toBe("alert");
    expect(err?.textContent).toBe(
      "The list of students is temporarily unavailable.",
    );
  });

  test("displays only the student's display name, not the raw identifier", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesFake([
          { studentId: "uid-secret-123", studentDisplayName: "Ada Lovelace" },
        ]).callable,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    const list = mount.querySelector(
      "[data-testid=assignment-detail-late-recipients-list]",
    );
    expect(list?.textContent).toContain("Ada Lovelace");
    expect(list?.textContent).not.toContain("uid-secret-123");
  });
});

describe("late-recipient section - add flow", () => {
  test("Add invokes the certified callable with the id pair and no forbidden field", async () => {
    const mount = mkMount();
    const add = addFake();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesFake([
          { studentId: "s-a", studentDisplayName: "Ada" },
        ]).callable,
        recipientAddCallable: add.callable,
      }),
    );
    await flush();
    const button = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-late-recipients-add]",
    );
    button?.click();
    expect(add.invocations).toEqual([
      { assignmentId: "assign-1", studentId: "s-a" },
    ]);
    await flush();
  });

  test("the Add control disables and shows a pending label while in flight", async () => {
    const mount = mkMount();
    let resolveAdd: () => void = () => undefined;
    const addCallable: AssignmentsRecipientAddCallable = (input) =>
      new Promise((resolve) => {
        resolveAdd = () =>
          resolve({
            assignmentId: input.assignmentId,
            studentId: input.studentId,
            added: true,
          });
      });
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesFake([
          { studentId: "s-a", studentDisplayName: "Ada" },
          { studentId: "s-b", studentDisplayName: "Ben" },
        ]).callable,
        recipientAddCallable: addCallable,
      }),
    );
    await flush();
    const buttons = mount.querySelectorAll<HTMLButtonElement>(
      "[data-testid=assignment-detail-late-recipients-add]",
    );
    buttons[0].click();
    // Both controls lock while the add is in flight; the clicked one shows a
    // pending label.
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(true);
    expect(buttons[0].textContent).toBe("Adding...");
    resolveAdd();
    await flush();
  });

  test("a second click while an add is in flight is ignored (double-click guard)", async () => {
    const mount = mkMount();
    let resolveAdd: () => void = () => undefined;
    const invocations: string[] = [];
    const addCallable: AssignmentsRecipientAddCallable = (input) => {
      invocations.push(input.studentId);
      return new Promise((resolve) => {
        resolveAdd = () =>
          resolve({
            assignmentId: input.assignmentId,
            studentId: input.studentId,
            added: true,
          });
      });
    };
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesFake([
          { studentId: "s-a", studentDisplayName: "Ada" },
        ]).callable,
        recipientAddCallable: addCallable,
      }),
    );
    await flush();
    const button = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-late-recipients-add]",
    );
    button?.click();
    button?.click();
    button?.click();
    expect(invocations).toEqual(["s-a"]);
    resolveAdd();
    await flush();
  });

  test("a successful add refreshes the section so the student disappears", async () => {
    const mount = mkMount();
    const fake = candidatesFake([
      { studentId: "s-a", studentDisplayName: "Ada" },
      { studentId: "s-b", studentDisplayName: "Ben" },
    ]);
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: fake.callable,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    // After the add succeeds the server no longer returns the added student.
    fake.set([{ studentId: "s-b", studentDisplayName: "Ben" }]);
    const button = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-late-recipients-add]",
    );
    button?.click();
    await flush();
    await flush();
    const names = Array.from(
      mount.querySelectorAll(
        "[data-testid=assignment-detail-late-recipients-name]",
      ),
    ).map((n) => n.textContent);
    expect(names).toEqual(["Ben"]);
    // The section re-fetched candidates after the add.
    expect(fake.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("an add failure is recoverable: the control re-enables and a retry succeeds", async () => {
    const mount = mkMount();
    let mode: "reject" | "resolve" = "reject";
    const invocations: string[] = [];
    const addCallable: AssignmentsRecipientAddCallable = (input) => {
      invocations.push(input.studentId);
      if (mode === "reject") return Promise.reject(new Error("add failed"));
      return Promise.resolve({
        assignmentId: input.assignmentId,
        studentId: input.studentId,
        added: true,
      });
    };
    const fake = candidatesFake([
      { studentId: "s-a", studentDisplayName: "Ada" },
    ]);
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: fake.callable,
        recipientAddCallable: addCallable,
      }),
    );
    await flush();
    let button = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-late-recipients-add]",
    );
    button?.click();
    await flush();
    // Error surfaced, control recovered.
    const actionError = mount.querySelector(
      "[data-testid=assignment-detail-late-recipients-action-error]",
    );
    expect(actionError?.getAttribute("role")).toBe("alert");
    expect((actionError as HTMLElement).hidden).toBe(false);
    button = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-late-recipients-add]",
    );
    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toBe("Add to assignment");
    // Retry now succeeds.
    mode = "resolve";
    fake.set([]);
    button?.click();
    await flush();
    await flush();
    expect(invocations).toEqual(["s-a", "s-a"]);
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-late-recipients-empty]",
      )?.textContent,
    ).toBe("Every enrolled student is already assigned.");
  });
});
