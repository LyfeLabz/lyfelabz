/**
 * @jest-environment jsdom
 */

// Sprint 27 Phase 5: surface tests for the Assignment Detail late-recipient
// repair affordance ("Students to add"). The surface is a pure DOM builder
// wired with in-memory fakes; no firebase binding is exercised. These tests
// cover the actionable-only visibility contract (nothing for zero
// candidates, a failed candidate read, closed/draft, or a Previous
// assignment), candidate rendering, the add flow, loading/disabled behavior,
// the double-click guard, error recovery, refresh-on-success, the post-add
// confirmation, and that the surface is unchanged when the seams are absent.

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

// No late-recipient UI of any kind: no section, heading, empty or error
// text, lifecycle note, or loading line.
const expectNoLateRecipientUi = (mount: HTMLElement): void => {
  expect(host(mount)).toBeNull();
  expect(mount.querySelector("[data-testid^=assignment-detail-late-recipients]")).toBeNull();
  expect(mount.querySelector(".shell-assignment-detail-late-recipients")).toBeNull();
  expect(mount.textContent).not.toMatch(
    /Students to add|Students not yet assigned|already assigned|Loading students|temporarily unavailable|Reopen it to add|Publish it before/,
  );
};

type Current = {
  resolution: "valid" | "unresolved" | "invalid" | "inactive";
  currentAssignmentId: string | null;
};

// The family's canonical Current reaches Detail through the grade-passback
// seam's `currentReader` (shared, cached per load).
const withCurrent = (
  current: Current | (() => Promise<Current>),
): Pick<AssignmentDetailDeps, "gradePassback"> => ({
  gradePassback: {
    statusesReader: async () => new Map(),
    retry: async () => "synced",
    currentReader: async () =>
      typeof current === "function" ? current() : current,
  },
});

const freezeLessonMetadata = (
  overrides: Partial<AssignmentDetailMetadata> = {},
): AssignmentDetailMetadata =>
  freezeMetadata({ lessonSlug: "carbon-cycle", ...overrides });

describe("late-recipient section - visibility", () => {
  test("is absent when the seams are not wired (pre-Sprint-27 surface unchanged)", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, baseDeps({}));
    await flush();
    expect(host(mount)).toBeNull();
  });

  test("a closed assignment renders no late-recipient UI and issues no candidate read", async () => {
    // A closed assignment cannot gain recipients (PDR-029j). The header's
    // Closed state + Reopen action already explain it; no note renders.
    const mount = mkMount();
    const candidates = candidatesFake([
      { studentId: "s-a", studentDisplayName: "Ada" },
    ]);
    renderAssignmentDetail(
      mount,
      baseDeps({
        loadMetadata: () =>
          Promise.resolve(freezeMetadata({ status: "closed" })),
        recipientCandidatesListCallable: candidates.callable,
        recipientAddCallable: addFake().callable,
        reopenCallable: async (input) => ({
          assignmentId: input.assignmentId,
          status: "published",
          alreadyPublished: false,
        }),
      }),
    );
    await flush();
    await flush();
    expectNoLateRecipientUi(mount);
    expect(candidates.calls.length).toBe(0);
    // Closed + Reopen are unchanged.
    expect(
      mount.querySelector("[data-testid=assignment-detail-status-value]")?.textContent,
    ).toBe("Closed");
    expect(
      mount.querySelector("[data-testid=assignment-detail-reopen-action]"),
    ).not.toBeNull();
  });

  test("a draft assignment renders no late-recipient UI and keeps its draft presentation", async () => {
    const mount = mkMount();
    const candidates = candidatesFake([
      { studentId: "s-a", studentDisplayName: "Ada" },
    ]);
    renderAssignmentDetail(
      mount,
      baseDeps({
        loadMetadata: () =>
          Promise.resolve(freezeMetadata({ status: "draft" })),
        recipientCandidatesListCallable: candidates.callable,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    await flush();
    expectNoLateRecipientUi(mount);
    expect(candidates.calls.length).toBe(0);
    expect(
      mount.querySelector("[data-testid=assignment-detail-draft-label]")?.textContent,
    ).toBe("Draft assignment");
  });

  test("renders nothing when the seams are not wired (closed surface unchanged)", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        loadMetadata: () =>
          Promise.resolve(freezeMetadata({ status: "closed" })),
      }),
    );
    await flush();
    await flush();
    expect(host(mount)).toBeNull();
  });

  test("renders the actionable section for a published assignment with candidates", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesFake([
          { studentId: "s-a", studentDisplayName: "Ada" },
          { studentId: "s-b", studentDisplayName: "Ben" },
        ]).callable,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    const section = host(mount)!;
    expect(section.tagName).toBe("SECTION");
    const heading = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-late-recipients-heading]",
    )!;
    expect(heading.tagName).toBe("H3");
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.textContent).toBe("Students to add 2");
    expect(
      heading.querySelector(".shell-assignment-detail-late-recipients-heading-label")?.textContent,
    ).toBe("Students to add");
    expect(
      mount.querySelector("[data-testid=assignment-detail-late-recipients-count]")?.textContent,
    ).toBe("2");
    // The count is plain text, never a control.
    expect(heading.querySelector("button, a, input")).toBeNull();
  });
});

