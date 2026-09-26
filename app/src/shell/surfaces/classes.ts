import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type {
  UpdateTeacherClassOrder,
  ReadTeacherClassColors,
} from "../../classes/classOrder";
import type { UpdateClassMetadata } from "../../classes/updateClassMetadata";
import type { UpdateClassColor } from "../../classes/updateClassColor";
import type { ClassColorToken } from "../../classes/classColor";
import { CLASS_COLOR_TOKENS, CLASS_COLOR_LABELS } from "../../classes/classColor";
// Sprint 30A.1 human-review finalization: imports the pure reorder
// arithmetic from classOrderMath.ts directly, NOT from classOrder.ts -
// that file also defines Firebase-backed factories that import
// `firebase/firestore` / `firebase/functions` at module scope, and this
// module carries a "no firebase/* import" invariant (see the header
// comment above) so it stays reachable from plain-node Jest suites that
// do not polyfill `fetch`.
import { moveClassId } from "../../classes/classOrderMath";
import type { CreateClass, CreateClassResult } from "../../classes/createClass";
import type { ActivateClass } from "../../classes/activateClass";
import type {
  SyncRoster,
  SyncRosterCounters,
  SyncRosterError,
} from "../../classes/syncRoster";
import type {
  ImportController,
  ImportFromClassroomDeps,
  ImportState,
} from "../../classes/importFromClassroom";
import { createImportFromClassroom } from "../../classes/importFromClassroom";
import type { LoadClassRosterAccessor } from "../../classes/classRoster";
import type {
  IntegrationsLmsClass,
  RefreshRoster,
  RefreshRosterResult,
} from "../../settings/integrations/types";
import { classifyRosterSyncError } from "../../classes/rosterSyncError";
import type { TeacherDefaultGrade } from "../../teacherPreferences/types";
import {
  isTeacherDefaultGrade,
  TEACHER_DEFAULT_GRADE_VALUES,
} from "../../teacherPreferences/types";
// Sprint 28.6H.3 (Task B1): Overview/Snapshot is removed from the class
// workspace, so `renderSnapshotSurface` is no longer mounted here. The
// `SnapshotPreview` type is retained on the deps contract (dormant) so the
// shell wiring stays intact; the surface module itself is left dormant in the
// tree (not deleted), mirroring the Present Mode disposition.
import type { SnapshotPreview } from "./snapshot";
// Sprint 25 certification (B2) fix: after any class mutation on this
// surface, drop the Curriculum surface's module-scoped class cache so
// the Assign dialog cannot keep serving the pre-mutation class list. The
// two sibling surfaces already flow through the shared shell; this direct
// import mirrors the existing sibling import of `./snapshot`.
import { invalidateCurriculumClassCache } from "./curriculum";
import type {
  CurriculumAssignmentDetailSeam,
  AssignmentDetailOpenOptions,
  AssignmentDetailStudentSelection,
} from "./curriculum";
import type { WorkspaceSurfaceKey } from "../navigation";
// Sprint 28.6C: the class-scoped Assignments section reuses the certified
// Active Assignments renderer (flat, filtered by classId) rather than
// duplicating an assignment-row implementation. Curriculum keeps mounting the
// same renderer in its accordion form until 28.6D removes it from Curriculum.
import {
  renderActiveAssignmentsSection,
  isRenderableCard,
  formatLocalDate,
} from "./shared/activeAssignments";
import type { AssignmentDetailMetadata } from "../../assignments/detail/types";
import type {
  AttemptGetForTeacherCallable,
  AttemptsListForClassCallable,
  CompletedAttemptSummary,
} from "../../assignments/detail/attempts-wire";
import type {
  AssessmentStudentAssignmentsForClassCallable,
  StudentAssignmentGroup,
  StudentExpectedAssignment,
} from "../../assignments/detail/studentAssignments-wire";
import type { AssignmentSummaryCallable } from "../../assignments/summary/types";
import { registerOpenModal } from "../openModals";
import type { ClassWorkspaceSection } from "../navigationHistory";

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

// Phase 2B.4: `setup` is the workspace state for a needsSetup class.
// It is not a peer of Snapshot / Roster in the class navigation; it
// replaces both until the class becomes active. Snapshot and Roster
// are unreachable for a needsSetup class.
//
// Sprint 28.6C: the class workspace becomes the conceptual Overview /
// Assignments / Students structure. The internal tab keys are kept stable
// (`snapshot` = Overview, `roster` = Students) so the certified switcher
// testids and their tests are preserved; `assignments` is the new
// class-scoped operational section. Only the visible labels change.
export type ClassWorkspaceTab =
  | "snapshot"
  | "assignments"
  | "roster"
  | "setup";

// Sprint 28.6C: shell-owned return location so the teacher lands back in a
// class's Assignments section after returning from Assignment Detail. See
// shell.ts `classesReturn`.
export type ClassWorkspaceReturn = {
  readonly classId: string;
  readonly tab: ClassWorkspaceTab;
};

// Sprint 28.6F: which class-management control the Classes surface should
// open on its next mount. Settings' "Classes & Google Classroom" section
// sets this (via the shell opener) and navigates to Classes, so the two
// entry points drive one workflow implementation. `"create"` opens the
// Create LyfeLabz Class form; `"import"` reveals and focuses the Import
// entry point (the teacher confirms with one click so the OAuth pop-up
// stays inside a user gesture). Consumed exactly once per navigation.
export type ClassManagementIntent = "create" | "import";

// Browser Back/Forward support: bundles the notify/registerController
// pair the shell needs to keep browser history in sync with this
// surface's own nested navigation (opening a class into its Students
// roster, and opening/traversing Student Detail from there), without
// this surface importing `window`, `history`, or any browser-navigation
// API directly (this module stays a pure DOM builder; only shell.ts
// touches browser history). `notify` reports a meaningful enter/exit
// transition so the shell can push/replace the matching history entry:
// - "enter-workspace" / "exit-workspace": a class workspace SECTION
//   (Assignments, Students, or Setup) becoming active - opening a class or
//   switching its section - / being left for the flat Classes list. Every
//   section is its own history entry so Back walks Student -> Students ->
//   Assignments -> Classes.
// - "enter-assignment-detail" / "exit-assignment-detail": Assignment
//   Summary opening from a class's Assignments section / its in-app "Back
//   to class" returning there (a replace, never `history.back()`).
// - "enter-detail" / "exit-detail": Student Detail opening (from the
//   roster OR via Previous/Next, which is real navigation to a different
//   student and therefore its own history entry) / closing back to the
//   Students tab.
// `registerController` is called once, synchronously, during this
// surface's mount, and hands the shell a restore capability keyed by
// stable ids only (classId, studentId) - never a display name - for
// popstate to call back into.
export type StudentDetailHistorySeam = {
  readonly notify: (
    input:
      | {
          readonly kind: "enter-workspace";
          readonly classId: string;
          readonly section: ClassWorkspaceSection;
        }
      | { readonly kind: "exit-workspace" }
      | {
          readonly kind: "enter-detail";
          readonly classId: string;
          readonly studentId: string;
        }
      | { readonly kind: "exit-detail" }
      | {
          readonly kind: "enter-assignment-detail";
          readonly classId: string;
          readonly assignmentId: string;
        }
      | { readonly kind: "exit-assignment-detail"; readonly classId: string },
  ) => void;
  readonly registerController: (controller: {
    readonly restoreWorkspace: (
      classId: string,
      section?: ClassWorkspaceSection,
    ) => boolean;
    readonly restoreToTopList: () => void;
    readonly restoreDetail: (classId: string, studentId: string) => boolean;
    readonly restoreList: () => void;
    readonly restoreAssignmentDetail: (
      classId: string,
      assignmentId: string,
    ) => boolean;
  }) => void;
};

// Sprint 28.6C: class-assignment wiring shared by the class card (count) and
// the class workspace Assignments section. `enabled` is false in harnesses
// with no assignment seam, in which case counts read 0 and the Assignments
// section shows its calm empty state.
type ClassAssignmentsView = {
  readonly enabled: boolean;
  readonly count: (classId: string) => number;
  readonly listRegistry: () => ReadonlyArray<AssignmentDetailMetadata>;
  readonly open: (classId: string, assignmentId: string) => void;
  readonly summaryCallable: AssignmentSummaryCallable | null;
  readonly onGoToCurriculum: (() => void) | null;
};

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
  // Sprint 24B Phase 2: injected dependencies for the primary Import
  // Class from Google Classroom flow. When null the primary control is
  // hidden (the secondary Create LyfeLabz Class entry point still
  // renders). Per SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md §4.2, no new
  // orchestration callable is introduced; this seam bundles the
  // certified callables already wired at the entry point.
  readonly importFromClassroom?: ImportFromClassroomDeps | null;
  // Sprint 24B Phase 2B.4: certified `classesActivate` seam consumed
  // by the imported-class setup form. Null when not wired (test
  // harnesses that do not exercise activation); in that case the setup
  // form still renders but its submit is disabled and the teacher is
  // told to try again in a moment.
  readonly activateClass?: ActivateClass | null;
  // Sprint 24B Phase 2B.8: certified `lmsClassesSyncRoster` seam
  // consumed by the LMS class workspace. The Classes surface uses this
  // seam for two teacher-facing paths:
  //
  //   1. Automatic initial sync fired immediately after a successful
  //      `classesActivate` on an LMS-sourced class. A sync failure at
  //      this stage NEVER unwinds activation and NEVER shows an
  //      activation-failed message. Activation succeeded independently.
  //
  //   2. Manual "Sync roster" action rendered in the class workspace
  //      only for active LMS-linked classes. Duplicate concurrent clicks
  //      are suppressed by the in-flight flag.
  //
  // Null when the callable is not wired (test harnesses that do not
  // exercise roster sync); in that case the button is not rendered and
  // the automatic initial sync is skipped without altering activation
  // behavior.
  readonly syncRoster?: SyncRoster | null;
  // Teacher-controlled Google Classroom roster refresh
  // (`lmsClassesRefreshRoster` with enrollment reconciliation), offered as
  // "Refresh roster from Google Classroom" in Class settings for an active
  // Classroom-linked class. Opening a class NEVER calls it: the existing
  // LyfeLabz roster stays authoritative until the teacher asks for a
  // refresh. Null when not wired (the action is then not offered).
  readonly refreshRoster?: RefreshRoster | null;
  // Sprint 29G.5P: teacher Students-tab roster reader. When wired, the class
  // workspace's Students tab lists the real active canonical enrollments for
  // the class (via `enrollmentsListForClass`). Null in test harnesses that do
  // not exercise the roster; in that case the tab shows its empty state.
  readonly loadRoster?: LoadClassRosterAccessor | null;
  // Sprint 28.6C: the session-scoped teacher assignment-detail seam (the same
  // one Curriculum uses). The Classes surface reads `list()` - already
  // hydrated once from `assignmentsTeacherList`, which carries `classId` - to
  // group per-class assignment counts and to render each class's Assignments
  // section, and calls `open()` to reach the existing Assignment Detail. It
  // never enumerates classes, never fans out per class, and adds no callable.
  // Null in harnesses that do not exercise assignments.
  readonly assignmentDetail?: CurriculumAssignmentDetailSeam | null;
  // Sprint 28.6C: certified `assessmentAssignmentSummary` seam passed through
  // to the class Assignments section for the same per-card progress line
  // Curriculum shows. Optional; when null no progress line is rendered.
  readonly assignmentSummary?: AssignmentSummaryCallable | null;
  // Sprint 28.6C: bounded intra-shell navigation seam. Used to route the empty
  // Assignments state to Curriculum and to return to Classes after Assignment
  // Detail. Null in harnesses that do not exercise those paths.
  readonly navigateToSurface?: ((surface: WorkspaceSurfaceKey) => void) | null;
  // Sprint 28.6C: shell-owned class-workspace return-location seam (see
  // shell.ts). Read once on mount to re-land in the class Assignments section
  // after Assignment Detail; written just before opening Detail.
  readonly getClassesReturn?: (() => ClassWorkspaceReturn | null) | null;
  readonly setClassesReturn?:
    | ((loc: ClassWorkspaceReturn | null) => void)
    | null;
  // Student Progress & Assignment Membership Phase A, Slice 3: shell-owned
  // student-selection intent one-shot (see shell.ts
  // `classesStudentIntent`). Read once on mount to open Student Detail
  // pre-selected, with an assignment-origin `studentDetailOrigin`, when the
  // teacher arrived via an Assignment Detail roster-name click; cleared
  // immediately after consumption. Absent in harnesses that do not
  // exercise that path.
  readonly getClassesStudentIntent?:
    | (() => AssignmentDetailStudentSelection | null)
    | null;
  readonly setClassesStudentIntent?:
    | ((intent: AssignmentDetailStudentSelection | null) => void)
    | null;
  // Sprint 28.6F: class-management intent one-shot (see shell.ts). Read once
  // on mount so a Settings "Import" / "Create" choice opens the matching
  // control here (the SAME workflow the `+ Add a class` entry uses); cleared
  // immediately after consumption. Absent in harnesses that do not exercise it.
  readonly getClassManagementIntent?:
    | (() => ClassManagementIntent | null)
    | null;
  readonly setClassManagementIntent?:
    | ((intent: ClassManagementIntent | null) => void)
    | null;
  // Student Detail V1: lazy accessor for assessmentAttemptsListForClass.
  // Follows the LoadClassRosterAccessor pattern (Sprint 29G.5P) to avoid
  // null-snapshot on router assembly before Functions init.
  readonly loadAttempts?: (() => AttemptsListForClassCallable | null) | null;
  // Student Progress & Assignment Membership Phase A, Slice 4: lazy
  // accessor for the certified `assessmentStudentAssignmentsForClass`
  // callable. Supplies the set of assignments a student is an expected
  // recipient of (independent of whether they have attempted anything) so
  // Student Detail can render In Progress / Not Started cards instead of
  // treating unattempted assigned work as indistinguishable from no work at
  // all. Absent-or-null degrades gracefully: Student Detail still renders
  // exactly the pre-Slice-4 Completed-only view driven by `loadAttempts`.
  readonly loadExpectedAssignments?:
    | (() => AssessmentStudentAssignmentsForClassCallable | null)
    | null;
  // Sprint 30 Show Your Thinking: lazy accessor for the certified
  // `assessmentAttemptGetForTeacher` callable, used only when a teacher opens
  // a Student Detail card's Show Your Thinking disclosure. Absent-or-null
  // renders no disclosure; the rest of Student Detail is unchanged.
  readonly loadAttemptDetail?: (() => AttemptGetForTeacherCallable | null) | null;
  // Sprint 30A.1 human-review finalization: canonical teacher class-order
  // writer. The Classes workspace is now the sole place a teacher edits
  // class order (drag or keyboard, see `renderClassCard`); the Assign
  // dialog only ever displays whatever order `listClasses` hands it. When
  // absent-or-null, reordering still updates the visual order for this
  // mount (a local, in-memory reorder) but is not persisted - the next
  // fresh load reverts to the last-persisted or fallback order.
  readonly updateClassOrder?: UpdateTeacherClassOrder | null;
  // Sprint 30A.1 Class Settings V1. `updateClassMetadata` writes the
  // canonical, teacher-owned `title`/`grade`/`block` fields on
  // `classes/{classId}` through the certified `classesUpdateMetadata`
  // callable - the exact same server-side ownership/validation boundary
  // the Create Class form already uses. This NEVER reaches Google
  // Classroom: those three fields are LyfeLabz-owned even for a
  // Classroom-linked class (the class record has no mirrored provider
  // title at all). `updateClassColor` and `readClassColors` are the
  // teacher-owned presentation-only color accent, a preference kept
  // alongside `classOrder` (see classOrder.ts) rather than on the class
  // record, because a class may be co-taught and a color choice is one
  // teacher's own presentation preference, not a fact about the class.
  // Absent-or-null disables Class Settings' corresponding capability
  // gracefully (see `openClassSettings`); in that case the gear still
  // opens the modal, but the affected field's control is inert.
  readonly updateClassMetadata?: UpdateClassMetadata | null;
  readonly updateClassColor?: UpdateClassColor | null;
  readonly readClassColors?: ReadTeacherClassColors | null;
  // Browser Back/Forward support: shell-owned seam (see
  // StudentDetailHistorySeam above and shell.ts). Absent in harnesses
  // that do not exercise browser-history behavior, in which case Student
  // Detail open/close behaves exactly as before this feature.
  readonly studentDetailHistory?: StudentDetailHistorySeam | null;
};

// Sprint 28.6H (Finding 2): the class-card status label map was removed with
// the Active badge (see renderClassCard). Snapshot/Overview keeps its own
// status labelling where meaningful; the everyday class card no longer repeats
// the class status. Backend class-status semantics are unchanged.

type CreateFormState = {
  readonly title: string;
  readonly grade: string;
  readonly block: string;
  readonly submitting: boolean;
  readonly error: string | null;
};

// Setup form state for the imported-class workspace. Grade and block both
// begin empty; the teacher chooses them for this class before activation
// (Sprint 28.6F removed the teacher-level grade seed, Blueprint §14).
type SetupFormState = {
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
      readonly importState: ImportState;
    }
  | {
      readonly kind: "workspace";
      readonly classes: ReadonlyArray<ClassSummary>;
      readonly selectedId: string;
      readonly tab: ClassWorkspaceTab;
      readonly setupForm: SetupFormState | null;
      readonly selectedStudentId: string | null;
      readonly selectedStudentDisplayName: string | null;
      // Student Progress & Assignment Membership Phase A, Slice 2: the
      // Students-tab roster, captured the moment it is fetched so
      // Previous/Next can walk it without a second fetch. Optional so the
      // ~15 other "workspace" state constructions in this module (tab
      // switches, setup, dialogs) do not need to name a field they never
      // touch; undefined/null both mean "no roster fetched yet in this
      // mount."
      readonly rosterSnapshot?: ReadonlyArray<{
        readonly studentId: string;
        readonly studentDisplayName: string;
      }> | null;
      // Student Progress & Assignment Membership Phase A, Slices 2-3: how
      // Student Detail was entered, established once at entry and preserved
      // unchanged by Previous/Next (REQUIRED correction to the approved
      // spec: neighbor navigation must never reset this). "roster" is the
      // Students-tab click path (Back returns to the Students list); the
      // assignment-origin variant (Slice 3) is the Assignment Detail
      // roster-name click path (Back returns to that exact assignment).
      // Optional for the same reason as `rosterSnapshot`; meaningful only
      // while `selectedStudentId` is non-null.
      readonly studentDetailOrigin?:
        | "roster"
        | { readonly kind: "assignment"; readonly assignmentId: string };
    };

// Grade/block always begin empty; the teacher must choose explicitly for
// every class. Sprint 28.6F removed the global teacher `defaultGrade`
// preference that previously seeded these (Blueprint §14): a class derives
// its grade only from its own create/setup flow, never from a teacher-level
// default. There is no `defaultBlock` at any layer (ADR §12).
const emptyForm = (): CreateFormState =>
  Object.freeze({
    title: "",
    grade: "",
    block: "",
    submitting: false,
    error: null,
  });

const emptySetupForm = (): SetupFormState =>
  Object.freeze({
    grade: "",
    block: "",
    submitting: false,
    error: null,
  });

