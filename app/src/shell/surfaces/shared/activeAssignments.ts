import type {
  AssignmentDetailMetadata,
  AssignmentStatus,
} from "../../../assignments/detail/types";
import type { AssignmentSummary, AssignmentSummaryCallable } from "../../../assignments/summary/types";
import { getUnitBySlug } from "../../../curriculum/curriculumManifest";

// Sprint 28.6H.5 (Task A1): resolve the CANONICAL curriculum lesson title for
// an assignment card. When the assignment references a known LyfeLabz lesson
// (via its `lessonSlug`), the manifest unit title is displayed (e.g. "Earth's
// Layers"), never the stored teacher-authored assignment title suffix (e.g.
// "Earth's Layers - Check for Understanding"). The stored assignment title is
// never mutated; when the slug is missing or unresolvable (unusual / legacy
// assignment) the stored title is the safe fallback. This is presentation
// only and does NOT strip strings from arbitrary titles.
function resolveDisplayTitle(meta: AssignmentDetailMetadata): string {
  if (typeof meta.lessonSlug === "string" && meta.lessonSlug.length > 0) {
    const unit = getUnitBySlug(meta.lessonSlug);
    if (unit !== null && unit.title.length > 0) return unit.title;
  }
  return meta.title;
}

// Sprint 15: Active Assignments dashboard section for the Curriculum
// surface. Aggregate-only, factual, calm. Renders one card per
// teacher-owned `published` assignment (Slice 1). Slice 2 adds published
// date. Slice 3 adds progress counts through the certified summary
// callable. Slice 4 adds the Show closed toggle. Every value traces to
// stored assignment / session / attempt data per Sprint 14 §4.4.
//
// Sprint 20 UX refinement: the section is presented as a compact
// accordion. Default state shows a summary line per assignment; the
// expanded state reveals the existing assignment card(s) unchanged.
// Expanded/collapsed state persists during teacher workspace navigation
// within the current authenticated session via a module-scoped flag; a
// full page refresh resets to the default collapsed state.
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
  // Sprint 28.6C: when set, only registry entries whose `classId` matches are
  // considered (both for the visible cards and for every derived count). Used
  // by the Classes -> Class -> Assignments surface to show a single class's
  // assignments. Curriculum omits it (all owned assignments). The filter is
  // applied before the existing renderable / published / closed split, so an
  // assignment belonging to another class can never inflate this surface.
  readonly classIdFilter?: string | null;
  // Sprint 28.6C: flat presentation for the class-scoped Assignments surface.
  // The Curriculum dashboard uses the certified accordion (default, unchanged).
  // Flat renders the assignment cards directly (always visible) with no
  // accordion toggle and no "Active Assignments (N)" heading, because the class
  // workspace already provides the section heading. The card renderer, progress
  // cache, deterministic ordering, and Show-closed toggle are the same certified
  // internals the accordion uses.
  readonly flat?: boolean;
};

type ProgressCacheEntry =
  | { readonly kind: "pending" }
  | { readonly kind: "ready"; readonly summary: AssignmentSummary }
  | { readonly kind: "error" };

// Sprint 28.6H.6/H.7: the single completed definition, reused by both the
// completed-state card treatment (Part B, H.6) and the incomplete-first
// presentation ordering (Part A, H.7). An assignment is "completed" only when
// the certified summary is loaded, there is at least one recipient, and every
// recipient has completed. A zero-recipient assignment (total 0) is never
// completed. A pending / error / unknown progress is treated as NOT completed
// (so it groups with outstanding work until its data arrives).
function isProgressComplete(progress: ProgressCacheEntry): boolean {
  return (
    progress.kind === "ready" &&
    progress.summary.totalStudents > 0 &&
    progress.summary.completedStudents === progress.summary.totalStudents
  );
}

const STATUS_LABEL: Readonly<Record<AssignmentStatus, string>> = Object.freeze({
  draft: "Draft",
  published: "Published",
  closed: "Closed",
});