describe("late-recipient section - actionable-only visibility", () => {
  test("zero candidates: nothing at all is rendered, and nothing flashes while the read is in flight", async () => {
    const mount = mkMount();
    let release: () => void = () => undefined;
    const gated: AssignmentRecipientCandidatesListCallable = () =>
      new Promise((resolve) => {
        release = () => resolve({ assignmentId: "assign-1", candidates: [] });
      });
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: gated,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    // While candidates load: no card, heading, or loading line.
    expectNoLateRecipientUi(mount);
    release();
    await flush();
    await flush();
    expectNoLateRecipientUi(mount);
    // The rest of Assignment Detail is intact.
    expect(mount.querySelector("[data-testid=assignment-detail-title]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=assignment-summary]")).not.toBeNull();
  });

  test("a failed candidate read renders nothing (no teacher-facing error) and the page stays intact", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: rejectingCandidates(),
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    await flush();
    expectNoLateRecipientUi(mount);
    expect(mount.querySelector("[role=alert]")).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-title]")?.textContent).toBe(
      "Waves and Signals Check",
    );
    expect(mount.querySelector("[data-testid=assignment-summary]")).not.toBeNull();
  });

  test("Previous assignment (another assignment is the valid Current): no Students to add action", async () => {
    const mount = mkMount();
    const candidates = candidatesFake([
      { studentId: "s-a", studentDisplayName: "Ada" },
    ]);
    renderAssignmentDetail(
      mount,
      baseDeps({
        loadMetadata: () => Promise.resolve(freezeLessonMetadata()),
        recipientCandidatesListCallable: candidates.callable,
        recipientAddCallable: addFake().callable,
        ...withCurrent({ resolution: "valid", currentAssignmentId: "assign-newer" }),
      }),
    );
    await flush();
    await flush();
    expectNoLateRecipientUi(mount);
    expect(mount.querySelector("[data-testid=assignment-detail-late-recipients-add]")).toBeNull();
    // The header names the state; this surface just offers no useless action.
    expect(
      mount.querySelector("[data-testid=assignment-detail-status-value]")?.textContent,
    ).toBe("Previous assignment");
  });

  test.each([
    ["the viewed assignment is the valid Current", { resolution: "valid", currentAssignmentId: "assign-1" } as Current],
    ["no Current pointer (legacy)", { resolution: "unresolved", currentAssignmentId: null } as Current],
    ["a managed but inactive Current", { resolution: "inactive", currentAssignmentId: null } as Current],
    ["an invalid Current pointer", { resolution: "invalid", currentAssignmentId: null } as Current],
  ])("%s: actionable candidates are still offered (never a false Previous)", async (_label, current) => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        loadMetadata: () => Promise.resolve(freezeLessonMetadata()),
        recipientCandidatesListCallable: candidatesFake([
          { studentId: "s-a", studentDisplayName: "Ada" },
        ]).callable,
        recipientAddCallable: addFake().callable,
        ...withCurrent(current),
      }),
    );
    await flush();
    await flush();
    expect(host(mount)).not.toBeNull();
    expect(
      mount.querySelectorAll("[data-testid=assignment-detail-late-recipients-add]").length,
    ).toBe(1);
  });

  test("a failed Current lookup never suppresses actionable candidates", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        loadMetadata: () => Promise.resolve(freezeLessonMetadata()),
        recipientCandidatesListCallable: candidatesFake([
          { studentId: "s-a", studentDisplayName: "Ada" },
        ]).callable,
        recipientAddCallable: addFake().callable,
        ...withCurrent(async () => {
          throw new Error("lifecycle unavailable");
        }),
      }),
    );
    await flush();
    await flush();
    expect(host(mount)).not.toBeNull();
  });

  test("the section sits after the Roster and before Question results", async () => {
    const mount = mkMount();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesFake([
          { studentId: "s-a", studentDisplayName: "Ada" },
        ]).callable,
        recipientAddCallable: addFake().callable,
        recipientListCallable: async () => ({ assignmentId: "assign-1", recipients: [] }),
        attemptsListForClassCallable: async () => ({ classId: "class-1", attempts: [] }),
        attemptGetForTeacherCallable: async () => {
          throw new Error("unused");
        },
      }),
    );
    await flush();
    await flush();
    const order = Array.from(
      mount.querySelectorAll<HTMLElement>(
        "[data-testid=assignment-detail-roster-host], [data-testid=assignment-detail-late-recipients-host], [data-testid=assignment-detail-questions-host]",
      ),
    ).map((e) => e.getAttribute("data-testid"));
    expect(order).toEqual([
      "assignment-detail-roster-host",
      "assignment-detail-late-recipients-host",
      "assignment-detail-questions-host",
    ]);
  });
});