export function renderClassesSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: ClassesSurfaceDeps,
): void {
  const doc = mount.ownerDocument;
  // Sprint 28.6H.3 (Task B1): `deps.snapshotPreview` is dormant (Overview
  // removed); it is intentionally not read here anymore.
  const createClass = deps.createClass ?? null;
  const importDeps = deps.importFromClassroom ?? null;
  const activateClass = deps.activateClass ?? null;
  const syncRoster = deps.syncRoster ?? null;
  const refreshRoster = deps.refreshRoster ?? null;
  const loadRoster = deps.loadRoster ?? null;
  const loadAttempts = deps.loadAttempts ?? null;
  const loadExpectedAssignments = deps.loadExpectedAssignments ?? null;
  const loadAttemptDetail = deps.loadAttemptDetail ?? null;
  const assignmentDetail = deps.assignmentDetail ?? null;
  const assignmentSummary = deps.assignmentSummary ?? null;
  const navigateToSurface = deps.navigateToSurface ?? null;
  const studentDetailHistory = deps.studentDetailHistory ?? null;
  const getClassesReturn = deps.getClassesReturn ?? null;
  const setClassesReturn = deps.setClassesReturn ?? null;
  const getClassesStudentIntent = deps.getClassesStudentIntent ?? null;
  const setClassesStudentIntent = deps.setClassesStudentIntent ?? null;
  const getClassManagementIntent = deps.getClassManagementIntent ?? null;
  const setClassManagementIntent = deps.setClassManagementIntent ?? null;
  const updateClassOrder = deps.updateClassOrder ?? null;
  const updateClassMetadata = deps.updateClassMetadata ?? null;
  const updateClassColor = deps.updateClassColor ?? null;
  const readClassColors = deps.readClassColors ?? null;

  // Sprint 28.6C: the whole-teacher assignment registry, already hydrated once
  // from `assignmentsTeacherList` (which carries `classId`). Reading it is a
  // pure in-memory grouping - never a per-class call, never an N+1 read.
  const listAllAssignments = (): ReadonlyArray<AssignmentDetailMetadata> =>
    assignmentDetail?.list?.() ?? [];

  // Sprint 28.6C: the count shown on a class card is exactly the set of
  // assignments reachable through that class's Assignments section - published
  // and closed (drafts are never surfaced). Same predicate the class
  // Assignments section applies, so the card count and the section can never
  // disagree, and another class's assignments can never inflate it.
  const countClassAssignments = (classId: string): number => {
    let n = 0;
    for (const meta of listAllAssignments()) {
      if (meta.classId === classId && isRenderableCard(meta)) n += 1;
    }
    return n;
  };

  // Sprint 28.6C: open the existing Assignment Detail from the class-centered
  // workflow. Records the return location on the shell so the Back control (and
  // returning nav) re-lands in this class's Assignments section rather than
  // stranding the teacher in Curriculum; supplies a "Back to class" label. When
  // the seam is absent (harness) the row action is simply inert.
  //
  // Browser Back/Forward: opening Summary pushes its own history entry (above
  // the class's Assignments entry), unless this call is itself a history
  // restore. The in-app "Back to class" hands the return to the shell, which
  // re-lands on the class's Assignments section and REPLACES the Summary
  // entry (the certified replace-never-back() pattern).
  const openClassAssignment = (
    classId: string,
    assignmentId: string,
    opts?: { readonly fromHistory?: boolean },
  ): void => {
    if (assignmentDetail === null) return;
    setClassesReturn?.({ classId, tab: "assignments" });
    const options: AssignmentDetailOpenOptions = {
      backLabel: "Back to class",
      onBack: () => {
        if (studentDetailHistory !== null) {
          studentDetailHistory.notify({ kind: "exit-assignment-detail", classId });
          return;
        }
        navigateToSurface?.("classes");
      },
    };
    assignmentDetail.open(assignmentId, options);
    if (opts?.fromHistory !== true) {
      studentDetailHistory?.notify({
        kind: "enter-assignment-detail",
        classId,
        assignmentId,
      });
    }
  };

  // Sprint 28.6C: the single bundle of class-assignment wiring threaded to the
  // class card (count) and the class workspace (Assignments section). Grouping
  // it keeps the two renderers' signatures from growing per field.
  const assignmentsView: ClassAssignmentsView = {
    enabled: assignmentDetail !== null,
    count: countClassAssignments,
    listRegistry: listAllAssignments,
    open: openClassAssignment,
    summaryCallable: assignmentSummary,
    onGoToCurriculum:
      navigateToSurface !== null ? () => navigateToSurface("curriculum") : null,
  };

  // Sprint 24B Phase 2B.8. Per-class roster-sync UI state. Ephemeral to
  // this surface mount; not persisted to Firestore. Keyed by classId.
  // Distinct from the class-lifecycle state machine so a roster-sync
  // failure never corrupts the workspace state model.
  //
  // Duplicate-request protection: an in-flight request sets status to
  // "syncing" for that classId. Any second automatic or manual trigger
  // for the same class checks the map and refuses to issue a second
  // request while one is in flight.
  type RosterSyncEntry =
    | { readonly status: "idle" }
    | { readonly status: "syncing" }
    | { readonly status: "ok"; readonly counters: SyncRosterCounters; readonly at: number }
    | {
        readonly status: "error";
        readonly kind: SyncRosterError["kind"];
        readonly at: number;
      };
  const rosterSyncByClass: Map<string, RosterSyncEntry> = new Map();

  // Students-tab roster for the CURRENTLY OPEN class only (at most one entry,
  // in memory, for this mount's lifetime - never persisted, never one per
  // class). Opening a class starts a fresh fetch in the background, without
  // blocking the Assignments view, so switching to Students normally renders
  // the already-resolved roster with no loading state; switching tabs never
  // refetches. Freshness boundaries: every class open fetches anew (the read
  // starts immediately and never waits on Google Classroom), leaving for the
  // Classes list drops the entry, a roster sync or a teacher's manual
  // Classroom refresh invalidates it, and a failed fetch is never kept - the
  // next Students visit retries. A response for a class that is no longer
  // the open one is discarded. Authorization is entirely server-side
  // (`enrollmentsListForClass`); this only decides WHEN the read happens.
  type RosterEntry =
    | { readonly classId: string; readonly status: "pending"; readonly promise: Promise<RosterStudents> }
    | { readonly classId: string; readonly status: "ready"; readonly students: RosterStudents }
    | { readonly classId: string; readonly status: "error" };
  let currentRoster: RosterEntry | null = null;

  const startClassRosterFetch = (classId: string): RosterEntry | null => {
    const loader = loadRoster?.() ?? null;
    if (loader === null) return null;
    const promise = loader({ classId }).then((result) => result.students);
    const entry: RosterEntry = { classId, status: "pending", promise };
    currentRoster = entry;
    promise.then(
      (students) => {
        if (currentRoster !== entry) return; // superseded (class changed/left)
        currentRoster = { classId, status: "ready", students };
        const hadSnapshot =
          state.kind === "workspace" && state.selectedId === classId && state.rosterSnapshot;
        onRosterLoaded(classId, students);
        // Student Detail opened before the roster resolved (e.g. from an
        // Assignment Summary name link) shows Previous/Next once it arrives.
        if (
          !hadSnapshot &&
          state.kind === "workspace" &&
          state.selectedId === classId &&
          state.selectedStudentId !== null
        ) {
          rerender();
        }
      },
      () => {
        if (currentRoster === entry) currentRoster = { classId, status: "error" };
      },
    );
    return entry;
  };

  // Returns the open class's roster entry, starting a fetch when there is
  // none for this class (or, when `retryError`, when the last fetch failed).
  const ensureClassRoster = (
    classId: string,
    retryError: boolean,
  ): RosterEntry | null => {
    if (
      currentRoster !== null &&
      currentRoster.classId === classId &&
      (currentRoster.status !== "error" || !retryError)
    ) {
      return currentRoster;
    }
    return startClassRosterFetch(classId);
  };

  // Class-wide completed attempts for the CURRENTLY OPEN class only (at most
  // one entry, in memory, never persisted). `assessmentAttemptsListForClass`
  // is class-scoped and identical for every student, so Student Detail
  // reuses one read across Previous/Next instead of re-fetching it per
  // student. It starts when the Students section is shown (ahead of the first
  // student click) and is reused until the class session ends: opening a
  // class or returning to the Classes list drops it, a request for a
  // different class replaces it, and a failed read is never kept (the next
  // Student Detail retries). Authorization is entirely server-side; this
  // only decides WHEN the existing class-scoped read happens.
  type ClassAttemptsEntry = {
    readonly classId: string;
    readonly promise: Promise<ReadonlyArray<CompletedAttemptSummary>>;
  };
  let currentClassAttempts: ClassAttemptsEntry | null = null;

  const ensureClassAttempts = (
    classId: string,
  ): Promise<ReadonlyArray<CompletedAttemptSummary>> | null => {
    if (currentClassAttempts !== null && currentClassAttempts.classId === classId) {
      return currentClassAttempts.promise;
    }
    const callable = loadAttempts?.() ?? null;
    if (callable === null) return null;
    const promise = callable({ classId }).then((result) => result.attempts);
    const entry: ClassAttemptsEntry = { classId, promise };
    currentClassAttempts = entry;
    promise.catch(() => {
      if (currentClassAttempts === entry) currentClassAttempts = null;
    });
    return promise;
  };

  // Sprint 28.6H (Finding 1): whether the minimized "+ Add class" disclosure is
  // revealed in a populated Classes list. Closure-scoped (not part of the
  // discriminated state) so it survives every list-state reconstruction the
  // import/create flow performs; the discriminated state rebuilds would
  // otherwise drop it and snap the panel shut mid-workflow. Ignored in the
  // zero-class state, where the Import / Create workflow is always prominent.
  // Sprint 28.6H.6 (Part F/G): which class-source TASK the teacher chose, so the
  // routed task surface shows ONLY that task (create form OR Google Classroom
  // import), never the alternative path. Set from the one-shot Settings intent
  // and from an in-surface Create/Import choice; cleared when a task is
  // cancelled. `null` means the (zero-class) decision surface, which offers both.
  let listAddMode: ClassManagementIntent | null = null;

  const getRosterSyncEntry = (classId: string): RosterSyncEntry =>
    rosterSyncByClass.get(classId) ?? { status: "idle" };

  const isSyncInFlight = (classId: string): boolean =>
    getRosterSyncEntry(classId).status === "syncing";

  // Sprint 28.6H.3 (Task B3/C4): the automatic post-activation roster sync for
  // a newly-activated LMS-linked class is preserved (backend behavior
  // unchanged). Its manual counterpart and status panel moved to Settings →
  // Class Management; the class workspace no longer renders roster-sync UI.
  const runRosterSync = (classId: string): void => {
    if (syncRoster === null) return;
    if (isSyncInFlight(classId)) return;
    rosterSyncByClass.set(classId, { status: "syncing" });
    rerender();
    void syncRoster({ classId })
      .then((result) => {
        if (!mount.isConnected) return;
        const counters: SyncRosterCounters = {
          added: result.added,
          reactivated: result.reactivated,
          unchanged: result.unchanged,
          withdrawn: result.withdrawn,
          unresolved: result.unresolved,
          skipped: result.skipped,
          upstreamRosterEmpty: result.upstreamRosterEmpty,
        };
        rosterSyncByClass.set(classId, {
          status: "ok",
          counters,
          at: Date.now(),
        });
        // The class's membership just changed: a held roster is stale.
        if (currentRoster?.classId === classId) currentRoster = null;
        rerender();
      })
      .catch((err: unknown) => {
        if (!mount.isConnected) return;
        // syncRoster wrapper always throws a SyncRosterError; if
        // something else reaches this catch, coerce to "unknown".
        const kind: SyncRosterError["kind"] =
          err && typeof err === "object" && "kind" in err &&
          typeof (err as { kind?: unknown }).kind === "string"
            ? ((err as { kind: SyncRosterError["kind"] }).kind)
            : "unknown";
        rosterSyncByClass.set(classId, {
          status: "error",
          kind,
          at: Date.now(),
        });
        rerender();
      });
  };

  let state: ClassesState = { kind: "loading" };
  let importController: ImportController | null = null;
  // Sprint 30A.1 human-review finalization: class-card reorder state.
  // `draggedClassId` is only meaningful between a card's `dragstart` and
  // its `drop`; `classOrderError` is a small, non-blocking notice shown
  // when the last reorder failed to persist (the visual order itself is
  // never rolled back - see `persistClassOrder`).
  let draggedClassId: string | null = null;
  let classOrderError: string | null = null;
  // Sprint 30A.1 Class Settings V1. The teacher's own per-class color
  // accents, loaded once alongside the class list (see the `listClasses`
  // load below) and kept in this closure so a save can update just the
  // one changed entry without a full reload. Absent id = no color.
  let classColors: Readonly<Record<string, ClassColorToken>> = {};
  // The currently-open Class Settings overlay, if any. Appended to
  // `doc.body` directly (outside `mount`, mirroring the Assign dialog
  // pattern) so `rerender()`'s `mount.textContent = ""` never disturbs
  // it while it's open.
  let settingsOverlay: HTMLElement | null = null;

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
          s.form,
          s.lastCreated,
          onStartCreate,
          onCancelCreate,
          onFormChange,
          onSubmitCreate,
          onDismissLastCreated,
          importDeps !== null && createClass !== null,
          s.importState,
          onStartImport,
          onSelectImportCourse,
          onCancelImport,
          onRetryImport,
          onOpenClass,
          listAddMode,
          navigateToSurface !== null
            ? () => navigateToSurface("settings")
            : null,
          onCardDragStart,
          onCardDrop,
          onCardMove,
          classOrderError,
          openClassSettings,
          classColors,
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
            importState: idleImportState(),
          };
          rerender();
          return;
        }
        // Students-tab roster: served from the open class's in-memory entry;
        // a failed fetch is retried only when Students is actually shown.
        let rosterView: RosterView = { kind: "unwired" };
        if (loadRoster !== null) {
          const entry =
            summary.status === "active"
              ? ensureClassRoster(
                  summary.id,
                  s.tab === "roster" && s.selectedStudentId === null,
                )
              : null;
          rosterView =
            entry === null || entry.status === "error"
              ? { kind: "notReady" }
              : entry.status === "ready"
                ? { kind: "ready", students: entry.students }
                : { kind: "pending", promise: entry.promise };
        }
        // Student Detail's class-wide attempts: start reading them as soon as
        // the Students section is shown (one read per class session, never
        // one per student), so the first student click reuses it.
        if (loadAttempts !== null && s.tab === "roster" && summary.status === "active") {
          void ensureClassAttempts(summary.id);
        }
        const classAttempts =
          loadAttempts === null ? null : () => ensureClassAttempts(summary.id);
        renderClassWorkspaceState(
          doc,
          mount,
          summary,
          s.tab,
          onSelectTab,
          onBackToList,
          s.setupForm,
          onSetupFormChange,
          onSubmitSetup,
          onCancelSetup,
          activateClass !== null,
          assignmentsView,
          rosterView,
          s.selectedStudentId,
          s.selectedStudentDisplayName,
          s.rosterSnapshot ?? null,
          s.studentDetailOrigin ?? "roster",
          onSelectStudent,
          onBackFromStudent,
          onNavigateToNeighbor,
          classAttempts,
          loadExpectedAssignments,
          listAllAssignments,
          loadAttemptDetail,
        );
        return;
      }
    }
  };

  const idleImportState = (): ImportState =>
    Object.freeze({ kind: "idle" as const });

  // Sprint 30A.1 human-review finalization: class-card reordering. Moved
  // here from the Assign dialog (see curriculum.ts's root-cause comment on
  // `renderRow`) - reordering is edited ONLY on Classes now, and used
  // everywhere the canonical ordered class list is read, Assign included.
  //
  // Persistence failure handling is intentionally different from Assign's
  // old best-effort/silent approach: the visual reorder is never rolled
  // back (an unpredictable revert would be more confusing than a stale
  // save), but a failed save now surfaces a small, dismissible-by-retry
  // notice rather than claiming success silently. The canonical Firestore
  // preference is simply left unchanged by a failed write - the next
  // successful reorder (or a fresh load elsewhere) is unaffected.
  const persistClassOrder = (orderedIds: readonly string[]): void => {
    if (!updateClassOrder) return;
    void updateClassOrder(orderedIds)
      .then(() => {
        if (classOrderError !== null) {
          classOrderError = null;
          rerender();
        }
      })
      .catch(() => {
        classOrderError =
          "Couldn't save the new class order. Try reordering again.";
        rerender();
      });
  };

  const reorderClasses = (id: string, beforeId: string | null): void => {
    if (state.kind !== "list") return;
    const orderedIds = state.classes.map((c) => c.id);
    const nextIds = moveClassId(orderedIds, id, beforeId);
    if (nextIds === orderedIds) return;
    const byId = new Map(state.classes.map((c) => [c.id, c] as const));
    const nextClasses = nextIds
      .map((cid) => byId.get(cid))
      .filter((c): c is ClassSummary => c !== undefined);
    state = { ...state, classes: nextClasses };
    rerender();
    persistClassOrder(nextIds);
  };

  const onCardDragStart = (id: string): void => {
    draggedClassId = id;
  };

  const onCardDrop = (id: string): void => {
    if (draggedClassId && draggedClassId !== id) {
      reorderClasses(draggedClassId, id);
    }
    draggedClassId = null;
  };

  // Grid reading order (human review): the canonical order is a single
  // linear list; ArrowLeft/ArrowRight move a card one position earlier/
  // later in that list, matching how a multi-column grid's reading order
  // (left-to-right, then top-to-bottom) already renders it - a card at
  // the end of a row moves to the start of the next, and vice versa. The
  // responsive column count never changes the underlying linear order.
  const onCardMove = (id: string, direction: -1 | 1): void => {
    if (state.kind !== "list") return;
    const orderedIds = state.classes.map((c) => c.id);
    const idx = orderedIds.indexOf(id);
    const targetIdx = idx + direction;
    if (idx === -1 || targetIdx < 0 || targetIdx >= orderedIds.length) return;
    const beforeId =
      direction === -1 ? orderedIds[targetIdx] : (orderedIds[targetIdx + 1] ?? null);
    reorderClasses(id, beforeId);
    // Keep keyboard focus on the same card's handle after it moves (the
    // rerender above rebuilds the DOM synchronously, so the new handle
    // already exists by the time this runs).
    doc
      .querySelector<HTMLButtonElement>(`[data-testid=class-card-drag-${id}]`)
      ?.focus();
  };

  // Sprint 30A.1 Class Settings V1. The overlay is appended to
  // `doc.body` directly (mirroring the Assign dialog pattern) so it is
  // unaffected by this surface's own `rerender()` wipe-and-rebuild cycle.
  const closeClassSettings = (): void => {
    if (settingsOverlay?.parentNode) {
      settingsOverlay.parentNode.removeChild(settingsOverlay);
    }
    settingsOverlay = null;
  };

  const openClassSettings = (classId: string): void => {
    if (state.kind !== "list") return;
    const summary = state.classes.find((c) => c.id === classId);
    if (!summary || summary.status !== "active") return;
    closeClassSettings();

    settingsOverlay = renderClassSettingsModal(doc, summary, classColors[classId] ?? null, {
      canEditMetadata: updateClassMetadata !== null,
      canEditColor: updateClassColor !== null,
      // Teacher-controlled Classroom roster refresh: only for an active
      // class linked to Google Classroom (never a LyfeLabz-native class).
      refreshRoster:
        refreshRoster !== null && summary.isLmsLinked === true
          ? () => refreshRoster({ classId, reconcileEnrollments: true })
          : null,
      // The class's enrollments may have changed: a held roster for it is
      // stale, so the next Students view reads it again.
      onRosterRefreshed: () => {
        if (currentRoster?.classId === classId) currentRoster = null;
      },
      onCancel: closeClassSettings,
      // Resolving closes the modal (handled here, not by the modal
      // itself, since only this closure can update `state`/`classColors`
      // and call `rerender()`); rejecting leaves the modal open with the
      // thrown message shown inline - see the modal's own catch.
      onSave: async (patch) => {
        if (
          updateClassMetadata &&
          (patch.title !== undefined ||
            patch.grade !== undefined ||
            patch.block !== undefined)
        ) {
          await updateClassMetadata({
            classId,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
            ...(patch.block !== undefined ? { block: patch.block } : {}),
          });
        }
        if (updateClassColor && patch.color !== undefined) {
          await updateClassColor(classId, patch.color);
        }

        // Both writes (if any) succeeded - apply them locally so the
        // card reflects the change immediately, without a full reload.
        // Canonical class ORDER is untouched: this only replaces one
        // array element's fields in place, never the array's order.
        if (state.kind === "list") {
          const idx = state.classes.findIndex((c) => c.id === classId);
          if (idx !== -1) {
            const existing = state.classes[idx];
            if (existing.status === "active") {
              const updated: ClassSummary = {
                ...existing,
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
                ...(patch.block !== undefined ? { block: patch.block } : {}),
              };
              const nextClasses = state.classes.slice();
              nextClasses[idx] = updated;
              state = { ...state, classes: nextClasses };
            }
          }
        }
        if (patch.color !== undefined) {
          const nextColors: Record<string, ClassColorToken> = {
            ...classColors,
          };
          if (patch.color === "none") {
            delete nextColors[classId];
          } else {
            nextColors[classId] = patch.color;
          }
          classColors = Object.freeze(nextColors);
        }

        closeClassSettings();
        rerender();
      },
    });
    doc.body.appendChild(settingsOverlay);
  };

  const onOpenClass = (classId: string): void => {
    if (state.kind !== "list") return;
    // Opening a class leaves any focused class-source task.
    listAddMode = null;
    const summary = state.classes.find((c) => c.id === classId);
    // Phase 2B.4: a needsSetup class opens directly on the setup form.
    // Assignments and Students are unreachable until activation completes.
    const isNeedsSetup = summary?.status === "needsSetup";
    // Sprint 28.6H.3 (Task B2): an active class opens directly on Assignments
    // ("what is happening with my students" is the everyday question), not the
    // removed Overview. Overview/Snapshot is no longer a reachable tab.
    // Opening a class makes NO Google Classroom call: Classroom roster
    // synchronization is teacher-controlled (Class settings > Refresh roster
    // from Google Classroom). The existing LyfeLabz roster for THIS class is
    // read immediately, in the background (never blocking the Assignments
    // view), and every class open reads it anew.
    // Each class open is a fresh class session for Student Detail's
    // class-wide attempts too (read again when Students is next shown).
    currentClassAttempts = null;
    if (summary?.status === "active") {
      startClassRosterFetch(classId);
    }
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: classId,
      tab: isNeedsSetup ? "setup" : "assignments",
      setupForm: isNeedsSetup ? emptySetupForm() : null,
      selectedStudentId: null,
      selectedStudentDisplayName: null,
    };
    rerender();
    // Browser Back/Forward: opening a class is a real drill-down, so its
    // landing section gets its own entry (Back returns to the Classes list).
    studentDetailHistory?.notify({
      kind: "enter-workspace",
      classId,
      section: isNeedsSetup ? "setup" : "assignments",
    });
  };

  const onStartCreate = (): void => {
    if (state.kind !== "list") return;
    // Sprint 28.6H.6 (Part F): entering the focused manual-create task.
    listAddMode = "create";
    state = {
      kind: "list",
      classes: state.classes,
      form: emptyForm(),
      lastCreated: null,
      importState: state.importState,
    };
    rerender();
  };

  const onCancelCreate = (): void => {
    if (state.kind !== "list") return;
    // Sprint 28.6H.6 (Part F5): Cancel returns to the Settings -> Class
    // Management decision surface (the administrative home for choosing a class
    // source) when the surface-navigation seam is wired; the create draft is
    // cleared either way. Without the seam (some harnesses) it falls back to the
    // in-Classes decision state.
    listAddMode = null;
    state = {
      kind: "list",
      classes: state.classes,
      form: null,
      lastCreated: state.lastCreated,
      importState: state.importState,
    };
    if (navigateToSurface !== null) {
      navigateToSurface("settings");
      return;
    }
    rerender();
  };

  const onFormChange = (patch: Partial<CreateFormState>): void => {
    if (state.kind !== "list" || state.form === null) return;
    state = {
      kind: "list",
      classes: state.classes,
      form: Object.freeze({ ...state.form, ...patch }),
      lastCreated: state.lastCreated,
      importState: state.importState,
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
      importState: state.importState,
    };
    rerender();
  };

  const updateImportState = (next: ImportState): void => {
    if (next.kind === "linked") {
      // Sprint 25 (B2): the import created a new class server-side.
      // Invalidate the Curriculum class cache unconditionally (before the
      // surface-state guard) so a later Assign open re-fetches and can
      // see the imported class.
      invalidateCurriculumClassCache();
    }
    if (state.kind !== "list") return;
    state = {
      kind: "list",
      classes: state.classes,
      form: state.form,
      lastCreated: state.lastCreated,
      importState: next,
    };
    rerender();
    if (next.kind === "linked") {
      // Sprint 28.6H.8: the import succeeded - leave the focused import task so
      // a later return to the list shows the operational landing, not the task.
      listAddMode = null;
      const targetClassId = next.classId;
      // Phase 2B.4: the linked class is a `needsSetup` class. Refresh
      // the list so the new row is present, then open the workspace
      // directly on the setup form. Snapshot / Roster remain
      // unreachable until activation completes.
      void deps
        .listClasses(session.uid)
        .then((classes) => {
          if (!mount.isConnected) return;
          if (state.kind !== "list") return;
          state = {
            kind: "workspace",
            classes,
            selectedId: targetClassId,
            tab: "setup",
            setupForm: emptySetupForm(),
            selectedStudentId: null,
            selectedStudentDisplayName: null,
          };
          rerender();
        })
        .catch(() => {
          if (!mount.isConnected) return;
          if (state.kind !== "list") return;
          // Best-effort: if the refresh fails the teacher can still
          // finish setup from the Classes list on the next visit
          // through the Finish setup affordance.
        });
    }
  };

  const ensureImportController = (): ImportController | null => {
    if (importDeps === null || createClass === null) return null;
    if (importController !== null) return importController;
    importController = createImportFromClassroom(importDeps, (next) =>
      updateImportState(next),
    );
    return importController;
  };

  const onStartImport = (): void => {
    const controller = ensureImportController();
    if (controller === null) return;
    // Sprint 28.6H.6 (Part G): entering the focused Google Classroom import task.
    listAddMode = "import";
    void controller.start();
  };

  const onSelectImportCourse = (course: IntegrationsLmsClass): void => {
    if (importController === null) return;
    void importController.selectCourse(course);
  };

  const onCancelImport = (): void => {
    // Sprint 28.6H.6 (Part G): leaving the focused import task returns to the
    // Settings -> Class Management decision surface (symmetric with create).
    // The in-flight import controller is still aborted first so no OAuth/import
    // work is left running; existing import semantics are unchanged.
    listAddMode = null;
    if (importController !== null) {
      importController.cancel();
    } else if (state.kind === "list") {
      state = {
        kind: "list",
        classes: state.classes,
        form: state.form,
        lastCreated: state.lastCreated,
        importState: idleImportState(),
      };
    }
    if (navigateToSurface !== null) {
      navigateToSurface("settings");
      return;
    }
    rerender();
  };

  const onRetryImport = (): void => {
    if (importController === null) return;
    void importController.retry();
  };

  const currentImportState = (): ImportState =>
    state.kind === "list" ? state.importState : idleImportState();

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
        importState: state.importState,
      };
      rerender();
      return;
    }
    // Phase 2B.4: require explicit grade selection. Grade "" (no
    // selection) rejects; only 6/7/8 pass. This retires the pre-Phase
    // 2B.4 hard-coded fallback to Grade 7 that Manual Create silently
    // applied when no preference existed.
    if (!isTeacherDefaultGrade(grade)) {
      state = {
        kind: "list",
        classes: state.classes,
        form: Object.freeze({
          ...form,
          error: "Choose a grade for this class.",
        }),
        lastCreated: state.lastCreated,
        importState: state.importState,
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
          error: "Choose a class block (A through G).",
        }),
        lastCreated: state.lastCreated,
        importState: state.importState,
      };
      rerender();
      return;
    }
    state = {
      kind: "list",
      classes: state.classes,
      form: Object.freeze({ ...form, submitting: true, error: null }),
      lastCreated: state.lastCreated,
      importState: state.importState,
    };
    rerender();
    void createClass({ title, grade, block })
      .then((result) => {
        // Sprint 25 (B2): a class was created server-side. Invalidate the
        // Curriculum class cache before the mount-connection guard so a
        // later Assign open re-fetches and can see it even if the teacher
        // has already navigated away from the Classes surface.
        invalidateCurriculumClassCache();
        if (!mount.isConnected) return;
        // Sprint 28.6H.8: the create succeeded - leave the focused create task
        // so the operational landing (with the new class + its join code)
        // renders, not the task surface.
        listAddMode = null;
        void deps
          .listClasses(session.uid)
          .then((classes) => {
            if (!mount.isConnected) return;
            state = {
              kind: "list",
              classes,
              form: null,
              lastCreated: result,
              importState: currentImportState(),
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
              importState: currentImportState(),
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
          importState: state.importState,
        };
        rerender();
      });
  };

  const onSelectTab = (tab: ClassWorkspaceTab): void => {
    if (state.kind !== "workspace") return;
    if (state.tab === tab) return;
    const classId = state.selectedId;
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: state.selectedId,
      tab,
      setupForm: tab === "setup" ? (state.setupForm ?? emptySetupForm()) : null,
      selectedStudentId: null,
      selectedStudentDisplayName: null,
      // Same class: the already-loaded roster stays available for Student
      // Detail's Previous/Next (the Students view itself reads the roster
      // entry, so switching tabs never refetches).
      rosterSnapshot: state.rosterSnapshot,
    };
    rerender();
    // Browser Back/Forward: every class section is its own history entry
    // (see StudentDetailHistorySeam), so switching Assignments <-> Students
    // is reversible with Back/Forward. The retired Overview key is not a
    // section and is never pushed.
    if (tab === "assignments" || tab === "roster" || tab === "setup") {
      studentDetailHistory?.notify({ kind: "enter-workspace", classId, section: tab });
    }
  };

  const onSelectStudent = (studentId: string, displayName: string): void => {
    if (state.kind !== "workspace") return;
    const classId = state.selectedId;
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: state.selectedId,
      tab: state.tab,
      setupForm: state.setupForm,
      selectedStudentId: studentId,
      selectedStudentDisplayName: displayName,
      rosterSnapshot: state.rosterSnapshot,
      studentDetailOrigin: "roster",
    };
    rerender();
    // Browser Back/Forward support: only the plain Students-list entry
    // point (this function) is tracked in history. The assignment-origin
    // pre-selection consumed from `classesStudentIntent` on mount is
    // deliberately excluded (see StudentDetailHistorySeam) - reconstructing
    // that cross-surface Assignment Detail context from a URL is out of
    // scope for this patch, so it keeps its pre-existing, non-history
    // behavior unchanged.
    studentDetailHistory?.notify({ kind: "enter-detail", classId, studentId });
  };

  // Student Progress & Assignment Membership Phase A, Slice 2: Previous /
  // Next selection. Distinct from `onSelectStudent` (the Students-list
  // entry point) because it must NOT establish a fresh "roster" origin -
  // the required correction to the approved spec is that neighbor
  // navigation preserves whatever origin Student Detail was already
  // entered with, so "Back" keeps resolving to the same place (the plain
  // Students list, or the originating Assignment Detail) regardless of how
  // many times the teacher clicks Previous/Next in between.
  const onNavigateToNeighbor = (
    studentId: string,
    displayName: string,
  ): void => {
    if (state.kind !== "workspace") return;
    const classId = state.selectedId;
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: state.selectedId,
      tab: state.tab,
      setupForm: state.setupForm,
      selectedStudentId: studentId,
      selectedStudentDisplayName: displayName,
      rosterSnapshot: state.rosterSnapshot,
      studentDetailOrigin: state.studentDetailOrigin,
    };
    rerender();
    // Browser Back/Forward support: Previous/Next is real navigation to a
    // different student, not a mere re-render of the same view, so it
    // earns its own history entry exactly like the initial roster-click
    // selection - the teacher can Back/Forward through A -> B -> C the
    // same way they would through any other meaningful navigation.
    studentDetailHistory?.notify({ kind: "enter-detail", classId, studentId });
  };

  // Student Progress & Assignment Membership Phase A, Slice 2: captures the
  // Students-tab roster the moment it resolves, so Previous/Next can walk
  // it without a second fetch. Deliberately does NOT call `rerender()` -
  // this fires from inside `renderRosterSurface`'s own async resolution,
  // which has already rendered the list itself; this is a silent
  // background state capture, not a visible transition.
  const onRosterLoaded = (classId: string, students: RosterStudents): void => {
    // Only the class the roster belongs to may receive it (a late response
    // for a previously open class must never become this class's roster).
    if (state.kind !== "workspace" || state.selectedId !== classId) return;
    state = { ...state, rosterSnapshot: students };
  };

  const onBackFromStudent = (): void => {
    if (state.kind !== "workspace") return;
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: state.selectedId,
      tab: state.tab,
      setupForm: state.setupForm,
      selectedStudentId: null,
      selectedStudentDisplayName: null,
      // Browser Back/Forward support: previously omitted (both fields
      // reverted to undefined on every Back-to-Students). Preserving the
      // already-fetched roster snapshot here is required for `restoreDetail`
      // (below) to resolve a display name after a Forward navigation
      // without a second fetch; it was never observably wrong before since
      // nothing read `rosterSnapshot` while Detail was closed.
      rosterSnapshot: state.rosterSnapshot,
    };
    rerender();
    // Browser Back/Forward support: keeps the URL/history entry in sync
    // with what is now on screen whether this ran from the in-app "Back to
    // Students" click or from the shell's popstate restore path (see
    // shell.ts `restoreList`). Uses replace, never `history.back()` - see
    // StudentDetailHistorySeam and shell.ts for why a blind `back()` here
    // would be unsafe for the excluded assignment-origin case.
    studentDetailHistory?.notify({ kind: "exit-detail" });
  };

  const onBackToList = (): void => {
    if (state.kind !== "workspace") return;
    // Returning to the operational Classes landing leaves any class-source task.
    listAddMode = null;
    currentRoster = null;
    currentClassAttempts = null;
    state = {
      kind: "list",
      classes: state.classes,
      form: null,
      lastCreated: null,
      importState: idleImportState(),
    };
    rerender();
    // Browser Back/Forward support: mirrors `onBackFromStudent`'s exit
    // notify one level up - keeps history in sync with the flat Classes
    // list whether this ran from the in-app control or a popstate restore.
    studentDetailHistory?.notify({ kind: "exit-workspace" });
  };

  // Browser Back/Forward support: registered once, synchronously, for the
  // lifetime of this mount. `restoreDetail` re-derives the display name
  // from the already-fetched roster snapshot rather than trusting any
  // value carried in history state (only stable ids ever leave this
  // module - see StudentDetailHistorySeam) and fails closed (returns
  // false, changes nothing) if the requested class is not the one
  // currently open or the student cannot be found in the last-loaded
  // roster. `restoreList` is a safe no-op unless Detail is actually open.
  studentDetailHistory?.registerController({
    // Fails closed (returns false, changes nothing) if the requested
    // class is not one the roster list knows about - the same
    // stale/unauthorized-safe posture as `restoreDetail` below, extended
    // one level up the chain.
    // `section` defaults to Students (roster) for entries recorded before
    // per-section history. A needsSetup class can only show Setup; an
    // active class never restores into Setup.
    restoreWorkspace: (classId, section = "roster") => {
      if (state.kind !== "list" && state.kind !== "workspace") return false;
      const classes = state.classes;
      const summary = classes.find((c) => c.id === classId);
      if (!summary) return false;
      const tab: ClassWorkspaceTab =
        summary.status === "needsSetup"
          ? "setup"
          : section === "setup"
            ? "assignments"
            : section;
      if (
        state.kind === "workspace" &&
        state.selectedId === classId &&
        state.tab === tab &&
        state.selectedStudentId === null
      ) {
        return true; // Already exactly here; avoid a redundant re-render/refetch.
      }
      listAddMode = null;
      state = {
        kind: "workspace",
        classes,
        selectedId: classId,
        tab,
        setupForm:
          tab === "setup"
            ? (state.kind === "workspace" && state.selectedId === classId
                ? state.setupForm
                : null) ?? emptySetupForm()
            : null,
        selectedStudentId: null,
        selectedStudentDisplayName: null,
        rosterSnapshot:
          state.kind === "workspace" && state.selectedId === classId
            ? state.rosterSnapshot
            : undefined,
      };
      rerender();
      return true;
    },
    restoreToTopList: () => {
      if (state.kind !== "workspace") return;
      listAddMode = null;
      currentRoster = null;
      currentClassAttempts = null;
      state = {
        kind: "list",
        classes: state.classes,
        form: null,
        lastCreated: null,
        importState: idleImportState(),
      };
      rerender();
    },
    restoreDetail: (classId, studentId) => {
      if (state.kind !== "workspace") return false;
      if (state.selectedId !== classId) return false;
      const match = (state.rosterSnapshot ?? []).find(
        (s) => s.studentId === studentId,
      );
      if (!match) return false;
      state = {
        kind: "workspace",
        classes: state.classes,
        selectedId: state.selectedId,
        tab: state.tab,
        setupForm: state.setupForm,
        selectedStudentId: match.studentId,
        selectedStudentDisplayName: match.studentDisplayName,
        rosterSnapshot: state.rosterSnapshot,
        studentDetailOrigin: "roster",
      };
      rerender();
      return true;
    },
    restoreList: () => {
      if (state.kind !== "workspace" || state.selectedStudentId === null) {
        return;
      }
      onBackFromStudent();
    },
    // Re-opens Assignment Summary for a history entry. Fails closed (returns
    // false, changes nothing) unless the assignment is in this teacher's
    // hydrated registry, belongs to that class, and is one the class
    // Assignments section itself would list. The Summary surface then loads
    // its data through its own authorized callables exactly as on a click.
    restoreAssignmentDetail: (classId, assignmentId) => {
      const meta = listAllAssignments().find((m) => m.assignmentId === assignmentId);
      if (meta === undefined || meta.classId !== classId || !isRenderableCard(meta)) {
        return false;
      }
      openClassAssignment(classId, assignmentId, { fromHistory: true });
      return true;
    },
  });

  const onSetupFormChange = (patch: Partial<SetupFormState>): void => {
    if (state.kind !== "workspace" || state.setupForm === null) return;
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: state.selectedId,
      tab: state.tab,
      setupForm: Object.freeze({ ...state.setupForm, ...patch }),
      selectedStudentId: state.selectedStudentId,
      selectedStudentDisplayName: state.selectedStudentDisplayName,
    };
    // No rerender. Native select controls already reflect the change.
  };

  const onCancelSetup = (): void => {
    if (state.kind !== "workspace") return;
    state = {
      kind: "list",
      classes: state.classes,
      form: null,
      lastCreated: null,
      importState: idleImportState(),
    };
    rerender();
  };

  const onSubmitSetup = (): void => {
    const current = state;
    if (current.kind !== "workspace" || current.setupForm === null) return;
    if (activateClass === null) return;
    const setupForm = current.setupForm;
    const summary = current.classes.find((c) => c.id === current.selectedId);
    if (!summary || summary.status !== "needsSetup") return;
    const grade = setupForm.grade;
    const block = setupForm.block.toUpperCase();
    if (!isTeacherDefaultGrade(grade)) {
      state = {
        kind: "workspace",
        classes: current.classes,
        selectedId: current.selectedId,
        tab: current.tab,
        setupForm: Object.freeze({
          ...setupForm,
          error: "Choose a grade before you finish setup.",
        }),
        selectedStudentId: null,
        selectedStudentDisplayName: null,
      };
      rerender();
      return;
    }
    if (!/^[A-G]$/.test(block)) {
      state = {
        kind: "workspace",
        classes: current.classes,
        selectedId: current.selectedId,
        tab: current.tab,
        setupForm: Object.freeze({
          ...setupForm,
          error: "Choose a class block before you finish setup.",
        }),
        selectedStudentId: null,
        selectedStudentDisplayName: null,
      };
      rerender();
      return;
    }
    state = {
      kind: "workspace",
      classes: current.classes,
      selectedId: current.selectedId,
      tab: current.tab,
      setupForm: Object.freeze({
        ...setupForm,
        submitting: true,
        error: null,
      }),
      selectedStudentId: null,
      selectedStudentDisplayName: null,
    };
    rerender();
    const classId = current.selectedId;
    const submittedGrade: TeacherDefaultGrade = grade;
    const submittedBlock = block as "A" | "B" | "C" | "D" | "E" | "F" | "G";
    void activateClass({
      classId,
      grade: submittedGrade,
      block: submittedBlock,
    })
      .then(() => {
        // Sprint 25 (B2): activation moved a `needsSetup` class to
        // `active` (the only status the Assign dialog surfaces).
        // Invalidate the Curriculum class cache before the mount guard so
        // a later Assign open re-fetches the now-active class.
        invalidateCurriculumClassCache();
        if (!mount.isConnected) return;
        // Refresh the class list so the newly active class carries its
        // atomic grade / block / joinCode, then land on the class default.
        // Sprint 28.6H.3 (Task B1/B2): Overview/Snapshot is removed, so a
        // just-activated class opens directly on Assignments like every other
        // active class.
        void deps
          .listClasses(session.uid)
          .then((classes) => {
            if (!mount.isConnected) return;
            state = {
              kind: "workspace",
              classes,
              selectedId: classId,
              tab: "assignments",
              setupForm: null,
              selectedStudentId: null,
              selectedStudentDisplayName: null,
            };
            // Sprint 24B Phase 2B.8. Automatic initial roster sync for
            // an LMS-linked class. Fires strictly AFTER activation
            // resolves, uses the refreshed class list to confirm
            // isLmsLinked and active, and is a no-op for manual classes.
            // The activation .then() has already run to completion;
            // a sync failure at this point NEVER downgrades the
            // activation-success narrative (see rerender + workspace
            // renderer, which surface roster-sync state separately).
            const refreshed = classes.find((c) => c.id === classId);
            if (
              refreshed !== undefined &&
              refreshed.status === "active" &&
              refreshed.isLmsLinked === true
            ) {
              runRosterSync(classId);
            }
            rerender();
          })
          .catch(() => {
            if (!mount.isConnected) return;
            // Best-effort: if the refresh fails, fall back to the list
            // so the teacher can reopen the (now active) class.
            const s2 = state;
            state = {
              kind: "list",
              classes:
                s2.kind === "workspace" || s2.kind === "list"
                  ? s2.classes
                  : ([] as ReadonlyArray<ClassSummary>),
              form: null,
              lastCreated: null,
              importState: idleImportState(),
            };
            rerender();
          });
      })
      .catch((err: unknown) => {
        if (!mount.isConnected) return;
        const s3 = state;
        if (s3.kind !== "workspace") return;
        const message = describeActivationError(err);
        state = {
          kind: "workspace",
          classes: s3.classes,
          selectedId: s3.selectedId,
          tab: s3.tab,
          setupForm: Object.freeze({
            ...setupForm,
            submitting: false,
            error: message,
          }),
          selectedStudentId: null,
          selectedStudentDisplayName: null,
        };
        rerender();
      });
  };

  rerender();

  // Sprint 30A.1 Class Settings V1. Loaded independently of the class
  // list itself: a failure or slow read here never blocks or breaks the
  // Classes workspace from loading - color is a presentation
  // convenience, exactly like `classOrder` already is. Re-rendering only
  // when still in the "list" state (never mid-workspace-view or
  // mid-settings-edit) avoids clobbering a state transition that
  // happened while this was in flight.
  if (readClassColors) {
    void readClassColors(session.uid)
      .then((colors) => {
        if (!mount.isConnected) return;
        classColors = colors;
        if (state.kind === "list") rerender();
      })
      .catch(() => undefined);
  }

  void deps
    .listClasses(session.uid)
    .then((classes) => {
      if (!mount.isConnected) return;
      // Student Progress & Assignment Membership Phase A, Slice 3: one-shot
      // student-selection restore. When the teacher just arrived from an
      // Assignment Detail roster-name click, land directly on that
      // student's Student Detail with an assignment-origin
      // `studentDetailOrigin` so Back returns to that exact assignment
      // (not the plain Students list). Consumed exactly once. Falls back
      // to the ordinary list/restore path when the target class is no
      // longer active (e.g. archived between the click and this mount).
      const studentIntent = getClassesStudentIntent?.() ?? null;
      if (studentIntent !== null) {
        setClassesStudentIntent?.(null);
        const target = classes.find(
          (c) => c.id === studentIntent.classId && c.status === "active",
        );
        if (target !== undefined) {
          state = {
            kind: "workspace",
            classes,
            selectedId: studentIntent.classId,
            tab: "roster",
            setupForm: null,
            selectedStudentId: studentIntent.studentId,
            selectedStudentDisplayName: studentIntent.studentDisplayName,
            rosterSnapshot: null,
            studentDetailOrigin: {
              kind: "assignment",
              assignmentId: studentIntent.returnToAssignmentId,
            },
          };
          // Student Progress & Assignment Membership Phase A, Slice 3: this
          // mount never visited the Students tab, so no roster has been
          // fetched yet (`rosterSnapshot: null` above means Previous/Next
          // render absent for now, per the Slice 2 "missing snapshot"
          // safety default). The render below starts the class's roster
          // fetch in the background (`ensureClassRoster`), and its
          // resolution re-renders Student Detail so Previous/Next become
          // available a moment later without a teacher-visible loading
          // state of their own.
          rerender();
          return;
        }
      }
      // Sprint 28.6C: one-shot return-context restore. When the teacher just
      // came back from Assignment Detail opened inside a class, re-land in that
      // class's recorded section (Assignments) instead of the class list. The
      // location is consumed exactly once; any later Classes visit shows the
      // list. Only active classes restore into the workspace; a class that has
      // since been removed or reverted to needsSetup falls back to the list.
      const restore = getClassesReturn?.() ?? null;
      if (restore !== null) {
        setClassesReturn?.(null);
        const target = classes.find(
          (c) => c.id === restore.classId && c.status === "active",
        );
        if (target !== undefined) {
          state = {
            kind: "workspace",
            classes,
            selectedId: restore.classId,
            // Sprint 28.6H.3 (Task B1/B2): Overview/Snapshot is removed; any
            // stale restore target (setup or the retired snapshot) re-lands on
            // Assignments, the class default.
            tab:
              restore.tab === "assignments" || restore.tab === "roster"
                ? restore.tab
                : "assignments",
            setupForm: null,
            selectedStudentId: null,
            selectedStudentDisplayName: null,
          };
          rerender();
          return;
        }
      }
      // Sprint 28.6F: one-shot class-management intent. When the teacher chose
      // Import / Create from Settings' "Classes & Google Classroom" section,
      // the shell recorded the intent and routed here; open the matching
      // control in the SAME `+ Add a class` workflow. Consumed exactly once;
      // any later Classes visit shows the plain list. Only honored when the
      // corresponding workflow is actually wired (createClass / import).
      const intent = getClassManagementIntent?.() ?? null;
      if (intent !== null) setClassManagementIntent?.(null);
      const openCreate = intent === "create" && createClass !== null;
      // Sprint 28.6H (Finding 1): an incoming class-management intent also
      // reveals the minimized Add-a-class disclosure so the shared workflow is
      // visible on a populated list (it is always visible when zero classes).
      const openImport =
        intent === "import" && importDeps !== null && createClass !== null;
      // Sprint 28.6H.6 (Part F/G): a routed intent selects the focused task so
      // the alternative path is not shown alongside it.
      listAddMode = openCreate ? "create" : openImport ? "import" : null;
      state = {
        kind: "list",
        classes,
        form: openCreate ? emptyForm() : null,
        lastCreated: null,
        importState: idleImportState(),
      };
      rerender();
      focusForClassManagementIntent(intent);
      // Sprint 28.6H.8 (Part D/D1): a routed Import intent launches the focused
      // Google Classroom import task DIRECTLY - the teacher does not click a
      // second Import button. `onStartImport()` runs the certified import
      // controller (Part D2: contextual authorization - discovery when already
      // authorized, the existing OAuth flow when not). It is invoked here,
      // ~1 await after the Settings "Import Class" click that drove this
      // navigation, so the OAuth pop-up (`win.open`, a few fast awaits later)
      // stays inside the click's transient activation window (Part O); the
      // certified popup-blocked path + retry remains the fallback. No new OAuth
      // is introduced.
      if (openImport) onStartImport();
    })
    .catch(() => {
      if (!mount.isConnected) return;
      state = { kind: "error" };
      rerender();
    });

  // Sprint 28.6F: after the list (with any intent-opened control) has
  // rendered, move focus into the shared workflow so a Settings entry lands
  // the teacher exactly where the action is. Create focuses the class-name
  // input; Import focuses the Import entry point (the teacher confirms with
  // one click, keeping the OAuth pop-up inside a user gesture). Scrolls the
  // control into view when the environment supports it.
  function focusForClassManagementIntent(
    intent: ClassManagementIntent | null,
  ): void {
    if (intent === null) return;
    if (!mount.isConnected) return;
    const testId =
      intent === "create" && createClass !== null
        ? "classes-create-title"
        : intent === "import" && importDeps !== null && createClass !== null
          ? "classes-import-open"
          : null;
    if (testId === null) return;
    const target = mount.querySelector<HTMLElement>(
      `[data-testid=${testId}]`,
    );
    if (target === null) return;
    try {
      target.scrollIntoView({ block: "center" });
    } catch {
      // Non-DOM-complete environments (jsdom) may not implement scrollIntoView.
    }
    try {
      target.focus({ preventScroll: true });
    } catch {
      // ignored
    }
  }
}

