import { renderAssignmentSummaryCard } from "../summary/card";
import type { AssignmentSummaryCallable } from "../summary/types";
import type {
  AssignmentDetailMetadata,
  AssignmentDetailMetadataReader,
  AssignmentStatus,
  AssignmentsCloseCallable,
  AssignmentsReopenCallable,
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
  // Sprint 13D: optional close-assignment lifecycle seam. When supplied
  // and the loaded metadata is `published`, the surface renders a
  // secondary `Close assignment` action that opens a confirmation
  // dialog and, on confirm, invokes the callable exactly once. On
  // success the header status transitions to `Closed`, the action is
  // replaced with a non-interactive `Assignment closed` label, and
  // `onStatusChange` (when supplied) is invoked with the updated
  // metadata so the session-scoped registry can be re-registered. When
  // the seam is not supplied, the surface renders no close action; the
  // remainder of the surface is unchanged.
  readonly closeCallable?: AssignmentsCloseCallable;
  // Sprint 13E: optional reopen-assignment lifecycle seam and inverse
  // of `closeCallable`. When supplied and the loaded metadata is
  // `closed`, the surface renders a secondary `Reopen assignment`
  // action in place of the `Assignment closed` label. Activating the
  // action opens a confirmation dialog and, on confirm, invokes the
  // callable exactly once. On success the header status transitions to
  // `Published`, the action is replaced with the Sprint 13D
  // `Close assignment` action (when `closeCallable` is also supplied),
  // and `onStatusChange` (when supplied) fires with the updated
  // metadata so the session-scoped registry can be re-registered.
  // When the seam is not supplied, the surface renders no reopen
  // action; the Sprint 13D `Assignment closed` label continues to
  // render.
  readonly reopenCallable?: AssignmentsReopenCallable;
  readonly onStatusChange?: (metadata: AssignmentDetailMetadata) => void;
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

type CloseUiState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "error" };

