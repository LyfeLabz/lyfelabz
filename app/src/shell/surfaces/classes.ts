import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import {
  renderSnapshotSurface,
  type SnapshotPreview,
} from "./snapshot";

// Classroom Workspace surface. Renders read-only classroom cards for
// the authenticated teacher. See SPRINT_6B_SPECIFICATION.md §6.
//
// Sprint 7B introduces the class workspace inside the certified
// `classes` workspace surface. When a teacher opens a specific class,
// the class workspace mounts and opens on Snapshot by default per
// CLASS_SNAPSHOT_EXPERIENCE.md §6 and SNAPSHOT_ARCHITECTURE.md §6.
// The class-level surface remains available one level deeper through
// a subordinate class-level navigation. The permanent four-item
// Teacher Workspace navigation is unchanged.
//
// This module opens no Firestore listener, invokes no callable, and
// imports no firebase/* module. It receives its data through the
// injected `listClasses` fetcher wired at the client entry point. The
// shell "no firebase imports" invariant established by Sprint 3 Step 5
// (spec §6.6, §11.2) is preserved.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type ClassWorkspaceTab = "snapshot" | "roster";

// Optional snapshot preview data. When null (production default), the
// Snapshot surface renders the certified no-data state. When present,
// the static representative preview is rendered instead. Preview data
// is implementation-local, never persisted, and never sourced from
// Firestore or Cloud Functions. See snapshot.ts.
export type ClassesSurfaceDeps = {
  readonly listClasses: ListClasses;
  readonly snapshotPreview?: SnapshotPreview | null;
};

const STATUS_LABEL: Readonly<Record<ClassSummary["status"], string>> =
  Object.freeze({
    active: "Active",
    archived: "Archived",
  });

type ClassesState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "list"; readonly classes: ReadonlyArray<ClassSummary> }
  | {
      readonly kind: "workspace";
      readonly classes: ReadonlyArray<ClassSummary>;
      readonly selectedId: string;
      readonly tab: ClassWorkspaceTab;
    };

export function renderClassesSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: ClassesSurfaceDeps,
): void {
  const doc = mount.ownerDocument;
  const preview = deps.snapshotPreview ?? null;

  let state: ClassesState = { kind: "loading" };

  const rerender = (): void => {
    if (!mount.isConnected) return;
    mount.textContent = "";
    const s: ClassesState = state;
    switch (s.kind) {
      case "loading":
        renderLoading(doc, mount);
        return;
      case "error":
        renderErrorState(doc, mount);
        return;
      case "list":
        renderListState(doc, mount, s.classes, onOpenClass);
        return;
      case "workspace": {
        const summary = s.classes.find((c) => c.id === s.selectedId);
        if (!summary) {
          state = { kind: "list", classes: s.classes };
          renderListState(doc, mount, s.classes, onOpenClass);
          return;
        }
        renderClassWorkspaceState(
          doc,
          mount,
          summary,
          s.tab,
          preview,
          onSelectTab,
          onBackToList,
        );
        return;
      }
    }
  };

  const onOpenClass = (classId: string): void => {
    if (state.kind !== "list") return;
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: classId,
      tab: "snapshot",
    };
    rerender();
  };

  const onSelectTab = (tab: ClassWorkspaceTab): void => {
    if (state.kind !== "workspace") return;
    if (state.tab === tab) return;
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: state.selectedId,
      tab,
    };
    rerender();
  };

  const onBackToList = (): void => {
    if (state.kind !== "workspace") return;
    state = { kind: "list", classes: state.classes };
    rerender();
  };

  rerender();

  void deps
    .listClasses(session.uid)
    .then((classes) => {
      if (!mount.isConnected) return;
      state = { kind: "list", classes };
      rerender();
    })
    .catch(() => {
      if (!mount.isConnected) return;
      state = { kind: "error" };
      rerender();
    });
}

function renderLoading(doc: Document, mount: HTMLElement): void {
  appendHeadline(doc, mount, "Classes");

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "classes-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Loading classes";
  mount.appendChild(status);

  const region = doc.createElement("div");
  region.className = "shell-classes-region";
  region.setAttribute("data-testid", "classes-region");
  mount.appendChild(region);
}

function renderErrorState(doc: Document, mount: HTMLElement): void {
  appendHeadline(doc, mount, "Classes");

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "classes-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "We could not load your classrooms.";
  mount.appendChild(status);

  const region = doc.createElement("div");
  region.className = "shell-classes-region";
  region.setAttribute("data-testid", "classes-region");
  const retry = doc.createElement("p");
  retry.className = "shell-classes-error";
  retry.setAttribute("data-testid", "classes-error");
  retry.textContent =
    "Reload the page to try again. If the problem continues, contact support.";
  region.appendChild(retry);
  mount.appendChild(region);
}

function renderListState(
  doc: Document,
  mount: HTMLElement,
  classes: ReadonlyArray<ClassSummary>,
  onOpen: (classId: string) => void,
): void {
  appendHeadline(doc, mount, "Classes");

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "classes-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  mount.appendChild(status);

  const region = doc.createElement("div");
  region.className = "shell-classes-region";
  region.setAttribute("data-testid", "classes-region");
  mount.appendChild(region);

  if (classes.length === 0) {
    status.textContent = "You do not have any classrooms yet.";
    const empty = doc.createElement("p");
    empty.className = "shell-classes-empty";
    empty.setAttribute("data-testid", "classes-empty");
    empty.textContent =
      "Classrooms you own will appear here once they are created.";
    region.appendChild(empty);
    return;
  }

  status.textContent =
    classes.length === 1 ? "1 classroom" : `${classes.length} classrooms`;

  const prompt = doc.createElement("p");
  prompt.className = "shell-classes-prompt";
  prompt.setAttribute("data-testid", "classes-prompt");
  prompt.textContent = "Choose a class to open its workspace.";
  region.appendChild(prompt);

  const list = doc.createElement("ul");
  list.className = "shell-classes-list";
  list.setAttribute("data-testid", "classes-list");
  list.setAttribute("role", "list");

  for (const summary of classes) {
    list.appendChild(renderClassCard(doc, summary, onOpen));
  }
  region.appendChild(list);
}