// Phase 2B.4: teacher-facing mapping for the classesActivate error
// taxonomy. Raw callable codes never surface to the teacher.
function describeActivationError(err: unknown): string {
  const code = extractErrorCode(err);
  if (code.includes("notFound") || code.includes("not-found")) {
    return "This class no longer exists. Return to Classes and try again.";
  }
  if (code.includes("forbidden") || code.includes("permission")) {
    return "You do not have permission to finish setting up this class.";
  }
  if (code.includes("notActivatable")) {
    return "This class can no longer be finished. It may have been archived.";
  }
  if (code.includes("alreadyActiveConflict")) {
    return "This class is already set up. Open it from Classes to change the grade or block.";
  }
  if (code.includes("joinCodeGenerationFailed")) {
    return "We could not finish setting up. Try again in a moment.";
  }
  if (code.includes("invalidGrade") || code.includes("invalidBlock")) {
    return "Choose a valid grade and block, then try again.";
  }
  if (code.includes("unauthenticated") || code.includes("claim-stale")) {
    return "Your session has expired. Reload the page and sign in again.";
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return "We could not reach LyfeLabz. Check your connection and try again.";
  }
  return "We could not finish setting up this class. Try again in a moment.";
}

function extractErrorCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const details = (err as { details?: unknown }).details;
  if (details && typeof details === "object" && "code" in details) {
    const dc = (details as { code?: unknown }).code;
    if (typeof dc === "string") return dc;
  }
  const c = (err as { code?: unknown }).code;
  return typeof c === "string" ? c : "";
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
  status.textContent = "We could not load your classes.";
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
  form: CreateFormState | null,
  lastCreated: CreateClassResult | null,
  onStartCreate: () => void,
  onCancelCreate: () => void,
  onFormChange: (patch: Partial<CreateFormState>) => void,
  onSubmitCreate: () => void,
  onDismissLastCreated: () => void,
  canImport: boolean,
  importState: ImportState,
  onStartImport: () => void,
  onSelectImportCourse: (course: IntegrationsLmsClass) => void,
  onCancelImport: () => void,
  onRetryImport: () => void,
  onOpenExistingClass: (classId: string) => void,
  // Sprint 28.6H.6/H.8 (Part D/E): the chosen class-source task. "create" /
  // "import" render ONLY that focused task; null renders the operational
  // Classes landing (no class-administration controls).
  addMode: ClassManagementIntent | null,
  // Sprint 28.6H.8 (Part C2): navigate to Settings -> Class Management from the
  // zero-class Classes landing (the operational landing no longer hosts any
  // class-administration control). Null in harnesses without the seam.
  onGoToSettings: (() => void) | null,
  // Sprint 30A.1 human-review finalization: class-card reorder wiring
  // (drag + keyboard), threaded down to each card. See `renderClassCard`.
  onCardDragStart: (classId: string) => void,
  onCardDrop: (classId: string) => void,
  onCardMove: (classId: string, direction: -1 | 1) => void,
  classOrderError: string | null,
  // Sprint 30A.1 Class Settings V1: opens the settings modal for a card's
  // gear, and the teacher's saved per-class color accents (absent id =
  // no color, render neutral).
  onOpenSettings: (classId: string) => void,
  classColors: Readonly<Record<string, ClassColorToken>>,
): void {
  const hasClasses = classes.length > 0;

  // Sprint 28.6H.6 (Part F/G): the class-management workflow is DECISION vs
  // TASK separated. A chosen task (manual create OR Google Classroom import)
  // renders ONLY that task - never the alternative path and never an "Add a
  // class" wrapper heading. The decision state (no task chosen, e.g. the
  // zero-class landing) presents the two class sources as clearly distinct
  // labelled groups (Google Classroom / LyfeLabz Classes). The underlying
  // Import / Create implementations are unchanged and still shared with
  // Settings.
  const importEntry = (directLaunch = false): HTMLElement =>
    renderImportEntryPoint(
      doc,
      canImport,
      importState,
      onStartImport,
      onSelectImportCourse,
      onCancelImport,
      onRetryImport,
      onOpenExistingClass,
      directLaunch,
    );
  const createControls = (): HTMLElement =>
    renderCreateControls(
      doc,
      form,
      onStartCreate,
      onCancelCreate,
      onFormChange,
      onSubmitCreate,
    );

  const buildAddSection = (): HTMLElement => {
    const addGroup = doc.createElement("section");
    addGroup.className = "shell-classes-add";
    addGroup.id = "classes-add-panel";
    addGroup.setAttribute("data-testid", "classes-add-a-class");
    addGroup.setAttribute("role", "region");

    // FOCUSED MANUAL CREATE TASK (Part F): only the manual form. No "Add a
    // class" wrapper (F1), no Google Classroom import action (F2). The form
    // carries its own "Create LyfeLabz Class" heading and a "Create Class"
    // submit (F3/F4).
    if (form !== null) {
      addGroup.setAttribute("aria-label", "Create LyfeLabz Class");
      addGroup.appendChild(createControls());
      return addGroup;
    }

    // FOCUSED GOOGLE CLASSROOM IMPORT TASK (Part D/E/G): only the import
    // workflow, launched DIRECTLY (auto-started). `directLaunch` suppresses the
    // standalone "Import Class from Google Classroom" button (Task D3 - no
    // second Import click) and shows the authorization / discovery progression;
    // the manual Create form/action is never shown alongside it.
    if (addMode === "import") {
      addGroup.setAttribute("aria-label", "Import from Google Classroom");
      addGroup.appendChild(importEntry(true));
      return addGroup;
    }

    // DECISION SURFACE (no task chosen; the zero-class landing): two clearly
    // labelled class sources so manual creation is never mistaken for a Google
    // Classroom action.
    addGroup.setAttribute("aria-labelledby", "classes-add-google-heading");

    const gcGroup = doc.createElement("div");
    gcGroup.className = "shell-classes-add-source";
    const gcHeading = doc.createElement("h3");
    gcHeading.className = "shell-classes-add-heading";
    gcHeading.id = "classes-add-google-heading";
    gcHeading.setAttribute("data-testid", "classes-add-google-heading");
    gcHeading.textContent = "Google Classroom";
    gcGroup.appendChild(gcHeading);
    gcGroup.appendChild(importEntry());
    addGroup.appendChild(gcGroup);

    const llGroup = doc.createElement("div");
    llGroup.className = "shell-classes-add-source";
    const llHeading = doc.createElement("h3");
    llHeading.className = "shell-classes-add-heading";
    llHeading.id = "classes-add-lyfelabz-heading";
    llHeading.setAttribute("data-testid", "classes-add-lyfelabz-heading");
    llHeading.textContent = "LyfeLabz Classes";
    llGroup.appendChild(llHeading);
    llGroup.appendChild(createControls());
    addGroup.appendChild(llGroup);

    return addGroup;
  };

  // Sprint 28.6H.8 (Part C/D/E): task-vs-landing separation. Once a class-source
  // task is chosen it renders as a FOCUSED task surface only - never the generic
  // Classes landing (no "Classes" heading, no class count, no class cards, no
  // second import/create control). Reusing the certified Classes-hosted import /
  // create implementation is encouraged; showing the generic landing as an
  // intermediate step is not.
  if (form !== null) {
    // Focused manual create task (Part F): the form carries its own
    // "Create LyfeLabz Class" heading; no generic Classes landing above it.
    // Sprint 28.6H.9 (Correction 2): a persistent "Back to Settings" control
    // sits at the top of the task (parent navigation, distinct from the
    // form's own Cancel action). Rendered only when the settings-return seam
    // is wired; it reuses onCancelCreate, which returns to Settings -> Class
    // Management and clears the draft.
    if (onGoToSettings !== null) {
      mount.appendChild(renderBackToSettings(doc, onCancelCreate));
    }
    mount.appendChild(buildAddSection());
    return;
  }
  if (addMode === "import") {
    // Focused Google Classroom import task (Part D/E): a specific task heading
    // then the certified import workflow (auto-started by the surface). No
    // Classes heading / count / cards / second Import button.
    // Sprint 28.6H.9 (Correction 2): a persistent "Back to Settings" control
    // sits above the task heading (parent navigation, distinct from the task's
    // Cancel / Close). Rendered only when the settings-return seam is wired; it
    // reuses onCancelImport, which aborts any in-flight import and returns to
    // Settings -> Class Management.
    if (onGoToSettings !== null) {
      mount.appendChild(renderBackToSettings(doc, onCancelImport));
    }
    appendHeadline(doc, mount, "Import from Google Classroom");
    mount.appendChild(buildAddSection());
    return;
  }

  // Normal Classes landing (operational only): the teacher's classes. Class
  // administration lives in Settings -> Class Management, so this surface hosts
  // NO Import / Create controls (Part C).
  appendHeadline(doc, mount, "Classes");

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "classes-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  // Sprint 28.6H.3 (Task A2): class creation / import is an infrequent
  // administrative task and moves to Settings (its administrative home). The
  // everyday Classes landing therefore carries NO "+ Add class" control when
  // the teacher already has one or more classes - the class cards are the only
  // content. The underlying Import / Create workflows are not deleted: they
  // still render here transiently when the teacher chooses Import / Create in
  // Settings (the shared one-shot class-management intent routes to this
  // surface, `addOpen` below), so Settings and Classes keep ONE workflow
  // implementation. When the teacher has ZERO classes, adding/importing IS the
  // required first action and is never a dead end, so the Import / Create
  // workflow is still shown prominently and directly (empty-state branch).

  mount.appendChild(status);

  if (lastCreated !== null) {
    mount.appendChild(renderJoinCodePanel(doc, lastCreated, onDismissLastCreated));
  }

  if (!hasClasses) {
    // Sprint 28.6H.8 (Part C2): the zero-class landing is a concise
    // informational empty state that points to Settings -> Class Management. It
    // is NOT a second Import / Create decision surface - no class-administration
    // controls are rendered here.
    status.textContent = "No classes yet.";
    const region = doc.createElement("div");
    region.className = "shell-classes-region";
    region.setAttribute("data-testid", "classes-region");
    const empty = doc.createElement("p");
    empty.className = "shell-classes-empty";
    empty.setAttribute("data-testid", "classes-empty");
    empty.textContent = "Add or import a class in Settings.";
    region.appendChild(empty);
    if (onGoToSettings !== null) {
      const go = doc.createElement("button");
      go.type = "button";
      go.className = "shell-btn shell-classes-go-to-settings";
      go.setAttribute("data-testid", "classes-go-to-settings");
      go.textContent = "Go to Settings";
      go.addEventListener("click", () => onGoToSettings());
      region.appendChild(go);
    }
    mount.appendChild(region);
    return;
  }

  status.textContent =
    classes.length === 1 ? "1 class" : `${classes.length} classes`;

  // The class cards are the only content on the operational landing. No
  // class-administration controls (Import / Create moved to Settings, Part C).
  const region = doc.createElement("div");
  region.className = "shell-classes-region";
  region.setAttribute("data-testid", "classes-region");
  mount.appendChild(region);

  // Sprint 30A.1 human-review finalization: a failed reorder save never
  // reverts the visual order (see `persistClassOrder` in
  // renderClassesSurface) but does surface a small, honest notice instead
  // of claiming success silently.
  if (classOrderError !== null) {
    const err = doc.createElement("p");
    err.className = "shell-classes-order-error";
    err.setAttribute("data-testid", "classes-order-error");
    err.setAttribute("role", "alert");
    err.textContent = classOrderError;
    region.appendChild(err);
  }

  const list = doc.createElement("ul");
  list.className = "shell-classes-list";
  list.setAttribute("data-testid", "classes-list");
  list.setAttribute("role", "list");

  for (const summary of classes) {
    list.appendChild(
      renderClassCard(
        doc,
        summary,
        onOpen,
        {
          onDragStart: onCardDragStart,
          onDrop: onCardDrop,
          onMove: onCardMove,
        },
        onOpenSettings,
        classColors[summary.id] ?? null,
      ),
    );
  }
  region.appendChild(list);
}

