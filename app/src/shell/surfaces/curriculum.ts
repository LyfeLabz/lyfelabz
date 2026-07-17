import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type {
  AssignmentsCallables,
  IntegrationsClassLink,
  IntegrationsDeps,
  IntegrationsLmsTopic,
} from "../../settings/integrations/types";
import {
  getSurfaceableLessons,
  TOPIC_LABEL,
  type LessonGrade,
  type LessonTopic,
  type SurfaceableLesson,
} from "../../curriculum/curriculumManifest";
import type {
  AssignmentDetailMetadata,
  AssignmentStatus,
} from "../../assignments/detail/types";
import {
  compareAssignmentsForSelection,
  isValidForSelection,
} from "../../assignments/detail/grouping";

// Sprint 13B remediation: narrow visible entry-point seam so an
// authenticated teacher can reach the certified Assignment Detail
// surface from the Curriculum lesson card that produced the
// assignment. The Curriculum surface only stores minimal teacher-owned
// metadata (title, class name, status, assignmentId) in the injected
// registry and invokes the entry-point opener. No student roster, no
// recipient identifier, no attempt or session identifier is stored.
export type CurriculumAssignmentDetailSeam = {
  readonly register: (metadata: AssignmentDetailMetadata) => void;
  readonly open: (assignmentId: string) => void;
  // Sprint 13C: enumeration accessor used at Curriculum mount to restore
  // the per-lesson mapping after a full page reload. When absent the
  // surface behaves exactly as Sprint 13B (session-only affordance).
  readonly list?: () => ReadonlyArray<AssignmentDetailMetadata>;
};

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
  // Sprint 8D authorized scope expansion. When absent-or-null the
  // Assignment Dialog renders every class row unchanged
  // (ASSIGN_EXPERIENCE.md §5 preserves the non-LMS shape). When
  // present, LMS-linked class rows carry the topic selector and the
  // "Also publish to Google Classroom" toggle described in §5's
  // "LMS-linked class row shape" subsection.
  readonly integrations?: IntegrationsDeps | null;
  // Sprint 8D.1 authoritative assignment lifecycle seam. When present,
  // confirming the dialog creates and publishes a persistent LyfeLabz
  // assignment per selected class through the certified lifecycle before
  // any LMS-side publication is attempted. When absent-or-null the
  // dialog runs UI-only session-state (used by lightweight UI harnesses
  // that do not exercise the callable lifecycle); no LyfeLabz assignment
  // is persisted and no LMS publication is issued.
  readonly assignments?: AssignmentsCallables | null;
  // Sprint 13B remediation. When present, a successful publish records
  // teacher-owned metadata through `register` and each already-assigned
  // lesson card renders a visible `View summary` secondary action that
  // invokes `open(assignmentId)`. When absent-or-null the card renders
  // unchanged; no affordance is added and no metadata is registered.
  readonly assignmentDetail?: CurriculumAssignmentDetailSeam | null;
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
  lmsTopicId: string;
} = {
  releaseTime: DEFAULT_RELEASE_TIME,
  topic: "",
  lmsTopicId: "",
};

type RowConfig = {
  enabled: boolean;
  date: string;
  time: string;
  topic: string;
  points: number;
  // Sprint 8D authorized additions. Present on every row so the dialog
  // stays one dialog; only rendered for LMS-linked class rows per
  // ASSIGN_EXPERIENCE.md §5.
  publishToLms: boolean;
  lmsTopicId: string;
};

type Assignment = {
  rows: Map<string, RowConfig>;
};

// Assignments the teacher has scheduled during this UI session. Keyed
// by lesson slug. A lesson is considered assigned when at least one row
// is enabled; the last-enabled row's deselection returns the card to
// its unassigned state, mirroring section 8 of ASSIGN_EXPERIENCE.md.
const sessionAssignments: Map<string, Assignment> = new Map();

// Sprint 13B remediation extended by Sprint 13C: session-scoped map from
// lesson slug to every registered assignment metadata for that lesson.
// A lesson may have more than one concurrent assignment when a teacher
// has assigned the same lesson to multiple classes (or across
// publication cycles). Populated at surface mount from the certified
// retrieval-hydrated registry and after every `assignmentsPublish`
// resolves. Deduplicated by canonical `assignmentId`. UID-scoped so a
// same-tab teacher swap cannot leak the prior teacher's mapping.
let sessionAssignmentsByLesson: {
  readonly uid: string;
  readonly map: Map<string, Map<string, AssignmentDetailMetadata>>;
} | null = null;

function ensureAssignmentBucket(
  uid: string,
): Map<string, Map<string, AssignmentDetailMetadata>> {
  if (
    sessionAssignmentsByLesson === null ||
    sessionAssignmentsByLesson.uid !== uid
  ) {
    sessionAssignmentsByLesson = { uid, map: new Map() };
  }
  return sessionAssignmentsByLesson.map;
}