describe("late-recipient section - states", () => {
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
    // The final candidate was added: the section disappears and the
    // confirmation remains.
    expect(host(mount)).toBeNull();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-late-recipients-confirmation]",
      )?.textContent,
    ).toBe("Added to assignment.");
  });
});

describe("late-recipient section - Sprint 28 O5 confirmation and accessibility", () => {
  test("O5.1: a successful add surfaces an announced 'Added to assignment.' confirmation", async () => {
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
    // The confirmation is absent before any add; the in-flight region is empty.
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-late-recipients-confirmation]",
      ),
    ).toBeNull();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-late-recipients-status]",
      )?.textContent,
    ).toBe("");
    fake.set([{ studentId: "s-b", studentDisplayName: "Ben" }]);
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-late-recipients-add]",
      )
      ?.click();
    await flush();
    await flush();
    const status = mount.querySelector(
      "[data-testid=assignment-detail-late-recipients-confirmation]",
    );
    expect(status?.textContent).toBe("Added to assignment.");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    // A candidate remains, so the section remains with the updated count.
    expect(
      mount.querySelector("[data-testid=assignment-detail-late-recipients-count]")?.textContent,
    ).toBe("1");
    expect(
      Array.from(
        mount.querySelectorAll("[data-testid=assignment-detail-late-recipients-name]"),
      ).map((n) => n.textContent),
    ).toEqual(["Ben"]);
  });

  test("O5.1: adding the final candidate removes the section but keeps an announced confirmation", async () => {
    const mount = mkMount();
    const fake = candidatesFake([
      { studentId: "s-a", studentDisplayName: "Ada" },
    ]);
    const add = addFake();
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: fake.callable,
        recipientAddCallable: add.callable,
      }),
    );
    await flush();
    expect(host(mount)).not.toBeNull();
    // After the add the server no longer returns the student.
    fake.set([]);
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-late-recipients-add]",
      )
      ?.click();
    await flush();
    await flush();
    expect(add.invocations).toEqual([{ assignmentId: "assign-1", studentId: "s-a" }]);
    expect(host(mount)).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-late-recipients-heading]")).toBeNull();
    const confirmation = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-late-recipients-confirmation]",
    )!;
    expect(confirmation.textContent).toBe("Added to assignment.");
    expect(confirmation.getAttribute("role")).toBe("status");
    expect(confirmation.getAttribute("aria-live")).toBe("polite");
    // A single quiet line, not a card.
    expect(confirmation.tagName).toBe("P");
    expect(confirmation.closest("section.shell-assignment-detail-late-recipients")).toBeNull();
  });

  test("O5.1: the confirmation region is attached empty and filled after the read settles", async () => {
    const mount = mkMount();
    let calls = 0;
    let releaseSecond: () => void = () => undefined;
    const candidatesCallable: AssignmentRecipientCandidatesListCallable = () => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          assignmentId: "assign-1",
          candidates: [{ studentId: "s-a", studentDisplayName: "Ada" }],
        });
      }
      return new Promise((resolve) => {
        releaseSecond = () => resolve({ assignmentId: "assign-1", candidates: [] });
      });
    };
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: candidatesCallable,
        recipientAddCallable: addFake().callable,
      }),
    );
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-late-recipients-add]",
      )
      ?.click();
    await flush();
    await flush();
    const region = mount.querySelector<HTMLElement>(
      "[data-testid=assignment-detail-late-recipients-confirmation]",
    )!;
    expect(region).not.toBeNull();
    expect(region.textContent).toBe("");
    releaseSecond();
    await flush();
    expect(region.isConnected).toBe(true);
    expect(region.textContent).toBe("Added to assignment.");
  });

  test("O5.1: the confirmation is scoped to the post-add rerender and does not persist through a later rerender", async () => {
    const mount = mkMount();
    const fake = candidatesFake([
      { studentId: "s-a", studentDisplayName: "Ada" },
    ]);
    const close = {
      callable: (input: { assignmentId: string }) =>
        Promise.resolve({
          assignmentId: input.assignmentId,
          status: "closed" as const,
          alreadyClosed: false,
        }),
    };
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: fake.callable,
        recipientAddCallable: addFake().callable,
        closeCallable: close.callable,
      }),
    );
    await flush();
    fake.set([]);
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-late-recipients-add]",
      )
      ?.click();
    await flush();
    await flush();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-late-recipients-confirmation]",
      )?.textContent,
    ).toBe("Added to assignment.");
    // A subsequent lifecycle transition rerenders the surface; the stale
    // confirmation must not reappear, and a closed assignment renders no
    // late-recipient UI at all.
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-close-action]",
      )
      ?.click();
    const confirm = document.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-close-confirm]",
    );
    confirm?.click();
    await flush();
    await flush();
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-late-recipients-confirmation]",
      ),
    ).toBeNull();
    expectNoLateRecipientUi(mount);
  });

  test("O5.3: the in-flight state is announced through the live region", async () => {
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
        ]).callable,
        recipientAddCallable: addCallable,
      }),
    );
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-late-recipients-add]",
      )
      ?.click();
    const status = mount.querySelector(
      "[data-testid=assignment-detail-late-recipients-status]",
    );
    expect(status?.textContent).toBe("Adding...");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    resolveAdd();
    await flush();
  });

  test("O5.4: a failed add keeps the student eligible, announces the error, and shows no false success", async () => {
    const mount = mkMount();
    const fake = candidatesFake([
      { studentId: "s-a", studentDisplayName: "Ada" },
    ]);
    renderAssignmentDetail(
      mount,
      baseDeps({
        recipientCandidatesListCallable: fake.callable,
        recipientAddCallable: addFake("reject").callable,
      }),
    );
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=assignment-detail-late-recipients-add]",
      )
      ?.click();
    await flush();
    // The student remains eligible and the control is re-enabled for retry.
    const button = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-late-recipients-add]",
    );
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    // The error is announced (role=alert) and no false success is shown.
    const actionError = mount.querySelector(
      "[data-testid=assignment-detail-late-recipients-action-error]",
    );
    expect(actionError?.getAttribute("role")).toBe("alert");
    expect((actionError as HTMLElement).hidden).toBe(false);
    expect(
      mount.querySelector(
        "[data-testid=assignment-detail-late-recipients-status]",
      )?.textContent,
    ).toBe("");
  });
});