function renderImportEntryPoint(
  doc: Document,
  canImport: boolean,
  importState: ImportState,
  onStartImport: () => void,
  onSelectImportCourse: (course: IntegrationsLmsClass) => void,
  onCancelImport: () => void,
  onRetryImport: () => void,
  onOpenExistingClass: (classId: string) => void,
  // Sprint 28.6H.8 (Part D3): direct-launch mode (Settings -> Import Class). The
  // standalone "Import Class from Google Classroom" button is suppressed because
  // the flow is auto-started; a brief idle state shows a calm connecting
  // placeholder, then the authorization / discovery progression renders.
  directLaunch = false,
): HTMLElement {
  // Sprint 24B Phase 2: primary Classes entry point. Renders the Import
  // Class from Google Classroom orchestration end-to-end from Classes,
  // per SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md §4.2. When the certified
  // callable seams are not injected (canImport === false) the button
  // falls back to the Phase 1 inert stub so the surface remains coherent
  // in test harnesses that do not exercise the flow.
  const wrapper = doc.createElement("div");
  wrapper.className = "shell-classes-import";
  wrapper.setAttribute("data-testid", "classes-import");

  if (!canImport) {
    const status = doc.createElement("p");
    status.id = "classes-import-status";
    status.className = "shell-status shell-classes-import-status";
    status.setAttribute("data-testid", "classes-import-status");
    status.textContent =
      "Import Class from Google Classroom is not available right now.";
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-classes-import-open";
    btn.setAttribute("data-testid", "classes-import-open");
    btn.textContent = "Import Class from Google Classroom";
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
    btn.setAttribute("aria-describedby", "classes-import-status");
    wrapper.appendChild(btn);
    wrapper.appendChild(status);
    return wrapper;
  }

  const isBusy =
    importState.kind === "connecting" ||
    importState.kind === "discovering" ||
    importState.kind === "creating" ||
    importState.kind === "linking";
  const inFlow =
    isBusy ||
    importState.kind === "courses" ||
    importState.kind === "duplicate" ||
    importState.kind === "error";

  if (!directLaunch) {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-classes-import-open";
    btn.setAttribute("data-testid", "classes-import-open");
    btn.textContent = "Import Class from Google Classroom";
    btn.disabled = inFlow;
    if (inFlow) btn.setAttribute("aria-disabled", "true");
    if (isBusy) btn.setAttribute("aria-busy", "true");
    btn.addEventListener("click", () => onStartImport());
    wrapper.appendChild(btn);
    if (!inFlow) return wrapper;
  } else if (!inFlow) {
    // Direct-launch idle window (auto-start in flight): a calm placeholder, no
    // "Import Class" button. `role=status`/`aria-live` announces it.
    const loading = doc.createElement("p");
    loading.className = "shell-status shell-classes-import-loading";
    loading.setAttribute("data-testid", "classes-import-loading");
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.textContent = "Connecting to Google Classroom…";
    wrapper.appendChild(loading);
    return wrapper;
  }

  const panel = doc.createElement("div");
  panel.className = "shell-classes-import-panel";
  panel.setAttribute("data-testid", "classes-import-panel");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Import Class from Google Classroom");
  wrapper.appendChild(panel);

  // Sprint 28.6H.9 (Correction 3): the numbered four-step import process list
  // ("Sign in to Google Classroom / Load your courses / Create your LyfeLabz
  // class / Link to Google Classroom") is removed from the focused import task.
  // It exposed unnecessary implementation/process narration and added visual
  // noise; the focused task is now just the heading, the authorization /
  // loading / course-selection content, and its task actions. No controller
  // behavior changes - the stepper was pure presentation derived from
  // importState.

  switch (importState.kind) {
    case "connecting":
      panel.appendChild(
        renderImportMessage(
          doc,
          "classes-import-connecting",
          "Opening the Google Classroom sign-in window. Complete sign-in in the pop-up to continue.",
        ),
      );
      panel.appendChild(
        renderImportCancelRow(doc, onCancelImport, "Cancel"),
      );
      return wrapper;
    case "discovering":
      panel.appendChild(
        renderImportMessage(
          doc,
          "classes-import-discovering",
          `Loading your ${importState.providerDisplayName} courses.`,
        ),
      );
      return wrapper;
    case "courses": {
      if (importState.courses.length === 0) {
        panel.appendChild(
          renderImportMessage(
            doc,
            "classes-import-empty",
            `We did not find any ${importState.providerDisplayName} courses on this account. Create a course in ${importState.providerDisplayName} and try again.`,
          ),
        );
        panel.appendChild(
          renderImportCancelRow(doc, onCancelImport, "Close"),
        );
        return wrapper;
      }
      panel.appendChild(
        renderImportMessage(
          doc,
          "classes-import-pick",
          `Choose a ${importState.providerDisplayName} course to import as a LyfeLabz class.`,
        ),
      );
      const list = doc.createElement("ul");
      list.className = "shell-classes-import-courses";
      list.setAttribute("data-testid", "classes-import-courses");
      list.setAttribute("role", "list");
      for (const course of importState.courses) {
        const li = doc.createElement("li");
        li.className = "shell-classes-import-course";
        const courseBtn = doc.createElement("button");
        courseBtn.type = "button";
        courseBtn.className = "shell-classes-import-course-button";
        courseBtn.setAttribute(
          "data-testid",
          `classes-import-course-${course.lmsClassId}`,
        );
        courseBtn.setAttribute("data-lms-class-id", course.lmsClassId);
        const title = doc.createElement("span");
        title.className = "shell-classes-import-course-title";
        title.textContent = course.name;
        courseBtn.appendChild(title);
        if (course.section && course.section.length > 0) {
          const section = doc.createElement("span");
          section.className = "shell-classes-import-course-section";
          section.textContent = course.section;
          courseBtn.appendChild(section);
        }
        courseBtn.addEventListener("click", () =>
          onSelectImportCourse(course),
        );
        li.appendChild(courseBtn);
        list.appendChild(li);
      }
      panel.appendChild(list);
      panel.appendChild(renderImportCancelRow(doc, onCancelImport, "Cancel"));
      return wrapper;
    }
    case "duplicate": {
      const dup = doc.createElement("div");
      dup.className = "shell-classes-import-duplicate";
      dup.setAttribute("data-testid", "classes-import-duplicate");
      const heading = doc.createElement("h3");
      heading.className = "shell-classes-import-duplicate-heading";
      heading.textContent = "This course is already imported";
      dup.appendChild(heading);
      const body = doc.createElement("p");
      body.className = "shell-status";
      body.textContent = `"${importState.course.name}" is already connected to your LyfeLabz class "${importState.existingClassTitle}".`;
      dup.appendChild(body);
      const actions = doc.createElement("div");
      actions.className = "shell-classes-import-duplicate-actions";
      const openBtn = doc.createElement("button");
      openBtn.type = "button";
      openBtn.className = "shell-classes-import-open-existing";
      openBtn.setAttribute("data-testid", "classes-import-open-existing");
      openBtn.textContent = "Open class";
      openBtn.addEventListener("click", () =>
        onOpenExistingClass(importState.existingClassId),
      );
      actions.appendChild(openBtn);
      const cancelBtn = doc.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "shell-classes-import-cancel";
      cancelBtn.setAttribute("data-testid", "classes-import-cancel");
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => onCancelImport());
      actions.appendChild(cancelBtn);
      dup.appendChild(actions);
      panel.appendChild(dup);
      return wrapper;
    }
    case "creating":
      panel.appendChild(
        renderImportMessage(
          doc,
          "classes-import-creating",
          `Creating your LyfeLabz class for "${importState.course.name}".`,
        ),
      );
      return wrapper;
    case "linking":
      panel.appendChild(
        renderImportMessage(
          doc,
          "classes-import-linking",
          `Linking "${importState.course.name}" to Google Classroom.`,
        ),
      );
      return wrapper;
    case "error": {
      const err = doc.createElement("p");
      err.className = "shell-classes-import-error";
      err.setAttribute("data-testid", "classes-import-error");
      err.setAttribute("role", "alert");
      err.textContent = importState.message;
      panel.appendChild(err);
      if (importState.recoveryHint) {
        const hint = doc.createElement("p");
        hint.className = "shell-status shell-classes-import-error-hint";
        hint.setAttribute("data-testid", "classes-import-error-hint");
        hint.textContent = importState.recoveryHint;
        panel.appendChild(hint);
      }
      const actions = doc.createElement("div");
      actions.className = "shell-classes-import-error-actions";
      if (importState.stage !== "linking") {
        const retry = doc.createElement("button");
        retry.type = "button";
        retry.className = "shell-classes-import-retry";
        retry.setAttribute("data-testid", "classes-import-retry");
        retry.textContent = "Try again";
        retry.addEventListener("click", () => onRetryImport());
        actions.appendChild(retry);
      }
      const cancelBtn = doc.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "shell-classes-import-cancel";
      cancelBtn.setAttribute("data-testid", "classes-import-cancel");
      cancelBtn.textContent = "Close";
      cancelBtn.addEventListener("click", () => onCancelImport());
      actions.appendChild(cancelBtn);
      panel.appendChild(actions);
      return wrapper;
    }
    default:
      return wrapper;
  }
}

