import type {
  AssignmentRegistryReadiness,
  AssignmentRegistryStatus,
} from "../../../assignments/detail/hydration";

// Performance Operation 1: the one way a surface follows assignment-registry
// readiness. The assignment registry hydrates in the background, so regions
// that read it subscribe to its status while it is not yet ready.
//
// Disposal follows the surfaces' existing lifecycle convention (see the
// Curriculum selection bar): a document MutationObserver notices the moment
// the owning element leaves the document and disposes the subscription then,
// rather than waiting for a later hydration event. The watch also ends once
// the registry is ready, because a ready registry does not change status
// again within a bootstrap generation (a new generation remounts surfaces).
export function watchRegistryReadiness(
  owner: HTMLElement,
  readiness: AssignmentRegistryReadiness,
  onChange: (status: AssignmentRegistryStatus) => void,
): () => void {
  if (readiness.status() === "ready") return () => undefined;
  let disposed = false;
  let observer: MutationObserver | null = null;
  let unsubscribe: () => void = () => undefined;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    observer?.disconnect();
    observer = null;
  };
  unsubscribe = readiness.subscribe(() => {
    if (disposed) return;
    if (!owner.isConnected) {
      dispose();
      return;
    }
    const status = readiness.status();
    if (status === "ready") dispose();
    onChange(status);
  });
  const doc = owner.ownerDocument;
  const MutationObserverCtor = doc.defaultView?.MutationObserver;
  if (MutationObserverCtor !== undefined) {
    observer = new MutationObserverCtor(() => {
      if (!owner.isConnected) dispose();
    });
    observer.observe(doc, { childList: true, subtree: true });
  }
  // An owner may be created and watched a moment before its render pass
  // attaches it. One microtask later it must be in the document; an owner
  // that is not (it was detached before the watch, or never mounted) is
  // permanently detached, and the watch is released rather than retained.
  if (!owner.isConnected) {
    void Promise.resolve().then(() => {
      if (!owner.isConnected) dispose();
    });
  }
  return dispose;
}

// Shared status line for a region whose assignment-dependent state is not
// yet known: a polite loading message while pending, or an accurate failure
// message with a working Try again while unavailable. Hidden when ready.
export function renderRegistryStatusLine(
  doc: Document,
  readiness: AssignmentRegistryReadiness,
  options: {
    readonly testId: string;
    readonly retryTestId: string;
    readonly className: string;
    readonly loadingText: string;
    readonly unavailableText: string;
    // Where focus goes if the replaced Try again control held it.
    readonly focusFallback: () => HTMLElement | null;
  },
): { readonly element: HTMLElement; readonly update: () => void } {
  const line = doc.createElement("div");
  line.className = `shell-status ${options.className}`;
  line.setAttribute("data-testid", options.testId);
  line.setAttribute("role", "status");
  line.setAttribute("aria-live", "polite");
  const update = (): void => {
    const status = readiness.status();
    const hadFocus = line.contains(doc.activeElement);
    line.replaceChildren();
    line.hidden = status === "ready";
    line.setAttribute("data-assignment-status", status);
    if (status === "pending") {
      line.textContent = options.loadingText;
    } else if (status === "unavailable") {
      const message = doc.createElement("span");
      message.textContent = `${options.unavailableText} `;
      line.appendChild(message);
      const retry = doc.createElement("button");
      retry.type = "button";
      retry.className = "shell-classes-import-retry";
      retry.setAttribute("data-testid", options.retryTestId);
      retry.textContent = "Try again";
      retry.addEventListener("click", () => {
        readiness.retry();
      });
      line.appendChild(retry);
    }
    if (hadFocus && !line.contains(doc.activeElement)) {
      try {
        options.focusFallback()?.focus({ preventScroll: true });
      } catch {
        // ignored
      }
    }
  };
  update();
  return { element: line, update };
}

// Marks a lesson's Assign / Results control while its assignment state is
// not known. A control the registry already shows as assigned is known; an
// unassigned-looking control is "unknown" (never definitively unassigned)
// until the registry is ready.
export function markAssignStateKnowledge(
  control: HTMLElement,
  status: AssignmentRegistryStatus,
  assigned: boolean,
  describedBy: string | null,
): void {
  const unknown = !assigned && status !== "ready";
  control.setAttribute(
    "data-assignment-state",
    unknown ? (status === "pending" ? "loading" : "unavailable") : "known",
  );
  if (status === "pending" && unknown) control.setAttribute("aria-busy", "true");
  else control.removeAttribute("aria-busy");
  if (unknown && describedBy !== null) control.setAttribute("aria-describedby", describedBy);
  else if (control.getAttribute("aria-describedby") === describedBy) control.removeAttribute("aria-describedby");
}
