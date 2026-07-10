import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import {
  getSurfaceableLessons,
  TOPIC_LABEL,
  type LessonGrade,
  type LessonTopic,
  type SurfaceableLesson,
} from "../../curriculum/curriculumManifest";

// Curriculum surface. The teacher curriculum landing page introduced by
// Sprint 6D and extended in Sprint 6E with the first working version of
// the Assign Experience described in ASSIGN_EXPERIENCE.md.
//
// Sprint 6E is a UI implementation sprint. There is no backend
// scheduling, no Firestore write, no callable, no Google Classroom
// integration, and no teacher-preference persistence. The dialog reads
// the teacher's class list through the injected `listClasses` fetcher
// and holds all assignment state in module-scoped, in-memory session
// memory. Nothing is retained across a full page reload; PDR-010 and
// the Assignment Foundation phase own persistence.
//
// The activation toggle from Sprint 6D remains in place because
// preservation mode forbids opportunistic removal of instructional
// controls. Assign is added as an additional per-card action.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

type GradeFilter = "all" | LessonGrade;
type TopicFilter = "all" | LessonTopic;

export type CurriculumSurfaceDeps = {
  readonly listClasses: ListClasses;
};

const DEFAULT_LIST_CLASSES: ListClasses = () =>
  Promise.resolve(Object.freeze<ClassSummary[]>([]));

const LESSONS: ReadonlyArray<SurfaceableLesson> = getSurfaceableLessons();

// LyfeLabz standard quiz score. The canonical curriculum manifest does
// not yet expose per-lesson quiz totals; a follow-up sprint will
// surface a per-resource points value. Ten matches the ten-question
// LyfeLabz quiz standard.
const DEFAULT_POINTS = 10;

// Session-remembered defaults. Sprint 6E is UI-only, so these live in
// module scope and are cleared by a full page reload. When the
// Assignment Foundation phase certifies teacher-preference persistence,
// this surface will read from a real preference source.
const DEFAULT_RELEASE_TIME = "07:45";
const sessionPreferences: {
  releaseTime: string;
  topic: string;
} = {
  releaseTime: DEFAULT_RELEASE_TIME,
  topic: "",
};

type RowConfig = {
  enabled: boolean;
  date: string;
  time: string;
  topic: string;
  points: number;
};

type Assignment = {
  rows: Map<string, RowConfig>;
};

// Assignments the teacher has scheduled during this UI session. Keyed
// by lesson slug. A lesson is considered assigned when at least one row
// is enabled; the last-enabled row's deselection returns the card to
// its unassigned state, mirroring section 8 of ASSIGN_EXPERIENCE.md.
const sessionAssignments: Map<string, Assignment> = new Map();

// Teacher class list cache. Populated lazily on surface mount so the
// dialog opens without a round trip. Keyed by uid to avoid returning a
// prior teacher's cache after a sign-out/sign-in in the same tab.
let cachedClasses: {
  readonly uid: string;
  readonly rows: ReadonlyArray<ClassSummary>;
} | null = null;
let classesInFlight: Promise<void> | null = null;

const GRADE_FILTERS: ReadonlyArray<{
  readonly key: GradeFilter;
  readonly label: string;
}> = Object.freeze([
  { key: "all", label: "All Grades" },
  { key: "6", label: "Grade 6" },
  { key: "7", label: "Grade 7" },
]);

const TOPIC_FILTERS: ReadonlyArray<{
  readonly key: TopicFilter;
  readonly label: string;
}> = Object.freeze([
  { key: "all", label: "All Topics" },
  { key: "life-science", label: "Life Science" },
  { key: "earth-space", label: "Earth & Space" },
  { key: "physical-science", label: "Physical Science" },
  { key: "tech-engineering", label: "Tech & Engineering" },
]);