type ReopenUiState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
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
  let closeUi: CloseUiState = { kind: "idle" };
  let reopenUi: ReopenUiState = { kind: "idle" };

  const rerender = (): void => {
    body.textContent = "";
    if (!mount.isConnected) return;
    const s: LoadState = state;
    switch (s.kind) {
      case "loading":
        renderLoading(doc, body);
        return;
      case "ready":
        renderReady(doc, body, s.metadata, deps, closeUi, reopenUi, {
          onCloseRequest: () => {
            openCloseConfirmation(s.metadata);
          },
          onReopenRequest: () => {
            openReopenConfirmation(s.metadata);
          },
        });
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

  const openCloseConfirmation = (metadata: AssignmentDetailMetadata): void => {
    if (deps.closeCallable === undefined) return;
    if (metadata.status !== "published") return;
    const confirmController: CloseConfirmController = {
      onCancel: () => {
        confirmController.close();
      },
      onConfirm: () => {
        confirmController.close();
        void performClose(metadata);
      },
      close: () => undefined,
    };
    confirmController.close = renderCloseConfirmDialog(
      doc,
      metadata,
      confirmController,
    );
  };

  const openReopenConfirmation = (metadata: AssignmentDetailMetadata): void => {
    if (deps.reopenCallable === undefined) return;
    if (metadata.status !== "closed") return;
    const confirmController: ReopenConfirmController = {
      onCancel: () => {
        confirmController.close();
      },
      onConfirm: () => {
        confirmController.close();
        void performReopen(metadata);
      },
      close: () => undefined,
    };
    confirmController.close = renderReopenConfirmDialog(
      doc,
      metadata,
      confirmController,
    );
  };

  const performReopen = async (
    metadata: AssignmentDetailMetadata,
  ): Promise<void> => {
    const callable = deps.reopenCallable;
    if (callable === undefined) return;
    reopenUi = { kind: "pending" };
    rerender();
    try {
      const result = await callable({ assignmentId: metadata.assignmentId });
      if (state.kind !== "ready") return;
      const nextMetadata = Object.freeze({
        ...metadata,
        status: "published" as AssignmentStatus,
      });
      state = { kind: "ready", metadata: nextMetadata };
      reopenUi = { kind: "idle" };
      // A successful reopen also clears any stale close error surfaced
      // from a previous close attempt on this assignment; the two
      // lifecycle actions never render at the same time, so the close
      // error UI would otherwise be attached to a Published header.
      closeUi = { kind: "idle" };
      rerender();
      deps.onStatusChange?.(nextMetadata);
      void result;
    } catch {
      reopenUi = { kind: "error" };
      rerender();
    }
  };

  const performClose = async (
    metadata: AssignmentDetailMetadata,
  ): Promise<void> => {
    const callable = deps.closeCallable;
    if (callable === undefined) return;
    closeUi = { kind: "pending" };
    rerender();
    try {
      const result = await callable({ assignmentId: metadata.assignmentId });
      if (state.kind !== "ready") return;
      const nextMetadata = Object.freeze({
        ...metadata,
        status: "closed" as AssignmentStatus,
      });
      state = { kind: "ready", metadata: nextMetadata };
      closeUi = { kind: "idle" };
      // Symmetric to performReopen: clear any stale reopen error so the
      // Closed header never carries a Reopen error banner.
      reopenUi = { kind: "idle" };
      rerender();
      deps.onStatusChange?.(nextMetadata);
      void result;
    } catch {
      closeUi = { kind: "error" };
      rerender();
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
  closeUi: CloseUiState,
  reopenUi: ReopenUiState,
  handlers: {
    readonly onCloseRequest: () => void;
    readonly onReopenRequest: () => void;
  },
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

  // Sprint 13F: a draft assignment renders a calm non-interactive
  // `Draft assignment` label in place of any lifecycle action. Draft
  // discovery is the persistent behavior introduced by this sprint; no
  // Close or Reopen affordance is available for a draft because
  // publication is out of scope. The label renders whether or not
  // lifecycle seams are wired, so a teacher who reloads into a draft
  // never sees an empty header region.
  if (metadata.status === "draft") {
    const lifecycle = doc.createElement("div");
    lifecycle.className = "shell-assignment-detail-lifecycle";
    lifecycle.setAttribute("data-testid", "assignment-detail-lifecycle");
    const draftLabel = doc.createElement("p");
    draftLabel.className = "shell-assignment-detail-draft-label";
    draftLabel.setAttribute(
      "data-testid",
      "assignment-detail-draft-label",
    );
    draftLabel.setAttribute("role", "status");
    draftLabel.setAttribute("aria-live", "polite");
    draftLabel.textContent = "Draft assignment";
    lifecycle.appendChild(draftLabel);
    header.appendChild(lifecycle);
  } else if (
    deps.closeCallable !== undefined ||
    deps.reopenCallable !== undefined
  ) {
    const lifecycle = doc.createElement("div");
    lifecycle.className = "shell-assignment-detail-lifecycle";
    lifecycle.setAttribute("data-testid", "assignment-detail-lifecycle");
    if (metadata.status === "published" && deps.closeCallable !== undefined) {
      const closeButton = doc.createElement("button");
      closeButton.type = "button";
      closeButton.className =
        "shell-btn shell-assignment-detail-close-action";
      closeButton.setAttribute(
        "data-testid",
        "assignment-detail-close-action",
      );
      closeButton.textContent = "Close assignment";
      if (closeUi.kind === "pending") {
        closeButton.disabled = true;
        closeButton.setAttribute("aria-busy", "true");
      }
      closeButton.addEventListener("click", () => {
        handlers.onCloseRequest();
      });
      lifecycle.appendChild(closeButton);
    } else if (
      metadata.status === "closed" &&
      deps.reopenCallable !== undefined
    ) {
      // Sprint 13E: reopen action supersedes the Sprint 13D closed-state
      // label so exactly one lifecycle action is visible.
      const reopenButton = doc.createElement("button");
      reopenButton.type = "button";
      reopenButton.className =
        "shell-btn shell-assignment-detail-reopen-action";
      reopenButton.setAttribute(
        "data-testid",
        "assignment-detail-reopen-action",
      );
      reopenButton.textContent = "Reopen assignment";
      if (reopenUi.kind === "pending") {
        reopenButton.disabled = true;
        reopenButton.setAttribute("aria-busy", "true");
      }
      reopenButton.addEventListener("click", () => {
        handlers.onReopenRequest();
      });
      lifecycle.appendChild(reopenButton);
    } else if (metadata.status === "closed") {
      const closedLabel = doc.createElement("p");
      closedLabel.className = "shell-assignment-detail-closed-label";
      closedLabel.setAttribute(
        "data-testid",
        "assignment-detail-closed-label",
      );
      closedLabel.setAttribute("role", "status");
      closedLabel.setAttribute("aria-live", "polite");
      closedLabel.textContent = "Assignment closed";
      lifecycle.appendChild(closedLabel);
    }
    if (closeUi.kind === "error") {
      const err = doc.createElement("p");
      err.className = "shell-assignment-detail-close-error";
      err.setAttribute("data-testid", "assignment-detail-close-error");
      err.setAttribute("role", "alert");
      err.textContent =
        "We could not close this assignment right now. Try again in a moment.";
      lifecycle.appendChild(err);
    }
    if (reopenUi.kind === "error") {
      const err = doc.createElement("p");
      err.className = "shell-assignment-detail-reopen-error";
      err.setAttribute("data-testid", "assignment-detail-reopen-error");
      err.setAttribute("role", "alert");
      err.textContent =
        "We could not reopen this assignment right now. Try again in a moment.";
      lifecycle.appendChild(err);
    }
    header.appendChild(lifecycle);
  }

  mount.appendChild(header);

  // Sprint 13F reconciliation: a draft assignment has no recipients, no
  // sessions, and no attempts, so the Sprint 13A summary card would only
  // render its own empty / error state. Render a calm informational
  // panel in its place. Published and closed assignments continue to
  // compose the certified Sprint 13A `renderAssignmentSummaryCard`
  // unchanged.
  if (metadata.status === "draft") {
    const panel = doc.createElement("section");
    panel.className =
      "shell-assignment-detail-summary shell-assignment-detail-draft-summary";
    panel.setAttribute(
      "data-testid",
      "assignment-detail-draft-summary",
    );
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.setAttribute(
      "aria-labelledby",
      "assignment-detail-draft-summary-heading",
    );

    const heading = doc.createElement("h3");
    heading.id = "assignment-detail-draft-summary-heading";
    heading.className = "shell-assignment-detail-draft-summary-heading";
    heading.setAttribute(
      "data-testid",
      "assignment-detail-draft-summary-heading",
    );
    heading.textContent = "Assignment results";
    panel.appendChild(heading);

    const body = doc.createElement("p");
    body.className = "shell-assignment-detail-draft-summary-body";
    body.setAttribute(
      "data-testid",
      "assignment-detail-draft-summary-body",
    );
    body.textContent =
      "Assignment results will appear after this draft is published and students begin submitting work.";
    panel.appendChild(body);

    mount.appendChild(panel);
    return;
  }

  const summaryHost = doc.createElement("div");
  summaryHost.className = "shell-assignment-detail-summary";
  summaryHost.setAttribute("data-testid", "assignment-detail-summary-host");
  mount.appendChild(summaryHost);

  renderAssignmentSummaryCard(summaryHost, {
    callable: deps.summaryCallable,
    assignmentId: metadata.assignmentId,
  });
}

type CloseConfirmController = {
  onCancel: () => void;
  onConfirm: () => void;
  close: () => void;
};

function renderCloseConfirmDialog(
  doc: Document,
  metadata: AssignmentDetailMetadata,
  controller: CloseConfirmController,
): () => void {
  const overlay = doc.createElement("div");
  overlay.className = "shell-assign-overlay shell-assignment-close-overlay";
  overlay.setAttribute("data-testid", "assignment-detail-close-overlay");

  const dialog = doc.createElement("div");
  dialog.className = "shell-assign-dialog shell-assignment-close-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "assignment-detail-close-title");
  dialog.setAttribute(
    "aria-describedby",
    "assignment-detail-close-description",
  );
  dialog.setAttribute("data-testid", "assignment-detail-close-dialog");
  dialog.setAttribute("data-assignment-id", metadata.assignmentId);

  const title = doc.createElement("h3");
  title.id = "assignment-detail-close-title";
  title.className = "shell-assign-title";
  title.setAttribute("data-testid", "assignment-detail-close-title");
  title.textContent = "Close this assignment?";
  dialog.appendChild(title);

  const description = doc.createElement("p");
  description.id = "assignment-detail-close-description";
  description.className = "shell-assign-body";
  description.setAttribute(
    "data-testid",
    "assignment-detail-close-description",
  );
  description.textContent =
    "Students will no longer be able to submit new work. Existing submissions and summaries will remain available.";
  dialog.appendChild(description);

  const footer = doc.createElement("div");
  footer.className = "shell-assign-footer";
  dialog.appendChild(footer);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-assign-cancel";
  cancel.setAttribute("data-testid", "assignment-detail-close-cancel");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    controller.onCancel();
  });
  footer.appendChild(cancel);

  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "shell-assign-confirm";
  confirm.setAttribute("data-testid", "assignment-detail-close-confirm");
  confirm.textContent = "Close assignment";
  confirm.addEventListener("click", () => {
    controller.onConfirm();
  });
  footer.appendChild(confirm);

  overlay.appendChild(dialog);
  doc.body.appendChild(overlay);

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      controller.onCancel();
    }
  };
  doc.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) controller.onCancel();
  });

  try {
    cancel.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    doc.removeEventListener("keydown", onKey);
  };
}

