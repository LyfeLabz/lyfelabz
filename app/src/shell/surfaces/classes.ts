import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";

// Classroom Workspace surface. Renders read-only classroom cards for
// the authenticated teacher. See SPRINT_6B_SPECIFICATION.md §6.
//
// This module opens no Firestore listener, invokes no callable, and
// imports no firebase/* module. It receives its data through the
// injected `listClasses` fetcher wired at the client entry point. The
// shell "no firebase imports" invariant established by Sprint 3 Step 5
// (spec §6.6, §11.2) is preserved.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type ClassesSurfaceDeps = {
  readonly listClasses: ListClasses;
};

const STATUS_LABEL: Readonly<Record<ClassSummary["status"], string>> =
  Object.freeze({
    active: "Active",
    archived: "Archived",
  });

export function renderClassesSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: ClassesSurfaceDeps,
): void {
  const doc = mount.ownerDocument;

  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = "Classes";
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

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

  void deps
    .listClasses(session.uid)
    .then((classes) => {
      if (!mount.isConnected) return;
      renderResolved(doc, region, status, classes);
    })
    .catch(() => {
      if (!mount.isConnected) return;
      renderError(doc, region, status);
    });
}

function renderResolved(
  doc: Document,
  region: HTMLElement,
  status: HTMLElement,
  classes: ReadonlyArray<ClassSummary>,
): void {
  region.textContent = "";
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
    classes.length === 1
      ? "1 classroom"
      : `${classes.length} classrooms`;

  const list = doc.createElement("ul");
  list.className = "shell-classes-list";
  list.setAttribute("data-testid", "classes-list");
  list.setAttribute("role", "list");

  for (const summary of classes) {
    list.appendChild(renderClassCard(doc, summary));
  }
  region.appendChild(list);
}

function renderError(
  doc: Document,
  region: HTMLElement,
  status: HTMLElement,
): void {
  region.textContent = "";
  status.textContent = "We could not load your classrooms.";
  const retry = doc.createElement("p");
  retry.className = "shell-classes-error";
  retry.setAttribute("data-testid", "classes-error");
  retry.textContent =
    "Reload the page to try again. If the problem continues, contact support.";
  region.appendChild(retry);
}

function renderClassCard(
  doc: Document,
  summary: ClassSummary,
): HTMLElement {
  const li = doc.createElement("li");
  li.className = "shell-classes-item";

  const card = doc.createElement("button");
  card.type = "button";
  card.className = "shell-card shell-class-card";
  card.setAttribute("data-testid", `class-card-${summary.id}`);
  card.setAttribute("data-class-id", summary.id);
  card.setAttribute("aria-pressed", "false");

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
  statusPill.setAttribute("aria-label", `Status: ${STATUS_LABEL[summary.status]}`);
  statusPill.textContent = STATUS_LABEL[summary.status];
  card.appendChild(statusPill);

  card.addEventListener("click", () => {
    const parent = card.parentElement?.parentElement;
    if (parent) {
      parent
        .querySelectorAll<HTMLButtonElement>(".shell-class-card")
        .forEach((btn) => {
          btn.setAttribute("aria-pressed", "false");
          btn.classList.remove("shell-class-card-selected");
        });
    }
    card.setAttribute("aria-pressed", "true");
    card.classList.add("shell-class-card-selected");
  });

  li.appendChild(card);
  return li;
}
