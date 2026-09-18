import type { Session } from "../../session/types";
import {
  readStoredCurriculumFilters,
  writeStoredCurriculumFilters,
  clearAllStoredCurriculumFilters,
} from "../../curriculumFilters/storage";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type {
  AssignmentsCallables,
  AssignmentsLifecycleState,
  AssignmentCandidate,
  ClassroomGradingInput,
  CurrentAssignmentResolution,
  IntegrationsClassLink,
  IntegrationsDeps,
  IntegrationsLmsTopic,
} from "../../settings/integrations/types";
import {
  getSurfaceableLessons,
  getFormalResourcesForLesson,
  FORMAL_RESOURCE_LABEL,
  TOPIC_LABEL,
  type CurriculumResource,
  type FormalResourceType,
  type LessonGrade,
  type LessonTopic,
  type SurfaceableLesson,
} from "../../curriculum/curriculumManifest";
import type {
  AssignmentDetailMetadata,
  AssignmentDetailStudentSelection,
  AssignmentStatus,
} from "../../assignments/detail/types";
import type {
  AssignmentSummaryCallable,
  LessonSummaryCallable,
} from "../../assignments/summary/types";
import { renderLessonSummarySurface } from "./lessonSummary";
import { buildLessonBasePath } from "../../assignments/studentList/launch";
import { mintAssignmentId } from "./shared/assignmentId";
import { formatLocalDate, formatLocalTime } from "./shared/activeAssignments";
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
// Sprint 28.6C: optional entry-context for opening Assignment Detail. When
// omitted (the Curriculum -> Active Assignments path), the opener uses its
// certified behavior: the Back control reads "Back to Curriculum" and returns
// through the lighter Curriculum re-mount path. The Classes -> Class ->
// Assignments path supplies both fields so the teacher returns to the same
// class-centered context and the Back control names it. Direct/deep-link
// Detail behavior is unaffected because neither field is required.
export type AssignmentDetailOpenOptions = {
  readonly onBack?: () => void;
  readonly backLabel?: string;
};