// Sprint 28.6H.9 (Correction 3): the numbered import stepper
// (`renderImportStages` + IMPORT_STAGE_LABEL / IMPORT_STAGE_ORDER) is removed.
// The focused import task no longer narrates the internal connect -> discover
// -> create -> link process; it shows only the heading, the live
// authorization / loading / course-selection content, and its task actions.
// The `ImportStage` type and `importState.stage` field are unchanged (still
// used by the error-recovery branch); only the presentational stepper is gone.

// Sprint 28.6H.9 (Correction 2): persistent parent navigation for a focused
// Settings child task (Import from Google Classroom / Create LyfeLabz Class).
// Mirrors the certified "Back to Classes" control (`shell-class-workspace-back`
// idiom): a quiet text-weight button near the top of the task that returns to
// Settings -> Class Management. It is navigation, NOT the task action, so it
// coexists with the task-specific Create Class / Cancel / Try again / Close
// controls; it reuses the existing settings-return handler (which also tears
// down any in-flight import) rather than adding a new routing path.
function renderBackToSettings(
  doc: Document,
  onBackToSettings: () => void,
): HTMLElement {
  const back = doc.createElement("button");
  back.type = "button";
  back.className = "shell-classes-back-to-settings";
  back.setAttribute("data-testid", "classes-back-to-settings");
  back.textContent = "Back to Settings";
  back.setAttribute("aria-label", "Back to Settings");
  back.addEventListener("click", () => onBackToSettings());
  return back;
}

function renderImportMessage(
  doc: Document,
  testid: string,
  text: string,
): HTMLElement {
  const p = doc.createElement("p");
  p.className = "shell-status shell-classes-import-message";
  p.setAttribute("data-testid", testid);
  p.setAttribute("role", "status");
  p.setAttribute("aria-live", "polite");
  p.textContent = text;
  return p;
}

function renderImportCancelRow(
  doc: Document,
  onCancelImport: () => void,
  label: string,
): HTMLElement {
  const row = doc.createElement("div");
  row.className = "shell-classes-import-actions";
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "shell-classes-import-cancel";
  btn.setAttribute("data-testid", "classes-import-cancel");
  btn.textContent = label;
  btn.addEventListener("click", () => onCancelImport());
  row.appendChild(btn);
  return row;
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
    btn.textContent = "Create LyfeLabz Class";
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
  heading.textContent = "Create LyfeLabz Class";
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
  // Phase 2B.4: placeholder option so the "no selection" state is
  // explicit. The teacher must choose a grade before submit succeeds.
  const gradePlaceholder = doc.createElement("option");
  gradePlaceholder.value = "";
  gradePlaceholder.textContent = "Choose a grade";
  if (form.grade === "") gradePlaceholder.selected = true;
  gradeSelect.appendChild(gradePlaceholder);
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
  // Phase 2B.4: placeholder option so block always begins empty.
  const blockPlaceholder = doc.createElement("option");
  blockPlaceholder.value = "";
  blockPlaceholder.textContent = "Choose a block";
  if (form.block === "") blockPlaceholder.selected = true;
  blockSelect.appendChild(blockPlaceholder);
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
  // Sprint 28.6H.6 (Task F4): the heading already establishes this is a
  // LyfeLabz class, so the submit reads the shorter "Create Class".
  submit.textContent = form.submitting ? "Creating" : "Create Class";
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

// Sprint 30A.1 human-review finalization: the class-card reorder
// affordance, moved here from the (removed) Assign dialog drag handle.
// See the root-cause comment on `renderRow` in curriculum.ts: the prior
// Assign row was a `display:contents` grid-item host, which generates no
// box of its own, so native drag-and-drop never had anything to
// originate the drag gesture from. `<li class="shell-classes-item">` is
// an ordinary block-level element with a real box, so the identical
// pointer-down/native-drag/keyboard pattern works here.
type ClassCardReorderControls = {
  readonly onDragStart: (classId: string) => void;
  readonly onDrop: (classId: string) => void;
  readonly onMove: (classId: string, direction: -1 | 1) => void;
};

// Human review (targeted finalization): the drag handle and the new
// settings gear both live INSIDE the card tile itself now (upper-right /
// lower-right corners), not floating above it. Because they must be real,
// independently-focusable `<button>` elements and HTML forbids nesting
// interactive controls inside a native `<button>`, the card's own
// clickable region is a `<div role="button" tabindex="0">` instead of a
// `<button>` - the standard "card with corner action buttons" pattern
// (the same shape as, e.g., a Trello card's overflow menu). Each corner
// control stops propagation on `click` so activating it (by click OR by
// Enter/Space, which browsers turn into a synthetic click on a button)
// never also fires the card's own "open the class" handler.
function renderClassCard(
  doc: Document,
  summary: ClassSummary,
  onOpen: (classId: string) => void,
  reorder: ClassCardReorderControls,
  onOpenSettings: (classId: string) => void,
  color: ClassColorToken | null,
): HTMLElement {
  const li = doc.createElement("li");
  li.className = "shell-classes-item";
  li.setAttribute("data-class-id", summary.id);

  const card = doc.createElement("div");
  card.className = "shell-card shell-class-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("data-testid", `class-card-${summary.id}`);
  card.setAttribute("data-class-id", summary.id);
  card.setAttribute("aria-label", `Open ${summary.title}`);
  if (color !== null) {
    card.setAttribute("data-class-color", color);
  }
  card.addEventListener("click", () => {
    onOpen(summary.id);
  });
  card.addEventListener("keydown", (ev) => {
    // Native <button> activates on both Enter and Space; replicate that
    // here since the card is a role="button" div, not a real button.
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      onOpen(summary.id);
    }
  });

  // Drag handle: `draggable` is toggled true only while the pointer is
  // actually down on the handle, so grabbing anywhere else on the card
  // (including to open it) never starts a drag. The handle is a child of
  // `card` for layout (absolutely positioned in the card's upper-right
  // corner, see `.shell-class-drag-handle`) but `li` remains the element
  // that actually drags - real drag-and-drop needs a real box to
  // originate from, and `li` (unlike Assign's old `display:contents`
  // row) has one.
  const dragHandle = doc.createElement("button");
  dragHandle.type = "button";
  dragHandle.className = "shell-class-drag-handle";
  dragHandle.setAttribute("data-testid", `class-card-drag-${summary.id}`);
  dragHandle.setAttribute(
    "aria-label",
    `Reorder ${summary.title}. Use the left and right arrow keys to move it, or drag.`,
  );
  dragHandle.textContent = "⠿";
  dragHandle.draggable = false;
  dragHandle.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    li.draggable = true;
  });
  const resetDraggable = (): void => {
    li.draggable = false;
  };
  dragHandle.addEventListener("pointerup", resetDraggable);
  dragHandle.addEventListener("pointercancel", resetDraggable);
  dragHandle.addEventListener("click", (ev) => {
    // A plain click/Enter/Space on the handle (no actual drag) must
    // never also open the card.
    ev.stopPropagation();
  });
  li.addEventListener("dragstart", (ev) => {
    ev.dataTransfer?.setData("text/plain", summary.id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
    reorder.onDragStart(summary.id);
  });
  li.addEventListener("dragend", resetDraggable);
  li.addEventListener("dragover", (ev) => {
    // Required so the browser treats this element as a valid drop
    // target; no per-hover state is needed because reorder resolution
    // happens once, on drop.
    ev.preventDefault();
  });
  li.addEventListener("drop", (ev) => {
    ev.preventDefault();
    resetDraggable();
    reorder.onDrop(summary.id);
  });
  dragHandle.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      ev.stopPropagation();
      reorder.onMove(summary.id, -1);
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      ev.stopPropagation();
      reorder.onMove(summary.id, 1);
    }
  });
  card.appendChild(dragHandle);

  // Settings gear: opens the Class Settings modal for this class. Same
  // stop-propagation discipline as the drag handle. Suppressed for any
  // class that is not `active` - a needsSetup class has no grade/block
  // yet, and the `classesUpdateMetadata` callable's own eligibility gate
  // (`assertClassSupports("editMetadata", ...)`) only permits `active`,
  // refusing both `needsSetup` and `archived`. There is nothing this
  // modal could successfully save for either case.
  if (summary.status === "active") {
    const settingsButton = doc.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "shell-class-settings-button";
    settingsButton.setAttribute("data-testid", `class-card-settings-${summary.id}`);
    settingsButton.setAttribute(
      "aria-label",
      `Class settings for ${summary.title}`,
    );
    settingsButton.textContent = "⚙";
    settingsButton.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onOpenSettings(summary.id);
    });
    card.appendChild(settingsButton);
  }

  const title = doc.createElement("h3");
  title.className = "shell-class-title";
  title.setAttribute("data-testid", `class-title-${summary.id}`);
  title.textContent = summary.title;
  card.appendChild(title);

  if (summary.status === "needsSetup") {
    // Phase 2B.4: the needsSetup card renders a calm status line plus
    // a Finish setup affordance. Join code, grade, block, roster
    // actions, and assignment actions are intentionally absent
    // (Spec §8, §9). The whole card remains clickable as a Finish
    // setup control; the visible affordance is redundant with the
    // card's action but names it in teacher-facing language.
    const affordance = doc.createElement("p");
    affordance.className = "shell-class-setup-affordance";
    affordance.setAttribute(
      "data-testid",
      `class-setup-affordance-${summary.id}`,
    );
    affordance.textContent = "Finish setting up this class before using it with students.";
    card.appendChild(affordance);
    const finishSetup = doc.createElement("span");
    finishSetup.className = "shell-class-setup-cta";
    finishSetup.setAttribute(
      "data-testid",
      `class-setup-cta-${summary.id}`,
    );
    finishSetup.textContent = "Finish setup";
    card.appendChild(finishSetup);
  } else {
    const gradeText = compactGradeBlock(summary);
    if (gradeText !== null) {
      const grade = doc.createElement("p");
      grade.className = "shell-class-grade";
      grade.setAttribute("data-testid", `class-grade-${summary.id}`);
      // Sprint 28.6C/H: compact grade presentation (`G6 · Block A`), shared
      // with the class-workspace header via `compactGradeBlock`.
      grade.textContent = gradeText;
      card.appendChild(grade);
    }

    // Sprint 28.6H.3 (Task A1): the generic assignment-inventory count
    // ("4 assignments" / "No assignments") is removed from the everyday
    // Classes card. The total number of assignments is not decision-useful
    // enough to deserve card-level emphasis, and the Assignments tab already
    // exposes the full inventory. Per Task A1 it is NOT replaced with another
    // bare statistic; the card carries only stable class identity (title +
    // grade/block). The operational-attention data a teacher actually wants
    // ("who has not completed this assignment", "who newly completed it") is
    // not available to the Classes landing without per-assignment summary
    // reads (N+1) or a durable teacher checkpoint that does not yet exist -
    // see the Sprint 28.6H.3 record and STOP-condition investigation. No new
    // read is invented here merely to decorate the card.

    // Sprint 28.6I: the join code is intentionally not shown on the class
    // card. The card carries only what helps a teacher browse the class list
    // (title, grade/block, assignment count). The join code remains available
    // on the dedicated surfaces (the post-create "Student join code" panel and
    // class settings); `summary.joinCode` and all join-code data are untouched.
  }

  // Sprint 28.6H (Finding 2): the "Active" status badge is removed from the
  // class card. A class that appears in the everyday Classes workspace is
  // implicitly active, so the badge merely repeated the current state and
  // carried no teacher decision. The needsSetup state is still communicated -
  // by the "Finish setup" affordance and its copy above - so no status pill is
  // needed here. Backend activation/status semantics are unchanged; this is a
  // presentation-only removal.

  li.appendChild(card);
  return li;
}

// Sprint 30A.1 Class Settings V1.
//
// Data model (determined by inspecting the actual canonical types before
// implementing, per the sprint instructions):
//   - `title`, `grade`, `block` are already teacher-owned canonical
//     fields on `classes/{classId}` (platform/functions/src/shared/types
//     /class.ts) - the same fields the Create Class form writes at
//     creation. Nothing in the class record ever mirrors a Google
//     Classroom course's own name/section/grade, so editing these three
//     through the existing `classesUpdateMetadata` callable can never
//     rename or otherwise touch the linked Classroom course. This modal
//     reuses that callable verbatim rather than inventing a second write
//     path.
//   - `color` is NOT a class-record field. It is modeled as a teacher-
//     owned PRESENTATION preference, stored on the SAME
//     `users/{uid}/preferences/teacher` document `classOrder` already
//     lives on (see classOrder.ts / teacher-class-color-update.ts) -
//     because a class can be co-taught (`coTeacherIds`), a color choice
//     is one teacher's own personal presentation preference, not a fact
//     about the class the way title/grade/block are.
export type ClassSettingsPatch = {
  readonly title?: string;
  readonly grade?: string;
  readonly block?: string;
  readonly color?: ClassColorToken | "none";
};

type ClassSettingsModalDeps = {
  readonly canEditMetadata: boolean;
  readonly canEditColor: boolean;
  // Manual "Refresh roster from Google Classroom". Null hides the section
  // (not a Classroom-linked class, or not wired).
  readonly refreshRoster: (() => Promise<RefreshRosterResult>) | null;
  readonly onRosterRefreshed: () => void;
  readonly onCancel: () => void;
  // Resolving closes the modal (the caller is responsible for actually
  // removing it, since only the caller can update its own state);
  // rejecting keeps the modal open and shows the rejection's message.
  readonly onSave: (patch: ClassSettingsPatch) => Promise<void>;
};

const MAX_CLASS_TITLE_LENGTH = 60;

const countOf = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

// Teacher-facing summary of a manual Classroom roster refresh, built only
// from the server's counts. A student is described as "added" only when an
// enrollment was actually created, and as "restored" (never "new") when a
// Classroom-withdrawn enrollment was reactivated because they returned; a
// Classroom student who has not signed in yet is described as joining on
// first sign-in. Withdrawn students are "removed from this class" with their
// work kept - never "deleted".
export function describeRosterRefreshResult(result: RefreshRosterResult): string {
  const parts = ["Roster refreshed from Google Classroom."];
  const r = result.enrollmentReconciliation;
  if (r === undefined) return parts[0];
  if (r.added > 0) {
    parts.push(`${countOf(r.added, "student", "students")} added to this class.`);
  }
  if (r.reactivated > 0) {
    parts.push(
      r.reactivated === 1
        ? "1 student who returned to Google Classroom was restored to this class."
        : `${r.reactivated} students who returned to Google Classroom were restored to this class.`,
    );
  }
  if (r.awaitingFirstSignIn > 0) {
    parts.push(
      r.awaitingFirstSignIn === 1
        ? "1 student will join after signing in to LyfeLabz for the first time."
        : `${r.awaitingFirstSignIn} students will join after signing in to LyfeLabz for the first time.`,
    );
  }
  if (r.withdrawn > 0) {
    parts.push(
      r.withdrawn === 1
        ? "1 student no longer in Google Classroom was removed from this class. Their work is kept."
        : `${r.withdrawn} students no longer in Google Classroom were removed from this class. Their work is kept.`,
    );
  }
  if (result.upstreamRosterEmpty) {
    parts.push("Google Classroom returned no students, so no one was removed.");
  }
  if (r.notReactivated > 0) {
    parts.push(
      r.notReactivated === 1
        ? "1 student previously removed from this class could not be restored automatically."
        : `${r.notReactivated} students previously removed from this class could not be restored automatically.`,
    );
  }
  if (r.notMatched > 0) {
    parts.push(
      r.notMatched === 1
        ? "1 Google Classroom account could not be matched to a student in this school."
        : `${r.notMatched} Google Classroom accounts could not be matched to a student in this school.`,
    );
  }
  if (parts.length === 1) parts.push("No changes were needed.");
  return parts.join(" ");
}

// Recovery guidance for a failed manual refresh, reusing the Classroom
// roster error vocabulary. A failure can follow partial (idempotent) server
// writes, so no message claims the roster is unchanged.
export function describeRosterRefreshError(err: unknown): string {
  switch (classifyRosterSyncError(err).kind) {
    case "reconnectRequired":
      return "Google Classroom access needs to be reconnected. Open Settings to reconnect, then try again.";
    case "linkBroken":
      return "This class's Google Classroom course could not be reached. Confirm the course is still available and try again.";
    case "classNotActive":
      return "This class is no longer active, so its roster cannot be refreshed.";
    case "transient":
      return "We could not reach Google Classroom just now. It is safe to try again in a moment.";
    case "unknown":
    default:
      return "The roster refresh did not finish. It is safe to try again.";
  }
}

function describeClassSettingsError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code?: unknown }).code);
    if (code.includes("invalidTitle")) return "Enter a class name.";
    if (code.includes("invalidGrade")) return "Choose a valid grade.";
    if (code.includes("invalidBlock")) return "Choose a valid block.";
    if (code.includes("invalidColor")) return "Choose a valid color.";
    if (code.includes("forbidden")) {
      return "You do not have permission to edit this class.";
    }
  }
  return "Could not save class settings. Please try again.";
}