function renderClassCard(
  doc: Document,
  summary: ClassSummary,
  onOpen: (classId: string) => void,
): HTMLElement {
  const li = doc.createElement("li");
  li.className = "shell-classes-item";

  const card = doc.createElement("button");
  card.type = "button";
  card.className = "shell-card shell-class-card";
  card.setAttribute("data-testid", `class-card-${summary.id}`);
  card.setAttribute("data-class-id", summary.id);
  card.setAttribute(
    "aria-label",
    `Open ${summary.title}`,
  );

  const title = doc.createElement("h3");
  title.className = "shell-class-title";
  title.setAttribute("data-testid", `class-title-${summary.id}`);
  title.textContent = summary.title;
  card.appendChild(title);

  if (summary.grade.length > 0) {
    const grade = doc.createElement("p");
    grade.className = "shell-class-grade";
    grade.setAttribute("data-testid", `class-grade-${summary.id}`);
    grade.textContent = `Grade ${summary.grade}`;
    card.appendChild(grade);
  }

  const statusPill = doc.createElement("span");
  statusPill.className = `shell-class-status shell-class-status-${summary.status}`;
  statusPill.setAttribute("data-testid", `class-status-${summary.id}`);
  statusPill.setAttribute(
    "aria-label",
    `Status: ${STATUS_LABEL[summary.status]}`,
  );
  statusPill.textContent = STATUS_LABEL[summary.status];
  card.appendChild(statusPill);

  card.addEventListener("click", () => {
    onOpen(summary.id);
  });

  li.appendChild(card);
  return li;
}

function renderClassWorkspaceState(
  doc: Document,
  mount: HTMLElement,
  summary: ClassSummary,
  tab: ClassWorkspaceTab,
  preview: SnapshotPreview | null,
  onSelectTab: (tab: ClassWorkspaceTab) => void,
  onBack: () => void,
): void {
  const workspace = doc.createElement("div");
  workspace.className = "shell-class-workspace";
  workspace.setAttribute("data-testid", "class-workspace");
  workspace.setAttribute("data-class-id", summary.id);
  workspace.setAttribute("data-class-tab", tab);
  mount.appendChild(workspace);

  const back = doc.createElement("button");
  back.type = "button";
  back.className = "shell-class-workspace-back";
  back.setAttribute("data-testid", "class-workspace-back");
  back.textContent = "Back to Classes";
  back.setAttribute("aria-label", "Back to Classes");
  back.addEventListener("click", () => {
    onBack();
  });
  workspace.appendChild(back);

  workspace.appendChild(renderClassNavigation(doc, tab, onSelectTab));

  const surfaceMount = doc.createElement("div");
  surfaceMount.className = `shell-class-surface shell-class-surface-${tab}`;
  surfaceMount.setAttribute("data-testid", "class-surface");
  workspace.appendChild(surfaceMount);

  if (tab === "snapshot") {
    renderSnapshotSurface(surfaceMount, { summary, preview });
  } else {
    renderRosterSurface(doc, surfaceMount, summary);
  }
}

function renderClassNavigation(
  doc: Document,
  tab: ClassWorkspaceTab,
  onSelectTab: (tab: ClassWorkspaceTab) => void,
): HTMLElement {
  const nav = doc.createElement("nav");
  nav.className = "shell-class-nav";
  nav.setAttribute("aria-label", "Class sections");
  nav.setAttribute("data-testid", "class-nav");

  const list = doc.createElement("ul");
  list.className = "shell-class-nav-list";
  list.setAttribute("role", "list");

  const items: ReadonlyArray<{
    readonly key: ClassWorkspaceTab;
    readonly label: string;
  }> = Object.freeze([
    Object.freeze({ key: "snapshot" as const, label: "Snapshot" }),
    Object.freeze({ key: "roster" as const, label: "Roster" }),
  ]);

  for (const item of items) {
    const li = doc.createElement("li");
    li.className = "shell-class-nav-item";
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-class-nav-button";
    btn.setAttribute("data-testid", `class-nav-${item.key}`);
    btn.textContent = item.label;
    if (item.key === tab) {
      btn.setAttribute("aria-current", "page");
      btn.classList.add("shell-class-nav-active");
    }
    btn.addEventListener("click", () => {
      onSelectTab(item.key);
    });
    li.appendChild(btn);
    list.appendChild(li);
  }

  nav.appendChild(list);
  return nav;
}

function renderRosterSurface(
  doc: Document,
  mount: HTMLElement,
  summary: ClassSummary,
): void {
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome shell-roster-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = summary.title;
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const purpose = doc.createElement("p");
  purpose.className = "shell-status shell-roster-purpose";
  purpose.setAttribute("data-testid", "roster-purpose");
  purpose.textContent =
    "The class roster is where you will manage this class in detail.";
  mount.appendChild(purpose);

  const foundation = doc.createElement("p");
  foundation.className = "shell-roster-foundation";
  foundation.setAttribute("data-testid", "roster-foundation");
  foundation.textContent =
    "The full class-level workspace will grow into this space as later sprints extend the Teacher Platform. Snapshot remains your between-moments view of this class.";
  mount.appendChild(foundation);
}

function appendHeadline(
  doc: Document,
  mount: HTMLElement,
  text: string,
): void {
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = text;
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }
}