// Sprint 20: session-lifetime expanded/collapsed state. Persists across
// re-mounts of the Curriculum surface (teacher tab navigation) but not
// across a hard browser refresh. Kept in-module rather than in Web
// Storage so this file remains storage-free (see the Sprint 16 posture
// invariant guarded by shell.test.ts).
let sessionExpanded = false;

// Test-only reset for the module-scoped accordion state. Not called by
// runtime code.
export function _resetActiveAssignmentsSessionStateForTest(): void {
  sessionExpanded = false;
}

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

  // Sprint 28.6H.7 (Part A): the flat (Class Workspace) list is partitioned
  // incomplete-first, and that partition depends on the per-card completion
  // which only becomes known once its summary resolves. When a summary settles
  // in flat mode we re-render the whole list so a newly-completed card moves to
  // the completed group. A microtask coalesces a burst of near-simultaneous
  // resolves into a single re-render (one stable reflow), and the holder avoids
  // a use-before-define reference to `render`.
  const rerenderHolder: { run: () => void } = { run: () => {} };
  let flatRerenderScheduled = false;
  const scheduleFlatRerender = (): void => {
    if (flatRerenderScheduled) return;
    flatRerenderScheduled = true;
    void Promise.resolve().then(() => {
      flatRerenderScheduled = false;
      if (deps.flat === true) rerenderHolder.run();
    });
  };

  const EXPANDED_PANEL_ID = "active-assignments-expanded-panel";

  const refreshCard = (assignmentId: string): void => {
    const cardEl = section.querySelector<HTMLElement>(
      `[data-testid=active-assignment-card-${assignmentId}]`,
    );
    const meta = deps
      .listRegistry()
      .find((m) => m.assignmentId === assignmentId);
    if (meta === undefined) return;
    const progress = progressCache.get(assignmentId) ?? { kind: "pending" };
    if (cardEl !== null) {
      const replacement = renderCard(
        doc,
        meta,
        deps.open,
        progress,
        deps.flat === true,
      );
      cardEl.replaceWith(replacement);
    }
    const summaryEl = section.querySelector<HTMLElement>(
      `[data-testid=active-assignment-summary-${assignmentId}]`,
    );
    if (summaryEl !== null) {
      summaryEl.textContent = formatSummaryLine(meta, progress);
    }
  };

  const ensureProgress = (assignmentId: string): void => {
    const callable = deps.summaryCallable;
    if (callable === null || callable === undefined) return;
    if (progressCache.has(assignmentId)) return;
    progressCache.set(assignmentId, { kind: "pending" });
    callable({ assignmentId })
      .then((summary) => {
        progressCache.set(assignmentId, { kind: "ready", summary });
        // Flat mode re-partitions (incomplete-first) on settle; the accordion
        // keeps its in-place single-card refresh.
        if (deps.flat === true) scheduleFlatRerender();
        else refreshCard(assignmentId);
      })
      .catch(() => {
        progressCache.set(assignmentId, { kind: "error" });
        if (deps.flat === true) scheduleFlatRerender();
        else refreshCard(assignmentId);
      });
  };

  const applyExpandedState = (
    headerBtn: HTMLButtonElement,
    summariesEl: HTMLElement,
    expandedEl: HTMLElement,
  ): void => {
    headerBtn.setAttribute("aria-expanded", sessionExpanded ? "true" : "false");
    summariesEl.hidden = sessionExpanded;
    expandedEl.hidden = !sessionExpanded;
  };

  const render = (): void => {
    section.textContent = "";

    const source = deps.listRegistry();
    // Sprint 28.6C: apply the optional class filter before any split so a
    // different class's assignments never appear or count on this surface.
    const registry =
      deps.classIdFilter !== undefined && deps.classIdFilter !== null
        ? source.filter((m) => m.classId === deps.classIdFilter)
        : source;
    const published: AssignmentDetailMetadata[] = [];
    const closed: AssignmentDetailMetadata[] = [];
    for (const meta of registry) {
      if (!isRenderableCard(meta)) continue;
      if (meta.status === "published") published.push(meta);
      else if (meta.status === "closed") closed.push(meta);
    }
    published.sort(compareCards);
    closed.sort(compareCards);

    // Sprint 28.6C: flat presentation for the class-scoped Assignments surface.
    // Renders the certified assignment cards directly (always visible), reusing
    // the same renderCard / ensureProgress / progress-cache internals and the
    // Show-closed toggle. The Curriculum accordion path below is untouched.
    if (deps.flat === true) {
      if (published.length === 0 && closed.length === 0) {
        section.hidden = true;
        return;
      }
      section.hidden = false;

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

      const flatList = doc.createElement("div");
      flatList.className = "shell-active-assignments-list";
      flatList.setAttribute("data-testid", "active-assignments-list");
      flatList.setAttribute("role", "list");
      section.appendChild(flatList);

      const renderFlatRow = (meta: AssignmentDetailMetadata): void => {
        const progress =
          progressCache.get(meta.assignmentId) ?? { kind: "pending" };
        // Flat == the class-scoped Class Workspace Assignments list.
        flatList.appendChild(renderCard(doc, meta, deps.open, progress, true));
        ensureProgress(meta.assignmentId);
      };

      // Sprint 28.6H.7 (Part A): stable incomplete-first partition. `published`
      // and `closed` keep their certified compareCards ordering; within each
      // status group the outstanding assignments render before the fully
      // completed ones, preserving relative order inside each partition (Task
      // A3). The partition is DOM order (not CSS order) so visual and
      // screen-reader order agree (Part L). Progress that has not resolved yet
      // is not "complete", so a card sits with outstanding work until its
      // summary arrives; a settle then re-renders and re-partitions.
      const isCompleteMeta = (meta: AssignmentDetailMetadata): boolean =>
        isProgressComplete(
          progressCache.get(meta.assignmentId) ?? { kind: "pending" },
        );
      const partitionIncompleteFirst = (
        metas: ReadonlyArray<AssignmentDetailMetadata>,
      ): AssignmentDetailMetadata[] => [
        ...metas.filter((m) => !isCompleteMeta(m)),
        ...metas.filter((m) => isCompleteMeta(m)),
      ];

      for (const meta of partitionIncompleteFirst(published)) renderFlatRow(meta);
      if (showClosed) {
        for (const meta of partitionIncompleteFirst(closed)) renderFlatRow(meta);
      }
      return;
    }

    const visibleCount =
      published.length + (showClosed ? closed.length : 0);

    if (published.length === 0 && !(showClosed && closed.length > 0)) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    const headerBtn = doc.createElement("button");
    headerBtn.type = "button";
    headerBtn.className = "shell-active-assignments-toggle-btn";
    headerBtn.setAttribute(
      "data-testid",
      "active-assignments-accordion-toggle",
    );
    headerBtn.setAttribute("aria-controls", EXPANDED_PANEL_ID);
    const heading = doc.createElement("span");
    heading.className = "shell-active-assignments-title";
    heading.setAttribute("data-testid", "active-assignments-title");
    heading.textContent = `Active Assignments (${visibleCount})`;
    headerBtn.appendChild(heading);
    section.appendChild(headerBtn);

    const summariesEl = doc.createElement("div");
    summariesEl.className = "shell-active-assignments-summaries";
    summariesEl.setAttribute(
      "data-testid",
      "active-assignments-summaries",
    );
    section.appendChild(summariesEl);

    const expandedEl = doc.createElement("div");
    expandedEl.className = "shell-active-assignments-expanded";
    expandedEl.id = EXPANDED_PANEL_ID;
    expandedEl.setAttribute(
      "data-testid",
      "active-assignments-expanded",
    );
    section.appendChild(expandedEl);

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
      expandedEl.appendChild(toggleWrap);
    }

    const list = doc.createElement("div");
    list.className = "shell-active-assignments-list";
    list.setAttribute("data-testid", "active-assignments-list");
    list.setAttribute("role", "list");
    expandedEl.appendChild(list);

    const renderRow = (meta: AssignmentDetailMetadata): void => {
      const progress = progressCache.get(meta.assignmentId) ?? { kind: "pending" };
      const summaryLine = doc.createElement("p");
      summaryLine.className = "shell-active-assignment-summary";
      summaryLine.setAttribute(
        "data-testid",
        `active-assignment-summary-${meta.assignmentId}`,
      );
      summaryLine.textContent = formatSummaryLine(meta, progress);
      summariesEl.appendChild(summaryLine);
      list.appendChild(renderCard(doc, meta, deps.open, progress));
      ensureProgress(meta.assignmentId);
    };

    for (const meta of published) renderRow(meta);
    if (showClosed) {
      for (const meta of closed) renderRow(meta);
    }

    headerBtn.addEventListener("click", () => {
      sessionExpanded = !sessionExpanded;
      applyExpandedState(headerBtn, summariesEl, expandedEl);
    });

    applyExpandedState(headerBtn, summariesEl, expandedEl);
  };

  // Sprint 28.6H.7: let the flat progress-settle scheduler re-run the full
  // render (re-partitioning incomplete-first) without a use-before-define ref.
  rerenderHolder.run = render;

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