export type CurriculumAssignmentDetailSeam = {
  readonly register: (metadata: AssignmentDetailMetadata) => void;
  readonly open: (
    assignmentId: string,
    options?: AssignmentDetailOpenOptions,
  ) => void;
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
  // Student Progress & Assignment Membership Phase A, Slice 3: the shell
  // registers a bounded controller here (mirroring `setOutletController`)
  // so the entry-point Assignment Detail opener can hand a student
  // selection made inside Assignment Detail's roster back to the shell,
  // which records it as a one-shot intent and navigates to Classes. When
  // absent-or-unset (a shell built without this seam, or a harness that
  // does not exercise student navigation), a click on a roster name is
  // simply inert. See TeacherShellStudentSelectionController.
  readonly setStudentSelectionController?: (
    controller: TeacherShellStudentSelectionController | null,
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

// Student Progress & Assignment Membership Phase A, Slice 3:
// `AssignmentDetailStudentSelection` is defined in
// `../../assignments/detail/types` (imported above) since the Assignment
// Detail surface itself also depends on it; re-exported here so existing
// consumers of this module's seam types keep one import source.
export type { AssignmentDetailStudentSelection };

// The bounded seam the Teacher Workspace shell registers so the entry-point
// Assignment Detail opener can hand off a student selection. Mirrors
// `TeacherShellOutletController`'s "single bounded call" shape: not a
// router, not a history stack, just "record this intent and navigate to
// Classes" - the shell owns exactly how that happens.
export type TeacherShellStudentSelectionController = {
  readonly selectStudent: (selection: AssignmentDetailStudentSelection) => void;
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
  // (ASSIGN_EXPERIENCE.md §5 preserves the non-LMS shape). When present,
  // LMS-linked class rows carry the Google Classroom topic selector
  // described in §5's "LMS-linked class row shape" subsection. Sprint
  // 30A.1's second human-review correction removed the separate "Also
  // publish to Google Classroom" opt-in: selecting an LMS-linked class
  // for the Assign action now is the publication decision.
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
  // Sprint 28.6E: certified `assessmentLessonSummary` callable seam. When
  // present, each lesson card with owned published/closed assignment
  // history renders a "View Summary" secondary action that opens the
  // lesson-level (cross-assignment) aggregate summary surface. When
  // absent-or-null no View Summary control is rendered (no dead control);
  // the rest of the card is unchanged. The aggregate-only confidentiality
  // boundary is preserved either way - the surface names no student,
  // attempt, class, or recipient identifier.
  readonly lessonSummary?: LessonSummaryCallable | null;
};

const DEFAULT_LIST_CLASSES: ListClasses = () =>
  Promise.resolve(Object.freeze<ClassSummary[]>([]));

const LESSONS: ReadonlyArray<SurfaceableLesson> = getSurfaceableLessons();

// Sprint 30A.1 UX correction: Points is a teacher-selected Google
// Classroom maximum point value, not a quiz-total-derived value. Ten is
// simply a sensible default shown when the teacher first switches the
// shared grading choice to Graded; it carries no relationship to any
// lesson's quiz question count or scoring.
const DEFAULT_POINTS = 10;

// Sprint 30A.1. A Classroom maximum point value is valid only as a
// positive integer - zero, negative, and fractional values are all
// rejected server-side (assignments.invalidClassroomGrading), so the
// dialog mirrors the same rule client-side to block submission before a
// doomed request is ever sent.
function isValidClassroomMaxPoints(points: number): boolean {
  return Number.isInteger(points) && points > 0;
}

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

// Sprint 30A.1 UX correction (human review): Classroom grading
// configuration (Graded/Ungraded and the Classroom maximum point value) is
// NOT class-specific. It is a single choice for the whole Assign action,
// applied identically to every selected class's assignment. It therefore
// does NOT live on `RowConfig` - a per-class-card state object would let
// classes drift out of sync with each other, which is exactly the mistake
// human review rejected. See `SharedAssignConfig` and its home on
// `Assignment` below.
//
// `RowConfig` retains only what genuinely varies by class: whether the
// class is included in this Assign action, its scheduled release date/
// time, and its Google Classroom topic selection.
//
// Second human-review correction (this pass): the per-class "Also publish
// to Google Classroom" toggle is REMOVED. Selecting an LMS-linked class
// for this Assign action now IS the publication decision - there is no
// second opt-in. See `runAssignmentLifecycle`'s `wantsLms` derivation.
type RowConfig = {
  enabled: boolean;
  date: string;
  time: string;
  topic: string;
  lmsTopicId: string;
};

// Sprint 30A.1 UX correction: the shared, dialog-level Classroom grading
// configuration for one Assign action. Exactly one of these exists per
// open dialog (not one per class row). `points` is remembered even when
// `graded` is false so a teacher who briefly switches to Ungraded and
// back does not lose a previously-entered value - but it is read only
// when `graded` is true; an Ungraded action never reads it.
type SharedAssignConfig = {
  graded: boolean;
  points: number;
};

type Assignment = {
  shared: SharedAssignConfig;
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

type LifecycleStateEntry = {
  readonly state: AssignmentsLifecycleState;
  readonly candidates: ReadonlyArray<AssignmentCandidate>;
  // Historical Assignment Resolution, Implementation Slice 9. Carried
  // through so a later slice can consume it; nothing in this slice reads
  // either field to affect rendering or mutation selection. On the error
  // fallback path (network/parse failure, or no cached entry yet), both
  // default to the conservative "no Current" values, mirroring how `state`
  // already defaults to the conservative `neverAssigned` in that case.
  readonly currentAssignmentId: string | null;
  readonly currentAssignmentResolution: CurrentAssignmentResolution;
  readonly error?: true;
};

const cachedLifecycleState: Map<string, LifecycleStateEntry> = new Map();

function lifecycleCacheKey(classId: string, lessonSlug: string): string {
  return `${classId}::${lessonSlug}`;
}

async function loadLifecycleStateForDialog(
  assignments: AssignmentsCallables,
  classIds: ReadonlyArray<string>,
  lessonSlug: string,
): Promise<Map<string, LifecycleStateEntry>> {
  const result = new Map<string, LifecycleStateEntry>();
  const toFetch: string[] = [];
  for (const classId of classIds) {
    const key = lifecycleCacheKey(classId, lessonSlug);
    const cached = cachedLifecycleState.get(key);
    if (cached) {
      result.set(classId, cached);
    } else {
      toFetch.push(classId);
    }
  }
  if (toFetch.length === 0) return result;
  const settled = await Promise.allSettled(
    toFetch.map(async (classId) => {
      const resp = await assignments.lifecycleState({ classId, lessonSlug });
      const entry: LifecycleStateEntry = {
        state: resp.state,
        candidates: resp.candidates,
        currentAssignmentId: resp.currentAssignmentId,
        currentAssignmentResolution: resp.currentAssignmentResolution,
      };
      cachedLifecycleState.set(lifecycleCacheKey(classId, lessonSlug), entry);
      result.set(classId, entry);
    }),
  );
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === "rejected") {
      result.set(toFetch[i], {
        state: "neverAssigned",
        candidates: [],
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved",
        error: true,
      });
    }
  }
  return result;
}

function invalidateLifecycleCache(lessonSlug?: string): void {
  if (!lessonSlug) {
    cachedLifecycleState.clear();
    return;
  }
  for (const key of cachedLifecycleState.keys()) {
    if (key.endsWith(`::${lessonSlug}`)) {
      cachedLifecycleState.delete(key);
    }
  }
}

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

// Sprint 29G.5P: durable, same-browser persistence for the Curriculum
// grade/topic filter, UID-scoped. This backs the in-memory `sessionFilters`
// so a teacher resumes their last grade and topic after a reload, a browser
// restart, and a sign-out/sign-in on the SAME browser. The actual browser
// storage access lives in the `curriculumFilters/storage` seam (outside the
// shell, per the Step 5 posture invariant); this surface only validates the
// returned values against the current filter enumerations. Persistence is
// same-browser only: no Firestore, no cross-device sync, no backend/rules/
// callable change, and it deliberately does NOT read or write the separate
// class-creation `defaultGrade` preference.

// Read the durable per-uid filter selection. Never trusts arbitrary stored
// content: each field is validated with the same `isValid*Filter` guards used
// for the in-memory value, so a corrupted or stale key can never propagate
// into the UI. Returns null when nothing durable is available so the caller
// can fall back to defaults.
function readStoredFilters(
  uid: string,
): { grade: GradeFilter; topic: TopicFilter } | null {
  const raw = readStoredCurriculumFilters(uid);
  if (raw === null) return null;
  const grade: GradeFilter = isValidGradeFilter(raw.grade) ? raw.grade : "all";
  const topic: TopicFilter = isValidTopicFilter(raw.topic) ? raw.topic : "all";
  return { grade, topic };
}

function writeStoredFilters(
  uid: string,
  grade: GradeFilter,
  topic: TopicFilter,
): void {
  writeStoredCurriculumFilters(uid, grade, topic);
}

// Test-only full-reset drops the durable buckets too; production sign-out
// never calls this, so real cross-sign-in persistence is preserved.
function clearStoredFilters(): void {
  clearAllStoredCurriculumFilters();
}

function readSessionFilters(uid: string): {
  grade: GradeFilter;
  topic: TopicFilter;
} {
  // Prefer the live in-session selection when it belongs to this uid.
  if (sessionFilters !== null && sessionFilters.uid === uid) {
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
  // No live selection for this uid (fresh page load / after sign-in / a
  // different uid): restore from the durable, uid-scoped store if present.
  const stored = readStoredFilters(uid);
  if (stored !== null) return stored;
  return { grade: "all", topic: "all" };
}

function writeSessionFilters(
  uid: string,
  grade: GradeFilter,
  topic: TopicFilter,
): void {
  sessionFilters = { uid, grade, topic };
  writeStoredFilters(uid, grade, topic);
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
  const lessonSummary = deps.lessonSummary ?? null;
  const doc = mount.ownerDocument;

  // Sprint 28.6E: the Curriculum lesson grid and the lesson-level View
  // Summary surface share the Curriculum outlet. All lesson-grid content
  // is appended to `curriculumView`; opening View Summary hides it and
  // mounts the summary surface into `summaryHost`, so the Teacher
  // Workspace shell (header, navigation, footer) stays mounted and
  // Curriculum remains the active global navigation context. Back removes
  // the summary surface and restores the grid.
  const curriculumView = doc.createElement("div");
  curriculumView.className = "shell-curriculum-view";
  curriculumView.setAttribute("data-testid", "curriculum-view");
  mount.appendChild(curriculumView);

  const summaryHost = doc.createElement("div");
  summaryHost.className = "shell-curriculum-summary-host";
  summaryHost.setAttribute("data-testid", "curriculum-summary-host");
  mount.appendChild(summaryHost);

  const openLessonSummary = (lesson: SurfaceableLesson): void => {
    if (lessonSummary === null) return;
    curriculumView.hidden = true;
    renderLessonSummarySurface(summaryHost, {
      doc,
      lessonTitle: lesson.title,
      lessonSlug: lesson.slug,
      lessonSummary,
      onBack: () => {
        summaryHost.textContent = "";
        curriculumView.hidden = false;
        // Return focus to the card's View Summary control so the return
        // trip is keyboard-coherent.
        const trigger = curriculumView.querySelector<HTMLButtonElement>(
          `[data-testid=lesson-view-summary-${lesson.slug}]`,
        );
        if (trigger) {
          try {
            trigger.focus({ preventScroll: true });
          } catch {
            // ignored
          }
        }
      },
    });
  };

  // Sprint 13C, retained through Sprint 28.6D: rediscover the quiet
  // "✓ Assigned" assignment-history signal from the certified
  // retrieval-hydrated registry so a full page reload keeps the card's
  // history affordance. The card remains fully re-assignable regardless
  // of history (Blueprint §6); this only drives the presentation-time
  // badge, it never disables Assign. Only teacher-owned metadata is read.
  //
  // Sprint 26 Phase 3 (Defect 2.B): mark the badge only for a hydrated
  // assignment whose status qualifies as successfully assigned
  // (`published`/`closed`). The certified enumeration path opts into
  // draft discovery, so the registry can carry stranded `draft` entries;
  // marking those would let a draft-only lesson falsely read "Assigned"
  // after a reload. A draft still hydrates for the class-centered
  // Assignment Detail surface; it simply does not drive the badge.
  if (assignmentDetail !== null && typeof assignmentDetail.list === "function") {
    try {
      for (const entry of assignmentDetail.list()) {
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
      // rendering; the surface reverts to the session-only badge behavior.
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
  curriculumView.appendChild(welcome);
  try {
    welcome.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  // Sprint 28.6D: the Active Assignments dashboard is removed from
  // Curriculum. Operational assignment management now lives under
  // Classes -> Class -> Assignments -> Assignment Detail (certified in
  // 28.6C). Curriculum is lesson-centric only (Blueprint §6); it no
  // longer renders assignment rows, so no `renderActiveAssignmentsSection`
  // mount and no per-assignment invalidator are installed here. The
  // shared renderer continues to serve the Classes Assignments section.

  // Sprint 28.6H.4 (Part C): the subtitle ("Activate the LyfeLabz lessons your
  // students can access.") is removed and NOT replaced - Curriculum is already
  // self-explanatory, and reclaiming its vertical space lets more lesson cards
  // reach the visible desktop viewport. The welcome heading flows directly into
  // the grade / topic filters.

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
  curriculumView.appendChild(controls);

  const grid = doc.createElement("div");
  grid.className = "shell-curriculum-grid";
  grid.setAttribute("data-testid", "curriculum-grid");
  grid.setAttribute("role", "list");
  curriculumView.appendChild(grid);

  const emptyNotice = doc.createElement("p");
  emptyNotice.className = "shell-curriculum-empty";
  emptyNotice.setAttribute("data-testid", "curriculum-empty");
  emptyNotice.hidden = true;
  emptyNotice.textContent =
    "No lessons match the current filters. Adjust a filter to see more.";
  curriculumView.appendChild(emptyNotice);

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
  curriculumView.appendChild(successBanner);

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
        showSuccess(successBanner, summary);
      },
      onLifecycleComplete: () => {
        // Re-derive the quiet assignment-history badge from the
        // persisted-assignment registry so the card only shows
        // "✓ Assigned" after at least one class successfully published,
        // and reverts to "Assign" when every class failed. The button
        // stays clickable in both states (reassignment is always
        // available). Curriculum no longer renders assignment rows, so
        // no dashboard refresh is needed here (Blueprint §6).
        refreshAssignControl(card, lesson);
      },
    });
  };

  for (const lesson of LESSONS) {
    grid.appendChild(
      renderLessonCard(doc, lesson, state.activation, openAssignDialog, {
        showViewSummary: lessonSummary !== null,
        onViewSummary: openLessonSummary,
      }),
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
  curriculumView.appendChild(returnLink);
}

function applyAssignState(
  btn: HTMLButtonElement,
  lesson: SurfaceableLesson,
  assigned: boolean,
): void {
  btn.textContent = assigned ? "Update Assignment" : "Assign";
  btn.setAttribute(
    "aria-label",
    assigned
      ? `Update assignment for ${lesson.title}`
      : `Assign ${lesson.title}`,
  );
  btn.classList.toggle("shell-lesson-assigned-action", assigned);
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
  // Sprint 28.6H.7 (Part B): a previously assigned lesson reads "Assign Again"
  // in muted green; an unused lesson keeps full-strength green "Assign". Assign
  // is always available and always re-assignable - the change is presentation
  // only, kept in step with the assignment-history signal after a first
  // in-session assignment.
  applyAssignState(btn, lesson, assigned);
  card.setAttribute("data-lesson-assigned", assigned ? "true" : "false");
  // Sprint 28.6H.6 (Part C): keep the supplemental cool-slate assigned tint in
  // step with the assignment-history signal after a first in-session assignment.
  card.classList.toggle("shell-lesson-card-assigned", assigned);

  // Sprint 28.6E/H: reveal (or hide) the View Summary control in step with the
  // assignment-history signal. A first successful in-session assignment makes
  // lesson-level analytics meaningful; deselecting every class returns the card
  // to a never-assigned state and hides it again. View Summary remains
  // conditional on assignment history even though Assign no longer shows it.
  const summaryBtn = card.querySelector<HTMLButtonElement>(
    `[data-testid=lesson-view-summary-${lesson.slug}]`,
  );
  if (summaryBtn) summaryBtn.hidden = !assigned;
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

// Sprint 28.6E: per-card View Summary options. `showViewSummary` reflects
// whether the certified lesson-summary callable is wired (no dead control
// when it is not); `onViewSummary` opens the lesson-level summary surface.
type ViewSummaryOptions = {
  readonly showViewSummary: boolean;
  readonly onViewSummary: (lesson: SurfaceableLesson) => void;
};

function renderLessonCard(
  doc: Document,
  lesson: SurfaceableLesson,
  activation: Map<string, boolean>,
  onAssign: (lesson: SurfaceableLesson, card: HTMLElement) => void,
  viewSummary?: ViewSummaryOptions,
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
  // Sprint 28.6D (Task 5): compact grade tag ("G6" rather than "Grade 6")
  // to recover card vertical space. Presentation-only; the manifest grade
  // metadata is unchanged. The science-domain label is retained alongside.
  gradePill.textContent = `G${lesson.grade}`;
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

  // Sprint 28.6H.2 (Finding 2 / Tasks 8-10): Assign and Preview live in their
  // OWN dedicated paired row - a container that holds exactly these two
  // controls and nothing else. Their equal width/height is computed only from
  // this pair, so a conditional third control (View Summary) can never enter
  // the same sizing row and shrink them. The prior implementation appended all
  // three controls to `.shell-lesson-actions` and relied on `flex-basis:100%`
  // to wrap View Summary onto its own line; because Assign/Preview use
  // `flex-basis:0`, all three fit on one line (0 + 0 + 100% = 100%), so View
  // Summary sat in the same row and crushed Assign/Preview. A separate pair
  // container removes that failure mode structurally.
  const actionPair = doc.createElement("div");
  actionPair.className = "shell-lesson-action-pair";
  actionPair.setAttribute("data-testid", `lesson-action-pair-${lesson.slug}`);

  // Sprint 28.6H (Finding 7/8): Assign and Preview are a paired primary /
  // secondary action set. Assign is always available and always reads "Assign"
  // - the "✓ Assigned" history badge is removed (Finding 8), so a previously
  // assigned lesson can still be assigned again with no visual change. The
  // assignment-history signal is kept on the card dataset only to drive the
  // conditional View Summary control.
  const assign = doc.createElement("button");
  assign.type = "button";
  assign.className = "shell-lesson-assign";
  assign.setAttribute("data-testid", `lesson-assign-${lesson.slug}`);
  const assigned = isAssigned(lesson.slug);
  // Sprint 28.6H.6/H.7 (Part B/C): a lesson that has been assigned at least once
  // (the existing session assignment-history signal - no new persistence /
  // backend) receives BOTH a subtle cool-slate card tint AND a muted-green
  // "Assign Again" action, so the teacher can scan which lessons have been used
  // while unused lessons come forward with a full-strength green "Assign". The
  // action is unchanged in behavior (same assignment workflow, always enabled,
  // always re-assignable); "Assign Again" reads as an action, never a disabled
  // status.
  applyAssignState(assign, lesson, assigned);
  card.setAttribute("data-lesson-assigned", assigned ? "true" : "false");
  card.classList.toggle("shell-lesson-card-assigned", assigned);
  assign.addEventListener("click", () => {
    onAssign(lesson, card);
  });
  actionPair.appendChild(assign);

  // Sprint 28.6D (Task 7): teacher-safe Preview. Opens the current v2
  // lesson artifact (override-aware `buildLessonBasePath`) with NO
  // `?assignment` query, in a new tab. The standalone/inert v2 runtime
  // returns before any Firebase init, so Preview cannot create a session,
  // attempt, or result, needs no fake student, and never touches
  // assignment or Classroom state (Blueprint §7). A quieter, neutral
  // action than Assign. Rendered as a real link so it is keyboard
  // reachable and its destination is a genuine navigation.
  const previewPath = buildLessonBasePath(lesson.slug);
  if (previewPath !== null) {
    const preview = doc.createElement("a");
    preview.className = "shell-lesson-preview";
    preview.setAttribute("data-testid", `lesson-preview-${lesson.slug}`);
    preview.href = previewPath;
    preview.target = "_blank";
    preview.rel = "noopener";
    preview.textContent = "Preview";
    preview.setAttribute(
      "aria-label",
      `Preview ${lesson.title} (opens in a new tab)`,
    );
    actionPair.appendChild(preview);
  }

  // The paired row is appended as a single unit. Assign and Preview are its
  // only members; View Summary (below) is a sibling of this pair, never a
  // child, so it is outside the pair's width calculation.
  actions.appendChild(actionPair);

  card.appendChild(actions);

  // Sprint 28.6H.3 (Task D3/D4/D5): View Summary and Resources are both quiet
  // secondary lesson-inspection actions, so they share ONE quiet footer instead
  // of stacking as competing controls. The footer row places View Summary on
  // the left and the `N Resource ›` disclosure on the right; the expanded
  // Resources panel renders full-width beneath the row. The footer is omitted
  // entirely when there is nothing to show, and its hairline boundary is
  // suppressed by CSS (`:has`) when the only member is a hidden (never-assigned)
  // View Summary, so a card never carries an empty footer.
  const footerRow = doc.createElement("div");
  footerRow.className = "shell-lesson-footer-row";

  // View Summary (left). An analytical secondary action (gold-accented,
  // quieter than Assign). Rendered only when the lesson-summary callable is
  // wired; visible only for a lesson with owned published/closed assignment
  // history (the same authoritative signal that lights the assigned badge),
  // hidden otherwise so there is no dead control. Visibility is refreshed by
  // `refreshAssignControl` so a first in-session assignment reveals it without
  // a reload. Opens the lesson-level aggregate summary; it never lists a
  // specific assignment (that is Classes).
  let hasViewSummary = false;
  if (viewSummary?.showViewSummary === true) {
    const summaryBtn = doc.createElement("button");
    summaryBtn.type = "button";
    summaryBtn.className = "shell-lesson-view-summary";
    summaryBtn.setAttribute(
      "data-testid",
      `lesson-view-summary-${lesson.slug}`,
    );
    summaryBtn.textContent = "View Summary";
    summaryBtn.setAttribute(
      "aria-label",
      `View lesson summary for ${lesson.title}`,
    );
    summaryBtn.hidden = !isAssigned(lesson.slug);
    summaryBtn.addEventListener("click", () => {
      viewSummary.onViewSummary(lesson);
    });
    footerRow.appendChild(summaryBtn);
    hasViewSummary = true;
  }

  // Resources (right). Formal Resources disclosure from the canonical manifest
  // (simulations, investigations, extensions, challenges; legacy games
  // excluded). A lesson with no formal resources shows no Resources control.
  const resources = renderLessonResources(doc, lesson);
  if (resources !== null) footerRow.appendChild(resources.toggle);

  if (hasViewSummary || resources !== null) {
    const footer = doc.createElement("div");
    footer.className = "shell-lesson-footer";
    footer.setAttribute("data-testid", `lesson-footer-${lesson.slug}`);
    footer.appendChild(footerRow);
    if (resources !== null) footer.appendChild(resources.panel);
    card.appendChild(footer);
  }

  return card;
}

// Sprint 28.6D (Task 8). Formal Resources disclosure for one lesson
// card. Returns null when the lesson has no formal resources (the card
// then omits the control rather than showing an empty disclosure). The
// control is a native `<button>` with `aria-expanded`/`aria-controls`
// toggling an inline panel, so it is keyboard operable and its
// expanded/collapsed state is exposed to assistive tech. Each resource
// renders its human-readable type, its title, and an Open link to the
// canonical public instructional page in a new tab. Resources are
// Open/Preview only in v1 - never independently assignable (Blueprint
// §9).
// Sprint 28.6D.1 (Task 2). Collapsed Resources disclosure label with
// correct singular/plural grammar. Exported as a pure helper so the
// plural path stays directly testable: the surfaced manifest currently
// carries at most one formal resource per lesson, so the "N Resources"
// branch cannot be reached through the real surface, yet the grammar
// must remain correct if a lesson later gains multiple resources.
export function formatResourceCountLabel(count: number): string {
  return count === 1 ? "1 Resource" : `${count} Resources`;
}

// Sprint 28.6H.3 (Task D3): returns the disclosure TOGGLE and its PANEL as
// separate nodes so the caller can place the quiet `N Resource ›` toggle into
// the shared card footer (alongside View Summary) while the expanded panel
// renders full-width beneath that footer row. Returns null when the lesson has
// no formal resources (no disclosure at all). The disclosure behavior, count
// grammar, caret, `aria-expanded`/`aria-controls`, and Open-in-new-tab
// semantics are unchanged from 28.6D.1.
function renderLessonResources(
  doc: Document,
  lesson: SurfaceableLesson,
): { readonly toggle: HTMLElement; readonly panel: HTMLElement } | null {
  const resources = getFormalResourcesForLesson(lesson.slug);
  if (resources.length === 0) return null;

  const panelId = `lesson-resources-panel-${lesson.slug}`;

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "shell-lesson-resources-toggle";
  toggle.setAttribute("data-testid", `lesson-resources-toggle-${lesson.slug}`);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  toggle.setAttribute(
    "aria-label",
    `Resources for ${lesson.title}, ${resources.length} available`,
  );
  const count = resources.length;
  const countLabel = doc.createElement("span");
  countLabel.className = "shell-lesson-resources-count";
  countLabel.textContent = formatResourceCountLabel(count);
  toggle.appendChild(countLabel);

  const panel = doc.createElement("div");
  panel.className = "shell-lesson-resources-panel";
  panel.id = panelId;
  panel.setAttribute("data-testid", `lesson-resources-${lesson.slug}`);
  panel.hidden = true;
  const list = doc.createElement("ul");
  list.className = "shell-lesson-resources-list";
  list.setAttribute("role", "list");
  panel.appendChild(list);

  resources.forEach((resource, index) => {
    list.appendChild(renderResourceItem(doc, lesson, resource, index));
  });

  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", open ? "false" : "true");
    panel.hidden = open;
  });

  return { toggle, panel };
}

function renderResourceItem(
  doc: Document,
  lesson: SurfaceableLesson,
  resource: CurriculumResource,
  index: number,
): HTMLElement {
  const item = doc.createElement("li");
  item.className = "shell-lesson-resource";
  item.setAttribute("role", "listitem");

  const typeLabel =
    FORMAL_RESOURCE_LABEL[resource.type as FormalResourceType] ?? "Resource";

  // Sprint 28.6D.1 (Task 4): supporting-material row, not a nested lesson
  // card. The type is a small muted eyebrow above the resource title; the
  // title is the primary content of the row; a single quiet "Open" link
  // remains the secondary action. The Open link keeps its discernible
  // accessible name (type + title + new-tab), so the resource identity is
  // fully represented in text even though the visible link word is "Open".
  const main = doc.createElement("div");
  main.className = "shell-lesson-resource-main";

  const type = doc.createElement("span");
  type.className = "shell-lesson-resource-type";
  type.setAttribute(
    "data-testid",
    `lesson-resource-type-${lesson.slug}-${index}`,
  );
  type.textContent = typeLabel;
  main.appendChild(type);

  const title = doc.createElement("span");
  title.className = "shell-lesson-resource-title";
  title.setAttribute(
    "data-testid",
    `lesson-resource-title-${lesson.slug}-${index}`,
  );
  title.textContent = resource.label;
  main.appendChild(title);

  item.appendChild(main);

  const open = doc.createElement("a");
  open.className = "shell-lesson-resource-open";
  open.setAttribute(
    "data-testid",
    `lesson-resource-open-${lesson.slug}-${index}`,
  );
  open.href = resource.href;
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = "Open";
  open.setAttribute(
    "aria-label",
    `Open ${typeLabel.toLowerCase()}: ${resource.label} (opens in a new tab)`,
  );
  item.appendChild(open);

  return item;
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

  // Sprint 30A.1 FINAL UI POLISH (human review): a compact confirmation of
  // how many classes the Assign action will actually affect, updated live
  // as checkboxes change. Text is set once `rowState` exists, in
  // `updateConfirmState` below; appended first so it sits at the opposite
  // end of the footer from Cancel/Assign (`.shell-assign-footer` pushes it
  // there with `margin-right: auto`, not DOM reordering).
  const selectedCount = doc.createElement("span");
  selectedCount.className = "shell-assign-selected-count";
  selectedCount.setAttribute("data-testid", "assign-selected-count");
  footer.appendChild(selectedCount);

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

  const classes = (cachedClasses?.rows ?? []).filter(
    (c): c is Extract<ClassSummary, { status: "active" }> =>
      c.status === "active",
  );

  let lifecycleByClass: Map<string, LifecycleStateEntry> = new Map();
  if (assignments !== null && classes.length > 0) {
    loading.textContent = "Checking assignment status";
    try {
      lifecycleByClass = await loadLifecycleStateForDialog(
        assignments,
        classes.map((c) => c.id),
        lesson.slug,
      );
    } catch {
      // Outer catch: loadLifecycleStateForDialog uses allSettled internally,
      // so per-class failures are already marked with error: true in the
      // result map. This catch guards only against unexpected structural
      // failures; individual class rows render their own error state.
    }
  }
  if (!overlay.isConnected) return;
  body.removeChild(loading);

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

  // Second human-review correction: publication is no longer a separate
  // per-class opt-in (there is no `publishToLms` field to force-reset
  // anymore) - every remembered row field rehydrates as-is.
  const existing = sessionAssignments.get(lesson.slug);
  const rowState: Map<string, RowConfig> = new Map();
  for (const c of classes) {
    const prior = existing?.rows.get(c.id);
    rowState.set(
      c.id,
      prior ??
        // Sprint 30A.1 UX correction: every eligible class is selected
        // by default (`enabled: true`), matching the common "assign to
        // all of my classes" workflow. The teacher may deselect any
        // class below.
        {
          enabled: true,
          date: todayIsoDate(doc),
          time: sessionPreferences.releaseTime,
          topic: sessionPreferences.topic,
          lmsTopicId: sessionPreferences.lmsTopicId,
        },
    );
  }

  // Sprint 30A.1 UX correction: ONE shared grading configuration for the
  // whole Assign action, rehydrated from the lesson's remembered state (an
  // ordinary remembered preference, not force-reset on reopen) or defaulted
  // to Ungraded for a lesson the teacher has never configured. Mutated in
  // place by the shared-settings controls below and read once, at confirm
  // time, to build the identical `classroomGrading` value sent for every
  // selected class.
  const shared: SharedAssignConfig = existing
    ? { ...existing.shared }
    : { graded: false, points: DEFAULT_POINTS };

  const linksByClassId =
    cachedClassLinks && cachedClassLinks.uid === session.uid
      ? cachedClassLinks.linksByClassId
      : new Map<string, IntegrationsClassLink>();

  const sharedSettings = doc.createElement("div");
  sharedSettings.className = "shell-assign-shared-settings";
  sharedSettings.setAttribute("data-testid", "assign-shared-settings");
  body.appendChild(sharedSettings);

  const sharedHeading = doc.createElement("h4");
  sharedHeading.className = "shell-assign-shared-heading";
  sharedHeading.textContent = "Assignment settings";
  sharedSettings.appendChild(sharedHeading);

  // Sprint 30A.1 FINAL UI POLISH (human review): the original single
  // "Graded in Google Classroom" checkbox read ambiguously (checked/
  // unchecked never clearly stated the OTHER state). Human review
  // required an explicit two-state control instead. A native radio pair
  // is the smallest, most native way to say that - the browser already
  // owns the mutually-exclusive semantics via a shared `name`, so no
  // extra ARIA is needed beyond a `radiogroup` label naming the group's
  // purpose. Exactly one Graded/Ungraded choice and one Points value for
  // the whole Assign action - never per class. Ungraded by default per
  // the locked product default.
  const gradingGroup = doc.createElement("div");
  gradingGroup.className = "shell-assign-grading";
  gradingGroup.setAttribute("role", "radiogroup");
  gradingGroup.setAttribute("aria-label", "Grading");
  sharedSettings.appendChild(gradingGroup);

  const gradingName = "assign-shared-grading";
  const makeGradingOption = (
    value: "ungraded" | "graded",
    optionLabel: string,
    testid: string,
  ): { wrapper: HTMLElement; input: HTMLInputElement } => {
    const wrapper = doc.createElement("label");
    wrapper.className = "shell-assign-grading-option";
    const input = doc.createElement("input");
    input.type = "radio";
    input.name = gradingName;
    input.value = value;
    input.setAttribute("data-testid", testid);
    wrapper.appendChild(input);
    const text = doc.createElement("span");
    text.textContent = optionLabel;
    wrapper.appendChild(text);
    gradingGroup.appendChild(wrapper);
    return { wrapper, input };
  };

  const ungradedOption = makeGradingOption(
    "ungraded",
    "Ungraded",
    "assign-shared-grading-ungraded",
  );
  const gradedOption = makeGradingOption(
    "graded",
    "Graded",
    "assign-shared-grading-graded",
  );
  ungradedOption.input.checked = !shared.graded;
  gradedOption.input.checked = shared.graded;

  const refreshGradingActiveClasses = (): void => {
    ungradedOption.wrapper.classList.toggle(
      "shell-assign-grading-option-active",
      !shared.graded,
    );
    gradedOption.wrapper.classList.toggle(
      "shell-assign-grading-option-active",
      shared.graded,
    );
  };

  const pointsInput = fieldInput(doc, {
    id: "assign-shared-points",
    label: "Points",
    type: "number",
    value: String(shared.points),
    min: 0,
    onInput: (v) => {
      const n = Number(v);
      shared.points = Number.isFinite(n) && n >= 0 ? n : 0;
      refreshSharedPointsValidation();
    },
  });
  pointsInput.input.setAttribute("data-testid", "assign-shared-points");
  sharedSettings.appendChild(pointsInput.wrapper);

  // Sprint 30A.1: an unobtrusive inline validation message, shown only
  // when Graded is checked and Points does not hold a valid Classroom
  // maximum point value (a positive integer).
  const pointsValidationMessage = doc.createElement("span");
  pointsValidationMessage.className = "shell-assign-field-validation";
  pointsValidationMessage.setAttribute(
    "data-testid",
    "assign-shared-points-invalid",
  );
  pointsValidationMessage.setAttribute("role", "alert");
  pointsValidationMessage.textContent =
    "Enter a whole number of points greater than 0.";
  pointsValidationMessage.hidden = true;
  sharedSettings.appendChild(pointsValidationMessage);

  // Points is only "active" Classroom grading configuration when Graded
  // is checked. When Ungraded, Points remains present but inert - it must
  // never be read as a maxPoints value (the confirm handler below never
  // reads `shared.points` unless `shared.graded` is true); the disabled
  // state here is a visual/interaction cue only, not the enforcement
  // boundary.
  const refreshSharedPointsActiveState = (): void => {
    pointsInput.input.disabled = !shared.graded;
    pointsInput.wrapper.classList.toggle(
      "shell-assign-field-inactive",
      !shared.graded,
    );
  };

  const refreshSharedPointsValidation = (): void => {
    const showInvalid =
      shared.graded && !isValidClassroomMaxPoints(shared.points);
    pointsValidationMessage.hidden = !showInvalid;
    if (showInvalid) {
      pointsInput.input.setAttribute("aria-invalid", "true");
    } else {
      pointsInput.input.removeAttribute("aria-invalid");
    }
    updateConfirmState();
  };

  const onGradingChange = (): void => {
    shared.graded = gradedOption.input.checked;
    refreshGradingActiveClasses();
    refreshSharedPointsActiveState();
    refreshSharedPointsValidation();
  };
  ungradedOption.input.addEventListener("change", onGradingChange);
  gradedOption.input.addEventListener("change", onGradingChange);
  refreshGradingActiveClasses();

  // Sprint 30A.1 UX correction: a compact column-header row above the
  // class rows, so Class/Topic/Date/Time read as aligned columns rather
  // than repeating a label inside every row. Purely presentational - it
  // participates in the same grid as the rows (via `display:contents`)
  // but carries no interactive control and no row testid.
  const rowsHeader = doc.createElement("div");
  rowsHeader.className = "shell-assign-rows-header";
  rowsHeader.setAttribute("aria-hidden", "true");
  // Sprint 30A.1 FINAL UI POLISH (human review): the row's leading
  // control column is just the selection checkbox now (the reorder drag
  // handle was removed from Assign entirely - see `renderRow` below), so
  // the header row needs one leading blank cell for that column. "Topic"
  // replaces the former "Google Classroom topic" heading - the column
  // already sits beside "Class" in an Assign dialog the teacher opened
  // for THIS Classroom-integrated workspace, so repeating "Google
  // Classroom" in the heading was redundant per human review. Sprint
  // 28.5D preserved: the Topic column (header included) never appears at
  // all when no class in this dialog could possibly be LMS-linked (no
  // `integrations` seam wired) - matching the per-row condition below
  // that omits the column's cell entirely in that case, keeping the
  // shared grid's columns aligned either way.
  const headerLabels =
    integrations !== null
      ? ["", "Class", "Topic", "Date", "Time"]
      : ["", "Class", "Date", "Time"];
  for (const label of headerLabels) {
    const cell = doc.createElement("span");
    cell.textContent = label;
    rowsHeader.appendChild(cell);
  }

  const rowsHost = doc.createElement("div");
  rowsHost.className = "shell-assign-rows";
  rowsHost.setAttribute("data-testid", "assign-rows");
  rowsHost.appendChild(rowsHeader);
  body.appendChild(rowsHost);

  const updateConfirmState = (): void => {
    let enabledCount = 0;
    for (const r of rowState.values()) if (r.enabled) enabledCount += 1;
    // Sprint 30A.1 UX correction: grading validity is now a single,
    // dialog-level check (`shared`), never a per-row one - a Graded
    // action with an invalid Points value blocks the whole Assign
    // operation, not just one class's row. This is client-side defense
    // in depth; the callable independently rejects the same malformed
    // shape (assignments.invalidClassroomGrading).
    const gradingValid =
      !shared.graded || isValidClassroomMaxPoints(shared.points);
    const canConfirm = enabledCount > 0 && gradingValid;
    confirm.disabled = !canConfirm;
    confirm.setAttribute("aria-disabled", canConfirm ? "false" : "true");
    // Sprint 30A.1 FINAL UI POLISH (human review): a compact, always-
    // current confirmation of how many classes this Assign action will
    // affect, independent of grading validity - 0 selected classes still
    // reads "0 classes selected" even while Assign is disabled for that
    // same reason.
    selectedCount.textContent =
      enabledCount === 1 ? "1 class selected" : `${enabledCount} classes selected`;
  };

  refreshSharedPointsActiveState();
  refreshSharedPointsValidation();

  // Sprint 30A.1 human-review finalization: class reordering now happens
  // ONLY on the Classes workspace (see classes.ts). `classes` already
  // arrives in the teacher's canonical order (computed once, upstream, by
  // `createOrderedListClasses` at the entry point - see
  // app/src/classes/classOrder.ts); Assign simply renders that order as
  // received and applies no secondary sort of its own.
  const rowLifecycleState: Map<string, LifecycleStateEntry> = new Map();
  for (const c of classes) {
    const link = linksByClassId.get(c.id) ?? null;
    const lc: LifecycleStateEntry = lifecycleByClass.get(c.id) ?? {
      state: "neverAssigned" as const,
      candidates: [],
      currentAssignmentId: null,
      currentAssignmentResolution: "unresolved" as const,
    };
    rowLifecycleState.set(c.id, lc);
    const retryCtx = assignments
      ? {
          assignments,
          lessonSlug: lesson.slug,
          lessonTitle: lesson.title,
          rowLifecycleState,
          rowsHost,
          onConfirm,
        }
      : undefined;
    const row = renderRow(
      doc,
      c,
      rowState,
      updateConfirmState,
      link,
      integrations,
      lc,
      retryCtx,
    );
    rowsHost.appendChild(row);
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
    // Sprint 30A.1 UX correction: defense in depth mirroring the
    // `updateConfirmState` gate above - a Graded action with an invalid
    // Points value never proceeds, even if this handler is somehow
    // reached with a stale disabled state. No class assignment request
    // is made (Scenario D).
    if (shared.graded && !isValidClassroomMaxPoints(shared.points)) return;
    submissionInFlight = true;
    confirm.disabled = true;
    confirm.setAttribute("aria-busy", "true");

    // Persist row state so revisit-in-place works when the dialog is
    // reopened. This is the "temporary in-dialog form state" the sprint
    // authorizes retaining in session memory; the authoritative record
    // is the persistent LyfeLabz assignment produced below.
    const stored: Assignment = { shared: { ...shared }, rows: new Map() };
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

    if (assignments === null) {
      markPersisted(session.uid, lesson.slug);
      close();
      const summary =
        enabledCount === 1
          ? `Assigned ${lesson.title} to 1 class.`
          : `Assigned ${lesson.title} to ${enabledCount} classes.`;
      onConfirm(summary);
      return;
    }

    type EnabledRowWithLifecycle = EnabledRow & {
      readonly lcState: AssignmentsLifecycleState;
      readonly candidates: ReadonlyArray<AssignmentCandidate>;
    };
    const creationRows: EnabledRowWithLifecycle[] = [];
    const updateRows: EnabledRowWithLifecycle[] = [];
    // Historical Assignment Resolution, Implementation Slice 10. A row can
    // reach this loop as `enabled` only if `renderRow` left its checkbox
    // enabled - and `renderRow` now force-disables the checkbox for every
    // `onePublishedMissingRecipients`/`multiplePublished` row whose Current
    // is not `valid`, and for any row (other than `neverAssigned`) whose
    // Current is `invalid`. There is therefore no longer a
    // "multiplePublished enabled but nothing selected" state to validate
    // against here - the old radio-selection requirement and its
    // validation-message branch are removed entirely, not merely bypassed.
    for (const r of enabledRows) {
      const lc = rowLifecycleState.get(r.classId);
      if (lc?.error) continue;
      const state = lc?.state ?? "neverAssigned";
      const enriched: EnabledRowWithLifecycle = {
        ...r,
        lcState: state,
        candidates: lc?.candidates ?? [],
      };
      if (
        state === "onePublishedFullyCurrent" ||
        ((state === "onePublishedMissingRecipients" ||
          state === "multiplePublished") &&
          lc?.currentAssignmentResolution === "valid")
      ) {
        updateRows.push(enriched);
      } else if (state === "neverAssigned" || state === "historicalOnly") {
        creationRows.push(enriched);
      }
      // Any other combination reaching this point (e.g. a stale `enabled`
      // flag surviving from a prior dialog session for a row that is now
      // locked) is defensively excluded from both buckets rather than
      // guessed into either one - it cannot legitimately occur given the
      // render-time gating above, but silently doing nothing is the safe
      // failure mode if it ever did.
    }

    close();

    const summaryParts: string[] = [];
    if (creationRows.length > 0) {
      summaryParts.push(
        creationRows.length === 1
          ? `Assigning ${lesson.title} to 1 class`
          : `Assigning ${lesson.title} to ${creationRows.length} classes`,
      );
    }
    if (updateRows.length > 0) {
      summaryParts.push(
        updateRows.length === 1
          ? `Updating 1 class`
          : `Updating ${updateRows.length} classes`,
      );
    }
    onConfirm(summaryParts.join(". ") + ".");

    invalidateLifecycleCache(lesson.slug);

    if (creationRows.length > 0) {
      const classroomGrading: ClassroomGradingInput = shared.graded
        ? { mode: "graded", maxPoints: shared.points }
        : { mode: "ungraded" };
      void runAssignmentLifecycle({
        lesson,
        teacherUid: session.uid,
        enabledRows: creationRows,
        classroomGrading,
        assignments,
        integrations,
        assignmentDetail,
        onConfirm,
        onLifecycleComplete,
      });
    }

    if (updateRows.length > 0) {
      void runReconcileUpdates({
        lesson,
        teacherUid: session.uid,
        updateRows,
        assignments,
        onConfirm,
        onLifecycleComplete: onLifecycleComplete
          ? (ids) => {
              if (creationRows.length === 0) onLifecycleComplete(ids);
            }
          : undefined,
      });
    }
  });

  try {
    confirm.focus({ preventScroll: true });
  } catch {
    // ignored
  }
}

type RowRetryContext = {
  assignments: AssignmentsCallables;
  lessonSlug: string;
  // Historical Assignment Resolution, Implementation Slice 11. Used only
  // for teacher-facing Set/Change Current feedback messages
  // (`"${lessonTitle}: ..."`), mirroring the existing summary wording
  // convention `runReconcileUpdates`/`runAssignmentLifecycle` already use.
  lessonTitle: string;
  rowLifecycleState: Map<string, LifecycleStateEntry>;
  rowsHost: HTMLElement;
  // Historical Assignment Resolution, Implementation Slice 11. The same
  // dialog-level success/failure banner callback `openDialog` already
  // receives, reused here so Set/Change Current feedback appears through
  // the existing toast convention instead of a new one. Calling it does
  // NOT close the Assign dialog - the banner lives in the surface behind
  // it, exactly as it does for every other confirmation this surface
  // shows.
  onConfirm: (summary: string) => void;
};

// Historical Assignment Resolution, Implementation Slice 10 (extracted),
// Slice 11 (reused by Set/Change Current). Re-fetches lifecycle state for
// exactly this one class, updates both the shared cache and this dialog's
// own per-class map, and returns the fresh entry. Never writes anything;
// purely a re-read of server-authoritative state.
async function refreshRowLifecycle(
  cls: Extract<ClassSummary, { status: "active" }>,
  retryContext: RowRetryContext,
): Promise<LifecycleStateEntry> {
  const resp = await retryContext.assignments.lifecycleState({
    classId: cls.id,
    lessonSlug: retryContext.lessonSlug,
  });
  const entry: LifecycleStateEntry = {
    state: resp.state,
    candidates: resp.candidates,
    currentAssignmentId: resp.currentAssignmentId,
    currentAssignmentResolution: resp.currentAssignmentResolution,
  };
  cachedLifecycleState.set(
    lifecycleCacheKey(cls.id, retryContext.lessonSlug),
    entry,
  );
  retryContext.rowLifecycleState.set(cls.id, entry);
  return entry;
}

// Historical Assignment Resolution, Implementation Slice 10. Shared by both
// the pre-existing lifecycle-fetch-failure row state and the new
// Current-invalid row state below: re-fetches lifecycle state for exactly
// this one class and re-renders the row in place. Extracted here because
// Slice 10 adds a second row state that needs the identical retry
// mechanism; before this slice there was only one caller.
function attachRetryButton(
  doc: Document,
  row: HTMLElement,
  cls: Extract<ClassSummary, { status: "active" }>,
  rowState: Map<string, RowConfig>,
  onChange: () => void,
  link: IntegrationsClassLink | null,
  integrations: IntegrationsDeps | null,
  retryContext: RowRetryContext,
): void {
  const retryBtn = doc.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "shell-assign-row-retry";
  retryBtn.setAttribute("data-testid", `assign-row-retry-${cls.id}`);
  retryBtn.textContent = "Retry";
  retryBtn.setAttribute(
    "aria-label",
    `Retry loading assignment status for ${cls.title}`,
  );
  retryBtn.addEventListener("click", () => {
    retryBtn.disabled = true;
    retryBtn.textContent = "Retrying…";
    void refreshRowLifecycle(cls, retryContext)
      .then((entry) => {
        const newRow = renderRow(
          doc, cls, rowState, onChange, link, integrations, entry, retryContext,
        );
        row.replaceWith(newRow);
        onChange();
      })
      .catch(() => {
        retryBtn.disabled = false;
        retryBtn.textContent = "Retry";
      });
  });
  row.appendChild(retryBtn);
}

// Historical Assignment Resolution, post-release UX patch. Production
// verification surfaced classes with several historical candidates sharing
// the same publication DATE and the same recipient count (a morning batch
// and an afternoon batch on the same day, for example) - date alone did
// not give the teacher enough factual information to distinguish them for
// an explicit Set/Change Current selection. `publishedAt` already carries
// full time-of-day precision (epoch milliseconds from the server's
// Firestore timestamp; see `assignments-lifecycle-state.ts`), so this adds
// local clock time to the existing date presentation - no new data, no new
// server field, no change to which candidates are eligible or how they are
// ordered. Shared by both the Set/Change Current panel and the Assignment
// History panel so the same historical occurrence reads identically
// wherever a teacher encounters it.
function formatCandidatePublishedAt(publishedAt: number): string {
  const d = new Date(publishedAt);
  return `${formatLocalDate(d)} · ${formatLocalTime(d)}`;
}

// Historical Assignment Resolution, Implementation Slice 11. Only a
// published candidate may ever become Current - a draft or closed
// assignment is never presented as selectable in the Set/Change Current
// control, even though the server independently re-validates eligibility
// on its own. Eligibility is derived solely from the candidate's own
// `status`; attempts, recipients, grading mode, and Classroom state never
// factor in, per the locked no-heuristic product principle.
function eligiblePublishedCandidates(
  candidates: ReadonlyArray<AssignmentCandidate>,
): ReadonlyArray<AssignmentCandidate> {
  return candidates.filter((c) => c.status === "published");
}

// Historical Assignment Resolution, Implementation Slice 11. Renders the
// explicit "Set as current assignment" / "Change current assignment"
// disclosure and its candidate-selection panel for one row. Both are the
// same UI shape and the same underlying mutation
// (`assignmentsCurrentSet`) - they differ only in whether a prior Current
// exists to mark and exclude, and in the CAS value the confirm handler
// sends. Selection state (`selected`) is a plain local variable scoped to
// this one call: nothing here is stored in a dialog-level map, so a fresh
// `renderRow` call (triggered by a successful mutation, a failed mutation,
// or simply reopening the dialog) always starts with the panel closed and
// nothing selected - there is no stale selection to carry across a
// lifecycle refresh, and one row's selection can never be observed by, or
// affect, another row's.
//
// Confirming NEVER runs Update Assignment, recipient reconciliation,
// creation, or publication - it calls `assignmentsCurrentSet` and nothing
// else, then reloads lifecycle state so the rest of the row (badge,
// checkbox, ordinary Update path) reflects whatever the server now
// reports as Current.
function renderSetOrChangeCurrentControl(input: {
  readonly doc: Document;
  readonly cls: Extract<ClassSummary, { status: "active" }>;
  readonly row: HTMLElement;
  readonly rowState: Map<string, RowConfig>;
  readonly onChange: () => void;
  readonly link: IntegrationsClassLink | null;
  readonly integrations: IntegrationsDeps | null;
  readonly retryContext: RowRetryContext;
  readonly mode: "set" | "change";
  readonly eligible: ReadonlyArray<AssignmentCandidate>;
  readonly currentAssignmentId: string | null;
}): void {
  const {
    doc,
    cls,
    row,
    rowState,
    onChange,
    link,
    integrations,
    retryContext,
    mode,
    eligible,
    currentAssignmentId,
  } = input;

  const actionLabel =
    mode === "set" ? "Set as current assignment" : "Change current assignment";

  const toggleBtn = doc.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className =
    mode === "set"
      ? "shell-assign-row-set-current"
      : "shell-assign-row-change-current";
  toggleBtn.setAttribute("data-testid", `assign-row-${mode}-current-${cls.id}`);
  toggleBtn.textContent = actionLabel;
  row.appendChild(toggleBtn);

  // Deliberately NOT `.shell-assign-row-disambig` (the removed Slice 10
  // mutation-authority radio group's class) - this is a genuinely
  // different mechanism (explicit Current selection, never read by
  // ordinary Update Assignment), and several regression tests assert that
  // class's absence as proof the old mechanism stays gone. Reusing its
  // visual language for the option rows only (`.shell-assign-disambig-
  // option`/`.shell-assign-disambig-meta`, both still styled and no
  // longer otherwise used) keeps this control visually consistent with
  // the rest of the dialog without resurrecting the retired container
  // class or its old meaning.
  const panel = doc.createElement("div");
  panel.className = "shell-assign-row-current-panel";
  panel.setAttribute(
    "data-testid",
    `assign-row-${mode}-current-panel-${cls.id}`,
  );
  panel.hidden = true;

  const heading = doc.createElement("div");
  heading.className = "shell-assign-row-disambig-heading";
  heading.textContent =
    mode === "set"
      ? "Select the current assignment"
      : "Select a different current assignment";
  panel.appendChild(heading);

  let selected: string | null = null;
  const radioName = `assign-${mode}-current-${cls.id}`;
  for (const candidate of eligible) {
    const isCurrent = candidate.assignmentId === currentAssignmentId;
    const label = doc.createElement("label");
    label.className = "shell-assign-disambig-option";
    const radio = doc.createElement("input");
    radio.type = "radio";
    radio.name = radioName;
    radio.value = candidate.assignmentId;
    radio.setAttribute(
      "data-testid",
      `assign-current-option-${cls.id}-${candidate.assignmentId}`,
    );
    // "SAME CURRENT" - the already-Current candidate is identified but
    // cannot itself be selected as the new target, so a teacher can never
    // manufacture a same-value Change Current mutation from this control.
    if (isCurrent) {
      radio.disabled = true;
    }
    label.appendChild(radio);
    const text = doc.createElement("span");
    const publishedAtStr =
      candidate.publishedAt !== null
        ? formatCandidatePublishedAt(candidate.publishedAt)
        : "";
    text.textContent = publishedAtStr
      ? `${candidate.title} · ${publishedAtStr}`
      : candidate.title;
    label.appendChild(text);
    if (isCurrent) {
      const marker = doc.createElement("span");
      marker.className = "shell-assign-disambig-current-marker";
      marker.setAttribute(
        "data-testid",
        `assign-current-marker-${cls.id}-${candidate.assignmentId}`,
      );
      marker.textContent = "Current";
      label.appendChild(marker);
    }
    const meta = doc.createElement("span");
    meta.className = "shell-assign-disambig-meta";
    const rc = candidate.recipientCount;
    meta.textContent = rc === 1 ? "1 recipient" : `${rc} recipients`;
    label.appendChild(meta);
    panel.appendChild(label);
    radio.addEventListener("change", () => {
      if (radio.checked) {
        selected = candidate.assignmentId;
        validation.hidden = true;
      }
    });
  }

  const validation = doc.createElement("p");
  validation.className = "shell-assign-validation";
  validation.setAttribute(
    "data-testid",
    `assign-row-${mode}-current-validation-${cls.id}`,
  );
  validation.setAttribute("role", "alert");
  validation.hidden = true;
  validation.textContent = "Choose an assignment first.";
  panel.appendChild(validation);

  const actions = doc.createElement("div");
  actions.className = "shell-assign-row-current-actions";

  const confirmBtn = doc.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "shell-assign-row-current-confirm";
  confirmBtn.setAttribute(
    "data-testid",
    `assign-row-${mode}-current-confirm-${cls.id}`,
  );
  confirmBtn.textContent = actionLabel;
  actions.appendChild(confirmBtn);

  const cancelBtn = doc.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "shell-assign-row-current-cancel";
  cancelBtn.setAttribute(
    "data-testid",
    `assign-row-${mode}-current-cancel-${cls.id}`,
  );
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    selected = null;
    for (const radio of Array.from(
      panel.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    )) {
      radio.checked = false;
    }
    validation.hidden = true;
    panel.hidden = true;
    toggleBtn.hidden = false;
  });
  actions.appendChild(cancelBtn);
  panel.appendChild(actions);

  toggleBtn.addEventListener("click", () => {
    toggleBtn.hidden = true;
    panel.hidden = false;
  });

  confirmBtn.addEventListener("click", () => {
    // Confirming without an explicit selection never mutates - this is the
    // only validation this control performs, and it never substitutes a
    // default target of any kind.
    if (!selected) {
      validation.hidden = false;
      try {
        panel
          .querySelector<HTMLInputElement>('input[type="radio"]:not(:disabled)')
          ?.focus({ preventScroll: false });
      } catch {
        // ignored
      }
      return;
    }
    const assignmentId = selected;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = mode === "set" ? "Setting…" : "Changing…";

    void (async () => {
      let mutationSucceeded = false;
      try {
        await retryContext.assignments.currentSet({
          classId: cls.id,
          lessonSlug: retryContext.lessonSlug,
          assignmentId,
          expectedCurrentAssignmentId:
            mode === "set" ? null : currentAssignmentId,
        });
        mutationSucceeded = true;
      } catch {
        // Handled uniformly below: whether this was a stale-CAS conflict or
        // any other failure, the client never retries with a substituted
        // expected value, never falls back to recipient reconciliation or
        // creation, and never claims success. It refreshes live lifecycle
        // state and requires the teacher to review and reselect.
        mutationSucceeded = false;
      }

      let entry: LifecycleStateEntry;
      try {
        entry = await refreshRowLifecycle(cls, retryContext);
      } catch {
        entry = {
          state: "neverAssigned",
          candidates: [],
          currentAssignmentId: null,
          currentAssignmentResolution: "unresolved",
          error: true,
        };
        retryContext.rowLifecycleState.set(cls.id, entry);
      }
      const newRow = renderRow(
        doc, cls, rowState, onChange, link, integrations, entry, retryContext,
      );
      row.replaceWith(newRow);
      onChange();

      retryContext.onConfirm(
        mutationSucceeded
          ? mode === "set"
            ? "Current assignment set."
            : "Current assignment changed."
          : `${retryContext.lessonTitle}: current assignment could not be ${
              mode === "set" ? "set" : "changed"
            }. Please review and try again.`,
      );
    })();
  });

  row.appendChild(panel);
}

