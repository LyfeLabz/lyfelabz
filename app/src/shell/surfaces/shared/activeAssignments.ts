import type {
  AssignmentDetailMetadata,
  AssignmentStatus,
} from "../../../assignments/detail/types";
import type { AssignmentSummary, AssignmentSummaryCallable } from "../../../assignments/summary/types";

// Sprint 15: Active Assignments dashboard section for the Curriculum
// surface. Aggregate-only, factual, calm. Renders one card per
// teacher-owned `published` assignment (Slice 1). Slice 2 adds published
// date. Slice 3 adds progress counts through the certified summary
// callable. Slice 4 adds the Show closed toggle. Every value traces to
// stored assignment / session / attempt data per Sprint 14 §4.4.
//
// This module is firebase-free. All I/O is injected. It reads from the
// session-scoped assignment-detail registry that Curriculum already
// hydrates.

export type ActiveAssignmentsSectionDeps = {
  readonly listRegistry: () => ReadonlyArray<AssignmentDetailMetadata>;
  readonly open: (assignmentId: string) => void;
  // Slice 3: optional summary seam. When present the section fetches
  // per-card progress counts and caches them for the surface lifetime.
  // When absent no progress line is rendered.
  readonly summaryCallable?: AssignmentSummaryCallable | null;
};

type ProgressCacheEntry =
  | { readonly kind: "pending" }
  | { readonly kind: "ready"; readonly summary: AssignmentSummary }
  | { readonly kind: "error" };

const STATUS_LABEL: Readonly<Record<AssignmentStatus, string>> = Object.freeze({
  draft: "Draft",
  published: "Published",
  closed: "Closed",
});

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function isRenderableCard(meta: AssignmentDetailMetadata): boolean {
  return (
    isNonEmptyString(meta.assignmentId) &&
    isNonEmptyString(meta.title) &&
    isNonEmptyString(meta.className) &&
    (meta.status === "published" || meta.status === "closed")
  );
}

// Sprint 14 §5.3 deterministic ordering:
// 1. Most recent `publishedAt` first (missing sorted after present).
// 2. Class name ascending.
// 3. Assignment title ascending.
// 4. assignmentId ascending.
export function compareCards(
  a: AssignmentDetailMetadata,
  b: AssignmentDetailMetadata,
): number {
  const ap = typeof a.publishedAt === "number" ? a.publishedAt : null;
  const bp = typeof b.publishedAt === "number" ? b.publishedAt : null;
  if (ap !== null && bp !== null && ap !== bp) return bp - ap;
  if (ap !== null && bp === null) return -1;
  if (ap === null && bp !== null) return 1;
  const byClass = a.className.localeCompare(b.className, undefined, {
    sensitivity: "base",
  });
  if (byClass !== 0) return byClass;
  const byTitle = a.title.localeCompare(b.title, undefined, {
    sensitivity: "base",
  });
  if (byTitle !== 0) return byTitle;
  if (a.assignmentId < b.assignmentId) return -1;
  if (a.assignmentId > b.assignmentId) return 1;
  return 0;
}

export type ActiveAssignmentsRefreshInvalidate = {
  readonly assignmentIds?: ReadonlyArray<string>;
};

export type ActiveAssignmentsController = {
  // Sprint 16 Slice 1: `refresh` accepts an optional invalidate hint. When
  // `assignmentIds` is supplied, exactly those entries are evicted from
  // `progressCache` before the render pass, forcing a re-fetch of the
  // specified cards on the next render. When absent, the existing
  // prune-only behavior is preserved: entries no longer in the registry
  // are removed and entries still present retain their cached counts.
  readonly refresh: (invalidate?: ActiveAssignmentsRefreshInvalidate) => void;
};