function todayIsoDate(doc: Document): string {
  const win = doc.defaultView ?? window;
  const d = new win.Date();
  const yyyy = String(d.getFullYear()).padStart(4, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isAssigned(slug: string): boolean {
  const a = sessionAssignments.get(slug);
  if (!a) return false;
  for (const row of a.rows.values()) if (row.enabled) return true;
  return false;
}

function ensureClasses(
  uid: string,
  listClasses: ListClasses,
): Promise<void> {
  if (cachedClasses && cachedClasses.uid === uid) return Promise.resolve();
  if (classesInFlight) return classesInFlight;
  classesInFlight = listClasses(uid)
    .then((rows) => {
      cachedClasses = Object.freeze({ uid, rows });
    })
    .catch(() => {
      cachedClasses = Object.freeze({ uid, rows: Object.freeze([]) });
    })
    .finally(() => {
      classesInFlight = null;
    });
  return classesInFlight;
}

export function renderCurriculumSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: CurriculumSurfaceDeps = { listClasses: DEFAULT_LIST_CLASSES },
): void {
  const doc = mount.ownerDocument;

  const welcome = doc.createElement("h2");
  welcome.id = "surface-headline";
  welcome.className = "shell-welcome";
  welcome.tabIndex = -1;
  welcome.setAttribute("data-testid", "surface-headline");
  const name = session.displayName;
  welcome.textContent =
    name && name.length > 0 ? `Welcome, ${name}.` : "Welcome to LyfeLabz.";
  mount.appendChild(welcome);
  try {
    welcome.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const intro = doc.createElement("p");
  intro.className = "shell-status shell-curriculum-intro";
  intro.setAttribute("data-testid", "curriculum-intro");
  intro.textContent =
    "Activate the LyfeLabz lessons your students can access. Preview any lesson at any time.";
  mount.appendChild(intro);

  const state: {
    grade: GradeFilter;
    topic: TopicFilter;
    activation: Map<string, boolean>;
  } = {
    grade: "all",
    topic: "all",
    activation: new Map(LESSONS.map((l) => [l.slug, true])),
  };

  const controls = doc.createElement("div");
  controls.className = "shell-curriculum-controls";
  controls.setAttribute("data-testid", "curriculum-filters");
  mount.appendChild(controls);

  const grid = doc.createElement("div");
  grid.className = "shell-curriculum-grid";
  grid.setAttribute("data-testid", "curriculum-grid");
  grid.setAttribute("role", "list");
  mount.appendChild(grid);

  const emptyNotice = doc.createElement("p");
  emptyNotice.className = "shell-curriculum-empty";
  emptyNotice.setAttribute("data-testid", "curriculum-empty");
  emptyNotice.hidden = true;
  emptyNotice.textContent =
    "No lessons match the current filters. Adjust a filter to see more.";
  mount.appendChild(emptyNotice);

  const gradeRow = doc.createElement("div");
  gradeRow.className = "shell-filter-row";
  gradeRow.setAttribute("role", "group");
  gradeRow.setAttribute("aria-label", "Filter by grade");
  gradeRow.setAttribute("data-testid", "filter-grade-row");
  controls.appendChild(gradeRow);

  const topicRow = doc.createElement("div");
  topicRow.className = "shell-filter-row";
  topicRow.setAttribute("role", "group");
  topicRow.setAttribute("aria-label", "Filter by topic");
  topicRow.setAttribute("data-testid", "filter-topic-row");
  controls.appendChild(topicRow);

  // Live region for the concise, self-dismissing success confirmation
  // described by ASSIGN_EXPERIENCE.md section 7.
  const successBanner = doc.createElement("p");
  successBanner.className = "shell-curriculum-success";
  successBanner.setAttribute("data-testid", "assign-success");
  successBanner.setAttribute("role", "status");
  successBanner.setAttribute("aria-live", "polite");
  successBanner.hidden = true;
  mount.appendChild(successBanner);

  const applyFilters = (): void => {
    let visible = 0;
    for (const card of Array.from(
      grid.querySelectorAll<HTMLElement>(".shell-lesson-card"),
    )) {
      const g = card.getAttribute("data-grade") as LessonGrade;
      const t = card.getAttribute("data-topic") as LessonTopic;
      const match =
        (state.grade === "all" || state.grade === g) &&
        (state.topic === "all" || state.topic === t);
      card.hidden = !match;
      if (match) visible += 1;
    }
    emptyNotice.hidden = visible > 0;
  };

  const renderFilterRow = (
    row: HTMLElement,
    kind: "grade" | "topic",
    items: ReadonlyArray<{ readonly key: string; readonly label: string }>,
    isActive: (key: string) => boolean,
    onSelect: (key: string) => void,
  ): void => {
    row.textContent = "";
    for (const item of items) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "shell-filter-pill";
      btn.setAttribute("data-testid", `filter-${kind}-${item.key}`);
      btn.setAttribute(`data-${kind}-filter`, item.key);
      const active = isActive(item.key);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      if (active) btn.classList.add("shell-filter-pill-active");
      btn.textContent = item.label;
      btn.addEventListener("click", () => {
        onSelect(item.key);
      });
      row.appendChild(btn);
    }
  };

  const renderControls = (): void => {
    renderFilterRow(
      gradeRow,
      "grade",
      GRADE_FILTERS,
      (key) => key === state.grade,
      (key) => {
        state.grade = key as GradeFilter;
        renderControls();
        applyFilters();
      },
    );
    renderFilterRow(
      topicRow,
      "topic",
      TOPIC_FILTERS,
      (key) => key === state.topic,
      (key) => {
        state.topic = key as TopicFilter;
        renderControls();
        applyFilters();
      },
    );
  };

  renderControls();

  const openAssignDialog = (lesson: SurfaceableLesson, card: HTMLElement): void => {
    void openDialog({
      doc,
      lesson,
      session,
      listClasses: deps.listClasses,
      onConfirm: (summary) => {
        refreshAssignControl(card, lesson);
        showSuccess(successBanner, summary);
      },
    });
  };

  for (const lesson of LESSONS) {
    grid.appendChild(renderLessonCard(doc, lesson, state.activation, openAssignDialog));
  }
  applyFilters();

  // Prefetch classes so the dialog opens with the class list ready.
  void ensureClasses(session.uid, deps.listClasses);

  const returnLink = doc.createElement("a");
  returnLink.href = "/";
  returnLink.textContent = "Return to public lessons";
  returnLink.className = "shell-return-link";
  returnLink.setAttribute("data-testid", "return-link");
  mount.appendChild(returnLink);
}

function refreshAssignControl(
  card: HTMLElement,
  lesson: SurfaceableLesson,
): void {
  const btn = card.querySelector<HTMLButtonElement>(
    `[data-testid=lesson-assign-${lesson.slug}]`,
  );
  if (!btn) return;
  const assigned = isAssigned(lesson.slug);
  btn.textContent = assigned ? "✓ Assigned" : "Assign";
  btn.setAttribute("data-assigned", assigned ? "true" : "false");
  btn.classList.toggle("shell-lesson-assign-assigned", assigned);
  btn.setAttribute(
    "aria-label",
    assigned
      ? `Review assignment for ${lesson.title}`
      : `Assign ${lesson.title}`,
  );
  card.setAttribute("data-lesson-assigned", assigned ? "true" : "false");
}

function showSuccess(banner: HTMLElement, summary: string): void {
  banner.textContent = summary;
  banner.hidden = false;
  const doc = banner.ownerDocument;
  const win = doc.defaultView ?? window;
  win.setTimeout(() => {
    banner.hidden = true;
    banner.textContent = "";
  }, 4000);
}

function renderLessonCard(
  doc: Document,
  lesson: SurfaceableLesson,
  activation: Map<string, boolean>,
  onAssign: (lesson: SurfaceableLesson, card: HTMLElement) => void,
): HTMLElement {
  const card = doc.createElement("article");
  card.className = "shell-card shell-lesson-card";
  card.setAttribute("data-testid", `lesson-card-${lesson.slug}`);
  card.setAttribute("data-lesson-slug", lesson.slug);
  card.setAttribute("data-grade", lesson.grade);
  card.setAttribute("data-topic", lesson.topic);
  card.setAttribute("role", "listitem");

  const setActivationState = (active: boolean): void => {
    activation.set(lesson.slug, active);
    card.setAttribute("data-lesson-active", active ? "true" : "false");
    card.classList.toggle("shell-lesson-card-inactive", !active);
  };

  const header = doc.createElement("div");
  header.className = "shell-lesson-header";
  const gradePill = doc.createElement("span");
  gradePill.className = "shell-lesson-badge shell-lesson-grade";
  gradePill.setAttribute("data-testid", `lesson-grade-${lesson.slug}`);
  gradePill.textContent = `Grade ${lesson.grade}`;
  header.appendChild(gradePill);
  const topicPill = doc.createElement("span");
  topicPill.className = `shell-lesson-badge shell-lesson-topic shell-lesson-topic-${lesson.topic}`;
  topicPill.setAttribute("data-testid", `lesson-topic-${lesson.slug}`);
  topicPill.textContent = TOPIC_LABEL[lesson.topic];
  header.appendChild(topicPill);
  card.appendChild(header);

  const title = doc.createElement("h3");
  title.className = "shell-lesson-title";
  title.setAttribute("data-testid", `lesson-title-${lesson.slug}`);
  title.textContent = lesson.title;
  card.appendChild(title);

  const actions = doc.createElement("div");
  actions.className = "shell-lesson-actions";

  const preview = doc.createElement("a");
  preview.className = "shell-lesson-preview";
  preview.setAttribute("data-testid", `lesson-preview-${lesson.slug}`);
  preview.href = lesson.href;
  preview.textContent = "Preview";
  actions.appendChild(preview);

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "shell-lesson-toggle";
  toggle.setAttribute("data-testid", `lesson-toggle-${lesson.slug}`);
  const initial = activation.get(lesson.slug) ?? true;
  const renderToggle = (active: boolean): void => {
    toggle.setAttribute("aria-pressed", active ? "true" : "false");
    toggle.setAttribute(
      "aria-label",
      active
        ? `Deactivate ${lesson.title} for students`
        : `Activate ${lesson.title} for students`,
    );
    toggle.textContent = active ? "Active" : "Inactive";
    toggle.classList.toggle("shell-lesson-toggle-active", active);
    toggle.classList.toggle("shell-lesson-toggle-inactive", !active);
  };
  renderToggle(initial);
  setActivationState(initial);
  toggle.addEventListener("click", () => {
    const next = !(activation.get(lesson.slug) ?? true);
    setActivationState(next);
    renderToggle(next);
  });
  actions.appendChild(toggle);

  const assign = doc.createElement("button");
  assign.type = "button";
  assign.className = "shell-lesson-assign";
  assign.setAttribute("data-testid", `lesson-assign-${lesson.slug}`);
  const assigned = isAssigned(lesson.slug);
  assign.textContent = assigned ? "✓ Assigned" : "Assign";
  assign.setAttribute("data-assigned", assigned ? "true" : "false");
  assign.classList.toggle("shell-lesson-assign-assigned", assigned);
  assign.setAttribute(
    "aria-label",
    assigned
      ? `Review assignment for ${lesson.title}`
      : `Assign ${lesson.title}`,
  );
  card.setAttribute("data-lesson-assigned", assigned ? "true" : "false");
  assign.addEventListener("click", () => {
    onAssign(lesson, card);
  });
  actions.appendChild(assign);

  card.appendChild(actions);
  return card;
}

// -----------------------------------------------------------------------------
// Assignment Dialog
// -----------------------------------------------------------------------------

type OpenDialogInput = {
  readonly doc: Document;
  readonly lesson: SurfaceableLesson;
  readonly session: ActiveTeacher;
  readonly listClasses: ListClasses;
  readonly onConfirm: (summary: string) => void;
};

async function openDialog(input: OpenDialogInput): Promise<void> {
  const { doc, lesson, session, listClasses, onConfirm } = input;

  const overlay = doc.createElement("div");
  overlay.className = "shell-assign-overlay";
  overlay.setAttribute("data-testid", "assign-overlay");

  const dialog = doc.createElement("div");
  dialog.className = "shell-assign-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "assign-dialog-title");
  dialog.setAttribute("data-testid", "assign-dialog");
  dialog.setAttribute("data-lesson-slug", lesson.slug);

  const title = doc.createElement("h3");
  title.id = "assign-dialog-title";
  title.className = "shell-assign-title";
  title.setAttribute("data-testid", "assign-dialog-title");
  title.textContent = `Assign ${lesson.title}`;
  dialog.appendChild(title);

  const body = doc.createElement("div");
  body.className = "shell-assign-body";
  body.setAttribute("data-testid", "assign-body");
  dialog.appendChild(body);

  const footer = doc.createElement("div");
  footer.className = "shell-assign-footer";
  dialog.appendChild(footer);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-assign-cancel";
  cancel.setAttribute("data-testid", "assign-cancel");
  cancel.textContent = "Cancel";
  footer.appendChild(cancel);

  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "shell-assign-confirm";
  confirm.setAttribute("data-testid", "assign-confirm");
  confirm.textContent = "Assign";
  footer.appendChild(confirm);

  overlay.appendChild(dialog);
  doc.body.appendChild(overlay);

  const close = (): void => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    doc.removeEventListener("keydown", onKey);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  };
  doc.addEventListener("keydown", onKey);
  cancel.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });

  // Loading placeholder while classes resolve.
  const loading = doc.createElement("p");
  loading.className = "shell-assign-loading";
  loading.setAttribute("data-testid", "assign-loading");
  loading.textContent = "Loading your classes";
  body.appendChild(loading);

  await ensureClasses(session.uid, listClasses);
  if (!overlay.isConnected) return;
  body.removeChild(loading);

  const classes = (cachedClasses?.rows ?? []).filter((c) => c.status === "active");

  if (classes.length === 0) {
    const empty = doc.createElement("p");
    empty.className = "shell-assign-empty";
    empty.setAttribute("data-testid", "assign-empty");
    empty.textContent =
      "You do not have any active classes yet. Create a class before assigning.";
    body.appendChild(empty);
    confirm.disabled = true;
    confirm.setAttribute("aria-disabled", "true");
    try {
      cancel.focus({ preventScroll: true });
    } catch {
      // ignored
    }
    return;
  }

  const existing = sessionAssignments.get(lesson.slug);
  const rowState: Map<string, RowConfig> = new Map();
  for (const c of classes) {
    const prior = existing?.rows.get(c.id);
    rowState.set(
      c.id,
      prior
        ? { ...prior }
        : {
            enabled: true,
            date: todayIsoDate(doc),
            time: sessionPreferences.releaseTime,
            topic: sessionPreferences.topic,
            points: DEFAULT_POINTS,
          },
    );
  }

  const rowsHost = doc.createElement("div");
  rowsHost.className = "shell-assign-rows";
  rowsHost.setAttribute("data-testid", "assign-rows");
  body.appendChild(rowsHost);

  const updateConfirmState = (): void => {
    let anyEnabled = false;
    for (const r of rowState.values()) if (r.enabled) anyEnabled = true;
    confirm.disabled = !anyEnabled;
    confirm.setAttribute("aria-disabled", anyEnabled ? "false" : "true");
  };

  for (const c of classes) {
    rowsHost.appendChild(renderRow(doc, c, rowState, updateConfirmState));
  }
  updateConfirmState();

  confirm.addEventListener("click", () => {
    // Persist to session memory.
    const stored: Assignment = { rows: new Map() };
    let enabledCount = 0;
    let firstEnabledTime = "";
    let firstEnabledTopic = "";
    for (const [cid, cfg] of rowState) {
      stored.rows.set(cid, { ...cfg });
      if (cfg.enabled) {
        enabledCount += 1;
        if (!firstEnabledTime) firstEnabledTime = cfg.time;
        if (!firstEnabledTopic && cfg.topic) firstEnabledTopic = cfg.topic;
      }
    }
    if (enabledCount === 0) {
      sessionAssignments.delete(lesson.slug);
    } else {
      sessionAssignments.set(lesson.slug, stored);
    }
    if (firstEnabledTime) sessionPreferences.releaseTime = firstEnabledTime;
    if (firstEnabledTopic) sessionPreferences.topic = firstEnabledTopic;

    const summary =
      enabledCount === 0
        ? `${lesson.title}: no classes selected. Assignment removed.`
        : enabledCount === 1
          ? `Assigned ${lesson.title} to 1 class.`
          : `Assigned ${lesson.title} to ${enabledCount} classes.`;
    close();
    onConfirm(summary);
  });

  try {
    confirm.focus({ preventScroll: true });
  } catch {
    // ignored
  }
}