type ReopenConfirmController = {
  onCancel: () => void;
  onConfirm: () => void;
  close: () => void;
};

function renderReopenConfirmDialog(
  doc: Document,
  metadata: AssignmentDetailMetadata,
  controller: ReopenConfirmController,
): () => void {
  const overlay = doc.createElement("div");
  overlay.className = "shell-assign-overlay shell-assignment-reopen-overlay";
  overlay.setAttribute("data-testid", "assignment-detail-reopen-overlay");

  const dialog = doc.createElement("div");
  dialog.className = "shell-assign-dialog shell-assignment-reopen-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "assignment-detail-reopen-title");
  dialog.setAttribute(
    "aria-describedby",
    "assignment-detail-reopen-description",
  );
  dialog.setAttribute("data-testid", "assignment-detail-reopen-dialog");
  dialog.setAttribute("data-assignment-id", metadata.assignmentId);

  const title = doc.createElement("h3");
  title.id = "assignment-detail-reopen-title";
  title.className = "shell-assign-title";
  title.setAttribute("data-testid", "assignment-detail-reopen-title");
  title.textContent = "Reopen this assignment?";
  dialog.appendChild(title);

  const description = doc.createElement("p");
  description.id = "assignment-detail-reopen-description";
  description.className = "shell-assign-body";
  description.setAttribute(
    "data-testid",
    "assignment-detail-reopen-description",
  );
  description.textContent =
    "Students will be able to submit new work again. Existing submissions and summaries will remain available.";
  dialog.appendChild(description);

  const footer = doc.createElement("div");
  footer.className = "shell-assign-footer";
  dialog.appendChild(footer);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-assign-cancel";
  cancel.setAttribute("data-testid", "assignment-detail-reopen-cancel");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    controller.onCancel();
  });
  footer.appendChild(cancel);

  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "shell-assign-confirm";
  confirm.setAttribute("data-testid", "assignment-detail-reopen-confirm");
  confirm.textContent = "Reopen assignment";
  confirm.addEventListener("click", () => {
    controller.onConfirm();
  });
  footer.appendChild(confirm);

  overlay.appendChild(dialog);
  doc.body.appendChild(overlay);

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      controller.onCancel();
    }
  };
  doc.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) controller.onCancel();
  });

  try {
    cancel.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    doc.removeEventListener("keydown", onKey);
  };
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