function renderClassSettingsModal(
  doc: Document,
  summary: Extract<ClassSummary, { status: "active" }>,
  currentColor: ClassColorToken | null,
  deps: ClassSettingsModalDeps,
): HTMLElement {
  const overlay = doc.createElement("div");
  overlay.className = "shell-classes-settings-overlay";
  overlay.setAttribute("data-testid", "classes-settings-overlay");

  const dialog = doc.createElement("div");
  dialog.className = "shell-classes-settings-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "classes-settings-title");
  dialog.setAttribute("data-testid", "classes-settings-dialog");
  overlay.appendChild(dialog);

  // Browser Back/Forward: registered so a history navigation dismisses this
  // dialog exactly as Escape does (close + cancel) instead of leaving it
  // over the page Back restores. See shell/openModals.ts.
  let unregisterModal: () => void = () => undefined;
  const close = (): void => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    doc.removeEventListener("keydown", onKey);
    unregisterModal();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
      deps.onCancel();
    }
  };
  doc.addEventListener("keydown", onKey);
  unregisterModal = registerOpenModal(() => {
    close();
    deps.onCancel();
  });
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) {
      close();
      deps.onCancel();
    }
  });

  const title = doc.createElement("h3");
  title.id = "classes-settings-title";
  title.className = "shell-classes-create-heading";
  title.setAttribute("data-testid", "classes-settings-title");
  title.textContent = "Class settings";
  dialog.appendChild(title);

  const formEl = doc.createElement("form");
  formEl.className = "shell-form";

  const titleLabel = doc.createElement("label");
  titleLabel.textContent = "Display name";
  const titleInput = doc.createElement("input");
  titleInput.type = "text";
  titleInput.value = summary.title;
  titleInput.maxLength = MAX_CLASS_TITLE_LENGTH;
  titleInput.disabled = !deps.canEditMetadata;
  titleInput.setAttribute("data-testid", "classes-settings-title-input");
  titleLabel.appendChild(titleInput);
  formEl.appendChild(titleLabel);

  const gradeLabel = doc.createElement("label");
  gradeLabel.textContent = "Grade";
  const gradeSelect = doc.createElement("select");
  gradeSelect.setAttribute("data-testid", "classes-settings-grade");
  gradeSelect.disabled = !deps.canEditMetadata;
  for (const g of TEACHER_DEFAULT_GRADE_VALUES) {
    const opt = doc.createElement("option");
    opt.value = g;
    opt.textContent = g;
    if (g === summary.grade) opt.selected = true;
    gradeSelect.appendChild(opt);
  }
  gradeLabel.appendChild(gradeSelect);
  formEl.appendChild(gradeLabel);

  const blockLabel = doc.createElement("label");
  blockLabel.textContent = "Block";
  const blockSelect = doc.createElement("select");
  blockSelect.setAttribute("data-testid", "classes-settings-block");
  blockSelect.disabled = !deps.canEditMetadata;
  // Sprint 30A.1 human review: "do not assume all districts use letters" -
  // but the existing canonical validator
  // (platform/functions/src/classes/classes-update-metadata.ts,
  // BLOCK_PATTERN) already only accepts a single letter A-G, the exact
  // vocabulary the Create Class form already uses. Reusing it verbatim
  // (rather than inventing a broader "Period 2"-style schema this
  // sprint's server contract does not accept) is what "respect the
  // existing block representation" means in practice here.
  for (const b of ["A", "B", "C", "D", "E", "F", "G"]) {
    const opt = doc.createElement("option");
    opt.value = b;
    opt.textContent = b;
    if (b === summary.block) opt.selected = true;
    blockSelect.appendChild(opt);
  }
  blockLabel.appendChild(blockSelect);
  formEl.appendChild(blockLabel);

  // Color: a curated palette, never a free-form picker. "None" clears a
  // previously-saved color back to the neutral default.
  const colorLabel = doc.createElement("span");
  colorLabel.className = "shell-classes-settings-color-label";
  colorLabel.textContent = "Color";
  formEl.appendChild(colorLabel);

  const colorPicker = doc.createElement("div");
  colorPicker.className = "shell-classes-settings-color-picker";
  colorPicker.setAttribute("role", "radiogroup");
  colorPicker.setAttribute("aria-label", "Color");
  formEl.appendChild(colorPicker);

  let selectedColor: ClassColorToken | "none" = currentColor ?? "none";
  const colorButtons: Map<ClassColorToken | "none", HTMLButtonElement> =
    new Map();

  const refreshColorSelection = (): void => {
    for (const [token, btn] of colorButtons) {
      const isSelected = token === selectedColor;
      btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
      btn.classList.toggle("shell-classes-settings-color-selected", isSelected);
    }
  };

  const makeColorButton = (
    token: ClassColorToken | "none",
    label: string,
  ): void => {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-classes-settings-color-swatch";
    if (token !== "none") {
      btn.setAttribute("data-class-color", token);
    } else {
      btn.classList.add("shell-classes-settings-color-none");
    }
    btn.setAttribute("data-testid", `classes-settings-color-${token}`);
    btn.setAttribute("aria-label", `Color: ${label}`);
    btn.disabled = !deps.canEditColor;
    btn.addEventListener("click", () => {
      selectedColor = token;
      refreshColorSelection();
    });
    colorPicker.appendChild(btn);
    colorButtons.set(token, btn);
  };

  makeColorButton("none", "None");
  for (const token of CLASS_COLOR_TOKENS) {
    makeColorButton(token, CLASS_COLOR_LABELS[token]);
  }
  refreshColorSelection();

  // Google Classroom roster: an independent, teacher-controlled action. It
  // is a plain (non-submit) button, so it never triggers Save and never
  // changes any other class setting; Cancel/Escape still close the dialog.
  const refreshRosterAction = deps.refreshRoster;
  if (refreshRosterAction !== null) {
    const section = doc.createElement("div");
    section.className = "shell-classes-settings-roster";
    section.setAttribute("data-testid", "classes-settings-roster");

    const sectionLabel = doc.createElement("span");
    sectionLabel.className = "shell-classes-settings-section-label";
    sectionLabel.textContent = "Google Classroom roster";
    section.appendChild(sectionLabel);

    const refreshButton = doc.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "shell-class-rostersync-button";
    refreshButton.setAttribute("data-testid", "classes-settings-roster-refresh");
    const idleLabel = "Refresh roster from Google Classroom";
    refreshButton.textContent = idleLabel;
    section.appendChild(refreshButton);

    const refreshStatus = doc.createElement("p");
    refreshStatus.className = "shell-class-rostersync-status";
    refreshStatus.setAttribute("data-testid", "classes-settings-roster-status");
    refreshStatus.setAttribute("role", "status");
    refreshStatus.setAttribute("aria-live", "polite");
    section.appendChild(refreshStatus);

    let refreshing = false;
    refreshButton.addEventListener("click", () => {
      if (refreshing) return;
      refreshing = true;
      refreshButton.disabled = true;
      refreshButton.setAttribute("aria-busy", "true");
      refreshButton.textContent = "Refreshing roster\u2026";
      refreshStatus.textContent = "";
      refreshStatus.removeAttribute("data-roster-refresh-outcome");
      refreshRosterAction().then(
        (result) => {
          deps.onRosterRefreshed();
          refreshStatus.textContent = describeRosterRefreshResult(result);
          refreshStatus.setAttribute("data-roster-refresh-outcome", "ok");
        },
        (err: unknown) => {
          // A failure may follow partial (idempotent) server writes, so the
          // held roster is dropped too; the message never claims "unchanged".
          deps.onRosterRefreshed();
          refreshStatus.textContent = describeRosterRefreshError(err);
          refreshStatus.setAttribute("data-roster-refresh-outcome", "error");
        },
      ).finally(() => {
        refreshing = false;
        refreshButton.disabled = false;
        refreshButton.removeAttribute("aria-busy");
        refreshButton.textContent = idleLabel;
      });
    });

    formEl.appendChild(section);
  }

  const errorMessage = doc.createElement("p");
  errorMessage.className = "shell-classes-create-error";
  errorMessage.setAttribute("data-testid", "classes-settings-error");
  errorMessage.setAttribute("role", "alert");
  errorMessage.hidden = true;
  formEl.appendChild(errorMessage);

  const actions = doc.createElement("div");
  actions.className = "shell-classes-create-actions";

  const save = doc.createElement("button");
  save.type = "submit";
  save.setAttribute("data-testid", "classes-settings-save");
  save.textContent = "Save";
  actions.appendChild(save);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-classes-create-cancel";
  cancel.setAttribute("data-testid", "classes-settings-cancel");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    // Cancel makes no mutation and restores nothing, because nothing was
    // ever mutated - every field above is local form state until Save.
    close();
    deps.onCancel();
  });
  actions.appendChild(cancel);

  formEl.appendChild(actions);
  dialog.appendChild(formEl);

  let submitting = false;
  formEl.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (submitting) return;

    const trimmedTitle = titleInput.value.trim();
    if (deps.canEditMetadata) {
      if (trimmedTitle.length === 0) {
        errorMessage.textContent = "Enter a class name.";
        errorMessage.hidden = false;
        return;
      }
      if (trimmedTitle.length > MAX_CLASS_TITLE_LENGTH) {
        errorMessage.textContent = `Class names must be ${MAX_CLASS_TITLE_LENGTH} characters or fewer.`;
        errorMessage.hidden = false;
        return;
      }
    }

    const patch: ClassSettingsPatch = {
      ...(deps.canEditMetadata && trimmedTitle !== summary.title
        ? { title: trimmedTitle }
        : {}),
      ...(deps.canEditMetadata && gradeSelect.value !== summary.grade
        ? { grade: gradeSelect.value }
        : {}),
      ...(deps.canEditMetadata && blockSelect.value !== (summary.block ?? "")
        ? { block: blockSelect.value }
        : {}),
      ...(deps.canEditColor && selectedColor !== (currentColor ?? "none")
        ? { color: selectedColor }
        : {}),
    };

    // Idempotent no-op: nothing actually changed, so there is nothing to
    // save. Close exactly as Cancel would, without a network request.
    if (Object.keys(patch).length === 0) {
      close();
      deps.onCancel();
      return;
    }

    submitting = true;
    save.disabled = true;
    save.setAttribute("aria-busy", "true");
    errorMessage.hidden = true;
    deps.onSave(patch).catch((err: unknown) => {
      submitting = false;
      save.disabled = false;
      save.removeAttribute("aria-busy");
      errorMessage.textContent = describeClassSettingsError(err);
      errorMessage.hidden = false;
    });
  });

  try {
    titleInput.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  return overlay;
}

// Sprint 24B Phase 2B.8. Ephemeral roster-sync state for the currently
// visible class, threaded from the surface's per-class map into the
// workspace renderer without leaking the map itself. `available` is
// false when the syncRoster wrapper is not wired at all (test harness
// mode); the button and summary are simply omitted in that case.
export type RosterSyncViewEntry =
  | { readonly status: "idle" }
  | { readonly status: "syncing" }
  | { readonly status: "ok"; readonly counters: SyncRosterCounters; readonly at: number }
  | { readonly status: "error"; readonly kind: SyncRosterError["kind"]; readonly at: number };

// Sprint 28.6H.3 (Task C4): exported so Settings → Class Management can reuse
// the exact certified roster-sync status panel (same aggregate-only copy, same
// error taxonomy) rather than duplicating it. The underlying
// `lmsClassesSyncRoster` callable and its semantics are unchanged.
export type RosterSyncView = {
  readonly available: boolean;
  readonly entry: RosterSyncViewEntry;
  readonly onSyncClick: () => void;
};

// Students-tab roster presentation, derived from the Classes surface's single
// in-memory roster entry for the currently open class (see
// `ensureClassRoster`). The DOM builder never fetches on its own.
type RosterStudents = ReadonlyArray<{
  readonly studentId: string;
  readonly studentDisplayName: string;
}>;

type RosterView =
  // No roster reader wired (test harnesses): the genuine empty state.
  | { readonly kind: "unwired" }
  // Reader wired but not initialized yet: loading, never a false empty state.
  | { readonly kind: "notReady" }
  | { readonly kind: "ready"; readonly students: RosterStudents }
  | { readonly kind: "pending"; readonly promise: Promise<RosterStudents> };

function renderClassWorkspaceState(
  doc: Document,
  mount: HTMLElement,
  summary: ClassSummary,
  tab: ClassWorkspaceTab,
  onSelectTab: (tab: ClassWorkspaceTab) => void,
  onBack: () => void,
  setupForm: SetupFormState | null,
  onSetupFormChange: (patch: Partial<SetupFormState>) => void,
  onSubmitSetup: () => void,
  onCancelSetup: () => void,
  canActivate: boolean,
  assignmentsView: ClassAssignmentsView,
  rosterView: RosterView,
  selectedStudentId: string | null,
  selectedStudentDisplayName: string | null,
  rosterSnapshot: ReadonlyArray<{
    readonly studentId: string;
    readonly studentDisplayName: string;
  }> | null,
  studentDetailOrigin:
    | "roster"
    | { readonly kind: "assignment"; readonly assignmentId: string },
  onSelectStudent: (studentId: string, displayName: string) => void,
  onBackFromStudent: () => void,
  onNavigateToNeighbor: (studentId: string, displayName: string) => void,
  classAttempts: ClassAttemptsAccessor | null,
  loadExpectedAssignments:
    | (() => AssessmentStudentAssignmentsForClassCallable | null)
    | null,
  listAssignments: () => ReadonlyArray<AssignmentDetailMetadata>,
  loadAttemptDetail: (() => AttemptGetForTeacherCallable | null) | null,
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

  // Phase 2B.4: a needsSetup class renders only the setup form.
  // Snapshot / Roster navigation is intentionally hidden until the
  // class becomes active.
  if (summary.status === "needsSetup") {
    const surfaceMount = doc.createElement("div");
    surfaceMount.className = "shell-class-surface shell-class-surface-setup";
    surfaceMount.setAttribute("data-testid", "class-surface");
    workspace.appendChild(surfaceMount);
    renderSetupSurface(
      doc,
      surfaceMount,
      summary,
      setupForm ?? emptySetupForm(),
      onSetupFormChange,
      onSubmitSetup,
      onCancelSetup,
      canActivate,
    );
    return;
  }

  // Sprint 28.6H (Finding 3): the CLASS is the primary object. Its identity -
  // name, then compact grade/block - appears BEFORE the tabs, so the tabs read
  // as belonging to this class. The "Active" badge is removed (Finding 2); a
  // class in the everyday workspace is implicitly active.
  const identity = doc.createElement("div");
  identity.className = "shell-class-workspace-identity";
  identity.setAttribute("data-testid", "class-workspace-identity");

  const title = doc.createElement("h2");
  title.className = "shell-welcome shell-class-workspace-title";
  title.setAttribute("data-testid", "class-workspace-title");
  title.textContent = summary.title;
  identity.appendChild(title);

  const meta = compactGradeBlock(summary);
  if (meta !== null) {
    const metaEl = doc.createElement("p");
    metaEl.className = "shell-class-workspace-meta";
    metaEl.setAttribute("data-testid", "class-workspace-meta");
    metaEl.textContent = meta;
    identity.appendChild(metaEl);
  }
  workspace.appendChild(identity);

  // Sprint 28.6H.3 (Task B3): the class workspace is operational only. The
  // "Manage class" disclosure (and the Sync roster action it hosted) is removed
  // from every everyday class-workspace location; administrative class
  // management - including roster sync for Google Classroom-linked classes -
  // now lives in Settings → Class Management (Task C4). The tab row therefore
  // holds only the class sections (Assignments | Students).
  const tabRow = doc.createElement("div");
  tabRow.className = "shell-class-tabrow";
  tabRow.appendChild(renderClassNavigation(doc, tab, onSelectTab));
  workspace.appendChild(tabRow);

  const surfaceMount = doc.createElement("div");
  surfaceMount.className = `shell-class-surface shell-class-surface-${tab}`;
  surfaceMount.setAttribute("data-testid", "class-surface");
  workspace.appendChild(surfaceMount);

  // Sprint 28.6H.3 (Task B1): Overview/Snapshot is retired. The only class
  // sections are Assignments (the default) and Students; a stale `snapshot`
  // tab defensively renders Assignments rather than an empty surface.
  if (tab === "roster") {
    if (selectedStudentId !== null && selectedStudentDisplayName !== null) {
      renderStudentDetailSurface(
        doc,
        surfaceMount,
        summary.id,
        selectedStudentId,
        selectedStudentDisplayName,
        rosterSnapshot,
        studentDetailOrigin,
        onBackFromStudent,
        onNavigateToNeighbor,
        (assignmentId: string) => assignmentsView.open(summary.id, assignmentId),
        classAttempts,
        loadExpectedAssignments,
        listAssignments,
        loadAttemptDetail,
      );
    } else {
      renderRosterSurface(doc, surfaceMount, rosterView, onSelectStudent);
    }
  } else {
    renderClassAssignmentsSurface(doc, surfaceMount, summary, assignmentsView);
  }
}

// Sprint 28.6H (Finding 3): the compact class convention used on the class
// card and the workspace header - `G6 · Block B`, or `G6` when no block, or
// null when grade is absent. Never invents a block that is not present.
// Sprint 28.6H.3 (Task C4): exported so the Settings class-management list
// renders the same compact grade/block line as the Classes surface.
export function compactGradeBlock(summary: ClassSummary): string | null {
  if (summary.status === "needsSetup") return null;
  if (summary.grade.length === 0) return null;
  return summary.block && summary.block.length > 0
    ? `G${summary.grade} · Block ${summary.block}`
    : `G${summary.grade}`;
}

// Sprint 28.6C: the class-scoped Assignments section. Shows only this class's
// assignments (published + closed) by reusing the certified Active Assignments
// renderer in its flat, classId-filtered form; each row opens the existing
// Assignment Detail. A class with no assignments gets a calm empty state that
// points the teacher to Curriculum to choose a lesson (the Curriculum-first
// lesson-selection model is preserved - no assignment is created here).
function renderClassAssignmentsSurface(
  doc: Document,
  mount: HTMLElement,
  summary: ClassSummary,
  assignmentsView: ClassAssignmentsView,
): void {
  // Sprint 28.6H (Finding 3): the class identity is the workspace header above
  // the tabs, so the tab surface heading is the SECTION name, not the class
  // title (which would otherwise appear twice).
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome shell-class-assignments-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = "Assignments";
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  // Sprint 28.6H.4 (Part A): the introductory sentence ("The assignments you
  // have given this class.") is removed - the "Assignments" heading is
  // self-explanatory and flows directly into the assignment cards.

  // Count using the same predicate as the class card so the two never
  // disagree. When there is nothing to show, render the calm empty state.
  const hasAny =
    assignmentsView.enabled &&
    assignmentsView
      .listRegistry()
      .some((m) => m.classId === summary.id && isRenderableCard(m));

  if (!hasAny) {
    // Sprint 28.6H.4 (Part A): the empty state is exactly "No assignments
    // yet." The over-explaining hint ("Choose a lesson in Curriculum...") and
    // the "Go to Curriculum" button are removed; the teacher reaches Curriculum
    // through the primary navigation.
    const empty = doc.createElement("div");
    empty.className = "shell-class-assignments-empty";
    empty.setAttribute("data-testid", "class-assignments-empty");
    empty.setAttribute("role", "status");

    const emptyMsg = doc.createElement("p");
    emptyMsg.className = "shell-class-assignments-empty-message";
    emptyMsg.textContent = "No assignments yet.";
    empty.appendChild(emptyMsg);

    mount.appendChild(empty);
    return;
  }

  const sectionMount = doc.createElement("div");
  sectionMount.className = "shell-class-assignments-section";
  sectionMount.setAttribute("data-testid", "class-assignments-section");
  mount.appendChild(sectionMount);

  renderActiveAssignmentsSection(sectionMount, {
    listRegistry: assignmentsView.listRegistry,
    open: (assignmentId) => {
      assignmentsView.open(summary.id, assignmentId);
    },
    summaryCallable: assignmentsView.summaryCallable,
    classIdFilter: summary.id,
    flat: true,
  });
}

// Sprint 24B Phase 2B.8. Sync roster affordance + summary panel. Aggregate
// counters only; no student names, emails, provider account identifiers,
// or Google identifiers ever appear here or in any log line this panel
// emits (it emits none).
export function renderRosterSyncPanel(
  doc: Document,
  rosterSync: RosterSyncView,
): HTMLElement {
  const panel = doc.createElement("section");
  panel.className = "shell-class-rostersync";
  panel.setAttribute("data-testid", "class-rostersync");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Roster synchronization");

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "shell-class-rostersync-button";
  button.setAttribute("data-testid", "class-rostersync-button");
  button.textContent = "Sync roster";
  const inFlight = rosterSync.entry.status === "syncing";
  button.disabled = inFlight;
  if (inFlight) button.setAttribute("aria-busy", "true");
  button.addEventListener("click", () => {
    if (button.disabled) return;
    rosterSync.onSyncClick();
  });
  panel.appendChild(button);

  const status = doc.createElement("p");
  status.className = "shell-class-rostersync-status";
  status.setAttribute("data-testid", "class-rostersync-status");
  status.setAttribute("aria-live", "polite");

  switch (rosterSync.entry.status) {
    case "idle":
      // Sprint 28.6H.4 (Task E6): the explanatory sentence ("Sync brings the
      // latest Google Classroom roster into LyfeLabz.") is removed; the
      // "Sync roster" action is self-explanatory in this administrative
      // context. The live region is retained (empty) so a later sync's
      // success / error status is still announced.
      status.textContent = "";
      break;
    case "syncing":
      status.textContent = "Synchronizing roster with Google Classroom.";
      break;
    case "ok": {
      const c = rosterSync.entry.counters;
      // Truthful aggregate summary. Zero values are always shown so the
      // teacher can distinguish "no changes" from "not yet synced".
      const parts: string[] = [];
      parts.push(`Added: ${c.added}`);
      parts.push(`Unchanged: ${c.unchanged}`);
      parts.push(`Withdrawn: ${c.withdrawn}`);
      // Sprint 29F: replace the raw "Unresolved: N" label with plain-language
      // guidance. `unresolved` means those Classroom students have no usable
      // active LyfeLabz identity yet (they have not finished signing in with
      // their school Google account), so the teacher's next step is concrete:
      // have them sign in, then sync again. The count is preserved inside the
      // sentence; it never appears as a bare unexplained number. Singular and
      // plural are handled so the copy always reads naturally.
      let sentence = `Roster synced. ${parts.join(", ")}.`;
      if (c.unresolved > 0) {
        const guidance =
          c.unresolved === 1
            ? "1 student hasn't finished signing in to LyfeLabz with their school Google account yet. Ask them to sign in, then sync the roster again."
            : `${c.unresolved} students haven't finished signing in to LyfeLabz with their school Google accounts yet. Ask them to sign in, then sync the roster again.`;
        sentence = `${sentence} ${guidance}`;
      }
      status.textContent = sentence;
      panel.setAttribute("data-rostersync-status", "ok");
      break;
    }
    case "error": {
      const kind = rosterSync.entry.kind;
      // Calm plain-language recovery copy. No provider identifiers,
      // student names, or emails are ever included.
      switch (kind) {
        case "reconnectRequired":
          status.textContent =
            "Google Classroom access needs to be reconnected. Open Settings to reconnect, then try Sync roster again.";
          break;
        case "linkBroken":
          status.textContent =
            "This class's Google Classroom course could not be reached. Confirm the course is still available and try again.";
          break;
        case "classNotActive":
          status.textContent =
            "This class is no longer active, so its roster cannot be synchronized.";
          break;
        case "transient":
          status.textContent =
            "We could not reach Google Classroom just now. Try Sync roster again in a moment.";
          break;
        case "unknown":
        default:
          status.textContent =
            "Roster synchronization did not finish. Try Sync roster again in a moment.";
          break;
      }
      panel.setAttribute("data-rostersync-status", "error");
      panel.setAttribute("data-rostersync-error-kind", kind);
      break;
    }
  }

  panel.appendChild(status);
  return panel;
}

