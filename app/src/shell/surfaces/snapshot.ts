import type { ClassSummary } from "../../classes/types";

// Class Snapshot surface. Sprint 7B introduces the first narrow
// foundation for the class-scoped preparation surface described in
// CLASS_SNAPSHOT_EXPERIENCE.md and SNAPSHOT_ARCHITECTURE.md. Snapshot
// is not a new top-level Teacher Workspace destination; it is the
// initial view of the class workspace, rendered inside the certified
// `classes` workspace surface. See PLATFORM_CONTRACTS.md §7 and
// SNAPSHOT_ARCHITECTURE.md §6.
//
// This module opens no Firestore listener, invokes no callable, and
// imports no firebase/* module. It renders only from data passed in
// through arguments. Live classroom data is deferred to a future
// Snapshot sprint under the read patterns recorded in
// SNAPSHOT_ARCHITECTURE.md §15.

// Development-safe static preview shape. Used only to validate the
// page hierarchy, responsive behavior, and accessibility. Preview data
// is never persisted, never written to Firestore, and never derived
// from real students. See SPRINT_7B_SPECIFICATION §5.D and §6.
export type SnapshotPreviewGroupKey =
  | "check-in-next"
  | "working"
  | "finished";

export type SnapshotPreviewGroup = {
  readonly key: SnapshotPreviewGroupKey;
  readonly label: string;
  readonly placeholders: ReadonlyArray<string>;
};

export type SnapshotPreview = {
  readonly groups: ReadonlyArray<SnapshotPreviewGroup>;
};

// The certified attention-oriented grouping order. Snapshot groups
// name teacher attention, not student performance. Ordering here is
// spatial and stable; it is not a ranking.
export const SNAPSHOT_PREVIEW_GROUP_ORDER: ReadonlyArray<SnapshotPreviewGroupKey> =
  Object.freeze(["check-in-next", "working", "finished"] as const);

const GROUP_LABEL: Readonly<Record<SnapshotPreviewGroupKey, string>> =
  Object.freeze({
    "check-in-next": "Check in next",
    working: "Working",
    finished: "Finished",
  });

// Fictional placeholders used only for the static preview state. These
// names are anonymous by construction (Student 1, Student 2, ...) so
// no fictional identity resembles a real student. Preview data is
// implementation-local and must never become authoritative.
export const STATIC_SNAPSHOT_PREVIEW: SnapshotPreview = Object.freeze({
  groups: Object.freeze([
    Object.freeze({
      key: "check-in-next" as const,
      label: GROUP_LABEL["check-in-next"],
      placeholders: Object.freeze(["Student 1", "Student 2"]),
    }),
    Object.freeze({
      key: "working" as const,
      label: GROUP_LABEL.working,
      placeholders: Object.freeze(["Student 3", "Student 4", "Student 5"]),
    }),
    Object.freeze({
      key: "finished" as const,
      label: GROUP_LABEL.finished,
      placeholders: Object.freeze(["Student 6", "Student 7"]),
    }),
  ]),
});

export type SnapshotRenderInput = {
  readonly summary: ClassSummary;
  // When null, Snapshot renders the no-data state. When present, the
  // static preview groupings are rendered instead. Preview data must
  // never be sourced from Firestore or Cloud Functions.
  readonly preview: SnapshotPreview | null;
  // Sprint 28.6H (Findings 4/5): the count of this class's assignments,
  // grouped in-memory from the already-loaded teacher assignment registry
  // (no per-class call). `null` when the assignment seam is not wired, in
  // which case the count line is omitted rather than guessed.
  readonly assignmentCount?: number | null;
};

