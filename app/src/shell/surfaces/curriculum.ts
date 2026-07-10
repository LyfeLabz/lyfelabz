import type { Session } from "../../session/types";
import {
  getSurfaceableLessons,
  TOPIC_LABEL,
  type LessonGrade,
  type LessonTopic,
  type SurfaceableLesson,
} from "../../curriculum/curriculumManifest";

// Curriculum surface. The teacher curriculum landing page introduced by
// Sprint 6D. Reuses the canonical LyfeLabz lesson-card organization
// (grade + topic) and links out to the canonical instructional
// repository for preview. Introduces placeholder-only activation
// controls: no Firestore reads, no callables, no listeners. See
// TEACHER_EXPERIENCE_PHILOSOPHY.md §3.2 and §3.4,
// TEACHER_PLATFORM_DOMAIN_ROADMAP.md Phase 2 amendment (Sprint 6D),
// and PRESENT_MODE_ARCHITECTURE.md.
//
// Activation state lives in module-local, per-mount client state. It is
// discarded on remount by design; PDR-010 curation semantics land in
// Phase 5 (Assignment Foundation) and will replace this placeholder.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

type GradeFilter = "all" | LessonGrade;
type TopicFilter = "all" | LessonTopic;

const LESSONS: ReadonlyArray<SurfaceableLesson> = getSurfaceableLessons();

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

export function renderCurriculumSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
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

  for (const lesson of LESSONS) {
    grid.appendChild(renderLessonCard(doc, lesson, state.activation));
  }
  applyFilters();

  const returnLink = doc.createElement("a");
  returnLink.href = "/";
  returnLink.textContent = "Return to public lessons";
  returnLink.className = "shell-return-link";
  returnLink.setAttribute("data-testid", "return-link");
  mount.appendChild(returnLink);
}

function renderLessonCard(
  doc: Document,
  lesson: SurfaceableLesson,
  activation: Map<string, boolean>,
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

  card.appendChild(actions);
  return card;
}