function registerAssignmentMetadata(
  uid: string,
  metadata: AssignmentDetailMetadata,
): void {
  if (!isValidForSelection(metadata)) return;
  const bucket = ensureAssignmentBucket(uid);
  const slug = metadata.lessonSlug as string;
  let byId = bucket.get(slug);
  if (byId === undefined) {
    byId = new Map<string, AssignmentDetailMetadata>();
    bucket.set(slug, byId);
  }
  byId.set(metadata.assignmentId, metadata);
}

function readAssignmentsForLesson(
  uid: string,
  slug: string,
): ReadonlyArray<AssignmentDetailMetadata> {
  const bucket = sessionAssignmentsByLesson;
  if (bucket === null || bucket.uid !== uid) return [];
  const byId = bucket.map.get(slug);
  if (byId === undefined) return [];
  return Array.from(byId.values()).sort(compareAssignmentsForSelection);
}

// Teacher class list cache. Populated lazily on surface mount so the
// dialog opens without a round trip. Keyed by uid to avoid returning a
// prior teacher's cache after a sign-out/sign-in in the same tab.
let cachedClasses: {
  readonly uid: string;
  readonly rows: ReadonlyArray<ClassSummary>;
} | null = null;
let classesInFlight: Promise<void> | null = null;

// LMS class-link cache. Populated lazily alongside `cachedClasses` when
// the Integrations deps carry a `listClassLinks` reader. Keyed by uid
// for the same sign-in-safety reason. Absent-or-empty means every class
// row renders the non-LMS shape (ASSIGN_EXPERIENCE.md §5).
let cachedClassLinks: {
  readonly uid: string;
  readonly linksByClassId: ReadonlyMap<string, IntegrationsClassLink>;
} | null = null;
let classLinksInFlight: Promise<void> | null = null;

// Per-link topic cache. Topics are LMS-owned per PDR-020g and are not
// mirrored into Firestore; the callable resolves them on demand each
// time the dialog opens an LMS-linked class row. The cache is keyed by
// linkId and is cleared alongside the class cache on sign-out.
const cachedTopicsByLinkId: Map<string, ReadonlyArray<IntegrationsLmsTopic>> =
  new Map();
const topicsInFlightByLinkId: Map<string, Promise<void>> = new Map();

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

function ensureClassLinks(
  uid: string,
  integrations: IntegrationsDeps | null,
): Promise<void> {
  if (integrations === null || integrations.listClassLinks === undefined) {
    if (!cachedClassLinks || cachedClassLinks.uid !== uid) {
      cachedClassLinks = Object.freeze({ uid, linksByClassId: new Map() });
    }
    return Promise.resolve();
  }
  if (cachedClassLinks && cachedClassLinks.uid === uid) return Promise.resolve();
  if (classLinksInFlight) return classLinksInFlight;
  const reader = integrations.listClassLinks;
  classLinksInFlight = reader()
    .then((rows) => {
      const map = new Map<string, IntegrationsClassLink>();
      for (const r of rows) map.set(r.classId, r);
      cachedClassLinks = Object.freeze({ uid, linksByClassId: map });
    })
    .catch(() => {
      cachedClassLinks = Object.freeze({ uid, linksByClassId: new Map() });
    })
    .finally(() => {
      classLinksInFlight = null;
    });
  return classLinksInFlight;
}

function ensureTopics(
  linkId: string,
  integrations: IntegrationsDeps | null,
): Promise<void> {
  if (integrations === null) return Promise.resolve();
  if (cachedTopicsByLinkId.has(linkId)) return Promise.resolve();
  const inFlight = topicsInFlightByLinkId.get(linkId);
  if (inFlight) return inFlight;
  const p = integrations.callables
    .listClassTopics({ linkId })
    .then((rows) => {
      cachedTopicsByLinkId.set(linkId, rows);
    })
    .catch(() => {
      cachedTopicsByLinkId.set(linkId, Object.freeze([]));
    })
    .finally(() => {
      topicsInFlightByLinkId.delete(linkId);
    });
  topicsInFlightByLinkId.set(linkId, p);
  return p;
}