// Sprint 28.6H (Findings 3/4/5): the class-workspace Overview.
//
// The class name, grade/block, and status no longer live here - the class
// identity is the workspace header above the tabs (Finding 3), and the
// "Active" badge is removed entirely (Finding 2). Prototype/product-marketing
// copy is removed: the "One place to check in on your class between moments."
// purpose line and the "Classroom activity will appear here..." empty
// placeholder are gone (Finding 5). Overview shows real, locally-available
// class information (assignment count, join code) or - when there is genuinely
// nothing yet - a calm intentional empty state. Roster sync is NOT here; it is
// an occasional administrative action reached from "Manage class" (Finding 4).
export function renderSnapshotSurface(
  mount: HTMLElement,
  input: SnapshotRenderInput,
): void {
  const doc = mount.ownerDocument;

  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome shell-snapshot-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = "Overview";
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const region = doc.createElement("section");
  region.className = "shell-snapshot-region";
  region.setAttribute("data-testid", "snapshot-region");
  region.setAttribute("aria-label", "Class overview");

  if (input.preview !== null) {
    // Development-only static preview of the intended student groupings.
    renderPreviewGroups(doc, region, input.preview);
    mount.appendChild(region);
    return;
  }

  // Real, locally-available class summary. `assignmentCount` is grouped from
  // the already-loaded teacher assignment registry (no per-class call, no new
  // read). The join code is class metadata already loaded with the class.
  const summaryList = doc.createElement("dl");
  summaryList.className = "shell-snapshot-summary";
  summaryList.setAttribute("data-testid", "snapshot-summary");

  const count = input.assignmentCount ?? null;
  if (count !== null) {
    appendSummaryRow(
      doc,
      summaryList,
      "Assignments",
      count === 0
        ? "No assignments yet"
        : count === 1
          ? "1 assignment"
          : `${count} assignments`,
      "snapshot-assignment-count",
    );
  }

  const joinCode =
    input.summary.status === "needsSetup" ? undefined : input.summary.joinCode;
  if (joinCode && joinCode.length > 0) {
    appendSummaryRow(doc, summaryList, "Join code", joinCode, "snapshot-join-code");
  }

  if (summaryList.childElementCount > 0) {
    region.appendChild(summaryList);
  } else {
    // Genuinely nothing to summarize yet: a calm, intentional empty state (no
    // product-marketing placeholder).
    const empty = doc.createElement("p");
    empty.className = "shell-snapshot-empty";
    empty.setAttribute("data-testid", "snapshot-empty");
    empty.setAttribute("role", "status");
    empty.textContent = "No assignments yet.";
    region.appendChild(empty);
  }

  mount.appendChild(region);
}

function appendSummaryRow(
  doc: Document,
  list: HTMLElement,
  label: string,
  value: string,
  testId: string,
): void {
  const row = doc.createElement("div");
  row.className = "shell-snapshot-summary-row";
  const dt = doc.createElement("dt");
  dt.className = "shell-snapshot-summary-label";
  dt.textContent = label;
  const dd = doc.createElement("dd");
  dd.className = "shell-snapshot-summary-value";
  dd.setAttribute("data-testid", testId);
  dd.textContent = value;
  row.appendChild(dt);
  row.appendChild(dd);
  list.appendChild(row);
}

function renderPreviewGroups(
  doc: Document,
  region: HTMLElement,
  preview: SnapshotPreview,
): void {
  const notice = doc.createElement("p");
  notice.className = "shell-snapshot-preview-notice";
  notice.setAttribute("data-testid", "snapshot-preview-notice");
  notice.textContent =
    "Preview only. These groupings show the intended structure. No real classroom activity is shown.";
  region.appendChild(notice);

  const list = doc.createElement("ul");
  list.className = "shell-snapshot-groups";
  list.setAttribute("data-testid", "snapshot-groups");
  list.setAttribute("role", "list");

  for (const groupKey of SNAPSHOT_PREVIEW_GROUP_ORDER) {
    const group = preview.groups.find((g) => g.key === groupKey);
    if (!group) continue;
    list.appendChild(renderPreviewGroup(doc, group));
  }

  region.appendChild(list);
}

function renderPreviewGroup(
  doc: Document,
  group: SnapshotPreviewGroup,
): HTMLElement {
  const li = doc.createElement("li");
  li.className = `shell-snapshot-group shell-snapshot-group-${group.key}`;
  li.setAttribute("data-testid", `snapshot-group-${group.key}`);

  const label = doc.createElement("h3");
  label.className = "shell-snapshot-group-label";
  label.setAttribute("data-testid", `snapshot-group-label-${group.key}`);
  label.textContent = group.label;
  li.appendChild(label);

  const count = doc.createElement("p");
  count.className = "shell-snapshot-group-count";
  count.setAttribute("data-testid", `snapshot-group-count-${group.key}`);
  const n = group.placeholders.length;
  count.textContent = n === 1 ? "1 student" : `${n} students`;
  li.appendChild(count);

  const names = doc.createElement("ul");
  names.className = "shell-snapshot-group-names";
  names.setAttribute("data-testid", `snapshot-group-names-${group.key}`);
  names.setAttribute("role", "list");
  names.setAttribute("aria-label", `${group.label}: ${count.textContent}`);
  for (const placeholder of group.placeholders) {
    const item = doc.createElement("li");
    item.className = "shell-snapshot-group-name";
    item.textContent = placeholder;
    names.appendChild(item);
  }
  li.appendChild(names);

  return li;
}
