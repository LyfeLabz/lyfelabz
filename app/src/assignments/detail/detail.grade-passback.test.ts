/**
 * @jest-environment jsdom
 *
 * Sprint 30A.2 - Google Classroom best-score grade-passback: teacher-
 * facing per-student manual retry surface on the Submitted roster group.
 *
 * These tests prove the surface behavior only: a synced/absent status
 * renders nothing extra (uncluttered), a pending/syncing/failed status
 * renders a calm status line + Retry action, the button locks while a
 * retry is in flight, a successful retry clears the row, a failed retry
 * remains retryable, and no raw error/technical detail is ever shown.
 * The synchronization engine itself is covered by
 * platform/functions/src/lms/grade-passback/engine.test.ts and
 * engine.concurrency.test.ts.
 */
import { renderAssignmentDetail } from "./detail";
import type {
  AssignmentDetailMetadata,
  AssignmentGradePassbackSeam,
  AssignmentGradePassbackStatus,
} from "./types";
import type { AssignmentSummary } from "../summary/types";
import type { AssignmentRecipientListCallable } from "./roster-wire";
import type { AttemptsListForClassCallable } from "./attempts-wire";

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
};

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const publishedMeta: AssignmentDetailMetadata = Object.freeze({
  assignmentId: "a1",
  title: "Earth's Layers",
  status: "published",
  className: "6A",
  classId: "c1",
  lessonSlug: "earths-layers",
});

const summaryFor = (completed: number): AssignmentSummary =>
  Object.freeze({
    assignmentId: "a1",
    totalStudents: completed,
    completedStudents: completed,
    inProgressStudents: 0,
    notStartedStudents: 0,
    averagePercentage: 90,
  }) as unknown as AssignmentSummary;

const STUDENT_ID = "student-1";

const recipientListCallable: AssignmentRecipientListCallable = async () => ({
  assignmentId: "a1",
  recipients: [{ studentId: STUDENT_ID, studentDisplayName: "Fictional Student" }],
});

const attemptsListForClassCallable: AttemptsListForClassCallable = async () => ({
  classId: "c1",
  attempts: [
    {
      attemptId: "a1__student-1__a1",
      studentId: STUDENT_ID,
      studentDisplayName: "Fictional Student",
      assignmentId: "a1",
      attemptNumber: 1,
      score: 9,
      maxScore: 10,
      percentage: 90,
      submittedAt: 1000,
    },
  ],
});

function renderWithGradePassback(
  gradePassback: AssignmentGradePassbackSeam | undefined,
): { mount: HTMLElement } {
  const mount = mkMount();
  renderAssignmentDetail(mount, {
    assignmentId: "a1",
    loadMetadata: async () => publishedMeta,
    summaryCallable: async () => summaryFor(1),
    recipientListCallable,
    attemptsListForClassCallable,
    gradePassback,
  });
  return { mount };
}

function makeSeam(
  initialStatuses: Readonly<Record<string, AssignmentGradePassbackStatus>>,
  retryImpl: (input: {
    assignmentId: string;
    studentId: string;
  }) => Promise<"synced" | "pending" | "failed" | "notApplicable">,
): AssignmentGradePassbackSeam {
  return {
    statusesReader: async () =>
      new Map(Object.entries(initialStatuses)) as ReadonlyMap<
        string,
        AssignmentGradePassbackStatus
      >,
    retry: retryImpl,
  };
}

const statusEl = (mount: HTMLElement) =>
  mount.querySelector<HTMLElement>(
    `[data-testid=assignment-detail-roster-grade-status-${STUDENT_ID}]`,
  );
const retryBtn = (mount: HTMLElement) =>
  mount.querySelector<HTMLButtonElement>(
    `[data-testid=assignment-detail-roster-grade-retry-${STUDENT_ID}]`,
  );