export function renderCurriculumSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: CurriculumSurfaceDeps = {
    listClasses: DEFAULT_LIST_CLASSES,
    integrations: null,
    assignments: null,
  },
): void {
  const integrations = deps.integrations ?? null;
  const assignments = deps.assignments ?? null;
  const assignmentDetail = deps.assignmentDetail ?? null;
  const doc = mount.ownerDocument;

  // Sprint 13C: restore the session-scoped per-lesson assignment map from
  // the certified retrieval-hydrated registry so a full page reload does
  // not lose the visible `View summary` (or `View summaries`) affordance.
  // Only teacher-owned metadata is consumed. Deduplication is by canonical
  // `assignmentId`; multiple assignments for the same lesson slug are
  // preserved so the calm selection interface can surface them.
  if (assignmentDetail !== null && typeof assignmentDetail.list === "function") {
    try {
      for (const entry of assignmentDetail.list()) {
        registerAssignmentMetadata(session.uid, entry);
      }
    } catch {
      // Calm degradation. A registry-list failure never blocks Curriculum
      // rendering; the surface reverts to Sprint 13B session-only behavior.
    }
  }

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
      integrations,
      assignments,
      assignmentDetail,
      onConfirm: (summary) => {
        refreshAssignControl(card, lesson);
        refreshViewSummaryControl(card, lesson, session.uid, assignmentDetail);
        showSuccess(successBanner, summary);
      },
      onLifecycleComplete: () => {
        refreshViewSummaryControl(card, lesson, session.uid, assignmentDetail);
      },
    });
  };

  for (const lesson of LESSONS) {
    grid.appendChild(
      renderLessonCard(
        doc,
        lesson,
        state.activation,
        openAssignDialog,
        session.uid,
        assignmentDetail,
      ),
    );
  }
  applyFilters();

  // Prefetch classes and their LMS link status so the dialog opens
  // with the class list and the LMS-linked class row shape ready.
  void ensureClasses(session.uid, deps.listClasses);
  void ensureClassLinks(session.uid, integrations);

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
  teacherUid: string,
  assignmentDetail: CurriculumAssignmentDetailSeam | null,
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
  refreshViewSummaryControl(card, lesson, teacherUid, assignmentDetail);
  return card;
}

// Sprint 13B remediation, extended by Sprint 13C. Renders (or removes)
// the visible teacher-facing secondary action on a lesson card. When
// exactly one valid assignment is registered for the lesson the control
// is labeled `View summary` and opens that assignment directly. When two
// or more valid assignments are registered the control is labeled
// `View summaries` and opens a compact deterministic selection interface.
// Invoking the resolved choice always passes the exact selected
// `assignmentId` to the entry-point opener; the card never re-implements
// detail mounting.
const STATUS_LABEL_FOR_SELECTION: Readonly<Record<AssignmentStatus, string>> =
  Object.freeze({
    draft: "Draft",
    published: "Published",
    closed: "Closed",
  });

function refreshViewSummaryControl(
  card: HTMLElement,
  lesson: SurfaceableLesson,
  teacherUid: string,
  assignmentDetail: CurriculumAssignmentDetailSeam | null,
): void {
  const doc = card.ownerDocument;
  const actions = card.querySelector<HTMLElement>(".shell-lesson-actions");
  if (actions === null) return;
  const existing = actions.querySelector<HTMLButtonElement>(
    `[data-testid=lesson-view-summary-${lesson.slug}]`,
  );
  const assignments =
    assignmentDetail === null
      ? []
      : readAssignmentsForLesson(teacherUid, lesson.slug);
  if (assignments.length === 0 || assignmentDetail === null) {
    if (existing !== null) existing.remove();
    return;
  }
  // Rebuild the control so the singular/plural label stays consistent
  // when the count crosses the 1 -> 2 boundary during the same session.
  if (existing !== null) existing.remove();

  // Sprint 13F: when every registered assignment for this lesson is a
  // draft, the control is labeled `View drafts`. When any published or
  // closed assignment exists, the Sprint 13B/13C `View summary` /
  // `View summaries` behavior is preserved unchanged; any co-registered
  // drafts appear inside the existing selector. Preservation of the
  // published-only path is the primary intent of the Sprint 13F
  // architecture rule.
  const isDraftOnly = assignments.every((a) => a.status === "draft");
  const view = doc.createElement("button");
  view.type = "button";
  view.className = "shell-lesson-view-summary";
  view.setAttribute("data-testid", `lesson-view-summary-${lesson.slug}`);
  if (isDraftOnly) {
    view.setAttribute("data-assignment-count", String(assignments.length));
    view.setAttribute("data-draft-only", "true");
    view.setAttribute("aria-label", `View drafts for ${lesson.title}`);
    view.textContent = "View drafts";
    if (assignments.length === 1) {
      const only = assignments[0]!;
      view.setAttribute("data-assignment-id", only.assignmentId);
      view.addEventListener("click", () => {
        assignmentDetail.open(only.assignmentId);
      });
    } else {
      view.addEventListener("click", () => {
        openAssignmentSelection({
          doc,
          lesson,
          assignments: readAssignmentsForLesson(teacherUid, lesson.slug),
          onSelect: (assignmentId) => {
            assignmentDetail.open(assignmentId);
          },
          returnFocusTo: view,
        });
      });
    }
  } else if (assignments.length === 1) {
    const only = assignments[0]!;
    view.setAttribute("data-assignment-id", only.assignmentId);
    view.setAttribute("data-assignment-count", "1");
    view.setAttribute("aria-label", `View summary for ${lesson.title}`);
    view.textContent = "View summary";
    view.addEventListener("click", () => {
      const id = view.getAttribute("data-assignment-id");
      if (id === null || id.length === 0) return;
      assignmentDetail.open(id);
    });
  } else {
    view.setAttribute("data-assignment-count", String(assignments.length));
    view.setAttribute(
      "aria-label",
      `View summaries for ${lesson.title}`,
    );
    view.textContent = "View summaries";
    view.addEventListener("click", () => {
      openAssignmentSelection({
        doc,
        lesson,
        assignments: readAssignmentsForLesson(teacherUid, lesson.slug),
        onSelect: (assignmentId) => {
          assignmentDetail.open(assignmentId);
        },
        returnFocusTo: view,
      });
    });
  }
  actions.appendChild(view);
}

