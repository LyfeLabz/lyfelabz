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
import type { AssignmentSummaryCallable } from "../../assignments/summary/types";
import {
  renderActiveAssignmentsSection,
  type ActiveAssignmentsController,
} from "./shared/activeAssignments";
import { mintAssignmentId } from "./shared/assignmentId";
import {
  clearConnectionReconnectNeeded,
  createConsentCoordinator,
  mintNonce,
  recordConnectionReconnectNeeded,
  recordLmsPublicationRetryContext,
  runPublicationAction,
  _resetLmsPublicationStateForTest,
} from "./shared/lmsPublication";
import type { AssignmentLmsPublicationState } from "../../assignments/detail/types";

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
  // Sprint 16 Slice 1: stable per-tab seam allowing the Curriculum
  // surface to install (or clear) an invalidator that the entry point
  // invokes on every lifecycle registration. Absent-or-null keeps the
  // Sprint 15 behavior: `onStatusChange` only re-registers the registry
  // and the next Curriculum mount reads the fresh registry as today.
  readonly setActiveAssignmentsInvalidator?: (
    invalidator: ((assignmentId: string) => void) | null,
  ) => void;
  // Sprint 28.5D (D2A): shell/outlet seam. The persistent Teacher
  // Workspace shell registers a bounded controller here at mount so the
  // entry-point Assignment Detail opener can render Detail into the shell's
  // own content outlet instead of clearing `#app-root`. Registering the
  // controller keeps the header, navigation, and footer mounted while
  // Detail is displayed; the controller clears only the outlet's local
  // content. When absent-or-unset (a shell built without this seam, or a
  // non-teacher session), the opener falls back to its pre-28.5D behavior.
  // See TeacherShellOutletController.
  readonly setOutletController?: (
    controller: TeacherShellOutletController | null,
  ) => void;
};

