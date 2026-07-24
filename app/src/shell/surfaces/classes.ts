import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { CreateClass, CreateClassResult } from "../../classes/createClass";
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
  // Sprint 20 internal beta: injected create-class callable seam. When
  // null the surface renders read-only (legacy Sprint 6B behavior).
  // When present, the class list exposes a Create Class control that
  // invokes the certified `classesCreate` callable and reveals the
  // server-generated join code.
  readonly createClass?: CreateClass | null;
};

const STATUS_LABEL: Readonly<Record<ClassSummary["status"], string>> =
  Object.freeze({
    active: "Active",
    archived: "Archived",
  });

type CreateFormState = {
  readonly title: string;
  readonly grade: string;
  readonly block: string;
  readonly submitting: boolean;
  readonly error: string | null;
};

type ClassesState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "list";
      readonly classes: ReadonlyArray<ClassSummary>;
      readonly form: CreateFormState | null;
      readonly lastCreated: CreateClassResult | null;
    }
  | {
      readonly kind: "workspace";
      readonly classes: ReadonlyArray<ClassSummary>;
      readonly selectedId: string;
      readonly tab: ClassWorkspaceTab;
    };

const emptyForm = (): CreateFormState =>
  Object.freeze({
    title: "",
    grade: "7",
    block: "A",
    submitting: false,
    error: null,
  });

