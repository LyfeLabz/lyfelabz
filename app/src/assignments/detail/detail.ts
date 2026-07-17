import { renderAssignmentSummaryCard } from "../summary/card";
import type { AssignmentSummaryCallable } from "../summary/types";
import type {
  AssignmentDetailMetadata,
  AssignmentDetailMetadataReader,
  AssignmentStatus,
} from "./types";

// Sprint 13B Teacher Assignment Detail surface. A pure DOM builder
// that composes the certified Sprint 13A `renderAssignmentSummaryCard`
// with a small header of already-known assignment metadata (title,
// status, class name). No new backend contract is introduced. No
// student roster. No drill-down. No editing. See
// docs/platform/SPRINT_13B_COMPLETION_REPORT.md for scope.
//
// This module opens no Firestore listener, invokes no firebase API,
// and imports no firebase module. All side effects are injected
// through the deps seam so the entry point can wire whichever real
// implementations are available and tests can inject in-memory fakes.
// A posture test in detail.test.ts asserts the absence of firebase
// imports, callable helpers, snapshot listeners, and browser storage
// APIs in this module and in types.ts.

export type AssignmentDetailDeps = {
  readonly assignmentId: string;
  readonly loadMetadata: AssignmentDetailMetadataReader;
  readonly summaryCallable: AssignmentSummaryCallable;
  readonly onBack?: () => void;
};

const STATUS_LABEL: Readonly<Record<AssignmentStatus, string>> = Object.freeze({
  draft: "Draft",
  published: "Published",
  closed: "Closed",
});

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly metadata: AssignmentDetailMetadata }
  | { readonly kind: "empty" }
  | { readonly kind: "error" };

export function renderAssignmentDetail(
  mount: HTMLElement,
  deps: AssignmentDetailDeps,
): void {
  const doc = mount.ownerDocument;

  const surface = doc.createElement("section");
  surface.className = "shell-card shell-assignment-detail";
  surface.setAttribute("data-testid", "assignment-detail");
  surface.setAttribute("data-assignment-id", deps.assignmentId);
  surface.setAttribute("aria-labelledby", "assignment-detail-headline");

  const headline = doc.createElement("h2");
  headline.id = "assignment-detail-headline";
  headline.className = "shell-assignment-detail-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "assignment-detail-headline");
  headline.textContent = "Assignment";
  surface.appendChild(headline);

  if (deps.onBack !== undefined) {
    const back = doc.createElement("button");
    back.type = "button";
    back.className = "shell-assignment-detail-back";
    back.setAttribute("data-testid", "assignment-detail-back");
    back.setAttribute("aria-label", "Back to previous workspace");
    back.textContent = "Back";
    back.addEventListener("click", () => {
      deps.onBack?.();
    });
    surface.appendChild(back);
  }

  const body = doc.createElement("div");
  body.className = "shell-assignment-detail-body";
  body.setAttribute("data-testid", "assignment-detail-body");
  surface.appendChild(body);

  mount.appendChild(surface);

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
        renderReady(doc, body, s.metadata, deps);
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
      const metadata = await deps.loadMetadata({
        assignmentId: deps.assignmentId,
      });
      if (token !== loadToken) return;
      state =
        metadata === null
          ? { kind: "empty" }
          : { kind: "ready", metadata };
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
  wrap.className = "shell-assignment-detail-loading";
  wrap.setAttribute("data-testid", "assignment-detail-loading");
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");

  const spinner = doc.createElement("span");
  spinner.className = "shell-spinner";
  spinner.setAttribute("data-testid", "assignment-detail-spinner");
  spinner.setAttribute("aria-hidden", "true");
  wrap.appendChild(spinner);

  const label = doc.createElement("span");
  label.className = "shell-assignment-detail-loading-label";
  label.textContent = "Loading assignment";
  wrap.appendChild(label);

  mount.appendChild(wrap);
}

function renderReady(
  doc: Document,
  mount: HTMLElement,
  metadata: AssignmentDetailMetadata,
  deps: AssignmentDetailDeps,
): void {
  const header = doc.createElement("div");
  header.className = "shell-assignment-detail-header";
  header.setAttribute("data-testid", "assignment-detail-header");

  const title = doc.createElement("h3");
  title.className = "shell-assignment-detail-title";
  title.setAttribute("data-testid", "assignment-detail-title");
  title.textContent = metadata.title;
  header.appendChild(title);

  const meta = doc.createElement("dl");
  meta.className = "shell-assignment-detail-meta";
  meta.setAttribute("data-testid", "assignment-detail-meta");

  appendMetaPair(doc, meta, "class", "Class", metadata.className);
  appendMetaPair(
    doc,
    meta,
    "status",
    "Status",
    STATUS_LABEL[metadata.status],
    `shell-assignment-detail-status shell-assignment-detail-status-${metadata.status}`,
  );

  header.appendChild(meta);
  mount.appendChild(header);

  const summaryHost = doc.createElement("div");
  summaryHost.className = "shell-assignment-detail-summary";
  summaryHost.setAttribute("data-testid", "assignment-detail-summary-host");
  mount.appendChild(summaryHost);

  renderAssignmentSummaryCard(summaryHost, {
    callable: deps.summaryCallable,
    assignmentId: metadata.assignmentId,
  });
}

function appendMetaPair(
  doc: Document,
  parent: HTMLElement,
  key: string,
  label: string,
  value: string,
  valueClass?: string,
): void {
  const cell = doc.createElement("div");
  cell.className = "shell-assignment-detail-meta-pair";
  cell.setAttribute("data-testid", `assignment-detail-${key}`);

  const term = doc.createElement("dt");
  term.className = "shell-assignment-detail-meta-label";
  term.textContent = label;
  cell.appendChild(term);

  const val = doc.createElement("dd");
  val.className = valueClass ?? "shell-assignment-detail-meta-value";
  val.setAttribute("data-testid", `assignment-detail-${key}-value`);
  val.textContent = value;
  cell.appendChild(val);

  parent.appendChild(cell);
}

function renderEmpty(doc: Document, mount: HTMLElement): void {
  const wrap = doc.createElement("p");
  wrap.className = "shell-assignment-detail-empty";
  wrap.setAttribute("data-testid", "assignment-detail-empty");
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");
  wrap.textContent =
    "We could not find this assignment. Return to your workspace and open the assignment again.";
  mount.appendChild(wrap);
}

function renderError(
  doc: Document,
  mount: HTMLElement,
  onRetry: () => void,
): void {
  const wrap = doc.createElement("div");
  wrap.className = "shell-assignment-detail-error";
  wrap.setAttribute("data-testid", "assignment-detail-error");
  wrap.setAttribute("role", "alert");

  const message = doc.createElement("p");
  message.className = "shell-assignment-detail-error-message";
  message.textContent =
    "We could not load this assignment right now. Try again in a moment.";
  wrap.appendChild(message);

  const retry = doc.createElement("button");
  retry.type = "button";
  retry.className = "shell-assignment-detail-retry shell-btn";
  retry.setAttribute("data-testid", "assignment-detail-retry");
  retry.textContent = "Try again";
  retry.addEventListener("click", () => {
    onRetry();
  });
  wrap.appendChild(retry);

  mount.appendChild(wrap);
}
