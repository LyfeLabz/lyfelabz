import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
} from "./types";

// Sprint 13A reusable Teacher Assignment Summary card. A pure DOM
// builder that consumes the injected certified callable seam and
// renders the aggregate metrics returned by `assessmentAssignmentSummary`.
//
// The card never derives, aggregates, or recomputes. Every number
// rendered comes directly from the callable response. The backend
// remains authoritative per the certified pipeline (Sprint 12E Slice 1
// and Slice 2C).
//
// Confidentiality: the callable response is aggregate-only by contract
// (see docs/platform/SPRINT_12E_SLICE_1_COMPLETION_REPORT.md section
// 16). The card renders only the ten allowlisted aggregate fields and
// exposes no student ids, names, attempt ids, session ids, raw scores,
// answer information, or ownership metadata. A regression test in
// card.test.ts asserts absence of the full forbidden-field list.

export type AssignmentSummaryCardDeps = {
  readonly callable: AssignmentSummaryCallable;
  readonly assignmentId: string;
};

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly summary: AssignmentSummary }
  | { readonly kind: "empty"; readonly summary: AssignmentSummary }
  | { readonly kind: "error" };

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

const formatCount = (n: number): string => NUMBER_FORMAT.format(n);

const formatPercent = (n: number | null): string =>
  n === null ? "--" : `${NUMBER_FORMAT.format(n)}%`;

type Metric = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
};

const buildMetrics = (summary: AssignmentSummary): ReadonlyArray<Metric> =>
  Object.freeze([
    Object.freeze({
      key: "total-students",
      label: "Total Students",
      value: formatCount(summary.totalStudents),
    }),
    Object.freeze({
      key: "completed",
      label: "Completed",
      value: formatCount(summary.completedStudents),
    }),
    Object.freeze({
      key: "in-progress",
      label: "In Progress",
      value: formatCount(summary.inProgressStudents),
    }),
    Object.freeze({
      key: "not-started",
      label: "Not Started",
      value: formatCount(summary.notStartedStudents),
    }),
    Object.freeze({
      key: "completion-percent",
      label: "Completion",
      value: `${NUMBER_FORMAT.format(summary.completionPercentage)}%`,
    }),
    Object.freeze({
      key: "average-percent",
      label: "Average",
      value: formatPercent(summary.averagePercentage),
    }),
    Object.freeze({
      key: "highest-percent",
      label: "Highest",
      value: formatPercent(summary.highestPercentage),
    }),
    Object.freeze({
      key: "lowest-percent",
      label: "Lowest",
      value: formatPercent(summary.lowestPercentage),
    }),
    Object.freeze({
      key: "perfect-scores",
      label: "Perfect Scores",
      value: formatCount(summary.perfectScoreStudents),
    }),
  ]);

export function renderAssignmentSummaryCard(
  mount: HTMLElement,
  deps: AssignmentSummaryCardDeps,
): void {
  const doc = mount.ownerDocument;

  // A stable frozen-height card container avoids layout shift between
  // loading, success, empty, and error states. Height is preserved via
  // CSS min-height on `.shell-assignment-summary`.
  const card = doc.createElement("section");
  card.className = "shell-assignment-summary shell-card";
  card.setAttribute("data-testid", "assignment-summary");
  card.setAttribute("data-assignment-id", deps.assignmentId);
  card.setAttribute("aria-labelledby", "assignment-summary-headline");

  const headline = doc.createElement("h3");
  headline.id = "assignment-summary-headline";
  headline.className = "shell-assignment-summary-headline";
  headline.textContent = "Assignment Summary";
  card.appendChild(headline);

  const body = doc.createElement("div");
  body.className = "shell-assignment-summary-body";
  body.setAttribute("data-testid", "assignment-summary-body");
  card.appendChild(body);

  mount.appendChild(card);

  let state: LoadState = { kind: "loading" };
  let loadToken = 0;

  const rerender = (): void => {
    body.textContent = "";
    if (!mount.isConnected) return;
    const s: LoadState = state;
    switch (s.kind) {
      case "loading":
        renderLoading(doc, body);
        return;
      case "ready":
        renderMetrics(doc, body, s.summary);
        return;
      case "empty":
        renderEmpty(doc, body);
        return;
      case "error":
        renderError(doc, body, () => {
          void load();
        });
        return;
    }
  };

  const load = async (): Promise<void> => {
    const token = ++loadToken;
    state = { kind: "loading" };
    rerender();
    try {
      const summary = await deps.callable({ assignmentId: deps.assignmentId });
      if (token !== loadToken) return;
      state =
        summary.totalStudents === 0
          ? { kind: "empty", summary }
          : { kind: "ready", summary };
      rerender();
    } catch {
      if (token !== loadToken) return;
      state = { kind: "error" };
      rerender();
    }
  };

  void load();
}