export function renderClassesSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: ClassesSurfaceDeps,
): void {
  const doc = mount.ownerDocument;
  const preview = deps.snapshotPreview ?? null;
  const createClass = deps.createClass ?? null;

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
        renderListState(
          doc,
          mount,
          s.classes,
          onOpenClass,
          createClass !== null,
          s.form,
          s.lastCreated,
          onStartCreate,
          onCancelCreate,
          onFormChange,
          onSubmitCreate,
          onDismissLastCreated,
        );
        return;
      case "workspace": {
        const summary = s.classes.find((c) => c.id === s.selectedId);
        if (!summary) {
          state = {
            kind: "list",
            classes: s.classes,
            form: null,
            lastCreated: null,
          };
          rerender();
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

  const onStartCreate = (): void => {
    if (state.kind !== "list") return;
    state = {
      kind: "list",
      classes: state.classes,
      form: emptyForm(),
      lastCreated: null,
    };
    rerender();
  };

  const onCancelCreate = (): void => {
    if (state.kind !== "list") return;
    state = {
      kind: "list",
      classes: state.classes,
      form: null,
      lastCreated: state.lastCreated,
    };
    rerender();
  };

  const onFormChange = (patch: Partial<CreateFormState>): void => {
    if (state.kind !== "list" || state.form === null) return;
    state = {
      kind: "list",
      classes: state.classes,
      form: Object.freeze({ ...state.form, ...patch }),
      lastCreated: state.lastCreated,
    };
    // No rerender. The input/select DOM already reflects the user's
    // keystroke or selection; rebuilding the surface here would replace
    // the active control, steal focus back to the Classes headline, and
    // scroll the page. Rerenders happen on submit, cancel, validation
    // error, and async responses, all of which read from state.form.
  };

  const onDismissLastCreated = (): void => {
    if (state.kind !== "list") return;
    state = {
      kind: "list",
      classes: state.classes,
      form: state.form,
      lastCreated: null,
    };
    rerender();
  };

  const onSubmitCreate = (): void => {
    if (state.kind !== "list" || state.form === null) return;
    if (createClass === null) return;
    const form = state.form;
    const title = form.title.trim();
    const grade = form.grade.trim();
    const block = form.block.trim().toUpperCase();
    if (title.length === 0) {
      state = {
        kind: "list",
        classes: state.classes,
        form: Object.freeze({ ...form, error: "Enter a class name." }),
        lastCreated: state.lastCreated,
      };
      rerender();
      return;
    }
    if (!/^[A-Za-z0-9]{1,8}$/.test(grade)) {
      state = {
        kind: "list",
        classes: state.classes,
        form: Object.freeze({
          ...form,
          error: "Grade must be a short alphanumeric token (for example 7).",
        }),
        lastCreated: state.lastCreated,
      };
      rerender();
      return;
    }
    if (!/^[A-G]$/.test(block)) {
      state = {
        kind: "list",
        classes: state.classes,
        form: Object.freeze({
          ...form,
          error: "Block must be a single letter A through G.",
        }),
        lastCreated: state.lastCreated,
      };
      rerender();
      return;
    }
    state = {
      kind: "list",
      classes: state.classes,
      form: Object.freeze({ ...form, submitting: true, error: null }),
      lastCreated: state.lastCreated,
    };
    rerender();
    void createClass({ title, grade, block })
      .then((result) => {
        if (!mount.isConnected) return;
        void deps
          .listClasses(session.uid)
          .then((classes) => {
            if (!mount.isConnected) return;
            state = {
              kind: "list",
              classes,
              form: null,
              lastCreated: result,
            };
            rerender();
          })
          .catch(() => {
            if (!mount.isConnected) return;
            state = {
              kind: "list",
              classes:
                state.kind === "list" ? state.classes : ([] as ReadonlyArray<ClassSummary>),
              form: null,
              lastCreated: result,
            };
            rerender();
          });
      })
      .catch((err: unknown) => {
        if (!mount.isConnected) return;
        if (state.kind !== "list") return;
        const message = describeCreateError(err);
        state = {
          kind: "list",
          classes: state.classes,
          form: Object.freeze({ ...form, submitting: false, error: message }),
          lastCreated: state.lastCreated,
        };
        rerender();
      });
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
    state = {
      kind: "list",
      classes: state.classes,
      form: null,
      lastCreated: null,
    };
    rerender();
  };

  rerender();

  void deps
    .listClasses(session.uid)
    .then((classes) => {
      if (!mount.isConnected) return;
      state = { kind: "list", classes, form: null, lastCreated: null };
      rerender();
    })
    .catch(() => {
      if (!mount.isConnected) return;
      state = { kind: "error" };
      rerender();
    });
}

function describeCreateError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message)
      : "";
  if (code.includes("permission") || code.includes("forbidden")) {
    return "Your account is not permitted to create classes yet.";
  }
  if (code.includes("unauthenticated")) {
    return "Your session has expired. Reload the page and sign in again.";
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return "We could not reach LyfeLabz. Check your connection and try again.";
  }
  if (message) return message.slice(0, 240);
  return "We could not create the class. Try again in a moment.";
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
  canCreate: boolean,
  form: CreateFormState | null,
  lastCreated: CreateClassResult | null,
  onStartCreate: () => void,
  onCancelCreate: () => void,
  onFormChange: (patch: Partial<CreateFormState>) => void,
  onSubmitCreate: () => void,
  onDismissLastCreated: () => void,
): void {
  appendHeadline(doc, mount, "Classes");

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "classes-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  mount.appendChild(status);

  if (canCreate) {
    mount.appendChild(
      renderCreateControls(
        doc,
        form,
        onStartCreate,
        onCancelCreate,
        onFormChange,
        onSubmitCreate,
      ),
    );
  }

  if (lastCreated !== null) {
    mount.appendChild(renderJoinCodePanel(doc, lastCreated, onDismissLastCreated));
  }

  const region = doc.createElement("div");
  region.className = "shell-classes-region";
  region.setAttribute("data-testid", "classes-region");
  mount.appendChild(region);

  if (classes.length === 0) {
    status.textContent = "You do not have any classrooms yet.";
    const empty = doc.createElement("p");
    empty.className = "shell-classes-empty";
    empty.setAttribute("data-testid", "classes-empty");
    empty.textContent = canCreate
      ? "Choose Create Class to add your first classroom."
      : "Classrooms you own will appear here once they are created.";
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

function renderCreateControls(
  doc: Document,
  form: CreateFormState | null,
  onStartCreate: () => void,
  onCancelCreate: () => void,
  onFormChange: (patch: Partial<CreateFormState>) => void,
  onSubmitCreate: () => void,
): HTMLElement {
  const wrapper = doc.createElement("div");
  wrapper.className = "shell-classes-create";
  wrapper.setAttribute("data-testid", "classes-create");

  if (form === null) {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-classes-create-open";
    btn.setAttribute("data-testid", "classes-create-open");
    btn.textContent = "Create class";
    btn.addEventListener("click", () => onStartCreate());
    wrapper.appendChild(btn);
    return wrapper;
  }

  const formEl = doc.createElement("form");
  formEl.className = "shell-form shell-classes-create-form";
  formEl.setAttribute("data-testid", "classes-create-form");
  formEl.addEventListener("submit", (ev) => {
    ev.preventDefault();
    onSubmitCreate();
  });

  const heading = doc.createElement("h3");
  heading.className = "shell-classes-create-heading";
  heading.textContent = "Create a class";
  formEl.appendChild(heading);

  const titleLabel = doc.createElement("label");
  titleLabel.textContent = "Class name";
  const titleInput = doc.createElement("input");
  titleInput.type = "text";
  titleInput.required = true;
  titleInput.value = form.title;
  titleInput.setAttribute("data-testid", "classes-create-title");
  titleInput.disabled = form.submitting;
  titleInput.addEventListener("input", () => {
    onFormChange({ title: titleInput.value });
  });
  titleLabel.appendChild(titleInput);
  formEl.appendChild(titleLabel);

  const gradeLabel = doc.createElement("label");
  gradeLabel.textContent = "Grade";
  const gradeSelect = doc.createElement("select");
  gradeSelect.setAttribute("data-testid", "classes-create-grade");
  gradeSelect.disabled = form.submitting;
  for (const g of ["6", "7", "8"]) {
    const opt = doc.createElement("option");
    opt.value = g;
    opt.textContent = g;
    if (g === form.grade) opt.selected = true;
    gradeSelect.appendChild(opt);
  }
  gradeSelect.addEventListener("change", () => {
    onFormChange({ grade: gradeSelect.value });
  });
  gradeLabel.appendChild(gradeSelect);
  formEl.appendChild(gradeLabel);

  const blockLabel = doc.createElement("label");
  blockLabel.textContent = "Block";
  const blockSelect = doc.createElement("select");
  blockSelect.setAttribute("data-testid", "classes-create-block");
  blockSelect.disabled = form.submitting;
  for (const b of ["A", "B", "C", "D", "E", "F", "G"]) {
    const opt = doc.createElement("option");
    opt.value = b;
    opt.textContent = b;
    if (b === form.block) opt.selected = true;
    blockSelect.appendChild(opt);
  }
  blockSelect.addEventListener("change", () => {
    onFormChange({ block: blockSelect.value });
  });
  blockLabel.appendChild(blockSelect);
  formEl.appendChild(blockLabel);

  if (form.error !== null) {
    const err = doc.createElement("p");
    err.setAttribute("role", "alert");
    err.setAttribute("data-testid", "classes-create-error");
    err.className = "shell-classes-create-error";
    err.textContent = form.error;
    formEl.appendChild(err);
  }

  const actions = doc.createElement("div");
  actions.className = "shell-classes-create-actions";

  const submit = doc.createElement("button");
  submit.type = "submit";
  submit.setAttribute("data-testid", "classes-create-submit");
  submit.textContent = form.submitting ? "Creating" : "Create class";
  submit.disabled = form.submitting;
  if (form.submitting) submit.setAttribute("aria-busy", "true");
  actions.appendChild(submit);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-classes-create-cancel";
  cancel.setAttribute("data-testid", "classes-create-cancel");
  cancel.textContent = "Cancel";
  cancel.disabled = form.submitting;
  cancel.addEventListener("click", () => onCancelCreate());
  actions.appendChild(cancel);

  formEl.appendChild(actions);
  wrapper.appendChild(formEl);
  return wrapper;
}

function renderJoinCodePanel(
  doc: Document,
  result: CreateClassResult,
  onDismiss: () => void,
): HTMLElement {
  const panel = doc.createElement("div");
  panel.className = "shell-classes-joincode";
  panel.setAttribute("data-testid", "classes-joincode-panel");
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");

  const heading = doc.createElement("h3");
  heading.className = "shell-classes-joincode-heading";
  heading.textContent = result.alreadyCreated
    ? "Class already exists"
    : "Class created";
  panel.appendChild(heading);

  const label = doc.createElement("p");
  label.className = "shell-classes-joincode-label";
  label.textContent = "Student join code";
  panel.appendChild(label);

  const code = doc.createElement("p");
  code.className = "shell-classes-joincode-value";
  code.setAttribute("data-testid", "classes-joincode-value");
  code.textContent = result.joinCode;
  panel.appendChild(code);

  const hint = doc.createElement("p");
  hint.className = "shell-classes-joincode-hint";
  hint.textContent =
    "Share this code with your students so they can join this class. The code stays on the class card.";
  panel.appendChild(hint);

  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.className = "shell-classes-joincode-dismiss";
  dismiss.setAttribute("data-testid", "classes-joincode-dismiss");
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => onDismiss());
  panel.appendChild(dismiss);

  return panel;
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
    grade.textContent =
      summary.block && summary.block.length > 0
        ? `Grade ${summary.grade} - Block ${summary.block}`
        : `Grade ${summary.grade}`;
    card.appendChild(grade);
  }

  if (summary.joinCode && summary.joinCode.length > 0) {
    const code = doc.createElement("p");
    code.className = "shell-class-joincode";
    code.setAttribute("data-testid", `class-joincode-${summary.id}`);
    const label = doc.createElement("span");
    label.className = "shell-class-joincode-label";
    label.textContent = "Join code: ";
    const value = doc.createElement("span");
    value.className = "shell-class-joincode-value";
    value.textContent = summary.joinCode;
    code.appendChild(label);
    code.appendChild(value);
    card.appendChild(code);
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
