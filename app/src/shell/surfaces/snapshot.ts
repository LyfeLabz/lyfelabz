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

const STATUS_LABEL: Readonly<Record<ClassSummary["status"], string>> =
  Object.freeze({
    active: "Active",
    archived: "Archived",
  });

export type SnapshotRenderInput = {
  readonly summary: ClassSummary;
  // When null, Snapshot renders the no-data state. When present, the
  // static preview groupings are rendered instead. Preview data must
  // never be sourced from Firestore or Cloud Functions.
  readonly preview: SnapshotPreview | null;
};

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
  headline.textContent = input.summary.title;
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const purpose = doc.createElement("p");
  purpose.className = "shell-status shell-snapshot-purpose";
  purpose.setAttribute("data-testid", "snapshot-purpose");
  purpose.textContent =
    "One place to check in on your class between moments.";
  mount.appendChild(purpose);

  const context = doc.createElement("div");
  context.className = "shell-snapshot-context";
  context.setAttribute("data-testid", "snapshot-class-context");

  if (input.summary.grade.length > 0) {
    const grade = doc.createElement("span");
    grade.className = "shell-snapshot-grade";
    grade.setAttribute("data-testid", "snapshot-class-grade");
    grade.textContent = `Grade ${input.summary.grade}`;
    context.appendChild(grade);
  }

  const statusPill = doc.createElement("span");
  statusPill.className = `shell-snapshot-status shell-snapshot-status-${input.summary.status}`;
  statusPill.setAttribute("data-testid", "snapshot-class-status");
  statusPill.setAttribute(
    "aria-label",
    `Class status: ${STATUS_LABEL[input.summary.status]}`,
  );
  statusPill.textContent = STATUS_LABEL[input.summary.status];
  context.appendChild(statusPill);
  mount.appendChild(context);

  const region = doc.createElement("section");
  region.className = "shell-snapshot-region";
  region.setAttribute("data-testid", "snapshot-region");
  region.setAttribute("aria-label", "Class snapshot");

  if (input.preview === null) {
    renderEmptyState(doc, region);
  } else {
    renderPreviewGroups(doc, region, input.preview);
  }

  mount.appendChild(region);
}

function renderEmptyState(doc: Document, region: HTMLElement): void {
  const empty = doc.createElement("p");
  empty.className = "shell-snapshot-empty";
  empty.setAttribute("data-testid", "snapshot-empty");
  empty.setAttribute("role", "status");
  empty.textContent =
    "Classroom activity will appear here when assignments and submissions exist.";
  region.appendChild(empty);
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