function renderLoading(doc: Document, mount: HTMLElement): void {
  const wrap = doc.createElement("div");
  wrap.className = "shell-assignment-summary-loading";
  wrap.setAttribute("data-testid", "assignment-summary-loading");
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");

  const spinner = doc.createElement("span");
  spinner.className = "shell-spinner";
  spinner.setAttribute("data-testid", "assignment-summary-spinner");
  spinner.setAttribute("aria-hidden", "true");
  wrap.appendChild(spinner);

  const label = doc.createElement("span");
  label.className = "shell-assignment-summary-loading-label";
  label.textContent = "Loading assignment summary";
  wrap.appendChild(label);

  mount.appendChild(wrap);
}

function renderMetrics(
  doc: Document,
  mount: HTMLElement,
  summary: AssignmentSummary,
): void {
  const grid = doc.createElement("dl");
  grid.className = "shell-assignment-summary-grid";
  grid.setAttribute("data-testid", "assignment-summary-metrics");

  for (const metric of buildMetrics(summary)) {
    const cell = doc.createElement("div");
    cell.className = "shell-assignment-summary-metric";
    cell.setAttribute("data-testid", `assignment-summary-metric-${metric.key}`);

    const term = doc.createElement("dt");
    term.className = "shell-assignment-summary-metric-label";
    term.textContent = metric.label;
    cell.appendChild(term);

    const value = doc.createElement("dd");
    value.className = "shell-assignment-summary-metric-value";
    value.setAttribute(
      "data-testid",
      `assignment-summary-value-${metric.key}`,
    );
    value.textContent = metric.value;
    cell.appendChild(value);

    grid.appendChild(cell);
  }

  mount.appendChild(grid);
}

function renderEmpty(doc: Document, mount: HTMLElement): void {
  const wrap = doc.createElement("p");
  wrap.className = "shell-assignment-summary-empty";
  wrap.setAttribute("data-testid", "assignment-summary-empty");
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");
  wrap.textContent =
    "No students are assigned to this activity yet. The summary will appear once students are added.";
  mount.appendChild(wrap);
}

function renderError(
  doc: Document,
  mount: HTMLElement,
  onRetry: () => void,
): void {
  const wrap = doc.createElement("div");
  wrap.className = "shell-assignment-summary-error";
  wrap.setAttribute("data-testid", "assignment-summary-error");
  wrap.setAttribute("role", "alert");

  const message = doc.createElement("p");
  message.className = "shell-assignment-summary-error-message";
  message.textContent =
    "We could not load this assignment summary right now. Try again in a moment.";
  wrap.appendChild(message);

  const retry = doc.createElement("button");
  retry.type = "button";
  retry.className = "shell-assignment-summary-retry shell-btn";
  retry.setAttribute("data-testid", "assignment-summary-retry");
  retry.textContent = "Try again";
  retry.addEventListener("click", () => {
    onRetry();
  });
  wrap.appendChild(retry);

  mount.appendChild(wrap);
}
