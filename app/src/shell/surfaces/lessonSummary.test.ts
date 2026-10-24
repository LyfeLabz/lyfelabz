/**
 * @jest-environment jsdom
 *
 * Sprint 28.6E tests for the Curriculum-owned lesson-level View Summary
 * surface. The surface is aggregate-only: it renders exactly the four
 * locked metrics (Classes Assigned, Students, Completion, Average Best
 * Score) plus the unique-student completed/total fraction, and never lists
 * individual students, rosters, or attempts.
 */
import type {
  LessonSummary,
  LessonSummaryCallable,
} from "../../assignments/summary/types";
import { renderLessonSummarySurface } from "./lessonSummary";

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const mkHost = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const summary = (over: Partial<LessonSummary> = {}): LessonSummary =>
  freeze({
    lessonSlug: "earths-layers",
    classesAssigned: 4,
    students: 72,
    studentsCompleted: 64,
    completionPercentage: 89,
    averageBestPercentage: 81,
    assignmentsConsidered: 6,
    ...over,
  });

const resolving =
  (value: LessonSummary): LessonSummaryCallable =>
  () =>
    Promise.resolve(value);

const rejecting = (): LessonSummaryCallable => () =>
  Promise.reject(new Error("callable exploded: internal/emulator detail"));

const render = (
  callable: LessonSummaryCallable,
  onBack: () => void = () => undefined,
): HTMLElement => {
  const host = mkHost();
  renderLessonSummarySurface(host, {
    doc: document,
    lessonTitle: "Earth's Layers",
    lessonSlug: "earths-layers",
    lessonSummary: callable,
    onBack,
  });
  return host;
};

describe("renderLessonSummarySurface", () => {
  test("shows an intentional loading state before the callable resolves", () => {
    const host = render(resolving(summary()));
    const loading = host.querySelector("[data-testid=lesson-summary-loading]");
    expect(loading).not.toBeNull();
    expect(loading!.getAttribute("role")).toBe("status");
    // No zero-value metrics flash before data arrives.
    expect(
      host.querySelector("[data-testid=lesson-summary-metrics]"),
    ).toBeNull();
  });

  test("renders the four locked metrics with backend values", async () => {
    const host = render(resolving(summary()));
    await flush();
    expect(
      host.querySelector("[data-testid=lesson-summary-value-classes]")!
        .textContent,
    ).toBe("4");
    expect(
      host.querySelector("[data-testid=lesson-summary-value-students]")!
        .textContent,
    ).toBe("72");
    expect(
      host.querySelector("[data-testid=lesson-summary-value-completion]")!
        .textContent,
    ).toBe("89%");
    // Sprint 28.6H.5 (Task B3, J#12/13): Completion shows the fraction with the
    // word "students" DROPPED - "X / Y completed", not "X / Y students
    // completed". The calculation is unchanged.
    expect(
      host.querySelector("[data-testid=lesson-summary-detail-completion]")!
        .textContent,
    ).toBe("64 / 72 completed");
    expect(
      host.querySelector("[data-testid=lesson-summary-value-average]")!
        .textContent,
    ).toBe("81%");
    // Loading state is gone.
    expect(
      host.querySelector("[data-testid=lesson-summary-loading]"),
    ).toBeNull();
  });

  test("Sprint 28.6H.5 (Task B1/B2): no explanatory subtitle and no Classes navigation instruction", async () => {
    const host = render(resolving(summary()));
    await flush();
    // B1: the introductory subtitle is removed and not replaced.
    expect(host.querySelector("[data-testid=lesson-summary-subhead]")).toBeNull();
    // B2: the "open the class under Classes" instruction and any foot note are gone.
    expect(host.querySelector("[data-testid=lesson-summary-foot]")).toBeNull();
    const text = host.textContent ?? "";
    expect(text).not.toContain(
      "How this lesson has performed across your classes and assignments.",
    );
    expect(text).not.toContain(
      "To see which students still need to finish, open the class under Classes.",
    );
    // The title flows directly into the metrics.
    expect(host.querySelector("[data-testid=lesson-summary-metrics]")).not.toBeNull();
  });

  test("zero-completion is valid data, not an error", async () => {
    const host = render(
      resolving(
        summary({
          classesAssigned: 1,
          students: 22,
          studentsCompleted: 0,
          completionPercentage: 0,
          averageBestPercentage: null,
        }),
      ),
    );
    await flush();
    expect(
      host.querySelector("[data-testid=lesson-summary-error]"),
    ).toBeNull();
    expect(
      host.querySelector("[data-testid=lesson-summary-value-completion]")!
        .textContent,
    ).toBe("0%");
    expect(
      host.querySelector("[data-testid=lesson-summary-detail-completion]")!
        .textContent,
    ).toBe("0 / 22 completed");
  });

  test("null average renders a calm no-data note, never 0%", async () => {
    const host = render(
      resolving(summary({ studentsCompleted: 0, averageBestPercentage: null })),
    );
    await flush();
    const avg = host.querySelector(
      "[data-testid=lesson-summary-value-average]",
    )!;
    expect(avg.textContent).toBe("No completed scores yet");
    expect(avg.textContent).not.toContain("0%");
  });

  test("error state uses role=alert with calm copy and a keyboard retry", async () => {
    const host = render(rejecting());
    await flush();
    const alert = host.querySelector("[data-testid=lesson-summary-error]");
    expect(alert).not.toBeNull();
    expect(alert!.getAttribute("role")).toBe("alert");
    // No raw Firebase/callable detail leaks to the teacher.
    expect(alert!.textContent).not.toContain("callable");
    expect(alert!.textContent).not.toContain("internal");
    const retry = host.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-summary-retry]",
    );
    expect(retry).not.toBeNull();
    expect(retry!.tagName).toBe("BUTTON");
  });

  test("retry re-invokes the callable and can recover", async () => {
    const host = mkHost();
    let calls = 0;
    const callable: LessonSummaryCallable = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("transient"))
        : Promise.resolve(summary({ classesAssigned: 2 }));
    };
    renderLessonSummarySurface(host, {
      doc: document,
      lessonTitle: "Earth's Layers",
      lessonSlug: "earths-layers",
      lessonSummary: callable,
      onBack: () => undefined,
    });
    await flush();
    host
      .querySelector<HTMLButtonElement>("[data-testid=lesson-summary-retry]")!
      .click();
    await flush();
    expect(calls).toBe(2);
    expect(
      host.querySelector("[data-testid=lesson-summary-error]"),
    ).toBeNull();
    expect(
      host.querySelector("[data-testid=lesson-summary-value-classes]")!
        .textContent,
    ).toBe("2");
  });

  test("Back to Curriculum is a keyboard-operable button that calls onBack", async () => {
    const onBack = jest.fn();
    const host = render(resolving(summary()), onBack);
    await flush();
    const back = host.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-summary-back]",
    );
    expect(back).not.toBeNull();
    expect(back!.tagName).toBe("BUTTON");
    expect(back!.textContent).toBe("Back to Curriculum");
    // Control hierarchy Op 1: the shared Teacher Workspace Back control.
    expect(back!.classList.contains("shell-back")).toBe(true);
    back!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("surface is aggregate-only: a labelled heading, no roster/table markup", async () => {
    const host = render(resolving(summary()));
    await flush();
    const section = host.querySelector(
      "[data-testid=lesson-summary-surface]",
    )!;
    // Results-first: the accessible name is "Results <lesson title>".
    expect(section.getAttribute("aria-labelledby")).toBe(
      "lesson-summary-eyebrow lesson-summary-heading",
    );
    // No student rows, roster tables, or per-attempt lists.
    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector("[data-testid^=student-]")).toBeNull();
    expect(host.querySelector("[data-testid^=roster-]")).toBeNull();
    // Metrics are a semantic definition list.
    expect(
      host.querySelector("dl[data-testid=lesson-summary-metrics]"),
    ).not.toBeNull();
  });
});

