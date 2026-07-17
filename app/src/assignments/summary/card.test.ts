/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";
import { renderAssignmentSummaryCard } from "./card";
import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
} from "./types";

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const freezeSummary = (
  overrides: Partial<AssignmentSummary> = {},
): AssignmentSummary =>
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
    ...overrides,
  }) as AssignmentSummary;

const resolving =
  (summary: AssignmentSummary): AssignmentSummaryCallable =>
  () =>
    Promise.resolve(summary);

const rejecting = (): AssignmentSummaryCallable => () =>
  Promise.reject(new Error("callable failed"));

describe("renderAssignmentSummaryCard - loading state", () => {
  test("renders the loading spinner immediately", () => {
    const mount = mkMount();
    let resolve: (v: AssignmentSummary) => void = () => undefined;
    const callable: AssignmentSummaryCallable = () =>
      new Promise<AssignmentSummary>((r) => {
        resolve = r;
      });
    renderAssignmentSummaryCard(mount, {
      callable,
      assignmentId: "assign-1",
    });
    expect(
      mount.querySelector("[data-testid=assignment-summary-spinner]"),
    ).not.toBeNull();
    expect(
      mount
        .querySelector("[data-testid=assignment-summary-loading]")
        ?.getAttribute("role"),
    ).toBe("status");
    resolve(freezeSummary());
  });

  test("loading indicator disappears once the summary resolves", async () => {
    const mount = mkMount();
    renderAssignmentSummaryCard(mount, {
      callable: resolving(freezeSummary()),
      assignmentId: "assign-1",
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=assignment-summary-spinner]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-summary-metrics]"),
    ).not.toBeNull();
  });
});

describe("renderAssignmentSummaryCard - success state", () => {
  test("renders every one of the nine allowlisted metrics", async () => {
    const mount = mkMount();
    renderAssignmentSummaryCard(mount, {
      callable: resolving(freezeSummary()),
      assignmentId: "assign-1",
    });
    await flush();
    for (const key of [
      "total-students",
      "completed",
      "in-progress",
      "not-started",
      "completion-percent",
      "average-percent",
      "highest-percent",
      "lowest-percent",
      "perfect-scores",
    ]) {
      expect(
        mount.querySelector(`[data-testid=assignment-summary-metric-${key}]`),
      ).not.toBeNull();
    }
  });

  test("renders the exact counts and percentages returned by the callable", async () => {
    const mount = mkMount();
    renderAssignmentSummaryCard(mount, {
      callable: resolving(
        freezeSummary({
          totalStudents: 24,
          completedStudents: 12,
          inProgressStudents: 6,
          notStartedStudents: 6,
          completionPercentage: 50,
          averagePercentage: 82,
          highestPercentage: 100,
          lowestPercentage: 45,
          perfectScoreStudents: 3,
        }),
      ),
      assignmentId: "assign-1",
    });
    await flush();
    const value = (key: string): string | null =>
      mount.querySelector(`[data-testid=assignment-summary-value-${key}]`)
        ?.textContent ?? null;
    expect(value("total-students")).toBe("24");
    expect(value("completed")).toBe("12");
    expect(value("in-progress")).toBe("6");
    expect(value("not-started")).toBe("6");
    expect(value("completion-percent")).toBe("50%");
    expect(value("average-percent")).toBe("82%");
    expect(value("highest-percent")).toBe("100%");
    expect(value("lowest-percent")).toBe("45%");
    expect(value("perfect-scores")).toBe("3");
  });

  test("renders zero counts correctly when no students have completed", async () => {
    const mount = mkMount();
    renderAssignmentSummaryCard(mount, {
      callable: resolving(
        freezeSummary({
          totalStudents: 5,
          completedStudents: 0,
          inProgressStudents: 0,
          notStartedStudents: 5,
          completionPercentage: 0,
          averagePercentage: null,
          highestPercentage: null,
          lowestPercentage: null,
          perfectScoreStudents: 0,
        }),
      ),
      assignmentId: "assign-2",
    });
    await flush();
    const value = (key: string): string | null =>
      mount.querySelector(`[data-testid=assignment-summary-value-${key}]`)
        ?.textContent ?? null;
    expect(value("completed")).toBe("0");
    expect(value("in-progress")).toBe("0");
    expect(value("not-started")).toBe("5");
    expect(value("perfect-scores")).toBe("0");
    expect(value("completion-percent")).toBe("0%");
  });

  test("renders a placeholder for null average, highest, and lowest percentages", async () => {
    const mount = mkMount();
    renderAssignmentSummaryCard(mount, {
      callable: resolving(
        freezeSummary({
          completedStudents: 0,
          averagePercentage: null,
          highestPercentage: null,
          lowestPercentage: null,
        }),
      ),
      assignmentId: "assign-2",
    });
    await flush();
    const value = (key: string): string | null =>
      mount.querySelector(`[data-testid=assignment-summary-value-${key}]`)
        ?.textContent ?? null;
    expect(value("average-percent")).toBe("--");
    expect(value("highest-percent")).toBe("--");
    expect(value("lowest-percent")).toBe("--");
  });
});