function renderRow(
  doc: Document,
  cls: ClassSummary,
  rowState: Map<string, RowConfig>,
  onChange: () => void,
): HTMLElement {
  const cfg = rowState.get(cls.id);
  if (!cfg) throw new Error(`missing row state for class ${cls.id}`);

  const row = doc.createElement("div");
  row.className = "shell-assign-row";
  row.setAttribute("data-testid", `assign-row-${cls.id}`);
  row.setAttribute("data-class-id", cls.id);

  // Enabled checkbox + class identity.
  const header = doc.createElement("label");
  header.className = "shell-assign-row-header";
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = cfg.enabled;
  checkbox.setAttribute("data-testid", `assign-row-enabled-${cls.id}`);
  checkbox.setAttribute(
    "aria-label",
    `Include ${cls.title} in this assignment`,
  );
  header.appendChild(checkbox);
  const label = doc.createElement("span");
  label.className = "shell-assign-row-label";
  label.textContent =
    cls.grade.length > 0
      ? `${cls.title} · Grade ${cls.grade}`
      : cls.title;
  header.appendChild(label);
  row.appendChild(header);

  const fields = doc.createElement("div");
  fields.className = "shell-assign-row-fields";
  row.appendChild(fields);

  const dateInput = fieldInput(doc, {
    id: `assign-row-date-${cls.id}`,
    label: "Date",
    type: "date",
    value: cfg.date,
    onInput: (v) => {
      cfg.date = v;
    },
  });
  fields.appendChild(dateInput.wrapper);

  const timeInput = fieldInput(doc, {
    id: `assign-row-time-${cls.id}`,
    label: "Release time",
    type: "time",
    value: cfg.time,
    onInput: (v) => {
      cfg.time = v;
    },
  });
  fields.appendChild(timeInput.wrapper);

  const topicInput = fieldInput(doc, {
    id: `assign-row-topic-${cls.id}`,
    label: "Google Classroom topic",
    type: "text",
    value: cfg.topic,
    placeholder: "None",
    onInput: (v) => {
      cfg.topic = v;
    },
  });
  fields.appendChild(topicInput.wrapper);

  const pointsInput = fieldInput(doc, {
    id: `assign-row-points-${cls.id}`,
    label: "Points",
    type: "number",
    value: String(cfg.points),
    min: 0,
    onInput: (v) => {
      const n = Number(v);
      cfg.points = Number.isFinite(n) && n >= 0 ? n : 0;
    },
  });
  fields.appendChild(pointsInput.wrapper);

  const setRowEnabled = (enabled: boolean): void => {
    cfg.enabled = enabled;
    row.setAttribute("data-enabled", enabled ? "true" : "false");
    row.classList.toggle("shell-assign-row-disabled", !enabled);
    for (const el of [
      dateInput.input,
      timeInput.input,
      topicInput.input,
      pointsInput.input,
    ]) {
      el.disabled = !enabled;
    }
    onChange();
  };
  setRowEnabled(cfg.enabled);
  checkbox.addEventListener("change", () => {
    setRowEnabled(checkbox.checked);
  });

  return row;
}