describe("Results presentation and Manage Assignments (results-first)", () => {
  test("presents the surface as Results with Results loading/error copy", async () => {
    const host = render(rejecting());
    expect(
      host.querySelector("[data-testid=lesson-summary-eyebrow]")!.textContent,
    ).toBe("Results");
    expect(host.textContent).not.toMatch(/Summary|summary/);
    await flush();
    expect(
      host.querySelector("[data-testid=lesson-summary-error]")!.textContent,
    ).toMatch(/We could not load these results/);
  });

  test("Manage Assignments is a header button that calls onManageAssignments, available before data loads", () => {
    const host = mkHost();
    let calls = 0;
    renderLessonSummarySurface(host, {
      doc: document,
      lessonTitle: "Earth's Layers",
      lessonSlug: "earths-layers",
      lessonSummary: () => new Promise(() => undefined),
      onBack: () => undefined,
      onManageAssignments: () => {
        calls += 1;
      },
    });
    const manage = host.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-summary-manage]",
    )!;
    expect(manage.tagName).toBe("BUTTON");
    expect(manage.type).toBe("button");
    expect(manage.textContent).toBe("Manage Assignments");
    expect(manage.getAttribute("aria-label")).toBe(
      "Manage assignments for Earth's Layers",
    );
    expect(
      host.querySelector("[data-testid=lesson-summary-header]")!.contains(manage),
    ).toBe(true);
    manage.click();
    expect(calls).toBe(1);
  });

  test("no Manage Assignments control when no workflow is wired", () => {
    const host = render(resolving(summary()));
    expect(host.querySelector("[data-testid=lesson-summary-manage]")).toBeNull();
  });
});

describe("Results load failure keeps assignment management reachable", () => {
  test("a failed read shows the retry state and Manage Assignments still works", async () => {
    const host = mkHost();
    let calls = 0;
    renderLessonSummarySurface(host, {
      doc: document,
      lessonTitle: "Earth's Layers",
      lessonSlug: "earths-layers",
      lessonSummary: rejecting(),
      onBack: () => undefined,
      onManageAssignments: () => {
        calls += 1;
      },
    });
    await flush();
    expect(host.querySelector("[data-testid=lesson-summary-retry]")).not.toBeNull();
    host.querySelector<HTMLButtonElement>("[data-testid=lesson-summary-manage]")!.click();
    expect(calls).toBe(1);
  });

  test("refresh() re-reads the callable and only the newest response renders", async () => {
    const host = mkHost();
    const resolvers: Array<(v: LessonSummary) => void> = [];
    const handle = renderLessonSummarySurface(host, {
      doc: document,
      lessonTitle: "Earth's Layers",
      lessonSlug: "earths-layers",
      lessonSummary: () => new Promise<LessonSummary>((r) => resolvers.push(r)),
      onBack: () => undefined,
    });
    handle.refresh();
    expect(resolvers).toHaveLength(2);
    resolvers[1]!(summary({ classesAssigned: 5 }));
    await flush();
    resolvers[0]!(summary({ classesAssigned: 1 }));
    await flush();
    expect(
      host.querySelector("[data-testid=lesson-summary-value-classes]")!.textContent,
    ).toBe("5");
  });
});