export function renderActiveAssignmentsSection(
  mount: HTMLElement,
  deps: ActiveAssignmentsSectionDeps,
): ActiveAssignmentsController {
  const doc = mount.ownerDocument;

  const section = doc.createElement("section");
  section.className = "shell-active-assignments";
  section.setAttribute("role", "region");
  section.setAttribute("aria-label", "Active assignments");
  section.setAttribute("data-testid", "active-assignments-section");
  section.hidden = true;
  mount.appendChild(section);

  // Slice 4: session-only toggle state. Persistence is intentionally
  // absent per Sprint 14 §5.4 unless explicitly specified; drafts are
  // never surfaced on the dashboard.
  let showClosed = false;

  // Slice 3: per-assignment summary cache. Attached to this section's
  // lifetime; not persisted.
  const progressCache = new Map<string, ProgressCacheEntry>();

  const refreshCard = (assignmentId: string): void => {
    const cardEl = section.querySelector<HTMLElement>(
      `[data-testid=active-assignment-card-${assignmentId}]`,
    );
    if (cardEl === null) return;
    const progress = progressCache.get(assignmentId) ?? { kind: "pending" };
    const meta = deps
      .listRegistry()
      .find((m) => m.assignmentId === assignmentId);
    if (meta === undefined) return;
    const replacement = renderCard(doc, meta, deps.open, progress);
    cardEl.replaceWith(replacement);
  };

  const ensureProgress = (assignmentId: string): void => {
    const callable = deps.summaryCallable;
    if (callable === null || callable === undefined) return;
    if (progressCache.has(assignmentId)) return;
    progressCache.set(assignmentId, { kind: "pending" });
    callable({ assignmentId })
      .then((summary) => {
        progressCache.set(assignmentId, { kind: "ready", summary });
        refreshCard(assignmentId);
      })
      .catch(() => {
        progressCache.set(assignmentId, { kind: "error" });
        refreshCard(assignmentId);
      });
  };

  const render = (): void => {
    section.textContent = "";

    const registry = deps.listRegistry();
    const published: AssignmentDetailMetadata[] = [];
    const closed: AssignmentDetailMetadata[] = [];
    for (const meta of registry) {
      if (!isRenderableCard(meta)) continue;
      if (meta.status === "published") published.push(meta);
      else if (meta.status === "closed") closed.push(meta);
    }
    published.sort(compareCards);
    closed.sort(compareCards);

    if (published.length === 0 && !(showClosed && closed.length > 0)) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    const heading = doc.createElement("h2");
    heading.className = "shell-active-assignments-title";
    heading.setAttribute("data-testid", "active-assignments-title");
    heading.textContent = "Active assignments";
    section.appendChild(heading);

    // Slice 4: Show closed toggle. Rendered when at least one closed
    // assignment exists so the control is not offered when there is
    // nothing to reveal. Draft assignments are intentionally not
    // surfaced on the dashboard.
    if (closed.length > 0) {
      const toggleWrap = doc.createElement("label");
      toggleWrap.className = "shell-active-assignments-toggle";
      const toggle = doc.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = showClosed;
      toggle.setAttribute("data-testid", "active-assignments-show-closed");
      toggle.setAttribute("aria-label", "Show closed assignments");
      toggle.addEventListener("change", () => {
        showClosed = toggle.checked;
        render();
      });
      toggleWrap.appendChild(toggle);
      const toggleLabel = doc.createElement("span");
      toggleLabel.className = "shell-active-assignments-toggle-label";
      toggleLabel.textContent = "Show closed";
      toggleWrap.appendChild(toggleLabel);
      section.appendChild(toggleWrap);
    }

    const list = doc.createElement("div");
    list.className = "shell-active-assignments-list";
    list.setAttribute("data-testid", "active-assignments-list");
    list.setAttribute("role", "list");
    section.appendChild(list);

    for (const meta of published) {
      const progress = progressCache.get(meta.assignmentId) ?? { kind: "pending" };
      list.appendChild(renderCard(doc, meta, deps.open, progress));
      ensureProgress(meta.assignmentId);
    }
    if (showClosed) {
      for (const meta of closed) {
        const progress =
          progressCache.get(meta.assignmentId) ?? { kind: "pending" };
        list.appendChild(renderCard(doc, meta, deps.open, progress));
        ensureProgress(meta.assignmentId);
      }
    }
  };

  render();

  return {
    refresh: (invalidate) => {
      // Invalidate summary cache for entries that have moved out of the
      // registry between renders; entries still present preserve their
      // cached counts to avoid duplicate calls.
      const current = new Set(
        deps.listRegistry().map((m) => m.assignmentId),
      );
      for (const id of Array.from(progressCache.keys())) {
        if (!current.has(id)) progressCache.delete(id);
      }
      if (invalidate && invalidate.assignmentIds) {
        for (const id of invalidate.assignmentIds) {
          progressCache.delete(id);
        }
      }
      render();
    },
  };
}