// Historical Assignment Resolution, Implementation Slice 12. Teacher-facing
// capitalization for the candidate status vocabulary. Every value the
// server can send (`draft`/`published`/`closed`, per
// `AssignmentCandidate["status"]`) is covered explicitly - no default
// fallback is provided, so a genuinely unrecognized status would be a
// compile-time error here rather than a silently invented label.
function historyStatusLabel(status: AssignmentCandidate["status"]): string {
  switch (status) {
    case "published":
      return "Published";
    case "closed":
      return "Closed";
    case "draft":
      return "Draft";
  }
}

// Historical Assignment Resolution, Implementation Slice 12. Read-only
// "Assignment history" disclosure for one row. Mirrors the established
// accessible disclosure pattern already used for the lesson-card Resources
// control (`renderLessonResources`): a native `<button>` with
// `aria-expanded`/`aria-controls` toggling a `hidden` panel containing a
// `<ul role="list">`. Deliberately does NOT reuse the Set/Change Current
// panel markup or class names - History is presentation-only and must
// never be mistaken for, or share DOM/selection state with, that mutation
// workflow.
//
// This function performs no server call and calls no `AssignmentsCallables`
// member. It only reads the `candidates`/`currentAssignmentId`/
// `currentResolution` already present in the row's own `LifecycleStateEntry`
// (fetched once for the dialog, or refreshed by Retry/Set/Change - never by
// History itself). Opening, closing, or reading it can never write
// anything: no `assignmentsCurrentSet`, no `assignmentsCurrentRecipientsReconcile`,
// no `assignmentsRecipientsReconcile`, no `assignmentsCreateDraft`, no
// `assignmentsPublish`.
function renderAssignmentHistoryControl(input: {
  readonly doc: Document;
  readonly cls: Extract<ClassSummary, { status: "active" }>;
  readonly row: HTMLElement;
  readonly candidates: ReadonlyArray<AssignmentCandidate>;
  readonly currentAssignmentId: string | null;
  readonly currentResolution: CurrentAssignmentResolution;
}): void {
  const { doc, cls, row, candidates, currentAssignmentId, currentResolution } =
    input;

  const panelId = `assign-row-history-panel-${cls.id}`;

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "shell-assign-row-history-toggle";
  toggle.setAttribute("data-testid", `assign-row-history-toggle-${cls.id}`);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  toggle.setAttribute(
    "aria-label",
    `Assignment history for ${cls.title}, ${candidates.length} entries`,
  );
  toggle.textContent = "Assignment history";
  row.appendChild(toggle);

  const panel = doc.createElement("div");
  panel.className = "shell-assign-row-history-panel";
  panel.id = panelId;
  panel.setAttribute("data-testid", `assign-row-history-${cls.id}`);
  panel.hidden = true;

  const list = doc.createElement("ul");
  list.className = "shell-assign-row-history-list";
  list.setAttribute("role", "list");
  panel.appendChild(list);

  // Current is marked ONLY when the server reports a valid resolution AND
  // the exact ID it names appears among these candidates - never inferred
  // from ordering, status, or recipient count. Slice 9's client parser
  // validates the Current contract shape but does not require the ID to
  // appear in `candidates`; if a `valid` resolution's ID somehow matches no
  // candidate here, this loop simply marks nothing, which is the correct
  // fail-safe presentation behavior (never guess, never mutate).
  for (const candidate of candidates) {
    const item = doc.createElement("li");
    item.className = "shell-assign-row-history-item";
    item.setAttribute("role", "listitem");
    item.setAttribute(
      "data-testid",
      `assign-row-history-item-${cls.id}-${candidate.assignmentId}`,
    );

    const dateText = doc.createElement("span");
    dateText.className = "shell-assign-row-history-date";
    dateText.textContent =
      candidate.publishedAt !== null
        ? formatCandidatePublishedAt(candidate.publishedAt)
        : historyStatusLabel(candidate.status);
    item.appendChild(dateText);

    const recipientsText = doc.createElement("span");
    recipientsText.className = "shell-assign-row-history-recipients";
    const rc = candidate.recipientCount;
    recipientsText.textContent = rc === 1 ? "1 recipient" : `${rc} recipients`;
    item.appendChild(recipientsText);

    const statusText = doc.createElement("span");
    statusText.className = "shell-assign-row-history-status";
    statusText.textContent = historyStatusLabel(candidate.status);
    item.appendChild(statusText);

    if (
      currentResolution === "valid" &&
      candidate.assignmentId === currentAssignmentId
    ) {
      const marker = doc.createElement("span");
      marker.className = "shell-assign-row-history-current";
      marker.setAttribute(
        "data-testid",
        `assign-row-history-current-${cls.id}`,
      );
      marker.textContent = "Current";
      item.appendChild(marker);
    }

    list.appendChild(item);
  }

  toggle.addEventListener("click", () => {
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", isOpen ? "false" : "true");
    panel.hidden = isOpen;
  });

  row.appendChild(panel);
}

