/**
 * @jest-environment jsdom
 *
 * Grade Improvements V1: the Assignment Detail roster's "Update Grade" pill
 * and its confirmation. Surface behavior only; detection, persistence,
 * concurrency, and authorization are proven against the Firestore emulator in
 * platform/functions/src/gradeImprovements/grade-improvements.emulator.test.ts.
 */
import { renderAssignmentDetail } from "./detail";
import type { AssignmentDetailMetadata } from "./types";
import type { AssignmentSummary } from "../summary/types";
import type { AssignmentRecipientListCallable } from "./roster-wire";
import type { AttemptsListForClassCallable } from "./attempts-wire";
import type {
  GradeImprovementMutationResult,
  GradeImprovementPending,
  GradeImprovementsSeam,
} from "../gradeImprovements/types";
import { installGradeImprovementsSeam } from "../gradeImprovements/session";

const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await flush();
};

const meta: AssignmentDetailMetadata = Object.freeze({
  assignmentId: "a1",
  title: "Earth's Layers",
  status: "published",
  className: "7A",
  classId: "c1",
  lessonSlug: "earths-layers",
});

const S1 = "student-1";
const S2 = "student-2";

const recipientListCallable: AssignmentRecipientListCallable = async () => ({
  assignmentId: "a1",
  recipients: [
    { studentId: S1, studentDisplayName: "Ada Fictional" },
    { studentId: S2, studentDisplayName: "Ben Fictional" },
  ],
});

const attempt = (id: string, studentId: string, n: number, pct: number) => ({
  attemptId: id,
  studentId,
  studentDisplayName: studentId === S1 ? "Ada Fictional" : "Ben Fictional",
  assignmentId: "a1",
  attemptNumber: n,
  score: pct / 10,
  maxScore: 10,
  percentage: pct,
  submittedAt: 1000 * n,
});

const attemptsListForClassCallable: AttemptsListForClassCallable = async () => ({
  classId: "c1",
  attempts: [attempt("t1", S1, 1, 60), attempt("t2", S1, 2, 70), attempt("t3", S1, 3, 90), attempt("u1", S2, 1, 80)],
});

const summary = {
  assignmentId: "a1",
  totalStudents: 2,
  completedStudents: 2,
  inProgressStudents: 0,
  notStartedStudents: 0,
  averagePercentage: 85,
} as unknown as AssignmentSummary;

const PENDING: GradeImprovementPending = {
  assignmentId: "a1",
  studentId: S1,
  baselinePercentage: 60,
  baselineSource: "firstAttempt",
  bestPercentage: 90,
  bestAttemptId: "t3",
};

function ackResult(pending: GradeImprovementPending | null): GradeImprovementMutationResult {
  return {
    status: "acknowledged",
    pending,
    history: { assignmentId: "a1", studentId: S1, effective: { eventId: "e000001", percentage: 90, attemptId: "t3" }, events: [] },
  };
}

function seam(overrides: Partial<GradeImprovementsSeam> = {}): GradeImprovementsSeam & {
  acknowledge: jest.Mock;
  listForAssignment: jest.Mock;
} {
  return {
    listForAssignment: jest.fn(async () => [PENDING]),
    listForStudent: jest.fn(async () => []),
    acknowledge: jest.fn(async () => ackResult(null)),
    reverse: jest.fn(),
    ...overrides,
  } as never;
}

function render(gradeImprovements: GradeImprovementsSeam | null | undefined): HTMLElement {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  renderAssignmentDetail(mount, {
    assignmentId: "a1",
    loadMetadata: async () => meta,
    summaryCallable: async () => summary,
    recipientListCallable,
    attemptsListForClassCallable,
    onSelectStudent: () => undefined,
    ...(gradeImprovements === undefined ? {} : { gradeImprovements }),
  });
  return mount;
}

const pill = (root: ParentNode, studentId = S1) =>
  root.querySelector<HTMLButtonElement>(`[data-testid=assignment-detail-roster-grade-update-${studentId}]`);