type FieldInputInput = {
  readonly id: string;
  readonly label: string;
  readonly type: "date" | "time" | "text" | "number";
  readonly value: string;
  readonly placeholder?: string;
  readonly min?: number;
  readonly onInput: (value: string) => void;
};

function fieldInput(
  doc: Document,
  spec: FieldInputInput,
): { wrapper: HTMLElement; input: HTMLInputElement } {
  const wrapper = doc.createElement("label");
  wrapper.className = "shell-assign-field";
  const caption = doc.createElement("span");
  caption.className = "shell-assign-field-label";
  caption.textContent = spec.label;
  wrapper.appendChild(caption);
  const input = doc.createElement("input");
  input.type = spec.type;
  input.value = spec.value;
  input.setAttribute("data-testid", spec.id);
  if (spec.placeholder !== undefined) input.placeholder = spec.placeholder;
  if (spec.min !== undefined) input.min = String(spec.min);
  input.addEventListener("input", () => {
    spec.onInput(input.value);
  });
  wrapper.appendChild(input);
  return { wrapper, input };
}

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

// Test-only reset. Clears the module-scoped session state so unit tests
// can exercise a clean surface. Not called by production code.
export function _resetCurriculumSessionStateForTest(): void {
  sessionAssignments.clear();
  cachedClasses = null;
  classesInFlight = null;
  sessionPreferences.releaseTime = DEFAULT_RELEASE_TIME;
  sessionPreferences.topic = "";
}
