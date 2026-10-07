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
  // Student Progress & Assignment Membership Phase A, Slice 3: optional
  // student-navigation seam, so this file's certified 30A.2 fixtures can
  // also prove the name-click and Retry-click controls never trigger one
  // another.
  onSelectStudent?: (selection: {
    readonly classId: string;
    readonly studentId: string;
    readonly studentDisplayName: string;
    readonly returnToAssignmentId: string;
  }) => void,
): { mount: HTMLElement } {
  const mount = mkMount();
  renderAssignmentDetail(mount, {
    assignmentId: "a1",
    loadMetadata: async () => publishedMeta,
    summaryCallable: async () => summaryFor(1),
    recipientListCallable,
    attemptsListForClassCallable,
    gradePassback,
    onSelectStudent,
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
    expect(statusEl(mount)?.textContent).toBe("Classroom sync failed");
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

    expect(statusEl(mount)?.textContent).toBe("Classroom sync failed");
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
    expect(text).toBe("Classroom sync failed");
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

describe("Student Progress & Assignment Membership Phase A, Slice 3: name click and grade-passback Retry stay independent", () => {
  test("clicking the student's name does not trigger a grade-passback retry", async () => {
    const retryCalls: unknown[] = [];
    const seam = makeSeam({ [STUDENT_ID]: "failed" }, async (input) => {
      retryCalls.push(input);
      return "synced";
    });
    const selections: unknown[] = [];
    const { mount } = renderWithGradePassback(seam, (selection) => {
      selections.push(selection);
    });
    await settle();

    const nameBtn = mount.querySelector<HTMLButtonElement>(
      `[data-testid=assignment-detail-roster-name-${STUDENT_ID}]`,
    );
    expect(nameBtn).not.toBeNull();
    nameBtn!.click();

    expect(selections.length).toBe(1);
    expect(retryCalls.length).toBe(0);
    // The Retry control is unaffected - still present, still enabled.
    expect(retryBtn(mount)).not.toBeNull();
    expect(retryBtn(mount)?.disabled).toBe(false);
  });

  test("clicking Retry does not navigate to Student Detail", async () => {
    const selections: unknown[] = [];
    const seam = makeSeam({ [STUDENT_ID]: "failed" }, async () => "synced");
    const { mount } = renderWithGradePassback(seam, (selection) => {
      selections.push(selection);
    });
    await settle();

    retryBtn(mount)!.click();
    await settle();

    expect(selections.length).toBe(0);
  });

  test("Retry still functions normally (status clears on success) with onSelectStudent wired", async () => {
    const seam = makeSeam({ [STUDENT_ID]: "failed" }, async () => "synced");
    const { mount } = renderWithGradePassback(seam, () => undefined);
    await settle();

    expect(statusEl(mount)).not.toBeNull();
    retryBtn(mount)!.click();
    await settle();

    expect(statusEl(mount)).toBeNull();
    expect(retryBtn(mount)).toBeNull();
  });
});

// Current-aware grade-sync presentation. The Classroom grade destination is
// the class + lesson family's Current; historical passback records are
// preserved but a Retry is offered only where the viewed assignment is the
// operational destination.
describe("assignment detail - Current-aware Classroom grade-sync status", () => {
  type Current = { resolution: "valid" | "unresolved" | "invalid" | "inactive"; currentAssignmentId: string | null };

  function currentAwareSeam(
    statuses: Readonly<Record<string, AssignmentGradePassbackStatus>>,
    current: Current | (() => Promise<Current>),
    retryImpl: (input: { assignmentId: string; studentId: string }) => Promise<
      "synced" | "pending" | "failed" | "notApplicable"
    > = async () => "synced",
  ) {
    const retryCalls: { assignmentId: string; studentId: string }[] = [];
    const currentCalls: { classId: string; lessonSlug: string }[] = [];
    const seam: AssignmentGradePassbackSeam = {
      ...makeSeam(statuses, async (input) => {
        retryCalls.push(input);
        return retryImpl(input);
      }),
      currentReader: async (input) => {
        currentCalls.push(input);
        return typeof current === "function" ? current() : current;
      },
    };
    return { seam, retryCalls, currentCalls };
  }

  const VIEWED = "a1";

  test("Current + failed sync: compact operational status and Retry", async () => {
    const { seam, currentCalls } = currentAwareSeam({ [STUDENT_ID]: "failed" }, {
      resolution: "valid",
      currentAssignmentId: VIEWED,
    });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)?.textContent).toBe("Classroom sync failed");
    expect(statusEl(mount)?.classList.contains("shell-assignment-detail-roster-grade-status-historical")).toBe(false);
    expect(retryBtn(mount)).not.toBeNull();
    // Current is resolved from the viewed assignment's own class + lesson.
    expect(currentCalls).toEqual([{ classId: "c1", lessonSlug: "earths-layers" }]);
  });

  test("Current + synced: nothing extra, no Retry", async () => {
    const { seam } = currentAwareSeam({ [STUDENT_ID]: "synced" }, {
      resolution: "valid",
      currentAssignmentId: VIEWED,
    });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)).toBeNull();
    expect(retryBtn(mount)).toBeNull();
  });

  test("no passback records at all: Current is looked up once (for the header marker) and no Retry renders", async () => {
    const { seam, currentCalls } = currentAwareSeam({}, { resolution: "valid", currentAssignmentId: VIEWED });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(currentCalls).toEqual([{ classId: "c1", lessonSlug: "earths-layers" }]);
    expect(retryBtn(mount)).toBeNull();
  });

  test("Amelia-style: historical failed record while a different assignment is Current shows muted history and no Retry", async () => {
    // Viewing historical A2; Current is A4 (already reconciled and synced there).
    const { seam, retryCalls } = currentAwareSeam({ [STUDENT_ID]: "failed" }, {
      resolution: "valid",
      currentAssignmentId: "a4-current",
    });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    const status = statusEl(mount);
    // The historical record is preserved and still rendered, as history.
    expect(status?.textContent).toBe("Historical Classroom sync failed");
    expect(status?.classList.contains("shell-assignment-detail-roster-grade-status-historical")).toBe(true);
    expect(status?.getAttribute("data-grade-sync-context")).toBe("superseded");
    expect(retryBtn(mount)).toBeNull();
    expect(retryCalls).toEqual([]);
  });

  test("Adela/Lily-style: several historical failed records under a different Current, none offers Retry", async () => {
    const OTHER = "student-2";
    const recipientsTwo: AssignmentRecipientListCallable = async () => ({
      assignmentId: "a1",
      recipients: [
        { studentId: STUDENT_ID, studentDisplayName: "Adela" },
        { studentId: OTHER, studentDisplayName: "Lily" },
      ],
    } as never);
    const attemptsTwo: AttemptsListForClassCallable = async () => ({
      attempts: [STUDENT_ID, OTHER].map((studentId) => ({
        studentId,
        assignmentId: "a1",
        percentage: 90,
        attemptNumber: 1,
        submittedAt: 1,
      })),
    } as never);
    const { seam } = currentAwareSeam({ [STUDENT_ID]: "failed", [OTHER]: "failed" }, {
      resolution: "valid",
      currentAssignmentId: "u91-current",
    });
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "a1",
      loadMetadata: async () => publishedMeta,
      summaryCallable: async () => summaryFor(2),
      recipientListCallable: recipientsTwo,
      attemptsListForClassCallable: attemptsTwo,
      gradePassback: seam,
    });
    await settle();
    expect(mount.querySelectorAll("[data-testid^=assignment-detail-roster-grade-retry-]").length).toBe(0);
    const statuses = Array.from(mount.querySelectorAll("[data-testid^=assignment-detail-roster-grade-status-]"));
    expect(statuses.map((s) => s.textContent)).toEqual([
      "Historical Classroom sync failed",
      "Historical Classroom sync failed",
    ]);
  });

  test("historical pending/syncing records under a different Current render nothing (stale in-flight state is not history worth showing)", async () => {
    for (const st of ["pending", "syncing"] as const) {
      const { seam } = currentAwareSeam({ [STUDENT_ID]: st }, { resolution: "valid", currentAssignmentId: "other" });
      const { mount } = renderWithGradePassback(seam);
      await settle();
      expect(statusEl(mount)).toBeNull();
      expect(retryBtn(mount)).toBeNull();
      mount.remove();
    }
  });

  test("historical successful record renders nothing extra and no Retry", async () => {
    const { seam } = currentAwareSeam({ [STUDENT_ID]: "synced" }, { resolution: "valid", currentAssignmentId: "other" });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)).toBeNull();
    expect(retryBtn(mount)).toBeNull();
  });

  test("legacy family with no Current pointer: the assignment is its own destination, Retry stays", async () => {
    const { seam } = currentAwareSeam({ [STUDENT_ID]: "failed" }, { resolution: "unresolved", currentAssignmentId: null });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)?.textContent).toBe("Classroom sync failed");
    expect(retryBtn(mount)).not.toBeNull();
  });

  test.each([
    ["managed/inactive Current", { resolution: "inactive", currentAssignmentId: null } as Current],
    ["invalid Current pointer", { resolution: "invalid", currentAssignmentId: null } as Current],
  ])("%s: status stays visible but no operational Retry (no resurrection)", async (_label, current) => {
    const { seam } = currentAwareSeam({ [STUDENT_ID]: "failed" }, current);
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)?.textContent).toBe("Classroom sync failed");
    expect(retryBtn(mount)).toBeNull();
  });

  test("Current cannot be determined: fail closed, status visible, no Retry", async () => {
    const { seam } = currentAwareSeam({ [STUDENT_ID]: "failed" }, async () => {
      throw new Error("lifecycle unavailable");
    });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusEl(mount)?.textContent).toBe("Classroom sync failed");
    expect(retryBtn(mount)).toBeNull();
  });

  test("metadata without class/lesson: fail closed, no Retry", async () => {
    const { seam } = currentAwareSeam({ [STUDENT_ID]: "failed" }, { resolution: "valid", currentAssignmentId: VIEWED });
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "a1",
      loadMetadata: async () => ({ ...publishedMeta, lessonSlug: undefined }),
      summaryCallable: async () => summaryFor(1),
      recipientListCallable,
      attemptsListForClassCallable,
      gradePassback: seam,
    });
    await settle();
    expect(retryBtn(mount)).toBeNull();
  });

  test("Current changes while the page is open: clicking the stale Retry re-checks, sends no Retry, and shows history", async () => {
    let current: Current = { resolution: "valid", currentAssignmentId: VIEWED };
    const { seam, retryCalls } = currentAwareSeam({ [STUDENT_ID]: "failed" }, async () => current);
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(retryBtn(mount)).not.toBeNull();

    current = { resolution: "valid", currentAssignmentId: "newer-current" };
    retryBtn(mount)!.click();
    await settle();

    expect(retryCalls).toEqual([]);
    expect(retryBtn(mount)).toBeNull();
    expect(statusEl(mount)?.textContent).toBe("Historical Classroom sync failed");
  });

  test("Current closed while the page is open: stale Retry is withdrawn without calling the backend", async () => {
    let current: Current = { resolution: "valid", currentAssignmentId: VIEWED };
    const { seam, retryCalls } = currentAwareSeam({ [STUDENT_ID]: "failed" }, async () => current);
    const { mount } = renderWithGradePassback(seam);
    await settle();
    current = { resolution: "inactive", currentAssignmentId: null };
    retryBtn(mount)!.click();
    await settle();
    expect(retryCalls).toEqual([]);
    expect(retryBtn(mount)).toBeNull();
    expect(statusEl(mount)?.textContent).toBe("Classroom sync failed");
  });

  test("Retry on Current still calls the existing hardened backend path with the viewed assignment and student only", async () => {
    const { seam, retryCalls } = currentAwareSeam({ [STUDENT_ID]: "failed" }, {
      resolution: "valid",
      currentAssignmentId: VIEWED,
    });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    retryBtn(mount)!.click();
    await settle();
    expect(retryCalls).toEqual([{ assignmentId: VIEWED, studentId: STUDENT_ID }]);
    // Successful retry clears the row, as before.
    expect(statusEl(mount)).toBeNull();
    expect(retryBtn(mount)).toBeNull();
  });

  test("Current automatic-sync failure that fails again on Retry stays operational and retryable", async () => {
    const { seam } = currentAwareSeam(
      { [STUDENT_ID]: "failed" },
      { resolution: "valid", currentAssignmentId: VIEWED },
      async () => "failed",
    );
    const { mount } = renderWithGradePassback(seam);
    await settle();
    retryBtn(mount)!.click();
    await settle();
    expect(statusEl(mount)?.textContent).toBe("Classroom sync failed");
    expect(retryBtn(mount)?.disabled).toBe(false);
  });
});