// One-screen imported-class setup form. Asks only for grade and block,
// both starting empty; the teacher chooses them for this class.
function renderSetupSurface(
  doc: Document,
  mount: HTMLElement,
  summary: ClassSummary,
  form: SetupFormState,
  onFormChange: (patch: Partial<SetupFormState>) => void,
  onSubmit: () => void,
  onCancel: () => void,
  canActivate: boolean,
): void {
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome shell-class-setup-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = `Finish setting up ${summary.title}`;
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const intro = doc.createElement("p");
  intro.className = "shell-status shell-class-setup-intro";
  intro.setAttribute("data-testid", "class-setup-intro");
  intro.textContent =
    "Choose the grade and class block before using this class with students.";
  mount.appendChild(intro);

  const formEl = doc.createElement("form");
  formEl.className = "shell-form shell-class-setup-form";
  formEl.setAttribute("data-testid", "class-setup-form");
  formEl.addEventListener("submit", (ev) => {
    ev.preventDefault();
    onSubmit();
  });

  const gradeLabel = doc.createElement("label");
  gradeLabel.textContent = "Grade";
  const gradeSelect = doc.createElement("select");
  gradeSelect.setAttribute("data-testid", "class-setup-grade");
  gradeSelect.disabled = form.submitting;
  const gradePlaceholder = doc.createElement("option");
  gradePlaceholder.value = "";
  gradePlaceholder.textContent = "Choose a grade";
  if (form.grade === "") gradePlaceholder.selected = true;
  gradeSelect.appendChild(gradePlaceholder);
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
  blockSelect.setAttribute("data-testid", "class-setup-block");
  blockSelect.disabled = form.submitting;
  const blockPlaceholder = doc.createElement("option");
  blockPlaceholder.value = "";
  blockPlaceholder.textContent = "Choose a block";
  if (form.block === "") blockPlaceholder.selected = true;
  blockSelect.appendChild(blockPlaceholder);
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
    err.setAttribute("data-testid", "class-setup-error");
    err.className = "shell-class-setup-error";
    err.textContent = form.error;
    formEl.appendChild(err);
  }

  if (!canActivate) {
    const unavailable = doc.createElement("p");
    unavailable.setAttribute("role", "status");
    unavailable.setAttribute("data-testid", "class-setup-unavailable");
    unavailable.className = "shell-status shell-class-setup-unavailable";
    unavailable.textContent =
      "Class setup is not available right now. Reload the page and try again.";
    formEl.appendChild(unavailable);
  }

  const actions = doc.createElement("div");
  actions.className = "shell-class-setup-actions";

  const submit = doc.createElement("button");
  submit.type = "submit";
  submit.setAttribute("data-testid", "class-setup-submit");
  submit.textContent = form.submitting ? "Finishing setup" : "Finish setup";
  submit.disabled = form.submitting || !canActivate;
  if (form.submitting) submit.setAttribute("aria-busy", "true");
  actions.appendChild(submit);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-class-setup-cancel";
  cancel.setAttribute("data-testid", "class-setup-cancel");
  cancel.textContent = "Cancel";
  cancel.disabled = form.submitting;
  cancel.addEventListener("click", () => onCancel());
  actions.appendChild(cancel);

  formEl.appendChild(actions);
  mount.appendChild(formEl);
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

  // Sprint 28.6H.3 (Task B1): Overview is removed from the class navigation.
  // Human review found it redundant - the teacher's useful class-level
  // destinations are Assignments and Students. The final navigation is exactly
  // `Assignments | Students`; the retired Overview/Snapshot tab is not hidden
  // by CSS, it is absent from the operational navigation model. The internal
  // `roster` key is kept stable so the certified Students switcher testid and
  // its tests are preserved.
  const items: ReadonlyArray<{
    readonly key: ClassWorkspaceTab;
    readonly label: string;
  }> = Object.freeze([
    Object.freeze({ key: "assignments" as const, label: "Assignments" }),
    Object.freeze({ key: "roster" as const, label: "Students" }),
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

// Sprint 29G.5P: render the empty state exactly "No students yet." Shown ONLY
// when there are genuinely zero active enrolled students (or when no roster
// reader is wired, e.g. a test harness). A load failure uses the distinct
// error state below, never this, so a failure can never masquerade as "no
// students" (Part A requirement 8).
function appendRosterEmptyState(doc: Document, container: HTMLElement): void {
  const empty = doc.createElement("div");
  empty.className = "shell-roster-empty";
  empty.setAttribute("data-testid", "roster-empty");
  empty.setAttribute("role", "status");
  const emptyMsg = doc.createElement("p");
  emptyMsg.className = "shell-roster-empty-message";
  emptyMsg.textContent = "No students yet.";
  empty.appendChild(emptyMsg);
  container.appendChild(empty);
}

function renderRosterSurface(
  doc: Document,
  mount: HTMLElement,
  view: RosterView,
  onSelectStudent: (studentId: string, displayName: string) => void,
): void {
  // Sprint 28.6H (Finding 3/5): section heading is "Students" (the class
  // identity is the workspace header).
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome shell-roster-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = "Students";
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  // The list/loading/error/empty states live in a dedicated body so an async
  // result can replace the loading placeholder without disturbing the heading.
  const body = doc.createElement("div");
  body.className = "shell-roster-body";
  mount.appendChild(body);

  // No roster ACCESSOR wired (test harnesses that do not exercise the roster):
  // fall back to the genuine empty state rather than a spinner that never
  // resolves.
  if (view.kind === "unwired") {
    appendRosterEmptyState(doc, body);
    return;
  }

  // The roster for this class was already resolved (prefetched when the
  // class opened, or loaded on an earlier Students visit): render it
  // immediately, with no loading state.
  if (view.kind === "ready") {
    appendRosterStudents(doc, body, view.students, onSelectStudent);
    return;
  }

  const loading = doc.createElement("p");
  loading.className = "shell-roster-loading";
  loading.setAttribute("data-testid", "roster-loading");
  loading.setAttribute("role", "status");
  loading.textContent = "Loading students…";
  body.appendChild(loading);

  // A not-ready reader means initialization is genuinely not ready yet. Keep
  // the loading state in place - NEVER fall through to the empty state, so a
  // not-ready loader is never mistaken for a zero-student roster (this state is
  // not expected once the teacher can reach the Students tab, but it must fail
  // toward "loading", not "no students").
  if (view.kind === "notReady") {
    return;
  }

  // Guard against a stale async result after the surface is torn down on a
  // tab switch: only mutate the DOM while this body is still connected.
  const applyIfLive = (render: () => void): void => {
    if (!body.isConnected) return;
    body.replaceChildren();
    render();
  };

  view.promise.then(
    (students) => {
      applyIfLive(() => appendRosterStudents(doc, body, students, onSelectStudent));
    },
    () => {
      // Failure must NOT render the "No students yet." empty state, which
      // would falsely imply an empty class (Part A requirement 8).
      applyIfLive(() => {
        const error = doc.createElement("div");
        error.className = "shell-roster-error";
        error.setAttribute("data-testid", "roster-error");
        error.setAttribute("role", "status");
        const errorMsg = doc.createElement("p");
        errorMsg.className = "shell-roster-error-message";
        errorMsg.textContent =
          "We couldn't load your students. Please try again.";
        error.appendChild(errorMsg);
        body.appendChild(error);
      });
    },
  );
}

function appendRosterStudents(
  doc: Document,
  body: HTMLElement,
  students: RosterStudents,
  onSelectStudent: (studentId: string, displayName: string) => void,
): void {
  if (students.length === 0) {
    appendRosterEmptyState(doc, body);
    return;
  }
  const list = doc.createElement("ul");
  list.className = "shell-roster-list";
  list.setAttribute("data-testid", "roster-list");
  for (const student of students) {
    const item = doc.createElement("li");
    item.className = "shell-roster-item";
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-roster-student";
    btn.setAttribute("data-testid", "roster-student");
    btn.setAttribute("data-student-id", student.studentId);
    const name = doc.createElement("span");
    name.className = "shell-roster-student-name";
    name.textContent = student.studentDisplayName;
    btn.appendChild(name);
    btn.addEventListener("click", () => {
      onSelectStudent(student.studentId, student.studentDisplayName);
    });
    item.appendChild(btn);
    list.appendChild(item);
  }
  body.appendChild(list);
}

// PDR-029a/b best-attempt selection for Student Detail V1.
// Tie-breaking: highest percentage → highest attemptNumber → latest submittedAt
// → ascending attemptId (final deterministic fallback).
function selectBestAttempt(
  attempts: ReadonlyArray<CompletedAttemptSummary>,
): CompletedAttemptSummary | null {
  if (attempts.length === 0) return null;
  return [...attempts].reduce((best, attempt) => {
    if (attempt.percentage > best.percentage) return attempt;
    if (attempt.percentage < best.percentage) return best;
    if (attempt.attemptNumber > best.attemptNumber) return attempt;
    if (attempt.attemptNumber < best.attemptNumber) return best;
    if (attempt.submittedAt > best.submittedAt) return attempt;
    if (attempt.submittedAt < best.submittedAt) return best;
    return attempt.attemptId < best.attemptId ? attempt : best;
  });
}

// The canonical earliest attempt, per the same attemptNumber ordering the
// backend uses to assign attemptNumber at finalize time (§ assessment
// scoring contract: attemptNumber = priorCount + 1, assigned strictly in
// submission order). Used for both "first score" and (unchanged) the
// existing latest-date computation's sibling.
function selectFirstAttempt(
  attempts: ReadonlyArray<CompletedAttemptSummary>,
): CompletedAttemptSummary | null {
  if (attempts.length === 0) return null;
  return [...attempts].reduce((first, attempt) =>
    attempt.attemptNumber < first.attemptNumber ? attempt : first,
  );
}

// The earliest attempt ACROSS a Current occurrence group. `attemptNumber`
// restarts at 1 on every assignment, so across several occurrences "first"
// is the earliest submission (tie-break attemptNumber, then attemptId).
// Within one assignment this is the same attempt `selectFirstAttempt`
// picks, because attemptNumber is assigned in submission order.
function selectEarliestAttempt(
  attempts: ReadonlyArray<CompletedAttemptSummary>,
): CompletedAttemptSummary | null {
  if (attempts.length === 0) return null;
  return [...attempts].reduce((first, attempt) => {
    if (attempt.submittedAt < first.submittedAt) return attempt;
    if (attempt.submittedAt > first.submittedAt) return first;
    if (attempt.attemptNumber < first.attemptNumber) return attempt;
    if (attempt.attemptNumber > first.attemptNumber) return first;
    return attempt.attemptId < first.attemptId ? attempt : first;
  });
}

// The canonical most-recent attempt by submittedAt - the same ordering
// already used for the existing "latest date" field. A deterministic
// tie-break (attemptNumber, then attemptId) covers the structurally
// impossible case of two attempts sharing a submittedAt millisecond.
function selectLatestAttempt(
  attempts: ReadonlyArray<CompletedAttemptSummary>,
): CompletedAttemptSummary | null {
  if (attempts.length === 0) return null;
  return [...attempts].reduce((latest, attempt) => {
    if (attempt.submittedAt > latest.submittedAt) return attempt;
    if (attempt.submittedAt < latest.submittedAt) return latest;
    if (attempt.attemptNumber > latest.attemptNumber) return attempt;
    if (attempt.attemptNumber < latest.attemptNumber) return latest;
    return attempt.attemptId > latest.attemptId ? attempt : latest;
  });
}

// Percentage-point growth (never relative/percent-change) between the first
// and latest canonical attempt, rounded the same way each score is rounded
// for display so the printed delta always equals printedLatest - printedFirst.
function formatGrowthPoints(firstPercentage: number, latestPercentage: number): string {
  const delta = Math.round(latestPercentage) - Math.round(firstPercentage);
  if (delta > 0) return `+${delta} pts`;
  if (delta < 0) return `${delta} pts`;
  return "0 pts";
}

type StudentDetailMetric = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly testid: string;
};

// The six Student Detail assignment-summary metrics, in the fixed display
// order. Mirrors the `buildMetrics` shape in
// app/src/assignments/summary/card.ts (the whole-class assignment summary
// this presentation is modeled on) purely for label/value consistency; the
// values themselves are unrelated (per-student, not aggregate) and are
// computed by the same first/latest/best/growth derivation this module
// already owns.
function buildStudentDetailMetrics(
  best: CompletedAttemptSummary | null,
  first: CompletedAttemptSummary | null,
  latest: CompletedAttemptSummary | null,
  attemptCount: number,
): ReadonlyArray<StudentDetailMetric> {
  return Object.freeze([
    Object.freeze({
      key: "best-score",
      label: "Best score",
      value: best !== null ? `${Math.round(best.percentage)}%` : "—",
      testid: "student-detail-best-score",
    }),
    Object.freeze({
      key: "first-score",
      label: "First score",
      value: first !== null ? `${Math.round(first.percentage)}%` : "—",
      testid: "student-detail-first-score",
    }),
    Object.freeze({
      key: "latest-score",
      label: "Latest score",
      value: latest !== null ? `${Math.round(latest.percentage)}%` : "—",
      testid: "student-detail-latest-score",
    }),
    Object.freeze({
      key: "growth",
      label: "Growth",
      value:
        first !== null && latest !== null
          ? formatGrowthPoints(first.percentage, latest.percentage)
          : "—",
      testid: "student-detail-growth",
    }),
    Object.freeze({
      key: "attempts",
      label: "Attempts",
      value: String(attemptCount),
      testid: "student-detail-attempt-count",
    }),
    Object.freeze({
      key: "latest-date",
      label: "Latest date",
      value: latest !== null ? formatAttemptDate(latest.submittedAt) : "—",
      testid: "student-detail-latest-date",
    }),
  ]);
}

function formatAttemptDate(ts: number): string {
  const d = new Date(ts);
  return [
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    String(d.getFullYear()),
  ].join("/");
}

function renderStudentDetailSurface(
  doc: Document,
  mount: HTMLElement,
  classId: string,
  studentId: string,
  studentDisplayName: string,
  roster: ReadonlyArray<{
    readonly studentId: string;
    readonly studentDisplayName: string;
  }> | null,
  studentDetailOrigin:
    | "roster"
    | { readonly kind: "assignment"; readonly assignmentId: string },
  onBack: () => void,
  onNavigateToNeighbor: (studentId: string, displayName: string) => void,
  onOpenOriginatingAssignment: (assignmentId: string) => void,
  classAttempts: ClassAttemptsAccessor | null,
  loadExpectedAssignments:
    | (() => AssessmentStudentAssignmentsForClassCallable | null)
    | null,
  listAssignments: () => ReadonlyArray<AssignmentDetailMetadata>,
  loadAttemptDetail: (() => AttemptGetForTeacherCallable | null) | null = null,
): void {
  const detail = doc.createElement("div");
  detail.className = "shell-student-detail";
  detail.setAttribute("data-testid", "student-detail");
  mount.appendChild(detail);

  // Student Progress & Assignment Membership Phase A, Slice 3 (REQUIRED
  // correction): Back resolves according to the origin Student Detail was
  // ENTERED with - established once and preserved unchanged by Previous /
  // Next (see `onNavigateToNeighbor`, which never touches
  // `studentDetailOrigin`). Entering from the plain Students list ("roster")
  // returns to that list; entering from an Assignment Detail roster-name
  // click returns to that exact originating assignment, however many
  // students were visited via Previous/Next in between.
  const backBtn = doc.createElement("button");
  backBtn.type = "button";
  backBtn.className = "shell-student-detail-back";
  backBtn.setAttribute("data-testid", "student-detail-back");
  if (studentDetailOrigin === "roster") {
    backBtn.textContent = "Back to Students";
    backBtn.addEventListener("click", () => {
      onBack();
    });
  } else {
    backBtn.textContent = "Back to assignment";
    const originAssignmentId = studentDetailOrigin.assignmentId;
    backBtn.addEventListener("click", () => {
      onOpenOriginatingAssignment(originAssignmentId);
    });
  }
  detail.appendChild(backBtn);

  const heading = doc.createElement("h2");
  heading.id = "surface-headline";
  heading.className = "shell-welcome shell-student-detail-name";
  heading.tabIndex = -1;
  heading.setAttribute("data-testid", "student-detail-name");
  heading.textContent = studentDisplayName;
  detail.appendChild(heading);
  try { heading.focus({ preventScroll: true }); } catch { /* ignored */ }

  // Student Progress & Assignment Membership Phase A, Slice 2: Previous /
  // Next, walking the exact server-sorted roster order already fetched for
  // the Students list - no independent client sort, no second fetch. Absent
  // entirely (not merely disabled) when no roster snapshot is available yet
  // (e.g. entered via a future Assignment Detail path in a mount that never
  // fetched the Students-tab roster) or the current student is not found in
  // it, rather than guessing at adjacency.
  const currentIndex =
    roster === null ? -1 : roster.findIndex((s) => s.studentId === studentId);
  if (roster !== null && currentIndex !== -1) {
    const nav = doc.createElement("div");
    nav.className = "shell-student-detail-nav";
    nav.setAttribute("data-testid", "student-detail-nav");

    if (currentIndex > 0) {
      const prev = roster[currentIndex - 1]!;
      const prevBtn = doc.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "shell-student-detail-nav-prev";
      prevBtn.setAttribute("data-testid", "student-detail-prev");
      prevBtn.setAttribute(
        "aria-label",
        `Previous student: ${prev.studentDisplayName}`,
      );
      prevBtn.textContent = "← Previous";
      prevBtn.addEventListener("click", () => {
        onNavigateToNeighbor(prev.studentId, prev.studentDisplayName);
      });
      nav.appendChild(prevBtn);
    }

    if (currentIndex < roster.length - 1) {
      const next = roster[currentIndex + 1]!;
      const nextBtn = doc.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "shell-student-detail-nav-next";
      nextBtn.setAttribute("data-testid", "student-detail-next");
      nextBtn.setAttribute(
        "aria-label",
        `Next student: ${next.studentDisplayName}`,
      );
      nextBtn.textContent = "Next →";
      nextBtn.addEventListener("click", () => {
        onNavigateToNeighbor(next.studentId, next.studentDisplayName);
      });
      nav.appendChild(nextBtn);
    }

    if (nav.childElementCount > 0) detail.appendChild(nav);
  }

  const body = doc.createElement("div");
  body.className = "shell-student-detail-body";
  body.setAttribute("data-testid", "student-detail-body");
  detail.appendChild(body);

  // No attempts accessor wired (harness path): show the empty state.
  if (classAttempts === null) {
    appendStudentDetailEmpty(doc, body);
    return;
  }

  // The open class's held class-wide attempts (read once per class session
  // and reused across students; see `ensureClassAttempts`).
  const attemptsPromise = classAttempts();

  const loading = doc.createElement("p");
  loading.className = "shell-student-detail-loading";
  loading.setAttribute("data-testid", "student-detail-loading");
  loading.setAttribute("role", "status");
  loading.textContent = "Loading student work…";
  body.appendChild(loading);

  // Accessor not ready yet (init in progress): keep the loading state.
  if (attemptsPromise === null) {
    return;
  }

  // A later render (another student, another class, or leaving) detaches
  // this `body`, so a response for a student who is no longer shown can
  // never overwrite the current one.
  const applyIfLive = (render: () => void): void => {
    if (!body.isConnected) return;
    body.replaceChildren();
    render();
  };

  // Student Progress & Assignment Membership Phase A, Slice 4: the expected-
  // assignments accessor is resolved and fetched alongside attempts, but its
  // failure or absence degrades gracefully to "no additional expected work
  // known" rather than turning the whole surface into an error state -
  // exactly the same "best-effort, never blocks the primary view" posture
  // the certified grade-passback status read already uses on Assignment
  // Detail. Only a failure of the attempts fetch (the pre-existing,
  // certified data source) produces the error state.
  //
  // Reassignment model: the same response carries the server's canonical
  // Current occurrence groups (`groups`); when present, cards are one per
  // group. Absent (older server, or this read failed), the per-assignment
  // rendering below is used unchanged.
  const expectedCallable =
    loadExpectedAssignments === null ? null : loadExpectedAssignments();
  const expectedPromise: Promise<{
    readonly assignments: ReadonlyArray<StudentExpectedAssignment>;
    readonly groups: ReadonlyArray<StudentAssignmentGroup> | undefined;
  }> =
    expectedCallable === null
      ? Promise.resolve({ assignments: [], groups: undefined })
      : expectedCallable({ classId, studentId })
          .then((r) => ({ assignments: r.assignments, groups: r.groups }))
          .catch(() => ({ assignments: [], groups: undefined }));

  void Promise.all([attemptsPromise, expectedPromise])
    .then(([classAttemptsList, expected]) => {
      applyIfLive(() => {
        const studentAttempts = classAttemptsList.filter(
          (a) => a.studentId === studentId,
        );
        const registry = listAssignments();
        const attemptDetail =
          loadAttemptDetail === null ? null : loadAttemptDetail();
        const list =
          expected.groups !== undefined
            ? buildGroupedStudentDetailList(
                doc,
                studentAttempts,
                expected.groups,
                registry,
                attemptDetail,
              )
            : buildPerAssignmentStudentDetailList(
                doc,
                studentAttempts,
                expected.assignments,
                registry,
                attemptDetail,
              );
        if (list === null) {
          appendStudentDetailEmpty(doc, body);
          return;
        }
        body.appendChild(list);
      });
    })
    .catch(() => {
      applyIfLive(() => {
        const error = doc.createElement("div");
        error.className = "shell-student-detail-error";
        error.setAttribute("data-testid", "student-detail-error");
        error.setAttribute("role", "status");
        const msg = doc.createElement("p");
        msg.textContent = "We couldn't load student work. Please try again.";
        error.appendChild(msg);
        body.appendChild(error);
      });
    });
}

// Lazily resolves the open class's held class-wide attempts (null while the
// attempts callable is not yet initialized).
type ClassAttemptsAccessor = () => Promise<ReadonlyArray<CompletedAttemptSummary>> | null;

const registryTitle = (
  registry: ReadonlyArray<AssignmentDetailMetadata>,
  assignmentId: string,
): string | null => registry.find((a) => a.assignmentId === assignmentId)?.title ?? null;

// The six metric boxes for one card, computed from exactly the attempts
// passed in (one assignment, or a whole Current occurrence group).
function appendStudentDetailMetricsGrid(
  doc: Document,
  li: HTMLElement,
  attempts: ReadonlyArray<CompletedAttemptSummary>,
  // True for a Current occurrence group (attempts span several
  // assignments): "first" is then the earliest submission.
  cumulative = false,
): void {
  // Individual compact metric boxes, mirroring the established whole-class
  // `renderAssignmentSummaryCard` metric-grid pattern
  // (app/src/assignments/summary/card.ts: <dl> of label/value cells) rather
  // than a single inline text row.
  const metricsGrid = doc.createElement("dl");
  metricsGrid.className = "shell-student-detail-metric-grid";
  metricsGrid.setAttribute("data-testid", "student-detail-metrics");
  li.appendChild(metricsGrid);

  for (const metric of buildStudentDetailMetrics(
    selectBestAttempt(attempts),
    cumulative ? selectEarliestAttempt(attempts) : selectFirstAttempt(attempts),
    selectLatestAttempt(attempts),
    attempts.length,
  )) {
    const cell = doc.createElement("div");
    cell.className = "shell-student-detail-metric";
    cell.setAttribute("data-testid", `student-detail-metric-${metric.key}`);

    const term = doc.createElement("dt");
    term.className = "shell-student-detail-metric-label";
    term.textContent = metric.label;
    cell.appendChild(term);

    const value = doc.createElement("dd");
    value.className = "shell-student-detail-metric-value";
    value.setAttribute("data-testid", metric.testid);
    value.textContent = metric.value;
    cell.appendChild(value);

    metricsGrid.appendChild(cell);
  }
}

function appendStudentDetailStatus(
  doc: Document,
  li: HTMLElement,
  testid: string,
  text: string,
): void {
  const status = doc.createElement("p");
  status.className = "shell-student-detail-assignment-status";
  status.setAttribute("data-testid", testid);
  status.textContent = text;
  li.appendChild(status);
}

// Pre-grouping rendering, unchanged: one card per assignment the student
// completed (metrics), then one per expected-but-uncompleted assignment
// (In progress / Not started). Used when the server sent no `groups`.
function buildPerAssignmentStudentDetailList(
  doc: Document,
  studentAttempts: ReadonlyArray<CompletedAttemptSummary>,
  expectedAssignments: ReadonlyArray<StudentExpectedAssignment>,
  registry: ReadonlyArray<AssignmentDetailMetadata>,
  attemptDetail: AttemptGetForTeacherCallable | null = null,
): HTMLElement | null {
  // Group completed attempts by assignmentId: the sole source of
  // "completed" and of Best/First/Latest/Growth/Attempts/Latest Date.
  const byAssignment = new Map<string, CompletedAttemptSummary[]>();
  for (const attempt of studentAttempts) {
    const group = byAssignment.get(attempt.assignmentId);
    if (group !== undefined) group.push(attempt);
    else byAssignment.set(attempt.assignmentId, [attempt]);
  }

  // Assignments the student is expected to complete but has not completed:
  // present in the recipient-derived expected set, absent from
  // `byAssignment`. Every historical completed attempt is preserved even if
  // its assignmentId is absent from the expected set (attempts survive
  // roster/recipient changes per `assessmentAttemptsListForClass`'s own
  // documented invariant).
  const notCompleted = expectedAssignments.filter(
    (a) => !byAssignment.has(a.assignmentId),
  );

  if (byAssignment.size === 0 && notCompleted.length === 0) return null;

  const resolveTitle = (assignmentId: string): string =>
    registryTitle(registry, assignmentId) ?? "Assignment";

  const list = doc.createElement("ul");
  list.className = "shell-student-detail-assignments";
  list.setAttribute("data-testid", "student-detail-assignments");

  for (const [assignmentId, attempts] of byAssignment) {
    const card = buildCompletedAssignmentCard(doc, assignmentId, attempts, resolveTitle(assignmentId), registry);
    appendWrittenResponses(doc, card, attempts, attemptDetail);
    list.appendChild(card);
  }

  // In Progress / Not Started cards: no metrics grid is ever rendered, so no
  // score can ever be fabricated for either state.
  for (const { assignmentId, hasLiveSession } of notCompleted) {
    const statusKind = hasLiveSession ? "in-progress" : "not-started";
    const li = doc.createElement("li");
    li.className = `shell-student-detail-assignment shell-student-detail-assignment-${statusKind}`;
    li.setAttribute("data-testid", `student-detail-assignment-${statusKind}`);
    li.setAttribute("data-assignment-id", assignmentId);
    li.setAttribute("data-assignment-status", statusKind);
    appendAssignmentCardTitle(doc, li, resolveTitle(assignmentId), registry, assignmentId);
    appendStudentDetailStatus(
      doc,
      li,
      `student-detail-assignment-status-${assignmentId}`,
      hasLiveSession ? "In progress" : "Not started",
    );
    list.appendChild(li);
  }

  return list;
}

// One card per assignment from its own attempts (legacy / unresolved /
// orphan attempts).
function buildCompletedAssignmentCard(
  doc: Document,
  assignmentId: string,
  attempts: ReadonlyArray<CompletedAttemptSummary>,
  title: string,
  registry: ReadonlyArray<AssignmentDetailMetadata>,
  metaOverride?: { readonly status: string | null; readonly publishedAt: number | null },
  cumulative = false,
): HTMLElement {
  const li = doc.createElement("li");
  li.className = "shell-student-detail-assignment";
  li.setAttribute("data-testid", "student-detail-assignment");
  li.setAttribute("data-assignment-id", assignmentId);
  li.setAttribute("data-assignment-status", "completed");
  if (metaOverride !== undefined) {
    appendServerCardTitle(doc, li, title, assignmentId, metaOverride);
  } else {
    appendAssignmentCardTitle(doc, li, title, registry, assignmentId);
  }
  appendStudentDetailMetricsGrid(doc, li, attempts, cumulative);
  return li;
}

// Reassignment model: one card per server-resolved occurrence group.
//   - valid:      ONE card for the class + lesson. Title / published date /
//                 operational status come from Current; metrics are
//                 cumulative over the student's attempts on EVERY occurrence
//                 in the group. With history but no attempt on Current, the
//                 Current status is shown separately ("Current: Not
//                 started" / "Current: In progress") - never as the lesson's
//                 overall state.
//   - inactive:   ONE history-only card labeled "Closed" with cumulative
//                 metrics; never "Not started", never launchable, no older
//                 occurrence resurrected.
//   - unresolved: legacy, never grouped: one card per assignment, titled by
//                 the server.
// Any attempt outside every group keeps its own card, so no historical work
// is ever hidden because grouping metadata is incomplete.
function buildGroupedStudentDetailList(
  doc: Document,
  studentAttempts: ReadonlyArray<CompletedAttemptSummary>,
  groups: ReadonlyArray<StudentAssignmentGroup>,
  registry: ReadonlyArray<AssignmentDetailMetadata>,
  attemptDetail: AttemptGetForTeacherCallable | null = null,
): HTMLElement | null {
  const list = doc.createElement("ul");
  list.className = "shell-student-detail-assignments";
  list.setAttribute("data-testid", "student-detail-assignments");

  const claimed = new Set<string>();
  for (const group of groups) {
    for (const id of group.assignmentIds) claimed.add(id);
    const ids = new Set(group.assignmentIds);
    const attempts = studentAttempts.filter((a) => ids.has(a.assignmentId));
    const card = buildGroupCard(doc, group, attempts, registry);
    if (card !== null) {
      appendWrittenResponses(doc, card, attempts, attemptDetail);
      list.appendChild(card);
    }
  }

  // Orphan attempts (their assignment is in no group): own card each.
  const orphans = new Map<string, CompletedAttemptSummary[]>();
  for (const attempt of studentAttempts) {
    if (claimed.has(attempt.assignmentId)) continue;
    const bucket = orphans.get(attempt.assignmentId);
    if (bucket !== undefined) bucket.push(attempt);
    else orphans.set(attempt.assignmentId, [attempt]);
  }
  for (const [assignmentId, attempts] of orphans) {
    const card = buildCompletedAssignmentCard(
      doc,
      assignmentId,
      attempts,
      registryTitle(registry, assignmentId) ?? "Assignment",
      registry,
    );
    appendWrittenResponses(doc, card, attempts, attemptDetail);
    list.appendChild(card);
  }

  return list.childElementCount === 0 ? null : list;
}

function buildGroupCard(
  doc: Document,
  group: StudentAssignmentGroup,
  attempts: ReadonlyArray<CompletedAttemptSummary>,
  registry: ReadonlyArray<AssignmentDetailMetadata>,
): HTMLElement | null {
  const operationalId = group.operationalAssignmentId;
  const cardId = operationalId ?? group.assignmentIds[0]!;
  const title =
    group.title ?? registryTitle(registry, cardId) ?? "Assignment";
  const meta = { status: group.status, publishedAt: group.publishedAt };

  if (group.resolution === "unresolved") {
    if (attempts.length > 0) {
      const li = buildCompletedAssignmentCard(doc, cardId, attempts, title, registry, meta);
      li.setAttribute("data-group-resolution", "unresolved");
      return li;
    }
    const statusKind = group.hasLiveSession ? "in-progress" : "not-started";
    const li = doc.createElement("li");
    li.className = `shell-student-detail-assignment shell-student-detail-assignment-${statusKind}`;
    li.setAttribute("data-testid", `student-detail-assignment-${statusKind}`);
    li.setAttribute("data-assignment-id", cardId);
    li.setAttribute("data-assignment-status", statusKind);
    li.setAttribute("data-group-resolution", "unresolved");
    appendServerCardTitle(doc, li, title, cardId, meta);
    appendStudentDetailStatus(
      doc,
      li,
      `student-detail-assignment-status-${cardId}`,
      group.hasLiveSession ? "In progress" : "Not started",
    );
    return li;
  }

  if (group.resolution === "inactive") {
    const li = doc.createElement("li");
    li.className = "shell-student-detail-assignment shell-student-detail-assignment-closed";
    li.setAttribute("data-testid", "student-detail-assignment-closed");
    li.setAttribute("data-assignment-id", cardId);
    li.setAttribute("data-assignment-status", "closed");
    li.setAttribute("data-group-resolution", "inactive");
    appendServerCardTitle(doc, li, title, cardId, meta);
    appendStudentDetailStatus(doc, li, `student-detail-assignment-status-${cardId}`, "Closed");
    if (attempts.length > 0) appendStudentDetailMetricsGrid(doc, li, attempts, true);
    return li;
  }

  // valid Current.
  const hasCurrentAttempt = attempts.some((a) => a.assignmentId === operationalId);
  if (attempts.length === 0) {
    // No history in this lesson: the card is the Current operational state.
    if (!group.hasLiveSession && !group.isOperationalRecipient) return null;
    const statusKind = group.hasLiveSession ? "in-progress" : "not-started";
    const li = doc.createElement("li");
    li.className = `shell-student-detail-assignment shell-student-detail-assignment-${statusKind}`;
    li.setAttribute("data-testid", `student-detail-assignment-${statusKind}`);
    li.setAttribute("data-assignment-id", cardId);
    li.setAttribute("data-assignment-status", statusKind);
    li.setAttribute("data-group-resolution", "valid");
    appendServerCardTitle(doc, li, title, cardId, meta);
    appendStudentDetailStatus(
      doc,
      li,
      `student-detail-assignment-status-${cardId}`,
      group.hasLiveSession ? "In progress" : "Not started",
    );
    return li;
  }
  const li = buildCompletedAssignmentCard(doc, cardId, attempts, title, registry, meta, true);
  li.setAttribute("data-group-resolution", "valid");
  // The Current operational state is separate from the cumulative history
  // and only shown when it adds information; it sits under the title, above
  // the metrics, like the Closed label on a history card.
  const currentStatus = group.hasLiveSession
    ? "Current: In progress"
    : !hasCurrentAttempt && group.isOperationalRecipient
      ? "Current: Not started"
      : null;
  if (currentStatus !== null) {
    appendStudentDetailStatus(doc, li, `student-detail-current-status-${cardId}`, currentStatus);
    const grid = li.querySelector("[data-testid=student-detail-metrics]");
    const statusEl = li.lastElementChild;
    if (grid !== null && statusEl !== null) li.insertBefore(statusEl, grid);
  }
  return li;
}

// Sprint 30 Show Your Thinking. A disclosure listing each of the card's
// attempts with the written response frozen on THAT attempt. Responses are
// read per attempt (`assessmentAttemptGetForTeacher`) only when the teacher
// opens the disclosure, so Student Detail's initial load is unchanged. A
// Current group card spans several assignment occurrences; its attempts are
// still listed one by one (oldest first), never merged, so a historical
// attempt's response stays attached to that attempt. Cards with no attempts
// (Not started / In progress) get no disclosure.
function appendWrittenResponses(
  doc: Document,
  card: HTMLElement,
  attempts: ReadonlyArray<CompletedAttemptSummary>,
  attemptDetail: AttemptGetForTeacherCallable | null,
): void {
  if (attemptDetail === null || attempts.length === 0) return;
  const ordered = [...attempts].sort(
    (a, b) =>
      a.submittedAt - b.submittedAt ||
      a.attemptNumber - b.attemptNumber ||
      a.attemptId.localeCompare(b.attemptId),
  );

  const panelId = `student-detail-thinking-${card.getAttribute("data-assignment-id") ?? ""}`;
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "shell-student-detail-thinking-toggle";
  toggle.setAttribute("data-testid", "student-detail-thinking-toggle");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  toggle.textContent = "Show Your Thinking";
  card.appendChild(toggle);

  const panel = doc.createElement("div");
  panel.className = "shell-student-detail-thinking";
  panel.id = panelId;
  panel.setAttribute("data-testid", "student-detail-thinking");
  panel.hidden = true;
  card.appendChild(panel);

  // Loaded once per render; a failed read is retried on the next open.
  let loaded = false;
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    if (!open || loaded) return;
    loaded = true;

    panel.replaceChildren();
    const loading = doc.createElement("p");
    loading.className = "shell-student-detail-thinking-muted";
    loading.setAttribute("data-testid", "student-detail-thinking-loading");
    loading.setAttribute("role", "status");
    loading.textContent = "Loading written responses…";
    panel.appendChild(loading);

    void Promise.all(
      ordered.map((attempt) =>
        attemptDetail({ attemptId: attempt.attemptId }).then(
          (detail) => ({ attempt, ok: true as const, text: detail.writtenResponse ?? null }),
          () => ({ attempt, ok: false as const, text: null }),
        ),
      ),
    ).then((rows) => {
      if (!panel.isConnected) return;
      if (rows.some((r) => !r.ok)) loaded = false;
      panel.replaceChildren();
      const list = doc.createElement("ol");
      list.className = "shell-student-detail-thinking-list";
      for (const row of rows) {
        const item = doc.createElement("li");
        item.className = "shell-student-detail-thinking-item";
        item.setAttribute("data-testid", "student-detail-thinking-item");
        item.setAttribute("data-attempt-id", row.attempt.attemptId);

        const label = doc.createElement("p");
        label.className = "shell-student-detail-thinking-label";
        label.textContent = `Attempt ${row.attempt.attemptNumber} · ${formatAttemptDate(row.attempt.submittedAt)}`;
        item.appendChild(label);

        const body = doc.createElement("p");
        if (!row.ok) {
          body.className = "shell-student-detail-thinking-muted";
          body.setAttribute("data-testid", "student-detail-thinking-error");
          body.textContent = "We couldn't load this response. Close and reopen to try again.";
        } else if (row.text === null) {
          body.className = "shell-student-detail-thinking-muted";
          body.setAttribute("data-testid", "student-detail-thinking-none");
          body.textContent = "No written response saved for this attempt.";
        } else {
          body.className = "shell-student-detail-thinking-text";
          body.setAttribute("data-testid", "student-detail-thinking-text");
          body.textContent = row.text;
        }
        item.appendChild(body);
        list.appendChild(item);
      }
      panel.appendChild(list);
    });
  });
}