describe("assignment detail - Google Classroom grade-passback retry (Sprint 30A.2)", () => {
  test("no gradePassback seam: no status or retry control renders (backward compatible)", async () => {
    const { mount } = renderWithGradePassback(undefined);
    await settle();
    expect(statusEl(mount)).toBeNull();
    expect(retryBtn(mount)).toBeNull();
  });

  test("synced status renders nothing extra - the ordinary row stays uncluttered", async () => {
    const seam = makeSeam({ [STUDENT_ID]: "synced" }, async () => "synced");
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)).toBeNull();
    expect(retryBtn(mount)).toBeNull();
  });

  test("a student absent from the statuses map (no passback record) renders nothing extra", async () => {
    const seam = makeSeam({}, async () => "synced");
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)).toBeNull();
    expect(retryBtn(mount)).toBeNull();
  });

  test("failed status renders a calm status line and a Retry button", async () => {
    const seam = makeSeam({ [STUDENT_ID]: "failed" }, async () => "synced");
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)?.textContent).toBe(
      "Classroom grade sync did not succeed.",
    );
    expect(retryBtn(mount)).not.toBeNull();
    expect(retryBtn(mount)?.disabled).toBe(false);
  });

  test("pending status renders a calm status line and a Retry button", async () => {
    const seam = makeSeam({ [STUDENT_ID]: "pending" }, async () => "synced");
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)?.textContent).toBe("Classroom grade sync pending.");
    expect(retryBtn(mount)).not.toBeNull();
  });

  test("syncing status renders a calm status line and a Retry button", async () => {
    const seam = makeSeam({ [STUDENT_ID]: "syncing" }, async () => "synced");
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)?.textContent).toBe("Syncing to Classroom...");
  });

  test("clicking Retry locks the button (disabled + aria-busy) while in flight", async () => {
    let releaseRetry: (() => void) | undefined;
    const seam = makeSeam(
      { [STUDENT_ID]: "failed" },
      () =>
        new Promise((resolve) => {
          releaseRetry = () => resolve("synced");
        }),
    );
    const { mount } = renderWithGradePassback(seam);
    await settle();

    const button = retryBtn(mount);
    expect(button).not.toBeNull();
    button?.click();
    await flush();

    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");

    releaseRetry?.();
    await settle();
  });

  test("a successful retry (synced) removes the status line and the Retry button for that row", async () => {
    const seam = makeSeam({ [STUDENT_ID]: "failed" }, async () => "synced");
    const { mount } = renderWithGradePassback(seam);
    await settle();

    retryBtn(mount)?.click();
    await settle();

    expect(statusEl(mount)).toBeNull();
    expect(retryBtn(mount)).toBeNull();
  });

  test("a retry that resolves notApplicable also clears the row", async () => {
    const seam = makeSeam({ [STUDENT_ID]: "failed" }, async () => "notApplicable");
    const { mount } = renderWithGradePassback(seam);
    await settle();

    retryBtn(mount)?.click();
    await settle();

    expect(statusEl(mount)).toBeNull();
    expect(retryBtn(mount)).toBeNull();
  });

  test("a retry that resolves failed again remains retryable and keeps the calm failed copy", async () => {
    const seam = makeSeam({ [STUDENT_ID]: "failed" }, async () => "failed");
    const { mount } = renderWithGradePassback(seam);
    await settle();

    const button = retryBtn(mount);
    button?.click();
    await settle();

    expect(statusEl(mount)?.textContent).toBe(
      "Classroom grade sync did not succeed.",
    );
    expect(retryBtn(mount)).not.toBeNull();
    expect(retryBtn(mount)?.disabled).toBe(false);
  });

  test("a retry that resolves pending remains retryable with pending copy", async () => {
    const seam = makeSeam({ [STUDENT_ID]: "failed" }, async () => "pending");
    const { mount } = renderWithGradePassback(seam);
    await settle();

    retryBtn(mount)?.click();
    await settle();

    expect(statusEl(mount)?.textContent).toBe("Classroom grade sync pending.");
    expect(retryBtn(mount)).not.toBeNull();
  });

  test("a rejected retry call surfaces only the calm failed copy, never a raw error", async () => {
    const seam = makeSeam({ [STUDENT_ID]: "failed" }, async () => {
      throw new Error("internal: PlatformError lms.upstreamCallFailed at provider.ts:42");
    });
    const { mount } = renderWithGradePassback(seam);
    await settle();

    retryBtn(mount)?.click();
    await settle();

    const text = statusEl(mount)?.textContent ?? "";
    expect(text).toBe("Classroom grade sync did not succeed.");
    expect(text).not.toMatch(/PlatformError|provider\.ts|upstreamCallFailed/);
    expect(retryBtn(mount)?.disabled).toBe(false);
  });

  test("a failed statuses-read never breaks the roster and simply shows no grade-passback control", async () => {
    const seam: AssignmentGradePassbackSeam = {
      statusesReader: async () => {
        throw new Error("boom");
      },
      retry: async () => "synced",
    };
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(
      mount.querySelector("[data-testid=assignment-detail-roster-error]"),
    ).toBeNull();
    expect(statusEl(mount)).toBeNull();
    expect(retryBtn(mount)).toBeNull();
  });
});