const dialog = () => document.querySelector<HTMLElement>("[data-testid=assignment-detail-grade-update-dialog]");
const byTestId = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid=${id}]`);

afterEach(() => {
  document.body.innerHTML = "";
  installGradeImprovementsSeam(null);
});

describe("Assignment Detail - Update Grade pill", () => {
  test("appears only for the student with a pending improvement", async () => {
    const mount = render(seam());
    await settle();
    expect(pill(mount, S1)).not.toBeNull();
    expect(pill(mount, S2)).toBeNull();
  });

  test("sits immediately to the right of the attempt count, inside the score summary", async () => {
    const mount = render(seam());
    await settle();
    const summaryEl = mount.querySelector(`[data-testid=assignment-detail-roster-summary-${S1}]`)!;
    const attempts = mount.querySelector(`[data-testid=assignment-detail-roster-attempts-${S1}]`)!;
    expect(pill(mount)!.parentElement).toBe(summaryEl);
    expect(attempts.nextElementSibling).toBe(pill(mount));
    expect(pill(mount)!.textContent).toBe("Update Grade");
  });

  test("adds the aligned four-column layout only while a pill is shown", async () => {
    const groups = (root: HTMLElement) =>
      root.querySelector("[data-testid=assignment-detail-roster-groups]")!;
    const cls = "shell-assignment-detail-roster-has-grade-updates";
    const none = render(seam({ listForAssignment: jest.fn(async () => []) }));
    const some = render(seam());
    await settle();
    expect(groups(none).classList.contains(cls)).toBe(false);
    expect(groups(some).classList.contains(cls)).toBe(true);
    pill(some)!.click();
    byTestId("assignment-detail-grade-update-dialog-confirm")!.click();
    await settle();
    expect(groups(some).classList.contains(cls)).toBe(false);
  });

  test("is a keyboard-accessible button with an explicit accessible name", async () => {
    const mount = render(seam());
    await settle();
    const p = pill(mount)!;
    expect(p.tagName).toBe("BUTTON");
    expect(p.type).toBe("button");
    expect(p.getAttribute("aria-label")).toBe("Update Grade: Ada Fictional improved from 60% to 90%");
    expect(p.getAttribute("aria-haspopup")).toBe("dialog");
  });

  test("leaves existing score and attempt displays unchanged", async () => {
    const withSeam = render(seam());
    const without = render(null);
    await settle();
    const text = (root: HTMLElement, id: string) =>
      root.querySelector(`[data-testid=${id}]`)?.textContent;
    for (const s of [S1, S2]) {
      expect(text(withSeam, `assignment-detail-roster-attempts-${s}`)).toBe(
        text(without, `assignment-detail-roster-attempts-${s}`),
      );
      expect(withSeam.querySelector(`[data-testid=assignment-detail-roster-summary-${s}] .shell-assignment-detail-roster-percentage`)?.textContent).toBe(
        without.querySelector(`[data-testid=assignment-detail-roster-summary-${s}] .shell-assignment-detail-roster-percentage`)?.textContent,
      );
    }
    expect(pill(without)).toBeNull();
  });

  test("uses the session-installed seam when deps omit one", async () => {
    installGradeImprovementsSeam(seam());
    const mount = render(undefined);
    await settle();
    expect(pill(mount)).not.toBeNull();
  });

  test("a failed read renders no pill and leaves the roster intact", async () => {
    const mount = render(seam({ listForAssignment: jest.fn(async () => Promise.reject(new Error("x"))) }));
    await settle();
    expect(pill(mount)).toBeNull();
    expect(mount.querySelector(`[data-testid=assignment-detail-roster-row-${S1}]`)).not.toBeNull();
  });

  test("opens a confirmation naming the exact improvement; Cancel changes nothing", async () => {
    const s = seam();
    const mount = render(s);
    await settle();
    pill(mount)!.click();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.getAttribute("role")).toBe("dialog");
    expect(byTestId("assignment-detail-grade-update-dialog-body")!.textContent).toBe(
      "Have you updated Ada Fictional's PowerSchool grade from 60% to 90%?",
    );
    expect(byTestId("assignment-detail-grade-update-dialog-confirm")!.textContent).toBe("Yes, Updated");
    byTestId("assignment-detail-grade-update-dialog-cancel")!.click();
    expect(dialog()).toBeNull();
    expect(s.acknowledge).not.toHaveBeenCalled();
    expect(pill(mount)).not.toBeNull();
  });

  test("Escape cancels", async () => {
    const mount = render(seam());
    await settle();
    pill(mount)!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(dialog()).toBeNull();
  });

  test("confirming acknowledges the displayed attempt and percentage, then removes the pill", async () => {
    let release: (() => void) | undefined;
    const s = seam({
      acknowledge: jest.fn(
        () => new Promise<GradeImprovementMutationResult>((resolve) => (release = () => resolve(ackResult(null)))),
      ),
    });
    const mount = render(s);
    await settle();
    pill(mount)!.click();
    const confirm = byTestId("assignment-detail-grade-update-dialog-confirm")!;
    confirm.click();
    await flush();
    // Loading state: both buttons locked.
    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toBe("Saving...");
    expect(byTestId("assignment-detail-grade-update-dialog-cancel")!.disabled).toBe(true);
    confirm.click();
    expect(s.acknowledge).toHaveBeenCalledTimes(1);
    expect(s.acknowledge).toHaveBeenCalledWith({ assignmentId: "a1", studentId: S1, attemptId: "t3", percentage: 90 });
    release!();
    await settle();
    expect(dialog()).toBeNull();
    expect(pill(mount)).toBeNull();
  });

  test("a failure keeps the dialog open with a retryable message", async () => {
    const s = seam({ acknowledge: jest.fn(async () => Promise.reject(new Error("network"))) });
    const mount = render(s);
    await settle();
    pill(mount)!.click();
    byTestId("assignment-detail-grade-update-dialog-confirm")!.click();
    await settle();
    expect(dialog()).not.toBeNull();
    expect(byTestId("assignment-detail-grade-update-dialog-error")!.hidden).toBe(false);
    expect(byTestId("assignment-detail-grade-update-dialog-error")!.textContent).toBe(
      "We couldn't save this. Please try again.",
    );
    expect(byTestId("assignment-detail-grade-update-dialog-confirm")!.disabled).toBe(false);
    expect(pill(mount)).not.toBeNull();
  });

  test("a stale confirmation marks nothing and refreshes the pill to the newer score", async () => {
    const newer: GradeImprovementPending = { ...PENDING, bestPercentage: 100, bestAttemptId: "t4" };
    const list = jest.fn().mockResolvedValueOnce([PENDING]).mockResolvedValue([newer]);
    const staleErr = Object.assign(new Error("stale"), { details: { code: "gradeImprovements.stale" } });
    const s = seam({ listForAssignment: list, acknowledge: jest.fn(async () => Promise.reject(staleErr)) });
    const mount = render(s);
    await settle();
    pill(mount)!.click();
    byTestId("assignment-detail-grade-update-dialog-confirm")!.click();
    await settle();
    expect(byTestId("assignment-detail-grade-update-dialog-error")!.textContent).toContain("Nothing was marked");
    expect(byTestId("assignment-detail-grade-update-dialog-confirm")!.disabled).toBe(true);
    byTestId("assignment-detail-grade-update-dialog-cancel")!.click();
    expect(pill(mount)!.getAttribute("aria-label")).toBe("Update Grade: Ada Fictional improved from 60% to 100%");
  });

  test("an acknowledgment that leaves a newer improvement pending re-renders the pill", async () => {
    const newer: GradeImprovementPending = {
      ...PENDING,
      baselinePercentage: 90,
      baselineSource: "acknowledged",
      bestPercentage: 100,
      bestAttemptId: "t4",
    };
    const s = seam({ acknowledge: jest.fn(async () => ({ ...ackResult(newer), status: "alreadyAcknowledged" as const })) });
    const mount = render(s);
    await settle();
    pill(mount)!.click();
    byTestId("assignment-detail-grade-update-dialog-confirm")!.click();
    await settle();
    expect(pill(mount)!.getAttribute("aria-label")).toBe("Update Grade: Ada Fictional improved from 90% to 100%");
  });
});