// Card title + a secondary status/date line from server metadata (the
// group's Current, or the assignment itself).
function appendServerCardTitle(
  doc: Document,
  li: HTMLElement,
  title: string,
  assignmentId: string,
  meta: { readonly status: string | null; readonly publishedAt: number | null },
): void {
  const titleEl = doc.createElement("div");
  titleEl.className = "shell-student-detail-assignment-title";
  titleEl.setAttribute("data-testid", "student-detail-assignment-title");
  titleEl.textContent = title;
  li.appendChild(titleEl);

  if (meta.publishedAt === null) return;
  const dateEl = doc.createElement("p");
  dateEl.className = "shell-student-detail-assignment-meta";
  dateEl.setAttribute("data-testid", `student-detail-assignment-meta-${assignmentId}`);
  dateEl.textContent = `${assignmentStatusLabel(meta.status)} ${formatLocalDate(new Date(meta.publishedAt))}`;
  li.appendChild(dateEl);
}

function assignmentStatusLabel(status: string | null | undefined): string {
  if (status === "closed") return "Closed";
  if (status === "archived") return "Archived";
  if (status === "draft") return "Draft";
  return "Published";
}

// Student Progress & Assignment Membership Phase A, Slice 9: repeated
// assignment instances for the same lesson are never merged in Phase A, so
// every card carries a secondary line built from already-hydrated,
// non-PII assignment metadata (status + published date) whenever the
// registry has it, letting a teacher tell two "Engineering Design" cards
// apart without inventing an occurrence concept. Absent metadata (e.g. no
// registry entry) renders no secondary line at all - never a fabricated one.
function appendAssignmentCardTitle(
  doc: Document,
  li: HTMLElement,
  title: string,
  registry: ReadonlyArray<AssignmentDetailMetadata>,
  assignmentId: string,
): void {
  const titleEl = doc.createElement("div");
  titleEl.className = "shell-student-detail-assignment-title";
  titleEl.setAttribute("data-testid", "student-detail-assignment-title");
  titleEl.textContent = title;
  li.appendChild(titleEl);

  const meta = registry.find((a) => a.assignmentId === assignmentId);
  if (meta === undefined || typeof meta.publishedAt !== "number") return;
  const dateEl = doc.createElement("p");
  dateEl.className = "shell-student-detail-assignment-meta";
  dateEl.setAttribute(
    "data-testid",
    `student-detail-assignment-meta-${assignmentId}`,
  );
  dateEl.textContent = `${assignmentStatusLabel(meta.status)} ${formatLocalDate(new Date(meta.publishedAt))}`;
  li.appendChild(dateEl);
}

function appendStudentDetailEmpty(doc: Document, container: HTMLElement): void {
  const empty = doc.createElement("div");
  empty.className = "shell-student-detail-empty";
  empty.setAttribute("data-testid", "student-detail-empty");
  empty.setAttribute("role", "status");
  const msg = doc.createElement("p");
  msg.textContent = "No assignments yet.";
  empty.appendChild(msg);
  container.appendChild(empty);
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