// Assignment Details header state. The ordinary published assignment does
// not announce itself (no Status / Published / Current). "Previous
// assignment" appears ONLY when the same single canonical Current lookup the
// roster's grade-sync context uses positively names a DIFFERENT valid
// Current. Current resolution itself is unchanged.
describe("assignment detail - header state (Previous assignment)", () => {
  type Current = { resolution: "valid" | "unresolved" | "invalid" | "inactive"; currentAssignmentId: string | null };

  function seamWith(
    statuses: Readonly<Record<string, AssignmentGradePassbackStatus>>,
    current: Current | (() => Promise<Current>),
  ) {
    const currentCalls: unknown[] = [];
    const seam: AssignmentGradePassbackSeam = {
      ...makeSeam(statuses, async () => "synced"),
      currentReader: async (input) => {
        currentCalls.push(input);
        return typeof current === "function" ? current() : current;
      },
    };
    return { seam, currentCalls };
  }
  const statusPair = (mount: HTMLElement) =>
    mount.querySelector<HTMLElement>("[data-testid=assignment-detail-status]");
  const statusValue = (mount: HTMLElement) =>
    mount.querySelector<HTMLElement>("[data-testid=assignment-detail-status-value]");
  const headerText = (mount: HTMLElement) =>
    mount.querySelector<HTMLElement>("[data-testid=assignment-detail-header]")?.textContent ?? "";

  test("viewed assignment is the valid Current: no Status, no Published, no CURRENT", async () => {
    const { seam, currentCalls } = seamWith({ [STUDENT_ID]: "synced" }, { resolution: "valid", currentAssignmentId: "a1" });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusPair(mount)).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-current-marker]")).toBeNull();
    expect(headerText(mount)).not.toMatch(/Status|Published|Current|Previous/);
    // Current is still resolved (once) for this family.
    expect(currentCalls).toEqual([{ classId: "c1", lessonSlug: "earths-layers" }]);
  });

  test("a different assignment is the valid Current: Previous assignment renders as an informational Status value", async () => {
    const { seam } = seamWith({}, { resolution: "valid", currentAssignmentId: "a4-current" });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusValue(mount)?.textContent).toBe("Previous assignment");
    expect(statusValue(mount)?.tagName).toBe("DD");
    expect(statusValue(mount)?.className).toBe(
      "shell-assignment-detail-status shell-assignment-detail-status-previous",
    );
    const pair = statusPair(mount);
    expect(pair?.getAttribute("data-assignment-state")).toBe("previous");
    expect(pair?.querySelector("dt")?.textContent).toBe("Status");
    // Exposed inside the header's description list, after Class.
    expect(pair?.parentElement?.getAttribute("data-testid")).toBe("assignment-detail-meta");
    // Informational only: no control of any kind, and no closed/deleted claim.
    expect(pair?.querySelector("button, a, input")).toBeNull();
    expect(headerText(mount)).not.toMatch(/Closed|Deleted|Published|Current/);
    // The lifecycle action for a published assignment is unchanged.
  });

  test.each([
    ["no Current pointer (legacy, still operational)", { resolution: "unresolved", currentAssignmentId: null } as Current],
    ["an invalid Current pointer", { resolution: "invalid", currentAssignmentId: null } as Current],
    ["a managed but inactive Current (pointer id not exposed)", { resolution: "inactive", currentAssignmentId: null } as Current],
  ])("%s: no Previous assignment claim and no Status pair", async (_label, current) => {
    const { seam } = seamWith({}, current);
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusPair(mount)).toBeNull();
    expect(headerText(mount)).not.toMatch(/Previous|Published|Current/);
  });

  test("Current lookup failure: no Previous assignment claim (fail closed), header intact", async () => {
    const { seam } = seamWith({}, async () => {
      throw new Error("lifecycle unavailable");
    });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusPair(mount)).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-title]")?.textContent).not.toBe("");
  });

  test("no Current source wired: no Status pair, no Previous assignment", async () => {
    const { mount } = renderWithGradePassback(makeSeam({}, async () => "synced"));
    await settle();
    expect(statusPair(mount)).toBeNull();
  });

  test("closed assignment keeps its visible Closed state and makes no Previous claim", async () => {
    const { seam, currentCalls } = seamWith({}, { resolution: "valid", currentAssignmentId: "a4-current" });
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "a1",
      loadMetadata: async () => ({ ...publishedMeta, status: "closed" as const }),
      summaryCallable: async () => summaryFor(1),
      recipientListCallable,
      attemptsListForClassCallable,
      gradePassback: seam,
    });
    await settle();
    expect(statusValue(mount)?.textContent).toBe("Closed");
    expect(headerText(mount)).not.toMatch(/Previous/);
    // The header no longer needs Current for a closed assignment; with no
    // passback records the roster does not need it either.
    expect(currentCalls).toEqual([]);
  });

  test("Current with a failed automatic sync: no header marker, the operational Retry still renders", async () => {
    const { seam } = seamWith({ [STUDENT_ID]: "failed" }, { resolution: "valid", currentAssignmentId: "a1" });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusPair(mount)).toBeNull();
    expect(statusEl(mount)?.textContent).toBe("Classroom sync failed");
    expect(retryBtn(mount)).not.toBeNull();
  });

  test("previous assignment with a failed record: Previous assignment, muted history, no Retry", async () => {
    const { seam } = seamWith({ [STUDENT_ID]: "failed" }, { resolution: "valid", currentAssignmentId: "a4-current" });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusValue(mount)?.textContent).toBe("Previous assignment");
    expect(statusEl(mount)?.textContent).toBe("Historical Classroom sync failed");
    expect(retryBtn(mount)).toBeNull();
  });

  test("one lifecycle lookup per load is shared by the header and the grade-sync context", async () => {
    const { seam, currentCalls } = seamWith({ [STUDENT_ID]: "failed" }, { resolution: "valid", currentAssignmentId: "a4-current" });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(statusValue(mount)?.textContent).toBe("Previous assignment");
    expect(statusEl(mount)?.textContent).toBe("Historical Classroom sync failed");
    expect(currentCalls).toEqual([{ classId: "c1", lessonSlug: "earths-layers" }]);
  });

  test("a Retry click still re-reads Current fresh (not from the shared cache)", async () => {
    const { seam, currentCalls } = seamWith({ [STUDENT_ID]: "failed" }, { resolution: "valid", currentAssignmentId: "a1" });
    const { mount } = renderWithGradePassback(seam);
    await settle();
    expect(currentCalls.length).toBe(1);
    retryBtn(mount)!.click();
    await settle();
    expect(currentCalls.length).toBe(2);
  });
});
