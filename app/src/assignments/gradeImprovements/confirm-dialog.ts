import { registerOpenModal } from "../../shell/openModals";

// Compact confirmation dialog for Grade Improvements (mark updated, undo).
// Reuses the established `.shell-assign-*` dialog classes and the same
// behavior as the Assignment Detail reopen/publish confirmations: modal
// role, Escape and backdrop cancel, initial focus on Cancel. Adds an
// in-flight state (both buttons disabled, confirm reads "Saving...") and an
// inline failure message so a failed request never closes silently. Focus is
// contained: Tab and Shift+Tab cycle the enabled buttons, and focus that
// lands outside the dialog is pulled back. While saving (no enabled button)
// focus rests on the dialog itself.

export type GradeConfirmOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly allowRetry: boolean };

export type GradeConfirmOptions = {
  readonly testid: string;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => Promise<GradeConfirmOutcome>;
  // Called once when the dialog closes, with whether the action succeeded.
  readonly onClose?: (confirmed: boolean) => void;
  // Focus returns here on close when it is still in the document.
  readonly returnFocusTo?: HTMLElement | null;
};

export function openGradeConfirmDialog(doc: Document, opts: GradeConfirmOptions): () => void {
  const overlay = doc.createElement("div");
  overlay.className = "shell-assign-overlay shell-grade-update-overlay";
  overlay.setAttribute("data-testid", `${opts.testid}-overlay`);

  const titleId = `${opts.testid}-title`;
  const bodyId = `${opts.testid}-description`;
  const dialog = doc.createElement("div");
  dialog.className = "shell-assign-dialog shell-grade-update-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("aria-describedby", bodyId);
  dialog.setAttribute("data-testid", opts.testid);
  // Focus target while both buttons are disabled; not a Tab stop.
  dialog.tabIndex = -1;

  const title = doc.createElement("h3");
  title.id = titleId;
  title.className = "shell-assign-title";
  title.textContent = opts.title;
  dialog.appendChild(title);

  const body = doc.createElement("p");
  body.id = bodyId;
  body.className = "shell-assign-body";
  body.setAttribute("data-testid", `${opts.testid}-body`);
  body.textContent = opts.body;
  dialog.appendChild(body);

  const error = doc.createElement("p");
  error.className = "shell-grade-update-error";
  error.setAttribute("data-testid", `${opts.testid}-error`);
  error.setAttribute("role", "alert");
  error.hidden = true;
  dialog.appendChild(error);

  const footer = doc.createElement("div");
  footer.className = "shell-assign-footer";
  dialog.appendChild(footer);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-assign-cancel";
  cancel.setAttribute("data-testid", `${opts.testid}-cancel`);
  cancel.textContent = "Cancel";
  footer.appendChild(cancel);

  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "shell-assign-confirm";
  confirm.setAttribute("data-testid", `${opts.testid}-confirm`);
  confirm.textContent = opts.confirmLabel;
  footer.appendChild(confirm);

  overlay.appendChild(dialog);
  doc.body.appendChild(overlay);

  let closed = false;
  let busy = false;
  // Browser Back/Forward dismisses the dialog like Cancel (shell contract).
  const unregister = registerOpenModal(() => close(false));
  const close = (confirmed: boolean): void => {
    if (closed) return;
    closed = true;
    unregister();
    overlay.remove();
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("focusin", onFocusIn);
    const target = opts.returnFocusTo;
    if (target && target.isConnected) {
      try {
        target.focus({ preventScroll: true });
      } catch {
        // ignored
      }
    }
    opts.onClose?.(confirmed);
  };
  const focusables = (): HTMLButtonElement[] => [cancel, confirm].filter((b) => !b.disabled);
  const focusInside = (el: HTMLElement): void => {
    try {
      el.focus({ preventScroll: true });
    } catch {
      // ignored
    }
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && !busy) {
      ev.preventDefault();
      close(false);
      return;
    }
    if (ev.key !== "Tab") return;
    const items = focusables();
    ev.preventDefault();
    if (items.length === 0) {
      focusInside(dialog);
      return;
    }
    const index = items.indexOf(doc.activeElement as HTMLButtonElement);
    const step = ev.shiftKey ? -1 : 1;
    const next =
      index === -1
        ? ev.shiftKey ? items[items.length - 1] : items[0]
        : items[(index + step + items.length) % items.length];
    focusInside(next);
  };
  // Focus moved outside the dialog by any other means (pointer, script, a
  // screen reader's virtual cursor) is returned to it.
  const onFocusIn = (ev: FocusEvent): void => {
    const target = ev.target as Node | null;
    if (target !== null && dialog.contains(target)) return;
    focusInside(focusables()[0] ?? dialog);
  };
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("focusin", onFocusIn);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay && !busy) close(false);
  });
  cancel.addEventListener("click", () => {
    if (!busy) close(false);
  });
  confirm.addEventListener("click", () => {
    if (busy || closed) return;
    busy = true;
    confirm.disabled = true;
    cancel.disabled = true;
    confirm.textContent = "Saving...";
    dialog.setAttribute("aria-busy", "true");
    // The focused button was just disabled; keep focus inside the dialog.
    focusInside(dialog);
    error.hidden = true;
    void opts
      .onConfirm()
      .catch((): GradeConfirmOutcome => ({
        ok: false,
        message: "We couldn't save this. Please try again.",
        allowRetry: true,
      }))
      .then((outcome) => {
        busy = false;
        dialog.removeAttribute("aria-busy");
        if (closed) return;
        if (outcome.ok) {
          close(true);
          return;
        }
        cancel.disabled = false;
        confirm.textContent = opts.confirmLabel;
        confirm.disabled = !outcome.allowRetry;
        error.textContent = outcome.message;
        error.hidden = false;
        focusInside(outcome.allowRetry ? confirm : cancel);
      });
  });

  try {
    cancel.focus({ preventScroll: true });
  } catch {
    // ignored
  }
  return () => close(false);
}