function renderCard(
  doc: Document,
  meta: AssignmentDetailMetadata,
  open: (assignmentId: string) => void,
  progress: ProgressCacheEntry,
): HTMLElement {
  const card = doc.createElement("article");
  card.className = "shell-active-assignment-card";
  card.setAttribute("role", "group");
  // Sprint 16 Slice 6: point at the visible title so the card's accessible
  // name reads exactly what the teacher sees rather than a hand-composed
  // aria-label that could drift from the copy.
  const titleId = `active-assignment-title-${meta.assignmentId}`;
  card.setAttribute("aria-labelledby", titleId);
  card.setAttribute(
    "data-testid",
    `active-assignment-card-${meta.assignmentId}`,
  );
  card.setAttribute("data-assignment-id", meta.assignmentId);
  card.setAttribute("data-status", meta.status);

  const title = doc.createElement("h3");
  title.id = titleId;
  title.className = "shell-active-assignment-title";
  title.setAttribute(
    "data-testid",
    `active-assignment-title-${meta.assignmentId}`,
  );
  title.textContent = meta.title;
  card.appendChild(title);

  const className = doc.createElement("p");
  className.className = "shell-active-assignment-class";
  className.setAttribute(
    "data-testid",
    `active-assignment-class-${meta.assignmentId}`,
  );
  className.textContent = meta.className;
  card.appendChild(className);

  const stateLabel = doc.createElement("p");
  stateLabel.className = "shell-active-assignment-state";
  stateLabel.setAttribute(
    "data-testid",
    `active-assignment-state-${meta.assignmentId}`,
  );
  stateLabel.textContent = STATUS_LABEL[meta.status];
  card.appendChild(stateLabel);

  // Slice 3: progress line. Loading / error variants render calm text
  // per Sprint 14 §5.5 without disturbing the card's visual identity.
  const progressLine = doc.createElement("p");
  progressLine.className = "shell-active-assignment-progress";
  progressLine.setAttribute(
    "data-testid",
    `active-assignment-progress-${meta.assignmentId}`,
  );
  if (progress.kind === "pending") {
    progressLine.textContent = "Loading progress...";
    progressLine.setAttribute("aria-live", "polite");
  } else if (progress.kind === "error") {
    progressLine.textContent = "Progress temporarily unavailable";
  } else {
    const s = progress.summary;
    const started = s.inProgressStudents + s.completedStudents;
    const line = `${s.completedStudents} submitted / ${started} started / ${s.totalStudents} total`;
    progressLine.textContent = line;
    progressLine.setAttribute("aria-label", line);
  }
  card.appendChild(progressLine);

  // Slice 2: published date, right-aligned. `publishedAt` is projected by
  // the certified Sprint 15 additive `assignmentsTeacherList` field and
  // is present on published and closed assignments; drafts never reach
  // this render path.
  if (typeof meta.publishedAt === "number") {
    const date = doc.createElement("p");
    date.className = "shell-active-assignment-date";
    date.setAttribute(
      "data-testid",
      `active-assignment-date-${meta.assignmentId}`,
    );
    date.textContent = formatLocalDate(new Date(meta.publishedAt));
    card.appendChild(date);
  }

  const openBtn = doc.createElement("button");
  openBtn.type = "button";
  openBtn.className = "shell-btn shell-active-assignment-open";
  openBtn.setAttribute(
    "data-testid",
    `active-assignment-open-${meta.assignmentId}`,
  );
  // Sprint 16 Slice 6: multiple Open buttons render on the same dashboard,
  // so the accessible name pairs the visible verb with the assignment title
  // and class so screen-reader users can distinguish them.
  openBtn.setAttribute(
    "aria-label",
    `Open assignment ${meta.title} for ${meta.className}`,
  );
  openBtn.textContent = "Open assignment";
  openBtn.addEventListener("click", () => {
    open(meta.assignmentId);
  });
  card.appendChild(openBtn);

  return card;
}

function formatLocalDate(d: Date): string {
  const yyyy = String(d.getFullYear()).padStart(4, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