function formatSummaryLine(
  meta: AssignmentDetailMetadata,
  progress: ProgressCacheEntry,
): string {
  // Sprint 28.6H.3 (Task B4): teacher-oriented completion language, matching
  // the per-card progress line. (The accordion summary path is retained for
  // its tests; Curriculum no longer mounts it after 28.6D.)
  const base = `${meta.title} • ${meta.className}`;
  if (progress.kind === "ready") {
    const s = progress.summary;
    return `${base} • ${s.completedStudents} of ${s.totalStudents} completed`;
  }
  if (progress.kind === "error") {
    return `${base} • Completion count unavailable`;
  }
  return `${base} • Loading completion...`;
}

function renderCard(
  doc: Document,
  meta: AssignmentDetailMetadata,
  open: (assignmentId: string) => void,
  progress: ProgressCacheEntry,
  // Sprint 28.6H.5 (Part A): `classScoped` is true when the card is rendered
  // inside a single class's Assignments tab (the flat Class Workspace list).
  // In that context the surrounding workspace already establishes the class,
  // so the card shows the CANONICAL lesson title, and OMITS the redundant
  // class name (A2) and the PUBLISHED lifecycle label (A3). The certified
  // aggregate accordion (non-class-scoped, retained for its tests) is
  // unchanged: it still shows the stored title, the class name, and the state.
  classScoped = false,
): HTMLElement {
  const card = doc.createElement("article");
  card.className = "shell-active-assignment-card";
  if (classScoped) card.classList.add("shell-active-assignment-card-compact");
  card.setAttribute("role", "group");

  // Sprint 28.6H.6 (Part B): a class-scoped assignment card gets the subtle
  // pale-green COMPLETED treatment ONLY when every assigned student has
  // completed - i.e. the certified summary is loaded, there is at least one
  // recipient, and completed === total. A zero-recipient assignment (total 0)
  // is never treated as completed. The completion count text stays
  // authoritative (color is supplemental, Part K). Incomplete assignments keep
  // the neutral card (Part B3).
  const isComplete = classScoped && isProgressComplete(progress);
  if (isComplete) {
    card.classList.add("shell-active-assignment-card-complete");
    card.setAttribute("data-complete", "true");
  }
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

  // A1: canonical lesson title inside a class workspace; stored title elsewhere.
  const displayTitle = classScoped ? resolveDisplayTitle(meta) : meta.title;

  const title = doc.createElement("h3");
  title.id = titleId;
  title.className = "shell-active-assignment-title";
  title.setAttribute(
    "data-testid",
    `active-assignment-title-${meta.assignmentId}`,
  );
  title.textContent = displayTitle;
  card.appendChild(title);

  // A2: the class name is redundant inside that class's own Assignments tab.
  if (!classScoped) {
    const className = doc.createElement("p");
    className.className = "shell-active-assignment-class";
    className.setAttribute(
      "data-testid",
      `active-assignment-class-${meta.assignmentId}`,
    );
    className.textContent = meta.className;
    card.appendChild(className);
  }

  // A3: the PUBLISHED lifecycle label is not needed in the normal active list.
  // Lifecycle state is unchanged (still on `data-status`); this is the visible
  // label only, retained in the aggregate accordion context.
  if (!classScoped) {
    const stateLabel = doc.createElement("p");
    stateLabel.className = "shell-active-assignment-state";
    stateLabel.setAttribute(
      "data-testid",
      `active-assignment-state-${meta.assignmentId}`,
    );
    stateLabel.textContent = STATUS_LABEL[meta.status];
    card.appendChild(stateLabel);
  }

  // Slice 3 / Sprint 28.6H.3 (Task B4): the progress line uses teacher-oriented
  // COMPLETION language derived from the certified `assessmentAssignmentSummary`
  // fields (completedStudents / totalStudents / inProgressStudents /
  // notStartedStudents). The former implementation-oriented "N submitted / N
  // started / N total" wording is retired. The primary line answers "how many
  // finished this?" ("18 of 24 completed"); an optional secondary line breaks
  // down the not-completed remainder ("4 not started · 2 started") when the
  // authoritative data supports it. No status is invented and no lifecycle,
  // scoring, frozen-recipient, or attempt-authority semantic is changed - only
  // presentation. Loading / error variants stay calm per Sprint 14 §5.5.
  const progressLine = doc.createElement("p");
  progressLine.className = "shell-active-assignment-progress";
  progressLine.setAttribute(
    "data-testid",
    `active-assignment-progress-${meta.assignmentId}`,
  );
  if (progress.kind === "pending") {
    progressLine.textContent = "Loading progress...";
    progressLine.setAttribute("aria-live", "polite");
    card.appendChild(progressLine);
  } else if (progress.kind === "error") {
    progressLine.textContent = "Progress temporarily unavailable";
    card.appendChild(progressLine);
  } else {
    const s = progress.summary;
    if (s.totalStudents === 0) {
      progressLine.textContent = "No students assigned yet";
      card.appendChild(progressLine);
    } else {
      const line = `${s.completedStudents} of ${s.totalStudents} completed`;
      progressLine.textContent = line;
      progressLine.setAttribute("aria-label", line);
      card.appendChild(progressLine);

      // Secondary breakdown of the not-completed students. `notStarted` and
      // `started` (in-progress) together are exactly the not-completed group,
      // so the teacher sees who has not begun vs. who is mid-attempt. Omitted
      // entirely when every assigned student has completed.
      const detailParts: string[] = [];
      if (s.notStartedStudents > 0) {
        detailParts.push(`${s.notStartedStudents} not started`);
      }
      if (s.inProgressStudents > 0) {
        detailParts.push(`${s.inProgressStudents} started`);
      }
      if (detailParts.length > 0) {
        const detail = doc.createElement("p");
        detail.className = "shell-active-assignment-progress-detail";
        detail.setAttribute(
          "data-testid",
          `active-assignment-progress-detail-${meta.assignmentId}`,
        );
        detail.textContent = detailParts.join(" · ");
        card.appendChild(detail);
      }
    }
  }

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
    `Open assignment ${displayTitle} for ${meta.className}`,
  );
  openBtn.textContent = "Open assignment";
  openBtn.addEventListener("click", () => {
    open(meta.assignmentId);
  });
  card.appendChild(openBtn);

  return card;
}

// Sprint 28.5D (D4): teacher-facing short date. The published date is
// presented in a human-readable "Aug 20, 2026" form rather than a raw ISO
// "2026-08-20" developer format. The month abbreviations are a fixed table
// (not `toLocaleDateString`) so the output is deterministic across
// environments and locales while still reading naturally to a teacher.
const SHORT_MONTHS: ReadonlyArray<string> = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

export function formatLocalDate(d: Date): string {
  const month = SHORT_MONTHS[d.getMonth()] ?? "";
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