describe("renderAssignmentSummaryCard - empty state", () => {
  test("renders the empty-state message when totalStudents is zero", async () => {
    const mount = mkMount();
    renderAssignmentSummaryCard(mount, {
      callable: resolving(
        freezeSummary({
          totalStudents: 0,
          completedStudents: 0,
          inProgressStudents: 0,
          notStartedStudents: 0,
          completionPercentage: 0,
          averagePercentage: null,
          highestPercentage: null,
          lowestPercentage: null,
          perfectScoreStudents: 0,
        }),
      ),
      assignmentId: "assign-empty",
    });
    await flush();
    const empty = mount.querySelector(
      "[data-testid=assignment-summary-empty]",
    );
    expect(empty).not.toBeNull();
    expect(empty?.getAttribute("role")).toBe("status");
    expect(empty?.textContent ?? "").toContain("No students are assigned");
    expect(
      mount.querySelector("[data-testid=assignment-summary-metrics]"),
    ).toBeNull();
  });

  test("empty state never exposes implementation details like recipient collections", async () => {
    const mount = mkMount();
    renderAssignmentSummaryCard(mount, {
      callable: resolving(
        freezeSummary({
          totalStudents: 0,
          completedStudents: 0,
          inProgressStudents: 0,
          notStartedStudents: 0,
          completionPercentage: 0,
          averagePercentage: null,
          highestPercentage: null,
          lowestPercentage: null,
          perfectScoreStudents: 0,
        }),
      ),
      assignmentId: "assign-empty",
    });
    await flush();
    const text = mount.textContent ?? "";
    for (const forbidden of [
      "recipient",
      "enrollment",
      "roster",
      "collection",
      "Firestore",
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("renderAssignmentSummaryCard - error state", () => {
  test("renders the error state when the callable rejects", async () => {
    const mount = mkMount();
    renderAssignmentSummaryCard(mount, {
      callable: rejecting(),
      assignmentId: "assign-err",
    });
    await flush();
    const err = mount.querySelector("[data-testid=assignment-summary-error]");
    expect(err).not.toBeNull();
    expect(err?.getAttribute("role")).toBe("alert");
    expect(
      mount.querySelector("[data-testid=assignment-summary-retry]"),
    ).not.toBeNull();
  });

  test("retry re-invokes the callable and renders the recovered summary", async () => {
    const mount = mkMount();
    let calls = 0;
    const callable: AssignmentSummaryCallable = () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve(freezeSummary());
    };
    renderAssignmentSummaryCard(mount, {
      callable,
      assignmentId: "assign-err",
    });
    await flush();
    const retry = mount.querySelector(
      "[data-testid=assignment-summary-retry]",
    ) as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
    retry!.click();
    await flush();
    expect(calls).toBe(2);
    expect(
      mount.querySelector("[data-testid=assignment-summary-metrics]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-summary-error]"),
    ).toBeNull();
  });

  test("error state never exposes backend identifiers or stack traces", async () => {
    const mount = mkMount();
    const err = new Error("Firestore permission-denied at attempts/{attempt-42}");
    renderAssignmentSummaryCard(mount, {
      callable: () => Promise.reject(err),
      assignmentId: "assign-err",
    });
    await flush();
    const text = mount.textContent ?? "";
    expect(text).not.toContain("permission-denied");
    expect(text).not.toContain("attempts/");
    expect(text).not.toContain("Firestore");
    expect(text).not.toContain("attempt-42");
  });
});

describe("renderAssignmentSummaryCard - confidentiality invariants", () => {
  test("never renders any forbidden identifier or student payload", async () => {
    const mount = mkMount();
    renderAssignmentSummaryCard(mount, {
      callable: resolving(freezeSummary()),
      assignmentId: "assign-conf",
    });
    await flush();
    const text = mount.textContent ?? "";
    for (const forbidden of [
      "studentId",
      "student-id",
      "recipientId",
      "attemptId",
      "sessionId",
      "teacherId",
      "districtId",
      "schoolId",
      "displayName",
      "response",
      "answerKey",
      "explanation",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("renderAssignmentSummaryCard - request behavior", () => {
  test("issues exactly one callable request per mount", async () => {
    const mount = mkMount();
    let calls = 0;
    const callable: AssignmentSummaryCallable = () => {
      calls += 1;
      return Promise.resolve(freezeSummary());
    };
    renderAssignmentSummaryCard(mount, {
      callable,
      assignmentId: "assign-1",
    });
    await flush();
    expect(calls).toBe(1);
  });

  test("mounting a second card for a different assignment reloads exactly once", async () => {
    const mountA = mkMount();
    const mountB = mkMount();
    const calls: string[] = [];
    const callable: AssignmentSummaryCallable = ({ assignmentId }) => {
      calls.push(assignmentId);
      return Promise.resolve(freezeSummary({ assignmentId }));
    };
    renderAssignmentSummaryCard(mountA, {
      callable,
      assignmentId: "assign-A",
    });
    renderAssignmentSummaryCard(mountB, {
      callable,
      assignmentId: "assign-B",
    });
    await flush();
    expect(calls).toEqual(["assign-A", "assign-B"]);
  });
});

describe("renderAssignmentSummaryCard - accessibility", () => {
  test("card has an accessible heading and aria-labelledby", async () => {
    const mount = mkMount();
    renderAssignmentSummaryCard(mount, {
      callable: resolving(freezeSummary()),
      assignmentId: "assign-1",
    });
    await flush();
    const card = mount.querySelector("[data-testid=assignment-summary]");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("aria-labelledby")).toBe(
      "assignment-summary-headline",
    );
    expect(
      mount.querySelector("#assignment-summary-headline")?.textContent,
    ).toBe("Assignment Summary");
  });

  test("loading and empty states announce via aria-live=polite", async () => {
    const mount = mkMount();
    let resolve: (v: AssignmentSummary) => void = () => undefined;
    const callable: AssignmentSummaryCallable = () =>
      new Promise<AssignmentSummary>((r) => {
        resolve = r;
      });
    renderAssignmentSummaryCard(mount, {
      callable,
      assignmentId: "assign-1",
    });
    expect(
      mount
        .querySelector("[data-testid=assignment-summary-loading]")
        ?.getAttribute("aria-live"),
    ).toBe("polite");
    resolve(
      freezeSummary({
        totalStudents: 0,
        completedStudents: 0,
        inProgressStudents: 0,
        notStartedStudents: 0,
        completionPercentage: 0,
        averagePercentage: null,
        highestPercentage: null,
        lowestPercentage: null,
        perfectScoreStudents: 0,
      }),
    );
    await flush();
    expect(
      mount
        .querySelector("[data-testid=assignment-summary-empty]")
        ?.getAttribute("aria-live"),
    ).toBe("polite");
  });
});

describe("assignments/summary posture", () => {
  test("card.ts imports nothing from firebase/*", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "card.ts"),
      "utf8",
    );
    expect(src).not.toContain('from "firebase/');
    expect(src).not.toContain("httpsCallable(");
    expect(src).not.toContain("onSnapshot(");
    expect(src).not.toContain("localStorage");
    expect(src).not.toContain("sessionStorage");
  });

  test("types.ts imports nothing from firebase/*", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "types.ts"),
      "utf8",
    );
    expect(src).not.toContain('from "firebase/');
  });
});