// -----------------------------------------------------------------------------
// Assignment selection interface (Sprint 13C remediation)
// -----------------------------------------------------------------------------
//
// Compact overlay reused from the existing Assign dialog pattern so no new
// design system is introduced. The interface has a clear heading, names
// the lesson, lists each registered assignment as a native button with an
// accessible name that includes class and status, supports keyboard
// navigation and Escape-dismissal, restores focus to the invoking
// `View summaries` control, and never displays assignment/class/teacher
// identifiers or any student-scoped data.

type OpenAssignmentSelectionInput = {
  readonly doc: Document;
  readonly lesson: SurfaceableLesson;
  readonly assignments: ReadonlyArray<AssignmentDetailMetadata>;
  readonly onSelect: (assignmentId: string) => void;
  readonly returnFocusTo: HTMLElement | null;
};

function openAssignmentSelection(input: OpenAssignmentSelectionInput): void {
  const { doc, lesson, assignments, onSelect, returnFocusTo } = input;
  if (assignments.length === 0) return;

  const overlay = doc.createElement("div");
  overlay.className = "shell-assign-overlay shell-summary-select-overlay";
  overlay.setAttribute("data-testid", "summary-select-overlay");

  const dialog = doc.createElement("div");
  dialog.className = "shell-assign-dialog shell-summary-select-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "summary-select-title");
  dialog.setAttribute("data-testid", "summary-select-dialog");
  dialog.setAttribute("data-lesson-slug", lesson.slug);

  const title = doc.createElement("h3");
  title.id = "summary-select-title";
  title.className = "shell-assign-title";
  title.setAttribute("data-testid", "summary-select-title");
  title.textContent = `Choose an assignment for ${lesson.title}`;
  dialog.appendChild(title);

  const list = doc.createElement("ul");
  list.className = "shell-summary-select-list";
  list.setAttribute("data-testid", "summary-select-list");
  list.setAttribute("role", "list");
  dialog.appendChild(list);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    doc.removeEventListener("keydown", onKey);
    if (returnFocusTo !== null) {
      try {
        returnFocusTo.focus({ preventScroll: true });
      } catch {
        // ignored
      }
    }
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  };

  for (const meta of assignments) {
    const item = doc.createElement("li");
    item.className = "shell-summary-select-item";
    item.setAttribute("role", "listitem");
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-summary-select-choice";
    btn.setAttribute(
      "data-testid",
      `summary-select-choice-${meta.assignmentId}`,
    );
    btn.setAttribute("data-assignment-id", meta.assignmentId);
    const statusLabel = STATUS_LABEL_FOR_SELECTION[meta.status];
    const visibleLabel = `${meta.className} · ${statusLabel}`;
    btn.textContent = visibleLabel;
    btn.setAttribute(
      "aria-label",
      `Open assignment summary for ${meta.className}, ${statusLabel}`,
    );
    // Status is not conveyed through color alone; the visible text carries
    // the label and the accessible name repeats it.
    btn.setAttribute("data-status", meta.status);
    btn.addEventListener("click", () => {
      const id = meta.assignmentId;
      close();
      onSelect(id);
    });
    item.appendChild(btn);
    list.appendChild(item);
  }

  const footer = doc.createElement("div");
  footer.className = "shell-assign-footer";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-assign-cancel";
  cancel.setAttribute("data-testid", "summary-select-cancel");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", close);
  footer.appendChild(cancel);
  dialog.appendChild(footer);

  overlay.appendChild(dialog);
  doc.body.appendChild(overlay);
  doc.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  try {
    const firstChoice = list.querySelector<HTMLButtonElement>(
      ".shell-summary-select-choice",
    );
    (firstChoice ?? cancel).focus({ preventScroll: true });
  } catch {
    // ignored
  }
}