function renderRow(
  doc: Document,
  cls: Extract<ClassSummary, { status: "active" }>,
  rowState: Map<string, RowConfig>,
  onChange: () => void,
  link: IntegrationsClassLink | null,
  integrations: IntegrationsDeps | null,
  lifecycle?: LifecycleStateEntry,
  retryContext?: RowRetryContext,
): HTMLElement {
  const cfg = rowState.get(cls.id);
  if (!cfg) throw new Error(`missing row state for class ${cls.id}`);

  // Sprint 30A.1 UX correction: a compact, horizontally-aligned row
  // rather than a tall stacked card. `row` is a `display:contents` grid
  // item host (see the `.shell-assign-class-row` rule) so its direct
  // children - checkbox, identity, topic, date, time - become columns of
  // the SHARED grid defined on `.shell-assign-rows`, aligning every row's
  // columns without a literal `<table>`.
  //
  // Sprint 30A.1 human-review finalization: this row previously also
  // carried a drag handle for in-dialog reordering. Human review moved
  // reordering to the Classes workspace (see classes.ts) - Assign now
  // only DISPLAYS the canonical order it receives, so the handle, its
  // native-drag wiring, and its keyboard bindings are removed entirely.
  // The row's own root-cause investigation: `row` is a `display:contents`
  // grid-item host (see `.shell-assign-class-row` above), and an element
  // with `display:contents` generates no box of its own - only its
  // children do. Native HTML5 drag-and-drop requires the dragged element
  // to have a real, hit-testable box to originate the drag gesture from,
  // so setting `draggable=true` on a `display:contents` element is
  // unreliable across browsers: there is nothing for the browser to grab.
  // This is why the prior Assign drag interaction never actually
  // initiated a drag in the browser despite the handle, `pointerdown`,
  // and `dragstart` wiring all being present. The Classes workspace does
  // not have this problem (see classes.ts) because its cards are ordinary
  // block-level elements with real boxes.
  const row = doc.createElement("div");
  row.className = "shell-assign-class-row";
  row.setAttribute("data-testid", `assign-row-${cls.id}`);
  row.setAttribute("data-class-id", cls.id);
  if (link) {
    row.setAttribute("data-lms-linked", "true");
    row.setAttribute("data-lms-link-id", link.linkId);
    row.setAttribute("data-lms-provider", link.providerId);
  }

  const checkboxWrapper = doc.createElement("label");
  checkboxWrapper.className = "shell-assign-row-select";
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = cfg.enabled;
  checkbox.setAttribute("data-testid", `assign-row-enabled-${cls.id}`);
  checkbox.setAttribute(
    "aria-label",
    `Include ${cls.title} in this assignment`,
  );
  checkboxWrapper.appendChild(checkbox);
  row.appendChild(checkboxWrapper);

  const identity = doc.createElement("span");
  identity.className = "shell-assign-row-identity";
  identity.textContent =
    cls.grade.length > 0 ? `${cls.title} · Grade ${cls.grade}` : cls.title;
  row.appendChild(identity);

  const isUnresolved = lifecycle?.error === true;
  const lcState = isUnresolved ? "unresolved" : (lifecycle?.state ?? "neverAssigned");
  row.setAttribute("data-lifecycle-state", lcState);

  if (isUnresolved) {
    cfg.enabled = false;
    checkbox.checked = false;
    checkbox.disabled = true;
    checkbox.setAttribute(
      "aria-label",
      `${cls.title} - assignment status could not be determined`,
    );
    const errorBadge = doc.createElement("span");
    errorBadge.className = "shell-assign-row-lifecycle shell-assign-lifecycle-error";
    errorBadge.setAttribute("data-testid", `assign-row-lifecycle-${cls.id}`);
    errorBadge.textContent = "Unable to check status";
    row.appendChild(errorBadge);
    if (retryContext) {
      attachRetryButton(doc, row, cls, rowState, onChange, link, integrations, retryContext);
    }
    return row;
  }

  // Historical Assignment Resolution, Implementation Slice 10. Current is
  // an independent resolution dimension alongside the five lifecycle
  // states above (Slice 8/9). `data-current-resolution` is a plain
  // testability hook, exactly like the pre-existing `data-lifecycle-state`
  // and `data-selected-assignment` attributes - it carries no styling and
  // is not itself user-facing text.
  const currentResolution: CurrentAssignmentResolution =
    lifecycle?.currentAssignmentResolution ?? "unresolved";
  row.setAttribute("data-current-resolution", currentResolution);

  // A pointer that exists but fails validation is a contradictory,
  // fail-closed state (Slice 8's `invalid`, never collapsed into
  // `unresolved`) for every lifecycle state except `neverAssigned`: a
  // brand-new first assignment does not depend on Current being valid
  // beforehand (Slice 5 atomically establishes Current when it publishes),
  // so a stray or corrupted pointer elsewhere must never block the
  // teacher's ability to create a genuine first occurrence. Every other
  // state (including `historicalOnly`, whose "Assign as new" action is
  // otherwise unaffected by Current) fails safe here rather than silently
  // proceeding on contradictory server state - this is a strictly stronger
  // failure than "unresolved," so it is checked first and short-circuits
  // before any lifecycle-state-specific rendering below. No mutation
  // control is ever exposed on this branch; the only available action is
  // the same re-fetch-and-retry the lifecycle-fetch-failure branch above
  // already offers.
  if (currentResolution === "invalid" && lcState !== "neverAssigned") {
    cfg.enabled = false;
    checkbox.checked = false;
    checkbox.disabled = true;
    checkbox.setAttribute(
      "aria-label",
      `${cls.title} - current assignment could not be verified`,
    );
    const errorBadge = doc.createElement("span");
    errorBadge.className = "shell-assign-row-lifecycle shell-assign-lifecycle-error";
    errorBadge.setAttribute("data-testid", `assign-row-lifecycle-${cls.id}`);
    errorBadge.textContent = "Current assignment could not be verified";
    row.appendChild(errorBadge);
    if (retryContext) {
      attachRetryButton(doc, row, cls, rowState, onChange, link, integrations, retryContext);
    }
    return row;
  }

  const lifecycleBadge = doc.createElement("span");
  lifecycleBadge.className = "shell-assign-row-lifecycle";
  lifecycleBadge.setAttribute(
    "data-testid",
    `assign-row-lifecycle-${cls.id}`,
  );
  // Historical Assignment Resolution, Implementation Slice 10 (Slice 11
  // broadens the state set covered). Normal Update Assignment (the
  // badge/checkbox pair below that leads to a mutation) is offered ONLY
  // when Current is resolved and valid - never inferred from a lone
  // published candidate, never left to a teacher's historical radio
  // selection. Slice 11 correction: `onePublishedFullyCurrent` is NOT
  // exempt from this gating the way it was in Slice 10. A class can have
  // exactly one published, fully-staffed assignment and STILL have no
  // Current pointer at all (legacy history predating this feature) -
  // recipient completeness and Current resolution are independent
  // dimensions, so "Up to date" is only true once Current is also
  // resolved. All three states that guarantee at least one published
  // candidate (`onePublishedFullyCurrent`, `onePublishedMissingRecipients`,
  // `multiplePublished`) therefore share the identical needs-resolution
  // gate below.
  const needsCurrentResolution =
    (lcState === "onePublishedFullyCurrent" ||
      lcState === "onePublishedMissingRecipients" ||
      lcState === "multiplePublished") &&
    currentResolution !== "valid";
  const currentAssignmentId = lifecycle?.currentAssignmentId ?? null;
  const eligibleCandidates = eligiblePublishedCandidates(
    lifecycle?.candidates ?? [],
  );

  if (lcState === "onePublishedFullyCurrent") {
    if (needsCurrentResolution) {
      lifecycleBadge.textContent = "Needs resolution before updating";
      lifecycleBadge.classList.add("shell-assign-lifecycle-needs-resolution");
      cfg.enabled = false;
      checkbox.checked = false;
      checkbox.disabled = true;
      checkbox.setAttribute(
        "aria-label",
        `${cls.title} - current assignment needs resolution before it can be updated`,
      );
    } else {
      lifecycleBadge.textContent = "Up to date";
      lifecycleBadge.classList.add("shell-assign-lifecycle-current");
      cfg.enabled = false;
      checkbox.checked = false;
      checkbox.disabled = true;
      checkbox.setAttribute(
        "aria-label",
        `${cls.title} assignment is up to date`,
      );
    }
  } else if (lcState === "onePublishedMissingRecipients") {
    if (needsCurrentResolution) {
      lifecycleBadge.textContent = "Needs resolution before updating";
      lifecycleBadge.classList.add("shell-assign-lifecycle-needs-resolution");
      cfg.enabled = false;
      checkbox.checked = false;
      checkbox.disabled = true;
      checkbox.setAttribute(
        "aria-label",
        `${cls.title} - current assignment needs resolution before it can be updated`,
      );
    } else {
      const missing =
        lifecycle?.candidates.find((c) => c.status === "published")
          ?.missingRecipientCount ?? 0;
      lifecycleBadge.textContent =
        missing === 1
          ? "1 student to add"
          : `${missing} students to add`;
      lifecycleBadge.classList.add("shell-assign-lifecycle-update");
      checkbox.setAttribute(
        "aria-label",
        `Update assignment for ${cls.title}`,
      );
    }
  } else if (lcState === "multiplePublished") {
    if (needsCurrentResolution) {
      lifecycleBadge.textContent = "Needs resolution before updating";
      lifecycleBadge.classList.add("shell-assign-lifecycle-needs-resolution");
      cfg.enabled = false;
      checkbox.checked = false;
      checkbox.disabled = true;
      checkbox.setAttribute(
        "aria-label",
        `${cls.title} - current assignment needs resolution before it can be updated`,
      );
    } else {
      lifecycleBadge.textContent = "Multiple assignments";
      lifecycleBadge.classList.add("shell-assign-lifecycle-multiple");
      checkbox.setAttribute(
        "aria-label",
        `Update assignment for ${cls.title}`,
      );
    }
  } else if (lcState === "historicalOnly") {
    lifecycleBadge.textContent = "Assign as new";
    lifecycleBadge.classList.add("shell-assign-lifecycle-historical");
  }
  if (lifecycleBadge.textContent) {
    row.appendChild(lifecycleBadge);
  }

  // Historical Assignment Resolution, Implementation Slice 11. The
  // explicit Set/Change Current workflow. Gated on `retryContext` being
  // present, exactly like the retry button above - both require a real
  // `assignments` seam, since both perform a genuine server mutation or
  // re-fetch; the UI-only local-assign path (`assignments === null`) never
  // reaches `onePublishedFullyCurrent`/`onePublishedMissingRecipients`/
  // `multiplePublished` at all (lifecycle is never fetched there), but the
  // guard is kept explicit rather than relying on that indirectly.
  //
  // Set: offered whenever Current is unresolved and at least one eligible
  // published candidate exists - true for all three states reaching this
  // point when `needsCurrentResolution` is set, since each of those states
  // is defined by having >=1 published candidate. No candidate is ever
  // preselected, and opening the control never mutates anything.
  //
  // Change: offered only once Current is valid AND there exists at least
  // one OTHER eligible published candidate besides the current one. Given
  // the state invariants above, this is only ever true for
  // `multiplePublished` + valid (the other two states have exactly one
  // published candidate, which IS Current, leaving no other target) - the
  // check is written generically here rather than special-cased to that
  // one state, since the state invariant is what the server enforces, not
  // something this client should hard-code an assumption about.
  if (retryContext) {
    if (needsCurrentResolution && eligibleCandidates.length > 0) {
      renderSetOrChangeCurrentControl({
        doc,
        cls,
        row,
        rowState,
        onChange,
        link,
        integrations,
        retryContext,
        mode: "set",
        eligible: eligibleCandidates,
        currentAssignmentId: null,
      });
    } else if (currentResolution === "valid") {
      const otherEligible = eligibleCandidates.filter(
        (c) => c.assignmentId !== currentAssignmentId,
      );
      if (otherEligible.length > 0) {
        renderSetOrChangeCurrentControl({
          doc,
          cls,
          row,
          rowState,
          onChange,
          link,
          integrations,
          retryContext,
          mode: "change",
          eligible: eligibleCandidates,
          currentAssignmentId,
        });
      }
    }
  }

  // Historical Assignment Resolution, Implementation Slice 12. Read-only
  // "Assignment history" disclosure - a genuinely separate concern from
  // Set/Change Current above, gated independently: it is available
  // whenever there are 2+ total historical occurrences (published, closed,
  // OR draft - not just eligible-for-Current ones), regardless of which
  // lifecycle state or Current resolution produced them. A single
  // occurrence adds nothing a disclosure would clarify beyond what the
  // badge above already says, so the default (and, per fresh reconnaissance
  // of this codebase, the correct choice - Curriculum intentionally has no
  // per-assignment Assignment Detail link; see the Slice 12 report) is to
  // omit the control entirely below that threshold rather than render an
  // empty-feeling disclosure.
  //
  // This never reaches the invalid-Current fail-safe row above (that
  // branch returns `row` before this point in the function), so an
  // unverifiable Current can never expose History as a workaround - this
  // is enforced by control flow, not a separate check here.
  const allCandidates = lifecycle?.candidates ?? [];
  if (retryContext && allCandidates.length >= 2) {
    renderAssignmentHistoryControl({
      doc,
      cls,
      row,
      candidates: allCandidates,
      currentAssignmentId,
      currentResolution,
    });
  }

  const isCreationRow =
    lcState === "neverAssigned" || lcState === "historicalOnly";
  // Historical Assignment Resolution, Implementation Slice 10. Broadened
  // from the pre-Slice-10 `lcState === "onePublishedFullyCurrent"` check:
  // any row this slice force-disables (see `needsCurrentResolution` above)
  // must skip the checkbox change-listener wiring below exactly as
  // `onePublishedFullyCurrent` already did, for the identical reason -
  // there is nothing this row can currently do.
  const isLockedRow =
    lcState === "onePublishedFullyCurrent" || needsCurrentResolution;

  let lmsTopicSelect: HTMLSelectElement | null = null;
  let dateInput: HTMLInputElement | null = null;
  let timeInput: HTMLInputElement | null = null;

  if (isCreationRow) {
    if (link && integrations !== null) {
      const select = doc.createElement("select");
      select.className =
        "shell-assign-lms-topic-select shell-assign-row-topic";
      select.setAttribute("data-testid", `assign-row-lms-topic-${cls.id}`);
      select.setAttribute(
        "aria-label",
        `${cls.title} Google Classroom topic`,
      );
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
      row.appendChild(select);
      lmsTopicSelect = select;
      void ensureTopics(link.linkId, integrations).then(() => {
        const topics = cachedTopicsByLinkId.get(link.linkId) ?? [];
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
    } else if (integrations !== null) {
      const placeholder = doc.createElement("span");
      placeholder.className =
        "shell-assign-row-topic shell-assign-row-topic-empty";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.textContent = "—";
      row.appendChild(placeholder);
    }

    dateInput = doc.createElement("input");
    dateInput.type = "date";
    dateInput.className = "shell-assign-row-date";
    dateInput.id = `assign-row-date-${cls.id}`;
    dateInput.setAttribute("data-testid", `assign-row-date-${cls.id}`);
    dateInput.setAttribute("aria-label", `${cls.title} release date`);
    dateInput.value = cfg.date;
    dateInput.addEventListener("input", () => {
      cfg.date = dateInput!.value;
    });
    row.appendChild(dateInput);

    timeInput = doc.createElement("input");
    timeInput.type = "time";
    timeInput.className = "shell-assign-row-time";
    timeInput.id = `assign-row-time-${cls.id}`;
    timeInput.setAttribute("data-testid", `assign-row-time-${cls.id}`);
    timeInput.setAttribute("aria-label", `${cls.title} release time`);
    timeInput.value = cfg.time;
    timeInput.addEventListener("input", () => {
      cfg.time = timeInput!.value;
    });
    row.appendChild(timeInput);
  }

  // Historical Assignment Resolution, Implementation Slice 10. The
  // historical candidate disambiguation radio group (formerly rendered
  // here for every `multiplePublished` row) is removed entirely: it is no
  // longer needed when Current is valid (Update Assignment now targets
  // Current automatically, server-side, via
  // `assignmentsCurrentRecipientsReconcile`), and it must not be offered
  // as a workaround when Current is unresolved or invalid either, since a
  // radio selection can no longer determine the mutation target under any
  // circumstance. Explicit historical resolution (choosing which
  // historical assignment becomes Current) is Slice 11's
  // "Set as current assignment" / "Change current assignment" work, not
  // this slice's.

  const setRowEnabled = (enabled: boolean): void => {
    cfg.enabled = enabled;
    row.setAttribute("data-enabled", enabled ? "true" : "false");
    row.classList.toggle("shell-assign-row-disabled", !enabled);
    const controls: HTMLElement[] = [];
    if (dateInput) controls.push(dateInput);
    if (timeInput) controls.push(timeInput);
    if (lmsTopicSelect) controls.push(lmsTopicSelect);
    for (const el of controls) {
      (el as HTMLInputElement | HTMLSelectElement).disabled = !enabled;
    }
    onChange();
  };
  if (!isLockedRow) {
    setRowEnabled(cfg.enabled);
    checkbox.addEventListener("change", () => {
      setRowEnabled(checkbox.checked);
    });
  } else {
    setRowEnabled(false);
  }

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
// Recipient reconciliation (Update Assignment path)
// -----------------------------------------------------------------------------

// Historical Assignment Resolution, Implementation Slice 10. Every row
// reaching this function has already been determined, at render time, to
// have a `valid` Current resolution (or to be the non-mutating
// `onePublishedFullyCurrent` case, which never appears here in practice
// since it is never enabled). The mutation target is never chosen by this
// function, or by anything upstream of it in the client: `classId` and
// `lessonSlug` are the only identifiers sent, and the server independently
// resolves live Current, again, during this exact call
// (`assignmentsCurrentRecipientsReconcile`) - this is what makes the
// action safe even if the browser's own belief about Current (from an
// earlier lifecycle read) has since gone stale. `lcState`/`candidates` are
// no longer needed here at all; the old heuristic "find the published
// candidate" selection this function used to perform is removed, not
// merely bypassed.
async function runReconcileUpdates(input: {
  readonly lesson: SurfaceableLesson;
  readonly teacherUid: string;
  readonly updateRows: readonly {
    readonly classId: string;
    readonly className: string;
  }[];
  readonly assignments: AssignmentsCallables;
  readonly onConfirm: (summary: string) => void;
  readonly onLifecycleComplete?: (
    assignmentIds: ReadonlyArray<string>,
  ) => void;
}): Promise<void> {
  const { lesson, teacherUid, updateRows, assignments, onConfirm, onLifecycleComplete } =
    input;

  const results = await Promise.allSettled(
    updateRows.map(async (row) => {
      try {
        const resp = await assignments.currentRecipientsReconcile({
          classId: row.classId,
          lessonSlug: lesson.slug,
        });
        return {
          classId: row.classId,
          assignmentId: resp.assignmentId,
          added: resp.added,
          failed: false,
        };
      } catch {
        return {
          classId: row.classId,
          assignmentId: "",
          added: 0,
          failed: true,
        };
      }
    }),
  );

  const outcomes = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { classId: "", assignmentId: "", added: 0, failed: true },
  );

  const succeeded = outcomes.filter((o) => !o.failed);
  const failed = outcomes.filter((o) => o.failed);
  const totalAdded = succeeded.reduce((sum, o) => sum + o.added, 0);

  let summary: string;
  if (failed.length === 0 && succeeded.length === 1) {
    summary =
      totalAdded === 0
        ? `${lesson.title}: assignment is up to date.`
        : totalAdded === 1
          ? `${lesson.title}: added 1 student.`
          : `${lesson.title}: added ${totalAdded} students.`;
  } else if (failed.length === 0) {
    summary =
      totalAdded === 0
        ? `${lesson.title}: all ${succeeded.length} assignments are up to date.`
        : `${lesson.title}: updated ${succeeded.length} classes, added ${totalAdded} students.`;
  } else if (succeeded.length === 0) {
    summary = `${lesson.title}: update did not succeed. Please try again.`;
  } else {
    summary = `${lesson.title}: updated ${succeeded.length} of ${outcomes.length} classes. ${failed.length} did not succeed.`;
  }

  if (succeeded.length > 0) {
    markPersisted(teacherUid, lesson.slug);
  }

  onConfirm(summary);
  onLifecycleComplete?.(succeeded.map((o) => o.assignmentId));
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
  // Sprint 30A.1 UX correction: ONE shared grading configuration for the
  // whole Assign action, derived once by the caller from the dialog-level
  // shared settings - never per class. Applied identically to every
  // selected class below.
  readonly classroomGrading: ClassroomGradingInput;
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
    classroomGrading,
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
      // Second human-review correction: selecting an LMS-linked class for
      // this Assign action IS the publication decision - there is no
      // second "Also publish to Google Classroom" opt-in to check
      // anymore. A selected class with no link, or with LMS deps absent,
      // never attempts publication (a non-existent link can never be
      // invented client-side).
      const wantsLms = row.link !== null && integrations !== null;

      // Step 1: authoritative draft. If this fails, no publish and no
      // LMS side effect.
      //
      // Sprint 30A.1 UX correction: the same `classroomGrading` value -
      // the one shared choice for the whole Assign action - is sent
      // explicitly on every selected class's draft creation, never
      // inferred and never omitted, so a new assignment is never left to
      // fall back on the server's legacy-absence convention.
      try {
        await assignments.createDraft({
          assignmentId,
          classId: row.classId,
          lessonSlug: lesson.slug,
          mode: "classroom",
          title: lesson.title,
          classroomGrading,
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

      // Sprint 13B remediation, retained through Sprint 28.6D. Record the
      // published assignment in the session-scoped registry so the
      // class-centered Assignments section and Assignment Detail can
      // surface it (the registry is now consumed by Classes, not by a
      // Curriculum-side control). Only teacher-owned metadata is stored.
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
  cachedLifecycleState.clear();
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
  cachedLifecycleState.clear();
  sessionPreferences.releaseTime = DEFAULT_RELEASE_TIME;
  sessionPreferences.topic = "";
  sessionPreferences.lmsTopicId = "";
  sessionPersistedSlugs = null;
  sessionFilters = null;
  clearStoredFilters();
  _resetLmsPublicationStateForTest();
}