// Sprint 28.5D (D2A): the bounded surface-render seam exposed by the
// Teacher Workspace shell. `show` clears the shell's content outlet and
// hands the caller the outlet host to render an overlay surface (today
// only Assignment Detail) while the header, navigation, and footer remain
// mounted and Curriculum stays the active global navigation context. It is
// deliberately not a router, a history stack, or a navigation state
// machine; it is a single "render this into my outlet" call.
export type TeacherShellOutletController = {
  readonly show: (render: (host: HTMLElement) => void) => void;
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
  // Sprint 15: certified `assessmentAssignmentSummary` callable seam
  // consumed by the Active Assignments dashboard for per-card progress
  // counts. When absent-or-null the dashboard renders without the
  // progress line; the aggregate-only confidentiality boundary is
  // preserved either way (no student, attempt, or answer data is named
  // by the dashboard).
  readonly assignmentSummary?: AssignmentSummaryCallable | null;
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

// The visible "✓ Assigned" badge must reflect an authoritative signal
// that at least one `published` LyfeLabz assignment exists for this
// lesson. The badge must never light up optimistically on the strength
// of the in-dialog form state alone, because a subsequent
// `assignmentsCreateDraft` / `assignmentsPublish` failure would leave a
// "✓ Assigned" card with no persisted record on the server. The badge
// is therefore driven by `sessionPersistedSlugs`, which is written
// exclusively from:
//   (a) surface-mount hydration of the persisted assignment registry
//       (rediscovery after a full page reload),
//   (b) `runAssignmentLifecycle` after at least one row has reached the
//       `published` state, and
//   (c) the certified UI-only harness path (no callable seam wired),
//       which is the sprint-sanctioned lightweight success mode.
// `sessionAssignments` remains the in-dialog row-config prefill and is
// intentionally NOT read here.
let sessionPersistedSlugs: {
  readonly uid: string;
  readonly slugs: Set<string>;
} | null = null;

// Sprint 20 teacher-workspace state persistence. Curriculum grade/topic
// filter selections must survive Curriculum -> Classes -> Curriculum
// navigation without a full page reload. The shell tears down the
// Curriculum surface on tab switch, so filter state cannot live in the
// per-render `state` object alone. UID-scoped so a same-tab teacher
// swap (sign-out/sign-in as a different teacher) starts with fresh
// defaults; matches the existing pattern used by
// `sessionAssignmentsByLesson` and `sessionPersistedSlugs`. No Firestore
// persistence, no cross-device sync, no per-user database field.
let sessionFilters: {
  readonly uid: string;
  grade: GradeFilter;
  topic: TopicFilter;
} | null = null;

function isValidGradeFilter(v: string): v is GradeFilter {
  for (const g of GRADE_FILTERS) if (g.key === v) return true;
  return false;
}

function isValidTopicFilter(v: string): v is TopicFilter {
  for (const t of TOPIC_FILTERS) if (t.key === v) return true;
  return false;
}

function readSessionFilters(uid: string): {
  grade: GradeFilter;
  topic: TopicFilter;
} {
  if (sessionFilters === null || sessionFilters.uid !== uid) {
    return { grade: "all", topic: "all" };
  }
  // Defensive validation: if a previously stored value is no longer a
  // valid filter key (e.g. TOPIC_FILTERS was pruned in a later release
  // while a same-session bucket still held the old value), fall back to
  // the safe default rather than propagating a stale key into the UI.
  const grade: GradeFilter = isValidGradeFilter(sessionFilters.grade)
    ? sessionFilters.grade
    : "all";
  const topic: TopicFilter = isValidTopicFilter(sessionFilters.topic)
    ? sessionFilters.topic
    : "all";
  return { grade, topic };
}

function writeSessionFilters(
  uid: string,
  grade: GradeFilter,
  topic: TopicFilter,
): void {
  sessionFilters = { uid, grade, topic };
}

function ensurePersistedSlugsBucket(uid: string): Set<string> {
  if (sessionPersistedSlugs === null || sessionPersistedSlugs.uid !== uid) {
    sessionPersistedSlugs = { uid, slugs: new Set() };
  }
  return sessionPersistedSlugs.slugs;
}

function markPersisted(uid: string, slug: string): void {
  ensurePersistedSlugsBucket(uid).add(slug);
}

function unmarkPersisted(uid: string, slug: string): void {
  if (sessionPersistedSlugs === null || sessionPersistedSlugs.uid !== uid) {
    return;
  }
  sessionPersistedSlugs.slugs.delete(slug);
}

function isAssigned(slug: string): boolean {
  const bucket = sessionPersistedSlugs;
  if (bucket === null) return false;
  return bucket.slugs.has(slug);
}

// Sprint 26 Phase 3 (Defect 2.B). Which persisted assignment statuses
// qualify a lesson card for the "✓ Assigned" badge. Only a status that
// represents an assignment that actually reached the successfully-published
// workflow qualifies:
//   - `published`: the assignment is live for students.
//   - `closed`:    the assignment was published and later closed; it is
//                  still historically an assignment of this lesson, and the
//                  Active Assignments dashboard already treats a closed
//                  assignment as a real (renderable) assignment. Keeping the
//                  card "Assigned" for a closed assignment matches that
//                  precedent and avoids an inconsistency between the lesson
//                  card, Active Assignments, and the View summary control.
//   - `draft`:     a stranded draft does NOT qualify. A draft has not
//                  reached the assigned state; the durable draft remains
//                  available to legitimate draft UI (the View drafts control
//                  and the assignment detail surface), but it must never
//                  light the successful "Assigned" badge.
function qualifiesForAssignedBadge(status: AssignmentStatus): boolean {
  return status === "published" || status === "closed";
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
  // A successful load (including a course that legitimately has no topics) is
  // cached as authoritative for the session. A failed load is intentionally
  // NOT cached. Before the teacher grants the publication scopes, the topics
  // scope (classroom.topics.readonly) is absent, so the list call fails and
  // the selector degrades to "No topic" - the accepted pre-consent state.
  // Caching that failure as an empty list would be indistinguishable from
  // "this course has no topics", so the real topics would never appear after
  // publication incremental consent widens the connection. Leaving a failed
  // load uncached lets the next Assign-dialog open re-attempt against the
  // possibly-widened connection. Topic loading never triggers consent;
  // publication remains the sole trigger for incremental consent.
  if (cachedTopicsByLinkId.has(linkId)) return Promise.resolve();
  const inFlight = topicsInFlightByLinkId.get(linkId);
  if (inFlight) return inFlight;
  const p = integrations.callables
    .listClassTopics({ linkId })
    .then((rows) => {
      cachedTopicsByLinkId.set(linkId, rows);
    })
    .catch(() => {
      // Transient failure: do not cache. The call site reads an absent cache
      // entry as an empty selector for this render, and a later open re-fetches.
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
        // Sprint 26 Phase 3 (Defect 2.B). Rediscover the "✓ Assigned" badge
        // only for lessons that have a hydrated assignment whose status
        // qualifies as successfully assigned. The certified enumeration path
        // opts into draft discovery (`includeDrafts: true` in
        // `hydrate-wire.ts`), so the hydrated registry can now contain
        // stranded `draft` entries. Marking every hydrated entry persisted
        // regardless of status would let a draft-only lesson falsely show
        // "Assigned" after a reload. The draft still hydrates and stays
        // available to the View drafts control and the assignment detail
        // surface; it simply does not drive the successful badge.
        if (
          typeof entry.lessonSlug === "string" &&
          entry.lessonSlug.length > 0 &&
          qualifiesForAssignedBadge(entry.status)
        ) {
          markPersisted(session.uid, entry.lessonSlug);
        }
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

  // Sprint 15: Active Assignments dashboard section. Rendered only when
  // the signed-in teacher has one or more `published` assignments in the
  // session-scoped registry (Sprint 14 §5.1). Reads exclusively from the
  // already-hydrated registry; introduces no new enumeration path.
  let activeAssignmentsController: ActiveAssignmentsController | null = null;
  if (assignmentDetail !== null && typeof assignmentDetail.list === "function") {
    activeAssignmentsController = renderActiveAssignmentsSection(mount, {
      listRegistry: () => assignmentDetail.list?.() ?? [],
      open: (id) => {
        assignmentDetail.open(id);
      },
      summaryCallable: deps.assignmentSummary ?? null,
    });
    // Sprint 16 Slice 1: install the per-assignment invalidator so a
    // lifecycle status change routed through `onStatusChange` while
    // Curriculum is the mounted surface evicts that card's progress
    // cache and re-fetches on the next render. The seam is cleared when
    // Curriculum unmounts (the entry point calls the setter with null
    // before mounting Assignment Detail) so a stale invalidator cannot
    // fire against a detached section.
    if (typeof assignmentDetail.setActiveAssignmentsInvalidator === "function") {
      assignmentDetail.setActiveAssignmentsInvalidator((assignmentId) => {
        activeAssignmentsController?.refresh({ assignmentIds: [assignmentId] });
      });
    }
  }

  const intro = doc.createElement("p");
  intro.className = "shell-status shell-curriculum-intro";
  intro.setAttribute("data-testid", "curriculum-intro");
  intro.textContent =
    "Activate the LyfeLabz lessons your students can access.";
  mount.appendChild(intro);

  const restored = readSessionFilters(session.uid);
  const state: {
    grade: GradeFilter;
    topic: TopicFilter;
    activation: Map<string, boolean>;
  } = {
    grade: restored.grade,
    topic: restored.topic,
    activation: new Map(LESSONS.map((l) => [l.slug, true])),
  };
  writeSessionFilters(session.uid, state.grade, state.topic);

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
        writeSessionFilters(session.uid, state.grade, state.topic);
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
        writeSessionFilters(session.uid, state.grade, state.topic);
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
        activeAssignmentsController?.refresh();
        showSuccess(successBanner, summary);
      },
      onLifecycleComplete: (assignmentIds) => {
        // Re-derive the Assign badge from the persisted-assignment
        // registry so the card only shows "✓ Assigned" after at least
        // one class successfully published, and reverts to "Assign"
        // when every class failed.
        refreshAssignControl(card, lesson);
        refreshViewSummaryControl(card, lesson, session.uid, assignmentDetail);
        activeAssignmentsController?.refresh(
          assignmentIds.length > 0 ? { assignmentIds } : undefined,
        );
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

// Tracks the pending self-dismiss timer per banner so a newer
// confirmation (e.g. the final outcome line that replaces the optimistic
// "Assigning..." line) cancels the older timer instead of inheriting it.
// Without this, the optimistic timeout could hide the final "Assigned"
// message early.
const successDismissTimers = new WeakMap<HTMLElement, number>();

function showSuccess(banner: HTMLElement, summary: string): void {
  banner.textContent = summary;
  banner.hidden = false;
  banner.classList.add("shell-curriculum-success-visible");
  const doc = banner.ownerDocument;
  const win = doc.defaultView ?? window;
  // Cancel any in-flight dismissal so only the newest message owns the
  // self-dismiss timer. This is what keeps the optimistic timeout from
  // clearing the final Assigned confirmation.
  const pending = successDismissTimers.get(banner);
  if (pending !== undefined) {
    win.clearTimeout(pending);
  }
  const handle = win.setTimeout(() => {
    banner.hidden = true;
    banner.textContent = "";
    banner.classList.remove("shell-curriculum-success-visible");
    successDismissTimers.delete(banner);
  }, 4000);
  successDismissTimers.set(banner, handle);
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

  const titleRow = doc.createElement("div");
  titleRow.className = "shell-lesson-title-row";

  const title = doc.createElement("h3");
  title.className = "shell-lesson-title";
  title.setAttribute("data-testid", `lesson-title-${lesson.slug}`);
  title.textContent = lesson.title;
  titleRow.appendChild(title);

  card.appendChild(titleRow);

  const actions = doc.createElement("div");
  actions.className = "shell-lesson-actions";

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
    toggle.textContent = active ? "" : "Inactive";
    toggle.hidden = active;
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
  readonly onLifecycleComplete?: (
    assignmentIds: ReadonlyArray<string>,
  ) => void;
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

  const classes = (cachedClasses?.rows ?? []).filter(
    (c): c is Extract<ClassSummary, { status: "active" }> =>
      c.status === "active",
  );

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
        ? // Classroom publication is opt-in per action (PDR-019a). The
          // publish toggle must be OFF every time the dialog opens; a
          // prior ON state must never be restored. Every other
          // remembered field (enabled, date, time, points, topic,
          // lmsTopicId) rehydrates from the prior row as before. This
          // forced reset is the single field the whole-row persistence
          // must never carry across opens.
          { ...prior, publishToLms: false }
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
    type ActiveClassSummary = Extract<ClassSummary, { status: "active" }>;
    const classById = new Map<string, ActiveClassSummary>(
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
      // Deselecting every row is an explicit "remove" intent. Drop the
      // Assigned badge state so the card returns to "Assign".
      unmarkPersisted(session.uid, lesson.slug);
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
      // Sprint-sanctioned UI-only harness: no callable to fail, so the
      // Assigned badge lights up synchronously with the summary.
      markPersisted(session.uid, lesson.slug);
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
  cls: Extract<ClassSummary, { status: "active" }>,
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
  // row shape").
  //
  // Sprint 28.5D (microcopy): a manual (non-LMS) LyfeLabz class has no
  // Google Classroom to publish to, so the free-text "Google Classroom
  // topic" field that used to render for it was inert and mildly confusing
  // (28.5C audit §11/§23). It is now omitted for non-LMS rows. This is a
  // presentation-only conditional keyed on the same class/LMS state the
  // dialog already resolves (`link && integrations`); no stored value,
  // submit payload, or LMS-linked publication behavior changes. The
  // remembered-topic preference plumbing (`cfg.topic`) is retained but
  // simply never surfaced for a manual class.
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

// Deterministic client-side assignmentId minting now lives in the
// firebase-free `./shared/assignmentId` module so it can be unit-tested
// against the server's URL-safe pattern in isolation. Sprint 25
// certification scenario B6 exposed that the previous in-line minter
// tail-sliced over-length ids and could emit an id beginning with "-",
// which the callable rejected with `assignments.invalidAssignmentId`.
// `mintAssignmentId` is imported above.

// `mintNonce` now lives in the shared publication module so the confirm
// path, the automatic re-issue, and the detail-view retry all mint attempt
// nonces the same way (implementation plan §2.1). It is imported above.

// Sprint 26 Phase 3 (Defect 2.A). The LyfeLabz-side lifecycle state for a
// single class row. The earlier `lyfelabzAssigned: boolean` collapsed two
// materially different failure states - "nothing was saved" and "a durable
// draft was saved but publication did not complete" - into one falsy value,
// which let the teacher-facing summary claim the assignment "was not
// created" even though the durable draft existed. This discriminated state
// carries enough information for a truthful per-class and aggregate summary:
//   - `draftFailed`:      `assignmentsCreateDraft` failed; no durable
//                         LyfeLabz assignment exists for this class.
//   - `savedNotPublished`: the draft was created durably but
//                         `assignmentsPublish` did not complete. The
//                         assignment is recoverable (it rehydrates through
//                         the certified draft-enumeration path and can be
//                         published from the assignment detail surface).
//   - `published`:        the LyfeLabz assignment reached `published`.
// Only the `published` state qualifies the lesson card for the "✓ Assigned"
// badge; see `qualifiesForAssignedBadge` and Defect 2.B.
type LyfelabzAssignmentState =
  | "draftFailed"
  | "savedNotPublished"
  | "published";

type PerClassOutcome = {
  readonly classId: string;
  readonly assignmentId: string;
  readonly lyfelabzState: LyfelabzAssignmentState;
  readonly lmsRequested: boolean;
  // Sprint 25 Phase 3: the calm, provider-neutral publication state for
  // this row. `notRequested` when the toggle was off (or the row was not
  // LMS-linked). Otherwise one of the four `AssignmentLmsPublicationState`
  // values produced by `runPublicationAction`.
  readonly lmsState: "notRequested" | AssignmentLmsPublicationState;
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
  readonly onLifecycleComplete?: (
    assignmentIds: ReadonlyArray<string>,
  ) => void;
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

  // Sprint 27 Phase 4 (blueprint Decision 4): the client no longer computes
  // or supplies the Classroom destination URL. `lmsAssignmentsPublish`
  // constructs the coursework link server-side from the authoritative
  // assignmentId, so the former `window.location.origin + lesson.href`
  // computation is removed and no client value can influence the destination
  // (PDR-027 §8.3).

  // One consent coordinator per confirm action. When several LMS-linked
  // rows in the same confirm each return insufficient scope, exactly one
  // incremental-consent OAuth flow runs and the single completed consent is
  // reused across every affected row (definition Part 10, blueprint §7).
  const consentCoordinator = createConsentCoordinator();

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
          mode: "classroom",
          title: lesson.title,
        });
      } catch {
        // Draft creation failed: nothing durable was saved for this class.
        return {
          classId: row.classId,
          assignmentId,
          lyfelabzState: "draftFailed",
          lmsRequested: wantsLms,
          lmsState: "notRequested",
        };
      }

      // Step 2: advance to published. The certified LyfeLabz assignment
      // record must reach `published` before any LMS-side publication
      // may be issued.
      try {
        await assignments.publish({ assignmentId });
      } catch {
        // Publication did not complete, but the durable draft from step 1
        // exists and is recoverable. This is NOT "the assignment was not
        // created" - the summary must say the assignment was saved and can
        // be tried again.
        return {
          classId: row.classId,
          assignmentId,
          lyfelabzState: "savedNotPublished",
          lmsRequested: wantsLms,
          lmsState: "notRequested",
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
      const link = row.link;
      if (!wantsLms || link === null || integrations === null) {
        return {
          classId: row.classId,
          assignmentId,
          lyfelabzState: "published",
          lmsRequested: false,
          lmsState: "notRequested",
        };
      }
      const lmsTopicId = row.cfg.lmsTopicId;
      // One attempt nonce per logical publication action for this row
      // (implementation plan §2.1). It is passed on the initial call and
      // reused on the single automatic re-issue after incremental consent;
      // it is never re-minted per HTTPS call and never shared across rows.
      const publishNonce = mintNonce();
      const publishCallables = integrations.callables;
      const result = await runPublicationAction({
        nonce: publishNonce,
        publish: (attemptNonce) =>
          publishCallables.publishAssignment({
            assignmentId,
            linkId: link.linkId,
            title: lesson.title,
            ...(lmsTopicId !== "" ? { lmsTopicId } : {}),
            attemptNonce,
          }),
        consent: {
          providerId: link.providerId,
          beginConnection: publishCallables.beginConnection,
          completeConnection: publishCallables.completeConnection,
          openOAuth: integrations.openOAuth,
          redirectUri: integrations.redirectUri,
        },
        coordinator: consentCoordinator,
      });
      // Record the retry context so the assignment detail view can offer a
      // teacher-initiated retry for a publication that did not succeed.
      // The latest state is recorded on every outcome, including success
      // (which suppresses the retry affordance).
      recordLmsPublicationRetryContext(teacherUid, {
        assignmentId,
        linkId: link.linkId,
        providerId: link.providerId,
        title: lesson.title,
        ...(lmsTopicId !== "" ? { lmsTopicId } : {}),
        state: result.kind,
      });
      // Arm or clear the session-local Settings recovery signal from an
      // observed connection-not-usable outcome (Sprint 26 Phase 4,
      // definition §7.F). Only `reconnectRequired` arms it; identity
      // mismatch never does (its recovery is same-account retry, not a
      // Settings reconnect, §7.E). Any usable outcome clears a prior signal.
      if (result.kind === "reconnectRequired") {
        recordConnectionReconnectNeeded(teacherUid, link.providerId);
      } else {
        clearConnectionReconnectNeeded(teacherUid, link.providerId);
      }
      return {
        classId: row.classId,
        assignmentId,
        lyfelabzState: "published",
        lmsRequested: true,
        lmsState: result.kind,
      };
    }),
  );

  const publishedIds = outcomes
    .filter((o) => o.lyfelabzState === "published")
    .map((o) => o.assignmentId);
  // The Assigned badge is authoritative iff at least one class reached
  // `published`. On a total-failure lifecycle we drop any optimistic
  // Assigned state so the card cannot false-succeed. On any partial or
  // full success we mark the slug persisted; subsequent refresh calls
  // will read isAssigned() and flip the card to "✓ Assigned".
  if (publishedIds.length > 0) {
    markPersisted(teacherUid, lesson.slug);
  } else {
    unmarkPersisted(teacherUid, lesson.slug);
  }
  onConfirm(summarizeOutcomes(lesson, outcomes));
  onLifecycleComplete?.(publishedIds);
}

function summarizeOutcomes(
  lesson: SurfaceableLesson,
  outcomes: readonly PerClassOutcome[],
): string {
  const total = outcomes.length;
  // Sprint 26 Phase 3 (Defect 2.A). Count the three LyfeLabz lifecycle
  // states independently so the aggregate summary is truthful: a class
  // whose draft was saved but not published is never reported as "not
  // created", and a class that genuinely saved nothing is never reported
  // as recoverable.
  const published = outcomes.filter(
    (o) => o.lyfelabzState === "published",
  ).length;
  const savedNotPublished = outcomes.filter(
    (o) => o.lyfelabzState === "savedNotPublished",
  ).length;
  const draftFailed = outcomes.filter(
    (o) => o.lyfelabzState === "draftFailed",
  ).length;
  const lmsRequested = outcomes.filter((o) => o.lmsRequested).length;
  const lmsSucceeded = outcomes.filter((o) => o.lmsState === "succeeded").length;
  const lmsReconnect = outcomes.filter(
    (o) => o.lmsState === "reconnectRequired",
  ).length;
  const lmsPermission = outcomes.filter(
    (o) => o.lmsState === "permissionNotGranted",
  ).length;
  const lmsIdentityMismatch = outcomes.filter(
    (o) => o.lmsState === "identityMismatch",
  ).length;
  const lmsFailed = lmsRequested - lmsSucceeded;

  // Phrase the "saved but not published" clause once so the singular and
  // plural forms stay consistent wherever it appears.
  const savedClause = (n: number): string =>
    n === 1
      ? "1 was saved but not published"
      : `${n} were saved but not published`;
  const notSavedClause = (n: number): string =>
    n === 1 ? "1 could not be saved" : `${n} could not be saved`;

  // Base LyfeLabz-scoped line. Independent per-class outcomes are reported
  // alongside the aggregate count so one class's failure never silently
  // erases another class's success, and a saved-but-not-published class is
  // never described as though nothing was saved.
  let base: string;
  if (published === total && total === 1) {
    base = `Assigned ${lesson.title} to 1 class.`;
  } else if (published === total) {
    base = `Assigned ${lesson.title} to ${published} classes.`;
  } else if (published > 0) {
    // Partial success: at least one class published, at least one did not.
    const remainder: string[] = [];
    if (savedNotPublished > 0) remainder.push(savedClause(savedNotPublished));
    if (draftFailed > 0) remainder.push(notSavedClause(draftFailed));
    base = `Assigned ${lesson.title} to ${published} of ${total} classes. Of the rest, ${remainder.join(" and ")}. You can try again from any assignment that was saved.`;
  } else if (savedNotPublished > 0 && draftFailed === 0) {
    // Nothing published, but every class saved a durable draft. The work
    // was not lost - this must never say the assignment was not created.
    base =
      total === 1
        ? `${lesson.title} was saved, but publishing did not complete. You can try again from the assignment.`
        : `${lesson.title} was saved for ${savedNotPublished} classes, but publishing did not complete. You can try again from those assignments.`;
  } else if (savedNotPublished === 0) {
    // Nothing saved at all: draft creation failed for every class.
    base =
      total === 1
        ? `${lesson.title} could not be saved. Please try assigning it again.`
        : `${lesson.title} could not be saved for ${total} classes. Please try assigning it again.`;
  } else {
    // Mixed non-success: some classes saved a durable draft, others saved
    // nothing. None published.
    base = `${lesson.title}: ${savedClause(savedNotPublished)}, and ${notSavedClause(draftFailed)}. You can try again from any assignment that was saved.`;
  }

  if (lmsRequested === 0) return base;
  // No class reached `published`, so no Google Classroom publication was
  // attempted. The base line already carries the truthful LyfeLabz outcome.
  if (published === 0) return base;

  // LMS-side outcome line follows the "return, do not redirect" and
  // "authoritative LyfeLabz record" rules of §7. It never blames the
  // teacher and never implies the LyfeLabz assignment was rolled back.
  // The line is calm and provider-neutral: no error code, no OAuth term,
  // no callable name, no Google identity (blueprint §10).
  let lmsLine: string;
  if (lmsFailed === 0) {
    lmsLine = "Publishing to Google Classroom succeeded.";
  } else if (lmsSucceeded === 0 && lmsFailed === lmsReconnect) {
    // Every requested publication was blocked by an inactive connection.
    lmsLine =
      "Google Classroom needs to be reconnected in Settings. Your assignment was scheduled.";
  } else if (lmsSucceeded === 0 && lmsFailed === lmsIdentityMismatch) {
    // Every requested publication authorized with a different Google account
    // than the one on the durable connection (Sprint 26 Phase 4, §7.E). The
    // same-account recovery line, distinct from a generic permission failure.
    // No OAuth term, no account identifier, no implication the connection was
    // replaced - the existing connection is intact and the teacher can retry.
    lmsLine =
      "Publishing to Google Classroom needs the same Google account you first connected. You can try again from the assignment.";
  } else if (lmsSucceeded === 0 && lmsFailed === lmsPermission) {
    // Every requested publication needs the coursework permission the
    // teacher has not granted; the calm consent-needed line, no OAuth term.
    lmsLine =
      "Publishing to Google Classroom needs your permission. You can try again from the assignment.";
  } else if (lmsSucceeded === 0) {
    lmsLine = "Publishing to Google Classroom did not succeed.";
  } else {
    lmsLine = `Publishing to Google Classroom succeeded for ${lmsSucceeded} class${lmsSucceeded === 1 ? "" : "es"} and did not succeed for ${lmsFailed}.`;
  }
  return `${base} ${lmsLine}`;
}

// -----------------------------------------------------------------------------
// Class-cache invalidation
// -----------------------------------------------------------------------------

// Production cache invalidation. Sprint 25 certification (scenario B2)
// exposed a pre-existing defect: the module-scoped teacher class cache
// (`cachedClasses`) is warmed on Curriculum mount and keyed only by uid.
// Because the SPA re-renders in place instead of reloading this module,
// that cache survives two boundaries it should not:
//   1. A same-session class mutation (create / import / activate)
//      performed on the Classes surface. The Classes page reads classes
//      fresh, but the Assign dialog keeps serving the pre-mutation list,
//      so a newly created class is invisible in Assign until reload.
//   2. A same-uid sign-out/sign-in (auth-session replacement). The uid
//      key matches across the teardown, so the incoming session reuses
//      the outgoing session's rows.
//
// This function narrowly drops the class-scoped caches (the class list
// and the LMS class-link cache, plus any in-flight fetch) so the next
// Assign open re-fetches from the injected reader. It deliberately does
// NOT touch session preferences, filters, the assignment registries, or
// the persisted-slug badges: those are not class data, and dropping them
// would silently change unrelated behavior. Per-link LMS topics are left
// intact because they are LMS-owned per linkId and are re-fetched lazily
// for any newly appearing link; a class mutation does not invalidate the
// topics of an existing link.
export function invalidateCurriculumClassCache(): void {
  cachedClasses = null;
  classesInFlight = null;
  cachedClassLinks = null;
  classLinksInFlight = null;
}

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

// Test-only reset. Clears the module-scoped session state so unit tests
// can exercise a clean surface. Not called by production code.
// Test-only handle onto the success-confirmation renderer so the
// self-dismiss timer replacement (optimistic vs final message) can be
// exercised deterministically with fake timers.
export function _showSuccessForTest(banner: HTMLElement, summary: string): void {
  showSuccess(banner, summary);
}

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
  sessionPersistedSlugs = null;
  sessionFilters = null;
  _resetLmsPublicationStateForTest();
}