// -----------------------------------------------------------------------------
// Assignment Dialog
// -----------------------------------------------------------------------------

type OpenDialogInput = {
  readonly doc: Document;
  readonly lesson: SurfaceableLesson;
  readonly session: ActiveTeacher;
  readonly listClasses: ListClasses;
  readonly integrations: IntegrationsDeps | null;
  readonly assignments: AssignmentsCallables | null;
  readonly assignmentDetail: CurriculumAssignmentDetailSeam | null;
  readonly onConfirm: (summary: string) => void;
  readonly onLifecycleComplete?: () => void;
};

async function openDialog(input: OpenDialogInput): Promise<void> {
  const {
    doc,
    lesson,
    session,
    listClasses,
    integrations,
    assignments,
    assignmentDetail,
    onConfirm,
    onLifecycleComplete,
  } = input;

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

  await Promise.all([
    ensureClasses(session.uid, listClasses),
    ensureClassLinks(session.uid, integrations),
  ]);
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
            publishToLms: false,
            lmsTopicId: sessionPreferences.lmsTopicId,
          },
    );
  }

  const linksByClassId =
    cachedClassLinks && cachedClassLinks.uid === session.uid
      ? cachedClassLinks.linksByClassId
      : new Map<string, IntegrationsClassLink>();

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
    const link = linksByClassId.get(c.id) ?? null;
    rowsHost.appendChild(
      renderRow(doc, c, rowState, updateConfirmState, link, integrations),
    );
  }
  updateConfirmState();

  // Guard against double-clicks / repeated submissions. A second click
  // before the certified lifecycle resolves is a no-op; the callable
  // registers a stable assignmentId per (lesson, class, session-open) so
  // any callable replay is idempotent server-side, but preventing a
  // second dispatch keeps the client-side outcome accounting honest.
  let submissionInFlight = false;
  confirm.addEventListener("click", () => {
    if (submissionInFlight) return;
    submissionInFlight = true;
    confirm.disabled = true;
    confirm.setAttribute("aria-busy", "true");

    // Persist row state so revisit-in-place works when the dialog is
    // reopened. This is the "temporary in-dialog form state" the sprint
    // authorizes retaining in session memory; the authoritative record
    // is the persistent LyfeLabz assignment produced below.
    const stored: Assignment = { rows: new Map() };
    let enabledCount = 0;
    let firstEnabledTime = "";
    let firstEnabledTopic = "";
    let firstEnabledLmsTopicId = "";
    type EnabledRow = {
      readonly classId: string;
      readonly className: string;
      readonly cfg: RowConfig;
      readonly link: IntegrationsClassLink | null;
    };
    const classById = new Map<string, ClassSummary>(
      classes.map((c) => [c.id, c] as const),
    );
    const enabledRows: EnabledRow[] = [];
    for (const [cid, cfg] of rowState) {
      stored.rows.set(cid, { ...cfg });
      if (cfg.enabled) {
        enabledCount += 1;
        if (!firstEnabledTime) firstEnabledTime = cfg.time;
        if (!firstEnabledTopic && cfg.topic) firstEnabledTopic = cfg.topic;
        if (!firstEnabledLmsTopicId && cfg.lmsTopicId)
          firstEnabledLmsTopicId = cfg.lmsTopicId;
        const cls = classById.get(cid);
        enabledRows.push({
          classId: cid,
          className: cls
            ? cls.grade.length > 0
              ? `${cls.title} · Grade ${cls.grade}`
              : cls.title
            : cid,
          cfg,
          link: linksByClassId.get(cid) ?? null,
        });
      }
    }
    if (enabledCount === 0) {
      sessionAssignments.delete(lesson.slug);
    } else {
      sessionAssignments.set(lesson.slug, stored);
    }
    if (firstEnabledTime) sessionPreferences.releaseTime = firstEnabledTime;
    if (firstEnabledTopic) sessionPreferences.topic = firstEnabledTopic;
    if (firstEnabledLmsTopicId)
      sessionPreferences.lmsTopicId = firstEnabledLmsTopicId;

    // No selected classes -> no assignment lifecycle to run.
    if (enabledCount === 0) {
      close();
      onConfirm(`${lesson.title}: no classes selected. Assignment removed.`);
      return;
    }

    // No callable seam wired -> UI-only lightweight harness path. The
    // dialog still renders the "return, do not redirect" confirmation
    // that ASSIGN_EXPERIENCE.md §7 requires. No LMS publication is
    // attempted because there is no authoritative assignment ID to bind
    // it to; this preserves the Sprint 8D.1 rule that LMS publication
    // never runs before a successful LyfeLabz publication.
    if (assignments === null) {
      close();
      const summary =
        enabledCount === 1
          ? `Assigned ${lesson.title} to 1 class.`
          : `Assigned ${lesson.title} to ${enabledCount} classes.`;
      onConfirm(summary);
      return;
    }

    close();
    // Optimistic quiet-confirmation follows §7's "return, do not
    // redirect" rule. The final per-class outcomes replace the pending
    // line once the certified lifecycle resolves.
    onConfirm(
      enabledCount === 1
        ? `Assigning ${lesson.title} to 1 class.`
        : `Assigning ${lesson.title} to ${enabledCount} classes.`,
    );
    void runAssignmentLifecycle({
      lesson,
      teacherUid: session.uid,
      enabledRows,
      assignments,
      integrations,
      assignmentDetail,
      onConfirm,
      onLifecycleComplete,
    });
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
  link: IntegrationsClassLink | null,
  integrations: IntegrationsDeps | null,
): HTMLElement {
  const cfg = rowState.get(cls.id);
  if (!cfg) throw new Error(`missing row state for class ${cls.id}`);

  const row = doc.createElement("div");
  row.className = "shell-assign-row";
  row.setAttribute("data-testid", `assign-row-${cls.id}`);
  row.setAttribute("data-class-id", cls.id);
  if (link) {
    row.setAttribute("data-lms-linked", "true");
    row.setAttribute("data-lms-link-id", link.linkId);
    row.setAttribute("data-lms-provider", link.providerId);
  }

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

  // For LMS-linked classes, the Google Classroom topic field is a
  // populated dropdown per ASSIGN_EXPERIENCE.md §5 ("LMS-linked class
  // row shape"). For non-LMS classes the plain-text preference input is
  // preserved so Sprint 6E's remembered-topic behavior is unchanged.
  let topicInput: { wrapper: HTMLElement; input: HTMLInputElement } | null =
    null;
  let lmsTopicSelect: HTMLSelectElement | null = null;
  if (link && integrations !== null) {
    const wrapper = doc.createElement("label");
    wrapper.className = "shell-assign-field shell-assign-lms-topic-field";
    const caption = doc.createElement("span");
    caption.className = "shell-assign-field-label";
    caption.textContent = "Google Classroom topic";
    wrapper.appendChild(caption);
    const select = doc.createElement("select");
    select.className = "shell-assign-lms-topic-select";
    select.setAttribute("data-testid", `assign-row-lms-topic-${cls.id}`);
    const noneOption = doc.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "No topic";
    select.appendChild(noneOption);
    const loadingOption = doc.createElement("option");
    loadingOption.value = "__loading";
    loadingOption.textContent = "Loading topics";
    loadingOption.disabled = true;
    loadingOption.selected = true;
    select.appendChild(loadingOption);
    select.addEventListener("change", () => {
      const v = select.value;
      cfg.lmsTopicId = v === "__loading" ? "" : v;
    });
    wrapper.appendChild(select);
    fields.appendChild(wrapper);
    lmsTopicSelect = select;
    void ensureTopics(link.linkId, integrations).then(() => {
      const topics = cachedTopicsByLinkId.get(link.linkId) ?? [];
      // Populate the select with the resolved topics. If the topic
      // callable fails (either operationally not-yet-provisioned per
      // PDR-020 §10.3 or an upstream error per §8), the "No topic"
      // option remains the only usable choice; the row stays functional.
      loadingOption.remove();
      for (const t of topics) {
        const opt = doc.createElement("option");
        opt.value = t.lmsTopicId;
        opt.textContent = t.name;
        select.appendChild(opt);
      }
      if (
        cfg.lmsTopicId &&
        topics.some((t) => t.lmsTopicId === cfg.lmsTopicId)
      ) {
        select.value = cfg.lmsTopicId;
      } else {
        select.value = "";
        cfg.lmsTopicId = "";
      }
    });
  } else {
    topicInput = fieldInput(doc, {
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
  }

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

  // Sprint 8D authorized addition. The publish toggle is present only
  // for LMS-linked rows per ASSIGN_EXPERIENCE.md §5. It is off by
  // default until the teacher opts in for that class (PDR-019a
  // "integration is opt-in per teacher, per class, per action").
  let publishCheckbox: HTMLInputElement | null = null;
  if (link && integrations !== null) {
    const publishWrapper = doc.createElement("label");
    publishWrapper.className = "shell-assign-field shell-assign-lms-publish-field";
    publishCheckbox = doc.createElement("input");
    publishCheckbox.type = "checkbox";
    publishCheckbox.checked = cfg.publishToLms;
    publishCheckbox.setAttribute(
      "data-testid",
      `assign-row-lms-publish-${cls.id}`,
    );
    publishCheckbox.setAttribute(
      "aria-label",
      `Also publish ${cls.title} to Google Classroom`,
    );
    publishWrapper.appendChild(publishCheckbox);
    const publishLabel = doc.createElement("span");
    publishLabel.className = "shell-assign-field-label";
    publishLabel.textContent = "Also publish to Google Classroom";
    publishWrapper.appendChild(publishLabel);
    publishCheckbox.addEventListener("change", () => {
      cfg.publishToLms = publishCheckbox!.checked;
    });
    fields.appendChild(publishWrapper);
  }

  const setRowEnabled = (enabled: boolean): void => {
    cfg.enabled = enabled;
    row.setAttribute("data-enabled", enabled ? "true" : "false");
    row.classList.toggle("shell-assign-row-disabled", !enabled);
    const controls: HTMLElement[] = [
      dateInput.input,
      timeInput.input,
      pointsInput.input,
    ];
    if (topicInput) controls.push(topicInput.input);
    if (lmsTopicSelect) controls.push(lmsTopicSelect);
    if (publishCheckbox) controls.push(publishCheckbox);
    for (const el of controls) {
      (el as HTMLInputElement | HTMLSelectElement).disabled = !enabled;
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
// Authoritative assignment lifecycle
// -----------------------------------------------------------------------------

// Canonical LyfeLabz curriculum resources are static per PDR-007 and are
// not versioned per lesson today; every assignment created by the Assign
// Experience references the sole "v1" lesson version so the callable
// contract's required `lessonVersion` field is populated with a stable
// value. When per-lesson versioning ships, the manifest becomes the
// authoritative source of this value.
const DEFAULT_LESSON_VERSION = "v1";

// Deterministic client-side assignmentId for a (teacher, lesson, class,
// dialog-open) tuple. The server-side callable is idempotent against
// replays of the same id (assignmentsCreateDraft §4 "Idempotency"), so a
// unique id per teacher-initiated confirmation keeps repeat submissions
// from silently minting duplicate records while still guaranteeing a
// fresh record for each distinct confirmation moment. Constrained to the
// callable's URL-safe pattern.
function mintAssignmentId(
  teacherUid: string,
  lessonSlug: string,
  classId: string,
  nonce: string,
): string {
  const safe = (v: string): string =>
    v.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const raw = `a-${safe(lessonSlug)}-${safe(classId)}-${safe(teacherUid)}-${safe(nonce)}`;
  // Callable enforces max 64 chars; trim from the front (which repeats
  // stable teacher context) and keep the tail (which includes the fresh
  // per-confirm nonce) so replay idempotency is preserved.
  return raw.length <= 64 ? raw : raw.slice(raw.length - 64);
}

function mintNonce(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g && typeof g.randomUUID === "function") {
    return g.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

type PerClassOutcome = {
  readonly classId: string;
  readonly lyfelabzAssigned: boolean;
  readonly lmsRequested: boolean;
  readonly lmsSucceeded: boolean;
};

// Run the certified per-class lifecycle:
//   1. assignmentsCreateDraft  (persistent record; server-authoritative)
//   2. assignmentsPublish      (advances lifecycle to `published`)
//   3. lmsAssignmentsPublish   (side effect, gated on 1+2 success and
//                               teacher opt-in for that class)
//
// Independent per-class outcomes: a failure for one class never erases
// or reverses a success for another. LMS publication is skipped for any
// class whose LyfeLabz assignment did not reach `published`; the
// authoritative record is never disturbed by an LMS-side failure. This
// is the load-bearing invariant PDR-019d records and PDR-020c preserves.
async function runAssignmentLifecycle(input: {
  readonly lesson: SurfaceableLesson;
  readonly teacherUid: string;
  readonly enabledRows: readonly {
    readonly classId: string;
    readonly className: string;
    readonly cfg: RowConfig;
    readonly link: IntegrationsClassLink | null;
  }[];
  readonly assignments: AssignmentsCallables;
  readonly integrations: IntegrationsDeps | null;
  readonly assignmentDetail: CurriculumAssignmentDetailSeam | null;
  readonly onConfirm: (summary: string) => void;
  readonly onLifecycleComplete?: () => void;
}): Promise<void> {
  const {
    lesson,
    teacherUid,
    enabledRows,
    assignments,
    integrations,
    assignmentDetail,
    onConfirm,
    onLifecycleComplete,
  } = input;
  const nonce = mintNonce();
  const lyfelabzUrl =
    typeof window !== "undefined" && window.location
      ? `${window.location.origin}${lesson.href}`
      : lesson.href;

  const outcomes = await Promise.all(
    enabledRows.map(async (row): Promise<PerClassOutcome> => {
      const assignmentId = mintAssignmentId(
        teacherUid,
        lesson.slug,
        row.classId,
        nonce,
      );
      const wantsLms =
        row.link !== null && row.cfg.publishToLms && integrations !== null;

      // Step 1: authoritative draft. If this fails, no publish and no
      // LMS side effect.
      try {
        await assignments.createDraft({
          assignmentId,
          classId: row.classId,
          lessonSlug: lesson.slug,
          lessonVersion: DEFAULT_LESSON_VERSION,
          mode: "classroom",
          title: lesson.title,
        });
      } catch {
        return {
          classId: row.classId,
          lyfelabzAssigned: false,
          lmsRequested: wantsLms,
          lmsSucceeded: false,
        };
      }

      // Step 2: advance to published. The certified LyfeLabz assignment
      // record must reach `published` before any LMS-side publication
      // may be issued.
      try {
        await assignments.publish({ assignmentId });
      } catch {
        return {
          classId: row.classId,
          lyfelabzAssigned: false,
          lmsRequested: wantsLms,
          lmsSucceeded: false,
        };
      }

      // Sprint 13B remediation. Record the published assignment in the
      // session-scoped registry so the lesson card can render the visible
      // `View summary` opener. Only teacher-owned metadata is stored.
      if (assignmentDetail !== null) {
        try {
          const meta: AssignmentDetailMetadata = {
            assignmentId,
            title: lesson.title,
            className: row.className,
            status: "published",
            lessonSlug: lesson.slug,
            classId: row.classId,
          };
          assignmentDetail.register(meta);
          registerAssignmentMetadata(teacherUid, meta);
        } catch {
          // defensive no-op: registry failure never disturbs the
          // authoritative publish outcome
        }
      }

      // Step 3: optional LMS publication using the authoritative id.
      if (!wantsLms || row.link === null || integrations === null) {
        return {
          classId: row.classId,
          lyfelabzAssigned: true,
          lmsRequested: false,
          lmsSucceeded: false,
        };
      }
      const lmsTopicId = row.cfg.lmsTopicId;
      try {
        const outcome = await integrations.callables.publishAssignment({
          assignmentId,
          linkId: row.link.linkId,
          lyfelabzAssignmentUrl: lyfelabzUrl,
          title: lesson.title,
          ...(lmsTopicId !== "" ? { lmsTopicId } : {}),
        });
        return {
          classId: row.classId,
          lyfelabzAssigned: true,
          lmsRequested: true,
          lmsSucceeded: outcome.status === "succeeded",
        };
      } catch {
        return {
          classId: row.classId,
          lyfelabzAssigned: true,
          lmsRequested: true,
          lmsSucceeded: false,
        };
      }
    }),
  );

  onConfirm(summarizeOutcomes(lesson, outcomes));
  onLifecycleComplete?.();
}

function summarizeOutcomes(
  lesson: SurfaceableLesson,
  outcomes: readonly PerClassOutcome[],
): string {
  const total = outcomes.length;
  const assigned = outcomes.filter((o) => o.lyfelabzAssigned).length;
  const notAssigned = total - assigned;
  const lmsRequested = outcomes.filter((o) => o.lmsRequested).length;
  const lmsSucceeded = outcomes.filter((o) => o.lmsSucceeded).length;
  const lmsFailed = lmsRequested - lmsSucceeded;

  // Base LyfeLabz-scoped line. Independent per-class success/failure is
  // reported alongside the aggregate count so a single failure never
  // silently erases the successes for other classes.
  let base: string;
  if (assigned === total && total === 1) {
    base = `Assigned ${lesson.title} to 1 class.`;
  } else if (assigned === total) {
    base = `Assigned ${lesson.title} to ${assigned} classes.`;
  } else if (assigned === 0) {
    base = `${lesson.title}: LyfeLabz assignment was not created. Google Classroom publication was not attempted.`;
  } else {
    base = `Assigned ${lesson.title} to ${assigned} of ${total} classes. ${notAssigned} did not save.`;
  }

  if (lmsRequested === 0) return base;
  if (assigned === 0) return base;

  // LMS-side outcome line follows the "return, do not redirect" and
  // "authoritative LyfeLabz record" rules of §7. It never blames the
  // teacher and never implies the LyfeLabz assignment was rolled back.
  let lmsLine: string;
  if (lmsFailed === 0) {
    lmsLine = "Publishing to Google Classroom succeeded.";
  } else if (lmsSucceeded === 0) {
    lmsLine = "Publishing to Google Classroom did not succeed.";
  } else {
    lmsLine = `Publishing to Google Classroom succeeded for ${lmsSucceeded} class${lmsSucceeded === 1 ? "" : "es"} and did not succeed for ${lmsFailed}.`;
  }
  return `${base} ${lmsLine}`;
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
  cachedClassLinks = null;
  classLinksInFlight = null;
  cachedTopicsByLinkId.clear();
  topicsInFlightByLinkId.clear();
  sessionPreferences.releaseTime = DEFAULT_RELEASE_TIME;
  sessionPreferences.topic = "";
  sessionPreferences.lmsTopicId = "";
  sessionAssignmentsByLesson = null;
}
